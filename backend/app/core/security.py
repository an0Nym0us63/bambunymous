from datetime import datetime, timedelta
from jose import jwt, JWTError
import bcrypt
from .config import settings

# On appelle bcrypt directement plutot que de passer par passlib : passlib 1.7.4
# execute au premier hachage un test de compatibilite qui echoue avec les versions
# recentes de bcrypt ("password cannot be longer than 72 bytes"), rendant toute
# creation de compte impossible. Le format des empreintes est identique, les
# mots de passe existants restent donc valides.
_BCRYPT_MAX = 72   # bcrypt ignore au-dela de 72 octets : on tronque explicitement


def _prepare(password: str) -> bytes:
    return (password or "").encode("utf-8")[:_BCRYPT_MAX]

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prepare(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(plain), (hashed or "").encode("utf-8"))
    except (ValueError, TypeError):
        return False   # empreinte absente ou illisible -> refus, sans planter


async def averify_password(plain: str, hashed: str) -> bool:
    """La meme verification, hors de la file du serveur (27/10/2026) : bcrypt est lent expres (~0,2 s), et sur
    la file il figeait toutes les pages en cours le temps d'une connexion."""
    import asyncio
    return await asyncio.to_thread(verify_password, plain, hashed)


def create_access_token(sub: str, role: str = "admin") -> str:
    now = datetime.utcnow()
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        # iat = date d'emission. C'est elle qu'on compare a tokens_valid_from
        # pour savoir si le jeton precede un changement de mot de passe ou de
        # role, et doit donc etre refuse.
        {"sub": sub, "role": role, "iat": now, "exp": expire},
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_token(token: str) -> str | None:
    """Retourne le nom d'utilisateur (compatibilite : usage historique)."""
    payload = decode_token_payload(token)
    return payload.get("sub") if payload else None


def decode_token_payload(token: str) -> dict | None:
    """Retourne tout le contenu du token (sub, role, exp) ou None si invalide."""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
