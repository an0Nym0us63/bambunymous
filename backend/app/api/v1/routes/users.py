"""Routes de gestion des comptes utilisateurs (reservees aux administrateurs)."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin, get_current_role
from ....db.session import get_db
from ....core.security import hash_password
from ....models.user import User, ROLE_ADMIN, ROLE_READONLY, ROLES

router = APIRouter()


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    active: bool


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = ROLE_READONLY


class UserUpdate(BaseModel):
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None


def _out(u: User) -> UserOut:
    return UserOut(id=u.id, username=u.username, role=u.role, active=u.active)


@router.get("", response_model=List[UserOut])
async def list_users(db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    rows = (await db.execute(select(User).order_by(User.username))).scalars().all()
    return [_out(u) for u in rows]


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


@router.patch("/{uid}", response_model=UserOut)
async def update_user(
    uid: int,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_admin),
):
    u = await db.get(User, uid)
    if not u:
        raise HTTPException(404, "Utilisateur introuvable")

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
):
    u = await db.get(User, uid)
    if not u:
        raise HTTPException(404, "Utilisateur introuvable")
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
