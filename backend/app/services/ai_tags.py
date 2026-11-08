"""
Les categories et etiquettes des impressions, proposees par Claude (07/11/2026).

Trois niveaux : des familles larges (les statistiques, les grands filtres), des categories plus fines (une a trois par
modele, la liste reste ouverte : Claude reutilise d'abord celles qui existent, en cree une seulement pour un objet
vraiment nouveau), et des etiquettes (ce qu'est l'objet, son sujet, sa marque ou son univers, pour qui, comment il est
fait). Une demande par modele, pas par impression.

Toute la collection se classe par lots (voir plus bas) ; le resultat vit dans la table model_labels, une ligne par
modele.

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


def _data() -> Path:
    return Path(os.getenv("DATA_DIR", "/data"))


# ── Reglages ─────────────────────────────────────────────────────────────────────
async def settings_get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        key = await get_setting(db, K_KEY, "")
        raw = await get_setting(db, K_USAGE, "")
        auto = await get_setting(db, "CLAUDE_AUTO", "1")
    try:
        use = json.loads(raw) if raw else {}
    except ValueError:
        use = {}
    if use.get("month") != datetime.now().strftime("%Y-%m"):
        use = {}
    return {"has_key": bool(key), "model": MODEL, "auto": auto != "0", "usage": {"in": int(use.get("in") or 0), "out": int(use.get("out") or 0),
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
    if "auto" in body and body["auto"] is not None:
        # le classement automatique des nouveaux modeles, a la fin de chaque impression
        async with AsyncSessionLocal() as db:
            await set_setting(db, "CLAUDE_AUTO", "1" if body["auto"] else "0")
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


def model_key(did, gid, pid) -> str:
    """La cle du modele d'une impression : son modele MakerWorld, sinon son groupe, sinon elle-meme."""
    did = str(did or "").strip()
    return f"mw:{did}" if did.isdigit() else f"g:{gid}" if gid else f"p:{pid}"


async def _select(n: int | None = None) -> list:
    """Les modeles imprimes, du plus recent au plus ancien (un par modele MakerWorld ; sans modele, un par groupe ou
    par impression) ; les n premiers, ou tous."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    out, seen = [], set()
    async with AsyncSessionLocal() as db:
        q = select(Print.id, Print.design_id, Print.task_name, Print.group_id).order_by(Print.created_at.desc())
        rows = (await db.execute(q.limit(n * 30) if n else q)).all()
        groups = {}
        gids = {r[3] for r in rows if r[3]}
        if gids:
            from ..models.print_history import Group
            groups = {g: nm for g, nm in (await db.execute(select(Group.id, Group.name).where(Group.id.in_(gids)))).all()}
    for pid, did, task, gid in rows:
        key = model_key(did, gid, pid)
        if key in seen:
            continue
        seen.add(key)
        did = str(did or "").strip()
        out.append({"key": key, "did": did if did.isdigit() else None, "gid": gid, "task": task or "", "group": groups.get(gid),
                    "print_id": pid})
        if n and len(out) >= n:
            break
    return out


async def _prepare(out: list) -> list:
    """Ce qu'on dit de chaque modele : la fiche MakerWorld (titre, categories, mots-cles, description) et son image."""
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
        m["description"] = _clean(b.get("description") or "", 1500)
        m["img_url"] = b.get("cover_url") or (b.get("pictures") or [None])[0]
    # l'image de l'objet (07/11/2026) : c'est elle qui dit ce qu'il est vraiment (le « Kimono de gi » rangé en vêtement)
    await asyncio.gather(*(asyncio.to_thread(_image, m) for m in out))
    return out


