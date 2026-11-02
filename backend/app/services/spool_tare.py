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
    from sqlalchemy import select
    from ..api.v1.routes.settings import _read_tares, SPOOL_TARES_KEY
    from ..models.setting import Setting
    from . import settings_service as SS
    tares = await _read_tares(db)
    t = _match(tares, brand)
    if t is None and _norm(brand).startswith("bambu"):
        t = {"name": BAMBU[0], "weight_g": BAMBU[1]}
        tares = sorted(tares + [t], key=lambda x: x["name"].lower())
        # dans la transaction de l'appelant (set_setting validerait en plein scan RFID, filament a moitie fait)
        row = (await db.execute(select(Setting).where(Setting.key == SPOOL_TARES_KEY))).scalar_one_or_none()
        if row:
            row.value = json.dumps(tares)
        else:
            db.add(Setting(key=SPOOL_TARES_KEY, value=json.dumps(tares)))
        SS._cache[SPOOL_TARES_KEY] = json.dumps(tares)   # tout de suite : une lecture d'ailleurs garderait sinon l'ancienne liste
        logger.info("[TARE] modele « Bambu Lab » (250 g) cree dans les supports vides")
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


async def sweep() -> int:
    """Au demarrage : les filaments deja en base sans poids de support."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament
    async with AsyncSessionLocal() as db:
        fils = (await db.execute(select(Filament).where(Filament.spool_weight_g.is_(None)))).scalars().all()
        n = 0
        for f in fils:
            n += await fill(db, f)
        await db.commit()
    if n:
        logger.info(f"[TARE] {n} filament(s) sans support : celui de leur marque attribue")
    return n
