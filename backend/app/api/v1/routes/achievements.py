"""Succes : medailles gagnees, progression vers le palier suivant (services/achievements)."""
from fastapi import APIRouter, Depends

from .auth import get_current_user

router = APIRouter()


@router.get("")
async def achievements_view(fresh: bool = False, _: str = Depends(get_current_user)):
    from ....services import achievements as A
    return await A.view(fresh)
