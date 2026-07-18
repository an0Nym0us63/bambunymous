"""Modèle utilisateur : comptes applicatifs et rôles."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from ..db.session import Base

# Rôles supportés.
ROLE_ADMIN = "admin"        # accès complet
ROLE_READONLY = "readonly"  # consultation seule, montants masqués côté UI
ROLES = (ROLE_ADMIN, ROLE_READONLY)


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    username      = Column(String(64), nullable=False, unique=True, index=True)
    password_hash = Column(String(256), nullable=False)
    role          = Column(String(16), nullable=False, default=ROLE_ADMIN)
    active        = Column(Boolean, default=True, nullable=False)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN
