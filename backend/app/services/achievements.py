"""
Succes (20/10/2026) : des paliers atteints sur l'historique, chacun avec sa
medaille (bronze, argent, or, platine, diamant), ou une medaille unique pour
les succes d'un seul palier (souvent secrets).

Chaque succes calcule une serie de (date, valeur) qui ne fait que monter
(cumul ou meilleur score) : un palier est atteint a la premiere date ou la
valeur le passe. Les succes tires de l'historique (impressions, bobines,
objets) ont donc leur VRAIE date, meme au premier calcul. Ceux qui ne se
lisent qu'au present (MakerWorld, stock, copains) prennent la date du jour ou
on les constate.

Reglage ACHIEVEMENTS : {"unlocked": {id: {palier: iso}}, "best": {id: valeur}}.
Le premier calcul enregistre tout sans rien notifier ; ensuite, chaque cran
nouveau part en notification (achievement_unlocked).
"""
from __future__ import annotations

import json
import logging
import os
import re
from types import SimpleNamespace
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

KEY = "ACHIEVEMENTS"

TIERS = [
    {"id": "bronze", "label": "Bronze", "emoji": "🥉", "color": "#CD7F32", "score": 1},
    {"id": "silver", "label": "Argent", "emoji": "🥈", "color": "#B8C2CC", "score": 2},
    {"id": "gold", "label": "Or", "emoji": "🥇", "color": "#F5B700", "score": 3},
    {"id": "platinum", "label": "Platine", "emoji": "💠", "color": "#6EC6D9", "score": 5},
    {"id": "diamond", "label": "Diamant", "emoji": "💎", "color": "#8B5CF6", "score": 8},
    {"id": "legend", "label": "Légende", "emoji": "👑", "color": "#E11D48", "score": 13},
    {"id": "mythic", "label": "Mythique", "emoji": "🔱", "color": "#0D9488", "score": 21},
    {"id": "cosmic", "label": "Cosmique", "emoji": "🌌", "color": "#4338CA", "score": 34},
    {"id": "eternal", "label": "Éternel", "emoji": "✨", "color": "#111827", "score": 55},
]
# (Version du catalogue : remplacee par son empreinte, CATALOG_SIG, plus bas.)
UNIQUE = {"id": "unique", "label": "Unique", "emoji": "🏵️", "color": "#EC4899", "score": 3}

CATEGORIES = [
    ("prints", "🖨️", "Impressions"),
    ("filaments", "🧵", "Filaments"),
    ("objects", "🧸", "Objets et ventes"),
    ("mw", "🌐", "MakerWorld"),
    ("photos", "📸", "Photos"),
    ("app", "📱", "Dans l'appli"),
    ("social", "🤝", "Copains"),
    ("game", "🎲", "Clés et roue"),
    ("secret", "🔮", "Secrets"),
]

MATERIALS = ["PLA", "PETG", "TPU", "ABS", "ASA", "PA", "PC"]


_TZ: dict = {}


def _tz():
    name = os.getenv("TZ") or "Europe/Paris"
    z = _TZ.get(name)
    if z is None:
        try:
            from zoneinfo import ZoneInfo
            z = ZoneInfo(name)
        except Exception:
            z = timezone.utc
        _TZ[name] = z
    return z


def _local(dt: datetime) -> datetime:
    """Heure locale d'une date stockee en UTC (sans fuseau)."""
    return dt.replace(tzinfo=timezone.utc).astimezone(_tz())


# ── Catalogue ────────────────────────────────────────────────────────────────
# id, categorie, emoji, nom, description ({n} : le seuil), crans, unite,
# source (print | spool | filament | object | live), options.
def _a(id, cat, emoji, name, desc, tiers, **kw):
    return {"id": id, "cat": cat, "emoji": emoji, "name": name, "desc": desc, "tiers": tiers, **kw}


