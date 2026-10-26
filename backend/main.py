from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.encoders import jsonable_encoder
from datetime import datetime
from pathlib import Path
import logging
import logging.handlers
import mimetypes
# L'appli Android servie par le site (frontend/public/android) : sans ce type,
# certains navigateurs la prennent pour un fichier quelconque.
mimetypes.add_type("application/vnd.android.package-archive", ".apk")
# les captures du guide (/doc/img) : sans ca, certaines machines les servent en text/plain
mimetypes.add_type("image/webp", ".webp")
import time
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

# Filtre applique au fichier log : on n'y ECRIT pas le bruit (SQL, polling
# imprimante, assets). Sans lui, ce bruit noyait les vraies lignes et le
# visualiseur scannait dans le vide -> pages "Journal" vides / incoherentes.
_NOISY_LOG_NAMES = ("sqlalchemy", "aiosqlite")
_NOISY_LOG_MSGS = ("/api/v1/logs", "/api/v1/printer", "/healthz", "/favicon", "/assets/")
class _LogNoiseFilter(logging.Filter):
    def filter(self, record):
        if any(record.name.startswith(n) for n in _NOISY_LOG_NAMES):
            return False
        try:
            msg = record.getMessage()
        except Exception:
            return True
        return not any(x in msg for x in _NOISY_LOG_MSGS)


