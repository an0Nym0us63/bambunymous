"""
« À évaluer » : mes impressions terminées de modèles MakerWorld que je n'ai pas
encore évaluées, avec les photos de l'impression (ou, à défaut, de son groupe)
pour les joindre à l'évaluation.

Mes évaluations déjà publiées : comment-service/rating/my (compte connecté).
Sans compte connecté, la liste montre toutes les impressions (rien d'exclu).
"""
import asyncio
import logging
import time

logger = logging.getLogger(__name__)

RATED = "/comment-service/rating/my?offset={offset}&limit=50"
_CACHE = {}


def _design_id(h) -> str:
    """Modele d'une de mes evaluations (formes possibles de l'API)."""
    if not isinstance(h, dict):
        return None
    for k in ("designId", "design_id", "modelDesignId"):
        if str(h.get(k) or "").isdigit():
            return str(h[k])
    for k in ("design", "ratingItem", "rating"):
        sub = h.get(k)
        if isinstance(sub, dict):
            d = _design_id(sub) or (str(sub.get("id")) if k == "design" and str(sub.get("id") or "").isdigit() else None)
            if d:
                return d
    return None


def _is_rated(h) -> bool:
    """Une impression partagee cree chez MakerWorld une evaluation vide (score 0,
    sans texte ni photo) : elle reste a remplir. Sans champ score, on la compte faite."""
    if "score" not in h:
        return True
    return bool(h.get("score") or (h.get("content") or "").strip() or h.get("images"))


def _pending_of(h) -> dict:
    inst = h.get("instance") if isinstance(h.get("instance"), dict) else {}
    des = h.get("design") if isinstance(h.get("design"), dict) else {}
    return {"rating_id": h.get("id"), "profile_id": inst.get("profileId"), "profile_title": inst.get("titleTranslated") or inst.get("title"),
            "profile_cover": inst.get("cover"), "title": des.get("titleTranslated") or des.get("title"),
            "cover_url": des.get("coverUrl"), "date": h.get("createTime"),
            "success": h.get("successPrinted"), "creator_name": (inst.get("instUser") or {}).get("name")}


async def my_ratings(fresh: bool = False):
    """(modeles evalues, evaluations a remplir par modele) ; None si illisible."""
    from .makerworld import _get_json
    from .makerworld_account import token
    hit = _CACHE.get("ratings")
    if hit and not fresh and time.time() - hit[0] < 1800:
        return hit[1]
    tok = await token()
    if not tok:
        return None
    rated, pending, off = set(), {}, 0
    details = []
    for _ in range(40):
        code, d = await asyncio.to_thread(_get_json, RATED.format(offset=off), tok)
        if not isinstance(d, dict):
            if off == 0:
                return None
            break
        hits = next((d[k] for k in ("hits", "list", "profileRatings") if isinstance(d.get(k), list)), [])
        for h in hits:
            did = _design_id(h)
            if not did:
                continue
            if _is_rated(h):
                rated.add(did)
                imgs = h.get("images")
                details.append({"id": h.get("id"), "design_id": did, "score": h.get("score") or 0, "noscore": "score" not in h,
                                "content": h.get("content") or "", "at": h.get("createTime"),
                                "images": len(imgs) if isinstance(imgs, list) else 0})
            elif h.get("userCanRating", True):
                pd = _pending_of(h)
                lst = pending.setdefault(did, [])
                if pd["rating_id"] and all(x["rating_id"] != pd["rating_id"] for x in lst):
                    lst.append(pd)
        if len(hits) < 50:
            break
        off += 50
    out = (rated, pending)
    _CACHE["ratings"] = (time.time(), out)
    _CACHE["details"] = details
    return out


async def rating_details() -> list:
    """Mes evaluations publiees (pour les succes) : id, note, texte, photos, date."""
    if await my_ratings() is None:
        return []
    return list(_CACHE.get("details") or [])


