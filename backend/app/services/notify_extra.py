"""
Notifications calculees a intervalles (20/10/2026) :
  - points d'attention nouveaux (tout de suite, ou resume quotidien) ;
  - resume de la semaine d'impression ;
  - imprimante au repos depuis N jours ;
  - mise a jour de BambuNymous disponible (services/version_check) ;
  - succes (services/achievements), modele de « A faire » devenu imprimable ;
  - bobine a secher chargee, bobine oubliee apres le sechage.
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
K_QREADY = "NOTIF_QUEUE_READY"      # modeles de « A faire » deja imprimables
K_DRYN = "NOTIF_DRY_NEEDED"         # bobines a secher deja signalees
K_DRYF = "NOTIF_DRY_FORGOTTEN"      # par unite AMS : {"was", "idle", "sent"}
K_ACC = "NOTIF_ACCESSORIES"         # {id accessoire: "low" | "out"} deja signales
K_UNSOLD = "NOTIF_UNSOLD"           # objets en vente deja signales
K_OVERDUE = "NOTIF_OVERDUE"         # id de la derniere impression signalee en retard
K_MWAUTH = "NOTIF_MW_AUTH"          # "lost" : jeton refuse deja signale
K_BOOSTS = "NOTIF_BOOST_TOKENS"     # {"ids": [jetons boost connus], "reminded": "AAAA-MM-JJ" du dernier rappel}


def _fr(x: float, d: int = 1) -> str:
    return f"{x:.{d}f}".replace(".", ",")


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


# ── « A faire » : modele devenu imprimable ──────────────────────────────────
QUEUE_EVERY_S = 3600


async def queue_ready_tick(cfg) -> int:
    """Un modele de la file a desormais tout son filament en stock."""
    import time
    from . import mw_queue as Q
    if not (await Q._load())["collections"]:
        return 0
    if Q._CACHE[1] is None or time.time() - Q._CACHE[0] >= QUEUE_EVERY_S:
        await Q._recompute()
    models = Q._CACHE[1].get("models") or []
    prev = await _get(K_QREADY, None)
    if not models and prev:
        return 0                               # file vide d'un coup : reponse douteuse, rien a conclure
    ready = {r["design_id"]: r for r in models if r.get("stock_ok")}
    await _put(K_QREADY, list(ready))
    if not isinstance(prev, list):                  # premier passage : on memorise
        return 0
    new = [r for d, r in ready.items() if d not in set(prev)]
    if not new:
        return 0
    name = lambda r: r.get("title_fr") or r.get("title") or r["design_id"]
    if len(new) == 1:
        r = new[0]
        cols = len(r.get("filaments") or [])
        title = f"✅ Prêt à imprimer : {name(r)}"
        lines = [f"🧵 Tout le filament est en stock ({cols} couleur{'s' if cols > 1 else ''}, "
                 f"{_fr(r.get('weight_g') or 0, 0)} g)."]
        if r.get("status") == "ams":
            lines.append("✨ Déjà dans l'AMS.")
    else:
        title = f"✅ {len(new)} modèles de « À faire » prêts à imprimer"
        lines = [f"   • {name(r)}" + (" ✨" if r.get("status") == "ams" else "") for r in new[:6]] + \
                ([f"   • … et {len(new) - 6} autre(s)"] if len(new) > 6 else [])
    cover = next((r.get("cover_url") for r in new if r.get("cover_url")), None)
    await N.notify("mw_queue_ready", title, "\n".join(lines), click=N.app_link(cfg, "/prints?tab=queue"),
                   attach=cover, priority=2)
    return 1


# ── Sechage : bobine a secher chargee, bobine oubliee apres le sechage ───────
def _ams_list():
    try:
        from ..core.mqtt import get_state
        st = get_state()
        return list(st.ams_list or []) if st else None
    except Exception:
        return None


def _ams_name(aid) -> str:
    try:
        from ..core.mqtt import ams_label
        return ams_label(aid)
    except Exception:
        return f"AMS {aid}"


async def dry_needed_tick(cfg) -> int:
    """Une fois par bobine (jusqu'a son sechage) : chargee dans l'AMS alors
    qu'elle n'a jamais ete sechee, ou plus depuis son delai."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament, Spool
    from . import drying
    ams = _ams_list()
    if ams is None:                                  # imprimante injoignable : rien ne change
        return 0
    where = {t.spool_id: a.id for a in ams for t in (a.trays or [])
             if getattr(t, "spool_id", None) and not getattr(t, "empty", False)}
    await drying.load()
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Spool, Filament).join(Filament, Filament.id == Spool.filament_id)
                                 .where(Spool.id.in_(list(where) or [0])))).all()
        st = await _get(K_DRYN, None)
        known = set(st) if isinstance(st, list) else None
        # une bobine notifiee le reste jusqu'a son sechage (meme retiree puis remise)
        if known:
            alive = (await db.execute(select(Spool, Filament).join(Filament, Filament.id == Spool.filament_id)
                                      .where(Spool.id.in_(list(known))))).all()
            known = {s.id for s, f in alive if drying.needs_drying(s, f)}
    wet = {s.id: (s, f) for s, f in rows if drying.needs_drying(s, f)}
    if known is None:                                # premier passage : on memorise
        await _put(K_DRYN, list(wet))
        return 0
    new = [i for i in wet if i not in known]
    await _put(K_DRYN, list(known | set(wet)))
    if not new:
        return 0
    from .notify_events import _fil_label
    now = datetime.utcnow()
    by = {}
    for i in new:
        by.setdefault(where[i], []).append(wet[i])
    for aid, items in by.items():
        lines = []
        for s, f in items:
            ref = drying.dry_reference(s)
            lines.append(f"🧵 {_fil_label(f)}")
            lines.append(f"   jamais séchée" if ref is None else
                         f"   séchée il y a {(now - ref).days} jours (délai : {drying.days_for(f)} jours)")
        n = len(items)
        await N.notify("dry_needed_loaded", f"💧 {'À sécher' if n == 1 else f'{n} bobines à sécher'} avant d'imprimer · "
                       f"{_ams_name(aid)}", "\n".join(lines), click=N.app_link(cfg, "/"), priority=2)
    return 1


