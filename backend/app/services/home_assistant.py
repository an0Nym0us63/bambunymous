"""
Home Assistant (12/11/2026) : la prise de l'imprimante (etat, puissance, energie) et l'electricite reelle de chaque
impression, au bon tarif.

- La connexion : l'adresse de Home Assistant et un jeton longue duree (colle par l'utilisateur, jamais reaffiche),
  puis les entites choisies dans la liste lue chez lui : l'interrupteur de la prise (facultatif), la puissance (W),
  l'energie (kWh, compteur). Une prise qui ne donne que la puissance : les kWh sont integres a partir d'elle.
- La mesure d'une impression : l'historique de Home Assistant entre son debut et sa fin (jamais un releve « au debut »
  et « a la fin » : un redemarrage de l'appli ne fait rien perdre, et on peut recalculer). Au-dela de l'historique
  detaille (10 jours d'office), les statistiques (5 min, puis a l'heure, gardees sans limite pour un compteur).
  Le resultat est decoupe en tranches de 15 minutes, chacune a son prix et son libelle (HC, HP, Bleu HC…).
- Le tarif (ELEC) : « hour » (l'ancien tarif a l'heure, sans mesure), « base », « hchp » (plages d'heures creuses),
  « tempo » (6 prix, la couleur du jour lue chez Home Assistant ou sur api-couleur-tempo.fr), ou « ha » : une entite
  donne le prix en cours (EUR/kWh), une autre (facultative, recommandee) le libelle en cours.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

K_URL, K_TOKEN, K_CFG, K_ELEC, K_TEMPO, K_RUN = "HA_URL", "HA_TOKEN", "HA_CFG", "ELEC_TARIFF", "TEMPO_DAYS", "HA_BACKFILL"
K_COLORS = "ELEC_COLORS"                         # {libelle: couleur} choisies dans Parametres (12/11/2026)
MODES = ("hour", "base", "hchp", "tempo", "ha")
AUTO_DAYS = 3650                                 # le rattrapage d'office, au premier branchement : tout
SLOT = 15 * 60                                   # une tranche : 15 minutes
TEMPO = ("bleu", "blanc", "rouge")
_DEF_ELEC = {"mode": "hour", "base": None, "hc": None, "hp": None, "hc_ranges": "22:00-06:00",
             "tempo": {f"{c}_{h}": None for c in TEMPO for h in ("hc", "hp")}, "tempo_src": "api", "tempo_entity": "",
             "price_entity": "", "label_entity": ""}


class HAError(Exception):
    pass


# ── Reglages ─────────────────────────────────────────────────────────────────────
async def _get(key, default=""):
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        return await get_setting(db, key, default)


async def _set(key, value):
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, key, value)


def _j(raw, default):
    try:
        v = json.loads(raw) if raw else None
    except ValueError:
        v = None
    return v if isinstance(v, type(default)) else default


def _num(v):
    try:
        x = float(str(v).replace(",", ".").strip())
        return x if math.isfinite(x) and x >= 0 else None
    except (TypeError, ValueError):
        return None


async def cfg() -> dict:
    c = _j(await _get(K_CFG, ""), {})
    return {"switch": c.get("switch") or "", "power": c.get("power") or "", "energy": c.get("energy") or "",
            "meter": c.get("meter") if c.get("meter") in ("energy", "power") else "energy"}


async def elec() -> dict:
    e = _j(await _get(K_ELEC, ""), {})
    out = {**_DEF_ELEC, **{k: v for k, v in e.items() if k in _DEF_ELEC}}
    out["tempo"] = {**_DEF_ELEC["tempo"], **(e.get("tempo") if isinstance(e.get("tempo"), dict) else {})}
    if out["mode"] not in MODES:
        out["mode"] = "hour"
    return out


async def configured() -> bool:
    c = await cfg()
    return bool(await _get(K_URL, "") and await _get(K_TOKEN, "") and (c["energy"] if c["meter"] == "energy" else c["power"]))


async def colors() -> dict:
    return {k: v for k, v in _j(await _get(K_COLORS, ""), {}).items() if isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v)}


async def known_labels() -> list:
    """Les libelles qu'on connait : ceux de l'abonnement choisi, puis ceux des impressions mesurees (les plus recentes)."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    e = await elec()
    out = {"base": ["Base"], "hchp": ["HC", "HP"],
           "tempo": [f"{c.capitalize()} {h}" for c in TEMPO for h in ("HC", "HP")]}.get(e["mode"], [])[:]
    try:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(Print.energy_slots).where(Print.energy_slots.is_not(None))
                                     .order_by(Print.id.desc()).limit(300))).scalars().all()
        for raw in rows:
            for r in _j(raw, []):
                if len(r) >= 4 and r[3] and r[3] not in out:
                    out.append(r[3])
    except Exception:
        logger.exception("[HA] libelles")
    for k in await colors():
        if k not in out:
            out.append(k)
    return out[:40]


