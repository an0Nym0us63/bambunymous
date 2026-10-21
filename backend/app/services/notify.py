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
    ("objects", "📦 Objets et accessoires"),
    ("attention", "⚠️ Points d'attention"),
    ("achievements", "🏅 Succès"),
    ("system", "🖥️ BambuNymous"),
]
# Teinte de chaque section dans l'appli Android (grande icone, categorie) :
# envoyee avec chaque message, l'appli n'a rien en dur a republier.
SECTION_COLORS = {"attention": "#EAB308", "prints": "#3B82F6", "printer": "#EF4444", "dry": "#06B6D4", "spools": "#F59E0B",
                  "mw": "#22C55E", "friends": "#8B5CF6", "system": "#64748B",
                  "objects": "#14B8A6", "achievements": "#F59E0B"}


# Petite icone (barre d'etat) et teinte de la marque dans l'appli Android :
# une silhouette blanche servie par BambuNymous (chemin relatif, l'appli le
# complete avec sa propre adresse). Une section peut avoir la sienne ici
# (fichier dans frontend/public), sans nouvel APK.
NOTIF_ICON = "/notif-icon.png"
SECTION_ICONS: dict = {}
BRAND_COLOR = "#4F46E5"


def _section_parts(section: str):
    """« 🖨️ Impressions » -> ("🖨️", "Impressions")."""
    label = dict(SECTIONS).get(section or "", "")
    emo, _, name = label.partition(" ")
    return (emo, name) if name else ("", label)

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
EVENTS["friend_achievement"] = {
    "section": "friends", "label": "Un copain gagne un succès",
    "description": "Un palier ou un secret gagné par un copain, avec où tu en es (vérifié toutes les 15 min). Ses secrets que tu n'as pas restent secrets.",
    "options": [],
    "sample": {"title": "👥 Léo : Imprimeur 💎", "priority": 2, "link": "/stats?tab=achievements",
               "message": "💎 🖨️ Imprimeur · Diamant — toi : Platine"},
}
EVENTS["attention_new"] = {
    "section": "attention", "label": "Nouveaux points d'attention",
    "description": "Ce qui apparaît dans les points d'attention de l'accueil (bobine presque vide, impression sans 3MF…).",
    "options": [{"key": "when", "type": "select", "label": "Quand", "default": "daily",
                 "choices": [["daily", "un résumé par jour"], ["now", "dès qu'il y en a"]]},
                {"key": "hour", "type": "number", "label": "Résumé à", "unit": "h", "default": 9, "min": 0, "max": 23}],
    "sample": {"title": "⚠️ 3 nouveaux points d'attention", "priority": 2, "link": "/",
               "message": "📦 Filaments sans bobine\n   • Prune — PLA Matte\n🪫 Bobines presque vides\n   • Noir — PLA Basic (42 g)\n   • Blanc — PETG HF (18 g)"},
}
EVENTS["weekly_summary"] = {
    "section": "prints", "label": "Résumé de la semaine",
    "description": "Impressions réussies et ratées, heures, grammes, coût, points MakerWorld de la semaine.",
    "options": [{"key": "day", "type": "select", "label": "Le", "default": "6",
                 "choices": [["0", "lundi"], ["4", "vendredi"], ["5", "samedi"], ["6", "dimanche"]]},
                {"key": "hour", "type": "number", "label": "à", "unit": "h", "default": 19, "min": 0, "max": 23}],
    "sample": {"title": "📊 Ta semaine d'impression", "priority": 2, "link": "/stats",
               "message": "🖨️ 14 impressions (12 réussies, 2 ratées)\n⏱ 38 h · 🧵 1,24 kg · 💶 21,60 €\n🪙 +62,4 points MakerWorld\n🏆 La plus longue : Dragon articulé (9 h 12)"},
}
EVENTS["printer_idle"] = {
    "section": "printer", "label": "Imprimante au repos",
    "description": "Aucune impression depuis un moment (un rappel par période de repos).",
    "options": [{"key": "days", "type": "number", "label": "Après", "unit": "jours", "default": 7, "min": 1, "max": 60}],
    "sample": {"title": "💤 L'imprimante n'a pas servi depuis 7 jours", "priority": 2, "link": "/prints",
               "message": "Dernière impression : Toucan, le 13 oct.\n📋 4 modèles t'attendent dans « À faire »."},
}
EVENTS["mw_boost_token"] = {
    "section": "mw", "label": "Jeton boost obtenu",
    "description": "Un nouveau jeton pour booster des modèles sur MakerWorld (vérifié toutes les 3 h).",
    "options": [],
    "sample": {"title": "🚀 Nouveau jeton boost", "priority": 2, "link": "/prints?tab=makerworld",
               "message": "Obtenu avec ton abonnement · expire le 16 nov.\n🚀 7 jetons disponibles"},
}
EVENTS["mw_boost_expiring"] = {
    "section": "mw", "label": "Jeton boost bientôt expiré",
    "description": "Des jetons boost expirent bientôt : un rappel chaque jour (dès 9 h) tant qu'ils ne sont pas utilisés.",
    "options": [{"key": "days", "type": "number", "label": "Moins de", "unit": "jours", "default": 5, "min": 1, "max": 30}],
    "sample": {"title": "⏳ 1 jeton boost expire bientôt", "priority": 3, "link": "/prints?tab=makerworld",
               "message": "Expire le 2 nov. (dans 4 jours)\n🚀 7 jetons disponibles"},
}
EVENTS["mw_comment"] = {
    "section": "mw", "label": "Nouveau commentaire sur un de mes modèles",
    "description": "Quelqu'un a commenté un de tes modèles MakerWorld (relevé toutes les 30 min).",
    "options": [],
    "sample": {"title": "💬 Nouveau commentaire", "priority": 3, "attach": _SAMPLE_COVER,
               "message": "📄 Natrium — Casse-tête 6 pièces\n💬 61 commentaires au total"},
}
EVENTS["app_update"] = {
    "section": "system", "label": "Mise à jour de BambuNymous disponible",
    "description": "Une nouvelle version est publiée (vérifiée toutes les 6 h) : ce qui change.",
    "options": [],
    "sample": {"title": "🆕 BambuNymous : 3 nouveautés", "priority": 2, "link": "/settings",
               "message": "   • Journal des notifications : filtre des catégories\n   • Appli Android : installation directe\n   • Créateur : vignettes corrigées"},
}
EVENTS["app_started"] = {
    "section": "system", "label": "BambuNymous redémarré",
    "description": "L'appli vient de (re)démarrer : mise à jour, redémarrage du serveur…",
    "options": [],
    "sample": {"title": "🔄 BambuNymous a redémarré", "priority": 1, "link": "/",
               "message": "Tout est reparti."},
}

