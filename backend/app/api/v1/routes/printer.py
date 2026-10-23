from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ....core.mqtt import get_state
from ....db.session import AsyncSessionLocal
from ....services.hms import decode_hms
from .auth import get_current_user


def _catalog_lookup(fila_id: str, color_hex: str, cols: list = None) -> Optional[str]:
    """Lookup nom FR dans le catalogue Bambu local.
    cols = champ MQTT 'cols' du tray. Si len(cols) > 1 → multicolore, sinon mono.
    Filtre les entrées catalogue selon ce type.
    """
    if not fila_id:
        return None
    try:
        from ....core.config import settings
        import os, json as _j
        path = os.path.join(settings.DATA_DIR, "bambu_catalog", "filaments_color_codes.json")
        if not os.path.exists(path):
            return None
        data = _j.loads(open(path).read()).get("data", [])
        en_to_fr = {e.get("fila_color_name",{}).get("en",""): e.get("fila_color_name",{}).get("fr","")
                    for e in data if e.get("fila_color_name",{}).get("en") and e.get("fila_color_name",{}).get("fr")}

        COLOR_TYPE = {"\u5355\u8272": "monochrome", "\u6e10\u53d8\u8272": "gradient", "\u591a\u62fc\u8272": "coaxial"}
        tray_is_multi = bool(cols and len(cols) > 1)

        def norm8(h):
            h = h.replace("#","").lower()
            return h + "ff" if len(h) == 6 else h[:8]

        tray_hexes = {norm8(c) for c in cols} if tray_is_multi else {norm8(color_hex)}

        for e in data:
            if e.get("fila_id","").upper() != fila_id.upper():
                continue
            e_is_multi = COLOR_TYPE.get(e.get("fila_color_type",""), "monochrome") != "monochrome"
            if tray_is_multi != e_is_multi:
                continue
            e_hexes = {norm8(c) for c in e.get("fila_color", [])}
            # Mono : tray_color dans les couleurs catalogue
            # Multi : intersection non vide (couleurs communes)
            if tray_is_multi:
                if not (tray_hexes & e_hexes):
                    continue
            else:
                if not (tray_hexes & e_hexes):
                    continue
            names = e.get("fila_color_name", {})
            name_en = names.get("en", "")
            return names.get("fr") or en_to_fr.get(name_en) or name_en or None
    except Exception:
        pass
    return None

router = APIRouter()


class NozzleTempOut(BaseModel):
    id: int
    temp: float
    target: float
    active: bool


class SpoolInfoOut(BaseModel):
    id: int
    filament_id: Optional[int] = None   # pour ouvrir la fiche filament depuis un slot AMS
    name: Optional[str] = None
    translated_name: Optional[str] = None
    color: Optional[str] = None
    material: Optional[str] = None
    fila_type: Optional[str] = None   # sous-type complet (PLA Basic, PETG-HF…)
    brand: Optional[str] = None
    profile_id: Optional[str] = None
    multicolor_type: Optional[str] = None
    colors_array: Optional[str] = None
    remaining_weight_g: Optional[float] = None
    initial_weight_g: Optional[float] = None
    spool_weight_g: Optional[float] = None
    price: Optional[float] = None
    price_override: Optional[float] = None
    location: Optional[str] = None
    tag_number: Optional[str] = None
    ams_tray: Optional[str] = None
    comment: Optional[str] = None
    found_mode: Optional[str] = None
    external_spool_id: Optional[str] = None
    first_used_at: Optional[str] = None
    last_used_at: Optional[str] = None
    # Manquaient pour que la feuille de l'accueil affiche les memes lignes que
    # la fiche bobine : sans eux, deux ecrans decrivant le meme objet n'en
    # disaient pas la meme chose.
    last_dried_at: Optional[str] = None
    swatch: Optional[bool] = None
    # Pas sechee depuis plus de 6 mois (meme regle que l'alerte) : pastille
    # sur la tuile AMS, comme « pas d'echantillon ».
    needs_drying: Optional[bool] = None
    # Restant cumule de toutes les bobines actives du filament.
    filament_stock_g: Optional[float] = None
    # Pour la fiche « filament en cours » de l'accueil
    color_code: Optional[str] = None     # code couleur du catalogue Bambu (ex. 10600)
    name_en: Optional[str] = None
    spool_tare_name: Optional[str] = None
    created_at: Optional[str] = None     # bobine ajoutee le
    to_order: Optional[bool] = None
    label_printed: Optional[bool] = None

