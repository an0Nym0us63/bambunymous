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
