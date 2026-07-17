from fastapi.responses import FileResponse
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, update
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import os

from ....core.colors import buckets_for, all_buckets
from ....core.materials import family_of, is_family

def _clear_match_cache():
    """Vide le cache de matching MQTT après toute mutation de bobine."""
    try:
        from ....core.mqtt import invalidate_tray_cache
        invalidate_tray_cache()
        force_rematch_all_trays()
    except Exception:
        pass


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
from .auth import get_current_user

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
    color_bucket: Optional[str] = None
    price: Optional[float]
    filament_weight_g: float
    spool_weight_g: Optional[float]
    profile_id: Optional[str]
    fila_color_code: Optional[str] = None
    swatch: bool
    to_order: bool
    spool_count: int = 0
    active_spool_count: int = 0
    remaining_weight_total_g: float = 0   # somme du restant sur les bobines actives
    photo_url: Optional[str] = None
    photos: list[str] = []

class FilamentCreate(BaseModel):
    name: str
    name_en: Optional[str] = None
    translated_name: Optional[str] = None
    manufacturer: Optional[str] = None
    material: str = "PLA"
    fila_type: Optional[str] = None
    color: Optional[str] = None
    multicolor_type: str = "monochrome"
    colors_array: Optional[str] = None
    price: Optional[float] = None
    filament_weight_g: float = 1000.0
    spool_weight_g: Optional[float] = None
    profile_id: Optional[str] = None
    fila_color_code: Optional[str] = None
    swatch: bool = False
    to_order: bool = False
    comment: Optional[str] = None

class SpoolOut(BaseModel):
    id: int
    filament_id: int
    # Filament catalogue
    filament_name: str
    filament_translated_name: Optional[str] = None
    filament_manufacturer: Optional[str] = None
    filament_material: str
    filament_fila_type: Optional[str] = None   # sous-type (PLA Basic, PLA Wood…)
    filament_color: Optional[str] = None
    filament_weight_g: Optional[float] = None
    filament_spool_weight_g: Optional[float] = None
    filament_price: Optional[float] = None
    filament_profile_id: Optional[str] = None
    filament_multicolor_type: Optional[str] = None
    filament_colors_array: Optional[str] = None
    filament_color_bucket: Optional[str] = None
    filament_external_id: Optional[str] = None
    filament_fila_color_code: Optional[str] = None
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
    first_used_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    last_dried_at: Optional[datetime] = None
    created_at: datetime

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


# ── Filaments ─────────────────────────────────────────────────────────────────

