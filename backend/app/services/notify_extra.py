"""
Notifications calculees a intervalles (20/10/2026) :
  - points d'attention nouveaux (tout de suite, ou resume quotidien) ;
  - resume de la semaine d'impression ;
  - imprimante au repos depuis N jours ;
  - mise a jour de BambuNymous disponible (services/version_check).
Chaque boucle memorise ce qu'elle a deja signale dans un reglage (survit aux
redemarrages) ; un premier passage memorise sans rien envoyer.
"""
import asyncio
import json
import logging
from datetime import datetime, timedelta

from . import notify as N

logger = logging.getLogger(__name__)

K_ATT = "NOTIF_ATTENTION_STATE"     # {"seen": [cles], "pending": {cle: ligne}, "sent_day": "AAAA-MM-JJ"}
K_WEEK = "NOTIF_WEEKLY_SENT"        # "AAAA-MM-JJ" du dernier resume
K_IDLE = "NOTIF_IDLE_SENT"          # id du dernier print au moment du rappel
K_UPD = "NOTIF_UPDATE_SENT"         # dernier commit annonce


async def _get(key, default):
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, key, "")
    try:
        return json.loads(raw) if raw else default
    except ValueError:
        return default


async def _put(key, value) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, key, json.dumps(value, ensure_ascii=False))


def _now():
    """Heure locale du serveur (les heures choisies le sont en heure locale)."""
    return datetime.now()


# ── Points d'attention ──────────────────────────────────────────────────────
def _att_line(a: dict) -> str:
    return f"   • {a.get('title') or ''}" + (f" ({a['metric']})" if a.get("metric") else "")


def _att_message(items: list) -> str:
    """Lignes groupees par categorie, au plus 4 par categorie."""
    by = {}
    for a in items:
        by.setdefault((a.get("cat_icon") or "•", a.get("cat_label") or a.get("category")), []).append(a)
    lines = []
    for (ic, label), xs in by.items():
        lines.append(f"{ic} {label}")
        lines += [_att_line(a) for a in xs[:4]] + ([f"   • … et {len(xs) - 4} autre(s)"] if len(xs) > 4 else [])
    return "\n".join(lines)


async def attention_tick(cfg) -> int:
    """Un passage : nouvelles alertes (ni deja vues, ni mises en sourdine)."""
    from ..db.session import AsyncSessionLocal
    from .attention import all_alerts
    async with AsyncSessionLocal() as db:
        alerts, _ = await all_alerts(db)
    live = {a["key"]: a for a in alerts if not a.get("dismissed")}
    st = await _get(K_ATT, None)
    if not isinstance(st, dict):                    # premier passage : on memorise
        await _put(K_ATT, {"seen": list(live), "pending": {}, "sent_day": ""})
        return 0
    seen = set(st.get("seen") or [])
    pending = {k: v for k, v in (st.get("pending") or {}).items() if k in live}   # resolues entre-temps : oubliees
    for k in live:
        if k not in seen:
            pending[k] = {x: live[k].get(x) for x in ("title", "metric", "cat_icon", "cat_label", "category")}
    opts = N.options_of(cfg, "attention_new")
    sent = 0
    now = _now()
    due = opts["when"] == "now" or (now.hour >= opts["hour"] and st.get("sent_day") != now.strftime("%Y-%m-%d"))
    if pending and due:
        items = list(pending.values())
        n = len(items)
        await N.notify("attention_new", f"⚠️ {n} nouveau{'x' if n > 1 else ''} point{'s' if n > 1 else ''} d'attention",
                       _att_message(items), click=N.app_link(cfg, "/"), priority=2)
        pending, sent = {}, 1
        if opts["when"] != "now":
            st["sent_day"] = now.strftime("%Y-%m-%d")
    # toujours vues : une alerte disparue puis revenue sera de nouveau signalee
    await _put(K_ATT, {"seen": list(live), "pending": pending, "sent_day": st.get("sent_day") or ""})
    return sent


