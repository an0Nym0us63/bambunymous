"""Regrouper des plateaux d'un meme modele sur un seul plateau d'impression (06/11/2026).

Quatre echantillons de quatre couleurs, trois plateaux d'un meme objet : imprimes ensemble, un seul lancement (une
chauffe, une calibration, une purge) au lieu de plusieurs. Seulement entre plateaux d'un meme modele et d'un meme profil
(ses plateaux, ses exemplaires, ses variantes de couleur) : pas de copier-coller d'objets entre projets dans Bambu Studio.

Ce que l'on sait, sans trancher : la taille de chaque plateau (la vue 3D l'a mesuree : largeur, profondeur, hauteur de
l'ensemble de ses objets, gardes tels qu'ils sont poses), le plateau d'impression (le 3MF du profil : sa surface, le mode
d'impression, les degagements de la tete). On cherche a ranger les plateaux cote a cote (rangees, rotation permise) :
  - couche par couche : un espacement de 5 mm ;
  - objet par objet (comme le profil) : tous sauf le plus haut sous la tige (extruder_clearance_height_to_rod), le plus
    haut sous le capot, et un degagement de tete entre chacun (extruder_clearance_dist_to_rod).
La confiance : elevee quand tout tient avec de la marge (surface occupee <= 60 %), moyenne quand ca tient juste. Le
regroupement reste a faire dans Bambu Studio ; l'appli le prevoit et le reconnait ensuite.
"""
import json
import logging
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

PREP_S = 360            # ce qu'un lancement coute en plus (chauffe, calibration, purge) : gagne a chaque plateau regroupe
GAP_LAYER = 5.0         # mm entre deux plateaux regroupes, couche par couche
_PROF: dict = {}


def _profile_3mf(did, iid):
    try:
        from .mw_source import print_file
        return print_file(did, iid)
    except Exception:
        return None


def profile_info(did, iid) -> dict | None:
    """Ce qu'il faut savoir du profil : surface du plateau, mode, degagements, et la taille de chacun de ses plateaux."""
    key = (str(did), str(iid))
    if key in _PROF:
        return _PROF[key]
    out = None
    f = _profile_3mf(did, iid)
    try:
        if f and Path(f).is_file():
            with zipfile.ZipFile(f) as z:
                ps = json.loads(z.read("Metadata/project_settings.config"))
            area = [tuple(float(v) for v in str(p).split("x")) for p in ps.get("printable_area") or []]
            W = max((a[0] for a in area), default=256.0) - min((a[0] for a in area), default=0.0)
            H = max((a[1] for a in area), default=256.0) - min((a[1] for a in area), default=0.0)
            num = lambda k, dflt: float((ps.get(k)[0] if isinstance(ps.get(k), list) else ps.get(k)) or dflt)
            sizes = {}
            from .mw_3d import _root
            mf = _root() / str(iid) / "plates.json"
            if mf.is_file():
                for p in json.loads(mf.read_text(encoding="utf-8")).get("plates") or []:
                    if p.get("size_mm") and not p.get("assembled"):
                        sizes[int(p["n"])] = [float(x) for x in p["size_mm"]]
            out = {"W": W, "H": H, "seq": str(ps.get("print_sequence") or "by layer"), "sizes": sizes,
                   "rod_h": num("extruder_clearance_height_to_rod", 40), "lid_h": num("extruder_clearance_height_to_lid", 200),
                   "rod_d": num("extruder_clearance_dist_to_rod", 50)}
    except Exception:
        logger.exception("[REGROUPER] profil illisible")
        out = None
    if len(_PROF) > 300:
        _PROF.clear()
    _PROF[key] = out
    return out


def pack(rects: list, W: float, H: float, gap: float):
    """Ranger des rectangles (l, p) par rangees, du plus grand au plus petit, chacun tourne si ca aide. Rend la surface
    occupee (0..1) si tout tient, sinon None."""
    items = sorted(rects, key=lambda r: -max(r))
    x = y = row_h = 0.0
    for a, b in items:
        placed = False
        for w, h in ((a, b), (b, a)):
            if w > W or h > H:
                continue
            if x + w <= W and y + h <= H:                      # dans la rangee
                x, row_h, placed = x + w + gap, max(row_h, h), True
                break
            if y + row_h + gap + h <= H and w <= W:            # une nouvelle rangee
                y, x, row_h, placed = y + row_h + gap, w + gap, h, True
                break
        if not placed:
            return None
    return sum(a * b for a, b in rects) / (W * H)


def fits(info: dict, plates: list):
    """Ces plateaux (leurs numeros) tiennent-ils ensemble ? (confiance « haute » | « moyenne », mode) ou (None, mode)."""
    sz = [info["sizes"].get(n) for n in plates]
    if not sz or any(s is None for s in sz):
        return None, None
    by_obj = info["seq"].replace("_", " ").startswith("by object")
    if by_obj:
        hs = sorted(s[2] for s in sz)
        if hs[-1] > info["lid_h"] or any(h > info["rod_h"] for h in hs[:-1]):
            return None, "objet par objet"
        gap = info["rod_d"]
    else:
        gap = GAP_LAYER
    used = pack([(s[0], s[1]) for s in sz], info["W"] - 10, info["H"] - 10, gap)   # 5 mm de bord
    if used is None:
        return None, "objet par objet" if by_obj else "couche par couche"
    return ("haute" if used <= 0.6 else "moyenne"), ("objet par objet" if by_obj else "couche par couche")


def proposals(jobs: list, slots: int, cap: int = 6) -> list:
    """Les regroupements possibles dans la file : par modele et profil, les plateaux libres (ni figes, ni au jour fige),
    du plus gros au plus petit, ajoutes tant qu'ils tiennent et que leurs filaments tiennent dans l'AMS.
    [{keys, plates, design_id, title, conf, mode, saved_s, seconds}]"""
    by = {}
    for j in jobs:
        if j.get("pinned") or j.get("locked") or not j.get("retained", True) or j.get("merged") or not j.get("iid"):
            continue
        by.setdefault((j.get("mw_id") or str(j["design_id"]).split("~")[0], j["iid"]), []).append(j)
    out = []
    for (did, iid), js in by.items():
        if len(js) < 2:
            continue
        info = profile_info(did, iid)
        if not info:
            continue
        rest = sorted(js, key=lambda j: -((info["sizes"].get(j["plate"]) or [0, 0])[0] * (info["sizes"].get(j["plate"]) or [0, 0])[1]))
        while len(rest) >= 2:
            grp = [rest.pop(0)]
            conf = mode = None
            for j in list(rest):
                if len(grp) >= cap:
                    break
                fids = {f.get("filament_id") for x in grp + [j] for f in x["fils"] if f.get("filament_id")}
                if len(fids) > slots or (j.get("bed_want") and grp[0].get("bed_want") and j["bed_want"] != grp[0]["bed_want"]):
                    continue
                c, m = fits(info, [x["plate"] for x in grp + [j]])
                if c:
                    grp.append(j)
                    rest.remove(j)
                    conf, mode = c, m
            if len(grp) >= 2:
                secs = sum(x["seconds"] for x in grp)
                out.append({"keys": [x["key"] for x in grp], "plates": [x["plate"] for x in grp], "design_id": grp[0]["design_id"],
                            "title": grp[0]["title"], "conf": conf, "mode": mode, "saved_s": PREP_S * (len(grp) - 1),
                            "seconds": max(60, secs - PREP_S * (len(grp) - 1))})
    return out
