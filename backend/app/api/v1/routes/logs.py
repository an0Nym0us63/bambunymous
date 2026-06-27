"""
Route pour exposer les logs via SSE et JSON.
"""
import asyncio
import json as _json
import logging
from collections import deque
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from ....core.security import decode_token
from .auth import get_current_user

router = APIRouter()

LOG_BUFFER: deque = deque(maxlen=500)


class BufferHandler(logging.Handler):
    def emit(self, record):
        try:
            LOG_BUFFER.append({
                "ts":    self.formatTime(record, "%H:%M:%S"),
                "level": record.levelname,
                "name":  record.name.split(".")[-1],
                "msg":   self.format(record),
            })
        except Exception:
            pass


_handler = BufferHandler()
_handler.setFormatter(logging.Formatter("%(message)s"))
_handler.setLevel(logging.DEBUG)
logging.getLogger("app").addHandler(_handler)


@router.get("")
async def get_logs(limit: int = 300, _: str = Depends(get_current_user)):
    entries = list(LOG_BUFFER)[-limit:]
    return {"logs": entries, "total": len(LOG_BUFFER)}


@router.get("/stream")
async def stream_logs(token: str = Query(...)):
    """SSE — token passé en query param car EventSource ne supporte pas les headers."""
    user = decode_token(token)
    if not user:
        async def denied():
            yield "data: unauthorized\n\n"
        return StreamingResponse(denied(), media_type="text/event-stream")

    async def generator():
        last = len(LOG_BUFFER)
        yield f"data: {_json.dumps({'ts':'','level':'INFO','name':'system','msg':'Stream connecté'})}\n\n"
        while True:
            await asyncio.sleep(0.5)
            current = len(LOG_BUFFER)
            if current > last:
                for entry in list(LOG_BUFFER)[last:current]:
                    yield f"data: {_json.dumps(entry)}\n\n"
                last = current

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"},
    )
