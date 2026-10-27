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

FORMAT_V = 2                           # 2 : les couleurs peintes au pinceau (27/10/2026)
MAX_TRIANGLES = 6_000_000              # au-dela, le plateau n'est pas converti (trop lourd pour un telephone)
_NUM = r"(-?[0-9.]+(?:[eE][-+]?[0-9]+)?)"
_VERTEX = re.compile(rb'<vertex\s+x="' + _NUM.encode() + rb'"\s+y="' + _NUM.encode() + rb'"\s+z="' + _NUM.encode() + rb'"')
_TRI = re.compile(rb'<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"')
_TRI_PAINT = re.compile(rb'<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"([^>]*)>')
_PAINT = re.compile(rb'paint_color="([0-9A-F]+)"')
_XYZ = re.compile(rb'\s[xyz]="([^"]+)"')
_V123 = re.compile(rb'\sv[123]="(\d+)"')
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


def _objects(xml) -> dict:
    """Les objets d'un fichier .model : id -> {"mesh": son maillage (octets), ou "components": [...], "pid"}.
    Decoupe par recherche de balises, sans expression sur tout le texte (des dizaines de Mo : 27/10/2026)."""
    b = xml.encode() if isinstance(xml, str) else xml
    out = {}
    pos = 0
    while True:
        i = b.find(b"<object", pos)
        if i < 0:
            break
        j = b.find(b">", i)
        if j < 0:
            break
        if b[i + 7:i + 8] not in (b" ", b"\t", b"\n", b"\r", b">", b"/"):
            pos = i + 7                                    # <objects…> : pas un objet
            continue
        head = b[i + 7:j].decode("utf-8", "replace")
        if head.endswith("/"):
            body, pos = b"", j + 1
        else:
            k = b.find(b"</object>", j)
            if k < 0:
                break
            body, pos = b[j + 1:k], k + 9
        oid = _attr(head, "id")
        if oid is None:
            continue
        o = {"pid": _attr(head, "pid"), "type": _attr(head, "type")}
        if b"<mesh" in body:
            o["mesh"] = body
        comps = []
        if b"<component" in body:
            for c in re.finditer(rb"<component\b([^>]*)/?>", body):
                h = c.group(1).decode("utf-8", "replace")
                comps.append({"path": _attr(h, "p:path"), "objectid": _attr(h, "objectid"),
                              "transform": _matrix(_attr(h, "transform"))})
        if comps:
            o["components"] = comps
        out[oid] = o
    return out


def _vals(blk: bytes, tag: bytes, rx) -> list:
    """Les valeurs des attributs d'un bloc de balises, a plat. Quand chaque balise n'a que ses trois attributs
    (le cas de Bambu Studio), un simple decoupage aux guillemets ; sinon l'expression, qui ne prend que les bons."""
    if blk.count(b'="') == 3 * blk.count(tag):
        return blk.split(b'"')[1::2]
    return rx.findall(blk)


def _mesh(body: str):
    """(sommets [x,y,z...], triangles [i,j,k...], peinture {numero de triangle: code}) d'un maillage."""
    b = body.encode() if isinstance(body, str) else body
    # les valeurs a plat, dans l'ordre (x, y, z ; v1, v2, v3) : une liste convertie d'un coup, sans tuples
    vs, ve = b.find(b"<vertices"), b.find(b"</vertices>")
    verts = list(map(float, _vals(b[vs:ve], b"<vertex ", _XYZ))) if vs >= 0 and ve > vs else []
    if b"paint_color" not in b:
        ts, te = b.find(b"<triangles"), b.find(b"</triangles>")
        return verts, (list(map(int, _vals(b[ts:te], b"<triangle ", _V123))) if ts >= 0 and te > ts else []), {}
    tris, paint = [], {}
    for k, (i, j, l, rest) in enumerate(_TRI_PAINT.findall(b)):
        tris += (int(i), int(j), int(l))
        if rest:
            m = _PAINT.search(rest)
            if m:
                paint[k] = m.group(1).decode()
    return verts, tris, paint


