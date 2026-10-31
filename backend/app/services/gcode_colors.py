"""
Les couleurs d'une impression lues dans son G-code (31/10/2026).

Un 3MF tranche (celui envoye a l'imprimante) ne garde aucune geometrie : seulement le G-code de son plateau. Mais
ce G-code dit, trait par trait, quel filament la buse depose et ou. On en tire un nuage de points colores (les
parois, les dessus et dessous, le remplissage plein ; jamais les supports, la tour de purge, la jupe ni la bordure),
puis, pour chaque objet du 3MF d'origine, la facon dont il a ete pose sur ce plateau (deplace, tourne : l'ordre
« Arranger » de Bambu Studio le fait souvent) en comparant sa silhouette vue de dessus a celle du G-code. Chaque
triangle prend alors la couleur du filament depose contre lui : l'oeil peint en noir dans Bambu Studio sort noir.
"""
import logging
import math
import re
import zipfile
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

STEP = 0.4               # mm : un point tous les 0,4 mm le long d'un trait
VOX = np.array([0.4, 0.4, 0.1])   # mm : la grille des points, fine en hauteur (des couches de couleur de 0,2 mm)
GRID = 1.0               # mm : la grille des silhouettes (recherche grossiere)
FINE = 0.5               # mm : la grille de l'ajustement fin
# les traits retenus : ceux qui dessinent la piece (pas les supports, ni la purge, ni la jupe, ni la bordure)
_SKIP = re.compile(r"support|prime|tower|skirt|brim|wipe|purge|flush|custom", re.I)
_NUM = re.compile(r"([XYZEIJ])(-?\d*\.?\d+)")


def _colors(z: zipfile.ZipFile) -> list:
    import json
    try:
        ps = json.loads(z.read("Metadata/project_settings.config"))
    except Exception:
        return []
    return [str(c or "").lstrip("#").upper()[:6] for c in ps.get("filament_colour") or []]


def read(sliced: Path) -> dict | None:
    """Le nuage de points colores du G-code d'un 3MF tranche : {pts (N,3), tool (N,), colors [hex], plate}.
    None : pas de G-code."""
    with zipfile.ZipFile(sliced) as z:
        gname = next((n for n in z.namelist() if re.fullmatch(r"Metadata/plate_\d+\.gcode", n)), None)
        if not gname:
            return None
        colors = _colors(z)
        text = z.read(gname).decode("utf-8", "replace")
    plate = int(re.search(r"plate_(\d+)", gname).group(1))
    xs, ys, zs, ts = [], [], [], []
    x = y = zc = 0.0
    tool, keep, rel_e, tower, lh = 0, True, True, False, 0.2
    for line in text.splitlines():
        if not line:
            continue
        c0 = line[0]
        if c0 == ";":
            if line.startswith("; FEATURE:"):
                keep = not _SKIP.search(line[10:]) and not tower
            elif line.startswith("; WIPE_TOWER_START") or line.startswith("; WIPE_TOWER_END"):
                tower = "START" in line                    # la tour de purge, d'un bout a l'autre
                keep = keep and not tower
            elif line.startswith("; LAYER_HEIGHT:"):
                try:
                    lh = float(line[15:].strip().replace(",", "."))
                except ValueError:
                    pass
            elif line.startswith(";Z:"):
                try:
                    zc = float(line[3:])
                except ValueError:
                    pass
            continue
        if c0 == "T":
            m = re.match(r"T(\d+)", line)
            if m and int(m.group(1)) < 64:
                tool = int(m.group(1))
            continue
        if c0 == "M":
            if line.startswith("M83"):
                rel_e = True
            elif line.startswith("M82"):
                rel_e = False
            continue
        if c0 != "G":
            continue
        code = line[1:3].rstrip(" ")
        if code not in ("0", "1", "2", "3"):
            continue
        body = line.split(";", 1)[0]
        v = dict(_NUM.findall(body))
        nx = float(v["X"]) if "X" in v else x
        ny = float(v["Y"]) if "Y" in v else y
        if "Z" in v:
            zc = float(v["Z"])
        e = float(v.get("E", 0) or 0)
        # un trait qui depose (pas un simple reamorcage sur place, ou la buse attend parfois au-dessus de la tour)
        if keep and code != "0" and e > 0 and (nx != x or ny != y):
            if code in ("2", "3") and ("I" in v or "J" in v):
                # un arc : centre (x + I, y + J), parcouru dans le sens horaire (G2) ou non (G3)
                cx, cy = x + float(v.get("I", 0) or 0), y + float(v.get("J", 0) or 0)
                a0, a1 = math.atan2(y - cy, x - cx), math.atan2(ny - cy, nx - cx)
                r = math.hypot(x - cx, y - cy)
                da = a1 - a0
                if code == "2" and da >= 0:
                    da -= 2 * math.pi
                if code == "3" and da <= 0:
                    da += 2 * math.pi
                n = max(1, int(abs(da) * r / STEP))
                for k in range(1, n + 1):
                    a = a0 + da * k / n
                    xs.append(cx + r * math.cos(a)); ys.append(cy + r * math.sin(a)); zs.append(zc - lh / 2); ts.append(tool)
            else:
                d = math.hypot(nx - x, ny - y)
                n = max(1, int(d / STEP))
                for k in range(1, n + 1):
                    f = k / n
                    xs.append(x + (nx - x) * f); ys.append(y + (ny - y) * f); zs.append(zc - lh / 2); ts.append(tool)
        x, y = nx, ny
    if not xs:
        return None
    pts = np.column_stack([np.asarray(xs, np.float32), np.asarray(ys, np.float32), np.asarray(zs, np.float32)])
    # chaque point est au milieu de sa couche (la hauteur notee est celle de son dessus)
    return {"pts": pts, "tool": np.asarray(ts, np.int16), "colors": colors, "plate": plate}


