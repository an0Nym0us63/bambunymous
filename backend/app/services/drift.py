"""
La derive du suivi des bobines (05/11/2026) : a la fin de vie d'une bobine, l'ecart entre notre poids et le vrai (0).

  positive : on lui croyait encore x g quand elle s'est vraiment finie (relais de l'AMS, suite choisie a la main, ou
             archivee « finie » avec un reste chez nous) ;
  negative : elle a imprime x g au-dela de notre zero (le decompte s'arrete a 0 : ce qui passe dessous est cumule
             dans overrun_g a chaque fin d'impression).

Mesuree une seule fois par bobine ; une bobine peut etre ecartee des stats (drift_off : la raison) ou son ecart corrige
a la main. Les stats (Statistiques > Filaments) en tirent la precision du suivi.
"""
from datetime import datetime

KINDS = {"relais": "Relais de l'AMS", "suite": "Suite choisie à la main", "archive": "Archivée finie"}


def add_overrun(sp, grams: float) -> None:
    """Ce que la bobine a imprime sous notre zero, cumule jusqu'a sa fin."""
    if grams >= 0.5 and getattr(sp, "drift_g", None) is None:
        sp.overrun_g = round(float(sp.overrun_g or 0) + grams, 1)


def record(sp, left: float, kind: str) -> bool:
    """La bobine est vraiment finie, et on lui croyait encore « left » grammes (negatif : deja sous notre zero).
    Une seule mesure par bobine."""
    if sp is None or getattr(sp, "drift_g", None) is not None:
        return False
    sp.drift_g = round(float(left) - float(sp.overrun_g or 0), 1)
    sp.drift_kind = kind
    sp.drift_at = datetime.utcnow()
    return True
