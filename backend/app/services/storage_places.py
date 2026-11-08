"""
Le rangement des bobines (07/11/2026). Une bobine est dans l'imprimante (AMS, HT, support externe : son emplacement est
ecrit par core/mqtt), ou rangee. Trois modes, au choix dans Parametres > Filaments :

  - single   : un seul rangement hors de l'imprimante (le mode d'origine). Il s'appelait toujours « Tiroir » ; on peut
               le renommer (« Étagère », « Placard »...). Une installation qui se met a jour reste dans ce mode.
  - assigned : chaque bobine a SA place (place_id) : elle est dans l'imprimante, ou a cette place, rien d'autre. En
               sortant de l'AMS, elle y retourne d'office. Sans place, elle est « À ranger ».
  - manual   : on ne range jamais au meme endroit. En sortant de l'AMS, la bobine passe « À ranger » (unstored_at) et
               l'appli rappelle de dire ou on l'a mise. Aucune case n'est a elle : partie dans l'imprimante, elle libere
               la sienne (08/11/2026).

Echange intelligent (case a cocher, mode « manuel » seulement depuis le 08/11/2026 : en « sa place », chacune retourne a
la sienne) : une bobine B entre dans le slot qu'une bobine A vient de quitter (dans les 30 min) ; A a de fortes chances
d'avoir pris la place que B occupait : elle y est rangee d'office (plus de rappel). Une place de STOCK (cartons,
reserve, et tout ce qu'elle contient) ne se devine jamais : une bobine qui en sort pour l'AMS la quitte pour de bon, et
celle qu'elle remplace attend qu'on dise ou elle est (on ne peut pas le deviner).

Les places forment un arbre (models/storage_place.py) : seules les feuilles recoivent des bobines ; une feuille commune
en prend autant qu'on veut, une feuille unique (une case) une seule : tant que la bobine qui l'occupe n'est pas rangee
ailleurs ou archivee, on ne peut pas y en mettre une autre (sauf a la deloger, elle repasse alors « À ranger »). Une
bobine garde sa place pendant qu'elle est dans l'AMS : sa case lui reste reservee.

L'emplacement ecrit sur la bobine (Spool.location, lu partout : listes, recherche, notifications) est le chemin de sa
place (« Rack 1 › A2 »), le nom du rangement unique, ou « À ranger ». refresh_all() le recalcule apres un changement
de mode ou de l'arbre (et au demarrage).
"""
import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import select

logger = logging.getLogger(__name__)

MODES = ("single", "assigned", "manual")
K_MODE, K_NAME, K_SMART = "STORAGE_MODE", "STORAGE_NAME", "STORAGE_SMART"
SWAP_WINDOW = timedelta(minutes=30)
LAYOUTS = ("auto", "col", "row", "grid")     # echange intelligent : la bobine entree dans le slot dans ce delai
DEFAULT_NAME = "Tiroir"
TO_STORE = "À ranger"
STORED = "@rangement"         # demande a spool_location : « sortie de l'imprimante, range-la selon le mode »
SEP = " › "
RESERVED = {"à ranger", "a ranger", "archives", "en commande"}
_PRINTER = ("AMS", "EXTERNE", "HT-")


class StorageError(Exception):
    def __init__(self, msg, status=400, extra=None):
        super().__init__(msg)
        self.status, self.extra = status, extra or {}


def in_printer(loc) -> bool:
    """L'emplacement est-il dans l'imprimante (AMS, HT, support externe) ?"""
    return (loc or "").strip().upper().startswith(_PRINTER)


def stored(s) -> bool:
    """La bobine est hors de l'imprimante, en stock (ni archivee, ni en commande)."""
    return not s.archived and not getattr(s, "ordered", False) and not in_printer(s.location)


def live_loaded():
    """Les bobines vraiment dans l'imprimante en ce moment (etat MQTT), None si on ne le sait pas (imprimante muette)."""
    try:
        from ..core.mqtt import get_state
        st = get_state()
        ams = getattr(st, "ams_list", None) or []
        if not ams:
            return None
        return {t.spool_id for a in ams for t in (a.trays or []) if getattr(t, "spool_id", None)}
    except Exception:
        return None


