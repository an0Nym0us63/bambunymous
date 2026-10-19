"""
Notifications : un canal d'envoi (ntfy pour commencer) et des types de
notification, chacun activable a part, avec ses reglages.

Reglage NOTIFY_CONFIG (JSON) :
  {"ntfy": {"url": "https://ntfy.sh", "topic": "...", "token": "...",
            "app_url": "https://bambu.exemple.fr"},
   "events": {"mw_new_model": {"enabled": true, "creators": ["uid", ...]},
              "print_done":   {"enabled": true, "options": {"min_minutes": 30}}}}
Le jeton ntfy est saisi par l'utilisateur et n'est jamais renvoye au
navigateur (seulement « pose »). app_url est l'adresse de l'appli vue du
telephone : sans elle, pas de lien vers l'appli dans les notifications.

Ajouter un type : une entree dans EVENTS (section, libelle, description,
options, exemple pour « Envoyer test ») et l'appel a notify(event, ...) la ou
l'evenement se produit (services/notify_events.py pour les evenements de
l'imprimante et du stock).
"""
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

KEY = "NOTIFY_CONFIG"

SECTIONS = [
    ("prints", "🖨️ Impressions"),
    ("dry", "💧 Séchage"),
    ("spools", "🧵 Bobines"),
    ("mw", "🌐 MakerWorld"),
]

_MIN_MINUTES = {"key": "min_minutes", "type": "number", "label": "Seulement si l'impression dure plus de",
                "unit": "min", "default": 0, "min": 0, "max": 1440}
_SAMPLE_COVER = ("https://makerworld.bblmw.com/makerworld/model/US300293b2858c3b/design/"
                 "2025-05-11_9f4182f5c66a7.png?x-oss-process=image/resize,w_600/format,webp")

