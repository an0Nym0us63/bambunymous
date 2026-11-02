"""Le support vide d'une marque, attribue d'office (02/11/2026).

Un filament sans poids de support prend celui du modele des Parametres qui porte le nom de sa marque (« Bambu Lab » ->
250 g), et y reste rattache (il suit ses changements de poids). Pour Bambu Lab, le modele est cree a 250 g s'il n'existe
pas. Au demarrage pour les filaments deja en base, puis a chaque filament cree (saisie, scan RFID, AMS, commandes) ou
dont la marque change. Un poids deja saisi n'est jamais remplace.
"""
import json
import logging
import re

logger = logging.getLogger(__name__)

BAMBU = ("Bambu Lab", 250.0)


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _match(tares: list, brand: str):
    """Comme tareForBrand cote appli : meme nom, sinon l'un contient l'autre."""
    b = _norm(brand)
    if not b:
        return None
    return next((t for t in tares if _norm(t["name"]) == b), None) \
        or next((t for t in tares if _norm(t["name"]) and (_norm(t["name"]) in b or b in _norm(t["name"]))), None)


async def tare_for(db, brand: str):
    """Le modele de support de cette marque ; pour Bambu Lab, cree a 250 g s'il manque."""
    from ..api.v1.routes.settings import _read_tares
    tares = await _read_tares(db)
    t = _match(tares, brand)
    if t is None and _norm(brand).startswith("bambu"):
        t = {"name": BAMBU[0], "weight_g": BAMBU[1]}
        await _save(db, _add(tares, t))
        logger.info("[TARE] modele « Bambu Lab » (250 g) cree dans les supports vides")
    return t


def _add(db_tares: list, t: dict) -> list:
    return sorted(db_tares + [t], key=lambda x: x["name"].lower())


async def _save(db, tares: list) -> None:
    """Dans la transaction de l'appelant (set_setting validerait en plein scan RFID, filament a moitie fait)."""
    from sqlalchemy import select
    from ..api.v1.routes.settings import SPOOL_TARES_KEY
    from ..models.setting import Setting
    from . import settings_service as SS
    row = (await db.execute(select(Setting).where(Setting.key == SPOOL_TARES_KEY))).scalar_one_or_none()
    if row:
        row.value = json.dumps(tares)
    else:
        db.add(Setting(key=SPOOL_TARES_KEY, value=json.dumps(tares)))
    SS._cache[SPOOL_TARES_KEY] = json.dumps(tares)   # tout de suite : une lecture d'ailleurs garderait sinon l'ancienne liste


async def ensure(db, brand: str, weight: float) -> dict:
    """Le support de cette marque a ce poids, cree dans les Parametres s'il n'y est pas (02/11/2026 : un poids venu du
    catalogue et utilise chez nous doit s'y retrouver). Nom : la marque si elle n'a pas encore de support, sinon
    « Marque 170 g »."""
    from ..api.v1.routes.settings import _read_tares
    tares = await _read_tares(db)
    w = round(float(weight), 1)
    t = _match([x for x in tares if abs(float(x["weight_g"]) - w) < 0.05], brand)
    if t:
        return t
    label = f"{(brand or '').strip() or 'Support'} {w:g} g"
    t = next((x for x in tares if x["name"].casefold() == label.casefold()), None)
    if t:
        return t
    t = {"name": label if _match(tares, brand) or not (brand or "").strip() else brand.strip()[:60], "weight_g": w}
    await _save(db, _add(tares, t))
    logger.info(f"[TARE] support « {t['name']} » ({w:g} g) cree depuis le catalogue")
    return t


async def fill(db, f) -> bool:
    """Donne au filament le support de sa marque s'il n'a pas de poids de support. Ne commit pas."""
    if f.spool_weight_g is not None or not (f.manufacturer or "").strip():
        return False
    t = await tare_for(db, f.manufacturer)
    if t is None:
        return False
    f.spool_weight_g, f.spool_tare_name = float(t["weight_g"]), t["name"]
    return True


async def link_weight(db, f) -> bool:
    """Un poids de support sans support des Parametres (03/11/2026 : repris d'un catalogue au rattachement, ou saisi en
    « Autre ») : le support de sa marque a ce poids, cree s'il n'existe pas. Tout poids utilise chez nous se retrouve dans
    les Parametres. Ne commit pas."""
    if f.spool_weight_g is None or (f.spool_tare_name or "").strip() or not (f.manufacturer or "").strip():
        return False
    t = await ensure(db, f.manufacturer, f.spool_weight_g)
    f.spool_tare_name, f.spool_weight_g = t["name"], float(t["weight_g"])
    return True


async def settle(db, f) -> bool:
    """Le support d'un filament : celui de sa marque s'il n'en a pas, et son poids range dans les Parametres."""
    a = await fill(db, f)
    b = await link_weight(db, f)
    return a or b


async def sweep() -> int:
    """Au demarrage : les filaments sans poids de support, et ceux dont le poids n'a pas de support des Parametres."""
    from sqlalchemy import select, or_
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament
    async with AsyncSessionLocal() as db:
        fils = (await db.execute(select(Filament).where(or_(Filament.spool_weight_g.is_(None), Filament.spool_tare_name.is_(None),
                                                            Filament.spool_tare_name == "")))).scalars().all()
        n = 0
        for f in fils:
            n += await settle(db, f)
        await db.commit()
    if n:
        logger.info(f"[TARE] {n} filament(s) sans support : celui de leur marque attribue")
    return n
