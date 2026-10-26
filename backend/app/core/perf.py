"""La vitesse du serveur, mesuree (26/10/2026) : pour chaque route de l'API, le delai entre l'arrivee de la
requete et le debut de la reponse (le premier octet : un flux, la camera ou un envoi, compte donc pour le
temps qu'il met a demarrer, pas pour sa duree). En memoire seulement, remis a zero au redemarrage.
Sert la carte « Vitesse du serveur » des parametres : on optimise ce qui est lent pour de vrai."""
import asyncio
import os
import re
import sys
import threading
import time
from collections import deque

_STATS: dict = {}            # « GET /prints/{n} » -> {"n", "sum", "max", "recent": deque des derniers delais (ms)}
_SINCE = {"t": time.time()}
_COLD = {"on": True}             # au demarrage : le premier appel de chaque route est mis a part (pas apres une remise a zero)
_ID = re.compile(r"/(\d+|[0-9a-f]{12,}|[0-9a-f-]{32,36})(?=/|$)", re.I)


def route_key(method: str, path: str) -> str:
    p = path[len("/api/v1"):] if path.startswith("/api/v1") else path
    p = re.sub(r"^/friends/[^/]+/p/", "/friends/{copain}/", p)
    p = _ID.sub("/{n}", p)
    p = re.sub(r"/(file|photo|snapshot|upload|thumb|video|img)/[^/]+", r"/\1/{f}", p)
    return f"{method} {p}"


def record(key: str, ms: float) -> None:
    s = _STATS.get(key)
    if s is None:
        if len(_STATS) > 600:            # des adresses inattendues ne font pas grossir la memoire sans fin
            return
        # le premier appel d'une route apres un redemarrage (caches vides, calculs a froid) est garde a part :
        # il ne compte ni dans la mediane, ni dans le 95e centile, ni dans le pire (26/10/2026)
        _STATS[key] = {"n": 0, "sum": 0.0, "max": 0.0, "recent": deque(maxlen=200), "cold": ms if _COLD["on"] else None}
        if _COLD["on"]:
            return
        s = _STATS[key]
    s["n"] += 1
    s["sum"] += ms
    s["max"] = max(s["max"], ms)
    s["recent"].append(ms)


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
                     "cold": round(s["cold"], 1) if s.get("cold") is not None else None})
    rows.sort(key=lambda r: -r["p95"])
    total = sum(s["n"] for s in _STATS.values())
    return {"since": _SINCE["t"], "requests": total, "routes": rows[:limit], "loop": _loop_view()}


# ── Les blocages de la boucle (26/10/2026) ───────────────────────────────────────────────────────────────
# Tout le serveur tourne sur une seule boucle : un calcul ou une lecture de fichier sans « await » la fige, et
# TOUTES les requetes en cours attendent (d'ou des routes simples a 500 ms). Un battement de coeur bat toutes les
# 50 ms ; un fil de garde a cote, s'il ne le voit plus battre depuis STALL_MS, releve ou en est la boucle (la pile
# du fil principal, cote code de l'appli) : on sait QUELLE ligne bloque, et combien de temps au total.
STALL_MS = 150
_LOOP = {"beat": 0.0, "ident": None, "lags": deque(maxlen=600)}
_STALLS: dict = {}               # « fichier:ligne fonction » -> {"n", "total", "max", "stack", "last"}
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
            s = _STALLS.get(key)
            if s is None and len(_STALLS) < 200:
                s = _STALLS[key] = {"n": 0, "total": 0.0, "max": 0.0, "stack": stack, "last": 0.0}
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
        _LOOP["lags"].append((time.perf_counter() - t) * 1000 - 50)


def _loop_view() -> dict:
    lags = list(_LOOP["lags"])
    stalls = sorted(({"where": k, "count": s["n"], "total": round(s["total"]), "max": round(s["max"]),
                      "stack": s["stack"], "last": s["last"]} for k, s in _STALLS.items()), key=lambda r: -r["total"])
    return {"lag_p50": round(_pct(lags, .5), 1), "lag_p95": round(_pct(lags, .95), 1),
            "lag_max": round(max(lags), 1) if lags else 0, "stall_ms": STALL_MS, "stalls": stalls[:15]}


def reset() -> None:
    _STALLS.clear()
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

        async def _send(message):
            if not done["v"] and message["type"] == "http.response.start":
                done["v"] = True
                try:
                    record(route_key(scope.get("method", "GET"), scope["path"]), (time.perf_counter() - t0) * 1000)
                except Exception:
                    pass
            await send(message)
        await self.app(scope, receive, _send)
