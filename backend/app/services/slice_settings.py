"""
Les reglages d'un 3MF, en clair (13/11/2026) : la fiche d'une impression ouvre « Detail des reglages », une synthese de
ce que Bambu Studio a regle (parois, remplissage, couches, supports, buses gauche et droite, filaments et leurs
temperatures, retraction, changements de filament, vitesses...).

D'ou viennent les valeurs (3MF tranche de Bambu Studio 2.x) :
- Metadata/project_settings.config : tout le profil, en JSON. Certaines valeurs sont des listes :
  * une par variante d'extrudeuse (print_extruder_variant / printer_extruder_variant : « Direct Drive Standard »,
    « Direct Drive High Flow »...), rangees extrudeuse par extrudeuse (extruder_variant_list dit combien chacune en a) ;
    la bonne est celle du type de buse monte (extruder_type + nozzle_volume_type) ;
  * une par filament et par variante (filament_self_index dit a quel filament appartient chaque case) ;
  * une par filament (filament_type, filament_colour, filament_settings_id...).
- Metadata/slice_info.config : le plateau tranche (duree, poids, filaments utilises, sur quelle buse : filament_maps,
  1 = gauche, 2 = droite, comme dans Bambu Studio).
- Metadata/plate_N.gcode : le nombre de couches et de changements de filament (« ; CP TOOLCHANGE START »).
"""
from __future__ import annotations

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

_CACHE: dict = {}

PATTERNS = {
    "gyroid": "Gyroïde", "grid": "Grille", "honeycomb": "Nid d'abeille", "3dhoneycomb": "Nid d'abeille 3D", "cubic": "Cubique",
    "adaptivecube": "Cubique adaptatif", "supportcubic": "Cubique de support", "quartercubic": "Quart cubique", "line": "Lignes",
    "zig-zag": "Zigzag", "crosshatch": "Croisillons", "crosszag": "Zigzag croisé", "lockedzag": "Zigzag verrouillé",
    "lightning": "Éclair", "rectilinear": "Rectiligne", "alignedrectilinear": "Rectiligne aligné", "triangles": "Triangles",
    "tri-hexagon": "Tri-hexagone", "concentric": "Concentrique", "hilbertcurve": "Courbe de Hilbert",
    "archimedeanchords": "Cordes d'Archimède", "octagramspiral": "Spirale octogramme", "monotonic": "Monotone",
    "monotonicline": "Ligne monotone"}
SEAM = {"aligned": "Alignée", "nearest": "La plus proche", "back": "Arrière", "random": "Aléatoire"}
SUPPORT_TYPE = {"normal(auto)": "Normal (auto)", "tree(auto)": "Arborescent (auto)", "normal(manual)": "Normal (manuel)",
                "tree(manual)": "Arborescent (manuel)"}
SUPPORT_STYLE = {"default": "Par défaut", "grid": "Grille", "snug": "Ajusté", "tree_slim": "Arbre fin", "tree_strong": "Arbre solide",
                 "tree_hybrid": "Arbre hybride", "organic": "Organique"}
BRIM = {"auto_brim": "Auto", "no_brim": "Aucune", "outer_only": "Extérieure", "inner_only": "Intérieure",
        "outer_and_inner": "Intérieure et extérieure", "brim_ears": "Oreilles", "painted": "Peinte"}
IRONING = {"no ironing": "Non", "top": "Surfaces du dessus", "topmost": "Dernière surface du dessus", "solid": "Toutes les surfaces pleines"}
WALLGEN = {"classic": "Classique", "arachne": "Arachne"}
WALLSEQ = {"inner wall/outer wall": "Intérieure puis extérieure", "outer wall/inner wall": "Extérieure puis intérieure",
           "inner-outer-inner wall": "Intérieure, extérieure, intérieure"}
SEQUENCE = {"by layer": "Couche par couche", "by object": "Objet par objet"}
FUZZY = {"none": "Non", "external": "Parois extérieures", "all": "Toutes les parois", "allwalls": "Toutes les parois"}
BED_KEYS = {"cool plate": "cool_plate_temp", "engineering plate": "eng_plate_temp", "high temp plate": "hot_plate_temp",
            "textured pei plate": "textured_plate_temp", "supertack plate": "supertack_plate_temp",
            "textured cool plate": "textured_cool_plate_temp"}


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _num(v):
    try:
        f = float(str(v).replace(",", ".").rstrip("%"))
        return int(f) if f == int(f) else round(f, 3)
    except (TypeError, ValueError):
        return v


