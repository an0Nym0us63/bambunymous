"""Les rangements des bobines (07/11/2026) : le mode, l'arbre des emplacements, ranger une bobine. Voir
services/storage_places.py."""
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user, require_admin
from ....db.session import get_db
from ....models.filament import Spool
from ....services import storage_places as SP

router = APIRouter()


def _err(e: SP.StorageError):
    raise HTTPException(e.status, {"message": str(e), **e.extra} if e.extra else str(e))


async def _done(db):
    await SP.refresh(db)
    await db.commit()
    SP._clear_cache()
    try:
        from .filaments import _clear_match_cache
        _clear_match_cache()
    except Exception:
        pass
    return await SP.overview(db)


@router.get("")
async def storage_overview(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    return await SP.overview(db)


@router.put("/settings")
async def storage_settings(body: dict = Body({}), db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    """{mode: single|assigned|manual, name: le nom du rangement unique, smart: l'echange intelligent}."""
    try:
        await SP.set_config(db, body.get("mode"), body.get("name"), body.get("smart"))
    except SP.StorageError as e:
        _err(e)
    return await _done(db)


@router.post("/places")
async def storage_create(body: dict = Body({}), db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    """Une place, ou tout un arbre (children), sous parent_id."""
    try:
        made = await SP.create(db, body)
    except SP.StorageError as e:
        await db.rollback()
        _err(e)
    out = await _done(db)
    return {**out, "made": made}


@router.patch("/places/{pid}")
async def storage_update(pid: int, body: dict = Body({}), db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    try:
        await SP.update(db, pid, body)
    except SP.StorageError as e:
        await db.rollback()
        _err(e)
    return await _done(db)


@router.post("/places/{pid}/move")
async def storage_move(pid: int, body: dict = Body({}), db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    try:
        await SP.move(db, pid, int(body.get("d") or 1))
    except SP.StorageError as e:
        _err(e)
    return await _done(db)


@router.delete("/places/{pid}")
async def storage_delete(pid: int, db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    try:
        n = await SP.delete(db, pid)
    except SP.StorageError as e:
        _err(e)
    out = await _done(db)
    return {**out, "freed": n}


async def _spools(db, ids) -> list:
    out = []
    for i in ids or []:
        s = await db.get(Spool, int(i))
        if s is None:
            raise HTTPException(404, f"Bobine #{i} introuvable")
        out.append(s)
    if not out:
        raise HTTPException(400, "Aucune bobine")
    return out


@router.post("/assign")
async def storage_assign(body: dict = Body({}), db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    """{spool_ids, place_id, force} : range ces bobines a cette place ; place_id null leur retire leur place. Une case
    deja prise : 409 avec l'occupante, force=true la deloge (elle repasse « À ranger »)."""
    sp = await _spools(db, body.get("spool_ids"))
    moved = []
    try:
        if body.get("place_id") in (None, ""):
            await SP.unassign(db, sp, bool(body.get("to_store")))
        else:
            moved = await SP.assign(db, sp, int(body["place_id"]), bool(body.get("force")))
    except SP.StorageError as e:
        await db.rollback()
        _err(e)
    out = await _done(db)
    return {**out, "moved": [s.id for s in moved]}
