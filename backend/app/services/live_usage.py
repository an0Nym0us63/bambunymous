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

K_STATE = "FILAMENT_TRACKING_STATE"   # {print_id: {layer, pct, best: {slot: g}, at, settled}}
STATE_KEEP = 20                       # impressions gardees dans l'etat (les plus recentes)
REFILL_EVERY = 20.0                   # s entre deux regards sur l'emplacement actif (relais de l'AMS)

# toujours actif depuis le 03/11/2026 (avant : un interrupteur, « Actuel » par defaut ; le reglage
# FILAMENT_TRACKING laisse en base n'est plus lu)
ON = {"v": True}
_LOCK = threading.Lock()
_PROG: dict = {}      # print_id -> {"layer", "pct", "t"} : la derniere progression acceptee
_BEST: dict = {}      # print_id -> {slot: g} : le plus loin atteint (jamais deux fois la meme matiere)
_TABLES: dict = {}    # print_id -> table du G-code, ou None (illisible : estimation)
_REFILL: dict = {}    # print_id -> {"t": dernier regard, "seen": (slot, spool_id) en attente de confirmation}
_SKIP: dict = {}      # print_id -> {objet: [couche, avancement]} : les pieces annulees, et quand (05/11/2026)


def enabled() -> bool:
    return ON["v"]


# ── Lecture du G-code ────────────────────────────────────────────────────────────────────────────────────────────────
_E = re.compile(rb"(?:^|\s)E(-?\d*\.?\d+)")
_M73P = re.compile(rb"M73 P(\d+)")
_M73L = re.compile(rb"M73 L(\d+)")
_T = re.compile(rb"T(\d+)")


_OBJ = b"; start printing object, unique label id:"
_OBJ_END = b"; stop printing object"


def parse_gcode(raw: bytes) -> dict:
    """{"L": [couches], "P": [avancement au debut de chaque couche], "C": {outil: [mm cumules au debut de chaque
    couche]}, "T": {outil: mm au total}, "O": {objet: {outil: [mm cumules au debut de chaque couche]}}, "OT": {objet:
    {outil: mm au total}}}. Outil n = filament n+1 du 3MF. Extrusions relatives (M83) ou absolues (M82, G92) ; les
    rincages faits par l'imprimante sont notes en commentaire (« ;VG1 E… ») et comptent pour le filament qui arrive.
    Chaque piece est encadree par « ; start printing object, unique label id: N » et « ; stop printing object » (05/11/2026) :
    ce qui s'extrude entre les deux est aussi compte pour elle, pour savoir ce qu'une piece annulee n'imprime pas."""
    tool = None
    obj = None
    rel = True
    last_e = 0.0
    pct = 0
    cum: dict = {}
    ocum: dict = {}
    L, P, snaps, osnaps = [], [], [], []
    for line in raw.split(b"\n"):
        if not line:
            continue
        c = line[0]
        if c == 59:                                  # ';' : commentaire, sauf les rincages virtuels et les pieces
            if line.startswith(b";VG1") and tool is not None:
                m = _E.search(line)
                if m:
                    v = float(m.group(1))
                    if v > 0:
                        cum[tool] = cum.get(tool, 0.0) + v
            elif line.startswith(_OBJ):
                obj = line[len(_OBJ):].strip().decode("ascii", "replace") or None
            elif line.startswith(_OBJ_END):
                obj = None
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
                    d = v
                else:
                    d = v - last_e
                    last_e = v
                cum[tool] = cum.get(tool, 0.0) + d
                if obj is not None:
                    o = ocum.get(obj)
                    if o is None:
                        o = ocum[obj] = {}
                    o[tool] = o.get(tool, 0.0) + d
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
                    osnaps.append({k: dict(v) for k, v in ocum.items()})
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
    O = {k: {t: [(sn.get(k) or {}).get(t, 0.0) for sn in osnaps] for t in v} for k, v in ocum.items()}
    return {"L": L, "P": P, "C": {t: [s.get(t, 0.0) for s in snaps] for t in tools}, "T": {t: cum[t] for t in tools},
            "O": O, "OT": ocum}