class Cloud:
    """Le nuage du G-code, range en cases de VOX mm : le filament le plus proche d'un point de la surface."""

    def __init__(self, g: dict):
        p = g["pts"].astype(np.float64)
        self.lo = p.min(axis=0) - 2
        q = np.floor((p - self.lo) / VOX).astype(np.int64)
        self.dim = q.max(axis=0) + 3
        key = (q[:, 0] * self.dim[1] + q[:, 1]) * self.dim[2] + q[:, 2]
        order = np.argsort(key, kind="stable")
        key, tools = key[order], g["tool"][order]
        uniq, first = np.unique(key, return_index=True)
        self.keys, self.tools = uniq, tools[first]
        # la silhouette vue de dessus, pour retrouver ou chaque objet a ete pose
        self.xy = p[:, :2]
        self.zmax = float(p[:, 2].max())

    def tool_at(self, pts: np.ndarray, reach: float = 1.0) -> np.ndarray:
        """Le filament de la case la plus proche de chaque point (a reach mm au plus) ; -1 : rien autour."""
        q = np.floor((pts - self.lo) / VOX).astype(np.int64)
        best = np.full(len(pts), -1, np.int16)
        bd = np.full(len(pts), np.inf)
        rx, rz = int(math.ceil(reach / VOX[0])), int(math.ceil(min(reach, 0.6) / VOX[2]))
        offs = [(i, j, k) for i in range(-rx, rx + 1) for j in range(-rx, rx + 1) for k in range(-rz, rz + 1)]
        dist = lambda o: (o[0] * VOX[0]) ** 2 + (o[1] * VOX[1]) ** 2 + (o[2] * VOX[2]) ** 2
        offs = [o for o in offs if dist(o) <= reach * reach]
        offs.sort(key=dist)
        for i, j, k in offs:
            d2 = dist((i, j, k))
            todo = bd > d2
            if not todo.any():
                break
            qq = q[todo] + (i, j, k)
            ok = (qq >= 0).all(axis=1) & (qq < self.dim).all(axis=1)
            key = (qq[:, 0] * self.dim[1] + qq[:, 1]) * self.dim[2] + qq[:, 2]
            pos = np.searchsorted(self.keys, key)
            pos = np.minimum(pos, len(self.keys) - 1)
            hit = ok & (self.keys[pos] == key)
            idx = np.flatnonzero(todo)[hit]
            best[idx] = self.tools[pos[hit]]
            bd[idx] = d2
        return best


