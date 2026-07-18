"""Modèle utilisateur : comptes applicatifs et rôles."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from ..db.session import Base

# Rôles supportés. Seul ROLE_ADMIN autorise l'écriture : le middleware
# enforce_readonly refuse toute méthode non-GET aux autres, sans les énumérer.
ROLE_ADMIN = "admin"                          # accès complet
ROLE_READONLY = "readonly"                    # consultation seule, montants masqués côté UI
ROLE_READONLY_PRICES = "readonly_prices"      # idem, mais les montants restent visibles
ROLES = (ROLE_ADMIN, ROLE_READONLY, ROLE_READONLY_PRICES)


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    username      = Column(String(64), nullable=False, unique=True, index=True)
    password_hash = Column(String(256), nullable=False)
    # 32 caracteres : "readonly_prices" en occupait deja 15 sur 16.
    role          = Column(String(32), nullable=False, default=ROLE_ADMIN)
    active        = Column(Boolean, default=True, nullable=False)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN
