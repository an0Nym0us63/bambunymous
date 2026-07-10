"""
API REST — Historique des impressions.
"""
import os, shutil
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, desc, func
from sqlalchemy.orm import selectinload

from .auth import get_current_user
from ....models.print_history import Print, FilamentUsage, PrintSnapshot, PrintTag, Group
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
    total_cost_filament_normal: float = 0.0
    electric_cost: float; total_cost: float
    number_of_items: int; sold_units: int
    sold_price_total: Optional[float]; margin: float
    plate_id: str; design_id: Optional[str]; printer_model: str
    group_id: Optional[int] = None
    group_name: Optional[str] = None
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
        d["filament_name"]  = u._filament_name
    if hasattr(u, "_filament_brand"):
        d["filament_brand"] = u._filament_brand
    if hasattr(u, "_filament_translated"):
        d["filament_translated_name"] = u._filament_translated
    if hasattr(u, "_filament_fila_type"):
        d["filament_fila_type"] = u._filament_fila_type
    return d


def _print_to_out(p: Print) -> dict:
    d = {col.name: getattr(p, col.name) for col in p.__table__.columns}
    d["filament_usage"] = [_usage_to_dict(u) for u in (p.filament_usage or [])]
    d["snapshots"] = [
        {col.name: getattr(s, col.name) for col in s.__table__.columns}
        for s in (p.snapshots or [])
    ]
    d["tags"] = [t.tag for t in (p.tags or [])]
    d["group_name"] = p.group.name if p.group else None
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

    # Charger aussi les filaments par couleur+type pour les usages sans spool_id
    all_fils_r = await db.execute(select(Filament))
    all_fils = all_fils_r.scalars().all()
    # Index par couleur hex (sans #, lowercase)
    fil_by_color = {}
    for f in all_fils:
        if f.color:
            key = str(f.color).lstrip("#").lower()
            fil_by_color[key] = f

    for p in prints:
        for u in (p.filament_usage or []):
            fil = None
            if u.spool_id:
                spool = spools.get(u.spool_id)
                if spool:
                    fil = fils.get(spool.filament_id)
            if not fil and u.color_hex:
                # Fallback: chercher par couleur
                key = str(u.color_hex).lstrip("#").lower()
                fil = fil_by_color.get(key)
            if not fil: continue
            if not u.color_hex and fil.color:
                u.color_hex = f"#{fil.color}" if not str(fil.color).startswith("#") else fil.color
            if not u.filament_type and fil.material:
                u.filament_type = fil.material
            u._filament_name  = fil.name
            u._filament_brand = fil.manufacturer
            u._filament_translated = fil.translated_name
            u._filament_fila_type  = fil.fila_type


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
    status:   Optional[str] = None,
    search:   Optional[str] = None,
    group_id: Optional[int] = None,
    tag:      Optional[str] = None,
    limit:    int = Query(40, le=200),
    offset:   int = 0,
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
                      selectinload(Print.tags),
                      selectinload(Print.group))
             .order_by(desc(Print.print_date)))
        if status:
            q = q.where(Print.status == status)
        if search:
            q = _apply_search(q, search)
        if group_id is not None:
            q = q.where(Print.group_id == group_id)
        elif tag:
            q = q.where(exists().where(
                (_PT.print_id == Print.id) & (_PT.tag == tag)
            ))

        total = (await db.execute(
            select(func.count()).select_from(q.subquery())
        )).scalar()

        # Page courante
        rows = (await db.execute(q.offset(offset).limit(limit))).scalars().all()

        # Compléter les groupes :
        # 1. Si un print de la page appartient à un groupe → ramener tous les prints du groupe
        # 2. Si la recherche matche un nom de groupe → ramener tous les prints des groupes matchés
        page_ids = {p.id for p in rows}
        page_group_ids = {p.group_id for p in rows if p.group_id}

        if search:
            grp_result = await db.execute(
                select(Group.id).where(Group.name.ilike(f"%{search}%"))
            )
            for row_g in grp_result.all():
                page_group_ids.add(row_g[0])

        if page_group_ids:
            extra_q = (select(Print)
                .options(selectinload(Print.filament_usage),
                         selectinload(Print.snapshots),
                         selectinload(Print.tags),
                         selectinload(Print.group))
                .where(Print.group_id.in_(list(page_group_ids)))
                .where(Print.id.notin_(list(page_ids)))
                .order_by(desc(Print.print_date)))
            extra = (await db.execute(extra_q)).scalars().all()
            if extra:
                rows = list(rows) + extra

        await _enrich_filament_usage(db, rows)

    return {"total": total, "has_more": (offset + limit) < total,
            "next_offset": offset + limit,
            "prints": [_print_to_out(p) for p in rows]}