EVENTS["achievement_unlocked"] = {
    "section": "achievements", "label": "Succès débloqué",
    "description": "Une médaille gagnée : impressions, filaments, objets, MakerWorld, secrets… (vérifié toutes les 15 min).",
    "options": [],
    "sample": {"title": "🏅 Succès débloqué : Imprimeur 🥇", "priority": 3, "link": "/stats?tab=achievements",
               "message": "🥇 🖨️ Imprimeur · Or\n   1 000 impressions réussies — prochain palier : 2 500"},
}
EVENTS["keys_gained"] = {
    "section": "achievements", "label": "Clés gagnées",
    "description": "Chaque clé gagnée pour révéler les secrets : impressions réussies, paliers et secrets gagnés… et quelques surprises.",
    "options": [],
    "sample": {"title": "🎁 Bon début de mois : +2 clés !", "priority": 2, "link": "/stats?tab=achievements&cat=secret",
               "message": "🎁 +2 · Début du mois\nTu as maintenant 12 clés : de quoi révéler des secrets."},
}
EVENTS["wheel_spin"] = {
    "section": "achievements", "label": "Tour de roue gagné",
    "description": "Trois tours de roue offerts chaque lundi (et trois au départ), à jouer sur la page Succès.",
    "options": [],
    "sample": {"title": "🎰 3 tours de roue offerts !", "priority": 2, "link": "/stats?tab=achievements",
               "message": "Tu as 2 tours de roue : de quoi gagner des clés."},
}
EVENTS["accessory_low"] = {
    "section": "objects", "label": "Accessoire bientôt épuisé",
    "description": "Le stock d'un accessoire passe sous le seuil (une fois, jusqu'au réassort).",
    "options": [{"key": "threshold", "type": "number", "label": "Sous", "unit": "pièces", "default": 3, "min": 1, "max": 100}],
    "sample": {"title": "🔩 Plus que 2 : Aimants 6×2 mm", "priority": 2, "link": "/objects?tab=accessories",
               "message": "Utilisé sur 14 objets.\n💶 0,08 € pièce"},
}
EVENTS["accessory_out"] = {
    "section": "objects", "label": "Accessoire épuisé",
    "description": "Plus aucun en stock alors qu'il sert sur des objets.",
    "options": [],
    "sample": {"title": "🚫 Rupture : Anneaux porte-clés", "priority": 3, "link": "/objects?tab=accessories",
               "message": "Utilisé sur 31 objets : pense à en recommander."},
}
EVENTS["objects_unsold"] = {
    "section": "objects", "label": "Objets à vendre depuis longtemps",
    "description": "Des objets disponibles à la vente depuis plus de N jours (un rappel par objet).",
    "options": [{"key": "days", "type": "number", "label": "Après", "unit": "jours", "default": 90, "min": 7, "max": 730}],
    "sample": {"title": "🧸 3 objets en vente depuis plus de 90 jours", "priority": 1, "link": "/objects",
               "message": "   • Dragon articulé (124 j)\n   • Vase spirale (98 j)\n   • Porte-clés Toucan (91 j)"},
}
EVENTS["print_overdue"] = {
    "section": "prints", "label": "Impression en retard",
    "description": "L'impression prendra nettement plus longtemps que prévu par le tranchage (pauses, sous-extrusion…).",
    "options": [{"key": "pct", "type": "number", "label": "Au-delà de", "unit": "%", "default": 20, "min": 5, "max": 200}],
    "sample": {"title": "⏳ Impression en retard : Toucan", "priority": 3, "link": "/prints",
               "message": "Prévue : 3 h 10 · au rythme actuel : 4 h 05 (+29 %)\n⏱ encore 1 h 12"},
}
EVENTS["mw_auth_lost"] = {
    "section": "mw", "label": "Connexion MakerWorld perdue",
    "description": "Le jeton MakerWorld est refusé : points, collections et « À faire » ne se mettent plus à jour.",
    "options": [],
    "sample": {"title": "🔌 MakerWorld : reconnecte ton compte", "priority": 4, "link": "/settings?tab=links",
               "message": "Le jeton est refusé ou expiré. Tant qu'il n'est pas remplacé, plus de points, de collections ni de file « À faire »."},
}
EVENTS["login_new"] = {
    "section": "system", "label": "Connexion depuis un nouvel appareil",
    "description": "Un compte se connecte depuis un appareil ou un navigateur jamais vu pour lui.",
    "options": [],
    "sample": {"title": "🔐 Nouvelle connexion : ludo", "priority": 3, "link": "/settings?tab=accounts",
               "message": "📱 Android · Chrome\n🌍 adresse 81.250.12.34"},
}
EVENTS["login_failed"] = {
    "section": "system", "label": "Échecs de connexion répétés",
    "description": "Au moins 3 mots de passe ou codes faux en 15 minutes pour un même compte ou une même adresse.",
    "options": [],
    "sample": {"title": "🚨 4 échecs de connexion", "priority": 4, "link": "/settings?tab=accounts",
               "message": "Compte « admin » · adresse 185.220.101.4\nDernier essai à 03:12"},
}
EVENTS["friend_prints_mine"] = {
    "section": "friends", "label": "Un copain imprime un de mes modèles",
    "description": "Il lance l'impression d'un modèle que tu as publié sur MakerWorld.",
    "options": [],
    "sample": {"title": "🥰 Léo imprime ton modèle", "priority": 3, "link": "/",
               "message": "📄 Natrium — Casse-tête 6 pièces"},
}
EVENTS["mw_queue_ready"] = {
    "section": "mw", "label": "Modèle de « À faire » imprimable",
    "description": "Un modèle de ta file « À faire » a désormais tout son filament en stock (relevé toutes les heures).",
    "options": [],
    "sample": {"title": "✅ Prêt à imprimer : Lampe lune", "priority": 2, "attach": _SAMPLE_COVER, "link": "/prints?tab=queue",
               "message": "🧵 Tout le filament est en stock (2 couleurs, 184 g).\n✨ Déjà dans l'AMS."},
}
EVENTS["dry_needed_loaded"] = {
    "section": "dry", "label": "Bobine à sécher dans l'AMS",
    "description": "Une bobine chargée dans l'AMS n'a jamais été séchée, ou plus depuis son délai (une fois par bobine, jusqu'à son séchage).",
    "options": [],
    "sample": {"title": "💧 À sécher avant d'imprimer · AMS-A", "priority": 2, "link": "/",
               "message": "🧵 Blanc — PETG HF · Bambu Lab\n   séchée il y a 7 mois (délai : 2 mois)"},
}
EVENTS["dry_forgotten"] = {
    "section": "dry", "label": "Bobine oubliée après le séchage",
    "description": "Le séchage est fini mais une bobine posée pour sécher est toujours dans l'AMS.",
    "options": [{"key": "hours", "type": "number", "label": "Après", "unit": "h", "default": 6, "min": 1, "max": 48}],
    "sample": {"title": "🧺 Bobine toujours dans l'AMS-A", "priority": 2, "link": "/",
               "message": "Séchage fini depuis 6 h : range-la au sec (sac étanche, boîte) pour garder le bénéfice du séchage.\n🧵 Prune — PLA Matte · Bambu Lab"},
}

