"""
File d'attente d'impression : les modeles d'une ou plusieurs de mes
collections MakerWorld (« A imprimer »…), avec, pour chacun, le profil et les
filaments que je compte utiliser, et les totaux.

Reglage MW_QUEUE (JSON) :
  {"collections": ["30919606", ...],
   "plans": {"<design_id>": {"instance_id": "1452154", "plates": [1, 3] | null,
                             "picks": {"PLA|#646941": 12, ...}, "qty": 2}}}
qty : nombre d'exemplaires voulus (temps, filament, cout et stock multiplies).
Un plan est retenu depuis la fiche du modele (profil, plateaux, filaments
choisis). Sans plan : le profil retenu par l'appli, tous les plateaux, et le
filament le plus proche du stock pour chaque couleur.

Pour chaque modele : temps, poids, cout, et s'il est imprimable
  - maintenant : chaque filament choisi est charge dans l'AMS, assez rempli ;
  - avec le stock : assez de chaque filament en stock (bobines comprises) ;
  - sinon : ce qui manque.
Les besoins de toute la file sont additionnes par filament du stock.
"""
import asyncio
import json
import logging
import time

logger = logging.getLogger(__name__)

KEY = "MW_QUEUE"
MAX_PER_COLLECTION = 300
_CACHE = [0.0, None]
TTL = 300
# Dernier calcul garde sur disque : apres un redemarrage, la page s'affiche tout
# de suite avec lui (« stale ») pendant que le calcul se refait en arriere-plan.
_INVALID = [False]         # reglage change depuis le dernier calcul : on recalcule avant de repondre
_TASK = [None]


def _snap_path():
    from pathlib import Path
    from ..core.config import settings
    return Path(settings.DATA_DIR) / "mw_queue.json"


def _snap_get():
    try:
        return json.loads(_snap_path().read_text(encoding="utf-8"))
    except Exception:
        return None


def _snap_put(out):
    try:
        _snap_path().write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    except Exception:
        logger.exception("[QUEUE] instantane non garde")


async def _recompute(fresh: bool = False):
    out = await _compute(fresh)
    _CACHE[:] = [time.time(), out]
    _INVALID[0] = False
    await asyncio.to_thread(_snap_put, out)
    # les 3MF d'origine, fiches et documents des modeles de la file, recuperes d'avance (02/11/2026)
    try:
        from . import mw_source
        mw_source.start_prefetch_queue()
    except Exception:
        logger.exception("[QUEUE] recuperation d'avance")
    return out


def _refresh_bg():
    if _TASK[0] and not _TASK[0].done():
        return
    async def run():
        try:
            await _recompute()
        except Exception:
            logger.exception("[QUEUE] recalcul en arriere-plan")
    _TASK[0] = asyncio.create_task(run())


async def warm():
    """Au demarrage : calcule la liste sans attendre qu'on ouvre la page."""
    from ..core import tasks as _tasks
    await _tasks.sleep("mw_queue", 30)
    try:
        if (await _load())["collections"]:
            snap = await asyncio.to_thread(_snap_get)
            if snap and _CACHE[1] is None:
                _CACHE[:] = [0.0, snap]
                _INVALID[0] = False
            if _CACHE[0] == 0.0:
                await _recompute()
    except Exception:
        _tasks.error("mw_queue")
        logger.exception("[QUEUE] calcul au demarrage")
    _tasks.finish("mw_queue")


class QueueError(Exception):
    pass


async def _load() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    d = d if isinstance(d, dict) else {}
    d.setdefault("collections", [])
    d.setdefault("plans", {})
    d.setdefault("order", [])
    return d


async def _save(d: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(d, ensure_ascii=False))
    _CACHE[:] = [0.0, None]
    _INVALID[0] = True


def touch() -> None:
    """Une impression commence ou finit : ce qui est fait et faisable change. Le resultat en cache
    passe pour vieux, le prochain appel le rend tout de suite et le recalcule en fond."""
    if _CACHE[1] is not None:
        _CACHE[0] = 0.0


async def config() -> dict:
    d = await _load()
    return {"collections": d["collections"], "plans": d["plans"]}


