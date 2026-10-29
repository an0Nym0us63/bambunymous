"""MakerWorld : etat du cache des modeles, compte (connexion, j'aime,
favoris) et diagnostic. Lecture seule cote MakerWorld."""
import asyncio
import logging

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, UploadFile

from .auth import get_current_user, oauth2_scheme, require_admin, require_mw, require_own_account
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


# Vignettes de plateau relayees par le serveur : le serveur d'images de MakerWorld
# n'autorise pas la page a lire leurs pixels, ce qu'il faut pour les repeindre aux
# couleurs choisies. Uniquement des images PNG/JPG/WEBP de *.bblmw.com en https,
# sans redirection ; gardees sur disque (elles ne changent pas).
_IMG_MAX = 4 * 1024 * 1024


async def _img_user(request: Request):
    """Jeton de l'en-tete, ou `_t` dans l'adresse : la page charge la vignette par
    une simple balise image (l'appli Android abime les reponses binaires lues autrement)."""
    from ....db.session import AsyncSessionLocal
    from .auth import _resolve
    h = request.headers.get("authorization", "")
    tok = h.split(" ", 1)[1].strip() if h.lower().startswith("bearer ") else request.query_params.get("_t", "")
    if not tok:
        raise HTTPException(401, "Non authentifié")
    async with AsyncSessionLocal() as db:
        return (await _resolve(tok, db))[0]


@router.get("/img")
async def mw_img(u: str, _=Depends(_img_user)):
    import hashlib
    from pathlib import Path
    from urllib.parse import urlparse
    from fastapi import Response
    from ....core.config import settings
    p = urlparse(u)
    host = (p.hostname or "").lower()
    if p.scheme != "https" or not (host == "bblmw.com" or host.endswith(".bblmw.com")) or p.username or p.port \
            or not p.path.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        raise HTTPException(400, "Image refusée")
    ext = p.path.lower().rsplit(".", 1)[1]
    ctype = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}[ext]
    folder = Path(settings.DATA_DIR) / "mw_img"
    # « v2 » : les fichiers d'avant pouvaient etre tronques, on ne les relit pas
    path = folder / ("v2-" + hashlib.sha256(u.encode()).hexdigest()[:40] + "." + ext)
    head = {"Cache-Control": "private, max-age=2592000"}
    if path.exists():
        return Response(path.read_bytes(), media_type=ctype, headers=head)
    # meme client que le reste de MakerWorld (requests, en-tete de navigateur) : il passe
    def get():
        with mw.session().get(u, headers={"User-Agent": "Mozilla/5.0 (BambuNymous)", "Accept": "image/*"},
                              timeout=15, allow_redirects=False, stream=True) as r:
            if r.status_code != 200:
                return r.status_code, None
            # tout lire, morceau par morceau (un seul read() pouvait s'arreter au premier morceau)
            buf = bytearray()
            for chunk in r.iter_content(65536):
                buf += chunk
                if len(buf) > _IMG_MAX:
                    break
            return 200, bytes(buf)
    try:
        code, data = await asyncio.to_thread(get)
    except Exception as e:
        logger.warning("[MW] vignette %s : %s", u, e)
        raise HTTPException(502, f"Image indisponible ({type(e).__name__})")
    if code != 200 or not data:
        logger.warning("[MW] vignette %s : HTTP %s", u, code)
        raise HTTPException(502, f"Image introuvable (HTTP {code})")
    if len(data) > _IMG_MAX:
        raise HTTPException(502, "Image trop lourde")
    # image complete ? (fin de PNG / de JPEG) : sinon rien n'est garde
    tail = data.rstrip(b"\x00")
    whole = (b"IEND" in tail[-12:]) if ext == "png" else tail.endswith(b"\xff\xd9") if ext in ("jpg", "jpeg") else True
    if not whole:
        logger.warning("[MW] vignette %s : image incomplete (%s octets)", u, len(data))
        raise HTTPException(502, "Image incomplète")
    try:
        folder.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError:
        pass
    return Response(data, media_type=ctype, headers=head)


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
    from ....services import mw_added
    r = await _call(acc.collection_designs(cid, offset, limit, fresh))
    # qui l'a range ici depuis BambuNymous (rien pour ce qui a ete range ailleurs)
    marks = await mw_added.of_collection(str(cid))
    if marks and isinstance(r, dict) and isinstance(r.get("items"), list):
        r = {**r, "items": [{**x, "added": marks[str(x.get("design_id"))]} if str(x.get("design_id")) in marks else x
                            for x in r["items"]]}
    return r


@router.get("/following/creators")
async def mw_following_creators(fresh: bool = False, _: str = Depends(get_current_user)):
    """Createurs suivis (vraie liste du profil), pour le filtre."""
    return {"creators": await _call(acc.following(fresh))}


@router.get("/following/timeline")
async def mw_following_timeline(uids: str = "", before: str = "", days: int = 7, fresh: bool = False,
                                _: str = Depends(get_current_user)):
    """Les modeles des suivis par tranche de temps (les 7 derniers jours, puis plus loin au defilement)."""
    return await _call(acc.timeline(uids, before, days, fresh))


@router.get("/following")
async def mw_following(uids: str = "", per: int = 10, fresh: bool = False, _: str = Depends(get_current_user)):
    """Modeles d'un lot de createurs suivis (uids=1,2,3 ; 25 au plus)."""
    return await _call(acc.feed(uids, per, fresh))


@router.post("/collections")
async def mw_create_collection(body: dict = Body({}), _: str = Depends(require_mw)):
    return await _call(acc.create_collection(str(body.get("title", ""))))


@router.put("/collections/{cid}")
async def mw_rename_collection(cid: str, body: dict = Body({}), _: str = Depends(require_mw)):
    return await _call(acc.rename_collection(cid, str(body.get("title", ""))))


@router.get("/creators/{uid}/follow")
async def mw_follow_state(uid: str, _: str = Depends(get_current_user)):
    return await _call(acc.follow_state(uid))


@router.put("/creators/{uid}/follow")
async def mw_set_follow(uid: str, body: dict = Body({}), _: str = Depends(require_mw)):
    return await _call(acc.set_follow(uid, bool(body.get("follow"))))


@router.get("/model/{design_id}/like")
async def mw_like_state(design_id: str, _: str = Depends(get_current_user)):
    return await _call(acc.like_state(design_id))


@router.put("/model/{design_id}/like")
async def mw_set_like(design_id: str, body: dict = Body({}), _: str = Depends(require_mw)):
    return await _call(acc.set_like(design_id, bool(body.get("liked"))))


@router.delete("/collections/{cid}")
async def mw_delete_collection(cid: str, _: str = Depends(require_mw)):
    return await _call(acc.delete_collection(cid))


@router.get("/design/{design_id}/collections")
async def mw_design_collections(design_id: str, _: str = Depends(get_current_user)):
    return await _call(acc.design_collections(design_id))


@router.put("/design/{design_id}/collections")
async def mw_set_design_collections(design_id: str, body: dict = Body({}), username: str = Depends(require_mw)):
    from ....services import mw_added
    ids = [str(i) for i in (body.get("ids") or []) if str(i).isdigit()]
    # ce qui y etait deja : seuls les vrais ajouts portent le nom de qui les fait (illisible : on ne marque
    # que ce qui n'a pas deja de marque)
    try:
        before = (await acc.design_collections(design_id)).get("in")
        before = None if before is None else [str(c) for c in before]
    except Exception:
        before = None
    r = await _call(acc.set_design_collections(design_id, ids))
    if before is None:
        known = await mw_added.of_design(str(design_id))
        added, removed = [i for i in ids if i not in known], []
    else:
        added, removed = [i for i in ids if i not in before], [c for c in before if c not in ids]
    await mw_added.record(str(design_id), added, removed, username)
    return r


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


@router.post("/creator/history")
async def mw_creator_history(body: dict = Body({}), _: str = Depends(require_admin)):
    """Import unique de l'historique jour par jour du compte (dateList de la
    page « Vue d'ensemble » du Centre des createurs, extrait par l'interface)."""
    from ....services import mw_creator as C
    rows = body.get("rows")
    if not isinstance(rows, list) or len(rows) > 20000:
        raise HTTPException(400, "Liste de jours attendue")
    try:
        designs = body.get("designs") if isinstance(body.get("designs"), dict) else None
        if designs and len(designs) > 1000:
            raise HTTPException(400, "Trop de modèles")
        return await C.import_history(rows, body.get("until"), bool(body.get("from_start")), designs)
    except C.CreatorError as e:
        raise HTTPException(400, str(e))


@router.get("/creator/series")
async def mw_creator_series(days: int = 30, tz: int = 0, _: str = Depends(get_current_user)):
    """Jour par jour : points gagnes (modele, profil, boost), depenses, et compteurs du compte."""
    from ....services import mw_creator as C
    try:
        return await C.series(days, tz)
    except C.CreatorError as e:
        raise HTTPException(400, str(e))


