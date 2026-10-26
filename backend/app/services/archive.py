"""La sauvegarde vers un dossier monte (NAS) et le vidage du local (26/10/2026).

Le conteneur monte un dossier du NAS sur /nas (compose.yaml). La sauvegarde y range, en nommage
humain, une arborescence par modele puis par impression :

    Balancing bird/
        2026-10-25 18h30/
            Fiche.txt              (date, duree, poids, filaments, lien MakerWorld)
            Plateau.png
            3MF/        Balancing bird - tranché.3mf, Balancing bird - origine MakerWorld.3mf
            Photos/     Photo 01.webp…
            Vidéos/     Vidéo 01.mp4…
            Timelapse/  Timelapse.mp4
            Couches/    Couche 1.jpg, Couche 2.jpg, 50 %.jpg, 99 %.jpg, Fin.jpg, Échec.jpg
    _Groupes/<nom du groupe>/…     (photos des groupes)
    _Base/bambunymous-2026-10-26 03h00.db   (les 14 dernieres)

Seul ce qui est nouveau ou a change de taille est copie. Un index (/data/cache/archive_index.json) garde,
pour chaque fichier du dossier de donnees, sa copie sur le NAS : le vidage du local (videos, timelapses,
3MF tranches, captures des couches, plus vieux que N jours, et seulement s'ils sont bien sur le NAS)
s'appuie dessus, et l'appli relit depuis le NAS ce qui n'est plus en local (local_or_archive).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DEFAULT_ROOT = os.getenv("NAS_DIR", "/nas")
DB_KEEP = 14
_STATE = {"running": None, "progress": None}           # « backup » / « purge » en cours, et ou il en est
_INDEX = {"v": None}

LAYERS = {"layer1": "Couche 1", "layer2": "Couche 2", "pct50": "50 %", "pct99": "99 %", "pct100": "Fin", "fail": "Échec"}


# ── Reglages ────────────────────────────────────────────────────────────────────────────────────────
async def settings_get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        g = lambda k, d="": get_setting(db, k, d)
        out = {"dir": (await g("ARCHIVE_DIR", "")).strip() or DEFAULT_ROOT,
               "nightly": (await g("ARCHIVE_NIGHTLY", "0")) == "1",
               "hour": int((await g("ARCHIVE_HOUR", "3")) or 3),
               "purge_auto": (await g("ARCHIVE_PURGE_AUTO", "0")) == "1",
               "purge_days": int((await g("ARCHIVE_PURGE_DAYS", "30")) or 30)}
        try:
            out["last_backup"] = json.loads(await g("ARCHIVE_LAST_BACKUP", "") or "null")
            out["last_purge"] = json.loads(await g("ARCHIVE_LAST_PURGE", "") or "null")
        except ValueError:
            out["last_backup"] = out["last_purge"] = None
    return out


async def settings_set(body: dict) -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        if "dir" in body:
            await set_setting(db, "ARCHIVE_DIR", str(body["dir"] or "").strip())
        if "nightly" in body:
            await set_setting(db, "ARCHIVE_NIGHTLY", "1" if body["nightly"] else "0")
        if "hour" in body:
            await set_setting(db, "ARCHIVE_HOUR", str(max(0, min(23, int(body["hour"])))))
        if "purge_auto" in body:
            await set_setting(db, "ARCHIVE_PURGE_AUTO", "1" if body["purge_auto"] else "0")
        if "purge_days" in body:
            await set_setting(db, "ARCHIVE_PURGE_DAYS", str(max(7, min(3650, int(body["purge_days"])))))
    return await status()


async def _remember(key: str, report: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, key, json.dumps(report, ensure_ascii=False))


def _check_root(root: str) -> dict:
    p = Path(root)
    if not p.is_dir():
        return {"ok": False, "why": f"« {root} » n'existe pas dans le conteneur : monte le dossier du NAS (compose.yaml)."}
    try:
        t = p / ".bambunymous-test"
        t.write_text("ok", encoding="utf-8")
        t.unlink()
    except OSError as e:
        return {"ok": False, "why": f"« {root} » n'est pas inscriptible ({e.strerror or e})."}
    try:
        du = shutil.disk_usage(p)
        free = {"total": du.total, "free": du.free}
    except OSError:
        free = None
    # le dossier monte n'est-il pas simplement le disque du conteneur ? (montage oublie)
    same = False
    try:
        same = os.stat(p).st_dev == os.stat(DATA_DIR).st_dev
    except OSError:
        pass
    return {"ok": True, "disk": free, "same_disk": same}


async def status() -> dict:
    s = await settings_get()
    s["check"] = await asyncio.to_thread(_check_root, s["dir"])
    s["running"], s["progress"] = _STATE["running"], _STATE["progress"]
    idx = _index()
    s["indexed"] = len(idx)
    return s


# ── Nommage humain ──────────────────────────────────────────────────────────────────────────────────
def clean(name: str, maxlen: int = 80) -> str:
    n = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", str(name or "")).strip()
    n = re.sub(r"\.(gcode\.3mf|3mf|gcode|stl)$", "", n, flags=re.I).replace("_", " ")
    n = re.sub(r"\s+", " ", n).strip(" .")
    return (n[:maxlen].strip(" .") or "Sans nom")


def _local(dt: datetime) -> datetime:
    try:
        from .achievements import _local as L
        return L(dt)
    except Exception:
        return dt


def human_name(rel_name: str, model: str) -> str | None:
    """Le chemin, dans le dossier d'une impression, d'un fichier de son dossier de donnees (None : ne pas copier)."""
    low = rel_name.lower()
    ext = os.path.splitext(rel_name)[1].lower()
    if low.startswith("snapshot-"):
        trig = low[len("snapshot-"):].rsplit(".", 1)[0]
        return f"Couches/{LAYERS.get(trig, trig)}{ext}"
    if low == "video-timelapse.mp4":
        return "Timelapse/Timelapse.mp4"
    m = re.match(r"photo-(\d+)", low)
    if m:
        return f"Photos/Photo {int(m.group(1)):02d}{ext}"
    m = re.match(r"video-(\d+)", low)
    if m:
        return f"Vidéos/Vidéo {int(m.group(1)):02d}{ext}"
    if low.startswith("plate"):
        return f"Plateau{ext}"
    if ext == ".3mf":
        return f"3MF/{model} - tranché.3mf"
    if ext in (".mp4", ".webm", ".mov", ".m4v"):
        return f"Vidéos/{rel_name}"
    if ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        return f"Photos/{rel_name}"
    return None


# ── L'index (fichier du dossier de donnees -> copie sur le NAS) ──────────────────────────────────────
def _index_path() -> Path:
    return DATA_DIR / "cache" / "archive_index.json"


def _index() -> dict:
    if _INDEX["v"] is None:
        try:
            _INDEX["v"] = json.loads(_index_path().read_text(encoding="utf-8"))
        except Exception:
            _INDEX["v"] = {}
    return _INDEX["v"]


def _index_save() -> None:
    p = _index_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(_INDEX["v"] or {}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def local_or_archive(rel: str) -> Path | None:
    """Un fichier du dossier de donnees (chemin relatif), en local s'il y est, sinon sa copie sur le NAS."""
    p = DATA_DIR / rel
    if p.is_file():
        return p
    e = _index().get(rel.replace("\\", "/"))
    if not e:
        return None
    q = Path(e.get("root") or DEFAULT_ROOT) / e["to"]
    return q if q.is_file() else None