# Ordre d'affichage dans chaque section
_ORDER = ["print_started", "print_first_layer", "print_progress", "print_near_end", "print_overdue", "print_done", "print_failed",
          "print_paused", "print_resumed", "print_speed",
          "printer_hms", "printer_offline", "bed_cooled", "printer_firmware",
          "dry_started", "dry_done", "dry_needed_loaded", "dry_forgotten",
          "spool_loaded", "spool_removed", "ams_humidity", "spool_low", "spool_short", "stock_low", "fil_to_order",
          "printer_idle", "weekly_summary", "mw_queue_ready", "app_update", "app_started"]
EVENTS = {**{k: EVENTS[k] for k in _ORDER if k in EVENTS}, **{k: v for k, v in EVENTS.items() if k not in _ORDER}}


class NotifyError(Exception):
    pass


# Canal des notifications : ntfy, un bot Telegram (pour qui n'a pas ntfy), ou les deux.
# Canaux, chacun active ou non (20/10/2026) : ntfy, bot Telegram, appli Android.
# Remplace l'ancien choix exclusif « channel » (ntfy | telegram | both | app).
KINDS = ("ntfy", "telegram", "app", "journal")
PUSH_KINDS = ("ntfy", "telegram", "app")          # ceux qui envoient vraiment quelque chose
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
    cfg["channels"].setdefault("journal", True)       # le journal existait avant d'etre un canal
    cfg.setdefault("journal", {})
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
    """Ce que le proprietaire d'un telephone veut y recevoir. Sans choix de sa
    part : comme l'administrateur."""
    prefs = (cfg.get("app_prefs") or {}).get(user or "") if user else None
    v = prefs.get(event) if isinstance(prefs, dict) else None
    if isinstance(v, dict):
        return bool(v.get("app"))
    if v is not None:                       # anciens choix : vrai / faux, "off" / "journal" / "app"
        return v in (True, "app")
    return global_on(cfg, event)


