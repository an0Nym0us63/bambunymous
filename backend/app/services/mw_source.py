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
import html
import io
import random
import json
import logging
import threading
import time
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

PAUSE_S = 45                     # entre deux telechargements du rattrapage (plus un hasard de 0 a 45 s)
# MakerWorld finit par demander « es-tu un robot ? » (HTTP 418) quand on enchaine : le rattrapage se met
# alors en pause, de plus en plus longue, et reprend seul le meme modele (24/10/2026, bloque vers 50 fichiers
# a 8-14 s d'ecart). Le blocage semble tenir a l'adresse ou au compte (captcha aussi dans le navigateur) :
# des pauses courtes ne servaient a rien, d'ou un rythme lent et des pauses longues.
BACKOFF_S = (1800, 7200, 21600)
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
    """L'instance deja recuperee pour ce modele et ce profil (sans rien demander a MakerWorld). Profil vide :
    celle choisie pour le modele quand le profil imprime est inconnu ou n'existe plus."""
    iid = _index().get(f"{design_id}:{profile_id or ''}")
    return iid if iid and path_of(iid).is_file() else None


def rate_limited(e) -> bool:
    m = str(e)
    return "HTTP 418" in m or "HTTP 429" in m or "robot" in m.lower()


async def resolve(design_id: str, profile_id: str, guess: bool = False) -> str | None:
    """Profil (ou instance : l'imprimante donne parfois l'une pour l'autre) -> instance a telecharger,
    d'apres la fiche du modele (en cache). guess : sans profil (ou s'il n'existe plus), le seul profil du
    modele, sinon le plus proche de mon imprimante (le classement de la fiche), sinon celui par defaut."""
    from .makerworld import _base, rank_profiles, my_printer
    base = await _base(str(design_id), stale_ok=True)
    if not isinstance(base, dict) or "error" in base:
        return None
    profs = [p for p in base.get("profiles") or [] if p.get("instance_id")]
    if profile_id:
        for p in profs:
            if profile_id in (str(p.get("instance_id")), str(p.get("profile_id") or "")):
                return str(p["instance_id"])
    if not guess or not profs:
        return None
    if len(profs) == 1:
        return str(profs[0]["instance_id"])
    try:
        ranked = rank_profiles(profs, await my_printer())
    except Exception:
        ranked = []
    best = (ranked or [None])[0] or next((p for p in profs if p.get("default")), profs[0])
    return str(best["instance_id"])


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
        r = (await db.execute(select(Print.design_id, Print.mw_profile_id, Print.mw_plates).where(Print.id == pid))).first()
    if not r or not r[0] or not str(r[0]).isdigit():
        return {"skip": "pas de modèle MakerWorld"}
    did, prof = str(r[0]), _profile(r[1], r[2])
    iid = known(did, prof) or (known(did, "") if not prof else None)
    if iid:
        return {"ok": iid, "already": True}
    iid = await resolve(did, prof) if prof else None
    key = f"{did}:{prof}"
    if not iid:
        # profil inconnu, ou retire du modele : celui du modele le plus proche
        iid, key = await resolve(did, "", guess=True), f"{did}:"
    if not iid:
        return {"skip": "modèle introuvable sur MakerWorld"}
    try:
        await fetch(iid)
    except ExactError as e:
        return {"skip": str(e)}
    except Exception as e:
        logger.exception("[MW-3MF] recuperation")
        return {"skip": f"{type(e).__name__}"}
    _index_put(key, iid)
    return {"ok": iid}


def _profile(prof, manual) -> str:
    """Le profil d'une impression : celui de l'imprimante, sinon celui des plateaux choisis a la main."""
    p = str(prof or "").strip()
    if p and p != "0":
        return p
    try:
        m = json.loads(manual) if manual else None
        q = str((m or {}).get("profile") or "").strip() if isinstance(m, dict) else ""
        return q if q and q != "0" else ""
    except (ValueError, TypeError):
        return ""