def archived_names(rel_dir: str) -> list[str]:
    """Les fichiers d'un dossier (« prints/12 ») qui ne sont plus qu'en archive (vides du local)."""
    pre = rel_dir.rstrip("/") + "/"
    out = []
    for k, e in _index().items():
        if k.startswith(pre) and "/" not in k[len(pre):] and e.get("purged") and not (DATA_DIR / k).exists():
            out.append(k[len(pre):])
    return out


# ── La sauvegarde ───────────────────────────────────────────────────────────────────────────────────
def _copy(src: Path, dst: Path) -> bool:
    """Copie si absent ou de taille differente ; rend True si copie."""
    try:
        if dst.is_file() and dst.stat().st_size == src.stat().st_size:
            return False
    except OSError:
        pass
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".part")
    shutil.copyfile(src, tmp)
    os.replace(tmp, dst)
    return True


def _fiche(p, model: str, when: datetime, fil: list, mw_url: str | None) -> str:
    dur = p.duration_seconds or p.estimated_seconds or 0
    lines = [model, "", f"Impression du {when.strftime('%d/%m/%Y à %Hh%M')}",
             f"Statut : {({'SUCCESS': 'réussie', 'FAILED': 'échouée', 'PARTIAL': 'partielle', 'TO_REDO': 'à refaire'}).get(p.status, p.status or '?')}"]
    if dur:
        lines.append(f"Durée : {int(dur // 3600)} h {int(dur % 3600 // 60):02d}")
    if p.total_weight_g:
        lines.append(f"Poids : {round(p.total_weight_g)} g")
    if p.plate_id:
        lines.append(f"Plateau : {p.plate_id}")
    if fil:
        lines += ["", "Filaments :"] + [f"  - {f}" for f in fil]
    if mw_url:
        lines += ["", f"MakerWorld : {mw_url}"]
    if p.file_name and clean(p.file_name) != model:
        lines += ["", f"Fichier : {p.file_name}"]
    return "\n".join(lines) + "\n"


