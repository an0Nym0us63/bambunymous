"""
Surveillance de mes collections MakerWorld, pour les notifications :
  - mw_coll_added   : un modele entre dans une collection ;
  - mw_coll_changed : une collection est creee, renommee ou supprimee.
Que ce soit fait sur makerworld.com, dans Bambu Handy ou dans l'appli.

Toutes les 10 minutes (seulement si l'une des deux est activee) : la liste
des collections (une requete) ; puis, pour celles dont le nombre de modeles a
change ou qui sont nouvelles, leur premiere page (les ajouts recents en tete).
On compare a l'instantane precedent (reglage MW_COLL_SNAPSHOT). Le premier
passage memorise sans rien envoyer.

Ce que l'on fait soi-meme dans l'appli est note (own) et, par defaut, n'est
pas renotifie (option « source »).
"""
import asyncio
import json
import logging
import time

from . import notify as N

logger = logging.getLogger(__name__)

K_SNAP = "MW_COLL_SNAPSHOT"
PERIOD = 600
OWN_TTL = 7200
MAX_IDS = 300            # modeles memorises par collection
_OWN: list = []          # [(instant, type, collection, modele)]


def own(kind: str, cid=None, did=None) -> None:
    """Note une ecriture faite depuis l'appli (ajout, creation, renommage, suppression)."""
    now = time.time()
    _OWN[:] = [o for o in _OWN if now - o[0] < OWN_TTL] + [(now, kind, str(cid or ""), str(did or ""))]


def _is_own(kind, cid="", did="", title="") -> bool:
    now = time.time()
    for t, k, c, d in _OWN:
        if now - t >= OWN_TTL or k != kind:
            continue
        if kind == "create" and c == title:          # creation : l'id n'est connu qu'apres coup
            return True
        if c == str(cid) and (not d or d == str(did)):
            return True
    return False


async def _snap_get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, K_SNAP, "")
    try:
        d = json.loads(raw) if raw else None
    except ValueError:
        d = None
    return d if isinstance(d, dict) else None


async def _snap_put(snap: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_SNAP, json.dumps(snap, ensure_ascii=False))


def _cover(u):
    if u and "bblmw.com" in u and "?" not in u:
        u += "?x-oss-process=image/resize,w_600/format,webp"
    return u


