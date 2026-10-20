"""
Version de BambuNymous : le commit dont l'image est construite (COMMIT_SHA,
pose par la CI) compare a la branche master du depot public sur GitHub.
Lecture seule, sans jeton (API publique, quelques appels par jour).
"""
import asyncio
import logging
import os
import time

logger = logging.getLogger(__name__)

REPO = os.getenv("BAMBUNYMOUS_REPO", "an0Nym0us63/bambunymous")
BRANCH = "master"
_CACHE = {"t": 0.0, "v": None}
TTL = 3600


def _compare(local: str) -> dict:
    from .makerworld import session
    r = session().get(f"https://api.github.com/repos/{REPO}/compare/{local}...{BRANCH}",
                      headers={"Accept": "application/vnd.github+json", "User-Agent": "BambuNymous"}, timeout=15)
    if r.status_code == 404:
        return {"error": "Version locale inconnue de GitHub"}
    r.raise_for_status()
    d = r.json()
    commits = d.get("commits") or []
    last = commits[-1] if commits else None
    return {
        "status": d.get("status"),                    # identical | ahead (master devant) | behind | diverged
        "behind": int(d.get("ahead_by") or 0),        # nouveautes sur master que nous n'avons pas
        "latest": ((last or {}).get("sha") or local)[:8],
        "latest_date": ((last or {}).get("commit") or {}).get("committer", {}).get("date"),
        # du plus recent au plus ancien, premiere ligne du message
        "commits": [((c.get("commit") or {}).get("message") or "").splitlines()[0][:120] for c in reversed(commits)][:30],
    }


async def check(fresh: bool = False) -> dict:
    local = os.getenv("COMMIT_SHA", "dev")
    base = {"local": local[:8], "build_date": os.getenv("BUILD_DATE", "?"), "repo": REPO}
    if local in ("", "dev"):
        return {**base, "dev": True}
    if not fresh and _CACHE["v"] and time.time() - _CACHE["t"] < TTL:
        return _CACHE["v"]
    try:
        v = {**base, **(await asyncio.to_thread(_compare, local)), "checked": int(time.time())}
    except Exception as e:
        logger.info(f"[VERSION] GitHub injoignable : {e}")
        v = {**base, "error": "GitHub injoignable"}
    _CACHE.update(t=time.time(), v=v)
    return v
