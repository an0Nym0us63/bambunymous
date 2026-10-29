"""Retrouver le modele MakerWorld des impressions qui n'en ont pas (29/10/2026).

Les impressions sans identifiant de modele (lancees depuis Studio, fichier local, vieux historique) sont regroupees
par nom (« Plate 2 », « .3mf » retires) : un groupe = un « modele » a retrouver. Pour chacun, on cherche sur
MakerWorld avec le titre lu dans son 3MF imprime (le titre exact de la fiche quand il vient de MakerWorld), puis
son nom d'origine, puis le nom de la tache, et on note chaque resultat par ressemblance de titre :
  - sur (un resultat net, loin devant les autres) : le modele est rattache tout seul ;
  - doute : jusqu'a 6 candidats gardes, a choisir a la main (ou « aucun ») ;
  - rien : rien d'approchant.
Le scan avance un modele a la fois (une recherche toutes les PACE s), s'arrete de lui-meme si MakerWorld refuse
(418 « pas un robot », 429), se reprend ou il en etait, et reprend tout seul apres un redemarrage. Son etat est
garde dans DATA_DIR/cache/mw_relink.json.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

logger = logging.getLogger(__name__)

PACE = 4.0            # secondes entre deux recherches MakerWorld
SURE = 0.86           # score du meilleur pour rattacher tout seul...
GAP = 0.12            # ... s'il devance le second d'au moins autant
DOUBT = 0.35          # en dessous : rien d'approchant
_STATE: dict = {"running": False, "done": 0, "total": 0, "current": None, "started": None, "finished": None,
                "stopped": None, "found": 0, "doubt": 0, "none": 0}
_UNITS: dict = {}     # cle -> {status, candidates, chosen, at, queries}
_TASK = {"t": None}
_LOADED = {"v": False}


def _file() -> Path:
    from ..core.config import settings
    d = Path(settings.DATA_DIR) / "cache"
    d.mkdir(parents=True, exist_ok=True)
    return d / "mw_relink.json"


def _load() -> None:
    if _LOADED["v"]:
        return
    _LOADED["v"] = True
    try:
        d = json.loads(_file().read_text(encoding="utf-8"))
        _UNITS.update(d.get("units") or {})
        st = d.get("state") or {}
        _STATE.update({k: st.get(k, v) for k, v in _STATE.items()})
        _STATE["running"] = False
        _STATE["was_running"] = bool(st.get("running"))
    except (OSError, ValueError):
        pass


def _save() -> None:
    try:
        tmp = _file().with_suffix(".tmp")
        tmp.write_text(json.dumps({"units": _UNITS, "state": {k: v for k, v in _STATE.items() if k != "was_running"}},
                                  ensure_ascii=False), encoding="utf-8")
        tmp.replace(_file())
    except OSError:
        logger.exception("[MW-RELINK] sauvegarde de l'etat")


# ── les noms ──────────────────────────────────────────────────────────────────────────────────────────────
def _plain(t: str) -> str:
    t = unicodedata.normalize("NFD", str(t or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def clean_name(t: str) -> str:
    """Le nom d'une impression sans ce qui ne dit rien du modele (« - Plate 2 », « .3mf », « _ »)."""
    from ..core.text import unent
    t = unent(str(t or "")).strip()
    t = re.sub(r"(\.gcode)?(\.3mf)$", "", t, flags=re.I)
    t = re.sub(r"[\s_\-]*(plate|plateau)[\s_\-]*\d+\s*$", "", t, flags=re.I)
    t = t.replace("_", " ")
    return re.sub(r"\s+", " ", t).strip(" -·")


def unit_key(p) -> str | None:
    """La cle d'un « modele » : le nom nettoye, le meme pour toutes les impressions d'un modele."""
    for n in (p.original_name, p.task_name, p.file_name, p.translated_name):
        n = clean_name(n)
        if n and n not in ("0",) and len(_plain(n)) >= 2:
            return _plain(n)
    return None


