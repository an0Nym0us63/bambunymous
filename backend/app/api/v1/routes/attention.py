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
from ....services.attention import build_attention

router = APIRouter()


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
