"""Routes API — Objets & Accessoires."""
import os
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, desc, func
from sqlalchemy.orm import selectinload
from .auth import get_current_user
from ....models.object_history import Object, ObjectGroup, Accessory, ObjectAccessory
from ....db.session import AsyncSessionLocal

router = APIRouter()
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))


# ── Schemas ───────────────────────────────────────────────────────────────────

class ObjectOut(BaseModel):
    id: int; external_ref: Optional[str]; name: str; translated_name: Optional[str]
    thumbnail: Optional[str]; comment: Optional[str]
    parent_type: Optional[str]; parent_id: Optional[int]
    group_id: Optional[int]; group_name: Optional[str]
    cost_fabrication: float; cost_accessory: float; cost_total: float
    normal_cost_unit: Optional[float]
    available: bool; personal: bool
    sold_price: Optional[float]; sold_date: Optional[str]; desired_price: Optional[float]
    margin: Optional[float]
    accessories: List[dict] = []

class ObjectUpdate(BaseModel):
    name: Optional[str] = None; translated_name: Optional[str] = None
    comment: Optional[str] = None; group_id: Optional[int] = None
    available: Optional[bool] = None; personal: Optional[bool] = None
    sold_price: Optional[float] = None; desired_price: Optional[float] = None

class AccessoryOut(BaseModel):
    id: int; external_ref: Optional[str]; name: str
    quantity: int; unit_price: float; image_path: Optional[str]
    has_image: bool = False

class AccessoryUpdate(BaseModel):
    name: Optional[str] = None; quantity: Optional[int] = None
    unit_price: Optional[float] = None


def _acc_out(a: Accessory) -> AccessoryOut:
    img_dir = DATA_DIR / "accessories" / str(a.id)
    has_img = any(img_dir.iterdir()) if img_dir.exists() else False
    return AccessoryOut(id=a.id, external_ref=a.external_ref, name=a.name,
                        quantity=a.quantity, unit_price=a.unit_price,
                        image_path=a.image_path, has_image=has_img)


def _obj_out(o: Object) -> ObjectOut:
    return ObjectOut(
        id=o.id, external_ref=o.external_ref, name=o.name,
        translated_name=o.translated_name, thumbnail=o.thumbnail, comment=o.comment,
        parent_type=o.parent_type, parent_id=o.parent_id,
        group_id=o.group_id, group_name=o.group.name if o.group else None,
        cost_fabrication=o.cost_fabrication or 0, cost_accessory=o.cost_accessory or 0,
        cost_total=o.cost_total or 0, normal_cost_unit=o.normal_cost_unit,
        available=bool(o.available), personal=bool(o.personal),
        sold_price=o.sold_price, sold_date=str(o.sold_date) if o.sold_date else None,
        desired_price=o.desired_price, margin=o.margin,
        accessories=[{
            "id": oa.accessory_id, "name": oa.accessory.name if oa.accessory else "?",
            "quantity": oa.quantity, "unit_price_at_link": oa.unit_price_at_link,
            "total": oa.quantity * oa.unit_price_at_link,
        } for oa in (o.accessories or [])],
    )


# ── Objets ────────────────────────────────────────────────────────────────────

@router.get("/objects")
async def list_objects(
    q: str = Query(""), group_id: Optional[int] = None,
    available: Optional[bool] = None, personal: Optional[bool] = None,
    sold: Optional[bool] = None, limit: int = 100, offset: int = 0,
    _: str = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        stmt = select(Object).options(
            selectinload(Object.group),
            selectinload(Object.accessories).selectinload(ObjectAccessory.accessory),
        ).order_by(desc(Object.created_at))
        if q: stmt = stmt.where(Object.name.ilike(f"%{q}%"))
        if group_id is not None: stmt = stmt.where(Object.group_id == group_id)
        if available is not None: stmt = stmt.where(Object.available == available)
        if personal is not None: stmt = stmt.where(Object.personal == personal)
        if sold is True: stmt = stmt.where(Object.sold_price.isnot(None), Object.sold_price > 0)
        if sold is False: stmt = stmt.where((Object.sold_price.is_(None)) | (Object.sold_price == 0))
        total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
        rows = (await db.execute(stmt.offset(offset).limit(limit))).scalars().all()
    return {"total": total, "items": [_obj_out(o) for o in rows]}


@router.get("/objects/{oid}")
async def get_object(oid: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        o = (await db.execute(select(Object).options(
            selectinload(Object.group),
            selectinload(Object.accessories).selectinload(ObjectAccessory.accessory),
        ).where(Object.id == oid))).scalar_one_or_none()
        if not o: raise HTTPException(404)
    return _obj_out(o)


@router.patch("/objects/{oid}")
async def update_object(oid: int, body: ObjectUpdate, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        o = await db.get(Object, oid)
        if not o: raise HTTPException(404)
        for k, v in body.model_dump(exclude_none=True).items(): setattr(o, k, v)
        await db.commit()
    return {"ok": True}


@router.get("/objects/{oid}/image")
async def object_image(oid: int):
    IMG_EXT = {".jpg",".jpeg",".png",".webp"}

    def _first_img(d: Path):
        if d.exists():
            for f in sorted(d.iterdir()):
                if f.suffix.lower() in IMG_EXT:
                    return f
        return None

    # 1. Photo uploadée de l'objet
    img = _first_img(DATA_DIR / "objects" / str(oid))
    if img: return FileResponse(str(img))

    # 2. Photo du parent (print ou groupe)
    async with AsyncSessionLocal() as db:
        o = await db.get(Object, oid)
    if o and o.parent_type and o.parent_id:
        folder = "prints" if o.parent_type == "print" else "groups"
        img = _first_img(DATA_DIR / folder / str(o.parent_id))
        if img: return FileResponse(str(img))

    raise HTTPException(404)


# ── Groupes d'objets ──────────────────────────────────────────────────────────

@router.get("/object-groups")
async def list_object_groups(_: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(ObjectGroup).order_by(ObjectGroup.name))).scalars().all()
    return [{"id": g.id, "name": g.name, "desired_price": g.desired_price} for g in rows]


# ── Accessoires ───────────────────────────────────────────────────────────────

@router.get("/accessories")
async def list_accessories(q: str = Query(""), _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        stmt = select(Accessory).order_by(Accessory.name)
        if q: stmt = stmt.where(Accessory.name.ilike(f"%{q}%"))
        rows = (await db.execute(stmt)).scalars().all()
    return [_acc_out(a) for a in rows]


@router.patch("/accessories/{aid}")
async def update_accessory(aid: int, body: AccessoryUpdate, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        a = await db.get(Accessory, aid)
        if not a: raise HTTPException(404)
        for k, v in body.model_dump(exclude_none=True).items(): setattr(a, k, v)
        await db.commit()
    return {"ok": True}


@router.get("/accessories/{aid}/image")
async def accessory_image(aid: int):
    d = DATA_DIR / "accessories" / str(aid)
    if not d.exists(): raise HTTPException(404)
    for f in sorted(d.iterdir()):
        if f.suffix.lower() in (".jpg",".jpeg",".png",".webp"):
            return FileResponse(str(f))
    raise HTTPException(404)
