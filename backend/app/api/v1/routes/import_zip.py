"""
Routes d'import ZIP depuis Spoolnymous.
Les fichiers ZIP sont d'abord écrits sur disque (/data/tmp/) 
puis traités en streaming pour éviter les problèmes de mémoire sur les gros fichiers.
Le fichier temporaire est supprimé après traitement (succès ou erreur).
"""
import logging
import os
import shutil
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from .auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
TMP_DIR  = DATA_DIR / "tmp"

ZIP_TYPES = {
    "prints":            "Vignettes PNG + fichiers 3MF des prints",
    "uploads_prints":    "Snapshots milestones (Impression-50.jpg…)",
    "uploads_filaments": "Photos filaments (Photo-01.webp…)",
    "uploads_groups":    "Photos galeries groupes (Photo-01.webp…)",
}


@router.get("/types")
async def list_zip_types(_: str = Depends(get_current_user)):
    return {"types": [{"id": k, "label": v} for k, v in ZIP_TYPES.items()]}


@router.post("/{zip_type}")
async def import_zip(
    zip_type: str,
    file: UploadFile = File(...),
    _: str = Depends(get_current_user),
):
    if zip_type not in ZIP_TYPES:
        raise HTTPException(400, f"Type inconnu. Valeurs : {list(ZIP_TYPES)}")
    if not (file.filename or "").endswith(".zip"):
        raise HTTPException(400, "Fichier .zip requis")

    # Écrire sur disque en streaming (évite de tout charger en RAM)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = TMP_DIR / f"{zip_type}_{uuid.uuid4().hex}.zip"

    try:
        logger.info(f"[ZIP] Réception {zip_type} → {tmp_path}")
        written = 0
        with open(tmp_path, "wb") as f:
            while chunk := await file.read(8 * 1024 * 1024):  # 8 Mo par chunk
                f.write(chunk)
                written += len(chunk)
        logger.info(f"[ZIP] {zip_type} reçu — {written // 1024 // 1024} Mo → traitement...")

        from ....services.zip_importer import (
            import_prints_zip,
            import_uploads_prints_zip,
            import_uploads_filaments_zip,
            import_uploads_groups_zip,
        )

        fn = {
            "prints":            import_prints_zip,
            "uploads_prints":    import_uploads_prints_zip,
            "uploads_filaments": import_uploads_filaments_zip,
            "uploads_groups":    import_uploads_groups_zip,
        }[zip_type]

        # Passer le chemin disque au lieu des bytes
        stats = await fn(tmp_path)
        logger.info(f"[ZIP] {zip_type} terminé: {stats}")
        return {"ok": True, "type": zip_type, "size_mb": written // 1024 // 1024, "stats": stats}

    except Exception as e:
        logger.exception(f"[ZIP] Import {zip_type} échoué")
        raise HTTPException(500, str(e))
    finally:
        # Toujours supprimer le fichier temporaire
        try:
            tmp_path.unlink(missing_ok=True)
            logger.info(f"[ZIP] Fichier temporaire supprimé: {tmp_path}")
        except Exception:
            pass
