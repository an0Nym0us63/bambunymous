"""
Import de fichiers ZIP depuis Spoolnymous → BambuNymous.

4 types de ZIP supportés :
  prints          → {timestamp}_{hash}.3mf + {timestamp}_{hash}.png
                    mappés sur les prints en DB via le nom du fichier / job_id
  uploads_prints  → {print_id}/{Impression-*.jpg, Photo-*.webp, ...}
                    copiés dans /data/prints/{new_print_id}/
  uploads_filaments → {filament_id}/{Photo-*.webp, ...}
                    copiés dans /data/filaments/{filament_id}/
  uploads_groups  → {group_id}/{Photo-*.webp, ...}
                    copiés dans /data/groups/{group_name}/

Convention fichiers BambuNymous :
  /data/prints/{id}/plate.png          ← vignette 3MF
  /data/prints/{id}/model_*.3mf        ← fichier 3MF
  /data/prints/{id}/{nom_original}     ← snapshots importés (gardés tels quels)
  /data/filaments/{id}/{nom}           ← photos filament
  /data/groups/{name}/{nom}            ← photos galerie groupe
"""
import io
import logging
import os
import re
import shutil
import zipfile
from pathlib import Path
from typing import Optional

from sqlalchemy import select, text

from ..db.session import AsyncSessionLocal
from ..models.print_history import Print, PrintSnapshot

logger = logging.getLogger(__name__)
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))


# ── Helpers ─────────────────────────────────────────────────────────────────

def _is_image(name: str) -> bool:
    return name.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))

def _is_3mf(name: str) -> bool:
    return name.lower().endswith(".3mf")

def _safe_name(name: str) -> str:
    """Nettoie un nom de fichier."""
    return re.sub(r"[^a-zA-Z0-9._-]", "_", os.path.basename(name))


# ── 1. prints.zip ────────────────────────────────────────────────────────────

async def import_prints_zip(zip_source) -> dict:
    """
    Importe les 3MF et vignettes depuis le dossier prints/ de Spoolnymous.
    Chaque fichier est nommé {timestamp}_{hash}.3mf ou {timestamp}_{hash}.png
    On les associe au print correspondant en DB via une recherche sur model_3mf.
    """
    stats = {"matched": 0, "unmatched": 0, "copied": 0, "errors": 0}

    _src = str(zip_source) if hasattr(zip_source, "__fspath__") else io.BytesIO(zip_source)
    with zipfile.ZipFile(_src) as z:
        names = z.namelist()
        # Grouper par stem (timestamp_hash)
        stems: dict[str, list[str]] = {}
        for name in names:
            base = os.path.basename(name)
            if not base or base.startswith("."): continue
            stem = re.sub(r"\.(3mf|png|jpg|jpeg|webp)$", "", base, flags=re.IGNORECASE)
            stems.setdefault(stem, []).append(name)

        async with AsyncSessionLocal() as db:
            for stem, files in stems.items():
                # Trouver le print correspondant en DB
                # Chercher par model_3mf (contient le stem) ou plate_image
                result = await db.execute(
                    select(Print).where(Print.model_3mf.like(f"%{stem}%"))
                )
                p = result.scalar_one_or_none()

                if not p:
                    # Essayer par plate_image
                    result = await db.execute(
                        select(Print).where(Print.plate_image.like(f"%{stem}%"))
                    )
                    p = result.scalar_one_or_none()

                if not p:
                    logger.debug(f"[ZIP-PRINTS] stem={stem!r} → aucun print trouvé")
                    stats["unmatched"] += 1
                    continue

                stats["matched"] += 1
                dest_dir = DATA_DIR / "prints" / str(p.id)
                dest_dir.mkdir(parents=True, exist_ok=True)

                for fname in files:
                    base = os.path.basename(fname)
                    try:
                        data = z.read(fname)
                        if _is_3mf(base):
                            dest = dest_dir / f"model_{stem[-8:]}.3mf"
                            dest.write_bytes(data)
                            if not p.model_3mf:
                                p.model_3mf = f"prints/{p.id}/{dest.name}"
                        elif _is_image(base):
                            dest = dest_dir / "plate.png"
                            dest.write_bytes(data)
                            if not p.plate_image:
                                p.plate_image = f"prints/{p.id}/plate.png"
                        stats["copied"] += 1
                    except Exception as e:
                        logger.error(f"[ZIP-PRINTS] {fname}: {e}")
                        stats["errors"] += 1

            await db.commit()

    logger.info(f"[ZIP-PRINTS] {stats}")
    return stats


# ── 2. uploads_prints.zip ────────────────────────────────────────────────────

