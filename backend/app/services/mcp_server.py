"""
BambuNymous en serveur MCP (10/11/2026) : un assistant (n'importe quel client MCP) interroge l'appli et, si on
l'autorise, agit dessus, pendant une conversation.

Le protocole : Model Context Protocol, transport HTTP « streamable » sans flux (chaque message JSON-RPC recoit sa
reponse en JSON ; aucune session). Les messages : initialize, ping, tools/list, tools/call, resources/list,
resources/read, prompts/list, prompts/get, logging/setLevel, completion/complete ; les notifications sont acquittees.

Deux modes, choisis dans Parametres › Liens : lecture seule (ro) ou lecture et ecriture (rw) ; d'office desactive.
Un seul jeton (« mcp_… »), cree dans Parametres, que l'administrateur peut revoir (10/11/2026). Il se donne en
en-tete (Authorization: Bearer) ou dans l'adresse (/api/v1/mcp/k/<jeton>, pour les connecteurs qui ne savent pas
poser d'en-tete). Les journaux, les mesures et l'activite ne gardent jamais le jeton.
Le mode se lit a chaque appel (10/11/2026) : la liste des outils est toujours complete (un client la garde en
memoire des la connexion : passer en ecriture ne doit pas obliger a rebrancher), et une ecriture en lecture seule
est refusee au moment de l'appel, en le disant.

Les outils appellent l'API de l'appli elle-meme, dans le processus, au nom du compte administrateur principal :
chaque outil fait exactement ce que fait l'interface, avec ses controles. Par-dessus :
  - lecture seule : seules les lectures (GET) passent, quel que soit l'outil ;
  - jamais : l'authentification, les comptes, les copains, les connexions (imprimante, MakerWorld, mails, Claude,
    Telegram, telephones) et leurs identifiants, l'import ou la remise a zero de la base, le reglage du MCP lui-meme,
    les flux sans fin (camera) ; tout le reste se lit et s'ecrit ;
  - dans les reponses, tout ce qui ressemble a un secret est masque.
Une liste d'outils soignes couvre l'usage courant ; trois outils generiques (le catalogue des routes, une lecture,
un appel) couvrent tout le reste de l'API.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import logging
import re
import secrets
import time
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

K_MODE, K_HASH, K_HINT, K_USAGE, K_AT = "MCP_MODE", "MCP_TOKEN_HASH", "MCP_TOKEN_HINT", "MCP_USAGE", "MCP_TOKEN_AT"
K_TOK = "MCP_TOKEN"            # (10/11/2026) le jeton lui-meme, pour que l'administrateur puisse revoir la configuration
MODES = ("off", "ro", "rw")
PROTOCOLS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
SERVER = {"name": "bambunymous", "title": "BambuNymous", "version": "1.0.0"}
API = "/api/v1"
MAX_CHARS = 60000
GUIDE = Path(__file__).resolve().parents[2] / "guide" / "pages"


class ToolError(Exception):
    pass


# ── Reglages ─────────────────────────────────────────────────────────────────────
async def _get(key: str, default: str = "") -> str:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        return await get_setting(db, key, default)


async def _set(key: str, value: str) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, key, value)


def _hash(tok: str) -> str:
    return hashlib.sha256(tok.encode("utf-8")).hexdigest()


async def settings_get() -> dict:
    mode = await _get(K_MODE, "off")
    try:
        use = json.loads(await _get(K_USAGE, "") or "{}")
    except ValueError:
        use = {}
    if use.get("month") != datetime.now().strftime("%Y-%m"):
        use = {"last_at": use.get("last_at"), "last_tool": use.get("last_tool"), "client": use.get("client")}
    return {"mode": mode if mode in MODES else "off", "has_token": bool(await _get(K_HASH, "")), "can_show": bool(await _get(K_TOK, "")),
            "hint": await _get(K_HINT, "") or None, "token_at": await _get(K_AT, "") or None,
            "usage": {"calls": int(use.get("calls") or 0), "errors": int(use.get("errors") or 0),
                      "last_at": use.get("last_at"), "last_tool": use.get("last_tool"), "client": use.get("client")},
            "tools": {"ro": len(tools_for("ro")), "rw": len(tools_for("rw"))},
            "resources": len(_guide_pages()), "prompts": len(PROMPTS)}


async def settings_set(body: dict) -> dict:
    mode = str(body.get("mode") or "")
    if mode not in MODES:
        raise ToolError("Mode inconnu (off, ro ou rw)")
    await _set(K_MODE, mode)
    return await settings_get()


async def new_token() -> dict:
    """Un nouveau jeton (l'ancien ne vaut plus rien)."""
    tok = "mcp_" + secrets.token_urlsafe(32)
    await _set(K_HASH, _hash(tok))
    await _set(K_TOK, tok)
    await _set(K_HINT, tok[-4:])
    await _set(K_AT, datetime.now().isoformat(timespec="seconds"))
    return {**(await settings_get()), "token": tok}


async def show_token() -> str | None:
    """Le jeton en cours, pour revoir la configuration (None : revoque, ou cree avant qu'on le garde)."""
    tok = await _get(K_TOK, "")
    want = await _get(K_HASH, "")
    return tok if tok and want and hmac.compare_digest(_hash(tok), want) else None


async def revoke() -> dict:
    await _set(K_TOK, "")
    await _set(K_HASH, "")
    await _set(K_HINT, "")
    await _set(K_AT, "")
    return await settings_get()


async def check(tok: str) -> str | None:
    """Le mode que ce jeton ouvre (ro, rw), ou None : MCP desactive, pas de jeton, jeton faux."""
    if not tok or not tok.startswith("mcp_"):
        return None
    mode = await _get(K_MODE, "off")
    want = await _get(K_HASH, "")
    if mode not in ("ro", "rw") or not want or not hmac.compare_digest(_hash(tok), want):
        return None
    return mode


async def _note(tool: str | None, ok: bool, client: str | None = None) -> None:
    try:
        use = json.loads(await _get(K_USAGE, "") or "{}")
    except ValueError:
        use = {}
    month = datetime.now().strftime("%Y-%m")
    if use.get("month") != month:
        use = {"month": month}
    if tool:
        use["calls"] = int(use.get("calls") or 0) + 1
        if not ok:
            use["errors"] = int(use.get("errors") or 0) + 1
        use["last_tool"] = tool
    if client:
        use["client"] = client[:80]
    use["last_at"] = datetime.now().isoformat(timespec="seconds")
    await _set(K_USAGE, json.dumps(use))


# ── Ce que le MCP ne touche jamais, et le masquage ───────────────────────────────
_DENY_ALWAYS = [re.compile(p) for p in (
    r"^/api/v1/auth(/|$)", r"^/api/v1/mcp(/|$)", r"/stream$", r"^/api/v1/import", r"^/api/v1/settings/reset-all$",
    r"^/api/v1/makerworld/(token|login|logout)$", r"^/api/v1/friends/[^/]+/p/",
)]
# (10/11/2026) seulement les comptes et les connexions : tout le reste s'ecrit
_DENY_WRITE = [re.compile(p) for p in (
    r"^/api/v1/users(/|$)", r"^/api/v1/friends(/|$)", r"^/api/v1/settings/(mail|claude)$",
    r"^/api/v1/share/telegram/(login|logout)", r"^/api/v1/notify/devices",
)]
# PATCH /settings : la connexion a l'imprimante et l'administrateur restent a l'appli ; le reste (tarif, nom) passe
_SETTINGS_OPEN = {"COST_BY_HOUR", "PRINTER_NAME", "PRINTER_MODEL"}
# (« key » seul n'est pas un secret : c'est la cle d'un plateau du planning, d'une alerte… ; les cles d'API sont « api_key »)
_SECRET_KEY = re.compile(r"(pass(word|wd)?|secret|token|api_?key|access_?code|cookie|session|_hash$|private_?key)", re.I)
_SECRET_VAL = re.compile(r"\b(sk-ant-[\w-]{8,}|fk_[\w-]{8,}|mcp_[\w-]{8,}|gh[pousr]_[\w]{12,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{6,})")


RO_MSG = "Le MCP est en lecture seule : passe-le en lecture et écriture dans Paramètres › Liens › MCP pour agir (sans rebrancher)."


def guard(method: str, path: str, mode: str, body=None) -> None:
    m = method.upper()
    if any(p.search(path) for p in _DENY_ALWAYS):
        raise ToolError("Cette route n'est pas ouverte au MCP (authentification, comptes, connexions, import, flux).")
    if m not in ("GET", "HEAD"):
        if mode != "rw":
            raise ToolError(RO_MSG)
        if any(p.search(path) for p in _DENY_WRITE):
            raise ToolError("Cette écriture n'est pas ouverte au MCP (comptes, copains, connexions et identifiants) : fais-la dans l'appli.")
        if path == API + "/settings" and m == "PATCH" and (not isinstance(body, dict) or set(body) - _SETTINGS_OPEN):
            raise ToolError("Ici, seuls COST_BY_HOUR, PRINTER_NAME et PRINTER_MODEL : la connexion à l'imprimante et le compte admin restent à l'appli.")


def redact(v, key: str = ""):
    if isinstance(v, dict):
        return {k: redact(x, str(k)) for k, x in v.items()}
    if isinstance(v, list):
        return [redact(x, key) for x in v]
    if isinstance(v, str):
        if key and _SECRET_KEY.search(key) and not key.upper().endswith("_SET") and not key.startswith("has_") and v:
            return "•••"
        return _SECRET_VAL.sub("•••", v)
    return v


# ── L'appel a l'API, dans le processus ───────────────────────────────────────────
_AUTH = {"tok": None, "exp": 0.0}


async def _auth() -> str:
    """Un jeton de l'administrateur principal, refait toutes les 10 min (son role est relu en base a chaque appel)."""
    if _AUTH["tok"] and _AUTH["exp"] > time.monotonic():
        return _AUTH["tok"]
    from ..core.security import create_access_token
    from ..db.session import AsyncSessionLocal
    from ..models.user import User
    from ..api.v1.routes.users import _root_admin_id
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        mid = await _root_admin_id(db)
        u = await db.get(User, mid) if mid else None
        name = u.username if u else await get_setting(db, "ADMIN_USERNAME", "admin")
    _AUTH.update(tok=create_access_token(name, "admin"), exp=time.monotonic() + 600)
    return _AUTH["tok"]


def _norm(path: str) -> str:
    p = "/" + str(path or "").strip().lstrip("/")
    if p.startswith(API + "/") or p == API:
        p = p[len(API):] or "/"
    if ".." in p or "\\" in p or "://" in p:
        raise ToolError("Chemin invalide")
    return API + (p if p != "/" else "")


def _clean_query(q) -> dict:
    out = {}
    for k, v in (q or {}).items():
        if v is None or v == "":
            continue
        out[str(k)] = ("true" if v else "false") if isinstance(v, bool) else v
    return out


async def call_api(app, method: str, path: str, mode: str, query: dict | None = None, body=None, max_chars: int = MAX_CHARS) -> list:
    """L'appel, et son resultat en contenus MCP (texte JSON masque et coupe, ou image)."""
    import httpx
    full = _norm(path)
    guard(method, full, mode, body)
    m = method.upper()
    kw = {"params": _clean_query(query), "headers": {"Authorization": f"Bearer {await _auth()}", "X-App-Page": "/mcp"}}
    if body is not None and m not in ("GET", "HEAD", "DELETE"):
        kw["json"] = body
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://bambunymous.mcp", timeout=180) as c:
        r = await c.request(m, full, **kw)
    ct = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
    if r.status_code >= 400:
        try:
            det = r.json().get("detail")
        except Exception:
            det = r.text[:500]
        raise ToolError(f"{r.status_code} : {redact(det) if det else 'erreur'}")
    if ct.startswith("image/"):
        if len(r.content) > 4_000_000:
            return [{"type": "text", "text": f"Image de {len(r.content) // 1024} Ko, trop lourde pour être rendue ici."}]
        return [{"type": "image", "data": base64.b64encode(r.content).decode("ascii"), "mimeType": ct}]
    if r.status_code == 204 or not r.content:
        return [{"type": "text", "text": json.dumps({"ok": True, "status": r.status_code})}]
    if ct == "application/json" or ct.endswith("+json"):
        try:
            data = redact(r.json())
        except ValueError:
            data = None
        if data is not None:
            return [_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str), max_chars)]
    if ct.startswith("text/"):
        txt = r.text
        if "html" in ct:
            txt = html_text(txt)
        return [_text(_SECRET_VAL.sub("•••", txt), max_chars)]
    return binary_content(r.content, ct, full, max_chars)


