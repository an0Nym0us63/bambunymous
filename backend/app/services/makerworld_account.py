"""
Compte MakerWorld / Bambu : connexion et lecture de ce qui est personnel
(modeles aimes, favoris), en LECTURE SEULE -- rien n'est jamais aime,
range ni publie depuis l'appli.

Connexion par l'API de connexion Bambu (api.bambulab.com) :
  - e-mail + mot de passe ;
  - si Bambu demande un code (loginType "verifyCode"), il l'envoie par e-mail
    et on se reconnecte avec ce code ;
  - double authentification (loginType "tfa") : sa page de validation est
    derriere Cloudflare, inaccessible a un serveur ; on propose alors de
    coller un jeton (cookie « token » du site, connecte).
Le mot de passe n'est jamais garde : seul le jeton l'est (reglage MW_TOKEN,
jamais renvoye au navigateur). Il dure environ 3 mois.

API non officielle (retro-ingenierie de l'appli Bambu Handy) : les formes de
reponse ne sont pas documentees, d'ou une lecture defensive des listes et un
diagnostic qui montre la reponse brute. Tout echec rend un etat lisible, rien
ne leve vers le reste de l'appli.
"""
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

LOGIN = "https://api.bambulab.com/v1/user-service/user/login"
SEND_CODE = "https://api.bambulab.com/v1/user-service/user/sendemail/code"
K_TOKEN, K_ACCOUNT = "MW_TOKEN", "MW_ACCOUNT"

# Chemins lisibles par le diagnostic (lecture seule, liste fermee).
DEBUG_PATHS = {
    "profil": "/design-user-service/my/preference",
    "aimes": "/design-service/my/design/like?offset=0&limit=5",
    "favoris": "/design-service/my/favorites",
    "favoris_ids": "/design-service/my/favorites/listlite",
    # Createur (statistiques, points) : formes a relever avant de s'en servir.
    "createur_profil": "/design-user-service/my/profile",
    "createur_modeles": "/design-user-service/my/creatortools/design/list?offset=0&limit=3",
    "points_historique": "/point-service/point-bill/my?offset=0&limit=5",
    "points_progression": "/point-service/point-bill/progress",
    # Boosts : droits disponibles (le reste se lit par modele).
    "boosts_dispos": "/point-service/boost/boostingright?filter=available&offset=0&limit=5",
    # Mes evaluations publiees (« A evaluer » les retire).
    "mes_evaluations": "/comment-service/rating/my?offset=0&limit=3",
}


class AccountError(Exception):
    pass


def _post(url: str, body: dict):
    import requests
    try:
        r = requests.post(url, json=body, timeout=20,
                          headers={"User-Agent": "Mozilla/5.0 (BambuNymous)",
                                   "Content-Type": "application/json"})
    except Exception as e:
        raise AccountError(f"Bambu injoignable ({type(e).__name__})")
    try:
        data = r.json()
    except ValueError:
        data = {}
    return r.status_code, data if isinstance(data, dict) else {}


async def _get(key, default=""):
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        return await get_setting(db, key, default) or default


async def _set(key, value):
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, key, value)


async def token() -> str:
    return (await _get(K_TOKEN)).strip()


async def _profile(tok: str):
    """Profil (uid, nom, pseudo, avatar) : verifie aussi que le jeton marche."""
    import asyncio
    from .makerworld import _get_json
    code, d = await asyncio.to_thread(_get_json, DEBUG_PATHS["profil"], tok)
    if code == 401:
        raise AccountError("Jeton refusé ou expiré")
    if not isinstance(d, dict) or not d.get("uid"):
        raise AccountError("Profil illisible (l'API a peut-être changé)")
    return {"uid": d.get("uid"), "name": d.get("name"), "handle": d.get("handle"),
            "avatar": d.get("avatar")}


async def _connected(tok: str) -> dict:
    prof = await _profile(tok)
    acc = {**prof, "connected_at": datetime.utcnow().isoformat()}
    await _set(K_TOKEN, tok)
    await _set(K_ACCOUNT, json.dumps(acc))
    logger.info(f"[MW] compte connecte : {prof.get('handle') or prof.get('uid')}")
    return {"step": "done", "account": acc}


async def login(account: str, password: str = "", code: str = "") -> dict:
    """Connexion. Rend {"step": "done"|"code"|"tfa", ...}."""
    import asyncio
    account = (account or "").strip()
    if not account or not (password or code):
        raise AccountError("E-mail et mot de passe (ou code) requis")
    body = {"account": account}
    body.update({"code": code.strip()} if code else {"password": password})
    st, d = await asyncio.to_thread(_post, LOGIN, body)
    tok = d.get("accessToken") or ""
    if tok:
        return await _connected(tok)
    lt = d.get("loginType") or ""
    if lt == "verifyCode":
        await asyncio.to_thread(_post, SEND_CODE, {"email": account, "type": "codeLogin"})
        return {"step": "code", "message": "Bambu a envoyé un code par e-mail : saisis-le."}
    if lt == "tfa":
        return {"step": "tfa", "message": "Double authentification active : sa validation n'est pas "
                "accessible depuis un serveur. Colle plutôt un jeton (voir l'aide)."}
    raise AccountError(d.get("error") or f"Connexion refusée (HTTP {st})")


async def set_token(tok: str) -> dict:
    tok = (tok or "").strip()
    if tok.lower().startswith("bearer "):
        tok = tok[7:].strip()
    if not tok or len(tok) > 4000:
        raise AccountError("Jeton vide ou invalide")
    return await _connected(tok)


async def logout() -> None:
    await _set(K_TOKEN, "")
    await _set(K_ACCOUNT, "")


async def status() -> dict:
    tok = await token()
    try:
        acc = json.loads(await _get(K_ACCOUNT) or "null")
    except ValueError:
        acc = None
    return {"connected": bool(tok), "account": acc if tok else None}


def _items(d):
    """La liste d'elements d'une reponse dont la forme n'est pas documentee."""
    if isinstance(d, list):
        return d
    if isinstance(d, dict):
        for k in ("hits", "list", "items", "designs", "favorites", "data", "result", "rows"):
            v = d.get(k)
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                inner = _items(v)
                if inner:
                    return inner
    return []


