"""
Le recalcul des couts d'impressions (12/11/2026), en un seul endroit : un tarif electrique ou une usure qui change,
le bouton « Recalculer les couts », le prix d'un filament ou d'une bobine. Avant, chacun lancait son propre fil sans
rien dire ; desormais l'avancement se lit dans Parametres › Taches (« Travaux lances a la demande »), et une demande
qui arrive pendant un recalcul est faite juste apres (rien ne se perd, rien ne tourne deux fois en meme temps).

Chaque impression : ses couts (filament, electricite, usure) puis ceux des objets qui en naissent (ou de son groupe).
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time

logger = logging.getLogger(__name__)

STATE: dict = {"running": False, "done": 0, "total": 0, "current": None, "started": None, "finished": None}
_LOCK = threading.Lock()
_NEXT: list = []                 # demandes arrivees pendant un recalcul : (ids | None, raison)
DONE_STATUSES = ["SUCCESS", "PARTIAL", "FAILED", "TO_REDO"]


async def _all_ids() -> list:
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    async with AsyncSessionLocal() as db:
        return list((await db.execute(select(Print.id).where(Print.status.in_(DONE_STATUSES + ["IN_PROGRESS"])))).scalars().all())


async def _go(ids, why: str) -> None:
    from ..db.session import AsyncSessionLocal
    from .print_tracker import recalculate_print
    from ..api.v1.routes.prints import _propagate_from_print
    pids = list(ids) if ids is not None else await _all_ids()
    STATE.update(running=True, done=0, total=len(pids), current=why, started=time.time(), finished=None)
    for i, pid in enumerate(pids, 1):
        try:
            await recalculate_print(pid)
            async with AsyncSessionLocal() as db:
                await _propagate_from_print(db, pid)
                await db.commit()
        except Exception:
            logger.exception(f"[RECALC] impression {pid}")
        STATE["done"] = i
    logger.info(f"[RECALC] {len(pids)} impression(s) recalculee(s) : {why}")


def _thread(ids, why: str) -> None:
    loop = asyncio.new_event_loop()
    try:
        while True:
            loop.run_until_complete(_go(ids, why))
            with _LOCK:
                if not _NEXT:
                    STATE.update(running=False, current=None, finished=time.time())
                    return
                # les demandes en attente, reunies : un recalcul complet l'emporte sur des listes d'ids
                full = any(x[0] is None for x in _NEXT)
                ids = None if full else sorted({i for x in _NEXT for i in x[0]})
                why = " · ".join(dict.fromkeys(x[1] for x in _NEXT))
                _NEXT.clear()
    except Exception:
        logger.exception("[RECALC]")
        STATE.update(running=False, current=None, finished=time.time())
    finally:
        loop.close()


def start(why: str, ids=None) -> bool:
    """Recalcule ces impressions (None : toutes celles finies, et celle en cours) en fond. Rend False si un recalcul
    tournait deja : la demande est faite juste apres."""
    with _LOCK:
        if STATE["running"]:
            _NEXT.append((None if ids is None else list(ids), why))
            return False
        STATE.update(running=True, done=0, total=0, current=why, started=time.time(), finished=None)
    threading.Thread(target=_thread, args=(None if ids is None else list(ids), why), name="CostRecalc", daemon=True).start()
    return True


async def once(flag: str, why: str, delay: float = 120) -> None:
    """Un recalcul complet, une seule fois (marque en reglage) : apres une mise a jour qui change le calcul."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting, set_setting
    await asyncio.sleep(delay)
    try:
        async with AsyncSessionLocal() as db:
            if await get_setting(db, flag, ""):
                return
            await set_setting(db, flag, "1")
        start(why)
    except Exception:
        logger.exception(f"[RECALC] {flag}")


def status() -> dict:
    return {**STATE, "queued": len(_NEXT)}