async def dry_forgotten_tick(cfg) -> int:
    """Le sechage d'une unite est fini, mais une bobine posee pour secher y
    est toujours au bout de N heures."""
    from . import drying_slots
    ams = _ams_list()
    if ams is None:
        return 0
    hours = N.options_of(cfg, "dry_forgotten")["hours"]
    st = await _get(K_DRYF, {})
    st = st if isinstance(st, dict) else {}
    out, sent = {}, 0
    now = datetime.utcnow()
    for a in ams:
        k = str(a.id)
        e = dict(st.get(k) or {})
        placed = drying_slots.spools_in_ams(a.id)
        if (getattr(a, "dry_time", 0) or 0) > 0:
            out[k] = {"was": True}                    # seche en ce moment
            continue
        if not placed or not e.get("was"):
            continue                                   # rien de pose, ou pas de sechage vu : on oublie
        e.setdefault("idle", now.isoformat())
        if not e.get("sent") and now - datetime.fromisoformat(e["idle"]) >= timedelta(hours=hours):
            from .notify_events import _spool_lines
            lines = [f"Séchage fini depuis {hours} h : range-la au sec (sac étanche, boîte) "
                     "pour garder le bénéfice du séchage."] + await _spool_lines(placed)
            n = len(placed)
            await N.notify("dry_forgotten", f"🧺 {'Bobine toujours' if n == 1 else f'{n} bobines toujours'} dans "
                           f"l'{_ams_name(a.id)}", "\n".join(lines), click=N.app_link(cfg, "/"), priority=2)
            e["sent"] = True
            sent += 1
        out[k] = e
    await _put(K_DRYF, out)
    return sent


# ── Succes ───────────────────────────────────────────────────────────────────
async def friend_achievements_tick(cfg) -> int:
    """Les succes que mes copains viennent de gagner."""
    from . import achievements
    return len(await achievements.friend_news())


async def achievements_tick(cfg) -> int:
    """La notification ne part que si son type est active ; les medailles, elles,
    se tiennent a jour dans tous les cas (voir loop)."""
    from . import achievements
    return len(await achievements.tick())


