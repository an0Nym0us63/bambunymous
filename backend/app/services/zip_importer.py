"""
Import de fichiers ZIP depuis Spoolnymous → BambuNymous.
"""
import io
import logging
import os
import re
import zipfile
from pathlib import Path

from sqlalchemy import select

from ..db.session import AsyncSessionLocal
from ..models.print_history import Print, PrintSnapshot

logger = logging.getLogger(__name__)
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))


def _is_image(name):
    return name.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))

def _is_3mf(name):
    return name.lower().endswith(".3mf")

def _safe_name(name):
    return re.sub(r"[^a-zA-Z0-9._-]", "_", os.path.basename(name))

def _normalize(path):
    """Normalise les séparateurs de chemin."""
    return path.replace("\\", "/")


async def import_prints_zip(zip_source) -> dict:
    """
    Importe vignettes PNG + 3MF depuis le dossier prints/ de Spoolnymous.
    
    Nommage Spoolnymous : {YYYYMMDDHHMMSS}_{uuid8}.png / .3mf
    Le timestamp = print_date formaté → on mappe par date.
    """
    stats = {"matched": 0, "unmatched": 0, "copied": 0, "errors": 0}

    with zipfile.ZipFile(zip_source) as z:
        names = z.namelist()

        # Grouper par stem
        stems: dict[str, list[str]] = {}
        for name in names:
            base = os.path.basename(_normalize(name))
            if not base or base.startswith("."): continue
            stem = re.sub(r"\.(3mf|png|jpg|jpeg|webp)$", "", base, flags=re.IGNORECASE)
            stems.setdefault(stem, []).append(name)

        # Construire un index date→print depuis la DB
        # stem = YYYYMMDDHHMMSS_xxxxxxxx → les 14 premiers chars = timestamp
        async with AsyncSessionLocal() as db:
            # Construire deux index de matching :
            # 1. external_ref exact (YYYYMMDDHHMMSS_uuid8) — le plus fiable
            # 2. timestamp seul (YYYYMMDDHHMMSS) — fallback si unique
            all_prints = (await db.execute(select(Print))).scalars().all()
            ext_index: dict[str, object] = {}  # stem complet → print
            date_index: dict[str, list]  = {}  # timestamp → [prints]

            for p in all_prints:
                if p.external_ref:
                    ext_index[p.external_ref] = p
                if p.print_date:
                    try:
                        from datetime import datetime as _dt
                        d = p.print_date if not isinstance(p.print_date, str)                             else _dt.strptime(p.print_date[:19], "%Y-%m-%d %H:%M:%S")
                        date_index.setdefault(d.strftime("%Y%m%d%H%M%S"), []).append(p)
                    except Exception:
                        pass

            logger.info(
                f"[ZIP-PRINTS] Index: {len(ext_index)} external_ref "
                f"| {len(date_index)} timestamps | {len(stems)} stems ZIP"
            )
            if stems:
                logger.info(f"[ZIP-PRINTS] Exemples stems ZIP: {list(stems)[:3]}")
            if ext_index:
                logger.info(f"[ZIP-PRINTS] Exemples external_ref DB: {list(ext_index)[:3]}")

            for stem, files in stems.items():
                p = None

                # 1. Match exact par external_ref
                p = ext_index.get(stem)

                # 2. Fallback timestamp (14 premiers chars)
                if not p:
                    ts = stem[:14]
                    if ts.isdigit() and len(ts) == 14:
                        candidates = date_index.get(ts, [])
                        if len(candidates) == 1:
                            p = candidates[0]
                        elif len(candidates) > 1:
                            # Choisir le plus proche par uuid (8 derniers chars du stem)
                            uuid_part = stem[-8:] if len(stem) > 14 else ""
                            p = candidates[0]
                            logger.debug(f"[ZIP-PRINTS] {stem}: {len(candidates)} candidats → #{p.id}")

                # 3. Dernier recours : chercher dans plate_image
                if not p:
                    result3 = await db.execute(
                        select(Print).where(
                            Print.plate_image.ilike(f"%{stem}%")
                        )
                    )
                    p = result3.scalar_one_or_none()

                if not p:
                    logger.warning(
                        f"[ZIP-PRINTS] UNMATCHED: stem={stem!r} "
                        f"ext_in_index={stem in ext_index} "
                        f"ts_in_index={stem[:14] in date_index} "
                        f"ext_index_size={len(ext_index)}"
                    )
                    # Log les 5 premières clés de ext_index pour comparer
                    if len(ext_index) < 20:
                        logger.warning(f"[ZIP-PRINTS] ext_index keys: {list(ext_index.keys())[:5]}")
                    else:
                        # Chercher les clés similaires
                        similar = [k for k in ext_index if k[:14] == stem[:14]]
                        if similar:
                            logger.warning(f"[ZIP-PRINTS] Clés similaires en DB: {similar}")
                    stats["unmatched"] += 1
                    continue

                # Mémoriser l'external_ref pour la prochaine fois
                if not p.external_ref:
                    p.external_ref = stem

                stats["matched"] += 1
                dest_dir = DATA_DIR / "prints" / str(p.id)
                dest_dir.mkdir(parents=True, exist_ok=True)

                for fname in files:
                    base = os.path.basename(_normalize(fname))
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
                            p.plate_image = f"prints/{p.id}/plate.png"
                        stats["copied"] += 1
                    except Exception as e:
                        logger.error(f"[ZIP-PRINTS] {fname}: {e}")
                        stats["errors"] += 1
            await db.commit()

    logger.info(f"[ZIP-PRINTS] {stats}")
    return stats


