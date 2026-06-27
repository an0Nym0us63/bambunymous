"""
Buffer circulaire de logs — singleton.
Le handler est installé dans main.py après basicConfig.
"""
import collections

LOG_BUFFER: collections.deque = collections.deque(maxlen=1000)
