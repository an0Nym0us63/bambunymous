"""
Filaments d'un profil MakerWorld face au stock : pour chaque filament du
profil (matiere, couleur hexa, grammes), les filaments en stock de la meme
matiere dont la couleur s'en approche le plus.

Ecart de couleur : CIEDE2000 (l'ecart percu par l'oeil, pas la distance
entre codes hexa). Reperes : < 2,5 identique, < 6 tres proche, < 12 proche,
< 20 approchant ; au-dela, la couleur est franchement differente.
Seuls comptent les filaments ayant une bobine active non vide.
"""
import math
import re

LEVELS = [(2.5, "identique"), (6, "très proche"), (12, "proche"), (20, "approchant")]


def _rgb(h):
    h = str(h or "").strip().lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}([0-9a-fA-F]{2})?", h):
        return None
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _lab(rgb):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = r * 0.2126 + g * 0.7152 + b * 0.0722
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def delta_e(h1, h2):
    """CIEDE2000 entre deux couleurs hexa (None si l'une est illisible)."""
    a, b = _rgb(h1), _rgb(h2)
    if not a or not b:
        return None
    L1, a1, b1 = _lab(a)
    L2, a2, b2 = _lab(b)
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dL, dC = L2 - L1, C2p - C1p
    dh = 0 if C1p * C2p == 0 else (h2p - h1p if abs(h2p - h1p) <= 180 else
                                   h2p - h1p - 360 if h2p > h1p else h2p - h1p + 360)
    dH = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh / 2))
    Lm, Cmp = (L1 + L2) / 2, (C1p + C2p) / 2
    if C1p * C2p == 0:
        hm = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hm = (h1p + h2p) / 2
    else:
        hm = (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2
    T = (1 - 0.17 * math.cos(math.radians(hm - 30)) + 0.24 * math.cos(math.radians(2 * hm))
         + 0.32 * math.cos(math.radians(3 * hm + 6)) - 0.20 * math.cos(math.radians(4 * hm - 63)))
    dT = 30 * math.exp(-(((hm - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lm - 50) ** 2 / math.sqrt(20 + (Lm - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cmp, 1 + 0.015 * Cmp * T
    Rt = -math.sin(math.radians(2 * dT)) * Rc
    return math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh))


def level(de):
    for lim, name in LEVELS:
        if de < lim:
            return name
    return "différent"


def _norm(t):
    return re.sub(r"[\s_]+", " ", str(t or "").upper()).strip()


def material_fit(mw_type, fil):
    """2 = meme matiere, 1 = meme famille (PLA-CF pour PLA…), 0 = autre."""
    t = re.sub(r"-AMS$", "", _norm(mw_type))          # TPU-AMS : du TPU pour l'AMS
    if not t:
        return 0
    names = {_norm(fil.material), _norm(fil.fila_type)} - {""}
    # Un support ne se remplace que par un support, et inversement.
    if is_support(t) != any(is_support(n) for n in names):
        return 0
    if t in names:
        return 2
    fam = re.split(r"[ \-+]", t)[0]
    fams = {re.split(r"[ \-+]", n)[0] for n in names}
    return 1 if fam and fam in fams else 0


def is_support(t: str) -> bool:
    t = _norm(t)
    return t.endswith("-S") or "SUPPORT" in t or t in ("PVA", "BVOH", "HIPS")


async def stock_rows():
    """Filaments ayant au moins une bobine active non vide, avec le restant."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament, Spool
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Spool, Filament).join(Filament, Filament.id == Spool.filament_id)
                                 .where(Spool.archived.is_(False)))).all()
    out = {}
    for s, f in rows:
        rem = s.remaining_weight_g if s.remaining_weight_g is not None else (f.filament_weight_g or 0)
        if rem <= 0:
            continue
        e = out.setdefault(f.id, {"f": f, "remaining_g": 0.0, "spools": 0, "where": [], "spool_g": []})
        e["remaining_g"] += rem
        e["spool_g"].append((round(rem), s.location if s.location and s.location != "Tiroir" else None))
        e["spools"] += 1
        if s.location and s.location != "Tiroir":
            e["where"].append(s.location)
    return list(out.values())


BAMBU_BONUS = 3     # a ecart proche, une Bambu passe devant (meme profil de
                    # tranchage, RFID) : 3 points de ΔE, la marge « tres proche »


def is_bambu(f):
    return "bambu" in (f.manufacturer or "").lower()


def _same_finish(sub: str, f) -> bool:
    s = _norm(sub)
    return bool(s) and s in {_norm(f.fila_type), _norm(f.name), _norm(f.name_en)}


def best_matches(mw_type, color, grams, stock, n=6, exact=None, other=False):
    """exact : l'emplacement lu dans le 3MF du profil (reference, finition,
    marque). Meme reference Bambu (GFA01…) = -10 ; meme finition = -6 (plus que
    le seul bonus Bambu : un Silk demande passe devant un Basic Bambu).
    other : au contraire, les filaments d'une AUTRE matiere, par couleur seule
    (pour simuler une substitution : PLA Silk a la place d'un ABS…)."""
    ref = (exact or {}).get("id") or ""
    sub = (exact or {}).get("subtype") or ""
    vendor = ((exact or {}).get("vendor") or "").lower()
    bambu_ok = not vendor or "bambu" in vendor
    cands = []
    for e in stock:
        f = e["f"]
        fit = material_fit(mw_type, f)
        if other:
            if fit:
                continue
        elif not fit:
            continue
        colors = [f.color] + ([c for c in (f.colors_array or "").split(",") if c.strip()]
                              if (f.multicolor_type or "monochrome") != "monochrome" else [])
        des = [d for d in (delta_e(color, c) for c in colors) if d is not None]
        if not des:
            continue
        multi = (f.multicolor_type or "monochrome") != "monochrome"
        de = min(des)
        same_ref = bool(ref) and (f.profile_id or "").upper() == ref.upper()
        same_fin = same_ref or _same_finish(sub, f)
        score = (de + (0 if fit == 2 else 4) + (6 if multi else 0) - (BAMBU_BONUS if bambu_ok and is_bambu(f) else 0)
                 - (10 if same_ref else 6 if same_fin else 0))
        cands.append((score, de, fit, multi, e, same_ref, same_fin))
    cands.sort(key=lambda x: x[0])
    return [_cand(e, de, fit, multi, grams, same_ref, same_fin if sub else None)
            for score, de, fit, multi, e, same_ref, same_fin in cands[:n]]


def _cand(e, de, fit, multi, grams, same_ref=False, same_finish=None):
    """Une proposition, au format commun (fiche, liste « À imprimer », recherche)."""
    f = e["f"]
    return {"filament_id": f.id, "name": f.translated_name or f.name, "brand": f.manufacturer,
            "material": f.fila_type or f.material, "color": f.color, "colors_array": f.colors_array,
            "multicolor_type": f.multicolor_type, "delta_e": round(de, 1), "level": level(de),
            "same_material": fit == 2, "other_material": fit == 0, "multicolor": multi, "bambu": is_bambu(f),
            "same_ref": same_ref, "same_finish": same_finish,
            "remaining_g": round(e["remaining_g"]), "spools": e["spools"], "where": e["where"][:3],
            # Ordre d'usage probable : la bobine chargee dans l'AMS, puis la
            # plus entamee (on finit une bobine avant d'en ouvrir une autre).
            "spool_g": [g for g, _ in sorted(e["spool_g"], key=lambda x: (x[1] is None, x[0]))],
            "spool_where": [w for _, w in sorted(e["spool_g"], key=lambda x: (x[1] is None, x[0]))],
            "enough": grams is None or e["remaining_g"] >= grams}


def _colors_de(f, color):
    colors = [f.color] + ([c for c in (f.colors_array or "").split(",") if c.strip()]
                          if (f.multicolor_type or "monochrome") != "monochrome" else [])
    des = [d for d in (delta_e(color, c) for c in colors) if d is not None]
    return min(des) if des else 99.0


def _fold(t):
    import unicodedata
    return "".join(ch for ch in unicodedata.normalize("NFD", str(t or "").lower()) if unicodedata.category(ch) != "Mn")


def search(stock, mw_type, color, grams=None, q="", ids=None, n=40):
    """Tout le stock (toutes matieres), filtre par texte (nom, marque, matiere,
    couleur, #id) ou par ids, du plus proche en couleur au plus eloigne."""
    words = [w for w in _fold(q).split() if w]
    want = {int(i) for i in ids or [] if str(i).isdigit()}
    out = []
    for e in stock:
        f = e["f"]
        if want and f.id not in want:
            continue
        if words:
            hay = _fold(" ".join(str(x or "") for x in (f.translated_name, f.name, f.name_en, f.manufacturer, f.material,
                                                         f.fila_type, f.color, f.colors_array, f"#{f.id}")))
            if not all(w in hay for w in words):
                continue
        multi = (f.multicolor_type or "monochrome") != "monochrome"
        out.append(_cand(e, _colors_de(f, color), material_fit(mw_type, f), multi, grams))
    out.sort(key=lambda c: (c["delta_e"], c["other_material"]))
    return out[:n]


def _grams(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def match_profiles(profiles: list) -> dict:
    """{instance_id: [{type, color, g, exact, matches: [...]}]} pour les profils
    d'un modele. Un profil dont le 3MF a deja ete lu (filaments exacts) en
    profite : reference, finition et marque departagent les propositions."""
    from .mw_3mf import cached as exact_cached, slot_for
    stock = await stock_rows()
    res = {}
    for p in profiles or []:
        slots = exact_cached(p.get("instance_id")) if str(p.get("instance_id") or "").isdigit() else None
        items = []
        for fl in p.get("filaments") or []:
            g = _grams(fl.get("g"))
            ex = slot_for(slots, fl.get("type"), fl.get("color")) if slots else None
            items.append({"type": fl.get("type"), "color": fl.get("color"), "g": g,
                          "exact": {k: ex[k] for k in ("id", "setting", "subtype", "vendor")} if ex else None,
                          "matches": best_matches(fl.get("type"), fl.get("color"), g, stock, exact=ex),
                          "others": best_matches(fl.get("type"), fl.get("color"), g, stock, n=5, other=True)})
        res[p.get("instance_id")] = items
    return res
