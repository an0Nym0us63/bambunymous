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


# ── Le profil imprime d'un modele (27/10/2026) ──
# Le meme raisonnement que la ligne « Plateaux » de la carte d'une impression, ici cote serveur pour la fiche
# du modele et la vue 3D (qui prenaient le profil « retenu » pour mon imprimante, pas celui que j'ai imprime).
_STOP = {"plate", "plateau", "the", "and", "for", "with", "de", "du", "la", "le", "les", "et"}


def _words(t) -> set:
    import re
    import unicodedata
    s = unicodedata.normalize("NFD", str(t or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return {w for w in re.split(r"[^a-z0-9.]+", s) if len(w) > 1 and w not in _STOP}


def _manual(raw):
    import json
    try:
        m = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        return None
    return m if isinstance(m, dict) and isinstance(m.get("plates"), list) else None


_PROF_RX = None


def profile_in_3mf(path) -> str | None:
    """L'identifiant du profil MakerWorld ecrit dans un 3MF tranche (DesignProfileId), None s'il n'y est pas."""
    import re
    import zipfile
    global _PROF_RX
    if _PROF_RX is None:
        _PROF_RX = re.compile(r'<metadata name="DesignProfileId">\s*(\d+)\s*</metadata>')
    try:
        with zipfile.ZipFile(path) as z:
            head = z.read("3D/3dmodel.model")[:200_000].decode("utf-8", "replace")
    except Exception:
        return None
    m = _PROF_RX.search(head)
    return m.group(1) if m else None


async def profiles_from_files(rows) -> dict:
    """{print_id: profil} lu dans le 3MF tranche garde des impressions sans profil (28/10/2026), et pose sur elles
    (une fois : la prochaine fois, l'impression le sait). rows : (id, mw_profile_id, model_3mf)."""
    from sqlalchemy import update
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .archive import local_or_archive
    found = {}
    for pid, prof, m3 in rows:
        if (prof and str(prof) != "0") or not m3:
            continue
        f = local_or_archive(m3)
        p = await asyncio.to_thread(profile_in_3mf, f) if f else None
        if p:
            found[pid] = p
    if found:
        async with AsyncSessionLocal() as db:
            for pid, p in found.items():
                await db.execute(update(Print).where(Print.id == pid).values(mw_profile_id=p))
            await db.commit()
        logger.info(f"[MW] profil lu dans le 3MF tranche de {len(found)} impression(s) : {found}")
    return found


async def printed_profile(design_id: str) -> dict:
    """{"profile": profile_id | None, "sure": bool} : le profil donne par l'imprimante ou choisi a la main (le
    plus frequent) ; sinon deduit des impressions -- nom de la tache, image de l'apercu, numero et poids du
    plateau ; a egalite ou sans indice, le profil par defaut. None : modele jamais imprime."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .makerworld import _base
    did = str(design_id or "").strip()
    if not did.isdigit():
        return {"profile": None, "sure": False}
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.id, Print.status, Print.plate_id, Print.mw_profile_id, Print.mw_plates,
                                        Print.original_name, Print.task_name, Print.file_name, Print.total_weight_g,
                                        Print.model_3mf)
                                 .where(Print.design_id == did))).all()
    if not rows:
        return {"profile": None, "sure": False}
    # le profil ecrit dans le 3MF tranche (imprime depuis MakerWorld) : l'indice le plus sur, et il manquait
    try:
        from_files = await profiles_from_files([(r.id, r.mw_profile_id, r.model_3mf) for r in rows])
    except Exception:
        logger.exception("[MW] profil lu dans les 3MF")
        from_files = {}
    base = await _base(did, True)
    profs = [p for p in ((base.get("profiles") if isinstance(base, dict) else None) or []) if isinstance(p, dict)]
    avec = [p for p in profs if p.get("plates")]
    if not avec:
        return {"profile": None, "sure": False}
    by_inst = {str(p.get("instance_id")): str(p.get("profile_id")) for p in profs if p.get("instance_id")}
    known: dict = {}
    for r in rows:
        pp = str((_manual(r.mw_plates) or {}).get("profile") or r.mw_profile_id or from_files.get(r.id) or "")
        pp = by_inst.get(pp, pp)
        if pp and pp != "0":
            known[pp] = known.get(pp, 0) + 1
    if known:
        top = max(known.values())
        sure = next((p for p in avec if known.get(str(p.get("profile_id"))) == top), None)
        if sure:
            return {"profile": str(sure["profile_id"]), "sure": True}
    if len(avec) == 1:
        return {"profile": str(avec[0]["profile_id"]), "sure": False}
    ids = [r.id for r in rows if not _manual(r.mw_plates) and r.status not in ("FAILED", "CANCELLED")][:60]
    weights = {r.id: r.total_weight_g for r in rows if r.total_weight_g}
    try:
        img = await asyncio.to_thread(_guess, avec, ids, weights) if ids else {}
    except Exception:
        logger.exception("[MW] profil imprime : reconnaissance a l'image")
        img = {}

    mwords = _words(" ".join(str(base.get(k) or "") for k in ("title", "title_fr", "title_mw_fr")))

    def score(p) -> float:
        sc = 0.0
        # le titre du profil, traduit et d'origine, sans les mots du titre du MODELE (la tache reprend souvent ce
        # titre : « Art The Clown multipart no AMS » designait a tort le profil « Version Multipart sans ams »)
        pws = [w for w in (_words(p.get("title")) - mwords, _words(p.get("title_original")) - mwords) if len(w) >= 2]
        for r in rows:
            nw = _words(f"{r.original_name or ''} {r.task_name or ''} {r.file_name or ''}")
            ns = max((len(pw & nw) / len(pw) for pw in pws), default=0)
            if ns >= 0.5:
                sc += 12 * ns                      # indice fort : le nom de la tache cite ce profil
            g = img.get(str(r.id))
            if g and str(g["profile"]) == str(p.get("profile_id")):
                sc += 6 if g.get("sure") is False else 10
            try:
                i = int(r.plate_id or 0)
            except (TypeError, ValueError):
                i = 0
            pl = next((q for q in p["plates"] if q.get("index") == i), None) if i else None
            if i and not pl:
                sc -= 4                            # ce profil n'a pas ce plateau
            elif pl and pl.get("weight_g") and (r.total_weight_g or 0) > 0:
                sc += 3 * min(pl["weight_g"], r.total_weight_g) / max(pl["weight_g"], r.total_weight_g)
        return sc
    best_p, best_sc = None, None
    for p in avec:                                 # a egalite, l'ordre de la fiche
        sc = score(p)
        if best_sc is None or sc > best_sc:
            best_p, best_sc = p, sc
    if best_sc is None or best_sc <= 0:
        best_p = next((p for p in avec if p.get("default")), avec[0])
    return {"profile": str(best_p["profile_id"]), "sure": False}
