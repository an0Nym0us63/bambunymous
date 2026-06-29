"""
API REST — Historique des impressions.
"""
import os, shutil
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, desc, func
from sqlalchemy.orm import selectinload

from .auth import get_current_user
from ....models.print_history import Print, FilamentUsage, PrintSnapshot, PrintTag
from ....models.filament import Spool, Filament
from ....db.session import AsyncSessionLocal

router  = APIRouter()
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))


# ── Schémas Pydantic ──────────────────────────────────────────────────────

class FilamentOut(BaseModel):
    id: int; print_id: int; spool_id: Optional[int]
    filament_type: str; color_hex: str; grams_used: float
    ams_slot: int; cost: float; normal_cost: float
    class Config: from_attributes = True

class SnapshotOut(BaseModel):
    id: int; trigger: str; file_path: Optional[str]; taken_at: datetime
    class Config: from_attributes = True

class PrintOut(BaseModel):
    id: int; job_id: Optional[str]; print_date: datetime
    file_name: str; original_name: Optional[str]; print_type: str
    status: str; status_note: Optional[str]
    plate_image: Optional[str]; model_3mf: Optional[str]
    estimated_seconds: Optional[float]; duration_seconds: Optional[float]
    total_weight_g: float; total_cost_filament: float
    electric_cost: float; total_cost: float
    number_of_items: int; sold_units: int
    sold_price_total: Optional[float]; margin: float
    plate_id: str; design_id: Optional[str]; printer_model: str
    filament_usage: List[FilamentOut] = []
    snapshots:      List[SnapshotOut] = []
    tags:           List[str] = []
    created_at: datetime; updated_at: datetime
    class Config: from_attributes = True


# ── Helpers ────────────────────────────────────────────────────────────────

def _usage_to_dict(u) -> dict:
    d = {col.name: getattr(u, col.name) for col in u.__table__.columns}
    # Enrichir color_hex et filament_type depuis la bobine liée si vide
    if u.spool_id and (not d.get("color_hex") or not d.get("filament_type")):
        try:
            if hasattr(u, "spool") and u.spool and u.spool.filament:
                f = u.spool.filament
                if not d.get("color_hex") and f.color:
                    d["color_hex"] = f"#{f.color}" if not str(f.color).startswith("#") else f.color
                if not d.get("filament_type") and f.material:
                    d["filament_type"] = f.material
        except Exception:
            pass
    # Attribut temporaire injecté par _enrich_filament_usage
    if hasattr(u, "_filament_name"):
        d["filament_name"] = u._filament_name
    return d


def _print_to_out(p: Print) -> dict:
    d = {col.name: getattr(p, col.name) for col in p.__table__.columns}
    d["filament_usage"] = [_usage_to_dict(u) for u in (p.filament_usage or [])]
    d["snapshots"] = [
        {col.name: getattr(s, col.name) for col in s.__table__.columns}
        for s in (p.snapshots or [])
    ]
    d["tags"] = [t.tag for t in (p.tags or [])]
    return d


async def _enrich_filament_usage(db, prints):
    """Enrichit color_hex/filament_type/filament_name depuis les bobines liées."""
    spool_ids = {u.spool_id for p in prints for u in (p.filament_usage or []) if u.spool_id}
    if not spool_ids:
        return
    from sqlalchemy.orm import selectinload as _sil
    spools_r = await db.execute(
        select(Spool).where(Spool.id.in_(spool_ids))
    )
    spools = {s.id: s for s in spools_r.scalars().all()}
    # Charger les filaments
    fil_ids = {s.filament_id for s in spools.values() if s.filament_id}
    fils_r = await db.execute(select(Filament).where(Filament.id.in_(fil_ids)))
    fils = {f.id: f for f in fils_r.scalars().all()}

    for p in prints:
        for u in (p.filament_usage or []):
            if not u.spool_id: continue
            spool = spools.get(u.spool_id)
            if not spool: continue
            fil = fils.get(spool.filament_id)
            if not fil: continue
            if not u.color_hex and fil.color:
                u.color_hex = f"#{fil.color}" if not str(fil.color).startswith("#") else fil.color
            if not u.filament_type and fil.material:
                u.filament_type = fil.material
            # Injecter le nom (attribut temporaire, pas en DB)
            u._filament_name = fil.name