def _read_table(model_3mf: str, plate_id: str) -> Optional[dict]:
    p = DATA_DIR / model_3mf
    with zipfile.ZipFile(p) as z:
        names = z.namelist()
        want = f"Metadata/plate_{plate_id or 1}.gcode"
        name = want if want in names else next((n for n in names if n.startswith("Metadata/plate_") and n.endswith(".gcode")), None)
        if not name:
            return None
        t = parse_gcode(z.read(name))
        # le nom des pieces, pour l'historique d'une piece annulee
        try:
            import html as _html
            info = z.read("Metadata/slice_info.config").decode("utf-8", "replace")
            names = {}
            for tag in re.findall(r"<object\s[^>]*>", info):
                i, n = re.search(r'identify_id="([^"]*)"', tag), re.search(r'\sname="([^"]*)"', tag)
                if i and n:
                    names[i.group(1)] = _html.unescape(n.group(1))
            t["N"] = names
        except KeyError:
            t["N"] = {}
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
    return _at(t, cs, t["T"][tool], layer, pct)


def _at(t: dict, cs: list, total: float, layer: int, pct: float) -> float:
    """Des mm cumules couche par couche (cs, total a la fin) : leur valeur a la couche et a l'avancement annonces."""
    L, P = t["L"], t["P"]
    if layer < L[0]:
        return 0.0
    i = min(bisect.bisect_right(L, layer) - 1, len(L) - 1)
    a = cs[i]
    b = cs[i + 1] if i + 1 < len(cs) else total
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


def skipped_by_slot(t: Optional[dict], planned: dict, skips: dict, layer: Optional[int] = None,
                    pct: float = 0.0) -> dict:
    """{slot: grammes que les pieces annulees n'ont pas imprimes} jusqu'a (layer, pct), ou en tout (layer None).
    Une piece annulee a (couche, avancement) : ce que le G-code lui faisait extruder ensuite, de chaque filament, rapporte
    aux grammes prevus du filament comme le reste du suivi."""
    out: dict = {}
    if not t or not skips or not t.get("O"):
        return out
    for slot, g in planned.items():
        tool = slot - 1
        tot = (t["T"].get(tool) or 0)
        if g <= 0 or tot <= 0:
            continue
        mm = 0.0
        for obj, at in skips.items():
            cs = (t["O"].get(obj) or {}).get(tool)
            if cs is None:
                continue
            ot = t["OT"][obj][tool]
            a = _at(t, cs, ot, int(at[0]), float(at[1]))
            b = ot if layer is None else _at(t, cs, ot, layer, pct)
            mm += max(0.0, b - a)
        if mm > 0:
            out[slot] = min(g, g * mm / tot)
    return out


def _skips(pid: int) -> dict:
    with _LOCK:
        return dict(_SKIP.get(pid) or {})


def skip(pid: int, ids: list, pct: float, layer: int) -> None:
    """Des pieces annulees pendant l'impression (« s_obj » de l'imprimante) : on garde la couche et l'avancement ou
    chacune l'a ete, la premiere fois qu'on la voit."""
    if not pid:
        return
    with _LOCK:
        cur = _SKIP.setdefault(pid, {})
        new = [str(i) for i in ids if str(i) not in cur]
        for i in new:
            cur[i] = [int(layer or 0), float(pct or 0)]
        snap = dict(cur)
    if new:
        logger.info(f"[LIVE] impression #{pid} : piece(s) annulee(s) {', '.join(new)} a la couche {layer} ({pct:.0f} %)")
        from .print_tracker import _bg

        async def _keep():
            await _state_put(pid, {"skip": snap})
            await _mark(pid)
        _bg(_keep())


async def _mark(pid: int, back: Optional[list] = None) -> None:
    """Les pieces annulees, gardees sur l'impression (05/11/2026) : la fiche et la liste les signalent."""
    from ..models.print_history import Print
    sk = await skipped(pid)
    if not sk:
        return
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            return
        try:
            old = json.loads(p.skipped_objects) if p.skipped_objects else {}
        except ValueError:
            old = {}
        names = {o.get("id"): o.get("name") for o in old.get("objects") or [] if isinstance(o, dict)}
        out = {"objects": [{"id": o, "name": v["name"] or names.get(o), "layer": v["layer"]} for o, v in sk.items()]}
        if back is not None:
            out["back"] = [[s, g] for s, g in back]
        elif old.get("back"):
            out["back"] = old["back"]
        p.skipped_objects = json.dumps(out, ensure_ascii=False)
        await db.commit()


