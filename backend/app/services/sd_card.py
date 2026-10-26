"""La carte SD de l'imprimante, en lecture (26/10/2026).

Meme porte que la recuperation des 3MF (services/tmf_parser.py) : FTPS implicite sur le reseau local,
utilisateur « bblp », mot de passe = code d'acces LAN (jamais renvoye a la page). Pour commencer, une
sonde : ce qu'il y a a la racine et dans « timelapse », pour savoir si l'imprimante ouvre ces dossiers
avant de construire la lecture des videos.
"""
from __future__ import annotations

import asyncio
import logging
import re

logger = logging.getLogger(__name__)

# « -rw-rw-rw-   1 user  group   1234567 Oct 25 18:30 video_2026-10-25_18-30-12.mp4 »
_LIST = re.compile(r"^([dl-])[rwx-]{9}\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4}))\s+(.+)$")


def parse_list(lines: list[str]) -> list[dict]:
    out = []
    for ln in lines:
        m = _LIST.match(ln.strip())
        if not m:
            continue
        kind, size, when, name = m.groups()
        if name in (".", ".."):
            continue
        out.append({"name": name, "dir": kind == "d", "size": int(size), "when": when})
    return out


def _list_sync(ip: str, code: str, path: str) -> list[str]:
    """LIST d'un dossier ; leve une exception lisible si l'imprimante refuse."""
    import io
    import pycurl
    buf = io.BytesIO()
    c = pycurl.Curl()
    try:
        for opt, val in [
            (c.URL, f"ftps://{ip}{path if path.endswith('/') else path + '/'}"), (c.USERPWD, f"bblp:{code}"),
            (c.SSL_VERIFYPEER, 0), (c.SSL_VERIFYHOST, 0),
            (c.FTP_SSL, c.FTPSSL_ALL), (c.FTPSSLAUTH, c.FTPAUTH_TLS),
            (c.CONNECTTIMEOUT, 10), (c.TIMEOUT, 30), (c.WRITEDATA, buf),
        ]:
            c.setopt(opt, val)
        c.perform()
    finally:
        c.close()
    return buf.getvalue().decode("utf-8", "replace").splitlines()


def _why(e: Exception) -> str:
    s = str(e)
    if "(67" in s or "530" in s or "Login" in s:
        return "l'imprimante refuse la connexion (code d'accès ?)"
    if "(7" in s or "(28" in s or "timed out" in s.lower():
        return "l'imprimante ne répond pas sur le FTP (adresse, réseau, ou FTP fermé)"
    if "(9" in s or "550" in s or "(78" in s:
        return "dossier introuvable"
    return s[:200]


