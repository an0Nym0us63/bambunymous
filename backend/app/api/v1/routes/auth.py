from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from ....db.session import get_db
from ....core.security import (
    verify_password, create_access_token, decode_token, decode_token_payload,
    hash_password,
)
from ....models.user import User, ROLE_ADMIN, ROLE_READONLY
from ....services.settings_service import get_setting, set_setting

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str = ROLE_ADMIN
    username: str = ""


@router.post("/login", response_model=Token)
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    """
    Authentification sur la table users. Repli historique : si la table est vide
    (premiere version, ou migration pas encore passee), on accepte l'admin stocke
    dans les settings, voire admin/admin au tout premier demarrage.
    """
    user = (await db.execute(
        select(User).where(User.username == form.username)
    )).scalar_one_or_none()

    if user:
        if not user.active or not verify_password(form.password, user.password_hash):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Identifiants invalides")
        role = user.role
    else:
        # Repli sur l'ancien mecanisme (settings).
        stored_hash = await get_setting(db, "ADMIN_PASSWORD_HASH")
        stored_user = await get_setting(db, "ADMIN_USERNAME", "admin")
        if not stored_hash:
            if form.username != "admin" or form.password != "admin":
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Identifiants invalides")
        elif form.username != stored_user or not verify_password(form.password, stored_hash):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Identifiants invalides")
        role = ROLE_ADMIN

    return {
        "access_token": create_access_token(sub=form.username, role=role),
        "role": role,
        "username": form.username,
    }


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Dependance historique : renvoie le nom d'utilisateur."""
    username = decode_token(token)
    if not username:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide")
    return username


async def get_current_role(token: str = Depends(oauth2_scheme)) -> str:
    """Role porte par le token (admin par defaut pour les anciens tokens)."""
    payload = decode_token_payload(token)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide")
    return payload.get("role") or ROLE_ADMIN


async def require_admin(role: str = Depends(get_current_role)) -> str:
    """A poser sur toute route reservee aux administrateurs."""
    if role != ROLE_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Action reservee aux administrateurs")
    return role


@router.get("/me")
async def me(token: str = Depends(oauth2_scheme)):
    """Identite et role du porteur du token (pour l'interface)."""
    payload = decode_token_payload(token)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide")
    return {"username": payload.get("sub"), "role": payload.get("role") or ROLE_ADMIN}


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
async def change_password(
    body: PasswordChange,
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
):
    """
    Changement de son PROPRE mot de passe. Accessible a tous les roles, y compris
    read-only (d'ou l'exception dans le middleware de lecture seule).
    """
    payload = decode_token_payload(token)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide")
    if len(body.new_password or "") < 4:
        raise HTTPException(400, "Mot de passe trop court (4 caracteres minimum)")

    username = payload.get("sub")
    user = (await db.execute(
        select(User).where(User.username == username)
    )).scalar_one_or_none()

    if user:
        if not verify_password(body.current_password, user.password_hash):
            raise HTTPException(400, "Mot de passe actuel incorrect")
        user.password_hash = hash_password(body.new_password)
        await db.commit()
    else:
        # Compte historique (settings) : on met a jour la ou il est stocke.
        stored_hash = await get_setting(db, "ADMIN_PASSWORD_HASH")
        if stored_hash and not verify_password(body.current_password, stored_hash):
            raise HTTPException(400, "Mot de passe actuel incorrect")
        await set_setting(db, "ADMIN_PASSWORD_HASH", hash_password(body.new_password))
        await set_setting(db, "ADMIN_USERNAME", username)
    return {"ok": True}
