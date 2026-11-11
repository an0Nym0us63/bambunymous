"""
Le dessin de la couche en cours (02/11/2026) : les tracés de chaque filament sur une couche, lus dans le G-code du 3MF
tranche (deja garde dans prints/{id}/). Affichage seulement : rien n'est ecrit, et ca marche quel que soit le suivi du
filament choisi dans les Parametres.

Le G-code est decompresse une fois par impression (garde en memoire pour l'impression affichee) ; les couches y sont
reperees par leurs marqueurs « M73 L<n> » et les changements de filament « T<n> », par une simple recherche. Une couche
demandee ne relit que son passage : ses extrusions (G1/G2/G3 avec E > 0) deviennent des polylignes par filament, en
dixiemes de millimetre.
"""
from __future__ import annotations

import asyncio
import bisect
import math
import os
import re
import zipfile
from pathlib import Path
from typing import Optional

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
_CACHE: dict = {}          # print_id -> {"raw", "L", "O", "P", "Tpos", "Tval"} : une seule impression a la fois

_LAYER = re.compile(rb"(?m)^M73 L(\d+)")
_PCT = re.compile(rb"(?m)^M73 P(\d+)")
_TOOL = re.compile(rb"(?m)^T(\d+)")
_NUM = re.compile(rb"([XYZEIJ])(-?\d*\.?\d+)")
_OBJ = re.compile(rb"(?m)^; (start|stop) printing object(?:, unique label id: (\d+))?")
_ZH = re.compile(rb"(?m)^; Z_HEIGHT: (-?\d*\.?\d+)")
# la vue 3D (05/11/2026) ne garde que le contour exterieur de chaque couche
_SHELL = (b"; FEATURE: Outer wall", b"; FEATURE: Overhang wall")


def _index(raw: bytes) -> dict:
    L, O = [], []
    for m in _LAYER.finditer(raw):
        L.append(int(m.group(1)))
        O.append(m.start())
    ppos, pval = [], []
    for m in _PCT.finditer(raw):
        ppos.append(m.start())
        pval.append(int(m.group(1)))
    tpos, tval = [], []
    for m in _TOOL.finditer(raw):
        n = int(m.group(1))
        if n < 255:
            tpos.append(m.start())
            tval.append(n)
    # l'avancement au debut de chaque couche (le dernier « M73 P » avant elle)
    P = [pval[i] if (i := bisect.bisect_right(ppos, o) - 1) >= 0 else 0 for o in O]
    # la piece qui s'imprime (05/11/2026) : pour griser une piece annulee
    opos, oval = [], []
    for m in _OBJ.finditer(raw):
        opos.append(m.start())
        oval.append(m.group(2).decode() if m.group(1) == b"start" and m.group(2) else None)
    # la hauteur de chaque couche (le dernier « ; Z_HEIGHT » avant elle), pour la vue 3D
    zpos, zval = [], []
    for m in _ZH.finditer(raw):
        zpos.append(m.start())
        zval.append(float(m.group(1)))
    Z = [zval[i] if (i := bisect.bisect_right(zpos, o) - 1) >= 0 else None for o in O]
    return {"raw": raw, "L": L, "O": O, "P": P, "Tpos": tpos, "Tval": tval, "Opos": opos, "Oval": oval, "Z": Z}


def _load(model_3mf: str, plate_id: str) -> Optional[dict]:
    with zipfile.ZipFile(DATA_DIR / model_3mf) as z:
        names = z.namelist()
        want = f"Metadata/plate_{plate_id or 1}.gcode"
        name = want if want in names else next((n for n in names if n.startswith("Metadata/plate_") and n.endswith(".gcode")), None)
        if not name:
            return None
        ix = _index(z.read(name))
    return ix if ix["L"] else None