async def check_collections() -> int:
    """Un passage : compare, notifie, memorise. Rend le nombre d'envois."""
    from . import makerworld_account as A
    cfg = await N._load()
    on_add, on_chg = N.enabled_in(cfg, "mw_coll_added"), N.enabled_in(cfg, "mw_coll_changed")
    if not (on_add or on_chg) or not await A.token():
        return 0
    with_app = lambda e: N.options_of(cfg, e).get("source") == "all"
    colls = (await A.collections(fresh=True))["collections"]
    old = await _snap_get()
    # Toutes les collections disparues d'un coup : reponse douteuse (MakerWorld
    # a moitie joignable), on ne tire aucune conclusion de ce passage.
    if old and not colls:
        logger.info("[MW] aucune collection lue alors qu'il y en avait : passage ignore")
        return 0
    snap = {}
    for c in colls:
        prev = (old or {}).get(c["id"])
        ids = prev["ids"] if prev else []
        if prev and prev.get("missing"):
            prev = {k: v for k, v in prev.items() if k != "missing"}
        if old is None or not prev or prev.get("count") != c["count"] or c["count"] is None:
            try:
                # Toute la collection (jusqu'a MAX_IDS) : savoir ce qui en est
                # SORTI permet de reconnaitre un deplacement (sorti ici, entre
                # la-bas), qui n'est pas un ajout.
                items, off = [], 0
                while off < MAX_IDS:
                    page = await A.collection_designs(c["id"], off, 60, fresh=True)
                    got = page.get("items") or []
                    items += got
                    if not got or not page.get("has_more"):
                        break
                    off += 60
            except Exception as e:
                logger.info(f"[MW] collection {c['id']} illisible : {e}")
                items = None
            if items is not None:
                c["_items"] = items
                ids = [x["design_id"] for x in items]
        snap[c["id"]] = {"title": c["title"], "count": c["count"], "ids": ids}
    # Une collection absente n'est supprimee qu'apres deux passages d'affilee
    # (20 min) : un trou de reseau ne la fait pas disparaitre.
    gone_now = {}
    for cid, o in (old or {}).items():
        if cid not in snap:
            miss = int(o.get("missing") or 0) + 1
            if miss < 2:
                snap[cid] = {**o, "missing": miss}
            else:
                gone_now[cid] = o
    await _snap_put(snap)
    if not old:
        # premier passage, ou instantane vide (laisse par une panne d'avant ce
        # correctif) : on memorise sans rien annoncer
        logger.info(f"[MW] collections memorisees ({len(snap)}) : rien n'est notifie")
        return 0

    sent = 0
    # Modeles sortis d'une collection pendant ce passage : s'ils sont entres
    # dans une autre, c'est un deplacement -- ni ajout, ni notification.
    gone = set()
    for cid, o in old.items():
        if cid in snap and (snap[cid].get("ids") is not o.get("ids")):
            gone |= set(o.get("ids") or []) - set(snap[cid].get("ids") or [])
    link = N.app_link(cfg, "/prints")
    acts_app = [("Ouvrir BambuNymous", link)] if link else []
    # Creees, renommees, supprimees
    if on_chg:
        for cid, s in snap.items():
            o = old.get(cid)
            if o is None and (with_app("mw_coll_changed") or not _is_own("create", title=s["title"])):
                await N.notify("mw_coll_changed", "📁 Collection créée", f"« {s['title']} »"
                               + (f"\n📦 {s['count']} modèle{'s' if s['count'] > 1 else ''}" if s.get("count") else ""),
                               priority=2, actions=acts_app)
                sent += 1
            elif o and o.get("title") != s["title"] and (with_app("mw_coll_changed") or not _is_own("rename", cid)):
                await N.notify("mw_coll_changed", "✏️ Collection renommée", f"« {o.get('title')} » → « {s['title']} »",
                               priority=2, actions=acts_app)
                sent += 1
        for cid, o in gone_now.items():
            if with_app("mw_coll_changed") or not _is_own("delete", cid):
                await N.notify("mw_coll_changed", "🗑️ Collection supprimée",
                               f"« {o.get('title')} »" + (f"\n📦 elle contenait {o['count']} modèle{'s' if o['count'] > 1 else ''}"
                                                          if o.get("count") else ""), priority=2, actions=acts_app)
                sent += 1
    # Modeles ajoutes
    if on_add:
        for c in colls:
            o = old.get(c["id"])
            items = c.get("_items")
            if not items or o is None and not c.get("count"):
                continue
            before = set((o or {}).get("ids") or [])
            # Un ajout arrive EN TETE de la collection : seul ce qui precede le
            # premier modele deja connu est nouveau. Plus loin, c'est un modele
            # qui remonte dans la 1re page parce qu'un autre a ete retire (ou
            # deplace ailleurs) -- pas un ajout.
            head = []
            for x in items:
                if before and x["design_id"] in before:
                    break
                head.append(x)
            # Et jamais plus d'ajouts que la hausse du nombre de modeles.
            if o and isinstance(o.get("count"), int) and isinstance(c.get("count"), int):
                head = head[:max(0, c["count"] - o["count"])]
            new = [x for x in head if x["design_id"] not in before and x["design_id"] not in gone
                   and (with_app("mw_coll_added") or not _is_own("add", c["id"], x["design_id"]))]
            # rangé depuis BambuNymous : on sait par qui (mw_added) ; ailleurs, on ne le sait pas
            from . import mw_added
            marks = await mw_added.of_collection(str(c["id"])) if new else {}
            for x in new[:5]:
                url = f"https://makerworld.com/fr/models/{x['design_id']}"
                printed = x.get("printed") or 0
                lines = [f"📄 {x.get('title_fr') or x.get('title') or 'Modèle ' + x['design_id']}"]
                if x.get("creator_name"):
                    lines.append(f"👤 {x['creator_name']}")
                lines.append(f"🖨️ déjà imprimé {printed} fois" if printed else "🖨️ jamais imprimé")
                lines.append(f"📁 « {c['title']} »" + (f" · {c['count']} modèles" if c.get("count") else ""))
                # ajoute depuis BambuNymous : qui, des le titre (une derniere ligne est coupee dans la liste)
                who = (marks.get(str(x["design_id"])) or {}).get("by")
                await N.notify("mw_coll_added", f"➕ Ajouté à « {c['title']} »" + (f" par {who}" if who else ""), "\n".join(lines),
                               click=N.mw_model_link(cfg, x["design_id"]), attach=_cover(x.get("cover_url")), priority=2,
                               actions=[("Voir sur MakerWorld", url)] + acts_app)
                sent += 1
            if len(new) > 5:
                await N.notify("mw_coll_added", f"➕ « {c['title']} » : {len(new) - 5} autre(s) ajout(s)", "",
                               priority=2, actions=acts_app)
    return sent


async def watch_loop(period_s: int = PERIOD, first_delay_s: int = 240):
    from ..core import tasks as _tasks
    await _tasks.sleep("mw_watch", first_delay_s)
    while True:
        try:
            n = await check_collections()
            if n:
                logger.info(f"[MW] collections : {n} notification(s)")
        except Exception as e:
            _tasks.error("mw_watch")
            logger.warning(f"[MW] surveillance des collections : {e}")
        await _tasks.sleep("mw_watch", period_s)
