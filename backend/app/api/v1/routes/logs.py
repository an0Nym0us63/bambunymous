import asyncio
import json as _json
import logging
from fastapi import APIRouter, Query, Depends
from fastapi.responses import StreamingResponse
from ....core.security import decode_token
from ....core.log_buffer import LOG_BUFFER
from .auth import get_current_user

router = APIRouter()


@router.get("")
async def get_logs(limit: int = 300, _: str = Depends(get_current_user)):
    return {"logs": list(LOG_BUFFER)[-limit:], "total": len(LOG_BUFFER)}


@router.delete("")
async def clear_logs(_: str = Depends(get_current_user)):
    LOG_BUFFER.clear()
    return {"ok": True}


@router.get("/stream")
async def stream_logs(token: str = Query(...)):
    user = decode_token(token)
    if not user:
        async def denied():
            yield "data: unauthorized\n\n"
        return StreamingResponse(denied(), media_type="text/event-stream")

    async def generator():
        last = len(LOG_BUFFER)
        yield f"data: {_json.dumps({"ts":"--:--:--","level":"INFO","name":"system","msg":"Stream connecté"})}\n\n"
        while True:
            await asyncio.sleep(0.3)
            current = len(LOG_BUFFER)
            if current > last:
                for entry in list(LOG_BUFFER)[last:current]:
                    yield f"data: {_json.dumps(entry)}\n\n"
                last = current

    return StreamingResponse(generator(), media_type="text/event-stream",
        headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
