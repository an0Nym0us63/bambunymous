from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from ....core.mqtt import get_state
from ....db.session import AsyncSessionLocal
from ....services.hms import decode_hms
from .auth import get_current_user, require_admin


# La porte et le capot du haut par les alertes de l'imprimante (24/10/2026, codes de la serie H2 tires
# des fichiers HMS de Bambu Studio) : 0300-9600 la porte, 0300-9700 le capot ; 0003-0001 « est ouvert »,
# 0001-0001 « semble ouvert, impression en pause ». Elles ne partent que si la detection d'ouverture
# est activee sur l'imprimante.
_OPEN_CODES = (0x00030001, 0x00010001)


def _hms_has(s, attr: int) -> bool:
    for e in getattr(s, "hms_errors", None) or []:
        try:
            if int(e.get("attr", 0)) == attr and int(e.get("code", 0)) in _OPEN_CODES:
                return True
        except (TypeError, ValueError):
            pass
    return False


def _door(s):
    """La porte : le capteur lu dans « stat » d'abord, sinon l'alerte d'ouverture."""
    d = getattr(s, "door_open", None)
    return True if d is None and _hms_has(s, 0x03009600) else d


def _top(s):
    """Le capot du haut : pareil, « stat » d'abord, sinon son alerte."""
    d = getattr(s, "top_open", None)
    return (_hms_has(s, 0x03009700) or None) if d is None else d


# Le catalogue Bambu (quelques milliers d'entrees) etait relu et re-analyse a chaque lecture de l'etat de
# l'imprimante, pour chaque bobine sans fiche (28/10/2026) : garde en memoire, relu quand le fichier change.
_CATALOG = {"path": None, "mtime": None, "data": None, "fr": None}


def _catalog_data():
    """(entrees, nom anglais -> nom francais) du catalogue local ; (None, None) sans fichier."""
    from ....core.config import settings
    import os, json as _j
    path = os.path.join(settings.DATA_DIR, "bambu_catalog", "filaments_color_codes.json")
    try:
        mtime = os.stat(path).st_mtime
    except OSError:
        return None, None
    c = _CATALOG
    if c["path"] != path or c["mtime"] != mtime or c["data"] is None:
        with open(path, encoding="utf-8") as f:
            data = _j.load(f).get("data", [])
        en_to_fr = {e.get("fila_color_name", {}).get("en", ""): e.get("fila_color_name", {}).get("fr", "")
                    for e in data if e.get("fila_color_name", {}).get("en") and e.get("fila_color_name", {}).get("fr")}
        c.update(path=path, mtime=mtime, data=data, fr=en_to_fr)
    return c["data"], c["fr"]


def _catalog_lookup(fila_id: str, color_hex: str, cols: list = None) -> Optional[str]:
    """Lookup nom FR dans le catalogue Bambu local.
    cols = champ MQTT 'cols' du tray. Si len(cols) > 1 → multicolore, sinon mono.
    Filtre les entrées catalogue selon ce type.
    """
    if not fila_id:
        return None
    try:
        data, en_to_fr = _catalog_data()
        if data is None:
            return None

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
    slot_ams: int = -1      # l'emplacement charge dans cette buse (unite, bac), -1 si rien
    slot_tray: int = -1
    has_filament: bool | None = None   # filament engage dans l'extrudeuse (None : inconnu)


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
    fila_finish: Optional[str] = None
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
    # Nombre de bobines actives du filament (celle-ci comprise) : la fiche les dessine empilees, avec « +x ».
    filament_spools: Optional[int] = None
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
    stat: int = -1
    spool_id: Optional[int] = None
    fila_finish: Optional[str] = None    # la finition du filament qu'elle porte (celle de la bobine de l'AMS)
    multicolor_type: Optional[str] = None   # et son multicolore (degrade, coaxial), avec ses couleurs (28/10/2026)
    colors_array: Optional[str] = None


class HotendRackOut(BaseModel):
    hotends: list[HotendSlotOut]
    active_id: int
    target_id: int
    state: int
    holder_pos: int
    holder_stat: int
    holder_job: int
    holder_cali: int = -1
    reading: int = 0
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
    door_open: Optional[bool] = None      # None : l'imprimante ne le dit pas
    light_on: Optional[bool] = None       # lumiere de la chambre
    top_open: Optional[bool] = None       # capot du haut (H2) : « stat », sinon ses alertes HMS
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
    printer_model: str = ""


