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

# Deux portes vers la meme API : l'hote de l'API Bambu (sans Cloudflare, deux
# fois plus rapide a l'essai : 0,34 s contre 0,65 s) puis le site, qui ne sert
# que si le premier refuse.
HOSTS = ("https://api.bambulab.com/v1", "https://makerworld.com/api/v1")


def session():
    """Une session HTTP par fil, gardee ouverte : la connexion TLS n'est pas
    renegociee a chaque appel (c'etait l'essentiel du temps d'une requete)."""
    import threading
    import requests
    loc = session.__dict__.setdefault("_loc", threading.local())
    if not hasattr(loc, "s"):
        loc.s = requests.Session()
    return loc.s
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
               "Accept-Language": "fr-FR,fr;q=0.9",
               # ... et avec celui-ci, MakerWorld remplit lui-meme les champs
               # *Translated (titre, descriptif, tags, profils, commentaires)
               # en francais : rien a traduire de notre cote.
               "x-bbl-language": "fr"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    code = 0
    for host in HOSTS:
        try:
            r = session().get(host + path, timeout=20, headers=headers)
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
    # tags francais de MakerWorld en plus (la recherche les trouve aussi)
    tags += [t for t in lst(d.get("tagsTranslated")) if isinstance(t, str) and t.strip() and t not in tags]
    num = lambda v: v if isinstance(v, int) and not isinstance(v, bool) else None
    # Texte seulement : une API qui change de forme ne doit rien faire lever.
    txt = lambda v, n: (v.strip()[:n] or None) if isinstance(v, str) else None
    return {
        "status": "ok",
        "title": txt(d.get("title"), 512) or txt(d.get("titleTranslated"), 512),
        "title_fr": txt(d.get("titleTranslated"), 512),
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
        out.append({"profile_id": str(i.get("profileId") or ""), "instance_id": str(i.get("id") or ""), "title": i.get("title") if isinstance(i.get("title"), str) else "",
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
    return {"design_id": str(h["id"]), "title": s(h.get("title")), "title_fr": s(h.get("titleTranslated")),
            "cover_url": s(h.get("cover")),
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


# ── Fiche complete d'un modele (lue a l'ouverture, 30 min en memoire) ───────
_MODEL_CACHE = {}


def _text(html: str) -> str:
    """Descriptif HTML -> texte lisible (paragraphes, listes a puces). Rien
    du HTML d'origine n'est rendu tel quel dans l'appli."""
    import re, html as _h
    if not isinstance(html, str):
        return ""
    t = re.sub(r"(?is)<(script|style).*?</\1>", "", html)
    t = re.sub(r"(?i)<li[^>]*>", "\n• ", t)
    t = re.sub(r"(?i)<br\s*/?>|</(p|div|h[1-6]|li|ul|ol|tr)>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = _h.unescape(t).replace("\xa0", " ")
    # La traduction de MakerWorld rend le gras en Markdown (**mot**) : retire.
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", t, flags=re.S).replace("**", "")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    return t.strip()[:20000]


def _plate_detail(d) -> list:
    """Profils et plateaux, avec filaments, poids, duree, compatibilite."""
    out = []
    for i in (d.get("instances") if isinstance(d.get("instances"), list) else []):
        if not isinstance(i, dict):
            continue
        ext = i.get("extention") if isinstance(i.get("extention"), dict) else {}
        mi = ext.get("modelInfo") if isinstance(ext.get("modelInfo"), dict) else {}
        comp = mi.get("compatibility") if isinstance(mi.get("compatibility"), dict) else {}
        plates = []
        for pl in (mi.get("plates") if isinstance(mi.get("plates"), list) else []):
            if not isinstance(pl, dict) or not isinstance(pl.get("index"), int):
                continue
            th = pl.get("thumbnail") if isinstance(pl.get("thumbnail"), dict) else {}
            fils = [{"type": f.get("type"), "color": f.get("color"), "g": f.get("usedG")}
                    for f in (pl.get("filaments") or []) if isinstance(f, dict)]
            plates.append({"index": pl["index"], "name": pl.get("name") if isinstance(pl.get("name"), str) else "",
                           "thumb": th.get("url") if isinstance(th.get("url"), str) else None,
                           "weight_g": pl.get("weight") if isinstance(pl.get("weight"), (int, float)) else None,
                           "seconds": pl.get("prediction") if isinstance(pl.get("prediction"), (int, float)) else None,
                           "filaments": fils})
        # Filaments du profil (tous plateaux) : instanceFilaments, sinon la
        # somme des plateaux par matiere et couleur.
        inst = [f for f in (i.get("instanceFilaments") if isinstance(i.get("instanceFilaments"), list) else [])
                if isinstance(f, dict) and f.get("color")]
        if inst:
            pfils = [{"type": f.get("type"), "color": f.get("color"), "g": f.get("usedG")} for f in inst]
        else:
            agg = {}
            for pl in plates:
                for f in pl["filaments"]:
                    k = (f.get("type"), str(f.get("color") or "").upper())
                    try:
                        agg[k] = agg.get(k, 0) + float(f.get("g") or 0)
                    except (TypeError, ValueError):
                        agg.setdefault(k, 0)
            pfils = [{"type": t, "color": c, "g": round(g) or None} for (t, c), g in agg.items() if c]
        ps = mi.get("projectSettings") if isinstance(mi.get("projectSettings"), dict) else {}
        t_or = i.get("title") if isinstance(i.get("title"), str) else ""
        t_fr = i.get("titleTranslated") if isinstance(i.get("titleTranslated"), str) and i.get("titleTranslated") else ""
        out.append({"instance_id": str(i.get("id") or ""), "profile_id": str(i.get("profileId") or ""),
                    "title": t_fr or t_or, "title_original": t_or if t_fr and t_fr != t_or else None,
                    "summary": _text(i.get("summaryTranslated") or i.get("summary"))[:500],
                    "default": i.get("id") == d.get("defaultInstanceId"),
                    "printer": comp.get("devProductName") if isinstance(comp.get("devProductName"), str) else None,
                    "weight_g": i.get("weight") if isinstance(i.get("weight"), (int, float)) else None,
                    "seconds": i.get("prediction") if isinstance(i.get("prediction"), (int, float)) else None,
                    "settings": {k: ps.get(k) for k in ("layerHeight", "wallLoops", "sparseInfillDensity") if ps.get(k) is not None},
                    "print_count": i.get("printCount") if isinstance(i.get("printCount"), int) else None,
                    "filaments": pfils, "plates": plates})
    return out


async def model_detail(design_id: str) -> dict:
    """Fiche complete d'un modele pour l'appli : galerie, descriptif, profils
    et plateaux, compteurs, et ce que l'historique en dit."""
    import asyncio, time
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print, MakerWorldDesign as MW
    did = str(design_id or "").strip()
    if not did.isdigit():
        return {"error": "Modèle inconnu"}
    hit = _MODEL_CACHE.get(did)
    if hit and time.time() - hit[0] < 1800:
        base = hit[1]
    else:
        code, d = await asyncio.to_thread(_get_json, f"/design-service/design/{did}")
        if not isinstance(d, dict) or not d.get("id"):
            return {"error": "Modèle introuvable" if code == 404 else f"MakerWorld ne répond pas (HTTP {code})",
                    "url": model_url(did)}
        info = _parse_design(code, d)
        ext = d.get("designExtension") if isinstance(d.get("designExtension"), dict) else {}
        pics = []
        for key in ("design_pictures", "real_pictures"):
            for x in (ext.get(key) if isinstance(ext.get(key), list) else []):
                if isinstance(x, dict) and isinstance(x.get("url"), str) and x["url"] not in pics:
                    pics.append(x["url"])
        if info.get("cover_url") and info["cover_url"] not in pics:
            pics.insert(0, info["cover_url"])
        s = lambda v: v if isinstance(v, str) and v else None
        base = {**{k: v for k, v in info.items() if k not in ("status", "profiles")},
                "design_id": did, "url": model_url(did), "pictures": pics[:30],
                "description": _text(d.get("summaryTranslated") or d.get("summary")),
                "description_original": (_text(d.get("summary")) if d.get("summaryTranslated") else None),
                "title_mw_fr": s(d.get("titleTranslated")),
                "license": s(d.get("license")), "created": s(d.get("createTime")),
                "comment_count": d.get("commentCount") if isinstance(d.get("commentCount"), int) else None,
                "profiles": _plate_detail(d)}
        base["categories"] = [c for c in (base.get("categories") or "").split(",") if c]
        base["tags"] = [t for t in (base.get("tags") or "").split(",") if t]
        _MODEL_CACHE[did] = (time.time(), base)
    async with AsyncSessionLocal() as db:
        m = await db.get(MW, did)
        rows = (await db.execute(select(Print.id, Print.status, Print.plate_id, Print.mw_profile_id)
                                 .where(Print.design_id == did))).all()
    done = [r for r in rows if r[1] in ("SUCCESS", "PARTIAL")]
    # Filaments des profils face au stock (base locale seulement, a chaque appel).
    try:
        from .mw_stock import match_profiles
        stock = await match_profiles(base.get("profiles") or [])
    except Exception:
        logger.exception("[MW] filaments face au stock")
        stock = {}
    return {**base, "stock": stock, "title_fr": base.get("title_mw_fr") or (m.title_fr if m else None),
            "printed": len(done), "in_progress": sum(1 for r in rows if r[1] == "IN_PROGRESS"),
            "printed_plates": sorted({f"{r[3] or ''}:{r[2] or '1'}" for r in done})}


async def model_comments(design_id: str, offset: int = 0) -> dict:
    """Commentaires et avis d'un modele (publics), 10 par page."""
    import asyncio
    did = str(design_id or "").strip()
    if not did.isdigit():
        return {"items": [], "total": 0}
    code, d = await asyncio.to_thread(
        _get_json, f"/comment-service/commentandrating?designId={did}&offset={max(0, int(offset))}&limit=10&type=0&sort=0")
    if not isinstance(d, dict):
        return {"items": [], "total": 0, "error": f"MakerWorld ne répond pas (HTTP {code})"}
    out = []
    for h in (d.get("hits") if isinstance(d.get("hits"), list) else []):
        if not isinstance(h, dict):
            continue
        c = h.get("comment") if isinstance(h.get("comment"), dict) else None
        r = h.get("ratingItem") if isinstance(h.get("ratingItem"), dict) else None
        src = c or r or {}
        u = src.get("user") if isinstance(src.get("user"), dict) else (r or {}).get("creator") if r else {}
        u = u if isinstance(u, dict) else {}
        imgs = [x.get("url") if isinstance(x, dict) else x for x in (src.get("images") or [])]
        orig = src.get("content") if isinstance(src.get("content"), str) else ""
        fr = src.get("contentTranslated") if isinstance(src.get("contentTranslated"), str) else ""
        out.append({"id": str(src.get("id") or ""), "text": fr or orig,
                    "original": orig if fr and fr.strip() != orig.strip() else None,
                    "score": r.get("score") if r and isinstance(r.get("score"), (int, float)) else None,
                    "when": src.get("createTime") if isinstance(src.get("createTime"), str) else None,
                    "likes": src.get("likeCount") if isinstance(src.get("likeCount"), int) else 0,
                    "replies": src.get("replyCount") if isinstance(src.get("replyCount"), int) else 0,
                    "user": u.get("name") if isinstance(u.get("name"), str) else "",
                    "avatar": u.get("avatar") if isinstance(u.get("avatar"), str) else None,
                    "images": [x for x in imgs if isinstance(x, str)][:6]})
    return {"items": out, "total": d.get("total") if isinstance(d.get("total"), int) else len(out)}


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
                or (m.status == "ok" and m.profiles is None)                 or (m.status == "ok" and m.profiles not in (None, "[]") and '"instance_id"' not in m.profiles):
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
    titles = [r["title"] for r in res.values() if r.get("status") == "ok" and r.get("title") and not r.get("title_fr")]
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
            if r.get("title_fr"):
                m.title_fr = r["title_fr"][:512]          # traduction de MakerWorld
            elif r.get("title") in table:
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
