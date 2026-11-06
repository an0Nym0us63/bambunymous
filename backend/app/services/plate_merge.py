"""Regrouper des plateaux d'un meme modele sur un seul plateau d'impression (06/11/2026).

Quatre echantillons de quatre couleurs, trois plateaux d'un meme objet : imprimes ensemble, un seul lancement (une
chauffe, une calibration, une purge) au lieu de plusieurs. Seulement entre plateaux d'un meme modele et d'un meme profil
(ses plateaux, ses exemplaires, ses variantes de couleur) : pas de copier-coller d'objets entre projets dans Bambu Studio.

Ce que l'on sait, sans trancher : la taille de chaque plateau (la vue 3D l'a mesuree : largeur, profondeur, hauteur de
l'ensemble de ses objets, gardes tels qu'ils sont poses), le plateau d'impression (le 3MF du profil : sa surface, le mode
d'impression, les degagements de la tete). On cherche a ranger les plateaux cote a cote (rangees, rotation permise) :
  - couche par couche (seulement un seul et meme filament partout) : un espacement de 5 mm ;
  - objet par objet (seulement quand les plateaux n'ont pas les memes couleurs : couche par couche,
    chaque couche changerait de filament, le temps s'envolerait) : tous sauf le plus haut sous la tige
    (extruder_clearance_height_to_rod), le plus haut sous le capot, et entre deux objets le degagement de la tete
    (extruder_clearance_max_radius : 96 mm sur une H2C, 9 echantillons de 25 mm au plus, comme Bambu Studio).
La confiance : elevee quand tout tient avec de la marge (surface occupee <= 60 %), moyenne quand ca tient juste. Le
regroupement reste a faire dans Bambu Studio ; l'appli le prevoit et le reconnait ensuite.
"""
import json
import logging
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

PREP_S = 360            # ce qu'un lancement coute en plus (chauffe, calibration, purge) : gagne a chaque plateau regroupe
SWAP_S = 90             # un changement de filament entre deux objets de couleurs differentes (objet par objet)
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
            sizes, objs = {}, {}
            from .mw_3d import _root
            mf = _root() / str(iid) / "plates.json"
            if mf.is_file():
                for p in json.loads(mf.read_text(encoding="utf-8")).get("plates") or []:
                    if p.get("size_mm") and not p.get("assembled"):
                        sizes[int(p["n"])] = [float(x) for x in p["size_mm"]]
                        # ses objets (06/11/2026, vues 3D refaites depuis) : [x0, y0, x1, y1, hauteur]
                        if p.get("objects"):
                            objs[int(p["n"])] = [[float(v) for v in o] for o in p["objects"]]
            out = {"W": W, "H": H, "seq": str(ps.get("print_sequence") or "by layer"), "sizes": sizes, "objs": objs,
                   "rod_h": num("extruder_clearance_height_to_rod", 40), "lid_h": num("extruder_clearance_height_to_lid", 200),
                   "max_h": num("printable_height", 0) or num("extruder_clearance_height_to_lid", 200),
                   "rod_d": num("extruder_clearance_dist_to_rod", 50),
                   "head_r": num("extruder_clearance_max_radius", num("extruder_clearance_radius", 65))}
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


def _mixed(fils: list) -> bool:
    """Couche par couche seulement entre plateaux d'un seul et meme filament (06/11/2026) : des couleurs differentes,
    meme deja presentes sur un des plateaux, ajouteraient des changements d'outil a chaque couche."""
    return not (all(len(f) == 1 for f in fils) and len(set().union(*fils)) == 1)


def _objects(info: dict, n: int) -> list:
    """Les objets d'un plateau [(largeur, profondeur, hauteur)] : chacun, quand la vue 3D les a releves ; sinon le
    plateau entier comme un seul objet (sa boite)."""
    if info.get("objs", {}).get(n):
        return [(o[2] - o[0], o[3] - o[1], o[4]) for o in info["objs"][n]]
    s = info["sizes"].get(n)
    return [tuple(s)] if s else []


