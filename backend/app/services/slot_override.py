"""
Association manuelle d'un emplacement AMS a une bobine (sans RFID).

La detection automatique d'une bobine sans RFID passe par le profil et la
couleur (spool_matcher) : pour une bobine tierce, plusieurs bobines peuvent
partager le meme profil generique et des couleurs proches, et la detection se
tromper. Corriger « a la main » ne tenait pas : au matching suivant, le meme
calcul retombait sur la mauvaise bobine.

On memorise donc, par emplacement (AMS + numero), la bobine choisie ET la
signature du filament present (profil + couleur). Tant que la signature est
la meme, le choix prime sur la detection ; des qu'elle change (filament
retire ou remplace), il est oublie de lui-meme. Le RFID, lui, reste toujours
prioritaire : c'est un identifiant exact.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from ..db.session import AsyncSessionLocal
from .settings_service import get_setting, set_setting

logger = logging.getLogger(__name__)
KEY = "AMS_SLOT_OVERRIDES"


def signature(tray_info: str, color: str) -> str:
    return f"{(tray_info or '').strip()}|{(color or '').strip().lstrip('#')[:6].lower()}"


def has_rfid(tag: str) -> bool:
    t = (tag or "").strip()
    return bool(t and t.replace("0", "") and t.lower() not in ("none", "null"))


async def _load(db) -> dict:
    raw = await get_setting(db, KEY, "")
    try:
        val = json.loads(raw) if raw else {}
    except ValueError:
        val = {}
    return val if isinstance(val, dict) else {}


async def set_override(ams_id: int, tray_id: int, sig: str, spool_id: int) -> None:
    async with AsyncSessionLocal() as db:
        data = await _load(db)
        data[f"{int(ams_id)}:{int(tray_id)}"] = {"spool_id": int(spool_id), "sig": sig}
        await set_setting(db, KEY, json.dumps(data))
    logger.info(f"[SLOT] {ams_id}/{tray_id} associe a la main a la bobine #{spool_id} ({sig})")


async def get_override(ams_id: int, tray_id: int, sig: str) -> Optional[int]:
    """Bobine choisie a la main pour cet emplacement, si le meme filament y est toujours."""
    from ..models.filament import Spool
    key = f"{int(ams_id)}:{int(tray_id)}"
    async with AsyncSessionLocal() as db:
        data = await _load(db)
        entry = data.get(key)
        if not entry:
            return None
        spool = await db.get(Spool, int(entry.get("spool_id") or 0))
        if entry.get("sig") != sig or spool is None or spool.archived or spool.ordered:
            # Filament change (ou bobine archivee) : le choix ne vaut plus.
            data.pop(key, None)
            await set_setting(db, KEY, json.dumps(data))
            logger.info(f"[SLOT] {ams_id}/{tray_id} : association manuelle oubliee (emplacement change)")
            return None
        return spool.id
