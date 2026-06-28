from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from ....core.mqtt import get_state
from .auth import get_current_user

router = APIRouter()


class NozzleTempOut(BaseModel):
    id: int
    temp: float
    target: float
    active: bool


class TrayOut(BaseModel):
    id: int
    color: str
    filament_type: str
    tray_id_name: str
    remain: int
    uuid: str
    tag_uid: str
    empty: bool
    drying_temp: int
    drying_time: int
    spool_id: Optional[int] = None


class AMSOut(BaseModel):
    id: int
    trays: list[TrayOut]
    humidity: int
    temp: float


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
    hotend_rack: HotendRackOut
    hms_errors: list[dict]
    print_error: int
    fw_version: str


@router.get("/status", response_model=PrinterStatusOut)
async def printer_status(_: str = Depends(get_current_user)):
    s = get_state()
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
                    tray_id_name=t.tray_id_name, remain=t.remain,
                    uuid=t.uuid, tag_uid=t.tag_uid, empty=t.empty,
                    drying_temp=t.drying_temp, drying_time=t.drying_time,
                    spool_id=t.spool_id,
                ) for t in a.trays],
                humidity=a.humidity, temp=a.temp,
            ) for a in s.ams_list
        ],
        ams_mapping=s.ams_mapping,
        active_ams_id=s.active_ams_id,
        active_tray_id=s.active_tray_id,
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
