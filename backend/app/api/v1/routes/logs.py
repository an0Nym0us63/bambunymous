"""
Route pour exposer les logs en temps réel via SSE (Server-Sent Events)
et récupérer les derniers logs en JSON.
"""
import asyncio
import logging
from collections import deque
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from .auth import get_current_user

router = APIRouter()

# Buffer circulaire des 500 derniers logs
LOG_BUFFER: deque = deque(maxlen=500)


class BufferHandler(logging.Handler):
    """Handler qui stocke les logs dans LOG_BUFFER."""
    def emit(self, record):
        try:
            LOG_BUFFER.append({
                "ts":    self.formatTime(record, "%H:%M:%S"),
                "level": record.levelname,
                "name":  record.name.split(".")[-1],
                "msg":   record.getMessage(),
            })
        except Exception:
            pass


# Installer le handler sur le logger racine
_handler = BufferHandler()
_handler.setLevel(logging.DEBUG)
logging.getLogger("app").addHandler(_handler)


@router.get("")
async def get_logs(
    limit: int = 200,
    _: str = Depends(get_current_user)
):
    """Retourne les derniers logs."""
    entries = list(LOG_BUFFER)[-limit:]
    return {"logs": entries, "total": len(LOG_BUFFER)}


@router.get("/stream")
async def stream_logs(_: str = Depends(get_current_user)):
    """SSE stream — pousse les nouveaux logs en temps réel."""
    async def generator():
        last = len(LOG_BUFFER)
        yield "data: connected\n\n"
        while True:
            await asyncio.sleep(0.5)
            current = len(LOG_BUFFER)
            if current > last:
                new_entries = list(LOG_BUFFER)[last:current]
                for entry in new_entries:
                    import json as _json
                    yield f"data: {_json.dumps(entry)}\n\n"
                last = current

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )
