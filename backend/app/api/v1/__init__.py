from fastapi import APIRouter
from .routes import auth, printer, settings, filaments, import_db, logs, camera, prints, import_zip, objects

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router,      prefix="/auth",      tags=["auth"])
router.include_router(printer.router,   prefix="/printer",   tags=["printer"])
router.include_router(settings.router,  prefix="/settings",  tags=["settings"])
router.include_router(filaments.router, prefix="/filaments", tags=["filaments"])
router.include_router(import_db.router, prefix="/import",    tags=["import"])
router.include_router(logs.router,      prefix="/logs",      tags=["logs"])
router.include_router(camera.router,    prefix="/camera",    tags=["camera"])
router.include_router(prints.router,    prefix="/prints",    tags=["prints"])
router.include_router(import_zip.router, prefix="/import-zip",  tags=["import-zip"])
router.include_router(objects.router,    prefix="/objects",     tags=["objects"])
