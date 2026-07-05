"""
Import depuis Spoolnymous via sa route /api/export/bambunymous
"""
import aiohttp, zipfile, io, shutil, asyncio, os
from pathlib import Path
DATA_DIR = Path(os.getenv('DATA_DIR', '/data'))
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional
from .auth import get_current_user
from pathlib import Path as _Path

router = APIRouter(prefix="/import/spoolnymous", tags=["import"])

# État global de la tâche en cours
_task_state: dict = {"running": False, "steps": [], "done": False, "error": None}


class ImportRequest(BaseModel):
    url: str  # ex: http://192.168.1.42:7913


def _add_step(msg: str, ok: bool = True):
    _task_state["steps"].append({"msg": msg, "ok": ok})


async def _run_import(url: str):
    _task_state.update({"running": True, "steps": [], "done": False, "error": None})
    try:
        base_url = url.rstrip("/")

        # 1. Ping
        _add_step("Connexion à Spoolnymous…")
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as c:
            try:
                async with c.get(f"{base_url}/api/export/status") as r:
                    info = await r.json()
                _add_step(f"Connecté · DB {info.get('db_size_mb',0)} Mo · {info.get('prints_files',0)} fichiers prints · {info.get('uploads_files',0)} fichiers uploads")
            except Exception as e:
                _add_step(f"Impossible de joindre Spoolnymous : {e}", ok=False)
                _task_state.update({"running": False, "done": True, "error": str(e)})
                return

        # 2. Téléchargement du ZIP
        _add_step("Téléchargement du ZIP d'export (peut prendre du temps)…")
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=300)) as c:
                async with c.get(f"{base_url}/api/export/bambunymous") as r:
                    r.raise_for_status()
                    zip_data = await r.read()
            _add_step(f"ZIP reçu : {round(len(zip_data)/1024/1024, 1)} Mo")
        except Exception as e:
            _add_step(f"Erreur téléchargement : {e}", ok=False)
            _task_state.update({"running": False, "done": True, "error": str(e)})
            return

        # 3. Extraction
        _add_step("Extraction du ZIP…")
        tmp = DATA_DIR / "_spoolnymous_import"
        tmp.mkdir(parents=True, exist_ok=True)
        try:
            with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
                zf.extractall(tmp)
            members = zf.namelist()
            _add_step(f"Extrait : {len(members)} fichiers")
        except Exception as e:
            _add_step(f"Erreur extraction : {e}", ok=False)
            _task_state.update({"running": False, "done": True, "error": str(e)})
            return

        # 4. Import DB
        db_src = tmp / "db" / "spoolnymous.db"
        if db_src.exists():
            _add_step("Import de la base de données…")
            try:
                db_dest = DATA_DIR / "_import_spoolnymous.db"
                shutil.copy2(db_src, db_dest)
                from ....db.import_db import run_import as import_from_db
                from ....db.session import AsyncSessionLocal
                summary = await import_from_db(str(db_dest))
                _add_step(f"DB importée · {summary.get('prints',0)} prints · {summary.get('filaments',0)} filaments · {summary.get('groups',0)} groupes · {summary.get('spools',0)} bobines")
            except Exception as e:
                _add_step(f"Erreur import DB : {e}", ok=False)
        else:
            _add_step("Pas de DB dans le ZIP", ok=False)

        # 5. Copie des fichiers statiques
        static_src = tmp / "static"
        if static_src.exists():
            # Prints (thumbnails)
            prints_src = static_src / "prints"
            if prints_src.exists():
                prints_dst = DATA_DIR.parent / "static" / "prints"
                prints_dst.mkdir(parents=True, exist_ok=True)
                copied = 0
                for f in prints_src.rglob("*"):
                    if f.is_file():
                        dst = prints_dst / f.relative_to(prints_src)
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        if not dst.exists():
                            shutil.copy2(f, dst); copied += 1
                _add_step(f"Vignettes prints copiées : {copied} fichiers")

            # Uploads (filaments, groups, prints uploads, accessoires)
            uploads_src = static_src / "uploads"
            if uploads_src.exists():
                uploads_dst = DATA_DIR / "filaments"  # filaments
                counts = {}
                for cat in ["filaments", "prints", "groupes", "groups", "accessoires", "objects"]:
                    cat_src = uploads_src / cat
                    if not cat_src.exists(): continue
                    # Map cat → dossier BambuNymous
                    cat_map = {"filaments": "filaments", "prints": "prints",
                               "groupes": "groups", "groups": "groups",
                               "accessoires": "objects", "objects": "objects"}
                    dst_folder = DATA_DIR / cat_map.get(cat, cat)
                    dst_folder.mkdir(parents=True, exist_ok=True)
                    n = 0
                    for f in cat_src.rglob("*"):
                        if f.is_file():
                            dst = dst_folder / f.relative_to(cat_src)
                            dst.parent.mkdir(parents=True, exist_ok=True)
                            if not dst.exists():
                                shutil.copy2(f, dst); n += 1
                    if n: counts[cat] = n
                _add_step(f"Uploads copiés : " + " · ".join(f"{v} {k}" for k,v in counts.items()))
        else:
            _add_step("Pas de fichiers statiques dans le ZIP", ok=False)

        # 6. Nettoyage
        shutil.rmtree(tmp, ignore_errors=True)
        _add_step("Import terminé ✓")

    except Exception as e:
        _add_step(f"Erreur inattendue : {e}", ok=False)
        _task_state["error"] = str(e)
    finally:
        _task_state.update({"running": False, "done": True})


@router.post("")
async def start_import(body: ImportRequest, bg: BackgroundTasks, _: str = Depends(get_current_user)):
    if _task_state["running"]:
        raise HTTPException(409, "Import déjà en cours")
    bg.add_task(_run_import, body.url)
    return {"ok": True}


@router.get("/status")
async def import_status(_: str = Depends(get_current_user)):
    return _task_state