def stale_printer(s, loaded=None) -> bool:
    """L'emplacement dit « dans l'imprimante » mais l'AMS ne l'a pas (07/11/2026 : une vieille bobine gardait son
    « AMS-B slot 3 » ; la ranger a la main ne changeait rien)."""
    if not in_printer(s.location):
        return False
    loaded = live_loaded() if loaded is None else loaded
    return loaded is not None and s.id not in loaded


def check_name(name: str, what="Le nom") -> str:
    n = " ".join((name or "").split())[:60]
    if not n:
        raise StorageError(f"{what} est vide")
    if n.lower() in RESERVED:
        raise StorageError(f"« {n} » est réservé par l'appli")
    if in_printer(n):
        raise StorageError(f"« {n} » ressemble à un emplacement de l'imprimante (AMS, HT, Externe) : choisis un autre nom")
    return n


async def config(db) -> dict:
    from .settings_service import get_setting
    mode = (await get_setting(db, K_MODE, "single")) or "single"
    return {"mode": mode if mode in MODES else "single",
            "name": (await get_setting(db, K_NAME, DEFAULT_NAME)) or DEFAULT_NAME,
            "smart": (await get_setting(db, K_SMART, "0")) == "1"}


async def places(db) -> dict:
    from ..models.storage_place import StoragePlace
    return {p.id: p for p in (await db.execute(select(StoragePlace))).scalars().all()}


def _kids(pl: dict) -> dict:
    out = {}
    for p in pl.values():
        out.setdefault(p.parent_id, []).append(p)
    for v in out.values():
        v.sort(key=lambda p: (p.sort or 0, p.id))
    return out


def path_of(pl: dict, pid) -> str | None:
    """« Rack 1 › A2 » ; None si la place n'existe plus. Un emplacement code « zone-numero » (« Colonne 1-3 », 07/11/2026)
    porte deja le nom de sa zone : « Tiroir › Colonne 1-3 », pas « Tiroir › Colonne 1 › Colonne 1-3 »."""
    names, seen = [], set()
    while pid is not None and pid in pl and pid not in seen:
        seen.add(pid)
        names.append(pl[pid].name)
        pid = pl[pid].parent_id
    if not names or pid is not None:
        return None
    names.reverse()
    out = []
    for n in names:
        if out and n.startswith(out[-1] + "-") and len(out) > 1:
            out[-1] = n
        else:
            out.append(n)
    return SEP.join(out)


def is_stock(pl: dict, pid) -> bool:
    """La place, ou un de ses groupes, est du stock."""
    seen = set()
    while pid is not None and pid in pl and pid not in seen:
        seen.add(pid)
        if getattr(pl[pid], "stock", False):
            return True
        pid = pl[pid].parent_id
    return False


def is_leaf(pl: dict, pid, kids=None) -> bool:
    kids = kids if kids is not None else _kids(pl)
    return pid in pl and not kids.get(pid)


def resolve(s, conf: dict, pl: dict, kids=None) -> str:
    """L'emplacement d'une bobine rangee, selon le mode."""
    if conf["mode"] == "single":
        return conf["name"]
    p = path_of(pl, s.place_id) if s.place_id and is_leaf(pl, s.place_id, kids) else None
    if conf["mode"] == "assigned":
        return p or TO_STORE
    return p if (p and s.unstored_at is None) else TO_STORE


_LEFT: dict = {}          # slot (« AMS-A slot 2 ») -> (bobine sortie, quand) : pour l'echange intelligent


async def out_of_printer(db, s) -> str:
    """Sortie de l'imprimante : ou elle va, selon le mode (unstored_at pose quand il faut dire ou on l'a mise)."""
    was = s.location if in_printer(s.location) else None
    if was:
        _LEFT[s.location] = (s.id, datetime.utcnow())
    conf, pl = await config(db), await places(db)
    kids = _kids(pl)
    has = bool(s.place_id and is_leaf(pl, s.place_id, kids))
    if conf["mode"] == "manual" or (conf["mode"] == "assigned" and not has):
        s.unstored_at = datetime.utcnow()
    else:
        s.unstored_at = None
    loc = resolve(s, conf, pl, kids)
    if was and conf["mode"] == "assigned" and has:
        await _note(db, "home", s, None, was, loc)        # retour d'office a sa place (07/11/2026)
    return loc