def journal_on(cfg, event: str) -> bool:
    """Le type va-t-il au journal ? Canal commun regle par l'administrateur :
    « tout », ou type par type (sans choix : comme ntfy / Telegram)."""
    if not cfg or not (cfg.get("channels") or {}).get("journal"):
        return False
    j = cfg.get("journal") or {}
    if j.get("all"):
        return True
    v = (j.get("events") or {}).get(event)
    return global_on(cfg, event) if v is None else bool(v)


def enabled_in(cfg, event: str) -> bool:
    """L'evenement merite-t-il d'etre calcule ? Oui si l'administrateur l'a
    active, ou si un compte l'a choisi (son historique, sa cloche, et ses
    telephones si l'appli est activee)."""
    if global_on(cfg, event) or journal_on(cfg, event):
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
        # Journal : canal commun, visible des administrateurs (et de chacun pour
        # ce qui arrive sur son telephone)
        "journal": {"all": bool((cfg.get("journal") or {}).get("all")),
                    "events": {k: journal_on({**cfg, "channels": {**cfg["channels"], "journal": True}}, k) for k in EVENTS}},
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
                    "app": app_wants(cfg, user, k), "mine": app_wants(cfg, user, k)} for k, v in EVENTS.items()],
        "devices": [{k: d.get(k) for k in ("id", "name", "added", "last_ok", "last_err")}
                    for d in cfg.get("devices") or [] if (d.get("user") or "") == user],
    }