def _design_of(it) -> dict:
    """Un modele (id, titre, couverture, createur) tire d'un element de liste."""
    if isinstance(it, (int, str)) and str(it).isdigit():
        return {"design_id": str(it)}
    if not isinstance(it, dict):
        return None
    d = it.get("design") if isinstance(it.get("design"), dict) else it
    did = d.get("designId") or d.get("id")
    if not did or not str(did).isdigit():
        return None
    cr = d.get("designCreator") if isinstance(d.get("designCreator"), dict) else {}
    return {"design_id": str(did), "title": d.get("title"),
            "title_fr": d.get("titleTranslated") if isinstance(d.get("titleTranslated"), str) and d.get("titleTranslated") else None,
            "cover_url": d.get("cover") or d.get("coverUrl"),
            "creator_name": cr.get("name"),
            # pour ouvrir la page du createur depuis une tuile (collections, j'aime)
            "creator_uid": str(cr.get("uid")) if str(cr.get("uid") or "").isdigit() else None}


def _must(code, d, what: str = "MakerWorld") -> None:
    """Reponse illisible ou absente (reseau, routage, panne) : erreur, jamais
    une liste vide -- sinon tout ce qu'on compare semblerait avoir disparu."""
    if code == 401:
        raise AccountError("Jeton refusé ou expiré : reconnecte le compte")
    if code != 200 or d is None:
        raise AccountError(f"{what} injoignable pour le moment (HTTP {code or 'aucune réponse'})")


async def _list(path_fmt: str, max_items: int = 300) -> list:
    """Parcourt une liste paginee (offset/limit) de modeles."""
    import asyncio
    from .makerworld import _get_json
    tok = await token()
    if not tok:
        raise AccountError("Compte MakerWorld non connecté")
    out, seen, offset = [], set(), 0
    while len(out) < max_items:
        code, d = await asyncio.to_thread(_get_json, path_fmt.format(offset=offset, limit=50), tok)
        _must(code, d)
        page = [x for x in (_design_of(i) for i in _items(d)) if x and x["design_id"] not in seen]
        if not page:
            break
        for x in page:
            seen.add(x["design_id"])
        out += page
        if "{offset}" not in path_fmt:
            break
        offset += 50
    return out[:max_items]


LISTS = {
    "likes": "/design-service/my/design/like?offset={offset}&limit={limit}",
}
COLLECTIONS = "/design-service/my/favorites/listlite"
COLLECTION_DESIGNS = "/design-service/favorites/{cid}/designs?offset={{offset}}&limit={{limit}}"


DONE_STATUSES = ("SUCCESS", "PARTIAL")


async def _enrich(items: list) -> dict:
    """Ajoute a chaque modele ce que l'appli en sait : fiche en cache et
    nombre de fois imprime. Les listes portent deja titre, couverture et
    createur ; seuls les modeles qui n'en ont pas sont lus en arriere-plan."""
    from sqlalchemy import select, func
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, MakerWorldDesign as MW
    from .makerworld import to_dict, launch_many
    ids = [x["design_id"] for x in items]
    async with AsyncSessionLocal() as db:
        cache = {m.design_id: m for m in (await db.execute(
            select(MW).where(MW.design_id.in_(ids)))).scalars().all()} if ids else {}
        rows = (await db.execute(
            select(Print.design_id, Print.status, Print.plate_id, Print.mw_profile_id, Print.mw_plates)
            .where(Print.design_id.in_(ids)))).all() if ids else []
    # « Imprime » = termine (reussi ou partiel) ; un print en cours se compte
    # a part. Plateaux distincts : 3 impressions peuvent etre 3 plateaux.
    done, plates, running = {}, {}, {}
    from .makerworld import plate_keys
    for did, st, plate, prof, manual in rows:
        if st in DONE_STATUSES:
            done[did] = done.get(did, 0) + 1
            plates.setdefault(did, set()).update(k.split(":", 1)[1] for k in plate_keys(plate, prof, manual))
        elif st == "IN_PROGRESS":
            running[did] = running.get(did, 0) + 1
    out = []
    for x in items:
        m = to_dict(cache.get(x["design_id"])) or {}
        d = x["design_id"]
        out.append({**{k: v for k, v in m.items() if v}, **{k: v for k, v in x.items() if v},
                    "printed": done.get(d, 0), "plates_printed": len(plates.get(d, ())),
                    "in_progress": running.get(d, 0),
                    "url": f"https://makerworld.com/fr/models/{d}"})
    missing = [x["design_id"] for x in out if not x.get("title")]
    if missing:
        launch_many(missing)
    return {"items": out, "pending": len(missing)}


# Petits caches (2 min) : rouvrir une collection ou revenir sur l'onglet ne
# relit pas MakerWorld. Toute ecriture les vide.
_LIST_CACHE = {}
_LIST_TTL = 7200          # 2 h : le prechargement horaire les rafraichit


def _cache_get(key):
    import time
    hit = _LIST_CACHE.get(key)
    return hit[1] if hit and time.time() - hit[0] < _LIST_TTL else None


def _cache_put(key, val):
    import time
    _LIST_CACHE[key] = (time.time(), val)
    return val


def _cache_clear():
    _LIST_CACHE.clear()
    _MINE[:] = [0.0, None]


# ── « Deja chez moi ? » (en parcourant chez un copain) ─────────────────────
# Index modele -> mes collections et mes j'aime, construit en parcourant mes
# listes (pages en cache), garde 30 min et vide a chaque ecriture.
_MINE = [0.0, None]
MINE_TTL = 1800
MINE_MAX = 600            # modeles lus au plus par liste


async def _mine_index() -> dict:
    import time
    if _MINE[1] is not None and time.time() - _MINE[0] < MINE_TTL:
        return _MINE[1]
    idx = {"colls": {}, "likes": set()}
    if await token():
        for c in (await collections())["collections"]:
            off = 0
            while off < MINE_MAX:
                p = await _page(COLLECTION_DESIGNS.format(cid=c["id"]), off, 50)
                for x in p["items"]:
                    idx["colls"].setdefault(x["design_id"], []).append(c["title"])
                if len(p["items"]) < 50 or (p["total"] is not None and off + 50 >= p["total"]):
                    break
                off += 50
        off = 0
        while off < MINE_MAX:
            p = await _page(LISTS["likes"], off, 50)
            idx["likes"].update(x["design_id"] for x in p["items"])
            if len(p["items"]) < 50 or (p["total"] is not None and off + 50 >= p["total"]):
                break
            off += 50
    _MINE[:] = [time.time(), idx]
    return idx


