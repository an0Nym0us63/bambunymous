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

API = "https://makerworld.com/api/v1/design-service/design/{}"
REFRESH_DAYS = 30
_RUNNING = {"on": False}


def model_url(design_id) -> str:
    return f"https://makerworld.com/fr/models/{design_id}"


def fetch_design(design_id: str) -> dict:
    """Lit la fiche d'un modele. Rend {"status": "ok", ...champs},
    {"status": "notfound"} ou {"status": "error"} (a reessayer)."""
    import requests
    try:
        r = requests.get(API.format(design_id), timeout=20, headers={
            "User-Agent": "Mozilla/5.0 (BambuNymous)",
            "Accept": "application/json",
            # Categories rendues en francais ; le titre et les tags restent
            # dans la langue du createur.
            "Accept-Language": "fr-FR,fr;q=0.9",
        })
    except Exception as e:
        logger.info(f"[MW] {design_id} : injoignable ({type(e).__name__})")
        return {"status": "error"}
    if r.status_code == 404:
        return {"status": "notfound"}
    if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
        # 403 + page Cloudflare : le site filtre, on reessaiera plus tard.
        logger.info(f"[MW] {design_id} : HTTP {r.status_code}")
        return {"status": "error"}
    try:
        d = r.json()
    except ValueError:
        return {"status": "error"}
    if not d.get("id"):
        return {"status": "notfound"}
    cr = d.get("designCreator") or {}
    cats = [c.get("name") for c in (d.get("categories") or []) if isinstance(c, dict) and c.get("name")]
    tags = [t for t in (d.get("tags") or []) if isinstance(t, str) and t.strip()]
    return {
        "status": "ok",
        "title": (d.get("titleTranslated") or d.get("title") or "").strip()[:512] or None,
        "cover_url": (d.get("coverUrl") or "")[:1024] or None,
        "creator_name": (cr.get("name") or "")[:256] or None,
        "creator_handle": (cr.get("handle") or "")[:256] or None,
        "creator_avatar": (cr.get("avatar") or "")[:1024] or None,
        "categories": ",".join(c.replace(",", " ") for c in cats)[:512] or None,
        "tags": ",".join(t.replace(",", " ").strip() for t in tags) or None,
        "like_count": d.get("likeCount"),
        "download_count": d.get("downloadCount"),
        "print_count": d.get("printCount"),
        "collection_count": d.get("collectionCount"),
    }


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
    }


async def _todo(limit: int, only: str = None) -> list:
    """design_id a lire : jamais lus, en erreur, ou vieux de plus de 30 jours."""
    from sqlalchemy import select, distinct
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, MakerWorldDesign as MW
    async with AsyncSessionLocal() as db:
        ids = [only] if only else [
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
                or (m.status == "ok" and m.title and not m.title_fr):
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
                      "collection_count"):
                setattr(m, f, r.get(f))
            if r.get("title") in table:
                tr, _ = table[r["title"]]
                m.title_fr = (tr or r["title"])[:512]
        await db.commit()
    logger.info(f"[MW] {len(todo)} modele(s) lu(s), {ok} fiche(s) a jour")
    return {"read": len(todo), "ok": ok}


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
