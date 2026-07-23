from datetime import datetime
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


async def _resolve(token: str, db: AsyncSession) -> tuple[str, str]:
    """
    Valide un jeton contre l'etat REEL du compte et rend (username, role).

    Un JWT est autonome : il porte son role et reste valide jusqu'a expiration,
    sans jamais consulter la base. Trois consequences qu'on corrige ici :

      - un mot de passe change n'ejectait aucune session ouverte ;
      - un role modifie ne prenait effet qu'a la reconnexion, puisque le role
        lu etait celui GRAVE dans le jeton ;
      - un compte desactive ou supprime gardait ses acces.

    Le role est donc relu en base a chaque requete, et tout jeton emis avant
    tokens_valid_from est refuse.
    """
    payload = decode_token_payload(token)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide")
    username = payload.get("sub")
    if not username:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide")

    user = (await db.execute(
        select(User).where(User.username == username)
    )).scalar_one_or_none()

    # Pas de ligne en base : c'est l'admin historique des settings (avant la
    # table users). On le laisse passer avec le role du jeton, sinon une
    # installation pas encore migree se retrouverait verrouillee dehors.
    if not user:
        return username, (payload.get("role") or ROLE_ADMIN)

    if not user.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Compte desactive")

    if user.tokens_valid_from:
        iat = payload.get("iat")
        if iat is None or int(iat) < int(user.tokens_valid_from.timestamp()):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                                "Session expiree, reconnexion necessaire")

    return username, user.role


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Dependance historique : renvoie le nom d'utilisateur."""
    username, _ = await _resolve(token, db)
    return username


async def get_current_role(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Role REEL du porteur, relu en base et non pris dans le jeton."""
    _, role = await _resolve(token, db)
    return role


async def require_admin(role: str = Depends(get_current_role)) -> str:
    """A poser sur toute route reservee aux administrateurs."""
    if role != ROLE_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Action reservee aux administrateurs")
    return role


@router.get("/me")
async def me(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)):
    """Identite et role REELS du porteur (l'interface s'y fie pour l'affichage)."""
    username, role = await _resolve(token, db)
    return {"username": username, "role": role}


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
        # Toutes les sessions ouvertes tombent, y compris sur d'autres appareils :
        # c'est tout l'interet de changer un mot de passe.
        user.tokens_valid_from = datetime.utcnow()
        await db.commit()
        # ... sauf celle-ci, sinon on se deconnecterait soi-meme en changeant son
        # propre mot de passe. Un jeton neuf est renvoye, le front le remplace.
        return {"ok": True,
                "access_token": create_access_token(sub=username, role=user.role)}
    else:
        # Compte historique (settings) : on met a jour la ou il est stocke.
        stored_hash = await get_setting(db, "ADMIN_PASSWORD_HASH")
        if stored_hash and not verify_password(body.current_password, stored_hash):
            raise HTTPException(400, "Mot de passe actuel incorrect")
        await set_setting(db, "ADMIN_PASSWORD_HASH", hash_password(body.new_password))
        await set_setting(db, "ADMIN_USERNAME", username)
    return {"ok": True}