def _raster(xy: np.ndarray, lo: np.ndarray, shape: tuple, cell: float, grow: int = 1) -> np.ndarray:
    g = np.zeros(shape, np.float32)
    q = np.floor((xy - lo) / cell).astype(np.int64)
    ok = (q[:, 0] >= 0) & (q[:, 1] >= 0) & (q[:, 0] < shape[0]) & (q[:, 1] < shape[1])
    g[q[ok, 0], q[ok, 1]] = 1
    for _ in range(grow):                                  # bouche les trous entre les points
        g = np.maximum.reduce([g, np.roll(g, 1, 0), np.roll(g, -1, 0), np.roll(g, 1, 1), np.roll(g, -1, 1)])
    return g


def _uniq(xy: np.ndarray, cell: float) -> np.ndarray:
    """Un point par case de cell mm (un tri sur une seule cle : np.unique par lignes est tres lent)."""
    q = np.round(xy / cell).astype(np.int64)
    q -= q.min(axis=0)
    k = np.unique(q[:, 0] * (int(q[:, 1].max()) + 1) + q[:, 1])
    w = int(q[:, 1].max()) + 1
    return (np.column_stack([k // w, k % w]) + np.round(xy / cell).astype(np.int64).min(axis=0)) * cell


def _surface_xy(v: np.ndarray, t: np.ndarray, cell: float) -> np.ndarray:
    """Des points qui couvrent la silhouette d'un maillage vu de dessus (sommets, et l'interieur des grands triangles)."""
    a, b, c = v[t[:, 0], :2], v[t[:, 1], :2], v[t[:, 2], :2]
    out = [_uniq(v[:, :2], cell / 4)]
    if len(t) > 300_000:                                   # un maillage fin : ses sommets couvrent deja tout
        return out[0]
    size = np.maximum(np.linalg.norm(b - a, axis=1), np.linalg.norm(c - a, axis=1))
    big = size > cell
    if big.any():
        n = int(min(12, math.ceil(size[big].max() / cell)))
        w = [(i / n, j / n) for i in range(n + 1) for j in range(n + 1 - i)]
        for u, s in w:
            out.append(a[big] + (b[big] - a[big]) * u + (c[big] - a[big]) * s)
    return np.concatenate(out)


def place(cloud: Cloud, v: np.ndarray, t: np.ndarray) -> tuple | None:
    """Ou cet objet (ses sommets, deja poses sur le plateau d'origine) se trouve dans le G-code : (matrice 4x4 du
    plateau d'origine vers celui du G-code, score 0..1). Une rotation autour de la verticale et un deplacement sur le
    plateau ; None : il n'y est pas (score trop bas)."""
    oxy = _surface_xy(v, t, GRID)
    # une silhouette de quelques milliers de points (un maillage fin en donnait des millions, tournes 90 fois)
    oxy = _uniq(oxy, FINE / 2)
    c0 = (oxy.min(axis=0) + oxy.max(axis=0)) / 2
    rel = oxy - c0
    span = float(np.abs(rel).max()) + 3
    glo = cloud.xy.min(axis=0) - span - 2
    ghi = cloud.xy.max(axis=0) + span + 2

    def search(cell, angles, near=None):
        shape = tuple(np.ceil((ghi - glo) / cell).astype(int) + 1)
        occ = _raster(cloud.xy, glo, shape, cell, grow=1 if cell >= 1 else 2)
        target = 2 * occ - 1                               # un vide sous l'objet compte contre
        F = np.fft.rfft2(target)
        best, per = (-1e9, 0, 0, 0), []
        for ang in angles:
            ca, sa = math.cos(ang), math.sin(ang)
            r = rel @ np.array([[ca, sa], [-sa, ca]])
            m = _raster(r + span, np.zeros(2), shape, cell, grow=0)
            area = float(m.sum())
            if area < 4:
                continue
            # correlation : le score d'un decalage = ce que l'objet recouvre de plein, moins ce qu'il recouvre de vide
            corr = np.fft.irfft2(F * np.conj(np.fft.rfft2(m)), s=shape) / area
            if near is not None:                           # l'ajustement fin reste pres du premier resultat
                ii, jj = np.indices(shape)
                corr = np.where((np.abs(ii - near[0] / cell) <= 6) & (np.abs(jj - near[1] / cell) <= 6), corr, -1e9)
            k = int(np.argmax(corr))
            i, j = divmod(k, shape[1])
            cand = (float(corr[i, j]), ang, i * cell, j * cell)
            per.append(cand)
            if cand[0] > best[0]:
                best = cand
        return best, per

    def matrix(ang, dx, dy):
        # ou va le centre : glo + decalage + span (le masque de l'objet etait pose a span de son coin)
        to = glo + np.array([dx, dy]) + span
        ca, sa = math.cos(ang), math.sin(ang)
        R = np.array([[ca, sa, 0], [-sa, ca, 0], [0, 0, 1]])  # sommets en ligne : p' = p @ R
        M = np.eye(4)
        M[:3, :3] = R
        M[3, :2] = to - np.array([c0[0], c0[1]]) @ R[:2, :2]
        return M

    (sc, _a, _x, _y), per = search(GRID, [math.radians(a) for a in range(0, 360, 4)])
    if sc < 0.55:
        return None
    # vue de dessus, une forme symetrique (un rectangle) va aussi bien a l'endroit qu'a l'envers : les angles presque
    # aussi bons sont departages par le relief (la part de la surface qui touche les traits deposes), puis le plus droit
    cands, seen = [], []
    for c in sorted(per, key=lambda c: -c[0]):
        if c[0] < sc - 0.03 or len(cands) >= 6:
            break
        if any(abs((c[1] - a + math.pi) % (2 * math.pi) - math.pi) < math.radians(10) for a in seen):
            continue
        seen.append(c[1])
        cands.append(c)
    rng = np.random.default_rng(1)
    pick = t[rng.choice(len(t), min(len(t), 20000), replace=False)]
    cen = (v[pick[:, 0]] + v[pick[:, 1]] + v[pick[:, 2]]) / 3
    best = None
    for _s, ang, dx, dy in cands:
        (s2, a2, x2, y2), _p = search(FINE, [ang + math.radians(a) for a in np.arange(-4, 4.01, 1.0)], near=(dx, dy))
        if s2 < 0.6:
            continue
        M = matrix(a2, x2, y2)
        cg = cen @ M[:3, :3] + M[3, :3]
        cg[:, 2] += 0.1
        fit = float((cloud.tool_at(cg, reach=0.5) >= 0).mean())
        turn = abs((a2 + math.pi) % (2 * math.pi) - math.pi)
        key = (round(fit, 2), round(s2, 2), -turn)
        if best is None or key > best[0]:
            best = (key, M, s2)
    if best is None:
        return None
    return best[1], best[2]


def recolor(cloud: Cloud, v_plate: np.ndarray, tris: np.ndarray, M: np.ndarray, flip: bool = False) -> np.ndarray:
    """Le filament (numero d'outil) de chaque triangle : celui depose au plus pres d'un point pris juste sous sa
    surface, cote matiere (une face entre deux couches de couleur prend la sienne) ; -1 : rien de proche.
    flip : les triangles tournent a l'envers (une piece en miroir), leur normale aussi."""
    a, b, c = v_plate[tris[:, 0]], v_plate[tris[:, 1]], v_plate[tris[:, 2]]
    n = np.cross(b - a, c - a)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    if flip:
        n = -n
    p = (a + b + c) / 3 - n * 0.12
    cg = p @ M[:3, :3] + M[3, :3]
    return cloud.tool_at(cg, reach=1.0)
