"""
Les categories et etiquettes des impressions, proposees par Claude (07/11/2026).

Trois niveaux : des familles larges (les statistiques, les grands filtres), des categories plus fines (une a trois par
modele, la liste reste ouverte : Claude reutilise d'abord celles qui existent, en cree une seulement pour un objet
vraiment nouveau), et des etiquettes (ce qu'est l'objet, son sujet, sa marque ou son univers, pour qui, comment il est
fait). Une demande par modele, pas par impression.

Pour commencer, une simulation : les derniers modeles imprimes, classes par lots, sans rien ecrire sur les impressions ;
le resultat est garde dans un fichier pour etre relu.

La cle de l'API se colle dans Parametres (jamais dans le code) ; ce qui est consomme est compte par mois.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

K_KEY, K_USAGE = "CLAUDE_API_KEY", "CLAUDE_USAGE"
MODEL = "claude-sonnet-5-5"
BATCH = 10                      # modeles par demande : la liste des categories grandit d'un lot a l'autre
FAMILIES = ["Déco & art", "Figurines & personnages", "Jeux & jouets", "Casse-têtes", "Maison & rangement", "Cuisine",
            "Bureau & école", "Gaming & tech", "Atelier 3D", "Outils & bricolage", "Mode & accessoires",
            "Jardin & extérieur", "Divers"]
_SIM = {"running": False, "done": 0, "total": 0, "error": None}


def _data() -> Path:
    return Path(os.getenv("DATA_DIR", "/data"))


def _sim_file() -> Path:
    return _data() / "ai_tags_sim.json"


# ── Reglages ─────────────────────────────────────────────────────────────────────
async def settings_get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        key = await get_setting(db, K_KEY, "")
        raw = await get_setting(db, K_USAGE, "")
    try:
        use = json.loads(raw) if raw else {}
    except ValueError:
        use = {}
    if use.get("month") != datetime.now().strftime("%Y-%m"):
        use = {}
    return {"has_key": bool(key), "model": MODEL, "usage": {"in": int(use.get("in") or 0), "out": int(use.get("out") or 0),
                                                            "calls": int(use.get("calls") or 0)}}


async def settings_set(body: dict) -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    if "key" in body and body["key"] is not None:
        # vide : on garde l'ancienne (le champ ne la reaffiche jamais) ; « - » : on l'efface
        k = str(body["key"]).strip()
        if k == "-" or k:
            async with AsyncSessionLocal() as db:
                await set_setting(db, K_KEY, "" if k == "-" else k)
    return await settings_get()


async def _count(usage) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting, set_setting
    month = datetime.now().strftime("%Y-%m")
    async with AsyncSessionLocal() as db:
        try:
            use = json.loads(await get_setting(db, K_USAGE, "") or "{}")
        except ValueError:
            use = {}
        if use.get("month") != month:
            use = {"month": month}
        use["in"] = int(use.get("in") or 0) + int(getattr(usage, "input_tokens", 0) or 0)
        use["out"] = int(use.get("out") or 0) + int(getattr(usage, "output_tokens", 0) or 0)
        use["calls"] = int(use.get("calls") or 0) + 1
        await set_setting(db, K_USAGE, json.dumps(use))


# ── Ce qu'on dit d'un modele ───────────────────────────────────────────────────
def _clean(t: str, n: int) -> str:
    t = re.sub(r"\[\[img:[^\]]*\]\]", " ", t or "")
    t = re.sub(r"\[\[h:([^\]]*)\]\]", r"\1. ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:n]


async def _models(n: int) -> list:
    """Les n derniers modeles imprimes (un par modele MakerWorld ; sans modele, un par groupe ou par impression)."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    out, seen = [], set()
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Print.id, Print.design_id, Print.task_name, Print.group_id)
                                 .order_by(Print.created_at.desc()).limit(n * 30))).all()
        groups = {}
        gids = {r[3] for r in rows if r[3]}
        if gids:
            from ..models.print_history import Group
            groups = {g: nm for g, nm in (await db.execute(select(Group.id, Group.name).where(Group.id.in_(gids)))).all()}
    for pid, did, task, gid in rows:
        did = str(did or "").strip()
        key = f"mw:{did}" if did.isdigit() else f"g:{gid}" if gid else f"p:{pid}"
        if key in seen:
            continue
        seen.add(key)
        out.append({"key": key, "did": did if did.isdigit() else None, "task": task or "", "group": groups.get(gid), "print_id": pid})
        if len(out) >= n:
            break
    from .makerworld import _base
    for m in out:
        if not m["did"]:
            m["title"] = m["group"] or m["task"]
            continue
        try:
            b = await _base(m["did"], True)
        except Exception:
            b = {}
        m["title"] = b.get("title_fr") or b.get("title") or m["group"] or m["task"]
        m["mw_categories"] = [c for c in (b.get("categories") or []) if c]
        m["mw_tags"] = [t for t in (b.get("tags") or []) if t][:25]
        m["description"] = _clean(b.get("description") or "", 700)
    return out