async def probe() -> dict:
    """Ce qu'il y a a la racine de la carte et dans « timelapse » (et ses vignettes)."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        ip = (await get_setting(db, "PRINTER_IP") or "").strip()
        code = (await get_setting(db, "PRINTER_ACCESS_CODE") or "").strip()
    if not ip or not code:
        return {"ok": False, "error": "Adresse IP ou code d'accès de l'imprimante manquant (Paramètres → Imprimante)."}
    out = {"ok": True, "ip": ip, "folders": {}}
    for path in ("/", "/timelapse", "/timelapse/thumbnail"):
        try:
            lines = await asyncio.wait_for(asyncio.to_thread(_list_sync, ip, code, path), timeout=45)
            items = parse_list(lines)
            out["folders"][path] = {"items": items[:200], "count": len(items), "raw": lines[:5] if not items and lines else []}
        except Exception as e:
            logger.info(f"[SD] {path} : {e}")
            out["folders"][path] = {"error": _why(e)}
            if path == "/":
                out["ok"] = False
                out["error"] = _why(e)
                break
    return out



# ── Les timelapses (26/10/2026) ───────────────────────────────────────────────────────────────────
# « /timelapse/video_2026-06-25_20-25-08.mp4 », sa vignette « /timelapse/thumbnail/video_….jpg ». Le nom
# porte le depart a l'heure de l'imprimante ; la date du fichier (LIST) sa fin, en temps universel.
import time as _time
from datetime import datetime as _dt, timedelta as _td
from pathlib import Path as _Path

NAME_RE = re.compile(r"^video_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(mp4|avi)$")
_MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
_LIST_CACHE = {"t": 0.0, "v": None}
_LOCKS: dict = {}
CACHE_MAX = 1536 * 1024 * 1024          # videos gardees sur le serveur : 1,5 Go au plus
# Copies depuis la carte, peu a la fois : une galerie qui en demandait des centaines saturait les fils de
# travail du serveur et ralentissait toute l'appli (26/10/2026). Une demande abandonnee entre-temps
# (fenetre fermee, autre video) n'est pas lancee.
_SEM: dict = {}


def _sem(kind: str) -> asyncio.Semaphore:
    if kind not in _SEM:
        _SEM[kind] = asyncio.Semaphore(2 if kind == "video" else 4)
    return _SEM[kind]


async def _creds():
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        ip = (await get_setting(db, "PRINTER_IP") or "").strip()
        code = (await get_setting(db, "PRINTER_ACCESS_CODE") or "").strip()
    if not ip or not code:
        raise SdError("Adresse IP ou code d'accès de l'imprimante manquant (Paramètres → Imprimante).")
    return ip, code


class SdError(Exception):
    pass


def _cache_dir(kind: str) -> _Path:
    from ..core.config import settings
    d = _Path(settings.DATA_DIR) / "cache" / "sd" / kind
    d.mkdir(parents=True, exist_ok=True)
    return d


def _name_dt(name: str):
    m = NAME_RE.match(name)
    return _dt(*map(int, m.groups()[:6])) if m else None


def _when_dt(when: str, ref: _dt):
    """« Jun 25 12:51 » (annee proche de ref) ou « Jan  3  2025 »."""
    try:
        parts = when.split()
        mo, day = _MONTHS[parts[0]], int(parts[1])
        if ":" in parts[2]:
            hh, mm = map(int, parts[2].split(":"))
            cands = [_dt(y, mo, day, hh, mm) for y in (ref.year - 1, ref.year, ref.year + 1)]
            return min(cands, key=lambda d: abs((d - ref).total_seconds()))
        return _dt(int(parts[2]), mo, day)
    except Exception:
        return None


def _download_sync(ip: str, code: str, path: str, dest: _Path) -> None:
    import pycurl
    tmp = dest.with_suffix(dest.suffix + ".part")
    c = pycurl.Curl()
    try:
        with open(tmp, "wb") as f:
            for opt, val in [
                (c.URL, f"ftps://{ip}{path}"), (c.USERPWD, f"bblp:{code}"),
                (c.SSL_VERIFYPEER, 0), (c.SSL_VERIFYHOST, 0),
                (c.FTP_SSL, c.FTPSSL_ALL), (c.FTPSSLAUTH, c.FTPAUTH_TLS),
                (c.CONNECTTIMEOUT, 10), (c.TIMEOUT, 600), (c.WRITEDATA, f),
            ]:
                c.setopt(opt, val)
            c.perform()
        tmp.replace(dest)
    finally:
        c.close()
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def _delete_sync(ip: str, code: str, paths: list[str]) -> None:
    import pycurl
    c = pycurl.Curl()
    try:
        for opt, val in [
            (c.URL, f"ftps://{ip}/"), (c.USERPWD, f"bblp:{code}"),
            (c.SSL_VERIFYPEER, 0), (c.SSL_VERIFYHOST, 0),
            (c.FTP_SSL, c.FTPSSL_ALL), (c.FTPSSLAUTH, c.FTPAUTH_TLS),
            (c.CONNECTTIMEOUT, 10), (c.TIMEOUT, 30), (c.NOBODY, True),
            (c.POSTQUOTE, [f"DELE {p}".encode() for p in paths]),
        ]:
            c.setopt(opt, val)
        c.perform()
    finally:
        c.close()


def _prune(d: _Path) -> None:
    files = sorted((f for f in d.iterdir() if f.is_file() and not f.name.endswith(".part")), key=lambda f: f.stat().st_atime)
    total = sum(f.stat().st_size for f in files)
    while files and total > CACHE_MAX:
        f = files.pop(0)
        total -= f.stat().st_size
        f.unlink(missing_ok=True)


async def _match(items: list[dict]) -> None:
    """Chaque timelapse retrouve son impression. L'ecart entre l'heure du nom (imprimante) et le temps
    universel s'apprend sur les fichiers eux-memes : la date du fichier tombe a la fin d'une impression."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    starts = [it["start"] for it in items if it.get("start")]
    if not starts:
        return
    lo, hi = min(starts) - _td(days=2), max(starts) + _td(days=2)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.id, Print.print_date, Print.duration_seconds, Print.estimated_seconds, Print.file_name,
                                        Print.translated_name, Print.status, Print.original_name)
                                 .where(Print.print_date >= lo, Print.print_date <= hi))).all()
    if not rows:
        return
    _pair(items, rows)


