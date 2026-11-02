"""Le catalogue des autres marques (02/11/2026) : Sunlu, Geeetech, Polymaker, eSun…

Source : l'Open Filament Database (Open Filament Collective, licence MIT), un export complet reconstruit chaque jour
(marques, gammes, couleurs avec leur hex, tailles). Bambu Lab en est retire : son catalogue officiel reste la
reference (codes couleur, profils).

Le poids du support vide y est rarement donne (environ 1 % des tailles) : a defaut, celui de SpoolmanDB (licence MIT),
qui le donne pour chaque gamme, le plus frequent pour la meme marque, la meme matiere et le meme poids net, sinon
pour la marque et le poids net. Sans rien, le support de la marque des Parametres (services/spool_tare).

Telecharges chaque semaine dans DATA_DIR/ofd_catalog/ (dans la sauvegarde NAS, « Systeme ») ; index.json, construit
au telechargement, ne garde que ce que l'appli lit.
"""
import asyncio
import collections
import gzip
import hashlib
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

OFD_URL = "https://api.openfilamentdatabase.org/json/all.json.gz"
SPOOLMAN_URL = "https://donkie.github.io/SpoolmanDB/filaments.json"
OFD_FILE, SPOOLMAN_FILE, INDEX_FILE = "all.json.gz", "spoolman.json", "index.json"
INTERVAL_S = 7 * 86400
TIMEOUT_S = 60
UA = "BambuNymous-CatalogSync/1.0"
SKIP_BRANDS = {"bambulab"}                      # le catalogue officiel Bambu s'en charge


def _dir() -> Path:
    from ..core.config import settings
    d = Path(settings.DATA_DIR) / "ofd_catalog"
    d.mkdir(parents=True, exist_ok=True)
    return d


def norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


# ── Telechargement ──
def _fetch(url: str, fname: str) -> bool:
    """Telecharge si change (ETag) ; True si le fichier a change."""
    d = _dir()
    etag_f = d / f"{fname}.etag"
    headers = {"User-Agent": UA}
    if etag_f.is_file() and (d / fname).is_file():
        headers["If-None-Match"] = etag_f.read_text().strip()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=TIMEOUT_S) as r:
            body, etag = r.read(), r.headers.get("ETag")
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return False
        logger.warning(f"[OFD] HTTP {e.code} pour {fname}")
        return False
    except Exception as e:
        logger.warning(f"[OFD] reseau, {fname} : {e}")
        return False
    # verifie avant d'ecrire (un fichier abime garde l'ancien)
    try:
        json.loads(gzip.decompress(body) if fname.endswith(".gz") else body)
    except Exception as e:
        logger.warning(f"[OFD] {fname} illisible : {e}")
        return False
    old = (d / fname).read_bytes() if (d / fname).is_file() else b""
    if etag:
        etag_f.write_text(etag)
    if hashlib.sha256(old).digest() == hashlib.sha256(body).digest():
        return False
    tmp = d / f"{fname}.part"
    tmp.write_bytes(body)
    tmp.replace(d / fname)
    logger.info(f"[OFD] {fname} mis a jour ({len(body) // 1024} Ko)")
    return True


def _gamme(name: str, brand: str) -> str:
    """Le nom de la gamme sans la marque ni « Filament » devant (« 123-3D Filament PLA » -> « PLA »)."""
    n = str(name or "").strip()
    b = re.escape(str(brand or "").strip())
    n = re.sub(rf"^{b}\s*", "", n, flags=re.I) if b else n
    n = re.sub(r"^filament\s+", "", n, flags=re.I).strip()
    return n or str(name or "").strip()


def build_index() -> dict:
    """index.json a partir des deux fichiers telecharges."""
    d = _dir()
    raw = json.loads(gzip.decompress((d / OFD_FILE).read_bytes()))
    brands = {b["id"]: b for b in raw.get("brands") or [] if isinstance(b, dict) and b.get("id")}
    fils = {f["id"]: f for f in raw.get("filaments") or [] if isinstance(f, dict) and f.get("id")}
    sizes = collections.defaultdict(list)
    for s in raw.get("sizes") or []:
        if isinstance(s, dict) and s.get("variant_id"):
            sizes[s["variant_id"]].append(s)
    # SpoolmanDB : le support le plus frequent par (marque, matiere, poids net), puis (marque, poids net)
    sm = collections.defaultdict(collections.Counter)
    try:
        for x in json.loads((d / SPOOLMAN_FILE).read_text(encoding="utf-8")):
            w, sw = x.get("weight"), x.get("spool_weight")
            if not isinstance(w, (int, float)) or not isinstance(sw, (int, float)) or not 0 < sw <= 1000:
                continue
            b, m = norm(x.get("manufacturer")), str(x.get("material") or "").upper()
            sm[f"{b}|{m}|{int(w)}"][float(sw)] += 1
            sm[f"{b}||{int(w)}"][float(sw)] += 1
    except (OSError, ValueError, TypeError):
        pass
    spool_db = {k: c.most_common(1)[0][0] for k, c in sm.items()}
    out, counts = [], collections.Counter()
    for v in raw.get("variants") or []:
        if not isinstance(v, dict):
            continue
        f = fils.get(v.get("filament_id")) or {}
        b = brands.get(f.get("brand_id")) or {}
        bname = str(b.get("name") or "").strip()
        if not bname or norm(bname) in SKIP_BRANDS:
            continue
        hexes = [h for h in (v.get("color_hexes") or []) if isinstance(h, str)]
        ws = []
        for s in sizes.get(v["id"], []):
            fw, ew = s.get("filament_weight"), s.get("empty_spool_weight")
            if isinstance(fw, (int, float)) and fw > 0 and (s.get("diameter") in (None, 1.75)):
                ws.append([int(fw), float(ew) if isinstance(ew, (int, float)) and 0 < ew <= 1000 else None])
        out.append({"ref": v["id"], "brand": bname, "gamme": _gamme(f.get("name"), bname), "material": str(f.get("material") or ""),
                    "name": str(v.get("name") or "").strip(), "hex": str(v.get("color_hex") or ""), "hexes": hexes,
                    "traits": sorted(k for k, on in (v.get("traits") or {}).items() if on), "weights": ws,
                    "disc": bool(v.get("discontinued") or f.get("discontinued"))})
        counts[bname] += 1
    idx = {"version": raw.get("version"), "generated_at": raw.get("generated_at"), "built": time.time(),
           "brands": sorted(counts.items(), key=lambda x: x[0].casefold()), "entries": out, "spool_db": spool_db}
    tmp = d / f"{INDEX_FILE}.part"
    tmp.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    tmp.replace(d / INDEX_FILE)
    logger.info(f"[OFD] index : {len(out)} couleurs, {len(counts)} marques")
    return idx


