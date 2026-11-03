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
    ams      = Column(Text, nullable=True)      # JSON {ams_id: [humidite %, temperature °C]}

    __table_args__ = (Index("idx_sensor_samples_ts", "ts"),)
