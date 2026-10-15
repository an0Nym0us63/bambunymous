"""Partage Telegram : connexion du compte, destinations, apercu et envoi."""
import logging

from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import require_admin
from ....services import telegram_share as tg

router = APIRouter()
logger = logging.getLogger(__name__)


async def _call(coro):
    try:
        return await coro
    except tg.ShareError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        # Jamais de 500 muet : la fenetre affiche la raison.
        logger.exception("[TG] erreur inattendue")
        raise HTTPException(502, f"Erreur inattendue : {type(e).__name__}: {e}")


@router.get("/telegram")
async def telegram_status(_: str = Depends(require_admin)):
    return await tg.status()


@router.post("/telegram/login/start")
async def telegram_login_start(body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(tg.login_start(body.get("api_id", ""), body.get("api_hash", ""), body.get("phone", "")))


@router.post("/telegram/login/code")
async def telegram_login_code(body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(tg.login_code(str(body.get("code", ""))))


@router.post("/telegram/login/password")
async def telegram_login_password(body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(tg.login_password(body.get("password", "")))


@router.post("/telegram/logout")
async def telegram_logout(_: str = Depends(require_admin)):
    await tg.logout()
    return {"ok": True}


@router.get("/telegram/chats")
async def telegram_chats(_: str = Depends(require_admin)):
    return await _call(tg.list_chats())


@router.put("/telegram/destinations")
async def telegram_destinations(body: list = Body([]), _: str = Depends(require_admin)):
    return await _call(tg.save_destinations(body))


def _kind(kind: str) -> str:
    if kind not in ("print", "group"):
        raise HTTPException(404)
    return kind


@router.get("/{kind}/{obj_id}/preview")
async def share_preview(kind: str, obj_id: int, message: str = "", tz: int | None = None,
                        _: str = Depends(require_admin)):
    """Exactement ce qui partira : la legende et les medias."""
    share = await _call(tg.build_share(_kind(kind), obj_id, tz))
    return {"caption_html": tg.render_caption(share, message),
            "media": (["camera"] if share["live"] else []) + [p.name for p in share["media"]],
            "live": bool(share["live"]),
            "destinations": [{"id": d["id"], "label": d["label"]} for d in await tg.destinations()]}


@router.post("/{kind}/{obj_id}")
async def share_send(kind: str, obj_id: int, body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(tg.send(_kind(kind), obj_id, body.get("destination_id", ""), body.get("message", ""),
                               body.get("tz")))