@router.get("/gallery")
async def prints_gallery(_: str = Depends(get_current_user)):
    """
    Galerie photo — INDÉPENDANTE de la pagination de /prints (parcourt tout
    l'historique, pas seulement la page courante). Ne retourne que les prints
    et groupes ayant de vraies photos (snapshots trigger='manual'), avec le
    carrousel complet de photos pour chacun. Les photos du dossier groupe
    lui-même (/data/groups/{id}/, uploads directs) sont aussi incluses.
    """
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(Print).options(selectinload(Print.snapshots), selectinload(Print.group))
        )).scalars().all()

    items, group_acc = [], {}
    for p in rows:
        manual = [s for s in (p.snapshots or []) if s.trigger == "manual"]
        photos = [
            {"url": f"/api/v1/prints/{p.id}/file/{(s.file_path or '').split('/')[-1]}", "label": s.trigger}
            for s in manual if s.file_path
        ]
        if p.group_id:
            acc = group_acc.setdefault(p.group_id, {
                "id": p.group_id,
                "name": (p.group.name if p.group else None) or f"Groupe #{p.group_id}",
                "number_of_items": (p.group.number_of_items if p.group else None) or 1,
                "prints": 0, "photos": [],
                "total_weight_g": 0.0, "total_cost_filament": 0.0,
                "electric_cost": 0.0, "total_cost": 0.0, "duration_seconds": 0.0,
                "latest_date": None,
            })
            acc["prints"]              += 1
            acc["photos"].extend(photos)
            acc["total_weight_g"]      += p.total_weight_g or 0
            acc["total_cost_filament"] += p.total_cost_filament or 0
            acc["electric_cost"]       += p.electric_cost or 0
            acc["total_cost"]          += p.total_cost or 0
            acc["duration_seconds"]    += p.duration_seconds or 0
            if not acc["latest_date"] or (p.print_date and p.print_date > acc["latest_date"]):
                acc["latest_date"] = p.print_date
        elif photos:
            nb = p.number_of_items or 1
            tc = p.total_cost or 0
            items.append({
                "id": p.id, "title": p.file_name or "Sans nom", "status": p.status,
                "print_date": p.print_date, "duration_seconds": p.duration_seconds,
                "total_weight_g": p.total_weight_g, "total_cost_filament": p.total_cost_filament or 0,
                "electric_cost": p.electric_cost or 0, "total_cost": tc,
                "number_of_items": nb,
                "cost_per_item": round(tc / nb, 2) if nb > 1 else None,
                "photos": photos,
            })

    # Photos uploadées directement dans le dossier du groupe (pas via un print précis)
    groups_dir = DATA_DIR / "groups"
    for gid, acc in group_acc.items():
        d = groups_dir / str(gid)
        if d.exists():
            for f in sorted(d.iterdir()):
                if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                    acc["photos"].append({"url": f"/api/v1/prints/groups/{gid}/photo/{f.name}", "label": f.name})

    groups = [
        {**g, "cost_per_item": round(g["total_cost"] / g["number_of_items"], 2) if g.get("number_of_items", 1) > 1 else None}
        for g in group_acc.values() if g["photos"]
    ]
    items.sort(key=lambda it: it["print_date"] or "", reverse=True)
    groups.sort(key=lambda g: g["latest_date"] or "", reverse=True)
    return {"prints": items, "groups": groups}