def print_file(design_id, profile_id, manual=None) -> Path | None:
    """Le 3MF d'origine d'une impression : celui de son profil, sinon celui retenu pour le modele."""
    if not design_id:
        return None
    prof = _profile(profile_id, manual)
    iid = (known(design_id, prof) if prof else None) or known(design_id, "")
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
        rows = (await db.execute(select(Print.design_id, Print.mw_profile_id, Print.mw_plates, Print.translated_name, Print.file_name)
                                 .where(Print.design_id.is_not(None)).order_by(Print.id.desc()))).all()
    # un modele imprime sans profil connu compte aussi (le profil le plus proche sera pris)
    seen, out = set(), []
    for did, prof, manual, tr, name in rows:
        k = (str(did), _profile(prof, manual))
        if str(did).isdigit() and k not in seen:
            seen.add(k)
            out.append((k[0], k[1], html.unescape(tr or name or "")))
    return out


async def backfill() -> None:
    """Recupere tout ce qu'il peut ; l'avancement est lisible par status() (et survit a la page)."""
    from .mw_3mf import ExactError
    pairs = await _pairs()
    _STOP["flag"] = False
    JOB.clear()
    JOB.update(running=True, started=time.time(), finished=None, total=len(pairs), done=0, ok=0, already=0,
               skipped=0, failed=0, current=None, errors=[], stopped=None, bytes=0, paused_until=None, guessed=0,
               blocks=[])
    _job_save()
    async def nap(sec) -> bool:
        """Attend sec secondes par petits bouts (« Arreter » repond tout de suite) ; False si arrete."""
        end = time.time() + sec
        while time.time() < end:
            if _STOP["flag"]:
                return False
            await asyncio.sleep(min(2, max(0.0, end - time.time())))
        return True
    try:
        for did, prof, name in pairs:
            if _STOP["flag"]:
                JOB["stopped"] = "Arrêté"
                break
            JOB["current"] = name or f"Modèle {did}"
            if known(did, prof) or (not prof and known(did, "")):
                JOB["already"] += 1
            else:
                iid, key = (await resolve(did, prof), f"{did}:{prof}") if prof else (None, None)
                if not iid:
                    iid, key = await resolve(did, "", guess=True), f"{did}:"
                    if iid:
                        JOB["guessed"] += 1
                if not iid:
                    JOB["skipped"] += 1
                else:
                    tries = 0
                    while True:
                        try:
                            was = path_of(iid).is_file()
                            p = await fetch(iid)
                            _index_put(key, iid)
                            if was:
                                JOB["already"] += 1
                            else:
                                JOB["ok"] += 1
                                JOB["bytes"] += p.stat().st_size
                                _job_save()
                                if not await nap(PAUSE_S + random.uniform(0, PAUSE_S)):
                                    JOB["stopped"] = "Arrêté"
                            break
                        except ExactError as e:
                            if rate_limited(e) and tries < len(BACKOFF_S):
                                # MakerWorld veut souffler : une pause, puis le meme modele ; on note quand (et apres
                                # combien de fichiers), de quoi regler le rythme
                                JOB["blocks"] = (JOB.get("blocks", []) + [{"at": time.time(), "ok": JOB["ok"]}])[-10:]
                                JOB["paused_until"] = time.time() + BACKOFF_S[tries]
                                _job_save()
                                ok = await nap(BACKOFF_S[tries])
                                JOB["paused_until"] = None
                                tries += 1
                                if not ok:
                                    JOB["stopped"] = "Arrêté"
                                    break
                                continue
                            JOB["failed"] += 1
                            JOB["errors"] = (JOB["errors"] + [f"{name or did} : {e}"])[-5:]
                            if rate_limited(e):
                                JOB["stopped"] = ("MakerWorld bloque encore après plusieurs heures de pause. Résous le captcha une fois sur "
                                                  "makerworld.com (même réseau, même compte), puis relance.")
                            elif "Jeton" in str(e) or "non connecté" in str(e):
                                JOB["stopped"] = str(e)
                            break
            JOB["done"] += 1
            _job_save()
            if JOB.get("stopped"):
                break
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



async def summary() -> dict:
    """Le bilan, hors de tout rattrapage : modeles et profils imprimes, deja gardes, encore a recuperer."""
    pairs = await _pairs()
    have = sum(1 for did, prof, _n in pairs if known(did, prof) or (not prof and known(did, "")))
    files = sum(1 for f in _dir().glob("*.3mf"))
    return {"pairs": len(pairs), "models": len({d for d, _p, _n in pairs}), "have": have, "missing": len(pairs) - have,
            "files": files}
