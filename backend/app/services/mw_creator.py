"""
Ma page createur MakerWorld : points, abonnes, statistiques de mes modeles,
historique des points ; et les notifications qui en decoulent.

Sources (relevees le 19/10/2026, avec le jeton du compte) :
  /design-user-service/my/profile        solde de points, abonnes, totaux
  /point-service/point-bill/my           historique des points (paginee)
  /design-service/published/{uid}/design mes modeles et leurs compteurs (public)
Les points sont verses chaque jour, par modele (design_reward_v2) et par
profil (instance_reward_v2) : on suit ce qui est reellement verse plutot que
de recalculer des paliers dont la regle change.
"""
import asyncio
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone

from . import notify as N

logger = logging.getLogger(__name__)

PROFILE = "/design-user-service/my/profile"
BILL = "/point-service/point-bill/my?offset={offset}&limit={limit}"
MODELS = "/design-service/published/{uid}/design?offset={offset}&limit=50"
K_SNAP = "MW_CREATOR_SNAPSHOT"
MILESTONES = (50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000)
_CACHE = {}               # cle -> (instant, valeur)
TTL = 600


class CreatorError(Exception):
    pass


def _num(v, default=0):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else default


async def _get(path: str):
    from .makerworld import _get_json
    from .makerworld_account import token
    tok = await token()
    if not tok:
        raise CreatorError("Compte MakerWorld non connecté (Paramètres → Données → MakerWorld)")
    code, d = await asyncio.to_thread(_get_json, path, tok)
    if code == 401:
        raise CreatorError("Jeton refusé ou expiré : reconnecte le compte")
    if not isinstance(d, dict):
        raise CreatorError(f"MakerWorld ne répond pas comme prévu (HTTP {code})")
    return d


def _cached(key, fresh):
    hit = None if fresh else _CACHE.get(key)
    return hit[1] if hit and time.time() - hit[0] < TTL else None


async def profile(fresh: bool = False) -> dict:
    hit = _cached("profile", fresh)
    if hit is not None:
        return hit
    d = await _get(PROFILE)
    mw = d.get("MWCount") if isinstance(d.get("MWCount"), dict) else {}
    lvl = ((d.get("personal") or {}).get("userLevel") or {}) if isinstance(d.get("personal"), dict) else {}
    out = {
        "uid": str(d.get("uid") or ""), "name": d.get("name"), "handle": d.get("handle"), "avatar": d.get("avatar"),
        "points": {"total": _num(d.get("point")), "regular": _num(d.get("pointRegular")),
                   "exclusive": _num(d.get("pointExclusive"))},
        "fans": _num(d.get("fanCount")), "follows": _num(d.get("followCount")),
        "designs": _num(mw.get("designCount")),
        "downloads": _num(mw.get("myDesignDownloadCount")), "prints": _num(mw.get("myDesignPrintCount")),
        "profile_downloads": _num(mw.get("myInstanceDownloadCount")), "profile_prints": _num(mw.get("myInstancePrintCount")),
        "boosts": _num(d.get("boostGained")), "likes": _num(d.get("likeCount")),
        "collections": _num(d.get("collectionCount")), "level": _num(lvl.get("level"), None),
    }
    _CACHE["profile"] = (time.time(), out)
    return out


def _bill_item(h: dict) -> dict:
    dr = h.get("designRewardV2") if isinstance(h.get("designRewardV2"), dict) else None
    ir = h.get("instanceRewardV2") if isinstance(h.get("instanceRewardV2"), dict) else None
    reg, exc = _num(h.get("pointChangeRegular")), _num(h.get("pointChangeExclusive"))
    pts = reg + exc if (reg or exc) else _num(h.get("pointChange"))
    kind = h.get("type") or ""
    out = {"type": kind, "points": round(pts, 2), "regular": reg, "exclusive": exc,
           "exclusive_bonus": bool(h.get("isExclusiveBonus")), "time": h.get("pointTime") or h.get("createTime")}
    if dr:
        out.update(design_id=str(dr.get("id") or ""), title=dr.get("title"), day=dr.get("earningTime"),
                   label="Modèle")
    elif ir:
        out.update(design_id=str(ir.get("designId") or ""), title=ir.get("designTitle"), day=ir.get("earningTime"),
                   instance_title=ir.get("instanceTitle"), label="Profil")
    else:
        out.update(label={"boost": "Boost"}.get(kind.split("_")[0], kind.replace("_", " ") or "Autre"))
    return out


