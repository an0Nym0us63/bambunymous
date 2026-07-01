from fastapi.responses import FileResponse
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import os
from pathlib import Path
from ....db.session import get_db, AsyncSessionLocal
from ....models.filament import Filament, Spool
from ....models.print_history import FilamentUsage
from .auth import get_current_user

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))

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
    photo_url: Optional[str] = None
    photos: list[str] = []

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
    # Filament catalogue
    filament_name: str
    filament_translated_name: Optional[str] = None
    filament_manufacturer: Optional[str] = None
    filament_material: str
    filament_color: Optional[str] = None
    filament_weight_g: Optional[float] = None
    filament_spool_weight_g: Optional[float] = None
    filament_price: Optional[float] = None
    filament_profile_id: Optional[str] = None
    filament_multicolor_type: Optional[str] = None
    filament_colors_array: Optional[str] = None
    filament_external_id: Optional[str] = None
    # Bobine physique
    remaining_weight_g: Optional[float] = None
    price_override: Optional[float] = None
    location: Optional[str] = None
    tag_number: Optional[str] = None
    ams_tray: Optional[str] = None
    archived: bool
    comment: Optional[str] = None
    external_spool_id: Optional[str] = None
    found_mode: Optional[str] = None
    first_used_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
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


def _fil_photos(fid: int) -> list[str]:
    """Toutes les photos du dossier /data/filaments/{id}/."""
    d = DATA_DIR / "filaments" / str(fid)
    if not d.exists():
        return []
    return [
        f"/api/v1/filaments/{fid}/photo/{f.name}"
        for f in sorted(d.iterdir())
        if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif")
    ]


def _fil_out(f: Filament) -> FilamentOut:
    active = [s for s in f.spools if not s.archived]
    photos = _fil_photos(f.id)
    return FilamentOut(
        id=f.id, name=f.name, manufacturer=f.manufacturer, material=f.material,
        color=f.color, multicolor_type=f.multicolor_type, colors_array=f.colors_array,
        price=f.price, filament_weight_g=f.filament_weight_g, spool_weight_g=f.spool_weight_g,
        profile_id=f.profile_id, swatch=f.swatch, transparent=f.transparent, to_order=f.to_order,
        spool_count=len(f.spools), active_spool_count=len(active),
        photo_url=(photos[0] if photos else None), photos=photos,
    )


def _spool_out(s: Spool) -> SpoolOut:
    f = s.filament
    return SpoolOut(
        id=s.id, filament_id=s.filament_id,
        filament_name=f.name if f else "?",
        filament_translated_name=getattr(f, "translated_name", None) if f else None,
        filament_manufacturer=f.manufacturer if f else None,
        filament_material=f.material if f else "?",
        filament_color=f.color if f else None,
        filament_weight_g=f.filament_weight_g if f else None,
        filament_spool_weight_g=f.spool_weight_g if f else None,
        filament_price=f.price if f else None,
        filament_profile_id=f.profile_id if f else None,
        filament_multicolor_type=f.multicolor_type if f else None,
        filament_colors_array=f.colors_array if f else None,
        filament_external_id=f.external_filament_id if f else None,
        remaining_weight_g=s.remaining_weight_g,
        price_override=s.price_override,
        location=s.location,
        tag_number=s.tag_number,
        ams_tray=s.ams_tray,
        archived=s.archived,
        comment=s.comment,
        external_spool_id=s.external_spool_id,
        found_mode=getattr(s, "found_mode", None),
        first_used_at=s.first_used_at,
        last_used_at=s.last_used_at,
        created_at=s.created_at,
    )


