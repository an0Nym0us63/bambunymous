"""
API REST — Historique des impressions.
"""
import asyncio
import os, re, shutil
import html
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, desc, func, or_, and_, update
from sqlalchemy.orm import selectinload

from .auth import get_current_user, require_admin
from ....models.print_history import Print, FilamentUsage, PrintSnapshot, PrintTag, Group
from ....models.filament import Spool, Filament
from ....db.session import AsyncSessionLocal

router  = APIRouter()
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))


# ── Schémas Pydantic ──────────────────────────────────────────────────────

class FilamentOut(BaseModel):
    id: int; print_id: int; spool_id: Optional[int]
    filament_type: str; color_hex: str; grams_used: float
    ams_slot: int; cost: float; normal_cost: float
    class Config: from_attributes = True

class SnapshotOut(BaseModel):
    id: int; trigger: str; file_path: Optional[str]; taken_at: datetime
    class Config: from_attributes = True

class PrintOut(BaseModel):
    id: int; job_id: Optional[str]; print_date: datetime
    file_name: str; original_name: Optional[str]; print_type: str
    status: str; status_note: Optional[str]
    plate_image: Optional[str]; model_3mf: Optional[str]
    estimated_seconds: Optional[float]; duration_seconds: Optional[float]
    total_weight_g: float; total_cost_filament: float
    total_cost_filament_normal: float = 0.0
    electric_cost: float; total_cost: float
    number_of_items: int; sold_units: int
    sold_price_total: Optional[float]; margin: float
    plate_id: str; design_id: Optional[str]; printer_model: str
    cover_photo: Optional[str] = None   # photo mise en avant (vignette galerie)
    group_id: Optional[int] = None
    group_name: Optional[str] = None
    filament_usage: List[FilamentOut] = []
    snapshots:      List[SnapshotOut] = []
    tags:           List[str] = []
    created_at: datetime; updated_at: datetime
    class Config: from_attributes = True


# ── Helpers ────────────────────────────────────────────────────────────────

def _usage_to_dict(u) -> dict:
    d = {col.name: getattr(u, col.name) for col in u.__table__.columns}
    # Enrichir color_hex et filament_type depuis la bobine liée si vide
    if u.spool_id and (not d.get("color_hex") or not d.get("filament_type")):
        try:
            if hasattr(u, "spool") and u.spool and u.spool.filament:
                f = u.spool.filament
                if not d.get("color_hex") and f.color:
                    d["color_hex"] = f"#{f.color}" if not str(f.color).startswith("#") else f.color
                if not d.get("filament_type") and f.material:
                    d["filament_type"] = f.material
        except Exception:
            pass
    # Attribut temporaire injecté par _enrich_filament_usage
    if hasattr(u, "_filament_name"):
        d["filament_name"]  = u._filament_name
    if hasattr(u, "_filament_brand"):
        d["filament_brand"] = u._filament_brand
    if hasattr(u, "_filament_translated"):
        d["filament_translated_name"] = u._filament_translated
    if hasattr(u, "_filament_fila_type"):
        d["filament_fila_type"] = u._filament_fila_type
    if hasattr(u, "_filament_colors_array"):
        d["filament_colors_array"] = u._filament_colors_array
    if hasattr(u, "_filament_multicolor_type"):
        d["filament_multicolor_type"] = u._filament_multicolor_type
    if getattr(u, "_filament_fila_finish", None):
        d["filament_fila_finish"] = u._filament_fila_finish
    return d


def _purged_count(rel_dir: str) -> int:
    try:
        from ....services.archive import purged_count
        return purged_count(rel_dir)
    except Exception:
        return 0


def _purged_count_model(did) -> int:
    try:
        from ....services.archive import purged_count_model
        return purged_count_model(did)
    except Exception:
        return 0


def _print_to_out(p: Print, gcache: Optional[dict] = None, snaps: Optional[dict] = None) -> dict:
    d = {col.name: getattr(p, col.name) for col in p.__table__.columns}
    d["filament_usage"] = [_usage_to_dict(u) for u in (p.filament_usage or [])]
    # snaps : les captures deja lues en lignes simples, par impression (la liste) ; sinon la relation
    d["snapshots"] = snaps.get(p.id, []) if snaps is not None else [
        {col.name: getattr(s, col.name) for col in s.__table__.columns}
        for s in (p.snapshots or [])
    ]
    d["tags"] = [t.tag for t in (p.tags or [])]
    # ce qui n'est plus que sur le NAS (vide du local par une purge) : la fiche le signale
    d["nas_only"] = _purged_count(f"prints/{p.id}") + _purged_count_model(p.design_id)
    d["group_name"] = p.group.name if p.group else None
    d["group_cover_print_id"] = p.group.cover_print_id if p.group else None
    d["group_number_of_items"] = p.group.number_of_items if p.group else 1
    d["group_stats_excluded"] = bool(p.group.stats_excluded) if p.group else False
    # des photos au niveau du groupe (choisie, ou deposees dans son dossier) : l'accueil ne relance pas
    # « pas encore de photo » pour une impression dont le groupe en a deja
    d["group_cover_photo"] = p.group.cover_photo if p.group else None
    # la vignette prise dans la vue 3D assemblee (29/10/2026), et si elle remplace celle du plateau / la mosaique
    # jusqu'a 4 vues 3D (30/10/2026) : thumb_3d = le numero de celle choisie (0 : la vignette par defaut)
    sl = _v3slots(DATA_DIR / "prints" / str(p.id))
    d["vue3d"] = [{"n": n, "v": v} for n, v in sorted(sl.items())]
    d["has_vue3d"] = bool(sl)
    d["thumb_3d"] = p.thumb_3d if _v3sel(p.thumb_3d, sl) else 0
    gsl = _v3slots(DATA_DIR / "groups" / str(p.group_id)) if p.group_id else {}
    gname, gv = _v3cover(DATA_DIR / "groups" / str(p.group_id), p.group.thumb_3d) if p.group_id and p.group and gsl else (None, None)
    d["group_has_vue3d"] = bool(gsl)
    d["group_thumb_3d"] = p.group.thumb_3d if gname else 0
    d["group_vue3d_name"] = gname
    d["group_vue3d_v"] = gv
    # les vues choisies une a une (30/10/2026) : plusieurs, la tuile les fait defiler au lieu de montrer leur mosaique
    d["vue3d_sel"] = [{"name": _v3name(n), "v": sl[n]} for n in _v3sel(p.thumb_3d, sl)] if sl else []
    d["group_vue3d_sel"] = [{"name": _v3name(n), "v": gsl[n]} for n in _v3sel(p.group.thumb_3d, gsl)] if gsl and p.group else []
    # le 3MF d'origine MakerWorld deja garde pour ce profil (le tranche, lui, est model_3mf)
    try:
        from ....services.mw_source import print_file as _src
        d["source_3mf"] = bool(_src(p.design_id, p.mw_profile_id, p.mw_plates))
    except Exception:
        d["source_3mf"] = False
    if gcache is not None and p.group_id in gcache:
        d["group_has_photos"] = gcache[p.group_id]
        return d
    gd = _group_dir(p.group_id) if p.group_id else None       # le disque seulement si le cache ne sait pas
    d["group_has_photos"] = bool(gd and any(f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v")
                                            for f in gd.iterdir()))
    if gcache is not None and p.group_id:
        gcache[p.group_id] = d["group_has_photos"]
    return d


async def _enrich_filament_usage(db, prints):
    """Enrichit color_hex/filament_type/filament_name depuis les bobines liées."""
    spool_ids = {u.spool_id for p in prints for u in (p.filament_usage or []) if u.spool_id}
    if not any(p.filament_usage for p in prints):
        return
    from sqlalchemy.orm import selectinload as _sil
    spools_r = await db.execute(
        select(Spool).where(Spool.id.in_(spool_ids))
    )
    spools = {s.id: s for s in spools_r.scalars().all()}
    # Charger les filaments
    fil_ids = {s.filament_id for s in spools.values() if s.filament_id}
    fils_r = await db.execute(select(Filament).where(Filament.id.in_(fil_ids)))
    fils = {f.id: f for f in fils_r.scalars().all()}

    # Filaments par couleur, pour les usages sans bobine (ou a bobine disparue) :
    # tout le catalogue n'est lu que s'il y en a un sur la page.
    # (28/10/2026 : tout le catalogue etait charge en objets a chaque page ; seuls les filaments de ces couleurs-la)
    fil_by_color = {}
    need = {str(u.color_hex).lstrip("#").lower() for p in prints for u in (p.filament_usage or [])
            if u.color_hex and not (u.spool_id and spools.get(u.spool_id))}
    if need:
        variants = {v for c in need for v in (c, c.upper(), f"#{c}", f"#{c.upper()}")}
        for f in (await db.execute(select(Filament).where(Filament.color.in_(variants)))).scalars().all():
            key = str(f.color).lstrip("#").lower()
            fil_by_color.setdefault(key, f)

    for p in prints:
        for u in (p.filament_usage or []):
            fil = None
            if u.spool_id:
                spool = spools.get(u.spool_id)
                if spool:
                    fil = fils.get(spool.filament_id)
            if not fil and u.color_hex:
                # Fallback: chercher par couleur
                key = str(u.color_hex).lstrip("#").lower()
                fil = fil_by_color.get(key)
            if not fil: continue
            if not u.color_hex and fil.color:
                u.color_hex = f"#{fil.color}" if not str(fil.color).startswith("#") else fil.color
            if not u.filament_type and fil.material:
                u.filament_type = fil.material
            u._filament_name  = fil.name
            u._filament_brand = fil.manufacturer
            u._filament_translated = fil.translated_name
            u._filament_fila_type  = fil.fila_type
            u._filament_colors_array    = fil.colors_array
            u._filament_multicolor_type = fil.multicolor_type
            u._filament_fila_finish = fil.fila_finish


def _search_condition(search: str):
    """
    Condition de recherche, partagee par la liste et les totaux (/kpis) : deux
    versions differentes donnaient une liste pleine et des totaux a zero.

    Le texte est decoupe en MOTS, et chaque mot doit se retrouver quelque part
    dans le print -- nom, tags, type de filament, fiche du filament, nom du
    groupe. Cherche d'un bloc, « pla rouge » ne trouvait que ce qu'un MEME
    champ contenait mot pour mot.

    Les codes couleur hexadecimaux ne sont interroges que si le mot EN EST un
    (6 chiffres hexa, # facultatif) : sinon « café », « bed » ou « 80 », faits
    de lettres a-f et de chiffres, ramenaient des prints au hasard de leur
    couleur. % et _ sont pris a la lettre, pas comme jokers SQL.
    Rend None quand il n'y a aucun mot.
    """
    import re
    from sqlalchemy import or_, and_, exists, select as _sel
    from ....models.print_history import PrintTag as _PT, FilamentUsage as _FU
    from ....models.filament import Filament as _Fil, Spool as _Sp

    mots = [m for m in (search or "").split() if m]
    if not mots:
        return None
    from ....models.print_history import MakerWorldDesign as _MW

    def esc(m):
        return m.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    # Chaque mot doit COMMENCER un mot du champ (26/10/2026) : « ara » trouve « Ara bleu », « ara-macaw »,
    # « billy_ara » ou le mot-cle "ara", mais plus « character », « caramel » ni « separate » (les mots-cles
    # MakerWorld et les noms de filaments ramenaient des groupes entiers au hasard). Le debut d'un mot : en
    # tete du champ, ou apres une espace, un tiret, un souligne, un point, une parenthese, un guillemet, une
    # virgule, une barre ou une apostrophe (les mots-cles sont gardes en liste JSON : ["ara","parrot"]).
    SEPS = [" ", "-", "\\_", ".", "(", '"', ",", "/", "'"]

    par_mot = []
    for m in mots:
        e = esc(m)
        pats = [f"{e}%"] + [f"%{sep}{e}%" for sep in SEPS]
        lk = lambda col, pats=pats: or_(*(col.ilike(p, escape="\\") for p in pats))
        hexa = re.fullmatch(r"#?([0-9a-fA-F]{6})", m)
        hx = f"%{hexa.group(1)}%" if hexa else None

        usage_cols = [lk(_FU.filament_type)]
        fil_cols = [lk(_Fil.name), lk(_Fil.translated_name), lk(_Fil.material),
                    lk(_Fil.manufacturer), lk(_Fil.fila_type), lk(_Fil.profile_id)]
        if hx:
            usage_cols.append(_FU.color_hex.ilike(hx))
            fil_cols.append(_Fil.color.ilike(hx))

        par_mot.append(or_(
            lk(Print.file_name),
            lk(Print.original_name),
            lk(Print.translated_name),
            lk(Print.task_name),
            exists().where(and_(_PT.print_id == Print.id, lk(_PT.tag))),
            exists().where(and_(_FU.print_id == Print.id, or_(*usage_cols))),
            Print.id.in_(
                _sel(_FU.print_id)
                .join(_Sp, _Sp.id == _FU.spool_id)
                .join(_Fil, _Fil.id == _Sp.filament_id)
                .where(or_(*fil_cols))
            ),
            # Fiche MakerWorld du modele : titre (et sa traduction), tags,
            # categories (en francais), createur.
            Print.design_id.in_(
                _sel(_MW.design_id).where(or_(
                    lk(_MW.title), lk(_MW.title_fr), lk(_MW.tags),
                    lk(_MW.categories), lk(_MW.creator_name)))
            ),
            # Le nom du groupe fait partie de la condition, et non plus un ajout
            # apres coup : ses prints passent ainsi par les autres filtres
            # (etat, dates, filament) et entrent dans le total.
            Print.group_id.in_(_sel(Group.id).where(lk(Group.name))),
        ))
    return and_(*par_mot)


def _apply_search(q, search: str):
    c = _search_condition(search)
    return q.where(c) if c is not None else q


# ── Routes ─────────────────────────────────────────────────────────────────

def _color_bucket_match(col, slug: str):
    """
    color_bucket est un CSV ("bleu,rose"). On matche le jeton exact pour éviter
    qu'une teinte soit trouvée comme sous-chaîne d'une autre.
    """
    return or_(
        col == slug,
        col.like(f"{slug},%"),
        col.like(f"%,{slug}"),
        col.like(f"%,{slug},%"),
    )


def _filament_filter_subq(material, fila_type, filament_id, color=None):
    """Sous-requête des print_id matchant les filtres filament (via Spool→Filament)."""
    from ....models.filament import Spool as _Spool, Filament as _FilCat
    fu_q = (select(_FU.print_id)
            .join(_Spool, _FU.spool_id == _Spool.id)
            .join(_FilCat, _Spool.filament_id == _FilCat.id))
    if filament_id: fu_q = fu_q.where(_FilCat.id == filament_id)
    if material:    fu_q = fu_q.where(_FilCat.material == material)
    if fila_type:   fu_q = fu_q.where(_FilCat.fila_type == fila_type)
    if color:       fu_q = fu_q.where(_color_bucket_match(_FilCat.color_bucket, color))
    return fu_q


# Tris disponibles pour l'historique
SORTS = ("recent", "oldest", "cost", "weight", "duration")

_PRINT_DURATION = func.coalesce(Print.duration_seconds, Print.estimated_seconds, 0)


def _group_aggregates():
    """
    Agrégats par groupe : un groupe est une entité d'affichage, il doit donc
    être trié sur SA valeur (somme des coûts / poids / durées de ses prints),
    pas sur celle d'un de ses membres.
    """
    return (select(
                Print.group_id.label("gid"),
                func.sum(func.coalesce(Print.total_cost, 0)).label("g_cost"),
                func.sum(func.coalesce(Print.total_weight_g, 0)).label("g_weight"),
                func.sum(func.coalesce(Print.duration_seconds,
                                       Print.estimated_seconds, 0)).label("g_duration"),
                func.max(Print.print_date).label("g_max_date"),
                func.min(Print.print_date).label("g_min_date"),
            )
            .where(Print.group_id.isnot(None))
            .group_by(Print.group_id)
            .subquery())


def _order_clauses(sort: str, g):
    """
    Clauses ORDER BY. La clé est celle du groupe si le print en a un, sinon la
    sienne (coalesce) : tous les prints d'un même groupe partagent donc la même
    clé et restent contigus malgré la pagination.
    """
    if sort == "oldest":
        return [func.coalesce(g.c.g_min_date, Print.print_date).asc(), Print.group_id,
                Print.print_date.asc(), Print.id]
    if sort == "cost":
        return [desc(func.coalesce(g.c.g_cost, Print.total_cost, 0)), Print.group_id,
                desc(Print.print_date), Print.id]
    if sort == "weight":
        return [desc(func.coalesce(g.c.g_weight, Print.total_weight_g, 0)), Print.group_id,
                desc(Print.print_date), Print.id]
    if sort == "duration":
        return [desc(func.coalesce(g.c.g_duration, _PRINT_DURATION, 0)), Print.group_id,
                desc(Print.print_date), Print.id]
    return [desc(func.coalesce(g.c.g_max_date, Print.print_date)), Print.group_id,
            desc(Print.print_date), Print.id]