@router.get("/creator/points")
async def mw_creator_points(offset: int = 0, _: str = Depends(get_current_user)):
    from ....services import mw_creator as C
    try:
        return await C.points(offset, 30)
    except C.CreatorError as e:
        raise HTTPException(400, str(e))


@router.get("/stock/search")
async def mw_stock_search(type: str = "", color: str = "", g: float | None = None, q: str = "", ids: str = "",
                          ams: bool = False, _: str = Depends(get_current_user)):
    """Chercher dans tout le stock pour remplacer un filament de profil. ams : seulement
    les filaments dont une bobine est chargee (AMS ou support externe)."""
    import re
    from ....services.mw_stock import stock_rows, search
    items = search(await stock_rows(), type, color, g, q[:80], [i for i in ids.split(",") if i][:20], n=400 if ams else 40)
    if ams:
        loaded = re.compile(r"^(AMS|Externe)", re.I)
        items = [c for c in items if any(loaded.match(w or "") for w in c.get("spool_where") or c.get("where") or [])][:40]
    return {"items": items}


@router.get("/queue")
async def mw_queue(fresh: bool = False, until: str | None = None, ids: str = "", _: str = Depends(get_current_user)):
    """File d'attente : modeles des collections choisies, profils et filaments
    retenus, besoins additionnes, imprimable maintenant (AMS) ou avec le stock."""
    from ....services import mw_queue as Q
    return await _call(Q.queue(fresh, until, [i for i in ids.split(",") if i.strip()][:500]))


@router.get("/queue/config")
async def mw_queue_config(_: str = Depends(get_current_user)):
    from ....services import mw_queue as Q
    return await Q.config()


@router.put("/queue/collections")
async def mw_queue_collections(body: dict = Body({}), _: str = Depends(require_mw)):
    from ....services import mw_queue as Q
    return await Q.set_collections(body.get("ids") or [])


@router.put("/queue/plan/{design_id}")
async def mw_queue_plan(design_id: str, body: dict = Body({}), _: str = Depends(require_mw)):
    """Profil, plateaux et filaments retenus pour ce modele (depuis sa fiche)."""
    from ....services import mw_queue as Q
    try:
        return await Q.set_plan(design_id, body)
    except Q.QueueError as e:
        raise HTTPException(400, str(e))


@router.put("/queue/order")
async def mw_queue_order(body: dict = Body({}), _: str = Depends(require_mw)):
    """Ordre de priorite de la file."""
    from ....services import mw_queue as Q
    return {"order": await Q.set_order(body.get("ids") or [])}


@router.put("/queue/qty/{design_id}")
async def mw_queue_qty(design_id: str, body: dict = Body({}), _: str = Depends(require_mw)):
    """Nombre d'exemplaires voulus pour ce modele."""
    from ....services import mw_queue as Q
    try:
        return await Q.set_qty(design_id, body.get("qty", 1))
    except Q.QueueError as e:
        raise HTTPException(400, str(e))


@router.delete("/queue/plan/{design_id}")
async def mw_queue_plan_delete(design_id: str, _: str = Depends(require_mw)):
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


@router.get("/creators/{uid}")
async def mw_creator_page(uid: str, offset: int = 0, fresh: bool = False, _: str = Depends(get_current_user)):
    """Profil public d'un createur et tous ses modeles."""
    return await _call(mw.creator_page(uid, offset, fresh))


@router.get("/rate-status/{design_id}")
async def mw_rate_status(design_id: str, fresh: bool = False, _: str = Depends(get_current_user)):
    """L'etat de l'evaluation d'un modele, et pourquoi il est (ou non) dans « A evaluer »."""
    from ....services import mw_rate
    return await _call(mw_rate.rate_status(design_id, fresh))


@router.get("/to-rate")
async def mw_to_rate(fresh: bool = False, _: str = Depends(get_current_user)):
    """Mes impressions de modeles MakerWorld pas encore evaluees, avec leurs photos."""
    from ....services import mw_rate
    return await _call(mw_rate.to_rate(fresh))


@router.get("/model/{design_id}/plate-guess")
async def mw_plate_guess(design_id: str, ids: str = "", _: str = Depends(get_current_user)):
    """Plateau probable de chaque print (par la silhouette de son apercu)."""
    from ....services import mw_plate_guess
    return await _call(mw_plate_guess.guess(design_id, ids.split(",")))


@router.get("/rate-templates")
async def mw_rate_templates(_: str = Depends(get_current_user)):
    """Familles de messages d'evaluation tout faits."""
    from ....services import mw_rate
    return {"families": await mw_rate.templates()}


@router.put("/rate-templates")
async def mw_rate_templates_set(body: dict = Body({}), _: str = Depends(require_mw)):
    from ....services import mw_rate
    return {"families": await mw_rate.set_templates(body.get("families"))}


@router.post("/rate-photo")
async def mw_rate_photo(file: UploadFile = File(...), _: str = Depends(require_mw)):
    """Photo hors galerie pour une evaluation ; rend l'identifiant a joindre."""
    from ....services import mw_rate
    raw = await file.read()
    return {"id": await _call(asyncio.to_thread(mw_rate.save_extra, raw, file.content_type))}


@router.post("/rate/{design_id}")
async def mw_rate_submit(design_id: str, body: dict = Body({}), _: str = Depends(require_mw)):
    """Met mon evaluation (note, texte, mes photos) en file de publication ; rend la main tout de suite."""
    from ....services import mw_rate
    try:
        return mw_rate.enqueue(design_id, body.get("rating_id"), body.get("score"), body.get("content"),
                               body.get("photos") or [], body.get("title"))
    except acc.AccountError as e:
        raise HTTPException(400, str(e))


@router.post("/rate/{design_id}/forget")
async def mw_rate_forget(design_id: str, body: dict = Body({}), _: str = Depends(require_mw)):
    """Oublie sur MakerWorld les evaluations a faire de ce modele (sans evaluer), via la file."""
    from ....services import mw_rate
    try:
        return {"jobs": [mw_rate.enqueue(design_id, rid, 0, "", [], body.get("title"), action="forget")
                         for rid in (body.get("rating_ids") or [])[:50]]}
    except acc.AccountError as e:
        raise HTTPException(400, str(e))


@router.get("/rate-queue")
async def mw_rate_queue(_: str = Depends(get_current_user)):
    """Publications en file, en cours et recentes (pour la puce d'etat)."""
    from ....services import mw_rate
    return mw_rate.queue_state()


@router.delete("/rate-queue/{job_id}")
async def mw_rate_queue_dismiss(job_id: str, _: str = Depends(require_mw)):
    from ....services import mw_rate
    mw_rate.dismiss(job_id)
    return {"ok": True}


@router.get("/contests")
async def mw_contests(offset: int = 0, fresh: bool = False, _: str = Depends(get_current_user)):
    """Concours MakerWorld (publics)."""
    return await _call(mw.contests(offset, 12, fresh))


@router.get("/contests/{cid}/designs")
async def mw_contest_designs(cid: str, offset: int = 0, order: str = "hot", _: str = Depends(get_current_user)):
    """Tous les modeles d'un concours."""
    return await _call(mw.contest_designs(cid, offset, order))


@router.get("/boosts")
async def mw_boosts(_: str = Depends(get_current_user)):
    """Mes boosts disponibles."""
    from ....services import makerworld_account as A
    return await _call(A.boosts())


@router.get("/me/details")
async def mw_me_details(_: str = Depends(get_current_user)):
    """Le detail de mon compte : boosts a donner (et leur expiration), abonnes, abonnements."""
    from ....services import makerworld_account as A
    return await _call(A.account_details())


@router.get("/model/{design_id}/boost")
async def mw_boost_state(design_id: str, _: str = Depends(get_current_user)):
    from ....services import makerworld_account as A
    return await _call(A.boost_state(design_id))


@router.post("/model/{design_id}/boost")
async def mw_boost(design_id: str, _: str = Depends(require_mw)):
    """Booster un modele (depense un de mes boosts)."""
    from ....services import makerworld_account as A
    return await _call(A.boost(design_id))


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
async def mw_model_exact(design_id: str, instance_id: str, _: str = Depends(require_mw)):
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
async def mw_model_studio(design_id: str, instance_id: str, dev_model: str = "", _: str = Depends(require_mw)):
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


@router.get("/comment/{kind}/{cid}/replies")
async def mw_comment_replies(kind: str, cid: str, _: str = Depends(get_current_user)):
    """Les reponses d'un commentaire ou d'un avis (publiques)."""
    return await _call(mw.comment_replies(kind, cid))


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


