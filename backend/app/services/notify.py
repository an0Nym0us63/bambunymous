"""
Notifications : un canal d'envoi (ntfy pour commencer) et des types de
notification, chacun activable a part, avec ses reglages.

Reglage NOTIFY_CONFIG (JSON) :
  {"ntfy": {"url": "https://ntfy.sh", "topic": "...", "token": "..."},
   "events": {"mw_new_model": {"enabled": true, "creators": ["uid", ...]}}}
Le jeton ntfy est saisi par l'utilisateur et n'est jamais renvoye au
navigateur (seulement « pose »).

Ajouter un type : une entree dans EVENTS (libelle, description, exemple pour
« Envoyer test ») et l'appel a notify(event, ...) la ou l'evenement se produit.
"""
import json
import logging

logger = logging.getLogger(__name__)

KEY = "NOTIFY_CONFIG"

EVENTS = {
    "mw_new_model": {
        "label": "Nouveau modèle d'un créateur suivi",
        "description": "MakerWorld : un créateur choisi publie un modèle (vérifié toutes les heures).",
        "sample": {"title": "Nouveau modèle de Meyui",
                   "message": "Kit de semis auto-arrosant modulaire",
                   "click": "https://makerworld.com/fr/models/1400373",
                   "attach": "https://makerworld.bblmw.com/makerworld/model/US300293b2858c3b/design/2025-05-11_9f4182f5c66a7.png?x-oss-process=image/resize,w_600/format,webp",
                   "tags": ["new"]},
    },
}


class NotifyError(Exception):
    pass


async def _load() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        cfg = json.loads(raw) if raw else {}
    except ValueError:
        cfg = {}
    cfg = cfg if isinstance(cfg, dict) else {}
    cfg.setdefault("ntfy", {})
    cfg.setdefault("events", {})
    return cfg


async def _save(cfg: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(cfg, ensure_ascii=False))


def _public(cfg: dict) -> dict:
    """Ce que voit le navigateur : jamais le jeton."""
    n = cfg.get("ntfy") or {}
    return {
        "ntfy": {"url": n.get("url") or "https://ntfy.sh", "topic": n.get("topic") or "",
                 "has_token": bool(n.get("token"))},
        "events": [{"id": k, "label": v["label"], "description": v["description"],
                    **{"enabled": False, "creators": []},
                    **{kk: vv for kk, vv in (cfg["events"].get(k) or {}).items() if kk in ("enabled", "creators")}}
                   for k, v in EVENTS.items()],
    }


async def get_config() -> dict:
    return _public(await _load())


async def set_ntfy(url: str, topic: str, token=None) -> dict:
    """token None = inchange ; "" = retire."""
    url = (url or "").strip().rstrip("/") or "https://ntfy.sh"
    topic = (topic or "").strip()
    if not url.startswith(("http://", "https://")) or len(url) > 300:
        raise NotifyError("Adresse du serveur ntfy invalide")
    if topic and (len(topic) > 64 or not all(c.isalnum() or c in "-_" for c in topic)):
        raise NotifyError("Sujet ntfy : lettres, chiffres, - et _ seulement (64 max)")
    cfg = await _load()
    n = cfg["ntfy"]
    n.update({"url": url, "topic": topic})
    if token is not None:
        n["token"] = str(token).strip()[:200]
    await _save(cfg)
    return _public(cfg)


async def set_event(event: str, enabled=None, creators=None) -> dict:
    if event not in EVENTS:
        raise NotifyError("Type de notification inconnu")
    cfg = await _load()
    e = cfg["events"].setdefault(event, {})
    if enabled is not None:
        e["enabled"] = bool(enabled)
    if creators is not None:
        e["creators"] = [str(c) for c in creators if str(c).isdigit()][:1000]
    await _save(cfg)
    return _public(cfg)


async def event_settings(event: str) -> dict:
    """Reglages d'un type (enabled, creators...) pour le code qui le declenche."""
    cfg = await _load()
    return {"enabled": False, "creators": [], **(cfg["events"].get(event) or {})}


def _post_ntfy(n: dict, title: str, message: str, click=None, attach=None, tags=None, priority=None):
    from .makerworld import session
    if not n.get("topic"):
        raise NotifyError("Sujet ntfy non renseigné")
    body = {"topic": n["topic"], "title": title[:250], "message": (message or "")[:4000]}
    if click: body["click"] = click
    if attach: body["attach"] = attach
    if tags: body["tags"] = tags
    if priority: body["priority"] = priority
    headers = {"Content-Type": "application/json"}
    if n.get("token"):
        headers["Authorization"] = f"Bearer {n['token']}"
    try:
        r = session().post(n.get("url") or "https://ntfy.sh", json=body, headers=headers, timeout=15)
    except Exception as e:
        raise NotifyError(f"Serveur ntfy injoignable ({type(e).__name__})")
    if r.status_code >= 400:
        try:
            err = r.json().get("error")
        except ValueError:
            err = None
        raise NotifyError(err or f"ntfy a refusé (HTTP {r.status_code})")


async def send(title: str, message: str = "", click=None, attach=None, tags=None, priority=None) -> None:
    import asyncio
    cfg = await _load()
    await asyncio.to_thread(_post_ntfy, cfg["ntfy"], title, message, click, attach, tags, priority)


async def notify(event: str, title: str, message: str = "", **kw) -> bool:
    """Envoie si ce type est active. Ne leve jamais (un echec se journalise)."""
    try:
        st = await event_settings(event)
        if not st.get("enabled"):
            return False
        await send(title, message, **kw)
        return True
    except Exception as e:
        logger.warning(f"[NOTIF] {event} : {e}")
        return False


async def test(event: str = "") -> dict:
    """« Envoyer test » : du canal (sans event) ou d'un type, meme desactive."""
    if event and event not in EVENTS:
        raise NotifyError("Type de notification inconnu")
    if event:
        s = EVENTS[event]["sample"]
        await send("[Test] " + s["title"], s["message"], click=s.get("click"), attach=s.get("attach"),
                   tags=s.get("tags"))
    else:
        await send("BambuNymous", "Test de notification : le canal ntfy fonctionne.", tags=["white_check_mark"])
    return {"ok": True}
