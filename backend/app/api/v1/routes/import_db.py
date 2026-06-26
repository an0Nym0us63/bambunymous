"""
Route d'import de la DB Spoolnymous v1.
Upload du fichier SQLite + déclenchement de l'import.
"""
import sqlite3
import asyncio
import logging
from pathlib import Path
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, func
from ....db.session import get_db
from .auth import get_current_user
from ....core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

UPLOAD_PATH = Path("/data/import_v1.db")
_import_status = {"running": False, "done": False, "error": None, "stats": None}


class ImportStatus(BaseModel):
    uploaded: bool
    already_imported: bool
    running: bool
    done: bool
    error: str | None
    stats: dict | None


@router.get("/status", response_model=ImportStatus)
async def import_status(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    uploaded = UPLOAD_PATH.exists()

    # Vérifier si déjà importé (filaments présents en DB)
    count = await db.scalar(select(func.count()).select_from(text("filaments")))
    already_imported = (count or 0) > 0

    return ImportStatus(
        uploaded=uploaded,
        already_imported=already_imported,
        running=_import_status["running"],
        done=_import_status["done"],
        error=_import_status["error"],
        stats=_import_status["stats"],
    )


@router.post("/upload")
async def upload_db(
    file: UploadFile = File(...),
    _: str = Depends(get_current_user),
):
    if not file.filename.endswith(".db"):
        raise HTTPException(400, "Fichier .db requis")

    content = await file.read()

    # Vérifier que c'est bien une DB SQLite avec les bonnes tables
    tmp = Path("/tmp/check_import.db")
    tmp.write_bytes(content)
    try:
        conn = sqlite3.connect(str(tmp))
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        conn.close()
        required = {"filaments", "bobines"}
        missing = required - tables
        if missing:
            raise HTTPException(400, f"Tables manquantes: {', '.join(missing)}")
        fil_count = sqlite3.connect(str(tmp)).execute("SELECT COUNT(*) FROM filaments").fetchone()[0]
        spool_count = sqlite3.connect(str(tmp)).execute("SELECT COUNT(*) FROM bobines").fetchone()[0]
    finally:
        tmp.unlink(missing_ok=True)

    UPLOAD_PATH.write_bytes(content)
    _import_status.update({"done": False, "error": None, "stats": None})

    return {
        "ok": True,
        "filaments": fil_count,
        "spools": spool_count,
        "size_kb": round(len(content) / 1024, 1),
    }


@router.post("/run")
async def run_import(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    if not UPLOAD_PATH.exists():
        raise HTTPException(400, "Aucun fichier uploadé")
    if _import_status["running"]:
        raise HTTPException(409, "Import déjà en cours")

    # Lancer en background
    asyncio.create_task(_do_import())
    return {"ok": True, "message": "Import démarré"}


async def _do_import():
    from app.db.import_db import run_import as do_run
    _import_status.update({"running": True, "error": None, "done": False, "stats": None})
    try:
        stats = await do_run(str(UPLOAD_PATH))
        _import_status.update({"running": False, "done": True, "stats": stats})
        logger.info(f"Import terminé: {stats}")
    except Exception as e:
        logger.exception("Import échoué")
        _import_status.update({"running": False, "error": str(e), "done": False})
