"""
Les vitrines (04/11/2026) : des portfolios publics de mes plus belles impressions, a envoyer par un lien -- un grand
carrousel des pieces phares, la collection, et (au choix) les objets a vendre. Plusieurs vitrines, chacune nommee, avec
son lien a elle. Les pieces (impressions ou groupes qui ont des photos, dans la galerie) viennent de deux sources :
celles que je choisis (dans mon ordre, avec ★ carrousel et un mot), et des regles (toutes mes pieces, tout d'un
createur, d'un modele, d'une categorie, d'une annee, les groupes ou les impressions seules) qui suivent la galerie en
direct, la plus recente d'abord ; une piece amenee par une regle peut etre exclue. La page publique ne montre que ca,
sans aucun cout. Chaque lien est revocable.

Rangement : SHOWCASES = {"list": [vitrine…]} ; l'ancienne vitrine unique (SHOWCASE) est reprise comme la vitrine « 1 »,
et son lien (ref None dans le registre) la suit.
"""
import html as _html
import json
import re
import secrets
from collections import Counter

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select

from ....db.session import AsyncSessionLocal
from ....services import public_links as PL
from .auth import get_current_user, require_admin

router = APIRouter()
KEY = "SHOWCASES"
OLD_KEY = "SHOWCASE"
ACCENTS = ("#C9A96E", "#E5E7EB", "#F472B6", "#60A5FA", "#34D399", "#F59E0B", "#A78BFA", "#F87171")
_ITEM = re.compile(r"^[pg]\d{1,9}$")
RULES = ("all", "creator", "model", "category", "year", "kind")
DEFAULT = {"title": "Ma vitrine", "tagline": "Des objets imprimés en 3D, pièce par pièce", "accent": ACCENTS[0],
           "contact": "", "show_sale": False, "show_credit": True, "items": [], "rules": [], "exclude": []}


async def _load() -> list:
    from ....services.settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
        old = "" if raw else await get_setting(db, OLD_KEY, "")
    try:
        d = json.loads(raw) if raw else None
    except ValueError:
        d = None
    if isinstance(d, dict) and isinstance(d.get("list"), list):
        return [{**DEFAULT, **s} for s in d["list"] if isinstance(s, dict) and s.get("id")]
    # l'ancienne vitrine unique : reprise comme la vitrine « 1 » (son lien, ref None, la suit)
    try:
        o = json.loads(old) if old else None
    except ValueError:
        o = None
    if isinstance(o, dict):
        lst = [{**DEFAULT, **o, "id": "1"}]
        await _save(lst)
        reg = await PL.load()
        if any(v.get("kind") == "showcase" and v.get("ref") is None for v in reg.values()):
            for v in reg.values():
                if v.get("kind") == "showcase" and v.get("ref") is None:
                    v["ref"] = "1"
            await PL.save(reg)
        return lst
    return []


async def _save(lst: list) -> None:
    from ....services.settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps({"list": lst}, ensure_ascii=False))


def _get(lst: list, sid: str) -> dict:
    s = next((s for s in lst if s["id"] == sid), None)
    if not s:
        raise HTTPException(404, "Cette vitrine n'existe pas")
    return s


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
        for it in body["items"][:400]:
            if not isinstance(it, dict) or not _ITEM.match(str(it.get("k") or "")) or it["k"] in seen:
                continue
            seen.add(it["k"])
            items.append({"k": it["k"], "featured": bool(it.get("featured")), "note": str(it.get("note") or "")[:400].strip()})
        out["items"] = items
    if isinstance(body.get("rules"), list):
        seen, rules = set(), []
        for r in body["rules"][:30]:
            if not isinstance(r, dict) or r.get("t") not in RULES:
                continue
            v = "" if r["t"] == "all" else str(r.get("v") or "")[:200].strip()
            if (r["t"] != "all" and not v) or (r["t"], v) in seen:
                continue
            seen.add((r["t"], v))
            rules.append({"t": r["t"], "v": v, "label": str(r.get("label") or "")[:200].strip()})
        out["rules"] = rules
    if isinstance(body.get("exclude"), list):
        out["exclude"] = sorted({str(k) for k in body["exclude"][:2000] if _ITEM.match(str(k))})
    return out


