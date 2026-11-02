"""Suivi du filament couche par couche (alpha, 02/11/2026) : l'interrupteur, ou en est l'impression en cours, et le
changement de bobine en cours de route. Voir services/live_usage.py."""
from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import get_current_user, require_admin
from ....services import live_usage as L

router = APIRouter()


@router.get("/mode")
async def live_mode(_: str = Depends(get_current_user)):
    return {"on": L.enabled()}


@router.put("/mode")
async def live_mode_set(body: dict = Body({}), _: str = Depends(require_admin)):
    await L.set_mode(bool(body.get("on")))
    return {"on": L.enabled()}


@router.get("/current")
async def live_current(_: str = Depends(get_current_user)):
    """L'impression en cours, filament par filament (rien sur « Actuel »)."""
    if not L.enabled():
        return {"on": False}
    pid = await L.current_print_id()
    return {"on": True, **(await L.live(pid) if pid else {})}


@router.get("/layer")
async def live_layer(print_id: int | None = None, n: int | None = None, _: str = Depends(get_current_user)):
    """Le dessin d'une couche (02/11/2026) : l'impression en cours par defaut, a la couche que l'imprimante annonce.
    Affichage seulement, quel que soit le suivi choisi."""
    from sqlalchemy import select
    from ....core.mqtt import get_state
    from ....db.session import AsyncSessionLocal
    from ....models.print_history import Print, FilamentUsage
    from ....models.filament import Spool, Filament
    from ....services import layer_view as LV
    cur = await L.current_print_id()
    pid = print_id or cur
    if not pid:
        return {"ok": False, "why": "none"}
    s = get_state()
    live = pid == cur and s is not None and (s.layer or 0) > 0
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            raise HTTPException(404)
        rows = (await db.execute(select(FilamentUsage.ams_slot, FilamentUsage.color_hex, Filament.color)
                                 .outerjoin(Spool, Spool.id == FilamentUsage.spool_id)
                                 .outerjoin(Filament, Filament.id == Spool.filament_id)
                                 .where(FilamentUsage.print_id == pid).order_by(FilamentUsage.id))).all()
    colors = {}
    for slot, chex, fcol in rows:
        if slot and (slot - 1) not in colors:
            colors[slot - 1] = "#" + str(fcol or chex or "94a3b8").lstrip("#")[:6]
    want = n if n is not None else (s.layer if live else None)
    try:
        out = await LV.layer(pid, p, want)
    except Exception as e:
        raise HTTPException(502, f"G-code illisible : {e}")
    return {**out, "print_id": pid, "live": live, "now": s.layer if live else None, "total": s.total_layers if live else None,
            "colors": colors, "name": p.translated_name or p.file_name}


@router.get("/{print_id}")
async def live_print(print_id: int, _: str = Depends(get_current_user)):
    if not L.enabled():
        return {"on": False}
    return {"on": True, **(await L.live(print_id))}


@router.post("/{print_id}/switch")
async def live_switch(print_id: int, body: dict = Body({}), _: str = Depends(require_admin)):
    """La bobine d'un filament est finie : la suite vient d'une autre (body : slot, spool_id)."""
    if not L.enabled():
        raise HTTPException(400, "Le suivi couche par couche n'est pas activé (Paramètres › Imprimante)")
    try:
        return await L.switch(print_id, int(body.get("slot") or 0), int(body.get("spool_id") or 0))
    except ValueError as e:
        raise HTTPException(400, str(e))