# Taches de fond lancees au demarrage (voir _bg dans lifespan)
_BG_TASKS: set = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)
    Path(settings.UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
    # Ajouter FileHandler sur TOUS les loggers existants (uvicorn les a déjà créés)
    # WatchedFileHandler (et non FileHandler) : la purge remplace le fichier via
    # os.replace ; un FileHandler continuerait alors d'ecrire dans l'ancien inode
    # (invisible) et le journal figeait a l'heure de la purge. WatchedFileHandler
    # detecte le remplacement et rouvre le nouveau fichier.
    _fh = logging.handlers.WatchedFileHandler(LOG_FILE, encoding="utf-8")
    _fh.setFormatter(_log_fmt)
    _fh.setLevel(logging.DEBUG)
    _fh.addFilter(_LogNoiseFilter())
    # Ajouter sur TOUS les loggers déjà créés + root
    root = logging.getLogger()
    root.addHandler(_fh)
    root.setLevel(logging.DEBUG)
    # S'assurer que tous les sous-loggers propagent vers root
    for _name, _lg in list(logging.Logger.manager.loggerDict.items()):
        if isinstance(_lg, logging.Logger):
            # Ne PAS forcer a DEBUG les loggers deliberement silencieux (SQL,
            # aiosqlite) : sinon on annule le setLevel(WARNING) plus haut et le
            # fichier reexplose de requetes SQL a chaque appel.
            if not _name.startswith(_NOISY_LOG_NAMES):
                _lg.setLevel(logging.DEBUG)
            _lg.propagate = True
    logger.info(f"BambuNymous starting — version {VERSION}")
    await init_db()
    # Delais de sechage (defaut + regles par famille / sous-famille) en memoire :
    # la fiche bobine et l'AMS les lisent sans requete.
    try:
        from app.services import drying as _drying
        await _drying.load()
        # Bobines posees dans un AMS pour le sechage (emplacement vide).
        from app.services import drying_slots as _dslots
        await _dslots.load()
    except Exception:
        logging.getLogger(__name__).exception("[DRY] regles de sechage non chargees")
    try:
        # Filaments d'avant le lien aux modeles de support vide : rattaches
        # une fois, au poids exact (cf. settings.link_legacy_tares).
        from app.db.session import AsyncSessionLocal as _ASL
        from app.api.v1.routes.settings import link_legacy_tares
        async with _ASL() as _db:
            await link_legacy_tares(_db)
    except Exception:
        logging.getLogger(__name__).exception("[TARE] rattachement des supports vides non fait")
    from app.services.hms import init_hms
    init_hms()   # charge cache/dump des libelles HMS
    # Restaurer les prints IN_PROGRESS en mémoire après un redémarrage
    from app.services.print_tracker import restore_in_progress, resume_enrichment, enrichment_reconciler
    await restore_in_progress()
    # Reprend les prints laisses sans 3MF par un redemarrage pendant la fenetre
    # de retry (les retries d'_enrich ne vivent qu'en memoire).
    await resume_enrichment()
    # Rattrapage PERIODIQUE du 3MF : sans lui, un print laisse sans 3MF obligeait
    # a redemarrer le container a la main. Tourne toutes les ~5 min (self-healing).
    import asyncio as _aio
    _reconciler_task = _aio.create_task(enrichment_reconciler())
    # Noms francais restes vides (quota d'un service de traduction atteint) :
    # repris toutes les 6 h, sans attendre un clic dans les reglages.
    from app.services.translate import auto_backfill_loop
    _trad_task = _aio.create_task(auto_backfill_loop())
    # Fiches publiques des modeles MakerWorld (titre, couverture, createur,
    # categories, tags) : lues en cache, relues tous les 30 jours.
    from app.services.makerworld import auto_loop as _mw_loop
    _mw_task = _aio.create_task(_mw_loop())
    # Compte MakerWorld : collections, j'aime et suivis prepares chaque heure.
    from app.services.makerworld_account import warm_loop as _mw_warm
    _mw_warm_task = _aio.create_task(_mw_warm())
    # Collections MakerWorld (ajouts, creations…) pour les notifications : 10 min.
    from app.services.mw_watch import watch_loop as _mw_watch
    _mw_watch_task = _aio.create_task(_mw_watch())
    # Mon activite de createur (points, boosts, abonnes, paliers) : 30 min.
    from app.services.mw_creator import watch_loop as _mw_creator
    _mw_creator_task = _aio.create_task(_mw_creator())
    # Liste « À faire » : calculee des le demarrage (et reprise de son dernier calcul).
    from app.services.mw_queue import warm as _queue_warm
    _queue_warm_task = _aio.create_task(_queue_warm())
    # Evaluations MakerWorld laissees en file avant l'arret : on les reprend.
    from app.services.mw_rate import resume_queue as _rate_resume
    # Taches de fond sans variable : gardees ici. asyncio ne retient qu'une
    # reference FAIBLE d'une tache ; sans autre reference, le ramasse-miettes
    # peut la supprimer pendant qu'elle dort, et sa boucle s'arrete sans bruit
    # (notifications des copains disparues le 20/10/2026).
    def _bg(coro):
        t = _aio.create_task(coro)
        _BG_TASKS.add(t)
        t.add_done_callback(_BG_TASKS.discard)
        return t
    _bg(_rate_resume())
    # la boucle surveillee : ce qui la fige est releve (Parametres > Vitesse du serveur)
    from app.core.perf import loop_watch as _loop_watch
    _bg(_loop_watch())
    # l'entretien de la base : statistiques au besoin, puis « PRAGMA optimize » chaque heure
    from app.core.perf import db_upkeep as _db_upkeep
    _bg(_db_upkeep())
    # 3MF d'origine MakerWorld : un rattrapage qui tournait a l'arret reprend tout seul
    from app.services.mw_source import resume_after_restart as _src_resume
    _bg(_src_resume())
    # Notifications de l'imprimante (pause, fin proche, HMS, sechage) : la
    # config est lue une fois pour l'ecouteur, qui ne touche pas a la base.
    from app.services import notify as _notify, notify_events as _nev
    from app.core.mqtt import subscribe_state as _sub
    try:
        await _notify.get_config()
    except Exception:
        pass
    _sub(_nev.watch)
    # Copains (debut / fin d'impression), impressions a evaluer, redemarrage
    _bg(_nev.friends_loop())
    _bg(_nev.mw_rate_loop())
    _bg(_nev.app_started())
    # Points d'attention, resume de la semaine, imprimante au repos ; version
    from app.services import notify_extra as _nx
    _bg(_nx.loop())
    _bg(_nx.update_loop())
    from app.services import achievements as _ach
    _bg(_ach.warm())                 # succes : gros calcul prepare d'avance
    from app.services import ach_watch as _aw
    _bg(_aw.loop())                  # succes : releves de l'imprimante et des copains
    from app.services import sd_card as _sd
    _bg(_sd.auto_loop())             # timelapse de chaque impression, copie de la carte SD apres la fin
    from app.services import archive as _arch
    _bg(_arch.nightly_loop())        # sauvegarde vers le NAS (et vidage du local) chaque nuit, si activee
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
    _reconciler_task.cancel()
    _trad_task.cancel()
    _mw_task.cancel()
    _mw_warm_task.cancel()
    _mw_watch_task.cancel()
    _mw_creator_task.cancel()
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
    # Double authentification de SON compte : permise aussi en lecture seule.
    "/api/v1/auth/2fa/setup",
    "/api/v1/auth/2fa/enable",
    "/api/v1/auth/2fa/disable",
}