# ── Resume de la semaine ─────────────────────────────────────────────────────
def _dur(sec) -> str:
    m = int((sec or 0) // 60)
    return f"{m // 60} h {m % 60:02d}" if m >= 60 else f"{m} min"


async def weekly_text(days: int = 7):
    """(titre, message) du resume des `days` derniers jours, ou None si rien."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    since = datetime.utcnow() - timedelta(days=days)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print).where(Print.print_date >= since))).scalars().all()
    rows = [p for p in rows if (p.status or "") != "IN_PROGRESS"]
    if not rows:
        return None
    ok = [p for p in rows if p.status in ("SUCCESS", "PARTIAL")]
    ko = [p for p in rows if p.status in ("FAILED", "CANCELLED", "TO_REDO")]
    sec = sum(p.duration_seconds or 0 for p in rows)
    grams = sum(p.total_weight_g or 0 for p in rows)
    cost = sum(p.total_cost or 0 for p in rows)
    longest = max(rows, key=lambda p: p.duration_seconds or 0)
    lines = [f"🖨️ {len(rows)} impression{'s' if len(rows) > 1 else ''} ({len(ok)} réussie{'s' if len(ok) > 1 else ''}"
             + (f", {len(ko)} ratée{'s' if len(ko) > 1 else ''})" if ko else ")"),
             f"⏱ {_dur(sec)} · 🧵 {grams / 1000:.2f} kg · 💶 {cost:.2f} €".replace(".", ",")]
    try:
        from . import mw_creator
        from .makerworld_account import token
        if await token():
            pts = sum(x["points"] for x in await mw_creator.recent_points(days) if x["points"] > 0)
            if pts:
                lines.append(f"🪙 +{pts:.1f} points MakerWorld".replace(".", ","))
    except Exception:
        pass
    if longest.duration_seconds:
        name = longest.translated_name or longest.file_name or "?"
        lines.append(f"🏆 La plus longue : {name} ({_dur(longest.duration_seconds)})")
    return "📊 Ta semaine d'impression", "\n".join(lines)


async def weekly_tick(cfg) -> int:
    opts = N.options_of(cfg, "weekly_summary")
    now = _now()
    if now.weekday() != int(opts["day"]) or now.hour < opts["hour"]:
        return 0
    today = now.strftime("%Y-%m-%d")
    if await _get(K_WEEK, "") == today:
        return 0
    await _put(K_WEEK, today)
    t = await weekly_text()
    if not t:
        return 0
    await N.notify("weekly_summary", t[0], t[1], click=N.app_link(cfg, "/stats"), priority=2)
    return 1


# ── Imprimante au repos ──────────────────────────────────────────────────────
async def idle_tick(cfg) -> int:
    """Une fois par periode de repos : plus d'impression depuis N jours."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    days = N.options_of(cfg, "printer_idle")["days"]
    async with AsyncSessionLocal() as db:
        last = (await db.execute(select(Print).order_by(Print.print_date.desc()).limit(1))).scalar_one_or_none()
    if not last or (last.status or "") == "IN_PROGRESS":
        return 0
    if datetime.utcnow() - last.print_date < timedelta(days=days):
        return 0
    if await _get(K_IDLE, None) == last.id:          # deja rappele pour ce repos
        return 0
    if _now().hour < 10:                            # pas au milieu de la nuit
        return 0
    await _put(K_IDLE, last.id)
    lines = [f"Dernière impression : {last.translated_name or last.file_name or '?'}, "
             f"le {last.print_date.strftime('%d/%m')}."]
    try:
        from . import mw_queue
        n = len((mw_queue._snap_get() or {}).get("models") or [])     # dernier calcul de « A faire »
        if n:
            lines.append(f"📋 {n} modèle{'s' if n > 1 else ''} t'attend{'ent' if n > 1 else ''} dans « À faire ».")
    except Exception:
        pass
    idle = (datetime.utcnow() - last.print_date).days
    await N.notify("printer_idle", f"💤 L'imprimante n'a pas servi depuis {idle} jours", "\n".join(lines),
                   click=N.app_link(cfg, "/prints"), priority=2)
    return 1


# ── Boucle commune ───────────────────────────────────────────────────────────
async def loop(period_s: int = 900, first_delay_s: int = 180):
    """Toutes les 15 min : chaque verification seulement si son type est voulu."""
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            cfg = await N._load()
            if N.enabled_in(cfg, "attention_new"):
                await attention_tick(cfg)
            if N.enabled_in(cfg, "weekly_summary"):
                await weekly_tick(cfg)
            if N.enabled_in(cfg, "printer_idle"):
                await idle_tick(cfg)
        except Exception as e:
            logger.warning(f"[NOTIF] verifications periodiques : {e}")
        await asyncio.sleep(period_s)


async def update_loop(period_s: int = 6 * 3600, first_delay_s: int = 600):
    """Mise a jour de BambuNymous : annoncee une fois par nouveau commit."""
    from . import version_check
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            v = await version_check.check(fresh=True)
            cfg = await N._load()
            if v.get("behind") and v.get("latest") and N.enabled_in(cfg, "app_update") \
                    and await _get(K_UPD, "") != v["latest"]:
                await _put(K_UPD, v["latest"])
                n = v["behind"]
                lines = [f"   • {c}" for c in v.get("commits", [])[:6]] + \
                        ([f"   • … et {n - 6} autre(s)"] if n > 6 else [])
                await N.notify("app_update", f"🆕 BambuNymous : {n} nouveauté{'s' if n > 1 else ''}",
                               "\n".join(lines), click=N.app_link(cfg, "/settings"), priority=2)
        except Exception as e:
            logger.warning(f"[NOTIF] mise a jour : {e}")
        await asyncio.sleep(period_s)