def _painted(v: list, t: list, paint: dict, ext: int) -> dict:
    """Les triangles d'une piece peinte au pinceau multicolore, par extrudeur : {extrudeur: [i,j,k...]}.

    Le code de chaque triangle (attribut paint_color de Bambu Studio, celui de TriangleSelector) est un arbre
    lu en quartets hexadecimaux depuis la FIN de la chaine : 2 bits de decoupe (0 : feuille, sinon 1 a 3 cotes
    coupes, 2 a 4 enfants), puis 2 bits d'etat (feuille : 0 = extrudeur de la piece, n = extrudeur n ; 3 = la
    suite dans les quartets suivants) ou de cote particulier (decoupe). Les enfants sont lus du dernier au
    premier. Les milieux d'aretes sont ajoutes aux sommets (v est complete)."""
    out: dict = {}
    mids: dict = {}

    def mid(a, b):
        k = (a, b) if a < b else (b, a)
        i = mids.get(k)
        if i is None:
            i = len(v) // 3
            v.extend(((v[3 * a] + v[3 * b]) / 2, (v[3 * a + 1] + v[3 * b + 1]) / 2, (v[3 * a + 2] + v[3 * b + 2]) / 2))
            mids[k] = i
        return i

    for ti in range(len(t) // 3):
        tri = (t[3 * ti], t[3 * ti + 1], t[3 * ti + 2])
        code = paint.get(ti)
        if not code:
            out.setdefault(ext, []).extend(tri)
            continue
        leaves = []
        try:
            nib = [int(ch, 16) for ch in reversed(code)]
            pos = 0
            stack = [tri]
            while stack:
                a = stack.pop()
                c = nib[pos]; pos += 1
                sides = c & 3
                if not sides:
                    st = c >> 2
                    if st == 3:
                        n, k = nib[pos], 0; pos += 1
                        while n == 15:
                            k += 1; n = nib[pos]; pos += 1
                        st = n + 15 * k + 3
                    leaves.append((st or ext, a))
                    continue
                sp = c >> 2
                w = [a[(sp + j) % 3] for j in range(3)]
                if sides == 1:
                    m = mid(w[2], w[1])
                    kids = [(w[0], w[1], m), (m, w[2], w[0])]
                elif sides == 2:
                    m1, m2 = mid(w[1], w[0]), mid(w[0], w[2])
                    kids = [(w[0], m1, m2), (m1, w[1], m2), (w[1], w[2], m2)]
                else:
                    m1, m2, m3 = mid(w[1], w[0]), mid(w[2], w[1]), mid(w[0], w[2])
                    kids = [(w[0], m1, m3), (m1, w[1], m2), (m2, w[2], m3), (m1, m2, m3)]
                stack.extend(kids)                     # depile : le dernier enfant d'abord, comme a l'ecriture
        except (IndexError, ValueError):
            leaves = [(ext, tri)]                      # code illisible : le triangle garde la couleur de la piece
        for st, a in leaves:
            out.setdefault(st, []).extend(a)
    return out


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
            files[p] = _objects(z.read(p)) if p in names else {}
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
        """(extrudeur, couleur de secours, transformation, maillage) de chaque piece visible d'un objet place."""
        o = root_objs.get(oid) or {}
        st = settings.get(oid) or {"extruder": 1, "parts": {}}
        out = []
        if "mesh" in o:
            out.append((st["extruder"], groups.get(o.get("pid") or "", None), mt, o["mesh"]))
        for c in o.get("components") or []:
            pe, ptype = st["parts"].get(str(c["objectid"]), (None, "normal_part"))
            if ptype in _NOT_SHOWN:
                continue
            sub = objs_in(c["path"]).get(str(c["objectid"])) or {}
            if "mesh" not in sub:
                continue
            out.append((pe or st["extruder"], groups.get(sub.get("pid") or "", None), _mul(c["transform"], mt), sub["mesh"]))
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
            for ext, fcol, mt, body in parts_of(oid, mts[k]):
                v, t, paint = _mesh(body)
                by_ext = _painted(v, t, paint, ext) if paint else {ext: t}
                total += sum(len(x) for x in by_ext.values()) // 3
                if total > MAX_TRIANGLES:
                    break
                a, b, c, d, e, f, h, i_, j, tx, ty, tz = mt
                xs, ys, zs = v[0::3], v[1::3], v[2::3]
                if (a, b, c, d, e, f, h, i_, j) == (1, 0, 0, 0, 1, 0, 0, 0, 1):
                    # une simple translation (le cas courant) : sans multiplications
                    nx = [x + tx for x in xs]
                    ny = [y + ty for y in ys]
                    nz = [z_ + tz for z_ in zs]
                else:
                    nx = [x * a + y * d + z_ * h + tx for x, y, z_ in zip(xs, ys, zs)]
                    ny = [x * b + y * e + z_ * i_ + ty for x, y, z_ in zip(xs, ys, zs)]
                    nz = [x * c + y * f + z_ * j + tz for x, y, z_ in zip(xs, ys, zs)]
                out_v = [0.0] * (len(nx) * 3)
                out_v[0::3], out_v[1::3], out_v[2::3] = nx, ny, nz
                for ex, tt in by_ext.items():
                    col = colors[ex - 1] if 0 < ex <= len(colors) else fcol
                    g = groups_out.setdefault(_hex_rgba(col), [[], []])
                    base = len(g[0]) // 3
                    if len(by_ext) == 1:
                        g[0] += out_v
                        g[1] += [q + base for q in tt] if base else tt
                        continue
                    # piece peinte : seuls les sommets de cette couleur, renumerotes
                    used = sorted(set(tt))
                    ren = {q: base + r for r, q in enumerate(used)}
                    for q in used:
                        g[0] += out_v[3 * q:3 * q + 3]
                    g[1] += [ren[q] for q in tt]
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


_LOCKS: dict = {}
_LOCKS_GUARD = __import__("threading").Lock()


def _lock(key: str):
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, __import__("threading").Lock())


