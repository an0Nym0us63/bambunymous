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
TARGETS = ("nozzle_t", "nozzle2_t", "bed_t", "chamber_t")   # les consignes (None : pas de consigne)
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
    nz = sorted(s.nozzles or [], key=lambda n: (not n.active, n.id))
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
            "bed_t": tgt(s.target_bed_temp), "chamber_t": tgt(s.target_chamber_temp),
            "ams": ams}


async def record(snap: dict, now: datetime | None = None) -> None:
    from ..db.session import AsyncSessionLocal
    from ..models.sensor import SensorSample
    async with AsyncSessionLocal() as db:
        db.add(SensorSample(ts=now or datetime.utcnow(), printing=snap["printing"], nozzle=snap["nozzle"],
                            nozzle2=snap["nozzle2"], bed=snap["bed"], chamber=snap["chamber"],
                            **{k: snap.get(k) for k in TARGETS},
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
    """La boucle de fond (lancee au demarrage)."""
    from ..core import tasks as _tasks
    from ..core.mqtt import get_state
    await load()
    purged = 0.0
    while True:
        wait = EVERY_IDLE
        try:
            s = get_state()
            snap = snapshot(s)
            if snap:
                await record(snap)
                if snap["printing"]:
                    wait = EVERY_PRINTING
            import time
            if time.time() - purged > 3600:
                purged = time.time()
                n = await purge()
                if n:
                    logger.debug(f"[CAPTEURS] {n} releve(s) de plus de {KEEP_DAYS} jours effaces")
        except Exception:
            _tasks.error("sensors")
            logger.exception("[CAPTEURS] releve")
        await _tasks.sleep("sensors", wait)


async def history(hours: float = 24) -> dict:
    """Les releves des dernieres heures, du plus ancien au plus recent : {points: [{t, printing, nozzle, nozzle2, bed,
    chamber, ams: {id: [h, t]}}], every}. Au-dela de MAX_POINTS, moyennes par paquets consecutifs (un trou de plus de
    15 minutes coupe un paquet : la courbe garde ses trous)."""
    from ..db.session import AsyncSessionLocal
    from ..models.sensor import SensorSample
    hours = max(1.0, min(float(hours or 24), KEEP_DAYS * 24.0))
    since = datetime.utcnow() - timedelta(hours=hours)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(SensorSample).where(SensorSample.ts >= since).order_by(SensorSample.ts))).scalars().all()
    pts = [{"t": r.ts.isoformat() + "Z", "printing": bool(r.printing), "nozzle": r.nozzle, "nozzle2": r.nozzle2,
            "bed": r.bed, "chamber": r.chamber, **{k: getattr(r, k) for k in TARGETS},
            "ams": json.loads(r.ams) if r.ams else {}} for r in rows]
    if len(pts) <= MAX_POINTS:
        return {"points": pts, "hours": hours}
    step = -(-len(pts) // MAX_POINTS)
    out, i = [], 0
    while i < len(pts):
        chunk = [pts[i]]
        j = i + 1
        while j < len(pts) and len(chunk) < step and _gap(pts[j - 1]["t"], pts[j]["t"]) <= 900:
            chunk.append(pts[j])
            j += 1
        out.append(_mean(chunk))
        i = j
    return {"points": out, "hours": hours}


def _gap(a: str, b: str) -> float:
    return (datetime.fromisoformat(b.rstrip("Z")) - datetime.fromisoformat(a.rstrip("Z"))).total_seconds()


def _mean(chunk: list) -> dict:
    def avg(vals):
        v = [x for x in vals if x is not None]
        return round(sum(v) / len(v), 1) if v else None
    ids = {k for p in chunk for k in p["ams"]}
    return {"t": chunk[len(chunk) // 2]["t"], "printing": any(p["printing"] for p in chunk),
            **{k: avg(p.get(k) for p in chunk) for k in ("nozzle", "nozzle2", "bed", "chamber", *TARGETS)},
            "ams": {k: [avg(p["ams"].get(k, [None, None])[0] for p in chunk), avg(p["ams"].get(k, [None, None])[1] for p in chunk)]
                    for k in ids}}