async def place_new(db, s, place_id=None) -> None:
    """Une bobine qui arrive en stock (creee, recue, scannee) : rangee selon le mode, a place_id si on l'a donnee."""
    conf = await config(db)
    if place_id and conf["mode"] != "single":
        try:
            await assign(db, [s], int(place_id))
            return
        except StorageError:
            pass
    s.location = await out_of_printer(db, s)


async def eject_from(db, loc: str, but=None) -> list:
    """Les bobines qu'on croit encore dans ce slot sortent (08/11/2026) : une autre vient d'y etre reconnue, un slot ne
    tient qu'une bobine. Rangees selon le mode (sa place, a ranger...), et notees pour l'echange intelligent."""
    from ..models.filament import Spool
    rows = (await db.execute(select(Spool).where(Spool.location == loc, Spool.id != but,
                                                 Spool.archived.is_(False)))).scalars().all()
    for s in rows:
        was = s.location
        s.location = await out_of_printer(db, s)
        logger.info(f"[RANGEMENT] bobine #{s.id} remplacée dans {was} par #{but} : {s.location}")
    return rows


async def into_printer(db, b, loc: str, already: bool = False) -> None:
    """La bobine b entre dans l'imprimante (slot loc), venant du stock : elle quitte une place de stock pour de bon ;
    echange intelligent : celle qui vient de quitter ce slot prend la place que b laisse (voir l'en-tete).
    already (08/11/2026) : b porte deja ce slot (ecrit avant que l'occupante ne sorte) ; elle vient quand meme du stock."""
    from ..models.filament import Spool
    conf = await config(db)
    left = _LEFT.pop(loc, None)
    if conf["mode"] == "single" or not (stored(b) or (already and not b.archived and not getattr(b, "ordered", False))):
        return
    pl = await places(db)
    kids = _kids(pl)
    here = b.place_id if (b.place_id and is_leaf(pl, b.place_id, kids) and b.location != TO_STORE) else None
    from_stock = None
    if b.place_id and is_stock(pl, b.place_id):
        from_stock = path_of(pl, b.place_id)
        b.place_id, here = None, None                 # sortie du stock : elle n'y reviendra pas
        logger.info(f"[RANGEMENT] bobine #{b.id} sortie du stock pour {loc}")
        await _note(db, "stock_out", b, None, loc, from_stock)
    # l'echange intelligent : en « je range ou je veux » seulement (08/11/2026) ; en « sa place », chacune a la sienne et y
    # retourne, la case de celle qui entre l'attend
    if not (conf["mode"] == "manual" and conf["smart"] and left and left[0] != b.id and datetime.utcnow() - left[1] <= SWAP_WINDOW):
        return
    a = await db.get(Spool, left[0])
    if a is None or a.archived or not stored(a):
        return
    # pas encore dite rangee depuis sa sortie : elle a pris la place de b
    if a.location == TO_STORE and a.unstored_at is not None and a.unstored_at >= left[1] - timedelta(minutes=1):
        if here:
            b.place_id = None
            a.place_id, a.unstored_at = here, None
            a.location = resolve(a, conf, pl, kids)
            logger.info(f"[RANGEMENT] échange : #{a.id} rangée à la place de #{b.id} ({a.location})")
            await _note(db, "swap", a, b, loc, a.location)
        else:
            # rien a deviner : b sortait du stock, ou n'avait pas de place connue (07/11/2026 : le dire tout de suite)
            await _note(db, "stock" if from_stock else "unknown", a, b, loc, from_stock)


# les notifications du rangement automatique (07/11/2026), envoyees apres l'ecriture (send_notes)
_NOTES: list = []


