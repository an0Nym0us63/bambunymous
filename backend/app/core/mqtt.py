"""
MQTT Manager — Bambu Lab H2C.
Températures: encodage little-endian int32 (b[0]=actuel°C, b[2]=target°C).
"""
import json, logging, ssl, threading
from typing import Callable
import paho.mqtt.client as mqtt
from ..models.printer import PrinterState, AMS, AMSTray, HotendRack, HotendSlot, NozzleTemp

logger = logging.getLogger(__name__)
state = PrinterState()
_listeners: list[Callable] = []

# Cache matching AMS: (ams_id, tray_id, uuid_or_profile) → spool_id|-1
# Évite de relancer un thread de matching à chaque tick MQTT (toutes les 2s)
_MATCH_CACHE: dict = {}
_CACHE_TS:    dict = {}   # timestamp de mise en cache par clé
_CACHE_TTL = 60            # expiration auto 60s
_MATCH_MODE_CACHE: dict = {}  # même clé → "rfid"/"auto"/"notfound" (persiste même sans spool_id)
_SPOOL_INFO_CACHE: dict = {}  # même clé → dict spool_info


def get_state() -> PrinterState:
    return state

def subscribe_state(fn: Callable):
    _listeners.append(fn)

def _notify():
    for fn in _listeners:
        try: fn(state)
        except Exception: logger.exception("Listener error")


def invalidate_tray_cache(tag_uid: str = "", profile_id: str = "") -> int:
    """
    Vide les entrées de cache de matching pour forcer un re-match au prochain tick MQTT.
    Utilisé après une assignation manuelle (map-tray/link ou map-tray/create) pour que
    l'état AMS reflète immédiatement la nouvelle bobine sans attendre un changement MQTT.

    Si tag_uid ou profile_id est fourni → on invalide uniquement les clés qui contiennent
    l'un de ces identifiants. Sinon → on vide tout le cache (safe : déclenche juste
    un re-match sur tous les trays au prochain tick).
    """
    invalidated = 0
    for cache in (_MATCH_CACHE, _MATCH_MODE_CACHE, _SPOOL_INFO_CACHE, _CACHE_TS):
        invalidated += len(cache)
        cache.clear()
    # Resetter _spool_info_cache sur tous les trays en mémoire
    try:
        s = get_state()
        if s:
            for a in (s.ams_list or []):
                for t in (a.trays or []):
                    t._spool_info_cache = None
    except Exception:
        pass
    logger.info(f"[CACHE] {invalidated} entrées vidées + _spool_info_cache tray resetté")
    return invalidated


def _decode_temp(raw: int) -> tuple[float, float]:
    """Décode un int32 Bambu H2C en (actuel°C, target°C).
    Méthode ha-bambulab: low word = actuel, high word = target.
    Ex: 14418139 → actuel=219°C, target=220°C
    """
    if raw < 0:
        return 0.0, 0.0
    current = raw & 0xFFFF
    target  = (raw >> 16) & 0xFFFF
    return float(current), float(target)


