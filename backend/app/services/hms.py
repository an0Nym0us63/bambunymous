"""Decodage des codes HMS (Health Management System) de l'imprimante Bambu.

Le MQTT fournit print.hms = [{attr:int, code:int}, ...]. On en tire, pour l'UI :
  - le code lisible          0700_7000_0002_0008
  - la severite              code>>16 : 1 fatal, 2 serious, 3 common, 4 info
  - le lien wiki officiel
  - le libelle si connu      via /data/hms_<lang>.json (dump Bambu Studio) OU un
                             cache alimente au fil de l'eau depuis l'endpoint
                             officiel Bambu (best effort, jamais bloquant).
"""
import asyncio
import json
import logging
import os
from pathlib import Path

import aiohttp

logger = logging.getLogger(__name__)

_SEVERITY = {1: "fatal", 2: "serious", 3: "common", 4: "info"}
_LANG = os.getenv("HMS_LANG", "fr")
_DATA = Path(os.getenv("DATA_DIR", "/data"))
_CACHE_FILE = _DATA / "hms_labels_cache.json"
_FETCH = os.getenv("HMS_FETCH", "1") != "0"   # lookup en ligne (best effort)

_labels: dict = {}       # code_key (16 hex majuscules) -> libelle
_fetching: set = set()
_loaded = False


def _norm_key(s) -> str:
    return "".join(ch for ch in str(s).upper() if ch in "0123456789ABCDEF")


def _ingest(data) -> int:
    """Absorbe un mapping de libelles, quel que soit son format :
       - dict plat {code: "libelle"} (notre cache / fusion embarquee) ;
       - format Bambu brut {data:{device_hms:{fr:[{ecode,intro}]}}} (dump Studio /
         reponse e.bambulab.com) ;
       - liste [{ecode/code, intro/desc}]."""
    n0 = len(_labels)
    if isinstance(data, dict) and isinstance(data.get("data"), dict) \
            and isinstance(data["data"].get("device_hms"), dict):
        for lang, arr in data["data"]["device_hms"].items():
            if isinstance(arr, list):
                for e in arr:
                    k = _norm_key(e.get("ecode") or e.get("code") or "")
                    t = (e.get("intro") or e.get("desc") or "").strip()
                    if k and t:
                        _labels[k] = t
    elif isinstance(data, dict):
        for k, v in data.items():
            t = v if isinstance(v, str) else (
                (v.get("intro") or v.get("desc") or "") if isinstance(v, dict) else "")
            k2 = _norm_key(k)
            if k2 and t:
                _labels[k2] = t
    elif isinstance(data, list):
        for e in data:
            k = _norm_key(e.get("ecode") or e.get("code") or "")
            t = (e.get("intro") or e.get("desc") or "").strip()
            if k and t:
                _labels[k] = t
    return len(_labels) - n0


def _load_file(path: Path):
    try:
        if path.exists():
            n = _ingest(json.loads(path.read_text("utf-8")))
            logger.info(f"[HMS] {n} libelles depuis {path.name}")
    except Exception as e:
        logger.warning(f"[HMS] lecture {path.name}: {e}")


def init_hms():
    """Charge : le mapping embarque (repo) -> le cache disque -> un dump utilisateur
    (/data/hms_<lang>.json). Chaque source complete/ecrase la precedente."""
    global _loaded
    if _loaded:
        return
    _loaded = True
    _load_file(Path(__file__).parent / "hms_data" / f"hms_{_LANG}.json")  # embarque
    _load_file(_CACHE_FILE)                                               # cache runtime
    for name in (f"hms_{_LANG}.json", "hms.json"):                        # dump utilisateur
        f = _DATA / name
        if f.exists():
            _load_file(f)
            break


def _persist():
    try:
        _CACHE_FILE.write_text(json.dumps(_labels, ensure_ascii=False), "utf-8")
    except Exception:
        pass


def _pretty(attr: int, code: int) -> str:
    return f"{attr >> 16:04X}_{attr & 0xFFFF:04X}_{code >> 16:04X}_{code & 0xFFFF:04X}"


# Modules AMS/filament : octet haut de attr_hi. Pour eux, l'unite AMS (octet bas de
# attr_hi) et le slot (2e quartet de attr_lo) sont des INDEX ; la page wiki est
# generique (AMS A / slot 1) -> on remet ces index a zero pour pointer la bonne
# page. Les autres modules ont ces bits significatifs : on n'y touche pas.
_AMS_HI = {0x07, 0x12, 0x18}