async def _note(db, kind, a, b, loc, where=None, other=None):
    from ..models.filament import Filament
    from . import notify_events as E
    try:
        fa = await db.get(Filament, a.filament_id)
        fb = await db.get(Filament, b.filament_id) if b is not None else None
        la = f"« {spool_label(fa, a)} »"
        lb = f"« {spool_label(fb, b)} »" if b is not None else ""
    except Exception:
        la, lb = f"la bobine #{a.id}", (f"la bobine #{b.id}" if b is not None else "")
    if kind == "home":
        t, m = "📍 Bobine retournée à sa place", (f"{la}, sortie de {loc}, retourne à sa place : {where}.\n"
                                                 f"Rangement « Chaque bobine a sa place » : elle est dans l'imprimante ou à sa place, rien d'autre.")
    elif kind == "stock_out":
        t, m = "📦 Bobine sortie du stock", (f"{la} est entrée dans {loc} depuis le stock « {where} » : elle le quitte pour de bon.\n"
                                             f"En sortant de l'AMS, elle sera à ranger : on te demandera où tu la mets.")
    elif kind == "swap":
        t, m = "🧠 Bobine rangée d'office", (f"{la}, sortie de {loc}, est rangée en {where} : elle a pris la place de {lb}, "
                                            f"qui vient d'entrer dans {loc}.\nSi ce n'est pas ça, change sa place dans l'appli.")
    elif kind == "exchange":
        t, m = "🧠 Échange de places", (f"{la}, sortie de {loc}, prend la place de {lb} : {where}."
                                        + (f"\n{lb} prend la sienne : {other}." if other else f"\n{lb} n'a plus de place : elle sera à ranger en sortant de l'AMS."))
    elif kind == "stock":
        t, m = "📥 Bobine à ranger", (f"{la}, sortie de {loc}, a été remplacée par {lb}, sortie du stock « {where} » : "
                                      f"impossible de deviner où tu l'as mise.\n👉 Dis-le dans l'appli.")
    else:
        t, m = "📥 Bobine à ranger", (f"{la}, sortie de {loc}, a été remplacée par {lb}, qui n'avait pas de place connue : "
                                      f"impossible de deviner où tu l'as mise.\n👉 Dis-le dans l'appli.")
    _NOTES.append((t, m, f"/filaments?ranger={a.id}" if kind in ("stock", "unknown")
                   else f"/filaments?locate={a.id}" if kind in ("home", "swap", "exchange") else f"/filaments?spool={a.id}&id={a.filament_id}"))


async def send_notes() -> None:
    """Envoie les notifications du rangement automatique (notification « Rangement automatique »)."""
    if not _NOTES:
        return
    notes = list(_NOTES)
    _NOTES.clear()
    from . import notify_events as E
    cfg = await E._cfg_for("spool_auto_store")
    if not cfg:
        return
    for t, m, link in notes:
        await E._send(cfg, "spool_auto_store", t, m, link=link, priority=2)


def archived(s) -> None:
    """Archivee : sa place se libere."""
    s.place_id = None
    s.unstored_at = None


async def occupant(db, pid, but=None):
    """La bobine (active) qui tient une place, None si libre."""
    from ..models.filament import Spool
    q = select(Spool).where(Spool.place_id == pid, Spool.archived.is_(False))
    if but:
        q = q.where(Spool.id.not_in(list(but)))
    return (await db.execute(q.limit(1))).scalar_one_or_none()


