"""
Suivi du filament couche par couche (alpha, 02/11/2026).

Methode actuelle (inchangee, et seule active tant que l'interrupteur est sur « Actuel ») : tout le poids prevu d'une
impression est retire des bobines au debut (print_tracker._apply_meta).

Couche par couche : le G-code du 3MF tranche (deja garde dans prints/{id}/) dit, pour chaque couche, combien chaque
filament a extrude depuis le debut (purges comprises). Cale sur les grammes prevus par le trancheur, il donne a tout
moment la consommation reelle, a partir de la couche et de l'avancement que l'imprimante annonce :
  - affichage : le poids de la bobine maintenant, et sa cible (son poids a la fin) ;
  - bobine finie en cours de route (a la main) ou relais automatique de l'AMS : l'ancienne passe a 0, la nouvelle
    porte le reste, a partir du point atteint (une ligne de consommation de plus, avec from_g) ;
  - echec ou annulation : la part non imprimee revient a chaque bobine (trace dans son historique).
La consommation est une fonction de la couche : apres un redemarrage (serveur ou imprimante), la couche annoncee
suffit a la retrouver, quel que soit le nombre de couches passees entre-temps. Le dernier etat sur est garde en base
(couche, avancement, grammes) pour regler un echec survenu pendant l'arret. Sans G-code lisible : grammes prevus x
avancement. Sans aucune progression vue : rien ne change (tout reste retire, comme avant).
"""
from __future__ import annotations

import asyncio
import bisect
import json
import logging
import os
import re
import threading
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import select

from ..db.session import AsyncSessionLocal
from .settings_service import get_setting, set_setting

logger = logging.getLogger(__name__)
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))

K_MODE = "FILAMENT_TRACKING"          # "" : actuel ; "layer" : couche par couche (alpha)
K_STATE = "FILAMENT_TRACKING_STATE"   # {print_id: {layer, pct, best: {slot: g}, at, settled}}
STATE_KEEP = 20                       # impressions gardees dans l'etat (les plus recentes)
REFILL_EVERY = 20.0                   # s entre deux regards sur l'emplacement actif (relais de l'AMS)

ON = {"v": False}
_LOCK = threading.Lock()
_PROG: dict = {}      # print_id -> {"layer", "pct", "t"} : la derniere progression acceptee
_BEST: dict = {}      # print_id -> {slot: g} : le plus loin atteint (jamais deux fois la meme matiere)
_TABLES: dict = {}    # print_id -> table du G-code, ou None (illisible : estimation)
_REFILL: dict = {}    # print_id -> {"t": dernier regard, "seen": (slot, spool_id) en attente de confirmation}


def enabled() -> bool:
    return ON["v"]


# ── Lecture du G-code ────────────────────────────────────────────────────────────────────────────────────────────────
_E = re.compile(rb"(?:^|\s)E(-?\d*\.?\d+)")
_M73P = re.compile(rb"M73 P(\d+)")
_M73L = re.compile(rb"M73 L(\d+)")
_T = re.compile(rb"T(\d+)")