def _pair(items: list[dict], rows: list) -> None:
    """Le rapprochement, par recherche dans des listes triees (27/10/2026) : chaque timelapse parcourait toutes
    les impressions de la periode, deux fois (pres d'un million de calculs de dates, 0,9 s d'un bloc qui figeait
    le serveur). Meme resultat, a l'egalite pres : la premiere impression lue gagne, comme avant."""
    from bisect import bisect_left, bisect_right
    ends = sorted(((r.print_date + _td(seconds=(r.duration_seconds or r.estimated_seconds or 0)), i, r)
                   for i, r in enumerate(rows) if r.print_date and (r.duration_seconds or r.estimated_seconds)),
                  key=lambda x: (x[0], x[1]))
    end_keys = [e[0] for e in ends]
    win = _td(seconds=20 * 60)
    votes: dict = {}
    for it in items:
        end = it.get("end")
        if not end or not it.get("start"):
            continue
        for _e, _i, r in ends[bisect_left(end_keys, end - win):bisect_right(end_keys, end + win)]:
            off = round((it["start"] - r.print_date).total_seconds() / 900) * 900
            votes[off] = votes.get(off, 0) + 1
    off = max(votes.items(), key=lambda kv: kv[1])[0] if votes and max(votes.values()) >= 2 else 0
    starts = sorted(((r.print_date, i, r) for i, r in enumerate(rows) if r.print_date), key=lambda x: (x[0], x[1]))
    start_keys = [x[0] for x in starts]
    for it in items:
        if not it.get("start"):
            continue
        t = it["start"] - _td(seconds=off)
        it["at"] = t                              # le depart en temps universel (l'heure du nom, recalee)
        if not starts:
            continue
        # la plus proche : de part et d'autre de t ; a ecart egal, celle lue en premier (comme le min d'avant)
        k = bisect_left(start_keys, t)
        near = [starts[j] for j in (k - 1, k) if 0 <= j < len(starts)]
        lo_d = min(abs((x[0] - t).total_seconds()) for x in near)
        # toutes les impressions a cet ecart (memes dates comprises) : la premiere lue
        cand = [x for x in starts[bisect_left(start_keys, t - _td(seconds=lo_d)):bisect_right(start_keys, t + _td(seconds=lo_d))]
                if abs((x[0] - t).total_seconds()) == lo_d]
        best = min(cand, key=lambda x: x[1])[2]
        if best.print_date and abs((best.print_date - t).total_seconds()) <= 8 * 60:
            it["print"] = {"id": best.id, "name": best.translated_name or best.file_name or f"Impression #{best.id}",
                           "status": best.status,
                           # les autres noms, pour la recherche (l'original, le fichier)
                           "other": " ".join(x for x in (best.original_name, best.file_name) if x)}


def _attached(pid) -> bool:
    """Le timelapse de cette impression est-il deja dans sa fiche (en local, ou sur le NAS s'il a ete vide) ?"""
    from ..core.config import settings
    if (_Path(settings.DATA_DIR) / "prints" / str(pid) / AUTO_NAME).exists():
        return True
    try:
        from .archive import local_or_archive
        return local_or_archive(f"prints/{pid}/{AUTO_NAME}") is not None
    except Exception:
        return False


