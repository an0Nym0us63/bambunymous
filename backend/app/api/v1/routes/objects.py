"""Routes API — Objets & Accessoires."""
import os
from pathlib import Path
from typing import Optional, List
from datetime import datetime
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
    sold_date: Optional[str] = None
    # Action explicite d'annulation de vente (remet dispo, efface prix + date).
    unsell: Optional[bool] = None

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

@router.get("/objects/stats")
async def objects_stats(_: str = Depends(get_current_user)):
    """Statistiques agregees sur les objets : inventaire, ventes, marge."""
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Object))).scalars().all()

    total = len(rows)
    sold = [o for o in rows if (o.sold_price or 0) > 0]
    available = [o for o in rows if o.available and (o.sold_price or 0) <= 0]
    personal = [o for o in rows if o.personal]

    revenue = sum((o.sold_price or 0) for o in sold)
    cost_sold = sum((o.cost_total or 0) for o in sold)
    margin = revenue - cost_sold
    stock_cost = sum((o.cost_total or 0) for o in available)
    potential = sum((o.desired_price or 0) for o in available)

    # Top objets par marge (vendus).
    def _m(o): return (o.sold_price or 0) - (o.cost_total or 0)
    top_margin = sorted(sold, key=_m, reverse=True)[:5]

    return {
        "total": total,
        "available": len(available),
        "sold": len(sold),
        "personal": len(personal),
        "revenue": round(revenue, 2),
        "cost_sold": round(cost_sold, 2),
        "margin": round(margin, 2),
        "margin_pct": round((margin / cost_sold * 100), 1) if cost_sold > 0 else 0,
        "stock_cost": round(stock_cost, 2),
        "potential_value": round(potential, 2),
        "top_margin": [
            {"id": o.id, "name": o.translated_name or o.name,
             "margin": round(_m(o), 2), "sold_price": o.sold_price}
            for o in top_margin
        ],
    }


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

        data = body.model_dump(exclude_none=True)

        # Annulation de vente : efface prix + date, remet disponible. Prioritaire.
        if data.pop("unsell", False):
            o.sold_price = None
            o.sold_date = None
            o.available = True

        # sold_date : chaine ISO -> datetime (SQLite exige un datetime).
        if "sold_date" in data:
            sd = str(data.pop("sold_date") or "").strip()
            if sd:
                try:
                    o.sold_date = datetime.fromisoformat(sd)
                except ValueError:
                    pass

        # Vendre : si un prix de vente est fourni (>0), on date la vente si absente
        # et on rend l'objet indisponible.
        if "sold_price" in data:
            sp = data["sold_price"]
            if sp and sp > 0:
                o.sold_price = sp
                o.available = False
                if o.sold_date is None:
                    o.sold_date = datetime.utcnow()
            else:
                o.sold_price = None  # 0 = pas vendu
            data.pop("sold_price")

        # Champs simples restants (name, translated_name, comment, group_id,
        # available, personal, desired_price).
        for k, v in data.items():
            setattr(o, k, v)

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

            # 3. Groupe sans photo -> on retombe sur la vignette d'un print du groupe :
            #    d'abord le print de couverture (cover_print_id), sinon le plus recent.
            if o.parent_type == "group":
                from ....models.print_history import Group as PGroup, Print
                grp = await db.get(PGroup, o.parent_id)
                cover_id = getattr(grp, "cover_print_id", None) if grp else None
                if cover_id:
                    img = _first_img(DATA_DIR / "prints" / str(cover_id))
                    if img: return FileResponse(str(img))
                # print le plus recent du groupe
                recent = (await db.execute(
                    select(Print).where(Print.group_id == o.parent_id)
                    .order_by(Print.print_date.desc()).limit(1)
                )).scalar_one_or_none()
                if recent:
                    img = _first_img(DATA_DIR / "prints" / str(recent.id))
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