def _image(m: dict) -> None:
    """L'image principale du modele (sans modele MakerWorld : celle du plateau imprime), reduite a 384 px en JPEG
    (quelques centaines de jetons) dans m["img"] (base64), ou rien."""
    import base64
    from io import BytesIO
    try:
        raw = None
        if m.get("img_url"):
            from .makerworld import session
            r = session().get(m["img_url"], timeout=20)
            raw = r.content if r.status_code == 200 else None
        else:
            d = _data() / "prints" / str(m["print_id"])
            for n in ("plate.png", "plate.jpg"):
                if (d / n).is_file():
                    raw = (d / n).read_bytes()
                    break
        if not raw:
            return
        from PIL import Image
        im = Image.open(BytesIO(raw))
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        im.thumbnail((384, 384))
        buf = BytesIO()
        im.save(buf, "JPEG", quality=80)
        m["img"] = base64.standard_b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        logger.debug(f"[IA-TAGS] image de {m.get('key')} illisible", exc_info=True)


# ── La demande ──────────────────────────────────────────────────────────────────
_SYSTEM = """Tu ranges les objets imprimes en 3D d'une personne, pour qu'elle les retrouve et sache a quoi passe son filament.

Pour chaque objet, tu donnes :
- "families" : 1 ou 2 familles, larges. Prends-les dans la liste des familles fournie ; n'en cree une que si aucune ne convient du tout.
- "categories" : 1 a 3 categories plus fines (par exemple Figurines, Fan art, Luminaires, Porte-cles, Vehicules, Supports, Rangement, Miniatures, Repliques...), chacune rattachee a une famille. Reutilise d'abord les categories deja existantes (fournies) des qu'elles conviennent ; n'en cree une nouvelle que pour un objet vraiment different. Maille moyenne : ni « Objet », ni « Support de manette Switch 2 ».
- "tags" : 8 a 15 etiquettes variees, pour qu'on retrouve l'objet par n'importe quel bout. Couvre plusieurs angles, autant qu'ils s'appliquent :
  * ce qu'est l'objet, du plus precis au plus general (Porsche 911, voiture, vehicule ; chat, felin, animal) ;
  * son sujet : personnage, animal, lieu, metier, theme (espace, mer, dinosaure, musique...) ;
  * son univers, son oeuvre, sa marque (noms propres : L'Âge de glace, Scrat, Nintendo, Porsche) ;
  * a quoi il sert, ou il va : bureau, cuisine, salle de bain, chambre d'enfant, jardin, voiture... ;
  * pour qui ou pour quelle occasion : enfants, cadeau, Noel, Paques, anniversaire, fete des meres... ;
  * son style ou son allure : realiste, kawaii, low poly, steampunk, minimaliste, geometrique... ;
  * son mecanisme : articule, imprime en place, a monter, a remonter, ressort, engrenage...
  Reutilise les etiquettes deja existantes quand elles disent la meme chose.

Regles :
- Regarde d'abord l'image de chaque objet (quand elle est fournie, juste apres le texte, annoncee par sa reference) : c'est elle qui dit ce qu'est vraiment l'objet. Le titre et la description precisent (nom du personnage, usage, mecanisme).
- Une categorie dit ce qu'est l'objet ou a quoi il sert. Un univers, une franchise ou un style (fan art, Disney, Halloween, Minecraft...) n'est jamais une categorie : c'est une etiquette.
- Pas d'etiquette sur la facon de l'imprimer : ni matiere (PLA, PETG...), ni imprimante (H2D, P2S, AMS...), ni « sans AMS », « multicolore », « multi-pieces », « impression rapide », « supports requis », « sans colle ». Seule exception : une propriete qui fait la nature de l'objet (articule, imprime en place, flexible).
- Pas d'etiquette qui repete la categorie de l'objet, ni de mot fourre-tout (« decoration », « objet », « collection », « piece de collection », « mignon », « fonctionnel », « utilitaire »).
- Pas de couleur en etiquette (rouge, noir, bleu, colore...) : la couleur depend du filament choisi, elle se cherche deja par les filaments. Sauf quand la couleur fait l'objet (arc-en-ciel, drapeau).
- Pas le nom du createur du modele (il se cherche deja par sa fiche MakerWorld).
- Une seule forme par nom : le titre francais d'une oeuvre quand il existe (« L'Âge de glace », pas aussi « Ice Age »).
- Tout en francais, sauf les noms propres, qui gardent leur forme.
- Une etiquette en minuscules (sauf noms propres), au singulier, sans doublon ni variante (pas « porte clé » et « porte-clés »).
- Les categories et etiquettes MakerWorld fournies sont souvent fausses ou floues : sers-t'en comme d'indices, pas comme d'une verite.
- Un objet sans modele MakerWorld n'a que son nom de fichier et l'image de son plateau : devine au mieux, sans inventer de details.
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


async def _ask(client, batch: list, fams: list, cats: dict, tags: list, acc: dict | None = None) -> list:
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
    content = [{"type": "text", "text": json.dumps(ctx, ensure_ascii=False)}]
    for m in batch:
        if m.get("img"):
            content += [{"type": "text", "text": f"Image de {m['key']} :"},
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": m["img"]}}]
    r = await client.messages.create(
        model=MODEL, max_tokens=8000, system=_SYSTEM,
        messages=[{"role": "user", "content": content}],
        output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
    )
    await _count(r.usage)
    if acc is not None:
        acc["in"] += int(getattr(r.usage, "input_tokens", 0) or 0)
        acc["out"] += int(getattr(r.usage, "output_tokens", 0) or 0)
    text = next((b.text for b in r.content if b.type == "text"), "")
    return (json.loads(text) if text else {}).get("items") or []


_TASKS: set = set()


# ── Toute la collection (07/11/2026) ───────────────────────────────────────────
# Les modeles pas encore classes, du plus recent au plus ancien, par lots de 10 : chaque lot est ecrit des sa
# reponse (un arret, une coupure, un credit epuise : on reprend la ou on en etait). Un classement fait a la main
# (source « manual ») n'est jamais ecrase.
_RUN = {"running": False, "done": 0, "total": 0, "error": None, "stop": False, "in": 0, "out": 0, "at": None}
_RUN_KEYS = ("running", "done", "total", "error", "in", "out", "at")


def _jl(s, default):
    try:
        v = json.loads(s) if s else default
    except ValueError:
        v = default
    return v if isinstance(v, type(default)) else default


def _uniq(xs) -> list:
    out, low = [], set()
    for x in xs or []:
        x = re.sub(r"\s+", " ", str(x or "")).strip()
        if x and x.lower() not in low:
            low.add(x.lower())
            out.append(x)
    return out


async def _known() -> tuple:
    """Ce qui est deja classe : les cles (et celles faites a la main), et le vocabulaire (familles, categories avec
    leur famille, etiquettes comptees)."""
    from collections import Counter
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import ModelLabel
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(ModelLabel.key, ModelLabel.source, ModelLabel.families, ModelLabel.catmap,
                                        ModelLabel.tags))).all()
    fams, cats, tc = list(FAMILIES), {}, Counter()
    for _, _, f, cm, t in rows:
        for x in _jl(f, []):
            if x and x not in fams:
                fams.append(x)
        for k, v in _jl(cm, {}).items():
            cats.setdefault(k, v)
        tc.update(x for x in _jl(t, []) if x)
    return {r[0] for r in rows}, {r[0] for r in rows if r[1] == "manual"}, fams, cats, tc


async def _save(batch: list, res: dict) -> int:
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import ModelLabel
    n = 0
    async with AsyncSessionLocal() as db:
        for m in batch:
            it = res.get(m["key"])
            if not it:
                continue
            row = await db.get(ModelLabel, m["key"])
            if row is not None and row.source == "manual":
                continue
            if row is None:
                row = ModelLabel(key=m["key"])
                db.add(row)
            kind = m["key"].split(":", 1)[0]
            cats = [c for c in it.get("categories") or [] if (c.get("name") or "").strip()]
            row.design_id = m["did"] if kind == "mw" else None
            row.group_id = m["gid"] if kind == "g" else None
            row.print_id = m["print_id"] if kind == "p" else None
            row.title = m.get("title")
            row.families = json.dumps(_uniq(it.get("families")), ensure_ascii=False)
            row.categories = json.dumps(_uniq(c["name"] for c in cats), ensure_ascii=False)
            row.catmap = json.dumps({c["name"].strip(): (c.get("family") or "").strip() for c in cats}, ensure_ascii=False)
            row.tags = json.dumps(_uniq(it.get("tags")), ensure_ascii=False)
            row.source, row.model, row.seen, row.updated_at = "ai", MODEL, 1 if m.get("img") else 0, datetime.utcnow()
            n += 1
        await db.commit()
    return n


async def _run(redo: bool, tok: float = 0) -> None:
    from anthropic import AsyncAnthropic
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    try:
        async with AsyncSessionLocal() as db:
            key = await get_setting(db, K_KEY, "")
        if not key:
            raise RuntimeError("Aucune clé : colle-la d'abord dans Paramètres › Connexions › Claude.")
        if not redo:
            await inherit()                      # groupe, relie ou degroupe depuis : repris sans Claude
        known, manual, fams, cats, tc = await _known()
        skip = manual if redo else known
        todo = [m for m in await _select() if m["key"] not in skip]
        _RUN.update(total=len(todo), done=0)
        client = AsyncAnthropic(api_key=key, timeout=180.0, max_retries=2)
        for i in range(0, len(todo), BATCH):
            if _RUN["stop"]:
                break
            # (08/11/2026) chaque etape a sa limite : un passage reste bloque 10 min sans rien envoyer (« en cours » pour
            # toujours, plus rien ne se classait ni en fin d'impression ni la nuit)
            batch = await asyncio.wait_for(_prepare(todo[i:i + BATCH]), PREP_S)
            logger.info(f"[IA-TAGS] lot {i // BATCH + 1} : {len(batch)} modèle(s) prêts, demande à Claude")
            items = await asyncio.wait_for(_ask(client, batch, fams, cats, [t for t, _ in tc.most_common(400)], _RUN), ASK_S)
            await _save(batch, {it.get("ref"): it for it in items})
            for it in items:
                for f in it.get("families") or []:
                    if f and f not in fams:
                        fams.append(f)
                for c in it.get("categories") or []:
                    if c.get("name") and c["name"] not in cats:
                        cats[c["name"]] = c.get("family") or ""
                tc.update(_uniq(it.get("tags")))
            for m in batch:
                m.pop("img", None)
            _RUN["done"] = min(len(todo), i + BATCH)
        _RUN["error"] = None
        logger.info(f"[IA-TAGS] collection : {_RUN['done']}/{_RUN['total']} modèles, {_RUN['in']} jetons envoyés, {_RUN['out']} reçus")
    except Exception as e:
        try:
            msg = "Claude n'a pas répondu à temps (on réessaiera au prochain passage)" if isinstance(e, asyncio.TimeoutError) else _err(e)
        except Exception:
            msg = f"{type(e).__name__} : {e}"
        if _RUN.get("t0") == tok:
            _RUN["error"] = msg
        logger.warning(f"[IA-TAGS] collection : {msg}")
    finally:
        if _RUN.get("t0") == tok:              # un passage arrete parce que bloque ne touche pas a celui qui l'a remplace
            _RUN.update(running=False, stop=False, at=datetime.now().isoformat(timespec="seconds"))


PREP_S, ASK_S = 120, 420               # la preparation d'un lot (fiches, images), la reponse de Claude (avec ses reprises)
STALE_S = 20 * 60                      # « en cours » depuis plus longtemps : bloque, le suivant le remplace


def start_run(redo: bool = False) -> dict:
    import time as _t
    if _RUN["running"] and _t.time() - (_RUN.get("t0") or 0) > STALE_S:
        logger.warning("[IA-TAGS] le passage précédent est bloqué depuis plus de 20 min : arrêté, un nouveau part")
        for old in list(_TASKS):
            old.cancel()
        _RUN["running"] = False
    if not _RUN["running"]:
        _RUN.update({"running": True, "done": 0, "total": 0, "error": None, "stop": False, "in": 0, "out": 0, "t0": _t.time()})
        t = asyncio.get_running_loop().create_task(_run(bool(redo), _RUN["t0"]))
        _TASKS.add(t)
        t.add_done_callback(_TASKS.discard)
    return {k: _RUN[k] for k in _RUN_KEYS}


def stop_run() -> dict:
    if _RUN["running"]:
        _RUN["stop"] = True
    return {k: _RUN[k] for k in _RUN_KEYS}


async def overview() -> dict:
    """Ou en est la collection : modeles classes sur le total, et ce qui en sort (familles, categories, etiquettes
    les plus courantes), avec le classement en cours."""
    from collections import Counter
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import ModelLabel
    keys = {m["key"] for m in await _select()}
    try:
        (_data() / "ai_tags_sim.json").unlink(missing_ok=True)   # l'ancienne simulation, retiree le 07/11/2026
    except OSError:
        pass
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(ModelLabel.key, ModelLabel.families, ModelLabel.categories, ModelLabel.catmap,
                                        ModelLabel.tags))).all()
    fc, cc, tc, cmap, done = Counter(), Counter(), Counter(), {}, 0
    for k, f, c, cm, t in rows:
        if k not in keys:
            continue
        done += 1
        fc.update(_jl(f, []))
        cc.update(_jl(c, []))
        tc.update(_jl(t, []))
        for a, b in _jl(cm, {}).items():
            cmap.setdefault(a, b)
    return {"models": len(keys), "classified": done, "missing": len(keys) - done,
            "families": [{"name": k, "n": v} for k, v in fc.most_common()],
            "categories": [{"name": k, "family": cmap.get(k) or "", "n": v} for k, v in cc.most_common()],
            "tags": [{"name": k, "n": v} for k, v in tc.most_common(60)], "tag_count": len(tc),
            "run": {k: _RUN[k] for k in _RUN_KEYS}}


async def labels_for_print(print_id: int) -> dict:
    """Le classement du modele d'une impression (vide s'il n'est pas classe)."""
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import ModelLabel, Print
    async with AsyncSessionLocal() as db:
        p = await db.get(Print, print_id)
        if p is None:
            return {}
        row = None
        for k in _cands(p.design_id, p.group_id, p.id):
            row = await db.get(ModelLabel, k)
            if row is not None:
                break
    if row is None:
        return {}
    cm = _jl(row.catmap, {})
    return {"families": _jl(row.families, []),
            "categories": [{"name": c, "family": cm.get(c) or ""} for c in _jl(row.categories, [])],
            "tags": _jl(row.tags, []), "source": row.source, "seen": bool(row.seen)}


