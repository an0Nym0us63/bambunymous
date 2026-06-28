"""
Proxy caméra H2C — protocole TLS port 6000 (même que Spoolnymous).
La H2C utilise le protocole Bambu bblp sur port 6000, pas RTSPS:322.
"""
import ssl
import socket
import struct
import time
import logging
import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from ....services.settings_service import get_setting
from ....db.session import AsyncSessionLocal
from .auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


def _snapshot_tls6000(ip: str, access_code: str, timeout_s: float = 8.0) -> bytes:
    """
    Capture un snapshot JPEG via le protocole Bambu TLS port 6000.
    Identique à Spoolnymous camera.py _snapshot_once_tls6000.
    """
    username = "bblp"
    port = 6000

    # Buffer d'auth Bambu (format binaire documenté)
    auth_data = bytearray()
    auth_data += struct.pack("<I", 0x40)
    auth_data += struct.pack("<I", 0x3000)
    auth_data += struct.pack("<I", 0)
    auth_data += struct.pack("<I", 0)
    for i in range(len(username)):
        auth_data += struct.pack("<c", username[i].encode("ascii"))
    for _ in range(32 - len(username)):
        auth_data += struct.pack("<x")
    for i in range(len(access_code)):
        auth_data += struct.pack("<c", access_code[i].encode("ascii"))
    for _ in range(32 - len(access_code)):
        auth_data += struct.pack("<x")

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    sock = socket.create_connection((ip, port), timeout=timeout_s)
    try:
        with ctx.wrap_socket(sock, server_hostname=ip) as ssock:
            ssock.settimeout(timeout_s)
            ssock.sendall(auth_data)

            buf = bytearray()
            need_header = True
            payload_size = None
            start = time.monotonic()

            while True:
                if time.monotonic() - start > timeout_s:
                    raise TimeoutError("TLS6000 snapshot timeout")
                try:
                    chunk = ssock.recv(4096)
                except ssl.SSLWantReadError:
                    time.sleep(0.05)
                    continue
                if not chunk:
                    raise RuntimeError("Flux TLS6000 fermé")
                buf += chunk

                while True:
                    if need_header:
                        if len(buf) < 16:
                            break
                        payload_size = int.from_bytes(buf[0:4], "little")
                        buf = buf[16:]
                        need_header = False
                    else:
                        if payload_size is None or len(buf) < payload_size:
                            break
                        img = bytes(buf[:payload_size])
                        # Validation JPEG SOI + EOI
                        if len(img) < 4 or img[0] != 0xFF or img[1] != 0xD8:
                            raise RuntimeError("JPEG SOI manquante")
                        if img[-2] != 0xFF or img[-1] != 0xD9:
                            raise RuntimeError("JPEG EOI manquante")
                        return img
    finally:
        try:
            sock.close()
        except Exception:
            pass


@router.get("/snapshot")
async def camera_snapshot(_: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        ip   = await get_setting(db, "PRINTER_IP")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")

    if not ip or not code:
        return Response(status_code=503, content=b"Imprimante non configuree")

    loop = asyncio.get_event_loop()
    try:
        jpeg = await loop.run_in_executor(None, _snapshot_tls6000, ip, code)
        return Response(
            content=jpeg, media_type="image/jpeg",
            headers={"Cache-Control": "no-cache, no-store", "X-Camera-Status": "ok"}
        )
    except Exception as e:
        logger.warning(f"Camera snapshot failed: {e}")
        return Response(status_code=503, content=str(e).encode())
