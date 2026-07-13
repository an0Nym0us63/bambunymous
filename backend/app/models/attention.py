from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, String

from ..db.session import Base


class AttentionDismissal(Base):
    """
    Alerte mise en sourdine par l'utilisateur.

    `key` est l'identifiant STABLE de l'alerte (ex. "no_spool:filament:106") :
    c'est lui qui permet de retrouver la même alerte d'un calcul à l'autre. Les
    alertes ne sont jamais stockées, seulement recalculées ; on ne persiste que
    les mises en sourdine.

    `until = NULL` -> ignorée définitivement.
    `until = date` -> ignorée jusqu'à cette date.
    """
    __tablename__ = "attention_dismissals"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    key        = Column(String(128), nullable=False, unique=True)
    until      = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_attention_key", "key"),
    )