def _forget_pending(did: str, rid: str):
    """Fiche publiee : retiree de la liste en memoire (sans tout relire chez MakerWorld)."""
    hit = _CACHE.get("ratings")
    if not hit:
        return
    rated, pending = hit[1]
    left = [x for x in pending.get(did, []) if str(x.get("rating_id")) != rid]
    if left:
        pending[did] = left
    else:
        pending.pop(did, None)
        rated.add(did)


async def rated_designs(fresh: bool = False):
    """Modeles que j'ai deja evalues ; None si la liste est illisible (pas de compte...)."""
    r = await my_ratings(fresh)
    return None if r is None else r[0]


async def pending_ratings(fresh: bool = False) -> dict:
    r = await my_ratings(fresh)
    return {} if r is None else r[1]


async def own_designs():
    """Mes propres modeles (on n'evalue pas ce qu'on a publie) : mon uid et la
    liste de mes modeles publies. Vide si le compte n'est pas connecte."""
    uid, ids = None, set()
    try:
        from .makerworld_account import _my_uid
        uid = await _my_uid()
    except Exception:
        return None, ids
    try:
        from . import mw_creator
        ids = {str(m["design_id"]) for m in await mw_creator.models()}
    except Exception:
        logger.exception("[MW] mes modeles (a evaluer)")
    return uid, ids


async def rate_status(design_id: str, fresh: bool = False) -> dict:
    """Ou en est l'evaluation d'un modele, et pourquoi il est (ou n'est pas) dans « A evaluer »."""
    from sqlalchemy import select, func
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .makerworld_account import DONE_STATUSES
    did = str(design_id or "").strip()
    r = await my_ratings(fresh)
    _uid, mine = await own_designs()
    async with AsyncSessionLocal() as db:
        done = (await db.execute(select(func.count(Print.id)).where(Print.design_id == did, Print.status.in_(DONE_STATUSES)))).scalar() or 0
    if did in (mine or set()):
        return {"state": "mine", "done": done}
    if r is None:
        return {"state": "unknown", "done": done}
    rated, pending = r
    det = [d for d in (_CACHE.get("details") or []) if d.get("design_id") == did]
    if did in pending:
        return {"state": "pending", "done": done, "profiles": len(pending[did])}
    if did in rated:
        best = max(det, key=lambda d: d.get("score") or 0) if det else {}
        return {"state": "rated", "done": done, "score": best.get("score") or 0, "noscore": bool(det) and all(d.get("noscore") for d in det)}
    return {"state": "to_rate" if done else "no_print", "done": done}


