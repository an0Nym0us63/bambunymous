"""Scan RFID des bobines Bambu — API."""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from ....core.materials import family_of
from ....core.security import decode_token
from ....db.session import AsyncSessionLocal, get_db
from ....models.filament import Filament, Spool
from ....models.rfid import RfidScan
from ....services.rfid import catalog_match, normalize_scan
from ....services.settings_service import get_setting

logger = logging.getLogger(__name__)
router = APIRouter()

RFID_TOKEN_KEY = "RFID_TOKEN"


async def _auth_scanner(
    db: AsyncSession,
    x_rfid_token: Optional[str],
    authorization: Optional[str],
) -> None:
    """
    L'application Android ne peut pas se connecter comme un navigateur.

    Elle presente donc un jeton partage (en-tete X-Rfid-Token) compare au reglage
    RFID_TOKEN. Tant que ce reglage n'est PAS defini, l'endpoint reste ferme et
    exige une session normale : on ne veut pas d'une route d'ecriture ouverte a
    tous par defaut.
    """
    expected = (await get_setting(db, RFID_TOKEN_KEY, "") or "").strip()
    if expected and x_rfid_token and x_rfid_token.strip() == expected:
        return

    # Repli : session normale (navigateur, tests). get_current_user est une
    # dependance FastAPI, on ne peut pas l'appeler ici : on decode le jeton.
    if authorization and authorization.lower().startswith("bearer "):
        if decode_token(authorization.split(" ", 1)[1].strip()):
            return

    raise HTTPException(401, "Jeton RFID invalide ou absent")


class CreateIn(BaseModel):
    # Si fourni : on MAPPE cette bobine existante (on lui pose le tag NFC) au lieu
    # d'en creer une nouvelle. La bobine doit appartenir au meme filament.
    spool_id: Optional[int] = None
    spool_price: Optional[float] = None
    filament_price: Optional[float] = None
    remaining_weight_g: Optional[float] = None
    location: Optional[str] = None
    comment: Optional[str] = None


async def _find_spool_by_tag(db, tray_uid: str) -> Optional[Spool]:
    if not tray_uid:
        return None
    res = await db.execute(select(Spool).where(Spool.tag_number == tray_uid))
    return res.scalars().first()


async def _mappable_spools(db, filament_id: int) -> list[Spool]:
    """
    Bobines du meme filament, actives, sans tag NFC : candidates a recevoir le
    tag qu'on vient de scanner plutot que d'en creer une nouvelle.
    """
    res = await db.execute(
        select(Spool).where(
            Spool.filament_id == filament_id,
            Spool.archived.is_(False),
            or_(Spool.tag_number.is_(None), Spool.tag_number == ""),
        ).order_by(Spool.id)
    )
    return list(res.scalars().all())


async def _find_filament(db, scan: dict, match: Optional[dict]) -> Optional[Filament]:
    """
    Le filament existe-t-il deja ?

    On s'appuie d'abord sur le code Bambu (fila_color_code), qui identifie la
    reference sans ambiguite. A defaut, sur profile_id + couleur, comme le fait
    deja l'association depuis l'AMS — mieux vaut deux chemins coherents qu'un
    doublon dans le catalogue.
    """
    code = (match or {}).get("fila_color_code") or scan.get("variant_id")
    if code:
        res = await db.execute(select(Filament).where(Filament.fila_color_code == code))
        f = res.scalars().first()
        if f:
            return f

    prof = scan.get("material_id")
    want = (scan.get("color_hex") or "")[:6]
    if prof and want:
        res = await db.execute(select(Filament).where(Filament.profile_id == prof))
        for c in res.scalars().all():
            if (c.color or "").lower().lstrip("#")[:6] == want:
                return c
    return None


@router.get("/status")
async def rfid_status(db: AsyncSession = Depends(get_db)):
    """
    Verification, en GET, que le routeur RFID est bien en place.

    /rfid/scan est en POST : l'ouvrir dans un navigateur (donc en GET) tombe dans
    le catch-all et renvoie un 404 -- ce qui est le comportement attendu, mais
    indiscernable d'un routeur absent. D'ou cette route.
    """
    token = (await get_setting(db, RFID_TOKEN_KEY, "") or "").strip()
    return {
        "ok": True,
        "token_configured": bool(token),
        "hint": ("Envoyer le JSON du tag en POST sur /api/v1/rfid/scan, "
                 "avec l'en-tête X-Rfid-Token."
                 if token else
                 "Aucun RFID_TOKEN défini : l'application Android sera refusée. "
                 "Définis ce réglage, et mets la même valeur dans l'app."),
    }


