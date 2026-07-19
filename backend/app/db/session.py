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
    from ..models import attention  # noqa - table des mises en sourdine
    from ..models import rfid       # noqa - table des scans NFC
    from ..models import user       # noqa - comptes et roles
    from ..models import activity   # noqa - journal d'activite
    async with engine.begin() as conn:
        # WAL mode : permet lectures concurrentes, évite les database locked
        await conn.execute(__import__("sqlalchemy").text("PRAGMA journal_mode=WAL"))
        await conn.execute(__import__("sqlalchemy").text("PRAGMA busy_timeout=30000"))
        await conn.execute(__import__("sqlalchemy").text("PRAGMA synchronous=NORMAL"))
        await conn.run_sync(Base.metadata.create_all)
    # Migration automatique : ADD COLUMN si manquant
    await _migrate()
    # Backfill des colonnes calculées
    await _ensure_indexes()
    await _backfill_color_buckets()
    await _backfill_material_family()
    await _normalize_spool_locations()
    await _seed_admin_user()
    await _migrate_last_seen()
    await _migrate_activity_kind()
    await _migrate_print_job_id_unique()
    await _purge_activity_log()


async def _migrate():
    """Applique les colonnes manquantes sans perdre les données."""
    migrations = [
        # table, colonne, type SQL
        ("prints",    "translated_name",      "TEXT"),
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
        ("bobines",   "last_dried_at",        "TEXT"),
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
        ("prints",         "cover_photo",      "TEXT"),
        ("prints",         "task_name",        "TEXT"),
        ("prints",         "model_url",        "TEXT"),
        ("filaments",      "color_bucket",     "TEXT"),
        ("filaments",      "code",             "TEXT"),
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


async def _migrate_last_seen():
    """Ajoute users.last_seen sur une base existante. Idempotent."""
    from sqlalchemy import text as _text
    try:
        async with engine.begin() as conn:
            cols = [r[1] for r in (await conn.execute(_text("PRAGMA table_info(users)"))).all()]
            if "last_seen" not in cols:
                await conn.execute(_text("ALTER TABLE users ADD COLUMN last_seen DATETIME"))
                print("[migration] colonne users.last_seen ajoutee")
    except Exception as e:
        print(f"[migration] last_seen ignoree : {e}")


# Duree de conservation du journal d'activite. Valeur unique : l'interface la
# lit via l'API pour construire ses filtres, sinon les deux finissent par se
# contredire -- un filtre 30 jours coexistait avec une purge a 7.
ACTIVITY_RETENTION_DAYS = 30


async def _migrate_activity_kind():
    """
    Ajoute activity_log.kind sur une base existante. Les lignes deja presentes
    sont toutes des actions, d'ou le DEFAULT : aucune reprise a faire.
    """
    from sqlalchemy import text as _text
    try:
        async with engine.begin() as conn:
            cols = [r[1] for r in (await conn.execute(
                _text("PRAGMA table_info(activity_log)"))).all()]
            if cols and "kind" not in cols:
                await conn.execute(_text(
                    "ALTER TABLE activity_log ADD COLUMN kind VARCHAR(8) "
                    "NOT NULL DEFAULT 'action'"))
                print("[migration] colonne activity_log.kind ajoutee")
    except Exception as e:
        print(f"[migration] activity_log.kind ignoree : {e}")


async def _migrate_print_job_id_unique():
    """
    Interdit deux prints pour un meme job_id.

    Le verrou pose dans create_print protege des appels simultanes DANS le
    processus ; cet index est la garantie de derniere ligne, celle qui tient
    meme apres un redemarrage ou si un autre chemin de code insere un jour.

    Index PARTIEL : les prints ajoutes a la main n'ont pas de job_id, et SQLite
    tolere plusieurs NULL mais pas plusieurs chaines vides.

    Si des doublons existent deja, l'index ne peut pas etre cree : on le signale
    dans les logs sans rien supprimer. Fusionner deux prints suppose de decider
    quoi faire de leurs consommations de filament et de leurs photos -- ce n'est
    pas a une migration silencieuse de trancher.
    """
    from sqlalchemy import text as _text
    try:
        async with engine.begin() as conn:
            dups = (await conn.execute(_text(
                "SELECT job_id, COUNT(*) c FROM prints "
                "WHERE job_id IS NOT NULL AND job_id != '' "
                "GROUP BY job_id HAVING c > 1"))).all()
            if dups:
                print("[migration] index unique prints.job_id NON cree : "
                      f"{len(dups)} job_id en double a traiter a la main "
                      f"({', '.join(str(d[0]) for d in dups[:5])}"
                      f"{'…' if len(dups) > 5 else ''})")
                return
            await conn.execute(_text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_prints_job_id "
                "ON prints(job_id) WHERE job_id IS NOT NULL AND job_id != ''"))
    except Exception as e:
        print(f"[migration] index unique prints.job_id ignore : {e}")


