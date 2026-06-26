from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from ....db.session import get_db
from ....models.filament import Filament, Spool
from .auth import get_current_user

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class FilamentOut(BaseModel):
    id: int
    name: str
    manufacturer: Optional[str]
    material: str
    color: Optional[str]
    multicolor_type: str
    colors_array: Optional[str]
    price: Optional[float]
    filament_weight_g: float
    spool_weight_g: Optional[float]
    profile_id: Optional[str]
    swatch: bool
    transparent: bool
    to_order: bool
    spool_count: int = 0
    active_spool_count: int = 0

class FilamentCreate(BaseModel):
    name: str
    manufacturer: Optional[str] = None
    material: str = "PLA"
    color: Optional[str] = None
    multicolor_type: str = "monochrome"
    colors_array: Optional[str] = None
    price: Optional[float] = None
    filament_weight_g: float = 1000.0
    spool_weight_g: Optional[float] = None
    profile_id: Optional[str] = None
    swatch: bool = False
    transparent: bool = False
    to_order: bool = False
    comment: Optional[str] = None

class SpoolOut(BaseModel):
    id: int
    filament_id: int
    filament_name: str
    filament_manufacturer: Optional[str]
    filament_material: str
    filament_color: Optional[str]
    remaining_weight_g: Optional[float]
    price_override: Optional[float]
    location: Optional[str]
    tag_number: Optional[str]
    archived: bool
    comment: Optional[str]
    last_used_at: Optional[datetime]
    created_at: datetime

class SpoolCreate(BaseModel):
    filament_id: int
    remaining_weight_g: Optional[float] = None
    price_override: Optional[float] = None
    location: Optional[str] = None
    tag_number: Optional[str] = None
    comment: Optional[str] = None

class SpoolUpdate(BaseModel):
    remaining_weight_g: Optional[float] = None
    price_override: Optional[float] = None
    location: Optional[str] = None
    tag_number: Optional[str] = None
    comment: Optional[str] = None
    archived: Optional[bool] = None


# ── Filaments ─────────────────────────────────────────────────────────────────

@router.get("/filaments", response_model=list[FilamentOut])
async def list_filaments(
    q: Optional[str] = Query(None),
    material: Optional[str] = Query(None),
    manufacturer: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    stmt = select(Filament).options(selectinload(Filament.spools))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(
            Filament.name.ilike(like),
            Filament.manufacturer.ilike(like),
            Filament.material.ilike(like),
        ))
    if material:
        stmt = stmt.where(Filament.material == material)
    if manufacturer:
        stmt = stmt.where(Filament.manufacturer == manufacturer)
    stmt = stmt.order_by(Filament.manufacturer, Filament.name)
    result = await db.execute(stmt)
    filaments = result.scalars().all()
    return [_fil_out(f) for f in filaments]


@router.post("/filaments", response_model=FilamentOut, status_code=201)
async def create_filament(
    body: FilamentCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    f = Filament(**body.model_dump())
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _fil_out(f)


@router.patch("/filaments/{fid}", response_model=FilamentOut)
async def update_filament(
    fid: int,
    body: FilamentCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    result = await db.execute(
        select(Filament).options(selectinload(Filament.spools)).where(Filament.id == fid)
    )
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Filament introuvable")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(f, k, v)
    await db.commit()
    return _fil_out(f)


# ── Spools (Bobines) ──────────────────────────────────────────────────────────

@router.get("/spools", response_model=list[SpoolOut])
async def list_spools(
    archived: bool = Query(False),
    filament_id: Optional[int] = Query(None),
    location: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    stmt = (
        select(Spool)
        .options(selectinload(Spool.filament))
        .where(Spool.archived == archived)
    )
    if filament_id:
        stmt = stmt.where(Spool.filament_id == filament_id)
    if location:
        stmt = stmt.where(Spool.location == location)
    if q:
        like = f"%{q}%"
        stmt = stmt.join(Filament).where(or_(
            Filament.name.ilike(like),
            Filament.material.ilike(like),
            Spool.location.ilike(like),
            Spool.tag_number.ilike(like),
        ))
    stmt = stmt.order_by(Spool.last_used_at.desc().nullslast())
    result = await db.execute(stmt)
    return [_spool_out(s) for s in result.scalars().all()]


@router.post("/spools", response_model=SpoolOut, status_code=201)
async def create_spool(
    body: SpoolCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    # Vérifier que le filament existe
    fil = await db.get(Filament, body.filament_id)
    if not fil:
        raise HTTPException(404, "Filament introuvable")
    s = Spool(**body.model_dump())
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _spool_out(await _load_spool(db, s.id))


@router.patch("/spools/{sid}", response_model=SpoolOut)
async def update_spool(
    sid: int,
    body: SpoolUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    s = await _load_spool(db, sid)
    if not s:
        raise HTTPException(404, "Bobine introuvable")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    await db.commit()
    return _spool_out(await _load_spool(db, sid))


@router.delete("/spools/{sid}", status_code=204)
async def archive_spool(
    sid: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    s = await db.get(Spool, sid)
    if not s:
        raise HTTPException(404, "Bobine introuvable")
    s.archived = True
    await db.commit()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _load_spool(db, sid):
    result = await db.execute(
        select(Spool).options(selectinload(Spool.filament)).where(Spool.id == sid)
    )
    return result.scalar_one_or_none()


def _fil_out(f: Filament) -> FilamentOut:
    active = [s for s in f.spools if not s.archived]
    return FilamentOut(
        id=f.id, name=f.name, manufacturer=f.manufacturer, material=f.material,
        color=f.color, multicolor_type=f.multicolor_type, colors_array=f.colors_array,
        price=f.price, filament_weight_g=f.filament_weight_g, spool_weight_g=f.spool_weight_g,
        profile_id=f.profile_id, swatch=f.swatch, transparent=f.transparent, to_order=f.to_order,
        spool_count=len(f.spools), active_spool_count=len(active),
    )


def _spool_out(s: Spool) -> SpoolOut:
    f = s.filament
    return SpoolOut(
        id=s.id, filament_id=s.filament_id,
        filament_name=f.name if f else "?",
        filament_manufacturer=f.manufacturer if f else None,
        filament_material=f.material if f else "?",
        filament_color=f.color if f else None,
        remaining_weight_g=s.remaining_weight_g,
        price_override=s.price_override,
        location=s.location, tag_number=s.tag_number,
        archived=s.archived, comment=s.comment,
        last_used_at=s.last_used_at, created_at=s.created_at,
    )
