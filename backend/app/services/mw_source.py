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

PAUSE_S = 12                     # entre deux telechargements du rattrapage (plus un hasard de 0 a 18 s)
PAUSE_RAND_S = 18
# MakerWorld finit par demander « es-tu un robot ? » (HTTP 418) quand on enchaine. Le blocage tient au
# reseau ou au compte (captcha aussi dans le navigateur) et de courtes pauses ne le levaient pas : le rattrapage
# se suspend tout de suite. Depuis le 28/10/2026, il reessaie une fois de lui-meme une heure plus tard (un
# rythme plus calme, 12 a 30 s entre deux fichiers, le rend plus rare) ; si ca bloque encore, il dit d'aller
# faire le captcha sur le site, et « Reprendre » repart d'ou il en etait.
CAPTCHA_RETRY_S = 3600
_LOCK = threading.Lock()
_BUSY: set = set()               # instances en cours de telechargement
JOB: dict = {}                   # le rattrapage en cours (aussi sur disque : backfill.json)
_STOP = {"flag": False}
_PREP: set = set()               # conversions 3D lancees en fond (gardees : asyncio n'en retient qu'une reference faible)


def _dir() -> Path:
    from .mw_3mf import _dir as d
    return d()


def local_path_of(iid: str) -> Path:
    """Ou le 3MF d'origine d'une instance se range en local (telechargement)."""
    return _dir() / f"{iid}.3mf"


def path_of(iid: str) -> Path:
    """Le 3MF d'origine d'une instance : en local, sinon sa copie sur le NAS (vide du local par une purge,
    28/10/2026) ; sans aucun des deux, le chemin local (absent)."""
    p = local_path_of(iid)
    if p.is_file():
        return p
    try:
        from .archive import archived_path
        q = archived_path(f"lib:{iid}")
        if q is not None:
            return q
    except Exception:
        pass
    return p


_IDX = {"mt": None, "v": {}, "at": 0.0}


def _index() -> dict:
    """index.json, relu seulement quand il change (la liste des impressions le consulte pour chacune) ; sa date
    n'est regardee qu'une fois par seconde au plus (27/10/2026), une ecriture d'ici met la memoire a jour."""
    import time as _t
    if _IDX["mt"] is not None and _t.monotonic() - _IDX["at"] < 1.0:
        return dict(_IDX["v"])
    f = _dir() / "index.json"
    try:
        mt = f.stat().st_mtime
        _IDX["at"] = _t.monotonic()
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
            try:
                _IDX.update(mt=(_dir() / "index.json").stat().st_mtime, v=d, at=0.0)
            except OSError:
                pass


def known(design_id, profile_id) -> str | None:
    """L'instance deja recuperee pour ce modele et ce profil (sans rien demander a MakerWorld). Profil vide :
    celle choisie pour le modele quand le profil imprime est inconnu ou n'existe plus."""
    _index()                                   # relu s'il a change ; puis lu sans copie (une cle, pour chaque impression)
    iid = _IDX["v"].get(f"{design_id}:{profile_id or ''}")
    return iid if iid and path_of(iid).is_file() else None


def rate_limited(e) -> bool:
    m = str(e)
    return "HTTP 418" in m or "HTTP 429" in m or "robot" in m.lower()


# MakerWorld limite aussi les telechargements par jour (HTTP 400 « You've reached your daily download limit »,
# 24/10/2026, vers 55 fichiers) : rien a faire qu'attendre ; le rattrapage reprend seul 24 h plus tard
DAILY_S = 24 * 3600


# La limite de MakerWorld vaut pour tout le compte : epuisee par le rattrapage, elle empeche de lancer une
# impression depuis MakerWorld jusqu'au lendemain. Le rattrapage a donc son propre quota (par 24 h glissantes),
# reglable dans la carte ; les 3MF pris au lancement des impressions n'y sont pas soumis.
BUDGET_KEY = "MW_SOURCE_DAILY_BUDGET"
BUDGET_DEFAULT = 50


def _downloads() -> list:
    """Heures des 3MF d'origine recuperes dans les dernieres 24 h, lues sur les fichiers eux-memes : le premier
    rattrapage (avant ce compte) et les 3MF pris au lancement des impressions comptent aussi, comme pour la
    limite de MakerWorld."""
    now = time.time()
    out = []
    for f in _dir().glob("*.3mf"):
        try:
            t = f.stat().st_mtime
        except OSError:
            continue
        if now - t < DAILY_S:
            out.append(t)
    return sorted(out)