async def mine(ids: list) -> dict:
    """Pour chaque modele : imprime chez moi (combien, plateaux), dans quelles
    de mes collections, aime par moi."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    ids = [str(i) for i in ids if str(i).isdigit()][:200]
    out = {i: {"printed": 0, "in_progress": 0, "collections": [], "liked": False} for i in ids}
    if not ids:
        return {"items": out}
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.design_id, Print.status).where(Print.design_id.in_(ids)))).all()
    for did, st in rows:
        if st in DONE_STATUSES:
            out[did]["printed"] += 1
        elif st == "IN_PROGRESS":
            out[did]["in_progress"] += 1
    try:
        idx = await _mine_index()
        for i in ids:
            out[i]["collections"] = idx["colls"].get(i, [])
            out[i]["liked"] = i in idx["likes"]
        known = True
    except Exception as e:
        logger.info(f"[MW] index « chez moi » indisponible : {e}")
        known = False
    return {"items": out, "collections_known": known}


async def _page(path_fmt: str, offset: int, limit: int, fresh: bool = False) -> dict:
    """UNE page d'une liste de modeles : le front affiche les premiers tout de
    suite et demande la suite au defilement."""
    import asyncio
    from .makerworld import _get_json
    tok = await _tok()
    key = (path_fmt, offset, limit)
    hit = None if fresh else _cache_get(key)
    if hit is not None:
        return hit
    code, d = await asyncio.to_thread(_get_json, path_fmt.format(offset=offset, limit=limit), tok)
    _must(code, d)
    items = [x for x in (_design_of(i) for i in _items(d)) if x]
    total = d.get("total") if isinstance(d, dict) and isinstance(d.get("total"), int) else None
    return _cache_put(key, {"items": items, "total": total})


async def _paged(path_fmt: str, offset: int, limit: int, fresh: bool = False) -> dict:
    offset, limit = max(0, int(offset or 0)), max(1, min(int(limit or 30), 60))
    p = await _page(path_fmt, offset, limit, fresh)
    res = await _enrich(p["items"])
    total = p["total"]
    more = (offset + len(p["items"]) < total) if total is not None else len(p["items"]) >= limit
    return {**res, "total": total, "offset": offset, "has_more": bool(more)}


async def collection(kind: str, offset: int = 0, limit: int = 30, fresh: bool = False) -> dict:
    """Modeles aimes, par pages, enrichis (fiche, deja imprime)."""
    if kind not in LISTS:
        raise AccountError("Liste inconnue")
    return await _paged(LISTS[kind], offset, limit, fresh)


async def collections(fresh: bool = False) -> dict:
    """Mes collections de favoris : nom, quelques couvertures, nombre de
    modeles quand l'API le donne."""
    import asyncio
    from .makerworld import _get_json
    tok = await token()
    if not tok:
        raise AccountError("Compte MakerWorld non connecté")
    hit = None if fresh else _cache_get(("collections", tok[-12:]))
    if hit is not None:
        return hit
    code, d = await asyncio.to_thread(_get_json, COLLECTIONS, tok)
    _must(code, d, "La liste des collections")
    out = []
    for it in _items(d):
        if not isinstance(it, dict) or not str(it.get("id") or "").isdigit():
            continue
        covers = [c for c in (it.get("designCover") or []) if isinstance(c, str) and c][:4]
        if not covers and isinstance(it.get("cover"), str) and it["cover"]:
            covers = [it["cover"]]
        cnt = it.get("designCnt")
        out.append({"id": str(it["id"]),
                    "title": it.get("title") if isinstance(it.get("title"), str) else f"Collection {it['id']}",
                    "covers": covers, "count": cnt if isinstance(cnt, int) else None})
    return _cache_put(("collections", tok[-12:]), {"collections": out})


async def collection_designs(cid: str, offset: int = 0, limit: int = 30, fresh: bool = False) -> dict:
    """Modeles d'une collection, par pages, enrichis (fiche, deja imprime)."""
    cid = str(cid or "").strip()
    if not cid.isdigit():
        raise AccountError("Collection inconnue")
    return await _paged(COLLECTION_DESIGNS.format(cid=cid), offset, limit, fresh)


# ── Ecritures sur les collections (sur geste explicite de l'utilisateur) ────
# Requetes relevees sur makerworld.com (18/10/2026). Envoyees a l'hote de
# l'API Bambu (sans Cloudflare) avec le jeton du compte. Rien n'est jamais
# ecrit sans une action de l'utilisateur dans l'appli.
WRITE_HOST = "https://api.bambulab.com/v1"
MEMBERSHIP = "/design-service/my/design/favoriteslist"


