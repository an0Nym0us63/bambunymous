"""Tout ce que l'imprimante envoie, lisible (25/10/2026).

Le statut MQTT (« push_status ») porte bien plus que ce que l'accueil montre : signal Wi-Fi,
ventilateurs, mise a jour disponible, camera et detection, carte SD, file d'attente, etats de
l'AMS, reglages de la machine... `mqtt` garde le dernier etat complet (`state.raw`, fusion des
messages, qui ne portent souvent que ce qui change) et les modules (`state.modules`, versions).
Ici on le range par themes pour la fenetre « Plus d'infos » de la popup imprimante ; le reste
part tel quel, masque (numeros de serie, adresses, liens signes), dans « Tous les champs ».
Les bits et codes suivent Bambu Studio (DeviceManager.cpp) et ha-bambulab.
"""
from __future__ import annotations

SECRET_KEYS = {"sn", "dev_id", "serial", "ip", "mask", "gw", "url", "token", "password", "passwd", "auth",
               "key", "mac", "ssid", "access_code", "dev_access_code", "ttcode", "authkey", "region", "bssid"}


def mask(v, k: str = ""):
    """Une copie sans rien de personnel (pour « Tous les champs »)."""
    if str(k).lower() in SECRET_KEYS:
        return "•••" if v not in (None, "", 0) else v
    if isinstance(v, dict):
        return {kk: mask(vv, kk) for kk, vv in v.items()}
    if isinstance(v, list):
        return [mask(x, k) for x in v]
    if isinstance(v, str) and v.startswith(("http://", "https://", "ftp")):
        return "•••"
    return v