async def settings_get() -> dict:
    c, e = await cfg(), await elec()
    run = _j(await _get(K_RUN, ""), {})
    return {"url": await _get(K_URL, ""), "has_token": bool(await _get(K_TOKEN, "")), **c, "elec": e,
            "configured": await configured(), "backfill": run, "colors": await colors(), "labels": await known_labels()}


_ENT = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


async def settings_set(body: dict) -> dict:
    was = await configured()
    if "url" in body and body["url"] is not None:
        u = str(body["url"]).strip().rstrip("/")
        if u and not re.match(r"^https?://[^\s/]+", u):
            raise HAError("Adresse invalide : http(s)://… (ex. http://homeassistant.local:8123)")
        await _set(K_URL, u)
    if "token" in body and body["token"] is not None:
        t = str(body["token"]).strip()
        if t == "-" or t:                          # vide : on garde l'ancien ; « - » : on l'oublie
            await _set(K_TOKEN, "" if t == "-" else t)
    c = await cfg()
    for k in ("switch", "power", "energy"):
        if k in body and body[k] is not None:
            v = str(body[k]).strip()
            if v and not _ENT.match(v):
                raise HAError(f"Entité invalide : {v}")
            c[k] = v
    if body.get("meter") in ("energy", "power"):
        c["meter"] = body["meter"]
    await _set(K_CFG, json.dumps(c))
    if isinstance(body.get("colors"), dict):        # {libelle: "#rrggbb"} ; null : la couleur par defaut
        col = await colors()
        for k, v in body["colors"].items():
            k = str(k)[:40]
            if v is None:
                col.pop(k, None)
            elif isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v):
                col[k] = v
        await _set(K_COLORS, json.dumps(col))
    # (12/11/2026) la prise vient d'etre branchee : on remonte d'office tout ce que Home Assistant a garde (le detail sur
    # une dizaine de jours, puis les statistiques a l'heure) ; une impression d'avant la prise n'a rien et passe
    if not was and await configured() and not _j(await _get(K_RUN, ""), {}).get("at"):
        start_backfill(AUTO_DAYS)
    if isinstance(body.get("elec"), dict):
        e, b = await elec(), body["elec"]
        if b.get("mode") in MODES:
            e["mode"] = b["mode"]
        for k in ("base", "hc", "hp"):
            if k in b:
                e[k] = _num(b[k])
        if "hc_ranges" in b:
            r = str(b["hc_ranges"] or "").strip()
            if r and not _ranges(r):
                raise HAError("Heures creuses : « 22:00-06:00 », plusieurs plages séparées par des virgules")
            e["hc_ranges"] = r
        if isinstance(b.get("tempo"), dict):
            for k in e["tempo"]:
                if k in b["tempo"]:
                    e["tempo"][k] = _num(b["tempo"][k])
        if b.get("tempo_src") in ("api", "ha"):
            e["tempo_src"] = b["tempo_src"]
        for k in ("tempo_entity", "price_entity", "label_entity"):
            if k in b:
                v = str(b[k] or "").strip()
                if v and not _ENT.match(v):
                    raise HAError(f"Entité invalide : {v}")
                e[k] = v
        await _set(K_ELEC, json.dumps(e))
        from .print_tracker import _bg
        _bg(reprice_all())                      # un tarif change : les tranches deja mesurees reprennent leur prix
    return await settings_get()


# ── L'API de Home Assistant ──────────────────────────────────────────────────────
async def _conn():
    url, tok = await _get(K_URL, ""), await _get(K_TOKEN, "")
    if not url or not tok:
        raise HAError("Home Assistant n'est pas branché (adresse et jeton dans Paramètres › Connexions)")
    return url, tok


async def _api(path: str, params: dict | None = None, timeout: float = 20):
    import aiohttp
    url, tok = await _conn()
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as s:
            async with s.get(url + "/api" + path, params=params or {}, headers={"Authorization": f"Bearer {tok}"}) as r:
                if r.status == 401:
                    raise HAError("Home Assistant refuse le jeton (401) : recrée un jeton longue durée")
                if r.status == 404:
                    raise HAError("Introuvable chez Home Assistant (404) : l'entité existe-t-elle encore ?")
                if r.status >= 400:
                    raise HAError(f"Home Assistant répond {r.status}")
                return await r.json(content_type=None)
    except HAError:
        raise
    except asyncio.TimeoutError:
        raise HAError("Home Assistant ne répond pas (délai dépassé)")
    except Exception as e:                             # noqa: BLE001
        raise HAError(f"Home Assistant injoignable : {type(e).__name__}")


