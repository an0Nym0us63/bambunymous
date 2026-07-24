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

# Les cinq etats possibles d'un objet. "gifted" manquait alors que Spoolnymous
# le gerait, et "unavailable" nomme enfin le cas qui grisait les tuiles sans
# aucune explication.
OBJECT_STATUSES = {"available", "sold", "gifted", "personal", "unavailable"}


class ObjectOut(BaseModel):
    id: int; external_ref: Optional[str]; name: str; translated_name: Optional[str]
    thumbnail: Optional[str]; comment: Optional[str]
    parent_type: Optional[str]; parent_id: Optional[int]
    group_id: Optional[int]; group_name: Optional[str]
    cost_fabrication: float; cost_accessory: float; cost_total: float
    normal_cost_unit: Optional[float]
    status: str = "available"
    available: bool; personal: bool
    sold_price: Optional[float]; sold_date: Optional[str]; desired_price: Optional[float]
    margin: Optional[float]
    accessories: List[dict] = []

class ObjectUpdate(BaseModel):
    name: Optional[str] = None; translated_name: Optional[str] = None
    comment: Optional[str] = None; group_id: Optional[int] = None
    status: Optional[str] = None
    available: Optional[bool] = None; personal: Optional[bool] = None
    sold_price: Optional[float] = None; desired_price: Optional[float] = None
    sold_date: Optional[str] = None
    # Action explicite d'annulation de vente (remet dispo, efface prix + date).
    unsell: Optional[bool] = None

class AccessoryOut(BaseModel):
    id: int; external_ref: Optional[str]; name: str
    quantity: int; unit_price: float; image_path: Optional[str]
    has_image: bool = False
    category: Optional[str] = None

class AccessoryUpdate(BaseModel):
    name: Optional[str] = None; quantity: Optional[int] = None
    unit_price: Optional[float] = None
    category: Optional[str] = None