def parse_gcode(raw: bytes) -> dict:
    """{"L": [couches], "P": [avancement au debut de chaque couche], "C": {outil: [mm cumules au debut de chaque
    couche]}, "T": {outil: mm au total}}. Outil n = filament n+1 du 3MF. Extrusions relatives (M83) ou absolues (M82,
    G92) ; les rincages faits par l'imprimante sont notes en commentaire (« ;VG1 E… ») et comptent pour le filament
    qui arrive."""
    tool = None
    rel = True
    last_e = 0.0
    pct = 0
    cum: dict = {}
    L, P, snaps = [], [], []
    for line in raw.split(b"\n"):
        if not line:
            continue
        c = line[0]
        if c == 59:                                  # ';' : commentaire, sauf les rincages virtuels
            if line.startswith(b";VG1") and tool is not None:
                m = _E.search(line)
                if m:
                    v = float(m.group(1))
                    if v > 0:
                        cum[tool] = cum.get(tool, 0.0) + v
            continue
        if c == 71:                                  # 'G'
            if line.startswith((b"G1", b"G0", b"G2", b"G3")):
                if tool is None:
                    continue
                m = _E.search(line.split(b";", 1)[0])
                if not m:
                    continue
                v = float(m.group(1))
                if rel:
                    cum[tool] = cum.get(tool, 0.0) + v
                else:
                    cum[tool] = cum.get(tool, 0.0) + (v - last_e)
                    last_e = v
            elif line.startswith(b"G92"):
                m = _E.search(line.split(b";", 1)[0])
                if m:
                    last_e = float(m.group(1))
            continue
        if c == 77:                                  # 'M'
            if line.startswith(b"M73"):
                m = _M73P.match(line)
                if m:
                    pct = int(m.group(1))
                m = _M73L.match(line)
                if m:
                    L.append(int(m.group(1)))
                    P.append(pct)
                    snaps.append(dict(cum))
            elif line.startswith(b"M83"):
                rel = True
            elif line.startswith(b"M82"):
                rel = False
            continue
        if c == 84:                                  # 'T' : changement de filament (T255 et plus : pas un filament)
            m = _T.match(line)
            if m:
                n = int(m.group(1))
                if n < 255:
                    tool = n
    tools = sorted(cum)
    return {"L": L, "P": P, "C": {t: [s.get(t, 0.0) for s in snaps] for t in tools}, "T": {t: cum[t] for t in tools}}


def _read_table(model_3mf: str, plate_id: str) -> Optional[dict]:
    p = DATA_DIR / model_3mf
    with zipfile.ZipFile(p) as z:
        names = z.namelist()
        want = f"Metadata/plate_{plate_id or 1}.gcode"
        name = want if want in names else next((n for n in names if n.startswith("Metadata/plate_") and n.endswith(".gcode")), None)
        if not name:
            return None
        t = parse_gcode(z.read(name))
    return t if t["L"] and t["T"] else None


async def _table(pid: int, p) -> Optional[dict]:
    if pid in _TABLES:
        return _TABLES[pid]
    if p is None or not p.model_3mf:
        return None                                  # le 3MF n'est pas encore arrive : on le relira
    t = None
    if p is not None and p.model_3mf:
        try:
            t0 = time.time()
            t = await asyncio.to_thread(_read_table, p.model_3mf, p.plate_id or "1")
            logger.info(f"[LIVE] G-code de l'impression #{pid} : {len(t['L']) if t else 0} couches, "
                        f"{len(t['T']) if t else 0} filaments ({time.time() - t0:.1f} s)")
        except Exception as e:
            logger.warning(f"[LIVE] G-code illisible pour l'impression #{pid} : {e} (estimation par l'avancement)")
    if len(_TABLES) > 4:
        _TABLES.pop(next(iter(_TABLES)))
    _TABLES[pid] = t
    return t


def _mm_at(t: dict, tool: int, layer: int, pct: float) -> Optional[float]:
    """mm extrudes par cet outil a la couche annoncee, au prorata de l'avancement a l'interieur de la couche."""
    cs = t["C"].get(tool)
    if cs is None:
        return None
    L, P = t["L"], t["P"]
    if layer < L[0]:
        return 0.0
    i = min(bisect.bisect_right(L, layer) - 1, len(L) - 1)
    a = cs[i]
    b = cs[i + 1] if i + 1 < len(cs) else t["T"][tool]
    p0 = P[i]
    p1 = P[i + 1] if i + 1 < len(P) else 100
    f = 0.0 if p1 <= p0 else max(0.0, min(1.0, (pct - p0) / (p1 - p0)))
    return a + (b - a) * f


def used_by_slot(t: Optional[dict], planned: dict, layer: int, pct: float) -> tuple[dict, dict]:
    """({slot: grammes consommes}, {slot: "gcode" | "estimate"}), cale sur les grammes prevus de chaque filament."""
    used, src = {}, {}
    for slot, g in planned.items():
        if g <= 0:
            continue
        tool = slot - 1
        mm = _mm_at(t, tool, layer, pct) if t else None
        tot = (t["T"].get(tool) or 0) if t else 0
        if mm is not None and tot > 0:
            used[slot] = max(0.0, min(g, g * mm / tot))
            src[slot] = "gcode"
        else:
            used[slot] = max(0.0, min(g, g * max(0.0, min(100.0, pct)) / 100))
            src[slot] = "estimate"
    return used, src


