"""Notifications : canal ntfy, types activables, envois de test."""
import logging

from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import require_admin
from ....services import notify as N

router = APIRouter()
logger = logging.getLogger(__name__)


async def _call(coro):
    try:
        return await coro
    except N.NotifyError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[NOTIF] erreur inattendue")
        raise HTTPException(502, f"Erreur inattendue : {type(e).__name__}")


@router.get("")
async def notify_config(_: str = Depends(require_admin)):
    return await N.get_config()


@router.put("/ntfy")
async def notify_set_ntfy(body: dict = Body({}), _: str = Depends(require_admin)):
    # "token" absent = inchange ; "" = retire
    return await _call(N.set_ntfy(body.get("url", ""), body.get("topic", ""),
                                  body["token"] if "token" in body else None))


@router.put("/events/{event}")
async def notify_set_event(event: str, body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(N.set_event(event, body.get("enabled"), body.get("creators")))


@router.post("/test")
async def notify_test(body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(N.test(str(body.get("event") or "")))
