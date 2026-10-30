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
import html as _html
import json
import os
import logging
import re
import struct
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

FORMAT_V = 20                          # 20 : pieces en miroir gardees en miroir dans la vue assemblee (30/10) ; 19 : couches en marches d'un lithophane lissees (30/10) ; 18 : plus de decoupage automatique en morceaux (29/10) ; 17 : 17 : morceaux separes dans la vue assemblee (29/10) ; 16 : une piece par partie d'objet (29/10) ; 15 : vue assemblee par piece, pour l'editer (29/10) ; 14 : blocs ranges plus serres (29/10) ; 13 : place des pieces dans la vue assemblee (29/10) ; 12 : tas deposes a l'origine (29/10) ; 11 : binaire compact, plateaux alleges (29/10) ; 10 : plateaux trop lourds simplifies (29/10) ; 9 : tas de pieces ranges (29/10) ; 8 : vue assemblee eparpillee rangee (29/10) ; 6 : la vue assemblee (29/10), 7 : toujours montree ; 2 : les couleurs peintes au pinceau (27/10/2026) ; 3 : pieces des 3MF recents (28/10) ; 4 : changements de filament en hauteur (28/10) ; 5 : lithophanes reconnus (28/10)
_LITHO = re.compile(r"litho|lithophan|hue ?forge", re.I)       # HueForge : une image en couches, a voir par derriere aussi (30/10)
MAX_TRIANGLES = 1_500_000              # au-dela, le plateau est simplifie (29/10/2026 ; avant : pas converti du tout) :
                                       # un telephone l'affiche vite, et le fichier reste de quelques Mo
READ_TRIANGLES = 40_000_000            # au-dela, on arrete de lire (memoire du serveur) : le plateau n'est pas montre
_TRI_PAINT = re.compile(rb'<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"([^>]*)>')
_PAINT = re.compile(rb'paint_color="([0-9A-F]+)"')
_XYZ = re.compile(rb'\s[xyz]="([^"]+)"')
_V123 = re.compile(rb'\sv[123]="(\d+)"')
_NOT_SHOWN = {"modifier_part", "negative_part", "support_blocker", "support_enforcer"}
_ZIP_SHARE = 0.15                      # la compression d'un plateau, en part de sa lecture (avancement)
ASSEMBLED_N = 0                        # le « plateau » de la vue assemblee (29/10/2026) : apres les vrais plateaux


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


def _z_changes(z: zipfile.ZipFile, colors: list) -> dict:
    """Les changements de filament a une hauteur (28/10/2026), poses dans Bambu Studio (le « M600 » d'une
    impression monocouleur qui change de couleur a telle couche) : Metadata/custom_gcode_per_layer.xml.
    {plateau : (mode, [(hauteur, extrudeur ou None, couleur, type)])}, hauteurs croissantes ; type 0 : changement de
    couleur (la couleur donnee, sinon celle du filament), 2 : changement d'outil (la couleur de ce filament)."""
    try:
        xml = z.read("Metadata/custom_gcode_per_layer.xml").decode("utf-8", "replace")
    except KeyError:
        return {}
    out = {}
    for m in re.finditer(r"<plate>(.*?)</plate>", xml, re.S):
        body = m.group(1)
        pid = re.search(r'<plate_info\s+id="(\d+)"', body)
        mode = re.search(r'<mode\s+value="([^"]*)"', body)
        lst = []
        for lm in re.finditer(r"<layer\b([^>]*)/?>", body):
            a = lm.group(1)
            typ = _attr(a, "type")
            gcode = (_attr(a, "gcode") or "").upper()
            if typ not in ("0", "2") and "M600" not in gcode:
                continue
            kind = 2 if typ == "2" else 0
            try:
                zt = float(_attr(a, "top_z"))
            except (TypeError, ValueError):
                continue
            ext = _attr(a, "extruder")
            ext = int(ext) if ext and ext.isdigit() else None
            col = (_attr(a, "color") or "").strip()
            if kind == 2 or not col:
                col = colors[ext - 1] if ext and 0 < ext <= len(colors) else col
            if not col:
                continue
            lst.append((zt, ext, col, kind))
        if pid and lst:
            out[int(pid.group(1))] = ((mode.group(1) if mode else "SingleExtruder"), sorted(lst))
    return out


def _cut_z(v, t, zc: float) -> tuple:
    """Coupe un maillage au plan z = zc : (sommets completes, triangles dessous, triangles dessus). Un triangle a
    cheval est decoupe en trois (un d'un cote, deux de l'autre), aux points ou ses aretes croisent le plan."""
    import numpy as np
    if not len(t):
        return v, t, t
    zz = v[:, 2]
    up = zz[t] >= zc                                    # (m, 3) : chaque sommet au-dessus ?
    n_up = up.sum(axis=1)
    below, above = t[n_up == 0], t[n_up == 3]
    mixed = t[(n_up > 0) & (n_up < 3)]
    if not len(mixed):
        return v, below, above
    mu = up[(n_up > 0) & (n_up < 3)]
    # le sommet seul de son cote en premier (l'ordre tourne : le sens du triangle est garde)
    lone_up = mu.sum(axis=1) == 1
    lone = np.where(lone_up, mu.argmax(axis=1), (~mu).argmax(axis=1))
    idx = (lone[:, None] + np.arange(3)[None, :]) % 3
    tri = np.take_along_axis(mixed, idx, axis=1)
    la, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    pa, pb, pc = v[la], v[b], v[c]
    def hit(p, q):
        f = (zc - p[:, 2]) / np.where(q[:, 2] == p[:, 2], 1.0, q[:, 2] - p[:, 2])
        return p + (q - p) * np.clip(f, 0.0, 1.0)[:, None]
    p1, p2 = hit(pa, pb), hit(pa, pc)
    base = len(v)
    i1 = np.arange(len(tri)) + base
    i2 = i1 + len(tri)
    v2 = np.concatenate([v, p1, p2])
    lone_tri = np.stack([la, i1, i2], axis=1)
    quad = np.concatenate([np.stack([i1, b, c], axis=1), np.stack([i1, c, i2], axis=1)])
    quad_up = np.concatenate([~lone_up, ~lone_up])
    below = np.concatenate([below, lone_tri[~lone_up], quad[~quad_up]])
    above = np.concatenate([above, lone_tri[lone_up], quad[quad_up]])
    return v2, below, above


def piece_plates(src) -> dict:
    """Le plateau de chaque objet place de la vue assemblee ({"objet:instance": plateau}), lu dans les reglages du 3MF
    (rien a convertir) : la vue assemblee colore chaque piece avec la correspondance de son plateau (30/10/2026 : le
    meme gris du createur imprime en or sur un plateau, en rouge sur un autre)."""
    try:
        with zipfile.ZipFile(src) as z:
            plates, _ = _settings(z)
    except Exception:
        return {}
    return {f"{oid}:{k}": n for n, _name, inst in plates for oid, k in inst}


