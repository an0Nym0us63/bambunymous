"""
Tracker d'impressions BambuNymous.
Gère : création, milestones (%, couches), snapshots, fin de print.
Logique identique à Spoolnymous (processMessage + safe_update_status).
"""
import asyncio, logging, re, time
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Optional, Dict, Any

from sqlalchemy import select, update

from ..models.print_history import Print, FilamentUsage, PrintSnapshot
from ..models.filament import Spool
from ..db.session import AsyncSessionLocal
from ..services.settings_service import get_setting
from ..services.tmf_parser import extract_3mf, _clean_name

logger = logging.getLogger(__name__)
DATA_DIR = Path("/data")

# ── État mémoire par job_id ────────────────────────────────────────────────
_LOCK   = Lock()
_JOBS:           Dict[str, Dict[str, Any]] = {}
_FIN_PENDING:    Dict[str, tuple]          = {}  # job_id -> (state, first_seen_ts)
_PROCESSED:      set                       = set()


def _job(job_id: str) -> dict:
    with _LOCK:
        if job_id not in _JOBS:
            _JOBS[job_id] = {
                "print_id": None, "last_pct": -1.0,
                "m50": False, "m99": False, "m100": False,
                "l2": False, "l3": False, "last_layer": 0,
                "start_time": time.time(),
            }
        return _JOBS[job_id]


async def restore_in_progress():
    """
    Au démarrage du container, recharge les prints IN_PROGRESS depuis la DB
    ET reconstruit les flags milestones depuis les snapshots existants.
    """
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Print).where(Print.status == "IN_PROGRESS")
            )
            prints = result.scalars().all()
            for p in prints:
                if not p.job_id:
                    continue
                st = _job(p.job_id)
                with _LOCK:
                    st["print_id"]   = p.id
                    st["start_time"] = p.created_at.timestamp() if p.created_at else time.time()

                # Reconstruire les flags milestones depuis les snapshots déjà pris
                snaps_r = await db.execute(
                    select(PrintSnapshot).where(PrintSnapshot.print_id == p.id)
                )
                existing_triggers = {s.trigger for s in snaps_r.scalars().all()}
                with _LOCK:
                    if "pct50"  in existing_triggers: st["m50"]  = True
                    if "pct99"  in existing_triggers: st["m99"]  = True
                    if "pct100" in existing_triggers: st["m100"] = True
                    if "layer1" in existing_triggers: st["l2"]   = True
                    if "layer2" in existing_triggers: st["l3"]   = True
                    # Initialiser last_pct au dernier milestone connu
                    # pour éviter de rejouer les snapshots au prochain tick MQTT
                    if "pct100" in existing_triggers: st["last_pct"] = 100.0
                    elif "pct99" in existing_triggers: st["last_pct"] = 99.0
                    elif "pct50" in existing_triggers: st["last_pct"] = 50.0
                    else: st["last_pct"] = 0.0

                logger.info(
                    f"[RESTORE] Print id={p.id} job={p.job_id} nom={p.file_name!r} "
                    f"milestones restaurés: {existing_triggers}"
                )
    except Exception as e:
        logger.error(f"[RESTORE] Erreur restore_in_progress: {e}")


def _bg(coro):
    import threading
    def _r():
        loop = asyncio.new_event_loop()
        try:    loop.run_until_complete(coro)
        finally: loop.close()
    threading.Thread(target=_r, daemon=True).start()


# ── Snapshot ───────────────────────────────────────────────────────────────
async def _snap(print_id: int, trigger: str):
    try:
        from ..api.v1.routes.camera import _grab_rtsps
        async with AsyncSessionLocal() as db:
            ip   = await get_setting(db, "PRINTER_IP")
            code = await get_setting(db, "PRINTER_ACCESS_CODE")
        if not ip or not code: return
        loop = asyncio.get_event_loop()
        jpeg = await loop.run_in_executor(None, _grab_rtsps, ip, code)
        d = DATA_DIR / "prints" / str(print_id)
        d.mkdir(parents=True, exist_ok=True)
        rel = f"prints/{print_id}/snapshot-{trigger}.jpg"
        (DATA_DIR / rel).write_bytes(jpeg)
        async with AsyncSessionLocal() as db:
            db.add(PrintSnapshot(print_id=print_id, trigger=trigger,
                                  file_path=rel, taken_at=datetime.utcnow()))
            await db.commit()
        logger.info(f"Snapshot {trigger} → {rel}")
    except Exception as e:
        logger.warning(f"Snapshot {trigger} print={print_id}: {e}")


