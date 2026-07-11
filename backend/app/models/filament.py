"""
Modèles Filament et Bobine pour BambuNymous.
Basé sur le schéma DB Spoolnymous existant.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import Integer, String, Float, Text, Boolean, DateTime, Index, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..db.session import Base


class Filament(Base):
    """Catalogue des filaments (type/marque/couleur)."""
    __tablename__ = "filaments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    name_en: Mapped[Optional[str]] = mapped_column(String, nullable=True)   # nom anglais officiel Bambu
    manufacturer: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    material: Mapped[str] = mapped_column(String, nullable=False, default="PLA")  # famille : PLA, PETG…
    fila_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # sous-type Bambu : PLA Basic, PLA Matte…
    color: Mapped[Optional[str]] = mapped_column(String(9), nullable=True)   # hex sans # — 6 chars (RGB) ou 8 chars (RGBA)
    multicolor_type: Mapped[str] = mapped_column(String, default="monochrome")
    colors_array: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # CSV hex
    color_bucket: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # CSV teintes ("bleu,rose") — cf. core/colors.py
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)       # €/bobine
    filament_weight_g: Mapped[float] = mapped_column(Float, default=1000.0)
    spool_weight_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    profile_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)   # ex: GFA00
    fila_color_code: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # ex: 10600 (code couleur catalogue Bambu)
    external_filament_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    translated_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # nom localisé
    reference_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    swatch: Mapped[bool] = mapped_column(Boolean, default=False)
    transparent: Mapped[bool] = mapped_column(Boolean, default=False)  # conservé pour compatibilité DB (NOT NULL), non exposé dans les schémas
    to_order: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    spools: Mapped[list["Spool"]] = relationship("Spool", back_populates="filament", lazy="selectin")

    __table_args__ = (
        Index("idx_filaments_material", "material"),
        Index("idx_filaments_manufacturer", "manufacturer"),
        Index("idx_filaments_profile_id", "profile_id"),
        Index("idx_filaments_color_bucket", "color_bucket"),
    )


class Spool(Base):
    """Une bobine physique de filament."""
    __tablename__ = "bobines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filament_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("filaments.id", ondelete="RESTRICT"), nullable=False
    )
    remaining_weight_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_override: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    tag_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)   # NFC tag UUID
    ams_tray: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    external_spool_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    found_mode: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # rfid/profile/color
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    first_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    filament: Mapped["Filament"] = relationship("Filament", back_populates="spools")

    __table_args__ = (
        Index("idx_bobines_filament_id", "filament_id"),
        Index("idx_bobines_archived", "archived"),
        Index("idx_bobines_tag_number", "tag_number"),
    )
