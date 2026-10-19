"""
Reconnaître le plateau MakerWorld d'un print par son image.

L'aperçu d'un print (plate.png, rendu par Bambu Studio) et les vignettes des
plateaux sur MakerWorld (même rendu, côté créateur) montrent la même pièce
sous le même angle. On compare leurs SILHOUETTES : découpées au cadre de la
pièce puis ramenées à la même taille, une pièce redimensionnée ou d'une autre
couleur se reconnaît. Une simple proposition : affichée « probable », jamais
comptée tant qu'on ne l'a pas validée, et seulement quand l'écart avec le
second plateau est net (deux carrés se ressemblent trop pour trancher).
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
MIN_GAP = 0.08            # avance minimale sur le 2e plateau le plus proche
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


def best(sil, plates):
    """plates : [(cle, silhouette)] -> (cle, score) si un plateau se detache, sinon None."""
    scored = sorted(((similarity(sil, s), k) for k, s in plates if s), reverse=True)
    if not scored or scored[0][0] < MIN_SCORE:
        return None
    if len(scored) > 1 and scored[0][0] - scored[1][0] < MIN_GAP:
        return None
    return scored[0][1], round(scored[0][0], 2)


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


def _guess(profiles: list, print_ids: list) -> dict:
    plates = [((str(p.get("profile_id")), pl["index"]), _thumb_mask(pl["thumb"]))
              for p in profiles for pl in (p.get("plates") or []) if pl.get("thumb")]
    out = {}
    for pid in print_ids:
        hit = best(_print_mask(pid), plates)
        if hit:
            (prof, idx), score = hit
            out[str(pid)] = {"profile": prof, "plate": idx, "score": score}
    return out


async def guess(design_id: str, print_ids: list) -> dict:
    """Plateau probable de chaque print du modele (seulement quand il se detache)."""
    from .makerworld import _base
    did = str(design_id or "").strip()
    ids = [int(x) for x in print_ids if str(x).isdigit()][:60]
    if not did.isdigit() or not ids:
        return {"guesses": {}}
    base = await _base(did, True)
    profiles = [p for p in (base.get("profiles") or []) if p.get("plates")]
    if not profiles:
        return {"guesses": {}}
    return {"guesses": await asyncio.to_thread(_guess, profiles, ids)}