# ── Les fichiers (10/11/2026) : 3MF lu de l'interieur, vue 3D decrite, documents rendus tels quels ──────────────────
_ZIP_TEXT = (".config", ".json", ".xml", ".rels", ".txt", ".gcode.md5")
BLOB_MAX = 8_000_000


def binary_content(data: bytes, ct: str, path: str, max_chars: int = MAX_CHARS) -> list:
    """Un fichier que l'API rend : un 3MF (une archive) est ouvert et ses reglages lus ; un modele 3D glTF est decrit
    (maillages, boites) ; le reste (PDF, documents…) part tel quel, en ressource, s'il n'est pas trop lourd."""
    import io
    import struct
    import zipfile
    name = path.rsplit("/", 1)[-1]
    kb = len(data) // 1024
    if data[:4] == b"PK\x03\x04":
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
            infos = z.infolist()
            parts = [f"Archive {name} ({kb} Ko), {len(infos)} fichiers :"]
            parts += [f"  {i.filename}  {i.file_size // 1024} Ko" for i in infos[:300]]
            for i in infos:
                low = i.filename.lower()
                if low.endswith(_ZIP_TEXT) and i.file_size <= 400_000:
                    try:
                        txt = z.read(i).decode("utf-8", "replace")
                    except Exception:
                        continue
                    parts.append(f"\n=== {i.filename} ===\n{_SECRET_VAL.sub('•••', txt)}")
            return [_text("\n".join(parts), max(max_chars, 120000))]
        except zipfile.BadZipFile:
            pass
    if data[:4] == b"glTF" and len(data) > 20:
        try:
            ln, kind = struct.unpack("<II", data[12:20])
            if kind == 0x4E4F534A:
                g = json.loads(data[20:20 + ln])
                desc = {"file": name, "ko": kb, "meshes": len(g.get("meshes") or []), "nodes": len(g.get("nodes") or []),
                        "materials": [m.get("name") for m in g.get("materials") or []][:60],
                        "boxes": [{"mesh": (g.get("meshes") or [{}])[0].get("name"), "min": a.get("min"), "max": a.get("max")}
                                  for a in (g.get("accessors") or []) if a.get("type") == "VEC3" and a.get("min")][:60],
                        "extras": g.get("extras") or g.get("asset", {}).get("extras")}
                return [_text(json.dumps(desc, ensure_ascii=False, default=str), max_chars)]
        except Exception:
            pass
    if len(data) <= BLOB_MAX:
        return [{"type": "text", "text": f"Fichier {name} ({ct or 'binaire'}, {kb} Ko), joint tel quel."},
                {"type": "resource", "resource": {"uri": "bambunymous://api" + path, "mimeType": ct or "application/octet-stream",
                                                  "blob": base64.b64encode(data).decode("ascii")}}]
    return [{"type": "text", "text": f"Fichier {name} ({ct or 'binaire'}, {kb} Ko) : trop lourd pour être joint (plus de {BLOB_MAX // 1_000_000} Mo)."}]


