"""Les mouvements de poids d'une bobine hors impression (31/10/2026) : ce qu'on lui rend, et ce qu'on annule.

Rendre du filament a une bobine (en supprimant une impression, en dissociant un filament, ou depuis l'historique)
ne laissait aucune trace : l'historique de la bobine ne montrait que les impressions. Chaque mouvement est garde ici,
avec l'impression d'ou il vient (son nom reste meme quand elle est supprimee), et peut etre annule.
"""
from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String
from ..db.session import Base


class SpoolMove(Base):
    __tablename__ = "spool_moves"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    spool_id    = Column(Integer, nullable=False, index=True)
    at          = Column(DateTime, default=datetime.utcnow, index=True)
    grams       = Column(Float, nullable=False)                  # rendus a la bobine (> 0)
    kind        = Column(String(20), nullable=False, default="rendu")   # rendu | annule (une consommation annulee)
    print_id    = Column(Integer, nullable=True)
    usage_id    = Column(Integer, nullable=True)                 # la consommation d'ou viennent ces grammes
    unlinked    = Column(Boolean, default=False)                 # la consommation a ete detachee de la bobine
    label       = Column(String(250), nullable=True)             # le nom de l'impression, garde
    reverted_at = Column(DateTime, nullable=True)                # annule depuis l'historique