@router.get("/filaments", response_model=list[FilamentOut])
async def list_filaments(
    q: Optional[str] = Query(None),
    material: Optional[str] = Query(None),
    manufacturer: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    stmt = select(Filament).options(selectinload(Filament.spools))
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
    return [_fil_out(f) for f in filaments]


@router.post("/filaments/labels/pdf")
async def filament_labels_pdf(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Planche d'etiquettes a coller sur les echantillons : un QR code de 9x9 mm
    encodant l'ID du filament, et l'ID en clair juste en dessous pour pouvoir le
    saisir a la main si le scan echoue.
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
    # 2 lignes au-dessus (numero, sous-type) et 1 en dessous (marque).
    # Sous-type et marque prennent la plus grande police possible (jusqu'a PT_MAX)
    # pour maximiser la lisibilite.
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
    #   #123            numero (gras)
    #   PLA Basic       sous-type (repli materiau)
    #   [ QR ]          pleine largeur -> module ~0.57 mm (tres lisible)
    #   Bambu Lab       marque
    #   Bleu cyan       nom (traduit si dispo)
    CELL_W = W_mm * mm
    CELL_H = H_mm * mm
    QR     = CELL_W                    # QR sur toute la largeur
    GAP    = 3.0 * mm                  # espace entre etiquettes = quiet zone
    MARG   = 10 * mm
    W, H = A4

    # 3 lignes : 2 au-dessus (numero, sous-type), 1 en dessous (marque).
    text_h  = CELL_H - QR
    LINE    = text_h / 3               # hauteur d'une bande de texte
    PT_CAP  = 0.82                     # part de la bande occupee par la capitale
    PT_MAX  = 9.0                      # plafond haut : les lignes "adaptables"
                                       # (sous-type, marque) remplissent la largeur

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

        def _line(cy_top, text, bold):
            """Ligne centree dans une bande LINE, scommencant en haut a cy_top."""
            font = "Helvetica-Bold" if bold else "Helvetica"
            fitted = _fit_font(text, CELL_W, font, LINE)
            if not fitted:
                return
            txt, pt = fitted
            cap_mm = pt * 0.72 / 2.83465
            c.setFont(font, pt)
            c.setFillColorRGB(0, 0, 0)
            c.drawCentredString(cx, cy_top - LINE + (LINE - cap_mm*mm)/2, txt)

        sub  = (f.fila_type or f.material or "").strip()

        # 2 lignes au-dessus du QR (numero + sous-type)
        top = y + CELL_H
        _line(top,        f"#{f.id}", True)
        _line(top - LINE, sub,       False)

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
        qy = y + 1*LINE                     # au-dessus de la ligne du bas (marque)
        for r_i, line in enumerate(matrix):
            for c_i, on in enumerate(line):
                if on:
                    c.rect(qx + c_i*module,
                           qy + QR - (r_i + 1)*module,
                           module, module, stroke=0, fill=1)

        # 1 ligne en dessous du QR : la marque.
        _line(y + 1*LINE, f.manufacturer or "", False)

    c.showPage()
    c.save()
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="etiquettes-filaments.pdf"'},
    )


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

    f = Filament(**body.model_dump())
    f.color_bucket = buckets_for(f.color, f.colors_array)
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
    changed_price = "price" in payload
    for k, v in payload.items():
        setattr(f, k, v)
    if "color" in payload or "colors_array" in payload:
        f.color_bucket = buckets_for(f.color, f.colors_array)
    await db.commit()
    _clear_match_cache()
    if changed_price:
        # Recalculer tous les prints qui utilisent une bobine de ce filament
        _bg_recalc_by_filament(fid)
    return _fil_out(f)


# ── Spools (Bobines) ──────────────────────────────────────────────────────────

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
    return [_spool_out(s) for s in result.scalars().all()]


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
    s = Spool(**data)
    db.add(s)
    await db.commit()
    await db.refresh(s)
    _clear_match_cache()
    return _spool_out(await _load_spool(db, s.id))


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
    changed_price = "price_override" in body.model_dump(exclude_none=True)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    await db.commit()
    _clear_match_cache()
    if changed_price:
        _bg_recalc_by_spool(sid)
    return _spool_out(await _load_spool(db, sid))


@router.delete("/spools/{sid}", status_code=204)
async def archive_spool(
    sid: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    s = await db.get(Spool, sid)
    if not s:
        raise HTTPException(404, "Bobine introuvable")
    s.archived = True
    await db.commit()
    _clear_match_cache()


class WeightAdjust(BaseModel):
    mode:  str    # "set" | "add" | "sub"
    value: float  # grammes


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
    elif body.mode == "add":
        s.remaining_weight_g = max(0.0, cur + body.value)
    elif body.mode == "sub":
        s.remaining_weight_g = max(0.0, cur - body.value)
    else:
        raise HTTPException(400, "mode invalide (set/add/sub)")
    await db.commit()
    _clear_match_cache()
    return _spool_out(await _load_spool(db, sid))


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _load_spool(db, sid):
    result = await db.execute(
        select(Spool).options(selectinload(Spool.filament)).where(Spool.id == sid)
    )
    return result.scalar_one_or_none()


def _fil_photos(fid: int) -> list[str]:
    """Toutes les photos du dossier /data/filaments/{id}/."""
    d = DATA_DIR / "filaments" / str(fid)
    if not d.exists():
        return []
    return [
        f"/api/v1/filaments/{fid}/photo/{f.name}"
        for f in sorted(d.iterdir())
        if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif")
    ]


def _fil_out(f: Filament) -> FilamentOut:
    active = [s for s in f.spools if not s.archived]
    photos = _fil_photos(f.id)
    return FilamentOut(
        id=f.id, name=f.name,
        name_en=getattr(f,"name_en",None),
        translated_name=getattr(f,"translated_name",None),
        manufacturer=f.manufacturer, material=f.material,
        fila_type=getattr(f,"fila_type",None),
        color=f.color, multicolor_type=f.multicolor_type, colors_array=f.colors_array,
        color_bucket=getattr(f, "color_bucket", None),
        price=f.price, filament_weight_g=f.filament_weight_g, spool_weight_g=f.spool_weight_g,
        profile_id=f.profile_id, fila_color_code=getattr(f, "fila_color_code", None),
        swatch=f.swatch, to_order=f.to_order,
        spool_count=len(f.spools), active_spool_count=len(active),
        # Une bobine dont on n'a jamais pese le restant est supposee pleine.
        remaining_weight_total_g=round(sum(
            (s.remaining_weight_g if s.remaining_weight_g is not None
             else (f.filament_weight_g or 0))
            for s in active
        ), 1),
        photo_url=(photos[0] if photos else None), photos=photos,
    )


def _spool_out(s: Spool) -> SpoolOut:
    f = s.filament
    return SpoolOut(
        id=s.id, filament_id=s.filament_id,
        filament_name=f.name if f else "?",
        filament_translated_name=getattr(f, "translated_name", None) if f else None,
        filament_manufacturer=f.manufacturer if f else None,
        filament_material=f.material if f else "?",
        filament_fila_type=(f.fila_type if f else None),
        filament_color=f.color if f else None,
        filament_weight_g=f.filament_weight_g if f else None,
        filament_spool_weight_g=f.spool_weight_g if f else None,
        filament_price=f.price if f else None,
        filament_profile_id=f.profile_id if f else None,
        filament_fila_color_code=getattr(f, "fila_color_code", None) if f else None,
        filament_multicolor_type=f.multicolor_type if f else None,
        filament_colors_array=f.colors_array if f else None,
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
        first_used_at=s.first_used_at,
        last_used_at=s.last_used_at,
        last_dried_at=s.last_dried_at,
        created_at=s.created_at,
    )


def _get_catalog():
    """Récupère une instance du catalogue Bambu depuis les fichiers locaux."""
    from ....services.bambu_catalog import BambuCatalogSync
    from ....core.config import settings
    return BambuCatalogSync(data_dir=settings.DATA_DIR)


@router.post("/filaments/enrich-from-catalog")
async def enrich_filaments_from_catalog(_: str = Depends(get_current_user)):
    """
    Pour tous les filaments Bambu Lab en base (ceux avec un profile_id),
    cherche leur entrée dans le catalogue local (filaments_color_codes.json)
    et met à jour : name, translated_name, material, color, multicolor_type,
    colors_array, fila_color_code.
    Retourne un bilan détaillé.
    """
    from ....services.bambu_catalog import BambuCatalogSync
    from ....core.config import settings
    cat = BambuCatalogSync(data_dir=settings.DATA_DIR)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Filament)
            .options(selectinload(Filament.spools))
            .where(Filament.profile_id.isnot(None))
        )
        filaments = result.scalars().all()

        # Filaments sans profile_id (non enrichissables)
        result_no_profile = await db.execute(
            select(Filament).where(
                (Filament.profile_id.is_(None)) | (Filament.profile_id == "")
            )
        )
        no_profile = [
            {"id": f.id, "name": f.name, "manufacturer": f.manufacturer}
            for f in result_no_profile.scalars().all()
            if "bambu" in (f.manufacturer or "").lower()
        ]

    updated, not_found, skipped = [], [], []

    import os as _os, json as _json
    cat_path = _os.path.join(settings.DATA_DIR, "bambu_catalog", "filaments_color_codes.json")
    if not _os.path.exists(cat_path):
        return {"error": "Catalogue non disponible — démarrez l'app pour le télécharger", "total_bambu": 0}

    cat_data = _json.loads(open(cat_path).read()).get("data", [])
    COLOR_TYPE_FR = {"单色": "monochrome", "渐变色": "gradient", "多拼色": "coaxial"}

    # Dict en→fr pour fallback traduction
    en_to_fr: dict = {}
    for e in cat_data:
        n = e.get("fila_color_name", {})
        en, fr = n.get("en",""), n.get("fr","")
        if en and fr:
            en_to_fr[en] = fr

    async with AsyncSessionLocal() as db:
        for f in filaments:
            if not f.color:
                skipped.append({"id": f.id, "name": f.name, "reason": "pas de couleur hex renseignée"})
                continue

            color_hex_raw = (f.color or "").lower().replace("#","")
            # Si 6 chars en DB → ajouter ff (alpha opaque) pour comparer avec catalogue 8 chars
            color_hex = color_hex_raw + "ff" if len(color_hex_raw) == 6 else color_hex_raw[:8]
            # Multicolore en base = filament avec colors_array ou multicolor_type != monochrome
            is_multi = (f.multicolor_type or "monochrome") != "monochrome"

            entry = None
            for e in cat_data:
                if e.get("fila_id","").upper() != (f.profile_id or "").upper():
                    continue
                e_colors = e.get("fila_color", [])
                e_ctype  = COLOR_TYPE_FR.get(e.get("fila_color_type",""), "monochrome")
                e_is_multi = e_ctype != "monochrome"

                # Cohérence mono↔mono / multi↔multi — évite de mapper un filament
                # monochrome sur une entrée bicolore qui aurait la même première couleur
                if is_multi != e_is_multi:
                    continue

                # Monochromes : comparer la première couleur (avec alpha padding)
                # Multicouleurs : ne PAS comparer la 1ère couleur seule — ordre catalogue peut différer
                if not is_multi:
                    ec = (e_colors[0]).lstrip("#").lower()[:8] if e_colors else ""
                    if ec != color_hex:
                        continue

                # Multicouleurs : comparer les sets de couleurs (ordre-indépendant, 6 chars RGB)
                if is_multi and f.colors_array:
                    db_cols = {c.strip().lstrip("#").lower()[:6] for c in f.colors_array.split(",") if c.strip()}
                    cat_cols = {c.lstrip("#").lower()[:6] for c in e_colors}
                    if db_cols and cat_cols and not (db_cols <= cat_cols or cat_cols <= db_cols):
                        continue
                elif is_multi:
                    # Pas de colors_array en DB : comparer uniquement la première couleur
                    ec = (e_colors[0]).lstrip("#").lower()[:8] if e_colors else ""
                    if ec != color_hex:
                        continue

                entry = e
                break

            if entry:
                names   = entry.get("fila_color_name", {})
                name_en = names.get("en") or names.get("fr") or next(iter(names.values()),"")
                name_fr = names.get("fr") or en_to_fr.get(name_en,"") or name_en
                colors  = [c.lstrip("#")[:8] for c in entry.get("fila_color", [])]
                ctype   = COLOR_TYPE_FR.get(entry.get("fila_color_type",""), "monochrome")
                fresh   = await db.get(Filament, f.id)
                changed: dict = {}

                def upd(attr, val):
                    if getattr(fresh, attr, None) != val:
                        setattr(fresh, attr, val)
                        changed[attr] = val

                upd("name",           name_en)
                upd("name_en",        name_en)
                upd("translated_name", name_fr)
                # material = famille (PLA), fila_type = variante (PLA Basic)
                _ft = entry.get("fila_type","")
                upd("material",       family_of(_ft, f.material))
                upd("fila_type",      _ft)
                upd("fila_color_code", entry.get("fila_color_code",""))
                upd("multicolor_type", ctype)
                if ctype != "monochrome" and len(colors) > 1:
                    upd("colors_array", ",".join(f"#{c}" for c in colors))
                f.color_bucket = buckets_for(f.color, f.colors_array)

                updated.append({"id": f.id, "name": name_en, "changes": list(changed.keys())})
            else:
                # N'afficher comme "introuvable" que les filaments Bambu Lab
                # (les filaments tiers ne sont pas dans ce catalogue)
                if "bambu" in (f.manufacturer or "").lower():
                    not_found.append({"id": f.id, "name": f.name, "profile_id": f.profile_id, "color": f.color})

        await db.commit()

    return {
        "total_bambu": len(filaments),
        "updated": len(updated),
        "not_found": len(not_found),
        "skipped": len(skipped),
        "details": {"updated": updated, "not_found": not_found, "skipped": skipped, "no_profile": no_profile},
    }


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
    import os, json as _json, re as _re
    from ....core.config import settings
    path = os.path.join(settings.DATA_DIR, "bambu_catalog", "filaments_color_codes.json")
    type_path = os.path.join(settings.DATA_DIR, "bambu_catalog", "filaments_type_mapping.json")
    if not os.path.exists(path):
        return {"entries": [], "available": False}

    try:
        data = _json.loads(open(path).read())
    except Exception:
        return {"entries": [], "available": False}

    # Charger le mapping famille→types pour filtrer par famille
    type_to_family: dict = {}
    if os.path.exists(type_path):
        try:
            mapping = _json.loads(open(type_path).read())
            for fam, types in mapping.items():
                for t in types:
                    type_to_family[t.lower()] = fam
        except Exception:
            pass

    COLOR_TYPE_FR = {
        "单色":  "monochrome",
        "渐变色": "gradient",
        "多拼色": "coaxial",
    }

    # Dict en→fr pour fallback traduction FR
    en_to_fr: dict = {}
    for e in data.get("data", []):
        n = e.get("fila_color_name", {})
        en, fr = n.get("en",""), n.get("fr","")
        if en and fr:
            en_to_fr[en] = fr

    results = []
    for entry in data.get("data", []):
        ftype = entry.get("fila_type", "")
        # Filtre famille
        if family:
            if type_to_family.get(ftype.lower(), "").lower() != family.lower():
                continue
        # Filtre type détaillé
        if fila_type and ftype.lower() != fila_type.lower():
            continue
        # Noms
        names = entry.get("fila_color_name", {})
        name_fr  = names.get("fr") or en_to_fr.get(names.get("en",""),"") or names.get("en") or next(iter(names.values()), "")
        name_en  = names.get("en") or names.get("fr") or next(iter(names.values()), "")
        fila_cc  = entry.get("fila_color_code", "")
        # Filtre recherche textuelle — insensible à la casse ET à la position
        # cherche dans le nom français, anglais ET le code couleur Bambu
        if q:
            ql = q.strip().lower()
            if (ql not in name_fr.lower() and
                ql not in name_en.lower() and
                ql not in fila_cc.lower()):
                continue
        colors = entry.get("fila_color", [])
        ctype_raw = entry.get("fila_color_type", "")
        results.append({
            "fila_id":          entry.get("fila_id", ""),
            "fila_color_code":  fila_cc,
            "color_code":       entry.get("color_code", ""),
            "fila_type":        ftype,
            "family":           type_to_family.get(ftype.lower(), ""),
            "name":             name_en,       # nom "officiel" non traduit (anglais)
            "name_fr":          name_fr,       # nom traduit français
            "color_hex":        colors[0].lstrip("#")[:8] if colors else "",
            "colors":           [c.lstrip("#")[:8] for c in colors],
            "color_type":       ctype_raw,
            "color_type_fr":    COLOR_TYPE_FR.get(ctype_raw, ctype_raw),
        })

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
            db.add(fil)
            await db.flush()
            filament_created = True

        spool = Spool(
            filament_id=fil.id,
            tag_number=tag_uid or None,
            remaining_weight_g=weight,
        )
        db.add(spool)
        await db.commit()
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
    (archivées ou non). Sinon retourne une erreur 409.
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

        await db.delete(f)
        await db.commit()

    _clear_match_cache()
    return {"ok": True}


