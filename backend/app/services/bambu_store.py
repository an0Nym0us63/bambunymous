"""Les liens directs de la boutique Bambu Lab, par code couleur (31/10/2026).

La boutique ouvre une variante (couleur, avec bobine ou recharge, poids) par « ?id=<variante> » ; la page de chaque
produit les liste toutes (mw_docs._store_variants). Une fois par semaine, les pages des filaments du plan du site
(sitemap_products_1.xml) sont lues, et chaque code couleur Bambu (« Jaune tournesol (10402) ») garde le lien de sa
recharge 1 kg et de sa bobine 1 kg : de quoi racheter une bobine d'un clic, depuis sa fiche, le stock ou « À faire ».
Garde dans DATA_DIR/bambu_catalog/store_links.json (avec le catalogue Bambu : meme sauvegarde, meme rangement)."""
import json
import logging
import re
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

STORE = "https://eu.store.bambulab.com"
TTL = 7 * 24 * 3600
# les produits filaments (« plastic-… », les pieces detachees et le reste n'en sont pas)
_SLUG = re.compile(r"^(pla-|petg|pet-|abs|asa|tpu|pa6|paht|pc-|pc$|ppa|pps|pva|support-for)")
_CODE = re.compile(r"\((\d{5})\)")
_BUILD = {"on": False}
_LOCK = threading.Lock()


def _file() -> Path:
    from ..core.config import settings
    return Path(settings.DATA_DIR) / "bambu_catalog" / "store_links.json"


def _slugs() -> list:
    import requests
    r = requests.get(f"{STORE}/sitemap_products_1.xml", timeout=(10, 30), headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    out = []
    for loc in re.findall(r"<loc>([^<]+)</loc>", r.text):
        m = re.fullmatch(re.escape(STORE) + r"/products/([a-z0-9-]+)", loc.strip())
        if m and _SLUG.match(m.group(1)) and not m.group(1).startswith("plastic"):
            out.append(m.group(1))
    return list(dict.fromkeys(out))


def build() -> dict:
    """Lit les pages des filaments et range leurs variantes par code couleur. La boutique (Cloudflare) refuse les pages
    lues trop vite : une page a la fois, sans se presser ; chaque produit garde ce qu'il a donne, un produit refuse garde
    ce qu'il avait la fois d'avant et se relit deux heures plus tard."""
    from . import mw_docs
    try:
        old = json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        old = {}
    per = dict(old.get("slugs") or {})
    failed = []
    slugs = _slugs()
    for slug in slugs:
        url = f"{STORE}/products/{slug}"
        mw_docs._STORE.pop(url, None)                   # relue pour de bon (pas le souvenir d'un refus)
        got: dict = {}
        for name, link in mw_docs._store_variants(url):
            m = _CODE.search(name)
            if not m:
                continue
            e = got.setdefault(m.group(1), {"name": name.split("/")[0].strip()})
            k, w = mw_docs._kind(name), mw_docs._kg(name.split("/")[-1])
            if k and w == "1kg":
                e.setdefault(k, link)                   # « refill » / « spool », en 1 kg
            e.setdefault("any", link)
        if got:
            per[slug] = got
        elif not mw_docs._STORE.get(url, (0, []))[1]:
            failed.append(slug)
        time.sleep(2.5)                                 # la boutique n'aime pas qu'on se presse
    codes: dict = {}
    for got in per.values():
        for c, e in got.items():
            codes.setdefault(c, e)
    data = {"at": int(time.time()), "store": STORE, "products": len(slugs), "failed": failed, "slugs": per, "codes": codes}
    f = _file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".part")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)
    logger.info(f"[boutique] {len(codes)} couleurs Bambu sur {len(slugs)} produits" + (f", {len(failed)} refuses (relus plus tard)" if failed else ""))
    return data


def _build_bg() -> None:
    try:
        build()
    except Exception as e:
        logger.warning(f"[boutique] liens directs non lus : {e}")
    finally:
        _BUILD["on"] = False


def load() -> dict:
    """L'index garde ({} s'il n'existe pas encore) ; perime ou absent, il se refait en fond."""
    try:
        data = json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    data.pop("slugs", None)
    ttl = 2 * 3600 if data.get("failed") else TTL     # des produits refuses : relus plus tot
    if not data or time.time() - (data.get("at") or 0) > ttl:
        with _LOCK:
            if not _BUILD["on"]:
                _BUILD["on"] = True
                threading.Thread(target=_build_bg, daemon=True).start()
    return data
