"""L'espace de stockage (24/10/2026) : ce que l'appli garde dans son dossier de donnees, range par sorte
(photos automatiques, photos ajoutees, 3MF, vignettes, photos de groupes, d'objets, d'accessoires, base de
donnees…), avec la place du disque et les impressions qui en prennent le plus. Lecture seule."""
import os
import shutil
import time
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
CACHE_S = 60
_CACHE: dict = {"at": 0.0, "v": None}

IMG = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".avif", ".bmp"}
VID = {".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"}

# l'ordre de la liste rendue ; libelle et couleur
CATS = [
    ("auto", "Photos automatiques d'impression", "#3B82F6"),
    ("print_photos", "Photos d'impression ajoutées", "#06B6D4"),
    ("plates", "Vignettes de plateau", "#8B5CF6"),
    ("tmf", "Fichiers 3MF tranchés", "#F59E0B"),
    ("mw_tmf", "3MF d'origine MakerWorld", "#FB923C"),
    ("videos", "Vidéos", "#EF4444"),
    ("groups", "Photos de groupes", "#EC4899"),
    ("objects", "Photos d'objets", "#22C55E"),
    ("accessories", "Photos d'accessoires", "#14B8A6"),
    ("filaments", "Photos de filaments", "#F97316"),
    ("db", "Base de données", "#6366F1"),
    ("catalog", "Catalogue et données MakerWorld", "#A855F7"),
    ("sd_cache", "Cache de la carte SD", "#F43F5E"),
    ("tmp", "Fichiers temporaires", "#94A3B8"),
    ("other", "Autres", "#64748B"),
]


def _cat(parts: tuple, name: str) -> str:
    """La sorte d'un fichier d'apres son chemin (relatif au dossier de donnees) et son nom."""
    ext = os.path.splitext(name)[1].lower()
    low = name.lower()
    top = parts[0] if len(parts) > 1 else ""
    if (".db" in low or ".sqlite" in low) and low.endswith((".db", ".sqlite", "-wal", "-shm", "-journal")):
        return "db"
    if parts[:2] == ("cache", "sd"):            # timelapses lus sur la carte SD (et leurs conversions) : refaits a la demande
        return "sd_cache"
    if ext in VID:
        return "videos"
    if top == "prints":
        if ext == ".3mf":
            return "tmf"
        if low.startswith("snapshot-"):
            return "auto"
        if low.startswith("plate"):
            return "plates"
        return "print_photos" if ext in IMG else "other"
    if top == "mw_3mf":
        # les 3MF d'origine ; a cote, de petits fichiers (filaments exacts lus, index, etat du rattrapage)
        return "mw_tmf" if ext == ".3mf" else "catalog"
    if ext == ".3mf":
        return "tmf"
    return {"groups": "groups", "objects": "objects", "accessories": "accessories", "filaments": "filaments",
            "bambu_catalog": "catalog", "tmp": "tmp", "uploads": "tmp"}.get(top, "other")


def _scan(root: Path) -> dict:
    sums = {k: [0, 0] for k, _l, _c in CATS}            # octets, fichiers
    per_print: dict = {}
    other_dirs: dict = {}
    for dirpath, _dirs, files in os.walk(root):
        rel = Path(dirpath).relative_to(root).parts
        for f in files:
            try:
                n = (Path(dirpath) / f).stat().st_size
            except OSError:
                continue
            k = _cat(rel + (f,), f)
            sums[k][0] += n
            sums[k][1] += 1
            if rel and rel[0] == "prints" and len(rel) > 1 and rel[1].isdigit():
                per_print[int(rel[1])] = per_print.get(int(rel[1]), 0) + n
            if k == "other":
                d = rel[0] if rel else "(racine)"
                other_dirs[d] = other_dirs.get(d, 0) + n
    total = sum(v[0] for v in sums.values())
    try:
        du = shutil.disk_usage(root)
        disk = {"total": du.total, "used": du.used, "free": du.free}
    except OSError:
        disk = None
    return {
        "total": total, "files": sum(v[1] for v in sums.values()), "disk": disk,
        "cats": [{"key": k, "label": l, "color": c, "bytes": sums[k][0], "files": sums[k][1]} for k, l, c in CATS],
        "other_dirs": sorted(({"dir": d, "bytes": b} for d, b in other_dirs.items()), key=lambda x: -x["bytes"])[:6],
        "top_prints": sorted(({"id": i, "bytes": b} for i, b in per_print.items()), key=lambda x: -x["bytes"])[:8],
    }


