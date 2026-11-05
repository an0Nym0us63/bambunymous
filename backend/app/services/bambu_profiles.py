"""Les profils des filaments Bambu (05/11/2026) : ce que Bambu Studio sait de chaque filament Bambu, par son identifiant
(« GFA00 » : PLA Basic) : densite, temperatures (buse, plateaux), debit maximal, temperature de ramollissement, sechage
conseille (AMS : temperature et duree), prix catalogue. Source : le depot bambulab/BambuStudio (tenu par Bambu Lab).

BBL.json liste les profils ; on lit les « @base » (un par filament) et leurs parents (« fdm_filament_pla »…), dont ils
heritent ce qu'ils ne redefinissent pas. Relu avec le nuancier (24 h, ETag de BBL.json : rien n'est relu s'il n'a pas
change). Garde dans DATA_DIR/bambu_catalog/profiles.json (meme sauvegarde que le nuancier).
"""
import json
import logging
import os
import time
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

RAW = "https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles"
UA = "BambuNymous-CatalogSync/1.0"
FILE = "profiles.json"
KEYS = ("filament_density", "filament_cost", "filament_max_volumetric_speed", "nozzle_temperature",
        "nozzle_temperature_range_low", "nozzle_temperature_range_high", "hot_plate_temp", "textured_plate_temp",
        "cool_plate_temp", "eng_plate_temp", "temperature_vitrification", "filament_dev_ams_drying_temperature",
        "filament_dev_ams_drying_time", "filament_dev_chamber_drying_bed_temperature", "filament_vendor", "filament_type",
        "filament_soluble", "filament_is_support", "impact_strength_z")


def _dir() -> str:
    from ..core.config import settings
    d = os.path.join(settings.DATA_DIR, "bambu_catalog")
    os.makedirs(d, exist_ok=True)
    return d


def _get(url: str, etag: str = None):
    h = {"User-Agent": UA}
    if etag:
        h["If-None-Match"] = etag
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r:
            return json.loads(r.read()), r.headers.get("ETag")
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return None, etag
        raise


def _first(v):
    if isinstance(v, list):
        return v[0] if v else None
    return v


def sync_once(force: bool = False) -> bool:
    d = _dir()
    meta_f = os.path.join(d, FILE + ".etag")
    etag = None
    if not force and os.path.exists(os.path.join(d, FILE)) and os.path.exists(meta_f):
        etag = open(meta_f).read().strip() or None
    try:
        idx, new_etag = _get(f"{RAW}/BBL.json", etag)
    except Exception as e:
        logger.warning(f"[BBL] index des profils injoignable : {e}")
        return False
    if idx is None:
        return False
    paths = {x["name"]: x["sub_path"] for x in idx.get("filament_list") or [] if isinstance(x, dict) and x.get("name")}
    cache: dict = {}

    def load(name: str, depth: int = 0) -> dict:
        """Le profil complet : ses parents d'abord, puis lui."""
        if name in cache:
            return cache[name]
        sub = paths.get(name)
        if not sub or depth > 8:
            return {}
        try:
            p, _e = _get(f"{RAW}/BBL/{urllib.parse.quote(sub)}")
        except Exception:
            p = None
        p = p or {}
        full = dict(load(p["inherits"], depth + 1)) if p.get("inherits") else {}
        full.update(p)
        cache[name] = full
        time.sleep(0.05)
        return full

    out = {}
    for name in paths:
        if not name.endswith("@base"):
            continue
        full = load(name)
        fid = full.get("filament_id")
        if not fid:
            continue
        e = {"name": name.replace(" @base", "")}
        for k in KEYS:
            v = _first(full.get(k))
            if v not in (None, "", "nil"):
                e[k] = v
        out[str(fid).upper()] = e
    if not out:
        return False
    tmp = os.path.join(d, FILE + ".part")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"at": time.time(), "profiles": out}, fh, ensure_ascii=False)
    os.replace(tmp, os.path.join(d, FILE))
    if new_etag:
        with open(meta_f, "w") as fh:
            fh.write(new_etag)
    logger.info(f"[BBL] {len(out)} profils de filaments Bambu")
    return True


_IDX = {"mt": None, "v": {}}


def profiles() -> dict:
    f = os.path.join(_dir(), FILE)
    try:
        mt = os.path.getmtime(f)
    except OSError:
        return {}
    if _IDX["mt"] != mt:
        try:
            _IDX.update(mt=mt, v=json.load(open(f, encoding="utf-8")).get("profiles") or {})
        except (OSError, ValueError):
            return {}
    return _IDX["v"]


def of(profile_id: str) -> dict | None:
    return profiles().get(str(profile_id or "").upper()) or None
