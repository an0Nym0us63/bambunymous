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
    fam = await A.family()
    main = await _main_name(db)
    rows = (await db.execute(select(User.username, User.role, User.active, User.friend_key_hash))).all()
    return [{"username": u, "role": r, "active": bool(a), "friend": bool(fk), "counted": u in counted, "main": u == main,
             "family": u in fam["secrets"] and u != main, "wheel": u == main or u in fam["wheel"]}
            for u, r, a, fk in rows]


@router.put("/users")
async def achievements_users_set(body: dict = Body(...), _: str = Depends(require_admin)):
    from ....services import achievements as A
    out = {}
    if "counted" in body:
        out["counted"] = await A.set_counted_users(body.get("counted") or [])
    if "family" in body or "wheel" in body:
        out.update(await A.set_family(body.get("family"), body.get("wheel")))
    return out


async def _main_name(db) -> str | None:
    """Le compte principal (celui des cles, des tickets et de la roue)."""
    from .users import _root_admin_id
    mid = await _root_admin_id(db)
    u = await db.get(User, mid) if mid else None
    return u.username if u else None


async def _me(username: str, db) -> dict:
    """Ce compte, pour la page des succes : principal, famille (ses propres secrets), roue."""
    from ....services import achievements as A
    fam = await A.family()
    main = await _main_name(db)
    is_main = username == main
    return {"main": is_main, "house": main, "family": not is_main and username in fam["secrets"],
            "wheel": is_main or username in fam["wheel"]}


async def require_main(username: str = Depends(get_current_user), _: str = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)) -> str:
    """Cles et tickets : le compte principal seul (les autres comptes jouent, ils ne depensent pas)."""
    if not (await _me(username, db))["main"]:
        raise HTTPException(403, "Réservé au compte principal")
    return username


async def require_wheel(acc=Depends(require_own_account), db: AsyncSession = Depends(get_db)) -> str:
    """La roue : le compte principal, ou un compte a qui il l'a permis, meme en lecture seule (le lot va a la maison)."""
    username = acc[0]
    if not (await _me(username, db))["wheel"]:
        raise HTTPException(403, "La roue n'est pas ouverte à ce compte")
    return username


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


@router.get("/eggs-found")
async def achievements_eggs_found(acc=Depends(require_own_account)):
    """Ce que CE compte a deja trouve : la page efface pour lui les objets caches qu'il a trouves
    (les autres comptes de la maison les voient toujours, jusqu'a les trouver eux-memes)."""
    from ....services import achievements as A
    return {"found": sorted(await A.eggs_seen_by(acc[0]))}


@router.get("/secrets-by-account")
async def achievements_secrets_by_account(acc=Depends(require_own_account), db: AsyncSession = Depends(get_db)):
    """Pour l'administrateur (un vrai compte de la maison, jamais une cle de copain) : les secrets
    trouves par chaque compte de la maison, compte ou pas."""
    from ....services import achievements as A
    if not (await _me(acc[0], db))["main"]:
        raise HTTPException(403, "Réservé au compte principal")
    # ni le compte principal (ses secrets sont ceux de la maison), ni les invitations de copains
    main = await _main_name(db)
    users = (await db.execute(select(User).where(User.active.is_(True), User.friend_key_hash.is_(None))
                              .order_by(User.id))).scalars().all()
    return {"accounts": await A.secrets_by_account([u.username for u in users if u.username != main]),
            "subs": [{"id": i, "emoji": e, "name": n, "total": sum(1 for x in ids.split() if x in A.FAMILY_IDS)}
                     for i, e, n, ids in A.SECRET_SUBS if i in A.FAMILY_SUBS]}


@router.get("/news")
def _dev(dev: str) -> str:
    """L'appareil qui demande (identifiant tire au hasard par la page) : ce qu'un appareil a
    annonce ne l'est plus pour lui seul, les autres l'annoncent encore (avant, le premier
    appareil a demander « mangeait » l'annonce, et le telephone n'avait rien)."""
    import re
    return dev if re.fullmatch(r"[A-Za-z0-9]{6,40}", dev or "") else ""


@router.get("/news")
async def achievements_news(dev: str = "", acc=Depends(require_own_account), db: AsyncSession = Depends(get_db)):
    """Les paliers debloques depuis mon dernier passage sur cet appareil : a annoncer a l'ecran.
    Ce sont les succes du proprietaire : seulement pour le compte principal."""
    from ....services import achievements as A
    if not (await _me(acc[0], db))["main"]:
        return {"news": []}
    return {"news": await A.tier_news(acc[0], _dev(dev))}


