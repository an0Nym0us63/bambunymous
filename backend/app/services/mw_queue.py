"""
File d'attente d'impression : les modeles d'une ou plusieurs de mes
collections MakerWorld (« A imprimer »…), avec, pour chacun, le profil et les
filaments que je compte utiliser, et les totaux.

Reglage MW_QUEUE (JSON) :
  {"collections": ["30919606", ...],
   "plans": {"<design_id>": {"instance_id": "1452154", "plates": [1, 3] | null,
                             "picks": {"PLA|#646941": 12, ...}, "qty": 2}}}
qty : nombre d'exemplaires voulus (temps, filament, cout et stock multiplies).
"since" (08/11/2026) : {"<cle de ligne>": "2026-11-08T14:02:00"} : « repartir a zero » ; pour cette ligne, seules les
impressions faites depuis cette date comptent comme faites (un modele deja imprime, remis dans la file pour le refaire).
Le passe n'est pas perdu : chaque plateau garde aussi son total (printed_all). "" : explicitement tout le passe.
"added" (08/11/2026) : {"<design_id>": date} : quand un modele est apparu dans la file ; sans « since » pour la ligne, ses
impressions comptent a partir de la (un modele deja imprime qu'on y remet, c'est pour le refaire). "seen" : les modeles
deja vus dans la file (date d'arrivee : reprise du journal des succes pour ceux d'avant le 08/11/2026, ou None) ; "seen_colls" : les collections lues.
Plusieurs profils retenus (06/11/2026, un modele qui regroupe des objets differents : pêche, banane…) : le premier
reste sous "<design_id>", les suivants sous "<design_id>~<instance_id>". Chacun fait sa ligne dans « A faire » (son
design_id est cette cle, mw_id le modele) et ses plateaux dans le planning.
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
        p = _snap_path()
        # trop vieux (serveur arrete longtemps, ou instantane plus enregistre) : des plateaux faits depuis y seraient
        # encore a faire ; mieux vaut attendre le calcul frais
        if time.time() - p.stat().st_mtime > 12 * 3600:
            return None
        out = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
    # les filaments de chaque ligne (« _fids », un ensemble : les variantes de couleur s'y comparent) sont gardes en liste
    for r in (out or {}).get("models") or []:
        r["_fids"] = set(r.get("_fids") or ())
    return out


def _json_default(v):
    if isinstance(v, (set, frozenset)):
        return sorted(v, key=str)
    return str(v)


def unset_models() -> list:
    """(11/11/2026) Les modeles de « A faire » sans plan retenu (profil, plateaux, couleurs), pas encore faits : le
    planning les place avec le profil par defaut. D'apres le dernier calcul (en memoire, sinon sur disque)."""
    raw = _CACHE[1] or _snap_get() or {}
    out, seen = [], set()
    for r in raw.get("models") or []:
        mw = mw_of(r["design_id"])
        if r.get("planned") or r.get("done") or mw in seen:
            continue
        seen.add(mw)
        out.append({"design_id": mw, "title": r.get("title"), "title_fr": r.get("title_fr"), "cover_url": r.get("cover_url")})
    return out


def _snap_put(out):
    # (11/11/2026) l'ecriture echouait a chaque calcul depuis le 06/11 (« _fids », un ensemble, que JSON n'ecrit pas) :
    # au redemarrage, « A faire » et le calendrier repartaient d'un instantane du 06/11 (des plateaux faits depuis,
    # replanifies) jusqu'au calcul frais. Un ensemble s'ecrit en liste, toute autre valeur inconnue en texte, tout en
    # ASCII echappe ; l'ecriture passe par un fichier temporaire (jamais un instantane a moitie ecrit) ; la cause est dite
    p = _snap_path()
    try:
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(out, default=_json_default), encoding="utf-8")
        tmp.replace(p)
    except Exception as e:
        logger.exception("[QUEUE] instantane non garde : %s: %s", type(e).__name__, str(e)[:300])


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


def mw_of(rid) -> str:
    """Le modele MakerWorld d'une ligne de « A faire » (« 123~456 » : le profil 456 du modele 123)."""
    return str(rid or "").split("~")[0]


def _rid_ok(rid: str) -> bool:
    """« 123 », « 123~456 » (le profil 456), « 123~456~2 » (06/11/2026 : sa 2e variante de couleur)."""
    parts = str(rid or "").split("~")
    return 1 <= len(parts) <= 3 and all(x.isdigit() for x in parts)


def _plans_of(d: dict, did: str) -> list:
    """Les profils retenus d'un modele, le premier d'abord : [{key, instance_id, plates, picks, plate_picks, qty}]."""
    out = []
    p0 = d["plans"].get(did)
    if p0 and p0.get("instance_id"):
        out.append({"key": did, **p0})
    out += [{"key": k, **v} for k, v in d["plans"].items() if k.startswith(did + "~") and (v or {}).get("instance_id")]
    return out


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
    d.setdefault("since", {})
    return d


async def _save(d: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, KEY, json.dumps(d, ensure_ascii=False))
    _CACHE[:] = [0.0, None]
    _INVALID[0] = True


def collections_changed() -> None:
    """Un modele range dans (ou sorti d') une collection depuis l'appli (06/11/2026) : « A faire » se recalcule avant de
    repondre (les collections viennent d'etre relues), et le planning se verifie aussitot."""
    _INVALID[0] = True
    if _CACHE[1] is not None:
        _CACHE[0] = 0.0
    try:
        from . import planner
        planner.kick()
    except Exception:
        pass


def touch() -> None:
    """Une impression commence ou finit : ce qui est fait et faisable change. Le resultat en cache
    passe pour vieux, le prochain appel le rend tout de suite et le recalcule en fond."""
    if _CACHE[1] is not None:
        _CACHE[0] = 0.0
    try:
        from . import planner
        planner.kick()                                   # le planning se verifie tout de suite
    except Exception:
        pass


