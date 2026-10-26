"""La vitesse du serveur, mesuree (26/10/2026) : pour chaque route de l'API, le delai entre l'arrivee de la
requete et le debut de la reponse (le premier octet : un flux, la camera ou un envoi, compte donc pour le
temps qu'il met a demarrer, pas pour sa duree). En memoire seulement, remis a zero au redemarrage.
Sert la carte « Vitesse du serveur » des parametres : on optimise ce qui est lent pour de vrai."""
import re
import time
from collections import deque

_STATS: dict = {}            # « GET /prints/{n} » -> {"n", "sum", "max", "recent": deque des derniers delais (ms)}
_SINCE = {"t": time.time()}
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
        s = _STATS[key] = {"n": 0, "sum": 0.0, "max": 0.0, "recent": deque(maxlen=200)}
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
                     "p50": round(_pct(rec, .5), 1), "p95": round(_pct(rec, .95), 1), "max": round(s["max"], 1)})
    rows.sort(key=lambda r: -r["p95"])
    total = sum(s["n"] for s in _STATS.values())
    return {"since": _SINCE["t"], "requests": total, "routes": rows[:limit]}


def reset() -> None:
    _STATS.clear()
    _SINCE["t"] = time.time()


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