# ── Création ───────────────────────────────────────────────────────────────
async def create_print(job_id: str, url: str, taskname: str,
                        print_type: str = "cloud",
                        printer_ip: str = "", printer_code: str = "",
                        ams_mapping: list = None, design_id: str = "") -> Optional[int]:
    async with AsyncSessionLocal() as db:
        existing = (await db.execute(select(Print).where(Print.job_id == str(job_id)))).scalar_one_or_none()
        if existing:
            logger.info(f"job_id {job_id} déjà en base → skip")
            return existing.id
        p = Print(
            job_id=str(job_id),
            print_date=datetime.utcnow(),
            file_name=_clean_name(taskname) or taskname,
            original_name=taskname,
            print_type=print_type,
            status="IN_PROGRESS",
            design_id=design_id or None,
        )
        db.add(p); await db.flush()
        pid = p.id; await db.commit()

    logger.info(f"[PRINT] ✅ Print créé: id={pid} job={job_id} ams_mapping={ams_mapping}")
    st = _job(job_id)
    with _LOCK:
        st["print_id"]    = pid
        st["start_time"]  = time.time()
        st["ams_mapping"] = ams_mapping or []
    # URLs HTTP pre-signed (AWS S3) expirent en ~60s → lancer un thread immédiat
    if url.startswith("http"):
        import threading as _dlt, asyncio as _dla
        _taskname, _url, _pid, _jid = taskname, url, pid, job_id
        def _dl_now(_u=_url, _p=_pid, _t=_taskname, _j=_jid):
            lp = _dla.new_event_loop()
            async def _go():
                from .tmf_parser import _download_http, _parse_3mf
                try:
                    raw = await _download_http(_u)
                    logger.info(f"[PRINT] ✅ 3MF téléchargé {len(raw)} bytes")
                    meta = _parse_3mf(raw, _p)
                    if meta: await _apply_meta(_p, meta, _t, job_id=_j)
                    else: logger.error(f"[PRINT] ❌ _parse_3mf vide print_id={_p}")
                except Exception as e:
                    import traceback as _tb
                    logger.error(f"[PRINT] ❌ 3MF failed: {e}\n{_tb.format_exc()}")
            try: lp.run_until_complete(_go())
            finally: lp.close()
        _dlt.Thread(target=_dl_now, daemon=True).start()
    else:
        _bg(_enrich(pid, job_id, url, taskname, printer_ip, printer_code))


async def _apply_meta(pid: int, meta: dict, taskname: str, job_id: str = ""):
    """Applique les métadonnées 3MF en base."""
    name = _clean_name(meta.get("title") or meta.get("file") or taskname)
    plate_id = meta.get("plate_id", "1")
    if plate_id != "1": name += " — Plateau " + plate_id
    logger.info(f"[DB] ▶ Sauvegarde print_id={pid} nom={name!r}")
    async with AsyncSessionLocal() as db:
        await db.execute(update(Print).where(Print.id == pid).values(
            file_name=name, plate_id=plate_id,
            estimated_seconds=meta.get("estimated_seconds"),
            plate_image=meta.get("plate_image"),
            model_3mf=meta.get("model_3mf"),
            design_id=meta.get("design_id", ""),
        ))

        for slot, fil in meta.get("filaments", {}).items():
            tray_info = (fil.get("tray_info_idx") or "").strip()
            spool_id = None
            try:
                spool_id, mode = await _spool_from_slot_or_match(
                    int(slot), tray_info, fil.get("color", ""), job_id=job_id
                )
                if spool_id:
                    logger.info(f"[DB] ✅ slot={slot} → spool_id={spool_id} ({mode}) profil={tray_info!r} couleur={fil.get('color')!r}")
                else:
                    logger.info(f"[DB] ⚠  slot={slot} profil={tray_info!r} → non trouvé ({mode})")
            except Exception as _e:
                logger.warning(f"[DB] slot={slot} matching error: {_e}")

            db.add(FilamentUsage(
                print_id=pid,
                filament_type=fil.get("type", ""),
                color_hex=fil.get("color", ""),
                grams_used=float(fil.get("used_g", 0)),
                ams_slot=int(slot),
                spool_id=spool_id,
            ))
            logger.info(f"[DB] FilamentUsage slot={slot} spool_id={spool_id} grams_used={fil.get('used_g',0)}")
        await db.commit()
        # Déduire immédiatement les grammes des bobines
        logger.info(f"[SPOOL] ▶ Appel déduction pour print #{pid}")
        p_obj = await db.get(Print, pid)
        if p_obj:
            await _deduct_spool_weights(db, p_obj)
            await db.commit()
            try:
                from ..core.mqtt import invalidate_tray_cache
                invalidate_tray_cache()
            except Exception:
                pass
            logger.info(f"[SPOOL] ✅ Déduction terminée print #{pid}")
    logger.info(f"[DB] ✅ Print {pid}: {name!r}, {len(meta.get('filaments',{}))} filaments")