async def set_collections(ids: list) -> dict:
    d = await _load()
    d["collections"] = [str(i) for i in (ids or []) if str(i).isdigit()][:20]
    await _save(d)
    return await config()


async def set_plan(design_id: str, plan) -> dict:
    did = str(design_id or "").strip()
    if not did.isdigit():
        raise QueueError("Modèle inconnu")
    d = await _load()
    if plan is None:
        # oublier le plan, mais garder la quantite si elle a ete reglee
        q = _qty((d["plans"].get(did) or {}).get("qty", 1))
        if q > 1:
            d["plans"][did] = {"instance_id": None, "plates": None, "picks": {}, "plate_picks": {}, "qty": q}
        else:
            d["plans"].pop(did, None)
    else:
        iid = str((plan or {}).get("instance_id") or "")
        if not iid.isdigit():
            raise QueueError("Profil inconnu")
        plates = plan.get("plates")
        plates = [int(p) for p in plates if str(p).isdigit()] if isinstance(plates, list) else None
        picks = {str(k)[:40]: int(v) for k, v in (plan.get("picks") or {}).items() if str(v).isdigit()}
        # exceptions par plateau : {"2": {"PLA|#40B0B0": 12}} (ce plateau-la dans une autre couleur)
        plate_picks = {}
        for pn, pk in (plan.get("plate_picks") or {}).items():
            if str(pn).isdigit() and isinstance(pk, dict):
                one = {str(k)[:40]: int(v) for k, v in pk.items() if str(v).isdigit()}
                if one:
                    plate_picks[str(int(pn))] = one
        qty = _qty(plan.get("qty", (d["plans"].get(did) or {}).get("qty", 1)))
        d["plans"][did] = {"instance_id": iid, "plates": plates, "picks": picks, "plate_picks": plate_picks, "qty": qty}
    await _save(d)
    return d["plans"].get(did) or {}


def _qty(v) -> int:
    try:
        return max(1, min(99, int(v)))
    except (TypeError, ValueError):
        return 1


async def set_order(ids: list) -> list:
    """Ordre de priorite de la file (les modeles absents de la liste passent en tete)."""
    d = await _load()
    seen, order = set(), []
    for i in ids or []:
        i = str(i)
        if i.isdigit() and i not in seen:
            seen.add(i); order.append(i)
    d["order"] = order[:2000]
    await _save(d)
    return d["order"]


async def set_qty(design_id: str, qty) -> dict:
    """Nombre d'exemplaires d'un modele (sans toucher au reste du plan)."""
    did = str(design_id or "").strip()
    if not did.isdigit():
        raise QueueError("Modèle inconnu")
    d = await _load()
    pl = d["plans"].setdefault(did, {"instance_id": None, "plates": None, "picks": {}})
    pl["qty"] = _qty(qty)
    await _save(d)
    return pl


def fkey(t, c) -> str:
    return f"{str(t or '').upper()}|{str(c or '').upper()}"


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


async def _collection_designs(cid: str, fresh: bool = False) -> list:
    from . import makerworld_account as A
    out, off = [], 0
    while off < MAX_PER_COLLECTION:
        p = await A.collection_designs(cid, off, 60, fresh)
        got = p.get("items") or []
        out += got
        if not got or not p.get("has_more"):
            break
        off += 60
    return out