# ── Les documents joints des modeles (27/10/2026) : la copie gardee ici, sinon MakerWorld ──
@router.get("/doc/{design_id}/{doc_id}")
async def mw_doc(design_id: str, doc_id: str, dl: bool = False):
    """Un document joint (notice, nomenclature, solution…), a lire dans le navigateur. Public, comme chez
    MakerWorld (un lien ou un onglet n'envoie pas le jeton)."""
    from fastapi.responses import FileResponse, RedirectResponse
    from ....services import mw_docs as D
    if not design_id.isdigit() or not doc_id.isalnum():
        raise HTTPException(404, "Document inconnu")
    doc, path = await D.find(design_id, doc_id)
    if doc is None:
        raise HTTPException(404, "Document inconnu")
    if path is None:
        return RedirectResponse(doc["url"])
    import mimetypes
    from urllib.parse import quote
    mt = mimetypes.guess_type(doc.get("name") or "")[0] or "application/octet-stream"
    return FileResponse(path, media_type=mt, headers={
        # dl : a enregistrer (le bouton ⬇) ; sinon a lire dans le navigateur
        "Content-Disposition": f"{'attachment' if dl else 'inline'}; filename*=UTF-8''{quote(doc.get('name') or 'document')}",
        "Cache-Control": "private, max-age=86400"})


# ── La vue 3D d'un modele (27/10/2026) : son 3MF d'origine garde ici, sinon l'apercu 3D de MakerWorld ──
@router.get("/3d/{design_id}/progress")
async def mw_model_3d_progress(design_id: str, _: str = Depends(get_current_user)):
    """Ou en est la preparation de la vue 3D ouverte : {pct (0-100, ou None), label} ; {} si rien en cours."""
    from ....services import mw_3d as T
    return T.progress_of(str(design_id or "").strip())


