"""
Classification des couleurs de filament en « teintes » (color buckets).

Un filament peut contenir plusieurs couleurs (gradient, coaxial) : on stocke
donc dans Filament.color_bucket une liste CSV de teintes, sans doublon, la
teinte dominante (première couleur) en tête.

Exemple : "#0047bb,#bb22a3" → "bleu,rose"

La colonne est réutilisable ailleurs (stats, tri, groupement, recherche).
"""
from __future__ import annotations

import colorsys
from typing import Iterable, Optional

# Liste exhaustive des teintes. Ordre = ordre d'affichage dans l'UI.
# slug → (libellé FR, couleur représentative pour la pastille du filtre)
COLOR_BUCKETS: dict[str, tuple[str, str]] = {
    "rouge":       ("Rouge",       "#e11d48"),
    "orange":      ("Orange",      "#f97316"),
    "jaune":       ("Jaune",       "#facc15"),
    "vert":        ("Vert",        "#22c55e"),
    "cyan":        ("Cyan",        "#06b6d4"),
    "bleu":        ("Bleu",        "#3b82f6"),
    "violet":      ("Violet",      "#8b5cf6"),
    "rose":        ("Rose",        "#ec4899"),
    "marron":      ("Marron",      "#8b5e3c"),
    "beige":       ("Beige",       "#e3d5b8"),
    "blanc":       ("Blanc",       "#f8fafc"),
    "gris":        ("Gris",        "#94a3b8"),
    "noir":        ("Noir",        "#1e293b"),
    "transparent": ("Transparent", "#cbd5e1"),
}

BUCKET_SLUGS = list(COLOR_BUCKETS.keys())


def _parse_hex(h: str) -> Optional[tuple[int, int, int, int]]:
    """'#0047bbFF' | '0047bb' → (r, g, b, a). None si illisible."""
    if not h:
        return None
    s = str(h).strip().lstrip("#")
    if len(s) == 3:                       # #abc → #aabbcc
        s = "".join(c * 2 for c in s)
    if len(s) not in (6, 8):
        return None
    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        a = int(s[6:8], 16) if len(s) == 8 else 255
    except ValueError:
        return None
    return r, g, b, a


def bucket_of(hex_color: str) -> Optional[str]:
    """Retourne le slug de teinte d'une couleur hex, ou None si illisible."""
    parsed = _parse_hex(hex_color)
    if not parsed:
        return None
    r, g, b, a = parsed

    # Alpha significativement transparent → teinte "transparent"
    if a < 128:
        return "transparent"

    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hue = h * 360

    # Achromatiques : la saturation prime sur la teinte
    if v < 0.14:
        return "noir"
    if s < 0.10:
        if v > 0.88:
            return "blanc"
        if v > 0.22:
            return "gris"
        return "noir"

    # Beige : jaune/orange très clair et peu saturé
    if 20 <= hue < 60 and s < 0.42 and v > 0.72:
        return "beige"
    # Marron : rouge/orange/jaune sombre ou terne
    if 10 <= hue < 45 and (v < 0.62 or (s > 0.25 and v < 0.78 and s < 0.75)):
        return "marron"
    # Rouge très sombre → marron plutôt que rouge
    if (hue < 10 or hue >= 350) and v < 0.35:
        return "marron"

    # Faible saturation restante → gris (évite de teinter les gris colorés)
    if s < 0.16:
        return "blanc" if v > 0.85 else "gris"

    if hue < 10 or hue >= 345:
        return "rouge"
    if hue < 40:
        return "orange"
    if hue < 70:
        return "jaune"
    if hue < 160:
        return "vert"
    if hue < 195:
        return "cyan"
    if hue < 248:
        return "bleu"
    if hue < 290:
        return "violet"
    return "rose"


def buckets_for(color: Optional[str],
                colors_array: Optional[str]) -> Optional[str]:
    """
    Calcule la valeur de Filament.color_bucket.

    color        : couleur principale (hex, avec ou sans #)
    colors_array : CSV des couleurs pour les multicolores

    Retourne un CSV de slugs sans doublon ("bleu,rose"), ou None.
    """
    raw: list[str] = []
    if colors_array:
        raw += [c for c in str(colors_array).split(",") if c.strip()]
    if color:
        raw.append(str(color))

    out: list[str] = []
    for c in raw:
        b = bucket_of(c)
        if b and b not in out:
            out.append(b)
    return ",".join(out) if out else None


def matches(color_bucket: Optional[str], slug: str) -> bool:
    """Test d'appartenance côté Python (le filtre SQL a sa propre version)."""
    if not color_bucket:
        return False
    return slug in [t.strip() for t in color_bucket.split(",")]


def all_buckets() -> list[dict]:
    """Palette exposée à l'UI."""
    return [{"slug": k, "label": v[0], "hex": v[1]}
            for k, v in COLOR_BUCKETS.items()]
