"""
Routes d'import ZIP depuis Spoolnymous.
L'import tourne dans un thread dédié (avec son propre event loop) pour ne pas
bloquer uvicorn et pour survivre à la réponse HTTP.
"""
import asyncio
import logging
import os
import threading
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from .auth import get_current_user

router   = APIRouter()
logger   = logging.getLogger(__name__)
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
TMP_DIR  = DATA_DIR / "tmp"

ZIP_TYPES = {
    "prints":            "Vignettes PNG + fichiers 3MF des prints",
    "uploads_prints":    "Snapshots milestones (Impression-50.jpg…)",
    "uploads_filaments": "Photos filaments (Photo-01.webp…)",
    "uploads_groups":    "Photos galeries groupes (Photo-01.webp…)",
    "uploads_accessories": "Photos accessoires ({id}/image.ext)",
}

# Statuts en mémoire : {job_id: {...}}
_JOBS: dict[str, dict] = {}


@router.get("/types")
async def list_zip_types(_: str = Depends(get_current_user)):
    return {"types": [{"id": k, "label": v} for k, v in ZIP_TYPES.items()]}


@router.get("/status/{job_id}")
async def zip_status(job_id: str, _: str = Depends(get_current_user)):
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job inconnu")
    return job


@router.get("/status")
async def zip_status_all(_: str = Depends(get_current_user)):
    return {"jobs": list(_JOBS.values())}


@router.post("/{zip_type}")
async def import_zip(
    zip_type: str,
    file: UploadFile = File(...),
    _: str = Depends(get_current_user),
):
    if zip_type not in ZIP_TYPES:
        raise HTTPException(400, f"Type inconnu: {list(ZIP_TYPES)}")
    if not (file.filename or "").endswith(".zip"):
        raise HTTPException(400, "Fichier .zip requis")

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    job_id   = uuid.uuid4().hex[:12]
    tmp_path = TMP_DIR / f"{zip_type}_{job_id}.zip"

    # Écrire sur disque en streaming (évite de charger tout en RAM)
    written = 0
    try:
        with open(tmp_path, "wb") as f:
            while chunk := await file.read(8 * 1024 * 1024):
                f.write(chunk)
                written += len(chunk)
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(500, f"Erreur upload: {e}")

    size_mb = written // 1024 // 1024
    logger.info(f"[ZIP] {zip_type} reçu {size_mb} Mo → job {job_id}")

    _JOBS[job_id] = {
        "job_id":  job_id,
        "type":    zip_type,
        "status":  "running",
        "size_mb": size_mb,
        "stats":   None,
        "error":   None,
    }

    # Thread dédié avec son propre event loop — plus fiable qu'asyncio.create_task
    def _thread_run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_run_import(job_id, zip_type, tmp_path))
        finally:
            loop.close()

    t = threading.Thread(target=_thread_run, daemon=True, name=f"zip-{job_id}")
    t.start()
    logger.info(f"[ZIP] thread démarré: {t.name}")

    return {"ok": True, "job_id": job_id, "size_mb": size_mb}


async def _run_import(job_id: str, zip_type: str, tmp_path: Path):
    from ....services.zip_importer import (
        import_prints_zip,
        import_uploads_prints_zip,
        import_uploads_filaments_zip,
        import_uploads_groups_zip,
        import_uploads_accessories_zip,
    )
    fn = {
        "prints":            import_prints_zip,
        "uploads_prints":    import_uploads_prints_zip,
        "uploads_filaments": import_uploads_filaments_zip,
        "uploads_groups":    import_uploads_groups_zip,
        "uploads_accessories": import_uploads_accessories_zip,
    }[zip_type]
    try:
        logger.info(f"[ZIP] {zip_type} traitement démarré ({tmp_path})")
        stats = await fn(tmp_path)
        _JOBS[job_id]["status"] = "done"
        _JOBS[job_id]["stats"]  = stats
        logger.info(f"[ZIP] {zip_type} terminé: {stats}")
    except Exception as e:
        logger.exception(f"[ZIP] {zip_type} échoué: {e}")
        _JOBS[job_id]["status"] = "error"
        _JOBS[job_id]["error"]  = str(e)
    finally:
        tmp_path.unlink(missing_ok=True)
