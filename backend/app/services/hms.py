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


def init_hms():
    """Charge le cache disque + un eventuel dump complet fourni par l'utilisateur."""
    global _loaded
    if _loaded:
        return
    _loaded = True
    try:
        if _CACHE_FILE.exists():
            _labels.update({_norm_key(k): v for k, v in
                            json.loads(_CACHE_FILE.read_text("utf-8")).items()})
    except Exception as e:
        logger.warning(f"[HMS] cache illisible: {e}")

    for name in (f"hms_{_LANG}.json", "hms.json"):
        f = _DATA / name
        if not f.exists():
            continue
        try:
            data = json.loads(f.read_text("utf-8"))
            n0 = len(_labels)
            if isinstance(data, dict):
                for k, v in data.items():
                    _labels[_norm_key(k)] = v if isinstance(v, str) else (
                        v.get("intro") or v.get("desc") or v.get("detail") or "")
            elif isinstance(data, list):
                for e in data:
                    key = _norm_key(e.get("ecode") or e.get("code") or "")
                    txt = e.get("intro") or e.get("desc") or e.get("detail") or ""
                    if key and txt:
                        _labels[key] = txt
            logger.info(f"[HMS] {len(_labels) - n0} libelles charges depuis {name}")
        except Exception as e:
            logger.warning(f"[HMS] lecture {name}: {e}")
        break


def _persist():
    try:
        _CACHE_FILE.write_text(json.dumps(_labels, ensure_ascii=False), "utf-8")
    except Exception:
        pass


def _pretty(attr: int, code: int) -> str:
    return f"{attr >> 16:04X}_{attr & 0xFFFF:04X}_{code >> 16:04X}_{code & 0xFFFF:04X}"


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


def decode_hms(hms_errors, schedule_fetch: bool = True):
    """Tableau brut MQTT -> liste enrichie {code, severity, label, wiki}."""
    out = []
    for e in (hms_errors or []):
        try:
            attr = int(e.get("attr", 0))
            code = int(e.get("code", 0))
        except (TypeError, ValueError, AttributeError):
            continue
        pretty = _pretty(attr, code)
        key = pretty.replace("_", "")
        label = _labels.get(key)
        if label is None and schedule_fetch:
            try:
                asyncio.get_running_loop().create_task(_fetch_label(key))
            except RuntimeError:
                pass
        out.append({
            "code": pretty,
            "severity": _SEVERITY.get(code >> 16, "info"),
            "label": label,
            "wiki": f"https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/{pretty}",
        })
    order = {"fatal": 0, "serious": 1, "common": 2, "info": 3}
    out.sort(key=lambda x: order.get(x["severity"], 9))
    return out