class TrayOut(BaseModel):
    id: int
    color: str
    filament_type: str
    tray_id_name: str
    tray_info_idx: str = ""
    remain: int
    uuid: str
    tag_uid: str
    empty: bool
    drying_temp: int
    drying_time: int
    spool_id: Optional[int] = None
    match_mode: str = ""
    spool_info: Optional[SpoolInfoOut] = None
    catalog_name: Optional[str] = None
    # Emplacement VIDE ou une bobine est posee pour le sechage (sans etre
    # inseree) : services/drying_slots.
    drying_spool: Optional[SpoolInfoOut] = None
    cols: list = []     # couleurs Bambu raw (champ 'cols' MQTT) — liste hex
    ctype: str = ""     # type couleur Bambu (int ou str selon firmware) ('gradient','coaxial'…)


class AMSOut(BaseModel):
    id: int
    trays: list[TrayOut]
    humidity: int
    temp: float
    is_drying: bool = False     # vrai si dry_time > 0
    dry_time: int = 0           # secondes restantes (0 = pas en séchage)
    dry_temperature: int = 0    # °C cible
    dry_duration: int = 0       # durée totale configurée (minutes)
    dry_filament: str = ""      # type filament en séchage
    extruder_id: int = -1       # buse alimentee : 0 droite, 1 gauche, -1 inconnue
    switch_port: str = ""       # entree de l'aiguillage ("A"/"B") quand il passe par lui
    dry_status: int = -1        # phase du sechage (-1 inconnue, 0 arret, 1 verif., 2 sechage, 3 refroid., 4 arret, 5 erreur, 6 hors controle)
    dry_sub_status: int = 0     # 1 chauffe, 2 deshumidification
    dry_fan1: int = 0
    dry_fan2: int = 0
    dry_cannot: list[int] = []  # raisons qui empechent de secher (dry_sf_reason)


class HotendSlotOut(BaseModel):
    id: int
    color: str
    filament_id: str
    diameter: float
    nozzle_type: str
    serial: str
    wear: float
    print_time: int
    empty: bool
    spool_id: Optional[int] = None


class HotendRackOut(BaseModel):
    hotends: list[HotendSlotOut]
    active_id: int
    target_id: int
    state: int
    holder_pos: int
    holder_stat: int
    holder_job: int
    head_id: int = -1


class PrinterStatusOut(BaseModel):
    model_config = {"protected_namespaces": ()}
    connected: bool
    serial: str
    status: str
    progress: float
    layer: int
    total_layers: int
    remaining_minutes: int
    nozzles: list[NozzleTempOut]
    bed_temp: float
    target_bed_temp: float
    chamber_temp: float
    target_chamber_temp: float = 0.0
    print_name: str
    job_id: str
    design_id: str
    model_id: str
    gcode_file: str
    print_stage: int
    speed_level: int
    speed_mag: int
    ams_list: list[AMSOut]
    ams_mapping: list[int]
    active_ams_id: int
    active_tray_id: int
    active_tray_local: int = -1
    hotend_rack: HotendRackOut
    hms_errors: list[dict]
    hms_decoded: list[dict] = []
    print_error: int
    fw_version: str
    fila_switch: dict = {}


def _spool_info(spool_id, spools_map):
    if not spool_id or spool_id not in spools_map:
        return None
    s, f = spools_map[spool_id]
    return SpoolInfoOut(
        id=s.id,
        filament_id=(f.id if f else (s.filament_id if s else None)),
        name=f.name if f else None,
        translated_name=getattr(f, "translated_name", None) if f else None,
        color=f"#{f.color}" if (f and f.color) else None,
        material=f.material if f else None,
        fila_type=(f.fila_type if f else None),
        brand=f.manufacturer if f else None,
        profile_id=f.profile_id if f else None,
        multicolor_type=f.multicolor_type if f else None,
        colors_array=f.colors_array if f else None,
        remaining_weight_g=s.remaining_weight_g,
        initial_weight_g=f.filament_weight_g if f else None,
        spool_weight_g=f.spool_weight_g if f else None,
        price=f.price if f else None,
        price_override=s.price_override,
        location=s.location,
        tag_number=s.tag_number,
        ams_tray=s.ams_tray,
        comment=s.comment,
        found_mode=getattr(s, "found_mode", None),
        external_spool_id=s.external_spool_id,
        first_used_at=str(s.first_used_at) if s.first_used_at else None,
        last_used_at=str(s.last_used_at) if s.last_used_at else None,
        last_dried_at=str(s.last_dried_at) if getattr(s, "last_dried_at", None) else None,
        swatch=bool(getattr(f, "swatch", False)) if f else None,
        color_code=getattr(f, "fila_color_code", None) if f else None,
        name_en=getattr(f, "name_en", None) if f else None,
        spool_tare_name=getattr(f, "spool_tare_name", None) if f else None,
        created_at=str(s.created_at) if getattr(s, "created_at", None) else None,
        to_order=bool(getattr(f, "to_order", False)) if f else None,
        label_printed=bool(getattr(f, "label_printed", False)) if f else None,
    )