def _text(s: str, max_chars: int) -> dict:
    n = max(2000, min(int(max_chars or MAX_CHARS), 200000))
    if len(s) > n:
        s = s[:n] + f"\n…[tronqué : {n} caractères sur {len(s)} ; resserre avec des filtres, limit/offset, ou augmente max_chars]"
    return {"type": "text", "text": s}


def html_text(s: str) -> str:
    s = re.sub(r"(?is)<(script|style)\b.*?</\1>", "", s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|li|h[1-6]|tr|section)>", "\n", s)
    s = re.sub(r"(?i)<li[^>]*>", "• ", s)
    s = re.sub(r"(?i)<h([1-6])[^>]*>", lambda m: "\n" + "#" * int(m.group(1)) + " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", s).strip()


# ── Les outils ───────────────────────────────────────────────────────────────────
S = lambda t, d, **k: {"type": t, "description": d, **k}                 # noqa: E731
STR, INT, NUM, BOOL = (lambda d, **k: S("string", d, **k)), (lambda d, **k: S("integer", d, **k)), \
    (lambda d, **k: S("number", d, **k)), (lambda d, **k: S("boolean", d, **k))
OBJ = lambda d: {"type": "object", "description": d, "additionalProperties": True}   # noqa: E731
MAXC = INT("Taille maximale de la réponse en caractères (d'office 60000)")
DATE = "AAAA-MM-JJ"