async def usage(fresh: bool = False) -> dict:
    """Le releve (garde une minute : parcourir des milliers de photos prend du temps)."""
    import asyncio
    if not fresh and _CACHE["v"] is not None and time.time() - _CACHE["at"] < CACHE_S:
        return _CACHE["v"]
    v = await asyncio.to_thread(_scan, DATA_DIR)
    v["at"] = time.time()
    _CACHE.update(at=time.time(), v=v)
    return v


# ── Le NAS (26/10/2026) : ce que la sauvegarde y range, par les memes sortes, d'apres ses dossiers ──
NAS_CACHE_S = 600                                      # un partage reseau se parcourt lentement : 10 min
_NAS_CACHE: dict = {"at": 0.0, "v": None}
NAS_CATS = [c for c in CATS[:-2] if c[0] != "sd_cache"] + [("fiches", "Fiches des impressions et des groupes", "#0EA5E9"),
                        ("deleted", "Mis de côté (_Supprimés)", "#A1A1AA"), ("other", "Autres", "#64748B")]
SYS_SUBS = {"Base de données": "db", "Photos des filaments": "filaments", "Objets": "objects",
            "Accessoires": "accessories", "Catalogue Bambu": "catalog"}


def _nas_cat(parts: tuple, name: str) -> str:
    """La sorte d'un fichier du NAS d'apres son chemin (Impressions/…, Système/…) et son nom."""
    ext = os.path.splitext(name)[1].lower()
    top = parts[0] if len(parts) > 1 else ""
    if top == "Système" and len(parts) > 2:
        if parts[1] == "3MF MakerWorld":
            return "mw_tmf" if ext == ".3mf" else "catalog"
        return SYS_SUBS.get(parts[1], "other")
    if top == "Impressions":
        if len(parts) > 2 and parts[1] == "_Supprimés":
            return "deleted"
        if "Photos du groupe" in parts:
            return "groups"
        if ext in VID:
            return "videos"
        folder = parts[-2] if len(parts) > 1 else ""
        if folder == "Couches":
            return "auto"
        if folder == "Photos":
            return "print_photos"
        if ext == ".3mf":
            return "mw_tmf" if "origine MakerWorld" in name else "tmf"
        if name.startswith("Plateau"):
            return "plates"
        if ext == ".txt":
            return "fiches"
    return "other"


def _nas_scan(root: Path) -> dict:
    sums = {k: [0, 0] for k, _l, _c in NAS_CATS}
    for dirpath, _dirs, files in os.walk(root):
        rel = Path(dirpath).relative_to(root).parts
        for f in files:
            if f.startswith(".bambunymous") or f.endswith(".part"):
                continue
            try:
                n = (Path(dirpath) / f).stat().st_size
            except OSError:
                continue
            k = _nas_cat(rel + (f,), f)
            sums[k][0] += n
            sums[k][1] += 1
    return {"total": sum(v[0] for v in sums.values()), "files": sum(v[1] for v in sums.values()),
            "cats": [{"key": k, "label": l, "color": c, "bytes": sums[k][0], "files": sums[k][1]} for k, l, c in NAS_CATS]}


async def nas_usage(fresh: bool = False) -> dict:
    """Le releve du NAS : sa place, ce que la sauvegarde y range par sorte, et ce qui n'est plus que la-bas
    (vide du local). Rien de lu si le partage n'est pas pret."""
    import asyncio
    from . import archive as AR
    if not fresh and _NAS_CACHE["v"] is not None and time.time() - _NAS_CACHE["at"] < NAS_CACHE_S:
        return _NAS_CACHE["v"]
    root = (await AR.settings_get())["dir"]
    chk = await asyncio.to_thread(AR._check_root, root)
    if not chk.get("ok"):
        return {"ok": False, "dir": root, "why": chk.get("why")}
    v = await asyncio.to_thread(_nas_scan, Path(root))
    dk = chk.get("disk")
    v["disk"] = {"total": dk["total"], "free": dk["free"], "used": dk["total"] - dk["free"]} if dk else None
    only = [e for k, e in AR._index().items() if isinstance(e, dict) and e.get("purged")]
    v.update(ok=True, dir=root, at=time.time(), only_nas={"bytes": sum(e.get("size") or 0 for e in only), "files": len(only)},
             last_backup=(await AR.settings_get()).get("last_backup"))
    _NAS_CACHE.update(at=time.time(), v=v)
    return v