async def config() -> dict:
    d = await _load()
    return {"collections": d["collections"], "plans": d["plans"]}


async def set_collections(ids: list) -> dict:
    d = await _load()
    d["collections"] = [str(i) for i in (ids or []) if str(i).isdigit()][:20]
    await _save(d)
    return await config()


async def set_plan(design_id: str, plan, add: bool = False, which: str | None = None, key: str | None = None,
                   variant: bool = False) -> dict:
    """Retenir un profil (plan : profil, plateaux, filaments) ou l'oublier (plan None ; which : son instance, sinon le
    premier). Un profil deja retenu est mis a jour ; add (06/11/2026) en retient un de plus au lieu de remplacer le
    premier. Les variantes de couleur (06/11/2026) : variant cree une variante du profil (le meme, d'autres filaments,
    d'autres plateaux, sa quantite : « 123~456~2 ») ; key vise une ligne precise (mettre a jour, oublier une variante).
    Rend tous les profils retenus du modele."""
    did = str(design_id or "").strip()
    if not did.isdigit():
        raise QueueError("Modèle inconnu")
    d = await _load()
    mine = _plans_of(d, did)
    if key and key != did and not (key.startswith(did + "~") and _rid_ok(key)):
        raise QueueError("Ligne inconnue")
    if plan is None and key and key != did and key in d["plans"]:
        d["plans"].pop(key, None)                    # une variante (ou un profil en plus) : elle seule
        await _save(d)
        return {"plans": _plans_of(d, did)}
    if plan is None:
        gone = next((x for x in mine if which and str(x.get("instance_id")) == str(which)), None) or (mine[0] if mine else None)
        if gone and gone["key"] != did:
            d["plans"].pop(gone["key"], None)
        else:
            rest = [x for x in mine if x["key"] != did]
            if rest:
                # le suivant devient le premier
                nxt = rest[0]
                d["plans"].pop(nxt["key"], None)
                d["plans"][did] = {k: v for k, v in nxt.items() if k != "key"}
            else:
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
        same = next((x for x in mine if (x["key"] == key if key else str(x.get("instance_id")) == iid)), None)
        if variant:
            if not any(str(x.get("instance_id")) == iid for x in mine):
                raise QueueError("Retiens d'abord ce profil")
            n = 2
            while f"{did}~{iid}~{n}" in d["plans"]:
                n += 1
            same, key = None, f"{did}~{iid}~{n}"
        else:
            key = same["key"] if same else f"{did}~{iid}" if add and mine else did
        if len(mine) >= 30 and not same and key != did:   # variantes comprises
            raise QueueError("Trente profils retenus au plus")
        qty = _qty(plan.get("qty", (d["plans"].get(key) or {}).get("qty", 1)) if not variant else plan.get("qty", 1))
        d["plans"][key] = {"instance_id": iid, "plates": plates, "picks": picks, "plate_picks": plate_picks, "qty": qty}
    await _save(d)
    return {"plans": _plans_of(d, did)}


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
        if _rid_ok(i) and i not in seen:
            seen.add(i); order.append(i)
    d["order"] = order[:2000]
    await _save(d)
    return d["order"]


async def set_qty(design_id: str, qty) -> dict:
    """Nombre d'exemplaires d'un modele, ou d'un de ses profils retenus (« 123~456 »), sans toucher au reste du plan."""
    did = str(design_id or "").strip()
    if not _rid_ok(did):
        raise QueueError("Modèle inconnu")
    d = await _load()
    if "~" in did and did not in d["plans"]:
        raise QueueError("Profil qui n'est plus retenu")
    pl = d["plans"].setdefault(did, {"instance_id": None, "plates": None, "picks": {}})
    pl["qty"] = _qty(qty)
    await _save(d)
    return pl


async def set_since(design_id: str, on: bool) -> dict:
    """Repartir a zero (08/11/2026) : seules les impressions faites a partir de maintenant comptent pour cette ligne
    (un modele, ou un de ses profils retenus « 123~456 ») ; off : le passe recompte, comme avant."""
    from datetime import datetime
    did = str(design_id or "").strip()
    if not _rid_ok(did):
        raise QueueError("Modèle inconnu")
    d = await _load()
    if on:
        d["since"][did] = datetime.utcnow().replace(microsecond=0).isoformat()
    elif (d.get("added") or {}).get(did.split("~")[0]):
        d["since"][did] = ""                          # une arrivee datee : « tout le passe » doit se dire
    else:
        d["since"].pop(did, None)
    await _save(d)
    return {"since": since_of(d, did)}


def since_of(cfg: dict, rid: str) -> str | None:
    """A partir de quand les impressions comptent pour cette ligne : son « repartir a zero », sinon l'arrivee du modele
    dans la file ; None : tout le passe."""
    s = cfg.get("since") or {}
    if rid in s:
        return s[rid] or None
    return (cfg.get("added") or {}).get(str(rid).split("~")[0]) or None


