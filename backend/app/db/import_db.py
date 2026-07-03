"""
Import DB Spoolnymous → BambuNymous. Idempotent.
"""
import re, os, sqlite3, logging
from datetime import datetime
from sqlalchemy import text
from ..models.filament import Filament, Spool
from ..models.setting import Setting
from ..models.print_history import Print as PrintModel, FilamentUsage, PrintTag, Group
from ..models.object_history import Object, ObjectGroup, Accessory, ObjectAccessory

logger = logging.getLogger(__name__)


def parse_dt(val):
    if not val: return None
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try: return datetime.strptime(str(val).strip(), fmt)
        except: continue
    return None

def table_exists(conn, name):
    return bool(conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())

def col_exists(conn, table, col):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    return col in cols


async def run_import(src_path: str) -> dict:
    from ..db.session import AsyncSessionLocal, init_db
    await init_db()

    src = sqlite3.connect(src_path)
    src.row_factory = sqlite3.Row
    stats = {k: 0 for k in ["filaments","spools","settings","prints","filament_usage","tags",
                              "groups","objects","accessories","skipped"]}

    async with AsyncSessionLocal() as db:

        # ── SETTINGS ──────────────────────────────────────────────────────
        for src_key in ["PRINTER_ID","PRINTER_ACCESS_CODE","PRINTER_IP","COST_BY_HOUR"]:
            if not table_exists(src, "settings"): break
            row = src.execute("SELECT value FROM settings WHERE key=?", (src_key,)).fetchone()
            if not row or not row[0]: continue
            ex = (await db.execute(text("SELECT value FROM settings WHERE key=:k"), {"k": src_key})).scalar_one_or_none()
            if not ex:
                db.add(Setting(key=src_key, value=str(row[0])))
                stats["settings"] += 1

        # ── FILAMENTS ─────────────────────────────────────────────────────
        fil_map: dict[int, int] = {}
        for row in src.execute("SELECT * FROM filaments ORDER BY id").fetchall():
            row = dict(row)
            old_id = row["id"]
            ext_id = str(row.get("external_filament_id") or "")

            # Doublon
            if ext_id:
                res = (await db.execute(text("SELECT id FROM filaments WHERE external_filament_id=:e"), {"e": ext_id})).scalar_one_or_none()
                if res: fil_map[old_id] = res; stats["skipped"] += 1; continue
            res = (await db.execute(text("SELECT id FROM filaments WHERE id=:id"), {"id": old_id})).scalar_one_or_none()
            if res: fil_map[old_id] = old_id; stats["skipped"] += 1; continue

            db.add(Filament(
                id=old_id,
                name=row.get("name") or "Filament",
                translated_name=row.get("translated_name"),       # importé, enrichi ensuite
                manufacturer=row.get("manufacturer"),
                material=row.get("material") or "PLA",
                fila_type=row.get("fila_type") or row.get("material"),
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
            ))
            await db.flush()
            fil_map[old_id] = old_id
            stats["filaments"] += 1

        # ── BOBINES ───────────────────────────────────────────────────────
        spool_map: dict[int, int] = {}
        for row in src.execute("SELECT * FROM bobines ORDER BY id").fetchall():
            row = dict(row)
            old_id = row["id"]
            new_fil = fil_map.get(row.get("filament_id"))
            if not new_fil: continue

            res = (await db.execute(text("SELECT id FROM bobines WHERE id=:id"), {"id": old_id})).scalar_one_or_none()
            if res: spool_map[old_id] = old_id; stats["skipped"] += 1; continue

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
            spool_map[old_id] = old_id
            stats["spools"] += 1

        await db.commit()

        # ── PRINTS ────────────────────────────────────────────────────────
        print_map: dict[int, int] = {}
        if table_exists(src, "prints"):
            for row in src.execute("SELECT * FROM prints ORDER BY id").fetchall():
                row = dict(row)
                old_pid = row["id"]
                job_id = str(row.get("job_id") or "")

                if job_id:
                    res = (await db.execute(text("SELECT id FROM prints WHERE job_id=:j"), {"j": job_id})).scalar_one_or_none()
                    if res: print_map[old_pid] = res; stats["skipped"] += 1; continue
                res = (await db.execute(text("SELECT id FROM prints WHERE id=:id"), {"id": old_pid})).scalar_one_or_none()
                if res: print_map[old_pid] = old_pid; stats["skipped"] += 1; continue

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
                    external_ref=re.sub(r"\.(png|3mf|jpg)$","",os.path.basename(row.get("image_file") or ""),flags=re.IGNORECASE) or None,
                    estimated_seconds=row.get("estimated_seconds"),
                    duration_seconds=float(row.get("duration") or row.get("duration_seconds") or 0),
                    total_weight_g=float(row.get("total_weight") or row.get("total_weight_g") or 0),
                    # Coûts filament : override (full_cost) et normal (full_normal_cost)
                    total_cost_filament=float(row.get("total_cost") or row.get("total_cost_filament") or 0),
                    total_cost_filament_normal=float(row.get("full_normal_cost") or row.get("total_cost_filament_normal") or 0),
                    electric_cost=float(row.get("electric_cost") or 0),
                    total_cost=float(row.get("full_cost") or row.get("total_cost") or 0),
                    number_of_items=int(row.get("number_of_items") or 1),
                    sold_units=int(row.get("sold_units") or 0),
                    sold_price_total=row.get("sold_price_total"),
                    margin=float(row.get("margin") or 0),
                    plate_id=str(row.get("plate_id") or "1"),
                    design_id=row.get("design_id"),
                    printer_model=row.get("printer_model") or "H2C",
                    created_at=parse_dt(row.get("created_at")) or datetime.utcnow(),
                    updated_at=parse_dt(row.get("updated_at")) or datetime.utcnow(),
                )
                db.add(p); await db.flush()
                print_map[old_pid] = p.id
                stats["prints"] += 1

            # ── FILAMENT USAGE ─────────────────────────────────────────
            if table_exists(src, "filament_usage"):
                for row in src.execute("SELECT * FROM filament_usage ORDER BY id").fetchall():
                    row = dict(row)
                    new_pid = print_map.get(row.get("print_id"))
                    if not new_pid: continue
                    res = (await db.execute(text("SELECT id FROM filament_usage WHERE id=:id"), {"id": row["id"]})).scalar_one_or_none()
                    if res: continue
                    db.add(FilamentUsage(
                        id=row["id"],
                        print_id=new_pid,
                        spool_id=spool_map.get(row.get("spool_id")),
                        filament_type=row.get("filament_type") or "",
                        color_hex=row.get("color") or row.get("color_hex") or "",
                        grams_used=float(row.get("grams_used") or 0),
                        ams_slot=int(row.get("ams_slot") or 0),
                        ams_id=row.get("ams_id"),
                        tray_id=row.get("tray_id"),
                        cost=float(row.get("cost") or 0),
                        normal_cost=float(row.get("normal_cost") or 0),
                    ))
                    stats["filament_usage"] += 1

            # ── PRINT TAGS ─────────────────────────────────────────────
            if table_exists(src, "print_tags"):
                for row in src.execute("SELECT * FROM print_tags").fetchall():
                    row = dict(row)
                    new_pid = print_map.get(row.get("print_id"))
                    if not new_pid: continue
                    tag = row.get("tag") or ""
                    res = (await db.execute(text("SELECT id FROM print_tags WHERE print_id=:p AND tag=:t"), {"p": new_pid, "t": tag})).scalar_one_or_none()
                    if not res:
                        db.add(PrintTag(print_id=new_pid, tag=tag))
                        stats["tags"] += 1

            # ── GROUPES ────────────────────────────────────────────────
            group_map: dict[int, str] = {}
            for grp_table in ("print_groups", "groups"):
                if table_exists(src, grp_table):
                    for row in src.execute(f"SELECT id, name FROM {grp_table}").fetchall():
                        group_map[row[0]] = row[1] or f"Groupe {row[0]}"
                    break

            old_to_new_group: dict[int, int] = {}
            for old_gid, gname in group_map.items():
                res = (await db.execute(text("SELECT id FROM groups WHERE external_ref=:e"), {"e": str(old_gid)})).scalar_one_or_none()
                if res: old_to_new_group[old_gid] = res; continue
                try:
                    grow = src.execute("SELECT number_of_items FROM groups WHERE id=?", (int(old_gid),)).fetchone()
                    nb_items = (grow[0] or 1) if grow else 1
                except: nb_items = 1
                g = Group(name=gname, external_ref=str(old_gid), number_of_items=nb_items)
                db.add(g); await db.flush()
                old_to_new_group[old_gid] = g.id
                stats["groups"] += 1

            for old_pid, new_pid in print_map.items():
                try:
                    row = src.execute("SELECT group_id FROM prints WHERE id=?", (int(old_pid),)).fetchone()
                    if not row or not row[0]: continue
                    new_gid = old_to_new_group.get(row[0])
                    if new_gid:
                        await db.execute(text("UPDATE prints SET group_id=:g WHERE id=:p"), {"g": new_gid, "p": new_pid})
                except Exception as e: logger.debug(f"group link print {old_pid}: {e}")

            await db.commit()

        # ── OBJETS ────────────────────────────────────────────────────────
        obj_map: dict[int, int] = {}
        if table_exists(src, "objects"):
            # Groupes d'objets d'abord
            og_map: dict[int, int] = {}
            if table_exists(src, "object_groups"):
                for row in src.execute("SELECT * FROM object_groups ORDER BY id").fetchall():
                    row = dict(row)
                    res = (await db.execute(text("SELECT id FROM object_groups WHERE external_ref=:e"), {"e": str(row["id"])})).scalar_one_or_none()
                    if res: og_map[row["id"]] = res; continue
                    og = ObjectGroup(name=row["name"] or "Groupe", external_ref=str(row["id"]),
                                     desired_price=row.get("desired_price"),
                                     created_at=parse_dt(row.get("created_at")) or datetime.utcnow())
                    db.add(og); await db.flush()
                    og_map[row["id"]] = og.id
                await db.commit()

            for row in src.execute("SELECT * FROM objects ORDER BY id").fetchall():
                row = dict(row)
                old_oid = row["id"]
                res = (await db.execute(text("SELECT id FROM objects WHERE external_ref=:e"), {"e": str(old_oid)})).scalar_one_or_none()
                if res: obj_map[old_oid] = res; stats["skipped"] += 1; continue

                # parent_type : si parent_id référence un groupe prints → "group", sinon "print"
                parent_type = row.get("parent_type")
                if not parent_type:
                    parent_type = "group" if row.get("group_id") else "print"

                parent_id = print_map.get(row.get("parent_id")) if parent_type == "print" else old_to_new_group.get(row.get("parent_id"))

                obj = Object(
                    external_ref=str(old_oid),
                    name=row.get("name") or "Objet",
                    translated_name=row.get("translated_name"),
                    thumbnail=row.get("thumbnail"),
                    comment=row.get("comment"),
                    parent_type=parent_type,
                    parent_id=parent_id,
                    group_id=og_map.get(row.get("object_group_id")),
                    cost_fabrication=float(row.get("cost_fabrication") or 0),
                    cost_accessory=float(row.get("cost_accessory") or 0),
                    cost_total=float(row.get("cost_total") or 0),
                    normal_cost_unit=row.get("normal_cost_unit"),
                    available=bool(row.get("available", 1)),
                    personal=bool(row.get("personal", 0)),
                    sold_price=row.get("sold_price"),
                    sold_date=parse_dt(row.get("sold_date")),
                    desired_price=row.get("desired_price"),
                    margin=row.get("margin"),
                    created_at=parse_dt(row.get("created_at")) or datetime.utcnow(),
                    updated_at=parse_dt(row.get("updated_at")) or datetime.utcnow(),
                )
                db.add(obj); await db.flush()
                obj_map[old_oid] = obj.id
                stats["objects"] += 1

            await db.commit()

        # ── ACCESSOIRES ───────────────────────────────────────────────────
        acc_map: dict[int, int] = {}
        if table_exists(src, "accessories"):
            for row in src.execute("SELECT * FROM accessories ORDER BY id").fetchall():
                row = dict(row)
                old_aid = row["id"]
                res = (await db.execute(text("SELECT id FROM accessories WHERE external_ref=:e"), {"e": str(old_aid)})).scalar_one_or_none()
                if res: acc_map[old_aid] = res; stats["skipped"] += 1; continue
                acc = Accessory(
                    external_ref=str(old_aid),
                    name=row["name"],
                    quantity=int(row.get("quantity") or 0),
                    unit_price=float(row.get("unit_price") or 0),
                    image_path=row.get("image_path"),
                    created_at=parse_dt(row.get("created_at")) or datetime.utcnow(),
                    updated_at=parse_dt(row.get("updated_at")) or datetime.utcnow(),
                )
                db.add(acc); await db.flush()
                acc_map[old_aid] = acc.id
                stats["accessories"] += 1

            # Liens objet-accessoire
            if table_exists(src, "object_accessories"):
                for row in src.execute("SELECT * FROM object_accessories").fetchall():
                    row = dict(row)
                    new_oid = obj_map.get(row.get("object_id"))
                    new_aid = acc_map.get(row.get("accessory_id"))
                    if not new_oid or not new_aid: continue
                    res = (await db.execute(text("SELECT id FROM object_accessories WHERE object_id=:o AND accessory_id=:a"), {"o": new_oid, "a": new_aid})).scalar_one_or_none()
                    if not res:
                        db.add(ObjectAccessory(object_id=new_oid, accessory_id=new_aid,
                                               quantity=int(row.get("quantity") or 1),
                                               unit_price_at_link=float(row.get("unit_price_at_link") or 0)))

            await db.commit()

    src.close()

    # ── ENRICHISSEMENT CATALOGUE BAMBU (après import) ─────────────────────
    await _enrich_bambu_filaments_after_import()

    logger.info(f"[IMPORT] Terminé: {stats}")
    return stats


async def _enrich_bambu_filaments_after_import():
    """Enrichit les filaments Bambu Lab importés depuis le catalogue local."""
    try:
        from ..db.session import AsyncSessionLocal
        from ..models.filament import Filament
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            fils = (await db.execute(
                select(Filament).where(
                    Filament.profile_id.isnot(None),
                    Filament.profile_id != "",
                )
            )).scalars().all()

            enriched = 0
            for f in fils:
                try:
                    from ..services.bambu_catalog import enrich_filament_from_catalog
                    changed = await enrich_filament_from_catalog(db, f)
                    if changed:
                        enriched += 1
                except Exception:
                    pass

            if enriched:
                await db.commit()
            logger.info(f"[IMPORT] Enrichissement catalogue: {enriched}/{len(fils)} filaments Bambu enrichis")
    except Exception as e:
        logger.error(f"[IMPORT] Enrichissement catalogue: {e}")
