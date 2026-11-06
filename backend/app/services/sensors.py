"""Releves des capteurs de l'imprimante (03/11/2026) : ce qui n'etait lu qu'en direct (humidite et temperature des AMS,
buses, plateau, chambre) garde 7 jours, pour les sparklines des tuiles et la page Machine des Stats.

Un releve toutes les 5 minutes, chaque minute pendant une impression (la chauffe et le refroidissement vont vite) ;
rien quand l'imprimante est injoignable (un trou dans la courbe, pas un faux zero). Au-dela de 7 jours, efface.

Le decalage d'humidite par AMS (un capteur qui lit trop haut ou trop bas) vit ici aussi : la lecture MQTT l'applique
a la source, donc tout le monde voit la valeur corrigee (tuiles, alertes, sechage, succes, releves)."""
import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, select

logger = logging.getLogger(__name__)

KEEP_DAYS = 7
EVERY_IDLE = 300.0
EVERY_PRINTING = 60.0
MAX_POINTS = 600                        # un historique rendu en plus de points est moyenne par paquets
TARGETS = ("nozzle_t", "nozzle2_t", "bed_t", "chamber_t", "nozzle_act")   # les consignes (None : pas de consigne)
# les ventilateurs : la cle du statut brut (vitesse de 0 a 15, comme « Plus d'infos »), rendue en %
FANS = {"fan_part": "cooling_fan_speed", "fan_aux": "big_fan1_speed", "fan_chamber": "big_fan2_speed", "fan_head": "heatbreak_fan_speed"}
# (03/11/2026) les H2 declarent leurs ventilateurs dans device.airduct.parts : id >> 4 = leur rang dans Bambu Studio
# (AIR_FUN : 0 dissipateur, 1 piece, 2 auxiliaire, 3 chambre, 4 dissipateur de la 2e buse, 5 carte de commande,
# 6 circulation interieure), state = leur vitesse en %. Ils priment sur les anciens champs
AIRDUCT = {1: "part", 2: "aux", 3: "chamber", 4: "head2", 5: "board", 6: "loop"}
FAN_KEYS = ("part", "aux", "chamber", "head", "head2", "board", "loop")
EXTRA = (*TARGETS, *(f"fan_{k}" for k in FAN_KEYS))
K_OFFSETS = "AMS_HUMIDITY_OFFSETS"      # JSON {ams_id: decalage en points de %}

_OFFSETS: dict[int, float] = {}


# ── Decalage d'humidite ──────────────────────────────────────────────────────────────────────────────────────────────
def humidity(ams_id: int, raw: int) -> int:
    """L'humidite d'un AMS, decalage applique (0 reste 0 : l'AMS ne dit rien)."""
    if not raw:
        return raw
    d = _OFFSETS.get(int(ams_id))
    return max(1, min(100, int(round(raw + d)))) if d else raw


def offsets() -> dict:
    return {str(k): v for k, v in _OFFSETS.items()}


async def load() -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    try:
        async with AsyncSessionLocal() as db:
            raw = await get_setting(db, K_OFFSETS, "")
        v = json.loads(raw) if isinstance(raw, str) and raw else (raw if isinstance(raw, dict) else {})
        _OFFSETS.clear()
        _OFFSETS.update({int(k): float(x) for k, x in v.items() if x})
    except Exception as e:
        logger.warning(f"[CAPTEURS] decalages illisibles : {e}")


async def set_offsets(v: dict) -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    clean = {}
    for k, x in (v or {}).items():
        d = round(max(-50.0, min(50.0, float(x or 0))), 1)
        if d:
            clean[str(int(k))] = d
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_OFFSETS, json.dumps(clean))
    _OFFSETS.clear()
    _OFFSETS.update({int(k): x for k, x in clean.items()})
    logger.info(f"[CAPTEURS] decalage d'humidite : {clean or 'aucun'}")
    return offsets()


# ── Releves ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def _printing(s) -> bool:
    return str(getattr(s, "status", "") or "").upper() in ("RUNNING", "PREPARE", "PAUSE", "SLICING")


