"""
Declencheurs des notifications de l'imprimante et du stock.

Deux entrees :
  - watch(state) : ecouteur de l'etat MQTT (subscribe_state). Il tourne dans le
    fil MQTT a chaque rapport : il ne fait QUE comparer a l'etat precedent, en
    memoire, et confie tout envoi a un fil a part (ni base ni reseau ici).
    Pause, bientot fini, alerte HMS, debut et fin de sechage.
  - des fonctions appelees par le suivi des impressions et les routes :
    demarrage, 1re couche, fin, bobines apres deduction, ajout au panier.

Au demarrage du serveur, le premier etat recu sert de reference : rien n'est
envoye pour ce qui etait deja en cours (pas d'avalanche a chaque redemarrage).
"""
import asyncio
import logging
import threading
import time
from pathlib import Path

from . import notify as N

logger = logging.getLogger(__name__)
DATA_DIR = Path("/data")

LOW_SPOOL_PCT = 15     # memes seuils que les points d'attention
STOCK_LOW_PCT = 25
CANCELLED = 0x0300400C  # print_error : « tache annulee »


def _spawn(fn, *args):
    """Lance une coroutine dans son propre fil (boucle neuve), sans attendre."""
    def _r():
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(fn(*args))
        except Exception:
            logger.exception(f"[NOTIF] {getattr(fn, '__name__', fn)}")
        finally:
            loop.close()
    threading.Thread(target=_r, daemon=True).start()


def _fmt_dur(sec) -> str:
    m = int(round((sec or 0) / 60))
    if m < 60:
        return f"{m} min"
    return f"{m // 60} h {m % 60:02d}"


def _money(v) -> str:
    return f"{v:.2f} €".replace(".", ",")


async def _cfg_for(event: str):
    cfg = await N._load()
    return cfg if N.enabled_in(cfg, event) else None


async def _send(cfg, event: str, title: str, message: str, link=None, priority=3, file=None,
                filename=None, attach=None, actions=None, click=None):
    """Envoi d'un type active : lien vers l'appli en clic et en premier bouton."""
    url = N.app_link(cfg, link) if link is not None else None
    acts = ([("Ouvrir BambuNymous", url)] if url else []) + list(actions or [])
    try:
        await N.send(title, message, click=click or url, priority=priority, file=file, filename=filename,
                     attach=attach, actions=acts)
        logger.info(f"[NOTIF] {event} envoyee : {title}")
    except Exception as e:
        logger.warning(f"[NOTIF] {event} : {e}")


# ── Lecture des impressions ───────────────────────────────────────────────
async def _print_info(pid: int) -> dict:
    """Ce qu'il faut pour ecrire une notification sur une impression."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, FilamentUsage, MakerWorldDesign
    from ..models.filament import Spool, Filament
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            return {}
        rows = (await db.execute(
            select(FilamentUsage, Spool, Filament)
            .outerjoin(Spool, Spool.id == FilamentUsage.spool_id)
            .outerjoin(Filament, Filament.id == Spool.filament_id)
            .where(FilamentUsage.print_id == pid))).all()
        cover = None
        if p.design_id:
            mw = await db.get(MakerWorldDesign, str(p.design_id))
            cover = getattr(mw, "cover_url", None)
    fils = []
    for u, s, f in rows:
        name = (f.translated_name or f.name) if f else (u.filament_type or "Filament")
        where = f" ({s.location})" if s is not None and s.location and s.location != "Tiroir" else ""
        fils.append(f"{name}{where}")
    if cover and "bblmw.com" in cover and "?" not in cover:
        cover += "?x-oss-process=image/resize,w_600/format,webp"
    return {"id": p.id, "name": p.translated_name or p.file_name or p.original_name or f"Impression #{p.id}",
            "design_id": p.design_id, "plate": p.plate_image, "est": p.estimated_seconds,
            "dur": p.duration_seconds, "weight": p.total_weight_g, "cost": p.total_cost,
            "status": p.status, "fils": fils, "cover": cover}


def _mw_action(info):
    did = info.get("design_id")
    return [("Fiche MakerWorld", f"https://makerworld.com/fr/models/{did}")] if did else []


def _image(info, *names):
    """Premiere image existante parmi des chemins relatifs a /data."""
    for rel in names:
        if rel and (DATA_DIR / rel).is_file():
            return DATA_DIR / rel
    return None


def _long_enough(cfg, event, seconds) -> bool:
    mn = N.options_of(cfg, event).get("min_minutes", 0)
    return not mn or (seconds or 0) >= mn * 60


async def _pid_of_job(job_id: str):
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    if not job_id:
        return None
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(Print.id).where(Print.job_id == str(job_id))
                                 .order_by(Print.id.desc()).limit(1))).scalar_one_or_none()


# ── Impressions ───────────────────────────────────────────────────────────
async def print_started(pid: int, wait: float = 120):
    """Attend les metadonnees du 3MF (nom propre, apercu, duree estimee) un
    moment, puis envoie avec ce qu'on a."""
    if not await _cfg_for("print_started"):
        return
    t0 = time.time()
    info = await _print_info(pid)
    while info and not (info["est"] and info["fils"]) and time.time() - t0 < wait:
        await asyncio.sleep(10)
        info = await _print_info(pid)
    cfg = await _cfg_for("print_started")
    if not info or not cfg:
        return
    est = info["est"]
    if not est:
        try:
            from ..core.mqtt import get_state
            est = (get_state().remaining_minutes or 0) * 60
        except Exception:
            est = 0
    if not _long_enough(cfg, "print_started", est):
        return
    lines = [info["name"]]
    bits = ([f"⏱ {_fmt_dur(est)}"] if est else []) + ([f"⚖️ {info['weight']:.0f} g"] if info["weight"] else [])
    if bits:
        lines.append(" · ".join(bits))
    if info["fils"]:
        lines.append("🧵 " + ", ".join(info["fils"]))
    img = _image(info, info["plate"])
    await _send(cfg, "print_started", "▶️ Impression démarrée", "\n".join(lines), link=f"/prints?id={pid}",
                priority=2, file=img, filename="plateau.png", attach=None if img else info["cover"],
                actions=_mw_action(info))