async def _enrich(pid: int, job_id: str, url: str, taskname: str,
                   printer_ip: str, printer_code: str):
    try:
        logger.info(f"[3MF] ▶ Téléchargement 3MF pour print_id={pid} url={url[:60]!r}")
        meta = await extract_3mf(url, taskname, pid, printer_ip, printer_code)
        if not meta:
            logger.error(f"[3MF] ❌ Extraction vide pour print_id={pid}")
            return
        logger.info(f"[3MF] ✅ titre={meta.get('title')!r} plateau={meta.get('plate_id')} durée={meta.get('estimated_seconds')}s")
        logger.info(f"[3MF] ✅ vignette={meta.get('plate_image')} fichiers={meta.get('model_3mf')}")
        logger.info(f"[3MF] ✅ {len(meta.get('filaments', {}))} filaments: " + str({k: f"{v['type']} {v['color']} {v['used_g']}g" for k,v in meta.get('filaments',{}).items()}))
        name = _clean_name(meta.get("title") or meta.get("file") or taskname)
        plate_id = meta.get("plate_id", "1")
        if plate_id != "1": name += " — Plateau " + plate_id
        async with AsyncSessionLocal() as db:
            await db.execute(update(Print).where(Print.id == pid).values(
                file_name=name, plate_id=meta.get("plate_id", "1"),
                estimated_seconds=meta.get("estimated_seconds"),
                plate_image=meta.get("plate_image"),
                model_3mf=meta.get("model_3mf"),
                design_id=meta.get("design_id", ""),
            ))
            for slot, fil in meta.get("filaments", {}).items():
                tray_info = (fil.get("tray_info_idx") or "").strip()
                spool_id = None
                try:
                    spool_id, mode = await _spool_from_slot_or_match(
                        int(slot), tray_info, fil.get("color", ""), job_id=job_id
                    )
                    if spool_id:
                        logger.info(f"[DB] ✅ slot={slot} → spool_id={spool_id} ({mode}) profil={tray_info!r} couleur={fil.get('color')!r}")
                    else:
                        logger.info(f"[DB] ⚠  slot={slot} profil={tray_info!r} → non trouvé ({mode})")
                except Exception as _e:
                    logger.warning(f"[DB] slot={slot} matching error: {_e}")

                db.add(FilamentUsage(
                    print_id=pid,
                    filament_type=fil.get("type", ""),
                    color_hex=fil.get("color", ""),
                    grams_used=float(fil.get("used_g", 0)),
                    ams_slot=int(slot),
                    spool_id=spool_id,
                ))
            await db.commit()
            # Déduire immédiatement les grammes des bobines
            p_obj = await db.get(Print, pid)
            if p_obj:
                await _deduct_spool_weights(db, p_obj)
                await db.commit()
                try:
                    from ..core.mqtt import invalidate_tray_cache
                    invalidate_tray_cache()
                except Exception:
                    pass
        logger.info(f"[DB] ✅ Print {pid} sauvegardé: {name!r} avec {len(meta.get('filaments', {}))} filaments")
    except Exception as e:
        logger.error(f"_enrich pid={pid}: {e}")


