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
            "cover_url": d.get("cover") or d.get("coverUrl"),
            "creator_name": cr.get("name")}


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
        if code == 401:
            raise AccountError("Jeton refusé ou expiré : reconnecte le compte")
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
        printed = dict((await db.execute(
            select(Print.design_id, func.count()).where(Print.design_id.in_(ids))
            .group_by(Print.design_id))).all()) if ids else {}
    out = []
    for x in items:
        m = to_dict(cache.get(x["design_id"])) or {}
        out.append({**{k: v for k, v in m.items() if v}, **{k: v for k, v in x.items() if v},
                    "printed": printed.get(x["design_id"], 0),
                    "url": f"https://makerworld.com/fr/models/{x['design_id']}"})
    missing = [x["design_id"] for x in out if not x.get("title")]
    if missing:
        launch_many(missing)
    return {"items": out, "pending": len(missing)}


async def collection(kind: str) -> dict:
    """Modeles aimes, enrichis (fiche, deja imprime)."""
    if kind not in LISTS:
        raise AccountError("Liste inconnue")
    return await _enrich(await _list(LISTS[kind]))


async def collections() -> dict:
    """Mes collections de favoris : nom, quelques couvertures, nombre de
    modeles quand l'API le donne."""
    import asyncio
    from .makerworld import _get_json
    tok = await token()
    if not tok:
        raise AccountError("Compte MakerWorld non connecté")
    code, d = await asyncio.to_thread(_get_json, COLLECTIONS, tok)
    if code == 401:
        raise AccountError("Jeton refusé ou expiré : reconnecte le compte")
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
    return {"collections": out}


async def collection_designs(cid: str) -> dict:
    """Modeles d'une collection, enrichis (fiche, deja imprime)."""
    cid = str(cid or "").strip()
    if not cid.isdigit():
        raise AccountError("Collection inconnue")
    return await _enrich(await _list(COLLECTION_DESIGNS.format(cid=cid), max_items=500))


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


async def _try(title: str, paths: list, head: str = "", n: int = 1200) -> dict:
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


DEBUG_TRIES = {
    "essais_historique": lambda did: ("essais historique cloud", [
        "/user-service/my/tasks?limit=3",
        "/user-service/my/tasks?offset=0&limit=3"]),
    "essais_recherche": lambda did: ("essais recherche", [
        "/search-service/select/design2?keyword=panda&offset=0&limit=3",
        "/search-service/select/design/search?keyword=panda&offset=0&limit=3",
        "/search-service/design/search?keyword=panda&offset=0&limit=3",
        "/search-service/search/design?keyword=panda&offset=0&limit=3"]),
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
    if name in DEBUG_TRIES:
        title, paths = DEBUG_TRIES[name](await _most_printed_design() or "1400373")
        return await _try(title, paths)
    if name not in DEBUG_PATHS:
        raise AccountError("Chemin inconnu")
    code, d = await asyncio.to_thread(_get_json, DEBUG_PATHS[name], await token() or None)
    txt = json.dumps(d, ensure_ascii=False)[:6000] if d is not None else None
    return {"path": DEBUG_PATHS[name], "http": code, "body": txt}
