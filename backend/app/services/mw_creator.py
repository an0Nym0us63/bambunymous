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
    return {"items": hits, "total": _num(d.get("total")),
            "income": _num(d.get("totalIncome")), "expense": _num(d.get("totalExpense"))}


async def recent_points(days: int = 30, max_pages: int = 10) -> list:
    """Lignes de points des `days` derniers jours (gains seulement)."""
    hit = _cached(("recent", days), False)
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
                        "title_fr": h.get("titleTranslated") or None, "cover_url": h.get("cover"),
                        "downloads": _num(h.get("downloadCount")), "prints": _num(h.get("printCount")),
                        "boosts": _num(h.get("boostCnt")), "likes": _num(h.get("likeCount")),
                        "collections": _num(h.get("collectionCount")), "comments": _num(h.get("commentCount")),
                        "exclusive": bool(h.get("isExclusive")), "created": h.get("createTime")})
        if len(hits) < 50:
            break
        off += 50
    _CACHE["models"] = (time.time(), out)
    return out


async def overview(fresh: bool = False) -> dict:
    prof = await profile(fresh)
    ms = await models(fresh)
    recent = await recent_points(30)
    now = datetime.now(timezone.utc)
    per, e7, e30 = {}, 0.0, 0.0
    for x in recent:
        try:
            t = datetime.fromisoformat(str(x["time"]).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if x["points"] <= 0:
            continue
        e30 += x["points"]
        if now - t <= timedelta(days=7):
            e7 += x["points"]
        if x.get("design_id"):
            per[x["design_id"]] = per.get(x["design_id"], 0) + x["points"]
    for m in ms:
        m["points30"] = round(per.get(m["design_id"], 0), 2)
    return {"profile": prof, "models": ms, "earned7": round(e7, 2), "earned30": round(e30, 2)}


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


EVENTS_HERE = ("mw_points", "mw_boost", "mw_fans", "mw_milestone")


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
    first = await points(0, 50)
    old = await _snap_get()
    snap = {"last_time": max((x["time"] or "" for x in first["items"]), default=(old or {}).get("last_time") or ""),
            "fans": prof["fans"],
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