# Libelles lisibles pour le journal, deduits du chemin.
def _activity_label(method: str, path: str) -> str:
    p = path.replace("/api/v1", "")
    if p.startswith("/auth/login"):        return "Connexion"
    if p.startswith("/auth/change-password"): return "Changement de mot de passe"
    if p.startswith("/auth/2fa"):          return "Double authentification"
    if p.startswith("/users/activity"):    return "Purge du journal d'activite"
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
    "/notifications": "Notifications",
    "/anonymous": "Anonymous",
    "/teapot":    "Theiere",
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
    # La reponse part tout de suite : le suivi (lecture du compte, ecritures) se fait en fond (26/10/2026).
    # Avant, chaque requete attendait une lecture en base avant d'etre rendue, et une page en lance 10 a 20.
    try:
        req_view = {"path": path, "method": request.method, "status": response.status_code,
                    "headers": {k: request.headers.get(k) for k in ("authorization", "x-app-active", "x-app-page", "x-app-detail")},
                    "query_username": request.query_params.get("username"),
                    "login_username": getattr(request.state, "login_username", None)}
        _track_spawn(req_view)
    except Exception:
        pass
    return response


_TRACK_TASKS: set = set()
_SEEN_AT: dict = {}          # compte -> derniere ecriture de last_seen (en memoire : pas de lecture en base a chaque requete)
_FK_USER: dict = {}          # empreinte d'une cle copain -> (compte, instant)


def _track_spawn(rv: dict) -> None:
    import asyncio
    t = asyncio.get_running_loop().create_task(_track(rv))
    _TRACK_TASKS.add(t)
    t.add_done_callback(_TRACK_TASKS.discard)