@router.get("/3d/{design_id}")
async def mw_model_3d(design_id: str, profile: str = "", print_id: int = 0, get_src: int = Query(0, alias="fetch"),
                      used: str = "", scope: str = "", peek: int = 0, _: str = Depends(get_current_user),
                      token: str = Depends(oauth2_scheme)):
    """Les plateaux a afficher en 3D : {source: "3mf" | "makerworld", plates: [{n, name, url, size_mm}], ms}.
    print_id : le profil de cette impression (celui de l'imprimante, ou celui choisi a la main avec ses plateaux,
    27/10/2026 : seul le premier etait lu, et une impression sans lui montrait le profil par defaut)."""
    import time as _t
    from ....services import mw_3d as T
    from ....services.mw_source import known, path_of, _profile
    did = str(design_id or "").strip()
    if not did.isdigit():
        raise HTTPException(404, "Modèle inconnu")
    # le profil affiche par la fiche (deduit, ou choisi dans la liste) passe avant celui lu sur l'impression
    prof = await _prof_of(did, profile, print_id)
    t0 = _t.perf_counter()
    # le 3MF d'origine de CE profil ; sans profil connu, celui retenu pour le modele
    iid = known(did, prof) if prof else known(did, "")
    fetch_error = None
    # un copain qui visite (cle fk_), ou un simple coup d'oeil (peek) : rien n'est telecharge ni converti ici
    # (29/10/2026) ; seule une vue deja calculee et a jour se montre, sinon « pas encore calculee chez lui »
    readonly = bool(peek) or str(token or "").startswith("fk_")
    if readonly:
        import json as _json
        meta = None
        src = path_of(iid) if iid else None
        if src is not None and src.is_file() and T.ready(src, src.stem):
            try:
                meta = _json.loads((T._root() / src.stem / "plates.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                meta = None
        ok = bool(meta and any(not p.get("skipped") for p in meta.get("plates") or []))
        if peek:
            return {"ready": ok}
        if not ok:
            raise HTTPException(409, "Vue 3D pas encore calculée chez lui : il doit l'ouvrir une fois de son côté")
        key, source = src.stem, "3mf"
    if prof and not iid and not readonly:
        # le 3MF de ce profil peut etre garde sous une autre cle (rattrapage d'une impression au profil devine) ;
        # sinon, pour un modele imprime, on le recupere maintenant (une fois : il sert ensuite a tout)
        from ....services.mw_source import resolve, fetch, _index_put
        try:
            cand = await resolve(did, prof)
            # un modele imprime, ou retenu dans « À faire » (fetch=1) : son 3MF servira de toute facon
            if cand and not path_of(cand).is_file() and (print_id or get_src):
                T._step(f"did:{did}", None, "Récupération du 3MF chez MakerWorld")
                await fetch(cand)
            if cand and path_of(cand).is_file():
                _index_put(f"{did}:{prof}", cand)
                iid = cand
        except Exception as e:
            logger.info(f"[3D] 3MF du profil {prof} de {did} non recupere : {e}")
            fetch_error = str(e)[:200] if (print_id or get_src) else None
    if not readonly:
        meta, source, key = None, "3mf", None
    if iid and not readonly:
        src = path_of(iid)
        T.WATCH[did] = src.stem
        meta = await asyncio.to_thread(T.from_3mf, src, src.stem)
        key = src.stem
    if not readonly and (not meta or not any(not p.get("skipped") for p in meta.get("plates") or [])):
        # l'apercu MakerWorld du meme profil ; a defaut, le 3MF garde d'un autre profil du modele
        source = "makerworld"
        try:
            meta = await asyncio.to_thread(T.from_makerworld, did, prof or None)
        except Exception as e:
            logger.info(f"[3D] apercu MakerWorld de {did} : {e}")
            meta = None
        key = (meta or {}).get("key")
        if not meta and prof and known(did, ""):
            src = path_of(known(did, ""))
            T.WATCH[did] = src.stem
            meta, source, key = await asyncio.to_thread(T.from_3mf, src, src.stem), "3mf_other", src.stem
    T.WATCH.pop(did, None)
    T.PROGRESS.pop(f"did:{did}", None)
    if not meta or not meta.get("plates"):
        raise HTTPException(404, "Pas de modèle 3D pour celui-ci")
    ms = round((_t.perf_counter() - t0) * 1000)
    if ms > 1500:
        logger.info(f"[3D] {did} (profil {prof or '?'}) prepare en {ms} ms ({source})")
    # le nom (traduit) et l'image du profil montre, pour l'en-tete de la vue : la fiche MakerWorld gardee sur disque,
    # sinon la base (rien a demander a MakerWorld)
    ptitle = pcover = None
    if prof:
        try:
            import json as _json
            from ....services.makerworld import _disk_path
            f = _disk_path(did)
            profs = (_json.loads(f.read_text(encoding="utf-8")).get("base") or {}).get("profiles") or [] if f.is_file() else []
            if not profs:
                from sqlalchemy import select
                from ....db.session import AsyncSessionLocal
                from ....models.print_history import MakerWorldDesign as _MW
                async with AsyncSessionLocal() as db:
                    raw = (await db.execute(select(_MW.profiles).where(_MW.design_id == did))).scalar()
                profs = _json.loads(raw) if raw else []
            hit = next((p for p in profs if prof in (str(p.get("profile_id")), str(p.get("instance_id")))), None) or {}
            ptitle, pcover = hit.get("title") or None, hit.get("cover") or None
        except Exception:
            pass
    # used : des impressions de ce modele -> chaque couleur du 3MF d'origine et celle de la bobine qui l'a remplacee
    # (le numero du filament dans le projet est le meme ; sans bobine liee, la couleur notee au tranchage)
    used_palette, used_detail = None, None
    used_plates, used_details_plates = {}, {}
    used_options, chosen = [], {}
    if used and source in ("3mf", "3mf_other") and key:
        try:
            ids = await _with_group(scope, [int(x) for x in used.split(",") if x.strip().isdigit()][:60], did)
            # les correspondances choisies a la main pour cette impression ou ce groupe (28/10/2026)
            chosen = await _color_choices(scope)
            used_options = await _used_options(ids)
            used_detail = []
            used_palette = await _used_palette(path_of(key), ids, did, prof if source == "3mf" else "", used_detail, chosen=chosen)
            # plateau par plateau (28/10/2026) : sur un groupe, chaque plateau prend les couleurs des impressions qui
            # l'ont fait, pas un melange de toutes ; un plateau que personne n'a imprime reste aux couleurs d'origine
            ns = [p["n"] for p in T.plates_out(meta, key)[0]] if meta else []
            if len(ns) > 1:
                for n in ns:
                    dd = []
                    pal = await _used_palette(path_of(key), ids, did, prof if source == "3mf" else "", dd, plate=n, chosen=chosen)
                    # ce que les impressions de ce plateau ne disent pas, la correspondance de toutes (celle de la carte)
                    # le complete (28/10/2026 : la vue d'un plateau disait « rien » la ou la carte disait noir -> noir)
                    if used_palette:
                        pal = {**{a: b for a, b in used_palette.items() if a not in (pal or {})}, **(pal or {})}
                        got = {x["from"] for x in dd if x.get("to")}
                        dd = [x for x in dd if x.get("to")] + [x for x in used_detail or [] if x["from"] not in got]
                        dd.sort(key=lambda x: x.get("e") or 0)
                    if pal:
                        used_plates[str(n)], used_details_plates[str(n)] = pal, dd
        except Exception:
            logger.exception("[3D] couleurs utilisees")
    try:
        bed = mw.bed_of(await mw.my_printer())        # le plateau de mon imprimante, en repere dans la vue
    except Exception:
        bed = [256, 256]
    return {"source": source, "profile": prof or None, "profile_title": ptitle, "profile_cover": pcover, "ms": ms, "bed": bed,
            "used_palette": used_palette, "used_detail": used_detail, "fetch_error": fetch_error,
            # les filaments de ces impressions (pour choisir a la main), les choix faits, et la portee de ces choix
            "used_options": used_options, "chosen": chosen, "scope": scope if _SCOPE.fullmatch(scope or "") else None,
            # par plateau (vide : aucune impression rattachee a un plateau precis, on garde le melange ci-dessus)
            "used_plates": used_plates, "used_details_plates": used_details_plates,
            "used_multi_plates": {n: {d["from"]: d["multi"] for d in dd if d.get("to") and d.get("multi")}
                                  for n, dd in used_details_plates.items()},
            "used_multi": {d["from"]: d["multi"] for d in used_detail or [] if d.get("to") and d.get("multi")},
            "used_finishes_plates": {n: {d["from"]: d["finish"] for d in dd if d.get("to") and d.get("finish")}
                                     for n, dd in used_details_plates.items()},
            # la finition de chaque couleur, pour le rendu : d'origine (profils filament du 3MF), et des bobines utilisees
            "finishes": T.origin_finishes(path_of(key)) if source in ("3mf", "3mf_other") and key else {},
            "used_finishes": {d["from"]: d["finish"] for d in used_detail or [] if d.get("to") and d.get("finish")},
            "plates": T.plates_out(meta, key)[0], "skipped": T.plates_out(meta, key)[1]}


def _ext_by_name(z) -> dict:
    """Le filament de chaque piece d'un 3MF Bambu : {nom: [filament, ...]} (objets et pieces, dans l'ordre du fichier)."""
    import re as _re
    try:
        xml = z.read("Metadata/model_settings.config").decode("utf-8", "replace")
    except KeyError:
        return {}
    out: dict = {}

    def add(name, ext):
        if name and ext:
            out.setdefault(name, []).append(ext)
    for m in _re.finditer(r'<object id="\d+"[^>]*>(.*?)</object>', xml, _re.S):     # (uuid=... selon les versions)
        body = m.group(1)
        head = body.split("<part", 1)[0]
        oname = (_re.search(r'key="name" value="([^"]*)"', head) or [None, None])[1]
        oext = int((_re.search(r'key="extruder" value="(\d+)"', head) or [None, 1])[1])
        add(oname, oext)
        for p in _re.finditer(r'<part id="\d+"([^>]*)>(.*?)</part>', body, _re.S):
            if (_re.search(r'subtype="([^"]*)"', p.group(1)) or [None, "normal_part"])[1] != "normal_part":
                continue
            pname = (_re.search(r'key="name" value="([^"]*)"', p.group(2)) or [None, None])[1]
            pe = _re.search(r'key="extruder" value="(\d+)"', p.group(2))
            add(pname, int(pe.group(1)) if pe else oext)
    return out


def _plate_objects(z) -> dict:
    """{plateau : [noms des objets poses dessus]} d'un 3MF Bambu d'origine (model_settings.config)."""
    import re as _re
    try:
        xml = z.read("Metadata/model_settings.config").decode("utf-8", "replace")
    except KeyError:
        return {}
    names = {}
    for m in _re.finditer(r'<object id="(\d+)"[^>]*>(.*?)</object>', xml, _re.S):
        nm = _re.search(r'key="name" value="([^"]*)"', m.group(2).split("<part", 1)[0])
        if nm:
            names[m.group(1)] = nm.group(1)
    out = {}
    for m in _re.finditer(r"<plate>(.*?)</plate>", xml, _re.S):
        n = _re.search(r'key="plater_id" value="(\d+)"', m.group(1))
        ids = _re.findall(r'<metadata key="object_id" value="(\d+)"/>', m.group(1))
        if n and ids:
            out[int(n.group(1))] = [names[i] for i in ids if i in names]
    return out


def _sliced_objects(z) -> list:
    """Les noms des objets qu'un 3MF tranche imprime (slice_info.config), sans ceux qu'il saute."""
    import re as _re
    try:
        xml = z.read("Metadata/slice_info.config").decode("utf-8", "replace")
    except KeyError:
        return []
    return [m.group(1) for m in _re.finditer(r'<object\b[^>]*\bname="([^"]*)"[^>]*>', xml)
            if 'skipped="true"' not in m.group(0)]


def _plate_from_objects(plate_objs: dict, names: list) -> int | None:
    """Le plateau d'origine dont les objets sont ceux du fichier imprime : tous ses noms s'y retrouvent (en nombre),
    et un seul plateau convient ; a plusieurs, celui dont le compte colle exactement, s'il est seul. None sinon."""
    from collections import Counter
    if not names or not plate_objs:
        return None
    want = Counter(names)
    fits = [n for n, objs in plate_objs.items() if not (want - Counter(objs))]
    if len(fits) == 1:
        return fits[0]
    exact = [n for n in fits if Counter(plate_objs[n]) == want]
    return exact[0] if len(exact) == 1 else None


def _ext_map(origin: dict, sliced: dict) -> dict:
    """Filament du projet d'origine -> filament du projet imprime, d'apres les pieces de meme nom (27/10/2026 : par
    numero seulement, un projet retouche dans Bambu Studio -- filaments reordonnes, fusionnes -- melangeait les
    couleurs). Un nom dont toutes les pieces ont le meme filament (des deux cotes) vote d'un bloc ; sinon les pieces
    s'associent dans l'ordre. Le fichier imprime ne garde souvent que les pieces de son plateau : un nom present
    plusieurs fois peut y manquer en partie, d'ou le vote. {} si aucun nom en commun."""
    votes: dict = {}
    for name, eo in origin.items():
        es = sliced.get(name)
        if not es:
            continue
        if len(set(eo)) == 1 and len(set(es)) == 1:
            pairs = [(eo[0], es[0])] * min(len(eo), len(es))
        else:
            pairs = list(zip(eo, es))
        for a, b in pairs:
            v = votes.setdefault(a, {})
            v[b] = v.get(b, 0) + 1
    return {a: max(v, key=v.get) for a, v in votes.items()}


def _rgb(h: str) -> tuple:
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _assign(origin: list, used: list, veto: bool = False) -> list:
    """Filaments d'origine [(n°, couleur, grammes|None)] face aux bobines [(n°, couleur, grammes|None)] : les paires
    qui se ressemblent le plus, chacun pris une fois. Le cout d'une paire : l'ecart de couleur (0 a 1), plus le quart
    de l'ecart relatif de poids quand les deux sont connus (il departage des couleurs remplacees). Toutes les
    combinaisons jusqu'a 7, sinon la meilleure paire d'abord."""
    import itertools, math
    if not origin or not used:
        return []

    def ok(o, u):
        # une paire plausible : des couleurs proches, ou (couleur remplacee) des poids qui concordent (28/10/2026 :
        # avec une seule bobine dans l'impression, le rouge du createur partait sur la bobine orange d'un autre plateau).
        # veto (un seul filament d'un cote, sans mise a l'echelle possible) : des poids trop differents ecartent la
        # paire ; sinon les poids ne font que departager (28/10/2026 : un filament du createur non imprime empechait
        # la mise a l'echelle, et les grammes bruts refusaient tout)
        close = math.dist(_rgb(o[1]), _rgb(u[1])) / 441.7 <= 0.4
        dw = abs(o[2] - u[2]) / max(o[2], u[2]) if o[2] and u[2] else None
        if veto and dw is not None and dw > 0.35:
            return False
        return close or (dw is not None and dw <= 0.2)

    def cost(o, u):
        # la couleur d'abord ; le poids departage (un quart : au-dela, un blanc de meme poids passait devant un vert
        # proche en teinte, 28/10/2026)
        c = math.dist(_rgb(o[1]), _rgb(u[1])) / 441.7
        if o[2] and u[2]:
            c += 0.25 * abs(o[2] - u[2]) / max(o[2], u[2])
        return c + (0 if ok(o, u) else 10)
    small, big, flip = (origin, used, False) if len(origin) <= len(used) else (used, origin, True)
    if len(big) <= 7:
        best, best_c = None, None
        for perm in itertools.permutations(range(len(big)), len(small)):
            c = sum(cost(*((big[j], small[k]) if flip else (small[k], big[j]))) for k, j in enumerate(perm))
            if best_c is None or c < best_c:
                best, best_c = perm, c
        pairs = [((big[j], small[k]) if flip else (small[k], big[j])) for k, j in enumerate(best)]
    else:
        left = [(cost(o, u), o, u) for o in origin for u in used]
        left.sort(key=lambda x: x[0])
        pairs, so, su = [], set(), set()
        for _c, o, u in left:
            if o[0] not in so and u[0] not in su:
                pairs.append((o, u))
                so.add(o[0])
                su.add(u[0])
    return [(o[0], u[0]) for o, u in pairs if ok(o, u)]


def _match_filaments(o_cols: list, used: dict, sliced: dict, sl_colors: list, emap: dict, grams: dict, plate_fils: list,
                     sure: bool = False) -> dict:
    """Chaque filament du projet d'origine (couleurs o_cols, numeros 1..n) -> (emplacement du projet imprime, methode).
    used : {emplacement : couleur de la bobine} ; sliced : {emplacement : couleur notee au tranchage} ; sl_colors : les
    filaments du projet imprime dans l'ordre (3MF tranche garde) ; emap : par les pieces de meme nom ; grams : les
    grammes par emplacement ; plate_fils : [(couleur, grammes)] du plateau d'origine (fiche MakerWorld).
    1) les pieces de meme nom (les 3MF tranches recents n'ont plus ni pieces ni noms : rien ici) ;
    2) la couleur notee au tranchage (28/10/2026) : imprime depuis MakerWorld, le projet imprime garde les filaments
       du createur, memes numeros et memes couleurs, meme si la bobine posee dans l'AMS est d'une autre couleur --
       avant, on comparait a la couleur de la bobine, et un filament sautait sur un autre. Un filament dont la
       couleur est unique dans le projet d'origine va a l'emplacement de meme couleur (le meme numero d'abord,
       sinon le seul qui l'a) ;
    3) le reste, par ressemblance de couleur (celle notee au tranchage, sinon la bobine) et de poids : les filaments
       du plateau d'origine, sinon tous, face aux emplacements pas encore pris. Un modele peint au pinceau n'a que
       le filament de ses pieces dans les noms (28/10/2026 : le perroquet, numeros renumerotes, couleurs melangees) ;
    4) par elimination : un seul filament du createur et une seule bobine qui restent vont ensemble, quand le plateau
       est sur (confirme a la main, plateau unique du profil, reconnaissance sure : sure) ou quand l'impression a
       exactement autant de bobines que le plateau a de filaments (elle a imprime tout le jeu)."""
    import math
    assigned = {e: (es, "pièces") for e, es in emap.items() if es in used}
    sl = {es: c for es, c in sliced.items() if c}
    for k, c in enumerate(sl_colors):
        sl.setdefault(k + 1, c)
    taken = {es for es, _h in assigned.values()}
    for e, a in enumerate(o_cols, 1):
        if e in assigned or len(a) != 6 or o_cols.count(a) != 1:
            continue
        same = [es for es, c in sl.items() if c == a and es in used and es not in taken]
        es = e if e in same else (same[0] if len(same) == 1 else None)
        if es:
            assigned[e] = (es, "tranchage")
            taken.add(es)
    # les poids des filaments d'origine sur ces plateaux (fiche MakerWorld), par couleur exacte sinon la plus proche ;
    # tous les filaments du createur restent candidats (28/10/2026 : un gris note d'une autre nuance sur la fiche
    # n'etait jamais candidat, et finissait « aucune impression ne l'a utilise »)
    g_of = {}
    for c, g in plate_fils:
        near = sorted((math.dist(_rgb(col), _rgb(c)) / 441.7, k + 1) for k, col in enumerate(o_cols)
                      if len(col) == 6 and (k + 1) not in g_of)
        if near and near[0][0] <= 0.12:
            g_of[near[0][1]] = g
    # d'abord les filaments du createur presents sur les plateaux de l'impression (fiche MakerWorld), puis les autres
    # pour ce qui reste (28/10/2026 : tous candidats d'un coup, la bobine bleue du plateau 2 allait au cyan d'un
    # autre plateau, plus proche en teinte que le bleu du createur)
    for stage in (0, 1):
        o_rem = [(e, o_cols[e - 1], g_of.get(e)) for e in range(1, len(o_cols) + 1)
                 if e not in assigned and len(o_cols[e - 1]) == 6 and (not g_of or (e in g_of) == (stage == 0))]
        taken = {es for es, _h in assigned.values()}
        u_rem = [(es, sl.get(es) or c, grams.get(es)) for es, c in used.items() if es not in taken and len(sl.get(es) or c) == 6]
        if not o_rem or not u_rem:
            if not g_of:
                break
            continue
        # les poids a l'echelle de l'impression (28/10/2026) : un modele reduit ou retranche autrement pese une fraction
        # du plateau du createur, et toutes les couleurs etaient refusees ; on compare les proportions, pas les grammes
        # (seulement a nombre egal de filaments des deux cotes : sinon les totaux ne se correspondent pas, et les
        # grammes bruts gardent leur role de garde-fou)
        # (et a partir de deux filaments : un contre un, la proportion ne dit plus rien, les grammes bruts jugent)
        go, gu = [g for _e, _c, g in o_rem if g], [g for _e, _c, g in u_rem if g]
        if go and gu and len(o_rem) == len(u_rem) >= 2 and len(go) == len(o_rem) and len(gu) == len(u_rem):
            r = sum(gu) / sum(go)
            if 0.2 <= r <= 5:
                o_rem = [(e, c, g * r) for e, c, g in o_rem]
        # un seul filament d'un cote (une bobine seule, ou un plateau a une couleur) : il a ete imprime en entier, ses
        # grammes bruts se comparent, et des poids trop differents ecartent la paire
        for e, es in _assign(o_rem, u_rem, veto=len(o_rem) == 1 or len(u_rem) == 1):
            assigned[e] = (es, "couleur et poids")
        if not g_of:
            break
    # 4) par elimination (28/10/2026) : s'il ne reste qu'un filament du createur (sur les plateaux de l'impression,
    #    quand on les connait) et qu'une bobine de l'impression, c'est elle -- meme d'une autre couleur ou matiere
    taken = {es for es, _h in assigned.values()}
    left_o = [e for e in range(1, len(o_cols) + 1) if e not in assigned and len(o_cols[e - 1]) == 6 and (not g_of or e in g_of)]
    left_u = [es for es, c in used.items() if es not in taken and len(c) == 6]
    full = len(used) == (len(g_of) if g_of else len([c for c in o_cols if len(c) == 6]))
    if (sure or full) and len(left_o) == 1 and len(left_u) == 1:
        assigned[left_o[0]] = (left_u[0], "élimination")
    return assigned


_GUESS_CACHE: dict = {}                         # (modele, impressions) -> (heure, devinettes) : une fois par vue, pas par plateau


async def _plate_guesses(did: str, ids: list) -> dict:
    """Le plateau devine de chaque impression (image et poids), garde une minute : la vue 3D d'un groupe le demande
    pour chaque plateau du modele, et la devinette compare des silhouettes."""
    import time as _t
    key = (did, tuple(sorted(ids)))
    hit = _GUESS_CACHE.get(key)
    if hit and _t.time() - hit[0] < 60:
        return hit[1]
    from ....services.mw_plate_guess import guess as _pguess
    g = (await _pguess(did, ids)).get("guesses") or {}
    if len(_GUESS_CACHE) > 50:
        _GUESS_CACHE.clear()
    _GUESS_CACHE[key] = (_t.time(), g)
    return g

async def _used_palette(src, print_ids: list, did: str = "", prof: str = "", detail_out: list | None = None,
                        plate: int | None = None, chosen: dict | None = None) -> dict | None:
    """{couleur du 3MF d'origine (RRGGBB) : couleur utilisee} d'apres les filaments de ces impressions (la plus
    recente l'emporte). Seules comptent les impressions de ce profil (ou de profil inconnu). Chaque filament du
    projet d'origine est rapproche de celui du projet imprime par les pieces de meme nom (3MF tranche garde), a
    defaut par son numero ; puis de la bobine qui l'a imprime (sans bobine liee : la couleur notee au tranchage).
    plate : seulement les impressions de ce plateau (un groupe melange les plateaux d'un modele multi-plateaux)."""
    import json as _json
    import zipfile
    from sqlalchemy import select
    from ....db.session import AsyncSessionLocal
    from ....models.print_history import FilamentUsage as FU, Print, MakerWorldDesign as MW
    from ....models.filament import Filament, Spool
    from ....services import mw_3d as T
    from ....services.mw_source import _profile
    from ....services.archive import local_or_archive
    if not print_ids or not src or not src.is_file():
        return None
    with zipfile.ZipFile(src) as z:
        colors = T._colors_of(z)
        origin = _ext_by_name(z)
        plate_objs = _plate_objects(z)              # {plateau : noms des objets}, pour reconnaitre le plateau imprime
    h6 = lambda c: str(c or "").lstrip("#")[:6].upper()
    async with AsyncSessionLocal() as db:
        prints = (await db.execute(select(Print.id, Print.mw_profile_id, Print.mw_plates, Print.model_3mf, Print.plate_id)
                                   .where(Print.id.in_(print_ids)))).all()
        # dans l'ordre donne (l'impression de la fiche d'abord, puis les autres du groupe, les plus recentes en premier)
        rank = {pid: k for k, pid in enumerate(print_ids)}
        prints.sort(key=lambda r: rank.get(r[0], 10 ** 9))
        rows = (await db.execute(
            select(FU.print_id, FU.ams_slot, FU.color_hex, Filament.color, FU.grams_used, FU.filament_type,
                   Filament.fila_type, Filament.name, Filament.fila_finish, Filament.multicolor_type, Filament.colors_array)
            .outerjoin(Spool, Spool.id == FU.spool_id).outerjoin(Filament, Filament.id == Spool.filament_id)
            .where(FU.print_id.in_(print_ids)))).all()
        raw = (await db.execute(select(MW.profiles).where(MW.design_id == did))).scalar() if did else None
    # un profil donne par son identifiant d'instance : ramene au profil
    try:
        by_inst = {str(p.get("instance_id")): str(p.get("profile_id")) for p in _json.loads(raw or "[]") if p.get("instance_id")}
    except ValueError:
        by_inst = {}
    norm = lambda v: by_inst.get(str(v), str(v)) if v else ""
    want = norm(prof)
    used_by: dict = {}
    grams_by: dict = {}
    fin_by: dict = {}
    sliced_by: dict = {}                             # la couleur notee au tranchage, par emplacement
    multi_by: dict = {}                              # le multicolore de la bobine (degrade, coaxial) : {type, colors}
    for pid, slot, chex, fcol, g, ftype, ffila, fname, ffin, mtype, carr in rows:
        if slot and mtype in ("gradient", "coaxial"):
            cols = [h6(x) for x in str(carr or "").split(",") if len(h6(x)) == 6]
            if len(cols) >= 2:
                multi_by.setdefault(pid, {})[int(slot)] = {"type": mtype, "colors": cols[:3]}
        if slot:
            used_by.setdefault(pid, {})[int(slot)] = h6(fcol or chex)
            sliced_by.setdefault(pid, {})[int(slot)] = h6(chex) if len(h6(chex)) == 6 else None
            grams_by.setdefault(pid, {})[int(slot)] = float(g or 0)
            fin_by.setdefault(pid, {})[int(slot)] = (None if ffin == "none" else ffin) if ffin \
                else T.finish_of(ffila, fname, ftype, color=fcol or chex)
    # le poids de chaque filament sur chaque plateau du profil d'origine (fiche MakerWorld en cache) : quand le projet
    # imprime a renumerote ses filaments sans garder le nom des pieces, le plus lourd va avec le plus lourd
    plate_fils: dict = {}
    try:
        from ....services.makerworld import _base
        base = await _base(did, True) if did else {}
        for p in (base.get("profiles") or []) if isinstance(base, dict) else []:
            if not want or want in (str(p.get("profile_id")), str(p.get("instance_id"))):
                for pl in p.get("plates") or []:
                    fl = [(h6(f.get("color")), float(f.get("g") or 0)) for f in pl.get("filaments") or [] if f.get("color")]
                    plate_fils[int(pl.get("index") or 0)] = [x for x in fl if x[1] > 0 and len(x[0]) == 6]
                if want:
                    break
    except Exception:
        plate_fils = {}
    # plateau par plateau : une impression dont le plateau n'est pas valide sur la fiche prend celui que l'appli
    # devine (image et poids, comme la carte « Plateaux »), pas le numero du fichier imprime -- un plateau telecharge
    # seul depuis MakerWorld est toujours « 1 » (28/10/2026 : les quatre plateaux d'un pingouin comptaient pour le 1er)
    guesses: dict = {}
    if plate is not None and did:
        need = [pid for pid, _mwp, mwpl, _m3, _pl in prints if _manual_plates(mwpl) is None]
        if need:
            try:
                guesses = {int(k): v for k, v in (await _plate_guesses(did, need)).items()
                           if not want or norm(v.get("profile")) == want}
            except Exception:
                logger.exception("[3D] plateaux devines")
    out: dict = {}
    detail: list = []
    # A plat (28/10/2026) : d'abord les impressions de ce profil (ou de profil inconnu), la plus recente en premier ;
    # puis, pour les couleurs encore sans reponse, celles d'un autre profil du modele -- un filtre de profil trop
    # strict (identifiant d'instance contre identifiant de profil, fiche pas a jour) laissait tout a « aucune »
    rounds = ([], [])
    for row in prints:
        pid, mwp, mwpl, m3, plate_id = row
        pp = norm(_profile(mwp, mwpl))
        rounds[1 if want and pp and pp != want else 0].append(row)
    for tier, lst in enumerate(rounds):
        for pid, mwp, mwpl, m3, plate_id in lst:
            used = used_by.get(pid) or {}
            if not used:
                logger.info(f"[3D] couleurs : impression {pid} sans filament note (pas de bobine ni de couleur)")
                continue
            emap, sl_colors = {}, []
            f = local_or_archive(m3) if m3 else None
            if f and f.is_file():
                try:
                    with zipfile.ZipFile(f) as zz:
                        emap = _ext_map(origin, _ext_by_name(zz))
                        sl_colors = [h6(c) for c in T._colors_of(zz)]
                        # le plateau imprime, reconnu a ses objets (28/10/2026) : le fichier tranche nomme les objets
                        # qu'il imprime, le 3MF d'origine sait sur quel plateau ils sont -- bien plus sur que l'image
                        if _manual_plates(mwpl) is None and plate_objs:
                            n_ = _plate_from_objects(plate_objs, _sliced_objects(zz))
                            if n_:
                                guesses[pid] = {"plate": n_, "sure": True, "by": "objets"}
                except (OSError, zipfile.BadZipFile):
                    emap, sl_colors = {}, []
            if plate is not None and plate not in _print_plates(mwpl, plate_id, guesses.get(pid)):
                continue                              # une impression d'un autre plateau
            # les filaments et poids d'origine face a cette impression : ceux de tous les plateaux qu'elle a faits
            # (plusieurs plateaux regroupes en une impression : ses grammes par filament les couvrent tous), sinon le
            # plateau affiche ou son numero
            pls = _print_plates(mwpl, plate_id, guesses.get(pid)) or ([plate] if plate is not None else [1])
            agg: dict = {}
            for n_ in pls:
                for c, g in plate_fils.get(n_) or []:
                    agg[c] = agg.get(c, 0) + g
            # le plateau est sur : confirme a la main, seul plateau du profil, ou reconnu sans doute
            sure = _manual_plates(mwpl) is not None or len(plate_fils) == 1 or bool((guesses.get(pid) or {}).get("sure"))
            assigned = _match_filaments([h6(c) for c in colors], used, sliced_by.get(pid) or {}, sl_colors, emap,
                                        grams_by.get(pid) or {}, list(agg.items()), sure=sure)
            logger.info(f"[3D] couleurs : impression {pid} (profil {_profile(mwp, mwpl) or '?'}{' ≠ ' + str(prof) if tier else ''}, "
                        f"plateaux {pls}) filaments {used} -> {assigned}")
            for e, (es, how) in sorted(assigned.items()):
                a, b = h6(colors[e - 1]), used.get(es)
                if b and len(a) == 6 and len(b) == 6 and a not in out:
                    out[a] = b
                    detail.append({"from": a, "to": b, "e": e, "es": es, "how": how, "print": pid,
                                   "finish": (fin_by.get(pid) or {}).get(es), "multi": (multi_by.get(pid) or {}).get(es),
                                   **({"other_profile": True} if tier else {})})
    # les correspondances choisies a la main (28/10/2026) passent avant la deduction : une bobine de ces
    # impressions, ou « aucune » ; un choix qui vise une impression absente d'ici est ignore (la deduction reste)
    o_cols = [h6(c) for c in colors]
    for a, ch in (chosen or {}).items():
        a = h6(a)
        if a not in o_cols or not isinstance(ch, dict):
            continue
        e = o_cols.index(a) + 1
        grp = {"group": ch["group"]} if ch.get("group") else {}
        if ch.get("none"):
            out.pop(a, None)
            detail = [d for d in detail if d["from"] != a] + [{"from": a, "to": None, "e": e, "how": "choisi", **grp}]
            continue
        try:
            cp, es = int(ch.get("print")), int(ch.get("slot"))
        except (TypeError, ValueError):
            continue
        b = (used_by.get(cp) or {}).get(es)
        if b:
            out[a] = b
            detail = [d for d in detail if d["from"] != a] + [{"from": a, "to": b, "e": e, "es": es, "how": "choisi", "print": cp,
                                                               "finish": (fin_by.get(cp) or {}).get(es),
                                                               "multi": (multi_by.get(cp) or {}).get(es), **grp}]
    if detail_out is not None:
        detail_out.extend(detail)
        detail_out.extend({"from": h6(c), "to": None, "e": k + 1} for k, c in enumerate(colors)
                          if len(h6(c)) == 6 and h6(c) not in out and h6(c) not in {x["from"] for x in detail_out})
    return out or None


# ── Les correspondances de couleurs choisies a la main (28/10/2026) ──
# La deduction fait le gros du travail ; quand elle se trompe, on choisit soi-meme, pour une impression ou un groupe,
# quelle bobine de ces impressions remplace une couleur du createur (ou aucune). Garde en reglage :
# MW_COLORS:<print|group>:<id> = {"RRGGBB": {"print": id, "slot": n} | {"none": true}}.
import re as _re_scope
_SCOPE = _re_scope.compile(r"(print|group):\d{1,9}")


async def _color_choices(scope: str) -> dict:
    """Les choix de cette portee. Pour une impression, ceux de son groupe valent aussi (marques "group": id), sauf
    la ou l'impression a le sien (28/10/2026)."""
    import json as _json
    if not _SCOPE.fullmatch(scope or ""):
        return {}
    from sqlalchemy import select
    from ....db.session import AsyncSessionLocal
    from ....models.print_history import Print
    from ....services.settings_service import get_setting

    def load(raw):
        try:
            d = _json.loads(raw) if raw else {}
            return d if isinstance(d, dict) else {}
        except ValueError:
            return {}
    async with AsyncSessionLocal() as db:
        own = load(await get_setting(db, f"MW_COLORS:{scope}", ""))
        if not scope.startswith("print:"):
            return own
        gid = (await db.execute(select(Print.group_id).where(Print.id == int(scope[6:])))).scalar()
        grp = load(await get_setting(db, f"MW_COLORS:group:{gid}", "")) if gid else {}
    return {**{a: {**ch, "group": gid} for a, ch in grp.items() if isinstance(ch, dict)}, **own}


async def _save_color_choice(scope: str, origin: str, choice: dict | None) -> dict:
    """choice : {"print", "slot"} ou {"none": true} ; None : retour a la deduction automatique."""
    import json as _json
    from ....db.session import AsyncSessionLocal
    from ....services.settings_service import set_setting
    d = {k: v for k, v in (await _color_choices(scope)).items() if not (isinstance(v, dict) and v.get("group"))}
    a = str(origin or "").lstrip("#")[:6].upper()
    if choice is None:
        d.pop(a, None)
    else:
        d[a] = choice
    async with AsyncSessionLocal() as db:
        await set_setting(db, f"MW_COLORS:{scope}", _json.dumps(d))
    return d


async def _with_group(scope: str, ids: list, did: str) -> list:
    """Pour une impression d'un groupe (28/10/2026) : elle d'abord, puis les autres impressions du groupe sur ce
    modele, les plus recentes en premier -- depuis sa fiche, la vue 3D montre tous les plateaux, et ce que les autres
    impressions du groupe ont utilise vaut pour elle. Sinon, les ids tels quels."""
    if not (scope or "").startswith("print:") or not ids:
        return ids
    from sqlalchemy import select
    from ....db.session import AsyncSessionLocal
    from ....models.print_history import Print
    try:
        pid = int(scope[6:])
    except ValueError:
        return ids
    async with AsyncSessionLocal() as db:
        gid = (await db.execute(select(Print.group_id).where(Print.id == pid))).scalar()
        if not gid:
            return ids
        others = (await db.execute(select(Print.id).where(Print.group_id == gid, Print.design_id == str(did), Print.id != pid)
                                   .order_by(Print.id.desc()).limit(60))).scalars().all()
    return [pid] + [x for x in ids if x != pid and x not in others] + list(others)


async def _used_options(print_ids: list) -> list:
    """Les filaments de ces impressions, a choisir : [{print, print_name, slot, color, name, finish, grams}]."""
    from sqlalchemy import select
    from ....db.session import AsyncSessionLocal
    from ....models.print_history import FilamentUsage as FU, Print
    from ....models.filament import Filament, Spool
    from ....services import mw_3d as T
    if not print_ids:
        return []
    h6 = lambda c: str(c or "").lstrip("#")[:6].upper()
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(FU.print_id, FU.ams_slot, FU.color_hex, Filament.color, FU.grams_used, FU.filament_type, Filament.fila_type,
                   Filament.name, Filament.translated_name, Filament.fila_finish, Print.translated_name, Print.file_name,
                   Filament.manufacturer, Filament.material)
            .join(Print, Print.id == FU.print_id)
            .outerjoin(Spool, Spool.id == FU.spool_id).outerjoin(Filament, Filament.id == Spool.filament_id)
            .where(FU.print_id.in_(print_ids)).order_by(FU.print_id.desc(), FU.ams_slot))).all()
    out = []
    for pid, slot, chex, fcol, g, ftype, ffila, fname, ftr, ffin, pname, pfile, brand, mat in rows:
        c = h6(fcol or chex)
        if not slot or len(c) != 6:
            continue
        # la bobine : marque, matiere et sous-type (« Bambu Lab · PLA Basic »), puis son nom
        kind = " · ".join(x for x in (brand, ffila or mat or ftype) if x)
        out.append({"print": pid, "print_name": (pname or pfile or f"Impression {pid}")[:60], "slot": int(slot), "color": c,
                    "name": (ftr or fname or ffila or ftype or "")[:60], "kind": kind[:60], "grams": round(float(g or 0), 1),
                    "finish": (None if ffin == "none" else ffin) if ffin else T.finish_of(ffila, fname, ftype, color=fcol or chex)})
    return out