def _with_attached(out: dict) -> dict:
    """Chaque timelapse retrouve dit s'il est deja dans sa fiche (relu a chaque demande, pas garde en cache)."""
    return {**out, "items": [{**it, "attached": _attached(it["print"]["id"])} if it.get("print") else it for it in out["items"]]}


async def timelapses(fresh: bool = False) -> dict:
    """Les timelapses de la carte, du plus recent au plus ancien, avec leur impression quand on la retrouve."""
    if not fresh and _LIST_CACHE["v"] and _time.time() - _LIST_CACHE["t"] < 60:
        return await asyncio.to_thread(_with_attached, _LIST_CACHE["v"])
    return await asyncio.to_thread(_with_attached, await _timelapses_read())


async def _timelapses_read() -> dict:
    ip, code = await _creds()
    try:
        vids = parse_list(await asyncio.wait_for(asyncio.to_thread(_list_sync, ip, code, "/timelapse"), timeout=60))
    except SdError:
        raise
    except Exception as e:
        raise SdError(_why(e))
    try:
        thumbs = {x["name"] for x in parse_list(await asyncio.wait_for(asyncio.to_thread(_list_sync, ip, code, "/timelapse/thumbnail"), timeout=60))}
    except Exception:
        thumbs = set()
    items = []
    for v in vids:
        if v["dir"] or not NAME_RE.match(v["name"]):
            continue
        start = _name_dt(v["name"])
        base = v["name"].rsplit(".", 1)[0]
        items.append({"name": v["name"], "size": v["size"], "start": start, "end": _when_dt(v["when"], start) if start else None,
                      "thumb": f"{base}.jpg" in thumbs})
    await _match(items)
    items.sort(key=lambda it: it["start"] or _dt.min, reverse=True)
    out = {"items": [{**it, "start": it["start"].isoformat() if it["start"] else None,
                      "end": it["end"].isoformat() if it["end"] else None,
                      "at": it["at"].isoformat() + "Z" if it.get("at") else None} for it in items],
           "total": len(items), "bytes": sum(it["size"] for it in items)}
    _LIST_CACHE.update(t=_time.time(), v=out)
    return out


async def _fetch(kind: str, name: str, remote: str, gone=None) -> _Path:
    """Le fichier, copie dans le cache du serveur a la premiere demande (puis servi de la). `gone` : une
    fonction async qui dit si le demandeur est parti (on ne lance alors pas la copie)."""
    dest = _cache_dir(kind) / name
    if dest.exists() and dest.stat().st_size > 0:
        try:
            import os
            os.utime(dest)
        except OSError:
            pass
        return dest
    lock = _LOCKS.setdefault(f"{kind}:{name}", asyncio.Lock())
    async with lock, _sem(kind):
        if dest.exists() and dest.stat().st_size > 0:
            return dest
        if gone is not None and await gone():
            raise SdError("Demande abandonnée")
        ip, code = await _creds()
        try:
            await asyncio.to_thread(_download_sync, ip, code, remote, dest)
        except Exception as e:
            raise SdError(_why(e))
        if kind == "video":
            await asyncio.to_thread(_prune, _cache_dir("video"))
    return dest


async def thumb(name: str, gone=None) -> _Path:
    if not NAME_RE.match(name):
        raise SdError("Nom inconnu")
    base = name.rsplit(".", 1)[0]
    return await _fetch("thumb", f"{base}.jpg", f"/timelapse/thumbnail/{base}.jpg", gone)


async def video(name: str, gone=None) -> _Path:
    if not NAME_RE.match(name):
        raise SdError("Nom inconnu")
    return await _fetch("video", name, f"/timelapse/{name}", gone)