@router.get("/groups")
async def list_groups(_: str = Depends(get_current_user)):
    """Retourne les groupes (id BambuNymous + nom + nb de prints + date), pour distinguer
    deux groupes portant le même nom (créés à des dates différentes)."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Group).options(selectinload(Group.prints)).order_by(Group.name)
        )
        groups = []
        for g in result.scalars().all():
            dates = [p.print_date for p in (g.prints or []) if p.print_date]
            groups.append({
                "id": g.id, "name": g.name,
                "print_count": len(g.prints or []),
                "created_at": g.created_at,
                "latest_date": max(dates) if dates else g.created_at,
            })
    groups.sort(key=lambda g: g["latest_date"] or "", reverse=True)
    return {"groups": groups}


def _group_dir(group_id: int) -> Optional[Path]:
    """Dossier photos d'un groupe — rangé sous son id BambuNymous à l'import (cf. zip_importer.py)."""
    d = DATA_DIR / "groups" / str(group_id)
    return d if d.exists() else None


@router.get("/groups/{group_id}/photos")
async def group_photos(group_id: int):
    """Liste les photos d'un groupe."""
    d = _group_dir(group_id)
    if not d:
        return {"files": []}
    files = []
    for f in sorted(d.iterdir()):
        if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
            files.append({"name": f.name, "url": f"/api/v1/prints/groups/{group_id}/photo/{f.name}"})
    return {"files": files}


@router.get("/groups/{group_id}/photo/{filename}")
async def group_photo(group_id: int, filename: str):
    """Sert une photo de groupe (pas d'auth — utilisée dans des balises <img>)."""
    import mimetypes
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    d = _group_dir(group_id)
    if not d:
        raise HTTPException(404)
    path = d / filename
    if not path.exists():
        raise HTTPException(404)
    mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
    return FileResponse(str(path), media_type=mime)


@router.patch("/groups/{group_id}")
async def patch_group(group_id: int, body: dict = Body({}), _: str = Depends(get_current_user)):
    """Met à jour les champs éditables d'un groupe (name, number_of_items)."""
    allowed = {"name", "number_of_items", "cover_print_id"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "Aucun champ valide")
    async with AsyncSessionLocal() as db:
        g = await db.get(Group, group_id)
        if not g:
            raise HTTPException(404, "Groupe introuvable")
        for k, v in updates.items():
            setattr(g, k, v)
        await db.commit()
    return {"ok": True}