async def me_config(user: str) -> dict:
    return me_view(await _load(), user)


async def set_my_events(user: str, patch: dict) -> dict:
    """Mon telephone, type par type : {type: bool} ou {type: {"app": bool}} ;
    une section entiere : {"section:prints": ...}."""
    cfg = await _load()
    prefs = cfg["app_prefs"].setdefault(user, {})
    # premiere fois / anciens choix : on fige le point de depart
    for k in EVENTS:
        prefs[k] = {"app": app_wants(cfg, user, k)}

    def merge(e, v):
        if isinstance(v, dict):
            v = v.get("app")
        if isinstance(v, bool):
            prefs[e] = {"app": v}
    for k, v in (patch or {}).items():
        if k.startswith("section:"):
            for e, ev in EVENTS.items():
                if ev["section"] == k[8:]:
                    merge(e, v)
        elif k in EVENTS:
            merge(k, v)
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




def _up_payload(title, message, click, priority, section, attach, nid=None, icon=None) -> bytes:
    """JSON compact : t titre, m texte, u lien, p priorite, s section, i image ;
    et l'habillage de la section (sl nom, e emoji, c teinte) pour que l'appli
    cree sa categorie et sa grande icone sans liste en dur."""
    emo, name = _section_parts(section)
    d = {"t": (title or "")[:200], "m": message or "", "u": click or "", "p": int(priority or 3), "s": section or ""}
    if section:
        d.update(sl=name, e=emo, c=SECTION_COLORS.get(section, ""))
    d.update(si=SECTION_ICONS.get(section or "", NOTIF_ICON), ac=BRAND_COLOR)
    if icon and str(icon).startswith("https://"):
        d["li"] = icon           # vignette (grande icone a droite)
    if nid:
        d["n"] = int(nid)        # touchee ou balayee sur le telephone : lue dans le journal
    if attach and str(attach).startswith("https://"):
        d["i"] = attach
    raw = json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    while len(raw) > UP_MAX and d["m"]:
        d["m"] = d["m"][: max(0, len(d["m"]) - (len(raw) - UP_MAX) - 4)] + "…"
        raw = json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return raw


def _post_devices(cfg, devices, title, message, click, priority, section, attach, nid=None, icon=None) -> list:
    """Envoie a chaque telephone ; rend les erreurs (une par telephone en echec)."""
    from urllib.parse import urlparse
    from .makerworld import session
    from datetime import datetime, timezone
    body = _up_payload(title, message, click, priority, section, attach, nid, icon)
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


async def set_journal(all_=None, events=None) -> dict:
    """Ce qui va au journal : « tout » ({all}), ou type par type ({events:
    {type: bool}}, une section par "section:prints")."""
    cfg = await _load()
    j = cfg.setdefault("journal", {})
    if all_ is not None:
        j["all"] = bool(all_)
    if isinstance(events, dict):
        ev = j.setdefault("events", {})
        for k, v in events.items():
            if k.startswith("section:"):
                for e, d in EVENTS.items():
                    if d["section"] == k[8:]:
                        ev[e] = bool(v)
            elif k in EVENTS:
                ev[k] = bool(v)
    await _save(cfg)
    return _public(cfg)


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


_KIND_FR = {"ntfy": "ntfy", "telegram": "Telegram", "app": "l'appli Android", "journal": "le journal"}


async def send(title: str, message: str = "", click=None, attach=None, tags=None, priority=None,
               actions=None, file=None, filename=None, icon=None, event=None, topic=None, chat=None,
               _log: bool = True) -> None:
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
    icon = icon or t_icon or app_link(cfg, "/icon-192.png")
    log_id = None
    if _log and event in EVENTS:
        try:
            log_id = await _log_sent(cfg, event, title, message, click, attach)
        except Exception as e:
            logger.warning(f"[NOTIF] historique : {e}")
    kinds = [k for k in _on(cfg) if k in PUSH_KINDS]
    if not kinds:
        if (cfg.get("channels") or {}).get("journal") and event in EVENTS:
            return                          # le journal seul : c'est fait
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
            errs = await asyncio.to_thread(_post_devices, cfg, devs, title, message, click, priority, sec, attach, log_id,
                                           icon if icon != app_link(cfg, "/icon-192.png") else None)
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


