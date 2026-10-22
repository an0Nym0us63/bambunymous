"""
Proxy caméra Bambu Lab — supporte RTSP (X1/H2D) et TLS:6000 (P1S/A1/A1 Mini).
Détection automatique par modèle imprimante.
"""
import time, random, logging, asyncio, subprocess, socket, ssl, struct
from threading import Lock
import threading
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response, StreamingResponse
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





# ── Flux continu (22/10/2026) ────────────────────────────────────────────────
# Une seule connexion a la camera tant que quelqu'un regarde, partagee par tous
# les spectateurs : ffmpeg reste ouvert sur le RTSP (X1/H2), la socket TLS:6000
# reste ouverte (P1/A1). La derniere image sert aussi aux captures ponctuelles.
# Plus personne depuis 10 s : la connexion se ferme.
_STREAM_FPS = 8
_IDLE_STOP = 10.0


class _Hub:
    def __init__(self):
        self.lock = threading.Lock()
        self.frame = None
        self.seq = 0
        self.ts = 0.0
        self.subs = 0
        self.idle_since = time.monotonic()
        self.thread = None
        self.retry_at = 0.0
        self.fails = 0

    def stop(self) -> bool:
        with self.lock:
            return self.subs == 0 and time.monotonic() - self.idle_since > _IDLE_STOP

    def put(self, jpg: bytes) -> None:
        with self.lock:
            self.frame, self.ts = jpg, time.monotonic()
            self.seq += 1
            self.fails = 0


_HUB = _Hub()


def _rtsp_frames(ip: str, code: str, stop):
    url = f"rtsps://bblp:{code}@{ip}:322/streaming/live/1"
    proc = subprocess.Popen(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
                             "-i", url, "-an", "-r", str(_STREAM_FPS), "-f", "image2pipe", "-vcodec", "mjpeg",
                             "-q:v", "6", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    buf = b""
    try:
        while not stop():
            chunk = proc.stdout.read1(65536) if hasattr(proc.stdout, "read1") else proc.stdout.read(65536)
            if not chunk:
                raise RuntimeError("ffmpeg : flux termine")
            buf += chunk
            while True:
                a = buf.find(b"\xff\xd8")
                b = buf.find(b"\xff\xd9", a + 2) if a >= 0 else -1
                if a < 0 or b < 0:
                    if a > 0:
                        buf = buf[a:]
                    break
                yield buf[a:b + 2]
                buf = buf[b + 2:]
    finally:
        try:
            proc.kill()
        except Exception:
            pass


def _tls_frames(ip: str, code: str, stop):
    auth = bytearray()
    auth += struct.pack("<I", 0x40) + struct.pack("<I", 0x3000) + struct.pack("<I", 0) + struct.pack("<I", 0)
    for ch in "bblp".ljust(32, "\x00"):
        auth += ch.encode("ascii")
    for ch in code.ljust(32, "\x00"):
        auth += ch.encode("ascii")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    sock = socket.create_connection((ip, 6000), timeout=_TIMEOUT)
    try:
        with ctx.wrap_socket(sock, server_hostname=ip) as ss:
            ss.settimeout(_TIMEOUT)
            ss.sendall(auth)
            buf, size = bytearray(), None
            while not stop():
                try:
                    chunk = ss.recv(65536)
                except ssl.SSLWantReadError:
                    time.sleep(0.02)
                    continue
                if not chunk:
                    raise RuntimeError("TLS6000 : flux termine")
                buf += chunk
                while True:
                    if size is None:
                        if len(buf) < 16:
                            break
                        size = int.from_bytes(buf[0:4], "little")
                        buf = buf[16:]
                    if len(buf) < size:
                        break
                    jpg, buf, size = bytes(buf[:size]), buf[size:], None
                    if jpg[:2] == b"\xff\xd8":
                        yield jpg if jpg[-2:] == b"\xff\xd9" else jpg + b"\xff\xd9"
    finally:
        try:
            sock.close()
        except Exception:
            pass


def _produce(ip: str, code: str, mode: str) -> None:
    order = (["rtsp"] if mode == "rtsp" else ["tls"] if mode == "tls" else ["rtsp", "tls"])
    err = None
    for m in order:
        try:
            gen = _rtsp_frames(ip, code, _HUB.stop) if m == "rtsp" else _tls_frames(ip, code, _HUB.stop)
            for jpg in gen:
                _HUB.put(jpg)
            err = None
            break                                  # plus personne : arret normal
        except Exception as e:
            err = e
            logger.info(f"Camera flux {m}: {e}")
    with _HUB.lock:
        _HUB.thread = None
        if err:
            _HUB.fails = min(_HUB.fails + 1, 6)
            _HUB.retry_at = time.monotonic() + min(5 * 2 ** (_HUB.fails - 1), 60)


def _ensure_producer(ip: str, code: str, mode: str) -> None:
    with _HUB.lock:
        if _HUB.thread is not None or time.monotonic() < _HUB.retry_at:
            return
        _HUB.thread = threading.Thread(target=_produce, args=(ip, code, mode), name="camera-flux", daemon=True)
        _HUB.thread.start()


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
    # un flux tourne : sa derniere image, sans relancer de capture
    with _HUB.lock:
        if _HUB.frame and now - _HUB.ts < 3:
            return Response(_HUB.frame, media_type="image/jpeg",
                            headers={"Cache-Control": "no-store", "X-Camera-Status": "ok-stream"})
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


async def _printer_conf():
    async with AsyncSessionLocal() as db:
        ip = await get_setting(db, "PRINTER_IP")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")
    try:
        st = get_state()
        model, model_id = getattr(st, "printer_model", "") or "", getattr(st, "model_id", "") or ""
    except Exception:
        model = model_id = ""
    return ip, code, model, model_id


@router.get("/stream")
async def camera_stream(request: Request):
    """Le flux continu (MJPEG, multipart) : une image des qu'elle arrive. S'il
    n'en vient plus pendant 8 s, la reponse se termine : la page repasse aux
    captures et retentera le flux plus tard."""
    ip, code, model, model_id = await _printer_conf()
    if not ip or not code:
        return Response(status_code=503, content=b"non configure")
    mode = _select_grab(model, model_id)
    if mode is None:
        return Response(status_code=503, content=b"Pas de camera chambre sur ce modele")
    _ensure_producer(ip, code, mode)

    async def frames():
        with _HUB.lock:
            _HUB.subs += 1
        last, waited = -1, 0.0
        first_at = last_at = None              # temps de direct vraiment regarde (succes « Spectateur »)
        try:
            while True:
                if await request.is_disconnected():
                    break
                with _HUB.lock:
                    seq, fr, alive = _HUB.seq, _HUB.frame, _HUB.thread is not None
                if fr and seq != last:
                    last, waited = seq, 0.0
                    last_at = time.monotonic()
                    first_at = first_at or last_at
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(fr)).encode()
                           + b"\r\n\r\n" + fr + b"\r\n")
                    continue
                await asyncio.sleep(0.04)
                waited += 0.04
                if waited > 8:
                    break
                if not alive:
                    _ensure_producer(ip, code, mode)
        finally:
            with _HUB.lock:
                _HUB.subs -= 1
                if _HUB.subs <= 0:
                    _HUB.subs = 0
                    _HUB.idle_since = time.monotonic()
            if first_at and last_at:
                try:
                    from ....services import home_stats
                    await home_stats.camera_watched(last_at - first_at)
                except Exception:
                    logger.debug("camera : temps regarde non compte")
    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
