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
    async with AsyncSessionLocal() as db:
        return {"layout": (await _all(db)).get(acc[0])}


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