async def _track_added(cfg: dict, designs: dict, where: dict, chosen: list) -> None:
    """Les modeles arrives dans la file (08/11/2026) : datés, pour que leurs impressions d'avant ne comptent plus. Ceux
    d'avant la premiere lecture, et ceux d'une collection qu'on vient de choisir, ne le sont pas (rien n'y a ete ajoute) ;
    un modele sorti de la file l'oublie (remis plus tard, il repart de ce moment)."""
    from datetime import datetime
    now = datetime.utcnow().replace(microsecond=0).isoformat()
    seen, changed = cfg.get("seen"), False
    old_colls = set(cfg.get("seen_colls") or [])
    if not isinstance(seen, dict):
        # la premiere fois : la date d'arrivee que le journal des succes a deja notee (queue_seen) ; celles de sa toute
        # premiere lecture (le meme quart d'heure que la plus ancienne) ne disent pas quand le modele est arrive
        qs = {}
        try:
            from .ach_log import _get as _alog
            qs = {str(k): str(v)[:19] for k, v in ((await _alog()).get("queue_seen") or {}).items() if v}
        except Exception:
            logger.exception("[FILE] journal des arrivees illisible")
        boot = min(qs.values()) if qs else None
        cfg["seen"], added = {}, cfg.setdefault("added", {})
        for d in designs:
            t = qs.get(str(d))
            late = bool(t and boot and (datetime.fromisoformat(t) - datetime.fromisoformat(boot)).total_seconds() > 900)
            cfg["seen"][d] = t if late else None
            if late:
                added[d] = t
        changed = True
    else:
        added = cfg.setdefault("added", {})
        for d in designs:
            if d in seen:
                continue
            fresh_coll = all(c not in old_colls for c in where.get(d, []))   # que des collections qu'on vient de choisir
            seen[d] = None if fresh_coll else now
            if not fresh_coll:
                added[d] = now
            changed = True
        for d in [x for x in seen if x not in designs]:
            seen.pop(d)
            added.pop(d, None)
            for k in [k for k in cfg.get("since") or {} if k == d or k.startswith(d + "~")]:
                cfg["since"].pop(k)
            changed = True
    if sorted(chosen) != sorted(old_colls):
        cfg["seen_colls"], changed = list(chosen), True
    if changed:
        # ecrit sans invalider le calcul en cours : il se sert deja de ces dates
        from ..db.session import AsyncSessionLocal
        from .settings_service import set_setting
        try:
            raw = await _load()
            for k in ("seen", "added", "since", "seen_colls"):
                if k in cfg:
                    raw[k] = cfg[k]
            async with AsyncSessionLocal() as db:
                await set_setting(db, KEY, json.dumps(raw, ensure_ascii=False))
        except Exception:
            logger.exception("[FILE] arrivees dans la file")


def _after(entries: list, since: str | None) -> list:
    """Les impressions faites depuis « since » (repartir a zero) ; sans date, toutes."""
    if not since:
        return entries
    return [e for e in entries if e.get("at") and e["at"] >= since]


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
    ids, port = set(), {}
    try:
        from ..core.mqtt import get_state
        for a in get_state().ams_list or []:
            for t in a.trays or []:
                if getattr(t, "spool_id", None):
                    ids.add(int(t.spool_id))
                    # l'entree du Filament Track Switch ou est branche son AMS (« A » / « B », vide sans aiguillage)
                    port[int(t.spool_id)] = getattr(a, "switch_port", "") or ""
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
        e.setdefault("port", port.get(int(sid), ""))
    return out


async def _group_copies(db, pids) -> dict:
    """Les exemplaires dits par le groupe (06/11/2026) : un groupe d'impressions porte son nombre d'elements (« ces 2
    impressions ont fait 3 boites ») ; il se repartit entre ses impressions du meme modele et du meme plateau, les plus
    anciennes d'abord (3 pour 2 : 2 puis 1). Seulement quand il dit plus d'un element. Rend {print_id: exemplaires}."""
    from sqlalchemy import select
    from ..models.print_history import Print, Group
    pids = [int(x) for x in pids if x]
    if not pids:
        return {}
    gids = {g for (g,) in (await db.execute(select(Print.group_id).where(Print.id.in_(pids), Print.group_id.isnot(None)))).all()}
    if not gids:
        return {}
    items = {gid: int(n) for gid, n in (await db.execute(select(Group.id, Group.number_of_items).where(Group.id.in_(gids)))).all()
             if n and int(n) > 1}
    if not items:
        return {}
    rows = (await db.execute(select(Print.id, Print.group_id, Print.design_id, Print.plate_id, Print.print_date).where(
        Print.group_id.in_(list(items)), Print.status.in_(("SUCCESS", "PARTIAL", "IN_PROGRESS"))))).all()
    by = {}
    for pid, gid, did, plate, at in rows:
        by.setdefault((gid, str(did), str(plate or "1")), []).append((at, pid))
    out = {}
    for (gid, _did, _pl), ps in by.items():
        ps.sort(key=lambda x: (x[0] is None, x[0], x[1]))
        base, rem = divmod(items[gid], len(ps))
        for i, (_at, pid) in enumerate(ps):
            out[pid] = base + (1 if i < rem else 0)
    return out


async def _printed_plates(dids, statuses: tuple = ("SUCCESS", "PARTIAL")) -> dict:
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
                                        Print.total_weight_g, Print.number_of_items, Print.id, Print.model_3mf,
                                        Print.print_date).where(
            Print.design_id.in_(dids), Print.status.in_(statuses)))).all()
        gcop = await _group_copies(db, [r[6] for r in rows])
        # les filaments de chaque impression (06/11/2026, variantes de couleur) : ceux de ses bobines
        from ..models.print_history import FilamentUsage
        from ..models.filament import Spool
        used, colors = {}, {}
        if rows:
            for pid_, fid_, col_ in (await db.execute(select(FilamentUsage.print_id, Spool.filament_id, FilamentUsage.color_hex)
                                                      .join(Spool, Spool.id == FilamentUsage.spool_id)
                                                      .where(FilamentUsage.print_id.in_([r[6] for r in rows])))).all():
                used.setdefault(pid_, set()).add(int(fid_))
                if col_:
                    colors.setdefault(pid_, {})[_hex6(col_)] = int(fid_)    # la couleur du 3MF -> le filament de la bobine
    out = {}
    for did, plate, prof, manual, g, items, pid, tmf, at in rows:
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
                                                 "gcopies": gcop.get(pid), "items": int(items or 1), "id": pid,
                                                 "fids": used.get(pid, set()), "variant": plate_variant(manual),
                                                 "tmf": tmf, "plate_id": plate, "fcol": colors.get(pid, {}),
                                                 "at": at.replace(microsecond=0).isoformat() if at else None})
    return out


def _hex6(c) -> str:
    """« #FF0000FF », « ff0000 » -> « FF0000 »."""
    return str(c or "").strip().lstrip("#").upper()[:6]


