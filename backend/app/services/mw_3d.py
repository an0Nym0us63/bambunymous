"""
Le modele en 3D (27/10/2026), pour la vue 3D de l'appli.

Source 1 : le 3MF d'origine MakerWorld garde ici (projet Bambu Studio). Converti une fois, cote serveur, en un
format binaire compact par plateau (les sommets et les triangles, regroupes par couleur de filament) : le
telephone n'a pas a lire des dizaines de Mo de XML. Rangement : DATA_DIR/mw_3d/<instance>/.

Source 2, en secours (un modele jamais imprime, ou dont le 3MF n'est pas encore garde) : l'apercu 3D public de
MakerWorld, un GLB par plateau (compresse Draco, sans couleurs), lu dans la fiche du profil.

Format binaire d'un plateau (petit-boutiste) : u32 nombre de groupes, puis pour chacun : u32 couleur RGBA,
u32 nombre de sommets, u32 nombre de triangles, float32 x,y,z par sommet (mm, Z vers le haut, plateau recentre
sur 0,0 et pose a z=0), uint32 trois indices par triangle.
"""
import json
import logging
import re
import struct
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

FORMAT_V = 1
MAX_TRIANGLES = 6_000_000              # au-dela, le plateau n'est pas converti (trop lourd pour un telephone)
_NUM = r"(-?[0-9.]+(?:[eE][-+]?[0-9]+)?)"
_VERTEX = re.compile(rb'<vertex\s+x="' + _NUM.encode() + rb'"\s+y="' + _NUM.encode() + rb'"\s+z="' + _NUM.encode() + rb'"')
_TRI = re.compile(rb'<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"')
_NOT_SHOWN = {"modifier_part", "negative_part", "support_blocker", "support_enforcer"}


def _root() -> Path:
    from ..core.config import settings
    return Path(settings.DATA_DIR) / "mw_3d"


# ── Lecture d'un 3MF ──────────────────────────────────────────────────────────────────────────────────────
def _attr(tag: str, name: str):
    m = re.search(r'\b' + re.escape(name) + r'="([^"]*)"', tag)
    return m.group(1) if m else None


def _matrix(s) -> list:
    """Transformation 3MF (12 nombres, ligne par ligne : p' = [x y z 1] * M) ; identite par defaut."""
    try:
        v = [float(x) for x in str(s).split()]
        if len(v) == 12:
            return v
    except (TypeError, ValueError):
        pass
    return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]


def _mul(a: list, b: list) -> list:
    """a puis b (point' = (point * a) * b)."""
    out = []
    for r in range(3):
        for c in range(3):
            out.append(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c])
    for c in range(3):
        out.append(a[9] * b[c] + a[10] * b[3 + c] + a[11] * b[6 + c] + b[9 + c])
    return out


def _objects(xml: str) -> dict:
    """Les objets d'un fichier .model : id -> {"mesh": (debut, fin) dans le texte, ou "components": [...], "pid"}."""
    out = {}
    for m in re.finditer(r"<object\b([^>]*)>(.*?)</object>", xml, re.S):
        head, body = m.group(1), m.group(2)
        oid = _attr(head, "id")
        if oid is None:
            continue
        o = {"pid": _attr(head, "pid"), "type": _attr(head, "type")}
        if "<mesh" in body:
            o["mesh"] = body
        comps = []
        for c in re.finditer(r"<component\b([^>]*)/?>", body):
            comps.append({"path": _attr(c.group(1), "p:path"), "objectid": _attr(c.group(1), "objectid"),
                          "transform": _matrix(_attr(c.group(1), "transform"))})
        if comps:
            o["components"] = comps
        out[oid] = o
    return out


def _mesh(body: str):
    """(sommets [x,y,z...], triangles [i,j,k...]) d'un maillage."""
    b = body.encode() if isinstance(body, str) else body
    verts = [float(x) for t in _VERTEX.findall(b) for x in t]
    tris = [int(x) for t in _TRI.findall(b) for x in t]
    return verts, tris


def _colors_of(z: zipfile.ZipFile) -> list:
    try:
        ps = json.loads(z.read("Metadata/project_settings.config"))
        return [c for c in ps.get("filament_colour") or [] if isinstance(c, str)]
    except Exception:
        return []


