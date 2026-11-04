"""
La vitrine (04/11/2026) : un portfolio public de mes plus belles impressions, a envoyer par un lien -- un grand carrousel
des pieces phares, la collection, et (au choix) les objets a vendre. Je choisis les pieces (impressions ou groupes qui ont
des photos, dans la galerie), leur ordre, celles du carrousel et un mot pour chacune ; la page publique ne montre que
ca, sans aucun cout, et suit mes photos en direct. Le lien est revocable.
"""
import html as _html
import json
import re

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select

from ....db.session import AsyncSessionLocal
from ....services import public_links as PL
from .auth import get_current_user, require_admin

router = APIRouter()
KEY = "SHOWCASE"
ACCENTS = ("#C9A96E", "#E5E7EB", "#F472B6", "#60A5FA", "#34D399", "#F59E0B", "#A78BFA", "#F87171")
_ITEM = re.compile(r"^[pg]\d{1,9}$")
DEFAULT = {"title": "Ma vitrine", "tagline": "Des objets imprimés en 3D, pièce par pièce", "accent": ACCENTS[0],
           "contact": "", "show_sale": False, "show_credit": True, "items": []}


async def _load() -> dict:
    from ....services.settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return {**DEFAULT, **(d if isinstance(d, dict) else {})}


async def _save(d: dict) -> None:
    from ....services.settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(d, ensure_ascii=False))


def _clean(body: dict, cur: dict) -> dict:
    out = dict(cur)
    if "title" in body:
        out["title"] = str(body.get("title") or "")[:80].strip() or DEFAULT["title"]
    if "tagline" in body:
        out["tagline"] = str(body.get("tagline") or "")[:160].strip()
    if "accent" in body and re.fullmatch(r"#[0-9A-Fa-f]{6}", str(body.get("accent") or "")):
        out["accent"] = body["accent"]
    if "contact" in body:
        out["contact"] = str(body.get("contact") or "")[:200].strip()
    for k in ("show_sale", "show_credit"):
        if k in body:
            out[k] = bool(body[k])
    if isinstance(body.get("items"), list):
        seen, items = set(), []
        for it in body["items"][:120]:
            if not isinstance(it, dict) or not _ITEM.match(str(it.get("k") or "")) or it["k"] in seen:
                continue
            seen.add(it["k"])
            items.append({"k": it["k"], "featured": bool(it.get("featured")), "note": str(it.get("note") or "")[:400].strip()})
        out["items"] = items
    return out


async def _out(d: dict) -> dict:
    t, v = await PL.find("showcase", None)
    return {**d, "token": t, "path": f"/vitrine/{t}" if t else None, "expires": (v or {}).get("expires"),
            "expired": bool(v and PL.expired(v)), "views": (v or {}).get("views") or 0, "accents": ACCENTS}


@router.get("")
async def showcase_get(_: str = Depends(get_current_user)):
    return await _out(await _load())


@router.put("")
async def showcase_put(body: dict = Body({}), _: str = Depends(require_admin)):
    d = _clean(body or {}, await _load())
    await _save(d)
    t, _v = await PL.find("showcase", None)
    if t:                                             # le titre du lien suit celui de la vitrine
        await PL.put("showcase", None, d["title"])
    return await _out(d)


@router.post("/link")
async def showcase_link(body: dict = Body({}), _: str = Depends(require_admin)):
    """Le lien public, dans le registre des liens publics (cree au premier appel, le meme ensuite). days : sa duree
    (0 : sans fin ; absent : celle du lien existant)."""
    d = await _load()
    t, _v = await PL.put("showcase", None, d["title"], None, (body or {}).get("days", "keep"))
    return {"token": t, "path": f"/vitrine/{t}"}


@router.delete("/link")
async def showcase_unlink(_: str = Depends(require_admin)):
    """Retire le lien : la vitrine ne s'ouvre plus (un nouveau lien pourra etre cree)."""
    t, _v = await PL.find("showcase", None)
    if t:
        await PL.remove(t)
    return {"ok": True}