def sync_once() -> bool:
    a = _fetch(OFD_URL, OFD_FILE)
    b = _fetch(SPOOLMAN_URL, SPOOLMAN_FILE)
    if (a or b or not (_dir() / INDEX_FILE).is_file()) and (_dir() / OFD_FILE).is_file():
        build_index()
        return True
    return False


async def loop() -> None:
    from ..core import tasks as _tasks
    await _tasks.sleep("catalog_ofd", 60)              # apres le demarrage
    while True:
        try:
            await asyncio.to_thread(sync_once)
        except Exception:
            _tasks.error("catalog_ofd")
            logger.exception("[OFD] synchro")
        await _tasks.sleep("catalog_ofd", INTERVAL_S)


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
        v["by_ref"] = {e["ref"]: e for e in v.get("entries") or []}
        _IDX.update(mt=mt, v=v)
    return _IDX["v"]


def _weight(e: dict) -> tuple:
    """(poids net, poids du support, d'ou il vient) de la taille d'1 kg si elle existe, sinon de la premiere."""
    ws = e.get("weights") or []
    w = next((x for x in ws if x[0] == 1000), ws[0] if ws else [1000, None])
    if w[1]:
        return w[0], w[1], "catalogue"
    db = (index() or {}).get("spool_db") or {}
    b = norm(e.get("brand"))
    for k in (f"{b}|{str(e.get('material') or '').upper()}|{w[0]}", f"{b}||{w[0]}"):
        if k in db:
            return w[0], db[k], "spoolman"
    return w[0], None, None


def view(e: dict) -> dict:
    """Une couleur, a la forme des entrees du catalogue Bambu (/catalog/search), plus la marque et le support."""
    from ..core.materials import family_of
    from .bambu_catalog import fr_name
    hexes = [h.lstrip("#")[:8].upper() for h in (e.get("hexes") or [])] or [e.get("hex", "").lstrip("#")[:8].upper()]
    multi = len(hexes) > 1
    ctype = ("gradient" if "gradual_color_change" in (e.get("traits") or []) else "coaxial") if multi else "monochrome"
    fw, sw, src = _weight(e)
    return {"source": "ofd", "fila_id": e["ref"], "ref": e["ref"], "fila_color_code": "", "color_code": "",
            "brand": e.get("brand"), "fila_type": e.get("gamme"), "family": family_of(e.get("gamme"), e.get("material")) or e.get("material"),
            "name": e.get("name"), "name_fr": fr_name({"en": e.get("name")}), "color_hex": hexes[0], "colors": hexes,
            "color_type": ctype, "color_type_fr": ctype, "filament_weight_g": fw, "spool_weight_g": sw, "spool_src": src,
            "discontinued": e.get("disc", False)}


def brands() -> dict:
    from ..core.materials import family_of
    idx = index()
    if not idx:
        return {"available": False, "brands": []}
    fams = collections.defaultdict(set)
    for e in idx.get("entries") or []:
        fams[e["brand"]].add(family_of(e.get("gamme"), e.get("material")) or e.get("material"))
    return {"available": True, "version": idx.get("version"),
            "brands": [{"name": b, "count": n, "families": sorted(x for x in fams[b] if x)} for b, n in idx.get("brands") or []]}


def search(brand: str = "", family: str = "", q: str = "", limit: int = 400) -> dict:
    from ..core.materials import family_of
    idx = index()
    if not idx:
        return {"available": False, "entries": []}
    b, ql = norm(brand), (q or "").strip().casefold()
    out = []
    for e in idx.get("entries") or []:
        if b and norm(e["brand"]) != b:
            continue
        if family and (family_of(e.get("gamme"), e.get("material")) or e.get("material") or "").lower() != family.lower():
            continue
        if ql and ql not in f"{e.get('name')} {e.get('gamme')} {e.get('brand')}".casefold():
            continue
        out.append(e)
    out.sort(key=lambda e: (e.get("disc", False), e.get("gamme", "").casefold(), e.get("name", "").casefold()))
    return {"available": True, "total": len(out), "entries": [view(e) for e in out[:limit]]}


def entry(ref: str) -> dict | None:
    e = ((index() or {}).get("by_ref") or {}).get(str(ref or ""))
    return view(e) if e else None
