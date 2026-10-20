"""Notifications : canal ntfy, types activables, envois de test."""
import logging

from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import require_admin, require_own_account
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
                                  body["token"] if "token" in body else None,
                                  body["app_url"] if "app_url" in body else None,
                                  body.get("topics")))


@router.put("/channel")
async def notify_set_channel(body: dict = Body({}), _: str = Depends(require_admin)):
    # ancien appel (choix exclusif) : traduit en canaux actives
    old = N._OLD_CHANNEL.get(str(body.get("channel") or ""))
    if not old:
        raise HTTPException(400, "Canal inconnu")
    return await _call(N.set_channels({k: k in old for k in N.KINDS}))


@router.put("/channels")
async def notify_set_channels(body: dict = Body({}), _: str = Depends(require_admin)):
    """Active ou coupe chaque canal : {"ntfy": true, "telegram": false, "app": true}."""
    return await _call(N.set_channels(body))


@router.put("/tgbot")
async def notify_set_tgbot(body: dict = Body({}), _: str = Depends(require_admin)):
    # "token" absent = inchange ; "" = retire
    return await _call(N.set_tgbot(body.get("token"), body.get("chat_id"), body.get("chats")))


@router.post("/tgbot/detect")
async def notify_detect_tgbot(_: str = Depends(require_admin)):
    """Discussion du bot : la derniere personne (ou groupe) qui lui a ecrit."""
    return await _call(N.detect_tgbot_chat())


@router.put("/sections/{section}")
async def notify_set_route(section: str, body: dict = Body({}), _: str = Depends(require_admin)):
    """Sujet ntfy et discussion Telegram d'une section ("" = ceux par defaut)."""
    return await _call(N.set_route(section, body.get("ntfy"), body.get("telegram")))


@router.put("/events/{event}")
async def notify_set_event(event: str, body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(N.set_event(event, body.get("enabled"), body.get("creators"), body.get("options")))


@router.post("/test")
async def notify_test(body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(N.test(str(body.get("event") or ""), str(body.get("topic") or ""), str(body.get("chat") or ""),
                              str(body.get("device") or "")))


# ── Appli Android : chaque compte de la maison inscrit SES telephones et
# choisit ce qu'il y recoit ; l'administrateur les voit tous. ──
def _is_admin(acc) -> bool:
    return acc[1] == "admin"


@router.post("/devices")
async def notify_add_device(body: dict = Body({}), acc=Depends(require_own_account)):
    """Telephone (appli Android) : son adresse UnifiedPush, donnee par son distributeur."""
    await _call(N.add_device(str(body.get("endpoint") or ""), str(body.get("name") or ""), acc[0]))
    return await N.me_config(acc[0])


@router.delete("/devices/{dev_id}")
async def notify_remove_device(dev_id: str, acc=Depends(require_own_account)):
    await _call(N.remove_device(dev_id, "", acc[0], _is_admin(acc)))
    return await (N.get_config() if _is_admin(acc) else N.me_config(acc[0]))


@router.post("/devices/forget")
async def notify_forget_device(body: dict = Body({}), acc=Depends(require_own_account)):
    """L'appli s'est desinscrite (ou a change d'adresse) : on oublie l'ancienne."""
    await _call(N.remove_device("", str(body.get("endpoint") or ""), acc[0], False))
    return {"ok": True}


@router.get("/me")
async def notify_me(acc=Depends(require_own_account)):
    """Mes telephones et ce que je veux y recevoir."""
    return await N.me_config(acc[0])


@router.put("/me/events")
async def notify_me_events(body: dict = Body({}), acc=Depends(require_own_account)):
    """{type: bool}, ou {"section:prints": bool} pour toute une section."""
    return await _call(N.set_my_events(acc[0], body))


@router.post("/me/test")
async def notify_me_test(body: dict = Body({}), acc=Depends(require_own_account)):
    return await _call(N.test_device(str(body.get("device") or ""), acc[0], _is_admin(acc)))