async def to_rate(fresh: bool = False) -> dict:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, MakerWorldDesign as MW
    from ..api.v1.routes.filaments import gallery_items
    from .makerworld_account import DONE_STATUSES
    rated = await rated_designs(fresh)
    pending = await pending_ratings()
    stats = {"rated": len(rated), "pending": len(pending)} if rated is not None else None
    my_uid, mine = await own_designs()
    async with AsyncSessionLocal() as db:
        prints = (await db.execute(
            select(Print).options(selectinload(Print.snapshots), selectinload(Print.group))
            .where(Print.design_id.isnot(None), Print.status.in_(DONE_STATUSES))
            .order_by(Print.print_date.desc()))).scalars().all()
        prints = [p for p in prints if str(p.design_id or "").strip().isdigit()]
        if rated:                                   # deja note, sauf si MakerWorld attend encore une note (autre profil)
            prints = [p for p in prints if str(p.design_id) not in rated or str(p.design_id) in pending]
        prints = [p for p in prints if str(p.design_id) not in mine]
        own_mw = set()
        cand = list({str(p.design_id) for p in prints} | set(pending))
        if my_uid and cand:                         # mes modeles absents de la liste publiee (createur connu)
            own_mw = {m.design_id for m in (await db.execute(select(MW).where(
                MW.design_id.in_(cand), MW.creator_uid == my_uid))).scalars().all()}
            prints = [p for p in prints if str(p.design_id) not in own_mw]
        pending = {k: v for k, v in pending.items() if k not in mine and k not in own_mw}
        if not prints and not pending:
            return {"items": [], "rated_known": rated is not None, "stats": stats}
        gal = await gallery_items(db, prints, {}) if prints else {"prints": []}
        ids = list({str(p.design_id) for p in prints} | set(pending))
        mws = {m.design_id: m for m in (await db.execute(select(MW).where(MW.design_id.in_(ids)))).scalars().all()}
    by_print = {it["id"]: it for it in gal["prints"]}
    items = {}
    for p in prints:
        did = str(p.design_id)
        g = by_print.get(p.id) or {}
        it = items.get(did)
        if it is None:
            m = mws.get(did)
            it = items[did] = {"design_id": did, "title": (m.title_fr or m.title) if m else None,
                               "cover_url": m.cover_url if m else None,
                               "creator_name": m.creator_name if m else None,
                               "url": f"https://makerworld.com/fr/models/{did}", "printed": 0,
                               "last_date": p.print_date.isoformat() if p.print_date else None,
                               "photos": [], "photo_source": None, "print_ids": []}
        it["printed"] += 1
        it["print_ids"].append(p.id)
        # Photos : celles du print le plus recent qui en a ; sinon celles de son groupe.
        imgs = [u for u in (g.get("photos") or []) if u.split("?")[0].lower().endswith(tuple(_MIME))]
        if not it["photos"] and imgs:
            it["photos"], it["photo_source"] = imgs[:8], g.get("photo_source")
            it["print_name"] = g.get("name")
    # Ce que MakerWorld attend : lien direct vers le profil imprime, et les
    # impressions partagees absentes de mon historique local.
    # MakerWorld cree une fiche a remplir par PROFIL imprime : un modele peut en
    # attendre plusieurs ; une seule evaluation dans l'appli les remplit toutes.
    for did, pds in pending.items():
        pd = pds[0]
        it = items.get(did)
        if it is None:
            m = mws.get(did)
            it = items[did] = {"design_id": did, "title": ((m.title_fr or m.title) if m else None) or pd["title"],
                               "cover_url": (m.cover_url if m else None) or pd["cover_url"],
                               "creator_name": (m.creator_name if m else None) or pd["creator_name"],
                               "printed": 0, "last_date": pd["date"], "photos": [], "photo_source": None, "print_ids": []}
        it["awaited"] = True
        it["rating_id"] = str(pd["rating_id"]) if pd.get("rating_id") else None
        it["rating_ids"] = [str(x["rating_id"]) for x in pds if x.get("rating_id")]
        it["profiles"] = [{"rating_id": str(x["rating_id"]), "title": x["profile_title"]} for x in pds if x.get("rating_id")]
        it["profile_title"] = pd["profile_title"] if len(pds) == 1 else f"{len(pds)} profils"
        if pd["profile_id"]:
            it["url"] = f"https://makerworld.com/fr/models/{did}#profileId-{pd['profile_id']}"
        else:
            it.setdefault("url", f"https://makerworld.com/fr/models/{did}")
    # Mes evaluations lues : seul ce que MakerWorld attend vraiment est « a
    # evaluer » (une impression qu'il n'attend pas est deja notee, ou ne peut
    # pas l'etre). Illisibles : on montre tout, faute de mieux.
    vals = [x for x in items.values() if x.get("awaited")] if rated is not None else list(items.values())
    out = sorted(vals, key=lambda x: x["last_date"] or "", reverse=True)
    out.sort(key=lambda x: not x["photos"])                 # avec photos d'abord, puis les plus recents
    return {"items": out, "rated_known": rated is not None, "stats": stats}


