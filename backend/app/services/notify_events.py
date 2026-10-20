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
OFFLINE_S = 180         # imprimante muette ce temps avant de le dire
STABLE_TRAY = 45        # bobine posee : laisse le temps a la reconnaissance (RFID, appariement)
STABLE_EMPTY = 20
HUMID_S = 600           # humidite au-dessus du seuil pendant ce temps


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
                filename=None, attach=None, actions=None, click=None, icon=None):
    """Envoi d'un type active : lien vers l'appli en clic et en premier bouton.
    file : image locale (piece jointe) ; attach : adresse https de la grande
    image (sans file, ou copie publique de file pour l'appli et le journal) ;
    icon : petite vignette (ntfy, appli Android)."""
    url = N.app_link(cfg, link) if link is not None else None
    acts = ([("Ouvrir BambuNymous", url)] if url else []) + list(actions or [])
    try:
        await N.send(title, message, click=click or url, priority=priority, file=file, filename=filename,
                     attach=attach, actions=acts, event=event, icon=icon)
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


def _public(cfg, path):
    """Adresse https d'une image locale (copie publique de 15 jours), ou None."""
    try:
        return _keep_image(cfg, Path(path).read_bytes()) if path else None
    except OSError:
        return None


def _visuals(cfg, info, big_file=None):
    """(file, attach, icon) d'une notification d'impression : la grande image
    (photo de la camera si on en a une, sinon la couverture MakerWorld, sinon
    le plateau) et une vignette (couverture, sinon plateau)."""
    plate = _image(info, info.get("plate"))
    cover = info.get("cover")
    thumb = cover or _public(cfg, plate)
    if big_file:
        return big_file, _public(cfg, big_file), thumb
    if cover:
        return None, cover, _public(cfg, plate) or cover
    return plate, _public(cfg, plate), None


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
    f, big, thumb = _visuals(cfg, info)
    await _send(cfg, "print_started", "▶️ Impression démarrée", "\n".join(lines), link=f"/prints?id={pid}",
                priority=2, file=f, filename="plateau.png", attach=big, icon=thumb, actions=_mw_action(info))


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
    f, big, thumb = _visuals(cfg, info, img)
    await _send(cfg, "print_first_layer", "🔍 1re couche terminée", "\n".join(lines),
                link=f"/prints?id={pid}", priority=3, file=f, filename="couche1.jpg", attach=big, icon=thumb)


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
        f, big, thumb = _visuals(cfg, info, snap)
        await _send(cfg, event, "✅ Impression terminée", "\n".join(lines),
                    link=f"/prints?id={pid}", priority=3, file=f, filename="fin.jpg",
                    attach=big, icon=thumb, actions=_mw_action(info))
    else:
        cancelled = int(print_error or 0) == CANCELLED
        title = "🚫 Impression annulée" if cancelled else "❌ Impression en échec"
        lines = [f"📄 {info['name']}", f"📉 Arrêtée à {int(pct or 0)} %"
                 + (f" après {_fmt_dur(info['dur'])}" if info["dur"] else "")]
        rs = [] if cancelled else _reasons(hms, print_error)
        if rs:
            lines.append("⚠️ " + " ; ".join(rs[:3]))
        lines += _fils_lines(info)
        f, big, thumb = _visuals(cfg, info, snap)
        await _send(cfg, event, title, "\n".join(lines),
                    link=f"/prints?id={pid}", priority=3 if cancelled else 5, file=f, filename="arret.jpg",
                    attach=big, icon=thumb)


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


# ── Ajouts du 20/10/2026 ──────────────────────────────────────────────────
_SPEED = {1: "Silencieux", 2: "Standard", 3: "Sport", 4: "Ludique"}


async def _job_name(job_id: str):
    pid = await _pid_of_job(job_id)
    info = await _print_info(pid) if pid else {}
    return pid, info


async def print_progress(job_id: str, step: int, layer=0, total=0, rem=0):
    cfg = await _cfg_for("print_progress")
    if not cfg:
        return
    pid, info = await _job_name(job_id)
    if info and not _long_enough(cfg, "print_progress", info.get("est")):
        return
    lines = ([f"🧱 couche {layer}/{total}"] if total else []) + ([f"⏳ encore {_fmt_dur(rem * 60)}"] if rem else [])
    await _send(cfg, "print_progress", f"📶 {step} % · {info.get('name') or 'Impression'}", "\n".join(lines),
                link=f"/prints?id={pid}" if pid else "/", priority=2)


