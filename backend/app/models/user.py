"""Modèle utilisateur : comptes applicatifs et rôles."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, text
from ..db.session import Base

# Rôles supportés.
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
    last_seen     = Column(DateTime, nullable=True)   # derniere activite
    # Tout jeton emis AVANT cette date est refuse. Un JWT est sans etat : sans
    # ce garde-fou, changer un mot de passe ou retrograder un role n'a aucun
    # effet sur les sessions deja ouvertes, qui restent valides jusqu'a
    # expiration -- des jours plus tard.
    tokens_valid_from = Column(DateTime, nullable=True)
    # Double authentification (TOTP), activee par l'utilisateur lui-meme.
    # totp_secret est pose des la mise en place, mais ne compte qu'une fois
    # totp_enabled (code verifie) ; totp_last_step evite le rejeu d'un code ;
    # totp_recovery = empreintes JSON des codes de secours restants.
    totp_secret    = Column(String(64), nullable=True)
    # server_default : la creation de l'admin initial passe par un INSERT SQL
    # brut (migration) qui ne nomme pas cette colonne ; sans defaut cote base,
    # NOT NULL le faisait echouer sur une installation neuve.
    totp_enabled   = Column(Boolean, default=False, server_default=text("0"), nullable=False)
    totp_last_step = Column(Integer, nullable=True)
    totp_recovery  = Column(Text, nullable=True)
    # Invitation copain : empreinte SHA-256 de la cle d'acces (fk_…) donnee a
    # un ami pour parcourir ce BambuNymous avec les droits de ce compte, en
    # lecture seule. Revocable ; la cle elle-meme n'est jamais gardee.
    friend_key_hash = Column(String(64), nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN
