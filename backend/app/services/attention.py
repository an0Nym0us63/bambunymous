"""
Points d'attention — alertes recalculees a la volee.

Principe : chaque verification est une fonction enregistree dans CHECKS. Pour en
ajouter une, on ecrit la fonction et on la decore avec @check(...). Rien d'autre
a toucher : l'API, le regroupement par categorie, la mise en sourdine et
l'affichage suivent automatiquement.

Les alertes ne sont JAMAIS stockees : elles sont recalculees a chaque appel. Seule
la mise en sourdine est persistee (table attention_dismissals), indexee sur une
cle STABLE (ex. "no_spool:filament:106"). Consequence utile : si le probleme
disparait puis revient, l'alerte revient aussi — sauf si l'utilisateur l'a
ignoree definitivement.
"""
from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Optional

from sqlalchemy import and_, func, or_, select

from ..models.attention import AttentionDismissal
from ..models.filament import Filament, Spool
from ..models.print_history import Print, FilamentUsage, PrintSnapshot

logger = logging.getLogger(__name__)


@dataclass
class Alert:
    key: str                       # identifiant stable — sert a la mise en sourdine
    category: str                  # cle de categorie
    title: str
    detail: str = ""
    severity: str = "info"         # info | warn
    link: Optional[str] = None     # route front, ex. "/filaments?id=106"


# ── Registre ───────────────────────────────────────────────────────────────
CHECKS: list[tuple[str, str, str, Callable]] = []   # (cat_key, label, icone, fn)


def check(category: str, label: str, icon: str = "•"):
    """Enregistre une verification. Signature attendue : async fn(db) -> list[Alert]."""
    def deco(fn):
        CHECKS.append((category, label, icon, fn))
        return fn
    return deco


# ── Verifications ──────────────────────────────────────────────────────────
@check("no_spool", "Filaments sans bobine", "📦")
async def _filaments_without_spool(db) -> list[Alert]:
    """Filament au catalogue mais plus aucune bobine active : a racheter."""
    sub = (select(Spool.filament_id)
           .where(Spool.archived.is_(False))
           .distinct())
    rows = (await db.execute(
        select(Filament).where(Filament.id.notin_(sub))
    )).scalars().all()
    return [
        Alert(
            key=f"no_spool:filament:{f.id}",
            category="no_spool",
            title=f.translated_name or f.name or f"Filament #{f.id}",
            detail=f"{f.manufacturer or '—'} · {f.material or '—'} — plus aucune bobine",
            severity="info",
            link=f"/filaments?id={f.id}",
        )
        for f in rows
    ]


@check("low_spool", "Bobines bientôt vides", "🪫")
async def _spools_low(db) -> list[Alert]:
    """Bobine sous 15 % : penser a lancer les impressions qui l'utilisent, ou racheter."""
    rows = (await db.execute(
        select(Spool, Filament)
        .join(Filament, Filament.id == Spool.filament_id)
        .where(
            Spool.archived.is_(False),
            Spool.remaining_weight_g.isnot(None),
            Filament.filament_weight_g > 0,
            Spool.remaining_weight_g < Filament.filament_weight_g * 0.15,
        )
    )).all()
    out = []
    for s, f in rows:
        pct = round(s.remaining_weight_g / f.filament_weight_g * 100)
        out.append(Alert(
            key=f"low_spool:spool:{s.id}",
            category="low_spool",
            title=f.translated_name or f.name or f"Filament #{f.id}",
            detail=f"Bobine #{s.id} — il reste {int(s.remaining_weight_g)} g ({pct} %)",
            severity="warn",
            link=f"/filaments?id={f.id}",
        ))
    return out