def score(ours: list, title: str, title_fr: str = "") -> float:
    """Ressemblance (0 a 1) entre nos noms et le titre d'un modele MakerWorld (le meilleur des deux titres)."""
    best = 0.0
    for t in (title, title_fr):
        tt = _plain(t)
        if not tt:
            continue
        tw = set(tt.split())
        for o in ours:
            oo = _plain(o)
            if not oo:
                continue
            ow = set(oo.split())
            ratio = SequenceMatcher(None, oo, tt).ratio()
            # les mots de notre nom retrouves dans le titre (un nom court « Benchy » dans « 3DBenchy - The jolly… »)
            cover = len(ow & tw) / max(1, len(ow))
            if len(oo) >= 4 and oo.replace(" ", "") in tt.replace(" ", ""):
                cover = max(cover, 0.9)       # « benchy » dans « 3dbenchy »
            jac = len(ow & tw) / max(1, len(ow | tw))
            best = max(best, 0.45 * ratio + 0.35 * cover + 0.20 * jac)
    return round(best, 3)


def _title_of_3mf(rel: str | None) -> str | None:
    """Le titre du modele dans le 3MF imprime (metadonnee « Title »), s'il est la."""
    if not rel:
        return None
    try:
        import zipfile
        from .archive import local_or_archive
        f = local_or_archive(rel)
        if not f or not f.is_file():
            return None
        with zipfile.ZipFile(f) as z:
            with z.open("3D/3dmodel.model") as fh:
                head = fh.read(65536).decode("utf-8", "replace")
        m = re.search(r'<metadata name="Title">([^<]{2,200})</metadata>', head)
        return m.group(1).strip() if m else None
    except Exception:
        return None


# ── les modeles a retrouver ──────────────────────────────────────────────────────────────────────────────
async def units() -> list:
    """Les « modeles » sans fiche MakerWorld : nom, impressions, image, et ce que le scan en a tire."""
    from sqlalchemy import select, or_
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    _load()
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(Print.id, Print.original_name, Print.task_name, Print.file_name, Print.translated_name, Print.model_3mf,
                   Print.print_date, Print.status, Print.cover_photo, Print.plate_image)
            .where(or_(Print.design_id.is_(None), Print.design_id == ""), Print.status != "IN_PROGRESS")
            .order_by(Print.print_date.desc()))).all()
    out: dict = {}
    for r in rows:
        k = unit_key(r)
        if not k:
            continue
        u = out.get(k)
        if u is None:
            name = next((clean_name(n) for n in (r.translated_name, r.original_name, r.task_name, r.file_name)
                         if clean_name(n) and clean_name(n) != "0"), k)
            u = out[k] = {"key": k, "name": name, "original": clean_name(r.original_name or r.task_name or r.file_name),
                          "print_ids": [], "cover_print": r.id, "last": r.print_date.isoformat() if r.print_date else None,
                          "model_3mf": r.model_3mf, "ok": 0, "image": None}
        u["print_ids"].append(r.id)
        if not u["image"]:
            name = r.cover_photo or (r.plate_image or "").split("/")[-1]
            u["image"] = f"/api/v1/prints/{r.id}/file/{name}" if name else None
        u["ok"] += 1 if r.status in ("SUCCESS", "PARTIAL") else 0
        if not u.get("model_3mf") and r.model_3mf:
            u["model_3mf"] = r.model_3mf
    res = []
    for k, u in out.items():
        s = _UNITS.get(k) or {}
        res.append({**{x: u[x] for x in ("key", "name", "original", "print_ids", "cover_print", "last", "ok", "image")},
                    "count": len(u["print_ids"]), "status": s.get("status") or "todo",
                    "candidates": s.get("candidates") or [], "chosen": s.get("chosen"), "query": s.get("query")})
    # ceux deja rattaches (par le scan ou a la main) : gardes pour pouvoir revenir dessus
    for k, s in _UNITS.items():
        if s.get("status") == "linked" and k not in out and s.get("print_ids"):
            res.append({"key": k, "name": s.get("name") or k, "original": s.get("name") or k, "print_ids": s["print_ids"],
                        "cover_print": s["print_ids"][0], "last": None, "ok": None, "image": s.get("image"),
                        "count": len(s["print_ids"]), "status": "linked", "auto": bool(s.get("auto")),
                        "candidates": s.get("candidates") or [], "chosen": s.get("chosen"), "query": s.get("query")})
    return res


async def _search(q: str):
    """(code, [resultats]) d'une recherche MakerWorld par mot-cle."""
    from urllib.parse import quote
    from .makerworld import _get_json, _hit
    code, d = await asyncio.to_thread(_get_json, f"/search-service/select/design2?keyword={quote(q[:100])}&offset=0&limit=24")
    if not isinstance(d, dict):
        return code, None
    return code, [x for x in (_hit(h) for h in (d.get("hits") if isinstance(d.get("hits"), list) else [])) if x]


