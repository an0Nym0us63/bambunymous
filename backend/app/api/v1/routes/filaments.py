from fastapi import APIRouter, Body, Depends, Query, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, update, case
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import os

from ....core.colors import buckets_for, all_buckets, apply_alpha
from ....core.materials import family_of, is_family

def _clear_match_cache():
    """Vide le cache de matching MQTT après toute mutation de bobine.
    Delegue au helper partage : voir core/mqtt.clear_match_cache."""
    from ....core.mqtt import clear_match_cache
    clear_match_cache()


def _bg_recalc_by_filament(fid: int):
    """Recalcule en arrière-plan tous les prints utilisant une bobine de ce filament."""
    import threading, asyncio as _aio
    def _run():
        loop = _aio.new_event_loop()
        async def _go():
            from ....db.session import AsyncSessionLocal
            from ....models.filament import Spool
            from ....models.print_history import FilamentUsage
            from sqlalchemy import select as _sel
            from ....services.print_tracker import recalculate_print
            async with AsyncSessionLocal() as db:
                sp_ids = (await db.execute(_sel(Spool.id).where(Spool.filament_id == fid))).scalars().all()
            if not sp_ids: return
            async with AsyncSessionLocal() as db:
                pids = (await db.execute(
                    _sel(FilamentUsage.print_id).where(FilamentUsage.spool_id.in_(sp_ids)).distinct()
                )).scalars().all()
            for pid in pids: await recalculate_print(pid)
        try: loop.run_until_complete(_go())
        finally: loop.close()
    threading.Thread(target=_run, daemon=True).start()


def _bg_recalc_by_spool(sid: int):
    """Recalcule en arrière-plan tous les prints utilisant cette bobine."""
    import threading, asyncio as _aio
    def _run():
        loop = _aio.new_event_loop()
        async def _go():
            from ....db.session import AsyncSessionLocal
            from ....models.print_history import FilamentUsage
            from sqlalchemy import select as _sel
            from ....services.print_tracker import recalculate_print
            async with AsyncSessionLocal() as db:
                pids = (await db.execute(
                    _sel(FilamentUsage.print_id).where(FilamentUsage.spool_id == sid).distinct()
                )).scalars().all()
            for pid in pids: await recalculate_print(pid)
        try: loop.run_until_complete(_go())
        finally: loop.close()
    threading.Thread(target=_run, daemon=True).start()
from pathlib import Path
from ....db.session import get_db, AsyncSessionLocal
from ....models.filament import Filament, Spool
from ....models.print_history import FilamentUsage
from .auth import get_current_user, require_admin
from ....services import drift

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class FilamentOut(BaseModel):
    id: int
    name: str
    name_en: Optional[str] = None
    translated_name: Optional[str] = None
    manufacturer: Optional[str]
    material: str
    fila_type: Optional[str] = None
    color: Optional[str]
    multicolor_type: str
    colors_array: Optional[str]
    fila_finish: Optional[str] = None
    glow_color: Optional[str] = None
    no_reorder: bool = False
    color_bucket: Optional[str] = None
    price: Optional[float]
    filament_weight_g: float
    spool_weight_g: Optional[float]
    spool_tare_name: Optional[str] = None
    profile_id: Optional[str]
    fila_color_code: Optional[str] = None
    catalog_ref: Optional[str] = None     # catalogue des autres marques (« ofd:… »)
    catalog_skip: Optional[str] = None    # ce qu'on garde a nous au lieu du catalogue
    # la fiche technique posee a la synchro (05/11/2026)
    density: Optional[float] = None
    nozzle_min: Optional[int] = None
    nozzle_max: Optional[int] = None
    bed_min: Optional[int] = None
    bed_max: Optional[int] = None
    dry_temp: Optional[int] = None
    dry_hours: Optional[float] = None
    td: Optional[float] = None
    gtin: Optional[str] = None
    buy_url: Optional[str] = None
    swatch: bool
    label_printed: bool = False
    label_printed_at: Optional[datetime] = None
    to_order: bool
    spool_count: int = 0
    active_spool_count: int = 0
    ordered_spool_count: int = 0          # commandees, pas encore recues (28/10/2026)
    shipping_spool_count: int = 0         # dont deja en route (un envoi est parti)
    remaining_weight_total_g: float = 0   # somme du restant sur les bobines actives
    # Dates de la fiche, pour le tri « Ajouté récemment » des onglets Filaments et Galerie (28/10/2026)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class FilamentCreate(BaseModel):
    density: Optional[float] = None
    nozzle_min: Optional[int] = None
    nozzle_max: Optional[int] = None
    bed_min: Optional[int] = None
    bed_max: Optional[int] = None
    dry_temp: Optional[int] = None
    dry_hours: Optional[float] = None
    td: Optional[float] = None
    gtin: Optional[str] = None
    buy_url: Optional[str] = None
    name: str
    name_en: Optional[str] = None
    translated_name: Optional[str] = None
    manufacturer: Optional[str] = None
    material: str = "PLA"
    fila_type: Optional[str] = None
    color: Optional[str] = None
    multicolor_type: str = "monochrome"
    colors_array: Optional[str] = None
    # "" = revenir a la finition deduite du nom
    fila_finish: Optional[str] = None
    # phosphorescent : la couleur de sa lueur ("" = il luit de sa couleur)
    glow_color: Optional[str] = None
    price: Optional[float] = None
    filament_weight_g: float = 1000.0
    spool_weight_g: Optional[float] = None
    # Modele de support choisi ; "" = « Autre » (poids libre, lien retire).
    spool_tare_name: Optional[str] = None
    profile_id: Optional[str] = None
    fila_color_code: Optional[str] = None
    catalog_ref: Optional[str] = None
    catalog_skip: Optional[str] = None
    swatch: bool = False
    # None = « je n'en parle pas » : un appelant qui ne connait pas le champ ne
    # doit pas decocher l'etiquette en enregistrant le reste de la fiche.
    label_printed: Optional[bool] = None
    to_order: bool = False
    comment: Optional[str] = None

class SpoolOut(BaseModel):
    id: int
    filament_id: int
    ordered: bool = False                 # commandee, pas encore recue
    # Filament catalogue
    filament_name: str
    filament_translated_name: Optional[str] = None
    filament_manufacturer: Optional[str] = None
    filament_material: str
    filament_fila_type: Optional[str] = None   # sous-type (PLA Basic, PLA Wood…)
    filament_color: Optional[str] = None
    filament_weight_g: Optional[float] = None
    filament_spool_weight_g: Optional[float] = None
    filament_spool_tare_name: Optional[str] = None
    filament_price: Optional[float] = None
    filament_profile_id: Optional[str] = None
    filament_multicolor_type: Optional[str] = None
    filament_colors_array: Optional[str] = None
    filament_fila_finish: Optional[str] = None
    filament_color_bucket: Optional[str] = None
    filament_external_id: Optional[str] = None
    filament_fila_color_code: Optional[str] = None
    filament_swatch: bool = False              # echantillon (nuancier) imprime
    # Bobine physique
    remaining_weight_g: Optional[float] = None
    price_override: Optional[float] = None
    location: Optional[str] = None
    tag_number: Optional[str] = None
    ams_tray: Optional[str] = None
    archived: bool
    comment: Optional[str] = None
    external_spool_id: Optional[str] = None
    found_mode: Optional[str] = None
    # Autres bobines NON archivees du meme filament (celle-ci exclue) et poids
    # total qu'elles representent. Renseignes uniquement la ou c'est utile, pour
    # eviter une requete par bobine.
    sibling_count: Optional[int] = None
    sibling_weight_g: Optional[float] = None
    ordered_siblings: Optional[int] = None    # d'autres bobines de ce filament en commande, pas encore recues
    first_used_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    last_dried_at: Optional[datetime] = None
    # A secher (jamais sechee ou delai depasse) et delai applicable a ce
    # filament : la fiche l'affiche en badge, visible des le scan RFID.
    needs_drying: bool = False
    dry_days: Optional[int] = None
    created_at: datetime
    drift_g: Optional[float] = None
    drift_kind: Optional[str] = None
    drift_off: Optional[str] = None
    end_reason: Optional[str] = None
    overrun_g: Optional[float] = None

class SpoolCreate(BaseModel):
    filament_id: int
    remaining_weight_g: Optional[float] = None
    price_override: Optional[float] = None
    location: Optional[str] = None
    tag_number: Optional[str] = None
    comment: Optional[str] = None

class SpoolUpdate(BaseModel):
    remaining_weight_g: Optional[float] = None
    price_override: Optional[float] = None
    location: Optional[str] = None
    tag_number: Optional[str] = None
    comment: Optional[str] = None
    archived: Optional[bool] = None
    # Sechage fait hors de l'AMS (four, dessiccateur) ou sans inserer la bobine :
    # la detection automatique ne le voit pas, on le saisit. null = jamais sechee.
    last_dried_at: Optional[datetime] = None


# ── Filaments ─────────────────────────────────────────────────────────────────

@router.get("/filaments", response_model=list[FilamentOut])
async def list_filaments(
    q: Optional[str] = Query(None),
    material: Optional[str] = Query(None),
    manufacturer: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    # les comptes et le restant par filament viennent d'une agregation (28/10/2026) : la liste chargeait toutes les
    # bobines, archivees comprises, en objets complets pour n'en tirer que trois nombres
    stmt = select(Filament)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(
            Filament.name.ilike(like),
            Filament.manufacturer.ilike(like),
            Filament.material.ilike(like),
        ))
    if material:
        stmt = stmt.where(Filament.material == material)
    if manufacturer:
        stmt = stmt.where(Filament.manufacturer == manufacturer)
    stmt = stmt.order_by(Filament.manufacturer, Filament.name)
    result = await db.execute(stmt)
    filaments = result.scalars().all()
    agg = await _spool_aggregates(db, [f.id for f in filaments])
    outs = [_fil_out(f, agg.get(f.id, (0, 0, 0.0, 0))) for f in filaments]
    # parmi les bobines commandees, celles deja en route (lu dans les mails de la boutique)
    if any(o.ordered_spool_count for o in outs):
        try:
            from ....services import mail_orders as _MO
            ship = await _MO.shipping_by_filament()
            for o in outs:
                if o.ordered_spool_count:
                    o.shipping_spool_count = min(o.ordered_spool_count, ship.get(o.id, 0))
        except Exception:
            pass
    return outs


