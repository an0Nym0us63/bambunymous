"""
Routes d'import ZIP depuis Spoolnymous.
Chaque ZIP correspond à un type de données.
"""
import logging
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from .auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

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
    if not file.filename.endswith(".zip"):
        raise HTTPException(400, "Fichier .zip requis")

    data = await file.read()
    logger.info(f"[ZIP] Import {zip_type} — {len(data)//1024} Ko")

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

    try:
        stats = await fn(data)
        return {"ok": True, "type": zip_type, "stats": stats}
    except Exception as e:
        logger.exception(f"[ZIP] Import {zip_type} échoué")
        raise HTTPException(500, str(e))
