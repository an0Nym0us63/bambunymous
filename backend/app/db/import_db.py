import re
import os
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
    stats = {"filaments": 0, "spools": 0, "settings": 0, "prints": 0, "filament_usage": 0, "tags": 0, "skipped": 0}

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
                # translated_name ignoré à l'import : sera renseigné par l'enrichissement catalogue Bambu
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
                external_spool_id=str(row.get("external_spool_id") or "") or None,
                found_mode=row.get("foundMode") or row.get("found_mode"),
                created_at=parse_dt(row.get("created_at")) or datetime.utcnow(),
                first_used_at=parse_dt(row.get("first_used_at")),
                last_used_at=parse_dt(row.get("last_used_at")),
                updated_at=parse_dt(row.get("updated_at")) or datetime.utcnow(),
            ))
            stats["spools"] += 1

        await db.commit()

        # ── PRINTS (historique) ──────────────────────────────────────
        spool_map: dict[int, int] = {}  # old_spool_id → new_spool_id
        # Construire la map des bobines importées
        for row in src.execute("SELECT id FROM bobines ORDER BY id").fetchall():
            spool_map[row[0]] = row[0]  # IDs préservés à l'identique

        if table_exists(src, "prints"):
            print_map: dict[int, int] = {}
            for row in src.execute("SELECT * FROM prints ORDER BY id").fetchall():
                row = dict(row)
                old_pid = row["id"]

                # Doublon check par job_id
                job_id = str(row.get("job_id") or "")
                if job_id:
                    res = (await db.execute(
                        text("SELECT id FROM prints WHERE job_id=:j"), {"j": job_id}
                    )).scalar_one_or_none()
                    if res:
                        print_map[old_pid] = res  # garder dans print_map pour tags/groupes
                        stats["skipped"] += 1
                        continue

                # Doublon check par id
                res = (await db.execute(
                    text("SELECT id FROM prints WHERE id=:id"), {"id": old_pid}
                )).scalar_one_or_none()
                if res:
                    print_map[old_pid] = res  # important : garder dans print_map pour les tags/groupes
                    stats["skipped"] += 1
                    continue

                from ..models.print_history import Print as PrintModel
                p = PrintModel(
                    id=old_pid,
                    job_id=job_id or None,
                    print_date=parse_dt(row.get("print_date") or row.get("created_at")) or datetime.utcnow(),
                    file_name=row.get("file_name") or row.get("original_name") or "Import",
                    original_name=row.get("original_name"),
                    print_type=row.get("print_type") or "cloud",
                    status=row.get("status") or "SUCCESS",
                    status_note=row.get("status_note"),
                    plate_image=row.get("image_file") or row.get("plate_image"),
                    model_3mf=None,  # sera importé via ZIP séparément
                    external_ref=re.sub(r"\.(png|3mf|jpg)$","",os.path.basename(row.get("image_file") or ""),flags=re.IGNORECASE) or None,
                    estimated_seconds=row.get("estimated_seconds"),
                    duration_seconds=int(row.get("duration") or row.get("duration_seconds") or 0),
                    total_weight_g=row.get("total_weight") or row.get("total_weight_g") or 0.0,
                    total_cost_filament=row.get("total_cost") or row.get("total_cost_filament") or 0.0,
                    electric_cost=row.get("electric_cost") or 0.0,
                    total_cost=row.get("full_cost") or row.get("total_cost") or 0.0,
                    number_of_items=row.get("number_of_items") or 1,
                    sold_units=row.get("sold_units") or 0,
                    sold_price_total=row.get("sold_price_total"),
                    margin=row.get("margin") or 0.0,
                    plate_id=str(row.get("plate_id") or "1"),
                    design_id=row.get("design_id"),
                    printer_model=row.get("printer_model") or "H2C",
                    created_at=parse_dt(row.get("created_at")) or datetime.utcnow(),
                    updated_at=parse_dt(row.get("updated_at")) or datetime.utcnow(),
                )
                db.add(p)
                await db.flush()
                print_map[old_pid] = p.id
                stats["prints"] = stats.get("prints", 0) + 1

            # ── FILAMENT USAGE ────────────────────────────────────────
            if table_exists(src, "filament_usage"):
                for row in src.execute("SELECT * FROM filament_usage ORDER BY id").fetchall():
                    row = dict(row)
                    new_pid = print_map.get(row.get("print_id"))
                    if not new_pid:
                        continue
                    # Doublon check
                    res = (await db.execute(
                        text("SELECT id FROM filament_usage WHERE id=:id"), {"id": row["id"]}
                    )).scalar_one_or_none()
                    if res:
                        continue
                    from ..models.print_history import FilamentUsage
                    db.add(FilamentUsage(
                        id=row["id"],
                        print_id=new_pid,
                        spool_id=spool_map.get(row.get("spool_id")),
                        filament_type=row.get("filament_type") or "",
                        color_hex=row.get("color") or row.get("color_hex") or "",
                        grams_used=float(row.get("grams_used") or 0),
                        ams_slot=int(row.get("ams_slot") or 0),
                        cost=float(row.get("cost") or 0),
                        normal_cost=float(row.get("normal_cost") or 0),
                    ))
                    stats["filament_usage"] = stats.get("filament_usage", 0) + 1

            # ── PRINT TAGS existants ─────────────────────────────────
            if table_exists(src, "print_tags"):
                for row in src.execute("SELECT * FROM print_tags").fetchall():
                    row = dict(row)
                    new_pid = print_map.get(row.get("print_id"))
                    if not new_pid:
                        continue
                    tag = row.get("tag") or ""
                    res = (await db.execute(
                        text("SELECT id FROM print_tags WHERE print_id=:p AND tag=:t"),
                        {"p": new_pid, "t": tag}
                    )).scalar_one_or_none()
                    if not res:
                        from ..models.print_history import PrintTag
                        db.add(PrintTag(print_id=new_pid, tag=tag))
                        stats["tags"] = stats.get("tags", 0) + 1

            # ── GROUPES Spoolnymous → table "groups" BambuNymous (id propre) ───
            # Spoolnymous a une table "groups" + prints.group_id (FK)
            group_map: dict[int, str] = {}
            # Spoolnymous utilise "print_groups" comme nom de table
            for grp_table in ("print_groups", "groups"):
                if table_exists(src, grp_table):
                    for row in src.execute(f"SELECT id, name FROM {grp_table}").fetchall():
                        group_map[row[0]] = row[1] or f"Groupe {row[0]}"
                    logger.info(f"[IMPORT] {len(group_map)} groupes ({grp_table}): {list(group_map.values())[:5]}")
                    break

            if group_map:
                from ..models.print_history import Group

                # Un Group BambuNymous par groupe Spoolnymous (1:1 sur external_ref),
                # jamais de déduplication par nom : deux groupes Spoolnymous distincts
                # portant le même nom restent deux groupes BambuNymous distincts.
                old_to_new_group: dict[int, int] = {}
                for old_gid, gname in group_map.items():
                    res = (await db.execute(
                        text("SELECT id FROM groups WHERE external_ref=:e"),
                        {"e": str(old_gid)}
                    )).scalar_one_or_none()
                    if res:
                        old_to_new_group[old_gid] = res
                        continue
                    g = Group(name=gname, external_ref=str(old_gid))
                    db.add(g)
                    await db.flush()
                    old_to_new_group[old_gid] = g.id
                    stats["groups_created"] = stats.get("groups_created", 0) + 1

                # Rattacher chaque print importé à son groupe via group_id
                for old_pid, new_pid in print_map.items():
                    try:
                        row = src.execute(
                            "SELECT group_id FROM prints WHERE id=?", (int(old_pid),)
                        ).fetchone()
                        if not row or not row[0]:
                            continue
                        new_gid = old_to_new_group.get(row[0])
                        if not new_gid:
                            continue
                        await db.execute(
                            text("UPDATE prints SET group_id=:g WHERE id=:p"),
                            {"g": new_gid, "p": new_pid}
                        )
                        stats["groups"] = stats.get("groups", 0) + 1
                    except Exception as _ge:
                        logger.debug(f"[IMPORT] group for print {old_pid}: {_ge}")

            await db.commit()
            logger.info(f"[IMPORT] Prints:{stats.get('prints',0)} usage:{stats.get('filament_usage',0)} tags:{stats.get('tags',0)} groupes:{stats.get('groups',0)} (groupes créés:{stats.get('groups_created',0)})")

    src.close()
    logger.info(f"Import terminé: {stats}")
    return stats
