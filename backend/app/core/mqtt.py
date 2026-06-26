"""
MQTT Manager — Bambu Lab H2C.
Températures: encodage little-endian int32 (b[0]=actuel°C, b[2]=target°C).
snow/star: température cible nozzle × 10 (514 → 51.4°C), 65279=off.
"""
import json, logging, ssl, threading
from typing import Callable
import paho.mqtt.client as mqtt
from ..models.printer import PrinterState, AMS, AMSTray, HotendRack, HotendSlot, NozzleTemp

logger = logging.getLogger(__name__)
state = PrinterState()
_listeners: list[Callable] = []


def get_state() -> PrinterState:
    return state

def subscribe_state(fn: Callable):
    _listeners.append(fn)

def _notify():
    for fn in _listeners:
        try: fn(state)
        except Exception: logger.exception("Listener error")


def _decode_temp(raw: int) -> tuple[float, float]:
    """Décode un int32 H2C en (actuel°C, target°C). Encodage: little-endian bytes [curr, 0, target, 0]."""
    if raw < 0:
        return 0.0, 0.0
    b = raw.to_bytes(4, 'little')
    return float(b[0]), float(b[2])

def _decode_snow(snow: int) -> float:
    """snow/star = température × 10, 65279 (0xFEFF) = off/inactive."""
    if snow == 65279 or snow <= 0:
        return 0.0
    return round(snow / 10, 1)


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
        except Exception:
            logger.exception("MQTT message error")

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

        # SN depuis upgrade_state
        sn = p.get("upgrade_state", {}).get("sn", "")
        if sn and not state.serial:
            state.serial = sn

        # ── Températures (device block H2C) ──────────────────────────────
        device = p.get("device", {})
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

            # Dual nozzle extruder
            extruder = device.get("extruder", {})
            for ext in extruder.get("info", []):
                eid = int(ext.get("id", 0))
                if eid >= len(state.nozzles):
                    # Étendre si besoin
                    while len(state.nozzles) <= eid:
                        state.nozzles.append(NozzleTemp(id=len(state.nozzles)))
                n = state.nozzles[eid]
                # temp: int32 little-endian → b[0]=actuel, b[2]=target
                temp_raw = ext.get("temp", 0)
                if isinstance(temp_raw, int) and temp_raw > 255:
                    n.temp, n.target = _decode_temp(temp_raw)
                elif isinstance(temp_raw, (int, float)):
                    n.temp = float(temp_raw)
                # snow = target×10, 65279 = off
                snow = ext.get("snow", 65279)
                decoded_target = _decode_snow(snow)
                if decoded_target > 0:
                    n.target = decoded_target
                # active: stat != 0 ou snow != 65279
                n.active = (ext.get("stat", 0) != 0) or (snow != 65279)
                # L'extruder 0 est toujours l'actif primaire sur H2C
                if eid == 0:
                    n.active = True
                changed = True

        # Fallback legacy (autres modèles)
        if "bed_temper" in p: state.bed_temp = float(p["bed_temper"]); changed = True
        if "bed_target_temper" in p: state.target_bed_temp = float(p["bed_target_temper"]); changed = True
        if "nozzle_temper" in p: state.nozzles[0].temp = float(p["nozzle_temper"]); changed = True
        if "nozzle_target_temper" in p: state.nozzles[0].target = float(p["nozzle_target_temper"]); changed = True
        if "chamber_temper" in p: state.chamber_temp = float(p["chamber_temper"]); changed = True

        # ── AMS ─────────────────────────────────────────────────────────
        ams_data = p.get("ams", {})
        if "ams" in ams_data:
            state.active_tray = int(ams_data.get("tray_now", -1))
            state.ams_list = []
            for ams_raw in ams_data["ams"]:
                ams = AMS(id=int(ams_raw.get("id", 0)),
                          humidity=int(ams_raw.get("humidity_raw", 0)),
                          temp=float(ams_raw.get("temp", 0)))
                for tr in ams_raw.get("tray", []):
                    t = AMSTray(id=int(tr.get("id", 0)))
                    t.color = (tr.get("tray_color") or "").rstrip("FF") or tr.get("tray_color", "")
                    t.filament_type = tr.get("tray_sub_brands") or tr.get("tray_type") or ""
                    t.tray_id_name = tr.get("tray_id_name", "")
                    t.remain = max(0, int(tr.get("remain", 0)))
                    t.uuid = (tr.get("tray_uuid") or "")[:8]
                    t.tag_uid = tr.get("tag_uid", "")
                    t.empty = not bool(tr.get("tray_sub_brands"))
                    t.drying_temp = int(tr.get("drying_temp") or 0)
                    t.drying_time = int(tr.get("drying_time") or 0)
                    t.total_len = int(tr.get("total_len") or 0)
                    ams.trays.append(t)
                state.ams_list.append(ams)
            changed = True

        if "mapping" in p:
            state.ams_mapping = p["mapping"]; changed = True

        # ── Hotend Rack Vortek ───────────────────────────────────────────
        if device:
            nozzle = device.get("nozzle", {})
            if "info" in nozzle:
                rack = HotendRack(
                    active_id=nozzle.get("src_id", -1),
                    target_id=nozzle.get("tar_id", -1),
                    state=nozzle.get("state", 0),
                )
                holder = device.get("holder", {})
                rack.holder_pos = holder.get("pos", 0)
                rack.holder_stat = holder.get("stat", 0)
                rack.holder_job = holder.get("job", 0)
                for n in nozzle["info"]:
                    rack.hotends.append(HotendSlot(
                        id=int(n.get("id", 0)),
                        color=(n.get("color_m") or "").strip(),
                        filament_id=n.get("fila_id", ""),
                        diameter=float(n.get("diameter", 0.4)),
                        nozzle_type=n.get("type", ""),
                        serial=n.get("sn", ""),
                        wear=float(n.get("wear", 0)),
                        print_time=int(n.get("p_t", 0)),
                        empty=not bool((n.get("fila_id") or "").strip()),
                    ))
                state.hotend_rack = rack
                changed = True

        # ── HMS ──────────────────────────────────────────────────────────
        if "hms" in p:
            state.hms_errors = p["hms"]
            if state.hms_errors:
                logger.warning(f"[MQTT HMS] {len(state.hms_errors)} erreur(s)")
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
