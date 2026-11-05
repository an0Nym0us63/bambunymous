"""L'accueil : la disposition des tuiles, propre a chaque compte (22/10/2026).

Deux dispositions par compte, « dash » (PC : des colonnes, chacune en deux
sous-colonnes) et « mobile » (une colonne en deux sous-colonnes). Le serveur
ne fait que les garder : la page sait quelles tuiles existent et ce qu'elles
acceptent comme tailles, et corrige ce qu'elle ne reconnait pas.
"""
import json

from fastapi import APIRouter, Body, Depends, HTTPException

from ....db.session import AsyncSessionLocal
from ....services.settings_service import get_setting, set_setting
from .auth import get_current_user, oauth2_scheme, require_own_account

router = APIRouter()
KEY = "HOME_LAYOUT"
MAX_BYTES = 20000


async def _all(db) -> dict:
    try:
        d = json.loads(await get_setting(db, KEY, "") or "{}")
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


@router.get("/layout")
async def home_layout(username: str = Depends(get_current_user), token: str = Depends(oauth2_scheme)):
    """Ma disposition ; tant que je n'en ai pas reglee, celle du compte principal
    (le premier administrateur qui en a une) : « inherited » le dit, et la
    premiere modification en fait ma propre copie. Un copain qui passe (cle fk_)
    voit l'accueil du compte principal tel quel, options comprises, en lecture."""
    friend = str(token or "").startswith("fk_")
    acc = (username, None)
    from sqlalchemy import select
    from ....models.user import User, ROLE_ADMIN
    async with AsyncSessionLocal() as db:
        d = await _all(db)
        if acc[0] in d and not friend:
            return {"layout": d[acc[0]], "inherited": False}
        admins = (await db.execute(select(User.username).where(User.role == ROLE_ADMIN).order_by(User.id))).scalars().all()
        main = next((u for u in admins if u in d), None)
        return {"layout": d.get(main) if main else None, "inherited": bool(main), "from": main}


@router.put("/layout")
async def home_layout_set(body: dict = Body(...), acc=Depends(require_own_account)):
    lay = (body or {}).get("layout")
    if lay is not None and not isinstance(lay, dict):
        raise HTTPException(400, "Disposition invalide")
    if len(json.dumps(lay or {})) > MAX_BYTES:
        raise HTTPException(400, "Disposition trop grande")
    async with AsyncSessionLocal() as db:
        d = await _all(db)
        old = d.get(acc[0])
        if lay is None:
            d.pop(acc[0], None)                 # retour a la disposition par defaut
        else:
            d[acc[0]] = lay
        await set_setting(db, KEY, json.dumps(d))
    if lay is not None:                         # pour les succes : ce qui a ete regle
        from ....services import home_stats
        await home_stats.layout_saved(old, lay, (body or {}).get("known"))
    return {"layout": lay}


@router.get("/layout/accounts")
async def home_layout_accounts(acc=Depends(require_own_account)):
    """Les autres comptes de la maison, pour leur envoyer ma disposition (administrateur) :
    nom, role, et s'ils ont deja la leur (sinon ils voient celle du compte principal)."""
    if acc[1] != "admin":
        raise HTTPException(403, "Réservé aux administrateurs")
    from sqlalchemy import select
    from ....models.user import User
    async with AsyncSessionLocal() as db:
        d = await _all(db)
        users = (await db.execute(select(User).where(User.active.is_(True)).order_by(User.username))).scalars().all()
    return {"accounts": [{"username": u.username, "role": u.role, "own": u.username in d}
                         for u in users if u.username != acc[0]]}


@router.post("/layout/send")
async def home_layout_send(body: dict = Body(...), acc=Depends(require_own_account)):
    """Copie TOUTES mes dispositions (telephone et ordinateur, ecrans, bandeau, fonds) vers ces
    comptes : pour la famille qui ne veut pas s'en occuper. Remplace les leurs ; rien n'est lie
    ensuite (une modification de leur cote ne revient pas chez moi, ni l'inverse)."""
    if acc[1] != "admin":
        raise HTTPException(403, "Réservé aux administrateurs")
    to = [str(x) for x in ((body or {}).get("to") or []) if isinstance(x, str)][:50]
    from sqlalchemy import select
    from ....models.user import User
    async with AsyncSessionLocal() as db:
        d = await _all(db)
        mine = d.get(acc[0])
        if not mine:
            raise HTTPException(400, "Enregistre d'abord ta disposition")
        known = set((await db.execute(select(User.username).where(User.active.is_(True)))).scalars().all())
        sent = [u for u in dict.fromkeys(to) if u in known and u != acc[0]]
        for u in sent:
            d[u] = json.loads(json.dumps(mine))
        await set_setting(db, KEY, json.dumps(d))
    return {"sent": sent}


