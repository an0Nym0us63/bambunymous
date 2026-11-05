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
