"""
Succes (20/10/2026) : des paliers atteints sur l'historique, chacun avec sa
medaille (bronze, argent, or, platine, diamant), ou une medaille unique pour
les succes d'un seul cran (souvent secrets).

Chaque succes calcule une serie de (date, valeur) qui ne fait que monter
(cumul ou meilleur score) : un palier est atteint a la premiere date ou la
valeur le passe. Les succes tires de l'historique (impressions, bobines,
objets) ont donc leur VRAIE date, meme au premier calcul. Ceux qui ne se
lisent qu'au present (MakerWorld, stock, copains) prennent la date du jour ou
on les constate.

Reglage ACHIEVEMENTS : {"unlocked": {id: {cran: iso}}, "best": {id: valeur}}.
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
]
UNIQUE = {"id": "unique", "label": "Unique", "emoji": "🏵️", "color": "#EC4899", "score": 3}

CATEGORIES = [
    ("prints", "🖨️", "Impressions"),
    ("filaments", "🧵", "Filaments"),
    ("objects", "🧸", "Objets et ventes"),
    ("mw", "🌐", "MakerWorld"),
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
    _a("first_print", "prints", "🐣", "Premier pas", "Ta première impression réussie", [1]),
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
    # Objets et ventes
    _a("objects", "objects", "🧸", "Fabricant", "{n} objets créés", [10, 50, 200, 500, 1000]),
    _a("sold", "objects", "💶", "Commerçant", "{n} objets vendus", [1, 10, 50, 100, 500]),
    _a("revenue", "objects", "💰", "Chiffre d'affaires", "{n} € de ventes", [50, 250, 1000, 5000, 10000], unit="€", money=True),
    _a("gifted", "objects", "🎁", "Généreux", "{n} objets offerts", [1, 5, 20, 50, 100]),
    _a("personal", "objects", "🏠", "Fait maison", "{n} objets gardés pour toi", [5, 25, 50, 100, 250]),
    _a("accessories", "objects", "🔩", "Bricoleur", "{n} accessoires posés sur des objets", [10, 50, 200, 500, 1000]),
    # MakerWorld (lu au present sur le profil)
    _a("mw_designs", "mw", "📐", "Créateur", "{n} modèles publiés sur MakerWorld", [1, 5, 10, 25, 50]),
    _a("mw_downloads", "mw", "⬇️", "Téléchargé", "{n} téléchargements de tes modèles", [100, 1000, 5000, 10000, 50000]),
    _a("mw_prints", "mw", "🖨️", "Imprimé ailleurs", "{n} impressions de tes modèles", [100, 1000, 5000, 10000, 50000]),
    _a("mw_boosts", "mw", "🚀", "Boosté", "{n} boosts reçus", [10, 50, 200, 500, 1000]),
    _a("mw_fans", "mw", "👥", "Influenceur", "{n} abonnés", [10, 100, 500, 1000, 5000]),
    _a("mw_likes", "mw", "❤️", "Apprécié", "{n} « j'aime » sur tes modèles", [100, 500, 2000, 5000, 10000]),
    _a("mw_level", "mw", "⭐", "Niveau", "Niveau {n} sur MakerWorld", [5, 10, 20, 30, 40]),
    # Copains
    _a("friends", "social", "🤝", "Bande de copains", "{n} copains reliés", [1, 3, 5, 10, 20]),
    # Secrets : une medaille unique, cachee tant qu'elle n'est pas gagnee
    _a("halloween", "secret", "🎃", "Spooky", "Une impression lancée un 31 octobre", [1], hidden=True),
    _a("christmas", "secret", "🎄", "Joyeux Noël", "Une impression lancée un 24 ou 25 décembre", [1], hidden=True),
    _a("new_year", "secret", "🎆", "Bonne année", "Une impression en cours au passage du Nouvel An", [1], hidden=True),
    _a("friday13", "secret", "🐈‍⬛", "Vendredi 13", "Une impression lancée un vendredi 13", [1], hidden=True),
    _a("pi_day", "secret", "🥧", "Jour de Pi", "Une impression lancée un 14 mars", [1], hidden=True),
    _a("tiny", "secret", "🐜", "Miniature", "Une impression réussie de moins de 1 g", [1], hidden=True),
    _a("flash", "secret", "⚡", "Éclair", "Une impression réussie en moins de 10 minutes", [1], hidden=True),
    _a("all_nighter", "secret", "🌙", "Nuit blanche", "Une impression de plus de 8 h lancée après 22 h", [1], hidden=True),
    _a("comeback", "secret", "💪", "Persévérant", "Un modèle enfin réussi après 3 échecs d'affilée", [1], hidden=True),
    _a("rainbow16", "secret", "🦄", "Licorne", "Une impression de 8 couleurs ou plus", [1], hidden=True),
]
LIVE = {"mw_designs", "mw_downloads", "mw_prints", "mw_boosts", "mw_fans", "mw_likes", "mw_level", "friends", "stock"}
for _x in CATALOG:
    _x["live"] = _x["id"] in LIVE
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
    from ..models.object_history import Object, ObjectAccessory
    from ..models.print_history import FilamentUsage, Print
    async with AsyncSessionLocal() as db:
        prints = (await db.execute(select(Print.id, Print.print_date, Print.status, Print.duration_seconds,
                                          Print.total_weight_g, Print.design_id, Print.translated_name,
                                          Print.file_name).order_by(Print.print_date, Print.id))).all()
        usage = (await db.execute(select(FilamentUsage.print_id, FilamentUsage.spool_id, FilamentUsage.filament_type,
                                         FilamentUsage.color_hex, FilamentUsage.grams_used))).all()
        spools = (await db.execute(select(Spool.id, Spool.filament_id, Spool.archived, Spool.updated_at,
                                          Spool.last_dried_at, Spool.created_at))).all()
        fils = (await db.execute(select(Filament.id, Filament.manufacturer, Filament.swatch, Filament.updated_at,
                                        Filament.created_at))).all()
        objs = (await db.execute(select(Object.id, Object.status, Object.sold_date, Object.sold_price,
                                        Object.created_at, Object.updated_at))).all()
        links = (await db.execute(select(ObjectAccessory.quantity, ObjectAccessory.created_at))).all()
    return {"prints": prints, "usage": usage, "spools": spools, "fils": fils, "objs": objs, "links": links}


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
        # dates particulieres
        if (loc.month, loc.day) == (10, 31):
            push("halloween", start, 1)
        if (loc.month, loc.day) in ((12, 24), (12, 25)):
            push("christmas", start, 1)
        if loc.month == 3 and loc.day == 14:
            push("pi_day", start, 1)
        if loc.day == 13 and loc.weekday() == 4:
            push("friday13", start, 1)
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
    push("stock", now, sum(1 for s in d["spools"] if not s.archived))
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
    sold = sorted(((_ts(o.sold_date) or _ts(o.updated_at) or now), o.sold_price or 0) for o in d["objs"] if o.status == "sold")
    tot = 0.0
    for i, (dt, pr) in enumerate(sold, 1):
        tot += pr
        push("sold", dt, i)
        push("revenue", dt, round(tot, 2))
    for st_, key in (("gifted", "gifted"), ("personal", "personal")):
        for i, dt in enumerate(sorted((_ts(o.updated_at) or now) for o in d["objs"] if o.status == st_), 1):
            push(key, dt, i)
    acc = 0
    for dt, q in sorted(((_ts(lk.created_at) or now), (lk.quantity or 0)) for lk in d["links"]):
        acc += q
        push("accessories", dt, acc)
    return S


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
                        "mw_level": p.get("level") or 0})
    except Exception as e:
        logger.info(f"[SUCCES] profil MakerWorld illisible : {e}")
    try:
        from .friends import list_friends
        out["friends"] = len(await list_friends())
    except Exception:
        pass
    return out


# ── Etat ─────────────────────────────────────────────────────────────────────
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
    """Valeurs actuelles et crans atteints (avec leur date), sans rien ecrire."""
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
    """Enregistre les crans nouvellement atteints ; notifie apres le premier
    passage. Rend la liste des (id, cran) nouveaux."""
    ev = await evaluate()
    st = await _state_get()
    first = st is None
    st = st or {"unlocked": {}, "best": {}}
    new = []
    for aid, r in ev.items():
        got = st["unlocked"].setdefault(aid, {})
        for i, at in r["reached"].items():
            if i not in got:
                # date reelle si l'historique la donne, sinon maintenant
                got[i] = at
                new.append((aid, int(i)))
        st["best"][aid] = max(st["best"].get(aid, 0) or 0, r["value"] or 0)
    st["unlocked"] = {k: v for k, v in st["unlocked"].items() if v}
    if first:
        st["since"] = datetime.utcnow().isoformat()
    await _state_put(st)
    _CACHE["v"] = None
    if new and notify and not first:
        await _notify(new, ev)
    return [] if first else new


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
                     + (f" — prochain cran : {_fmt_n(nxt, a)}" if nxt is not None and not a.get("money") else ""))
    if len(items) > 8:
        lines.append(f"… et {len(items) - 8} autre(s)")
    aid, i = items[0]
    a, t = BY_ID[aid], tiers_of(BY_ID[aid])[i]
    title = (f"🏅 Succès débloqué : {a['name']} {t['emoji']}" if len(items) == 1
             else f"🏅 {len(items)} succès débloqués")
    await N.notify("achievement_unlocked", title, "\n".join(lines),
                   click=N.app_link(cfg, f"/achievements?a={aid}"), priority=3)


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
        got.update((st.get("unlocked") or {}).get(a["id"]) or {})      # deja acquis (meme si la valeur a baisse)
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
            "secret": bool(a.get("hidden")), "money": bool(a.get("money")), "unit": a.get("unit"),
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
           "tiers": TIERS + [UNIQUE], "recent": [{"id": i, "tier": j, "at": at} for at, i, j in recent],
           "since": (st or {}).get("since")}
    _CACHE.update(t=time.time(), v=out)
    return out