# (nom, titre, description, methode, chemin, {parametre: schema}, requis, options)
# options : rw (ecriture), destructive, idempotent, query (parametres en adresse pour une ecriture), body (tout le corps
# vient du parametre « body »), image
_T = [
    # — L'imprimante —
    ("printer_status", "État de l'imprimante",
     "État en direct de l'imprimante : impression en cours (nom, avancement, couches, temps restant), températures, "
     "AMS et leurs slots (filament, couleur, reste), erreurs.", "GET", "/printer/status", {}, [], {}),
    ("printer_details", "Détails de l'imprimante",
     "Tout ce que l'imprimante envoie, rangé par thèmes (réseau, firmware, capteurs, AMS, buse, ventilateurs…).",
     "GET", "/printer/details", {}, [], {}),
    ("camera_snapshot", "Photo de la caméra",
     "Une image de la caméra de l'imprimante, maintenant (pour voir où en est une impression, un spaghetti…).",
     "GET", "/camera/snapshot", {"fresh": INT("1 : une image prise à l'instant plutôt que la dernière en mémoire")}, [], {"image": True}),
    ("live_current", "Impression en cours, en détail",
     "L'impression en cours vue par l'appli : plateau, filaments, couche, estimation corrigée, événements.",
     "GET", "/live/current", {}, [], {}),
    ("ams_layout", "Disposition des AMS", "La disposition des AMS choisie pour la tuile de l'accueil.",
     "GET", "/settings/ams-order", {}, [], {}),
    ("sensors_history", "Historique des capteurs",
     "Températures et humidité (AMS, chambre, plateau…) sur une fenêtre de temps.",
     "GET", "/sensors/history", {"hours": NUM("Fenêtre en heures (d'office 24)"), "end": STR("Fin de la fenêtre (ISO, UTC) ; absent : maintenant")}, [], {}),
    ("timelapses", "Timelapses de la carte SD", "Les timelapses présents sur la carte SD de l'imprimante.",
     "GET", "/printer/sd/timelapses", {}, [], {}),
    # — Recherche, alertes —
    ("search", "Recherche globale",
     "Recherche dans toute l'appli (impressions, modèles, filaments, bobines, objets…), comme la loupe de l'en-tête.",
     "GET", "/search", {"q": STR("Le texte cherché")}, ["q"], {}),
    ("attention", "Ce qui demande attention",
     "Les points d'attention de l'appli (bobine presque vide, séchage dû, commande à ranger, impression à vérifier…).",
     "GET", "/attention", {"per_category": INT("Éléments par catégorie (1 à 10)")}, [], {}),
    ("notifications", "Notifications", "L'historique des notifications du compte.", "GET", "/notify/me/history", {}, [], {}),
    # — Filaments et bobines —
    ("filaments_list", "Filaments",
     "Les filaments (références : marque, matière, couleur, prix, bobines actives et reste total).",
     "GET", "/filaments/filaments", {"q": STR("Nom, marque ou matière"), "material": STR("Matière exacte (PLA, PETG…)"),
                                     "manufacturer": STR("Marque exacte")}, [], {}),
    ("filament_get", "Un filament", "Fiche complète d'un filament.", "GET", "/filaments/filaments/{fid}", {"fid": INT("Numéro du filament")}, ["fid"], {}),
    ("filament_prints", "Impressions d'un filament", "Les impressions faites avec ce filament.",
     "GET", "/filaments/filaments/{fid}/prints", {"fid": INT("Numéro du filament")}, ["fid"], {}),
    ("spools_list", "Bobines",
     "Les bobines (stock) : filament, reste en grammes, emplacement (AMS, rangement, à ranger), séchage, prix. "
     "Filtres facultatifs.", "GET", "/filaments/spools",
     {"q": STR("Texte libre"), "archived": BOOL("true : les bobines archivées (vides) au lieu des actives"),
      "filament_id": INT("Un filament"), "location": STR("Emplacement exact"), "manufacturer": STR("Marque"),
      "material": STR("Matière"), "fila_type": STR("Sous-type (Silk, Matte…)")}, [], {}),
    ("spool_get", "Une bobine", "Fiche complète d'une bobine.", "GET", "/filaments/spools/{sid}", {"sid": INT("Numéro de la bobine")}, ["sid"], {}),
    ("spool_usage", "Historique d'une bobine", "Ce que la bobine a consommé, impression par impression, et ce qu'on lui a rendu.",
     "GET", "/filaments/spools/{sid}/usage", {"sid": INT("Numéro de la bobine")}, ["sid"], {}),
    ("storage", "Rangements",
     "Les rangements (tiroirs, colonnes, cases, vrac, stock) et les bobines dans chaque place : pour savoir où est une bobine ou où ranger.",
     "GET", "/storage", {}, [], {}),
    ("orders_incoming", "Commandes à venir", "Les commandes de filament lues dans les mails : en route, attendues, leurs lignes.",
     "GET", "/filaments/incoming", {"all": BOOL("true : aussi les commandes déjà rangées")}, [], {}),
    ("drying", "Séchage", "L'état du séchage des bobines actives : dernier séchage, délai, à sécher.", "GET", "/filaments/drying/overview", {}, [], {}),
    ("stock_thresholds", "Seuils de stock", "Les seuils de réapprovisionnement par filament.", "GET", "/filaments/stock-thresholds", {}, [], {}),
    ("price_review", "Prix à revoir", "Les bobines et filaments dont le prix manque ou semble faux.", "GET", "/filaments/price-review", {}, [], {}),
    ("catalog_search", "Catalogue de filaments", "Recherche dans les catalogues de filaments (Bambu et autres marques).",
     "GET", "/filaments/catalog/search", {"q": STR("Le texte cherché")}, ["q"], {}),
    # — Impressions —
    ("prints_list", "Impressions",
     "L'historique des impressions, paginé par cartes (une impression seule ou un groupe entier). Filtres facultatifs.",
     "GET", "/prints", {"search": STR("Texte (nom, catégorie, étiquette)"), "status": STR("SUCCESS, FAILED, CANCELLED, IN_PROGRESS…"),
                        "date_from": STR(DATE), "date_to": STR(DATE + " (inclus)"), "material": STR("Matière"),
                        "filament_id": INT("Un filament"), "tag": STR("Une étiquette"), "group_id": INT("Un groupe"),
                        "limit": INT("Cartes par page"), "offset": INT("Décalage")}, [], {}),
    ("print_get", "Une impression", "Fiche complète d'une impression : filaments et grammes, coût, durée, plateau, photos, modèle.",
     "GET", "/prints/{print_id}", {"print_id": INT("Numéro de l'impression")}, ["print_id"], {}),
    ("print_image", "Image d'une impression", "L'image principale d'une impression.", "GET", "/prints/{print_id}/image",
     {"print_id": INT("Numéro de l'impression")}, ["print_id"], {"image": True}),
    ("print_labels", "Catégories d'une impression", "Famille, catégories et étiquettes du modèle de cette impression.",
     "GET", "/prints/{print_id}/labels", {"print_id": INT("Numéro de l'impression")}, ["print_id"], {}),
    ("groups_list", "Groupes d'impressions", "Les groupes (id, nom, nombre d'impressions, date).", "GET", "/prints/groups", {}, [], {}),
    ("group_get", "Un groupe", "Un groupe d'impressions et ses impressions.", "GET", "/prints/groups/{group_id}", {"group_id": INT("Numéro du groupe")}, ["group_id"], {}),
    ("prints_kpis", "Chiffres des impressions", "Totaux (nombre, durée, grammes, coût, réussite) pour les filtres donnés.",
     "GET", "/prints/kpis", {"search": STR("Texte"), "status": STR("Statut"), "date_from": STR(DATE), "date_to": STR(DATE),
                             "material": STR("Matière"), "cat": STR("Catégorie"), "etq": STR("Étiquette")}, [], {}),
    ("stats_summary", "Statistiques", "Les statistiques (comme la page Stats) sur une période.",
     "GET", "/prints/stats/summary", {"date_from": STR(DATE), "date_to": STR(DATE), "days": INT("Ou une fenêtre glissante en jours")}, [], {}),
    ("filament_consumption", "Consommation de filament", "Le filament consommé jour par jour, par matière.",
     "GET", "/prints/stats/filament-days", {"date_from": STR(DATE), "date_to": STR(DATE)}, [], {}),
    ("labels_facets", "Catégories et étiquettes", "Les familles, catégories et étiquettes des modèles imprimés, avec leurs comptes.",
     "GET", "/prints/labels/facets", {}, [], {}),
    ("objects_list", "Objets", "Les objets (créations suivies, ventes, accessoires).", "GET", "/objects/objects", {}, [], {}),
    # — File et planning —
    ("queue", "File « À faire »",
     "La file d'attente : modèles des collections choisies, profils et plateaux, filaments retenus, ce qui est imprimable "
     "maintenant avec l'AMS ou avec le stock, plateaux déjà faits.", "GET", "/makerworld/queue", {}, [], {}),
    ("queue_config", "Réglages de la file", "Collections suivies, profils retenus, quantités.", "GET", "/makerworld/queue/config", {}, [], {}),
    ("plan", "Planning",
     "Le planning : chaque plateau posé sur les jours à venir (début, fin, filaments à charger et où les prendre, "
     "changements de bobine, plateau à monter), les jours, les échéances, les conseils. La « key » d'un plateau sert aux "
     "actions du planning.", "GET", "/makerworld/plan", {"tz": INT("Décalage horaire en minutes (d'office celui du serveur)")}, [], {}),
    ("build_plates", "Plateaux d'impression", "Les plateaux possédés (PEI, Cool Plate…), celui en place.", "GET", "/makerworld/plan/plates", {}, [], {}),
    # — MakerWorld —
    ("mw_search", "Chercher sur MakerWorld", "Recherche publique MakerWorld, avec « déjà imprimé ».",
     "GET", "/makerworld/search", {"q": STR("Le texte cherché"), "offset": INT("Décalage")}, ["q"], {}),
    ("mw_model", "Modèle MakerWorld", "Fiche complète d'un modèle MakerWorld (descriptif, profils, plateaux, filaments).",
     "GET", "/makerworld/model/{design_id}", {"design_id": STR("Numéro du modèle")}, ["design_id"], {}),
    ("mw_collections", "Collections MakerWorld", "Mes collections MakerWorld.", "GET", "/makerworld/collections", {}, [], {}),
    ("mw_collection", "Une collection", "Le contenu d'une collection MakerWorld.", "GET", "/makerworld/collections/{cid}",
     {"cid": STR("Numéro de la collection")}, ["cid"], {}),
    ("mw_likes", "Mes listes MakerWorld", "J'aime (likes), imprimés (printed) ou vus récemment (history).",
     "GET", "/makerworld/collection/{kind}", {"kind": STR("likes, printed ou history", enum=["likes", "printed", "history"])}, ["kind"], {}),
    ("mw_discover", "Découvrir MakerWorld", "Les modèles mis en avant (Trending…).", "GET", "/makerworld/discover",
     {"key": STR("Rubrique (d'office Trending)"), "offset": INT("Décalage")}, [], {}),
    ("mw_following", "Fil des créateurs suivis", "Les nouveautés des créateurs suivis.", "GET", "/makerworld/following/timeline", {}, [], {}),
    ("mw_to_rate", "Modèles à noter", "Les modèles imprimés pas encore notés sur MakerWorld.", "GET", "/makerworld/to-rate", {}, [], {}),
    # — Succès, divers —
    ("achievements", "Succès", "Mes succès (débloqués, progression).", "GET", "/achievements/mine", {}, [], {}),
    ("wrapped", "Bilan de l'année", "Le bilan d'une année d'impression.", "GET", "/wrapped", {"year": INT("L'année")}, [], {}),
    ("logs", "Journal du serveur", "Le journal du serveur (dernières lignes, filtrables).",
     "GET", "/logs", {"limit": INT("Lignes (500 d'office, 2000 au plus)"), "q": STR("Filtre texte"), "min_level": STR("DEBUG, INFO, WARNING, ERROR")}, [], {}),
    ("settings_general", "Réglages généraux", "Les réglages généraux (imprimante, coût horaire…), sans aucun secret.",
     "GET", "/settings", {}, [], {}),
    ("tasks", "Tâches de fond", "Les tâches de fond du serveur et leur état.", "GET", "/settings/tasks", {}, [], {}),

    # ═══ Écritures (mode rw) ═══
    ("plan_lock", "Figer un plateau",
     "Fige (lock: true) ou défige (lock: false) un plateau du planning à sa place. « at » (ISO) le fige à une autre heure.",
     "POST", "/makerworld/plan/lock", {"key": STR("La key du plateau (outil plan)"), "lock": BOOL("true : figer ; false : défiger"),
                                       "at": STR("Heure de début voulue (ISO), facultatif")}, ["key"], {"rw": True, "idempotent": True}),
    ("plan_priority", "Priorité", "La priorité d'un modèle (target : sa ligne) ou d'un plateau (target « ligne:plateau ») : -2 à 2.",
     "POST", "/makerworld/plan/prio", {"target": STR("Ligne du modèle, ou « ligne:plateau »"), "level": INT("De -2 (plus tard) à 2 (urgent)")},
     ["target", "level"], {"rw": True, "idempotent": True}),
    ("plan_deadline", "Échéance", "La date limite d'un modèle (fini AVANT ce jour), ou null pour la retirer.",
     "PUT", "/makerworld/plan/deadline/{design_id}", {"design_id": STR("Ligne du modèle (design_id de la file)"), "due": STR(DATE + " ou vide pour retirer")},
     ["design_id"], {"rw": True, "idempotent": True}),
    ("plan_done", "Marquer fait", "Un plateau imprimé hors de l'appli compte comme fait (undo: true pour annuler).",
     "POST", "/makerworld/plan/done", {"key": STR("La key du plateau"), "undo": BOOL("true : annuler")}, ["key"], {"rw": True}),
    ("plan_later", "Plus tard", "Le plateau quitte sa place et passe en fin de file (whole: tout le modèle).",
     "POST", "/makerworld/plan/later", {"key": STR("La key du plateau"), "whole": BOOL("true : tout le modèle")}, ["key"], {"rw": True}),
    ("plan_place_day", "Placer sur un jour", "Place le plateau sur ce jour, à la meilleure place de la journée.",
     "POST", "/makerworld/plan/place-day", {"key": STR("La key du plateau"), "day": STR(DATE)}, ["key", "day"], {"rw": True}),
    ("plan_smart", "Placer au mieux", "Place le plateau au mieux : le moins de filaments à charger, aucune échéance ratée.",
     "POST", "/makerworld/plan/smart", {"key": STR("La key du plateau")}, ["key"], {"rw": True}),
    ("plan_replace", "À la place de", "Le plateau prend la place et le jour d'un autre (ref), que l'optimiseur replace au mieux.",
     "POST", "/makerworld/plan/replace", {"key": STR("La key du plateau"), "ref": STR("La key du plateau dont il prend la place")}, ["key", "ref"], {"rw": True}),
    ("plan_optimize", "Optimiser le planning",
     "Enchaîne les mêmes couleurs : toute la file, un jour (day) ou à partir d'un jour (from). preview: true montre sans rien changer.",
     "POST", "/makerworld/plan/optimize", {"day": STR(DATE), "from": STR(DATE), "preview": BOOL("true : seulement montrer"),
                                           "merge": BOOL("true : regrouper aussi les plateaux compatibles")}, [], {"rw": True}),
    ("plan_color_day", "Journée couleur", "Pose sur ce jour tous les plateaux de la file qui utilisent ce filament.",
     "POST", "/makerworld/plan/color-day", {"day": STR(DATE), "filament_id": INT("Le filament")}, ["day", "filament_id"], {"rw": True}),
    ("plan_chain", "D'une traite", "Un objet d'une traite : ses plateaux à la suite (plates), tout (all) ou rien (null).",
     "POST", "/makerworld/plan/chain", {"design_id": STR("Ligne du modèle"), "mode": STR("plates, all, ou vide")}, ["design_id"], {"rw": True}),
    ("plates_fit", "Plateaux : tiennent-ils ensemble ?",
     "Pour regrouper : la machine (surface, hauteur, dégagements sous la tige et le capot, rayon de la tête), le mode du profil lu dans son 3MF, "
     "la taille mesurée de chaque plateau, et le verdict couche par couche (un seul filament) et objet par objet (couleurs différentes). "
     "iid : le profil (champ iid d'un plateau de l'outil plan). Si des tailles manquent, ouvrir la vue 3D (api_get /makerworld/3d/{design_id}?fetch=1&profile={iid}).",
     "GET", "/makerworld/plan/fit", {"design_id": STR("Le modèle"), "iid": STR("Le profil (iid)"), "plates": STR("Numéros des plateaux, ex. 1,2,3"),
                                     "mixed": INT("1 couleurs différentes, 0 un seul filament, -1 les deux (d'office)")}, ["design_id"], {}),
    ("model_3d", "Vue 3D et 3MF d'un modèle",
     "Récupère et lit le 3MF d'un profil (fetch=1 le télécharge et le convertit au besoin) : ses plateaux, leur taille en mm, la source. "
     "C'est ce qui mesure les plateaux pour plates_fit.",
     "GET", "/makerworld/3d/{design_id}", {"design_id": STR("Le modèle"), "profile": STR("Le profil (iid)"), "fetch": INT("1 : récupérer le 3MF s'il manque")},
     ["design_id"], {}),
    # (10/11/2026) les fichiers : 3MF ouverts (leurs reglages et plateaux en texte), documents et vues 3D
    ("model_3mf", "3MF d'origine d'un profil",
     "Ouvre le 3MF MakerWorld d'un profil (iid) et en rend le contenu : la liste des fichiers et le texte des réglages "
     "(project_settings, model_settings, plate_N.json, slice_info…). S'il manque, model_3d avec fetch=1 le récupère.",
     "GET", "/makerworld/source3mf/file/{iid}", {"iid": STR("Le profil (iid)"), "max_chars": MAXC}, ["iid"], {}),
    ("print_3mf", "3MF d'une impression", "Le 3MF d'une impression (celui envoyé à l'imprimante), ouvert : fichiers et réglages en texte.",
     "GET", "/prints/{print_id}/3mf", {"print_id": INT("Numéro de l'impression"), "max_chars": MAXC}, ["print_id"], {}),
    ("print_files", "Fichiers d'une impression", "Les fichiers joints à une impression (photos, 3MF, documents).",
     "GET", "/prints/{print_id}/files", {"print_id": INT("Numéro de l'impression")}, ["print_id"], {}),
    ("print_file", "Un fichier d'une impression", "Un fichier joint à une impression : image vue telle quelle, 3MF ouvert, document joint.",
     "GET", "/prints/{print_id}/file/{filename}", {"print_id": INT("Numéro de l'impression"), "filename": STR("Le nom du fichier (print_files)"),
                                                   "max_chars": MAXC}, ["print_id", "filename"], {}),
    ("group_3mf", "3MF d'un groupe", "Le 3MF d'un groupe d'impressions, ouvert.", "GET", "/prints/groups/{group_id}/3mf",
     {"group_id": INT("Le groupe"), "max_chars": MAXC}, ["group_id"], {}),
    ("group_files", "Fichiers d'un groupe", "Les fichiers d'un groupe d'impressions.", "GET", "/prints/groups/{group_id}/files",
     {"group_id": INT("Le groupe")}, ["group_id"], {}),
    ("mw_doc", "Document d'un modèle", "Un document joint à un modèle MakerWorld (notice, nomenclature…) : rendu tel quel (PDF, image).",
     "GET", "/makerworld/doc/{design_id}/{doc_id}", {"design_id": STR("Le modèle"), "doc_id": STR("Le document (fiche du modèle)")},
     ["design_id", "doc_id"], {}),
    ("model_3d_file", "Fichier de la vue 3D", "Un fichier de la vue 3D (glb : maillages, matières et boîtes de chaque pièce ; ou json : plateaux et assemblage).",
     "GET", "/makerworld/3d/file/{key}/{name}", {"key": STR("La clé de la vue (url des plateaux de model_3d)"), "name": STR("Le fichier"), "max_chars": MAXC},
     ["key", "name"], {}),
    ("model_colors", "Couleurs de la vue 3D", "Les couleurs de chaque pièce dans la vue 3D d'un modèle (et ce qui a été choisi).",
     "GET", "/makerworld/3d/{design_id}/colors", {"design_id": STR("Le modèle"), "profile": STR("Le profil (iid)")}, ["design_id"], {}),
    ("model_profiles", "Profil de chaque impression", "Le profil (iid) retenu pour chaque impression d'un modèle (ids : numéros d'impressions séparés par des virgules).",
     "GET", "/makerworld/model/{design_id}/print-profiles", {"design_id": STR("Le modèle"), "ids": STR("Numéros d'impressions, ex. 12,13")}, ["design_id"], {}),
    ("source_info", "3MF importé d'une impression", "Ce que dit le 3MF importé à la main pour des impressions (titre, plateaux, profil).",
     "GET", "/prints/source-info", {"ids": STR("Numéros d'impressions, ex. 12,13"), "group": INT("Ou un groupe")}, [], {}),
    # (10/11/2026) regrouper et ranger, comme a la main dans le planning
    ("plan_merge", "Regrouper des plateaux",
     "Regroupe des plateaux d'un même modèle en une seule impression (keys, 2 à 12), ou défait un regroupement (gid, l'id « m1 »… vu dans l'outil plan).",
     "POST", "/makerworld/plan/merge", {"keys": S("array", "Les keys des plateaux à imprimer ensemble", items={"type": "string"}),
                                        "gid": STR("Le regroupement à défaire")}, [], {"rw": True}),
    ("plan_arrange", "Ranger le planning",
     "Range le planning d'un coup : order = les keys dans l'ordre voulu (le début suffit, le reste suit), pins = {key: jour AAAA-MM-JJ ou null} "
     "pour poser ou libérer un plateau sur un jour, merge = des listes de keys à regrouper. Un plateau figé ne se déplace pas. Annulable (plan_undo).",
     "PUT", "/makerworld/plan/arrange", {"order": S("array", "Les keys dans l'ordre voulu", items={"type": "string"}),
                                         "pins": OBJ("{key: jour AAAA-MM-JJ, ou null pour le libérer}"),
                                         "merge": S("array", "Des listes de keys à regrouper", items={"type": "array", "items": {"type": "string"}}),
                                         "why": STR("Le nom du geste dans l'historique (d'office « Rangement »)")}, [], {"rw": True}),
    ("plan_undo", "Annuler", "Annule le dernier geste du planning.", "POST", "/makerworld/plan/undo", {}, [], {"rw": True}),
    ("plan_settings", "Réglages du planning",
     "Change les réglages du planning (plages horaires, écart entre impressions, jours particuliers…) : body = les champs à changer, comme dans la réponse de l'outil plan (settings).",
     "PUT", "/makerworld/plan/settings", {"body": OBJ("Les réglages à changer")}, ["body"], {"rw": True, "body": True}),
    ("queue_qty", "Quantité voulue", "Le nombre d'exemplaires voulus pour un modèle de la file.",
     "PUT", "/makerworld/queue/qty/{design_id}", {"design_id": STR("Ligne du modèle"), "qty": INT("Exemplaires")}, ["design_id", "qty"], {"rw": True, "idempotent": True}),
    ("queue_restart", "Repartir à zéro", "on: true : seules les impressions faites désormais comptent pour ce modèle ; false : tout recompte.",
     "PUT", "/makerworld/queue/since/{design_id}", {"design_id": STR("Ligne du modèle"), "on": BOOL("true ou false")}, ["design_id", "on"], {"rw": True, "idempotent": True}),
    ("queue_order", "Ordre de la file", "L'ordre de priorité des modèles de la file (les lignes design_id, du plus prioritaire au moins).",
     "PUT", "/makerworld/queue/order", {"ids": S("array", "Les lignes de la file, dans l'ordre voulu", items={"type": "string"})}, ["ids"], {"rw": True, "idempotent": True}),
    ("mw_set_collections", "Ranger un modèle dans des collections",
     "Les collections MakerWorld où est ce modèle (la file suit des collections : c'est ainsi qu'on l'ajoute ou le retire de « À faire »). "
     "ids = la liste complète voulue.", "PUT", "/makerworld/design/{design_id}/collections",
     {"design_id": STR("Numéro du modèle MakerWorld"), "ids": S("array", "Numéros des collections (liste complète)", items={"type": "string"})},
     ["design_id", "ids"], {"rw": True, "idempotent": True}),
    ("mw_like", "J'aime MakerWorld", "Aimer (on: true) ou ne plus aimer un modèle MakerWorld.",
     "PUT", "/makerworld/model/{design_id}/like", {"design_id": STR("Numéro du modèle"), "liked": BOOL("true : aimer ; false : ne plus aimer")}, ["design_id", "liked"], {"rw": True, "idempotent": True}),
    ("storage_assign", "Ranger des bobines",
     "Range ces bobines à cette place (place_id de l'outil storage) ; place_id vide leur retire leur place (to_store: true : « À ranger »). "
     "Une case déjà prise : force: true déloge l'occupante.", "POST", "/storage/assign",
     {"spool_ids": S("array", "Numéros des bobines", items={"type": "integer"}), "place_id": INT("La place ; absent : retirer"),
      "force": BOOL("Déloger l'occupante"), "to_store": BOOL("Les remettre « À ranger »")}, ["spool_ids"], {"rw": True}),
    ("spool_weight", "Poids d'une bobine", "Réajuste le reste d'une bobine : mode set (valeur), add ou sub (grammes).",
     "POST", "/filaments/spools/{sid}/weight", {"sid": INT("Numéro de la bobine"), "mode": STR("set, add ou sub", enum=["set", "add", "sub"]),
                                                "value": NUM("Grammes"), "label": STR("Motif, facultatif")}, ["sid", "mode", "value"], {"rw": True}),
    ("spool_update", "Modifier une bobine",
     "Modifie une bobine : remaining_weight_g, price_override, location, tag_number, comment, archived, last_dried_at (ISO).",
     "PATCH", "/filaments/spools/{sid}", {"sid": INT("Numéro de la bobine"), "remaining_weight_g": NUM("Reste (g)"), "price_override": NUM("Prix (€)"),
                                          "location": STR("Emplacement"), "tag_number": STR("Numéro d'étiquette"), "comment": STR("Commentaire"),
                                          "archived": BOOL("Archivée"), "last_dried_at": STR("Dernier séchage (ISO)")}, ["sid"], {"rw": True, "idempotent": True}),
    ("filament_update", "Modifier un filament", "Modifie un filament : body = les champs à changer (comme dans filament_get).",
     "PATCH", "/filaments/filaments/{fid}", {"fid": INT("Numéro du filament"), "body": OBJ("Les champs à changer")}, ["fid", "body"], {"rw": True, "body": True, "idempotent": True}),
    ("filament_no_reorder", "Ne plus commander", "Marque un filament « plus commandé » (on: true) ou l'inverse.",
     "PUT", "/filaments/filaments/{fid}/no-reorder", {"fid": INT("Numéro du filament"), "on": BOOL("true ou false")}, ["fid"], {"rw": True, "idempotent": True}),
    ("print_update", "Modifier une impression",
     "Modifie une impression : status, status_note, notes, number_of_items, translated_name, stats_excluded, sold_units, sold_price_total…",
     "PATCH", "/prints/{print_id}", {"print_id": INT("Numéro de l'impression"), "body": OBJ("Les champs à changer")}, ["print_id", "body"], {"rw": True, "body": True, "idempotent": True}),
    ("print_add_tag", "Étiqueter une impression", "Ajoute une étiquette à une impression.",
     "POST", "/prints/{print_id}/tags", {"print_id": INT("Numéro de l'impression"), "tag": STR("L'étiquette")}, ["print_id", "tag"], {"rw": True}),
    ("print_remove_tag", "Retirer une étiquette", "Retire une étiquette d'une impression.",
     "DELETE", "/prints/{print_id}/tags/{tag}", {"print_id": INT("Numéro de l'impression"), "tag": STR("L'étiquette")}, ["print_id", "tag"], {"rw": True, "destructive": True, "idempotent": True}),
    ("attention_dismiss", "Écarter une alerte", "Écarte un point d'attention (sa key, outil attention), pour quelques jours ou pour de bon.",
     "POST", "/attention/dismiss", {"key": STR("La key du point"), "days": INT("Pour tant de jours ; absent : définitivement")}, ["key"], {"rw": True}),
    ("mail_sync", "Relire les mails", "Relit la boîte mail tout de suite (nouvelles commandes de filament).",
     "POST", "/settings/mail/sync", {}, [], {"rw": True}),
    ("ams_drying_place", "Bobine à sécher dans l'AMS", "Dit qu'une bobine est posée dans un slot VIDE de l'AMS pour y sécher (ams_id, tray_id : numéros de printer_status).",
     "PUT", "/printer/ams/{ams_id}/{tray_id}/drying", {"ams_id": INT("L'AMS"), "tray_id": INT("Le slot"), "spool_id": INT("La bobine")},
     ["ams_id", "tray_id", "spool_id"], {"rw": True}),
    ("ams_drying_remove", "Fin du séchage dans l'AMS", "La bobine posée pour sécher quitte ce slot.",
     "DELETE", "/printer/ams/{ams_id}/{tray_id}/drying", {"ams_id": INT("L'AMS"), "tray_id": INT("Le slot")}, ["ams_id", "tray_id"], {"rw": True}),
]

