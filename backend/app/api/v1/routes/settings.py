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
    Vide TOUTES les données : historique, filaments, bobines, snapshots, 3MF.
    Garde les settings (IP, token…).
    """
    import shutil, os
    from sqlalchemy import text
    from ....db.session import AsyncSessionLocal
    from pathlib import Path

    async with AsyncSessionLocal() as db:
        # Supprimer dans l'ordre FK
        for tbl in [
            "print_tags", "print_snapshots", "filament_usage", "prints",
            "bobines", "filaments", "settings"
        ]:
            try:
                await db.execute(text(f"DELETE FROM {tbl}"))
            except Exception:
                pass
        await db.commit()

    # Supprimer les fichiers prints (vignettes, snapshots, 3MF)
    data_dir = Path(os.getenv("DATA_DIR", "/data"))
    prints_dir = data_dir / "prints"
    if prints_dir.exists():
        shutil.rmtree(prints_dir, ignore_errors=True)
        prints_dir.mkdir(exist_ok=True)

    return {"ok": True, "message": "Toutes les données supprimées"}


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
    data = body.model_dump(exclude_none=True)

    for field, value in data.items():
        if field == "ADMIN_PASSWORD":
            if value:  # ne hash que si non vide
                await set_setting(db, "ADMIN_PASSWORD_HASH", hash_password(value))
        elif field == "PRINTER_ACCESS_CODE":
            if value:  # ne pas écraser si vide
                await set_setting(db, field, value)
                printer_changed = True
        else:
            await set_setting(db, field, value)
            if field in ("PRINTER_IP", "PRINTER_ID"):
                printer_changed = True

    if printer_changed:
        ip   = await get_setting(db, "PRINTER_IP")
        pid  = await get_setting(db, "PRINTER_ID")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")
        if ip and pid and code:
            mqtt_manager.reconnect(ip, pid, code)

    return {"ok": True}
