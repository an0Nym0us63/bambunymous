"""Les liens publics (04/11/2026), vus de Parametres : la liste (annees, « Depuis le debut », vitrine), avec leur
expiration et leurs ouvertures ; prolonger ou raccourcir, supprimer."""
from fastapi import APIRouter, Body, Depends, HTTPException

from ....services import public_links as PL
from .auth import require_admin

router = APIRouter()


@router.get("")
async def public_links_list(_: str = Depends(require_admin)):
    d = await PL.load()
    return {"links": sorted((PL.view(t, v) for t, v in d.items()), key=lambda x: x.get("created") or "", reverse=True)}


@router.patch("/{token}")
async def public_links_expiry(token: str, body: dict = Body({}), _: str = Depends(require_admin)):
    """days : la duree a partir de maintenant (0 ou absent : sans fin)."""
    v = await PL.set_expiry(token, (body or {}).get("days"))
    if v is None:
        raise HTTPException(404, "Lien inconnu")
    return v


@router.get("/{token}/log")
async def public_links_log(token: str, _: str = Depends(require_admin)):
    """Le journal des ouvertures de ce lien (la plus recente d'abord), avec la zone de chaque adresse IP."""
    from ....services.ipgeo import lookup
    if token not in await PL.load():
        raise HTTPException(404, "Lien inconnu")
    lst = await PL.log_of(token)
    geo = await lookup([e.get("ip") for e in lst])
    return {"entries": [{**e, "geo": geo.get(e.get("ip")) or {}} for e in lst], "max": PL.LOG_MAX, "days": PL.LOG_DAYS}


@router.delete("/{token}")
async def public_links_delete(token: str, _: str = Depends(require_admin)):
    await PL.remove(token)
    return {"ok": True}