@router.get("/surprise/odds")
async def achievements_surprise_odds(_u: str = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """La surprise de chaque compte de la maison (chance a la prochaine ouverture, surprises recues),
    le compte principal en tete. Lisible aussi par un copain qui regarde : de quoi voir si ca bloque."""
    from ....services import achievements as A
    from .users import _root_admin_id
    main_id = await _root_admin_id(db)
    # les comptes de la maison seulement : pas les invitations de copains
    users = (await db.execute(select(User).where(User.active.is_(True), User.friend_key_hash.is_(None))
                              .order_by(User.id))).scalars().all()
    users = sorted(users, key=lambda x: (x.id != main_id, x.role != ROLE_ADMIN, x.id))
    rows = await A.surprise_odds([x.username for x in users])
    for r, x in zip(rows, users):
        r.update(role=x.role, main=x.id == main_id)
    return {"accounts": rows, "gap_min": int(A.SURPRISE_GAP.total_seconds() // 60)}


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
async def achievements_card_fx(dev: str = "", acc=Depends(require_own_account), db: AsyncSession = Depends(get_db)):
    """Les cartes gagnees depuis ma derniere ouverture : a feter. Seulement le compte principal
    (avant le 24/10/2026 : tout administrateur, et un autre compte admin avait la fete)."""
    from ....services import achievements as A
    if not (await _me(acc[0], db))["main"]:
        return {"cards": []}
    return {"cards": await A.card_fx(acc[0], _dev(dev))}


@router.post("/card-fx/seen")
async def achievements_card_fx_seen(dev: str = "", acc=Depends(require_own_account), db: AsyncSession = Depends(get_db)):
    from ....services import achievements as A
    if (await _me(acc[0], db))["main"]:
        await A.card_fx_seen(acc[0], _dev(dev))
    return {"ok": True}


@router.get("/prank/{slug}")
async def achievements_prank_ok(slug: str, acc=Depends(require_own_account), db: AsyncSession = Depends(get_db)):
    """Cette farce peut-elle se jouer depuis son adresse ?"""
    from ....services import achievements as A
    if slug == "don":
        # une des maisons de cette farce, et seulement pour un compte administrateur (le proprietaire) : ni un
        # compte secondaire, ni un copain ne la voient (ni ne la « consomment » avant lui). Pas « le premier
        # administrateur » : c'est souvent le compte « admin » cree a l'installation, que personne n'utilise.
        # « vu » : vue jusqu'au bout depuis la derniere remise a zero ; « ok » : rejouable a son adresse
        return {"ok": await A.prank_replay_ok(slug), "maison": (await _me(acc[0], db))["main"] and await A.is_maison(),
                "vu": await A.maison_vu()}
    return {"ok": await A.prank_replay_ok(slug)}


@router.post("/prank/don/vu")
async def achievements_don_vu(acc=Depends(require_own_account), db: AsyncSession = Depends(get_db)):
    """La farce de la maison est allee jusqu'au bout (un administrateur) : elle ne retombe plus seule."""
    from ....services import achievements as A
    if (await _me(acc[0], db))["main"] and await A.is_maison():
        await A.maison_vu_set()
    return {"ok": True}


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
    """Un easter egg trouve dans l'appli (jamais par une cle de copain). La reponse dit aussi sa section
    (sub) : le bandeau de l'appli annonce une cachette, une page cachee, une farce… et non « easter egg »."""
    from ....services import achievements as A
    r = await _egg(name, acc)
    return {**r, "sub": A.SUB_OF.get(f"egg_{name}")} if isinstance(r, dict) else r


async def _egg(name: str, acc):
    from ....services import achievements as A
    # deja vu par CE compte (sur n'importe quel appareil) : rien a rejouer
    if name in A.EGGS and name in await A.eggs_seen_by(acc[0]):
        return {"new": False, "already": True, "mine": True, "id": f"egg_{name}"}
    found = await A.eggs_found()
    async def _main() -> bool:
        from ....db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            return (await _me(acc[0], db))["main"]
    if name in A.EGGS and name in found and await _main():
        # le compte principal : ce que la maison a, c'est le sien (pas « un compte qui compte » : un autre
        # administrateur compte parfois, et ses trouvailles partaient en silence, 24/10/2026)
        await A.egg_seen(acc[0], name)
        return {"new": False, "already": True, "mine": True, "id": f"egg_{name}"}
    if name in A.EGGS and name in found:
        # deja trouve par la maison : rien de plus pour la maison ; ce compte, lui, l'a trouve (une fois)
        # et la page le lui dit (« ne compte pas »), puis efface l'objet pour lui seul (24/10/2026)
        e = A.EGGS[name]
        await A.egg_seen(acc[0], name)
        return {"new": False, "already": True, "id": f"egg_{name}", "emoji": e[0], "name": e[1], "lore": e[4]}
    if name in A.EGGS:
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
        await A.egg_seen(acc[0], name)
        return {"new": False, "uncounted": True, "id": f"egg_{name}", "emoji": e[0], "name": e[1], "lore": e[4]}
    try:
        r = await A.find_egg(name)
    except ValueError as e:
        raise HTTPException(404, str(e))
    await A.egg_lock(acc[0], name, consume=True)      # l'autorisation de la surprise est utilisee
    await A.egg_seen(acc[0], name)
    return r


@router.get("/family-board")
async def achievements_family_board(acc=Depends(require_own_account), db: AsyncSession = Depends(get_db)):
    """Le classement de la famille (secrets a chercher seulement) : pour le compte principal et la famille."""
    from ....services import achievements as A
    me = await _me(acc[0], db)
    fam = await A.family()
    if not (me["main"] or me["family"]) or not me["house"] or not fam["secrets"]:
        raise HTTPException(404, "Pas de famille")
    return {**await A.family_board(me["house"], fam["secrets"]), "me": acc[0]}


@router.post("/loupe/{aid}")
async def achievements_loupe(aid: str, acc=Depends(require_own_account), db: AsyncSession = Depends(get_db)):
    """Un compte de la famille revele l'indice d'un secret que la maison a deja (deux loupes par jour)."""
    from ....services import achievements as A
    if not (await _me(acc[0], db))["family"]:
        raise HTTPException(403, "Les loupes sont pour les comptes de la famille")
    try:
        return await A.use_loupe(acc[0], aid)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/wheel/spin")
async def achievements_spin(_: str = Depends(require_wheel)):
    """Un tour de roue : tire le lot cote serveur et l'applique."""
    from ....services import achievements as A
    try:
        return await A.spin()
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/wheel/extra")
async def achievements_wheel_extra(body: dict, username: str = Depends(require_main),
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
async def achievements_settle(since: str, _: str = Depends(require_wheel)):
    """Apres un tour : les cles rapportees en plus par les succes qu'il a debloques."""
    from ....services import achievements as A
    return {"bonus": await A.settle(since)}


@router.post("/ticket/{aid}")
async def achievements_ticket(aid: str, _: str = Depends(require_main)):
    """Utilise un ticket de palier sur un succes a paliers."""
    from ....services import achievements as A
    try:
        return await A.use_ticket(aid)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/keys-auto")
async def achievements_keys_auto(body: dict = Body(...), _: str = Depends(require_main)):
    """Depenser n cles d'un coup, au mieux (le plus d'indices possible). dry : l'apercu seul."""
    from ....services import achievements as A
    try:
        return await A.spend_keys_auto(int(body.get("n") or 0), bool(body.get("dry")))
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))


@router.post("/keys/{aid}")
async def achievements_spend_key(aid: str, _: str = Depends(require_main)):
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
    if not by_key:
        # ce qui ne vaut que pour le proprietaire se regle sur le COMPTE PRINCIPAL, jamais sur le role
        # administrateur (24/10/2026) : un autre administrateur voit les secrets masques, comme un copain
        me = await _me(username, db)
        if me["main"]:                            # le principal : tout, et les trouvailles de la famille « a portee »
            fam = await A.family()
            if fam["secrets"]:
                by = await A._eggs_by()
                others = [x for x in fam["secrets"] if x != username]
                v = A.family_roster(A.family_finds_view(v, by, others), by, others)
            return _json({**v, "me": me})
        u = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
        house_ids = {it["id"] for it in v["items"] if it["level"] >= 0 and it["id"] in A.FAMILY_IDS}
        if not (u is not None and u.secrets_visible):
            v = {**A.mask_secrets(v), "keys": v["keys"] if me["wheel"] else None}   # la roue permise : son tresor reste visible
        if me["family"]:                          # un compte de la famille : ses secrets a lui
            mine = (await A._eggs_by()).get(username) or {}
            v = A.family_view(v, mine, me["house"] or "La maison", await A.loupes(username))
            v["family"]["subs"] = list(A.FAMILY_SUBS)
            # toute la famille sur chaque secret : la maison, puis les autres membres
            fam = await A.family()
            v = A.family_roster(v, await A._eggs_by(), [x for x in fam["secrets"] if x != username],
                                house=me["house"] or "La maison", house_ids=house_ids)
        return _json({**v, "me": me})
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