async def _prof_of(did: str, profile: str, print_id: int) -> str:
    """Le profil a montrer : celui donne par la fiche, sinon celui de l'impression (imprimante, ou choisi a la main
    avec ses plateaux), sinon celui que j'ai imprime, deduit de mes impressions (comme la carte et la fiche)."""
    from ....services.mw_source import _profile
    prof = str(profile or "").strip()
    if print_id and not prof:
        from sqlalchemy import select
        from ....db.session import AsyncSessionLocal
        from ....models.print_history import Print
        async with AsyncSessionLocal() as db:
            r = (await db.execute(select(Print.mw_profile_id, Print.mw_plates).where(Print.id == print_id))).first()
        if r:
            prof = _profile(r[0], r[1]) or prof
    if not prof:
        try:
            from ....services.mw_plate_guess import printed_profile
            prof = (await printed_profile(did))["profile"] or ""
        except Exception:
            logger.exception("[3D] profil imprime")
    return prof


@router.get("/3d/{design_id}/colors")
async def mw_model_3d_colors(design_id: str, profile: str = "", print_id: int = 0, used: str = "", scope: str = "",
                             _: str = Depends(get_current_user)):
    """Les couleurs du createur (3MF d'origine garde, sans le convertir) et ce qui les remplace dans ces impressions :
    la deduction, les choix faits a la main, et les filaments a choisir. Pour la carte MakerWorld d'une impression
    ou d'un groupe. {colors: [], detail: [], options: [], chosen: {}, scope} ; colors vide : pas de 3MF d'origine."""
    from ....services import mw_3d as T
    from ....services.mw_source import known, path_of
    import zipfile
    did = str(design_id or "").strip()
    if not did.isdigit():
        raise HTTPException(404, "Modèle inconnu")
    prof = await _prof_of(did, profile, print_id)
    # le 3MF de CE profil, comme la vue 3D : garde sous sa cle, sinon sous celle d'une impression au profil devine
    # (resolve, sans rien telecharger) ; jamais celui d'un autre profil du modele (28/10/2026 : la carte montrait les
    # couleurs d'un autre profil, une seule, la vue 3D les deux du bon)
    iid = known(did, prof) if prof else None
    if prof and not iid:
        try:
            from ....services.mw_source import resolve, _index_put
            cand = await resolve(did, prof)
            if cand and path_of(cand).is_file():
                _index_put(f"{did}:{prof}", cand)
                iid = cand
        except Exception:
            logger.exception("[3D] couleurs : profil")
    if not prof:
        iid = known(did, "")
    src = path_of(iid) if iid else None
    if not src or not src.is_file():
        return {"colors": [], "detail": [], "options": [], "chosen": {}, "scope": None}
    ids = await _with_group(scope, [int(x) for x in used.split(",") if x.strip().isdigit()][:60], did)
    chosen = await _color_choices(scope)
    detail: list = []
    try:
        with zipfile.ZipFile(src) as z:
            colors = [c for c in (str(x or "").lstrip("#")[:6].upper() for x in T._colors_of(z)) if len(c) == 6]
        await _used_palette(src, ids, did, prof, detail, chosen=chosen)
    except Exception:
        logger.exception("[3D] couleurs")
        colors = []
    return {"colors": colors, "detail": detail, "options": await _used_options(ids), "chosen": chosen,
            "scope": scope if _SCOPE.fullmatch(scope or "") else None, "finishes": T.origin_finishes(src)}


