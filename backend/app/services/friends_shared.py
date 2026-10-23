"""
« Chez les copains » : ce que mes copains ont imprime avec le MEME filament, ou
du meme modele MakerWorld. Lu chez chacun par la cle copain (lecture seule,
droits de son compte), en parallele ; un copain injoignable est signale.

Meme filament, strictement :
  - Bambu Lab : meme reference Bambu (GFA01…) et meme couleur ;
  - autre marque : meme marque, meme couleur, meme matiere et meme sous-type.
"""
import asyncio
import re

from .friends import _load, _get, FriendError


def _hex(c) -> str:
    return re.sub(r"[^0-9A-F]", "", str(c or "").upper())[:6]


def _n(t) -> str:
    return re.sub(r"[^A-Z0-9+]", "", str(t or "").upper())


def _colors(f) -> tuple:
    multi = (f.get("multicolor_type") or "monochrome") != "monochrome"
    extra = tuple(sorted(_hex(c) for c in (f.get("colors_array") or "").split(",") if _hex(c))) if multi else ()
    return (_hex(f.get("color")),) + extra


def identity(f: dict):
    """Cle d'identite d'un filament, comparable d'une maison a l'autre (None = trop vague)."""
    cols = _colors(f)
    if not cols[0]:
        return None
    brand = _n(f.get("manufacturer"))
    if "BAMBU" in brand and _n(f.get("profile_id")):
        return ("bambu", _n(f.get("profile_id")), cols)
    if not brand or not _n(f.get("material")):
        return None
    return ("autre", brand, cols, _n(f.get("material")), _n(f.get("fila_type")))


def _fil_dict(f) -> dict:
    return {k: getattr(f, k, None) for k in ("manufacturer", "profile_id", "color", "colors_array",
                                             "multicolor_type", "material", "fila_type")}


def _proxied(v, fid):
    """Adresses « /api/v1/... » du copain -> mon relais (le navigateur ajoute son jeton)."""
    if isinstance(v, str):
        return f"/api/v1/friends/{fid}/p/{v[8:]}" if v.startswith("/api/v1/") else v
    if isinstance(v, list):
        return [_proxied(x, fid) for x in v]
    if isinstance(v, dict):
        return {k: _proxied(x, fid) for k, x in v.items()}
    return v


async def _ask(f, path, params=None):
    r = await asyncio.to_thread(_get, f["url"], f["key"], path, params, 15)
    if r.status_code in (401, 403):
        raise FriendError("forbidden")
    if r.status_code == 404:
        raise FriendError("outdated")
    if r.status_code >= 400:
        raise FriendError("offline")
    return r.json()


async def _each(job):
    friends = await _load()

    async def one(f):
        head = {"id": f["id"], "name": f.get("name")}
        try:
            data = await job(f)
            return {**head, "status": "ok", **_proxied(data, f["id"])}
        except FriendError as e:
            msg = str(e)
            return {**head, "status": msg if msg in ("forbidden", "outdated") else "offline", "prints": [], "groups": []}
        except Exception:
            return {**head, "status": "offline", "prints": [], "groups": []}
    return {"friends": list(await asyncio.gather(*(one(f) for f in friends)))}


async def for_filament(filament) -> dict:
    me = identity(_fil_dict(filament))
    if not me:
        return {"friends": [], "reason": "Filament trop peu renseigné (marque, matière ou couleur)."}

    async def job(f):
        fils = await _ask(f, "filaments/filaments")
        same = [x for x in fils if isinstance(x, dict) and identity(x) == me]
        prints, groups = [], []
        for x in same:
            d = await _ask(f, f"filaments/filaments/{x['id']}/prints")
            prints += d.get("prints") or []
            groups += [g for g in d.get("groups") or [] if g["id"] not in {y["id"] for y in groups}]
        seen = set()
        prints = [p for p in prints if not (p["id"] in seen or seen.add(p["id"]))]
        return {"prints": prints, "groups": groups, "filaments": [{"id": x["id"], "name": x.get("name")} for x in same]}
    return await _each(job)