class _Cfg:
    """Lit project_settings en tenant compte des listes par variante d'extrudeuse et par filament."""

    def __init__(self, ps: dict):
        self.ps = ps
        self.n_ext = max(1, len(ps.get("nozzle_diameter") or [1]))
        evl = ps.get("extruder_variant_list") or []
        types, vols = ps.get("extruder_type") or [], ps.get("nozzle_volume_type") or []
        self.ext_variant = []          # la variante montee, par extrudeuse
        self.idx = {}                  # nom de la liste de variantes -> l'index par extrudeuse
        for k in range(self.n_ext):
            t = types[k] if k < len(types) else (types[0] if types else "DirectDrive")
            v = vols[k] if k < len(vols) else (vols[0] if vols else "Standard")
            self.ext_variant.append(_norm(f"{t}{v}"))
        for key in ("print_extruder_variant", "printer_extruder_variant"):
            lst = ps.get(key) or []
            out, off = [], 0
            for k in range(self.n_ext):
                cnt = len(str(evl[k]).split(",")) if k < len(evl) else max(1, len(lst) // self.n_ext)
                block = lst[off:off + cnt]
                pos = next((i for i, x in enumerate(block) if _norm(x) == self.ext_variant[k]), 0)
                out.append(off + pos)
                off += cnt
            self.idx[key] = (len(lst), out)
        self.self_index = [str(x) for x in ps.get("filament_self_index") or []]
        self.fil_variant = [_norm(x) for x in ps.get("filament_extruder_variant") or []]

    def get(self, key, default=None):
        v = self.ps.get(key, default)
        return v[0] if isinstance(v, list) and v else v

    def ext(self, key, k: int):
        """Une valeur pour l'extrudeuse k (0 : gauche)."""
        v = self.ps.get(key)
        if not isinstance(v, list):
            return v
        if not v:
            return None
        for name in ("print_extruder_variant", "printer_extruder_variant"):
            n, out = self.idx.get(name, (0, []))
            if n and len(v) == n and k < len(out):
                return v[out[k]]
        if len(v) == self.n_ext:
            return v[min(k, len(v) - 1)]
        return v[0]

    def fil(self, key, f: int, k: int | None = None):
        """Une valeur pour le filament f (1-based), monte sur l'extrudeuse k."""
        v = self.ps.get(key)
        if not isinstance(v, list):
            return v
        if not v:
            return None
        if self.self_index and len(v) == len(self.self_index):
            want = self.ext_variant[k] if k is not None and k < len(self.ext_variant) else None
            cand = [i for i, s in enumerate(self.self_index) if s == str(f)]
            for i in cand:
                if want is None or (i < len(self.fil_variant) and self.fil_variant[i] == want):
                    return v[i]
            return v[cand[0]] if cand else v[0]
        return v[f - 1] if 0 < f <= len(v) else v[0]


def _plate_info(z: zipfile.ZipFile, plate: int | None):
    """(numero du plateau tranche, ses metadonnees, ses filaments) d'apres slice_info.config."""
    if "Metadata/slice_info.config" not in z.namelist():
        return plate, {}, [], []
    root = ET.fromstring(z.read("Metadata/slice_info.config"))
    plates = root.findall("plate")
    pick = None
    for pl in plates:
        meta = {m.get("key"): m.get("value") for m in pl.findall("metadata")}
        if plate is None or str(meta.get("index")) == str(plate):
            if pl.findall("filament") or pick is None:
                pick = (pl, meta)
            if plate is not None:
                break
    if not pick:
        return plate, {}, [], []
    pl, meta = pick
    fils = [dict(f.attrib) for f in pl.findall("filament")]
    nozzles = [dict(n.attrib) for n in pl.findall("nozzle")]
    return int(meta.get("index") or plate or 1), meta, fils, nozzles


def _gcode_facts(z: zipfile.ZipFile, plate: int) -> dict:
    name = f"Metadata/plate_{plate}.gcode"
    if name not in z.namelist():
        return {}
    layers, changes = None, 0
    with z.open(name) as fh:
        for raw in fh:
            if raw.startswith(b"; total layer number:") and layers is None:
                try:
                    layers = int(raw.split(b":")[1].strip())
                except ValueError:
                    pass
            elif raw.startswith(b"; CP TOOLCHANGE START"):
                changes += 1
    return {"layers": layers, "changes": changes}


def _fmt_h(sec) -> str | None:
    try:
        s = int(float(sec))
    except (TypeError, ValueError):
        return None
    h, m = s // 3600, s % 3600 // 60
    return f"{h} h {m:02d}" if h else f"{m} min"


def summarize(path: Path, plate: int | None = None) -> dict:
    st = path.stat()
    ck = (str(path), st.st_mtime, plate)
    if ck in _CACHE:
        return _CACHE[ck]
    with zipfile.ZipFile(path) as z:
        if "Metadata/project_settings.config" not in z.namelist():
            raise ValueError("3MF sans réglages de projet")
        ps = json.loads(z.read("Metadata/project_settings.config").decode("utf-8", "replace"))
        plate, meta, fils, nozzles = _plate_info(z, plate)
        gc = _gcode_facts(z, plate or 1)
        version = None
        if "Metadata/slice_info.config" in z.namelist():
            m = re.search(rb'X-BBL-Client-Version" value="([^"]+)"', z.read("Metadata/slice_info.config"))
            version = m.group(1).decode() if m else None
    c = _Cfg(ps)
    two = c.n_ext > 1
    side = (lambda k: ("Gauche", "Droite")[k] if two and k < 2 else "Buse")

    # la buse de chaque filament (1 : gauche, 2 : droite), d'apres le plateau sinon le projet
    maps = [x for x in str(meta.get("filament_maps") or "").split() if x.strip()] or [str(x) for x in ps.get("filament_map") or []]
    ext_of = lambda f: max(0, min(c.n_ext - 1, int(maps[f - 1]) - 1)) if 0 < f <= len(maps) and str(maps[f - 1]).isdigit() else 0

    bed = str(c.get("curr_bed_type") or "")
    bkey = BED_KEYS.get(bed.lower(), "hot_plate_temp")
    names = ps.get("filament_settings_id") or []
    used = []
    for f in fils:
        try:
            fid = int(f.get("id"))
        except (TypeError, ValueError):
            continue
        k = ext_of(fid)
        nm = str(names[fid - 1] if 0 < fid <= len(names) else f.get("type") or "")
        rl = c.fil("filament_retraction_length", fid, k)
        used.append({
            "id": fid, "name": nm.split(" @")[0].strip(), "type": f.get("type") or c.fil("filament_type", fid),
            "color": f.get("color") or c.fil("filament_colour", fid), "g": _num(f.get("used_g")), "m": _num(f.get("used_m")),
            "side": side(k), "ext": k, "support": f.get("used_for_support") == "true", "object": f.get("used_for_object") != "false",
            "temp": _num(c.fil("nozzle_temperature", fid, k)), "temp_first": _num(c.fil("nozzle_temperature_initial_layer", fid, k)),
            "bed": _num(c.fil(bkey, fid, k)), "bed_first": _num(c.fil(bkey + "_initial_layer", fid, k)),
            "retract": _num(rl) if rl not in (None, "nil", "") else None,
            "fan": _num(c.fil("fan_max_speed", fid, k)), "flow": _num(c.fil("filament_flow_ratio", fid, k)),
            "max_vol": _num(c.fil("filament_max_volumetric_speed", fid, k)),
        })
    used_ext = sorted({u["ext"] for u in used}) or list(range(c.n_ext))
    noz = []
    for k in range(c.n_ext):
        noz.append({"side": side(k), "used": k in used_ext, "diameter": _num(c.ext("nozzle_diameter", k)),
                    "flow": c.ext("nozzle_volume_type", k), "type": c.ext("nozzle_type", k),
                    "retract": _num(c.ext("retraction_length", k)), "z_hop": _num(c.ext("z_hop", k)),
                    "retract_speed": _num(c.ext("retraction_speed", k)),
                    "outer": _num(c.ext("outer_wall_speed", k)), "inner": _num(c.ext("inner_wall_speed", k)),
                    "infill": _num(c.ext("sparse_infill_speed", k)), "first": _num(c.ext("initial_layer_speed", k)),
                    "top": _num(c.ext("top_surface_speed", k)), "travel": _num(c.ext("travel_speed", k))})

    g = c.get
    T = lambda d, v: d.get(str(v), v) if v not in (None, "") else None
    yes = lambda v: None if v is None else ("Oui" if str(v) in ("1", "true") else "Non")
    mm = lambda v: None if v in (None, "") else f"{_num(v)} mm"
    sup_on = str(g("enable_support")) in ("1", "true")
    sections = [
        ["Profil", [["Réglage d'impression", g("print_settings_id")], ["Imprimante", g("printer_settings_id")],
                    ["Plateau", bed or None], ["Bambu Studio", version]]],
        ["Couches", [["Épaisseur de couche", mm(g("layer_height"))], ["Première couche", mm(g("initial_layer_print_height"))],
                     ["Largeur de ligne", mm(g("line_width"))], ["Nombre de couches", gc.get("layers")],
                     ["Ordre d'impression", T(SEQUENCE, g("print_sequence"))], ["Mode vase", yes(g("spiral_mode")) if str(g("spiral_mode")) == "1" else None]]],
        ["Parois", [["Parois", g("wall_loops")], ["Générateur", T(WALLGEN, g("wall_generator"))], ["Ordre des parois", T(WALLSEQ, g("wall_sequence"))],
                    ["Couture", T(SEAM, g("seam_position"))], ["Paroi extérieure précise", yes(g("precise_outer_wall"))],
                    ["Une seule paroi en haut", T({"none": "Non", "all top": "Toutes les surfaces du dessus", "topmost": "Dernière surface"}, g("only_one_wall_top")) if g("only_one_wall_top") not in (None, "0", "none") else None],
                    ["Surface floue", T(FUZZY, g("fuzzy_skin")) if g("fuzzy_skin") not in (None, "none") else None]]],
        ["Dessus et dessous", [["Couches du dessus", g("top_shell_layers")], ["Épaisseur du dessus", mm(g("top_shell_thickness"))],
                               ["Motif du dessus", T(PATTERNS, g("top_surface_pattern"))], ["Couches du dessous", g("bottom_shell_layers")],
                               ["Motif du dessous", T(PATTERNS, g("bottom_surface_pattern"))], ["Lissage", T(IRONING, g("ironing_type"))]]],
        ["Remplissage", [["Densité", g("sparse_infill_density")], ["Motif", T(PATTERNS, g("sparse_infill_pattern"))],
                         ["Remplissage plein interne", T(PATTERNS, g("internal_solid_infill_pattern"))]]],
        ["Supports", [["Supports", ("Oui" if sup_on else "Non") + (" (utilisés)" if meta.get("support_used") == "true" and sup_on else "")],
                      ["Type", T(SUPPORT_TYPE, g("support_type")) if sup_on else None], ["Style", T(SUPPORT_STYLE, g("support_style")) if sup_on else None],
                      ["Angle seuil", f"{g('support_threshold_angle')}°" if sup_on and g("support_threshold_angle") else None],
                      ["Sur le plateau seulement", yes(g("support_on_build_plate_only")) if sup_on else None],
                      ["Couches d'interface (haut / bas)", f"{g('support_interface_top_layers')} / {g('support_interface_bottom_layers')}" if sup_on else None]]],
        ["Adhérence", [["Bordure", T(BRIM, g("brim_type"))], ["Jupe (tours)", g("skirt_loops") if str(g("skirt_loops") or "0") != "0" else None],
                       ["Radeau (couches)", g("raft_layers") if str(g("raft_layers") or "0") != "0" else None]]],
        ["Changements de filament", [["Changements", gc.get("changes") if gc else None], ["Filaments utilisés", len(used) or None],
                                     ["Tour de purge", yes(g("enable_prime_tower"))],
                                     ["Largeur de la tour", mm(g("prime_tower_width")) if str(g("enable_prime_tower")) == "1" else None]]],
        ["Divers", [["Timelapse", T({"0": "Non", "1": "Fluide"}, g("timelapse_type"))], ["Lissage des arcs", yes(g("enable_arc_fitting"))],
                    ["Durée estimée", _fmt_h(meta.get("prediction"))], ["Poids", f"{_num(meta.get('weight'))} g" if meta.get("weight") else None]]],
    ]
    sections = [[t, [[k, v] for k, v in rows if v not in (None, "", [])]] for t, rows in sections]
    out = {"plate": plate, "two": two, "nozzles": noz, "filaments": used, "sections": [s for s in sections if s[1]]}
    _CACHE[ck] = out
    if len(_CACHE) > 64:
        _CACHE.pop(next(iter(_CACHE)))
    return out
