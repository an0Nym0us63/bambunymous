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
# Un compte "readonly" peut tout consulter mais ne doit rien pouvoir modifier.
# Plutot que d'annoter un a un des centaines d'endpoints (avec le risque d'en
# oublier, et d'oublier les futurs), on filtre globalement sur la methode HTTP :
# tout ce qui n'est pas une lecture est refuse. Seul le changement de son propre
# mot de passe fait exception.
_READONLY_ALLOWED_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/change-password",
}


# Libelles lisibles pour le journal, deduits du chemin.
def _activity_label(method: str, path: str) -> str:
    p = path.replace("/api/v1", "")
    if p.startswith("/auth/login"):        return "Connexion"
    if p.startswith("/auth/change-password"): return "Changement de mot de passe"
    if p.startswith("/users"):             return "Gestion des comptes"
    if p.startswith("/prints"):            return "Impressions"
    if p.startswith("/filaments"):         return "Filaments / bobines"
    if p.startswith("/objects/accessories"): return "Accessoires"
    if p.startswith("/objects"):           return "Objets"
    if p.startswith("/attention"):         return "Alertes"
    if p.startswith("/settings"):          return "Parametres"
    if p.startswith("/rfid"):              return "Scan RFID"
    if p.startswith("/printer"):           return "Imprimante"
    return p


# Pages de l'application. L'interface etant en page unique, le serveur ne voit
# jamais de navigation : c'est le front qui annonce sa page courante dans
# l'en-tete X-App-Page. Deviner la page depuis l'endpoint appele ne marcherait
# pas -- /filaments/filaments est interroge depuis l'Accueil, l'Historique, les
# Filaments ET les Parametres.
_PAGE_LABELS = {
    "/":          "Accueil",
    "/prints":    "Historique",
    "/filaments": "Filaments",
    "/objects":   "Objets",
    "/stats":     "Statistiques",
    "/settings":  "Parametres",
    "/logs":      "Journal",
}

# Dernieres vues journalisees par compte, gardees en memoire. Indispensable :
# le front envoie les en-tetes a CHAQUE appel, polling imprimante compris, et
# une lecture SQL par requete serait absurde. Cache local au processus ; l'app
# tourne en un seul worker (le client MQTT est un singleton en memoire), sinon
# quelques doublons apparaitraient au changement de worker.
#
# DEUX emplacements distincts, et non un seul : page et detail changent en
# alternance. Ouvrir une fiche bascule le detail, puis le rafraichissement de
# la liste derriere ferait rebasculer la page -- avec un emplacement unique le
# journal se serait mis a alterner page/fiche/page/fiche indefiniment.
_LAST_PAGE = {}
_LAST_DETAIL = {}
_PAGE_REPEAT = 30   # minutes avant de re-journaliser une vue inchangee


def _detail_key(raw):
    """
    Libelle de detail annonce par le front (onglet ouvert, fiche consultee),
    encode en URI pour survivre aux accents : un en-tete HTTP est limite a
    l'ASCII, "Gris anthracite metallise" serait passe mais pas "métallisé".
    """
    if not raw:
        return None
    try:
        from urllib.parse import unquote
        label = unquote(str(raw)).strip()
    except Exception:
        return None
    # 120 = taille de la colonne label ; on coupe ici plutot que de laisser
    # SQLite tronquer sans prevenir.
    return label[:120] or None


def _page_key(raw):
    """Normalise l'en-tete en une page connue, ou None. Filtrer sur une liste
    fermee evite qu'une URL inattendue ne pollue le journal."""
    p = (raw or "").split("?")[0].strip()
    if not p.startswith("/"):
        return None
    body = p.strip("/")
    seg = "/" + body.split("/")[0] if body else "/"
    return seg if seg in _PAGE_LABELS else None


@app.middleware("http")
async def track_activity(request, call_next):
    """
    Suit l'activite des comptes :
      - users.last_seen a chaque requete authentifiee (au plus une ecriture par
        minute et par compte, sinon on ecrirait a chaque appel de polling) ;
      - une ligne "action" pour chaque ecriture ou connexion ;
      - une ligne "visite" a chaque changement de page de l'interface.
    Ne doit jamais faire echouer la requete : tout est protege.
    """
    response = await call_next(request)

    path = request.url.path
    if not path.startswith("/api/"):
        return response
    try:
        from datetime import datetime, timedelta
        from sqlalchemy import select, update
        from app.core.security import decode_token_payload
        from app.db.session import AsyncSessionLocal
        from app.models.user import User
        from app.models.activity import ActivityLog

        username = None
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            payload = decode_token_payload(auth.split(" ", 1)[1].strip())
            if payload:
                username = payload.get("sub")
        is_login = path.endswith("/auth/login") and response.status_code < 400
        if is_login and not username:
            # Au login le client n'a pas encore de jeton : on prend l'identifiant
            # transmis dans le formulaire.
            username = (request.query_params.get("username")
                        or getattr(request.state, "login_username", None))
        if not username:
            return response

        is_action = request.method in ("POST", "PATCH", "PUT", "DELETE")
        now = datetime.utcnow()

        # Visite et detail : uniquement au changement, ou apres une longue
        # inactivite sur la meme vue -- sinon une session ouverte des heures
        # sur l'Accueil n'y laisserait qu'une seule trace, en tout debut.
        def _changed(cache, key):
            if not key:
                return False
            prev = cache.get(username)
            if (prev is None or prev[0] != key
                    or (now - prev[1]) > timedelta(minutes=_PAGE_REPEAT)):
                cache[username] = (key, now)
                return True
            return False

        ok = response.status_code < 400
        page   = _page_key(request.headers.get("x-app-page")) if ok else None
        detail = _detail_key(request.headers.get("x-app-detail")) if ok else None
        is_visit  = _changed(_LAST_PAGE, page)
        is_detail = _changed(_LAST_DETAIL, detail)
        async with AsyncSessionLocal() as db:
            u = (await db.execute(
                select(User).where(User.username == username)
            )).scalar_one_or_none()
            if u and (u.last_seen is None or (now - u.last_seen) > timedelta(minutes=1)):
                await db.execute(
                    update(User).where(User.id == u.id).values(last_seen=now))
                await db.commit()
            if is_action and response.status_code < 400:
                db.add(ActivityLog(
                    username=username, method=request.method, path=path,
                    status=response.status_code, kind="action",
                    label=_activity_label(request.method, path), created_at=now))
                await db.commit()
            else:
                # Une requete peut porter les deux a la fois : arriver sur une
                # page en ouvrant directement une fiche. On journalise la page
                # d'abord, pour que l'ordre de lecture reste logique.
                if is_visit:
                    db.add(ActivityLog(
                        username=username, method="VUE", path=page,
                        status=response.status_code, kind="visite",
                        label=_PAGE_LABELS[page], created_at=now))
                if is_detail:
                    db.add(ActivityLog(
                        username=username, method="DETAIL", path=page or "",
                        status=response.status_code, kind="detail",
                        label=detail, created_at=now))
                if is_visit or is_detail:
                    await db.commit()
    except Exception:
        pass   # le suivi ne doit jamais casser une requete
    return response


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
            # Test sur "different de admin" et non sur une liste de roles brides :
            # tout role inconnu ou ajoute plus tard est en lecture seule tant
            # qu'on ne l'a pas explicitement autorise. L'inverse laisse un
            # nouveau role obtenir tous les droits d'ecriture en silence -- ce
            # qui vient d'arriver a readonly_prices.
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
