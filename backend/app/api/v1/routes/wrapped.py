"""
« Ton annee en impressions » (04/11/2026) : le recapitulatif d'une annee, a la maniere des retrospectives de fin
d'annee -- combien, combien de temps, combien de filament, les couleurs, les modeles et les createurs preferes, les
rythmes (mois, jour, heure), les records, les objets vendus, et l'annee d'avant pour comparer. scope=all : « Depuis le
debut », toute la vie de l'imprimante, annee par annee. Lecture seule ; les impressions retirees des classements des
stats n'y comptent pas. Les jours et les heures sont ceux de l'utilisateur (tz : son decalage en minutes).
"""
import html as _html
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import extract, func, select

from ....db.session import AsyncSessionLocal
from ....services import public_links as PL
from .auth import get_current_user, require_admin

router = APIRouter()

OK = ("SUCCESS", "PARTIAL")
MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
M_PER_G = 0.33                     # 1,75 mm de PLA : ~330 m au kilo (un ordre de grandeur, dit comme tel)


def _hex(c) -> str:
    h = str(c or "").lstrip("#").upper()
    return h[:6] if len(h) >= 6 else ""


async def _rows(db, lo, hi):
    from ....models.print_history import Print
    q = select(Print.id, Print.print_date, Print.status, Print.duration_seconds, Print.estimated_seconds, Print.total_weight_g,
               Print.total_cost, Print.design_id, Print.translated_name, Print.file_name, Print.number_of_items)
    q = q.where(func.coalesce(Print.stats_excluded, 0) == 0)
    if lo is not None:
        q = q.where(Print.print_date >= lo, Print.print_date < hi)
    return (await db.execute(q.order_by(Print.print_date))).all()


def _secs(r) -> float:
    return float(r.duration_seconds or r.estimated_seconds or 0)


def _light(rows, off) -> dict:
    """Les chiffres d'une periode, sans le detail (l'annee d'avant, pour comparer)."""
    days = {(r.print_date + off).date() for r in rows if r.print_date}
    best, cur, prev = 0, 0, None
    for d in sorted(days):
        cur = cur + 1 if prev and (d - prev).days == 1 else 1
        best, prev = max(best, cur), d
    return {"count": len(rows), "success": sum(1 for r in rows if r.status in OK), "seconds": int(sum(_secs(r) for r in rows)),
            "weight_g": round(sum(float(r.total_weight_g or 0) for r in rows), 1), "active_days": len(days), "streak": best,
            "distinct_models": len({str(r.design_id or "").strip() or (r.translated_name or r.file_name or "") for r in rows})}


@router.get("/years")
async def wrapped_years(_: str = Depends(get_current_user)):
    """Les annees qui ont des impressions, la plus recente d'abord, avec leur nombre : le choix des retrospectives."""
    from ....models.print_history import Print
    y = extract("year", Print.print_date)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(y, func.count()).where(func.coalesce(Print.stats_excluded, 0) == 0, Print.print_date.isnot(None))
                                 .group_by(y))).all()
    return {"years": sorted(({"year": int(a), "count": int(n)} for a, n in rows if a), key=lambda r: -r["year"])}


