"""
Proxy caméra — extrait un snapshot JPEG du flux RTSPS Bambu Lab.
URL: rtsps://bblp:{access_code}@{ip}:322/streaming/live/1
"""
import asyncio
import ssl
import socket
import logging
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from ....services.settings_service import get_setting
from ....db.session import AsyncSessionLocal
from .auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

RTSP_PORT = 322
RTSP_PATH = "/streaming/live/1"


def _grab_jpeg(ip: str, code: str, timeout: float = 5.0) -> bytes | None:
    """
    Connexion RTSPS et extraction d'un snapshot JPEG.
    Envoie DESCRIBE puis lit jusqu'à trouver un JPEG complet.
    """
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        raw = socket.create_connection((ip, RTSP_PORT), timeout=timeout)
        sock = ctx.wrap_socket(raw, server_hostname=ip)
        sock.settimeout(timeout)

        # RTSP DESCRIBE
        req = (
            f"DESCRIBE rtsps://{ip}:{RTSP_PORT}{RTSP_PATH} RTSP/1.0\r\n"
            f"CSeq: 1\r\n"
            f"Authorization: Basic {_b64(f'bblp:{code}')}\r\n"
            f"Accept: application/sdp\r\n\r\n"
        )
        sock.sendall(req.encode())
        resp = sock.recv(4096)

        if b"200 OK" not in resp:
            sock.close()
            return None

        # Pour un snapshot simple, on lit les données du buffer
        # et on cherche la signature JPEG FF D8
        buf = b""
        for _ in range(50):
            try:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                buf += chunk
                start = buf.find(b'\xff\xd8\xff')
                if start >= 0:
                    end = buf.find(b'\xff\xd9', start)
                    if end >= 0:
                        sock.close()
                        return buf[start:end+2]
            except Exception:
                break
        sock.close()
        return None
    except Exception as e:
        logger.debug(f"Camera grab failed: {e}")
        return None


def _b64(s: str) -> str:
    import base64
    return base64.b64encode(s.encode()).decode()


@router.get("/snapshot")
async def camera_snapshot(_: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        ip   = await get_setting(db, "PRINTER_IP")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")

    if not ip or not code:
        return Response(status_code=503, content="Imprimante non configurée")

    # Exécuter dans un thread (bloquant)
    loop = asyncio.get_event_loop()
    jpeg = await loop.run_in_executor(None, _grab_jpeg, ip, code)

    if jpeg:
        return Response(content=jpeg, media_type="image/jpeg",
                       headers={"Cache-Control": "no-cache, no-store"})
    return Response(status_code=503, content="Snapshot indisponible")
