from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
import logging
import os

from app.core.config import settings
from app.db.session import init_db
from app.api.v1 import router as api_router
from app.core.mqtt import mqtt_manager

VERSION = os.getenv("COMMIT_SHA", "dev")[:8]

# ── Logging ────────────────────────────────────────────────────────────────
# basicConfig est appelé par uvicorn AVANT notre code → on ne peut pas l'utiliser
# On ajoute le FileHandler directement dans le lifespan, après que /data existe
LOG_FILE = str(Path(settings.DATA_DIR) / "bambunymous.log")
_log_fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

# Silencer les loggers trop verbeux
for _noisy in ("sqlalchemy.engine", "sqlalchemy.pool", "aiosqlite", "sqlalchemy.dialects"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)
    Path(settings.UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
    # Ajouter FileHandler sur TOUS les loggers existants (uvicorn les a déjà créés)
    _fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    _fh.setFormatter(_log_fmt)
    _fh.setLevel(logging.DEBUG)
    # Ajouter sur TOUS les loggers déjà créés + root
    root = logging.getLogger()
    root.addHandler(_fh)
    root.setLevel(logging.DEBUG)
    # S'assurer que tous les sous-loggers propagent vers root
    for _name, _lg in list(logging.Logger.manager.loggerDict.items()):
        if isinstance(_lg, logging.Logger):
            _lg.setLevel(logging.DEBUG)
            _lg.propagate = True
    logger.info(f"BambuNymous starting — version {VERSION}")
    await init_db()
    await mqtt_manager.start()
    yield
    await mqtt_manager.stop()


app = FastAPI(
    title="Bambunymous",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/healthz", include_in_schema=False)
async def healthz():
    return JSONResponse({"status": "ok", "version": VERSION})


@app.get("/api/v1/version", include_in_schema=False)
async def version():
    return {"version": VERSION, "commit": os.getenv("COMMIT_SHA", "dev"), "build_date": os.getenv("BUILD_DATE", "?")}


uploads = Path(settings.UPLOADS_DIR)
uploads.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads)), name="uploads")

STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return JSONResponse({"error": "Frontend not built"}, status_code=503)