# ── Etat (en base : survit a un redemarrage) ────────────────────────────────────────────────────────────────────────
async def _state() -> dict:
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, K_STATE, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def _state_put(pid: int, entry: dict) -> None:
    d = await _state()
    d[str(pid)] = {**(d.get(str(pid)) or {}), **entry}
    if len(d) > STATE_KEEP:
        for k in sorted(d, key=lambda k: int(k) if k.isdigit() else 0)[:len(d) - STATE_KEEP]:
            d.pop(k, None)
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_STATE, json.dumps(d))


async def load() -> None:
    """Au demarrage : l'interrupteur, et l'etat des impressions en cours (le plus loin atteint)."""
    async with AsyncSessionLocal() as db:
        ON["v"] = (await get_setting(db, K_MODE, "") or "") == "layer"
    for k, e in (await _state()).items():
        if k.isdigit() and isinstance(e, dict) and not e.get("settled"):
            pid = int(k)
            _BEST[pid] = {int(s): float(g) for s, g in (e.get("best") or {}).items()}
            if e.get("layer"):
                _PROG[pid] = {"layer": int(e["layer"]), "pct": float(e.get("pct") or 0), "t": 0.0}
            if e.get("active"):
                _REFILL[pid] = {"t": 0.0, "seen": None, "active": {int(x) for x in e["active"]}}


async def set_mode(on: bool) -> None:
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_MODE, "layer" if on else "")
    ON["v"] = bool(on)
    logger.info(f"[LIVE] suivi du filament : {'couche par couche (alpha)' if on else 'actuel'}")


# ── Lignes de consommation ───────────────────────────────────────────────────────────────────────────────────────────
async def _rows(db, pid: int) -> dict:
    """{slot: [lignes dans l'ordre]} : une ligne par bobine qui a servi a ce filament (une seule sans changement)."""
    from ..models.print_history import FilamentUsage
    rows = (await db.execute(select(FilamentUsage).where(FilamentUsage.print_id == pid)
                             .order_by(FilamentUsage.id))).scalars().all()
    out: dict = {}
    for r in rows:
        if r.ams_slot:
            out.setdefault(int(r.ams_slot), []).append(r)
    return out


def _row_used(r, slot_used: float) -> float:
    """La part de la consommation de son filament qui revient a cette ligne (sa bobine a pris le relais a from_g)."""
    return max(0.0, min(float(r.grams_used or 0), slot_used - float(r.from_g or 0)))


async def _used(db, pid: int, p=None) -> tuple[dict, dict, dict]:
    """(lignes par filament, grammes consommes par filament, source par filament), a la derniere progression."""
    from ..models.print_history import Print
    p = p or await db.get(Print, pid)
    rows = await _rows(db, pid)
    planned = {s: sum(float(r.grams_used or 0) for r in rs) for s, rs in rows.items()}
    prog = _PROG.get(pid)
    if not prog:
        return rows, {s: 0.0 for s in planned}, {}
    t = await _table(pid, p)
    used, src = used_by_slot(t, planned, prog["layer"], prog["pct"])
    best = _BEST.setdefault(pid, {})
    for s, g in used.items():
        best[s] = used[s] = max(g, best.get(s, 0.0))       # jamais de recul : une reprise ne compte pas deux fois
    return rows, used, src


