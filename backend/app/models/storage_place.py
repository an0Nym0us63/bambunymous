"""Les rangements des bobines (07/11/2026) : un arbre d'emplacements (Tiroir 1 > Colonne 1 > Ligne 3, Rack 1 > A2…).

Un noeud qui a des enfants est un groupe : on n'y range rien directement. Une feuille recoit des bobines : commune
(un placard, autant de bobines qu'on veut) ou unique (une case, une seule bobine a la fois, tant que celle qui l'occupe
n'est pas rangee ailleurs ou archivee). Voir services/storage_places.py pour les trois modes de rangement.
"""
from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, Integer, String
from ..db.session import Base


class StoragePlace(Base):
    __tablename__ = "storage_places"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    parent_id  = Column(Integer, nullable=True, index=True)       # None : a la racine
    name       = Column(String(60), nullable=False)
    single     = Column(Boolean, nullable=False, default=False)   # une seule bobine a la fois (case)
    sort       = Column(Integer, nullable=False, default=0)
    cols       = Column(Integer, nullable=True)                   # groupe : ses enfants en grille de cols colonnes
    icon       = Column(String(8), nullable=True)
    # du stock (cartons, reserve) : une bobine qui en sort pour l'AMS n'y revient pas, et l'echange intelligent n'y
    # range jamais celle qu'elle remplace (07/11/2026) ; vaut pour tout ce que le noeud contient
    stock      = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)