# ── Historique (15 jours), une liste par compte ───────────────────────────
HISTORY_DAYS = 15
K_SEEN = "NOTIF_SEEN"          # {compte: id de la derniere notification vue}


async def _recipients(cfg, event: str) -> list:
    """Les comptes qui voient ce type dans leur journal : (compte, deja_lue).
    Les administrateurs si le type va au journal ; chacun pour ce qui arrive
    sur son telephone (sa lecture y remonte). Deja lue pour qui l'a eue sur
    ntfy / Telegram sans son telephone ; sinon non lue : on la lit en ouvrant
    le journal, ou en la touchant sur le telephone."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.user import User
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(User.username, User.role).where(User.active.is_(True)))).all()
    if not rows:
        return [("*", False)]
    app_on = bool((cfg.get("channels") or {}).get("app"))
    pushed = bool(set(_on(cfg)) & {"ntfy", "telegram"}) and global_on(cfg, event)
    owners = {d.get("user") for d in cfg.get("devices") or []}
    to_journal = journal_on(cfg, event)
    out = []
    for u, role in rows:
        on_phone = app_on and u in owners and app_wants(cfg, u, event)
        admin = role == "admin"
        if not ((admin and to_journal) or on_phone):
            continue
        out.append((u, admin and pushed and not on_phone))
    return out


async def _log_sent(cfg, event, title, message, click, attach):
    """Ecrit la notification dans le journal ; rend son id (ou None)."""
    from datetime import datetime, timedelta
    from sqlalchemy import delete
    from ..db.session import AsyncSessionLocal
    from ..models.notif_log import NotifLog
    rec = await _recipients(cfg, event)
    if not rec:
        return None
    users = [u for u, _ in rec]
    base = ((cfg.get("ntfy") or {}).get("app_url") or "").rstrip("/")
    link = click or ""
    if base and link.startswith(base):
        link = link[len(base):] or "/"
    async with AsyncSessionLocal() as db:
        row = NotifLog(event=event, section=EVENTS[event]["section"], title=(title or "")[:250],
                       message=message or "", link=link[:500] or None,
                       image=attach if attach and str(attach).startswith("https://") else None,
                       users="," + ",".join(users) + ",")
        db.add(row)
        await db.execute(delete(NotifLog).where(NotifLog.created_at < datetime.utcnow() - timedelta(days=HISTORY_DAYS)))
        await db.commit()
        rid = row.id
    # deja lue pour qui l'a recue ailleurs (ntfy / Telegram)
    done = [u for u, read in rec if read]
    if done:
        d = await _read_get()
        for u in done:
            d[u] = (list(d.get(u) or []) + [rid])[-2000:]
        await _read_put(d)
    return rid


def _mine(user: str):
    from sqlalchemy import or_
    from ..models.notif_log import NotifLog
    return or_(NotifLog.users.like(f"%,{user},%"), NotifLog.users == ",*,")


async def _seen_get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, K_SEEN, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


K_READ = "NOTIF_READ"          # {compte: [ids lues une par une, au-dela du « tout vu »]}


async def _read_get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, K_READ, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def _read_put(d: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_READ, json.dumps(d, separators=(",", ":")))


async def mark_read(user: str, ids) -> dict:
    """Notifications lues sur le telephone (touchees ou balayees)."""
    seen = int((await _seen_get()).get(user) or 0)
    d = await _read_get()
    mine = {int(x) for x in d.get(user) or [] if int(x) > seen}
    mine |= {int(x) for x in ids or [] if str(x).isdigit() and int(x) > seen}
    d[user] = sorted(mine)[-2000:]
    await _read_put(d)
    return {"unseen": await unseen_count(user)}


async def device_read(endpoint: str, ids) -> dict:
    """Lues sur un telephone (balayees, touchees), annoncees par l'appli elle-
    meme sans passer par la page : elle se designe par son adresse d'envoi
    UnifiedPush, un secret partage par le telephone et ce serveur seuls."""
    cfg = await _load()
    d = next((x for x in cfg.get("devices") or [] if endpoint and x.get("endpoint") == endpoint), None)
    if not d or not d.get("user"):
        raise NotifyError("Téléphone inconnu")
    return await mark_read(d["user"], [i for i in (ids or [])][:200])


async def _read_of(user: str) -> set:
    return {int(x) for x in (await _read_get()).get(user) or []}


async def history(user: str, before: int = 0, limit: int = 40, sections=None, events=None) -> dict:
    """sections / events : ne garder que ces categories / ces types (None :
    tous). Rend aussi, pour les onglets du journal, le nombre de notifications
    (et de non lues) par categorie et par type."""
    from sqlalchemy import select, func
    from ..db.session import AsyncSessionLocal
    from ..models.notif_log import NotifLog
    labels = dict(SECTIONS)
    seen = int((await _seen_get()).get(user) or 0)
    read = await _read_of(user)
    q = select(NotifLog).where(_mine(user))
    if sections is not None:
        q = q.where(NotifLog.section.in_(list(sections) or [""]))
    if events is not None:
        q = q.where(NotifLog.event.in_(list(events) or [""]))
    if before:
        q = q.where(NotifLog.id < int(before))
    unseen_q = NotifLog.id > seen
    if read:
        unseen_q = unseen_q & NotifLog.id.notin_(read)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(q.order_by(NotifLog.id.desc()).limit(max(1, min(int(limit), 100))))).scalars().all()
        tot = (await db.execute(select(NotifLog.section, NotifLog.event, func.count())
                                .where(_mine(user)).group_by(NotifLog.section, NotifLog.event))).all()
        new = (await db.execute(select(NotifLog.section, NotifLog.event, func.count())
                                .where(_mine(user), unseen_q).group_by(NotifLog.section, NotifLog.event))).all()
    unseen = await unseen_count(user)
    nnew = {(s_, e): n for s_, e, n in new}
    counts = {}
    for s_, e, n in tot:
        c = counts.setdefault(s_ or "", {"total": 0, "unseen": 0, "events": {}})
        c["total"] += n
        c["unseen"] += nnew.get((s_, e), 0)
        c["events"][e] = {"total": n, "unseen": nnew.get((s_, e), 0),
                          "label": (EVENTS.get(e) or {}).get("label", e)}
    return {"items": [{"id": r.id, "time": r.created_at.isoformat() + "Z", "event": r.event, "section": r.section,
                       "section_label": labels.get(r.section, ""),
                       # meme habillage que la notification de l'appli Android
                       "section_emoji": _section_parts(r.section)[0], "section_name": _section_parts(r.section)[1],
                       "section_color": SECTION_COLORS.get(r.section or "", BRAND_COLOR),
                       "title": r.title, "message": r.message,
                       "link": r.link, "image": r.image, "seen": r.id <= seen or r.id in read} for r in rows],
            "unseen": unseen, "more": len(rows) >= limit, "days": HISTORY_DAYS, "counts": counts,
            # les categories, pour le filtre du journal
            "sections": [{"id": k, "emoji": _section_parts(k)[0], "name": _section_parts(k)[1],
                          "color": SECTION_COLORS.get(k, BRAND_COLOR)} for k, _ in SECTIONS]}


async def unseen_count(user: str) -> int:
    from sqlalchemy import select, func
    from ..db.session import AsyncSessionLocal
    from ..models.notif_log import NotifLog
    seen = int((await _seen_get()).get(user) or 0)
    read = await _read_of(user)
    q = select(func.count()).select_from(NotifLog).where(_mine(user), NotifLog.id > seen)
    if read:
        q = q.where(NotifLog.id.notin_(read))
    async with AsyncSessionLocal() as db:
        return (await db.execute(q)).scalar_one()


async def mark_seen(user: str) -> dict:
    """Tout est vu jusqu'a la plus recente."""
    from sqlalchemy import select, func
    from ..db.session import AsyncSessionLocal
    from ..models.notif_log import NotifLog
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        top = (await db.execute(select(func.max(NotifLog.id)))).scalar_one() or 0
    d = await _seen_get()
    d[user] = int(top)
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_SEEN, json.dumps(d))
    return {"unseen": 0}


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
                   priority=s.get("priority"), actions=actions, event=event, _log=False)
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