def _tray_spool_info(t, spools_map, stock_map=None):
    """
    Fiche de la bobine d'un bac. Le cache pose au moment ou la bobine a ete
    reconnue sert pour tout, sauf l'echantillon : il change sans que la bobine
    bouge (case cochee a la main, QR scanne), et le cache l'aurait fige -- la
    pastille « pas d'echantillon » serait restee sur l'accueil apres coup. On le
    relit donc dans le filament charge a chaque appel.
    """
    cached = getattr(t, "_spool_info_cache", None)
    if t.spool_id and t.spool_id in spools_map:
        si = _spool_info(t.spool_id, spools_map)
    else:
        si = SpoolInfoOut(**cached) if cached else _spool_info(t.spool_id, spools_map)
    if si is not None and t.spool_id in spools_map:
        sp, f = spools_map[t.spool_id]
        si.swatch = bool(f.swatch) if f is not None else None
        # Meme raison pour le sechage : l'AMS seche la bobine sans qu'elle bouge.
        from ....services.drying import needs_drying
        si.last_dried_at = str(sp.last_dried_at) if sp.last_dried_at else None
        si.needs_drying = needs_drying(sp, f)
        if stock_map is not None and f is not None:
            si.filament_stock_g = stock_map.get(f.id)
    return si


@router.get("/status", response_model=PrinterStatusOut)
async def printer_status(_: str = Depends(get_current_user)):
    from sqlalchemy import select as _sel
    from ....models.filament import Spool as _Spool, Filament as _Fil
    s = get_state()
    # Charger les bobines liées aux trays AMS
    _spools_map = {}
    _stock_map = {}
    from ....services import drying_slots as _dslots
    # Un filament insere la ou une bobine etait posee : l'association tombe.
    await _dslots.prune(s.ams_list)
    all_spool_ids = [
        t.spool_id
        for a in s.ams_list for t in a.trays if t.spool_id
    ] + [e["spool_id"] for e in _dslots.current().values()]
    if all_spool_ids:
        from ....services import drying as _drying
        async with AsyncSessionLocal() as db:
            await _drying.load(db)
            spools_r = await db.execute(_sel(_Spool).where(_Spool.id.in_(all_spool_ids)))
            for sp in spools_r.scalars().all():
                fil = await db.get(_Fil, sp.filament_id) if sp.filament_id else None
                _spools_map[sp.id] = (sp, fil)
            # Stock de chaque filament en place : somme du restant de ses
            # bobines actives (celle de l'AMS comprise).
            from sqlalchemy import func as _func
            fil_ids = {f.id for _, f in _spools_map.values() if f is not None}
            if fil_ids:
                _stock_map = dict((await db.execute(
                    _sel(_Spool.filament_id, _func.coalesce(_func.sum(_Spool.remaining_weight_g), 0))
                    .where(_Spool.filament_id.in_(fil_ids), _Spool.archived.is_(False))
                    .group_by(_Spool.filament_id)
                )).all())
    return PrinterStatusOut(
        connected=s.connected,
        serial=s.serial,
        status=s.status,
        progress=s.progress,
        layer=s.layer,
        total_layers=s.total_layers,
        remaining_minutes=s.remaining_minutes,
        nozzles=[
            NozzleTempOut(id=n.id, temp=n.temp, target=n.target, active=n.active)
            for n in s.nozzles
        ],
        bed_temp=s.bed_temp,
        target_bed_temp=s.target_bed_temp,
        chamber_temp=s.chamber_temp,
        target_chamber_temp=getattr(s, "target_chamber_temp", 0.0) or 0.0,
        print_name=s.print_name,
        job_id=s.job_id,
        design_id=s.design_id,
        model_id=s.model_id,
        gcode_file=s.gcode_file,
        print_stage=s.print_stage,
        speed_level=s.speed_level,
        speed_mag=s.speed_mag,
        ams_list=[
            AMSOut(
                id=a.id,
                trays=[TrayOut(
                    id=t.id, color=t.color, filament_type=t.filament_type,
                    tray_id_name=t.tray_id_name,
                    tray_info_idx=getattr(t, "tray_info_idx", ""),
                    remain=t.remain,
                    uuid=t.uuid, tag_uid=t.tag_uid, empty=t.empty,
                    drying_temp=t.drying_temp, drying_time=t.drying_time,
                    spool_id=t.spool_id,
                    match_mode=getattr(t, "match_mode", ""),
                    spool_info=_tray_spool_info(t, _spools_map, _stock_map),
                    drying_spool=(_spool_info(_dslots.spool_at(a.id, t.id), _spools_map)
                                  if t.empty and _dslots.spool_at(a.id, t.id) else None),
                    cols=getattr(t, "cols", []) or [],
                    ctype=str(getattr(t, "ctype", "") or ""),
                    catalog_name=(
                        None if t.spool_id
                        else _catalog_lookup(
                            getattr(t, "tray_info_idx", ""),
                            t.color,
                            getattr(t, "cols", []) or []
                        )
                        if getattr(t, "tray_info_idx", "") else None
                    ),
                ) for t in a.trays],
                humidity=a.humidity, temp=a.temp,
                is_drying=a.dry_time > 0,
                dry_time=a.dry_time,
                dry_temperature=a.dry_temperature,
                dry_duration=a.dry_duration,
                dry_filament=a.dry_filament,
                extruder_id=getattr(a, "extruder_id", -1),
                switch_port=getattr(a, "switch_port", ""),
                dry_status=getattr(a, "dry_status", -1),
                dry_sub_status=getattr(a, "dry_sub_status", 0),
                dry_fan1=getattr(a, "dry_fan1", 0),
                dry_fan2=getattr(a, "dry_fan2", 0),
                dry_cannot=list(getattr(a, "dry_cannot", []) or []),
            ) for a in s.ams_list
        ],
        ams_mapping=s.ams_mapping,
        active_ams_id=s.active_ams_id,
        active_tray_id=s.active_tray_id,
        active_tray_local=s.active_tray_local,
        hotend_rack=HotendRackOut(
            hotends=[HotendSlotOut(
                id=h.id, color=h.color, filament_id=h.filament_id,
                diameter=h.diameter, nozzle_type=h.nozzle_type,
                serial=h.serial, wear=h.wear, print_time=h.print_time,
                empty=h.empty, spool_id=h.spool_id,
            ) for h in s.hotend_rack.hotends],
            active_id=s.hotend_rack.active_id,
            target_id=s.hotend_rack.target_id,
            state=s.hotend_rack.state,
            holder_pos=s.hotend_rack.holder_pos,
            holder_stat=s.hotend_rack.holder_stat,
            holder_job=s.hotend_rack.holder_job,
            head_id=s.hotend_rack.head_id,
        ),
        hms_errors=s.hms_errors,
        hms_decoded=decode_hms(s.hms_errors, model_id=getattr(s, "model_id", "") or "", model_name=getattr(s, "printer_model", "") or ""),
        print_error=s.print_error,
        fw_version=s.fw_version,
        fila_switch=getattr(s, "fila_switch", {}) or {},
    )