def merge(old: dict, new: dict) -> dict:
    """Fusionne un message dans l'etat garde : les dictionnaires se completent, le reste remplace."""
    out = dict(old or {})
    for k, v in (new or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = merge(out[k], v)
        else:
            out[k] = v
    return out


def _int(v, base=10):
    try:
        if isinstance(v, str) and base == 16:
            return int(v, 16)
        return int(v)
    except (TypeError, ValueError):
        return None


def _onoff(v):
    if v in (None, ""):
        return None
    if isinstance(v, str):
        return {"enable": True, "enabled": True, "on": True, "true": True, "1": True,
                "disable": False, "disabled": False, "off": False, "false": False, "0": False}.get(v.lower(), v)
    return bool(v)


def _yes(v, on="activé", off="désactivé"):
    b = _onoff(v)
    return None if b is None else (on if b is True else off if b is False else str(b))


def _fan(v):
    n = _int(v)
    return None if n is None else f"{round(n / 15 * 100)} %"


def _ip(v):
    n = _int(v)
    if not n:
        return None
    return ".".join(str(b) for b in n.to_bytes(4, "little"))


SPEED = {1: "Silencieux", 2: "Standard", 3: "Sport", 4: "Ludique"}
AMS_MAIN = {0: "au repos", 1: "changement de filament", 2: "lecture RFID", 3: "assistance", 4: "calibration",
            0x10: "auto-contrôle", 0x20: "débogage", 0xFF: "inconnu"}
SD = {0: "absente", 1: "présente", 2: "anomalie", 3: "en lecture seule"}
UPG = {0: "aucune", 1: "disponible", 2: "à jour"}
# home_flag (X1, P1, A1) : les bits que Bambu Studio lit
HOME_BITS = [
    (4, "Reprise après perte de pas"), (5, "Enregistrement caméra"), (7, "Calibration AMS restante"),
    (10, "Bascule AMS automatique (fin de bobine)"), (17, "Son des alertes"), (20, "Détection de filament emmêlé"),
    (24, "Détection d'amas sur la buse"), (28, "Détection d'impression dans le vide"),
]


def _row(rows, label, value, hint=None):
    if value in (None, "", [], {}):
        return
    rows.append({"label": label, "value": str(value), **({"hint": hint} if hint else {})})


def build(state) -> dict:
    p = dict(getattr(state, "raw", {}) or {})
    groups = []

    # ── Réseau ──
    r = []
    sig = p.get("wifi_signal")
    if sig:
        n = _int(str(sig).lower().replace("dbm", "").strip())
        q = None if n is None else "excellent" if n >= -50 else "bon" if n >= -60 else "moyen" if n >= -70 else "faible"
        _row(r, "Signal Wi-Fi", f"{sig}" + (f" · {q}" if q else ""), "Plus proche de 0 = meilleur")
    _row(r, "Connexion à BambuNymous", "en ligne" if getattr(state, "connected", False) else "hors ligne")
    infos = (p.get("net") or {}).get("info") or []
    for i, it in enumerate(infos if isinstance(infos, list) else []):
        ip = _ip((it or {}).get("ip"))
        if ip and ip != "0.0.0.0":
            _row(r, "Adresse IP" + (f" ({i + 1})" if i else ""), ip)
    groups.append({"id": "net", "title": "Réseau", "icon": "wifi", "rows": r})

    # ── Mise à jour ──
    r = []
    up = p.get("upgrade_state") or {}
    _row(r, "Micrologiciel", getattr(state, "fw_version", "") or None)
    nvs = _int(up.get("new_version_state"))
    if nvs is not None:
        _row(r, "Nouvelle version", UPG.get(nvs, str(nvs)))
    for it in up.get("new_ver_list") or []:
        if isinstance(it, dict) and it.get("new_ver"):
            _row(r, f"Module {it.get('name') or '?'}", f"{it.get('cur_ver') or '?'} → {it.get('new_ver')}")
    if up.get("status") and str(up.get("status")).upper() not in ("IDLE", ""):
        _row(r, "Mise à jour en cours", f"{up.get('status')} · {up.get('progress') or 0} %")
    if up.get("force_upgrade"):
        _row(r, "Mise à jour obligatoire", "oui")
    if up.get("message"):
        _row(r, "Message", up.get("message"))
    groups.append({"id": "upgrade", "title": "Mise à jour", "icon": "download", "rows": r})

    # ── Impression en cours ──
    r = []
    _row(r, "Préparation du fichier", f"{p['gcode_file_prepare_percent']} %" if _int(p.get("gcode_file_prepare_percent")) else None,
         "Envoi du fichier à l'imprimante avant le départ")
    _row(r, "Étape (code)", p.get("stg_cur") if _int(p.get("stg_cur")) not in (None, 0, -1, 255) else None, "Le libellé est sur la popup")
    _row(r, "Ligne de G-code", p.get("mc_print_line_number") if _int(p.get("mc_print_line_number")) else None)
    _row(r, "Origine", {"local": "carte SD / réseau local", "cloud": "cloud Bambu", "idle": None}.get(p.get("print_type"), p.get("print_type")))
    lv = _int(p.get("spd_lvl"))
    _row(r, "Mode de vitesse", (SPEED.get(lv, str(lv)) + (f" · {p.get('spd_mag')} %" if p.get("spd_mag") else "")) if lv else None)
    sobj = p.get("s_obj")
    if isinstance(sobj, list) and sobj:
        _row(r, "Objets sautés", f"{len(sobj)} ({', '.join(str(x) for x in sobj[:12])}{'…' if len(sobj) > 12 else ''})")
    if _int(p.get("mc_print_error_code")):
        _row(r, "Code d'erreur", p.get("mc_print_error_code"))
    if p.get("fail_reason") not in (None, "", "0", 0):
        _row(r, "Raison de l'échec", p.get("fail_reason"))
    if _int(p.get("print_error")):
        _row(r, "Erreur d'impression", f"{_int(p.get('print_error')):08X}")
    _row(r, "Plateau (n°)", p.get("plate_idx") or None)
    if _int(p.get("queue_number")) or _int(p.get("queue_total")):
        _row(r, "File d'attente cloud", f"position {p.get('queue_number') or 0} / {p.get('queue_total') or 0}"
             + (f" · ~{round(_int(p.get('queue_est')) / 60)} min" if _int(p.get("queue_est")) else ""))
    groups.append({"id": "job", "title": "Impression", "icon": "layers", "rows": r})

    # ── Ventilation ──
    r = []
    _row(r, "Ventilateur de pièce", _fan(p.get("cooling_fan_speed")))
    _row(r, "Ventilateur auxiliaire", _fan(p.get("big_fan1_speed")))
    _row(r, "Ventilateur de chambre", _fan(p.get("big_fan2_speed")))
    _row(r, "Ventilateur de tête (dissipateur)", _fan(p.get("heatbreak_fan_speed")))
    air = (p.get("device") or {}).get("airduct") or {}
    if isinstance(air, dict) and air:
        _row(r, "Conduit d'air (mode)", air.get("modeCur"))
        for part in air.get("parts") or []:
            if isinstance(part, dict) and part.get("id") is not None:
                _row(r, f"Ventilateur {part.get('id')}", f"{part.get('state')} %" if part.get("state") is not None else None)
    groups.append({"id": "fans", "title": "Ventilation", "icon": "wind", "rows": r})

    # ── Buse ──
    r = []
    _row(r, "Diamètre de buse", f"{p['nozzle_diameter']} mm" if p.get("nozzle_diameter") else None)
    _row(r, "Type de buse", {"hardened_steel": "acier trempé", "stainless_steel": "inox", "brass": "laiton",
                              "tungsten_carbide": "carbure de tungstène"}.get(p.get("nozzle_type"), p.get("nozzle_type")))
    groups.append({"id": "nozzle", "title": "Buse", "icon": "flame", "rows": r})

    # ── Caméra et détection ──
    r = []
    cam = p.get("ipcam") or {}
    _row(r, "Timelapse", _yes(cam.get("timelapse")))
    _row(r, "Enregistrement", _yes(cam.get("ipcam_record")))
    _row(r, "Résolution", cam.get("resolution"))
    _row(r, "Accès distant (caméra)", _yes(cam.get("tutk_server")))
    x = p.get("xcam") or {}
    _row(r, "Détection des spaghettis", _yes(x.get("spaghetti_detector")))
    _row(r, "Surveillance de l'impression", _yes(x.get("printing_monitor")))
    _row(r, "Contrôle de la première couche", _yes(x.get("first_layer_inspector")))
    _row(r, "Repère du plateau", _yes(x.get("buildplate_marker_detector")))
    _row(r, "Arrêt sur défaut", _yes(x.get("print_halt")))
    _row(r, "Sensibilité", {"low": "faible", "medium": "moyenne", "high": "haute"}.get(x.get("halt_print_sensitivity"), x.get("halt_print_sensitivity")))
    _row(r, "Saut d'objets autorisé", _yes(x.get("allow_skip_parts"), "oui", "non"))
    groups.append({"id": "cam", "title": "Caméra et détection", "icon": "camera", "rows": r})

    # ── Machine ──
    r = []
    hf = _int(p.get("home_flag"))
    if "sdcard" in p:
        _row(r, "Carte SD", "présente" if p.get("sdcard") else "absente")
    elif hf is not None:
        _row(r, "Carte SD", SD.get((hf >> 8) & 0x3))
    if hf is not None:
        for bit, label in HOME_BITS:
            _row(r, label, "oui" if (hf >> bit) & 1 else "non")
    for lr in p.get("lights_report") or []:
        if isinstance(lr, dict) and lr.get("node"):
            _row(r, {"chamber_light": "Lumière de chambre", "chamber_light2": "Lumière de chambre 2",
                     "work_light": "Lumière de travail"}.get(lr["node"], lr["node"]),
                 {"on": "allumée", "off": "éteinte", "flashing": "clignote"}.get(lr.get("mode"), lr.get("mode")))
    if "hw_switch_state" in p:
        _row(r, "Capteur de filament (bobine externe)", "filament présent" if _int(p.get("hw_switch_state")) else "vide")
    onl = p.get("online") or {}
    if isinstance(onl, dict) and onl:
        _row(r, "Carte AHB", _yes(onl.get("ahb"), "en ligne", "hors ligne"))
        _row(r, "Lecteur RFID", _yes(onl.get("rfid"), "en ligne", "hors ligne"))
    for k in ("stat", "cfg", "fun", "aux"):
        if p.get(k) not in (None, ""):
            _row(r, f"Drapeaux « {k} »", str(p[k]).upper(), "Brut, hexadécimal")
    if hf is not None:
        _row(r, "Drapeaux « home_flag »", f"{hf & 0xFFFFFFFF:08X}", "Brut, hexadécimal")
    groups.append({"id": "machine", "title": "Machine", "icon": "cpu", "rows": r})

    # ── AMS ──
    r = []
    ams_st = _int(p.get("ams_status"))
    if ams_st is not None:
        _row(r, "État", AMS_MAIN.get((ams_st >> 8) & 0xFF, f"{(ams_st >> 8) & 0xFF}") + (f" (étape {ams_st & 0xFF})" if ams_st & 0xFF else ""))
    a = p.get("ams") or {}
    if isinstance(a, dict):
        _row(r, "Lire le RFID à l'insertion", _yes(a.get("insert_flag"), "oui", "non"))
        _row(r, "Lire le RFID au démarrage", _yes(a.get("power_on_flag"), "oui", "non"))
        if a.get("ams_exist_bits") not in (None, ""):
            _row(r, "AMS branchés", bin(_int(a.get("ams_exist_bits"), 16) or 0).count("1"))
        _row(r, "Bac en cours / précédent / visé", " / ".join(str(a.get(k, "–")) for k in ("tray_now", "tray_pre", "tray_tar"))
             if any(k in a for k in ("tray_now", "tray_pre", "tray_tar")) else None)
        _row(r, "Version du protocole AMS", a.get("version"))
    groups.append({"id": "ams", "title": "AMS", "icon": "disc", "rows": r})

    # ── Modules et versions ──
    r = []
    for m in getattr(state, "modules", None) or []:
        if isinstance(m, dict) and m.get("name"):
            v = " · ".join(x for x in (m.get("sw_ver"), (f"matériel {m['hw_ver']}" if m.get("hw_ver") else None)) if x)
            _row(r, m.get("product_name") or m["name"], v or "—")
    groups.append({"id": "modules", "title": "Modules et versions", "icon": "box", "rows": r})

    return {"groups": [g for g in groups if g["rows"]], "raw": mask(p), "keys": len(p)}
