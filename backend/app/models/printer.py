"""
Dataclasses état imprimante en mémoire.
Analysé sur H2C (SN: 31B...) avec 3x AMS + Vortek HotendRack + dual nozzle.
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AMSTray:
    id: int
    color: str = ""
    cols: list = field(default_factory=list)  # liste hex pour filaments multicolores (Bambu 'cols')
    ctype: str = ""                            # type couleur Bambu ('gradient','coaxial',etc.)
    filament_type: str = ""
    tray_id_name: str = ""
    remain: int = 0
    uuid: str = ""
    tag_uid: str = ""
    tray_info_idx: str = ""
    empty: bool = False
    drying_temp: int = 0
    drying_time: int = 0
    total_len: int = 0
    spool_id: Optional[int] = None
    _spool_info_cache: Optional[dict] = None
    match_mode: str = ""


@dataclass
class AMS:
    id: int
    trays: list[AMSTray] = field(default_factory=list)
    humidity: int = 0
    temp: float = 0.0
    # Séchage AMS
    dry_time: int = 0          # temps restant de séchage en secondes (0 = pas en séchage)
    dry_temperature: int = 0   # température cible (°C)
    dry_duration: int = 0      # durée totale configurée (minutes)
    dry_filament: str = ""     # type de filament en cours de séchage


@dataclass
class NozzleTemp:
    """Températures d'un nozzle (dual nozzle H2C)."""
    id: int            # 0 = gauche/primaire, 1 = droite/secondaire
    temp: float = 0.0
    target: float = 0.0
    active: bool = False


@dataclass
class HotendSlot:
    """Un hotend Vortek dans le rack H2C."""
    id: int
    color: str = ""
    filament_id: str = ""
    diameter: float = 0.4
    nozzle_type: str = ""
    serial: str = ""
    wear: float = 0.0
    print_time: int = 0
    empty: bool = False
    spool_id: Optional[int] = None
    _spool_info_cache: Optional[dict] = None  # cache dict de spool_info pour éviter re-query


@dataclass
class HotendRack:
    hotends: list[HotendSlot] = field(default_factory=list)
    active_id: int = -1        # src_id hardware
    target_id: int = -1
    state: int = 0
    holder_pos: int = 0        # 1=A, 2=B, 3=Centre
    holder_stat: int = 0
    holder_job: int = 0
    head_id: int = -1          # id de l'hotend sur la tête (-1 si dans le rack)
    head_in_rack_idx: int = -1 # index dans hotends[] si src_id est dans le rack


@dataclass
class PrinterState:
    connected: bool = False
    serial: str = ""

    # Statut
    status: str = "IDLE"
    progress: float = 0.0
    layer: int = 0
    total_layers: int = 0
    remaining_minutes: int = 0
    print_name: str = ""
    job_id: str = ""
    design_id: str = ""
    model_id: str = ""
    profile_id: str = ""
    gcode_file: str = ""
    print_stage: int = 0

    # Températures dual nozzle
    nozzles: list[NozzleTemp] = field(default_factory=lambda: [
        NozzleTemp(id=0, active=True),
        NozzleTemp(id=1, active=False),
    ])

    # Plateau et chambre
    bed_temp: float = 0.0
    target_bed_temp: float = 0.0
    chamber_temp: float = 0.0

    # Vitesse
    speed_level: int = 1
    speed_mag: int = 100

    # AMS
    ams_list: list[AMS] = field(default_factory=list)
    ams_mapping: list[int] = field(default_factory=list)
    active_tray_local: int = -1   # tray_now = index local dans son AMS (0-3)
    active_ams_id: int = -1       # depuis mapping high byte
    active_tray_id: int = -1      # depuis mapping low byte

    # Vortek rack
    hotend_rack: HotendRack = field(default_factory=HotendRack)

    # Erreurs
    hms_errors: list[dict] = field(default_factory=list)
    print_error: int = 0

    # Infos
    fw_version: str = ""