def _h264_sync(src: _Path, dest: _Path) -> None:
    """Une version que tout navigateur lit : H.264, son retire, l'index en tete (lecture immediate)."""
    import subprocess
    tmp = dest.with_suffix(".part.mp4")
    try:
        subprocess.run(["ffmpeg", "-y", "-i", str(src), "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
                        "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart",
                        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", str(tmp)], check=True, capture_output=True, timeout=900)
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)


async def video_h264(name: str, gone=None) -> _Path:
    """La video convertie (si le navigateur ne lit pas celle de l'imprimante), gardee comme l'originale."""
    src = await video(name, gone)
    dest = _cache_dir("video") / (name.rsplit(".", 1)[0] + ".h264.mp4")
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    lock = _LOCKS.setdefault(f"h264:{name}", asyncio.Lock())
    async with lock, _sem("h264"):
        if not (dest.exists() and dest.stat().st_size > 0):
            if gone is not None and await gone():
                raise SdError("Demande abandonnée")
            try:
                await asyncio.to_thread(_h264_sync, src, dest)
            except Exception as e:
                logger.warning(f"[SD] conversion de {name} : {e}")
                raise SdError("Conversion de la vidéo impossible")
    return dest


async def delete(name: str) -> None:
    if not NAME_RE.match(name):
        raise SdError("Nom inconnu")
    ip, code = await _creds()
    base = name.rsplit(".", 1)[0]
    try:
        await asyncio.to_thread(_delete_sync, ip, code, [f"/timelapse/{name}"])
    except Exception as e:
        raise SdError(_why(e))
    try:
        await asyncio.to_thread(_delete_sync, ip, code, [f"/timelapse/thumbnail/{base}.jpg"])
    except Exception:
        pass                                     # pas de vignette : rien a retirer
    for f in (_cache_dir("video") / name, _cache_dir("video") / f"{base}.h264.mp4", _cache_dir("thumb") / f"{base}.jpg"):
        f.unlink(missing_ok=True)
    _LIST_CACHE.update(t=0.0, v=None)



# ── Le timelapse de chaque impression, recupere tout seul (26/10/2026) ───────────────────────────
# Quelques minutes apres la fin d'une impression, son timelapse est copie de la carte dans son dossier
# (« Video-Timelapse.mp4 ») : il apparait parmi ses videos dans la fiche, se partage et se supprime comme
# elles. Une impression sans timelapse sur la carte (timelapse coupe) est reessayee deux jours, puis oubliee.
AUTO_NAME = "Video-Timelapse.mp4"
AUTO_EVERY = 300
AUTO_AFTER = 180                     # la video est ecrite a la fin : on laisse 3 min a l'imprimante
AUTO_WINDOW_DAYS = 3


def _auto_state_path() -> _Path:
    from ..core.config import settings
    return _Path(settings.DATA_DIR) / "cache" / "sd_auto.json"


def _auto_state() -> dict:
    import json
    try:
        d = json.loads(_auto_state_path().read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _auto_save(st: dict) -> None:
    import json
    p = _auto_state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    keep = dict(sorted(st.items(), key=lambda kv: -int(kv[0]))[:2000])
    p.write_text(json.dumps(keep), encoding="utf-8")


async def auto_fetch_once() -> int:
    """Copie les timelapses des impressions finies recemment qui n'en ont pas encore. Rend le nombre copie."""
    from sqlalchemy import select
    from ..core.config import settings
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    try:
        ip, code = await _creds()
    except SdError:
        return 0
    now = _dt.utcnow()
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.id, Print.print_date, Print.duration_seconds, Print.estimated_seconds, Print.status)
                                 .where(Print.print_date >= now - _td(days=AUTO_WINDOW_DAYS),
                                        Print.status.in_(("SUCCESS", "PARTIAL", "FAILED", "TO_REDO"))))).all()
    st = _auto_state()
    todo = []
    for r in rows:
        if st.get(str(r.id)) == "done":
            continue
        d = _Path(settings.DATA_DIR) / "prints" / str(r.id)
        if (d / AUTO_NAME).exists():
            st[str(r.id)] = "done"
            continue
        end = r.print_date + _td(seconds=r.duration_seconds or r.estimated_seconds or 0) if r.print_date else None
        if end and (now - end).total_seconds() < AUTO_AFTER:
            continue
        # pas trouve : 3 essais rapproches, puis un par heure (la carte n'est pas relue sans arret pour rien)
        tried = st.get(str(r.id)) if isinstance(st.get(str(r.id)), dict) else {}
        if (tried.get("n") or 0) >= 3 and _time.time() - (tried.get("at") or 0) < 3600:
            continue
        todo.append(r.id)
    if not todo:
        _auto_save(st)
        return 0
    try:
        lst = await timelapses(fresh=True)
    except Exception as e:
        logger.info(f"[SD] timelapses automatiques : carte illisible ({e})")
        return 0
    by_print = {it["print"]["id"]: it for it in lst["items"] if it.get("print")}
    n = 0
    for pid in todo:
        it = by_print.get(pid)
        if not it:
            prev = st.get(str(pid)) if isinstance(st.get(str(pid)), dict) else {}
            st[str(pid)] = {"n": (prev.get("n") or 0) + 1, "at": _time.time()}
            continue                              # pas (encore) de timelapse pour elle : on reessaiera
        d = _Path(settings.DATA_DIR) / "prints" / str(pid)
        d.mkdir(parents=True, exist_ok=True)
        try:
            async with _sem("video"):
                await asyncio.to_thread(_download_sync, ip, code, f"/timelapse/{it['name']}", d / AUTO_NAME)
            st[str(pid)] = "done"
            n += 1
            logger.info(f"[SD] timelapse de l'impression {pid} recupere ({it['name']})")
        except Exception as e:
            logger.info(f"[SD] timelapse de l'impression {pid} : {_why(e)}")
    _auto_save(st)
    return n


