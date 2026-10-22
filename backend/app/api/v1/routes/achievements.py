"""Succes : medailles gagnees, progression vers le palier suivant (services/achievements)."""
from fastapi import APIRouter, Body, Depends, Request
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


@router.get("/users")
async def achievements_users(db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    """Comptes de la maison, et ceux dont l'activite fait avancer les succes."""
    from ....services import achievements as A
    counted = set(await A.counted_users())
    rows = (await db.execute(select(User.username, User.role, User.active, User.friend_key_hash))).all()
    return [{"username": u, "role": r, "active": bool(a), "friend": bool(fk), "counted": u in counted}
            for u, r, a, fk in rows]


@router.put("/users")
async def achievements_users_set(body: dict = Body(...), _: str = Depends(require_admin)):
    from ....services import achievements as A
    return {"counted": await A.set_counted_users(body.get("counted") or [])}


@router.get("/passage")
async def achievements_passage(acc=Depends(require_own_account)):
    """Le passage secret du menu est-il ouvert pour ce compte ? (par compte, sur
    tous ses appareils : la premiere surprise l'ouvre, ou qu'elle tombe)."""
    from ....services import achievements as A
    # pages cachees et farces deja trouvees : la surprise prefere la nouveaute (70/30)
    found = sorted(k for k in await A.eggs_found() if k in A.HIDDEN_EGGS | A.PRANK_EGGS)
    return {"open": acc[0] in await A.passages(), "found": found}


@router.post("/passage")
async def achievements_passage_open(acc=Depends(require_own_account)):
    from ....services import achievements as A
    return {"open": True, "new": await A.open_passage(acc[0])}


@router.post("/surprise")
async def achievements_surprise(acc=Depends(require_own_account)):
    """Une ouverture de l'appli sur l'accueil : surprise ou pas (compteur par compte).
    En cas de surprise, la liste des pages et farces deja trouvees, pour preferer la nouveaute."""
    from ....services import achievements as A
    fete = await A.fete_pending(acc[0])
    if fete:   # le jour d'une fete, elle sort a coup sur (le compteur ne bouge pas)
        return {"hit": True, "fete": fete, **await A.fete_extra(fete)}
    r = await A.roll_surprise(acc[0])
    if r["hit"]:
        r["found"] = sorted(k for k in await A.eggs_found() if k in A.HIDDEN_EGGS | A.PRANK_EGGS)
    return r


@router.get("/card-fx")
async def achievements_card_fx(acc=Depends(require_own_account)):
    """Les cartes gagnees depuis ma derniere ouverture : a feter. Seulement le
    compte principal (administrateur) : un autre compte ne la voit ni ne la consomme."""
    from ....services import achievements as A
    if acc[1] != "admin":
        return {"cards": []}
    return {"cards": await A.card_fx(acc[0])}


@router.post("/card-fx/seen")
async def achievements_card_fx_seen(acc=Depends(require_own_account)):
    from ....services import achievements as A
    if acc[1] == "admin":
        await A.card_fx_seen(acc[0])
    return {"ok": True}


@router.get("/prank/{slug}")
async def achievements_prank_ok(slug: str, acc=Depends(require_own_account)):
    """Cette farce peut-elle se jouer depuis son adresse ?"""
    from ....services import achievements as A
    return {"ok": await A.prank_replay_ok(slug)}


@router.post("/surprise/shown")
async def achievements_surprise_shown(body: dict | None = Body(None), acc=Depends(require_own_account)):
    from ....services import achievements as A
    fete = (body or {}).get("fete")
    if fete in A.FETE_SLUGS:
        await A.fete_shown(acc[0], fete)
    else:
        await A.surprise_shown(acc[0], (body or {}).get("farce"))
    return {"ok": True}


@router.post("/egg/{name}")
async def achievements_egg(name: str, acc=Depends(require_own_account)):
    """Un easter egg trouve dans l'appli (jamais par une cle de copain)."""
    from ....services import achievements as A
    if name in A.EGGS and name not in await A.eggs_found():
        why = await A.egg_lock(acc[0], name)
        if why:
            # fete hors de son jour, farce venue par son adresse : jouee, pas gagnee
            e = A.EGGS[name]
            return {"new": False, "locked": why, "id": f"egg_{name}", "emoji": e[0], "name": e[1]}
    if acc[0] not in await A.counted_users():      # compte qui ne fait pas avancer les succes
        # il a trouve, on le lui dit, mais rien n'est enregistre
        e = A.EGGS.get(name)
        if not e:
            raise HTTPException(404, "Œuf inconnu")
        return {"new": False, "uncounted": True, "id": f"egg_{name}", "emoji": e[0], "name": e[1], "lore": e[4]}
    try:
        r = await A.find_egg(name)
    except ValueError as e:
        raise HTTPException(404, str(e))
    await A.egg_lock(acc[0], name, consume=True)      # l'autorisation de la surprise est utilisee
    return r


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


@router.post("/keys-auto")
async def achievements_keys_auto(body: dict = Body(...), _: str = Depends(require_admin)):
    """Depenser n cles d'un coup, au mieux (le plus d'indices possible). dry : l'apercu seul."""
    from ....services import achievements as A
    try:
        return await A.spend_keys_auto(int(body.get("n") or 0), bool(body.get("dry")))
    except (ValueError, TypeError) as e:
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
    return {"name": acc[0], "uniques": await A.my_uniques(), "levels": await A.my_levels()}


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
