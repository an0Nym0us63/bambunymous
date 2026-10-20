"""
Declencheurs des notifications de l'imprimante et du stock.

Deux entrees :
  - watch(state) : ecouteur de l'etat MQTT (subscribe_state). Il tourne dans le
    fil MQTT a chaque rapport : il ne fait QUE comparer a l'etat precedent, en
    memoire, et confie tout envoi a un minuteur ou a un fil a part (ni base ni
    reseau ici). Pause, bientot fini, alerte HMS, debut et fin de sechage.
  - des fonctions appelees par le suivi des impressions et les routes :
    demarrage, 1re couche, fin, bobines apres deduction, ajout au panier.

Temporisation : un changement d'etat vu par l'ecouteur n'est notifie que s'il
TIENT quelques secondes (relu a l'echeance). L'imprimante oscille parfois en
changeant d'etat (arret du sechage : fini, reparti, fini dans la meme
seconde) ; un aller-retour bref n'envoie rien, et un etat deja notifie ne
l'est pas deux fois.

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

STABLE_DRY = 20        # secondes : un changement de sechage doit tenir ce temps
STABLE_PAUSE = 10
STABLE_HMS = 10


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


_GEN: dict = {}
_GEN_LOCK = threading.Lock()


def _settle(key: str, delay: float, still, fire) -> None:
    """Rappelle fire() dans `delay` s si still() est encore vrai et qu'aucun
    changement plus recent n'a ete programme sous la meme cle."""
    with _GEN_LOCK:
        gen = _GEN[key] = _GEN.get(key, 0) + 1

    def run():
        with _GEN_LOCK:
            if _GEN.get(key) != gen:
                return
        try:
            if still():
                fire()
        except Exception:
            logger.exception(f"[NOTIF] temporisation {key}")
    t = threading.Timer(delay, run)
    t.daemon = True
    t.start()


def _cancel(key: str) -> None:
    with _GEN_LOCK:
        _GEN[key] = _GEN.get(key, 0) + 1


def _state():
    from ..core.mqtt import get_state
    return get_state()


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
                     attach=attach, actions=acts, event=event)
        logger.info(f"[NOTIF] {event} envoyee : {title}")
    except Exception as e:
        logger.warning(f"[NOTIF] {event} : {e}")


def _fil_label(f, with_brand=True) -> str:
    """« Prune — PLA Matte · Bambu Lab »."""
    name = f.translated_name or f.name
    sub = f.fila_type or f.material
    bits = [b for b in (sub if sub and sub.lower() not in name.lower() else None,
                        f.manufacturer if with_brand else None) if b]
    return f"{name} — {' · '.join(bits)}" if bits else name


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
        label = _fil_label(f, with_brand=False) if f else (u.filament_type or "Filament inconnu")
        where = f" ({s.location})" if s is not None and s.location and s.location != "Tiroir" else ""
        grams = f" — {u.grams_used:.0f} g" if u.grams_used else ""
        fils.append(f"{label}{grams}{where}")
    if cover and "bblmw.com" in cover and "?" not in cover:
        cover += "?x-oss-process=image/resize,w_600/format,webp"
    return {"id": p.id, "name": p.translated_name or p.file_name or p.original_name or f"Impression #{p.id}",
            "design_id": p.design_id, "plate": p.plate_image, "plate_id": p.plate_id, "est": p.estimated_seconds,
            "dur": p.duration_seconds, "weight": p.total_weight_g, "cost": p.total_cost,
            "status": p.status, "fils": fils, "cover": cover}


def _mw_action(info):
    did = info.get("design_id")
    return [("Fiche MakerWorld", f"https://makerworld.com/fr/models/{did}")] if did else []


def _fils_lines(info) -> list:
    f = info.get("fils") or []
    if not f:
        return []
    if len(f) == 1:
        return [f"🧵 {f[0]}"]
    return ["🧵 Filaments :"] + [f"   • {x}" for x in f]


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