def _note_download() -> None:
    """Rien a noter : le fichier ecrit fait foi (voir _downloads)."""


async def budget() -> int:
    """Le quota par 24 h du rattrapage (0 : sans limite)."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        v = await get_setting(db, BUDGET_KEY, str(BUDGET_DEFAULT))
    try:
        return max(0, int(v))
    except (TypeError, ValueError):
        return BUDGET_DEFAULT


async def set_budget(n: int) -> int:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    n = max(0, min(500, int(n)))
    async with AsyncSessionLocal() as db:
        await set_setting(db, BUDGET_KEY, str(n))
    return n


def daily_limited(e) -> bool:
    m = str(e).lower()
    return "daily download limit" in m or ("daily" in m and "limit" in m)


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
    dest = path_of(iid)                           # en local ou sur le NAS : rien a telecharger
    if dest.is_file():
        return dest
    dest = local_path_of(iid)                     # a telecharger : en local, jamais sur le NAS
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
        # sa vue 3D, preparee tout de suite en fond (l'ouverture n'aura pas a attendre la conversion)
        try:
            from .mw_3d import prepare
            t = asyncio.get_running_loop().create_task(prepare(iid))
            _PREP.add(t)
            t.add_done_callback(_PREP.discard)
        except Exception:
            pass
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
        await attribute_plate(pid, iid)
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
    await attribute_plate(pid, iid)
    return {"ok": iid}


async def attribute_plate(pid: int, iid: str) -> None:
    """Le plateau d'origine qu'une impression a fait, reconnu aux noms des objets de son fichier imprime dans le 3MF
    d'origine (28/10/2026), pose sur elle (mw_plates, marque « auto ») si rien n'est choisi a la main : des
    l'arrivee d'une impression, tout est su -- modele, profil, plateau, bobines -- et la deduction ne sert qu'au passe."""
    import zipfile
    from sqlalchemy import select, update
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    try:
        async with AsyncSessionLocal() as db:
            r = (await db.execute(select(Print.model_3mf, Print.mw_plates, Print.mw_profile_id).where(Print.id == pid))).first()
        if not r or not r[0] or r[1]:
            return
        from .archive import local_or_archive
        from ..api.v1.routes.makerworld import _plate_objects, _sliced_objects, _plate_from_objects
        f, src = local_or_archive(r[0]), path_of(iid)
        if not f or not f.is_file() or not src.is_file():
            return
        with zipfile.ZipFile(src) as zo, zipfile.ZipFile(f) as zs:
            n = _plate_from_objects(_plate_objects(zo), _sliced_objects(zs))
        if not n:
            return
        prof = str(r[2] or "").strip()
        async with AsyncSessionLocal() as db:
            await db.execute(update(Print).where(Print.id == pid, Print.mw_plates.is_(None))
                             .values(mw_plates=json.dumps({"profile": prof if prof and prof != "0" else None, "plates": [int(n)], "auto": "objets"})))
            await db.commit()
        logger.info(f"[MW-3MF] impression {pid} : plateau {n} reconnu aux objets de son fichier imprime")
    except Exception:
        logger.exception("[MW-3MF] plateau aux objets")


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


_BY_DID = {"mt": None, "n": -1, "v": {}}


def own_key(pid) -> str:
    """La cle d'un 3MF d'origine importe a la main pour une impression sans modele MakerWorld (31/10/2026)."""
    return f"p{int(pid)}"


def save_upload(pid: int, design_id, profile, raw_path: Path) -> str:
    return save_upload_many([(pid, design_id, profile)], raw_path)