# ── Progression (appelee depuis le fil MQTT, par print_tracker.on_progress) ─────────────────────────────────────────
def note(pid: int, pct: float, layer: int) -> None:
    """Une progression acceptee (couche annoncee >= 1). Une nouvelle couche : calcul et sauvegarde en fond ; de temps
    en temps : regard sur l'emplacement actif (relais de l'AMS)."""
    if not ON["v"] or not pid or not layer or layer < 1:
        return
    now = time.time()
    with _LOCK:
        prev = _PROG.get(pid)
        _PROG[pid] = {"layer": int(layer), "pct": float(pct or 0), "t": now}
        new_layer = not prev or prev["layer"] != int(layer)
        r = _REFILL.setdefault(pid, {"t": 0.0, "seen": None})
        look = now - r["t"] >= REFILL_EVERY
        if look:
            r["t"] = now
    if new_layer or look:
        from .print_tracker import _bg
        _bg(_tick(pid, save=new_layer, look=look))


async def _tick(pid: int, save: bool, look: bool) -> None:
    try:
        async with AsyncSessionLocal() as db:
            _rows_, used, _src = await _used(db, pid)
        if save:
            prog = _PROG.get(pid) or {}
            await _state_put(pid, {"layer": prog.get("layer"), "pct": prog.get("pct"),
                                   "best": {str(s): round(g, 2) for s, g in used.items()},
                                   "at": datetime.utcnow().isoformat()})
        if look:
            await _check_refill(pid)
    except Exception as e:
        logger.warning(f"[LIVE] suivi de l'impression #{pid} : {e}")


# ── Relais automatique de l'AMS ─────────────────────────────────────────────────────────────────────────────────────
async def _check_refill(pid: int) -> None:
    """L'emplacement actif porte une bobine qui n'est aucune de celles de l'impression : l'AMS a pris le relais d'une
    bobine vide. On bascule le filament de meme matiere (meme filament, sinon meme type et couleur) sur elle, apres
    l'avoir vu deux fois de suite (une transition ne suffit pas). Seulement une bobine qu'on a vue imprimer pendant ce
    suivi (02/11/2026) : une bobine associee au lancement par sa matiere et sa couleur, mais qui n'est pas celle de
    l'AMS, serait sinon prise pour une bobine videe, et mise a 0 a tort."""
    from ..core.mqtt import get_state
    from ..models.filament import Spool
    s = get_state()
    if not s or str(getattr(s, "status", "") or "").upper() not in ("RUNNING",):
        return
    tray = None
    for a in s.ams_list or []:
        if a.id == s.active_ams_id:
            tray = next((t for t in a.trays if t.id == s.active_tray_id), None)
    sid = getattr(tray, "spool_id", None) if tray else None
    r = _REFILL.setdefault(pid, {"t": 0.0, "seen": None})
    active = r.setdefault("active", set())
    if not sid:
        r["seen"] = None
        return
    async with AsyncSessionLocal() as db:
        rows = await _rows(db, pid)
        cur = {slot: rs[-1] for slot, rs in rows.items() if rs}
        if any(row.spool_id == sid for row in cur.values()):
            r["seen"] = None
            if sid not in active:
                active.add(sid)
                await _state_put(pid, {"active": sorted(active)})
            return
        new = await db.get(Spool, sid)
        if not new:
            return
        olds = {slot: await db.get(Spool, row.spool_id) if row.spool_id else None for slot, row in cur.items()}
        same = [slot for slot, sp in olds.items() if sp and sp.filament_id == new.filament_id]
        if len(same) != 1:
            ty = (getattr(tray, "filament_type", "") or "").upper()
            col = (getattr(tray, "color", "") or "").upper()[:6]
            same = [slot for slot, row in cur.items()
                    if (row.filament_type or "").upper() == ty and (row.color_hex or "").lstrip("#").upper()[:6] == col]
        if len(same) > 1:
            # plusieurs filaments pareils : celui dont la bobine n'est plus dans un emplacement plein (elle vient de
            # se vider) ; les autres tournent encore
            full = {t.spool_id for a in s.ams_list or [] for t in a.trays if t.spool_id and not getattr(t, "empty", False)}
            same = [slot for slot in same if cur[slot].spool_id not in full]
        same = [slot for slot in same if cur[slot].spool_id in active]
        if len(same) != 1:
            r["seen"] = None
            return
    key = (same[0], sid)
    if r["seen"] != key:
        r["seen"] = key
        return
    r["seen"] = None
    await switch(pid, same[0], sid, auto=True)