def _period_clauses(date_from: Optional[str], date_to: Optional[str]):
    """Bornes temporelles sur print_date. Meme semantique que /stats/summary :
    date_from inclus, date_to inclus (jour entier). Accepte ISO ou YYYY-MM-DD.
    Retourne la liste des conditions SQLAlchemy (vide si aucune borne)."""
    from datetime import timedelta

    def _p(s):
        if not s:
            return None
        try:
            return datetime.fromisoformat(s)
        except Exception:
            try:
                return datetime.strptime(s, "%Y-%m-%d")
            except Exception:
                return None
    clauses = []
    d_from = _p(date_from)
    d_to = _p(date_to)
    # comparees directement a la colonne : toutes les dates sont au meme format en base (remises en forme
    # au demarrage et par declencheur, db/session.py _normalize_print_dates), donc l'index idx_prints_date
    # sert ; un datetime(print_date) autour de la colonne l'empechait (lecture de toute la table)
    if d_from:
        clauses.append(Print.print_date >= d_from)
    if d_to:
        clauses.append(Print.print_date < d_to + timedelta(days=1))
    return clauses


@router.get("")
async def list_prints(
    status:   Optional[str] = None,
    search:   Optional[str] = None,
    group_id: Optional[int] = None,
    tag:      Optional[str] = None,
    material:    Optional[str] = None,
    fila_type:   Optional[str] = None,
    filament_id: Optional[int] = None,
    color:       Optional[str] = None,
    date_from: Optional[str] = None,  # borne debut (ISO / YYYY-MM-DD)
    date_to:   Optional[str] = None,  # borne fin incluse
    sort:     str = "recent",
    limit:    int = Query(40, le=200),
    offset:   int = 0,
    _: str = Depends(get_current_user),
):
    """
    Retourne les prints pagines PAR CARTES : `limit` cartes affichees (un print
    seul ou un groupe entier). Un groupe arrive en une fois, avec tous ses
    prints, et une seule fois : ses membres se suivent dans le tri, la page
    suivante repart apres eux (`next_offset`, en prints du tri).

    Avant (22/10/2026) : `limit` prints. Un groupe de 70 prints remplissait une
    page entiere pour une seule carte -- l'appli enchainait les requetes pour
    remplir l'ecran -- et revenait en entier dans chaque page qui le touchait.
    """
    from sqlalchemy import exists
    from ....models.print_history import PrintTag as _PT

    async with AsyncSessionLocal() as db:
        if sort not in SORTS:
            sort = "recent"
        g = _group_aggregates()
        q = (select(Print)
             .outerjoin(g, Print.group_id == g.c.gid)
             .order_by(*_order_clauses(sort, g)))
        if status:
            q = q.where(Print.status == status)
        if search:
            q = _apply_search(q, search)
        if group_id is not None:
            q = q.where(Print.group_id == group_id)
        # Filtres filament via FilamentUsage→Spool→Filament
        if material or fila_type or filament_id or color:
            q = q.where(Print.id.in_(_filament_filter_subq(material, fila_type, filament_id, color)))
        if tag:
            q = q.where(exists().where(
                (_PT.print_id == Print.id) & (_PT.tag == tag)
            ))
        for c in _period_clauses(date_from, date_to):
            q = q.where(c)

        # le total (affiche en tete) seulement pour la premiere page : chaque lot du defilement le recomptait sur
        # toute la table filtree (28/10/2026) ; la suite sait d'elle-meme s'il reste des cartes
        total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() if offset == 0 else None

        # 1. Parcours leger (identifiants seuls) jusqu'a `limit` cartes
        idq = q.with_only_columns(Print.id, Print.group_id, maintain_column_froms=True)
        order, groups, cards, pos = [], [], 0, offset
        chunk = max(200, limit * 10)
        done = False
        while not done:
            part = (await db.execute(idq.offset(pos).limit(chunk))).all()
            if not part:
                break
            for pid, gid in part:
                new_card = gid is None or gid not in groups
                if new_card and cards >= limit:
                    done = True
                    break
                pos += 1
                order.append(pid)
                if new_card:
                    cards += 1
                    if gid is not None:
                        groups.append(gid)
            if len(part) < chunk:
                break

        # 2. Les prints de la page, en entier ; chaque groupe complet (meme ses
        #    membres que les filtres ecartent), apres ceux qu'a donnes le tri
        # les captures a part, en lignes simples (27/10/2026 : en objets complets, ~4 par impression, c'etait le
        # gros du calcul de la page)
        full = select(Print).options(selectinload(Print.filament_usage), selectinload(Print.tags), selectinload(Print.group))
        cond = Print.id.in_(order) if order else None
        if groups:
            cond = Print.group_id.in_(groups) if cond is None else (cond | Print.group_id.in_(groups))
        rows = []
        if cond is not None:
            got = {p.id: p for p in (await db.execute(full.where(cond))).scalars().all()}
            rank = {pid: i for i, pid in enumerate(order)}
            rows = sorted(got.values(), key=lambda p: (rank.get(p.id, len(order)),
                                                       -(p.print_date.timestamp() if p.print_date else 0)))

        await _enrich_filament_usage(db, rows)

        from ....models.print_history import PrintSnapshot as _Snap
        snaps: dict = {}
        ids = [p.id for p in rows]
        for i in range(0, len(ids), 500):
            for r in (await db.execute(select(_Snap.__table__).where(_Snap.print_id.in_(ids[i:i + 500]))
                                       .order_by(_Snap.print_id, _Snap.id))).all():
                snaps.setdefault(r.print_id, []).append(dict(r._mapping))

    from ....core.fastjson import json_response
    return json_response({"total": total, "has_more": done, "next_offset": pos,
                          "prints": [_print_to_out(p, gc, snaps) for gc in ({},) for p in rows]})


# La galerie est gardee en memoire (28/10/2026) : chaque ouverture de l'onglet la recalculait entierement.
# Invalidee par une ecriture dans les impressions, leurs captures ou les groupes (compteurs de la base), et par
# les photos de dossier (hors base) via gallery_touched(), appele par les routes qui les ajoutent ou les retirent.
_GALLERY = {"disk": 0, "key": None, "out": None}


def gallery_touched() -> None:
    _GALLERY["disk"] += 1
    _GALLERY["key"] = None


@router.get("/gallery")
async def prints_gallery(kind: str = "photos", _: str = Depends(get_current_user)):
    """kind : « photos » (les vraies photos), ou « vue3d » (les vues prises dans la vue 3D, 30/10/2026)."""
    from ....core.fastjson import json_response
    from ....db.session import data_version
    kind = "vue3d" if kind == "vue3d" else "photos"
    key = (data_version("prints", "print_snapshots", "groups"), _GALLERY["disk"], kind)
    cached = _GALLERY.setdefault("by", {}).get(kind)
    if cached and cached[0] == key:
        return json_response(cached[1])
    out = await _build_gallery(kind)
    _GALLERY["by"][kind] = (key, out)
    return json_response(out)


def _mw_profile(pid, plates):
    from ....services.mw_source import _profile
    try:
        return _profile(pid, plates)
    except Exception:
        return None


async def _build_gallery(kind: str = "photos") -> dict:
    """
    Galerie photo — INDÉPENDANTE de la pagination de /prints (parcourt tout
    l'historique, pas seulement la page courante). Ne retourne que les prints
    et groupes ayant de vraies photos (snapshots trigger='manual'), avec le
    carrousel complet de photos pour chacun. Les photos du dossier groupe
    lui-même (/data/groups/{id}/, uploads directs) sont aussi incluses.
    """
    # Les seules colonnes utiles, et les seules photos manuelles (27/10/2026) : avant, toutes les impressions et
    # toutes leurs captures arrivaient en objets complets (~9 000 pour 1 900 impressions, 0,3 s de calcul).
    from types import SimpleNamespace as _NS
    from ....models.print_history import PrintSnapshot as _Snap
    cols = (Print.id, Print.group_id, Print.file_name, Print.status, Print.print_date, Print.duration_seconds,
            Print.estimated_seconds, Print.total_weight_g, Print.total_cost_filament, Print.electric_cost,
            Print.total_cost, Print.number_of_items, Print.cover_photo, Print.design_id, Print.thumb_3d,
            Print.mw_profile_id, Print.mw_plates)
    async with AsyncSessionLocal() as db:
        rows = [_NS(**r._mapping) for r in (await db.execute(select(*cols))).all()]
        snaps: dict = {}
        for pid, fp, sid in (await db.execute(select(_Snap.print_id, _Snap.file_path, _Snap.id).where(_Snap.trigger == "manual")
                                              .order_by(_Snap.print_id, _Snap.id))).all():
            snaps.setdefault(pid, []).append((fp, sid))
        grp = {r.id: r for r in (await db.execute(select(Group.id, Group.name, Group.number_of_items, Group.cover_print_id,
                                                         Group.cover_photo, Group.thumb_3d))).all()}

    # les impressions qui ont une vignette 3D (lu d'un coup, hors de la boucle des reponses)
    def _vue3d_prints():
        out = {}
        base = DATA_DIR / "prints"
        for r in rows:
            sl = _v3slots(base / str(r.id))
            if sl:
                nm, v = _v3cover(base / str(r.id), r.thumb_3d)
                out[r.id] = (nm, v) if nm else (_v3name(min(sl)), sl[min(sl)])
        return out
    import asyncio as _aio0
    vue3d_prints = await _aio0.to_thread(_vue3d_prints)

    # la galerie des vues 3D : toutes les vues de chaque impression (celles de la vignette d'abord)
    def _vue3d_all():
        out = {}
        base = DATA_DIR / "prints"
        for r in rows:
            sl = _v3slots(base / str(r.id))
            if sl:
                sel = _v3sel(r.thumb_3d, sl)
                out[r.id] = [(_v3name(n), sl[n], n in sel) for n in sorted(sl, key=lambda n: (n not in sel, n))]
        return out
    vue3d_all = await _aio0.to_thread(_vue3d_all) if kind == "vue3d" else {}
    items, group_acc = [], {}
    for p in rows:
        p.group = grp.get(p.group_id) if p.group_id else None
        # ?v= : une version dans l'adresse (28/10/2026), le navigateur garde la vignette sans la redemander
        photos = [
            {"url": f"/api/v1/prints/{p.id}/file/{(fp or '').split('/')[-1]}?v={sid}",
             "name": (fp or "").split("/")[-1], "label": "manual"}
            for fp, sid in snaps.get(p.id, ()) if fp
        ]
        if kind == "vue3d":
            # sel : retenue comme vignette (30/10/2026 : la tuile ne fait defiler que celles-la)
            photos = [{"url": f"/api/v1/prints/{p.id}/file/{nm}?v={v}", "name": nm, "label": "vue3d", "sel": se} for nm, v, se in vue3d_all.get(p.id, ())]
        # pas de photo, mais une vignette prise dans la vue 3D assemblee : elle remonte (29/10/2026)
        elif not photos and p.id in vue3d_prints:
            nm, v = vue3d_prints[p.id]
            photos = [{"url": f"/api/v1/prints/{p.id}/file/{nm}?v={v}", "name": nm, "label": "vue3d"}]
        # La vignette de la galerie est photos[0] : on remonte la photo choisie.
        if p.cover_photo and kind != "vue3d":
            photos.sort(key=lambda ph: ph["name"] != p.cover_photo)
        if p.group_id:
            acc = group_acc.setdefault(p.group_id, {
                "id": p.group_id,
                "name": (p.group.name if p.group else None) or f"Groupe #{p.group_id}",
                "number_of_items": (p.group.number_of_items if p.group else None) or 1,
                "cover_print_id":  p.group.cover_print_id if p.group else None,
                "cover_photo":     p.group.cover_photo if p.group else None,
                "prints": 0, "photos": [], "_designs": set(), "_dcount": {}, "print_ids": [],
                "total_weight_g": 0.0, "total_cost_filament": 0.0,
                "electric_cost": 0.0, "total_cost": 0.0, "duration_seconds": 0.0,
                "latest_date": None,
            })
            acc["prints"]              += 1
            acc["print_ids"].append(p.id)
            acc["photos"].extend(photos)
            if p.design_id:
                acc["_designs"].add(str(p.design_id))
                acc["_dcount"][str(p.design_id)] = acc["_dcount"].get(str(p.design_id), 0) + 1
            acc["total_weight_g"]      += p.total_weight_g or 0
            acc["total_cost_filament"] += p.total_cost_filament or 0
            acc["electric_cost"]       += p.electric_cost or 0
            acc["total_cost"]          += p.total_cost or 0
            acc["duration_seconds"]    += p.duration_seconds or p.estimated_seconds or 0
            if not acc["latest_date"] or (p.print_date and p.print_date > acc["latest_date"]):
                acc["latest_date"] = p.print_date
        elif photos:
            nb = p.number_of_items or 1
            tc = p.total_cost or 0
            items.append({
                "id": p.id, "title": p.file_name or "Sans nom", "status": p.status,
                "print_date": p.print_date, "duration_seconds": p.duration_seconds,
                "total_weight_g": p.total_weight_g, "total_cost_filament": p.total_cost_filament or 0,
                "electric_cost": p.electric_cost or 0, "total_cost": tc,
                "number_of_items": nb,
                "cost_per_item": round(tc / nb, 2) if nb > 1 else None,
                "photos": photos,
                "design_id": str(p.design_id) if p.design_id else None,
                # le profil connu de l'impression (imprimante, ou choisi a la main) : la vue 3D de la galerie s'ouvre dessus
                "mw_profile_id": _mw_profile(p.mw_profile_id, p.mw_plates) or None,
            })

    # Photos uploadées directement dans le dossier du groupe (pas via un print précis) : le disque est lu
    # dans un fil a part (une lecture de dossier par groupe), le serveur continue de repondre
    groups_dir = DATA_DIR / "groups"
    def _scan(gids):
        out = {}
        for gid in gids:
            d = groups_dir / str(gid)
            if d.exists():
                out[gid] = [(f.name, int(f.stat().st_mtime)) for f in sorted(d.iterdir())
                            if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v")]
        return out
    import asyncio as _aio
    on_disk = await _aio.to_thread(_scan, list(group_acc))
    for gid, acc in group_acc.items():
        files = on_disk.get(gid, ())
        if kind == "vue3d":
            # les vues du groupe lui-meme d'abord, puis celles de ses impressions
            gsel = set(_v3sel(getattr(grp.get(gid), "thumb_3d", 0) or 0, {n: 1 for n in range(1, V3_MAX + 1)}))
            v3n = lambda nm: 1 if nm == VUE3D else int(nm.split("_")[1].split(".")[0])
            own = [{"url": f"/api/v1/prints/groups/{gid}/photo/{name}?v={mt}", "label": "vue3d", "name": name, "sel": v3n(name) in gsel}
                   for name, mt in sorted(files) if _V3RE.fullmatch(name) and "_mix" not in name]
            own.sort(key=lambda ph: not ph["sel"])
            acc["photos"] = own + acc["photos"]
            continue
        for name, mt in files:
            if _V3RE.fullmatch(name):
                continue
            acc["photos"].append({"url": f"/api/v1/prints/groups/{gid}/photo/{name}?v={mt}",
                                  "label": name, "name": name})
        # pas de photo, mais une vignette prise dans la vue 3D assemblee : elle remonte (29/10/2026)
        v3s = sorted((name, mt) for name, mt in files if _V3RE.fullmatch(name) and "_mix" not in name)
        if not acc["photos"] and v3s:
            nm, v3 = v3s[0]
            acc["photos"].append({"url": f"/api/v1/prints/groups/{gid}/photo/{nm}?v={v3}", "label": "vue3d", "name": nm})
        # La vignette est photos[0]. Si une photo de couverture est definie pour
        # le groupe, on la remonte en tete -- meme principe que Print.cover_photo.
        cover = acc.get("cover_photo")
        if cover:
            acc["photos"].sort(key=lambda ph: (ph.get("name") or ph.get("label")) != cover)

    groups = [
        # cover_photo est CONSERVE dans la reponse : la mosaique s'en sert pour
        # donner la place dominante a la photo choisie. Il etait filtre quand il
        # ne servait qu'au tri interne.
        {**{k: v for k, v in g.items() if k not in ("_designs", "_dcount")},
         "design_id": next(iter(g["_designs"])) if len(g["_designs"]) == 1 else None,
         # la vue 3D d'un groupe de plusieurs modeles (30/10/2026) : celui qu'il a le plus imprime
         "design_3d": max(g["_dcount"], key=g["_dcount"].get) if g["_dcount"] else None,
         "cost_per_item": round(g["total_cost"] / g["number_of_items"], 2) if g.get("number_of_items", 1) > 1 else None}
        for g in group_acc.values() if g["photos"]
    ]
    items.sort(key=lambda it: it["print_date"] or "", reverse=True)
    groups.sort(key=lambda g: g["latest_date"] or "", reverse=True)
    return {"prints": items, "groups": groups}


@router.get("/groups")
async def list_groups(_: str = Depends(get_current_user)):
    """Retourne les groupes (id BambuNymous + nom + nb de prints + date), pour distinguer
    deux groupes portant le même nom (créés à des dates différentes)."""
    # Deux lectures legeres (27/10/2026) : avant, chaque groupe chargeait ses impressions en objets complets
    # (les 1 900) pour les compter et trouver la plus recente.
    async with AsyncSessionLocal() as db:
        gs = (await db.execute(select(Group.id, Group.name, Group.created_at).order_by(Group.name))).all()
        per: dict = {}
        for gid, pd in (await db.execute(select(Print.group_id, Print.print_date).where(Print.group_id.isnot(None)))).all():
            e = per.setdefault(gid, [0, []])
            e[0] += 1
            if pd:
                e[1].append(pd)
    groups = []
    for gid, name, created in gs:
        n, dates = per.get(gid, (0, []))
        groups.append({
            "id": gid, "name": name,
            "print_count": n,
            "created_at": created,
            "latest_date": max(dates) if dates else created,
        })
    groups.sort(key=lambda g: g["latest_date"] or "", reverse=True)
    from ....core.fastjson import json_response
    return json_response({"groups": groups})


@router.get("/groups/{group_id}")
async def get_group(group_id: int, _: str = Depends(get_current_user)):
    """Un groupe seul, au format de la liste (28/10/2026 : la fiche d'un objet chargeait tous les groupes pour
    en retrouver un)."""
    async with AsyncSessionLocal() as db:
        g = (await db.execute(select(Group.id, Group.name, Group.created_at).where(Group.id == group_id))).first()
        if not g:
            raise HTTPException(404, "Groupe introuvable")
        n, latest = (await db.execute(select(func.count(Print.id), func.max(Print.print_date))
                                      .where(Print.group_id == group_id))).one()
    from ....core.fastjson import json_response
    return json_response({"id": g.id, "name": g.name, "print_count": int(n or 0), "created_at": g.created_at,
                          "latest_date": latest or g.created_at})


def _group_dir(group_id: int) -> Optional[Path]:
    """Dossier photos d'un groupe — rangé sous son id BambuNymous à l'import (cf. zip_importer.py)."""
    d = DATA_DIR / "groups" / str(group_id)
    return d if d.exists() else None


@router.get("/groups/{group_id}/nas")
async def group_nas(group_id: int, _: str = Depends(get_current_user)):
    """Ce qui, pour les impressions d'un groupe, n'est plus que sur le NAS : par impression, avec le libelle de
    chaque fichier et si le NAS repond."""
    from ....services.archive import nas_only, nas_only_model
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.id, Print.translated_name, Print.file_name, Print.print_date, Print.design_id)
                                 .where(Print.group_id == group_id).order_by(Print.print_date))).all()
    out, models, total, present = [], [], 0, 0
    seen = set()
    for pid, tr, fn, pd, did in rows:
        files = nas_only(f"prints/{pid}")
        if files:
            out.append({"id": pid, "name": tr or fn or f"Impression {pid}", "print_date": pd.isoformat() if pd else None, "files": files})
            total += len(files)
            present += sum(1 for f in files if f["present"])
        if did and str(did) not in seen:                   # les fichiers du modele, une fois par modele du groupe
            seen.add(str(did))
            mf = nas_only_model(did)
            if mf:
                models.append({"design_id": str(did), "files": mf})
                total += len(mf)
                present += sum(1 for f in mf if f["present"])
    return {"prints": out, "models": models, "total": total, "reachable": present > 0 if total else None}


