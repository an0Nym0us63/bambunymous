"""Releves des capteurs (03/11/2026) : l'historique des 7 derniers jours et le decalage d'humidite par AMS.
Voir services/sensors.py."""
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import get_current_user, require_admin
from ....services import sensors as S

router = APIRouter()


@router.get("/history")
async def sensors_history(hours: float = 24, end: str | None = None, _: str = Depends(get_current_user)):
    """end (ISO, UTC) : la fin de la fenetre, pour remonter le temps ; absent : maintenant."""
    e = None
    if end:
        try:
            e = datetime.fromisoformat(end.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
        except ValueError:
            raise HTTPException(422, "end : une date ISO")
    return await S.history(hours, e)


@router.get("/humidity-offsets")
async def humidity_offsets(_: str = Depends(get_current_user)):
    return {"offsets": S.offsets()}


@router.put("/humidity-offsets")
async def humidity_offsets_set(body: dict = Body({}), _: str = Depends(require_admin)):
    return {"offsets": await S.set_offsets(body.get("offsets") or {})}