@router.post("/event")
async def home_event(body: dict = Body(...), acc=Depends(require_own_account)):
    """Ce que la page constate et que le serveur ne voit pas (l'accueil sur 2, 3 ou 4 colonnes)."""
    from ....services import home_stats
    if (body or {}).get("four"):
        await home_stats.seen_four()
    if (body or {}).get("copied"):
        await home_stats.layout_copied()
    cols = (body or {}).get("cols")
    if isinstance(cols, int) and cols in (2, 3, 4):
        await home_stats.seen_cols(cols)
    return {"ok": True}


# ── Le menu de chaque compte (05/11/2026) ────────────────────────────────────────────────────────────────────────────
# {"v": 1, "items": [[cle, place], ...]} : quelles pages, dans quel ordre, et ou (menu, « Plus », profil, masquee). La
# page connait le catalogue et corrige ce qu'elle ne reconnait pas ; le serveur ne fait que garder. Sans reglage : le
# menu par defaut (rien n'est herite d'un autre compte).
KEY_MENU = "NAV_MENU"


async def _menus(db) -> dict:
    try:
        d = json.loads(await get_setting(db, KEY_MENU, "") or "{}")
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


@router.get("/menu")
async def nav_menu(username: str = Depends(get_current_user), token: str = Depends(oauth2_scheme)):
    if str(token or "").startswith("fk_"):
        return {"menu": None}
    async with AsyncSessionLocal() as db:
        return {"menu": (await _menus(db)).get(username)}


@router.put("/menu")
async def nav_menu_set(body: dict = Body(...), acc=Depends(require_own_account)):
    menu = (body or {}).get("menu")
    if menu is not None and (not isinstance(menu, dict) or not isinstance(menu.get("items"), list)):
        raise HTTPException(400, "Menu invalide")
    if len(json.dumps(menu or {})) > 4000:
        raise HTTPException(400, "Menu trop grand")
    async with AsyncSessionLocal() as db:
        d = await _menus(db)
        if menu is None:
            d.pop(acc[0], None)                 # retour au menu par defaut
        else:
            d[acc[0]] = menu
        await set_setting(db, KEY_MENU, json.dumps(d))
    return {"menu": menu}


@router.post("/menu/send")
async def nav_menu_send(body: dict = Body(...), acc=Depends(require_own_account)):
    """Copie mon menu vers ces comptes (administrateur), ou le leur remet par defaut (reset)."""
    if acc[1] != "admin":
        raise HTTPException(403, "Réservé aux administrateurs")
    to = [str(x) for x in ((body or {}).get("to") or []) if isinstance(x, str)][:50]
    reset = bool((body or {}).get("reset"))
    from sqlalchemy import select
    from ....models.user import User
    async with AsyncSessionLocal() as db:
        d = await _menus(db)
        mine = d.get(acc[0])
        if not mine and not reset:
            raise HTTPException(400, "Enregistre d'abord ton menu")
        known = set((await db.execute(select(User.username).where(User.active.is_(True)))).scalars().all())
        sent = [u for u in dict.fromkeys(to) if u in known and u != acc[0]]
        for u in sent:
            if reset:
                d.pop(u, None)
            else:
                d[u] = json.loads(json.dumps(mine))
        await set_setting(db, KEY_MENU, json.dumps(d))
    return {"sent": sent}


@router.get("/menu/accounts")
async def nav_menu_accounts(acc=Depends(require_own_account)):
    if acc[1] != "admin":
        raise HTTPException(403, "Réservé aux administrateurs")
    from sqlalchemy import select
    from ....models.user import User
    async with AsyncSessionLocal() as db:
        d = await _menus(db)
        users = (await db.execute(select(User).where(User.active.is_(True)).order_by(User.username))).scalars().all()
    return {"accounts": [{"username": u.username, "role": u.role, "own": u.username in d} for u in users if u.username != acc[0]]}


@router.get("/menu/of/{user}")
async def nav_menu_of(user: str, acc=Depends(require_own_account)):
    """Le menu d'un autre compte (administrateur) : pour le regler a sa place. Un compte ne regle que le sien."""
    if acc[1] != "admin":
        raise HTTPException(403, "Réservé aux administrateurs")
    async with AsyncSessionLocal() as db:
        return {"menu": (await _menus(db)).get(user), "username": user}


@router.put("/menu/of/{user}")
async def nav_menu_of_set(user: str, body: dict = Body(...), acc=Depends(require_own_account)):
    if acc[1] != "admin":
        raise HTTPException(403, "Réservé aux administrateurs")
    menu = (body or {}).get("menu")
    if menu is not None and (not isinstance(menu, dict) or not isinstance(menu.get("items"), list)):
        raise HTTPException(400, "Menu invalide")
    if len(json.dumps(menu or {})) > 4000:
        raise HTTPException(400, "Menu trop grand")
    from sqlalchemy import select
    from ....models.user import User
    async with AsyncSessionLocal() as db:
        if not (await db.execute(select(User.id).where(User.username == user, User.active.is_(True)))).scalar():
            raise HTTPException(404, "Compte inconnu")
        d = await _menus(db)
        if menu is None:
            d.pop(user, None)
        else:
            d[user] = menu
        await set_setting(db, KEY_MENU, json.dumps(d))
    return {"menu": menu}
