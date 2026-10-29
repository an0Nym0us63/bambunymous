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

import asyncio
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


# ── Sechage ────────────────────────────────────────────────────────────────
# La regle (delai par defaut, et par famille / sous-famille) vit dans
# services/drying.py, partagee avec l'AMS et la fiche bobine.
from . import drying as _drying
dry_reference = _drying.dry_reference


def needs_drying(spool, now: Optional[datetime] = None, filament=None) -> bool:
    return _drying.needs_drying(spool, filament, now)


# ── Registre ───────────────────────────────────────────────────────────────
CHECKS: list[dict] = []


def check(category: str, label: str, icon: str = "•",
          shown: int = 3, random_sample: bool = True, hidden_default: bool = False):
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
                       "fn": fn, "shown": shown, "random": random_sample, "hidden_default": hidden_default})
        return fn
    return deco


# ── Lectures partagees (26/10/2026) ───────────────────────────────────────────
# Douze verifications portent sur les filaments ou les bobines actives ; chacune relisait sa table (26 requetes
# pour l'accueil, et la base etait l'essentiel du temps). Elles lisent desormais UNE fois les filaments et UNE fois
# les bobines actives avec leur filament, gardes le temps de l'appel (db.info), et filtrent en memoire.
async def _fils(db) -> list:
    m = db.info.get("att_fils")
    if m is None:
        m = db.info["att_fils"] = list((await db.execute(select(Filament))).scalars().all())
    return m


async def _pairs(db) -> list:
    """Les bobines actives et leur filament : [(spool, filament)]."""
    m = db.info.get("att_pairs")
    if m is None:
        m = db.info["att_pairs"] = [tuple(r) for r in (await db.execute(
            select(Spool, Filament).join(Filament, Filament.id == Spool.filament_id).where(Spool.archived.is_(False), Spool.ordered.is_(False))
        )).all()]
    return m


async def _awaited(db) -> set:
    """Les filaments qui n'existent encore que par une commande (28/10/2026) : des bobines commandees et aucune en
    stock. Rien a leur reprocher tant que la bobine n'est pas la (echantillon, prix, profil, code couleur)."""
    m = db.info.get("att_awaited")
    if m is None:
        here = {s.filament_id for s, _f in await _pairs(db)}
        m = db.info["att_awaited"] = {fid for fid in await _coming(db) if fid not in here}
    return m


async def _coming(db) -> set:
    """Les filaments dont des bobines sont commandees, pas encore recues (28/10/2026) : plus rien a racheter."""
    m = db.info.get("att_coming")
    if m is None:
        m = db.info["att_coming"] = set((await db.execute(
            select(Spool.filament_id).where(Spool.ordered.is_(True), Spool.archived.is_(False)).distinct())).scalars().all())
    return m


def _fresh(db) -> None:
    """Un nouvel assemblage relit tout (rien de garde d'un appel a l'autre)."""
    db.info.pop("att_fils", None)
    db.info.pop("att_pairs", None)
    db.info.pop("att_coming", None)
    db.info.pop("att_awaited", None)


def _bambu(f) -> bool:
    return "bambu" in (f.manufacturer or "").lower()


def _under(s, f, pct) -> bool:
    fw = f.filament_weight_g or 0
    return s.remaining_weight_g is not None and fw > 0 and s.remaining_weight_g < fw * (pct / 100.0)


# ── Verifications ──────────────────────────────────────────────────────────
@check("no_spool", "Filaments sans bobine", "📦")
async def _filaments_without_spool(db) -> list[Alert]:
    """Filament au catalogue mais plus aucune bobine active : a racheter."""
    used = {s.filament_id for s, _f in await _pairs(db)} | await _coming(db)     # une bobine en commande : elle arrive
    rows = [f for f in await _fils(db) if f.id not in used]
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


LOW_SPOOL_PCT  = 15   # "bobine a finir" : plus tolerant, le but est de liberer un
                      # emplacement -- ca peut attendre.
STOCK_LOW_PCT  = 25   # "fin de stock" (derniere bobine) : plus tot, car il faut
                      # avoir le temps de RACHETER avant la panne seche.