# ── Ce qui sert ailleurs : filtres, statistiques, classement automatique (07/11/2026) ──
async def label_map() -> dict:
    """Toutes les lignes : cle -> (familles, categories, etiquettes, famille de chaque categorie)."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import ModelLabel
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(ModelLabel.key, ModelLabel.families, ModelLabel.categories, ModelLabel.tags,
                                        ModelLabel.catmap))).all()
    return {k: (_jl(f, []), _jl(c, []), _jl(t, []), _jl(cm, {})) for k, f, c, t, cm in rows}


async def facets() -> dict:
    """Les choix des filtres : familles, categories (avec leur famille) et etiquettes, comptees en modeles imprimes."""
    from collections import Counter
    keys = {m["key"] for m in await _select()}
    fc, cc, tc, cmap = Counter(), Counter(), Counter(), {}
    for k, (f, c, t, cm) in (await label_map()).items():
        if k not in keys:
            continue
        fc.update(f)
        cc.update(c)
        tc.update(t)
        for a, b in cm.items():
            cmap.setdefault(a, b)
    return {"families": [{"name": k, "n": v} for k, v in fc.most_common()],
            "categories": [{"name": k, "family": cmap.get(k) or "", "n": v} for k, v in cc.most_common()],
            "tags": [{"name": k, "n": v} for k, v in tc.most_common()]}


K_AUTO = "CLAUDE_AUTO"


async def auto_on() -> bool:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        return (await get_setting(db, K_AUTO, "1")) != "0" and bool(await get_setting(db, K_KEY, ""))


async def after_print(pid: int, status: str = "SUCCESS") -> None:
    """A la fin d'une impression reussie (ou en partie) : son modele, s'il n'est pas encore classe, part chez Claude
    (avec ceux qui manquent encore). Rien pour une impression annulee ou ratee, sans cle, ni quand le classement
    automatique est coupe."""
    try:
        if status not in ("SUCCESS", "PARTIAL") or not await auto_on():
            return
        from ..db.session import AsyncSessionLocal
        from ..models.print_history import ModelLabel, Print
        async with AsyncSessionLocal() as db:
            p = await db.get(Print, pid)
            if p is None or await db.get(ModelLabel, model_key(p.design_id, p.group_id, p.id)) is not None:
                return
        if await inherit():
            async with AsyncSessionLocal() as db:
                if await db.get(ModelLabel, model_key(p.design_id, p.group_id, p.id)) is not None:
                    return
        logger.info(f"[IA-TAGS] impression #{pid} : son modèle n'est pas classé, Claude s'en charge")
        start_run()
    except Exception:
        logger.debug(f"[IA-TAGS] classement après l'impression #{pid}", exc_info=True)


# ── Un modele qui change de cle, et le rattrapage de nuit (07/11/2026) ──
# Une impression groupee apres coup passe de « p:{id} » a « g:{groupe} » ; reliee a MakerWorld, a « mw:{design} » ;
# degroupee, revient a « p:{id} ». Le classement deja fait sous une autre de ses cles est repris tel quel (rien chez
# Claude). La nuit, le reste : ce qui n'a pas ete classe en fin d'impression (une impression ratee mais gardee, une
# importee, un modele relie plus tard).
def _cands(did, gid, pid) -> list:
    """Toutes les cles qu'une impression a pu avoir, la sienne d'abord."""
    did = str(did or "").strip()
    out = [model_key(did, gid, pid)]
    for k in ([f"mw:{did}"] if did.isdigit() else []) + ([f"g:{gid}"] if gid else []) + [f"p:{pid}"]:
        if k not in out:
            out.append(k)
    return out


async def inherit() -> int:
    """Les modeles sans classement qui en ont un sous une autre cle d'une de leurs impressions : repris. Rend le nombre."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import ModelLabel, Print
    n = 0
    async with AsyncSessionLocal() as db:
        have = {r[0]: r for r in (await db.execute(select(ModelLabel.key, ModelLabel.title, ModelLabel.families, ModelLabel.categories,
                                                                ModelLabel.catmap, ModelLabel.tags, ModelLabel.source,
                                                                ModelLabel.model, ModelLabel.seen))).all()}
        prints = (await db.execute(select(Print.id, Print.design_id, Print.group_id))).all()
        done = set()
        for pid, did, gid in prints:
            cs = _cands(did, gid, pid)
            key = cs[0]
            if key in have or key in done:
                continue
            src = next((have[k] for k in cs[1:] if k in have), None)
            if src is None:
                continue
            kind = key.split(":", 1)[0]
            d = str(did or "").strip()
            db.add(ModelLabel(key=key, design_id=d if kind == "mw" else None, group_id=gid if kind == "g" else None,
                              print_id=pid if kind == "p" else None, title=src.title, families=src.families,
                              categories=src.categories, catmap=src.catmap, tags=src.tags, source=src.source,
                              model=src.model, seen=src.seen or 0, updated_at=datetime.utcnow()))
            done.add(key)
            n += 1
        if n:
            await db.commit()
    if n:
        logger.info(f"[IA-TAGS] {n} modèle(s) repris d'un classement fait sous une autre clé (groupé, relié, dégroupé)")
    return n


NIGHT_HOUR = 4


async def nightly_loop() -> None:
    """Chaque nuit a 4 h : les classements repris, puis ce qui manque encore part chez Claude (si le classement
    automatique est coche et qu'une cle est la)."""
    from ..core import tasks as _tasks
    from .archive import _local
    await _tasks.sleep("ai_tags", 180)
    done_day = None
    while True:
        try:
            now = _local(datetime.utcnow())
            if now.hour == NIGHT_HOUR and done_day != now.date():
                done_day = now.date()
                await inherit()
                if await auto_on():
                    start_run()                  # un passage bloque depuis trop longtemps est remplace
        except Exception:
            _tasks.error("ai_tags")
            logger.exception("[IA-TAGS] passage de nuit")
        await _tasks.sleep("ai_tags", 300)
