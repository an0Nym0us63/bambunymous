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


def kept_path(did, doc: dict):
    """Le document garde : en local, sinon sa copie sur le NAS (vide du local par une purge, 28/10/2026)."""
    try:
        p = local_path(did, doc)
        if p.is_file() and p.stat().st_size > 0:
            return p
    except OSError:
        pass
    try:
        from .archive import archived_path
        return archived_path(f"doc:{did}:{doc_id(doc['url'])}")
    except Exception:
        return None


def kept(did, doc: dict) -> bool:
    return kept_path(did, doc) is not None


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
    from .makerworld import extras_of, extras_stale
    ids = await _printed_designs()
    async with AsyncSessionLocal() as db:
        rows = {m.design_id: (m.status, m.extras) for m in (await db.execute(select(MW).where(MW.design_id.in_(ids)))).scalars().all()} if ids else {}
    def count():
        n_read = n_with = n_docs = n_kept = 0
        for did in ids:
            st, raw = rows.get(did, (None, None))
            if st != "ok" or extras_stale(raw):
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
                 (rows.get(did, (None, None))[0] != "ok" or extras_stale(rows.get(did, (None, None))[1])))
    # ce qui manque, dit (30/10/2026) : retire de MakerWorld, ou a relire (jamais lu, dont les modeles rattaches
    # apres coup, ou en erreur)
    missing = sum(1 for did in ids if rows.get(did, (None, None))[0] == "notfound")
    return {"designs": len(ids), "read": n_read, "unread": unread, "missing": missing, "with_docs": n_with, "docs": n_docs, "kept": n_kept}


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
                need = m is None or m.status not in ("ok", "notfound") or (m.status == "ok" and mw.extras_stale(m.extras))
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


# ── Les filaments recommandes, face au stock (27/10/2026) ──
_CAT = {"mt": None, "v": {}}
VARIANT_FR = {"refill": "Recharge", "filament with spool": "Filament avec bobine", "with spool": "Avec bobine"}


def _catalog() -> dict:
    """Le nuancier Bambu de l'appli, par code couleur : {code: {name_fr, hex, type}} (relu s'il a change)."""
    import json
    from ..core.config import settings
    p = Path(settings.DATA_DIR) / "bambu_catalog" / "filaments_color_codes.json"
    try:
        mt = p.stat().st_mtime
    except OSError:
        return {}
    if _CAT["mt"] != mt:
        out, en_fr = {}, {}
        try:
            data = json.loads(p.read_text(encoding="utf-8")).get("data", [])
        except (OSError, ValueError):
            data = []
        for e in data:
            n = e.get("fila_color_name") or {}
            if n.get("en") and n.get("fr"):
                en_fr[n["en"]] = n["fr"]
        for e in data:
            code = str(e.get("fila_color_code") or "").strip()
            if not code or code in out:
                continue
            n = e.get("fila_color_name") or {}
            cols = e.get("fila_color") or []
            out[code] = {"name_fr": n.get("fr") or en_fr.get(n.get("en", "")) or n.get("en") or "",
                         "hex": cols[0].lstrip("#")[:6] if cols else None, "type": e.get("fila_type") or ""}
        _CAT.update(mt=mt, v=out)
    return _CAT["v"]


def _split_title(title: str) -> tuple:
    """« Silver (13109) / Filament with spool / 1 kg » -> (« Silver », « Filament avec bobine », « 1 kg »)."""
    parts = [x.strip() for x in str(title or "").split("/")]
    color = re.sub(r"\s*\(\d+\)\s*$", "", parts[0]) if parts else ""
    variant = VARIANT_FR.get(parts[1].lower(), parts[1]) if len(parts) > 1 else ""
    size = parts[2].replace("1kg", "1 kg") if len(parts) > 2 else ""
    return color, variant, size


async def filaments_view(fils: list) -> list:
    """Les filaments recommandes d'un modele, en francais (nuancier Bambu), avec ce que j'en ai en stock :
    les filaments de meme code couleur, leurs bobines actives et ce qu'il en reste."""
    from sqlalchemy import select, func
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Filament, Spool
    fils = [f for f in fils or [] if isinstance(f, dict)]
    if not fils:
        return []
    codes = sorted({c for f in fils for c in f.get("codes") or []})
    stock: dict = {}
    if codes:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(Filament.id, Filament.fila_color_code, Filament.translated_name, Filament.name, Filament.color,
                       func.count(Spool.id), func.coalesce(func.sum(Spool.remaining_weight_g), 0))
                .outerjoin(Spool, (Spool.filament_id == Filament.id) & Spool.archived.is_(False))
                .where(Filament.fila_color_code.in_(codes)).group_by(Filament.id))).all()
        for fid, code, tr, nm, col, n, g in rows:
            e = stock.setdefault(str(code), {"filament_id": fid, "name": tr or nm, "color": col, "spools": 0, "grams": 0.0})
            e["spools"] += int(n or 0)
            e["grams"] += float(g or 0)
            if n and not e.get("_has"):                  # le filament qui a des bobines passe devant
                e.update(filament_id=fid, name=tr or nm, color=col, _has=True)
    cat = await asyncio.to_thread(_catalog)
    out = []
    for f in fils:
        code = (f.get("codes") or [None])[0]
        color, variant, size = _split_title(f.get("title"))
        c = cat.get(code) if code else None
        s = stock.get(code) if code else None
        out.append({"product": f.get("product"), "color": (c or {}).get("name_fr") or color, "code": code,
                    "variant": variant, "size": size, "quantity": f.get("quantity") or 1, "url": f.get("url"),
                    "image": f.get("image"), "hex": (s or {}).get("color") or (c or {}).get("hex"),
                    "stock": {k: v for k, v in s.items() if not k.startswith("_")} if s else None})
    return out


async def find(did: str, docid: str):
    """(document, chemin garde ou None) d'apres la fiche gardee."""
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import MakerWorldDesign as MW
    from .makerworld import extras_of
    async with AsyncSessionLocal() as db:
        m = await db.get(MW, str(did))
    for d in (extras_of(m.extras).get("docs") or []) if m is not None else []:
        if isinstance(d, dict) and d.get("url") and doc_id(d["url"]) == docid:
            return d, kept_path(did, d)
    return None, None
