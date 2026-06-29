"""
Modèles SQLAlchemy — historique des impressions BambuNymous.
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import relationship
from ..db.session import Base


class Print(Base):
    __tablename__ = "prints"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    job_id              = Column(String(64),  nullable=True)
    print_date          = Column(DateTime,    nullable=False, default=datetime.utcnow)
    file_name           = Column(String(512), nullable=False, default="")
    original_name       = Column(String(512), nullable=True)
    print_type          = Column(String(32),  default="cloud")

    status              = Column(String(32),  default="IN_PROGRESS")
    status_note         = Column(Text,        nullable=True)

    plate_image         = Column(String(512), nullable=True)
    external_ref        = Column(String(256), nullable=True)  # stem fichier Spoolnymous ex: 20250807163605_19b0e749
    model_3mf           = Column(String(512), nullable=True)

    estimated_seconds   = Column(Float, nullable=True)
    duration_seconds    = Column(Float, nullable=True)

    total_weight_g      = Column(Float, default=0.0)
    total_cost_filament = Column(Float, default=0.0)
    electric_cost       = Column(Float, default=0.0)
    total_cost          = Column(Float, default=0.0)

    number_of_items     = Column(Integer, default=1)
    sold_units          = Column(Integer, default=0)
    sold_price_total    = Column(Float,   nullable=True)
    margin              = Column(Float,   default=0.0)

    plate_id            = Column(String(8),   default="1")
    design_id           = Column(String(128), nullable=True)
    printer_model       = Column(String(32),  default="H2C")

    created_at          = Column(DateTime, default=datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    filament_usage  = relationship("FilamentUsage", back_populates="print",
                                   cascade="all, delete-orphan")
    snapshots       = relationship("PrintSnapshot",  back_populates="print",
                                   cascade="all, delete-orphan")
    tags            = relationship("PrintTag",        back_populates="print",
                                   cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_prints_job_id",   "job_id"),
        Index("idx_prints_date",     "print_date"),
        Index("idx_prints_status",   "status"),
        Index("idx_prints_filename", "file_name"),
    )


class FilamentUsage(Base):
    __tablename__ = "filament_usage"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    print_id      = Column(Integer, ForeignKey("prints.id", ondelete="CASCADE"), nullable=False)
    # Pas de FK vers bobines pour éviter les problèmes de dépendance circulaire
    # spool_id est juste stocké comme entier
    spool_id      = Column(Integer, nullable=True)

    filament_type = Column(String(64), nullable=False, default="")
    color_hex     = Column(String(16), nullable=False, default="")
    grams_used    = Column(Float, nullable=False, default=0.0)

    ams_slot      = Column(Integer, nullable=False, default=0)
    ams_id        = Column(Integer, nullable=True)
    tray_id       = Column(Integer, nullable=True)

    cost          = Column(Float, default=0.0)
    normal_cost   = Column(Float, default=0.0)

    print = relationship("Print", back_populates="filament_usage")

    __table_args__ = (
        Index("idx_filament_usage_print", "print_id"),
    )


class PrintSnapshot(Base):
    __tablename__ = "print_snapshots"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    print_id  = Column(Integer, ForeignKey("prints.id", ondelete="CASCADE"), nullable=False)
    trigger   = Column(String(32), nullable=False)
    file_path = Column(String(512), nullable=True)
    taken_at  = Column(DateTime, default=datetime.utcnow)

    print = relationship("Print", back_populates="snapshots")

    __table_args__ = (Index("idx_snapshots_print", "print_id"),)


class PrintTag(Base):
    __tablename__ = "print_tags"

    id       = Column(Integer, primary_key=True, autoincrement=True)
    print_id = Column(Integer, ForeignKey("prints.id", ondelete="CASCADE"), nullable=False)
    tag      = Column(String(128), nullable=False)

    print = relationship("Print", back_populates="tags")

    __table_args__ = (
        Index("idx_print_tags_print", "print_id"),
        Index("idx_print_tags_tag",   "tag"),
    )