def _settings(z: zipfile.ZipFile) -> tuple:
    """(plateaux [(n, nom, [(object_id, instance)])], objets {id: {extruder, parts: {part_id: (extruder, type)}}}) ;
    objets["__assemble__"] : la vue d'assemblage [(object_id, instance, transformation)]."""
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
        parts, pnames = {}, {}
        for p in re.finditer(r'<part id="(\d+)"([^>]*)>(.*?)</part>', body, re.S):
            e = re.search(r'key="extruder" value="(\d+)"', p.group(3))
            st = re.search(r'subtype="([^"]*)"', p.group(2))
            parts[p.group(1)] = (int(e.group(1)) if e else None, st.group(1) if st else "normal_part")
            pn = re.search(r'key="name" value="([^"]*)"', p.group(3))
            if pn:
                pnames[p.group(1)] = _html.unescape(pn.group(1))
        nm = re.search(r'key="name" value="([^"]*)"', head)
        objs[m.group(1)] = {"extruder": int(ext.group(1)) if ext else 1, "parts": parts, "pnames": pnames,
                            "name": _html.unescape(nm.group(1)) if nm else ""}
    plates = []
    # la vue d'assemblage (29/10/2026) : la place de chaque objet une fois assemble, que le createur peut poser dans
    # Bambu Studio (les lignes par piece, volume_id, ne servent pas ici : les pieces gardent leur place dans l'objet)
    asm, asm_vol = [], {}
    for m in re.finditer(r"<assemble_item\b([^>]*)/?>", xml):
        h = m.group(1)
        if not _attr(h, "object_id"):
            continue
        # la place de chaque piece dans son objet une fois assemble (29/10/2026 : sans elle, la tete de Billy restait
        # au centre du corps) ; volume_id : le rang de la piece dans l'objet
        if str(_attr(h, "volume_id") or "").isdigit():
            asm_vol.setdefault(_attr(h, "object_id"), {})[int(_attr(h, "volume_id"))] = _matrix(_attr(h, "transform"))
        elif str(_attr(h, "instance_id") or "").isdigit():
            asm.append((_attr(h, "object_id"), int(_attr(h, "instance_id")), _matrix(_attr(h, "transform"))))
    for m in re.finditer(r"<plate>(.*?)</plate>", xml, re.S):
        body = m.group(1)
        n = re.search(r'key="plater_id" value="(\d+)"', body)
        name = re.search(r'key="plater_name" value="([^"]*)"', body)
        inst = [(a, int(b)) for a, b in re.findall(
            r'<model_instance>\s*<metadata key="object_id" value="(\d+)"/>\s*<metadata key="instance_id" value="(\d+)"/>', body)]
        if n:
            plates.append((int(n.group(1)), name.group(1) if name else "", inst))
    objs["__assemble__"] = asm
    objs["__assemble_vol__"] = asm_vol
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
    def put(c, k):
        h = str(c or "").lstrip("#").upper()
        f = finish_of(names[k] if k < len(names) else "", types[k] if k < len(types) else "", color=c)
        if f and len(h) >= 6 and h[:6] not in out:
            out[h[:6]] = f
    for k, c in enumerate(cols):
        put(c, k)
    # les couleurs des changements de filament en hauteur : la finition du filament qui les imprime
    try:
        with zipfile.ZipFile(src) as z:
            for _mode, lst in _z_changes(z, cols).values():
                for _zt, ext, c, _kind in lst:
                    if ext:
                        put(c, ext - 1)
    except Exception:
        pass
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
# la vue en cours de preparation (29/10/2026) : les plateaux deja prets, et ceux qui viennent (pending) ; la vue
# s'ouvre des le premier, sans attendre les autres
PARTIAL: dict = {}
_RUNNING: dict = {}


# dans le processus de conversion (29/10/2026), l'avancement et les plateaux deja prets passent par deux petits
# fichiers a cote des plateaux (progress.json, partial.json) : le serveur les lit pour la vue qui attend
_CHILD = {"on": False, "last": None}


def _side(key: str, name: str, data) -> None:
    try:
        d = _root() / key
        d.mkdir(parents=True, exist_ok=True)
        _write(d / name, json.dumps(data).encode("utf-8"))
    except OSError:
        pass