async def print_resumed(job_id: str, paused_s: float, pct: float):
    cfg = await _cfg_for("print_resumed")
    if not cfg:
        return
    pid, info = await _job_name(job_id)
    lines = [f"📄 {info.get('name') or 'Impression'}",
             f"⏸️ en pause pendant {_fmt_dur(paused_s)} · 📶 {int(pct or 0)} %"]
    await _send(cfg, "print_resumed", "▶️ Impression reprise", "\n".join(lines),
                link=f"/prints?id={pid}" if pid else "/", priority=3)


async def print_speed(job_id: str, old: int, new: int, rem: int = 0):
    cfg = await _cfg_for("print_speed")
    if not cfg:
        return
    pid, info = await _job_name(job_id)
    lines = [f"📄 {info.get('name') or 'Impression'}", f"avant : {_SPEED.get(old, old)}"] \
        + ([f"⏳ encore {_fmt_dur(rem * 60)}"] if rem else [])
    await _send(cfg, "print_speed", f"🏎️ Vitesse : {_SPEED.get(new, new)}", "\n".join(lines),
                link=f"/prints?id={pid}" if pid else "/", priority=2)


async def printer_offline(back: bool, down_s: float = 0):
    cfg = await _cfg_for("printer_offline")
    if not cfg:
        return
    if back:
        await _send(cfg, "printer_offline", "📶 Imprimante de nouveau joignable",
                    f"Injoignable pendant {_fmt_dur(down_s)}.", link="/", priority=2)
    else:
        await _send(cfg, "printer_offline", "📴 Imprimante injoignable",
                    f"Plus de nouvelles depuis {OFFLINE_S // 60} min (éteinte, Wi-Fi coupé ?).", link="/", priority=4)


async def bed_cooled(job_id: str, temp: float):
    cfg = await _cfg_for("bed_cooled")
    if not cfg:
        return
    pid, info = await _job_name(job_id)
    lines = ([f"📄 {info['name']}"] if info.get("name") else []) + ["Tu peux retirer la pièce."]
    await _send(cfg, "bed_cooled", f"🧊 Plateau refroidi ({int(temp)} °C)", "\n".join(lines),
                link=f"/prints?id={pid}" if pid else "/", priority=3)


async def printer_firmware(old: str, new: str):
    cfg = await _cfg_for("printer_firmware")
    if cfg:
        await _send(cfg, "printer_firmware", "🆕 Firmware de l'imprimante mis à jour", f"{old} → {new}", link="/", priority=2)


async def ams_humidity(label: str, hum: int, thr: int):
    cfg = await _cfg_for("ams_humidity")
    if cfg:
        await _send(cfg, "ams_humidity", f"💦 {label} trop humide : {hum} %",
                    f"Seuil : {thr} %\nPense au déshydratant, ou à un cycle de séchage.", link="/", priority=3)


def _tray_empty(t) -> bool:
    """Meme regle que l'interface (AMSSection) : drapeau, ou rien d'identifiable."""
    if t.empty:
        return True
    return (t.uuid or "").replace("0", "") == "" and not (t.filament_type or "").strip() \
        and not (t.tray_id_name or "").strip()


def _tray_text(t) -> str:
    bits = [x for x in ((t.tray_id_name or "").strip(), (t.filament_type or "").strip()) if x]
    col = (t.raw_color or t.color or "").lstrip("#")[:6]
    return " · ".join(bits or ["Filament"]) + (f" (#{col.upper()})" if col and col.strip("0") else "")


def _tray_now(ams_id, slot):
    a = _ams_of(_state(), ams_id)
    return next((t for t in (a.trays if a else []) if t.id == slot), None)


def _where(ams_id, slot) -> str:
    try:
        from ..core.mqtt import slot_location
        return slot_location(ams_id, slot)
    except Exception:
        return f"AMS {ams_id} slot {int(slot) + 1}"