@check("no_mapping", "Impressions sans bobine associée", "🔗")
async def _prints_without_mapping(db) -> list[Alert]:
    """
    Consommation enregistree mais aucune bobine associee : le filament est
    decompte nulle part, et le cout du print est faux.
    """
    rows = (await db.execute(
        select(Print)
        .join(FilamentUsage, FilamentUsage.print_id == Print.id)
        .where(FilamentUsage.spool_id.is_(None), FilamentUsage.grams_used > 0)
        .group_by(Print.id)
        .order_by(Print.print_date.desc())
        .limit(60)
    )).scalars().all()
    return [
        Alert(
            key=f"no_mapping:print:{p.id}",
            category="no_mapping",
            title=p.file_name or f"Impression #{p.id}",
            detail="Filament consommé mais aucune bobine associée — coût incomplet",
            severity="warn",
            link=f"/prints?id={p.id}",
        )
        for p in rows
    ]


@check("no_photo", "Impressions sans photo", "📷")
async def _prints_without_photo(db) -> list[Alert]:
    """Impression reussie dont il ne reste aucune trace visuelle."""
    snap = select(PrintSnapshot.print_id).distinct()
    rows = (await db.execute(
        select(Print)
        .where(
            Print.status == "SUCCESS",
            Print.id.notin_(snap),
            Print.plate_image.is_(None),
        )
        .order_by(Print.print_date.desc())
        .limit(60)
    )).scalars().all()
    return [
        Alert(
            key=f"no_photo:print:{p.id}",
            category="no_photo",
            title=p.file_name or f"Impression #{p.id}",
            detail="Aucune photo ni vignette",
            severity="info",
            link=f"/prints?id={p.id}",
        )
        for p in rows
    ]


@check("no_3mf", "Impressions sans métadonnées", "🧩")
async def _prints_without_3mf(db) -> list[Alert]:
    """
    3MF jamais recupere : ni filament, ni cout, ni duree estimee. Souvent un
    redemarrage tombe pendant la fenetre de retry — /reenrich peut rattraper.
    """
    cutoff = datetime.utcnow() - timedelta(days=30)
    rows = (await db.execute(
        select(Print)
        .where(
            Print.model_3mf.is_(None),
            Print.task_name.isnot(None),
            Print.print_date >= cutoff,
        )
        .order_by(Print.print_date.desc())
        .limit(30)
    )).scalars().all()
    return [
        Alert(
            key=f"no_3mf:print:{p.id}",
            category="no_3mf",
            title=p.file_name or f"Impression #{p.id}",
            detail="3MF non récupéré — relance possible depuis la fiche",
            severity="warn",
            link=f"/prints?id={p.id}",
        )
        for p in rows
    ]


# ── Assemblage ─────────────────────────────────────────────────────────────
async def _dismissed_keys(db) -> set[str]:
    """Cles actuellement en sourdine (definitivement, ou dont le delai court encore)."""
    now = datetime.utcnow()
    rows = (await db.execute(
        select(AttentionDismissal.key).where(
            or_(AttentionDismissal.until.is_(None), AttentionDismissal.until > now)
        )
    )).scalars().all()
    return set(rows)


async def build_attention(db, per_category: int = 3) -> tuple[list[dict], list[dict]]:
    """
    Renvoie (categories, erreurs).

    Les categories non vides, chacune avec un echantillon ALEATOIRE d'alertes.
    L'aleatoire est volontaire : avec 40 filaments sans bobine, un tri fixe
    montrerait eternellement les 3 memes et les autres resteraient invisibles.
    Le total reel est renvoye a cote.

    Les erreurs de check sont REMONTEES et non plus seulement journalisees :
    si les cinq checks echouaient, l'ecran affichait "Rien a signaler" sans le
    moindre indice, ce qui rendait la panne invisible.
    """
    dismissed = await _dismissed_keys(db)
    out: list[dict] = []
    errors: list[dict] = []

    for cat, label, icon, fn in CHECKS:
        try:
            alerts = await fn(db)
        except Exception as e:
            logger.exception(f"[ATTENTION] check {cat} a échoué")
            errors.append({"category": cat, "label": label,
                           "error": f"{type(e).__name__}: {e}"})
            continue
        alerts = [a for a in alerts if a.key not in dismissed]
        if not alerts:
            continue
        sample = random.sample(alerts, min(per_category, len(alerts)))
        out.append({
            "category": cat,
            "label": label,
            "icon": icon,
            "total": len(alerts),
            "alerts": [a.__dict__ for a in sample],
        })
    return out, errors