async def _candidates() -> dict:
    """Les pieces possibles (impressions et groupes de la galerie, qui ont des photos), avec ce que les regles lisent :
    date (la plus recente), modele MakerWorld, createur, categories."""
    from ....models.print_history import Print, MakerWorldDesign as MW
    from .prints import _build_gallery
    gal = await _build_gallery("photos")
    raw = [(f"g{g['id']}", g, g.get("print_ids") or [], True) for g in gal.get("groups") or []]
    raw += [(f"p{p['id']}", p, [p["id"]], False) for p in gal.get("prints") or []]
    allp = sorted({i for _k, _g, ps, _gr in raw for i in ps})
    async with AsyncSessionLocal() as db:
        meta = {r.id: r for r in (await db.execute(select(Print.id, Print.translated_name, Print.file_name, Print.print_date, Print.design_id)
                                                   .where(Print.id.in_(allp)))).all()} if allp else {}
        dids = {str(m.design_id).strip() for m in meta.values() if str(m.design_id or "").strip()}
        mws = {m.design_id: m for m in (await db.execute(select(MW).where(MW.design_id.in_(dids)))).scalars().all()} if dids else {}
    out = {}
    for k, g, ps, group in raw:
        first = meta.get(ps[0]) if ps else None
        title = g.get("name") if group else ((first.translated_name or first.file_name) if first else g.get("title"))
        dates = [meta[p].print_date for p in ps if p in meta and meta[p].print_date]
        dc = Counter(str(meta[p].design_id).strip() for p in ps if p in meta and str(meta[p].design_id or "").strip())
        did = dc.most_common(1)[0][0] if dc else None
        m = mws.get(did) if did else None
        photos = [ph["url"] for ph in g.get("photos") or [] if not str(ph.get("url", "")).lower().split("?")[0].endswith((".mp4", ".webm", ".mov", ".m4v"))]
        out[k] = {"k": k, "group": group, "title": _html.unescape(title or "Sans nom"), "pids": ps, "photos": photos,
                  "date": max(dates).isoformat()[:10] if dates else None, "design": did,
                  "model": _html.unescape(m.title_fr or m.title or "") if m else None, "creator": (m.creator_name or None) if m else None,
                  "categories": [c.strip() for c in (m.categories or "").split(",") if c.strip()] if m else []}
    return out


def _match(r: dict, c: dict) -> bool:
    t, v = r["t"], r.get("v") or ""
    if t == "all":
        return True
    if t == "creator":
        return (c.get("creator") or "").lower() == v.lower()
    if t == "model":
        return c.get("design") == v
    if t == "category":
        return v in (c.get("categories") or [])
    if t == "year":
        return (c.get("date") or "")[:4] == v
    if t == "kind":
        return c["group"] == (v == "group")
    return False


def _resolve(s: dict, cands: dict) -> list:
    """Les pieces de la vitrine, dans l'ordre : celles choisies a la main, puis celles des regles (la plus recente
    d'abord), sans les exclues. Chaque piece : {k, featured, note, auto}."""
    out = [{**it, "auto": False} for it in s.get("items") or [] if it["k"] in cands]
    taken = {it["k"] for it in out} | set(s.get("exclude") or [])
    rules = s.get("rules") or []
    if rules:
        for c in sorted(cands.values(), key=lambda c: c.get("date") or "", reverse=True):
            if c["k"] not in taken and any(_match(r, c) for r in rules):
                out.append({"k": c["k"], "featured": False, "note": "", "auto": True})
    return out


async def _out(s: dict) -> dict:
    t, v = await PL.find("showcase", s["id"])
    return {**s, "token": t, "path": f"/vitrine/{t}" if t else None, "expires": (v or {}).get("expires"),
            "expired": bool(v and PL.expired(v)), "views": (v or {}).get("views") or 0, "accents": ACCENTS}


@router.get("")
async def showcase_list(_: str = Depends(get_current_user)):
    """Toutes les vitrines, avec leur lien, leur nombre de pieces et une photo de couverture."""
    lst = await _load()
    cands = await _candidates() if lst else {}
    out = []
    for s in lst:
        o = await _out(s)
        res = _resolve(s, cands)
        o["count"] = len(res)
        o["cover"] = next((cands[it["k"]]["photos"][0] for it in res if cands[it["k"]]["photos"]), None)
        out.append(o)
    return {"list": out, "accents": ACCENTS}


@router.get("/candidates")
async def showcase_candidates(_: str = Depends(get_current_user)):
    """Les pieces possibles et ce que les regles proposent (createurs, modeles, categories, annees, avec leur nombre)."""
    cands = await _candidates()
    lst = [{**{k: v for k, v in c.items() if k not in ("pids", "photos")}, "photo": c["photos"][0] if c["photos"] else None,
            "n": len(c["photos"]), "prints": len(c["pids"])} for c in sorted(cands.values(), key=lambda c: c.get("date") or "", reverse=True)]
    cr, mo, ca, ye = Counter(), Counter(), Counter(), Counter()
    names = {}
    for c in cands.values():
        if c.get("creator"):
            cr[c["creator"]] += 1
        if c.get("design"):
            mo[c["design"]] += 1
            names[c["design"]] = c.get("model") or c["title"]
        for x in c.get("categories") or []:
            ca[x] += 1
        if c.get("date"):
            ye[c["date"][:4]] += 1
    return {"items": lst, "options": {
        "creator": [{"v": k, "label": k, "n": n} for k, n in cr.most_common()],
        "model": [{"v": k, "label": names[k], "n": n} for k, n in mo.most_common()],
        "category": [{"v": k, "label": k, "n": n} for k, n in ca.most_common()],
        "year": [{"v": k, "label": k, "n": ye[k]} for k in sorted(ye, reverse=True)],
        "kind": [{"v": "group", "label": "Les groupes", "n": sum(1 for c in cands.values() if c["group"])},
                 {"v": "print", "label": "Les impressions seules", "n": sum(1 for c in cands.values() if not c["group"])}]}}