async def spool_loaded(ams_id: int, slot: int):
    cfg = await _cfg_for("spool_loaded")
    t = _tray_now(ams_id, slot)
    if not cfg or t is None or _tray_empty(t):
        return
    known = bool(t.spool_id) and t.match_mode not in ("notfound", "manual")
    if N.options_of(cfg, "spool_loaded")["which"] == "unknown" and known:
        return
    lines = (await _spool_lines([t.spool_id]) if t.spool_id else []) or [_tray_text(t)]
    lines = [x.replace("🧵 ", "") for x in lines]
    if t.remain is not None and 0 <= t.remain <= 100 and t.remain:
        lines.append(f"⚖️ reste environ {t.remain} %")
    if not known:
        lines.append("❓ Non reconnue dans ton stock : touche pour l'attribuer.")
    await _send(cfg, "spool_loaded", f"{'🧵 Bobine chargée' if known else '❓ Bobine non reconnue'} · {_where(ams_id, slot)}",
                "\n".join(lines), link="/", priority=2 if known else 3)


async def spool_removed(ams_id: int, slot: int, before):
    cfg = await _cfg_for("spool_removed")
    if not cfg:
        return
    sid, text = before or (None, "")
    lines = [x.replace("🧵 ", "") for x in (await _spool_lines([sid]) if sid else [])] or ([text] if text else [])
    await _send(cfg, "spool_removed", f"📤 Bobine retirée · {_where(ams_id, slot)}", "\n".join(lines),
                link="/", priority=2)


async def _friend_visual(cfg, fid: str, info: dict) -> dict:
    """Visuel de l'impression d'un copain, pour la notification : la couverture
    MakerWorld du modele (publique), sinon l'image du plateau lue chez lui.
    Rend des arguments de N.notify : attach (adresse https) et/ou file."""
    try:
        if info.get("design_id"):
            from .makerworld import fetch_design
            d = await asyncio.to_thread(fetch_design, str(info["design_id"]))
            cover = d.get("cover_url") or ""
            if cover.startswith("https://"):
                if "bblmw.com" in cover and "?" not in cover:
                    cover += "?x-oss-process=image/resize,w_600/format,webp"
                return {"attach": cover}
        if info.get("pid"):
            from .friends import _load, _get
            f = next((x for x in await _load() if str(x["id"]) == str(fid)), None)
            if f:
                r = await asyncio.to_thread(_get, f["url"], f["key"], f"prints/{info['pid']}/image", None, 15)
                if r.status_code == 200 and (r.headers.get("content-type") or "").startswith("image/") and r.content:
                    return {"file": r.content, "filename": "plateau.png", "attach": _keep_image(cfg, r.content)}
    except Exception as e:
        logger.info(f"[NOTIF] visuel copain : {e}")
    return {}


def _keep_image(cfg, data: bytes):
    """Copie publique (15 jours) d'une image sans adresse : l'appli Android et
    le journal ne savent montrer qu'une adresse https."""
    import hashlib
    from ..core.config import settings
    url = N.app_link(cfg, "/uploads/notif/")
    if not url or not url.startswith("https://"):
        return None
    d = Path(settings.UPLOADS_DIR) / "notif"
    d.mkdir(parents=True, exist_ok=True)
    now = time.time()
    for old in d.glob("*.*"):
        if now - old.stat().st_mtime > 15 * 86400:
            old.unlink(missing_ok=True)
    name = hashlib.sha1(data).hexdigest()[:20] + (".jpg" if data[:3] == b"\xff\xd8\xff" else ".png")
    (d / name).write_bytes(data)
    return url + name


K_FRIENDS_LAST = "NOTIF_FRIENDS_LAST"


async def _friends_last_get():
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    import json
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, K_FRIENDS_LAST, "")
    try:
        d = json.loads(raw) if raw else None
    except ValueError:
        d = None
    return d if isinstance(d, dict) else None