async def assign(db, spools: list, pid: int, force: bool = False) -> list:
    """Range des bobines a une place (feuille). Une case (single) n'en prend qu'une : occupee par une autre, refus
    (StorageError 409 avec l'occupante), sauf force : l'occupante perd sa place et repasse « À ranger » si elle y
    etait. Renvoie les bobines delogees."""
    conf, pl = await config(db), await places(db)
    kids = _kids(pl)
    if pid not in pl:
        raise StorageError("Emplacement introuvable", 404)
    if not is_leaf(pl, pid, kids):
        raise StorageError(f"« {pl[pid].name} » contient d'autres emplacements : choisis-en un dedans")
    moved = []
    if pl[pid].single:
        if len(spools) > 1:
            raise StorageError(f"« {path_of(pl, pid)} » ne prend qu'une bobine")
        occ = await occupant(db, pid, but={s.id for s in spools})
        if occ is not None:
            if not force:
                raise StorageError(f"« {path_of(pl, pid)} » est déjà prise par la bobine #{occ.id}", 409,
                                   {"occupant": occ.id})
            occ.place_id = None
            if stored(occ):
                occ.unstored_at = datetime.utcnow() if conf["mode"] != "single" else None
                occ.location = resolve(occ, conf, pl, kids)
            moved.append(occ)
    loaded = live_loaded()
    for s in spools:
        if s.archived:
            raise StorageError(f"La bobine #{s.id} est archivée")
        s.place_id = pid
        if stale_printer(s, loaded):                 # un vieux slot AMS en memoire : on la range vraiment
            s.location, s.ams_tray = TO_STORE, None
        if stored(s):
            s.unstored_at = None
            s.location = resolve(s, conf, pl, kids)
    return moved


async def unassign(db, spools: list, to_store: bool = False) -> None:
    """Retire leur place ; to_store (07/11/2026, « 📥 À ranger ») : elles attendent qu'on dise ou elles sont (rappels)."""
    conf, pl = await config(db), await places(db)
    kids = _kids(pl)
    loaded = live_loaded()
    for s in spools:
        s.place_id = None
        if to_store and stale_printer(s, loaded):
            s.location, s.ams_tray = TO_STORE, None
        if stored(s):
            if to_store and conf["mode"] != "single":
                s.unstored_at = datetime.utcnow()
            s.location = resolve(s, conf, pl, kids)


async def refresh(db) -> int:
    """Reecrit l'emplacement des bobines rangees (mode, noms, arbre changes). Renvoie le nombre de bobines touchees."""
    from ..models.filament import Spool
    conf, pl = await config(db), await places(db)
    kids = _kids(pl)
    n = 0
    for s in (await db.execute(select(Spool).where(Spool.archived.is_(False)))).scalars().all():
        if s.place_id and s.place_id not in pl:
            s.place_id = None                      # place supprimee
        if not stored(s):
            if in_printer(s.location) and s.unstored_at is not None:
                s.unstored_at = None
            continue
        loc = resolve(s, conf, pl, kids)
        if s.location != loc:
            s.location = loc
            n += 1
    for s in (await db.execute(select(Spool).where(Spool.archived.is_(True), Spool.place_id.is_not(None)))).scalars().all():
        archived(s)
    return n


async def refresh_all() -> int:
    from ..db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        n = await refresh(db)
        await db.commit()
    if n:
        logger.info(f"[RANGEMENT] {n} emplacement(s) de bobine réécrit(s)")
    _clear_cache()
    return n


def _clear_cache():
    """Le cache des emplacements deja ecrits (spool_location) : apres un changement fait ici, l'imprimante doit pouvoir
    reecrire le sien."""
    try:
        from . import spool_location
        with spool_location._lock:
            spool_location._ACTIVE_AMS_SPOOLS.clear()
    except Exception:
        pass


# ── l'arbre, pour l'interface ──
def _spool_mini(s, f) -> dict:
    return {"id": s.id, "filament_id": s.filament_id,
            "name": ((getattr(f, "translated_name", None) or f.name) if f else f"Bobine #{s.id}"),
            "color": f.color if f else None, "colors_array": f.colors_array if f else None,
            "multicolor_type": f.multicolor_type if f else None, "fila_finish": getattr(f, "fila_finish", None) if f else None,
            "material": ((f.fila_type or f.material) if f else None), "brand": f.manufacturer if f else None,
            "remaining_weight_g": s.remaining_weight_g, "location": s.location,
            "in_printer": in_printer(s.location), "ordered": bool(getattr(s, "ordered", False)),
            "unstored_at": s.unstored_at.isoformat() if s.unstored_at else None}


