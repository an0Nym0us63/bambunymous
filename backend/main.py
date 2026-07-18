from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.encoders import jsonable_encoder
from datetime import datetime
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
    # Restaurer les prints IN_PROGRESS en mémoire après un redémarrage
    from app.services.print_tracker import restore_in_progress, resume_enrichment
    await restore_in_progress()
    # Reprend les prints laisses sans 3MF par un redemarrage pendant la fenetre
    # de retry (les retries d'_enrich ne vivent qu'en memoire).
    await resume_enrichment()
    # Démarrer le worker de location AMS (doit être dans le bon event loop)
    from app.services.spool_location import _ensure_worker
    await _ensure_worker()
    await mqtt_manager.start()
    # Catalogue filaments Bambu (m0h31h31/3DPrint-Filament-RFID-Tool) :
    # téléchargé au démarrage depuis GitHub, re-vérifié toutes les 24h via ETag.
    from app.services.bambu_catalog import BambuCatalogSync
    catalog_sync = BambuCatalogSync(data_dir=settings.DATA_DIR)
    catalog_sync.start()
    # Vider le cache de matching au démarrage
    from app.core.mqtt import invalidate_tray_cache
    invalidate_tray_cache()

    # Purge automatique du fichier log toutes les heures (seuil 500 Mo)
    import threading as _th, time as _time
    _stop_purge = _th.Event()
    def _log_purge_loop():
        from app.api.v1.routes.logs import _auto_purge, LOG_FILE
        while not _stop_purge.wait(3600):   # toutes les heures
            purged = _auto_purge(LOG_FILE)
            if purged:
                import logging as _lg
                _lg.getLogger(__name__).info("[LOG] Purge automatique du fichier log effectuée")
    _th.Thread(target=_log_purge_loop, name="LogPurge", daemon=True).start()

    yield
    _stop_purge.set()
    catalog_sync.stop()
    await mqtt_manager.stop()


# Sérialiser les datetimes UTC avec suffixe Z pour que le navigateur les interprète correctement
from fastapi import FastAPI as _FA
import fastapi.encoders as _enc
_orig_enc = _enc.jsonable_encoder
def _patched_encoder(obj, *a, **kw):
    if isinstance(obj, datetime) and obj.tzinfo is None:
        return obj.strftime("%Y-%m-%dT%H:%M:%SZ")
    return _orig_enc(obj, *a, **kw)
_enc.jsonable_encoder = _patched_encoder

app = FastAPI(
    title="Bambunymous",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
)

# ── Lecture seule ────────────────────────────────────────────────────────────
# Un compte non-administrateur peut tout consulter mais ne doit rien pouvoir
# modifier. Plutot que d'annoter un a un des centaines d'endpoints (avec le
# risque d'en oublier, et d'oublier les futurs), on filtre globalement sur la
# methode HTTP : tout ce qui n'est pas une lecture est refuse. Seul le
# changement de son propre mot de passe fait exception.
#
# Le test porte sur "role != admin" et non sur une liste de roles bridés : tout
# role inconnu ou ajoute plus tard est en lecture seule tant qu'on ne l'a pas
# explicitement autorise. L'inverse laissait un nouveau role obtenir tous les
# droits d'ecriture en silence.
_READONLY_ALLOWED_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/change-password",
}


@app.middleware("http")
async def enforce_readonly(request, call_next):
    from starlette.responses import JSONResponse
    from app.core.security import decode_token_payload

    path = request.url.path
    if (path.startswith("/api/")
            and request.method not in ("GET", "HEAD", "OPTIONS")
            and path not in _READONLY_ALLOWED_PATHS):
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            payload = decode_token_payload(auth.split(" ", 1)[1].strip())
            if payload and (payload.get("role") or "admin") != "admin":
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Compte en lecture seule : action non autorisee"},
                )
    return await call_next(request)


@app.middleware("http")
async def no_cache_api(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pas de limite de taille pour les uploads (fichiers ZIP plusieurs Go)
from starlette.middleware.base import BaseHTTPMiddleware
class NoSizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        request._body = None  # Laisser le body streamer gérer
        return await call_next(request)

app.state.max_upload_size = None

from fastapi import Request as _Req
from fastapi.responses import FileResponse as _FR

@app.get("/favicon.png",  include_in_schema=False)
@app.get("/icon.svg",     include_in_schema=False)
@app.get("/icon-180.png", include_in_schema=False)
@app.get("/icon-192.png", include_in_schema=False)
@app.get("/icon-512.png", include_in_schema=False)
@app.get("/manifest.json",include_in_schema=False)
async def _pwa_asset(request: _Req):
    fname = request.url.path.lstrip("/")
    p = STATIC_DIR / fname
    if p.exists():
        mt = "image/svg+xml" if fname.endswith(".svg") else              "application/manifest+json" if fname.endswith(".json") else "image/png"
        return _FR(str(p), media_type=mt)
    from fastapi import HTTPException
    raise HTTPException(404)

app.include_router(api_router)


@app.get("/db")
async def db_debug():
    import aiosqlite, os
    path = "/data/bambunymous.db"
    if not os.path.exists(path):
        return {"error": f"{path} introuvable"}
    result = {}
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT name FROM sqlite_master WHERE type=\'table\'") as cur:
            result["tables"] = [r[0] async for r in cur]
        if "prints" in result["tables"]:
            async with db.execute("SELECT id,job_id,file_name,status,plate_image,created_at FROM prints ORDER BY id DESC LIMIT 10") as cur:
                result["prints"] = [dict(r) async for r in cur]
        else:
            result["prints_table"] = "ABSENTE"
    return result


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
        # Une route d'API inexistante tombait ici et renvoyait index.html : le
        # navigateur affichait une PAGE BLANCHE au lieu d'un 404, et un POST vers
        # une URL absente donnait un 405 (le chemin matche ce catch-all, pas la
        # methode). Deux faux diagnostics qui nous ont deja coute du temps.
        if full_path.startswith("api/"):
            return JSONResponse(
                {"detail": f"Route inconnue : /{full_path}"}, status_code=404
            )

        # Tout fichier reellement present a la racine du build (les fichiers de
        # frontend/public : icones, manifest, textures...) doit etre servi tel
        # quel. Sans ca, il tombait dans le fallback et le navigateur recevait
        # index.html a la place de l'image -> asset "casse" et masque CSS KO.
        # Auparavant chaque fichier devait etre declare a la main dans une liste
        # de routes explicites : tout nouvel asset etait casse en silence.
        if full_path and not full_path.startswith("api/"):
            candidate = (STATIC_DIR / full_path).resolve()
            try:
                # garde-fou : interdit de sortir de STATIC_DIR (../..)
                candidate.relative_to(STATIC_DIR.resolve())
            except ValueError:
                candidate = None
            if candidate and candidate.is_file():
                return FileResponse(str(candidate))

        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index), headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache", "Expires": "0",
            })
        return JSONResponse({"error": "Frontend not built"}, status_code=503)