@router.post("/3d/colors/set")
async def mw_model_3d_colors_set(body: dict = Body(...), _=Depends(require_own_account)):
    """Choisir a la main ce qui remplace une couleur du createur : {scope, origin, print, slot} (cette bobine),
    {scope, origin, none: true} (aucune), {scope, origin, auto: true} (retour a la deduction)."""
    scope = str(body.get("scope") or "")
    origin = str(body.get("origin") or "").lstrip("#")[:6].upper()
    if not _SCOPE.fullmatch(scope) or len(origin) != 6:
        raise HTTPException(400, "Choix incomplet")
    if body.get("auto"):
        choice = None
    elif body.get("none"):
        choice = {"none": True}
    else:
        try:
            choice = {"print": int(body.get("print")), "slot": int(body.get("slot"))}
        except (TypeError, ValueError):
            raise HTTPException(400, "Choix incomplet")
    return {"chosen": await _save_color_choice(scope, origin, choice)}


def _manual_plates(mwpl) -> list | None:
    """Les plateaux choisis a la main sur la fiche d'une impression (vide : « aucun plateau de ce profil ») ; None sinon."""
    import json as _json
    try:
        m = _json.loads(mwpl) if mwpl else None
        if isinstance(m, dict) and isinstance(m.get("plates"), list):
            return [int(x) for x in m["plates"]]
    except (TypeError, ValueError):
        pass
    return None