# ── La demande ──────────────────────────────────────────────────────────────────
_SYSTEM = """Tu ranges les objets imprimes en 3D d'une personne, pour qu'elle les retrouve et sache a quoi passe son filament.

Pour chaque objet, tu donnes :
- "families" : 1 ou 2 familles, larges. Prends-les dans la liste des familles fournie ; n'en cree une que si aucune ne convient du tout.
- "categories" : 1 a 3 categories plus fines (par exemple Figurines, Fan art, Luminaires, Porte-cles, Vehicules, Supports, Rangement, Miniatures, Repliques...), chacune rattachee a une famille. Reutilise d'abord les categories deja existantes (fournies) des qu'elles conviennent ; n'en cree une nouvelle que pour un objet vraiment different. Maille moyenne : ni « Objet », ni « Support de manette Switch 2 ».
- "tags" : 5 a 12 etiquettes exhaustives qui disent ce qu'est l'objet, son sujet, sa marque ou son univers (noms propres : Porsche, Nintendo, Scrat), pour qui (enfants...), comment il est fait (articule, imprime en place, multicolore, TPU, multi-plateaux...), a quoi il sert. Reutilise les etiquettes deja existantes quand elles disent la meme chose.

Regles :
- Tout en francais, sauf les noms propres, qui gardent leur forme.
- Une etiquette en minuscules (sauf noms propres), au singulier, sans doublon ni variante (pas « porte clé » et « porte-clés »).
- Les categories et etiquettes MakerWorld fournies sont souvent fausses ou floues : sers-t'en comme d'indices, pas comme d'une verite. Juge sur ce qu'est vraiment l'objet (titre, description).
- Un objet sans modele MakerWorld n'a que son nom de fichier : devine au mieux, sans inventer de details.
- Reponds pour chaque objet fourni, avec sa reference "ref" telle quelle."""

_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "ref": {"type": "string"},
            "families": {"type": "array", "items": {"type": "string"}},
            "categories": {"type": "array", "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "family": {"type": "string"}},
                "required": ["name", "family"], "additionalProperties": False}},
            "tags": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["ref", "families", "categories", "tags"], "additionalProperties": False}}},
    "required": ["items"], "additionalProperties": False,
}


def _err(e) -> str:
    import anthropic
    if isinstance(e, anthropic.AuthenticationError):
        return "Clé refusée par Claude : vérifie-la dans Paramètres."
    if isinstance(e, anthropic.PermissionDeniedError):
        return "Cette clé n'a pas le droit d'utiliser ce modèle."
    if isinstance(e, anthropic.RateLimitError):
        return "Trop de demandes d'un coup : réessaie dans une minute."
    if isinstance(e, anthropic.APIStatusError):
        if e.status_code == 400 and "credit" in str(e.message).lower():
            return "Plus de crédit sur ton compte Claude Platform."
        return f"Claude a répondu une erreur ({e.status_code}) : {e.message}"
    if isinstance(e, anthropic.APIConnectionError):
        return "Claude injoignable (réseau)."
    return f"{type(e).__name__} : {e}"