# ── Accessoires et objets ────────────────────────────────────────────────────
async def accessories_tick(cfg) -> int:
    """Accessoire sous le seuil, ou epuise alors qu'il sert : une fois, jusqu'a
    ce que le stock remonte au-dessus."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.object_history import Accessory, ObjectAccessory
    async with AsyncSessionLocal() as db:
        accs = (await db.execute(select(Accessory))).scalars().all()
        links = (await db.execute(select(ObjectAccessory.accessory_id, ObjectAccessory.object_id))).all()
    used = {}
    for aid, oid in links:
        used.setdefault(aid, set()).add(oid)
    low_on, out_on = N.enabled_in(cfg, "accessory_low"), N.enabled_in(cfg, "accessory_out")
    thr = N.options_of(cfg, "accessory_low")["threshold"]
    st = await _get(K_ACC, None)
    first = not isinstance(st, dict)
    st = {} if first else st
    out, sent = {}, 0
    for a in accs:
        q, n_obj = a.quantity or 0, len(used.get(a.id, ()))
        state = "out" if q == 0 and n_obj else "low" if 0 < q < thr else ""
        prev = st.get(str(a.id), "")
        if state:
            out[str(a.id)] = state
        # deja signale (ou pire deja signale) : rien de neuf
        if first or not state or state == prev or (prev == "out" and state == "low"):
            continue
        link = N.app_link(cfg, "/objects?tab=accessories")
        plural = "s" if n_obj > 1 else ""
        if state == "out" and out_on:
            await N.notify("accessory_out", f"🚫 Rupture : {a.name}",
                           f"Utilisé sur {n_obj} objet{plural} : pense à en recommander.", click=link, priority=3)
            sent += 1
        elif state == "low" and low_on:
            lines = ([f"Utilisé sur {n_obj} objet{plural}."] if n_obj else []) + \
                    ([f"💶 {_fr(a.unit_price, 2)} € pièce"] if a.unit_price else [])
            await N.notify("accessory_low", f"🔩 Plus que {q} : {a.name}", "\n".join(lines), click=link, priority=2)
            sent += 1
    await _put(K_ACC, out)
    return sent


async def unsold_tick(cfg) -> int:
    """Objets en vente depuis plus de N jours : un rappel par objet, groupes."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.object_history import Object
    days = N.options_of(cfg, "objects_unsold")["days"]
    limit = datetime.utcnow() - timedelta(days=days)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Object).where(Object.status == "available", Object.created_at < limit)
                                 .order_by(Object.created_at))).scalars().all()
    ids = [o.id for o in rows]
    st = await _get(K_UNSOLD, None)
    if not isinstance(st, list):                    # premier passage : on memorise
        await _put(K_UNSOLD, ids)
        return 0
    if _now().hour < 10:                            # pas au milieu de la nuit
        return 0
    known = set(st)
    new = [o for o in rows if o.id not in known]
    await _put(K_UNSOLD, [i for i in st if i in set(ids)] + [o.id for o in new])
    if not new:
        return 0
    now = datetime.utcnow()
    lines = [f"   • {o.translated_name or o.name} ({(now - o.created_at).days} j)" for o in new[:8]] + \
            ([f"   • … et {len(new) - 8} autre(s)"] if len(new) > 8 else [])
    n = len(new)
    await N.notify("objects_unsold", f"🧸 {n} objet{'s' if n > 1 else ''} en vente depuis plus de {days} jours",
                   "\n".join(lines), click=N.app_link(cfg, "/objects"), priority=1)
    return 1


# ── Impression en retard ─────────────────────────────────────────────────────
def _printer_state():
    try:
        from ..core.mqtt import get_state
        return get_state()
    except Exception:
        return None


