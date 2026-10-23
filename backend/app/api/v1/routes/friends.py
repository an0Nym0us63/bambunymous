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


@router.get("/shared/filament/{filament_id}")
async def friends_shared_filament(filament_id: int, _: str = Depends(get_current_user)):
    """Impressions de mes copains avec le meme filament (strictement)."""
    from ....db.session import AsyncSessionLocal
    from ....models.filament import Filament
    from ....services import friends_shared as FS
    async with AsyncSessionLocal() as db:
        f = await db.get(Filament, filament_id)
    if not f:
        raise HTTPException(404, "Filament introuvable")
    return await FS.for_filament(f)


@router.get("/shared/printing")
async def friends_shared_printing(_: str = Depends(get_current_user)):
    """Les copains qui impriment en ce moment, et le voyant de chacun (et le mien)."""
    from ....services import friends_shared as FS
    return await FS.printing()


@router.get("/shared/gallery")
async def friends_shared_gallery(_: str = Depends(get_current_user)):
    """Galeries de mes copains, reunies."""
    from ....services import friends_shared as FS
    return await FS.gallery()


@router.get("/shared/design/{design_id}")
async def friends_shared_design(design_id: str, _: str = Depends(get_current_user)):
    """Impressions de mes copains du meme modele MakerWorld."""
    from ....services import friends_shared as FS
    return await FS.for_design(design_id)


@router.get("/{fid}/p/{path:path}")
async def friends_proxy(fid: str, path: str, request: Request, _: str = Depends(_viewer)):
    params = [(k, v) for k, v in request.query_params.multi_items() if k != "_t"]
    try:
        code, ctype, content = await F.proxy(fid, path, params, dict(request.headers))
    except F.FriendError as e:
        raise HTTPException(502 if "injoignable" in str(e) else 400, str(e))
    if code < 400:
        from ....services import ach_log
        ach_log.visit_out(fid, request.headers.get("x-app-page"))   # ma visite chez lui (succes)
        if path.startswith("camera/"):
            # sa camera regardee chez lui compte dans MON temps de camera (meme horloge que la mienne),
            # pendant qu'il imprime vraiment
            from .camera import _watch_tick
            from ....services import friends_shared as FS
            _watch_tick(printing=await FS.is_printing(fid))
    if code == 401:
        # Pas de deconnexion chez moi : c'est l'acces au copain qui est refuse.
        raise HTTPException(403, "Accès refusé par le BambuNymous du copain (invitation révoquée ?)")
    if code == 204:
        return Response(status_code=204)
    return Response(content=content, status_code=code, media_type=ctype,
                    headers={"Cache-Control": "private, max-age=300"} if ctype.startswith("image/") else None)
