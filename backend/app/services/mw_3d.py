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
import os
import logging
import re
import struct
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

FORMAT_V = 3                           # 2 : les couleurs peintes au pinceau (27/10/2026) ; 3 : pieces des 3MF recents (28/10)
MAX_TRIANGLES = 6_000_000              # au-dela, le plateau n'est pas converti (trop lourd pour un telephone)
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


def _mesh(body):
    """(sommets (n, 3) float64, triangles (m, 3) int64, peinture) d'un maillage. Peinture : None, ou
    (numeros des triangles peints, leurs codes) ; les valeurs sont lues a plat, en une fois."""
    import numpy as np
    b = body.encode() if isinstance(body, str) else body
    vs, ve = b.find(b"<vertices"), b.find(b"</vertices>")
    verts = np.array(list(map(float, _vals(b[vs:ve], b"<vertex ", _XYZ))) if vs >= 0 and ve > vs else [],
                     dtype=np.float64).reshape(-1, 3)
    ts, te = b.find(b"<triangles"), b.find(b"</triangles>")
    blk = b[ts:te] if ts >= 0 and te > ts else b""
    ntri = blk.count(b"<triangle ")
    if b"paint_color" not in blk:
        tris = np.array(list(map(int, _vals(blk, b"<triangle ", _V123))), dtype=np.int64).reshape(-1, 3)
        return verts, tris, None
    npaint = blk.count(b'paint_color="')
    if blk.count(b'="') == 3 * ntri + npaint:
        # le cas de Bambu Studio : v1, v2, v3, puis paint_color s'il y en a ; decoupe aux guillemets
        from itertools import compress
        toks = blk.split(b'"')
        keys, vals = toks[0:-1:2], toks[1::2]
        isp = np.fromiter(map(b" paint_color=".__eq__, keys), dtype=bool, count=len(keys))
        if int(isp.sum()) != npaint:                    # autre mise en page : on regarde la fin de chaque cle
            isp = np.fromiter((k.endswith(b"paint_color=") for k in keys), dtype=bool, count=len(keys))
        tris = np.array(list(map(int, compress(vals, ~isp))), dtype=np.int64).reshape(-1, 3)
        codes = [c.decode() for c in compress(vals, isp)]
        pidx = np.cumsum(~isp)[isp] // 3 - 1             # le code suit le v3 de son triangle
        return verts, tris, (pidx, codes)
    # d'autres attributs sur les triangles : balise par balise
    tl, pidx, codes = [], [], []
    for k, (i_, j_, l_, rest) in enumerate(_TRI_PAINT.findall(blk)):
        tl += (int(i_), int(j_), int(l_))
        m = _PAINT.search(rest) if rest else None
        if m:
            pidx.append(k)
            codes.append(m.group(1).decode())
    return verts, np.array(tl, dtype=np.int64).reshape(-1, 3), (np.array(pidx, dtype=np.int64), codes)


def _leaf_state(code: str):
    """L'etat d'un code qui ne decoupe pas son triangle (le plus courant : un triangle peint d'un bloc) ;
    None s'il le decoupe, 0 s'il est illisible (la couleur de la piece)."""
    try:
        nib = [int(ch, 16) for ch in reversed(code)]
        c = nib[0]
        if c & 3:
            return None
        st = c >> 2
        if st == 3:
            pos, k = 2, 0
            n = nib[1]
            while n == 15:
                k += 1; n = nib[pos]; pos += 1
            st = n + 15 * k + 3
        return st
    except (IndexError, ValueError):
        return 0


def _leaves(code: str, tri: tuple, mid) -> list:
    """Les morceaux d'un triangle decoupe par la peinture : [(etat, (i, j, k))] ; mid(a, b) rend le sommet milieu.

    Le code (attribut paint_color de Bambu Studio, celui de TriangleSelector) est un arbre lu en quartets
    hexadecimaux depuis la FIN de la chaine : 2 bits de decoupe (0 : feuille, sinon 1 a 3 cotes coupes, 2 a 4
    enfants), puis 2 bits d'etat (feuille : 0 = extrudeur de la piece, n = extrudeur n ; 3 = la suite dans les
    quartets suivants) ou de cote particulier (decoupe). Les enfants sont lus du dernier au premier.
    Leve IndexError / ValueError sur un code illisible."""
    nib = [int(ch, 16) for ch in reversed(code)]
    pos = 0
    leaves = []
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
            leaves.append((st, a))
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
        stack.extend(kids)                             # depile : le dernier enfant d'abord, comme a l'ecriture
    return leaves


