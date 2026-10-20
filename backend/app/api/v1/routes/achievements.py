"""Succes : medailles gagnees, progression vers le palier suivant (services/achievements)."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....db.session import get_db
from ....models.user import ROLE_ADMIN, User
from .auth import get_current_role, get_current_user, oauth2_scheme, require_own_account

router = APIRouter()

# Envoye par le BambuNymous d'un copain qui relaie la page (« Chez qui ? ») :
# ses propres medailles uniques. Celles-la, il les a aussi : il peut en lire
# le descriptif chez moi.
MINE_HEADER = "x-bn-achievements"


@router.get("/podium")
async def achievements_podium(fresh: bool = False, acc=Depends(require_own_account)):
    """Podium entre copains : mon score par section et celui de chacun d'eux.
    Jamais par une cle de copain (on ne fait pas lire ses copains par un autre)."""
    from ....services import achievements as A
    return await A.podium(acc[0], fresh)


@router.get("/mine")
async def achievements_mine(acc=Depends(require_own_account)):
    """Mes medailles uniques : lues chez moi quand je visite un copain, pour
    cercler sur sa page les secrets que j'ai et qu'il n'a pas."""
    from ....services import achievements as A
    return {"name": acc[0], "uniques": await A.my_uniques()}


@router.get("")
async def achievements_view(request: Request, fresh: bool = False, token: str = Depends(oauth2_scheme),
                            username: str = Depends(get_current_user), role: str = Depends(get_current_role),
                            db: AsyncSession = Depends(get_db)):
    from ....services import achievements as A
    v = await A.view(fresh)
    by_key = bool(token and token.startswith("fk_"))
    if role == ROLE_ADMIN and not by_key:
        return v
    u = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if u is not None and u.secrets_visible:
        return v
    # seul un acces par cle de copain (relaye par son serveur) dit ce qu'il a
    mine = set()
    if by_key:
        mine = {x.strip() for x in (request.headers.get(MINE_HEADER) or "").split(",") if x.strip()}
    return A.mask_secrets(v, mine)