CATALOG = [
    # Impressions
    _a("first_print", "prints", "🐣", "Premier pas", "Ta première impression réussie", [1],
       lore="Tout a commencé là : une buse chaude, un plateau propre, et ta toute première impression réussie."),
    _a("prints_ok", "prints", "🖨️", "Imprimeur", "{n} impressions réussies", [10, 100, 500, 1000, 2500]),
    _a("print_hours", "prints", "⏱️", "Heures de vol", "{n} h d'impression", [100, 500, 1000, 2500, 5000], unit="h"),
    _a("print_kg", "prints", "🧵", "Dévoreur de filament", "{n} kg de filament imprimé", [1, 10, 50, 100, 250], unit="kg"),
    _a("longest", "prints", "🏃", "Marathonien", "Une impression réussie de {n} h", [6, 12, 24, 48, 72], unit="h"),
    _a("heaviest", "prints", "🏋️", "Poids lourd", "Une impression réussie de {n} g", [250, 500, 1000, 2000, 3000], unit="g"),
    _a("heavy_group", "prints", "🏗️", "Gros chantier", "Un groupe d'impressions réussies de {n} g", [1], unit="g"),
    _a("streak", "prints", "📅", "Assidu", "{n} jours d'affilée avec une impression", [3, 7, 14, 30, 60], unit="j"),
    _a("busy_day", "prints", "⚡", "Journée chargée", "{n} impressions lancées le même jour", [3, 5, 8, 12, 20]),
    _a("success_run", "prints", "✅", "Sans faute", "{n} impressions réussies d'affilée", [10, 25, 50, 100, 200]),
    _a("night", "prints", "🦉", "Oiseau de nuit", "{n} impressions lancées entre minuit et 5 h", [5, 25, 100, 250, 500]),
    _a("early", "prints", "🐓", "Lève-tôt", "{n} impressions lancées entre 5 h et 7 h", [5, 25, 100, 250, 500]),
    _a("weekend", "prints", "🛋️", "Week-end studieux", "{n} impressions lancées le week-end", [10, 50, 200, 500, 1000]),
    _a("models", "prints", "🗂️", "Explorateur", "{n} modèles différents imprimés", [25, 100, 250, 500, 1000]),
    _a("repeat", "prints", "🔁", "Production en série", "Le même modèle imprimé {n} fois", [5, 10, 25, 50, 100]),
    _a("multicolor", "prints", "🌈", "Arc-en-ciel", "{n} impressions de 4 couleurs ou plus", [1, 10, 50, 100, 250]),
    _a("colors_max", "prints", "🎨", "Peintre", "{n} couleurs dans une même impression", [2, 4, 8, 12, 16]),
    _a("failures", "prints", "💥", "Ça arrive aux meilleurs", "{n} impressions ratées ou annulées", [1, 10, 25, 50, 100]),
    _a("veteran", "prints", "🎖️", "Vétéran", "{n} jours depuis ta première impression", [30, 180, 365, 730, 1095], unit="j"),
    _a("month_record", "prints", "🗓️", "Mois record", "{n} impressions en un même mois", [20, 40, 60, 100, 150]),
    _a("weeks", "prints", "📆", "Régulier", "{n} semaines d'affilée avec une impression", [4, 8, 16, 26, 52], unit="sem."),
    _a("pieces", "prints", "🧩", "Fournée", "{n} pièces imprimées", [100, 500, 1000, 5000, 10000]),
    _a("mw_made", "prints", "🌐", "Fidèle à MakerWorld", "{n} impressions réussies de modèles MakerWorld", [10, 50, 200, 500, 1000]),
    _a("spent", "prints", "💸", "Investisseur", "{n} € de filament et d'électricité imprimés", [50, 250, 1000, 2500, 5000],
       unit="€", money=True),
    # Filaments
    _a("palette", "filaments", "🎨", "Palette", "{n} filaments différents utilisés", [10, 25, 50, 100, 200]),
    _a("materials", "filaments", "🧪", "Alchimiste", "{n} matières différentes imprimées", [2, 3, 5, 7, 10]),
    *[_a(f"mat_{m.lower()}", "filaments", "🏅", f"Maître du {m}", f"{{n}} kg de {m} imprimés", [1, 5, 10, 25, 50],
         unit="kg", only_started=True) for m in MATERIALS],
    _a("spools_done", "filaments", "🫙", "Jusqu'au bout", "{n} bobines terminées", [1, 10, 50, 100, 250]),
    _a("stock", "filaments", "📦", "Réserve", "{n} bobines en stock en même temps", [10, 25, 50, 100, 200]),
    _a("dried", "filaments", "💧", "Au sec", "{n} séchages lancés dans l'AMS", [1, 10, 25, 50, 100]),
    _a("swatches", "filaments", "🏷️", "Nuancier", "{n} échantillons de couleur", [5, 25, 50, 100, 200]),
    _a("brands", "filaments", "🏭", "Touche-à-tout", "{n} marques de filament", [2, 3, 5, 8, 12]),
    _a("stock_kg", "filaments", "⚖️", "Grenier", "{n} kg de filament en stock", [5, 10, 25, 50, 100], unit="kg"),
    _a("stock_colors", "filaments", "🌈", "Nuancier vivant", "{n} teintes différentes en stock", [5, 8, 10, 12, 15]),
    _a("rfid", "filaments", "📡", "Pucé", "{n} bobines à puce RFID en stock", [5, 25, 50, 100, 200]),
    _a("labels", "filaments", "🏷️", "Étiqueteur", "{n} étiquettes de filament imprimées", [5, 25, 50, 100, 200]),
    _a("multicolor_fils", "filaments", "🎨", "Bigarré", "{n} filaments multicolores", [1, 3, 5, 10, 20]),
    # Objets et ventes
    _a("objects", "objects", "🧸", "Fabricant", "{n} objets créés", [10, 50, 200, 500, 1000]),
    _a("sold", "objects", "💶", "Commerçant", "{n} objets vendus", [1, 10, 50, 100, 500]),
    _a("revenue", "objects", "💰", "Chiffre d'affaires", "{n} € de ventes", [50, 250, 1000, 5000, 10000], unit="€", money=True),
    _a("gifted", "objects", "🎁", "Généreux", "{n} objets offerts", [1, 5, 20, 50, 100]),
    _a("personal", "objects", "🏠", "Fait maison", "{n} objets gardés pour toi", [5, 25, 50, 100, 250]),
    _a("accessories", "objects", "🔩", "Bricoleur", "{n} accessoires posés sur des objets", [10, 50, 200, 500, 1000]),
    _a("groups", "objects", "🗃️", "Assortiments", "{n} lots d'objets", [1, 5, 10, 25, 50]),
    _a("margin", "objects", "📈", "Bénéfices", "{n} € de marge sur les ventes", [10, 100, 500, 1000, 5000], unit="€", money=True),
    # MakerWorld (lu au present sur le profil)
    _a("mw_designs", "mw", "📐", "Créateur", "{n} modèles publiés sur MakerWorld", [1, 5, 10, 25, 50]),
    _a("mw_downloads", "mw", "⬇️", "Téléchargé", "{n} téléchargements de tes modèles", [100, 1000, 5000, 10000, 50000]),
    _a("mw_prints", "mw", "🖨️", "Imprimé ailleurs", "{n} impressions de tes modèles", [100, 1000, 5000, 10000, 50000]),
    _a("mw_boosts", "mw", "🚀", "Boosté", "{n} boosts reçus", [10, 50, 200, 500, 1000]),
    _a("mw_fans", "mw", "👥", "Influenceur", "{n} abonnés", [10, 100, 500, 1000, 5000]),
    _a("mw_likes", "mw", "❤️", "Apprécié", "{n} « j'aime » sur tes modèles", [100, 500, 2000, 5000, 10000]),
    _a("mw_level", "mw", "⭐", "Niveau", "Niveau {n} sur MakerWorld", [5, 10, 20, 30, 40]),
    _a("mw_collections", "mw", "📚", "Collectionné", "Tes modèles ajoutés {n} fois à des collections", [1, 5, 10, 25, 50]),
    _a("mw_my_collections", "mw", "🗂️", "Curateur", "{n} collections MakerWorld à toi", [1]),
    _a("mw_follows", "mw", "👀", "Curieux", "Tu suis {n} créateurs", [5, 25, 50, 100, 250]),
    # Copains
    _a("friends", "social", "🤝", "Bande de copains", "{n} copains reliés", [1, 3, 5, 10, 20]),
    # Photos
    _a("photos_manual", "photos", "📸", "Photographe", "{n} photos ajoutées à tes impressions", [1]),
    _a("photo_prints", "photos", "🖼️", "Album", "{n} impressions avec au moins une photo", [1]),
    _a("photos_camera", "photos", "📹", "Œil de la caméra", "{n} photos prises par la caméra de l'imprimante", [1]),
    _a("photos_max", "photos", "🎞️", "Séance photo", "{n} photos sur une même impression", [1]),
    _a("covers", "photos", "🌟", "Galeriste", "{n} photos choisies comme vignette", [1]),
    _a("videos", "photos", "🎬", "Vidéaste", "{n} vidéos ajoutées", [1]),
    # Cles et roue (21/10/2026)
    _a("wheel_played", "game", "🎰", "Joueur", "{n} tours de roue joués", [1]),
    _a("wheel_keys", "game", "🍀", "Veinard", "{n} clés gagnées à la roue", [1]),
    _a("keys_earned", "game", "🔑", "Trousseau", "{n} clés gagnées en tout", [1]),
    _a("keys_spent", "game", "🗝️", "Serrurier", "{n} clés dépensées", [1]),
    _a("keys_max", "game", "💼", "Coffre-fort", "{n} clés détenues en même temps", [1]),
    _a("reveals", "game", "🔓", "Révélateur", "{n} étapes de secret révélées", [1]),
    _a("tickets_won", "game", "🎟️", "Chasseur de tickets", "{n} tickets de palier gagnés", [1]),
    _a("tickets_used", "game", "🪜", "Raccourci", "{n} tickets de palier utilisés", [1]),
    _a("video_prints", "photos", "🎞️", "Court-métrage", "{n} impressions avec au moins une vidéo", [1]),
    # Dans l'appli
    _a("visits", "app", "🚪", "Habitué", "{n} visites de pages", [1]),
    _a("visit_days", "app", "📅", "Fidèle au poste", "{n} jours où l'appli a été ouverte", [1]),
    _a("details", "app", "🔎", "Fouineur", "{n} fiches et onglets consultés", [1]),
    _a("actions", "app", "⚙️", "Hyperactif", "{n} actions dans l'appli (ajouts, modifications…)", [1]),
    _a("updates", "app", "🆙", "Toujours à jour", "{n} mises à jour de BambuNymous installées", [1]),
    _a("notifs", "app", "🔔", "Bien informé", "{n} notifications reçues", [1]),
    _a("dismissals", "app", "🧘", "Zen", "{n} points d'attention mis en sourdine", [1]),
    _a("shares", "social", "📣", "Partageur", "{n} partages sur Telegram", [1]),
    _a("mw_rates", "mw", "✍️", "Critique", "{n} évaluations publiées sur MakerWorld", [1]),
    _a("mw_boosts_given", "mw", "🎁", "Généreux en boosts", "{n} boosts donnés depuis l'appli", [1]),
    _a("mw_likes_given", "mw", "👍", "Cœur sur la main", "{n} « j'aime » donnés depuis l'appli", [1]),
    _a("mw_collected", "mw", "📌", "Épingleur", "{n} modèles rangés dans tes collections depuis l'appli", [1]),
    _a("rfid_scans", "filaments", "📲", "Scanner", "{n} scans de bobines RFID", [1]),
    _a("colors_printed", "filaments", "🦎", "Caméléon", "{n} couleurs différentes imprimées", [1]),
    _a("print_days", "prints", "🗓️", "Jours d'impression", "{n} jours différents avec une impression", [1]),
    _a("print_groups", "prints", "🗂️", "Rangé", "{n} groupes d'impressions", [1]),
    # Changements de filament (AMS)
    _a("fil_changes", "filaments", "🔄", "Valse des bobines", "{n} bobines posées dans l'AMS", [1]),
    _a("fil_changes_day", "filaments", "🤹", "Jongleur", "{n} bobines posées dans l'AMS le même jour", [1]),
    _a("fil_changes_week", "filaments", "🌪️", "Semaine agitée", "{n} bobines posées dans l'AMS en 7 jours", [1]),
    _a("open_spools", "filaments", "🍰", "Tout entamé", "{n} bobines entamées en même temps", [1]),
    _a("bicolor", "prints", "🎭", "Bicolore", "{n} impressions de 2 couleurs ou plus", [1]),
    _a("reliable", "prints", "🎯", "Fiable", "{n} impressions finies à 5 % près de l'estimation", [1]),
    _a("faster", "prints", "💨", "Plus vite que prévu", "{n} impressions réussies finies avant l'estimation", [1]),
    _a("morning", "prints", "🌅", "Matinée productive", "{n} impressions lancées entre 7 h et midi", [1]),
    _a("lunch", "prints", "🥪", "Pause déjeuner", "{n} impressions lancées entre midi et 14 h", [1]),
    _a("evening", "prints", "🌆", "Soirée atelier", "{n} impressions lancées entre 18 h et 22 h", [1]),
    _a("overnight", "prints", "🛌", "Nuit complète", "{n} impressions qui tournent de 23 h à 6 h", [1]),
    _a("cancelled", "prints", "✋", "Changement d'avis", "{n} impressions arrêtées dans les 15 minutes", [1]),
    _a("records", "prints", "📏", "Recordman", "{n} fois que tu as battu ton record de durée", [1]),
    _a("clean_weeks", "prints", "🛡️", "Semaines sans accroc", "{n} semaines d'impression sans aucun échec", [1], unit="sem."),
    _a("months_active", "prints", "🗓️", "Assidu au mois", "{n} mois différents avec une impression", [1]),
    _a("weekends_active", "prints", "🔧", "Bricoleur du dimanche", "{n} week-ends avec une impression", [1]),
    _a("kg_month", "prints", "🍔", "Mois gourmand", "{n} kg imprimés en un même mois", [1], unit='kg'),
    _a("kg_day", "prints", "🥩", "Journée gourmande", "{n} kg imprimés le même jour", [1], unit='kg'),
    _a("engineering", "filaments", "🛠️", "Ingénieur", "{n} kg de matières techniques (ABS, ASA, PA, PC, chargées)", [1], unit='kg'),
    _a("mw_designs_printed", "mw", "🧭", "Explorateur MakerWorld", "{n} modèles MakerWorld différents imprimés", [1]),
    _a("creators", "mw", "🎨", "Fan de créateurs", "{n} créateurs différents imprimés", [1]),
    _a("mw_categories", "mw", "🗃️", "Curieux de tout", "{n} catégories MakerWorld imprimées", [1]),
    _a("trending", "mw", "🔥", "Dans la tendance", "{n} modèles imprimés par plus de 10 000 personnes", [1]),
    _a("gems", "mw", "💎", "Dénicheur", "{n} modèles imprimés par moins de 50 personnes", [1]),
    _a("mw_points_bal", "mw", "🪙", "Tirelire", "{n} points MakerWorld en caisse", [1]),
    _a("profile_downloads", "mw", "📥", "Profils prisés", "{n} téléchargements de tes profils d'impression", [1]),
    _a("queue_size", "mw", "📋", "Liste de souhaits", "{n} modèles dans « À faire »", [1]),
    _a("spools_total", "filaments", "🧺", "Collection de bobines", "{n} bobines enregistrées en tout", [1]),
    _a("spool_kg", "filaments", "🚚", "Gros acheteur", "{n} kg de filament achetés", [1], unit='kg'),
    _a("spool_spent", "filaments", "💳", "Budget filament", "{n} € de bobines", [1], unit='€', money=True),
    _a("catalog", "filaments", "📚", "Catalogue", "{n} références de filament", [1]),
    _a("bambu_spools", "filaments", "🎋", "Fidèle à Bambu", "{n} bobines Bambu Lab", [1]),
    _a("other_spools", "filaments", "🏴‍☠️", "Indépendant", "{n} bobines d'autres marques", [1]),
    _a("assembled", "objects", "🧩", "Assembleur", "{n} objets avec des accessoires", [1]),
    _a("accessory_refs", "objects", "🧰", "Quincaillerie", "{n} sortes d'accessoires", [1]),
    _a("accessory_units", "objects", "🗄️", "Tiroirs pleins", "{n} accessoires en stock", [1]),
    _a("best_sale", "objects", "🤑", "Belle vente", "Un objet vendu {n} €", [1], unit='€', money=True),
    _a("showcase", "objects", "🪟", "Vitrine", "{n} objets à vendre en même temps", [1]),
    _a("notes", "prints", "📝", "Annotateur", "{n} impressions annotées", [1]),
    _a("household", "app", "🏠", "Maison pleine", "{n} comptes dans la maison", [1]),
    # Durees
    _a("long_prints", "prints", "🐫", "Longue haleine", "{n} impressions de plus de 10 h", [1]),
    _a("express", "prints", "🏎️", "Express", "{n} impressions réussies de moins de 30 minutes", [1]),
    _a("night_hours", "prints", "🌃", "Veilleur de nuit", "{n} h imprimées entre minuit et 6 h", [1], unit="h"),
    _a("nonstop", "prints", "🔋", "Sans relâche", "{n} h d'affilée sans que l'imprimante s'arrête", [1], unit="h"),
    _a("lost_hours", "prints", "⌛", "Heures envolées", "{n} h d'impressions ratées", [1], unit="h"),
    _a("day_hours", "prints", "☀️", "Journée pleine", "{n} h imprimées dans une même journée", [1], unit="h"),
    _a("month_hours", "prints", "📈", "Mois de folie", "{n} h imprimées en un même mois", [1], unit="h"),
    # Poids, plateaux, imprimantes
    _a("feather", "prints", "🪶", "Poids plume", "{n} impressions réussies de moins de 5 g", [1]),
    _a("sturdy", "prints", "🦍", "Costaud", "{n} impressions de plus de 500 g", [1]),
    _a("multi_plate", "prints", "🍽️", "Multi-plateaux", "{n} impressions d'un plateau 2 ou plus", [1]),
    _a("ams_units", "prints", "🗄️", "Parc d'AMS", "{n} AMS en service", [1]),
    # Secrets : une medaille unique, cachee tant qu'elle n'est pas gagnee
    _a("halloween", "secret", "🎃", "Spooky", "Une impression lancée un 31 octobre", [1],
       lore="Tu as imprimé un soir d'Halloween. Citrouille, squelette ou chauve-souris : l'imprimante aussi s'est déguisée."),
    _a("christmas", "secret", "🎄", "Joyeux Noël", "Une impression lancée un 24 ou 25 décembre", [1],
       lore="L'imprimante a travaillé à Noël. Les lutins du Père Noël, c'était donc toi."),
    _a("new_year", "secret", "🎆", "Bonne année", "Une impression en cours au passage du Nouvel An", [1],
       lore="Ton imprimante a changé d'année en pleine couche. Meilleurs vœux, buse comprise."),
    _a("friday13", "secret", "🐈‍⬛", "Vendredi 13", "Une impression lancée un vendredi 13", [1],
       lore="Tu as défié le sort en lançant une impression un vendredi 13. Courageux."),
    _a("pi_day", "secret", "🥧", "Jour de Pi", "Une impression lancée un 14 mars", [1],
       lore="Une impression le 14/3, jour de Pi : 3,14159… couches de bonheur."),
    _a("tiny", "secret", "🐜", "Miniature", "Une impression réussie de moins de 1 g", [1],
       lore="Moins d'un gramme de filament : une pièce qui tient sur un ongle."),
    _a("flash", "secret", "⚡", "Éclair", "Une impression réussie en moins de 10 minutes", [1],
       lore="Une impression bouclée en moins de 10 minutes. Le café n'a même pas eu le temps de refroidir."),
    _a("all_nighter", "secret", "🌙", "Nuit blanche", "Une impression de plus de 8 h lancée après 22 h", [1],
       lore="Plus de 8 heures lancées après 22 h : l'imprimante a veillé pendant que tu dormais."),
    _a("comeback", "secret", "💪", "Persévérant", "Un modèle enfin réussi après 3 échecs d'affilée", [1],
       lore="Trois échecs d'affilée sur le même modèle, et tu n'as rien lâché : la quatrième était la bonne."),
    _a("rainbow16", "secret", "🦄", "Licorne", "Une impression de 8 couleurs ou plus", [1],
       lore="Huit couleurs ou plus dans une seule impression : un vrai arc-en-ciel."),
    _a("watchmaker", "secret", "⌚", "Horloger", "Une impression de plus d'une heure terminée à 1 % près de l'estimation", [1],
       lore="Une impression de plus d'une heure finie à 1 % près de l'estimation du trancheur. Précision suisse."),
    _a("leap_day", "secret", "🐸", "Saut de puce", "Une impression lancée un 29 février", [1],
       lore="Une impression un 29 février : ça n'arrive qu'une fois tous les quatre ans."),
    _a("valentine", "secret", "💘", "Saint-Valentin", "Une impression lancée un 14 février", [1],
       lore="Une impression le jour de la Saint-Valentin. Un cœur en PLA, peut-être ?"),
    _a("may_day", "secret", "🌷", "Fête du travail", "Une impression lancée un 1er mai", [1],
       lore="Le 1er mai, tout le monde se repose… sauf ton imprimante."),
    _a("bastille", "secret", "🎇", "14 juillet", "Une impression lancée un 14 juillet", [1],
       lore="Une impression le jour de la fête nationale : feu d'artifice de filament."),
    _a("midnight", "secret", "🕛", "Minuit pile", "Une impression lancée à minuit pile", [1],
       lore="Une impression lancée à 00 h 00 pile. Les douze coups ont sonné."),
    _a("all_year", "secret", "🗓️", "Toute l'année", "Au moins une impression chaque mois d'une même année", [1],
       lore="Pas un seul mois sans imprimer, de janvier à décembre : une année complète."),
    _a("weekend10", "secret", "🛠️", "Week-end de folie", "10 impressions lancées en un seul week-end", [1],
       lore="Dix impressions en un week-end : ton atelier n'a pas chômé."),
    _a("phoenix", "secret", "🔥", "Phénix", "Une impression réussie juste après 5 échecs d'affilée", [1],
       lore="Cinq échecs d'affilée, puis une réussite : tu renais de tes cendres de filament."),
    _a("n1001", "secret", "📜", "Mille et une", "Ta 1001ᵉ impression réussie", [1],
       lore="La 1001ᵉ impression réussie : de quoi en raconter une chaque nuit."),
    _a("titan", "secret", "🗿", "Titan", "Une impression de plus de 2 kg et de plus de 24 h", [1],
       lore="Plus de 2 kg et plus de 24 heures d'un coup : une pièce de titan."),
    # ── Fournee du 20/10/2026 : les loufoques ──
    _a("answer42", "secret", "🌌", "La grande réponse", "Une impression réussie de 42 g pile", [1],
       lore="42 grammes tout rond : la réponse à la grande question sur la vie, l'univers et le reste."),
    _a("beast", "secret", "😈", "Le nombre de la bête", "Une impression de 666 g pile", [1],
       lore="666 grammes. On ne dira rien, mais l'imprimante sentait un peu le soufre."),
    _a("kilo", "secret", "⚖️", "Le kilo pile", "Une impression réussie de 1 kg tout rond (à 2 g près)", [1],
       lore="Un kilo, ni plus ni moins : une bobine entière dans une seule pièce."),
    _a("pi_grams", "secret", "🥧", "Pi grammes", "Une impression réussie de 3,14 g", [1],
       lore="3,14 grammes : une part de tarte… très fine."),
    _a("palindrome", "secret", "🔁", "Palindrome", "Une impression dont la durée en minutes se lit dans les deux sens", [1],
       lore="Une durée qui se lit pareil dans les deux sens, comme « kayak » ou « été »."),
    _a("full_day", "secret", "🕐", "Tour d'horloge", "Une impression de 24 h pile (à la minute près)", [1],
       lore="Vingt-quatre heures, pas une minute de plus : l'imprimante a fait le tour du cadran."),
    _a("marathon42", "secret", "🏅", "Vrai marathon", "Une impression réussie de plus de 42,195 h", [1],
       lore="42,195 heures : la distance d'un marathon, mais en heures. Et sans ampoules."),
    _a("bullseye", "secret", "🎯", "Dans le mille", "Une impression de plus d'une heure finie à une minute près de l'estimation", [1],
       lore="Le trancheur avait dit telle heure, ce fut telle heure. À la minute près."),
    _a("tortoise", "secret", "🐢", "La tortue", "Une impression réussie qui a pris deux fois plus longtemps que prévu", [1],
       lore="Deux fois le temps prévu, mais elle est arrivée au bout. Rien ne sert de courir."),
    _a("hare", "secret", "🐇", "Le lièvre", "Une impression réussie finie 20 % plus tôt que prévu", [1],
       lore="Finie bien avant l'heure : le trancheur était trop pessimiste."),
    _a("hundred", "secret", "💯", "Centenaire", "Ta 100ᵉ impression réussie", [1],
       lore="La centième ! On ne compte plus les plateaux nettoyés."),
    _a("lucky777", "secret", "🎰", "Triple sept", "Ta 777ᵉ impression réussie", [1],
       lore="777 : les trois cerises sont alignées."),
    _a("leet", "secret", "💻", "1337", "Ta 1337ᵉ impression réussie", [1],
       lore="Ta 1337ᵉ réussite : tu es officiellement « leet »."),
    _a("hundred_pieces", "secret", "🧮", "Centaine", "100 pièces ou plus dans une seule impression", [1],
       lore="Cent pièces d'un coup sur le plateau : la production en série, version artisanale."),
    _a("panda", "secret", "🐼", "Panda", "Une impression en noir et blanc, rien d'autre", [1],
       lore="Du noir, du blanc, et rien d'autre : élégant comme un panda."),
    _a("tricolore", "secret", "🇫🇷", "Tricolore", "Une impression en bleu, blanc et rouge", [1],
       lore="Bleu, blanc, rouge : une impression aux couleurs de la France."),
    _a("carbon", "secret", "🖤", "Fibre de carbone", "Une impression réussie en filament chargé carbone", [1],
       lore="Du filament chargé de fibre de carbone : solide, mat, et la buse s'en souviendra."),
    _a("rubber", "secret", "🫧", "Caoutchouc", "Ta première impression réussie en TPU", [1],
       lore="Ton premier TPU réussi : souple, rebondissant, et pas la plus facile des matières."),
    _a("novel", "secret", "📖", "Roman-fleuve", "Une impression au nom de plus de 80 caractères", [1],
       lore="Un nom de modèle si long qu'il aurait pu faire un chapitre."),
    _a("noon", "secret", "☀️", "Midi pile", "Une impression lancée à midi pile", [1],
       lore="Lancée à 12 h 00 pile : le soleil au zénith, la buse aussi."),
    _a("mirror", "secret", "🪞", "Heure miroir", "Une impression lancée à une heure miroir (11 h 11, 22 h 22…)", [1],
       lore="Lancée à une heure miroir. Fais un vœu."),
    _a("sequence", "secret", "🔢", "1, 2, 3, 4", "Une impression lancée à 12 h 34", [1],
       lore="12 h 34 : une, deux, trois, quatre… lancée !"),
    _a("april_fool", "secret", "🐟", "Poisson d'avril", "Une impression ratée un 1er avril", [1],
       lore="Une impression ratée un 1er avril. C'était une blague, évidemment."),
    _a("music", "secret", "🎸", "Fête de la musique", "Une impression lancée un 21 juin", [1],
       lore="Le 21 juin, ton imprimante a joué sa partition : bip, vrrr, bip."),
    _a("summer_solstice", "secret", "🌞", "Solstice d'été", "Une impression de plus de 12 h un 21 juin", [1],
       lore="Plus de 12 heures d'impression le jour le plus long de l'année."),
    _a("winter_solstice", "secret", "🌑", "Nuit la plus longue", "Une impression de plus de 12 h un 21 décembre", [1],
       lore="Plus de 12 heures d'impression pendant la nuit la plus longue de l'année."),
    _a("easter", "secret", "🥚", "Chasse aux œufs", "Une impression lancée le dimanche de Pâques", [1],
       lore="Une impression le dimanche de Pâques. Tu as caché des œufs en PLA ?"),
    _a("full_moon", "secret", "🌕", "Pleine lune", "Une impression lancée de nuit, un soir de pleine lune", [1],
       lore="Lancée une nuit de pleine lune. Les loups-garous impriment aussi."),
    _a("sunday_morning", "secret", "🥐", "Dimanche matin", "Une impression lancée un dimanche entre 6 h et 8 h", [1],
       lore="Un dimanche avant 8 h : pas de grasse matinée pour l'imprimante."),
    _a("triplets", "secret", "👶", "Triplés", "Le même modèle réussi trois fois le même jour", [1],
       lore="Trois fois le même modèle réussi dans la journée : des triplés !"),
    _a("broken_record", "secret", "💿", "Disque rayé", "Le même modèle réussi trois fois de suite", [1],
       lore="Trois fois de suite le même modèle : on dirait un disque rayé."),
    _a("bad_day", "secret", "🌧️", "Jour sans", "5 impressions ratées le même jour", [1],
       lore="Cinq échecs en une journée. Demain sera meilleur, promis."),
    _a("insomniac", "secret", "🥱", "Insomniaque", "Des impressions lancées entre minuit et 5 h trois nuits d'affilée", [1],
       lore="Trois nuits d'affilée à lancer des impressions entre minuit et 5 h. Tu dors, parfois ?"),
    _a("comeback30", "secret", "🛰️", "Le retour", "Une impression après plus d'un mois sans imprimer", [1],
       lore="Plus d'un mois sans imprimer, puis le grand retour. La buse avait des fourmis dans les jambes."),
    _a("hibernation", "secret", "🐻", "Hibernation", "Une impression après plus de trois mois de pause", [1],
       lore="Trois mois de sommeil, et l'imprimante se réveille comme un ours au printemps."),
    _a("anniversary", "secret", "🎂", "Joyeux anniversaire", "Une impression le jour anniversaire de ta toute première", [1],
       lore="Une impression le jour anniversaire de ta toute première. Souffle les bougies… en PLA."),
    _a("penny", "secret", "🪙", "Petit budget", "Une impression réussie qui a coûté moins de 10 centimes", [1],
       lore="Moins de 10 centimes de filament et d'électricité. La pièce la plus rentable de l'atelier."),
    _a("luxury", "secret", "👑", "Grand luxe", "Une seule impression qui a coûté plus de 50 €", [1],
       lore="Plus de 50 € pour une seule impression : une pièce de collection."),
    _a("market_day", "secret", "🎪", "Jour de marché", "5 objets vendus le même jour", [1],
       lore="Cinq objets vendus dans la journée : un vrai jour de marché."),
    _a("santa", "secret", "🎅", "Père Noël", "Un objet offert en décembre", [1],
       lore="Un objet offert en décembre. Le Père Noël a un atelier d'impression 3D."),
    _a("new_years_day", "secret", "🥂", "Premier de l'an", "Une impression lancée un 1er janvier", [1],
       lore="Première impression de l'année, le jour même. Bonne résolution tenue."),
    _a("star_wars", "secret", "🌌", "Que la force soit avec toi", "Une impression lancée un 4 mai", [1],
       lore="May the 4th be with you : ton imprimante a choisi le côté lumineux."),
    _a("towel_day", "secret", "🧣", "Jour de la serviette", "Une impression lancée un 25 mai", [1],
       lore="Le 25 mai, jour de la serviette. N'oublie jamais la tienne."),
    _a("pi_approx", "secret", "🥧", "Pi approché", "Une impression lancée un 22 juillet", [1],
       lore="22/7 : la fraction qui fait presque Pi. Presque."),
    _a("cat_day", "secret", "🐈", "Journée du chat", "Une impression lancée un 8 août", [1],
       lore="Journée mondiale du chat. Le tien a sûrement dormi sur l'imprimante."),
    _a("mid_august", "secret", "🏖️", "Plein été", "Une impression lancée un 15 août", [1],
       lore="Le 15 août, tout le monde est à la plage. Sauf ton imprimante."),
    _a("back_to_school", "secret", "🎒", "Rentrée", "Une impression lancée un 1er septembre", [1],
       lore="Jour de rentrée : un nouveau cartable, ou une nouvelle impression ?"),
    _a("all_saints", "secret", "🕯️", "Toussaint", "Une impression lancée un 1er novembre", [1],
       lore="Une impression le 1er novembre, en souvenir des plateaux disparus."),
    _a("dia_muertos", "secret", "💀", "Jour des morts", "Une impression lancée un 2 novembre", [1],
       lore="Día de los Muertos : une tête de mort colorée, peut-être ?"),
    _a("st_nicholas", "secret", "🍬", "Saint-Nicolas", "Une impression lancée un 6 décembre", [1],
       lore="Le 6 décembre, saint Nicolas passe : tu as imprimé les friandises ?"),
    _a("st_john", "secret", "🔥", "Feux de la Saint-Jean", "Une impression lancée un 24 juin", [1],
       lore="La nuit de la Saint-Jean, les feux s'allument, la buse aussi."),
    _a("earth_day", "secret", "🌍", "Jour de la Terre", "Une impression lancée un 22 avril", [1],
       lore="Jour de la Terre : un peu de PLA, ce bioplastique de maïs."),
    _a("equinox", "secret", "⚖️", "Équinoxe", "Une impression lancée un jour d'équinoxe", [1],
       lore="Autant de jour que de nuit : l'équilibre parfait."),
    _a("dst_summer", "secret", "⏩", "Heure d'été", "Une impression en cours au passage à l'heure d'été", [1],
       lore="L'impression a perdu une heure en route, et ne s'en est pas aperçue."),
    _a("dst_winter", "secret", "⏪", "Heure d'hiver", "Une impression en cours au passage à l'heure d'hiver", [1],
       lore="Une heure gagnée en pleine impression : 2 h 30 deux fois de suite."),
    _a("programmers", "secret", "👨‍💻", "Jour du programmeur", "Une impression lancée le 256ᵉ jour de l'année", [1],
       lore="Le 256ᵉ jour de l'année, la fête de ceux qui comptent en octets."),
    _a("mothers_day", "secret", "💐", "Fête des mères", "Une impression lancée le jour de la fête des mères", [1],
       lore="Une impression le jour de la fête des mères. Un vase, un cadre, un cœur ?"),
    _a("ascension", "secret", "☁️", "Ascension", "Une impression lancée le jeudi de l'Ascension", [1],
       lore="Un jeudi férié, et l'imprimante qui monte, couche après couche."),
    _a("mardi_gras", "secret", "🎭", "Mardi gras", "Une impression lancée un mardi gras", [1],
       lore="Mardi gras : masques, confettis… et filament."),
    _a("black_friday", "secret", "🛍️", "Black Friday", "Une impression lancée le jour du Black Friday", [1],
       lore="Pendant que d'autres achètent, toi tu fabriques."),
    _a("double_day", "secret", "👯", "Jour double", "Une impression lancée un jour dont le jour et le mois sont égaux", [1],
       lore="1/1, 2/2, 3/3… un jour en double, et une impression avec."),
    _a("twelve", "secret", "🕛", "Douze douze", "Une impression lancée le 12 décembre à 12 h 12", [1],
       lore="12/12 à 12 h 12 : une précision d'horloger."),
    _a("palindrome_time", "secret", "🔄", "Heure palindrome", "Une impression lancée à une heure qui se lit dans les deux sens", [1],
       lore="12 h 21, 13 h 31… une heure réversible."),
    _a("after_midnight", "secret", "🌘", "Juste après minuit", "Une impression lancée à 0 h 01", [1],
       lore="À peine minuit passé, déjà une impression : la journée commence bien."),
    _a("snack_time", "secret", "🍪", "L'heure du goûter", "Une impression lancée à 16 h pile", [1],
       lore="16 h pile : un goûter pour toi, une impression pour l'imprimante."),
    _a("tea_time", "secret", "🫖", "Tea time", "Une impression lancée à 17 h pile", [1],
       lore="17 h, l'heure du thé. Avec ou sans lait, mais avec filament."),
    _a("aperitif", "secret", "🫒", "L'heure de l'apéro", "Une impression lancée à 18 h pile", [1],
       lore="18 h pile : l'apéro est servi, l'imprimante aussi."),
    _a("wolf_hour", "secret", "🐺", "L'heure du loup", "Une impression lancée entre 3 h et 4 h du matin", [1],
       lore="L'heure du loup, quand tout le monde dort. Sauf toi."),
    _a("end_noon", "secret", "🍽️", "Pile pour midi", "Une impression terminée à midi pile", [1],
       lore="Finie à midi pile : juste à temps pour passer à table."),
    _a("end_evening", "secret", "🔔", "Fin de journée", "Une impression terminée à 18 h pile", [1],
       lore="Finie à 18 h pile, comme une journée de bureau."),
    _a("triple3", "secret", "3️⃣", "Triple trois", "Une impression de 3 h 33 pile", [1],
       lore="3 h 33 : trois fois trois, à la minute près."),
    _a("suite123", "secret", "🔢", "Un, deux, trois", "Une impression de 1 h 23 pile", [1],
       lore="1 h 23 : la suite parfaite, à la minute près."),
    _a("min42", "secret", "🌌", "42 minutes", "Une impression réussie de 42 minutes pile", [1],
       lore="42 minutes : encore la grande réponse, mais en durée."),
    _a("gram1", "secret", "🪶", "Le gramme", "Une impression réussie d'un gramme pile", [1],
       lore="Un seul gramme. On a dû la chercher sur le plateau."),
    _a("g100", "secret", "💯", "Cent grammes", "Une impression réussie de 100 g pile", [1],
       lore="100 g tout rond, comme une tablette de chocolat."),
    _a("g500", "secret", "🧈", "Demi-kilo", "Une impression réussie de 500 g pile", [1],
       lore="500 g pile : un demi-kilo, comme un paquet de beurre (en plus solide)."),
    _a("g_palindrome", "secret", "🪞", "Poids miroir", "Une impression de plus d'un kilo dont le poids se lit dans les deux sens", [1],
       lore="1 221 g, 1 331 g… un poids qui se lit à l'endroit comme à l'envers."),
    _a("equal", "secret", "🟰", "Équilibre", "Une impression qui a duré autant de minutes qu'elle pèse de grammes", [1],
       lore="Autant de minutes que de grammes : l'harmonie parfaite."),
    _a("supersonic", "secret", "🚀", "Supersonique", "Une impression réussie en deux fois moins de temps que prévu", [1],
       lore="Deux fois plus rapide que l'estimation : le mur du son est franchi."),
    _a("wink", "secret", "😉", "Clin d'œil", "Une impression réussie en moins de 2 minutes", [1],
       lore="Moins de deux minutes. Tu as cligné des yeux et c'était fini."),
    _a("mammoth", "secret", "🦣", "Mammouth", "Une impression de plus de 3 kg", [1],
       lore="Plus de 3 kg d'un coup : une pièce de mammouth."),
    _a("rainbow6", "secret", "🌈", "Arc-en-ciel parfait", "Rouge, orange, jaune, vert, bleu et violet dans la même impression", [1],
       lore="Les six couleurs de l'arc-en-ciel dans une seule pièce."),
    _a("vader", "secret", "🖤", "Côté obscur", "Une impression réussie toute en noir, de plus de 100 g", [1],
       lore="Plus de 100 g de noir, rien que du noir : je suis ton imprimante."),
    _a("snow", "secret", "☃️", "Neige", "Une impression réussie toute en blanc, de plus de 100 g", [1],
       lore="Plus de 100 g de blanc immaculé, comme une neige fraîche."),
    _a("mouse", "secret", "🐭", "Gris souris", "Une impression réussie toute en gris", [1],
       lore="Tout en gris, discrète comme une souris."),
    _a("clockwork", "secret", "🍊", "Orange mécanique", "Une impression réussie toute en orange", [1],
       lore="Tout en orange, sans rien d'autre."),
    _a("prince", "secret", "💜", "Purple Rain", "Une impression réussie toute en violet", [1],
       lore="Tout en violet, en hommage à Prince."),
    _a("chick", "secret", "🐥", "Poussin", "Une impression réussie toute en jaune", [1],
       lore="Tout en jaune, comme un poussin tout juste éclos."),
    _a("belgium", "secret", "🇧🇪", "Une fois", "Une impression en noir, jaune et rouge", [1],
       lore="Noir, jaune, rouge : une impression aux couleurs de la Belgique, une fois."),
    _a("italy", "secret", "🇮🇹", "Tricolore italien", "Une impression en vert, blanc et rouge", [1],
       lore="Vert, blanc, rouge : comme une pizza margherita."),
    _a("reggae", "secret", "🎵", "Reggae", "Une impression en rouge, jaune et vert", [1],
       lore="Rouge, jaune, vert : une impression qui swingue."),
    _a("bee", "secret", "🐝", "Abeille", "Une impression en jaune et noir, rien d'autre", [1],
       lore="Jaune et noir, une impression qui bourdonne."),
    _a("ladybug", "secret", "🐞", "Coccinelle", "Une impression en rouge et noir, rien d'autre", [1],
       lore="Rouge à points noirs : une coccinelle porte-bonheur."),
    _a("sailor", "secret", "⚓", "Marinière", "Une impression en bleu et blanc, rien d'autre", [1],
       lore="Bleu et blanc, comme une marinière bretonne."),
    _a("rainbow_ultimate", "secret", "🎆", "Arc-en-ciel ultime", "Une impression de 16 couleurs ou plus", [1],
       lore="Seize couleurs ou plus dans une même impression : tous tes AMS ont donné."),
    _a("mix2", "secret", "🧬", "Mélange", "Une impression avec deux matières différentes", [1],
       lore="Deux matières dans la même pièce : un mariage réussi."),
    _a("lab3", "secret", "⚗️", "Laboratoire", "Une impression avec trois matières différentes", [1],
       lore="Trois matières dans une seule impression : un vrai laboratoire."),
    _a("abs_first", "secret", "👃", "Odeur d'ABS", "Ta première impression réussie en ABS", [1],
       lore="Ton premier ABS réussi, sans warping. L'odeur, on n'en parle pas."),
    _a("asa_first", "secret", "🌞", "Plein air", "Ta première impression réussie en ASA", [1],
       lore="De l'ASA : une pièce faite pour affronter le soleil et la pluie."),
    _a("pc_first", "secret", "🛡️", "Polycarbonate", "Ta première impression réussie en PC", [1],
       lore="Du polycarbonate : solide comme un bouclier."),
    _a("nylon_first", "secret", "🪢", "Nylon", "Ta première impression réussie en PA (nylon)", [1],
       lore="Ton premier nylon réussi : résistant, et pas facile à dompter."),
    _a("pi314", "secret", "🥧", "Pi fois cent", "Ta 314ᵉ impression réussie", [1],
       lore="La 314ᵉ : Pi multiplié par cent."),
    _a("err404", "secret", "🚫", "Erreur 404", "Ta 404ᵉ impression a raté", [1],
       lore="La 404ᵉ impression a échoué : page introuvable, pièce aussi."),
    _a("devil666", "secret", "😈", "Six cent soixante-six", "Ta 666ᵉ impression réussie", [1],
       lore="La 666ᵉ : on ne dira rien, mais elle sentait le soufre."),
    _a("almost1000", "secret", "😬", "Presque mille", "Ta 999ᵉ impression réussie", [1],
       lore="999 : si près du millier…"),
    _a("byte256", "secret", "💾", "Un octet", "Ta 256ᵉ impression réussie", [1],
       lore="256 : un octet plein, de 0 à 255 et une de plus."),
    _a("kilobyte", "secret", "💽", "Un kilo-octet", "Ta 1024ᵉ impression réussie", [1],
       lore="1024 : un kilo-octet, un vrai."),
    _a("ten_thousand", "secret", "🏛️", "Dix mille", "Ta 10 000ᵉ impression réussie", [1],
       lore="Dix mille impressions réussies. Respect."),
    _a("onetwothree", "secret", "🎲", "123", "Ta 123ᵉ impression réussie", [1],
       lore="La 123ᵉ : comme on compte jusqu'à trois."),
    _a("seventh", "secret", "☁️", "Septième ciel", "Ta 7ᵉ impression réussie", [1],
       lore="La septième : te voilà au septième ciel."),
    _a("lucky13", "secret", "🍀", "Treize porte-bonheur", "Ta 13ᵉ impression réussie", [1],
       lore="La 13ᵉ, réussie : le 13 porte bonheur, finalement."),
    _a("forager", "secret", "🦋", "Butineur", "10 modèles différents imprimés le même jour", [1],
       lore="Dix modèles différents dans la journée : tu butines de modèle en modèle."),
    _a("perfect_month", "secret", "📆", "Mois parfait", "Au moins une impression chaque jour d'un mois entier", [1],
       lore="Pas un seul jour sans imprimer pendant un mois entier."),
    _a("all_hours", "secret", "🕐", "Tour du cadran", "Des impressions lancées à chacune des 24 heures", [1],
       lore="Tu as lancé une impression à chaque heure du jour et de la nuit."),
    _a("plate7", "secret", "🍽️", "Septième plateau", "Une impression d'un plateau 7 ou plus", [1],
       lore="Plateau 7 ou plus : un projet qui ne tient pas en un seul plateau."),
    _a("unfaithful", "secret", "🔀", "Infidèle", "Deux impressions d'affilée sur deux imprimantes différentes", [1],
       lore="Une imprimante, puis une autre : tu as plusieurs amours."),
    _a("mega_group", "secret", "📦", "Méga-groupe", "Un groupe de 20 impressions ou plus", [1],
       lore="Vingt impressions dans un même groupe : un sacré projet."),
    _a("novelist", "secret", "✍️", "Romancier", "Une note de plus de 200 caractères sur une impression", [1],
       lore="Une note de plus de 200 caractères : tu racontes tes impressions."),
    _a("black_week", "secret", "🖤", "Semaine noire", "10 impressions ratées en 7 jours", [1],
       lore="Dix échecs en une semaine. La suivante ne peut être que meilleure."),
    _a("revenge", "secret", "🥊", "Revanche", "Un modèle enfin réussi après 5 échecs au total", [1],
       lore="Cinq échecs sur le même modèle, puis la victoire. La revanche est un plat qui se sert chaud."),
    _a("flawless_month", "secret", "✨", "Mois sans faute", "Au moins 20 impressions dans un mois, et aucun échec", [1],
       lore="Vingt impressions ou plus dans le mois, et pas un seul échec."),
    _a("psycho_price", "secret", "🏷️", "Prix psychologique", "Un objet vendu à un prix en ,99", [1],
       lore="Vendu à quelque chose ,99 € : le marketing n'a plus de secret pour toi."),
    _a("one_euro", "secret", "🪙", "Euro symbolique", "Un objet vendu 1 €", [1],
       lore="Vendu pour un euro symbolique. Le geste compte."),
    _a("big_spool", "secret", "🛢️", "Grosse bobine", "Une bobine de 3 kg ou plus", [1],
       lore="Une bobine de 3 kg ou plus : de quoi voir venir."),
    _a("gold_spool", "secret", "💎", "Bobine précieuse", "Une bobine de plus de 40 €", [1],
       lore="Plus de 40 € la bobine : un filament de luxe."),
    _a("bargain", "secret", "🤝", "Bonne affaire", "Une bobine à moins de 10 €", [1],
       lore="Moins de 10 € la bobine : une affaire en or."),
    _a("spring_clean", "secret", "🧹", "Grand ménage", "10 bobines terminées le même mois", [1],
       lore="Dix bobines vidées dans le mois : l'étagère respire."),
    _a("self_print", "secret", "🪞", "Autoportrait", "Une impression de l'un de tes propres modèles MakerWorld", [1],
       lore="Tu as imprimé ton propre modèle : le créateur et l'imprimeur, c'est toi."),
    _a("bestseller", "secret", "📚", "Best-seller", "Un modèle imprimé par plus de 100 000 personnes", [1],
       lore="Un modèle imprimé plus de 100 000 fois sur MakerWorld : un classique."),
    _a("pioneer", "secret", "🧭", "Pionnier", "Un modèle imprimé par moins de 5 personnes avant toi", [1],
       lore="Un modèle que presque personne n'avait encore imprimé : tu ouvres la voie."),
    _a("christmas_visit", "secret", "🎄", "Même à Noël", "L'appli ouverte un 25 décembre", [1],
       lore="Le jour de Noël, tu as quand même jeté un œil à tes impressions."),
    _a("pit_stop", "secret", "🏁", "Arrêt au stand", "4 bobines posées dans l'AMS en moins de 5 minutes", [1],
       lore="Quatre bobines changées en moins de cinq minutes : un vrai arrêt au stand de Formule 1."),
    _a("one_hour", "secret", "⏲️", "Une heure pile", "Une impression réussie d'une heure tout rond (à 30 s près)", [1],
       lore="Soixante minutes, pas une seconde de plus (ou presque)."),
    _a("cinderella", "secret", "👠", "Cendrillon", "Une impression terminée sur le coup de minuit", [1],
       lore="Finie sur le coup de minuit : le carrosse n'a pas eu le temps de redevenir citrouille."),
    _a("wake_up", "secret", "⏰", "Le réveil", "Une impression terminée à 7 h pile", [1],
       lore="Finie à 7 h pile, juste à temps pour le café."),
    _a("paparazzi", "secret", "🤳", "Paparazzi", "Une photo ajoutée moins de 10 minutes après la fin de l'impression", [1],
       lore="La pièce était encore tiède que tu la prenais déjà en photo."),
    _a("souvenirs", "secret", "📷", "Souvenirs", "Une photo ajoutée plus d'un an après l'impression", [1],
       lore="Une photo ajoutée plus d'un an après : certaines pièces méritent qu'on y revienne."),
    _a("grand_tour", "secret", "🗺️", "Tour du propriétaire", "Toutes les pages de l'appli visitées", [1],
       lore="Accueil, historique, filaments, objets, stats, paramètres, journal : tu as fait le tour du propriétaire."),
    _a("night_visit", "secret", "🦇", "Visite nocturne", "L'appli ouverte entre 3 h et 4 h du matin", [1],
       lore="L'appli ouverte entre 3 h et 4 h du matin. Tu vérifiais l'impression, avoue."),
    _a("cutting_edge", "secret", "🚀", "À la pointe", "La toute dernière version de BambuNymous installée", [1],
       lore="Tu tournes sur la toute dernière version publiée : rien de plus récent n'existe."),
    _a("double_update", "secret", "⏩", "Mise à jour express", "Deux mises à jour installées le même jour", [1],
       lore="Deux mises à jour dans la même journée : ça bouge vite, par ici."),
    # ── Fournee pour arriver a 100 (20/10/2026) ──
    _a("barbie", "secret", "🎀", "Barbie", "Une impression réussie toute en rose", [1],
       lore="Tout en rose, du premier au dernier millimètre. Come on Barbie, let's go print."),
    _a("smurf", "secret", "💙", "Schtroumpf", "Une impression réussie toute en bleu, de plus de 100 g", [1],
       lore="Plus de 100 g de bleu, rien que du bleu : un vrai Schtroumpf."),
    _a("hulk", "secret", "💚", "Incroyable Hulk", "Une impression réussie toute en vert, de plus de 100 g", [1],
       lore="Plus de 100 g de vert et rien d'autre. Ne mets pas l'imprimante en colère."),
    _a("fire", "secret", "🔥", "Feu de camp", "Une impression en rouge, orange et jaune", [1],
       lore="Rouge, orange et jaune dans la même impression : ça crépite."),
    _a("pumpkin", "secret", "🎃", "Citrouille", "Une impression en orange et noir, rien d'autre", [1],
       lore="Orange et noir, les couleurs d'Halloween, même si ce n'était pas le 31."),
    _a("xmas_tree", "secret", "🎄", "Sapin", "Une impression en rouge et vert, rien d'autre", [1],
       lore="Rouge et vert, les couleurs de Noël, quelle que soit la saison."),
    _a("silk", "secret", "🪡", "Soie", "Une impression réussie en filament soie", [1],
       lore="Du filament soie : ça brille, ça glisse sous les doigts, et ça fait toujours son effet."),
    _a("galaxy", "secret", "🌠", "Galaxie", "Une impression réussie en filament galaxie", [1],
       lore="Un filament galaxie : des paillettes d'étoiles dans chaque couche."),
    _a("glow", "secret", "👻", "Phosphorescent", "Une impression réussie en filament phosphorescent", [1],
       lore="Une pièce qui brille dans le noir. Éteins la lumière pour vérifier."),
    _a("marble", "secret", "🏛️", "Marbre", "Une impression réussie en filament effet marbre", [1],
       lore="Effet marbre : ta pièce a l'air taillée par un sculpteur antique."),
    _a("wood", "secret", "🪵", "Menuisier", "Une impression réussie en filament bois", [1],
       lore="Du filament bois : ça sent même un peu la scierie."),
    _a("translucent", "secret", "🔍", "Transparence", "Une impression réussie en filament translucide", [1],
       lore="Une pièce translucide : on voit à travers, mais elle est bien là."),
    _a("sparkle", "secret", "✨", "Paillettes", "Une impression réussie en filament pailleté", [1],
       lore="Des paillettes plein la pièce. Et un peu partout ailleurs, comme toujours."),
    _a("soluble", "secret", "💧", "Soluble", "Une impression avec un support soluble (PVA)", [1],
       lore="Des supports qui fondent dans l'eau : la magie du PVA."),
    _a("elite", "secret", "💾", "13 h 37", "Une impression lancée à 13 h 37", [1],
       lore="13 h 37 : l'heure des initiés."),
    _a("last_minute", "secret", "🕚", "Juste avant minuit", "Une impression lancée à 23 h 59", [1],
       lore="Lancée à 23 h 59 : une seconde de plus et c'était demain."),
    _a("saturday_night", "secret", "🪩", "Samedi soir", "Une impression lancée un samedi après 22 h", [1],
       lore="Samedi soir, 22 h passées : pendant que d'autres dansent, ton imprimante travaille."),
    _a("monday_morning", "secret", "😩", "Lundi matin", "Une impression ratée un lundi avant 9 h", [1],
       lore="Une impression ratée un lundi avant 9 h. Même l'imprimante n'aime pas les lundis."),
    _a("st_patrick", "secret", "☘️", "Saint-Patrick", "Une impression avec du vert un 17 mars", [1],
       lore="Du vert le 17 mars : la Saint-Patrick, version filament."),
    _a("fathers_day", "secret", "👔", "Fête des pères", "Une impression lancée le jour de la fête des pères", [1],
       lore="Une impression le jour de la fête des pères. Un cadeau de dernière minute ?"),
    _a("crepes", "secret", "🥞", "Chandeleur", "Une impression lancée un 2 février", [1],
       lore="Le 2 février, jour des crêpes. Tu en as fait sauter une entre deux couches ?"),
    _a("epiphany", "secret", "👑", "Galette des rois", "Une impression lancée un 6 janvier", [1],
       lore="Le 6 janvier, jour de la galette. Tu as imprimé la fève ?"),
    _a("palindrome_date", "secret", "📅", "Date palindrome", "Une impression lancée un jour dont la date se lit dans les deux sens", [1],
       lore="Une date qui se lit dans les deux sens (comme le 02/02/2020) : rarissime."),
    _a("new_moon", "secret", "🌑", "Nuit noire", "Une impression lancée de nuit, un soir de nouvelle lune", [1],
       lore="Lancée une nuit sans lune. Heureusement, l'imprimante a son éclairage."),
    _a("y2k", "secret", "🎆", "An 2000", "Ta 2000ᵉ impression réussie", [1],
       lore="La 2000ᵉ : pas de bug de l'an 2000, juste des plateaux à vider."),
    _a("dont_panic", "secret", "🛸", "Pas de panique", "Ta 42ᵉ impression réussie", [1],
       lore="La 42ᵉ réussite. Pas de panique, et n'oublie pas ta serviette."),
    _a("on_fire", "secret", "🚒", "En feu", "7 impressions réussies le même jour", [1],
       lore="Sept réussites dans la journée : l'imprimante est en feu (au sens figuré)."),
    _a("rainbow_day", "secret", "🌈", "Journée arc-en-ciel", "10 couleurs différentes imprimées le même jour", [1],
       lore="Dix couleurs différentes dans la même journée : ton AMS a fait de la gymnastique."),
    _a("first_try", "secret", "🎳", "Du premier coup", "Un nouveau modèle de plus de 10 h réussi du premier coup", [1],
       lore="Un modèle jamais imprimé, plus de 10 heures, et réussi du premier coup. Strike !"),
    _a("so_close", "secret", "😱", "Si près du but", "Une impression annulée après plus de 90 % du temps prévu", [1],
       lore="Annulée alors qu'elle était presque finie. Il y avait sûrement une bonne raison…"),
    _a("big_fall", "secret", "🪂", "La chute", "Une impression ratée après plus de 10 h", [1],
       lore="Plus de 10 heures, puis l'échec. Les plus grandes chutes font les plus belles remontées."),
    _a("museum", "secret", "🖼️", "Pièce de musée", "Un objet vendu plus de 100 €", [1],
       lore="Un objet vendu plus de 100 € : une vraie pièce de collection."),
    _a("sold_hot", "secret", "🌶️", "Vendu tout chaud", "Un objet vendu le jour même de sa création", [1],
       lore="Vendu le jour même : à peine refroidi, déjà parti."),
    _a("finally_sold", "secret", "🕸️", "Enfin vendu", "Un objet vendu plus d'un an après sa création", [1],
       lore="Plus d'un an à attendre son acheteur, et il a fini par trouver preneur."),
    _a("eternal_spool", "secret", "🐌", "Bobine éternelle", "Une bobine terminée plus d'un an après sa première utilisation", [1],
       lore="Plus d'un an pour finir une bobine : elle aura vu passer les saisons."),
    _a("devoured_spool", "secret", "🍝", "Dévorée", "Une bobine terminée moins d'une semaine après sa première utilisation", [1],
       lore="Une bobine entière avalée en moins d'une semaine. Gourmande, cette imprimante."),
    _a("big_order", "secret", "📦", "Grosse commande", "10 bobines ajoutées au stock le même jour", [1],
       lore="Dix bobines arrivées le même jour. Le livreur s'en souvient encore."),
    _a("all_seasons", "secret", "🍂", "Quatre saisons", "Une impression réussie à chaque saison d'une même année", [1],
       lore="Printemps, été, automne, hiver : ton imprimante n'a pas de saison."),
    _a("jackpot", "secret", "💰", "Jackpot", "Décrocher le jackpot de la roue", [1],
       lore="Le jackpot ! La machine à sous en tremble encore."),
    _a("lucky5", "secret", "🍒", "Coup de chance", "Gagner 5 clés en un tour de roue", [1],
       lore="Cinq clés d'un coup : la chance te sourit."),
    _a("bad_luck", "secret", "🌧️", "Pas de bol", "Perdre 5 tours de roue d'affilée", [1],
       lore="Cinq tours, cinq fois rien. Mais toi, tu gagnes une médaille."),
    _a("win_streak", "secret", "🎯", "Série gagnante", "Gagner 3 tours de roue d'affilée", [1],
       lore="Trois tours gagnants de suite : le casino va finir par t'interdire."),
    _a("last_key", "secret", "🫙", "Fonds de tiroir", "Dépenser sa dernière clé", [1],
       lore="Plus une seule clé en poche : tout est parti en secrets."),
    _a("full_reveal", "secret", "📜", "Tout dévoilé", "Révéler un secret jusqu'à son descriptif", [1],
       lore="Plus rien de caché : il ne reste qu'à le gagner."),
    _a("action_cam", "secret", "🎬", "Action !", "Une vidéo ajoutée moins de 10 minutes après la fin de l'impression", [1],
       lore="À peine sortie du plateau, déjà filmée : moteur… action !"),
    _a("making_of", "secret", "🎥", "Making-of", "Une photo et une vidéo sur la même impression", [1],
       lore="La photo pour l'affiche, la vidéo pour les coulisses : un vrai making-of."),
    _a("festival", "secret", "🎪", "Festival", "5 vidéos ajoutées le même jour", [1],
       lore="Cinq vidéos dans la journée : la sélection officielle est bouclée."),
    _a("retro_video", "secret", "📼", "Rétrospective", "Une vidéo ajoutée plus d'un an après l'impression", [1],
       lore="Plus d'un an après, elle a enfin droit à son film. Mieux vaut tard que jamais."),
    _a("family_film", "secret", "👨‍👩‍👧", "Film de famille", "Une vidéo dans le dossier d'un groupe d'impressions", [1],
       lore="Toute la famille d'impressions réunie à l'écran."),
    _a("flash_video", "secret", "⚡", "Flash", "Une vidéo de moins de 3 secondes", [1],
       lore="Moins de trois secondes : le plus court des courts-métrages."),
]
# Easter eggs : des gestes caches dans l'appli, signales par la page elle-meme
# (POST /achievements/egg/{nom}). nom : (emoji, titre, ce qu'il faut faire, indice, histoire)
EGGS = {
    "developer": ("🤓", "Développeur", "Tapoter 5 fois de suite sur le numéro de version",
                  "Comme sur un téléphone Android : insiste sur un petit numéro qui ne paie pas de mine.",
                  "Tu es maintenant développeur. Aucun pouvoir en plus, mais quelle classe."),
    "konami": ("🎮", "Code Konami", "Saisir le code Konami (↑ ↑ ↓ ↓ ← → ← → B A) dans l'appli",
               "Un code de triche légendaire des consoles d'antan. Au doigt aussi, ça se glisse.",
               "+30 vies. Ici, ça ne sert à rien, mais le geste compte."),
    "magic_word": ("🪄", "Mot magique", "Taper « bambu » au clavier, sans être dans un champ",
                   "Dis le nom de la maison… au clavier, sans viser de case.",
                   "Tu as prononcé le mot magique : l'appli t'a reconnu."),
    "logo_spin": ("🌀", "Toupie", "Cliquer 7 fois sur le logo",
                  "Le logo n'est pas qu'une image : il a le tournis facile.",
                  "Sept clics sur le logo : il en a encore la tête qui tourne."),
    "disco": ("🪩", "Disco", "Basculer 10 fois entre thème clair et sombre en une minute",
              "Fais vibrer l'ambiance comme sur une piste des années 70, sans jamais t'arrêter.",
              "Clair, sombre, clair, sombre : la boule à facettes est de sortie."),
    "answer": ("🧮", "La grande question", "Chercher « 42 » dans une recherche",
               "Une recherche, un nombre, et la réponse à la grande question sur la vie, l'univers et le reste.",
               "42. Reste à trouver la question."),
    "seeker": ("🔍", "Chasseur d'œufs", "Chercher « easter egg » dans une recherche",
               "Ce que tu cherches porte un nom. Cherche-le.",
               "Tu cherchais un easter egg ? En voilà un."),
    "lost": ("🧭", "Perdu", "Atterrir sur une page qui n'existe pas",
             "Parfois, il faut se perdre pour trouver quelque chose.",
             "Page introuvable, mais médaille trouvée."),
    "polish": ("✨", "Polisseur", "Toucher 10 fois une médaille gagnée, dans son détail",
               "Une médaille, ça s'astique. Ouvre-en une et frotte bien.",
               "Elle brille comme jamais : on s'y voit presque."),
    "impatient": ("⏳", "Impatient", "Recharger l'appli 5 fois en moins de 30 secondes",
                  "La patience n'est pas ta vertu, et ton bouton préféré tourne en rond.",
                  "Cinq rechargements en trente secondes. Respire, tout est à jour."),
    "shake": ("🫨", "Secoué", "Secouer le téléphone, appli ouverte",
              "Ton téléphone a besoin d'être un peu bousculé.",
              "Secoué, pas remué. L'appli s'en remet doucement."),
    "flip": ("🙃", "Tête en bas", "Retourner le téléphone, appli ouverte",
             "Regarde l'appli sous un tout autre angle… voire à l'envers.",
             "Le monde à l'envers : même les médailles ont le tournis."),
    "bell": ("🔔", "Sonneur", "Appuyer 10 fois sur la cloche en 5 secondes",
             "Ding, ding, ding… quelqu'un insiste lourdement à la porte des nouvelles.",
             "Dix coups de cloche : tout le quartier est réveillé."),
    "zapper": ("📺", "Zappeur", "Changer de page 15 fois en 30 secondes",
               "Une page, une autre, une autre… pouce sur la télécommande.",
               "Quinze pages en trente secondes : le zapping, c'est un sport."),
    "print_page": ("🖨️", "Mise en abyme", "Imprimer une page de l'appli",
                   "Cette appli parle d'impression… et si tu imprimais l'appli elle-même ?",
                   "Imprimer l'appli d'impression : la boucle est bouclée."),
    "offline": ("🚇", "Tunnel", "Perdre la connexion puis la retrouver, appli ouverte",
                "Le monde disparaît un instant… puis revient.",
                "Connexion perdue, connexion retrouvée. Bienvenue à la sortie du tunnel."),
    "copycat": ("📋", "Copieur", "Copier du texte dans l'appli",
                "Il y a des choses à emporter avec toi.",
                "Copié ! Pas vu, pas pris."),
    "fullscreen": ("🖥️", "Grand écran", "Passer l'appli en plein écran",
                   "Plus de bords, plus de barres : rien que l'appli.",
                   "Plein écran : rien ne doit te distraire de tes médailles."),
    "tiny": ("🔬", "Miniature", "Réduire la fenêtre à moins de 300 pixels de large",
             "Rétrécis, rétrécis… jusqu'à ce que l'appli tienne dans un timbre.",
             "Fenêtre timbre-poste : l'appli tient encore debout, chapeau."),
    "giant": ("🏟️", "Cinéma", "Ouvrir l'appli sur un écran de plus de 2 500 pixels de large",
              "Un très, très grand écran : l'appli en version cinémascope.",
              "Écran géant : on voit les médailles depuis le fond de la salle."),
    "sudo": ("🧙", "Super-utilisateur", "Taper « sudo » au clavier, sans être dans un champ",
             "Un mot magique d'informaticien, qui donne (presque) tous les pouvoirs.",
             "Accès accordé. Avec un grand pouvoir…"),
    "hello": ("👋", "Poli", "Taper « bonjour » au clavier, sans être dans un champ",
              "Être poli avec une appli, ça ne coûte rien. Dis-le-lui au clavier.",
              "Bonjour à toi aussi ! Tu es la première personne à lui parler."),
    "rage": ("😤", "Furax", "Cliquer 15 fois au même endroit en 3 secondes",
             "Quand rien ne réagit, certains insistent… beaucoup.",
             "Quinze clics rageurs : la souris demande grâce."),
    "battery": ("🪫", "Sur la réserve", "Ouvrir l'appli avec moins de 5 % de batterie",
                "Il y a des priorités dans la vie, même quand la batterie tire la langue.",
                "Moins de 5 % de batterie, et c'est l'appli que tu ouvres. Respect."),
    "ping": ("🏓", "Ping-pong", "Taper « ping » au clavier, sans être dans un champ",
             "Les informaticiens vérifient qu'on les entend avec un petit mot de quatre lettres.",
             "Ping ? Pong ! La connexion est excellente."),
    "thanks": ("🙏", "Bien élevé", "Taper « merci » au clavier, sans être dans un champ",
               "Un petit mot que maman t'a appris, tapé au clavier.",
               "De rien, c'est un plaisir."),
    "xyzzy": ("🕳️", "Aventurier", "Taper « xyzzy » au clavier, sans être dans un champ",
              "Un mot magique des tout premiers jeux d'aventure, cinq lettres improbables.",
              "Rien ne se passe… sauf une médaille. Les anciens comprendront."),
    "help": ("🆘", "Au secours", "Taper « aide » au clavier, sans être dans un champ",
             "Quand on est perdu, on le dit tout simplement… sans viser de case.",
             "Personne ne viendra, mais tu as gagné une médaille."),
    "matrix": ("💊", "Pilule rouge", "Taper « matrix » au clavier, sans être dans un champ",
               "Un film culte, une pilule rouge, et un mot à taper.",
               "Tu as choisi la pilule rouge. Bienvenue dans le monde réel."),
    "lumos": ("🪄", "Lumos", "Taper « lumos » au clavier, sans être dans un champ",
              "Une formule de sorcier pour faire de la lumière.",
              "Ta baguette s'illumine. Dix points pour ta maison."),
    "hold_logo": ("🫳", "Main de fer", "Garder le doigt 3 secondes sur le logo",
                  "Le logo aime qu'on le tienne, longtemps, sans lâcher.",
                  "Trois secondes de poigne : le logo a senti ta détermination."),
    "select_all": ("🖍️", "Tout sélectionner", "Faire Ctrl+A (tout sélectionner) hors d'un champ",
                   "Un raccourci de bureau pour tout prendre d'un coup.",
                   "Tout est sélectionné. Et maintenant, qu'est-ce qu'on en fait ?"),
    "find": ("🕵️", "Détective", "Faire Ctrl+F (rechercher dans la page)",
             "Le raccourci des enquêteurs, celui qui cherche dans la page.",
             "L'enquête commence : rien n'échappe à ton œil."),
    "escape": ("🏃", "Évadé", "Appuyer 10 fois sur Échap en 5 secondes",
               "Il existe une touche pour fuir. Fuis vite, et souvent.",
               "Dix évasions en cinq secondes : aucune prison ne te retient."),
    "yoyo": ("🪀", "Yo-yo", "Aller tout en bas puis tout en haut d'une page, 3 fois en 20 secondes",
             "De haut en bas, de bas en haut, comme un jouet au bout d'une ficelle.",
             "Haut, bas, haut, bas : la page en a le mal de mer."),
    "right_click": ("🖱️", "Clic droit", "Faire 5 clics droits en 3 secondes",
                    "Ta souris a deux oreilles, et on n'en écoute qu'une.",
                    "Cinq clics droits : le menu caché n'a plus de secret pour toi."),
    "zoom": ("🔎", "Loupe", "Zoomer très fort dans l'appli (plus de 2 fois)",
             "Regarde l'appli de très, très près.",
             "On voit même les grains de filament."),
    "nap": ("😴", "Sieste", "Laisser l'appli ouverte 30 minutes sans y toucher",
            "Ouvre l'appli… et va faire autre chose. Longtemps.",
            "Trente minutes sans un geste : l'appli a fait la sieste avec toi."),
    "leet_time": ("👾", "Heure élite", "Ouvrir l'appli à 13 h 37",
                  "Une heure qui parle aux hackers, en début d'après-midi.",
                  "13:37 : l'heure des élites. Tu en es."),
    "wish": ("🌠", "Fais un vœu", "Ouvrir l'appli à 11 h 11",
             "Les étoiles filantes passent à une heure bien précise, avant le déjeuner.",
             "11:11, fais un vœu. Une impression sans échec ?"),
    "midnight_open": ("🕛", "Douze coups", "Ouvrir l'appli à minuit pile",
                      "Quand les douze coups sonnent, Cendrillon s'en va. Toi, tu ouvres l'appli.",
                      "Minuit pile : le carrosse est resté citrouille, mais toi tu es là."),
    "full_battery": ("🔋", "Plein d'énergie", "Ouvrir l'appli batterie pleine, branchée sur secteur",
                     "Gonflé à bloc, et toujours sous perfusion.",
                     "Batterie pleine à craquer. Toi aussi, on dirait."),
    "landscape": ("🌄", "Paysage", "Tourner le téléphone à l'horizontale, appli ouverte",
                  "Ton téléphone a envie de s'allonger.",
                  "Format paysage : l'appli prend ses aises."),
    "moonwalk": ("🕺", "Moonwalk", "Revenir en arrière 5 fois en 10 secondes",
                  "Le bouton retour, encore et encore, à reculons comme Michael.",
                  "Cinq pas en arrière en dix secondes. Hee-hee !"),
    "hide_seek": ("🙈", "Cache-cache", "Quitter et revenir sur l'appli 10 fois en 30 secondes",
                  "Je te vois, je ne te vois plus, je te vois…",
                  "Coucou, caché ! L'appli a fini par te trouver."),
    "drop": ("📦", "Livreur", "Glisser un fichier sur l'appli, hors d'une zone de dépôt",
             "L'appli accepte les colis… même là où on ne les attend pas.",
             "Colis livré ! Personne ne l'attendait, mais merci."),
    "paste": ("📎", "Colleur", "Coller du texte dans un champ de l'appli",
              "Ce que tu as copié, il faut bien le poser quelque part.",
              "Collé ! Le copier-coller n'a plus de secret pour toi."),
    "polyglot": ("🌍", "Polyglotte", "Ouvrir l'appli avec un navigateur réglé dans une autre langue que le français",
                 "L'appli parle français, mais ton navigateur, lui ?",
                 "Hello, hola, hallo : l'appli te répond quand même en français."),
    "anonymous": ("🎭", "Anonyme", "Ouvrir la page /anonymous",
                  "Le nom de l'appli cache un mot bien connu.",
                  "Nous sommes BambuNymous. Nous n'oublions pas la première couche."),
    "lockpick": ("🗝️", "Crocheteur", "Toucher 10 fois la médaille d'un secret pas encore gagné",
                 "Un cadenas, ça se force… à force d'insister.",
                 "Le verrou n'a pas cédé, mais tu as gagné le droit de recommencer."),
    # Fournee du 21/10/2026
    "benchy": ("🚤", "Moussaillon", "Taper « benchy » au clavier, sans être dans un champ",
               "Le petit bateau que toutes les imprimantes connaissent… ton clavier aussi devrait.",
               "Le Benchy a pris la mer : le test de calibration le plus célèbre du monde te salue."),
    "spaghetti": ("🍝", "Al dente", "Taper « spaghetti » au clavier, sans être dans un champ",
                  "La pire chose qui puisse sortir d'une buse… et aussi un plat italien.",
                  "Un plat de spaghettis, mais sans le plateau à nettoyer."),
    "iddqd": ("🛡️", "Mode dieu", "Taper « iddqd » au clavier, sans être dans un champ",
              "Un vieux code de jeu vidéo, celui qui rendait invincible dans les couloirs martiens.",
              "Invincible ! Même les bouchons de buse ne peuvent plus rien contre toi."),
    "coucou": ("🐦", "Coucou", "Taper « coucou » au clavier, sans être dans un champ",
               "Une horloge suisse l'appelle toutes les heures.",
               "Coucou ! L'appli te répond… à sa manière."),
    "buse": ("🦅", "Bec chaud", "Taper « buse » au clavier, sans être dans un champ",
             "C'est un rapace, et c'est aussi la pièce la plus chaude de ton imprimante.",
             "La buse, à 220 °C : ne touche pas, même pour voir."),
    "devtools": ("👨‍💻", "Sous le capot", "Appuyer sur F12",
                 "Les entrailles du navigateur s'ouvrent d'une seule touche.",
                 "Tu as soulevé le capot. Attention, ça chauffe là-dedans."),
    "save": ("💾", "Réflexe", "Faire Ctrl+S dans l'appli",
             "Un vieux réflexe de bureau, celui qui protège ton travail. Ici, tout s'enregistre déjà.",
             "Enregistré ! Enfin… ça l'était déjà, mais le geste compte."),
    "undo": ("⏪", "Retour vers le passé", "Faire Ctrl+Z 10 fois en 5 secondes, hors d'un champ",
             "Comme si tu voulais remonter le temps, encore et encore.",
             "Dix retours en arrière : la DeLorean n'a pas fait mieux."),
    "sticky": ("🧷", "Touches rémanentes", "Appuyer 5 fois sur Maj en 2 secondes",
               "Une touche, cinq fois de suite, et un vieux système s'inquiète pour toi.",
               "Cinq fois Maj : Windows t'aurait proposé ses touches rémanentes."),
    "tabber": ("⌨️", "Sans souris", "Appuyer 20 fois sur Tab en 10 secondes",
               "Qui a besoin d'une souris ? Saute d'un bouton à l'autre, vite.",
               "Vingt tabulations : tu navigues comme un pro du clavier."),
    "alt_f4": ("🚪", "Tentative d'évasion", "Faire Alt+F4 dans l'appli",
               "La combinaison qui ferme tout, celle qu'on fait faire aux naïfs.",
               "Bien essayé ! Tu es toujours là."),
    "time_1234": ("🔢", "Suite logique", "Ouvrir l'appli à 12 h 34",
                  "Une heure qui se compte sur les doigts : un, deux, trois, quatre.",
                  "12:34 : l'heure la plus ordonnée de la journée."),
    "time_2222": ("🦢", "Les cygnes", "Ouvrir l'appli à 22 h 22",
                  "Quatre fois le même chiffre, tard le soir.",
                  "22:22, quatre petits cygnes en rang sur l'horloge."),
    "time_314": ("🥧", "Heure de Pi", "Ouvrir l'appli à 3 h 14",
                 "Une heure qui ressemble à un nombre célèbre, en pleine nuit.",
                 "3:14 : l'heure de Pi. Tu es soit matheux, soit insomniaque."),
    "time_404": ("🫥", "Heure introuvable", "Ouvrir l'appli à 4 h 04",
                 "Une heure qui ressemble à une page qui n'existe pas.",
                 "4:04 : heure introuvable. Et pourtant, tu l'as trouvée."),
    "time_2359": ("⌛", "Juste à temps", "Ouvrir l'appli à 23 h 59",
                  "La dernière minute de la journée. Pas une de plus.",
                  "23:59 : tu as eu ta journée d'appli, de justesse."),
    "dawn": ("🌄", "Aube", "Ouvrir l'appli entre 5 h et 6 h du matin",
             "Avant même le premier café, quand le ciel rosit à peine.",
             "Debout avant le soleil : l'imprimante, elle, ne dort jamais."),
    "april_fool": ("🐟", "Poisson d'avril", "Ouvrir l'appli un 1er avril",
                   "Un jour où l'on colle des choses dans le dos des gens.",
                   "Ce succès n'est pas une blague. Enfin, presque."),
    "leap_open": ("🐸", "Jour bonus", "Ouvrir l'appli un 29 février",
                  "Un jour qui n'existe qu'une année sur quatre.",
                  "Un jour en plus dans l'année, et tu l'as passé avec nous."),
    "teapot": ("🫖", "Théière", "Ouvrir la page /teapot",
               "Un serveur qui se prend pour un ustensile de cuisine : la blague a même un numéro.",
               "« Je suis une théière » : la plus célèbre des erreurs pour rire. Thé ou café ?"),
    "rtfm": ("📖", "Lecteur assidu", "Ouvrir 5 fois les règles des succès en une minute",
             "Les règles, ça se lit. Et ça se relit. Et ça se relit encore…",
             "Cinq lectures des règles : tu es désormais le meilleur avocat des succès."),
    "console": ("🖥️", "Hacker", "Lancer bambunymous() dans la console du navigateur",
                "Ouvre les entrailles du navigateur : quelqu'un t'y a laissé un mot.",
                "Accès accordé. Bienvenue dans la salle des machines."),
    "marathon_session": ("🏃", "Veilleur", "Garder l'appli ouverte 3 heures d'affilée",
                         "Ouvre l'appli et… ne la ferme pas. Vraiment pas. Pendant longtemps.",
                         "Trois heures ouverte : l'appli a regardé toute une impression avec toi."),
    "sunglasses": ("😎", "Lunettes de soleil", "Utiliser le thème clair entre minuit et 5 h",
                   "En pleine nuit, choisis la lumière la plus éblouissante.",
                   "Thème clair à cette heure-ci ? Tu as mis tes lunettes de soleil, on espère."),
    "gamepad": ("🕹️", "Joueur", "Brancher une manette de jeu, appli ouverte",
                "L'appli a des allures de jeu. Elle reconnaît même une certaine manière de jouer.",
                "Une manette ? L'appli n'a pas de mode deux joueurs… pas encore."),
    "mouse_shake": ("🐭", "Souris agitée", "Agiter la souris de gauche à droite très vite",
                    "Quand on perd son curseur, on fait quoi ? On le secoue.",
                    "Le curseur a eu le tournis. Toi aussi, peut-être."),
    # Pages cachees (22/10/2026) : trouver l'adresse, puis y reussir quelque chose
    "h_matrice": ('🐇', 'Suis le lapin blanc', 'Sur la page /matrice, attraper le lapin blanc qui traverse',
        'Une pilule rouge, et le monde se met à pleuvoir en vert. Quelque chose de blanc y court très vite.',
        "Tu as suivi le lapin blanc. Le terrier est plus profond qu'il n'y paraît."),
    "h_quarante_deux": ('🧺', "N'oublie pas ta serviette", 'Sur la page /quarante-deux, attraper la serviette qui dérive',
        'La réponse à la grande question, écrite en toutes lettres, mène quelque part. Un objet indispensable y flotte.',
        'Un auto-stoppeur galactique sait toujours où est sa serviette. Toi aussi, maintenant.'),
    "h_benchy": ('⛵', 'Capitaine', 'Sur la page /benchy, hisser la voile du petit bateau',
        'Le bateau de toutes les imprimantes a son propre port. Aide-le à prendre le vent.',
        'Voile hissée, cap sur le prochain plateau. Le Benchy navigue enfin.'),
    "h_generique": ('🎬', 'Générique', "Sur la page /generique, rester jusqu'au mot FIN",
        "À la fin d'un film, les noms défilent. Ici aussi, si tu restes jusqu'au bout.",
        "Tu es resté jusqu'au bout du générique. Il n'y a pas de scène post-générique… ou si ?"),
    "h_neant": ('🔦', 'Explorateur du vide', 'Sur la page /neant, trouver la bobine cachée dans le noir',
        'Le rien a une adresse. Il y fait très noir : il te faudra de la lumière.',
        "Dans le noir complet, ta lampe a trouvé ce qui se cachait. Le néant n'est jamais vraiment vide."),
    "h_retro": ('📟', 'Rétro', 'Sur la page /retro, taper le bon mot de passe dans le terminal',
        'Retourne dans les années 80, sur un écran vert qui grésille. Le mot de passe est le nom de la maison.',
        'Accès autorisé, comme en 1984. Le curseur clignote encore de joie.'),
    "h_zen": ('🎋', 'Zen', 'Sur la page /zen, ratisser le sable 20 secondes',
        "Un jardin japonais attend quelqu'un de patient. Prends le râteau, respire.",
        'Le sable est lisse, le bambou a poussé, et toi aussi un peu.'),
    "h_disco": ('🪩', 'Fièvre du samedi soir', 'Sur la page /disco, lancer la fête sur la boule à facettes',
        "Une boule qui renvoie la lumière dans tous les sens attend qu'on la secoue un peu.",
        "La piste s'allume, la boule tourne : la fête est lancée, et l'imprimante danse."),
    "h_envers": ('🙃', "L'Envers", "Sur la page /envers, écrire BAMBU avec les ampoules de l'alphabet",
        "Un monde retourné, une guirlande au-dessus d'un alphabet peint. Fais-lui épeler le nom de la maison.",
        "Les ampoules ont parlé. Dans l'Envers, on t'a entendu."),
    "h_cafe": ('☕', 'Têtu', "Sur la page /cafe, insister jusqu'à obtenir un café",
        "Après la théière, sa cousine. Elle refuse… mais on finit toujours par l'avoir à l'usure.",
        'Dix demandes, un café. La machine a cédé : la persévérance paie toujours.'),
    "h_labo": ('🧪', 'Savant fou', 'Sur la page /labo, verser les bonnes fioles dans le bon ordre',
        'Un laboratoire secret, des fioles qui bouillonnent, et une formule au tableau. Lis-la bien.',
        "La potion a explosé en paillettes. C'était la bonne formule : mwahaha."),
    "h_musee": ('🖼️', 'Mécène', 'Sur la page /musee, contempler chacun des tableaux',
        "Une galerie de chefs-d'œuvre en filament t'attend. Ne passe à côté d'aucun.",
        'Tu as lu chaque cartel. Le conservateur du musée te salue bien bas.'),
    "h_horloge": ('🕰️', 'Maître du temps', "Sur la page /horloge, arrêter l'aiguille pile sur midi",
        "Une horloge qui tourne à l'envers. Arrête-la au sommet, ni avant, ni après.",
        "Pile à midi. Le temps s'est arrêté, juste pour toi."),
    "h_aquarium": ('🐠', 'Soigneur', 'Sur la page /aquarium, nourrir les poissons dix fois',
        'Des poissons tournent en rond dans leur bocal. Ils ont faim.',
        'Les poissons ont le ventre plein de filament. Ils te remercient en faisant des bulles.'),
    "h_neige": ('⛄', 'Bonhomme de neige', 'Sur la page /neige, construire le bonhomme de neige',
        "Là où il neige toujours, il manque quelqu'un avec une carotte.",
        'Trois boules, une carotte et une bobine en guise de chapeau : il est magnifique.'),
    "h_volcan": ('🌋', 'Éruption', "Sur la page /volcan, faire monter la pression jusqu'à l'éruption",
        "Une montagne qui fume, et une pression qui ne demande qu'à monter.",
        "Boum ! La lave coule à flots. Heureusement, ce n'est que du PLA rouge."),
    "h_buse_volante": ('🐦', 'Buse volante', 'Sur la page /buse-volante, passer 10 colonnes de bobines',
        "Un oiseau célèbre, mais ici c'est une buse qui bat des ailes entre les bobines.",
        "Dix colonnes passées sans un accroc. Le roi du battement d'ailes, c'est toi."),
    "h_super_bambu": ('🍄', 'Super Bambu', 'Sur la page /super-bambu, ramasser 20 pièces',
        'Un plombier moustachu aurait adoré ce niveau. Saute, cours, ramasse tout ce qui brille.',
        'Vingt pièces dans la poche ! Ta princesse est dans un autre plateau.'),
    "h_serpent": ('🐍', 'Serpent', 'Sur la page /serpent, atteindre une longueur de 15',
        "Un vieux jeu de téléphone : un serpent qui s'allonge à chaque bouchée.",
        "Quinze segments de filament arc-en-ciel. Un serpent digne d'un vieux Nokia."),
    "h_casse_briques": ('🧱', 'Casse-briques', 'Sur la page /casse-briques, casser toutes les briques',
        'Une raquette, une balle, un mur. Le mur doit tomber.',
        "Plus une brique debout. Le mur est tombé, comme à la grande époque des salles d'arcade."),
    "h_taupe": ('🔨', 'Tape-taupe', 'Sur la page /taupe, marquer 15 points en une partie',
        'Des bobines sortent de leurs trous. Tape vite, tape juste.',
        'Quinze bobines tapées : les taupes de la fête foraine tremblent encore.'),
    "h_tour": ('🏗️', 'Bâtisseur', 'Sur la page /tour, empiler 10 étages',
        'Couche après couche, comme une impression. Lâche au bon moment.',
        "Dix étages bien droits. Même une imprimante n'aurait pas fait mieux."),
    "h_dragon": ('🐉', 'Dresseur de dragon', 'Sur la page /dragon, réveiller le dragon et brûler 10 chevaliers',
        'Une grotte, un dragon qui ronfle, des chevaliers en plastique qui approchent.',
        "Dix chevaliers fondus. Le dragon t'a adopté : il ne crache plus que pour toi."),
    "h_ovni": ('🛸', "Chasseur d'ovnis", 'Sur la page /ovni, abattre 10 soucoupes en 30 secondes',
        'Ils sont là-haut, et ils passent vite. La vérité est ailleurs, mais les soucoupes sont ici.',
        "Dix soucoupes en paillettes. L'invasion attendra."),
    "h_fusee": ('🚀', 'Décollage', 'Sur la page /fusee, appuyer sur Décollage pile à zéro',
        'Dix, neuf, huit… Il faut appuyer au bon moment, pas une seconde de trop.',
        "Décollage parfait. Houston, nous n'avons aucun problème."),
    "h_bulles": ('🫧', 'Pop !', 'Sur la page /bulles, éclater 50 bulles',
        "Des bulles de savon montent au ciel. Elles ne demandent qu'à éclater.",
        "Cinquante pops. Le papier bulle n'a qu'à bien se tenir."),
    "h_feux": ('🎆', 'Artificier', "Sur la page /feux, lancer 20 feux d'artifice",
        "Une ville la nuit, un ciel vide : c'est à toi de l'illuminer.",
        "Vingt fusées et un bouquet final. Le 14 juillet n'a qu'à bien se tenir."),
    "h_reflexe": ('⚡', 'Réflexes', 'Sur la page /reflexe, réagir en moins de 300 ms',
        "Rouge… rouge… VERT ! Il faut être plus rapide que l'éclair.",
        "Moins de 300 millisecondes : tes réflexes sont dignes d'un pilote de course."),
    "h_bambulab": ('🏭', 'Hommage', "Sur la page /bambulab, regarder l'impression jusqu'à 100 %",
        "La maison qui fabrique ta machine a sa page. Regarde-la travailler jusqu'au bout.",
        "100 %. La porte s'ouvre sur un petit Benchy tout chaud. Merci, la machine."),
    "h_pilule": ('💊', 'Le choix', 'Sur la page /pilule, choisir la pilule rouge',
        'Deux pilules, deux couleurs, deux mondes. Un seul mène au terrier.',
        'Tu as choisi la rouge. Bienvenue dans le monde réel.'),
    "h_coffre": ('🔐', 'Perceur de coffre', 'Sur la page /coffre, trouver le code du coffre-fort',
        'Un coffre-fort, un bureau en désordre, des post-it partout. Le code pèse son poids.',
        "Clic, clac : le coffre s'ouvre. Les post-it, c'est vraiment une mauvaise idée."),
    "h_labyrinthe": ('🧭', 'Labyrinthe', "Sur la page /labyrinthe, mener la buse jusqu'à la sortie",
        'Des couloirs, des impasses, et une bobine dorée tout au bout.',
        'Sortie trouvée ! Thésée aurait apprécié ton fil… de filament.'),
    "h_memoire": ('🃏', "Mémoire d'éléphant", 'Sur la page /memoire, retrouver toutes les paires',
        'Des cartes retournées, des bobines par paires. Souviens-toi de ce que tu as vu.',
        'Toutes les paires trouvées. Ta mémoire vaut un disque dur.'),
    "h_morpion": ('⭕', 'Imbattable', "Sur la page /morpion, tenir le match nul face à l'ordinateur",
        'Trois en ligne contre une machine qui ne perd jamais. Ne la laisse pas gagner.',
        "Match nul contre une intelligence imbattable. C'est presque une victoire."),
    "h_simon": ('🔴', 'Jacques a dit', 'Sur la page /simon, reproduire une séquence de 6',
        'Quatre couleurs qui chantent, et une mémoire à toute épreuve.',
        "Six couleurs dans l'ordre. Simon peut aller se rhabiller."),
    "h_pendu": ('🪢', 'Le pendu', 'Sur la page /pendu, trouver le mot',
        'Des tirets, des lettres, et un plat de spaghetti qui se construit si tu te trompes.',
        'Le mot est trouvé avant le dernier spaghetti. Bien joué, linguiste.'),
    "h_calcul": ('🧮', 'Calculatrice humaine', 'Sur la page /calcul, réussir 10 calculs en 30 secondes',
        'Un chronomètre, des opérations, et pas de calculatrice.',
        'Dix calculs justes au chrono. Ta tête vaut un processeur.'),
    "h_piano": ('🎹', 'Virtuose', 'Sur la page /piano, jouer « Au clair de la lune »',
        'Un clavier, une partition, une chanson que tout le monde connaît.',
        'Au clair de la lune, mon ami Pierrot… ton imprimante a applaudi.'),
    "h_etoiles": ('✨', 'Astronome', "Sur la page /etoiles, relier les étoiles dans l'ordre",
        'Un ciel de nuit, des étoiles numérotées. Relie-les, une forme apparaîtra.',
        "La constellation s'illumine. Les astronomes l'appelleront « la Grande Bobine »."),
    "h_chat": ('🐈', 'Ronron', 'Sur la page /chat, caresser le chat endormi',
        'Un chat dort sur une machine bien chaude. Il ne dirait pas non à une caresse… longue.',
        "Ronron… Le chat t'a adopté. Il ne quittera plus jamais ton plateau chauffant."),
    "h_tresor": ('🗺️', 'Chasseur de trésor', 'Sur la page /tresor, trouver le trésor en 10 coups',
        'Une vieille carte, une grille, et un X invisible. Écoute : chaud ou froid ?',
        "Le coffre est déterré ! Des pièces d'or… et une bobine de soie dorée."),
    "h_des": ('🎲', 'Double six', 'Sur la page /des, faire un double six',
        "Deux dés sur un tapis vert. Le plus beau lancer, c'est quand ils se ressemblent.",
        'Double six ! La chance sourit aux imprimeurs.'),
    "h_pile_ou_face": ('🪙', 'Chanceux', "Sur la page /pile-ou-face, faire 5 piles d'affilée",
        "Une pièce frappée d'une bobine. Lance-la, encore et encore, du même côté.",
        'Cinq fois de suite le même côté. Les probabilités sont tes amies.'),
    "h_morse": ('📡', 'Télégraphiste', 'Sur la page /morse, déchiffrer le mot clignoté',
        'Un phare clignote : long, court, long… Il dit quelque chose. Écris-le.',
        "Message reçu et décodé. Les télégraphistes d'antan seraient fiers."),
    "h_taquin": ('🧩', 'Taquin', "Sur la page /taquin, reconstituer l'image",
        'Huit carreaux, une case vide, et une image toute mélangée.',
        "Image reconstituée ! Le taquin n'a plus de secret pour toi."),
    "h_bobine": ('🧵', 'Dérouleur', 'Sur la page /bobine, dévider entièrement la bobine géante',
        'Une bobine géante à vider… en la faisant tourner, encore et encore.',
        'Bobine vide ! Un kilomètre de filament au sol. Bon courage pour le ranger.'),
    "h_lune": ('🌗', 'Lunatique', 'Sur la page /lune, reconnaître la phase de la lune du jour',
        "Lève les yeux ce soir : la lune n'a pas toujours la même tête. Laquelle aujourd'hui ?",
        'Bonne phase ! Tu sais lire le ciel comme un vieux marin.'),
    "h_pluie": ('☂️', 'Au sec', "Sur la page /pluie, rester à l'abri de la pluie 15 secondes",
        "Il pleut des cordes. Un parapluie, et beaucoup d'agilité.",
        "Quinze secondes au sec sous l'averse. Le filament, lui, déteste l'humidité."),
    # Farces (22/10/2026) : l'accueil a une adresse secrete ou il lui arrive quelque chose
    "p_tsunami": ('🌊', 'Raz-de-marée', 'Ouvrir /tsunami et survivre à la vague',
        "Une vague géante venue du Japon porte un nom bien connu. Ton accueil aimerait la voir passer.",
        "La vague est passée, l'accueil est trempé mais debout. Heureusement, le PLA ne craint pas l'eau."),
    "p_seisme": ('\U0001fae8', 'Secousse', 'Ouvrir /seisme et attendre que la terre se calme',
        'Quand la terre tremble, les spécialistes ont un mot pour ça. Ton accueil aussi.',
        "Magnitude 9 sur l'échelle de Richter. Le plateau n'a pas bougé, lui."),
    "p_tete_en_bas": ('🙃', 'Cul par-dessus tête', "Ouvrir /tete-en-bas et remettre la page à l'endroit",
        "L'accueil, mais vu par une chauve-souris.",
        "Remis à l'endroit ! Le sang redescend doucement de ta tête."),
    "p_panne": ('💡', 'Électricien', "Ouvrir /panne et trouver l'interrupteur dans le noir",
        "Coupure de courant à l'atelier : il faut trouver de quoi rallumer.",
        "Lumière ! L'interrupteur était bien caché, mais pas pour toi."),
    "p_melange": ('🔀', 'Anagramme', 'Ouvrir /melange et attendre que les lettres retrouvent leur place',
        "Quand les lettres d'un mot changent de place, tout se brouille… le temps qu'elles reviennent.",
        'Les lettres ont retrouvé leur place. Plus personne ne lit « Bmabu Nmyuos ».'),
    "p_gravite": ('🍎', 'Newton', 'Ouvrir /gravite et voir les cartes tomber puis remonter',
        "Une pomme est tombée sur la tête d'un savant. Sur ton accueil, ce sont les cartes.",
        'Tout est tombé, tout est remonté. Isaac Newton prend des notes.'),
    "p_miroir": ('🪞', "De l'autre côté", 'Ouvrir /miroir et traverser le reflet',
        "Alice est passée de l'autre côté de quelque chose. Ton accueil aussi peut le faire.",
        "La page s'est regardée dans la glace. Elle s'est trouvée plutôt jolie."),
    "p_blizzard": ('🌨️', 'Chasse-neige', 'Ouvrir /blizzard et déneiger la page',
        "Une tempête de neige s'abat sur l'accueil. Prends ta pelle… ou ton doigt.",
        "Page déneigée ! Le PLA, lui, n'aime pas trop le froid."),
    "p_brouillard": ('🌫️', 'Dans la purée de pois', 'Ouvrir /brouillard et dissiper la brume',
        "On n'y voit rien, comme un matin de novembre. Chasse-le.",
        "Le brouillard s'est levé. On revoit les bobines."),
    "p_fete": ('🎉', 'Fêtard', "Ouvrir /fete et danser avec l'accueil",
        "L'accueil a envie de faire la fête. Sors les cotillons.",
        'Les cotillons sont rangés, la piste est vide. Quelle soirée !'),
    "p_tornade": ('🌪️', 'Chasseur de tempête', "Ouvrir /tornade et voir l'accueil s'envoler",
        'Un tourbillon de vent qui emporte tout sur son passage, Dorothée en sait quelque chose.',
        "Tout s'est envolé et tout est retombé à sa place. Le Kansas peut dormir tranquille."),
    "p_aimant": ('🧲', 'Magnétique', 'Ouvrir /aimant et attirer les cartes',
        "Tu as un pouvoir d'attraction. Les cartes de ton accueil ne demandent qu'à te suivre.",
        'Les cartes te suivaient comme de la limaille. Tu es irrésistible.'),
    "p_fantome": ('👻', 'Chasseur de fantômes', 'Ouvrir /fantome et chasser les fantômes',
        "Bouh ! Des draps blancs flottent sur l'accueil. Chasse-les.",
        'Les fantômes ont fui. Qui tu vas appeler ? Personne, tu as tout fait seul.'),
    "p_pixel": ('👾', 'Connexion 56k', 'Ouvrir /pixel et attendre que la page se charge',
        'Ton accueil, mais en très gros carreaux, comme au temps des vieux modems.',
        'Image enfin nette. On entend presque le bruit du modem.'),
    "p_vieux_film": ('🎞️', 'Cinéma muet', "Ouvrir /vieux-film et regarder le film d'époque",
        "L'accueil en noir et blanc, comme au temps de Charlot, avec du grain et des rayures.",
        "Fin du film muet. Les couleurs sont revenues, et le son… ne l'a jamais quitté."),
    "p_glitch": ('📺', 'Bug', 'Ouvrir /glitch et attendre la réparation',
        "Un bug spectaculaire, des couleurs qui se décalent… puis tout se répare.",
        "Couche retrouvée, bug réparé. Ce n'était qu'une fausse alerte."),
    "p_toile": ('🕷️', 'Arachnophobe', "Ouvrir /toile et chasser l'araignée",
        "Les coins de l'accueil se couvrent de soie. Il y a quelqu'un au bout du fil.",
        "L'araignée est remontée dans son coin. Elle t'en veut un peu."),
    "p_apesanteur": ('🧑\u200d🚀', 'Astronaute', 'Ouvrir /apesanteur et flotter avec les cartes',
        "Là-haut, plus rien ne pèse. L'accueil aimerait essayer.",
        'Retour sur Terre en douceur. Les cartes ont adoré flotter.'),
    "p_vent": ('🍃', 'Coup de vent', 'Ouvrir /vent et tenir bon',
        "Ça souffle fort aujourd'hui. Les feuilles et les cartes ne tiennent plus en place.",
        'Le vent est tombé. Ramasse les feuilles, les cartes sont rentrées seules.'),
    "p_ecran_bleu": ('🟦', 'Redémarrage', 'Ouvrir /ecran-bleu et redémarrer',
        "Une couleur d'écran que tous les utilisateurs de Windows redoutent.",
        "Redémarrage réussi. Ce n'était qu'un spaghetti, rien de grave."),
    "p_fourmis": ('🐜', 'Fourmilière', 'Ouvrir /fourmis et voir les lettres partir et revenir',
        'Une colonne de petites travailleuses a repéré les lettres de ton accueil.',
        'Les fourmis ont tout rapporté. Pas une lettre ne manque.'),
    "p_canicule": ('🥵', 'Coup de chaud', "Ouvrir /canicule et laisser l'accueil fondre",
        "Quand le thermomètre s'affole en été, l'accueil fond comme un PLA à 200 °C.",
        "Le ventilateur a tout refroidi. L'accueil a retrouvé sa forme."),
    "p_papier": ('📃', 'Boule de papier', 'Ouvrir /papier et voir la page se froisser',
        "L'accueil n'est qu'une feuille, après tout. Une feuille, ça se froisse.",
        'Dépliée et lissée. Pas une pliure ne se voit.'),
    "p_loupe": ('🔍', 'Myope', 'Ouvrir /loupe et trouver le mot écrit en tout petit',
        "Sherlock Holmes ne sortait jamais sans elle. Un mot minuscule t'attend.",
        'Trouvé ! « coucou », écrit en caractères de fourmi.'),
    "p_escargot": ('🐌', 'Ralenti', "Ouvrir /escargot et patienter jusqu'au bout",
        'Un animal célèbre pour sa lenteur ralentit tout sur son passage.',
        "L'escargot est passé. Il a mis le temps, mais il est arrivé."),
    "p_aspirateur": ('🌀', 'Ménage', 'Ouvrir /aspirateur et voir les cartes aspirées',
        "Un appareil ménager affamé avale tout ce qui traîne sur l'accueil.",
        'Burp ! Tout a été recraché à sa place. Merci pour le ménage.'),
    "p_bulle": ('🫧', 'Dans sa bulle', 'Ouvrir /bulle et faire éclater la bulle',
        "Être dans sa bulle, c'est agréable. Mais il faut bien en sortir un jour.",
        "Pop ! La bulle a éclaté, l'accueil est revenu sur terre."),
    "p_taches": ('🎨', 'Grand nettoyage', 'Ouvrir /taches et essuyer toutes les taches',
        "Quelqu'un a renversé de la peinture sur l'écran. Un coup de chiffon s'impose.",
        'Écran impeccable ! Plus une tache, plus une trace de doigt.'),
    "p_domino": ('🁢', 'Effet domino', 'Ouvrir /domino et voir les cartes tomber à la chaîne',
        'Une chute en entraîne une autre, puis une autre…',
        'Toutes tombées, toutes relevées. Un record du monde en puissance.'),
    "p_ombre": ('🌗', 'Cadran solaire', 'Ouvrir /ombre et voir une journée passer',
        'Le soleil tourne autour de ton accueil, et chaque carte projette son ombre.',
        'Du matin au soir, puis la nuit, puis le jour revient. Une journée en neuf secondes.'),
    "p_puzzle": ('🧩', 'Accueil en kit', "Ouvrir /puzzle et remettre dans l'ordre les 9 morceaux de l'accueil (les glisser, ou toucher deux pièces pour les échanger).",
        'Neuf morceaux, une seule image : le slicer a tranché un peu trop large.',
        "Recollé sans une goutte de colle : même le slicer n'y voit que du feu."),
    "p_rideau": ('🎭', 'Entracte forcé', 'Ouvrir /rideau et tirer le cordon doré vers le bas pour rouvrir le rideau.',
        "Au théâtre, quand le velours rouge tombe, il suffit d'un pompon pour relancer le spectacle.",
        'Lever de rideau ! Le public (toi) acclame le plateau chauffant.'),
    "p_cadenas": ('🔒', 'Sous clé', "Ouvrir /cadenas, trouver la petite clé cachée dans un coin d'une carte (elle apparaît quand on passe dessus) et la glisser sur le cadenas.",
        "Ce qui ferme à double tour s'ouvre avec ce qu'on cache sous le paillasson.",
        'Clic ! Déverrouillé. La prochaine fois, ne range pas la clé dans la page.'),
    "p_ballons": ('🎈', 'Décollage imprévu', 'Ouvrir /ballons et percer tous les ballons pour que les cartes retombent à leur place.',
        "Ce qui s'envole à l'hélium redescend d'un seul coup d'épingle.",
        'Tout le monde a atterri. Joyeux non-anniversaire, le plateau !'),
    "p_cache_cache": ('🏃', 'Le bouton fuyard', "Ouvrir /cache-cache et poursuivre le bouton « Remettre en ordre » jusqu'à ce qu'il fatigue, puis cliquer dessus.",
        'Un, deux, trois… le bouton se cache ! Celui qui ne court plus se laisse toujours attraper.',
        "Attrapé à bout de souffle ! Il a tout rangé, puis il est allé s'allonger."),
    "p_gomme": ('✏️', 'Feutre effaçable', "Ouvrir /gomme et frotter l'écran pour effacer au moins 75 % des gribouillis.",
        'Ce que le feutre a sali, le rose et le bleu le rendent propre.',
        'Propre comme un plateau neuf. Le petit dessinateur est prié de rendre ses feutres.'),
    "p_serrure": ('🗝️', 'Par le trou de la serrure', 'Ouvrir /serrure, chercher la clé dans le noir en promenant le trou de serrure, puis la rapporter à la serrure dorée.',
        "Quand on ne voit plus que par l'œil d'une porte, la solution brille quelque part dans le noir.",
        'Porte ouverte ! Et promis, personne ne regardait par le trou.'),
    "p_carte_a_gratter": ('🎟️', 'Méga Bobine', 'Ouvrir /carte-a-gratter et gratter les trois cases du ticket pour révéler les trois bobines identiques.',
        "Au tabac de l'atelier, trois fois la même bobine et le gros lot est pour toi.",
        "Gagné ! Le lot : ton accueil, rendu en parfait état. Pas de quoi payer l'impôt."),
    "p_radar": ('📡', 'Objet non identifié', 'Ouvrir /radar et toucher trois fois le point vert au moment où il clignote sous le balayage.',
        "Sur l'écran vert, ce qui ne s'allume qu'au passage du balai se verrouille du bout du doigt.",
        "Cible identifiée : un Benchy égaré. L'alerte est levée, le café peut chauffer."),
    "p_ascenseur": ('🛗', 'Ascenseur emballé', "Ouvrir /ascenseur et appuyer sur le bouton 0 pour ramener l'accueil au rez-de-chaussée.",
        "Les étages défilent, les blagues aussi ; l'atelier, lui, n'a jamais quitté le plancher des vaches.",
        "Ding ! Rez-de-chaussée. Le liftier te remercie d'avoir lu le panneau."),
    "p_aimant_inverse": ('🧲', 'Pôles contraires', "Ouvrir /aimant-inverse et pousser une carte (elles fuient le pointeur) jusqu'à la coincer dans un coin de l'écran, quelques instants.",
        'Ce qui te fuit finit toujours dans un coin, à condition de bien choisir de quel côté on arrive.',
        'Coincée ! Les autres ont compris et se sont calmées. Polarité rétablie.'),
    "p_sablier": ('⏳', 'Grain de sable', "Ouvrir /sablier et faire pivoter le sablier d'un demi-tour (glisser en rond dessus) pour faire remonter le sable.",
        "Le temps qui ensevelit se rembobine d'un demi-tour de poignet.",
        'Le sable remonte, le temps aussi : ton accueil a rajeuni de trente secondes.'),
    "p_peche": ('🎣', 'Pêche au gros', "Ouvrir /peche, placer l'hameçon sur une carte qui nage et ferrer (clic, ou lâcher le doigt), trois fois.",
        'Quand les cartes ont des nageoires, il faut une ligne, de la patience et trois prises.',
        "Belle pêche ! L'eau se retire. Pense quand même à sécher ton filament."),
    "p_digicode": ('🔢', "Code d'accès", "Ouvrir /digicode, repérer les quatre petits chiffres colorés cachés dans les cartes et les taper dans l'ordre des couleurs du clavier.",
        'Le code est sous ton nez, en tout petit, et chaque couleur sait où elle doit se ranger.',
        "Bzzt, clac ! Accès autorisé. Le concierge te fait un clin d'œil."),
    "p_souris": ('🐭', 'Petite grignoteuse', "Ouvrir /souris et soulever les cartes (les toucher) jusqu'à trouver celle sous laquelle la souris grignote.",
        "Là où tombent les miettes, quelqu'un fait crunch. Mais elle déménage, la coquine.",
        'Débusquée ! Elle file avec un bout de PLA. Bon appétit, petite.'),
    "p_interrupteurs": ('💡', 'Câblage créatif', 'Ouvrir /interrupteurs et allumer les neuf ampoules du tableau (chaque ampoule touchée bascule aussi ses voisines).',
        'Neuf lumières, un électricien distrait : chacune emporte ses voisines dans sa bascule.',
        "Lumière ! L'électricien peut rentrer chez lui, la facture est dans le tiroir."),
    "p_boussole": ('🧭', 'Perte du nord', "Ouvrir /boussole et faire tourner la boussole en glissant en rond jusqu'à ce que le N pointe vers le haut.",
        "Quand tout penche, une aiguille rouge qui regarde le ciel remet les choses d'aplomb.",
        "Cap au nord ! L'accueil se redresse, et toi tu ne t'es pas perdu."),
    "p_cles": ('🔑', 'Le bon trousseau', "Ouvrir /cles et essayer les clés du trousseau une à une jusqu'à trouver celle qui ouvre la porte.",
        "Six têtes de couleur pendent à l'anneau ; la bonne est toujours la dernière qu'on essaie.",
        'Clac clac ! Porte ouverte. Les clés tordues iront à la boîte à souvenirs.'),
    "p_bombe": ('💣', 'Bombe à paillettes', "Ouvrir /bombe, lire le post-it collé sur une carte et couper le seul fil qu'il n'interdit pas avant la fin du compte à rebours.",
        'Un mot laissé sur la page en dit plus que le chronomètre : élimine, et coupe ce qui reste.',
        "Désamorcée ! Pas une paillette au sol. Le démineur de l'atelier, c'est toi."),
    "p_demineur": ('🚩', 'Champ de buses', 'Ouvrir /demineur et découvrir toutes les cases sûres de la grille 5×5 sans tomber sur une des 4 mines (une explosion relance une partie).',
        'Cinq sur cinq, quatre surprises, et des chiffres qui ne mentent jamais.',
        "Terrain déminé ! Tu peux reposer le plateau, il n'a pas sauté."),
    "p_jardin": ('🌿', "Jungle à l'atelier", "Ouvrir /jardin et toucher chacune des dix lianes pour les tailler avant qu'elles envahissent tout.",
        "Ce qui grimpe sur tes cartes se raisonne d'un coup de sécateur, dix fois.",
        "Jardin taillé au cordeau. Le PLA est biosourcé, mais ce n'est pas une raison."),
    "p_cible": ('🎯', 'Tir aux pigeons', "Ouvrir /cible et toucher cinq fois la cible qui se promène sur l'accueil (elle accélère à chaque coup).",
        "Rouge et blanc, elle danse et file plus vite à chaque fléchette : cinq fois, et elle s'en va.",
        "Cinq sur cinq ! Une précision digne d'une buse de 0,2 mm."),
    "p_bouchon": ('🧶', 'Buse bouchée', "Ouvrir /bouchon, attraper le bout de filament qui pend sous le bouchon et le tirer bien vers le bas jusqu'au « pop ».",
        "Quand plus rien ne défile, c'est que le filament fait des nœuds là-haut : il faut tirer le bon bout.",
        'Pop ! Ça circule à nouveau. Pense à faire un cold pull de temps en temps.'),
    "showcase": ("🏛️", "Conservateur", "Ouvrir sa vitrine de médailles",
                 "Un musée n'a de sens que si l'on pousse sa porte. Le tien a des étagères de verre.",
                 "Bienvenue au musée : chaque médaille y a sa place, sous le verre et la lumière."),
    "leet_input": ("🕶️", "1337", "Taper « 1337 » dans un champ de l'appli",
                   "Le nombre que les hackers lisent comme un mot.",
                   "1337 : tu parles couramment le langage des hackers."),
}
# Lot du 21/10/2026 (seuils dans TIER_TABLE)
CATALOG += [
    _a("dry_hours", "filaments", "⏲️", "Étuve", "{n} h de séchage lancées dans l'AMS", [1], unit="h"),
    _a("official", "filaments", "🏷️", "Officiel", "{n} filaments reliés au catalogue Bambu (profil et code couleur)", [1]),
    _a("auto_found", "filaments", "🤖", "Reconnu d'office", "{n} bobines reconnues toutes seules (RFID, profil ou couleur)", [1]),
    _a("weighings", "filaments", "⚖️", "Peseur", "{n} bobines pesées", [1]),
    _a("tray_fixes", "filaments", "🛠️", "Rectificateur", "{n} emplacements de l'AMS corrigés à la main", [1]),
    _a("to_order", "filaments", "🛒", "Liste de courses", "{n} filaments à commander en même temps", [1]),
    _a("five_star", "mw", "⭐", "Cinq étoiles", "{n} évaluations MakerWorld à 5 étoiles", [1]),
    _a("rating_photos", "mw", "📸", "Reporter", "{n} évaluations MakerWorld avec photos", [1]),
    _a("long_reviews", "mw", "🖋️", "Plume", "{n} évaluations MakerWorld de plus de 100 caractères", [1]),
    _a("mw_income", "mw", "💰", "Rentier", "{n} points MakerWorld gagnés depuis toujours", [1], unit="pts"),
    _a("mw_best_day", "mw", "📈", "Jour de gloire", "{n} points MakerWorld gagnés en un seul jour", [1], unit="pts"),
    _a("mw_points_streak", "mw", "🔥", "Sur la lancée", "{n} jours d'affilée avec des points MakerWorld", [1], unit="j"),
    _a("planned", "mw", "📋", "Planificateur", "{n} modèles retenus pour « À faire » (profil choisi)", [1]),
    _a("queue_done", "mw", "✅", "Rayé de la liste", "{n} modèles de « À faire » imprimés ensuite", [1]),
    _a("good_seller", "objects", "💹", "Bon vendeur", "{n} objets vendus au-dessus du prix voulu", [1]),
    _a("unlucky", "objects", "🩹", "Pas de chance", "{n} objets indisponibles (cassés, perdus…)", [1]),
    _a("restocks", "objects", "📦", "Réassort", "{n} réassorts d'accessoires", [1]),
    _a("acc_images", "objects", "🖼️", "Catalogue illustré", "{n} accessoires avec une image", [1]),
    _a("saved", "prints", "💡", "Économe", "{n} € économisés sur le prix normal du filament", [1], unit="€", money=True),
    _a("electric", "prints", "⚡", "Électrique", "{n} € d'électricité consommés", [1], unit="€", money=True),
    _a("to_redo", "prints", "🔁", "À refaire", "{n} impressions marquées « à refaire »", [1]),
    _a("mw_detective", "prints", "🔗", "Détective", "{n} impressions reliées à la main à leur modèle MakerWorld", [1]),
    _a("full_report", "photos", "🎞️", "Reportage complet", "{n} impressions avec les 5 photos automatiques", [1]),
    _a("bunker", "app", "🔐", "Bunker", "La double authentification activée", [1],
       lore="Mot de passe et code à usage unique : ta porte a deux serrures."),
    _a("pwd_changes", "app", "🔑", "Prudent", "Un mot de passe changé", [1],
       lore="Nouveau mot de passe : les vieilles clés ne rentrent plus dans la serrure."),
    _a("devices", "app", "📱", "Nomade", "{n} appareils différents connectés", [1]),
    _a("friend_visits_in", "social", "👀", "Bonne adresse", "{n} pages vues chez toi par tes copains", [1]),
    _a("host_days", "social", "🏠", "Hôte", "{n} jours avec la visite d'un copain", [1], unit="j"),
    _a("friend_visits_out", "social", "🚪", "Globe-trotter", "{n} pages vues chez tes copains", [1]),
    _a("visitor_days", "social", "🗓️", "Voisin assidu", "{n} jours où tu es passé chez un copain", [1], unit="j"),
    _a("sauna", "secret", "🧖", "Sauna", "Un séchage de plus de 12 h", [1],
       lore="Plus de douze heures au chaud : tes bobines sortent du hammam, sèches comme jamais."),
    _a("harsh", "secret", "🙃", "Sévère", "Une évaluation MakerWorld à une seule étoile", [1],
       lore="Une étoile, pas une de plus. Il faut bien que quelqu'un dise les choses."),
    _a("recycled", "secret", "🧾", "Recyclé", "Une évaluation publiée avec un de tes messages types", [1],
       lore="Un message tout prêt, envoyé tel quel. Pourquoi réécrire ce qui est déjà bien dit ?"),
    _a("night_owl_visit", "secret", "🌙", "Visite nocturne", "Passer chez un copain entre minuit et 5 h", [1],
       lore="Tout le monde dort, sauf toi : tu jettes un œil chez les copains en pleine nuit."),
    _a("mutual_visit", "secret", "🤝", "Coup de foudre", "Un copain passe chez toi le jour où tu passes chez lui", [1],
       lore="Le même jour, chacun chez l'autre : ça s'appelle une amitié réciproque."),
    _a("share_all", "secret", "🧩", "Tout partagé", "Partager une impression et un groupe d'impressions", [1],
       lore="Une impression, puis tout un groupe : tes copains de Telegram ont tout vu."),
    # Fournee du 21/10/2026 (bis) : photos, modeles celebres, gestes dans l'appli
    _a("black_photo", "secret", "🌑", "Black-out", "Ajouter une photo presque entièrement noire", [1],
       lore="Une photo toute noire : objectif bouché, lumière éteinte, ou pièce imprimée en noir dans le noir ?"),
    _a("white_photo", "secret", "⬜", "Surexposé", "Ajouter une photo presque entièrement blanche", [1],
       lore="Tout est blanc : le flash a gagné, la pièce a disparu dans la lumière."),
    _a("panorama", "secret", "🏞️", "Panorama", "Ajouter une photo au moins 2,5 fois plus large que haute", [1],
       lore="Un panorama de ton atelier : l'imprimante, les bobines, et tout ce qui traîne autour."),
    _a("hires_photo", "secret", "🔭", "Haute définition", "Ajouter une photo de 12 mégapixels ou plus", [1],
       lore="Douze millions de pixels : on peut compter les couches une par une."),
    _a("photo_burst", "secret", "📸", "Rafale", "Ajouter 10 photos à une même impression en une minute", [1],
       lore="Clic-clic-clic : une vraie séance photo, digne d'un défilé."),
    _a("benchy_print", "secret", "🚤", "Le Benchy", "Imprimer un Benchy", [1],
       lore="Le petit bateau qui teste toutes les imprimantes du monde. Le tien flotte-t-il ?"),
    _a("calib_print", "secret", "📐", "Calibreur", "Imprimer une pièce de calibration (cube, test…)", [1],
       lore="Un cube de calibration : quand on veut que tout tombe juste, on commence par là."),
    _a("dragon_print", "secret", "🐉", "Dompteur de dragons", "Imprimer un dragon", [1],
       lore="Un dragon sorti du plateau : articulé ou pas, il a fière allure."),
    _a("skull_print", "secret", "💀", "Vanité", "Imprimer un crâne", [1],
       lore="Un crâne, comme dans les vieux tableaux : souviens-toi que les bobines aussi ont une fin."),
    _a("purge_day", "secret", "🗑️", "Coup de balai", "Supprimer 20 choses dans l'appli le même jour", [1],
       lore="Vingt suppressions dans la journée : l'appli respire, et toi aussi."),
    _a("tinkerer", "secret", "🎛️", "Bidouilleur", "Changer 10 fois les réglages le même jour", [1],
       lore="Dix réglages changés dans la journée : tu cherches LA bonne configuration."),
    _a("duo_dry", "secret", "🧖", "Spa en duo", "Faire sécher deux AMS en même temps", [1],
       lore="Deux AMS au chaud en même temps : séance de spa pour toutes les bobines."),
]
CATALOG += [_a(f"egg_{k}", "secret", e, t, d, [1], lore=l) for k, (e, t, d, _h, l) in EGGS.items()]
HIDDEN_EGGS = {"anonymous", "teapot"} | {k for k in EGGS if k.startswith("h_")}
PRANK_EGGS = {k for k in EGGS if k.startswith("p_")}
# Secrets (toutes les medailles uniques) : rangés en sous-sections dans la
# categorie « Secrets ».
SECRET_SUBS = [
    ("calendar", "📅", "Calendrier", "halloween christmas new_year friday13 pi_day leap_day valentine may_day bastille "
     "all_year april_fool music summer_solstice winter_solstice easter st_patrick fathers_day crepes epiphany "
     "palindrome_date anniversary all_seasons santa new_years_day star_wars towel_day pi_approx cat_day mid_august back_to_school all_saints dia_muertos st_nicholas st_john earth_day equinox dst_summer dst_winter programmers mothers_day ascension mardi_gras black_friday double_day twelve"),
    ("clock", "🕛", "Heures et lune", "midnight noon mirror sequence elite last_minute saturday_night monday_morning "
     "sunday_morning full_moon new_moon all_nighter cinderella wake_up night_visit palindrome_time after_midnight snack_time tea_time aperitif wolf_hour end_noon end_evening"),
    ("measures", "⚖️", "Poids et durées", "tiny flash titan answer42 beast kilo pi_grams palindrome full_day marathon42 "
     "bullseye tortoise hare one_hour watchmaker hundred_pieces triple3 suite123 min42 gram1 g100 g500 g_palindrome equal supersonic wink mammoth"),
    ("colors", "🎨", "Couleurs et matières", "rainbow16 panda tricolore carbon rubber barbie smurf hulk fire pumpkin "
     "xmas_tree silk galaxy glow marble wood translucent sparkle soluble rainbow6 vader snow mouse clockwork prince chick belgium italy reggae bee ladybug sailor rainbow_ultimate mix2 lab3 abs_first asa_first pc_first nylon_first"),
    ("counts", "🔢", "Compteurs et séries", "first_print n1001 hundred lucky777 leet y2k dont_panic weekend10 on_fire "
     "rainbow_day triplets broken_record pi314 err404 devil666 almost1000 byte256 kilobyte ten_thousand onetwothree seventh lucky13 forager perfect_month all_hours plate7 unfaithful mega_group novelist"),
    ("ups", "🎢", "Hauts et bas", "comeback phoenix bad_day insomniac comeback30 hibernation first_try so_close big_fall black_week revenge flawless_month"),
    ("trade", "🛒", "Ventes et bobines", "penny luxury market_day museum sold_hot finally_sold eternal_spool "
     "devoured_spool big_order pit_stop psycho_price one_euro big_spool gold_spool bargain spring_clean sauna duo_dry"),
    ("mw", "🌐", "MakerWorld", "self_print bestseller pioneer harsh recycled"),
    ("social", "🤝", "Copains", "night_owl_visit mutual_visit share_all"),
    ("famous", "🗿", "Modèles célèbres", "benchy_print calib_print dragon_print skull_print"),
    ("app", "📱", "Photos et appli", "paparazzi souvenirs grand_tour cutting_edge double_update novel christmas_visit "
     "action_cam making_of festival retro_video family_film flash_video bunker pwd_changes black_photo white_photo "
     "panorama hires_photo photo_burst purge_day tinkerer"),
    ("eggs", "🥚", "Easter eggs", " ".join(f"egg_{k}" for k in EGGS if k not in HIDDEN_EGGS | PRANK_EGGS)),
    ("pranks", "🌀", "Farces", " ".join(f"egg_{k}" for k in EGGS if k in PRANK_EGGS)),
    ("hidden", "🗺️", "Pages cachées", " ".join(f"egg_{k}" for k in EGGS if k in HIDDEN_EGGS)),
    ("game", "🎰", "Clés et roue", "jackpot lucky5 bad_luck win_streak last_key full_reveal"),
]
SUB_OF = {aid: sid for sid, _e, _n, ids in SECRET_SUBS for aid in ids.split()}