def _recipe(code: str):
    """La decoupe d'un code, independante du triangle : (milieux a creer [(i, j)], morceaux [(etat, (i, j, k))]) en
    indices locaux (0, 1, 2 : les coins ; puis les milieux dans l'ordre de creation). Leve sur un code illisible."""
    pairs: list = []
    seen: dict = {}

    def mid(a, b):
        k = (a, b) if a < b else (b, a)
        if k not in seen:
            seen[k] = 3 + len(pairs)
            pairs.append((a, b))
        return seen[k]
    return pairs, _leaves(code, (0, 1, 2), mid)


def _painted(v, t, paint, ext: int):
    """Une piece peinte au pinceau multicolore : (sommets completes des milieux d'aretes, {extrudeur: triangles}).
    Les triangles peints d'un bloc sont classes d'un coup ; seuls ceux que la peinture decoupe sont decodes un
    a un. Chaque couleur garde l'ordre des triangles du fichier."""
    import numpy as np
    pidx, codes = paint
    cache: dict = {}
    sts = []
    for c in codes:
        st = cache.get(c, -2)
        if st == -2:
            st = cache[c] = _leaf_state(c)
        sts.append(-1 if st is None else st)
    state = np.full(len(t), ext, dtype=np.int64)
    if len(pidx):
        state[pidx] = np.array(sts, dtype=np.int64)
    state[state == 0] = ext
    n0 = len(v)
    extra: list = []
    mids: dict = {}

    def coord(i):
        return v[i] if i < n0 else extra[i - n0]

    def mid(a, b):
        k = (a, b) if a < b else (b, a)
        i = mids.get(k)
        if i is None:
            pa, pb = coord(a), coord(b)
            i = n0 + len(extra)
            extra.append(((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2))
            mids[k] = i
        return i
    code_at = {p: c for p, c, st in zip(pidx.tolist(), codes, sts) if st == -1}   # les triangles decoupes
    split_tris: dict = {}                                 # etat -> ([triangles], [numero du triangle d'origine])
    recipes: dict = {}
    for ti in np.nonzero(state == -1)[0].tolist():
        tri = tuple(t[ti].tolist())
        code = code_at[ti]
        r = recipes.get(code)
        if r is None:
            try:
                r = recipes[code] = _recipe(code)
            except (IndexError, ValueError):
                r = recipes[code] = False
        if r is False:
            lv = [(ext, tri)]                          # code illisible : le triangle garde la couleur de la piece
        else:
            loc = list(tri)
            for a_, b_ in r[0]:
                loc.append(mid(loc[a_], loc[b_]))
            lv = [(st, (loc[x], loc[y], loc[z])) for st, (x, y, z) in r[1]]
        for st, a in lv:
            e = split_tris.setdefault(st or ext, ([], []))
            e[0].append(a)
            e[1].append(ti)
    if extra:
        v = np.vstack([v, np.array(extra, dtype=np.float64)])
    out = {}
    # les couleurs dans l'ordre de leur premiere apparition (comme le fichier)
    firsts = {}
    for st in np.unique(state[state > 0]).tolist():
        firsts[st] = int(np.argmax(state == st))
    for st, (_, keys) in split_tris.items():
        firsts[st] = min(firsts.get(st, keys[0]), keys[0])
    for st in sorted(firsts, key=lambda s_: firsts[s_]):
        whole = np.nonzero(state == st)[0]
        parts, keys = [t[whole]], [whole]
        if st in split_tris:
            a, k = split_tris[st]
            parts.append(np.array(a, dtype=np.int64).reshape(-1, 3))
            keys.append(np.array(k, dtype=np.int64))
        tt = np.concatenate(parts)
        if len(parts) > 1:
            tt = tt[np.argsort(np.concatenate(keys), kind="stable")]
        out[st] = tt
    return v, out


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
    # les balises prennent d'autres attributs selon la version de Bambu Studio (uuid=... depuis 2.x) : on ne lit que
    # ceux qui servent (le 28/10/2026, un modele recent sortait d'une seule couleur, ses pieces n'etant pas reconnues)
    for m in re.finditer(r'<object id="(\d+)"[^>]*>(.*?)</object>', xml, re.S):
        body = m.group(2)
        head = body.split("<part", 1)[0]
        ext = re.search(r'key="extruder" value="(\d+)"', head)
        parts = {}
        for p in re.finditer(r'<part id="(\d+)"([^>]*)>(.*?)</part>', body, re.S):
            e = re.search(r'key="extruder" value="(\d+)"', p.group(3))
            st = re.search(r'subtype="([^"]*)"', p.group(2))
            parts[p.group(1)] = (int(e.group(1)) if e else None, st.group(1) if st else "normal_part")
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


# La finition d'un filament (28/10/2026), comme finishOf de l'appli : lue dans son nom ou son type (« Bambu PLA Silk+
# @BBL X1C »…) ; translucide quand sa couleur a une transparence (8 hexa). Pour le rendu de la vue 3D.
_FINISH_WORDS = [("glow", r"glow|phosphor|luminesc"), ("galaxy", r"galaxy|galax"), ("sparkle", r"sparkle|glitter|paillet"),
                 ("marble", r"marble|marbre"), ("silk", r"silk|soie"), ("metal", r"metal"), ("wood", r"wood|\bbois\b"),
                 ("carbon", r"carbon|carbone|(^|[\s-])cf\b"), ("matte", r"matte|\bmat\b")]


def finish_of(*texts, color: str = "") -> str | None:
    import unicodedata
    t = " ".join(str(x) for x in texts if x).lower()
    t = "".join(c for c in unicodedata.normalize("NFD", t) if not unicodedata.combining(c))
    h = str(color or "").lstrip("#")
    if len(h) == 8 and h[6:].lower() != "ff":
        return "translucent"
    if re.search(r"translucent|transparent", t):
        return "translucent"
    for f, rx in _FINISH_WORDS:
        if re.search(rx, t):
            return f
    return None


def origin_finishes(src: Path) -> dict:
    """{couleur RRGGBB : finition} des filaments d'un 3MF (profil filament et couleur de chacun)."""
    try:
        with zipfile.ZipFile(src) as z:
            ps = json.loads(z.read("Metadata/project_settings.config"))
    except Exception:
        return {}
    cols = ps.get("filament_colour") or []
    names = ps.get("filament_settings_id") or []
    types = ps.get("filament_type") or []
    out = {}
    for k, c in enumerate(cols):
        h = str(c or "").lstrip("#").upper()
        f = finish_of(names[k] if k < len(names) else "", types[k] if k < len(types) else "", color=c)
        if f and len(h) >= 6 and h[:6] not in out:
            out[h[:6]] = f
    return out


def _hex_rgba(h) -> int:
    h = str(h or "").lstrip("#")
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return (r << 24) | (g << 16) | (b << 8) | 0xFF
    except (ValueError, IndexError):
        return 0xB4BCC8FF


_GZ_CHUNK = 4 << 20                    # 4 Mo par morceau


def _gzip(data: bytes) -> bytes:
    """gzip (niveau 1) compresse sur plusieurs coeurs, en UN seul flux valide : chaque morceau est compresse a part
    et termine sur une frontiere d'octet (Z_SYNC_FLUSH), le dernier ferme le flux ; l'en-tete et la fin (CRC, taille)
    sont ceux de tout le fichier (la methode de pigz). zlib libere le verrou de Python pendant qu'il compresse."""
    import zlib
    from concurrent.futures import ThreadPoolExecutor
    parts = [data[i:i + _GZ_CHUNK] for i in range(0, len(data), _GZ_CHUNK)] or [b""]

    def deflate(k):
        c = zlib.compressobj(1, zlib.DEFLATED, -15)
        last = k == len(parts) - 1
        return c.compress(parts[k]) + c.flush(zlib.Z_FINISH if last else zlib.Z_SYNC_FLUSH)
    if len(parts) == 1:
        body = deflate(0)
    else:
        import os
        with ThreadPoolExecutor(max_workers=min(len(parts), os.cpu_count() or 2)) as ex:
            body = b"".join(ex.map(deflate, range(len(parts))))
    head = b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\xff"
    return head + body + struct.pack("<II", zlib.crc32(data) & 0xFFFFFFFF, len(data) & 0xFFFFFFFF)


# L'avancement des preparations en cours (27/10/2026), pour le cercle de la vue : cle -> {pct, label}. Une
# preparation lancee par une ouverture se suit par le modele (WATCH : modele -> cle du 3MF en cours).
PROGRESS: dict = {}
WATCH: dict = {}


def _step(key, pct, label: str) -> None:
    if key:
        PROGRESS[key] = {"pct": None if pct is None else max(0, min(100, round(pct))), "label": label}


def plates_out(meta: dict, key: str) -> tuple:
    """(plateaux a montrer avec leur adresse, numeros des plateaux trop lourds) : ni les vides, ni les trop lourds."""
    ext = "glb" if meta.get("glb") else "bin"
    try:
        ver = int((_root() / key / "plates.json").stat().st_mtime)
    except OSError:
        ver = 0
    shown = [{**p, "url": f"/api/v1/makerworld/3d/file/{key}/plate_{p['n']}.{ext}?v={ver}"} for p in meta.get("plates") or []
             if not p.get("skipped") and not p.get("empty") and (meta.get("glb") or p.get("size_mm"))]
    return shown, [p["n"] for p in meta.get("plates") or [] if p.get("skipped")]


def progress_of(did: str) -> dict:
    """Ou en est la preparation de la vue 3D de ce modele ({} : rien en cours)."""
    key = WATCH.get(str(did))
    return PROGRESS.get(key) or PROGRESS.get(f"did:{did}") or {}


def convert(src: Path, out_dir: Path, key: str = None) -> dict:
    """Le 3MF -> un fichier binaire par plateau, et plates.json. Rend {"plates": [{n, name, triangles}]}.
    Les sommets et triangles en tableaux numpy (27/10/2026 : 20 s pour un gros modele peint, en Python pur)."""
    import numpy as np
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
    # les pieces de chaque plateau d'abord : leur taille sert a mesurer l'avancement
    _step(key, 2, "Ouverture du 3MF")
    work = []
    for n, pname, inst in plates:
        lst = []
        for oid, k in inst:
            mts = items_by_obj.get(oid) or []
            if k < len(mts):
                lst.append(parts_of(oid, mts[k]))
        work.append((n, pname, lst))
    weight = sum(len(p[3]) for _, _, lst in work for parts in lst for p in parts) or 1
    done = 0
    for n, pname, lst in work:
        groups_out: dict = {}                           # couleur -> [sommets, triangles]
        total = 0
        for parts in lst:
            for ext, fcol, mt, body in parts:
                # la part de cette piece dans l'avancement (lecture 5 -> 75 %), decoupee en etapes
                a0, a1 = 5 + 70 * done / weight, 5 + 70 * (done + len(body)) / weight
                done += len(body)
                _step(key, a0, "Lecture des pièces")
                v, t, paint = _mesh(body)
                if paint:
                    _step(key, a0 + (a1 - a0) * 0.55, "Couleurs peintes")
                v, by_ext = _painted(v, t, paint, ext) if paint else (v, {ext: t})
                _step(key, a0 + (a1 - a0) * 0.85, "Mise en place")
                total += sum(len(x) for x in by_ext.values())
                if total > MAX_TRIANGLES:
                    break
                rot = np.array(mt[:9], dtype=np.float64).reshape(3, 3)
                vt = v + np.array(mt[9:], dtype=np.float64) if np.array_equal(rot, np.eye(3)) else v @ rot + np.array(mt[9:])
                for ex, tt in by_ext.items():
                    col = colors[ex - 1] if 0 < ex <= len(colors) else fcol
                    g = groups_out.setdefault(_hex_rgba(col), [[], [], 0])
                    if len(by_ext) == 1:
                        g[0].append(vt)
                        g[1].append(tt + g[2])
                        g[2] += len(vt)
                        continue
                    # piece peinte : seuls les sommets de cette couleur, renumerotes
                    used, inv = np.unique(tt.ravel(), return_inverse=True)
                    g[0].append(vt[used])
                    g[1].append(inv.reshape(-1, 3) + g[2])
                    g[2] += len(used)
        if not groups_out or total > MAX_TRIANGLES:
            # vide : un 3MF tranche ne garde souvent que les pieces du plateau imprime
            meta["plates"].append({"n": n, "name": pname, "triangles": total, "skipped": total > MAX_TRIANGLES,
                                   "empty": not groups_out})
            continue
        # recentre le plateau : au milieu en X et Y, pose sur z = 0
        allv = {col: np.concatenate(g[0]) for col, g in groups_out.items()}
        lo = np.min([a.min(axis=0) for a in allv.values()], axis=0)
        hi = np.max([a.max(axis=0) for a in allv.values()], axis=0)
        shift = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
        size = [float(hi[0] - lo[0]), float(hi[1] - lo[1]), float(hi[2] - lo[2])]
        buf = bytearray(struct.pack("<I", len(groups_out)))
        for col, g in groups_out.items():
            vv, tt = allv[col], np.concatenate(g[1])
            buf += struct.pack("<III", col, len(vv), len(tt))
            buf += (vv - shift).astype("<f4").tobytes()
            buf += tt.astype("<u4").tobytes()
        # compresse une fois pour toutes : servi tel quel (Content-Encoding: gzip), le telephone le recoit leger
        _step(key, 78 + 20 * (len(meta["plates"]) + 1) / max(1, len(work)) - 10 / max(1, len(work)), "Compression")
        _write(out_dir / f"plate_{n}.bin", _gzip(bytes(buf)))
        meta["plates"].append({"n": n, "name": pname, "triangles": total, "size_mm": [round(x, 1) for x in size]})
    _write(out_dir / "plates.json", json.dumps(meta).encode("utf-8"))
    return meta


def _write(p: Path, data: bytes) -> None:
    """Ecrit d'un coup (fichier a cote, puis renomme) : un plateau lu pendant qu'on le reecrit (conversion de fond)
    arrivait tronque au navigateur (« Failed to fetch »)."""
    tmp = p.with_name(p.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, p)


def unreadable(key: str) -> None:
    """Un plateau illisible (abime) : la vue de ce 3MF est oubliee, la prochaine ouverture la refait."""
    d = _root() / key
    for f in list(d.glob("plate_*")) + [d / "plates.json"]:
        try:
            f.unlink()
        except OSError:
            pass
    logger.warning(f"[3D] {key} : plateau illisible, vue a refaire")


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
        # perdu en local mais sauvegarde sur le NAS (et a jour) : repris, sans reconvertir
        if not meta_f.is_file():
            try:
                from .archive import restore_3d
                if restore_3d(key, d) and meta_f.is_file():
                    meta = json.loads(meta_f.read_text(encoding="utf-8"))
                    if meta.get("v") == FORMAT_V and any(p.get("size_mm") for p in meta.get("plates") or []):
                        logger.info(f"[3D] {key} : repris du NAS")
                        return meta
            except Exception:
                logger.exception("[3D] reprise du NAS")
        return convert(src, d, key)
    except Exception as e:
        logger.warning(f"[3D] {src.name} non converti : {type(e).__name__}: {e}")
        return None
    finally:
        PROGRESS.pop(key, None)


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
    _step(f"did:{did}", None, "Aperçu 3D de MakerWorld")
    r = requests.get(url, timeout=(10, 120), headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    out.mkdir(parents=True, exist_ok=True)
    plates = []
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        for name in sorted(zf.namelist()):
            m = re.search(r"plate_(\d+)\.glb$", name)
            if m:
                _write(out / f"plate_{m.group(1)}.glb", zf.read(name))
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
    from ..core import tasks as _tasks
    import asyncio
    from .mw_source import _dir
    await _tasks.sleep("mw_3d", first_delay_s)
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
            _tasks.error("mw_3d")
            logger.exception("[3D] preparation des vues 3D")
        await _tasks.sleep("mw_3d", period_s)