@router.get("/groups/{group_id}/photos")
async def group_photos(group_id: int):
    """Liste les photos d'un groupe, et le nom de celle choisie comme vignette."""
    async with AsyncSessionLocal() as db:
        g = await db.get(Group, group_id)
        cover = g.cover_photo if g else None
    d = _group_dir(group_id)
    if not d:
        return {"files": [], "cover_photo": cover}
    files = []
    for f in sorted(d.iterdir()):
        if not _V3RE.fullmatch(f.name) and f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v"):
            files.append({"name": f.name, "url": f"/api/v1/prints/groups/{group_id}/photo/{f.name}"})
    return {"files": files, "cover_photo": cover}


@router.get("/groups/{group_id}/tech")
async def group_tech(group_id: int):
    """L'onglet Technique d'une fiche de groupe, en une requete : pour chacune de ses impressions (de la
    plus ancienne a la plus recente), son timelapse et ses captures des couches, en local ou sur le NAS."""
    from ....services.archive import archived_names
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.id, Print.translated_name, Print.file_name, Print.print_date)
                                 .where(Print.group_id == group_id).order_by(Print.print_date))).all()
    out = []
    for pid, tr, fn, pd in rows:
        d = DATA_DIR / "prints" / str(pid)
        names = set(f.name for f in d.iterdir()) if d.exists() else set()
        names |= set(archived_names(f"prints/{pid}"))
        snaps = sorted(n for n in names if n.startswith("snapshot-")
                       and os.path.splitext(n)[1].lower() in (".png", ".jpg", ".jpeg", ".webp"))
        tl = "Video-Timelapse.mp4" in names
        if tl or snaps:
            out.append({"id": pid, "name": tr or fn or f"Impression {pid}", "print_date": pd.isoformat() if pd else None,
                        "timelapse": f"/api/v1/prints/{pid}/file/Video-Timelapse.mp4" if tl else None,
                        "plate": next((f"/api/v1/prints/{pid}/file/{n}" for n in ("plate.png", "plate.jpg") if n in names), None),
                        "snaps": [{"name": n, "url": f"/api/v1/prints/{pid}/file/{n}"} for n in snaps]})
    return {"prints": out}


@router.get("/groups/{group_id}/photo/{filename}")
async def group_photo(group_id: int, filename: str):
    """Sert une photo de groupe (pas d'auth — utilisée dans des balises <img>)."""
    import mimetypes
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    d = _group_dir(group_id)
    if not d:
        raise HTTPException(404)
    path = d / filename
    if not path.exists():
        raise HTTPException(404)
    mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
    return FileResponse(str(path), media_type=mime)


@router.delete("/groups/{group_id}")
async def ungroup(group_id: int, _: str = Depends(get_current_user)):
    """
    Degroupe : les prints sont detaches, le groupe disparait.

    Le front appelait cette route depuis toujours, mais elle n'existait pas.
    Seule la variante PATCH etait declaree sur ce chemin, d'ou un 405 Method
    Not Allowed plutot qu'un 404 -- le chemin correspondait, pas la methode.

    Les prints sont DETACHES et non supprimes : degrouper n'est pas detruire,
    c'est defaire un regroupement. Le detachement est explicite plutot que
    laisse au ON DELETE SET NULL de la cle etrangere, pour que l'intention
    soit lisible ici et non dans le schema.

    Les photos propres au groupe sont retirees avec lui : elles decrivaient
    l'ensemble, elles n'ont plus d'objet une fois celui-ci defait.
    """
    async with AsyncSessionLocal() as db:
        g = await db.get(Group, group_id)
        if not g:
            raise HTTPException(404, "Groupe introuvable")
        n = (await db.execute(
            select(func.count()).select_from(Print).where(Print.group_id == group_id)
        )).scalar() or 0
        await db.execute(
            update(Print).where(Print.group_id == group_id).values(group_id=None)
        )
        await db.delete(g)
        await db.commit()

    d = DATA_DIR / "groups" / str(group_id)
    if d.exists():
        try:
            shutil.rmtree(d)
        except OSError as e:
            # Un dossier residuel ne doit pas faire echouer le degroupage :
            # la base fait foi, le disque se nettoie a la main si besoin.
            print(f"[GROUP] photos du groupe {group_id} non supprimees : {e}")

    return {"ok": True, "detached": n}


@router.post("/groups/{group_id}/merge")
async def merge_group(group_id: int, body: dict = Body({}), _: str = Depends(get_current_user)):
    """
    Fusionne des groupes DANS `group_id` : leurs prints, photos et objets
    passent au groupe garde, puis ils disparaissent.
    body: {"source_ids": [12, 13], "number_of_items": 4}

    Le groupe garde conserve son nom et ses vignettes ; il ne reprend celles
    d'une source que s'il n'en avait pas. `number_of_items` est le nombre
    d'objets du groupe fusionne : l'ecran propose la somme de ceux des groupes,
    a valider ou corriger. Absent, le groupe garde conserve le sien.
    """
    source_ids = [int(s) for s in (body.get("source_ids") or [])]
    if not source_ids:
        raise HTTPException(400, "source_ids requis")
    if group_id in source_ids:
        raise HTTPException(400, "Un groupe ne peut pas fusionner avec lui-meme")
    nb = body.get("number_of_items")
    if nb is not None:
        try:
            nb = int(nb)
        except (TypeError, ValueError):
            raise HTTPException(400, "number_of_items invalide")
        if nb < 1:
            raise HTTPException(400, "number_of_items doit valoir au moins 1")
    from ....models.object_history import Object

    async with AsyncSessionLocal() as db:
        keep = await db.get(Group, group_id)
        sources = [await db.get(Group, s) for s in dict.fromkeys(source_ids)]
        if not keep or not all(sources):
            raise HTTPException(404, "Groupe introuvable")

        dst_dir = DATA_DIR / "groups" / str(group_id)
        moved = photos = objs = 0
        for src in sources:
            # Photos d'abord, sur le disque : un nom deja pris chez le groupe
            # garde est renumerote (Photo-01 existe des deux cotes, souvent).
            src_dir = DATA_DIR / "groups" / str(src.id)
            renamed = {}
            if src_dir.exists():
                dst_dir.mkdir(parents=True, exist_ok=True)
                for f in sorted(src_dir.iterdir()):
                    if not f.is_file():
                        continue
                    dest = dst_dir / f.name
                    if dest.exists():
                        prefix = "Video" if f.name.startswith("Video") else "Photo"
                        n = 1
                        while (dst_dir / f"{prefix}-{n:02d}{f.suffix}").exists():
                            n += 1
                        dest = dst_dir / f"{prefix}-{n:02d}{f.suffix}"
                    shutil.move(str(f), str(dest))
                    renamed[f.name] = dest.name
            photos += len(renamed)

            moved += (await db.execute(
                select(func.count()).select_from(Print).where(Print.group_id == src.id)
            )).scalar() or 0
            await db.execute(update(Print).where(Print.group_id == src.id).values(group_id=group_id))
            objs += (await db.execute(
                update(Object).where(Object.parent_type == "group", Object.parent_id == src.id)
                .values(parent_id=group_id)
            )).rowcount or 0

            if not keep.cover_photo and src.cover_photo:
                keep.cover_photo = renamed.get(src.cover_photo)
            if not keep.cover_print_id and src.cover_print_id:
                keep.cover_print_id = src.cover_print_id
            await db.delete(src)

        if nb is not None:
            keep.number_of_items = nb
        await db.flush()
        # Membres et nombre d'objets ont change : cout par objet a refaire,
        # objets des sources compris (ils sont rattaches au groupe garde).
        await _propagate_object_costs(db, "group", group_id)
        await db.commit()

    for s in source_ids:
        d = DATA_DIR / "groups" / str(s)
        if d.exists():
            try:
                shutil.rmtree(d)
            except OSError as e:
                print(f"[GROUP] dossier du groupe fusionne {s} non supprime : {e}")

    return {"ok": True, "group_id": group_id, "prints": moved,
            "photos": photos, "objects": objs}


@router.patch("/groups/{group_id}")
async def patch_group(group_id: int, body: dict = Body({}), _: str = Depends(get_current_user)):
    """Met à jour les champs éditables d'un groupe (name, number_of_items)."""
    allowed = {"name", "number_of_items", "cover_print_id", "stats_excluded"}
    updates = {k: (1 if v else 0) if k == "stats_excluded" else v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "Aucun champ valide")
    async with AsyncSessionLocal() as db:
        g = await db.get(Group, group_id)
        if not g:
            raise HTTPException(404, "Groupe introuvable")
        for k, v in updates.items():
            setattr(g, k, v)
        if "number_of_items" in updates:
            await _propagate_object_costs(db, "group", group_id)
        await db.commit()
    return {"ok": True}




def _clean_name(fn: Optional[str]) -> str:
    """Retire proprement l'extension. rstrip() retirerait des caractères :
    "shelf.3mf".rstrip(".3mf") == "shel"."""
    n = html.unescape((fn or "?").strip())   # &apos; -> ', &amp; -> & ...
    for ext in (".gcode.3mf", ".3mf", ".gcode", ".stl"):
        if n.lower().endswith(ext):
            return n[: -len(ext)]
    return n


# Le resume des statistiques (une vingtaine de requetes et des boucles sur toutes les impressions) est garde par
# periode tant que rien n'a ete ecrit dans les tables qu'il lit, 10 min au plus (28/10/2026)
_SUMMARY_CACHE: dict = {}


@router.get("/stats/summary")
async def prints_stats(
    days: int = 0,   # retro-compat : fenetre glissante en jours (0 = tout)
    date_from: Optional[str] = None,   # borne debut (ISO / YYYY-MM-DD), prioritaire sur days
    date_to: Optional[str] = None,     # borne fin incluse
    _: str = Depends(get_current_user),
):
    import time as _t
    from ....db.session import data_version
    key = (data_version("prints", "filament_usage", "groups", "bobines", "filaments"), days, date_from or "", date_to or "")
    hit = _SUMMARY_CACHE.get(key)
    if hit and _t.monotonic() - hit[0] < 600:
        return hit[1]
    out = await _prints_stats_calc(days, date_from, date_to)
    if len(_SUMMARY_CACHE) >= 8:
        _SUMMARY_CACHE.clear()
    _SUMMARY_CACHE[key] = (_t.monotonic(), out)
    return out


