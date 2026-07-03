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
from ..models.print_history import Print, PrintSnapshot, Group

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


def _snapshot_dest_name(original_base, dest_dir, manual_idx, trigger=None):
    """
    Nom de destination selon la convention BambuNymous (snapshot-{trigger}.ext),
    au lieu du nom d'origine Spoolnymous — c'est ce nom qui sert au matching
    disque↔DB (cf. PrintSnapshot.file_path et SnapshotGallery côté frontend).
    Les triggers "manual" (photos non reconnues) sont numérotés pour rester uniques.
    Retourne (dest_name, manual_idx_suivant).
    """
    ext = os.path.splitext(original_base)[1].lower() or ".jpg"
    if trigger is None:
        trigger = _guess_trigger(original_base)
    if trigger == "manual":
        idx = manual_idx
        while (dest_dir / f"Photo-{idx:02d}{ext}").exists():
            idx += 1
        return f"Photo-{idx:02d}{ext}", idx + 1
    return f"snapshot-{trigger}{ext}", manual_idx


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
                        manual_idx = 1
                        for fname in files:
                            base = os.path.basename(_normalize(fname))
                            if not base or not _is_image(base): continue
                            try:
                                dest_name, manual_idx = _snapshot_dest_name(base, dest_dir, manual_idx)
                                (dest_dir / dest_name).write_bytes(z.read(fname))
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
                manual_idx = 1
                for fname in files:
                    base = os.path.basename(_normalize(fname))
                    if not base or not _is_image(base): continue
                    try:
                        data = z.read(fname)
                        trigger = _guess_trigger(base)
                        # Renommer selon la convention BambuNymous (snapshot-{trigger}.ext)
                        # plutôt que de garder le nom d'origine Spoolnymous — c'est ce nom
                        # qui sert ensuite au matching disque↔DB côté frontend/API.
                        dest_name, manual_idx = _snapshot_dest_name(base, dest_dir, manual_idx, trigger)
                        dest = dest_dir / dest_name
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


async def import_uploads_filaments_zip(zip_source) -> dict:
    """
    Importe photos depuis le ZIP uploads/filaments de Spoolnymous.

    Deux structures possibles :
    1. Fichier racine : {id}.webp  → photo principale → /data/filaments/{id}/Photo-01.webp
    2. Dossier : {id}/Photo-01.webp → galerie → /data/filaments/{id}/Photo-01.webp
    """
    stats = {"copied": 0, "errors": 0, "skipped": 0}
    with zipfile.ZipFile(zip_source) as z:
        names = z.namelist()
        logger.info(f"[ZIP-FIL] {len(names)} entrées, exemples: {names[:5]}")

        for name in names:
            if name.endswith("/"): continue
            norm = _normalize(name)
            parts = norm.split("/")
            base = os.path.basename(norm)
            if not base or base.startswith("."): continue
            if not _is_image(base):
                stats["skipped"] += 1
                continue

            fil_id = None
            dest_name = None

            if len(parts) == 1:
                # Cas 1 : fichier à la racine — {id}.webp ou {id}.jpg
                stem = re.sub(r"\.[^.]+$", "", base)
                if stem.isdigit():
                    fil_id = stem
                    dest_name = "Photo-01" + os.path.splitext(base)[1]
            else:
                # Cas 2 : dans un dossier — {id}/Photo-xx.webp
                fil_id = next((p for p in parts[:-1] if p.isdigit()), None)
                dest_name = _safe_name(base)

            if not fil_id:
                logger.debug(f"[ZIP-FIL] Skip (pas d'id): {name}")
                stats["skipped"] += 1
                continue

            dest_dir = DATA_DIR / "filaments" / fil_id
            dest_dir.mkdir(parents=True, exist_ok=True)
            try:
                dest = dest_dir / dest_name
                # Éviter d'écraser Photo-01 si existe déjà (cas multi-fichiers racine)
                if dest.exists() and len(parts) == 1:
                    idx = 2
                    while (dest_dir / f"Photo-{idx:02d}{os.path.splitext(base)[1]}").exists():
                        idx += 1
                    dest = dest_dir / f"Photo-{idx:02d}{os.path.splitext(base)[1]}"
                dest.write_bytes(z.read(name))
                stats["copied"] += 1
            except Exception as e:
                logger.error(f"[ZIP-FIL] {name}: {e}")
                stats["errors"] += 1

    logger.info(f"[ZIP-FIL] {stats}")
    return stats