def _apply_search(q, search: str):
    """
    Recherche full-text case-insensitive via sous-requêtes simples compatibles SQLite.
    Champs : file_name, original_name, tags, filament_type, color_hex,
             filament.name, translated_name, material, manufacturer, color, profile_id
    """
    from sqlalchemy import or_, exists, and_, select as _sel
    from ....models.print_history import PrintTag as _PT, FilamentUsage as _FU
    from ....models.filament import Filament as _Fil, Spool as _Sp

    s = f"%{search}%"

    # 1. Champs directs du print
    direct = or_(
        Print.file_name.ilike(s),
        Print.original_name.ilike(s),
    )

    # 2. Tag
    tag_match = exists().where(
        and_(_PT.print_id == Print.id, _PT.tag.ilike(s))
    )

    # 3. filament_usage direct
    usage_match = exists().where(
        and_(
            _FU.print_id == Print.id,
            or_(_FU.filament_type.ilike(s), _FU.color_hex.ilike(s))
        )
    )

    # 4. Filament via spool — jointure plate sans EXISTS imbriqués
    fil_subq = (
        _sel(_FU.print_id)
        .join(_Sp, _Sp.id == _FU.spool_id)
        .join(_Fil, _Fil.id == _Sp.filament_id)
        .where(or_(
            _Fil.name.ilike(s),
            _Fil.translated_name.ilike(s),
            _Fil.material.ilike(s),
            _Fil.manufacturer.ilike(s),
            _Fil.color.ilike(s),
            _Fil.profile_id.ilike(s),
        ))
        .scalar_subquery()
    )
    spool_match = Print.id.in_(fil_subq)

    return q.where(or_(direct, tag_match, usage_match, spool_match))


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_prints(
    status:  Optional[str] = None,
    search:  Optional[str] = None,
    group:   Optional[str] = None,
    tag:     Optional[str] = None,
    limit:   int = Query(40, le=200),
    offset:  int = 0,
    _: str = Depends(get_current_user),
):
    """
    Retourne les prints paginés.
    Si un print appartient à un groupe, TOUS les prints de ce groupe sont inclus
    dans la réponse (pour éviter un groupe coupé entre deux pages).
    """
    from sqlalchemy import exists
    from ....models.print_history import PrintTag as _PT

    async with AsyncSessionLocal() as db:
        q = (select(Print)
             .options(selectinload(Print.filament_usage),
                      selectinload(Print.snapshots),
                      selectinload(Print.tags))
             .order_by(desc(Print.print_date)))
        if status:
            q = q.where(Print.status == status)
        if search:
            q = _apply_search(q, search)
        filter_tag = f"groupe:{group}" if group else tag
        if filter_tag:
            q = q.where(exists().where(
                (_PT.print_id == Print.id) & (_PT.tag == filter_tag)
            ))

        total = (await db.execute(
            select(func.count()).select_from(q.subquery())
        )).scalar()

        # Page courante
        rows = (await db.execute(q.offset(offset).limit(limit))).scalars().all()

        # Compléter les groupes :
        # 1. Si un print de la page appartient à un groupe → ramener tous les prints du groupe
        # 2. Si la recherche matche un nom de groupe → ramener tous les prints du groupe
        page_ids = {p.id for p in rows}
        page_groups: set[str] = set()

        for p in rows:
            for t in (p.tags or []):
                if t.tag.startswith("groupe:"):
                    page_groups.add(t.tag)

        # Si la recherche matche des noms de groupe → ajouter ces groupes aussi
        if search:
            from sqlalchemy import distinct as _distinct
            grp_result = await db.execute(
                select(_distinct(_PT.tag)).where(
                    _PT.tag.like("groupe:%"),
                    _PT.tag.ilike(f"%{search}%")
                )
            )
            for row_g in grp_result.all():
                page_groups.add(row_g[0])

        if page_groups:
            extra_q = (select(Print)
                .options(selectinload(Print.filament_usage),
                         selectinload(Print.snapshots),
                         selectinload(Print.tags))
                .where(
                    exists().where(
                        (_PT.print_id == Print.id) &
                        (_PT.tag.in_(list(page_groups)))
                    )
                )
                .where(Print.id.notin_(list(page_ids)))
                .order_by(desc(Print.print_date)))
            extra = (await db.execute(extra_q)).scalars().all()
            if extra:
                rows = list(rows) + extra

        await _enrich_filament_usage(db, rows)

    return {"total": total, "has_more": (offset + limit) < total,
            "next_offset": offset + limit,
            "prints": [_print_to_out(p) for p in rows]}