def _read_side(key: str, name: str):
    try:
        return json.loads((_root() / key / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _step(key, pct, label: str) -> None:
    if key:
        v = {"pct": None if pct is None else max(0, min(100, round(pct))), "label": label}
        PROGRESS[key] = v
        if _CHILD["on"] and v != _CHILD["last"]:
            _CHILD["last"] = v
            _side(key, "progress.json", v)


def plates_out(meta: dict, key: str) -> tuple:
    """(plateaux a montrer avec leur adresse, numeros des plateaux trop lourds) : ni les vides, ni les trop lourds."""
    ext = "glb" if meta.get("glb") else "bin"

    def ver(n):
        try:
            return int((_root() / key / f"plate_{n}.{ext}").stat().st_mtime)
        except OSError:
            return 0
    shown = [p if p.get("pending") else {**p, "url": f"/api/v1/makerworld/3d/file/{key}/plate_{p['n']}.{ext}?v={ver(p['n'])}"}
             for p in meta.get("plates") or []
             if p.get("pending") or (not p.get("skipped") and not p.get("empty") and (meta.get("glb") or p.get("size_mm")))]
    return shown, [p["n"] for p in meta.get("plates") or [] if p.get("skipped")]


def progress_of(did: str) -> dict:
    """Ou en est la preparation de la vue 3D de ce modele ({} : rien en cours)."""
    key = WATCH.get(str(did))
    return PROGRESS.get(key) or PROGRESS.get(f"did:{did}") or (_read_side(key, "progress.json") if key else None) or {}


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
    zch = _z_changes(z, colors)
    plates, settings = _settings(z)
    asm = settings.pop("__assemble__", []) if settings else []
    asm_vol = settings.pop("__assemble_vol__", {}) if settings else {}
    # les noms (titre du modele, objets et pieces), pour reconnaitre un lithophane
    try:
        names_txt = " ".join(re.findall(r'key="name" value="([^"]*)"', z.read("Metadata/model_settings.config").decode("utf-8", "replace")))
    except KeyError:
        names_txt = ""
    names_txt += " " + " ".join(re.findall(r'<metadata name="Title">([^<]*)', root_xml[:20000]))
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

    def parts_of(oid, mt, vols=None):
        """(extrudeur, couleur de secours, transformation, maillage) de chaque piece visible d'un objet place.
        vols : {rang de la piece : sa place dans l'objet}, celle de la vue assemblee (au lieu de celle du plateau)."""
        o = root_objs.get(oid) or {}
        st = settings.get(oid) or {"extruder": 1, "parts": {}}
        vols = vols or {}
        out = []
        if "mesh" in o:
            out.append((st["extruder"], groups.get(o.get("pid") or "", None), _mul(vols[0], mt) if 0 in vols else mt, o["mesh"],
                        (0, st.get("name") or "")))
        for ci, c in enumerate(o.get("components") or []):
            pe, ptype = st["parts"].get(str(c["objectid"]), (None, "normal_part"))
            if ptype in _NOT_SHOWN:
                continue
            sub = objs_in(c["path"]).get(str(c["objectid"])) or {}
            if "mesh" not in sub:
                continue
            # la piece (son rang dans l'objet et son nom) : l'edition de la vue assemblee la deplace seule
            out.append((pe or st["extruder"], groups.get(sub.get("pid") or "", None), _mul(vols.get(ci, c["transform"]), mt), sub["mesh"],
                        (ci, (st.get("pnames") or {}).get(str(c["objectid"])) or st.get("name") or "")))
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
                lst.append(((oid, k), parts_of(oid, mts[k])))
        work.append((n, pname, lst))
    # la vue assemblee, en dernier : chaque objet a sa place d'assemblage (les plateaux restent tels quels)
    asm_lst = []
    det = lambda m: (m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]))
    for oid, k, mt in asm:
        # une piece en miroir sur son plateau (une aile gauche faite de l'aile droite) : Bambu Studio ecrit sa place
        # d'assemblage sans le miroir, la vue assemblee montrait deux ailes identiques (30/10/2026). Le miroir est remis,
        # comme Bambu Studio le range : sur l'axe X de l'objet, avant sa place
        lst_ = items_by_obj.get(oid) or []
        pm = lst_[k] if k < len(lst_) else None
        if pm and det(pm) < 0 < det(mt):
            mt = _mul([-1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], mt)
        parts = parts_of(oid, mt, asm_vol.get(oid))
        if not parts:                                   # un objet absent (3MF tranche : seulement le plateau imprime)
            asm_lst = []
            break
        asm_lst.append(((oid, k), parts))
    if len(asm_lst) < 2:                                # un seul objet : rien de plus que son plateau
        asm_lst = []
    weight = (sum(len(p[3]) for _, _, lst in work for _, parts in lst for p in parts)
              + sum(len(p[3]) for _, parts in asm_lst for p in parts)) or 1
    # l'avancement (29/10/2026) : chaque plateau a sa part, a la taille de ses pieces, lecture puis compression ;
    # la barre ne fait qu'avancer (avant, la compression d'un plateau la poussait a 80 % et le plateau suivant
    # la ramenait a la lecture, vers 40 %)
    total_w = weight * (1 + _ZIP_SHARE)
    pct = lambda x: 3 + 95 * min(1.0, x / total_w)
    prog = {"done": 0}

    nb = len(work) + (1 if asm_lst else 0)
    where = {"tag": ""}                                 # « Plateau 2/6 » devant chaque etape

    def say(p_, label):
        _step(key, p_, f"{where['tag']} · {label}" if where["tag"] and nb > 1 else label)

    def emit(lst, label="Lecture des pièces", zchg=None, own=None, piece_of=None, zplate=None):
        """Les pieces placees -> groupes par couleur. own : {objet place : ses sommets}, pour les deplacer apres ;
        piece_of : {objet place : son numero}, les groupes sont alors par (couleur, piece) (l'edition de la vue
        assemblee deplace une piece a la fois). zplate : {(objet place, rang de la piece) : (changements en hauteur de
        son plateau, sa place sur ce plateau)} : la vue assemblee coupe chaque piece a la hauteur ou elle change de
        filament sur son plateau, puis la remet a sa place assemblee (30/10/2026)."""
        gk = (lambda col, ident, tag: (_hex_rgba(col), piece_of[(ident, tag[0])])) if piece_of else (lambda col, ident, tag: _hex_rgba(col))
        groups_out: dict = {}                           # couleur -> [sommets, triangles]
        total = 0
        start, pw = prog["done"], sum(len(p[3]) for _, parts in lst for p in parts)
        for ident, parts in lst:
            for ext, fcol, mt, body, tag in parts:
                # la part de cette piece dans l'avancement, decoupee en etapes
                a0, a1 = pct(prog["done"]), pct(prog["done"] + len(body))
                prog["done"] += len(body)
                say(a0, label)
                v, t, paint = _mesh(body)
                if paint:
                    say(a0 + (a1 - a0) * 0.55, "Couleurs peintes")
                v, by_ext = _painted(v, t, paint, ext) if paint else (v, {ext: t})
                say(a0 + (a1 - a0) * 0.85, "Mise en place")
                total += sum(len(x) for x in by_ext.values())
                if total > READ_TRIANGLES:
                    break
                rot = np.array(mt[:9], dtype=np.float64).reshape(3, 3)
                vt = v + np.array(mt[9:], dtype=np.float64) if np.array_equal(rot, np.eye(3)) else v @ rot + np.array(mt[9:])
                zp = zplate.get((ident, tag[0])) if zplate else None
                zc_, vcut, back = zchg, vt, None
                if zp:
                    # coupee la ou elle est sur son plateau, puis ramenee a sa place assemblee
                    zc_, mp = zp
                    rp, tp = np.array(mp[:9], dtype=np.float64).reshape(3, 3), np.array(mp[9:], dtype=np.float64)
                    vcut = v @ rp + tp
                    back = (np.linalg.inv(rp) @ rot, tp, np.array(mt[9:], dtype=np.float64))
                for ex, tt in by_ext.items():
                    col = colors[ex - 1] if 0 < ex <= len(colors) else fcol
                    # les changements de filament a une hauteur qui touchent ces triangles : un changement
                    # d'outil ou, avec un seul filament, tout changement ; a plusieurs, celui de ce filament
                    cuts = [(zt, c) for zt, e, c, kind in zc_[1] if kind == 2 or zc_[0] == "SingleExtruder" or e in (None, ex)] \
                        if zc_ else []
                    if not cuts and len(by_ext) == 1:
                        g = groups_out.setdefault(gk(col, ident, tag), [[], [], 0])
                        g[0].append(vt)
                        if own is not None:
                            own.setdefault(ident, []).append(vt)
                        g[1].append(tt + g[2])
                        g[2] += len(vt)
                        continue
                    # tranche par tranche, de bas en haut : chacune a la couleur en cours a cette hauteur
                    vv, rest, slices = vcut, tt, []
                    for zt, c in cuts:
                        vv, lower, rest = _cut_z(vv, rest, zt)
                        slices.append((col, lower))
                        col = c
                    slices.append((col, rest))
                    for c, tr in slices:
                        if not len(tr):
                            continue
                        # seuls les sommets de cette couleur (piece peinte ou tranchee), renumerotes
                        g = groups_out.setdefault(gk(c, ident, tag), [[], [], 0])
                        used, inv = np.unique(tr.ravel(), return_inverse=True)
                        g[0].append(vv[used] if back is None else (vv[used] - back[1]) @ back[0] + back[2])
                        if own is not None:
                            own.setdefault(ident, []).append(g[0][-1])
                        g[1].append(inv.reshape(-1, 3) + g[2])
                        g[2] += len(used)
                    total += sum(len(tr) for _, tr in slices) - len(tt)     # les triangles coupes en font plus
        prog["done"] = start + pw                       # meme interrompu (trop lourd) : sa part est faite
        return groups_out, total, pw

    def zipped(pw):
        prog["done"] += _ZIP_SHARE * pw

    def write(n, pname, groups_out, total, pw, extra=None):
        reduced = None
        if groups_out and MAX_TRIANGLES < total <= READ_TRIANGLES:
            say(pct(prog["done"]), "Simplification")
            reduced, total = total, _decimate(groups_out, MAX_TRIANGLES)
        if not groups_out or total > READ_TRIANGLES:
            zipped(pw)
            # vide : un 3MF tranche ne garde souvent que les pieces du plateau imprime
            meta["plates"].append({"n": n, "name": pname, "triangles": total, "skipped": total > READ_TRIANGLES,
                                   "empty": not groups_out, **(extra or {})})
            return None
        # recentre le plateau : au milieu en X et Y, pose sur z = 0
        allv = {col: np.concatenate(g[0]) for col, g in groups_out.items()}
        lo = np.min([a.min(axis=0) for a in allv.values()], axis=0)
        hi = np.max([a.max(axis=0) for a in allv.values()], axis=0)
        # un lithophane (30/10/2026) : ses couches de couleur en marches (des colonnes a dessus plat, sur une grille)
        # deviennent des surfaces continues ; vues par derriere, elles faisaient des pixels en escalier
        if (bool(_LITHO.search(f"{pname} {names_txt}")) or (hi[2] - lo[2] <= 6 and min(hi[0] - lo[0], hi[1] - lo[1]) >= 40))                 and not any(isinstance(k, tuple) for k in groups_out):
            for col, g in list(groups_out.items()):
                try:
                    sm = _smooth_terraces(allv[col], np.concatenate(g[1]))
                except Exception as e:                  # une forme inattendue : laissee telle quelle
                    logger.debug(f"[3D] lissage impossible : {e}")
                    sm = None
                if sm is not None:
                    total += len(sm[1]) - sum(len(x) for x in g[1])
                    groups_out[col] = [[sm[0]], [sm[1]], len(sm[0])]
                    allv[col] = sm[0]
        shift = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
        size = [float(hi[0] - lo[0]), float(hi[1] - lo[1]), float(hi[2] - lo[2])]
        buf = _pack_bin({col: (allv[col] - shift, np.concatenate(g[1])) for col, g in groups_out.items()})
        # compresse une fois pour toutes : servi tel quel (Content-Encoding: gzip), le telephone le recoit leger
        say(pct(prog["done"]), "Compression")
        _write(out_dir / f"plate_{n}.bin", _gzip(bytes(buf)))
        zipped(pw)
        rec = {"n": n, "name": pname, "triangles": total, "size_mm": [round(x, 1) for x in size], **(extra or {}),
               **({"reduced_from": reduced} if reduced else {})}
        meta["plates"].append(rec)
        return rec, size, shift

    def publish(i):
        """Ce qui est pret, et ce qui vient : la vue peut s'ouvrir sur les premiers plateaux."""
        if not key:
            return
        rest = [{"n": n_, "name": pn_, "pending": True} for n_, pn_, _ in work[i + 1:]]
        if asm_lst:
            rest.append({"n": ASSEMBLED_N, "name": "Assemblé", "assembled": True, "pending": True})
        PARTIAL[key] = {**meta, "pending": True, "plates": [dict(p) for p in meta["plates"]] + rest}
        if _CHILD["on"]:
            _side(key, "partial.json", PARTIAL[key])

    for i, (n, pname, lst) in enumerate(work):
        where["tag"] = f"Plateau {i + 1}/{len(work)}"
        zchg = zch.get(n)                               # les changements de filament en hauteur de ce plateau
        groups_out, total, pw = emit(lst, zchg=zchg)
        r = write(n, pname, groups_out, total, pw)
        if r:
            rec, size, _ = r
            # un lithophane (28/10/2026) : dit par son nom (plateau, modele, pieces « litho… »), ou une plaque mince
            # (6 mm au plus) et large ; la vue propose alors la lumiere derriere
            if bool(_LITHO.search(f"{pname} {names_txt}")) or (size[2] <= 6 and min(size[0], size[1]) >= 40):
                rec["litho"] = True
            # les hauteurs de changement de filament, pour les dire sous la vue
            if zchg:
                rec["z_colors"] = [[round(zt, 2), str(c).lstrip("#").upper()[:6]] for zt, _, c, _ in zchg[1]]
        publish(i)
    if asm_lst:
        where["tag"] = "Vue assemblée"
        own: dict = {}
        # une piece = une partie d'un objet, comme dans Bambu Studio (29/10/2026 : par objet, un plateau range en un seul
        # objet bougeait d'un bloc ; plus fin, le decoupage automatique en morceaux allait trop loin : c'est l'edition qui
        # propose de separer une piece, a la demande)
        plist = [(ident, p[4]) for ident, parts in asm_lst for p in parts]
        piece_of = {(ident, tag[0]): i for i, (ident, tag) in enumerate(plist)}
        zplate = {}
        for n_, _, inst in plates:
            if not zch.get(n_):
                continue
            for oid, k in inst:
                mts = items_by_obj.get(oid) or []
                if k < len(mts):
                    for part in parts_of(oid, mts[k]):
                        zplate[((oid, k), part[4][0])] = (zch[n_], part[2])
        groups_out, total, pw = emit(asm_lst, own=own, piece_of=piece_of, zplate=zplate)
        # toujours montree quand le 3MF en a une (29/10/2026 : le tri « vraie vue / copie des plateaux » en
        # cachait trop ; c'est a chacun de juger en la regardant) ; posee a la va-vite, elle est rangee
        # ou est chaque objet sur les plateaux (plateau, orientation) : pour reconnaitre un tas de pieces posees
        # telles qu'imprimees
        on_plate = {}
        for n_, _, inst in plates:
            for oid, k in inst:
                mts = items_by_obj.get(oid) or []
                if k < len(mts):
                    on_plate[(oid, k)] = (n_, mts[k][:9])
        moved: dict = {}
        tidy = _tidy(own, {(oid, k): mt for oid, k, mt in asm}, on_plate, moved)
        r = write(ASSEMBLED_N, "Assemblé", groups_out, total, pw, {"assembled": True, "z_asm": True, **({"tidied": True} if tidy else {})})
        if r:
            # les pieces, pour l'edition (29/10/2026) : leur cle (objet:instance), leur nom, et « o », le decalage de
            # leurs sommets affiches par rapport a leur place dans le 3MF (rangement, recentrage) : les positions
            # editees sont gardees par rapport au 3MF, et restent justes si la vue est refaite autrement
            rec, _, shift = r
            rec["pieces"] = [{"k": f"{oid}:{k}:{tag[0]}", "name": tag[1] or f"Objet {oid}",
                              "o": [round(float(x), 4) for x in (moved.get((oid, k), np.zeros(3)) - shift)]}
                             for (oid, k), tag in plist]
    elif asm:
        logger.info(f"[3D] {key or src.name} : vue d'assemblage ignoree (un seul objet, ou des objets absents du 3MF)")
    _write(out_dir / "plates.json", json.dumps(meta).encode("utf-8"))
    return meta