def _send(method: str, path: str, body, tok: str):
    import requests
    try:
        from .makerworld import session
        r = session().request(method, WRITE_HOST + path, json=body, timeout=20, headers={
            "User-Agent": "Mozilla/5.0 (BambuNymous)", "Accept": "application/json",
            "Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    except Exception as e:
        raise AccountError(f"MakerWorld injoignable ({type(e).__name__})")
    if r.status_code == 401:
        raise AccountError("Jeton refusé ou expiré : reconnecte le compte")
    try:
        data = r.json()
    except ValueError:
        data = None
    if r.status_code >= 400:
        msg = (data or {}).get("error") or (data or {}).get("message") if isinstance(data, dict) else None
        raise AccountError(msg or f"MakerWorld a refusé (HTTP {r.status_code})")
    return data


async def _tok() -> str:
    tok = await token()
    if not tok:
        raise AccountError("Compte MakerWorld non connecté")
    return tok


_FLAGS = ("isFavorite", "isCollected", "collected", "isCollect", "hasCollect", "checked",
          "selected", "exist", "isExist", "isIn", "inFavorites", "contains", "isAdded")


def _membership_ids(d):
    """Collections ou se trouve un modele, d'apres la reponse (forme non
    documentee). None des que la forme n'est pas reconnue avec certitude :
    l'ecriture REMPLACE la liste, on ne devine donc jamais."""
    if isinstance(d, dict):
        for k in ("favoritesIds", "favoriteIds", "ids"):
            v = d.get(k)
            if isinstance(v, list) and all(str(x).isdigit() for x in v):
                return [str(x) for x in v]
        lst = next((d[k] for k in ("hits", "list", "items", "favorites", "data")
                    if isinstance(d.get(k), list)), None)
    elif isinstance(d, list):
        lst = d
    else:
        return None
    if lst is None:
        return None
    if all(isinstance(x, int) or (isinstance(x, str) and x.isdigit()) for x in lst):
        return [str(x) for x in lst]                 # liste d'ids (vide comprise)
    if all(isinstance(x, dict) and x.get("id") is not None for x in lst):
        keys = set().union(*(x.keys() for x in lst))
        flag = next((f for f in _FLAGS if f in keys), None)
        if flag:
            return [str(x["id"]) for x in lst if x.get(flag)]
    return None


async def design_collections(design_id: str) -> dict:
    """Toutes mes collections, et celles qui contiennent deja ce modele."""
    import asyncio
    from .makerworld import _get_json
    did = str(design_id or "").strip()
    if not did.isdigit():
        raise AccountError("Modèle inconnu")
    tok = await _tok()
    cols = (await collections())["collections"]
    code, d = await asyncio.to_thread(_get_json, f"{MEMBERSHIP}?designId={did}", tok)
    # Reponse relevee le 18/10/2026 : {"designId": 2357097, "favoritesIds": [5143394]}.
    # Une reponse qui parle d'un autre modele ne vaut rien (l'ecriture remplace la liste).
    # Modele range nulle part : « favoritesIds » vide ou null, et designId parfois a 0.
    same = not (isinstance(d, dict) and d.get("designId") not in (None, 0, "0", "") and str(d.get("designId")) != did)
    ids = None
    if code == 200 and same:
        if isinstance(d, dict) and "favoritesIds" in d and not d["favoritesIds"]:
            ids = []
        else:
            ids = _membership_ids(d)
    out = {"collections": cols, "in": ids, "known": ids is not None}
    if ids is None:
        import json as _json
        try:
            out["raw"] = f"HTTP {code} : " + _json.dumps(d, ensure_ascii=False)[:300]
        except Exception:
            out["raw"] = f"HTTP {code}"
    return out


async def set_design_collections(design_id: str, ids: list) -> dict:
    """Range un modele dans exactement ces collections (ajout et retrait)."""
    import asyncio
    did = str(design_id or "").strip()
    ids = [str(i) for i in (ids or []) if str(i).isdigit()]
    if not did.isdigit():
        raise AccountError("Modèle inconnu")
    tok = await _tok()
    mine = {c["id"] for c in (await collections())["collections"]}
    if any(i not in mine for i in ids):
        raise AccountError("Collection inconnue")
    await asyncio.to_thread(_send, "PUT", MEMBERSHIP,
                            {"designId": int(did), "favoritesIds": [int(i) for i in ids]}, tok)
    _cache_clear()
    from .mw_watch import own
    for i in ids:
        own("add", i, did)
    logger.info(f"[MW] modele {did} range dans {len(ids)} collection(s)")
    return {"ok": True, "in": ids}


async def create_collection(title: str) -> dict:
    import asyncio
    title = (title or "").strip()[:60]
    if not title:
        raise AccountError("Nom de collection requis")
    tok = await _tok()
    d = await asyncio.to_thread(_send, "POST", "/design-service/my/favorites",
                                {"title": title, "status": 1, "description": "", "cover": "",
                                 "tags": [], "setAsDefault": False}, tok)
    _cache_clear()
    from .mw_watch import own
    own("create", title)
    logger.info(f"[MW] collection creee : {title}")
    cid = (d or {}).get("id") if isinstance(d, dict) else None
    return {"ok": True, "id": str(cid) if cid else None, "title": title}


async def rename_collection(cid: str, title: str) -> dict:
    """Renomme en gardant le reste de la fiche : le PUT la remplace en entier."""
    import asyncio
    from .makerworld import _get_json
    cid, title = str(cid or "").strip(), (title or "").strip()[:60]
    if not cid.isdigit() or not title:
        raise AccountError("Collection ou nom manquant")
    tok = await _tok()
    code, cur = await asyncio.to_thread(_get_json, f"/design-service/favorites/{cid}/withoutdesign", tok)
    if not isinstance(cur, dict) or str(cur.get("id")) != cid:
        raise AccountError("Fiche de la collection illisible : renommage annulé")
    body = {"title": title,
            "status": cur.get("status") if isinstance(cur.get("status"), int) else 1,
            "description": cur.get("description") if isinstance(cur.get("description"), str) else "",
            "cover": cur.get("cover") if isinstance(cur.get("cover"), str) else "",
            "tags": cur.get("tags") if isinstance(cur.get("tags"), list) else [],
            "setAsDefault": bool(cur.get("isDefault"))}
    await asyncio.to_thread(_send, "PUT", f"/design-service/my/favorites/{cid}", body, tok)
    _cache_clear()
    from .mw_watch import own
    own("rename", cid)
    logger.info(f"[MW] collection {cid} renommee : {title}")
    return {"ok": True}


async def like_state(design_id: str) -> dict:
    """Ai-je aime ce modele ? (fiche lue avec mon jeton : hasLike)."""
    import asyncio
    from .makerworld import _get_json
    did = str(design_id or "").strip()
    if not did.isdigit():
        raise AccountError("Modèle inconnu")
    tok = await _tok()
    code, d = await asyncio.to_thread(_get_json, f"/design-service/design/{did}", tok)
    if code == 401:
        raise AccountError("Jeton refusé ou expiré : reconnecte le compte")
    if not isinstance(d, dict) or not isinstance(d.get("hasLike"), bool):
        return {"known": False, "liked": None, "count": None}
    return {"known": True, "liked": d["hasLike"],
            "count": d.get("likeCount") if isinstance(d.get("likeCount"), int) else None}


async def set_like(design_id: str, liked: bool) -> dict:
    """Aime (POST) / retire le j'aime (DELETE, meme chemin, corps {id}). On lit
    l'etat d'abord, on n'envoie que s'il differe, et on reverifie apres."""
    import asyncio
    did = str(design_id or "").strip()
    cur = await like_state(did)
    if not cur["known"]:
        raise AccountError("État du j'aime illisible : rien n'a été envoyé")
    if cur["liked"] == bool(liked):
        return cur
    tok = await _tok()
    await asyncio.to_thread(_send, "POST" if liked else "DELETE", f"/design-service/design/{did}/like",
                            {"id": int(did)}, tok)
    _cache_clear()
    after = await like_state(did)
    logger.info(f"[MW] modele {did} : j'aime {'pose' if liked else 'retire'} ({after['liked']})")
    return after


# ── Boosts ───────────────────────────────────────────────────────────────────
# Meme enchainement que le site : l'etat de boost du modele donne le droit a
# depenser (availableBoostingRight), puis POST avec ce droit et un horodatage.
def _count(d):
    if not isinstance(d, dict):
        return None
    for k in ("total", "count", "totalCount"):
        if isinstance(d.get(k), int):
            return d[k]
    for k in ("hits", "list", "items", "boostingRights", "rights"):
        if isinstance(d.get(k), list):
            return len(d[k])
    return None


async def boosts() -> dict:
    """Mes boosts disponibles."""
    import asyncio
    from .makerworld import _get_json
    tok = await _tok()
    code, d = await asyncio.to_thread(_get_json, "/point-service/boost/boostingright?filter=available&offset=0&limit=50", tok)
    n = _count(d)
    if n is None:
        return {"available": None, "error": f"Boosts illisibles (HTTP {code})"}
    return {"available": n}


async def boost_rights() -> list:
    """Mes jetons boost disponibles, un par un : {id, reason, expire_at}
    (meme lecture que le compteur, page par page)."""
    import asyncio
    from .makerworld import _get_json
    tok = await _tok()
    out, offset = [], 0
    while offset < 500:
        code, d = await asyncio.to_thread(
            _get_json, f"/point-service/boost/boostingright?filter=available&offset={offset}&limit=50", tok)
        _must(code, d, "La liste des jetons boost")
        hits = d.get("hits") if isinstance(d, dict) else None
        if not isinstance(hits, list):
            raise AccountError(f"Jetons boost illisibles (HTTP {code})")
        for h in hits:
            if isinstance(h, dict) and h.get("id") is not None:
                out.append({"id": str(h["id"]), "reason": h.get("earnReason") or "", "expire_at": h.get("expireAt")})
        total = d.get("availableTotal") or d.get("total") or 0
        offset += 50
        if len(hits) < 50 or offset >= total:
            break
    return out


async def boost_state(design_id: str) -> dict:
    """Etat de boost d'un modele : puis-je le booster (droit disponible) ?"""
    import asyncio
    from .makerworld import _get_json
    did = str(design_id or "").strip()
    if not did.isdigit():
        raise AccountError("Modèle inconnu")
    tok = await _tok()
    code, d = await asyncio.to_thread(_get_json, f"/point-service/boost/boostdesign?designId={did}", tok)
    if not isinstance(d, dict):
        return {"known": False, "can": False, "error": f"État du boost illisible (HTTP {code})"}
    right = d.get("availableBoostingRight") if isinstance(d.get("availableBoostingRight"), dict) else None
    n = lambda k: d.get(k) if isinstance(d.get(k), int) else None
    avail, mine, mine_max = n("availableTotal"), n("designBoostedCnt"), n("oneDesignBoostLimit")
    creator, creator_max = n("designUserBoostedCnt"), n("oneDesignUserBoostLimit")
    # Meme regle que le site : plus de boost ; sinon canBoost ; sinon limite du
    # modele (deja booste autant que permis) ; sinon limite par createur (seuil annuel).
    if avail is not None and avail < 1:
        state = "none_left"
    elif d.get("canBoost") is True:
        state = "can"
    elif mine_max is not None and mine is not None and mine >= mine_max:
        state = "model_limit"
    elif creator_max is not None and creator is not None and creator >= creator_max:
        state = "creator_limit"
    else:
        state = "can" if right else "unknown"
    can = state == "can" and bool(right and right.get("id"))
    reason = {"none_left": "Plus aucun boost disponible",
              "model_limit": f"Déjà boosté ({mine}/{mine_max} pour ce modèle)",
              "creator_limit": f"Limite par créateur atteinte ({creator}/{creator_max} cette année)",
              }.get(state) if not can else None
    return {"known": True, "can": can, "state": state if can or state != "can" else "unknown",
            "right_id": (right or {}).get("id"), "available": avail,
            "boosted": mine, "boosted_max": mine_max, "creator": creator, "creator_max": creator_max,
            "reason": reason or (None if can else (d.get("reason") or d.get("message") or "Boost impossible pour ce modèle"))}


async def boost(design_id: str) -> dict:
    """Booste un modele avec un de mes droits (action volontaire, confirmee dans l'appli)."""
    import asyncio, time
    did = str(design_id or "").strip()
    st = await boost_state(did)
    if not st.get("can"):
        raise AccountError(st.get("reason") or "Aucun boost disponible pour ce modèle")
    tok = await _tok()
    await asyncio.to_thread(_send, "POST", "/point-service/boost/boostdesign",
                            {"designId": int(did), "boostingRightId": st["right_id"],
                             "random": str(int(time.time() * 1000))}, tok)
    logger.info(f"[MW] modele {did} booste")
    after = await boosts()
    return {"ok": True, "available": after.get("available")}


async def delete_collection(cid: str) -> dict:
    """Supprime une de MES collections (les modeles restent sur MakerWorld)."""
    import asyncio
    cid = str(cid or "").strip()
    if not cid.isdigit():
        raise AccountError("Collection inconnue")
    tok = await _tok()
    if cid not in {c["id"] for c in (await collections())["collections"]}:
        raise AccountError("Collection inconnue")
    await asyncio.to_thread(_send, "DELETE", f"/design-service/my/favorites/{cid}", {"id": int(cid)}, tok)
    _cache_clear()
    from .mw_watch import own
    own("delete", cid)
    logger.info(f"[MW] collection {cid} supprimee")
    return {"ok": True}


# ── Createurs suivis et leurs modeles ──────────────────────────────────────
FOLLOWS = "/design-user-service/user/{uid}/follows?offset={offset}&limit=50"
PUBLISHED = "/design-service/published/{uid}/design?offset=0&limit={limit}"
_PUB_CACHE = {}            # uid -> (instant, [modeles]) : 1 h, pour ne pas relire a chaque ouverture
_PUB_TTL = 7200           # 2 h : le prechargement horaire les rafraichit
_FOLLOW_CACHE = {}         # uid -> (instant, [createurs]) : 10 min


async def _my_uid() -> str:
    st = await status()
    uid = (st.get("account") or {}).get("uid")
    if not st.get("connected") or not uid:
        raise AccountError("Compte MakerWorld non connecté")
    return str(uid)


async def following(fresh: bool = False) -> list:
    """Createurs que je suis vraiment (liste de mon profil MakerWorld)."""
    import asyncio
    from .makerworld import _get_json
    import time
    uid, tok = await _my_uid(), await token()
    hit = _FOLLOW_CACHE.get(uid)
    if hit and not fresh and time.time() - hit[0] < _PUB_TTL:
        return hit[1]
    out, offset = [], 0
    while len(out) < 1000:
        code, d = await asyncio.to_thread(_get_json, FOLLOWS.format(uid=uid, offset=offset), tok)
        if code == 401:
            raise AccountError("Jeton refusé ou expiré : reconnecte le compte")
        hits = [h for h in _items(d) if isinstance(h, dict) and str(h.get("uid") or "").isdigit()]
        if not hits:
            break
        out += [{"uid": str(h["uid"]), "name": h.get("name") if isinstance(h.get("name"), str) else "",
                 "handle": h.get("handle") if isinstance(h.get("handle"), str) else "",
                 "avatar": h.get("avatar") if isinstance(h.get("avatar"), str) else None} for h in hits]
        offset += 50
    _FOLLOW_CACHE[uid] = (time.time(), out)
    return out


def _pub_hit(h, creator) -> dict:
    if not isinstance(h, dict) or not str(h.get("id") or "").isdigit():
        return None
    s = lambda v: v if isinstance(v, str) and v else None
    return {"design_id": str(h["id"]), "title": s(h.get("title")), "title_fr": s(h.get("titleTranslated")),
            "cover_url": s(h.get("coverUrl")) or s(h.get("cover")),
            "creator_name": creator.get("name"), "creator_uid": creator["uid"],
            "published": s(h.get("publishTime")) or s(h.get("createTime"))}


async def _published(creator: dict, limit: int, fresh: bool = False) -> list:
    import asyncio, time
    from .makerworld import _get_json
    hit = _PUB_CACHE.get((creator["uid"], limit))
    if hit and not fresh and time.time() - hit[0] < _PUB_TTL:
        return hit[1]
    code, d = await asyncio.to_thread(_get_json, PUBLISHED.format(uid=creator["uid"], limit=limit))
    items = [x for x in (_pub_hit(h, creator) for h in _items(d)) if x]
    if code == 200:
        _PUB_CACHE[(creator["uid"], limit)] = (time.time(), items)
    return items


async def feed(uids: str = "", per: int = 10, fresh: bool = False) -> dict:
    """Modeles recents d'un LOT de createurs suivis (uids separes par des
    virgules, 25 au plus), fusionnes du plus recent au plus ancien, avec
    « deja imprime ». Le front enchaine les lots : les premiers modeles
    s'affichent sans attendre les 250 createurs. Seuls des createurs de MA
    liste sont lus."""
    import asyncio
    creators = {c["uid"]: c for c in await following(fresh)}
    wanted = list(dict.fromkeys(u.strip() for u in str(uids or "").split(",") if u.strip()))[:25]
    pick = [creators[u] for u in wanted if u in creators]
    per = max(1, min(int(per or 10), 60))
    sem = asyncio.Semaphore(5)              # pas plus de 5 requetes a la fois

    async def one(c):
        async with sem:
            try:
                return await _published(c, per, fresh)
            except Exception:
                return []
    lists = await asyncio.gather(*(one(c) for c in pick))
    items = sorted((x for l in lists for x in l), key=lambda x: x.get("published") or "", reverse=True)
    res = await _enrich(items)
    return {"items": res["items"], "pending": res["pending"], "creators_read": len(pick)}


# ── Prechargement en arriere-plan ──────────────────────────────────────────
# Toutes les heures : collections (liste + 1re page de chacune), j'aime (1re
# page), abonnements et 10 derniers modeles de chaque createur suivi. Les
# onglets s'ouvrent ainsi sur du cache, sans attente.
_WARM = {"on": False, "last": None}


async def warm_all() -> dict:
    import asyncio, time
    if _WARM["on"] or not await token():
        return {"skipped": True}
    _WARM["on"] = True
    t0, n, errors = time.time(), 0, 0
    try:
        sem = asyncio.Semaphore(5)

        async def run(coro):
            nonlocal n, errors
            async with sem:
                try:
                    await coro
                    n += 1
                except Exception:
                    errors += 1

        cols = (await collections(fresh=True))["collections"]
        jobs = [run(_page(COLLECTION_DESIGNS.format(cid=c["id"]), 0, 30, fresh=True)) for c in cols]
        jobs.append(run(_page(LISTS["likes"], 0, 30, fresh=True)))
        creators = await following(fresh=True)
        jobs += [run(_published(c, 10, fresh=True)) for c in creators]
        await asyncio.gather(*jobs)
        try:
            await check_new_models(creators)
        except Exception:
            logger.exception("[MW] nouveaux modeles des suivis")
    finally:
        _WARM["on"] = False
    _WARM["last"] = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "requests": n, "errors": errors,
                     "seconds": round(time.time() - t0, 1)}
    logger.info(f"[MW] prechargement : {n} lecture(s), {errors} erreur(s) en {_WARM['last']['seconds']} s")
    return _WARM["last"]


K_SEEN = "MW_NOTIFY_SEEN"     # {uid createur: date de publication du dernier modele vu}


async def check_new_models(creators: list) -> int:
    """Notifie les modeles publies par les createurs choisis depuis le dernier
    passage. Premier passage pour un createur : on retient son dernier
    modele sans rien envoyer (pas d'avalanche). Rend le nombre d'envois."""
    from . import notify as N
    cfg = await N._load()
    st = await N.event_settings("mw_new_model")
    watch = set(st.get("creators") or [])
    if not st.get("enabled") or not watch:
        return 0
    try:
        seen = json.loads(await _get(K_SEEN) or "{}")
    except ValueError:
        seen = {}
    seen = seen if isinstance(seen, dict) else {}
    by_uid = {c["uid"]: c for c in creators}
    sent = 0
    for uid in watch:
        c = by_uid.get(uid)
        if not c:
            continue
        items = [x for x in await _published(c, 10) if x.get("published")]
        if not items:
            continue
        newest = max(x["published"] for x in items)
        last = seen.get(uid)
        if not last:
            seen[uid] = newest
            continue
        fresh = sorted((x for x in items if x["published"] > last), key=lambda x: x["published"])
        for x in fresh[:5]:
            cover = x.get("cover_url")
            if cover and "bblmw.com" in cover and "?" not in cover:
                cover += "?x-oss-process=image/resize,w_600/format,webp"
            url = f"https://makerworld.com/fr/models/{x['design_id']}"
            prof = f"https://makerworld.com/fr/@{c['handle']}" if c.get("handle") else None
            # la notification ouvre la fiche dans l'appli ; les boutons gardent MakerWorld
            ok = await N.notify("mw_new_model", f"🆕 Nouveau modèle de {c.get('name') or 'un créateur suivi'}",
                                x.get("title_fr") or x.get("title") or "", click=N.mw_model_link(cfg, x["design_id"]), attach=cover, priority=3,
                                actions=[("Voir sur MakerWorld", url), ("Profil du créateur", prof)])
            sent += 1 if ok else 0
        if len(fresh) > 5:
            await N.notify("mw_new_model", f"{c.get('name')} : {len(fresh) - 5} autre(s) nouveau(x) modèle(s)",
                           "", click=N.mw_creator_link(cfg, uid, c.get("handle")))
        seen[uid] = max(last, newest)
    await _set(K_SEEN, json.dumps(seen))
    if sent:
        logger.info(f"[MW] {sent} notification(s) de nouveaux modeles")
    return sent


async def warm_loop(period_s: int = 3600, first_delay_s: int = 180):
    import asyncio
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            await warm_all()
        except Exception:
            logger.exception("[MW] prechargement")
        await asyncio.sleep(period_s)


async def _debug_collections() -> dict:
    """Essais pour lire le CONTENU d'une collection : prend la premiere de la
    liste et tente les chemins plausibles (non documentes), avec le code et le
    debut de chaque reponse."""
    import asyncio
    from .makerworld import _get_json
    tok = await token() or None
    code, d = await asyncio.to_thread(_get_json, DEBUG_PATHS["favoris_ids"], tok)
    first = next((it for it in _items(d) if isinstance(it, dict) and it.get("id")), None)
    if not first:
        return {"path": "essais", "http": code, "body": "Aucune collection trouvée dans favoris_ids"}
    cid = first["id"]
    tries = [f"/design-service/my/favorites/{cid}",
             f"/design-service/my/favorites/{cid}/designs?offset=0&limit=5",
             f"/design-service/favorites/{cid}/designs?offset=0&limit=5",
             f"/design-service/favorites/{cid}?offset=0&limit=5",
             f"/design-service/my/favorites/designs?favoritesId={cid}&offset=0&limit=5",
             "/design-service/my/favorites?offset=0&limit=5"]
    out = [f"collection d'essai : {json.dumps(first, ensure_ascii=False)[:400]}"]
    for p in tries:
        c, r = await asyncio.to_thread(_get_json, p, tok)
        out.append(f"\n== {p} → HTTP {c}\n" + (json.dumps(r, ensure_ascii=False)[:1500] if r is not None else "(vide)"))
    return {"path": "essais collections", "http": 200, "body": "\n".join(out)}


async def _try(title: str, paths: list, head: str = "", n: int = 4000) -> dict:
    """Essaie des chemins (GET seulement) et rend code + debut de reponse."""
    import asyncio
    from .makerworld import _get_json
    tok = await token() or None
    out = [head] if head else []
    for p in paths:
        c, r = await asyncio.to_thread(_get_json, p, tok)
        out.append(f"\n== {p} → HTTP {c}\n" + (json.dumps(r, ensure_ascii=False)[:n] if r is not None else "(vide)"))
    return {"path": title, "http": 200, "body": "\n".join(out)}


async def _most_printed_design() -> str:
    from sqlalchemy import select, func, desc
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(Print.design_id, func.count().label("n")).where(Print.design_id.isnot(None),
                                                                    Print.design_id != "0")
            .group_by(Print.design_id).order_by(desc("n")).limit(1))).first()
    return str(row[0]) if row else ""


