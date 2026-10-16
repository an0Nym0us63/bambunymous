"""
Delais de sechage : au bout de combien de temps une bobine ouverte doit
repasser au sechage.

Un delai par defaut (6 mois), et des delais propres a une FAMILLE (matiere :
PETG, TPU...) ou a une SOUS-FAMILLE (variante : « PLA Silk+ », « PLA
Translucent »...) : certains filaments reprennent l'humidite bien plus vite.
La regle la plus precise gagne : sous-famille, puis famille, puis defaut.

Regles en base (table settings, cle DRY_RULES), gardees en memoire pour les
appels synchrones (fiche bobine, AMS) : load() les relit, save() les remplace.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Optional

KEY = "DRY_RULES"
DEFAULT_DAYS = 180
_rules: dict = {"default_days": DEFAULT_DAYS, "rules": []}   # rules: [{level, key, days}]


def _clean(data) -> dict:
    out = {"default_days": DEFAULT_DAYS, "rules": []}
    if not isinstance(data, dict):
        return out
    try:
        d = int(data.get("default_days") or DEFAULT_DAYS)
        out["default_days"] = max(1, d)
    except (TypeError, ValueError):
        pass
    seen = set()
    for r in data.get("rules") or []:
        try:
            level = r.get("level")
            key = (r.get("key") or "").strip()
            days = int(r.get("days"))
        except (AttributeError, TypeError, ValueError):
            continue
        if level not in ("family", "type") or not key or days < 1 or (level, key.lower()) in seen:
            continue
        seen.add((level, key.lower()))
        out["rules"].append({"level": level, "key": key, "days": days})
    return out


async def load(db=None) -> dict:
    """Relit les regles en base et met a jour la memoire."""
    global _rules
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async def _read(s):
        return await get_setting(s, KEY, "")
    if db is not None:
        raw = await _read(db)
    else:
        async with AsyncSessionLocal() as s:
            raw = await _read(s)
    try:
        _rules = _clean(json.loads(raw) if raw else {})
    except ValueError:
        _rules = _clean({})
    return _rules


async def save(data: dict) -> dict:
    global _rules
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    clean = _clean(data)
    async with AsyncSessionLocal() as s:
        await set_setting(s, KEY, json.dumps(clean, ensure_ascii=False))
    _rules = clean
    return clean


def current() -> dict:
    return _rules


def days_for(filament) -> int:
    """Delai applicable a ce filament : sous-famille, puis famille, puis defaut."""
    if filament is None:
        return _rules["default_days"]
    ftype = (getattr(filament, "fila_type", None) or "").strip().lower()
    fam = (getattr(filament, "material", None) or "").strip().lower()
    by = {(r["level"], r["key"].lower()): r["days"] for r in _rules["rules"]}
    if ftype and ("type", ftype) in by:
        return by[("type", ftype)]
    if fam and ("family", fam) in by:
        return by[("family", fam)]
    return _rules["default_days"]


def dry_reference(spool) -> Optional[datetime]:
    """Dernier sechage de la bobine, None si elle n'a jamais ete sechee."""
    ref = getattr(spool, "last_dried_at", None)
    if isinstance(ref, str):        # colonne ajoutee en TEXT par la migration
        try:
            ref = datetime.fromisoformat(ref)
        except ValueError:
            return None
    return ref


def needs_drying(spool, filament=None, now: Optional[datetime] = None) -> bool:
    """
    A secher : jamais sechee (pas de date), ou pas depuis plus que le delai de
    son filament. Une bobine sans date n'est pas presumee bonne. Meme regle
    pour l'alerte, l'AMS et la fiche bobine ; les archivees ne comptent pas.
    """
    if getattr(spool, "archived", False):
        return False
    ref = dry_reference(spool)
    return ref is None or ref < (now or datetime.utcnow()) - timedelta(days=days_for(filament))