async def _ams_stock() -> dict:
    """Ce qui est charge dans l'AMS : filament -> grammes restants des bobines
    inserees (une bobine seulement posee pour le sechage ne compte pas)."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Spool
    ids = set()
    try:
        from ..core.mqtt import get_state
        for a in get_state().ams_list or []:
            for t in a.trays or []:
                if getattr(t, "spool_id", None):
                    ids.add(int(t.spool_id))
    except Exception:
        logger.exception("[FILE] lecture de l'AMS")
    if not ids:
        return {}
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Spool.id, Spool.filament_id, Spool.remaining_weight_g)
                                 .where(Spool.id.in_(ids)))).all()
    out = {}
    for sid, fid, rem in rows:
        e = out.setdefault(int(fid), {"g": 0.0, "spools": []})
        e["g"] += _num(rem)
        e["spools"].append(int(sid))
    return out


async def _printed_plates(dids) -> dict:
    """Mes impressions reussies de ces modeles, une entree par print : {design_id: [{"prof", "plates", "g", "copies"}]}
    (profil « » : pas connu ; plates : les plateaux qu'il couvre, un print qui en regroupe plusieurs comptant pour
    chacun ; g : le filament qu'il a pris ; copies : les exemplaires de ses plateaux dits a la main, sinon None)."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    dids = [str(d) for d in dids if d]
    if not dids:
        return {}
    from .makerworld import plate_keys
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.design_id, Print.plate_id, Print.mw_profile_id, Print.mw_plates,
                                        Print.total_weight_g, Print.number_of_items, Print.id).where(
            Print.design_id.in_(dids), Print.status.in_(("SUCCESS", "PARTIAL"))))).all()
    out = {}
    for did, plate, prof, manual, g, items, pid in rows:
        # les plateaux designes a la main (regroupes, renumerotes) passent avant le numero du fichier,
        # comme sur la fiche (avant le 24/10/2026, « A faire » ne lisait que le numero)
        by = {}
        for k in plate_keys(plate, prof, manual):
            pr, _, num = k.partition(":")
            try:
                by.setdefault(str(pr or "").strip(), []).append(int(str(num or "1").strip() or 1))
            except ValueError:
                continue
        copies = plate_copies(manual)
        for pr, ns in by.items():
            out.setdefault(str(did), []).append({"prof": pr, "plates": ns, "g": _num(g), "copies": copies,
                                                 "items": int(items or 1), "id": pid})
    return out


def plate_copies(manual) -> int | None:
    """Les exemplaires de ses plateaux qu'un print a donnes, dits a la main (choix des plateaux sur sa fiche) ; 0 : il
    ne compte pas (relance, rate, en double)."""
    try:
        m = json.loads(manual) if manual else None
        c = int(m["copies"]) if isinstance(m, dict) and m.get("copies") is not None else None
    except (ValueError, TypeError):
        return None
    return c if c is not None and 0 <= c <= 50 else None


def plate_pieces(design_id, prof: dict | None) -> dict:
    """Les pieces de chaque plateau du 3MF d'origine de ce profil, quand on l'a : {plateau: nombre d'objets poses}."""
    from . import mw_source
    from .mw_3d import _settings
    import zipfile
    iid = None
    for k in ((prof or {}).get("profile_id"), (prof or {}).get("instance_id")):
        iid = iid or (mw_source.known(design_id, str(k)) if k else None)
    if not iid:
        return {}
    path = mw_source.path_of(iid)
    try:
        key = (str(path), path.stat().st_mtime)
    except OSError:
        return {}
    if key not in _PIECES:
        try:
            with zipfile.ZipFile(path) as z:
                plates, _ = _settings(z)
            _PIECES[key] = {n: len(inst) for n, _name, inst in plates if inst}
        except Exception:
            _PIECES[key] = {}
        if len(_PIECES) > 500:
            _PIECES.pop(next(iter(_PIECES)))
    return _PIECES[key]


_PIECES: dict = {}


def copies_of(e: dict, plate_g: dict, pieces: dict) -> tuple:
    """Les exemplaires de ses plateaux qu'un print a donnes, et comment on le sait (05/11/2026) :
      - dits a la main (choix des plateaux sur sa fiche) ;
      - sinon ses elements declares sur les pieces de ses plateaux d'origine, quand il en declare plus d'un et qu'on
        connait les pieces (12 elements d'un plateau de 6 porte-cles : 2 exemplaires ; 6 : un seul) ;
      - sinon au poids : le filament pris sur le poids des plateaux MakerWorld (un plateau duplique pese le double) ;
      - sinon un."""
    if e.get("copies") is not None:
        return e["copies"], "main"
    ps = e["plates"]
    pc = sum(pieces.get(n) or 0 for n in ps)
    if (e.get("items") or 1) > 1 and pc and all(pieces.get(n) for n in ps) and e["items"] >= pc:
        return max(1, min(50, round(e["items"] / pc))), "elements"
    g = guess_copies(e.get("g"), ps, plate_g)
    w = all(plate_g.get(n) for n in ps) and e.get("g")
    return g, "poids" if w else "defaut"


