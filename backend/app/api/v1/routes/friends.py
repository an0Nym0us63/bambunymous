"""Copains : invitations recues et relais de lecture vers leur BambuNymous."""
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin, get_current_user, _resolve
from ....db.session import get_db
from ....services import friends as F

router = APIRouter()


async def _call(coro):
    try:
        return await coro
    except F.FriendError as e:
        raise HTTPException(400, str(e))


@router.get("")
async def friends_list(_: str = Depends(get_current_user)):
    return {"friends": await F.list_friends()}


@router.post("")
async def friends_add(body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(F.add_friend(body.get("invitation", ""), body.get("name", "")))


@router.put("/{fid}")
async def friends_rename(fid: str, body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(F.rename_friend(fid, body.get("name", "")))


@router.delete("/{fid}")
async def friends_remove(fid: str, _: str = Depends(require_admin)):
    await _call(F.remove_friend(fid))
    return {"ok": True}


async def _viewer(request: Request, db: AsyncSession = Depends(get_db)) -> str:
    """Jeton dans l'en-tete, ou dans « _t » pour les <img> (qui n'envoient pas
    d'en-tete) : le relais n'est jamais ouvert sans etre connecte ici."""
    auth = request.headers.get("authorization") or ""
    tok = auth.split(" ", 1)[1].strip() if auth.lower().startswith("bearer ") else request.query_params.get("_t", "")
    if not tok or tok.startswith("fk_"):
        raise HTTPException(401, "Non connecté")
    username, _ = await _resolve(tok, db)
    return username


@router.get("/{fid}/p/{path:path}")
async def friends_proxy(fid: str, path: str, request: Request, _: str = Depends(_viewer)):
    params = [(k, v) for k, v in request.query_params.multi_items() if k != "_t"]
    try:
        code, ctype, content = await F.proxy(fid, path, params)
    except F.FriendError as e:
        raise HTTPException(502 if "injoignable" in str(e) else 400, str(e))
    if code == 401:
        # Pas de deconnexion chez moi : c'est l'acces au copain qui est refuse.
        raise HTTPException(403, "Accès refusé par le BambuNymous du copain (invitation révoquée ?)")
    return Response(content=content, status_code=code, media_type=ctype,
                    headers={"Cache-Control": "private, max-age=300"} if ctype.startswith("image/") else None)
