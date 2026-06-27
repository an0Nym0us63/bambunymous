from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
import logging

from app.core.config import settings
from app.db.session import init_db
from app.api.v1 import router as api_router
from app.core.mqtt import mqtt_manager

# ── Log buffer : DOIT être installé avant basicConfig ─────────────────────
# basicConfig écrase les handlers du root logger si appelé après addHandler
# On crée le handler, on le garde, puis on l'ajoute après basicConfig
import collections as _col

class _BufHandler(logging.Handler):
    buf: _col.deque = _col.deque(maxlen=1000)
    def emit(self, record):
        try:
            self.buf.append({
                "ts":    self.formatTime(record, "%H:%M:%S"),
                "level": record.levelname,
                "name":  record.name.split(".")[-1],
                "msg":   record.getMessage(),
            })
        except Exception:
            pass

LOG_HANDLER = _BufHandler()
LOG_HANDLER.setLevel(logging.DEBUG)

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
# Ajouter après basicConfig pour ne pas être écrasé
logging.getLogger().addHandler(LOG_HANDLER)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)
    Path(settings.UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
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

# ── API routes ────────────────────────────────────────────────────────────────
app.include_router(api_router)


@app.get("/healthz", include_in_schema=False)
async def healthz():
    return JSONResponse({"status": "ok", "version": "2.0.0"})


# ── Uploads statiques ─────────────────────────────────────────────────────────
uploads = Path(settings.UPLOADS_DIR)
uploads.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads)), name="uploads")

# ── Frontend SPA ──────────────────────────────────────────────────────────────
# Les assets statiques (js, css, images) sont servis directement.
# Toute autre route renvoie index.html pour que React Router gère la navigation.
STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.exists():
    # Mount les assets (fichiers avec extension)
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return JSONResponse({"error": "Frontend not built"}, status_code=503)
