from fastapi import APIRouter
from .routes import auth, printer, settings, filaments, import_db, logs

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router,      prefix="/auth",      tags=["auth"])
router.include_router(printer.router,   prefix="/printer",   tags=["printer"])
router.include_router(settings.router,  prefix="/settings",  tags=["settings"])
router.include_router(filaments.router, prefix="/filaments", tags=["filaments"])
router.include_router(import_db.router, prefix="/import",    tags=["import"])
router.include_router(logs.router,      prefix="/logs",      tags=["logs"])