@router.post("/filaments/labels/pdf")
async def filament_labels_pdf(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Planche d'etiquettes a coller sur les echantillons : un QR code encodant
    l'ID du filament, et l'ID en clair au-dessus pour pouvoir le saisir a la
    main si le scan echoue.
    body: {ids: [1,2,3]} — ou {} / {"ids": null} pour tous les filaments.
    """
    import io as _io
    import qrcode
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as _canvas
    from fastapi.responses import StreamingResponse

    ids = body.get("ids")
    # Etiquette rectangulaire 12 x 18.75 mm. QR pleine largeur au centre ;
    # 2 lignes au-dessus (numero + marque, puis sous-type) et 2 en dessous
    # (le nom, replie si besoin). Chaque ligne prend la plus grande police
    # possible (jusqu'a PT_MAX) pour maximiser la lisibilite.
    W_mm = float(body.get("w_mm") or 12)
    H_mm = float(body.get("h_mm") or 18.75)
    stmt = select(Filament)
    if ids:
        stmt = stmt.where(Filament.id.in_(ids))
    stmt = stmt.order_by(Filament.id)
    fils = (await db.execute(stmt)).scalars().all()
    if not fils:
        raise HTTPException(404, "Aucun filament à imprimer")

    from reportlab.pdfbase.pdfmetrics import stringWidth

    # Disposition verticale dans le rectangle :
    #   123.Bambu Lab   numero (gras, cale a gauche) + marque a sa suite
    #   PLA Basic       sous-type (repli materiau)
    #   [ QR ]          pleine largeur -> module ~0.57 mm (tres lisible)
    #   Bleu cyan       nom (traduit si dispo), sur 2 lignes au besoin
    CELL_W = W_mm * mm
    CELL_H = H_mm * mm
    QR     = CELL_W                    # QR sur toute la largeur
    GAP    = 3.0 * mm                  # espace entre etiquettes = quiet zone
    MARG   = 10 * mm
    W, H = A4

    # 4 bandes : 2 au-dessus (numero+marque, sous-type), 2 en dessous pour le
    # nom. Le nom a droit a deux bandes parce que c'est le libelle le plus long
    # et le seul qu'on ne puisse pas deviner : le tronquer coute plus cher que
    # de le replier.
    text_h  = CELL_H - QR
    LINE    = text_h / 4               # hauteur d'une bande de texte
    PT_CAP  = 0.82                     # part de la bande occupee par la capitale
    PT_MAX  = 9.0                      # plafond haut : les lignes "adaptables"
                                       # (sous-type, marque) remplissent la largeur
    PT_DESC = 0.21                     # jambage sous la ligne de base (p, g, y)
    QGAP    = 0.30 * mm                # respiration entre le texte et le QR :
                                       # a la police maximale, le texte venait
                                       # au contact du QR, jambages compris
    SEP     = 0.40 * mm                # ecart minimal numero <-> marque

    cols = int((W - 2*MARG + GAP) // (CELL_W + GAP))
    rows = int((H - 2*MARG + GAP) // (CELL_H + GAP))
    per_page = max(1, cols * rows)

    # Plus grande police (<= PT_MAX) qui fait tenir `text` dans la largeur ;
    # tronque avec une ellipse si meme a la police mini ca deborde.
    def _fit_font(text, max_w, font, band_h):
        text = (text or "").strip()
        if not text:
            return None
        pt_from_h = (band_h / mm) * PT_CAP * 2.83465 / 0.72
        pt = min(PT_MAX, pt_from_h)
        if stringWidth(text, font, pt) <= max_w:
            return (text, pt)
        # reduire la police jusqu'a un plancher, sinon tronquer
        while pt > 4.0 and stringWidth(text, font, pt) > max_w:
            pt -= 0.1
        if stringWidth(text, font, pt) <= max_w:
            return (text, pt)
        ell = "…"
        while text and stringWidth(text + ell, font, pt) > max_w:
            text = text[:-1]
        return ((text + ell) if text else "", pt)

    def _wrap(text, font, pt, max_w):
        """Decoupe `text` en lignes tenant dans max_w. Un mot plus large que la
        ligne est coupe au caractere : sans ca, une reference sans espace
        deborderait indefiniment."""
        out, cur = [], ""
        for word in text.split():
            cand = (cur + " " + word) if cur else word
            if stringWidth(cand, font, pt) <= max_w:
                cur = cand
                continue
            if cur:
                out.append(cur)
                cur = ""
            while len(word) > 1 and stringWidth(word, font, pt) > max_w:
                k = len(word)
                while k > 1 and stringWidth(word[:k], font, pt) > max_w:
                    k -= 1
                out.append(word[:k])
                word = word[k:]
            cur = word
        if cur:
            out.append(cur)
        return out or [""]

    # Comme _fit_font, mais autorise `max_lines` lignes avant de tronquer :
    # on reduit d'abord la police, on ne coupe qu'une fois au plancher.
    def _fit_wrap(text, max_w, font, band_h, max_lines):
        text = (text or "").strip()
        if not text:
            return None
        pt = min(PT_MAX, (band_h / mm) * PT_CAP * 2.83465 / 0.72)
        floor = 4.0
        while True:
            lines = _wrap(text, font, pt, max_w)
            if len(lines) <= max_lines:
                return (lines, pt)
            if pt <= floor:
                break
            pt = max(floor, pt - 0.1)
        lines = _wrap(text, font, pt, max_w)[:max_lines]
        ell, last = "…", lines[-1]
        while last and stringWidth(last + ell, font, pt) > max_w:
            last = last[:-1]
        lines[-1] = (last + ell) if last else ell
        return (lines, pt)

    buf = _io.BytesIO()
    c = _canvas.Canvas(buf, pagesize=A4)
    c.setTitle("BambuNymous — étiquettes filaments")

    for i, f in enumerate(fils):
        if i and i % per_page == 0:
            c.showPage()
        k = i % per_page
        col, row = k % cols, k // cols
        x = MARG + col * (CELL_W + GAP)
        y = H - MARG - CELL_H - row * (CELL_H + GAP)

        # Reperes de decoupe en coins (pas de cadre : quiet zone du QR).
        c.setLineWidth(0.25)
        c.setStrokeColorRGB(0.80, 0.80, 0.80)
        tick = 1.0 * mm
        for (cx, cy, dx, dy) in [
            (x, y, 1, 1), (x + CELL_W, y, -1, 1),
            (x, y + CELL_H, 1, -1), (x + CELL_W, y + CELL_H, -1, -1),
        ]:
            c.line(cx, cy, cx + dx*tick, cy)
            c.line(cx, cy, cx, cy + dy*tick)

        cx = x + CELL_W/2

        def _baseline(band_bottom, band_h, pt):
            """Ligne de base centrant le bloc capitale+jambage dans la bande.
            Ignorer le jambage faisait descendre les p et les g sous la bande,
            donc au contact du QR."""
            cap  = pt * 0.72 / 2.83465 * mm
            desc = pt * PT_DESC / 2.83465 * mm
            return band_bottom + desc + (band_h - cap - desc) / 2

        def _line(cy_top, text, bold, gap=0):
            """Ligne centree dans une bande LINE commencant en haut a cy_top.
            `gap` reserve un espace en bas de bande, du cote du QR."""
            font = "Helvetica-Bold" if bold else "Helvetica"
            band = LINE - gap
            fitted = _fit_font(text, CELL_W, font, band)
            if not fitted:
                return
            txt, pt = fitted
            c.setFont(font, pt)
            c.setFillColorRGB(0, 0, 0)
            c.drawCentredString(cx, _baseline(cy_top - LINE + gap, band, pt), txt)

        sub  = (f.fila_type or f.material or "").strip()

        top = y + CELL_H

        # Ligne 1 : le numero cale a gauche, la marque a sa suite. Le numero
        # garde une taille fixe (c'est lui qu'on lit pour saisir a la main si le
        # scan echoue) ; seule la marque s'adapte a la place qui reste.
        num_pt = min(PT_MAX, (LINE / mm) * PT_CAP * 2.83465 / 0.72)
        num    = str(f.id)
        num_w  = stringWidth(num, "Helvetica-Bold", num_pt)
        # Ligne de base commune, calee sur la capitale du numero : sinon une
        # marque en police reduite flotterait au-dessus du chiffre.
        base   = _baseline(top - LINE, LINE, num_pt)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", num_pt)
        c.drawString(x, base, num)
        # Marque calee a droite : les deux bouts de la ligne sont ainsi alignes
        # sur les bords de l'etiquette, et l'espace variable retombe au milieu
        # ou il separe justement le numero du texte.
        brand = _fit_font(f.manufacturer or "", CELL_W - num_w - SEP, "Helvetica", LINE)
        if brand:
            b_txt, b_pt = brand
            c.setFont("Helvetica", b_pt)
            c.drawRightString(x + CELL_W, base, b_txt)

        # Ligne 2 : le sous-type, centre, avec une respiration avant le QR.
        _line(top - LINE, sub, False, gap=QGAP)

        # QR pleine largeur, centre verticalement entre les blocs de texte
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=1, border=0,
        )
        qr.add_data(str(f.id))
        qr.make(fit=True)
        matrix = qr.get_matrix()
        n = len(matrix)
        module = QR / n
        c.setFillColorRGB(0, 0, 0)
        qx = x                              # pleine largeur
        qy = y + 2*LINE                     # au-dessus des deux lignes du nom
        for r_i, line in enumerate(matrix):
            for c_i, on in enumerate(line):
                if on:
                    c.rect(qx + c_i*module,
                           qy + QR - (r_i + 1)*module,
                           module, module, stroke=0, fill=1)

        # Sous le QR : le nom, sur une ou deux lignes selon la place. La
        # respiration est prise sur le bloc entier, pas sur chaque ligne, sinon
        # l'interligne se serait creuse pour rien.
        name = (f.translated_name or f.name or "").strip()
        n_top = y + 2*LINE - QGAP
        n_h   = (2*LINE - QGAP) / 2
        fitted = _fit_wrap(name, CELL_W, "Helvetica", n_h, 2)
        if fitted:
            n_lines, n_pt = fitted
            c.setFont("Helvetica", n_pt)
            c.setFillColorRGB(0, 0, 0)
            for li, ln in enumerate(n_lines):
                band_bottom = n_top - (li + 1) * n_h
                c.drawCentredString(cx, _baseline(band_bottom, n_h, n_pt), ln)

    c.showPage()
    c.save()
    buf.seek(0)
    # Generer la planche marque ses filaments « etiquette imprimee » : c'est le
    # geste qui compte, il n'y a rien d'autre a confirmer. Fait ici et non par
    # l'ecran, pour valoir quel que soit le chemin (navigateur, appli Android).
    # Ceux deja marques gardent leur date.
    now = datetime.utcnow()
    await db.execute(
        update(Filament)
        .where(Filament.id.in_([f.id for f in fils]),
               or_(Filament.label_printed.is_(False), Filament.label_printed.is_(None)))
        .values(label_printed=True, label_printed_at=now)
    )
    await db.commit()
    return StreamingResponse(
        buf, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="etiquettes-filaments.pdf"'},
    )


@router.get("/store-links")
async def filament_store_links(_: str = Depends(get_current_user)):
    """Les liens directs de la boutique Bambu (31/10/2026) : par code couleur, la recharge et la bobine de 1 kg ; et le
    code couleur de chaque filament du catalogue. Lu une fois par semaine en fond (bambu_store) : vide la premiere fois."""
    import asyncio as _aio
    from ....services import bambu_store
    data = await _aio.to_thread(bambu_store.load)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Filament.id, Filament.fila_color_code).where(Filament.fila_color_code.isnot(None)))).all()
    codes = data.get("codes") or {}
    return {"codes": codes, "filaments": {str(i): str(c).strip() for i, c in rows if str(c or "").strip() in codes}}


@router.get("/price-review")
async def price_review(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Vue d'audit des prix : chaque filament avec son tarif catalogue et le prix
    d'achat de TOUTES ses bobines, archivees comprises.

    Les archivees sont volontairement incluses : ce sont elles qui portent
    l'historique d'achat, donc la reference pour juger si un tarif catalogue
    est encore juste. Les exclure aurait vide la vue de son interet.

    Une seule requete par table plutot qu'un chargement relationnel : la vue
    embrasse tout le catalogue, et un selectinload par filament aurait fait
    autant d'allers-retours que de lignes.
    """
    fils = (await db.execute(select(Filament))).scalars().all()
    spools = (await db.execute(select(Spool))).scalars().all()

    by_fil: dict[int, list] = {}
    for sp in spools:
        by_fil.setdefault(sp.filament_id, []).append(sp)

    out = []
    for f in fils:
        sps = by_fil.get(f.id, [])
        out.append({
            "id": f.id,
            "name": f.translated_name or f.name,
            "manufacturer": f.manufacturer,
            "fila_type": f.fila_type or f.material,
            "color": f.color,
            "colors_array": f.colors_array,
            "multicolor_type": f.multicolor_type,
            # None = jamais renseigne, 0 = renseigne a zero. La distinction est
            # le coeur de cette vue : on cherche les prix MANQUANTS, pas les
            # prix nuls, qui peuvent etre volontaires.
            "price": f.price,
            "weight_g": f.filament_weight_g,
            "spools": [
                {"id": sp.id, "price": sp.price_override, "archived": bool(sp.archived),
                 "remaining_weight_g": sp.remaining_weight_g,
                 "location": sp.location}
                for sp in sorted(sps, key=lambda x: (x.archived, -(x.id or 0)))
            ],
        })
    out.sort(key=lambda x: (x["manufacturer"] or "", x["name"] or ""))
    return out


class SpoolTare(BaseModel):
    spool_weight_g: float   # poids du support vide, en grammes
    tare_name: Optional[str] = None   # modele choisi ; absent / vide = « Autre »


@router.put("/filaments/{fid}/spool-weight")
async def set_spool_tare(
    fid: int,
    body: SpoolTare,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Pose le seul poids du support vide d'un filament (corrige depuis une pesee).

    Route a part : le PATCH du filament recoit la fiche ENTIERE (ses champs
    absents reprendraient leur valeur par defaut), il ne sert pas a un champ.
    """
    if body.spool_weight_g < 0 or body.spool_weight_g > 5000:
        raise HTTPException(400, "Poids du support invalide")
    f = await db.get(Filament, fid)
    if not f:
        raise HTTPException(404, "Filament introuvable")
    f.spool_weight_g = round(body.spool_weight_g, 1)
    f.spool_tare_name = (body.tare_name or "").strip() or None
    await db.commit()
    _clear_match_cache()
    return {"ok": True, "spool_weight_g": f.spool_weight_g, "spool_tare_name": f.spool_tare_name}


# Les seuils du stock par filament (28/10/2026), en % d'une bobine pleine : « a commander » en dessous du premier,
# « bientot » en dessous du second. Un reglage de la maison (cle STOCK_THRESHOLDS), le meme sur tous les appareils.
_THR_DEF = {"order": 30, "soon": 100}


async def _thresholds(db) -> dict:
    import json as _j
    from ....services.settings_service import get_setting
    try:
        v = _j.loads(await get_setting(db, "STOCK_THRESHOLDS", "") or "{}")
    except ValueError:
        v = {}
    out = {k: int(v.get(k, d)) if str(v.get(k, d)).isdigit() else d for k, d in _THR_DEF.items()}
    return out


@router.get("/stock-thresholds")
async def get_stock_thresholds(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    return await _thresholds(db)


@router.put("/stock-thresholds")
async def set_stock_thresholds(body: dict = Body({}), db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    import json as _j
    from ....services.settings_service import set_setting
    try:
        order, soon = int(body.get("order")), int(body.get("soon"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Seuils invalides")
    if not (0 <= order <= 500 and 0 <= soon <= 1000):
        raise HTTPException(400, "Seuils hors limites")
    soon = max(soon, order)                    # « bientot » ne peut pas etre plus bas que « a commander »
    await set_setting(db, "STOCK_THRESHOLDS", _j.dumps({"order": order, "soon": soon}))
    await db.commit()
    return {"order": order, "soon": soon}


@router.put("/filaments/{fid}/no-reorder")
async def set_no_reorder(fid: int, body: dict = Body({}), db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """Un filament qu'on ne recommandera plus (28/10/2026) : il sort du stock « a prevoir » de la tuile Stock.
    Route a part, pour la meme raison que le poids du support (le PATCH recoit la fiche entiere)."""
    f = await db.get(Filament, fid)
    if not f:
        raise HTTPException(404, "Filament introuvable")
    f.no_reorder = bool(body.get("on"))
    await db.commit()
    return {"ok": True, "no_reorder": f.no_reorder}


@router.post("/filaments/{fid}/mark-swatch", response_model=FilamentOut)
async def mark_swatch(
    fid: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Marque le filament comme ayant un echantillon imprime (swatch=True).

    Appele par le front juste avant d'ouvrir la fiche depuis un scan de QR
    d'echantillon : si tu tiens l'echantillon en main, c'est qu'il existe. La
    case doit donc etre deja cochee quand la fiche s'affiche.

    Un POST distinct plutot que d'ecrire dans le GET de la fiche : une lecture
    ne doit jamais avoir d'effet de bord. Le meme QR ouvert depuis un
    historique de navigateur, un apercu de lien ou un prefetch ne doit pas
    cocher la case toute seule -- seul le scan, qui passe par ce POST, le fait.

    Idempotent : si la case est deja cochee, on ne réécrit rien.
    """
    f = await db.get(Filament, fid)
    if not f:
        raise HTTPException(404, "Filament introuvable")
    changed = False
    if not f.swatch:
        f.swatch = True
        changed = True
    # Scanner le QR prouve aussi que l'etiquette existe.
    if not f.label_printed:
        f.label_printed, f.label_printed_at = True, datetime.utcnow()
        changed = True
    if changed:
        await db.commit()
    stmt = (select(Filament).options(selectinload(Filament.spools))
            .where(Filament.id == fid))
    return _fil_out((await db.execute(stmt)).scalar_one())


@router.post("/filaments/labels/mark")
async def mark_labels_printed(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Marque les etiquettes de ces filaments comme imprimees, apres confirmation
    a l'ecran : generer le PDF ne veut pas dire que la planche est sortie de
    l'imprimante. body: {ids: [..]}. Ceux deja marques gardent leur date.
    """
    ids = [i for i in (body.get("ids") or []) if isinstance(i, int) and not isinstance(i, bool)]
    if not ids:
        raise HTTPException(422, "ids requis")
    now = datetime.utcnow()
    res = await db.execute(
        update(Filament)
        .where(Filament.id.in_(ids), or_(Filament.label_printed.is_(False), Filament.label_printed.is_(None)))
        .values(label_printed=True, label_printed_at=now)
    )
    await db.commit()
    return {"ok": True, "marked": res.rowcount or 0}


# ── Les commandes Bambu Lab a venir (lues dans les mails, 28/10/2026) ──
@router.get("/incoming")
async def filaments_incoming(all: bool = Query(False), _: str = Depends(get_current_user)):
    from ....services import mail_orders as MO
    # all : l'historique (Parametres -> Connexions), commandes finies et cachees comprises
    return {"orders": await MO.incoming(include_done=all, include_hidden=all)}


@router.post("/incoming/{order_id}/create")
async def filaments_incoming_create(order_id: int, body: dict = Body(default={}), _: str = Depends(require_admin)):
    """Cree la fiche filament (si elle manque) et les bobines « en commande » d'une ligne (index), ou de toutes
    les lignes encore attendues (sans index)."""
    from ....services import mail_orders as MO
    out = await MO.create_spools(order_id, (body or {}).get("index"))
    if out is None:
        raise HTTPException(404, "Commande inconnue")
    _clear_match_cache()
    return out


@router.get("/incoming/{order_id}")
async def filaments_incoming_one(order_id: int, _: str = Depends(get_current_user)):
    from ....services import mail_orders as MO
    o = await MO.one(order_id)
    if o is None:
        raise HTTPException(404, "Commande inconnue")
    return o


@router.post("/incoming/{order_id}/mark")
async def filaments_incoming_mark(order_id: int, body: dict = Body(default={}), _: str = Depends(require_admin)):
    """Coche ou decoche une ligne (index, received), confirme les lignes presumees (confirm), ou cache la commande (hide)."""
    from ....services import mail_orders as MO
    b = body or {}
    out = await MO.mark(order_id, b.get("index"), bool(b.get("received", True)), b.get("hide"), bool(b.get("confirm")),
                        b.get("spread") if isinstance(b.get("spread"), dict) else None)
    if out is None:
        raise HTTPException(404, "Commande inconnue")
    return {"orders": out, "order": next((o for o in out if o["id"] == order_id), None)}


@router.get("/filaments/print-counts")
async def filament_print_counts(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Nombre d'impressions par filament : prints ayant utilise une bobine de ce
    filament, archivee ou non. {filament_id: n}. Declaree AVANT
    /filaments/{fid}, sinon « print-counts » serait pris pour un identifiant.
    """
    from ....models.print_history import FilamentUsage as _FU
    rows = (await db.execute(
        select(Spool.filament_id, func.count(func.distinct(_FU.print_id)))
        .join(_FU, _FU.spool_id == Spool.id)
        .group_by(Spool.filament_id)
    )).all()
    return {str(fid): n for fid, n in rows if fid is not None}


def _facts_for(source: str = "", ref: str = "", fila_id: str = "", code: str = "", brand: str = "", names=(),
               fila_type: str = "", family: str = "", hex_: str = "") -> dict:
    """Les faits des catalogues pour une entree (ou un filament) : profil Bambu Studio, boutique, entree « autres
    marques », echantillon FilamentColors ; et les echantillons trouves."""
    from ....services import catalog_facts as CF, fc_catalog, bambu_profiles
    view = _other_entry(ref, source) if source in ("ofd", "own", "fc") and ref else None
    bambu = bool(fila_id) or "bambu" in (brand or "").lower()
    if view and not names:
        names = (view.get("name"),)
    measured = []
    if view and view.get("source") == "fc" and view.get("fc"):
        measured = [{**view["fc"], "how": "nom", "score": 0, "url": view.get("url")}]
    else:
        measured = fc_catalog.matches(brand or ("Bambu Lab" if bambu else ""), list(names), fila_type, family, hex_)
    # le profil Bambu et l'entree du catalogue passent avant l'echantillon (ses temperatures sont celles du type)
    facts = CF.merge(CF.from_profile(bambu_profiles.of(fila_id)) if bambu else [], CF.from_view(view),
                     CF.from_fc(measured[0] if measured and measured[0].get("how") == "nom" else None),
                     CF.from_store(code) if bambu else [])
    if bambu:                                   # un Bambu se rachete a la boutique Bambu d'ici, pas a celle de l'echantillon
        facts = [x for x in facts if x["k"] != "buy_fc"]
    return {"facts": facts, "measured": measured, "sources": CF.SRC}


@router.get("/catalog/facts")
async def catalog_facts(source: str = "", ref: str = "", fila_id: str = "", code: str = "", brand: str = "", name: str = "",
                        fila_type: str = "", family: str = "", hex: str = "", _: str = Depends(get_current_user)):
    """Les faits d'une entree des catalogues (05/11/2026), pour le navigateur des catalogues."""
    import asyncio as _aio
    return await _aio.to_thread(_facts_for, source, ref, fila_id, code, brand, (name,) if name else (), fila_type, family, hex)


@router.get("/catalog/sources")
async def catalog_sources(_: str = Depends(get_current_user)):
    """Chaque catalogue et ce qu'il contient (05/11/2026), pour le navigateur par source."""
    from ....services import ofd_catalog, own_catalog, fc_catalog, bambu_profiles
    from ....services.bambu_catalog import catalog_entries
    raw, _n = catalog_entries()
    oi = ofd_catalog.index() or {}
    return {"sources": [
        {"id": "bambu", "name": "Nuancier Bambu", "sub": "Bambu Studio : codes couleur, noms, couleurs", "count": len(raw or []), "c": "#0EA5E9"},
        {"id": "profiles", "name": "Profils Bambu Studio", "sub": "Températures, densité, séchage de chaque filament Bambu", "count": len(bambu_profiles.profiles()), "c": "#0284C7"},
        {"id": "own", "name": "Notre catalogue", "sub": "Les couleurs qu'aucun autre n'a", "count": len(own_catalog.items()), "c": "#F59E0B"},
        {"id": "ofd", "name": "Open Filament Database", "sub": "Les autres marques : couleurs, tailles, liens d'achat", "count": len(oi.get("entries") or []), "c": "#8B5CF6"},
        {"id": "fc", "name": "FilamentColors", "sub": "Échantillons imprimés et mesurés : couleur, TD", "count": fc_catalog.status()["count"], "c": "#14B8A6"},
    ]}


@router.get("/catalog/profiles")
async def catalog_profiles(q: str = "", _: str = Depends(get_current_user)):
    """Les profils Bambu Studio des filaments Bambu (05/11/2026) : un par filament, avec sa fiche."""
    from ....services import bambu_profiles, catalog_facts as CF
    ql = (q or "").strip().casefold()
    out = []
    for pid, p in sorted(bambu_profiles.profiles().items(), key=lambda kv: kv[1].get("name", "")):
        if ql and ql not in f"{pid} {p.get('name')} {p.get('filament_type')}".casefold():
            continue
        out.append({"id": pid, "name": p.get("name"), "type": p.get("filament_type"), "facts": CF.from_profile(p)})
    return {"available": bool(out) or not ql, "entries": out}


@router.get("/catalog/fc/brands")
async def fc_brands(_: str = Depends(get_current_user)):
    from ....services import fc_catalog
    st = fc_catalog.status()
    return {"available": st["available"], "count": st["count"], "brands": fc_catalog.all_brands()}


@router.get("/catalog/fc/search")
async def fc_search(brand: str = "", q: str = "", _: str = Depends(get_current_user)):
    from ....services import fc_catalog
    return fc_catalog.browse(brand, q)


@router.get("/filaments/{fid}/sources")
async def filament_sources(fid: int, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """Ce que les catalogues savent de ce filament (05/11/2026) : sa fiche des catalogues, chaque fait avec sa source."""
    import asyncio as _aio
    f = await db.get(Filament, fid)
    if not f:
        raise HTTPException(404, "Filament introuvable")
    src, _s, ref = str(f.catalog_ref or "").partition(":")
    bambu = "bambu" in (f.manufacturer or "").lower() or (bool(f.profile_id) and not f.catalog_ref)
    return await _aio.to_thread(_facts_for, src if ref else "", ref, f.profile_id if bambu else "", f.fila_color_code or "",
                                f.manufacturer or ("Bambu Lab" if bambu else ""), (f.name_en, f.name, f.translated_name),
                                f.fila_type or "", f.material or "", f.color or "")


@router.get("/filaments/{fid}/measured")
async def filament_measured(fid: int, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """Sa couleur mesuree (05/11/2026, FilamentColors.xyz) : les echantillons de ce filament (meme marque, meme nom de
    couleur, le type departage ; a defaut une teinte tres proche, pour info), avec hex mesure, transparence (TD), photo."""
    from ....services import fc_catalog
    f = await db.get(Filament, fid)
    if not f:
        raise HTTPException(404, "Filament introuvable")
    st = fc_catalog.status()
    if not st["available"]:
        return {"available": False, "matches": []}
    names = [f.name_en, f.name, f.translated_name]
    return {"available": True, "count": st["count"], "current": f.color,
            "matches": fc_catalog.matches(f.manufacturer or ("Bambu Lab" if f.profile_id else ""), names, f.fila_type or "",
                                          f.material or "", f.color or "")}


@router.get("/filaments/{fid}/prints")
async def filament_prints(
    fid: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Les impressions qui ont utilise une bobine de ce filament (archivee ou non) :
    la galerie qu'ouvre l'onglet Photos. Pour chacune, ses photos prises
    (snapshots « manual », couverture d'abord) ; a defaut celles de son GROUPE
    (photos prises de tous ses prints et images deposees dans son dossier, la
    couverture du groupe d'abord), meme regle que la galerie des prints ; a
    defaut l'image du plateau. Celles qui ont une photo passent en tete, puis
    les plus recentes.
    """
    from ....models.print_history import Print as _P, FilamentUsage as _FU, PrintSnapshot as _PS
    f = await db.get(Filament, fid)
    if not f:
        raise HTTPException(404, "Filament introuvable")
    usages = (await db.execute(
        select(_FU.print_id, func.sum(_FU.grams_used))
        .join(Spool, Spool.id == _FU.spool_id)
        .where(Spool.filament_id == fid)
        .group_by(_FU.print_id)
    )).all()
    grams = {pid: float(g or 0) for pid, g in usages}
    if not grams:
        return {"prints": []}
    prints = (await db.execute(
        select(_P).options(selectinload(_P.snapshots), selectinload(_P.group))
        .where(_P.id.in_(list(grams)))
        .order_by(_P.print_date.desc())
    )).scalars().all()
    return await gallery_items(db, prints, grams)


async def gallery_items(db, prints, grams: dict) -> dict:
    """Impressions et leurs photos, au format de la galerie d'un filament :
    photos prises du print, a defaut celles de son groupe, a defaut l'image du
    plateau ; avec photo d'abord. Sert aussi aux impressions d'un modele."""
    from ....models.print_history import Print as _P, PrintSnapshot as _PS

    def own_photos(p):
        names = [(s.file_path or "").split("/")[-1] for s in (p.snapshots or [])
                 if s.trigger == "manual" and s.file_path]
        if p.cover_photo in names:
            names.sort(key=lambda n: n != p.cover_photo)
        return [(n, f"/api/v1/prints/{p.id}/file/{n}") for n in names]

    # Photos des groupes concernes, lues une fois par groupe.
    gids = {p.group_id for p in prints if p.group_id}
    group_photos = {}
    if gids:
        snaps = (await db.execute(
            select(_P.group_id, _PS.print_id, _PS.file_path)
            .join(_PS, _PS.print_id == _P.id)
            .where(_P.group_id.in_(list(gids)), _PS.trigger == "manual")
        )).all()
        for gid, pid, path in snaps:
            if path:
                n = path.split("/")[-1]
                group_photos.setdefault(gid, []).append((n, f"/api/v1/prints/{pid}/file/{n}"))
        for gid in gids:
            d = DATA_DIR / "groups" / str(gid)
            if d.is_dir():
                for fp in sorted(d.iterdir()):
                    if fp.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                        group_photos.setdefault(gid, []).append(
                            (fp.name, f"/api/v1/prints/groups/{gid}/photo/{fp.name}"))
    for p in prints:
        if p.group and p.group.cover_photo and p.group_id in group_photos:
            group_photos[p.group_id].sort(key=lambda t: t[0] != p.group.cover_photo)

    out = []
    for p in prints:
        photos, source = own_photos(p), "print"
        if not photos and p.group_id in group_photos:
            photos, source = group_photos[p.group_id], "group"
        out.append({
            "id": p.id,
            "name": p.translated_name or p.file_name or f"Impression #{p.id}",
            "status": p.status,
            "print_date": p.print_date.isoformat() if p.print_date else None,
            "grams": round(grams.get(p.id, 0), 1),
            "group_id": p.group_id,
            "group_name": p.group.name if p.group else None,
            "photos": [url for _, url in photos],
            "photo_source": source if photos else None,
            "image": f"/api/v1/prints/{p.id}/image",
        })
    # Avec photo d'abord (sort stable : chaque moitie garde l'ordre des dates).
    out.sort(key=lambda it: not it["photos"])
    # Les groupes concernes, pour que l'ecran reunisse en UNE vignette les
    # prints d'un meme groupe et ouvre la fiche du groupe.
    groups = {}
    for p in prints:
        if p.group and p.group_id not in groups:
            groups[p.group_id] = {
                "id": p.group_id,
                "name": p.group.name,
                "number_of_items": p.group.number_of_items or 1,
                "cover_print_id": p.group.cover_print_id,
                "photos": [url for _, url in group_photos.get(p.group_id, [])],
            }
    return {"prints": out, "groups": list(groups.values())}


@router.get("/filaments/{fid}", response_model=FilamentOut)
async def get_filament(
    fid: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Fiche filament par ID — permet un lien direct (QR code sur un swatch, etc.)."""
    # selectinload obligatoire : _fil_out lit f.spools, et un lazy load
    # relationnel leverait MissingGreenlet en async.
    stmt = (select(Filament)
            .options(selectinload(Filament.spools))
            .where(Filament.id == fid))
    f = (await db.execute(stmt)).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Filament introuvable")
    return _fil_out(f)


@router.post("/filaments", response_model=FilamentOut, status_code=201)
async def create_filament(
    body: FilamentCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    # Déduplication : si un filament avec le même profile_id ET la même couleur existe déjà, on le retourne
    if body.profile_id and body.color:
        color_norm = body.color.lower().lstrip("#")[:8]
        existing = (await db.execute(
            select(Filament).options(selectinload(Filament.spools))
            .where(Filament.profile_id == body.profile_id)
        )).scalars().all()
        for candidate in existing:
            if (candidate.color or "").lower()[:8] == color_norm or (candidate.color or "").lower()[:6] == color_norm[:6]:
                raise HTTPException(409, detail={
                    "code": "DUPLICATE_FILAMENT",
                    "message": f"Un filament identique existe déjà : #{candidate.id} « {candidate.name} »",
                    "existing_id": candidate.id,
                    "existing_name": candidate.name,
                })

    f = Filament(**body.model_dump(exclude={"label_printed"}))
    f.spool_tare_name = (f.spool_tare_name or "").strip() or None
    g = (f.glow_color or "").strip().lstrip("#")[:6].upper()
    f.glow_color = g if len(g) == 6 and all(x in "0123456789ABCDEF" for x in g) else None
    if body.label_printed:
        f.label_printed, f.label_printed_at = True, datetime.utcnow()
    f.color_bucket = buckets_for(f.color, f.colors_array)
    # sans poids de support : celui de sa marque (Parametres ; Bambu Lab 250 g cree s'il manque, 02/11/2026) ; un poids
    # venu du catalogue des autres marques, sans support choisi : le support de la marque a ce poids, cree s'il manque
    from ....services import spool_tare
    if f.catalog_ref and f.manufacturer:
        f.manufacturer = await _brand_spelling(db, f.manufacturer)
    # venu d'un catalogue (Bambu ou autres marques) : la matiere est la famille (PLA), la gamme reste dans fila_type,
    # comme apres une synchro (02/11/2026 : « 95A High Speed TPU » restait en matiere jusqu'a la synchro)
    # la matiere est toujours la famille (03/11/2026 : aussi en saisie libre, ou l'ecran envoyait le sous-type)
    f.material = family_of(f.fila_type, None) or family_of(f.material, None) or f.material or "PLA"
    await spool_tare.settle(db, f)
    db.add(f)
    await db.commit()
    await db.refresh(f)
    result = (await db.execute(
        select(Filament).options(selectinload(Filament.spools)).where(Filament.id == f.id)
    )).scalar_one()
    return _fil_out(result)


@router.patch("/filaments/{fid}", response_model=FilamentOut)
async def update_filament(
    fid: int,
    body: FilamentCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    result = await db.execute(
        select(Filament).options(selectinload(Filament.spools)).where(Filament.id == fid)
    )
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Filament introuvable")
    payload = body.model_dump(exclude_none=True)
    # exclude_none reste la regle pour ce formulaire, qui envoie TOUS ses champs
    # a chaque enregistrement : basculer en exclude_unset viderait tout ce qui
    # est vide a l'ecran. Mais le prix doit pouvoir etre EFFACE depuis la vue de
    # revision, ou "aucun prix" et "prix a zero" sont deux etats distincts. On
    # rattrape donc le seul cas d'un null explicitement transmis.
    raw = body.model_dump(exclude_unset=True)
    if "price" in raw and raw["price"] is None:
        payload["price"] = None
    # la fiche technique (05/11/2026) : un champ vide a l'ecran s'efface
    for k in ("density", "nozzle_min", "nozzle_max", "bed_min", "bed_max", "dry_temp", "dry_hours", "td", "gtin", "buy_url",):
        if k in raw and raw[k] is None:
            payload[k] = None
    # Idem pour colors_array : repasser en monochrome doit EFFACER le colors_array,
    # sinon un ancien residu masque la nouvelle couleur (parseColorsList le prefere).
    if "colors_array" in raw and raw["colors_array"] is None:
        payload["colors_array"] = None
    if "fila_finish" in payload:
        payload["fila_finish"] = (payload["fila_finish"] or "").strip() or None
    if "glow_color" in payload:
        g = (payload["glow_color"] or "").strip().lstrip("#")[:6].upper()
        payload["glow_color"] = g if len(g) == 6 and all(x in "0123456789ABCDEF" for x in g) else None

    if "spool_tare_name" in payload:
        payload["spool_tare_name"] = payload["spool_tare_name"].strip() or None

    changed_price = "price" in payload
    # L'etiquette porte une date : posee au passage a « imprimee », retiree
    # avec elle.
    lp = payload.pop("label_printed", None)
    if lp is not None and bool(lp) != bool(f.label_printed):
        f.label_printed = bool(lp)
        f.label_printed_at = datetime.utcnow() if lp else None
    was_to_order = bool(f.to_order)
    old_material = f.material
    for k, v in payload.items():
        setattr(f, k, v)
    # la matiere est la famille (PLA), le sous-type reste dans fila_type (03/11/2026 : la fiche envoyait le sous-type
    # en matiere) ; un sous-type qui ne dit pas sa famille garde l'ancienne
    if "fila_type" in payload or "material" in payload:
        f.material = family_of(f.fila_type, None) or family_of(payload.get("material"), None) or old_material or "PLA"
    if "color" in payload or "colors_array" in payload:
        f.color_bucket = buckets_for(f.color, f.colors_array)
    # une marque donnee apres coup : son support, si aucun poids n'a ete saisi (un poids vide expres reste vide)
    from ....services import spool_tare
    if "manufacturer" in payload and "spool_weight_g" not in payload:
        await spool_tare.fill(db, f)
    if {"manufacturer", "spool_weight_g", "spool_tare_name"} & set(payload):
        await spool_tare.link_weight(db, f)            # un poids saisi en « Autre » : rangé dans les Paramètres
    await db.commit()
    _clear_match_cache()
    if f.to_order and not was_to_order:
        from ....services import notify_events
        notify_events._spawn(notify_events.fil_to_order, f.id)
    if changed_price:
        # Recalculer tous les prints qui utilisent une bobine de ce filament
        _bg_recalc_by_filament(fid)
    return _fil_out(f)


# ── Spools (Bobines) ──────────────────────────────────────────────────────────

@router.get("/drying/overview")
async def drying_overview(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """
    Etat des lieux du sechage des bobines actives (Stats > Sechage) : age du
    dernier sechage, delai applicable (defaut ou regle de famille / sous-
    famille), temps restant avant d'etre « a secher ». Meme regle que
    l'alerte, l'AMS et la fiche bobine.
    """
    from ....services import drying
    await drying.load(db)
    now = datetime.utcnow()
    soon_days = 30
    rows = (await db.execute(
        select(Spool).options(selectinload(Spool.filament)).where(Spool.archived.is_(False))
    )).scalars().all()

    spools, fam = [], {}
    buckets = [["< 1 mois", 0], ["1–3 mois", 0], ["3–6 mois", 0], ["6–12 mois", 0], ["> 12 mois", 0], ["Jamais", 0]]
    for s in rows:
        f = s.filament
        ref = drying.dry_reference(s)
        limit = drying.days_for(f)
        age = (now - ref).days if ref else None
        remaining = (limit - age) if ref else None
        if age is None:
            buckets[5][1] += 1
        else:
            buckets[0 if age < 30 else 1 if age < 90 else 2 if age < 180 else 3 if age < 365 else 4][1] += 1
        family = ((f.material if f else None) or "?").strip() or "?"
        fe = fam.setdefault(family, {"family": family, "count": 0, "to_dry": 0, "ages": []})
        fe["count"] += 1
        if remaining is None or remaining < 0:
            fe["to_dry"] += 1
        if age is not None:
            fe["ages"].append(age)
        spools.append({
            "id": s.id, "filament_id": s.filament_id,
            "name": (f.translated_name or f.name) if f else f"Bobine #{s.id}",
            "brand": f.manufacturer if f else None,
            "fila_type": (f.fila_type or f.material) if f else None,
            "color": f.color if f else None,
            "colors_array": f.colors_array if f else None,
            "multicolor_type": f.multicolor_type if f else None,
            "fila_finish": f.fila_finish if f else None,
            "location": s.location,
            "remaining_weight_g": s.remaining_weight_g,
            "last_dried_at": ref.isoformat() if ref else None,
            "age_days": age, "limit_days": limit, "remaining_days": remaining,
        })

    # jamais sechees d'abord, puis la plus en retard, puis la plus proche du delai
    spools.sort(key=lambda x: (x["remaining_days"] is not None, x["remaining_days"] or 0))
    to_dry = [x for x in spools if x["remaining_days"] is None or x["remaining_days"] < 0]
    soon = [x for x in spools if x["remaining_days"] is not None and 0 <= x["remaining_days"] <= soon_days]
    families = sorted((
        {"family": v["family"], "count": v["count"], "to_dry": v["to_dry"],
         "avg_age_days": round(sum(v["ages"]) / len(v["ages"])) if v["ages"] else None}
        for v in fam.values()), key=lambda v: (-v["to_dry"], -v["count"]))
    in_ams = lambda x: (x["location"] or "").upper().startswith("AMS")

    # Sechages des 12 derniers mois (date du DERNIER sechage de chaque bobine :
    # pas d'historique complet, c'est l'activite recente qui se lit ici).
    months = []
    y, m = now.year, now.month
    for _ in range(12):
        months.append((y, m)); m -= 1
        if m == 0: y, m = y - 1, 12
    months.reverse()
    per = {k: 0 for k in months}
    for s in rows:
        ref = drying.dry_reference(s)
        if ref and (ref.year, ref.month) in per:
            per[(ref.year, ref.month)] += 1
    ages = [x["age_days"] for x in spools if x["age_days"] is not None]
    lim = {}
    for x in spools:
        lim[x["limit_days"]] = lim.get(x["limit_days"], 0) + 1
    def loc_stats(pred):
        sel = [x for x in spools if pred(x)]
        return {"total": len(sel), "to_dry": sum(1 for x in sel if x in to_dry)}
    return {
        "dried_by_month": [{"name": f"{m:02d}/{str(y)[2:]}", "value": per[(y, m)]} for y, m in months],
        "avg_age_days": round(sum(ages) / len(ages)) if ages else None,
        "oldest_age_days": max(ages) if ages else None,
        "to_dry_weight_g": round(sum((x["remaining_weight_g"] or 0) for x in to_dry)),
        "by_location": {"ams": loc_stats(in_ams), "stored": loc_stats(lambda x: not in_ams(x))},
        "limits": [{"days": d, "count": c} for d, c in sorted(lim.items())],
        "default_days": drying.current()["default_days"], "soon_days": soon_days,
        "kpis": {
            "active": len(spools),
            "to_dry": len(to_dry),
            "never": sum(1 for x in spools if x["age_days"] is None),
            "soon": len(soon),
            "ok": len(spools) - len(to_dry) - len(soon),
            "to_dry_in_ams": sum(1 for x in to_dry if in_ams(x)),
        },
        "buckets": [{"label": l, "count": c} for l, c in buckets],
        "families": families,
        "to_dry": to_dry,
        "soon": soon,
    }


@router.get("/catalog-names")
async def catalog_names(_: str = Depends(get_current_user)):
    """Nos correspondances de noms (02/11/2026) : un nom anglais du catalogue Bambu -> notre nom francais ; les quelques
    noms que l'appli connait deja (dernier recours avant l'anglais) ; et pour chacun, ce qu'en dit le catalogue (son nom
    francais s'il en a un, les filaments qui portent ce nom). names : tous les noms anglais du catalogue, pour en
    proposer un a la saisie."""
    import json
    from ....db.session import AsyncSessionLocal
    from ....services import bambu_catalog as BC
    from ....services.settings_service import get_setting
    async with AsyncSessionLocal() as db:
        try:
            items = json.loads(await get_setting(db, BC.K_NAMES, "") or "[]")
        except ValueError:
            items = []
    items = items if isinstance(items, list) else []
    data, en_to_fr = BC.catalog_entries()
    TYPE_FR = {"单色": "", "渐变色": "dégradé", "多拼色": "multicolore"}
    cat: dict = {}
    for e in data or []:
        n = e.get("fila_color_name") or {}
        en = (n.get("en") or "").strip()
        if not en:
            continue
        c = cat.setdefault(en.casefold(), {"en": en, "fr": "", "refs": []})
        if n.get("fr") and not c["fr"]:
            c["fr"] = n["fr"]
        if len(c["refs"]) < 8:
            c["refs"].append({"fila_id": e.get("fila_id", ""), "code": e.get("color_code", ""), "type": e.get("fila_type", ""),
                              "kind": TYPE_FR.get(e.get("fila_color_type", ""), ""),
                              "colors": [x.lstrip("#")[:6] for x in (e.get("fila_color") or [])][:4]})
    info = lambda en: cat.get((en or "").strip().casefold()) or {"en": en, "fr": "", "refs": []}   # noqa: E731
    ours = {str(it.get("en") or "").strip().casefold() for it in items}
    rows = [{"en": it.get("en", ""), "fr": it.get("fr", ""), "source": "nous", "catalog": info(it.get("en"))} for it in items]
    rows += [{"en": en, "fr": fr, "source": "appli", "catalog": info(en)} for en, fr in BC.FR_MISSING.items() if en.casefold() not in ours]
    return {"items": items, "rows": rows,
            "names": sorted(({"en": c["en"], "fr": c["fr"]} for c in cat.values()), key=lambda x: x["en"].casefold()),
            "builtin": [{"en": en, "fr": fr} for en, fr in BC.FR_MISSING.items()]}


@router.put("/catalog-names")
async def catalog_names_save(body: dict = Body({}), _: str = Depends(require_admin)):
    from ....services import bambu_catalog as BC
    items = await BC.save_names(body.get("items") or [])
    _clear_match_cache()
    return {"items": items}


@router.get("/spools", response_model=list[SpoolOut])
async def list_spools(
    archived: bool = Query(False),
    filament_id: Optional[int] = Query(None),
    location: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    manufacturer: Optional[str] = Query(None),
    material: Optional[str] = Query(None),
    fila_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    needs_join = bool(q or manufacturer or material or fila_type)
    stmt = (
        select(Spool)
        .options(selectinload(Spool.filament))
        .where(Spool.archived == archived)
    )
    if filament_id:
        stmt = stmt.where(Spool.filament_id == filament_id)
    if location:
        stmt = stmt.where(Spool.location == location)
    if needs_join:
        stmt = stmt.join(Filament)
    if q:
        q_clean  = q.lstrip("#")
        like     = f"%{q}%"
        like_hex = f"%{q_clean}%"
        stmt = stmt.where(or_(
            Filament.name.ilike(like),
            Filament.translated_name.ilike(like),
            Filament.manufacturer.ilike(like),
            Filament.material.ilike(like),
            Filament.fila_type.ilike(like),
            Filament.fila_color_code.ilike(like),
            Filament.color.ilike(like_hex),
            Spool.location.ilike(like),
            Spool.tag_number.ilike(like),
        ))
    if manufacturer:
        stmt = stmt.where(Filament.manufacturer == manufacturer)
    if material:
        # material = famille (PLA, PETG…) → cherche dans fila_type qui commence par material
        stmt = stmt.where(or_(
            Filament.material == material,
            Filament.fila_type.ilike(f"{material}%"),
        ))
    if fila_type:
        stmt = stmt.where(Filament.fila_type == fila_type)
    stmt = stmt.order_by(Spool.last_used_at.desc().nullslast())
    result = await db.execute(stmt)
    rows = result.scalars().all()
    sibs = await _siblings_map(db, [r.filament_id for r in rows])
    return [_spool_out(r, sibs.get(r.filament_id)) for r in rows]


@router.post("/filaments/clear-swatches")
async def clear_all_swatches(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Action ponctuelle d'aide : decoche l'echantillon (swatch=False) sur TOUS les
    filaments, sans rien toucher d'autre (ni photos, ni autres champs). Renvoie le
    nombre de filaments concernes (ceux qui etaient coches).
    """
    # Compter d'abord ceux qui etaient coches, pour un retour utile.
    n = (await db.execute(
        select(func.count()).select_from(Filament).where(Filament.swatch.is_(True))
    )).scalar_one()
    await db.execute(update(Filament).values(swatch=False))
    await db.commit()
    return {"ok": True, "cleared": int(n or 0)}


@router.post("/spools", response_model=SpoolOut, status_code=201)
async def create_spool(
    body: SpoolCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    # Vérifier que le filament existe
    fil = await db.get(Filament, body.filament_id)
    if not fil:
        raise HTTPException(404, "Filament introuvable")
    data = body.model_dump()
    # location est gere automatiquement (Tiroir / AMS xxx) par le worker
    # spool_location ; l'utilisateur n'y touche pas. Defaut "Tiroir" a la creation.
    if not data.get("location"):
        data["location"] = "Tiroir"
    # Une bobine neuve arrive seche (sous vide) : son ajout vaut sechage, sinon
    # elle partirait aussitot dans l'alerte « a secher ».
    data["last_dried_at"] = datetime.utcnow()
    # une bobine de ce filament etait « en commande » (creee depuis une commande lue dans les mails) : c'est
    # elle qui arrive, on la complete au lieu d'en creer une seconde (28/10/2026)
    s = (await db.execute(select(Spool).where(Spool.filament_id == fil.id, Spool.ordered.is_(True), Spool.archived.is_(False))
                          .order_by(Spool.id))).scalars().first()
    if s is not None:
        for k, v in data.items():
            if v is not None or k in ("tag_number",):
                setattr(s, k, v)
        s.ordered = False
    else:
        s = Spool(**data)
        db.add(s)

    # Ajouter une bobine physique avec son tag NFC signifie qu'on la possede :
    # le filament n'est donc plus a commander. On ne le fait QUE si un tag est
    # renseigne -- creer une fiche vide, sans tag, ne prouve pas la possession
    # et pourrait meme etre le geste par lequel on prepare une commande.
    if (data.get("tag_number") or "").strip() and fil.to_order:
        fil.to_order = False

    await db.commit()
    await db.refresh(s)
    _clear_match_cache()
    # une bobine de ce filament etait attendue d'une commande (mails) : elle est arrivee
    try:
        from ....services import mail_orders as _MO
        await _MO.spool_arrived(fil)
    except Exception:
        pass
    return _spool_out(await _load_spool(db, s.id))


@router.get("/spools/{sid}", response_model=SpoolOut)
async def get_spool(sid: int, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """Une bobine seule (28/10/2026) : ouvrir une bobine depuis un scan, l'AMS ou une alerte telechargeait
    deux listes completes pour la retrouver."""
    s = await _load_spool(db, sid)
    if not s:
        raise HTTPException(404, "Bobine introuvable")
    sibs = await _siblings_map(db, [s.filament_id])
    return _spool_out(s, sibs.get(s.filament_id))


@router.patch("/spools/{sid}", response_model=SpoolOut)
async def update_spool(
    sid: int,
    body: SpoolUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    s = await _load_spool(db, sid)
    if not s:
        raise HTTPException(404, "Bobine introuvable")
    # exclude_unset et non exclude_none : le second ignorait les champs envoyes
    # a null, si bien qu'AUCUN champ ne pouvait etre vide. Vider le tag NFC
    # etait donc impossible -- utile pourtant, par exemple pour renvoyer une
    # bobine dans les detections non attribuees du scan RFID.
    #
    # La distinction : "absent du corps" veut dire ne pas toucher, "present a
    # null" veut dire effacer. Les trois appelants n'envoient qu'un champ a la
    # fois, aucun risque d'effacement collateral.
    data = body.model_dump(exclude_unset=True)

    # Chaine vide traitee comme un effacement : selon le chemin, le client
    # envoie l'un ou l'autre, et un "" en base ressemblerait a un tag valide
    # lors des comparaisons.
    for k in ("tag_number", "location", "comment"):
        if k in data and isinstance(data[k], str) and not data[k].strip():
            data[k] = None

    if data.get("last_dried_at") is not None:
        d = data["last_dried_at"]
        if d.tzinfo is not None:                     # stocke en UTC naif, comme l'AMS
            from datetime import timezone as _tz
            d = d.astimezone(_tz.utc).replace(tzinfo=None)
        # Un « aujourd'hui » envoye sans fuseau (midi naif lu en UTC) depasse
        # l'heure presente le matin : on le ramene a maintenant. Seul un jour
        # reellement a venir est refuse.
        now = datetime.utcnow()
        if d > now:
            if d - now > timedelta(hours=36):
                raise HTTPException(400, "La date de séchage ne peut pas être dans le futur")
            d = now
        data["last_dried_at"] = d

    changed_price = "price_override" in data
    before = s.remaining_weight_g
    for k, v in data.items():
        setattr(s, k, v)
    if "remaining_weight_g" in data:
        if abs(float(s.remaining_weight_g or 0) - float(before or 0)) >= 0.1:
            drift.weighed(s)
        _log_weight(db, s, before, "Poids corrigé")
    await db.commit()
    _clear_match_cache()
    if changed_price:
        _bg_recalc_by_spool(sid)
    return _spool_out(await _load_spool(db, sid))


@router.delete("/spools/{sid}", status_code=204)
async def archive_spool(
    sid: int,
    reason: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """reason (05/11/2026) : finie, jetee ou autre. Finie, ce qui lui restait chez nous est sa derive (positive : on lui
    croyait encore du filament ; negative si elle avait deja imprime sous notre zero)."""
    s = await db.get(Spool, sid)
    if not s:
        raise HTTPException(404, "Bobine introuvable")
    before = s.remaining_weight_g
    s.archived = True
    if reason in ("finie", "jetee", "autre"):
        s.end_reason = reason
    if reason == "finie":
        if drift.record(s, float(before or 0), "archive", await drift.full_of(db, s)):
            drift.note(db, s, "ecart", s.drift_g, f"Archivée finie : il lui restait {float(before or 0):.0f} g chez nous"
                       + (f", {float(s.overrun_g):.0f} g déjà imprimés sous notre zéro" if s.overrun_g else "")
                       + (f" (hors des stats : {s.drift_off})" if s.drift_off else ""))
    # Une bobine archivee sort du stock : on remet sa quantite a 0 et on la
    # replace en "Archives". Le worker spool_location ne touche plus aux
    # archivees (exclues du matching AMS), sa location resterait sinon figee
    # sur son dernier tray AMS et son poids continuerait a fausser les cumuls.
    s.remaining_weight_g = 0.0
    s.location = "Archives"
    _log_weight(db, s, before, {"finie": "Bobine archivée : finie", "jetee": "Bobine archivée : jetée",
                                "autre": "Bobine archivée : autre raison"}.get(reason or "", "Bobine archivée"))
    await db.commit()
    _clear_match_cache()


class DriftEdit(BaseModel):
    drift_g: Optional[float] = None       # l'ecart corrige a la main
    off: Optional[str] = None             # ecartee des stats : la raison ; "" la remet
    clear: bool = False                   # oublie la mesure


@router.patch("/spools/{sid}/drift", response_model=SpoolOut)
async def edit_spool_drift(sid: int, body: DriftEdit, db: AsyncSession = Depends(get_db),
                           _: str = Depends(require_admin)):
    """La derive d'une bobine (05/11/2026) : corrigee, ecartee des stats avec sa raison (jetee en partie, pretee, mal
    initialisee...), remise, ou oubliee."""
    s = await db.get(Spool, sid)
    if not s:
        raise HTTPException(404, "Bobine introuvable")
    if body.clear:
        s.drift_g = s.drift_kind = s.drift_at = s.drift_off = None
        drift.note(db, s, "ecart", 0, "Écart du suivi oublié")
    else:
        if body.drift_g is not None:
            old = s.drift_g
            s.drift_g = round(float(body.drift_g), 1)
            s.drift_kind = s.drift_kind or "main"
            s.drift_at = s.drift_at or datetime.utcnow()
            drift.note(db, s, "ecart", s.drift_g, "Écart corrigé à la main" + (f" (avant : {old:+.0f} g)" if old is not None else ""))
        if body.off is not None:
            s.drift_off = body.off.strip()[:120] or None
            drift.note(db, s, "ecart", s.drift_g, f"Écarté des stats : {s.drift_off}" if s.drift_off else "Remis dans les stats")
    await db.commit()
    return _spool_out(await _load_spool(db, sid))


@router.get("/drift")
async def drift_stats(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """La precision du suivi (05/11/2026) : chaque bobine mesuree a sa fin, et ce qu'on en tire (hors bobines ecartees)."""
    rows = (await db.execute(select(Spool, Filament).outerjoin(Filament, Filament.id == Spool.filament_id)
                             .where(Spool.drift_g.is_not(None)).order_by(Spool.drift_at.desc()))).all()
    items, kept = [], []
    for s, f in rows:
        full = float(f.filament_weight_g) if f and f.filament_weight_g else 1000.0
        items.append({"id": s.id, "filament_id": s.filament_id, "drift_g": s.drift_g, "kind": s.drift_kind,
                      "at": s.drift_at.isoformat() if s.drift_at else None, "off": s.drift_off, "full_g": full,
                      "archived": bool(s.archived), "end_reason": s.end_reason,
                      "name": (getattr(f, "translated_name", None) or f.name) if f else f"Bobine #{s.id}",
                      "brand": f.manufacturer if f else None, "material": (f.fila_type or f.material) if f else None,
                      "family": family_of(f.fila_type or f.material, f.material) if f else None,
                      "color": f.color if f else None, "colors": f.colors_array if f else None,
                      "multicolor": f.multicolor_type if f else None})
        if not s.drift_off:
            kept.append((float(s.drift_g), full))
    # par marque, type, sous-type, couleur et facon de mesurer (05/11/2026) : l'ecart moyen avec son signe, sans son signe
    groups = {}
    for key, get in (("brand", lambda it: it["brand"]), ("family", lambda it: it["family"]),
                     ("sub", lambda it: it["material"]), ("kind", lambda it: it["kind"])):
        acc = {}
        for it in items:
            if not it["off"]:
                acc.setdefault(get(it) or "?", []).append((float(it["drift_g"]), it["full_g"]))
        groups[key] = sorted(({"name": k, "n": len(v), "mean_g": round(sum(d for d, _f in v) / len(v), 1),
                               "mean_abs_g": round(sum(abs(d) for d, _f in v) / len(v), 1),
                               "accuracy_pct": round(max(0.0, 100 - 100 * sum(abs(d) / f for d, f in v) / len(v)), 1)}
                              for k, v in acc.items()), key=lambda g: (-g["n"], g["mean_abs_g"]))
    n = len(kept)
    summary = {"n": n, "excluded": len(items) - n}
    if n:
        absd = sorted(abs(d) for d, _f in kept)
        summary.update({
            "mean_g": round(sum(d for d, _f in kept) / n, 1),
            "mean_abs_g": round(sum(absd) / n, 1),
            "median_abs_g": round(absd[n // 2] if n % 2 else (absd[n // 2 - 1] + absd[n // 2]) / 2, 1),
            "max_abs_g": round(absd[-1], 1),
            # la precision : 100 % moins l'ecart moyen rapporte au poids d'une bobine pleine
            "accuracy_pct": round(max(0.0, 100 - 100 * sum(abs(d) / f for d, f in kept) / n), 1),
            "over": sum(1 for d, _f in kept if d > 0.5), "under": sum(1 for d, _f in kept if d < -0.5),
        })
    return {"summary": summary, "items": items, "groups": groups}


def _log_weight(db, s, before, why: str) -> None:
    """Tout changement du poids d'une bobine hors impression (02/11/2026) : dans son historique (kind « correction »,
    grammes signes), avec l'avant et l'apres. Avant, une correction a la main ne laissait aucune trace."""
    from ....models.spool_move import SpoolMove
    before, after = float(before or 0), float(s.remaining_weight_g or 0)
    d = round(after - before, 1)
    if abs(d) >= 0.1:
        db.add(SpoolMove(spool_id=s.id, grams=d, kind="correction",
                         label=f"{why} · {before:.0f} → {after:.0f} g"[:250]))


class WeightAdjust(BaseModel):
    mode:  str    # "set" | "add" | "sub"
    value: float  # grammes
    # des grammes rendus depuis une impression (31/10/2026) : gardes dans l'historique de la bobine
    print_id: Optional[int] = None
    usage_id: Optional[int] = None
    label: Optional[str] = None
    unlink: bool = False          # la consommation est detachee de la bobine dans la foulee


@router.post("/spools/{sid}/weight", response_model=SpoolOut)
async def adjust_spool_weight(
    sid: int,
    body: WeightAdjust,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Réajuste le poids restant d'une bobine.
    mode='set' → valeur absolue, 'add' → ajoute, 'sub' → soustrait.
    """
    s = await db.get(Spool, sid)
    if not s:
        raise HTTPException(404, "Bobine introuvable")
    cur = s.remaining_weight_g or 0.0
    if body.mode == "set":
        s.remaining_weight_g = max(0.0, body.value)
        was = s.overrun_g if s.drift_g is None else None
        drift.weighed(s)                             # un poids pose est le vrai : le sous-zero d'avant ne compte plus
        _log_weight(db, s, cur, "Poids corrigé" + (f" · {was:g} g sous notre zéro effacés".replace(".", ",") if was else ""))
    elif body.mode == "add":
        # des grammes rendus remboursent d'abord le sous-zero (05/11/2026) : 100 g rendus a une bobine passee 73 g sous
        # notre zero ne lui en laissent que 27
        a = drift.give_back(s, body.value) if body.value > 0 else 0.0
        if body.value <= 0:
            s.remaining_weight_g = max(0.0, cur + body.value)
        if not (body.print_id and body.value > 0):
            _log_weight(db, s, cur, "Poids corrigé" + drift.back_note(a))
        if body.print_id and body.value > 0:
            from ....models.spool_move import SpoolMove
            db.add(SpoolMove(spool_id=sid, grams=round(body.value, 1), kind="rendu", print_id=body.print_id,
                             usage_id=body.usage_id, unlinked=bool(body.unlink),
                             label=((body.label or "") + drift.back_note(a)).lstrip(" ·")[:250] or None))
    elif body.mode == "sub":
        s.remaining_weight_g = max(0.0, cur - body.value)
        _log_weight(db, s, cur, "Poids corrigé")
    else:
        raise HTTPException(400, "mode invalide (set/add/sub)")
    await db.commit()
    _clear_match_cache()
    return _spool_out(await _load_spool(db, sid))


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _siblings_map(db, filament_ids):
    """
    Pour chaque filament, nombre de bobines actives et poids restant cumule.

    Une seule requete groupee plutot qu'un comptage par bobine : la liste des
    bobines en affiche parfois plusieurs centaines, et un N+1 s'y verrait.
    """
    fids = [f for f in set(filament_ids) if f]
    if not fids:
        return {}
    here = Spool.ordered.is_(False)
    rows = (await db.execute(
        select(Spool.filament_id,
               func.sum(case((here, 1), else_=0)),
               func.coalesce(func.sum(case((here, Spool.remaining_weight_g), else_=0)), 0),
               func.sum(case((Spool.ordered.is_(True), 1), else_=0)))        # en commande, pas encore recues (28/10/2026)
        .where(Spool.filament_id.in_(fids), Spool.archived.is_(False))
        .group_by(Spool.filament_id)
    )).all()
    return {r[0]: (int(r[1] or 0), float(r[2] or 0), int(r[3] or 0)) for r in rows}


async def _load_spool(db, sid):
    result = await db.execute(
        select(Spool).options(selectinload(Spool.filament)).where(Spool.id == sid)
    )
    return result.scalar_one_or_none()


async def _spool_aggregates(db, fids) -> dict:
    """{filament_id: (bobines, actives, restant_g)} en une requete groupee ; sans filtre au-dela de quelques
    centaines d'ids (la liste IN a une limite en SQLite, et parcourir toute la table coute pareil)."""
    if not fids:
        return {}
    active = (Spool.archived.is_(False)) & (Spool.ordered.is_(False))     # une bobine commandee n'est pas en stock
    # une bobine dont on n'a jamais pese le restant est supposee pleine (meme regle que _fil_out)
    left = func.coalesce(Spool.remaining_weight_g, Filament.filament_weight_g, 0)
    stmt = (select(Spool.filament_id, func.count(Spool.id), func.sum(case((active, 1), else_=0)),
                   func.sum(case((active, left), else_=0)), func.sum(case((Spool.ordered.is_(True), 1), else_=0)))
            .join(Filament, Filament.id == Spool.filament_id).group_by(Spool.filament_id))
    if len(fids) <= 400:
        stmt = stmt.where(Spool.filament_id.in_(list(fids)))
    return {r[0]: (int(r[1] or 0), int(r[2] or 0), float(r[3] or 0), int(r[4] or 0)) for r in (await db.execute(stmt)).all()}


def _fil_out(f: Filament, agg: tuple | None = None) -> FilamentOut:
    """agg = (bobines, actives, restant_g) deja agreges ; sinon lus sur f.spools (charge explicitement)."""
    if agg is not None:
        n_all, n_act, left, n_ord = (list(agg) + [0])[:4]
    else:
        active = [s for s in f.spools if not s.archived and not getattr(s, "ordered", False)]
        n_all, n_act = len(f.spools), len(active)
        n_ord = sum(1 for s in f.spools if getattr(s, "ordered", False))
        left = sum((s.remaining_weight_g if s.remaining_weight_g is not None else (f.filament_weight_g or 0)) for s in active)
    return FilamentOut(
        id=f.id, name=f.name,
        name_en=getattr(f,"name_en",None),
        translated_name=getattr(f,"translated_name",None),
        manufacturer=f.manufacturer, material=f.material,
        fila_type=getattr(f,"fila_type",None),
        color=f.color, multicolor_type=f.multicolor_type, colors_array=f.colors_array,
        fila_finish=getattr(f, "fila_finish", None),
        glow_color=getattr(f, "glow_color", None),
        no_reorder=bool(getattr(f, "no_reorder", False)),
        color_bucket=getattr(f, "color_bucket", None),
        price=f.price, filament_weight_g=f.filament_weight_g, spool_weight_g=f.spool_weight_g,
        spool_tare_name=getattr(f, "spool_tare_name", None),
        profile_id=f.profile_id, fila_color_code=getattr(f, "fila_color_code", None),
        catalog_ref=getattr(f, "catalog_ref", None),
        density=getattr(f, "density", None),
        nozzle_min=getattr(f, "nozzle_min", None),
        nozzle_max=getattr(f, "nozzle_max", None),
        bed_min=getattr(f, "bed_min", None),
        bed_max=getattr(f, "bed_max", None),
        dry_temp=getattr(f, "dry_temp", None),
        dry_hours=getattr(f, "dry_hours", None),
        td=getattr(f, "td", None),
        gtin=getattr(f, "gtin", None),
        buy_url=getattr(f, "buy_url", None),
        swatch=f.swatch, to_order=f.to_order,
        label_printed=bool(getattr(f, "label_printed", False)),
        label_printed_at=getattr(f, "label_printed_at", None),
        spool_count=n_all, active_spool_count=n_act, ordered_spool_count=n_ord,
        remaining_weight_total_g=round(left, 1),
        created_at=getattr(f, "created_at", None), updated_at=getattr(f, "updated_at", None),
    )


def _spool_out(s: Spool, sib: tuple | None = None) -> SpoolOut:
    from ....services import drying as _drying
    f = s.filament
    return SpoolOut(
        needs_drying=_drying.needs_drying(s, f),
        dry_days=_drying.days_for(f),
        id=s.id, filament_id=s.filament_id,
        filament_name=f.name if f else "?",
        filament_translated_name=getattr(f, "translated_name", None) if f else None,
        filament_manufacturer=f.manufacturer if f else None,
        filament_material=f.material if f else "?",
        filament_fila_type=(f.fila_type if f else None),
        filament_color=f.color if f else None,
        filament_weight_g=f.filament_weight_g if f else None,
        filament_spool_weight_g=f.spool_weight_g if f else None,
        filament_spool_tare_name=getattr(f, "spool_tare_name", None) if f else None,
        filament_price=f.price if f else None,
        filament_profile_id=f.profile_id if f else None,
        filament_fila_color_code=getattr(f, "fila_color_code", None) if f else None,
        filament_swatch=bool(getattr(f, "swatch", False)) if f else False,
        filament_multicolor_type=f.multicolor_type if f else None,
        filament_colors_array=f.colors_array if f else None,
        filament_fila_finish=getattr(f, "fila_finish", None) if f else None,
        filament_color_bucket=getattr(f, "color_bucket", None) if f else None,
        filament_external_id=f.external_filament_id if f else None,
        remaining_weight_g=s.remaining_weight_g,
        price_override=s.price_override,
        location=s.location,
        tag_number=s.tag_number,
        ams_tray=s.ams_tray,
        archived=s.archived,
        comment=s.comment,
        external_spool_id=s.external_spool_id,
        found_mode=getattr(s, "found_mode", None),
        ordered=bool(getattr(s, "ordered", False)),
        # On retranche la bobine courante : l'interface veut savoir ce qu'il
        # reste A COTE, pas le total du filament. Une bobine archivee n'est pas
        # dans le compte (actives seulement) : rien a retrancher (25/10/2026).
        sibling_count=(max(0, sib[0] - (0 if (s.archived or s.ordered) else 1)) if sib else None),
        ordered_siblings=((sib[2] if len(sib) > 2 else 0) - (1 if s.ordered else 0)) if sib else None,
        sibling_weight_g=(round(max(0.0, sib[1] - (0 if (s.archived or s.ordered) else (s.remaining_weight_g or 0))), 1)
                          if sib else None),
        first_used_at=s.first_used_at,
        last_used_at=s.last_used_at,
        last_dried_at=s.last_dried_at,
        drift_g=getattr(s, "drift_g", None),
        drift_kind=getattr(s, "drift_kind", None),
        drift_off=getattr(s, "drift_off", None),
        end_reason=getattr(s, "end_reason", None),
        overrun_g=getattr(s, "overrun_g", None),
        created_at=s.created_at,
    )


def _get_catalog():
    """Récupère une instance du catalogue Bambu depuis les fichiers locaux."""
    from ....services.bambu_catalog import BambuCatalogSync
    from ....core.config import settings
    return BambuCatalogSync(data_dir=settings.DATA_DIR)


_CTYPE_FR = {"单色": "monochrome", "渐变色": "gradient", "多拼色": "coaxial"}


# Ce qu'un catalogue peut ecrire, par groupe (03/11/2026) : on choisit au rattachement ce qu'on importe ; le reste est garde
# a nous (catalog_skip), et la synchro ne l'ecrase plus. Le code couleur et le profil Bambu, eux, sont le rattachement.
CAT_GROUPS = {"name": ("name", "name_en", "translated_name"), "color": ("color", "colors_array", "multicolor_type"),
              "family": ("material",), "type": ("fila_type",), "brand": ("manufacturer",), "spool": ("spool_weight_g", "spool_tare_name")}
_GROUP_OF = {a: g for g, attrs in CAT_GROUPS.items() for a in attrs}


def _skips(f, skip=None) -> set:
    raw = skip if skip is not None else (getattr(f, "catalog_skip", None) or "").split(",")
    return {x.strip() for x in raw if x and x.strip() in CAT_GROUPS}


def _apply_catalog(f, entry: dict, en_to_fr: dict, link: bool = False, skip=None) -> list:
    """Met le filament aux noms, type, code couleur et couleurs de cette entree du catalogue Bambu ; rend les champs
    changes. link (rattachement a la main, 02/11/2026) : aussi le profil, la marque et la couleur, celle du catalogue
    (la synchro, elle, a trouve l'entree par la couleur)."""
    from ....services.bambu_catalog import fr_name
    names = entry.get("fila_color_name", {})
    name_en = names.get("en") or names.get("fr") or next(iter(names.values()), "")
    name_fr = fr_name(names, en_to_fr) or name_en
    colors = [c.lstrip("#")[:8] for c in entry.get("fila_color", [])]
    ctype = _CTYPE_FR.get(entry.get("fila_color_type", ""), "monochrome")
    changed: list = []
    keep = _skips(f, skip)

    def upd(attr, val):
        if _GROUP_OF.get(attr) in keep:
            return
        if getattr(f, attr, None) != val:
            setattr(f, attr, val)
            changed.append(attr)

    upd("name", name_en)
    upd("name_en", name_en)
    upd("translated_name", name_fr)
    # material = famille (PLA), fila_type = variante (PLA Basic)
    _ft = entry.get("fila_type", "")
    upd("material", family_of(_ft, f.material))
    upd("fila_type", _ft)
    upd("fila_color_code", entry.get("fila_color_code", ""))
    upd("multicolor_type", ctype)
    if ctype != "monochrome" and len(colors) > 1:
        upd("colors_array", ",".join(f"#{c}" for c in colors))
    if link:
        upd("profile_id", entry.get("fila_id", ""))
        upd("catalog_ref", None)
        if not (f.manufacturer or "").strip():
            upd("manufacturer", "Bambu Lab")
        if colors:
            upd("color", colors[0])
        if ctype == "monochrome":
            upd("colors_array", None)
    f.color_bucket = buckets_for(f.color, f.colors_array)
    return changed


async def _brand_spelling(db, brand: str) -> str:
    """La marque telle qu'on l'ecrit deja chez nous (« Sunlu » plutot que le « SUNLU » du catalogue), sinon telle quelle."""
    import re as _re
    n = lambda x: _re.sub(r"[^a-z0-9]", "", str(x or "").lower())
    for m in (await db.execute(select(Filament.manufacturer).distinct())).scalars().all():
        if m and n(m) == n(brand):
            return m
    return brand


async def _apply_ofd(db, f, e: dict, link: bool = False, skip=None) -> list:
    """Comme _apply_catalog, pour une couleur du catalogue des autres marques (vue de ofd_catalog.view) : memes champs
    qu'un import Bambu. link : aussi la couleur, la marque si vide, et le support s'il n'en a pas."""
    changed: list = []
    keep = _skips(f, skip)

    def upd(attr, val):
        if _GROUP_OF.get(attr) in keep:
            return
        if getattr(f, attr, None) != val:
            setattr(f, attr, val)
            changed.append(attr)

    upd("name", e["name"])
    upd("name_en", e["name"])
    upd("translated_name", e.get("name_fr") or e["name"])
    upd("material", family_of(e.get("fila_type"), e.get("family") or f.material))
    upd("fila_type", e.get("fila_type"))
    upd("multicolor_type", e.get("color_type_fr") or "monochrome")
    upd("catalog_ref", f"{e.get('source') or 'ofd'}:{e['ref']}")
    cols = e.get("colors") or []
    if len(cols) > 1:
        upd("colors_array", ",".join(f"#{c}" for c in cols))
    if link:
        upd("fila_color_code", None)
        if not (f.manufacturer or "").strip():
            upd("manufacturer", await _brand_spelling(db, e.get("brand")))
        if cols:
            upd("color", cols[0])
        if len(cols) <= 1:
            upd("colors_array", None)
        if f.spool_weight_g is None and e.get("spool_weight_g") and "spool" not in keep:
            from ....services import spool_tare
            t = await spool_tare.ensure(db, f.manufacturer or e.get("brand"), e["spool_weight_g"])
            upd("spool_weight_g", float(t["weight_g"]))
            upd("spool_tare_name", t["name"])
    f.color_bucket = buckets_for(f.color, f.colors_array)
    return changed


@router.get("/catalog/ofd/brands")
async def ofd_brands(only: str = "", _: str = Depends(get_current_user)):
    """Les marques du catalogue des autres marques (02/11/2026) : nom, nombre de couleurs, familles. only (05/11/2026,
    le navigateur par source) : « ofd » l'Open Filament Database seule, « own » notre catalogue seul."""
    from ....services import ofd_catalog, own_catalog
    if only == "own":
        own = own_catalog.brands()
        out = sorted(({"name": nm, "count": n, "families": sorted(x for x in fams if x)} for nm, n, fams in own.values()), key=lambda b: b["name"].casefold())
        return {"available": bool(out), "brands": out}
    if only == "ofd":
        return ofd_catalog.brands()
    r = ofd_catalog.brands()
    own = own_catalog.brands()
    out = []
    for b in r.get("brands") or []:
        k = ofd_catalog.norm(b["name"])
        if k in own:                                 # notre catalogue complete la marque
            _n, n, fams = own.pop(k)
            b = {**b, "count": b["count"] + n, "families": sorted({*b["families"], *(x for x in fams if x)}), "own": n}
        out.append(b)
    out += [{"name": nm, "count": n, "families": sorted(x for x in fams if x), "own": n} for nm, n, fams in own.values()]
    # les references en plus de FilamentColors (05/11/2026) : des couleurs, et des marques, que les autres n'ont pas
    from ....services import fc_catalog
    fcb = fc_catalog.brands()
    for i, b in enumerate(out):
        k = fc_catalog._brand_key(b["name"])
        if k in fcb:
            _n, n, fams = fcb.pop(k)
            out[i] = {**b, "count": b["count"] + n, "families": sorted({*b["families"], *(x for x in fams if x)}), "fc": n}
    out += [{"name": nm, "count": n, "families": sorted(x for x in fams if x), "fc": n} for nm, n, fams in fcb.values()]
    out.sort(key=lambda b: b["name"].casefold())
    return {**r, "available": bool(out), "brands": out}


@router.get("/catalog/type-transco")
async def type_transco_get(_: str = Depends(get_current_user)):
    """Nos transcos des sous-types (03/11/2026) et les gammes des catalogues des autres marques : leur nom d'origine,
    ce qu'en fait la normalisation (« Matte PLA » -> « PLA Matte »), notre sous-type, les marques, le nombre de couleurs."""
    from ....services import ofd_catalog, own_catalog, type_transco as T
    rows: dict = {}
    for g in ofd_catalog.gammes():
        rows[(g["gamme"], g["material"])] = g
    for x in own_catalog.items():
        k = (x.get("gamme") or x.get("family") or "", x.get("family") or "")
        a = rows.setdefault(k, {"gamme": k[0], "material": k[1], "brands": [], "count": 0})
        a["brands"] = sorted({*a["brands"], x["brand"]})
        a["count"] += 1
    out = [{**g, "auto": T.auto(g["gamme"], g["material"]), "ours": T.apply(g["gamme"], g["material"])} for g in rows.values() if g["gamme"]]
    out.sort(key=lambda g: g["gamme"].casefold())
    return {"items": T.items(), "gammes": out}


@router.put("/catalog/type-transco")
async def type_transco_put(body: dict = Body({}), _: str = Depends(require_admin)):
    from ....services import type_transco as T
    return {"items": await T.save(body.get("items") or [])}


@router.get("/catalog/family-map")
async def family_map_get(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """Nos familles (03/11/2026) : la table « sous-type -> famille », les familles connues, et les sous-types (ceux de nos
    filaments, avec leur nombre, puis ceux des catalogues) avec la famille qu'on en deduit (None : aucune)."""
    from ....core.materials import MATERIALS
    from ....services import family_map as FM, ofd_catalog, type_transco as T
    rows = (await db.execute(select(Filament.fila_type, func.count(Filament.id)).where(Filament.fila_type.isnot(None))
                             .group_by(Filament.fila_type))).all()
    seen, out = set(), []
    for ft, n in rows:
        if ft and ft.strip() and ft.casefold() not in seen:
            seen.add(ft.casefold())
            out.append({"name": ft, "filaments": n, "family": family_of(ft, None)})
    for g in ofd_catalog.gammes():
        ft = T.apply(g["gamme"], g["material"])
        if ft and ft.casefold() not in seen:
            seen.add(ft.casefold())
            out.append({"name": ft, "filaments": 0, "family": family_of(ft, None)})
    out.sort(key=lambda x: (-x["filaments"], x["name"].casefold()))
    fams = sorted({*MATERIALS, *(x["to"] for x in FM.items())})
    return {"items": FM.items(), "families": fams, "subtypes": out}


@router.put("/catalog/family-map")
async def family_map_put(body: dict = Body({}), _: str = Depends(require_admin)):
    from ....services import family_map as FM
    items, n = await FM.save(body.get("items") or [])
    _clear_match_cache()
    return {"items": items, "updated_filaments": n}


@router.get("/catalog/ofd/search")
async def ofd_search(brand: str = "", family: str = "", q: str = "", only: str = "", _: str = Depends(get_current_user)):
    """Les couleurs d'une marque, a la forme de /catalog/search (plus la marque et le poids du support) : celles de notre
    catalogue d'abord, puis l'Open Filament Database."""
    from ....services import ofd_catalog, own_catalog
    from ....services import fc_catalog
    if only == "own":
        mine = own_catalog.search(brand, family, q)
        return {"available": True, "total": len(mine), "entries": mine}
    if only == "ofd":
        return ofd_catalog.search(brand, family, q)
    mine = own_catalog.search(brand, family, q)
    r = ofd_catalog.search(brand, family, q)
    fc = fc_catalog.search(brand, family, q)[:400]     # puis les couleurs mesurees que les autres n'ont pas (05/11/2026)
    return {"available": bool(mine) or bool(fc) or r.get("available", False), "total": len(mine) + (r.get("total") or 0) + len(fc),
            "entries": mine + (r.get("entries") or []) + fc}


@router.post("/filaments/{fid}/link-catalog")
async def link_catalog(fid: int, body: dict = Body({}), db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    """Rattache un filament a une entree du catalogue Bambu choisie a la main (02/11/2026) : il prend ses noms, son type,
    son code couleur, ses couleurs et son profil, comme la synchro, qui le retrouvera ensuite par ce code."""
    f = await db.get(Filament, fid)
    if f is None:
        raise HTTPException(404, "Filament introuvable")
    try:
        changed = await _link_one(db, f, body, link=True)
    except ValueError as e:
        raise HTTPException(404, str(e))
    # un autre filament deja rattache a la meme entree : dit, pour fusionner a la main si c'est un doublon
    same = (Filament.catalog_ref == f.catalog_ref) if body.get("source") in ("ofd", "own") else \
        ((Filament.profile_id == f.profile_id) & (Filament.fila_color_code == f.fila_color_code))
    twin = (await db.execute(select(Filament.id, Filament.translated_name, Filament.name).where(Filament.id != fid, same))).first()
    await db.commit()
    _clear_match_cache()
    return {"ok": True, "changes": changed, "name": f.translated_name or f.name,
            "twin": {"id": twin[0], "name": twin[1] or twin[2]} if twin else None}


# ── La synchro des filaments avec les catalogues (03/11/2026) : Bambu et autres marques, en deux temps ──
# L'apercu ne touche a rien : pour chaque filament, ce qui changerait (rattachement sur), la correspondance devinee et
# d'autres choix (a confirmer), ou rien. La validation n'applique que ce qui a ete confirme.
_SNAP = ("name", "name_en", "translated_name", "material", "fila_type", "fila_color_code", "multicolor_type", "colors_array",
         "profile_id", "manufacturer", "color", "catalog_ref", "color_bucket", "spool_weight_g", "spool_tare_name", "catalog_skip")
_SHOW = ("translated_name", "name", "fila_type", "material", "color", "colors_array", "multicolor_type", "fila_color_code", "profile_id",
         "manufacturer", "spool_weight_g")


def _snap(f):
    from types import SimpleNamespace
    return SimpleNamespace(**{c: getattr(f, c, None) for c in _SNAP})


def _diff(before, after, changed) -> list:
    return [{"f": c, "a": getattr(before, c), "b": getattr(after, c)} for c in changed if c in _SHOW]


def _rgb(h):
    h = str(h or "").strip().lstrip("#")
    try:
        return tuple(int(h[k:k + 2], 16) for k in (0, 2, 4)) if len(h) >= 6 else None
    except ValueError:
        return None


def _words(*xs) -> set:
    import re as _re
    return {w for x in xs for w in _re.findall(r"[a-z0-9]+", str(x or "").lower()) if len(w) >= 2}


def _score(f, v) -> float:
    """Plus c'est bas, plus la couleur du catalogue ressemble au filament : la teinte, le nom, la gamme."""
    a, b = _rgb(f.color), _rgb(v.get("color_hex"))
    d = sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5 if a and b else 160.0
    names = {str(x or "").strip().lower() for x in (f.name, f.name_en, f.translated_name) if x}
    if str(v.get("name") or "").lower() in names or str(v.get("name_fr") or "").lower() in names:
        d -= 150
    else:
        d -= 35 * len(_words(f.name, f.name_en, f.translated_name) & _words(v.get("name"), v.get("name_fr")))
    # une seule couleur contre plusieurs (ou l'inverse) : un « Rouge » n'est pas un tricolore rouge-jaune-bleu
    multi_v = len(v.get("colors") or []) > 1 or bool(_words(v.get("name")) & {"dual", "tri", "rainbow", "multi", "gradient", "bicolor", "tricolor"})
    if ((f.multicolor_type or "monochrome") != "monochrome") != multi_v:
        d += 90
    if f.fila_type and v.get("fila_type"):
        if str(f.fila_type).lower() == str(v["fila_type"]).lower():
            d -= 60
        else:
            d -= 15 * len(_words(f.fila_type) & _words(v["fila_type"]))
    return d


def _bambu_exact(f, raw: list):
    """L'entree Bambu de ce filament : son code couleur s'il en a un, sinon son profil et sa couleur exacte (la regle de
    toujours : mono avec mono, multi avec multi)."""
    pid = (f.profile_id or "").upper()
    if not pid:
        return None
    if f.fila_color_code:
        e = next((e for e in raw if e.get("fila_id", "").upper() == pid and str(e.get("fila_color_code", "")) == str(f.fila_color_code)), None)
        if e:
            return e
    if not f.color:
        return None
    c = (f.color or "").lower().replace("#", "")
    c = c + "ff" if len(c) == 6 else c[:8]
    multi = (f.multicolor_type or "monochrome") != "monochrome"
    for e in raw:
        if e.get("fila_id", "").upper() != pid:
            continue
        cols = e.get("fila_color", [])
        if multi != (_CTYPE_FR.get(e.get("fila_color_type", ""), "monochrome") != "monochrome"):
            continue
        first = cols[0].lstrip("#").lower()[:8] if cols else ""
        if multi and f.colors_array:
            mine = {x.strip().lstrip("#").lower()[:6] for x in f.colors_array.split(",") if x.strip()}
            theirs = {x.lstrip("#").lower()[:6] for x in cols}
            if mine and theirs and not (mine <= theirs or theirs <= mine):
                continue
        elif first != c:
            continue
        return e
    return None


def _bambu_view(e: dict, t2f: dict, en_to_fr: dict) -> dict:
    """Une entree du catalogue Bambu, comme /catalog/search la rend."""
    from ....services.bambu_catalog import fr_name
    names = e.get("fila_color_name", {})
    ftype, colors, raw = e.get("fila_type", ""), e.get("fila_color", []), e.get("fila_color_type", "")
    return {"source": "bambu", "brand": "Bambu Lab", "fila_id": e.get("fila_id", ""), "fila_color_code": e.get("fila_color_code", ""),
            "color_code": e.get("color_code", ""), "fila_type": ftype, "family": t2f.get(ftype.lower(), ""),
            "name": names.get("en") or names.get("fr") or next(iter(names.values()), ""), "name_fr": fr_name(names, en_to_fr),
            "color_hex": colors[0].lstrip("#")[:8] if colors else "", "colors": [c.lstrip("#")[:8] for c in colors],
            "color_type": raw, "color_type_fr": _CTYPE_FR.get(raw, raw)}


def _other_entry(ref_or_catalog_ref: str, source: str = None):
    """L'entree « autres marques » : (source, ref) ou un catalog_ref « ofd:… » / « own:… »."""
    from ....services import ofd_catalog, own_catalog, fc_catalog
    if source is None:
        source, _, ref_or_catalog_ref = str(ref_or_catalog_ref or "").partition(":")
    return own_catalog.entry(ref_or_catalog_ref) if source == "own" else ofd_catalog.entry(ref_or_catalog_ref) if source == "ofd" \
        else fc_catalog.entry(ref_or_catalog_ref) if source == "fc" else None


async def _link_one(db, f, body: dict, link: bool = True) -> list:
    """Met le filament a l'entree designee : {source: "ofd", ref} ou {fila_id, fila_color_code} (Bambu). Leve ValueError.
    skip (liste, facultatif) : ce qu'on garde a nous ; retenu sur le filament pour les synchros suivantes."""
    if isinstance(body.get("skip"), list):
        f.catalog_skip = ",".join(sorted(_skips(f, body["skip"]))) or None
    # une page restee en cache (03/11/2026) envoyait une entree de notre catalogue sans sa source, prise pour du Bambu :
    # une entree reconnaissable a son identifiant (« own-… », ou une couleur de l'Open Filament Database) est retrouvee
    if not body.get("source") and not body.get("fila_color_code"):
        fid_ = str(body.get("fila_id") or "")
        if fid_.startswith("own-"):
            body = {**body, "source": "own", "ref": fid_[4:]}
        elif fid_.startswith("fc-"):
            body = {**body, "source": "fc", "ref": fid_[3:]}
        elif _other_entry(fid_, "ofd"):
            body = {**body, "source": "ofd", "ref": fid_}
    if body.get("source") in ("ofd", "own", "fc"):
        e = _other_entry(body.get("ref"), body["source"])
        if e is None:
            raise ValueError("Entrée introuvable dans le catalogue des autres marques")
        changed = await _apply_ofd(db, f, e, link=link)
        if link:
            from ....services import spool_tare
            if await spool_tare.link_weight(db, f):              # un poids deja la, sans support des Parametres
                changed.append("spool_tare_name")
        return changed
    from ....services.bambu_catalog import catalog_entries
    data, en_to_fr = catalog_entries()
    if data is None:
        raise ValueError("Catalogue Bambu non disponible (téléchargé au démarrage de l'appli)")
    pid, code = str(body.get("fila_id") or "").upper(), str(body.get("fila_color_code") or "")
    entry = next((e for e in data if str(e.get("fila_id", "")).upper() == pid and str(e.get("fila_color_code", "")) == code), None)
    if entry is None:
        raise ValueError("Entrée introuvable dans le catalogue Bambu")
    changed = _apply_catalog(f, entry, en_to_fr, link=link)
    if link:
        from ....services import spool_tare
        if await spool_tare.settle(db, f):
            changed.append("spool_weight_g")
    return changed


TECH_FIELDS = ("density", "nozzle_min", "nozzle_max", "bed_min", "bed_max", "dry_temp", "dry_hours", "td", "gtin", "buy_url")


def _tech_for(f, view: dict | None = None) -> dict:
    """La fiche technique que les catalogues donnent a ce filament (05/11/2026) : {champ: (valeur, source)}, notre
    catalogue et Bambu d'abord (voir catalog_facts.fields)."""
    from ....services import catalog_facts as CF, fc_catalog, bambu_profiles
    if view is None and f.catalog_ref:
        view = _other_entry(f.catalog_ref)
    bambu = "bambu" in (f.manufacturer or "").lower() or (bool(f.profile_id) and not f.catalog_ref)
    if view and view.get("source") == "fc" and view.get("fc"):
        fc = view["fc"]
    else:
        m = fc_catalog.matches(f.manufacturer or ("Bambu Lab" if bambu else ""), [f.name_en, f.name, f.translated_name],
                               f.fila_type or "", f.material or "", f.color or "", limit=1)
        fc = m[0] if m and m[0].get("how") == "nom" else None
    return CF.fields(bambu_profiles.of(f.profile_id) if bambu else None, view, fc, f.fila_color_code if bambu else None)


def _tech_changes(f, view: dict | None = None) -> list:
    """Les champs techniques qui changeraient : [{f, a, b, src}] (une valeur egale, a l'arrondi pres, ne compte pas)."""
    out = []
    for k, (v, src) in _tech_for(f, view).items():
        cur = getattr(f, k, None)
        same = cur == v or (isinstance(cur, (int, float)) and isinstance(v, (int, float)) and abs(cur - v) < 0.005)
        if not same:
            out.append({"f": k, "a": cur, "b": v, "src": src})
    return out


@router.get("/filaments/enrich/preview")
async def enrich_preview(db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    """L'apercu de la synchro : rien n'est enregistre. items : {id, nom, marque, couleur…, status, changes, proposals,
    reason}. status : « sure » (rattache, des champs changeraient), « ok » (deja a jour), « guess » (correspondance devinee,
    a confirmer ; proposals[0] la meilleure, puis d'autres choix), « none » (rien trouve)."""
    from ....services.bambu_catalog import catalog_entries
    from ....services import ofd_catalog
    raw, en_to_fr = catalog_entries()
    raw, en_to_fr = raw or [], en_to_fr or {}
    t2f = _get_catalog().type_to_family() if raw else {}
    bviews = [(e, _bambu_view(e, t2f, en_to_fr)) for e in raw]
    from ....services import own_catalog
    ofd_brands = {ofd_catalog.norm(b["name"]): b["name"] for b in (ofd_catalog.brands().get("brands") or [])}
    ofd_brands.update({k: v[0] for k, v in own_catalog.brands().items() if k not in ofd_brands})
    from ....services import fc_catalog
    ofd_brands.update({k: v[0] for k, v in fc_catalog.brands().items() if k not in ofd_brands})
    pools: dict = {}

    def ofd_pool(brand, fam):
        k = (brand, fam)
        if k not in pools:
            def both(fm):
                from ....services import fc_catalog
                return own_catalog.search(brand, fm, "") + (ofd_catalog.search(brand, fm, "", limit=100000).get("entries") or []) \
                    + fc_catalog.search(brand, fm, "")
            v = both(fam or "")
            pools[k] = v or (both("") if fam else [])
        return pools[k]

    items = []
    fils = (await db.execute(select(Filament).order_by(Filament.manufacturer, Filament.name))).scalars().all()
    for f in fils:
        it = {"id": f.id, "name": f.translated_name or f.name, "name_en": f.name, "manufacturer": f.manufacturer, "color": f.color,
              "colors_array": f.colors_array, "multicolor_type": f.multicolor_type, "fila_type": f.fila_type, "material": f.material,
              "status": "none", "changes": [], "proposals": [], "reason": None}
        bambu = "bambu" in (f.manufacturer or "").lower() or (bool(f.profile_id) and not f.catalog_ref and not (f.manufacturer or "").strip())
        fam = family_of(f.fila_type, f.material) or f.material
        sure = None
        if f.catalog_ref and f.catalog_ref.split(":", 1)[0] in ("ofd", "own", "fc"):
            e = _other_entry(f.catalog_ref)
            if e:
                after = _snap(f)
                ch = await _apply_ofd(None, after, e)
                sure = (e, _diff(f, after, ch))
            else:
                it["reason"] = "Son entrée a disparu du catalogue de sa marque"
        elif bambu and raw:
            e = _bambu_exact(f, raw)
            if e:
                v = _bambu_view(e, t2f, en_to_fr)
                after = _snap(f)
                ch = _apply_catalog(after, e, en_to_fr)
                sure = (v, _diff(f, after, ch))
        if sure:
            # et la fiche technique (05/11/2026) : densite, temperatures, sechage, TD, code-barres, lien d'achat
            tech = _tech_changes(f, sure[0] if sure[0].get("source") in ("ofd", "own", "fc") else None)
            ch = sure[1] + tech
            it.update(status="sure" if ch else "ok", changes=ch, proposals=[sure[0]])
            items.append(it)
            continue
        # pas de catalogue sur : la fiche technique se complete quand meme (profil Bambu, echantillon a son nom)
        it["tech"] = _tech_changes(f)
        # a deviner : les plus ressemblantes du bon catalogue
        if bambu:
            pool = [v for e, v in bviews if f.profile_id and e.get("fila_id", "").upper() == f.profile_id.upper()] \
                or [v for e, v in bviews if (v.get("family") or "").lower() == (fam or "").lower()] or [v for e, v in bviews]
            if not raw:
                it["reason"] = "Catalogue Bambu pas encore téléchargé"
        else:
            b = ofd_brands.get(ofd_catalog.norm(f.manufacturer))
            pool = ofd_pool(b, fam) if b else []
            if not b:
                it["reason"] = "Sans marque" if not (f.manufacturer or "").strip() else \
                    ("Catalogue des autres marques pas encore téléchargé" if not ofd_brands else f"« {f.manufacturer} » absente du catalogue des autres marques")
        if pool:
            ranked = sorted(pool, key=lambda v: _score(f, v))[:6]
            # « sure » : le meme nom, ou une teinte vraiment proche (la gamme seule ne suffit pas : un cuivre pour un rouge)
            best = ranked[0]
            a, b = _rgb(f.color), _rgb(best.get("color_hex"))
            close = bool(a and b) and sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5 < 40
            named = str(best.get("name") or "").lower() in {str(x or "").lower() for x in (f.name, f.name_en, f.translated_name)}                 or str(best.get("name_fr") or "").lower() in {str(x or "").lower() for x in (f.name, f.name_en, f.translated_name)}
            it.update(status="guess", proposals=ranked, strong=_score(f, best) < 30 and (close or named))
        items.append(it)
    # sans correspondance mais avec une fiche technique a completer (profil Bambu, echantillon a son nom) : une mise a
    # jour de ces seuls champs (05/11/2026)
    for it in items:
        if it["status"] == "none" and it.get("tech"):
            it.update(status="sure", changes=it.pop("tech"), tech_only=True)
    counts = {k: sum(1 for x in items if x["status"] == k) for k in ("sure", "ok", "guess", "none")}
    return {"items": items, "counts": counts, "bambu_ready": bool(raw), "others_ready": bool(ofd_brands)}


@router.post("/filaments/enrich/apply")
async def enrich_apply(body: dict = Body({}), db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    """Applique la synchro confirmee : items [{id, source, ref | fila_id + fila_color_code, link}] ; link : une
    correspondance devinee et confirmee (rattachement complet, comme « Rattacher au catalogue »), sinon une mise a jour."""
    done, errors = 0, []
    for x in (body.get("items") or [])[:2000]:
        f = await db.get(Filament, int(x.get("id") or 0))
        if f is None:
            continue
        try:
            # fields (05/11/2026) : les champs coches ; un champ decoche garde sa valeur (rien de retenu pour la suite)
            fields = set(x.get("fields") or []) if "fields" in x else None
            before = {a: getattr(f, a, None) for a in (*_SNAP, *TECH_FIELDS)}
            if not x.get("tech_only"):
                await _link_one(db, f, x, link=bool(x.get("link")))
            if fields is not None:
                for a in _SHOW:
                    if a not in fields and getattr(f, a, None) != before.get(a):
                        setattr(f, a, before[a])
                if "colors_array" not in fields and "color" not in fields:
                    f.colors_array, f.multicolor_type = before["colors_array"], before["multicolor_type"]
                # les champs qui vont ensemble : le nom anglais avec le nom, le nom du support avec son poids
                if "name" not in fields:
                    f.name_en = before["name_en"]
                if "spool_weight_g" not in fields:
                    f.spool_tare_name = before["spool_tare_name"]
                tech = _tech_for(f)
                for k in TECH_FIELDS:
                    if k in fields and k in tech:
                        setattr(f, k, tech[k][0])
                f.color_bucket = buckets_for(f.color, f.colors_array)
            done += 1
        except ValueError as e:
            errors.append({"id": f.id, "name": f.translated_name or f.name, "error": str(e)})
    await db.commit()
    _clear_match_cache()
    return {"updated": done, "errors": errors}


@router.get("/color-buckets")
async def color_buckets(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Palette des teintes + nombre de filaments par teinte."""
    rows = (await db.execute(select(Filament.color_bucket))).scalars().all()
    counts: dict[str, int] = {}
    for cb in rows:
        for t in (cb or "").split(","):
            t = t.strip()
            if t:
                counts[t] = counts.get(t, 0) + 1
    return [{**b, "count": counts.get(b["slug"], 0)} for b in all_buckets()]


@router.get("/catalog/types")
async def catalog_types(_: str = Depends(get_current_user)):
    """Liste les types de filaments Bambu disponibles dans le catalogue local."""
    cat = _get_catalog()
    mapping = cat.type_mapping()
    # mapping = {"PLA": ["PLA Basic", "PLA Matte"...], "PETG": [...], ...}
    return {
        "families": sorted(mapping.keys()),
        "types": {k: sorted(v) for k, v in mapping.items()},
    }


@router.get("/catalog/search")
async def catalog_search(
    family: Optional[str] = None,   # ex: "PLA"
    fila_type: Optional[str] = None, # ex: "PLA Basic"
    q: Optional[str] = None,         # recherche dans le nom couleur
    lang: str = "fr",
    _: str = Depends(get_current_user),
):
    """
    Recherche dans le catalogue filaments Bambu local.
    Filtre par famille (PLA/PETG…), type détaillé, et/ou substring sur le nom couleur.
    Retourne les entrées triées par type puis nom.
    """
    from ....services.bambu_catalog import catalog_entries
    entries, en_to_fr = catalog_entries()
    if entries is None:
        return {"entries": [], "available": False}

    # Famille de chaque type : deduite, le fichier communautaire en secours
    type_to_family: dict = _get_catalog().type_to_family()

    results = []
    for entry in entries:
        ftype = entry.get("fila_type", "")
        # Filtre famille
        if family:
            if type_to_family.get(ftype.lower(), "").lower() != family.lower():
                continue
        # Filtre type détaillé
        if fila_type and ftype.lower() != fila_type.lower():
            continue
        v = _bambu_view(entry, type_to_family, en_to_fr)
        # Filtre recherche textuelle — insensible à la casse ET à la position
        # cherche dans le nom français, anglais ET le code couleur Bambu
        if q:
            ql = q.strip().lower()
            if ql not in v["name_fr"].lower() and ql not in v["name"].lower() and ql not in v["fila_color_code"].lower():
                continue
        results.append(v)

    results.sort(key=lambda e: (e["fila_type"], e["name"]))
    return {"entries": results, "available": True}


@router.get("/map-tray/suggest")
async def map_tray_suggest(
    color: Optional[str] = None,
    tray_has_rfid: bool = False,  # True si le tray a un tag RFID valide (= Bambu Lab)
    _: str = Depends(get_current_user),
):
    """
    Suggestions de bobines pour mapper un tray non reconnu, sans tag RFID en base.
    Si tray_has_rfid=true → le filament est Bambu Lab → on ne montre que les bobines
    dont le filament associé a manufacturer='Bambu Lab' (ou sans marque renseignée).
    Si tray_has_rfid=false → filament tiers → on exclut les bobines Bambu Lab.
    Triées par couleur la plus proche.
    """
    import math
    def rgb(h: str):
        h = (h or "").strip().lstrip("#")
        try: return int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
        except: return (128,128,128)
    def dist(a, b): return math.sqrt(sum((x-y)**2 for x,y in zip(rgb(a), rgb(b))))

    def no_rfid(tag) -> bool:
        t = (tag or "").strip()
        return not t or t == "0" or all(c == "0" for c in t) or t.lower() in ("none", "null")

    def is_bambu(spool) -> bool:
        m = (spool.filament.manufacturer or "").strip().lower() if spool.filament else ""
        return "bambu" in m

    tray_color = (color or "").strip().lstrip("#")

    async with AsyncSessionLocal() as db:
        q = select(Spool).options(selectinload(Spool.filament)).where(Spool.archived == False)
        all_spools = (await db.execute(q)).scalars().all()

        # 1. Garder uniquement les bobines sans RFID en base
        candidates = [s for s in all_spools if no_rfid(s.tag_number)]

        # 2. Filtrer par marque selon la nature du tray
        if tray_has_rfid:
            # Tray Bambu → uniquement bobines Bambu Lab (ou sans marque)
            candidates = [s for s in candidates if is_bambu(s) or not (s.filament and s.filament.manufacturer)]
        else:
            # Tray tiers → exclure les bobines Bambu Lab
            candidates = [s for s in candidates if not is_bambu(s)]

        # 3. Trier par couleur la plus proche
        candidates.sort(key=lambda s: dist(tray_color, (s.filament.color or "") if s.filament else ""))

        result = [_spool_out(s) for s in candidates]

    return {"spools": result}


async def _remember_slot(body: dict, tag_uid: str, prof: str, color: str, spool_id: int) -> None:
    """
    Sans RFID, le choix fait a la main ne tiendrait pas : au matching suivant,
    profil + couleur retomberaient sur la meme (mauvaise) bobine. On le
    memorise pour l'emplacement tant que le meme filament y reste.
    """
    from ....services.slot_override import set_override, signature, has_rfid
    from ....core.mqtt import get_state
    if has_rfid(tag_uid) or body.get("ams_id") is None or body.get("tray_id") is None:
        return
    ams_id, tray_id = int(body["ams_id"]), int(body["tray_id"])
    # Signature lue sur l'emplacement EN DIRECT, comme le fait la detection : la
    # couleur renvoyee par l'ecran est deja retouchee (t.color) et ne
    # correspondrait pas.
    tray = None
    try:
        a = next((a for a in (get_state().ams_list or []) if a.id == ams_id), None)
        tray = next((t for t in (a.trays if a else []) if t.id == tray_id), None)
    except Exception:
        pass
    if tray is not None:
        prof, color = getattr(tray, "tray_info_idx", "") or "", getattr(tray, "raw_color", "") or color
    await set_override(ams_id, tray_id, signature(prof, color), spool_id)


@router.post("/map-tray/assign")
async def map_tray_assign(body: dict, _: str = Depends(get_current_user)):
    """
    Attribue une bobine a un emplacement AMS sans RFID, tant que le meme
    filament y reste. Ne modifie NI la bobine NI son filament (pas de profil
    ni de couleur recopies) : c'est seulement « cette bobine est ici ».
    body: {ams_id, tray_id, spool_id}
    """
    from ....services.slot_override import set_override, signature, has_rfid
    from ....core.mqtt import get_state, clear_match_cache
    try:
        ams_id, tray_id, spool_id = int(body["ams_id"]), int(body["tray_id"]), int(body["spool_id"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "ams_id, tray_id et spool_id requis")
    a = next((a for a in (get_state().ams_list or []) if a.id == ams_id), None)
    tray = next((t for t in (a.trays if a else []) if t.id == tray_id), None)
    if tray is None or tray.empty:
        raise HTTPException(404, "Emplacement vide ou introuvable")
    if has_rfid(tray.uuid):
        raise HTTPException(400, "Emplacement reconnu par RFID : l'attribution ne s'applique pas")
    async with AsyncSessionLocal() as db:
        s = await db.get(Spool, spool_id)
        if not s or s.archived:
            raise HTTPException(404, "Bobine introuvable ou archivée")
    await set_override(ams_id, tray_id, signature(tray.tray_info_idx, tray.raw_color or tray.color), spool_id)
    clear_match_cache()          # re-detection immediate : l'accueil suit
    return {"ok": True, "spool_id": spool_id}


@router.post("/map-tray/link")
async def map_tray_link(body: dict, _: str = Depends(get_current_user)):
    """
    Mappe un tray non reconnu sur une bobine existante : renseigne tag_number
    et profile_id sur la bobine et son filament pour que les prochains matchings
    l'identifient automatiquement.
    body: {spool_id, tray_uuid, profile_id, color}
    """
    spool_id  = body.get("spool_id")
    tag_uid   = (body.get("tray_uuid") or "").strip()
    prof      = (body.get("profile_id") or "").strip()
    color_hex = (body.get("color") or "").strip().lstrip("#")

    if not spool_id:
        raise HTTPException(400, "spool_id requis")

    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Spool).options(selectinload(Spool.filament)).where(Spool.id == int(spool_id))
        )
        s = res.scalar_one_or_none()
        if not s: raise HTTPException(404, "Bobine introuvable")

        changes = []
        if tag_uid and not s.tag_number:
            s.tag_number = tag_uid
            changes.append(f"Tag RFID ajouté sur la bobine #{s.id} ({tag_uid[:8]}…)")
        elif tag_uid and s.tag_number:
            changes.append(f"Tag RFID déjà renseigné sur la bobine (inchangé)")

        f = s.filament
        filament_name = f.name if f else "?"
        if f:
            if prof and not f.profile_id:
                f.profile_id = prof
                changes.append(f"Profile ID {prof!r} ajouté sur le filament")
            elif prof and f.profile_id:
                changes.append(f"Profile ID déjà renseigné ({f.profile_id}) — inchangé")
            if color_hex and not f.color:
                f.color = color_hex
                changes.append(f"Couleur #{color_hex} ajoutée sur le filament")

            # Associer un tag RFID a une bobine existante prouve aussi la
            # possession : meme automatisme que les deux autres chemins de scan.
            if tag_uid and f.to_order:
                f.to_order = False
                changes.append("Filament retiré de la liste à commander")

        await db.commit()

        # Construire la réponse DANS la session pendant que la relation est encore accessible
        spool_out = _spool_out(s)

    # Forcer un re-match au prochain tick MQTT
    try:
        from ....core.mqtt import invalidate_tray_cache
        invalidate_tray_cache(tag_uid=tag_uid, profile_id=prof)
    except Exception:
        pass

    return {
        "action": "mapped",
        "spool_id": s.id,
        "filament_name": filament_name,
        "changes": changes,
        "spool": spool_out,
    }


@router.post("/map-tray/create")
async def map_tray_create(body: dict, _: str = Depends(get_current_user)):
    """
    Crée un filament + une bobine à partir des infos MQTT d'un tray non reconnu,
    avec les champs nécessaires au matching automatique (profile_id, color, tag_uid).
    body: {tray_uuid, profile_id, color, material, name?, manufacturer?, weight?}
    """
    tag_uid  = (body.get("tray_uuid") or "").strip()
    prof     = (body.get("profile_id") or "").strip()
    # Normaliser la couleur : lowercase, 6 chars (MQTT envoie parfois 8 avec alpha)
    raw_color = (body.get("color") or "").strip().lstrip("#")
    color    = raw_color[:8].lower() if raw_color else ""
    material = (body.get("material") or "PLA").strip()
    name     = (body.get("name") or f"{material} {('#'+color) if color else ''}").strip()
    manufacturer = (body.get("manufacturer") or "").strip() or None
    weight   = float(body.get("weight") or 1000)

    # Champs optionnels issus du catalogue Bambu (import) — absents en creation libre.
    fila_type        = (body.get("fila_type") or "").strip() or None
    name_en          = (body.get("name_en") or "").strip() or None
    translated_name  = (body.get("translated_name") or "").strip() or None
    fila_color_code  = (body.get("fila_color_code") or "").strip() or None
    multicolor_type  = (body.get("multicolor_type") or "").strip() or None
    cat_colors       = body.get("colors") or []
    colors_array = None
    if isinstance(cat_colors, list) and len(cat_colors) > 1:
        colors_array = ",".join("#" + str(c).lstrip("#")[:6] for c in cat_colors)
    # Le catalogue n'a pas l'alpha, mais le scan (color) si : on le propage.
    colors_array = apply_alpha(colors_array, color)

    async with AsyncSessionLocal() as db:
        # Réutiliser un filament existant si profile_id + couleur correspondent
        # (comparaison insensible à la casse, 6 chars)
        fil = None
        filament_created = False
        if prof:
            res = await db.execute(
                select(Filament).where(Filament.profile_id == prof)
            )
            for candidate in res.scalars().all():
                c = (candidate.color or "").lower()[:6]
                if c == color:
                    fil = candidate
                    break

        if not fil:
            fil = Filament(
                name=name_en or name, material=material, manufacturer=manufacturer,
                color=color or None, profile_id=prof or None,
                filament_weight_g=weight,
            )
            # Import catalogue : on enregistre aussi la variante, le nom FR, les
            # couleurs multiples et le code Bambu — sinon la fiche creee depuis
            # l'AMS etait plus pauvre que la meme reference importee ailleurs.
            fil.fila_type       = fila_type
            fil.translated_name = translated_name
            fil.fila_color_code = fila_color_code
            fil.colors_array    = colors_array
            if multicolor_type:
                fil.multicolor_type = multicolor_type
            fil.color_bucket = buckets_for(fil.color, fil.colors_array)
            from ....services import spool_tare
            await spool_tare.fill(db, fil)
            db.add(fil)
            await db.flush()
            filament_created = True

        spool = Spool(
            filament_id=fil.id,
            tag_number=tag_uid or None,
            remaining_weight_g=weight,
            last_dried_at=datetime.utcnow(),     # neuve = seche (cf. create_spool)
        )
        db.add(spool)

        # Scanner une bobine RFID prouve qu'on la possede : le filament n'est
        # donc plus a commander. Ce chemin (map-tray/create) est celui du scan
        # RFID -- distinct de POST /spools, ou le meme automatisme vit pour la
        # creation manuelle avec tag. Un tag_uid est presque toujours present
        # ici, mais on garde la condition : sans tag, rien ne prouve la
        # possession. Le cas compte surtout quand fil est un filament EXISTANT
        # reutilise, qui peut avoir ete marque a commander de longue date.
        if tag_uid and fil.to_order:
            fil.to_order = False

        await db.commit()
        await _remember_slot(body, tag_uid, prof, color, spool.id)   # bobine creee depuis un emplacement sans RFID
        await db.refresh(spool)
        await db.refresh(spool.filament)
        # Construire la réponse DANS la session
        spool_out = _spool_out(spool)
        fil_name = fil.name

    try:
        from ....core.mqtt import invalidate_tray_cache
        invalidate_tray_cache(tag_uid=tag_uid, profile_id=prof)
    except Exception:
        pass

    changes = []
    if filament_created:
        changes.append(f"Filament créé : {name!r} ({material}{', ' + manufacturer if manufacturer else ''})")
    else:
        changes.append(f"Filament existant réutilisé : {fil_name!r} (profil {prof} + couleur #{color})")
    changes.append(f"Bobine créée (#{spool.id}){', tag RFID : ' + tag_uid[:8] + '…' if tag_uid else ''}")

    return {
        "action": "created",
        "spool_id": spool.id,
        "filament_name": fil_name,
        "filament_created": filament_created,
        "changes": changes,
        "spool": spool_out,
    }


@router.delete("/spools/{sid}/permanent")
async def delete_spool_permanent(sid: int, force: bool = False, _: str = Depends(get_current_user)):
    """
    Supprime définitivement une bobine (≠ archiver).
    Si elle a des filament_usage liés, retourne un avertissement (force=false)
    ou vide les filament_usage.spool_id (force=true).
    Si elle a des filament_usage liés, retourne un avertissement (force=false)
    ou vide les filament_usage.spool_id (force=true).
    """
    async with AsyncSessionLocal() as db:
        s = await db.get(Spool, sid)
        if not s:
            raise HTTPException(404, "Bobine introuvable")

        # Compter les usages liés
        usage_count = (await db.execute(
            select(func.count()).where(FilamentUsage.spool_id == sid)
        )).scalar() or 0

        if usage_count and not force:
            return {
                "ok": False,
                "confirm_required": True,
                "usage_count": usage_count,
                "message": f"Cette bobine est liée à {usage_count} utilisation(s) dans l'historique. "
                           f"Les supprimer délie ces prints de la bobine (les prints restent, "
                           f"juste le lien bobine est effacé). Confirmer avec force=true."
            }

        if usage_count:
            await db.execute(
                FilamentUsage.__table__.update()
                .where(FilamentUsage.spool_id == sid)
                .values(spool_id=None)
            )

        await db.delete(s)
        await db.commit()

    _clear_match_cache()
    return {"ok": True, "usage_cleared": usage_count}


@router.delete("/filaments/{fid}")
async def delete_filament(fid: int, _: str = Depends(get_current_user)):
    """
    Supprime un filament — uniquement si aucune bobine n'y est rattachée
    (archivées ou non) et si aucun échantillon n'a été imprimé. Sinon 409.
    """
    async with AsyncSessionLocal() as db:
        f = await db.get(Filament, fid)
        if not f:
            raise HTTPException(404, "Filament introuvable")

        spool_count = (await db.execute(
            select(func.count()).where(Spool.filament_id == fid)
        )).scalar() or 0

        if spool_count:
            raise HTTPException(
                409,
                f"Impossible de supprimer ce filament : {spool_count} bobine(s) y sont rattachées "
                f"(archivées ou non). Supprime ou déplace les bobines d'abord."
            )

        # Un echantillon imprime est un objet PHYSIQUE, range dans le nuancier
        # et porteur d'un QR qui pointe cette fiche. Supprimer le filament
        # laisserait une plaquette orpheline dont le scan mene a une 404, sans
        # aucun moyen de retrouver ce qu'elle representait.
        if f.swatch:
            raise HTTPException(
                409,
                "Impossible de supprimer ce filament : un échantillon a été imprimé. "
                "Décoche la case Échantillon si la plaquette a été jetée."
            )

        await db.delete(f)
        await db.commit()

    _clear_match_cache()
    return {"ok": True}


async def _load_spool_plain(sid: int):
    async with AsyncSessionLocal() as db:
        return await db.get(Spool, sid)


@router.get("/spools/{sid}/usage")
async def spool_usage_history(sid: int, _: str = Depends(get_current_user)):
    """L'historique de la bobine : ses consommations (kind « usage », avec infos du print) et, depuis le 31/10/2026,
    ce qu'on lui a rendu (kind « rendu » ; « annule » : une consommation annulee), le plus recent d'abord."""
    from sqlalchemy import select as _sel
    from ....models.print_history import FilamentUsage as _FU, Print as _P
    from ....models.spool_move import SpoolMove
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            _sel(
                _FU.id, _FU.print_id, _FU.grams_used, _FU.cost, _FU.from_g, _FU.spool_before_g,
                _P.file_name, _P.translated_name, _P.print_date, _P.status
            )
            .join(_P, _FU.print_id == _P.id)
            .where(_FU.spool_id == sid)
            .order_by(_P.print_date.desc())
        )).all()
        moves = (await db.execute(_sel(SpoolMove).where(SpoolMove.spool_id == sid))).scalars().all()
    sp = await _load_spool_plain(sid)
    # ce qui a ete rendu a chaque consommation (02/11/2026) : une impression echouee dit si sa part non imprimee est
    # revenue a la bobine, ou pas
    back = {}
    for m in moves:
        if m.usage_id and m.kind in ("rendu", "annule") and m.reverted_at is None:
            back[m.usage_id] = round(back.get(m.usage_id, 0) + (m.grams or 0), 1)
    out = [
        {
            "kind":       "usage",
            "usage_id":   r.id,
            "print_id":   r.print_id,
            "file_name":  r.translated_name or r.file_name,
            "print_date":  r.print_date.isoformat() if r.print_date else None,
            "status":      r.status,
            "grams_used": r.grams_used,
            "cost":       r.cost,
            # suivi couche par couche : cette bobine a pris le relais d'une autre en cours d'impression (02/11/2026)
            "relay":      r.from_g is not None,
            "returned":   back.get(r.id, 0),
            # ce qu'elle avait chez nous au lancement (05/11/2026) : moins que l'impression, la suite est sous notre zero
            "before":     round(float(r.spool_before_g), 1) if r.spool_before_g is not None else None,
        }
        for r in rows
    ]
    # son arrivee (05/11/2026) : la premiere ligne de son histoire
    if sp is not None and sp.created_at:
        out.append({"kind": "ajout", "id": 0, "file_name": "Ajoutée au stock" + (" (tag RFID)" if sp.tag_number else ""), "grams": None,
                    "print_date": sp.created_at.isoformat() + "Z", "reverted": False})
    out += [{"kind": m.kind, "id": m.id, "print_id": m.print_id, "usage_id": m.usage_id, "file_name": m.label, "grams": m.grams,
             "print_date": m.at.isoformat() + "Z" if m.at else None, "reverted": m.reverted_at is not None,
             "reverted_at": m.reverted_at.isoformat() + "Z" if m.reverted_at else None} for m in moves]
    out.sort(key=lambda x: x.get("print_date") or "", reverse=True)
    # le sous-zero cumule a chaque impression (05/11/2026 : « 47 g sous notre zero » sans dire qu'il s'ajoutait aux
    # 4,8 g d'avant) : on part du cumul garde sur la bobine (le vrai) et on remonte le temps ; une impression en cours
    # n'y est pas encore (comptee a sa fin) ; une pesee qui l'a efface arrete la remontee
    import re as _re
    cum = float(sp.overrun_g or 0) if sp is not None and sp.drift_g is None else None
    if cum is not None:
        for x in out:
            if x.get("kind") == "usage" and x.get("before") is not None and x.get("status") == "IN_PROGRESS":
                over = float(x.get("grams_used") or 0) - float(x["before"])
                if over >= 0.5:
                    x["zero_total"] = round(cum + over, 1)
        for x in out:
            if cum is None:
                break
            k = x.get("kind")
            if k == "usage" and x.get("status") != "IN_PROGRESS" and x.get("before") is not None:
                over = float(x.get("grams_used") or 0) - float(x["before"])
                if over >= 0.5:
                    x["zero_total"] = round(cum, 1)
                    cum = max(0.0, cum - over)
            elif k in ("rendu", "annule") and not x.get("reverted"):
                m = _re.search(r"dont ([\d,]+) g sous notre zéro", x.get("file_name") or "")
                if m:
                    cum += float(m.group(1).replace(",", "."))
            elif k == "correction" and "sous notre zéro effacés" in (x.get("file_name") or ""):
                cum = None
    return out


@router.post("/spools/{sid}/history/undo")
async def spool_history_undo(sid: int, body: dict = Body({}), _: str = Depends(require_admin)):
    """Annule une ligne de l'historique d'une bobine (31/10/2026) :
      - une consommation (kind « usage », id : la consommation) : ses grammes reviennent a la bobine, et l'impression
        ne compte plus sur elle (detachee, ses couts refaits) ;
      - un rendu (kind « move », id : le mouvement) : ses grammes sont repris a la bobine, et la consommation d'ou ils
        venaient les retrouve (ou est rattachee de nouveau a la bobine, si elle en avait ete detachee)."""
    from datetime import datetime as _dt
    from ....models.print_history import FilamentUsage as _FU
    from ....models.spool_move import SpoolMove
    from .prints import _propagate_from_print
    from ....services.print_tracker import _costs as _calc_costs
    from ....models.print_history import Print as _P
    kind, oid = str(body.get("kind") or ""), body.get("id")
    if not isinstance(oid, int):
        raise HTTPException(400, "Ligne inconnue")
    async with AsyncSessionLocal() as db:
        s = await db.get(Spool, sid)
        if not s:
            raise HTTPException(404, "Bobine introuvable")
        pid = None
        if kind == "usage":
            fu = await db.get(_FU, oid)
            if not fu or fu.spool_id != sid:
                raise HTTPException(404, "Consommation introuvable")
            full_g = g = round(fu.grams_used or 0, 1)
            # seulement ce qui avait vraiment ete retire (04/11/2026) : le decompte du lancement s'arrete a 0
            if fu.spool_before_g is not None:
                g = round(min(g, max(0.0, fu.spool_before_g)), 1)
            s.remaining_weight_g = round((s.remaining_weight_g or 0) + g, 1)
            # ce qu'elle avait imprime sous notre zero pour elle n'a plus lieu d'etre (05/11/2026)
            a = drift.take_overrun(s, full_g - g)
            fu.spool_id = None
            fu.spool_before_g = None
            pid = fu.print_id
            p = await db.get(_P, pid)
            db.add(SpoolMove(spool_id=sid, grams=g, kind="annule", print_id=pid, usage_id=fu.id, unlinked=True,
                             label=(((p.translated_name or p.file_name) if p else "") + drift.back_note(a)).lstrip(" ·")[:250] or None))
            msg = f"{g:g} g rendus à la bobine".replace(".", ",") + drift.back_note(a)
        elif kind == "move":
            m = await db.get(SpoolMove, oid)
            if not m or m.spool_id != sid or m.reverted_at is not None:
                raise HTTPException(404, "Ligne introuvable ou déjà annulée")
            if m.kind in drift.INFO_KINDS:
                raise HTTPException(400, "Cette ligne explique, elle ne se défait pas")
            if m.kind == "correction":
                # une correction de poids : la bobine revient au poids d'avant
                s.remaining_weight_g = round(max(0.0, (s.remaining_weight_g or 0) - (m.grams or 0)), 1)
                m.reverted_at = _dt.utcnow()
                await db.commit()
                _clear_match_cache()
                return {"ok": True, "message": "Poids d'avant remis"}
            if m.kind == "fin":
                # une bobine mise a 0 en cours d'impression (suivi couche par couche) : ce qu'elle avait lui revient
                s.remaining_weight_g = round((s.remaining_weight_g or 0) + (m.grams or 0), 1)
                m.reverted_at = _dt.utcnow()
                await db.commit()
                _clear_match_cache()
                return {"ok": True, "message": f"{(m.grams or 0):g} g remis à la bobine".replace(".", ",")}
            drift.take_back(s, m.grams or 0)           # ce que le poids ne couvre pas repasse sous notre zero
            fu = await db.get(_FU, m.usage_id) if m.usage_id else None
            if fu is not None:
                if m.unlinked:
                    if fu.spool_id is None:
                        fu.spool_id = sid                   # rattachee a la bobine, comme avant
                elif fu.spool_id == sid:
                    fu.grams_used = round((fu.grams_used or 0) + (m.grams or 0), 1)
                pid = fu.print_id
            m.reverted_at = _dt.utcnow()
            msg = f"{(m.grams or 0):g} g repris à la bobine".replace(".", ",")
        else:
            raise HTTPException(400, "Ligne inconnue")
        if pid:
            await db.flush()
            p = await db.get(_P, pid)
            if p:
                await _calc_costs(db, p)
                await _propagate_from_print(db, pid)
        await db.commit()
    _clear_match_cache()
    return {"ok": True, "message": msg}