_OBJ_CACHE: dict = {}


def print_objects(tmf, plate) -> list:
    """Les objets poses sur le plateau imprime (06/11/2026), d'apres le 3MF tranche du print : pour chacun, les couleurs
    de ses filaments (celui de l'objet et ceux de ses parties). [] si le fichier manque ou ne se lit pas."""
    import re
    import zipfile
    from pathlib import Path
    import os
    if not tmf:
        return []
    p = Path(os.getenv("DATA_DIR", "/data")) / tmf
    try:
        key = (str(p), p.stat().st_mtime, str(plate or 1))
    except OSError:
        return []
    if key in _OBJ_CACHE:
        return _OBJ_CACHE[key]
    out = []
    try:
        with zipfile.ZipFile(p) as z:
            xml = z.read("Metadata/model_settings.config").decode("utf-8", "ignore")
            cols = json.loads(z.read("Metadata/project_settings.config")).get("filament_colour") or []
        exts = {}
        for oid, body in re.findall(r'<object id="(\d+)">(.*?)</object>', xml, re.S):
            exts[oid] = {int(x) for x in re.findall(r'key="extruder" value="(\d+)"', body) if int(x) > 0} or {1}
        n = str(plate or 1)
        for blk in re.findall(r"<plate>(.*?)</plate>", xml, re.S):
            if not re.search(rf'key="plater_id" value="{re.escape(n)}"', blk):
                continue
            for inst in re.findall(r"<model_instance>(.*?)</model_instance>", blk, re.S):
                m = re.search(r'key="object_id" value="(\d+)"', inst)
                if m:
                    out.append({_hex6(cols[e - 1]) for e in exts.get(m.group(1), {1}) if 0 < e <= len(cols)})
            break
    except (KeyError, ValueError, OSError, zipfile.BadZipFile):
        out = []
    if len(_OBJ_CACHE) > 1000:
        _OBJ_CACHE.clear()
    _OBJ_CACHE[key] = out
    return out


def plate_variant(manual) -> str | None:
    """La variante de couleur a laquelle un print a ete rattache a la main (06/11/2026), sinon None."""
    try:
        m = json.loads(manual) if manual else None
        v = m.get("variant") if isinstance(m, dict) else None
    except (ValueError, TypeError):
        return None
    return str(v) if v else None


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
      - dits a la main (choix des plateaux sur sa fiche, ou pastille d'un plateau dans « A faire ») ;
      - sinon au poids : le filament pris sur le poids des plateaux MakerWorld (un plateau duplique pese le double) ;
      - sinon, sans poids, ses elements declares sur les pieces de ses plateaux d'origine (12 elements d'un plateau
        de 6 porte-cles : 2 exemplaires) ;
      - sinon un.
    Le poids passe avant les elements (05/11/2026) : une piece du 3MF n'est pas un objet (une boite en deux parties
    fait 2 pieces ; ses 2 elements declares comptaient pour un seul exemplaire alors qu'il y en avait deux)."""
    if e.get("copies") is not None:
        return e["copies"], "main"
    if e.get("gcopies") is not None:                 # le nombre d'elements du groupe, reparti (06/11/2026)
        return e["gcopies"], "groupe"
    ps = e["plates"]
    items = e.get("items") or 1
    # bien moins lourd qu'un plateau MakerWorld, mais plusieurs elements (06/11/2026 : 4 patins de TPU, 0,96 g, sur un
    # plateau d'origine de 3 g) : le plateau a ete refait autrement, le poids ne dit plus rien ; on compte les elements
    w = sum(plate_g.get(n) or 0 for n in ps)
    light = bool(e.get("g") and w and e["g"] < 0.6 * w and items > 1)
    if all(plate_g.get(n) for n in ps) and e.get("g") and not light:
        return guess_copies(e.get("g"), ps, plate_g), "poids"
    pc = sum(pieces.get(n) or 0 for n in ps)
    if items > 1 and pc and all(pieces.get(n) for n in ps) and items >= pc:
        return max(1, min(50, round(items / pc))), "elements"
    if light:                                         # sans le 3MF d'origine : un objet par exemplaire
        return max(1, min(50, round(items / max(1, len(ps))))), "elements"
    return 1, "defaut"


def guess_copies(g: float, plates: list, plate_g: dict) -> int:
    """Les exemplaires devines au poids (05/11/2026) : le filament pris par le print, sur le poids de ses plateaux
    MakerWorld. Un plateau duplique deux fois sur le plateau d'impression pese le double ; un plateau de 6 porte-cles
    d'origine pese ce qu'il pese. Au moins un, et un seul quand le poids manque."""
    w = sum(plate_g.get(n) or 0 for n in plates)
    if not g or not w or any(not plate_g.get(n) for n in plates):
        return 1
    return max(1, min(50, int(g / w + 0.35)))         # a partir de 1,65x : 2 (un print partiel ou une pesee juste reste a 1)


def _printed_of(entries: list, prof: dict | None, all_ids: set, plate_g: dict | None = None, pieces: dict | None = None,
                strict: bool = False) -> dict:
    """Les plateaux imprimes du profil retenu (05/11/2026 : le plateau 2 d'un autre profil n'est pas le meme) :
    ceux de ce profil (son numero d'instance ou de profil) et ceux dont le profil n'est pas connu. Si aucun print
    du modele ne porte un profil qu'on connait (numerotation inconnue), tous comptent, comme avant. Chaque print
    compte ses exemplaires : dits a la main, sinon devines au poids (plate_g : le poids de chaque plateau).
    strict (06/11/2026, plusieurs profils retenus) : un print sans profil connu ne compte pour aucun (il compterait
    pour chacun)."""
    mine = {str((prof or {}).get("instance_id") or ""), str((prof or {}).get("profile_id") or ""), ""} - {"None"}
    if strict:
        mine.discard("")
    known = any(e["prof"] in all_ids for e in entries if e["prof"])
    out = {}
    for e in entries:
        if (known or strict) and e["prof"] not in mine:
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