# ── Milestones ─────────────────────────────────────────────────────────────
def on_progress(job_id: str, pct: float, layer: int):
    if not job_id or job_id in _PROCESSED: return
    st = _job(job_id); pid = st.get("print_id")
    if not pid:
        # Pas en mémoire (redémarrage container) → chercher en DB par job_id
        import asyncio as _afi
        def _find():
            lp = _afi.new_event_loop()
            async def _go():
                async with AsyncSessionLocal() as db:
                    r = await db.execute(select(Print).where(Print.job_id == str(job_id), Print.status == "IN_PROGRESS"))
                    p = r.scalar_one_or_none()
                    return p.id if p else None
            try:    return lp.run_until_complete(_go())
            finally: lp.close()
        pid = _find()
        if pid:
            with _LOCK: st["print_id"] = pid
            logger.info(f"[FINISH] Print récupéré depuis DB: id={pid} job={job_id}")
        else:
            logger.warning(f"[FINISH] job_id={job_id} introuvable en mémoire ni en DB")
            return

    prev = st["last_pct"]
    # Régression forte = nouveau print
    if prev >= 5.0 and pct <= 1.0:
        with _LOCK:
            st.update(last_pct=-1.0, m50=False, m99=False, m100=False, l2=False, l3=False)
        return

    with _LOCK: st["last_pct"] = max(prev, pct)

    def _fire(flag, thr, trig):
        with _LOCK:
            if st[flag] or prev >= thr or pct < thr: return
            st[flag] = True
        logger.info(f"[MILESTONE] 📸 Snapshot {trig} à {pct:.0f}% print_id={pid}")
        _bg(_snap(pid, trig))

    _fire("m50",  50.0,  "pct50")
    _fire("m99",  99.0,  "pct99")
    _fire("m100", 100.0, "pct100")

    if layer:
        with _LOCK:
            st["last_layer"] = max(st.get("last_layer", 0), layer)
            if not st["l2"] and layer >= 2:
                st["l2"] = True
                logger.info(f"[MILESTONE] 📸 Snapshot layer1 couche={layer} print_id={pid}")
                _bg(_snap(pid, "layer1"))
            if not st["l3"] and layer >= 3:
                st["l3"] = True
                logger.info(f"[MILESTONE] 📸 Snapshot layer2 couche={layer} print_id={pid}")
                _bg(_snap(pid, "layer2"))


def on_finish(job_id: str, gcode_state: str):
    if not job_id or job_id in _PROCESSED: return
    now = time.time()
    with _LOCK:
        if job_id not in _FIN_PENDING:
            _FIN_PENDING[job_id] = (gcode_state, now); return
        prev_s, t0 = _FIN_PENDING[job_id]
        if prev_s != gcode_state:
            _FIN_PENDING[job_id] = (gcode_state, now); return
        if now - t0 < 10: return   # anti-rebond 10s (≡ Spoolnymous)
        _PROCESSED.add(job_id); del _FIN_PENDING[job_id]

    st = _job(job_id); pid = st.get("print_id")
    if not pid: return
    final = "SUCCESS" if gcode_state == "FINISH" else "FAILED"
    logger.info(f"[PRINT] 🏁 Fin job={job_id} print_id={pid} statut={final}")
    if final == "FAILED":
        pct = int(st.get("last_pct", 0))
        logger.info(f"[MILESTONE] 📸 Snapshot échec à {pct}% print_id={pid}")
        _bg(_snap(pid, f"fail-{pct}pct"))
    _bg(_finalize(pid, job_id, final, st.get("start_time")))


async def _spool_from_slot_or_match(slot: int, tray_info: str, color: str, job_id: str = ""):
    """
    Retourne (spool_id, mode) pour un slot 3MF.
    Priorité 1 : ams_mapping MQTT (print.ams_mapping/ams_mapping2) stocké dans _JOBS
      -> ams_mapping[slot-1] = tray global (0=A1,1=A2,4=B1...)
      -> lookup spool_id dans l'état MQTT live
    Priorité 2 : fallback match_spool par profil+couleur
    """
    try:
        from ..core.mqtt import get_state
        state = get_state()
        am = []
        if job_id:
            st = _job(job_id)
            am = st.get("ams_mapping", [])

        if am and state and state.ams_list:
            idx = slot - 1  # slot 3MF 1-based -> 0-based
            if 0 <= idx < len(am):
                entry = am[idx]
                # ams_mapping est une liste de dicts {'ams_id': X, 'slot_id': Y}
                # ams_id=255 = slot non utilisé dans ce print
                if isinstance(entry, dict):
                    ams_id  = entry.get("ams_id",  255)
                    tray_id = entry.get("slot_id", 255)
                else:
                    # Format entier legacy (au cas où)
                    ams_id  = int(entry) // 4
                    tray_id = int(entry) % 4
                if ams_id == 255 or tray_id == 255:
                    logger.info(f"[SLOT] slot={slot} ams_mapping[{idx}] → non utilisé (255)")
                else:
                    ams = next((a for a in state.ams_list if a.id == ams_id), None)
                    if ams:
                        t = next((t for t in ams.trays if t.id == tray_id), None)
                        if t and t.spool_id:
                            logger.info(f"[SLOT] slot={slot} → AMS{ams_id} tray{tray_id} spool_id={t.spool_id} ✅")
                            return t.spool_id, "live"
                        logger.info(f"[SLOT] slot={slot} → AMS{ams_id} tray{tray_id} pas de spool_id mappé")
                    else:
                        logger.info(f"[SLOT] slot={slot} → AMS{ams_id} introuvable dans l'état MQTT")
            else:
                logger.info(f"[SLOT] slot={slot} hors plage ams_mapping (len={len(am)})")
        else:
            logger.info(f"[SLOT] slot={slot} ams_mapping vide → fallback match_spool")
    except Exception as e:
        logger.warning(f"[SLOT] ams_mapping lookup failed slot={slot}: {e}")

    # Fallback : match par profil+couleur
    try:
        from .spool_matcher import match_spool
        spool_id, mode = await match_spool("", tray_info, color)
        return spool_id, mode or "notfound"
    except Exception as e:
        logger.debug(f"[SLOT] match_spool fallback failed: {e}")
    return None, "notfound"

