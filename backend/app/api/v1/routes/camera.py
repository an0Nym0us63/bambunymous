"""
Proxy caméra Bambu Lab — supporte RTSP (X1/H2D) et TLS:6000 (P1S/A1/A1 Mini).
Détection automatique par modèle imprimante.
"""
import time, random, logging, asyncio, subprocess, socket, ssl, struct
from threading import Lock
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from ....services.settings_service import get_setting
from ....db.session import AsyncSessionLocal
from ....core.mqtt import get_state

router = APIRouter()
logger = logging.getLogger(__name__)

_LOCK  = Lock()
_CACHE = {"ts": 0.0, "data": None, "ok": False, "fail_count": 0, "retry_at": 0.0}
_TTL_OK    = 1.0
_FAIL_BASE = 10.0
_FAIL_MAX  = 60.0
_TIMEOUT   = 10.0


def _grab_rtsps(ip: str, code: str) -> bytes:
    """Snapshot via ffmpeg RTSPS (X1/H2D/X1C/X1E)."""
    url = f"rtsps://bblp:{code}@{ip}:322/streaming/live/1"
    cmd = [
        "ffmpeg",
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-rtsp_transport", "tcp",
        "-i", url,
        "-frames:v", "1",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "pipe:1",
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=_TIMEOUT)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg: {result.stderr.decode('utf-8','ignore').strip()}")
    if not result.stdout:
        raise RuntimeError("ffmpeg: no data")
    return result.stdout


def _grab_tls6000(ip: str, code: str, timeout_s: float = 8.0) -> bytes:
    """Snapshot via TLS port 6000 — protocole bblp (P1S/A1/A1 Mini/X1C)."""
    username = "bblp"
    auth_data = bytearray()
    auth_data += struct.pack("<I", 0x40)
    auth_data += struct.pack("<I", 0x3000)
    auth_data += struct.pack("<I", 0)
    auth_data += struct.pack("<I", 0)
    for ch in username.ljust(32, "\x00"):
        auth_data += ch.encode("ascii")
    for ch in code.ljust(32, "\x00"):
        auth_data += ch.encode("ascii")

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    sock = socket.create_connection((ip, 6000), timeout=timeout_s)
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
                    raise TimeoutError("TLS6000 timeout")
                try:
                    chunk = ssock.recv(4096)
                except ssl.SSLWantReadError:
                    time.sleep(0.05)
                    continue
                if not chunk:
                    raise RuntimeError("TLS6000 flux indisponible")
                buf += chunk

                while True:
                    if need_header:
                        if len(buf) < 16:
                            break
                        payload_size = int.from_bytes(buf[0:4], "little")
                        buf = buf[16:]
                        need_header = False
                    else:
                        if len(buf) < payload_size:
                            break
                        jpeg = bytes(buf[:payload_size])
                        buf = buf[payload_size:]
                        need_header = True
                        payload_size = None
                        # Valider JPEG
                        if jpeg[:2] == b"\xff\xd8" and jpeg[-2:] == b"\xff\xd9":
                            return jpeg
                        if jpeg[:2] == b"\xff\xd8":
                            return jpeg + b"\xff\xd9"
            raise RuntimeError("TLS6000: pas de JPEG reçu")
    finally:
        try: sock.close()
        except Exception: pass





# Codes Bambu Lab → méthode caméra
_BAMBU_CODES = {
    "BL-P001": "rtsp",  # X1 Carbon
    "BL-P002": "rtsp",  # X1
    "C11": "rtsp",      # X1 Carbon alt
    "C12": "rtsp",      # H2D
    "C13": "tls",       # P1S
    "C21": "tls",       # A1
    "C20": "tls",       # A1 Mini
    "C24": "tls",       # P1P → None (pas de camera)
}

def _select_grab(model: str, model_id: str = ""):
    """Retourne la méthode de capture adaptée au modèle."""
    mid = (model_id or "").upper()
    if mid and mid.startswith("C24"):  # P1P
        return None
    if mid in _BAMBU_CODES:
        return _BAMBU_CODES[mid]
    m = (model or "").upper()
    if "P1P" in m:
        return None
    if any(x in m for x in ["H2D", "H2C", "X1", "X1C", "X1 CARBON", "X1E"]):
        return "rtsp"
    if any(x in m for x in ["P1S", "A1", "A1 MINI", "A1M"]):
        return "tls"
    return "both"


async def _serve(ip: str, code: str, model: str, model_id: str = "") -> Response:
    now = time.monotonic()
    with _LOCK:
        if _CACHE["ok"] and _CACHE["data"] and (now - _CACHE["ts"]) < _TTL_OK:
            return Response(_CACHE["data"], media_type="image/jpeg",
                           headers={"Cache-Control": "no-store", "X-Camera-Status": "ok-cached"})
        if not _CACHE["ok"] and now < _CACHE["retry_at"] and _CACHE["data"]:
            return Response(_CACHE["data"], media_type="image/jpeg",
                           headers={"Cache-Control": "no-store", "X-Camera-Status": "stale"})
        _CACHE["ts"] = now

    mode = _select_grab(model, model_id)
    if mode is None:
        return Response(status_code=503, content=b"Pas de camera chambre sur ce modele")

    loop = asyncio.get_event_loop()
    last_err = None

    providers = []
    if mode in ("rtsp", "both"):
        providers.append(("rtsp", lambda: _grab_rtsps(ip, code)))
    if mode in ("tls", "both"):
        providers.append(("tls", lambda: _grab_tls6000(ip, code)))

    for name, fn in providers:
        try:
            data = await loop.run_in_executor(None, fn)
            with _LOCK:
                _CACHE.update(data=data, ok=True, fail_count=0, retry_at=0.0)
            return Response(data, media_type="image/jpeg",
                           headers={"Cache-Control": "no-store", "X-Camera-Status": f"ok-{name}"})
        except Exception as e:
            logger.debug(f"Camera {name}: {e}")
            last_err = e

    logger.warning(f"Camera snapshot failed: {last_err}")
    with _LOCK:
        _CACHE["ok"] = False
        _CACHE["fail_count"] = min(_CACHE["fail_count"] + 1, 20)
        wait = min(_FAIL_BASE * (2 ** (_CACHE["fail_count"] - 1)), _FAIL_MAX)
        wait *= 1 + random.uniform(-0.2, 0.2)
        _CACHE["retry_at"] = time.monotonic() + wait
    return Response(status_code=503, content=str(last_err).encode(),
                   headers={"Cache-Control": "no-store"})


@router.get("/snapshot")
async def camera_snapshot():
    async with AsyncSessionLocal() as db:
        ip   = await get_setting(db, "PRINTER_IP")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")
    if not ip or not code:
        return Response(status_code=503, content=b"non configure")
    # Récupérer le modèle depuis l'état MQTT
    try:
        state = get_state()
        model = getattr(state, "printer_model", "") or ""
        model_id = getattr(state, "model_id", "") or ""
    except Exception:
        model = ""; model_id = ""
    return await _serve(ip, code, model, model_id)