# ── Bobines posees pour le sechage (emplacement vide) ─────────────────────────
@router.put("/ams/{ams_id}/{tray_id}/drying")
async def place_drying_spool(ams_id: int, tray_id: int, body: dict = Body({}),
                             _: str = Depends(get_current_user)):
    """Pose une bobine dans un emplacement AMS VIDE pour le sechage."""
    from ....services import drying_slots as _dslots
    from ....models.filament import Spool as _Spool
    st = get_state()
    a = next((a for a in (st.ams_list or []) if a.id == ams_id), None)
    t = next((t for t in (a.trays if a else []) if t.id == tray_id), None)
    if t is None:
        raise HTTPException(404, "Emplacement introuvable")
    if not t.empty:
        raise HTTPException(400, "Emplacement occupé : un filament y est inséré")
    try:
        sid = int(body.get("spool_id"))
    except (TypeError, ValueError):
        raise HTTPException(400, "spool_id requis")
    async with AsyncSessionLocal() as db:
        sp = await db.get(_Spool, sid)
        if not sp or sp.archived:
            raise HTTPException(404, "Bobine introuvable ou archivée")
    await _dslots.place(ams_id, tray_id, sid)
    return {"ok": True}


@router.delete("/ams/{ams_id}/{tray_id}/drying")
async def remove_drying_spool(ams_id: int, tray_id: int, _: str = Depends(get_current_user)):
    from ....services import drying_slots as _dslots
    return {"ok": await _dslots.remove(ams_id, tray_id)}