async def print_first_layer(pid: int):
    cfg = await _cfg_for("print_first_layer")
    if not cfg:
        return
    info = await _print_info(pid)
    if not info or not _long_enough(cfg, "print_first_layer", info["est"]):
        return
    img = _image(info, f"prints/{pid}/snapshot-layer1.jpg")
    await _send(cfg, "print_first_layer", "🔍 1re couche terminée",
                f"{info['name']}\nVérifie l'adhérence" + ("" if img else " (pas de photo caméra)."),
                link=f"/prints?id={pid}", priority=3, file=img, filename="couche1.jpg")


async def print_finished(pid: int, status: str, pct: int = 0, print_error: int = 0, wait: float = 40):
    """Fin : attend la photo de fin (prise en parallele) puis envoie."""
    ok = status == "SUCCESS"
    event = "print_done" if ok else "print_failed"
    if not await _cfg_for(event):
        return
    snap = None
    t0 = time.time()
    while time.time() - t0 < wait:
        d = DATA_DIR / "prints" / str(pid)
        snaps = sorted(d.glob("snapshot-pct100.jpg" if ok else "snapshot-fail-*.jpg"),
                       key=lambda x: x.stat().st_mtime) if d.is_dir() else []
        if snaps:
            snap = snaps[-1]
            break
        await asyncio.sleep(3)
    cfg = await _cfg_for(event)
    info = await _print_info(pid)
    if not cfg or not info:
        return
    if ok:
        if not _long_enough(cfg, event, info["dur"] or info["est"]):
            return
        bits = ([f"⏱ {_fmt_dur(info['dur'])}"] if info["dur"] else []) \
            + ([f"⚖️ {info['weight']:.0f} g"] if info["weight"] else []) \
            + ([f"💶 {_money(info['cost'])}"] if info["cost"] else [])
        img = snap or _image(info, info["plate"])
        await _send(cfg, event, "✅ Impression terminée", "\n".join([info["name"]] + ([" · ".join(bits)] if bits else [])),
                    link=f"/prints?id={pid}", priority=3, file=img, filename="fin.jpg",
                    attach=None if img else info["cover"], actions=_mw_action(info))
    else:
        cancelled = int(print_error or 0) == CANCELLED
        title = "🚫 Impression annulée" if cancelled else "❌ Impression en échec"
        await _send(cfg, event, title, f"{info['name']}\nArrêtée à {int(pct or 0)} %",
                    link=f"/prints?id={pid}", priority=3 if cancelled else 5, file=snap, filename="arret.jpg")