# priority ntfy : 1 muet, 2 discret, 3 normal, 4 fort, 5 urgent (vibre longuement)
EVENTS = {
    # ── Impressions ──
    "print_started": {
        "section": "prints", "label": "Impression démarrée",
        "description": "Nom, aperçu du plateau, durée estimée et bobines utilisées.",
        "options": [_MIN_MINUTES],
        "sample": {"title": "▶️ Impression démarrée", "priority": 2, "link": "/prints",
                   "message": "📄 Kit de semis auto-arrosant\n⏱ durée estimée 2 h 10 · ⚖️ 86 g\n🧵 Filaments :\n   • PLA Basic Vert — 80 g (AMS-A slot 2)\n   • PLA Basic Blanc — 6 g (AMS-A slot 4)",
                   "attach": _SAMPLE_COVER},
    },
    "print_first_layer": {
        "section": "prints", "label": "Première couche terminée",
        "description": "Photo de la caméra après la 1re couche : le moment de vérifier l'adhérence.",
        "options": [_MIN_MINUTES],
        "sample": {"title": "🔍 1re couche terminée", "priority": 3, "link": "/prints",
                   "message": "📄 Kit de semis auto-arrosant\n👀 Vérifie l'adhérence avant de laisser filer.\n📶 couche 2/180 · reste 2 h 04",
                   "attach": _SAMPLE_COVER},
    },
    "print_near_end": {
        "section": "prints", "label": "Bientôt terminée",
        "description": "Prévient quelques minutes avant la fin, pour aller la récupérer.",
        "options": [{"key": "minutes", "type": "number", "label": "Prévenir", "unit": "min avant la fin",
                     "default": 10, "min": 1, "max": 120}],
        "sample": {"title": "⏳ Fin dans 10 min", "priority": 3, "link": "/prints",
                   "message": "📄 Kit de semis auto-arrosant\n📶 94 %"},
    },
    "print_done": {
        "section": "prints", "label": "Impression terminée",
        "description": "Photo finale, durée réelle, filament consommé et coût.",
        "options": [_MIN_MINUTES],
        "sample": {"title": "✅ Impression terminée", "priority": 3, "link": "/prints",
                   "message": "📄 Kit de semis auto-arrosant\n⏱ 2 h 14 (prévu 2 h 10)\n⚖️ 86 g · 💶 2,31 €\n🧵 Filaments :\n   • PLA Basic Vert — 80 g\n   • PLA Basic Blanc — 6 g",
                   "attach": _SAMPLE_COVER},
    },
    "print_failed": {
        "section": "prints", "label": "Impression en échec ou annulée",
        "description": "Photo au moment de l'arrêt et avancement atteint.",
        "options": [],
        "sample": {"title": "❌ Impression en échec", "priority": 5, "link": "/prints",
                   "message": "📄 Kit de semis auto-arrosant\n📉 Arrêtée à 37 % après 48 min\n⚠️ Le plateau n'est pas en place."},
    },
    "print_paused": {
        "section": "prints", "label": "Impression en pause",
        "description": "Pause demandée ou imposée (fin de filament, bourrage…), avec la raison si connue.",
        "options": [],
        "sample": {"title": "⏸️ Impression en pause", "priority": 4, "link": "/",
                   "message": "📄 Kit de semis auto-arrosant\n📶 52 % · couche 94/180\n⚠️ Raison : le filament de l'AMS-A slot 2 est épuisé."},
    },
    "printer_hms": {
        "section": "prints", "label": "Alerte de l'imprimante (HMS)",
        "description": "Libellé en français et lien vers le wiki Bambu.",
        "options": [{"key": "level", "type": "select", "label": "Alertes", "default": "serious",
                     "choices": [["serious", "Graves seulement"], ["common", "Graves et courantes"],
                                 ["all", "Toutes"]]}],
        "sample": {"title": "⚠️ Alerte imprimante (grave)", "priority": 4, "link": "/",
                   "message": "Le filament de l'AMS-A slot 2 est épuisé.\n🔢 0700_2000_0002_0001\n📄 pendant : Kit de semis auto-arrosant",
                   "actions": [("Wiki Bambu", "https://wiki.bambulab.com/fr/h2c/troubleshooting/hmscode/0700_2000_0002_0001")]},
    },
    # ── Sechage ──
    "dry_started": {
        "section": "dry", "label": "Séchage démarré",
        "description": "Unité, température, durée et bobines concernées.",
        "options": [],
        "sample": {"title": "💧 Séchage démarré · AMS-A", "priority": 2, "link": "/",
                   "message": "🌡️ 55 °C · ⏱ 8 h · réglage PLA\n💧 humidité de l'AMS : 34 %\n🧵 2 bobines :\n   • Prune — PLA Matte · Bambu Lab\n   • Bleu glacier — PLA Basic · Bambu Lab"},
    },
    "dry_done": {
        "section": "dry", "label": "Séchage terminé",
        "description": "Quand une unité AMS termine son cycle de séchage.",
        "options": [],
        "sample": {"title": "☀️ Séchage terminé · AMS-A", "priority": 3, "link": "/",
                   "message": "Cycle complet : 8 h à 55 °C\n💧 humidité de l'AMS : 12 %\n🧵 2 bobines :\n   • Prune — PLA Matte · Bambu Lab\n   • Bleu glacier — PLA Basic · Bambu Lab"},
    },
    # ── Bobines ──
    "fil_to_order": {
        "section": "spools", "label": "Ajout au panier",
        "description": "Un filament est marqué « à commander ».",
        "options": [],
        "sample": {"title": "🛒 Ajouté au panier", "priority": 2, "link": "/filaments",
                   "message": "Vert · Bambu Lab\n🧵 PLA Basic\n📦 en stock : 1 bobine, 180 g"},
    },
    "spool_short": {
        "section": "spools", "label": "Pas assez de filament",
        "description": "Au démarrage d'une impression, une bobine a moins que ce qu'il faut.",
        "options": [],
        "sample": {"title": "⚠️ Pas assez de filament", "priority": 4, "link": "/prints",
                   "message": "📄 Kit de semis auto-arrosant\n🧵 Vert — PLA Basic · Bambu Lab (bobine #42)\nIl faut 86 g, il reste 52 g : il manque 34 g"},
    },
    "spool_low": {
        "section": "spools", "label": "Bobine bientôt vide",
        "description": "Une bobine passe sous 15 % après une impression.",
        "options": [],
        "sample": {"title": "🪫 Bobine bientôt vide", "priority": 3, "link": "/filaments",
                   "message": "🧵 Vert — PLA Basic · Bambu Lab · bobine #42\nReste 120 g (12 %)\n📦 1 autre(s) bobine(s) en stock"},
    },
    "stock_low": {
        "section": "spools", "label": "Fin de stock",
        "description": "La dernière bobine d'un filament passe sous 25 % : il est temps de racheter.",
        "options": [],
        "sample": {"title": "📉 Fin de stock", "priority": 3, "link": "/filaments",
                   "message": "🧵 Vert — PLA Basic · Bambu Lab\nDernière bobine : reste 230 g (23 %)\n🛒 pense à en racheter"},
    },
    # ── MakerWorld ──
    "mw_new_model": {
        "section": "mw", "label": "Nouveau modèle d'un créateur suivi",
        "description": "Un créateur choisi publie un modèle (vérifié toutes les heures).",
        "options": [],
        "sample": {"title": "🆕 Nouveau modèle de Meyui", "priority": 3,
                   "message": "Kit de semis auto-arrosant modulaire",
                   "click": "https://makerworld.com/fr/models/1400373",
                   "attach": _SAMPLE_COVER},
    },
}