@check("low_spool", f"Bobines à finir (sous {LOW_SPOOL_PCT} %)", "🪫",
       shown=5, random_sample=False)
async def _spools_low(db) -> list[Alert]:
    """Bobine sous le seuil : penser a racheter, ou a lancer ce qui l'utilise."""
    rows = [(s, f) for s, f in await _pairs(db) if _under(s, f, LOW_SPOOL_PCT)]
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


@check("last_spool_low", f"Filaments en fin de stock (sous {STOCK_LOW_PCT} %)", "📉",
       shown=5, random_sample=False)
async def _last_spool_low(db) -> list[Alert]:
    """
    Meme seuil que "Bobines a finir", mais on ne signale QUE si c'est la DERNIERE
    bobine active du filament.

    Difference d'intention :
    - low_spool  : une bobine presque vide parmi d'autres -> la finir pour liberer
      un emplacement. Pas urgent a racheter.
    - ici        : la seule bobine restante passe sous le seuil -> c'est vraiment
      la fin du stock, il faut RACHETER.

    Un filament peut donc apparaitre dans les deux si sa derniere bobine est aussi
    presque vide : c'est voulu, les deux messages ne disent pas la meme chose.
    """
    # Nombre de bobines actives par filament
    counts: dict = {}
    for s, _f in await _pairs(db):
        counts[s.filament_id] = counts.get(s.filament_id, 0) + 1
    rows = [(s, f) for s, f in await _pairs(db) if _under(s, f, STOCK_LOW_PCT)]
    coming = await _coming(db)

    out = []
    for s, f in rows:
        if counts.get(f.id, 0) != 1:        # pas la derniere bobine -> ignore
            continue
        if f.id in coming:                  # une autre est commandee : le rachat est fait
            continue
        pct = round(s.remaining_weight_g / f.filament_weight_g * 100)
        out.append(Alert(
            key=f"last_spool_low:filament:{f.id}",
            category="last_spool_low",
            title=_fil_title(f),
            detail="Dernière bobine",
            value=f"{int(s.remaining_weight_g)} g · {pct} %",
            rank=pct,
            severity="warn",
            link=f"/filaments?id={f.id}",
            entity="filament", entity_id=f.id, filament_id=f.id,
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


NO_3MF_GRACE_MIN = 30


@check("no_3mf", "Impressions sans métadonnées", "🧩")
async def _prints_without_3mf(db) -> list[Alert]:
    """
    3MF jamais recupere : ni filament, ni cout, ni duree estimee. Souvent un
    redemarrage tombe pendant la fenetre de retry — /reenrich peut rattraper.
    Pas avant 30 min apres le lancement : le 3MF arrive quelques minutes apres
    le debut, une impression qui demarre n'est pas « sans metadonnees ».
    """
    cutoff = datetime.utcnow() - timedelta(days=30)
    grace = datetime.utcnow() - timedelta(minutes=NO_3MF_GRACE_MIN)
    rows = (await db.execute(
        select(Print)
        .where(
            Print.model_3mf.is_(None),
            Print.task_name.isnot(None),
            Print.print_date >= cutoff,
            Print.print_date <= grace,
        )
        .order_by(Print.print_date.desc())
        .limit(30)
    )).scalars().all()
    return [
        Alert(
            key=f"no_3mf:print:{p.id}",
            category="no_3mf",
            # le nom de fichier vaut parfois « 0 » tant que le 3MF n'est pas lu
            title=next((n for n in (p.translated_name, p.task_name, p.file_name)
                        if n and str(n).strip() not in ("", "0")), f"Impression #{p.id}"),
            detail="Relance possible depuis la fiche",
            value=p.print_date.strftime("%d/%m") if p.print_date else None,
            severity="warn",
            link=f"/prints?id={p.id}",
            entity="print", entity_id=p.id,
            image=_print_image(p),
        )
        for p in rows
    ]


@check("no_mw", "Impressions sans modèle MakerWorld", "🌐", hidden_default=True)
async def _prints_without_mw(db) -> list[Alert]:
    """Impression terminee sans identifiant de modele MakerWorld (fichier local,
    import, slicer hors MakerWorld) : ni fiche, ni plateaux, ni suivi. Masquee
    par defaut : c'est normal pour beaucoup d'impressions."""
    rows = (await db.execute(
        select(Print)
        .where(
            or_(Print.design_id.is_(None), Print.design_id == ""),
            Print.status != "IN_PROGRESS",
        )
        .order_by(Print.print_date.desc())
    )).scalars().all()
    # « Aucun, il n'est pas sur MakerWorld » (fenetre des modeles manquants) : plus a signaler
    from . import mw_relink
    off = mw_relink.ignored_keys()
    if off:
        rows = [p for p in rows if mw_relink.unit_key(p) not in off]
    return [
        Alert(
            key=f"no_mw:print:{p.id}",
            category="no_mw",
            title=next((n for n in (p.translated_name, p.task_name, p.file_name)
                        if n and str(n).strip() not in ("", "0")), f"Impression #{p.id}"),
            detail="Pas de modèle MakerWorld associé",
            value=p.print_date.strftime("%d/%m") if p.print_date else None,
            severity="info",
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
    awaited = await _awaited(db)
    rows = [f for f in await _fils(db) if not f.profile_id and f.id not in awaited]
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
    awaited = await _awaited(db)
    rows = [f for f in await _fils(db) if _bambu(f) and not f.fila_color_code and f.id not in awaited]
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


@check("spool_no_price", "Bobines sans prix", "🏷")
async def _spools_without_price(db) -> list[Alert]:
    """
    Bobine active sans prix propre (price_override NULL).

    On distingue NULL (jamais renseigne) de 0 : une bobine a 0 est un prix
    ASSUME (recue en cadeau) et ne doit PAS etre signalee. Le cout du print
    retombera de toute facon sur le prix du filament, puis sur 20 €/kg — mais
    tant que rien n'est saisi, autant le rappeler.
    """
    rows = [(s, f) for s, f in await _pairs(db) if s.price_override is None]
    return [
        Alert(
            key=f"spool_no_price:spool:{s.id}",
            category="spool_no_price",
            title=_fil_title(f),
            detail=f"Bobine #{s.id}",
            severity="info",
            link=f"/filaments?id={f.id}",
            entity="spool", entity_id=s.id, filament_id=f.id,
            **_fil_visual(f),
        )
        for s, f in rows
    ]


@check("fil_no_price", "Filaments sans prix", "🏷")
async def _filaments_without_price(db) -> list[Alert]:
    """
    Filament sans prix de reference (price NULL).

    Meme distinction : NULL seulement, pas 0. Ce prix sert de repli au cout d'un
    print quand la bobine n'a pas de prix propre ; sans lui, on tombe sur le
    defaut 20 €/kg, potentiellement faux.
    """
    awaited = await _awaited(db)
    rows = [f for f in await _fils(db) if f.price is None and f.id not in awaited]
    return [
        Alert(
            key=f"fil_no_price:filament:{f.id}",
            category="fil_no_price",
            title=_fil_title(f),
            detail=None,
            severity="info",
            link=f"/filaments?id={f.id}",
            entity="filament", entity_id=f.id, filament_id=f.id,
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
    rows = [(s, f) for s, f in await _pairs(db) if _bambu(f) and not s.tag_number]
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


@check("fil_no_swatch", "Filaments sans échantillon", "🎨")
async def _filaments_without_swatch(db) -> list[Alert]:
    """
    Filaments dont l'echantillon (nuancier) n'est pas marque. Utile pour savoir
    lesquels imprimer / referencer physiquement.
    """
    awaited = await _awaited(db)
    rows = [f for f in await _fils(db) if f.swatch is not None and not f.swatch and f.id not in awaited]
    return [
        Alert(
            key=f"fil_no_swatch:filament:{f.id}",
            category="fil_no_swatch",
            title=_fil_title(f),
            detail="",
            severity="info",
            link=f"/filaments?id={f.id}",
            entity="filament", entity_id=f.id,
            **_fil_visual(f),
        )
        for f in rows
    ]


@check("fil_swatch_no_label", "Échantillons sans étiquette", "🏷️")
async def _swatches_without_label(db) -> list[Alert]:
    """
    Echantillon imprime mais etiquette pas encore imprimee : la plaquette est
    faite, il ne lui manque que son QR pour etre retrouvee par un scan.
    """
    rows = [f for f in await _fils(db) if f.swatch and not f.label_printed]
    return [
        Alert(
            key=f"fil_swatch_no_label:filament:{f.id}",
            category="fil_swatch_no_label",
            title=_fil_title(f),
            detail="",
            severity="info",
            link=f"/filaments?id={f.id}",
            entity="filament", entity_id=f.id,
            **_fil_visual(f),
        )
        for f in rows
    ]


@check("spool_not_dried", "Bobines à sécher", "💧",
       shown=5, random_sample=False)
async def _spools_not_dried(db) -> list[Alert]:
    """
    Bobine jamais sechee, ou pas depuis plus que le delai de son filament
    (defaut ou regle de famille / sous-famille, Parametres). Par bobine : le
    sechage se fait bobine par bobine. Les jamais sechees en premier, puis la
    plus en retard sur son delai.
    """
    await _drying.load(db)
    rows = await _pairs(db)
    now = datetime.utcnow()
    out = []
    for s, f in rows:
        if not needs_drying(s, now, f):
            continue
        ref = dry_reference(s)
        days = (now - ref).days if ref else None
        limit = _drying.days_for(f)
        out.append(Alert(
            key=f"spool_not_dried:spool:{s.id}",
            category="spool_not_dried",
            title=_fil_title(f),
            detail=f"Bobine #{s.id}",
            value=f"{days // 30} mois (délai {round(limit / 30, 1):g} mois)" if ref else "jamais séchée",
            # Jamais sechees d'abord, puis la plus en retard sur son delai. Pas de
            # float("-inf") : la reponse JSON refuse les infinis (500 sur l'accueil).
            rank=-(days - limit) if ref else -1e9,
            severity="warn",
            link=f"/filaments?id={f.id}",
            entity="spool", entity_id=s.id, filament_id=f.id,
            **_fil_visual(f),
        ))
    return out


@check("to_order", "Filaments à commander", "🛒")
async def _filaments_to_order(db) -> list[Alert]:
    """Marques \"a commander\" a la main (champ to_order) ; pas ceux dont une bobine est deja commandee."""
    coming = await _coming(db)
    rows = [f for f in await _fils(db) if f.to_order and f.id not in coming]
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


@check("orders", "Commandes Bambu Lab à venir", "📬", shown=3, random_sample=False)
async def _orders_incoming(db) -> list[Alert]:
    """Les commandes lues dans les mails dont des bobines ne sont pas encore arrivees (28/10/2026)."""
    from . import mail_orders as MO
    out = []
    for o in await MO.incoming():
        if o["status"] == "cancelled" or not o["pending"]:
            continue
        when = o.get("shipped_at") or o.get("ordered_at")
        st = {"confirmed": "confirmée", "shipped": "expédiée", "delivered": "livrée"}.get(o["status"], o["status"])
        names = [f"{(i.get('fila_type') or '').strip()} {(i.get('name_fr') or i.get('title') or '').strip()}".strip()
                 for i in o["items"] if i.get("kind") == "filament" and (i.get("received") or 0) < (i.get("qty") or 0)]
        out.append(Alert(key=f"orders:order:{o['id']}", category="orders", title=f"Commande {o['order_no']} · {st}",
                         detail=", ".join(names[:4]) + (" …" if len(names) > 4 else ""),
                         value=f"{o['pending']} bobine{'s' if o['pending'] > 1 else ''}",
                         severity="info", link="/filaments", rank=0 if o["status"] == "shipped" else 1,
                         color=next((i.get("color_hex") for i in o["items"] if i.get("color_hex")), None)))
    return out


UNUSED_DAYS = 180


@check("unused", f"Filaments inutilisés depuis {UNUSED_DAYS // 30} mois", "🕸")
async def _filaments_unused(db) -> list[Alert]:
    """
    Du stock qui dort. On ne regarde que les filaments AYANT des bobines actives :
    ceux qui n'en ont plus sont deja couverts par \"Filaments sans bobine\", les
    signaler deux fois ne servirait a rien.
    """
    cutoff = datetime.utcnow() - timedelta(days=UNUSED_DAYS)
    # le dernier usage de chaque filament, sur ses bobines actives (le MAX du SQL : les vides ne comptent pas)
    lasts: dict = {}
    for s, f in await _pairs(db):
        e = lasts.setdefault(f.id, [f, None])
        if s.last_used_at is not None and (e[1] is None or s.last_used_at > e[1]):
            e[1] = s.last_used_at
    rows = [(f, last) for f, last in lasts.values() if last is None or last < cutoff]
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
    saved = [c for c in (p.get("order") or []) if c in known]
    order = saved + [c for c in known if c not in saved]      # nouvelles categories a la fin
    hidden = [c for c in (p.get("hidden") or []) if c in known]
    # une categorie « masquee par defaut » jamais reglee arrive masquee ; une fois
    # les preferences enregistrees avec elle, c'est le choix fait qui compte
    hidden += [c["category"] for c in CHECKS if c.get("hidden_default") and c["category"] not in saved
               and c["category"] not in hidden]
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


# Les alertes gardees en memoire (27/10/2026) : dans la rafale de l'accueil, leurs 8 lectures prenaient 0,5 s
# (4 ms seules). Le resultat de chaque verification est garde tant que rien n'a ete ecrit dans les tables dont
# elles dependent (compteurs de db/session.py), et 10 min au plus (les delais qui avancent seuls : sechage,
# « sans metadonnees » apres 30 min). Le tirage au hasard, lui, se refait a chaque appel.
# Les tables dont depend chaque verification (27/10/2026) : pas la table des reglages, que l'accueil ecrit a chaque
# chargement (surprise, fetes) et qui effacait tout ; une impression en cours ne relance que celles des impressions.
_PRINT_DEPS = ("prints", "filament_usage")
_STOCK_DEPS = ("bobines", "filaments")
# 10 min (28/10/2026, 60 s avant) : la tuile relit toutes les 2 min, chaque appel recalculait donc tout ; une
# ecriture dans les tables concernees invalide de toute facon, seuls les delais qui avancent seuls attendent
CACHE_S = 600
_CHECKS_CACHE: dict = {}          # fonction -> (cle, instant, resultat)


def _check_key(fn):
    import json as _j
    from ..db.session import data_version
    if fn.__name__.startswith("_prints_"):
        return data_version(*_PRINT_DEPS)
    # les delais de sechage vivent dans les reglages : leur valeur fait partie de la cle
    return data_version(*_STOCK_DEPS) + (_j.dumps(_drying.current(), sort_keys=True, default=str),)


async def _run_check(db, fn):
    """Une verification, depuis la memoire si ses tables n'ont pas change (60 s au plus)."""
    import time as _t
    key = _check_key(fn)
    hit = _CHECKS_CACHE.get(fn)
    if hit and hit[0] == key and _t.monotonic() - hit[1] <= CACHE_S:
        return hit[2]
    try:
        res = ("ok", await fn(db))
    except Exception as e:
        return ("err", e)
    _CHECKS_CACHE[fn] = (key, _t.monotonic(), res)    # la cle d'AVANT le calcul : une ecriture pendant le relancera
    return res


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
    _fresh(db)
    dismissed = await _dismissed_keys(db)
    out: list[dict] = []
    errors: list[dict] = []

    # Ordre choisi par l'utilisateur, categories masquees exclues.
    for c in await ordered_checks(db):
        cat, label, icon, fn = c["category"], c["label"], c["icon"], c["fn"]
        kind, alerts = await _run_check(db, fn)
        try:
            if kind == "err":
                raise alerts
            alerts = list(alerts)
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
    _fresh(db)
    dismissed = await _dismissed_keys(db)
    out: list[dict] = []
    errors: list[dict] = []
    # include_hidden : l'ecran complet doit montrer meme les categories masquees
    # de l'accueil, sinon elles deviendraient inaccessibles.
    for c in await ordered_checks(db, include_hidden=True):
        cat, label, icon, fn = c["category"], c["label"], c["icon"], c["fn"]
        kind, alerts = await _run_check(db, fn)
        try:
            if kind == "err":
                raise alerts
            alerts = list(alerts)
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