# Indice de chaque secret (3 cles) : il met sur la voie sans donner la reponse.
HINTS = {
    # Calendrier
    "halloween": "Les citrouilles et les fantômes ont leur nuit : imprime ce soir-là.",
    "christmas": "Quand le sapin brille et que les cadeaux attendent sous ses branches.",
    "new_year": "Fais durer une impression pendant que tout le monde compte à rebours.",
    "friday13": "Le jour le plus superstitieux du calendrier, quand il tombe en fin de semaine.",
    "pi_day": "Un jour de mars qui ressemble à 3,14.",
    "leap_day": "Un jour qui ne revient qu'une fois tous les quatre ans.",
    "valentine": "Le jour des amoureux, au cœur de l'hiver.",
    "may_day": "Le jour où l'on offre du muguet et où personne ne travaille.",
    "bastille": "Le jour des défilés et des feux d'artifice, en plein été.",
    "all_year": "Le calendrier entier, page après page, sans en sauter une.",
    "april_fool": "Un jour de farces… et que ta pièce en soit une.",
    "music": "Le jour où tout le monde joue dans la rue, au début de l'été.",
    "summer_solstice": "Le jour le plus long de l'année, pour une impression qui l'est aussi.",
    "winter_solstice": "La nuit la plus longue de l'année, pour une impression qui l'est aussi.",
    "easter": "Le dimanche des œufs en chocolat, dont la date change chaque année.",
    "st_patrick": "Le jour irlandais où tout le monde s'habille… d'une certaine couleur.",
    "fathers_day": "Un dimanche de juin dédié aux papas.",
    "crepes": "Le jour où l'on fait sauter les crêpes, en février.",
    "epiphany": "Le jour de la galette et de la fève, au début de l'année.",
    "palindrome_date": "Le calendrier aussi sait écrire des mots comme « kayak ».",
    "anniversary": "Chaque année, une date te rappelle d'où tu viens. Ce jour-là, fais chauffer la buse.",
    "all_seasons": "Vivaldi en aurait fait une impression.",
    "santa": "Le vieil homme en rouge n'est pas le seul à faire des cadeaux en hiver.",
    "new_years_day": "Le tout premier jour de l'année.",
    "star_wars": "« May the fourth be with you ».",
    "towel_day": "Les fans du Guide du voyageur galactique ont leur jour, fin mai.",
    "pi_approx": "Un jour d'été qui s'écrit comme une fraction proche de Pi.",
    "cat_day": "Le jour mondial des moustaches et des ronronnements, en août.",
    "mid_august": "Le jour férié du cœur de l'été.",
    "back_to_school": "Le premier jour d'un mois de cartables neufs.",
    "all_saints": "Le jour férié qui ouvre novembre.",
    "dia_muertos": "Le lendemain d'un jour férié de novembre, fêté avec des crânes colorés au Mexique.",
    "st_nicholas": "Le saint patron des enfants passe début décembre.",
    "st_john": "La nuit des grands feux, juste après le début de l'été.",
    "earth_day": "Le jour de la planète, au printemps.",
    "equinox": "Deux jours par an, le jour et la nuit font jeu égal.",
    "dst_summer": "Une impression qui perd une heure en route, au printemps.",
    "dst_winter": "Une impression qui gagne une heure en route, à l'automne.",
    "programmers": "Le jour de ceux qui comptent en puissances de deux.",
    "mothers_day": "Un dimanche de fin de printemps dédié aux mamans.",
    "ascension": "Un jeudi férié, quarante jours après les œufs en chocolat.",
    "mardi_gras": "Le jour des déguisements et des beignets, avant le carême.",
    "black_friday": "Le vendredi des soldes folles, fin novembre.",
    "double_day": "Un jour où le numéro du jour et celui du mois sont jumeaux.",
    "twelve": "Une douzaine, partout où tu regardes : sur le calendrier comme sur l'horloge.",
    # Heures
    "midnight": "Quand les deux aiguilles se rejoignent tout en haut, en pleine nuit.",
    "noon": "Lance-la quand le soleil est au plus haut.",
    "mirror": "L'horloge se regarde dans la glace.",
    "sequence": "Lance-la à une heure qui se compte sur les doigts, dans l'ordre.",
    "elite": "Une heure de l'après-midi que les geeks reconnaîtront.",
    "last_minute": "Lance-la à la toute dernière minute de la journée.",
    "saturday_night": "Le soir où l'on sort danser, tard.",
    "monday_morning": "Le pire moment de la semaine… surtout si ça rate.",
    "sunday_morning": "Le jour de la grasse matinée, mais lève-toi tôt.",
    "full_moon": "Lève les yeux une nuit où la lune est toute ronde.",
    "new_moon": "Lève les yeux une nuit où la lune a disparu.",
    "all_nighter": "Le marchand de sable passe… et l'imprimante attaque une très longue nuit.",
    "cinderella": "Le carrosse redevient citrouille à cette heure-là : que l'impression finisse pile à ce moment.",
    "wake_up": "Que l'impression se termine à l'heure du réveil, au premier café.",
    "night_visit": "Ouvre l'appli au cœur de la nuit, quand tout le monde dort.",
    "palindrome_time": "L'horloge écrit un mot comme « ressasser ».",
    "after_midnight": "Une minute après le début du jour.",
    "snack_time": "Quand les enfants sortent de l'école et réclament un pain au chocolat.",
    "tea_time": "Quand Londres sort sa plus belle porcelaine.",
    "aperitif": "Quand on sort les cacahuètes et les olives.",
    "wolf_hour": "L'heure où les loups rôdent, au plus noir de la nuit.",
    "end_noon": "Que l'impression finisse juste à temps pour passer à table, à midi.",
    "end_evening": "Que l'impression finisse à l'heure où l'on quitte le bureau.",
    # Poids et durees
    "tiny": "Imprime quelque chose de presque invisible sur la balance.",
    "flash": "Une impression si courte qu'on n'a pas le temps de s'ennuyer.",
    "titan": "Énorme et interminable à la fois.",
    "answer42": "La grande réponse à la vie, à l'univers et au reste… sur la balance.",
    "beast": "Un poids qui ferait frémir un exorciste.",
    "kilo": "Une pièce qui pèse exactement ce que pèse une bobine pleine.",
    "pi_grams": "Une toute petite pièce, au poids irrationnel.",
    "palindrome": "Kayak, radar, été… et le chronomètre de ton impression.",
    "full_day": "La Terre a fait un tour complet pendant que ta pièce montait. Ni plus, ni moins.",
    "marathon42": "Une course de fond, en heures plutôt qu'en kilomètres.",
    "bullseye": "Le trancheur avait vu juste, à la minute près.",
    "tortoise": "Rien ne sert de courir, il faut partir à point.",
    "hare": "Le lièvre de la fable, mais cette fois, c'est lui qui gagne.",
    "one_hour": "Une impression de soixante minutes, pas une de plus.",
    "watchmaker": "Les horlogers suisses seraient fiers de ta ponctualité, sur la longueur.",
    "hundred_pieces": "Une armée de petites pièces, au garde-à-vous sur le plateau.",
    "triple3": "Une durée où le même chiffre revient trois fois.",
    "suite123": "Une durée qui se compte dans l'ordre : un, deux, trois.",
    "min42": "La grande réponse, mais en minutes.",
    "gram1": "La plus petite pièce que ta balance de cuisine puisse encore peser.",
    "g100": "Le poids d'une tablette de chocolat.",
    "g500": "Le poids d'une plaquette de beurre.",
    "g_palindrome": "Une grosse pièce dont le poids est un mot comme « radar ».",
    "equal": "Le chronomètre et la balance tombent d'accord.",
    "supersonic": "Le mur du son, version imprimante.",
    "wink": "Une impression plus rapide qu'un clin d'œil… ou presque.",
    "mammoth": "Une pièce digne de l'ère glaciaire.",
    # Couleurs et matieres
    "rainbow16": "Un animal de légende qui ne se contente jamais d'une seule couleur.",
    "panda": "Deux couleurs, comme un animal qui adore le bambou.",
    "tricolore": "Les couleurs d'un drapeau bien de chez nous.",
    "carbon": "Un filament renforcé, mat et costaud.",
    "rubber": "Une matière souple qui rebondit.",
    "barbie": "Une seule couleur, celle d'une poupée célèbre.",
    "smurf": "Une seule couleur, celle de petits personnages qui vivent dans des champignons.",
    "hulk": "Une seule couleur, celle d'un géant en colère.",
    "fire": "Les couleurs d'un feu de bois.",
    "pumpkin": "Les couleurs d'une nuit d'Halloween.",
    "xmas_tree": "Les couleurs de Noël.",
    "silk": "Un filament qui brille comme un tissu précieux.",
    "galaxy": "Un filament qui scintille comme un ciel étoilé.",
    "glow": "Un filament qui brille quand on éteint la lumière.",
    "marble": "Un filament qui imite la pierre des statues.",
    "wood": "Un filament qui sent la scierie.",
    "translucent": "Un filament qui laisse passer la lumière.",
    "sparkle": "Un filament qui laisse des paillettes partout.",
    "soluble": "Des supports qui disparaissent dans l'eau.",
    "rainbow6": "Après la pluie, dans une seule pièce.",
    "vader": "Une seule couleur, celle du côté obscur, et pas une petite pièce.",
    "snow": "Une seule couleur, celle de la neige fraîche, et pas une petite pièce.",
    "mouse": "Une seule couleur, celle d'une petite souris.",
    "clockwork": "Une seule couleur, celle d'un agrume.",
    "prince": "Une seule couleur, celle d'une pluie chantée par Prince.",
    "chick": "Une seule couleur, celle d'un poussin.",
    "belgium": "Les couleurs d'un drapeau voisin, une fois.",
    "italy": "Les couleurs d'une pizza margherita.",
    "reggae": "Les couleurs d'une musique jamaïcaine.",
    "bee": "Deux couleurs, comme un insecte qui fait du miel.",
    "ladybug": "Deux couleurs, comme une petite bête porte-bonheur.",
    "sailor": "Deux couleurs, comme un pull de marin breton.",
    "rainbow_ultimate": "Fais donner tous tes AMS en même temps.",
    "mix2": "Un mariage de matières, sur une même pièce.",
    "lab3": "Une expérience de chimie, avec plusieurs ingrédients sur une même pièce.",
    "abs_first": "Une matière technique qui n'aime pas les courants d'air (et qui sent fort).",
    "asa_first": "Une matière technique faite pour vivre dehors.",
    "pc_first": "Une matière technique transparente et très résistante.",
    "nylon_first": "Une matière technique qui adore l'humidité… un peu trop.",
    # Compteurs et series
    "first_print": "Tout commence par une première réussite.",
    "n1001": "Autant d'impressions qu'il y a de nuits dans un célèbre recueil de contes.",
    "hundred": "Un nombre rond, à trois chiffres.",
    "lucky777": "Le nombre gagnant des machines à sous.",
    "leet": "Un nombre que les hackers écrivent à la place d'un mot.",
    "y2k": "Le nombre du bug qui faisait peur aux ordinateurs.",
    "dont_panic": "La grande réponse, en nombre d'impressions réussies.",
    "weekend10": "Un week-end très, très chargé.",
    "on_fire": "Une journée où tout réussit, encore et encore.",
    "rainbow_day": "Une journée où ton AMS change souvent de couleur.",
    "triplets": "Trois frères identiques, nés le même jour.",
    "broken_record": "Comme un vinyle qui saute : toujours le même refrain.",
    "pi314": "Pi, multiplié par cent.",
    "err404": "Un nombre bien connu des pages web introuvables… et que cette impression rate.",
    "devil666": "Le nombre du diable, en nombre d'impressions réussies.",
    "almost1000": "Juste avant un nombre très rond.",
    "byte256": "Un octet bien plein.",
    "kilobyte": "Un kilo, version informaticien.",
    "ten_thousand": "Un nombre à cinq chiffres, tout rond.",
    "onetwothree": "Un nombre qui se compte comme un, deux, trois.",
    "seventh": "Le nombre du paradis, au tout début de ton aventure.",
    "lucky13": "Un nombre qui porte malheur… ou bonheur.",
    "forager": "Une abeille qui va de fleur en fleur, toute la journée.",
    "perfect_month": "Un mois sans le moindre jour de repos pour la buse.",
    "all_hours": "Avec le temps, lance des impressions à toutes les heures du cadran.",
    "plate7": "Un projet qui demande beaucoup de plateaux.",
    "unfaithful": "Ton cœur balance entre deux machines.",
    "mega_group": "Une très grande famille, réunie sous le même toit.",
    "novelist": "Une impression qui méritait tout un paragraphe.",
    # Hauts et bas
    "comeback": "Tomber, se relever, et remettre le même ouvrage sur le métier.",
    "phoenix": "Un oiseau de légende qui renaît toujours de ses cendres.",
    "bad_day": "Une journée où rien ne va.",
    "insomniac": "Le sommeil te fuit, nuit après nuit, et l'imprimante en profite.",
    "comeback30": "Fais une longue pause… puis reviens.",
    "hibernation": "Fais une très, très longue pause… puis reviens.",
    "first_try": "Une longue première fois, sans brouillon.",
    "so_close": "Tu tenais la ligne d'arrivée… et tu as renoncé.",
    "big_fall": "Une très longue impression qui finit mal.",
    "black_week": "Une semaine où les échecs s'enchaînent.",
    "revenge": "La vengeance est un plat qui se mange… après bien des échecs.",
    "flawless_month": "Un mois bien rempli, sans un seul raté.",
    # Ventes et bobines
    "penny": "Une impression qui ne coûte presque rien.",
    "luxury": "Une impression qui coûte très cher à elle seule.",
    "market_day": "Une journée de ventes bien remplie.",
    "museum": "Vends une pièce à un prix de collectionneur.",
    "sold_hot": "Vendu avant même d'avoir refroidi.",
    "finally_sold": "Un objet qui attend très longtemps son acheteur.",
    "eternal_spool": "Une bobine qui fait durer le plaisir très longtemps.",
    "devoured_spool": "Une bobine vidée en un rien de temps.",
    "big_order": "Une très grosse livraison de filament en une fois.",
    "pit_stop": "Change plusieurs bobines en un éclair, comme au stand.",
    "psycho_price": "Un prix de vente qui fait croire que c'est moins cher.",
    "one_euro": "Un prix de vente symbolique.",
    "big_spool": "Une bobine bien plus grosse que les autres.",
    "gold_spool": "Une bobine hors de prix.",
    "bargain": "Une bobine à petit prix.",
    "spring_clean": "Un mois où beaucoup de bobines se vident.",
    # MakerWorld
    "self_print": "Imprime ta propre création.",
    "bestseller": "Un modèle que la planète entière connaît par cœur.",
    "pioneer": "Pose le pied là où presque personne n'est allé.",
    # Photos et appli
    "paparazzi": "Les photographes guettent la sortie des stars… et celle de tes pièces.",
    "souvenirs": "Une vieille, très vieille pièce mérite bien son album.",
    "grand_tour": "Visite chaque pièce de la maison, de la cave au grenier.",
    "cutting_edge": "Garde BambuNymous parfaitement à jour.",
    "double_update": "Une journée où BambuNymous change plusieurs fois.",
    "novel": "Un modèle qui a besoin de toute une phrase pour se présenter.",
    "christmas_visit": "Ouvre l'appli le jour où le Père Noël est passé.",
    "action_cam": "Moteur, ça tourne ! La pièce est encore tiède.",
    "jackpot": "La roue cache un lot très, très rare. Tourne, encore et encore.",
    "lucky5": "Un beau lot de clés d'un seul coup de roue.",
    "bad_luck": "Perdre, perdre encore… la malchance aussi se récompense.",
    "win_streak": "Quand la roue est de ton côté, plusieurs fois de suite.",
    "last_key": "Dépense, dépense… jusqu'à ne plus rien avoir en poche.",
    "full_reveal": "Va au bout des révélations sur un même secret.",
    "sauna": "Un très, très long bain de chaleur pour tes bobines.",
    "harsh": "Sur MakerWorld, sois avare d'étoiles. Très avare.",
    "recycled": "Pourquoi écrire un avis quand tu en as déjà des tout prêts ?",
    "night_owl_visit": "Va voir ce que font tes copains pendant qu'ils dorment.",
    "mutual_visit": "Toi chez lui, lui chez toi, dans la même journée.",
    "share_all": "Montre aux autres le détail… puis l'ensemble.",
    "black_photo": "Une photo prise… sans lumière, ou presque.",
    "white_photo": "Trop de lumière tue la photo. Essaie quand même.",
    "panorama": "Une photo qui s'étire comme un paysage de montagne.",
    "hires_photo": "Une photo avec beaucoup, beaucoup de pixels.",
    "photo_burst": "Une séance photo express sur une seule impression.",
    "benchy_print": "Un petit bateau de légende, l'épreuve de toutes les imprimantes.",
    "calib_print": "Avant de tout imprimer, on vérifie que tout tombe juste.",
    "dragon_print": "Une créature qui crache du feu… en plastique.",
    "skull_print": "Ce qu'il reste de nous, en version imprimée.",
    "purge_day": "Un grand ménage dans l'appli, en une seule journée.",
    "tinkerer": "Une journée à tourner les boutons des réglages, encore et encore.",
    "duo_dry": "Plusieurs AMS, une même envie de chaleur, au même moment.",
    "bunker": "Un mot de passe, c'est bien. Avec un code qui change toutes les 30 secondes, c'est mieux.",
    "pwd_changes": "Un bon secret se renouvelle de temps en temps.",
    "making_of": "Une seule impression, deux façons de la montrer : l'une bouge, l'autre pas.",
    "festival": "Un jour de tournage intensif : cinq films dans la même journée.",
    "retro_video": "Ressors une vieille impression, très vieille, et fais-lui enfin son film.",
    "family_film": "Les groupes d'impressions aiment aussi qu'on les filme.",
    "flash_video": "Le plus court des films : moins de temps qu'un clin d'œil… ou presque.",
    **{f"egg_{k}": v[3] for k, v in EGGS.items()},
}


