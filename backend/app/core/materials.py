"""
Familles de matériaux.

Distinction à respecter partout :
  - material  : la famille          → PLA, PETG, ABS…
  - fila_type : la variante/sous-type → PLA Basic, PLA Silk, PETG-HF…

Le catalogue Bambu ne fournit que le sous-type ; on en déduit la famille ici.
"""
from __future__ import annotations

from typing import Optional

# Ordre important : les plus spécifiques d'abord (PLA-CF avant PLA).
MATERIALS = [
    "PLA-CF", "PETG-CF", "PA-CF", "PPS", "PETG", "PLA", "ABS", "ASA",
    "TPU", "PVA", "BVOH", "PC", "PA",
]

_BY_LENGTH = sorted(MATERIALS, key=len, reverse=True)


def family_of(value: Optional[str], fallback: Optional[str] = None) -> Optional[str]:
    """
    Déduit la famille depuis un sous-type ou un libellé libre.

    "PLA Basic"  → "PLA"
    "PLA Silk+"  → "PLA"
    "PETG-HF"    → "PETG"
    "PLA-CF"     → "PLA-CF"   (famille à part entière)
    "Support W"  → fallback   (rien de reconnu)
    """
    try:                                         # nos familles (Parametres) d'abord, 03/11/2026
        from ..services.family_map import lookup
    except Exception:
        lookup = None
    for raw in (value, fallback):
        if not raw:
            continue
        mine = lookup(raw) if lookup else None
        if mine:
            return mine
        norm = str(raw).strip().upper().replace("_", "-")
        for m in _BY_LENGTH:
            # match sur le début, en évitant "PLA" dans "PLASTIC"
            if norm == m or norm.startswith(m + " ") or norm.startswith(m + "-"):
                return m
        for m in _BY_LENGTH:
            if m in norm:
                return m
    return fallback


def is_family(value: Optional[str]) -> bool:
    """Vrai si la valeur est déjà une famille valide."""
    return bool(value) and str(value).strip().upper() in MATERIALS