# ── Créer un objet (depuis un print ou groupe) ───────────────────────────────
class ObjectCreate(BaseModel):
    parent_type: str          # "print" | "group"
    parent_id: int
    name: str
    translated_name: str = ""
    qty: int = 1              # nombre d'objets à créer
    cost_fabrication: float = 0.0
    cost_accessory: float = 0.0
    available: bool = True
    group_id: Optional[int] = None
    comment: Optional[str] = None

@router.post("/objects")
async def create_objects(body: ObjectCreate, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        from ....models.object_history import ObjectGroup
        # Vérifier la dispo (number_of_items - déjà créés)
        from sqlalchemy import select, func
        already = (await db.execute(
            select(func.count()).select_from(Object)
            .where(Object.parent_type == body.parent_type, Object.parent_id == body.parent_id)
        )).scalar() or 0
        # Récupérer number_of_items depuis Print ou Group
        from ....models.print_history import Print, Group as PGroup
        if body.parent_type == "print":
            src = await db.get(Print, body.parent_id)
            nb_items = src.number_of_items if src else 1
            cost_fab = body.cost_fabrication or (src.total_cost or 0)
        else:
            src = await db.get(PGroup, body.parent_id)
            nb_items = src.number_of_items if src else 1
            cost_fab = body.cost_fabrication
        
        n = min(body.qty, max(0, nb_items - already))
        if n <= 0:
            return {"created": 0, "message": f"Quota atteint ({already}/{nb_items})"}
        
        created_ids = []
        for _ in range(n):
            obj = Object(
                parent_type=body.parent_type,
                parent_id=body.parent_id,
                name=body.name,
                translated_name=body.translated_name or body.name,
                cost_fabrication=cost_fab,
                cost_accessory=body.cost_accessory,
                cost_total=cost_fab + body.cost_accessory,
                available=body.available,
                group_id=body.group_id,
                comment=body.comment,
            )
            db.add(obj)
            await db.flush()
            created_ids.append(obj.id)
        await db.commit()
        return {"created": n, "ids": created_ids}


# ── Supprimer un objet ───────────────────────────────────────────────────────
@router.delete("/objects/{oid}")
async def delete_object(oid: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        obj = await db.get(Object, oid)
        if not obj:
            raise HTTPException(404)
        await db.delete(obj)
        await db.commit()
        return {"ok": True}


# ── Accessoires d'un objet ───────────────────────────────────────────────────
@router.get("/objects/{oid}/accessories")
async def list_object_accessories(oid: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(ObjectAccessory, Accessory)
            .join(Accessory, ObjectAccessory.accessory_id == Accessory.id)
            .where(ObjectAccessory.object_id == oid)
        )).all()
        return [{"link_id": oa.id, "qty": oa.quantity,
                 "accessory_id": a.id, "name": a.name,
                 "unit_price": a.unit_price,
                 "unit_price_at_link": oa.unit_price_at_link,
                 "image_path": a.image_path}
                for oa, a in rows]


class LinkAccessory(BaseModel):
    accessory_id: int
    qty: int = 1

@router.post("/objects/{oid}/accessories")
async def link_accessory_to_object(oid: int, body: LinkAccessory, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        obj = await db.get(Object, oid)
        if not obj: raise HTTPException(404)
        acc = await db.get(Accessory, body.accessory_id)
        if not acc: raise HTTPException(404, "Accessoire introuvable")
        # Vérifier si déjà lié
        existing = (await db.execute(
            select(ObjectAccessory)
            .where(ObjectAccessory.object_id == oid, ObjectAccessory.accessory_id == body.accessory_id)
        )).scalar_one_or_none()
        if existing:
            existing.quantity += body.qty
        else:
            # Prix fige au moment du lien (comme Spoolnymous : unit_price_at_link).
            db.add(ObjectAccessory(object_id=oid, accessory_id=body.accessory_id,
                                   quantity=body.qty,
                                   unit_price_at_link=acc.unit_price or 0.0))
        # Recalcul coût accessoires sur le PRIX FIGE de chaque lien.
        all_links = (await db.execute(
            select(ObjectAccessory)
            .where(ObjectAccessory.object_id == oid)
        )).scalars().all()
        cost_acc = sum((oa.quantity * (oa.unit_price_at_link or 0)) for oa in all_links)
        obj.cost_accessory = cost_acc
        obj.cost_total = (obj.cost_fabrication or 0) + cost_acc
        await db.commit()
        return {"ok": True}


@router.delete("/objects/{oid}/accessories/{aid}")
async def unlink_accessory(oid: int, aid: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        lnk = (await db.execute(
            select(ObjectAccessory)
            .where(ObjectAccessory.object_id == oid, ObjectAccessory.accessory_id == aid)
        )).scalar_one_or_none()
        if not lnk: raise HTTPException(404)
        await db.delete(lnk)
        # Recalcul coût
        obj = await db.get(Object, oid)
        all_links = (await db.execute(
            select(ObjectAccessory, Accessory)
            .join(Accessory, ObjectAccessory.accessory_id == Accessory.id)
            .where(ObjectAccessory.object_id == oid)
        )).all()
        obj.cost_accessory = sum((oa.quantity * (oa.unit_price_at_link or 0)) for oa, a in all_links)
        obj.cost_total = (obj.cost_fabrication or 0) + obj.cost_accessory
        await db.commit()
        return {"ok": True}


# ── Créer / supprimer un accessoire ─────────────────────────────────────────
class AccessoryCreate(BaseModel):
    name: str
    quantity: int = 0
    unit_price: float = 0.0

@router.post("/accessories")
async def create_accessory(body: AccessoryCreate, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        acc = Accessory(name=body.name, quantity=body.quantity, unit_price=body.unit_price)
        db.add(acc); await db.flush(); await db.commit()
        return {"id": acc.id, "name": acc.name}

@router.delete("/accessories/{aid}")
async def delete_accessory(aid: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        acc = await db.get(Accessory, aid)
        if not acc: raise HTTPException(404)
        await db.delete(acc); await db.commit()
        return {"ok": True}

# ── Stock accessoire ─────────────────────────────────────────────────────────
class StockAdjust(BaseModel):
    qty: int
    total_price: float = 0.0  # coût du lot ajouté (recalcule unit_price moyen)

@router.post("/accessories/{aid}/stock")
async def adjust_accessory_stock(aid: int, body: StockAdjust, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        acc = await db.get(Accessory, aid)
        if not acc: raise HTTPException(404)
        if body.qty > 0 and body.total_price > 0:
            # Prix moyen pondéré
            old_total = acc.quantity * acc.unit_price
            new_qty = acc.quantity + body.qty
            acc.unit_price = (old_total + body.total_price) / new_qty
        acc.quantity = max(0, acc.quantity + body.qty)
        await db.commit()
        return {"id": acc.id, "quantity": acc.quantity, "unit_price": acc.unit_price}

# ── Créer groupe d'objets ────────────────────────────────────────────────────
class ObjectGroupCreate(BaseModel):
    name: str

@router.post("/object-groups")
async def create_object_group(body: ObjectGroupCreate, _: str = Depends(get_current_user)):
    from ....models.object_history import ObjectGroup
    async with AsyncSessionLocal() as db:
        g = ObjectGroup(name=body.name)
        db.add(g); await db.flush(); await db.commit()
        return {"id": g.id, "name": g.name}

@router.delete("/object-groups/{gid}")
async def delete_object_group(gid: int, _: str = Depends(get_current_user)):
    from ....models.object_history import ObjectGroup
    async with AsyncSessionLocal() as db:
        g = await db.get(ObjectGroup, gid)
        if not g: raise HTTPException(404)
        await db.delete(g); await db.commit()
        return {"ok": True}
