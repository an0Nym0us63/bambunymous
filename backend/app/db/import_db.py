"""
Script d'import de la DB Spoolnymous v1 → BambuNymous.
Appelable en CLI ou via l'API.
Idempotent: ne crée pas de doublons.
"""
import sqlite3
import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select
from ..models.filament import Filament, Spool
from ..models.setting import Setting

logger = logging.getLogger(__name__)


def parse_dt(val):
    if not val:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(val).strip(), fmt)
        except Exception:
            continue
    return None


def table_exists(conn, name):
    return bool(conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone())


async def run_import(src_path: str) -> dict:
    from ..db.session import AsyncSessionLocal, init_db
    await init_db()

    src = sqlite3.connect(src_path)
    src.row_factory = sqlite3.Row
    stats = {"filaments": 0, "spools": 0, "settings": 0, "skipped": 0}

    async with AsyncSessionLocal() as db:

        # ── SETTINGS ────────────────────────────────────────────────────
        key_map = {
            "PRINTER_ID": "PRINTER_ID",
            "PRINTER_ACCESS_CODE": "PRINTER_ACCESS_CODE",
            "PRINTER_IP": "PRINTER_IP",
            "COST_BY_HOUR": "COST_BY_HOUR",
        }
        if table_exists(src, "settings"):
            for src_key, dst_key in key_map.items():
                row = src.execute("SELECT value FROM settings WHERE key=?", (src_key,)).fetchone()
                if row and row[0]:
                    existing = (await db.execute(
                        text("SELECT value FROM settings WHERE key=:k"), {"k": dst_key}
                    )).scalar_one_or_none()
                    if not existing:
                        db.add(Setting(key=dst_key, value=str(row[0])))
                        stats["settings"] += 1

        # ── FILAMENTS ────────────────────────────────────────────────────
        fil_map: dict[int, int] = {}
        for row in src.execute("SELECT * FROM filaments ORDER BY id").fetchall():
            row = dict(row)
            old_id = row["id"]
            ext_id = str(row.get("external_filament_id") or "")

            # Doublon check par external_filament_id
            if ext_id:
                res = (await db.execute(
                    text("SELECT id FROM filaments WHERE external_filament_id=:e"), {"e": ext_id}
                )).scalar_one_or_none()
                if res:
                    fil_map[old_id] = res
                    stats["skipped"] += 1
                    continue

            # Doublon check par id
            res = (await db.execute(
                text("SELECT id FROM filaments WHERE id=:id"), {"id": old_id}
            )).scalar_one_or_none()
            if res:
                fil_map[old_id] = old_id
                stats["skipped"] += 1
                continue

            f = Filament(
                id=old_id,
                name=row.get("name") or "Filament",
                manufacturer=row.get("manufacturer"),
                material=row.get("material") or "PLA",
                color=row.get("color"),
                multicolor_type=row.get("multicolor_type") or "monochrome",
                colors_array=row.get("colors_array"),
                price=row.get("price"),
                filament_weight_g=row.get("filament_weight_g") or 1000.0,
                spool_weight_g=row.get("spool_weight_g"),
                profile_id=row.get("profile_id"),
                external_filament_id=ext_id or None,
                reference_id=row.get("reference_id"),
                comment=row.get("comment"),
                swatch=bool(row.get("swatch", 0)),
                transparent=bool(row.get("transparent", 0)),
                to_order=bool(row.get("to_order", 0)),
                created_at=parse_dt(row.get("created_at")) or datetime.utcnow(),
                updated_at=parse_dt(row.get("updated_at")) or datetime.utcnow(),
            )
            db.add(f)
            await db.flush()
            fil_map[old_id] = f.id
            stats["filaments"] += 1

        # ── BOBINES ──────────────────────────────────────────────────────
        for row in src.execute("SELECT * FROM bobines ORDER BY id").fetchall():
            row = dict(row)
            old_id = row["id"]
            new_fil = fil_map.get(row.get("filament_id"))
            if not new_fil:
                continue

            res = (await db.execute(
                text("SELECT id FROM bobines WHERE id=:id"), {"id": old_id}
            )).scalar_one_or_none()
            if res:
                stats["skipped"] += 1
                continue

            db.add(Spool(
                id=old_id,
                filament_id=new_fil,
                remaining_weight_g=row.get("remaining_weight_g"),
                price_override=row.get("price_override"),
                location=row.get("location"),
                tag_number=row.get("tag_number"),
                ams_tray=row.get("ams_tray"),
                archived=bool(row.get("archived", 0)),
                comment=row.get("comment"),
                external_spool_id=str(row.get("external_spool_id") or ""),
                created_at=parse_dt(row.get("created_at")) or datetime.utcnow(),
                first_used_at=parse_dt(row.get("first_used_at")),
                last_used_at=parse_dt(row.get("last_used_at")),
                updated_at=parse_dt(row.get("updated_at")) or datetime.utcnow(),
            ))
            stats["spools"] += 1

        await db.commit()

    src.close()
    logger.info(f"Import: {stats}")
    return stats