@router.get("")
async def wrapped(year: int = Query(0), tz: int = 0, _: str = Depends(get_current_user), scope: str = Query("year")):
    from ....models.print_history import FilamentUsage, MakerWorldDesign as MW, Print
    from ....models.object_history import Object
    off = timedelta(minutes=max(-14 * 60, min(14 * 60, tz)))
    now = datetime.utcnow() + off
    whole = scope == "all"
    async with AsyncSessionLocal() as db:
        years = sorted({int(y) for (y,) in (await db.execute(select(extract("year", Print.print_date)).distinct())).all() if y}, reverse=True)
        y = year or (years[0] if years else now.year)
        lo, hi = (None, None) if whole else (datetime(y, 1, 1) - off, datetime(y + 1, 1, 1) - off)
        rows = await _rows(db, lo, hi)
        prev_rows = [] if whole else await _rows(db, datetime(y - 1, 1, 1) - off, datetime(y, 1, 1) - off)
        ids = [r.id for r in rows]
        uses = []
        for k in range(0, len(ids), 900):              # par paquets : la vie entiere peut compter des milliers d'impressions
            uses += (await db.execute(select(FilamentUsage.print_id, FilamentUsage.color_hex, FilamentUsage.filament_type, FilamentUsage.grams_used)
                                      .where(FilamentUsage.print_id.in_(ids[k:k + 900])))).all()
        dids = {str(r.design_id).strip() for r in rows if str(r.design_id or "").strip()}
        mws = {m.design_id: m for m in (await db.execute(select(MW).where(MW.design_id.in_(dids)))).scalars().all()} if dids else {}
        sq = select(func.count(Object.id), func.sum(Object.sold_price)).where(Object.sold_price > 0, Object.sold_date.isnot(None))
        if not whole:
            sq = sq.where(Object.sold_date >= lo, Object.sold_date < hi)
        sold = (await db.execute(sq)).one()
    out = {"year": y, "years": years, "scope": "all" if whole else "year", "count": len(rows)}
    if not whole and prev_rows:
        out["prev"] = {"year": y - 1, **_light(prev_rows, off)}
    if not rows:
        return out
    loc = [(r, r.print_date + off) for r in rows]
    ok = [r for r in rows if r.status in OK]
    out.update(
        success=len(ok), failed=sum(1 for r in rows if r.status == "FAILED"), cancelled=sum(1 for r in rows if r.status == "CANCELLED"),
        seconds=int(sum(_secs(r) for r in rows)), weight_g=round(sum(float(r.total_weight_g or 0) for r in rows), 1),
        cost=round(sum(float(r.total_cost or 0) for r in rows), 2), items=sum(int(r.number_of_items or 1) for r in ok),
        lost_g=round(sum(float(r.total_weight_g or 0) for r in rows if r.status == "FAILED"), 1),
        sold=int(sold[0] or 0), revenue=round(float(sold[1] or 0), 2))
    out["meters"] = int(out["weight_g"] * M_PER_G)
    # la part de la machine : sur les jours ecoules de l'annee, ou depuis la premiere impression
    if whole:
        span_days = max(1.0, (now - loc[0][1]).total_seconds() / 86400)
        out["since"] = loc[0][1].date().isoformat()
        out["days_since"] = int(span_days)
    else:
        span_days = ((min(now, datetime(y + 1, 1, 1)) - datetime(y, 1, 1)).total_seconds() / 86400) if y == now.year else (366 if y % 4 == 0 else 365)
    out["occupation"] = round(min(1.0, out["seconds"] / max(1.0, span_days * 86400)), 3)
    # les rythmes
    by_month, by_month_h = Counter(), Counter()
    by_wd, by_hour, by_day, by_day_h = Counter(), Counter(), Counter(), Counter()
    by_year: dict = defaultdict(lambda: {"count": 0, "seconds": 0.0, "weight_g": 0.0, "success": 0})
    for r, t in loc:
        by_month[t.month] += 1
        by_month_h[t.month] += _secs(r)
        by_wd[t.weekday()] += 1
        by_hour[t.hour] += 1
        by_day[t.date()] += 1
        by_day_h[t.date()] += _secs(r)
        e = by_year[t.year]
        e["count"] += 1
        e["seconds"] += _secs(r)
        e["weight_g"] += float(r.total_weight_g or 0)
        e["success"] += r.status in OK
    out["months"] = [{"m": m, "label": MONTHS[m - 1], "count": by_month[m], "hours": round(by_month_h[m] / 3600, 1)} for m in range(1, 13)]
    bm = max(range(1, 13), key=lambda m: (by_month_h[m], by_month[m]))
    out["best_month"] = {"label": MONTHS[bm - 1], "count": by_month[bm], "hours": round(by_month_h[bm] / 3600, 1)}
    out["weekdays"] = [{"label": DAYS[i], "count": by_wd[i]} for i in range(7)]
    out["hours"] = [by_hour[h] for h in range(24)]
    wd = by_wd.most_common(1)[0]
    out["fav_weekday"] = {"label": DAYS[wd[0]], "count": wd[1]}
    hr = by_hour.most_common(1)[0]
    out["fav_hour"] = {"hour": hr[0], "count": hr[1], "night": sum(n for h, n in by_hour.items() if h < 6 or h >= 22)}
    bd = max(by_day, key=lambda d: (by_day[d], by_day_h[d]))
    out["busiest_day"] = {"date": bd.isoformat(), "count": by_day[bd], "hours": round(by_day_h[bd] / 3600, 1)}
    out["active_days"] = len(by_day)
    out["by_year"] = [{"year": yy, "count": v["count"], "hours": round(v["seconds"] / 3600), "weight_g": round(v["weight_g"]),
                       "success": v["success"]} for yy, v in sorted(by_year.items())]
    # la plus longue serie de jours d'impression d'affilee
    best, cur, prev = 0, 0, None
    for d in sorted(by_day):
        cur = cur + 1 if prev and (d - prev).days == 1 else 1
        best, prev = max(best, cur), d
    out["streak"] = best
    # les records
    name = lambda r: r.translated_name or r.file_name or f"Impression {r.id}"
    lg = max(rows, key=_secs)
    hv = max(rows, key=lambda r: float(r.total_weight_g or 0))
    out["longest"] = {"id": lg.id, "name": name(lg), "seconds": int(_secs(lg))}
    out["heaviest"] = {"id": hv.id, "name": name(hv), "weight_g": round(float(hv.total_weight_g or 0), 1)}
    out["first"] = {"id": loc[0][0].id, "name": name(loc[0][0]), "date": loc[0][1].date().isoformat()}
    out["latest"] = {"id": loc[-1][0].id, "name": name(loc[-1][0]), "date": loc[-1][1].date().isoformat()}
    # les modeles et les createurs preferes
    by_model: dict = defaultdict(lambda: {"count": 0, "seconds": 0.0, "print_id": None})
    for r in rows:
        d = str(r.design_id or "").strip()
        k = f"d{d}" if d else f"n{(r.translated_name or r.file_name or '').strip().lower()}"
        e = by_model[k]
        e["count"] += 1
        e["seconds"] += _secs(r)
        e["print_id"] = e["print_id"] or r.id
        if d and d in mws:
            m = mws[d]
            e.update(title=_html.unescape(m.title_fr or m.title or name(r)), cover=m.cover_url, design_id=d, creator=m.creator_name)
        else:
            e.setdefault("title", name(r))
    out["models"] = [{k: v for k, v in e.items()} for e in sorted(by_model.values(), key=lambda e: (-e["count"], -e["seconds"]))[:5]]
    out["distinct_models"] = len(by_model)
    by_creator: dict = defaultdict(lambda: {"count": 0, "models": set()})
    for r in rows:
        m = mws.get(str(r.design_id or "").strip())
        if m and m.creator_name:
            c = by_creator[m.creator_name]
            c["count"] += 1
            c["models"].add(m.design_id)
            c["avatar"], c["uid"] = m.creator_avatar, m.creator_uid
    out["creators"] = [{"name": k, "count": v["count"], "models": len(v["models"]), "avatar": v.get("avatar"), "uid": v.get("uid")}
                       for k, v in sorted(by_creator.items(), key=lambda kv: -kv[1]["count"])[:5]]
    out["distinct_creators"] = len(by_creator)
    # les couleurs et les matieres, au poids
    col, mat = Counter(), Counter()
    for u in uses:
        g = float(u.grams_used or 0)
        if _hex(u.color_hex):
            col[_hex(u.color_hex)] += g
        if u.filament_type:
            mat[str(u.filament_type).split()[0].upper()] += g
    out["colors"] = [{"hex": h, "grams": round(g)} for h, g in col.most_common(8) if g > 0]
    out["distinct_colors"] = sum(1 for g in col.values() if g > 0)
    out["materials"] = [{"name": n, "grams": round(g)} for n, g in mat.most_common(6) if g > 0]
    return out