async def overview(db) -> dict:
    """Le mode, l'arbre (chemin, feuille, occupantes) et les bobines a ranger."""
    from ..models.filament import Filament, Spool
    conf, pl = await config(db), await places(db)
    kids = _kids(pl)
    rows = (await db.execute(select(Spool, Filament).outerjoin(Filament, Filament.id == Spool.filament_id)
                             .where(Spool.archived.is_(False)))).all()
    by_place, to_store = {}, []
    for s, f in rows:
        if s.place_id in pl:
            by_place.setdefault(s.place_id, []).append(_spool_mini(s, f))
        if stored(s) and s.location == TO_STORE:
            m = _spool_mini(s, f)
            m["last_place"] = s.place_id if s.place_id in pl else None
            to_store.append(m)
    to_store.sort(key=lambda m: m["unstored_at"] or "", reverse=True)
    out = []

    def walk(parent, depth):
        for p in kids.get(parent, []):
            out.append({"id": p.id, "parent_id": p.parent_id, "name": p.name, "single": bool(p.single),
                        "stock": bool(getattr(p, "stock", False)), "in_stock": is_stock(pl, p.id),
                        "layout": getattr(p, "layout", None) or "auto", "rev": bool(getattr(p, "rev", False)),
                        "edge": getattr(p, "edge", None), "span": getattr(p, "span", None),
                        "sort": p.sort or 0, "cols": p.cols, "icon": p.icon, "depth": depth, "path": path_of(pl, p.id),
                        "leaf": not kids.get(p.id), "spools": by_place.get(p.id, [])})
            walk(p.id, depth + 1)
    walk(None, 0)
    return {**conf, "places": out, "to_store": to_store, "to_store_label": TO_STORE}


# ── l'arbre, en ecriture ──
async def create(db, body: dict, parent_id=None) -> list:
    """Cree une place et, recursivement, ses enfants (body["children"]) : le generateur de l'interface envoie tout
    l'arbre d'un coup (Tiroir 1 > Colonne 1..3 > Ligne 1..4, Rack 1 > A1..D6)."""
    from ..models.storage_place import StoragePlace
    pl = await places(db)
    kids = _kids(pl)
    parent_id = body.get("parent_id", parent_id)
    if parent_id is not None:
        parent_id = int(parent_id)
        if parent_id not in pl:
            raise StorageError("Emplacement parent introuvable", 404)
        if is_leaf(pl, parent_id, kids) and await occupant(db, parent_id) is not None:
            raise StorageError(f"« {path_of(pl, parent_id)} » contient des bobines : range-les ailleurs avant d'y "
                               "créer des emplacements")
    made = []

    async def mk(b, par, sort):
        p = StoragePlace(parent_id=par, name=check_name(b.get("name")), single=bool(b.get("single")), sort=sort,
                         stock=bool(b.get("stock")), rev=bool(b.get("rev")),
                         layout=(b.get("layout") if b.get("layout") in LAYOUTS else None),
                         cols=(int(b["cols"]) if b.get("cols") else None), icon=(b.get("icon") or None))
        db.add(p)
        await db.flush()
        made.append(p.id)
        if len(made) > 2000:
            raise StorageError("Trop d'emplacements d'un coup (2 000 au plus)")
        for i, c in enumerate(b.get("children") or []):
            await mk(c, p.id, i)
    base = max([q.sort or 0 for q in kids.get(parent_id, [])] or [-1]) + 1
    if body.get("items") is not None:
        # plusieurs emplacements d'un coup dans parent_id (une zone, des cases de plus), sans noeud de plus
        if parent_id is None and not body["items"]:
            raise StorageError("Rien à créer")
        for i, it in enumerate(body["items"]):
            await mk(it, parent_id, base + i)
        return made
    await mk(body, parent_id, base)
    return made