async def _ask(client, batch: list, fams: list, cats: dict, tags: list) -> list:
    objs = []
    for m in batch:
        o = {"ref": m["key"], "titre": m["title"]}
        if m.get("did"):
            o.update(categories_makerworld=m.get("mw_categories") or [], etiquettes_makerworld=m.get("mw_tags") or [],
                     description=m.get("description") or "")
        else:
            o.update(nom_du_fichier=m["task"], groupe=m.get("group") or "")
        objs.append(o)
    ctx = {"familles": fams, "categories_existantes": [{"name": k, "family": v} for k, v in cats.items()],
           "etiquettes_existantes": tags[:400], "objets": objs}
    r = await client.messages.create(
        model=MODEL, max_tokens=8000, system=_SYSTEM,
        messages=[{"role": "user", "content": json.dumps(ctx, ensure_ascii=False)}],
        output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
    )
    await _count(r.usage)
    text = next((b.text for b in r.content if b.type == "text"), "")
    return (json.loads(text) if text else {}).get("items") or []


async def _simulate(n: int) -> None:
    from anthropic import AsyncAnthropic
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    t0 = time.time()
    try:
        async with AsyncSessionLocal() as db:
            key = await get_setting(db, K_KEY, "")
        if not key:
            raise RuntimeError("Aucune clé : colle-la d'abord dans Paramètres › Connexions › Claude.")
        models = await _models(n)
        _SIM.update(total=len(models), done=0)
        client = AsyncAnthropic(api_key=key, timeout=180.0, max_retries=2)
        fams, cats, tags, res = list(FAMILIES), {}, [], {}
        for i in range(0, len(models), BATCH):
            batch = models[i:i + BATCH]
            for it in await _ask(client, batch, fams, cats, tags):
                res[it.get("ref")] = it
                for f in it.get("families") or []:
                    if f and f not in fams:
                        fams.append(f)
                for c in it.get("categories") or []:
                    if c.get("name") and c["name"] not in cats:
                        cats[c["name"]] = c.get("family") or ""
                for t in it.get("tags") or []:
                    if t and t not in tags:
                        tags.append(t)
            _SIM["done"] = min(len(models), i + BATCH)
        rows = []
        for m in models:
            it = res.get(m["key"]) or {}
            rows.append({"ref": m["key"], "title": m["title"], "print_id": m["print_id"], "design_id": m.get("did"),
                         "mw_categories": m.get("mw_categories") or [], "families": it.get("families") or [],
                         "categories": it.get("categories") or [], "tags": it.get("tags") or []})
        new_fams = [f for f in fams if f not in FAMILIES]
        out = {"at": datetime.now().isoformat(timespec="seconds"), "model": MODEL, "seconds": round(time.time() - t0),
               "rows": rows, "families": fams, "new_families": new_fams,
               "categories": [{"name": k, "family": v, "n": sum(1 for r in rows for c in r["categories"] if c.get("name") == k)}
                              for k, v in cats.items()],
               "tags": len(tags)}
        f = _sim_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".part")
        tmp.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        tmp.replace(f)
        _SIM["error"] = None
        logger.info(f"[IA-TAGS] simulation : {len(rows)} modèles, {len(cats)} catégories, {len(tags)} étiquettes, {out['seconds']} s")
    except Exception as e:
        try:
            msg = _err(e)
        except Exception:
            msg = f"{type(e).__name__} : {e}"
        _SIM["error"] = msg
        logger.warning(f"[IA-TAGS] simulation : {msg}")
    finally:
        _SIM["running"] = False


_TASKS: set = set()


def start_simulation(n: int = 50) -> dict:
    if _SIM["running"]:
        return status()
    _SIM.update(running=True, done=0, total=0, error=None)
    t = asyncio.get_running_loop().create_task(_simulate(max(5, min(100, int(n or 50)))))
    _TASKS.add(t)
    t.add_done_callback(_TASKS.discard)
    return status()


def status() -> dict:
    out = {"running": _SIM["running"], "done": _SIM["done"], "total": _SIM["total"], "error": _SIM["error"], "result": None}
    try:
        f = _sim_file()
        if f.is_file():
            out["result"] = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        pass
    return out