_SOURCE = {"key": "source", "type": "select", "label": "Prévenir pour", "default": "outside",
           "choices": [["outside", "ce qui est fait sur MakerWorld ou Bambu Handy"],
                       ["all", "tout, y compris depuis BambuNymous"]]}
EVENTS["mw_coll_added"] = {
    "section": "mw", "label": "Modèle ajouté à une collection",
    "description": "Sur makerworld.com, Bambu Handy ou l'appli (vérifié toutes les 10 min).",
    "options": [_SOURCE],
    "sample": {"title": "➕ Ajouté à « Panier »", "priority": 2,
               "message": "📄 Kit de semis auto-arrosant modulaire\n👤 Meyui\n🖨️ jamais imprimé\n📁 « Panier » · 38 modèles",
               "click": "https://makerworld.com/fr/models/1400373", "attach": _SAMPLE_COVER,
               "actions": [("Voir le modèle", "https://makerworld.com/fr/models/1400373")]},
}
EVENTS["mw_coll_changed"] = {
    "section": "mw", "label": "Collection créée, renommée ou supprimée",
    "description": "Mes collections MakerWorld (vérifié toutes les 10 min).",
    "options": [_SOURCE],
    "sample": {"title": "📁 Collection créée", "priority": 2, "link": "/prints",
               "message": "« Idées Noël »\n📦 3 modèles"},
}


# Mon activite de createur MakerWorld (services/mw_creator.py, toutes les 30 min).
EVENTS["mw_points"] = {
    "section": "mw", "label": "Points MakerWorld reçus",
    "description": "Résumé de chaque versement (par modèle et profil), avec le solde.",
    "options": [],
    "sample": {"title": "💰 +18,5 points MakerWorld", "priority": 2,
               "message": "🪙 Solde : 218 points\n   • Pacman Ghost - Tea Light +10,83\n   • Toilet Signs Woman Man Fun +3\n   • Xbox Medallion +4,67"},
}
EVENTS["mw_boost"] = {
    "section": "mw", "label": "Boost reçu",
    "description": "Quelqu'un a boosté un de tes modèles.",
    "options": [],
    "sample": {"title": "⚡ Boost reçu", "priority": 3, "attach": _SAMPLE_COVER,
               "message": "📄 Pacman Ghost - Tea Light Candle Halloween\n⚡ 12 boosts au total"},
}
EVENTS["mw_fans"] = {
    "section": "mw", "label": "Nouveaux abonnés",
    "description": "Ton nombre d'abonnés MakerWorld augmente.",
    "options": [],
    "sample": {"title": "👥 +3 abonnés sur MakerWorld", "priority": 2, "message": "Tu as maintenant 274 abonnés."},
}
EVENTS["mw_milestone"] = {
    "section": "mw", "label": "Palier franchi par un de mes modèles",
    "description": "50, 100, 250, 500, 1 000, 2 500… téléchargements ou impressions.",
    "options": [{"key": "metric", "type": "select", "label": "Compter", "default": "both",
                 "choices": [["both", "téléchargements et impressions"], ["downloads", "téléchargements"],
                             ["prints", "impressions"]]}],
    "sample": {"title": "🏁 500 téléchargements !", "priority": 3, "attach": _SAMPLE_COVER,
               "message": "📄 Irony — Casse-tête 6 pièces\n⬇️ 500 téléchargements · 🖨️ 312 impressions"},
}


