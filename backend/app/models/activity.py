"""Journal d'activite : trace des actions faites par chaque compte."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Index
from ..db.session import Base


class ActivityLog(Base):
    """
    Une ligne par action (ecriture ou connexion). Les lectures ne sont PAS
    journalisees : elles n'apportent rien et feraient exploser la table (le front
    interroge le statut imprimante en continu). Le simple fait qu'un compte soit
    actif est suivi par users.last_seen.
    """
    __tablename__ = "activity_log"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    username  = Column(String(64), nullable=False, index=True)
    method    = Column(String(8),  nullable=False)     # POST, PATCH, DELETE…
    path      = Column(String(255), nullable=False)
    status    = Column(Integer, nullable=True)         # code HTTP de la reponse
    label     = Column(String(120), nullable=True)     # libelle lisible
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (Index("idx_activity_user_date", "username", "created_at"),)
