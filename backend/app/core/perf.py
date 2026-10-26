"""La vitesse du serveur, mesuree (26/10/2026) : pour chaque route de l'API, le delai entre l'arrivee de la
requete et le debut de la reponse (le premier octet : un flux, la camera ou un envoi, compte donc pour le
temps qu'il met a demarrer, pas pour sa duree). En memoire seulement, remis a zero au redemarrage.
Sert la carte « Vitesse du serveur » des parametres : on optimise ce qui est lent pour de vrai."""
import asyncio
import contextvars
import os
import re
import sys
import threading
import time
from collections import deque

_STATS: dict = {}            # « GET /prints/{n} » -> {"n", "sum", "max", "recent": deque des derniers delais (ms)}
_SINCE = {"t": time.time()}
# Le demarrage est mis a part (26/10/2026) : pendant WARMUP_S apres le lancement, les taches de demarrage (sauvegarde,
# MakerWorld, succes, photos) tournent et les caches sont vides. Tout appel tombe dans cette fenetre est compte a part,
# pas seulement le premier de chaque route : grade-fx repondait en 66 ms au premier appel, puis 15 s au suivant,
# arrive pendant le calcul des succes. Apres une remise a zero, plus de fenetre : tout compte.
WARMUP_S = 180
_COLD = {"on": True, "until": time.time() + WARMUP_S}


def warming() -> bool:
    if _COLD["on"] and time.time() >= _COLD["until"]:
        _COLD["on"] = False
    return _COLD["on"]
_ID = re.compile(r"/(\d+|[0-9a-f]{12,}|[0-9a-f-]{32,36})(?=/|$)", re.I)


def route_key(method: str, path: str) -> str:
    p = path[len("/api/v1"):] if path.startswith("/api/v1") else path
    p = re.sub(r"^/friends/[^/]+/p/", "/friends/{copain}/", p)
    p = _ID.sub("/{n}", p)
    p = re.sub(r"/(file|photo|snapshot|upload|thumb|video|img)/[^/]+", r"/\1/{f}", p)
    return f"{method} {p}"


# La part de la base (26/10/2026) : la boucle n'etant pas bloquee, une route lente attend quelque chose. Chaque
# requete SQL est chronometree (crochets poses dans db/session.py) et comptee pour la requete HTTP en cours :
# on voit si une route est lente par sa base, et par combien de requetes (une par ligne = a regrouper).
_REQ: contextvars.ContextVar = contextvars.ContextVar("perf_req", default=None)


def sql_done(ms: float, sql: str) -> None:
    r = _REQ.get()
    if r is None:
        return
    r["db"] += ms
    r["q"] += 1
    if ms > r["top"][0]:
        r["top"] = (ms, " ".join(str(sql).split())[:220])


def record(key: str, ms: float, req: dict = None) -> None:
    s = _STATS.get(key)
    if s is None:
        if len(_STATS) > 600:            # des adresses inattendues ne font pas grossir la memoire sans fin
            return
        s = _STATS[key] = {"n": 0, "sum": 0.0, "max": 0.0, "recent": deque(maxlen=200), "cold": None, "cold_n": 0,
                           "db": 0.0, "q": 0, "top": (0.0, "")}
    if warming():
        # pendant le demarrage : ni dans la mediane, ni dans le 95e centile, ni dans le pire
        s["cold_n"] += 1
        s["cold"] = max(s["cold"] or 0.0, ms)
        return
    s["n"] += 1
    s["sum"] += ms
    s["max"] = max(s["max"], ms)
    s["recent"].append(ms)
    if req is not None:
        s["db"] += req["db"]
        s["q"] += req["q"]
        if req["top"][0] > s["top"][0]:
            s["top"] = req["top"]


def _pct(vals, q):
    if not vals:
        return 0.0
    v = sorted(vals)
    return v[min(len(v) - 1, int(round(q * (len(v) - 1))))]