def save_upload_many(targets: list, raw_path: Path) -> str:
    """Un 3MF d'origine importe a la main (31/10/2026) : pour une impression sans modele MakerWorld, ou dont le
    modele n'est plus la (404, retire). Il doit garder sa geometrie (un 3MF tranche n'a que son G-code). Range dans la
    bibliotheque comme un telecharge : il sert ensuite a tout (vue 3D, telechargement, plateaux), a la place de celui
    de MakerWorld pour ce modele et ce profil. Rend son identifiant."""
    import re as _re
    import time as _t
    import zipfile
    try:
        with zipfile.ZipFile(raw_path) as z:
            names = z.namelist()
            if "3D/3dmodel.model" not in names:
                raise ValueError("Ce n'est pas un 3MF (pas de 3D/3dmodel.model)")
            root = z.read("3D/3dmodel.model")
            if b"<vertex" not in root and not any(n.startswith("3D/Objects/") for n in names):
                raise ValueError("Ce 3MF n'a pas de modèle (un 3MF tranché ne garde que le G-code) : prends le projet d'origine")
    except zipfile.BadZipFile:
        raise ValueError("Fichier illisible : ce n'est pas un 3MF")
    iid = f"up{int(targets[0][0])}_{int(_t.time())}"
    dest = local_path_of(iid)
    dest.parent.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.move(str(raw_path), dest)
    # chaque impression visee (une seule, ou celles d'un groupe) : la sienne, et son modele et son profil
    keys = []
    for pid, design_id, profile in targets:
        keys.append(f"{own_key(pid)}:")
        did = str(design_id or "").strip()
        if did.isdigit():
            prof = str(profile or "").strip()
            keys += [f"{did}:{prof}"] if prof and _re.fullmatch(r"\d+", prof) else []
            keys.append(f"{did}:")
    for k in dict.fromkeys(keys):
        _index_put(k, iid)
    return iid


def print_file(design_id, profile_id, manual=None, pid=None) -> Path | None:
    """Le 3MF d'origine d'une impression : celui de son profil, sinon celui retenu pour le modele ; sans modele
    MakerWorld, celui importe a la main pour elle (pid)."""
    if not design_id:
        iid = known(own_key(pid), "") if pid else None
        return path_of(iid) if iid else None
    prof = _profile(profile_id, manual)
    iid = (known(design_id, prof) if prof else None) or known(design_id, "")
    if not iid and prof and path_of(prof).is_file():
        iid = prof                                   # l'imprimante a donne l'identifiant d'instance : c'est le fichier
    if not iid and not prof:
        # profil inconnu (28/10/2026) : le 3MF garde pour ce modele sous un autre profil (vue 3D au profil deduit,
        # rattrapage…) plutot que rien ; s'il y en a plusieurs, le plus recent
        _index()
        if _BY_DID["mt"] != _IDX["mt"] or _BY_DID["n"] != len(_IDX["v"]):      # l'index range par modele, refait s'il change
            by: dict = {}
            for k, v in _IDX["v"].items():
                by.setdefault(k.split(":", 1)[0], set()).add(v)
            _BY_DID.update(mt=_IDX["mt"], n=len(_IDX["v"]), v=by)
        cands = {v for v in _BY_DID["v"].get(str(design_id), ()) if path_of(v).is_file()}
        if cands:
            iid = max(cands, key=lambda v: path_of(v).stat().st_mtime)
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
            if JOB.get("running"):            # l'appli a redemarre pendant le rattrapage (sans reprise prevue)
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
    blocks = list(JOB.get("blocks") or []) if JOB.get("resumed") else []   # une reprise garde l'historique des blocages
    resumed = bool(JOB.get("resumed"))
    # la reprise automatique apres un 418 ne se joue qu'une fois : la suivante attend ton captcha
    retried = bool(JOB.get("captcha_retried")) if resumed else False
    JOB.clear()
    JOB.update(running=True, started=time.time(), finished=None, total=len(pairs), done=0, ok=0, already=0,
               skipped=0, failed=0, current=None, errors=[], stopped=None, bytes=0, paused_until=None, guessed=0,
               blocks=blocks, resumed=resumed, resume_at=None, captcha=False, daily=False, budget=False,
               captcha_retried=retried)
    _job_save()
    cap = await budget()
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
                    log = _downloads()
                    if cap and not path_of(iid).is_file() and len(log) >= cap:
                        # le quota de l'appli est pris : on garde le reste pour les impressions ; reprise quand la plus
                        # ancienne recuperation a plus de 24 h (ce modele sera repris)
                        JOB.update(daily=True, budget=True, resume_at=log[0] + DAILY_S + 30,
                                   stopped=f"Quota de l'appli atteint ({cap} par 24 h)")
                        _job_save()
                        break
                    try:
                        was = path_of(iid).is_file()
                        p = await fetch(iid)
                        _index_put(key, iid)
                        if was:
                            JOB["already"] += 1
                        else:
                            JOB["ok"] += 1
                            JOB["bytes"] += p.stat().st_size
                            _note_download()
                            _job_save()
                            if not await nap(PAUSE_S + random.uniform(0, PAUSE_RAND_S)):
                                JOB["stopped"] = "Arrêté"
                    except ExactError as e:
                        if daily_limited(e):
                            # la limite du jour : suspendu, reprise toute seule demain (ce modele sera repris)
                            at = time.time() + DAILY_S
                            JOB["blocks"] = (JOB.get("blocks", []) + [{"at": time.time(), "ok": JOB["ok"], "daily": True}])[-10:]
                            JOB.update(daily=True, resume_at=at, stopped="Limite quotidienne de téléchargements MakerWorld atteinte")
                            _job_save()
                            break
                        if rate_limited(e):
                            # MakerWorld veut un captcha : on suspend (ce modele n'est pas compte, il sera repris) ;
                            # la premiere fois, nouvel essai tout seul une heure plus tard
                            JOB["blocks"] = (JOB.get("blocks", []) + [{"at": time.time(), "ok": JOB["ok"]}])[-10:]
                            if not JOB.get("captcha_retried"):
                                JOB.update(captcha=True, captcha_retried=True, resume_at=time.time() + CAPTCHA_RETRY_S,
                                           stopped="MakerWorld demande de vérifier que tu n'es pas un robot : nouvel essai dans une heure.")
                            else:
                                JOB.update(captcha=True, stopped="MakerWorld demande de vérifier que tu n'es pas un robot. Fais le captcha "
                                                                  "sur makerworld.com (même réseau, même compte), puis « Reprendre ».")
                            _job_save()
                            break
                        JOB["failed"] += 1
                        JOB["errors"] = (JOB["errors"] + [f"{name or did} : {e}"])[-5:]
                        if "Jeton" in str(e) or "non connecté" in str(e):
                            JOB["stopped"] = str(e)
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
    if (JOB.get("daily") or JOB.get("captcha")) and JOB.get("resume_at"):
        asyncio.get_running_loop().create_task(_resume_at(float(JOB["resume_at"])))