@router.get("/map-tray/suggest")
async def map_tray_suggest(
    color: Optional[str] = None,
    tray_has_rfid: bool = False,  # True si le tray a un tag RFID valide (= Bambu Lab)
    _: str = Depends(get_current_user),
):
    """
    Suggestions de bobines pour mapper un tray non reconnu, sans tag RFID en base.
    Si tray_has_rfid=true → le filament est Bambu Lab → on ne montre que les bobines
    dont le filament associé a manufacturer='Bambu Lab' (ou sans marque renseignée).
    Si tray_has_rfid=false → filament tiers → on exclut les bobines Bambu Lab.
    Triées par couleur la plus proche.
    """
    import math
    def rgb(h: str):
        h = (h or "").strip().lstrip("#")
        try: return int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
        except: return (128,128,128)
    def dist(a, b): return math.sqrt(sum((x-y)**2 for x,y in zip(rgb(a), rgb(b))))

    def no_rfid(tag) -> bool:
        t = (tag or "").strip()
        return not t or t == "0" or all(c == "0" for c in t) or t.lower() in ("none", "null")

    def is_bambu(spool) -> bool:
        m = (spool.filament.manufacturer or "").strip().lower() if spool.filament else ""
        return "bambu" in m

    tray_color = (color or "").strip().lstrip("#")

    async with AsyncSessionLocal() as db:
        q = select(Spool).options(selectinload(Spool.filament)).where(Spool.archived == False)
        all_spools = (await db.execute(q)).scalars().all()

        # 1. Garder uniquement les bobines sans RFID en base
        candidates = [s for s in all_spools if no_rfid(s.tag_number)]

        # 2. Filtrer par marque selon la nature du tray
        if tray_has_rfid:
            # Tray Bambu → uniquement bobines Bambu Lab (ou sans marque)
            candidates = [s for s in candidates if is_bambu(s) or not (s.filament and s.filament.manufacturer)]
        else:
            # Tray tiers → exclure les bobines Bambu Lab
            candidates = [s for s in candidates if not is_bambu(s)]

        # 3. Trier par couleur la plus proche
        candidates.sort(key=lambda s: dist(tray_color, (s.filament.color or "") if s.filament else ""))

        result = [_spool_out(s) for s in candidates]

    return {"spools": result}


@router.post("/map-tray/link")
async def map_tray_link(body: dict, _: str = Depends(get_current_user)):
    """
    Mappe un tray non reconnu sur une bobine existante : renseigne tag_number
    et profile_id sur la bobine et son filament pour que les prochains matchings
    l'identifient automatiquement.
    body: {spool_id, tag_uid, profile_id, color}
    """
    spool_id  = body.get("spool_id")
    tag_uid   = (body.get("tag_uid") or "").strip()
    prof      = (body.get("profile_id") or "").strip()
    color_hex = (body.get("color") or "").strip().lstrip("#")

    if not spool_id:
        raise HTTPException(400, "spool_id requis")

    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Spool).options(selectinload(Spool.filament)).where(Spool.id == int(spool_id))
        )
        s = res.scalar_one_or_none()
        if not s: raise HTTPException(404, "Bobine introuvable")

        changes = []
        if tag_uid and not s.tag_number:
            s.tag_number = tag_uid
            changes.append(f"Tag RFID ajouté sur la bobine #{s.id} ({tag_uid[:8]}…)")
        elif tag_uid and s.tag_number:
            changes.append(f"Tag RFID déjà renseigné sur la bobine (inchangé)")

        f = s.filament
        filament_name = f.name if f else "?"
        if f:
            if prof and not f.profile_id:
                f.profile_id = prof
                changes.append(f"Profile ID {prof!r} ajouté sur le filament")
            elif prof and f.profile_id:
                changes.append(f"Profile ID déjà renseigné ({f.profile_id}) — inchangé")
            if color_hex and not f.color:
                f.color = color_hex
                changes.append(f"Couleur #{color_hex} ajoutée sur le filament")

        await db.commit()

        # Construire la réponse DANS la session pendant que la relation est encore accessible
        spool_out = _spool_out(s)

    # Forcer un re-match au prochain tick MQTT
    try:
        from ....core.mqtt import invalidate_tray_cache
        invalidate_tray_cache(tag_uid=tag_uid, profile_id=prof)
    except Exception:
        pass

    return {
        "action": "mapped",
        "spool_id": s.id,
        "filament_name": filament_name,
        "changes": changes,
        "spool": spool_out,
    }