# ── Changement de bobine ────────────────────────────────────────────────────────────────────────────────────────────
async def switch(pid: int, slot: int, spool_id: int, auto: bool = False) -> dict:
    """La bobine de ce filament est finie, la suite vient de spool_id : l'ancienne passe a 0, la nouvelle porte le
    reste (retire de son poids), a partir du point atteint."""
    from ..models.print_history import Print, FilamentUsage
    from ..models.filament import Spool
    from .print_tracker import _costs
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            raise ValueError("Impression introuvable")
        rows, used, _src = await _used(db, pid, p)
        rs = rows.get(int(slot))
        if not rs:
            raise ValueError("Ce filament n'est pas dans l'impression")
        last = rs[-1]
        if last.spool_id == spool_id:
            return {"ok": True, "same": True}
        new = await db.get(Spool, spool_id)
        if not new:
            raise ValueError("Bobine introuvable")
        at = used.get(int(slot), 0.0)
        part = _row_used(last, at)
        left = round(float(last.grams_used or 0) - part, 2)
        pname = p.translated_name or p.file_name or f"Impression {pid}"
        if last.spool_id:
            old = await db.get(Spool, last.spool_id)
            if old and not old.archived:
                left_old = round(float(old.remaining_weight_g or 0), 1)
                old.remaining_weight_g = 0.0                  # finie : ce qui restait a ete imprime
                if left_old > 0:
                    # tracee dans son historique (02/11/2026), et annulable comme un rendu
                    from ..models.spool_move import SpoolMove
                    db.add(SpoolMove(spool_id=old.id, grams=left_old, kind="fin", print_id=pid, usage_id=last.id,
                                     label=f"{pname} — bobine finie, la #{spool_id} prend la suite"
                                           f"{' (relais de l’AMS)' if auto else ''}"[:250]))
        last.grams_used = round(part, 2)
        row = FilamentUsage(print_id=pid, spool_id=spool_id, filament_type=last.filament_type, color_hex=last.color_hex,
                            grams_used=left, ams_slot=int(slot), from_g=round(float(last.from_g or 0) + part, 2))
        db.add(row)
        new.remaining_weight_g = max(0.0, float(new.remaining_weight_g or 0) - left)
        now = datetime.utcnow()
        new.first_used_at = new.first_used_at or now
        new.last_used_at = now
        await db.flush()
        await _costs(db, p)
        await db.commit()
    try:
        from ..core.mqtt import invalidate_tray_cache
        invalidate_tray_cache()
    except Exception:
        pass
    logger.info(f"[LIVE] impression #{pid}, filament {slot} : bobine #{spool_id} prend la suite "
                f"({'relais AMS' if auto else 'a la main'}) a {at:.1f} g ; reste {left:.1f} g sur elle")
    return {"ok": True, "slot": int(slot), "spool_id": spool_id, "at": round(at, 1), "left": left, "auto": auto}