_TOUCH = 1.0                           # mm : deux objets a moins que ca se touchent (vue assemblee)
_GAP = 10.0                            # mm entre deux blocs ranges


def _is_pile(ids, box, asm_rot: dict, on_plate: dict) -> bool:
    """Un tas, pas un assemblage (29/10/2026, un Bip Bip aux pieces posees l'une sur l'autre) : des pieces de
    plateaux differents (imprimees a part), qui se recouvrent largement, et :
      - soit toutes au sol (aucune soulevee) exactement comme imprimees (meme orientation que sur leur plateau) ;
      - soit toutes deposees au meme point sans rotation (Bambu Studio les pose a l'origine quand le createur n'a
        rien assemble : le Bip Bip, dont des pieces sont tournees sur leur plateau, d'autres posees sur une autre
        piece) ; la, au moins la moitie des pieces doivent etre prises dans le tas (une tour de pieces empilees au
        meme point se touche par les faces, sans se recouvrir).
    Un vrai assemblage de pieces imprimees a part en tourne ou en souleve au moins une ; des pieces d'un meme
    plateau qui se chevauchent (imprimees ensemble, emboitees : le perroquet) n'en sont pas un."""
    import numpy as np
    if len({on_plate.get(i, (None,))[0] for i in ids}) < 2:
        return False
    if any(i not in on_plate or i not in asm_rot for i in ids):
        return False
    piled = set()
    for x in range(len(ids)):
        for y in range(x + 1, len(ids)):
            a, b = box[ids[x]], box[ids[y]]
            inter = np.clip(np.minimum(a[1], b[1]) - np.maximum(a[0], b[0]), 0, None)
            va, vb = np.prod(np.maximum(a[1] - a[0], 1e-6)), np.prod(np.maximum(b[1] - b[0], 1e-6))
            if np.prod(inter) > 0.3 * min(va, vb):
                piled |= {ids[x], ids[y]}
    if not piled:
        return False
    as_printed = all(box[i][0][2] <= 0.5 for i in ids) and \
        all(np.allclose(np.array(asm_rot[i][:9]), np.array(on_plate[i][1]), atol=1e-3) for i in ids)
    xy = np.array([asm_rot[i][9:11] for i in ids])
    dumped = all(np.allclose(np.array(asm_rot[i][:9]), np.eye(3).ravel(), atol=1e-3) for i in ids) \
        and bool(np.ptp(xy, axis=0).max() < 0.5) and len(piled) * 2 >= len(ids)
    return bool(as_printed or dumped)


def _tidy(own: dict, asm_rot: dict | None = None, on_plate: dict | None = None, moved: dict | None = None) -> bool:
    """Une vue d'assemblage eparpillee (29/10/2026 : des pieces a 80 cm les unes des autres) : les objets qui se
    touchent restent ensemble, comme le createur les a assembles ; les blocs a part sont poses au sol et ranges en
    carre, rapproches. Un seul bloc : rien ne bouge. Un tas de pieces posees l'une sur l'autre telles qu'imprimees
    (_is_pile) : chacune est rangee a part. Deplace les sommets sur place ; rend vrai si c'est range."""
    import numpy as np
    ids = [i for i, arrs in own.items() if arrs]
    if len(ids) < 2:
        return False
    box = {}
    for i in ids:
        lo = np.min([a.min(axis=0) for a in own[i] if len(a)], axis=0)
        hi = np.max([a.max(axis=0) for a in own[i] if len(a)], axis=0)
        box[i] = (lo, hi)
    if _is_pile(ids, box, asm_rot or {}, on_plate or {}):
        return _pack(own, [([i], box[i][0], box[i][1]) for i in ids], moved)
    up = {i: i for i in ids}

    def root(i):
        while up[i] != i:
            up[i] = up[up[i]]
            i = up[i]
        return i
    for x in range(len(ids)):
        for y in range(x + 1, len(ids)):
            a, b = box[ids[x]], box[ids[y]]
            if all(a[0][k] <= b[1][k] + _TOUCH and b[0][k] <= a[1][k] + _TOUCH for k in range(3)):
                up[root(ids[x])] = root(ids[y])
    blocks: dict = {}
    for i in ids:
        blocks.setdefault(root(i), []).append(i)
    if len(blocks) < 2:
        return False
    bb = []
    for members in blocks.values():
        lo = np.min([box[i][0] for i in members], axis=0)
        hi = np.max([box[i][1] for i in members], axis=0)
        bb.append((members, lo, hi))
    return _pack(own, bb, moved)