@router.post("")
async def showcase_create(body: dict = Body({}), _: str = Depends(require_admin)):
    lst = await _load()
    if len(lst) >= 30:
        raise HTTPException(400, "30 vitrines au plus")
    sid = secrets.token_hex(4)
    s = _clean(body or {}, {**DEFAULT, "id": sid})
    lst.append(s)
    await _save(lst)
    return await _out(s)


@router.get("/{sid}")
async def showcase_get(sid: str, _: str = Depends(get_current_user)):
    return await _out(_get(await _load(), sid))


@router.put("/{sid}")
async def showcase_put(sid: str, body: dict = Body({}), _: str = Depends(require_admin)):
    lst = await _load()
    s = _get(lst, sid)
    n = _clean(body or {}, s)
    lst[lst.index(s)] = n
    await _save(lst)
    t, _v = await PL.find("showcase", sid)
    if t:                                             # le titre du lien suit celui de la vitrine
        await PL.put("showcase", sid, n["title"])
    return await _out(n)


@router.delete("/{sid}")
async def showcase_delete(sid: str, _: str = Depends(require_admin)):
    """Supprime la vitrine et son lien."""
    lst = await _load()
    s = _get(lst, sid)
    lst.remove(s)
    await _save(lst)
    t, _v = await PL.find("showcase", sid)
    if t:
        await PL.remove(t)
    return {"ok": True}


@router.post("/{sid}/link")
async def showcase_link(sid: str, body: dict = Body({}), _: str = Depends(require_admin)):
    """Le lien public de cette vitrine, dans le registre des liens publics (cree au premier appel, le meme ensuite).
    days : sa duree (0 : sans fin ; absent : celle du lien existant)."""
    s = _get(await _load(), sid)
    t, _v = await PL.put("showcase", sid, s["title"], None, (body or {}).get("days", "keep"))
    return {"token": t, "path": f"/vitrine/{t}"}


@router.delete("/{sid}/link")
async def showcase_unlink(sid: str, _: str = Depends(require_admin)):
    """Retire le lien : la vitrine ne s'ouvre plus (un nouveau lien pourra etre cree)."""
    t, _v = await PL.find("showcase", sid)
    if t:
        await PL.remove(t)
    return {"ok": True}


@router.get("/public/{token}")
async def showcase_public(token: str):
    """La vitrine, sans compte (le lien est la cle) : seulement ses pieces, leurs photos, la date (mois), les couleurs
    de filament, le modele et son createur (si le credit est voulu), le mot ; jamais un cout."""
    from ....models.print_history import FilamentUsage
    from ....models.object_history import Object
    v = await PL.open_(token, ("showcase",))
    if not v:
        raise HTTPException(404, "Cette vitrine n'existe pas, a expiré ou a été retirée")
    lst = await _load()
    s = next((s for s in lst if s["id"] == (v.get("ref") or "1")), None)
    if not s:
        raise HTTPException(404, "Cette vitrine n'existe pas, a expiré ou a été retirée")
    cands = await _candidates()
    keys = _resolve(s, cands)
    allp = sorted({p for it in keys for p in cands[it["k"]]["pids"]})
    async with AsyncSessionLocal() as db:
        cols: dict = {}
        if allp:
            for pid, hx, g in (await db.execute(select(FilamentUsage.print_id, FilamentUsage.color_hex, FilamentUsage.grams_used)
                                                .where(FilamentUsage.print_id.in_(allp)))).all():
                h = str(hx or "").lstrip("#").upper()[:6]
                if len(h) == 6:
                    cols.setdefault(pid, {})
                    cols[pid][h] = cols[pid].get(h, 0) + float(g or 0)
        sale = []
        if s.get("show_sale"):
            for o in (await db.execute(select(Object.id, Object.name, Object.translated_name, Object.desired_price)
                                       .where(Object.status == "available", Object.personal.isnot(True), Object.desired_price > 0)
                                       .order_by(Object.created_at.desc()).limit(60))).all():
                sale.append({"id": o.id, "title": o.translated_name or o.name, "price": round(float(o.desired_price), 2),
                             "img": f"/api/v1/objects/objects/{o.id}/image"})
    items = []
    for it in keys:
        c = cands[it["k"]]
        agg: dict = {}
        for p in c["pids"]:
            for h, w in (cols.get(p) or {}).items():
                agg[h] = agg.get(h, 0) + w
        items.append({"key": it["k"], "kind": "group" if c["group"] else "print", "title": c["title"],
                      "date": c["date"][:7] if c["date"] else None, "featured": it["featured"], "note": it["note"],
                      "photos": c["photos"][:24], "colors": [h for h, _w in sorted(agg.items(), key=lambda x: -x[1])[:8]],
                      "count": len(c["pids"]) if c["group"] else 1, "categories": c["categories"][:3],
                      "model": ({"title": c["model"] or "", "creator": c["creator"], "url": f"https://makerworld.com/fr/models/{c['design']}"}
                                if c["design"] and c["model"] is not None and s.get("show_credit") else None)})
    return {"title": s["title"], "tagline": s["tagline"], "accent": s["accent"], "contact": s["contact"], "items": items, "sale": sale}
