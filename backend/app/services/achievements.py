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
]
# Version des seuils : quand elle change, le passage suivant recalcule les crans
# sans rien notifier (un seuil abaisse ne doit pas declencher une rafale).
CATALOG_VERSION = 7          # 3 : secrets loufoques ; 4 : jusqu'a 100 secrets ; 5 : photos, appli ; 6 : durees, AMS ; 7 : 36 a paliers (20/10/2026)
UNIQUE = {"id": "unique", "label": "Unique", "emoji": "🏵️", "color": "#EC4899", "score": 3}

CATEGORIES = [
    ("prints", "🖨️", "Impressions"),
    ("filaments", "🧵", "Filaments"),
    ("objects", "🧸", "Objets et ventes"),
    ("mw", "🌐", "MakerWorld"),
    ("photos", "📸", "Photos"),
    ("app", "📱", "Dans l'appli"),
    ("social", "🤝", "Copains"),
    ("secret", "🔮", "Secrets"),
]

MATERIALS = ["PLA", "PETG", "TPU", "ABS", "ASA", "PA", "PC"]


def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(os.getenv("TZ") or "Europe/Paris")
    except Exception:
        return timezone.utc


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
    _a("heaviest", "prints", "🏋️", "Poids lourd", "Une impression de {n} g", [250, 500, 1000, 2000, 3000], unit="g"),
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
    _a("dried", "filaments", "💧", "Au sec", "{n} bobines séchées", [1, 10, 25, 50, 100]),
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
    _a("mw_collections", "mw", "📚", "Curateur", "{n} collections MakerWorld", [1, 5, 10, 25, 50]),
    _a("mw_follows", "mw", "👀", "Curieux", "Tu suis {n} créateurs", [5, 25, 50, 100, 250]),
    # Copains
    _a("friends", "social", "🤝", "Bande de copains", "{n} copains reliés", [1, 3, 5, 10, 20]),
    # Photos
    _a("photos_manual", "photos", "📸", "Photographe", "{n} photos ajoutées à tes impressions", [1]),
    _a("photo_prints", "photos", "🖼️", "Album", "{n} impressions avec au moins une photo", [1]),
    _a("photos_camera", "photos", "📹", "Œil de la caméra", "{n} photos prises par la caméra de l'imprimante", [1]),
    _a("photos_max", "photos", "🎞️", "Séance photo", "{n} photos sur une même impression", [1]),
    _a("covers", "photos", "🌟", "Galeriste", "{n} photos choisies comme vignette", [1]),
    # Dans l'appli
    _a("visits", "app", "🚪", "Habitué", "{n} visites de pages", [1]),
    _a("visit_days", "app", "📅", "Fidèle au poste", "{n} jours où l'appli a été ouverte", [1]),
    _a("details", "app", "🔎", "Fouineur", "{n} fiches et onglets consultés", [1]),
    _a("actions", "app", "⚙️", "Hyperactif", "{n} actions dans l'appli (ajouts, modifications…)", [1]),
    _a("updates", "app", "🆙", "Toujours à jour", "{n} mises à jour de BambuNymous installées", [1]),
    _a("notifs", "app", "🔔", "Bien informé", "{n} notifications reçues", [1]),
    _a("dismissals", "app", "🧘", "Zen", "{n} points d'attention mis en sourdine", [1]),
    _a("shares", "social", "📣", "Partageur", "{n} partages sur Telegram", [1]),
    _a("mw_rates", "mw", "✍️", "Critique", "{n} évaluations MakerWorld laissées depuis l'appli", [1]),
    _a("mw_boosts_given", "mw", "🎁", "Généreux en boosts", "{n} boosts donnés depuis l'appli", [1]),
    _a("mw_likes_given", "mw", "👍", "Cœur sur la main", "{n} « j'aime » donnés depuis l'appli", [1]),
    _a("mw_collected", "mw", "📌", "Épingleur", "{n} modèles rangés dans tes collections depuis l'appli", [1]),
    _a("rfid_scans", "filaments", "📲", "Scanner", "{n} scans de bobines RFID", [1]),
    _a("colors_printed", "filaments", "🦎", "Caméléon", "{n} couleurs différentes imprimées", [1]),
    _a("print_days", "prints", "🗓️", "Jours d'impression", "{n} jours différents avec une impression", [1]),
    _a("tags", "prints", "🏷️", "Organisé", "{n} étiquettes différentes sur tes impressions", [1]),
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
    _a("cancelled", "prints", "✋", "Changement d'avis", "{n} impressions annulées", [1]),
    _a("records", "prints", "📏", "Recordman", "{n} fois que tu as battu ton record de durée", [1]),
    _a("success_rate", "prints", "📊", "Fiabilité", "{n} % de réussite (sur au moins 100 impressions)", [1], unit='%'),
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
    _a("day_hours", "prints", "☀️", "Journée pleine", "{n} h d'impressions lancées le même jour", [1], unit="h"),
    _a("month_hours", "prints", "📈", "Mois de folie", "{n} h imprimées en un même mois", [1], unit="h"),
    # Poids, plateaux, imprimantes
    _a("feather", "prints", "🪶", "Poids plume", "{n} impressions réussies de moins de 5 g", [1]),
    _a("sturdy", "prints", "🦍", "Costaud", "{n} impressions de plus de 500 g", [1]),
    _a("multi_plate", "prints", "🍽️", "Multi-plateaux", "{n} impressions d'un plateau 2 ou plus", [1]),
    _a("printers", "prints", "🖨️", "Parc machines", "{n} modèles d'imprimante différents", [1]),
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
    _a("jackpot", "secret", "🎰", "Jackpot", "Ta 777ᵉ impression réussie", [1],
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
]
# Secrets (toutes les medailles uniques) : rangés en sous-sections dans la
# categorie « Secrets ».
SECRET_SUBS = [
    ("calendar", "📅", "Calendrier", "halloween christmas new_year friday13 pi_day leap_day valentine may_day bastille "
     "all_year april_fool music summer_solstice winter_solstice easter st_patrick fathers_day crepes epiphany "
     "palindrome_date anniversary all_seasons santa"),
    ("clock", "🕛", "Heures et lune", "midnight noon mirror sequence elite last_minute saturday_night monday_morning "
     "sunday_morning full_moon new_moon all_nighter cinderella wake_up night_visit"),
    ("measures", "⚖️", "Poids et durées", "tiny flash titan answer42 beast kilo pi_grams palindrome full_day marathon42 "
     "bullseye tortoise hare one_hour watchmaker hundred_pieces"),
    ("colors", "🎨", "Couleurs et matières", "rainbow16 panda tricolore carbon rubber barbie smurf hulk fire pumpkin "
     "xmas_tree silk galaxy glow marble wood translucent sparkle soluble"),
    ("counts", "🔢", "Compteurs et séries", "first_print n1001 hundred jackpot leet y2k dont_panic weekend10 on_fire "
     "rainbow_day triplets broken_record"),
    ("ups", "🎢", "Hauts et bas", "comeback phoenix bad_day insomniac comeback30 hibernation first_try so_close big_fall"),
    ("trade", "🛒", "Ventes et bobines", "penny luxury market_day museum sold_hot finally_sold eternal_spool "
     "devoured_spool big_order pit_stop"),
    ("app", "📱", "Photos et appli", "paparazzi souvenirs grand_tour cutting_edge double_update novel"),
]
SUB_OF = {aid: sid for sid, _e, _n, ids in SECRET_SUBS for aid in ids.split()}

