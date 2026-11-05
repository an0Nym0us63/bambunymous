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


def take_overrun(sp, grams: float) -> float:
    """Des grammes rendus a une bobine passee sous notre zero (05/11/2026) : ils remboursent d'abord ce qu'elle a imprime
    en dessous (ce filament existait, on l'avait oublie : une piece annulee jamais rendue) ; renvoie la part absorbee."""
    if grams <= 0 or getattr(sp, "drift_g", None) is not None:
        return 0.0
    a = round(min(float(sp.overrun_g or 0), float(grams)), 1)
    if a > 0:
        sp.overrun_g = round(float(sp.overrun_g) - a, 1) or None
    return a


def give_back(sp, grams: float) -> float:
    """Rend des grammes a une bobine : le sous-zero d'abord, le reste a son poids. Renvoie la part absorbee."""
    a = take_overrun(sp, grams)
    sp.remaining_weight_g = round(float(sp.remaining_weight_g or 0) + float(grams) - a, 1)
    return a


def take_back(sp, grams: float) -> None:
    """L'inverse (un rendu annule) : ce que le poids ne couvre pas repasse sous notre zero."""
    cur = float(sp.remaining_weight_g or 0)
    sp.remaining_weight_g = round(max(0.0, cur - float(grams)), 1)
    deficit = float(grams) - cur
    if deficit >= 0.5 and getattr(sp, "drift_g", None) is None:
        sp.overrun_g = round(float(sp.overrun_g or 0) + deficit, 1)


def weighed(sp) -> None:
    """Un poids mesure (pesee, poids pose a la main ou au scan) : c'est le vrai, le sous-zero d'avant ne compte plus."""
    if getattr(sp, "drift_g", None) is None:
        sp.overrun_g = None


# l'historique de la bobine dit tout, avec sa cause (05/11/2026) : ces lignes n'y changent pas le poids, elles
# l'expliquent (« zero » : imprime sous notre zero ; « ecart » : l'ecart du suivi mesure, corrige ou ecarte)
INFO_KINDS = ("zero", "ecart")


def note(db, sp, kind: str, grams, label: str, print_id=None, usage_id=None) -> None:
    from ..models.spool_move import SpoolMove
    db.add(SpoolMove(spool_id=sp.id, grams=round(float(grams or 0), 1), kind=kind, print_id=print_id, usage_id=usage_id,
                     label=(label or "")[:250] or None))


def back_note(a: float) -> str:
    return f" · dont {a:g} g sous notre zéro".replace(".", ",") if a > 0 else ""


# au-dela de AUTO_OFF_PCT % du poids d'une bobine pleine (100 g sur 1 kg), une mesure automatique sort d'elle-meme des
# stats (05/11/2026) : le suivi ne se trompe pas d'autant, c'est une autre cause (jetee en partie, pretee, poids de
# depart faux) ; elle reste lisible, et « Remettre » la fait compter
AUTO_OFF_PCT = 10
AUTO_OFF = f"Écart de plus de {AUTO_OFF_PCT} % (automatique)"


def record(sp, left: float, kind: str, full: float | None = None) -> bool:
    """La bobine est vraiment finie, et on lui croyait encore « left » grammes (negatif : deja sous notre zero).
    Une seule mesure par bobine. full : le poids d'une bobine pleine de son filament."""
    if sp is None or getattr(sp, "drift_g", None) is not None:
        return False
    sp.drift_g = round(float(left) - float(sp.overrun_g or 0), 1)
    sp.drift_kind = kind
    sp.drift_at = datetime.utcnow()
    if abs(sp.drift_g) > (full or 1000.0) * AUTO_OFF_PCT / 100:
        sp.drift_off = AUTO_OFF
    return True


async def full_of(db, sp) -> float:
    """Le poids d'une bobine pleine de son filament (1 kg sans le savoir)."""
    from ..models.filament import Filament
    f = await db.get(Filament, sp.filament_id) if sp is not None else None
    return float(f.filament_weight_g) if f and f.filament_weight_g else 1000.0


PAST_OFF = "Passé, déduit de l'historique"
K_PAST = "DRIFT_PAST_V1"


def past_estimate(full: float, consumed: float, before_archive) -> float:
    """L'ecart d'une bobine archivee avant le suivi, deduit de son historique : le poids qu'elle avait chez nous a
    l'archivage s'il est connu et non nul (trace depuis le 02/11/2026) ; sinon son poids nominal moins tout ce qu'elle a
    imprime (en supposant qu'elle est arrivee pleine ; negatif : elle a imprime au-dela)."""
    if before_archive is not None and before_archive > 0.5:
        return round(float(before_archive), 1)
    return round(float(full) - float(consumed), 1)


async def backfill_past() -> int:
    """Une fois (05/11/2026) : les bobines archivees sans mesure recoivent leur ecart deduit de l'historique, ecarte des
    stats par defaut (PAST_OFF) ; l'admin choisit celles qui y entrent, et peut corriger l'ecart."""
    import logging
    from datetime import datetime as _dt
    from sqlalchemy import select, func
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Spool, Filament
    from ..models.print_history import FilamentUsage
    from ..models.spool_move import SpoolMove
    from .settings_service import get_setting, set_setting
    log = logging.getLogger(__name__)
    async with AsyncSessionLocal() as db:
        if await get_setting(db, K_PAST, ""):
            return 0
        rows = (await db.execute(select(Spool, Filament).outerjoin(Filament, Filament.id == Spool.filament_id)
                                 .where(Spool.archived.is_(True), Spool.drift_g.is_(None)))).all()
        used = dict((await db.execute(select(FilamentUsage.spool_id, func.sum(FilamentUsage.grams_used))
                                      .where(FilamentUsage.spool_id.is_not(None))
                                      .group_by(FilamentUsage.spool_id))).all())
        back, before, fin = {}, {}, {}
        for m in (await db.execute(select(SpoolMove).where(SpoolMove.reverted_at.is_(None)))).scalars().all():
            if m.kind in ("rendu", "annule") and not m.unlinked:
                back[m.spool_id] = back.get(m.spool_id, 0.0) + float(m.grams or 0)
            elif m.kind == "fin":
                fin[m.spool_id] = float(m.grams or 0)
            elif m.kind == "correction" and (m.label or "").startswith("Bobine archivée"):
                before[m.spool_id] = -float(m.grams or 0)
        n = 0
        for s, f in rows:
            consumed = float(used.get(s.id) or 0) - back.get(s.id, 0.0)
            if consumed < 1 and s.id not in before and s.id not in fin:
                continue                                 # jamais servie : rien a mesurer
            full = float(f.filament_weight_g) if f and f.filament_weight_g else 1000.0
            s.drift_g = fin[s.id] if s.id in fin else past_estimate(full, consumed, before.get(s.id))
            s.drift_kind = "historique"
            s.drift_at = s.updated_at or _dt.utcnow()
            s.drift_off = PAST_OFF
            n += 1
        await set_setting(db, K_PAST, _dt.utcnow().isoformat(timespec="seconds"))
        await db.commit()
    log.info(f"[DERIVE] {n} bobine(s) archivee(s) du passe : ecart deduit de l'historique, ecarte des stats")
    return n