async def skipped(pid: int) -> dict:
    """{objet: {"layer", "name"}} : les pieces annulees de cette impression (pour la vue couche et le suivi)."""
    st = (await _state()).get(str(pid)) or {}
    sk = {**(st.get("skip") or {}), **_skips(pid)}
    names = ((_TABLES.get(pid) or {}).get("N") or {})
    return {o: {"layer": int(v[0]), "name": names.get(o)} for o, v in sk.items()}


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
    """Au demarrage : l'etat des impressions en cours (le plus loin atteint)."""
    for k, e in (await _state()).items():
        if k.isdigit() and isinstance(e, dict) and not e.get("settled"):
            pid = int(k)
            _BEST[pid] = {int(s): float(g) for s, g in (e.get("best") or {}).items()}
            if e.get("layer"):
                _PROG[pid] = {"layer": int(e["layer"]), "pct": float(e.get("pct") or 0), "t": 0.0}
            if e.get("active"):
                _REFILL[pid] = {"t": 0.0, "seen": None, "active": {int(x) for x in e["active"]}}
            if e.get("skip"):
                _SKIP[pid] = {str(o): list(v) for o, v in e["skip"].items()}


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
    # une piece annulee n'imprime plus (05/11/2026) : ce que le G-code lui faisait extruder depuis ne compte pas
    sk = _skips(pid)
    if sk:
        for s, g in skipped_by_slot(t, planned, sk, prog["layer"], prog["pct"]).items():
            used[s] = max(0.0, used[s] - g)
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
async def successor(spool_id: Optional[int], tag: str = "", here: tuple = ()) -> Optional[int]:
    """La bobine qui a pris la suite de celle-ci dans la derniere impression ou elle a servi (03/11/2026), pour
    l'emplacement qui la montre encore : l'AMS ne relit pas une case en pleine impression. spool_id : la bobine que la detection y trouve ;
    sans elle, la puce lue (tag), cherchee aussi parmi les bobines archivees (une bobine finie qu'on a rangee). Rien si
    la suivante est deja vue dans un autre emplacement (relais de l'AMS : elle n'a pas pris la place de l'ancienne).
    here : (ams, emplacement) de la case regardee."""
    from ..models.filament import Spool
    from ..models.print_history import FilamentUsage
    async with AsyncSessionLocal() as db:
        if not spool_id and tag:
            spool_id = (await db.execute(select(Spool.id).where(Spool.tag_number == tag)
                                         .order_by(Spool.id.desc()).limit(1))).scalar()
        if not spool_id:
            return None
        # la derniere impression ou elle a servi (en cours, ou finie : la case la lit encore tant que l'AMS ne l'a
        # pas relue, 03/11/2026)
        pid = (await db.execute(select(FilamentUsage.print_id).where(FilamentUsage.spool_id == spool_id)
                                .order_by(FilamentUsage.print_id.desc()).limit(1))).scalar()
        if not pid:
            return None
        rows = await _rows(db, pid)
    new = None
    for rs in rows.values():
        ids = [r.spool_id for r in rs]
        if spool_id in ids[:-1] and ids[-1]:
            new = ids[-1]
    if not new or new == spool_id:
        return None
    try:
        from ..core.mqtt import get_state
        s = get_state()
        for a in (s.ams_list or []) if s else []:
            for t in a.trays:
                if (a.id, t.id) != tuple(here) and not getattr(t, "empty", False) and t.spool_id == new:
                    return None
    except Exception:
        pass
    return new


