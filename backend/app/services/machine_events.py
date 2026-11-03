"""Les evenements de la machine (03/11/2026) : la chronologie de Stats › Machine, gardee 7 jours comme les releves.

Lancement, pause, reprise, fin ou echec d'une impression ; changement de filament (bac actif), de buse active,
d'aiguillage (Track Switch), de buse sur la tete (rack Vortek) ; porte ; alertes de la machine ; sechage des AMS ;
connexion perdue ou retrouvee.

L'ecouteur (watch) tourne a chaque message MQTT, dans le fil MQTT : il ne fait que comparer l'etat a celui d'avant et
poser les changements dans une file en memoire. La boucle des capteurs (sensors.loop) les ecrit en base (flush), toutes
les 30 secondes, et l'historique y ajoute ceux qui attendent encore."""
import json
import logging
import threading
import time
from collections import deque
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_PENDING: deque = deque(maxlen=500)
_LAST: dict = {}
# (03/11/2026) au demarrage ou a la reconnexion, l'etat se remplit message apres message : ce ne sont pas des
# changements (« impression lancee » a 12 h 29 pour une impression commencee a 11 h 33). Rien n'est raconte pendant
# WARM secondes, l'etat garde suit seulement
WARM = 45.0
_WARM = {"until": 0.0}
# un changement de filament ne compte que s'il tient STEADY secondes en impression (en fin d'impression, l'imprimante
# passe un instant sur la bobine externe : ce n'est pas un changement)
STEADY = 20.0
_TRAY = {"cand": None, "since": 0.0, "from": None}

LIVE = ("RUNNING", "PREPARE", "SLICING")


def _slot(ams_id, tray_id) -> str:
    if ams_id is None or ams_id < 0:
        return ""
    if ams_id in (254, 255):
        return "bobine externe"
    if ams_id >= 128:
        return f"HT-{chr(65 + ams_id - 128)}"
    return f"AMS-{chr(65 + ams_id)} {tray_id + 1}"


def _tray(st, ams_id, tray_id):
    a = next((x for x in (st.ams_list or []) if x.id == ams_id), None)
    return next((t for t in (a.trays if a else []) if t.id == tray_id), None)


def _push(kind: str, title: str, detail: str = "", at: datetime | None = None, **extra) -> None:
    with _LOCK:
        _PENDING.append({"t": at or datetime.utcnow(), "kind": kind, "title": title, "detail": detail, **extra})


def started() -> None:
    """BambuNymous vient de demarrer (03/11/2026) : la chronologie le dit (une mise a jour, un redemarrage du serveur)."""
    _push("app_start", "BambuNymous démarré")


def watch(st) -> None:
    try:
        _watch(st)
    except Exception:
        logger.exception("[EVENEMENTS] ecouteur MQTT")


def _rack_sig(st):
    r = getattr(st, "hotend_rack", None)
    return getattr(r, "head_id", -1) if r and (r.hotends or []) else None


def _switch_sig(fs):
    if not fs or not fs.get("installed"):
        return None
    k = lambda s: (s or {}).get("ams", -1) * 256 + (s or {}).get("tray", -1) if s else -1
    return (k(fs.get("in_a")), k(fs.get("in_b")), fs.get("out_a"), fs.get("out_b"))