def _reasons(hms, print_error) -> list:
    out = []
    try:
        from .hms import decode_hms
        out = [e["label"] or e["code"] for e in decode_hms(hms or [], schedule_fetch=False)]
    except Exception:
        pass
    if not out and print_error and int(print_error) != CANCELLED:
        out = [f"erreur {int(print_error):08X}"]
    return out


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
            est = (_state().remaining_minutes or 0) * 60
        except Exception:
            est = 0
    if not _long_enough(cfg, "print_started", est):
        return
    lines = [f"📄 {info['name']}"]
    if info.get("plate_id") and str(info["plate_id"]) != "1":
        lines.append(f"🗂 Plateau {info['plate_id']}")
    bits = ([f"⏱ durée estimée {_fmt_dur(est)}"] if est else []) + ([f"⚖️ {info['weight']:.0f} g"] if info["weight"] else [])
    if bits:
        lines.append(" · ".join(bits))
    lines += _fils_lines(info)
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
    lines = [f"📄 {info['name']}", "👀 Vérifie l'adhérence avant de laisser filer."
             + ("" if img else " (pas de photo caméra)")]
    try:
        st = _state()
        if st.total_layers:
            lines.append(f"📶 couche {st.layer}/{st.total_layers} · reste {_fmt_dur((st.remaining_minutes or 0) * 60)}")
    except Exception:
        pass
    await _send(cfg, "print_first_layer", "🔍 1re couche terminée", "\n".join(lines),
                link=f"/prints?id={pid}", priority=3, file=img, filename="couche1.jpg")


async def print_finished(pid: int, status: str, pct: int = 0, print_error: int = 0, wait: float = 40):
    """Fin : attend la photo de fin (prise en parallele) puis envoie."""
    ok = status == "SUCCESS"
    event = "print_done" if ok else "print_failed"
    if not await _cfg_for(event):
        return
    try:
        hms = list(_state().hms_errors or [])
    except Exception:
        hms = []
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
        lines = [f"📄 {info['name']}"]
        if info["dur"]:
            lines.append(f"⏱ {_fmt_dur(info['dur'])}" + (f" (prévu {_fmt_dur(info['est'])})" if info["est"] else ""))
        bits = ([f"⚖️ {info['weight']:.0f} g"] if info["weight"] else []) + ([f"💶 {_money(info['cost'])}"] if info["cost"] else [])
        if bits:
            lines.append(" · ".join(bits))
        lines += _fils_lines(info)
        img = snap or _image(info, info["plate"])
        await _send(cfg, event, "✅ Impression terminée", "\n".join(lines),
                    link=f"/prints?id={pid}", priority=3, file=img, filename="fin.jpg",
                    attach=None if img else info["cover"], actions=_mw_action(info))
    else:
        cancelled = int(print_error or 0) == CANCELLED
        title = "🚫 Impression annulée" if cancelled else "❌ Impression en échec"
        lines = [f"📄 {info['name']}", f"📉 Arrêtée à {int(pct or 0)} %"
                 + (f" après {_fmt_dur(info['dur'])}" if info["dur"] else "")]
        rs = [] if cancelled else _reasons(hms, print_error)
        if rs:
            lines.append("⚠️ " + " ; ".join(rs[:3]))
        lines += _fils_lines(info)
        await _send(cfg, event, title, "\n".join(lines),
                    link=f"/prints?id={pid}", priority=3 if cancelled else 5, file=snap, filename="arret.jpg")


async def print_paused(job_id: str, pct: float, hms: list, print_error: int, layer=0, total=0):
    cfg = await _cfg_for("print_paused")
    if not cfg:
        return
    pid = await _pid_of_job(job_id)
    info = await _print_info(pid) if pid else {}
    lines = [f"📄 {info.get('name') or 'Impression'}",
             f"📶 {int(pct or 0)} %" + (f" · couche {layer}/{total}" if total else "")]
    rs = _reasons(hms, print_error)
    lines.append(("⚠️ Raison : " + " ; ".join(rs[:3])) if rs else "Pause demandée (aucune erreur signalée).")
    await _send(cfg, "print_paused", "⏸️ Impression en pause", "\n".join(lines),
                link=f"/prints?id={pid}" if pid else "/", priority=4)


