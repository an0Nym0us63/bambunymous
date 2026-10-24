"""Releves pour les succes (22/10/2026) : ce que l'imprimante dit en direct et
que rien d'autre ne garde -- connexion, couches, changements de bobine pendant
une impression, alertes, humidite des AMS, chambre, couleurs chargees -- et ce
que font les copains en meme temps que moi.

Lu toutes les 15 s, sauve en reglage (une ligne JSON). Rien de retroactif : tout
compte a partir de la mise en route. Les succes le lisent au present (`values`).
"""
import asyncio
import json
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

KEY = "ACHIEVEMENTS_WATCH"
STEP_S = 15
SAVE_S = 120
GAP_S = 600                  # plus de 10 min sans releve (appli arretee) : la suite est inconnue
DRY_MAX, DRY_SAMPLES = 30, 240   # humidite des AMS sous 30 % ; une journee compte avec 1 h de releves
OVEN_C = 45
DOOR_N, DOOR_S = 3, 60       # trois ouvertures de la porte en 60 s
LIVE = ("RUNNING", "PAUSE", "PAUSED", "PREPARE", "SLICING")
W: dict = {}


def fresh() -> dict:
    return {"last": None, "online_since": None, "online_best_h": 0.0, "job": None, "max_layers": 0, "mille": None,
            "clean": 0, "swaps_total": 0, "swaps_max": 0, "hms": [], "oven": None, "door": None, "marathon": None, "rainbow": None,
            "dry_days": 0, "day": None, "day_ok": True, "day_n": 0,
            "duel": 0, "band": 0, "duel_on": False, "band_on": False, "same_taste": None, "friends_at": None, "taste_at": None}


def _iso(t):
    return t.isoformat() if t else None


def _ts(s):
    try:
        return datetime.fromisoformat(s) if s else None
    except ValueError:
        return None


def _real_ams(a) -> bool:
    """Un vrai AMS (pas le support externe)."""
    from ..core.mqtt import EXT_AMS_ID
    return a.id not in (EXT_AMS_ID, 254)


def step(s, now: datetime, w: dict, local_day: str) -> bool:
    """Un releve de l'etat `s` (PrinterState) a l'instant `now`. Rend True si
    quelque chose merite d'etre sauve tout de suite (une impression finie…)."""
    ev = False
    last = _ts(w.get("last"))
    gap = bool(last) and (now - last).total_seconds() > GAP_S
    w["last"] = _iso(now)
    # connexion : heures d'affilee ; une coupure de l'appli remet le compteur a zero
    if s.connected:
        if not w.get("online_since") or gap:
            w["online_since"] = _iso(now)
        h = (now - _ts(w["online_since"])).total_seconds() / 3600
        w["online_best_h"] = max(w.get("online_best_h") or 0, round(h, 2))
    else:
        w["online_since"] = None
    # alertes rencontrees (codes differents)
    for e in s.hms_errors or []:
        c = str(e.get("code") or e.get("ecode") or "").strip()
        if c and c not in w["hms"]:
            w["hms"] = (w["hms"] + [c])[-200:]
            ev = True
    # l'impression en cours
    st = str(s.status or "").upper()
    job = w.get("job")
    if st in LIVE:
        key = str(s.job_id or s.print_name or "?")
        if not job or job.get("key") != key:
            job = w["job"] = {"key": key, "start": _iso(now), "swaps": 0, "tray": None, "alert": False, "off": False, "layers": 0}
        if gap or not s.connected:
            job["off"] = True
        if st == "RUNNING":
            tr = [s.active_ams_id, s.active_tray_id]
            if tr[0] is not None and tr[0] >= 0 and tr[1] is not None and tr[1] >= 0:
                if job["tray"] and tr != job["tray"]:
                    job["swaps"] += 1
                    w["swaps_total"] = (w.get("swaps_total") or 0) + 1
                    w["swaps_max"] = max(w.get("swaps_max") or 0, job["swaps"])
                job["tray"] = tr
        if s.hms_errors or s.print_error:
            job["alert"] = True
        job["layers"] = max(job.get("layers") or 0, int(s.total_layers or 0))
    elif job:
        if st == "FINISH":                           # reussie
            n = max(job.get("layers") or 0, int(s.total_layers or 0))
            w["max_layers"] = max(w.get("max_layers") or 0, n)
            if n == 1000 and not w.get("mille"):
                w["mille"] = _iso(now)
            if not job.get("alert") and not s.print_error:
                w["clean"] = (w.get("clean") or 0) + 1
            start = _ts(job.get("start"))
            if start and (now - start) >= timedelta(hours=24) and not job.get("off") and not w.get("marathon"):
                w["marathon"] = _iso(now)
        w["job"] = None
        ev = True
    # la porte : trois ouvertures en moins d'une minute
    if not w.get("door"):
        t = sorted(getattr(s, "door_opens", None) or [])
        if any(t[i + DOOR_N - 1] - t[i] <= DOOR_S for i in range(len(t) - DOOR_N + 1)):
            w["door"] = _iso(now)
            ev = True
    # la chambre
    if (s.chamber_temp or 0) > OVEN_C and not w.get("oven"):
        w["oven"] = _iso(now)
        ev = True
    # quatre familles de couleurs dans un meme AMS
    if not w.get("rainbow"):
        from .achievements import _hue
        for a in s.ams_list or []:
            if not _real_ams(a) or len(a.trays or []) < 4:
                continue
            fam = {_hue((t.color or "").lstrip("#")) for t in a.trays if (t.color or "").strip() and (t.filament_type or "").strip()}
            fam.discard("?")
            if len(fam) >= 4:
                w["rainbow"] = _iso(now)
                ev = True
                break
    # air sec : une journee ou tous les AMS sont restes sous 30 %
    if w.get("day") != local_day:
        if w.get("day") and w.get("day_ok") and (w.get("day_n") or 0) >= DRY_SAMPLES:
            w["dry_days"] = (w.get("dry_days") or 0) + 1
            ev = True
        w["day"], w["day_ok"], w["day_n"] = local_day, True, 0
    hums = [a.humidity for a in s.ams_list or [] if _real_ams(a) and (a.humidity or 0) > 0]
    if hums:
        w["day_n"] = (w.get("day_n") or 0) + 1
        if max(hums) >= DRY_MAX:
            w["day_ok"] = False
    return ev


def friends_step(w: dict, me_printing: bool, n_friends: int, n_printing: int) -> None:
    """Un duel commence quand un copain imprime en meme temps que moi ; la bande,
    quand tous (au moins deux) impriment avec moi. Chaque debut compte une fois."""
    duel = me_printing and n_printing >= 1
    band = me_printing and n_friends >= 2 and n_printing >= n_friends
    if duel and not w.get("duel_on"):
        w["duel"] = (w.get("duel") or 0) + 1
    if band and not w.get("band_on"):
        w["band"] = (w.get("band") or 0) + 1
    w["duel_on"], w["band_on"] = duel, band


async def _load() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return {**fresh(), **(d if isinstance(d, dict) else {})}


async def _save() -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(W))


async def values() -> dict:
    """Ce que les succes en lisent."""
    w = W or await _load()
    return {"online_streak": int(w.get("online_best_h") or 0), "sky_layers": int(w.get("max_layers") or 0),
            "clean_prints": int(w.get("clean") or 0), "swaps_max": int(w.get("swaps_max") or 0),
            "swaps_total": int(w.get("swaps_total") or 0), "dry_days_ams": int(w.get("dry_days") or 0),
            "duels": int(w.get("duel") or 0), "band_prints": int(w.get("band") or 0),
            "mille_feuille": 1 if w.get("mille") else 0, "doctor": 1 if len(w.get("hms") or []) >= 10 else 0,
            "oven": 1 if w.get("oven") else 0, "door_dance": 1 if w.get("door") else 0, "marathon_online": 1 if w.get("marathon") else 0,
            "rainbow_ams": 1 if w.get("rainbow") else 0, "same_taste": 1 if w.get("same_taste") else 0}


async def _friends(now: datetime) -> None:
    """Toutes les 5 min : qui imprime en meme temps que moi. Toutes les 3 h : un
    modele que j'ai imprime cette semaine, un copain l'a-t-il imprime a 7 jours pres ?"""
    from . import friends_shared as F
    at = _ts(W.get("friends_at"))
    if not at or (now - at).total_seconds() >= 300:
        W["friends_at"] = _iso(now)
        me = F.my_state().get("state") == "printing"
        if me:
            r = await F.printing()
            n = len([v for v in (r.get("states") or {}).values()])
            friends_step(W, True, n, len(r.get("printing") or []))
        else:
            friends_step(W, False, 0, 0)
    at = _ts(W.get("taste_at"))
    if not W.get("same_taste") and (not at or (now - at).total_seconds() >= 3 * 3600):
        W["taste_at"] = _iso(now)
        from sqlalchemy import select
        from ..db.session import AsyncSessionLocal
        from ..models.print_history import Print
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(Print.design_id, Print.print_date).where(
                Print.print_date >= now - timedelta(days=7), Print.design_id.isnot(None), Print.design_id != "",
                Print.status.in_(("SUCCESS", "PARTIAL"))))).all()
        mine = {}
        for did, d in rows:
            mine.setdefault(str(did), d)
        for did, d in list(mine.items())[:10]:
            res = await F.for_design(did)
            for fr in res.get("friends") or []:
                for p in fr.get("prints") or []:
                    t = _ts(str(p.get("print_date") or "")[:19])
                    if t and abs((t - d).total_seconds()) <= 7 * 86400:
                        W["same_taste"] = _iso(now)
                        return


async def loop() -> None:
    """La boucle de fond (lancee au demarrage)."""
    global W
    from ..core.mqtt import get_state
    W = await _load()
    saved = datetime.utcnow()
    while True:
        try:
            now = datetime.utcnow()
            from .achievements import _local
            ev = step(get_state(), now, W, _local(now).date().isoformat())
            try:
                await _friends(now)
            except Exception as e:
                logger.info(f"[SUCCES] copains illisibles : {e}")
            if ev or (now - saved).total_seconds() >= SAVE_S:
                await _save()
                saved = now
        except Exception:
            logger.exception("[SUCCES] releve")
        await asyncio.sleep(STEP_S)