async def _ws(msg: dict, timeout: float = 30):
    """Une commande par le websocket (les statistiques n'existent pas en REST)."""
    import aiohttp
    url, tok = await _conn()
    ws_url = re.sub(r"^http", "ws", url) + "/api/websocket"
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as s:
            async with s.ws_connect(ws_url, heartbeat=20) as ws:
                await ws.receive_json()                                    # auth_required
                await ws.send_json({"type": "auth", "access_token": tok})
                a = await ws.receive_json()
                if a.get("type") != "auth_ok":
                    raise HAError("Home Assistant refuse le jeton")
                await ws.send_json({"id": 1, **msg})
                while True:
                    r = await ws.receive_json()
                    if r.get("id") == 1:
                        if not r.get("success"):
                            raise HAError(f"Home Assistant : {(r.get('error') or {}).get('message') or 'erreur'}")
                        return r.get("result")
    except HAError:
        raise
    except Exception as e:                             # noqa: BLE001
        raise HAError(f"Home Assistant (websocket) : {type(e).__name__}")


async def test() -> dict:
    r = await _api("/config")
    return {"ok": True, "version": r.get("version"), "name": r.get("location_name")}


def _unit(st) -> str:
    return str(((st or {}).get("attributes") or {}).get("unit_of_measurement") or "")


async def entities(kind: str = "") -> list:
    """Les entites de Home Assistant, celles qui conviennent a « kind » d'abord (switch, power, energy, price, label)."""
    rows = await _api("/states")
    out = []
    for st in rows or []:
        eid = st.get("entity_id") or ""
        dom, a = eid.split(".", 1)[0], st.get("attributes") or {}
        u, dc = _unit(st), a.get("device_class") or ""
        fit = {"switch": dom in ("switch", "input_boolean", "light"),
               "power": dom == "sensor" and (dc == "power" or u in ("W", "kW")),
               "energy": dom == "sensor" and (dc == "energy" or u in ("Wh", "kWh", "MWh")),
               "price": dom in ("sensor", "input_number") and ("€" in u or "eur" in u.lower() or dc == "monetary"),
               "label": dom in ("sensor", "select", "input_select", "input_text") and not dc
                        and not u}.get(kind, True)
        if not fit:
            continue
        out.append({"id": eid, "name": a.get("friendly_name") or eid, "state": st.get("state"), "unit": u})
    out.sort(key=lambda x: x["name"].lower())
    return out[:600]