def guess_copies(g: float, plates: list, plate_g: dict) -> int:
    """Les exemplaires devines au poids (05/11/2026) : le filament pris par le print, sur le poids de ses plateaux
    MakerWorld. Un plateau duplique deux fois sur le plateau d'impression pese le double ; un plateau de 6 porte-cles
    d'origine pese ce qu'il pese. Au moins un, et un seul quand le poids manque."""
    w = sum(plate_g.get(n) or 0 for n in plates)
    if not g or not w or any(not plate_g.get(n) for n in plates):
        return 1
    return max(1, min(50, int(g / w + 0.35)))         # a partir de 1,65x : 2 (un print partiel ou une pesee juste reste a 1)


def _printed_of(entries: list, prof: dict | None, all_ids: set, plate_g: dict | None = None, pieces: dict | None = None) -> dict:
    """Les plateaux imprimes du profil retenu (05/11/2026 : le plateau 2 d'un autre profil n'est pas le meme) :
    ceux de ce profil (son numero d'instance ou de profil) et ceux dont le profil n'est pas connu. Si aucun print
    du modele ne porte un profil qu'on connait (numerotation inconnue), tous comptent, comme avant. Chaque print
    compte ses exemplaires : dits a la main, sinon devines au poids (plate_g : le poids de chaque plateau)."""
    mine = {str((prof or {}).get("instance_id") or ""), str((prof or {}).get("profile_id") or ""), ""} - {"None"}
    known = any(e["prof"] in all_ids for e in entries if e["prof"])
    out = {}
    for e in entries:
        if known and e["prof"] not in mine:
            continue
        c = copies_of(e, plate_g or {}, pieces or {})[0]
        for n in e["plates"]:
            out[n] = out.get(n, 0) + c
    return out


async def print_copies(design_id: str) -> dict:
    """{print_id: {n, how, plates}} pour les prints reussis de ce modele : ce que la fiche montre et corrige."""
    from .makerworld import model_detail
    entries = (await _printed_plates([design_id])).get(str(design_id), [])
    if not entries:
        return {}
    m = await model_detail(str(design_id), stale_ok=True)
    profs = m.get("profiles") or []
    out = {}
    for e in entries:
        prof = next((p for p in profs if e["prof"] and e["prof"] in (str(p.get("instance_id")), str(p.get("profile_id")))), None) \
            or next((p for p in profs if p.get("main")), None) or (profs[0] if profs else None)
        plate_g = {pl.get("index"): _num(pl.get("weight_g")) or sum(_num(f.get("g")) for f in pl.get("filaments") or [])
                   for pl in (prof or {}).get("plates") or []}
        n, how = copies_of(e, plate_g, plate_pieces(design_id, prof))
        out[str(e["id"])] = {"n": n, "how": how, "plates": e["plates"], "profile": e["prof"] or None}
    # de quoi les nommer (le menu d'un plateau dans « A faire »)
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.id, Print.translated_name, Print.file_name, Print.print_date, Print.status)
                                 .where(Print.id.in_([int(k) for k in out])))).all()
    for pid, tn, fn, at, st in rows:
        out[str(pid)].update(name=tn or fn, date=at.isoformat() if at else None, status=st)
    return out


async def _printing_plates() -> dict:
    """Plateaux en cours d'impression (impression ouverte dans l'historique) :
    {design_id: {numeros de plateau}}. Lu a chaque appel : ca bouge vite."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .makerworld import plate_keys
    try:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(Print.design_id, Print.plate_id, Print.mw_profile_id, Print.mw_plates).where(
                Print.status == "IN_PROGRESS", Print.design_id.isnot(None)))).all()
    except Exception:
        return {}
    out = {}
    for did, plate, prof, manual in rows:
        for k in plate_keys(plate, prof, manual):
            try:
                out.setdefault(str(did), set()).add(int(str(k.split(":", 1)[1] or "1").strip() or 1))
            except ValueError:
                continue
    return out


async def _prices(fids) -> dict:
    """Prix au gramme des filaments (prix de la bobine / poids nominal)."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament
    if not fids:
        return {}
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Filament.id, Filament.price, Filament.filament_weight_g)
                                 .where(Filament.id.in_(list(fids))))).all()
    return {i: (p / w if p and w else None) for i, p, w in rows}


