from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from ..core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    connect_args={
        "check_same_thread": False,
        "timeout": 30,           # attendre 30s si DB locked
    },
    pool_pre_ping=True,
)



AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    from ..models import setting, printer  # noqa - import pour créer les tables
    from ..models import filament, print_history, object_history  # noqa
    async with engine.begin() as conn:
        # WAL mode : permet lectures concurrentes, évite les database locked
        await conn.execute(__import__("sqlalchemy").text("PRAGMA journal_mode=WAL"))
        await conn.execute(__import__("sqlalchemy").text("PRAGMA busy_timeout=30000"))
        await conn.execute(__import__("sqlalchemy").text("PRAGMA synchronous=NORMAL"))
        await conn.run_sync(Base.metadata.create_all)
    # Migration automatique : ADD COLUMN si manquant
    await _migrate()
    # Backfill des colonnes calculées
    await _backfill_color_buckets()


async def _migrate():
    """Applique les colonnes manquantes sans perdre les données."""
    migrations = [
        # table, colonne, type SQL
        ("filaments", "translated_name",      "TEXT"),
        ("filaments", "external_filament_id", "TEXT"),
        ("filaments", "reference_id",         "TEXT"),
        ("filaments", "profile_id",           "TEXT"),
        ("filaments", "spool_weight_g",       "REAL"),
        ("filaments", "multicolor_type",      "TEXT DEFAULT 'monochrome'"),
        ("filaments", "colors_array",         "TEXT"),
        ("filaments", "swatch",               "INTEGER DEFAULT 0"),
        ("filaments", "transparent",          "INTEGER DEFAULT 0"),
        ("filaments", "to_order",             "INTEGER DEFAULT 0"),
        ("bobines",   "found_mode",           "TEXT"),
        ("bobines",   "ams_tray",             "TEXT"),
        ("bobines",   "external_spool_id",    "TEXT"),
        ("bobines",   "first_used_at",        "TEXT"),
        ("prints",    "number_of_items",      "INTEGER DEFAULT 1"),
        ("prints",    "sold_units",           "INTEGER DEFAULT 0"),
        ("prints",    "sold_price_total",     "REAL"),
        ("prints",    "margin",              "REAL DEFAULT 0"),
        ("prints",    "design_id",            "TEXT"),
        ("prints",    "original_name",        "TEXT"),
        ("prints",    "print_type",           "TEXT DEFAULT 'cloud'"),
        ("prints",    "status_note",          "TEXT"),
        ("prints",    "model_3mf",            "TEXT"),
        ("prints",    "external_ref",         "TEXT"),
        ("prints",    "plate_id",             "TEXT DEFAULT '1'"),
        ("prints",    "printer_model",        "TEXT DEFAULT 'H2C'"),
        ("prints",    "group_id",             "INTEGER"),
        ("filament_usage", "ams_id",          "INTEGER"),
        ("filament_usage", "tray_id",         "INTEGER"),
        ("filament_usage", "normal_cost",     "REAL DEFAULT 0"),
        ("filament_usage", "spool_id",        "INTEGER"),
        ("filaments",      "fila_color_code",  "TEXT"),
        ("filaments",      "name_en",          "TEXT"),
        ("filaments",      "fila_type",        "TEXT"),
        ("filaments",      "color_bucket",     "TEXT"),
        ("groups",         "number_of_items",          "INTEGER DEFAULT 1"),
        ("groups",         "cover_print_id",             "INTEGER"),
        ("prints",         "total_cost_filament_normal","REAL DEFAULT 0.0"),
    ]
    async with engine.connect() as conn:
        for table, col, col_type in migrations:
            try:
                await conn.execute(
                    __import__("sqlalchemy").text(
                        f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"
                    )
                )
                await conn.commit()
            except Exception:
                pass  # colonne déjà existante → ignorer


async def _backfill_color_buckets():
    """
    Calcule Filament.color_bucket pour les lignes qui n'en ont pas encore.
    Idempotent : ne touche que les NULL, donc sans effet aux démarrages suivants.
    """
    from sqlalchemy import text as _text
    from ..core.colors import buckets_for
    try:
        async with engine.begin() as conn:
            rows = (await conn.execute(_text(
                "SELECT id, color, colors_array FROM filaments "
                "WHERE color_bucket IS NULL OR color_bucket = ''"
            ))).all()
            n = 0
            for fid, color, colors_array in rows:
                b = buckets_for(color, colors_array)
                if not b:
                    continue
                await conn.execute(
                    _text("UPDATE filaments SET color_bucket = :b WHERE id = :i"),
                    {"b": b, "i": fid},
                )
                n += 1
        if n:
            print(f"[migrate] color_bucket calculé pour {n} filament(s)")
    except Exception as e:
        print(f"[migrate] backfill color_bucket échoué : {e}")
