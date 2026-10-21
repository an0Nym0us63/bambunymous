"""Succes : medailles gagnees, progression vers le palier suivant (services/achievements)."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....db.session import get_db
from ....models.user import ROLE_ADMIN, User
from fastapi import HTTPException

from .auth import get_current_role, get_current_user, oauth2_scheme, require_admin, require_own_account

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


@router.post("/egg/{name}")
async def achievements_egg(name: str, acc=Depends(require_own_account)):
    """Un easter egg trouve dans l'appli (jamais par une cle de copain)."""
    from ....services import achievements as A
    try:
        return await A.find_egg(name)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/wheel/spin")
async def achievements_spin(_: str = Depends(require_admin)):
    """Un tour de roue : tire le lot cote serveur et l'applique."""
    from ....services import achievements as A
    try:
        return await A.spin()
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/wheel/extra")
async def achievements_wheel_extra(body: dict, username: str = Depends(get_current_user), _: str = Depends(require_admin),
                                   db: AsyncSession = Depends(get_db)):
    # administrateur, ET un secret : le token RFID suivi du mot de passe du compte
    import asyncio
    import hmac
    from ....core.security import verify_password
    from ....services.settings_service import get_setting
    secret = str((body or {}).get("secret") or "")
    token = (await get_setting(db, "RFID_TOKEN", "") or "").strip()
    user = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    ok = bool(token) and len(secret) > len(token) and hmac.compare_digest(secret[:len(token)], token)         and user is not None and verify_password(secret[len(token):], user.password_hash)
    if not ok:
        await asyncio.sleep(1.5)
        raise HTTPException(403, "Refusé")
    from ....services import achievements as A
    try:
        return await A.add_spins((body or {}).get("n") or 5)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/wheel/settle")
async def achievements_settle(since: str, _: str = Depends(require_admin)):
    """Apres un tour : les cles rapportees en plus par les succes qu'il a debloques."""
    from ....services import achievements as A
    return {"bonus": await A.settle(since)}


@router.post("/ticket/{aid}")
async def achievements_ticket(aid: str, _: str = Depends(require_admin)):
    """Utilise un ticket de palier sur un succes a paliers."""
    from ....services import achievements as A
    try:
        return await A.use_ticket(aid)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/keys/{aid}")
async def achievements_spend_key(aid: str, _: str = Depends(require_admin)):
    """Revele l'etape suivante d'un secret (vignette, titre, indice, descriptif)."""
    from ....services import achievements as A
    try:
        return await A.spend_key(aid)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/export")
async def achievements_export(_: str = Depends(require_admin)):
    """Tableau CSV des paliers et de ma progression (revue des seuils)."""
    from fastapi.responses import Response
    from ....services import achievements as A
    return Response(await A.export_csv(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="succes-paliers.csv"'})


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
        return _json(v)
    u = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if u is not None and u.secrets_visible:
        return _json(v)                           # droit « voit mes succes secrets » : tout, revelations comprises
    # seul un acces par cle de copain (relaye par son serveur) dit ce qu'il a
    mine = set()
    if by_key:
        mine = {x.strip() for x in (request.headers.get(MINE_HEADER) or "").split(",") if x.strip()}
    return _json(A.mask_secrets(v, mine))


def _json(v):
    """La vue est deja faite de types simples : la serialiser directement evite
    l'encodeur generique de FastAPI (~10 fois plus lent sur ses ~370 Ko)."""
    from ....core.fastjson import json_response
    return json_response(v)