async def points(offset: int = 0, limit: int = 30) -> dict:
    d = await _get(BILL.format(offset=max(0, int(offset)), limit=max(1, min(int(limit), 50))))
    hits = [_bill_item(h) for h in (d.get("hits") or []) if isinstance(h, dict)]
    # Totaux depuis toujours (page Transactions du site) : revenus et depenses,
    # points normaux + points exclusifs.
    return {"items": hits, "total": _num(d.get("total")),
            "income": round(_num(d.get("totalRegularIncome")) + _num(d.get("totalExclusiveIncome")), 3),
            "expense": round(_num(d.get("totalRegularExpense")) + _num(d.get("totalExclusiveExpense")), 3)}


async def recent_points(days: int = 30, max_pages: int = 10, fresh: bool = False) -> list:
    """Lignes de points des `days` derniers jours (gains seulement)."""
    hit = _cached(("recent", days), fresh)
    if hit is not None:
        return hit
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out, off = [], 0
    for _ in range(max_pages):
        p = await points(off, 50)
        for x in p["items"]:
            try:
                t = datetime.fromisoformat(str(x["time"]).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                continue
            if t < since:
                _CACHE[("recent", days)] = (time.time(), out)
                return out
            out.append(x)
        if len(p["items"]) < 50:
            break
        off += 50
    _CACHE[("recent", days)] = (time.time(), out)
    return out


async def models(fresh: bool = False) -> list:
    hit = _cached("models", fresh)
    if hit is not None:
        return hit
    from .makerworld import _get_json
    uid = (await profile(fresh))["uid"]
    out, off = [], 0
    while off < 500:
        code, d = await asyncio.to_thread(_get_json, MODELS.format(uid=uid, offset=off))
        hits = d.get("hits") if isinstance(d, dict) and isinstance(d.get("hits"), list) else []
        for h in hits:
            if not isinstance(h, dict) or not str(h.get("id") or "").isdigit():
                continue
            out.append({"design_id": str(h["id"]), "title": h.get("title"),
                        "title_fr": h.get("titleTranslated") or None,
                        # cette liste donne « coverUrl » (pas « cover » comme la recherche)
                        "cover_url": h.get("coverUrl") or h.get("cover") or h.get("coverPortrait") or None,
                        "downloads": _num(h.get("downloadCount")), "prints": _num(h.get("printCount")),
                        "boosts": _num(h.get("boostCnt")), "likes": _num(h.get("likeCount")),
                        "collections": _num(h.get("collectionCount")), "comments": _num(h.get("commentCount")),
                        "exclusive": bool(h.get("isExclusive")), "created": h.get("createTime")})
        if len(hits) < 50:
            break
        off += 50
    _CACHE["models"] = (time.time(), out)
    return out


# ── Evolution par periode ──────────────────────────────────────────────────
# MakerWorld ne donne que des TOTAUX par modele : on note chaque jour les
# compteurs de mes modeles (reglage MW_CREATOR_DAILY) et l'ecart sur une
# periode se lit entre aujourd'hui et le releve d'il y a N jours. Les points,
# eux, ont leur historique complet chez MakerWorld.
K_DAILY = "MW_CREATOR_DAILY"
DAILY_KEEP = 400
METRICS = ("downloads", "prints", "boosts", "likes")


async def _daily_get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, K_DAILY, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def record_daily(ms: list) -> dict:
    """Releve du jour (remplace celui deja pris aujourd'hui) ; rend tous les releves."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    d = await _daily_get()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    d[today] = {m["design_id"]: [m[k] for k in METRICS] for m in ms}
    for k in sorted(d)[:-DAILY_KEEP]:
        del d[k]
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_DAILY, json.dumps(d, separators=(",", ":")))
    return d


def _baseline(daily: dict, days):
    """Releve servant de point de depart : le plus recent qui a au moins `days`
    jours ; a defaut, le plus ancien (periode incomplete)."""
    if not daily or days is None:
        return None, None
    target = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    older = [k for k in sorted(daily) if k <= target]
    key = older[-1] if older else sorted(daily)[0]
    return key, daily[key]


PERIODS = {"7": 7, "30": 30, "90": 90, "365": 365, "all": None}


# ── Historique importe (une fois) ─────────────────────────────────────────
# La page « Centre des createurs › Vue d'ensemble » du site donne, pour tout le
# compte, les compteurs JOUR PAR JOUR depuis l'ouverture (dateList), mais pas
# modele par modele. L'adresse (_next/data/{build}/…) depend des cookies du
# navigateur : l'utilisateur l'ouvre lui-meme, l'interface en extrait dateList
# et nous l'envoie. On en tire les totaux du compte sur une periode, pour les
# jours d'avant le premier releve quotidien de l'appli.
K_HISTORY = "MW_CREATOR_HISTORY"
HIST_KEYS = ("download", "print", "boost", "like")   # meme ordre que METRICS


async def _history_get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, K_HISTORY, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) and isinstance(d.get("days"), dict) else {"days": {}}


def parse_date_list(rows, until: str = None) -> dict:
    """dateList du site -> {AAAA-MM-JJ: [telechargements, impressions, boosts, j'aime]}.
    `until` (AAAA-MM-JJ) : jour du releve, encore incomplet, ecarte avec la suite."""
    out = {}
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        m = re.fullmatch(r"(\d{4})[/-](\d{2})[/-](\d{2})", str(r.get("intervalVal") or r.get("day") or ""))
        if not m:
            continue
        day = "-".join(m.groups())
        if until and day >= until:
            continue
        out[day] = [int(_num(r.get(k))) for k in HIST_KEYS]
    return out


async def import_history(rows, until: str = None, from_start: bool = False) -> dict:
    """Ajoute les jours importes (un jour deja connu est remplace par le
    nouvel import) ; rend le resume de ce qui est garde."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    if until and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(until)):
        until = None
    new = parse_date_list(rows, until)
    if not new:
        raise CreatorError("Aucun jour reconnu : il faut la réponse de la page « Vue d'ensemble » (statisticalData.dateList).")
    h = await _history_get()
    h["days"].update(new)
    if from_start and min(new) <= min(h["days"]):
        h["from_start"] = True
    h["imported"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_HISTORY, json.dumps(h, separators=(",", ":")))
    return history_summary(h) | {"added": len(new)}


def history_summary(h: dict) -> dict:
    days = sorted((h or {}).get("days") or {})
    return {"from": days[0] if days else None, "to": days[-1] if days else None, "days": len(days),
            "imported": (h or {}).get("imported")}


def account_totals(hist: dict, daily: dict, ms: list, days) -> dict:
    """Totaux du compte sur la periode : releves de l'appli depuis le premier
    releve utile, et historique importe pour les jours d'avant.
    Rend {"totals": {metrique: n}, "complete": bool}."""
    if days is None:
        return {"totals": {k: sum(m[k] for m in ms) for k in METRICS}, "complete": True}
    now = datetime.now(timezone.utc)
    target = (now - timedelta(days=days)).strftime("%Y-%m-%d")
    since, base = _baseline(daily, days)
    tot = {k: 0 for k in METRICS}
    if base is not None:
        for m in ms:
            b = base.get(m["design_id"])
            for i, k in enumerate(METRICS):
                tot[k] += m[k] - b[i] if b else (m[k] if str(m.get("created") or "")[:10] >= since else 0)
    if since is None or since <= target:
        return {"totals": tot, "complete": since is not None}
    # Trou entre le debut de la periode et le premier releve : le releve du jour
    # `since` est pris en cours ou en fin de journee, il contient ce jour-la.
    hd = (hist or {}).get("days") or {}
    keys = sorted(hd)
    for d in keys:
        if target < d <= since:
            for i, k in enumerate(METRICS):
                tot[k] += hd[d][i]
    first_needed = (now - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    # un historique pris depuis l'ouverture du compte couvre aussi ce qui le precede
    covered = bool(keys) and keys[-1] >= since and (keys[0] <= first_needed or bool(hist.get("from_start")))
    return {"totals": tot, "complete": covered}


async def overview(fresh: bool = False, period: str = "30") -> dict:
    prof = await profile(fresh)
    ms = await models(fresh)
    days = PERIODS.get(str(period), 30)
    daily = await record_daily(ms)
    # points : 7 et 30 jours pour l'en-tete, et la periode choisie par modele
    recent = await recent_points(max(30, days or 3650), max_pages=40, fresh=fresh)
    now = datetime.now(timezone.utc)
    per, e7, e30 = {}, 0.0, 0.0
    for x in recent:
        try:
            t = datetime.fromisoformat(str(x["time"]).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if x["points"] <= 0:
            continue
        age = now - t
        if age <= timedelta(days=30):
            e30 += x["points"]
        if age <= timedelta(days=7):
            e7 += x["points"]
        if x.get("design_id") and (days is None or age <= timedelta(days=days)):
            per[x["design_id"]] = per.get(x["design_id"], 0) + x["points"]
    since, base = _baseline(daily, days)
    for m in ms:
        b = (base or {}).get(m["design_id"])
        period_vals = {"points": round(per.get(m["design_id"], 0), 2)}
        for i, k in enumerate(METRICS):
            if days is None:
                period_vals[k] = m[k]
            elif b is None:                         # modele absent du releve de depart
                period_vals[k] = m[k] if since and str(m.get("created") or "")[:10] >= since else 0
            else:
                period_vals[k] = max(0, m[k] - b[i])
        m["period"] = period_vals
        m["points30"] = round(per.get(m["design_id"], 0), 2) if days == 30 else m.get("points30")
    target = (now - timedelta(days=days)).strftime("%Y-%m-%d") if days else None
    hist = await _history_get()
    acc = account_totals(hist, daily, ms, days)
    try:
        tot = await points(0, 1)
    except Exception:
        tot = {}
    return {"profile": prof, "models": ms, "earned7": round(e7, 2), "earned30": round(e30, 2),
            "earned_total": tot.get("income") or None, "spent_total": tot.get("expense") or None,
            "period": str(period), "counters_since": since,
            # periode plus longue que les releves pris : les compteurs ne couvrent qu'une partie
            "counters_partial": bool(days and since and since > target),
            # totaux du compte sur la periode (completes par l'historique importe)
            "account": acc["totals"], "account_complete": acc["complete"],
            "history": history_summary(hist)}


# ── Notifications ──────────────────────────────────────────────────────────
async def _snap_get():
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, K_SNAP, "")
    try:
        d = json.loads(raw) if raw else None
    except ValueError:
        d = None
    return d if isinstance(d, dict) else None


async def _snap_put(d):
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_SNAP, json.dumps(d, ensure_ascii=False))


def _cover(u):
    if u and "bblmw.com" in u and "?" not in u:
        u += "?x-oss-process=image/resize,w_600/format,webp"
    return u


def _fmt(v):
    v = round(v, 2)
    return (f"{v:.2f}".rstrip("0").rstrip(".")).replace(".", ",")


EVENTS_HERE = ("mw_points", "mw_boost", "mw_fans", "mw_milestone", "mw_points_goal")

# Recompenses de la boutique de points (20/10/2026) : toutes valent 40 euros.
CARD_PTS, COUPON_PTS, REWARD_EUR = 524, 500, 40


def _plural(n, one, many):
    return f"{n} {one if n == 1 else many}"


def reward_text(cards: int, coupons: int) -> str:
    parts = ([_plural(cards, "carte cadeau 40 €", "cartes cadeaux 40 €")] if cards else [])         + ([_plural(coupons, "réduction de 40 €", "réductions de 40 €")] if coupons else [])
    return " + ".join(parts)


def reward_goals(upto: float, kind: str = "both") -> list:
    """Paliers <= upto : (points, cartes, reductions), tries ; chaque
    combinaison de cartes (524) et de reductions (500)."""
    out = set()
    max_n = int(upto // COUPON_PTS)
    for cards in range(0, max_n + 1):
        for coupons in range(0, max_n + 1 - cards):
            if not cards and not coupons:
                continue
            if (kind == "card" and coupons) or (kind == "coupon" and cards):
                continue
            pts = cards * CARD_PTS + coupons * COUPON_PTS
            if pts <= upto:
                out.add((pts, cards, coupons))
    return sorted(out)


def goal_message(old_bal: float, bal: float, kind: str = "both"):
    """(titre, message) si le solde franchit un palier en montant, sinon None."""
    crossed = [g for g in reward_goals(bal, kind) if g[0] > old_bal]
    if not crossed:
        return None
    pts, cards, coupons = crossed[-1]
    n = cards + coupons
    title = f"🎁 {_fmt(pts)} points : " + (reward_text(cards, coupons) if n == 1 else f"{n * REWARD_EUR} € de récompenses")
    # ce que permet le solde entier : n_max recompenses, dont jusqu'a `c_max` cartes
    n_max = int(bal // COUPON_PTS) if kind != "card" else int(bal // CARD_PTS)
    lines = [f"🪙 Solde : {_fmt(bal)} points", f"🎟️ {reward_text(cards, coupons)}"]
    if kind == "both" and n_max:
        c_max = min(n_max, int((bal - n_max * COUPON_PTS) // (CARD_PTS - COUPON_PTS)))
        ways = [_plural(n_max, "réduction", "réductions")]
        if c_max:
            ways.append(reward_text(c_max, n_max - c_max).replace(" de 40 €", "").replace(" 40 €", ""))
        lines.append(f"Avec ton solde : {n_max} × 40 € ({' ou '.join(ways)})")
    nxt = reward_goals(bal + CARD_PTS + COUPON_PTS, kind)
    nxt = [g for g in nxt if g[0] > bal]
    if nxt:
        lines.append(f"➡️ Prochain palier : {_fmt(nxt[0][0])} pts ({reward_text(nxt[0][1], nxt[0][2])})")
    return title, "\n".join(lines)


async def check_creator() -> int:
    """Un passage : points verses, boosts, abonnes, paliers. Le premier passage
    memorise sans rien envoyer."""
    cfg = await N._load()
    on = {e: N.enabled_in(cfg, e) for e in EVENTS_HERE}
    if not any(on.values()):
        return 0
    from .makerworld_account import token
    if not await token():
        return 0
    prof = await profile(fresh=True)
    ms = await models(fresh=True)
    await record_daily(ms)
    first = await points(0, 50)
    old = await _snap_get()
    snap = {"last_time": max((x["time"] or "" for x in first["items"]), default=(old or {}).get("last_time") or ""),
            "fans": prof["fans"], "points": prof["points"]["total"],
            "models": {m["design_id"]: {"d": m["downloads"], "p": m["prints"], "b": m["boosts"]} for m in ms}}
    if old is None:
        await _snap_put(snap)
        logger.info("[MW] createur memorise : rien n'est notifie au premier passage")
        return 0
    sent = 0
    by_id = {m["design_id"]: m for m in ms}
    link = N.app_link(cfg, "/prints")
    acts = [("Ouvrir BambuNymous", link)] if link else []
    profile_url = f"https://makerworld.com/fr/@{prof['handle']}" if prof.get("handle") else None

    # Points verses depuis le dernier passage
    if on["mw_points"]:
        new = [x for x in first["items"] if (x["time"] or "") > (old.get("last_time") or "") and x["points"] > 0]
        if new:
            tot = sum(x["points"] for x in new)
            per = {}
            for x in new:
                k = x.get("title") or x["label"]
                per[k] = per.get(k, 0) + x["points"]
            top = sorted(per.items(), key=lambda kv: -kv[1])
            lines = [f"   • {t} +{_fmt(p)}" for t, p in top[:5]] + ([f"   • … et {len(top) - 5} autre(s)"] if len(top) > 5 else [])
            await N.notify("mw_points", f"💰 +{_fmt(tot)} points MakerWorld",
                           "\n".join([f"🪙 Solde : {_fmt(prof['points']['total'])} points"] + lines),
                           priority=2, click=profile_url, actions=acts)
            sent += 1
    # Paliers de points : une recompense de la boutique devient accessible
    if on["mw_points_goal"] and old.get("points") is not None:
        kind = N.options_of(cfg, "mw_points_goal").get("kind", "both")
        g = goal_message(_num(old.get("points")), prof["points"]["total"], kind)
        if g:
            await N.notify("mw_points_goal", g[0], g[1], priority=3, click=profile_url, actions=acts)
            sent += 1
    # Abonnes
    if on["mw_fans"] and prof["fans"] > _num(old.get("fans")):
        n = prof["fans"] - _num(old.get("fans"))
        await N.notify("mw_fans", f"👥 +{n} abonné{'s' if n > 1 else ''} sur MakerWorld",
                       f"Tu as maintenant {prof['fans']} abonnés.", priority=2, click=profile_url, actions=acts)
        sent += 1
    # Boosts et paliers, modele par modele
    level = N.options_of(cfg, "mw_milestone").get("metric", "both") if on["mw_milestone"] else None
    for did, m in by_id.items():
        o = (old.get("models") or {}).get(did)
        if not o:
            continue
        url = f"https://makerworld.com/fr/models/{did}"
        name = m.get("title_fr") or m.get("title") or f"Modèle {did}"
        if on["mw_boost"] and m["boosts"] > _num(o.get("b")):
            n = m["boosts"] - _num(o.get("b"))
            await N.notify("mw_boost", f"⚡ {'Boost reçu' if n == 1 else f'{n} boosts reçus'}",
                           f"📄 {name}\n⚡ {m['boosts']} boosts au total", click=url, attach=_cover(m.get("cover_url")),
                           icon=_cover(m.get("cover_url")), priority=3, actions=[("Voir le modèle", url)] + acts)
            sent += 1
        if level:
            for key, short, label in (("d", "downloads", "téléchargements"), ("p", "prints", "impressions")):
                if level != "both" and level != short:
                    continue
                before, now_v = _num(o.get(key)), m[short]
                hit = [s for s in MILESTONES if before < s <= now_v]
                if hit:
                    await N.notify("mw_milestone", f"🏁 {hit[-1]} {label} !",
                                   f"📄 {name}\n⬇️ {m['downloads']} téléchargements · 🖨️ {m['prints']} impressions",
                                   click=url, attach=_cover(m.get("cover_url")), icon=_cover(m.get("cover_url")),
                                   priority=3, actions=[("Voir le modèle", url)] + acts)
                    sent += 1
    await _snap_put(snap)
    return sent


async def watch_loop(period_s: int = 1800, first_delay_s: int = 300):
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            n = await check_creator()
            if n:
                logger.info(f"[MW] createur : {n} notification(s)")
        except Exception as e:
            logger.warning(f"[MW] suivi createur : {e}")
        await asyncio.sleep(period_s)