async def assign(key: str, design_id: str, print_ids: list | None = None, auto: bool = False) -> int:
    """Rattache le modele MakerWorld aux impressions de ce « modele » ; rend leur nombre."""
    from sqlalchemy import update
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    _load()
    did = str(design_id or "").strip()
    if not did.isdigit():
        raise ValueError("Modèle MakerWorld invalide")
    u = next((x for x in await units() if x["key"] == key and x["status"] != "linked"), None)
    if print_ids is None:
        print_ids = u["print_ids"] if u else []
    if not print_ids:
        return 0
    async with AsyncSessionLocal() as db:
        n = (await db.execute(update(Print).where(Print.id.in_(print_ids)).values(design_id=did, mw_profile_id=None))).rowcount
        await db.commit()
    s = _UNITS.setdefault(key, {})
    s.update(status="linked", chosen=did, auto=auto, at=time.time(), print_ids=list(print_ids),
             name=(u or {}).get("name") or s.get("name"), image=(u or {}).get("image") or s.get("image"))
    _save()
    try:
        from .makerworld import launch
        launch(did)                       # sa fiche, lue en arriere-plan (ses documents joints gardes avec)
        # deja lue (pour une autre impression, un favori) : ses documents joints gardes quand meme (30/10/2026)
        from . import mw_docs
        from .makerworld import extras_of
        from ..models.print_history import MakerWorldDesign as _MW
        async with AsyncSessionLocal() as db:
            m = await db.get(_MW, did)
            ex = m.extras if m is not None and m.status == "ok" else None
        if ex and extras_of(ex).get("docs"):
            import asyncio as _aio
            _aio.get_running_loop().run_in_executor(None, mw_docs.keep, did, extras_of(ex)["docs"])
    except Exception:
        pass
    logger.info(f"[MW-RELINK] « {key} » -> modele {did} ({n} impression(s){', automatique' if auto else ''})")
    return n


async def unlink(key: str) -> int:
    """Defait un rattachement (un « sur » qui ne l'etait pas) : ses impressions repassent sans modele."""
    from sqlalchemy import update
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    _load()
    s = _UNITS.get(key) or {}
    if s.get("status") != "linked" or not s.get("print_ids"):
        return 0
    async with AsyncSessionLocal() as db:
        n = (await db.execute(update(Print).where(Print.id.in_(s["print_ids"]), Print.design_id == s.get("chosen"))
                              .values(design_id=None, mw_profile_id=None))).rowcount
        await db.commit()
    s.update(status="doubt" if s.get("candidates") else "todo", chosen=None, auto=False, at=time.time())
    _save()
    logger.info(f"[MW-RELINK] « {key} » detache ({n} impression(s))")
    return n


def ignored_keys() -> set:
    """Les « modeles » marques « aucun » : leurs impressions ne sont plus signalees dans les points d'attention."""
    _load()
    return {k for k, s in _UNITS.items() if s.get("status") == "ignored"}


def dismiss(key: str, on: bool = True) -> None:
    """« Aucun de ceux-la » : ce modele n'est pas sur MakerWorld (ou on ne le cherche plus). Reversible."""
    _load()
    s = _UNITS.setdefault(key, {})
    if on:
        s.update(status="ignored", at=time.time())
    else:
        s.update(status="doubt" if s.get("candidates") else "todo")
    _save()


async def search_for(key: str, q: str) -> list:
    """Une recherche a la main pour un modele (un autre nom) : ses resultats notes, gardes comme candidats."""
    _load()
    code, hits = await _search(q)
    if hits is None:
        raise ValueError(f"MakerWorld ne répond pas (HTTP {code})")
    u = next((x for x in await units() if x["key"] == key), None)
    ours = [q] + ([u["name"], u["original"]] if u else [])
    cands = sorted(({**h, "score": score(ours, h.get("title"), h.get("title_fr"))} for h in hits), key=lambda x: -x["score"])[:8]
    s = _UNITS.setdefault(key, {})
    s.update(status="doubt" if cands else "none", candidates=cands, query=q, at=time.time())
    _save()
    return cands


# ── le scan ──────────────────────────────────────────────────────────────────────────────────────────────
def status() -> dict:
    _load()
    return {k: v for k, v in _STATE.items() if k != "was_running"}