class NotifyError(Exception):
    pass


_CACHE = None     # derniere config lue : pour l'ecouteur MQTT, qui ne lit pas la base


async def _load() -> dict:
    global _CACHE
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
    _CACHE = cfg
    return cfg


async def _save(cfg: dict) -> None:
    global _CACHE
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(cfg, ensure_ascii=False))
    _CACHE = cfg


def cached():
    """Config en memoire (None tant qu'elle n'a pas ete lue)."""
    return _CACHE


def _opt_value(o: dict, v):
    if o["type"] == "number":
        try:
            v = int(v)
        except (TypeError, ValueError):
            return o["default"]
        return max(o.get("min", v), min(o.get("max", v), v))
    if o["type"] == "select":
        return v if v in [c[0] for c in o["choices"]] else o["default"]
    return o["default"]


def options_of(cfg: dict, event: str) -> dict:
    stored = ((cfg.get("events") or {}).get(event) or {}).get("options") or {}
    return {o["key"]: _opt_value(o, stored.get(o["key"], o["default"])) for o in EVENTS[event]["options"]}


def enabled_in(cfg, event: str) -> bool:
    return bool(cfg and ((cfg.get("events") or {}).get(event) or {}).get("enabled"))


def _public(cfg: dict) -> dict:
    """Ce que voit le navigateur : jamais le jeton."""
    n = cfg.get("ntfy") or {}
    return {
        "ntfy": {"url": n.get("url") or "https://ntfy.sh", "topic": n.get("topic") or "",
                 "app_url": n.get("app_url") or "", "has_token": bool(n.get("token"))},
        "sections": [{"id": k, "label": v} for k, v in SECTIONS],
        "events": [{"id": k, "section": v["section"], "label": v["label"], "description": v["description"],
                    "enabled": enabled_in(cfg, k),
                    "creators": ((cfg["events"].get(k) or {}).get("creators") or []),
                    "options": [{**o, "value": options_of(cfg, k)[o["key"]]} for o in v["options"]]}
                   for k, v in EVENTS.items()],
    }


async def get_config() -> dict:
    return _public(await _load())


def _clean_url(u: str, what: str) -> str:
    u = (u or "").strip().rstrip("/")
    if u and (not u.startswith(("http://", "https://")) or len(u) > 300 or " " in u):
        raise NotifyError(f"{what} invalide (http:// ou https://)")
    return u


async def set_ntfy(url: str, topic: str, token=None, app_url=None) -> dict:
    """token None = inchange ; "" = retire. app_url None = inchange."""
    url = _clean_url(url, "Adresse du serveur ntfy") or "https://ntfy.sh"
    topic = (topic or "").strip()
    if topic and (len(topic) > 64 or not all(c.isalnum() or c in "-_" for c in topic)):
        raise NotifyError("Sujet ntfy : lettres, chiffres, - et _ seulement (64 max)")
    cfg = await _load()
    n = cfg["ntfy"]
    n.update({"url": url, "topic": topic})
    if token is not None:
        n["token"] = str(token).strip()[:200]
    if app_url is not None:
        n["app_url"] = _clean_url(app_url, "Adresse de l'appli")
    await _save(cfg)
    return _public(cfg)


async def set_event(event: str, enabled=None, creators=None, options=None) -> dict:
    if event not in EVENTS:
        raise NotifyError("Type de notification inconnu")
    cfg = await _load()
    e = cfg["events"].setdefault(event, {})
    if enabled is not None:
        e["enabled"] = bool(enabled)
    if creators is not None:
        e["creators"] = [str(c) for c in creators if str(c).isdigit()][:1000]
    if isinstance(options, dict):
        known = {o["key"]: o for o in EVENTS[event]["options"]}
        cur = e.setdefault("options", {})
        for k, v in options.items():
            if k in known:
                cur[k] = _opt_value(known[k], v)
    await _save(cfg)
    return _public(cfg)


async def event_settings(event: str) -> dict:
    """Reglages d'un type (enabled, creators, options) pour le code qui le declenche."""
    cfg = await _load()
    return {"enabled": False, "creators": [], **(cfg["events"].get(event) or {}),
            "options": options_of(cfg, event)}


