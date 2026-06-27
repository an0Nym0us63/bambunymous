import logging
from collections import deque

LOG_BUFFER: deque = deque(maxlen=500)


class BufferHandler(logging.Handler):
    def emit(self, record):
        try:
            LOG_BUFFER.append({
                "ts":    self.formatTime(record, "%H:%M:%S"),
                "level": record.levelname,
                "name":  record.name.replace("app.", "").split(".")[-1],
                "msg":   record.getMessage(),
            })
        except Exception:
            pass


def install():
    handler = BufferHandler()
    handler.setLevel(logging.DEBUG)
    root = logging.getLogger()
    if any(isinstance(h, BufferHandler) for h in root.handlers):
        return
    root.addHandler(handler)
