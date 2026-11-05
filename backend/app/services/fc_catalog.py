"""Les couleurs mesurees (05/11/2026) : FilamentColors.xyz, une bibliotheque communautaire d'echantillons imprimes et
photographies, chacun avec sa couleur MESUREE (hex), et pour une partie sa transparence (TD, l'epaisseur en mm sous
laquelle la lumiere passe : celle des HueForge). Plus de 300 marques, Bambu Lab compris.

Ni un catalogue de plus, ni une source de fiches : un complement. Pour un filament (marque, nom de couleur, type), on
retrouve son echantillon et on montre sa couleur mesuree a cote de la notre, sa TD, sa photo ; l'administrateur peut
la reprendre. Jamais posee d'office (regle : pas de hex invente, et pas d'ecrasement silencieux non plus).

L'API (Django REST, 100 par page) demande qu'on garde les donnees en cache : /api/version/ dit si la base a change ; on
ne relit tout (23 pages, une seconde entre chaque) que dans ce cas, une fois par semaine au plus. Garde dans
DATA_DIR/fc_catalog/ (sauvegarde NAS « Systeme », graphe de stockage « catalogue »).
"""
import asyncio
import json
import logging
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

API = "https://filamentcolors.xyz/api"
SITE = "https://filamentcolors.xyz"
INDEX_FILE, VERSION_FILE = "index.json", "version.json"
INTERVAL_S = 7 * 86400
FORMAT = 2                                      # la forme de l'index (2 : temperatures, RAL, Pantone) ; autre : relu
TIMEOUT_S = 60
PAUSE_S = 1.0                                   # entre deux pages : on ne martele pas leur serveur
UA = "BambuNymous-CatalogSync/1.0 (cache hebdomadaire)"


def _dir() -> Path:
    from ..core.config import settings
    d = Path(settings.DATA_DIR) / "fc_catalog"
    d.mkdir(parents=True, exist_ok=True)
    return d


def norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return json.loads(r.read())


def _entry(x: dict) -> dict | None:
    if not isinstance(x, dict) or not x.get("published", True):
        return None
    hx = str(x.get("hex_color") or "").lstrip("#").upper()
    if not re.fullmatch(r"[0-9A-F]{6}", hx):
        return None
    ft = x.get("filament_type") or {}
    td = x.get("td")
    return {"id": x.get("id"), "slug": x.get("slug"), "brand": str((x.get("manufacturer") or {}).get("name") or "").strip(),
            "type": str(ft.get("name") or "").strip(), "parent": str((ft.get("parent_type") or {}).get("name") or "").strip(),
            "name": str(x.get("color_name") or "").strip(), "hex": hx,
            "td": float(td) if isinstance(td, (int, float)) and td > 0 else None,
            "img": x.get("card_img") or x.get("image_front"), "link": x.get("mfr_purchase_link") or x.get("amazon_purchase_link"),
            "avail": bool(x.get("is_available", True)),
            # (05/11/2026) les temperatures de son type, et les teintes de reference les plus proches
            "hot": ft.get("hot_end_temp") or None, "bed": ft.get("bed_temp") or None,
            "ral": " ".join(str(v) for v in ((x.get("closest_ral_1") or {}).get("code"), (x.get("closest_ral_1") or {}).get("name")) if v) or None,
            "pantone": (x.get("closest_pantone_1") or {}).get("code") or None}


