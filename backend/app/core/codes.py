"""
Code court unique par filament : AA, AB, ... ZZ (676 combinaisons).

Sert d'identifiant lisible a l'oeil sur les echantillons imprimes (#AA) et de
cible pour le scan camera. Il est attribue au FILAMENT (la reference), pas a la
bobine : deux bobines de la meme reference partagent donc le meme code.
"""
from __future__ import annotations

import string
from typing import Iterable, Optional

ALPHABET = string.ascii_uppercase
MAX_CODES = len(ALPHABET) ** 2   # 676


def index_to_code(i: int) -> str:
    """0 -> 'AA', 1 -> 'AB', 26 -> 'BA', 675 -> 'ZZ'."""
    if not 0 <= i < MAX_CODES:
        raise ValueError(f"index hors plage : {i}")
    return ALPHABET[i // 26] + ALPHABET[i % 26]


def code_to_index(code: str) -> Optional[int]:
    c = normalize(code)
    if not c:
        return None
    return ALPHABET.index(c[0]) * 26 + ALPHABET.index(c[1])


def normalize(code: Optional[str]) -> Optional[str]:
    """'#aa' | ' Ab ' -> 'AB'. None si ce n'est pas un code valide."""
    if not code:
        return None
    c = str(code).strip().upper().lstrip("#")
    if len(c) != 2 or any(ch not in ALPHABET for ch in c):
        return None
    return c


def next_free(used: Iterable[Optional[str]]) -> Optional[str]:
    """
    Premier code libre. On rebouche les trous laisses par les suppressions
    plutot que d'incrementer aveuglement : avec seulement 676 places, gaspiller
    serait dommage.
    """
    taken = {normalize(c) for c in used if normalize(c)}
    for i in range(MAX_CODES):
        c = index_to_code(i)
        if c not in taken:
            return c
    return None   # catalogue plein
