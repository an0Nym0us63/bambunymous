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
async def mw_collections(fresh: bool = False, _: str = Depends(get_current_user)):
    return await _call(acc.collections(fresh))


@router.get("/collections/{cid}")
async def mw_collection_designs(cid: str, offset: int = 0, limit: int = 30, fresh: bool = False,
                                _: str = Depends(get_current_user)):
    return await _call(acc.collection_designs(cid, offset, limit, fresh))


@router.get("/following/creators")
async def mw_following_creators(fresh: bool = False, _: str = Depends(get_current_user)):
    """Createurs suivis (vraie liste du profil), pour le filtre."""
    return {"creators": await _call(acc.following(fresh))}


@router.get("/following")
async def mw_following(uids: str = "", per: int = 10, fresh: bool = False, _: str = Depends(get_current_user)):
    """Modeles d'un lot de createurs suivis (uids=1,2,3 ; 25 au plus)."""
    return await _call(acc.feed(uids, per, fresh))


@router.post("/collections")
async def mw_create_collection(body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(acc.create_collection(str(body.get("title", ""))))


@router.put("/collections/{cid}")
async def mw_rename_collection(cid: str, body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(acc.rename_collection(cid, str(body.get("title", ""))))


@router.get("/model/{design_id}/like")
async def mw_like_state(design_id: str, _: str = Depends(get_current_user)):
    return await _call(acc.like_state(design_id))


@router.put("/model/{design_id}/like")
async def mw_set_like(design_id: str, body: dict = Body({}), _: str = Depends(require_admin)):
    return await _call(acc.set_like(design_id, bool(body.get("liked"))))


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
async def mw_collection(kind: str, offset: int = 0, limit: int = 30, fresh: bool = False,
                        _: str = Depends(get_current_user)):
    return await _call(acc.collection(kind, offset, limit, fresh))


@router.get("/search")
async def mw_search(q: str = "", offset: int = 0, _: str = Depends(get_current_user)):
    """Recherche publique MakerWorld, avec « deja imprime »."""
    return await _call(mw.search(q, offset))


@router.get("/creator")
async def mw_creator(fresh: bool = False, period: str = "30", _: str = Depends(get_current_user)):
    """Ma page createur : profil et points, mes modeles (avec points sur 30 j)."""
    from ....services import mw_creator as C
    try:
        return await C.overview(fresh, period)
    except C.CreatorError as e:
        raise HTTPException(400, str(e))


@router.get("/creator/points")
async def mw_creator_points(offset: int = 0, _: str = Depends(get_current_user)):
    from ....services import mw_creator as C
    try:
        return await C.points(offset, 30)
    except C.CreatorError as e:
        raise HTTPException(400, str(e))


@router.get("/queue")
async def mw_queue(fresh: bool = False, _: str = Depends(get_current_user)):
    """File d'attente : modeles des collections choisies, profils et filaments
    retenus, besoins additionnes, imprimable maintenant (AMS) ou avec le stock."""
    from ....services import mw_queue as Q
    return await _call(Q.queue(fresh))


@router.get("/queue/config")
async def mw_queue_config(_: str = Depends(get_current_user)):
    from ....services import mw_queue as Q
    return await Q.config()


@router.put("/queue/collections")
async def mw_queue_collections(body: dict = Body({}), _: str = Depends(require_admin)):
    from ....services import mw_queue as Q
    return await Q.set_collections(body.get("ids") or [])


@router.put("/queue/plan/{design_id}")
async def mw_queue_plan(design_id: str, body: dict = Body({}), _: str = Depends(require_admin)):
    """Profil, plateaux et filaments retenus pour ce modele (depuis sa fiche)."""
    from ....services import mw_queue as Q
    try:
        return await Q.set_plan(design_id, body)
    except Q.QueueError as e:
        raise HTTPException(400, str(e))


@router.put("/queue/qty/{design_id}")
async def mw_queue_qty(design_id: str, body: dict = Body({}), _: str = Depends(require_admin)):
    """Nombre d'exemplaires voulus pour ce modele."""
    from ....services import mw_queue as Q
    try:
        return await Q.set_qty(design_id, body.get("qty", 1))
    except Q.QueueError as e:
        raise HTTPException(400, str(e))


@router.delete("/queue/plan/{design_id}")
async def mw_queue_plan_delete(design_id: str, _: str = Depends(require_admin)):
    from ....services import mw_queue as Q
    try:
        await Q.set_plan(design_id, None)
    except Q.QueueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.get("/mine")
async def mw_mine(ids: str = "", _: str = Depends(get_current_user)):
    """Ce que J'AI de ces modeles (imprimes, collections, j'aime) : pour les
    reperer en parcourant le BambuNymous d'un copain."""
    return await _call(acc.mine(ids.split(",")))


@router.get("/discover/navs")
async def mw_discover_navs(fresh: bool = False, _: str = Depends(get_current_user)):
    """Fils de la page d'accueil MakerWorld (Pour vous, Tendance, categories…)."""
    return await _call(mw.discover_navs(fresh))


@router.get("/discover")
async def mw_discover(key: str = "Trending", offset: int = 0, fresh: bool = False, seed: int = 0,
                      _: str = Depends(get_current_user)):
    return await _call(mw.discover(key, offset, fresh, seed))


@router.get("/model/{design_id}")
async def mw_model(design_id: str, _: str = Depends(get_current_user)):
    """Fiche complete d'un modele (galerie, descriptif, profils, plateaux)."""
    return await _call(mw.model_detail(design_id))


@router.post("/model/{design_id}/exact/{instance_id}")
async def mw_model_exact(design_id: str, instance_id: str, _: str = Depends(require_admin)):
    """Lit le 3MF d'un profil (compte comme un telechargement sur MakerWorld,
    une seule fois : garde sur disque) et rend la fiche recalculee."""
    from ....services.mw_3mf import exact_filaments, ExactError
    try:
        r = await exact_filaments(instance_id)
    except ExactError as e:
        raise HTTPException(400, str(e))
    d = await _call(mw.model_detail(design_id))
    return {**d, "exact_read": {"instance_id": instance_id, "cached": r["cached"], "slots": len(r["slots"])}}


@router.get("/model/{design_id}/studio/{instance_id}")
async def mw_model_studio(design_id: str, instance_id: str, dev_model: str = "", _: str = Depends(require_admin)):
    """Lien du 3MF d'un profil pour l'ouvrir dans Bambu Studio (compte connecte)."""
    import asyncio
    from ....services.mw_3mf import download_link, ExactError
    if not instance_id.isdigit():
        raise HTTPException(400, "Profil inconnu")
    tok = await acc.token()
    if not tok:
        raise HTTPException(400, "Compte MakerWorld non connecté (Paramètres → Données → MakerWorld)")
    try:
        return await asyncio.to_thread(download_link, instance_id, tok, (dev_model or "")[:40])
    except ExactError as e:
        raise HTTPException(400, str(e))


@router.get("/model/{design_id}/comments")
async def mw_model_comments(design_id: str, offset: int = 0, _: str = Depends(get_current_user)):
    return await _call(mw.model_comments(design_id, offset))


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
