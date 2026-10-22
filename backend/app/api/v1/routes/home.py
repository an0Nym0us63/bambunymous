"""L'accueil : la disposition des tuiles, propre a chaque compte (22/10/2026).

Deux dispositions par compte, « dash » (PC : des colonnes, chacune en deux
sous-colonnes) et « mobile » (une colonne en deux sous-colonnes). Le serveur
ne fait que les garder : la page sait quelles tuiles existent et ce qu'elles
acceptent comme tailles, et corrige ce qu'elle ne reconnait pas.
"""
import json

from fastapi import APIRouter, Body, Depends, HTTPException

from ....db.session import AsyncSessionLocal
from ....services.settings_service import get_setting, set_setting
from .auth import require_own_account

router = APIRouter()
KEY = "HOME_LAYOUT"
MAX_BYTES = 20000


async def _all(db) -> dict:
    try:
        d = json.loads(await get_setting(db, KEY, "") or "{}")
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


@router.get("/layout")
async def home_layout(acc=Depends(require_own_account)):
    """Ma disposition ; tant que je n'en ai pas reglee, celle du compte principal
    (le premier administrateur qui en a une) : « inherited » le dit, et la
    premiere modification en fait ma propre copie."""
    from sqlalchemy import select
    from ....models.user import User, ROLE_ADMIN
    async with AsyncSessionLocal() as db:
        d = await _all(db)
        if acc[0] in d:
            return {"layout": d[acc[0]], "inherited": False}
        admins = (await db.execute(select(User.username).where(User.role == ROLE_ADMIN).order_by(User.id))).scalars().all()
        main = next((u for u in admins if u in d), None)
        return {"layout": d.get(main) if main else None, "inherited": bool(main), "from": main}


@router.put("/layout")
async def home_layout_set(body: dict = Body(...), acc=Depends(require_own_account)):
    lay = (body or {}).get("layout")
    if lay is not None and not isinstance(lay, dict):
        raise HTTPException(400, "Disposition invalide")
    if len(json.dumps(lay or {})) > MAX_BYTES:
        raise HTTPException(400, "Disposition trop grande")
    async with AsyncSessionLocal() as db:
        d = await _all(db)
        if lay is None:
            d.pop(acc[0], None)                 # retour a la disposition par defaut
        else:
            d[acc[0]] = lay
        await set_setting(db, KEY, json.dumps(d))
    return {"layout": lay}