@router.get("/public/{token}")
async def showcase_public(token: str):
    """La vitrine, sans compte (le lien est la cle) : seulement les pieces choisies, leurs photos, la date (mois), les
    couleurs de filament, le modele et son createur (si le credit est voulu), le mot ; jamais un cout."""
    from ....models.print_history import Print, Group, FilamentUsage, MakerWorldDesign as MW
    from ....models.object_history import Object
    from .prints import _build_gallery
    if not await PL.open_(token, ("showcase",)):
        raise HTTPException(404, "Cette vitrine n'existe pas, a expiré ou a été retirée")
    d = await _load()
    gal = await _build_gallery("photos")
    by = {f"p{p['id']}": p for p in gal.get("prints") or []}
    by.update({f"g{g['id']}": g for g in gal.get("groups") or []})
    keys = [it for it in d["items"] if it["k"] in by]
    pids = {}
    for it in keys:
        g = by[it["k"]]
        pids[it["k"]] = g.get("print_ids") or [g["id"]]
    allp = sorted({p for v in pids.values() for p in v})
    async with AsyncSessionLocal() as db:
        meta = {r.id: r for r in (await db.execute(select(Print.id, Print.translated_name, Print.file_name, Print.print_date, Print.design_id)
                                                   .where(Print.id.in_(allp)))).all()} if allp else {}
        cols: dict = {}
        if allp:
            for pid, hx, g in (await db.execute(select(FilamentUsage.print_id, FilamentUsage.color_hex, FilamentUsage.grams_used)
                                                .where(FilamentUsage.print_id.in_(allp)))).all():
                h = str(hx or "").lstrip("#").upper()[:6]
                if len(h) == 6:
                    cols.setdefault(pid, {})
                    cols[pid][h] = cols[pid].get(h, 0) + float(g or 0)
        dids = {str(m.design_id).strip() for m in meta.values() if str(m.design_id or "").strip()}
        mws = {m.design_id: m for m in (await db.execute(select(MW).where(MW.design_id.in_(dids)))).scalars().all()} if dids else {}
        sale = []
        if d.get("show_sale"):
            for o in (await db.execute(select(Object.id, Object.name, Object.translated_name, Object.desired_price)
                                       .where(Object.status == "available", Object.personal.isnot(True), Object.desired_price > 0)
                                       .order_by(Object.created_at.desc()).limit(60))).all():
                sale.append({"id": o.id, "title": o.translated_name or o.name, "price": round(float(o.desired_price), 2),
                             "img": f"/api/v1/objects/objects/{o.id}/image"})
    items = []
    for it in keys:
        g, ps = by[it["k"]], pids[it["k"]]
        group = it["k"][0] == "g"
        first = meta.get(ps[0])
        title = g.get("name") if group else ((first.translated_name or first.file_name) if first else g.get("title"))
        dates = [meta[p].print_date for p in ps if p in meta and meta[p].print_date]
        agg: dict = {}
        for p in ps:
            for h, w in (cols.get(p) or {}).items():
                agg[h] = agg.get(h, 0) + w
        did = next((str(meta[p].design_id).strip() for p in ps if p in meta and str(meta[p].design_id or "").strip()), None)
        m = mws.get(did) if did else None
        cats = [c.strip() for c in (m.categories or "").split(",") if c.strip()][:3] if m else []
        items.append({"key": it["k"], "kind": "group" if group else "print", "title": _html.unescape(title or "Sans nom"),
                      "date": max(dates).strftime("%Y-%m") if dates else None, "featured": it["featured"], "note": it["note"],
                      "photos": [ph["url"] for ph in g.get("photos") or [] if not str(ph.get("url", "")).lower().split("?")[0].endswith((".mp4", ".webm", ".mov", ".m4v"))][:24],
                      "colors": [h for h, _w in sorted(agg.items(), key=lambda x: -x[1])[:8]], "count": len(ps) if group else 1,
                      "categories": cats,
                      "model": ({"title": _html.unescape(m.title_fr or m.title or ""), "creator": m.creator_name,
                                 "url": f"https://makerworld.com/fr/models/{did}"} if m and d.get("show_credit") else None)})
    return {"title": d["title"], "tagline": d["tagline"], "accent": d["accent"], "contact": d["contact"], "items": items, "sale": sale}
