"""
Bobines POSEES dans un emplacement AMS pour le sechage, sans etre inserees.

L'AMS seche (et fait tourner) une bobine simplement posee : il la voit vide,
rien ne dit donc ce qui seche. On retient « tel emplacement : telle bobine »
tant que l'emplacement reste VIDE ; des qu'un filament y est insere,
l'association s'oublie seule. Une bobine n'est posee qu'a un endroit.

Gardees en memoire (lues par l'etat AMS, synchrone, et par le fil MQTT) et
en base (table settings, cle DRYING_SLOTS) pour survivre a un redemarrage.
"""
from __future__ import annotations

import json
from datetime import datetime

KEY = "DRYING_SLOTS"
_slots: dict = {}       # "ams:tray" -> {"spool_id": int, "since": iso}


def _key(ams_id, tray_id) -> str:
    return f"{int(ams_id)}:{int(tray_id)}"


def current() -> dict:
    return _slots


def spool_at(ams_id, tray_id):
    e = _slots.get(_key(ams_id, tray_id))
    return e["spool_id"] if e else None


def spools_in_ams(ams_id) -> list:
    return [e["spool_id"] for k, e in _slots.items() if k.split(":")[0] == str(int(ams_id))]


async def load() -> dict:
    global _slots
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        data = json.loads(raw) if raw else {}
    except ValueError:
        data = {}
    _slots = ({k: v for k, v in data.items() if isinstance(v, dict) and v.get("spool_id")}
              if isinstance(data, dict) else {})
    return _slots


async def _save() -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(_slots))


async def place(ams_id, tray_id, spool_id: int) -> None:
    # une bobine n'est posee qu'a un seul endroit
    for k in [k for k, e in _slots.items() if e["spool_id"] == int(spool_id)]:
        _slots.pop(k)
    _slots[_key(ams_id, tray_id)] = {"spool_id": int(spool_id), "since": datetime.utcnow().isoformat()}
    await _save()


async def remove(ams_id, tray_id) -> bool:
    if _slots.pop(_key(ams_id, tray_id), None) is None:
        return False
    await _save()
    return True


async def prune(ams_list) -> None:
    """Oublie les emplacements ou un filament a ete insere. Un AMS absent de
    l'etat (deconnexion, demarrage) ne fait rien oublier."""
    seen = {(a.id, t.id): t for a in (ams_list or []) for t in (a.trays or [])}
    gone = []
    for k in _slots:
        a, t = (int(x) for x in k.split(":"))
        tray = seen.get((a, t))
        if tray is not None and not tray.empty:
            gone.append(k)
    if gone:
        for k in gone:
            _slots.pop(k)
        await _save()