def _settings(z: zipfile.ZipFile) -> tuple:
    """(plateaux [(n, nom, [(object_id, instance)])], objets {id: {extruder, parts: {part_id: (extruder, type)}}})."""
    try:
        xml = z.read("Metadata/model_settings.config").decode("utf-8", "replace")
    except KeyError:
        return [], {}
    objs = {}
    for m in re.finditer(r'<object id="(\d+)">(.*?)</object>', xml, re.S):
        body = m.group(2)
        head = body.split("<part", 1)[0]
        ext = re.search(r'key="extruder" value="(\d+)"', head)
        parts = {}
        for p in re.finditer(r'<part id="(\d+)" subtype="([^"]*)">(.*?)</part>', body, re.S):
            e = re.search(r'key="extruder" value="(\d+)"', p.group(3))
            parts[p.group(1)] = (int(e.group(1)) if e else None, p.group(2))
        objs[m.group(1)] = {"extruder": int(ext.group(1)) if ext else 1, "parts": parts}
    plates = []
    for m in re.finditer(r"<plate>(.*?)</plate>", xml, re.S):
        body = m.group(1)
        n = re.search(r'key="plater_id" value="(\d+)"', body)
        name = re.search(r'key="plater_name" value="([^"]*)"', body)
        inst = [(a, int(b)) for a, b in re.findall(
            r'<model_instance>\s*<metadata key="object_id" value="(\d+)"/>\s*<metadata key="instance_id" value="(\d+)"/>', body)]
        if n:
            plates.append((int(n.group(1)), name.group(1) if name else "", inst))
    return sorted(plates), objs


def _hex_rgba(h) -> int:
    h = str(h or "").lstrip("#")
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return (r << 24) | (g << 16) | (b << 8) | 0xFF
    except (ValueError, IndexError):
        return 0xB4BCC8FF


