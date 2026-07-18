"""Journal d'activite : trace des actions faites par chaque compte."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Index
from ..db.session import Base


class ActivityLog(Base):
    """
    Deux natures de lignes, distinguees par `kind` :
      - "action" : une ecriture ou une connexion ;
      - "visite" : l'arrivee d'un compte sur une page de l'application.

    Les lectures brutes ne sont toujours PAS journalisees une par une : le front
    interroge le statut imprimante en continu, la table exploserait. Une visite
    n'est enregistree qu'au CHANGEMENT de page, l'application etant en page
    unique c'est le front qui annonce ou il se trouve (en-tete X-App-Page).
    """
    __tablename__ = "activity_log"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    username  = Column(String(64), nullable=False, index=True)
    method    = Column(String(8),  nullable=False)     # POST, PATCH, DELETE…
    path      = Column(String(255), nullable=False)
    status    = Column(Integer, nullable=True)         # code HTTP de la reponse
    label     = Column(String(120), nullable=True)     # libelle lisible
    kind      = Column(String(8), nullable=False, default="action", server_default="action")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (Index("idx_activity_user_date", "username", "created_at"),)
