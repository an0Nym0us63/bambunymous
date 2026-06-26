"""
Script d'import de la DB Spoolnymous v1 vers BambuNymous.
Usage: python -m app.db.import_db --src /data/3d_printer_logs.db
Import idempotent: peut être rejoué sans créer de doublons.
"""
import argparse
import asyncio
import sqlite3
import logging
from datetime import datetime
from pathlib import Path

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


async def run_import(src_path: str):
    from app.db.session import init_db, AsyncSessionLocal
    from app.models.filament import Filament, Spool
    from app.models.setting import Setting
    from sqlalchemy import text

    logger.info(f"📂 Source: {src_path}")
    await init_db()

    src = sqlite3.connect(src_path)
    src.row_factory = sqlite3.Row

    async with AsyncSessionLocal() as db:

        # ── SETTINGS ────────────────────────────────────────────────────
        logger.info("Import settings…")
        key_map = {
            "PRINTER_ID": "PRINTER_ID",
            "PRINTER_ACCESS_CODE": "PRINTER_ACCESS_CODE",
            "PRINTER_IP": "PRINTER_IP",
            "COST_BY_HOUR": "COST_BY_HOUR",
        }
        for src_key, dst_key in key_map.items():
            row = src.execute("SELECT value FROM settings WHERE key=?", (src_key,)).fetchone()
            if row and row[0]:
                existing = await db.execute(text("SELECT value FROM settings WHERE key=:k"), {"k": dst_key})
                if not existing.scalar_one_or_none():
                    db.add(Setting(key=dst_key, value=str(row[0])))
                    logger.info(f"  {dst_key} = {str(row[0])[:30]}")

        # ── FILAMENTS ────────────────────────────────────────────────────
        logger.info("Import filaments…")
        fil_map: dict[int, int] = {}  # old_id → new_id

        for row in src.execute("SELECT * FROM filaments ORDER BY id").fetchall():
            row = dict(row)
            old_id = row["id"]

            # Check doublon par external_filament_id ou par nom+matière
            ext_id = str(row.get("external_filament_id") or "")
            if ext_id:
                res = await db.execute(
                    text("SELECT id FROM filaments WHERE external_filament_id=:e"),
                    {"e": ext_id}
                )
                existing = res.scalar_one_or_none()
                if existing:
                    fil_map[old_id] = existing
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
            logger.debug(f"  Filament {old_id} → {f.id}: {f.name}")

        logger.info(f"  → {len(fil_map)} filaments importés")

        # ── BOBINES ──────────────────────────────────────────────────────
        logger.info("Import bobines…")
        spool_map: dict[int, int] = {}

        for row in src.execute("SELECT * FROM bobines ORDER BY id").fetchall():
            row = dict(row)
            old_id = row["id"]
            old_fil = row.get("filament_id")
            new_fil = fil_map.get(old_fil)

            if not new_fil:
                logger.warning(f"  Bobine {old_id}: filament {old_fil} introuvable, ignoré")
                continue

            res = await db.execute(text("SELECT id FROM bobines WHERE id=:id"), {"id": old_id})
            if res.scalar_one_or_none():
                spool_map[old_id] = old_id
                continue

            s = Spool(
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
            )
            db.add(s)
            await db.flush()
            spool_map[old_id] = s.id

        logger.info(f"  → {len(spool_map)} bobines importées")

        await db.commit()
        logger.info("✅ Import terminé.")

    src.close()
    return {"filaments": len(fil_map), "spools": len(spool_map)}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True, help="Chemin DB source (3d_printer_logs.db)")
    args = parser.parse_args()
    asyncio.run(run_import(args.src))