async def update(db, pid: int, body: dict) -> None:
    from ..models.filament import Spool
    pl = await places(db)
    kids = _kids(pl)
    p = pl.get(pid)
    if p is None:
        raise StorageError("Emplacement introuvable", 404)
    if "name" in body:
        p.name = check_name(body["name"])
    if "single" in body:
        single = bool(body["single"])
        if single and not p.single:
            n = len((await db.execute(select(Spool.id).where(Spool.place_id == pid, Spool.archived.is_(False)))).all())
            if n > 1:
                raise StorageError(f"« {p.name} » tient {n} bobines : une case n'en prend qu'une")
        p.single = single
    if "stock" in body:
        p.stock = bool(body["stock"])
    if "layout" in body:
        p.layout = body["layout"] if body["layout"] in LAYOUTS else None
    if "rev" in body:
        p.rev = bool(body["rev"])
    if "edge" in body:
        p.edge = body["edge"] if body["edge"] in ("h", "v") else None
    if "span" in body:
        try:
            v = int(body["span"]) if body["span"] not in (None, "") else None
        except (TypeError, ValueError):
            v = None
        p.span = v if v == -1 or (v is not None and 2 <= v <= 12) else None
    if "cols" in body:
        p.cols = int(body["cols"]) if body["cols"] else None
    if "icon" in body:
        p.icon = (body["icon"] or None)
    if "parent_id" in body:
        np = body["parent_id"]
        np = int(np) if np not in (None, "") else None
        if np is not None:
            if np not in pl:
                raise StorageError("Emplacement parent introuvable", 404)
            q = np
            while q is not None:                   # pas dans sa propre descendance
                if q == pid:
                    raise StorageError("Un emplacement ne peut pas aller dans lui-même ou dans ce qu'il contient")
                q = pl[q].parent_id if q in pl else None
            if is_leaf(pl, np, kids) and await occupant(db, np) is not None:
                raise StorageError(f"« {path_of(pl, np)} » contient des bobines : range-les ailleurs d'abord")
        if np != p.parent_id:
            p.parent_id = np
            p.sort = max([q.sort or 0 for q in kids.get(np, []) if q.id != pid] or [-1]) + 1


async def move(db, pid: int, d: int) -> None:
    """Monte (d=-1) ou descend (d=+1) une place parmi ses soeurs."""
    pl = await places(db)
    p = pl.get(pid)
    if p is None:
        raise StorageError("Emplacement introuvable", 404)
    sib = _kids(pl).get(p.parent_id, [])
    i = next(k for k, q in enumerate(sib) if q.id == pid)
    j = i + (1 if d > 0 else -1)
    if 0 <= j < len(sib):
        sib[i], sib[j] = sib[j], sib[i]
    for k, q in enumerate(sib):
        q.sort = k


def subtree(pl: dict, pid) -> list:
    kids, out, todo = _kids(pl), [], [pid]
    while todo:
        q = todo.pop()
        out.append(q)
        todo += [c.id for c in kids.get(q, [])]
    return out


async def delete(db, pid: int) -> int:
    """Supprime une place et tout ce qu'elle contient ; leurs bobines perdent leur place (« À ranger » hors du mode
    unique). Renvoie le nombre de bobines concernees."""
    from ..models.filament import Spool
    from ..models.storage_place import StoragePlace
    pl = await places(db)
    if pid not in pl:
        raise StorageError("Emplacement introuvable", 404)
    ids = subtree(pl, pid)
    sp = (await db.execute(select(Spool).where(Spool.place_id.in_(ids)))).scalars().all()
    for s in sp:
        s.place_id = None
    for q in ids:
        await db.delete(await db.get(StoragePlace, q))
    await db.flush()
    return len([s for s in sp if not s.archived])


async def set_config(db, mode=None, name=None, smart=None) -> None:
    from .settings_service import set_setting
    if smart is not None:
        await set_setting(db, K_SMART, "1" if smart else "0")
    if name is not None:
        await set_setting(db, K_NAME, check_name(name, "Le nom du rangement"))
    if mode is not None:
        if mode not in MODES:
            raise StorageError("Mode inconnu")
        old = (await config(db))["mode"]
        await set_setting(db, K_MODE, mode)
        if old != mode:
            # changer de mode ne declenche aucun rappel : les bobines sans place s'affichent « À ranger », sans
            # notification pour chacune (seules celles qui sortent ensuite de l'AMS en demandent une)
            from ..models.filament import Spool
            for s in (await db.execute(select(Spool).where(Spool.unstored_at.is_not(None)))).scalars().all():
                s.unstored_at = None


