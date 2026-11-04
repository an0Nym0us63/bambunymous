"""
Les liens publics (04/11/2026) : tout ce qui s'ouvre sans compte -- « Ton annee en impressions », « Depuis le debut »,
la vitrine -- dans un seul registre, garde dans les reglages (sauvegardes avec la base). Chaque lien : son type, ce qu'il
montre, sa creation, sa date d'expiration (aucune par defaut) et ses ouvertures ; Parametres les liste, les prolonge et
les supprime. Un lien expire ne s'ouvre plus (il reste liste, a prolonger ou supprimer).

Une entree : {kind: "year" | "all" | "showcase", ref, label, created, expires (ISO, UTC) | None, views, last_view,
data (les chiffres figes, pour year et all)}.
"""
import json
import secrets
from datetime import datetime, timedelta

KEY = "PUBLIC_LINKS"
OLD_WRAPPED = "WRAPPED_SHARES"            # l'ancien rangement des annees (04/11/2026, quelques heures), repris
PATHS = {"year": "/annee/", "all": "/annee/", "showcase": "/vitrine/"}


async def load() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting, set_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
        old = await get_setting(db, OLD_WRAPPED, "")
        try:
            d = json.loads(raw) if raw else {}
        except ValueError:
            d = {}
        d = d if isinstance(d, dict) else {}
        if old:
            try:
                for t, v in (json.loads(old) or {}).items():
                    if t not in d and isinstance(v, dict) and v.get("data"):
                        d[t] = {"kind": "year", "ref": v.get("year"), "label": f"Ton année {v.get('year')}", "created": v.get("at"),
                                "expires": None, "views": 0, "last_view": None, "data": v["data"]}
            except ValueError:
                pass
            await set_setting(db, KEY, json.dumps(d, ensure_ascii=False))
            await set_setting(db, OLD_WRAPPED, "")
    return d


async def save(d: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(d, ensure_ascii=False))


def expired(v: dict) -> bool:
    e = v.get("expires")
    try:
        return bool(e) and datetime.fromisoformat(e) <= datetime.utcnow()
    except ValueError:
        return False


def view(t: str, v: dict) -> dict:
    """Ce que Parametres en montre (sans les chiffres figes)."""
    return {"token": t, "kind": v.get("kind"), "ref": v.get("ref"), "label": v.get("label"), "created": v.get("created"),
            "expires": v.get("expires"), "expired": expired(v), "views": v.get("views") or 0, "last_view": v.get("last_view"),
            "path": f"{PATHS.get(v.get('kind'), '/')}{t}"}


def _exp(days) -> str | None:
    try:
        n = int(days)
    except (TypeError, ValueError):
        return None
    return (datetime.utcnow() + timedelta(days=n)).isoformat(timespec="seconds") if n > 0 else None


async def put(kind: str, ref, label: str, data=None, days="keep") -> tuple[str, dict]:
    """Le lien de ce type et de cette reference, cree ou mis a jour (ses chiffres refaits). days : sa duree en jours
    (0 ou None : sans fin) ; « keep » garde l'expiration d'un lien existant."""
    d = await load()
    t = next((t for t, v in d.items() if v.get("kind") == kind and v.get("ref") == ref), None)
    now = datetime.utcnow().isoformat(timespec="seconds")
    if t is None:
        t = secrets.token_urlsafe(12)
        d[t] = {"kind": kind, "ref": ref, "created": now, "expires": None if days == "keep" else _exp(days), "views": 0, "last_view": None}
    elif days != "keep":
        d[t]["expires"] = _exp(days)
    d[t]["label"] = label
    if data is not None:
        d[t]["data"], d[t]["updated"] = data, now
    await save(d)
    return t, d[t]


async def find(kind: str, ref) -> tuple[str | None, dict | None]:
    d = await load()
    t = next((t for t, v in d.items() if v.get("kind") == kind and v.get("ref") == ref), None)
    return t, (d[t] if t else None)


async def open_(token: str, kinds: tuple, request=None) -> dict | None:
    """Une ouverture publique : l'entree si le lien existe, est de ce type et n'a pas expire (et elle est comptee)."""
    if not token or len(token) > 40:
        return None
    d = await load()
    v = d.get(token)
    if not v or v.get("kind") not in kinds or expired(v):
        return None
    v["views"] = int(v.get("views") or 0) + 1
    v["last_view"] = datetime.utcnow().isoformat(timespec="seconds")
    await save(d)
    if request is not None:
        import asyncio
        asyncio.create_task(_log_add(token, request))     # en fond : la page ne l'attend pas (04/11/2026)
    return v


# Le journal des acces (04/11/2026) : chaque ouverture d'un lien, avec l'heure, l'adresse IP, l'appareil et la page
# d'ou l'on vient ; Parametres le montre par lien, avec la zone de chaque adresse (services/ipgeo). Range a part du
# registre (PUBLIC_LINKS_LOG), les LOG_MAX dernieres de chaque lien sur LOG_DAYS jours ; supprimer un lien efface son journal.
LOG_KEY = "PUBLIC_LINKS_LOG"
LOG_MAX = 300
LOG_DAYS = 180


async def _log_load() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, LOG_KEY, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def _log_save(d: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, LOG_KEY, json.dumps(d, ensure_ascii=False))


async def _log_add(token: str, request) -> None:
    from urllib.parse import urlparse
    from .login_watch import client_ip, device_of
    try:
        ua = request.headers.get("user-agent") or ""
        ref = urlparse(request.headers.get("referer") or "").netloc
        d = await _log_load()
        lim = (datetime.utcnow() - timedelta(days=LOG_DAYS)).isoformat(timespec="seconds")
        lst = [e for e in d.get(token) or [] if (e.get("at") or "") >= lim]
        lst.append({"at": datetime.utcnow().isoformat(timespec="seconds"), "ip": client_ip(request), "dev": device_of(ua),
                    "ua": ua[:240], "ref": ref[:120] or None})
        d[token] = lst[-LOG_MAX:]
        await _log_save(d)
    except Exception:
        pass                                          # le journal ne bloque jamais l'ouverture


async def log_of(token: str) -> list:
    """Les ouvertures de ce lien, la plus recente d'abord."""
    return list(reversed((await _log_load()).get(token) or []))


async def remove(token: str) -> None:
    d = await load()
    d.pop(token, None)
    await save(d)
    lg = await _log_load()
    if lg.pop(token, None) is not None:
        await _log_save(lg)


async def set_expiry(token: str, days) -> dict | None:
    d = await load()
    if token not in d:
        return None
    d[token]["expires"] = _exp(days)
    await save(d)
    return view(token, d[token])
