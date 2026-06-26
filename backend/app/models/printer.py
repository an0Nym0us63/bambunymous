"""
Dataclasses représentant l'état de l'imprimante en mémoire.
Basé sur l'analyse du protocole MQTT Bambu Lab (H2C / Vortek).
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AMSTray:
    id: int
    color: str = ""              # ex: "E4BD68FF" (RGBA hex)
    filament_type: str = ""      # ex: "PLA Basic", "PETG HF"
    remain: int = 0              # 0-100%
    uuid: str = ""               # tray_uuid court (8 chars)
    tag_uid: str = ""            # NFC tag UID complet
    info_idx: str = ""           # ex: "A00-Y4", "G02-K0"
    tray_id_name: str = ""       # même chose (alias)
    empty: bool = False
    drying_temp: int = 0
    drying_time: int = 0
    total_len: int = 0           # longueur totale bobine (mm)
    spool_id: Optional[int] = None  # ID bobine Bambunymous assignée


@dataclass
class AMS:
    id: int
    trays: list[AMSTray] = field(default_factory=list)
    humidity: int = 0
    temp: float = 0.0


@dataclass
class HotendSlot:
    """Un hotend Vortek dans le rack H2C."""
    id: int                      # id physique (0, 1, 17, 18, 19, 20, 21...)
    color: str = ""              # "RRGGBBAA" hex
    filament_id: str = ""        # ex: "GFA00" (Bambu filament ID)
    diameter: float = 0.4        # diamètre buse (mm)
    nozzle_type: str = ""        # "HS01", "HS00"...
    serial: str = ""             # SN du hotend
    wear: float = 0.0            # usure (0-255+)
    print_time: int = 0          # temps cumulé (minutes ?)
    empty: bool = False
    spool_id: Optional[int] = None  # bobine Bambunymous assignée


@dataclass
class HotendRack:
    """Rack Vortek H2C — 6+ hotends interchangeables."""
    hotends: list[HotendSlot] = field(default_factory=list)
    active_id: int = -1          # nozzle.src_id = hotend actif
    target_id: int = -1          # nozzle.tar_id = hotend cible
    state: int = 0               # nozzle.state
    holder_pos: int = 0          # holder.pos (1=A, 2=B, 3=centre)
    holder_stat: int = 0         # holder.stat
    holder_job: int = 0          # holder.job


@dataclass
class PrinterState:
    connected: bool = False
    serial: str = ""             # SN imprimante (ex: 31B8BP612500427)

    # Statut impression
    status: str = "IDLE"         # gcode_state: IDLE, RUNNING, PAUSE, FINISH, FAILED
    progress: float = 0.0        # mc_percent
    layer: int = 0
    total_layers: int = 0
    remaining_minutes: int = 0
    print_name: str = ""         # subtask_name
    job_id: str = ""
    design_id: str = ""
    model_id: str = ""
    profile_id: str = ""
    gcode_file: str = ""
    print_stage: int = 0         # mc_stage / stg_cur

    # Températures
    nozzle_temp: float = 0.0
    target_nozzle_temp: float = 0.0
    bed_temp: float = 0.0
    target_bed_temp: float = 0.0
    chamber_temp: float = 0.0

    # Vitesse
    speed_level: int = 1         # 1-4
    speed_mag: int = 100         # pourcentage

    # AMS
    ams_list: list[AMS] = field(default_factory=list)
    ams_mapping: list[int] = field(default_factory=list)  # mapping filament→slot

    # Hotend Rack (H2C/Vortek)
    hotend_rack: HotendRack = field(default_factory=HotendRack)

    # Erreurs
    hms_errors: list[dict] = field(default_factory=list)
    print_error: int = 0

    # Firmware
    fw_version: str = ""
