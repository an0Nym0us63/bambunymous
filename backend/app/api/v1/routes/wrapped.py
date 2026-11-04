"""
« Ton annee en impressions » (04/11/2026) : le recapitulatif d'une annee, a la maniere des retrospectives de fin
d'annee -- combien, combien de temps, combien de filament, les couleurs, les modeles et les createurs preferes, les
rythmes (mois, jour, heure), les records, les objets vendus. Lecture seule ; les impressions retirees des classements
des stats n'y comptent pas. Les jours et les heures sont ceux de l'utilisateur (tz : son decalage en minutes).
"""
import html as _html
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import extract, func, select

from ....db.session import AsyncSessionLocal
from .auth import get_current_user

router = APIRouter()

OK = ("SUCCESS", "PARTIAL")
MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
M_PER_G = 0.33                     # 1,75 mm de PLA : ~330 m au kilo (un ordre de grandeur, dit comme tel)


def _hex(c) -> str:
    h = str(c or "").lstrip("#").upper()
    return h[:6] if len(h) >= 6 else ""


@router.get("")
async def wrapped(year: int = Query(0), tz: int = 0, _: str = Depends(get_current_user)):
    from ....models.print_history import Print, FilamentUsage, MakerWorldDesign as MW
    from ....models.object_history import Object
    off = timedelta(minutes=max(-14 * 60, min(14 * 60, tz)))
    now = datetime.utcnow() + off
    async with AsyncSessionLocal() as db:
        years = sorted({int(y) for (y,) in (await db.execute(select(extract("year", Print.print_date)).distinct())).all() if y}, reverse=True)
        y = year or (years[0] if years else now.year)
        lo, hi = datetime(y, 1, 1) - off, datetime(y + 1, 1, 1) - off
        rows = (await db.execute(select(Print.id, Print.print_date, Print.status, Print.duration_seconds, Print.estimated_seconds,
                                        Print.total_weight_g, Print.total_cost, Print.design_id, Print.translated_name, Print.file_name,
                                        Print.number_of_items)
                                 .where(Print.print_date >= lo, Print.print_date < hi, func.coalesce(Print.stats_excluded, 0) == 0)
                                 .order_by(Print.print_date))).all()
        ids = [r.id for r in rows]
        uses = (await db.execute(select(FilamentUsage.print_id, FilamentUsage.color_hex, FilamentUsage.filament_type, FilamentUsage.grams_used)
                                 .where(FilamentUsage.print_id.in_(ids)))).all() if ids else []
        dids = {str(r.design_id).strip() for r in rows if str(r.design_id or "").strip()}
        mws = {m.design_id: m for m in (await db.execute(select(MW).where(MW.design_id.in_(dids)))).scalars().all()} if dids else {}
        sold = (await db.execute(select(func.count(Object.id), func.sum(Object.sold_price))
                                 .where(Object.sold_date >= lo, Object.sold_date < hi, Object.sold_price > 0))).one()
    out = {"year": y, "years": years, "count": len(rows)}
    if not rows:
        return out
    loc = [(r, r.print_date + off) for r in rows]
    secs = lambda r: float(r.duration_seconds or r.estimated_seconds or 0)
    ok = [r for r in rows if r.status in OK]
    out.update(
        success=len(ok), failed=sum(1 for r in rows if r.status == "FAILED"), cancelled=sum(1 for r in rows if r.status == "CANCELLED"),
        seconds=int(sum(secs(r) for r in rows)), weight_g=round(sum(float(r.total_weight_g or 0) for r in rows), 1),
        cost=round(sum(float(r.total_cost or 0) for r in rows), 2), items=sum(int(r.number_of_items or 1) for r in ok),
        lost_g=round(sum(float(r.total_weight_g or 0) for r in rows if r.status == "FAILED"), 1),
        sold=int(sold[0] or 0), revenue=round(float(sold[1] or 0), 2))
    out["meters"] = int(out["weight_g"] * M_PER_G)
    # l'annee en cours : la part de la machine sur les jours ecoules
    span_days = ((min(now, datetime(y + 1, 1, 1)) - datetime(y, 1, 1)).total_seconds() / 86400) if y == now.year else (366 if y % 4 == 0 else 365)
    out["occupation"] = round(min(1.0, out["seconds"] / max(1.0, span_days * 86400)), 3)
    # les rythmes
    by_month, by_month_h = Counter(), Counter()
    by_wd, by_hour, by_day, by_day_h = Counter(), Counter(), Counter(), Counter()
    for r, t in loc:
        by_month[t.month] += 1
        by_month_h[t.month] += secs(r)
        by_wd[t.weekday()] += 1
        by_hour[t.hour] += 1
        by_day[t.date()] += 1
        by_day_h[t.date()] += secs(r)
    out["months"] = [{"m": m, "label": MONTHS[m - 1], "count": by_month[m], "hours": round(by_month_h[m] / 3600, 1)} for m in range(1, 13)]
    bm = max(range(1, 13), key=lambda m: (by_month_h[m], by_month[m]))
    out["best_month"] = {"label": MONTHS[bm - 1], "count": by_month[bm], "hours": round(by_month_h[bm] / 3600, 1)}
    wd = by_wd.most_common(1)[0]
    out["fav_weekday"] = {"label": DAYS[wd[0]], "count": wd[1]}
    hr = by_hour.most_common(1)[0]
    out["fav_hour"] = {"hour": hr[0], "count": hr[1], "night": sum(n for h, n in by_hour.items() if h < 6 or h >= 22)}
    bd = max(by_day, key=lambda d: (by_day[d], by_day_h[d]))
    out["busiest_day"] = {"date": bd.isoformat(), "count": by_day[bd], "hours": round(by_day_h[bd] / 3600, 1)}
    out["active_days"] = len(by_day)
    # la plus longue serie de jours d'impression d'affilee
    best, cur, prev = 0, 0, None
    for d in sorted(by_day):
        cur = cur + 1 if prev and (d - prev).days == 1 else 1
        best, prev = max(best, cur), d
    out["streak"] = best
    # les records
    name = lambda r: r.translated_name or r.file_name or f"Impression {r.id}"
    lg = max(rows, key=secs)
    hv = max(rows, key=lambda r: float(r.total_weight_g or 0))
    out["longest"] = {"id": lg.id, "name": name(lg), "seconds": int(secs(lg))}
    out["heaviest"] = {"id": hv.id, "name": name(hv), "weight_g": round(float(hv.total_weight_g or 0), 1)}
    out["first"] = {"id": loc[0][0].id, "name": name(loc[0][0]), "date": loc[0][1].date().isoformat()}
    # les modeles et les createurs preferes
    by_model: dict = defaultdict(lambda: {"count": 0, "seconds": 0.0, "print_id": None})
    for r in rows:
        d = str(r.design_id or "").strip()
        k = f"d{d}" if d else f"n{(r.translated_name or r.file_name or '').strip().lower()}"
        e = by_model[k]
        e["count"] += 1
        e["seconds"] += secs(r)
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
    out["materials"] = [{"name": n, "grams": round(g)} for n, g in mat.most_common(5) if g > 0]
    return out