def _print_plates(mwpl, plate_id, guess: dict | None = None) -> list:
    """Les plateaux d'origine qu'une impression a faits : choisis a la main sur sa fiche, sinon celui que l'appli
    devine (guess, image et poids), sinon son numero de plateau."""
    manual = _manual_plates(mwpl)
    if manual is not None:
        return manual
    try:
        if guess and guess.get("plate"):
            return [int(guess["plate"])]
    except (TypeError, ValueError):
        pass
    try:
        return [int(plate_id)] if plate_id else []
    except (TypeError, ValueError):
        return []


@router.get("/3d/file/{key}/{name}")
async def mw_model_3d_file(key: str, name: str, plain: bool = False):
    """Un plateau en 3D (binaire de l'appli, ou GLB de MakerWorld). Public, comme les images.
    plain : decompresse ici (secours de la vue quand le navigateur n'a pas pu le lire) ; un plateau abime est
    alors oublie avec sa vue (410), que la prochaine ouverture refait."""
    from fastapi.responses import FileResponse, Response
    from ....services import mw_3d as T
    p = T.file_path(key, name)
    if p is None:
        raise HTTPException(404, "Plateau introuvable")
    if plain and name.endswith(".bin"):
        import gzip, zlib, asyncio
        try:
            raw = await asyncio.to_thread(lambda: gzip.decompress(p.read_bytes()))
        except (OSError, EOFError, zlib.error):
            T.unreadable(key)
            raise HTTPException(410, "Plateau abîmé : la vue est à refaire")
        return Response(raw, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})
    hdr = {"Cache-Control": "private, max-age=86400"}
    if name.endswith(".bin"):
        hdr["Content-Encoding"] = "gzip"            # deja compresse a la conversion
    return FileResponse(p, media_type="model/gltf-binary" if name.endswith(".glb") else "application/octet-stream", headers=hdr)