# le modele de l'imprimante (choisi, deduit du numero de serie ou de l'historique), relu toutes les 5 min
_MODEL = {"at": 0.0, "v": ""}


async def _model() -> str:
    import time as _t
    if _t.time() - _MODEL["at"] > 300:
        from ....services.makerworld import my_printer
        _MODEL["v"], _MODEL["at"] = await my_printer(), _t.time()
    return _MODEL["v"]


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
        fila_finish=f.fila_finish if f else None,
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
            g, n = stock_map.get(f.id, (None, None))
            si.filament_stock_g, si.filament_spools = g, n
    return si


@router.get("/sd/probe")
async def printer_sd_probe(_: str = Depends(require_admin)):
    """La carte SD de l'imprimante : la racine et « timelapse », pour savoir si elle s'ouvre."""
    from ....services.sd_card import probe
    return await probe()


# ── Les timelapses de la carte SD (26/10/2026) ──
def _sd(e):
    raise HTTPException(503, str(e))


@router.get("/sd/timelapses")
async def printer_sd_timelapses(fresh: bool = False, _: str = Depends(get_current_user)):
    from ....services import sd_card as SD
    try:
        return await SD.timelapses(fresh)
    except SD.SdError as e:
        _sd(e)


# le rattrapage : les timelapses deja sur l'imprimante, copies dans la fiche de leur impression passee
_ATTACH_TASKS: set = set()


@router.post("/sd/timelapses/attach")
async def printer_sd_attach(_: str = Depends(require_admin)):
    import asyncio
    from ....services import sd_card as SD
    if not SD.ATTACH["running"]:
        t = asyncio.get_running_loop().create_task(SD.attach_all())
        _ATTACH_TASKS.add(t)
        t.add_done_callback(_ATTACH_TASKS.discard)
        await asyncio.sleep(0.3)
    return dict(SD.ATTACH)


@router.get("/sd/timelapses/attach")
async def printer_sd_attach_status(_: str = Depends(get_current_user)):
    from ....services import sd_card as SD
    return dict(SD.ATTACH)


