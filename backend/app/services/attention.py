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

import json as _json
import os
from pathlib import Path

from sqlalchemy import and_, func, or_, select

from ..models.attention import AttentionDismissal
from ..models.filament import Filament, Spool
from ..models.print_history import Print, FilamentUsage, PrintSnapshot

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
PHOTO_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")


def _has_photo(fid: int) -> bool:
    """Les photos de filament vivent sur le disque, pas en base."""
    d = DATA_DIR / "filaments" / str(fid)
    if not d.is_dir():
        return False
    return any(f.suffix.lower() in PHOTO_EXT for f in d.iterdir())


def _print_image(p) -> Optional[str]:
    """Vignette du print : photo mise en avant, sinon l'image du plateau."""
    name = getattr(p, "cover_photo", None) or (p.plate_image or "").split("/")[-1]
    return f"/api/v1/prints/{p.id}/file/{name}" if name else None


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

    # Vignette (impressions) : une pastille de couleur n'a aucun sens pour un
    # print — c'est le visuel de la piece qu'on veut reconnaitre.
    image: Optional[str] = None

    # Urgence, pour les categories triees (rank croissant = plus urgent).
    rank: Optional[float] = None


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
CHECKS: list[dict] = []


def check(category: str, label: str, icon: str = "•",
          shown: int = 3, random_sample: bool = True):
    """
    Enregistre une verification. Signature attendue : async fn(db) -> list[Alert].

    shown         : combien d'alertes afficher pour cette categorie.
    random_sample : True  -> echantillon aleatoire (evite de montrer eternellement
                             les 3 memes parmi 40).
                    False -> tri par urgence (Alert.rank croissant). Pour les
                             bobines presque vides, l'aleatoire n'a aucun sens :
                             c'est la plus vide qu'on veut voir en premier.
    """
    def deco(fn):
        CHECKS.append({"category": category, "label": label, "icon": icon,
                       "fn": fn, "shown": shown, "random": random_sample})
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


LOW_SPOOL_PCT = 25          # seuil d'alerte, en % du poids nominal


@check("low_spool", f"Bobines sous {LOW_SPOOL_PCT} %", "🪫",
       shown=5, random_sample=False)
