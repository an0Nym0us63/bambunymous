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

# Taille max du fichier log avant rotation automatique (50 Mo)
LOG_MAX_BYTES = 50 * 1024 * 1024


def _parse(line: str):
    m = _RE.match(line.strip())
    if not m:
        return None
    dt, level, name, msg = m.groups()
    if any(x in msg for x in _EXCLUDE):
        return None
    if any(name.startswith(x) for x in _EXCLUDE_NAMES):
        return None
    return {"ts": dt[11:19], "level": level, "name": name.split(".")[-1], "msg": msg}


def _tail_lines(filepath: str, n: int) -> list[str]:
    """Lit les n dernières lignes du fichier efficacement (sans tout charger)."""
    # On lit par chunks depuis la fin
    CHUNK = 65536  # 64 Ko
    lines = deque()
    count = 0
    with open(filepath, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        pos = size
        buf = b""
        while pos > 0 and count < n:
            read = min(CHUNK, pos)
            pos -= read
            f.seek(pos)
            chunk = f.read(read)
            buf = chunk + buf
            # Compter les lignes
            parts = buf.split(b"\n")
            buf = parts[0]  # ligne incomplète au début
            for part in reversed(parts[1:]):
                lines.appendleft(part.decode("utf-8", errors="replace"))
                count += 1
                if count >= n:
                    break
        if buf:
            lines.appendleft(buf.decode("utf-8", errors="replace"))
    return list(lines)


@router.get("")
async def get_logs(limit: int = Query(300, le=1000), _: str = Depends(get_current_user)):
    if not os.path.exists(LOG_FILE):
        return {"logs": [], "total": 0, "error": f"Fichier {LOG_FILE} introuvable"}
    try:
        # Vérifier la taille — si trop gros, tronquer
        size = os.path.getsize(LOG_FILE)
        size_mb = size / 1024 / 1024

        # Lire seulement les dernières lignes depuis la fin (pas tout le fichier)
        raw_lines = _tail_lines(LOG_FILE, limit * 3)  # 3x pour compenser les lignes filtrées
        parsed = [p for l in raw_lines if (p := _parse(l))]
        return {
            "logs": parsed[-limit:],
            "total": len(parsed),
            "file_mb": round(size_mb, 1),
        }
    except Exception as e:
        return {"logs": [], "total": 0, "error": str(e)}


@router.delete("")
async def clear_logs(_: str = Depends(get_current_user)):
    """Vide le fichier log."""
    try:
        open(LOG_FILE, "w").close()
    except Exception:
        pass
    return {"ok": True}
