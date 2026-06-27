import logging
from fastapi import APIRouter, Depends
from .auth import get_current_user

router = APIRouter()

# Import du buffer via le handler installé dans main.py
# On accède au buffer via le handler stocké dans le root logger
def _get_buffer():
    import main as _main
    return list(_main.LOG_HANDLER.buf)

@router.get("")
async def get_logs(limit: int = 500, _: str = Depends(get_current_user)):
    try:
        import main as _main
        entries = list(_main.LOG_HANDLER.buf)[-limit:]
        return {"logs": entries, "total": len(_main.LOG_HANDLER.buf)}
    except Exception as e:
        return {"logs": [{"ts":"--:--:--","level":"ERROR","name":"logs","msg":str(e)}], "total": 0}


@router.delete("")
async def clear_logs(_: str = Depends(get_current_user)):
    try:
        import main as _main
        _main.LOG_HANDLER.buf.clear()
    except Exception:
        pass
    return {"ok": True}