async def overdue_tick(cfg) -> int:
    """Duree prevue par l'imprimante (ecoule + restant) nettement au-dela de
    l'estimation du tranchage : une fois par impression."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    s = _printer_state()
    if not s or str(s.status or "").upper() not in ("RUNNING", "PAUSE"):
        return 0
    async with AsyncSessionLocal() as db:
        p = (await db.execute(select(Print).where(Print.status == "IN_PROGRESS")
                              .order_by(Print.print_date.desc()).limit(1))).scalar_one_or_none()
    if not p or not p.estimated_seconds or p.estimated_seconds < 600:
        return 0
    if await _get(K_OVERDUE, None) == p.id:
        return 0
    pct = N.options_of(cfg, "print_overdue")["pct"]
    elapsed = (datetime.utcnow() - p.print_date).total_seconds()
    rem = int(s.remaining_minutes or 0) * 60
    total = elapsed + rem
    if elapsed < 900 or total <= p.estimated_seconds * (1 + pct / 100):
        return 0
    await _put(K_OVERDUE, p.id)
    over = round((total / p.estimated_seconds - 1) * 100)
    lines = [f"Prévue : {_dur(p.estimated_seconds)} · au rythme actuel : {_dur(total)} (+{over} %)"]
    if rem:
        lines.append(f"⏱ encore {_dur(rem)}")
    if str(s.status).upper() == "PAUSE":
        lines.append("⏸ L'impression est en pause.")
    await N.notify("print_overdue", f"⏳ Impression en retard : {p.translated_name or p.file_name or '?'}",
                   "\n".join(lines), click=N.app_link(cfg, f"/prints?id={p.id}"), priority=3)
    return 1


# ── MakerWorld : jeton refuse ────────────────────────────────────────────────
MW_AUTH_EVERY_S = 3600
_MW_AUTH = {"t": 0.0}


async def mw_auth_tick(cfg) -> int:
    """Une fois par heure : le jeton est-il encore accepte ? Une seule
    notification tant qu'il n'est pas remplace."""
    import time
    from . import makerworld_account as A
    if time.time() - _MW_AUTH["t"] < MW_AUTH_EVERY_S:
        return 0
    _MW_AUTH["t"] = time.time()
    tok = await A.token()
    if not tok:
        await _put(K_MWAUTH, "")
        return 0
    try:
        await A._profile(tok)
        await _put(K_MWAUTH, "")
        return 0
    except A.AccountError as e:
        if "refus" not in str(e).lower():           # profil illisible : pas une deconnexion
            return 0
    except Exception:
        return 0                                    # reseau : on reessaiera
    if await _get(K_MWAUTH, "") == "lost":
        return 0
    await _put(K_MWAUTH, "lost")
    await N.notify("mw_auth_lost", "🔌 MakerWorld : reconnecte ton compte",
                   "Le jeton est refusé ou expiré. Tant qu'il n'est pas remplacé, plus de points, "
                   "de collections ni de file « À faire ».", click=N.app_link(cfg, "/settings?tab=links"), priority=4)
    return 1


# ── MakerWorld : jetons boost ────────────────────────────────────────────────
BOOST_EVERY_S = 3 * 3600
_BOOST = {"t": 0.0}
BOOST_REASONS = {"plan": "avec ton abonnement"}


def _fr_date(iso) -> str:
    """« 16 nov. » en heure locale."""
    try:
        from .achievements import _local
        d = _local(datetime.fromisoformat(str(iso).replace("Z", "+00:00")).replace(tzinfo=None))
    except Exception:
        return "?"
    mois = "janv. févr. mars avr. mai juin juil. août sept. oct. nov. déc.".split()
    return f"{d.day} {mois[d.month - 1]}"


async def boost_tokens_tick(cfg) -> int:
    """Toutes les 3 h : nouveaux jetons boost (notifies a leur arrivee), et
    rappel chaque jour tant qu'un jeton expire sous N jours. Le premier passage
    memorise les jetons deja la sans rien envoyer."""
    import time
    from . import makerworld_account as A
    if time.time() - _BOOST["t"] < BOOST_EVERY_S:
        return 0
    _BOOST["t"] = time.time()
    if not await A.token():
        return 0
    rights = await A.boost_rights()
    now = datetime.utcnow()
    st = await _get(K_BOOSTS, None)
    ids = [r["id"] for r in rights]
    if not isinstance(st, dict):
        await _put(K_BOOSTS, {"ids": ids, "reminded": ""})
        return 0
    known = set(st.get("ids") or [])
    sent = 0
    n_av = len(rights)
    link = N.app_link(cfg, "/prints?tab=makerworld")
    new = [r for r in rights if r["id"] not in known]
    if new and N.enabled_in(cfg, "mw_boost_token"):
        why = {BOOST_REASONS.get(r["reason"], r["reason"]) for r in new} - {""}
        first_exp = min((r["expire_at"] for r in new if r["expire_at"]), default=None)
        lines = [(f"Obtenu{'s' if len(new) > 1 else ''} " + " et ".join(sorted(why)) if why else "Obtenu")
                 + (f" · expire le {_fr_date(first_exp)}" if first_exp else ""),
                 f"🚀 {n_av} jeton{'s' if n_av > 1 else ''} disponible{'s' if n_av > 1 else ''}"]
        await N.notify("mw_boost_token", "🚀 Nouveau jeton boost" if len(new) == 1 else f"🚀 {len(new)} nouveaux jetons boost",
                       "\n".join(lines), click=link, priority=2)
        sent += 1
    days = N.options_of(cfg, "mw_boost_expiring")["days"]
    soon = []
    for r in rights:
        try:
            exp = datetime.fromisoformat(str(r["expire_at"]).replace("Z", "+00:00")).replace(tzinfo=None)
        except (TypeError, ValueError):
            continue
        if now < exp <= now + timedelta(days=days):
            soon.append((exp, r))
    # rappel quotidien (a partir de 9 h, heure de Paris) tant qu'un jeton est sous le seuil
    try:
        from .achievements import _local
        loc = _local(now)
    except Exception:
        loc = now
    today = loc.strftime("%Y-%m-%d")
    due = soon and loc.hour >= 9 and st.get("reminded") != today
    if due and N.enabled_in(cfg, "mw_boost_expiring"):
        soon.sort(key=lambda x: x[0])
        lines = []
        for exp, r in soon[:6]:
            left = (exp - now).days
            lines.append(f"Expire le {_fr_date(r['expire_at'])} ("
                         + ("aujourd'hui" if left < 1 else "demain" if left < 2 else f"dans {left} jours") + ")")
        lines.append(f"🚀 {n_av} jeton{'s' if n_av > 1 else ''} disponible{'s' if n_av > 1 else ''}")
        n = len(soon)
        await N.notify("mw_boost_expiring", f"⏳ {n} jeton{'s' if n > 1 else ''} boost expire{'nt' if n > 1 else ''} bientôt",
                       "\n".join(lines), click=link, priority=3)
        sent += 1
    await _put(K_BOOSTS, {"ids": ids, "reminded": today if due else st.get("reminded", "")})
    return sent


# ── Boucle commune ───────────────────────────────────────────────────────────
# (types qui la reclament, verification) ; None : toujours (les succes se
# tiennent a jour meme quand leur notification est coupee).
_TICKS = [(("attention_new",), attention_tick), (("weekly_summary",), weekly_tick), (("printer_idle",), idle_tick),
          (None, achievements_tick), (("friend_achievement",), friend_achievements_tick),
          (("mw_queue_ready",), queue_ready_tick),
          (("dry_needed_loaded",), dry_needed_tick), (("dry_forgotten",), dry_forgotten_tick),
          (("accessory_low", "accessory_out"), accessories_tick), (("objects_unsold",), unsold_tick),
          (("print_overdue",), overdue_tick), (("mw_auth_lost",), mw_auth_tick),
          (("mw_boost_token", "mw_boost_expiring"), boost_tokens_tick)]


async def loop(period_s: int = 900, first_delay_s: int = 180):
    """Toutes les 15 min : chaque verification seulement si son type est voulu ;
    l'echec de l'une n'empeche pas les autres."""
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            cfg = await N._load()
        except Exception as e:
            cfg = None
            logger.warning(f"[NOTIF] verifications periodiques : {e}")
        for events, tick in _TICKS if cfg else []:
            try:
                if events is None or any(N.enabled_in(cfg, e) for e in events):
                    await tick(cfg)
            except Exception as e:
                logger.warning(f"[NOTIF] {tick.__name__} : {e}")
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
