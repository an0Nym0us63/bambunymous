"""La sauvegarde vers un dossier monte (NAS) et le vidage du local (26/10/2026).

Le conteneur monte un dossier du NAS sur /nas (compose.yaml). La sauvegarde y range deux dossiers :
« Impressions » (« Groupes », un dossier par groupe, et « Impressions seules » ; puis par modele et par impression)
et « Système » (copies de la base, et le reste des donnees : photos des filaments, objets, accessoires,
bibliotheque des 3MF MakerWorld, catalogue Bambu).

    Impressions/Impressions seules/Balancing bird/
        2026-10-25 18h30/
            Fiche.txt              (date, duree, poids, filaments, lien MakerWorld)
            Plateau.png
            3MF/        Balancing bird - tranché.3mf, Balancing bird - origine MakerWorld.3mf
            Photos/     Photo 01.webp…
            Vidéos/     Vidéo 01.mp4…
            Timelapse/  Timelapse.mp4
            Couches/    Couche 1.jpg, Couche 2.jpg, 50 %.jpg, 99 %.jpg, Fin.jpg, Échec.jpg
    Impressions/Groupes/<nom>/Fiche du groupe.txt, Photos du groupe/, puis ses impressions (modele / date)
    Impressions/_Supprimés/…       (impression, groupe, photo, video… supprimes dans l'appli, jamais effaces)
    Système/Base de données/bambunymous-2026-10-26 03h00.db   (les 14 dernieres)
    Système/Photos des filaments/, Objets/, Accessoires/, 3MF MakerWorld/, Catalogue Bambu/

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

PR = "Impressions"                          # les impressions, en nommage humain
SYS = "Système"                             # la base et le reste des donnees
SUBS = {"Couches", "Photos", "Vidéos", "Timelapse", "3MF"}
GRP = f"{PR}/Groupes"                       # un dossier par groupe : sa fiche, ses photos, ses impressions
SOLO = f"{PR}/Impressions seules"           # les impressions hors groupe
DEL = f"{PR}/_Supprimés"                    # ce qui a disparu de l'appli (jamais efface du NAS)
PH = "Photos du groupe"
STATUS = {"SUCCESS": "réussie", "FAILED": "échouée", "PARTIAL": "partielle", "TO_REDO": "à refaire"}
# le reste des donnees, recopie tel quel dans « Système »
SYSTEM_DIRS = [("filaments", "Photos des filaments"), ("objects", "Objets"), ("accessories", "Accessoires"),
               ("mw_3mf", "3MF MakerWorld"), ("bambu_catalog", "Catalogue Bambu")]

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


MARK = ".bambunymous"


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
    # un dossier monte depuis la machine (volume) est un point de montage ; sinon, c'est un simple dossier
    # du conteneur (montage oublie) : la sauvegarde partirait avec lui.
    try:
        mounted = os.path.ismount(p)
    except OSError:
        mounted = True
    # Partage reseau (NFS, SMB) monte sur la machine : s'il ne l'est pas (au redemarrage), Docker cree un
    # dossier VIDE a sa place, sur le disque du serveur. La premiere sauvegarde y pose un repere ; s'il
    # manque alors que des sauvegardes ont deja ete faites, on refuse de sauvegarder ou de vider.
    if not (p / MARK).exists() and _index():
        return {"ok": False, "why": f"Le repère des sauvegardes manque dans « {root} » : le partage du NAS n'est sans doute pas monté "
                                    "sur la machine (dossier vide à sa place). Rien n'est sauvegardé ni vidé tant qu'il n'est pas revenu.",
                "disk": free}
    return {"ok": True, "disk": free, "not_mounted": not mounted, "first": not (p / MARK).exists()}


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
             f"Statut : {STATUS.get(p.status, p.status or '?')}"]
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
    """Les impressions finies (avec leurs filaments), les fiches MakerWorld, les groupes, et les numeros de TOUTES
    les impressions (une en cours n'est pas « supprimee »)."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, Group, MakerWorldDesign as MW
    async with AsyncSessionLocal() as db:
        prints = (await db.execute(select(Print).options(selectinload(Print.filament_usage))
                                   .where(Print.status != "IN_PROGRESS").order_by(Print.print_date))).scalars().all()
        all_ids = set((await db.execute(select(Print.id))).scalars().all())
        dids = list({str(p.design_id) for p in prints if p.design_id})
        mws = {m.design_id: m for m in (await db.execute(select(MW).where(MW.design_id.in_(dids)))).scalars().all()} if dids else {}
        groups = (await db.execute(select(Group))).scalars().all()
    return prints, mws, groups, all_ids


def _two(fr, orig, maxlen=120) -> str:
    """Le nom traduit d'abord, l'original entre parentheses (les recherches trouvent l'un ou l'autre)."""
    a = clean(fr, maxlen) if fr and str(fr).strip() else ""
    b = clean(orig, maxlen) if orig and str(orig).strip() else ""
    if a and b and a.lower() != b.lower():
        return clean(f"{a} ({b})", maxlen + 40)
    return a or b or "Sans nom"


def _model_of(p, mws) -> str:
    m = mws.get(str(p.design_id)) if p.design_id else None
    if m and (m.title_fr or m.title):
        return _two(m.title_fr, m.title)
    return _two(p.translated_name, p.original_name or p.file_name or f"Impression {p.id}")


def _fiche_group(g, members: list) -> str:
    """La fiche d'un groupe : ses chiffres, et la liste de ses impressions (date, modele, statut)."""
    dur = sum((p.duration_seconds or p.estimated_seconds or 0) for p, _m, _w in members)
    weight = sum((p.total_weight_g or 0) for p, _m, _w in members)
    lines = [g.name or f"Groupe {g.id}", "", f"Groupe de {len(members)} impression{'s' if len(members) > 1 else ''}"]
    if (g.number_of_items or 1) > 1:
        lines.append(f"Pièces : {g.number_of_items}")
    if dur:
        lines.append(f"Durée totale : {int(dur // 3600)} h {int(dur % 3600 // 60):02d}")
    if weight:
        lines.append(f"Poids total : {round(weight)} g")
    dates = [w for _p, _m, w in members if w.year > 1970]
    if dates:
        a, b = min(dates).strftime("%d/%m/%Y"), max(dates).strftime("%d/%m/%Y")
        lines.append(f"Imprimé le {a}" if a == b else f"Imprimé du {a} au {b}")
    if members:
        lines += ["", "Impressions :"] + [f"  - {w.strftime('%d/%m/%Y %Hh%M')} — {m} ({STATUS.get(p.status, p.status or '?')})"
                                          for p, m, w in sorted(members, key=lambda x: x[2])]
    return "\n".join(lines) + "\n"


def _write_if_changed(fp: Path, txt: str) -> bool:
    if fp.is_file() and fp.read_text(encoding="utf-8", errors="ignore") == txt:
        return False
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(txt, encoding="utf-8")
    return True


def _deleted(to: str) -> str:
    """Ou va, dans « _Supprimés », ce qui etait a cet emplacement (meme arborescence)."""
    return f"{DEL}/{to[len(PR) + 1:] if to.startswith(PR + '/') else to}"


def _set_aside(root: Path, idx: dict, key: str, rep: dict) -> None:
    """Un fichier supprime dans l'appli (photo, video…) : sa copie part dans « _Supprimés », l'index l'oublie."""
    e = idx.pop(key, None)
    to = e.get("to") if isinstance(e, dict) else None
    if to and (root / to).exists():
        try:
            _move(root, to, _deleted(to))
            rep["set_aside"] += 1
        except OSError as ex:
            rep["errors"] += 1
            logger.warning(f"[ARCHIVE] mise de cote de {to} : {ex}")


def _move(root: Path, old: str, new: str) -> bool:
    """Deplace un dossier (ou un fichier) du NAS ; fusionne si la destination existe deja."""
    src, dst = root / old, root / new
    if old == new or not src.exists():
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists():
        os.replace(src, dst)
    elif src.is_dir():
        for dirpath, _dirs, files in os.walk(src, topdown=False):
            rel = Path(dirpath).relative_to(src)
            for f in files:
                t = dst / rel / f
                t.parent.mkdir(parents=True, exist_ok=True)
                os.replace(Path(dirpath) / f, t)
            try:
                Path(dirpath).rmdir()
            except OSError:
                pass
    else:
        os.replace(src, dst)
    _prune_empty(root, src.parent)
    return True


def _prune_empty(root: Path, d: Path) -> None:
    """Retire les dossiers laisses vides, en remontant jusqu'a la racine du NAS."""
    try:
        while d != root and root in d.parents and d.is_dir() and not any(d.iterdir()):
            d.rmdir()
            d = d.parent
    except OSError:
        pass


def _retarget(idx: dict, old: str, new: str) -> None:
    """Les fichiers indexes sous l'ancien dossier pointent maintenant sous le nouveau."""
    pre = old.rstrip("/") + "/"
    for k, e in idx.items():
        if isinstance(e, dict) and isinstance(e.get("to"), str) and e["to"].startswith(pre):
            e["to"] = new.rstrip("/") + "/" + e["to"][len(pre):]


def _dir_of(to: str) -> str:
    """Le dossier d'une impression (ou d'un groupe) d'apres le chemin d'un de ses fichiers."""
    parts = to.split("/")
    return "/".join(parts[:-2] if len(parts) > 2 and parts[-2] in SUBS else parts[:-1])


def _migrate_layout(root: Path, idx: dict, rep: dict) -> None:
    """Les sauvegardes d'avant (tout a la racine) : rangees sous « Impressions », la base sous « Système »."""
    if idx.get("@layout") == 2:
        return
    for e in list(root.iterdir()) if root.is_dir() else []:
        if e.name in (PR, SYS, MARK) or e.name.startswith("."):
            continue
        target = f"{SYS}/Base de données" if e.name == "_Base" else f"{PR}/{e.name}"
        try:
            _move(root, e.name, target)
            rep["moved"] += 1
        except OSError as ex:
            rep["errors"] += 1
            logger.warning(f"[ARCHIVE] rangement de {e.name} : {ex}")
    for k, e in idx.items():
        if isinstance(e, dict) and isinstance(e.get("to"), str) and not e["to"].startswith((PR + "/", SYS + "/")):
            e["to"] = f"{PR}/{e['to']}"
    dirs = idx.get("@dirs") or {}
    for k, v in list(dirs.items()):
        if isinstance(v, str) and not v.startswith(PR + "/"):
            dirs[k] = f"{PR}/{v}"
    idx["@layout"] = 2


def _system_sync(root: Path, rep: dict) -> None:
    """Le reste des donnees, recopie tel quel (seul le nouveau ou le change) dans « Système »."""
    for src_name, label in SYSTEM_DIRS:
        src = DATA_DIR / src_name
        if not src.is_dir():
            continue
        for dirpath, _dirs, files in os.walk(src):
            rel = Path(dirpath).relative_to(src)
            for f in files:
                if f.endswith((".part", ".tmp")):
                    continue
                try:
                    if _copy(Path(dirpath) / f, root / SYS / label / rel / f):
                        rep["copied"] += 1
                        rep["bytes"] += (Path(dirpath) / f).stat().st_size
                    else:
                        rep["skipped"] += 1
                except OSError:
                    rep["errors"] += 1


def _backup_sync(root: Path, prints, mws, groups, all_ids: set, prog: dict) -> dict:
    """La sauvegarde, en delta. Copie le nouveau et le change ; DEPLACE sur le NAS ce dont la place a change
    (impression entree ou sortie d'un groupe, groupe renomme, nom traduit…), fichiers deja vides du local compris.
    Ce qui a disparu de l'appli (impression, groupe, photo, video…) part dans « _Supprimés », jamais efface."""
    from .mw_source import print_file as source_3mf
    idx = _index()
    rep = {"copied": 0, "skipped": 0, "moved": 0, "set_aside": 0, "bytes": 0, "errors": 0, "prints": 0}
    _migrate_layout(root, idx, rep)
    dirs = idx.setdefault("@dirs", {})           # « print:12 » / « grp:3 » -> son dossier sur le NAS
    # si les donnees locales ne sont pas la (volume absent), on ne deduit aucune suppression
    local_ok = (DATA_DIR / "prints").is_dir() and any((DATA_DIR / "prints").iterdir())

    # le dossier de chaque groupe (deux groupes du meme nom : son numero en plus)
    gdirs, seen = {}, set()
    for g in sorted(groups, key=lambda g: g.id):
        d = f"{GRP}/{clean(g.name or f'Groupe {g.id}')}"
        if d.lower() in seen:
            d += f" #{g.id}"
        seen.add(d.lower())
        gdirs[g.id] = d

    # l'emplacement de chaque impression : dans son groupe, sinon parmi les impressions seules
    plan, taken = {}, {}
    for p in prints:
        model = _model_of(p, mws)
        when = _local(p.print_date) if p.print_date else datetime(1970, 1, 1)
        stamp = when.strftime("%Y-%m-%d %Hh%M") + (" (échouée)" if p.status == "FAILED" else "")
        rel_dir = f"{gdirs.get(p.group_id, SOLO)}/{model}/{stamp}"
        if taken.get(rel_dir.lower(), p.id) != p.id:
            rel_dir += f" #{p.id}"
        taken[rel_dir.lower()] = p.id
        plan[p.id] = (rel_dir, model, when)

    # 1) les dossiers dont la place a change : deplaces d'un bloc (avec ce qui n'est plus qu'au NAS)
    for p in prints:
        rel_dir = plan[p.id][0]
        old = dirs.get(f"print:{p.id}")
        if not old:
            # sauvegarde d'avant : son dossier se deduit de ses fichiers indexes
            olds = [e["to"] for k, e in idx.items() if k.startswith(f"prints/{p.id}/") and isinstance(e, dict) and e.get("to")]
            old = _dir_of(olds[0]) if olds else None
        if old and old != rel_dir and (root / old).exists():
            try:
                if _move(root, old, rel_dir):
                    _retarget(idx, old, rel_dir)
                    rep["moved"] += 1
            except OSError as e:
                rep["errors"] += 1
                logger.warning(f"[ARCHIVE] deplacement {old} -> {rel_dir} : {e}")
                continue
        dirs[f"print:{p.id}"] = rel_dir

    # 2) chaque impression : ses fichiers (copies, deplaces si leur nom a change, mis de cote si supprimes),
    #    le 3MF d'origine, la fiche
    for i, p in enumerate(prints):
        prog.update(done=i, total=len(prints), what=f"impression {i + 1} / {len(prints)}")
        rel_dir, model, when = plan[p.id]
        d = DATA_DIR / "prints" / str(p.id)
        wrote = False
        try:
            local = {f.name: f for f in d.iterdir() if f.is_file()} if d.is_dir() else {}
            mine = {k: e for k, e in idx.items() if k.startswith(f"prints/{p.id}/") and isinstance(e, dict)}
            # supprime dans l'appli (ni en local, ni vide expres du local) : sa copie part dans « _Supprimés »
            if local_ok and d.is_dir():
                for k, e in mine.items():
                    if not e.get("purged") and k.split("/", 2)[2] not in local:
                        _set_aside(root, idx, k, rep)
            names = set(local) | {k.split("/", 2)[2] for k, e in mine.items() if e.get("purged")}
            for name in sorted(names):
                h = human_name(name, model)
                if not h:
                    continue
                rel, to = f"prints/{p.id}/{name}", f"{rel_dir}/{h}"
                e = idx.get(rel) if isinstance(idx.get(rel), dict) else None
                if e and e.get("to") and e["to"] != to and (root / e["to"]).exists():
                    _move(root, e["to"], to)                     # meme fichier, nouveau nom (modele renomme)
                    rep["moved"] += 1
                f = local.get(name)
                if f is not None:
                    if _copy(f, root / to):
                        rep["copied"] += 1
                        rep["bytes"] += f.stat().st_size
                        wrote = True
                    else:
                        rep["skipped"] += 1
                    idx[rel] = {"to": to, "root": str(root), "size": f.stat().st_size, "at": int(time.time())}
                elif e:                                         # vide du local : il ne vit plus qu'au NAS
                    e.update(to=to, root=str(root))
            # le 3MF d'origine MakerWorld (partage par les impressions du meme modele)
            src = source_3mf(p.design_id, p.mw_profile_id, p.mw_plates) if p.design_id else None
            prev = idx.get(f"src:{p.id}")
            if src and Path(src).is_file():
                to = f"{rel_dir}/3MF/{model} - origine MakerWorld.3mf"
                if isinstance(prev, dict) and prev.get("to") != to and (root / prev["to"]).exists():
                    _move(root, prev["to"], to)
                if _copy(Path(src), root / to):
                    rep["copied"] += 1
                    rep["bytes"] += Path(src).stat().st_size
                    wrote = True
                idx[f"src:{p.id}"] = {"to": to, "root": str(root)}
            elif isinstance(prev, dict) and not p.design_id:     # plus lie a un modele MakerWorld
                _set_aside(root, idx, f"src:{p.id}", rep)
            # la fiche (reecrite si elle a change)
            fil = [f"{u.filament_type or 'Filament'} {u.color_hex or ''} — {round(u.grams_used or 0)} g".replace("  ", " ")
                   for u in (p.filament_usage or []) if (u.grams_used or 0) > 0]
            mw = f"https://makerworld.com/fr/models/{p.design_id}" if p.design_id else None
            g = next((x for x in groups if x.id == p.group_id), None) if p.group_id else None
            txt = _fiche(p, model, when, fil, mw) + (f"\nGroupe : {g.name}\n" if g else "")
            if _write_if_changed(root / rel_dir / "Fiche.txt", txt):
                wrote = True
            if wrote:
                rep["prints"] += 1
        except Exception as e:
            rep["errors"] += 1
            logger.warning(f"[ARCHIVE] impression {p.id} : {e}")
        if i % 50 == 0:
            _index_save()

    # 3) chaque groupe : son dossier (deplace s'il est renomme), sa fiche, ses photos
    for g in groups:
        groot = gdirs[g.id]
        gph = f"{groot}/{PH}"
        old = dirs.get(f"grp:{g.id}")
        pair = (old, groot) if old else None
        if not pair:
            # d'avant : « group:<id> » pointait sur ses photos (« …/Groupe - X/Photos du groupe », ou « _Groupes/X »)
            legacy = dirs.pop(f"group:{g.id}", None)
            if not legacy:
                olds = [e["to"] for k, e in idx.items() if k.startswith(f"groups/{g.id}/") and isinstance(e, dict) and e.get("to")]
                legacy = _dir_of(olds[0]) if olds else None
            if legacy:
                pair = (legacy[:-len(PH) - 1], groot) if legacy.endswith("/" + PH) else (legacy, gph)
        if pair and pair[0] != pair[1] and (root / pair[0]).exists():
            try:
                _move(root, pair[0], pair[1])
                _retarget(idx, pair[0], pair[1])
                rep["moved"] += 1
            except OSError:
                rep["errors"] += 1
        dirs[f"grp:{g.id}"] = groot
        try:
            members = [(p, plan[p.id][1], plan[p.id][2]) for p in prints if p.group_id == g.id]
            _write_if_changed(root / groot / "Fiche du groupe.txt", _fiche_group(g, members))
        except Exception as e:
            rep["errors"] += 1
            logger.warning(f"[ARCHIVE] fiche du groupe {g.id} : {e}")
        gd = DATA_DIR / "groups" / str(g.id)
        local = {f.name: f for f in gd.iterdir() if f.is_file()} if gd.is_dir() else {}
        if local_ok:
            for k in [k for k, e in idx.items() if k.startswith(f"groups/{g.id}/") and isinstance(e, dict)
                      and k.split("/", 2)[2] not in local]:
                _set_aside(root, idx, k, rep)
        for f in local.values():
            to = f"{gph}/{f.name}"
            try:
                if _copy(f, root / to):
                    rep["copied"] += 1
                    rep["bytes"] += f.stat().st_size
                else:
                    rep["skipped"] += 1
                idx[f"groups/{g.id}/{f.name}"] = {"to": to, "root": str(root), "size": f.stat().st_size, "at": int(time.time())}
            except Exception:
                rep["errors"] += 1

    # 4) ce qui a disparu de l'appli : mis de cote dans « _Supprimés » (rien n'est efface du NAS) ;
    #    les impressions d'abord, puis les groupes (qui n'emportent alors que leur fiche et leurs photos)
    live_groups = {g.id for g in groups}
    for key, old in sorted(dirs.items(), key=lambda kv: not kv[0].startswith("print:")):
        kind, _, n = key.partition(":")
        if not n.isdigit() or not isinstance(old, str):
            continue
        gone = (kind == "print" and int(n) not in all_ids) or (kind in ("grp", "group") and int(n) not in live_groups)
        if not gone or old.startswith(DEL + "/"):
            continue
        new = _deleted(old)
        try:
            if (root / old).exists():
                _move(root, old, new)
                _retarget(idx, old, new)
                rep["moved"] += 1
            dirs[key] = new
        except OSError:
            rep["errors"] += 1
    # 5) le reste des donnees, dans « Système »
    prog.update(what="photos des filaments, objets, accessoires, 3MF MakerWorld…")
    _system_sync(root, rep)
    _index_save()
    _nas_changed()
    return rep


def _db_backup_sync(root: Path) -> str | None:
    """Une copie coherente de la base (API de sauvegarde de SQLite), les DB_KEEP dernieres gardees."""
    import sqlite3
    url = os.getenv("DATABASE_URL", "")
    path = url.split(":///", 1)[1] if ":///" in url else str(DATA_DIR / "bambunymous.db")
    if not Path(path).is_file():
        return None
    out = root / SYS / "Base de données"
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
        prints, mws, groups, all_ids = await _prints_meta()
        root = Path(s["dir"])
        if not (root / MARK).exists():
            (root / MARK).write_text("Dossier des sauvegardes de BambuNymous : ne pas supprimer ce fichier.\n", encoding="utf-8")
        db_name = await asyncio.to_thread(_db_backup_sync, root)
        rep = await asyncio.to_thread(_backup_sync, root, prints, mws, groups, all_ids, _STATE["progress"])
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
def _nas_changed() -> None:
    """Le releve du NAS (espace de stockage) est a refaire."""
    from . import storage
    storage._NAS_CACHE["v"] = None


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
    _nas_changed()
    return rep


async def purge(days: int | None = None, trigger: str = "manuel") -> dict:
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    if _STATE["running"]:
        return {"error": "Une sauvegarde ou un vidage est déjà en cours."}
    s = await settings_get()
    chk = await asyncio.to_thread(_check_root, s["dir"])
    if not chk["ok"] or chk.get("first"):
        rep = {"at": datetime.utcnow().isoformat() + "Z", "trigger": trigger,
               "error": chk.get("why") or "Aucune sauvegarde faite dans ce dossier : sauvegarde d'abord."}
        await _remember("ARCHIVE_LAST_PURGE", rep)
        return rep
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