@router.post("/scan")
async def rfid_scan(
    payload: dict,
    x_rfid_token: Optional[str] = Header(None, alias="X-Rfid-Token"),
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Recoit le JSON d'un tag NFC Bambu (envoye par l'application Android).

    Renvoie l'URL a ouvrir :
      - bobine connue   -> sa fiche ;
      - bobine inconnue -> l'ecran de creation, pre-rempli depuis le catalogue.
    """
    await _auth_scanner(db, x_rfid_token, authorization)

    scan = normalize_scan(payload)
    if not scan["tray_uid"]:
        raise HTTPException(400, "tray_uid manquant : ce n'est pas un tag Bambu valide")

    # 1. Bobine deja connue ? C'est le cas nominal.
    spool = await _find_spool_by_tag(db, scan["tray_uid"])
    if spool:
        return {
            "status": "known",
            "spool_id": spool.id,
            "filament_id": spool.filament_id,
            "redirect": f"/filaments?id={spool.filament_id}&spool={spool.id}",
        }

    # 2. Inconnue : on garde le scan et on prepare la creation.
    row = RfidScan(tray_uid=scan["tray_uid"], payload=json.dumps(payload))
    db.add(row)
    await db.commit()
    await db.refresh(row)

    match = catalog_match(scan)
    fil = await _find_filament(db, scan, match)

    return {
        "status": "unknown",
        "scan_id": row.id,
        "tray_uid": scan["tray_uid"],
        "catalog_match": bool(match),
        "filament_exists": bool(fil),
        "redirect": f"/filaments?rfid={row.id}",
    }


@router.get("/scan/{scan_id}")
async def rfid_scan_detail(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Ce que le front doit afficher pour proposer la creation."""
    row = await db.get(RfidScan, scan_id)
    if not row:
        raise HTTPException(404, "Scan introuvable")

    scan = normalize_scan(json.loads(row.payload))
    match = catalog_match(scan)
    fil = await _find_filament(db, scan, match)

    # Le tag a pu etre associe entre-temps (double scan)
    spool = await _find_spool_by_tag(db, scan["tray_uid"])

    return {
        "scan_id": row.id,
        "tray_uid": scan["tray_uid"],
        "already_linked": ({"spool_id": spool.id, "filament_id": spool.filament_id}
                           if spool else None),
        "scan": scan,
        "catalog": match,
        "filament": ({"id": fil.id,
                      "name": fil.translated_name or fil.name,
                      "manufacturer": fil.manufacturer,
                      "material": fil.material,
                      "fila_type": fil.fila_type,
                      "color": fil.color,
                      "colors_array": fil.colors_array,
                      "multicolor_type": fil.multicolor_type,
                      "price": fil.price} if fil else None),
        # Le prix du filament n'est demande que s'il faut le CREER : sur un
        # filament existant, il est deja connu.
        "needs_filament_price": fil is None,
        # Si le filament existe, on propose de completer une bobine existante
        # (meme filament, active, sans tag) plutot que d'en creer une nouvelle.
        "mappable_spools": ([
            {"id": sp.id,
             "remaining_weight_g": sp.remaining_weight_g,
             "location": sp.location,
             "comment": sp.comment,
             "price_override": sp.price_override}
            for sp in await _mappable_spools(db, fil.id)
        ] if fil else []),
    }


def _complete_filament(fil: Filament, scan: dict, match: Optional[dict]) -> bool:
    """
    Complete les champs VIDES du filament a partir du tag/catalogue, sans jamais
    ecraser une valeur deja saisie. Le plus important est profile_id (GFA00...) et
    fila_color_code, qui manquent souvent aux filaments crees a la main.
    Retourne True si quelque chose a change.
    """
    changed = False
    def setif(attr, value):
        nonlocal changed
        if value and not getattr(fil, attr, None):
            setattr(fil, attr, value)
            changed = True

    setif("profile_id",      scan.get("material_id"))
    setif("fila_color_code", (match or {}).get("fila_color_code") or scan.get("variant_id"))
    setif("fila_type",       (match or {}).get("fila_type") or scan.get("fila_type"))
    setif("color",           (match or {}).get("color_hex") or scan.get("color_hex"))
    setif("multicolor_type", (match or {}).get("multicolor_type"))
    setif("translated_name", (match or {}).get("name_fr"))
    if not fil.filament_weight_g and scan.get("spool_weight_g"):
        fil.filament_weight_g = scan["spool_weight_g"]; changed = True
    return changed