@router.post("/map-tray/create")
async def map_tray_create(body: dict, _: str = Depends(get_current_user)):
    """
    Crée un filament + une bobine à partir des infos MQTT d'un tray non reconnu,
    avec les champs nécessaires au matching automatique (profile_id, color, tag_uid).
    body: {tag_uid, profile_id, color, material, name?, manufacturer?, weight?}
    """
    tag_uid  = (body.get("tag_uid") or "").strip()
    prof     = (body.get("profile_id") or "").strip()
    # Normaliser la couleur : lowercase, 6 chars (MQTT envoie parfois 8 avec alpha)
    raw_color = (body.get("color") or "").strip().lstrip("#")
    color    = raw_color[:6].lower() if raw_color else ""
    material = (body.get("material") or "PLA").strip()
    name     = (body.get("name") or f"{material} {('#'+color) if color else ''}").strip()
    manufacturer = (body.get("manufacturer") or "").strip() or None
    weight   = float(body.get("weight") or 1000)

    async with AsyncSessionLocal() as db:
        # Réutiliser un filament existant si profile_id + couleur correspondent
        # (comparaison insensible à la casse, 6 chars)
        fil = None
        filament_created = False
        if prof:
            res = await db.execute(
                select(Filament).where(Filament.profile_id == prof)
            )
            for candidate in res.scalars().all():
                c = (candidate.color or "").lower()[:6]
                if c == color:
                    fil = candidate
                    break

        if not fil:
            fil = Filament(
                name=name, material=material, manufacturer=manufacturer,
                color=color or None, profile_id=prof or None,
                filament_weight_g=weight,
            )
            db.add(fil)
            await db.flush()
            filament_created = True

        spool = Spool(
            filament_id=fil.id,
            tag_number=tag_uid or None,
            remaining_weight_g=weight,
        )
        db.add(spool)
        await db.commit()
        await db.refresh(spool)
        await db.refresh(spool.filament)
        # Construire la réponse DANS la session
        spool_out = _spool_out(spool)
        fil_name = fil.name

    try:
        from ....core.mqtt import invalidate_tray_cache
        invalidate_tray_cache(tag_uid=tag_uid, profile_id=prof)
    except Exception:
        pass

    changes = []
    if filament_created:
        changes.append(f"Filament créé : {name!r} ({material}{', ' + manufacturer if manufacturer else ''})")
    else:
        changes.append(f"Filament existant réutilisé : {fil_name!r} (profil {prof} + couleur #{color})")
    changes.append(f"Bobine créée (#{spool.id}){', tag RFID : ' + tag_uid[:8] + '…' if tag_uid else ''}")

    return {
        "action": "created",
        "spool_id": spool.id,
        "filament_name": fil_name,
        "filament_created": filament_created,
        "changes": changes,
        "spool": spool_out,
    }


@router.delete("/spools/{sid}/permanent")
async def delete_spool_permanent(sid: int, force: bool = False, _: str = Depends(get_current_user)):
    """
    Supprime définitivement une bobine (≠ archiver).
    Si elle a des filament_usage liés, retourne un avertissement (force=false)
    ou vide les filament_usage.spool_id (force=true).
    Si elle a des filament_usage liés, retourne un avertissement (force=false)
    ou vide les filament_usage.spool_id (force=true).
    """
    async with AsyncSessionLocal() as db:
        s = await db.get(Spool, sid)
        if not s:
            raise HTTPException(404, "Bobine introuvable")

        # Compter les usages liés
        usage_count = (await db.execute(
            select(func.count()).where(FilamentUsage.spool_id == sid)
        )).scalar() or 0

        if usage_count and not force:
            return {
                "ok": False,
                "confirm_required": True,
                "usage_count": usage_count,
                "message": f"Cette bobine est liée à {usage_count} utilisation(s) dans l'historique. "
                           f"Les supprimer délie ces prints de la bobine (les prints restent, "
                           f"juste le lien bobine est effacé). Confirmer avec force=true."
            }

        if usage_count:
            await db.execute(
                FilamentUsage.__table__.update()
                .where(FilamentUsage.spool_id == sid)
                .values(spool_id=None)
            )

        await db.delete(s)
        await db.commit()

    return {"ok": True, "usage_cleared": usage_count}


@router.delete("/filaments/{fid}")
async def delete_filament(fid: int, _: str = Depends(get_current_user)):
    """
    Supprime un filament — uniquement si aucune bobine n'y est rattachée
    (archivées ou non). Sinon retourne une erreur 409.
    """
    async with AsyncSessionLocal() as db:
        f = await db.get(Filament, fid)
        if not f:
            raise HTTPException(404, "Filament introuvable")

        spool_count = (await db.execute(
            select(func.count()).where(Spool.filament_id == fid)
        )).scalar() or 0

        if spool_count:
            raise HTTPException(
                409,
                f"Impossible de supprimer ce filament : {spool_count} bobine(s) y sont rattachées "
                f"(archivées ou non). Supprime ou déplace les bobines d'abord."
            )

        await db.delete(f)
        await db.commit()

    return {"ok": True}


@router.get("/{fid}/photos")
async def filament_photos(fid: int):
    """Liste les photos d'un filament depuis /data/filaments/{id}/"""
    import mimetypes
    from pathlib import Path as _Path
    fil_dir = _Path(DATA_DIR) / "filaments" / str(fid)
    if not fil_dir.exists():
        return {"files": []}
    files = []
    for f in sorted(fil_dir.iterdir()):
        if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
            files.append({"name": f.name, "url": f"/api/v1/filaments/{fid}/photo/{f.name}"})
    return {"files": files}


@router.get("/{fid}/photo/{filename}")
async def filament_photo(fid: int, filename: str):
    """Sert une photo de filament."""
    import mimetypes
    from pathlib import Path as _Path
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    path = _Path(DATA_DIR) / "filaments" / str(fid) / filename
    if not path.exists():
        raise HTTPException(404)
    mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
    return FileResponse(str(path), media_type=mime)