def _pack(own: dict, bb: list, moved: dict | None = None) -> bool:
    """Range des blocs [(objets, mini, maxi)] au sol, rapproches, en un ensemble a peu pres carre : des rangees
    remplies jusqu'a une largeur visee (la racine de la surface totale), les plus profonds d'abord (29/10/2026 : un
    nombre fixe de blocs par rangee laissait de grands vides entre Billy et une vis)."""
    import numpy as np
    bb.sort(key=lambda b: (-(b[2][1] - b[1][1]), -(b[2][0] - b[1][0])))
    area = sum((b[2][0] - b[1][0] + _GAP) * (b[2][1] - b[1][1] + _GAP) for b in bb)
    width = max(max(b[2][0] - b[1][0] for b in bb), float(np.sqrt(area)) * 1.1)
    x = y = row_h = 0.0
    for k, (members, lo, hi) in enumerate(bb):
        if x and x + (hi[0] - lo[0]) > width:
            x, y, row_h = 0.0, y + row_h + _GAP, 0.0
        off = np.array([x - lo[0], y - lo[1], -lo[2]])
        for i in members:
            for a in own[i]:
                a += off
            if moved is not None:
                moved[i] = off
        x += (hi[0] - lo[0]) + _GAP
        row_h = max(row_h, hi[1] - lo[1])
    return True


BIN_MAGIC = 0x42335632                 # « 2V3B » : le format compact (29/10/2026) ; sans lui, l'ancien
BIN_MAGIC_P = 0x50335632               # « 2V3P » : le meme, chaque groupe portant son numero de piece (vue assemblee)


def _pack_bin(groups: dict) -> bytes:
    """Un plateau en binaire compact (29/10/2026 : 26 Mo compresses pour un plateau de Billy, le telephone attendait
    le telechargement). Les positions sur 16 bits dans la boite du plateau (un pas de 0,006 mm pour 40 cm), les
    triangles en ecarts d'un indice au suivant ; chaque octet de rang a part (octets de poids faible ensemble...),
    ce que gzip compresse bien mieux.
    En-tete : u32 BIN_MAGIC (ou BIN_MAGIC_P), u32 nombre de groupes, f32 mini x,y,z, f32 pas x,y,z. Par groupe : u32
    couleur RGBA, u32 sommets, u32 triangles, (BIN_MAGIC_P : u32 numero de piece), puis 6 plans de sommets (x bas, x haut, y bas, y haut, z bas, z haut), puis 4 plans
    des ecarts d'indices (int32, petit-boutiste)."""
    import numpy as np
    lo = np.min([v.min(axis=0) for v, _ in groups.values()], axis=0)
    hi = np.max([v.max(axis=0) for v, _ in groups.values()], axis=0)
    sc = np.where(hi - lo > 0, (hi - lo) / 65535, 1.0)
    pieces = any(isinstance(k, tuple) for k in groups)
    buf = bytearray(struct.pack("<II3f3f", BIN_MAGIC_P if pieces else BIN_MAGIC, len(groups), *lo.tolist(), *sc.tolist()))
    for key, (v, t) in groups.items():
        col, piece = key if isinstance(key, tuple) else (key, 0)
        q = np.clip(np.round((v - lo) / sc), 0, 65535).astype("<u2")
        d = np.diff(t.ravel().astype(np.int64), prepend=0).astype("<i4")
        buf += struct.pack("<III", col, len(v), len(t))
        if pieces:
            buf += struct.pack("<I", piece)
        buf += q.view(np.uint8).reshape(-1, 6).T.tobytes()
        buf += d.view(np.uint8).reshape(-1, 4).T.tobytes()
    return bytes(buf)


def _smooth_terraces(v, t):
    """Une couche en marches d'un lithophane couleur (30/10/2026) : des colonnes a dessus et fond plats sur une grille
    reguliere (les couches cyan, magenta, jaune d'un Jack Skellington : 0,44 mm, des hauteurs par pas de 0,1 mm, chaque
    couche posee sur celle du dessous). Rend (sommets, triangles) de la meme couche en surfaces continues, dessus et
    fond passant par le centre de chaque colonne (l'epaisseur varie donc en douceur d'une colonne a l'autre), ou None
    si la piece n'est pas une telle couche (un relief deja continu, une piece ordinaire)."""
    import numpy as np
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    n = np.cross(b - a, c - a)
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    up, dn, side = n[:, 2] > 0.9, n[:, 2] < -0.9, np.abs(n[:, 2]) < 0.1
    if up.sum() < 64 or dn.sum() < 1 or (up | dn | side).mean() < 0.999:
        return None
    if len(np.unique(np.round(a[up, 2], 4))) > 64 or len(np.unique(np.round(a[dn, 2], 4))) > 64:
        return None                                       # des hauteurs continues : deja lisse

    def grid(x):
        u = np.unique(np.round(x, 4))
        d = np.diff(u)
        if len(d) < 8:
            return None
        st = float(np.median(d))
        if st <= 0 or np.mean(np.abs(d / st - np.round(d / st)) < 0.05) < 0.95:
            return None
        return st, float(u[0]), int(round((u[-1] - u[0]) / st))
    gx, gy = grid(v[:, 0]), grid(v[:, 1])
    if not gx or not gy:
        return None
    (sx, x0, nx), (sy, y0, ny) = gx, gy
    if nx * ny > 4_000_000:
        return None

    def heights(mask, fn, init):
        # chaque face plate, posee sur toutes les colonnes dont le centre tombe dedans (le fichier fusionne les zones
        # d'une meme hauteur en grands rectangles : un triangle couvre souvent beaucoup de colonnes)
        g = np.full((ny, nx), init)
        A, Bv, C = a[mask], b[mask], c[mask]
        z = (A[:, 2] + Bv[:, 2] + C[:, 2]) / 3
        lo_ = np.minimum(np.minimum(A, Bv), C)
        hi_ = np.maximum(np.maximum(A, Bv), C)
        i0 = np.clip(np.ceil((lo_[:, 0] - x0) / sx - 0.5 - 1e-6).astype(int), 0, nx - 1)
        i1 = np.clip(np.floor((hi_[:, 0] - x0) / sx - 0.5 + 1e-6).astype(int), 0, nx - 1)
        j0 = np.clip(np.ceil((lo_[:, 1] - y0) / sy - 0.5 - 1e-6).astype(int), 0, ny - 1)
        j1 = np.clip(np.floor((hi_[:, 1] - y0) / sy - 0.5 + 1e-6).astype(int), 0, ny - 1)
        for k in np.nonzero((i1 >= i0) & (j1 >= j0))[0]:
            ii, jj = np.meshgrid(np.arange(i0[k], i1[k] + 1), np.arange(j0[k], j1[k] + 1))
            px, py = x0 + (ii + 0.5) * sx, y0 + (jj + 0.5) * sy
            (ax, ay), (bx, by), (cx, cy) = A[k, :2], Bv[k, :2], C[k, :2]
            d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-12:
                continue
            l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
            l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
            inside = (l1 >= -1e-6) & (l2 >= -1e-6) & (1 - l1 - l2 >= -1e-6)
            if inside.any():
                fn.at(g, (jj[inside], ii[inside]), z[k])
        return g
    T = heights(up, np.maximum, -np.inf)
    B = heights(dn, np.minimum, np.inf)
    empty = ~np.isfinite(T) | ~np.isfinite(B)
    zmin = float(a[dn, 2].min())
    T[empty] = zmin
    B[empty] = zmin
    # un sommet au centre de chaque colonne ; le bord gagne une demi-colonne d'epaisseur nulle (l'emprise reste la meme)
    xs = np.concatenate([[x0], x0 + (np.arange(nx) + 0.5) * sx, [x0 + nx * sx]])
    ys = np.concatenate([[y0], y0 + (np.arange(ny) + 0.5) * sy, [y0 + ny * sy]])
    Bp = np.pad(B, 1, mode="edge")
    Tp = np.pad(T, 1, mode="edge")
    for sl in ((0, slice(None)), (-1, slice(None)), (slice(None), 0), (slice(None), -1)):
        Tp[sl] = Bp[sl]
    X, Y = np.meshgrid(xs, ys)
    W, Hn = len(xs), len(ys)
    top = np.stack([X.ravel(), Y.ravel(), Tp.ravel()], axis=1)
    bot = np.stack([X.ravel(), Y.ravel(), Bp.ravel()], axis=1)
    idx = np.arange(W * Hn).reshape(Hn, W)
    q0, q1, q2, q3 = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel()
    # les carres sans aucune epaisseur sont omis (le fond y touche le dessus)
    th = (Tp - Bp) > 1e-6
    keep = th[:-1, :-1].ravel() | th[:-1, 1:].ravel() | th[1:, :-1].ravel() | th[1:, 1:].ravel()
    q0, q1, q2, q3 = q0[keep], q1[keep], q2[keep], q3[keep]
    tt = np.concatenate([np.stack([q0, q1, q3], 1), np.stack([q0, q3, q2], 1)])
    tb = np.concatenate([np.stack([q0, q3, q1], 1), np.stack([q0, q2, q3], 1)]) + len(top)
    return np.concatenate([top, bot]).astype(v.dtype), np.concatenate([tt, tb]).astype(t.dtype)