LIVE = {"mw_designs", "mw_downloads", "mw_prints", "mw_boosts", "mw_fans", "mw_likes", "mw_level", "mw_collections",
        "mw_my_collections",
        "mw_follows", "friends", "stock", "stock_kg", "stock_colors", "rfid", "multicolor_fils",
        "photos_manual", "photo_prints", "photos_camera", "photos_max", "covers", "visits", "visit_days", "details",
        "actions", "updates", "notifs", "dismissals", "print_groups", "paparazzi", "souvenirs", "videos", "video_prints",
        "wheel_played", "wheel_keys", "keys_earned", "keys_spent", "keys_max", "reveals", "tickets_won", "tickets_used",
        "grand_tour", "night_visit", "cutting_edge", "double_update", "shares", "mw_rates", "mw_boosts_given",
        "mw_likes_given", "mw_collected", "open_spools", "mw_points_bal", "profile_downloads", "queue_size", "accessory_units", "showcase", "household", "notes", "catalog", "assembled", "accessory_refs",
        "to_order", "unlucky", "acc_images", "bunker", "devices", "mw_income"}
for _x in CATALOG:
    _x["live"] = _x["id"] in LIVE
# Seuils : six paliers (bronze -> legende), etendus a neuf (mythique, cosmique,
# eternel) par _extend, sauf liste de 9 donnee ici ou plafond naturel (BOUNDED).
# Pour les retoucher, il suffit de changer cette table : l'empreinte du
# catalogue change, et le passage suivant (15 min) realigne les paliers acquis
# en silence -- retire ceux qui ne sont plus atteints, ajoute les nouveaux.
TIER_TABLE = {
    # Impressions : revus le 21/10/2026 (maximums donnes par l'utilisateur)
    "heavy_group": [100, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000],
    "clean_weeks": [1, 4, 8, 13, 20, 30, 40, 60, 80],
    "ams_units": [1, 2, 3, 4, 5],
    "prints_ok": [10, 100, 250, 500, 800, 1200, 1700, 2300, 3000],
    "print_hours": [25, 250, 700, 1250, 2000, 2800, 3800, 5000, 7000],
    "print_kg": [1, 10, 25, 45, 70, 100, 140, 190, 250],
    "longest": [2, 4, 8, 12, 20, 30, 40, 55, 72],
    "heaviest": [50, 100, 200, 300, 400, 500, 650, 800, 1000],
    "streak": [3, 7, 15, 25, 40, 60, 80, 110, 150],
    "busy_day": [2, 3, 5, 7, 9, 11, 13, 16, 20],
    "success_run": [5, 20, 50, 80, 120, 160, 210, 275, 350],
    "night": [5, 20, 50, 80, 120, 160, 210, 275, 350],
    "early": [1, 2, 3, 5, 7, 10, 13, 16, 20],
    "weekend": [10, 50, 100, 200, 300, 400, 550, 750, 1000],
    "models": [10, 50, 125, 200, 300, 450, 650, 900, 1200],
    "repeat": [2, 5, 8, 12, 16, 20, 25, 35, 50],
    "multicolor": [2, 10, 25, 45, 70, 100, 140, 190, 250],
    "colors_max": [2, 3, 4, 5, 6, 8, 10, 12, 16],
    "failures": [1, 5, 10, 20, 30, 40, 55, 75, 100],
    "veteran": [7, 30, 91, 182, 365, 548, 730, 1095, 1826],
    "month_record": [10, 25, 50, 75, 100, 130, 160, 200, 250],
    "weeks": [2, 4, 6, 10, 15, 20, 26, 39, 52],
    "pieces": [10, 100, 300, 600, 1000, 1500, 2000, 2700, 3500],
    "mw_made": [10, 50, 150, 300, 500, 750, 1000, 1500, 2000],
    "spent": [10, 50, 150, 300, 500, 750, 1000, 1500, 2000],
    "palette": [5, 10, 25, 40, 60, 80, 110, 150, 200],
    "materials": [2, 3, 4, 5, 6],
    "spools_done": [2, 5, 10, 20, 30, 45, 65, 90, 120],
    "stock": [5, 10, 15, 25, 35, 45, 60, 80, 100],
    "dried": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "swatches": [5, 10, 20, 30, 45, 60, 80, 110, 150],
    "brands": [2, 3, 4, 5, 6, 7, 8, 9, 10],
    "stock_kg": [5, 10, 15, 25, 35, 45, 60, 80, 100],
    "stock_colors": [6, 7, 8, 9, 10, 11, 12, 13, 14],
    "rfid": [5, 10, 15, 25, 35, 45, 60, 80, 100],
    "labels": [5, 10, 20, 30, 45, 60, 80, 110, 150],
    "multicolor_fils": [1, 2, 3, 4, 5, 6, 7, 8, 10],
    "objects": [10, 25, 50, 80, 110, 150, 190, 240, 300],
    "sold": [1, 3, 6, 10, 15, 25, 35, 50, 75],
    "revenue": [10, 25, 50, 80, 120, 175, 250, 350, 500],
    "gifted": [1, 3, 6, 10, 15, 25, 35, 50, 75],
    "personal": [5, 10, 25, 40, 60, 80, 110, 150, 200],
    "accessories": [10, 50, 100, 175, 250, 350, 450, 600, 750],
    "groups": [1, 2, 4, 6, 10, 15, 20, 30, 40],
    "margin": [5, 10, 25, 40, 60, 85, 120, 175, 250],
    "mw_designs": [1, 3, 5, 8, 12, 18, 25, 35, 50],
    "mw_downloads": [50, 200, 500, 1000, 1750, 2750, 4000, 5500, 7500],
    "mw_prints": [25, 100, 250, 500, 1000, 1750, 2500, 3500, 5000],
    "mw_boosts": [5, 15, 30, 60, 100, 150, 210, 300, 400],
    "mw_fans": [5, 20, 40, 75, 120, 175, 250, 350, 500],
    "mw_likes": [25, 100, 250, 500, 750, 1100, 1600, 2200, 3000],
    "mw_level": [3, 6, 9, 12, 15, 18, 21, 25, 30],
    "mw_collections": [50, 200, 500, 1000, 1750, 2750, 4000, 5500, 7500],
    "mw_follows": [1, 3, 5, 8, 12, 18, 25, 35, 50],
    "friends": [1, 2, 3, 4, 5],
    "photos_manual": [10, 50, 100, 200, 350, 500, 700, 950, 1200],
    "photo_prints": [5, 10, 25, 40, 60, 80, 110, 150, 200],
    "photos_camera": [50, 250, 750, 1500, 2500, 3750, 5000, 7500, 10000],
    "photos_max": [2, 3, 4, 5, 6, 8, 10, 12, 15],
    "covers": [1, 2, 3, 4, 5, 6, 7, 8, 10],
    "visits": [25, 100, 250, 500, 750, 1000, 1400, 1900, 2500],
    "visit_days": [3, 7, 14, 30, 60, 100, 150, 250, 365],
    "details": [25, 75, 150, 300, 450, 650, 850, 1100, 1500],
    "actions": [10, 50, 100, 200, 300, 450, 600, 800, 1000],
    "updates": [1, 3, 5, 10, 15, 25, 40, 60, 100],
    "notifs": [50, 200, 500, 1000, 1500, 2200, 3000, 4000, 5000],
    "dismissals": [2, 5, 10, 15, 25, 35, 50, 70, 100],
    "rfid_scans": [5, 15, 30, 50, 75, 100, 150, 200, 300],
    "colors_printed": [5, 10, 25, 40, 60, 80, 110, 150, 200],
    "print_days": [7, 30, 60, 100, 150, 225, 300, 450, 600],
    "print_groups": [5, 25, 50, 100, 150, 200, 275, 375, 500],
    "fil_changes": [5, 25, 50, 100, 150, 200, 275, 375, 500],
    "fil_changes_day": [2, 3, 4, 6, 8, 10, 13, 18, 25],
    "fil_changes_week": [5, 8, 12, 16, 20, 25, 32, 45, 60],
    "open_spools": [5, 10, 15, 25, 35, 45, 60, 80, 100],
    "long_prints": [1, 3, 5, 10, 15, 25, 35, 50, 75],
    "express": [5, 25, 50, 100, 175, 250, 350, 450, 600],
    "night_hours": [10, 50, 150, 300, 450, 600, 800, 1100, 1500],
    "nonstop": [2, 4, 8, 12, 20, 30, 40, 55, 72],
    "lost_hours": [1, 5, 10, 20, 30, 40, 55, 75, 100],
    "day_hours": [4, 8, 12, 16, 18, 20, 22, 23, 24],
    "month_hours": [25, 50, 100, 150, 200, 250, 325, 400, 500],
    "feather": [5, 20, 50, 80, 120, 160, 210, 275, 350],
    "sturdy": [1, 2, 3, 4, 5, 7, 9, 12, 15],
    "multi_plate": [5, 15, 30, 50, 75, 100, 150, 200, 300],
    "bicolor": [10, 50, 100, 200, 300, 400, 550, 750, 1000],
    "reliable": [5, 15, 30, 50, 75, 100, 140, 190, 250],
    "faster": [2, 5, 10, 20, 35, 50, 70, 100, 150],
    "morning": [5, 25, 50, 100, 150, 200, 275, 375, 500],
    "lunch": [5, 25, 50, 100, 150, 200, 275, 375, 500],
    "evening": [10, 50, 100, 175, 250, 350, 450, 600, 750],
    "overnight": [1, 3, 5, 10, 15, 20, 25, 35, 50],
    "cancelled": [1, 3, 5, 8, 10, 15, 20, 25, 30],
    "records": [1, 2, 3, 4, 5, 6, 7, 8, 10],
    "months_active": [1, 3, 6, 9, 12, 18, 24, 30, 36],
    "weekends_active": [1, 5, 10, 20, 30, 40, 55, 75, 100],
    "kg_month": [0.5, 1, 2, 3, 4, 5, 6, 8, 10],
    "kg_day": [0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.25, 1.5, 2],
    "engineering": [0.1, 0.25, 0.5, 1, 2, 3, 4.5, 7, 10],
    "mw_designs_printed": [10, 40, 80, 130, 200, 280, 380, 480, 600],
    "creators": [5, 20, 40, 70, 100, 140, 190, 260, 350],
    "mw_categories": [2, 5, 10, 15, 20, 25, 32, 40, 50],
    "trending": [1, 3, 6, 10, 15, 20, 30, 45, 60],
    "gems": [1, 3, 5, 8, 12, 17, 23, 35, 50],
    "mw_points_bal": [10, 25, 50, 100, 175, 275, 400, 600, 1000],
    "profile_downloads": [50, 200, 500, 1000, 1750, 2750, 4000, 5500, 7500],
    "queue_size": [2, 5, 10, 15, 20, 30, 40, 55, 75],
    "spools_total": [10, 25, 50, 80, 110, 150, 190, 240, 300],
    "spool_kg": [5, 15, 30, 50, 75, 100, 140, 190, 250],
    "spool_spent": [50, 150, 300, 500, 750, 1000, 1400, 1900, 2500],
    "catalog": [5, 10, 20, 30, 45, 60, 80, 110, 150],
    "bambu_spools": [5, 10, 25, 40, 60, 80, 110, 150, 200],
    "other_spools": [2, 5, 8, 12, 16, 20, 25, 35, 50],
    "assembled": [2, 5, 10, 20, 35, 50, 70, 100, 150],
    "accessory_refs": [2, 5, 10, 15, 20, 30, 40, 55, 75],
    "accessory_units": [25, 50, 100, 200, 300, 450, 650, 900, 1200],
    "best_sale": [2, 5, 10, 15, 20, 30, 45, 70, 100],
    "showcase": [2, 5, 8, 12, 18, 25, 35, 45, 60],
    "notes": [1, 5, 10, 20, 30, 40, 55, 75, 100],
    "household": [2, 3, 4, 5, 6, 7, 8, 9, 10],
    "shares": [1, 3, 5, 8, 12, 18, 25, 35, 50],
    "mw_rates": [1, 10, 25, 50, 75, 100, 150, 200, 300],
    "mw_boosts_given": [1, 2, 4, 7, 10, 15, 20, 30, 50],
    "mw_likes_given": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "mw_collected": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    # Filaments : revus le 21/10/2026
    "mat_pla": [1, 5, 10, 20, 30, 45, 65, 90, 120],
    "mat_petg": [0.5, 1, 2, 4, 6, 9, 13, 20, 30],
    # MakerWorld : revus le 21/10/2026
    "mw_my_collections": [1, 3, 5, 8, 12, 16, 20, 30, 40],
    # Cles et roue (21/10/2026)
    "wheel_played": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "wheel_keys": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "keys_earned": [5, 15, 30, 50, 80, 120, 175, 250, 350],
    "keys_spent": [1, 5, 15, 30, 50, 80, 120, 175, 250],
    "keys_max": [5, 10, 15, 20, 30, 40, 50, 75, 100],
    "reveals": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "tickets_won": [1, 2, 3, 5, 8, 12, 16, 20, 30],
    "tickets_used": [1, 2, 3, 5, 8, 12, 16, 20, 30],
    # Photos : videos (21/10/2026)
    "videos": [1, 3, 5, 10, 20, 35, 50, 75, 100],
    "video_prints": [1, 2, 4, 8, 15, 25, 40, 60, 80],
    # Lot du 21/10/2026
    "dry_hours": [5, 25, 50, 100, 200, 350, 500, 750, 1000],
    "five_star": [1, 5, 15, 30, 60, 100, 150, 220, 300],
    "rating_photos": [1, 10, 30, 60, 100, 175, 250, 400, 600],
    "long_reviews": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "mw_income": [100, 500, 1000, 2500, 5000, 8000, 12000, 18000, 25000],
    "mw_best_day": [10, 25, 50, 100, 150, 250, 400, 600, 1000],
    "mw_points_streak": [2, 3, 5, 7, 10, 15, 21, 30, 45],
    "planned": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "queue_done": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "official": [5, 10, 20, 35, 50, 75, 100, 125, 150],
    "auto_found": [5, 15, 30, 50, 75, 100, 140, 190, 250],
    "weighings": [1, 5, 15, 30, 50, 80, 120, 175, 250],
    "tray_fixes": [1, 3, 5, 10, 20, 35, 50, 75, 100],
    "to_order": [1, 3, 5, 10, 20, 30, 45, 65, 100],
    "good_seller": [1, 3, 5, 10, 15, 25, 35, 50, 75],
    "unlucky": [1, 2, 3, 5, 8, 12, 16, 20, 30],
    "restocks": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "acc_images": [1, 3, 5, 10, 15, 25, 35, 50, 75],
    "saved": [1, 5, 10, 25, 50, 100, 175, 250, 400],
    "electric": [5, 15, 30, 60, 100, 150, 220, 300, 400],
    "to_redo": [1, 3, 5, 10, 15, 25, 35, 50, 75],
    "full_report": [1, 10, 30, 60, 100, 175, 250, 400, 600],
    "mw_detective": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "devices": [1, 2, 3, 4, 5, 6, 8, 10, 12],
    "friend_visits_in": [10, 50, 100, 250, 500, 1000, 2000, 3500, 5000],
    "host_days": [1, 5, 10, 20, 35, 50, 75, 100, 150],
    "friend_visits_out": [10, 50, 100, 250, 500, 1000, 2000, 3500, 5000],
    "visitor_days": [1, 5, 10, 20, 35, 50, 75, 100, 150],
}
# Au-dela de la Legende (Mythique, Cosmique, Eternel) : x2, x5, x10 du dernier
# seuil, arrondis. Sauf la ou il y a un plafond naturel (pourcentage, 24 h par
# jour, familles de teintes, matieres, imprimantes, niveau MakerWorld…).
BOUNDED = {"day_hours", "colors_max", "stock_colors", "materials", "ams_units", "mw_level", "friends"}   # mw_level : 30 au plus


