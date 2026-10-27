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
_DRYING_AMS: set = set()      # ams_id actuellement en séchage (détection de transition)

def _persist_last_dried(spool_ids: list):
    """Pose last_dried_at = maintenant sur les bobines données (thread dédié)."""
    import asyncio
    from datetime import datetime as _dt
    async def _run():
        from ..db.session import AsyncSessionLocal as _ASL
        from ..models.filament import Spool as _Sp
        now = _dt.utcnow()
        async with _ASL() as _db:
            for sid in spool_ids:
                sp = await _db.get(_Sp, sid)
                if sp and not sp.archived:
                    sp.last_dried_at = now
            await _db.commit()
    try:
        lp = asyncio.new_event_loop()
        try: lp.run_until_complete(_run())
        finally: lp.close()
    except Exception as e:
        logger.error(f"[DRY] persist last_dried_at: {e}")



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


# Identite conventionnelle du pseudo-AMS qui porte les bobines externes.
# Aucun AMS reel ne porte ce numero.
EXT_AMS_ID = 255

# AMS HT : unite a un seul slot, numerotee par la machine a partir de 128
# (128 = HT-A, 129 = HT-B...). Son bac porte l'id 0, et tray_now l'annonce
# directement par son numero d'unite.
HT_BASE_ID = 128


def is_ht(ams_id) -> bool:
    return HT_BASE_ID <= int(ams_id) < HT_BASE_ID + 8


def ams_label(ams_id) -> str:
    """Nom d'une unite, le meme que celui affiche par le front (utils/ams)."""
    ams_id = int(ams_id)
    if ams_id == EXT_AMS_ID:
        return "Externe"
    if is_ht(ams_id):
        return f"HT-{chr(65 + ams_id - HT_BASE_ID)}"
    if 0 <= ams_id < 26:
        return f"AMS-{chr(65 + ams_id)}"
    return f"AMS {ams_id}"


def slot_location(ams_id, tray_slot) -> str:
    """
    Emplacement ecrit sur la bobine. Un HT n'a qu'un slot, "slot 1" n'y
    apprendrait rien ; il garde le prefixe "AMS" de la convention interne
    ("AMS ..." ou "Tiroir"), que "HT-A" seul aurait rompue.
    """
    ams_id = int(ams_id)
    if is_ht(ams_id):
        return f"AMS {ams_label(ams_id)}"
    return f"{ams_label(ams_id)} slot {int(tray_slot) + 1}"


