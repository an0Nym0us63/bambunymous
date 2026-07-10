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

        # 1. Ping + récupération settings
        _add_step("Connexion à Spoolnymous…")
        spoolnymous_settings = {}
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as c:
            try:
                async with c.get(f"{base_url}/api/export/status") as r:
                    info = await r.json()
                spoolnymous_settings = info.get("settings", {})
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
                summary = await import_from_db(str(db_dest), local_to_utc=True)
                _add_step(f"DB importée · {summary.get('prints',0)} prints · {summary.get('filaments',0)} filaments · {summary.get('groups',0)} groupes · {summary.get('spools',0)} bobines")
            except Exception as e:
                _add_step(f"Erreur import DB : {e}", ok=False)
        else:
            _add_step("Pas de DB dans le ZIP", ok=False)

        # 5. Réutiliser exactement les mêmes importers que l'import manuel par ZIP
        from ....services.zip_importer import (
            import_prints_zip, import_uploads_prints_zip,
            import_uploads_filaments_zip, import_uploads_groups_zip,
            import_uploads_accessories_zip,
        )

        static_src = tmp / "static"

        def _make_zip(src_dir: Path):
            """Crée un ZIP en mémoire depuis un dossier (arcnames en string)."""
            if not src_dir or not src_dir.exists(): return None
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
                for f in src_dir.rglob("*"):
                    if f.is_file():
                        zf.write(str(f), str(f.relative_to(src_dir)))
            buf.seek(0)
            return buf

        # 5a. Vignettes prints → import_prints_zip (même logique que l'import manuel)
        zb = _make_zip(static_src / "prints")
        if zb:
            try:
                r = await import_prints_zip(zb)
                _add_step(f"Vignettes prints : {r.get('matched',0)} liées, {r.get('unmatched',0)} non trouvées")
            except Exception as e: _add_step(f"Vignettes prints erreur : {e}", ok=False)

        # 5b. Photos uploads/prints → import_uploads_prints_zip
        zb = _make_zip(static_src / "uploads" / "prints")
        if zb:
            try:
                r = await import_uploads_prints_zip(zb)
                _add_step(f"Photos prints : {r.get('copied',0)} copiées")
            except Exception as e: _add_step(f"Photos prints erreur : {e}", ok=False)

        # 5c. Photos filaments → import_uploads_filaments_zip
        zb = _make_zip(static_src / "uploads" / "filaments")
        if zb:
            try:
                r = await import_uploads_filaments_zip(zb)
                _add_step(f"Photos filaments : {r.get('copied',0)} copiées")
            except Exception as e: _add_step(f"Photos filaments erreur : {e}", ok=False)

        # 5d. Photos groupes → import_uploads_groups_zip
        for gdir in ["groupes", "groups"]:
            zb = _make_zip(static_src / "uploads" / gdir)
            if zb:
                try:
                    r = await import_uploads_groups_zip(zb)
                    _add_step(f"Photos groupes : {r.get('copied',0)} copiées")
                    break
                except Exception as e: _add_step(f"Photos groupes erreur : {e}", ok=False)

        # 5e. Photos accessoires -> import_uploads_accessories_zip
        _acc_zb = None
        for _dn in ["accessories", "accessoires"]:
            _acc_zb = _make_zip(static_src / "uploads" / _dn)
            if _acc_zb:
                break
        if _acc_zb:
            try:
                r = await import_uploads_accessories_zip(_acc_zb)
                _add_step(f"Photos accessoires : {r.get('copied',0)} copiees")
            except Exception as e:
                _add_step(f"Photos accessoires erreur : {e}", ok=False)
        else:
            _add_step("Dossier accessories absent du ZIP", ok=False)

        # 7. Import settings imprimante et électricité (si non renseignés)
        from ....services.settings_service import get_setting as _gs, set_setting as _ss
        from ....db.session import AsyncSessionLocal as _ASL2
        _imported = []
        try:
            async with _ASL2() as _db2:
                for _k, _v in {
                    "PRINTER_IP":          spoolnymous_settings.get("printer_ip"),
                    "PRINTER_ACCESS_CODE": spoolnymous_settings.get("printer_code"),
                    "PRINTER_DISPLAY_NAME":spoolnymous_settings.get("printer_name"),
                    "COST_BY_HOUR":        str(spoolnymous_settings.get("electricity_kwh") or "") or None,
                }.items():
                    if not _v: continue
                    if not await _gs(_db2, _k):
                        await _ss(_db2, _k, str(_v)); _imported.append(_k)
                await _db2.commit()
            _sn_vals = {
                'PRINTER_IP': spoolnymous_settings.get('printer_ip'),
                'PRINTER_ACCESS_CODE': spoolnymous_settings.get('printer_code'),
                'PRINTER_DISPLAY_NAME': spoolnymous_settings.get('printer_name'),
                'COST_BY_HOUR': str(spoolnymous_settings.get('electricity_kwh') or ''),
            }
            for _k, _new in _sn_vals.items():
                if not _new: continue
                _cur = await _gs(_db2, _k) or '(vide)'
                _tag = ' ✓ importé' if _k in _imported else ''
                _add_step(f'{_k} : {_cur} → {_new}{_tag}')
                _add_step('Paramètres : déjà renseignés')
        except Exception as e:
            _add_step(f"Paramètres erreur : {e}", ok=False)

        # 8. Nettoyage
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
