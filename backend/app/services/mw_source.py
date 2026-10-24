"""Le 3MF d'origine MakerWorld d'une impression (24/10/2026).

Le 3MF garde a chaque impression est celui tranche pour MON imprimante. Celui-ci est le projet du profil
tel que MakerWorld le sert (plateaux, reglages, pas de G-code) : on peut le retrancher, et il survit a la
disparition du modele. Recupere des le lancement (le profil est connu), sinon a la fin, et par un
rattrapage en arriere-plan pour les anciennes impressions.

Un fichier par profil, partage par toutes ses impressions : data/mw_3mf/<instance>.3mf. L'index
(index.json) relie « modele:profil » a l'instance, de quoi servir le fichier meme si la fiche du modele
n'est plus en ligne. Chaque recuperation compte comme un telechargement sur MakerWorld (une fois par
profil). Le jeton du compte n'est jamais ecrit nulle part ici.
"""
import asyncio
import io
import json
import logging
import threading
import time
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

PAUSE_S = 3                      # entre deux telechargements du rattrapage (on reste poli)
_LOCK = threading.Lock()
_BUSY: set = set()               # instances en cours de telechargement
JOB: dict = {}                   # le rattrapage en cours (aussi sur disque : backfill.json)
_STOP = {"flag": False}


def _dir() -> Path:
    from .mw_3mf import _dir as d
    return d()


def path_of(iid: str) -> Path:
    return _dir() / f"{iid}.3mf"


_IDX = {"mt": None, "v": {}}