async def _track(rv: dict) -> None:
    """Le suivi d'activite d'une requete deja rendue (voir track_activity)."""
    path, response_status = rv["path"], rv["status"]
    hdr = rv["headers"]
    try:
        from datetime import datetime, timedelta
        from sqlalchemy import select, update
        from app.core.security import decode_token_payload
        from app.db.session import AsyncSessionLocal
        from app.models.user import User
        from app.models.activity import ActivityLog

        username = None
        auth = hdr.get("authorization") or ""
        bearer = auth.split(" ", 1)[1].strip() if auth.lower().startswith("bearer ") else ""
        if bearer.startswith("fk_"):
            # Visite d'un copain (cle d'invitation) : le compte auquel elle est
            # liee, pour son journal et sa derniere visite (retenu 10 min).
            import hashlib, time as _time
            hk = hashlib.sha256(bearer.encode()).hexdigest()
            hit = _FK_USER.get(hk)
            if hit and _time.monotonic() - hit[1] < 600:
                username = hit[0]
            else:
                from sqlalchemy import select as _sel
                from app.db.session import AsyncSessionLocal as _ASL
                from app.models.user import User as _U
                async with _ASL() as _db:
                    username = (await _db.execute(_sel(_U.username).where(
                        _U.friend_key_hash == hk))).scalar_one_or_none()
                _FK_USER[hk] = (username, _time.monotonic())
        elif bearer:
            payload = decode_token_payload(bearer)
            if payload:
                username = payload.get("sub")
        is_login = path.endswith("/auth/login") and response_status < 400
        if is_login and not username:
            # Au login le client n'a pas encore de jeton : on prend l'identifiant
            # transmis dans le formulaire.
            username = rv["query_username"] or rv["login_username"]
        if not username:
            return

        is_action = rv["method"] in ("POST", "PATCH", "PUT", "DELETE")
        now = datetime.utcnow()

        # Presence reelle : l'onglet est au premier plan ET l'utilisateur y a
        # touche recemment. Sans ce filtre, le sondage du statut imprimante
        # rafraichissait last_seen toutes les minutes sur une fenetre laissee
        # ouverte en arriere-plan -- "vu il y a 1 min" pour quelqu'un parti la
        # veille. Une ecriture vaut toujours interaction : ca evite que
        # last_seen se fige si un client n'envoie pas encore l'en-tete.
        present = is_action or hdr.get("x-app-active") == "1"

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

        ok = response_status < 400
        page   = _page_key(hdr.get("x-app-page")) if ok else None
        detail = _detail_key(hdr.get("x-app-detail")) if ok else None
        is_visit  = _changed(_LAST_PAGE, page)
        is_detail = _changed(_LAST_DETAIL, detail)
        # rien a ecrire (le cas de presque toutes les requetes) : pas meme une lecture en base
        seen_due = present and (now - _SEEN_AT.get(username, datetime.min)) > timedelta(minutes=1)
        if not (seen_due or (is_action and ok) or is_visit or is_detail):
            return
        async with AsyncSessionLocal() as db:
            u = (await db.execute(
                select(User).where(User.username == username)
            )).scalar_one_or_none()
            if u and present and (u.last_seen is None
                                  or (now - u.last_seen) > timedelta(minutes=1)):
                await db.execute(
                    update(User).where(User.id == u.id).values(last_seen=now))
                await db.commit()
            if u and present:
                _SEEN_AT[username] = now if (u.last_seen is None or (now - u.last_seen) > timedelta(minutes=1)) else u.last_seen
            if is_action and response_status < 400:
                db.add(ActivityLog(
                    username=username, method=rv["method"], path=path,
                    status=response_status, kind="action",
                    label=_activity_label(rv["method"], path), created_at=now))
                await db.commit()
            else:
                # Une requete peut porter les deux a la fois : arriver sur une
                # page en ouvrant directement une fiche. On journalise la page
                # d'abord, pour que l'ordre de lecture reste logique.
                if is_visit and bearer.startswith("fk_"):
                    from app.services import ach_log
                    ach_log.visit_in(now)          # un copain chez moi (succes)
                if is_visit:
                    db.add(ActivityLog(
                        username=username, method="VUE", path=page,
                        status=response_status, kind="visite",
                        label=_PAGE_LABELS[page], created_at=now))
                if is_detail:
                    db.add(ActivityLog(
                        username=username, method="DETAIL", path=page or "",
                        status=response_status, kind="detail",
                        label=detail, created_at=now))
                if is_visit or is_detail:
                    await db.commit()
    except Exception:
        pass   # le suivi ne doit jamais casser une requete


@app.middleware("http")
async def enforce_readonly(request, call_next):
    from starlette.responses import JSONResponse
    from app.core.security import decode_token_payload

    path = request.url.path
    if (path.startswith("/api/")
            and request.method not in ("GET", "HEAD", "OPTIONS")
            and path not in _READONLY_ALLOWED_PATHS):
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer ") and auth.split(" ", 1)[1].strip().startswith("fk_"):
            # Cle copain : lecture seule, toujours.
            return JSONResponse(status_code=403, content={"detail": "Accès copain : lecture seule"})
        # Actions MakerWorld : chaque route d'ecriture porte son propre controle
        # (droit « Actions MakerWorld » ou administrateur, verifie en base) ;
        # le blocage par role les refusait a un compte en lecture seule qui a
        # pourtant ce droit.
        if path.startswith("/api/v1/makerworld/"):
            return await call_next(request)
        # Easter eggs : tout compte de la maison peut en trouver (la route dit
        # s'il compte pour les succes ou non), jamais une cle copain (ci-dessus).
        if path.startswith("/api/v1/achievements/egg/") or path in ("/api/v1/achievements/passage", "/api/v1/achievements/surprise",
                                                                         "/api/v1/achievements/surprise/shown",
                                                                         "/api/v1/achievements/card-fx/seen",
                                                                         "/api/v1/achievements/grade-fx/seen",
                                                                         # la roue (la sienne pour la famille) et les loupes : chaque
                                                                         # route controle elle-meme qui peut (26/10/2026 : les comptes en
                                                                         # lecture seule de la famille etaient refuses sans rien voir)
                                                                         "/api/v1/achievements/wheel/spin", "/api/v1/achievements/wheel/settle") \
                or path.startswith("/api/v1/achievements/loupe/"):
            return await call_next(request)
        # Notifications de l'appli : chaque compte gere SES telephones et ses
        # choix (controle par route : son compte, jamais une cle copain).
        if path.startswith(("/api/v1/notify/me", "/api/v1/notify/devices", "/api/v1/home/")):
            return await call_next(request)
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
    try:   # l'adresse sous laquelle on m'a joint (une farce reservee a quelques maisons)
        from app.services.achievements import note_host
        note_host(request.headers.get("x-forwarded-host") or request.headers.get("host") or "")
    except Exception:
        pass
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


