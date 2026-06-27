import logging
from fastapi import APIRouter, Depends, Query
from ....core.log_buffer import LOG_BUFFER
from .auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("")
async def get_logs(limit: int = 300, _: str = Depends(get_current_user)):
    # Test que le buffer fonctionne
    logger.info("[LOGS] endpoint appelé — buffer size=%d", len(LOG_BUFFER))
    entries = list(LOG_BUFFER)[-limit:]
    return {"logs": entries, "total": len(LOG_BUFFER)}


@router.delete("")
async def clear_logs(_: str = Depends(get_current_user)):
    LOG_BUFFER.clear()
    return {"ok": True}