async def _prints_stats_calc(days: int, date_from: Optional[str], date_to: Optional[str]) -> dict:
    from ....models.filament import Spool as _Spool, Filament as _Fil
    from datetime import timedelta
    from sqlalchemy import case as _case
    from statistics import median as _median

    def _parse_d(s):
        if not s:
            return None
        try:
            return datetime.fromisoformat(s)
        except Exception:
            try:
                return datetime.strptime(s, "%Y-%m-%d")
            except Exception:
                return None
    d_from = _parse_d(date_from)
    d_to = _parse_d(date_to)
    if d_to:
        d_to = d_to + timedelta(days=1)   # borne de fin incluse (jour entier)

    async with AsyncSessionLocal() as db:
        DUR = func.coalesce(Print.duration_seconds, Print.estimated_seconds, 0)
        # Base des stats = tous les resultats REELS d'impression (on exclut les
        # en-cours et les annules). Le taux de reussite et le donut partagent donc
        # la meme base -> ils concordent.
        done = Print.status.in_(["SUCCESS", "FAILED", "PARTIAL", "TO_REDO"])
        done_all = done
        ok   = Print.status == "SUCCESS"
        ko   = Print.status == "FAILED"

        period = []
        if d_from or d_to:
            # directement sur la colonne (format unique en base) : l'index sert
            if d_from:
                period.append(Print.print_date >= d_from)
            if d_to:
                period.append(Print.print_date < d_to)
        elif days and days > 0:
            period.append(Print.print_date >= datetime.utcnow() - timedelta(days=days))

        def W(*extra):
            return [done, *period, *extra]

        # Hors classements (25/10/2026) : une impression marquee, ou toutes celles d'un groupe marque
        # (echantillons, supports de bobine regroupes…), ne figure plus dans les tops ; elle reste
        # comptee dans les totaux (le filament a bien ete consomme).
        _ex_groups = select(Group.id).where(func.coalesce(Group.stats_excluded, 0) == 1)
        RANKED = and_(func.coalesce(Print.stats_excluded, 0) == 0,
                      or_(Print.group_id.is_(None), Print.group_id.not_in(_ex_groups)))

        # ── KPIs (le filament d'un print raté est consommé : on le compte)
        total   = (await db.execute(select(func.count(Print.id)).where(*W()))).scalar() or 0
        success = (await db.execute(select(func.count(Print.id)).where(*W(ok)))).scalar() or 0
        failed  = (await db.execute(select(func.count(Print.id)).where(*W(ko)))).scalar() or 0

        weight  = (await db.execute(select(func.sum(func.coalesce(Print.total_weight_g, 0))).where(*W()))).scalar() or 0
        cost    = (await db.execute(select(func.sum(func.coalesce(Print.total_cost, 0))).where(*W()))).scalar() or 0
        dur     = (await db.execute(select(func.sum(DUR)).where(*W()))).scalar() or 0

        # Part gâchée par les échecs
        w_fail  = (await db.execute(select(func.sum(func.coalesce(Print.total_weight_g, 0))).where(*W(ko)))).scalar() or 0
        c_fail  = (await db.execute(select(func.sum(func.coalesce(Print.total_cost, 0))).where(*W(ko)))).scalar() or 0
        d_fail  = (await db.execute(select(func.sum(DUR)).where(*W(ko)))).scalar() or 0

        # Répartition par statut : pas seulement succès/échec, mais aussi partiel,
        # à refaire et annulé (sinon ces prints n'apparaissaient nulle part).
        _st_rows = (await db.execute(
            select(Print.status, func.count(Print.id)).where(*period).group_by(Print.status)
        )).all()
        _sc = {(s or ""): n for s, n in _st_rows}
        status_split = [x for x in [
            {"name": "Réussies",  "value": _sc.get("SUCCESS", 0)},
            {"name": "Partiel",   "value": _sc.get("PARTIAL", 0)},
            {"name": "À refaire", "value": _sc.get("TO_REDO", 0)},
            {"name": "Échecs",    "value": _sc.get("FAILED", 0)},
        ] if x["value"] > 0]

        # ── Tops prints
        top_dur = (await db.execute(
            select(Print.id, Print.file_name, Print.original_name, Print.translated_name,
                   DUR.label("dur_s"), Print.total_cost, Print.total_weight_g, Print.print_date)
            .where(*W(ok), RANKED).order_by(DUR.desc()).limit(10)
        )).all()
        top_cost = (await db.execute(
            select(Print.id, Print.file_name, Print.original_name, Print.translated_name,
                   DUR.label("dur_s"), Print.total_cost, Print.total_weight_g, Print.print_date)
            .where(*W(ok), RANKED, Print.total_cost > 0)
            .order_by(desc(Print.total_cost)).limit(10)
        )).all()
        top_weight = (await db.execute(
            select(Print.id, Print.file_name, Print.original_name, Print.translated_name,
                   DUR.label("dur_s"), Print.total_cost, Print.total_weight_g, Print.print_date)
            .where(*W(ok), RANKED, Print.total_weight_g > 0)
            .order_by(desc(Print.total_weight_g)).limit(10)
        )).all()

        # ── Le plus de couleurs : teintes distinctes reellement utilisees (grammes > 0),
        # alpha et « # » ignores (FFFFFFFF = #ffffff).
        COL = func.lower(func.substr(func.replace(FilamentUsage.color_hex, "#", ""), 1, 6))
        NCOL = func.count(func.distinct(COL))
        _used = (FilamentUsage.grams_used > 0, func.coalesce(FilamentUsage.color_hex, "") != "")
        top_colors = (await db.execute(
            select(Print.id, Print.file_name, Print.original_name, Print.translated_name,
                   DUR.label("dur_s"), Print.total_cost, Print.total_weight_g, Print.print_date,
                   NCOL.label("n_colors"))
            .join(FilamentUsage, FilamentUsage.print_id == Print.id)
            .where(*W(ok), RANKED, *_used)
            .group_by(Print.id).having(NCOL > 1)
            .order_by(desc(NCOL), desc(Print.total_weight_g)).limit(10)
        )).all()
        top_g_colors = [{"id": r.id, "name": html.unescape(r.name) if r.name else "Groupe", "nb": r.nb,
                         "n_colors": int(r.n_colors or 0)} for r in (await db.execute(
            select(Group.id, Group.name, func.count(func.distinct(Print.id)).label("nb"), NCOL.label("n_colors"))
            .join(Print, Print.group_id == Group.id)
            .join(FilamentUsage, FilamentUsage.print_id == Print.id)
            .where(*W(ok), RANKED, *_used)
            .group_by(Group.id).having(NCOL > 1)
            .order_by(desc(NCOL)).limit(10))).all()]

        # ── Tops groupes (agrégés) — absents de l'ancienne version
        async def _top_groups(order_col):
            rows = (await db.execute(
                select(Group.id, Group.name,
                       func.count(Print.id).label("nb"),
                       func.sum(DUR).label("dur_s"),
                       func.sum(func.coalesce(Print.total_cost, 0)).label("cost"),
                       func.sum(func.coalesce(Print.total_weight_g, 0)).label("weight_g"))
                .join(Print, Print.group_id == Group.id)
                .where(*W(ok), RANKED)
                .group_by(Group.id)
                .order_by(desc(order_col)).limit(10)
            )).all()
            return [{"id": r.id, "name": html.unescape(r.name) if r.name else "Groupe", "nb": r.nb,
                     "duration_s": float(r.dur_s or 0),
                     "cost": round(float(r.cost or 0), 2),
                     "weight_g": round(float(r.weight_g or 0), 1)} for r in rows]

        top_g_dur    = await _top_groups(func.sum(DUR))
        top_g_cost   = await _top_groups(func.sum(func.coalesce(Print.total_cost, 0)))
        top_g_weight = await _top_groups(func.sum(func.coalesce(Print.total_weight_g, 0)))

        # ── Évolution dans le temps (succès + échecs)
        #
        # L'agregation s'adapte a la periode : un bucketing mensuel sur "30 jours"
        # ne donnait qu'une ou deux barres (d'ou un graphe vide, la condition front
        # exigeant > 1 point). On choisit donc le grain selon l'etendue reelle.
        rows = (await db.execute(
            select(Print.print_date, Print.total_cost, Print.total_weight_g, Print.status, DUR.label("dur_s"),
                   Print.estimated_seconds, Print.duration_seconds, Print.paused_seconds)
            .where(*period, done_all, Print.print_date.isnot(None)).order_by(Print.print_date)
        )).all()

        # Etendue effective des donnees (en jours), pour choisir le grain meme en
        # mode "Tout".
        span_days = days
        if d_from and d_to:
            span_days = max(span_days, (d_to - d_from).days)
        elif d_from:
            span_days = max(span_days, (datetime.utcnow() - d_from).days)
        if rows:
            first = rows[0].print_date
            last  = rows[-1].print_date
            try:
                span_days = max(span_days, (last - first).days + 1)
            except Exception:
                pass

        if span_days and span_days <= 45:
            bucket = "day"       # YYYY-MM-DD
        elif span_days and span_days <= 120:
            bucket = "week"      # YYYY-Www (annee + numero de semaine ISO)
        else:
            bucket = "month"     # YYYY-MM

        def _bucket_key(dt):
            if bucket == "day":
                return str(dt)[:10]
            if bucket == "week":
                iso = dt.isocalendar()          # (year, week, weekday)
                return f"{iso[0]}-W{iso[1]:02d}"
            return str(dt)[:7]

        monthly = {}
        for r in rows:
            if not r.print_date:
                continue
            key = _bucket_key(r.print_date)
            m = monthly.setdefault(key, {"count": 0, "failed": 0, "partial": 0,
                                         "to_redo": 0, "cost": 0.0,
                                         "weight_g": 0.0, "duration_s": 0.0})
            m["count"]      += 1
            if r.status == "FAILED":
                m["failed"] += 1
            elif r.status == "PARTIAL":
                m["partial"] += 1
            elif r.status == "TO_REDO":
                m["to_redo"] += 1
            m["cost"]       += float(r.total_cost or 0)
            m["weight_g"]   += float(r.total_weight_g or 0)
            m["duration_s"] += float(r.dur_s or 0)

        # ── Répartitions filament (via FilamentUsage → Spool → Filament)
        FU_JOIN = (select(FilamentUsage)
                   .join(_Spool, FilamentUsage.spool_id == _Spool.id)
                   .join(_Fil, _Spool.filament_id == _Fil.id))

        async def _breakdown(col, limit=12):
            q = (select(col.label("k"), func.sum(FilamentUsage.grams_used).label("grams"),
                        func.sum(func.coalesce(FilamentUsage.cost, 0)).label("cost"))
                 .join(_Spool, FilamentUsage.spool_id == _Spool.id)
                 .join(_Fil, _Spool.filament_id == _Fil.id)
                 .join(Print, FilamentUsage.print_id == Print.id)
                 .where(col.isnot(None), FilamentUsage.grams_used > 0, *W())
                 .group_by(col).order_by(desc("grams")).limit(limit))
            return (await db.execute(q)).all()

        mat_rows   = await _breakdown(_Fil.material)      # famille : PLA, PETG…
        type_rows  = await _breakdown(_Fil.fila_type)     # variante : PLA Basic…
        brand_rows = await _breakdown(_Fil.manufacturer)
        color_rows = await _breakdown(_Fil.color_bucket)

        # color_bucket est un CSV ("bleu,rose") : on attribue les grammes à la
        # teinte dominante (la première) pour ne pas double-compter.
        from ....core.colors import COLOR_BUCKETS
        colors: dict[str, dict] = {}
        for r in color_rows:
            dom = str(r.k).split(",")[0].strip()
            if not dom:
                continue
            label, hexv = COLOR_BUCKETS.get(dom, (dom.capitalize(), "#94a3b8"))
            c = colors.setdefault(dom, {"slug": dom, "name": label, "hex": hexv,
                                        "grams": 0.0, "cost": 0.0})
            c["grams"] += float(r.grams or 0)
            c["cost"]  += float(r.cost or 0)
        colors_out = sorted(colors.values(), key=lambda x: -x["grams"])
        for c in colors_out:
            c["grams"] = round(c["grams"])
            c["cost"]  = round(c["cost"], 2)

        # ── Filaments les plus utilisés
        fil_rows = (await db.execute(
            select(_Fil.id, _Fil.name, _Fil.translated_name, _Fil.manufacturer,
                   _Fil.color, _Fil.colors_array, _Fil.multicolor_type, _Fil.fila_finish, _Fil.fila_type,
                   func.sum(FilamentUsage.grams_used).label("grams"),
                   func.sum(func.coalesce(FilamentUsage.cost, 0)).label("cost"))
            .join(_Spool, FilamentUsage.spool_id == _Spool.id)
            .join(_Fil, _Spool.filament_id == _Fil.id)
            .join(Print, FilamentUsage.print_id == Print.id)
            .where(FilamentUsage.grams_used > 0, *W())
            .group_by(_Fil.id).order_by(desc("grams")).limit(10)
        )).all()

        # ── Fiabilite par matiere et par filament (28/10/2026) : pour chaque filament (via sa bobine), les
        # impressions terminees de la periode qui l'ont utilise. Une impression a deux bobines du meme
        # filament ne compte qu'une fois (count distinct) ; les grammes gaches = ce que les echecs ont consomme.
        _N_ALL = func.count(func.distinct(Print.id))
        _N_OK  = func.count(func.distinct(_case((ok, Print.id))))
        _N_KO  = func.count(func.distinct(_case((ko, Print.id))))
        _G_KO  = func.sum(_case((ko, FilamentUsage.grams_used), else_=0))

        def _rel_q(*cols, group):
            return (select(*cols, _N_ALL.label("n"), _N_OK.label("n_ok"), _N_KO.label("n_ko"), _G_KO.label("g_ko"))
                    .select_from(FilamentUsage)
                    .join(_Spool, FilamentUsage.spool_id == _Spool.id)
                    .join(_Fil, _Spool.filament_id == _Fil.id)
                    .join(Print, FilamentUsage.print_id == Print.id)
                    .where(*W())
                    .group_by(*group))

        rel_mat_rows = (await db.execute(
            _rel_q(_Fil.material, group=[_Fil.material]).order_by(desc("n"))
        )).all()
        reliability_by_material = [{
            "name": r.material or "?", "total": int(r.n or 0), "ok": int(r.n_ok or 0), "ko": int(r.n_ko or 0),
            "rate": round(float(r.n_ok or 0) / r.n * 100, 1) if r.n else 0,
            "wasted_g": round(float(r.g_ko or 0)),
        } for r in rel_mat_rows if r.n]

        # les filaments qui ratent : au moins 3 impressions et au moins un echec, les 8 pires taux d'echec
        rel_fil_rows = (await db.execute(
            _rel_q(_Fil.id, _Fil.name, _Fil.translated_name, _Fil.manufacturer, _Fil.color, _Fil.colors_array,
                   _Fil.multicolor_type, _Fil.fila_finish, _Fil.fila_type, group=[_Fil.id])
            .having(_N_ALL >= 3, _N_KO > 0)
        )).all()
        worst_filaments = sorted(({
            "id": r.id, "name": r.translated_name or r.name, "brand": r.manufacturer,
            "color": r.color, "colors_array": r.colors_array, "multicolor_type": r.multicolor_type,
            "fila_finish": r.fila_finish, "fila_type": r.fila_type,
            "total": int(r.n or 0), "ok": int(r.n_ok or 0), "ko": int(r.n_ko or 0),
            "rate": round(float(r.n_ok or 0) / r.n * 100, 1) if r.n else 0,
            "fail_rate": round(float(r.n_ko or 0) / r.n * 100, 1) if r.n else 0,
            "wasted_g": round(float(r.g_ko or 0)),
        } for r in rel_fil_rows if r.n), key=lambda x: (-x["fail_rate"], -x["ko"], -x["wasted_g"]))[:8]

        # ── Periode precedente (28/10/2026) : la fenetre juste avant, de meme longueur, pour les fleches de
        # tendance des cartes. Rien en mode « Tout » (pas de longueur) ni avec une seule borne de fin.
        _now = datetime.utcnow()
        p_from = p_to = None
        if d_from and d_to:
            p_from, p_to = d_from - (d_to - d_from), d_from
        elif d_from:
            p_from, p_to = d_from - (_now - d_from), d_from
        elif not d_to and days and days > 0:
            p_to = _now - timedelta(days=days)
            p_from = p_to - timedelta(days=days)
        previous = None
        if p_from and p_to and p_to > p_from:
            pr = (await db.execute(
                select(func.count(Print.id),
                       func.sum(_case((ok, 1), else_=0)),
                       func.sum(func.coalesce(Print.total_weight_g, 0)),
                       func.sum(func.coalesce(Print.total_cost, 0)),
                       func.sum(DUR))
                .where(done, Print.print_date >= p_from, Print.print_date < p_to)
            )).one()
            _pt = int(pr[0] or 0)
            previous = {
                "from": str(p_from)[:10], "to": str(p_to)[:10],
                "total_prints":   _pt,
                "success_prints": int(pr[1] or 0),
                "success_rate":   round(float(pr[1] or 0) / _pt * 100, 1) if _pt else 0,
                "total_weight_g": round(float(pr[2] or 0), 1),
                "total_cost":     round(float(pr[3] or 0), 2),
                "total_hours":    round(float(pr[4] or 0) / 3600, 1),
            }

        # ── Stock (indépendant de la période)
        stock = (await db.execute(
            select(func.count(_Spool.id),
                   func.sum(func.coalesce(_Spool.remaining_weight_g, 0)))
            .where(_Spool.archived == False)   # noqa: E712
        )).one()
        stock_value = (await db.execute(
            select(func.sum(
                func.coalesce(_Spool.price_override, _Fil.price, 0)
                * func.coalesce(_Spool.remaining_weight_g, 0)
                / func.nullif(_Fil.filament_weight_g, 0)
            ))
            .select_from(_Spool).join(_Fil, _Spool.filament_id == _Fil.id)
            .where(_Spool.archived == False)   # noqa: E712
        )).scalar() or 0
        refs = (await db.execute(select(func.count(_Fil.id)))).scalar() or 0

        def _p(r):
            return {
                "id": r.id,
                "name": _clean_name(r.translated_name or r.file_name or r.original_name),
                "duration_s": float(r.dur_s or 0),
                "cost": round(float(r.total_cost or 0), 2),
                "weight_g": round(float(r.total_weight_g or 0), 1),
                "date": str(r.print_date)[:10] if r.print_date else None,
            }

        def _b(rows):
            return [{"name": r.k, "grams": round(float(r.grams or 0)),
                     "cost": round(float(r.cost or 0), 2)} for r in rows]

        # ── Patterns d'activite (a partir de `rows` deja chargees) ──────────────
        # Repartition par jour de la semaine et par heure ; jour le plus productif.
        _dow = [0] * 7          # lundi=0 ... dimanche=6
        _hour = [0] * 24
        _by_day: dict = {}      # date -> nb, pour trouver le record
        for r in rows:
            d = r.print_date
            if not d:
                continue
            _dow[d.weekday()] += 1
            _hour[d.hour] += 1
            k = str(d)[:10]
            _by_day[k] = _by_day.get(k, 0) + 1
        _best_day = max(_by_day.items(), key=lambda kv: kv[1]) if _by_day else None
        _peak_hour = max(range(24), key=lambda h: _hour[h]) if any(_hour) else None
        DOW_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]

        # ── Cadence et precision (28/10/2026), a partir de `rows` ────────────────
        # Longueur de la periode : la fenetre demandee ; en mode « Tout » (ou avec une seule borne de fin),
        # du premier print a maintenant (ou a la borne).
        _first = rows[0].print_date if rows else None
        if d_from and d_to:
            _period_s = (d_to - d_from).total_seconds()
        elif d_from:
            _period_s = (_now - d_from).total_seconds()
        elif d_to:
            _period_s = (d_to - _first).total_seconds() if _first else 0
        elif days and days > 0:
            _period_s = days * 86400
        else:
            _period_s = (_now - _first).total_seconds() if _first else 0
        period_days = max(_period_s / 86400, 1.0) if total else 0
        # occupation : heures imprimees sur la duree de la periode, plafonnee a 100 %
        occupation_pct = min(100.0, round(float(dur) / _period_s * 100, 1)) if _period_s > 0 and total else 0
        cadence_per_week = round(total / (period_days / 7), 1) if period_days else 0
        # ecart median entre deux lancements successifs
        _dates = [r.print_date for r in rows if r.print_date]
        _gaps = [(b - a).total_seconds() for a, b in zip(_dates, _dates[1:]) if b >= a]
        median_gap_s = round(_median(_gaps)) if _gaps else None
        # precision de l'estimation : mediane de (reel - estime) / estime sur les reussites qui ont les deux
        _est = [(float(r.duration_seconds), float(r.estimated_seconds)) for r in rows
                if r.status == "SUCCESS" and (r.estimated_seconds or 0) > 0 and (r.duration_seconds or 0) > 0]
        estimate_gap_pct = round(_median([(d - e) / e * 100 for d, e in _est]), 1) if _est else None
        estimate_real_h = round(sum(d for d, _ in _est) / 3600, 1)
        estimate_est_h  = round(sum(e for _, e in _est) / 3600, 1)
        # temps total passe en pause (bobine vide, erreur, pause manuelle)
        paused_hours = round(sum(float(r.paused_seconds or 0) for r in rows) / 3600, 2)

        return {
            "days": days,
            "total_prints":   total,
            "success_prints": success,
            "failed_prints":  failed,
            "success_rate":   round(success / total * 100, 1) if total else 0,
            "total_weight_g": round(float(weight), 1),
            "total_cost":     round(float(cost), 2),
            "total_hours":    round(float(dur) / 3600, 1),
            "avg_cost":       round(float(cost) / total, 2) if total else 0,
            "avg_duration_h": round(float(dur) / total / 3600, 2) if total else 0,
            "avg_weight_g":   round(float(weight) / total, 1) if total else 0,
            # Gaspillage (échecs)
            "failed_weight_g": round(float(w_fail), 1),
            "failed_cost":     round(float(c_fail), 2),
            "failed_hours":    round(float(d_fail) / 3600, 1),
            "top_duration":   [_p(r) for r in top_dur],
            "top_cost":       [_p(r) for r in top_cost],
            "top_weight":     [_p(r) for r in top_weight],
            "top_colors":     [{**_p(r), "n_colors": int(r.n_colors or 0)} for r in top_colors],
            "top_groups_colors":   top_g_colors,
            "top_groups_duration": top_g_dur,
            "top_groups_cost":     top_g_cost,
            "top_groups_weight":   top_g_weight,
            # timeline remplace "monthly" ; on garde "monthly" en alias pour ne rien
            # casser d'existant. On limite le nombre de points selon le grain.
            "timeline_bucket": bucket,
            "timeline":        {k: monthly[k] for k in sorted(monthly)[-60:]},
            "monthly":         {k: monthly[k] for k in sorted(monthly)[-60:]},
            "materials":      _b(mat_rows),
            "fila_types":     _b(type_rows),
            "brands":         _b(brand_rows),
            "colors":         colors_out,
            "top_filaments":  [{
                "id": r.id,
                "name": r.translated_name or r.name,
                "brand": r.manufacturer,
                "color": r.color,
                "colors_array": r.colors_array,
                "multicolor_type": r.multicolor_type,
                "fila_finish": r.fila_finish, "fila_type": r.fila_type,
                "grams": round(float(r.grams or 0)),
                "cost": round(float(r.cost or 0), 2),
            } for r in fil_rows],
            "stock": {
                "references":   refs,
                "spools":       stock[0] or 0,
                "weight_g":     round(float(stock[1] or 0), 1),
                "value":        round(float(stock_value), 2),
            },
            # ── Patterns d'activite ──
            "by_weekday": [{"name": DOW_NAMES[i], "value": _dow[i]} for i in range(7)],
            "by_hour":    [{"hour": h, "value": _hour[h]} for h in range(24)],
            "peak_hour":  _peak_hour,
            "best_day":   ({"date": _best_day[0], "count": _best_day[1]} if _best_day else None),
            "status_split": status_split or [
                {"name": "Réussies", "value": success},
                {"name": "Échecs",   "value": failed},
            ],
            # ── Fiabilite par matiere / filament (28/10/2026) ──
            "reliability_by_material": reliability_by_material,
            "worst_filaments": worst_filaments,
            # ── Periode precedente de meme longueur (None en mode « Tout ») ──
            "previous": previous,
            # ── Cadence et precision ──
            "period_days":      round(period_days, 1),
            "occupation_pct":   occupation_pct,
            "cadence_per_week": cadence_per_week,
            "median_gap_s":     median_gap_s,
            "estimate_gap_pct": estimate_gap_pct,
            "estimate_real_h":  estimate_real_h,
            "estimate_est_h":   estimate_est_h,
            "estimate_n":       len(_est),
            "paused_hours":     paused_hours,
        }