def _acc_out(a: Accessory) -> AccessoryOut:
    img_dir = DATA_DIR / "accessories" / str(a.id)
    has_img = any(img_dir.iterdir()) if img_dir.exists() else False
    return AccessoryOut(id=a.id, external_ref=a.external_ref, name=a.name,
        category=a.category,
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
        status=o.status or "available",
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
        accs = (await db.execute(select(Accessory))).scalars().all()
        links = (await db.execute(select(ObjectAccessory))).scalars().all()

    # ── Accessoires ────────────────────────────────────────────────────────
    # Depuis le passage au modele "stock = disponible", quantity est ce qui
    # reste sur l'etagere et les liens representent ce qui est parti dans des
    # objets. Le patrimoine total est donc la somme des deux, et les separer
    # est la seule facon de repondre a "qu'est-ce que j'ai encore" sans
    # confondre avec "qu'est-ce que j'ai achete".
    used_by_acc: dict[int, int] = {}
    for lk in links:
        used_by_acc[lk.accessory_id] = used_by_acc.get(lk.accessory_id, 0) + (lk.quantity or 0)

    acc_stock_units = sum((a.quantity or 0) for a in accs)
    acc_used_units  = sum(used_by_acc.values())
    acc_stock_value = sum((a.quantity or 0) * (a.unit_price or 0) for a in accs)
    # Valeur engagee au prix FIGE au moment du lien, pas au prix courant : c'est
    # ce que l'objet a reellement coute, et c'est ce qui alimente sa marge.
    acc_used_value = sum((lk.quantity or 0) * (lk.unit_price_at_link or 0) for lk in links)

    # Rupture = plus rien en stock alors que l'accessoire sert quelque part.
    # Un accessoire a zero jamais utilise n'est pas une rupture, juste une fiche.
    acc_out = [a for a in accs if (a.quantity or 0) == 0 and used_by_acc.get(a.id, 0) > 0]

    def _acc_value(a):
        return (a.quantity or 0) * (a.unit_price or 0)

    accessories = {
        "count": len(accs),
        "stock_units": acc_stock_units,
        "used_units": acc_used_units,
        "stock_value": round(acc_stock_value, 2),
        "used_value": round(acc_used_value, 2),
        "total_value": round(acc_stock_value + acc_used_value, 2),
        "out_of_stock": len(acc_out),
        "out_of_stock_names": [a.name for a in acc_out][:8],
        "objects_with_accessories": len({lk.object_id for lk in links}),
        # Les plus immobilisants : la ou l'argent dort.
        "top_value": [
            {"id": a.id, "name": a.name, "qty": a.quantity or 0,
             "value": round(_acc_value(a), 2)}
            for a in sorted(accs, key=_acc_value, reverse=True)[:5]
            if _acc_value(a) > 0
        ],
        # Les plus employes : ceux qu'il ne faut jamais laisser tomber a zero.
        "top_used": [
            {"id": a.id, "name": a.name, "used": used_by_acc.get(a.id, 0)}
            for a in sorted(accs, key=lambda x: used_by_acc.get(x.id, 0), reverse=True)[:5]
            if used_by_acc.get(a.id, 0) > 0
        ],
    }

    total = len(rows)

    # Le STATUT fait foi depuis qu'il existe. Les comptes se deduisaient encore
    # des anciens champs, qui ne savent pas distinguer un objet offert d'un
    # objet indisponible : les cadeaux etaient donc comptes nulle part et le
    # camembert n'avait que trois parts pour cinq etats.
    def _st(o):
        if o.status:
            return o.status
        # Repli pour une base ou la reprise n'aurait pas encore tourne.
        if (o.sold_price or 0) > 0:  return "sold"
        if o.personal:               return "personal"
        if (o.sold_price is not None and o.sold_price == 0): return "gifted"
        if not o.available:          return "unavailable"
        return "available"

    by_status = {k: [] for k in ("available", "sold", "gifted", "personal", "unavailable")}
    for o in rows:
        by_status.setdefault(_st(o), []).append(o)

    sold        = by_status["sold"]
    available   = by_status["available"]
    personal    = by_status["personal"]
    gifted      = by_status["gifted"]
    unavailable = by_status["unavailable"]

    revenue = sum((o.sold_price or 0) for o in sold)
    cost_sold = sum((o.cost_total or 0) for o in sold)
    margin = revenue - cost_sold
    stock_cost = sum((o.cost_total or 0) for o in available)
    potential = sum((o.desired_price or 0) for o in available)
    # Ce que les objets sortis du circuit sans recette ont coute a produire :
    # c'est une depense reelle, invisible tant qu'on ne regarde que la marge.
    cost_gifted   = sum((o.cost_total or 0) for o in gifted)
    cost_personal = sum((o.cost_total or 0) for o in personal)

    # Top objets par marge (vendus).
    def _m(o): return (o.sold_price or 0) - (o.cost_total or 0)
    top_margin = sorted(sold, key=_m, reverse=True)[:5]

    return {
        "accessories": accessories,
        "total": total,
        "available": len(available),
        "sold": len(sold),
        "personal": len(personal),
        "gifted": len(gifted),
        "unavailable": len(unavailable),
        "cost_gifted": round(cost_gifted, 2),
        "cost_personal": round(cost_personal, 2),
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
        # Repartition par etat (pour un donut).
        # Cinq parts et non trois : chaque etat compte pour lui-meme, et la
        # somme retombe sur le total sans categorie fourre-tout.
        "state_split": [
            {"name": "À vendre",     "value": len(available)},
            {"name": "Vendus",       "value": len(sold)},
            {"name": "Offerts",      "value": len(gifted)},
            {"name": "Perso",        "value": len(personal)},
            {"name": "Indisponibles","value": len(unavailable)},
        ],
        # Origine des objets (print unique vs groupe).
        "by_parent": [
            {"name": "Depuis un print",  "value": len([o for o in rows if o.parent_type == "print"])},
            {"name": "Depuis un groupe", "value": len([o for o in rows if o.parent_type == "group"])},
        ],
        # Cout moyen de fabrication d'un objet.
        "avg_cost": round(sum((o.cost_total or 0) for o in rows) / total, 2) if total else 0,
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


@router.get("/objects/quota")
async def objects_quota(
    parent_type: str, parent_id: int,
    _: str = Depends(get_current_user),
):
    """
    Combien d'objets un print ou un groupe autorise-t-il encore.

    Le serveur plafonnait deja la creation, mais silencieusement : l'interface
    ne pouvait ni afficher le restant ni desactiver le bouton, si bien qu'on
    decouvrait la limite en la heurtant. Elle peut desormais le demander.
    """
    from ....models.print_history import Print, Group as PGroup
    async with AsyncSessionLocal() as db:
        if parent_type == "print":
            src = await db.get(Print, parent_id)
        else:
            src = await db.get(PGroup, parent_id)
        if not src:
            raise HTTPException(404, "Parent introuvable")
        nb_items = src.number_of_items or 1
        used = (await db.execute(
            select(func.count()).select_from(Object)
            .where(Object.parent_type == parent_type, Object.parent_id == parent_id)
        )).scalar() or 0
    return {"total": nb_items, "used": used, "remaining": max(0, nb_items - used)}


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
            o.status = "available"

        # Statut explicite. Les anciens champs restent tenus a jour en miroir :
        # ils alimentent encore des filtres et des statistiques, et les laisser
        # diverger du statut recreerait exactement l'incoherence qu'on corrige.
        if "status" in data:
            st = data.pop("status")
            if st not in OBJECT_STATUSES:
                raise HTTPException(400, f"Statut invalide : {st}")
            o.status = st
            o.personal  = (st == "personal")
            o.available = (st == "available")
            if st != "sold":
                # Quitter l'etat vendu efface le montant : le conserver
                # ferait apparaitre l'objet dans le chiffre d'affaires alors
                # qu'il n'est plus vendu.
                o.sold_price = None
                o.sold_date = None

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
                o.status = "sold"
                if o.sold_date is None:
                    o.sold_date = datetime.utcnow()
            else:
                o.sold_price = None  # 0 = pas vendu
                if o.status == "sold":
                    o.status = "available"
                    o.available = True
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


@router.get("/accessories/{aid}/detail")
async def accessory_detail(aid: int, _: str = Depends(get_current_user)):
    """Fiche accessoire : infos + objets qui l'utilisent."""
    async with AsyncSessionLocal() as db:
        a = await db.get(Accessory, aid)
        if not a: raise HTTPException(404)
        links = (await db.execute(
            select(ObjectAccessory, Object)
            .join(Object, Object.id == ObjectAccessory.object_id)
            .where(ObjectAccessory.accessory_id == aid)
        )).all()
    used_qty = sum((oa.quantity or 0) for oa, _o in links)
    out = _acc_out(a).model_dump()
    out.update({
        "created_at": str(a.created_at) if a.created_at else None,
        "updated_at": str(a.updated_at) if a.updated_at else None,
        "stock_value": round((a.quantity or 0) * (a.unit_price or 0), 2),
        "used_in_objects": len(links),
        "used_quantity": used_qty,
        "objects": [
            {"id": o.id, "name": o.translated_name or o.name,
             "quantity": oa.quantity,
             "unit_price_at_link": oa.unit_price_at_link}
            for oa, o in links
        ],
    })
    return out


@router.post("/accessories/{aid}/photo/upload")
async def upload_accessory_photo(
    aid: int,
    file: UploadFile = File(...),
    _: str = Depends(get_current_user),
):
    """Remplace la photo d'un accessoire (une seule photo par accessoire)."""
    import uuid as _uuid
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Fichier image requis")
    async with AsyncSessionLocal() as db:
        if not await db.get(Accessory, aid):
            raise HTTPException(404)
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    d = DATA_DIR / "accessories" / str(aid)
    d.mkdir(parents=True, exist_ok=True)
    # Une seule image par accessoire : on purge les anciennes.
    for f in list(d.iterdir()):
        if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            try: f.unlink()
            except Exception: pass
    dest = d / f"{_uuid.uuid4().hex[:12]}.{ext}"
    dest.write_bytes(await file.read())
    return {"ok": True, "filename": dest.name}


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
    # Creer plusieurs objets d'un coup pose une question que le quota ne
    # tranche pas : des unites independantes, ou un lot ? On la pose donc a
    # l'appelant plutot que de choisir a sa place.
    group_new: bool = False           # regrouper les objets crees dans un nouveau groupe
    group_name: Optional[str] = None  # nom de ce groupe (defaut : nom de l'objet)

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
        
        remaining = max(0, nb_items - already)
        if remaining <= 0:
            # 409 et non un 200 avec created:0 : l'appelant doit pouvoir
            # distinguer un refus d'un succes vide.
            raise HTTPException(409,
                f"Tous les objets de ce {'print' if body.parent_type == 'print' else 'groupe'} "
                f"ont deja ete crees ({already}/{nb_items}).")
        if body.qty > remaining:
            raise HTTPException(409,
                f"Il ne reste que {remaining} objet(s) a creer sur {nb_items}.")
        n = body.qty

        # Regroupement demande : le groupe est cree AVANT les objets pour que
        # chacun naisse deja rattache, plutot qu'en deux temps.
        target_group_id = body.group_id
        if body.group_new and n > 1:
            grp = ObjectGroup(name=(body.group_name or body.name or "Lot").strip())
            db.add(grp)
            await db.flush()
            target_group_id = grp.id
        
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
                group_id=target_group_id,
                comment=body.comment,
            )
            db.add(obj)
            await db.flush()
            created_ids.append(obj.id)
        await db.commit()
        return {"created": n, "ids": created_ids, "group_id": target_group_id}


# ── Supprimer un objet ───────────────────────────────────────────────────────
@router.delete("/objects/{oid}")
async def delete_object(oid: int, restock: str = "", _: str = Depends(get_current_user)):
    """
    Supprime un objet, en restituant au stock les accessoires choisis.

    `restock` : liste "accessory_id:qty" separee par des virgules, construite
    par la popup de confirmation. Ce qui n'y figure pas n'est pas remis en
    stock -- l'accessoire est considere comme parti avec l'objet (vendu, casse).
    Passer par un parametre plutot qu'un body : DELETE avec corps est
    inegalement supporte selon les clients HTTP.
    """
    wanted = {}
    for part in (restock or "").split(","):
        part = part.strip()
        if not part or ":" not in part:
            continue
        aid_s, qty_s = part.split(":", 1)
        try:
            aid, qty = int(aid_s), int(qty_s)
        except ValueError:
            continue
        if qty > 0:
            wanted[aid] = qty

    async with AsyncSessionLocal() as db:
        obj = await db.get(Object, oid)
        if not obj:
            raise HTTPException(404)

        if wanted:
            # On borne chaque restitution a ce que le lien portait reellement :
            # la popup pre-remplit avec cette quantite, mais une valeur trafiquee
            # cote client ne doit pas pouvoir gonfler le stock.
            links = (await db.execute(
                select(ObjectAccessory).where(ObjectAccessory.object_id == oid)
            )).scalars().all()
            linked_qty = {}
            for lk in links:
                linked_qty[lk.accessory_id] = linked_qty.get(lk.accessory_id, 0) + (lk.quantity or 0)
            for aid, qty in wanted.items():
                give = min(qty, linked_qty.get(aid, 0))
                if give <= 0:
                    continue
                acc = await db.get(Accessory, aid)
                if acc:
                    acc.quantity = (acc.quantity or 0) + give

        # La cascade FK supprime les ObjectAccessory : on lit AVANT de supprimer.
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
        # Le stock est le DISPONIBLE : lier prend sur l'etagere. On ne peut donc
        # pas lier plus qu'il n'en reste. 422 plutot que de laisser filer un
        # stock negatif, qui fausserait toutes les valorisations.
        if body.qty > (acc.quantity or 0):
            raise HTTPException(422,
                f"Stock insuffisant : {acc.quantity or 0} en stock, {body.qty} demandé(s)")
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
        # Sortie du stock, une fois le lien acquis.
        acc.quantity = (acc.quantity or 0) - body.qty
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
        # Delier rend au stock ce que le lien avait pris, sans rien demander :
        # c'est une action unitaire et deliberee.
        acc = await db.get(Accessory, aid)
        if acc:
            acc.quantity = (acc.quantity or 0) + (lnk.quantity or 0)
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
    category: Optional[str] = None
    name: str
    quantity: int = 0
    unit_price: float = 0.0

@router.get("/accessories/categories")
async def accessory_categories(_: str = Depends(get_current_user)):
    """
    Regroupements existants, avec leur effectif.

    Deduits de l'existant plutot que stockes dans une table : il n'y a donc
    rien a administrer, et un regroupement vide disparait de lui-meme.
    Declaree AVANT les routes en /accessories/{aid}, sinon "categories" serait
    pris pour un identifiant.
    """
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(Accessory.category, func.count(Accessory.id))
            .where(Accessory.category.isnot(None), Accessory.category != "")
            .group_by(Accessory.category)
        )).all()
    return sorted(
        [{"name": r[0], "count": int(r[1])} for r in rows],
        key=lambda x: x["name"].lower(),
    )


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
    # "add"   : reception d'un lot -> prix moyen pondere si total_price fourni
    # "remove": perte, casse, usage ailleurs -> quantite retiree, prix inchange
    # "set"   : correction d'inventaire -> nouvelle valeur absolue, prix inchange
    mode: str = "add"
    qty: int                       # add/remove : quantite ; set : ignore
    total_price: float = 0.0       # add uniquement
    new_quantity: Optional[int] = None   # set uniquement

@router.post("/accessories/{aid}/stock")
async def adjust_accessory_stock(aid: int, body: StockAdjust, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        acc = await db.get(Accessory, aid)
        if not acc: raise HTTPException(404)
        cur = acc.quantity or 0

        if body.mode == "set":
            # Definir une valeur absolue : correction d'inventaire. Le prix
            # unitaire NE bouge PAS -- on ne connait pas le prix de ce qui a ete
            # compte, on ne fait que rectifier le nombre.
            target = body.new_quantity if body.new_quantity is not None else cur
            acc.quantity = max(0, int(target))

        elif body.mode == "remove":
            # Retirer du stock : perte, casse, utilise ailleurs. On borne a ce
            # qui existe et le prix reste inchange -- retirer des unites ne
            # renseigne rien sur leur cout.
            acc.quantity = max(0, cur - abs(body.qty))

        else:  # "add"
            add = abs(body.qty)
            if add > 0 and body.total_price > 0:
                # Prix moyen pondere : (valeur existante + cout du lot) / total.
                old_value = cur * (acc.unit_price or 0)
                acc.unit_price = (old_value + body.total_price) / (cur + add)
            acc.quantity = cur + add

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