def start(again: bool = False) -> bool:
    """Lance (ou reprend) le scan. again : repasse aussi sur les « rien trouve »."""
    _load()
    if _TASK["t"] and not _TASK["t"].done():
        return False
    _STATE.update(running=True, stopped=None, started=time.time(), finished=None)
    _TASK["t"] = asyncio.get_running_loop().create_task(_run(again))
    return True


def stop() -> None:
    _STATE["stopped"] = "Arrêté"
    _STATE["running"] = False
    t = _TASK["t"]
    if t and not t.done():
        t.cancel()
    _save()


async def _run(again: bool) -> None:
    try:
        todo = [u for u in await units() if u["status"] == "todo" or (again and u["status"] == "none")]
        _STATE.update(total=len(todo), done=0, found=0, doubt=0, none=0)
        _save()
        for u in todo:
            _STATE["current"] = u["name"]
            queries = []
            # le titre du 3MF imprime, puis les noms
            t3 = None
            from sqlalchemy import select
            from ..db.session import AsyncSessionLocal
            from ..models.print_history import Print
            async with AsyncSessionLocal() as db:
                rels = (await db.execute(select(Print.model_3mf).where(Print.id.in_(u["print_ids"]), Print.model_3mf.isnot(None)))).scalars().all()
            for rel in rels[:2]:
                t3 = await asyncio.to_thread(_title_of_3mf, rel)
                if t3:
                    break
            for q in (t3, u["original"], u["name"]):
                q = clean_name(q or "")
                if q and len(_plain(q)) >= 2 and _plain(q) not in [_plain(x) for x in queries]:
                    queries.append(q)
            ours = [x for x in (t3, u["original"], u["name"]) if x]
            cands, blocked = {}, None
            for q in queries[:2]:
                code, hits = await _search(q)
                if hits is None:
                    if code in (418, 429, 403):
                        blocked = code
                        break
                    continue
                for h in hits:
                    sc = score(ours, h.get("title"), h.get("title_fr"))
                    if h["design_id"] not in cands or cands[h["design_id"]]["score"] < sc:
                        cands[h["design_id"]] = {**h, "score": sc}
                best = max((c["score"] for c in cands.values()), default=0)
                if best >= SURE:
                    break                     # deja net : pas de seconde recherche
                await asyncio.sleep(PACE)
            if blocked:
                _STATE.update(stopped=f"MakerWorld demande de vérifier que ce n'est pas un robot (HTTP {blocked}) : reprends plus tard",
                              running=False, current=None)
                _save()
                logger.info(f"[MW-RELINK] arrete : MakerWorld refuse (HTTP {blocked})")
                return
            ranked = sorted(cands.values(), key=lambda x: -x["score"])
            top = ranked[0]["score"] if ranked else 0
            second = ranked[1]["score"] if len(ranked) > 1 else 0
            s = _UNITS.setdefault(u["key"], {})
            s.update(query=queries[0] if queries else None, at=time.time())
            if top >= SURE and top - second >= GAP:
                s["candidates"] = ranked[:3]
                await assign(u["key"], ranked[0]["design_id"], u["print_ids"], auto=True)
                _STATE["found"] += 1
            elif top >= DOUBT:
                s.update(status="doubt", candidates=ranked[:6])
                _STATE["doubt"] += 1
            else:
                s.update(status="none", candidates=ranked[:3])
                _STATE["none"] += 1
            _STATE["done"] += 1
            _save()
            await asyncio.sleep(PACE)
        _STATE.update(running=False, current=None, finished=time.time())
        _save()
        logger.info(f"[MW-RELINK] fini : {_STATE['found']} retrouves, {_STATE['doubt']} a choisir, {_STATE['none']} sans resultat")
    except asyncio.CancelledError:
        _STATE.update(running=False, current=None)
        _save()
    except Exception as e:
        logger.exception("[MW-RELINK] scan")
        _STATE.update(running=False, current=None, stopped=f"Erreur : {type(e).__name__}")
        _save()


async def resume_after_restart() -> None:
    """Un scan qui tournait a l'arret du serveur reprend tout seul, une minute apres le demarrage."""
    _load()
    if _STATE.get("was_running"):
        await asyncio.sleep(60)
        if not _STATE.get("running"):
            logger.info("[MW-RELINK] reprise du scan apres redemarrage")
            start()