class MQTTManager:
    def __init__(self):
        self._client = None
        self._connected = False
        self._thread = None
        self._stop_event = threading.Event()
        self._printer_id = ""
        self._ip = ""
        self._code = ""

    async def start(self):
        from ..services.settings_service import get_setting
        from ..db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            self._printer_id = await get_setting(db, "PRINTER_ID")
            self._ip = await get_setting(db, "PRINTER_IP")
            self._code = await get_setting(db, "PRINTER_ACCESS_CODE")
        if not self._ip or not self._printer_id:
            logger.info("MQTT: imprimante non configurée")
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info(f"MQTT: démarrage vers {self._ip}")

    async def stop(self):
        self._stop_event.set()
        if self._client:
            self._client.disconnect()

    def reconnect(self, ip, printer_id, code):
        self._ip, self._printer_id, self._code = ip, printer_id, code
        if self._client:
            try: self._client.disconnect()
            except: pass
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def _run_loop(self):
        while not self._stop_event.is_set():
            try: self._connect_once()
            except Exception as e:
                logger.warning(f"MQTT erreur: {e}, retry 15s")
            self._stop_event.wait(15)

    def _connect_once(self):
        c = mqtt.Client()
        c.username_pw_set("bblp", self._code)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        c.tls_set_context(ctx)
        c.tls_insecure_set(True)
        c.on_connect = self._on_connect
        c.on_disconnect = self._on_disconnect
        c.on_message = self._on_message
        c.connect(self._ip, 8883, keepalive=60)
        self._client = c
        c.loop_forever()

    def _on_connect(self, c, u, f, rc):
        self._connected = True
        state.connected = True
        _notify()
        logger.info(f"MQTT connecté rc={rc}")
        c.subscribe(f"device/{self._printer_id}/report")
        c.publish(f"device/{self._printer_id}/request",
                  json.dumps({"pushing": {"sequence_id": "0", "command": "pushall"}}))

    def _on_disconnect(self, c, u, rc):
        self._connected = False
        state.connected = False
        _notify()
        logger.warning(f"MQTT déconnecté rc={rc}")

    def _on_message(self, c, u, msg):
        try:
            data = json.loads(msg.payload.decode())
            if "print" in data:
                self._process_print(data["print"])
            elif "info" in data:
                self._process_info(data["info"])
        except Exception as _e:
            import traceback as _tb
            logger.error(f"MQTT message error: {_e}\n{_tb.format_exc()}")

    def _process_info(self, info: dict):
        for m in info.get("module", []):
            if m.get("name") == "ota":
                if m.get("sn"): state.serial = m["sn"]
                if m.get("sw_ver"): state.fw_version = m["sw_ver"]

    def _process_print(self, p: dict):
        changed = False

        # ── Statut ──────────────────────────────────────────────────────
        if "gcode_state" in p:
            if state.status != p["gcode_state"]:
                logger.info(f"[MQTT] status: {state.status} → {p['gcode_state']}")
            state.status = p["gcode_state"]; changed = True
        if "mc_percent" in p:
            state.progress = float(p["mc_percent"]); changed = True
        if "remain_time" in p:
            state.remaining_minutes = int(p["remain_time"]); changed = True
        elif "mc_remaining_time" in p:
            state.remaining_minutes = int(p["mc_remaining_time"]); changed = True

        block_3d = p.get("3D", {})
        if "layer_num" in block_3d:
            state.layer = int(block_3d["layer_num"]); changed = True
        if "total_layer_num" in block_3d:
            state.total_layers = int(block_3d["total_layer_num"]); changed = True
        if "layer_num" in p:
            state.layer = int(p["layer_num"]); changed = True
        if "total_layer_num" in p:
            state.total_layers = int(p["total_layer_num"]); changed = True

        if "subtask_name" in p: state.print_name = p["subtask_name"]; changed = True
        if "job_id" in p: state.job_id = str(p["job_id"]); changed = True
        if "design_id" in p: state.design_id = str(p["design_id"]); changed = True
        if "model_id" in p: state.model_id = str(p["model_id"]); changed = True
        if "profile_id" in p: state.profile_id = str(p["profile_id"]); changed = True
        if "gcode_file" in p: state.gcode_file = p["gcode_file"]; changed = True
        if "stg_cur" in p: state.print_stage = int(p["stg_cur"]); changed = True
        if "spd_lvl" in p: state.speed_level = int(p["spd_lvl"]); changed = True
        if "spd_mag" in p: state.speed_mag = int(p["spd_mag"]); changed = True

        # ── Historique impressions ─────────────────────────────────────────
        import threading as _pth, asyncio as _pio
        from app.services.print_tracker import (
            create_print as _cp, on_progress as _op, on_finish as _of
        )
        from app.db.session import AsyncSessionLocal as _PAS
        from app.services.settings_service import get_setting as _PGS

        _jid  = str(p.get("job_id", "")) if p.get("job_id") else ""
        _gst  = p.get("gcode_state", "")
        _pct  = float(p.get("mc_percent", 0) or 0)
        _lay  = int(p.get("layer_num", 0) or 0)
        _task = p.get("subtask_name", "")
        _url  = p.get("url", "")

        # Cloud: command=project_file + url
        if p.get("command") == "project_file" and _url and _jid:
            _am0 = p.get("ams_mapping2") or p.get("ams_mapping") or []
            _u0, _t0, _j0, _am0 = _url, _task, _jid, _am0
            def _cloud0(_u=_u0, _t=_t0, _j=_j0, _am=_am0):
                lp = _pio.new_event_loop()
                async def _go():
                    async with _PAS() as db:
                        ip   = await _PGS(db, "PRINTER_IP")
                        code = await _PGS(db, "PRINTER_ACCESS_CODE")
                    _did = str(p.get("design_id", "") or state.design_id or "")
                    await _cp(_j, _u, _t, "cloud", ip or "", code or "", ams_mapping=_am, design_id=_did)
                try:    lp.run_until_complete(_go())
                finally: lp.close()
            _pth.Thread(target=_cloud0, daemon=True).start()

        # Local: RUNNING après PREPARE + print_type=local
        elif (_gst == "RUNNING" and p.get("print_type") == "local"
              and p.get("gcode_file") and _jid
              and state.status in ("PREPARE", "IDLE", "")):
            _u2 = "ftp://" + (p.get("gcode_file") or "")
            _t2 = p.get("subtask_name") or p.get("gcode_file") or ""
            _j2 = _jid
            _am2 = p.get("ams_mapping2") or p.get("ams_mapping") or []
            def _local2(_u=_u2, _t=_t2, _j=_j2, _am=_am2):
                lp = _pio.new_event_loop()
                async def _go():
                    async with _PAS() as db:
                        ip   = await _PGS(db, "PRINTER_IP")
                        code = await _PGS(db, "PRINTER_ACCESS_CODE")
                    _did2 = str(p.get("design_id", "") or state.design_id or "")
                    await _cp(_j, _u, _t, "local", ip or "", code or "", ams_mapping=_am, design_id=_did2)
                try:    lp.run_until_complete(_go())
                finally: lp.close()
            _pth.Thread(target=_local2, daemon=True).start()

        # Milestones
        if _jid and _gst == "RUNNING":
            _op(_jid, _pct, _lay)
        # Fin
        if _jid and _gst in ("FINISH", "FAILED"):
            _of(_jid, _gst)

        # SN depuis upgrade_state
        sn = p.get("upgrade_state", {}).get("sn", "")
        if sn and not state.serial:
            state.serial = sn

        # ── Températures (device block H2C) ──────────────────────────────
        device = p.get("device", {})
        extruder_infos = []
        active_nozzle_idx = 0
        if device:
            # Bed: encodage int32 little-endian
            bed_raw = device.get("bed", {}).get("info", {}).get("temp")
            if bed_raw is not None:
                state.bed_temp, state.target_bed_temp = _decode_temp(int(bed_raw))
                changed = True

            # Chambre (ctc): valeur directe en °C
            ctc_temp = device.get("ctc", {}).get("info", {}).get("temp")
            if ctc_temp is not None:
                state.chamber_temp = float(ctc_temp)
                changed = True

            # Dual nozzle extruder (H2C)
            extruder = device.get("extruder", {})
            extruder_state = extruder.get("state", 0)
            active_nozzle_idx = (extruder_state >> 4) & 0xF
            extruder_infos = extruder.get("info", [])
            for ext in extruder_infos:
                eid = int(ext.get("id", 0))
                # Chercher par id, pas par index (l'ordre peut ne pas correspondre)
                n = next((x for x in state.nozzles if x.id == eid), None)
                if n is None:
                    n = NozzleTemp(id=eid)
                    state.nozzles.append(n)
                temp_raw = ext.get("temp", 0)
                if isinstance(temp_raw, int) and temp_raw > 0xFFFF:
                    n.temp   = float(temp_raw & 0xFFFF)
                    n.target = float((temp_raw >> 16) & 0xFFFF)
                elif isinstance(temp_raw, (int, float)) and temp_raw > 0:
                    n.temp   = float(temp_raw)
                    n.target = 0.0
                n.active = (eid == active_nozzle_idx)
                changed = True

        # Fallback legacy (P1/X1 — pas utilisé sur H2C qui utilise device.extruder)
        # NE PAS écraser nozzle_temper sur nozzles[0] car H2C envoie aussi ce champ
        # avec la temp de la buse active, ce qui écrase la vraie valeur de id=0
        if "bed_temper" in p: state.bed_temp = float(p["bed_temper"]); changed = True
        if "bed_target_temper" in p: state.target_bed_temp = float(p["bed_target_temper"]); changed = True
        if "chamber_temper" in p: state.chamber_temp = float(p["chamber_temper"]); changed = True

        # ── AMS ─────────────────────────────────────────────────────────
        ams_data = p.get("ams", {})
        if "ams" in ams_data:
            # Source fiable de l'AMS+tray actif sur H2C (double buse) :
            # device.extruder.info[].snow, pour l'entrée dont id == buse active
            # (active_nozzle_idx, calculé plus haut). snow est bit-packé :
            # ams_id = snow >> 8, tray_local = snow & 0x3.
            # /!\ tray_now seul est un index LOCAL (0-3) à l'AMS actif, PAS un
            # index global (ams*4+tray) — confirmé par Spoolnymous et par les
            # logs [ACTIVE] (toujours ams_id=0 quel que soit l'AMS réel).
            # On ne garde tray_now que comme repli legacy (mono-buse / vieux firmware).
            new_ams, new_tray = None, None
            source = None
            for ext in extruder_infos:
                if int(ext.get("id", -1)) == active_nozzle_idx and "snow" in ext:
                    try:
                        snow_val = int(ext.get("snow"))
                        new_ams  = snow_val >> 8
                        new_tray = snow_val & 0x3
                        source = "snow"
                    except (TypeError, ValueError):
                        pass
                    break

            tray_now_raw = ams_data.get("tray_now", -1)
            tray_now = int(tray_now_raw) if tray_now_raw is not None else -1
            state.active_tray_local = tray_now

            if new_ams is None and 0 <= tray_now <= 15:
                # Repli legacy : suppose un index global (vrai sur mono-buse/AMS unique)
                new_ams, new_tray = tray_now // 4, tray_now % 4
                source = "tray_now_fallback"

            # Diagnostic ponctuel : structure brute de extruder_infos, pour vérifier
            # si le champ "snow" existe réellement dans ce payload/firmware.
            if extruder_infos and getattr(state, "_extruder_infos_logged", None) != str(extruder_infos):
                logger.info(f"[ACTIVE] device.extruder.info brut: {extruder_infos}")
                state._extruder_infos_logged = str(extruder_infos)

            if new_ams is not None and new_tray is not None:
                if new_ams != state.active_ams_id or new_tray != state.active_tray_id:
                    logger.info(f"[ACTIVE] source={source} → ams_id={new_ams} tray={new_tray} (tray_now={tray_now}, nozzle={active_nozzle_idx}) — avant: ams={state.active_ams_id} tray={state.active_tray_id}")
                state.active_ams_id  = new_ams
                state.active_tray_id = new_tray
            # Si tray_now==255 (transition) ou 254 (externe) : on garde la dernière valeur connue
            # plutôt que de tout effacer, pour éviter un clignotement de la surbrillance.
            state.ams_list = []
            for ams_raw in ams_data["ams"]:
                ams = AMS(id=int(ams_raw.get("id", 0)),
                          humidity=int(ams_raw.get("humidity_raw", 0)),
                          temp=float(ams_raw.get("temp", 0)),
                          dry_time=int(ams_raw.get("dry_time", 0)))
                dry_setting = ams_raw.get("dry_setting", {}) or {}
                if dry_setting:
                    ams.dry_temperature = max(int(dry_setting.get("dry_temperature", 0)), 0)
                    ams.dry_duration    = max(int(dry_setting.get("dry_duration", 0)), 0)
                    ams.dry_filament    = dry_setting.get("dry_filament", "")
                for tr in ams_raw.get("tray", []):
                    t = AMSTray(id=int(tr.get("id", 0)))
                    t.color = (tr.get("tray_color") or "").rstrip("FF") or tr.get("tray_color", "")
                    t.filament_type = (tr.get("tray_sub_brands") or "").strip() or (tr.get("tray_type") or "").strip()
                    t.tray_id_name = tr.get("tray_id_name", "")
                    t.remain = max(0, int(tr.get("remain", 0)))
                    t.uuid = (tr.get("tray_uuid") or "")
                    t.tag_uid = tr.get("tag_uid", "")
                    # Un tray est vide uniquement si son UUID est tout à zéro
                    # Les filaments custom n'ont pas de tray_sub_brands mais ont un UUID valide
                    tray_uuid = tr.get("tray_uuid", "") or ""
                    tray_color = tr.get("tray_color", "") or ""
                    t.empty = (
                        tray_uuid.replace("0", "") == "" and
                        tray_color.replace("0", "") == ""
                    )
                    t.drying_temp = int(tr.get("drying_temp") or 0)
                    t.drying_time = int(tr.get("drying_time") or 0)
                    t.total_len = int(tr.get("total_len") or 0)
                    # ── Champs bruts pour le matching ─────────────────────
                    _tray_info   = (tr.get("tray_info_idx") or "").strip()
                    _tag_uid     = (tr.get("tag_uid") or "").strip()
                    _tray_uuid   = (tr.get("tray_uuid") or "").strip()
                    _sub_brands  = (tr.get("tray_sub_brands") or "").strip()
                    _tray_color  = (tr.get("tray_color") or "").strip()
                    _uid_valid   = bool(_tag_uid and _tag_uid.replace("0",""))
                    _uuid_valid  = bool(_tray_uuid and _tray_uuid.replace("0",""))

                    # Stocker tray_info_idx sur le tray pour l'API
                    t.tray_info_idx = _tray_info
                    t.cols  = tr.get("cols", []) or []
                    t.ctype = str(tr.get("ctype", "") or "")

                    # ── Log détaillé par slot (1 seul log à l'init du tray) ──
                    if not t.empty:
                        logger.debug(
                            f"[AMS] AMS{ams.id} tray{t.id} | "
                            f"type={t.filament_type!r} color={_tray_color!r} "
                            f"tag_uid={_tag_uid!r} tray_info_idx={_tray_info!r} "
                            f"sub_brands={_sub_brands!r} uuid={_tray_uuid!r}"
                        )

                    # Match mode :
                    # rfid   = uuid non vide = tag RFID Bambu (tray_uuid = vrai identifiant NFC)
                    # auto   = tray_info_idx connu → matching DB par profil/couleur
                    # manual = filament présent mais non identifiable
                    if _uuid_valid:
                        t.match_mode = "rfid"
                    elif _tray_info:
                        t.match_mode = "auto"
                    elif not t.empty:
                        t.match_mode = "manual"
                    else:
                        t.match_mode = ""

                    # ── Matching spool en DB — cache par tray ──────────────
                    if not t.empty:
                        import threading as _mth, asyncio as _mio
                        _cache_key = (ams.id, t.id, _tray_uuid or _tray_info or "")
                        _cached_id = _MATCH_CACHE.get(_cache_key)
                        _cached_age = __import__('time').time() - _CACHE_TS.get(_cache_key, 0)
                        if _cached_id is not None and _cached_age < _CACHE_TTL:
                            # Cache hit — restaurer spool_id, match_mode et spool_info
                            t.spool_id = _cached_id if _cached_id != -1 else None
                            if _cache_key in _MATCH_MODE_CACHE:
                                t.match_mode = _MATCH_MODE_CACHE[_cache_key]
                            if t.spool_id and _cache_key in _SPOOL_INFO_CACHE:
                                t._spool_info_cache = _SPOOL_INFO_CACHE[_cache_key]
                        else:
                            # Nouveau tray → lancer le matching
                            def _match_spool(_t=t, _tag=_tray_uuid, _tinfo=_tray_info,
                                             _tc=_tray_color, _ams_id=ams.id, _tray_slot=t.id,
                                             _key=_cache_key):
                                lp = _mio.new_event_loop()
                                async def _go():
                                    from ..services.spool_matcher import match_spool
                                    spool_id, mode = await match_spool(_tag, _tinfo, _tc)
                                    _MATCH_CACHE[_key] = spool_id if spool_id else -1
                                    _CACHE_TS[_key] = __import__('time').time()
                                    # mode est mis en cache même sans spool_id (ex: "notfound")
                                    # pour ne pas revenir au mode provisoire "rfid"/"auto" au tick suivant
                                    if mode:
                                        _t.match_mode = mode
                                        _MATCH_MODE_CACHE[_key] = mode
                                    if spool_id:
                                        _t.spool_id   = spool_id
                                        loc = f"AMS-{chr(65+_ams_id)} slot {_tray_slot+1}"
                                        logger.debug(f"[AMS] {_ams_id}/{_tray_slot} → #{spool_id} {mode}")
                                        # Stocker spool_info en cache
                                        try:
                                            from ..db.session import AsyncSessionLocal as _ASL
                                            from ..models.filament import Spool as _Sp2, Filament as _Fi2
                                            async with _ASL() as _db2:
                                                _sp2 = await _db2.get(_Sp2, spool_id)
                                                _fi2 = await _db2.get(_Fi2, _sp2.filament_id) if _sp2 and _sp2.filament_id else None
                                            if _sp2:
                                                _info = {
                                                    "id": _sp2.id,
                                                    "name": _fi2.name if _fi2 else None,
                                                    "translated_name": getattr(_fi2, "translated_name", None) if _fi2 else None,
                                                    "color": f"#{_fi2.color}" if _fi2 and _fi2.color else None,
                                                    "material": _fi2.material if _fi2 else None,
                                                    "brand": _fi2.manufacturer if _fi2 else None,
                                                    "remaining_weight_g": _sp2.remaining_weight_g,
                                                    "initial_weight_g": _fi2.filament_weight_g if _fi2 else None,
                                                    "multicolor_type": _fi2.multicolor_type if _fi2 else None,
                                                    "colors_array": _fi2.colors_array if _fi2 else None,
                                                }
                                                _t._spool_info_cache = _info
                                                _SPOOL_INFO_CACHE[_key] = _info
                                        except Exception as _ce:
                                            logger.debug(f"[AMS] spool_info cache: {_ce}")
                                        try:
                                            from ..services.spool_location import update_spool_location
                                            await update_spool_location(spool_id, loc)
                                        except Exception as _le:
                                            logger.debug(f"[AMS] loc: {_le}")
                                    else:
                                        logger.debug(f"[AMS] {_ams_id}/{_tray_slot} no match ({mode})")
                                try:    lp.run_until_complete(_go())
                                finally: lp.close()
                            _mth.Thread(target=_match_spool, daemon=True).start()

                    ams.trays.append(t)
                state.ams_list.append(ams)

            # Retrait AMS : supprimer du cache les trays qui ne sont plus présents
            # → sera mis en Tiroir au prochain tick via spool_location
            try:
                current_keys = {
                    (a.id, t.id, t.uuid or t.tray_info_idx or "")
                    for a in state.ams_list for t in a.trays if not t.empty
                }
                for _k in list(_MATCH_CACHE.keys()):
                    if _k not in current_keys:
                        _old = _MATCH_CACHE.pop(_k, -1)
                        if _old and _old != -1:
                            import asyncio as _lio3, threading as _lth3
                            def _mk_drawer(_sid=_old):
                                lp = _lio3.new_event_loop()
                                async def _d():
                                    from ..services.spool_location import update_spool_location
                                    await update_spool_location(_sid, "Tiroir")
                                try: lp.run_until_complete(_d())
                                finally: lp.close()
                            _lth3.Thread(target=_mk_drawer, daemon=True).start()
            except Exception as _le:
                logger.debug(f"[AMS] inactive check: {_le}")

            changed = True

        if "mapping" in p:
            state.ams_mapping = p["mapping"]
            # mapping[0] encodait auparavant l'AMS+tray actif (high byte=ams, low byte=tray),
            # mais confirmé par logs [ACTIVE] : ce champ reste figé pendant un print bicolore
            # (mapping de job, pas l'extrudeur réel). La source fiable est désormais tray_now
            # ci-dessus. On ne s'en sert plus que comme fallback si tray_now est invalide.
            if p["mapping"] and not (0 <= state.active_tray_local <= 15):
                v = p["mapping"][0]
                new_ams, new_tray = (v >> 8) & 0xFF, v & 0xFF
                if new_ams != state.active_ams_id or new_tray != state.active_tray_id:
                    logger.info(f"[ACTIVE] fallback mapping={p['mapping']} → active_ams_id {state.active_ams_id}→{new_ams} active_tray_id {state.active_tray_id}→{new_tray}")
                state.active_ams_id  = new_ams
                state.active_tray_id = new_tray
            changed = True

        # ── Hotend Rack Vortek ───────────────────────────────────────────
        if device:
            # Log unique de toutes les clés du device pour trouver le rack
            if not getattr(state, "_device_keys_logged", False):
                logger.info(f"[RACK] device keys: {list(device.keys())}")
                for k, v in device.items():
                    if isinstance(v, dict):
                        logger.info(f"[RACK] device.{k} keys: {list(v.keys())}")
                state._device_keys_logged = True

            nozzle = device.get("nozzle", {})
            if "info" in nozzle:
                src_id = int(nozzle.get("src_id", -1))
                rack = HotendRack(
                    active_id=src_id,
                    target_id=nozzle.get("tar_id", -1),
                    state=nozzle.get("state", 0),
                )
                holder = device.get("holder", {})
                rack.holder_pos = holder.get("pos", 0)
                rack.holder_stat = holder.get("stat", 0)
                rack.holder_job = holder.get("job", 0)
                exist_bits = nozzle.get("exist", 0)
                logger.info(f"[RACK] nozzle.info brut: {nozzle['info'][:3]}")
                for n in nozzle["info"]:
                    rack.hotends.append(HotendSlot(
                        id=int(n.get("id", 0)),
                        color=(n.get("color_m") or "").strip(),
                        filament_id=n.get("fila_id", ""),
                        diameter=float(n.get("diameter", 0.4)),
                        nozzle_type=n.get("type", ""),
                        serial=n.get("sn", ""),
                        wear=float(n.get("wear", 0)),
                        print_time=int(n.get("p_t", 0)),  # p_t en secondes (confirme log MQTT: p_t=61251 ≈ 17h)
                        empty=not bool((n.get("fila_id") or "").strip()),
                    ))
                src_in_rack = bool(exist_bits & (1 << src_id)) if 0 <= src_id < 64 else False
                rack.head_id = src_id if not src_in_rack else -1
                rack.head_in_rack_idx = next(
                    (idx for idx, hh in enumerate(rack.hotends) if hh.id == src_id), -1
                ) if src_in_rack else -1
                state.hotend_rack = rack
                changed = True

        # ── HMS ──────────────────────────────────────────────────────────
        if "hms" in p:
            new_hms = p["hms"] or []
            # Logger seulement si les erreurs changent (pas à chaque tick MQTT)
            old_codes = {e.get("code") for e in (state.hms_errors or [])}
            new_codes = {e.get("code") for e in new_hms}
            if new_codes != old_codes:
                if new_hms:
                    codes = ", ".join(str(e.get("code","?")) for e in new_hms)
                    logger.warning(f"[HMS] {len(new_hms)} erreur(s) — codes: {codes}")
                elif state.hms_errors:
                    logger.info("[HMS] Erreurs résolues")
            state.hms_errors = new_hms
            changed = True
        if "print_error" in p and p["print_error"] != 0:
            state.print_error = int(p["print_error"])
            changed = True

        if changed:
            _notify()

    def publish(self, payload: dict) -> bool:
        if not self._client or not self._connected:
            return False
        try:
            self._client.publish(f"device/{self._printer_id}/request", json.dumps(payload))
            return True
        except: return False


