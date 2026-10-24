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
    raw_color: str = ""        # tray_color MQTT brut (color est retouche)
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
    # La buse que l'AMS alimente (info, bits 8-11) : 0 = droite, 1 = gauche, -1 inconnu.
    # Raccorde au Filament Track Switch (0xE), il peut alimenter les deux : switch_port
    # dit alors sur quelle entree de l'aiguillage il est branche ("A" ou "B").
    extruder_id: int = -1
    switch_port: str = ""
    # Le sechage tel que l'AMS le decrit (info, cf. DevFilaSystem) : phase (bits 4-7 :
    # 0 arret, 1 verification, 2 sechage, 3 refroidissement, 4 arret en cours, 5 erreur,
    # 6 chauffe hors controle), sous-phase (bits 22-23 : 1 chauffe, 2 deshumidification),
    # ventilateurs (bits 18-19, 20-21), et ce qui empeche de secher (dry_sf_reason).
    dry_status: int = -1
    dry_sub_status: int = 0
    dry_fan1: int = 0
    dry_fan2: int = 0
    dry_cannot: list = field(default_factory=list)


@dataclass
class NozzleTemp:
    """Températures d'un nozzle (dual nozzle H2C)."""
    id: int            # 0 = gauche/primaire, 1 = droite/secondaire
    temp: float = 0.0
    target: float = 0.0
    active: bool = False
    # l'emplacement charge dans cette buse (extruder.info[].snow) : unite et bac, -1 si rien
    slot_ams: int = -1
    slot_tray: int = -1
    # du filament est-il engage dans l'extrudeuse (extruder.info[].info, bit 1, comme Bambu Studio) ;
    # None : l'imprimante ne le dit pas. Fin d'impression, filament retire : False, meme si snow
    # garde le dernier emplacement
    has_filament: bool | None = None


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
    stat: int = -1             # bit 0 : 0 = infos fiables ; bits 1-2 : 0 normal, 1 anormal, 2 inconnu
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
    holder_cali: int = -1      # calibration du rack : 0 a faire, 1 faite, -1 inconnue (holder.info)
    reading: int = 0           # buses encore a lire (nozzle.state, bits 4-7)
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

    # Buses, remplies par le MQTT selon ce que la machine declare.
    #
    # Liste VIDE au depart, et non deux buses pre-creees : la valeur par defaut
    # faisait passer toute imprimante pour une bi-buse, l'interface affichant
    # "Buse Gauche" et "Buse Droite" meme sur une mono-buse. C'est la machine
    # qui dit combien elle en a, pas nous.
    nozzles: list[NozzleTemp] = field(default_factory=list)

    # Plateau et chambre
    bed_temp: float = 0.0
    target_bed_temp: float = 0.0
    chamber_temp: float = 0.0
    target_chamber_temp: float = 0.0

    # Porte (24/10/2026) : ouverte ou non (None tant que l'imprimante ne l'a pas dit), et
    # l'heure (time.time) des dernieres ouvertures
    door_open: Optional[bool] = None
    door_opens: list = field(default_factory=list)

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

    # Filament Track Switch (aiguillage) : installe ?, ce qui entre en A et B (AMS, bac),
    # la buse servie par chaque sortie, calibration, filament present. Vide sans switch.
    fila_switch: dict = field(default_factory=dict)

    # Erreurs
    hms_errors: list[dict] = field(default_factory=list)
    print_error: int = 0

    # Infos
    fw_version: str = ""