LIVE = {"mw_designs", "mw_downloads", "mw_prints", "mw_boosts", "mw_fans", "mw_likes", "mw_level", "mw_collections",
        "mw_follows", "friends", "stock", "stock_kg", "stock_colors", "rfid", "multicolor_fils",
        "photos_manual", "photo_prints", "photos_camera", "photos_max", "covers", "visits", "visit_days", "details",
        "actions", "updates", "notifs", "dismissals", "tags", "print_groups", "paparazzi", "souvenirs",
        "grand_tour", "night_visit", "cutting_edge", "double_update", "shares", "mw_rates", "mw_boosts_given",
        "mw_likes_given", "mw_collected", "open_spools", "mw_points_bal", "profile_downloads", "queue_size", "accessory_units", "showcase", "household", "notes", "catalog", "assembled", "accessory_refs"}
for _x in CATALOG:
    _x["live"] = _x["id"] in LIVE
# Seuils (20/10/2026, v2) : six crans, jusqu'a la Legende, releves pour qu'un
# parc bien rode (2 000 impressions, 4 000 h, 90 kg) ait encore de quoi viser.
TIER_TABLE = {
    "prints_ok": [50, 250, 1000, 2500, 5000, 10000],
    "print_hours": [250, 1000, 2500, 5000, 10000, 20000],
    "print_kg": [5, 25, 50, 100, 250, 500],
    "longest": [6, 12, 24, 48, 72, 96],
    "heaviest": [250, 500, 1000, 2000, 3000, 5000],
    "streak": [3, 7, 14, 30, 60, 100],
    "busy_day": [3, 5, 8, 12, 20, 30],
    "success_run": [10, 25, 50, 100, 250, 500],
    "night": [10, 50, 150, 300, 600, 1000],
    "early": [10, 50, 150, 300, 600, 1000],
    "weekend": [25, 100, 300, 600, 1200, 2500],
    "models": [25, 100, 250, 500, 1000, 2500],
    "repeat": [5, 10, 25, 50, 100, 250],
    "multicolor": [5, 25, 100, 250, 500, 1000],
    "colors_max": [2, 4, 6, 8, 12, 16],
    "failures": [1, 10, 25, 50, 100, 250],
    "veteran": [30, 180, 365, 730, 1095, 1825],
    "month_record": [20, 40, 60, 100, 150, 250],
    "weeks": [4, 8, 16, 26, 52, 104],
    "pieces": [250, 1000, 2500, 5000, 10000, 25000],
    "mw_made": [25, 100, 250, 500, 1000, 2500],
    "spent": [100, 500, 1000, 2500, 5000, 10000],
    "palette": [10, 25, 50, 100, 200, 300],
    "materials": [2, 3, 5, 7, 10, 12],
    "spools_done": [5, 25, 50, 100, 250, 500],
    "stock": [10, 25, 50, 100, 200, 300],
    "dried": [5, 25, 50, 100, 250, 500],
    "swatches": [10, 25, 50, 100, 200, 400],
    "brands": [2, 3, 5, 8, 12, 20],
    "stock_kg": [5, 10, 25, 50, 100, 200],
    "stock_colors": [4, 6, 8, 10, 12, 14],
    "rfid": [5, 25, 50, 100, 200, 400],
    "labels": [10, 25, 50, 100, 200, 400],
    "multicolor_fils": [1, 3, 5, 10, 20, 40],
    "objects": [25, 100, 250, 500, 1000, 2500],
    "sold": [1, 10, 50, 100, 500, 1000],
    "revenue": [50, 250, 1000, 5000, 10000, 25000],
    "gifted": [1, 5, 20, 50, 100, 250],
    "personal": [5, 25, 50, 100, 250, 500],
    "accessories": [25, 100, 250, 500, 1000, 2500],
    "groups": [1, 5, 10, 25, 50, 100],
    "margin": [50, 250, 1000, 2500, 5000, 10000],
    "mw_designs": [1, 5, 10, 25, 50, 100],
    "mw_downloads": [500, 2500, 10000, 25000, 50000, 100000],
    "mw_prints": [250, 1000, 5000, 10000, 25000, 50000],
    "mw_boosts": [25, 100, 250, 500, 1000, 2500],
    "mw_fans": [25, 100, 500, 1000, 5000, 10000],
    "mw_likes": [250, 1000, 2500, 5000, 10000, 25000],
    "mw_level": [5, 10, 20, 30, 40, 50],
    "mw_collections": [1, 5, 10, 25, 50, 100],
    "mw_follows": [5, 25, 50, 100, 250, 500],
    "friends": [1, 3, 5, 10, 20, 30],
    "photos_manual": [10, 50, 100, 250, 500, 1000],
    "photo_prints": [10, 25, 50, 100, 250, 500],
    "photos_camera": [25, 100, 250, 500, 1000, 2500],
    "photos_max": [3, 5, 8, 12, 16, 24],
    "covers": [5, 25, 50, 100, 250, 500],
    "visits": [100, 500, 1000, 2500, 5000, 10000],
    "visit_days": [7, 30, 90, 180, 365, 730],
    "details": [50, 250, 1000, 2500, 5000, 10000],
    "actions": [50, 250, 1000, 2500, 5000, 10000],
    "updates": [1, 5, 10, 25, 50, 100],
    "notifs": [50, 250, 1000, 2500, 5000, 10000],
    "dismissals": [5, 25, 50, 100, 250, 500],
    "rfid_scans": [10, 50, 100, 250, 500, 1000],
    "colors_printed": [10, 25, 50, 100, 200, 300],
    "print_days": [30, 100, 250, 500, 1000, 1500],
    "tags": [5, 10, 25, 50, 100, 200],
    "print_groups": [5, 25, 50, 100, 250, 500],
    "fil_changes": [10, 50, 100, 250, 500, 1000],
    "fil_changes_day": [3, 5, 8, 12, 16, 24],
    "fil_changes_week": [10, 20, 35, 50, 75, 100],
    "open_spools": [5, 10, 20, 30, 40, 60],
    "long_prints": [5, 10, 25, 50, 100, 250],
    "express": [10, 50, 100, 250, 500, 1000],
    "night_hours": [10, 50, 100, 250, 500, 1000],
    "nonstop": [12, 24, 48, 72, 120, 168],
    "lost_hours": [5, 25, 50, 100, 250, 500],
    "day_hours": [10, 16, 20, 22, 23, 24],
    "month_hours": [100, 200, 300, 400, 500, 650],
    "feather": [10, 50, 100, 250, 500, 1000],
    "sturdy": [5, 10, 25, 50, 100, 250],
    "multi_plate": [5, 25, 50, 100, 250, 500],
    "printers": [2, 3, 4, 5, 6, 8],
    "bicolor": [10, 50, 100, 250, 500, 1000],
    "reliable": [5, 25, 50, 100, 250, 500],
    "faster": [5, 25, 50, 100, 250, 500],
    "morning": [25, 100, 300, 600, 1200, 2500],
    "lunch": [5, 25, 100, 250, 500, 1000],
    "evening": [25, 100, 300, 600, 1200, 2500],
    "overnight": [5, 10, 25, 50, 100, 250],
    "cancelled": [1, 10, 25, 50, 100, 250],
    "records": [3, 5, 10, 15, 20, 30],
    "success_rate": [80, 85, 90, 93, 96, 99],
    "months_active": [3, 6, 12, 24, 36, 60],
    "weekends_active": [5, 25, 52, 100, 150, 250],
    "kg_month": [1, 2, 5, 10, 20, 30],
    "kg_day": [0.5, 1, 2, 3, 5, 8],
    "engineering": [0.5, 1, 2, 5, 10, 25],
    "mw_designs_printed": [10, 50, 100, 250, 500, 1000],
    "creators": [5, 25, 50, 100, 250, 500],
    "mw_categories": [3, 5, 10, 15, 20, 30],
    "trending": [5, 25, 50, 100, 250, 500],
    "gems": [5, 25, 50, 100, 250, 500],
    "mw_points_bal": [100, 500, 1000, 2500, 5000, 10000],
    "profile_downloads": [100, 1000, 5000, 10000, 25000, 50000],
    "queue_size": [5, 10, 25, 50, 100, 200],
    "spools_total": [10, 50, 100, 250, 500, 1000],
    "spool_kg": [5, 25, 50, 100, 250, 500],
    "spool_spent": [100, 500, 1000, 2500, 5000, 10000],
    "catalog": [10, 25, 50, 100, 200, 400],
    "bambu_spools": [5, 25, 50, 100, 250, 500],
    "other_spools": [5, 25, 50, 100, 250, 500],
    "assembled": [5, 25, 50, 100, 250, 500],
    "accessory_refs": [5, 10, 25, 50, 100, 200],
    "accessory_units": [50, 100, 250, 500, 1000, 2500],
    "best_sale": [10, 25, 50, 100, 250, 500],
    "showcase": [5, 10, 25, 50, 100, 200],
    "notes": [5, 25, 50, 100, 250, 500],
    "household": [2, 3, 4, 5, 8, 10],
    "shares": [1, 10, 25, 50, 100, 250],
    "mw_rates": [1, 10, 25, 50, 100, 250],
    "mw_boosts_given": [1, 10, 25, 50, 100, 250],
    "mw_likes_given": [5, 25, 50, 100, 250, 500],
    "mw_collected": [5, 25, 50, 100, 250, 500],
}
for _x in CATALOG:
    if _x["id"] in TIER_TABLE:
        _x["tiers"] = TIER_TABLE[_x["id"]]
    elif _x["id"].startswith("mat_"):
        _x["tiers"] = [1, 5, 10, 25, 50, 100]
    # APRES les seuils (un succes a paliers est declare avec un seuil provisoire) :
    # une medaille unique ne se devoile qu'une fois gagnee, et vit dans « Secrets »
    if len(_x["tiers"]) == 1:
        _x["hidden"] = True
        _x["cat"] = "secret"
        _x["sub"] = SUB_OF.get(_x["id"], "counts")
    else:
        _x.pop("hidden", None)