# ── les rappels (mode manuel, ou bobine sans place) ──
_LAST: dict = {}          # bobine -> (sa sortie, dernier rappel) ; en memoire : au demarrage, on ne rappelle pas ce qui
                          # attendait deja ; une nouvelle sortie (unstored_at change) rappelle a nouveau
_STARTED = {"at": None}


async def pending(db) -> list:
    """Les bobines qui attendent qu'on dise ou elles sont rangees (sorties de l'AMS, recues, creees)."""
    from ..models.filament import Filament, Spool
    rows = (await db.execute(select(Spool, Filament).outerjoin(Filament, Filament.id == Spool.filament_id)
                             .where(Spool.archived.is_(False), Spool.location == TO_STORE,
                                    Spool.unstored_at.is_not(None)))).all()
    return [(s, f) for s, f in rows if stored(s)]


def spool_label(f, s=None) -> str:
    """« PLA Basic Rouge — PLA Basic · Bambu Lab · #12 » : le nom, toujours le sous-type et la marque (07/11/2026 : le
    libelle des notifications taisait le sous-type quand le nom le contenait), et le numero de la bobine."""
    if f is None:
        return f"Bobine #{s.id}" if s is not None else "Bobine"
    bits = [x for x in ((f.fila_type or f.material), f.manufacturer) if x]
    return (f"{f.translated_name or f.name}" + (f" — {' · '.join(bits)}" if bits else "")
            + (f" · #{s.id}" if s is not None else ""))


def _ago(dt) -> str:
    m = int((datetime.utcnow() - dt).total_seconds() // 60)
    return f"{m} min" if m < 60 else f"{m // 60} h {m % 60:02d}" if m < 1440 else f"{m // 1440} j"


async def remind_once(now=None) -> int:
    """Un passage : une notification pour les bobines a ranger dont le delai est passe (puis a chaque intervalle de
    rappel s'il est regle). Renvoie le nombre de bobines rappelees."""
    from ..db.session import AsyncSessionLocal
    from . import notify as N, notify_events as E
    now = now or datetime.utcnow()
    cfg = await E._cfg_for("spool_to_store")
    async with AsyncSessionLocal() as db:
        rows = await pending(db)
    ids = {s.id for s, _ in rows}
    for k in list(_LAST):
        if k not in ids:
            _LAST.pop(k, None)
    if _STARTED["at"] is None:              # premier passage : ce qui attendait deja ne sonne pas tout de suite
        _STARTED["at"] = now
        for s, _ in rows:
            _LAST[s.id] = (s.unstored_at, now)
        return 0
    if not cfg or not rows:
        return 0
    opt = N.options_of(cfg, "spool_to_store")
    delay = timedelta(minutes=float(opt.get("minutes", 15) or 15))
    every = float(opt.get("repeat_h", 0) or 0)
    def _due(s):
        last = _LAST.get(s.id)
        return last is None or last[0] != s.unstored_at or bool(every and now - last[1] >= timedelta(hours=every))
    due = [(s, f) for s, f in rows if s.unstored_at <= now - delay and _due(s)]
    if not due:
        return 0
    ready = [(s, f) for s, f in rows if s.unstored_at <= now - delay]
    for s, _ in ready:
        _LAST[s.id] = (s.unstored_at, now)
    n = len(ready)
    lines = [f"• {spool_label(f, s)} · sortie il y a {_ago(s.unstored_at)}" for s, f in ready[:8]]
    if n > 8:
        lines.append(f"… et {n - 8} autre{'s' if n - 8 > 1 else ''}")
    lines.append("👉 Dis où tu l'as rangée" if n == 1 else "👉 Dis où tu les as rangées")
    await E._send(cfg, "spool_to_store", f"📥 {n} bobine{'s' if n > 1 else ''} à ranger", "\n".join(lines),
                  link="/filaments?ranger=1", priority=2)
    return n


async def remind_loop():
    from ..core import tasks
    while True:
        try:
            await remind_once()
        except Exception as e:
            logger.warning(f"[RANGEMENT] rappel : {e}")
        await tasks.sleep("storage_remind", 120)
