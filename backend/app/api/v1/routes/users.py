"""Routes de gestion des comptes utilisateurs (reservees aux administrateurs)."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin, get_current_role, get_current_user
from ....db.session import get_db, ACTIVITY_RETENTION_DAYS
from ....core.security import hash_password
from ....models.user import User, ROLE_ADMIN, ROLE_READONLY, ROLES
from ....models.activity import ActivityLog

router = APIRouter()


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    active: bool
    last_seen: Optional[str] = None   # derniere activite (ISO)
    protected: bool = False   # compte admin d'origine : non modifiable


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = ROLE_READONLY


class UserUpdate(BaseModel):
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None


def _out(u: User, protected: bool = False) -> UserOut:
    return UserOut(id=u.id, username=u.username, role=u.role, active=u.active,
                   protected=protected,
                   last_seen=(str(u.last_seen) if getattr(u, "last_seen", None) else None))


async def _root_admin_id(db: AsyncSession) -> Optional[int]:
    """
    Compte administrateur d'origine : le plus ancien. Il ne peut etre ni
    supprime, ni desactive, ni retrograde -- seul son mot de passe est
    modifiable. Garantit qu'il reste toujours un acces administrateur.
    """
    return (await db.execute(
        select(User.id).where(User.role == ROLE_ADMIN).order_by(User.id).limit(1)
    )).scalar_one_or_none()


@router.get("", response_model=List[UserOut])
async def list_users(db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    rows = (await db.execute(select(User).order_by(User.username))).scalars().all()
    root = await _root_admin_id(db)
    return [_out(u, protected=(u.id == root)) for u in rows]


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_admin),
):
    name = (body.username or "").strip()
    if not name:
        raise HTTPException(400, "Nom d'utilisateur requis")
    if body.role not in ROLES:
        raise HTTPException(400, "Role invalide")
    if len(body.password or "") < 4:
        raise HTTPException(400, "Mot de passe trop court (4 caracteres minimum)")
    exists = (await db.execute(select(User).where(User.username == name))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "Ce nom d'utilisateur existe deja")
    u = User(username=name, password_hash=hash_password(body.password), role=body.role)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return _out(u)


@router.get("/activity")
async def activity(
    days: int = 7,
    username: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_admin),
):
    """
    Journal sur une fenetre glissante. Le plafond est la duree de conservation
    reelle : proposer plus large que ce que la purge laisse en base n'aurait
    fait que promettre des donnees supprimees.
    """
    from datetime import datetime, timedelta
    since = datetime.utcnow() - timedelta(
        days=max(1, min(days, ACTIVITY_RETENTION_DAYS)))
    q = select(ActivityLog).where(ActivityLog.created_at >= since)
    if username:
        q = q.where(ActivityLog.username == username)
    if kind in ("action", "visite"):
        q = q.where(ActivityLog.kind == kind)
    total = (await db.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar_one()
    rows = (await db.execute(
        q.order_by(ActivityLog.created_at.desc())
         .limit(max(1, min(limit, 500))).offset(max(0, offset))
    )).scalars().all()
    return {
        "retention_days": ACTIVITY_RETENTION_DAYS,   # borne les filtres du front
        "total": total,
        "items": [{
            "id": r.id, "username": r.username, "method": r.method,
            "path": r.path, "status": r.status, "label": r.label,
            "kind": r.kind or "action",
            "at": str(r.created_at),
        } for r in rows],
    }


@router.patch("/{uid}", response_model=UserOut)
async def update_user(
    uid: int,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_admin),
    me: str = Depends(get_current_user),
):
    u = await db.get(User, uid)
    if not u:
        raise HTTPException(404, "Utilisateur introuvable")

    changing_status = (body.role is not None) or (body.active is not None)
    # Le compte administrateur d'origine n'est ni retrograde ni desactive.
    if changing_status and u.id == await _root_admin_id(db):
        raise HTTPException(400, "Compte administrateur principal : seul le mot de passe est modifiable")
    # On ne modifie pas son propre role ni son propre etat (risque de s'exclure).
    if changing_status and u.username == me:
        raise HTTPException(400, "Vous ne pouvez pas modifier votre propre role ou statut")

    # Garde-fou : ne pas se retrouver sans aucun administrateur actif.
    if (body.role and body.role != ROLE_ADMIN) or (body.active is False):
        if u.role == ROLE_ADMIN and u.active:
            others = (await db.execute(
                select(func.count()).select_from(User)
                .where(User.role == ROLE_ADMIN, User.active.is_(True), User.id != uid)
            )).scalar_one()
            if not others:
                raise HTTPException(400, "Impossible : ce serait le dernier administrateur actif")

    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(400, "Role invalide")
        u.role = body.role
    if body.active is not None:
        u.active = body.active
    if body.password:
        if len(body.password) < 4:
            raise HTTPException(400, "Mot de passe trop court (4 caracteres minimum)")
        u.password_hash = hash_password(body.password)
    await db.commit()
    await db.refresh(u)
    return _out(u)


@router.delete("/{uid}")
async def delete_user(
    uid: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_admin),
    me: str = Depends(get_current_user),
):
    u = await db.get(User, uid)
    if not u:
        raise HTTPException(404, "Utilisateur introuvable")
    if u.id == await _root_admin_id(db):
        raise HTTPException(400, "Le compte administrateur principal ne peut pas etre supprime")
    if u.username == me:
        raise HTTPException(400, "Vous ne pouvez pas supprimer votre propre compte")
    if u.role == ROLE_ADMIN and u.active:
        others = (await db.execute(
            select(func.count()).select_from(User)
            .where(User.role == ROLE_ADMIN, User.active.is_(True), User.id != uid)
        )).scalar_one()
        if not others:
            raise HTTPException(400, "Impossible : ce serait le dernier administrateur actif")
    await db.delete(u)
    await db.commit()
    return {"ok": True}