def _f(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


_TO_KWH = {"wh": 0.001, "kwh": 1.0, "mwh": 1000.0}
_TO_W = {"w": 1.0, "kw": 1000.0}


async def live(lite: bool = False) -> dict:
    """La prise maintenant : allumee, puissance, compteur, et le tarif en cours. lite (12/11/2026, la tuile de l'accueil,
    relue toutes les 30 s) : l'interrupteur et la puissance seulement, sans compteur ni tarif."""
    if not await _get(K_URL, ""):
        return {"configured": False}
    c, out = await cfg(), {"configured": await configured()}
    try:
        for k in (("switch", "power") if lite else ("switch", "power", "energy")):
            if not c[k]:
                continue
            st = await _api(f"/states/{c[k]}")
            v, u = st.get("state"), _unit(st).lower()
            if k == "switch":
                out["on"] = v == "on" if v in ("on", "off") else None
            elif k == "power":
                out["power_w"] = round(_f(v) * _TO_W.get(u, 1.0), 1) if _f(v) is not None else None
            else:
                out["energy_kwh"] = round(_f(v) * _TO_KWH.get(u, 1.0), 3) if _f(v) is not None else None
        if not lite:
            now = datetime.now(timezone.utc)
            res = await _resolver(now - timedelta(minutes=1), now + timedelta(minutes=1))
            out["price"], out["label"] = res(now)
    except HAError as e:
        out["error"] = str(e)
    return out


# ── Les historiques ──────────────────────────────────────────────────────────────
def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _pt(s) -> datetime | None:
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


async def _history(eid: str, t0: datetime, t1: datetime) -> list:
    """[(t, etat brut)], dans l'ordre ; le premier point est l'etat au debut (Home Assistant le donne)."""
    r = await _api(f"/history/period/{_iso(t0)}", {"end_time": _iso(t1), "filter_entity_id": eid,
                                                    "minimal_response": "", "no_attributes": ""}, timeout=40)
    pts = []
    for serie in r or []:
        for x in serie or []:
            t = _pt(x.get("last_changed") or x.get("last_updated"))
            if t:
                pts.append((t, x.get("state")))
    pts.sort(key=lambda p: p[0])
    return pts


async def _stats(eid: str, t0: datetime, t1: datetime, period: str, types: list) -> list:
    r = await _ws({"type": "recorder/statistics_during_period", "start_time": _iso(t0), "end_time": _iso(t1),
                   "statistic_ids": [eid], "period": period, "types": types}, timeout=40)
    rows = (r or {}).get(eid) or []
    out = []
    for x in rows:
        t = x.get("start")
        t = datetime.fromtimestamp(t / 1000, timezone.utc) if isinstance(t, (int, float)) else _pt(t)
        if t:
            out.append((t, x))
    return out


def _slots(t0: datetime, t1: datetime) -> list:
    """Les bornes des tranches de 15 min (alignees sur le quart d'heure) qui couvrent [t0, t1]."""
    a = t0.replace(second=0, microsecond=0)
    a = a - timedelta(minutes=a.minute % 15)
    out, t = [], a
    while t < t1:
        out.append((max(t, t0), min(t + timedelta(seconds=SLOT), t1)))
        t += timedelta(seconds=SLOT)
    return [s for s in out if s[1] > s[0]]


def _cumul(pts: list, k: float) -> list:
    """Un compteur (kWh) rendu croissant : une remise a zero (prise debranchee) repart de la derniere valeur."""
    out, off, last = [], 0.0, None
    for t, v in pts:
        x = _f(v)
        if x is None:
            continue
        x *= k
        if last is not None and x < last - 1e-6:
            off += last                    # remis a zero : le compteur repart de 0, on continue depuis l'ancien total
        last = x
        out.append((t, x + off))
    return out


def _at(curve: list, t: datetime):
    """La valeur d'une courbe croissante a l'instant t (lineaire entre deux points, constante hors)."""
    if not curve:
        return None
    if t <= curve[0][0]:
        return curve[0][1]
    for (a, va), (b, vb) in zip(curve, curve[1:]):
        if a <= t <= b:
            span = (b - a).total_seconds()
            return va if span <= 0 else va + (vb - va) * (t - a).total_seconds() / span
    return curve[-1][1]


def _energy_from_counter(pts, k, slots):
    c = _cumul(pts, k)
    if len(c) < 1:
        return None
    return [max(0.0, (_at(c, b) or 0) - (_at(c, a) or 0)) for a, b in slots]


def _energy_from_power(pts, k, slots):
    """La puissance tenue jusqu'au changement suivant (c'est ainsi que Home Assistant l'enregistre), integree."""
    steps = [(t, _f(v) * k) for t, v in pts if _f(v) is not None]
    if not steps:
        return None
    out = []
    for a, b in slots:
        e = 0.0
        for i, (t, w) in enumerate(steps):
            nxt = steps[i + 1][0] if i + 1 < len(steps) else b
            lo, hi = max(a, t), min(b, nxt)
            if hi > lo:
                e += w * (hi - lo).total_seconds() / 3600 / 1000
        out.append(e)
    return out


def _spread(rows, slots, kwh_of):
    """Des statistiques par periode ([(debut, ligne)], periode de longueur fixe) reparties sur les tranches au prorata."""
    if not rows:
        return None
    span = (rows[1][0] - rows[0][0]) if len(rows) > 1 else timedelta(hours=1)
    out = [0.0] * len(slots)
    for t, x in rows:
        e = kwh_of(x)
        if e is None:
            continue
        te = t + span
        for i, (a, b) in enumerate(slots):
            lo, hi = max(a, t), min(b, te)
            if hi > lo:
                out[i] += e * (hi - lo).total_seconds() / span.total_seconds()
    return out


async def _measure_window(t0: datetime, t1: datetime) -> tuple[list, list, str]:
    """(tranches, kWh par tranche, source)."""
    c = await cfg()
    slots = _slots(t0, t1)
    if not slots:
        raise HAError("Impression sans durée")
    eid = c["energy"] if c["meter"] == "energy" else c["power"]
    if not eid:
        raise HAError("Choisis l'entité d'énergie (ou de puissance) de la prise")
    st = await _api(f"/states/{eid}")
    u = _unit(st).lower()
    k = _TO_KWH.get(u, 1.0) if c["meter"] == "energy" else _TO_W.get(u, 1.0)
    pad = timedelta(minutes=20)
    pts = await _history(eid, t0 - pad, t1 + timedelta(minutes=2))
    # l'historique detaille couvre-t-il l'impression ? (le premier point est l'etat au debut demande)
    if pts and pts[0][0] <= t0 + timedelta(minutes=5) and len(pts) >= 2:
        kw = _energy_from_counter(pts, k, slots) if c["meter"] == "energy" else _energy_from_power(pts, k, slots)
        if kw is not None:
            return slots, kw, "historique"
    for period in ("5minute", "hour"):
        if c["meter"] == "energy":
            rows = await _stats(eid, t0 - timedelta(hours=1), t1 + timedelta(hours=1), period, ["change", "sum"])
            kw = _spread(rows, slots, lambda x: (_f(x.get("change")) * k) if _f(x.get("change")) is not None else None)
        else:
            rows = await _stats(eid, t0 - timedelta(hours=1), t1 + timedelta(hours=1), period, ["mean"])
            h = 5 / 60 if period == "5minute" else 1.0
            kw = _spread(rows, slots, lambda x: (_f(x.get("mean")) * k / 1000 * h) if _f(x.get("mean")) is not None else None)
        if kw is not None and any(kw):
            return slots, kw, "statistiques 5 min" if period == "5minute" else "statistiques horaires"
    raise HAError("Home Assistant n'a rien gardé pour cette période")


# ── Les tarifs ───────────────────────────────────────────────────────────────────
def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(os.getenv("TZ") or "Europe/Paris")
    except Exception:
        return timezone.utc


def _ranges(s: str) -> list:
    out = []
    for part in str(s or "").split(","):
        m = re.fullmatch(r"\s*(\d{1,2})[:h](\d{2})\s*-\s*(\d{1,2})[:h](\d{2})\s*", part)
        if not m:
            return []
        a, b = int(m[1]) * 60 + int(m[2]), int(m[3]) * 60 + int(m[4])
        if a > 1440 or b > 1440:
            return []
        out.append((a, b))
    return out


def _is_hc(dt_local: datetime, ranges: list) -> bool:
    m = dt_local.hour * 60 + dt_local.minute
    return any((a <= m < b) if a <= b else (m >= a or m < b) for a, b in ranges)


def _color(v) -> str | None:
    s = str(v or "").strip().lower()
    for c, keys in (("bleu", ("bleu", "blue", "1", "tempo_bleu")), ("blanc", ("blanc", "white", "2", "tempo_blanc")),
                    ("rouge", ("rouge", "red", "3", "tempo_rouge"))):
        if s in keys or any(s.startswith(x) for x in keys if len(x) > 1):
            return c
    return None


async def _tempo_api(days: list) -> dict:
    """La couleur de chaque jour Tempo (le jour J court de 6 h a 6 h le lendemain), gardee en reglage."""
    import aiohttp
    known = _j(await _get(K_TEMPO, ""), {})
    want = [d for d in days if d not in known]
    if want:
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
                for d in want[:60]:
                    async with s.get(f"https://www.api-couleur-tempo.fr/api/jourTempo/{d}") as r:
                        if r.status == 200:
                            code = (await r.json(content_type=None)).get("codeJour")
                            if code in (1, 2, 3):
                                known[d] = TEMPO[code - 1]
        except Exception:                              # noqa: BLE001
            logger.warning("[HA] couleur Tempo : api-couleur-tempo.fr injoignable")
        if len(known) > 800:
            known = dict(sorted(known.items())[-800:])
        await _set(K_TEMPO, json.dumps(known))
    return known


def _step(pts):
    def at(t):
        v = None
        for tt, x in pts:
            if tt <= t:
                v = x
            else:
                break
        return v if v is not None else (pts[0][1] if pts else None)
    return at


async def _resolver(t0: datetime, t1: datetime):
    """Une fonction t (UTC) -> (prix EUR/kWh ou None, libelle ou None), pour la fenetre [t0, t1]."""
    e, tz = await elec(), _tz()
    mode = e["mode"]
    if mode == "hour":
        return lambda t: (None, None)
    if mode == "base":
        return lambda t: (e["base"], "Base")
    rng = _ranges(e["hc_ranges"])
    if mode == "hchp":
        return lambda t: ((e["hc"], "HC") if _is_hc(t.astimezone(tz), rng) else (e["hp"], "HP"))
    if mode == "tempo":
        if e["tempo_src"] == "ha" and e["tempo_entity"]:
            col = _step([(t, _color(v)) for t, v in await _history(e["tempo_entity"], t0, t1)])
        else:
            def day(t):
                return (t.astimezone(tz) - timedelta(hours=6)).date().isoformat()
            ds, d = [], t0
            while d <= t1 + timedelta(hours=1):
                ds.append(day(d))
                d += timedelta(hours=6)
            known = await _tempo_api(sorted(set(ds)))
            col = lambda t: known.get(day(t))                      # noqa: E731

        def tempo(t):
            c = col(t) or "bleu"
            h = "hc" if _is_hc(t.astimezone(tz), rng) else "hp"
            return e["tempo"].get(f"{c}_{h}"), f"{c.capitalize()} {h.upper()}"
        return tempo
    # mode « ha » : le prix et le libelle en cours, lus dans leur historique
    if not e["price_entity"]:
        return lambda t: (None, None)
    pst = await _api(f"/states/{e['price_entity']}")
    div = 100.0 if re.search(r"c(t|ts|ents?)?\s*(€|eur)|c€", _unit(pst).lower()) else 1.0
    price = _step([(t, (_f(v) / div) if _f(v) is not None else None) for t, v in await _history(e["price_entity"], t0, t1)])
    label = _step([(t, v if v not in (None, "unknown", "unavailable", "") else None)
                   for t, v in await _history(e["label_entity"], t0, t1)]) if e["label_entity"] else (lambda t: None)
    return lambda t: (price(t), label(t))


# ── La mesure d'une impression ───────────────────────────────────────────────────
def _window(p) -> tuple[datetime, datetime] | None:
    if not p.print_date:
        return None
    t0 = p.print_date.replace(tzinfo=timezone.utc)
    wall = float(p.duration_seconds or p.estimated_seconds or 0) + float(p.paused_seconds or 0)
    return (t0, t0 + timedelta(seconds=wall)) if wall > 0 else None


def price_slots(slots: list) -> tuple[float | None, list]:
    """(cout, par libelle) des tranches mesurees [[debut, kWh, prix, libelle]]."""
    cost, by = 0.0, {}
    priced = False
    for _t, kwh, pr, lab in slots:
        if pr is not None:
            cost += kwh * pr
            priced = True
        if lab:
            by[lab] = by.get(lab, 0.0) + kwh
    return (round(cost, 4) if priced else None), by


async def measure(pid: int, force: bool = False) -> dict:
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .print_tracker import _costs
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            raise HAError("Impression introuvable")
        if p.status in ("IN_PROGRESS", "PAUSED", "RUNNING"):
            raise HAError("Impression en cours : la mesure se fait à la fin")
        if p.energy_kwh is not None and not force:
            return {"kwh": p.energy_kwh, "cost": p.energy_cost, "source": p.energy_source}
        w = _window(p)
    if not w:
        raise HAError("Impression sans début ni durée")
    slots, kw, src = await _measure_window(*w)
    res = await _resolver(w[0], w[1])
    rows = []
    for (a, b), e in zip(slots, kw):
        pr, lab = res(a + (b - a) / 2)
        rows.append([a.strftime("%Y-%m-%dT%H:%M:%SZ"), round(e, 5), pr, lab])
    total = sum(r[1] for r in rows)
    hours = (w[1] - w[0]).total_seconds() / 3600
    cost, _by = price_slots(rows)
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        p.energy_kwh = round(total, 4)
        p.energy_avg_w = round(total * 1000 / hours, 1) if hours > 0 else None
        p.energy_cost = cost
        p.energy_source = src
        p.energy_slots = json.dumps(rows, separators=(",", ":"))
        await _costs(db, p)
        await db.commit()
    logger.info(f"[HA] print #{pid} : {total:.3f} kWh ({src}), {cost if cost is not None else '—'} €")
    return {"kwh": round(total, 4), "cost": cost, "source": src, "avg_w": round(total * 1000 / hours, 1) if hours > 0 else None}


async def measure_later(pid: int, delay: float = 120) -> None:
    """A la fin d'une impression : laisse a Home Assistant le temps d'enregistrer, puis mesure."""
    try:
        if not await configured():
            return
        await asyncio.sleep(delay)
        await measure(pid)
    except HAError as e:
        logger.warning(f"[HA] mesure print #{pid} : {e}")
    except Exception:
        logger.exception(f"[HA] mesure print #{pid}")


async def reprice_all() -> int:
    """Le tarif a change : chaque impression mesuree reprend le prix de ses tranches (les kWh ne bougent pas).
    En mode « ha », les prix viennent de l'historique de Home Assistant : on les relit, s'il les a encore."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .print_tracker import _costs
    n = 0
    async with AsyncSessionLocal() as db:
        ids = (await db.execute(select(Print.id).where(Print.energy_slots.is_not(None)))).scalars().all()
    for pid in ids:
        try:
            async with AsyncSessionLocal() as db:
                p = await db.get(Print, pid)
                rows = _j(p.energy_slots, [])
                if not rows:
                    continue
                t0, t1 = _pt(rows[0][0]), _pt(rows[-1][0]) + timedelta(seconds=SLOT)
                res = await _resolver(t0, t1)
                for r in rows:
                    r[2], r[3] = res(_pt(r[0]) + timedelta(seconds=SLOT / 2))
                p.energy_cost, _ = price_slots(rows)
                p.energy_slots = json.dumps(rows, separators=(",", ":"))
                await _costs(db, p)
                await db.commit()
                n += 1
        except HAError:
            break                                      # Home Assistant injoignable : la suite attendra
        except Exception:
            logger.exception(f"[HA] reprix print #{pid}")
    return n


# ── Le rattrapage, et la boucle ──────────────────────────────────────────────────
_RUN = {"task": None}


async def _backfill(days: int) -> None:
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    st = {"running": True, "days": days, "done": 0, "ok": 0, "total": 0, "error": None, "at": datetime.now().isoformat(timespec="seconds")}
    async with AsyncSessionLocal() as db:
        ids = (await db.execute(select(Print.id).where(
            Print.print_date >= datetime.utcnow() - timedelta(days=days), Print.energy_kwh.is_(None),
            Print.status.in_(["SUCCESS", "FAILED", "PARTIAL", "TO_REDO", "CANCELLED"])).order_by(Print.print_date.desc()))).scalars().all()
    st["total"] = len(ids)
    await _set(K_RUN, json.dumps(st))
    for pid in ids:
        try:
            await measure(pid)
            st["ok"] += 1
        except HAError as e:
            st["error"] = str(e)
            if "injoignable" in str(e) or "jeton" in str(e) or "branché" in str(e):
                break                                  # Home Assistant absent : inutile d'insister sur les suivantes
            async with AsyncSessionLocal() as db:      # rien de garde pour celle-ci : la boucle ne s'y acharnera pas
                p = await db.get(Print, pid)
                if p:
                    p.energy_tries = (p.energy_tries or 0) + 1
                    await db.commit()
        except Exception as e:                         # noqa: BLE001
            st["error"] = type(e).__name__
        st["done"] += 1
        if st["done"] % 5 == 0:
            await _set(K_RUN, json.dumps(st))
    st["running"] = False
    await _set(K_RUN, json.dumps(st))


def start_backfill(days: int) -> dict:
    t = _RUN.get("task")
    if t and not t.done():
        return {"started": False, "running": True}
    _RUN["task"] = asyncio.get_running_loop().create_task(_backfill(max(1, min(int(days or 30), 3650))))
    return {"started": True}


async def loop() -> None:
    """Toutes les 30 min : les impressions finies des 7 derniers jours pas encore mesurees (une mesure manquee au
    moment de la fin : Home Assistant injoignable, appli redemarree)."""
    from sqlalchemy import select
    from ..core import tasks as _tasks
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    await _tasks.sleep("home_assistant", 300)
    while True:
        try:
            if await configured():
                async with AsyncSessionLocal() as db:
                    ids = (await db.execute(select(Print.id).where(
                        Print.print_date >= datetime.utcnow() - timedelta(days=7),
                        Print.print_date <= datetime.utcnow() - timedelta(minutes=10),
                        Print.energy_kwh.is_(None), Print.energy_tries < 6,
                        Print.status.in_(["SUCCESS", "FAILED", "PARTIAL", "TO_REDO", "CANCELLED"])))).scalars().all()
                for pid in ids:
                    try:
                        await measure(pid)
                    except HAError as e:
                        async with AsyncSessionLocal() as db:
                            p = await db.get(Print, pid)
                            p.energy_tries = (p.energy_tries or 0) + 1
                            await db.commit()
                        if "injoignable" in str(e) or "jeton" in str(e):
                            break
        except Exception:
            logger.exception("[HA] boucle")
        await _tasks.sleep("home_assistant", 1800)


# ── La courbe de consommation (Stats › Machine, 12/11/2026) ──────────────────────
async def curve(hours: float = 24) -> dict:
    """La puissance de la prise sur les `hours` dernieres heures, en pas reguliers (environ 300 points), et les bandes
    du tarif (chaque libelle sur sa duree) : {points: [[ms, W]], bands: [{a, b, label}], kwh, cost}."""
    if not await configured():
        return {"configured": False}
    c = await cfg()
    hours = max(0.5, min(float(hours or 24), 24 * 31))
    t1 = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    t0 = t1 - timedelta(hours=hours)
    step = max(60, int(hours * 3600 / 300) // 60 * 60)
    slots, t = [], t0
    while t < t1:
        slots.append((t, min(t + timedelta(seconds=step), t1)))
        t += timedelta(seconds=step)
    eid = c["energy"] if c["meter"] == "energy" else c["power"]
    try:
        st = await _api(f"/states/{eid}")
        u = _unit(st).lower()
        pts = await _history(eid, t0 - timedelta(minutes=20), t1)
        if c["meter"] == "energy":
            kw = _energy_from_counter(pts, _TO_KWH.get(u, 1.0), slots)
        else:
            kw = _energy_from_power(pts, _TO_W.get(u, 1.0), slots)
        res = await _resolver(t0, t1)
    except HAError as e:
        return {"configured": True, "error": str(e)}
    kw = kw or [0.0] * len(slots)
    points, bands, cost, priced = [], [], 0.0, False
    for (a, b), e in zip(slots, kw):
        h = (b - a).total_seconds() / 3600
        points.append([int(a.timestamp() * 1000), round(e * 1000 / h, 1) if h > 0 else 0])
        pr, lab = res(a + (b - a) / 2)
        if pr is not None:
            cost += e * pr
            priced = True
        ms_a, ms_b = int(a.timestamp() * 1000), int(b.timestamp() * 1000)
        if bands and bands[-1]["label"] == lab and bands[-1]["b"] == ms_a:
            bands[-1]["b"] = ms_b
        else:
            bands.append({"a": ms_a, "b": ms_b, "label": lab})
    return {"configured": True, "step": step, "points": points, "bands": [x for x in bands if x["label"]],
            "kwh": round(sum(kw), 3), "cost": round(cost, 2) if priced else None}


# ── Les chiffres (page Stats) ────────────────────────────────────────────────────
async def stats(days: int = 0, date_from: str | None = None, date_to: str | None = None) -> dict:
    """La periode : date_from / date_to (AAAA-MM-JJ, fin incluse), sinon les `days` derniers jours, sinon tout."""
    def _d(s):
        try:
            return datetime.strptime(str(s)[:10], "%Y-%m-%d")
        except (TypeError, ValueError):
            return None
    d0, d1 = _d(date_from), _d(date_to)
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    async with AsyncSessionLocal() as db:
        q = select(Print.energy_kwh, Print.energy_cost, Print.energy_slots, Print.duration_seconds, Print.paused_seconds,
                   Print.print_date).where(Print.energy_kwh.is_not(None))
        if d0:
            q = q.where(Print.print_date >= d0)
        if d1:
            q = q.where(Print.print_date < d1 + timedelta(days=1))
        if days and not (d0 or d1):
            q = q.where(Print.print_date >= datetime.utcnow() - timedelta(days=days))
        rows = (await db.execute(q)).all()
    kwh = sum(r[0] or 0 for r in rows)
    cost = sum(r[1] or 0 for r in rows if r[1] is not None)
    hours = sum(((r[3] or 0) + (r[4] or 0)) / 3600 for r in rows)
    by, monthly = {}, {}
    for r in rows:
        _c, b = price_slots(_j(r[2], []))
        for k, v in b.items():
            by[k] = by.get(k, 0.0) + v
        m = r[5].strftime("%Y-%m") if r[5] else "?"
        x = monthly.setdefault(m, {"kwh": 0.0, "cost": 0.0, "n": 0})
        x["kwh"] += r[0] or 0
        x["cost"] += r[1] or 0
        x["n"] += 1
    lab = sum(by.values())
    return {"days": days, "prints": len(rows), "kwh": round(kwh, 3), "cost": round(cost, 2),
            "avg_w": round(kwh * 1000 / hours, 1) if hours else None,
            "per_kwh": round(cost / kwh, 4) if kwh and cost else None,
            "labels": sorted(({"label": k, "kwh": round(v, 3), "pct": round(v / lab * 100, 1) if lab else 0} for k, v in by.items()),
                             key=lambda x: -x["kwh"]),
            "monthly": {k: {"kwh": round(v["kwh"], 3), "cost": round(v["cost"], 2), "n": v["n"]} for k, v in sorted(monthly.items())}}