def start_backfill() -> bool:
    if JOB.get("running"):
        return False
    JOB["running"] = True                      # tout de suite : un second clic ne relance pas
    JOB["resumed"] = False                     # lance a la main : un nouvel historique des blocages
    asyncio.get_running_loop().create_task(backfill())
    return True


def stop_backfill() -> None:
    _STOP["flag"] = True
    if JOB.get("resume_at"):                  # une reprise prevue apres un redemarrage : annulee
        JOB.update(resume_at=None, stopped="Reprise automatique annulée")
        _job_save()


async def resume_after_restart() -> None:
    """Au demarrage : un rattrapage qui tournait a l'arret reprend tout seul apres une minute ; un rattrapage
    suspendu par la limite du jour (ou, une fois, par le controle anti-robot) reprend a l'heure prevue. Ce qui etait deja recupere compte en « deja la »."""
    try:
        d = json.loads((_dir() / "backfill.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if (d.get("daily") or d.get("captcha")) and d.get("resume_at"):
        JOB.clear()
        JOB.update(d)
        JOB.update(running=False, current=None, resumed=True)
        await _resume_at(float(d["resume_at"]))
        return
    if not d.get("running"):
        return
    if d.get("captcha"):
        return                                # suspendu pour un captcha : c'est a toi de reprendre
    at = time.time() + 60
    JOB.clear()
    JOB.update(d)
    JOB.update(running=False, current=None, paused_until=None, resume_at=at, resumed=True,
               stopped=None, finished=time.time())
    _job_save()
    logger.info(f"[MW-3MF] rattrapage interrompu par l'arret : reprise dans {int(at - time.time())} s")
    await _resume_at(at)


async def _resume_at(at: float) -> None:
    """Attend l'heure prevue puis relance le rattrapage, sauf s'il a ete annule ou relance a la main."""
    JOB["resumed"] = True
    while time.time() < at:
        if not JOB.get("resume_at") or JOB.get("running"):
            return                            # annulee, ou relancee a la main entre-temps
        await asyncio.sleep(min(5, max(0.0, at - time.time())))
    if JOB.get("resume_at") and not JOB.get("running"):
        JOB["running"] = True
        await backfill()



async def summary() -> dict:
    """Le bilan, hors de tout rattrapage : modeles et profils imprimes, deja gardes, encore a recuperer."""
    pairs = await _pairs()
    have = sum(1 for did, prof, _n in pairs if known(did, prof) or (not prof and known(did, "")))
    files = sum(1 for f in _dir().glob("*.3mf"))
    return {"pairs": len(pairs), "models": len({d for d, _p, _n in pairs}), "have": have, "missing": len(pairs) - have,
            "files": files}