async def _debug_other_points() -> dict:
    """Lignes de points qui ne sont ni un versement par modele ni par profil
    (boosts recus…), brutes : pour savoir a quel modele les rattacher."""
    import asyncio
    from .makerworld import _get_json
    tok = await token() or None
    seen, kinds = [], {}
    for off in range(0, 2000, 50):
        code, d = await asyncio.to_thread(_get_json, f"/point-service/point-bill/my?offset={off}&limit=50", tok)
        hits = d.get("hits") if isinstance(d, dict) and isinstance(d.get("hits"), list) else []
        for h in hits:
            if not isinstance(h, dict) or h.get("designRewardV2") or h.get("instanceRewardV2"):
                continue
            k = str(h.get("type") or "")
            kinds[k] = kinds.get(k, 0) + 1
            if kinds[k] <= 2:
                seen.append(h)
        if len(hits) < 50:
            break
    return {"path": "/point-service/point-bill/my (lignes hors modele/profil)", "http": code,
            "body": json.dumps({"types": kinds, "exemples": seen}, ensure_ascii=False)[:8000]}


async def _debug_plates() -> dict:
    """Plateaux d'un modele (le plus imprime) et ce que l'API dit d'imprime."""
    import asyncio
    from .makerworld import _get_json
    did = await _most_printed_design()
    if not did:
        return {"path": "essais plateaux", "http": 200, "body": "Aucun print relié à MakerWorld"}
    c, d = await asyncio.to_thread(_get_json, f"/design-service/design/{did}", await token() or None)
    insts = (d or {}).get("instances") if isinstance(d, dict) else None
    insts = insts if isinstance(insts, list) else []
    head = (f"modèle {did} : {len(insts)} profil(s)\n" + json.dumps(
        [{k: i.get(k) for k in ("id", "profileId", "title", "isDefault", "plates", "plateCount", "printCount")}
         for i in insts[:3] if isinstance(i, dict)], ensure_ascii=False)[:2500])
    ids = [i.get("id") for i in insts[:2] if isinstance(i, dict) and i.get("id")]
    return await _try("essais plateaux", [f"/user-service/my/task/printedplates?instanceId={i}" for i in ids], head)