@router.get("/{fid}/photos")
async def filament_photos(fid: int):
    """Liste les photos d'un filament depuis /data/filaments/{id}/"""
    import mimetypes
    from pathlib import Path as _Path
    fil_dir = _Path(DATA_DIR) / "filaments" / str(fid)
    if not fil_dir.exists():
        return {"files": []}
    files = []
    for f in sorted(fil_dir.iterdir()):
        if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
            files.append({"name": f.name, "url": f"/api/v1/filaments/{fid}/photo/{f.name}"})
    return {"files": files}


@router.get("/{fid}/photo/{filename}")
async def filament_photo(fid: int, filename: str):
    """Sert une photo de filament."""
    import mimetypes
    from pathlib import Path as _Path
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    path = _Path(DATA_DIR) / "filaments" / str(fid) / filename
    if not path.exists():
        raise HTTPException(404)
    mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
    return FileResponse(str(path), media_type=mime)


@router.delete("/{fid}/photo/{filename}")
async def delete_filament_photo(fid: int, filename: str, _: str = Depends(get_current_user)):
    if ".." in filename or "/" in filename:
        raise HTTPException(400, "Nom invalide")
    p = DATA_DIR / "filaments" / str(fid) / filename
    if not p.exists():
        raise HTTPException(404)
    p.unlink()
    return {"ok": True}


