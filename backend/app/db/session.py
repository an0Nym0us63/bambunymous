import asyncio

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool
from sqlalchemy.orm import DeclarativeBase
from ..core.config import settings


class Base(DeclarativeBase):
    pass


_ENGINE_ARGS = dict(
    echo=settings.DEBUG,
    connect_args={
        "check_same_thread": False,
        "timeout": 30,           # attendre 30s si DB locked
    },
    # pas de « SELECT 1 » avant chaque emprunt de connexion : un fichier local ne se coupe pas comme un serveur
    pool_pre_ping=False,
)

# Deux moteurs (27/10/2026). Le fil MQTT et plusieurs routes (imports, filaments, impressions, reglages) font
# tourner LEUR PROPRE boucle asyncio et y ouvrent des sessions ; un pool (AsyncAdaptedQueuePool) est lie a une
# seule boucle (essaye seul le 26/10 : « Queue … is bound to a different event loop » au demarrage). Donc :
# - « engine » : une connexion neuve par session (NullPool), sur n'importe quelle boucle ;
# - « _pooled » : les connexions gardees ouvertes (cache chaud, PRAGMA poses une fois), reserve a la boucle
#   principale, celle qui sert les pages. Douze gardees ; au-dela, des connexions en plus (jamais d'attente).
engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool, **_ENGINE_ARGS)
_pooled = create_async_engine(settings.DATABASE_URL, poolclass=AsyncAdaptedQueuePool, pool_size=12,
                              max_overflow=500, **_ENGINE_ARGS)
_MAIN = {"loop": None}


def bind_main_loop() -> None:
    """La boucle principale (au demarrage du serveur) : ses sessions passent par le pool."""
    _MAIN["loop"] = asyncio.get_running_loop()


# Les reglages de SQLite valent par connexion (26/10/2026) : poses une seule fois au demarrage, ils ne
# touchaient que la premiere ; les autres ecrivaient en mode « synchronous=FULL » (une synchronisation
# disque a chaque validation) et avec un petit cache. Chaque connexion les recoit desormais.
from sqlalchemy import event as _event


def _sqlite_pragmas(dbapi_conn, _rec):
    if not str(settings.DATABASE_URL).startswith("sqlite"):
        return
    cur = dbapi_conn.cursor()
    try:
        for p in ("journal_mode=WAL", "synchronous=NORMAL", "busy_timeout=30000",
                  # la base tient en entier en memoire (26/10/2026 : 64 Mo de cache, 512 Mo lus en direct)
                  "cache_size=-65536", "temp_store=MEMORY", "mmap_size=536870912"):
            cur.execute(f"PRAGMA {p}")
    finally:
        cur.close()


# chaque requete SQL chronometree pour la carte « Vitesse du serveur » : le temps en base de chaque route
import time as _time


def _sql_t0(conn, cursor, statement, params, context, executemany):
    conn.info.setdefault("_perf_t0", []).append(_time.perf_counter())


def _sql_t1(conn, cursor, statement, params, context, executemany):
    try:
        t0 = conn.info["_perf_t0"].pop()
        from ..core.perf import sql_done
        sql_done((_time.perf_counter() - t0) * 1000, statement)
    except Exception:
        pass


# le temps « base » decoupe (file du fil, SQLite, retour a la boucle) : voir core/perf.py
from ..core.perf import install_db_probe as _probe
_probe()

for _e in (engine, _pooled):
    _event.listen(_e.sync_engine, "connect", _sqlite_pragmas)
    _event.listen(_e.sync_engine, "before_cursor_execute", _sql_t0)
    _event.listen(_e.sync_engine, "after_cursor_execute", _sql_t1)

# Ce qui a change dans la base (27/10/2026) : un compteur par table, monte a chaque ecriture (INSERT, UPDATE,
# DELETE, REPLACE) puis a sa validation, quelle qu'en soit l'origine (pages, fil MQTT, taches de fond, SQL brut).
# Un calcul garde en memoire (les alertes) se sait ainsi a jour tant que les compteurs de ses tables n'ont pas
# bouge. Monte deux fois : une lecture faite entre l'ecriture et sa validation ne passe pas pour a jour.
import re as _re
_WRITE = _re.compile(r'^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|REPLACE\s+INTO)\s+["`\[]?(\w+)', _re.I)
_TABLE_V: dict = {}


def data_version(*tables) -> tuple:
    """L'etat des tables : change des qu'une ligne de l'une d'elles est ecrite."""
    return tuple(_TABLE_V.get(t, 0) for t in tables)


def _w_exec(conn, cursor, statement, params, context, executemany):
    m = _WRITE.match(statement or "")
    if m:
        t = m.group(1).lower()
        _TABLE_V[t] = _TABLE_V.get(t, 0) + 1
        conn.info.setdefault("_dirty_tables", set()).add(t)


def _w_commit(conn):
    for t in conn.info.pop("_dirty_tables", ()):
        _TABLE_V[t] = _TABLE_V.get(t, 0) + 1


def _w_rollback(conn):
    conn.info.pop("_dirty_tables", None)


for _e in (engine, _pooled):
    _event.listen(_e.sync_engine, "before_cursor_execute", _w_exec)
    _event.listen(_e.sync_engine, "commit", _w_commit)
    _event.listen(_e.sync_engine, "rollback", _w_rollback)

_MAKER_POOLED = async_sessionmaker(_pooled, expire_on_commit=False)
_MAKER_ANY = async_sessionmaker(engine, expire_on_commit=False)


def AsyncSessionLocal(**kw) -> AsyncSession:
    """Une session : par le pool sur la boucle principale, une connexion neuve sur toute autre boucle."""
    try:
        lp = asyncio.get_running_loop()
    except RuntimeError:
        lp = None
    return (_MAKER_POOLED if lp is not None and lp is _MAIN["loop"] else _MAKER_ANY)(**kw)


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
    from ..models import notif_log  # noqa - historique des notifications
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
    await _normalize_archived_spools()
    await _seed_admin_user()
    await _migrate_last_seen()
    await _migrate_label_printed()
    await _migrate_object_status()
    await _cleanup_bogus_translations()
    await _migrate_activity_kind()
    await _migrate_print_job_id_unique()
    await _purge_activity_log()
    await _normalize_print_dates()
    await _repair_print_durations()


