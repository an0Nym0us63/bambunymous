from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String, Text

from ..db.session import Base


class MailOrder(Base):
    """Une commande Bambu Lab lue dans les mails (28/10/2026) : son numero, son etat (confirmee, expediee,
    livree, annulee), le suivi, et ses lignes (JSON) avec, pour chaque filament reconnu, la fiche du catalogue
    et le filament de l'appli ; « received » compte ce qui est arrive (bobine ajoutee ou scannee, ou coche a la
    main). Une commande dont tout est arrive, ou cachee, sort de « a venir »."""
    __tablename__ = "mail_orders"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    order_no    = Column(String(64), nullable=False, unique=True)
    store       = Column(String(64), nullable=True)          # eu.store.bambulab.com…
    status      = Column(String(16), nullable=False, default="confirmed")
    ordered_at  = Column(DateTime, nullable=True)
    shipped_at  = Column(DateTime, nullable=True)
    delivered_at = Column(DateTime, nullable=True)
    tracking_url = Column(String(512), nullable=True)
    carrier     = Column(String(64), nullable=True)
    subject     = Column(String(256), nullable=True)
    items_json  = Column(Text, nullable=False, default="[]")
    shipments_json = Column(Text, nullable=True)             # les envois (Bambu expedie souvent en plusieurs colis)
    total       = Column(String(32), nullable=True)
    hidden      = Column(Boolean, default=False)
    done        = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_mail_orders_status", "status"),
        Index("idx_mail_orders_done", "done", "hidden"),
    )
