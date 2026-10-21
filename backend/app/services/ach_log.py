"""
Petit journal pour les succes (21/10/2026) : ce qu'aucune table ne garde.

  - sechages de l'AMS : un cycle par transition « pas sechage -> sechage »,
    avec sa duree reglee ;
  - visites entre copains : pages vues chez moi par un copain (cle fk_), et
    pages que je vois chez eux (relais /friends/{id}/p/...) ;
  - MakerWorld : mes evaluations publiees, mes gains de points jour par jour,
    les modeles passes par « A faire » et ceux dont j'ai retenu un plan.

Les ecouteurs (MQTT, middleware, relais) ne font que noter en memoire ; la
boucle des succes verse tout dans le reglage ACHIEVEMENTS_LOG (drain). Les
comptes ne reculent jamais : ce qui a ete vu une fois reste.
"""
import json
import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

KEY = "ACHIEVEMENTS_LOG"
MAX_DRY = 5000
_PENDING: list = []          # (type, iso, donnees)
_LOCK = threading.Lock()
_LAST_OUT: dict = {}         # copain -> (page, horodatage) : une visite par changement de page
PAGE_REPEAT_S = 30 * 60
MW_EVERY_S = 3600            # MakerWorld relu au plus une fois par heure
_MW_AT = [0.0]


def _tz():
    try:
        import os
        from zoneinfo import ZoneInfo
        return ZoneInfo(os.getenv("TZ") or "Europe/Paris")
    except Exception:
        return timezone.utc


def _day(dt: datetime) -> str:
    """Jour local d'une date UTC naive."""
    return dt.replace(tzinfo=timezone.utc).astimezone(_tz()).date().isoformat()


def dry(ams_id, hours: float, when: datetime | None = None) -> None:
    """Un AMS se met a secher (appele par l'ecouteur : aucune base)."""
    with _LOCK:
        _PENDING.append(("dry", (when or datetime.utcnow()).isoformat(),
                         {"ams": int(ams_id), "h": round(max(0.0, float(hours or 0)), 2)}))


def visit_in(when: datetime | None = None) -> None:
    """Un copain arrive sur une page de chez moi (le middleware a deja filtre)."""
    with _LOCK:
        _PENDING.append(("in", (when or datetime.utcnow()).isoformat(), None))


def visit_out(fid: str, page: str | None) -> None:
    """Je regarde une page chez un copain : comptee au changement de page."""
    if not page:
        return
    now = time.time()
    prev = _LAST_OUT.get(fid)
    if prev and prev[0] == page and now - prev[1] < PAGE_REPEAT_S:
        return
    _LAST_OUT[fid] = (page, now)
    with _LOCK:
        _PENDING.append(("out", datetime.utcnow().isoformat(), None))


async def _get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def _put(d: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(d, ensure_ascii=False))


def _add_dry(mem: dict, at: str, ams: int, h: float) -> None:
    """Un cycle deja note pour cet AMS et pas encore fini : c'est le meme
    (redemarrage de l'appli en plein sechage)."""
    t = datetime.fromisoformat(at)
    for x in mem["dry"]:
        if x.get("ams") == ams:
            t0 = datetime.fromisoformat(x["at"])
            if t0 <= t <= t0 + timedelta(hours=max(x.get("h") or 0, 0.5)):
                return
    mem["dry"].append({"at": at, "ams": ams, "h": h})


async def drain(spools=None) -> dict:
    """Verse ce qui attend en memoire et rend tout le journal.
    `spools` : (id, last_dried_at) des bobines, pour amorcer les sechages une
    fois (les bobines d'un meme cycle portent la meme date, a la seconde)."""
    with _LOCK:
        new = list(_PENDING)
        _PENDING.clear()
    mem = await _get()
    before = json.dumps(mem, sort_keys=True)
    mem.setdefault("dry", [])
    if not mem.get("dry_seeded") and spools is not None:
        cycles = sorted({dt.replace(microsecond=0) for _sid, dt in spools if dt})
        for dt in cycles:
            mem["dry"].append({"at": dt.isoformat(), "ams": -1, "h": 0})
        mem["dry_seeded"] = True
    for kind, at, data in new:
        if kind == "dry":
            _add_dry(mem, at, data["ams"], data["h"])
        elif kind in ("in", "out"):
            t = datetime.fromisoformat(at)
            days = mem.setdefault("visit_" + kind, {})
            day = _day(t)
            days[day] = days.get(day, 0) + 1
            hour = t.replace(tzinfo=timezone.utc).astimezone(_tz()).hour
            if kind == "out" and hour < 5 and not mem.get("night_out"):
                mem["night_out"] = at
    mem["dry"] = sorted(mem["dry"], key=lambda x: x["at"])[-MAX_DRY:]
    if json.dumps(mem, sort_keys=True) != before:
        await _put(mem)
    return mem