@router.get("/sd/timelapse/thumb/{name}")
async def printer_sd_thumb(name: str, request: Request):
    """La vignette (ouverte comme les autres images de l'appli : une balise img n'envoie pas de jeton)."""
    from fastapi.responses import FileResponse
    from ....services import sd_card as SD
    try:
        f = await SD.thumb(name.rsplit(".", 1)[0] + ".mp4" if name.endswith(".jpg") else name, request.is_disconnected)
    except SD.SdError as e:
        _sd(e)
    return FileResponse(f, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/sd/timelapse/video/{name}")
async def printer_sd_video(name: str, request: Request, h264: bool = False):
    """La video, copiee sur le serveur a la premiere lecture ; avance et retour (Range) par FileResponse.
    ?h264=1 : une version convertie, quand le navigateur ne lit pas celle de l'imprimante."""
    from fastapi.responses import FileResponse
    from ....services import sd_card as SD
    try:
        f = await (SD.video_h264(name, request.is_disconnected) if h264 else SD.video(name, request.is_disconnected))
    except SD.SdError as e:
        _sd(e)
    return FileResponse(f, media_type="video/mp4" if (h264 or name.endswith(".mp4")) else "video/x-msvideo",
                        headers={"Cache-Control": "private, max-age=86400"})


@router.delete("/sd/timelapse/{name}")
async def printer_sd_delete(name: str, _: str = Depends(require_admin)):
    from ....services import sd_card as SD
    try:
        await SD.delete(name)
    except SD.SdError as e:
        _sd(e)
    return {"ok": True}


@router.get("/details")
async def printer_details(_: str = Depends(get_current_user)):
    """Tout ce que l'imprimante envoie, range par themes (fenetre « Plus d'infos »)."""
    from ....services.printer_details import build
    return build(get_state())


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
            # chaque bobine avec son filament, en une requete (une par bobine avant le 26/10/2026 : l'etat de
            # l'imprimante, relu toutes les quelques secondes, en faisait une trentaine)
            spools_r = await db.execute(_sel(_Spool, _Fil).outerjoin(_Fil, _Fil.id == _Spool.filament_id)
                                        .where(_Spool.id.in_(all_spool_ids)))
            for sp, fil in spools_r.all():
                _spools_map[sp.id] = (sp, fil)
            # Stock de chaque filament en place : somme du restant de ses
            # bobines actives (celle de l'AMS comprise).
            from sqlalchemy import func as _func
            fil_ids = {f.id for _, f in _spools_map.values() if f is not None}
            if fil_ids:
                _stock_map = {fid: (g, n) for fid, g, n in (await db.execute(
                    _sel(_Spool.filament_id, _func.coalesce(_func.sum(_Spool.remaining_weight_g), 0), _func.count(_Spool.id))
                    .where(_Spool.filament_id.in_(fil_ids), _Spool.archived.is_(False))
                    .group_by(_Spool.filament_id)
                )).all()}
    out = PrinterStatusOut(
        connected=s.connected,
        serial=s.serial,
        status=s.status,
        progress=s.progress,
        layer=s.layer,
        total_layers=s.total_layers,
        remaining_minutes=s.remaining_minutes,
        nozzles=[
            NozzleTempOut(id=n.id, temp=n.temp, target=n.target, active=n.active,
                          slot_ams=getattr(n, "slot_ams", -1), slot_tray=getattr(n, "slot_tray", -1),
                          has_filament=getattr(n, "has_filament", None))
            for n in s.nozzles
        ],
        bed_temp=s.bed_temp,
        target_bed_temp=s.target_bed_temp,
        chamber_temp=s.chamber_temp,
        target_chamber_temp=getattr(s, "target_chamber_temp", 0.0) or 0.0,
        door_open=_door(s),
        light_on=getattr(s, "light_on", None),
        top_open=_top(s),
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
                empty=h.empty, spool_id=h.spool_id, stat=getattr(h, "stat", -1),
            ) for h in s.hotend_rack.hotends],
            active_id=s.hotend_rack.active_id,
            target_id=s.hotend_rack.target_id,
            state=s.hotend_rack.state,
            holder_pos=s.hotend_rack.holder_pos,
            holder_stat=s.hotend_rack.holder_stat,
            holder_job=s.hotend_rack.holder_job,
            holder_cali=getattr(s.hotend_rack, "holder_cali", -1),
            reading=getattr(s.hotend_rack, "reading", 0),
            head_id=s.hotend_rack.head_id,
        ),
        hms_errors=s.hms_errors,
        hms_decoded=decode_hms(s.hms_errors, model_id=getattr(s, "model_id", "") or "", model_name=getattr(s, "printer_model", "") or ""),
        print_error=s.print_error,
        fw_version=s.fw_version,
        fila_switch=getattr(s, "fila_switch", {}) or {},
        printer_model=await _model(),
    )
    _hotend_finishes(out)
    return out


def _hotend_finishes(out):
    """La finition du filament d'une buse du rack : celle de la bobine d'AMS de meme filament (identifiant Bambu)
    et de meme couleur, sinon de meme filament. Pour que la buse s'affiche comme la bobine (marbre, silk...)."""
    from ....services.mw_3d import finish_of
    by_id, by_col = {}, {}
    for a in out.ams_list:
        for t in a.trays:
            if t.empty or not t.tray_info_idx:
                continue
            si = t.spool_info
            f = (si.fila_finish if si and si.fila_finish else None) or finish_of(
                si.fila_type if si else "", si.name if si else "", t.filament_type, color=t.color)
            mt = si.multicolor_type if si and si.multicolor_type in ("gradient", "coaxial") and si.colors_array else None
            if (f == "none" or not f) and not mt:
                continue
            v = (f if f and f != "none" else None, mt, si.colors_array if mt else None)
            by_id.setdefault(t.tray_info_idx, v)
            by_col.setdefault((t.tray_info_idx, str(t.color or "")[:6].upper()), v)
    for h in out.hotend_rack.hotends:
        if not h.empty and h.filament_id:
            v = by_col.get((h.filament_id, str(h.color or "").lstrip("#")[:6].upper())) or by_id.get(h.filament_id)
            if v:
                h.fila_finish, h.multicolor_type, h.colors_array = v


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