@router.post("/{print_id}/reenrich")
async def reenrich_print(print_id: int, _: str = Depends(get_current_user)):
    """
    Relance manuellement la recuperation du 3MF (vignette, filaments, couts).
    Utile quand l'enrichissement a ete perdu — redemarrage pendant la fenetre de
    retry, imprimante injoignable, 3MF pas encore ecrit dans /cache…
    """
    from ....services.print_tracker import _enrich, _bg
    from ....services.settings_service import get_setting

    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p:
            raise HTTPException(404, "Print introuvable")
        if not p.task_name:
            raise HTTPException(
                400,
                "Ce print n'a pas de nom de tache enregistre : il est anterieur au "
                "suivi de reprise, ou a ete cree manuellement. Import du 3MF a la main.",
            )
        ip   = await get_setting(db, "PRINTER_IP")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")

    # FTP prioritaire : l'URL cloud est pre-signee et expire vite.
    url = "ftp://" if (ip and code) else (p.model_url or "")
    if not url:
        raise HTTPException(400, "Ni FTP configure, ni URL enregistree")

    _bg(_enrich(print_id, p.job_id or "", url, p.task_name, ip or "", code or ""))
    return {"ok": True, "message": "Enrichissement relancé en arrière-plan"}


# ── Rattrapage des noms traduits ───────────────────────────────────────────
# Declarees ICI, avant /{print_id} : plus bas, "translate-missing" aurait ete
# interprete comme un identifiant de print et le GET n'aurait jamais ete
# atteint. Le piege classique de ce fichier.

@router.get("/translate-missing")
async def translate_missing_status(_: str = Depends(get_current_user)):
    """Le rattrapage tourne-t-il, bilan du dernier, une cle DeepL est-elle posee
    (jamais la cle elle-meme)."""
    from ....services.translate import backfill_running, backfill_last, KEY_SETTINGS
    from ....services.settings_service import get_setting
    async with AsyncSessionLocal() as db:
        has = {k: bool((await get_setting(db, s, "") or "").strip()) for k, s in KEY_SETTINGS.items()}
    return {"running": backfill_running(), "last": backfill_last(), **has}


@router.post("/translate-missing")
async def translate_missing_start(stop: bool = False, retry_same: bool = False,
                                  _: str = Depends(require_admin)):
    """
    Demarre le rattrapage en tache de fond, ou l'arrete avec ?stop=1.
    ?retry_same=1 reprend aussi les noms restes identiques au nom d'origine
    (ceux qu'un service a bout de quota a fait passer pour « deja francais »).

    En tache de fond et non par paquets pilotes depuis le navigateur : un
    rechargement de page tuait la boucle cliente sans laisser de trace, et il
    devenait impossible de savoir en revenant si un rattrapage etait en cours.
    """
    from ....services.translate import start_backfill, stop_backfill, backfill_running
    if stop:
        stop_backfill()
        return {"running": backfill_running(), "stopping": True}
    started = start_backfill(retry_same=retry_same)
    return {"running": True, "started": started}


@router.put("/translate-key")
async def translate_set_key(body: dict, _: str = Depends(require_admin)):
    """Pose (ou retire, avec "") la cle d'un service : body {"service":
    "deepl"|"gcloud", "key"}. Saisie par l'utilisateur, rangee dans les
    reglages ; jamais renvoyee au navigateur."""
    from ....services.translate import KEY_SETTINGS
    from ....services.settings_service import set_setting
    service = str(body.get("service") or "deepl")
    if service not in KEY_SETTINGS:
        raise HTTPException(400, "Service inconnu")
    key = str(body.get("key") or "").strip()
    if len(key) > 200:
        raise HTTPException(400, "Clé trop longue")
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY_SETTINGS[service], key)
    return {service: bool(key)}


