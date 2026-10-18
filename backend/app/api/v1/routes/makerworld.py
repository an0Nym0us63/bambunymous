"""MakerWorld : etat du cache des modeles, compte (connexion, j'aime,
favoris) et diagnostic. Lecture seule cote MakerWorld."""
import logging

from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import get_current_user, require_admin
from ....services import makerworld as mw
from ....services import makerworld_account as acc

router = APIRouter()
logger = logging.getLogger(__name__)


async def _call(coro):
    try:
        return await coro
    except acc.AccountError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        # API non officielle : une reponse inattendue se dit, sans 500 muet.
        logger.exception("[MW] erreur inattendue")
        raise HTTPException(502, f"MakerWorld : réponse inattendue ({type(e).__name__})")


@router.get("/status")
async def mw_status(_: str = Depends(get_current_user)):
    out = {"cache": await mw.stats()}
    out.update(await acc.status())
    return out


@router.post("/refresh")
async def mw_refresh(_: str = Depends(require_admin)):
    return {"started": mw.launch_refresh()}


@router.post("/login")
async def mw_login(body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(acc.login(str(body.get("account", "")), str(body.get("password", "")),
                                 str(body.get("code", ""))))


@router.post("/token")
async def mw_token(body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(acc.set_token(str(body.get("token", ""))))


@router.post("/logout")
async def mw_logout(_: str = Depends(require_admin)):
    await acc.logout()
    return {"connected": False}


@router.get("/collections")
async def mw_collections(_: str = Depends(get_current_user)):
    return await _call(acc.collections())


@router.get("/collections/{cid}")
async def mw_collection_designs(cid: str, _: str = Depends(get_current_user)):
    return await _call(acc.collection_designs(cid))


@router.get("/following/creators")
async def mw_following_creators(_: str = Depends(get_current_user)):
    """Createurs suivis (vraie liste du profil), pour le filtre."""
    return {"creators": await _call(acc.following())}


@router.get("/following")
async def mw_following(uids: str = "", per: int = 12, _: str = Depends(get_current_user)):
    """Modeles d'un lot de createurs suivis (uids=1,2,3 ; 25 au plus)."""
    return await _call(acc.feed(uids, per))


@router.post("/collections")
async def mw_create_collection(body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(acc.create_collection(str(body.get("title", ""))))


@router.put("/collections/{cid}")
async def mw_rename_collection(cid: str, body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(acc.rename_collection(cid, str(body.get("title", ""))))


@router.delete("/collections/{cid}")
async def mw_delete_collection(cid: str, _: str = Depends(require_admin)):
    return await _call(acc.delete_collection(cid))


@router.get("/design/{design_id}/collections")
async def mw_design_collections(design_id: str, _: str = Depends(get_current_user)):
    return await _call(acc.design_collections(design_id))


@router.put("/design/{design_id}/collections")
async def mw_set_design_collections(design_id: str, body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(acc.set_design_collections(design_id, body.get("ids") or []))


@router.get("/collection/{kind}")
async def mw_collection(kind: str, _: str = Depends(get_current_user)):
    return await _call(acc.collection(kind))


@router.get("/search")
async def mw_search(q: str = "", offset: int = 0, _: str = Depends(get_current_user)):
    """Recherche publique MakerWorld, avec « deja imprime »."""
    return await _call(mw.search(q, offset))


@router.get("/similar/{design_id}")
async def mw_similar(design_id: str, _: str = Depends(get_current_user)):
    return await _call(mw.similar(design_id))


@router.post("/history")
async def mw_history(apply: bool = False, _: str = Depends(require_admin)):
    """Historique cloud -> liens MakerWorld des vieux prints. apply=0 : bilan."""
    return await _call(acc.history_scan(apply))


@router.get("/debug/{name}")
async def mw_debug(name: str, _: str = Depends(require_admin)):
    return await _call(acc.debug(name))