async def _follow_tray(old_id: int, new_id: int) -> None:
    """La bobine choisie a la main a ete posee a la place de l'ancienne (03/11/2026) : l'AMS ne relit pas l'emplacement
    en pleine impression, il montrerait encore l'ancienne (a 0 g). L'emplacement de l'ancienne est associe a la
    nouvelle, tant que l'AMS y voit le meme filament (ou la meme puce) ; une relecture l'efface d'elle-meme. Rien si la
    nouvelle est deja vue dans un autre emplacement (elle n'a pas pris la place de l'ancienne)."""
    try:
        from ..core.mqtt import get_state
        from .slot_override import set_override, tray_signature
        s = get_state()
        trays = [(a.id, t) for a in (s.ams_list or []) for t in a.trays if not getattr(t, "empty", False)] if s else []
        if any(t.spool_id == new_id for _a, t in trays):
            return
        for ams_id, t in trays:
            if t.spool_id == old_id:
                await set_override(ams_id, t.id, tray_signature(t), new_id, kind="suite")
    except Exception:
        logger.exception("[LIVE] emplacement de la nouvelle bobine non associe")



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
                # la derive du suivi (05/11/2026) : elle est vraiment finie a « part » ; on lui croyait bef - part
                if pid in _PROG:
                    from . import drift
                    bef = getattr(last, "spool_before_g", None)
                    est = (float(bef) if bef is not None else left_old + float(last.grams_used or 0)) - part
                    if drift.record(old, est, "relais" if auto else "suite", await drift.full_of(db, old)):
                        logger.info(f"[DERIVE] bobine #{old.id} finie a {part:.1f} g : derive {old.drift_g:+.1f} g")
                        drift.note(db, old, "ecart", old.drift_g, f"{pname} — {'relais de l’AMS' if auto else 'suite choisie à la main'} : "
                                   f"on lui croyait {est:.0f} g{' (hors des stats : ' + old.drift_off + ')' if old.drift_off else ''}",
                                   print_id=pid, usage_id=last.id)
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
        row.spool_before_g = float(new.remaining_weight_g or 0)    # avant son decompte (le suivi en direct part de lui)
        db.add(row)
        new.remaining_weight_g = max(0.0, float(new.remaining_weight_g or 0) - left)
        now = datetime.utcnow()
        new.first_used_at = new.first_used_at or now
        new.last_used_at = now
        await db.flush()
        await _costs(db, p)
        await db.commit()
    if not auto and last.spool_id:
        await _follow_tray(last.spool_id, spool_id)
    try:
        from ..core.mqtt import invalidate_tray_cache
        invalidate_tray_cache()
    except Exception:
        pass
    logger.info(f"[LIVE] impression #{pid}, filament {slot} : bobine #{spool_id} prend la suite "
                f"({'relais AMS' if auto else 'a la main'}) a {at:.1f} g ; reste {left:.1f} g sur elle")
    return {"ok": True, "slot": int(slot), "spool_id": spool_id, "at": round(at, 1), "left": left, "auto": auto}


# ── Fin d'impression ────────────────────────────────────────────────────────────────────────────────────────────────
async def settle(pid: int, nothing: bool = False) -> list:
    """Echec ou annulation : la part non imprimee de chaque ligne revient a sa bobine (une fois). Sans progression
    connue, rien ne change (tout reste retire, comme avant) -- sauf « nothing » (02/11/2026) : annulee avant sa premiere
    couche, suivie de bout en bout, rien n'a ete imprime et tout revient. Rend [(spool_id, grammes)]."""
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
    if pid not in _PROG and not nothing:
        logger.info(f"[LIVE] impression #{pid} ratee sans progression connue : rien n'est rendu")
        return []
    back = []
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            return []
        rows, used, _src = await _used(db, pid, p)
        label = f"{p.translated_name or p.file_name or f'Impression {pid}'} — échec : la part non imprimée"
        if nothing and pid not in _PROG:
            used = {}
            label = f"{p.translated_name or p.file_name or f'Impression {pid}'} — annulée avant la première couche"
        for slot, rs in rows.items():
            for r in rs:
                g = float(r.grams_used or 0)
                ru = _row_used(r, used.get(slot, 0.0))
                if g - ru < 0.1 or not r.spool_id:
                    continue
                sp = await db.get(Spool, r.spool_id)
                if not sp or sp.archived:
                    continue
                # on ne rend que ce qui a vraiment ete retire au lancement (04/11/2026) : le decompte s'arrete a 0, une
                # bobine de 55 g pour 230 prevus n'a perdu que 55 g ; lui rendre « 230 - imprime » lui inventait du filament
                bef = getattr(r, "spool_before_g", None)
                taken = min(g, max(0.0, float(bef))) if bef is not None else g
                give = round(max(0.0, taken - ru), 1)
                r.grams_used = round(ru, 2)
                if give < 0.1:
                    continue
                sp.remaining_weight_g = round(float(sp.remaining_weight_g or 0) + give, 1)
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
    if pid in _PROG or nothing:
        await overrun(pid)
    logger.info(f"[LIVE] impression #{pid} ratee : {', '.join(f'{g:g} g a la bobine #{s}' for s, g in back) or 'rien a rendre'}"
                f" (couche {(_PROG.get(pid) or {}).get('layer', '?')}{', rien imprime' if nothing else ''})")
    if back:
        try:
            from ..core.mqtt import invalidate_tray_cache
            invalidate_tray_cache()
        except Exception:
            pass
    logger.info(f"[LIVE] impression #{pid} ratee : rendu aux bobines {back}")
    return back