# les trois outils generiques : tout le reste de l'API
_GENERIC = [
    {"name": "api_catalog", "title": "Catalogue de l'API",
     "description": "Toutes les routes de l'API de BambuNymous (méthode, chemin, rôle), filtrables : pour trouver ce que les autres "
                    "outils ne couvrent pas, puis l'appeler avec api_get (ou api_call en écriture).",
     "inputSchema": {"type": "object", "properties": {"q": STR("Mot cherché dans le chemin ou la description"),
                                                      "method": STR("GET, POST, PUT, PATCH, DELETE")}},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "api_get", "title": "Lire une route de l'API",
     "description": "Lit n'importe quelle route GET de l'API (chemin relatif à /api/v1, ex. /filaments/spools/12/usage), avec ses paramètres.",
     "inputSchema": {"type": "object", "properties": {"path": STR("Chemin (ex. /prints/stats/summary)"), "query": OBJ("Paramètres d'adresse"),
                                                      "max_chars": MAXC}, "required": ["path"]},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "api_call", "title": "Appeler une route de l'API", "rw": True,
     "description": "Appelle n'importe quelle route de l'API en écriture (POST, PUT, PATCH, DELETE), exactement comme l'interface. "
                    "Vérifie la route avec api_catalog d'abord, et demande confirmation à l'utilisateur avant tout ce qui supprime.",
     "inputSchema": {"type": "object", "properties": {"method": STR("POST, PUT, PATCH ou DELETE", enum=["POST", "PUT", "PATCH", "DELETE"]),
                                                      "path": STR("Chemin"), "query": OBJ("Paramètres d'adresse"), "body": OBJ("Corps JSON"),
                                                      "max_chars": MAXC}, "required": ["method", "path"]},
     "annotations": {"readOnlyHint": False, "destructiveHint": True, "openWorldHint": False}},
    {"name": "guide", "title": "Guide d'utilisation",
     "description": "Le guide de BambuNymous : sans « page », la liste des chapitres ; avec, le chapitre en texte (comment marche chaque écran).",
     "inputSchema": {"type": "object", "properties": {"page": STR("Le chapitre (ex. filaments, impressions)"), "q": STR("Ou un mot cherché dans tout le guide")}},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
]


def _tool_def(t) -> dict:
    name, title, desc, method, path, params, req, opt = t
    props = dict(params)
    if method == "GET" and not opt.get("image"):
        props["max_chars"] = MAXC
    rw = bool(opt.get("rw"))
    ann = {"title": title, "readOnlyHint": not rw, "openWorldHint": path.startswith("/makerworld/") and not path.startswith("/makerworld/plan")}
    if rw:
        ann["destructiveHint"] = bool(opt.get("destructive"))
        if opt.get("idempotent"):
            ann["idempotentHint"] = True
    return {"name": name, "title": title, "description": desc + ("" if not rw else " (écriture)"),
            "inputSchema": {"type": "object", "properties": props, **({"required": req} if req else {})}, "annotations": ann}


_BY_NAME = {t[0]: t for t in _T}


def tools_for(mode: str) -> list:
    """Les outils. (10/11/2026) le serveur donne toujours la liste complete (mode « all ») : un client la garde des la
    connexion, et passer en ecriture ne doit pas obliger a rebrancher ; une ecriture en lecture seule est refusee a l'appel."""
    out = [_tool_def(t) for t in _T if mode in ("rw", "all") or not t[7].get("rw")]
    for g in _GENERIC:
        if g.get("rw") and mode not in ("rw", "all"):
            continue
        out.append({k: v for k, v in g.items() if k != "rw"})
    return out


async def call_tool(app, name: str, args: dict, mode: str) -> dict:
    args = dict(args or {})
    maxc = args.pop("max_chars", None) or MAX_CHARS
    try:
        if name == "api_catalog":
            return {"content": [_text(json.dumps(catalog(app, args.get("q"), args.get("method"), mode), ensure_ascii=False), 200000)]}
        if name == "api_get":
            return {"content": await call_api(app, "GET", args.get("path"), mode, args.get("query"), None, maxc)}
        if name == "api_call":
            if mode != "rw":
                raise ToolError(RO_MSG)
            m = str(args.get("method") or "").upper()
            if m not in ("POST", "PUT", "PATCH", "DELETE"):
                raise ToolError("Méthode : POST, PUT, PATCH ou DELETE")
            return {"content": await call_api(app, m, args.get("path"), mode, args.get("query"), args.get("body"), maxc)}
        if name == "guide":
            return {"content": [_text(guide(args.get("page"), args.get("q")), maxc)]}
        t = _BY_NAME.get(name)
        if not t:
            raise ToolError(f"Outil inconnu : {name}")
        if t[7].get("rw") and mode != "rw":
            raise ToolError(RO_MSG)
        _n, _ti, _d, method, path, params, req, opt = t
        miss = [r for r in req if args.get(r) in (None, "")]
        if miss:
            raise ToolError("Paramètre manquant : " + ", ".join(miss))
        for k in re.findall(r"{(\w+)}", path):
            v = str(args.pop(k, ""))
            if not re.fullmatch(r"[\w.~:-]+", v):
                raise ToolError(f"Valeur invalide pour {k}")
            path = path.replace("{" + k + "}", v)
        if method == "GET":
            return {"content": await call_api(app, method, path, mode, args, None, maxc)}
        body = args.get("body") if opt.get("body") else args
        if opt.get("body") and not isinstance(body, dict):
            body = {}
        if method == "DELETE":
            return {"content": await call_api(app, method, path, mode, args if not opt.get("body") else None, None, maxc)}
        return {"content": await call_api(app, method, path, mode, None, body, maxc)}
    except ToolError as e:
        return {"content": [{"type": "text", "text": str(e)}], "isError": True}
    except Exception as e:                            # noqa: BLE001
        logger.exception("[MCP] outil %s", name)
        return {"content": [{"type": "text", "text": f"Erreur interne : {type(e).__name__}"}], "isError": True}


def _route_args(r) -> dict:
    """(10/11/2026) ce qu'une route attend : ses parametres d'adresse et, pour un corps type, ses champs."""
    out = {}
    try:
        dep = r.dependant
        qs = [p.name for p in dep.query_params]
        if qs:
            out["query"] = qs
        for b in dep.body_params:
            ann = getattr(b.field_info, "annotation", None) or getattr(b, "type_", None)
            fields = getattr(ann, "model_fields", None)
            if fields:
                out["body"] = {k: str(getattr(v.annotation, "__name__", v.annotation)) for k, v in fields.items()}
            else:
                out["body"] = "objet JSON (voir doc)"
    except Exception:
        pass
    return out


def catalog(app, q=None, method=None, mode="ro") -> list:
    """Les routes de l'API, celles que le MCP peut appeler dans ce mode."""
    out = []
    ql, ml = (q or "").lower().strip(), (method or "").upper().strip()
    for r in getattr(app, "routes", []):
        path = getattr(r, "path", "") or ""
        if not path.startswith(API + "/"):
            continue
        for m in sorted(getattr(r, "methods", None) or []):
            if m in ("HEAD", "OPTIONS") or (ml and m != ml):
                continue
            try:
                guard(m, path, "rw", {})
            except ToolError:
                if not (m == "PATCH" and path == API + "/settings"):
                    continue
            doc = " ".join(((getattr(r, "endpoint", None) and r.endpoint.__doc__) or "").split())[:240]
            row = {"method": m, "path": path[len(API):], "doc": doc, **_route_args(r)}
            if m not in ("GET", "HEAD") and mode != "rw":
                row["rw"] = True                   # le MCP doit etre en lecture et ecriture pour l'appeler
            if ql and ql not in row["path"].lower() and ql not in doc.lower():
                continue
            out.append(row)
    return out


# ── Le guide : outil et ressources ───────────────────────────────────────────────
def _guide_pages() -> list:
    try:
        return sorted(p.stem for p in GUIDE.glob("*.html"))
    except Exception:
        return []


def _guide_text(name: str) -> str | None:
    if name not in _guide_pages():
        return None
    return html_text((GUIDE / f"{name}.html").read_text(encoding="utf-8"))


def guide(page=None, q=None) -> str:
    if page:
        t = _guide_text(str(page))
        return t if t is not None else "Chapitre inconnu. Chapitres : " + ", ".join(_guide_pages())
    if q:
        ql, hits = str(q).lower(), []
        for p in _guide_pages():
            for para in (_guide_text(p) or "").split("\n"):
                if ql in para.lower():
                    hits.append(f"[{p}] {para.strip()[:600]}")
        return "\n\n".join(hits[:40]) or "Rien trouvé dans le guide."
    return "Chapitres du guide : " + ", ".join(_guide_pages())


def resources() -> list:
    return [{"uri": f"bambunymous://guide/{p}", "name": f"guide-{p}", "title": f"Guide · {p}",
             "description": f"Le chapitre « {p} » du guide de BambuNymous", "mimeType": "text/plain"} for p in _guide_pages()]


def read_resource(uri: str) -> dict:
    m = re.fullmatch(r"bambunymous://guide/([a-z0-9-]+)", uri or "")
    t = _guide_text(m.group(1)) if m else None
    if t is None:
        raise ToolError("Ressource inconnue")
    return {"contents": [{"uri": uri, "mimeType": "text/plain", "text": t}]}


# ── Les invites ──────────────────────────────────────────────────────────────────
PROMPTS = {
    "ce_soir": ("Que lancer ce soir ?",
                "Regarde l'état de l'imprimante (printer_status), le planning (plan) et la file (queue). Dis-moi quoi lancer ce soir, "
                "de préférence sans changer de bobine ; sinon, quelle bobine charger et où la prendre (storage).", []),
    "bilan_mois": ("Bilan du mois",
                   "Fais le bilan de mes impressions sur le mois {mois} (stats_summary, prints_kpis, filament_consumption) : "
                   "nombre, réussite, durée, filament et coût, ce qui a raté et pourquoi, tendances.", [("mois", "Le mois (AAAA-MM), d'office le mois en cours")]),
    "ou_est": ("Où est cette bobine ?", "Trouve la bobine « {bobine} » (spools_list, storage) : où elle est rangée, combien il en reste.",
               [("bobine", "Nom, couleur ou numéro de la bobine")]),
    "stock": ("Point sur le stock",
              "Fais le point sur mon stock de filament (filaments_list, spools_list, stock_thresholds, orders_incoming) : ce qui va manquer, "
              "ce qui est commandé, ce qui dort.", []),
    "planning_semaine": ("Planning de la semaine",
                         "Résume mon planning des 7 prochains jours (plan) : chaque jour, ce qui s'imprime, les changements de bobine, "
                         "les échéances menacées ; propose des améliorations sans rien changer.", []),
    "echec": ("Pourquoi ça a raté ?",
              "Analyse l'impression {print_id} (print_get, print_image, live_current si elle est en cours) : cause probable de l'échec "
              "et quoi changer (filament, séchage, plateau, réglages).", [("print_id", "Numéro de l'impression")]),
}


def prompts() -> list:
    return [{"name": k, "title": v[0], "description": v[0],
             "arguments": [{"name": a, "description": d, "required": False} for a, d in v[2]]} for k, v in PROMPTS.items()]


def get_prompt(name: str, args: dict) -> dict:
    p = PROMPTS.get(name)
    if not p:
        raise ToolError("Invite inconnue")
    txt = p[1]
    for a, _d in p[2]:
        v = str((args or {}).get(a) or "")
        if a == "mois" and not v:
            v = datetime.now().strftime("%Y-%m")
        txt = txt.replace("{" + a + "}", v or "(à préciser)")
    return {"description": p[0], "messages": [{"role": "user", "content": {"type": "text", "text": txt}}]}


# ── Le protocole ─────────────────────────────────────────────────────────────────
INSTRUCTIONS = (
    "BambuNymous suit une imprimante 3D Bambu Lab : impressions, filaments et bobines, rangements, file « À faire » "
    "(modèles MakerWorld) et planning. Réponds en français. Les « key » des plateaux viennent de l'outil plan ; les "
    "numéros de bobines, de filaments et d'impressions des outils de liste. Pour ce que les outils ne couvrent pas : "
    "api_catalog puis api_get / api_call. Avant toute écriture qui supprime ou déplace beaucoup, demande confirmation."
)


def _err(i, code, msg):
    return {"jsonrpc": "2.0", "id": i, "error": {"code": code, "message": msg}}


async def handle(app, msg, mode: str):
    """Un message JSON-RPC -> sa reponse (None pour une notification)."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
        return _err(msg.get("id") if isinstance(msg, dict) else None, -32600, "Requête invalide")
    i, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
    if method is None:
        return None                                   # une reponse du client : rien a rendre
    if i is None:
        return None                                   # notification (initialized, cancelled…)
    ok = lambda r: {"jsonrpc": "2.0", "id": i, "result": r}   # noqa: E731
    try:
        if method == "initialize":
            want = str(params.get("protocolVersion") or "")
            ci = params.get("clientInfo") or {}
            await _note(None, True, f"{ci.get('name')} {ci.get('version') or ''}".strip() if ci.get("name") else None)
            return ok({"protocolVersion": want if want in PROTOCOLS else PROTOCOLS[0],
                       "capabilities": {"tools": {"listChanged": False}, "resources": {"listChanged": False, "subscribe": False},
                                        "prompts": {"listChanged": False}, "logging": {}, "completions": {}},
                       "serverInfo": SERVER,
                       "instructions": INSTRUCTIONS + (" Pour l'instant en LECTURE SEULE (le mode peut changer : une écriture refusée le dit)." if mode != "rw" else "")})
        if method == "ping":
            return ok({})
        if method == "tools/list":
            return ok({"tools": tools_for("all")})
        if method == "tools/call":
            name = str(params.get("name") or "")
            res = await call_tool(app, name, params.get("arguments") or {}, mode)
            await _note(name, not res.get("isError"))
            return ok(res)
        if method == "resources/list":
            return ok({"resources": resources()})
        if method == "resources/templates/list":
            return ok({"resourceTemplates": []})
        if method == "resources/read":
            return ok(read_resource(str(params.get("uri") or "")))
        if method == "prompts/list":
            return ok({"prompts": prompts()})
        if method == "prompts/get":
            return ok(get_prompt(str(params.get("name") or ""), params.get("arguments") or {}))
        if method == "logging/setLevel":
            return ok({})
        if method == "completion/complete":
            ref, arg = params.get("ref") or {}, params.get("argument") or {}
            vals = []
            if ref.get("type") == "ref/resource" or (ref.get("type") == "ref/prompt" and arg.get("name") == "page"):
                vals = [p for p in _guide_pages() if p.startswith(str(arg.get("value") or ""))]
            return ok({"completion": {"values": vals[:100], "total": len(vals), "hasMore": False}})
        return _err(i, -32601, f"Méthode inconnue : {method}")
    except ToolError as e:
        return _err(i, -32602, str(e))
    except Exception as e:                            # noqa: BLE001
        logger.exception("[MCP] %s", method)
        return _err(i, -32603, f"Erreur interne : {type(e).__name__}")
