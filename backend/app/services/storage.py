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
    ("tmf", "Fichiers 3MF", "#F59E0B"),
    ("videos", "Vidéos", "#EF4444"),
    ("groups", "Photos de groupes", "#EC4899"),
    ("objects", "Photos d'objets", "#22C55E"),
    ("accessories", "Photos d'accessoires", "#14B8A6"),
    ("filaments", "Photos de filaments", "#F97316"),
    ("db", "Base de données", "#6366F1"),
    ("catalog", "Catalogue Bambu", "#A855F7"),
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
