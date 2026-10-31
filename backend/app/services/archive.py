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
# les assemblages edites de la vue 3D et leurs versions (30/10/2026) : faits a la main, a garder
SYSTEM_DIRS = [("bambu_catalog", "Catalogue Bambu"), ("mw_3d_edits", "Assemblages 3D")]
# les photos des filaments, objets et accessoires : un dossier par element, a son nom (voir _named_sync)
SYS_NAMED = [("filaments", "Photos des filaments"), ("objects", "Objets"), ("accessories", "Accessoires")]
SYS_DEL = f"{SYS}/_Supprimés"
LIB = f"{SYS}/3MF MakerWorld"               # rangee par modele, nommee (voir _library_sync)

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
    # les vues prises dans la vue 3D (30/10/2026) ; leur mosaique se refait, elle ne se copie pas
    m = re.fullmatch(r"vue3d(?:_(\d))?\.png", low)
    if m:
        return f"Vues 3D/Vue {m.group(1) or 1}.png"
    if low.startswith("vue3d_mix"):
        return None
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


# Ce qui n'est plus que sur le NAS, par dossier (28/10/2026) : la fiche d'une impression ou d'un groupe le signale
# d'une pastille, et le detail s'ouvre en popup. Le classement par dossier est refait quand l'index change.
_PURGED = {"ref": None, "n": -1, "by_dir": {}}


def _purged_by_dir() -> dict:
    idx = _index()
    if _PURGED["ref"] is idx and _PURGED["n"] == len(idx):
        return _PURGED["by_dir"]
    by: dict = {}
    for k, e in idx.items():
        if not isinstance(e, dict) or not e.get("purged") or ":" in k.split("/", 1)[0]:
            continue
        d, _, name = k.rpartition("/")
        by.setdefault(d, []).append((name, e))
    _PURGED.update(ref=idx, n=len(idx), by_dir=by)
    return by


def nas_label(name: str) -> tuple[str, str]:
    """(icone, libelle lisible) d'un fichier du dossier d'une impression."""
    low = name.lower()
    ext = os.path.splitext(low)[1]
    if low.startswith("snapshot-"):
        trig = low[len("snapshot-"):].rsplit(".", 1)[0]
        return "🎞️", f"Capture · {LAYERS.get(trig, trig)}"
    if low == "video-timelapse.mp4":
        return "⏩", "Timelapse"
    if ext == ".3mf":
        return "📐", "3MF tranché"
    if ext in (".mp4", ".webm", ".mov", ".m4v", ".avi"):
        return "🎬", "Vidéo"
    if low.startswith("photo-"):
        return "📷", "Photo"
    return "📄", name


def nas_only(rel_dir: str) -> list[dict]:
    """Les fichiers d'un dossier qui ne sont plus qu'en archive, avec leur libelle, leur taille, et s'ils repondent
    sur le NAS en ce moment (present : False = le NAS ne repond pas, ou le fichier a bouge)."""
    out = []
    for name, e in _purged_by_dir().get(rel_dir.rstrip("/"), ()):
        if (DATA_DIR / rel_dir / name).exists():
            continue
        q = Path(e.get("root") or DEFAULT_ROOT) / e["to"]
        try:
            present = q.is_file()
        except OSError:
            present = False
        icon, label = nas_label(name)
        out.append({"name": name, "icon": icon, "label": label, "size": e.get("size"), "at": e.get("at"), "present": present})
    return out


def purged_count(rel_dir: str) -> int:
    """Combien de fichiers d'un dossier ne sont plus que sur le NAS (sans toucher au disque : la liste)."""
    return len(_purged_by_dir().get(rel_dir.rstrip("/"), ()))


def archived_path(key: str) -> Path | None:
    """La copie sur le NAS d'une entree de l'index (« lib:<instance> », « doc:<modele>:<id> »…), si elle y est."""
    e = _index().get(key)
    if not isinstance(e, dict) or not e.get("to"):
        return None
    q = Path(e.get("root") or DEFAULT_ROOT) / e["to"]
    try:
        return q if q.is_file() else None
    except OSError:
        return None


# ── Ce qui, pour un MODELE MakerWorld, n'est plus que sur le NAS (28/10/2026) : vue 3D, 3MF d'origine, documents ──
_MKIND = {"lib": ("📐", "3MF d'origine"), "3d": ("🧊", "Vue 3D"), "doc": ("📄", "Document")}


def _iid_to_did() -> dict:
    """instance -> modele, d'apres l'index des 3MF d'origine (« modele:profil » -> instance)."""
    try:
        from .mw_source import _index as _mw_index
        return {v: k.split(":", 1)[0] for k, v in _mw_index().items() if isinstance(v, str)}
    except Exception:
        return {}


_PURGED_M = {"ref": None, "n": -1, "by_did": {}}