def _wiki_pretty(attr: int, code: int) -> str:
    ahi = (attr >> 16) & 0xFFFF
    alo = attr & 0xFFFF
    if (ahi >> 8) in _AMS_HI:
        ahi &= 0xFF00
        alo &= 0xF0FF
    return f"{ahi:04X}_{alo:04X}_{code >> 16:04X}_{code & 0xFFFF:04X}"


# Segment "modele" de l'URL wiki. Bambu a des pages par famille (x1 / h2 / a1 / p1).
# On deduit la famille du model_id MQTT (ex. C12 = H2D, BL-P001 = X1C) ou du nom ;
# override possible via HMS_WIKI_MODEL (utile pour l'H2C dont le code peut varier).
# Defaut x1 : chemin le plus universel.
_WIKI_MODEL_ENV = os.getenv("HMS_WIKI_MODEL", "auto").strip().lower()

def _wiki_model(model_id: str = "", model_name: str = "") -> str:
    if _WIKI_MODEL_ENV and _WIKI_MODEL_ENV != "auto":
        return _WIKI_MODEL_ENV
    blob = f"{model_id or ''} {model_name or ''}".upper()
    if "H2" in blob or "C12" in blob:                                  # H2C/H2D/H2S/H2D Pro
        return "h2"
    if "X1" in blob or "BL-P00" in blob or "C11" in blob:              # X1/X1C/X1E
        return "x1"
    if "A1" in blob or "C20" in blob or "C21" in blob:                 # A1/A1 mini
        return "a1"
    if "P1" in blob or "C13" in blob or "C24" in blob:                 # P1P/P1S
        return "p1"
    return "x1"


def _find_label(obj):
    """Extrait un libelle d'une reponse JSON de forme inconnue (best effort)."""
    if isinstance(obj, str):
        return obj.strip() or None
    if isinstance(obj, dict):
        for k in ("intro", "desc", "detail", "content", "long", "result_str"):
            v = obj.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        for v in obj.values():
            r = _find_label(v)
            if r:
                return r
    if isinstance(obj, list):
        for v in obj:
            r = _find_label(v)
            if r:
                return r
    return None


async def _fetch_label(code_key: str):
    if not _FETCH or code_key in _labels or code_key in _fetching:
        return
    _fetching.add(code_key)
    try:
        url = f"https://e.bambulab.com/query.php?lang={_LANG}&e={code_key}"
        headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
        async with aiohttp.ClientSession(headers=headers) as s:
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=6)) as r:
                if r.status == 200:
                    try:
                        j = await r.json(content_type=None)
                    except Exception:
                        j = None
                    label = _find_label(j) if j is not None else None
                    if label:
                        _labels[code_key] = label
                        _persist()
                        logger.info(f"[HMS] libelle recupere pour {code_key}")
    except Exception as e:
        logger.debug(f"[HMS] fetch {code_key}: {e}")
    finally:
        _fetching.discard(code_key)


def decode_hms(hms_errors, model_id: str = "", model_name: str = "", schedule_fetch: bool = True):
    """Tableau brut MQTT -> liste enrichie {code, severity, label, wiki}."""
    out = []
    seg = _wiki_model(model_id, model_name)
    for e in (hms_errors or []):
        try:
            attr = int(e.get("attr", 0))
            code = int(e.get("code", 0))
        except (TypeError, ValueError, AttributeError):
            continue
        pretty = _pretty(attr, code)            # code exact (precis : AMS C slot 4)
        wiki_code = _wiki_pretty(attr, code)    # code canonique pour la page wiki
        key = pretty.replace("_", "")
        norm_key = wiki_code.replace("_", "")
        # libelle : precis d'abord, sinon le generique de la page canonique
        label = _labels.get(key) or _labels.get(norm_key)
        if label is None and schedule_fetch:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(_fetch_label(key))
                if norm_key != key:
                    loop.create_task(_fetch_label(norm_key))
            except RuntimeError:
                pass
        out.append({
            "code": pretty,
            "severity": _SEVERITY.get(code >> 16, "info"),
            "label": label,
            "wiki": f"https://wiki.bambulab.com/{_LANG}/{seg}/troubleshooting/hmscode/{wiki_code}",
        })
    order = {"fatal": 0, "serious": 1, "common": 2, "info": 3}
    out.sort(key=lambda x: order.get(x["severity"], 9))
    return out
