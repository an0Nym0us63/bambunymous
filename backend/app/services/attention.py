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

    # Identite visuelle, portee par l'alerte elle-meme : sans elle, le front
    # devrait recharger tout le catalogue pour retrouver la couleur d'un filament.
    color: Optional[str] = None
    colors_array: Optional[str] = None
    multicolor_type: Optional[str] = None
    brand: Optional[str] = None
    material: Optional[str] = None

    # Metrique cle de l'alerte (poids restant, date...). Separee du detail parce
    # que c'est l'information la PLUS utile : noyee dans une phrase, elle se
    # faisait tronquer sur mobile. Le front l'affiche a droite, sans troncature.
    value: Optional[str] = None

    # Cible : permet d'ouvrir la fiche SUR PLACE (feuille de detail) au lieu de
    # naviguer vers une autre page — sans quoi il fallait revenir a l'accueil
    # entre chaque alerte.
    entity: Optional[str] = None       # "filament" | "spool" | "print"
    entity_id: Optional[int] = None
    filament_id: Optional[int] = None  # pour les alertes de bobine


def _fil_visual(f) -> dict:
    """Champs d'affichage communs a toutes les alertes portant sur un filament."""
    return {
        "color": f.color,
        "colors_array": f.colors_array,
        "multicolor_type": f.multicolor_type,
        "brand": f.manufacturer,
        "material": f.fila_type or f.material,
    }


def _fil_title(f) -> str:
    return f.translated_name or f.name or f"Filament #{f.id}"


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
            title=_fil_title(f),
            detail="",
            severity="info",
            link=f"/filaments?id={f.id}",
            entity="filament", entity_id=f.id,
            **_fil_visual(f),
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
            title=_fil_title(f),
            detail=f"Bobine #{s.id}",
            value=f"{int(s.remaining_weight_g)} g · {pct} %",
            severity="warn",
            link=f"/filaments?id={f.id}",
            entity="spool", entity_id=s.id, filament_id=f.id,
            **_fil_visual(f),
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
            detail="",
            value=p.print_date.strftime("%d/%m") if p.print_date else None,
            severity="warn",
            link=f"/prints?id={p.id}",
            entity="print", entity_id=p.id,
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
            detail="",
            value=p.print_date.strftime("%d/%m") if p.print_date else None,
            severity="info",
            link=f"/prints?id={p.id}",
            entity="print", entity_id=p.id,
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
            detail="Relance possible depuis la fiche",
            value=p.print_date.strftime("%d/%m") if p.print_date else None,
            severity="warn",
            link=f"/prints?id={p.id}",
            entity="print", entity_id=p.id,
        )
        for p in rows
    ]


@check("no_profile", "Filaments sans profil d'impression", "🎛")
async def _filaments_without_profile(db) -> list[Alert]:
    """
    profile_id absent : l'imprimante ne peut pas retrouver le profil du filament,
    et l'association automatique depuis l'AMS ne fonctionne pas.
    """
    rows = (await db.execute(
        select(Filament).where(
            or_(Filament.profile_id.is_(None), Filament.profile_id == "")
        )
    )).scalars().all()
    return [
        Alert(
            key=f"no_profile:filament:{f.id}",
            category="no_profile",
            title=_fil_title(f),
            detail="",
            severity="info",
            link=f"/filaments?id={f.id}",
            entity="filament", entity_id=f.id,
            **_fil_visual(f),
        )
        for f in rows
    ]


@check("no_color_code", "Filaments Bambu sans code couleur", "🎨")
async def _bambu_without_color_code(db) -> list[Alert]:
    """
    Filament Bambu sans fila_color_code : le rapprochement avec le catalogue
    officiel (et donc l'enrichissement automatique) ne peut pas se faire.
    Verification limitee aux filaments Bambu — les autres marques n'ont pas ce code.
    """
    rows = (await db.execute(
        select(Filament).where(
            Filament.manufacturer.ilike("%bambu%"),
            or_(Filament.fila_color_code.is_(None), Filament.fila_color_code == ""),
        )
    )).scalars().all()
    return [
        Alert(
            key=f"no_color_code:filament:{f.id}",
            category="no_color_code",
            title=_fil_title(f),
            detail="",
            severity="info",
            link=f"/filaments?id={f.id}",
            entity="filament", entity_id=f.id,
            **_fil_visual(f),
        )
        for f in rows
    ]


@check("no_rfid", "Bobines Bambu sans RFID", "📡")
async def _bambu_spools_without_rfid(db) -> list[Alert]:
    """
    Bobine Bambu active sans tag RFID : l'AMS ne la reconnaitra pas toute seule,
    il faudra l'associer a la main a chaque changement.
    """
    rows = (await db.execute(
        select(Spool, Filament)
        .join(Filament, Filament.id == Spool.filament_id)
        .where(
            Spool.archived.is_(False),
            Filament.manufacturer.ilike("%bambu%"),
            or_(Spool.tag_number.is_(None), Spool.tag_number == ""),
        )
    )).all()
    return [
        Alert(
            key=f"no_rfid:spool:{s.id}",
            category="no_rfid",
            title=_fil_title(f),
            detail=f"Bobine #{s.id}",
            severity="info",
            link=f"/filaments?id={f.id}",
            entity="spool", entity_id=s.id, filament_id=f.id,
            **_fil_visual(f),
        )
        for s, f in rows
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
        # On renvoie plus d'alertes que ce qui sera affiche : le front garde le
        # surplus en reserve et remplace instantanement une alerte masquee, sans
        # rappeler l'API.
        sample = random.sample(alerts, min(per_category * 4, len(alerts)))
        out.append({
            "category": cat,
            "label": label,
            "icon": icon,
            "total": len(alerts),
            "shown": per_category,          # combien en afficher
            "alerts": [a.__dict__ for a in sample],
        })
    return out, errors