@router.get("/kpis")
async def prints_kpis(
    status: Optional[str] = None,
    search: Optional[str] = None,
    group_id: Optional[int] = None,
    _: str = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        from sqlalchemy import or_ as _or
        q = select(
            func.count(Print.id).label("count"),
            func.sum(func.coalesce(Print.duration_seconds, 0)).label("duration"),
            func.sum(func.coalesce(Print.total_weight_g, 0)).label("weight"),
            func.sum(func.coalesce(Print.total_cost, 0)).label("cost"),
        ).where(Print.status != "IN_PROGRESS")
        if status:   q = q.where(Print.status == status)
        if group_id: q = q.where(Print.group_id == group_id)
        if search:
            q = q.where(_or(
                Print.file_name.ilike(f"%{search}%"),
                Print.original_name.ilike(f"%{search}%"),
            ))
        r = (await db.execute(q)).one()
        return {"count": r.count or 0, "duration": int(r.duration or 0),
                "weight_g": float(r.weight or 0), "cost": round(float(r.cost or 0), 2)}

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




@router.get("/{print_id}/photos")
async def list_print_photos(print_id: int, _: str = Depends(get_current_user)):
    d = DATA_DIR / "prints" / str(print_id)
    if not d.exists(): return []
    return [{"filename": f.name, "url": f"/api/v1/prints/{print_id}/file/{f.name}"}
            for f in sorted(d.iterdir())
            if f.name.startswith("Photo-") and f.suffix.lower() in (".jpg",".jpeg",".png",".webp")]

@router.post("/{print_id}/photos/upload")
async def upload_print_photo(
    print_id: int,
    file: UploadFile = File(...),
    _: str = Depends(get_current_user),
):
    import subprocess as _sp, tempfile as _tf, os as _os
    from ....models.print_history import PrintSnapshot as _PS
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Fichier image requis")
    d = DATA_DIR / "prints" / str(print_id)
    d.mkdir(parents=True, exist_ok=True)
    raw = await file.read()
    orig_ext = (file.filename or "photo.jpg").rsplit(".", 1)[-1].lower()
    # Numéroter Photo-01, 02... (même convention que zip_importer)
    idx = 1
    while (d / f"Photo-{idx:02d}.webp").exists() or (d / f"Photo-{idx:02d}.{orig_ext}").exists():
        idx += 1
    dest = d / f"Photo-{idx:02d}.webp"
    try:
        with _tf.NamedTemporaryFile(delete=False, suffix="." + orig_ext) as tmp:
            tmp.write(raw); tmp_path = tmp.name
        _sp.run([
            "ffmpeg", "-y", "-i", tmp_path,
            "-vf", "scale='min(800,iw)':'min(800,ih)':force_original_aspect_ratio=decrease",
            "-quality", "80", "-compression_level", "6", str(dest)
        ], check=True, capture_output=True, timeout=30)
        _os.unlink(tmp_path)
    except Exception:
        dest = d / f"Photo-{idx:02d}.{orig_ext}"
        dest.write_bytes(raw)
    # Créer PrintSnapshot en DB (trigger=manual) pour apparaître dans la galerie
    rel_path = f"prints/{print_id}/{dest.name}"
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select as _sel
        existing = (await db.execute(
            _sel(_PS).where(_PS.print_id == print_id, _PS.file_path == rel_path)
        )).scalar_one_or_none()
        if not existing:
            db.add(_PS(print_id=print_id, trigger="manual", file_path=rel_path))
            await db.commit()
    return {"ok": True, "filename": dest.name, "url": f"/api/v1/prints/{print_id}/file/{dest.name}"}


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



@router.get("/{print_id}/upload/{filename}")
async def print_upload_file(print_id: int, filename: str):
    """Sert les fichiers uploadés du dossier uploads d'un print."""
    import mimetypes
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    path = DATA_DIR / "prints" / str(print_id) / "uploads" / filename
    if not path.exists(): raise HTTPException(404)
    mime = mimetypes.guess_type(str(path))[0] or "image/webp"
    return FileResponse(str(path), media_type=mime)

@router.delete("/{print_id}/upload/{filename}")
async def delete_print_upload(print_id: int, filename: str, _: str = Depends(get_current_user)):
    """Supprime une photo uploadée (Photo-*.webp) + son PrintSnapshot en DB."""
    from ....models.print_history import PrintSnapshot as _PS
    from sqlalchemy import select as _sel
    if ".." in filename or "/" in filename or not filename.startswith("Photo-"):
        raise HTTPException(400)
    path = DATA_DIR / "prints" / str(print_id) / filename
    if not path.exists():
        raise HTTPException(404)
    path.unlink()
    rel_path = f"prints/{print_id}/{filename}"
    async with AsyncSessionLocal() as db:
        snap = (await db.execute(
            _sel(_PS).where(_PS.print_id == print_id, _PS.file_path == rel_path)
        )).scalar_one_or_none()
        if snap:
            await db.delete(snap)
            await db.commit()
    return {"ok": True}

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


@router.post("/group/bulk")
async def set_group_bulk(body: dict, _: str = Depends(get_current_user)):
    """
    Assigne plusieurs prints au même groupe en un seul appel (évite de créer
    un nouveau groupe par print lors d'une sélection multiple).
    body: {"print_ids": [1,2,3], "group_id": 12} pour un groupe existant,
          {"print_ids": [1,2,3], "group_name": "Nouveau nom"} pour en créer un nouveau,
          {"print_ids": [1,2,3]} (sans group_id/group_name) pour retirer du groupe.
    """
    print_ids  = body.get("print_ids") or []
    group_id   = body.get("group_id")
    group_name = (body.get("group_name") or "").strip()
    if not print_ids:
        raise HTTPException(400, "print_ids requis")

    async with AsyncSessionLocal() as db:
        target_gid = None
        if group_id:
            g = await db.get(Group, int(group_id))
            if not g:
                raise HTTPException(404, "Groupe introuvable")
            target_gid = g.id
        elif group_name:
            g = Group(name=group_name)
            db.add(g)
            await db.flush()
            target_gid = g.id

        updated = 0
        for pid in print_ids:
            p = await db.get(Print, int(pid))
            if p:
                p.group_id = target_gid
                updated += 1
        await db.commit()
    return {"ok": True, "group_id": target_gid, "updated": updated}


@router.post("/{print_id}/group")
async def set_group(print_id: int, body: dict, _: str = Depends(get_current_user)):
    """
    Assigne un print à un groupe.
    body: {"group_id": 12} pour un groupe existant,
          {"group_name": "Nouveau nom"} pour en créer un nouveau,
          {} ou group_id=null pour retirer le print de son groupe.
    """
    group_id   = body.get("group_id")
    group_name = (body.get("group_name") or "").strip()

    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p:
            raise HTTPException(404)

        if group_id:
            g = await db.get(Group, int(group_id))
            if not g:
                raise HTTPException(404, "Groupe introuvable")
            p.group_id = g.id
        elif group_name:
            g = Group(name=group_name)
            db.add(g)
            await db.flush()
            p.group_id = g.id
        else:
            p.group_id = None

        await db.commit()
    return {"ok": True, "group_id": p.group_id}


@router.get("/stats/summary")
async def prints_stats(_: str = Depends(get_current_user)):
    from ....models.filament import Spool, Filament as _Fil
    async with AsyncSessionLocal() as db:
        ok = Print.status == "SUCCESS"
        total   = (await db.execute(select(func.count()).where(Print.status.in_(["SUCCESS","FAILED"])))).scalar() or 0
        success = (await db.execute(select(func.count()).where(ok))).scalar() or 0
        weight  = (await db.execute(select(func.sum(Print.total_weight_g)).where(ok))).scalar() or 0
        cost    = (await db.execute(select(func.sum(Print.total_cost)).where(ok))).scalar() or 0
        dur     = (await db.execute(select(func.sum(Print.duration_seconds)).where(ok))).scalar() or 0
        dur_cnt = (await db.execute(select(func.count()).where(ok, Print.duration_seconds > 0))).scalar() or 0

        # Durée avec fallback estimated_seconds
        dur_col = func.coalesce(Print.duration_seconds, Print.estimated_seconds)
        top_dur = (await db.execute(
            select(Print.id, Print.file_name, dur_col.label("dur_s"), Print.total_cost, Print.print_date)
            .where(ok).order_by(dur_col.desc()).limit(5)
        )).all()

        top_cost = (await db.execute(
            select(Print.id, Print.file_name, Print.total_cost, dur_col.label("dur_s"), Print.print_date)
            .where(ok, Print.total_cost > 0).order_by(Print.total_cost.desc()).limit(5)
        )).all()

        all_p = (await db.execute(
            select(Print.print_date, Print.total_cost, Print.total_weight_g)
            .where(ok, Print.print_date.isnot(None)).order_by(Print.print_date)
        )).all()

        monthly = {}
        for row in all_p:
            key = str(row.print_date)[:7]
            if not key or key == "None": continue
            if key not in monthly: monthly[key] = {"count":0,"cost":0.0,"weight_g":0.0}
            monthly[key]["count"]    += 1
            monthly[key]["cost"]     += float(row.total_cost or 0)
            monthly[key]["weight_g"] += float(row.total_weight_g or 0)

        mat_rows = (await db.execute(
            select(_Fil.material, func.sum(FilamentUsage.grams_used).label("grams"))
            .join(Spool, FilamentUsage.spool_id == Spool.id)
            .join(_Fil, Spool.filament_id == _Fil.id)
            .where(_Fil.material.isnot(None), FilamentUsage.grams_used > 0)
            .group_by(_Fil.material).order_by(desc("grams")).limit(10)
        )).all()

        if not mat_rows:
            mat_rows = (await db.execute(
                select(FilamentUsage.filament_type, func.sum(FilamentUsage.grams_used).label("grams"))
                .where(FilamentUsage.filament_type.isnot(None), FilamentUsage.grams_used > 0)
                .group_by(FilamentUsage.filament_type).order_by(desc("grams")).limit(10)
            )).all()

        brand_rows = (await db.execute(
            select(_Fil.manufacturer, func.sum(FilamentUsage.grams_used).label("grams"))
            .join(Spool, FilamentUsage.spool_id == Spool.id)
            .join(_Fil, Spool.filament_id == _Fil.id)
            .where(_Fil.manufacturer.isnot(None), FilamentUsage.grams_used > 0)
            .group_by(_Fil.manufacturer).order_by(desc("grams")).limit(8)
        )).all()

        def _p(r):
            return {
                "id": r.id,
                "name": (r.file_name or "?").rstrip(".3mf").strip("."),
                "duration_s": float(r.dur_s or 0),
                "cost": round(float(r.total_cost or 0), 2),
                "date": str(r.print_date)[:10] if r.print_date else None,
            }

        return {
            "total_prints":   total,
            "success_prints": success,
            "failed_prints":  total - success,
            "total_weight_g": round(float(weight), 1),
            "total_cost":     round(float(cost), 2),
            "total_hours":    round(float(dur or 0) / 3600, 1),
            "avg_cost":       round(float(cost)/success, 2) if success else 0,
            "avg_duration_h": round(float(dur)/dur_cnt/3600, 2) if dur and dur_cnt else 0,
            "top_duration":   [_p(r) for r in top_dur],
            "top_cost":       [_p(r) for r in top_cost],
            "monthly":        {k: monthly[k] for k in sorted(monthly)[-24:]},
            "materials":      [{"name": getattr(r,"material",None) or getattr(r,"filament_type","?"),
                                "grams": round(float(r.grams or 0))} for r in mat_rows],
            "brands":         [{"name": r.manufacturer,
                                "grams": round(float(r.grams or 0))} for r in brand_rows],
        }

@router.post("/recalculate-all")
async def recalculate_all_prints(_: str = Depends(get_current_user)):
    """Recalcule les coûts de tous les prints terminés (filament override + normal + électricité).
    Les groupes sont calculés à la volée → se mettent à jour automatiquement.
    """
    import threading, asyncio as _aio
    def _run():
        loop = _aio.new_event_loop()
        async def _go():
            from ....services.print_tracker import recalculate_print
            async with AsyncSessionLocal() as db:
                pids = (await db.execute(
                    select(Print.id).where(Print.status.in_(["SUCCESS","FAILED","IN_PROGRESS"]))
                )).scalars().all()
            total = len(pids)
            for i, pid in enumerate(pids, 1):
                await recalculate_print(pid)
                if i % 10 == 0:
                    import logging; logging.getLogger(__name__).info(f"[RECALC] {i}/{total} prints recalculés...")
        try: loop.run_until_complete(_go())
        finally: loop.close()
    threading.Thread(target=_run, daemon=True).start()
    return {"ok": True, "message": "Recalcul lancé en arrière-plan"}