@router.get("/docs/status")
async def mw_docs_status(_: str = Depends(require_admin)):
    from ....services import mw_docs as D
    return {**D.status(), "summary": await D.summary()}


@router.post("/docs/backfill")
async def mw_docs_backfill(_: str = Depends(require_admin)):
    """Relit les fiches des modeles deja imprimes et garde leurs documents joints (en fond)."""
    from ....services import mw_docs as D
    return {"started": D.start_backfill(), **D.status(), "summary": await D.summary()}


@router.post("/docs/stop")
async def mw_docs_stop(_: str = Depends(require_admin)):
    from ....services import mw_docs as D
    D.stop_backfill()
    return D.status()


# ── Le 3MF d'origine MakerWorld des impressions (24/10/2026) ──
@router.post("/source3mf/print/{print_id}")
async def mw_source_print(print_id: int, _: str = Depends(require_mw)):
    """Recupere tout de suite le 3MF d'origine d'une impression (compte comme un telechargement)."""
    from ....services.mw_source import for_print
    r = await for_print(print_id)
    if "skip" in r:
        raise HTTPException(400, r["skip"])
    return r


@router.post("/source3mf/backfill")
async def mw_source_backfill(_: str = Depends(require_mw)):
    """Lance le rattrapage en arriere-plan (toutes les impressions liees a un profil)."""
    from ....services import mw_source as S
    return {"started": S.start_backfill(), **S.status(), "summary": await S.summary()}


@router.post("/source3mf/stop")
async def mw_source_stop(_: str = Depends(require_mw)):
    from ....services import mw_source as S
    S.stop_backfill()
    return {**S.status(), "summary": await S.summary()}


@router.get("/source3mf/status")
async def mw_source_status(_: str = Depends(require_mw)):
    """Ou en est le rattrapage (lisible meme apres avoir quitte la page), et son quota par 24 h."""
    from ....services import mw_source as S
    return {**S.status(), "summary": await S.summary(), "quota": {"cap": await S.budget(), "used": len(S._downloads())}}


@router.post("/source3mf/budget")
async def mw_source_budget(body: dict = Body({}), _: str = Depends(require_mw)):
    """Le quota du rattrapage par 24 h (0 : sans limite) : de la marge pour lancer des impressions."""
    from ....services import mw_source as S
    try:
        n = await S.set_budget(int(body.get("n", S.BUDGET_DEFAULT)))
    except (TypeError, ValueError):
        raise HTTPException(400, "Quota invalide")
    return {"cap": n, "used": len(S._downloads())}


# ── Retrouver le modele MakerWorld des impressions qui n'en ont pas (29/10/2026) ──
@router.get("/relink")
async def mw_relink_list(_: str = Depends(require_admin)):
    """Les « modeles » sans fiche MakerWorld (impressions regroupees par nom) et l'avancement du scan."""
    from ....services import mw_relink as R
    return {"units": await R.units(), "scan": R.status()}


@router.post("/relink/start")
async def mw_relink_start(body: dict = Body({}), _: str = Depends(require_admin)):
    """Lance ou reprend le scan ; again : repasse aussi sur les modeles sans resultat."""
    from ....services import mw_relink as R
    return {"started": R.start(bool(body.get("again"))), "scan": R.status()}


@router.post("/relink/stop")
async def mw_relink_stop(_: str = Depends(require_admin)):
    from ....services import mw_relink as R
    R.stop()
    return {"scan": R.status()}


@router.post("/relink/choose")
async def mw_relink_choose(body: dict = Body({}), _: str = Depends(require_admin)):
    """Rattache le modele choisi a toutes les impressions de ce « modele »."""
    from ....services import mw_relink as R
    try:
        n = await R.assign(str(body.get("key") or ""), str(body.get("design_id") or ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "count": n}


@router.post("/relink/unlink")
async def mw_relink_unlink(body: dict = Body({}), _: str = Depends(require_admin)):
    """Defait un rattachement : ses impressions repassent sans modele, ses candidats restent a choisir."""
    from ....services import mw_relink as R
    return {"ok": True, "count": await R.unlink(str(body.get("key") or ""))}


@router.post("/relink/ignore")
async def mw_relink_ignore(body: dict = Body({}), _: str = Depends(require_admin)):
    """« Aucun » : ce modele n'est pas sur MakerWorld (on : false le remet a trier)."""
    from ....services import mw_relink as R
    R.dismiss(str(body.get("key") or ""), body.get("on", True) is not False)
    return {"ok": True}


@router.post("/relink/search")
async def mw_relink_search(body: dict = Body({}), _: str = Depends(require_admin)):
    """Cherche a la main sous un autre nom ; les resultats deviennent ses candidats."""
    from ....services import mw_relink as R
    q = str(body.get("q") or "").strip()
    if not q:
        raise HTTPException(400, "Donne un nom à chercher")
    try:
        return {"candidates": await R.search_for(str(body.get("key") or ""), q)}
    except ValueError as e:
        raise HTTPException(502, str(e))