def _nice(x: float) -> float:
    """Arrondi « rond » vers le haut : 1, 1,5, 2, 2,5, 3, 4, 5, 6, 7,5 x 10^k."""
    import math
    if x <= 0:
        return x
    k = 10 ** math.floor(math.log10(x))
    for m in (1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10):
        if m * k >= x - 1e-9:
            v = m * k
            return int(v) if float(v).is_integer() else v
    return x


def _extend(t: list, aid: str) -> list:
    """Neuf paliers. Un succes plafonne a moins de neuf seuils les place en
    haut de l'echelle (le dernier est l'Eternel) : son premier seuil donne
    d'un coup tous les paliers d'en dessous (et compte pour leurs collections)."""
    if aid not in BOUNDED and len(t) == 6:
        t = t + [_nice(t[-1] * f) for f in (2, 5, 10)]
    if 1 < len(t) < len(TIERS):
        t = [t[0]] * (len(TIERS) - len(t)) + t
    return t


for _x in CATALOG:
    if _x["id"] in TIER_TABLE:
        _x["tiers"] = _extend(TIER_TABLE[_x["id"]], _x["id"])
    elif _x["id"].startswith("mat_"):
        _x["tiers"] = list([0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5])
    # APRES les seuils (un succes a paliers est declare avec un seuil provisoire) :
    # une medaille unique ne se devoile qu'une fois gagnee, et vit dans « Secrets »
    if len(_x["tiers"]) == 1:
        _x["hidden"] = True
        _x["hint"] = HINTS.get(_x["id"]) or _x.get("hint")
        _x["cat"] = "secret"
        _x["sub"] = SUB_OF.get(_x["id"], "counts")
    else:
        _x.pop("hidden", None)
# Collections de medailles (secrets) : toute une section au moins a un palier.
# Seuls comptent les succes qui ont ce palier (un succes plafonne a 6 paliers
# ne bloque pas Mythique et au-dela) ; une matiere jamais imprimee non plus.
SET_CATS = [c for c in CATEGORIES if c[0] != "secret"]


def _set_id(cat: str, tier: str) -> str:
    return f"set_{cat}_{tier}"


def _members(cat: str, i: int) -> list:
    return [a for a in CATALOG if a["cat"] == cat and len(a["tiers"]) > max(i, 1) and not a["id"].startswith("set_")]


for _cid, _cemo, _cname in SET_CATS:
    for _i, _t in enumerate(TIERS):
        if not _members(_cid, _i):
            continue
        CATALOG.append({
            "id": _set_id(_cid, _t["id"]), "cat": "secret", "sub": "sets", "hidden": True, "live": False,
            "emoji": _t["emoji"], "name": f"Collection {_t['label']} · {_cname}",
            "desc": f"Tous les succès de la section {_cname} au moins au palier {_t['label']}", "tiers": [1],
            "hint": f"Regarde la section {_cname} : il faudrait que toutes ses médailles se ressemblent.",
            "lore": f"Toute la section {_cname} au palier {_t['label']} : une vitrine parfaitement assortie.",
            "set": (_cid, _i)})
SECRET_SUBS.append(("sets", "🏆", "Collections de médailles",
                    " ".join(a["id"] for a in CATALOG if a.get("set"))))
SUB_OF.update({a["id"]: "sets" for a in CATALOG if a.get("set")})

# Completude (22/10/2026) : un tiroir de secrets entierement trouve, une section
# entierement au dernier palier, et tout a 100 %. Recalcules a chaque passage
# comme les collections : un secret ou un palier ajoute plus tard les fait
# perdre jusqu'a ce qu'on le rattrape.
_SUBS_NOW = list(SECRET_SUBS)
for _sid, _semo, _sname, _ids in _SUBS_NOW:
    CATALOG.append({
        "id": f"sub_{_sid}", "cat": "secret", "sub": "complete", "hidden": True, "live": False, "emoji": _semo,
        "name": f"Tiroir complet · {_sname}", "desc": f"Tous les secrets du tiroir « {_sname} »", "tiers": [1],
        "hint": f"Le tiroir « {_sname} » a encore des recoins. Vide-le entièrement.",
        "lore": f"Plus un seul secret de « {_sname} » ne t'échappe. Jusqu'au prochain…",
        "complete": ("sub", _sid)})
for _cid, _cemo, _cname in CATEGORIES:
    CATALOG.append({
        "id": f"full_{_cid}", "cat": "secret", "sub": "complete", "hidden": True, "live": False, "emoji": _cemo,
        "name": f"Complétude · {_cname}",
        "desc": ("Tous les secrets trouvés" if _cid == "secret" else
                 f"Tous les succès de la section {_cname} à leur dernier palier"), "tiers": [1],
        "hint": f"La section {_cname}, sans exception, tout en haut.",
        "lore": f"La section {_cname} est complète : pas une médaille ne manque, pas un palier n'est à prendre.",
        "complete": ("cat", _cid)})
CATALOG.append({
    "id": "everything", "cat": "secret", "sub": "complete", "hidden": True, "live": False, "emoji": "👑",
    "name": "100 %", "desc": "Absolument tout : chaque succès à son dernier palier, chaque secret trouvé", "tiers": [1],
    "hint": "Il n'en reste qu'un, et c'est tous les autres à la fois.",
    "lore": "Tout. Absolument tout. L'appli n'a plus rien à t'apprendre… jusqu'à la prochaine mise à jour.",
    "complete": ("all", None)})
SECRET_SUBS.append(("complete", "💯", "Complétude", " ".join(a["id"] for a in CATALOG if a.get("complete"))))
SUB_OF.update({a["id"]: "complete" for a in CATALOG if a.get("complete")})
BY_ID = {a["id"]: a for a in CATALOG}


def _signature() -> str:
    """Empreinte du catalogue (succes, seuils) ET du code de ce module. Elle
    change des qu'on ajoute un succes ou une categorie, qu'on touche a un seuil
    ou a une regle de calcul : le passage suivant recalcule alors tout en
    silence (ni notification ni cle), sans numero a tenir a jour."""
    import hashlib
    raw = json.dumps([(a["id"], a["tiers"]) for a in CATALOG], separators=(",", ":"))
    try:
        with open(__file__, "rb") as f:
            raw += hashlib.md5(f.read()).hexdigest()
    except OSError:
        pass
    return hashlib.md5(raw.encode()).hexdigest()[:12]


CATALOG_SIG = _signature()


def tiers_of(a: dict) -> list:
    return [UNIQUE] if len(a["tiers"]) == 1 else TIERS[:len(a["tiers"])]


# ── Donnees ──────────────────────────────────────────────────────────────────
def _model_key(p) -> str:
    if p.design_id and str(p.design_id).strip() not in ("", "0", "None"):
        return "d:" + str(p.design_id).strip()
    name = (p.translated_name or p.file_name or "").strip().lower()
    name = re.sub(r"\.(gcode\.)?3mf$|\.gcode$", "", name)
    return "n:" + name if name else ""


def _family(t: str) -> str:
    t = (t or "").strip().upper()
    if not t:
        return ""
    head = re.split(r"[\s\-_/+]", t)[0]
    return {"PLA": "PLA", "PETG": "PETG", "PET": "PETG", "TPU": "TPU", "ABS": "ABS", "ASA": "ASA",
            "PA": "PA", "PAHT": "PA", "PA6": "PA", "PA12": "PA", "PC": "PC", "PVA": "PVA", "HIPS": "HIPS",
            "PPS": "PPS", "PET-CF": "PETG"}.get(head, head)


async def _load_data() -> dict:
    from sqlalchemy import select
    counted = await counted_users()
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament, Spool
    from ..models.object_history import Object, ObjectAccessory, ObjectGroup
    from ..models.print_history import FilamentUsage, Print
    async with AsyncSessionLocal() as db:
        prints = (await db.execute(select(Print.id, Print.print_date, Print.status, Print.duration_seconds,
                                          Print.total_weight_g, Print.design_id, Print.translated_name,
                                          Print.file_name, Print.estimated_seconds, Print.number_of_items,
                                          Print.total_cost, Print.plate_id, Print.printer_model, Print.status_note,
                                          Print.group_id)
                                   .order_by(Print.print_date, Print.id))).all()
        usage = (await db.execute(select(FilamentUsage.print_id, FilamentUsage.spool_id, FilamentUsage.filament_type,
                                         FilamentUsage.color_hex, FilamentUsage.grams_used,
                                         FilamentUsage.ams_id))).all()
        spools = (await db.execute(select(Spool.id, Spool.filament_id, Spool.archived, Spool.updated_at,
                                          Spool.last_dried_at, Spool.created_at, Spool.remaining_weight_g,
                                          Spool.tag_number, Spool.first_used_at))).all()
        fils = (await db.execute(select(Filament.id, Filament.manufacturer, Filament.swatch, Filament.updated_at,
                                        Filament.material,
                                        Filament.created_at, Filament.color_bucket, Filament.label_printed,
                                        Filament.label_printed_at, Filament.multicolor_type,
                                        Filament.fila_type, Filament.name))).all()
        objs = (await db.execute(select(Object.id, Object.status, Object.sold_date, Object.sold_price,
                                        Object.created_at, Object.updated_at, Object.cost_total))).all()
        groups = (await db.execute(select(ObjectGroup.created_at))).all()
        from sqlalchemy import func
        from ..models.activity import ActivityLog
        from ..models.attention import AttentionDismissal
        from ..models.notif_log import NotifLog
        from ..models.print_history import Group, PrintSnapshot, PrintTag
        from ..models.rfid import RfidScan
        snaps = (await db.execute(select(PrintSnapshot.print_id, PrintSnapshot.trigger, PrintSnapshot.taken_at,
                                         PrintSnapshot.file_path))).all()
        covers = (await db.execute(select(Print.id).where(Print.cover_photo.isnot(None), Print.cover_photo != ""))).all()
        pgroups = (await db.execute(select(Group.id, Group.created_at, Group.cover_photo))).all()
        tags = (await db.execute(select(func.lower(PrintTag.tag)).distinct())).all()
        # journal d'activite : par type et par jour (il peut etre long)
        who = ActivityLog.username.in_(counted)          # comptes retenus pour les succes
        act_days = (await db.execute(select(ActivityLog.kind, func.date(ActivityLog.created_at), func.count())
                                     .where(who)
                                     .group_by(ActivityLog.kind, func.date(ActivityLog.created_at)))).all()
        pages = (await db.execute(select(ActivityLog.path).where(ActivityLog.kind == "visite", who).distinct())).all()
        late = (await db.execute(select(ActivityLog.created_at).where(
            who, func.strftime("%H", ActivityLog.created_at).in_(["00", "01", "02", "03"])))).all()
        notif_days = (await db.execute(select(func.date(NotifLog.created_at), func.count())
                                       .group_by(func.date(NotifLog.created_at)))).all()
        dismiss = (await db.execute(select(AttentionDismissal.created_at))).all()
        rfid = (await db.execute(select(RfidScan.created_at))).all()
        from ..models.print_history import MakerWorldDesign
        from ..models.object_history import Accessory
        from ..models.user import User
        mwd = {r.design_id: r for r in (await db.execute(select(
            MakerWorldDesign.design_id, MakerWorldDesign.creator_uid, MakerWorldDesign.creator_name,
            MakerWorldDesign.categories, MakerWorldDesign.print_count))).all()}
        accs = (await db.execute(select(Accessory.quantity))).all()
        acc_objs = (await db.execute(select(ObjectAccessory.object_id, ObjectAccessory.created_at))).all()
        n_users = (await db.execute(select(func.count()).select_from(User).where(User.active.is_(True)))).scalar() or 0
        spool_more = (await db.execute(select(Spool.id, Spool.created_at, Spool.price_override, Filament.price,
                                              Filament.filament_weight_g, Filament.manufacturer)
                                       .join(Filament, Filament.id == Spool.filament_id))).all()
        # actions reussies qui comptent : partages, gestes MakerWorld, pesees, corrections…
        from sqlalchemy import or_
        acts = (await db.execute(select(ActivityLog.method, ActivityLog.path, ActivityLog.created_at).where(
            ActivityLog.kind == "action", who, or_(ActivityLog.method == "DELETE",
                                              *[ActivityLog.path.like(p) for p in _ACT_PREFIXES])))).all()
        links = (await db.execute(select(ObjectAccessory.quantity, ObjectAccessory.created_at))).all()
        # lot du 21/10/2026 : catalogue, bobines reconnues, ventes, couts, comptes
        fil_more = (await db.execute(select(Filament.created_at, Filament.profile_id, Filament.fila_color_code,
                                            Filament.to_order))).all()
        spool_modes = (await db.execute(select(Spool.created_at, Spool.found_mode))).all()
        obj_more = (await db.execute(select(Object.status, Object.sold_date, Object.sold_price,
                                            Object.desired_price))).all()
        acc_imgs = (await db.execute(select(func.count()).select_from(Accessory).where(
            Accessory.image_path.isnot(None), Accessory.image_path != ""))).scalar() or 0
        pcosts = (await db.execute(select(Print.id, Print.print_date, Print.status, Print.total_cost_filament,
                                          Print.total_cost_filament_normal, Print.electric_cost)
                                   .order_by(Print.print_date, Print.id))).all()
        totp = (await db.execute(select(func.count()).select_from(User).where(
            User.active.is_(True), User.totp_enabled.is_(True)))).scalar() or 0
    # les journaux (activite, notifications) se purgent : on en garde les comptes jour par jour
    cur = defaultdict(dict)
    for k, day, n in act_days:
        if day:
            cur[k][str(day)] = n
    for day, n in notif_days:
        if day:
            cur["notif"][str(day)] = n
    for method, path, dt in acts:
        for key, m_, rx in _ACT_PATTERNS:
            if dt and method == m_ and re.match(rx, path or ""):
                day = str(_ts(dt).date())
                cur[key][day] = cur[key].get(day, 0) + 1
    late3 = next((_ts(dt).isoformat() for (dt,) in late if dt and _local(_ts(dt)).hour == 3), None)
    mem = await _journal_memory(cur, [r[0] for r in pages if r[0]], late3)
    act_days = [(k, day, n) for k in ("visite", "detail", "action") for day, n in (mem.get(k) or {}).items()]
    notif_days = list((mem.get("notif") or {}).items())
    pages = [(x,) for x in mem.get("pages") or []]
    late = [(datetime.fromisoformat(mem["late"]),)] if mem.get("late") else []
    act_kinds = {key: list((mem.get(key) or {}).items()) for key, _m, _rx in _ACT_PATTERNS}
    # photos deposees dans le dossier d'un groupe d'impressions
    gfiles = []
    videos = []
    photo_stats = []
    try:
        from ..core.config import settings
        from pathlib import Path
        data = Path(settings.DATA_DIR)
        root = data / "groups"
        if root.is_dir():
            for d_ in root.iterdir():
                if d_.is_dir():
                    for f in d_.iterdir():
                        if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                            gfiles.append(datetime.utcfromtimestamp(f.stat().st_mtime))
                        v = _video_info(f)
                        if v:
                            videos.append({"print_id": None, "group": True, **v})
        # videos des impressions : ajoutees a la main (une video devient un WebP anime)
        for s_ in snaps:
            fp = getattr(s_, "file_path", None)
            if s_.trigger == "manual" and fp:
                v = _video_info(data / fp)
                if v:
                    videos.append({"print_id": s_.print_id, "group": False, **v, "at": _ts(s_.taken_at) or v["at"]})
        # photos ajoutees : taille et luminosite (photo noire, blanche, panorama…)
        for s_ in snaps:
            fp = getattr(s_, "file_path", None)
            if s_.trigger == "manual" and fp:
                p_ = _photo_info(data / fp)
                if p_:
                    photo_stats.append({**p_, "print_id": s_.print_id, "at": _ts(s_.taken_at) or p_["at"]})
    except Exception:
        logger.exception("[SUCCES] videos")
    try:
        from . import ams_log
        changes = [datetime.fromisoformat(x) for x in await ams_log.drain()]
    except Exception:
        changes = []
    try:
        from .mw_creator import _snap_get
        my_designs = list(((await _snap_get()) or {}).get("models") or {})
    except Exception:
        my_designs = []
    # journal des succes : sechages, visites entre copains, MakerWorld (avis, points, « A faire »)
    try:
        from . import ach_log
        alog = await ach_log.drain([(s.id, _ts(s.last_dried_at)) for s in spools])
        alog = await ach_log.refresh_mw(alog)
    except Exception:
        logger.exception("[SUCCES] journal")
        alog = {}
    try:
        from .login_watch import _devices_get
        devices = len({dev for v in (await _devices_get()).values() if isinstance(v, dict) for dev in v})
    except Exception:
        devices = 0
    st = await _state_get() or {}
    versions = dict(st.get("versions") or {})
    sha = (os.getenv("COMMIT_SHA") or "")[:8]
    if sha and sha != "dev":
        versions.setdefault(sha, datetime.utcnow().isoformat())
    return {"prints": prints, "usage": usage, "spools": spools, "fils": fils, "objs": objs, "links": links,
            "groups": groups, "snaps": snaps, "covers": covers, "pgroups": pgroups, "tags": tags,
            "act_days": act_days, "pages": pages, "late": late, "notif_days": notif_days, "dismiss": dismiss,
            "rfid_scans": rfid, "gfiles": gfiles, "versions": versions, "acts": acts, "act_kinds": act_kinds, "changes": changes,
            "mwd": mwd, "accs": accs, "acc_objs": acc_objs, "n_users": n_users, "spool_more": spool_more,
            "queue": _queue_size(), "my_designs": my_designs,
            "alog": alog, "devices": devices, "photo_stats": photo_stats, "fil_more": fil_more, "spool_modes": spool_modes,
            "obj_more": obj_more, "acc_imgs": acc_imgs, "pcosts": pcosts, "totp": totp,
            "game": {"keys": st.get("keys") or {}, "wheel": st.get("wheel") or {}}, "videos": videos, "eggs": await eggs_found(), "ams_live": _ams_live()}


def _ams_live() -> int:
    """AMS branches sur l'imprimante en ce moment (0 si inconnu)."""
    try:
        from ..core.mqtt import get_state
        return sum(1 for a in (get_state().ams_list or []) if 0 <= int(a.id) < 254)
    except Exception:
        return 0


_VIDEO_CACHE: dict = {}
_PHOTO_CACHE: dict = {}


def _photo_info(path) -> dict | None:
    """Une photo : {at, w, h, lum (0-255)}, None pour une video ou un fichier
    illisible. Gardee en memoire par (chemin, date de modification)."""
    try:
        st = path.stat()
    except OSError:
        return None
    key = (str(path), st.st_mtime)
    if key in _PHOTO_CACHE:
        return _PHOTO_CACHE[key]
    out = None
    if path.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") and not _video_info(path):
        try:
            from PIL import Image, ImageStat
            with Image.open(path) as im:
                w, h = im.size
                im.draft("L", (64, 64))
                g = im.convert("L")
                g.thumbnail((64, 64))
                out = {"at": datetime.utcfromtimestamp(st.st_mtime), "w": w, "h": h,
                       "lum": round(ImageStat.Stat(g).mean[0], 1)}
        except Exception:
            out = None
    _PHOTO_CACHE[key] = out
    return out
VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm")


def _video_info(path) -> dict | None:
    """Une video ? {at: date du fichier, ms: duree ou None}. Une video ajoutee
    devient un WebP anime (voir prints.py) : on le reconnait a son drapeau
    d'animation, et sa duree est la somme de celles de ses images. Une video
    brute (repli quand l'encodage echoue) compte, sans duree connue."""
    try:
        st = path.stat()
    except OSError:
        return None
    key = (str(path), st.st_mtime, st.st_size)
    if key in _VIDEO_CACHE:
        return _VIDEO_CACHE[key]
    at = datetime.utcfromtimestamp(st.st_mtime)
    out = None
    suf = path.suffix.lower()
    if suf in VIDEO_EXT:
        out = {"at": at, "ms": None}
    elif suf == ".webp":
        try:
            with open(path, "rb") as f:
                head = f.read(12)
                if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                    anim, ms = False, 0
                    while True:
                        ch = f.read(8)
                        if len(ch) < 8:
                            break
                        tag, size = ch[:4], int.from_bytes(ch[4:8], "little")
                        if tag == b"VP8X":
                            body = f.read(size + (size & 1))
                            anim = bool(body[:1] and body[0] & 0x02)
                            if not anim:
                                break
                        elif tag == b"ANMF":
                            body = f.read(16)
                            ms += int.from_bytes(body[12:15], "little")
                            f.seek(size + (size & 1) - 16, 1)
                        else:
                            f.seek(size + (size & 1), 1)
                    if anim:
                        out = {"at": at, "ms": ms}
        except OSError:
            out = None
    if len(_VIDEO_CACHE) > 5000:
        _VIDEO_CACHE.clear()
    _VIDEO_CACHE[key] = out
    return out


_MONDAY0 = datetime(1970, 1, 5).date()       # un lundi : numero de semaine = jours // 7
_NEW_MOON = datetime(2000, 1, 6, 18, 14)       # nouvelle lune de reference (UTC)
_SYNODIC = 29.530588853                        # jours d'une lunaison


def _full_moon(dt: datetime) -> bool:
    """Pleine lune (a un jour pres) : age de la lune vers la moitie de la lunaison."""
    age = ((dt - _NEW_MOON).total_seconds() / 86400) % _SYNODIC
    return 13.8 <= age <= 15.8


def _easter(y: int):
    """Dimanche de Paques (calendrier gregorien, algorithme dit anonyme)."""
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 19 * l) // 433
    month = (h + l - 7 * m + 90) // 25
    return datetime(y, month, (h + l - 7 * m + 33 * month + 19) % 32).date()


def _rgb(hx: str):
    try:
        return tuple(int(hx[i:i + 2], 16) for i in (0, 2, 4))
    except (ValueError, TypeError):
        return None


def _hue(hx: str) -> str:
    """Famille d'une couleur : noir, blanc, gris, puis par teinte rouge,
    orange, jaune, vert, bleu, violet, rose."""
    import colorsys
    c = _rgb(hx)
    if not c:
        return "?"
    h, sat, v = colorsys.rgb_to_hsv(*(x / 255 for x in c))
    h *= 360
    if v <= 0.25:
        return "noir"
    if sat <= 0.15:
        return "blanc" if v >= 0.82 else "gris"
    if h < 15 or h >= 345:
        return "rose" if sat < 0.45 and v > 0.8 else "rouge"
    if h < 40:
        return "orange"
    if h < 70:
        return "jaune"
    if h < 170:
        return "vert"
    if h < 260:
        return "bleu"
    if h < 300:
        return "violet"
    return "rose"


def _last_sunday(y: int, month: int):
    d = (datetime(y + (month == 12), month % 12 + 1, 1) - timedelta(days=1)).date()
    return d - timedelta(days=(d.weekday() + 1) % 7)


def _mothers_day(y: int):
    """Fete des meres en France : dernier dimanche de mai, ou premier de juin
    s'il tombe a la Pentecote."""
    d = _last_sunday(y, 5)
    if d == _easter(y) + timedelta(days=49):
        d += timedelta(days=7)
    return d


def _black_friday(y: int):
    d = datetime(y, 11, 1).date()
    d += timedelta(days=(3 - d.weekday()) % 7)          # premier jeudi
    return d + timedelta(days=22)                        # 4e jeudi (Thanksgiving) + 1


def _dst_switches(y: int):
    """Changements d'heure europeens : dernier dimanche de mars et d'octobre, 1 h UTC."""
    return [datetime.combine(_last_sunday(y, m), datetime.min.time()) + timedelta(hours=1) for m in (3, 10)]


def _fathers_day(y: int):
    """Fete des peres en France : troisieme dimanche de juin."""
    d = datetime(y, 6, 1).date()
    d += timedelta(days=(6 - d.weekday()) % 7)
    return d + timedelta(days=14)


def _ts(dt) -> datetime | None:
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt)
        except ValueError:
            return None
    return dt


# ── Calcul : une serie croissante (date, valeur) par succes ─────────────────
OK = ("SUCCESS", "PARTIAL")
KO = ("FAILED", "CANCELLED", "TO_REDO")


