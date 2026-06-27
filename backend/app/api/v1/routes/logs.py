import os
import re
from fastapi import APIRouter, Depends, Query
from .auth import get_current_user

router = APIRouter()
LOG_FILE = "/data/bambunymous.log"

# Format: "2026-06-27 16:04:34,320 INFO app.core.mqtt message..."
_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})[,.]\d+ (\w+) (\S+) (.*)$")

# Logs à exclure (trop verbeux / inutiles dans le journal)
_EXCLUDE = (
    "/api/v1/logs",
    "/api/v1/printer",
    "/healthz",
    "/favicon",
    "/assets/",
)
# Loggers trop verbeux à exclure du journal
_EXCLUDE_NAMES = ("aiosqlite", "NullPool", "Engine", "sqlalchemy")


def _parse(line: str):
    m = _RE.match(line.strip())
    if not m:
        return None
    dt, level, name, msg = m.groups()
    # Exclure les logs d'accès HTTP polluants
    if any(x in msg for x in _EXCLUDE):
        return None
    if any(name.startswith(x) for x in _EXCLUDE_NAMES):
        return None
    return {
        "ts":    dt[11:19],
        "level": level,
        "name":  name.split(".")[-1],
        "msg":   msg,
    }


@router.get("")
async def get_logs(limit: int = Query(500, le=2000), _: str = Depends(get_current_user)):
    if not os.path.exists(LOG_FILE):
        return {"logs": [], "total": 0, "error": f"Fichier {LOG_FILE} introuvable"}
    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        parsed = [p for l in lines if (p := _parse(l))]
        return {"logs": parsed[-limit:], "total": len(parsed)}
    except Exception as e:
        return {"logs": [], "total": 0, "error": str(e)}


@router.delete("")
async def clear_logs(_: str = Depends(get_current_user)):
    try:
        open(LOG_FILE, "w").close()
    except Exception:
        pass
    return {"ok": True}