# ── Fin d'impression ────────────────────────────────────────────────────────────────────────────────────────────────
async def settle(pid: int) -> list:
    """Echec ou annulation : la part non imprimee de chaque ligne revient a sa bobine (une fois). Sans progression
    connue, rien ne change (tout reste retire, comme avant). Rend [(spool_id, grammes)]."""
    from ..models.print_history import Print
    from ..models.filament import Spool
    from ..models.spool_move import SpoolMove
    from .print_tracker import _costs
    st = (await _state()).get(str(pid)) or {}
    if st.get("settled"):
        return []
    if pid not in _PROG and st.get("layer"):
        _PROG[pid] = {"layer": int(st["layer"]), "pct": float(st.get("pct") or 0), "t": 0.0}
        _BEST.setdefault(pid, {}).update({int(s): float(g) for s, g in (st.get("best") or {}).items()})
    if pid not in _PROG:
        logger.info(f"[LIVE] impression #{pid} ratee sans progression connue : rien n'est rendu")
        return []
    back = []
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            return []
        rows, used, _src = await _used(db, pid, p)
        label = f"{p.translated_name or p.file_name or f'Impression {pid}'} — échec : la part non imprimée"
        for slot, rs in rows.items():
            for r in rs:
                g = float(r.grams_used or 0)
                give = round(g - _row_used(r, used.get(slot, 0.0)), 1)
                if give < 0.1 or not r.spool_id:
                    continue
                sp = await db.get(Spool, r.spool_id)
                if not sp or sp.archived:
                    continue
                sp.remaining_weight_g = round(float(sp.remaining_weight_g or 0) + give, 1)
                r.grams_used = round(g - give, 2)
                db.add(SpoolMove(spool_id=r.spool_id, grams=give, kind="rendu", print_id=pid, usage_id=r.id,
                                 label=label[:250]))
                back.append((r.spool_id, give))
        await db.flush()
        await _costs(db, p)
        try:
            from ..api.v1.routes.prints import _propagate_from_print
            await _propagate_from_print(db, pid)
        except Exception as e:
            logger.warning(f"[LIVE] report sur les objets de l'impression #{pid} : {e}")
        await db.commit()
    await _state_put(pid, {"settled": True, "back": [[s, g] for s, g in back]})
    if back:
        try:
            from ..core.mqtt import invalidate_tray_cache
            invalidate_tray_cache()
        except Exception:
            pass
    logger.info(f"[LIVE] impression #{pid} ratee : rendu aux bobines {back}")
    return back


def forget(pid: int) -> None:
    with _LOCK:
        _PROG.pop(pid, None)
        _BEST.pop(pid, None)
        _TABLES.pop(pid, None)
        _REFILL.pop(pid, None)


async def finished(pid: int) -> None:
    """Impression finie (reussie) : son etat est clos ; plus rien a rattraper."""
    await _state_put(pid, {"settled": True})
    forget(pid)


# ── Pour la page ────────────────────────────────────────────────────────────────────────────────────────────────────
async def live(pid: int) -> dict:
    """Ou en est chaque filament de cette impression : grammes consommes et prevus, et pour chaque bobine son poids
    maintenant et sa cible (son poids a la fin)."""
    from ..models.print_history import Print
    from ..models.filament import Spool, Filament
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            return {}
        rows, used, src = await _used(db, pid, p)
        ids = {r.spool_id for rs in rows.values() for r in rs if r.spool_id}
        spools = {}
        if ids:
            for sp, fil in (await db.execute(select(Spool, Filament).outerjoin(Filament, Filament.id == Spool.filament_id)
                                             .where(Spool.id.in_(ids)))).all():
                spools[sp.id] = (sp, fil)
    prog = _PROG.get(pid) or {}
    items = []
    for slot in sorted(rows):
        rs = rows[slot]
        planned = sum(float(r.grams_used or 0) for r in rs)
        u = used.get(slot, 0.0)
        for k, r in enumerate(rs):
            ru = _row_used(r, u)
            sp, fil = spools.get(r.spool_id, (None, None))
            rem = float(sp.remaining_weight_g) if sp and sp.remaining_weight_g is not None else None
            items.append({
                "slot": slot, "row": r.id, "spool_id": r.spool_id, "current": k == len(rs) - 1,
                "planned": round(planned, 1), "used": round(u, 1),
                "row_planned": round(float(r.grams_used or 0), 1), "row_used": round(ru, 1),
                "now": round(rem + float(r.grams_used or 0) - ru, 1) if rem is not None else None,
                "target": round(rem, 1) if rem is not None else None,
                "source": src.get(slot, "estimate"), "color": r.color_hex, "type": r.filament_type,
                "name": (getattr(fil, "translated_name", None) or getattr(fil, "name", None) or "") if fil else "",
                "spool_full": float(fil.filament_weight_g) if fil and fil.filament_weight_g else None,
            })
    return {"print_id": pid, "print_name": p.translated_name or p.file_name, "layer": prog.get("layer"), "pct": prog.get("pct"),
            "items": items}


async def current_print_id() -> Optional[int]:
    from ..models.print_history import Print
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(Print.id).where(Print.status == "IN_PROGRESS")
                                 .order_by(Print.id.desc()).limit(1))).scalar()
