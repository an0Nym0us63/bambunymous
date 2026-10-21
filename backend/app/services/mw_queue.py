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


async def _recompute():
    out = await _compute()
    _CACHE[:] = [time.time(), out]
    _INVALID[0] = False
    await asyncio.to_thread(_snap_put, out)
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
    await asyncio.sleep(30)
    try:
        if (await _load())["collections"]:
            snap = await asyncio.to_thread(_snap_get)
            if snap and _CACHE[1] is None:
                _CACHE[:] = [0.0, snap]
                _INVALID[0] = False
            if _CACHE[0] == 0.0:
                await _recompute()
    except Exception:
        logger.exception("[QUEUE] calcul au demarrage")


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
            d["plans"][did] = {"instance_id": None, "plates": None, "picks": {}, "qty": q}
        else:
            d["plans"].pop(did, None)
    else:
        iid = str((plan or {}).get("instance_id") or "")
        if not iid.isdigit():
            raise QueueError("Profil inconnu")
        plates = plan.get("plates")
        plates = [int(p) for p in plates if str(p).isdigit()] if isinstance(plates, list) else None
        picks = {str(k)[:40]: int(v) for k, v in (plan.get("picks") or {}).items() if str(v).isdigit()}
        qty = _qty(plan.get("qty", (d["plans"].get(did) or {}).get("qty", 1)))
        d["plans"][did] = {"instance_id": iid, "plates": plates, "picks": picks, "qty": qty}
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


async def _collection_designs(cid: str) -> list:
    from . import makerworld_account as A
    out, off = [], 0
    while off < MAX_PER_COLLECTION:
        p = await A.collection_designs(cid, off, 60)
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
    """Mes impressions reussies de ces modeles, plateau par plateau :
    {design_id: {numero de plateau: nombre}}."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    dids = [str(d) for d in dids if d]
    if not dids:
        return {}
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.design_id, Print.plate_id).where(
            Print.design_id.in_(dids), Print.status.in_(("SUCCESS", "PARTIAL"))))).all()
    out = {}
    for did, plate in rows:
        try:
            n = int(str(plate or "1").strip() or 1)
        except ValueError:
            continue
        per = out.setdefault(str(did), {})
        per[n] = per.get(n, 0) + 1
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
                await _recompute()
        else:
            _refresh_bg()                            # ancien resultat tout de suite, relu en fond
            stale = True
    raw = _CACHE[1]
    # En cours d'impression (etat MQTT en direct, ou impression ouverte dans l'historique) : en tete.
    live = _live_print()
    models = []
    for r in raw["models"]:
        on = live if live and live["design_id"] == r["design_id"] else None
        models.append({**r, "printing": bool(on or r.get("_inprog")),
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


async def _compute() -> dict:
    from . import makerworld_account as A
    from .makerworld import model_detail
    cfg = await _load()
    colls = {c["id"]: c["title"] for c in (await A.collections())["collections"]}
    chosen = [c for c in cfg["collections"] if c in colls]
    designs, where = {}, {}
    for cid in chosen:
        for x in await _collection_designs(cid):
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
               "profile": None, "seconds": None, "weight_g": 0.0, "filaments": [], "status": "unknown"}
        if prof:
            sel = plan.get("plates") if plan and plan.get("instance_id") == prof.get("instance_id") else None
            plates = [pl for pl in prof.get("plates") or [] if sel is None or pl.get("index") in sel]
            items = (m.get("stock") or {}).get(prof.get("instance_id")) or []
            picks = (plan or {}).get("picks") or {}
            row["profile"] = {"instance_id": prof.get("instance_id"), "title": prof.get("title"),
                              "printer": prof.get("printer"), "plates": len(plates), "plates_total": len(prof.get("plates") or [])}
            one = sum(_num(pl.get("seconds")) for pl in plates) if sel is not None else _num(prof.get("seconds"))
            row["seconds"] = one * qty if one else None
            ok_stock = ok_ams = True
            fid_of = {}                                   # cle TYPE|COULEUR -> filament retenu
            one_of = {}                                   # filament retenu -> grammes pour UN exemplaire
            missing = False                               # une couleur sans filament en stock
            for it in items:
                k = fkey(it.get("type"), it.get("color"))
                if sel is None:
                    g = _num(it.get("g"))
                else:
                    g = sum(_num(f.get("g")) for pl in plates for f in pl.get("filaments") or [] if fkey(f.get("type"), f.get("color")) == k)
                if g <= 0:
                    continue
                g *= qty
                cands = (it.get("matches") or []) + (it.get("others") or [])
                pick = next((c for c in cands if c["filament_id"] == picks.get(k)), None)
                if not pick and picks.get(k):
                    if stock_all is None:
                        from .mw_stock import stock_rows
                        stock_all = await stock_rows()
                    from .mw_stock import search as stock_search
                    pick = (stock_search(stock_all, it.get("type"), it.get("color"), ids=[picks[k]]) or [None])[0]
                pick = pick or (it.get("matches") or [None])[0]
                row["weight_g"] += g
                fil = None
                if pick:
                    fid = pick["filament_id"]
                    fid_of[k] = fid
                    one_of[fid] = one_of.get(fid, 0) + g / qty
                    stock_of[fid] = {"filament_id": fid, "name": pick["name"], "brand": pick.get("brand"),
                                     "material": pick.get("material"), "color": pick.get("color"),
                                     "colors_array": pick.get("colors_array"), "multicolor_type": pick.get("multicolor_type"),
                                     "stock_g": pick.get("remaining_g") or 0, "ams_g": round(ams.get(fid, {}).get("g", 0))}
                    row["_need"][fid] = row["_need"].get(fid, 0.0) + g
                    enough_stock = (pick.get("remaining_g") or 0) >= g
                    enough_ams = ams.get(fid, {}).get("g", 0) >= g
                    ok_stock &= enough_stock
                    ok_ams &= enough_ams
                    fil = {"filament_id": fid, "name": pick["name"], "color": pick.get("color"),
                           "colors_array": pick.get("colors_array"), "multicolor_type": pick.get("multicolor_type"),
                           "level": pick.get("level"), "other_material": pick.get("other_material"),
                           "in_ams": fid in ams, "enough_stock": enough_stock, "enough_ams": enough_ams}
                else:
                    ok_stock = ok_ams = False
                    missing = True
                    x = row["_miss"].setdefault(k, {"type": it.get("type"), "color": it.get("color"), "g": 0.0})
                    x["g"] += g
                row["filaments"].append({"type": it.get("type"), "color": it.get("color"), "g": round(g, 1), "chosen": fil})
            # Plateau par plateau : un exemplaire du plateau est-il faisable avec l'AMS ?
            ready = []
            for pl in plates:
                fl = [f for f in pl.get("filaments") or [] if _num(f.get("g")) > 0]
                if fl and all(fkey(f.get("type"), f.get("color")) in fid_of
                              and ams.get(fid_of[fkey(f.get("type"), f.get("color"))], {}).get("g", 0) >= _num(f.get("g"))
                              for f in fl):
                    ready.append(pl.get("index"))
            row["plates_ready"] = ready
            row["plates_count"] = len(plates)
            # chaque plateau : faisable tout de suite avec l'AMS ? deja imprime (par moi) ?
            mine = done_plates.get(str(did), {})
            row["plates"] = [{"index": pl.get("index"), "name": pl.get("name") or "",
                              "ready": pl.get("index") in ready, "printed": mine.get(pl.get("index"), 0)}
                             for pl in plates]
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