# ── MakerWorld : evaluations, points, « A faire » ───────────────────────────
def _when(v) -> str | None:
    """Date MakerWorld (ISO ou millisecondes) en UTC naive ISO."""
    if v in (None, ""):
        return None
    try:
        if isinstance(v, (int, float)) or str(v).isdigit():
            x = float(v)
            return datetime.utcfromtimestamp(x / 1000 if x > 1e11 else x).isoformat()
        t = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        if t.tzinfo:
            t = t.astimezone(timezone.utc).replace(tzinfo=None)
        return t.isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _template_rx(templates) -> list:
    """Chaque message type devient un motif : ses {champs} acceptent n'importe quoi."""
    out = []
    for t in templates:
        parts = re.split(r"\{[^}]*\}", _norm(t))
        if sum(len(p) for p in parts) >= 20:
            out.append(re.compile("^" + ".+?".join(re.escape(p) for p in parts) + "$", re.S))
    return out


async def _templates() -> list:
    try:
        from .mw_rate import DEFAULT_TEMPLATES, K_TEMPLATES
        from ..db.session import AsyncSessionLocal
        from .settings_service import get_setting
        async with AsyncSessionLocal() as db:
            raw = await get_setting(db, K_TEMPLATES, "")
        groups = json.loads(raw) if raw else DEFAULT_TEMPLATES
        return [m for g in groups if isinstance(g, dict) for m in (g.get("messages") or []) if isinstance(m, str)]
    except Exception:
        return []


async def refresh_mw(mem: dict, force: bool = False) -> dict:
    """Relit chez MakerWorld (au plus une fois par heure) et garde en memoire."""
    if not force and time.time() - _MW_AT[0] < MW_EVERY_S:
        return mem
    _MW_AT[0] = time.time()
    before = json.dumps(mem, sort_keys=True)
    try:
        from .makerworld_account import token
        has_token = bool(await token())
    except Exception:
        has_token = False
    if has_token:
        # evaluations publiees
        try:
            from .mw_rate import rating_details
            rx = _template_rx(await _templates())
            rat = mem.setdefault("ratings", {})
            for h in await rating_details() or []:
                rid = str(h.get("id") or "")
                if not rid:
                    continue
                content = _norm(h.get("content") or "")
                rat[rid] = {"at": _when(h.get("at")) or rat.get(rid, {}).get("at") or datetime.utcnow().isoformat(),
                            "s": h.get("score") or 0, "len": len((h.get("content") or "").strip()),
                            "img": h.get("images") or 0, "tpl": bool(content) and any(r.match(content) for r in rx)}
        except Exception as e:
            logger.info(f"[SUCCES] evaluations MakerWorld illisibles : {e}")
        # points gagnes, jour par jour (tout l'historique la premiere fois)
        try:
            from .mw_creator import points, recent_points
            full = not mem.get("points_full")
            rows = await recent_points(3650, 80) if full else await recent_points(30, 10)
            per = {}
            for x in rows:
                at, pts = _when(x.get("time")), float(x.get("points") or 0)
                if at and pts > 0:
                    day = _day(datetime.fromisoformat(at))
                    per[day] = round(per.get(day, 0) + pts, 2)
            pd = mem.setdefault("points", {})
            for day, v in per.items():
                if v > pd.get(day, 0):
                    pd[day] = v
            mem["points_full"] = True
            inc = float((await points(0, 1)).get("income") or 0)
            if inc > (mem.get("income") or 0):
                mem["income"] = inc
        except Exception as e:
            logger.info(f"[SUCCES] points MakerWorld illisibles : {e}")
    # « A faire » : modeles vus dans la file, plans retenus (date de la premiere fois)
    try:
        from .mw_queue import _load, _snap_get
        now = datetime.utcnow().isoformat()
        seen = mem.setdefault("queue_seen", {})
        for m in (_snap_get() or {}).get("models") or []:
            did = str(m.get("design_id") or "")
            if did:
                seen.setdefault(did, now)
        planned = mem.setdefault("planned", {})
        for did, pl in ((await _load()).get("plans") or {}).items():
            if isinstance(pl, dict) and pl.get("instance_id"):
                planned.setdefault(str(did), now)
    except Exception as e:
        logger.info(f"[SUCCES] file « A faire » illisible : {e}")
    if json.dumps(mem, sort_keys=True) != before:
        await _put(mem)
    return mem
