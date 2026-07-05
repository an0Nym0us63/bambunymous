from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from ....db.session import get_db
from ....services.settings_service import get_all_settings, set_setting, get_setting
from ....core.mqtt import mqtt_manager
from ....core.security import hash_password
from .auth import get_current_user

router = APIRouter()


@router.delete("/reset-all", tags=["settings"])
async def reset_all_data(_: str = Depends(get_current_user)):
    """
    Vide TOUTES les données : historique, filaments, bobines, snapshots, 3MF,
    ainsi que tous les fichiers images associés (prints, filaments, groupes, uploads, tmp).
    Garde les settings (IP, token…) et la base settings elle-même.
    """
    import shutil, os
    from sqlalchemy import text
    from ....db.session import AsyncSessionLocal
    from pathlib import Path

    async with AsyncSessionLocal() as db:
        # Supprimer dans l'ordre FK
        for tbl in [
            "print_tags", "print_snapshots", "filament_usage", "prints",
            "bobines", "filaments", "groups",
            "object_accessories", "objects", "object_groups",
        ]:
            try:
                await db.execute(text(f"DELETE FROM {tbl}"))
            except Exception:
                pass
        await db.commit()

    # Supprimer tous les fichiers/images associés (prints, filaments, groupes, uploads, tmp)
    data_dir = Path(os.getenv("DATA_DIR", "/data"))
    for sub in ("prints", "filaments", "groups", "uploads", "tmp", "objects", "accessories"):
        d = data_dir / sub
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True, exist_ok=True)

    return {"ok": True, "message": "Toutes les données et images supprimées"}


@router.get("/ams-order")
async def get_ams_order(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """Ordre d'affichage personnalisé des AMS sur l'accueil (4 positions)."""
    import json
    raw = await get_setting(db, "AMS_ORDER")
    try:
        order = json.loads(raw) if raw else []
    except Exception:
        order = []
    return {"order": order}


@router.post("/ams-order")
async def set_ams_order(body: dict, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """
    body: {"order": [ams_id, ams_id, null, ams_id]} — 4 positions (A/B/C/D),
    null pour une position vide. Sert à placer manuellement les AMS sur l'accueil.
    """
    import json
    order = body.get("order", [])
    await set_setting(db, "AMS_ORDER", json.dumps(order))
    return {"ok": True, "order": order}


class SettingsOut(BaseModel):
    PRINTER_IP: str = ""
    PRINTER_ID: str = ""
    PRINTER_ACCESS_CODE_SET: bool = False   # indique si un code est configuré, sans l'exposer
    PRINTER_NAME: str = ""
    ADMIN_USERNAME: str = "admin"
    COST_BY_HOUR: str = "0"


class SettingsUpdate(BaseModel):
    PRINTER_IP: Optional[str] = None
    PRINTER_ID: Optional[str] = None
    PRINTER_ACCESS_CODE: Optional[str] = None   # None = ne pas toucher
    PRINTER_NAME: Optional[str] = None
    ADMIN_USERNAME: Optional[str] = None
    ADMIN_PASSWORD: Optional[str] = None
    COST_BY_HOUR: Optional[str] = None


@router.get("", response_model=SettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    all_s = await get_all_settings(db)
    return SettingsOut(
        PRINTER_IP=all_s.get("PRINTER_IP", ""),
        PRINTER_ID=all_s.get("PRINTER_ID", ""),
        PRINTER_ACCESS_CODE_SET=bool(all_s.get("PRINTER_ACCESS_CODE")),
        PRINTER_NAME=all_s.get("PRINTER_NAME", ""),
        ADMIN_USERNAME=all_s.get("ADMIN_USERNAME", "admin"),
        COST_BY_HOUR=all_s.get("COST_BY_HOUR", "0"),
    )


@router.patch("")
async def update_settings(
    body: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    printer_changed = False
    elec_changed = False
    data = body.model_dump(exclude_none=True)

    for field, value in data.items():
        if field == "ADMIN_PASSWORD":
            if value:
                await set_setting(db, "ADMIN_PASSWORD_HASH", hash_password(value))
        elif field == "PRINTER_ACCESS_CODE":
            if value:
                await set_setting(db, field, value)
                printer_changed = True
        else:
            await set_setting(db, field, value)
            if field in ("PRINTER_IP", "PRINTER_ID"):
                printer_changed = True
            if field == "COST_BY_HOUR":
                elec_changed = True

    if printer_changed:
        ip   = await get_setting(db, "PRINTER_IP")
        pid  = await get_setting(db, "PRINTER_ID")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")
        if ip and pid and code:
            mqtt_manager.reconnect(ip, pid, code)

    if elec_changed:
        # Recalcul de tous les prints en arrière-plan
        import threading, asyncio as _aio
        def _recalc_all():
            loop = _aio.new_event_loop()
            async def _go():
                from ....db.session import AsyncSessionLocal
                from ....models.print_history import Print
                from sqlalchemy import select as _sel
                from ....services.print_tracker import recalculate_print
                async with AsyncSessionLocal() as db2:
                    pids = (await db2.execute(_sel(Print.id).where(Print.status == "SUCCESS"))).scalars().all()
                for pid in pids: await recalculate_print(pid)
            try: loop.run_until_complete(_go())
            finally: loop.close()
        threading.Thread(target=_recalc_all, daemon=True).start()

    return {"ok": True}