def snapshot(limit: int = 60) -> dict:
    rows = []
    for k, s in _STATS.items():
        rec = list(s["recent"])
        rows.append({"route": k, "count": s["n"], "avg": round(s["sum"] / s["n"], 1) if s["n"] else 0,
                     "p50": round(_pct(rec, .5), 1), "p95": round(_pct(rec, .95), 1), "max": round(s["max"], 1),
                     "cold": round(s["cold"], 1) if s.get("cold") is not None else None, "cold_n": s.get("cold_n", 0),
                     "db_avg": round(s["db"] / s["n"], 1) if s["n"] else 0, "q_avg": round(s["q"] / s["n"], 1) if s["n"] else 0,
                     "top_ms": round(s["top"][0], 1), "top_sql": s["top"][1]})
    rows.sort(key=lambda r: -r["p95"])
    total = sum(s["n"] for s in _STATS.values())
    return {"since": _SINCE["t"], "requests": total, "routes": rows[:limit], "loop": _loop_view(),
            "warmup_s": WARMUP_S, "warming": warming(), "warm_requests": sum(s.get("cold_n", 0) for s in _STATS.values())}


# ── Les blocages de la boucle (26/10/2026) ───────────────────────────────────────────────────────────────
# Tout le serveur tourne sur une seule boucle : un calcul ou une lecture de fichier sans « await » la fige, et
# TOUTES les requetes en cours attendent (d'ou des routes simples a 500 ms). Un battement de coeur bat toutes les
# 50 ms ; un fil de garde a cote, s'il ne le voit plus battre depuis STALL_MS, releve ou en est la boucle (la pile
# du fil principal, cote code de l'appli) : on sait QUELLE ligne bloque, et combien de temps au total.
STALL_MS = 150
_LOOP = {"beat": 0.0, "ident": None, "lags": deque(maxlen=600)}
_STALLS: dict = {}               # « fichier:ligne fonction » -> {"n", "total", "max", "stack", "last"}
_STALLS_BOOT: dict = {}          # les memes, pendant le demarrage (gardes a part : utile de savoir ce qu'il coute)
_APP_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _where(frame) -> tuple:
    """La pile du fil bloque, ramenee au code de l'appli : (cle, 4 dernieres lignes de l'appli)."""
    mine = []
    f = frame
    while f is not None:
        fn = f.f_code.co_filename
        if fn.startswith(_APP_DIR) and "site-packages" not in fn:
            mine.append(f"{os.path.relpath(fn, _APP_DIR).replace(os.sep, '/')}:{f.f_lineno} {f.f_code.co_name}")
        f = f.f_back
    if not mine:                 # rien de l'appli : la bibliotheque la plus profonde
        fn = frame.f_code.co_filename
        mine = [f"{os.path.basename(fn)}:{frame.f_lineno} {frame.f_code.co_name}"]
    return mine[0], mine[:4]


def _guard() -> None:
    caught = None                # le blocage en cours : (cle, debut)
    while True:
        time.sleep(0.05)
        beat = _LOOP["beat"]
        if not beat:
            continue
        late = (time.perf_counter() - beat) * 1000
        if late >= STALL_MS and caught is None and _LOOP["ident"] is not None:
            fr = sys._current_frames().get(_LOOP["ident"])
            if fr is not None:
                try:
                    caught = (_where(fr), beat)
                except Exception:
                    caught = None
        elif caught is not None and _LOOP["beat"] != caught[1]:
            (key, stack), start = caught
            ms = (_LOOP["beat"] - start) * 1000 - 50
            book = _STALLS_BOOT if warming() else _STALLS
            s = book.get(key)
            if s is None and len(book) < 200:
                s = book[key] = {"n": 0, "total": 0.0, "max": 0.0, "stack": stack, "last": 0.0}
            if s is not None:
                s["n"] += 1
                s["total"] += ms
                s["max"] = max(s["max"], ms)
                s["last"] = time.time()
            caught = None


async def loop_watch() -> None:
    """Le battement de coeur de la boucle (a lancer une fois au demarrage)."""
    _LOOP["ident"] = threading.get_ident()
    threading.Thread(target=_guard, name="perf-guard", daemon=True).start()
    while True:
        t = time.perf_counter()
        _LOOP["beat"] = t
        await asyncio.sleep(0.05)
        if not warming():
            _LOOP["lags"].append((time.perf_counter() - t) * 1000 - 50)


