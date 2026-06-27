"""
Buffer circulaire de logs. S'installe automatiquement à l'import.
"""
import logging
from collections import deque

LOG_BUFFER: deque = deque(maxlen=1000)


class BufferHandler(logging.Handler):
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


# Installer immédiatement sur le root logger et les loggers clés
_handler = BufferHandler()
_handler.setLevel(logging.DEBUG)

for _name in ("", "app", "uvicorn", "uvicorn.error", "fastapi"):
    _log = logging.getLogger(_name)
    if not any(isinstance(h, BufferHandler) for h in _log.handlers):
        _log.addHandler(_handler)