async def _prints_meta():
    """Chaque impression : son modele (nom humain), sa date locale, ses filaments, son lien MakerWorld."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, Group, MakerWorldDesign as MW
    async with AsyncSessionLocal() as db:
        prints = (await db.execute(select(Print).options(selectinload(Print.filament_usage))
                                   .where(Print.status != "IN_PROGRESS").order_by(Print.print_date))).scalars().all()
        dids = list({str(p.design_id) for p in prints if p.design_id})
        mws = {m.design_id: m for m in (await db.execute(select(MW).where(MW.design_id.in_(dids)))).scalars().all()} if dids else {}
        groups = (await db.execute(select(Group))).scalars().all()
    return prints, mws, groups


def _model_of(p, mws) -> str:
    m = mws.get(str(p.design_id)) if p.design_id else None
    return clean((m.title_fr or m.title) if m and (m.title_fr or m.title) else (p.translated_name or p.file_name or f"Impression {p.id}"))


def _backup_sync(root: Path, prints, mws, groups, prog: dict) -> dict:
    from .mw_source import print_file as source_3mf
    idx = _index()
    rep = {"copied": 0, "skipped": 0, "bytes": 0, "errors": 0, "prints": 0}
    taken: dict = {}
    for i, p in enumerate(prints):
        prog.update(done=i, total=len(prints), what=f"impression {i + 1} / {len(prints)}")
        model = _model_of(p, mws)
        when = _local(p.print_date) if p.print_date else datetime(1970, 1, 1)
        stamp = when.strftime("%Y-%m-%d %Hh%M") + (" (échouée)" if p.status == "FAILED" else "")
        rel_dir = f"{model}/{stamp}"
        if taken.get(rel_dir, p.id) != p.id:
            rel_dir += f" #{p.id}"
        taken[rel_dir] = p.id
        d = DATA_DIR / "prints" / str(p.id)
        wrote = False
        try:
            files = [f for f in d.iterdir() if f.is_file()] if d.is_dir() else []
            for f in files:
                h = human_name(f.name, model)
                if not h:
                    continue
                rel = f"prints/{p.id}/{f.name}"
                to = f"{rel_dir}/{h}"
                if _copy(f, root / to):
                    rep["copied"] += 1
                    rep["bytes"] += f.stat().st_size
                    wrote = True
                else:
                    rep["skipped"] += 1
                idx[rel] = {"to": to, "root": str(root), "size": f.stat().st_size, "at": int(time.time()),
                            **({"purged": True} if idx.get(rel, {}).get("purged") else {})}
            # le 3MF d'origine MakerWorld (partage par les impressions du meme modele)
            src = source_3mf(p.design_id, p.mw_profile_id, p.mw_plates) if p.design_id else None
            if src and Path(src).is_file():
                if _copy(Path(src), root / rel_dir / "3MF" / f"{model} - origine MakerWorld.3mf"):
                    rep["copied"] += 1
                    rep["bytes"] += Path(src).stat().st_size
            # la fiche (reecrite si elle a change)
            fil = [f"{u.filament_type or 'Filament'} {u.color_hex or ''} — {round(u.grams_used or 0)} g".replace("  ", " ")
                   for u in (p.filament_usage or []) if (u.grams_used or 0) > 0]
            mw = f"https://makerworld.com/fr/models/{p.design_id}" if p.design_id else None
            txt = _fiche(p, model, when, fil, mw)
            fp = root / rel_dir / "Fiche.txt"
            if not fp.is_file() or fp.read_text(encoding="utf-8", errors="ignore") != txt:
                fp.parent.mkdir(parents=True, exist_ok=True)
                fp.write_text(txt, encoding="utf-8")
                wrote = True
            if wrote:
                rep["prints"] += 1
        except Exception as e:
            rep["errors"] += 1
            logger.warning(f"[ARCHIVE] impression {p.id} : {e}")
        if i % 50 == 0:
            _index_save()
    # les photos des groupes
    for g in groups:
        gd = DATA_DIR / "groups" / str(g.id)
        if not gd.is_dir():
            continue
        for f in gd.iterdir():
            if f.is_file():
                to = f"_Groupes/{clean(g.name or f'Groupe {g.id}')}/{f.name}"
                try:
                    if _copy(f, root / to):
                        rep["copied"] += 1
                        rep["bytes"] += f.stat().st_size
                    idx[f"groups/{g.id}/{f.name}"] = {"to": to, "root": str(root), "size": f.stat().st_size, "at": int(time.time())}
                except Exception:
                    rep["errors"] += 1
    _index_save()
    return rep


def _db_backup_sync(root: Path) -> str | None:
    """Une copie coherente de la base (API de sauvegarde de SQLite), les DB_KEEP dernieres gardees."""
    import sqlite3
    url = os.getenv("DATABASE_URL", "")
    path = url.split(":///", 1)[1] if ":///" in url else str(DATA_DIR / "bambunymous.db")
    if not Path(path).is_file():
        return None
    out = root / "_Base"
    out.mkdir(parents=True, exist_ok=True)
    dest = out / f"bambunymous-{_local(datetime.utcnow()).strftime('%Y-%m-%d %Hh%M')}.db"
    src = sqlite3.connect(path)
    try:
        dst = sqlite3.connect(str(dest) + ".part")
        with dst:
            src.backup(dst)
        dst.close()
    finally:
        src.close()
    os.replace(str(dest) + ".part", dest)
    olds = sorted(out.glob("bambunymous-*.db"))
    for f in olds[:-DB_KEEP]:
        f.unlink(missing_ok=True)
    return dest.name


async def backup(trigger: str = "manuel") -> dict:
    if _STATE["running"]:
        return {"error": "Une sauvegarde ou un vidage est déjà en cours."}
    s = await settings_get()
    chk = await asyncio.to_thread(_check_root, s["dir"])
    if not chk["ok"]:
        rep = {"at": datetime.utcnow().isoformat() + "Z", "trigger": trigger, "error": chk["why"]}
        await _remember("ARCHIVE_LAST_BACKUP", rep)
        return rep
    _STATE["running"], _STATE["progress"] = "backup", {"done": 0, "total": 0, "what": "lecture des impressions"}
    t0 = time.time()
    try:
        prints, mws, groups = await _prints_meta()
        root = Path(s["dir"])
        db_name = await asyncio.to_thread(_db_backup_sync, root)
        rep = await asyncio.to_thread(_backup_sync, root, prints, mws, groups, _STATE["progress"])
        rep.update(at=datetime.utcnow().isoformat() + "Z", trigger=trigger, seconds=round(time.time() - t0), db=db_name)
    except Exception as e:
        logger.exception("[ARCHIVE] sauvegarde")
        rep = {"at": datetime.utcnow().isoformat() + "Z", "trigger": trigger, "error": str(e)[:300]}
    finally:
        _STATE["running"] = _STATE["progress"] = None
    await _remember("ARCHIVE_LAST_BACKUP", rep)
    logger.info(f"[ARCHIVE] sauvegarde ({trigger}) : {rep}")
    return rep


# ── Le vidage du local ──────────────────────────────────────────────────────────────────────────────
def _purgeable(name: str) -> bool:
    low = name.lower()
    return (low.startswith("snapshot-") or low.endswith(".3mf")
            or os.path.splitext(low)[1] in (".mp4", ".webm", ".mov", ".m4v", ".avi"))


def _purge_sync(old_ids: set, prog: dict) -> dict:
    idx = _index()
    rep = {"files": 0, "bytes": 0, "kept_not_archived": 0}
    ids = sorted(old_ids)
    for i, pid in enumerate(ids):
        prog.update(done=i, total=len(ids), what=f"impression {i + 1} / {len(ids)}")
        d = DATA_DIR / "prints" / str(pid)
        if not d.is_dir():
            continue
        for f in d.iterdir():
            if not f.is_file() or not _purgeable(f.name):
                continue
            rel = f"prints/{pid}/{f.name}"
            e = idx.get(rel)
            q = Path(e.get("root") or DEFAULT_ROOT) / e["to"] if e else None
            try:
                ok = q is not None and q.is_file() and q.stat().st_size == f.stat().st_size
            except OSError:
                ok = False
            if not ok:
                rep["kept_not_archived"] += 1            # pas (encore) sur le NAS : on le garde
                continue
            n = f.stat().st_size
            f.unlink()
            e["purged"] = True
            rep["files"] += 1
            rep["bytes"] += n
    _index_save()
    return rep


async def purge(days: int | None = None, trigger: str = "manuel") -> dict:
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    if _STATE["running"]:
        return {"error": "Une sauvegarde ou un vidage est déjà en cours."}
    s = await settings_get()
    days = int(days or s["purge_days"] or 30)
    limit = datetime.utcnow() - timedelta(days=days)
    async with AsyncSessionLocal() as db:
        ids = set((await db.execute(select(Print.id).where(Print.print_date < limit, Print.status != "IN_PROGRESS"))).scalars().all())
    _STATE["running"], _STATE["progress"] = "purge", {"done": 0, "total": len(ids), "what": ""}
    try:
        rep = await asyncio.to_thread(_purge_sync, ids, _STATE["progress"])
        rep.update(at=datetime.utcnow().isoformat() + "Z", trigger=trigger, days=days, prints=len(ids))
    except Exception as e:
        logger.exception("[ARCHIVE] vidage")
        rep = {"at": datetime.utcnow().isoformat() + "Z", "trigger": trigger, "error": str(e)[:300]}
    finally:
        _STATE["running"] = _STATE["progress"] = None
    await _remember("ARCHIVE_LAST_PURGE", rep)
    logger.info(f"[ARCHIVE] vidage ({trigger}) : {rep}")
    return rep


# ── Chaque nuit ────────────────────────────────────────────────────────────────────────────────────
async def nightly_loop() -> None:
    await asyncio.sleep(120)
    done_day = None
    while True:
        try:
            s = await settings_get()
            now = _local(datetime.utcnow())
            if s["nightly"] and now.hour == s["hour"] and done_day != now.date():
                done_day = now.date()
                rep = await backup("nuit")
                if s["purge_auto"] and not rep.get("error"):
                    await purge(s["purge_days"], "nuit")
        except Exception:
            logger.exception("[ARCHIVE] boucle de nuit")
        await asyncio.sleep(300)
