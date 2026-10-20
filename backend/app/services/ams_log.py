"""
Changements de filament dans l'AMS (20/10/2026), pour les succes : chaque
bobine posee dans un emplacement (vide -> occupe, stable quelques secondes).

L'ecouteur de l'imprimante tourne a chaque message MQTT : il ne fait que
noter l'heure en memoire (record). Les succes (boucle de 15 min) versent ces
heures dans le reglage AMS_CHANGES (drain), qui garde l'historique.
"""
import json
import threading
from datetime import datetime

KEY = "AMS_CHANGES"
MAX = 50000                 # au-dela, on oublie les plus anciens
_PENDING: list = []
_LOCK = threading.Lock()


def record(when: datetime | None = None) -> None:
    """Appele par l'ecouteur : aucune base, aucun reseau."""
    with _LOCK:
        _PENDING.append((when or datetime.utcnow()).isoformat())


async def drain() -> list:
    """Verse les changements en attente dans le reglage ; rend tout l'historique."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting, set_setting
    with _LOCK:
        new = list(_PENDING)
        _PENDING.clear()
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
        try:
            hist = json.loads(raw) if raw else []
        except ValueError:
            hist = []
        if new:
            hist = (hist + new)[-MAX:]
            await set_setting(db, KEY, json.dumps(hist))
    return hist
