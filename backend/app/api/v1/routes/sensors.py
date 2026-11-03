"""Releves des capteurs (03/11/2026) : l'historique des 7 derniers jours et le decalage d'humidite par AMS.
Voir services/sensors.py."""
from fastapi import APIRouter, Body, Depends

from .auth import get_current_user, require_admin
from ....services import sensors as S

router = APIRouter()


@router.get("/history")
async def sensors_history(hours: float = 24, _: str = Depends(get_current_user)):
    return await S.history(hours)


@router.get("/humidity-offsets")
async def humidity_offsets(_: str = Depends(get_current_user)):
    return {"offsets": S.offsets()}


@router.put("/humidity-offsets")
async def humidity_offsets_set(body: dict = Body({}), _: str = Depends(require_admin)):
    return {"offsets": await S.set_offsets(body.get("offsets") or {})}
