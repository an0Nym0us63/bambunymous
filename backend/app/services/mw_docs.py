"""
Documents joints aux modeles MakerWorld (27/10/2026) : notice d'assemblage, nomenclature, autres (une solution,
des conseils…), ceux du modele et ceux de ses profils. Publics chez MakerWorld (sans compte), ils sont gardes ici
pour chaque modele imprime : ils restent lisibles si le createur les retire, et la sauvegarde NAS les range avec
le modele.

Rangement : DATA_DIR/mw_docs/<design_id>/<id>-<nom>, ou <id> vient de l'adresse du document (stable d'une
lecture a l'autre). Le rattrapage relit les fiches des modeles deja imprimes (une a la fois, sans brusquer
MakerWorld) et garde leurs documents.
"""
import asyncio
import hashlib
import logging
import re
import time
from pathlib import Path

logger = logging.getLogger(__name__)

MAX_BYTES = 100 * 1024 * 1024          # un document plus gros n'est pas garde (on l'ouvre chez MakerWorld)
KIND_LABEL = {"guide": "Notice d'assemblage", "bom": "Nomenclature", "other": "Autre document"}
JOB: dict = {}
_STOP = {"flag": False}


def _root() -> Path:
    from ..core.config import settings
    return Path(settings.DATA_DIR) / "mw_docs"


def doc_id(url: str) -> str:
    return hashlib.sha1(str(url).encode("utf-8")).hexdigest()[:12]


def _safe(name: str) -> str:
    n = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", str(name or "")).strip().strip(".") or "document"
    return n[:150]


def local_path(did, doc: dict) -> Path:
    return _root() / str(did) / f"{doc_id(doc['url'])}-{_safe(doc.get('name'))}"


def kept(did, doc: dict) -> bool:
    try:
        p = local_path(did, doc)
        return p.is_file() and p.stat().st_size > 0
    except OSError:
        return False


def view(did, docs: list) -> list:
    """Les documents d'un modele pour l'appli : ou les ouvrir (ici si gardes, sinon chez MakerWorld)."""
    out = []
    for d in docs or []:
        if not isinstance(d, dict) or not d.get("url"):
            continue
        i = doc_id(d["url"])
        out.append({"id": i, "kind": d.get("kind") or "other", "label": KIND_LABEL.get(d.get("kind"), "Document"),
                    "name": d.get("name"), "profile_id": d.get("profile_id"), "profile": d.get("profile"),
                    "kept": kept(did, d), "href": f"/api/v1/makerworld/doc/{did}/{i}", "url": d["url"]})
    return out


def _download(url: str, dest: Path) -> int:
    import requests
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    n = 0
    with requests.get(url, stream=True, timeout=(10, 60), headers={"User-Agent": "Mozilla/5.0"}) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(256 * 1024):
                n += len(chunk)
                if n > MAX_BYTES:
                    raise ValueError("document trop lourd")
                f.write(chunk)
    if n == 0:
        tmp.unlink(missing_ok=True)
        raise ValueError("document vide")
    tmp.replace(dest)
    return n


def keep(did, docs: list) -> dict:
    """Garde ici les documents qui ne le sont pas encore. {kept, fetched, failed, bytes}."""
    res = {"kept": 0, "fetched": 0, "failed": 0, "bytes": 0}
    for d in docs or []:
        if not isinstance(d, dict) or not d.get("url"):
            continue
        if kept(did, d):
            res["kept"] += 1
            continue
        try:
            res["bytes"] += _download(d["url"], local_path(did, d))
            res["fetched"] += 1
            res["kept"] += 1
        except Exception as e:
            res["failed"] += 1
            logger.info(f"[MW] document de {did} non garde ({d.get('name')}) : {e}")
    return res


def _kept_files(did) -> dict:
    """Les documents gardes d'un modele : {nom de fichier: taille}."""
    d = _root() / str(did)
    try:
        return {f.name: f.stat().st_size for f in d.iterdir() if f.is_file() and not f.name.endswith(".part")} if d.is_dir() else {}
    except OSError:
        return {}


def keep_many(pairs) -> None:
    """(design_id, extras JSON) apres une relecture des fiches : leurs documents gardes."""
    from .makerworld import extras_of
    for did, raw in pairs or []:
        docs = extras_of(raw).get("docs") or []
        if docs:
            keep(did, docs)


async def _printed_designs() -> list:
    from sqlalchemy import select, distinct
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    async with AsyncSessionLocal() as db:
        ids = (await db.execute(select(distinct(Print.design_id)).where(Print.design_id.isnot(None)))).scalars().all()
    return sorted({str(x).strip() for x in ids if x and str(x).strip() not in ("", "0") and str(x).strip().isdigit()})