async def _purge_activity_log(days: int = ACTIVITY_RETENTION_DAYS):
    """
    Le journal ne sert qu'a un historique glissant : au-dela on supprime. Evite
    que la table grossisse indefiniment. Appele a chaque demarrage.
    """
    from sqlalchemy import text as _text
    try:
        async with engine.begin() as conn:
            res = await conn.execute(_text(
                "DELETE FROM activity_log WHERE created_at < datetime('now', :d)"
            ), {"d": f"-{days} days"})
            if res.rowcount:
                print(f"[maintenance] journal d'activite : {res.rowcount} ligne(s) purgee(s)")
    except Exception as e:
        print(f"[maintenance] purge du journal ignoree : {e}")


async def _seed_admin_user():
    """
    Cree le premier compte administrateur si la table users est vide, a partir de
    l'ancien couple ADMIN_USERNAME / ADMIN_PASSWORD_HASH stocke dans les settings
    (ou admin/admin si rien n'a jamais ete defini). Garantit qu'on ne se retrouve
    jamais enferme dehors apres la mise a jour. Idempotent.
    """
    from sqlalchemy import text as _text
    from ..core.security import hash_password
    try:
        async with engine.begin() as conn:
            n = (await conn.execute(_text("SELECT COUNT(*) FROM users"))).scalar() or 0
            if n:
                return
            row = (await conn.execute(_text(
                "SELECT key, value FROM settings WHERE key IN "
                "('ADMIN_USERNAME','ADMIN_PASSWORD_HASH')"
            ))).all()
            conf = {k: v for k, v in row}
            username = conf.get("ADMIN_USERNAME") or "admin"
            pwd_hash = conf.get("ADMIN_PASSWORD_HASH") or hash_password("admin")
            await conn.execute(
                _text("INSERT INTO users (username, password_hash, role, active) "
                      "VALUES (:u, :p, 'admin', 1)"),
                {"u": username, "p": pwd_hash},
            )
        print(f"[migration] compte administrateur initial cree : {username}")
    except Exception as e:
        print(f"[migration] creation admin initial ignoree : {e}")


async def _normalize_spool_locations():
    """
    Normalise l'emplacement des bobines : convention interne = "AMS ..." ou
    "Tiroir" (singulier). D'anciennes saisies utilisaient "Tiroirs" au pluriel.
    Idempotent : ne touche que les lignes concernees, donc sans effet aux
    demarrages suivants.
    """
    from sqlalchemy import text as _text
    try:
        async with engine.begin() as conn:
            res = await conn.execute(_text(
                "UPDATE bobines SET location = 'Tiroir' "
                "WHERE location IS NOT NULL "
                "  AND TRIM(location) COLLATE NOCASE = 'Tiroirs'"
            ))
            n = res.rowcount or 0
        if n:
            print(f"[migration] emplacement normalise : {n} bobine(s) 'Tiroirs' -> 'Tiroir'")
    except Exception as e:
        print(f"[migration] normalisation emplacement ignoree : {e}")


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


async def _backfill_material_family():
    """
    Répare Filament.material : enrich-from-catalog y écrivait le sous-type
    ("PLA Basic") au lieu de la famille ("PLA"). On ne touche qu'aux lignes
    dont le material n'est pas une famille connue. Idempotent.
    """
    from sqlalchemy import text as _text
    from ..core.materials import family_of, is_family
    try:
        async with engine.begin() as conn:
            rows = (await conn.execute(_text(
                "SELECT id, material, fila_type FROM filaments"
            ))).all()
            n = 0
            for fid, material, fila_type in rows:
                if is_family(material):
                    continue
                fam = family_of(material, None) or family_of(fila_type, None)
                if not fam or fam == material:
                    continue
                await conn.execute(
                    _text("UPDATE filaments SET material = :m WHERE id = :i"),
                    {"m": fam, "i": fid},
                )
                n += 1
        if n:
            print(f"[migrate] material (famille) corrigé pour {n} filament(s)")
    except Exception as e:
        print(f"[migrate] backfill material échoué : {e}")


async def _ensure_indexes():
    """
    create_all() ne cree pas d'index sur une table qui existe deja : les index
    ajoutes apres coup doivent l'etre explicitement.
    """
    from sqlalchemy import text as _text
    idx = [
        ("idx_filament_usage_spool", "filament_usage", "spool_id"),
    ]
    try:
        async with engine.begin() as conn:
            for name, table, col in idx:
                await conn.execute(_text(
                    f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({col})"
                ))
    except Exception as e:
        print(f"[migrate] création d'index échouée : {e}")