def _paths(raw: bytes, a: int, b: int, tool: Optional[int], obj: Optional[str] = None,
           shell: bool = False) -> tuple[list, float, list]:
    """Les extrusions entre deux positions du fichier : ([{t, e0, p: [x, y, ...] en dixiemes de mm, o: la piece}],
    extrusion totale, boite [xmin, ymin, xmax, ymax])."""
    out, cur = [], None
    x = y = None
    absolute = True
    rel_e = True
    last_e = 0.0
    e_tot = 0.0
    box = [math.inf, math.inf, -math.inf, -math.inf]
    keep = not shell                                  # shell : seulement les parois exterieures (vue 3D)

    def put(px, py):
        q = (round(px * 10), round(py * 10))
        if cur["p"][-2:] != list(q):
            cur["p"].extend(q)
        box[0] = min(box[0], px); box[1] = min(box[1], py); box[2] = max(box[2], px); box[3] = max(box[3], py)

    for line in raw[a:b].split(b"\n"):
        if not line:
            continue
        c = line[0]
        if c == 59:                                   # ';' : le debut et la fin d'une piece
            if shell and line.startswith(b"; FEATURE:"):
                keep = line.startswith(_SHELL)
                cur = None
            elif line.startswith(b"; start printing object") or line.startswith(b"; stop printing object"):
                m = _OBJ.match(line)
                obj = m.group(2).decode() if m and m.group(1) == b"start" and m.group(2) else None
                cur = None
            continue
        if c == 84:                                   # 'T'
            m = _TOOL.match(line)
            if m and int(m.group(1)) < 255:
                tool = int(m.group(1)); cur = None
            continue
        if c == 77:                                   # 'M'
            if line.startswith(b"M83"): rel_e = True
            elif line.startswith(b"M82"): rel_e = False
            continue
        if c != 71:                                   # 'G'
            continue
        if line.startswith(b"G90"):
            absolute = True; continue
        if line.startswith(b"G91"):
            absolute = False; continue
        if line.startswith(b"G92"):
            for k, v in _NUM.findall(line.split(b";", 1)[0]):
                if k == b"E": last_e = float(v)
            continue
        g = line[:3]
        if g not in (b"G0 ", b"G1 ", b"G2 ", b"G3 ") and line not in (b"G0", b"G1"):
            continue
        vals = {k: float(v) for k, v in _NUM.findall(line.split(b";", 1)[0])}
        nx, ny = vals.get(b"X"), vals.get(b"Y")
        if not absolute:
            nx = (x or 0) + nx if nx is not None else x
            ny = (y or 0) + ny if ny is not None else y
        nx = x if nx is None else nx
        ny = y if ny is None else ny
        e = vals.get(b"E")
        de = 0.0
        if e is not None:
            de = e if rel_e else e - last_e
            if not rel_e: last_e = e
        if de > 0 and keep and tool is not None and x is not None and nx is not None and (nx != x or ny != y):
            if cur is None or cur["t"] != tool or cur["p"][-2:] != [round(x * 10), round(y * 10)]:
                cur = {"t": tool, "e0": round(e_tot, 2), "p": []}
                if obj is not None:
                    cur["o"] = obj
                out.append(cur)
                put(x, y)
            if g in (b"G2 ", b"G3 ") and (b"I" in vals or b"J" in vals):
                cx, cy = x + vals.get(b"I", 0.0), y + vals.get(b"J", 0.0)
                a0, a1 = math.atan2(y - cy, x - cx), math.atan2(ny - cy, nx - cx)
                r = math.hypot(x - cx, y - cy)
                if g == b"G2 ":                       # sens horaire
                    if a1 >= a0: a1 -= 2 * math.pi
                elif a1 <= a0: a1 += 2 * math.pi
                n = max(2, min(36, int(abs(a1 - a0) / (math.pi / 18)) + 1))
                for k in range(1, n):
                    t = a0 + (a1 - a0) * k / n
                    put(cx + r * math.cos(t), cy + r * math.sin(t))
            put(nx, ny)
            e_tot += de
        elif de <= 0 or nx != x or ny != y:
            if nx != x or ny != y:
                cur = None                            # un deplacement sans extrusion coupe la polyligne
        x, y = nx, ny
    return out, round(e_tot, 2), box


TOL = 1.5          # simplification des polylignes, en dixiemes de mm (le trait affiche en fait plusieurs)