# ── Historique cloud : retrouver les liens MakerWorld des vieux prints ──────
TASKS = "/user-service/my/tasks?offset={offset}&limit={limit}"


def _when(v):
    """Date d'une tache cloud (ISO ou epoch s/ms), en UTC naif."""
    from datetime import datetime, timezone
    if isinstance(v, (int, float)) and v > 0:
        v = v / 1000 if v > 1e11 else v
        return datetime.fromtimestamp(v, tz=timezone.utc).replace(tzinfo=None)
    if isinstance(v, str) and v:
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d.astimezone(timezone.utc).replace(tzinfo=None) if d.tzinfo else d
        except ValueError:
            return None
    return None


async def _cloud_tasks(max_items: int = 3000) -> list:
    import asyncio
    from .makerworld import _get_json
    tok = await token()
    if not tok:
        raise AccountError("Compte MakerWorld non connecté")
    out, offset = [], 0
    while len(out) < max_items:
        code, d = await asyncio.to_thread(_get_json, TASKS.format(offset=offset, limit=50), tok)
        if code == 401:
            raise AccountError("Jeton refusé ou expiré : reconnecte le compte")
        hits = _items(d)
        if not hits:
            break
        for h in hits:
            if not isinstance(h, dict):
                continue
            did = h.get("designId")
            out.append({
                "task_id": str(h.get("id") or ""),
                "design_id": str(did) if isinstance(did, int) and did > 0 else None,
                "instance_id": str(h.get("instanceId") or "") or None,
                "title": h.get("designTitle") or h.get("title"),
                "start": _when(h.get("startTime")) or _when(h.get("createTime")),
            })
        offset += 50
        await asyncio.sleep(0.5)
    return out