async def _migrate():
    """Applique les colonnes manquantes sans perdre les données."""
    migrations = [
        # table, colonne, type SQL
        # SANS valeur par defaut, volontairement : un DEFAULT remplit
        # immediatement TOUTES les lignes existantes, et la reprise ci-dessous
        # ne trouve alors plus rien a corriger. Les nouvelles lignes recoivent
        # leur valeur par le modele SQLAlchemy.
        ("accessories", "category",           "TEXT"),
        ("objects",   "status",               "TEXT"),
        ("users",     "tokens_valid_from",    "TIMESTAMP"),
        ("users",     "totp_secret",          "TEXT"),
        ("users",     "totp_enabled",         "INTEGER DEFAULT 0"),
        ("users",     "totp_last_step",       "INTEGER"),
        ("users",     "totp_recovery",        "TEXT"),
        ("users",     "friend_key_hash",      "TEXT"),
        ("users",     "mw_write",             "INTEGER DEFAULT 0"),
        ("users",     "secrets_visible",      "INTEGER DEFAULT 0"),
        ("groups",    "cover_photo",          "TEXT"),
        ("groups",    "stats_excluded",       "INTEGER DEFAULT 0"),
        ("prints",    "stats_excluded",       "INTEGER DEFAULT 0"),
        ("prints",    "translated_name",      "TEXT"),
        ("prints",    "translated_by",        "TEXT"),
        ("filaments", "translated_name",      "TEXT"),
        ("filaments", "external_filament_id", "TEXT"),
        ("filaments", "reference_id",         "TEXT"),
        ("filaments", "profile_id",           "TEXT"),
        ("filaments", "spool_weight_g",       "REAL"),
        ("filaments", "spool_tare_name",      "TEXT"),
        ("prints",    "mw_profile_id",        "TEXT"),
        ("prints",    "mw_plates",            "TEXT"),
        ("prints",    "paused_seconds",       "REAL"),
        ("prints",    "paused_since",         "TIMESTAMP"),
        ("makerworld_designs", "profiles",     "TEXT"),
        ("makerworld_designs", "creator_uid",  "TEXT"),
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


async def _cleanup_bogus_translations():
    """Efface les translated_name qui sont en fait des pages d'erreur Google
    ("Error 500 ... That's an error") stockees a tort. Le champ redevient vide
    et le rattrapage de traduction le reprendra proprement."""
    from sqlalchemy import text as _text
    try:
        async with engine.begin() as conn:
            res = await conn.execute(_text("""
                UPDATE prints SET translated_name = NULL
                WHERE translated_name IS NOT NULL AND (
                       translated_name LIKE '%That%error%'
                    OR translated_name LIKE '%all we know%'
                    OR translated_name LIKE '%Server Error%'
                    OR translated_name LIKE '%!!1%'
                    OR translated_name LIKE '%try again later%'
                    OR translated_name LIKE '%<%'
                    OR translated_name LIKE '%google.com%'
                    OR translated_name LIKE '%INVALID SOURCE%'
                    OR translated_name LIKE '%INVALID TARGET%'
                    OR translated_name LIKE '%LANGPAIR%'
                    OR translated_name LIKE '%MYMEMORY WARNING%'
                    OR translated_name LIKE '%YOU USED ALL AVAILABLE%')
            """))
            if getattr(res, "rowcount", 0):
                print(f"[migration] {res.rowcount} traductions erronees effacees")
    except Exception as e:
        print(f"[migration] nettoyage traductions: {e}")


async def _migrate_object_status():
    """
    Deduit objects.status des anciens champs, une seule fois.

    L'ordre des tests compte : un objet vendu ET marque perso doit compter
    comme VENDU, la vente etant l'evenement le plus fort. Ne touche que les
    lignes encore vides, donc rejouable sans ecraser une saisie manuelle.
    """
    from sqlalchemy import text as _text
    try:
        async with engine.begin() as conn:
            cols = [r[1] for r in (await conn.execute(_text("PRAGMA table_info(objects)"))).all()]
            if "status" not in cols:
                return
            # 1) Backfill unique : deduire status des anciens miroirs UNIQUEMENT
            #    pour les lignes encore vides (objets importes avant l'ajout du
            #    champ status). On ne "corrige" plus les status deja definis :
            #    c'etait la cause du bug ou un objet passe "a vendre" (mais dont
            #    le miroir personal restait a 1 a cause d'un PATCH boiteux)
            #    repassait en perso a chaque redemarrage.
            n = (await conn.execute(_text(
                "SELECT COUNT(*) FROM objects WHERE status IS NULL OR status = ''"))).scalar()
            if n:
                await conn.execute(_text("""
                    UPDATE objects SET status = CASE
                        WHEN sold_price IS NOT NULL AND sold_price > 0 THEN 'sold'
                        WHEN personal = 1                              THEN 'personal'
                        -- Spoolnymous encodait un CADEAU par sold_price = 0 avec
                        -- personal = 0 : un prix a zero est un don, pas une absence.
                        WHEN sold_price IS NOT NULL AND sold_price = 0 THEN 'gifted'
                        WHEN available = 0                             THEN 'unavailable'
                        ELSE 'available'
                    END
                    WHERE status IS NULL OR status = ''
                """))
                print(f"[migration] statut deduit pour {n} objet(s)")

            # 2) Le statut est desormais la SOURCE DE VERITE ; les miroirs
            #    personal/available doivent le refleter. On repare ainsi les
            #    lignes rendues incoherentes (ex. status=available + personal=1)
            #    et les stats/filtres qui s'appuient encore sur ces miroirs.
            await conn.execute(_text("""
                UPDATE objects
                SET personal  = CASE WHEN status = 'personal'  THEN 1 ELSE 0 END,
                    available = CASE WHEN status = 'available' THEN 1 ELSE 0 END
                WHERE status IS NOT NULL AND status != ''
                  AND (personal  != (CASE WHEN status = 'personal'  THEN 1 ELSE 0 END)
                    OR available != (CASE WHEN status = 'available' THEN 1 ELSE 0 END))
            """))
    except Exception as e:
        print(f"[migration] statut objets: {e}")


LABEL_FROM_SWATCH_DONE = "MIGRATION_LABEL_FROM_SWATCH"


async def _migrate_label_printed():
    """
    Ajoute filaments.label_printed / label_printed_at, puis -- UNE SEULE FOIS --
    coche l'etiquette des filaments qui ont deja un echantillon : la plaquette
    existe, son etiquette aussi. Date laissee vide, on ne la connait pas.

    La reprise est notee dans settings et ne se rejoue plus : au demarrage
    suivant, une etiquette decochee expres sur un filament avec echantillon
    serait sinon recochee. Le repere vaut aussi pour une base ou les colonnes
    existent deja (version precedente qui les ajoutait sans reprise).
    """
    from sqlalchemy import text as _text
    try:
        async with engine.begin() as conn:
            cols = [r[1] for r in (await conn.execute(_text("PRAGMA table_info(filaments)"))).all()]
            if "label_printed" not in cols:
                await conn.execute(_text("ALTER TABLE filaments ADD COLUMN label_printed INTEGER DEFAULT 0"))
            if "label_printed_at" not in cols:
                await conn.execute(_text("ALTER TABLE filaments ADD COLUMN label_printed_at TIMESTAMP"))
            done = (await conn.execute(_text("SELECT value FROM settings WHERE key = :k"),
                                       {"k": LABEL_FROM_SWATCH_DONE})).first()
            if done is None:
                res = await conn.execute(_text(
                    "UPDATE filaments SET label_printed = 1 "
                    "WHERE swatch = 1 AND (label_printed IS NULL OR label_printed = 0)"))
                await conn.execute(_text("INSERT INTO settings (key, value) VALUES (:k, '1')"),
                                   {"k": LABEL_FROM_SWATCH_DONE})
                print(f"[migration] etiquette cochee sur {res.rowcount or 0} filament(s) avec echantillon")
    except Exception as e:
        print(f"[migration] label_printed ignoree : {e}")


# Le format unique des dates d'impression : celui qu'ecrit SQLAlchemy, « AAAA-MM-JJ HH:MM:SS.ffffff »
# (UTC, sans fuseau). D'anciennes ecritures ont laisse « 2026-10-22T16:12:00 » : comparees comme du
# texte, ces dates sortaient des bornes d'un jour (le « T » passe apres l'espace).
_DATE_FMT_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9][0-9][0-9][0-9]"
_DATE_NORM = "strftime('%Y-%m-%d %H:%M:%f', {x}) || '000'"


