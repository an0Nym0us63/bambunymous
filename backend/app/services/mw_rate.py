"""
« À évaluer » : mes impressions terminées de modèles MakerWorld que je n'ai pas
encore évaluées, avec les photos de l'impression (ou, à défaut, de son groupe)
pour les joindre à l'évaluation.

Mes évaluations déjà publiées : comment-service/rating/my (compte connecté).
Sans compte connecté, la liste montre toutes les impressions (rien d'exclu).
"""
import asyncio
import logging
import time

logger = logging.getLogger(__name__)

RATED = "/comment-service/rating/my?offset={offset}&limit=50"
_CACHE = {}


def _design_id(h) -> str:
    """Modele d'une de mes evaluations (formes possibles de l'API)."""
    if not isinstance(h, dict):
        return None
    for k in ("designId", "design_id", "modelDesignId"):
        if str(h.get(k) or "").isdigit():
            return str(h[k])
    for k in ("design", "ratingItem", "rating"):
        sub = h.get(k)
        if isinstance(sub, dict):
            d = _design_id(sub) or (str(sub.get("id")) if k == "design" and str(sub.get("id") or "").isdigit() else None)
            if d:
                return d
    return None


async def rated_designs(fresh: bool = False):
    """Modeles que j'ai deja evalues ; None si la liste est illisible (pas de compte...)."""
    from .makerworld import _get_json
    from .makerworld_account import token
    hit = _CACHE.get("rated")
    if hit and not fresh and time.time() - hit[0] < 1800:
        return hit[1]
    tok = await token()
    if not tok:
        return None
    out, off = set(), 0
    for _ in range(20):
        code, d = await asyncio.to_thread(_get_json, RATED.format(offset=off), tok)
        if not isinstance(d, dict):
            return None if off == 0 else out
        hits = d.get("hits") if isinstance(d.get("hits"), list) else d.get("list") if isinstance(d.get("list"), list) else []
        out |= {x for x in (_design_id(h) for h in hits) if x}
        if len(hits) < 50:
            break
        off += 50
    _CACHE["rated"] = (time.time(), out)
    return out


async def own_designs():
    """Mes propres modeles (on n'evalue pas ce qu'on a publie) : mon uid et la
    liste de mes modeles publies. Vide si le compte n'est pas connecte."""
    uid, ids = None, set()
    try:
        from .makerworld_account import _my_uid
        uid = await _my_uid()
    except Exception:
        return None, ids
    try:
        from . import mw_creator
        ids = {str(m["design_id"]) for m in await mw_creator.models()}
    except Exception:
        logger.exception("[MW] mes modeles (a evaluer)")
    return uid, ids


async def to_rate(fresh: bool = False) -> dict:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, MakerWorldDesign as MW
    from ..api.v1.routes.filaments import gallery_items
    from .makerworld_account import DONE_STATUSES
    rated = await rated_designs(fresh)
    my_uid, mine = await own_designs()
    async with AsyncSessionLocal() as db:
        prints = (await db.execute(
            select(Print).options(selectinload(Print.snapshots), selectinload(Print.group))
            .where(Print.design_id.isnot(None), Print.status.in_(DONE_STATUSES))
            .order_by(Print.print_date.desc()))).scalars().all()
        prints = [p for p in prints if str(p.design_id or "").strip().isdigit()]
        if rated:
            prints = [p for p in prints if str(p.design_id) not in rated]
        prints = [p for p in prints if str(p.design_id) not in mine]
        if my_uid and prints:                       # mes modeles absents de la liste publiee (createur connu)
            own = {m.design_id for m in (await db.execute(select(MW).where(
                MW.design_id.in_(list({str(p.design_id) for p in prints})), MW.creator_uid == my_uid))).scalars().all()}
            prints = [p for p in prints if str(p.design_id) not in own]
        if not prints:
            return {"items": [], "rated_known": rated is not None}
        gal = await gallery_items(db, prints, {})
        ids = list({str(p.design_id) for p in prints})
        mws = {m.design_id: m for m in (await db.execute(select(MW).where(MW.design_id.in_(ids)))).scalars().all()}
    by_print = {it["id"]: it for it in gal["prints"]}
    items = {}
    for p in prints:
        did = str(p.design_id)
        g = by_print.get(p.id) or {}
        it = items.get(did)
        if it is None:
            m = mws.get(did)
            it = items[did] = {"design_id": did, "title": (m.title_fr or m.title) if m else None,
                               "cover_url": m.cover_url if m else None,
                               "creator_name": m.creator_name if m else None,
                               "url": f"https://makerworld.com/fr/models/{did}", "printed": 0,
                               "last_date": p.print_date.isoformat() if p.print_date else None,
                               "photos": [], "photo_source": None, "print_ids": []}
        it["printed"] += 1
        it["print_ids"].append(p.id)
        # Photos : celles du print le plus recent qui en a ; sinon celles de son groupe.
        if not it["photos"] and g.get("photos"):
            it["photos"], it["photo_source"] = g["photos"][:8], g.get("photo_source")
            it["print_name"] = g.get("name")
    out = sorted(items.values(), key=lambda x: x["last_date"] or "", reverse=True)
    out.sort(key=lambda x: not x["photos"])                 # avec photos d'abord, puis les plus recents
    return {"items": out, "rated_known": rated is not None}