def compute_series(d: dict, now: datetime) -> dict:
    """{id: [(date, valeur), ...]} croissant. Les dates sont en UTC naif."""
    S = defaultdict(list)

    def push(key, dt, v):
        s = S[key]
        if not s or v > s[-1][1]:
            s.append((dt, v))

    fil_of_spool = {s.id: s.filament_id for s in d["spools"]}
    # type absent d'une ligne de consommation : celui de la bobine liee (comme l'Historique)
    mat_of_fil = {f.id: getattr(f, "material", None) for f in d["fils"]}
    d["usage"] = [u if u.filament_type or not u.spool_id
                  or not mat_of_fil.get(fil_of_spool.get(u.spool_id)) else
                  SimpleNamespace(**{**u._asdict(), "filament_type": mat_of_fil[fil_of_spool[u.spool_id]]})
                  if hasattr(u, "_asdict") else
                  SimpleNamespace(**{**vars(u), "filament_type": mat_of_fil[fil_of_spool[u.spool_id]]})
                  for u in d["usage"]]
    by_print = defaultdict(list)
    for u in d["usage"]:
        by_print[u.print_id].append(u)

    n_ok = n_ko = night = early = weekend = multicolor = 0
    secs = grams = 0.0
    longest = heaviest = colors_max = run = best_run = 0
    days = {}                     # date locale -> nombre lance ce jour
    streak = best_streak = 0
    last_day = None
    models, per_model = set(), defaultdict(int)
    fails_in_row = defaultdict(int)
    palette, mats = set(), set()
    mat_g = defaultdict(float)
    first_ok = None
    per_month = defaultdict(int)
    months_of_year = defaultdict(set)
    per_weekend = defaultdict(int)
    week_run = best_weeks = 0
    last_week = None
    ko_run = pieces = mw_made = 0
    spent = 0.0
    last_start = first_day = prev_key = None
    same_run = 0
    fails_day = defaultdict(int)
    model_day = defaultdict(int)
    nights = set()
    tpu_done = False
    ok_day = defaultdict(int)
    all_colors = set()
    colors_day = defaultdict(set)
    seen_models = set()
    seasons = defaultdict(set)
    fil_text = {f.id: f"{f.fila_type or ''} {f.name or ''}" for f in d["fils"]}
    for p in d["prints"]:
        st = (p.status or "").upper()
        if st == "IN_PROGRESS" or not p.print_date:
            continue
        start = p.print_date
        dur = p.duration_seconds or 0
        end = start + timedelta(seconds=dur)
        loc = _local(start)
        ok, ko = st in OK, st in KO
        us = by_print.get(p.id, [])
        cols = {(u.color_hex or "").upper()[:6] for u in us if (u.grams_used or 0) > 0 and u.color_hex}
        w = p.total_weight_g or sum(u.grams_used or 0 for u in us)
        # cumuls (toutes impressions terminees)
        secs += dur
        grams += w
        push("print_hours", end, int(secs // 3600))
        push("print_kg", end, round(grams / 1000, 3))
        for u in us:
            fam = _family(u.filament_type)
            if fam and (u.grams_used or 0) > 0:
                mat_g[fam] += u.grams_used
                mats.add(fam)
                if fam in MATERIALS:
                    push(f"mat_{fam.lower()}", end, round(mat_g[fam] / 1000, 3))
            fid = fil_of_spool.get(u.spool_id) if u.spool_id else None
            if fid:
                palette.add(fid)
        push("materials", end, len(mats))
        push("palette", end, len(palette))
        # jour, serie de jours, heures
        day = loc.date()
        days[day] = days.get(day, 0) + 1
        push("busy_day", start, days[day])
        if last_day != day:
            streak = streak + 1 if last_day and (day - last_day).days == 1 else 1
            last_day = day
        best_streak = max(best_streak, streak)
        push("streak", start, best_streak)
        if loc.hour < 5:
            night += 1
            push("night", start, night)
        elif loc.hour < 7:
            early += 1
            push("early", start, early)
        if loc.weekday() >= 5:
            weekend += 1
            push("weekend", start, weekend)
            sat = day - timedelta(days=loc.weekday() - 5)
            per_weekend[sat] += 1
            if per_weekend[sat] >= 10:
                push("weekend10", start, 1)
        # mois, annee, semaines d'affilee
        per_month[(loc.year, loc.month)] += 1
        push("month_record", start, max(per_month.values()))
        months_of_year[loc.year].add(loc.month)
        if len(months_of_year[loc.year]) == 12:
            push("all_year", start, 1)
        week = (day - _MONDAY0).days // 7
        if last_week != week:
            week_run = week_run + 1 if last_week is not None and week - last_week == 1 else 1
            last_week = week
        best_weeks = max(best_weeks, week_run)
        push("weeks", start, best_weeks)
        # dates particulieres
        if (loc.month, loc.day) == (10, 31):
            push("halloween", start, 1)
        if (loc.month, loc.day) in ((12, 24), (12, 25)):
            push("christmas", start, 1)
        if loc.month == 3 and loc.day == 14:
            push("pi_day", start, 1)
        if loc.day == 13 and loc.weekday() == 4:
            push("friday13", start, 1)
        md = (loc.month, loc.day)
        for key, when in (("leap_day", (2, 29)), ("valentine", (2, 14)), ("may_day", (5, 1)), ("bastille", (7, 14))):
            if md == when:
                push(key, start, 1)
        if loc.hour == 0 and loc.minute == 0:
            push("midnight", start, 1)
        spent += p.total_cost or 0
        push("spent", end, round(spent, 2))
        key = _model_key(p)
        _fun(push, p, start, end, dur, loc, ok, ko, w, cols, us, key, st)
        # matieres speciales : le type du releve, et le sous-type / nom du filament de la bobine
        if ok:
            words = " ".join(f"{u.filament_type or ''} {fil_text.get(fil_of_spool.get(u.spool_id), '')}"
                             for u in us if (u.grams_used or 0) > 0).lower()
            for kw, aid in ((("silk",), "silk"), (("galaxy",), "galaxy"), (("glow", "phospho"), "glow"),
                            (("marble", "marbre"), "marble"), (("wood", "bois"), "wood"),
                            (("translucent", "transparent", "clear"), "translucent"),
                            (("sparkle", "glitter", "paillet"), "sparkle"), (("pva",), "soluble")):
                if any(k in words for k in kw):
                    push(aid, end, 1)
        # journee : reussites, couleurs ; nouveau modele reussi du premier coup
        if ok:
            ok_day[day] += 1
            if ok_day[day] >= 7:
                push("on_fire", end, 1)
            if key and key not in seen_models and dur >= 10 * 3600:
                push("first_try", end, 1)
            seasons[loc.year].add((loc.month % 12) // 3)
            if len(seasons[loc.year]) == 4:
                push("all_seasons", end, 1)
        colors_day[day] |= cols
        all_colors |= cols
        push("colors_printed", end, len(all_colors))
        push("print_days", start, len(days))
        if len(colors_day[day]) >= 10:
            push("rainbow_day", end, 1)
        if key:
            seen_models.add(key)
        # echecs remarquables
        est = p.estimated_seconds or 0
        if st == "CANCELLED" and est >= 1800 and dur >= 0.9 * est:
            push("so_close", end, 1)
        if ko and dur >= 10 * 3600:
            push("big_fall", end, 1)
        if ko and loc.weekday() == 0 and loc.hour < 9:
            push("monday_morning", end, 1)
        # pauses, anniversaire, nuits d'affilee
        if last_start is not None:
            gap = (start - last_start).days
            if gap >= 30:
                push("comeback30", start, 1)
            if gap >= 90:
                push("hibernation", start, 1)
        last_start = start
        first_day = first_day or day
        if day.year > first_day.year and (day.month, day.day) == (first_day.month, first_day.day):
            push("anniversary", start, 1)
        if loc.hour < 5:
            nights.add(day)
            if {day - timedelta(days=1), day - timedelta(days=2)} <= nights:
                push("insomniac", start, 1)
        if ko:
            fails_day[day] += 1
            if fails_day[day] >= 5:
                push("bad_day", end, 1)
        # le meme modele : trois fois de suite, trois fois dans la journee
        if ok and key:
            same_run = same_run + 1 if key == prev_key else 1
            model_day[(day, key)] += 1
            if same_run >= 3:
                push("broken_record", end, 1)
            if model_day[(day, key)] >= 3:
                push("triplets", end, 1)
        else:
            same_run = 0
        prev_key = key
        if ok and not tpu_done and any(_family(u.filament_type) == "TPU" and (u.grams_used or 0) > 0 for u in us):
            tpu_done = True
            push("rubber", end, 1)
        loc_end = _local(end)
        if loc_end.year > loc.year:
            push("new_year", end, 1)
        if dur >= 8 * 3600 and loc.hour >= 22:
            push("all_nighter", start, 1)
        # modele
        key = _model_key(p)
        if key:
            models.add(key)
            push("models", end, len(models))
        if ok:
            n_ok += 1
            first_ok = first_ok or end
            if n_ok == 1001:
                push("n1001", end, 1)
            for n_, key_ in ((42, "dont_panic"), (100, "hundred"), (777, "lucky777"), (1337, "leet"), (2000, "y2k")):
                if n_ok == n_:
                    push(key_, end, 1)
            if ko_run >= 5:
                push("phoenix", end, 1)
            ko_run = 0
            pieces += p.number_of_items or 1
            push("pieces", end, pieces)
            if p.design_id and str(p.design_id).strip() not in ("", "0", "None"):
                mw_made += 1
                push("mw_made", end, mw_made)
            est = p.estimated_seconds or 0
            if est >= 3600 and dur and abs(dur - est) <= est * 0.01:
                push("watchmaker", end, 1)
            if w >= 2000 and dur >= 24 * 3600:
                push("titan", end, 1)
            push("first_print", end, 1)
            push("prints_ok", end, n_ok)
            run += 1
            best_run = max(best_run, run)
            push("success_run", end, best_run)
            longest = max(longest, dur / 3600)
            push("longest", end, round(longest, 2))
            if key:
                per_model[key] += 1
                push("repeat", end, max(per_model.values()))
                if fails_in_row[key] >= 3:
                    push("comeback", end, 1)
                fails_in_row[key] = 0
            if 0 < w < 1:
                push("tiny", end, 1)
            if 0 < dur < 600:
                push("flash", end, 1)
        elif ko:
            n_ko += 1
            ko_run += 1
            push("failures", end, n_ko)
            run = 0
            if key:
                fails_in_row[key] += 1
        if ok:
            heaviest = max(heaviest, w)
            push("heaviest", end, round(heaviest))
        if len(cols) >= 4:
            multicolor += 1
            push("multicolor", end, multicolor)
        colors_max = max(colors_max, len(cols))
        push("colors_max", end, colors_max)
        if len(cols) >= 8:
            push("rainbow16", end, 1)
    # anciennete : un cran tous les N jours apres la premiere reussite
    if first_ok:
        for n in BY_ID["veteran"]["tiers"]:
            at = first_ok + timedelta(days=n)
            if at <= now:
                push("veteran", at, n)
        push("veteran", now, (now - first_ok).days)
    # bobines
    done = sorted((_ts(s.updated_at) or now) for s in d["spools"] if s.archived)
    for i, dt in enumerate(done, 1):
        push("spools_done", dt, i)
    live_spools = [s for s in d["spools"] if not s.archived]
    push("stock", now, len(live_spools))
    push("stock_kg", now, round(sum(max(0.0, s.remaining_weight_g or 0) for s in live_spools) / 1000, 2))
    push("rfid", now, sum(1 for s in live_spools if (s.tag_number or "").strip()))
    push("open_spools", now, sum(1 for s in live_spools if _ts(s.first_used_at)))
    stocked = {s.filament_id for s in live_spools}
    tints = set()
    for f in d["fils"]:
        if f.id in stocked:
            tints |= {t.strip() for t in (f.color_bucket or "").split(",") if t.strip()}
    push("stock_colors", now, len(tints))
    push("multicolor_fils", now, sum(1 for f in d["fils"] if (f.multicolor_type or "monochrome") != "monochrome"))
    lab = sorted((_ts(f.label_printed_at) or _ts(f.updated_at) or now) for f in d["fils"] if f.label_printed)
    for i, dt in enumerate(lab, 1):
        push("labels", dt, i)
    for i, dt in enumerate(sorted((_ts(g.created_at) or now) for g in d["groups"]), 1):
        push("groups", dt, i)
    sw = sorted((_ts(f.updated_at) or now) for f in d["fils"] if f.swatch)
    for i, dt in enumerate(sw, 1):
        push("swatches", dt, i)
    with_spool = {s.filament_id for s in d["spools"]}
    brands, first_seen = set(), sorted(((_ts(f.created_at) or now), (f.manufacturer or "").strip().lower())
                                       for f in d["fils"] if f.id in with_spool and (f.manufacturer or "").strip())
    for dt, b in first_seen:
        brands.add(b)
        push("brands", dt, len(brands))
    # objets
    for i, dt in enumerate(sorted((_ts(o.created_at) or now) for o in d["objs"]), 1):
        push("objects", dt, i)
    # marge : prix de vente - cout de revient (comme la page Objets)
    sold = sorted(((_ts(o.sold_date) or _ts(o.updated_at) or now), o.sold_price or 0,
                   (o.sold_price or 0) - (getattr(o, "cost_total", None) or 0))
                  for o in d["objs"] if o.status == "sold")
    tot = marg = 0.0
    for i, (dt, pr, mg) in enumerate(sold, 1):
        tot += pr
        marg += mg
        push("sold", dt, i)
        push("revenue", dt, round(tot, 2))
        push("margin", dt, round(marg, 2))
    per_sale_day = defaultdict(int)
    for dt, _pr, _mg in sold:
        per_sale_day[_local(dt).date()] += 1
        if per_sale_day[_local(dt).date()] >= 5:
            push("market_day", dt, 1)
    for o in d["objs"]:
        dt = _ts(o.updated_at)
        if o.status == "gifted" and dt and _local(dt).month == 12:
            push("santa", dt, 1)
        sd, cd = _ts(o.sold_date), _ts(o.created_at)
        if o.status == "sold" and sd:
            if (o.sold_price or 0) > 100:
                push("museum", sd, 1)
            if cd and _local(sd).date() == _local(cd).date():
                push("sold_hot", sd, 1)
            if cd and (sd - cd).days >= 365:
                push("finally_sold", sd, 1)
    added_day = defaultdict(int)
    for sp in sorted(d["spools"], key=lambda x: _ts(x.created_at) or now):
        c = _ts(sp.created_at)
        if c:
            added_day[_local(c).date()] += 1
            if added_day[_local(c).date()] >= 10:
                push("big_order", c, 1)
        fu, done_at = _ts(sp.first_used_at), _ts(sp.updated_at)
        if sp.archived and fu and done_at:
            if (done_at - fu).days >= 365:
                push("eternal_spool", done_at, 1)
            if 0 <= (done_at - fu).days < 7:
                push("devoured_spool", done_at, 1)
    for st_, key in (("gifted", "gifted"), ("personal", "personal")):
        for i, dt in enumerate(sorted((_ts(o.updated_at) or now) for o in d["objs"] if o.status == st_), 1):
            push(key, dt, i)
    _more(push, d, now)
    _durations(push, d, now)
    _game(push, d, now)
    _wide(push, d, now)
    _batch21(push, d, now)
    _batch21b(push, d, now)
    _fun200(push, d, now)
    acc = 0
    for dt, q in sorted(((_ts(lk.created_at) or now), (lk.quantity or 0)) for lk in d["links"]):
        acc += q
        push("accessories", dt, acc)
    return S


# Actions du journal qui comptent pour un succes : (succes, methode, chemin)
_ACT_PATTERNS = [
    ("shares", "POST", r"^/api/v1/share/(?!telegram)[^/]+/[^/]+$"),
    ("share_print", "POST", r"^/api/v1/share/print/[^/]+$"),
    ("share_group", "POST", r"^/api/v1/share/group/[^/]+$"),
    ("weighings", "POST", r"^/api/v1/filaments/spools/\d+/weight$"),
    ("tray_fixes", "POST", r"^/api/v1/filaments/map-tray/(assign|link|create)$"),
    ("restocks", "POST", r"^/api/v1/objects/accessories/\d+/stock$"),
    ("mw_detective", "POST", r"^/api/v1/prints/makerworld/assign$"),
    ("pwd_changes", "POST", r"^/api/v1/auth/change-password$"),
    ("deletes", "DELETE", r"^/api/v1/.+"),
    ("settings_changes", "PATCH", r"^/api/v1/settings$"),
    ("mw_boosts_given", "POST", r"^/api/v1/makerworld/model/\d+/boost$"),
    ("mw_likes_given", "PUT", r"^/api/v1/makerworld/model/\d+/like$"),
    ("mw_collected", "PUT", r"^/api/v1/makerworld/design/\d+/collections$"),
]
# Ce que la requete du journal ramene (LIKE), large : les motifs ci-dessus trient.
_ACT_PREFIXES = ["/api/v1/share/%", "/api/v1/makerworld/%", "/api/v1/filaments/spools/%/weight",
                 "/api/v1/filaments/map-tray/%", "/api/v1/objects/accessories/%/stock",
                 "/api/v1/prints/makerworld/assign", "/api/v1/auth/change-password", "/api/v1/settings"]


def _batch21(push, d, now) -> None:
    """Lot du 21/10/2026 : sechages, avis et points MakerWorld, « A faire »,
    catalogue, objets, couts, photos completes, comptes, visites entre copains."""
    alog = d.get("alog") or {}

    def cumul(key, dated):
        for i, dt in enumerate(sorted(x for x in dated if x), 1):
            push(key, dt, i)

    def iso(x):
        try:
            return datetime.fromisoformat(x) if x else None
        except (TypeError, ValueError):
            return None

    def day_dt(day):
        return datetime.fromisoformat(str(day))

    # sechages : un cycle par mise en sechage d'un AMS
    dry = sorted(((iso(x.get("at")), float(x.get("h") or 0)) for x in alog.get("dry") or []), key=lambda t: t[0] or now)
    hours = 0.0
    for i, (t, h) in enumerate(((t, h) for t, h in dry if t), 1):
        push("dried", t, i)
        hours += h
        push("dry_hours", t, round(hours, 1))
        if h > 12:
            push("sauna", t, 1)
    # evaluations MakerWorld publiees (tout l'historique)
    rat = sorted(((iso(r.get("at")) or now, r) for r in (alog.get("ratings") or {}).values()), key=lambda t: t[0])
    cumul("mw_rates", [t for t, _r in rat])
    cumul("five_star", [t for t, r in rat if _num(r.get("s")) >= 5])
    cumul("rating_photos", [t for t, r in rat if (r.get("img") or 0) > 0])
    cumul("long_reviews", [t for t, r in rat if (r.get("len") or 0) > 100])
    for t, r in rat:
        if 0 < _num(r.get("s")) <= 1:
            push("harsh", t, 1)
            break
    for t, r in rat:
        if r.get("tpl"):
            push("recycled", t, 1)
            break
    # points MakerWorld : gains totaux, meilleur jour, jours d'affilee
    if alog.get("income"):
        push("mw_income", now, round(_num(alog["income"])))
    pts = sorted((str(k), _num(v)) for k, v in (alog.get("points") or {}).items() if _num(v) > 0)
    best, run, prev = 0.0, 0, None
    for day, v in pts:
        t = day_dt(day)
        best = max(best, v)
        push("mw_best_day", t, round(best))
        run = run + 1 if prev and (t.date() - prev).days == 1 else 1
        prev = t.date()
        push("mw_points_streak", t, run)
    # « A faire » : plans retenus, modeles de la file imprimes ensuite
    cumul("planned", [iso(v) for v in (alog.get("planned") or {}).values()])
    ok_by_design = defaultdict(list)
    for p in d["prints"]:
        if p.design_id and p.print_date and (p.status or "").upper() in OK:
            ok_by_design[str(p.design_id)].append(p.print_date)
    done = []
    for did, seen in (alog.get("queue_seen") or {}).items():
        t0 = iso(seen)
        later = [t for t in ok_by_design.get(str(did), []) if t0 and t >= t0]
        if later:
            done.append(min(later))
    cumul("queue_done", done)
    # catalogue et bobines
    cumul("official", [_ts(f.created_at) or now for f in d.get("fil_more", [])
                       if (f.profile_id or "").strip() and (f.fila_color_code or "").strip()])
    cumul("auto_found", [_ts(s.created_at) or now for s in d.get("spool_modes", [])
                         if (s.found_mode or "") in ("rfid", "profile", "color")])
    push("to_order", now, sum(1 for f in d.get("fil_more", []) if f.to_order))
    # objets
    cumul("good_seller", [_ts(o.sold_date) or now for o in d.get("obj_more", [])
                          if o.desired_price and (o.sold_price or 0) > o.desired_price])
    push("unlucky", now, sum(1 for o in d.get("obj_more", []) if o.status == "unavailable"))
    push("acc_images", now, d.get("acc_imgs") or 0)
    # couts des impressions : economies (prix normal - prix paye), electricite
    saved = elec = 0.0
    redo = 0
    for p in d.get("pcosts", []):
        if not p.print_date:
            continue
        saved += max(0.0, (p.total_cost_filament_normal or 0) - (p.total_cost_filament or 0))
        elec += max(0.0, p.electric_cost or 0)
        push("saved", p.print_date, round(saved, 2))
        push("electric", p.print_date, round(elec, 2))
        if (p.status or "").upper() == "TO_REDO":
            redo += 1
            push("to_redo", p.print_date, redo)
    # reportage complet : les cinq photos automatiques d'une impression
    trig, last = defaultdict(set), {}
    for s_ in d.get("snaps", []):
        if s_.trigger in FULL_REPORT:
            trig[s_.print_id].add(s_.trigger)
            t = _ts(s_.taken_at) or now
            last[s_.print_id] = max(last.get(s_.print_id, t), t)
    cumul("full_report", [last[pid] for pid, ts_ in trig.items() if ts_ >= FULL_REPORT])
    # comptes
    if d.get("totp"):
        push("bunker", now, 1)
    push("devices", now, d.get("devices") or 0)
    # visites entre copains
    for key, days_key, src in (("friend_visits_in", "host_days", "visit_in"),
                               ("friend_visits_out", "visitor_days", "visit_out")):
        tot = 0
        for i, (day, n) in enumerate(sorted((alog.get(src) or {}).items()), 1):
            tot += n
            push(key, day_dt(day), tot)
            push(days_key, day_dt(day), i)
    if alog.get("night_out"):
        push("night_owl_visit", iso(alog["night_out"]) or now, 1)
    both = sorted(set(alog.get("visit_in") or {}) & set(alog.get("visit_out") or {}))
    if both:
        push("mutual_visit", day_dt(both[0]), 1)
    # tout partage : une impression et un groupe
    kinds = {k: dict(d.get("act_kinds", {}).get(k, [])) for k in ("share_print", "share_group")}
    if all(kinds.values()):
        push("share_all", day_dt(max(min(v) for v in kinds.values())), 1)


FULL_REPORT = {"layer1", "layer2", "pct50", "pct99", "pct100"}
FAMOUS = [("benchy_print", r"benchy"), ("calib_print", r"calib|xyz[ _-]?cube|cube de test|test cube"),
          ("dragon_print", r"dragon"), ("skull_print", r"skull|cr[aâ]ne")]


def _batch21b(push, d, now) -> None:
    """Photos (noire, blanche, panorama, haute definition, rafale), modeles
    celebres, coup de balai, reglages, double sechage."""
    photos = sorted(d.get("photo_stats") or [], key=lambda p: p["at"])
    per_min = defaultdict(int)
    for p in photos:
        t = p["at"]
        if p["lum"] < 12:
            push("black_photo", t, 1)
        if p["lum"] > 243:
            push("white_photo", t, 1)
        if p["h"] and p["w"] / p["h"] >= 2.5:
            push("panorama", t, 1)
        if p["w"] * p["h"] >= 12_000_000:
            push("hires_photo", t, 1)
        k = (p.get("print_id"), t.replace(second=0, microsecond=0))
        per_min[k] += 1
        if p.get("print_id") is not None and per_min[k] >= 10:
            push("photo_burst", t, 1)
    for p in d["prints"]:
        if (p.status or "").upper() not in OK or not p.print_date:
            continue
        name = f"{p.translated_name or ''} {p.file_name or ''}".lower()
        end = p.print_date + timedelta(seconds=p.duration_seconds or 0)
        for key, rx in FAMOUS:
            if re.search(rx, name):
                push(key, end, 1)
    for key, sec, n in (("deletes", "purge_day", 20), ("settings_changes", "tinkerer", 10)):
        for day, c in sorted(d.get("act_kinds", {}).get(key, []), key=lambda r: str(r[0])):
            if c >= n:
                push(sec, datetime.fromisoformat(str(day)), 1)
                break
    dry = [(datetime.fromisoformat(x["at"]), float(x.get("h") or 0), x.get("ams"))
           for x in (d.get("alog") or {}).get("dry") or [] if (x.get("ams") if x.get("ams") is not None else -1) >= 0]
    for i, (t, h, a) in enumerate(dry):
        if any(b != a and t0 <= t <= t0 + timedelta(hours=max(h0, 0.5)) for t0, h0, b in dry[:i]):
            push("duo_dry", t, 1)
            break


def _more(push, d, now) -> None:
    """Photos, appli, mises a jour, et quelques compteurs de rangement."""
    def cumul(key, dated):
        for i, dt in enumerate(sorted(x for x in dated if x), 1):
            push(key, dt, i)

    def by_day(key, rows):
        tot = 0
        for day, n in sorted((r for r in rows if r[0]), key=lambda r: str(r[0])):
            tot += n
            push(key, datetime.fromisoformat(str(day)), tot)

    ends = {p.id: p.print_date + timedelta(seconds=p.duration_seconds or 0) for p in d["prints"] if p.print_date}
    manual = [s_ for s_ in d.get("snaps", []) if s_.trigger == "manual"]
    cumul("photos_manual", [_ts(s_.taken_at) for s_ in manual] + list(d.get("gfiles", [])))
    cumul("photos_camera", [_ts(s_.taken_at) for s_ in d.get("snaps", []) if s_.trigger != "manual"])
    first_photo, per_print = {}, defaultdict(int)
    for s_ in sorted(manual, key=lambda x: _ts(x.taken_at) or now):
        t = _ts(s_.taken_at) or now
        first_photo.setdefault(s_.print_id, t)
        per_print[s_.print_id] += 1
        push("photos_max", t, max(per_print.values()))
        e = ends.get(s_.print_id)
        if e and timedelta(0) <= t - e <= timedelta(minutes=10):
            push("paparazzi", t, 1)
        if e and t - e >= timedelta(days=365):
            push("souvenirs", t, 1)
    cumul("photo_prints", list(first_photo.values()))
    # videos
    vids = sorted(d.get("videos") or [], key=lambda v: v["at"])
    cumul("videos", [v["at"] for v in vids])
    firsts = {}
    for v in vids:
        if v["print_id"] is not None:
            firsts.setdefault(v["print_id"], v["at"])
    cumul("video_prints", sorted(firsts.values()))
    stills = {s_.print_id for s_ in manual if not any(
        v["print_id"] == s_.print_id and v["at"] == (_ts(s_.taken_at) or now) for v in vids)}
    per_day = defaultdict(int)
    for v in vids:
        t, e = v["at"], ends.get(v["print_id"])
        if e and timedelta(0) <= t - e <= timedelta(minutes=10):
            push("action_cam", t, 1)
        if e and t - e >= timedelta(days=365):
            push("retro_video", t, 1)
        if v["print_id"] in stills:
            push("making_of", t, 1)
        if v["group"]:
            push("family_film", t, 1)
        if v["ms"] is not None and 0 < v["ms"] < 3000:
            push("flash_video", t, 1)
        per_day[_local(t).date()] += 1
        if per_day[_local(t).date()] >= 5:
            push("festival", t, 1)
    covers = len(d.get("covers", [])) + sum(1 for g in d.get("pgroups", []) if (g.cover_photo or "").strip())
    push("covers", now, covers)
    cumul("print_groups", [_ts(g.created_at) or now for g in d.get("pgroups", [])])
    # appli : visites, fiches, actions, jours d'ouverture
    for kind, key in (("visite", "visits"), ("detail", "details"), ("action", "actions")):
        by_day(key, [(day, n) for k, day, n in d.get("act_days", []) if k == kind])
    days = sorted({str(day) for _k, day, _n in d.get("act_days", []) if day})
    for i, day in enumerate(days, 1):
        push("visit_days", datetime.fromisoformat(day), i)
    if {"/", "/prints", "/filaments", "/objects", "/stats", "/settings", "/logs"} <= {r[0] for r in d.get("pages", [])}:
        push("grand_tour", now, 1)
    for (dt,) in d.get("late", []):
        if dt and _local(dt).hour == 3:
            push("night_visit", dt, 1)
            break
    by_day("notifs", d.get("notif_days", []))
    if "act_kinds" in d:            # gardes jour par jour (le journal se purge)
        for key, _m, _rx in _ACT_PATTERNS:
            by_day(key, d["act_kinds"].get(key, []))
    else:
        kinds = defaultdict(list)
        for method, path, dt in d.get("acts", []):
            for key, m_, rx in _ACT_PATTERNS:
                if method == m_ and re.match(rx, path or ""):
                    kinds[key].append(_ts(dt))
        for key, _m, _rx in _ACT_PATTERNS:
            cumul(key, kinds[key])
    cumul("dismissals", [_ts(r[0]) for r in d.get("dismiss", [])])
    cumul("rfid_scans", [_ts(r[0]) for r in d.get("rfid_scans", [])])
    # mises a jour : chaque nouvelle version vue (la premiere n'en est pas une)
    seen = sorted(datetime.fromisoformat(v) for v in (d.get("versions") or {}).values())
    for i, dt in enumerate(seen[1:], 1):
        push("updates", dt, i)
    for a, b in zip(seen[1:], seen[2:]):
        if _local(a).date() == _local(b).date():
            push("double_update", b, 1)
    try:
        from .version_check import _CACHE as V
        if (V.get("v") or {}).get("status") == "identical":
            push("cutting_edge", now, 1)
    except Exception:
        pass


def _game(push, d, now) -> None:
    """Cles et roue : des compteurs tenus a jour au fil du jeu (rien a relire
    dans l'historique), et les exploits dates au moment ou ils arrivent."""
    g = d.get("game") or {}
    k, w = g.get("keys") or {}, g.get("wheel") or {}
    for key, v in (("wheel_played", w.get("played")), ("wheel_keys", w.get("keys")),
                   ("keys_earned", k.get("earned")), ("keys_spent", k.get("spent_total")),
                   ("keys_max", k.get("max_balance")), ("reveals", k.get("reveal_steps")),
                   ("tickets_won", w.get("tickets_won")), ("tickets_used", w.get("tickets_used"))):
        if v:
            push(key, now, int(v))
    for aid, at in {**(w.get("flags") or {}), **(k.get("flags") or {})}.items():
        t = _ts(at)
        if t:
            push(aid, t, 1)


def _by_local_day(start: datetime, end: datetime) -> list:
    """[(date locale, heures)] : une impression decoupee par journee (heure locale)."""
    if end <= start:
        return []
    tz = _tz()
    a, b = start.replace(tzinfo=timezone.utc).astimezone(tz), end.replace(tzinfo=timezone.utc).astimezone(tz)
    out, day = [], a.date()
    while day <= b.date():
        d0 = datetime(day.year, day.month, day.day, tzinfo=tz)
        d1 = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=tz)
        lo, hi = max(a, d0), min(b, d1)
        if hi > lo:
            out.append((day, (hi - lo).total_seconds() / 3600))
        day += timedelta(days=1)
    return out


def _night_overlap(start: datetime, end: datetime) -> float:
    """Heures d'une impression comprises entre minuit et 6 h (heure locale)."""
    if end <= start:
        return 0.0
    tz = _tz()
    a, b = start.replace(tzinfo=timezone.utc).astimezone(tz), end.replace(tzinfo=timezone.utc).astimezone(tz)
    tot, day = 0.0, a.date()
    while day <= b.date():
        n0 = datetime(day.year, day.month, day.day, tzinfo=tz)
        n1 = n0 + timedelta(hours=6)
        lo, hi = max(a, n0), min(b, n1)
        if hi > lo:
            tot += (hi - lo).total_seconds() / 3600
        day += timedelta(days=1)
    return tot


ENGINEERING = {"ABS", "ASA", "PA", "PC", "PPS", "PET"}


def _fun200(push, d, now) -> None:
    """Fournee de secrets pour passer les 200 : dates, heures, durees, poids,
    couleurs, matieres, compteurs, series, ventes, bobines, MakerWorld."""
    from collections import deque
    by_print = defaultdict(list)
    for u in d["usage"]:
        by_print[u.print_id].append(u)
    mwd = d.get("mwd") or {}
    mine = set(d.get("my_designs") or [])
    n_all = n_ok = 0
    firsts = set()
    month_days = defaultdict(set)
    month_ok, month_ko, month_last = defaultdict(int), defaultdict(int), {}
    hours = set()
    models_day = defaultdict(set)
    fails_model = defaultdict(int)
    ko_times = deque()
    groups = defaultdict(int)
    prev_printer = None
    for p in d["prints"]:
        st = (p.status or "").upper()
        if st == "IN_PROGRESS" or not p.print_date:
            continue
        start, dur = p.print_date, p.duration_seconds or 0
        end = start + timedelta(seconds=dur)
        ok, ko = st in OK, st in KO
        loc, le = _local(start), _local(end)
        us = by_print.get(p.id, [])
        cols = {(u.color_hex or "").upper()[:6] for u in us if (u.grams_used or 0) > 0 and u.color_hex}
        hues = {_hue(c) for c in cols}
        fams = {_family(u.filament_type) for u in us if (u.grams_used or 0) > 0 and _family(u.filament_type)}
        w = p.total_weight_g or sum(u.grams_used or 0 for u in us)
        est = p.estimated_seconds or 0
        key = _model_key(p)
        md, day, hm = (loc.month, loc.day), loc.date(), (loc.hour, loc.minute)
        n_all += 1
        # dates
        for when, aid in (((1, 1), "new_years_day"), ((5, 4), "star_wars"), ((5, 25), "towel_day"), ((7, 22), "pi_approx"),
                          ((8, 8), "cat_day"), ((8, 15), "mid_august"), ((9, 1), "back_to_school"), ((11, 1), "all_saints"),
                          ((11, 2), "dia_muertos"), ((12, 6), "st_nicholas"), ((6, 24), "st_john"), ((4, 22), "earth_day"),
                          ((3, 20), "equinox"), ((9, 22), "equinox")):
            if md == when:
                push(aid, start, 1)
        for sw, aid in zip(_dst_switches(loc.year), ("dst_summer", "dst_winter")):
            if start < sw < end:
                push(aid, end, 1)
        if day == datetime(loc.year, 1, 1).date() + timedelta(days=255):
            push("programmers", start, 1)
        if day == _mothers_day(loc.year):
            push("mothers_day", start, 1)
        if day == _easter(loc.year) + timedelta(days=39):
            push("ascension", start, 1)
        if day == _easter(loc.year) - timedelta(days=47):
            push("mardi_gras", start, 1)
        if day == _black_friday(loc.year):
            push("black_friday", start, 1)
        if loc.day == loc.month:
            push("double_day", start, 1)
        if md == (12, 12) and hm == (12, 12):
            push("twelve", start, 1)
        # heures
        hh = f"{loc.hour:02d}{loc.minute:02d}"
        if hh == hh[::-1]:
            push("palindrome_time", start, 1)
        for when, aid in (((0, 1), "after_midnight"), ((16, 0), "snack_time"), ((17, 0), "tea_time"), ((18, 0), "aperitif")):
            if hm == when:
                push(aid, start, 1)
        if loc.hour == 3:
            push("wolf_hour", start, 1)
        if (le.hour, le.minute) == (12, 0):
            push("end_noon", end, 1)
        if (le.hour, le.minute) == (18, 0):
            push("end_evening", end, 1)
        # durees et poids
        for target, aid in ((3 * 3600 + 33 * 60, "triple3"), (83 * 60, "suite123")):
            if abs(dur - target) <= 30:
                push(aid, end, 1)
        if ok and abs(dur - 42 * 60) <= 30:
            push("min42", end, 1)
        if ok and 0.95 <= w <= 1.05:
            push("gram1", end, 1)
        if ok and 99.5 <= w <= 100.5:
            push("g100", end, 1)
        if ok and 499.5 <= w <= 500.5:
            push("g500", end, 1)
        gi = int(round(w))
        if gi >= 1001 and abs(w - gi) < 0.05 and str(gi) == str(gi)[::-1]:
            push("g_palindrome", end, 1)
        if w >= 10 and int(round(dur / 60)) == gi:
            push("equal", end, 1)
        if ok and est >= 3600 and 0 < dur <= est / 2:
            push("supersonic", end, 1)
        if ok and 0 < dur < 120:
            push("wink", end, 1)
        if w >= 3000:
            push("mammoth", end, 1)
        # couleurs
        if {"rouge", "orange", "jaune", "vert", "bleu", "violet"} <= hues:
            push("rainbow6", end, 1)
        if ok and w >= 100 and hues == {"noir"}:
            push("vader", end, 1)
        if ok and w >= 100 and hues == {"blanc"}:
            push("snow", end, 1)
        for only, aid in (("gris", "mouse"), ("orange", "clockwork"), ("violet", "prince"), ("jaune", "chick")):
            if ok and hues == {only}:
                push(aid, end, 1)
        for combo, aid in (({"noir", "jaune", "rouge"}, "belgium"), ({"vert", "blanc", "rouge"}, "italy"),
                           ({"rouge", "jaune", "vert"}, "reggae"), ({"jaune", "noir"}, "bee"),
                           ({"rouge", "noir"}, "ladybug"), ({"bleu", "blanc"}, "sailor")):
            if hues == combo:
                push(aid, end, 1)
        if len(cols) >= 16:
            push("rainbow_ultimate", end, 1)
        if len(fams) >= 2:
            push("mix2", end, 1)
        if len(fams) >= 3:
            push("lab3", end, 1)
        if ok:
            for fam, aid in (("ABS", "abs_first"), ("ASA", "asa_first"), ("PC", "pc_first"), ("PA", "nylon_first")):
                if fam in fams and aid not in firsts:
                    firsts.add(aid)
                    push(aid, end, 1)
        # compteurs
        if ok:
            n_ok += 1
            for n_, aid in ((7, "seventh"), (13, "lucky13"), (123, "onetwothree"), (256, "byte256"), (314, "pi314"),
                            (666, "devil666"), (999, "almost1000"), (1024, "kilobyte"), (10000, "ten_thousand")):
                if n_ok == n_:
                    push(aid, end, 1)
        if n_all == 404 and ko:
            push("err404", end, 1)
        if key:
            models_day[day].add(key)
            if len(models_day[day]) >= 10:
                push("forager", end, 1)
        month_days[(loc.year, loc.month)].add(loc.day)
        import calendar
        if len(month_days[(loc.year, loc.month)]) == calendar.monthrange(loc.year, loc.month)[1]:
            push("perfect_month", start, 1)
        hours.add(loc.hour)
        if len(hours) == 24:
            push("all_hours", start, 1)
        try:
            if int(str(getattr(p, "plate_id", "") or "1").strip()) >= 7:
                push("plate7", end, 1)
        except ValueError:
            pass
        pm = (getattr(p, "printer_model", None) or "").strip().upper()
        if prev_printer and pm and pm != prev_printer:
            push("unfaithful", start, 1)
        prev_printer = pm or prev_printer
        gid = getattr(p, "group_id", None)
        if gid:
            groups[gid] += 1
            if groups[gid] >= 20:
                push("mega_group", end, 1)
        if len((getattr(p, "status_note", None) or "").strip()) > 200:
            push("novelist", end, 1)
        # hauts et bas
        mk = (loc.year, loc.month)
        month_last[mk] = end
        if ok:
            month_ok[mk] += 1
            if key and fails_model[key] >= 5:
                push("revenge", end, 1)
        elif ko:
            month_ko[mk] += 1
            if key:
                fails_model[key] += 1
            ko_times.append(end)
            while ko_times and ko_times[0] < end - timedelta(days=7):
                ko_times.popleft()
            if len(ko_times) >= 10:
                push("black_week", end, 1)
        # MakerWorld
        did = str(p.design_id or "").strip()
        if ok and did and did not in ("0", "None"):
            if did in mine:
                push("self_print", end, 1)
            m = mwd.get(did)
            if m is not None and (m.print_count or 0) > 100000:
                push("bestseller", end, 1)
            if m is not None and 0 < (m.print_count or 0) < 5:
                push("pioneer", end, 1)
    for mk, n in month_ok.items():
        if n >= 20 and not month_ko.get(mk):
            push("flawless_month", month_last[mk], 1)
    # ventes, bobines
    for o in d["objs"]:
        sd = _ts(o.sold_date)
        if o.status == "sold" and sd and o.sold_price:
            if round(o.sold_price * 100) % 100 == 99:
                push("psycho_price", sd, 1)
            if abs(o.sold_price - 1) < 0.005:
                push("one_euro", sd, 1)
    for r in d.get("spool_more") or []:
        at = _ts(r.created_at) or now
        price = r.price_override if r.price_override is not None else r.price
        if (r.filament_weight_g or 0) >= 3000:
            push("big_spool", at, 1)
        if price and price > 40:
            push("gold_spool", at, 1)
        if price and 0 < price < 10:
            push("bargain", at, 1)
    per_month = defaultdict(int)
    for sp in d["spools"]:
        if sp.archived and _ts(sp.updated_at):
            t = _ts(sp.updated_at)
            per_month[(t.year, t.month)] += 1
            if per_month[(t.year, t.month)] >= 10:
                push("spring_clean", t, 1)
    for _k, day_, _n in d.get("act_days") or []:
        if day_ and str(day_)[5:] == "12-25":
            push("christmas_visit", datetime.fromisoformat(str(day_)), 1)
    for k, at in (d.get("eggs") or {}).items():
        if k in EGGS:
            push(f"egg_{k}", datetime.fromisoformat(at), 1)


def _wide(push, d, now) -> None:
    """Fournee de succes a paliers : couleurs, estimations, moments de la
    journee, annulations, records, taux, mois et week-ends, kilos, matieres
    techniques, MakerWorld (modeles, createurs, categories, popularite),
    bobines, accessoires, objets, notes, comptes."""
    by_print = defaultdict(list)
    for u in d["usage"]:
        by_print[u.print_id].append(u)
    mwd = d.get("mwd") or {}
    c = defaultdict(int)
    months, weekends = set(), set()
    kg_m, kg_d = defaultdict(float), defaultdict(float)
    eng = 0.0
    designs, creators, cats, seen_mw = set(), set(), set(), set()
    record = 0.0
    wk_bad = {}
    for p in d["prints"]:
        st = (p.status or "").upper()
        if st == "IN_PROGRESS" or not p.print_date:
            continue
        start, dur = p.print_date, p.duration_seconds or 0
        end = start + timedelta(seconds=dur)
        ok = st in OK
        loc = _local(start)
        us = by_print.get(p.id, [])
        cols = {(u.color_hex or "").upper()[:6] for u in us if (u.grams_used or 0) > 0 and u.color_hex}
        w = p.total_weight_g or sum(u.grams_used or 0 for u in us)
        est = p.estimated_seconds or 0

        def inc(key, at):
            c[key] += 1
            push(key, at, c[key])
        if len(cols) >= 2:
            inc("bicolor", end)
        if est >= 600 and dur and abs(dur - est) <= 0.05 * est:
            inc("reliable", end)
        if ok and est >= 600 and 0 < dur < est:
            inc("faster", end)
        if 7 <= loc.hour < 12:
            inc("morning", start)
        elif 12 <= loc.hour < 14:
            inc("lunch", start)
        elif 18 <= loc.hour < 22:
            inc("evening", start)
        # nuit complete : deja lancee a 23 h, encore en cours a 6 h le lendemain
        # (la nuit d'une impression lancee avant midi est celle de la veille)
        night0 = loc.replace(hour=23, minute=0, second=0, microsecond=0)
        if loc.hour < 12:
            night0 -= timedelta(days=1)
        if loc <= night0 and _local(end) >= night0 + timedelta(hours=7):
            inc("overnight", end)
        # changement d'avis : arretee (ratee ou annulee) dans les 15 minutes
        if st in KO and p.duration_seconds is not None and dur < 15 * 60:
            inc("cancelled", end)
        if ok and dur > record:
            if record:
                inc("records", end)
            record = dur
        # semaines (du lundi) : imprimee, et un echec la gache
        wk = (loc.date() - _MONDAY0).days // 7
        wk_bad[wk] = wk_bad.get(wk, False) or st in KO
        months.add((loc.year, loc.month))
        push("months_active", start, len(months))
        if loc.weekday() >= 5:
            weekends.add(loc.date() - timedelta(days=loc.weekday() - 5))
            push("weekends_active", start, len(weekends))
        kg_m[(loc.year, loc.month)] += w / 1000
        push("kg_month", end, round(kg_m[(loc.year, loc.month)], 2))
        kg_d[loc.date()] += w / 1000
        push("kg_day", end, round(kg_d[loc.date()], 2))
        for u in us:
            fam = _family(u.filament_type)
            t = (u.filament_type or "").upper()
            if fam in ENGINEERING or "CF" in t or "GF" in t:
                eng += (u.grams_used or 0) / 1000
        push("engineering", end, round(eng, 2))
        if (getattr(p, "status_note", None) or "").strip():
            inc("notes", end)
        did = str(p.design_id or "").strip()
        if ok and did and did not in ("0", "None"):
            designs.add(did)
            push("mw_designs_printed", end, len(designs))
            m = mwd.get(did)
            if m is not None:
                if m.creator_uid or m.creator_name:
                    creators.add(m.creator_uid or m.creator_name)
                    push("creators", end, len(creators))
                cats.update(x.strip().lower() for x in (m.categories or "").split(",") if x.strip())
                push("mw_categories", end, len(cats))
                pc = m.print_count or 0
                if did not in seen_mw:                  # un modele ne compte qu'une fois
                    seen_mw.add(did)
                    if pc > 10000:
                        inc("trending", end)
                    if 0 < pc < 50:
                        inc("gems", end)
    # semaines sans accroc : chacune compte une fois finie (le lundi suivant)
    clean = 0
    for wk in sorted(wk_bad):
        at = datetime.combine(_MONDAY0 + timedelta(days=7 * (wk + 1)), datetime.min.time())
        if at > now:
            break
        if not wk_bad[wk]:
            clean += 1
            push("clean_weeks", at, clean)
    push("queue_size", now, d.get("queue") or 0)
    push("household", now, d.get("n_users") or 0)
    # bobines : toutes, kilos et euros achetes, marques
    tot = kg = eur = 0.0
    bambu = other = 0
    for r in sorted(d.get("spool_more") or [], key=lambda x: _ts(x.created_at) or now):
        at = _ts(r.created_at) or now
        tot += 1
        push("spools_total", at, int(tot))
        kg += (r.filament_weight_g or 1000) / 1000
        push("spool_kg", at, round(kg, 1))
        eur += (r.price_override if r.price_override is not None else (r.price or 0)) or 0
        push("spool_spent", at, round(eur, 2))
        if "bambu" in (r.manufacturer or "").lower():
            bambu += 1
            push("bambu_spools", at, bambu)
        elif (r.manufacturer or "").strip():
            other += 1
            push("other_spools", at, other)
    push("catalog", now, len(d["fils"]))
    # accessoires et objets
    push("accessory_refs", now, len(d.get("accs") or []))
    push("accessory_units", now, sum((r.quantity or 0) for r in d.get("accs") or []))
    push("assembled", now, len({r.object_id for r in d.get("acc_objs") or []}))
    push("showcase", now, sum(1 for o in d["objs"] if o.status == "available"))
    best = 0.0
    for o in sorted((o for o in d["objs"] if o.status == "sold"), key=lambda o: _ts(o.sold_date) or now):
        best = max(best, o.sold_price or 0)
        push("best_sale", _ts(o.sold_date) or now, round(best, 2))


def _durations(push, d, now) -> None:
    """Durees (longues, express, nuit, d'affilee, perdues, par jour et par
    mois), poids, plateaux, imprimantes ; changements de filament."""
    longs = express = feather = sturdy = multi = 0
    night = lost = 0.0
    per_day, per_month = defaultdict(float), defaultdict(float)
    group_g = defaultdict(float)
    run_start = run_end = None
    best_run = 0.0
    for p in d["prints"]:
        st = (p.status or "").upper()
        if st == "IN_PROGRESS" or not p.print_date:
            continue
        start, dur = p.print_date, p.duration_seconds or 0
        end = start + timedelta(seconds=dur)
        ok, ko = st in OK, st in KO
        w = p.total_weight_g or 0
        loc, loc_end = _local(start), _local(end)
        if dur >= 10 * 3600:
            longs += 1
            push("long_prints", end, longs)
        if ok and 0 < dur < 1800:
            express += 1
            push("express", end, express)
        if ok and 0 < w < 5:
            feather += 1
            push("feather", end, feather)
        if w > 500:
            sturdy += 1
            push("sturdy", end, sturdy)
        if str(getattr(p, "plate_id", "") or "1").strip() not in ("", "0", "1"):
            multi += 1
            push("multi_plate", end, multi)
        gid = getattr(p, "group_id", None)
        if ok and gid:
            group_g[gid] += w
            push("heavy_group", end, round(max(group_g.values())))
        night += _night_overlap(start, end)
        push("night_hours", end, int(night))
        if ko:
            lost += dur / 3600
            push("lost_hours", end, int(lost))
        # heures reellement imprimees dans chaque journee et chaque mois (heure locale)
        for day, h in _by_local_day(start, end):
            per_day[day] += h
            per_month[(day.year, day.month)] += h
            push("day_hours", end, min(24, int(per_day[day] + 1e-6)))
            push("month_hours", end, int(per_month[(day.year, day.month)] + 1e-6))
        # machine occupee d'affilee : impressions qui s'enchainent a moins de 30 min
        if run_end is not None and start <= run_end + timedelta(minutes=30):
            run_end = max(run_end, end)
        else:
            run_start, run_end = start, end
        best_run = max(best_run, (run_end - run_start).total_seconds() / 3600)
        push("nonstop", run_end, int(best_run))
        # secrets d'heure de fin et de duree
        if ok and abs(dur - 3600) <= 30:
            push("one_hour", end, 1)
        if (loc_end.hour == 23 and loc_end.minute == 59) or (loc_end.hour == 0 and loc_end.minute == 0):
            push("cinderella", end, 1)
        if (loc_end.hour, loc_end.minute) == (7, 0):
            push("wake_up", end, 1)
    # AMS : ceux qui ont servi (historique des filaments) et ceux branches (en direct) ;
    # 254 et 255 sont les porte-bobines externes
    when = {p.id: p.print_date for p in d["prints"] if p.print_date}
    ams = set()
    for u in sorted((u for u in d["usage"] if when.get(u.print_id)), key=lambda u: when[u.print_id]):
        a = getattr(u, "ams_id", None)
        if a is not None and 0 <= a < 254 and a not in ams:
            ams.add(a)
            push("ams_units", when[u.print_id], len(ams))
    push("ams_units", now, max(len(ams), d.get("ams_live") or 0))
    # changements de filament : total, record d'un jour, record sur 7 jours
    ch = sorted(d.get("changes") or [])
    per = defaultdict(int)
    best7 = 0
    j = 0
    for i, t in enumerate(ch):
        push("fil_changes", t, i + 1)
        per[_local(t).date()] += 1
        push("fil_changes_day", t, per[_local(t).date()])
        while ch[j] < t - timedelta(days=7):
            j += 1
        best7 = max(best7, i - j + 1)
        push("fil_changes_week", t, best7)
        if i >= 3 and t - ch[i - 3] <= timedelta(minutes=5):
            push("pit_stop", t, 1)


def _fun(push, p, start, end, dur, loc, ok, ko, w, cols, us, key, st) -> None:
    """Les secrets loufoques d'une impression : poids, durees, heures, dates,
    couleurs, matieres, nom, cout."""
    est = p.estimated_seconds or 0
    mins = int(round(dur / 60))
    # poids
    if ok and 41.5 <= w <= 42.5:
        push("answer42", end, 1)
    if 665.5 <= w <= 666.5:
        push("beast", end, 1)
    if ok and 998 <= w <= 1002:
        push("kilo", end, 1)
    if ok and 3.10 <= w <= 3.18:
        push("pi_grams", end, 1)
    # durees
    if ok and mins >= 101 and str(mins) == str(mins)[::-1]:
        push("palindrome", end, 1)
    if abs(dur - 86400) <= 60:
        push("full_day", end, 1)
    if ok and dur >= 42.195 * 3600:
        push("marathon42", end, 1)
    if ok and est >= 3600 and dur and abs(dur - est) <= 60:
        push("bullseye", end, 1)
    if ok and est >= 1800 and dur >= 2 * est:
        push("tortoise", end, 1)
    if ok and est >= 3600 and 0 < dur <= 0.8 * est:
        push("hare", end, 1)
    if ok and (p.number_of_items or 0) >= 100:
        push("hundred_pieces", end, 1)
    # heures de lancement
    hm = (loc.hour, loc.minute)
    if hm == (12, 0):
        push("noon", start, 1)
    if hm == (12, 34):
        push("sequence", start, 1)
    if hm == (13, 37):
        push("elite", start, 1)
    if hm == (23, 59):
        push("last_minute", start, 1)
    if loc.weekday() == 5 and loc.hour >= 22:
        push("saturday_night", start, 1)
    if loc.hour >= 20 or loc.hour < 5:
        age = ((start - _NEW_MOON).total_seconds() / 86400) % _SYNODIC
        if age <= 1.0 or age >= _SYNODIC - 1.0:
            push("new_moon", start, 1)
    if loc.hour == loc.minute and loc.hour > 0:
        push("mirror", start, 1)
    if loc.weekday() == 6 and 6 <= loc.hour < 8:
        push("sunday_morning", start, 1)
    if (loc.hour >= 20 or loc.hour < 5) and _full_moon(start):
        push("full_moon", start, 1)
    # dates
    md = (loc.month, loc.day)
    if md == (4, 1) and ko:
        push("april_fool", end, 1)
    if md == (6, 21):
        push("music", start, 1)
        if dur >= 12 * 3600:
            push("summer_solstice", end, 1)
    if md == (12, 21) and dur >= 12 * 3600:
        push("winter_solstice", end, 1)
    if loc.date() == _easter(loc.year):
        push("easter", start, 1)
    if loc.date() == _fathers_day(loc.year):
        push("fathers_day", start, 1)
    if md == (2, 2):
        push("crepes", start, 1)
    if md == (1, 6):
        push("epiphany", start, 1)
    ds = loc.strftime("%d%m%Y")
    if ds == ds[::-1]:
        push("palindrome_date", start, 1)
    # couleurs
    md = (loc.month, loc.day)
    hues = {_hue(c) for c in cols}
    if ok and hues == {"noir", "blanc"}:
        push("panda", end, 1)
    if ok and hues == {"bleu", "blanc", "rouge"}:
        push("tricolore", end, 1)
    if ok and hues == {"rose"}:
        push("barbie", end, 1)
    if ok and hues == {"bleu"} and w >= 100:
        push("smurf", end, 1)
    if ok and hues == {"vert"} and w >= 100:
        push("hulk", end, 1)
    if {"rouge", "orange", "jaune"} <= hues:
        push("fire", end, 1)
    if hues == {"orange", "noir"}:
        push("pumpkin", end, 1)
    if hues == {"rouge", "vert"}:
        push("xmas_tree", end, 1)
    if md == (3, 17) and "vert" in hues:
        push("st_patrick", start, 1)
    # matieres, nom, cout
    if ok and any("CF" in (u.filament_type or "").upper().replace("-", " ").split() or
                  "-CF" in (u.filament_type or "").upper() for u in us if (u.grams_used or 0) > 0):
        push("carbon", end, 1)
    if len((p.translated_name or p.file_name or "").strip()) > 80:
        push("novel", end, 1)
    cost = p.total_cost or 0
    if ok and 0 < cost < 0.10:
        push("penny", end, 1)
    if cost > 50:
        push("luxury", end, 1)


async def _live_values() -> dict:
    """Ce qui ne se lit qu'au present : profil MakerWorld, copains."""
    out = {}
    try:
        from .makerworld_account import token
        if await token():
            from .mw_creator import profile
            p = await profile()
            out.update({"mw_designs": p.get("designs") or 0, "mw_downloads": p.get("downloads") or 0,
                        "mw_prints": p.get("prints") or 0, "mw_boosts": p.get("boosts") or 0,
                        "mw_fans": p.get("fans") or 0, "mw_likes": p.get("likes") or 0,
                        "mw_level": p.get("level") or 0, "mw_collections": p.get("collections") or 0,
                        "mw_follows": p.get("follows") or 0,
                        "mw_points_bal": int((p.get("points") or {}).get("total") or 0),
                        "profile_downloads": p.get("profile_downloads") or 0})
    except Exception as e:
        logger.info(f"[SUCCES] profil MakerWorld illisible : {e}")
    try:
        from .makerworld_account import collections, token
        if await token():
            out["mw_my_collections"] = len((await collections())["collections"])
    except Exception as e:      # MakerWorld injoignable : on garde ce qui est acquis
        logger.info(f"[SUCCES] collections MakerWorld illisibles : {e}")
    try:
        from .friends import list_friends
        out["friends"] = len(await list_friends())
    except Exception:
        pass
    return out


# ── Etat ─────────────────────────────────────────────────────────────────────
def _queue_size() -> int:
    """Modeles de « A faire », d'apres le dernier calcul garde sur disque."""
    try:
        from .mw_queue import _snap_get
        return len((_snap_get() or {}).get("models") or [])
    except Exception:
        return 0


async def counted_users() -> list:
    """Les comptes dont l'activite fait avancer les succes (journal : visites,
    fiches, actions ; easter eggs). Reglage ACHIEVEMENTS_USERS ; par defaut, les
    administrateurs : un copain qui visite ou un compte en lecture seule ne
    gonfle pas mes compteurs."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.user import User
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY + "_USERS", "")
        try:
            chosen = json.loads(raw) if raw else None
        except ValueError:
            chosen = None
        if isinstance(chosen, list):
            return [str(x) for x in chosen]
        rows = (await db.execute(select(User.username, User.role).where(User.active.is_(True)))).all()
    return [u for u, r in rows if (r or "admin") == "admin"] or ["admin"]


async def set_counted_users(names: list) -> list:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    names = sorted({str(x).strip() for x in names or [] if str(x).strip()})
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY + "_USERS", json.dumps(names))
    _BASE.update(t=0.0, v=None)
    _CACHE["v"] = None
    return names


async def passages() -> dict:
    """Comptes dont le passage secret est ouvert : {compte: date}."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY + "_PASSAGE", "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def open_passage(username: str) -> bool:
    """Ouvre le passage pour ce compte ; rend True la premiere fois."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    d = await passages()
    if username in d:
        return False
    d[username] = datetime.utcnow().isoformat()
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY + "_PASSAGE", json.dumps(d))
    return True


async def eggs_found() -> dict:
    """Les easter eggs trouves : {nom: date}."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY + "_EGGS", "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def find_egg(name: str) -> dict:
    """Un geste cache vient d'etre fait. La premiere fois : on le date, et le
    passage suivant (lance tout de suite) donne la medaille, ses cles et sa
    notification. Rend de quoi feliciter sur la page."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    if name not in EGGS:
        raise ValueError("Œuf inconnu")
    found = await eggs_found()
    new = name not in found
    if new:
        found[name] = datetime.utcnow().isoformat()
        async with AsyncSessionLocal() as db:
            await set_setting(db, KEY + "_EGGS", json.dumps(found))
        _CACHE["v"] = None
        _bg_tick()
    e, title, _d, _h, lore = EGGS[name]
    return {"new": new, "id": f"egg_{name}", "emoji": e, "name": title, "lore": lore}


_BG: set = set()


async def _journal_memory(cur: dict, pages: list, late3: str | None) -> dict:
    """Le journal d'activite et celui des notifications se purgent : ce qu'ils
    comptent est garde ici, jour par jour (le plus grand nombre vu pour ce
    jour). Reprendre le max rend l'operation sans effet si on la rejoue, et
    un jour purge garde son compte : les succes ne reculent pas."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting, set_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY + "_JOURNAL", "")
    try:
        mem = json.loads(raw) if raw else {}
    except ValueError:
        mem = {}
    if not isinstance(mem, dict):
        mem = {}
    before = json.dumps(mem, sort_keys=True)
    for grp, days in cur.items():
        m = mem.setdefault(grp, {})
        for day, n in days.items():
            if n > m.get(day, 0):
                m[day] = n
    mem["pages"] = sorted(set(mem.get("pages") or []) | set(pages))
    if late3 and not mem.get("late"):
        mem["late"] = late3
    if json.dumps(mem, sort_keys=True) != before:
        async with AsyncSessionLocal() as db:
            await set_setting(db, KEY + "_JOURNAL", json.dumps(mem))
    return mem


async def _state_get():
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        d = json.loads(raw) if raw else None
    except ValueError:
        d = None
    return d if isinstance(d, dict) else None


async def _state_put(d: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(d, ensure_ascii=False))


_CACHE = {"t": 0.0, "v": None}


# Le gros du calcul (lecture de la base, series, valeurs en direct) : plusieurs
# secondes sur un gros historique. La page le reprend tel quel s'il a moins de
# BASE_TTL, sinon elle sert le dernier et le refait en fond (le suivant sera
# frais). Le passage des 15 minutes, les tickets et les epreuves recalculent
# toujours (cached=False).
BASE_TTL = 120
_BASE: dict = {"t": 0.0, "v": None, "task": None}


async def _compute_base(now: datetime) -> tuple:
    series = compute_series(await _load_data(), now)
    live = await _live_values()
    _BASE.update(t=time.time(), v=(series, live))
    return series, live


async def warm(delay_s: int = 15) -> None:
    """Au demarrage : prepare le gros calcul pour que la premiere page ouverte
    n'ait pas a l'attendre (la boucle des 15 min ne passe qu'apres 3 min)."""
    import asyncio
    await asyncio.sleep(delay_s)
    try:
        if _BASE["v"] is None:
            await _compute_base(datetime.utcnow())
    except Exception:
        logger.exception("[SUCCES] prechauffage")


async def _base(cached: bool, now: datetime) -> tuple:
    if not cached or _BASE["v"] is None:
        return await _compute_base(now)
    if time.time() - _BASE["t"] > BASE_TTL and not _BASE["task"]:
        import asyncio

        async def refresh():
            try:
                await _compute_base(datetime.utcnow())
                _CACHE["v"] = None
            except Exception:
                logger.exception("[SUCCES] rafraichissement")
            finally:
                _BASE["task"] = None
        _BASE["task"] = asyncio.create_task(refresh())
    return _BASE["v"]


async def evaluate(now: datetime | None = None, cached: bool = False) -> dict:
    """Valeurs actuelles et paliers atteints (avec leur date), sans rien ecrire."""
    series, live = await _base(cached and now is None, now or datetime.utcnow())
    now = now or datetime.utcnow()
    st = await _state_get() or {}
    bonus = st.get("bonus") or {}
    out = {}
    for a in CATALOG:
        s = series.get(a["id"], [])
        val = s[-1][1] if s else 0
        if a["id"] in live:
            val = live[a["id"]]
        # tickets de palier : ce qu'ils ont ajoute au compteur, a partir du jour ou ils ont servi
        bl = sorted((t, x) for t, x in ((_ts(d), _num(x)) for d, x in bonus.get(a["id"]) or []) if t)
        if bl:
            val = _addn(val, sum(x for _t, x in bl))
        bat = (lambda t: sum(x for d, x in bl if d <= t)) if bl else (lambda t: 0)
        reached = {}
        for i, n in enumerate(a["tiers"]):
            at = next((dt for dt, v in s if v + bat(dt) >= n), None)
            for d, _x in bl:                            # atteint le jour d'un ticket ?
                v_d = next((v for dt, v in reversed(s) if dt <= d), live.get(a["id"], 0) if a["id"] in live else 0)
                if v_d + bat(d) >= n:
                    at = min(at, d) if at else d
                    break
            if at is None and a["id"] in live and val >= n:
                at = now
            if at is not None:
                reached[str(i)] = at.isoformat()
        out[a["id"]] = {"value": val, "reached": reached}
    _sets(out, st)
    _completes(out, st)
    return out


def _num(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _addn(a, b):
    """Somme qui reste entiere quand elle le peut (3 et non 3.0)."""
    v = round((a or 0) + b, 3)
    return int(v) if float(v).is_integer() else v


async def use_ticket(aid: str) -> dict:
    """Un ticket de palier : ajoute au compteur de ce succes ce qui manquait pour
    son palier suivant. Le compte avance donc pour de bon (la prochaine
    impression part de la). Ni cle ni notification : c'est un achat."""
    a = BY_ID.get(aid)
    if not a or len(a["tiers"]) < 2:
        raise ValueError("Un ticket s'utilise sur un succès à paliers")
    async with _lock():
        st = await _state_get()
        w = _wheel_init(st) if st else {}
        if not st or w.get("tickets", 0) <= 0:
            raise ValueError("Pas de ticket de palier : un chaque lundi, et la roue en donne parfois")
        r = (await evaluate())[aid]
        got = set(r["reached"]) | set((st.get("unlocked") or {}).get(aid) or {})
        lvl = max((int(i) for i in got), default=-1)
        if lvl + 1 >= len(a["tiers"]):
            raise ValueError("Tous les paliers sont déjà atteints")
        cost = ticket_cost(lvl + 1)
        if w.get("tickets", 0) < cost:
            raise ValueError(f"Il faut {cost} tickets pour passer {tiers_of(a)[lvl + 1]['label']} "
                             f"(tu en as {w.get('tickets', 0)})")
        add = round(a["tiers"][lvl + 1] - _num(r["value"]), 3)
        if add <= 0:
            add = 0
        now = datetime.utcnow().isoformat()
        st.setdefault("bonus", {}).setdefault(aid, []).append([now, add])
        # le palier est date tout de suite : le passage ne le prendra pas pour une nouveaute (ni cle ni annonce)
        st.setdefault("unlocked", {}).setdefault(aid, {})[str(lvl + 1)] = now
        st.setdefault("ticket_tiers", {}).setdefault(aid, []).append(lvl + 1)
        st.setdefault("ticket_paid", {}).setdefault(aid, []).append(cost)
        w["tickets"] -= cost
        w["tickets_used"] = w.get("tickets_used", 0) + cost
        label = tiers_of(a)[lvl + 1]["label"]
        k = _keys_init(st)
        k["log"] = ([{"at": now, "n": 0, "why": f"Ticket : {a['name']} passe {label}"}] + (k.get("log") or []))[:KEY_LOG_MAX]
        await _state_put(st)
        _CACHE["v"] = None
    _bg_tick()
    return {"id": aid, "tier": label, "level": lvl + 1, "cost": cost, "added": _addn(0, add), "tickets": w["tickets"]}


# Prix d'un palier en tickets, selon le palier vise (rehausse le 21/10/2026) :
# Bronze 1 · Argent 2 · Or 3 · Platine 4 · Diamant 5 · Legende 6 · Mythique 7 · Cosmique 8 · Eternel 10.
TICKET_COST = [1, 2, 3, 4, 5, 6, 7, 8, 10]
# Avant cette date : ce qui a ete paye alors reste compte a ce prix-la.
OLD_TICKET_COST = [1, 1, 1, 2, 2, 3, 4, 5, 6]


def key_use(st: dict | None, aid: str) -> dict | None:
    """Ce que les cles ont revele d'un secret : {keys, steps, at}. Les cles ne
    sont comptees que depuis le 22/10/2026 ; avant, seules les etapes sont
    connues (keys : None, pas d'estimation)."""
    k = (st or {}).get("keys") or {}
    use = (k.get("uses") or {}).get(aid) or {"keys": 0, "steps": []}
    paid = int((k.get("spent") or {}).get(aid, 0) or 0)
    if not paid and not use["steps"]:
        return None
    noted = [x["step"] for x in use["steps"]]
    before = [l for _i, l, _c in REVEALS[:max(0, paid - len(noted))]]
    return {"keys": use["keys"] if not before else (use["keys"] or None), "steps": before + noted,
            "at": use["steps"][-1]["at"] if use["steps"] else None, "partial": bool(before)}


def ticket_uses(st: dict | None, aid: str) -> list:
    """Paliers passes avec des tickets : [{tier, tickets, at}] (date et prix de l'achat)."""
    tiers = ((st or {}).get("ticket_tiers") or {}).get(aid) or []
    if not tiers:
        return []
    paid = ((st or {}).get("ticket_paid") or {}).get(aid) or []
    bonus = ((st or {}).get("bonus") or {}).get(aid) or []
    old = len(tiers) - len(paid)
    a = BY_ID.get(aid)
    labels = [t["label"] for t in tiers_of(a)] if a else []
    out = []
    for j, i in enumerate(tiers):
        cost = int(paid[j - old]) if j >= old else OLD_TICKET_COST[min(max(i, 0), 8)]
        at = bonus[j][0] if j < len(bonus) and bonus[j] else None
        out.append({"tier": labels[i] if i < len(labels) else str(i), "tickets": cost, "at": at})
    return out


def tickets_paid(st: dict | None, aid: str) -> int:
    """Tickets reellement depenses sur un succes (au prix du jour de l'achat)."""
    tiers = ((st or {}).get("ticket_tiers") or {}).get(aid) or []
    paid = ((st or {}).get("ticket_paid") or {}).get(aid) or []
    old = tiers[:len(tiers) - len(paid)] if len(paid) < len(tiers) else []
    return sum(OLD_TICKET_COST[min(max(i, 0), 8)] for i in old) + sum(int(x) for x in paid)


def ticket_cost(i: int) -> int:
    return TICKET_COST[min(max(i, 0), len(TICKET_COST) - 1)]


def _sets(out: dict, st: dict) -> None:
    """Collections de medailles : date = le jour ou le dernier succes de la
    section a atteint le palier. Un succes « au present » garde ce qu'il a
    deja acquis (meme si sa valeur a baisse)."""
    stored = st.get("unlocked") or {}
    best = st.get("best") or {}

    def at(a, i):
        r = (out.get(a["id"]) or {}).get("reached", {}).get(str(i))
        if r is None and a.get("live") and _still(a["id"], i, best.get(a["id"], 0)):
            r = (stored.get(a["id"]) or {}).get(str(i))
        return r
    for a in CATALOG:
        if not a.get("set"):
            continue
        cat, i = a["set"]
        mem = [m for m in _members(cat, i)
               if not (m.get("only_started") and not (out.get(m["id"]) or {}).get("value") and not stored.get(m["id"]))]
        dates = [at(m, i) for m in mem]
        ok = bool(mem) and all(dates)
        out[a["id"]] = {"value": 1 if ok else 0, "reached": {"0": max(dates)} if ok else {}}


def _completes(out: dict, st: dict) -> None:
    """Completude : chaque membre a son dernier palier ; date = le dernier
    atteint. Jamais acquise pour de bon : recalculee a chaque passage."""
    stored = st.get("unlocked") or {}
    best = st.get("best") or {}

    def at(a, i):
        r = (out.get(a["id"]) or {}).get("reached", {}).get(str(i))
        if r is None and a.get("live") and _still(a["id"], i, best.get(a["id"], 0)):
            r = (stored.get(a["id"]) or {}).get(str(i))
        return r
    for a in CATALOG:
        c = a.get("complete")
        if not c:
            continue
        kind, key = c
        mem = [m for m in CATALOG if not m.get("complete") and (
            kind == "all" or (kind == "cat" and m["cat"] == key) or (kind == "sub" and SUB_OF.get(m["id"]) == key))]
        mem = [m for m in mem
               if not (m.get("only_started") and not (out.get(m["id"]) or {}).get("value") and not stored.get(m["id"]))]
        dates = [at(m, len(m["tiers"]) - 1) for m in mem]
        ok = bool(mem) and all(dates)
        out[a["id"]] = {"value": 1 if ok else 0, "reached": {"0": max(dates)} if ok else {}}


_TICK_LOCK = None


def _lock():
    """Un seul ecrivain de l'etat a la fois : passage, cles depensees, roue."""
    import asyncio
    global _TICK_LOCK
    if _TICK_LOCK is None:
        _TICK_LOCK = asyncio.Lock()
    return _TICK_LOCK


def _bg_tick() -> None:
    """Un passage tout de suite, en fond (medailles, cles et notifications)."""
    import asyncio
    t = asyncio.create_task(tick())
    _BG.add(t)
    t.add_done_callback(_BG.discard)


async def tick(notify: bool = True) -> list:
    """Enregistre les paliers nouvellement atteints ; notifie apres le premier
    passage. Rend la liste des (id, cran) nouveaux. Un passage a la fois (la
    boucle et un easter egg peuvent tomber ensemble : jamais deux annonces)."""
    async with _lock():
        return await _tick(notify)


async def _tick(notify: bool = True) -> list:
    ev = await evaluate()
    st = await _state_get()
    first = st is None
    st = st or {"unlocked": {}, "best": {}}
    # seuils changes depuis le dernier passage : on recalcule en silence
    silent = first or st.get("sig") != CATALOG_SIG
    new = []
    for aid, r in ev.items():
        old = dict(st["unlocked"].get(aid) or {})
        best = max(st["best"].get(aid, 0) or 0, r["value"] or 0)
        st["best"][aid] = best
        if BY_ID[aid].get("live"):
            # lu au present : acquis meme si la valeur redescend, mais toujours
            # selon les seuils du moment (meilleure valeur jamais vue)
            got = {i: at for i, at in old.items() if _still(aid, i, best)}
            for i, at in r["reached"].items():
                got.setdefault(i, at)
        else:
            # date reelle tiree de l'historique ; un palier deja connu garde la sienne
            got = {i: old.get(i, at) for i, at in r["reached"].items()}
        new += [(aid, int(i)) for i in got if i not in old]
        st["unlocked"][aid] = got
    st["unlocked"] = {k: v for k, v in st["unlocked"].items() if v and k in BY_ID}
    # Seul ce qui vient d'arriver compte (notification, cles) : un palier ou un
    # secret date de l'historique (import d'anciennes impressions, calcul
    # reconstitue) n'est pas une nouveaute, meme hors passage silencieux.
    if silent:
        new = []
    else:
        new = [(aid, i) for aid, i in new if _recent(st["unlocked"].get(aid, {}).get(str(i)))]
    ok_n = await _ok_since((st.get("keys") or {}).get("since"))
    gains = _earn_keys(st, ev, new, ok_n)
    gains += _gift_keys(st)
    _keys_peak(st["keys"])
    spins, w_tickets = _wheel_weekly(st)
    retro = _secret_rewards_retro(st, new)
    s_spins, s_tickets = _secret_rewards(st, new)
    p_spins, p_tickets = _print_rewards(st, ok_n)
    # les cles de depart ont aussi leur notification (une fois)
    if not st["keys"].get("start_notified", True):
        st["keys"]["start_notified"] = True
        gains.insert(0, (KEY_START, "Clés de départ"))
    st["sig"] = CATALOG_SIG
    sha = (os.getenv("COMMIT_SHA") or "")[:8]
    if sha and sha != "dev":
        st.setdefault("versions", {}).setdefault(sha, datetime.utcnow().isoformat())
    if first:
        st["since"] = datetime.utcnow().isoformat()
    await _state_put(st)
    _CACHE["v"] = None
    if new and notify:
        await _notify(new, ev, sum(n for n, _w in gains if not _w.startswith(("Début", "Noël", "Clés de départ"))))
    if gains and notify:
        await _notify_keys(gains, st["keys"]["balance"])
    if retro and notify:
        await _notify_retro(*retro, st["wheel"]["spins"], st["wheel"].get("tickets", 0))
    if (spins or s_spins or s_tickets or w_tickets or p_spins or p_tickets) and notify:
        await _notify_spins(spins, st["wheel"]["spins"], s_spins, s_tickets, st["wheel"].get("tickets", 0), w_tickets,
                            p_spins, p_tickets)
    return new


# ── Cles (20/10/2026) ────────────────────────────────────────────────────────
# Gagnees : 3 au depart, 1 toutes les 10 impressions reussies lancees depuis
# la mise en route des cles, 1 par palier reellement franchi, 3 par secret
# gagne, 2 au debut de chaque mois, 5 a Noel. Rien de retroactif : un
# passage silencieux (premier calcul, code ou seuils changes) ne rapporte
# rien, et seul ce qui a ete atteint dans les dernieres 48 h compte.
# Depensees sur un secret pas encore gagne, dans l'ordre : sa vignette (1),
# son titre (2), un indice (3), son descriptif (5).
KEY_START = 3
KEYS_PER_PRINTS = 10
KEYS_TIER, KEYS_SECRET = 1, 3
REVEALS = [("category", "la catégorie", 1), ("vignette", "la vignette", 3), ("title", "le titre", 6),
           ("hint", "un indice", 10), ("desc", "le descriptif", 15)]      # 35 clés pour tout devoiler (21/10/2026)
FREE_FROM_FRIENDS = 3   # un secret qu'un copain a gagne : categorie, vignette et titre offerts
REVEAL_V = 2           # 2 : la categorie devient la 1re etape (avant : vignette, titre, indice, descriptif)
KEY_LOG_MAX = 40


RECENT = timedelta(hours=48)
KEYS_MONTH, KEYS_XMAS = 2, 5


def _recent(at) -> bool:
    """Atteint il y a peu (48 h) : une vraie nouveaute, pas un rattrapage."""
    t = _ts(at)
    return bool(t) and t >= datetime.utcnow() - RECENT


async def _ok_since(since) -> int:
    """Impressions reussies lancees depuis la mise en route des cles (par date :
    un import d'anciennes impressions ne rapporte rien)."""
    from sqlalchemy import func, select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    t = _ts(since) if since else None
    if not t:
        return 0
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(func.count(Print.id)).where(
            Print.status.in_(OK), Print.print_date >= t))).scalar() or 0


def _keys_init(st: dict) -> dict:
    k = st.get("keys")
    now = datetime.utcnow()
    if not isinstance(k, dict):
        k = st["keys"] = {"balance": KEY_START, "spent": {}, "earned": KEY_START, "start_notified": False, "reveal_v": REVEAL_V,
                          "log": [{"at": now.isoformat(), "n": KEY_START, "why": "Clés de départ"}]}
    if not k.get("since"):
        # mise en route (ou reprise d'un etat d'avant le comptage par date)
        first = next((l["at"] for l in reversed(k.get("log") or []) if l.get("why") == "Clés de départ"), None)
        k["since"] = first or now.isoformat()
        k["from_prints"] = 0
        k.pop("base_ok", None)
    if k.get("reveal_v") != REVEAL_V:
        # la categorie est devenue la 1re etape : ce qui etait paye monte d'un cran (categorie offerte)
        if k.get("spent"):
            k["spent"] = {aid: min(len(REVEALS), int(l) + 1) for aid, l in k["spent"].items()}
        k["reveal_v"] = REVEAL_V
    if "gifts" not in k:
        # rien de retroactif : le mois en cours (et Noel s'il est passe) comptent comme donnes
        loc = _local(now)
        k["gifts"] = [f"month:{loc:%Y-%m}"] + ([f"xmas:{loc.year}"] if (loc.month, loc.day) >= (12, 25) else [])
    return k


def _gift_keys(st: dict) -> list:
    """Cadeaux du calendrier : 2 cles au debut de chaque mois, 5 a Noel (le 25
    decembre, ou des que possible jusqu'au 31). Une fois chacun."""
    k = _keys_init(st)
    loc = _local(datetime.utcnow())
    out = []
    for tag, n, why in ((f"month:{loc:%Y-%m}", KEYS_MONTH, "Début du mois"),
                        (f"xmas:{loc.year}", KEYS_XMAS, "Noël")):
        if tag in k["gifts"] or (tag.startswith("xmas") and (loc.month, loc.day) < (12, 25)):
            continue
        k["gifts"].append(tag)
        k["gifts"] = k["gifts"][-60:]
        k["balance"] += n
        k["earned"] = k.get("earned", 0) + n
        k["log"] = ([{"at": datetime.utcnow().isoformat(), "n": n, "why": why}] + (k.get("log") or []))[:KEY_LOG_MAX]
        out.append((n, why))
    return out


async def _notify_keys(gains: list, balance: int) -> None:
    """Notification « cles gagnees » : une par passage, avec le detail."""
    from . import notify as N
    cfg = await N._load()
    total = sum(n for n, _w in gains)
    whys = [w for _n, w in gains]
    if "Clés de départ" in whys and len(gains) == 1:
        title = f"🗝️ Tes {total} premières clés pour révéler des secrets !"
    elif "Noël" in whys:
        title = f"🎄 Joyeux Noël : +{total} clé{'s' if total > 1 else ''} !"
    elif "Début du mois" in whys:
        title = f"🎁 Bon début de mois : +{total} clé{'s' if total > 1 else ''} !"
    else:
        title = f"🔑 +{total} clé{'s' if total > 1 else ''}"
    icon = {"Noël": "🎄", "Début du mois": "🎁", "Clés de départ": "🗝️"}
    lines = [f"{icon.get(w, '🔑')} +{n} · {w}" for n, w in gains[:8]] + \
            ([f"… et {len(gains) - 8} autre(s)"] if len(gains) > 8 else [])
    lines.append(f"Tu as maintenant {balance} clé{'s' if balance > 1 else ''} : de quoi révéler des secrets.")
    await N.notify("keys_gained", title, "\n".join(lines),
                   click=N.app_link(cfg, "/stats?tab=achievements&cat=secret"), priority=2)


def _earn_keys(st: dict, ev: dict, new: list, ok_since: int = 0) -> list:
    """Ajoute les cles gagnees depuis le dernier passage ; rend [(nombre, raison)]."""
    now = datetime.utcnow().isoformat()
    k = _keys_init(st)
    gains = []

    def add(n, why):
        if n <= 0:
            return
        k["balance"] += n
        k["earned"] = k.get("earned", 0) + n
        gains.append((n, why))
        k["log"] = ([{"at": now, "n": n, "why": why}] + (k.get("log") or []))[:KEY_LOG_MAX]
    total = ok_since // KEYS_PER_PRINTS
    if total > k.get("from_prints", 0):
        n = total - k.get("from_prints", 0)
        k["from_prints"] = total
        add(n, f"{n * KEYS_PER_PRINTS} impressions réussies")
    # les paliers de la section « Cles et roue » ne rapportent pas de cle : gagner
    # des cles ferait franchir un palier qui rapporterait des cles… sans fin
    tiers = [x for x in new if len(BY_ID[x[0]]["tiers"]) > 1 and BY_ID[x[0]]["cat"] != "game"]
    secrets = [x for x in new if len(BY_ID[x[0]]["tiers"]) == 1]
    if tiers:
        add(KEYS_TIER * len(tiers), f"{len(tiers)} palier{'s' if len(tiers) > 1 else ''} franchi{'s' if len(tiers) > 1 else ''}")
    for aid, _i in secrets:
        add(KEYS_SECRET, f"Secret « {BY_ID[aid]['name']} »")
    return gains


def _gift_from(st: dict, aid: str) -> list:
    """Les copains qui ont deja gagne ce secret (ils m'en offrent les 3 premieres etapes)."""
    names = st.get("friend_names") or {}
    return [names.get(fid, "un copain") for fid, ids in (st.get("friend_uniques") or {}).items() if aid in ids]


def _reveal_level(st: dict, aid: str) -> int:
    """Etape atteinte sur un secret : ce que j'ai paye, ou les 3 premieres
    offertes si un copain l'a deja gagne."""
    paid = int(((st.get("keys") or {}).get("spent") or {}).get(aid, 0))
    friends = st.get("friend_uniques") or {}
    if any(aid in ids for ids in friends.values()):
        return max(paid, FREE_FROM_FRIENDS)
    return paid


async def spend_key(aid: str) -> dict:
    """Revele l'etape suivante d'un secret pas encore gagne."""
    async with _lock():
        return await _spend_key(aid)


async def _spend_key(aid: str) -> dict:
    a = BY_ID.get(aid)
    if not a or len(a["tiers"]) != 1:
        raise ValueError("Ce succès n'est pas un secret")
    st = await _state_get() or {}
    k = st.get("keys")
    if not isinstance(k, dict):
        raise ValueError("Les clés arrivent au prochain calcul des succès (dans 15 minutes au plus)")
    k = _keys_init(st)                         # reprise eventuelle des etapes deja payees
    if (st.get("unlocked") or {}).get(aid):
        raise ValueError("Ce secret est déjà gagné : tout est dévoilé")
    lvl = _reveal_level(st, aid)
    if lvl >= len(REVEALS):
        raise ValueError("Tout est déjà révélé")
    cost = REVEALS[lvl][2]
    if k["balance"] < cost:
        raise ValueError(f"Il faut {cost} clé{'s' if cost > 1 else ''} pour révéler {REVEALS[lvl][1]}")
    k["balance"] -= cost
    k.setdefault("spent", {})[aid] = lvl + 1
    now = datetime.utcnow().isoformat()
    k["log"] = ([{"at": now, "n": -cost,
                  "why": f"{REVEALS[lvl][1].capitalize()} d'un secret"}] + (k.get("log") or []))[:KEY_LOG_MAX]
    k["spent_total"] = k.get("spent_total", 0) + cost
    k["reveal_steps"] = k.get("reveal_steps", 0) + 1
    use = k.setdefault("uses", {}).setdefault(aid, {"keys": 0, "steps": []})
    use["keys"] += cost
    use["steps"].append({"step": REVEALS[lvl][1], "keys": cost, "at": now})
    flags = k.setdefault("flags", {})
    if k["balance"] == 0:
        flags.setdefault("last_key", now)
    if lvl + 1 == len(REVEALS):
        flags.setdefault("full_reveal", now)
    await _state_put(st)
    _CACHE["v"] = None
    _bg_tick()
    return {"balance": k["balance"], "level": lvl + 1}


# ── Roue (21/10/2026) ────────────────────────────────────────────────────────
# 3 tours offerts au depart, puis 3 chaque lundi (rien de rattrape). Le tirage
# se fait ici, jamais dans la page. Lots : (id, libelle, cles, chance en %).
WHEEL_START = 3
WHEEL_WEEKLY = 3
TICKETS_WEEKLY = 1
# Ranges par valeur : plus un lot vaut, plus il est rare.
PRIZES = [("none", "Pas cette fois", 0, 45.0), ("key1", "1 clé", 1, 26.0), ("ticket", "Ticket de palier", 0, 10.0),
          ("replay", "Tour rejoué", 0, 7.0), ("hint", "Coup de pouce", 0, 6.0), ("key3", "3 clés", 3, 4.0),
          ("key5", "5 clés", 5, 1.8), ("jackpot", "Jackpot : 10 clés", 10, 0.2)]
PRIZE_HELP = {
    "none": "Rien cette fois : retente ta chance.",
    "key1": "Une clé, tout de suite.",
    "replay": "Le tour t'est rendu : tu rejoues.",
    "hint": "L'étape suivante d'un secret pris au hasard, offerte (elle vaut de 1 à 15 clés). "
            "S'il n'y a plus rien à révéler : 1 clé.",
    "key3": "Trois clés d'un coup.",
    "ticket": "Un ticket de plus. Sur un succès à paliers, il en faut de 1 à 10 selon le palier visé pour le passer.",
    "key5": "Cinq clés d'un coup.",
    "jackpot": "Le gros lot : dix clés.",
}


def _week_tag(t: datetime | None = None) -> str:
    loc = _local(t or datetime.utcnow())
    y, wk, _ = loc.isocalendar()
    return f"{y}-W{wk:02d}"


def _wheel_init(st: dict) -> dict:
    w = st.get("wheel")
    if not isinstance(w, dict):
        w = st["wheel"] = {"spins": WHEEL_START, "week": _week_tag(), "played": 0, "keys": 0, "lose": 0, "win": 0,
                           "flags": {}, "start_notified": False}
    return w


def _keys_peak(k: dict) -> None:
    k["max_balance"] = max(k.get("max_balance", 0), k.get("balance", 0))


def _wheel_weekly(st: dict) -> tuple:
    """Chaque nouvelle semaine (lundi) : des tours de roue et un ticket de
    palier ; les tours de depart, annonces une fois. Rend (tours, tickets)."""
    w = _wheel_init(st)
    n = t = 0
    if not w.get("start_notified"):
        w["start_notified"] = True
        n += w["spins"]
    tag = _week_tag()
    if w.get("week") != tag:
        w["week"] = tag
        w["spins"] += WHEEL_WEEKLY
        n += WHEEL_WEEKLY
        w["tickets"] = w.get("tickets", 0) + TICKETS_WEEKLY
        w["tickets_won"] = w.get("tickets_won", 0) + TICKETS_WEEKLY
        t += TICKETS_WEEKLY
    return n, t


SPINS_PER_SECRET = 1          # un secret gagne : un tour de roue
SECRETS_PER_TICKET = 5        # tous les 5 secrets gagnes : un ticket de palier (10 avant le 22/10/2026)
PRINTS_PER_SPIN = 8           # toutes les 8 impressions reussies : un tour de roue
PRINTS_PER_TICKET = 5         # toutes les 5 impressions reussies : un ticket de palier


def _print_rewards(st: dict, ok: int) -> tuple:
    """Tours et tickets gagnes par les impressions reussies (comptees comme pour
    les cles). Pas de rattrapage : la premiere fois, on part du compte du jour.
    Rend (tours, tickets) donnes."""
    w = _wheel_init(st)
    if "prints_base" not in w:
        w.update(prints_base=ok, prints_spins=0, prints_tickets=0)
    w["prints_seen"] = ok
    d = max(0, ok - w["prints_base"])
    spins = d // PRINTS_PER_SPIN - w.get("prints_spins", 0)
    tickets = d // PRINTS_PER_TICKET - w.get("prints_tickets", 0)
    spins, tickets = max(0, spins), max(0, tickets)
    if spins:
        w["prints_spins"] = w.get("prints_spins", 0) + spins
        w["spins"] += spins
    if tickets:
        w["prints_tickets"] = w.get("prints_tickets", 0) + tickets
        w["tickets"] = w.get("tickets", 0) + tickets
        w["tickets_won"] = w.get("tickets_won", 0) + tickets
    return spins, tickets
SECRET_REWARDS_V = 1           # rattrapage (une fois) des secrets gagnes avant cette regle : les tickets seulement


def _secret_rewards(st: dict, new: list) -> tuple:
    """Secrets gagnes pour de bon (pas un rattrapage) : un tour chacun, et un
    ticket tous les 10. Rend (tours, tickets) donnes."""
    secrets = [aid for aid, _i in new if len(BY_ID[aid]["tiers"]) == 1]
    if not secrets:
        return 0, 0
    w = _wheel_init(st)
    before = w.get("secrets", 0)
    w["secrets"] = before + len(secrets)
    tickets = w["secrets"] // SECRETS_PER_TICKET - before // SECRETS_PER_TICKET
    w["spins"] += SPINS_PER_SECRET * len(secrets)
    if tickets:
        w["tickets"] = w.get("tickets", 0) + tickets
        w["tickets_won"] = w.get("tickets_won", 0) + tickets
    return SPINS_PER_SECRET * len(secrets), tickets


def _secret_rewards_retro(st: dict, new: list) -> tuple | None:
    """Une fois, a l'arrivee de la regle : les secrets deja gagnes comptent pour
    les tickets (un tous les 10), pas pour les tours de roue. Ceux de ce passage
    suivent la regle normale. Rend (secrets, tours, tickets) ou None."""
    w = _wheel_init(st)
    if w.get("secret_rewards_v") == SECRET_REWARDS_V:
        return None
    w["secret_rewards_v"] = SECRET_REWARDS_V
    now_new = {aid for aid, _i in new}
    had = [aid for aid, got in (st.get("unlocked") or {}).items()
           if got and aid in BY_ID and len(BY_ID[aid]["tiers"]) == 1 and aid not in now_new]
    if not had:
        w.setdefault("secrets", 0)
        return None
    n = len(had)
    tickets = n // SECRETS_PER_TICKET
    w["secrets"] = w.get("secrets", 0) + n
    if tickets:
        w["tickets"] = w.get("tickets", 0) + tickets
        w["tickets_won"] = w.get("tickets_won", 0) + tickets
    return n, 0, tickets


async def _notify_retro(n: int, spins: int, tickets: int, spins_total: int, tickets_total: int) -> None:
    """Le rattrapage explique dans le journal : ce qui a ete donne, et pourquoi."""
    from . import notify as N
    cfg = await N._load()
    left = SECRETS_PER_TICKET - n % SECRETS_PER_TICKET
    lines = [f"Nouvelle règle : chaque secret gagné offre {SPINS_PER_SECRET} tour de roue, et tous les "
             f"{SECRETS_PER_TICKET} secrets, un ticket de palier.",
             f"Tu avais déjà gagné {n} secret{'s' if n > 1 else ''} : ils comptent pour les tickets "
             f"(les tours de roue, eux, ne valent que pour les prochains secrets)."]
    if spins:
        lines.append(f"🎰 +{spins} tour{'s' if spins > 1 else ''} de roue")
    if tickets:
        lines.append(f"🎟️ +{tickets} ticket{'s' if tickets > 1 else ''} de palier")
    lines.append(f"Prochain ticket dans {left} secret{'s' if left > 1 else ''}. Tu as maintenant {spins_total} tours"
                 + (f" et {tickets_total} ticket{'s' if tickets_total > 1 else ''} de palier." if tickets_total else "."))
    if not tickets:
        return
    await N.notify("wheel_spin", f"🎁 Tes {n} secrets rapportent {tickets} ticket{'s' if tickets > 1 else ''} de palier",
                   "\n".join(lines), click=N.app_link(cfg, "/stats?tab=achievements"), priority=3)


async def _notify_spins(n: int, total: int, from_secrets: int = 0, tickets: int = 0, tickets_total: int = 0,
                        weekly_tickets: int = 0, print_spins: int = 0, print_tickets: int = 0) -> None:
    from . import notify as N
    cfg = await N._load()
    if not N.enabled_in(cfg, "wheel_spin"):
        return
    got = n + from_secrets + print_spins
    all_t = tickets + weekly_tickets + print_tickets
    if all_t and not got:
        title = f"🎟️ Ticket de palier gagné !" if all_t == 1 else f"🎟️ {all_t} tickets de palier gagnés !"
    else:
        title = f"🎰 {got} tours de roue offerts !" if got > 1 else "🎰 Un tour de roue offert !"
    lines = []
    if n:
        lines.append(f"🗓️ +{n} · nouvelle semaine" if n == WHEEL_WEEKLY else f"🎁 +{n} · tours de départ")
    if weekly_tickets:
        lines.append(f"🎟️ +{weekly_tickets} ticket{'s' if weekly_tickets > 1 else ''} de palier · nouvelle semaine")
    if from_secrets:
        lines.append(f"🔮 +{from_secrets} · secret{'s' if from_secrets > 1 else ''} gagné{'s' if from_secrets > 1 else ''}")
    if tickets:
        lines.append(f"🎟️ +{tickets} ticket{'s' if tickets > 1 else ''} de palier · {SECRETS_PER_TICKET} secrets gagnés")
    if print_spins:
        lines.append(f"🖨️ +{print_spins} tour{'s' if print_spins > 1 else ''} · {print_spins * PRINTS_PER_SPIN} impressions réussies")
    if print_tickets:
        lines.append(f"🎟️ +{print_tickets} ticket{'s' if print_tickets > 1 else ''} de palier · "
                     f"{print_tickets * PRINTS_PER_TICKET} impressions réussies")
    lines.append(f"Tu as {total} tour{'s' if total > 1 else ''} de roue"
                 + (f" et {tickets_total} ticket{'s' if tickets_total > 1 else ''} de palier." if tickets_total else "."))
    await N.notify("wheel_spin", title, "\n".join(lines),
                   click=N.app_link(cfg, "/stats?tab=achievements"), priority=2)


def _draw(rng=None) -> tuple:
    import random
    r = (rng or random.SystemRandom()).uniform(0, 100)
    acc = 0.0
    for p in PRIZES:
        acc += p[3]
        if r < acc:
            return p
    return PRIZES[0]


async def spin(rng=None) -> dict:
    """Un tour de roue : le lot, applique tout de suite."""
    async with _lock():
        st = await _state_get()
        if st is None or not isinstance(st.get("keys"), dict):
            raise ValueError("La roue arrive au prochain calcul des succès (dans 15 minutes au plus)")
        k, w = _keys_init(st), _wheel_init(st)
        if w["spins"] <= 0:
            raise ValueError("Plus de tour de roue : le prochain arrive lundi")
        pid, label, n, _pct = _draw(rng)
        now = datetime.utcnow().isoformat()
        w["spins"] -= 1
        w["played"] = w.get("played", 0) + 1
        flags = w.setdefault("flags", {})
        out = {"prize": pid, "label": label, "keys": n}
        if n:
            k["balance"] += n
            k["earned"] = k.get("earned", 0) + n
            w["keys"] = w.get("keys", 0) + n
            k["log"] = ([{"at": now, "n": n, "why": f"Roue : {label}"}] + (k.get("log") or []))[:KEY_LOG_MAX]
            _keys_peak(k)
        if pid == "replay":
            w["spins"] += 1
        if pid == "ticket":
            w["tickets"] = w.get("tickets", 0) + 1
            w["tickets_won"] = w.get("tickets_won", 0) + 1
        if pid == "hint":
            # la prochaine etape d'un secret pris au hasard, offerte
            import random
            todo = [a["id"] for a in CATALOG if len(a["tiers"]) == 1 and not a.get("set")
                    and not (st.get("unlocked") or {}).get(a["id"]) and _reveal_level(st, a["id"]) < len(REVEALS)]
            if todo:
                aid = (rng or random.SystemRandom()).choice(todo)
                lvl = _reveal_level(st, aid)
                k.setdefault("spent", {})[aid] = lvl + 1
                k["log"] = ([{"at": now, "n": 0, "why": f"Roue : {REVEALS[lvl][1]} d'un secret offert"}]
                            + (k.get("log") or []))[:KEY_LOG_MAX]
                out["secret"] = {"id": aid, "step": REVEALS[lvl][1]}
            else:
                # plus rien a reveler : une cle a la place
                k["balance"] += 1
                k["earned"] = k.get("earned", 0) + 1
                w["keys"] = w.get("keys", 0) + 1
                out["keys"] = 1
                out["label"] = "1 clé (plus rien à révéler)"
        won = pid not in ("none", "replay")
        w["lose"] = 0 if won else w.get("lose", 0) + (pid == "none")
        w["win"] = w.get("win", 0) + 1 if won else (w.get("win", 0) if pid == "replay" else 0)
        if pid == "jackpot":
            flags.setdefault("jackpot", now)
        if pid == "key5":
            flags.setdefault("lucky5", now)
        if w["lose"] >= 5:
            flags.setdefault("bad_luck", now)
        if w["win"] >= 3:
            flags.setdefault("win_streak", now)
        await _state_put(st)
        _CACHE["v"] = None
    _bg_tick()
    return {**out, "spins": w["spins"], "balance": k["balance"], "at": now}


async def settle(since: str) -> list:
    """Apres un tour : le passage des succes qu'il a provoque (paliers, secrets),
    et les cles qu'il a rapportees en plus du lot, depuis `since`."""
    await tick()
    k = (await _state_get() or {}).get("keys") or {}
    return [l for l in (k.get("log") or []) if l.get("at", "") >= since and l.get("n", 0) > 0
            and not str(l.get("why", "")).startswith("Roue")]


async def add_spins(n: int) -> dict:
    """Ajoute des tours de roue (essais de l'administrateur)."""
    n = max(1, min(int(n or 1), 100))
    async with _lock():
        st = await _state_get()
        if st is None:
            raise ValueError("Pas encore d'état des succès : attends le premier passage")
        w = _wheel_init(st)
        w["spins"] += n
        await _state_put(st)
        _CACHE["v"] = None
    return {"added": n, "spins": w["spins"]}


def wheel_view(st: dict) -> dict | None:
    w = st.get("wheel")
    if not isinstance(w, dict):
        return None
    loc = _local(datetime.utcnow())
    nxt = (loc + timedelta(days=7 - loc.weekday())).date()
    return {"spins": w.get("spins", 0), "played": w.get("played", 0), "next": nxt.isoformat(), "tickets": w.get("tickets", 0),
            "weekly": WHEEL_WEEKLY, "start": WHEEL_START, "per_secret": SPINS_PER_SECRET,
            "weekly_tickets": TICKETS_WEEKLY, "ticket_costs": TICKET_COST,
            "secrets_per_ticket": SECRETS_PER_TICKET,
            "to_ticket": SECRETS_PER_TICKET - (w.get("secrets", 0) % SECRETS_PER_TICKET),
            "prints_per_spin": PRINTS_PER_SPIN, "prints_per_ticket": PRINTS_PER_TICKET,
            "to_spin_prints": PRINTS_PER_SPIN - (max(0, w.get("prints_seen", 0) - w.get("prints_base", 0)) % PRINTS_PER_SPIN),
            "to_ticket_prints": PRINTS_PER_TICKET - (max(0, w.get("prints_seen", 0) - w.get("prints_base", 0)) % PRINTS_PER_TICKET),
            "prizes": [{"id": i, "label": l, "keys": n, "pct": p, "help": PRIZE_HELP.get(i, "")} for i, l, n, p in PRIZES]}


_MONTHS = "janvier février mars avril mai juin juillet août septembre octobre novembre décembre".split()
_DAYS = "lundi mardi mercredi jeudi vendredi samedi dimanche".split()
_COLORS = "rouge orange jaune vert bleu violet rose noir blanc gris".split()
_MATS = "pla petg tpu abs asa pc pa nylon pva".split()


def hint_of(a: dict) -> str:
    """Indice ecrit pour le secret (HINTS) ; filet de securite pour un secret
    qui n'en aurait pas encore : la description, mots-cles caches."""
    import re as _re
    if a.get("hint"):
        return a["hint"]
    words = set(_MONTHS + _DAYS + _COLORS + _MATS)
    desc = a["desc"].replace("{n}", "…")
    out = _re.sub(r"\d[\d\s,.]*(?:ᵉ|er|e)?(?:\s?(?:h|g|kg|min|minutes|heures?|jours?|%|€))?", "…", desc)
    out = _re.sub(r"[\wÀ-ÿ']+", lambda m: "…" if m.group(0).lower().strip("'") in words else m.group(0), out)
    out = _re.sub(r"…(\s*…)+", "…", out)
    if out == desc:
        parts = desc.split()
        out = " ".join(parts[:max(3, len(parts) // 2)]) + " …"
    return out


def _fmt_n(n, a) -> str:
    if isinstance(n, float) and not n.is_integer():
        s = f"{n:.1f}".replace(".", ",")
    else:
        s = f"{int(n):,}".replace(",", " ")
    return s


def describe(a: dict, n) -> str:
    return a["desc"].replace("{n}", _fmt_n(n, a))


async def _notify(new: list, ev: dict, keys: int = 0) -> None:
    from . import notify as N
    cfg = await N._load()
    if not N.enabled_in(cfg, "achievement_unlocked"):
        return
    # le plus haut cran gagne par succes
    best = {}
    for aid, i in new:
        best[aid] = max(best.get(aid, -1), i)
    items = sorted(best.items(), key=lambda x: -tiers_of(BY_ID[x[0]])[x[1]]["score"])
    lines = []
    for aid, i in items[:8]:
        a = BY_ID[aid]
        t = tiers_of(a)[i]
        nxt = a["tiers"][i + 1] if i + 1 < len(a["tiers"]) else None
        lines.append(f"{t['emoji']} {a['emoji']} {a['name']} · {t['label']}")
        lines.append(f"   {describe(a, a['tiers'][i])}"
                     + (f" — prochain palier : {_fmt_n(nxt, a)}" if nxt is not None and not a.get("money") else ""))
    if len(items) > 8:
        lines.append(f"… et {len(items) - 8} autre(s)")
    if keys:
        lines.append(f"🔑 +{keys} clé{'s' if keys > 1 else ''}")
    aid, i = items[0]
    a, t = BY_ID[aid], tiers_of(BY_ID[aid])[i]
    title = (f"🏅 Succès débloqué : {a['name']} {t['emoji']}" if len(items) == 1
             else f"🏅 {len(items)} succès débloqués")
    await N.notify("achievement_unlocked", title, "\n".join(lines),
                   click=N.app_link(cfg, f"/stats?tab=achievements&a={aid}"), priority=3)


# ── Bilan par section (page, podium entre copains) ───────────────────────────
def _still(aid: str, i, best) -> bool:
    """Un palier deja acquis tient-il encore avec les seuils du moment ?"""
    t = BY_ID[aid]["tiers"]
    i = int(i)
    return i < len(t) and (best or 0) >= t[i]


def summary(v: dict) -> dict:
    """Score, medailles et nombre de succes gagnes, par section et en tout,
    a partir d'une vue (la mienne ou celle d'un copain, meme version ou non)."""
    tiers = {t["id"]: t for t in v.get("tiers") or []}
    cats = {}
    for it in v.get("items") or []:
        c = cats.setdefault(it.get("cat") or "?", {"score": 0, "max": 0, "got": 0, "total": 0,
                                                    "medals": {t: 0 for t in tiers}})
        c["total"] += 1
        got = [t for t in it.get("tiers") or [] if t.get("at")]
        if got:
            c["got"] += 1
        for t in it.get("tiers") or []:
            sc = (tiers.get(t.get("id")) or {}).get("score", 0)
            c["max"] += sc
            if t.get("at"):
                c["score"] += sc
                c["medals"][t["id"]] = c["medals"].get(t["id"], 0) + 1
    # medailles uniques gagnees : pour cercler, chez moi, les secrets qu'un copain a deja
    uniques = sorted(it["id"] for it in v.get("items") or []
                     if len(it.get("tiers") or []) == 1 and (it["tiers"][0] or {}).get("at"))
    # palier atteint par succes, et sa date : [indice, date]
    levels = {}
    for it in v.get("items") or []:
        got = [(i, t.get("at")) for i, t in enumerate(it.get("tiers") or []) if t.get("at")]
        if got:
            levels[it["id"]] = [got[-1][0], got[-1][1]]
    return {"cats": cats, "uniques": uniques, "levels": levels, "sig": v.get("sig"),
            "score": sum(c["score"] for c in cats.values()),
            "score_max": sum(c["max"] for c in cats.values()),
            "got": sum(c["got"] for c in cats.values()), "total": sum(c["total"] for c in cats.values())}


_PODIUM = {"t": 0.0, "v": None}


async def podium(me_name: str, fresh: bool = False) -> dict:
    """Moi et chacun de mes copains : score par section, lu chez eux par leur
    cle (avec mes medailles uniques jointes, comme le relais de la page)."""
    import asyncio
    from . import friends as F
    if not fresh and _PODIUM["v"] and time.time() - _PODIUM["t"] < 300:
        return _PODIUM["v"]
    people = [{"id": "me", "name": me_name, "me": True, "status": "ok", **summary(await view())}]
    mine = ",".join(await my_uniques())

    async def one(f):
        head = {"id": f["id"], "name": f.get("name") or f"Copain {f['id']}", "me": False}
        try:
            r = await asyncio.to_thread(F._get, f["url"], f["key"], "achievements", None, 30,
                                        {"X-BN-Achievements": mine})
            if r.status_code == 404:
                return {**head, "status": "outdated"}
            if r.status_code >= 400:
                return {**head, "status": "offline"}
            return {**head, "status": "ok", **summary(r.json())}
        except Exception:
            return {**head, "status": "offline"}
    friends_now = await F._load()
    people += list(await asyncio.gather(*(one(f) for f in friends_now)))
    st = await _state_get()
    if st is not None:
        known = dict(st.get("friend_uniques") or {})
        names = dict(st.get("friend_names") or {})
        for p in people:
            if not p.get("me") and p.get("status") == "ok":
                known[str(p["id"])] = p.get("uniques") or []
        ids_now = {str(f["id"]) for f in friends_now}
        known = {fid: ids for fid, ids in known.items() if fid in ids_now}
        names = {str(f["id"]): f.get("name") or f"Copain {f['id']}" for f in friends_now}
        if known != (st.get("friend_uniques") or {}) or names != (st.get("friend_names") or {}):
            st["friend_uniques"], st["friend_names"] = known, names
            await _state_put(st)
            _CACHE["v"] = None
    out = {"people": people, "categories": [{"id": c, "emoji": e, "name": n} for c, e, n in CATEGORIES]}
    _PODIUM.update(t=time.time(), v={**out, "refresh": False})
    return {**out, "refresh": _CACHE["v"] is None}


# ── Succes des copains : notification ────────────────────────────────────────
async def friend_news(notify: bool = True) -> list:
    """Ce que mes copains viennent de gagner. Premier passage chez un copain,
    ou seuils changes chez lui (empreinte differente) : on retient sans rien
    dire. Ensuite, seul un palier atteint il y a peu (48 h) est annonce --
    pas un rattrapage. Un secret que je n'ai pas reste secret."""
    pod = await podium("Toi", fresh=True)
    st = await _state_get()
    if st is None:
        return []
    seen = dict(st.get("friend_levels") or {})
    sigs = dict(st.get("friend_sigs") or {})
    mine = {it["id"]: it["level"] for it in (await view())["items"]}
    news = []
    ok_ids = set()
    for p in pod["people"]:
        if p.get("me") or p.get("status") != "ok" or "levels" not in p:
            continue
        fid = str(p["id"])
        ok_ids.add(fid)
        cur = {aid: lv[0] for aid, lv in p["levels"].items()}
        quiet = fid not in seen or sigs.get(fid) != p.get("sig")
        if not quiet:
            for aid, (lv, at) in p["levels"].items():
                if aid in BY_ID and lv > seen[fid].get(aid, -1) and _recent(at):
                    news.append((p["name"], aid, lv))
        seen[fid], sigs[fid] = cur, p.get("sig")
    keep = ok_ids | {fid for fid in seen if fid in {str(p["id"]) for p in pod["people"] if not p.get("me")}}
    st["friend_levels"] = {fid: v for fid, v in seen.items() if fid in keep}
    st["friend_sigs"] = {fid: v for fid, v in sigs.items() if fid in keep}
    await _state_put(st)
    if notify and news:
        await _notify_friends(news, mine)
    return news


async def _notify_friends(news: list, mine: dict) -> None:
    from . import notify as N
    cfg = await N._load()
    if not N.enabled_in(cfg, "friend_achievement"):
        return
    by = defaultdict(list)
    for name, aid, lv in news:
        by[name].append((aid, lv))
    for name, got in by.items():
        got.sort(key=lambda x: -tiers_of(BY_ID[x[0]])[x[1]]["score"])
        lines, first = [], None
        for aid, lv in got[:8]:
            a, t = BY_ID[aid], tiers_of(BY_ID[aid])[lv]
            if len(a["tiers"]) == 1 and mine.get(aid, -1) < 0:
                lines.append(f"{t['emoji']} 🤫 Un succès secret (tu ne l'as pas encore)")
                continue
            first = first or (aid, a, t)
            me = mine.get(aid, -1)
            vs = ("" if len(a["tiers"]) == 1 else
                  " — toi : " + (tiers_of(a)[me]["label"] if me >= 0 else "pas encore")
                  + (" (devant)" if me > lv else " (à égalité)" if me == lv else ""))
            lines.append(f"{t['emoji']} {a['emoji']} {a['name']} · {t['label']}{vs}")
        if len(got) > 8:
            lines.append(f"… et {len(got) - 8} autre(s)")
        title = (f"👥 {name} : {first[1]['name']} {first[2]['emoji']}" if len(got) == 1 and first
                 else f"👥 {name} a débloqué {len(got)} succès" if len(got) > 1 else f"👥 {name} a débloqué un secret")
        link = f"/stats?tab=achievements&a={first[0]}" if first else "/stats?tab=achievements&cat=secret"
        await N.notify("friend_achievement", title, "\n".join(lines), click=N.app_link(cfg, link), priority=2)


# ── Export des paliers (revue des seuils) ────────────────────────────────────
async def export_csv() -> str:
    """Tous les succes a paliers : section, ce qui compte, ma valeur, le palier
    atteint, le prochain seuil et les seuils de Bronze a Eternel. Separateur
    « ; » et BOM UTF-8 : s'ouvre tel quel dans Excel ou LibreOffice."""
    import csv
    import io
    v = await view(fresh=True)
    cats = {c["id"]: c["name"] for c in v["categories"]}
    labels = [t["label"] for t in TIERS]
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\n")
    w.writerow(["Section", "Succès", "Ce qui compte", "Unité", "Ma valeur", "Palier atteint", "Prochain seuil"] + labels)

    def num(x):
        if x is None:
            return ""
        if isinstance(x, float) and not x.is_integer():
            return f"{x:.2f}".rstrip("0").rstrip(".").replace(".", ",")
        return str(int(x))
    seen = {it["id"]: it for it in v["items"]}
    for a in CATALOG:
        if len(a["tiers"]) < 2:
            continue
        # meme une matiere jamais imprimee (masquee sur la page) : ses seuils comptent pour la revue
        it = seen.get(a["id"]) or {"value": 0, "level": -1, "tiers": [], "next": a["tiers"][0]}
        lvl = it["level"]
        w.writerow([cats.get(a["cat"], a["cat"]), a["name"], a["desc"].replace("{n}", "N"), a.get("unit") or "",
                    num(it["value"]), it["tiers"][lvl]["label"] if lvl >= 0 else "—", num(it.get("next"))]
                   + [num(x) for x in a["tiers"]] + [""] * (len(labels) - len(a["tiers"])))
    return "\ufeff" + buf.getvalue()


# ── Secrets : ce qu'un autre compte en voit ──────────────────────────────────
def mask_secrets(v: dict, keep=()) -> dict:
    """Medailles uniques gagnees : la medaille, le titre et la date restent ;
    ce qui l'a valu et son histoire sont caches, sauf pour celles de `keep`
    (que celui qui regarde a gagnees lui aussi)."""
    items = []
    for it in v["items"]:
        if len(it["tiers"]) == 1 and it["level"] >= 0 and it["id"] not in keep:
            it = {**it, "desc": "Descriptif caché", "lore": None, "masked": True}
        items.append(it)
    # ce que j'ai revele de mes secrets reste visible : les copains s'entraident
    return {**v, "items": items, "keys": None}


async def my_levels() -> dict:
    """Mon plus haut palier par succes (indice), d'apres les paliers enregistres :
    lu quand je regarde la vitrine d'un copain, pour reperer ce que j'ai aussi."""
    st = await _state_get() or {}
    out = {}
    for aid, got in (st.get("unlocked") or {}).items():
        lv = [int(i) for i in (got or {}) if str(i).isdigit()]
        if lv and aid in BY_ID:
            out[aid] = max(lv)
    return out


async def my_uniques() -> list:
    """Mes medailles uniques gagnees (envoyees quand je regarde chez un copain)."""
    st = await _state_get() or {}
    return sorted(aid for aid, got in (st.get("unlocked") or {}).items()
                  if got and aid in BY_ID and len(BY_ID[aid]["tiers"]) == 1)


# ── Vue pour la page ─────────────────────────────────────────────────────────
async def view(fresh: bool = False) -> dict:
    if not fresh and _CACHE["v"] and time.time() - _CACHE["t"] < 60:
        return _CACHE["v"]
    ev = await evaluate(cached=not fresh)
    st = await _state_get() or {"unlocked": {}}
    if st.get("unlocked") is not None and st.get("sig") and (
            not isinstance(st.get("keys"), dict) or st["keys"].get("reveal_v") != REVEAL_V):
        _keys_init(st)                         # mise en route (ou reprise) des cles sans attendre le prochain passage
        await _state_put(st)
    medals = {t["id"]: 0 for t in TIERS + [UNIQUE]}
    score = score_max = 0
    items = []
    for a in CATALOG:
        r = ev[a["id"]]
        got = dict(r["reached"])
        stored = (st.get("unlocked") or {}).get(a["id"]) or {}
        if a.get("live"):                               # acquis, meme si la valeur a baisse
            best = (st.get("best") or {}).get(a["id"], 0) or 0
            got.update({i: at for i, at in stored.items() if _still(a["id"], i, best)})
        else:                                           # la date d'abord constatee
            got.update({i: at for i, at in stored.items() if i in got})
        tiers = tiers_of(a)
        lvl = max((int(i) for i in got), default=-1)
        if a.get("only_started") and lvl < 0 and not r["value"]:
            continue                                   # matiere jamais imprimee : on ne l'affiche pas
        for i in got:
            medals[tiers[int(i)]["id"]] += 1
            score += tiers[int(i)]["score"]
        score_max += sum(t["score"] for t in tiers)
        nxt = lvl + 1 if lvl + 1 < len(a["tiers"]) else None
        secret = a.get("hidden") and lvl < 0
        rv = _reveal_level(st, a["id"]) if secret else 0
        items.append({
            "id": a["id"], "cat": a["cat"], "emoji": "❔" if secret and rv < 2 else a["emoji"],
            "name": "Succès secret" if secret and rv < 3 else a["name"],
            "hint": hint_of(a) if secret and rv >= 4 else None, "reveal": rv,
            # etapes offertes par des copains qui l'ont deja (grace a…)
            "gift_from": _gift_from(st, a["id"]) if secret else [],
            "desc": ("Continue d'imprimer : il se dévoilera tout seul." if rv < 1 else "Descriptif à révéler (🔑)")
                    if secret and rv < 5 else
                    describe(a, a["tiers"][nxt if nxt is not None else lvl]),
            # medaille unique gagnee : ce qu'elle raconte, et ce qui l'a valu
            "lore": a.get("lore") if lvl >= 0 and len(a["tiers"]) == 1 else None,
            "secret": bool(a.get("hidden")), "money": bool(a.get("money")), "unit": a.get("unit"),
            # un secret pas encore gagne reste « a decouvrir » tant que sa categorie n'est pas revelee
            "sub": None if secret and rv < 1 else a.get("sub"),
            "value": None if secret else r["value"], "level": lvl,
            "next": None if nxt is None or secret else a["tiers"][nxt],
            "prev": a["tiers"][lvl] if lvl >= 0 else 0,
            "tiers": [{**{k: t[k] for k in ("id", "label", "emoji", "color")}, "n": a["tiers"][i],
                       # ce que demande ce palier (fiche : actuel et prochain, chacun le sien)
                       **({"desc": describe(a, a["tiers"][i])} if len(a["tiers"]) > 1 else {}),
                       "at": got.get(str(i)),
                       "ticket": i in ((st.get("ticket_tiers") or {}).get(a["id"]) or [])} for i, t in enumerate(tiers)],
            "tickets": tickets_paid(st, a["id"]),
            "ticket_uses": ticket_uses(st, a["id"]),
            "key_use": key_use(st, a["id"]) if len(a["tiers"]) == 1 else None,
            "ticket_cost": ticket_cost(nxt) if nxt is not None and len(a["tiers"]) > 1 else None,
        })
    # derniers succes : le plus haut cran de chacun ; pas ceux du releve au
    # present constates au premier calcul (ils n'ont pas de vraie date)
    since = (st or {}).get("since") or ""
    first_day = since[:10]
    top = {}
    for it in items:
        for j, t in enumerate(it["tiers"]):
            if t["at"] and not (BY_ID[it["id"]].get("live") and t["at"][:10] <= first_day):
                top[it["id"]] = (t["at"], it["id"], j)
    recent = sorted(top.values(), reverse=True)[:6]
    k = st.get("keys") if isinstance(st.get("keys"), dict) else None
    ok_since = await _ok_since(k.get("since")) if k else 0
    keys = None if k is None else {
        "balance": k.get("balance", 0), "earned": k.get("earned", 0),
        "to_next": KEYS_PER_PRINTS - (ok_since % KEYS_PER_PRINTS),
        "gifts": {"month": KEYS_MONTH, "xmas": KEYS_XMAS},
        "steps": [{"id": i, "label": l, "cost": c} for i, l, c in REVEALS],
        "rules": {"start": KEY_START, "prints": KEYS_PER_PRINTS, "tier": KEYS_TIER, "secret": KEYS_SECRET},
        "log": (k.get("log") or [])[:12], "wheel": wheel_view(st)}
    out = {"items": items, "medals": medals, "score": score, "score_max": score_max, "keys": keys,
           "categories": [{"id": c, "emoji": e, "name": n} for c, e, n in CATEGORIES],
           "subs": [{"id": i, "emoji": e, "name": n} for i, e, n, _ids in SECRET_SUBS],
           "tiers": TIERS + [UNIQUE], "recent": [{"id": i, "tier": j, "at": at} for at, i, j in recent],
           "since": (st or {}).get("since"), "sig": CATALOG_SIG,
           "tickets_used": sum(tickets_paid(st, k) for k in ((st or {}).get("ticket_tiers") or {})),
           "keys_spent": int((((st or {}).get("keys") or {}).get("spent_total")) or 0)}
    _CACHE.update(t=time.time(), v=out)
    return out