async def history_scan(apply: bool = False) -> dict:
    """Relie les prints de l'appli aux impressions cloud : par numero de
    tache (job_id), sinon par heure de debut (a 10 min pres, une seule
    correspondance possible). Ne remplit que les liens VIDES (design_id,
    profil) ; n'ecrase jamais. Sans apply : bilan seulement."""
    import json as _j
    from datetime import timedelta
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, MakerWorldDesign as MW
    from .makerworld import launch_many
    tasks = [t for t in await _cloud_tasks() if t["design_id"]]
    async with AsyncSessionLocal() as db:
        prints = (await db.execute(select(Print))).scalars().all()
        by_job = {str(p.job_id): p for p in prints if p.job_id}
        cache = {m.design_id: _j.loads(m.profiles or "[]") for m in (await db.execute(
            select(MW).where(MW.design_id.in_({t["design_id"] for t in tasks})))).scalars().all()}
        used, plan = set(), []
        for t in tasks:
            p, how = by_job.get(t["task_id"]), "tâche"
            if p is None and t["start"]:
                near = [x for x in prints if x.id not in used and x.print_date
                        and abs((x.print_date - t["start"]).total_seconds()) <= 600]
                p, how = (near[0], "heure") if len(near) == 1 else (None, None)
            if p is None or p.id in used:
                continue
            used.add(p.id)
            prof = next((x.get("profile_id") for x in cache.get(t["design_id"], [])
                         if x.get("instance_id") == t["instance_id"]), None)
            link = not (p.design_id or "").strip() or p.design_id == "0"
            if link and p.design_id and p.design_id != t["design_id"]:
                link = False
            add_prof = bool(prof) and not p.mw_profile_id and (link or p.design_id == t["design_id"])
            if link or add_prof:
                plan.append((p, t, how, link, prof if add_prof else None))
        if apply:
            for p, t, how, link, prof in plan:
                if link:
                    p.design_id = t["design_id"]
                if prof:
                    p.mw_profile_id = prof
            await db.commit()
        res = {
            "tasks": len(tasks), "matched": len(used),
            "to_link": sum(1 for x in plan if x[3]), "to_profile": sum(1 for x in plan if x[4]),
            "by_task": sum(1 for x in plan if x[2] == "tâche"), "by_time": sum(1 for x in plan if x[2] == "heure"),
            "sample": [{"print": p.file_name, "model": t["title"], "how": how}
                       for p, t, how, link, prof in plan[:8]],
            "applied": bool(apply),
        }
    if apply:
        new = list({t["design_id"] for p, t, how, link, prof in plan if t["design_id"] not in cache})
        if new:
            launch_many(new)
    return res


