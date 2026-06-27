import os
from fastapi import APIRouter, Depends, Query
from .auth import get_current_user

router = APIRouter()
LOG_FILE = "/data/bambunymous.log"


@router.get("")
async def get_logs(limit: int = Query(500, le=2000), _: str = Depends(get_current_user)):
    if not os.path.exists(LOG_FILE):
        return {"logs": [], "total": 0, "error": f"Fichier {LOG_FILE} introuvable"}
    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
            lines = [l.rstrip() for l in f.readlines() if l.strip()]
        total = len(lines)
        # Retourner les lignes brutes — pas de parsing, juste afficher
        entries = []
        for line in lines[-limit:]:
            # Détecter le niveau
            lvl = "INFO"
            for l in ("ERROR","WARNING","WARN","CRITICAL","DEBUG"):
                if l in line[:40].upper():
                    lvl = l.replace("WARN","WARNING")
                    break
            entries.append({"ts": line[:19] if len(line) > 19 else "", "level": lvl, "name": "", "msg": line})
        return {"logs": entries, "total": total}
    except Exception as e:
        return {"logs": [], "total": 0, "error": str(e)}


@router.delete("")
async def clear_logs(_: str = Depends(get_current_user)):
    try:
        open(LOG_FILE, "w").close()
    except Exception:
        pass
    return {"ok": True}