async def print_paused(job_id: str, pct: float, hms: list, print_error: int):
    cfg = await _cfg_for("print_paused")
    if not cfg:
        return
    pid = await _pid_of_job(job_id)
    info = await _print_info(pid) if pid else {}
    reasons = []
    try:
        from .hms import decode_hms
        reasons = [e["label"] or e["code"] for e in decode_hms(hms, schedule_fetch=False)]
    except Exception:
        pass
    if not reasons and print_error:
        reasons = [f"code {int(print_error):08X}"]
    lines = [f"{info.get('name') or 'Impression'} · {int(pct or 0)} %"]
    if reasons:
        lines.append("Raison : " + " ; ".join(reasons[:3]))
    await _send(cfg, "print_paused", "⏸️ Impression en pause", "\n".join(lines),
                link=f"/prints?id={pid}" if pid else "/", priority=4)


async def print_near_end(job_id: str, minutes: int, pct: float):
    cfg = await _cfg_for("print_near_end")
    if not cfg:
        return
    pid = await _pid_of_job(job_id)
    info = await _print_info(pid) if pid else {}
    await _send(cfg, "print_near_end", f"⏳ Fin dans {minutes} min",
                f"{info.get('name') or 'Impression'} · {int(pct or 0)} %",
                link=f"/prints?id={pid}" if pid else "/", priority=3)


_LEVELS = {"serious": ("fatal", "serious"), "common": ("fatal", "serious", "common"),
           "all": ("fatal", "serious", "common", "info")}
_SEV_FR = {"fatal": "critique", "serious": "grave", "common": "courante", "info": "info"}


async def printer_hms(entries: list):
    cfg = await _cfg_for("printer_hms")
    if not cfg:
        return
    from .hms import decode_hms
    keep = _LEVELS[N.options_of(cfg, "printer_hms")["level"]]
    for e in decode_hms(entries, schedule_fetch=False):
        if e["severity"] not in keep:
            continue
        await _send(cfg, "printer_hms", f"⚠️ Alerte imprimante ({_SEV_FR.get(e['severity'], e['severity'])})",
                    f"{e['label'] or 'Alerte sans libellé connu'}\n{e['code']}", link="/",
                    priority=5 if e["severity"] == "fatal" else 4 if e["severity"] == "serious" else 3,
                    actions=[("Wiki Bambu", e["wiki"])])


# ── Sechage ───────────────────────────────────────────────────────────────
async def _spool_names(ids) -> list:
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Spool, Filament
    if not ids:
        return []
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Spool.id, Filament.translated_name, Filament.name)
                                 .join(Filament, Filament.id == Spool.filament_id)
                                 .where(Spool.id.in_(list(ids))))).all()
    return [tn or n for _, tn, n in rows]


async def dry_started(label: str, temp: int, hours: int, filament: str, spool_ids: list):
    cfg = await _cfg_for("dry_started")
    if not cfg:
        return
    names = await _spool_names(spool_ids)
    bits = ([f"🌡️ {temp} °C"] if temp else []) + ([f"⏱ {hours} h"] if hours else []) \
        + ([filament] if filament else [])
    lines = ([" · ".join(bits)] if bits else []) + (["🧵 " + ", ".join(names)] if names else [])
    await _send(cfg, "dry_started", f"💧 Séchage démarré · {label}", "\n".join(lines) or label, link="/", priority=2)


async def dry_done(label: str, spool_ids: list):
    cfg = await _cfg_for("dry_done")
    if not cfg:
        return
    names = await _spool_names(spool_ids)
    await _send(cfg, "dry_done", f"☀️ Séchage terminé · {label}",
                ("🧵 " + ", ".join(names)) if names else "Le cycle de séchage est fini.", link="/", priority=3)


# ── Bobines ───────────────────────────────────────────────────────────────
async def fil_to_order(fid: int):
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament
    cfg = await _cfg_for("fil_to_order")
    if not cfg:
        return
    async with AsyncSessionLocal() as db:
        f = await db.get(Filament, fid)
        if not f:
            return
        name, brand = f.translated_name or f.name, f.manufacturer
    await _send(cfg, "fil_to_order", "🛒 Ajouté au panier", " · ".join(x for x in (name, brand) if x),
                link=f"/filaments?id={fid}", priority=2)