async def queue(fresh: bool = False, until: str | None = None, pick: list | None = None) -> dict:
    """File complete ; avec `until`, les stats (totaux, filaments, manques) ne
    portent que sur les modeles jusqu'a celui-la inclus, dans l'ordre de priorite."""
    stale = False
    if fresh or _CACHE[1] is None or time.time() - _CACHE[0] >= TTL:
        if not fresh and _CACHE[1] is None and not _INVALID[0]:
            snap = await asyncio.to_thread(_snap_get)
            if snap:
                _CACHE[:] = [0.0, snap]
        if fresh or _INVALID[0] or _CACHE[1] is None:
            if _TASK[0] and not _TASK[0].done() and not fresh:
                await _TASK[0]                       # un calcul tourne deja : on l'attend
            else:
                await _recompute(fresh)
        else:
            _refresh_bg()                            # ancien resultat tout de suite, relu en fond
            stale = True
    raw = _CACHE[1]
    # En cours d'impression (etat MQTT en direct, ou impression ouverte dans l'historique) : en tete.
    live = _live_print()
    on_plates = await _printing_plates()
    models = []
    for r in raw["models"]:
        on = live if live and live["design_id"] == r["design_id"] else None
        # « en cours » se lit a chaque appel (etat en direct, impression ouverte dans l'historique),
        # jamais dans le calcul en cache : une impression finie depuis restait « en cours »
        printing = bool(on or str(r["design_id"]) in on_plates)
        pp = on_plates.get(str(r["design_id"])) if printing else None
        if pp and r.get("plates"):
            r = {**r, "plates": [{**p, "printing": p.get("index") in pp} for p in r["plates"]]}
        models.append({**r, "printing": printing,
                       "progress": on["progress"] if on else None, "remaining_min": on["remaining_min"] if on else None})
    models.sort(key=lambda r: not r["printing"])
    ids = [r["design_id"] for r in models]
    upto = models
    if until and str(until) in ids:
        upto = models[:ids.index(str(until)) + 1]
    chosen = {str(i) for i in pick or []} & set(ids)
    if chosen:                                       # modeles choisis un a un (prioritaire sur « jusqu'ici »)
        upto = [r for r in models if r["design_id"] in chosen]
    out = {"collections": raw["collections"],
           "models": [{k: v for k, v in r.items() if not k.startswith("_")} for r in models],
           **_aggregate(upto, raw["stock_of"])}
    if chosen:
        out["picked"] = {"ids": [r["design_id"] for r in upto], "count": len(upto)}
    elif upto is not models:
        out["until"] = {"design_id": str(until), "count": len(upto)}
    if stale:
        out["stale"] = True
    return out


def _live_print():
    try:
        from ..core.mqtt import get_state
        st = get_state()
        if st and st.design_id and str(st.status or "").upper() in ("RUNNING", "PAUSE", "PREPARE", "SLICING"):
            return {"design_id": str(st.design_id), "progress": round(float(st.progress or 0)),
                    "remaining_min": int(st.remaining_minutes or 0)}
    except Exception:
        pass
    return None