# ── Publier une evaluation depuis l'appli (geste explicite de l'utilisateur) ──
# Requetes relevees sur makerworld.com (19/10/2026) :
#   POST /design-user-service/my/upload {useType: "makerworld/comment", fileNames}
#        -> adresse d'envoi de chaque photo
#   PUT  /comment-service/rating/{id} {score, content, images, ratingExtension}
# On ne complete que l'evaluation vide que MakerWorld attend (son id est connu).
UPLOAD = "/design-user-service/my/upload"
MAX_PHOTOS = 8
_MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def _tmp_dir():
    import os
    from pathlib import Path
    return Path(os.getenv("DATA_DIR", "/data")) / "mw_rate_tmp"


def save_extra(raw: bytes, content_type: str) -> str:
    """Photo choisie hors de la galerie, gardee le temps de publier l'evaluation."""
    import time, uuid
    from .makerworld_account import AccountError
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get((content_type or "").lower())
    if not ext:
        raise AccountError("Photo JPEG, PNG ou WebP seulement")
    if not raw or len(raw) > 15 * 1024 * 1024:
        raise AccountError("Photo vide ou trop lourde (15 Mo au plus)")
    d = _tmp_dir()
    d.mkdir(parents=True, exist_ok=True)
    for old in d.iterdir():                       # menage : oubliees depuis un jour
        try:
            if time.time() - old.stat().st_mtime > 86400:
                old.unlink()
        except OSError:
            pass
    name = uuid.uuid4().hex + ext
    (d / name).write_bytes(raw)
    return f"tmp:{name}"


def _local_photo(url: str):
    """/api/v1/prints/{id}/file/{nom} (galerie) ou tmp:{nom} (photo ajoutee
    pour l'evaluation) -> fichier sur disque."""
    import os, re
    from pathlib import Path
    t = re.fullmatch(r"tmp:([0-9a-f]{32}\.(?:jpg|png|webp))", url or "")
    if t:
        f = _tmp_dir() / t.group(1)
        return f if f.is_file() else None
    # Photo d'un print, ou photo ajoutee directement a son groupe.
    m = re.fullmatch(r"/api/v1/prints/(\d+)/file/([^/\\]+)", url or "")
    g = re.fullmatch(r"/api/v1/prints/groups/(\d+)/photo/([^/\\]+)", url or "")
    if not (m or g):
        return None
    m = m or g
    base = (Path(os.getenv("DATA_DIR", "/data")) / ("prints" if m is not g else "groups") / m.group(1)).resolve()
    f = (base / m.group(2)).resolve()
    if f.parent != base or not f.is_file() or f.suffix.lower() not in _MIME:
        return None
    return f


def _urls(o, out):
    if isinstance(o, str) and o.startswith("http"):
        out.append(o)
    elif isinstance(o, dict):
        for v in o.values():
            _urls(v, out)
    elif isinstance(o, list):
        for v in o:
            _urls(v, out)
    return out


def _shape(o, depth=0):
    """Forme d'une reponse sans ses valeurs (pour le journal, jamais d'adresse signee)."""
    if depth > 3:
        return "..."
    if isinstance(o, dict):
        return {k: _shape(v, depth + 1) for k, v in o.items()}
    if isinstance(o, list):
        return [_shape(o[0], depth + 1)] if o else []
    return type(o).__name__


