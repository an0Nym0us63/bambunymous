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
    ("printer", "📡 Imprimante"),
    ("dry", "💧 Séchage"),
    ("spools", "🧵 Bobines et AMS"),
    ("mw", "🌐 MakerWorld"),
    ("friends", "👥 Copains"),
    ("system", "🖥️ BambuNymous"),
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
        "section": "printer", "label": "Alerte de l'imprimante (HMS)",
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
EVENTS["mw_points_goal"] = {
    "section": "mw", "label": "Palier de points : récompense à portée",
    "description": "Ton solde atteint de quoi prendre une récompense MakerWorld : 500 pts = 40 € de réduction, "
                   "524 pts = carte cadeau 40 €, et toutes leurs combinaisons (1 000, 1 024, 1 048…).",
    "options": [{"key": "kind", "type": "select", "label": "Récompenses", "default": "both",
                 "choices": [["both", "réductions et cartes cadeaux"], ["coupon", "réductions (500 pts)"],
                             ["card", "cartes cadeaux (524 pts)"]]}],
    "sample": {"title": "🎁 1 024 points : 80 € de récompenses", "priority": 3,
               "message": "🪙 Solde : 1 031 points\n🎟️ 1 carte cadeau 40 € + 1 réduction de 40 €\n"
                          "Avec ton solde : 2 × 40 € (2 réductions, ou 1 carte + 1 réduction)\n"
                          "➡️ Prochain palier : 1 048 pts (2 cartes cadeaux 40 €)"},
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


# ── Ajouts du 20/10/2026 : tout ce que l'appli sait voir ──────────────────
EVENTS["print_progress"] = {
    "section": "prints", "label": "Avancement de l'impression",
    "description": "Un message à chaque palier (25 %, 50 %, 75 %…).",
    "options": [{"key": "step", "type": "select", "label": "Paliers", "default": "25",
                 "choices": [["50", "à mi-parcours"], ["25", "tous les 25 %"], ["20", "tous les 20 %"],
                             ["10", "tous les 10 %"]]}, _MIN_MINUTES],
    "sample": {"title": "📶 50 % · Kit de semis auto-arrosant", "priority": 2, "link": "/",
               "message": "🧱 couche 94/180\n⏳ encore 1 h 12"},
}
EVENTS["print_resumed"] = {
    "section": "prints", "label": "Impression reprise",
    "description": "Après une pause, avec la durée de la pause.",
    "options": [],
    "sample": {"title": "▶️ Impression reprise", "priority": 3, "link": "/",
               "message": "📄 Kit de semis auto-arrosant\n⏸️ en pause pendant 6 min · 📶 52 %"},
}
EVENTS["print_speed"] = {
    "section": "prints", "label": "Vitesse modifiée",
    "description": "Silencieux, Standard, Sport ou Ludique, changé pendant une impression.",
    "options": [],
    "sample": {"title": "🏎️ Vitesse : Sport", "priority": 2, "link": "/",
               "message": "📄 Kit de semis auto-arrosant\navant : Standard\n⏳ encore 58 min"},
}
EVENTS["printer_offline"] = {
    "section": "printer", "label": "Imprimante injoignable",
    "description": "Plus de nouvelles de l'imprimante pendant 3 minutes (éteinte, Wi-Fi…).",
    "options": [{"key": "back", "type": "select", "label": "Au retour", "default": "yes",
                 "choices": [["yes", "prévenir aussi"], ["no", "ne rien dire"]]}],
    "sample": {"title": "📴 Imprimante injoignable", "priority": 4, "link": "/",
               "message": "Plus de nouvelles depuis 3 min (éteinte, Wi-Fi coupé ?)."},
}
EVENTS["bed_cooled"] = {
    "section": "printer", "label": "Plateau refroidi",
    "description": "Après une impression, le plateau est assez froid pour décoller la pièce.",
    "options": [{"key": "temp", "type": "number", "label": "Sous", "unit": "°C", "default": 35, "min": 20, "max": 70}],
    "sample": {"title": "🧊 Plateau refroidi (34 °C)", "priority": 3, "link": "/",
               "message": "📄 Kit de semis auto-arrosant\nTu peux retirer la pièce."},
}
EVENTS["printer_firmware"] = {
    "section": "printer", "label": "Firmware mis à jour",
    "description": "La version du firmware de l'imprimante a changé.",
    "options": [],
    "sample": {"title": "🆕 Firmware de l'imprimante mis à jour", "priority": 2, "link": "/",
               "message": "01.02.00.00 → 01.03.00.00"},
}
EVENTS["ams_humidity"] = {
    "section": "spools", "label": "AMS trop humide",
    "description": "L'humidité d'une unité dépasse le seuil pendant 10 min.",
    "options": [{"key": "pct", "type": "number", "label": "Au-dessus de", "unit": "%", "default": 40, "min": 10, "max": 90}],
    "sample": {"title": "💦 AMS-B trop humide : 47 %", "priority": 3, "link": "/",
               "message": "Seuil : 40 %\nPense au déshydratant, ou à un cycle de séchage."},
}
EVENTS["spool_loaded"] = {
    "section": "spools", "label": "Bobine chargée",
    "description": "Une bobine arrive dans un emplacement de l'AMS : laquelle, reconnue ou non.",
    "options": [{"key": "which", "type": "select", "label": "Prévenir pour", "default": "all",
                 "choices": [["all", "toutes les bobines"], ["unknown", "les bobines non reconnues"]]}],
    "sample": {"title": "🧵 Bobine chargée · AMS-A slot 2", "priority": 2, "link": "/",
               "message": "Prune — PLA Matte · Bambu Lab\n⚖️ reste environ 640 g"},
}
EVENTS["spool_removed"] = {
    "section": "spools", "label": "Bobine retirée",
    "description": "Un emplacement de l'AMS se vide.",
    "options": [],
    "sample": {"title": "📤 Bobine retirée · AMS-A slot 2", "priority": 2, "link": "/",
               "message": "Prune — PLA Matte · Bambu Lab"},
}
EVENTS["mw_to_rate"] = {
    "section": "mw", "label": "Impressions à évaluer",
    "description": "De nouveaux modèles imprimés attendent ton avis sur MakerWorld (relevé toutes les 6 h).",
    "options": [],
    "sample": {"title": "⭐ 2 impressions à évaluer", "priority": 2, "link": "/prints",
               "message": "   • Kit de semis auto-arrosant\n   • Toucan"},
}
EVENTS["friend_print_started"] = {
    "section": "friends", "label": "Un copain lance une impression",
    "description": "Relevé toutes les 5 min chez chaque copain.",
    "options": [],
    "sample": {"title": "👥 Léo imprime", "priority": 2, "link": "/",
               "message": "📄 Dragon articulé\n⏳ encore 3 h 10"},
}
EVENTS["friend_print_done"] = {
    "section": "friends", "label": "L'impression d'un copain se termine",
    "description": "Son imprimante a fini (ou s'est arrêtée).",
    "options": [],
    "sample": {"title": "👥 Léo a fini d'imprimer", "priority": 2, "link": "/",
               "message": "📄 Dragon articulé"},
}
EVENTS["app_started"] = {
    "section": "system", "label": "BambuNymous redémarré",
    "description": "L'appli vient de (re)démarrer : mise à jour, redémarrage du serveur…",
    "options": [],
    "sample": {"title": "🔄 BambuNymous a redémarré", "priority": 1, "link": "/",
               "message": "Tout est reparti."},
}

# Ordre d'affichage dans chaque section
_ORDER = ["print_started", "print_first_layer", "print_progress", "print_near_end", "print_done", "print_failed",
          "print_paused", "print_resumed", "print_speed",
          "printer_hms", "printer_offline", "bed_cooled", "printer_firmware",
          "dry_started", "dry_done",
          "spool_loaded", "spool_removed", "ams_humidity", "spool_low", "spool_short", "stock_low", "fil_to_order"]
EVENTS = {**{k: EVENTS[k] for k in _ORDER if k in EVENTS}, **{k: v for k, v in EVENTS.items() if k not in _ORDER}}


class NotifyError(Exception):
    pass


# Canal des notifications : ntfy, un bot Telegram (pour qui n'a pas ntfy), ou les deux.
# Canaux, chacun active ou non (20/10/2026) : ntfy, bot Telegram, appli Android.
# Remplace l'ancien choix exclusif « channel » (ntfy | telegram | both | app).
KINDS = ("ntfy", "telegram", "app")
_OLD_CHANNEL = {"ntfy": ("ntfy",), "telegram": ("telegram",), "both": ("ntfy", "telegram"), "app": ("app",)}
TG_API = "https://api.telegram.org"


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
    cfg.setdefault("tgbot", {})
    cfg.setdefault("events", {})
    cfg.setdefault("routes", {})
    cfg.setdefault("devices", [])
    cfg.setdefault("app_prefs", {})
    if not isinstance(cfg.get("channels"), dict):
        old = _OLD_CHANNEL.get(cfg.get("channel") or "ntfy", ("ntfy",))
        cfg["channels"] = {k: k in old or (k == "app" and bool(cfg.get("app_push"))) for k in KINDS}
    cfg.pop("channel", None)
    cfg.pop("app_push", None)
    _normalize(cfg)
    _CACHE = cfg
    return cfg


def _normalize(cfg: dict) -> None:
    """Plusieurs sujets ntfy et plusieurs discussions Telegram (20/10/2026).
    L'ancien sujet unique et l'ancienne discussion unique deviennent le premier
    element de leur liste, celui par defaut ; « topic » et « chat_id » restent
    tenus egaux a ce premier element."""
    n, b = cfg["ntfy"], cfg["tgbot"]
    if not isinstance(n.get("topics"), list):
        n["topics"] = [{"topic": n["topic"], "label": "", "icon": ""}] if n.get("topic") else []
    n["topic"] = n["topics"][0]["topic"] if n["topics"] else ""
    if not isinstance(b.get("chats"), list):
        b["chats"] = [{"chat_id": b["chat_id"], "label": b.get("chat_label") or ""}] if b.get("chat_id") else []
    b["chat_id"] = b["chats"][0]["chat_id"] if b["chats"] else ""
    b["chat_label"] = b["chats"][0]["label"] if b["chats"] else ""


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


def global_on(cfg, event: str) -> bool:
    """Active par l'administrateur : part sur ntfy et Telegram."""
    return bool(cfg and ((cfg.get("events") or {}).get(event) or {}).get("enabled"))


def app_wants(cfg, user, event: str) -> bool:
    """Ce que le proprietaire d'un telephone veut recevoir sur l'appli. Sans
    choix de sa part (ou telephone sans proprietaire connu) : comme
    l'administrateur."""
    prefs = (cfg.get("app_prefs") or {}).get(user or "") if user else None
    if isinstance(prefs, dict) and event in prefs:
        return bool(prefs[event])
    return global_on(cfg, event)


def enabled_in(cfg, event: str) -> bool:
    """L'evenement merite-t-il d'etre calcule ? Oui si l'administrateur l'a
    active, ou si un telephone inscrit le veut (appli activee)."""
    if global_on(cfg, event):
        return True
    if not cfg or not (cfg.get("channels") or {}).get("app"):
        return False
    return any(app_wants(cfg, d.get("user"), event) for d in cfg.get("devices") or [])


def _public(cfg: dict) -> dict:
    """Ce que voit le navigateur : jamais le jeton."""
    n = cfg.get("ntfy") or {}
    b = cfg.get("tgbot") or {}
    return {
        "channels": {k: bool(cfg["channels"].get(k)) for k in KINDS},
        # Appli Android (UnifiedPush) : les telephones inscrits, jamais leur adresse
        # d'envoi (elle suffit a leur ecrire).
        "devices": [{k: d.get(k) for k in ("id", "name", "user", "added", "last_ok", "last_err")} for d in cfg.get("devices") or []],
        "ntfy": {"url": n.get("url") or "https://ntfy.sh", "topic": n.get("topic") or "",
                 "topics": n.get("topics") or [],
                 "app_url": n.get("app_url") or "", "has_token": bool(n.get("token"))},
        # Jamais le jeton du bot : seulement s'il est pose, et le nom du bot.
        "tgbot": {"has_token": bool(b.get("token")), "bot": b.get("bot") or "", "chat_id": b.get("chat_id") or "",
                  "chat_label": b.get("chat_label") or "", "chats": b.get("chats") or []},
        # Destination de chaque section ("" = celle par defaut)
        "sections": [{"id": k, "label": v, "route": {"ntfy": _route(cfg, k, "ntfy"), "telegram": _route(cfg, k, "telegram")}}
                     for k, v in SECTIONS],
        "events": [{"id": k, "section": v["section"], "label": v["label"], "description": v["description"],
                    "enabled": global_on(cfg, k),
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


def _check_topic(topic: str) -> str:
    topic = (topic or "").strip()
    if topic and (len(topic) > 64 or not all(c.isalnum() or c in "-_" for c in topic)):
        raise NotifyError(f"Sujet ntfy « {topic[:20]} » : lettres, chiffres, - et _ seulement (64 max)")
    return topic


async def set_ntfy(url: str, topic: str, token=None, app_url=None, topics=None) -> dict:
    """token None = inchange ; "" = retire. app_url None = inchange. topics :
    la liste complete [{topic, label, icon}] (le premier est celui par defaut) ;
    sans elle, `topic` remplace seulement le sujet par defaut."""
    url = _clean_url(url, "Adresse du serveur ntfy") or "https://ntfy.sh"
    cfg = await _load()
    n = cfg["ntfy"]
    if isinstance(topics, list):
        seen, out = set(), []
        for t in topics[:20]:
            if not isinstance(t, dict):
                continue
            tp = _check_topic(t.get("topic"))
            if not tp or tp in seen:
                continue
            seen.add(tp)
            out.append({"topic": tp, "label": str(t.get("label") or "").strip()[:40],
                        "icon": _clean_url(str(t.get("icon") or ""), "Icône du sujet")})
        n["topics"] = out
    else:
        tp = _check_topic(topic)
        rest = [t for t in n.get("topics") or [] if t["topic"] != tp][1:] if n.get("topics") else []
        n["topics"] = ([{"topic": tp, "label": "", "icon": ""}] if tp else []) + rest
    n["url"] = url
    _normalize(cfg)
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
            "options": options_of(cfg, event)} | {"enabled": enabled_in(cfg, event)}


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


# ── Bot Telegram ─────────────────────────────────────────────────────────────
def _tg(token: str, method: str, data=None, files=None, timeout=20):
    from .makerworld import session
    try:
        r = session().post(f"{TG_API}/bot{token}/{method}", data=data, files=files, timeout=timeout)
    except Exception as e:
        raise NotifyError(f"Telegram injoignable ({type(e).__name__})")
    try:
        j = r.json()
    except ValueError:
        j = {}
    if not j.get("ok"):
        desc = j.get("description") or f"HTTP {r.status_code}"
        if r.status_code == 401:
            desc = "Jeton du bot refusé (vérifie-le auprès de @BotFather)"
        raise NotifyError(f"Telegram : {desc}")
    return j.get("result")


def _post_tgbot(b: dict, title: str, message: str, click=None, attach=None, actions=None, file=None, filename=None):
    """Envoie au chat du bot : image (piece jointe, sinon adresse) avec legende,
    sinon texte ; liens en boutons sous le message."""
    import html as _h
    if not b.get("token") or not b.get("chat_id"):
        raise NotifyError("Bot Telegram non configuré (jeton et discussion)")
    text = f"<b>{_h.escape(title)}</b>" + (f"\n{_h.escape(message)}" if message else "")
    # Boutons : seulement des liens https (Telegram refuse le reste, localhost compris).
    btns = [(lbl, u) for lbl, u in ([("Ouvrir", click)] if click else []) + list(actions or [])
            if u and str(u).startswith("https://")]
    seen, rows = set(), []
    for lbl, u in btns:
        if u not in seen:
            seen.add(u)
            rows.append([{"text": str(lbl)[:40], "url": u}])
    base = {"chat_id": b["chat_id"], "parse_mode": "HTML"}
    if rows:
        base["reply_markup"] = json.dumps({"inline_keyboard": rows[:4]})
    data = None
    if file is not None:
        try:
            data = file if isinstance(file, (bytes, bytearray)) else Path(file).read_bytes()
        except OSError:
            data = None
    cap = text[:1024]
    try:
        if data:
            return _tg(b["token"], "sendPhoto", {**base, "caption": cap},
                       files={"photo": (filename or "image.jpg", bytes(data))}, timeout=40)
        if attach and str(attach).startswith("http"):
            return _tg(b["token"], "sendPhoto", {**base, "caption": cap, "photo": attach})
    except NotifyError as e:
        if "Jeton" in str(e):
            raise
        logger.info(f"[NOTIF] image refusee par Telegram ({e}) : envoi en texte")
    return _tg(b["token"], "sendMessage", {**base, "text": text[:4096], "disable_web_page_preview": "true"})


def _check_chat(c) -> str:
    c = str(c or "").strip()
    if c and not (c.lstrip("-").isdigit() or (c.startswith("@") and len(c) < 40)):
        raise NotifyError(f"Discussion « {c[:20]} » invalide (identifiant numérique ou @canal)")
    return c


async def set_tgbot(token=None, chat_id=None, chats=None) -> dict:
    """token None = inchange ; "" = retire (et oublie les discussions).
    chats : la liste complete [{chat_id, label}] (la premiere par defaut)."""
    import asyncio
    cfg = await _load()
    b = cfg["tgbot"]
    if token is not None:
        token = token.strip()
        if not token:
            cfg["tgbot"] = {}
            await _save(cfg)
            return _public(cfg)
        if ":" not in token or len(token) > 100 or " " in token:
            raise NotifyError("Jeton de bot invalide (forme 123456:ABC…, donné par @BotFather)")
        me = await asyncio.to_thread(_tg, token, "getMe")
        b.update({"token": token, "bot": me.get("username") or ""})
    if isinstance(chats, list):
        seen, out = set(), []
        for c in chats[:20]:
            if not isinstance(c, dict):
                continue
            cid = _check_chat(c.get("chat_id"))
            if not cid or cid in seen:
                continue
            seen.add(cid)
            out.append({"chat_id": cid, "label": str(c.get("label") or "").strip()[:60]})
        b["chats"] = out
    elif chat_id is not None:
        cid = _check_chat(chat_id)
        rest = [c for c in b.get("chats") or [] if c["chat_id"] != cid][1:] if b.get("chats") else []
        b["chats"] = ([{"chat_id": cid, "label": ""}] if cid else []) + rest
    _normalize(cfg)
    await _save(cfg)
    return _public(cfg)


async def detect_tgbot_chat() -> dict:
    """Trouve les discussions qui ont ecrit au bot (« /start » en prive, un
    message dans un groupe ou il a ete ajoute) et ajoute les nouvelles."""
    import asyncio
    cfg = await _load()
    b = cfg["tgbot"]
    if not b.get("token"):
        raise NotifyError("Pose d'abord le jeton du bot")
    ups = await asyncio.to_thread(_tg, b["token"], "getUpdates", {"limit": "50", "timeout": "0"})
    found = {}
    for u in reversed(ups or []):
        m = u.get("message") or u.get("channel_post") or u.get("my_chat_member") or {}
        chat = m.get("chat") or {}
        if chat.get("id") and str(chat["id"]) not in found:
            found[str(chat["id"])] = chat.get("title") or " ".join(
                filter(None, [chat.get("first_name"), chat.get("last_name")])) \
                or (f"@{chat['username']}" if chat.get("username") else "")
    if not found:
        raise NotifyError(f"Aucun message reçu : écris « /start » à @{b.get('bot') or 'ton bot'} dans Telegram "
                          "(ou un message dans le groupe où tu l'as ajouté), puis réessaie")
    have = {c["chat_id"]: c for c in b.get("chats") or []}
    for cid, label in found.items():
        if cid in have:
            have[cid]["label"] = have[cid]["label"] or label
        else:
            b.setdefault("chats", []).append({"chat_id": cid, "label": label})
    _normalize(cfg)
    await _save(cfg)
    return _public(cfg) | {"found": len(found)}


def _route(cfg: dict, section: str, kind: str) -> str:
    """Sujet ntfy / discussion choisi pour une section ; "" = celui par defaut
    (aussi quand le choix ne figure plus dans la liste)."""
    v = ((cfg.get("routes") or {}).get(section) or {}).get(kind) or ""
    if kind == "ntfy":
        return v if any(t["topic"] == v for t in cfg["ntfy"].get("topics") or []) else ""
    return v if any(c["chat_id"] == v for c in cfg["tgbot"].get("chats") or []) else ""


async def set_route(section: str, ntfy=None, telegram=None) -> dict:
    if section not in dict(SECTIONS):
        raise NotifyError("Section inconnue")
    cfg = await _load()
    r = cfg["routes"].setdefault(section, {})
    if ntfy is not None:
        r["ntfy"] = str(ntfy)
    if telegram is not None:
        r["telegram"] = str(telegram)
    await _save(cfg)
    return _public(cfg)


# ── Appli Android (UnifiedPush, ntfy en distributeur) ───────────────────────
# L'appli s'inscrit aupres de son distributeur (l'appli ntfy), qui lui donne une
# adresse sur le serveur ntfy ; la page la transmet ici. Envoyer = POST d'un
# JSON compact sur cette adresse : l'appli l'affiche elle-meme (son icone, son
# nom, une categorie Android par section, la page a ouvrir). Message en clair :
# le connecteur le livre tel quel (il ne dechiffre que s'il le peut).
UP_MAX = 3800            # octets : les distributeurs garantissent 4096


def _endpoint_ok(u: str) -> str:
    u = (u or "").strip()
    if not u.startswith("https://") or len(u) > 500 or " " in u:
        raise NotifyError("Adresse UnifiedPush invalide (https://…)")
    return u


async def add_device(endpoint: str, name: str = "", user: str = "") -> dict:
    """Inscrit (ou met a jour) un telephone de `user` ; la meme adresse n'est
    gardee qu'une fois (reinscrite par un autre compte, elle change de main)."""
    import secrets
    from datetime import datetime, timezone
    endpoint = _endpoint_ok(endpoint)
    cfg = await _load()
    devs = cfg["devices"]
    d = next((x for x in devs if x.get("endpoint") == endpoint), None)
    if d is None:
        if len(devs) >= 20:
            raise NotifyError("20 téléphones au plus")
        d = {"id": secrets.token_hex(6), "endpoint": endpoint,
             "added": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        devs.append(d)
    if name:
        d["name"] = str(name).strip()[:60]
    if user:
        d["user"] = user
    await _save(cfg)
    return _public(cfg)


async def remove_device(dev_id: str = "", endpoint: str = "", user: str = "", admin: bool = True) -> dict:
    """Retire un telephone (par son id ou son adresse) ; hors administrateur,
    seulement les siens."""
    cfg = await _load()

    def hit(d):
        if not ((dev_id and d.get("id") == dev_id) or (endpoint and d.get("endpoint") == endpoint)):
            return False
        return admin or (d.get("user") or "") == user
    before = len(cfg["devices"])
    cfg["devices"] = [d for d in cfg["devices"] if not hit(d)]
    if dev_id and len(cfg["devices"]) == before:
        raise NotifyError("Téléphone inconnu, ou pas le tien")
    await _save(cfg)
    return _public(cfg)


# ── Mes notifications sur l'appli (chaque utilisateur) ───────────────────────
def me_view(cfg, user: str) -> dict:
    """Ce que voit un utilisateur : ses telephones et ses choix, type par type."""
    return {
        "app_on": bool((cfg.get("channels") or {}).get("app")),
        "sections": [{"id": k, "label": v} for k, v in SECTIONS],
        "events": [{"id": k, "section": v["section"], "label": v["label"], "description": v["description"],
                    "mine": app_wants(cfg, user, k)} for k, v in EVENTS.items()],
        "devices": [{k: d.get(k) for k in ("id", "name", "added", "last_ok", "last_err")}
                    for d in cfg.get("devices") or [] if (d.get("user") or "") == user],
    }


async def me_config(user: str) -> dict:
    return me_view(await _load(), user)


async def set_my_events(user: str, patch: dict) -> dict:
    """{evenement: bool} ; une section entiere : {"section:prints": bool}."""
    cfg = await _load()
    prefs = cfg["app_prefs"].setdefault(user, {})
    # premiere fois : on fige le point de depart (ce que l'administrateur recoit)
    for k in EVENTS:
        prefs.setdefault(k, global_on(cfg, k))
    for k, v in (patch or {}).items():
        if k.startswith("section:"):
            for e, ev in EVENTS.items():
                if ev["section"] == k[8:]:
                    prefs[e] = bool(v)
        elif k in EVENTS:
            prefs[k] = bool(v)
    await _save(cfg)
    return me_view(cfg, user)


async def test_device(dev_id: str, user: str, admin: bool) -> dict:
    import asyncio
    cfg = await _load()
    d = next((x for x in cfg["devices"] if x.get("id") == dev_id), None)
    if not d or not (admin or (d.get("user") or "") == user):
        raise NotifyError("Téléphone inconnu, ou pas le tien")
    errs = await asyncio.to_thread(_post_devices, cfg, [d], "BambuNymous",
                                   f"Test de notification : « {d.get('name') or 'ce téléphone'} » fonctionne.",
                                   app_link(cfg, "/"), 3, "system", None)
    await _save(cfg)
    if errs:
        raise NotifyError(errs[0])
    return {"ok": True}




def _up_payload(title, message, click, priority, section, attach) -> bytes:
    """JSON compact : t titre, m texte, u lien, p priorite, s section, i image."""
    d = {"t": (title or "")[:200], "m": message or "", "u": click or "", "p": int(priority or 3), "s": section or ""}
    if attach and str(attach).startswith("https://"):
        d["i"] = attach
    raw = json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    while len(raw) > UP_MAX and d["m"]:
        d["m"] = d["m"][: max(0, len(d["m"]) - (len(raw) - UP_MAX) - 4)] + "…"
        raw = json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return raw


def _post_devices(cfg, devices, title, message, click, priority, section, attach) -> list:
    """Envoie a chaque telephone ; rend les erreurs (une par telephone en echec)."""
    from urllib.parse import urlparse
    from .makerworld import session
    from datetime import datetime, timezone
    body = _up_payload(title, message, click, priority, section, attach)
    n = cfg.get("ntfy") or {}
    ntfy_host = urlparse(n.get("url") or "https://ntfy.sh").netloc
    errs = []
    for d in devices:
        # sur NOTRE serveur ntfy protege, le jeton d'acces (les sujets up* sont
        # souvent ouverts en ecriture, mais pas toujours)
        auth = {"Authorization": f"Bearer {n['token']}"} if n.get("token") and urlparse(d["endpoint"]).netloc == ntfy_host else {}
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        try:
            r = session().post(d["endpoint"], data=body, headers={"Content-Type": "application/json",
                                                                 "TTL": "86400", "Urgency": "high", **auth}, timeout=15)
            if r.status_code in (401, 403):
                # ntfy protege : les sujets UnifiedPush (up*) doivent etre ouverts
                # en ecriture, ou le jeton doit valoir pour ce serveur
                same = urlparse(d["endpoint"]).netloc == ntfy_host
                raise NotifyError(f"HTTP {r.status_code}, refusé par ntfy : " + (
                    "ouvre les sujets up* en écriture (ntfy access everyone 'up*' write-only) ou donne ce droit au jeton"
                    if same else f"le téléphone utilise {urlparse(d['endpoint']).netloc}, différent du serveur ntfy "
                                 f"renseigné ({ntfy_host}) : le jeton n'y est pas envoyé"))
            if r.status_code >= 400:
                raise NotifyError(f"HTTP {r.status_code}")
            d["last_ok"], d["last_err"] = now, None
        except Exception as e:
            d["last_err"] = f"{now[:16]} : {e if isinstance(e, NotifyError) else type(e).__name__}"
            errs.append(f"{d.get('name') or 'téléphone'} : {d['last_err'].split(' : ', 1)[1]}")
    return errs


async def set_channels(patch: dict) -> dict:
    """Active ou coupe des canaux : {"ntfy": true, "app": false…}."""
    cfg = await _load()
    for k, v in (patch or {}).items():
        if k in KINDS:
            cfg["channels"][k] = bool(v)
    await _save(cfg)
    return _public(cfg)


def _on(cfg) -> list:
    return [k for k in KINDS if (cfg.get("channels") or {}).get(k)]


_KIND_FR = {"ntfy": "ntfy", "telegram": "Telegram", "app": "l'appli Android"}


async def send(title: str, message: str = "", click=None, attach=None, tags=None, priority=None,
               actions=None, file=None, filename=None, icon=None, event=None, topic=None, chat=None) -> None:
    """icon : petite image de la notification (Android ; iOS l'ignore). Par
    defaut le logo BambuNymous, servi par l'appli si son adresse est connue.
    Part sur chaque canal active (ntfy, bot Telegram, appli Android) ; un canal
    en panne n'empeche pas les autres, l'erreur ne remonte que si tous
    echouent. event : type d'ou vient l'envoi,
    pour le sujet ntfy et la discussion de sa section ; topic / chat : une
    destination imposee (essai d'un sujet ou d'une discussion)."""
    import asyncio
    cfg = await _load()
    sec = EVENTS[event]["section"] if event in EVENTS else None
    topic = topic or (_route(cfg, sec, "ntfy") if sec else "") or cfg["ntfy"].get("topic")
    chat = chat or (_route(cfg, sec, "telegram") if sec else "") or cfg["tgbot"].get("chat_id")
    # icone du sujet si elle est posee, sinon celle passee, sinon le logo
    t_icon = next((t.get("icon") for t in cfg["ntfy"].get("topics") or [] if t["topic"] == topic), "")
    icon = t_icon or icon or app_link(cfg, "/icon-192.png")
    kinds = _on(cfg)
    if not kinds:
        raise NotifyError("Aucun canal activé (ntfy, Telegram ou appli Android)")
    # ntfy et Telegram : seulement si l'administrateur a active ce type (un
    # envoi sans type, essai compris, part partout)
    if event in EVENTS and not global_on(cfg, event):
        kinds = [k for k in kinds if k == "app"]
    devs = [d for d in cfg.get("devices") or []
            if event not in EVENTS or app_wants(cfg, d.get("user"), event)] if "app" in kinds else []
    if event in EVENTS and not devs:
        kinds = [k for k in kinds if k != "app"]
    if not kinds:
        return
    errors = []
    if "ntfy" in kinds:
        try:
            await asyncio.to_thread(_post_ntfy, {**cfg["ntfy"], "topic": topic}, title, message, click, attach, tags,
                                    priority, actions, file, filename, icon)
        except NotifyError as e:
            errors.append(f"ntfy : {e}")
    if "telegram" in kinds:
        try:
            await asyncio.to_thread(_post_tgbot, {**cfg["tgbot"], "chat_id": chat}, title, message, click, attach,
                                    actions, file, filename)
        except NotifyError as e:
            errors.append(str(e))
    if "app" in kinds:
        if not devs:
            errors.append("Appli Android : aucun téléphone inscrit")
        else:
            errs = await asyncio.to_thread(_post_devices, cfg, devs, title, message, click, priority, sec, attach)
            await _save(cfg)                    # derniers succes / echecs par telephone
            if len(errs) == len(devs):
                errors.append("Appli Android : " + " · ".join(errs))
            else:
                for e in errs:
                    logger.warning(f"[NOTIF] appli : {e}")
    if errors and len(errors) == len(kinds):
        raise NotifyError(" · ".join(errors))
    for e in errors:
        logger.warning(f"[NOTIF] {e}")


async def _send_only(cfg, message: str, topic: str, chat: str) -> None:
    """Essai d'UNE destination, quel que soit le canal choisi."""
    import asyncio
    t_icon = next((t.get("icon") for t in cfg["ntfy"].get("topics") or [] if t["topic"] == topic), "")
    if topic:
        await asyncio.to_thread(_post_ntfy, {**cfg["ntfy"], "topic": topic}, "BambuNymous", message, app_link(cfg, "/"),
                                None, ["white_check_mark"], None, None, None, None,
                                t_icon or app_link(cfg, "/icon-192.png"))
    else:
        await asyncio.to_thread(_post_tgbot, {**cfg["tgbot"], "chat_id": chat}, "BambuNymous", message,
                                app_link(cfg, "/"))


async def notify(event: str, title: str, message: str = "", **kw) -> bool:
    """Envoie si ce type est active. Ne leve jamais (un echec se journalise)."""
    try:
        if not enabled_in(await _load(), event):
            return False
        await send(title, message, event=event, **kw)
        return True
    except Exception as e:
        logger.warning(f"[NOTIF] {event} : {e}")
        return False


async def test(event: str = "", topic: str = "", chat: str = "", device: str = "") -> dict:
    """« Envoyer test » : du canal (sans event) ou d'un type, meme desactive ;
    topic / chat : essai d'un sujet ntfy ou d'une discussion precis."""
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
                   priority=s.get("priority"), actions=actions, event=event)
    else:
        names = [_KIND_FR[k] for k in _on(cfg)]
        ch = (", ".join(names[:-1]) + " et " + names[-1]) if len(names) > 1 else (names[0] if names else "aucun canal")
        if device:
            return await test_device(device, "", True)
        if topic or chat:
            name = next((t.get("label") or t["topic"] for t in cfg["ntfy"].get("topics") or [] if t["topic"] == topic), "") \
                if topic else next((c.get("label") or c["chat_id"] for c in cfg["tgbot"].get("chats") or []
                                    if c["chat_id"] == chat), "")
            if not name:
                raise NotifyError("Sujet ou discussion inconnu : enregistre-le d'abord")
            await _send_only(cfg, f"Test de notification : « {name} » fonctionne.", topic, chat)
            return {"ok": True}
        await send("BambuNymous", f"Test de notification : {ch} fonctionne.", tags=["white_check_mark"],
                   click=app_link(cfg, "/"))
    return {"ok": True}