def app_link(cfg, path: str):
    """Lien vers une page de l'appli, si son adresse est renseignee."""
    base = ((cfg or {}).get("ntfy") or {}).get("app_url") or ""
    return f"{base}{path}" if base and path is not None else None


# ── Envoi ──────────────────────────────────────────────────────────────────
def _error_of(r) -> str:
    try:
        err = r.json().get("error")
    except ValueError:
        err = None
    return err or f"ntfy a refusé (HTTP {r.status_code})"


def _post_ntfy(n: dict, title: str, message: str, click=None, attach=None, tags=None, priority=None,
               actions=None, file=None, filename=None, icon=None):
    """Publie. file (chemin ou octets) part en piece jointe (l'image s'affiche
    en grand) ; si le serveur ne prend pas les pieces jointes, on renvoie sans."""
    from .makerworld import session
    if not n.get("topic"):
        raise NotifyError("Sujet ntfy non renseigné")
    base = n.get("url") or "https://ntfy.sh"
    auth = {"Authorization": f"Bearer {n['token']}"} if n.get("token") else {}
    acts = [{"action": "view", "label": lbl[:40], "url": u, "clear": False}
            for lbl, u in (actions or []) if u][:3]
    data = None
    if file is not None:
        try:
            data = file if isinstance(file, (bytes, bytearray)) else Path(file).read_bytes()
        except OSError:
            data = None
    if data:
        params = {"title": title[:250], "message": (message or "")[:4000], "filename": filename or "image.jpg"}
        if click: params["click"] = click
        if tags: params["tags"] = ",".join(tags)
        if priority: params["priority"] = str(priority)
        if acts: params["actions"] = json.dumps(acts, ensure_ascii=False)
        if icon: params["icon"] = icon
        try:
            r = session().put(f"{base}/{n['topic']}", data=bytes(data), params=params, headers=auth, timeout=30)
        except Exception as e:
            raise NotifyError(f"Serveur ntfy injoignable ({type(e).__name__})")
        if r.status_code < 400:
            return
        if r.status_code in (401, 403):
            raise NotifyError(_error_of(r))
        logger.info(f"[NOTIF] piece jointe refusee par ntfy ({_error_of(r)}) : envoi sans image")
    body = {"topic": n["topic"], "title": title[:250], "message": (message or "")[:4000]}
    if click: body["click"] = click
    if attach and not data: body["attach"] = attach
    if tags: body["tags"] = tags
    if priority: body["priority"] = int(priority)
    if acts: body["actions"] = acts
    if icon: body["icon"] = icon
    try:
        r = session().post(base, json=body, headers={"Content-Type": "application/json", **auth}, timeout=15)
    except Exception as e:
        raise NotifyError(f"Serveur ntfy injoignable ({type(e).__name__})")
    if r.status_code >= 400:
        raise NotifyError(_error_of(r))


async def send(title: str, message: str = "", click=None, attach=None, tags=None, priority=None,
               actions=None, file=None, filename=None, icon=None) -> None:
    """icon : petite image de la notification (Android ; iOS l'ignore). Par
    defaut le logo BambuNymous, servi par l'appli si son adresse est connue."""
    import asyncio
    cfg = await _load()
    icon = icon or app_link(cfg, "/icon-192.png")
    await asyncio.to_thread(_post_ntfy, cfg["ntfy"], title, message, click, attach, tags, priority,
                            actions, file, filename, icon)


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
    cfg = await _load()
    if event:
        s = EVENTS[event]["sample"]
        click = s.get("click") or app_link(cfg, s.get("link"))
        actions = list(s.get("actions") or [])
        if s.get("link") is not None and app_link(cfg, s["link"]):
            actions.insert(0, ("Ouvrir BambuNymous", app_link(cfg, s["link"])))
        await send("[Test] " + s["title"], s["message"], click=click, attach=s.get("attach"),
                   priority=s.get("priority"), actions=actions)
    else:
        await send("BambuNymous", "Test de notification : le canal ntfy fonctionne.", tags=["white_check_mark"],
                   click=app_link(cfg, "/"))
    return {"ok": True}
