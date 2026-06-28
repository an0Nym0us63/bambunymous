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

def _print_to_out(p: Print) -> dict:
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    d["filament_usage"] = [
        {c.name: getattr(u, c.name) for c in u.__table__.columns}
        for u in (p.filament_usage or [])
    ]
    d["snapshots"] = [
        {c.name: getattr(s, c.name) for c in s.__table__.columns}
        for s in (p.snapshots or [])
    ]
    d["tags"] = [t.tag for t in (p.tags or [])]
    return d


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_prints(
    status: Optional[str] = None,
    search: Optional[str] = None,
    limit:  int = Query(50, le=200),
    offset: int = 0,
    _: str = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        q = (select(Print)
             .options(selectinload(Print.filament_usage),
                      selectinload(Print.snapshots),
                      selectinload(Print.tags))
             .order_by(desc(Print.print_date)))
        if status:  q = q.where(Print.status == status)
        if search:  q = q.where(Print.file_name.ilike(f"%{search}%"))
        total_q = select(func.count()).select_from(q.subquery())
        total   = (await db.execute(total_q)).scalar()
        rows    = (await db.execute(q.offset(offset).limit(limit))).scalars().all()
    return {"total": total, "prints": [_print_to_out(p) for p in rows]}


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
async def print_image(print_id: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
    if not p or not p.plate_image: raise HTTPException(404)
    path = DATA_DIR / p.plate_image
    if not path.exists(): raise HTTPException(404)
    return FileResponse(path, media_type="image/png")


@router.get("/{print_id}/snapshot/{trigger}")
async def print_snapshot(print_id: int, trigger: str, _: str = Depends(get_current_user)):
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
async def debug_prints():
    """Route de debug — dump brut de la table prints."""
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