async def _friends_last_put(cur) -> None:
    """Le dernier etat de chaque copain, en base : un redemarrage de l'appli
    (mise a jour) ne fait plus perdre un debut ni une fin d'impression. Le
    visuel garde pour la fin n'est garde que par son adresse (pas d'octets)."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    import json
    keep = {fid: {**{k: v for k, v in c.items() if k != "visual"},
                  "visual": {k: v for k, v in (c.get("visual") or {}).items() if k == "attach"}}
            for fid, c in (cur or {}).items()}
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_FRIENDS_LAST, json.dumps(keep, ensure_ascii=False))


async def friends_loop(period_s: int = 300, first_delay_s: int = 120):
    """Copains : leur imprimante commence ou finit d'imprimer. Le tout premier
    passage memorise sans rien envoyer ; ensuite l'etat de reference est relu
    en base (un redemarrage ne fait rien perdre). Un copain injoignable garde
    son dernier etat connu (pas de fausse fin)."""
    await asyncio.sleep(first_delay_s)
    try:
        last = await _friends_last_get()
    except Exception:
        last = None
    while True:
        try:
            cfg = await N._load()
            if not any(N.enabled_in(cfg, e) for e in ("friend_print_started", "friend_print_done", "friend_prints_mine")):
                last = None
            else:
                from . import friends_shared as FS
                friends = await FS._load()
                if not friends:
                    last = None
                else:
                    r = await FS.printing()
                    names = {str(f["id"]): f.get("name") or f"Copain {f['id']}" for f in friends}
                    cur = {}
                    for fid, stt in (r.get("states") or {}).items():
                        if stt.get("state") == "unreachable":
                            if last and fid in last:
                                cur[fid] = last[fid]
                            continue
                        prev = (last or {}).get(fid)
                        if stt.get("state") == "off" and prev and prev.get("state") == "printing" and not prev.get("off_seen"):
                            # imprimante du copain injoignable en pleine impression (Wi-Fi, coupure) :
                            # on attend un 2e passage avant de conclure qu'elle a fini
                            cur[fid] = {**prev, "off_seen": True}
                            continue
                        cur[fid] = {"state": stt.get("state"), "print": None, "rem": 0}
                    for it in r.get("printing") or []:
                        fid = str(it.get("id"))
                        if fid in cur:
                            pi = it.get("print") or {}
                            # le vrai nom (traduit) plutot que le nom du fichier
                            cur[fid].update(print=pi.get("name") or it.get("print_name"), pid=pi.get("id"),
                                            design_id=pi.get("design_id"), rem=it.get("remaining_minutes") or 0)
                    if last is not None:
                        link = N.app_link(cfg, "/")
                        mine = None                     # mes modeles publies (releve du createur), lus au besoin
                        for fid, c in cur.items():
                            p = last.get(fid)
                            if not p or c is p:
                                continue
                            who = names.get(fid, f"Copain {fid}")
                            # toucher la notification : BambuNymous chez ce copain
                            link = N.app_link(cfg, f"/?friend={fid}")
                            if c["state"] == "printing" and p["state"] != "printing":
                                lines = ([f"📄 {c['print']}"] if c["print"] else []) \
                                    + ([f"⏳ encore {_fmt_dur(c['rem'] * 60)}"] if c["rem"] else [])
                                vis = await _friend_visual(cfg, fid, c)
                                c["visual"] = vis              # garde pour la fin
                                await N.notify("friend_print_started", f"👥 {who} imprime", "\n".join(lines),
                                               click=link, priority=2, **vis)
                                if c.get("design_id") and N.enabled_in(cfg, "friend_prints_mine"):
                                    if mine is None:
                                        from .mw_creator import _snap_get
                                        mine = set(((await _snap_get()) or {}).get("models") or {})
                                    if str(c["design_id"]) in mine:
                                        await N.notify("friend_prints_mine", f"🥰 {who} imprime ton modèle",
                                                       f"📄 {c['print']}" if c["print"] else "",
                                                       click=link, priority=3, **vis)
                            elif p["state"] == "printing" and c["state"] != "printing":
                                vis = p.get("visual") or await _friend_visual(cfg, fid, p)
                                await N.notify("friend_print_done", f"👥 {who} a fini d'imprimer",
                                               f"📄 {p['print']}" if p.get("print") else "", click=link, priority=2, **vis)
                    last = cur
                    await _friends_last_put(cur)
        except Exception as e:
            logger.warning(f"[NOTIF] copains : {e}")
        await asyncio.sleep(period_s)


async def mw_rate_loop(period_s: int = 6 * 3600, first_delay_s: int = 900):
    """Impressions a evaluer sur MakerWorld : previent des nouvelles (le
    premier passage memorise)."""
    await asyncio.sleep(first_delay_s)
    seen = None
    while True:
        try:
            cfg = await N._load()
            from .makerworld_account import token
            if not N.enabled_in(cfg, "mw_to_rate") or not await token():
                seen = None
            else:
                from . import mw_rate
                res = await mw_rate.to_rate(fresh=True)
                if not res.get("rated_known"):
                    # liste de mes evaluations illisible : tout semblerait « a evaluer »
                    logger.info("[NOTIF] a evaluer : evaluations MakerWorld illisibles, passage ignore")
                    await asyncio.sleep(period_s)
                    continue
                items = res.get("items") or []
                ids = {str(x.get("design_id")) for x in items}
                if seen is not None:
                    new = [x for x in items if str(x.get("design_id")) not in seen]
                    if new:
                        lines = [f"   • {x.get('title') or 'Modèle ' + str(x.get('design_id'))}" for x in new[:6]] \
                            + ([f"   • … et {len(new) - 6} autre(s)"] if len(new) > 6 else [])
                        link = N.app_link(cfg, "/prints?tab=makerworld")
                        await N.notify("mw_to_rate", f"⭐ {len(new)} impression{'s' if len(new) > 1 else ''} à évaluer",
                                       "\n".join(lines), click=link, priority=2,
                                       actions=[("Ouvrir BambuNymous", link)] if link else None)
                seen = ids
        except Exception as e:
            logger.warning(f"[NOTIF] a evaluer : {e}")
        await asyncio.sleep(period_s)


async def app_started(delay_s: int = 45):
    """Une fois au demarrage, apres avoir laisse l'imprimante se connecter."""
    await asyncio.sleep(delay_s)
    cfg = await N._load()
    if not N.enabled_in(cfg, "app_started"):
        return
    st = _state()
    await N.notify("app_started", "🔄 BambuNymous a redémarré",
                   "🖨️ Imprimante connectée." if st.connected else "📴 Imprimante pas encore joignable.",
                   click=N.app_link(cfg, "/"), priority=1)