def _too_close(info: dict, n: int, gap: float) -> bool:
    """Objet par objet, les objets d'un meme plateau doivent deja s'ecarter du degagement de la tete : un plateau aux
    pieces serrees ne s'imprime pas objet par objet (Bambu Studio le refuse), il ne se regroupe donc pas ainsi."""
    os_ = info.get("objs", {}).get(n) or []
    for i in range(len(os_)):
        for j in range(i + 1, len(os_)):
            a, b = os_[i], os_[j]
            dx = max(b[0] - a[2], a[0] - b[2], 0)
            dy = max(b[1] - a[3], a[1] - b[3], 0)
            if max(dx, dy) < gap:
                return True
    return False


def fits(info: dict, plates: list, by_obj: bool = False):
    """Ces plateaux (leurs numeros) tiennent-ils ensemble ? (confiance « haute » | « moyenne », mode) ou (None, mode).
    by_obj : objet par objet d'office (des couleurs differentes). Chaque plateau entier (06/11/2026 : jamais une partie
    de ses objets, on ne saurait plus ce qui est fait), mais chacun de ses objets range a part, comme Bambu Studio."""
    sz = [info["sizes"].get(n) for n in plates]
    if not sz or any(s is None for s in sz):
        return None, None
    # objet par objet seulement pour des couleurs differentes (06/11/2026) : un seul et meme filament partout se regroupe
    # couche par couche, meme si le profil d'origine etait objet par objet
    obs = [o for n in plates for o in _objects(info, n)]
    if by_obj:
        if any(_too_close(info, n, info.get("head_r") or info["rod_d"]) for n in set(plates)):
            return None, "objet par objet"
        hs = sorted(o[2] for o in obs)
        # le dernier imprime peut monter jusqu'a la hauteur d'impression de la machine (06/11/2026 : 325 mm sur une H2C)
        if hs[-1] > info.get("max_h", info["lid_h"]) or any(h > info["rod_h"] for h in hs[:-1]):
            return None, "objet par objet"
        gap = info.get("head_r") or info["rod_d"]
    else:
        gap = GAP_LAYER
    used = pack([(o[0], o[1]) for o in obs], info["W"] - 10, info["H"] - 10, gap)   # 5 mm de bord
    if used is None:
        return None, "objet par objet" if by_obj else "couche par couche"
    return ("haute" if used <= 0.6 else "moyenne"), ("objet par objet" if by_obj else "couche par couche")


def proposals(jobs: list, slots: int, cap: int = 12) -> list:
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
                # d'autres couleurs que celles de chaque plateau : objet par objet, sinon chaque couche changerait de filament
                fo = [{f.get("filament_id") for f in x["fils"] if f.get("filament_id")} for x in grp + [j]]
                mixed = _mixed(fo)
                c, m = fits(info, [x["plate"] for x in grp + [j]], mixed)
                if c:
                    grp.append(j)
                    rest.remove(j)
                    conf, mode = c, m
            if len(grp) >= 2:
                secs = sum(x["seconds"] for x in grp)
                fo = [{f.get("filament_id") for f in x["fils"] if f.get("filament_id")} for x in grp]
                swaps = len(grp) - 1 if _mixed(fo) else 0
                saved = PREP_S * (len(grp) - 1) - SWAP_S * swaps
                if saved <= 0:
                    continue
                ts = [x["title"] for x in grp]
                title = ts[0] if len(set(ts)) == 1 else (lambda p: p[:p.rfind(" · ")] if " · " in p else p)(ts[0])
                # objet par objet, un objet plus haut que la tige (06/11/2026) : il passe, mais imprime en dernier (en
                # redescendant sur les autres, la tete butterait sur la tige) ; le conseil le dit
                last = None
                if mode == "objet par objet":
                    top = lambda x: max((o[2] for o in _objects(info, x["plate"])), default=0)
                    hi = max(grp, key=top)
                    h = top(hi)
                    if h > info["rod_h"]:
                        last = {"key": hi["key"], "plate": hi["plate"], "title": hi["title"], "h": round(h), "rod_h": round(info["rod_h"])}
                out.append({"keys": [x["key"] for x in grp], "plates": [x["plate"] for x in grp], "design_id": grp[0]["design_id"],
                            "title": title, "conf": conf, "mode": mode, "saved_s": saved, "colors": bool(swaps), "last": last,
                            "seconds": max(60, secs - saved)})
    # les plus rentables d'abord (06/11/2026 : onze echantillons passaient apres deux regroupements de quatre)
    return sorted(out, key=lambda p: (p["conf"] != "haute", -p["saved_s"]))
