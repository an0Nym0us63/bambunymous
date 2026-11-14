"""Partage Telegram : connexion du compte, destinations, apercu et envoi."""
import logging

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile

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


@router.post("/telegram/login/qr")
async def telegram_login_qr(body: dict = Body({}), _: str = Depends(require_admin)):
    """Se connecter par QR code (14/11/2026), quand le code n'arrive pas."""
    return await _call(tg.login_qr_start(body.get("api_id", ""), body.get("api_hash", "")))


@router.post("/telegram/login/qr/check")
async def telegram_login_qr_check(_: str = Depends(require_admin)):
    return await _call(tg.login_qr_check())


@router.post("/telegram/login/resend")
async def telegram_login_resend(_: str = Depends(require_admin)):
    """Le code n'est pas arrive : par l'autre moyen que Telegram propose (14/11/2026)."""
    return await _call(tg.login_resend())


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
    if kind not in ("print", "group", "design", "creator"):
        raise HTTPException(404)
    return kind


@router.post("/image")
async def share_image(file: UploadFile = File(...), text: str = Form(""), destination_ids: str = Form(""),
                      _: str = Depends(require_admin)):
    """Une image faite dans l'appli (le resume de « Ton annee en impressions », 04/11/2026), envoyee par Telegram avec
    son texte. destination_ids : separes par des virgules. PNG ou JPEG, 10 Mo au plus."""
    import tempfile
    from pathlib import Path
    data = await file.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image trop lourde (10 Mo au plus)")
    if not (data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff"):
        raise HTTPException(400, "Image PNG ou JPEG attendue")
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / ("resume.png" if data[:4] == b"\x89PNG" else "resume.jpg")
        f.write_bytes(data)
        return await _call(tg.send_image(f, text, [x for x in destination_ids.split(",") if x.strip()]))


@router.get("/{kind}/{obj_id}/preview")
async def share_preview(kind: str, obj_id: int, message: str = "", tz: int | None = None, card: int | None = None,
                        _: str = Depends(require_admin)):
    """Exactement ce qui partira : la legende et les medias. card=0 : la carte des filaments decochee dans la
    fenetre, la legende reprend alors leur liste."""
    share = await _call(tg.build_share(_kind(kind), obj_id, tz))
    if card == 0:
        share["card"] = None
    return {"title": share["title"], "caption_html": tg.render_caption(share, message),
            "media": (["camera"] if share["live"] else []) + [f"makerworld-{k}" for k, _u in enumerate(share.get("remote") or [])] + [p.name for p in share["media"]] + (["filaments.jpg"] if share.get("card") else []),
            "live": bool(share["live"]), "links": share.get("links") or [],
            # Medias qu'on peut joindre, et ceux choisis d'office (a cocher dans l'appli).
            "pool": share["pool"], "timelapses": share.get("timelapses") or [], "default_ids": share["default_ids"], "album_max": tg.ALBUM_MAX,
            "destinations": [{"id": d["id"], "label": d["label"]} for d in await tg.destinations()]}


@router.post("/{kind}/{obj_id}")
async def share_send(kind: str, obj_id: int, body: dict = Body({}), _: str = Depends(require_admin)):
    ids = body.get("destination_ids") or ([body["destination_id"]] if body.get("destination_id") else [])
    chosen = body.get("media") if isinstance(body.get("media"), list) else None
    return await _call(tg.send(_kind(kind), obj_id, ids, body.get("message", ""), body.get("tz"), chosen))


# ── Partage par une autre appli (01/11/2026, WhatsApp d'abord) ──────────────────────────────────────────────────────
# Le meme contenu que pour Telegram (texte et medias choisis), prepare sur le serveur ; le telephone le recupere et
# ouvre son menu de partage, ou l'on choisit l'appli et la discussion. Les fichiers attendent quelques minutes derriere
# une adresse impossible a deviner : l'appli Android les telecharge sans le jeton de connexion de la page.
@router.post("/{kind}/{obj_id}/bundle")
async def share_bundle(kind: str, obj_id: int, body: dict = Body({}), _: str = Depends(require_admin)):
    chosen = body.get("media") if isinstance(body.get("media"), list) else None
    b = await _call(tg.bundle(_kind(kind), obj_id, body.get("message", ""), body.get("tz"), chosen, bool(body.get("single"))))
    return {**b, "files": [{**f, "url": f"/api/v1/share/bundle/{b['token']}/{f['name']}"} for f in b["files"]]}


@router.get("/bundle/{token}/{name}")
async def share_bundle_file(token: str, name: str):
    from fastapi.responses import FileResponse
    import mimetypes
    f = tg.bundle_file(token, name)
    if not f:
        raise HTTPException(404, "Partage expiré : relance-le")
    return FileResponse(str(f), media_type=mimetypes.guess_type(f.name)[0] or "application/octet-stream", filename=f.name)