async def gallery() -> dict:
    """Galeries de tous mes copains reunies (prints et groupes), du plus recent
    au plus ancien, chaque element marque du copain."""
    res = await _each(lambda f: _ask(f, "prints/gallery"))
    items = []
    for fr in res["friends"]:
        if fr["status"] != "ok":
            continue
        who = {"friend_id": fr["id"], "friend_name": fr["name"]}
        items += [{**p, "kind": "print", **who} for p in fr.get("prints") or []]
        items += [{**g, "kind": "group", **who} for g in fr.get("groups") or []]
    items.sort(key=lambda it: str(it.get("print_date") or it.get("latest_date") or ""), reverse=True)
    return {"items": items,
            "friends": [{"id": f["id"], "name": f["name"], "status": f["status"],
                         "count": len(f.get("prints") or []) + len(f.get("groups") or [])} for f in res["friends"]]}


LIVE = ("RUNNING", "PAUSE", "PAUSED", "PREPARE", "SLICING")


def printer_state(st: dict) -> str:
    """Voyant d'une imprimante : printing (vert), standby (orange : allumee,
    au repos), off (rouge : l'appli ne la joint plus, donc eteinte).
    « unreachable » (gris) se pose quand c'est le BambuNymous qu'on ne joint pas."""
    if not st.get("connected"):
        return "off"
    return "printing" if str(st.get("status") or "").upper() in LIVE else "standby"


# un copain imprime-t-il ? relu au plus une fois par minute (sa camera regardee compte alors)
_PRINTING = {}


async def is_printing(fid) -> bool:
    import time
    hit = _PRINTING.get(str(fid))
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    ok = False
    try:
        f = next((x for x in await _load() if str(x["id"]) == str(fid)), None)
        if f:
            ok = printer_state(await _ask(f, "printer/status")) == "printing"
    except Exception:
        ok = False
    _PRINTING[str(fid)] = (time.time(), ok)
    return ok


def my_state() -> dict:
    from ..core.mqtt import get_state
    s = get_state()
    st = {"connected": bool(s.connected), "status": s.status}
    return {"state": printer_state(st), "progress": s.progress}


async def printing() -> dict:
    """Les copains dont l'imprimante tourne en ce moment : etat, avancement, et
    l'impression en cours (nom, vignette par le relais). Les autres sont omis
    de « printing » ; « states » donne le voyant de chacun, « me » le mien."""
    friends = await _load()
    states = {}

    async def one(f):
        try:
            st = await _ask(f, "printer/status")
        except Exception:
            states[f["id"]] = {"state": "unreachable", "name": f.get("name"), "role": f.get("role")}
            return None
        states[f["id"]] = {"state": printer_state(st), "progress": st.get("progress"), "name": f.get("name"), "role": f.get("role")}
        try:
            if states[f["id"]]["state"] != "printing":
                return None
            cur = None
            try:
                lst = (await _ask(f, "prints", {"limit": 1, "status": "IN_PROGRESS"})).get("prints") or []
                if lst:
                    p = lst[0]
                    cur = {"id": p.get("id"), "name": p.get("translated_name") or p.get("file_name"),
                           "design_id": p.get("design_id"), "image": f"/api/v1/prints/{p.get('id')}/image"}
            except FriendError:
                pass
            return _proxied({"id": f["id"], "name": f.get("name"),
                             **{k: st.get(k) for k in ("status", "progress", "remaining_minutes", "layer",
                                                       "total_layers", "print_name")},
                             "print": cur}, f["id"])
        except Exception:
            return None
    res = await asyncio.gather(*(one(f) for f in friends))
    return {"printing": [r for r in res if r], "states": {str(k): v for k, v in states.items()}, "me": my_state()}


async def for_design(design_id: str) -> dict:
    did = str(design_id or "").strip()
    if not did.isdigit():
        return {"friends": []}
    return await _each(lambda f: _ask(f, f"prints/design/{did}/gallery"))