def _guess_trigger(filename):
    name = filename.lower()
    if "100" in name:   return "pct100"
    if "99"  in name:   return "pct99"
    if "50"  in name:   return "pct50"
    if "couche-2" in name or "layer2" in name: return "layer2"
    if "couche-1" in name or "layer1" in name: return "layer1"
    if "fail" in name or "echec" in name:      return "fail"
    return "manual"


async def import_uploads_prints_zip(zip_source) -> dict:
    """Importe snapshots depuis uploads/prints/{print_id}/."""
    stats = {"matched": 0, "unmatched": 0, "copied": 0, "errors": 0}
    with zipfile.ZipFile(zip_source) as z:
        # Log structure pour debug
        sample = [n for n in z.namelist()[:5]]
        logger.info(f"[ZIP-UPRINT] Structure ZIP (5 premiers): {sample}")

        files_by_print: dict[str, list[str]] = {}
        for name in z.namelist():
            if name.endswith("/"): continue
            parts = _normalize(name).split("/")
            for part in parts[:-1]:
                if part.isdigit():
                    files_by_print.setdefault(part, []).append(name)
                    break

        logger.info(f"[ZIP-UPRINT] {len(files_by_print)} dossiers print trouvés: {list(files_by_print.keys())[:10]}")

        async with AsyncSessionLocal() as db:
            for old_pid_str, files in files_by_print.items():
                p = await db.get(Print, int(old_pid_str))
                if not p:
                    # Copier quand même si le dossier existe sur disque
                    dest_dir = DATA_DIR / "prints" / old_pid_str
                    if dest_dir.exists():
                        logger.debug(f"[ZIP-UPRINT] print_id={old_pid_str} pas en DB mais dossier existe → copie directe")
                        for fname in files:
                            base = os.path.basename(_normalize(fname))
                            if not base or not _is_image(base): continue
                            try:
                                (dest_dir / _safe_name(base)).write_bytes(z.read(fname))
                                stats["copied"] += 1
                            except Exception as e:
                                logger.error(f"[ZIP-UPRINT] {fname}: {e}")
                    else:
                        logger.debug(f"[ZIP-UPRINT] print_id={old_pid_str} introuvable en DB ni sur disque")
                        stats["unmatched"] += 1
                    continue
                stats["matched"] += 1
                dest_dir = DATA_DIR / "prints" / str(p.id)
                dest_dir.mkdir(parents=True, exist_ok=True)
                for fname in files:
                    base = os.path.basename(_normalize(fname))
                    if not base or not _is_image(base): continue
                    try:
                        data = z.read(fname)
                        dest = dest_dir / _safe_name(base)
                        dest.write_bytes(data)
                        rel_path = f"prints/{p.id}/{dest.name}"
                        existing = (await db.execute(
                            select(PrintSnapshot).where(
                                PrintSnapshot.print_id == p.id,
                                PrintSnapshot.file_path == rel_path
                            )
                        )).scalar_one_or_none()
                        if not existing:
                            db.add(PrintSnapshot(
                                print_id=p.id,
                                trigger=_guess_trigger(base),
                                file_path=rel_path,
                            ))
                        stats["copied"] += 1
                    except Exception as e:
                        logger.error(f"[ZIP-UPRINT] {fname}: {e}")
                        stats["errors"] += 1
            await db.commit()

    logger.info(f"[ZIP-UPRINT] {stats}")
    return stats


async def import_uploads_filaments_zip(zip_source) -> dict:
    """Importe photos depuis uploads/filaments/{filament_id}/."""
    stats = {"copied": 0, "errors": 0}
    with zipfile.ZipFile(zip_source) as z:
        for name in z.namelist():
            if name.endswith("/"): continue
            parts = _normalize(name).split("/")
            base = os.path.basename(parts[-1])
            if not base or not _is_image(base): continue
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


async def import_uploads_groups_zip(zip_source) -> dict:
    """Importe photos depuis uploads/groups/{group_id}/."""
    stats = {"copied": 0, "errors": 0}
    with zipfile.ZipFile(zip_source) as z:
        for name in z.namelist():
            if name.endswith("/"): continue
            parts = _normalize(name).split("/")
            base = os.path.basename(parts[-1])
            if not base or not _is_image(base): continue
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