def _upload_photo(f, tok: str) -> str:
    """Envoie une photo chez MakerWorld ; rend son adresse publique, verifiee."""
    from urllib.parse import urlsplit
    from .makerworld import session
    from .makerworld_account import _send, AccountError
    mime = _MIME[f.suffix.lower()]
    d = _send("POST", UPLOAD, {"useType": "makerworld/comment", "fileNames": [f.name]}, tok)
    urls = _urls(d, [])
    signed = [u for u in urls if "?" in u]
    if not signed:
        logger.warning(f"[MW] envoi de photo : reponse inattendue {_shape(d)}")
        raise AccountError("MakerWorld n'a pas donné d'adresse d'envoi pour la photo")
    put = signed[0]
    try:
        r = session().put(put, data=f.read_bytes(), headers={"Content-Type": mime}, timeout=60)
    except Exception as e:
        raise AccountError(f"Envoi de la photo impossible ({type(e).__name__})")
    if r.status_code >= 300:
        logger.warning(f"[MW] envoi de photo refuse HTTP {r.status_code} ; reponse {_shape(d)}")
        raise AccountError(f"Envoi de la photo refusé (HTTP {r.status_code})")
    # Adresse publique : celle donnee par la reponse, sinon l'adresse d'envoi sans
    # sa signature, ou le meme chemin sur le CDN de MakerWorld. On garde la
    # premiere qui repond vraiment une image.
    path = urlsplit(put).path
    cands = [u for u in urls if "?" not in u] + [put.split("?")[0]]
    i = path.find("/makerworld/")
    if i >= 0:
        cands.append("https://makerworld.bblmw.com" + path[i:])
    for u in dict.fromkeys(cands):
        try:
            g = session().get(u, timeout=20, stream=True)
            ok = g.status_code == 200 and g.headers.get("content-type", "").startswith("image/")
            g.close()
        except Exception:
            ok = False
        if ok:
            return u
    logger.warning(f"[MW] photo envoyee mais introuvable ; reponse {_shape(d)}")
    raise AccountError("Photo envoyée mais son adresse publique est introuvable : évaluation non publiée")


# Une evaluation a la fois, photos comprises, avec une pause entre deux : si
# on en enchaine plusieurs (ou depuis deux appareils), MakerWorld les recoit
# l'une apres l'autre, comme depuis le site, jamais en rafale.
_ONE_AT_A_TIME = asyncio.Lock()
PAUSE_S = (4.0, 9.0)                      # entre deux publications (tirage dans l'intervalle)
_last_done = [0.0]


async def _one_at_a_time(coro_fn):
    import random
    async with _ONE_AT_A_TIME:
        wait = _last_done[0] + random.uniform(*PAUSE_S) - time.time()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            return await coro_fn()
        finally:
            _last_done[0] = time.time()


async def submit(design_id: str, rating_id: str, score: int, content: str, photos: list) -> dict:
    return await _one_at_a_time(lambda: _submit(design_id, rating_id, score, content, photos))


async def forget(design_id: str, rating_id: str) -> dict:
    """Oublie sur MakerWorld une evaluation A FAIRE (fiche vide), sans evaluer.
    Requete relevee sur makerworld.com (19/10/2026) :
    DELETE /comment-service/rating/{id} {ratingId}. Seulement une fiche que
    MakerWorld attend encore : jamais une evaluation deja remplie."""
    return await _one_at_a_time(lambda: _forget(design_id, rating_id))


async def _forget(design_id: str, rating_id: str) -> dict:
    from .makerworld_account import _send, _tok, AccountError
    did, rid = str(design_id or "").strip(), str(rating_id or "").strip()
    pend = (await pending_ratings()).get(did) or []
    if not rid.isdigit() or rid not in {str(x.get("rating_id")) for x in pend}:
        raise AccountError("Cette évaluation n'est plus attendue par MakerWorld (déjà faite ou oubliée ?)")
    tok = await _tok()
    await asyncio.to_thread(_send, "DELETE", f"/comment-service/rating/{rid}", {"ratingId": int(rid)}, tok)
    logger.info(f"[MW] evaluation a faire oubliee : modele {did}, fiche {rid}")
    _forget_pending(did, rid)
    return {"ok": True}