async def print_near_end(job_id: str, minutes: int, pct: float):
    cfg = await _cfg_for("print_near_end")
    if not cfg:
        return
    pid = await _pid_of_job(job_id)
    info = await _print_info(pid) if pid else {}
    lines = [f"📄 {info.get('name') or 'Impression'}", f"📶 {int(pct or 0)} %"]
    await _send(cfg, "print_near_end", f"⏳ Fin dans {minutes} min", "\n".join(lines),
                link=f"/prints?id={pid}" if pid else "/", priority=3)


_LEVELS = {"serious": ("fatal", "serious"), "common": ("fatal", "serious", "common"),
           "all": ("fatal", "serious", "common", "info")}
_SEV_FR = {"fatal": "critique", "serious": "grave", "common": "courante", "info": "info"}


async def printer_hms(entries: list, job_id: str = "", printing: bool = False):
    cfg = await _cfg_for("printer_hms")
    if not cfg:
        return
    from .hms import decode_hms
    keep = _LEVELS[N.options_of(cfg, "printer_hms")["level"]]
    name = None
    if printing and job_id:
        pid = await _pid_of_job(job_id)
        name = (await _print_info(pid)).get("name") if pid else None
    for e in decode_hms(entries, schedule_fetch=False):
        if e["severity"] not in keep:
            continue
        lines = [e["label"] or "Alerte sans libellé connu", f"🔢 {e['code']}"]
        if name:
            lines.append(f"📄 pendant : {name}")
        await _send(cfg, "printer_hms", f"⚠️ Alerte imprimante ({_SEV_FR.get(e['severity'], e['severity'])})",
                    "\n".join(lines), link="/",
                    priority=5 if e["severity"] == "fatal" else 4 if e["severity"] == "serious" else 3,
                    actions=[("Wiki Bambu", e["wiki"])])


# ── Sechage ───────────────────────────────────────────────────────────────
async def _spool_lines(ids) -> list:
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Spool, Filament
    if not ids:
        return []
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Spool, Filament).join(Filament, Filament.id == Spool.filament_id)
                                 .where(Spool.id.in_(list(ids))))).all()
    labels = [_fil_label(f) for _, f in rows]
    if len(labels) == 1:
        return [f"🧵 {labels[0]}"]
    return [f"🧵 {len(labels)} bobines :"] + [f"   • {x}" for x in labels]


async def dry_started(label: str, temp: int, hours: int, filament: str, spool_ids: list, humidity: int = 0):
    cfg = await _cfg_for("dry_started")
    if not cfg:
        return
    bits = ([f"🌡️ {temp} °C"] if temp else []) + ([f"⏱ {hours} h"] if hours else []) \
        + ([f"réglage {filament}"] if filament else [])
    lines = ([" · ".join(bits)] if bits else []) + ([f"💧 humidité de l'AMS : {humidity} %"] if humidity else [])
    lines += await _spool_lines(spool_ids) or ["Aucune bobine connue dans cette unité."]
    await _send(cfg, "dry_started", f"💧 Séchage démarré · {label}", "\n".join(lines), link="/", priority=2)


