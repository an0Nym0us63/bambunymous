"""
MQTT Manager — connexion Bambu Lab via MQTT TLS.
Protocole analysé sur H2C (SN: 31B...) avec 3x AMS + Vortek HotendRack.
"""
import json
import logging
import ssl
import threading
from typing import Callable
import paho.mqtt.client as mqtt
from ..models.printer import PrinterState, AMS, AMSTray, HotendRack, HotendSlot

logger = logging.getLogger(__name__)

state = PrinterState()
_listeners: list[Callable] = []


def get_state() -> PrinterState:
    return state


def subscribe_state(fn: Callable):
    _listeners.append(fn)


def _notify():
    for fn in _listeners:
        try:
            fn(state)
        except Exception:
            logger.exception("Listener error")


class MQTTManager:
    def __init__(self):
        self._client: mqtt.Client | None = None
        self._connected = False
        self._thread: threading.Thread | None = None
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
            logger.info("MQTT: imprimante non configurée, connexion différée")
            return

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info(f"MQTT: démarrage vers {self._ip} (id={self._printer_id})")

    async def stop(self):
        self._stop_event.set()
        if self._client:
            self._client.disconnect()

    def reconnect(self, ip: str, printer_id: str, code: str):
        self._ip = ip
        self._printer_id = printer_id
        self._code = code
        if self._client:
            try:
                self._client.disconnect()
            except Exception:
                pass
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info(f"MQTT: reconnexion vers {ip}")

    def _run_loop(self):
        while not self._stop_event.is_set():
            try:
                self._connect_once()
            except Exception as e:
                logger.warning(f"MQTT connexion échouée: {e}, retry dans 15s")
            self._stop_event.wait(15)

    def _connect_once(self):
        client = mqtt.Client()
        client.username_pw_set("bblp", self._code)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        client.tls_set_context(ctx)
        client.tls_insecure_set(True)
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message = self._on_message
        client.connect(self._ip, 8883, keepalive=60)
        self._client = client
        client.loop_forever()

    def _on_connect(self, client, userdata, flags, rc):
        self._connected = True
        state.connected = True
        _notify()
        logger.info(f"MQTT connecté (rc={rc})")
        client.subscribe(f"device/{self._printer_id}/report")
        client.publish(
            f"device/{self._printer_id}/request",
            json.dumps({"pushing": {"sequence_id": "0", "command": "pushall"}}),
        )

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False
        state.connected = False
        _notify()
        logger.warning(f"MQTT déconnecté (rc={rc})")

    def _on_message(self, client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode())
            if "print" in data:
                self._process_print(data["print"])
            elif "info" in data:
                self._process_info(data["info"])
        except Exception:
            logger.exception("MQTT message error")

    def _process_info(self, info: dict):
        """Traite le bloc 'info' — version firmware et SN."""
        for module in info.get("module", []):
            if module.get("name") == "ota":
                sn = module.get("sn", "")
                sw = module.get("sw_ver", "")
                if sn:
                    state.serial = sn
                if sw:
                    state.fw_version = sw
                logger.info(f"[MQTT INFO] SN={sn} FW={sw}")

    def _process_print(self, p: dict):
        changed = False

        # ── Statut / progression ─────────────────────────────────────────
        if "gcode_state" in p:
            old = state.status
            state.status = p["gcode_state"]
            if old != state.status:
                logger.info(f"[MQTT] status: {old} → {state.status}")
            changed = True

        if "mc_percent" in p:
            state.progress = float(p["mc_percent"])
            changed = True

        # Progression aussi dans p["percent"] ou p["3D"]["layer_num"]
        block_3d = p.get("3D", {})
        if "layer_num" in block_3d:
            state.layer = int(block_3d["layer_num"])
            changed = True
        if "total_layer_num" in block_3d:
            state.total_layers = int(block_3d["total_layer_num"])
            changed = True
        if "layer_num" in p:
            state.layer = int(p["layer_num"])
            changed = True
        if "total_layer_num" in p:
            state.total_layers = int(p["total_layer_num"])
            changed = True

        if "mc_remaining_time" in p:
            state.remaining_minutes = int(p["mc_remaining_time"])
            changed = True
        if "remain_time" in p:
            state.remaining_minutes = int(p["remain_time"])
            changed = True

        if "subtask_name" in p:
            state.print_name = p["subtask_name"]
            changed = True
        if "job_id" in p:
            state.job_id = str(p["job_id"])
            changed = True
        if "design_id" in p:
            state.design_id = str(p["design_id"])
            changed = True
        if "model_id" in p:
            state.model_id = str(p["model_id"])
            changed = True
        if "profile_id" in p:
            state.profile_id = str(p["profile_id"])
            changed = True
        if "gcode_file" in p:
            state.gcode_file = p["gcode_file"]
            changed = True
        if "stg_cur" in p:
            state.print_stage = int(p["stg_cur"])
            changed = True

        # SN depuis upgrade_state
        upgrade = p.get("upgrade_state", {})
        if upgrade.get("sn") and not state.serial:
            state.serial = upgrade["sn"]
            logger.info(f"[MQTT] SN détecté: {state.serial}")

        # ── Températures ─────────────────────────────────────────────────
        # H2C: températures dans p["device"]["bed"], p["device"]["extruder"]
        device = p.get("device", {})
        if device:
            # Bed temp
            bed_info = device.get("bed", {}).get("info", {})
            if "temp" in bed_info:
                # valeur encodée (ex: 3604535 → diviser par 100?)
                raw = bed_info["temp"]
                if raw > 10000:
                    state.bed_temp = round(raw / 100, 1)
                else:
                    state.bed_temp = float(raw)
                changed = True

            # Températures extrudeurs (extruder.info[])
            extruder = device.get("extruder", {})
            for ext in extruder.get("info", []):
                if ext.get("id") == 0:
                    temp_raw = ext.get("temp", 0)
                    if temp_raw > 10000:
                        state.nozzle_temp = round(temp_raw / 100, 1)
                    elif temp_raw > 0:
                        state.nozzle_temp = float(temp_raw)
                    snow = ext.get("snow", 0)
                    if snow > 0 and snow != 65279:  # 65279 = 0xFF7F = vide
                        state.target_nozzle_temp = float(snow)
                    changed = True

            # Chambre (ctc)
            ctc = device.get("ctc", {})
            if "info" in ctc and "temp" in ctc["info"]:
                state.chamber_temp = float(ctc["info"]["temp"])
                changed = True

        # Températures legacy (P1/X1 style)
        if "bed_temper" in p:
            state.bed_temp = float(p["bed_temper"])
            changed = True
        if "bed_target_temper" in p:
            state.target_bed_temp = float(p["bed_target_temper"])
            changed = True
        if "nozzle_temper" in p:
            state.nozzle_temp = float(p["nozzle_temper"])
            changed = True
        if "nozzle_target_temper" in p:
            state.target_nozzle_temp = float(p["nozzle_target_temper"])
            changed = True
        if "chamber_temper" in p:
            state.chamber_temp = float(p["chamber_temper"])
            changed = True

        # ── Vitesse ──────────────────────────────────────────────────────
        if "spd_lvl" in p:
            state.speed_level = int(p["spd_lvl"])
            changed = True
        if "spd_mag" in p:
            state.speed_mag = int(p["spd_mag"])
            changed = True

        # ── AMS ──────────────────────────────────────────────────────────
        ams_data = p.get("ams", {})
        if "ams" in ams_data:
            state.ams_list = []
            for ams_raw in ams_data["ams"]:
                ams = AMS(id=int(ams_raw.get("id", 0)))
                ams.humidity = int(ams_raw.get("humidity_raw", 0))
                ams.temp = float(ams_raw.get("temp", 0))
                for tray_raw in ams_raw.get("tray", []):
                    tray = AMSTray(id=int(tray_raw.get("id", 0)))
                    tray.color = (tray_raw.get("tray_color", "") or "").rstrip("F") or tray_raw.get("tray_color", "")
                    tray.filament_type = (tray_raw.get("tray_sub_brands") or
                                          tray_raw.get("tray_type") or "")
                    remain_raw = tray_raw.get("remain", 0)
                    tray.remain = max(0, int(remain_raw)) if remain_raw >= 0 else 0
                    tray.uuid = tray_raw.get("tray_uuid", "")[:8]
                    tray.tag_uid = tray_raw.get("tag_uid", "")
                    tray.info_idx = tray_raw.get("tray_info_idx", "")
                    tray.tray_id_name = tray_raw.get("tray_id_name", "")
                    tray.empty = not bool(tray_raw.get("tray_sub_brands"))
                    tray.drying_temp = int(tray_raw.get("drying_temp", 0) or 0)
                    tray.drying_time = int(tray_raw.get("drying_time", 0) or 0)
                    tray.total_len = int(tray_raw.get("total_len", 0) or 0)
                    ams.trays.append(tray)
                state.ams_list.append(ams)
            changed = True

        # ── Mapping filament→slot (pendant un print) ──────────────────────
        if "mapping" in p:
            state.ams_mapping = p["mapping"]
            changed = True

        # ── vir_slot (slots externes) ─────────────────────────────────────
        # Sur H2C: ids 254 et 255 = slots externes vides (ignorés)

        # ── Hotend Rack Vortek (H2C) ──────────────────────────────────────
        # Les hotends sont dans p["device"]["nozzle"]
        if device:
            nozzle = device.get("nozzle", {})
            if "info" in nozzle:
                rack = HotendRack()
                rack.active_id = nozzle.get("src_id", -1)
                rack.target_id = nozzle.get("tar_id", -1)
                rack.state = nozzle.get("state", 0)

                holder = device.get("holder", {})
                rack.holder_pos = holder.get("pos", 0)
                rack.holder_stat = holder.get("stat", 0)
                rack.holder_job = holder.get("job", 0)

                for n in nozzle["info"]:
                    color = (n.get("color_m") or "").strip()
                    slot = HotendSlot(
                        id=int(n.get("id", 0)),
                        color=color,
                        filament_id=n.get("fila_id", ""),
                        diameter=float(n.get("diameter", 0.4)),
                        nozzle_type=n.get("type", ""),
                        serial=n.get("sn", ""),
                        wear=float(n.get("wear", 0)),
                        print_time=int(n.get("p_t", 0)),
                        empty=not bool(n.get("fila_id", "").strip()),
                    )
                    rack.hotends.append(slot)

                state.hotend_rack = rack
                logger.debug(f"[MQTT RACK] {len(rack.hotends)} hotends, "
                             f"active={rack.active_id} target={rack.target_id} "
                             f"holder_pos={rack.holder_pos}")
                changed = True

        # ── Erreurs HMS ───────────────────────────────────────────────────
        if "hms" in p:
            state.hms_errors = p["hms"]
            if state.hms_errors:
                logger.warning(f"[MQTT HMS] {len(state.hms_errors)} erreur(s): {state.hms_errors}")
            changed = True

        if "print_error" in p and p["print_error"] != 0:
            state.print_error = int(p["print_error"])
            logger.warning(f"[MQTT] print_error={state.print_error}")
            changed = True

        if changed:
            _notify()

    def publish(self, payload: dict) -> bool:
        if not self._client or not self._connected:
            return False
        try:
            self._client.publish(
                f"device/{self._printer_id}/request",
                json.dumps(payload),
            )
            return True
        except Exception:
            return False


mqtt_manager = MQTTManager()
