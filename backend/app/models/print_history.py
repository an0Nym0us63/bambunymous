"""
Modèles SQLAlchemy — historique des impressions BambuNymous.
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, Index, event, text
from sqlalchemy.orm import relationship
from ..db.session import Base


class Print(Base):
    __tablename__ = "prints"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    job_id              = Column(String(64),  nullable=True)
    print_date          = Column(DateTime,    nullable=False, default=datetime.utcnow)
    file_name           = Column(String(512), nullable=False, default="")
    original_name       = Column(String(512), nullable=True)
    # Nom en francais, uniquement pour la recherche : les noms arrivent en
    # anglais ou en chinois, chercher "cochon" ne trouvait jamais "pig".
    # N'a aucun rapport avec filaments.translated_name, qui vient du catalogue
    # Bambu local.
    translated_name     = Column(String(512), nullable=True)
    # D'ou vient ce nom : deepl / google / mymemory (traduit), identique (deja
    # francais, inscrit tel quel), manuel (saisi a la main). Montre au survol.
    translated_by       = Column(String(16),  nullable=True)
    print_type          = Column(String(32),  default="cloud")

    status              = Column(String(32),  default="IN_PROGRESS")
    status_note         = Column(Text,        nullable=True)

    plate_image         = Column(String(512), nullable=True)
    # Photo mise en avant (vignette de la galerie). Etait presente puis a disparu
    # du modele lors d'un ecrasement de fichier : prints.py la lit a 7 endroits
    # (PrintOut, tri de la galerie, endpoint /photo/{f}/primary) et le service
    # d'alertes aussi -> AttributeError a l'execution.
    cover_photo         = Column(String(256), nullable=True)
    external_ref        = Column(String(256), nullable=True)  # stem fichier Spoolnymous ex: 20250807163605_19b0e749
    model_3mf           = Column(String(512), nullable=True)
    # Necessaires pour REPRENDRE l'enrichissement apres un redemarrage : sans eux,
    # un restart pendant la fenetre de retry perdait le 3MF definitivement.
    task_name           = Column(String(512), nullable=True)
    model_url           = Column(String(1024), nullable=True)

    estimated_seconds   = Column(Float, nullable=True)
    duration_seconds    = Column(Float, nullable=True)

    total_weight_g              = Column(Float, default=0.0)
    total_cost_filament         = Column(Float, default=0.0)  # prix bobine (override)
    total_cost_filament_normal  = Column(Float, default=0.0)  # prix filament de base
    electric_cost               = Column(Float, default=0.0)
    wear_cost                   = Column(Float, default=0.0)  # usure de l'imprimante : duree x WEAR_BY_HOUR (12/11/2026)
    total_cost                  = Column(Float, default=0.0)  # filament override + elec + usure

    number_of_items     = Column(Integer, default=1)
    sold_units          = Column(Integer, default=0)
    sold_price_total    = Column(Float,   nullable=True)
    margin              = Column(Float,   default=0.0)

    plate_id            = Column(String(8),   default="1")
    design_id           = Column(String(128), nullable=True)
    # Profil MakerWorld imprime (profile_id du MQTT) : dit, avec plate_id,
    # quel plateau de quel profil -- pour cocher les plateaux d'un groupe.
    mw_profile_id       = Column(String(32),  nullable=True)
    # Plateaux MakerWorld designes a la main (JSON {"profile": id, "plates": [2, 4]}) :
    # un plateau renumerote dans mon projet, ou plusieurs plateaux regroupes en un.
    # Passe avant plate_id.
    mw_plates           = Column(Text, nullable=True)
    printer_model       = Column(String(32),  default="H2C")
    # Temps passe en pause pendant le print (bobine vide, erreur, pause manuelle) : retire
    # du temps ecoule pour la duree reelle. paused_since (UTC) = pause en cours.
    paused_seconds      = Column(Float, nullable=True)
    paused_since        = Column(DateTime, nullable=True)
    # les pieces annulees en cours de route (05/11/2026), JSON {"objects": [{id, name, layer}], "back": [[bobine, g]]} :
    # la fiche et la liste les signalent ; « back », ce qui est revenu aux bobines a la fin
    skipped_objects     = Column(Text, nullable=True)

    group_id            = Column(Integer, ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)
    # hors des classements de la page Stats (echantillons, supports de bobine…), compte dans les totaux
    stats_excluded      = Column(Integer, default=0)
    # la vignette : celle de la vue 3D assemblee (Vue3D.png, prise dans la vue 3D) plutot que l'image du plateau
    thumb_3d            = Column(Integer, default=0)
    # l'electricite mesuree par Home Assistant (12/11/2026, services/home_assistant.py) : kWh, puissance moyenne, cout
    # au tarif de chaque tranche, d'ou vient la mesure, et les tranches de 15 min [[debut UTC, kWh, prix, libelle]]
    energy_kwh          = Column(Float, nullable=True)
    energy_avg_w        = Column(Float, nullable=True)
    energy_cost         = Column(Float, nullable=True)
    energy_source       = Column(String(32), nullable=True)
    energy_slots        = Column(Text, nullable=True)
    energy_tries        = Column(Integer, default=0)

    @property
    def energy_labels(self):
        """{libelle: kWh} (HC, HP, Bleu HC…) des tranches mesurees."""
        import json as _json
        try:
            rows = _json.loads(self.energy_slots) if self.energy_slots else []
        except ValueError:
            return None
        out = {}
        for r in rows:
            if len(r) >= 4 and r[3]:
                out[r[3]] = round(out.get(r[3], 0.0) + (r[1] or 0), 4)
        return out or None

    created_at          = Column(DateTime, default=datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    filament_usage  = relationship("FilamentUsage", back_populates="print",
                                   cascade="all, delete-orphan")
    snapshots       = relationship("PrintSnapshot",  back_populates="print",
                                   cascade="all, delete-orphan")
    tags            = relationship("PrintTag",        back_populates="print",
                                   cascade="all, delete-orphan")
    group           = relationship("Group", back_populates="prints")

    __table_args__ = (
        Index("idx_prints_job_id",   "job_id"),
        Index("idx_prints_date",     "print_date"),
        Index("idx_prints_status",   "status"),
        Index("idx_prints_filename", "file_name"),
        Index("idx_prints_group_id", "group_id"),
    )


# Un numero d'impression ne resert jamais (31/10/2026) : SQLite redonne celui de la derniere impression supprimee a
# la suivante, et tout ce qui est range par numero la confondait avec l'ancienne -- sa vignette (meme adresse, gardee
# un an par le navigateur), ses fichiers sur le NAS. La suppression note le plus grand numero donne
# (DATA_DIR/print_ids.json) ; une impression creee sous ce numero passe au-dessus.
def last_deleted_id() -> int:
    import json
    from pathlib import Path
    from ..core.config import settings
    try:
        return int(json.loads((Path(settings.DATA_DIR) / "print_ids.json").read_text(encoding="utf-8")).get("last") or 0)
    except (OSError, ValueError, TypeError, AttributeError):
        return 0


def note_deleted_id(pid: int) -> None:
    import json
    from pathlib import Path
    from ..core.config import settings
    if int(pid) > last_deleted_id():
        try:
            (Path(settings.DATA_DIR) / "print_ids.json").write_text(json.dumps({"last": int(pid)}), encoding="utf-8")
        except OSError:
            pass


@event.listens_for(Print, "before_insert")
def _fresh_print_id(mapper, connection, target):
    if target.id is None:
        floor = last_deleted_id()
        if floor and (connection.execute(text("SELECT COALESCE(MAX(id), 0) FROM prints")).scalar() or 0) < floor:
            target.id = floor + 1


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
    # suivi couche par couche (02/11/2026) : une bobine qui a pris le relais d'une autre pour ce filament, a partir de
    # ce nombre de grammes consommes du filament ; vide pour la premiere (la seule, sans changement de bobine)
    from_g        = Column(Float, nullable=True)
    # le poids de la bobine juste avant le decompte du lancement (04/11/2026) : le decompte s'arrete a 0, le suivi en
    # direct et le rendu d'un echec partent de lui (vide pour les impressions d'avant)
    spool_before_g = Column(Float, nullable=True)
    ams_id        = Column(Integer, nullable=True)
    tray_id       = Column(Integer, nullable=True)

    cost          = Column(Float, default=0.0)
    normal_cost   = Column(Float, default=0.0)

    print = relationship("Print", back_populates="filament_usage")

    __table_args__ = (
        Index("idx_filament_usage_print", "print_id"),
        # spool_id est joint par les stats et les filtres : sans index, scan complet.
        Index("idx_filament_usage_spool", "spool_id"),
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


class ModelLabel(Base):
    """
    Les familles, categories et etiquettes d'un modele, proposees par Claude (07/11/2026) : une ligne par modele,
    pas par impression. La cle : « mw:{design_id} » (modele MakerWorld), sinon « g:{group_id} », sinon « p:{print_id} » ;
    une seule des trois colonnes design_id / group_id / print_id est remplie, celle de la cle (la recherche s'y joint).
    families, categories (noms) et tags en listes JSON ; catmap : la famille de chaque categorie.
    """
    __tablename__ = "model_labels"

    key        = Column(String(160), primary_key=True)
    design_id  = Column(String(128), nullable=True)
    group_id   = Column(Integer,     nullable=True)
    print_id   = Column(Integer,     nullable=True)
    title      = Column(Text,        nullable=True)
    families   = Column(Text,        nullable=True)
    categories = Column(Text,        nullable=True)
    catmap     = Column(Text,        nullable=True)
    tags       = Column(Text,        nullable=True)
    source     = Column(String(16),  nullable=False, default="ai")
    model      = Column(String(64),  nullable=True)
    seen       = Column(Integer,     nullable=False, default=0)   # Claude a vu son image
    updated_at = Column(DateTime,    nullable=False, default=datetime.utcnow)
    # (14/11/2026) une variante d'un modele (un profil = une piece : le champignon d'un lot de legumes) : « {design}@{profil} ».
    # Sa ligne (cle « mw:{design}@{profil} », design_id vide) porte les etiquettes de cette piece seule ; celle du modele
    # ne garde que ce qui vaut pour toutes. Une impression de ce profil a les deux.
    variant    = Column(String(200), nullable=True)

    __table_args__ = (
        Index("idx_model_labels_variant", "variant"),
        Index("idx_model_labels_design", "design_id"),
        Index("idx_model_labels_group",  "group_id"),
        Index("idx_model_labels_print",  "print_id"),
    )


class Group(Base):
    """
    Groupe de prints, identifié par son propre id BambuNymous (exactement
    comme Print.id ou Filament.id) — distinct du nom, pour éviter que deux
    groupes différents portant le même nom (mais créés à des dates
    différentes côté Spoolnymous) ne soient fusionnés en un seul.
    """
    __tablename__ = "groups"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    name         = Column(String(256), nullable=False)
    external_ref = Column(String(64), nullable=True)
    number_of_items  = Column(Integer, default=1)
    cover_print_id   = Column(Integer, nullable=True)  # print de référence pour la vignette
    cover_photo      = Column(String(256), nullable=True)  # nom de fichier de la photo choisie comme vignette de galerie
    stats_excluded   = Column(Integer, default=0)          # toutes ses impressions hors des classements des stats
    thumb_3d         = Column(Integer, default=0)          # sa vignette : la vue 3D assemblee plutot que la mosaique
    created_at   = Column(DateTime, default=datetime.utcnow)

    prints = relationship("Print", back_populates="group")

    __table_args__ = (
        Index("idx_groups_external_ref", "external_ref"),
        Index("idx_groups_name", "name"),
    )


class MakerWorldDesign(Base):
    """
    Fiche publique d'un modele MakerWorld, en cache (une par design_id, partagee
    par tous les prints de ce modele). Lue sans compte sur l'API du site ;
    rafraichie tous les 30 jours. status : ok / notfound / error.
    """
    __tablename__ = "makerworld_designs"

    design_id      = Column(String(32),  primary_key=True)
    status         = Column(String(16),  default="ok")
    title          = Column(String(512), nullable=True)
    title_fr       = Column(String(512), nullable=True)   # traduit pour la recherche
    cover_url      = Column(String(1024), nullable=True)
    creator_name   = Column(String(256), nullable=True)
    creator_handle = Column(String(256), nullable=True)
    creator_avatar = Column(String(1024), nullable=True)
    creator_uid    = Column(String(32), nullable=True)      # page du createur (tous ses modeles)
    categories     = Column(String(512), nullable=True)   # CSV, en francais
    tags           = Column(Text,        nullable=True)   # CSV
    like_count     = Column(Integer, nullable=True)
    download_count = Column(Integer, nullable=True)
    print_count    = Column(Integer, nullable=True)
    collection_count = Column(Integer, nullable=True)
    # Profils et leurs plateaux (JSON) : [{profile_id, title, plates:[{index,
    # name, thumb, weight_g, seconds}]}]
    profiles       = Column(Text, nullable=True)
    # Documents joints et pieces a prevoir (JSON, 27/10/2026) : {docs: [{kind, name, url, profile_id, profile}],
    # parts: [{title, quantity, url}], other_parts}. None : pas encore lu (le rattrapage le relit).
    extras         = Column(Text, nullable=True)
    fetched_at     = Column(DateTime, nullable=True)