async def _submit(design_id: str, rating_id: str, score: int, content: str, photos: list) -> dict:
    from .makerworld_account import _send, _tok, AccountError
    did, rid = str(design_id or "").strip(), str(rating_id or "").strip()
    pend = (await pending_ratings()).get(did) or []      # liste gardee 30 min, tenue a jour ci-dessous
    if rid not in {str(x.get("rating_id")) for x in pend}:
        raise AccountError("Cette évaluation n'est plus attendue par MakerWorld (déjà faite ?)")
    try:
        score = int(score)
    except (TypeError, ValueError):
        score = 0
    if not 1 <= score <= 5:
        raise AccountError("Choisis une note de 1 à 5 étoiles")
    content = (content or "").strip()
    if score < 4 and len(content) < 10:
        raise AccountError("Pour une note basse, explique le problème (10 caractères au moins)")
    if len(content) > 2000:
        raise AccountError("Texte trop long (2000 caractères au plus)")
    files = []
    for u in (photos or [])[:MAX_PHOTOS]:
        f = _local_photo(u)
        if not f:
            raise AccountError(f"Photo introuvable ou format non pris en charge : {(u or '').split('/')[-1]}")
        files.append(f)
    tok = await _tok()
    images = [await asyncio.to_thread(_upload_photo, f, tok) for f in files]
    await asyncio.to_thread(_send, "PUT", f"/comment-service/rating/{rid}",
                            {"score": score, "content": content, "images": images,
                             "ratingExtension": {"lowScoreDetails": []}}, tok)
    logger.info(f"[MW] evaluation publiee : modele {did}, {score} etoiles, {len(images)} photo(s)")
    _forget_pending(did, rid)
    for f in files:                               # photos ajoutees : plus utiles une fois publiees
        if f.parent == _tmp_dir():
            f.unlink(missing_ok=True)
    return {"ok": True, "photos": len(images)}


# ── Messages d'evaluation tout faits, ranges par familles ────────────────────
# Une famille = un nom et autant de messages qu'on veut ; a l'evaluation, on
# choisit la famille et un message est tire au hasard. {modèle} et {créateur}
# sont remplaces dans l'appli. La premiere famille est celle proposee d'office.
K_TEMPLATES = "MW_RATE_TEMPLATES"
DEFAULT_TEMPLATES = [{"name": "Générique", "messages": [
    "Très belle impression, sortie propre du premier coup. Le modèle est bien conçu et le profil fourni "
    "fonctionne parfaitement, je n'ai rien eu à ajuster. Merci {créateur} pour le partage !",
    "Excellent modèle ! L'impression s'est très bien déroulée et le résultat est vraiment réussi, fidèle "
    "aux photos. On sent le soin apporté à la conception. Je recommande sans hésiter.",
    "Impression réussie et rendu impeccable. Les réglages proposés sont bien pensés et le résultat final "
    "est à la hauteur. Merci beaucoup pour ce partage, {modèle} est une vraie réussite.",
    "Rien à redire : le fichier est propre, l'impression se passe sans accroc et le résultat est très "
    "satisfaisant. Un modèle de qualité, merci {créateur} pour ton travail !",
    "Super modèle, très agréable à imprimer. La finition est soignée et tout s'est déroulé comme prévu "
    "du début à la fin. Merci pour le partage et bravo pour la conception !",
]}]


def _clean_templates(fams) -> list:
    out, seen = [], set()
    for f in fams if isinstance(fams, list) else []:
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "").strip()[:60]
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        msgs = [str(m).strip()[:2000] for m in (f.get("messages") or []) if str(m or "").strip()][:200]
        out.append({"name": name, "messages": msgs})
    return out[:50]


async def templates() -> list:
    import json
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, K_TEMPLATES, "")
    try:
        fams = _clean_templates(json.loads(raw)) if raw else None
    except ValueError:
        fams = None
    return fams if fams is not None else DEFAULT_TEMPLATES


async def set_templates(fams) -> list:
    import json
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    clean = _clean_templates(fams)
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_TEMPLATES, json.dumps(clean, ensure_ascii=False))
    return clean


