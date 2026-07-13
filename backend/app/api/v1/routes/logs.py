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

# 500 Mo etait demesure pour un log applicatif : le fichier pouvait devenir plus
# gros que toute la base, et chaque recherche le relisait en entier.
LOG_MAX_BYTES   = 40 * 1024 * 1024   # purge auto au-dela de 40 Mo
LOG_KEEP_BYTES  = 10 * 1024 * 1024   # on conserve les 10 derniers Mo
# Plafond de lecture d'une recherche : au-dela, on s'arrete et on le DIT, plutot
# que de faire ramer l'appli en silence.
MAX_SCAN_BYTES  = 24 * 1024 * 1024

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


def _scan_backwards(filepath: str, limit: int, q: str, min_level: str,
                    before: int | None = None):
    """
    Parcourt le fichier A REBOURS et s'arrete des qu'on a `limit` resultats.

    L'ancienne recherche relisait TOUT le fichier depuis le debut pour n'en garder
    que les N dernieres correspondances : sur un gros log, chaque frappe relisait
    tout. Or ce qu'on cherche est presque toujours recent.

    `before` : n'examiner que ce qui precede cet offset. C'est le curseur de
    pagination -- il vaut l'offset EXACT du debut de la plus ancienne ligne deja
    renvoyee, ce qui garantit l'absence de doublon et de trou entre deux pages.

    Renvoie (lignes du plus ancien au plus recent, octets lus, next_offset).
    next_offset = 0 -> on a atteint le debut du fichier, il n'y a plus rien.
    """
    CHUNK = 256 * 1024
    ql = q.strip().lower()
    min_idx = LEVEL_ORDER.get(min_level, 0)

    found: list[dict] = []
    scanned = 0
    carry = b""          # debut de ligne incomplet, appartenant au bloc precedent

    with open(filepath, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        pos = size if before is None else max(0, min(before, size))
        next_offset = pos

        while pos > 0 and len(found) < limit:
            if scanned >= MAX_SCAN_BYTES:
                break            # plafond atteint : next_offset reste sur pos
            read = min(CHUNK, pos)
            pos -= read
            f.seek(pos)
            chunk = f.read(read)
            scanned += read

            data = chunk + carry
            parts = data.split(b"\n")
            # parts[0] commence AVANT pos : on le garde pour le tour suivant
            # (sauf si on est au debut du fichier, ou il est complet).
            if pos > 0:
                carry = parts[0]
                complete = parts[1:]
                first_off = pos + len(parts[0]) + 1
            else:
                carry = b""
                complete = parts
                first_off = 0

            # Offset de debut de chaque ligne complete
            offsets = []
            o = first_off
            for ln in complete:
                offsets.append(o)
                o += len(ln) + 1

            for ln, off in zip(reversed(complete), reversed(offsets)):
                p = _parse(ln.decode("utf-8", errors="replace"))
                if not p:
                    continue
                if LEVEL_ORDER.get(p["level"], 0) < min_idx:
                    continue
                if ql and ql not in p["msg"].lower() and ql not in p["name"].lower():
                    continue
                found.append(p)
                next_offset = off      # debut de la plus ancienne ligne retenue
                if len(found) >= limit:
                    break
            else:
                # Bloc entierement consomme sans atteindre la limite
                next_offset = pos
                continue
            break

        if pos <= 0 and len(found) < limit:
            next_offset = 0            # on a lu jusqu'au debut du fichier

    found.reverse()                    # du plus ancien au plus recent
    return found, scanned, next_offset


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
    before: int    = Query(0, ge=0),   # curseur : ne lire que ce qui precede cet offset
    _: str = Depends(get_current_user),
):
    if not os.path.exists(LOG_FILE):
        return {"logs": [], "total": 0, "error": f"Fichier {LOG_FILE} introuvable"}
    try:
        size_mb = round(os.path.getsize(LOG_FILE) / 1024 / 1024, 1)
        logs, scanned, next_offset = _scan_backwards(
            LOG_FILE, limit=limit, q=q, min_level=min_level,
            before=(before or None),
        )
        return {
            "logs": logs,
            "total": len(logs),
            "file_mb": size_mb,
            "scanned_mb": round(scanned / 1024 / 1024, 2),
            "next_offset": next_offset,      # curseur a repasser pour lire plus loin
            "has_more": next_offset > 0,     # il reste du fichier avant ce point
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