# ── Le lien public (04/11/2026) : l'animation, a envoyer a qui l'on veut ─────────────────────────────────────────────
# Les chiffres sont figes au moment du partage, sans les montants, et gardes dans le registre des liens publics
# (Parametres les liste, les prolonge, les supprime) : un lien par annee (et un pour « Depuis le debut »).
_PRIVATE = ("cost", "revenue", "years")


@router.post("/share")
async def wrapped_share(body: dict = Body({}), user: str = Depends(require_admin)):
    """Fige l'annee (ou toute la vie, scope=all) et rend son lien public : {token, path}. days : sa duree (0 : sans fin ;
    absent : celle du lien existant)."""
    year, tz, whole = int(body.get("year") or 0), int(body.get("tz") or 0), body.get("scope") == "all"
    data = await wrapped(year, tz, user, "all" if whole else "year")
    if not data.get("count"):
        raise HTTPException(400, "Rien à partager pour cette période")
    data = {k: v for k, v in data.items() if k not in _PRIVATE}
    t, _v = await PL.put("all" if whole else "year", None if whole else data["year"],
                         "Depuis le début" if whole else f"Ton année {data['year']}", data, body.get("days", "keep"))
    return {"token": t, "path": f"/annee/{t}", "year": data["year"]}


@router.get("/share/{year}")
async def wrapped_share_of(year: int, _: str = Depends(require_admin), scope: str = Query("year")):
    """Le lien deja partage pour cette annee (ou « Depuis le debut »), s'il y en a un."""
    t, v = await PL.find("all", None) if scope == "all" else await PL.find("year", year)
    return {"token": t, "path": f"/annee/{t}" if t else None, "at": (v or {}).get("updated") or (v or {}).get("created"),
            "expires": (v or {}).get("expires")}


@router.delete("/share/{token}")
async def wrapped_unshare(token: str, _: str = Depends(require_admin)):
    """Revoque un lien : il ne s'ouvre plus."""
    await PL.remove(token)
    return {"ok": True}


@router.get("/public/{token}")
async def wrapped_public(token: str, request: Request):
    """L'annee partagee, telle que figee : sans compte (le lien est la cle), tant qu'il n'a pas expire."""
    v = await PL.open_(token, ("year", "all"), request)
    if not v:
        raise HTTPException(404, "Ce lien n'existe pas, a expiré ou a été retiré")
    return {**(v.get("data") or {}), "shared_at": v.get("updated") or v.get("created")}
