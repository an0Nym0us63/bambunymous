import os
import re
from collections import deque
from fastapi import APIRouter, Depends, Query
from .auth import get_current_user

router = APIRouter()
LOG_FILE = "/data/bambunymous.log"

_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})[,.]\d+ (\w+) (\S+) (.*)$")

_EXCLUDE = ("/api/v1/logs", "/api/v1/printer", "/healthz", "/favicon", "/assets/")
_EXCLUDE_NAMES = ("aiosqlite", "NullPool", "Engine", "sqlalchemy")

LOG_MAX_BYTES   = 500 * 1024 * 1024   # Purge auto au-delà de 500 Mo
LOG_KEEP_BYTES  =  50 * 1024 * 1024   # On conserve les 50 derniers Mo après purge

LEVEL_ORDER = {"DEBUG": 0, "INFO": 1, "WARNING": 2, "ERROR": 3, "CRITICAL": 4}


def _parse(line: str):
    m = _RE.match(line.strip())
    if not m:
        return None
    dt, level, name, msg = m.groups()
    if any(x in msg for x in _EXCLUDE):
        return None
    if any(name.startswith(x) for x in _EXCLUDE_NAMES):
        return None
    return {"ts": dt[11:19], "date": dt[:10], "level": level, "name": name.split(".")[-1], "msg": msg}


def _tail_lines(filepath: str, n: int) -> list[str]:
    """Lit les n dernières lignes du fichier efficacement."""
    CHUNK = 65536
    lines: deque = deque()
    count = 0
    with open(filepath, "rb") as f:
        f.seek(0, 2)
        pos = f.tell()
        buf = b""
        while pos > 0 and count < n:
            read = min(CHUNK, pos)
            pos -= read
            f.seek(pos)
            chunk = f.read(read)
            buf = chunk + buf
            parts = buf.split(b"\n")
            buf = parts[0]
            for part in reversed(parts[1:]):
                lines.appendleft(part.decode("utf-8", errors="replace"))
                count += 1
                if count >= n:
                    break
        if buf:
            lines.appendleft(buf.decode("utf-8", errors="replace"))
    return list(lines)


def _search_full_file(filepath: str, q: str, min_level: str, limit: int) -> list[dict]:
    """Scanne TOUT le fichier — retourne les N dernières correspondances."""
    ql = q.lower()
    min_idx = LEVEL_ORDER.get(min_level, 0)
    results: deque = deque(maxlen=limit)
    with open(filepath, "r", errors="replace") as f:
        for line in f:
            p = _parse(line)
            if not p:
                continue
            if LEVEL_ORDER.get(p["level"], 0) < min_idx:
                continue
            if ql and ql not in p["msg"].lower() and ql not in p["name"].lower():
                continue
            results.append(p)
    return list(results)


def _auto_purge(filepath: str) -> bool:
    """Si le fichier dépasse LOG_MAX_BYTES, tronque en gardant LOG_KEEP_BYTES depuis la fin."""
    try:
        if os.path.getsize(filepath) <= LOG_MAX_BYTES:
            return False
        with open(filepath, "rb") as f:
            f.seek(-LOG_KEEP_BYTES, 2)
            f.readline()          # aligner sur une ligne complète
            kept = f.read()
        tmp = filepath + ".tmp"
        with open(tmp, "wb") as f:
            f.write(kept)
        os.replace(tmp, filepath)
        return True
    except Exception:
        return False


@router.get("")
async def get_logs(
    limit: int     = Query(500, le=2000),
    q: str         = Query("", alias="q"),
    min_level: str = Query("INFO"),
    _: str = Depends(get_current_user),
):
    if not os.path.exists(LOG_FILE):
        return {"logs": [], "total": 0, "error": f"Fichier {LOG_FILE} introuvable"}
    try:
        purged  = _auto_purge(LOG_FILE)
        size_mb = round(os.path.getsize(LOG_FILE) / 1024 / 1024, 1)
        min_idx = LEVEL_ORDER.get(min_level, 0)

        if q.strip():
            # Recherche full-fichier
            parsed = _search_full_file(LOG_FILE, q.strip(), min_level, limit)
        else:
            # Sans recherche : tail des dernières lignes
            raw    = _tail_lines(LOG_FILE, limit * 4)
            parsed = [p for l in raw if (p := _parse(l)) and LEVEL_ORDER.get(p["level"], 0) >= min_idx]
            parsed = parsed[-limit:]

        return {
            "logs": parsed,
            "total": len(parsed),
            "file_mb": size_mb,
            "purged": purged,
            "full_search": bool(q.strip()),
        }
    except Exception as e:
        return {"logs": [], "total": 0, "error": str(e)}


@router.delete("")
async def clear_logs(_: str = Depends(get_current_user)):
    try:
        open(LOG_FILE, "w").close()
    except Exception:
        pass
    return {"ok": True}
