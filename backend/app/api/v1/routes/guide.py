"""Le guide d'utilisation (23/10/2026) : les chapitres et leurs captures, servis
seulement aux comptes de la maison. Jamais en acces libre (il etait sous /doc/,
fichiers statiques ouverts a tous), jamais a un copain (cle fk_).

Les fichiers vivent dans backend/guide : pages/<chapitre>.html et img/<capture>.webp.
La page /guide de l'appli les lit ici et les met en forme a son theme.
"""
import re
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse

from .auth import require_own_account

router = APIRouter()
DOC = Path(__file__).resolve().parents[4] / "guide"
PAGE = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")
IMG = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}\.(webp|png|jpg)$")
SECTION = re.compile(r"^[a-z0-9][a-z0-9-]{0,100}$")


@router.get("/pages/{name}")
async def guide_page(name: str, _acc=Depends(require_own_account)):
    f = DOC / "pages" / f"{name}.html"
    if not PAGE.match(name) or not f.is_file():
        raise HTTPException(404, "Chapitre introuvable")
    return Response(f.read_text(encoding="utf-8"), media_type="text/html; charset=utf-8",
                    headers={"Cache-Control": "no-cache, private"})


async def _img_account(request: Request):
    """Jeton de l'en-tete, ou `_t` dans l'adresse : les captures se chargent par une
    simple balise image. Un compte de la maison, jamais un copain."""
    from ....db.session import AsyncSessionLocal
    from .auth import _resolve
    h = request.headers.get("authorization", "")
    tok = h.split(" ", 1)[1].strip() if h.lower().startswith("bearer ") else request.query_params.get("_t", "")
    if not tok or tok.startswith("fk_"):
        raise HTTPException(401, "Non authentifié")
    async with AsyncSessionLocal() as db:
        return (await _resolve(tok, db))[0]


@router.get("/img/{name}")
async def guide_img(name: str, _=Depends(_img_account)):
    f = DOC / "img" / name
    if not IMG.match(name) or not f.is_file():
        raise HTTPException(404, "Capture introuvable")
    return FileResponse(str(f), headers={"Cache-Control": "private, max-age=86400"})


@router.post("/read")
async def guide_read(body: dict = Body(...), _acc=Depends(require_own_account)):
    """Ce que la page a vu lire, pour les succes : temps passe (onglet visible et
    lecteur actif), sections lues, ouvertures, recherches."""
    from ....services import home_stats
    b = body or {}
    try:
        sec = max(0.0, min(600.0, float(b.get("seconds") or 0)))
    except (TypeError, ValueError):
        sec = 0.0
    sections = [s for s in (b.get("sections") or [])[:400] if isinstance(s, str) and SECTION.match(s)]
    try:
        searches = max(0, min(50, int(b.get("searches") or 0)))
    except (TypeError, ValueError):
        searches = 0
    await home_stats.guide_read(sec, sections, bool(b.get("opened")), searches)
    return {"ok": True}
