from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from ....core.mqtt import get_state
from ....db.session import AsyncSessionLocal
from .auth import get_current_user


def _catalog_lookup(fila_id: str, color_hex: str) -> Optional[str]:
    """Lookup nom FR dans le catalogue Bambu local pour un tray non matché.
    Retourne None si absent. Vérifie la cohérence mono↔mono / multi↔multi.
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
        COLOR_TYPE = {"单色": "monochrome", "渐变色": "gradient", "多拼色": "coaxial"}
        h = color_hex.replace("#","").lower()
        h8 = h + "ff" if len(h) == 6 else h[:8]

        for e in data:
            if e.get("fila_id","").upper() != fila_id.upper():
                continue
            # Cohérence mono↔mono : le tray a UNE couleur → ne matcher que les entrées monochromes
            e_ctype = COLOR_TYPE.get(e.get("fila_color_type",""), "monochrome")
            e_is_multi = e_ctype != "monochrome"
            # Le tray AMS n'a qu'une couleur → forcément mono
            if e_is_multi:
                continue
            ec = (e.get("fila_color",[""])[0]).lstrip("#").lower()
            ec8 = ec + "ff" if len(ec) == 6 else ec[:8]
            if ec8 != h8:
                continue
            names = e.get("fila_color_name", {})
            name_en = names.get("en","")
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
    name: Optional[str] = None
    translated_name: Optional[str] = None
    color: Optional[str] = None
    material: Optional[str] = None
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
    catalog_name: Optional[str] = None   # nom catalogue Bambu si tray non matché


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
    print_error: int
    fw_version: str


def _spool_info(spool_id, spools_map):
    if not spool_id or spool_id not in spools_map:
        return None
    s, f = spools_map[spool_id]
    return SpoolInfoOut(
        id=s.id,
        name=f.name if f else None,
        translated_name=getattr(f, "translated_name", None) if f else None,
        color=f"#{f.color}" if (f and f.color) else None,
        material=f.material if f else None,
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
    )


@router.get("/status", response_model=PrinterStatusOut)
async def printer_status(_: str = Depends(get_current_user)):
    from sqlalchemy import select as _sel
    from ....models.filament import Spool as _Spool, Filament as _Fil
    s = get_state()
    # Charger les bobines liées aux trays AMS
    _spools_map = {}
    all_spool_ids = [
        t.spool_id
        for a in s.ams_list for t in a.trays if t.spool_id
    ]
    if all_spool_ids:
        async with AsyncSessionLocal() as db:
            spools_r = await db.execute(_sel(_Spool).where(_Spool.id.in_(all_spool_ids)))
            for sp in spools_r.scalars().all():
                fil = await db.get(_Fil, sp.filament_id) if sp.filament_id else None
                _spools_map[sp.id] = (sp, fil)
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
                    spool_info=(lambda si: SpoolInfoOut(**si) if si else _spool_info(t.spool_id, _spools_map))(getattr(t, "_spool_info_cache", None)),
                    catalog_name=(
                        None if t.spool_id  # déjà matché → pas besoin
                        else _catalog_lookup(getattr(t, "tray_info_idx", ""), t.color)
                        if getattr(t, "tray_info_idx", "") else None
                    ),
                ) for t in a.trays],
                humidity=a.humidity, temp=a.temp,
                is_drying=a.dry_time > 0,
                dry_time=a.dry_time,
                dry_temperature=a.dry_temperature,
                dry_duration=a.dry_duration,
                dry_filament=a.dry_filament,
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
        print_error=s.print_error,
        fw_version=s.fw_version,
    )