# ── Ecouteur de l'etat MQTT ───────────────────────────────────────────────
_W = {"init": False, "status": "", "hms": set(), "hms_sent": set(), "dry": {}, "dry_sent": {},
      "dry_left": {}, "dry_cfg": {}, "near_sent": set(), "near_above": set(),
      # ajouts du 20/10/2026
      "conn": False, "down_at": 0.0, "off_sent": False, "pause_at": 0.0, "prog": {}, "speed": {},
      "bed_armed": False, "bed_job": "", "fw": "", "humid": {}, "trays": {}, "tray_desc": {}}


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
        _W.update(init=True, status=status, hms=codes, hms_sent=set(codes), dry=dict(dry), dry_sent=dict(dry),
                  conn=bool(st.connected), fw=st.fw_version or "")
        _watch_more(st, cfg, status, "", baseline=True)
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

    _watch_more(st, cfg, status, prev)
    _W["status"] = status
    _W["hms"] = codes
    _W["dry"].update(dry)


def _watch_more(st, cfg, status: str, prev: str, baseline: bool = False) -> None:
    """Ajouts du 20/10/2026 : connexion, reprise, avancement, vitesse, plateau,
    firmware, humidite des AMS, bobines posees ou retirees."""
    on = lambda e: N.enabled_in(cfg, e)
    now_t = time.time()
    job = str(st.job_id or "")
    conn = bool(st.connected)

    # Connexion : muette OFFLINE_S avant de le dire ; le retour, si on l'a dit
    if not baseline and conn != _W["conn"]:
        if not conn:
            _W["down_at"] = now_t

            def _fire_off():
                _W["off_sent"] = True
                _spawn(printer_offline, False, 0)
            if on("printer_offline"):
                _settle("offline", OFFLINE_S, lambda: not _state().connected, _fire_off)
        else:
            _cancel("offline")
            if _W["off_sent"]:
                _W["off_sent"] = False
                if on("printer_offline") and N.options_of(cfg, "printer_offline")["back"] == "yes":
                    _spawn(printer_offline, True, now_t - _W["down_at"])
    _W["conn"] = conn
    if not conn:
        return                      # le reste de l'etat est fige : rien a en tirer

    # Reprise apres une pause
    if status == "PAUSE" and prev != "PAUSE":
        _W["pause_at"] = now_t
    elif status == "RUNNING" and prev == "PAUSE" and _W["pause_at"]:
        dur = now_t - _W["pause_at"]
        _W["pause_at"] = 0.0
        if dur >= STABLE_PAUSE and on("print_resumed"):
            _spawn(print_resumed, job, dur, st.progress)

    # Avancement par paliers ; le premier regard sur un travail ne rattrape rien
    if status == "RUNNING" and job:
        step = int(N.options_of(cfg, "print_progress")["step"])
        b = int((st.progress or 0) // step) * step
        last = _W["prog"].get(job)
        if last is None or baseline:
            _W["prog"][job] = b
        elif last < b < 100:
            _W["prog"][job] = b
            if on("print_progress"):
                _spawn(print_progress, job, b, st.layer, st.total_layers, st.remaining_minutes)

    # Vitesse : le nouveau reglage doit tenir 10 s ; compare au dernier dit
    if status == "RUNNING" and job and st.speed_level:
        sp = st.speed_level
        told = _W["speed"].get(job)
        if told is None or baseline:
            _W["speed"][job] = sp
        elif sp != told and on("print_speed"):
            def _fire_speed(job=job, sp=sp):
                old = _W["speed"].get(job)
                if old is not None and old != sp:
                    _W["speed"][job] = sp
                    _spawn(print_speed, job, old, sp, _state().remaining_minutes)
            _settle("speed", 10, lambda sp=sp: _state().speed_level == sp, _fire_speed)
        elif sp != told:
            _W["speed"][job] = sp

    # Plateau refroidi apres une fin (reussie ou non)
    if status in ("FINISH", "FAILED") and prev in ("RUNNING", "PAUSE"):
        _W["bed_armed"], _W["bed_job"] = True, job
    elif status in ("RUNNING", "PREPARE"):
        _W["bed_armed"] = False
    if _W["bed_armed"] and 0 < (st.bed_temp or 0):
        thr = N.options_of(cfg, "bed_cooled")["temp"]
        if st.bed_temp < thr:
            _W["bed_armed"] = False
            if on("bed_cooled"):
                _spawn(bed_cooled, _W["bed_job"], st.bed_temp)

    # Firmware
    fw = st.fw_version or ""
    if fw and _W["fw"] and fw != _W["fw"] and not baseline and on("printer_firmware"):
        _spawn(printer_firmware, _W["fw"], fw)
    if fw:
        _W["fw"] = fw

    # Humidite des AMS : au-dessus du seuil HUMID_S ; reamorcee 5 points sous le seuil
    thr = N.options_of(cfg, "ams_humidity")["pct"]
    for a in (st.ams_list or []):
        hum = a.humidity or 0
        if not hum:
            continue
        was = _W["humid"].get(a.id)
        if was is None or baseline:
            _W["humid"][a.id] = hum >= thr      # deja humide au demarrage : rien
            continue
        if hum >= thr and not was:
            def _fire_humid(aid=a.id):
                cur = _ams_of(_state(), aid)
                if cur is None or (cur.humidity or 0) < thr or _W["humid"].get(aid):
                    return
                _W["humid"][aid] = True
                try:
                    from ..core.mqtt import ams_label
                    label = ams_label(aid)
                except Exception:
                    label = f"AMS {aid}"
                if label and not label.upper().startswith(("AMS", "HT")):
                    label = f"AMS {label}"
                _spawn(ams_humidity, label, cur.humidity, thr)
            if on("ams_humidity"):
                _settle(f"humid:{a.id}", HUMID_S, lambda aid=a.id: ((_ams_of(_state(), aid) or a).humidity or 0) >= thr,
                        _fire_humid)
        elif hum <= thr - 5 and was:
            _W["humid"][a.id] = False
            _cancel(f"humid:{a.id}")

    # Bobines posees ou retirees, emplacement par emplacement
    for a in (st.ams_list or []):
        for t in a.trays:
            key = (a.id, t.id)
            empty = _tray_empty(t)
            if not empty:
                _W["tray_desc"][key] = (t.spool_id, _tray_text(t))
            was = _W["trays"].get(key)
            _W["trays"][key] = empty
            if was is None or baseline or was == empty:
                continue
            k = f"tray:{a.id}:{t.id}"
            if not empty:
                # changement de filament (succes) : note en memoire, une fois stable
                from . import ams_log
                _settle(f"chg:{a.id}:{t.id}", STABLE_TRAY,
                        lambda aid=a.id, sl=t.id: (lambda x: x is not None and not _tray_empty(x))(_tray_now(aid, sl)),
                        ams_log.record)
            if not empty and on("spool_loaded"):
                _settle(k, STABLE_TRAY, lambda aid=a.id, sl=t.id: (lambda x: x is not None and not _tray_empty(x))(_tray_now(aid, sl)),
                        lambda aid=a.id, sl=t.id: _spawn(spool_loaded, aid, sl))
            elif empty and on("spool_removed"):
                before = _W["tray_desc"].get(key)
                _settle(k, STABLE_EMPTY, lambda aid=a.id, sl=t.id: (lambda x: x is None or _tray_empty(x))(_tray_now(aid, sl)),
                        lambda aid=a.id, sl=t.id, before=before: _spawn(spool_removed, aid, sl, before))
            else:
                _cancel(k)