# ── Rattrapage (26/10/2026) : les timelapses deja sur l'imprimante, rattaches a leur impression passee ──
ATTACH: dict = {"running": False, "done": 0, "total": 0, "bytes": 0, "errors": 0, "current": None, "finished_at": None, "error": None}


async def attach_all() -> dict:
    """Copie dans leur fiche tous les timelapses retrouves qui n'y sont pas encore (un a la fois). Rend l'etat."""
    from ..core.config import settings
    if ATTACH["running"]:
        return dict(ATTACH)
    # « en cours » des le debut : la relecture de l'imprimante prend quelques secondes, et la page suit l'etat
    ATTACH.update(running=True, done=0, total=0, bytes=0, errors=0, current="lecture de l'imprimante", finished_at=None, error=None)
    try:
        lst = await timelapses(fresh=True)
        todo = [it for it in lst["items"] if it.get("print") and not it.get("attached")]
        ATTACH.update(total=len(todo), current=None)
        ip, code = await _creds()
        st = _auto_state()
        for it in todo:
            pid = it["print"]["id"]
            ATTACH["current"] = it["print"]["name"]
            if _attached(pid):                         # copie entre-temps (le passage automatique)
                ATTACH["done"] += 1
                continue
            d = _Path(settings.DATA_DIR) / "prints" / str(pid)
            d.mkdir(parents=True, exist_ok=True)
            try:
                async with _sem("video"):
                    await asyncio.to_thread(_download_sync, ip, code, f"/timelapse/{it['name']}", d / AUTO_NAME)
                st[str(pid)] = "done"
                ATTACH["bytes"] += it.get("size") or 0
                logger.info(f"[SD] rattrapage : timelapse de l'impression {pid} recupere ({it['name']})")
            except Exception as e:
                ATTACH["errors"] += 1
                logger.info(f"[SD] rattrapage : impression {pid} : {_why(e)}")
            ATTACH["done"] += 1
            if ATTACH["done"] % 10 == 0:
                _auto_save(st)
        _auto_save(st)
    except Exception as e:
        ATTACH["error"] = _why(e) if not isinstance(e, SdError) else str(e)
        logger.info(f"[SD] rattrapage interrompu : {ATTACH['error']}")
    finally:
        ATTACH.update(running=False, current=None, finished_at=_time.time())
    return dict(ATTACH)


async def auto_loop() -> None:
    await asyncio.sleep(90)
    while True:
        try:
            await auto_fetch_once()
        except Exception:
            logger.exception("[SD] timelapses automatiques")
        await asyncio.sleep(AUTO_EVERY)