async def after_deduction(pid: int, changes: list):
    """Apres la deduction du filament au demarrage d'une impression.
    changes : [{spool_id, filament_id, before, after, grams}]."""
    from sqlalchemy import select, func
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Spool, Filament
    if not changes:
        return
    cfg = await N._load()
    if not any(N.enabled_in(cfg, e) for e in ("spool_short", "spool_low", "stock_low")):
        return
    info = await _print_info(pid)
    async with AsyncSessionLocal() as db:
        fils = {f.id: f for f in (await db.execute(
            select(Filament).where(Filament.id.in_({c["filament_id"] for c in changes})))).scalars().all()}
        counts = dict((await db.execute(
            select(Spool.filament_id, func.count(Spool.id))
            .where(Spool.archived.is_(False), Spool.filament_id.in_(list(fils)))
            .group_by(Spool.filament_id))).all())
    for c in changes:
        f = fils.get(c["filament_id"])
        if not f:
            continue
        name = f.translated_name or f.name
        nominal = f.filament_weight_g or 0
        if N.enabled_in(cfg, "spool_short") and c["grams"] > c["before"]:
            await _send(cfg, "spool_short", "⚠️ Pas assez de filament",
                        f"{info.get('name') or 'Impression'}\n{name} (bobine #{c['spool_id']}) : il faut "
                        f"{c['grams']:.0f} g, il reste {c['before']:.0f} g",
                        link=f"/prints?id={pid}", priority=4)
        if nominal <= 0:
            continue
        pct_b, pct_a = c["before"] / nominal * 100, c["after"] / nominal * 100
        if N.enabled_in(cfg, "spool_low") and pct_b >= LOW_SPOOL_PCT > pct_a:
            await _send(cfg, "spool_low", "🪫 Bobine bientôt vide",
                        f"{name} · bobine #{c['spool_id']}\nReste {c['after']:.0f} g ({pct_a:.0f} %)",
                        link=f"/filaments?id={f.id}", priority=3)
        if N.enabled_in(cfg, "stock_low") and counts.get(f.id) == 1 and pct_b >= STOCK_LOW_PCT > pct_a:
            await _send(cfg, "stock_low", "📉 Fin de stock",
                        f"{name} : dernière bobine, reste {c['after']:.0f} g ({pct_a:.0f} %)",
                        link=f"/filaments?id={f.id}", priority=3)


# ── Ecouteur de l'etat MQTT ───────────────────────────────────────────────
_W = {"init": False, "status": "", "hms": set(), "dry": {}, "near_sent": set(), "near_above": set()}


def _hms_key(e) -> str:
    return f"{e.get('attr')}:{e.get('code')}"


def watch(st) -> None:
    """Appele a chaque rapport MQTT : comparaison en memoire seulement."""
    try:
        _watch(st)
    except Exception:
        logger.exception("[NOTIF] ecouteur MQTT")


def _watch(st) -> None:
    cfg = N.cached()
    if cfg is None:
        return
    on = lambda e: N.enabled_in(cfg, e)
    status = (st.status or "").upper()
    hms = list(st.hms_errors or [])
    codes = {_hms_key(e) for e in hms}
    dry = {a.id: (a.dry_time or 0) > 0 for a in (st.ams_list or [])}
    if not _W["init"]:
        _W.update(init=True, status=status, hms=codes, dry=dry)
        return
    prev = _W["status"]
    job = str(st.job_id or "")

    # Pause
    if status == "PAUSE" and prev and prev != "PAUSE" and on("print_paused"):
        _spawn(print_paused, job, st.progress, hms, st.print_error)

    # Bientot fini : seulement si on a vu le temps restant au-dessus du seuil
    # pour ce travail (un print court ne previent pas des son demarrage).
    if status == "RUNNING" and job:
        mins = N.options_of(cfg, "print_near_end")["minutes"]
        rem = st.remaining_minutes or 0
        if rem > mins:
            _W["near_above"].add(job)
        elif 0 < rem <= mins and job in _W["near_above"] and job not in _W["near_sent"]:
            _W["near_sent"].add(job)
            if on("print_near_end"):
                _spawn(print_near_end, job, rem, st.progress)

    # HMS : seulement les codes nouveaux
    new = [e for e in hms if _hms_key(e) not in _W["hms"]]
    if new and on("printer_hms"):
        _spawn(printer_hms, new)

    # Sechage, unite par unite
    for a in (st.ams_list or []):
        was, now = _W["dry"].get(a.id), dry[a.id]
        if was is None or was == now:
            continue
        ids = [t.spool_id for t in a.trays if getattr(t, "spool_id", None)]
        try:
            from . import drying_slots
            ids += [x for x in drying_slots.spools_in_ams(a.id) if x not in ids]
        except Exception:
            pass
        try:
            from ..core.mqtt import ams_label
            label = ams_label(a.id)
        except Exception:
            label = f"AMS {a.id}"
        if now and on("dry_started"):
            _spawn(dry_started, label, a.dry_temperature, a.dry_duration, a.dry_filament, ids)
        elif not now and on("dry_done"):
            _spawn(dry_done, label, ids)

    _W["status"] = status
    _W["hms"] = codes
    _W["dry"].update(dry)
