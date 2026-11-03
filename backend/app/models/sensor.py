from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Index, Integer, Text

from ..db.session import Base


class SensorSample(Base):
    """
    Un releve des capteurs de l'imprimante (03/11/2026) : buses, plateau, chambre, et l'humidite et la temperature de
    chaque AMS. Toutes les 5 minutes, chaque minute pendant une impression ; garde 7 jours (services/sensors.py).
    Sert aux sparklines des tuiles et a la page Machine des Stats.
    """
    __tablename__ = "sensor_samples"

    id       = Column(Integer, primary_key=True, autoincrement=True)
    ts       = Column(DateTime, nullable=False, default=datetime.utcnow)
    printing = Column(Boolean, nullable=False, default=False)
    nozzle   = Column(Float, nullable=True)     # la buse active (ou la seule)
    nozzle2  = Column(Float, nullable=True)     # la seconde buse, sur une bi-buse
    bed      = Column(Float, nullable=True)
    chamber  = Column(Float, nullable=True)
    # les consignes, quand il y en a une (0 sur l'imprimante : rien)
    nozzle_t  = Column(Float, nullable=True)
    nozzle2_t = Column(Float, nullable=True)
    bed_t     = Column(Float, nullable=True)
    chamber_t = Column(Float, nullable=True)
    # les ventilateurs, en % (piece, auxiliaire, chambre, tete) ; None : la machine ne le dit pas
    fan_part    = Column(Float, nullable=True)
    fan_aux     = Column(Float, nullable=True)
    fan_chamber = Column(Float, nullable=True)
    fan_head    = Column(Float, nullable=True)
    fan_head2   = Column(Float, nullable=True)     # (H2) dissipateur de la 2e buse, carte de commande, circulation
    fan_board   = Column(Float, nullable=True)
    fan_loop    = Column(Float, nullable=True)
    ams      = Column(Text, nullable=True)      # JSON {ams_id: [humidite %, temperature °C]}

    __table_args__ = (Index("idx_sensor_samples_ts", "ts"),)


class MachineEvent(Base):
    """Un evenement de la machine (03/11/2026) : impression lancee ou finie, filament, aiguillage, buse du rack,
    porte, alerte, sechage… Garde 7 jours comme les releves (services/machine_events.py)."""
    __tablename__ = "machine_events"

    id     = Column(Integer, primary_key=True, autoincrement=True)
    ts     = Column(DateTime, nullable=False, default=datetime.utcnow)
    kind   = Column(Text, nullable=False)
    title  = Column(Text, nullable=False)
    detail = Column(Text, nullable=True)
    extra  = Column(Text, nullable=True)       # JSON : couleur du filament, emplacement d'avant…

    __table_args__ = (Index("idx_machine_events_ts", "ts"),)