# ── File d'attente des publications, cote serveur ────────────────────────────
# Publier = deposer dans la file et rendre la main : le serveur publie ensuite
# une evaluation a la fois (submit). La file est gardee sur disque : quitter la
# page, recharger ou redemarrer ne perd rien, et l'appli relit son etat.
_JOBS = []                     # {id, design_id, title, rating_id, score, content, photos, status, detail, ts}
_WORKER = [None]
_KEEP_S = 600                  # une publication terminee reste visible 10 min


def _queue_file():
    return _tmp_dir().parent / "mw_rate_queue.json"


def _persist():
    import json
    try:
        f = _queue_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps([j for j in _JOBS if j["status"] in ("queued", "sending")], ensure_ascii=False), encoding="utf-8")
    except OSError:
        logger.exception("[MW] file des evaluations : ecriture impossible")


def _public(j) -> dict:
    return {**{k: j[k] for k in ("id", "design_id", "title", "status", "detail", "ts")}, "action": j.get("action", "rate")}


def queue_state() -> dict:
    now = time.time()
    _JOBS[:] = [j for j in _JOBS if j["status"] in ("queued", "sending") or now - j["ts"] < _KEEP_S]
    return {"jobs": [_public(j) for j in _JOBS]}


def enqueue(design_id, rating_id, score, content, photos, title=None, action="rate") -> dict:
    import uuid
    from .makerworld_account import AccountError
    try:
        score = int(score)
    except (TypeError, ValueError):
        score = 0
    if action == "rate" and not 1 <= score <= 5:
        raise AccountError("Choisis une note de 1 à 5 étoiles")
    did, rid = str(design_id or "").strip(), str(rating_id or "").strip()
    if not did.isdigit() or not rid.isdigit():
        raise AccountError("Évaluation inconnue")
    if any(j["rating_id"] == rid and j["status"] in ("queued", "sending") for j in _JOBS):
        raise AccountError("Cette évaluation est déjà en file")
    j = {"id": uuid.uuid4().hex[:12], "design_id": did, "title": (title or "")[:200] or f"Modèle {did}",
         "action": "forget" if action == "forget" else "rate",
         "rating_id": rid, "score": score, "content": content or "", "photos": list(photos or [])[:MAX_PHOTOS],
         "status": "queued", "detail": "", "ts": time.time()}
    _JOBS.append(j)
    _persist()
    _start_worker()
    return _public(j)


def dismiss(job_id: str):
    _JOBS[:] = [j for j in _JOBS if not (j["id"] == job_id and j["status"] in ("done", "error"))]


def _start_worker():
    if _WORKER[0] is None or _WORKER[0].done():
        _WORKER[0] = asyncio.get_event_loop().create_task(_work())


async def _work():
    from .makerworld_account import AccountError
    while True:
        j = next((x for x in _JOBS if x["status"] == "queued"), None)
        if not j:
            return
        j["status"], j["ts"] = "sending", time.time()
        try:
            if j.get("action") == "forget":
                await forget(j["design_id"], j["rating_id"])
                j["status"], j["detail"] = "done", ""
            else:
                r = await submit(j["design_id"], j["rating_id"], j["score"], j["content"], j["photos"])
                j["status"], j["detail"] = "done", f"{r.get('photos', 0)} photo(s)"
        except AccountError as e:
            j["status"], j["detail"] = "error", str(e)
        except Exception as e:
            logger.exception("[MW] publication d'une evaluation")
            j["status"], j["detail"] = "error", f"Erreur inattendue ({type(e).__name__})"
        j["ts"] = time.time()
        _persist()


async def resume_queue():
    """Au demarrage : reprend les publications laissees en file."""
    import json
    try:
        saved = json.loads(_queue_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    for j in saved if isinstance(saved, list) else []:
        if isinstance(j, dict) and j.get("rating_id") and not any(x["id"] == j.get("id") for x in _JOBS):
            j["status"], j["ts"] = "queued", time.time()
            _JOBS.append(j)
    if _JOBS:
        logger.info(f"[MW] {len(_JOBS)} evaluation(s) reprise(s) en file")
        _start_worker()