def _watch(st) -> None:
    status = (st.status or "").upper()
    nz = st.nozzles or []
    act_nz = next((n.id for n in nz if n.active), None) if len(nz) > 1 else None
    tray = (st.active_ams_id, st.active_tray_id) if st.active_ams_id is not None and st.active_ams_id >= 0 and st.active_tray_id is not None and st.active_tray_id >= 0 else None
    cur = {
        "conn": bool(st.connected), "status": status, "job": st.print_name or "", "tray": tray, "nozzle": act_nz,
        "switch": _switch_sig(st.fila_switch), "rack": _rack_sig(st), "door": st.door_open,
        "hms": {f"{e.get('attr')}-{e.get('code')}" for e in (st.hms_errors or [])},
        "dry": {a.id for a in (st.ams_list or []) if (a.dry_time or 0) > 0},
    }
    prev = _LAST.copy()
    _LAST.update(cur)
    now = time.time()
    if not prev:
        _WARM["until"] = now + WARM              # le premier etat : la reference, rien a raconter
        return
    if cur["conn"] != prev["conn"]:
        _push("online" if cur["conn"] else "offline", "Imprimante joignable" if cur["conn"] else "Imprimante injoignable")
        if cur["conn"]:
            _WARM["until"] = now + WARM
    if not cur["conn"]:
        return                                   # sans connexion, l'etat garde est perime
    if now < _WARM["until"] or not status:
        _TRAY["cand"] = None
        return
    # l'impression
    s0, s1, name = prev["status"], status, st.print_name or ""
    if s1 != s0:
        if s1 == "PREPARE" and s0 not in LIVE:
            _push("prepare", "Préparation", name)
        elif s1 == "RUNNING" and s0 in ("PAUSE", "PAUSED"):
            _push("resume", "Reprise", name)
        elif s1 == "RUNNING" and s0 != "SLICING":
            _push("print_start", "Impression lancée", name)
        elif s1 in ("PAUSE", "PAUSED"):
            _push("pause", "Pause", name)
        elif s1 == "FINISH" and s0 in LIVE + ("PAUSE", "PAUSED"):
            _push("finish", "Impression terminée", name)
        elif s1 == "FAILED" and s0 in LIVE + ("PAUSE", "PAUSED"):
            _push("fail", "Impression en échec", name)
    # le filament (le bac qui alimente) et la buse active : en impression seulement (au repos, l'imprimante remet ses
    # reperes a zero a la fin, ce n'est pas un changement)
    busy = status in LIVE + ("PAUSE", "PAUSED")
    # le filament : un nouveau bac devient candidat, raconte s'il tient STEADY secondes en impression (date de son
    # arrivee) ; la fin de l'impression avant, ou un retour au bac d'avant : rien
    if not busy:
        _TRAY["cand"] = None
    elif cur["tray"] != prev["tray"] and cur["tray"]:
        if _TRAY["cand"] is None:
            _TRAY["from"] = prev["tray"]
        _TRAY.update(cand=cur["tray"], since=now)
    if busy and _TRAY["cand"] is not None and now - _TRAY["since"] >= STEADY:
        c, before = _TRAY["cand"], _TRAY["from"]
        _TRAY["cand"] = None
        if c == cur["tray"] and c != before:
            t = _tray(st, *c)
            info = getattr(t, "_spool_info_cache", None) or {}
            what = info.get("translated_name") or info.get("name") or (t.filament_type if t else "") or ""
            _push("filament", "Filament " + _slot(*c), what, color=(t.color if t else "") or "",
                  before=_slot(*before) if before else "", spool_id=getattr(t, "spool_id", None) if t else None,
                  at=datetime.utcfromtimestamp(_TRAY["since"]))
    if busy and cur["nozzle"] != prev["nozzle"] and cur["nozzle"] is not None and prev["nozzle"] is not None:
        _push("nozzle", "Buse " + ("gauche" if cur["nozzle"] == 1 else "droite"), "devient la buse active")
    # l'aiguillage : un changement de ce qui y entre (vide des deux cotes, en fin d'impression : rien)
    if cur["switch"] != prev["switch"] and cur["switch"] is not None and prev["switch"] is not None and cur["switch"][:2] != (-1, -1):
        fs = st.fila_switch or {}
        side = lambda s: _slot((s or {}).get("ams", -1), (s or {}).get("tray", 0)) or "rien"
        _push("switch", "Aiguillage", f"A : {side(fs.get('in_a'))} · B : {side(fs.get('in_b'))}")
    if cur["rack"] != prev["rack"] and cur["rack"] is not None and prev["rack"] is not None:
        r = st.hotend_rack
        h = next((x for x in r.hotends if x.id == cur["rack"]), None)
        _push("rack", "Buse changée sur la tête" if cur["rack"] >= 0 else "Buse rangée dans le rack",
              (f"{h.diameter} mm {h.nozzle_type}".strip() if h else ""), color=(h.color if h else "") or "")
    if cur["door"] != prev["door"] and cur["door"] is not None and prev["door"] is not None:
        _push("door", "Porte ouverte" if cur["door"] else "Porte fermée")
    new = cur["hms"] - prev["hms"]
    if new:
        _push("hms", "Alerte de la machine", "", hms=[e for e in (st.hms_errors or []) if f"{e.get('attr')}-{e.get('code')}" in new],
              model=getattr(st, "printer_model", "") or "")
    for a in cur["dry"] - prev["dry"]:
        _push("dry_start", f"Séchage {_slot(a, 0).rsplit(' ', 1)[0] if a < 128 else _slot(a, 0)}")
    for a in prev["dry"] - cur["dry"]:
        _push("dry_end", f"Séchage fini {_slot(a, 0).rsplit(' ', 1)[0] if a < 128 else _slot(a, 0)}")


