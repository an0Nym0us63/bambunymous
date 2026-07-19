"""
Met à jour la location des bobines selon leur emplacement AMS.
Utilise une queue asyncio pour sérialiser les écritures et éviter
les "database is locked" de SQLite.
"""
import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# State en mémoire
_ACTIVE_AMS_SPOOLS: dict[int, str] = {}  # spool_id -> location AMS

# Queue pour sérialiser les écritures DB
_write_queue: Optional[asyncio.Queue] = None
_worker_task: Optional[asyncio.Task] = None


def _get_queue() -> asyncio.Queue:
    global _write_queue, _worker_task
    if _write_queue is None:
        _write_queue = asyncio.Queue()
    return _write_queue


async def _db_writer():
    """Worker qui traite les écritures une par une pour éviter les locks."""
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Spool
    queue = _get_queue()
    while True:
        try:
            item = await asyncio.wait_for(queue.get(), timeout=60)
            if item is None:
                break
            spool_id, location = item
            try:
                async with AsyncSessionLocal() as db:
                    spool = await db.get(Spool, spool_id)
                    if spool and spool.location != location:
                        old = spool.location or ""
                        spool.location = location
                        await db.commit()
                        logger.info(f"[LOCATION] Bobine #{spool_id}: {old!r} → {location!r}")
            except Exception as e:
                logger.debug(f"[LOCATION] write error spool #{spool_id}: {e}")
            finally:
                queue.task_done()
        except asyncio.TimeoutError:
            continue
        except Exception as e:
            logger.debug(f"[LOCATION] worker error: {e}")


async def _ensure_worker():
    global _worker_task
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.create_task(_db_writer())


async def update_spool_location(spool_id: int, location: str):
    """Enfile une mise à jour de location (non bloquant)."""
    prev = _ACTIVE_AMS_SPOOLS.get(spool_id)
    if prev == location:
        return
    _ACTIVE_AMS_SPOOLS[spool_id] = location
    await _ensure_worker()
    await _get_queue().put((spool_id, location))


async def mark_inactive_spools_as_drawer(active_spool_ids: set):
    """Les bobines qui étaient montées mais ne sont plus détectées → Tiroir."""
    removed = {sid for sid in _ACTIVE_AMS_SPOOLS if sid not in active_spool_ids}
    for spool_id in removed:
        old_loc = _ACTIVE_AMS_SPOOLS.pop(spool_id, "")
        # "Externe" ajoute au filtre : une bobine retiree du support externe
        # gardait sinon son emplacement indefiniment, puisque seuls les
        # prefixes AMS et Vortek declenchaient le retour en tiroir.
        if old_loc.startswith(("AMS", "Vortek", "Externe")):
            await update_spool_location(spool_id, "Tiroir")