def _decimate(groups_out: dict, target: int) -> int:
    """Un plateau trop lourd pour un telephone (29/10/2026 : la vue assemblee de Billy, 6,8 millions de triangles,
    n'etait pas montree) : les sommets tres proches sont fusionnes (une grille, de plus en plus large jusqu'a passer
    sous target), les triangles devenus plats retires. La forme reste, les details fins s'estompent. Rend le nombre
    de triangles restant ; groups_out est remplace sur place."""
    import numpy as np
    flat = {col: (np.concatenate(g[0]), np.concatenate(g[1])) for col, g in groups_out.items()}
    lo = np.min([v.min(axis=0) for v, _ in flat.values()], axis=0)
    hi = np.max([v.max(axis=0) for v, _ in flat.values()], axis=0)
    cell = float(np.linalg.norm(hi - lo)) / 4000 or 0.01
    out, total = {}, 0
    for _ in range(12):
        out, total = {}, 0
        for col, (v, t) in flat.items():
            q = np.floor((v - lo) / cell).astype(np.int64)
            k = (q[:, 0] << 42) | (q[:, 1] << 21) | q[:, 2]
            _, first, inv = np.unique(k, return_index=True, return_inverse=True)
            nt = inv.reshape(-1)[t]
            keep = (nt[:, 0] != nt[:, 1]) & (nt[:, 1] != nt[:, 2]) & (nt[:, 0] != nt[:, 2])
            nt = nt[keep]
            out[col] = (v[first], nt)
            total += len(nt)
        if total <= target:
            break
        cell *= 1.5
    for col, (v, t) in out.items():
        groups_out[col] = [[v], [t], len(v)]
    return total


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


def _fresh(meta: dict) -> bool:
    """Une vue a jour : du format en cours ; une vue assemblee d'un 3MF a changements de filament en hauteur doit les
    avoir pris (30/10/2026), les autres vues ne se refont pas pour autant."""
    if not isinstance(meta, dict) or meta.get("v") != FORMAT_V:
        return False
    pl = meta.get("plates") or []
    return not (any(p.get("z_colors") for p in pl) and any(p.get("assembled") and not p.get("z_asm") for p in pl))


def ready(src: Path, key: str) -> bool:
    """Deja converti (et a jour) ?"""
    meta_f = _root() / key / "plates.json"
    try:
        return meta_f.is_file() and meta_f.stat().st_mtime >= src.stat().st_mtime             and _fresh(json.loads(meta_f.read_text(encoding="utf-8")))
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
            if _fresh(meta):
                return meta
        # perdu en local mais sauvegarde sur le NAS (et a jour) : repris, sans reconvertir
        if not meta_f.is_file():
            try:
                from .archive import restore_3d
                if restore_3d(key, d) and meta_f.is_file():
                    meta = json.loads(meta_f.read_text(encoding="utf-8"))
                    if _fresh(meta) and any(p.get("size_mm") for p in meta.get("plates") or []):
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
        PARTIAL.pop(key, None)
        for f in ("progress.json", "partial.json"):
            try:
                (d / f).unlink()
            except OSError:
                pass


async def from_3mf_early(src: Path, key: str) -> dict | None:
    """Comme from_3mf, mais rend la main des qu'un plateau est pret (« pending » : la suite se prepare encore,
    la vue redemande). La conversion continue en fond ; une seule a la fois par modele."""
    import asyncio
    t = _RUNNING.get(key)
    if t is None or t.done():
        if ready(src, key):
            return _read_side(key, "plates.json")
        # dans un processus a part, lui aussi (29/10/2026) : dans le serveur, la conversion lui prenait la main,
        # et l'envoi des plateaux deja prets comme l'avancement attendaient leur tour
        t = _RUNNING[key] = asyncio.ensure_future(asyncio.to_thread(_in_child, src, key, "view"))
    while not t.done():
        part = PARTIAL.get(key) or _read_side(key, "partial.json")
        if part and any(p.get("size_mm") for p in part.get("plates") or []):
            return part
        await asyncio.wait({t}, timeout=0.25)
    return _read_side(key, "plates.json") if t.result() else None


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
# La conversion de fond dans un processus a part (29/10/2026) : lire des dizaines de Mo de XML en Python tient la
# main de l'interpreteur, et dans un fil du serveur elle figeait toute l'appli (blocages de plusieurs secondes,
# meme sur /progress, quand le changement de format a fait refaire toutes les vues). Un seul processus, de priorite
# basse ; la vue ouverte par quelqu'un, elle, reste dans le serveur (son avancement s'affiche).
_POOL = {"bg": None, "view": None}         # le fond (priorite basse), et la vue ouverte (sans attendre le fond)


def _child_convert(src: str, key: str, low: bool) -> bool:
    if low:
        try:
            os.nice(10)
        except (AttributeError, OSError):
            pass
    _CHILD["on"], _CHILD["last"] = True, None
    for f in ("progress.json", "partial.json"):        # ceux d'une conversion interrompue
        try:
            (_root() / key / f).unlink()
        except OSError:
            pass
    return _from_3mf(Path(src), key) is not None


def _noop() -> bool:
    import numpy  # noqa : charge d'avance ce que la conversion utilise
    return True


def _pool(name: str):
    if _POOL[name] is None:
        import concurrent.futures
        import multiprocessing
        _POOL[name] = concurrent.futures.ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"))
    return _POOL[name]


def warm_view_pool() -> None:
    """Demarre le processus de la vue ouverte des le lancement : la premiere vue n'attend pas son demarrage."""
    try:
        _pool("view").submit(_noop)
    except Exception:
        pass


def _in_child(src: Path, key: str, pool: str = "bg") -> bool:
    """Convertit dans un processus a part (garde le verrou du modele : la vue ouverte en meme temps attend la meme
    conversion, et suit son avancement par ses fichiers). Repli dans ce processus s'il ne demarre pas."""
    with _lock(key):
        if ready(src, key):
            return True
        try:
            return _pool(pool).submit(_child_convert, str(src), key, pool == "bg").result()
        except Exception as e:
            logger.warning(f"[3D] processus de conversion indisponible ({type(e).__name__}: {e}) : conversion sur place")
            _POOL[pool] = None
            return _from_3mf(src, key) is not None