async def _finalize(pid: int, job_id: str, status: str, t0: Optional[float]):
    logger.info(f"[FINAL] ▶ Démarrage finalisation print #{pid} → {status}")
    try:
        async with AsyncSessionLocal() as db:
            p = await db.get(Print, pid)
            if not p: return
            p.status = status; p.updated_at = datetime.utcnow()
            if t0:
                real = time.time() - t0
                est  = p.estimated_seconds or 0
                if est <= 0 or real <= est * 1.3:
                    p.duration_seconds = real
            # Coûts
            await _costs(db, p)
            # Note: déduction des bobines faite au démarrage dans _apply_meta/_enrich
            await db.commit()
        # Logger APRÈS le with pour éviter TypeError si total_weight_g/total_cost est None
        tw = p.total_weight_g or 0
        tc = p.total_cost or 0
        logger.info(f"[FINAL] ✅ Print {pid} → {status} | poids={tw:.1f}g coût={tc:.2f}€")
        with _LOCK: _JOBS.pop(job_id, None)
    except Exception as e:
        logger.error(f"_finalize pid={pid}: {e}", exc_info=True)


async def _deduct_spool_weights(db, p: Print):
    """Déduit les grammes utilisés de chaque bobine liée à ce print."""
    try:
        # Tous les usages avec spool_id pour ce print (sans filtre grams_used)
        usages = (await db.execute(
            select(FilamentUsage).where(
                FilamentUsage.print_id == p.id,
                FilamentUsage.spool_id.isnot(None),
            )
        )).scalars().all()

        logger.info(f"[SPOOL] Déduction print #{p.id} : {len(usages)} usage(s) avec spool_id")

        for u in usages:
            logger.info(f"[SPOOL] Usage spool_id={u.spool_id} grams_used={u.grams_used}")
            if not u.grams_used or u.grams_used <= 0:
                logger.info(f"[SPOOL] Bobine #{u.spool_id} : grams_used={u.grams_used} → pas de déduction")
                continue
            spool = await db.get(Spool, u.spool_id)
            if not spool:
                logger.warning(f"[SPOOL] Bobine #{u.spool_id} introuvable en DB")
                continue
            if spool.remaining_weight_g is None:
                logger.warning(f"[SPOOL] Bobine #{spool.id} : remaining_weight_g est None → skip")
                continue
            before = spool.remaining_weight_g
            spool.remaining_weight_g = max(0.0, before - u.grams_used)
            logger.info(
                f"[SPOOL] ✅ Bobine #{spool.id} : {before:.0f}g → {spool.remaining_weight_g:.0f}g "
                f"(- {u.grams_used:.1f}g print #{p.id})"
            )
    except Exception as e:
        logger.error(f"_deduct_spool_weights print #{p.id}: {e}", exc_info=True)