async def overrun(pid: int) -> None:
    """Fin d'impression (05/11/2026) : ce que chaque bobine a imprime sous notre zero (le decompte s'arrete a 0) est
    cumule sur elle, pour sa derive a sa fin ; une bobine affichee a 0 g garde ainsi son negatif. Aussi sans le suivi
    couche par couche (une impression reussie a tout consomme). Une fois par impression ; la bobine relayee en cours de route a deja sa
    mesure (seule la derniere de chaque filament compte)."""
    from ..models.filament import Spool
    from . import drift
    st = (await _state()).get(str(pid)) or {}
    if st.get("overrun"):
        return
    from ..models.print_history import Print
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        pname = (p.translated_name or p.file_name) if p else f"Impression {pid}"
        for rs in (await _rows(db, pid)).values():
            r = rs[-1]
            bef = getattr(r, "spool_before_g", None)
            if not r.spool_id or bef is None:
                continue
            over = float(r.grams_used or 0) - max(0.0, float(bef))
            sp = await db.get(Spool, r.spool_id)
            if sp and over >= 0.5:
                drift.add_overrun(sp, over)
                # dans son historique (05/11/2026) : ce qu'elle a imprime au-dela de ce qu'on lui croyait
                drift.note(db, sp, "zero", over, f"{pname} — {float(r.grams_used or 0):.1f} g imprimés, on lui croyait "
                           f"{max(0.0, float(bef)):.1f} g", print_id=pid, usage_id=r.id)
                logger.info(f"[DERIVE] bobine #{sp.id} : {over:.1f} g imprimes sous notre zero (impression #{pid})")
        await db.commit()
    await _state_put(pid, {"overrun": True})


async def skipped_back(pid: int) -> list:
    """Impression finie avec des pieces annulees (05/11/2026) : ce qu'elles n'ont pas imprime revient aux bobines (le
    sous-zero d'abord), trace dans leur historique (« pièce annulée : … »). Une fois ; avant overrun. Rend
    [(spool_id, grammes)]."""
    from ..models.print_history import Print
    from ..models.filament import Spool
    from ..models.spool_move import SpoolMove
    from .print_tracker import _costs
    from . import drift
    st = (await _state()).get(str(pid)) or {}
    if st.get("skip_back"):
        return []
    sk = {**(st.get("skip") or {}), **_skips(pid)}
    if not sk:
        return []
    back = []
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            return []
        t = await _table(pid, p)
        sk = {o: v for o, v in sk.items() if t and o in (t.get("O") or {})}
        if not sk:
            logger.info(f"[LIVE] impression #{pid} : pieces annulees inconnues du G-code, rien n'est rendu")
            await _state_put(pid, {"skip_back": True})
            return []
        rows = await _rows(db, pid)
        planned = {s: sum(float(r.grams_used or 0) for r in rs) for s, rs in rows.items()}
        names = t.get("N") or {}
        what = ", ".join(f"{names.get(o) or f'pièce {o}'} (couche {v[0]})" for o, v in sk.items())
        label = f"{p.translated_name or p.file_name or f'Impression {pid}'} — pièce annulée : {what}"
        for slot, less in skipped_by_slot(t, planned, sk).items():
            rest = less
            for r in reversed(rows.get(slot) or []):     # la derniere bobine d'abord : c'est elle qui finissait
                g = float(r.grams_used or 0)
                cut = min(rest, g)
                if cut < 0.05:
                    continue
                rest -= cut
                bef = getattr(r, "spool_before_g", None)
                taken = min(g, max(0.0, float(bef))) if bef is not None else g
                r.grams_used = round(g - cut, 2)
                give = round(max(0.0, taken - (g - cut)), 1)
                sp = await db.get(Spool, r.spool_id) if r.spool_id else None
                if give >= 0.1 and sp and not sp.archived:
                    a = drift.give_back(sp, give)
                    db.add(SpoolMove(spool_id=r.spool_id, grams=give, kind="rendu", print_id=pid, usage_id=r.id,
                                     label=(label + drift.back_note(a))[:250]))
                    back.append((r.spool_id, give))
                if rest < 0.05:
                    break
        await db.flush()
        await _costs(db, p)
        try:
            from ..api.v1.routes.prints import _propagate_from_print
            await _propagate_from_print(db, pid)
        except Exception as e:
            logger.warning(f"[LIVE] report sur les objets de l'impression #{pid} : {e}")
        await db.commit()
    await _state_put(pid, {"skip_back": True, "skip": sk})
    try:
        await _mark(pid, back)
    except Exception as e:
        logger.warning(f"[LIVE] pieces annulees de l'impression #{pid} : {e}")
    logger.info(f"[LIVE] impression #{pid} : {what} ; {', '.join(f'{g:g} g a la bobine #{s}' for s, g in back) or 'rien a rendre'}")
    return back