@router.post("/{fid}/photo/{filename}/primary")
async def set_primary_filament_photo(fid: int, filename: str, _: str = Depends(get_current_user)):
    if ".." in filename or "/" in filename:
        raise HTTPException(400, "Nom invalide")
    d = DATA_DIR / "filaments" / str(fid)
    p = d / filename
    if not p.exists():
        raise HTTPException(404)
    # Retirer l'ancien préfixe 00_ si existant
    for old in d.iterdir():
        if old.name.startswith("00_") and old.name != filename:
            old.rename(d / old.name[3:])
    if not filename.startswith("00_"):
        p.rename(d / f"00_{filename}")
    return {"ok": True}


@router.post("/{fid}/photos/upload")
async def upload_filament_photo(
    fid: int,
    file: UploadFile = File(...),
    _: str = Depends(get_current_user),
):
    """Upload une photo pour un filament."""
    import uuid as _uuid
    from fastapi import UploadFile as _UF
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Fichier image requis")
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    d = DATA_DIR / "filaments" / str(fid)
    d.mkdir(parents=True, exist_ok=True)
    dest = d / f"{_uuid.uuid4().hex[:12]}.{ext}"
    content = await file.read()
    dest.write_bytes(content)
    return {"ok": True, "filename": dest.name, "url": f"/api/v1/filaments/{fid}/photo/{dest.name}"}


@router.get("/spools/{sid}/usage")
async def spool_usage_history(sid: int, _: str = Depends(get_current_user)):
    """Retourne tous les FilamentUsage liés à cette bobine, avec infos du print."""
    from sqlalchemy import select as _sel
    from ....models.print_history import FilamentUsage as _FU, Print as _P
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            _sel(
                _FU.print_id, _FU.grams_used, _FU.cost,
                _P.file_name, _P.print_date, _P.status
            )
            .join(_P, _FU.print_id == _P.id)
            .where(_FU.spool_id == sid)
            .order_by(_P.print_date.desc())
        )).all()
    return [
        {
            "print_id":   r.print_id,
            "file_name":  r.file_name,
            "print_date":  r.print_date.isoformat() if r.print_date else None,
            "status":      r.status,
            "grams_used": r.grams_used,
            "cost":       r.cost,
        }
        for r in rows
    ]
