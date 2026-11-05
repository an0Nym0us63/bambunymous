"""Suivi du filament couche par couche (02/11/2026, toujours actif depuis le 03/11/2026) : ou en est l'impression en
cours, et le changement de bobine en cours de route. Voir services/live_usage.py."""
from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import get_current_user, require_admin
from ....services import live_usage as L

router = APIRouter()


# lu par une page d'avant le 03/11/2026 (l'interrupteur n'existe plus)
@router.get("/mode")
async def live_mode(_: str = Depends(get_current_user)):
    return {"on": L.enabled()}


@router.get("/current")
async def live_current(_: str = Depends(get_current_user)):
    """L'impression en cours, filament par filament (rien sur « Actuel »)."""
    if not L.enabled():
        return {"on": False}
    pid = await L.current_print_id()
    return {"on": True, **(await L.live(pid) if pid else {})}


@router.get("/layer")
async def live_layer(print_id: int | None = None, n: int | None = None, _: str = Depends(get_current_user)):
    """Le dessin d'une couche (02/11/2026) : l'impression en cours par defaut, a la couche que l'imprimante annonce.
    Affichage seulement, quel que soit le suivi choisi."""
    from sqlalchemy import select
    from ....core.mqtt import get_state
    from ....db.session import AsyncSessionLocal
    from ....models.print_history import Print, FilamentUsage
    from ....models.filament import Spool, Filament
    from ....services import layer_view as LV
    cur = await L.current_print_id()
    pid = print_id or cur
    if not pid:
        return {"ok": False, "why": "none"}
    s = get_state()
    live = pid == cur and s is not None and (s.layer or 0) > 0
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            raise HTTPException(404)
        rows = (await db.execute(select(FilamentUsage.ams_slot, FilamentUsage.color_hex, Filament.color, Filament.translated_name, Filament.name,
                                        Filament.manufacturer, Filament.material, Filament.fila_type, FilamentUsage.filament_type)
                                 .outerjoin(Spool, Spool.id == FilamentUsage.spool_id)
                                 .outerjoin(Filament, Filament.id == Spool.filament_id)
                                 .where(FilamentUsage.print_id == pid).order_by(FilamentUsage.id))).all()
    # et leur nom (04/11/2026 : la legende disait « Filament 15 ») : le nom traduit de la bobine (comme le suivi), sa
    # marque, sa matiere et son sous-type ; sans bobine, la matiere relevee
    colors, names = {}, {}
    for slot, chex, fcol, tname, fname, brand, mat, sub, ftype in rows:
        if slot and (slot - 1) not in colors:
            colors[slot - 1] = "#" + str(fcol or chex or "94a3b8").lstrip("#")[:6]
            kind = sub if sub and mat and sub.lower().startswith(mat.lower()) else " ".join(x for x in (mat, sub) if x)
            label = " · ".join(x for x in (tname or fname, brand, kind or ftype) if x)
            if label:
                names[slot - 1] = label
    want = n if n is not None else (s.layer if live else None)
    try:
        out = await LV.layer(pid, p, want)
    except Exception as e:
        raise HTTPException(502, f"G-code illisible : {e}")
    # les pieces annulees (05/11/2026) : grisees et hachurees a partir de leur couche
    try:
        sk = await L.skipped(pid)
    except Exception:
        sk = {}
    return {**out, "print_id": pid, "live": live, "now": s.layer if live else None, "total": s.total_layers if live else None,
            "colors": colors, "names": names, "name": p.translated_name or p.file_name, "skipped": sk}


@router.get("/shell")
async def live_shell(print_id: int | None = None, _: str = Depends(get_current_user)):
    """La vue 3D de l'impression (05/11/2026) : le contour de chaque couche, a sa hauteur. Une fois par impression ;
    la page la colore jusqu'a la couche en cours (les couleurs et les pieces annulees viennent de /layer)."""
    from ....db.session import AsyncSessionLocal
    from ....models.print_history import Print
    from ....services import layer_view as LV
    pid = print_id or await L.current_print_id()
    if not pid:
        return {"ok": False, "why": "none"}
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p:
            raise HTTPException(404)
    try:
        return {**(await LV.shell(pid, p)), "print_id": pid}
    except Exception as e:
        raise HTTPException(502, f"G-code illisible : {e}")


@router.get("/{print_id}")
async def live_print(print_id: int, _: str = Depends(get_current_user)):
    if not L.enabled():
        return {"on": False}
    return {"on": True, **(await L.live(print_id))}


@router.post("/{print_id}/switch")
async def live_switch(print_id: int, body: dict = Body({}), _: str = Depends(require_admin)):
    """La bobine d'un filament est finie : la suite vient d'une autre (body : slot, spool_id)."""
    try:
        return await L.switch(print_id, int(body.get("slot") or 0), int(body.get("spool_id") or 0))
    except ValueError as e:
        raise HTTPException(400, str(e))