def _simplify(pts: list, tol: float = TOL) -> list:
    """Douglas-Peucker sur [x, y, x, y, ...] (dixiemes de mm) : les points qui ne changent pas le dessin partent."""
    n = len(pts) // 2
    if n <= 2:
        return pts
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay, bx, by = pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1]
        dx, dy = bx - ax, by - ay
        d2 = dx * dx + dy * dy
        far, at = 0.0, -1
        for k in range(a + 1, b):
            px, py = pts[2 * k] - ax, pts[2 * k + 1] - ay
            if d2:
                cr = px * dy - py * dx
                dist = cr * cr / d2
            else:
                dist = px * px + py * py
            if dist > far:
                far, at = dist, k
        if at >= 0 and far > tol * tol:
            keep[at] = True
            stack += [(a, at), (at, b)]
    out = []
    for k in range(n):
        if keep[k]:
            out += [pts[2 * k], pts[2 * k + 1]]
    return out


def _deltas(pts: list) -> list:
    """Le premier point, puis les ecarts : des nombres courts (la page refait la somme)."""
    out = pts[:2]
    for k in range(2, len(pts), 2):
        out += [pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]]
    return out


async def _get(pid: int, p) -> Optional[dict]:
    hit = _CACHE.get(pid)
    if hit is not None:
        return hit
    if p is None or not p.model_3mf:
        return None
    ix = await asyncio.to_thread(_load, p.model_3mf, p.plate_id or "1")
    _CACHE.clear()                                    # une seule impression en memoire (quelques dizaines de Mo)
    _CACHE[pid] = ix
    return ix


def _tool_at(ix: dict, pos: int) -> Optional[int]:
    i = bisect.bisect_right(ix["Tpos"], pos) - 1
    # (11/11/2026) aucun « T<n> » dans tout le fichier : un print a un seul filament (profil sans AMS) n'en a souvent
    # aucun, et rien ne sortait (couche vide, vue 3D vide) ; c'est alors le premier filament
    return ix["Tval"][i] if i >= 0 else (None if ix["Tval"] else 0)


def _obj_at(ix: dict, pos: int) -> Optional[str]:
    i = bisect.bisect_right(ix.get("Opos") or [], pos) - 1
    return ix["Oval"][i] if i >= 0 else None


async def layer(pid: int, p, n: Optional[int]) -> dict:
    """La couche n (sinon la premiere). Points : le premier en dixiemes de mm, puis les ecarts. La couche precedente
    (le fantome), la page l'a deja. Pas de « part deja imprimee » de la couche (02/11/2026) : l'ordre des traces est
    connu, pas le temps que prend chacun ; l'estimer aurait ete souvent faux."""
    ix = await _get(pid, p)
    if not ix:
        return {"ok": False}
    L, O, P = ix["L"], ix["O"], ix["P"]
    n = n if n is not None else L[0]
    i = max(0, min(len(L) - 1, bisect.bisect_right(L, n) - 1))
    raw = ix["raw"]

    def one(j):
        a = O[j]
        b = O[j + 1] if j + 1 < len(O) else len(raw)
        return _paths(raw, a, b, _tool_at(ix, a), _obj_at(ix, a))

    def lean(j):
        ps, e, bx = one(j)
        return [{"t": q["t"], "e0": q["e0"], "p": _deltas(_simplify(q["p"])), **({"o": q["o"]} if "o" in q else {})}
                for q in ps], e, bx

    paths, e_tot, box = await asyncio.to_thread(lean, i)
    return {"ok": True, "layer": L[i], "first": L[0], "last": L[-1], "count": len(L), "e_total": e_tot,
            "box": [round(v, 1) for v in box] if math.isfinite(box[0]) else None, "paths": paths}


SHELL_LAYERS = 240     # au-dela, une couche sur deux (trois...) : la forme reste, le poids non
SHELL_POINTS = 40000   # points envoyes au plus (quelques centaines de Ko)


def _shell_file(pid: int) -> Path:
    return DATA_DIR / "prints" / str(pid) / "layer_shell.json.gz"


def _shell_disk(pid: int, p) -> Optional[dict]:
    """La vue gardee sur disque, si elle est plus recente que le 3MF tranche (refait, il la perime)."""
    import gzip
    import json
    f = _shell_file(pid)
    try:
        src = DATA_DIR / p.model_3mf if p is not None and p.model_3mf else None
        if not f.is_file() or (src is not None and src.is_file() and src.stat().st_mtime > f.stat().st_mtime):
            return None
        return json.loads(gzip.decompress(f.read_bytes()))
    except (OSError, ValueError):
        return None


def _shell_save(pid: int, res: dict) -> None:
    import gzip
    import json
    f = _shell_file(pid)
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        tmp.write_bytes(gzip.compress(json.dumps(res, separators=(",", ":")).encode("utf-8"), 5))
        tmp.replace(f)
    except OSError:
        pass


async def prepare(pid: int) -> None:
    """Au lancement d'une impression (06/11/2026) : sa vue 3D calculee d'avance, la tuile l'a des son ouverture."""
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    try:
        async with AsyncSessionLocal() as db:
            p = await db.get(Print, pid)
        if p is not None:
            await shell(pid, p)
    except Exception:
        pass


async def shell(pid: int, p) -> dict:
    """La vue 3D (05/11/2026) : le contour exterieur de chaque couche, a sa hauteur, lu dans le G-code (le 3MF envoye a
    l'imprimante n'a pas le maillage des pieces). Calcule une fois par impression. Points en dixiemes de mm, z en mm.
    (06/11/2026) gardee sur disque a cote de l'impression : un redemarrage, ou un coup d'oeil a une autre impression,
    obligeaient a relire tout le G-code (plusieurs secondes « Calcul de la vue 3D… »)."""
    hit = _CACHE.get(pid)
    if hit is not None and hit.get("shell"):
        return hit["shell"]
    disk = await asyncio.to_thread(_shell_disk, pid, p)
    if disk is not None:
        return disk
    ix = await _get(pid, p)
    if not ix:
        return {"ok": False}
    if ix.get("shell"):
        return ix["shell"]
    L, O, Z, raw = ix["L"], ix["O"], ix["Z"], ix["raw"]

    def build():
        n = len(L)
        step = max(1, math.ceil(n / SHELL_LAYERS))
        got, box, zt = [], [math.inf, math.inf, -math.inf, -math.inf], 0.0
        for j in range(0, n, step):
            a = O[j]
            b = O[j + 1] if j + 1 < n else len(raw)
            ps, _e, bx = _paths(raw, a, b, _tool_at(ix, a), _obj_at(ix, a), shell=True)
            z = Z[j] if Z[j] is not None else (j + 1) * 0.2
            zt = max(zt, z)
            if math.isfinite(bx[0]):
                box = [min(box[0], bx[0]), min(box[1], bx[1]), max(box[2], bx[2]), max(box[3], bx[3])]
            got.append((L[j], z, ps))
        # un plafond de points (une piece tres detaillee pesait 1 Mo) : la simplification grossit jusqu'a y tenir
        for tol in (4.0, 8.0, 16.0, 32.0, 64.0):
            out, pts_n = [], 0
            for nl, z, ps in got:
                lay = []
                for q in ps:
                    pts = _simplify(q["p"], tol)
                    # au-dela du premier essai, les bribes (plus courtes que 3 fois la tolerance) partent : une paroi
                    # decoupee en milliers de segments de deux points ne dessine rien de plus
                    if len(pts) >= 4 and (tol == 4.0 or len(pts) > 4 or abs(pts[2] - pts[0]) + abs(pts[3] - pts[1]) >= 3 * tol):
                        pts_n += len(pts) // 2
                        lay.append({"t": q["t"], "p": _deltas(pts), **({"o": q["o"]} if "o" in q else {})})
                out.append({"n": nl, "z": round(z, 2), "paths": lay})
            if pts_n <= SHELL_POINTS:
                break
        return {"ok": True, "layers": out, "first": L[0], "last": L[-1], "step": step, "ztop": round(zt, 2),
                "box": [round(v, 1) for v in box] if math.isfinite(box[0]) else None}

    res = await asyncio.to_thread(build)
    ix["shell"] = res
    if res.get("ok"):
        await asyncio.to_thread(_shell_save, pid, res)
    return res


def forget(pid: Optional[int] = None) -> None:
    if pid is None or pid in _CACHE:
        _CACHE.clear()
