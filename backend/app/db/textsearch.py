"""
La recherche « contient », sans accents ni majuscules (07/11/2026) : « deco » trouve « Déco & art », « noel » trouve
« Noël », « jouet » trouve « Jouets de bureau ». SQLite ne sait comparer sans accents que l'ASCII : la fonction
bn_fold (posee sur chaque connexion, voir session.py) ramene un texte a ses lettres de base en minuscules, et le
mot cherche passe par la meme moulinette.
"""
import unicodedata

from sqlalchemy import func

from ..core.config import settings

_LIG = str.maketrans({"œ": "oe", "Œ": "oe", "æ": "ae", "Æ": "ae", "ß": "ss"})


def fold(s):
    """Le texte sans accents, en minuscules (None reste None)."""
    if s is None:
        return None
    s = unicodedata.normalize("NFD", str(s).translate(_LIG))
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def register(dbapi_conn) -> None:
    """Pose bn_fold sur une connexion SQLite."""
    dbapi_conn.create_function("bn_fold", 1, fold, deterministic=True)


def _esc(m: str) -> str:
    return m.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def contains(col, word: str):
    """La colonne contient le mot, ou qu'il soit, sans tenir compte des accents ni des majuscules ; % et _ pris a
    la lettre."""
    if str(settings.DATABASE_URL).startswith("sqlite"):
        return func.bn_fold(col).like(f"%{_esc(fold(word))}%", escape="\\")
    return col.ilike(f"%{_esc(word)}%", escape="\\")