def convert(src: Path, out_dir: Path) -> dict:
    """Le 3MF -> un fichier binaire par plateau, et plates.json. Rend {"plates": [{n, name, triangles}]}."""
    z = zipfile.ZipFile(src)
    names = set(z.namelist())
    root_xml = z.read("3D/3dmodel.model").decode("utf-8", "replace")
    root_objs = _objects(root_xml)
    files = {}                                         # chemin -> objets de ce fichier

    def objs_in(path):
        p = (path or "").lstrip("/")
        if not p:
            return root_objs
        if p not in files:
            files[p] = _objects(z.read(p).decode("utf-8", "replace")) if p in names else {}
        return files[p]
    colors = _colors_of(z)
    plates, settings = _settings(z)
    # les couleurs d'un vieux 3MF sans reglages Bambu : les groupes de couleur du fichier
    groups = {m.group(1): m.group(2) for m in re.finditer(r'<m:colorgroup id="(\d+)">\s*<m:color color="([^"]+)"', root_xml)}
    build = []
    for it in re.finditer(r"<item\b([^>]*)/?>", root_xml.split("<build", 1)[-1] if "<build" in root_xml else ""):
        build.append((_attr(it.group(1), "objectid"), _matrix(_attr(it.group(1), "transform"))))
    items_by_obj: dict = {}
    for oid, mt in build:
        items_by_obj.setdefault(oid, []).append(mt)
    if not plates:                                      # pas de plateaux decrits : tout sur un seul
        plates = [(1, "", [(oid, i) for oid, lst in items_by_obj.items() for i in range(len(lst))])]

    def parts_of(oid, mt):
        """(couleur, sommets transformes, triangles) de chaque piece visible d'un objet place."""
        o = root_objs.get(oid) or {}
        st = settings.get(oid) or {"extruder": 1, "parts": {}}
        out = []
        if "mesh" in o:
            ext = st["extruder"]
            col = colors[ext - 1] if 0 < ext <= len(colors) else groups.get(o.get("pid") or "", None)
            out.append((col, mt, o["mesh"]))
        for c in o.get("components") or []:
            pe, ptype = st["parts"].get(str(c["objectid"]), (None, "normal_part"))
            if ptype in _NOT_SHOWN:
                continue
            sub = objs_in(c["path"]).get(str(c["objectid"])) or {}
            if "mesh" not in sub:
                continue
            ext = pe or st["extruder"]
            col = colors[ext - 1] if 0 < ext <= len(colors) else groups.get(sub.get("pid") or "", None)
            out.append((col, _mul(c["transform"], mt), sub["mesh"]))
        return out

    out_dir.mkdir(parents=True, exist_ok=True)
    meta = {"v": FORMAT_V, "plates": []}
    for n, pname, inst in plates:
        groups_out: dict = {}                           # couleur -> [sommets, triangles]
        total = 0
        for oid, k in inst:
            mts = items_by_obj.get(oid) or []
            if k >= len(mts):
                continue
            for col, mt, body in parts_of(oid, mts[k]):
                v, t = _mesh(body)
                total += len(t) // 3
                if total > MAX_TRIANGLES:
                    break
                g = groups_out.setdefault(_hex_rgba(col), [[], []])
                base = len(g[0]) // 3
                a, b, c, d, e, f, h, i_, j, tx, ty, tz = mt
                xs, ys, zs = v[0::3], v[1::3], v[2::3]
                nx = [x * a + y * d + z_ * h + tx for x, y, z_ in zip(xs, ys, zs)]
                ny = [x * b + y * e + z_ * i_ + ty for x, y, z_ in zip(xs, ys, zs)]
                nz = [x * c + y * f + z_ * j + tz for x, y, z_ in zip(xs, ys, zs)]
                out_v = [0.0] * (len(nx) * 3)
                out_v[0::3], out_v[1::3], out_v[2::3] = nx, ny, nz
                g[0] += out_v
                g[1] += [k + base for k in t] if base else t
        if not groups_out or total > MAX_TRIANGLES:
            meta["plates"].append({"n": n, "name": pname, "triangles": total, "skipped": total > MAX_TRIANGLES})
            continue
        # recentre le plateau : au milieu en X et Y, pose sur z = 0
        xs = [c for g in groups_out.values() for c in g[0][0::3]]
        ys = [c for g in groups_out.values() for c in g[0][1::3]]
        zs = [c for g in groups_out.values() for c in g[0][2::3]]
        cx, cy, z0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)
        size = [max(xs) - min(xs), max(ys) - min(ys), max(zs) - z0]
        from array import array
        import gzip
        buf = bytearray(struct.pack("<I", len(groups_out)))
        for col, (v, t) in groups_out.items():
            v[0::3] = [x - cx for x in v[0::3]]
            v[1::3] = [y - cy for y in v[1::3]]
            v[2::3] = [z_ - z0 for z_ in v[2::3]]
            buf += struct.pack("<III", col, len(v) // 3, len(t) // 3)
            buf += array("f", v).tobytes()               # petit-boutiste sur les machines visees (x86, ARM)
            buf += array("I", t).tobytes()
        # compresse une fois pour toutes : servi tel quel (Content-Encoding: gzip), le telephone le recoit leger
        (out_dir / f"plate_{n}.bin").write_bytes(gzip.compress(bytes(buf), 1))
        meta["plates"].append({"n": n, "name": pname, "triangles": total, "size_mm": [round(s, 1) for s in size]})
    (out_dir / "plates.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


def from_3mf(src: Path, key: str) -> dict | None:
    """Le modele d'un 3MF garde, converti au besoin (et refait si le 3MF a change). None : rien a montrer."""
    d = _root() / key
    meta_f = d / "plates.json"
    try:
        if meta_f.is_file() and meta_f.stat().st_mtime >= src.stat().st_mtime:
            meta = json.loads(meta_f.read_text(encoding="utf-8"))
            if meta.get("v") == FORMAT_V:
                return meta
        return convert(src, d)
    except Exception as e:
        logger.warning(f"[3D] {src.name} non converti : {type(e).__name__}: {e}")
        return None


# ── Le secours : l'apercu 3D de MakerWorld ──────────────────────────────────────────────────────────────────
def from_makerworld(did: str, profile: str | None) -> dict | None:
    """Les GLB de l'apercu MakerWorld du profil (ou du profil par defaut), gardes ici. None : rien."""
    import io
    import requests
    from .makerworld import _get_json
    code, d = _get_json(f"/design-service/design/{did}")
    if not isinstance(d, dict):
        return None
    insts = [i for i in d.get("instances") or [] if isinstance(i, dict)]
    inst = next((i for i in insts if profile and str(i.get("profileId")) == str(profile)), None) \
        or next((i for i in insts if i.get("id") == d.get("defaultInstanceId")), None) or (insts[0] if insts else None)
    if inst is None:
        return None
    lst = ((inst.get("extention") or {}).get("extensionModelFileList") or []) if isinstance(inst.get("extention"), dict) else []
    url = next((x.get("modelFile") for x in lst if isinstance(x, dict) and str(x.get("modelFile") or "").startswith("http")), None)
    if not url:
        return None
    key = f"glb_{inst.get('profileId') or inst.get('id')}"
    out = _root() / key
    meta_f = out / "plates.json"
    if meta_f.is_file():
        return json.loads(meta_f.read_text(encoding="utf-8"))
    r = requests.get(url, timeout=(10, 120), headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    out.mkdir(parents=True, exist_ok=True)
    plates = []
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        for name in sorted(zf.namelist()):
            m = re.search(r"plate_(\d+)\.glb$", name)
            if m:
                (out / f"plate_{m.group(1)}.glb").write_bytes(zf.read(name))
                plates.append({"n": int(m.group(1)), "name": ""})
    meta = {"v": FORMAT_V, "glb": True, "key": key, "plates": sorted(plates, key=lambda p: p["n"])}
    meta_f.write_text(json.dumps(meta), encoding="utf-8")
    return meta


def file_path(key: str, name: str) -> Path | None:
    if not re.fullmatch(r"[A-Za-z0-9_]+", key or "") or not re.fullmatch(r"plate_\d+\.(bin|glb)", name or ""):
        return None
    p = _root() / key / name
    return p if p.is_file() else None