@router.post("/scan/{scan_id}/create")
async def rfid_create(
    scan_id: int,
    body: CreateIn,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Cree la bobine (et le filament s'il n'existe pas encore) depuis le tag."""
    row = await db.get(RfidScan, scan_id)
    if not row:
        raise HTTPException(404, "Scan introuvable")

    scan = normalize_scan(json.loads(row.payload))
    tray_uid = scan["tray_uid"]

    # Idempotence : un double scan ne doit pas creer deux bobines.
    existing = await _find_spool_by_tag(db, tray_uid)
    if existing:
        return {"created": False, "spool_id": existing.id,
                "filament_id": existing.filament_id,
                "redirect": f"/filaments?id={existing.filament_id}&spool={existing.id}"}

    match = catalog_match(scan)
    fil = await _find_filament(db, scan, match)
    filament_created = False

    if fil is None:
        colors = (match or {}).get("colors") or []
        colors_array = (",".join("#" + c[:6] for c in colors)) if len(colors) > 1 else None
        fila_type = (match or {}).get("fila_type") or scan["fila_type"] or None
        material = family_of(fila_type) if fila_type else (scan["family"] or "PLA")

        fil = Filament(
            name=(match or {}).get("name_en") or scan["fila_type"] or f"Bambu {tray_uid[:6]}",
            translated_name=(match or {}).get("name_fr"),
            manufacturer="Bambu Lab",
            material=material or scan["family"] or "PLA",
            fila_type=fila_type,
            color=((match or {}).get("color_hex") or scan["color_hex"] or None),
            colors_array=colors_array,
            multicolor_type=(match or {}).get("multicolor_type") or None,
            fila_color_code=(match or {}).get("fila_color_code") or scan["variant_id"] or None,
            profile_id=scan["material_id"] or None,
            filament_weight_g=scan["spool_weight_g"] or 1000,
            price=body.filament_price,
        )
        db.add(fil)
        await db.flush()
        filament_created = True
    else:
        # Filament existant : on complete ses infos manquantes depuis le tag
        # (profile_id/GFA00, fila_color_code, etc.) et le prix s'il manque.
        _complete_filament(fil, scan, match)
        if body.filament_price is not None and fil.price is None:
            fil.price = body.filament_price

    # ── Deux voies : mapper une bobine existante, ou en creer une ──
    if body.spool_id is not None:
        # Mapping : on pose le tag sur une bobine existante et on complete ses infos.
        spool = await db.get(Spool, body.spool_id)
        if spool is None or spool.filament_id != fil.id:
            raise HTTPException(400, "Bobine invalide pour ce filament")
        if spool.tag_number:
            raise HTTPException(409, "Cette bobine a deja un tag NFC")

        spool.tag_number = tray_uid                       # l'essentiel : le tag
        if body.spool_price is not None:
            spool.price_override = body.spool_price
        if body.remaining_weight_g is not None:
            spool.remaining_weight_g = body.remaining_weight_g
        elif spool.remaining_weight_g is None:
            spool.remaining_weight_g = scan["spool_weight_g"]
        if body.location and not spool.location:
            spool.location = body.location
        if body.comment and not spool.comment:
            spool.comment = body.comment

        await db.commit()
        await db.refresh(spool)
        logger.info(f"[RFID] bobine existante #{spool.id} mappee (tag {tray_uid}, "
                    f"filament #{fil.id})")
        return {
            "created": False,
            "mapped": True,
            "filament_created": filament_created,
            "filament_id": fil.id,
            "spool_id": spool.id,
            "redirect": f"/filaments?id={fil.id}&spool={spool.id}",
        }

    spool = Spool(
        filament_id=fil.id,
        tag_number=tray_uid,                 # c'est tout l'interet : le tag NFC
        price_override=body.spool_price,
        remaining_weight_g=(body.remaining_weight_g
                            if body.remaining_weight_g is not None
                            else scan["spool_weight_g"]),
        location=body.location,
        comment=body.comment,
    )
    db.add(spool)
    await db.commit()
    await db.refresh(spool)

    logger.info(f"[RFID] bobine #{spool.id} créée (tag {tray_uid}, "
                f"filament #{fil.id}{' créé' if filament_created else ''})")

    return {
        "created": True,
        "mapped": False,
        "filament_created": filament_created,
        "filament_id": fil.id,
        "spool_id": spool.id,
        "redirect": f"/filaments?id={fil.id}&spool={spool.id}",
    }
