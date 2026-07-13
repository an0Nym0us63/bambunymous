"""Points d'attention — API."""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from ....db.session import get_db
from ....models.attention import AttentionDismissal
from ....services.attention import (CATEGORIES, CHECKS, all_alerts, build_attention,
                                    get_prefs, list_dismissed, set_prefs)

router = APIRouter()


class PrefsIn(BaseModel):
    order: list[str] = []
    hidden: list[str] = []


class DismissIn(BaseModel):
    key: str
    days: Optional[int] = None   # None -> definitivement


@router.get("")
async def get_attention(
    per_category: int = Query(3, ge=1, le=10),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    cats, errors = await build_attention(db, per_category=per_category)
    return {"categories": cats, "errors": errors}


@router.get("/categories")
async def get_categories(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Toutes les categories du systeme, dans l'ordre choisi, avec leur etat."""
    prefs = await get_prefs(db)
    by_cat = {c["category"]: c for c in CHECKS}
    return {
        "categories": [
            {
                "category": cat,
                "label": by_cat[cat]["label"],
                "icon": by_cat[cat]["icon"],
                "shown": by_cat[cat]["shown"],
                "hidden": cat in prefs["hidden"],
            }
            for cat in prefs["order"] if cat in by_cat
        ]
    }


@router.put("/categories")
async def put_categories(
    body: PrefsIn,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Enregistre l'ordre d'affichage et les categories masquees sur l'accueil."""
    return await set_prefs(db, body.order, body.hidden)


@router.get("/all")
async def get_all_alerts(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Toutes les alertes, sans echantillonnage : l'ecran de l'accueil n'en montre
    que quelques-unes par categorie. Les alertes en sourdine sont MARQUEES
    (dismissed: true) et non retirees : on veut pouvoir les voir et les reactiver.
    """
    alerts, errors = await all_alerts(db)
    return {
        "alerts": alerts,
        "errors": errors,
        "categories": [{"category": k, "label": v[0], "icon": v[1]}
                       for k, v in CATEGORIES.items()],
    }


@router.get("/debug")
async def debug_attention(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Comptages bruts, check par check, AVANT filtrage des mises en sourdine.
    Sert a comprendre un "Rien a signaler" suspect : on voit tout de suite si
    c'est le check qui ne trouve rien, ou la sourdine qui masque tout.
    """
    from sqlalchemy import func
    from ....models.filament import Filament, Spool
    from ....models.print_history import Print, FilamentUsage, PrintSnapshot
    from ....services.attention import CHECKS, _dismissed_keys

    async def count(model):
        return (await db.execute(select(func.count()).select_from(model))).scalar()

    checks = []
    for cat, label, icon, fn in CHECKS:
        try:
            alerts = await fn(db)
            checks.append({"category": cat, "label": label,
                           "found": len(alerts),
                           "sample": [a.key for a in alerts[:3]]})
        except Exception as e:
            checks.append({"category": cat, "label": label,
                           "error": f"{type(e).__name__}: {e}"})

    return {
        "tables": {
            "filaments":      await count(Filament),
            "bobines":        await count(Spool),
            "bobines_actives": (await db.execute(
                select(func.count()).select_from(Spool).where(Spool.archived.is_(False))
            )).scalar(),
            "prints":         await count(Print),
            "filament_usage": await count(FilamentUsage),
            "snapshots":      await count(PrintSnapshot),
        },
        "checks": checks,
        "dismissed": sorted(await _dismissed_keys(db)),
    }


@router.get("/dismissed")
async def get_dismissed(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Les alertes en sourdine, avec leur cible reconstituee."""
    return {"dismissed": await list_dismissed(db)}


@router.delete("/dismissed")
async def clear_dismissed(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Remet TOUTES les alertes en circulation."""
    res = await db.execute(delete(AttentionDismissal))
    await db.commit()
    return {"ok": True, "removed": res.rowcount or 0}


@router.post("/dismiss")
async def dismiss_alert(
    body: DismissIn,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """days=None -> ignorée définitivement ; days=7 -> ignorée 7 jours."""
    if not body.key:
        raise HTTPException(400, "Clé manquante")
    until = (datetime.utcnow() + timedelta(days=body.days)) if body.days else None

    # Une seule ligne par cle : on remplace, sinon "7 jours" puis "definitivement"
    # laisserait deux enregistrements contradictoires.
    await db.execute(delete(AttentionDismissal).where(AttentionDismissal.key == body.key))
    db.add(AttentionDismissal(key=body.key, until=until))
    await db.commit()
    return {"ok": True, "key": body.key, "until": until}


@router.delete("/dismiss/{key:path}")
async def undismiss_alert(
    key: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Remet une alerte en circulation (annule la mise en sourdine)."""
    await db.execute(delete(AttentionDismissal).where(AttentionDismissal.key == key))
    await db.commit()
    return {"ok": True}