def _aggregate(models: list, stock_of: dict) -> dict:
    need, unmatched = {}, {}
    for r in models:
        for fid, g in r["_need"].items():
            t = need.setdefault(fid, {"need_g": 0.0, "models": 0})
            t["need_g"] += g
            t["models"] += 1
        for k, x in r["_miss"].items():
            u = unmatched.setdefault(k, {"type": x["type"], "color": x["color"], "need_g": 0.0, "models": 0})
            u["need_g"] += x["g"]
            u["models"] += 1
    filaments = []
    for fid, t in need.items():
        st = stock_of[fid]
        filaments.append({**st, "need_g": round(t["need_g"], 1), "models": t["models"],
                          "missing_g": round(max(0.0, t["need_g"] - st["stock_g"]), 1)})
    filaments.sort(key=lambda f: (-f["missing_g"], -f["need_g"]))
    for u in unmatched.values():
        u["need_g"] = round(u["need_g"], 1)
    return {
        "filaments": filaments,
        "unmatched": sorted(unmatched.values(), key=lambda u: -u["need_g"]),
        "totals": {"models": len(models), "seconds": sum(r["seconds"] or 0 for r in models),
                   "weight_g": round(sum(r["weight_g"] for r in models), 1),
                   "cost": round(sum(r["_cost"] for r in models), 2),
                   "ams": sum(1 for r in models if r["status"] == "ams"),
                   "partial": sum(1 for r in models if r["status"] == "partial"),
                   "stock": sum(1 for r in models if r["status"] == "stock"),
                   "short": sum(1 for r in models if r["status"] == "short"),
                   "printed": sum(1 for r in models if r["printed"])},
    }