async def import_uploads_groups_zip(zip_source) -> dict:
    """
    Importe photos depuis uploads/groups/{group_id}/.

    {group_id} est l'id numérique Spoolnymous, pas un id BambuNymous. On le
    résout vers le Group BambuNymous correspondant via Group.external_ref
    (rempli pendant l'import DB — cf. import_db.py) et on stocke les photos
    sous /data/groups/{group.id}/ (id propre BambuNymous), exactement comme
    /data/prints/{print.id}/ et /data/filaments/{filament.id}/.

    Si l'import DB n'a pas encore été fait pour ce groupe (external_ref
    inconnu), les photos sont ignorées plutôt que mal rattachées — relancer
    ce zip après l'import DB.
    """
    stats = {"copied": 0, "errors": 0, "skipped": 0}

    # Pré-charger le mapping id Spoolnymous (external_ref) → id Group BambuNymous
    ref_map: dict[str, int] = {}
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Group).where(Group.external_ref.is_not(None)))
            for g in result.scalars().all():
                ref_map[str(g.external_ref)] = g.id
    except Exception as e:
        logger.debug(f"[ZIP-GRP] chargement Group: {e}")

    with zipfile.ZipFile(zip_source) as z:
        for name in z.namelist():
            if name.endswith("/"): continue
            parts = _normalize(name).split("/")
            base = os.path.basename(parts[-1])
            if not base or not _is_image(base): continue
            old_group_id = next((p for p in parts[:-1] if p.isdigit()), None)
            if not old_group_id: continue
            new_group_id = ref_map.get(old_group_id)
            if not new_group_id:
                logger.debug(f"[ZIP-GRP] pas de Group pour external_ref={old_group_id} (faire l'import DB d'abord) → {name} ignoré")
                stats["skipped"] += 1
                continue
            dest_dir = DATA_DIR / "groups" / str(new_group_id)
            dest_dir.mkdir(parents=True, exist_ok=True)
            try:
                (dest_dir / _safe_name(base)).write_bytes(z.read(name))
                stats["copied"] += 1
            except Exception as e:
                logger.error(f"[ZIP-GRP] {name}: {e}")
                stats["errors"] += 1
    logger.info(f"[ZIP-GRP] {stats}")
    return stats


async def import_uploads_accessories_zip(zip_source) -> dict:
    """
    Importe photos d'accessoires depuis un ZIP.
    Structure attendue : {old_accessory_id}/image.ext  (ou à plat : {old_id}_nom.ext)
    Résolution via Accessory.external_ref → id BambuNymous.
    Stockage : DATA_DIR/accessories/{new_id}/
    """
    from ..models.object_history import Accessory

    stats = {"copied": 0, "errors": 0, "skipped": 0}

    ref_map: dict[str, int] = {}
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Accessory).where(Accessory.external_ref.is_not(None)))
            for a in result.scalars().all():
                ref_map[str(a.external_ref)] = a.id
    except Exception as e:
        logger.debug(f"[ZIP-ACC] chargement Accessory: {e}")

    with zipfile.ZipFile(zip_source) as z:
        for name in z.namelist():
            if name.endswith("/"): continue
            parts = _normalize(name).split("/")
            base = os.path.basename(parts[-1])
            if not base or not _is_image(base): continue

            # Chercher l'id Spoolnymous dans le chemin (dossier numérique)
            old_acc_id = next((p for p in parts[:-1] if p.isdigit()), None)
            # Fallback : fichier à plat — formats supportés :
            #   acc_{id}_nom.ext   (Spoolnymous)
            #   {id}_nom.ext
            #   {id}-nom.ext
            if not old_acc_id:
                m = re.match(r"^acc_?(\d+)[_\-]", base, re.IGNORECASE) or re.match(r"^(\d+)[_\-]", base)
                old_acc_id = m.group(1) if m else None

            if not old_acc_id:
                stats["skipped"] += 1
                continue

            new_acc_id = ref_map.get(old_acc_id)
            if not new_acc_id:
                logger.debug(f"[ZIP-ACC] pas d'Accessory pour external_ref={old_acc_id} → {name} ignoré")
                stats["skipped"] += 1
                continue

            dest_dir = DATA_DIR / "accessories" / str(new_acc_id)
            dest_dir.mkdir(parents=True, exist_ok=True)
            try:
                (dest_dir / _safe_name(base)).write_bytes(z.read(name))
                stats["copied"] += 1
            except Exception as e:
                logger.error(f"[ZIP-ACC] {name}: {e}")
                stats["errors"] += 1

    logger.info(f"[ZIP-ACC] {stats}")
    return stats
