"""
Surveillance des connexions (20/10/2026), pour deux notifications :
  - login_new    : un compte se connecte depuis un appareil (systeme +
                   navigateur) jamais vu pour lui ;
  - login_failed : au moins 3 echecs en 15 min pour un meme compte ou une
                   meme adresse (une notification par rafale).

Appareils connus par compte dans le reglage LOGIN_DEVICES ; le premier
appareil d'un compte est retenu sans notification. Les echecs ne vivent
qu'en memoire : un redemarrage remet les compteurs a zero.
"""
import asyncio
import json
import logging
import time
from collections import deque
from datetime import datetime

logger = logging.getLogger(__name__)

KEY = "LOGIN_DEVICES"
FAIL_WINDOW_S = 15 * 60
FAIL_MIN = 3
_FAILS: dict = {}            # cle ("u:nom" / "ip:adresse") -> deque d'horodatages
_ALERTED: dict = {}          # cle -> horodatage de la derniere alerte


def client_ip(request) -> str:
    """Adresse du client, derriere le mandataire inverse (NPM) si besoin."""
    h = request.headers
    fwd = (h.get("x-forwarded-for") or "").split(",")[0].strip()
    return fwd or (h.get("x-real-ip") or "").strip() or (request.client.host if request.client else "?")


def device_of(ua: str) -> str:
    """« Android · Chrome », « iPhone · Safari », « Appli Android »…"""
    ua = ua or ""
    if "BambuNymous" in ua or ("; wv)" in ua and "Android" in ua):
        return "Appli Android"
    os_ = ("iPhone" if "iPhone" in ua else "iPad" if "iPad" in ua else "Android" if "Android" in ua
           else "Windows" if "Windows" in ua else "Mac" if "Macintosh" in ua else "Linux" if "Linux" in ua else "Autre")
    br = ("Edge" if "Edg/" in ua else "Opera" if "OPR/" in ua else "Firefox" if "Firefox" in ua
          else "Chrome" if "Chrome" in ua or "CriOS" in ua else "Safari" if "Safari" in ua else "navigateur")
    return f"{os_} · {br}"


async def _devices_get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def _devices_put(d: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(d, ensure_ascii=False))


async def on_success(username: str, ip: str, ua: str) -> bool:
    """Rend True si une notification « nouvel appareil » est partie."""
    from . import notify as N
    dev = device_of(ua)
    d = await _devices_get()
    known = d.setdefault(username, {})
    first = not known
    is_new = dev not in known
    known[dev] = {"ip": ip, "at": datetime.utcnow().isoformat()}
    await _devices_put(d)
    if first or not is_new:
        return False
    cfg = await N._load()
    return await N.notify("login_new", f"🔐 Nouvelle connexion : {username}",
                          f"📱 {dev}\n🌍 adresse {ip}", click=N.app_link(cfg, "/settings?tab=accounts"), priority=3)


async def on_failure(username: str, ip: str) -> bool:
    """Rend True si une alerte d'echecs repetes est partie."""
    from . import notify as N
    now = time.time()
    hit = None
    for key in (f"u:{username}", f"ip:{ip}"):
        q = _FAILS.setdefault(key, deque())
        q.append(now)
        while q and now - q[0] > FAIL_WINDOW_S:
            q.popleft()
        if len(q) >= FAIL_MIN and now - _ALERTED.get(key, 0) > FAIL_WINDOW_S:
            hit = hit or (key, len(q))
    if not hit:
        return False
    key, n = hit
    _ALERTED[f"u:{username}"] = _ALERTED[f"ip:{ip}"] = now
    cfg = await N._load()
    at = datetime.now().strftime("%H:%M")
    return await N.notify("login_failed", f"🚨 {n} échecs de connexion",
                          f"Compte « {username} » · adresse {ip}\nDernier essai à {at}",
                          click=N.app_link(cfg, "/settings?tab=accounts"), priority=4)


def spawn(coro) -> None:
    """Lance sans attendre ni jamais faire echouer la connexion."""
    async def run():
        try:
            await coro
        except Exception as e:
            logger.warning(f"[LOGIN] surveillance : {e}")
    try:
        asyncio.get_running_loop().create_task(run())
    except RuntimeError:
        pass