def ready(src: Path, key: str) -> bool:
    """Deja converti (et a jour) ?"""
    meta_f = _root() / key / "plates.json"
    try:
        return meta_f.is_file() and meta_f.stat().st_mtime >= src.stat().st_mtime             and json.loads(meta_f.read_text(encoding="utf-8")).get("v") == FORMAT_V
    except (OSError, ValueError):
        return False


def from_3mf(src: Path, key: str) -> dict | None:
    """Le modele d'un 3MF garde, converti au besoin (et refait si le 3MF a change). None : rien a montrer.
    Une conversion a la fois par modele (la vue ouverte pendant la conversion de fond attend la meme)."""
    with _lock(key):
        return _from_3mf(src, key)


def _from_3mf(src: Path, key: str) -> dict | None:
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
    # le profil demande (l'imprimante donne parfois l'identifiant d'instance a sa place)
    inst = next((i for i in insts if profile and str(profile) in (str(i.get("profileId")), str(i.get("id")))), None) \
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


# ── La conversion a l'avance (27/10/2026) : la vue 3D s'ouvre sans attendre la conversion ──
async def prepare(iid: str) -> None:
    """Convertit en fond le 3MF d'origine d'une instance (juste apres sa recuperation)."""
    import asyncio
    from .mw_source import path_of
    src = path_of(iid)
    if src.is_file() and not ready(src, src.stem):
        await asyncio.to_thread(from_3mf, src, src.stem)


async def warm_loop(first_delay_s: int = 90, period_s: int = 12 * 3600) -> None:
    """Les 3MF d'origine deja gardes, convertis un a un (quelques secondes entre deux), puis a chaque passage
    ceux qui manquent : la premiere ouverture d'une vue 3D n'a plus a attendre."""
    import asyncio
    from .mw_source import _dir
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            # les plus recents d'abord (ceux qu'on a le plus de chances d'ouvrir)
            files = sorted(_dir().glob("*.3mf"), key=lambda f: f.stat().st_mtime, reverse=True)
            done = 0
            for f in files:
                if not ready(f, f.stem):
                    await asyncio.to_thread(from_3mf, f, f.stem)
                    done += 1
                    await asyncio.sleep(3)
            if done:
                logger.info(f"[3D] {done} modele(s) prepare(s) pour la vue 3D")
        except Exception:
            logger.exception("[3D] preparation des vues 3D")
        await asyncio.sleep(period_s)
