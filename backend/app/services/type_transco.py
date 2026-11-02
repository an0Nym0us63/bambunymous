"""Les sous-types des catalogues des autres marques, a notre facon (03/11/2026).

Les gammes de l'Open Filament Database (et de notre catalogue) s'ecrivent comme chaque marque les vend : « Fil PLA »,
« 123-3D Filament PLA », « Matte PLA », « 95A High Speed TPU »… Le catalogue Bambu, lui, met la matiere devant :
« PLA Matte ». Deux temps :
  - auto() : retire « Fil » / « Filament » et met la matiere devant (« Matte PLA » -> « PLA Matte ») ;
  - nos transcos (Parametres › Filaments, reglage TYPE_TRANSCO) : « telle gamme » -> « notre sous-type », appliquees
    ensuite (sur le nom d'origine ou sur celui d'auto()).
"""
import json
import re

KEY = "TYPE_TRANSCO"
# la seule matiere, sans precision : le sous-type de base de Bambu (03/11/2026 : « PLA » -> « PLA Basic »)
BASIC = {"PLA": "PLA Basic", "PETG": "PETG Basic"}
_MAP: dict = {}                       # gamme (casefold) -> notre sous-type
_ITEMS: list = []


def auto(gamme: str, family: str = "") -> str:
    s = re.sub(r"\s+", " ", str(gamme or "")).strip()
    s = re.sub(r"^(fil|filament|filamento)\s+", "", s, flags=re.I)
    s = re.sub(r"\s+(filament|filamento)$", "", s, flags=re.I).strip()
    toks = s.split(" ")
    fam = str(family or "").upper().replace("_", "-")
    last = toks[-1].upper() if toks else ""
    # la matiere en dernier (« Silk PLA+ », « Matte PLA ») : devant, comme Bambu (« PLA+ Silk », « PLA Matte »)
    if len(toks) > 1 and fam and (last == fam or last.rstrip("+") == fam) and toks[0].upper().rstrip("+") != fam:
        toks = [toks[-1]] + toks[:-1]
    # la matiere ecrite une seconde fois autrement (« PET-G Premium PETG » -> « PETG Premium »)
    if fam and len(toks) > 1:
        toks = toks[:1] + [t for t in toks[1:] if t.upper().replace("-", "") != fam.replace("-", "")]
    out = " ".join(toks) or str(gamme or "").strip()
    return BASIC.get(out.upper(), out)


def apply(gamme: str, family: str = "") -> str:
    """Notre sous-type pour une gamme d'un catalogue des autres marques."""
    a = auto(gamme, family)
    return _MAP.get(str(gamme or "").strip().casefold()) or _MAP.get(a.casefold()) or a


def items() -> list:
    return [dict(x) for x in _ITEMS]


def _set(items_: list) -> None:
    _ITEMS[:] = items_
    _MAP.clear()
    _MAP.update({x["from"].casefold(): x["to"] for x in items_})


async def load() -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        v = json.loads(raw) if raw else []
    except ValueError:
        v = []
    _set([x for x in v if isinstance(x, dict) and x.get("from") and x.get("to")] if isinstance(v, list) else [])


async def save(new: list) -> list:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    seen = {}
    for it in new or []:
        a, b = str((it or {}).get("from") or "").strip()[:80], str((it or {}).get("to") or "").strip()[:80]
        if a and b:
            seen[a.casefold()] = {"from": a, "to": b}
    clean = sorted(seen.values(), key=lambda x: x["from"].casefold())
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(clean, ensure_ascii=False))
    _set(clean)
    return items()