def _title_hms(e: dict) -> str:
    try:
        from .hms import decode_hms
        d = decode_hms(e.pop("hms", []), e.pop("model", ""), schedule_fetch=False)
        return " · ".join(x.get("label") or x.get("code") for x in d)[:300]
    except Exception:
        return ""


PRINT_KINDS = ("prepare", "print_start", "pause", "resume", "finish", "fail")


async def _link(db, e: dict) -> None:
    """Ce qui permet d'ouvrir la fiche : l'impression (son vrai nom, celui de l'appli, et son numero) ; la bobine d'un
    filament (et son filament). Le nom que donne l'imprimante est souvent celui du profil de tranchage."""
    from sqlalchemy import select
    from ..models.print_history import Print
    from ..models.filament import Spool
    if e["kind"] in PRINT_KINDS:
        rows = (await db.execute(select(Print.id, Print.file_name, Print.translated_name, Print.print_date)
                                 .order_by(Print.id.desc()).limit(8))).all()
        raw = (e.get("detail") or "").strip()
        hit = next((r for r in rows if raw and raw in ((r[1] or ""), (r[2] or ""))), None)
        # sinon la plus recente lancee dans les 12 h autour de l'evenement
        hit = hit or next((r for r in rows if r[3] and abs((r[3] - e["t"]).total_seconds()) < 12 * 3600), None)
        if hit:
            e["print_id"] = hit[0]
            e["detail"] = hit[2] or hit[1] or raw
    elif e["kind"] == "filament" and e.get("spool_id"):
        sp = await db.get(Spool, e["spool_id"])
        if sp:
            e["filament_id"] = sp.filament_id
        else:
            e.pop("spool_id", None)


def pending() -> list:
    with _LOCK:
        return list(_PENDING)


async def flush() -> int:
    """Ecrit en base ce qui attend (appele par la boucle des capteurs)."""
    with _LOCK:
        todo = list(_PENDING)
        _PENDING.clear()
    if not todo:
        return 0
    from ..db.session import AsyncSessionLocal
    from ..models.sensor import MachineEvent
    async with AsyncSessionLocal() as db:
        for e in todo:
            e = dict(e)
            if e["kind"] == "hms":
                e["detail"] = _title_hms(e)
            try:
                await _link(db, e)
            except Exception as x:
                logger.debug(f"[EVENEMENTS] lien vers la fiche : {x}")
            extra = {k: v for k, v in e.items() if k not in ("t", "kind", "title", "detail", "hms", "model") and v not in (None, "")}
            db.add(MachineEvent(ts=e["t"], kind=e["kind"], title=e["title"], detail=e.get("detail") or "",
                                extra=json.dumps(extra) if extra else None))
        await db.commit()
    return len(todo)


async def purge(days: int) -> None:
    from sqlalchemy import delete
    from ..db.session import AsyncSessionLocal
    from ..models.sensor import MachineEvent
    async with AsyncSessionLocal() as db:
        await db.execute(delete(MachineEvent).where(MachineEvent.ts < datetime.utcnow() - timedelta(days=days)))
        await db.commit()


async def between(since: datetime, end: datetime) -> list:
    """Les evenements de la fenetre, du plus ancien au plus recent (ceux qui attendent encore d'etre ecrits aussi)."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.sensor import MachineEvent
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(MachineEvent).where(MachineEvent.ts >= since, MachineEvent.ts <= end)
                                 .order_by(MachineEvent.ts))).scalars().all()
    out = [{"t": r.ts.isoformat() + "Z", "kind": r.kind, "title": r.title, "detail": r.detail or "",
            **(json.loads(r.extra) if r.extra else {})} for r in rows]
    for e in pending():
        if since <= e["t"] <= end:
            out.append({"t": e["t"].isoformat() + "Z", "kind": e["kind"], "title": e["title"], "detail": e.get("detail") or "",
                        **{k: v for k, v in e.items() if k in ("color", "before", "spool_id") and v not in (None, "")}})
    return out
