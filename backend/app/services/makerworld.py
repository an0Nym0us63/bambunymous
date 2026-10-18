"""
Fiches publiques des modeles MakerWorld (titre, couverture, createur,
categories, tags, compteurs), en cache dans la table makerworld_designs.

Lues sans compte sur l'API interne du site (design-service/design/{id}) : il
n'existe pas d'API publique officielle, celle-ci peut changer ou se fermer.
Tout est donc facultatif -- un echec laisse le print tel quel, et le passage
suivant (toutes les 6 h) reessaie. Lecture seule : rien n'est jamais ecrit chez
MakerWorld.

Un modele est partage par tous ses prints : une requete par design_id, jamais
par print, espacees de 1,5 s pour ne pas marteler le site.
"""
import asyncio
import logging
import threading
import time
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Deux portes vers la meme API : le site (derriere Cloudflare, qui peut
# filtrer) puis l'hote de l'API Bambu (sans Cloudflare). La seconde ne sert
# que si la premiere refuse.
HOSTS = ("https://makerworld.com/api/v1", "https://api.bambulab.com/v1")
REFRESH_DAYS = 30
_RUNNING = {"on": False}
_LAST = {"run": None}          # bilan du dernier passage, pour les Parametres


def model_url(design_id) -> str:
    return f"https://makerworld.com/fr/models/{design_id}"


def _get_json(path: str, token: str = None):
    """GET sur l'API, en essayant les deux portes. Rend (code, json|None)."""
    import requests
    headers = {"User-Agent": "Mozilla/5.0 (BambuNymous)", "Accept": "application/json",
               # Categories rendues en francais ; le titre et les tags restent
               # dans la langue du createur.
               "Accept-Language": "fr-FR,fr;q=0.9"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    code = 0
    for host in HOSTS:
        try:
            r = requests.get(host + path, timeout=20, headers=headers)
        except Exception as e:
            logger.info(f"[MW] {host}{path} : injoignable ({type(e).__name__})")
            continue
        code = r.status_code
        if code in (401, 404):
            return code, None
        if code == 200 and "json" in r.headers.get("content-type", ""):
            try:
                return code, r.json()
            except ValueError:
                pass
        # 403 + page Cloudflare, 5xx... : porte suivante
    return code, None


def fetch_design(design_id: str) -> dict:
    """Lit la fiche d'un modele. Rend {"status": "ok", ...champs},
    {"status": "notfound"} ou {"status": "error"} (a reessayer). Ne leve
    jamais : un changement de l'API ne doit rien casser d'autre."""
    try:
        return _parse_design(*_get_json(f"/design-service/design/{design_id}"))
    except Exception as e:
        logger.info(f"[MW] {design_id} : reponse inattendue ({type(e).__name__})")
        return {"status": "error"}


def _parse_design(code, d) -> dict:
    if code == 404:
        return {"status": "notfound"}
    if not isinstance(d, dict):
        return {"status": "error"}
    if not d.get("id"):
        return {"status": "notfound"}
    cr = d.get("designCreator") if isinstance(d.get("designCreator"), dict) else {}
    lst = lambda v: v if isinstance(v, list) else []
    cats = [c.get("name") for c in lst(d.get("categories"))
            if isinstance(c, dict) and isinstance(c.get("name"), str) and c.get("name")]
    tags = [t for t in lst(d.get("tags")) if isinstance(t, str) and t.strip()]
    num = lambda v: v if isinstance(v, int) and not isinstance(v, bool) else None
    # Texte seulement : une API qui change de forme ne doit rien faire lever.
    txt = lambda v, n: (v.strip()[:n] or None) if isinstance(v, str) else None
    return {
        "status": "ok",
        "title": txt(d.get("titleTranslated"), 512) or txt(d.get("title"), 512),
        "cover_url": txt(d.get("coverUrl"), 1024),
        "creator_name": txt(cr.get("name"), 256),
        "creator_handle": txt(cr.get("handle"), 256),
        "creator_avatar": txt(cr.get("avatar"), 1024),
        "categories": ",".join(c.replace(",", " ") for c in cats)[:512] or None,
        "tags": ",".join(t.replace(",", " ").strip() for t in tags) or None,
        "profiles": _profiles(d) or "[]",
        "like_count": num(d.get("likeCount")),
        "download_count": num(d.get("downloadCount")),
        "print_count": num(d.get("printCount")),
        "collection_count": num(d.get("collectionCount")),
    }


def _profiles(d) -> str:
    """Profils (instances) et leurs plateaux, en JSON compact. Rien d'exige :
    une forme inattendue donne simplement une liste plus courte."""
    import json
    out = []
    for i in (d.get("instances") if isinstance(d.get("instances"), list) else []):
        if not isinstance(i, dict):
            continue
        ext = i.get("extention") if isinstance(i.get("extention"), dict) else {}
        mi = ext.get("modelInfo") if isinstance(ext.get("modelInfo"), dict) else {}
        plates = []
        for p in (mi.get("plates") if isinstance(mi.get("plates"), list) else []):
            if not isinstance(p, dict) or not isinstance(p.get("index"), int):
                continue
            th = p.get("thumbnail") if isinstance(p.get("thumbnail"), dict) else {}
            plates.append({"index": p["index"], "name": p.get("name") if isinstance(p.get("name"), str) else "",
                           "thumb": th.get("url") if isinstance(th.get("url"), str) else None,
                           "weight_g": p.get("weight") if isinstance(p.get("weight"), (int, float)) else None,
                           "seconds": p.get("prediction") if isinstance(p.get("prediction"), (int, float)) else None})
        out.append({"profile_id": str(i.get("profileId") or ""), "title": i.get("title") if isinstance(i.get("title"), str) else "",
                    "default": i.get("id") == d.get("defaultInstanceId"), "plates": plates})
    return json.dumps(out, ensure_ascii=False) if out else None


def to_dict(m) -> dict:
    """Ce que la fiche d'un print affiche."""
    if m is None or m.status != "ok":
        return None
    split = lambda s: [x for x in (s or "").split(",") if x]
    return {
        "design_id": m.design_id, "url": model_url(m.design_id),
        "title": m.title, "title_fr": m.title_fr, "cover_url": m.cover_url,
        "creator_name": m.creator_name, "creator_handle": m.creator_handle,
        "creator_avatar": m.creator_avatar,
        "creator_url": f"https://makerworld.com/fr/@{m.creator_handle}" if m.creator_handle else None,
        "categories": split(m.categories), "tags": split(m.tags),
        "like_count": m.like_count, "download_count": m.download_count,
        "print_count": m.print_count, "collection_count": m.collection_count,
        "fetched_at": m.fetched_at.isoformat() if m.fetched_at else None,
        "profiles": _load(m.profiles),
    }


def _load(s):
    import json
    try:
        v = json.loads(s) if s else []
        return v if isinstance(v, list) else []
    except ValueError:
        return []


def _hit(h) -> dict:
    """Un modele d'une liste de recherche / de similaires."""
    if not isinstance(h, dict) or not str(h.get("id") or "").isdigit():
        return None
    cr = h.get("designCreator") if isinstance(h.get("designCreator"), dict) else {}
    s = lambda v: v if isinstance(v, str) else None
    return {"design_id": str(h["id"]), "title": s(h.get("title")), "cover_url": s(h.get("cover")),
            "creator_name": s(cr.get("name")),
            "like_count": h.get("likeCount") if isinstance(h.get("likeCount"), int) else None,
            "print_count": h.get("printCount") if isinstance(h.get("printCount"), int) else None}


async def _public_list(path: str) -> dict:
    """Liste publique (recherche, similaires), enrichie de « deja imprime »."""
    import asyncio
    from .makerworld_account import _enrich
    code, d = await asyncio.to_thread(_get_json, path)
    if not isinstance(d, dict):
        return {"items": [], "total": 0, "error": f"MakerWorld ne répond pas (HTTP {code})"}
    hits = [x for x in (_hit(h) for h in (d.get("hits") if isinstance(d.get("hits"), list) else [])) if x]
    res = await _enrich(hits)
    total = d.get("total") if isinstance(d.get("total"), int) else len(hits)
    return {"items": res["items"], "total": total}


async def search(q: str, offset: int = 0) -> dict:
    from urllib.parse import quote
    q = (q or "").strip()[:100]
    if not q:
        return {"items": [], "total": 0}
    return await _public_list(f"/search-service/select/design2?keyword={quote(q)}&offset={max(0, int(offset))}&limit=24")


async def similar(design_id: str) -> dict:
    did = str(design_id or "").strip()
    if not did.isdigit():
        return {"items": [], "total": 0}
    return await _public_list(f"/search-service/design/{did}/relate?offset=0&limit=12&scene=1")


async def _todo(limit: int, only: str = None) -> list:
    """design_id a lire : jamais lus, en erreur, ou vieux de plus de 30 jours."""
    from sqlalchemy import select, distinct
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, MakerWorldDesign as MW
    async with AsyncSessionLocal() as db:
        ids = ([str(x) for x in only] if isinstance(only, (list, tuple, set)) else [only]) if only else [
            x for x in (await db.execute(
                select(distinct(Print.design_id)).where(Print.design_id.isnot(None))
            )).scalars().all() if x and str(x).strip() not in ("", "0")]
        known = {m.design_id: m for m in (await db.execute(
            select(MW).where(MW.design_id.in_(ids)))).scalars().all()} if ids else {}
    old = datetime.utcnow() - timedelta(days=REFRESH_DAYS)
    out = []
    for i in ids:
        m = known.get(str(i))
        if m is None or m.status == "error" or not m.fetched_at or m.fetched_at < old \
                or (m.status == "ok" and m.title and not m.title_fr) \
                or (m.status == "ok" and m.profiles is None):
            out.append(str(i))
    return out[:limit]


async def refresh(limit: int = 200, only: str = None) -> dict:
    """Lit (ou relit) jusqu'a `limit` modeles, puis traduit leurs titres pour la
    recherche. Rend un bilan."""
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import MakerWorldDesign as MW
    from . import translate as T

    todo = await _todo(limit, only)
    if not todo:
        return {"read": 0, "ok": 0}
    res = {}
    for k, did in enumerate(todo):
        res[did] = await asyncio.to_thread(fetch_design, did)
        if k + 1 < len(todo):
            await asyncio.sleep(1.5)

    # Titres traduits pour la recherche (« cochon » trouve « pig »), avec la
    # meme chaine de services que les noms de prints ; un echec laisse
    # title_fr vide, repris au passage suivant.
    titles = [r["title"] for r in res.values() if r.get("status") == "ok" and r.get("title")]
    table = {}
    if titles:
        try:
            table = await asyncio.to_thread(T.translate_names, titles, await T._keys())
        except Exception as e:
            logger.info(f"[MW] traduction des titres : {e}")

    ok = 0
    async with AsyncSessionLocal() as db:
        for did, r in res.items():
            m = await db.get(MW, did)
            if m is None:
                m = MW(design_id=did)
                db.add(m)
            if r["status"] == "error" and m.status == "ok":
                continue                    # garder l'ancienne fiche, reessayer plus tard
            m.status = r["status"]
            m.fetched_at = datetime.utcnow()
            if r["status"] != "ok":
                continue
            ok += 1
            for f in ("title", "cover_url", "creator_name", "creator_handle", "creator_avatar",
                      "categories", "tags", "like_count", "download_count", "print_count",
                      "collection_count", "profiles"):
                setattr(m, f, r.get(f))
            if r.get("title") in table:
                tr, _ = table[r["title"]]
                m.title_fr = (tr or r["title"])[:512]
        await db.commit()
    logger.info(f"[MW] {len(todo)} modele(s) lu(s), {ok} fiche(s) a jour")
    _LAST["run"] = {"read": len(todo), "ok": ok, "at": datetime.utcnow().isoformat()}
    return {"read": len(todo), "ok": ok}


async def stats() -> dict:
    """Etat du cache, pour les Parametres."""
    from sqlalchemy import select, func, distinct
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, MakerWorldDesign as MW
    async with AsyncSessionLocal() as db:
        by = dict((await db.execute(select(MW.status, func.count()).group_by(MW.status))).all())
        n = (await db.execute(select(func.count(distinct(Print.design_id)))
                              .where(Print.design_id.isnot(None), Print.design_id != "0"))).scalar_one()
    return {"models": n, "ok": by.get("ok", 0), "notfound": by.get("notfound", 0),
            "error": by.get("error", 0), "last": _LAST["run"], "running": _RUNNING["on"]}


def launch_refresh() -> bool:
    """Passage complet a la demande (Parametres). False s'il tourne deja."""
    if _RUNNING["on"]:
        return False
    _RUNNING["on"] = True

    def _run():
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(refresh(1000))
        except Exception:
            logger.exception("[MW] passage a la demande")
        finally:
            _RUNNING["on"] = False
            loop.close()
    threading.Thread(target=_run, daemon=True).start()
    return True


_MANY = {"on": False}


def launch_many(ids) -> None:
    """Lit une liste de modeles en arriere-plan (favoris, j'aime), un seul
    passage a la fois ; les suivants sont repris au passage automatique."""
    ids = [str(i) for i in ids if str(i).isdigit()][:300]
    if not ids or _MANY["on"]:
        return
    _MANY["on"] = True

    def _run():
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(refresh(len(ids), only=ids))
        except Exception:
            logger.exception("[MW] lecture des modeles du compte")
        finally:
            _MANY["on"] = False
            loop.close()
    threading.Thread(target=_run, daemon=True).start()


def launch(design_id) -> None:
    """Lit un modele en arriere-plan (nouveau print)."""
    did = str(design_id or "").strip()
    if not did or did == "0":
        return

    def _run():
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(refresh(1, only=did))
        except Exception:
            logger.exception(f"[MW] lecture du modele {did}")
        finally:
            loop.close()
    threading.Thread(target=_run, daemon=True).start()


async def auto_loop(period_s: int = 6 * 3600, first_delay_s: int = 120):
    """Toutes les 6 h : modeles jamais lus, en erreur ou vieux de 30 jours."""
    await asyncio.sleep(first_delay_s)
    while True:
        if not _RUNNING["on"]:
            _RUNNING["on"] = True
            try:
                await refresh(200)
            except Exception:
                logger.exception("[MW] passage automatique")
            finally:
                _RUNNING["on"] = False
        await asyncio.sleep(period_s)