def snapshot(s) -> dict | None:
    """Le releve de l'etat courant (None : imprimante injoignable)."""
    if not getattr(s, "connected", False):
        return None
    from ..core.mqtt import EXT_AMS_ID
    # (03/11/2026) chaque buse a sa place : nozzle = la droite (id 0, ou la seule), nozzle2 = la gauche (id 1) ; laquelle
    # imprime, a part (avant : la buse active, puis l'autre -- les courbes sautaient d'une buse a l'autre)
    nz = sorted(s.nozzles or [], key=lambda n: n.id)
    act = next((n.id for n in nz if n.active), None) if len(nz) > 1 else None
    ams = {str(a.id): [a.humidity, round(a.temp, 1)] for a in (s.ams_list or [])
           if a.id not in (EXT_AMS_ID, 254) and (a.humidity or a.temp)}
    tgt = lambda v: round(v, 1) if v and v > 0 else None
    return {"printing": _printing(s),
            "nozzle": round(nz[0].temp, 1) if nz else None,
            "nozzle2": round(nz[1].temp, 1) if len(nz) > 1 else None,
            "bed": round(s.bed_temp, 1) if s.bed_temp is not None else None,
            "chamber": round(s.chamber_temp, 1) if s.chamber_temp else None,
            "nozzle_t": tgt(nz[0].target) if nz else None,
            "nozzle2_t": tgt(nz[1].target) if len(nz) > 1 else None,
            "nozzle_act": act,
            "bed_t": tgt(s.target_bed_temp), "chamber_t": tgt(s.target_chamber_temp),
            **{f"fan_{k}": v for k, v in ((k, fans_of(s).get(k)) for k in FAN_KEYS)},
            "ams": ams}


def fans_of(s) -> dict:
    """Les ventilateurs de l'etat courant, en % : {"part", "aux", "chamber", "head"} (absents : la machine ne les dit pas)."""
    raw = getattr(s, "raw", None) or {}
    out = {k[4:]: _fan(raw.get(src)) for k, src in FANS.items()}
    air = (raw.get("device") or {}).get("airduct") or {}
    for part in (air.get("parts") or []) if isinstance(air, dict) else []:
        try:
            k = AIRDUCT.get(int(part.get("id")) >> 4)
            if k and part.get("state") is not None:
                out[k] = max(0, min(100, int(round(float(part["state"])))))
        except (TypeError, ValueError, AttributeError):
            continue
    return {k: v for k, v in out.items() if v is not None}


def _fan(v):
    try:
        return round(max(0, min(15, int(v))) / 15 * 100)
    except (TypeError, ValueError):
        return None


async def record(snap: dict, now: datetime | None = None) -> None:
    from ..db.session import AsyncSessionLocal
    from ..models.sensor import SensorSample
    async with AsyncSessionLocal() as db:
        db.add(SensorSample(ts=now or datetime.utcnow(), printing=snap["printing"], nozzle=snap["nozzle"],
                            nozzle2=snap["nozzle2"], bed=snap["bed"], chamber=snap["chamber"],
                            **{k: snap.get(k) for k in EXTRA},
                            ams=json.dumps(snap["ams"]) if snap["ams"] else None))
        await db.commit()


async def purge(now: datetime | None = None) -> int:
    from ..db.session import AsyncSessionLocal
    from ..models.sensor import SensorSample
    async with AsyncSessionLocal() as db:
        r = await db.execute(delete(SensorSample).where(SensorSample.ts < (now or datetime.utcnow()) - timedelta(days=KEEP_DAYS)))
        await db.commit()
    return r.rowcount or 0


async def loop() -> None:
    """La boucle de fond (lancee au demarrage) : toutes les 30 s, les evenements en attente ecrits ; un releve quand
    son heure est venue (5 min, 1 min en impression) ; la purge chaque heure."""
    import time
    from ..core import tasks as _tasks
    from ..core.mqtt import get_state
    from . import machine_events as EV
    await load()
    purged = last = 0.0
    while True:
        try:
            await EV.flush()
            s = get_state()
            due = EVERY_PRINTING if _printing(s) else EVERY_IDLE
            if time.time() - last >= due - 1:
                snap = snapshot(s)
                if snap:
                    await record(snap)
                    last = time.time()
            if time.time() - purged > 3600:
                purged = time.time()
                n = await purge()
                await EV.purge(KEEP_DAYS)
                if n:
                    logger.debug(f"[CAPTEURS] {n} releve(s) de plus de {KEEP_DAYS} jours effaces")
        except Exception:
            _tasks.error("sensors")
            logger.exception("[CAPTEURS] releve")
        await _tasks.sleep("sensors", 30)


