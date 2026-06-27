import os
import re
from fastapi import APIRouter, Depends, Query
from .auth import get_current_user

router = APIRouter()

LOG_FILE = "/data/bambunymous.log"
# Format: "2026-06-27 12:34:56 INFO app.core.mqtt message..."
_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (\w+) (\S+) (.*)$")


def _parse_line(line: str) -> dict | None:
    m = _RE.match(line.strip())
    if not m:
        return None
    dt, level, name, msg = m.groups()
    return {
        "ts":    dt[11:19],   # HH:MM:SS
        "level": level,
        "name":  name.split(".")[-1],
        "msg":   msg,
    }


@router.get("")
async def get_logs(
    limit: int = Query(300, le=1000),
    _: str = Depends(get_current_user)
):
    if not os.path.exists(LOG_FILE):
        return {"logs": [], "total": 0, "error": f"{LOG_FILE} not found"}
    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        parsed = [p for l in lines if (p := _parse_line(l))]
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