@router.get("/groups")
async def list_groups(_: str = Depends(get_current_user)):
    """Retourne les groupes disponibles (tags préfixés 'groupe:')."""
    from sqlalchemy import distinct
    from ....models.print_history import PrintTag as _PT
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(distinct(_PT.tag)).where(_PT.tag.like("groupe:%")).order_by(_PT.tag)
        )
        groups = [r[0].replace("groupe:", "") for r in result.all()]
    return {"groups": groups}



@router.get("/{print_id}")
async def get_print(print_id: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        p = (await db.execute(
            select(Print)
            .where(Print.id == print_id)
            .options(selectinload(Print.filament_usage),
                     selectinload(Print.snapshots),
                     selectinload(Print.tags))
        )).scalar_one_or_none()
    if not p: raise HTTPException(404, "Print introuvable")
    async with AsyncSessionLocal() as db2:
        await _enrich_filament_usage(db2, [p])
    return _print_to_out(p)


@router.patch("/{print_id}")
async def update_print(print_id: int, body: dict, _: str = Depends(get_current_user)):
    allowed = {"file_name","status","status_note","number_of_items",
                "sold_units","sold_price_total","margin","notes"}
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p: raise HTTPException(404)
        for k, v in body.items():
            if k in allowed: setattr(p, k, v)
        p.updated_at = datetime.utcnow()
        await db.commit()
    return {"ok": True}


@router.delete("/{print_id}")
async def delete_print(print_id: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p: raise HTTPException(404)
        await db.delete(p); await db.commit()
    # Supprimer les fichiers
    d = DATA_DIR / "prints" / str(print_id)
    if d.exists(): shutil.rmtree(d, ignore_errors=True)
    return {"ok": True}


@router.get("/{print_id}/image")
async def print_image(print_id: int):
    import mimetypes
    print_dir = DATA_DIR / "prints" / str(print_id)
    if not print_dir.exists():
        raise HTTPException(404)
    # plate.png en priorité, sinon première image trouvée
    for name in ("plate.png", "plate.jpg"):
        f = print_dir / name
        if f.exists():
            return FileResponse(str(f), media_type=f"image/{f.suffix[1:]}")
    for f in sorted(print_dir.iterdir()):
        if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
            mime = mimetypes.guess_type(str(f))[0] or "image/png"
            return FileResponse(str(f), media_type=mime)
    raise HTTPException(404)


@router.get("/{print_id}/file/{filename}")
async def print_file(print_id: int, filename: str):
    """Sert n'importe quel fichier du dossier d'un print."""
    import mimetypes
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    path = DATA_DIR / "prints" / str(print_id) / filename
    if not path.exists(): raise HTTPException(404)
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(str(path), media_type=mime)


@router.get("/{print_id}/snapshots")
async def print_snapshots_list(print_id: int):
    """Liste toutes les images du dossier d'un print (snapshots + vignettes importées)."""
    import mimetypes
    print_dir = DATA_DIR / "prints" / str(print_id)
    if not print_dir.exists():
        return {"files": []}
    files = []
    for f in sorted(print_dir.iterdir()):
        if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp") and f.name != "plate.png":
            files.append({"name": f.name, "url": f"/api/v1/prints/{print_id}/file/{f.name}"})
    return {"files": files}


@router.get("/{print_id}/snapshot/{trigger}")
async def print_snapshot(print_id: int, trigger: str):
    path = DATA_DIR / "prints" / str(print_id) / f"snapshot-{trigger}.jpg"
    if not path.exists(): raise HTTPException(404)
    return FileResponse(path, media_type="image/jpeg")


@router.post("/import")
async def import_print(
    file: UploadFile = File(...),
    print_date: Optional[str] = Form(None),
    _: str = Depends(get_current_user),
):
    """Import manuel d'un fichier .3mf."""
    from ....services.print_tracker import create_manual_print
    if not file.filename.endswith(".3mf"):
        raise HTTPException(400, "Fichier .3mf requis")
    tmp = DATA_DIR / "uploads" / file.filename
    tmp.parent.mkdir(parents=True, exist_ok=True)
    try:
        tmp.write_bytes(await file.read())
        dt = datetime.fromisoformat(print_date) if print_date else datetime.utcnow()
        pid = await create_manual_print(str(tmp), dt)
        if not pid: raise HTTPException(500, "Erreur import")
        return {"ok": True, "print_id": pid}
    finally:
        try: tmp.unlink()
        except Exception: pass


@router.delete("/{print_id}/snapshots/{snapshot_id}")
async def delete_snapshot(print_id: int, snapshot_id: int, _: str = Depends(get_current_user)):
    import os as _os
    async with AsyncSessionLocal() as db:
        s = await db.get(PrintSnapshot, snapshot_id)
        if not s or s.print_id != print_id:
            raise HTTPException(404)
        if s.file_path:
            p = DATA_DIR / s.file_path
            try: p.unlink(missing_ok=True)
            except Exception: pass
        await db.delete(s)
        await db.commit()
    return {"ok": True}


@router.post("/{print_id}/tags")
async def add_tag(print_id: int, body: dict, _: str = Depends(get_current_user)):
    tag = (body.get("tag") or "").strip()
    if not tag: raise HTTPException(400)
    async with AsyncSessionLocal() as db:
        db.add(PrintTag(print_id=print_id, tag=tag))
        await db.commit()
    return {"ok": True}


@router.delete("/{print_id}/tags/{tag}")
async def del_tag(print_id: int, tag: str, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PrintTag).where(PrintTag.print_id == print_id, PrintTag.tag == tag)
        )
        t = result.scalar_one_or_none()
        if t: await db.delete(t); await db.commit()
    return {"ok": True}


@router.get("/debug")
async def debug_prints():  # noqa — public debug route
    """Route de debug — dump brut de la table prints (pas d'auth requis)."""
    import aiosqlite, os
    db_path = os.getenv("DATABASE_URL", "sqlite+aiosqlite:////data/bambunymous.db")
    db_path = db_path.replace("sqlite+aiosqlite:///", "")
    rows = []
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT id,job_id,file_name,status,plate_image,model_3mf,created_at FROM prints ORDER BY id DESC LIMIT 20") as cur:
            async for row in cur:
                rows.append(dict(row))
        async with db.execute("SELECT name FROM sqlite_master WHERE type='table'") as cur:
            tables = [r[0] async for r in cur]
    return {"tables": tables, "prints": rows}


@router.post("/{print_id}/group")
async def set_group(print_id: int, body: dict, _: str = Depends(get_current_user)):
    """Assigne un print à un groupe (remplace l'ancien groupe si existant)."""
    group = (body.get("group") or "").strip()
    async with AsyncSessionLocal() as db:
        # Supprimer l'ancien groupe
        result = await db.execute(
            select(PrintTag).where(PrintTag.print_id == print_id, PrintTag.tag.like("groupe:%"))
        )
        for old in result.scalars().all():
            await db.delete(old)
        # Ajouter le nouveau si non vide
        if group:
            db.add(PrintTag(print_id=print_id, tag=f"groupe:{group}"))
        await db.commit()
    return {"ok": True}


@router.get("/stats/summary")
async def prints_stats(_: str = Depends(get_current_user)):
    """Statistiques globales — compat Spoolnymous."""
    async with AsyncSessionLocal() as db:
        total   = (await db.execute(select(func.count()).where(Print.status.in_(["SUCCESS","FAILED"])))).scalar()
        success = (await db.execute(select(func.count()).where(Print.status == "SUCCESS"))).scalar()
        weight  = (await db.execute(select(func.sum(Print.total_weight_g)).where(Print.status == "SUCCESS"))).scalar() or 0
        cost    = (await db.execute(select(func.sum(Print.total_cost)).where(Print.status == "SUCCESS"))).scalar() or 0
        dur     = (await db.execute(select(func.sum(Print.duration_seconds)).where(Print.status == "SUCCESS"))).scalar() or 0
    return {
        "total_prints":   total,
        "success_prints": success,
        "failed_prints":  total - success,
        "total_weight_g": round(weight, 1),
        "total_cost":     round(cost, 2),
        "total_hours":    round((dur or 0) / 3600, 1),
    }