def forget(pid: int) -> None:
    with _LOCK:
        _SKIP.pop(pid, None)
        _PROG.pop(pid, None)
        _BEST.pop(pid, None)
        _TABLES.pop(pid, None)
        _REFILL.pop(pid, None)


async def finished(pid: int) -> None:
    """Impression finie (reussie) : son etat est clos ; plus rien a rattraper."""
    await skipped_back(pid)
    await overrun(pid)
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
    # une piece annulee n'imprimera plus le reste (05/11/2026) : le prevu, et le poids de la bobine a la fin, le
    # retirent deja (la derniere bobine de chaque filament d'abord, comme skipped_back) ; une fois rendu a la fin, les
    # lignes de consommation le portent elles-memes
    adj: dict = {}
    st = (await _state()).get(str(pid)) or {}
    sk = {**(st.get("skip") or {}), **_skips(pid)}
    if sk and not st.get("skip_back"):
        t = await _table(pid, p)
        for slot, less in skipped_by_slot(t, {s: sum(float(r.grams_used or 0) for r in rs) for s, rs in rows.items()}, sk).items():
            for r in reversed(rows.get(slot) or []):
                cut = min(less, float(r.grams_used or 0))
                adj[r.id] = float(r.grams_used or 0) - cut
                less -= cut
                if less < 0.05:
                    break
    g_of = lambda r: adj.get(r.id, float(r.grams_used or 0))
    items = []
    for slot in sorted(rows):
        rs = rows[slot]
        planned = sum(g_of(r) for r in rs)
        u = used.get(slot, 0.0)
        for k, r in enumerate(rs):
            ru = min(_row_used(r, u), g_of(r))
            sp, fil = spools.get(r.spool_id, (None, None))
            rem = float(sp.remaining_weight_g) if sp and sp.remaining_weight_g is not None else None
            # le poids de la bobine juste avant le decompte du lancement (04/11/2026) : le decompte s'arrete a 0, et
            # « reste + prevu - consomme » repartait de 0 pour une bobine qui n'avait pas assez (55 g pour 230 prevus :
            # 175 g « maintenant ») ; on part donc de lui, et ce qui manquera se dit a part (short)
            bef = getattr(r, "spool_before_g", None)
            if bef is not None:
                now_g, tgt_g = float(bef) - ru, float(bef) - g_of(r)
            elif rem is not None:
                now_g, tgt_g = rem + float(r.grams_used or 0) - ru, rem + float(r.grams_used or 0) - g_of(r)
            else:
                now_g = tgt_g = None
            items.append({
                "slot": slot, "row": r.id, "spool_id": r.spool_id, "current": k == len(rs) - 1,
                "planned": round(planned, 1), "used": round(u, 1),
                "row_planned": round(g_of(r), 1), "row_used": round(ru, 1),
                "now": round(max(0.0, now_g), 1) if now_g is not None else None,
                "target": round(max(0.0, tgt_g), 1) if tgt_g is not None else None,
                "short": round(-tgt_g, 1) if tgt_g is not None and tgt_g < -0.5 else None,
                "source": src.get(slot, "estimate"), "color": r.color_hex, "type": r.filament_type,
                "name": (getattr(fil, "translated_name", None) or getattr(fil, "name", None) or "") if fil else "",
                "spool_full": float(fil.filament_weight_g) if fil and fil.filament_weight_g else None,
                # pour la tuile « Couleurs de l'impression » (03/11/2026) : l'emplacement, la marque, le sous-type, la finition
                "ams_tray": sp.ams_tray if sp else None, "brand": fil.manufacturer if fil else None,
                "sub": (fil.fila_type or fil.material) if fil else None, "finish": fil.fila_finish if fil else None,
                "colors": fil.colors_array if fil else None, "multicolor": fil.multicolor_type if fil else None,
                "fil_color": fil.color if fil else None,
            })
    return {"print_id": pid, "print_name": p.translated_name or p.file_name, "layer": prog.get("layer"), "pct": prog.get("pct"),
            "items": items, "skipped": await skipped(pid)}


async def current_print_id() -> Optional[int]:
    from ..models.print_history import Print
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(Print.id).where(Print.status == "IN_PROGRESS")
                                 .order_by(Print.id.desc()).limit(1))).scalar()