@router.get("/kpis")
async def prints_kpis(
    status: Optional[str] = None,
    search: Optional[str] = None,
    group_id: Optional[int] = None,
    material:    Optional[str] = None,
    fila_type:   Optional[str] = None,
    filament_id: Optional[int] = None,
    color:       Optional[str] = None,
    date_from: Optional[str] = None,
    date_to:   Optional[str] = None,
    _: str = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        from sqlalchemy import or_ as _or
        from sqlalchemy import case as _case
        q = select(
            func.count(Print.id).label("count"),
            func.sum(_PRINT_DURATION).label("duration"),
            func.sum(func.coalesce(Print.total_weight_g, 0)).label("weight"),
            func.sum(func.coalesce(Print.total_cost, 0)).label("cost"),
            # reussies (dont en partie) et ratees : le taux de reussite d'une periode
            func.sum(_case((Print.status.in_(("SUCCESS", "PARTIAL")), 1), else_=0)).label("ok"),
            func.sum(_case((Print.status.in_(("FAILED", "CANCELLED", "TO_REDO")), 1), else_=0)).label("ko"),
        ).where(Print.status != "IN_PROGRESS")
        if status:   q = q.where(Print.status == status)
        if group_id: q = q.where(Print.group_id == group_id)
        if search:
            q = _apply_search(q, search)
        if material or fila_type or filament_id or color:
            q = q.where(Print.id.in_(_filament_filter_subq(material, fila_type, filament_id, color)))
        for c in _period_clauses(date_from, date_to):
            q = q.where(c)
        r = (await db.execute(q)).one()
        return {"count": r.count or 0, "duration": int(r.duration or 0),
                "weight_g": float(r.weight or 0), "cost": round(float(r.cost or 0), 2),
                "ok": int(r.ok or 0), "failed": int(r.ko or 0)}

@router.get("/kpis/daily")
async def prints_kpis_daily(
    date_from: str,
    date_to: Optional[str] = None,
    tz: int = 0,
    detail: bool = False,
    _: str = Depends(get_current_user),
):
    """Les chiffres de /kpis jour par jour, en une requete (les tuiles de l'accueil en demandaient un
    appel par jour). Jours de l'utilisateur (tz : son decalage en minutes, a l'est de UTC).
    Nombre, poids et cout comptent au jour du lancement ; les HEURES machine sont reparties sur les
    jours ou l'impression a vraiment tourne (une impression lancee le soir et finie le lendemain
    compte sur les deux), l'impression en cours jusqu'a maintenant."""
    from datetime import timedelta
    try:
        d0 = datetime.strptime(date_from[:10], "%Y-%m-%d").date()
        d1 = datetime.strptime((date_to or date_from)[:10], "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "Dates attendues au format AAAA-MM-JJ")
    if d1 < d0 or (d1 - d0).days > 400:
        raise HTTPException(400, "Période invalide (400 jours au plus)")
    off = timedelta(minutes=max(-14 * 60, min(14 * 60, tz)))
    lo = datetime.combine(d0, datetime.min.time()) - off              # bornes en UTC
    hi = datetime.combine(d1 + timedelta(days=1), datetime.min.time()) - off
    now = datetime.utcnow()
    days = {(d0 + timedelta(days=i)).isoformat(): {"count": 0, "duration": 0.0, "weight_g": 0.0, "cost": 0.0, "items": []}
            for i in range((d1 - d0).days + 1)}
    async with AsyncSessionLocal() as db:
        # une impression peut avoir commence avant la periode et tourner dedans : 4 jours de marge
        rows = (await db.execute(select(Print.print_date, Print.duration_seconds, Print.total_weight_g, Print.total_cost, Print.status,
                                        Print.id, Print.file_name, Print.estimated_seconds)
                                 .where(Print.print_date >= lo - timedelta(days=4), Print.print_date < hi))).all()
    for start, dur, w, c, status, pid, fname, est in rows:
        if not start:
            continue
        if getattr(start, "tzinfo", None) is not None:
            start = start.replace(tzinfo=None) - (start.utcoffset() or timedelta(0))
        local = start + off
        if status != "IN_PROGRESS":
            k = local.date().isoformat()
            if k in days:
                days[k]["count"] += 1
                days[k]["weight_g"] += float(w or 0)
                days[k]["cost"] += float(c or 0)
            secs = float(dur or est or 0)   # sans duree mesuree : l'estimation, comme partout ailleurs
        else:
            secs = max(0.0, (now - start).total_seconds())
        # les heures, jour par jour, la ou elles ont tourne
        t, end = local, local + timedelta(seconds=secs)
        while t < end:
            nxt = min(end, datetime.combine(t.date() + timedelta(days=1), datetime.min.time()))
            k = t.date().isoformat()
            if k in days:
                days[k]["duration"] += (nxt - t).total_seconds()
                if detail:
                    days[k]["items"].append({"id": pid, "name": fname, "start": local.isoformat(timespec="minutes"),
                                             "seconds": int((nxt - t).total_seconds()), "status": status})
            t = nxt
    return [{"date": k, "count": v["count"], "duration": int(v["duration"]), "weight_g": round(v["weight_g"], 1),
             "cost": round(v["cost"], 2), **({"items": sorted(v["items"], key=lambda x: x["start"])} if detail else {})}
            for k, v in days.items()]


@router.get("/diag/export")
async def diag_export(days: int = Query(14, ge=1, le=120), tz: int = 0, _: str = Depends(require_admin)):
    """Export de diagnostic (Parametres) : les impressions des derniers jours avec tout ce que les
    calculs utilisent (dates brutes telles qu'en base, durees, pauses, statut), et le resultat de
    /kpis/daily pour la meme periode et le meme fuseau. Ni bobine, ni compte, ni reglage."""
    import aiosqlite, os
    from datetime import timedelta
    db_path = os.getenv("DATABASE_URL", "sqlite+aiosqlite:////data/bambunymous.db").replace("sqlite+aiosqlite:///", "")
    since = (datetime.utcnow() - timedelta(days=days + 4)).strftime("%Y-%m-%d %H:%M:%S")
    cols = ("id, job_id, file_name, status, print_type, print_date, typeof(print_date) AS print_date_type, created_at, updated_at, "
            "estimated_seconds, duration_seconds, paused_seconds, paused_since, total_weight_g, total_cost, group_id, plate_id")
    rows = []
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(f"SELECT {cols} FROM prints WHERE datetime(print_date) >= ? OR datetime(created_at) >= ? "
                              "OR status = 'IN_PROGRESS' ORDER BY id", (since, since)) as cur:
            async for r in cur:
                rows.append(dict(r))
    today = (datetime.utcnow() + timedelta(minutes=tz)).date()
    daily = await prints_kpis_daily((today - timedelta(days=days - 1)).isoformat(), today.isoformat(), tz=tz, detail=True, _="")
    return {"generated_utc": datetime.utcnow().isoformat(timespec="seconds"), "tz": tz, "days": days,
            "prints": rows, "daily": daily}


@router.get("/debug")
async def debug_prints(_: str = Depends(require_admin)):
    """Route de debug — dump brut de la table prints (administrateur seulement)."""
    import aiosqlite, os
    db_path = os.getenv("DATABASE_URL", "sqlite+aiosqlite:////data/bambunymous.db")
    db_path = db_path.replace("sqlite+aiosqlite:///", "")
    rows = []
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT id,job_id,file_name,status,plate_image,model_3mf,created_at FROM prints ORDER BY id DESC LIMIT 20") as cur:
            async for row in cur:
                rows.append(dict(row))
        async with db.execute("SELECT name FROM sqlite_master WHERE type='table'") as cur:
            tables = [r[0] async for r in cur]
    return {"tables": tables, "prints": rows}


async def _makerworld_for(design_id) -> dict:
    """Fiche MakerWorld d'un modele (cache). Pas encore lue : lecture lancee en
    arriere-plan, status "pending" -- la fiche redemande un peu apres."""
    from ....models.print_history import MakerWorldDesign as _MW
    from ....services.makerworld import to_dict as _mw_dict, launch as _mw_launch
    did = str(design_id or "").strip()
    if not did or did == "0" or not did.isdigit():
        return {"makerworld": None, "status": "none"}
    # Jamais d'erreur vers la fiche : sans fiche MakerWorld, elle montre le lien.
    try:
        async with AsyncSessionLocal() as db:
            m = await db.get(_MW, did)
        if m is None:
            _mw_launch(did)
            return {"makerworld": None, "status": "pending"}
        d = _mw_dict(m)
        if d is not None:
            # les filaments recommandes par le createur, face a mon stock (lu a chaque fois : le stock bouge)
            from ....services.makerworld import extras_of as _ex
            from ....services.mw_docs import filaments_view as _fv
            d["filaments"] = await _fv(_ex(m.extras).get("filaments") or [])
        return {"makerworld": d, "status": m.status}
    except Exception:
        logging.getLogger(__name__).exception("[MW] fiche du modele")
        return {"makerworld": None, "status": "error"}


@router.get("/makerworld/pick")
async def pick_for_makerworld(search: Optional[str] = None, unlinked: bool = False,
                              limit: int = Query(40, le=100), offset: int = 0,
                              _: str = Depends(require_admin)):
    """Choisir les impressions a associer a un modele MakerWorld : liste A PLAT
    (un print d'un groupe se choisit seul), avec le modele deja lie s'il y en a
    un ; `unlinked` : seulement celles sans modele."""
    from ....models.print_history import MakerWorldDesign as _MW
    async with AsyncSessionLocal() as db:
        q = (select(Print, Group.name, _MW.title_fr, _MW.title)
             .outerjoin(Group, Group.id == Print.group_id)
             .outerjoin(_MW, _MW.design_id == Print.design_id)
             .where(Print.status != "IN_PROGRESS")
             .order_by(Print.print_date.desc(), Print.id.desc()))
        if search:
            q = _apply_search(q, search)
        if unlinked:
            q = q.where(or_(Print.design_id.is_(None), Print.design_id == ""))
        rows = (await db.execute(q.offset(offset).limit(limit + 1))).all()
    more = len(rows) > limit
    items = []
    for p, gname, t_fr, t in rows[:limit]:
        did = str(p.design_id) if p.design_id else None
        items.append({
            "id": p.id,
            "name": next((n for n in (p.translated_name, p.task_name, p.file_name)
                          if n and str(n).strip() not in ("", "0")), f"Impression #{p.id}"),
            "date": p.print_date.isoformat() if p.print_date else None,
            "status": p.status,
            "group": gname,
            "design_id": did,
            "design_title": (t_fr or t) if did else None,
        })
    return {"items": items, "more": more, "next_offset": offset + limit if more else None}


@router.post("/makerworld/assign")
async def assign_makerworld(body: dict = Body({}), _: str = Depends(require_admin)):
    """
    Associe un modele MakerWorld a des impressions choisies a la main : les
    prints donnes, et tous ceux des groupes donnes. Le profil MakerWorld
    eventuel est oublie (il venait d'un autre modele). La fiche du modele est
    lue en arriere-plan.
    """
    from sqlalchemy import select as _s, update as _u
    from ....db.session import AsyncSessionLocal as _ASL
    did = str(body.get("design_id") or "").strip()
    if not did.isdigit() or did == "0":
        raise HTTPException(400, "Modèle MakerWorld invalide")
    pids = {int(x) for x in (body.get("print_ids") or []) if str(x).isdigit()}
    gids = {int(x) for x in (body.get("group_ids") or []) if str(x).isdigit()}
    if not pids and not gids:
        raise HTTPException(400, "Choisis au moins une impression ou un groupe")
    async with _ASL() as db:
        if gids:
            pids |= set((await db.execute(_s(Print.id).where(Print.group_id.in_(gids)))).scalars().all())
        n = (await db.execute(_u(Print).where(Print.id.in_(pids))
                              .values(design_id=did, mw_profile_id=None))).rowcount
        await db.commit()
    try:
        from ....services.makerworld import launch as _mw_launch
        _mw_launch(did)
    except Exception:
        logging.getLogger(__name__).exception("[MW] lancement impossible")
    logging.getLogger(__name__).info(f"[MW] modele {did} associe a {n} impression(s)")
    return {"ok": True, "count": n, "design_id": did}


@router.get("/makerworld/{design_id}")
async def design_makerworld(design_id: str, _: str = Depends(get_current_user)):
    """Fiche MakerWorld par modele : sert a la fiche d'un print comme a celle
    d'un groupe (ses prints partagent normalement le meme modele)."""
    return await _makerworld_for(design_id)


@router.get("/design/{design_id}/gallery")
async def design_gallery(design_id: str, _: str = Depends(get_current_user)):
    """Mes impressions d'un modele MakerWorld, avec photos et filaments utilises
    (lu aussi par le BambuNymous d'un copain : « Chez les copains »)."""
    from .filaments import gallery_items
    from ....models.filament import Filament, Spool
    did = str(design_id or "").strip()
    if not did.isdigit():
        return {"prints": [], "groups": []}
    async with AsyncSessionLocal() as db:
        prints = (await db.execute(
            select(Print).options(selectinload(Print.snapshots), selectinload(Print.group))
            .where(Print.design_id == did).order_by(Print.print_date.desc())
        )).scalars().all()
        if not prints:
            return {"prints": [], "groups": []}
        ids = [p.id for p in prints]
        rows = (await db.execute(
            select(FilamentUsage.print_id, FilamentUsage.grams_used, Filament.name, Filament.translated_name,
                   Filament.manufacturer, Filament.color, Filament.colors_array, Filament.multicolor_type,
                   Filament.fila_type, Filament.material)
            .join(Spool, Spool.id == FilamentUsage.spool_id).join(Filament, Filament.id == Spool.filament_id)
            .where(FilamentUsage.print_id.in_(ids))
        )).all()
        grams, fils = {}, {}
        for pid, g, name, tname, brand, color, carr, mct, ftype, mat in rows:
            grams[pid] = grams.get(pid, 0.0) + float(g or 0)
            lst = fils.setdefault(pid, [])
            if not any(x["name"] == (tname or name) for x in lst):
                lst.append({"name": tname or name, "brand": brand, "color": color, "colors_array": carr,
                            "multicolor_type": mct, "material": ftype or mat})
        out = await gallery_items(db, prints, grams)
    for it in out["prints"]:
        it["filaments"] = fils.get(it["id"], [])
    return out


@router.get("/{print_id}/makerworld")
async def print_makerworld(print_id: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p:
            raise HTTPException(404, "Print introuvable")
    return await _makerworld_for(p.design_id)


@router.get("/{print_id}")
async def get_print(print_id: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        p = (await db.execute(
            select(Print)
            .where(Print.id == print_id)
            .options(selectinload(Print.filament_usage),
                     selectinload(Print.snapshots),
                     selectinload(Print.tags),
                     selectinload(Print.group))
        )).scalar_one_or_none()
    if not p: raise HTTPException(404, "Print introuvable")
    async with AsyncSessionLocal() as db2:
        await _enrich_filament_usage(db2, [p])
        out = _print_to_out(p)
        out["makerworld"] = None
        if p.design_id:
            from ....models.print_history import MakerWorldDesign as _MW
            from ....services.makerworld import to_dict as _mw_dict
            out["makerworld"] = _mw_dict(await db2.get(_MW, str(p.design_id)))
    return out


@router.put("/{print_id}/mw-plates")
async def set_mw_plates(print_id: int, body: dict, _: str = Depends(get_current_user)):
    """Plateaux MakerWorld imprimes par ce print (choisis a la main). Une liste
    vide dit « aucun plateau de ce profil » ; reset revient a la detection."""
    import json as _json
    plates = sorted({int(x) for x in (body.get("plates") or []) if str(x).isdigit() and 0 < int(x) < 1000})
    prof = str(body.get("profile") or "").strip()
    if prof and not prof.isdigit():
        raise HTTPException(400, "Profil invalide")
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p:
            raise HTTPException(404)
        p.mw_plates = None if body.get("reset") else _json.dumps({"profile": prof or None, "plates": plates})
        await db.commit()
        out = {"id": print_id, "mw_plates": p.mw_plates}
    # le 3MF d'origine de ce profil, recupere en fond s'il manque (28/10/2026) : la vue 3D, les couleurs et la
    # sauvegarde NAS suivent le profil choisi sans attendre un rattrapage
    if prof:
        import asyncio
        from ....services.mw_source import for_print
        asyncio.get_running_loop().create_task(for_print(print_id))
    return out


@router.patch("/{print_id}")
async def update_print(print_id: int, body: dict, _: str = Depends(get_current_user)):
    allowed = {"file_name","status","status_note","number_of_items",
                "sold_units","sold_price_total","margin","notes",
                "design_id","duration_seconds","print_date",
                "translated_name", "stats_excluded"}
    if "stats_excluded" in body:
        body = {**body, "stats_excluded": 1 if body["stats_excluded"] else 0}
    # Les cinq statuts de Spoolnymous, plus CANCELLED. Valide explicitement :
    # le champ etait accepte comme chaine libre, une faute de frappe cote client
    # inscrivait donc un statut inconnu, invisible dans les filtres.
    PRINT_STATUSES = {"IN_PROGRESS", "SUCCESS", "PARTIAL", "TO_REDO",
                      "FAILED", "CANCELLED"}
    if "status" in body and body["status"] not in PRINT_STATUSES:
        raise HTTPException(400, f"Statut invalide : {body['status']}")
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p: raise HTTPException(404)
        for k, v in body.items():
            if k not in allowed:
                continue
            if k == "design_id":
                # Saisie manuelle de l'ID MakerWorld : chaine vide -> NULL (effacer),
                # "0" ignore comme partout ailleurs (id bidon).
                sd = str(v or "").strip()
                p.design_id = None if (not sd or sd == "0") else sd
            elif k == "print_date":
                # Le front envoie une chaine ISO ("2026-07-17T14:30") ; SQLite exige
                # un objet datetime. On parse, on ignore si vide/invalide.
                if isinstance(v, datetime):
                    p.print_date = v
                else:
                    sv = str(v or "").strip()
                    if sv:
                        try:
                            p.print_date = datetime.fromisoformat(sv)
                        except ValueError:
                            pass  # format inattendu -> on ne touche pas
            else:
                setattr(p, k, v)
                if k == "translated_name":
                    p.translated_by = "manuel" if str(v or "").strip() else None
        p.updated_at = datetime.utcnow()
        await db.commit()
    return {"ok": True}


@router.delete("/{print_id}")
async def delete_print(print_id: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p: raise HTTPException(404)
        await db.delete(p); await db.commit()
    # Supprimer les fichiers
    d = DATA_DIR / "prints" / str(print_id)
    if d.exists(): shutil.rmtree(d, ignore_errors=True)
    return {"ok": True}




@router.post("/{print_id}/photo/{filename}/primary")
async def set_print_cover_photo(print_id: int, filename: str,
                                _: str = Depends(get_current_user)):
    """Definit la photo mise en avant (vignette de la galerie)."""
    gallery_touched()
    d = DATA_DIR / "prints" / str(print_id)
    # Garde-fou : sans lui, un filename du type "../../x" sortait du dossier du
    # print et se retrouvait stocke tel quel dans cover_photo.
    target = (d / filename).resolve()
    try:
        target.relative_to(d.resolve())
    except ValueError:
        raise HTTPException(400, "Nom de fichier invalide")
    if not target.is_file():
        raise HTTPException(404, "Photo introuvable")
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p:
            raise HTTPException(404, "Print introuvable")
        p.cover_photo = filename
        await db.commit()
    return {"ok": True, "cover_photo": filename}


@router.get("/{print_id}/nas")
async def print_nas(print_id: int, _: str = Depends(get_current_user)):
    """Ce qui, pour cette impression, n'est plus que sur le NAS (vide du local par une purge), et si le NAS repond."""
    from ....services.archive import nas_only, nas_only_model
    files = nas_only(f"prints/{print_id}")
    async with AsyncSessionLocal() as db:
        did = (await db.execute(select(Print.design_id).where(Print.id == print_id))).scalar()
    model = nas_only_model(did) if did else []
    alls = files + model
    return {"files": files, "model": model, "total": len(alls), "reachable": any(f["present"] for f in alls) if alls else None}


@router.get("/{print_id}/photos")
async def list_print_photos(print_id: int, _: str = Depends(get_current_user)):
    from ....services.archive import archived_names
    d = DATA_DIR / "prints" / str(print_id)
    # ce qui est en local, et ce qui n'est plus que sur le NAS (vide du local)
    names = sorted(({f.name for f in d.iterdir()} if d.exists() else set()) | set(archived_names(f"prints/{print_id}")))
    return [{"filename": n, "url": f"/api/v1/prints/{print_id}/file/{n}"} for n in names
            if (n.startswith("Photo-") and os.path.splitext(n)[1].lower() in (".jpg",".jpeg",".png",".webp"))
            or (n.startswith("Video-") and os.path.splitext(n)[1].lower() in (".mp4",".webm",".mov",".m4v"))]

@router.post("/{print_id}/photos/upload")
async def upload_print_photo(
    print_id: int,
    file: UploadFile = File(...),
    _: str = Depends(get_current_user),
):
    import subprocess as _sp, tempfile as _tf, os as _os
    from ....models.print_history import PrintSnapshot as _PS
    gallery_touched()
    is_video = bool(file.content_type and file.content_type.startswith("video/"))
    if not file.content_type or not (file.content_type.startswith("image/") or is_video):
        raise HTTPException(400, "Fichier image ou vidéo requis")
    d = DATA_DIR / "prints" / str(print_id)
    d.mkdir(parents=True, exist_ok=True)
    raw = await file.read()
    orig_ext = (file.filename or ("video.mp4" if is_video else "photo.jpg")).rsplit(".", 1)[-1].lower()
    if is_video:
        # Comme Spoolnymous : la video devient un WebP ANIME (facon gif, muet, en
        # boucle). C'est une image -> rendue partout comme une photo (<img>), elle
        # boucle nativement et sert de vignette, sans <video> ni 404.
        idx = 1
        while (d / f"Photo-{idx:02d}.webp").exists():
            idx += 1
        dest = d / f"Photo-{idx:02d}.webp"
        try:
            with _tf.NamedTemporaryFile(delete=False, suffix="." + orig_ext) as tmp:
                tmp.write(raw); tmp_path = tmp.name
            # Hors de la boucle : ffmpeg sur une grosse video prend des minutes,
            # et un appel bloquant figeait TOUT le serveur pendant ce temps.
            await asyncio.to_thread(_sp.run, [
                "ffmpeg", "-y", "-i", tmp_path, "-t", "30",
                "-vf", "fps=15,scale='min(720,iw)':-1:flags=lanczos",
                "-an", "-loop", "0", "-c:v", "libwebp",
                "-q:v", "55", "-compression_level", "5", "-preset", "picture", str(dest)
            ], check=True, capture_output=True, timeout=300)
            _os.unlink(tmp_path)
        except Exception:
            # Repli : si l'encodage anime echoue, garder la video brute.
            ext = orig_ext if orig_ext in ("mp4", "webm", "mov", "m4v") else "mp4"
            dest = d / f"Video-{idx:02d}.{ext}"
            dest.write_bytes(raw)
    else:
        # Numéroter Photo-01, 02... (même convention que zip_importer)
        idx = 1
        while (d / f"Photo-{idx:02d}.webp").exists() or (d / f"Photo-{idx:02d}.{orig_ext}").exists():
            idx += 1
        dest = d / f"Photo-{idx:02d}.webp"
        try:
            with _tf.NamedTemporaryFile(delete=False, suffix="." + orig_ext) as tmp:
                tmp.write(raw); tmp_path = tmp.name
            # Hors de la boucle : ffmpeg sur une grosse video prend des minutes,
            # et un appel bloquant figeait TOUT le serveur pendant ce temps.
            await asyncio.to_thread(_sp.run, [
                "ffmpeg", "-y", "-i", tmp_path,
                "-vf", "scale='min(800,iw)':'min(800,ih)':force_original_aspect_ratio=decrease",
                "-quality", "80", "-compression_level", "6", str(dest)
            ], check=True, capture_output=True, timeout=30)
            _os.unlink(tmp_path)
        except Exception:
            dest = d / f"Photo-{idx:02d}.{orig_ext}"
            dest.write_bytes(raw)
    # Créer PrintSnapshot en DB (trigger=manual) pour apparaître dans la galerie
    rel_path = f"prints/{print_id}/{dest.name}"
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select as _sel
        existing = (await db.execute(
            _sel(_PS).where(_PS.print_id == print_id, _PS.file_path == rel_path)
        )).scalar_one_or_none()
        if not existing:
            db.add(_PS(print_id=print_id, trigger="manual", file_path=rel_path))
            await db.commit()
    return {"ok": True, "filename": dest.name, "url": f"/api/v1/prints/{print_id}/file/{dest.name}"}


@router.get("/{print_id}/image")
async def print_image(print_id: int, orig: int = 0):
    import mimetypes
    print_dir = DATA_DIR / "prints" / str(print_id)
    if not print_dir.exists():
        raise HTTPException(404)
    # la vignette choisie : la vue 3D assemblee, si elle a ete prise et preferee ; ?orig=1 : l'image d'origine, toujours
    # (30/10/2026 : la fiche la montre a cote de la vue 3D)
    if not orig and _v3slots(print_dir):
        async with AsyncSessionLocal() as db:
            pref = (await db.execute(select(Print.thumb_3d).where(Print.id == print_id))).scalar()
        nm, _ = await asyncio.to_thread(_v3cover, print_dir, pref)
        if nm:
            return FileResponse(str(print_dir / nm), media_type="image/png")
    # plate.png en priorité, sinon première image trouvée
    for name in ("plate.png", "plate.jpg"):
        f = print_dir / name
        if f.exists():
            return FileResponse(str(f), media_type=f"image/{f.suffix[1:]}")
    for f in sorted(print_dir.iterdir()):
        if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
            mime = mimetypes.guess_type(str(f))[0] or "image/png"
            return FileResponse(str(f), media_type=mime)
    raise HTTPException(404)



@router.get("/{print_id}/upload/{filename}")
async def print_upload_file(print_id: int, filename: str):
    """Sert les fichiers uploadés du dossier uploads d'un print."""
    import mimetypes
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    path = DATA_DIR / "prints" / str(print_id) / "uploads" / filename
    if not path.exists(): raise HTTPException(404)
    mime = mimetypes.guess_type(str(path))[0] or "image/webp"
    return FileResponse(str(path), media_type=mime)

@router.delete("/{print_id}/upload/{filename}")
async def delete_print_upload(print_id: int, filename: str, _: str = Depends(get_current_user)):
    """Supprime une photo uploadée (Photo-*.webp) + son PrintSnapshot en DB."""
    gallery_touched()
    from ....models.print_history import PrintSnapshot as _PS
    from sqlalchemy import select as _sel
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    path = DATA_DIR / "prints" / str(print_id) / filename
    if not path.exists():
        raise HTTPException(404)
    path.unlink()
    rel_path = f"prints/{print_id}/{filename}"
    async with AsyncSessionLocal() as db:
        snap = (await db.execute(
            _sel(_PS).where(_PS.print_id == print_id, _PS.file_path == rel_path)
        )).scalar_one_or_none()
        if snap:
            await db.delete(snap)
            await db.commit()
    return {"ok": True}

@router.get("/{print_id}/file/{filename}")
async def print_file(print_id: int, filename: str):
    """Sert n'importe quel fichier du dossier d'un print."""
    import mimetypes
    from ....services.archive import local_or_archive
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    path = local_or_archive(f"prints/{print_id}/{filename}")       # vide du local : relu sur le NAS
    if not path: raise HTTPException(404)
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(str(path), media_type=mime)


@router.get("/{print_id}/snapshots")
async def print_snapshots_list(print_id: int):
    """Liste toutes les images du dossier d'un print (snapshots + vignettes importées)."""
    import mimetypes
    from ....services.archive import archived_names
    print_dir = DATA_DIR / "prints" / str(print_id)
    names = set(f.name for f in print_dir.iterdir()) if print_dir.exists() else set()
    names |= set(archived_names(f"prints/{print_id}"))          # captures videes du local : sur le NAS
    files = [{"name": n, "url": f"/api/v1/prints/{print_id}/file/{n}"} for n in sorted(names)
             if os.path.splitext(n)[1].lower() in (".png", ".jpg", ".jpeg", ".webp") and n != "plate.png"]
    return {"files": files}


@router.get("/{print_id}/snapshot/{trigger}")
async def print_snapshot(print_id: int, trigger: str):
    from ....services.archive import local_or_archive
    path = local_or_archive(f"prints/{print_id}/snapshot-{trigger}.jpg")
    if not path: raise HTTPException(404)
    return FileResponse(path, media_type="image/jpeg")


@router.post("/import")
async def import_print(
    file: UploadFile = File(...),
    print_date: Optional[str] = Form(None),
    _: str = Depends(get_current_user),
):
    """Import manuel d'un fichier .3mf."""
    from ....services.print_tracker import create_manual_print
    if not file.filename.endswith(".3mf"):
        raise HTTPException(400, "Fichier .3mf requis")
    tmp = DATA_DIR / "uploads" / file.filename
    tmp.parent.mkdir(parents=True, exist_ok=True)
    try:
        tmp.write_bytes(await file.read())
        dt = datetime.fromisoformat(print_date) if print_date else datetime.utcnow()
        pid = await create_manual_print(str(tmp), dt)
        if not pid: raise HTTPException(500, "Erreur import")
        return {"ok": True, "print_id": pid}
    finally:
        try: tmp.unlink()
        except Exception: pass


@router.delete("/{print_id}/snapshots/{snapshot_id}")
async def delete_snapshot(print_id: int, snapshot_id: int, _: str = Depends(get_current_user)):
    gallery_touched()
    import os as _os
    async with AsyncSessionLocal() as db:
        s = await db.get(PrintSnapshot, snapshot_id)
        if not s or s.print_id != print_id:
            raise HTTPException(404)
        if s.file_path:
            p = DATA_DIR / s.file_path
            try: p.unlink(missing_ok=True)
            except Exception: pass
        await db.delete(s)
        await db.commit()
    return {"ok": True}


@router.post("/{print_id}/tags")
async def add_tag(print_id: int, body: dict, _: str = Depends(get_current_user)):
    tag = (body.get("tag") or "").strip()
    if not tag: raise HTTPException(400)
    async with AsyncSessionLocal() as db:
        db.add(PrintTag(print_id=print_id, tag=tag))
        await db.commit()
    return {"ok": True}


@router.delete("/{print_id}/tags/{tag}")
async def del_tag(print_id: int, tag: str, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PrintTag).where(PrintTag.print_id == print_id, PrintTag.tag == tag)
        )
        t = result.scalar_one_or_none()
        if t: await db.delete(t); await db.commit()
    return {"ok": True}


@router.post("/group/bulk")
async def set_group_bulk(body: dict, _: str = Depends(get_current_user)):
    """
    Assigne plusieurs prints au même groupe en un seul appel (évite de créer
    un nouveau groupe par print lors d'une sélection multiple).
    body: {"print_ids": [1,2,3], "group_id": 12} pour un groupe existant,
          {"print_ids": [1,2,3], "group_name": "Nouveau nom"} pour en créer un nouveau,
          {"print_ids": [1,2,3]} (sans group_id/group_name) pour retirer du groupe.
    """
    print_ids  = body.get("print_ids") or []
    group_id   = body.get("group_id")
    group_name = (body.get("group_name") or "").strip()
    if not print_ids:
        raise HTTPException(400, "print_ids requis")

    async with AsyncSessionLocal() as db:
        target_gid = None
        if group_id:
            g = await db.get(Group, int(group_id))
            if not g:
                raise HTTPException(404, "Groupe introuvable")
            target_gid = g.id
        elif group_name:
            g = Group(name=group_name)
            db.add(g)
            await db.flush()
            target_gid = g.id

        updated = 0
        affected = set()
        for pid in print_ids:
            p = await db.get(Print, int(pid))
            if p:
                if p.group_id:
                    affected.add(p.group_id)   # ancien groupe quitte
                p.group_id = target_gid
                updated += 1
        if target_gid:
            affected.add(target_gid)           # groupe rejoint

        # Le cout par objet d'un groupe = somme des total_cost de ses membres /
        # number_of_items. Ajouter/retirer un print change donc le cout des objets
        # rattaches au(x) groupe(s) concerne(s) : on le repercute (comme patch_group
        # le fait deja sur number_of_items). flush prealable pour que la requete
        # des membres voie la nouvelle appartenance.
        await db.flush()
        for gid in affected - {None}:
            await _propagate_object_costs(db, "group", gid)

        await db.commit()
    return {"ok": True, "group_id": target_gid, "updated": updated}


@router.post("/{print_id}/group")
async def set_group(print_id: int, body: dict, _: str = Depends(get_current_user)):
    """
    Assigne un print à un groupe.
    body: {"group_id": 12} pour un groupe existant,
          {"group_name": "Nouveau nom"} pour en créer un nouveau,
          {} ou group_id=null pour retirer le print de son groupe.
    """
    group_id   = body.get("group_id")
    group_name = (body.get("group_name") or "").strip()

    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p:
            raise HTTPException(404)

        old_gid = p.group_id
        if group_id:
            g = await db.get(Group, int(group_id))
            if not g:
                raise HTTPException(404, "Groupe introuvable")
            p.group_id = g.id
        elif group_name:
            g = Group(name=group_name)
            db.add(g)
            await db.flush()
            p.group_id = g.id
        else:
            p.group_id = None

        # Rejoindre/quitter un groupe change l'ensemble de ses membres, donc le
        # cout par objet (somme des membres / number_of_items). On repercute sur
        # les objets des deux groupes concernes (ancien et nouveau).
        await db.flush()
        for gid in {old_gid, p.group_id} - {None}:
            await _propagate_object_costs(db, "group", gid)

        await db.commit()
    return {"ok": True, "group_id": p.group_id}


@router.post("/recalculate-all")
async def recalculate_all_prints(_: str = Depends(get_current_user)):
    """Recalcule les coûts de tous les prints terminés (filament override + normal + électricité).
    Les groupes sont calculés à la volée → se mettent à jour automatiquement.
    """
    import threading, asyncio as _aio
    def _run():
        loop = _aio.new_event_loop()
        async def _go():
            from ....services.print_tracker import recalculate_print
            async with AsyncSessionLocal() as db:
                pids = (await db.execute(
                    select(Print.id).where(Print.status.in_(["SUCCESS","FAILED","IN_PROGRESS"]))
                )).scalars().all()
            total = len(pids)
            for i, pid in enumerate(pids, 1):
                await recalculate_print(pid)
                if i % 10 == 0:
                    import logging; logging.getLogger(__name__).info(f"[RECALC] {i}/{total} prints recalculés...")
            # Repercuter les nouveaux couts sur les objets lies.
            async with AsyncSessionLocal() as db:
                for pid in pids:
                    await _propagate_from_print(db, pid)
                await db.commit()
        try: loop.run_until_complete(_go())
        finally: loop.close()
    threading.Thread(target=_run, daemon=True).start()
    return {"ok": True, "message": "Recalcul lancé en arrière-plan"}


@router.post("/groups/{group_id}/photos/upload")
async def upload_group_photo(
    group_id: int, file: UploadFile = File(...), _: str = Depends(get_current_user),
):
    gallery_touched()
    import subprocess as _sp, tempfile as _tf, os as _os
    is_video = bool(file.content_type and file.content_type.startswith("video/"))
    if not file.content_type or not (file.content_type.startswith("image/") or is_video):
        raise HTTPException(400, "Fichier image ou vidéo requis")
    d = DATA_DIR / "groups" / str(group_id)
    d.mkdir(parents=True, exist_ok=True)
    raw = await file.read()
    orig_ext = (file.filename or ("video.mp4" if is_video else "photo.jpg")).rsplit(".", 1)[-1].lower()
    if is_video:
        n = len(list(d.glob("Photo-*"))) + 1
        dest = d / f"Photo-{n:02d}.webp"
        try:
            with _tf.NamedTemporaryFile(delete=False, suffix="." + orig_ext) as tmp:
                tmp.write(raw); tmp_path = tmp.name
            # Hors de la boucle : ffmpeg sur une grosse video prend des minutes,
            # et un appel bloquant figeait TOUT le serveur pendant ce temps.
            await asyncio.to_thread(_sp.run, [
                "ffmpeg", "-y", "-i", tmp_path, "-t", "30",
                "-vf", "fps=15,scale='min(720,iw)':-1:flags=lanczos",
                "-an", "-loop", "0", "-c:v", "libwebp",
                "-q:v", "55", "-compression_level", "5", "-preset", "picture", str(dest)
            ], check=True, capture_output=True, timeout=300)
            _os.unlink(tmp_path)
        except Exception:
            ext = orig_ext if orig_ext in ("mp4", "webm", "mov", "m4v") else "mp4"
            dest = d / f"Video-{n:02d}.{ext}"
            dest.write_bytes(raw)
    else:
        n = len(list(d.glob("Photo-*"))) + 1
        dest = d / f"Photo-{n:02d}.webp"
        try:
            with _tf.NamedTemporaryFile(delete=False, suffix="." + orig_ext) as tmp:
                tmp.write(raw); tmp_path = tmp.name
            await asyncio.to_thread(_sp.run, ["ffmpeg","-y","-i",tmp_path,
                     "-vf","scale='min(800,iw)':'min(800,ih)':force_original_aspect_ratio=decrease",
                     "-quality","80","-compression_level","6",str(dest)],
                    check=True, capture_output=True, timeout=30)
            _os.unlink(tmp_path)
        except Exception:
            dest = d / f"Photo-{n:02d}.{orig_ext}"; dest.write_bytes(raw)
    return {"ok": True, "name": dest.name, "url": f"/api/v1/prints/groups/{group_id}/photo/{dest.name}"}


@router.post("/groups/{group_id}/photo/{filename}/cover")
async def set_group_cover_photo(group_id: int, filename: str, _: str = Depends(get_current_user)):
    gallery_touched()
    """
    Choisit la photo affichee en vignette dans la galerie pour ce groupe.
    Stocke juste le nom de fichier ; la galerie remonte cette photo en tete.
    """
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    path = DATA_DIR / "groups" / str(group_id) / filename
    if not path.exists():
        raise HTTPException(404, "Photo introuvable")
    async with AsyncSessionLocal() as db:
        g = await db.get(Group, group_id)
        if not g:
            raise HTTPException(404, "Groupe introuvable")
        g.cover_photo = filename
        await db.commit()
    return {"ok": True, "cover_photo": filename}


@router.delete("/groups/{group_id}/photo/{filename}")
async def delete_group_photo_ep(group_id: int, filename: str, _: str = Depends(get_current_user)):
    gallery_touched()
    if ".." in filename or "/" in filename: raise HTTPException(400)
    path = DATA_DIR / "groups" / str(group_id) / filename
    if not path.exists(): raise HTTPException(404)
    path.unlink()
    # Si on vient de supprimer la photo qui servait de couverture, on oublie la
    # reference : sinon la galerie chercherait un fichier disparu.
    async with AsyncSessionLocal() as db:
        g = await db.get(Group, group_id)
        if g and g.cover_photo == filename:
            g.cover_photo = None
            await db.commit()
    return {"ok": True}


# ── Filament Usage — mapping bobine et ajustement poids ─────────────────────
from ....models.print_history import FilamentUsage as _FU

@router.patch("/{print_id}/filament-usage/{usage_id}")
async def patch_filament_usage(
    print_id: int, usage_id: int,
    body: dict = Body({}),
    _: str = Depends(get_current_user),
):
    """Mettre à jour spool_id ou grams_used d'un FilamentUsage."""
    allowed = {"spool_id", "grams_used"}
    updates = {k: v for k, v in body.items() if k in allowed}
    async with AsyncSessionLocal() as db:
        fu = (await db.execute(
            select(_FU).where(_FU.id == usage_id, _FU.print_id == print_id)
        )).scalar_one_or_none()
        if not fu: raise HTTPException(404)
        for k, v in updates.items():
            setattr(fu, k, v)

        # Mapper une bobine sur ce print, c'est declarer qu'elle a servi. On met a
        # jour last_used_at UNIQUEMENT si la date de ce print est plus recente que
        # l'actuelle (remapper un vieux print ne doit pas faire regresser la date),
        # et seulement si l'usage represente une vraie consommation (grams > 0).
        # On ne touche PAS au poids ici (comportement inchange).
        if updates.get("spool_id") and (fu.grams_used or 0) > 0:
            from ....models.filament import Spool
            spool = await db.get(Spool, updates["spool_id"])
            pr = await db.get(Print, print_id)
            used_dt = (pr.print_date if pr and pr.print_date else None)
            if spool and used_dt and (spool.last_used_at is None or used_dt > spool.last_used_at):
                spool.last_used_at = used_dt
        await db.commit()
    if updates.get("spool_id"):
        from ....core.mqtt import clear_match_cache
        clear_match_cache()
    return {"ok": True}


@router.post("/{print_id}/restore-weights")
async def restore_spool_weights(
    print_id: int,
    body: dict = Body({}),
    _: str = Depends(get_current_user),
):
    """
    Restitue tout ou partie des grammes consommés aux bobines non archivées.
    body: { "fraction": 1.0 }  (1.0 = 100%, 0.5 = 50%)
    """
    from ....models.filament import Spool
    fracs = body.get("fracs", {})
    restored = []
    async with AsyncSessionLocal() as db:
        usages = (await db.execute(
            select(_FU).where(_FU.print_id == print_id, _FU.spool_id.isnot(None))
        )).scalars().all()
        for fu in usages:
            fraction = float(fracs.get(str(fu.id), fracs.get(fu.id, 0)))
            fraction = max(0.0, min(1.0, fraction))
            if fraction <= 0: continue
            spool = await db.get(Spool, fu.spool_id)
            if not spool or spool.archived: continue
            add_g = round((fu.grams_used or 0) * fraction, 1)
            spool.remaining_weight_g = round((spool.remaining_weight_g or 0) + add_g, 1)
            fu.grams_used = round(max(0, (fu.grams_used or 0) - add_g), 1)
            restored.append({"spool_id": fu.spool_id, "added_g": add_g, "usage_id": fu.id})
        if restored:
            # Les grammes consommes ont baisse : le poids et le cout du print (et des
            # objets qui en derivent) suivent, sinon l'en-tete gardait l'ancien total.
            from ....services.print_tracker import _costs as _calc_costs
            await db.flush()
            pr = await db.get(Print, print_id)
            if pr:
                await _calc_costs(db, pr)
                await _propagate_from_print(db, print_id)
        await db.commit()
    # Le poids restant des bobines vient de changer : sans ca, l'accueil
    # continuait d'afficher l'ancienne valeur jusqu'a la prochaine mutation
    # passant par filaments.py -- il fallait enregistrer une bobine pour rien,
    # juste pour forcer le vidage.
    if restored:
        from ....core.mqtt import clear_match_cache
        clear_match_cache()
    return {"ok": True, "restored": restored}


async def _propagate_object_costs(db, parent_type: str, parent_id: int):
    """Repercute le cout courant d'un print/groupe sur les objets qui en derivent.

    Meme formule qu'a la creation (objects.create_objects / ObjectCreateSheet) :
      - objet depuis un PRINT  : cout = filament + electricite du print (cout plein) ;
      - objet depuis un GROUPE : cout = somme des total_cost des membres / number_of_items.
    normal_cost_unit est peuple au passage (cout au prix normal catalogue). Le cout
    accessoire propre a chaque objet est conserve.
    """
    from ....models.object_history import Object
    if parent_type == "print":
        pr = await db.get(Print, parent_id)
        if not pr:
            return
        fab    = (pr.total_cost_filament or 0) + (pr.electric_cost or 0)
        normal = (pr.total_cost_filament_normal or 0) + (pr.electric_cost or 0)
    elif parent_type == "group":
        g = await db.get(Group, parent_id)
        if not g:
            return
        members = (await db.execute(select(Print).where(Print.group_id == parent_id))).scalars().all()
        nb = max(1, g.number_of_items or 1)
        fab    = sum((m.total_cost or 0) for m in members) / nb
        normal = sum(((m.total_cost_filament_normal or 0) + (m.electric_cost or 0)) for m in members) / nb
    else:
        return
    objs = (await db.execute(
        select(Object).where(Object.parent_type == parent_type, Object.parent_id == parent_id)
    )).scalars().all()
    for o in objs:
        o.cost_fabrication = round(fab, 4)
        o.normal_cost_unit = round(normal, 4)
        o.cost_total = round(fab + (o.cost_accessory or 0), 4)


async def _propagate_from_print(db, print_id: int):
    """Un changement de cout sur un print touche ses propres objets ET, s'il est
    dans un groupe, les objets du groupe (leur part depend de ses membres)."""
    pr = await db.get(Print, print_id)
    if not pr:
        return
    await _propagate_object_costs(db, "print", print_id)
    if pr.group_id:
        await _propagate_object_costs(db, "group", pr.group_id)


@router.post("/{print_id}/recalc-costs")
async def recalc_print_costs(print_id: int, _: str = Depends(get_current_user)):
    """Recalcule les coûts filament + électricité d'un print."""
    from ....services.print_tracker import _costs as _calc_costs
    async with AsyncSessionLocal() as db:
        from sqlalchemy.orm import selectinload as _sil
        p = (await db.execute(
            select(Print).where(Print.id == print_id)
            .options(_sil(Print.filament_usage))
        )).scalar_one_or_none()
        if not p: raise HTTPException(404)
        await _calc_costs(db, p)
        await _propagate_from_print(db, print_id)   # repercuter sur les objets lies
        await db.commit()
    return {"ok": True}


@router.get("/groups/{group_id}/3mf")
async def group_3mf(group_id: int, kind: str = Query("sliced", pattern="^(sliced|source)$"), _: str = Depends(get_current_user)):
    """Les 3MF des impressions d'un groupe (29/10/2026) : un seul fichier s'ils sont tous identiques (meme profil
    d'origine, ou meme fichier tranche), sinon un zip qui les reunit, un par fichier different."""
    import hashlib
    import re as _re
    import tempfile
    import zipfile
    from starlette.background import BackgroundTask
    from ....services.mw_source import print_file
    from ....services.archive import local_or_archive
    async with AsyncSessionLocal() as db:
        g = await db.get(Group, group_id)
        if not g:
            raise HTTPException(404, "Groupe introuvable")
        prints = (await db.execute(select(Print).where(Print.group_id == group_id).order_by(Print.print_date))).scalars().all()
    suffix = " (MakerWorld)" if kind == "source" else " (tranché)"
    clean = lambda t: _re.sub(r'[\\/:*?"<>|]+', "_", (t or "").strip())[:120]

    def collect():
        seen, out = {}, []
        for p in prints:
            f = print_file(p.design_id, p.mw_profile_id, p.mw_plates) if kind == "source" else \
                (local_or_archive(p.model_3mf) if p.model_3mf else None)
            if not f or not f.is_file():
                continue
            # le meme contenu (meme fichier, ou meme plateau tranche deux fois) : une seule fois
            h = hashlib.sha1()
            with open(f, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            k = h.hexdigest()
            if k in seen:
                continue
            seen[k] = True
            out.append((f, clean(p.translated_name or p.file_name or f"impression-{p.id}")))
        return out
    files = await asyncio.to_thread(collect)
    if not files:
        raise HTTPException(404, "Pas de 3MF pour ce groupe")
    if len(files) == 1:
        f, name = files[0]
        return FileResponse(str(f), media_type="application/vnd.ms-package.3dmanufacturing-3dmodel+xml", filename=f"{name}{suffix}.3mf")

    def build():
        tmp = tempfile.NamedTemporaryFile(prefix="groupe-3mf-", suffix=".zip", dir=str(DATA_DIR / "cache"), delete=False)
        used = {}
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:          # un 3MF est deja compresse
            for f, name in files:
                n = used.get(name, 0)
                used[name] = n + 1
                z.write(str(f), f"{name}{f' ({n + 1})' if n else ''}{suffix}.3mf")
        tmp.close()
        return tmp.name
    (DATA_DIR / "cache").mkdir(parents=True, exist_ok=True)
    path = await asyncio.to_thread(build)
    return FileResponse(path, media_type="application/zip", filename=f"{clean(g.name) or 'groupe'}{suffix}.zip",
                        background=BackgroundTask(lambda: Path(path).unlink(missing_ok=True)))


# ── Les vignettes prises dans la vue 3D (29/10/2026 ; jusqu'a 4 depuis le 30/10) ──
# Vue3D.png (la 1), Vue3D_2.png … Vue3D_4.png ; thumb_3d dit laquelle sert de vignette (0 : celle par defaut)
VUE3D = "Vue3D.png"
V3_MAX = 4
_V3RE = re.compile(r"Vue3D(_[2-4]|_mix\d+)?\.png")
# plusieurs vues choisies ensemble (30/10/2026) : thumb_3d = 16 + masque (bit n-1 pour la vue n) ; 1 a 4 : une seule
V3_MULTI = 16


def _v3name(n: int) -> str:
    return VUE3D if n == 1 else f"Vue3D_{n}.png"


def _v3sel(val, sl: dict) -> list:
    """Les vues choisies comme vignette, parmi celles gardees."""
    val = int(val or 0)
    ns = [n for n in range(1, V3_MAX + 1) if (val - V3_MULTI) >> (n - 1) & 1] if val >= V3_MULTI else [val]
    return [n for n in ns if n in sl]


def _v3val(ns: list) -> int:
    ns = sorted({int(n) for n in ns if 1 <= int(n) <= V3_MAX})
    if not ns:
        return 0
    return ns[0] if len(ns) == 1 else V3_MULTI + sum(1 << (n - 1) for n in ns)


def _v3cover(folder: Path, val) -> tuple:
    """(nom du fichier qui sert de vignette, sa date) ; (None, None) : la vignette par defaut. Plusieurs vues : une
    mosaique faite ici (refaite quand une de ses vues change)."""
    sl = _v3slots(folder)
    ns = _v3sel(val, sl)
    if not ns:
        return None, None
    if len(ns) == 1:
        return _v3name(ns[0]), sl[ns[0]]
    mask = sum(1 << (n - 1) for n in ns)
    f = folder / f"Vue3D_mix{mask}.png"
    try:
        if f.stat().st_mtime >= max(sl[n] for n in ns):
            return f.name, int(f.stat().st_mtime)
    except OSError:
        pass
    try:
        from PIL import Image
        S = 1024
        out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        # 2 : cote a cote ; 3 : deux en haut, une en bas ; 4 : en carre
        boxes = {2: [(0, S // 4, S // 2), (S // 2, S // 4, S // 2)],
                 3: [(0, 0, S // 2), (S // 2, 0, S // 2), (S // 4, S // 2, S // 2)]}.get(len(ns)) \
            or [(0, 0, S // 2), (S // 2, 0, S // 2), (0, S // 2, S // 2), (S // 2, S // 2, S // 2)]
        for n, (x, y, w) in zip(ns, boxes):
            im = Image.open(folder / _v3name(n)).convert("RGBA")
            im.thumbnail((w, w))
            out.alpha_composite(im, (x + (w - im.width) // 2, y + (w - im.height) // 2))
        for old in folder.glob("Vue3D_mix*.png"):
            old.unlink(missing_ok=True)
        tmp = folder / (f.name + ".part")
        out.save(tmp, "PNG")
        os.replace(tmp, f)
        return f.name, int(f.stat().st_mtime)
    except Exception as e:
        logging.getLogger(__name__).info(f"[VUE3D] mosaique de {folder} : {e}")
        return _v3name(ns[0]), sl[ns[0]]


def _v3slots(folder: Path) -> dict:
    """{numero: date} des vues 3D gardees dans ce dossier."""
    out = {}
    for n in range(1, V3_MAX + 1):
        try:
            out[n] = int((folder / _v3name(n)).stat().st_mtime)
        except OSError:
            pass
    return out


async def _save_vue3d(folder: Path, file: UploadFile, slot: int = 0) -> int:
    """Range la vue : a la place demandee (elle remplace l'ancienne), sinon a la premiere libre. Rend son numero."""
    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024 or not raw.startswith(b"\x89PNG"):
        raise HTTPException(400, "Image PNG attendue")
    have = _v3slots(folder)
    if not 1 <= slot <= V3_MAX:
        slot = next((n for n in range(1, V3_MAX + 1) if n not in have), 0)
        if not slot:
            raise HTTPException(400, f"Déjà {V3_MAX} vues 3D : choisis celle à remplacer")
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / (_v3name(slot) + ".part")
    tmp.write_bytes(raw)
    os.replace(tmp, folder / _v3name(slot))
    gallery_touched()
    return slot


def _v3list(kind: str, ident: int, folder: Path, chosen: int) -> dict:
    base = f"/api/v1/prints/{ident}/file" if kind == "print" else f"/api/v1/prints/groups/{ident}/photo"
    sl = _v3slots(folder)
    sel = _v3sel(chosen, sl)
    name, v = _v3cover(folder, chosen)
    return {"max": V3_MAX, "chosen": sel[0] if sel else 0, "sel": sel, "cover": {"name": name, "v": v} if name else None,
            "slots": [{"n": n, "url": f"{base}/{_v3name(n)}?v={v}"} for n, v in sorted(sl.items())]}


@router.get("/{print_id}/vue3d")
async def print_vue3d_list(print_id: int, _: str = Depends(get_current_user)):
    """Les vues 3D gardees pour cette impression, et celle qui sert de vignette."""
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p:
            raise HTTPException(404, "Impression introuvable")
        return _v3list("print", print_id, DATA_DIR / "prints" / str(print_id), p.thumb_3d or 0)


@router.get("/groups/{group_id}/vue3d")
async def group_vue3d_list(group_id: int, _: str = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        g = await db.get(Group, group_id)
        if not g:
            raise HTTPException(404, "Groupe introuvable")
        return _v3list("group", group_id, DATA_DIR / "groups" / str(group_id), g.thumb_3d or 0)


@router.post("/{print_id}/vue3d")
async def print_vue3d(print_id: int, file: UploadFile = File(...), slot: int = Form(0), _: str = Depends(require_admin)):
    """Garde une vue prise dans la vue 3D de cette impression (slot : celle a remplacer)."""
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p:
            raise HTTPException(404, "Impression introuvable")
        n = await _save_vue3d(DATA_DIR / "prints" / str(print_id), file, slot)
        p.updated_at = datetime.utcnow()                 # les vignettes en cache se renouvellent
        await db.commit()
    return {"ok": True, "n": n}


@router.post("/groups/{group_id}/vue3d")
async def group_vue3d(group_id: int, file: UploadFile = File(...), slot: int = Form(0), _: str = Depends(require_admin)):
    """Garde une vue prise dans la vue 3D de ce groupe."""
    async with AsyncSessionLocal() as db:
        if not await db.get(Group, group_id):
            raise HTTPException(404, "Groupe introuvable")
    n = await _save_vue3d(DATA_DIR / "groups" / str(group_id), file, slot)
    return {"ok": True, "n": n}


@router.delete("/{print_id}/vue3d/{n}")
async def print_vue3d_drop(print_id: int, n: int, _: str = Depends(require_admin)):
    """Supprime une vue 3D ; si c'etait la vignette, l'impression revient a l'image du plateau."""
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p or not 1 <= n <= V3_MAX:
            raise HTTPException(404, "Vue introuvable")
        folder = DATA_DIR / "prints" / str(print_id)
        (folder / _v3name(n)).unlink(missing_ok=True)
        p.thumb_3d = _v3val(_v3sel(p.thumb_3d, _v3slots(folder)))
        p.updated_at = datetime.utcnow()
        await db.commit()
    gallery_touched()
    return {"ok": True}


@router.delete("/groups/{group_id}/vue3d/{n}")
async def group_vue3d_drop(group_id: int, n: int, _: str = Depends(require_admin)):
    async with AsyncSessionLocal() as db:
        g = await db.get(Group, group_id)
        if not g or not 1 <= n <= V3_MAX:
            raise HTTPException(404, "Vue introuvable")
        folder = DATA_DIR / "groups" / str(group_id)
        (folder / _v3name(n)).unlink(missing_ok=True)
        g.thumb_3d = _v3val(_v3sel(g.thumb_3d, _v3slots(folder)))
        await db.commit()
    gallery_touched()
    return {"ok": True}


def _slot_of(body: dict, folder: Path) -> int:
    """Les vues choisies : « slots » (plusieurs : une mosaique ; vide : la vignette par defaut), ou « slot » (0 = par
    defaut) ; « use3d » (ancien appel) : la premiere."""
    sl = _v3slots(folder)
    if isinstance(body.get("slots"), list):
        ns = [int(x) for x in body["slots"] if str(x).isdigit()]
    else:
        n = int(body["slot"]) if str(body.get("slot", "")).lstrip("-").isdigit() else (min(sl) if sl and body.get("use3d") else 0)
        ns = [n] if n else []
    if any(n not in sl for n in ns):
        raise HTTPException(400, "Prends d'abord cette vue dans la vue 3D")
    return _v3val(ns)


@router.put("/{print_id}/thumb")
async def print_thumb(print_id: int, body: dict = Body({}), _: str = Depends(require_admin)):
    """La vignette de l'impression : une de ses vues 3D (slot), ou l'image du plateau (0)."""
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if not p:
            raise HTTPException(404, "Impression introuvable")
        n = _slot_of(body, DATA_DIR / "prints" / str(print_id))
        p.thumb_3d = n
        p.updated_at = datetime.utcnow()
        await db.commit()
    gallery_touched()
    return {"ok": True, "thumb_3d": n}


@router.put("/groups/{group_id}/thumb")
async def group_thumb(group_id: int, body: dict = Body({}), _: str = Depends(require_admin)):
    """La vignette du groupe : une de ses vues 3D (slot), ou la mosaique de ses impressions (0)."""
    async with AsyncSessionLocal() as db:
        g = await db.get(Group, group_id)
        if not g:
            raise HTTPException(404, "Groupe introuvable")
        n = _slot_of(body, DATA_DIR / "groups" / str(group_id))
        g.thumb_3d = n
        await db.commit()
    gallery_touched()
    return {"ok": True, "thumb_3d": n}


@router.get("/{print_id}/3mf")
async def print_3mf(print_id: int, kind: str = Query("sliced", pattern="^(sliced|source)$"), _: str = Depends(get_current_user)):
    """Le 3MF d'une impression : « sliced » celui tranche pour mon imprimante (garde au lancement),
    « source » celui d'origine MakerWorld (le projet du profil, a retrancher)."""
    import re as _re
    from ....services.mw_source import print_file
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
    if not p:
        raise HTTPException(404, "Impression introuvable")
    if kind == "source":
        f = print_file(p.design_id, p.mw_profile_id, p.mw_plates)
        suffix = " (MakerWorld)"
    else:
        from ....services.archive import local_or_archive
        f = local_or_archive(p.model_3mf) if p.model_3mf else None     # vide du local : relu sur le NAS
        suffix = " (tranché)"
    if not f or not f.is_file():
        raise HTTPException(404, "Pas de 3MF pour cette impression")
    name = _re.sub(r'[\\/:*?"<>|]+', "_", (p.translated_name or p.file_name or f"impression-{print_id}").strip())[:120]
    return FileResponse(str(f), media_type="application/vnd.ms-package.3dmanufacturing-3dmodel+xml", filename=f"{name}{suffix}.3mf")