async def _spools_low(db) -> list[Alert]:
    """Bobine sous le seuil : penser a racheter, ou a lancer ce qui l'utilise."""
    rows = (await db.execute(
        select(Spool, Filament)
        .join(Filament, Filament.id == Spool.filament_id)
        .where(
            Spool.archived.is_(False),
            Spool.remaining_weight_g.isnot(None),
            Filament.filament_weight_g > 0,
            Spool.remaining_weight_g < Filament.filament_weight_g * (LOW_SPOOL_PCT / 100.0),
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
            rank=pct,                       # la plus vide en premier
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
            image=_print_image(p),
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
            image=_print_image(p),
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


@check("fil_no_photo", "Filaments sans photo", "📷")
async def _filaments_without_photo(db) -> list[Alert]:
    """
    Aucune photo : impossible de reconnaitre le rendu reel de la teinte, qui ne
    correspond jamais tout a fait au code couleur.
    """
    rows = (await db.execute(select(Filament))).scalars().all()
    return [
        Alert(
            key=f"fil_no_photo:filament:{f.id}",
            category="fil_no_photo",
            title=_fil_title(f),
            detail="",
            severity="info",
            link=f"/filaments?id={f.id}",
            entity="filament", entity_id=f.id,
            **_fil_visual(f),
        )
        for f in rows if not _has_photo(f.id)
    ]


@check("to_order", "Filaments à commander", "🛒")
async def _filaments_to_order(db) -> list[Alert]:
    """Marques \"a commander\" a la main (champ to_order)."""
    rows = (await db.execute(
        select(Filament).where(Filament.to_order.is_(True))
    )).scalars().all()
    return [
        Alert(
            key=f"to_order:filament:{f.id}",
            category="to_order",
            title=_fil_title(f),
            detail="",
            severity="warn",
            link=f"/filaments?id={f.id}",
            entity="filament", entity_id=f.id,
            **_fil_visual(f),
        )
        for f in rows
    ]


UNUSED_DAYS = 180


@check("unused", f"Filaments inutilisés depuis {UNUSED_DAYS // 30} mois", "🕸")
async def _filaments_unused(db) -> list[Alert]:
    """
    Du stock qui dort. On ne regarde que les filaments AYANT des bobines actives :
    ceux qui n'en ont plus sont deja couverts par \"Filaments sans bobine\", les
    signaler deux fois ne servirait a rien.
    """
    cutoff = datetime.utcnow() - timedelta(days=UNUSED_DAYS)
    rows = (await db.execute(
        select(Filament, func.max(Spool.last_used_at).label("last"))
        .join(Spool, Spool.filament_id == Filament.id)
        .where(Spool.archived.is_(False))
        .group_by(Filament.id)
        .having(or_(
            func.max(Spool.last_used_at).is_(None),
            func.max(Spool.last_used_at) < cutoff,
        ))
    )).all()
    out = []
    for f, last in rows:
        if last:
            days = (datetime.utcnow() - last).days
            value = f"{days // 30} mois"
        else:
            value = "jamais"
        out.append(Alert(
            key=f"unused:filament:{f.id}",
            category="unused",
            title=_fil_title(f),
            detail="",
            value=value,
            severity="info",
            link=f"/filaments?id={f.id}",
            entity="filament", entity_id=f.id,
            **_fil_visual(f),
        ))
    return out


# ── Preferences d'affichage ────────────────────────────────────────────────
PREF_KEY = "ATTENTION_PREFS"   # {"order": [...], "hidden": [...]}


async def get_prefs(db) -> dict:
    """Ordre d'affichage et categories masquees. Tolerant : une preference qui
    reference une categorie disparue est simplement ignoree."""
    from .settings_service import get_setting
    raw = await get_setting(db, PREF_KEY, "")
    try:
        p = _json.loads(raw) if raw else {}
    except Exception:
        p = {}
    known = [c["category"] for c in CHECKS]
    order = [c for c in (p.get("order") or []) if c in known]
    order += [c for c in known if c not in order]      # nouvelles categories a la fin
    hidden = [c for c in (p.get("hidden") or []) if c in known]
    return {"order": order, "hidden": hidden}


async def set_prefs(db, order: list[str], hidden: list[str]) -> dict:
    from .settings_service import set_setting
    known = {c["category"] for c in CHECKS}
    payload = {
        "order":  [c for c in order if c in known],
        "hidden": [c for c in hidden if c in known],
    }
    await set_setting(db, PREF_KEY, _json.dumps(payload))
    return await get_prefs(db)


async def ordered_checks(db, include_hidden: bool = False) -> list[dict]:
    """Les checks, dans l'ordre choisi, masquees exclues."""
    prefs = await get_prefs(db)
    by_cat = {c["category"]: c for c in CHECKS}
    out = []
    for cat in prefs["order"]:
        c = by_cat.get(cat)
        if not c:
            continue
        if not include_hidden and cat in prefs["hidden"]:
            continue
        out.append(c)
    return out


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


CATEGORIES = {c["category"]: (c["label"], c["icon"]) for c in CHECKS}


async def list_dismissed(db) -> list[dict]:
    """
    Les alertes en sourdine, rendues LISIBLES.

    Une cle brute ("no_spool:filament:106") ne dit rien a l'utilisateur : on la
    decompose et on va rechercher l'entite pour reconstituer le nom, la couleur
    et la marque.
    """
    rows = (await db.execute(
        select(AttentionDismissal).order_by(AttentionDismissal.created_at.desc())
    )).scalars().all()

    out = []
    now = datetime.utcnow()
    for d in rows:
        parts = (d.key or "").split(":")
        cat = parts[0] if parts else ""
        entity = parts[1] if len(parts) > 2 else None
        try:
            eid = int(parts[2]) if len(parts) > 2 else None
        except ValueError:
            eid = None

        label, icon = CATEGORIES.get(cat, (cat or "Inconnu", "•"))
        item = {
            "key": d.key,
            "category": cat,
            "label": label,
            "icon": icon,
            "until": d.until.isoformat() if d.until else None,
            "forever": d.until is None,
            "expired": bool(d.until and d.until <= now),
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "title": d.key,
        }

        # Reconstitution de la CIBLE.
        #
        # entity seul ne suffit pas : le front a besoin de entity_id (et de
        # filament_id pour une bobine) pour ouvrir la fiche. Sans eux, le clic
        # partait sur des identifiants undefined.
        #
        # Si l'entite a disparu entre-temps, on ne pose PAS entity : la ligne
        # reste affichee (on peut lever la sourdine) mais n'est pas cliquable.
        f = None
        if entity == "filament" and eid:
            f = await db.get(Filament, eid)
            if f is not None:
                item["entity"] = "filament"
                item["entity_id"] = f.id
        elif entity == "spool" and eid:
            sp = await db.get(Spool, eid)
            if sp:
                f = await db.get(Filament, sp.filament_id)
                item["detail"] = f"Bobine #{sp.id}"
                item["entity"] = "spool"
                item["entity_id"] = sp.id
                item["filament_id"] = sp.filament_id
        elif entity == "print" and eid:
            p = await db.get(Print, eid)
            if p is not None:
                item["title"] = p.file_name or f"Impression #{eid}"
                item["entity"] = "print"
                item["entity_id"] = p.id
                item["image"] = _print_image(p)
            else:
                item["title"] = f"Impression #{eid} (supprimée)"

        if f is not None:
            item["title"] = _fil_title(f)
            item.update(_fil_visual(f))
        out.append(item)
    return out


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

    # Ordre choisi par l'utilisateur, categories masquees exclues.
    for c in await ordered_checks(db):
        cat, label, icon, fn = c["category"], c["label"], c["icon"], c["fn"]
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

        shown = c["shown"]
        # On renvoie plus d'alertes que ce qui sera affiche : le front garde le
        # surplus en reserve et remplace instantanement une alerte masquee, sans
        # rappeler l'API.
        keep = min(shown * 4, len(alerts))
        if c["random"]:
            sample = random.sample(alerts, keep)
        else:
            # Tri par urgence, pas d'aleatoire : la reserve reste ordonnee, donc
            # masquer la plus vide fait bien remonter la SUIVANTE plus vide.
            sample = sorted(alerts, key=lambda a: (a.rank if a.rank is not None else 0))[:keep]

        out.append({
            "category": cat,
            "label": label,
            "icon": icon,
            "total": len(alerts),
            "shown": shown,
            "alerts": [a.__dict__ for a in sample],
        })
    return out, errors


async def all_alerts(db) -> tuple[list[dict], list[dict]]:
    """
    TOUTES les alertes, sans echantillonnage — pour l'ecran de consultation
    complet (Parametres). Les mises en sourdine sont marquees, pas retirees :
    on veut pouvoir les voir et les reactiver.
    """
    dismissed = await _dismissed_keys(db)
    out: list[dict] = []
    errors: list[dict] = []
    # include_hidden : l'ecran complet doit montrer meme les categories masquees
    # de l'accueil, sinon elles deviendraient inaccessibles.
    for c in await ordered_checks(db, include_hidden=True):
        cat, label, icon, fn = c["category"], c["label"], c["icon"], c["fn"]
        try:
            alerts = await fn(db)
        except Exception as e:
            logger.exception(f"[ATTENTION] check {cat} a échoué")
            errors.append({"category": cat, "label": label,
                           "error": f"{type(e).__name__}: {e}"})
            continue
        if not c["random"]:
            alerts.sort(key=lambda a: (a.rank if a.rank is not None else 0))
        for a in alerts:
            d = a.__dict__.copy()
            d["dismissed"] = a.key in dismissed
            d["cat_label"] = label
            d["cat_icon"] = icon
            out.append(d)
    return out, errors
