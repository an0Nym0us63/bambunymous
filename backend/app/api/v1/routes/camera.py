"""
Proxy caméra H2C — RTSPS port 322 via ffmpeg (même que Spoolnymous pour X1/H2).
"""
import time, random, logging, asyncio, subprocess
from threading import Lock
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from ....services.settings_service import get_setting
from ....db.session import AsyncSessionLocal

router = APIRouter()
logger = logging.getLogger(__name__)

_LOCK  = Lock()
_CACHE = {"ts": 0.0, "data": None, "ok": False, "fail_count": 0, "retry_at": 0.0}
_TTL_OK    = 1.0
_FAIL_BASE = 10.0
_FAIL_MAX  = 60.0
_TIMEOUT   = 10.0


def _grab_rtsps(ip: str, code: str) -> bytes:
    """Snapshot via ffmpeg RTSPS — identique à Spoolnymous _snapshot_once."""
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
    result = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=_TIMEOUT
    )
    if result.returncode != 0:
        err = result.stderr.decode("utf-8", "ignore").strip()
        raise RuntimeError(f"ffmpeg error: {err}")
    if not result.stdout:
        raise RuntimeError("ffmpeg: no data")
    return result.stdout


async def _serve(ip: str, code: str) -> Response:
    now = time.monotonic()
    with _LOCK:
        if _CACHE["ok"] and _CACHE["data"] and (now - _CACHE["ts"]) < _TTL_OK:
            return Response(_CACHE["data"], media_type="image/jpeg",
                           headers={"Cache-Control": "no-store", "X-Camera-Status": "ok-cached"})
        if not _CACHE["ok"] and now < _CACHE["retry_at"] and _CACHE["data"]:
            return Response(_CACHE["data"], media_type="image/jpeg",
                           headers={"Cache-Control": "no-store", "X-Camera-Status": "stale"})
        _CACHE["ts"] = now

    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, _grab_rtsps, ip, code)
        with _LOCK:
            _CACHE.update(data=data, ok=True, fail_count=0, retry_at=0.0)
        return Response(data, media_type="image/jpeg",
                       headers={"Cache-Control": "no-store", "X-Camera-Status": "ok"})
    except Exception as e:
        logger.warning(f"Camera snapshot: {e}")
        with _LOCK:
            _CACHE["ok"] = False
            _CACHE["fail_count"] = min(_CACHE["fail_count"] + 1, 20)
            wait = min(_FAIL_BASE * (2 ** (_CACHE["fail_count"] - 1)), _FAIL_MAX)
            wait *= 1 + random.uniform(-0.2, 0.2)
            _CACHE["retry_at"] = time.monotonic() + wait
        return Response(status_code=503, content=str(e).encode(),
                       headers={"Cache-Control": "no-store"})


@router.get("/snapshot")
async def camera_snapshot():
    async with AsyncSessionLocal() as db:
        ip   = await get_setting(db, "PRINTER_IP")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")
    if not ip or not code:
        return Response(status_code=503, content=b"non configure")
    return await _serve(ip, code)