async def summary() -> dict:
    """Le bilan, toujours a jour : modeles imprimes, fiches relues, documents trouves et gardes."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import MakerWorldDesign as MW
    from .makerworld import extras_of
    ids = await _printed_designs()
    async with AsyncSessionLocal() as db:
        rows = {m.design_id: (m.status, m.extras) for m in (await db.execute(select(MW).where(MW.design_id.in_(ids)))).scalars().all()} if ids else {}
    def count():
        n_read = n_with = n_docs = n_kept = 0
        for did in ids:
            st, raw = rows.get(did, (None, None))
            if st != "ok" or raw is None:
                continue
            n_read += 1
            docs = extras_of(raw).get("docs") or []
            if docs:
                n_with += 1
                n_docs += len(docs)
                n_kept += sum(1 for d in docs if kept(did, d))
        return n_read, n_with, n_docs, n_kept
    n_read, n_with, n_docs, n_kept = await asyncio.to_thread(count)
    unread = sum(1 for did in ids if rows.get(did, (None, None))[0] != "notfound" and
                 (rows.get(did, (None, None))[0] != "ok" or rows.get(did, (None, None))[1] is None))
    return {"designs": len(ids), "read": n_read, "unread": unread, "with_docs": n_with, "docs": n_docs, "kept": n_kept}


def status() -> dict:
    return dict(JOB) or {"running": False}


async def backfill() -> None:
    """Le rattrapage : chaque modele imprime dont la fiche n'a pas encore ses documents est relu (1,5 s entre deux),
    puis ses documents sont gardes ; ceux des fiches deja lues aussi."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import MakerWorldDesign as MW
    from . import makerworld as mw
    from .makerworld import extras_of
    _STOP["flag"] = False
    ids = await _printed_designs()
    JOB.clear()
    JOB.update(running=True, total=len(ids), done=0, read=0, fetched=0, failed=0, bytes=0, current=None,
               started_at=time.time(), finished_at=None, error=None)
    try:
        for did in ids:
            if _STOP["flag"]:
                JOB["stopped"] = "Arrêté"
                break
            JOB["current"] = did
            had = await asyncio.to_thread(_kept_files, did)        # ce qui etait deja garde, pour le compte rendu
            async with AsyncSessionLocal() as db:
                m = await db.get(MW, did)
                need = m is None or m.status == "error" or (m.status == "ok" and m.extras is None)
            if need:
                r = await mw.refresh(limit=1, only=[did])     # garde aussi ses documents
                JOB["read"] += r.get("read", 0)
                await asyncio.sleep(1.5)
            async with AsyncSessionLocal() as db:
                m = await db.get(MW, did)
                docs = extras_of(m.extras).get("docs") if m is not None and m.status == "ok" else None
            if docs:
                r = await asyncio.to_thread(keep, did, docs)
                JOB["failed"] += r["failed"]
            # recuperes pendant ce passage (par la relecture de la fiche, ou juste au-dessus)
            now = await asyncio.to_thread(_kept_files, did)
            new = {k: v for k, v in now.items() if k not in had}
            JOB["fetched"] += len(new)
            JOB["bytes"] += sum(new.values())
            JOB["done"] += 1
    except Exception as e:
        logger.exception("[MW] rattrapage des documents")
        JOB["error"] = f"{type(e).__name__}: {e}"
    finally:
        JOB.update(running=False, current=None, finished_at=time.time())


_TASK = {"t": None}


def start_backfill() -> bool:
    if JOB.get("running"):
        return False
    # « en cours » des le clic : la liste des modeles se lit d'abord, et la carte suit l'etat
    JOB.clear()
    JOB.update(running=True, total=0, done=0, read=0, fetched=0, failed=0, bytes=0, current=None,
               started_at=time.time(), finished_at=None, error=None)
    _TASK["t"] = asyncio.get_running_loop().create_task(backfill())
    return True


def stop_backfill() -> None:
    _STOP["flag"] = True


async def find(did: str, docid: str):
    """(document, chemin garde ou None) d'apres la fiche gardee."""
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import MakerWorldDesign as MW
    from .makerworld import extras_of
    async with AsyncSessionLocal() as db:
        m = await db.get(MW, str(did))
    for d in (extras_of(m.extras).get("docs") or []) if m is not None else []:
        if isinstance(d, dict) and d.get("url") and doc_id(d["url"]) == docid:
            return d, (local_path(did, d) if kept(did, d) else None)
    return None, None