async def _compute(fresh: bool = False) -> dict:
    """fresh (« Relire maintenant », 02/11/2026) : les collections relues chez MakerWorld, pas dans le cache de 2 h ;
    un modele ajoute sur le site apparait tout de suite."""
    from . import makerworld_account as A
    from .makerworld import model_detail
    cfg = await _load()
    colls = {c["id"]: c["title"] for c in (await A.collections())["collections"]}
    chosen = [c for c in cfg["collections"] if c in colls]
    designs, where = {}, {}
    for cid in chosen:
        for x in await _collection_designs(cid, fresh):
            designs.setdefault(x["design_id"], x)
            where.setdefault(x["design_id"], []).append(colls[cid])

    sem = asyncio.Semaphore(4)

    async def detail(did):
        async with sem:
            try:
                return did, await model_detail(did, stale_ok=True)   # fiche sur disque, relue en fond
            except Exception as e:
                return did, {"error": f"{type(e).__name__}"}
    details = dict(await asyncio.gather(*(detail(d) for d in designs)))
    ams = await _ams_stock()
    done_plates = await _printed_plates(list(designs))

    models, stock_of = [], {}
    stock_all = None                                  # tout le stock, lu seulement si un choix sort des propositions
    for did, base in designs.items():
        m = details.get(did) or {}
        plan = cfg["plans"].get(did)
        qty = _qty((plan or {}).get("qty", 1))
        # un plan qui ne porte qu'une quantite ne compte pas comme « retenu »
        chosen_plan = bool(plan and plan.get("instance_id"))
        profiles = m.get("profiles") or []
        prof = next((p for p in profiles if plan and p.get("instance_id") == plan.get("instance_id")), None) \
            or next((p for p in profiles if p.get("main")), None) or (profiles[0] if profiles else None)
        row = {"design_id": did, "title": base.get("title"), "title_fr": base.get("title_fr") or m.get("title_fr"),
               "cover_url": base.get("cover_url") or m.get("cover_url"), "collections": where.get(did, []),
               "printed": m.get("printed") or 0, "planned": chosen_plan, "qty": qty, "error": m.get("error"),
               "plates_ready": [], "plates_count": 0, "_need": {}, "_miss": {}, "_inprog": m.get("in_progress") or 0,
               "profile": None, "seconds": None, "weight_g": 0.0, "filaments": [], "status": "unknown",
               "default_instance": next((p.get("instance_id") for p in profiles if p.get("default")), None)}
        if prof:
            sel = plan.get("plates") if plan and plan.get("instance_id") == prof.get("instance_id") else None
            plates = [pl for pl in prof.get("plates") or [] if sel is None or pl.get("index") in sel]
            items = (m.get("stock") or {}).get(prof.get("instance_id")) or []
            picks = (plan or {}).get("picks") or {}
            row["profile"] = {"instance_id": prof.get("instance_id"), "title": prof.get("title"),
                              "printer": prof.get("printer"), "plates": len(plates), "plates_total": len(prof.get("plates") or [])}
            one = sum(_num(pl.get("seconds")) for pl in plates) if sel is not None else _num(prof.get("seconds"))
            row["seconds"] = one * qty if one else None
            plate_picks = (plan or {}).get("plate_picks") or {}
            ok_stock = ok_ams = True
            one_of = {}                                   # filament retenu -> grammes pour UN exemplaire
            missing = False                               # une couleur sans filament en stock
            by_key = {fkey(it.get("type"), it.get("color")): it for it in items}
            # Ce qu'il faut imprimer : plateau par plateau quand les plateaux disent leurs
            # filaments (chacun peut avoir son propre choix), sinon le total du profil.
            per_plate = bool(plates) and all(pl.get("filaments") for pl in plates)
            units = ([(pl.get("index"), fkey(f.get("type"), f.get("color")), _num(f.get("g")))
                      for pl in plates for f in pl.get("filaments") or [] if _num(f.get("g")) > 0]
                     if per_plate else
                     [(None, fkey(it.get("type"), it.get("color")), _num(it.get("g"))) for it in items])
            resolved = {}

            async def resolve(k, want):
                nonlocal stock_all
                if (k, want) in resolved:
                    return resolved[(k, want)]
                it = by_key.get(k) or {}
                cands = (it.get("matches") or []) + (it.get("others") or [])
                pick = next((c for c in cands if c["filament_id"] == want), None) if want else None
                if not pick and want:
                    if stock_all is None:
                        from .mw_stock import stock_rows
                        stock_all = await stock_rows()
                    from .mw_stock import search as stock_search
                    pick = (stock_search(stock_all, it.get("type"), it.get("color"), ids=[want]) or [None])[0]
                pick = pick or (it.get("matches") or [None])[0]
                resolved[(k, want)] = pick
                return pick

            groups = {}                                   # (cle, filament) -> grammes (tous exemplaires)
            fid_at = {}                                   # (plateau, cle) -> filament retenu
            for pn, k, g in units:
                if k not in by_key:
                    continue
                want = (plate_picks.get(str(pn)) or {}).get(k) if pn is not None else None
                pick = await resolve(k, want or picks.get(k))
                fid = pick["filament_id"] if pick else None
                fid_at[(pn, k)] = fid
                groups[(k, fid)] = groups.get((k, fid), 0.0) + g * qty
            for (k, fid), g in groups.items():
                it = by_key[k]
                pick = next((p for p in resolved.values() if p and p["filament_id"] == fid), None) if fid else None
                row["weight_g"] += g
                fil = None
                if pick:
                    one_of[fid] = one_of.get(fid, 0) + g / qty
                    stock_of[fid] = {"filament_id": fid, "name": pick["name"], "brand": pick.get("brand"),
                                     "material": pick.get("material"), "color": pick.get("color"),
                                     "colors_array": pick.get("colors_array"), "multicolor_type": pick.get("multicolor_type"),
                                     "stock_g": pick.get("remaining_g") or 0, "ams_g": round(ams.get(fid, {}).get("g", 0))}
                    row["_need"][fid] = row["_need"].get(fid, 0.0) + g
                    fil = {"filament_id": fid, "name": pick["name"], "color": pick.get("color"),
                           "colors_array": pick.get("colors_array"), "multicolor_type": pick.get("multicolor_type"),
                           "level": pick.get("level"), "other_material": pick.get("other_material"),
                           "in_ams": fid in ams}
                else:
                    missing = True
                    x = row["_miss"].setdefault(k, {"type": it.get("type"), "color": it.get("color"), "g": 0.0})
                    x["g"] += g
                row["filaments"].append({"type": it.get("type"), "color": it.get("color"), "g": round(g, 1), "chosen": fil})
            # assez de stock / d'AMS : par filament retenu, toutes couleurs confondues
            for fid, n in row["_need"].items():
                pick = stock_of[fid]
                ok_stock &= (pick["stock_g"] or 0) >= n
                ok_ams &= ams.get(fid, {}).get("g", 0) >= n
            for x in row["filaments"]:
                c = x["chosen"]
                if c:
                    c["enough_stock"] = (stock_of[c["filament_id"]]["stock_g"] or 0) >= row["_need"][c["filament_id"]]
                    c["enough_ams"] = ams.get(c["filament_id"], {}).get("g", 0) >= row["_need"][c["filament_id"]]
            if missing:
                ok_stock = ok_ams = False
            # Plateau par plateau : un exemplaire du plateau est-il faisable avec l'AMS ?
            ready = []
            for pl in plates:
                fl = [f for f in pl.get("filaments") or [] if _num(f.get("g")) > 0]
                need1 = {}
                ok = bool(fl)
                for f in fl:
                    k = fkey(f.get("type"), f.get("color"))
                    fid = fid_at.get((pl.get("index") if per_plate else None, k))
                    if fid is None:
                        ok = False
                        break
                    need1[fid] = need1.get(fid, 0) + _num(f.get("g"))
                if ok and all(ams.get(fid, {}).get("g", 0) >= g for fid, g in need1.items()):
                    ready.append(pl.get("index"))
            row["plates_ready"] = ready
            row["plates_count"] = len(plates)
            # chaque plateau : faisable tout de suite avec l'AMS ? deja imprime (par moi) ?
            mine = _printed_of(done_plates.get(str(did), []), prof,
                               {str(x.get(i) or "") for x in profiles for i in ("instance_id", "profile_id")} - {""},
                               {pl.get("index"): _num(pl.get("weight_g")) or sum(_num(f.get("g")) for f in pl.get("filaments") or [])
                                for pl in prof.get("plates") or []}, plate_pieces(did, prof))
            row["plates"] = [{"index": pl.get("index"), "name": pl.get("name") or "", "thumb": pl.get("thumb"),
                              "ready": pl.get("index") in ready, "printed": mine.get(pl.get("index"), 0),
                              "seconds": _num(pl.get("seconds")) or None,
                              "weight_g": round(sum(_num(f.get("g")) for f in pl.get("filaments") or []), 1) or None,
                              # ses filaments retenus (05/11/2026) : le planning y lit ce qu'il faut charger et enchaine
                              # les plateaux de memes couleurs
                              "fils": [{"filament_id": fid_at.get((pl.get("index") if per_plate else None, fkey(f.get("type"), f.get("color")))),
                                        "type": f.get("type"), "color": f.get("color"), "g": round(_num(f.get("g")), 1)}
                                       for f in pl.get("filaments") or [] if _num(f.get("g")) > 0]}
                             for pl in plates]
            # faisable tout de suite avec ce qui est charge : les plateaux prets (ceux pas encore
            # imprimes d'abord), leurs heures et leurs grammes -- pour trier « A faire » par ce qu'on peut lancer
            now = [x for x in row["plates"] if x["ready"] and not x["printed"]] or [x for x in row["plates"] if x["ready"]]
            row["ready_now"] = {"plates": len(now), "seconds": int(sum(x["seconds"] or 0 for x in now)),
                                "weight_g": round(sum(x["weight_g"] or 0 for x in now), 1)}
            row["stock_ok"] = bool(ok_stock and items)    # tout le modele faisable avec le stock
            # Exemplaires complets faisables tout de suite avec l'AMS (sur la quantite voulue).
            row["copies_ready"] = (min(qty, min(int(ams.get(f, {}).get("g", 0) // n) for f, n in one_of.items() if n > 0))
                                   if one_of and not missing else 0)
            row["status"] = ("ams" if ok_ams and items else "partial" if ready else
                             "stock" if ok_stock and items else "short" if items else "unknown")
        row["weight_g"] = round(row["weight_g"], 1)
        models.append(row)

    rank = {did: i for i, did in enumerate(cfg.get("order") or [])}
    models.sort(key=lambda r: (r["design_id"] in rank, rank.get(r["design_id"], 0)))
    for r in models:
        r["new"] = r["design_id"] not in rank
    prices = await _prices(stock_of.keys())
    for r in models:
        c = 0.0
        known = True
        for f in r["filaments"]:
            pg = prices.get((f.get("chosen") or {}).get("filament_id"))
            if pg is None:
                known = False
            else:
                c += pg * f["g"]
        r["cost"] = round(c, 2) if known and r["filaments"] else None
        r["_cost"] = c
    return {"collections": [{"id": c, "title": colls[c]} for c in chosen], "models": models, "stock_of": stock_of}
