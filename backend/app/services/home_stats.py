"""Ce que fait la maison de son accueil et de sa camera, pour les succes
(22/10/2026) : dispositions enregistrees, tuiles affichees, retouches,
dispositions reglees, temps de camera en direct. Rien de retroactif.
Une ligne JSON en reglage, ecrite sous verrou."""
import asyncio
import json
from datetime import datetime

KEY = "ACHIEVEMENTS_HOME"
_LOCK = asyncio.Lock()


def _empty() -> dict:
    return {"saves": 0, "tiles": [], "tweaks": 0, "cam_s": 0.0, "first": None, "multi": None, "four": None,
            "three": None, "two": None, "minimal": None, "all": None, "copied": None}


async def get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        try:
            d = json.loads(await get_setting(db, KEY, "") or "{}")
        except ValueError:
            d = {}
    return {**_empty(), **(d if isinstance(d, dict) else {})}


async def _update(fn) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting, set_setting
    async with _LOCK:
        async with AsyncSessionLocal() as db:
            try:
                d = json.loads(await get_setting(db, KEY, "") or "{}")
            except ValueError:
                d = {}
            d = {**_empty(), **(d if isinstance(d, dict) else {})}
            fn(d)
            await set_setting(db, KEY, json.dumps(d))


def _items(lay: dict) -> dict:
    """{nombre de colonnes: {id: (largeur, hauteur, options)}}"""
    out = {}
    for n, cols in ((lay or {}).get("layouts") or {}).items():
        out[str(n)] = {x.get("id"): (x.get("w"), x.get("h"), json.dumps(x.get("o") or {}, sort_keys=True))
                       for c in (cols or []) for x in (c or []) if isinstance(x, dict) and x.get("id")}
    return out


def tweaks_between(old: dict | None, new: dict | None) -> int:
    """Largeurs, hauteurs et options changees d'une disposition a l'autre."""
    a, b = _items(old), _items(new)
    n = 0
    for k, items in b.items():
        before = a.get(k, {})
        for tid, (w, h, o) in items.items():
            if tid in before:
                w0, h0, o0 = before[tid]
                n += (w != w0) + (h != h0) + (o != o0)
    return n


async def layout_saved(old: dict | None, new: dict | None, known: list | None) -> None:
    now = datetime.utcnow().isoformat()
    b = _items(new)
    ids = {tid for items in b.values() for tid in items}
    known = {str(x) for x in (known or []) if x}

    def f(d):
        d["saves"] += 1
        d["first"] = d["first"] or now
        d["tiles"] = sorted(set(d["tiles"]) | ids)
        d["tweaks"] += tweaks_between(old, new)
        # ce qui depend de la disposition suit la disposition (23/10/2026) : la defaire
        # retire le succes (multi, minimal, all) ; le refaire le rend, sans nouvelle cle
        keep = lambda k, ok: (d[k] or now) if ok else None  # noqa: E731
        d["multi"] = keep("multi", {"1", "2", "3", "4"} <= set(b))
        d["minimal"] = keep("minimal", any(set(items) == {"printer"} for items in b.values()))
        d["all"] = keep("all", len(known) >= 10 and any(known <= set(items) for items in b.values()))
    await _update(f)


async def seen_four() -> None:
    await seen_cols(4)


async def seen_cols(n: int) -> None:
    """L'accueil vient d'etre affiche sur n colonnes (2, 3 ou 4) : la page le dit, le serveur ne le voit pas."""
    k = {2: "two", 3: "three", 4: "four"}.get(int(n))
    if not k:
        return
    now = datetime.utcnow().isoformat()

    def f(d):
        d[k] = d.get(k) or now
    await _update(f)


async def layout_copied() -> None:
    now = datetime.utcnow().isoformat()

    def f(d):
        d["copied"] = d.get("copied") or now
    await _update(f)


async def camera_watched(seconds: float) -> None:
    if seconds < 1:
        return

    def f(d):
        d["cam_s"] = round(float(d.get("cam_s") or 0) + seconds, 1)
    await _update(f)


async def values() -> dict:
    d = await get()
    return {"home_saves": int(d["saves"]), "home_tiles": len(d["tiles"]), "home_tweaks": int(d["tweaks"]),
            "cam_hours": int(float(d["cam_s"] or 0) // 3600), "home_first": 1 if d["first"] else 0,
            "home_multi": 1 if d["multi"] else 0, "home_four": 1 if d["four"] else 0,
            "home_three": 1 if d.get("three") else 0, "home_two": 1 if d.get("two") else 0, "home_copy": 1 if d.get("copied") else 0,
            "home_minimal": 1 if d["minimal"] else 0, "home_all": 1 if d["all"] else 0}