def _external_unit(p):
    """
    Construit un pseudo-AMS a partir des emplacements externes.

    Deux formes de charge utile selon la machine, comme dans l'integration
    Home Assistant :
      - vir_slot : tableau, machines bi-buse (H2D / H2C), une entree par
        emplacement, id 255 = externe 1 et id 254 = externe 2 ;
      - vt_tray  : objet unique, machines mono-buse (P1P / X1), id 254.

    Ces entrees portent EXACTEMENT les memes champs qu'une tray d'AMS --
    tray_info_idx, tray_color, tray_type, tag_uid, tray_uuid, remain. On les
    presente donc comme un AMS ordinaire, avec des slots renumerotes 0 et 1 :
    le decodage, le matching, le cache spool_info, la localisation et tout
    l'affichage fonctionnent alors sans une ligne de plus. C'est le seul point
    de conception qui compte ici -- traiter l'externe a part aurait demande de
    dupliquer une centaine de lignes.
    """
    slots = []
    vir = p.get("vir_slot")
    if isinstance(vir, list) and vir:
        by_id = {}
        for sl in vir:
            try:
                by_id[int(sl.get("id", -1))] = sl
            except (TypeError, ValueError):
                continue
        # 254 puis 255, et non l'inverse : c'est l'ordre dans lequel la machine
        # presente physiquement les deux supports, de gauche a droite. Le
        # protocole les numerote a l'envers. On remet donc l'ordre a l'endroit
        # ICI, une seule fois, plutot que de le corriger a l'affichage : sinon
        # l'emplacement ecrit sur la bobine ("Externe slot 2") contredisait
        # l'etiquette affichee juste au-dessus ("E1").
        for ext_id in (254, 255):
            if ext_id in by_id:
                slots.append(by_id[ext_id])
    else:
        vt = p.get("vt_tray")
        if isinstance(vt, dict) and vt:
            slots.append(vt)
    if not slots:
        return None
    return {"id": EXT_AMS_ID, "humidity_raw": 0, "temp": 0,
            "tray": [dict(sl, id=i) for i, sl in enumerate(slots)]}


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
        self._gen = getattr(self, "_gen", 0) + 1
        self._thread = threading.Thread(target=self._run_loop, args=(self._gen,), daemon=True)
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
        # un nouveau fil ; l'ancien, sorti de loop_forever par la deconnexion, voit qu'il n'est plus
        # le dernier et s'arrete (24/10/2026 : il se reconnectait 15 s plus tard, deux clients
        # traitaient chaque message et les AMS apparaissaient en double)
        self._gen = getattr(self, "_gen", 0) + 1
        self._thread = threading.Thread(target=self._run_loop, args=(self._gen,), daemon=True)
        self._thread.start()

    def _run_loop(self, gen=None):
        while not self._stop_event.is_set() and (gen is None or gen == getattr(self, "_gen", gen)):
            try: self._connect_once(gen)
            except Exception as e:
                logger.warning(f"MQTT erreur: {e}, retry 15s")
            self._stop_event.wait(15)

    def _connect_once(self, gen=None):
        if gen is not None and gen != getattr(self, "_gen", gen):
            return
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
        # les modules et leurs versions (Plus d infos), une fois par connexion
        c.publish(f"device/{self._printer_id}/request",
                  json.dumps({"info": {"sequence_id": "0", "command": "get_version"}}))

    def _on_disconnect(self, c, u, rc):
        self._connected = False
        state.connected = False
        _notify()
        logger.warning(f"MQTT déconnecté rc={rc}")

    def _on_message(self, c, u, msg):
        if c is not self._client:
            # un client remplace (reconnexion) : ses derniers messages ne comptent plus
            try: c.disconnect()
            except Exception: pass
            return
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
        if isinstance(info.get("module"), list) and info["module"]:
            state.modules = [m for m in info["module"] if isinstance(m, dict)]
        for m in info.get("module", []):
            if m.get("name") == "ota":
                if m.get("sn"): state.serial = m["sn"]
                if m.get("sw_ver"): state.fw_version = m["sw_ver"]

    def _process_print(self, p: dict):
        changed = False
        # tout le statut, garde (« Plus d'infos ») : les messages ne portent souvent que ce qui change
        if p.get("command") in (None, "push_status"):
            from ..services.printer_details import merge as _merge
            state.raw = _merge(state.raw, p)

        # ── Porte (24/10/2026) : « stat » (hexa, series H2/P2/X2) bit 0x00800000, le capot du haut le bit
        # 0x01000000 (essai reel sur H2C le 25/10/2026), sinon le bit 23 de
        # home_flag sur les X1 seulement (numero de serie 00M / 03W), comme l'integration Home Assistant
        # ha-bambulab. Chaque ouverture est datee (les dix dernieres) et notee au journal.
        _door = _top = None
        # le champ brut : chaque changement au journal, pour trouver les autres capteurs (capot du haut)
        if p.get("stat") not in (None, "") and p.get("stat") != getattr(state, "_stat_raw", None):
            logger.info(f"[DOOR] stat brut {getattr(state, '_stat_raw', None)} -> {p.get('stat')}")
            state._stat_raw = p.get("stat")
        if p.get("stat") not in (None, ""):
            try:
                _st = int(str(p["stat"]), 16)
                _door, _top = bool(_st & 0x00800000), bool(_st & 0x01000000)
            except ValueError: pass
        elif p.get("home_flag") is not None and str(state.serial or "")[:3] in ("00M", "03W"):
            try: _door = bool((int(p["home_flag"]) >> 23) & 1)
            except (TypeError, ValueError): pass
        if _door is not None and _door != state.door_open:
            if state.door_open is not None:
                logger.info(f"[DOOR] porte {'ouverte' if _door else 'fermee'}")
                if _door:
                    import time as _dt
                    state.door_opens = (list(state.door_opens) + [_dt.time()])[-10:]
                    # et ce qu'il faisait dedans a ce moment (succes : plateau chaud, chambre brulante)
                    state.door_events = (list(state.door_events) + [{"t": _dt.time(), "bed": state.bed_temp,
                                                                      "ch": state.chamber_temp}])[-10:]
            state.door_open = _door
            changed = True
        if _top is not None and _top != state.top_open:
            if state.top_open is not None:
                logger.info(f"[DOOR] capot {'ouvert' if _top else 'ferme'}")
            state.top_open = _top
            changed = True

        # ── Lumiere de la chambre : « lights_report », allumee si un de ses eclairages l'est
        _lr = p.get("lights_report")
        if isinstance(_lr, list):
            _ch = [x for x in _lr if isinstance(x, dict) and str(x.get("node", "")).startswith("chamber_light")]
            if _ch:
                _on = any(str(x.get("mode", "")).lower() == "on" for x in _ch)
                if _on != state.light_on:
                    state.light_on = _on
                    changed = True

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
        if "job_id" in p:
            # Nouveau job : la progression et la couche fusionnees sont celles de
            # l'impression precedente (100 %, derniere couche) tant que l'imprimante
            # ne les a pas republiees. Les garder declenchait d'un coup tous les
            # cliches de jalons (50 %, 100 %, 1re couche) au lancement.
            if str(p["job_id"]) != (state.job_id or ""):
                if "mc_percent" not in p:
                    state.progress = 0.0
                if "layer_num" not in p and "layer_num" not in block_3d:
                    state.layer = 0
            state.job_id = str(p["job_id"]); changed = True
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
            create_print as _cp, on_progress as _op, on_finish as _of, on_state as _os
        )
        from app.db.session import AsyncSessionLocal as _PAS
        from app.services.settings_service import get_setting as _PGS

        _jid  = str(p.get("job_id", "")) if p.get("job_id") else ""
        # Les rapports MQTT sont des DELTAS : un payload peut tres bien ne pas
        # contenir gcode_state / mc_percent / layer_num. On lit donc l'etat
        # FUSIONNE (deja mis a jour plus haut), jamais le delta brut.
        # Avant, `float(p.get("mc_percent", 0) or 0)` donnait 0 sur un delta sans
        # progression, ce qui declenchait le detecteur de regression d'on_progress
        # et remettait a zero les flags de milestones en plein print.
        _gst  = p.get("gcode_state", "") or (state.status or "")
        _pct  = float(state.progress or 0)
        _lay  = int(state.layer or 0)
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
        # FINISH inclus : l'imprimante bascule gcode_state en FINISH dans le
        # meme rapport que mc_percent=100. En n'ecoutant que RUNNING, le
        # franchissement du palier 100% n'etait jamais evalue et le snapshot
        # pct100 ne partait jamais.
        if _jid and _gst in ("RUNNING", "FINISH"):
            _op(_jid, _pct, _lay)
        # Pauses (retirees de la duree reelle)
        if _jid and _gst:
            _os(_jid, _gst)
        # Fin
        if _jid and _gst in ("FINISH", "FAILED"):
            _of(_jid, _gst)

        # SN depuis upgrade_state
        sn = p.get("upgrade_state", {}).get("sn", "")
        if sn and not state.serial:
            state.serial = sn

        # ── Filament Track Switch (aiguillage) ──────────────────────────
        # Format releve dans Bambu Studio (DevFilaSwitch.cpp) :
        #  - aux (chaine hexa), bit 29 : switch installe ;
        #  - device.fila_switch.in = [entree B, entree A] : (ams << 8) | bac, -1 = rien ;
        #  - device.fila_switch.out = [sortie B, sortie A] : id de la buse servie, 0xE = rien ;
        #  - device.fila_switch.stat : calibration (0 au repos, 1 en cours) ; info bit 0 : filament.
        if "aux" in p:
            try:
                installed = bool((int(str(p["aux"]), 16) >> 29) & 1)
            except (TypeError, ValueError):
                installed = None
            if installed is not None and installed != bool(state.fila_switch.get("installed")):
                state.fila_switch = {"installed": True} if installed else {}
                changed = True
        fs = (p.get("device") or {}).get("fila_switch")
        if isinstance(fs, dict):
            cur = dict(state.fila_switch or {})
            cur["installed"] = True
            def _slot(v):
                try:
                    v = int(v)
                except (TypeError, ValueError):
                    return None
                return None if v < 0 else {"ams": (v >> 8) & 0xFF, "tray": v & 0xFF}
            def _out(v):
                try:
                    v = int(v)
                except (TypeError, ValueError):
                    return None
                return None if v == 0xE or v < 0 else v
            ins = fs.get("in")
            if isinstance(ins, list) and len(ins) == 2:
                cur["in_b"], cur["in_a"] = _slot(ins[0]), _slot(ins[1])
            outs = fs.get("out")
            if isinstance(outs, list) and len(outs) == 2:
                cur["out_b"], cur["out_a"] = _out(outs[0]), _out(outs[1])
            if "stat" in fs:
                cur["calibrating"] = int(fs.get("stat") or 0) == 1
            if "info" in fs:
                try:
                    cur["filament"] = bool(int(fs["info"]) & 1)
                except (TypeError, ValueError):
                    pass
            if cur != state.fila_switch:
                state.fila_switch = cur
                changed = True

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

            # Chambre (ctc): meme encodage int32 que le lit (low = actuel,
            # high = consigne). Elle etait lue brute, ce qui affichait la valeur
            # encodee telle quelle des qu'une consigne existait (ex: 4259899
            # pour 59°C / consigne 65°C, cas d'une impression ASA).
            ctc_temp = device.get("ctc", {}).get("info", {}).get("temp")
            if ctc_temp is not None:
                state.chamber_temp, state.target_chamber_temp = _decode_temp(int(ctc_temp))
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
                # ce qui est charge dans cette buse : snow = (unite << 8) | bac ; 0xFFFF ou absent = rien
                if "snow" in ext:
                    try:
                        _sn = int(ext.get("snow"))
                        _a, _t = _sn >> 8, _sn & 0xFF
                        n.slot_ams, n.slot_tray = (-1, -1) if _a in (0xFF,) or _sn < 0 else (_a, _t if _a < 128 else 0)
                    except (TypeError, ValueError):
                        pass
                # info : bit 1 = filament dans l'extrudeuse, bit 2 = dans le tampon (DevExtruder de Bambu Studio)
                if "info" in ext:
                    try:
                        n.has_filament = bool((int(ext.get("info")) >> 1) & 1)
                    except (TypeError, ValueError):
                        pass
                changed = True

        # Repli mono-buse (P1 / X1 / A1) : ces machines ne remontent pas
        # device.extruder.info, seulement nozzle_temper a la racine. Sans ce
        # repli, et depuis que la liste des buses demarre vide, elles
        # n'afficheraient plus aucune buse.
        #
        # Uniquement si extruder.info n'a rien fourni : la H2C envoie AUSSI
        # nozzle_temper, avec la temperature de la buse active, ce qui
        # ecraserait la vraie valeur de la buse 0.
        if not state.nozzles and "nozzle_temper" in p:
            n0 = NozzleTemp(id=0, active=True)
            try:
                n0.temp = float(p.get("nozzle_temper") or 0)
                n0.target = float(p.get("nozzle_target_temper") or 0)
            except (TypeError, ValueError):
                pass
            state.nozzles.append(n0)
            changed = True

        # NE PAS écraser nozzle_temper sur nozzles[0] car H2C envoie aussi ce champ
        # avec la temp de la buse active, ce qui écrase la vraie valeur de id=0
        if "bed_temper" in p: state.bed_temp = float(p["bed_temper"]); changed = True
        if "bed_target_temper" in p: state.target_bed_temp = float(p["bed_target_temper"]); changed = True
        if "chamber_temper" in p: state.chamber_temp = float(p["chamber_temper"]); changed = True
        if "ctt" in p: state.target_chamber_temp = float(p["ctt"]); changed = True

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
            elif new_ams is None and is_ht(tray_now):
                # Un HT est annonce par son numero d'unite (128...), pas par un
                # index ams*4+tray : 128 // 4 aurait designe un AMS 32.
                new_ams, new_tray = tray_now, 0
                source = "tray_now_ht"

            # ── Bobine externe active ────────────────────────────────────
            # L'externe est annoncee par un INDEX D'AMS de 254 ou 255, pas par
            # un numero de bac. Sans cette conversion, imprimer depuis le
            # support externe laissait la surbrillance sur le dernier slot AMS
            # utilise : non seulement l'externe n'apparaissait pas active, mais
            # une bobine qui ne tournait pas etait signalee comme telle.
            # Le numero de bac issu de snow (snow & 0x3) n'a aucun sens ici, on
            # l'ignore au profit de l'ordre physique des supports.
            if new_ams in (254, 255):
                new_ams, new_tray = EXT_AMS_ID, (0 if new_ams == 254 else 1)
                source = f"{source or '?'}+externe"
            elif new_ams is None and tray_now == 254:
                # Machines mono-buse : un seul support externe, annonce par
                # tray_now. Jusqu'ici ce cas conservait la derniere valeur
                # connue, d'ou une surbrillance figee sur un AMS.
                new_ams, new_tray = EXT_AMS_ID, 0
                source = "tray_now_externe"

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
            # la liste se construit a part et remplace l'ancienne d'un coup : une lecture en cours
            # de route ne voit jamais une liste a moitie remplie, et un AMS n'y figure qu'une fois
            _new_ams = []
            _units = list(ams_data["ams"])
            _ext = _external_unit(p)
            if _ext:
                _units.append(_ext)
            for ams_raw in _units:
                ams = AMS(id=int(ams_raw.get("id", 0)),
                          humidity=int(ams_raw.get("humidity_raw", 0)),
                          temp=float(ams_raw.get("temp", 0)),
                          dry_time=int(ams_raw.get("dry_time", 0)))
                # info (hexa) : bits 8-11 = buse alimentee (0xE : par l'aiguillage),
                # bits 24-27 = entree de l'aiguillage (0 = B, 1 = A) -- cf. DevFilaSystem.cpp
                if ams_raw.get("info") not in (None, ""):
                    try:
                        _inf = int(str(ams_raw.get("info")), 16)
                        ams.dry_status = (_inf >> 4) & 0xF
                        ams.dry_fan1 = (_inf >> 18) & 0x3
                        ams.dry_fan2 = (_inf >> 20) & 0x3
                        ams.dry_sub_status = (_inf >> 22) & 0x3
                        _ext = (_inf >> 8) & 0xF
                        if _ext == 0xE:
                            _port = (_inf >> 24) & 0xF
                            ams.switch_port = {0: "B", 1: "A"}.get(_port, "")
                            ams.extruder_id = -1
                        else:
                            ams.extruder_id = _ext
                    except (TypeError, ValueError):
                        pass
                _sf = ams_raw.get("dry_sf_reason")
                if isinstance(_sf, list):
                    ams.dry_cannot = [int(x) for x in _sf if str(x).lstrip("-").isdigit()]
                dry_setting = ams_raw.get("dry_setting", {}) or {}
                if dry_setting:
                    ams.dry_temperature = max(int(dry_setting.get("dry_temperature", 0)), 0)
                    ams.dry_duration    = max(int(dry_setting.get("dry_duration", 0)), 0)
                    ams.dry_filament    = dry_setting.get("dry_filament", "")
                for tr in ams_raw.get("tray", []):
                    t = AMSTray(id=int(tr.get("id", 0)))
                    # RRGGBBAA : on garde RRGGBB. Surtout pas rstrip("FF"), qui mange aussi les F de la
                    # couleur (C12E1FFF devenait C12E1, illisible : un rouge affiche en gris).
                    _c = (tr.get("tray_color") or "").strip()
                    t.color = _c[:6] if len(_c) == 8 else _c
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
                    # Couleur brute du MQTT : t.color est retouche (rstrip "FF"), la
                    # signature d'une association manuelle se calcule sur la brute.
                    t.raw_color = _tray_color
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
                                    from ..services.slot_override import get_override, signature, has_rfid
                                    spool_id, mode = None, None
                                    # Sans RFID, une association faite a la main pour cet
                                    # emplacement (meme filament present) prime sur la
                                    # detection par profil + couleur.
                                    if not has_rfid(_tag):
                                        _ov = await get_override(_ams_id, _tray_slot, signature(_tinfo, _tc))
                                        if _ov:
                                            spool_id, mode = _ov, "linked"
                                    if spool_id is None:
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
                                        loc = slot_location(_ams_id, _tray_slot)
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
                                                    "filament_id": (_fi2.id if _fi2 else (_sp2.filament_id if _sp2 else None)),
                                                    "name": _fi2.name if _fi2 else None,
                                                    "translated_name": getattr(_fi2, "translated_name", None) if _fi2 else None,
                                                    "color": f"#{_fi2.color}" if _fi2 and _fi2.color else None,
                                                    "material": _fi2.material if _fi2 else None,
                                                    "fila_type": (_fi2.fila_type if _fi2 else None),
                                                    "brand": _fi2.manufacturer if _fi2 else None,
                                                    "remaining_weight_g": _sp2.remaining_weight_g,
                                                    "initial_weight_g": _fi2.filament_weight_g if _fi2 else None,
                                                    "multicolor_type": _fi2.multicolor_type if _fi2 else None,
                                                    "colors_array": _fi2.colors_array if _fi2 else None,
                                                    "fila_finish": _fi2.fila_finish if _fi2 else None,
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
                                        # reconnue toute seule (RFID, ou profil et couleur) : notee une fois sur la
                                        # bobine (le succes « Reconnu d'office » les compte ; rien ne l'ecrivait)
                                        if mode in ("rfid", "auto"):
                                            try:
                                                from ..db.session import AsyncSessionLocal as _ASL3
                                                from ..models.filament import Spool as _Sp3
                                                async with _ASL3() as _db3:
                                                    _sp3 = await _db3.get(_Sp3, spool_id)
                                                    if _sp3 is not None and not (_sp3.found_mode or "").strip():
                                                        _sp3.found_mode = mode
                                                        await _db3.commit()
                                            except Exception as _fe:
                                                logger.debug(f"[AMS] found_mode: {_fe}")
                                    else:
                                        logger.debug(f"[AMS] {_ams_id}/{_tray_slot} no match ({mode})")
                                try:    lp.run_until_complete(_go())
                                finally: lp.close()
                            _mth.Thread(target=_match_spool, daemon=True).start()

                    ams.trays.append(t)
                _new_ams = [a for a in _new_ams if a.id != ams.id] + [ams]

                # ── Séchage : à la TRANSITION "pas séchage -> séchage" de cet AMS,
                # on date les bobines qui y sont (last_dried_at). On ne persiste
                # qu'une fois par cycle grâce au cache _DRYING_AMS.
                _is_drying = (getattr(ams, "dry_time", 0) or 0) > 0
                _was_drying = ams.id in _DRYING_AMS
                if _is_drying and not _was_drying:
                    _DRYING_AMS.add(ams.id)
                    try:        # journal des succes : un cycle, sa duree reglee (h) ou restante (min)
                        from ..services import ach_log as _alog
                        _alog.dry(ams.id, (getattr(ams, "dry_duration", 0) or 0)
                                  or (getattr(ams, "dry_time", 0) or 0) / 60)
                    except Exception:
                        pass
                    _sids = [t.spool_id for t in ams.trays if getattr(t, "spool_id", None)]
                    # ... et celles simplement POSEES dans cet AMS (emplacement vide).
                    try:
                        from ..services import drying_slots as _dslots
                        _sids += [x for x in _dslots.spools_in_ams(ams.id) if x not in _sids]
                    except Exception:
                        pass
                    if _sids:
                        logger.info(f"[DRY] AMS {ams.id} en séchage → date sur bobines {_sids}")
                        import threading as _dth
                        _dth.Thread(target=_persist_last_dried, args=(list(_sids),),
                                    daemon=True).start()
                elif not _is_drying and _was_drying:
                    _DRYING_AMS.discard(ams.id)

            state.ams_list = _new_ams

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
                            # _k = (ams_id, tray_id, uuid) : l'AMS 255 est le
                            # support externe. Ce mecanisme couvre donc AUSSI
                            # les bobines externes, puisqu'elles vivent dans
                            # state.ams_list comme les autres. Log explicite pour
                            # pouvoir le verifier au retrait d'une bobine externe.
                            _where = ams_label(_k[0])
                            logger.info(f"[LOC] bobine #{_old} retiree de {_where} → Tiroir")
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
                try:
                    rack.holder_cali = int(holder.get("info", -1))
                except (TypeError, ValueError):
                    rack.holder_cali = -1
                try:
                    rack.reading = (int(nozzle.get("state", 0)) >> 4) & 0xF
                except (TypeError, ValueError):
                    rack.reading = 0
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
                        stat=int(n["stat"]) if str(n.get("stat", "")).lstrip("-").isdigit() else -1,
                    ))
                src_in_rack = bool(exist_bits & (1 << src_id)) if 0 <= src_id < 64 else False
                rack.head_id = src_id if not src_in_rack else -1
                # Compléter les 6 slots manquants
                existing_ids = {h.id for h in rack.hotends}
                for _mid in range(6):
                    if _mid not in existing_ids:
                        rack.hotends.append(HotendSlot(id=_mid, empty=True))
                rack.hotends.sort(key=lambda h: h.id)
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


def clear_match_cache() -> None:
    """
    A appeler apres TOUTE mutation de bobine, d'ou qu'elle vienne.

    Vide le cache puis relance un matching immediat : sans le second, l'accueil
    attend le prochain tick MQTT pour se corriger.

    Ce helper vit ici, aupres des caches, et non dans un routeur : il etait
    jusqu'ici defini dans filaments.py, si bien que prints.py -- qui modifie
    pourtant le poids des bobines lors d'une restitution -- ne l'appelait pas.
    Une regle qui ne vit qu'a un seul endroit ne peut pas etre oubliee par le
    fichier d'a cote.
    """
    try:
        invalidate_tray_cache()
        force_rematch_all_trays()
    except Exception:
        # Un cache non vide ne doit jamais faire echouer la mutation elle-meme.
        logger.exception("[CACHE] invalidation impossible")


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