# Compression des reponses texte (JSON de l'API, pages, scripts) : la page des
# succes pese ~370 Ko de JSON, ~40 Ko compresse. Jamais les images, videos ou
# archives (deja compressees : ce serait du calcul pour rien).
from starlette.middleware.gzip import GZipMiddleware as _GZ, GZipResponder as _GZR
from starlette.datastructures import Headers as _H

_GZ_TYPES = ("application/json", "text/", "application/javascript", "image/svg+xml", "application/xml",
             "application/manifest+json")


class _TextGZipResponder(_GZR):
    async def send_with_gzip(self, message):
        if message["type"] == "http.response.start":
            ctype = _H(raw=message["headers"]).get("content-type", "")
            if not ctype.startswith(_GZ_TYPES):
                # comme une reponse deja encodee : passe telle quelle
                self.initial_message = message
                self.content_encoding_set = True
                return
        await super().send_with_gzip(message)


class TextGZip(_GZ):
    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and "gzip" in _H(scope=scope).get("Accept-Encoding", ""):
            await _TextGZipResponder(self.app, self.minimum_size, compresslevel=self.compresslevel)(scope, receive, send)
            return
        await self.app(scope, receive, send)


app.add_middleware(TextGZip, minimum_size=1024, compresslevel=5)

# Images de l'API : vignettes ?w= et cache du navigateur (304) ; pose apres le gzip,
# donc devant lui (les images n'y passent pas de toute facon).
from app.core.images import ImageCacheMiddleware
app.add_middleware(ImageCacheMiddleware)


# Les scripts et styles du build portent leur empreinte dans leur nom (index-AbC123.js) :
# un nom ne change jamais de contenu, ils se gardent un an. Sans en-tete, le navigateur
# revalidait chaque fichier a chaque ouverture.
class _ImmutableAssets:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/assets/"):
            await self.app(scope, receive, send)
            return

        async def _send(message):
            if message["type"] == "http.response.start" and message.get("status") == 200:
                message = {**message, "headers": [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"]
                           + [(b"cache-control", b"public, max-age=31536000, immutable")]}
            await send(message)
        await self.app(scope, receive, _send)


app.add_middleware(_ImmutableAssets)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# la vitesse du serveur, mesuree route par route (pose en dernier : au plus pres de la requete recue)
from app.core.perf import PerfMiddleware
app.add_middleware(PerfMiddleware)

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


@app.get("/api/v1/version/check", include_in_schema=False)
async def version_check(fresh: bool = False):
    """Version en service comparee a master sur GitHub : nouveautes en attente."""
    from app.services import version_check as _vc
    return await _vc.check(fresh)


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
                if candidate.suffix == ".apk":
                    # l'appli Android : un fichier a enregistrer (et a installer),
                    # jamais une page a afficher ; pas de cache (mise a jour)
                    return FileResponse(str(candidate), filename=candidate.name,
                                        media_type="application/vnd.android.package-archive",
                                        headers={"Cache-Control": "no-cache"})
                if full_path.startswith("doc/"):
                    # le guide change a chaque version : revalider plutot que garder un vieux chapitre
                    return FileResponse(str(candidate), headers={"Cache-Control": "no-cache"})
                return FileResponse(str(candidate))
            # un dossier statique qui a sa page (le guide : /doc/) : on la sert,
            # en ajoutant d'abord le / final pour que ses liens relatifs marchent
            if candidate and candidate.is_dir() and (candidate / "index.html").is_file():
                if not full_path.endswith("/"):
                    from fastapi.responses import RedirectResponse
                    return RedirectResponse(f"/{full_path}/", status_code=301)
                return FileResponse(str(candidate / "index.html"), headers={"Cache-Control": "no-cache"})

        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index), headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache", "Expires": "0",
            })
        return JSONResponse({"error": "Frontend not built"}, status_code=503)
