from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, String, Text

from ..db.session import Base


class RfidScan(Base):
    """
    Un scan de tag NFC recu de l'application Android.

    On persiste la charge utile brute : le front la relit ensuite via un simple
    identifiant d'URL (/filaments?rfid=12), ce qui evite de faire transiter tout
    le JSON du tag dans la barre d'adresse.

    Les scans sont conserves : ils servent aussi de trace (quand ai-je scanne
    cette bobine, avec quelle date de production).
    """
    __tablename__ = "rfid_scans"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    tray_uid   = Column(String(64), nullable=False)
    payload    = Column(Text, nullable=False)          # JSON brut du tag
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_rfid_scans_tray_uid", "tray_uid"),
    )
