"""Notre catalogue (03/11/2026) : un fichier du depot (catalog_data/catalogue.json), qui s'ajoute aux autres catalogues
pour les couleurs qu'aucun n'a (Geeetech PLA Skin…). Il voyage avec l'appli (les copains l'ont aussi) et s'enrichit par
des commits, pas depuis l'appli. Ses couleurs passent dans « Autres marques », avant l'Open Filament Database : creer
un filament, le rattacher, la synchro.

Une entree : {id (stable : il sert au rattachement), brand, gamme, family, name, name_fr, colors [hex], hex_approx,
filament_weight_g, spool_weight_g, gtin, print_temp, source}. Sans poids de support : celui de SpoolmanDB pour la meme
marque, matiere et poids net, comme pour l'Open Filament Database.
"""
import json
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)
FILE = Path(__file__).parent / "catalog_data" / "catalogue.json"
_C = {"mt": None, "items": []}


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def items() -> list:
    try:
        mt = FILE.stat().st_mtime
    except OSError:
        return []
    if _C["mt"] != mt:
        try:
            raw = json.loads(FILE.read_text(encoding="utf-8")).get("entries") or []
        except (OSError, ValueError, AttributeError):
            logger.exception("[CATALOGUE] notre catalogue illisible")
            raw = []
        _C.update(mt=mt, items=[x for x in raw if isinstance(x, dict) and x.get("id") and x.get("brand") and x.get("name") and x.get("colors")])
    return _C["items"]


def view(x: dict) -> dict:
    """A la forme des autres catalogues (ofd_catalog.view), source « own »."""
    from .bambu_catalog import fr_name
    from . import ofd_catalog
    from .type_transco import apply as transco
    cols = [str(c).lstrip("#").upper() for c in x.get("colors") or []]
    ft = transco(x.get("gamme") or x.get("family"), x.get("family"))
    ctype = x.get("color_type") or ("coaxial" if len(cols) > 1 else "monochrome")
    fw = x.get("filament_weight_g") or 1000
    sw, src = x.get("spool_weight_g"), "catalogue" if x.get("spool_weight_g") else None
    if not sw:                                  # le support le plus courant de la marque (SpoolmanDB)
        db = (ofd_catalog.index() or {}).get("spool_db") or {}
        b = _norm(x["brand"])
        for k in (f"{b}|{str(x.get('family') or '').upper()}|{int(fw)}", f"{b}||{int(fw)}"):
            if k in db:
                sw, src = db[k], "spoolman"
                break
    return {"source": "own", "fila_id": f"own-{x['id']}", "ref": x["id"], "fila_color_code": "", "color_code": "",
            "brand": x["brand"], "fila_type": ft, "gamme": x.get("gamme"), "family": x.get("family"),
            "name": x["name"], "name_fr": x.get("name_fr") or fr_name({"en": x["name"]}), "color_hex": cols[0] if cols else "",
            "colors": cols, "color_type": ctype, "color_type_fr": ctype, "filament_weight_g": fw,
            "spool_weight_g": sw, "spool_src": src, "hex_approx": bool(x.get("hex_approx")), "gtin": x.get("gtin"),
            "discontinued": bool(x.get("discontinued")),
            "tech": {k: v for k, v in {"gtin": x.get("gtin"), "print_temp": x.get("print_temp")}.items() if v}}


def entry(ref: str) -> dict | None:
    x = next((x for x in items() if x["id"] == str(ref or "")), None)
    return view(x) if x else None


def search(brand: str = "", family: str = "", q: str = "") -> list:
    b, ql = _norm(brand), (q or "").strip().casefold()
    out = []
    for x in items():
        if b and _norm(x["brand"]) != b:
            continue
        if family and (x.get("family") or "").lower() != family.lower():
            continue
        if ql and ql not in f"{x['name']} {x.get('name_fr') or ''} {x.get('gamme') or ''}".casefold():
            continue
        out.append(view(x))
    return out


def brands() -> dict:
    """{marque normalisee: (nom, nombre, familles)}"""
    out: dict = {}
    for x in items():
        k = _norm(x["brand"])
        name, n, fams = out.get(k, (x["brand"], 0, set()))
        fams.add(x.get("family") or "")
        out[k] = (name, n + 1, fams)
    return out
