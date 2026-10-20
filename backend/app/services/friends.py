"""
Copains : parcourir le BambuNymous d'un ami, en lecture seule.

Cote ami : il cree un compte pour moi chez lui (lecture seule, avec ou sans
prix) et genere pour ce compte une « invitation copain » (users.py). Elle
contient l'adresse de son BambuNymous et une cle d'acces propre a ce compte,
revocable ; aucun mot de passe n'est echange.

Cote moi : je colle l'invitation ; le serveur la verifie (GET /auth/me chez
l'ami) puis la garde (reglage FRIENDS). Mon interface passe ensuite par mon
serveur (relais, GET seulement) : la cle ne quitte jamais le serveur et le
navigateur ne parle qu'a son propre BambuNymous. Les droits sont ceux du
compte chez l'ami : son serveur refuse toute ecriture a une cle copain.
"""
import base64
import json
import logging
import secrets
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

KEY = "FRIENDS"
PREFIX = "bnym1."


class FriendError(Exception):
    pass


def make_invitation(url: str, key: str, username: str) -> str:
    raw = json.dumps({"url": url.rstrip("/"), "key": key, "user": username}, separators=(",", ":"))
    return PREFIX + base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def read_invitation(text: str) -> dict:
    t = "".join(str(text or "").split())
    if PREFIX in t:
        t = t[t.index(PREFIX) + len(PREFIX):]
    try:
        d = json.loads(base64.urlsafe_b64decode(t + "=" * (-len(t) % 4)).decode())
    except Exception:
        raise FriendError("Invitation illisible : colle-la en entier (elle commence par bnym1.)")
    u = urlparse(str(d.get("url") or ""))
    if u.scheme not in ("http", "https") or not u.netloc or not str(d.get("key") or "").startswith("fk_"):
        raise FriendError("Invitation incomplète")
    return {"url": f"{u.scheme}://{u.netloc}{u.path.rstrip('/')}", "key": d["key"], "user": str(d.get("user") or "")}


async def _load() -> list:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        d = json.loads(raw) if raw else []
    except ValueError:
        d = []
    return d if isinstance(d, list) else []


async def _save(lst: list) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(lst, ensure_ascii=False))


def _public(f: dict) -> dict:
    return {k: f.get(k) for k in ("id", "name", "url", "user", "role")}


async def list_friends() -> list:
    return [_public(f) for f in await _load()]


def _get(url: str, key: str, path: str, params=None, timeout=20, extra=None):
    from .makerworld import session
    try:
        return session().get(f"{url}/api/v1/{path.lstrip('/')}", params=params or {}, timeout=timeout,
                             headers={"Authorization": f"Bearer {key}", "User-Agent": "BambuNymous-copain",
                                      **(extra or {})})
    except Exception as e:
        raise FriendError(f"BambuNymous du copain injoignable ({type(e).__name__})")


async def add_friend(invitation: str, name: str = "") -> dict:
    import asyncio
    inv = read_invitation(invitation)
    r = await asyncio.to_thread(_get, inv["url"], inv["key"], "auth/me")
    if r.status_code == 401:
        raise FriendError("Invitation refusée par le BambuNymous du copain (révoquée ou compte désactivé)")
    try:
        me = r.json()
    except ValueError:
        me = None
    if r.status_code >= 400 or not isinstance(me, dict) or not me.get("role"):
        raise FriendError(f"Réponse inattendue du BambuNymous du copain (HTTP {r.status_code})")
    lst = [f for f in await _load() if not (f["url"] == inv["url"] and f["key"] == inv["key"])]
    f = {"id": secrets.token_hex(4), "name": (name or "").strip()[:40] or urlparse(inv["url"]).hostname or "Copain",
         "url": inv["url"], "key": inv["key"], "user": me.get("username") or inv["user"], "role": me["role"]}
    lst.append(f)
    await _save(lst)
    logger.info(f"[COPAINS] ajout : {f['name']} ({f['url']}, compte {f['user']}, {f['role']})")
    return _public(f)


async def remove_friend(fid: str) -> None:
    lst = await _load()
    if not any(f["id"] == fid for f in lst):
        raise FriendError("Copain inconnu")
    await _save([f for f in lst if f["id"] != fid])


async def rename_friend(fid: str, name: str) -> dict:
    lst = await _load()
    f = next((x for x in lst if x["id"] == fid), None)
    if not f:
        raise FriendError("Copain inconnu")
    f["name"] = (name or "").strip()[:40] or f["name"]
    await _save(lst)
    return _public(f)


# En-tetes de suivi transmis au copain : sa page Activite et la derniere
# visite du compte se mettent a jour comme si on etait chez lui.
TRACK_HEADERS = ("x-app-page", "x-app-detail", "x-app-active")


async def proxy(fid: str, path: str, params: dict, headers=None):
    """Relaie une lecture (GET) vers le BambuNymous du copain."""
    import asyncio
    f = next((x for x in await _load() if x["id"] == fid), None)
    if not f:
        raise FriendError("Copain inconnu")
    p = str(path or "").lstrip("/")
    if ".." in p or p.startswith(("friends", "auth/login")) or (p.startswith("users") and p != "users/activity/ping"):
        raise FriendError("Chemin non relayé")
    extra = {k: v for k, v in (headers or {}).items() if k.lower() in TRACK_HEADERS}
    if p == "achievements":
        # mes medailles uniques : chez lui, je lirai le descriptif de celles-la
        try:
            from .achievements import my_uniques
            extra["X-BN-Achievements"] = ",".join(await my_uniques())
        except Exception:
            pass
    r = await asyncio.to_thread(_get, f["url"], f["key"], p, params, 60, extra)
    if p == "auth/me" and r.status_code < 400:
        try:
            role = r.json().get("role")
            if role and role != f.get("role"):            # droits changes chez le copain
                lst = await _load()
                for x in lst:
                    if x["id"] == fid:
                        x["role"] = role
                await _save(lst)
        except ValueError:
            pass
    return r.status_code, r.headers.get("content-type") or "application/octet-stream", r.content