def sync_once(force: bool = False) -> bool:
    """Relit la bibliotheque si elle a change depuis la derniere fois ; True si l'index a ete refait."""
    d = _dir()
    try:
        ver = _get(f"{API}/version/?format=json")
    except (urllib.error.URLError, ValueError, OSError) as e:
        logger.warning(f"[FC] version injoignable : {e}")
        return False
    old = {}
    try:
        old = json.loads((d / VERSION_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    fresh = (d / INDEX_FILE).is_file() and old.get("db_last_modified") == ver.get("db_last_modified") and old.get("v") == FORMAT
    if not force and fresh:
        return False
    out, url, pages = [], f"{API}/swatch/?format=json&page_size=100", 0
    while url and pages < 200:
        page = _get(url)
        for x in page.get("results") or []:
            e = _entry(x)
            if e and e["brand"] and e["name"]:
                out.append(e)
        url, pages = page.get("next"), pages + 1
        if url:
            time.sleep(PAUSE_S)
    if not out:
        return False
    idx = {"built": time.time(), "db_last_modified": ver.get("db_last_modified"), "entries": out,
           "brands": sorted({e["brand"] for e in out}, key=str.casefold)}
    tmp = d / f"{INDEX_FILE}.part"
    tmp.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    tmp.replace(d / INDEX_FILE)
    (d / VERSION_FILE).write_text(json.dumps({**ver, "v": FORMAT}), encoding="utf-8")
    logger.info(f"[FC] {len(out)} couleurs mesurées, {len(idx['brands'])} marques ({pages} pages)")
    return True


async def loop() -> None:
    from ..core import tasks as _tasks
    await _tasks.sleep("catalog_fc", 120)              # apres le demarrage (et apres les autres catalogues)
    while True:
        try:
            await asyncio.to_thread(sync_once)
        except Exception:
            _tasks.error("catalog_fc")
            logger.exception("[FC] synchro")
        await _tasks.sleep("catalog_fc", INTERVAL_S)


# ── Lecture ──
_IDX = {"mt": None, "v": None}


def index() -> dict | None:
    f = _dir() / INDEX_FILE
    try:
        mt = f.stat().st_mtime
    except OSError:
        return None
    if _IDX["mt"] != mt:
        try:
            v = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        by_brand: dict = {}
        for e in v.get("entries") or []:
            by_brand.setdefault(_brand_key(e["brand"]), []).append(e)
        v["by_brand"] = by_brand
        _IDX.update(mt=mt, v=v)
    return _IDX["v"]


def _brand_key(b) -> str:
    k = norm(b)
    return {"bambu": "bambulab", "bambulabs": "bambulab"}.get(k, k)


def _rgb(h):
    h = str(h or "").lstrip("#")[:6]
    try:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except (ValueError, IndexError):
        return None


def _dist(a, b) -> float:
    ra, rb = _rgb(a), _rgb(b)
    if not ra or not rb:
        return 999.0
    return sum((x - y) ** 2 for x, y in zip(ra, rb)) ** 0.5


_TYPE_WORDS = re.compile(r"[a-z]+")


def _type_score(fc_type: str, fila_type: str, material: str) -> int:
    """0 (meme type) a 3 (rien en commun) : « PLA Matte » chez nous, « Matte PLA » chez eux."""
    a = set(_TYPE_WORDS.findall(str(fc_type or "").lower()))
    b = set(_TYPE_WORDS.findall(f"{fila_type or ''} {material or ''}".lower()))
    if not a or not b:
        return 2
    if a == b or a <= b:
        return 0
    fam = {"pla", "petg", "pet", "abs", "asa", "tpu", "pa", "pc", "pva", "hips", "pctg"}
    if a & b & fam:
        return 1
    return 3


# les mots de finition et de type, retires des noms avant de les comparer (« Matte Ivory White » chez eux, « Ivory White »
# en PLA Matte chez nous)
_NOISE = {"matte", "matt", "silk", "basic", "translucent", "transparent", "glossy", "satin", "pla", "petg", "abs", "asa", "tpu",
          "hf", "plus", "pro", "meta", "tough", "high", "speed", "hs", "rapid", "galaxy", "sparkle", "marble", "wood", "metal",
          "cf", "gf", "filament", "the", "de", "et"}


_FINISH = {"matte", "matt", "silk", "translucent", "transparent", "glossy", "satin", "galaxy", "sparkle", "marble", "wood",
           "metal", "glow", "dual", "tri", "gradient", "rainbow", "glitter"}


def core(name) -> str:
    """Les mots qui font la couleur, dans l'ordre alphabetique (« White Jade » chez eux, « Jade White » chez Bambu)."""
    return "".join(sorted(w for w in re.findall(r"[a-z0-9]+", str(name or "").lower()) if w not in _NOISE))


def matches(brand: str, names: list, fila_type: str = "", material: str = "", hex_: str = "", limit: int = 3) -> list:
    """Les echantillons de ce filament, du plus sur au moins sur : [{..., how: "nom" | "teinte", score}]. Le meme nom de
    couleur dans la meme marque d'abord (le type departage) ; sans nom qui colle, la teinte la plus proche de la meme
    marque et du meme type, seulement si elle est vraiment proche (pour info, jamais « sure »)."""
    idx = index()
    if not idx or not brand:
        return []
    pool = idx["by_brand"].get(_brand_key(brand)) or []
    if not pool:
        return []
    raw = {norm(n) for n in names if n}
    want = {core(n) for n in names if n}
    want.discard("")
    out = []
    for e in pool:
        en = core(e["name"])
        ts = _type_score(e["type"], fila_type, material)
        if ts >= 3:                                     # une autre matiere (un PETG pour un PLA) : jamais
            continue
        # le nom porte notre sous-type (« Meta Black » pour un PLA Meta noir) : il passe devant
        tw = set(re.findall(r"[a-z]+", f"{fila_type or ''}".lower())) - {"pla", "petg", "abs", "asa", "tpu", "pa", "pc"}
        bonus = -0.5 if tw & set(re.findall(r"[a-z]+", e["name"].lower())) else 0
        # une finition dans leur nom qui n'est pas la notre (« Marble Red » pour un PLA Basic rouge) : derriere
        ours = set(re.findall(r"[a-z]+", f"{fila_type or ''} {' '.join(n or '' for n in names)}".lower()))
        if (set(re.findall(r"[a-z]+", e["name"].lower())) & _FINISH) - ours:
            bonus += 1.5
        if norm(e["name"]) in raw:                     # le nom tel quel avant un nom qui ne colle qu'une fois nettoye
            bonus -= 0.3
        if en and en in want:
            out.append((0 + ts + bonus, e, "nom"))
        # un nom contenu dans l'autre, seulement s'il en couvre l'essentiel (« White » ne suffit pas pour « Jade White »)
        elif en and any(w and (w in en or en in w) and min(len(w), len(en)) >= 6
                        and min(len(w), len(en)) / max(len(w), len(en)) >= 0.7 for w in want):
            out.append((4 + ts, e, "nom"))
    if not out and hex_:
        for e in pool:
            ts = _type_score(e["type"], fila_type, material)
            dd = _dist(hex_, e["hex"])
            if ts <= 1 and dd < 28:
                out.append((10 + ts + dd / 10, e, "teinte"))
    out.sort(key=lambda t: (t[0], _dist(hex_, t[1]["hex"]) if hex_ else 0))
    return [{**e, "how": how, "score": round(s, 1), "url": f"{SITE}/swatch/{e['id']}/" if e.get("id") else None,
             "dist": round(_dist(hex_, e["hex"]), 1) if hex_ else None} for s, e, how in out[:limit]]


def status() -> dict:
    idx = index()
    return {"available": bool(idx), "count": len((idx or {}).get("entries") or []), "brands": len((idx or {}).get("brands") or []),
            "built": (idx or {}).get("built")}


# ── Une source de references (05/11/2026) : les couleurs qu'aucun autre catalogue n'a ──
# FilamentColors a souvent des couleurs (et des marques) que l'Open Filament Database n'a pas : elles s'ajoutent aux
# « autres marques », a la meme forme, source « fc », sans doublon (meme marque, meme famille, meme nom de couleur).
# Bambu Lab en est retire : son nuancier officiel reste la reference.
def _family(e: dict):
    from ..core.materials import family_of
    return family_of(e.get("type"), e.get("parent")) or (e.get("parent") if e.get("parent") and len(e["parent"]) <= 5 else None)


def view(e: dict) -> dict:
    from .bambu_catalog import fr_name
    from . import ofd_catalog
    from .type_transco import apply as transco
    fam = _family(e) or ""
    ft = transco(e.get("type"), fam) or e.get("type")
    sw, src = None, None
    db = (ofd_catalog.index() or {}).get("spool_db") or {}
    b = ofd_catalog.norm(e["brand"])
    for k in (f"{b}|{fam.upper()}|1000", f"{b}||1000"):
        if k in db:
            sw, src = db[k], "spoolman"
            break
    return {"source": "fc", "fila_id": f"fc-{e['id']}", "ref": str(e["id"]), "fila_color_code": "", "color_code": "",
            "brand": e["brand"], "fila_type": ft, "gamme": e.get("type"), "family": fam, "name": e["name"],
            "name_fr": fr_name({"en": e["name"]}), "color_hex": e["hex"], "colors": [e["hex"]], "color_type": "monochrome",
            "color_type_fr": "monochrome", "filament_weight_g": 1000, "spool_weight_g": sw, "spool_src": src,
            "measured": True, "td": e.get("td"), "img": e.get("img"), "url": f"{SITE}/swatch/{e['id']}/",
            "discontinued": not e.get("avail", True),
            "tech": {k: v for k, v in {"nozzle_min": e.get("hot"), "bed_min": e.get("bed"),
                                       "links": [{"store": (e.get("link") or "").split("//")[-1].split("/")[0], "url": e["link"]}] if e.get("link") else None}.items() if v},
            "fc": e}


def _taken() -> set:
    """(marque, famille, nom) deja dans notre catalogue ou l'Open Filament Database."""
    from . import ofd_catalog, own_catalog
    from ..core.materials import family_of
    out = set()
    for e in (ofd_catalog.index() or {}).get("entries") or []:
        out.add((_brand_key(e.get("brand")), (family_of(e.get("gamme"), e.get("material")) or e.get("material") or "").upper(), core(e.get("name"))))
    for x in own_catalog.items():
        out.add((_brand_key(x.get("brand")), str(x.get("family") or "").upper(), core(x.get("name"))))
    return out


_EXTRA = {"key": None, "v": []}


def extras() -> list:
    """Les echantillons qui ajoutent une reference (pas Bambu Lab, pas deja ailleurs), recalcules quand un index change."""
    from . import ofd_catalog
    idx = index()
    if not idx:
        return []
    ofd_catalog.index()
    key = (_IDX["mt"], ofd_catalog._IDX.get("mt"))
    if _EXTRA["key"] != key:
        taken = _taken()
        seen, out = set(), []
        for e in idx.get("entries") or []:
            bk = _brand_key(e["brand"])
            if bk == "bambulab":
                continue
            k = (bk, (_family(e) or "").upper(), core(e["name"]))
            if not k[2] or k in taken or k in seen:
                continue
            seen.add(k)
            out.append(e)
        _EXTRA.update(key=key, v=out)
    return _EXTRA["v"]


def brands() -> dict:
    """{marque normalisee: (nom, nombre, familles)} des references en plus."""
    acc: dict = {}
    for e in extras():
        a = acc.setdefault(_brand_key(e["brand"]), [e["brand"], 0, set()])
        a[1] += 1
        a[2].add(_family(e))
    return {k: (v[0], v[1], v[2]) for k, v in acc.items()}


def search(brand: str = "", family: str = "", q: str = "") -> list:
    b, ql = _brand_key(brand) if brand else "", (q or "").strip().casefold()
    out = []
    for e in extras():
        if b and _brand_key(e["brand"]) != b:
            continue
        if family and (_family(e) or "").lower() != family.lower():
            continue
        if ql and ql not in f"{e['name']} {e.get('type')} {e['brand']}".casefold():
            continue
        out.append(e)
    out.sort(key=lambda e: (not e.get("avail", True), str(e.get("type") or "").casefold(), e["name"].casefold()))
    return [view(e) for e in out]


def all_brands() -> list:
    """Toutes les marques de la bibliotheque, Bambu Lab compris (le navigateur des catalogues) : [{name, count}]."""
    idx = index()
    if not idx:
        return []
    return sorted(({"name": v[0]["brand"], "count": len(v)} for v in idx["by_brand"].values()), key=lambda b: b["name"].casefold())


def browse(brand: str = "", q: str = "", limit: int = 600) -> dict:
    """Toute la bibliotheque (pas seulement les references en plus), pour la parcourir."""
    idx = index()
    if not idx:
        return {"available": False, "entries": []}
    b, ql = _brand_key(brand) if brand else "", (q or "").strip().casefold()
    pool = idx["by_brand"].get(b, []) if b else idx.get("entries") or []
    out = [e for e in pool if not ql or ql in f"{e['name']} {e.get('type')} {e['brand']}".casefold()]
    out.sort(key=lambda e: (str(e.get("type") or "").casefold(), e["name"].casefold()))
    return {"available": True, "total": len(out), "entries": [view(e) for e in out[:limit]]}


def entry(ref: str) -> dict | None:
    idx = index()
    if not idx:
        return None
    r = str(ref or "").removeprefix("fc-")
    e = next((e for e in idx.get("entries") or [] if str(e.get("id")) == r), None)
    return view(e) if e else None