async def _repair_print_durations():
    """Une fois (23/10/2026) : les durees faussees par l'heure de depart relue apres un redemarrage
    (UTC lu comme heure locale : +1 h ou +2 h), et celles restees vides parce que ce decalage les
    poussait au-dela du seuil. La fin reelle est l'heure de la photo de fin (pct100, ou fail-… pour
    un echec) ; le debut, la creation de la fiche. Une duree qui ne s'explique pas ainsi n'est pas
    touchee. Le cout d'electricite suit ; le cout filament ne bouge pas."""
    from sqlalchemy import text as _text
    from .session import AsyncSessionLocal as _S
    from ..services.settings_service import get_setting, set_setting
    FLAG = "MIGR_DURATIONS_20261023"
    try:
        async with _S() as db:
            if await get_setting(db, FLAG):
                return
            try:
                rate = float(str(await get_setting(db, "COST_BY_HOUR") or 0).replace(",", ".").strip() or 0)
            except ValueError:
                rate = 0.0
            rows = (await db.execute(_text(
                "SELECT p.id, p.status, p.estimated_seconds, p.duration_seconds, p.total_cost_filament, p.group_id, "
                "(julianday(MAX(s.taken_at)) - julianday(p.created_at)) * 86400.0 AS real "
                "FROM prints p JOIN print_snapshots s ON s.print_id = p.id "
                "WHERE p.status IN ('SUCCESS', 'FAILED') AND p.created_at IS NOT NULL "
                "AND (s.trigger = 'pct100' OR s.trigger LIKE 'fail-%') GROUP BY p.id"))).all()
            fixed = []
            for pid, status, est, dur, fil, gid, real in rows:
                if real is None or real <= 0:
                    continue
                est = est or 0
                new = None
                if dur is None:
                    if est <= 0 or real <= est * 2:
                        new = real
                else:
                    delta = dur - real
                    for h in (3600, 7200):
                        if abs(delta - h) <= 180:
                            new = dur - h
                if new is None:
                    continue
                elec = round(new / 3600 * rate, 4)
                await db.execute(_text("UPDATE prints SET duration_seconds = :d, electric_cost = :e, total_cost = :t WHERE id = :i"),
                                 {"d": round(new), "e": elec, "t": round((fil or 0) + elec, 4), "i": pid})
                fixed.append(pid)
            # ce qui reste vide (ni photo de fin, ni mesure) sur une impression reussie : son estimation
            rest = (await db.execute(_text(
                "SELECT id, estimated_seconds, total_cost_filament FROM prints WHERE status = 'SUCCESS' "
                "AND duration_seconds IS NULL AND estimated_seconds > 0"))).all()
            for pid, est, fil in rest:
                elec = round(est / 3600 * rate, 4)
                await db.execute(_text("UPDATE prints SET duration_seconds = :d, electric_cost = :e, total_cost = :t WHERE id = :i"),
                                 {"d": round(est), "e": elec, "t": round((fil or 0) + elec, 4), "i": pid})
                fixed.append(pid)
            await db.commit()
            if fixed:
                try:   # les objets tires de ces impressions (ou de leurs groupes) suivent le cout
                    from ..api.v1.routes.prints import _propagate_from_print
                    for pid in fixed:
                        await _propagate_from_print(db, pid)
                    await db.commit()
                except Exception as e:
                    print(f"[migration] couts des objets non repercutes : {e}")
            await set_setting(db, FLAG, "1")
            print(f"[migration] {len(fixed)} duree(s) d'impression reparee(s)")
    except Exception as e:
        print(f"[migration] reparation des durees ignoree : {e}")


