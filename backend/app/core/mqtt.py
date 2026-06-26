"""
MQTT Manager — connexion Bambu Lab via MQTT TLS.
Log détaillé de tous les messages reçus pour analyse.
"""
import asyncio
import json
import logging
import ssl
import threading
from typing import Callable
import paho.mqtt.client as mqtt
from ..models.printer import PrinterState, AMS, AMSTray

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


def _log_unknown_keys(section: str, data: dict, known: set):
    """Log les clés non encore traitées pour découverte du protocole."""
    unknown = {k: v for k, v in data.items() if k not in known}
    if unknown:
        logger.info(f"[MQTT DISCOVERY] {section} — clés non traitées : {json.dumps(unknown, default=str)}")


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
        logger.info(f"MQTT: démarrage vers {self._ip} (printer_id={self._printer_id})")

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

        client.on_connect    = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message    = self._on_message

        client.connect(self._ip, 8883, keepalive=60)
        self._client = client
        client.loop_forever()

    def _on_connect(self, client, userdata, flags, rc):
        self._connected = True
        state.connected = True
        _notify()
        logger.info(f"MQTT connecté (rc={rc})")
        topic = f"device/{self._printer_id}/report"
        client.subscribe(topic)
        logger.info(f"MQTT subscribed: {topic}")
        # Demander l'état complet
        client.publish(
            f"device/{self._printer_id}/request",
            json.dumps({"pushing": {"sequence_id": "0", "command": "pushall"}}),
        )
        logger.info("MQTT: pushall envoyé")

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False
        state.connected = False
        _notify()
        logger.warning(f"MQTT déconnecté (rc={rc})")

    def _on_message(self, client, userdata, msg):
        try:
            raw = msg.payload.decode()
            data = json.loads(raw)

            # Log complet du message (niveau DEBUG)
            logger.debug(f"[MQTT RAW] topic={msg.topic} payload={raw[:500]}")

            # Log de la structure de haut niveau (niveau INFO)
            top_keys = list(data.keys())
            logger.info(f"[MQTT MSG] top-level keys: {top_keys}")

            self._process(data)

        except Exception:
            logger.exception(f"MQTT message error — payload={msg.payload[:200]}")

    def _process(self, data: dict):
        p = data.get("print", {})
        if not p:
            # Log les messages qui ne sont pas des "print"
            logger.info(f"[MQTT NON-PRINT] keys: {list(data.keys())}")
            return

        p_keys = set(p.keys())
        logger.debug(f"[MQTT PRINT] keys ({len(p_keys)}): {sorted(p_keys)}")

        changed = False

        # ── Statut / progression ─────────────────────────────────────────
        KNOWN_STATUS = {"gcode_state", "mc_percent", "layer_num", "total_layer_num",
                        "mc_remaining_time", "subtask_name", "job_id", "print_type",
                        "sequence_id", "command"}

        if "gcode_state" in p:
            old = state.status
            state.status = p["gcode_state"]
            if old != state.status:
                logger.info(f"[MQTT] gcode_state: {old} → {state.status}")
            changed = True
        if "mc_percent" in p:
            state.progress = float(p["mc_percent"])
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
        if "subtask_name" in p:
            if state.print_name != p["subtask_name"]:
                logger.info(f"[MQTT] subtask_name: {p['subtask_name']}")
            state.print_name = p["subtask_name"]
            changed = True
        if "job_id" in p:
            state.job_id = str(p["job_id"])
            changed = True

        # ── Températures ─────────────────────────────────────────────────
        KNOWN_TEMPS = {"bed_temper", "bed_target_temper", "nozzle_temper",
                       "nozzle_target_temper", "chamber_temper"}

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

        # ── AMS ──────────────────────────────────────────────────────────
        KNOWN_AMS_TOP = {"ams", "ams_exist_bits", "tray_exist_bits", "tray_is_bbl_bits",
                         "tray_tar", "tray_now", "tray_pre", "tray_read_done_bits",
                         "tray_reading_bits", "tray_type_bits", "version"}
        KNOWN_VIR = {"vir_slot"}

        ams_data = p.get("ams", {})
        if "ams" in ams_data:
            logger.info(f"[MQTT AMS] ams_exist_bits={ams_data.get('ams_exist_bits')} "
                        f"tray_tar={ams_data.get('tray_tar')} tray_now={ams_data.get('tray_now')}")
            _log_unknown_keys("ams_top", ams_data, KNOWN_AMS_TOP)

            state.ams_list = []
            for ams_raw in ams_data["ams"]:
                ams = AMS(id=int(ams_raw.get("id", 0)))
                ams.humidity = int(ams_raw.get("humidity_raw", 0))
                ams.temp = float(ams_raw.get("temp", 0))
                logger.info(f"[MQTT AMS {ams.id}] humidity={ams.humidity} temp={ams.temp}")

                for tray_raw in ams_raw.get("tray", []):
                    tray = AMSTray(id=int(tray_raw.get("id", 0)))
                    tray.color = tray_raw.get("tray_color", "")
                    tray.filament_type = tray_raw.get("tray_sub_brands", "") or tray_raw.get("tray_type", "")
                    tray.remain = int(tray_raw.get("remain", 0))
                    tray.uuid = tray_raw.get("tray_uuid", "")
                    tray.info_idx = tray_raw.get("tray_info_idx", "")
                    tray.empty = not bool(tray_raw.get("tray_sub_brands"))
                    logger.info(f"[MQTT AMS {ams.id} TRAY {tray.id}] "
                                f"type={tray.filament_type} color=#{tray.color} "
                                f"remain={tray.remain}% uuid={tray.uuid[:8] if tray.uuid else '-'} "
                                f"empty={tray.empty}")
                    # Log les champs non traités du tray
                    KNOWN_TRAY = {"id", "tray_color", "tray_sub_brands", "tray_type",
                                  "remain", "tray_uuid", "tray_info_idx", "tray_weight",
                                  "tray_diameter", "tray_temp", "tray_time", "bed_temp_type",
                                  "nozzle_temp_max", "nozzle_temp_min", "xcam_info",
                                  "tray_color_format", "cols"}
                    _log_unknown_keys(f"tray_{ams.id}_{tray.id}", tray_raw, KNOWN_TRAY)
                    ams.trays.append(tray)
                state.ams_list.append(ams)
            changed = True

        # vir_slot (H2C / Vortek / external spool)
        if "vir_slot" in p:
            logger.info(f"[MQTT VIR_SLOT] {json.dumps(p['vir_slot'], default=str)}")

        # ── Découverte : log toutes les clés non traitées ─────────────────
        ALL_KNOWN = (KNOWN_STATUS | KNOWN_TEMPS | KNOWN_AMS_TOP | KNOWN_VIR |
                     {"ams", "print_error", "wifi_signal", "spd_lvl", "spd_mag",
                      "lights_report", "fan_gear", "cooling_fan_speed",
                      "big_fan1_speed", "big_fan2_speed", "heatbreak_fan_speed",
                      "ipcam", "xcam", "upload", "nozzle_diameter", "nozzle_type",
                      "home_flag", "hw_switch_state", "mc_print_stage",
                      "mc_print_error_code", "mc_print_line_number",
                      "sdcard", "force_upgrade", "mess_production_state",
                      "lifecycle", "camera_time_lapse", "s_obj"})
        _log_unknown_keys("print", p, ALL_KNOWN)

        if "wifi_signal" in p:
            logger.debug(f"[MQTT] wifi_signal={p['wifi_signal']}")
        if "print_error" in p and p["print_error"] != 0:
            logger.warning(f"[MQTT] print_error={p['print_error']}")
        if "spd_lvl" in p:
            logger.info(f"[MQTT] speed level={p['spd_lvl']} mag={p.get('spd_mag')}")

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
