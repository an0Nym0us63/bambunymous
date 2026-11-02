"""Nos familles (03/11/2026) : « tel sous-type » -> « telle famille » (la matiere : PLA, PETG…), quand la deduction
de core/materials ne convient pas (« PET-G » -> PETG, « PLA+ » -> PLA, une famille qu'elle ne connait pas : « PEEK »).
Parametres › Filaments › Correspondances ; reglage FAMILY_MAP, en memoire pour family_of() (synchrone).
"""
import json

KEY = "FAMILY_MAP"
_MAP: dict = {}
_ITEMS: list = []


def lookup(value) -> str | None:
    return _MAP.get(str(value or "").strip().casefold()) if _MAP else None


def items() -> list:
    return [dict(x) for x in _ITEMS]


def _set(items_: list) -> None:
    _ITEMS[:] = items_
    _MAP.clear()
    _MAP.update({x["from"].casefold(): x["to"] for x in items_})


async def load() -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        v = json.loads(raw) if raw else []
    except ValueError:
        v = []
    _set([x for x in v if isinstance(x, dict) and x.get("from") and x.get("to")] if isinstance(v, list) else [])


async def save(new: list) -> tuple:
    """Enregistre la table, puis remet a jour la matiere des filaments dont le sous-type en depend. (table, filaments
    remis a jour)"""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament
    from .settings_service import set_setting
    from ..core.materials import family_of
    seen = {}
    for it in new or []:
        a, b = str((it or {}).get("from") or "").strip()[:80], str((it or {}).get("to") or "").strip().upper()[:30]
        if a and b:
            seen[a.casefold()] = {"from": a, "to": b}
    clean = sorted(seen.values(), key=lambda x: x["from"].casefold())
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(clean, ensure_ascii=False))
        _set(clean)
        n = 0
        for f in (await db.execute(select(Filament).where(Filament.fila_type.isnot(None)))).scalars().all():
            fam = family_of(f.fila_type, None)
            if fam and fam != f.material:
                f.material = fam
                n += 1
        await db.commit()
    return items(), n