_PPP: dict = {}


async def _resolve_profiles(did, entries: list) -> list:
    """Plusieurs profils retenus d'un meme modele (06/11/2026) : une impression au profil inconnu (fichier renvoye par
    Studio, qui le renumerote) ne comptait pour aucun ; elle prend le profil deduit comme sur sa carte (profil ouvert
    dans Studio depuis l'appli, couleurs, nom, image, poids). Deductions gardees 5 min."""
    try:
        from .makerworld import model_detail
        from .mw_plate_guess import profile_per_print
        m = await model_detail(str(did), stale_ok=True)
        known = {str(p.get(k) or "") for p in m.get("profiles") or [] for k in ("instance_id", "profile_id")} - {""}
        todo = [e for e in entries if e.get("id") and (not e.get("prof") or e["prof"] not in known)]
        if not todo or not known:
            return entries
        now = time.time()
        need = [e["id"] for e in todo if not (e["id"] in _PPP and now - _PPP[e["id"]][0] < 300)]
        if need:
            got = await profile_per_print(str(did), need)
            for pid in need:
                _PPP[pid] = (now, str((got.get(pid) or {}).get("profile") or ""))
        return [{**e, "prof": _PPP[e["id"]][1]} if e in todo and _PPP.get(e["id"], (0, ""))[1] else e for e in entries]
    except Exception:
        logger.exception("[QUEUE] profil deduit")
        return entries


