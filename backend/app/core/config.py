from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    APP_NAME: str = "Spoolnymous"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-please"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 jours

    # DB
    DATA_DIR: str = "/data"
    DATABASE_URL: str = "sqlite+aiosqlite:////data/spoolnymous.db"
    UPLOADS_DIR: str = "/data/uploads"

    # Printer MQTT
    PRINTER_IP: str = ""
    PRINTER_ID: str = ""
    PRINTER_ACCESS_CODE: str = ""
    PRINTER_NAME: str = ""
    AUTO_SPEND: bool = True

    # Électricité (€/h)
    COST_BY_HOUR: float = 0.0

    # Vue 3D des 3MF d'origine (31/10/2026) : MW_3D=false n'en convertit aucun (l'apercu MakerWorld reste)
    MW_3D: bool = True

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
