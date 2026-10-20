"""Historique des notifications envoyees (15 jours), lu par chaque compte."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text
from ..db.session import Base


class NotifLog(Base):
    """
    Une ligne par notification partie (essais exclus). `users` liste les
    comptes qui la voient dans leur historique, entoures de virgules
    (",ludo,invite,") pour un filtre LIKE simple ; ",*," = tout le monde
    (installation sans table de comptes).
    """
    __tablename__ = "notif_log"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    event      = Column(String(40), nullable=False)
    section    = Column(String(20), nullable=True)
    title      = Column(String(250), nullable=False)
    message    = Column(Text, nullable=True)
    link       = Column(String(500), nullable=True)    # page de l'appli (chemin), ou adresse
    image      = Column(String(500), nullable=True)    # image publique (https)
    users      = Column(Text, nullable=False, default=",*,")
