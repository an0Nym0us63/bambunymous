"""
Met à jour la location des bobines en DB selon leur emplacement AMS/Vortek.
- Si la bobine est dans un AMS → location = "AMS-A slot 1"
- Si la bobine n'est plus détectée nulle part → location = "Tiroir"
"""
import logging
from sqlalchemy import select
from ..db.session import AsyncSessionLocal
from ..models.filament import Spool

logger = logging.getLogger(__name__)

# Tracker les spools actuellement en AMS pour détecter les retraits
_ACTIVE_AMS_SPOOLS: dict[int, str] = {}  # spool_id -> location AMS


async def update_spool_location(spool_id: int, location: str):
    """Met à jour la location d'une bobine si elle a changé."""
    prev = _ACTIVE_AMS_SPOOLS.get(spool_id)
    if prev == location:
        return  # Pas de changement

    _ACTIVE_AMS_SPOOLS[spool_id] = location

    async with AsyncSessionLocal() as db:
        spool = await db.get(Spool, spool_id)
        if not spool:
            return
        old_loc = spool.location or ""
        # Ne pas écraser une location manuelle si c'est pas un AMS/Vortek
        spool.location = location
        await db.commit()
        logger.info(f"[LOCATION] Bobine #{spool_id} : {old_loc!r} → {location!r}")


async def mark_inactive_spools_as_drawer(active_spool_ids: set[int]):
    """
    Les bobines qui étaient en AMS mais ne sont plus détectées → Tiroir.
    Appelé périodiquement quand l'état AMS est mis à jour.
    """
    removed = {sid for sid in _ACTIVE_AMS_SPOOLS if sid not in active_spool_ids}
    for spool_id in removed:
        old_loc = _ACTIVE_AMS_SPOOLS.pop(spool_id, "")
        if not old_loc.startswith("AMS") and not old_loc.startswith("Vortek"):
            continue
        async with AsyncSessionLocal() as db:
            spool = await db.get(Spool, spool_id)
            if spool and spool.location == old_loc:
                spool.location = "Tiroir"
                await db.commit()
                logger.info(f"[LOCATION] Bobine #{spool_id} retirée de {old_loc!r} → Tiroir")
