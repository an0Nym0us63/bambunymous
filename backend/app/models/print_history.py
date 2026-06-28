"""
Modèles SQLAlchemy — historique des impressions BambuNymous.
Champs compatibles Spoolnymous (même sémantique, même stats possibles).
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import relationship
from ..db.session import Base


class Print(Base):
    __tablename__ = "prints"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    job_id              = Column(String(64),  nullable=True)      # job_id Bambu Lab
    print_date          = Column(DateTime,    nullable=False, default=datetime.utcnow)
    file_name           = Column(String(512), nullable=False, default="")   # nom nettoyé
    original_name       = Column(String(512), nullable=True)                # nom brut
    print_type          = Column(String(32),  default="cloud")   # cloud/local/manual

    # Statut
    status              = Column(String(32),  default="IN_PROGRESS")  # IN_PROGRESS/SUCCESS/FAILED/CANCELLED
    status_note         = Column(Text,        nullable=True)

    # Fichiers liés (relatifs à /data/)
    plate_image         = Column(String(512), nullable=True)   # prints/{id}/plate.png
    model_3mf           = Column(String(512), nullable=True)   # prints/{id}/model.3mf

    # Durées
    estimated_seconds   = Column(Float, nullable=True)   # depuis slice_info (prediction)
    duration_seconds    = Column(Float, nullable=True)   # durée réelle finale

    # Coûts (recalculés à la fin du print)
    total_weight_g      = Column(Float, default=0.0)
    total_cost_filament = Column(Float, default=0.0)
    electric_cost       = Column(Float, default=0.0)
    total_cost          = Column(Float, default=0.0)     # filament + electric

    # Vente / marge (compat Spoolnymous)
    number_of_items     = Column(Integer, default=1)
    sold_units          = Column(Integer, default=0)
    sold_price_total    = Column(Float,   nullable=True)
    margin              = Column(Float,   default=0.0)

    # Contexte
    plate_id            = Column(String(8),   default="1")   # numéro de plateau dans le 3MF
    design_id           = Column(String(128), nullable=True) # MakerWorld design ID
    printer_model       = Column(String(32),  default="H2C")

    created_at          = Column(DateTime, default=datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relations
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
    spool_id      = Column(Integer, ForeignKey("spools.id", ondelete="SET NULL"), nullable=True)

    # Snapshot au moment du print
    filament_type = Column(String(64), nullable=False, default="")
    color_hex     = Column(String(16), nullable=False, default="")  # "#RRGGBB"
    grams_used    = Column(Float, nullable=False, default=0.0)

    # Slot (compat Spoolnymous: ams_slot = numéro global)
    ams_slot      = Column(Integer, nullable=False, default=0)  # slot global (1-based dans le 3MF)
    ams_id        = Column(Integer, nullable=True)              # boîtier AMS (0=A, 1=B…)
    tray_id       = Column(Integer, nullable=True)              # slot local dans le boîtier

    # Coût
    cost          = Column(Float, default=0.0)
    normal_cost   = Column(Float, default=0.0)  # coût au prix catalogue

    print  = relationship("Print", back_populates="filament_usage")
    spool  = relationship("Spool", foreign_keys=[spool_id])

    __table_args__ = (
        Index("idx_filament_usage_print", "print_id"),
        Index("idx_filament_usage_spool", "spool_id"),
    )


class PrintSnapshot(Base):
    __tablename__ = "print_snapshots"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    print_id  = Column(Integer, ForeignKey("prints.id", ondelete="CASCADE"), nullable=False)
    trigger   = Column(String(32), nullable=False)  # layer1/layer2/pct50/pct99/pct100/fail/manual
    file_path = Column(String(512), nullable=True)  # relatif à /data/
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