async def dry_done(label: str, spool_ids: list, temp: int = 0, hours: int = 0, left_min: int = 0, humidity: int = 0):
    cfg = await _cfg_for("dry_done")
    if not cfg:
        return
    stopped = left_min > 3
    done_min = max(0, hours * 60 - left_min) if hours else 0
    if stopped:
        title = f"⏹️ Séchage arrêté · {label}"
        head = f"Arrêté avant la fin : il restait {_fmt_dur(left_min * 60)}" + (f" sur {hours} h" if hours else "")
    else:
        title = f"☀️ Séchage terminé · {label}"
        head = "Cycle complet" + (f" : {hours} h" if hours else "") + (f" à {temp} °C" if temp else "")
    lines = [head]
    if stopped and done_min:
        lines.append(f"⏱ séché {_fmt_dur(done_min * 60)}" + (f" à {temp} °C" if temp else ""))
    if humidity:
        lines.append(f"💧 humidité de l'AMS : {humidity} %")
    lines += await _spool_lines(spool_ids)
    await _send(cfg, "dry_done", title, "\n".join(lines), link="/", priority=3)


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
        name, brand, sub = f.translated_name or f.name, f.manufacturer, f.fila_type or f.material
        n_sp = sum(1 for s in (f.spools or []) if not s.archived)
        left = sum((s.remaining_weight_g or 0) for s in (f.spools or []) if not s.archived)
    lines = [" · ".join(x for x in (name, brand) if x)]
    if sub and sub.lower() not in name.lower():
        lines.append(f"🧵 {sub}")
    lines.append(f"📦 en stock : {n_sp} bobine{'s' if n_sp > 1 else ''}, {left:.0f} g" if n_sp else "📦 plus aucune bobine en stock")
    await _send(cfg, "fil_to_order", "🛒 Ajouté au panier", "\n".join(lines),
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
        full = _fil_label(f)
        nominal = f.filament_weight_g or 0
        if N.enabled_in(cfg, "spool_short") and c["grams"] > c["before"]:
            await _send(cfg, "spool_short", "⚠️ Pas assez de filament",
                        f"📄 {info.get('name') or 'Impression'}\n🧵 {full} (bobine #{c['spool_id']})\n"
                        f"Il faut {c['grams']:.0f} g, il reste {c['before']:.0f} g : il manque {c['grams'] - c['before']:.0f} g",
                        link=f"/prints?id={pid}", priority=4)
        if nominal <= 0:
            continue
        pct_b, pct_a = c["before"] / nominal * 100, c["after"] / nominal * 100
        if N.enabled_in(cfg, "spool_low") and pct_b >= LOW_SPOOL_PCT > pct_a:
            await _send(cfg, "spool_low", "🪫 Bobine bientôt vide",
                        f"🧵 {full} · bobine #{c['spool_id']}\nReste {c['after']:.0f} g ({pct_a:.0f} %)"
                        + (f"\n📦 {counts.get(f.id, 1) - 1} autre(s) bobine(s) en stock" if counts.get(f.id, 1) > 1 else ""),
                        link=f"/filaments?id={f.id}", priority=3)
        if N.enabled_in(cfg, "stock_low") and counts.get(f.id) == 1 and pct_b >= STOCK_LOW_PCT > pct_a:
            await _send(cfg, "stock_low", "📉 Fin de stock",
                        f"🧵 {full}\nDernière bobine : reste {c['after']:.0f} g ({pct_a:.0f} %)\n🛒 pense à en racheter",
                        link=f"/filaments?id={f.id}", priority=3)


# ── Ecouteur de l'etat MQTT ───────────────────────────────────────────────
_W = {"init": False, "status": "", "hms": set(), "hms_sent": set(), "dry": {}, "dry_sent": {},
      "dry_left": {}, "dry_cfg": {}, "near_sent": set(), "near_above": set()}


def _hms_key(e) -> str:
    return f"{e.get('attr')}:{e.get('code')}"


def watch(st) -> None:
    """Appele a chaque rapport MQTT : comparaison en memoire seulement."""
    try:
        _watch(st)
    except Exception:
        logger.exception("[NOTIF] ecouteur MQTT")


def _ams_of(st, ams_id):
    return next((a for a in (st.ams_list or []) if a.id == ams_id), None)


def _watch(st) -> None:
    cfg = N.cached()
    if cfg is None:
        return
    on = lambda e: N.enabled_in(cfg, e)
    status = (st.status or "").upper()
    hms = list(st.hms_errors or [])
    codes = {_hms_key(e) for e in hms}
    dry = {a.id: (a.dry_time or 0) > 0 for a in (st.ams_list or [])}
    for a in (st.ams_list or []):
        if (a.dry_time or 0) > 0:
            _W["dry_left"][a.id] = a.dry_time
            _W["dry_cfg"][a.id] = (a.dry_temperature, a.dry_duration)
    if not _W["init"]:
        _W.update(init=True, status=status, hms=codes, hms_sent=set(codes), dry=dict(dry), dry_sent=dict(dry))
        return
    prev = _W["status"]
    job = str(st.job_id or "")

    # Pause : notifiee si elle tient STABLE_PAUSE s
    if status == "PAUSE" and prev and prev != "PAUSE":
        if on("print_paused"):
            _settle("pause", STABLE_PAUSE, lambda: (_state().status or "").upper() == "PAUSE",
                    lambda: _spawn(print_paused, job, _state().progress, list(_state().hms_errors or []),
                                   _state().print_error, _state().layer, _state().total_layers))
    elif status != "PAUSE" and prev == "PAUSE":
        _cancel("pause")

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

    # HMS : un code nouveau qui tient STABLE_HMS s, une fois tant qu'il reste
    # present (s'il disparait puis revient, il est renotifie).
    _W["hms_sent"] &= codes
    new = [e for e in hms if _hms_key(e) not in _W["hms"] and _hms_key(e) not in _W["hms_sent"]]
    if new and on("printer_hms"):
        keys = [_hms_key(e) for e in new]

        def _fire_hms(keys=keys, new=new):
            cur = {_hms_key(e) for e in (_state().hms_errors or [])}
            left = [e for e, k in zip(new, keys) if k in cur and k not in _W["hms_sent"]]
            _W["hms_sent"].update(_hms_key(e) for e in left)
            if left:
                s = _state()
                _spawn(printer_hms, left, str(s.job_id or ""), (s.status or "").upper() in ("RUNNING", "PAUSE"))
        _settle("hms:" + ",".join(sorted(keys)), STABLE_HMS, lambda: True, _fire_hms)

    # Sechage, unite par unite : le nouvel etat doit tenir STABLE_DRY s, et
    # n'est notifie que s'il differe du dernier etat notifie.
    for a in (st.ams_list or []):
        was, now = _W["dry"].get(a.id), dry[a.id]
        if was is None or was == now:
            continue
        key = f"dry:{a.id}"
        if _W["dry_sent"].get(a.id) == now:
            _cancel(key)            # aller-retour bref : on revient a l'etat deja notifie
            continue
        if not on("dry_started" if now else "dry_done"):
            _W["dry_sent"][a.id] = now
            continue
        left_before = _W["dry_left"].get(a.id, 0)
        temp0, dur0 = _W["dry_cfg"].get(a.id, (0, 0))
        aid = a.id

        def _fire_dry(aid=aid, now=now, left_before=left_before, temp0=temp0, dur0=dur0):
            _W["dry_sent"][aid] = now
            cur = _ams_of(_state(), aid) or a
            ids = [t.spool_id for t in cur.trays if getattr(t, "spool_id", None)]
            try:
                from . import drying_slots
                ids += [x for x in drying_slots.spools_in_ams(aid) if x not in ids]
            except Exception:
                pass
            try:
                from ..core.mqtt import ams_label
                label = ams_label(aid)
            except Exception:
                label = f"AMS {aid}"
            if now:
                _spawn(dry_started, label, cur.dry_temperature, cur.dry_duration, cur.dry_filament, ids, cur.humidity)
            else:
                _spawn(dry_done, label, ids, cur.dry_temperature or temp0, cur.dry_duration or dur0, left_before, cur.humidity)

        def _still(aid=aid, now=now):
            cur = _ams_of(_state(), aid)
            return cur is not None and ((cur.dry_time or 0) > 0) == now
        _settle(key, STABLE_DRY, _still, _fire_dry)

    _W["status"] = status
    _W["hms"] = codes
    _W["dry"].update(dry)