async def import_uploads_prints_zip(zip_source) -> dict:
    """
    Importe les snapshots depuis uploads/prints/{old_print_id}/*.jpg
    Mappe old_print_id → new_print_id via la DB (id préservé à l'import).
    """
    stats = {"matched": 0, "unmatched": 0, "copied": 0, "errors": 0}

    _src = str(zip_source) if hasattr(zip_source, "__fspath__") else io.BytesIO(zip_source)
    with zipfile.ZipFile(_src) as z:
        # Structure : {print_id}/Impression-50.jpg
        files_by_print: dict[str, list[str]] = {}
        for name in z.namelist():
            parts = name.replace("\", "/").split("/")
            # Ignorer les dossiers
            if name.endswith("/"): continue
            # Trouver le print_id dans le chemin
            for p in parts[:-1]:
                if p.isdigit():
                    files_by_print.setdefault(p, []).append(name)
                    break

        async with AsyncSessionLocal() as db:
            for old_pid_str, files in files_by_print.items():
                old_pid = int(old_pid_str)
                # Les IDs sont préservés à l'import
                p = await db.get(Print, old_pid)
                if not p:
                    logger.debug(f"[ZIP-UPRINT] print_id={old_pid} → non trouvé")
                    stats["unmatched"] += 1
                    continue

                stats["matched"] += 1
                dest_dir = DATA_DIR / "prints" / str(p.id)
                dest_dir.mkdir(parents=True, exist_ok=True)

                for fname in files:
                    base = os.path.basename(fname)
                    if not base or not (_is_image(base)): continue
                    try:
                        data = z.read(fname)
                        dest = dest_dir / _safe_name(base)
                        dest.write_bytes(data)

                        # Enregistrer comme snapshot si pas déjà présent
                        rel_path = f"prints/{p.id}/{dest.name}"
                        existing = (await db.execute(
                            select(PrintSnapshot).where(
                                PrintSnapshot.print_id == p.id,
                                PrintSnapshot.file_path == rel_path
                            )
                        )).scalar_one_or_none()
                        if not existing:
                            # Déduire le trigger depuis le nom
                            trigger = _guess_trigger(base)
                            db.add(PrintSnapshot(
                                print_id=p.id,
                                trigger=trigger,
                                file_path=rel_path,
                            ))
                        stats["copied"] += 1
                    except Exception as e:
                        logger.error(f"[ZIP-UPRINT] {fname}: {e}")
                        stats["errors"] += 1

            await db.commit()

    logger.info(f"[ZIP-UPRINT] {stats}")
    return stats


def _guess_trigger(filename: str) -> str:
    """Devine le trigger depuis le nom du fichier Spoolnymous."""
    name = filename.lower()
    if "100" in name:   return "pct100"
    if "99"  in name:   return "pct99"
    if "50"  in name:   return "pct50"
    if "couche-2" in name or "layer2" in name: return "layer2"
    if "couche-1" in name or "layer1" in name: return "layer1"
    if "fail" in name or "echec" in name:      return "fail"
    return "manual"


# ── 3. uploads_filaments.zip ─────────────────────────────────────────────────

async def import_uploads_filaments_zip(zip_source) -> dict:
    """
    Importe les photos depuis uploads/filaments/{filament_id}/*.webp
    → /data/filaments/{filament_id}/{nom}
    """
    stats = {"copied": 0, "errors": 0}

    _src = str(zip_source) if hasattr(zip_source, "__fspath__") else io.BytesIO(zip_source)
    with zipfile.ZipFile(_src) as z:
        for name in z.namelist():
            if name.endswith("/"): continue
            parts = name.replace("\", "/").split("/")
            base = os.path.basename(name)
            if not base or not (_is_image(base)): continue

            # Trouver le filament_id dans le chemin
            fil_id = next((p for p in parts[:-1] if p.isdigit()), None)
            if not fil_id: continue

            dest_dir = DATA_DIR / "filaments" / fil_id
            dest_dir.mkdir(parents=True, exist_ok=True)
            try:
                (dest_dir / _safe_name(base)).write_bytes(z.read(name))
                stats["copied"] += 1
            except Exception as e:
                logger.error(f"[ZIP-FIL] {name}: {e}")
                stats["errors"] += 1

    logger.info(f"[ZIP-FIL] {stats}")
    return stats


# ── 4. uploads_groups.zip ────────────────────────────────────────────────────

async def import_uploads_groups_zip(zip_source) -> dict:
    """
    Importe les photos depuis uploads/groups/{group_id}/*.webp
    → /data/groups/{group_id}/{nom}
    On ne mappe pas sur les noms de groupes (pas de table dédiée),
    on stocke par ID numérique et on fait le lien plus tard.
    """
    stats = {"copied": 0, "errors": 0}

    _src = str(zip_source) if hasattr(zip_source, "__fspath__") else io.BytesIO(zip_source)
    with zipfile.ZipFile(_src) as z:
        for name in z.namelist():
            if name.endswith("/"): continue
            parts = name.replace("\", "/").split("/")
            base = os.path.basename(name)
            if not base or not (_is_image(base)): continue

            group_id = next((p for p in parts[:-1] if p.isdigit()), None)
            if not group_id: continue

            dest_dir = DATA_DIR / "groups" / group_id
            dest_dir.mkdir(parents=True, exist_ok=True)
            try:
                (dest_dir / _safe_name(base)).write_bytes(z.read(name))
                stats["copied"] += 1
            except Exception as e:
                logger.error(f"[ZIP-GRP] {name}: {e}")
                stats["errors"] += 1

    logger.info(f"[ZIP-GRP] {stats}")
    return stats