async def prepare(iid: str) -> None:
    """Convertit en fond le 3MF d'origine d'une instance (juste apres sa recuperation)."""
    import asyncio
    from .mw_source import path_of
    src = path_of(iid)
    if src.is_file() and not ready(src, iid):
        await asyncio.to_thread(_in_child, src, iid)


def _all_sources() -> list:
    """[(3MF d'origine, cle)] : ceux du serveur, puis ceux qui ne sont plus que sur le NAS (vides du local) ; le NAS
    est un rangement comme un autre, que l'appli lit (29/10/2026). Les plus recents d'abord."""
    from .mw_source import _dir
    out, seen = [], set()
    for f in sorted(_dir().glob("*.3mf"), key=lambda f: f.stat().st_mtime, reverse=True):
        out.append((f, f.stem))
        seen.add(f.stem)
    try:
        from .archive import _index, archived_path
        nas = []
        for k, e in list(_index().items()):
            if k.startswith("lib:") and k[4:] not in seen and isinstance(e, dict):
                q = archived_path(k)                      # NAS absent : rien de ce cote
                if q is not None:
                    nas.append((q, k[4:], e.get("at") or 0))
        out += [(q, iid) for q, iid, _ in sorted(nas, key=lambda x: -x[2])]
    except Exception:
        logger.exception("[3D] 3MF d'origine du NAS")
    return out


def _view_ok(src: Path, key: str) -> bool:
    """La vue est prete : en local, ou sa copie a jour sur le NAS (la vue la reprend a l'ouverture ; pas recopiee
    en local d'avance, ce qui defairait le vidage)."""
    if ready(src, key):
        return True
    try:
        from .archive import _index, DEFAULT_ROOT
        e = _index().get(f"3d:{key}")
        if isinstance(e, dict) and e.get("to"):
            m = json.loads((Path(e.get("root") or DEFAULT_ROOT) / e["to"] / "plates.json").read_text(encoding="utf-8"))
            return _fresh(m)
    except (OSError, ValueError, ImportError):
        pass
    return False


def _drop_bad_dirs() -> None:
    """Les vues rangees par erreur sous le nom d'un fichier du NAS (titre du modele, 29/10/2026) : jamais servies (la
    route des plateaux refuse ces noms), on les retire ; la vue se refait sous l'identifiant du profil."""
    import shutil
    try:
        for d in _root().iterdir():
            if d.is_dir() and not re.fullmatch(r"[A-Za-z0-9_]+", d.name):
                shutil.rmtree(d, ignore_errors=True)
                logger.info(f"[3D] vue mal rangee retiree : {d.name}")
    except OSError:
        pass


# l'avancement de la preparation de fond (29/10/2026), pour Parametres > Taches
WARM: dict = {"running": False, "done": 0, "total": 0, "all": 0, "current": None, "started": None, "finished": None,
              "stopped": None}


async def warm_loop(first_delay_s: int = 90, period_s: int = 12 * 3600) -> None:
    """Les 3MF d'origine deja gardes, convertis un a un (quelques secondes entre deux), puis a chaque passage
    ceux qui manquent : la premiere ouverture d'une vue 3D n'a plus a attendre."""
    from ..core import tasks as _tasks
    import asyncio
    await asyncio.sleep(5)
    await asyncio.to_thread(warm_view_pool)
    await asyncio.to_thread(_drop_bad_dirs)
    await _tasks.sleep("mw_3d", first_delay_s)
    import time
    while True:
        try:
            files = await asyncio.to_thread(_all_sources)
            todo = [(f, k) for f, k in files if not _view_ok(f, k)]
            WARM.update(running=bool(todo), done=0, total=len(todo), all=len(files), started=time.time(), finished=None,
                        current=None, stopped=None)
            for f, k in todo:
                WARM["current"] = f"{len(files) - len(todo) + WARM['done']} vues prêtes sur {len(files)} 3MF d'origine"
                if not _view_ok(f, k):                  # ouverte entre-temps : deja faite
                    await asyncio.to_thread(_in_child, f, k)
                WARM["done"] += 1
                await asyncio.sleep(3)
            WARM.update(running=False, finished=time.time(), current=f"{len(files)} vues prêtes sur {len(files)} 3MF d'origine")
            if todo:
                logger.info(f"[3D] {len(todo)} modele(s) prepare(s) pour la vue 3D")
        except Exception:
            WARM.update(running=False, stopped="Erreur, reprise au prochain passage")
            _tasks.error("mw_3d")
            logger.exception("[3D] preparation des vues 3D")
        await _tasks.sleep("mw_3d", period_s)


# ── L'assemblage edite dans l'appli (29/10/2026) ──
# Par vue (cle du 3MF), la place de chaque piece de la vue assemblee, editee a la main sur PC : une matrice 4x4 (en
# colonnes, comme three.js) qui mene les sommets de la piece, a leur place dans le 3MF, a leur place editee. Gardee a
# part de la vue (une vue refaite ne la perd pas).
def _edits_file(key: str) -> Path:
    from ..core.config import settings
    return Path(settings.DATA_DIR) / "mw_3d_edits" / f"{key}.json"


_KEY = re.compile(r"[A-Za-z0-9_]+")
# chaque version enregistree est gardee (30/10/2026 : un assemblage enregistre s'est encore perdu) : la precedente part
# dans _old/ a chaque enregistrement, et « Vue du 3MF » y range l'assemblage au lieu de l'effacer
_KEEP = 40


def _old_dir() -> Path:
    from ..core.config import settings
    return Path(settings.DATA_DIR) / "mw_3d_edits" / "_old"


def _did_of(key: str) -> str | None:
    """Le modele d'une vue : note dans l'edition, sinon l'index des 3MF (cle « modele:profil » -> vue)."""
    try:
        from .mw_source import _index
        for k, v in _index().items():
            if v == key:
                return str(k).split(":")[0]
    except Exception:
        pass
    return None


def _read(f: Path) -> dict | None:
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) and isinstance(d.get("pieces"), dict) else None
    except (OSError, ValueError):
        return None


def _backup(key: str, why: str) -> None:
    """L'edition actuelle de cette vue, copiee dans _old/ (jamais perdue) ; les plus anciennes au-dela de _KEEP partent."""
    import time
    cur = _edits_file(key)
    d = _read(cur)
    if not d:
        return
    od = _old_dir()
    od.mkdir(parents=True, exist_ok=True)
    d = {**d, "key": key, "saved_as": why, "archived": time.time()}
    _write(od / f"{key}.{int(time.time() * 1000)}.json", json.dumps(d).encode("utf-8"))
    olds = sorted(od.glob(f"{key}.*.json"))
    for f in olds[:-_KEEP]:
        try:
            f.unlink()
        except OSError:
            pass


def load_edit(key: str, did: str | None = None, piece_keys: set | None = None) -> dict | None:
    """L'assemblage edite de cette vue. A defaut, celui d'une autre vue du meme modele (un autre profil, une vue
    rangee autrement) dont les pieces sont les memes : marque « from_key », a reenregistrer sous cette vue."""
    if not _KEY.fullmatch(key or ""):
        return None
    d = _read(_edits_file(key))
    if d or not did:
        return d
    best = None
    try:
        files = list(_edits_file(key).parent.glob("*.json"))
    except OSError:
        files = []
    for f in files:
        o = _read(f)
        if not o or (o.get("did") or _did_of(f.stem)) != str(did):
            continue
        # les pieces comparees par objet et instance (« objet:instance ») : les cles plus fines ont change au fil des versions
        ks, want = {":".join(k.split(":")[:2]) for k in o["pieces"]}, {":".join(str(k).split(":")[:2]) for k in piece_keys or ()}
        if want and len(ks & want) < max(1, len(ks) * 0.8):
            continue
        if not best or (o.get("at") or 0) > (best.get("at") or 0):
            best = {**o, "from_key": f.stem}
    if best:
        logger.info(f"[3D] assemblage de {key} repris de la vue {best['from_key']} (meme modele {did})")
    return best