def _loop_view() -> dict:
    lags = list(_LOOP["lags"])
    def view(book):
        return sorted(({"where": k, "count": s["n"], "total": round(s["total"]), "max": round(s["max"]),
                        "stack": s["stack"], "last": s["last"]} for k, s in book.items()), key=lambda r: -r["total"])
    stalls = view(_STALLS)
    return {"lag_p50": round(_pct(lags, .5), 1), "lag_p95": round(_pct(lags, .95), 1),
            "lag_max": round(max(lags), 1) if lags else 0, "stall_ms": STALL_MS, "stalls": stalls[:15],
            "boot_stalls": view(_STALLS_BOOT)[:10]}


def reset() -> None:
    _STALLS.clear()
    _STALLS_BOOT.clear()
    _LOOP["lags"].clear()
    _STATS.clear()
    _SINCE["t"] = time.time()
    _COLD["on"] = False              # apres une remise a zero, tout compte (les caches sont deja chauds)


class PerfMiddleware:
    """Mesure pure ASGI (pas de BaseHTTPMiddleware : rien n'est mis en tampon)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            return await self.app(scope, receive, send)
        t0 = time.perf_counter()
        done = {"v": False}
        req = {"db": 0.0, "q": 0, "top": (0.0, "")}
        _REQ.set(req)
        bench = scope.get("perf_bench")          # un appel du banc d'essai : mesure rendue, pas comptee

        async def _send(message):
            if not done["v"] and message["type"] == "http.response.start":
                done["v"] = True
                try:
                    ms = (time.perf_counter() - t0) * 1000
                    if bench is not None:
                        bench.update(ms=ms, db=req["db"], q=req["q"], top=req["top"], status=message.get("status"))
                    else:
                        record(route_key(scope.get("method", "GET"), scope["path"]), ms, req)
                except Exception:
                    pass
            await send(message)
        await self.app(scope, receive, _send)


# ── Le banc d'essai (26/10/2026) ─────────────────────────────────────────────────────────────────────────
# Rejoue les routes lentes UNE PAR UNE, chacune trois fois, dans le serveur lui-meme : leur cout propre, sans
# l'embouteillage d'une page qui en lance quinze a la fois. Lente seule : la route est a reprendre ; rapide seule
# mais lente en vrai : c'est la foule (a etaler, ou a mettre en cache).
BENCH_SKIP = re.compile(r"/(makerworld|friends|camera|share|version|printer/sd|stream|settings/(storage|archive|perf))|\{")


async def _asgi_get(app, path: str, headers: list) -> dict:
    p, _, qs = path.partition("?")
    box: dict = {}
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET", "scheme": "http",
             "path": p, "raw_path": p.encode(), "query_string": qs.encode(), "root_path": "", "headers": headers,
             "client": ("127.0.0.1", 0), "server": ("bench", 80), "perf_bench": box}

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(_m):
        return None
    t0 = time.perf_counter()
    await app(scope, receive, send)
    box["full"] = (time.perf_counter() - t0) * 1000
    return box


async def bench(app, headers: list, limit: int = 15) -> dict:
    """Les routes GET mesurees les plus lentes (sans parametre de chemin ni service exterieur), une a une."""
    rows = [r for r in snapshot(600)["routes"] if r["route"].startswith("GET ") and r["count"] > 0
            and not BENCH_SKIP.search(r["route"][4:])]
    rows.sort(key=lambda r: -r["p95"])
    out = []
    for r in rows[:limit]:
        path = "/api/v1" + r["route"][4:]
        runs = []
        for _ in range(3):
            try:
                runs.append(await _asgi_get(app, path, headers))
            except Exception as e:
                runs.append({"error": f"{type(e).__name__}: {e}"})
        ok = [x for x in runs if "ms" in x]
        best = min(ok, key=lambda x: x["ms"]) if ok else None
        out.append({"route": r["route"], "live_p50": r["p50"], "live_p95": r["p95"],
                    "alone": round(best["ms"], 1) if best else None, "alone_db": round(best["db"], 1) if best else None,
                    "q": best["q"] if best else None, "status": best.get("status") if best else None,
                    "top_ms": round(best["top"][0], 1) if best else None, "top_sql": best["top"][1] if best else None,
                    "error": None if ok else runs[-1].get("error")})
    return {"at": time.time(), "routes": out}


# ── L'etat de la base (26/10/2026) ───────────────────────────────────────────────────────────────────────
def _db_file() -> str:
    from .config import settings
    url = str(settings.DATABASE_URL)
    return url.split(":///", 1)[1] if ":///" in url else ""


async def db_facts(db) -> dict:
    from sqlalchemy import text
    q = lambda sql: db.execute(text(sql))
    f = _db_file()
    size = lambda p: os.path.getsize(p) if p and os.path.exists(p) else 0
    page_size = (await q("PRAGMA page_size")).scalar() or 0
    tables = [r[0] for r in (await q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).all()]
    counts = []
    for t in tables:
        try:
            counts.append({"table": t, "rows": (await q(f'SELECT COUNT(*) FROM "{t}"')).scalar()})
        except Exception:
            pass
    counts.sort(key=lambda x: -(x["rows"] or 0))
    stat = (await q("SELECT COUNT(*) FROM sqlite_master WHERE name='sqlite_stat1'")).scalar()
    return {"journal": (await q("PRAGMA journal_mode")).scalar(), "page_size": page_size,
            "pages": (await q("PRAGMA page_count")).scalar(), "free_pages": (await q("PRAGMA freelist_count")).scalar(),
            "db_bytes": size(f), "wal_bytes": size(f + "-wal"), "analyzed": bool(stat),
            "indexes": (await q("SELECT COUNT(*) FROM sqlite_master WHERE type='index'")).scalar(),
            "tables": counts[:12]}


async def db_optimize() -> dict:
    """Vide le journal dans la base, recalcule les statistiques du planificateur, et compacte si beaucoup de
    pages sont libres. Sur une connexion a part (le VACUUM refuse de tourner dans une transaction)."""
    from sqlalchemy import text
    from ..db.session import engine
    t0 = time.perf_counter()
    steps = []
    async with engine.connect() as c:
        c = await c.execution_options(isolation_level="AUTOCOMMIT")
        r = (await c.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))).first()
        steps.append(f"journal vidé ({r[2] if r else '?'} pages)")
        await c.execute(text("ANALYZE"))
        steps.append("statistiques recalculées")
        await c.execute(text("PRAGMA optimize"))
        pages = (await c.execute(text("PRAGMA page_count"))).scalar() or 0
        free = (await c.execute(text("PRAGMA freelist_count"))).scalar() or 0
        if pages and free / pages > 0.1:
            await c.execute(text("VACUUM"))
            steps.append(f"base compactée ({free} pages libres sur {pages})")
    return {"ms": round((time.perf_counter() - t0) * 1000), "steps": steps}


async def db_upkeep() -> None:
    """L'entretien de la base, en tache de fond : les statistiques du planificateur au demarrage si elles
    manquent (sans elles, SQLite choisit ses index a l'aveugle), puis « PRAGMA optimize » toutes les heures."""
    import logging
    from sqlalchemy import text
    from ..db.session import engine
    log = logging.getLogger(__name__)
    await asyncio.sleep(90)                  # apres le demarrage (ses taches lisent beaucoup)
    while True:
        try:
            async with engine.connect() as c:
                c = await c.execution_options(isolation_level="AUTOCOMMIT")
                has = (await c.execute(text("SELECT COUNT(*) FROM sqlite_master WHERE name='sqlite_stat1'"))).scalar()
                if not has:
                    await c.execute(text("ANALYZE"))
                    log.info("[DB] statistiques du planificateur calculees")
                await c.execute(text("PRAGMA optimize"))
        except Exception:
            log.exception("[DB] entretien non fait")
        await asyncio.sleep(3600)