async def _costs(db, p: Print):
    """Recalcule et stocke tous les coûts du print :
    - cost (override) : grams × prix_bobine / poids_nominal
    - normal_cost     : grams × prix_filament / poids_nominal
    - electric_cost   : durée_h × COST_BY_HOUR
    """
    try:
        from ..services.settings_service import get_setting
        from ..models.filament import Spool, Filament as FilamentModel
        from sqlalchemy import select as _sel

        usages = (await db.execute(
            select(FilamentUsage).where(FilamentUsage.print_id == p.id)
        )).scalars().all()

        # Charger tous les spools + filaments en une fois
        spool_ids = {u.spool_id for u in usages if u.spool_id}
        spools, fils = {}, {}
        if spool_ids:
            sp_rows = (await db.execute(_sel(Spool).where(Spool.id.in_(spool_ids)))).scalars().all()
            for sp in sp_rows:
                spools[sp.id] = sp
                if sp.filament_id:
                    fi = await db.get(FilamentModel, sp.filament_id)
                    if fi:
                        fils[sp.filament_id] = fi

        total_w  = 0.0
        total_c  = 0.0   # prix override (bobine)
        total_cn = 0.0   # prix normal (filament)

        for u in usages:
            g = u.grams_used or 0.0
            total_w += g
            sp = spools.get(u.spool_id)
            fi = fils.get(sp.filament_id) if sp and sp.filament_id else None
            w_ref = (fi.filament_weight_g if fi and fi.filament_weight_g else None) or 1000.0

            # Coût override = prix de la bobine
            price_sp = (sp.price_override or 0) if sp else 0
            cost_ov  = round(g * price_sp / w_ref, 4) if price_sp else 0.0

            # Coût normal = prix de référence du filament
            price_fi = (fi.price or 0) if fi else 0
            cost_no  = round(g * price_fi / w_ref, 4) if price_fi else 0.0

            u.cost        = cost_ov
            u.normal_cost = cost_no
            total_c  += cost_ov
            total_cn += cost_no

        rate  = float(await get_setting(db, "COST_BY_HOUR") or 0)
        dur_h = (p.duration_seconds or p.estimated_seconds or 0) / 3600
        elec  = round(dur_h * rate, 4)

        p.total_weight_g             = total_w
        p.total_cost_filament        = round(total_c, 4)
        p.total_cost_filament_normal = round(total_cn, 4)
        p.electric_cost              = elec
        p.total_cost                 = round(total_c + elec, 4)
        logger.info(f"[COST] print #{p.id} : fil={total_c:.2f}€ fil_normal={total_cn:.2f}€ elec={elec:.2f}€ total={p.total_cost:.2f}€")
    except Exception as e:
        logger.error(f"_costs print #{getattr(p,'id','?')}: {e}", exc_info=True)


async def recalculate_print(pid: int):
    """Recalcule les coûts d'un print (appelé lors de changement de prix filament/bobine/élec)."""
    try:
        async with AsyncSessionLocal() as db:
            p = await db.get(Print, pid)
            if not p: return
            await _costs(db, p)
            await db.commit()
        logger.info(f"[COST] ✅ Recalcul print #{pid} terminé")
    except Exception as e:
        logger.error(f"recalculate_print #{pid}: {e}", exc_info=True)


# ── Import manuel (upload .3mf) ────────────────────────────────────────────
async def create_manual_print(local_path: str, print_date: datetime) -> Optional[int]:
    try:
        import aiofiles
        async with aiofiles.open(local_path, "rb") as f: data = await f.read()
        # Créer un print temporaire pour obtenir l'id
        async with AsyncSessionLocal() as db:
            p = Print(print_date=print_date, file_name="import", print_type="manual", status="SUCCESS")
            db.add(p); await db.flush(); pid = p.id; await db.commit()
        from ..services.tmf_parser import _parse_3mf, _clean_name
        meta = _parse_3mf(data, pid)
        name = _clean_name(meta.get("title") or meta.get("file") or Path(local_path).stem)
        plate_id2 = meta.get("plate_id", "1")
        if plate_id2 != "1": name += " — Plateau " + plate_id2
        async with AsyncSessionLocal() as db:
            await db.execute(update(Print).where(Print.id == pid).values(
                file_name=name, original_name=Path(local_path).name,
                plate_id=meta.get("plate_id", "1"),
                estimated_seconds=meta.get("estimated_seconds"),
                duration_seconds=meta.get("estimated_seconds"),  # estimé = réel pour import manuel
                plate_image=meta.get("plate_image"),
                model_3mf=meta.get("model_3mf"),
                design_id=meta.get("design_id", ""),
            ))
            for slot, fil in meta.get("filaments", {}).items():
                db.add(FilamentUsage(
                    print_id=pid, filament_type=fil.get("type", ""),
                    color_hex=fil.get("color", ""), grams_used=float(fil.get("used_g", 0)),
                    ams_slot=int(slot),
                ))
            await db.commit()
        return pid
    except Exception as e:
        logger.error(f"create_manual_print: {e}"); return None