BY_ID = {a["id"]: a for a in CATALOG}


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
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament, Spool
    from ..models.object_history import Object, ObjectAccessory, ObjectGroup
    from ..models.print_history import FilamentUsage, Print
    async with AsyncSessionLocal() as db:
        prints = (await db.execute(select(Print.id, Print.print_date, Print.status, Print.duration_seconds,
                                          Print.total_weight_g, Print.design_id, Print.translated_name,
                                          Print.file_name, Print.estimated_seconds, Print.number_of_items,
                                          Print.total_cost, Print.plate_id, Print.printer_model, Print.status_note)
                                   .order_by(Print.print_date, Print.id))).all()
        usage = (await db.execute(select(FilamentUsage.print_id, FilamentUsage.spool_id, FilamentUsage.filament_type,
                                         FilamentUsage.color_hex, FilamentUsage.grams_used))).all()
        spools = (await db.execute(select(Spool.id, Spool.filament_id, Spool.archived, Spool.updated_at,
                                          Spool.last_dried_at, Spool.created_at, Spool.remaining_weight_g,
                                          Spool.tag_number, Spool.first_used_at))).all()
        fils = (await db.execute(select(Filament.id, Filament.manufacturer, Filament.swatch, Filament.updated_at,
                                        Filament.created_at, Filament.color_bucket, Filament.label_printed,
                                        Filament.label_printed_at, Filament.multicolor_type,
                                        Filament.fila_type, Filament.name))).all()
        objs = (await db.execute(select(Object.id, Object.status, Object.sold_date, Object.sold_price,
                                        Object.created_at, Object.updated_at, Object.margin))).all()
        groups = (await db.execute(select(ObjectGroup.created_at))).all()
        from sqlalchemy import func
        from ..models.activity import ActivityLog
        from ..models.attention import AttentionDismissal
        from ..models.notif_log import NotifLog
        from ..models.print_history import Group, PrintSnapshot, PrintTag
        from ..models.rfid import RfidScan
        snaps = (await db.execute(select(PrintSnapshot.print_id, PrintSnapshot.trigger, PrintSnapshot.taken_at))).all()
        covers = (await db.execute(select(Print.id).where(Print.cover_photo.isnot(None), Print.cover_photo != ""))).all()
        pgroups = (await db.execute(select(Group.id, Group.created_at, Group.cover_photo))).all()
        tags = (await db.execute(select(func.lower(PrintTag.tag)).distinct())).all()
        # journal d'activite : par type et par jour (il peut etre long)
        act_days = (await db.execute(select(ActivityLog.kind, func.date(ActivityLog.created_at), func.count())
                                     .group_by(ActivityLog.kind, func.date(ActivityLog.created_at)))).all()
        pages = (await db.execute(select(ActivityLog.path).where(ActivityLog.kind == "visite").distinct())).all()
        late = (await db.execute(select(ActivityLog.created_at).where(
            func.strftime("%H", ActivityLog.created_at).in_(["00", "01", "02", "03"])))).all()
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
        # actions reussies qui comptent : partages, gestes MakerWorld
        acts = (await db.execute(select(ActivityLog.method, ActivityLog.path, ActivityLog.created_at).where(
            ActivityLog.kind == "action",
            (ActivityLog.path.like("/api/v1/share/%")) | (ActivityLog.path.like("/api/v1/makerworld/%"))))).all()
        links = (await db.execute(select(ObjectAccessory.quantity, ObjectAccessory.created_at))).all()
    # photos deposees dans le dossier d'un groupe d'impressions
    gfiles = []
    try:
        from ..core.config import settings
        from pathlib import Path
        root = Path(settings.DATA_DIR) / "groups"
        if root.is_dir():
            for d_ in root.iterdir():
                if d_.is_dir():
                    gfiles += [datetime.utcfromtimestamp(f.stat().st_mtime) for f in d_.iterdir()
                               if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
    except Exception:
        pass
    try:
        from . import ams_log
        changes = [datetime.fromisoformat(x) for x in await ams_log.drain()]
    except Exception:
        changes = []
    st = await _state_get() or {}
    versions = dict(st.get("versions") or {})
    sha = (os.getenv("COMMIT_SHA") or "")[:8]
    if sha and sha != "dev":
        versions.setdefault(sha, datetime.utcnow().isoformat())
    return {"prints": prints, "usage": usage, "spools": spools, "fils": fils, "objs": objs, "links": links,
            "groups": groups, "snaps": snaps, "covers": covers, "pgroups": pgroups, "tags": tags,
            "act_days": act_days, "pages": pages, "late": late, "notif_days": notif_days, "dismiss": dismiss,
            "rfid_scans": rfid, "gfiles": gfiles, "versions": versions, "acts": acts, "changes": changes,
            "mwd": mwd, "accs": accs, "acc_objs": acc_objs, "n_users": n_users, "spool_more": spool_more,
            "queue": _queue_size()}


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

    by_print = defaultdict(list)
    for u in d["usage"]:
        by_print[u.print_id].append(u)
    fil_of_spool = {s.id: s.filament_id for s in d["spools"]}

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
            for n_, key_ in ((42, "dont_panic"), (100, "hundred"), (777, "jackpot"), (1337, "leet"), (2000, "y2k")):
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
    # bobines
    done = sorted((_ts(s.updated_at) or now) for s in d["spools"] if s.archived)
    for i, dt in enumerate(done, 1):
        push("spools_done", dt, i)
    dried = sorted(_ts(s.last_dried_at) for s in d["spools"] if _ts(s.last_dried_at))
    for i, dt in enumerate(dried, 1):
        push("dried", dt, i)
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
    sold = sorted(((_ts(o.sold_date) or _ts(o.updated_at) or now), o.sold_price or 0, o.margin or 0)
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
    _durations(push, d)
    _wide(push, d, now)
    acc = 0
    for dt, q in sorted(((_ts(lk.created_at) or now), (lk.quantity or 0)) for lk in d["links"]):
        acc += q
        push("accessories", dt, acc)
    return S


# Actions du journal qui comptent pour un succes : (succes, methode, chemin)
_ACT_PATTERNS = [
    ("shares", "POST", r"^/api/v1/share/(?!telegram)[^/]+/[^/]+$"),
    ("mw_rates", "POST", r"^/api/v1/makerworld/rate/\d+$"),
    ("mw_boosts_given", "POST", r"^/api/v1/makerworld/model/\d+/boost$"),
    ("mw_likes_given", "PUT", r"^/api/v1/makerworld/model/\d+/like$"),
    ("mw_collected", "PUT", r"^/api/v1/makerworld/design/\d+/collections$"),
]


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
    covers = len(d.get("covers", [])) + sum(1 for g in d.get("pgroups", []) if (g.cover_photo or "").strip())
    push("covers", now, covers)
    cumul("print_groups", [_ts(g.created_at) or now for g in d.get("pgroups", [])])
    push("tags", now, len(d.get("tags", [])))
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
    n_done = n_ok = 0
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
        if st == "CANCELLED":
            inc("cancelled", end)
        if ok and dur > record:
            if record:
                inc("records", end)
            record = dur
        # taux de reussite, des 100 impressions terminees (meilleur atteint)
        n_done += 1
        n_ok += ok
        if n_done >= 100:
            push("success_rate", end, int(100 * n_ok / n_done))
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


def _durations(push, d) -> None:
    """Durees (longues, express, nuit, d'affilee, perdues, par jour et par
    mois), poids, plateaux, imprimantes ; changements de filament."""
    longs = express = feather = sturdy = multi = 0
    night = lost = 0.0
    per_day, per_month = defaultdict(float), defaultdict(float)
    printers = set()
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
        if getattr(p, "printer_model", None):
            printers.add(str(p.printer_model).strip().upper())
            push("printers", start, len(printers))
        night += _night_overlap(start, end)
        push("night_hours", end, int(night))
        if ko:
            lost += dur / 3600
            push("lost_hours", end, int(lost))
        per_day[loc.date()] += dur / 3600
        push("day_hours", start, int(per_day[loc.date()]))
        per_month[(loc.year, loc.month)] += dur / 3600
        push("month_hours", end, int(per_month[(loc.year, loc.month)]))
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


async def evaluate(now: datetime | None = None) -> dict:
    """Valeurs actuelles et paliers atteints (avec leur date), sans rien ecrire."""
    now = now or datetime.utcnow()
    series = compute_series(await _load_data(), now)
    live = await _live_values()
    out = {}
    for a in CATALOG:
        s = series.get(a["id"], [])
        val = s[-1][1] if s else 0
        if a["id"] in live:
            val = live[a["id"]]
        reached = {}
        for i, n in enumerate(a["tiers"]):
            at = next((dt for dt, v in s if v >= n), None)
            if at is None and a["id"] in live and val >= n:
                at = now
            if at is not None:
                reached[str(i)] = at.isoformat()
        out[a["id"]] = {"value": val, "reached": reached}
    return out


async def tick(notify: bool = True) -> list:
    """Enregistre les paliers nouvellement atteints ; notifie apres le premier
    passage. Rend la liste des (id, cran) nouveaux."""
    ev = await evaluate()
    st = await _state_get()
    first = st is None
    st = st or {"unlocked": {}, "best": {}}
    # seuils changes depuis le dernier passage : on recalcule en silence
    silent = first or st.get("version") != CATALOG_VERSION
    new = []
    for aid, r in ev.items():
        old = dict(st["unlocked"].get(aid) or {})
        if BY_ID[aid].get("live"):
            got = {**old}
            for i, at in r["reached"].items():
                got.setdefault(i, at)
            got = {i: at for i, at in got.items() if int(i) < len(BY_ID[aid]["tiers"])}
        else:
            # date reelle tiree de l'historique ; un cran deja connu garde la sienne
            got = {i: old.get(i, at) for i, at in r["reached"].items()}
        new += [(aid, int(i)) for i in got if i not in old]
        st["unlocked"][aid] = got
        st["best"][aid] = max(st["best"].get(aid, 0) or 0, r["value"] or 0)
    st["unlocked"] = {k: v for k, v in st["unlocked"].items() if v and k in BY_ID}
    st["version"] = CATALOG_VERSION
    sha = (os.getenv("COMMIT_SHA") or "")[:8]
    if sha and sha != "dev":
        st.setdefault("versions", {}).setdefault(sha, datetime.utcnow().isoformat())
    if first:
        st["since"] = datetime.utcnow().isoformat()
    await _state_put(st)
    _CACHE["v"] = None
    if new and notify and not silent:
        await _notify(new, ev)
    return [] if silent else new


def _fmt_n(n, a) -> str:
    if isinstance(n, float) and not n.is_integer():
        s = f"{n:.1f}".replace(".", ",")
    else:
        s = f"{int(n):,}".replace(",", " ")
    return s


def describe(a: dict, n) -> str:
    return a["desc"].replace("{n}", _fmt_n(n, a))


async def _notify(new: list, ev: dict) -> None:
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
    aid, i = items[0]
    a, t = BY_ID[aid], tiers_of(BY_ID[aid])[i]
    title = (f"🏅 Succès débloqué : {a['name']} {t['emoji']}" if len(items) == 1
             else f"🏅 {len(items)} succès débloqués")
    await N.notify("achievement_unlocked", title, "\n".join(lines),
                   click=N.app_link(cfg, f"/stats?tab=achievements&a={aid}"), priority=3)


# ── Bilan par section (page, podium entre copains) ───────────────────────────
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
    return {"cats": cats, "score": sum(c["score"] for c in cats.values()),
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
    people += list(await asyncio.gather(*(one(f) for f in await F._load())))
    out = {"people": people, "categories": [{"id": c, "emoji": e, "name": n} for c, e, n in CATEGORIES]}
    _PODIUM.update(t=time.time(), v=out)
    return out


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
    return {**v, "items": items}


async def my_uniques() -> list:
    """Mes medailles uniques gagnees (envoyees quand je regarde chez un copain)."""
    st = await _state_get() or {}
    return sorted(aid for aid, got in (st.get("unlocked") or {}).items()
                  if got and aid in BY_ID and len(BY_ID[aid]["tiers"]) == 1)


# ── Vue pour la page ─────────────────────────────────────────────────────────
async def view(fresh: bool = False) -> dict:
    if not fresh and _CACHE["v"] and time.time() - _CACHE["t"] < 60:
        return _CACHE["v"]
    ev = await evaluate()
    st = await _state_get() or {"unlocked": {}}
    medals = {t["id"]: 0 for t in TIERS + [UNIQUE]}
    score = score_max = 0
    items = []
    for a in CATALOG:
        r = ev[a["id"]]
        got = dict(r["reached"])
        stored = (st.get("unlocked") or {}).get(a["id"]) or {}
        if a.get("live"):                               # acquis, meme si la valeur a baisse
            got.update({i: at for i, at in stored.items() if int(i) < len(a["tiers"])})
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
        items.append({
            "id": a["id"], "cat": a["cat"], "emoji": "❔" if secret else a["emoji"],
            "name": "Succès secret" if secret else a["name"],
            "desc": "Continue d'imprimer : il se dévoilera tout seul." if secret else
                    describe(a, a["tiers"][nxt if nxt is not None else lvl]),
            # medaille unique gagnee : ce qu'elle raconte, et ce qui l'a valu
            "lore": a.get("lore") if lvl >= 0 and len(a["tiers"]) == 1 else None,
            "secret": bool(a.get("hidden")), "money": bool(a.get("money")), "unit": a.get("unit"),
            "sub": a.get("sub"),
            "value": None if secret else r["value"], "level": lvl,
            "next": None if nxt is None or secret else a["tiers"][nxt],
            "prev": a["tiers"][lvl] if lvl >= 0 else 0,
            "tiers": [{**{k: t[k] for k in ("id", "label", "emoji", "color")}, "n": a["tiers"][i],
                       "at": got.get(str(i))} for i, t in enumerate(tiers)],
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
    out = {"items": items, "medals": medals, "score": score, "score_max": score_max,
           "categories": [{"id": c, "emoji": e, "name": n} for c, e, n in CATEGORIES],
           "subs": [{"id": i, "emoji": e, "name": n} for i, e, n, _ids in SECRET_SUBS],
           "tiers": TIERS + [UNIQUE], "recent": [{"id": i, "tier": j, "at": at} for at, i, j in recent],
           "since": (st or {}).get("since")}
    _CACHE.update(t=time.time(), v=out)
    return out