def _purged_by_model() -> dict:
    idx = _index()
    if _PURGED_M["ref"] is idx and _PURGED_M["n"] == len(idx):
        return _PURGED_M["by_did"]
    inv = _iid_to_did()
    by: dict = {}
    for k, e in idx.items():
        if not isinstance(e, dict) or not e.get("purged"):
            continue
        kind, _, rest = k.partition(":")
        if kind not in _MKIND:
            continue
        did = rest.split(":", 1)[0] if kind == "doc" else inv.get(rest)
        if did:
            by.setdefault(str(did), []).append((kind, k, e))
    _PURGED_M.update(ref=idx, n=len(idx), by_did=by)
    return by


def nas_only_model(did) -> list[dict]:
    """Les fichiers d'un modele (vue 3D, 3MF d'origine, documents) vides du local, avec s'ils repondent sur le NAS."""
    out = []
    for kind, key, e in _purged_by_model().get(str(did or ""), ()):
        if e.get("src") and (DATA_DIR / e["src"]).exists():
            continue                                  # revenu en local (repris du NAS, retelecharge)
        q = Path(e.get("root") or DEFAULT_ROOT) / e["to"]
        try:
            present = (q / "plates.json").is_file() if kind == "3d" else q.is_file()
        except OSError:
            present = False
        icon, label = _MKIND[kind]
        name = e["to"].rsplit("/", 1)[-1]
        out.append({"name": name, "icon": icon, "label": label if kind != "doc" else f"Document · {name}", "kind": kind,
                    "size": e.get("size"), "at": e.get("at"), "present": present})
    return out


def purged_count_model(did) -> int:
    return len(_purged_by_model().get(str(did or ""), ())) if did else 0


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