def save_edit(key: str, pieces: dict, by: str = "", groups: list | None = None, joints: list | None = None,
              splits: list | None = None, did: str | None = None, excluded: list | None = None, cuts: dict | None = None) -> dict:
    import time
    if not _KEY.fullmatch(key or ""):
        raise ValueError("Vue inconnue")
    clean = {}
    for k, m in (pieces or {}).items():
        # « #n » : un exemplaire ajoute de la piece (30/10/2026)
        if re.fullmatch(r"\d+:\d+:\d+(:\d+)?(#\d{1,3})?", str(k)) and isinstance(m, list) and len(m) == 16 \
                and all(isinstance(x, (int, float)) and abs(x) < 1e6 for x in m):
            clean[str(k)] = [round(float(x), 6) for x in m]
    if not clean:
        raise ValueError("Rien à enregistrer")
    # les groupes : des pieces qui bougent ensemble (listes de cles connues)
    grp = [[str(k) for k in g if str(k) in clean] for g in (groups or []) if isinstance(g, list)]
    # les collages : piece collee, support, et le contact dans le repere du support
    num = lambda v, n: isinstance(v, list) and len(v) == n and all(isinstance(x, (int, float)) and abs(x) < 1e6 for x in v)
    jts = [{"a": str(j["a"]), "b": str(j["b"]), "kind": "edge" if j.get("kind") == "edge" else "face", "p": j["p"], "n": j["n"],
            **({"e": j["e"]} if num(j.get("e"), 3) else {})}
           for j in (joints or []) if isinstance(j, dict) and str(j.get("a")) in clean and str(j.get("b")) in clean
           and num(j.get("p"), 3) and num(j.get("n"), 3)]
    # les pieces separees a la main (refaites en morceaux a l'ouverture), et la version de l'edition
    spl = [str(k) for k in (splits or []) if re.fullmatch(r"\d+:\d+:\d+", str(k))]
    did = str(did) if did and str(did).isdigit() else _did_of(key)
    # les pieces exclues de l'assemblage (30/10/2026) : plus montrees, remises depuis la liste des pieces
    exc = [str(k) for k in (excluded or []) if str(k) in clean]
    # les coups de couteau (30/10/2026) : piece entiere -> secteurs {e, a, b} (l'oeil et les deux bords du trait, dans
    # son repere), seulement pour une piece separee
    cut = {}
    for k, lst in (cuts or {}).items() if isinstance(cuts, dict) else []:
        if str(k) not in spl or not isinstance(lst, list):
            continue
        # un trait {e, a, b}, ou « detacher les supports » {sup: 1} ; et la boite du morceau vise
        # ou un coup de gomme {erase: {maillage: [triangles]}} (200 000 triangles au plus)
        def rub(x):
            if not isinstance(x, dict):
                return None
            out = {str(int(k)): sorted({int(t) for t in v if isinstance(t, int) and 0 <= t < 50_000_000})
                   for k, v in x.items() if str(k).isdigit() and isinstance(v, list)}
            out = {k: v for k, v in out.items() if v}
            return out if out and sum(len(v) for v in out.values()) <= 200_000 else None
        ok = []
        for w in lst[:50]:
            if not isinstance(w, dict):
                continue
            box = {"box": w["box"]} if num(w.get("box"), 6) else {}
            if w.get("sup"):
                ok.append({"sup": 1, **box})
            elif w.get("clean"):
                ok.append({"clean": 1, **box})
            elif w.get("erase") is not None:
                if (r := rub(w.get("erase"))):
                    ok.append({"erase": r})
            elif all(num(w.get(x), 3) for x in ("e", "a", "b")):
                ok.append({"e": w["e"], "a": w["a"], "b": w["b"], **box})
        if ok:
            cut[str(k)] = ok
    d = {"pieces": clean, "groups": [g for g in grp if len(g) > 1], "joints": jts, "splits": spl, "excluded": exc, "v": 2,
         **({"cuts": cut} if cut else {}),
         "at": time.time(), "by": by, **({"did": did} if did else {})}
    _backup(key, "remplacee")
    f = _edits_file(key)
    f.parent.mkdir(parents=True, exist_ok=True)
    _write(f, json.dumps(d).encode("utf-8"))
    logger.info(f"[3D] assemblage enregistre : vue {key}, {len(clean)} pieces (modele {did or '?'})")
    return d


def drop_edit(key: str) -> None:
    """« Vue du 3MF » : l'assemblage n'est plus montre, mais il reste dans les versions (on peut le reprendre)."""
    if _KEY.fullmatch(key or ""):
        _backup(key, "vue du 3MF")
        try:
            _edits_file(key).unlink()
        except OSError:
            pass


def edit_versions(key: str, did: str | None = None) -> list:
    """Les assemblages que l'on peut reprendre pour cette vue : ses versions passees, et ceux des autres vues du meme
    modele (le plus recent d'abord)."""
    if not _KEY.fullmatch(key or ""):
        return []
    out = []
    pats = [(_old_dir(), f"{key}.*.json")]
    if did:
        pats += [(_edits_file(key).parent, "*.json"), (_old_dir(), "*.json")]
    seen = set()
    for d0, pat in pats:
        try:
            files = list(d0.glob(pat))
        except OSError:
            continue
        for f in files:
            if f in seen or f == _edits_file(key):
                continue
            seen.add(f)
            o = _read(f)
            if not o:
                continue
            k = o.get("key") or f.stem.split(".")[0]
            if k != key and (o.get("did") or _did_of(k)) != str(did or ""):
                continue
            out.append({"id": f"{'old/' if d0 == _old_dir() else ''}{f.stem}", "at": o.get("at"), "archived": o.get("archived"),
                        "why": o.get("saved_as"), "n": len(o["pieces"]), "other": k != key})
    out.sort(key=lambda x: -(x.get("at") or 0))
    return out[:60]


def _prof_of(key: str) -> str | None:
    """Le profil MakerWorld d'une vue (index des 3MF : cle « modele:profil » -> vue)."""
    try:
        from .mw_source import _index
        for k, v in _index().items():
            if v == key and ":" in str(k):
                return str(k).split(":", 1)[1] or None
    except Exception:
        pass
    return None


def edits_for_design(did: str) -> list:
    """Mes assemblages enregistres de ce modele, une vue par entree (30/10/2026 : lus par mes copains, qui peuvent les
    voir sur leur propre vue du meme modele et les reprendre)."""
    if not str(did or "").isdigit():
        return []
    out = []
    try:
        files = list(_edits_file("x").parent.glob("*.json"))
    except OSError:
        files = []
    for f in files:
        o = _read(f)
        if not o or (o.get("did") or _did_of(f.stem)) != str(did):
            continue
        out.append({"key": f.stem, "profile": _prof_of(f.stem), "at": o.get("at"), "n": len(o["pieces"]),
                    **{k: o.get(k) or [] for k in ("groups", "joints", "splits", "excluded")}, "cuts": o.get("cuts") or {},
                    "pieces": o["pieces"]})
    out.sort(key=lambda x: -(x.get("at") or 0))
    return out[:5]


def restore_edit(key: str, vid: str, by: str = "") -> dict:
    """Reprend une version (« old/<cle>.<ms> » ou « <autre cle> ») comme assemblage de cette vue."""
    old = vid.startswith("old/")
    stem = vid[4:] if old else vid
    if not _KEY.fullmatch(key or "") or not re.fullmatch(r"[A-Za-z0-9_]+(\.\d+)?", stem):
        raise ValueError("Version inconnue")
    o = _read((_old_dir() if old else _edits_file(key).parent) / f"{stem}.json")
    if not o:
        raise ValueError("Version introuvable")
    return save_edit(key, o["pieces"], by, o.get("groups"), o.get("joints"), o.get("splits"), o.get("did"), o.get("excluded"), o.get("cuts"))