async def _printing_plates() -> dict:
    """Plateaux en cours d'impression (impression ouverte dans l'historique) :
    {design_id: [{"prof", "plates", "g", "copies", "items"}]}, comme _printed_plates : l'impression en cours compte
    ses exemplaires (05/11/2026 : un plateau duplique en cours ne comptait que pour un). Lu a chaque appel."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .makerworld import plate_keys
    try:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(Print.design_id, Print.plate_id, Print.mw_profile_id, Print.mw_plates,
                                            Print.total_weight_g, Print.number_of_items, Print.id).where(
                Print.status == "IN_PROGRESS", Print.design_id.isnot(None)))).all()
            gcop = await _group_copies(db, [r[6] for r in rows])
    except Exception:
        return {}
    out = {}
    for did, plate, prof, manual, g, items, pid in rows:
        ns = []
        for k in plate_keys(plate, prof, manual):
            try:
                ns.append(int(str(k.split(":", 1)[1] or "1").strip() or 1))
            except ValueError:
                continue
        if ns:
            # son profil (06/11/2026) : avec plusieurs profils retenus, seule la ligne du sien est « en cours »
            pr = next((str(k).partition(":")[0].strip() for k in plate_keys(plate, prof, manual)), "")
            out.setdefault(str(did), []).append({"prof": pr, "plates": ns, "g": _num(g), "copies": plate_copies(manual),
                                                 "gcopies": gcop.get(pid), "items": int(items or 1), "id": pid})
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
    # les variantes de couleur d'un profil qui imprime (06/11/2026) : l'impression en cours repartie entre elles comme
    # les impressions faites (ses objets et leurs couleurs), meme envoyee d'un fichier retranche (autre numero de profil)
    vcount = {}
    vgroups = {k: v for k, v in _variant_groups(raw["models"]).items() if k[0] in on_plates}
    if vgroups:
        try:
            from .makerworld import model_detail
            inprog = await _printed_plates(list({k[0] for k in vgroups}), ("IN_PROGRESS",))
            for (did, iid), rows in vgroups.items():
                vcount[(did, iid)] = _variant_counts(rows, inprog.get(str(did), []), await model_detail(str(did), stale_ok=True), iid)
        except Exception:
            logger.exception("[QUEUE] variantes en cours")
            vcount = {}
    models = []
    for r in raw["models"]:
        mw = mw_of(r["design_id"])
        on = live if live and live["design_id"] == mw else None
        # « en cours » se lit a chaque appel (etat en direct, impression ouverte dans l'historique),
        # jamais dans le calcul en cache : une impression finie depuis restait « en cours »
        printing = bool(on or mw in on_plates)
        ents = on_plates.get(mw) if printing else None
        if r.get("multi") and mw in on_plates:
            # plusieurs profils retenus : seule la ligne du profil qui imprime (06/11/2026)
            ids = {str((r.get("profile") or {}).get(k) or "") for k in ("instance_id", "profile_id")} - {""}
            ents = [e for e in await _resolve_profiles(mw, on_plates[mw]) if e["prof"] in ids]
            printing = bool(ents)
        if r.get("color_variant") and (mw, (r.get("profile") or {}).get("instance_id")) in vcount:
            # une variante de couleur (06/11/2026) : ce que l'impression en cours lui donne, d'apres ses objets et leurs couleurs
            vc = vcount[(mw, r["profile"]["instance_id"])].get(r["design_id"]) or {}
            printing = bool(vc)
            r = {**r, "plates": [{**p, "printing": bool(vc.get(p.get("index"))), "printing_n": vc.get(p.get("index"), 0)} for p in r["plates"]]}
            ents = None
        if ents and r.get("plates"):
            # combien d'exemplaires chaque plateau en cours va donner (dits a la main, elements, poids)
            pg = {p.get("index"): p.get("weight_g") for p in r["plates"]}
            pp = _printed_of(ents, None, set(), pg, plate_pieces(r["design_id"], r.get("profile")))
            r = {**r, "plates": [{**p, "printing": p.get("index") in pp, "printing_n": pp.get(p.get("index"), 0)} for p in r["plates"]]}
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
        # ce qui reste a imprimer (11/11/2026), plus tout le modele
        for fid, g in r.get("_left_need", r["_need"]).items():
            if g <= 0.05:
                continue
            t = need.setdefault(fid, {"need_g": 0.0, "models": 0})
            t["need_g"] += g
            t["models"] += 1
        for k, x in r.get("_left_miss", r["_miss"]).items():
            if x["g"] <= 0.05:
                continue
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
                   # ce qui reste a imprimer (10/11/2026)
                   "left_seconds": sum((r.get("left") or {}).get("seconds") or 0 for r in models),
                   "left_weight_g": round(sum((r.get("left") or {}).get("weight_g") or 0 for r in models), 1),
                   "left_cost": round(sum(r.get("_left_cost", r["_cost"]) for r in models), 2),
                   "ams": sum(1 for r in models if r["status"] == "ams"),
                   "partial": sum(1 for r in models if r["status"] == "partial"),
                   "stock": sum(1 for r in models if r["status"] == "stock"),
                   "short": sum(1 for r in models if r["status"] == "short"),
                   "printed": sum(1 for r in models if r["printed"])},
    }


def _split_variants(models: list, done_plates: dict, details: dict) -> None:
    """Les variantes de couleur d'un meme profil (06/11/2026) : chaque impression de ce profil compte pour UNE variante,
    celle a laquelle on l'a rattachee, sinon celle dont elle a le plus de filaments (a egalite, la premiere). Les
    plateaux faits de chaque variante sont recomptes."""
    for (did, iid), rows in _variant_groups(models).items():
        entries = done_plates.get(str(did), [])
        counts = _variant_counts(rows, entries, details.get(did) or {}, iid)
        for r in rows:
            # repartir a zero (08/11/2026) : la meme repartition, sur les impressions faites depuis sa date
            mine = _variant_counts(rows, _after(entries, r.get("since")), details.get(did) or {}, iid) if r.get("since") else counts
            for pl in r.get("plates") or []:
                pl["printed"] = mine[r["design_id"]].get(pl["index"], 0)
                pl["printed_all"] = counts[r["design_id"]].get(pl["index"], 0)


def _profiles_fresh(models: list, done_plates: dict, details: dict) -> None:
    """Les profils retenus a jour (06/11/2026) : une impression d'un modele retenu qui porte un numero de profil inconnu de
    sa fiche (le createur a mis le profil a jour, ou un fichier retranche) fait relire la fiche chez MakerWorld, en fond ;
    le calcul suivant connait alors la nouvelle version."""
    from .makerworld import refresh_soon
    seen = set()
    for r in models:
        mw = str(r.get("mw_id") or "")
        if not r.get("planned") or not mw or mw in seen:
            continue
        seen.add(mw)
        m = details.get(mw) or {}
        known = {str(p.get(k) or "") for p in m.get("profiles") or [] for k in ("instance_id", "profile_id")} - {""}
        if any(e.get("prof") and e["prof"] not in known for e in done_plates.get(mw, [])):
            refresh_soon(mw)


def _variant_groups(models: list) -> dict:
    groups = {}
    for r in models:
        if r.get("color_variant") and r.get("profile"):
            groups.setdefault((r["mw_id"], r["profile"]["instance_id"]), []).append(r)
    return groups


def _variant_counts(rows: list, entries: list, m: dict, iid) -> dict:
    """{ligne: {plateau: exemplaires}} : ces impressions reparties entre les variantes de couleur d'un profil (faites, ou
    en cours). Une impression d'un profil que MakerWorld ne connait pas pour ce modele (le fichier retranche et envoye
    depuis Bambu Studio porte un nouveau numero, 06/11/2026 : les 4 echantillons de Guillaume) compte pour lui ; celle
    d'un autre profil MakerWorld du modele, non."""
    prof = next((p for p in m.get("profiles") or [] if p.get("instance_id") == iid), None) or {}
    ids = {str(prof.get("instance_id") or ""), str(prof.get("profile_id") or "")} - {""}
    others = {str(p.get(k) or "") for p in m.get("profiles") or [] if p is not prof for k in ("instance_id", "profile_id")} - {""} - ids
    plate_g = {pl.get("index"): _num(pl.get("weight_g")) or sum(_num(f.get("g")) for f in pl.get("filaments") or [])
               for pl in prof.get("plates") or []}
    pieces = plate_pieces(rows[0]["mw_id"], prof)
    counts = {r["design_id"]: {} for r in rows}
    for e in entries:
        if e["prof"] not in ids and (e["prof"] in others or not m.get("profiles")):
            continue
        to = next((r for r in rows if e.get("variant") == r["design_id"]), None)
        c = copies_of(e, plate_g, pieces)[0]
        fids = e.get("fids") or set()
        # objet par objet (06/11/2026) : le 3MF tranche dit les objets poses et leur filament ; chacun va a la variante
        # qui a ses couleurs. Le nombre d'objets d'une variante, sur les pieces d'un exemplaire, fait ses exemplaires
        if to is None and len(rows) > 1:
            objs = print_objects(e.get("tmf"), e.get("plate_id"))
            per = max(1, sum(pieces.get(n) or 0 for n in e["plates"]) or 1)
            got = {}
            for cols in objs:
                of = {(e.get("fcol") or {}).get(x) for x in cols} - {None}
                if not of:
                    continue
                cand = [r for r in rows if r["_fids"] and of <= r["_fids"]]
                if cand:
                    r = min(cand, key=lambda r: (len(r["_fids"]), rows.index(r)))
                    got[r["design_id"]] = got.get(r["design_id"], 0) + 1
            if len(got) >= 2 or (got and sum(got.values()) >= per * 2):
                for rid, nobj in got.items():
                    k = max(1, round(nobj / per))
                    for n in e["plates"]:
                        counts[rid][n] = counts[rid].get(n, 0) + k
                continue
        # plusieurs variantes sur un meme plateau (06/11/2026 : 4 echantillons de 4 couleurs, en un seul print de x4) :
        # chaque variante dont il a tous les filaments en prend sa part, a parts egales (le reste aux premieres)
        # (10/11/2026) par couleurs distinctes : deux lignes de la meme couleur (Granit rouge deux fois dans la file) en
        # prenaient chacune une part, et la derniere couleur du plateau de 7 restait a faire ; la part d'une couleur va a
        # ses lignes dans l'ordre, la premiere remplie jusqu'a sa quantite (ce qu'elle a deja compris) avant la suivante
        full = [r for r in rows if r["_fids"] and r["_fids"] <= fids] if to is None and c > 1 else []
        sets = []
        for r in full:
            g = next((x for x in sets if x[0] == r["_fids"]), None)
            if g:
                g[1].append(r)
            else:
                sets.append((r["_fids"], [r]))
        if len(full) >= 2:
            share = [c // len(sets) + (1 if i < c % len(sets) else 0) for i in range(len(sets))]
            for (_f, rs), k in zip(sets, share):
                for i, r in enumerate(rs):
                    room = _qty(r.get("qty", 1)) - max((counts[r["design_id"]].get(n, 0) for n in e["plates"]), default=0)
                    take = k if i == len(rs) - 1 else max(0, min(k, room))
                    k -= take
                    if take:
                        for n in e["plates"]:
                            counts[r["design_id"]][n] = counts[r["design_id"]].get(n, 0) + take
            continue
        if to is None:
            to = max(rows, key=lambda r: (len(fids & r["_fids"]) / max(1, len(r["_fids"])), -rows.index(r)))
        for n in e["plates"]:
            counts[to["design_id"]][n] = counts[to["design_id"]].get(n, 0) + c
    return counts


async def _compute(fresh: bool = False) -> dict:
    """fresh (« Relire maintenant », 02/11/2026) : les collections relues chez MakerWorld, pas dans le cache de 2 h ;
    un modele ajoute sur le site apparait tout de suite."""
    from . import makerworld_account as A
    from .makerworld import model_detail
    cfg = await _load()
    colls = {c["id"]: c["title"] for c in (await A.collections())["collections"]}
    chosen = [c for c in cfg["collections"] if c in colls]
    designs, where, where_ids = {}, {}, {}
    for cid in chosen:
        for x in await _collection_designs(cid, fresh):
            designs.setdefault(x["design_id"], x)
            where.setdefault(x["design_id"], []).append(colls[cid])
            where_ids.setdefault(x["design_id"], []).append(cid)
    await _track_added(cfg, designs, {d: [c for c in chosen if colls[c] in w] for d, w in where.items()}, chosen)

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
    lines = []
    for did in designs:
        lines.append((did, did, cfg["plans"].get(did)))
        lines += [(x["key"], did, {k: v for k, v in x.items() if k != "key"}) for x in _plans_of(cfg, did)[1:]] \
            if (cfg["plans"].get(did) or {}).get("instance_id") else []
    nlines = {}
    for _, did, _ in lines:
        nlines[did] = nlines.get(did, 0) + 1
    for did_, n_ in nlines.items():                   # plusieurs profils retenus : chaque impression au sien
        if n_ > 1 and done_plates.get(str(did_)):
            done_plates[str(did_)] = await _resolve_profiles(did_, done_plates[str(did_)])
    for rid, did, plan in lines:
        base = designs[did]
        m = details.get(did) or {}
        multi = nlines[did] > 1
        qty = _qty((plan or {}).get("qty", 1))
        # un plan qui ne porte qu'une quantite ne compte pas comme « retenu »
        chosen_plan = bool(plan and plan.get("instance_id"))
        profiles = m.get("profiles") or []
        prof = next((p for p in profiles if plan and p.get("instance_id") == plan.get("instance_id")), None) \
            or next((p for p in profiles if p.get("main")), None) or (profiles[0] if profiles else None)
        row = {"design_id": rid, "mw_id": did, "multi": multi, "title": base.get("title"), "title_fr": base.get("title_fr") or m.get("title_fr"),
               "cover_url": base.get("cover_url") or m.get("cover_url"), "collections": where.get(did, []), "coll_ids": where_ids.get(did, []),
               "printed": m.get("printed") or 0, "planned": chosen_plan, "qty": qty, "error": m.get("error"),
               "plates_ready": [], "plates_count": 0, "_need": {}, "_miss": {}, "_pl": {}, "_inprog": m.get("in_progress") or 0,
               "profile": None, "seconds": None, "weight_g": 0.0, "filaments": [], "status": "unknown",
               "default_instance": next((p.get("instance_id") for p in profiles if p.get("default")), None)}
        # le profil retenu n'existe plus sur MakerWorld (06/11/2026 : retire ou remplace par son createur) ; la liste prend
        # en attendant le profil par defaut, et le dit (une notification aussi)
        if chosen_plan and profiles and not m.get("error") and not any(p.get("instance_id") == plan.get("instance_id") for p in profiles):
            row["profile_gone"] = str(plan.get("instance_id"))
        if prof:
            sel = plan.get("plates") if plan and plan.get("instance_id") == prof.get("instance_id") else None
            plates = [pl for pl in prof.get("plates") or [] if sel is None or pl.get("index") in sel]
            items = (m.get("stock") or {}).get(prof.get("instance_id")) or []
            picks = (plan or {}).get("picks") or {}
            row["profile"] = {"instance_id": prof.get("instance_id"), "profile_id": prof.get("profile_id"), "title": prof.get("title"),
                              "cover": prof.get("cover"),
                              "printer": prof.get("printer"), "dev_model": prof.get("dev_model"), "plates": len(plates), "plates_total": len(prof.get("plates") or [])}
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
                # (11/11/2026) le besoin de chaque plateau, pour UN exemplaire : ce qui reste a imprimer s'en deduit
                # une fois les plateaux faits connus (filaments de « A faire », comme le planning)
                pe = row["_pl"].setdefault(pn, {})
                pe[fid if fid else ("?", k)] = pe.get(fid if fid else ("?", k), 0.0) + g
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
            # repartir a zero (08/11/2026) : ce qui compte depuis sa date ; le total de toujours reste a cote
            ids_, pg_, pc_ = ({str(x.get(i) or "") for x in profiles for i in ("instance_id", "profile_id")} - {""},
                              {pl.get("index"): _num(pl.get("weight_g")) or sum(_num(f.get("g")) for f in pl.get("filaments") or [])
                               for pl in prof.get("plates") or []}, plate_pieces(did, prof))
            since = since_of(cfg, rid)
            row["since"] = since
            # arrive dans la file a cette date, sans « repartir a zero » a la main (08/11/2026)
            row["since_auto"] = bool(since and rid not in (cfg.get("since") or {}))
            every = _printed_of(done_plates.get(str(did), []), prof, ids_, pg_, pc_, strict=multi)
            mine = _printed_of(_after(done_plates.get(str(did), []), since), prof, ids_, pg_, pc_, strict=multi) if since else every
            row["plates"] = [{"index": pl.get("index"), "name": pl.get("name") or "", "thumb": pl.get("thumb"),
                              "ready": pl.get("index") in ready, "printed": mine.get(pl.get("index"), 0),
                              "printed_all": every.get(pl.get("index"), 0),
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
        same_prof = sum(1 for k, dd, pp in lines if dd == did and (pp or {}).get("instance_id") == (plan or {}).get("instance_id")) > 1
        row["_fids"] = set(row["_need"].keys())
        if multi and prof and same_prof:
            # des variantes de couleur du meme profil (06/11/2026) : chaque ligne dit ses couleurs
            names = []
            for x in row["filaments"]:
                n = (x.get("chosen") or {}).get("name")
                if n and n not in names:
                    names.append(n)
            row["variant"] = " + ".join(names[:3]) or prof.get("title") or None
            row["color_variant"] = True
            if row["variant"]:
                row["title"] = f"{row['title'] or ''} · {row['variant']}"
                row["title_fr"] = f"{row['title_fr']} · {row['variant']}" if row.get("title_fr") else None
        elif multi and prof:
            # plusieurs profils retenus : chaque ligne dit le sien, avec son image (06/11/2026)
            row["variant"] = prof.get("title") or None
            if row["variant"]:
                row["title"] = f"{row['title'] or ''} · {row['variant']}"
                row["title_fr"] = f"{row['title_fr']} · {row['variant']}" if row.get("title_fr") else None
            row["cover_url"] = prof.get("cover") or row["cover_url"]
        models.append(row)

    _split_variants(models, done_plates, details)
    _profiles_fresh(models, done_plates, details)
    # deja fait en entier (08/11/2026) : un modele remis dans la file pour le refaire ne planifiait rien ; on propose
    # de repartir a zero
    for r in models:
        pls = r.get("plates") or []
        r["redo_hint"] = bool(pls and not r.get("since") and all((p.get("printed") or 0) >= (r.get("qty") or 1) for p in pls))
        # (11/11/2026) fait en entier dans la serie en cours : « A faire » propose de le retirer de ses collections
        r["done"] = bool(pls and all((p.get("printed") or 0) >= (r.get("qty") or 1) for p in pls))
    rank = {did: i for i, did in enumerate(cfg.get("order") or [])}
    # les retenus toujours devant les autres (06/11/2026), puis l'ordre choisi (les nouveaux en tete de leur groupe)
    models.sort(key=lambda r: (not r["planned"], r["design_id"] in rank, rank.get(r["design_id"], 0)))
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
        # (10/11/2026) ce qui reste a imprimer : les exemplaires de chaque plateau pas encore faits (dans la serie en
        # cours), en part du temps (par les heures des plateaux) et du poids et du cout (par leurs grammes)
        pls, q = r.get("plates") or [], r.get("qty") or 1
        fs = fw = 1.0
        if pls:
            rem = {p["index"]: max(0, q - (p.get("printed") or 0)) for p in pls}
            ts = sum((p.get("seconds") or 0) * q for p in pls)
            tw = sum((p.get("weight_g") or 0) * q for p in pls)
            fw = sum((p.get("weight_g") or 0) * rem[p["index"]] for p in pls) / tw if tw else sum(rem.values()) / (len(pls) * q)
            fs = sum((p.get("seconds") or 0) * rem[p["index"]] for p in pls) / ts if ts else fw
        r["left"] = {"seconds": round((r["seconds"] or 0) * fs) if r["seconds"] else None,
                     "weight_g": round(r["weight_g"] * fw, 1), "cost": round(c * fw, 2) if r["cost"] is not None else None}
        r["_left_cost"] = c * fw
        # (11/11/2026) les filaments qui restent a imprimer : chaque plateau pour ses exemplaires pas encore faits (la
        # liste « Filament pour tout imprimer » comptait tout le modele, plateaux faits et modeles finis compris : elle
        # ne disait pas la meme chose que le planning) ; sans plateaux connus, en part du poids
        per = r.pop("_pl", None) or {}
        if pls and per and all(pn is not None for pn in per):
            rem = {p["index"]: max(0, q - (p.get("printed") or 0)) for p in pls}
            ln, lm = {}, {}
            for pn, e in per.items():
                n = rem.get(pn, q)
                if not n:
                    continue
                for f, g in e.items():
                    if isinstance(f, tuple):
                        lm[f[1]] = lm.get(f[1], 0.0) + g * n
                    else:
                        ln[f] = ln.get(f, 0.0) + g * n
            r["_left_need"] = ln
            r["_left_miss"] = {k: {**x, "g": lm.get(k, 0.0)} for k, x in r["_miss"].items()}
        else:
            r["_left_need"] = {f: g * fw for f, g in r["_need"].items()}
            r["_left_miss"] = {k: {**x, "g": x["g"] * fw} for k, x in r["_miss"].items()}
        # par filament, pour la fiche d'un filament (les modeles qui s'en servent encore)
        r["left"]["by_fil"] = {str(f): round(g, 1) for f, g in r["_left_need"].items() if g > 0.05}
    return {"collections": [{"id": c, "title": colls[c]} for c in chosen], "models": models, "stock_of": stock_of}
