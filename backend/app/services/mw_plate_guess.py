"""
Reconnaître le plateau MakerWorld d'un print par son image.

L'aperçu d'un print (plate.png, rendu par Bambu Studio) et les vignettes des
plateaux sur MakerWorld (même rendu, côté créateur) montrent la même pièce
sous le même angle. On compare leurs SILHOUETTES : découpées au cadre de la
pièce puis ramenées à la même taille, une pièce redimensionnée ou d'une autre
couleur se reconnaît. Entre des formes proches, le poids départage. Une simple
proposition : affichée « probable », jamais comptée tant qu'on ne l'a pas
validée.
"""
import asyncio
import hashlib
import logging
import os
from io import BytesIO
from pathlib import Path

logger = logging.getLogger(__name__)

SIDE = 40                 # silhouette ramenee a SIDE x SIDE
MIN_SCORE = 0.62          # ressemblance minimale (recouvrement des silhouettes)
MIN_GAP = 0.08            # en deca, deux plateaux sont « proches » : le poids departage
_MASKS = {}               # adresse de vignette -> silhouette (memoire)


def _data() -> Path:
    return Path(os.getenv("DATA_DIR", "/data"))


def silhouette(raw: bytes):
    """Silhouette de la piece : pixels qui se distinguent du fond (transparence,
    sinon couleur des coins), recadree puis centree sur un carre SIDE x SIDE."""
    from PIL import Image
    im = Image.open(BytesIO(raw)).convert("RGBA")
    im.thumbnail((160, 160))
    w, h = im.size
    px = im.load()
    transparent = any(px[x, y][3] < 30 for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)))
    corners = [px[x, y] for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if transparent:
                on = a > 60
            else:
                on = a > 60 and abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 60
            if on:
                mp[x, y] = 255
    box = mask.getbbox()
    if not box:
        return None
    crop = mask.crop(box)
    cw, ch = crop.size
    side = max(cw, ch)
    sq = Image.new("L", (side, side), 0)
    sq.paste(crop, ((side - cw) // 2, (side - ch) // 2))
    sq = sq.resize((SIDE, SIDE))
    return [v > 100 for v in sq.getdata()]


def similarity(a, b) -> float:
    """Recouvrement de deux silhouettes (intersection / union)."""
    if not a or not b:
        return 0.0
    inter = sum(1 for x, y in zip(a, b) if x and y)
    union = sum(1 for x, y in zip(a, b) if x or y)
    return inter / union if union else 0.0


def best(sil, plates, weight=None):
    """plates : [(cle, silhouette, poids g|None)] -> (cle, score, sur) ou None.

    Le plateau le plus ressemblant, des que la ressemblance suffit. Entre des
    formes proches (plusieurs cubes...), la silhouette ne voit pas la taille :
    on departage au poids, celui du print face a celui du plateau. « sur » dit
    si le plateau se detachait nettement des autres."""
    scored = sorted(((similarity(sil, p[1]), p[0], p[2] if len(p) > 2 else None) for p in plates if p[1]),
                    key=lambda x: -x[0])
    if not scored or scored[0][0] < MIN_SCORE:
        return None
    close = [x for x in scored if scored[0][0] - x[0] < MIN_GAP]
    if len(close) > 1 and weight:
        weighed = [x for x in close if x[2]]
        if weighed:
            pick = min(weighed, key=lambda x: abs(x[2] - weight) / max(x[2], weight))
            return pick[1], round(pick[0], 2), False
    return scored[0][1], round(scored[0][0], 2), len(close) == 1


def _thumb_mask(url: str):
    if url in _MASKS:
        return _MASKS[url]
    cache = _data() / "mw_cache" / "plates"
    f = cache / (hashlib.sha1(url.encode()).hexdigest() + ".img")
    raw = f.read_bytes() if f.is_file() else None
    if raw is None:
        from .makerworld import session
        try:
            r = session().get(url, timeout=20)
            if r.status_code != 200:
                return None
            raw = r.content
            cache.mkdir(parents=True, exist_ok=True)
            f.write_bytes(raw)
        except Exception:
            return None
    try:
        m = silhouette(raw)
    except Exception:
        m = None
    _MASKS[url] = m
    return m


def _print_mask(pid: int):
    d = _data() / "prints" / str(pid)
    for n in ("plate.png", "plate.jpg"):
        f = d / n
        if f.is_file():
            key = (str(f), f.stat().st_mtime)
            if key not in _MASKS:
                try:
                    _MASKS[key] = silhouette(f.read_bytes())
                except Exception:
                    _MASKS[key] = None
            return _MASKS[key]
    return None


def _guess(profiles: list, print_ids: list, weights: dict) -> dict:
    plates = [((str(p.get("profile_id")), pl["index"]), _thumb_mask(pl["thumb"]), pl.get("weight_g"))
              for p in profiles for pl in (p.get("plates") or []) if pl.get("thumb")]
    out = {}
    for pid in print_ids:
        hit = best(_print_mask(pid), plates, weights.get(pid))
        if hit:
            (prof, idx), score, sure = hit
            out[str(pid)] = {"profile": prof, "plate": idx, "score": score, "sure": sure}
    return out


async def guess(design_id: str, print_ids: list) -> dict:
    """Plateau le plus probable de chaque print du modele."""
    from .makerworld import _base
    did = str(design_id or "").strip()
    ids = [int(x) for x in print_ids if str(x).isdigit()][:60]
    if not did.isdigit() or not ids:
        return {"guesses": {}}
    base = await _base(did, True)
    profiles = [p for p in (base.get("profiles") or []) if p.get("plates")]
    if not profiles:
        return {"guesses": {}}
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    async with AsyncSessionLocal() as db:
        weights = {i: w for i, w in (await db.execute(
            select(Print.id, Print.total_weight_g).where(Print.id.in_(ids)))).all() if w}
    return {"guesses": await asyncio.to_thread(_guess, profiles, ids, weights)}