mqtt_manager = MQTTManager()


def force_rematch_all_trays():
    """Relance le matching spool sur tous les trays connus en mémoire (après invalidation cache)."""
    import threading as _th
    try:
        s = get_state()
        if not s: return
        for ams in (s.ams_list or []):
            for t in (ams.trays or []):
                if getattr(t, "empty", True): continue
                _tinfo = getattr(t, "tray_info_idx", "") or ""
                _color = getattr(t, "color_hex", "") or ""
                _tag   = getattr(t, "tag_uid", "") or ""
                _tuuid = getattr(t, "tray_uuid", "") or ""
                def _rematch(_t=t, _ti=_tinfo, _c=_color, _tg=_tag, _tu=_tuuid):
                    try:
                        from ..services.print_tracker import _spool_from_slot_or_match as _sfm
                        import asyncio as _aio
                        loop = _aio.new_event_loop()
                        try:
                            sid, mode = loop.run_until_complete(
                                _sfm(int(getattr(_t, "id", 0) or 0), _ti, _c, tag_uid=_tg, tray_uuid=_tu)
                            )
                            _t.spool_id   = sid
                            _t.match_mode = mode or ""
                            _t._spool_info_cache = None
                        finally: loop.close()
                    except Exception: pass
                _th.Thread(target=_rematch, daemon=True).start()
    except Exception:
        pass