async def _named_meta() -> dict:
    """Le nom humain du dossier de chaque filament, objet et accessoire (id -> chemin sous son dossier)."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament
    from ..models.object_history import Object, Accessory
    async with AsyncSessionLocal() as db:
        fils = (await db.execute(select(Filament.id, Filament.manufacturer, Filament.translated_name, Filament.name))).all()
        objs = (await db.execute(select(Object.id, Object.translated_name, Object.name))).all()
        accs = (await db.execute(select(Accessory.id, Accessory.category, Accessory.name))).all()
    return {
        "filaments": {i: clean(" - ".join(filter(None, [m, tr or n]))) for i, m, tr, n in fils},
        "objects": {i: clean(tr or n) for i, tr, n in objs},
        # les accessoires par categorie (Visserie, Aimants…), puis a leur nom
        "accessories": {i: (f"{clean(c)}/{clean(n)}" if c and c.strip() else clean(n)) for i, c, n in accs},
    }


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
        dids = {str(p.design_id) for p in prints if p.design_id}
        try:                                     # les modeles de la bibliotheque des 3MF d'origine, pour leur nom
            from .mw_source import _index as _mw_index
            dids |= {k.split(":", 1)[0] for k in _mw_index() if k.split(":", 1)[0].isdigit()}
        except Exception:
            pass
        dids = list(dids)
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


def _library_plan(mws: dict) -> dict:
    """Le nom humain, sur le NAS, de chaque 3MF d'origine de la bibliotheque (son instance -> chemin) :
    « 3MF MakerWorld/<modele traduit (original)>/<modele traduit> - profil <n>.3mf ». Un fichier qu'aucun
    modele connu ne reclame va dans « _Autres »."""
    try:
        from .mw_source import _index as _mw_index, _dir as _mw_dir
        idx, d = _mw_index(), _mw_dir()
    except Exception:
        return {}
    by_iid: dict = {}
    for key, iid in idx.items():
        did, _, prof = str(key).partition(":")
        if iid and (iid not in by_iid or (prof and not by_iid[iid][1])):
            by_iid[iid] = (did, prof)
    plan, taken = {}, set()
    for f in sorted(d.glob("*.3mf")) if d.is_dir() else []:
        iid = f.stem
        did, prof = by_iid.get(iid, (None, None))
        if not did:
            plan[iid] = f"{LIB}/_Autres/{f.name}"
            continue
        m = mws.get(did) or mws.get(str(did))
        title = _two(m.title_fr, m.title) if m and (m.title_fr or m.title) else f"Modèle {did}"
        short = clean(m.title_fr or m.title) if m and (m.title_fr or m.title) else f"Modèle {did}"
        name = f"{short} - profil {prof}" if prof else f"{short} - modèle"
        rel = f"{LIB}/{title}/{name}.3mf"
        if rel.lower() in taken:
            rel = f"{LIB}/{title}/{name} ({iid}).3mf"
        taken.add(rel.lower())
        plan[iid] = rel
    return plan


def _docs_sync(root: Path, idx: dict, mws: dict, rep: dict) -> dict:
    """Les documents joints des modeles (notices, solutions… gardes ici, 27/10/2026), ranges avec leurs 3MF
    d'origine : « 3MF MakerWorld/<modele>/Documents/<nom> ». Deplaces si le titre du modele change. Rend, par
    modele, la liste (document, chemin sur le NAS) pour les fiches."""
    from . import mw_docs as D
    from .makerworld import extras_of
    out: dict = {}
    for did, m in mws.items():
        docs = [d for d in (extras_of(getattr(m, "extras", None)).get("docs") or []) if isinstance(d, dict) and d.get("url")]
        if not docs or m.status != "ok":
            continue
        base = f"{LIB}/{_two(m.title_fr, m.title) if (m.title_fr or m.title) else f'Modèle {did}'}/Documents"
        taken, lst = set(), []
        for d in docs:
            src = D.local_path(did, d)
            name = D._safe(d.get("name"))
            rel = f"{base}/{name}"
            if rel.lower() in taken:
                rel = f"{base}/{D.doc_id(d['url'])}-{name}"
            taken.add(rel.lower())
            key = f"doc:{did}:{D.doc_id(d['url'])}"
            try:
                prev = idx.get(key)
                old = prev.get("to") if isinstance(prev, dict) else None
                if old and old != rel and (root / old).is_file() and not (root / rel).exists():
                    _move(root, old, rel)
                    rep["moved"] += 1
                if src.is_file():
                    if _copy(src, root / rel):
                        rep["copied"] += 1
                        rep["bytes"] += src.stat().st_size
                    idx[key] = {"to": rel, "root": str(root), "size": src.stat().st_size,
                                "src": src.relative_to(DATA_DIR).as_posix(), "at": (prev or {}).get("at") if isinstance(prev, dict) else None}
                    idx[key]["at"] = idx[key]["at"] or int(time.time())
                if (root / rel).is_file():
                    lst.append((d, rel))
            except OSError as e:
                rep["errors"] += 1
                logger.warning(f"[ARCHIVE] document {did} : {e}")
        if lst:
            out[str(did)] = lst
    return out


def _3d_dest(key: str, lib_plan: dict) -> str:
    """Ou range la vue 3D d'un 3MF : a cote de son 3MF d'origine (« <modele>/Vue 3D/<nom du 3MF> »), sinon dans
    « Système/Vues 3D/<cle> » (apercus MakerWorld, 3MF dont le modele n'est pas connu)."""
    rel = lib_plan.get(key)
    if rel:
        folder, name = rel.rsplit("/", 1)
        return f"{folder}/Vue 3D/{name[:-4] if name.lower().endswith('.3mf') else name}"
    # aux couleurs d'une impression (« <cle>_g<impression> », lues dans son G-code, 31/10/2026) : a cote de la vue du 3MF
    g = re.fullmatch(r"(.+)_g(\d+)", key or "")
    if g and lib_plan.get(g.group(1)):
        folder, name = lib_plan[g.group(1)].rsplit("/", 1)
        return f"{folder}/Vue 3D/{name[:-4] if name.lower().endswith('.3mf') else name} - impression {g.group(2)}"
    return f"{SYS}/Vues 3D/{key}"


def _3d_sync(root: Path, idx: dict, lib_plan: dict, rep: dict) -> None:
    """Les vues 3D deja preparees (27/10/2026), sur le NAS : une copie, le local reste. Si le local les perd, la vue
    les reprend la (restore_3d) au lieu de tout reconvertir. Deplacees si le titre du modele change."""
    from .mw_3d import _root as root3d
    from .mw_source import path_of
    base = root3d()
    if not base.is_dir():
        return
    for d in sorted(base.iterdir()):
        meta = d / "plates.json"
        if not d.is_dir() or not meta.is_file():
            continue
        key = d.name
        try:                                          # rien a montrer (une conversion vide) : rien a sauvegarder
            m3 = json.loads(meta.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not m3.get("glb") and not any(p.get("size_mm") for p in m3.get("plates") or []):
            continue
        dest = _3d_dest(key, lib_plan)
        prev = idx.get(f"3d:{key}")
        old = prev.get("to") if isinstance(prev, dict) else None
        try:
            if old and old != dest and (root / old).is_dir():
                _move(root, old, dest)
                rep["moved"] += 1
            for f in sorted(d.iterdir()):
                if not f.is_file() or f.suffix == ".part":
                    continue
                t = root / dest / f.name
                if f.name == "plates.json":           # petit, et sa taille peut rester la meme : compare au contenu
                    same = t.is_file() and t.read_bytes() == f.read_bytes()
                    if not same:
                        t.parent.mkdir(parents=True, exist_ok=True)
                        t.write_bytes(f.read_bytes())
                        rep["copied"] += 1
                elif _copy(f, t):
                    rep["copied"] += 1
                    rep["bytes"] += f.stat().st_size
            src = path_of(key)
            idx[f"3d:{key}"] = {"to": dest, "root": str(root),
                                "src_mt": src.stat().st_mtime if src.is_file() else None,
                                "meta_mt": meta.stat().st_mtime, "src": d.relative_to(DATA_DIR).as_posix(),
                                "size": sum(f.stat().st_size for f in d.iterdir() if f.is_file() and f.suffix != ".part"),
                                "at": (prev.get("at") if isinstance(prev, dict) else None) or int(time.time())}
        except OSError as e:
            rep["errors"] += 1
            logger.warning(f"[ARCHIVE] vue 3D {key} : {e}")


def restore_3d(key: str, out_dir: Path) -> bool:
    """Reprend du NAS la vue 3D d'un 3MF, si elle y est et date d'apres ce 3MF. Rend True si reprise."""
    from .mw_source import path_of
    e = _index().get(f"3d:{key}")
    if not isinstance(e, dict) or not e.get("to"):
        return False
    d = Path(e.get("root") or DEFAULT_ROOT) / e["to"]
    src = path_of(key)
    try:
        if not (d / "plates.json").is_file():
            return False
        if src.is_file() and DATA_DIR in src.parents and (e.get("src_mt") or 0) < src.stat().st_mtime:
            return False                              # le 3MF a change depuis : a reconvertir
        out_dir.mkdir(parents=True, exist_ok=True)
        for f in d.iterdir():
            if f.is_file():
                tmp = out_dir / (f.name + ".part")
                shutil.copyfile(f, tmp)
                os.replace(tmp, out_dir / f.name)
        return True
    except OSError as ex:
        logger.warning(f"[ARCHIVE] reprise de la vue 3D {key} : {ex}")
        return False


def _desc_sync(root: Path, mws: dict, docs_plan: dict, rep: dict) -> dict:
    """Le descriptif de chaque modele, a cote de ses 3MF : « 3MF MakerWorld/<modele>/Descriptif.txt » (titre,
    createur, lien, categories, mots-cles, descriptif traduit puis original, documents, pieces a prevoir).
    Reecrit s'il a change. Rend {design_id: chemin} pour les fiches."""
    from .makerworld import extras_of, model_url
    out: dict = {}
    for did, m in mws.items():
        if getattr(m, "status", None) != "ok":
            continue
        x = extras_of(getattr(m, "extras", None))
        if not (x.get("description") or x.get("docs") or x.get("parts") or x.get("filaments")):
            continue
        title = _two(m.title_fr, m.title) if (m.title_fr or m.title) else f"Modèle {did}"
        rel = f"{LIB}/{title}/Descriptif.txt"
        lines = [title, ""]
        if m.creator_name:
            lines.append(f"Par {m.creator_name}")
        lines.append(f"MakerWorld : {model_url(did)}")
        cats = [c for c in (m.categories or "").split(",") if c]
        tags = [t for t in (m.tags or "").split(",") if t]
        if cats:
            lines.append(f"Catégories : {', '.join(cats)}")
        if tags:
            lines.append(f"Mots-clés : {', '.join(tags[:40])}")
        from .makerworld import plain
        if x.get("description"):
            lines += ["", "Descriptif :", "", plain(x["description"])]
        if x.get("description_original"):
            lines += ["", "Descriptif d'origine :", "", plain(x["description_original"])]
        txt = "\n".join(lines) + "\n" + _extras_txt(m, docs_plan)
        try:
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            if _write_if_changed(root / rel, txt):
                rep["copied"] += 1
            out[str(did)] = rel
        except OSError as e:
            rep["errors"] += 1
            logger.warning(f"[ARCHIVE] descriptif {did} : {e}")
    return out


def _extras_txt(m, docs_plan: dict, indent: str = "") -> str:
    """Pour une fiche : les documents joints du modele (ou les trouver sur le NAS) et ce qu'il faut prevoir
    (pieces de la boutique, autres pieces). Vide s'il n'y a rien."""
    from .makerworld import extras_of
    from . import mw_docs as D
    if m is None or getattr(m, "status", None) != "ok":
        return ""
    x = extras_of(getattr(m, "extras", None))
    lines = []
    # tous ses documents : sur le NAS quand ils y sont, sinon leur adresse chez MakerWorld
    on_nas = {d.get("url"): rel for d, rel in docs_plan.get(str(m.design_id)) or []}
    docs = [(d, on_nas.get(d.get("url"))) for d in x.get("docs") or [] if isinstance(d, dict) and d.get("url")]
    if docs:
        lines += [f"{indent}Documents :"] + [
            f"{indent}  - {D.KIND_LABEL.get(d.get('kind'), 'Document')}{' (profil ' + d['profile'] + ')' if d.get('profile') else ''} : "
            f"{d.get('name')}{'  →  ' + rel if rel else '  →  ' + d.get('url', '')}" for d, rel in docs]
    fils = x.get("filaments") or []
    if fils:
        from .mw_docs import _split_title, _catalog
        cat = _catalog()
        lines += [f"{indent}Filaments recommandés :"]
        for f in fils:
            code = (f.get("codes") or [None])[0]
            color, variant, size = _split_title(f.get("title"))
            color = (cat.get(code) or {}).get("name_fr") or color
            what = " · ".join(filter(None, [f.get("product"), f"{color} ({code})" if code else color, variant, size]))
            lines.append(f"{indent}  - {f.get('quantity') or 1} × {what}{'  (' + f['url'] + ')' if f.get('url') else ''}")
    parts, other = x.get("parts") or [], x.get("other_parts")
    if parts or other:
        lines += [f"{indent}À prévoir :"] + [
            f"{indent}  - {str(p.get('quantity')) + ' × ' if p.get('quantity') else ''}{p.get('title')}{'  (' + p['url'] + ')' if p.get('url') else ''}"
            for p in parts]
        if other:
            lines += [f"{indent}  {ln}" for ln in str(other).splitlines() if ln.strip()]
    return ("\n" + "\n".join(lines) + "\n") if lines else ""


def _library_sync(root: Path, idx: dict, plan: dict, rep: dict) -> None:
    """La bibliotheque des 3MF d'origine, nommee : copie ce qui manque, renomme sur place ce qui a deja ete
    copie (sous son nom d'instance avant le 26/10/2026, ou sous un titre qui a change depuis)."""
    try:
        from .mw_source import _dir as _mw_dir
        d = _mw_dir()
    except Exception:
        return
    for iid, rel in plan.items():
        src = d / f"{iid}.3mf"
        if not src.is_file():
            continue
        prev = idx.get(f"lib:{iid}")
        olds = [prev.get("to")] if isinstance(prev, dict) and prev.get("to") else []
        olds.append(f"{LIB}/{iid}.3mf")                          # la recopie brute d'avant
        try:
            for old in olds:
                if old != rel and (root / old).is_file() and not (root / rel).exists():
                    _move(root, old, rel)
                    rep["moved"] += 1
            if _copy(src, root / rel):
                rep["copied"] += 1
                rep["bytes"] += src.stat().st_size
            idx[f"lib:{iid}"] = {"to": rel, "root": str(root), "size": src.stat().st_size,
                                 "src": src.relative_to(DATA_DIR).as_posix(),
                                 "at": (prev.get("at") if isinstance(prev, dict) else None) or int(time.time())}
        except OSError as e:
            rep["errors"] += 1
            logger.warning(f"[ARCHIVE] 3MF d'origine {iid} : {e}")
    # les petits fichiers d'a cote (filaments lus, index…) recopies bruts avant : rangés a part
    for f in list((root / LIB).glob("*")) if (root / LIB).is_dir() else []:
        if f.is_file() and not f.name.endswith(".3mf"):
            try:
                _move(root, f"{LIB}/{f.name}", f"{LIB}/_Données/{f.name}")
            except OSError:
                pass


def _quick_sig(p: Path) -> tuple:
    """Taille, et empreinte du premier et du dernier Mo : assez pour reconnaitre deux copies d'un meme 3MF."""
    import hashlib
    n = p.stat().st_size
    h = hashlib.sha1()
    with open(p, "rb") as f:
        h.update(f.read(1 << 20))
        if n > 2 << 20:
            f.seek(-(1 << 20), 2)
            h.update(f.read(1 << 20))
    return n, h.hexdigest()


def _sweep_origin_copies(root: Path, idx: dict, rep: dict) -> None:
    """Le menage des copies de 3MF d'origine que les dossiers des impressions avaient avant le 26/10/2026,
    independamment de l'index : une copie identique a un fichier de la bibliotheque est retiree ; une version
    que la bibliotheque n'a plus y est rangee, une seule fois, dans « _Anciens ». Fait une fois pour toutes."""
    if idx.get("@origin_swept") or not (root / PR).is_dir():
        return
    by_size: dict = {}
    for dirpath, _d, files in os.walk(root / LIB):
        for f in files:
            if f.endswith(".3mf"):
                p = Path(dirpath) / f
                try:
                    by_size.setdefault(p.stat().st_size, []).append(p)
                except OSError:
                    pass
    sigs: dict = {}
    def sig(p):
        if p not in sigs:
            sigs[p] = _quick_sig(p)
        return sigs[p]
    errors = 0
    for dirpath, _d, files in os.walk(root / PR):
        for f in files:
            if not f.endswith(" - origine MakerWorld.3mf"):
                continue
            p = Path(dirpath) / f
            rel = p.relative_to(root).as_posix()
            try:
                s = sig(p)
                same = next((q for q in by_size.get(s[0], []) if q != p and sig(q) == s), None)
                if same is not None:
                    p.unlink()
                    rep["deduped"] += 1
                else:                                    # une version que la bibliotheque n'a plus : gardee la-bas
                    dest = f"{LIB}/_Anciens/{f}"
                    k = 2
                    while (root / dest).exists():
                        dest = f"{LIB}/_Anciens/{f[:-4]} ({k}).3mf"
                        k += 1
                    _move(root, rel, dest)
                    by_size.setdefault(s[0], []).append(root / dest)
                    sigs[root / dest] = s
                    rep["moved"] += 1
                _prune_empty(root, p.parent)
                for k2 in [k2 for k2, e in idx.items() if k2.startswith("src:") and isinstance(e, dict) and e.get("to") == rel]:
                    idx.pop(k2, None)
            except OSError as e:
                errors += 1
                rep["errors"] += 1
                logger.warning(f"[ARCHIVE] menage du 3MF {rel} : {e}")
    if not errors:
        idx["@origin_swept"] = 1


def _library_path(src, plan: dict | None = None) -> str | None:
    """Ou est, sur le NAS, le 3MF d'origine d'une impression (chemin relatif a la racine)."""
    if not src:
        return None
    return (plan or {}).get(Path(src).stem)


def _named_sync(root: Path, idx: dict, rep: dict, src_name: str, label: str, names: dict) -> None:
    """Les photos d'un filament, d'un objet ou d'un accessoire, dans un dossier a son nom (deplace s'il est
    renomme ; la recopie brute d'avant, « <id> », est renommee sur place). Une photo supprimee dans l'appli, ou
    un element supprime, part dans « Système/_Supprimés » : rien n'est efface du NAS."""
    dirs = idx.setdefault("@sys", {})
    base = DATA_DIR / src_name
    local_ok = base.is_dir()
    taken = set()
    for eid, nm in sorted(names.items()):
        rel = f"{SYS}/{label}/{nm}"
        if rel.lower() in taken:
            rel += f" #{eid}"
        taken.add(rel.lower())
        key = f"{src_name}:{eid}"
        d = base / str(eid)
        try:
            old = dirs.get(key) or f"{SYS}/{label}/{eid}"
            if old != rel and (root / old).is_dir():
                _move(root, old, rel)
                rep["moved"] += 1
            if not d.is_dir():
                if (root / rel).is_dir():
                    dirs[key] = rel
                continue
            local = {f.name: f for f in d.iterdir() if f.is_file() and not f.name.endswith((".part", ".tmp"))}
            for f in local.values():
                if _copy(f, root / rel / f.name):
                    rep["copied"] += 1
                    rep["bytes"] += f.stat().st_size
                else:
                    rep["skipped"] += 1
            if (root / rel).is_dir():
                for f in list((root / rel).iterdir()):
                    if f.is_file() and f.name not in local:          # supprimee dans l'appli
                        _move(root, f"{rel}/{f.name}", f"{SYS_DEL}/{label}/{nm}/{f.name}")
                        rep["set_aside"] += 1
                dirs[key] = rel
        except OSError as e:
            rep["errors"] += 1
            logger.warning(f"[ARCHIVE] {label} {eid} : {e}")
    if not local_ok:                                  # donnees locales absentes : on ne deduit aucune suppression
        return
    for key, old in list(dirs.items()):
        k, _, eid = key.partition(":")
        if k != src_name or not eid.isdigit() or int(eid) in names:
            continue
        try:
            if (root / old).exists():
                _move(root, old, f"{SYS_DEL}/{old[len(SYS) + 1:]}")
                rep["moved"] += 1
            dirs.pop(key, None)
        except OSError:
            rep["errors"] += 1
    # les recopies brutes d'avant d'elements qui n'existent plus
    for f in list((root / SYS / label).iterdir()) if (root / SYS / label).is_dir() else []:
        if f.is_dir() and f.name.isdigit() and int(f.name) not in names:
            try:
                _move(root, f"{SYS}/{label}/{f.name}", f"{SYS_DEL}/{label}/{f.name}")
                rep["moved"] += 1
            except OSError:
                rep["errors"] += 1


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


def _backup_sync(root: Path, prints, mws, groups, all_ids: set, prog: dict, named: dict | None = None) -> dict:
    """La sauvegarde, en delta. Copie le nouveau et le change ; DEPLACE sur le NAS ce dont la place a change
    (impression entree ou sortie d'un groupe, groupe renomme, nom traduit…), fichiers deja vides du local compris.
    Ce qui a disparu de l'appli (impression, groupe, photo, video…) part dans « _Supprimés », jamais efface."""
    from .mw_source import print_file as source_3mf
    idx = _index()
    rep = {"copied": 0, "skipped": 0, "moved": 0, "set_aside": 0, "deduped": 0, "bytes": 0, "errors": 0, "prints": 0}
    _migrate_layout(root, idx, rep)
    # 0) le reste des donnees, dans « Système » (d'abord : la bibliotheque des 3MF d'origine y est verifiee
    #    avant de retirer les copies qu'en avaient les dossiers des impressions)
    prog.update(what="photos des filaments, objets, accessoires, 3MF MakerWorld…")
    _system_sync(root, rep)
    lib_plan = _library_plan(mws)
    _library_sync(root, idx, lib_plan, rep)
    docs_plan = _docs_sync(root, idx, mws, rep)
    desc_plan = _desc_sync(root, mws, docs_plan, rep)
    prog.update(what="vues 3D…")
    _3d_sync(root, idx, lib_plan, rep)
    for src_name, label in SYS_NAMED if named is not None else []:
        _named_sync(root, idx, rep, src_name, label, named.get(src_name) or {})
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
            # le 3MF d'origine MakerWorld : une seule copie, dans la bibliotheque de « Système » (partagee par
            # toutes les impressions du meme profil) ; la fiche dit ou le trouver. Les copies qu'en avaient les
            # dossiers des impressions (avant le 26/10/2026) sont retirees, une fois l'original verifie la-bas.
            src = source_3mf(p.design_id, p.mw_profile_id, p.mw_plates) if p.design_id else None
            lib = _library_path(src, lib_plan)
            prev = idx.get(f"src:{p.id}")
            if isinstance(prev, dict):
                old = root / prev["to"] if prev.get("to") else None
                if old is None or not old.exists():
                    idx.pop(f"src:{p.id}", None)
                elif lib and (root / lib).is_file() and (root / lib).stat().st_size == old.stat().st_size:
                    old.unlink()
                    _prune_empty(root, old.parent)
                    idx.pop(f"src:{p.id}", None)
                    rep["deduped"] += 1
                elif not p.design_id:                            # plus lie a un modele MakerWorld
                    _set_aside(root, idx, f"src:{p.id}", rep)
            # la fiche (reecrite si elle a change)
            fil = [f"{u.filament_type or 'Filament'} {u.color_hex or ''} — {round(u.grams_used or 0)} g".replace("  ", " ")
                   for u in (p.filament_usage or []) if (u.grams_used or 0) > 0]
            mw = f"https://makerworld.com/fr/models/{p.design_id}" if p.design_id else None
            g = next((x for x in groups if x.id == p.group_id), None) if p.group_id else None
            txt = _fiche(p, model, when, fil, mw) + (f"\nGroupe : {g.name}\n" if g else "") \
                + (f"\n3MF d'origine MakerWorld : {lib}\n" if lib and (root / lib).is_file() else "") \
                + (f"\nDescriptif du modèle : {desc_plan[str(p.design_id)]}\n" if p.design_id and str(p.design_id) in desc_plan else "") \
                + (_extras_txt(mws.get(str(p.design_id)), docs_plan) if p.design_id else "")
            if _write_if_changed(root / rel_dir / "Fiche.txt", txt):
                wrote = True
            if wrote:
                rep["prints"] += 1
        except Exception as e:
            rep["errors"] += 1
            logger.warning(f"[ARCHIVE] impression {p.id} : {e}")
        if i % 50 == 0:
            _index_save()

    # 2 bis) les copies de 3MF d'origine que l'index ne savait pas retirer (une fois pour toutes)
    prog.update(what="ménage des copies de 3MF d'origine…")
    _sweep_origin_copies(root, idx, rep)

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
            libs = list(dict.fromkeys(filter(None, (_library_path(source_3mf(p.design_id, p.mw_profile_id, p.mw_plates), lib_plan)
                                                    for p, _m, _w in members if p.design_id))))
            libs = [x for x in libs if (root / x).is_file()]
            # les documents et pieces a prevoir de chacun de ses modeles
            extra = ""
            for did in dict.fromkeys(str(p.design_id) for p, _m, _w in members if p.design_id):
                t = _extras_txt(mws.get(did), docs_plan, "  ")
                dsc = f"  Descriptif : {desc_plan[did]}\n" if did in desc_plan else ""
                if t or dsc:
                    m = mws.get(did)
                    extra += f"\n{_two(m.title_fr, m.title) if (m.title_fr or m.title) else 'Modèle ' + did} :\n" + dsc + t.lstrip("\n")
            _write_if_changed(root / groot / "Fiche du groupe.txt", _fiche_group(g, members)
                              + ("\n3MF d'origine MakerWorld :\n" + "".join(f"  - {x}\n" for x in libs) if libs else "")
                              + ("\nDocuments et pièces des modèles :\n" + extra if extra else ""))
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
            if f.name.startswith("Vue3D_mix"):              # la mosaique des vues 3D : refaite a la demande
                continue
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
        named = await _named_meta()
        root = Path(s["dir"])
        if not (root / MARK).exists():
            (root / MARK).write_text("Dossier des sauvegardes de BambuNymous : ne pas supprimer ce fichier.\n", encoding="utf-8")
        db_name = await asyncio.to_thread(_db_backup_sync, root)
        rep = await asyncio.to_thread(_backup_sync, root, prints, mws, groups, all_ids, _STATE["progress"], named)
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


def _nas_ok(e: dict, local: Path) -> bool:
    """La copie NAS d'un fichier est la, de la meme taille."""
    try:
        q = Path(e.get("root") or DEFAULT_ROOT) / e["to"]
        return q.is_file() and q.stat().st_size == local.stat().st_size
    except OSError:
        return False


def _purge_models_sync(limit_ts: float, last_print: dict, prog: dict) -> dict:
    """Vide du local les fichiers de MODELE deja sur le NAS (28/10/2026) : vues 3D, 3MF d'origine, documents.
    Le critere est la derniere impression du modele (plus ancienne que le delai) ; un modele jamais imprime, ou un
    fichier sans modele connu, quand sa copie NAS a plus que le delai. L'appli relit ces fichiers sur le NAS (la vue
    3D les reprend en local a la demande)."""
    idx = _index()
    inv = _iid_to_did()
    rep = {"m_files": 0, "m_bytes": 0, "m_kept": 0}
    # les entrees deja marquees sont revues aussi : un fichier revenu en local (vue 3D reprise du NAS, 3MF
    # retelecharge) repart quand il est de nouveau vieux
    keys = [k for k, e in idx.items() if isinstance(e, dict) and e.get("src") and k.partition(":")[0] in _MKIND]
    for i, k in enumerate(keys):
        e = idx[k]
        kind, _, rest = k.partition(":")
        prog.update(done=i, total=len(keys), what=f"fichiers de modèle {i + 1} / {len(keys)}")
        did = rest.split(":", 1)[0] if kind == "doc" else inv.get(rest)
        lp = last_print.get(str(did)) if did else None
        if lp is not None:
            old = lp < limit_ts
        else:
            old = bool(e.get("at")) and e["at"] < limit_ts
        if not old:
            continue
        local = DATA_DIR / e["src"]
        try:
            if kind == "3d":
                if not local.is_dir():
                    continue
                files = [f for f in local.iterdir() if f.is_file() and f.suffix != ".part"]
                nas = Path(e.get("root") or DEFAULT_ROOT) / e["to"]
                ok = bool(files) and all((nas / f.name).is_file() and (nas / f.name).stat().st_size == f.stat().st_size for f in files)
                if not ok:
                    rep["m_kept"] += 1
                    continue
                n = sum(f.stat().st_size for f in files)
                shutil.rmtree(local)
            else:
                if not local.is_file():
                    continue
                if not _nas_ok(e, local):
                    rep["m_kept"] += 1
                    continue
                n = local.stat().st_size
                local.unlink()
        except OSError as ex:
            logger.warning(f"[ARCHIVE] vidage {k} : {ex}")
            rep["m_kept"] += 1
            continue
        e["purged"] = True
        rep["m_files"] += 1
        rep["m_bytes"] += n
    _index_save()
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
    from sqlalchemy import func as _f
    async with AsyncSessionLocal() as db:
        ids = set((await db.execute(select(Print.id).where(Print.print_date < limit, Print.status != "IN_PROGRESS"))).scalars().all())
        # la derniere impression de chaque modele (en secondes, pour les fichiers de modele)
        last_print = {str(d): (dt.replace(tzinfo=None) - datetime(1970, 1, 1)).total_seconds()
                      for d, dt in (await db.execute(select(Print.design_id, _f.max(Print.print_date))
                                                     .where(Print.design_id.isnot(None)).group_by(Print.design_id))).all() if d and dt}
    _STATE["running"], _STATE["progress"] = "purge", {"done": 0, "total": len(ids), "what": ""}
    try:
        rep = await asyncio.to_thread(_purge_sync, ids, _STATE["progress"])
        rep.update(await asyncio.to_thread(_purge_models_sync, (limit - datetime(1970, 1, 1)).total_seconds(), last_print, _STATE["progress"]))
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
    from ..core import tasks as _tasks
    await _tasks.sleep("nas", 120)
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
            _tasks.error("nas")
            logger.exception("[ARCHIVE] boucle de nuit")
        await _tasks.sleep("nas", 300)