DEBUG_TRIES = {
    "essais_historique": lambda did: ("essais historique cloud", [
        "/user-service/my/tasks?offset=0&limit=1"]),
    "essais_recherche": lambda did: ("essais recherche", [
        "/search-service/select/design2?keyword=panda&offset=0&limit=3",
        "/search-service/select/design/search?keyword=panda&offset=0&limit=3",
        "/search-service/design/search?keyword=panda&offset=0&limit=3",
        "/search-service/search/design?keyword=panda&offset=0&limit=3"]),
    "essais_appartenance": lambda did: ("essais appartenance", [
        f"{MEMBERSHIP}?designId={did}"]),
    "essais_suivis": lambda did: ("essais suivis", [
        "/design-user-service/my/follow/following?offset=0&limit=3",
        "/design-user-service/my/following?offset=0&limit=3",
        "/design-user-service/my/follow/list?type=1&offset=0&limit=3",
        "/design-user-service/my/follow/mutual",
        "/design-recommend-service/my/following?offset=0&limit=3",
        "/design-recommend-service/my/follow?offset=0&limit=3"]),
    "essais_similaires": lambda did: ("essais similaires", [
        f"/search-service/design/{did}/relate?offset=0&limit=3&scene=1",
        f"/design-service/design/{did}/remixed?offset=0&limit=3"]),
}


async def debug(name: str) -> dict:
    """Reponse brute d'un chemin de la liste fermee (pour adapter la lecture
    si l'API change). Le jeton n'y figure jamais. Lecture seule (GET)."""
    import asyncio
    from .makerworld import _get_json
    if name == "essais_collections":
        return await _debug_collections()
    if name == "essais_plateaux":
        return await _debug_plates()
    if name == "points_autres":
        return await _debug_other_points()
    if name in DEBUG_TRIES:
        title, paths = DEBUG_TRIES[name](await _most_printed_design() or "1400373")
        return await _try(title, paths)
    if name not in DEBUG_PATHS:
        raise AccountError("Chemin inconnu")
    code, d = await asyncio.to_thread(_get_json, DEBUG_PATHS[name], await token() or None)
    txt = json.dumps(d, ensure_ascii=False)[:6000] if d is not None else None
    return {"path": DEBUG_PATHS[name], "http": code, "body": txt}