async def history(hours: float = 24, end: datetime | None = None) -> dict:
    """Les releves des dernieres heures (jusqu'a end, maintenant par defaut : pour remonter le temps), du plus ancien au
    plus recent : {points: [{t, printing, nozzle, nozzle2, bed,
    chamber, ams: {id: [h, t]}}], every}. Au-dela de MAX_POINTS, moyennes par paquets consecutifs (un trou de plus de
    15 minutes coupe un paquet : la courbe garde ses trous)."""
    import time as _time
    hours = max(1.0, min(float(hours or 24), KEEP_DAYS * 24.0))
    # (06/11/2026) la meme fenetre « jusqu'a maintenant » redemandee par plusieurs courbes et tuiles a la fois : rendue
    # telle quelle pendant 20 s (0,5 s de calcul a chaque fois sur 3 jours)
    key = (round(hours, 3), end.isoformat() if end else None)
    hit = _HIST.get(key)
    if hit and _time.monotonic() - hit[0] < 20:
        return hit[1]
    out = await _history(hours, end)
    if len(_HIST) > 40:
        _HIST.clear()
    _HIST[key] = (_time.monotonic(), out)
    return out


_HIST: dict = {}


async def _history(hours: float, end: datetime | None) -> dict:
    from ..db.session import AsyncSessionLocal
    from ..models.sensor import SensorSample
    now = datetime.utcnow()
    end = min(end, now) if end else now
    since = end - timedelta(hours=hours)
    # les colonnes seulement (06/11/2026 : des objets complets pour 3 jours de releves coutaient)
    cols = [SensorSample.ts, SensorSample.printing, SensorSample.nozzle, SensorSample.nozzle2, SensorSample.bed, SensorSample.chamber,
            SensorSample.ams, *(getattr(SensorSample, k) for k in EXTRA)]
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(*cols).where(SensorSample.ts >= since, SensorSample.ts <= end)
                                 .order_by(SensorSample.ts))).all()
    from .machine_events import between
    events = await between(since, end)
    ts = [r[0] for r in rows]
    pts = [{"t": r[0].isoformat() + "Z", "printing": bool(r[1]), "nozzle": r[2], "nozzle2": r[3], "bed": r[4], "chamber": r[5],
            **dict(zip(EXTRA, r[7:])), "ams": json.loads(r[6]) if r[6] else {}} for r in rows]
    # les vrais trous (06/11/2026) : un point qui suit plus de 15 minutes sans releve (imprimante injoignable) porte
    # gap ; la courbe ne coupe que la. Elle coupait aussi la ou les moyennes espacaient les points au repos (la nuit,
    # entre deux impressions), et la ligne disparaissait alors que les valeurs etaient la
    big = [False] + [(ts[i] - ts[i - 1]).total_seconds() > 900 for i in range(1, len(ts))]
    for p, g in zip(pts, big):
        p["gap"] = g
    if len(pts) <= MAX_POINTS:
        return {"points": pts, "events": events, "hours": hours, "end": end.isoformat() + "Z"}
    step = -(-len(pts) // MAX_POINTS)
    out, i = [], 0
    while i < len(pts):
        chunk = [pts[i]]
        j = i + 1
        while j < len(pts) and len(chunk) < step and not big[j]:
            chunk.append(pts[j])
            j += 1
        m = _mean(chunk)
        m["gap"] = bool(chunk[0].get("gap"))
        out.append(m)
        i = j
    return {"points": out, "events": events, "hours": hours, "end": end.isoformat() + "Z"}


def _gap(a: str, b: str) -> float:
    return (datetime.fromisoformat(b.rstrip("Z")) - datetime.fromisoformat(a.rstrip("Z"))).total_seconds()


def _mean(chunk: list) -> dict:
    def avg(vals):
        v = [x for x in vals if x is not None]
        return round(sum(v) / len(v), 1) if v else None
    ids = {k for p in chunk for k in p["ams"]}
    return {"t": chunk[len(chunk) // 2]["t"], "printing": any(p["printing"] for p in chunk),
            **{k: avg(p.get(k) for p in chunk) for k in ("nozzle", "nozzle2", "bed", "chamber", *EXTRA)},
            "ams": {k: [avg(p["ams"].get(k, [None, None])[0] for p in chunk), avg(p["ams"].get(k, [None, None])[1] for p in chunk)]
                    for k in ids}}
