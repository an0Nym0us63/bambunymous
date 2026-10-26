"""La carte SD de l'imprimante, en lecture (26/10/2026).

Meme porte que la recuperation des 3MF (services/tmf_parser.py) : FTPS implicite sur le reseau local,
utilisateur « bblp », mot de passe = code d'acces LAN (jamais renvoye a la page). Pour commencer, une
sonde : ce qu'il y a a la racine et dans « timelapse », pour savoir si l'imprimante ouvre ces dossiers
avant de construire la lecture des videos.
"""
from __future__ import annotations

import asyncio
import logging
import re

logger = logging.getLogger(__name__)

# « -rw-rw-rw-   1 user  group   1234567 Oct 25 18:30 video_2026-10-25_18-30-12.mp4 »
_LIST = re.compile(r"^([dl-])[rwx-]{9}\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4}))\s+(.+)$")


def parse_list(lines: list[str]) -> list[dict]:
    out = []
    for ln in lines:
        m = _LIST.match(ln.strip())
        if not m:
            continue
        kind, size, when, name = m.groups()
        if name in (".", ".."):
            continue
        out.append({"name": name, "dir": kind == "d", "size": int(size), "when": when})
    return out


def _list_sync(ip: str, code: str, path: str) -> list[str]:
    """LIST d'un dossier ; leve une exception lisible si l'imprimante refuse."""
    import io
    import pycurl
    buf = io.BytesIO()
    c = pycurl.Curl()
    try:
        for opt, val in [
            (c.URL, f"ftps://{ip}{path if path.endswith('/') else path + '/'}"), (c.USERPWD, f"bblp:{code}"),
            (c.SSL_VERIFYPEER, 0), (c.SSL_VERIFYHOST, 0),
            (c.FTP_SSL, c.FTPSSL_ALL), (c.FTPSSLAUTH, c.FTPAUTH_TLS),
            (c.CONNECTTIMEOUT, 10), (c.TIMEOUT, 30), (c.WRITEDATA, buf),
        ]:
            c.setopt(opt, val)
        c.perform()
    finally:
        c.close()
    return buf.getvalue().decode("utf-8", "replace").splitlines()


def _why(e: Exception) -> str:
    s = str(e)
    if "(67" in s or "530" in s or "Login" in s:
        return "l'imprimante refuse la connexion (code d'accès ?)"
    if "(7" in s or "(28" in s or "timed out" in s.lower():
        return "l'imprimante ne répond pas sur le FTP (adresse, réseau, ou FTP fermé)"
    if "(9" in s or "550" in s or "(78" in s:
        return "dossier introuvable"
    return s[:200]


async def probe() -> dict:
    """Ce qu'il y a a la racine de la carte et dans « timelapse » (et ses vignettes)."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        ip = (await get_setting(db, "PRINTER_IP") or "").strip()
        code = (await get_setting(db, "PRINTER_ACCESS_CODE") or "").strip()
    if not ip or not code:
        return {"ok": False, "error": "Adresse IP ou code d'accès de l'imprimante manquant (Paramètres → Imprimante)."}
    out = {"ok": True, "ip": ip, "folders": {}}
    for path in ("/", "/timelapse", "/timelapse/thumbnail"):
        try:
            lines = await asyncio.wait_for(asyncio.to_thread(_list_sync, ip, code, path), timeout=45)
            items = parse_list(lines)
            out["folders"][path] = {"items": items[:200], "count": len(items), "raw": lines[:5] if not items and lines else []}
        except Exception as e:
            logger.info(f"[SD] {path} : {e}")
            out["folders"][path] = {"error": _why(e)}
            if path == "/":
                out["ok"] = False
                out["error"] = _why(e)
                break
    return out
