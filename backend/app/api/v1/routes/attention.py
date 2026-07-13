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
    return {"categories": await build_attention(db, per_category=per_category)}


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
