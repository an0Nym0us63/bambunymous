"""Le serveur MCP (10/11/2026) : voir services/mcp_server.py.

POST /api/v1/mcp         les messages JSON-RPC, le jeton en en-tete (Authorization: Bearer mcp_…)
POST /api/v1/mcp/k/<jeton>   les memes, le jeton dans l'adresse (connecteurs de l'appli Claude)
GET, DELETE              405 : pas de flux ni de session (le transport le permet)

Les reglages (administrateur) : GET/PUT /api/v1/mcp/settings (le mode), POST/DELETE /api/v1/mcp/token.
"""
import json

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from ....services import mcp_server as M
from .auth import require_admin

router = APIRouter()


def _bearer(request: Request) -> str:
    h = request.headers.get("authorization") or ""
    return h.split(" ", 1)[1].strip() if h.lower().startswith("bearer ") else ""


async def _serve(request: Request, tok: str):
    mode = await M.check(tok)
    if not mode:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32001, "message":
                             "MCP désactivé ou jeton invalide (Paramètres › Liens › MCP)"}}, status_code=401)
    try:
        msg = json.loads(await request.body() or b"null")
    except ValueError:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "JSON illisible"}}, status_code=400)
    app = request.app
    if isinstance(msg, list):
        out = [r for r in [await M.handle(app, m, mode) for m in msg] if r is not None]
        return JSONResponse(out) if out else Response(status_code=202)
    r = await M.handle(app, msg, mode)
    return JSONResponse(r) if r is not None else Response(status_code=202)


@router.post("")
async def mcp_post(request: Request):
    return await _serve(request, _bearer(request))


@router.post("/k/{tok}")
async def mcp_post_key(tok: str, request: Request):
    return await _serve(request, tok)


def _no_stream():
    return Response(status_code=405, headers={"Allow": "POST"})


@router.get("")
async def mcp_get():
    return _no_stream()


@router.get("/k/{tok}")
async def mcp_get_key(tok: str):
    return _no_stream()


@router.delete("")
async def mcp_delete():
    return _no_stream()


@router.delete("/k/{tok}")
async def mcp_delete_key(tok: str):
    return _no_stream()


# ── Reglages (administrateur) ────────────────────────────────────────────────────
@router.get("/settings")
async def mcp_settings(_: str = Depends(require_admin)):
    return await M.settings_get()


@router.put("/settings")
async def mcp_settings_set(body: dict = Body({}), _: str = Depends(require_admin)):
    try:
        return await M.settings_set(body)
    except M.ToolError as e:
        raise HTTPException(400, str(e))


@router.post("/token")
async def mcp_token_new(_: str = Depends(require_admin)):
    """Un nouveau jeton (l'ancien ne vaut plus rien)."""
    return await M.new_token()


@router.get("/token")
async def mcp_token_show(_: str = Depends(require_admin)):
    """Revoir le jeton en cours (10/11/2026), pour recopier la configuration."""
    tok = await M.show_token()
    if not tok:
        raise HTTPException(404, "Ce jeton a été créé avant qu'on le garde : crée un nouveau jeton pour pouvoir le revoir.")
    return {"token": tok}


@router.delete("/token")
async def mcp_token_revoke(_: str = Depends(require_admin)):
    return await M.revoke()


@router.get("/tools")
async def mcp_tools(mode: str = "rw", _: str = Depends(require_admin)):
    """La liste des outils, pour la carte des reglages."""
    return {"tools": [{"name": t["name"], "title": t.get("title"), "rw": not t.get("annotations", {}).get("readOnlyHint", True)}
                      for t in M.tools_for("rw" if mode == "rw" else "ro")]}
