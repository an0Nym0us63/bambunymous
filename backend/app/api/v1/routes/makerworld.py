"""MakerWorld : etat du cache des modeles, compte (connexion, j'aime,
favoris) et diagnostic. Lecture seule cote MakerWorld."""
import asyncio
import logging

from fastapi import APIRouter, Body, Depends, File, HTTPException, Request, UploadFile

from .auth import get_current_user, require_admin, require_mw
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
