"""
Proxy caméra H2C — TLS port 6000, même implémentation que Spoolnymous.
"""
import ssl, socket, struct, time, random, logging, asyncio
from threading import Lock
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from ....services.settings_service import get_setting
from ....db.session import AsyncSessionLocal
from .auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

# Cache global (thread-safe) comme Spoolnymous
_LOCK = Lock()
_CACHE = {"ts": 0.0, "data": None, "ok": False, "fail_count": 0, "retry_at": 0.0}
_TTL_OK   = 0.8
_FAIL_BASE = 10.0
_FAIL_MAX  = 60.0


def _grab(ip: str, code: str, timeout: float = 8.0) -> bytes:
    """TLS6000 snapshot — identique à Spoolnymous _snapshot_once_tls6000."""
    auth = bytearray()
    auth += struct.pack("<I", 0x40)
    auth += struct.pack("<I", 0x3000)
    auth += struct.pack("<I", 0)
    auth += struct.pack("<I", 0)
    u = b"bblp"
    auth += u + b"\x00" * (32 - len(u))
    c = code.encode("ascii")
    auth += c + b"\x00" * (32 - len(c))

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    sock = socket.create_connection((ip, 6000), timeout=timeout)
    try:
        with ctx.wrap_socket(sock, server_hostname=ip) as s:
            s.settimeout(timeout)
            s.sendall(auth)
            buf = bytearray()
            header_done = False
            psize = None
            t0 = time.monotonic()
            while True:
                if time.monotonic() - t0 > timeout:
                    raise TimeoutError("snapshot timeout")
                try:
                    chunk = s.recv(4096)
                except ssl.SSLWantReadError:
                    time.sleep(0.02)
                    continue
                if not chunk:
                    raise RuntimeError("connexion fermée")
                buf += chunk
                while True:
                    if not header_done:
                        if len(buf) < 16:
                            break
                        psize = int.from_bytes(buf[0:4], "little")
                        buf = buf[16:]
                        header_done = True
                    else:
                        if len(buf) < psize:
                            break
                        img = bytes(buf[:psize])
                        if len(img) < 4 or img[0] != 0xFF or img[1] != 0xD8:
                            raise RuntimeError("pas un JPEG")
                        if img[-2] != 0xFF or img[-1] != 0xD9:
                            raise RuntimeError("JPEG tronqué")
                        return img
    finally:
        try: sock.close()
        except: pass


async def _serve(ip: str, code: str) -> Response:
    now = time.monotonic()
    with _LOCK:
        if _CACHE["ok"] and _CACHE["data"] and (now - _CACHE["ts"]) < _TTL_OK:
            return Response(_CACHE["data"], media_type="image/jpeg",
                           headers={"Cache-Control": "no-store"})
        if not _CACHE["ok"] and now < _CACHE["retry_at"] and _CACHE["data"]:
            return Response(_CACHE["data"], media_type="image/jpeg",
                           headers={"Cache-Control": "no-store", "X-Camera-Status": "stale"})
        _CACHE["ts"] = now

    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, _grab, ip, code)
        with _LOCK:
            _CACHE.update(data=data, ok=True, fail_count=0, retry_at=0.0)
        return Response(data, media_type="image/jpeg",
                       headers={"Cache-Control": "no-store", "X-Camera-Status": "ok"})
    except Exception as e:
        logger.warning(f"Camera: {e}")
        with _LOCK:
            _CACHE["ok"] = False
            _CACHE["fail_count"] = min(_CACHE["fail_count"] + 1, 20)
            wait = min(_FAIL_BASE * (2 ** (_CACHE["fail_count"] - 1)), _FAIL_MAX)
            wait *= 1 + random.uniform(-0.2, 0.2)
            _CACHE["retry_at"] = time.monotonic() + wait
        return Response(status_code=503, content=str(e).encode(),
                       headers={"Cache-Control": "no-store"})


@router.get("/snapshot")
async def camera_snapshot(_: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        ip   = await get_setting(db, "PRINTER_IP")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")
    if not ip or not code:
        return Response(status_code=503, content=b"non configure")
    return await _serve(ip, code)