async def _normalize_print_dates():
    """Remet toutes les dates d'impression au format unique, puis pose un declencheur qui reformate
    toute date ecrite autrement (meme par une requete brute) : l'enregistrement est toujours le meme."""
    from sqlalchemy import text as _text
    try:
        async with engine.begin() as conn:
            res = await conn.execute(_text(
                f"UPDATE prints SET print_date = {_DATE_NORM.format(x='print_date')} "
                f"WHERE print_date IS NOT NULL AND print_date NOT GLOB '{_DATE_FMT_GLOB}' "
                f"AND strftime('%Y-%m-%d %H:%M:%f', print_date) IS NOT NULL"))
            if res.rowcount:
                print(f"[migration] {res.rowcount} date(s) d'impression remises au format unique")
            for ev, cond in (("INSERT", "INSERT"), ("UPDATE", "UPDATE OF print_date")):
                await conn.execute(_text(
                    f"CREATE TRIGGER IF NOT EXISTS prints_date_format_{ev.lower()} AFTER {cond} ON prints "
                    f"WHEN NEW.print_date IS NOT NULL AND NEW.print_date NOT GLOB '{_DATE_FMT_GLOB}' "
                    f"AND strftime('%Y-%m-%d %H:%M:%f', NEW.print_date) IS NOT NULL "
                    f"BEGIN UPDATE prints SET print_date = {_DATE_NORM.format(x='NEW.print_date')} WHERE id = NEW.id; END"))
    except Exception as e:
        print(f"[migration] format des dates d'impression ignore : {e}")


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


async def _normalize_archived_spools():
    """
    Garantit la coherence des bobines archivees : quantite (remaining_weight_g)
    a 0 et emplacement "Archives". Rattrape les bobines archivees avant
    l'introduction de cette regle, qui gardaient leur dernier poids restant et
    leur derniere location AMS (le worker spool_location ignore les archivees).
    Idempotent : ne touche que les lignes hors-norme.
    """
    from sqlalchemy import text as _text
    try:
        async with engine.begin() as conn:
            res = await conn.execute(_text(
                "UPDATE bobines "
                "SET remaining_weight_g = 0, location = 'Archives' "
                "WHERE archived = 1 "
                "  AND (COALESCE(remaining_weight_g, 0) <> 0 "
                "       OR location IS NULL "
                "       OR TRIM(location) COLLATE NOCASE <> 'Archives')"
            ))
            n = res.rowcount or 0
        if n:
            print(f"[migration] bobines archivees normalisees (qte 0 + Archives) : {n}")
    except Exception as e:
        print(f"[migration] normalisation bobines archivees ignoree : {e}")


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