def _index() -> dict:
    """index.json, relu seulement quand il change (la liste des impressions le consulte pour chacune)."""
    f = _dir() / "index.json"
    try:
        mt = f.stat().st_mtime
    except OSError:
        return {}
    if _IDX["mt"] != mt:
        try:
            _IDX.update(mt=mt, v=json.loads(f.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            return {}
    return dict(_IDX["v"])


def _index_put(key: str, iid: str) -> None:
    with _LOCK:
        d = _index()
        if d.get(key) != iid:
            d[key] = iid
            tmp = _dir() / "index.json.tmp"
            tmp.write_text(json.dumps(d), encoding="utf-8")
            tmp.replace(_dir() / "index.json")


def known(design_id, profile_id) -> str | None:
    """L'instance deja recuperee pour ce modele et ce profil (sans rien demander a MakerWorld)."""
    iid = _index().get(f"{design_id}:{profile_id}")
    return iid if iid and path_of(iid).is_file() else None


async def resolve(design_id: str, profile_id: str) -> str | None:
    """Profil (ou instance : l'imprimante donne parfois l'une pour l'autre) -> instance a telecharger,
    d'apres la fiche du modele (en cache)."""
    from .makerworld import _base
    base = await _base(str(design_id), stale_ok=True)
    if not isinstance(base, dict) or "error" in base:
        return None
    for p in base.get("profiles") or []:
        inst, prof = str(p.get("instance_id") or ""), str(p.get("profile_id") or "")
        if inst and profile_id in (inst, prof):
            return inst
    return None


async def fetch(iid: str) -> Path:
    """Telecharge le 3MF d'une instance s'il n'est pas deja la. Leve mw_3mf.ExactError."""
    from .mw_3mf import ExactError, _download, parse_project, cached
    from .makerworld_account import token
    dest = path_of(iid)
    if dest.is_file():
        return dest
    with _LOCK:
        if iid in _BUSY:
            raise ExactError("Déjà en cours de récupération")
        _BUSY.add(iid)
    try:
        tok = await token()
        if not tok:
            raise ExactError("Compte MakerWorld non connecté (Paramètres → Données → MakerWorld)")
        data = await asyncio.to_thread(_download, iid, tok)
        try:
            zipfile.ZipFile(io.BytesIO(data)).close()
        except zipfile.BadZipFile:
            raise ExactError("Le fichier reçu n'est pas un 3MF")
        tmp = dest.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
        # au passage, les filaments exacts du profil (meme fichier : pas de second telechargement plus tard)
        if cached(iid) is None:
            try:
                (_dir() / f"{iid}.json").write_text(json.dumps(parse_project(data), ensure_ascii=False), encoding="utf-8")
            except Exception:
                pass
        logger.info(f"[MW-3MF] instance {iid} : 3MF d'origine garde ({len(data) // 1024} Ko)")
        return dest
    finally:
        with _LOCK:
            _BUSY.discard(iid)


async def for_print(pid: int) -> dict:
    """Le 3MF d'origine d'une impression : rend {"ok": iid} ou {"skip": raison} ; ne leve pas."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .mw_3mf import ExactError
    async with AsyncSessionLocal() as db:
        r = (await db.execute(select(Print.design_id, Print.mw_profile_id).where(Print.id == pid))).first()
    if not r or not r[0] or not str(r[0]).isdigit():
        return {"skip": "pas de modèle MakerWorld"}
    did, prof = str(r[0]), str(r[1] or "")
    if not prof or prof == "0":
        return {"skip": "profil inconnu"}
    iid = known(did, prof)
    if iid:
        return {"ok": iid, "already": True}
    iid = await resolve(did, prof)
    if not iid:
        return {"skip": "profil introuvable sur la fiche du modèle"}
    try:
        await fetch(iid)
    except ExactError as e:
        return {"skip": str(e)}
    except Exception as e:
        logger.exception("[MW-3MF] recuperation")
        return {"skip": f"{type(e).__name__}"}
    _index_put(f"{did}:{prof}", iid)
    return {"ok": iid}


def print_file(design_id, profile_id) -> Path | None:
    iid = known(design_id, profile_id) if design_id and profile_id else None
    return path_of(iid) if iid else None


# ── Le rattrapage : toutes les impressions liees a un profil, une par une, en arriere-plan ──
def _job_save() -> None:
    try:
        (_dir() / "backfill.json").write_text(json.dumps(JOB, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def status() -> dict:
    if not JOB:
        try:
            JOB.update(json.loads((_dir() / "backfill.json").read_text(encoding="utf-8")))
            if JOB.get("running"):            # l'appli a redemarre pendant le rattrapage
                JOB.update(running=False, stopped="Interrompu par un redémarrage")
        except (OSError, ValueError):
            pass
    return dict(JOB) or {"running": False}


async def _pairs() -> list:
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.design_id, Print.mw_profile_id, Print.file_name)
                                 .where(Print.design_id.is_not(None), Print.mw_profile_id.is_not(None))
                                 .order_by(Print.id.desc()))).all()
    seen, out = set(), []
    for did, prof, name in rows:
        k = (str(did), str(prof))
        if str(did).isdigit() and prof and prof != "0" and k not in seen:
            seen.add(k)
            out.append((str(did), str(prof), name or ""))
    return out


async def backfill() -> None:
    """Recupere tout ce qu'il peut ; l'avancement est lisible par status() (et survit a la page)."""
    from .mw_3mf import ExactError
    pairs = await _pairs()
    _STOP["flag"] = False
    JOB.clear()
    JOB.update(running=True, started=time.time(), finished=None, total=len(pairs), done=0, ok=0, already=0,
               skipped=0, failed=0, current=None, errors=[], stopped=None, bytes=0)
    _job_save()
    try:
        for did, prof, name in pairs:
            if _STOP["flag"]:
                JOB["stopped"] = "Arrêté"
                break
            JOB["current"] = name or f"Modèle {did}"
            if known(did, prof):
                JOB["already"] += 1
            else:
                iid = await resolve(did, prof)
                if not iid:
                    JOB["skipped"] += 1
                else:
                    try:
                        was = path_of(iid).is_file()
                        p = await fetch(iid)
                        _index_put(f"{did}:{prof}", iid)
                        if was:
                            JOB["already"] += 1
                        else:
                            JOB["ok"] += 1
                            JOB["bytes"] += p.stat().st_size
                            await asyncio.sleep(PAUSE_S)
                    except ExactError as e:
                        JOB["failed"] += 1
                        JOB["errors"] = (JOB["errors"] + [f"{name or did} : {e}"])[-5:]
                        if "Jeton" in str(e) or "non connecté" in str(e):
                            JOB["stopped"] = str(e)
                            break
            JOB["done"] += 1
            _job_save()
    except Exception as e:
        logger.exception("[MW-3MF] rattrapage")
        JOB["stopped"] = f"Erreur : {type(e).__name__}"
    finally:
        JOB.update(running=False, finished=time.time(), current=None)
        _job_save()


def start_backfill() -> bool:
    if JOB.get("running"):
        return False
    JOB["running"] = True                      # tout de suite : un second clic ne relance pas
    asyncio.get_running_loop().create_task(backfill())
    return True


def stop_backfill() -> None:
    _STOP["flag"] = True
