"""
Modèles SQLAlchemy — Objets et accessoires (equivalents Spoolnymous).
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, Index, Boolean
from sqlalchemy.orm import relationship
from ..db.session import Base


class ObjectGroup(Base):
    """Groupe d'objets (ex: set, collection)."""
    __tablename__ = "object_groups"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    name            = Column(String(256), nullable=False)
    external_ref    = Column(String(64), nullable=True)
    desired_price   = Column(Float, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)

    objects = relationship("Object", back_populates="group")


class Object(Base):
    """Objet imprimé (produit fini, unité)."""
    __tablename__ = "objects"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    external_ref     = Column(String(64), nullable=True)

    name             = Column(String(256), nullable=False)
    translated_name  = Column(String(256), nullable=True)
    thumbnail        = Column(String(512), nullable=True)
    comment          = Column(Text, nullable=True)

    # parent : print ou groupe de prints
    parent_type      = Column(String(16), nullable=True)   # "print" | "group"
    parent_id        = Column(Integer, nullable=True)

    # Groupe d'objets
    group_id         = Column(Integer, ForeignKey("object_groups.id", ondelete="SET NULL"), nullable=True)

    # Coûts
    cost_fabrication = Column(Float, default=0.0)   # coût print (élec + filament override)
    cost_accessory   = Column(Float, default=0.0)   # coût accessoires
    cost_total       = Column(Float, default=0.0)   # = fabrication + accessoire
    normal_cost_unit = Column(Float, nullable=True)  # coût au prix normal

    # Etat de l'objet, explicite.
    #
    # Il etait jusqu'ici DEDUIT de trois champs (available, personal,
    # sold_price), ce qui rendait certains cas illisibles : un objet
    # indisponible mais ni vendu ni perso n'avait aucun libelle et
    # s'affichait simplement grise, sans qu'on sache pourquoi. Et "offert"
    # n'existait pas, alors que Spoolnymous le gerait.
    #
    #   available    a vendre
    #   sold         vendu (montant dans sold_price)
    #   gifted       offert
    #   personal     garde pour soi
    #   unavailable  indisponible : casse, perdu, reserve
    status           = Column(String(16), nullable=False, default="available")

    # Vente
    available        = Column(Boolean, default=True)
    personal         = Column(Boolean, default=False)
    sold_price       = Column(Float, nullable=True)
    sold_date        = Column(DateTime, nullable=True)
    desired_price    = Column(Float, nullable=True)
    margin           = Column(Float, nullable=True)

    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    group       = relationship("ObjectGroup", back_populates="objects")
    accessories = relationship("ObjectAccessory", back_populates="object", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_objects_parent", "parent_type", "parent_id"),
        Index("idx_objects_group",  "group_id"),
        Index("idx_objects_avail",  "available"),
    )


class Accessory(Base):
    """Accessoire physique (stock global)."""
    __tablename__ = "accessories"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    external_ref= Column(String(64), nullable=True)
    name        = Column(String(256), nullable=False, unique=True)
    quantity    = Column(Integer, default=0)
    unit_price  = Column(Float, default=0.0)
    image_path  = Column(String(512), nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    object_links = relationship("ObjectAccessory", back_populates="accessory", cascade="all, delete-orphan")

    __table_args__ = (Index("idx_accessories_name", "name"),)


class ObjectAccessory(Base):
    """Lien Objet ↔ Accessoire (quantité + prix figé au moment du lien)."""
    __tablename__ = "object_accessories"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    object_id          = Column(Integer, ForeignKey("objects.id", ondelete="CASCADE"), nullable=False)
    accessory_id       = Column(Integer, ForeignKey("accessories.id", ondelete="CASCADE"), nullable=False)
    quantity           = Column(Integer, default=1, nullable=False)
    unit_price_at_link = Column(Float, default=0.0, nullable=False)
    created_at         = Column(DateTime, default=datetime.utcnow)

    object    = relationship("Object", back_populates="accessories")
    accessory = relationship("Accessory", back_populates="object_links")

    __table_args__ = (
        Index("idx_objacc_object", "object_id"),
        Index("idx_objacc_acc",    "accessory_id"),
    )
