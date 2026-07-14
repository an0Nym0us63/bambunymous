"""
Scan RFID des bobines Bambu.

L'application Android lit le tag NFC de la bobine et POSTe le JSON du tag ici.
On s'en sert pour deux choses :

  1. `tray_uid` est l'identifiant UNIQUE du tag. S'il correspond a une bobine
     connue, on ouvre sa fiche : plus besoin de la chercher.
  2. Sinon, `material_id` + `material_variant_id` permettent de retrouver la
     reference EXACTE dans le catalogue Bambu, et donc de proposer la creation
     du filament et de la bobine sans rien saisir a la main.

Note utile : le catalogue local vient du meme projet que l'outil RFID
(3DPrint-Filament-RFID-Tool). Les identifiants du tag et ceux du catalogue sont
donc les memes champs — l'appariement est exact, pas heuristique.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

from ..core.config import settings

logger = logging.getLogger(__name__)

CATALOG_FILE = "filaments_color_codes.json"

COLOR_TYPE_FR = {"单色": "monochrome", "渐变色": "gradient", "多拼色": "coaxial"}


def _hex8(raw: Optional[str]) -> str:
    """'#00B1B7FF' -> '00b1b7ff'."""
    return (raw or "").strip().lstrip("#").lower()[:8]


def normalize_scan(payload: dict) -> dict:
    """Extrait du JSON du tag les seuls champs qui nous servent."""
    ci = payload.get("color_info") or {}
    specs = payload.get("technical_specs") or {}

    # Le tag expose la couleur sous deux noms selon la version du lecteur :
    # color_hex ou color_rgba. Les deux valent RRGGBBAA. Ne lire qu'un seul des
    # deux faisait echouer le repli couleur en silence.
    color = payload.get("color_hex") or payload.get("color_rgba")
    second = ci.get("second_color_rgba") or payload.get("second_color_rgba")

    return {
        "tray_uid":     (payload.get("tray_uid") or "").strip().upper(),
        "uid":          (payload.get("uid") or "").strip(),
        "material_id":  (payload.get("material_id") or "").strip().upper(),      # GFA00
        "variant_id":   (payload.get("material_variant_id") or "").strip().upper(),  # A00-B5
        "family":       (payload.get("filament_type") or "").strip(),            # PLA
        "fila_type":    (payload.get("detailed_filament_type") or "").strip(),   # PLA Basic
        "color_hex":    _hex8(color),
        "second_color": _hex8(second),
        "color_count":  int(ci.get("color_count") or 1),
        "spool_weight_g": float(payload.get("spool_weight_g") or 1000),
        "diameter_mm":  payload.get("diameter_mm"),
        "production_date": payload.get("production_date_time"),
        "specs":        specs,
    }


def _entries() -> list[dict]:
    path = os.path.join(settings.DATA_DIR, "bambu_catalog", CATALOG_FILE)
    if not os.path.exists(path):
        return []
    try:
        return json.loads(open(path).read()).get("data", [])
    except Exception as e:
        logger.error(f"[RFID] catalogue illisible : {e}")
        return []


def catalog_match(scan: dict, lang: str = "fr") -> Optional[dict]:
    """
    Retrouve la reference dans le catalogue Bambu.

    Deux passes :
      1. fila_id + fila_color_code — appariement EXACT, ce sont les memes
         identifiants que ceux graves dans le tag.
      2. repli sur fila_id + couleur, au cas ou le catalogue aurait un code de
         variante different (ou vide) pour cette reference.
    """
    entries = _entries()
    if not entries:
        return None

    mid, vid = scan["material_id"], scan["variant_id"]

    # Table en -> fr, pour completer les entrees sans nom francais
    en_to_fr = {}
    for e in entries:
        n = e.get("fila_color_name", {})
        if n.get("en") and n.get("fr"):
            en_to_fr[n["en"]] = n["fr"]

    def build(entry: dict) -> dict:
        names = entry.get("fila_color_name", {})
        name_en = names.get("en") or names.get("fr") or next(iter(names.values()), "")
        name_fr = names.get("fr") or en_to_fr.get(name_en, "") or name_en
        colors = [c.lstrip("#")[:8].lower() for c in (entry.get("fila_color") or [])]
        ctype = entry.get("fila_color_type", "")
        return {
            "name":            name_fr if lang == "fr" else name_en,
            "name_en":         name_en,
            "name_fr":         name_fr,
            "fila_type":       entry.get("fila_type", ""),
            "fila_id":         entry.get("fila_id", ""),
            "fila_color_code": entry.get("fila_color_code", ""),
            "color_code":      entry.get("color_code", ""),
            "color_hex":       colors[0] if colors else "",
            "colors":          colors,
            "color_type":      ctype,
            "multicolor_type": COLOR_TYPE_FR.get(ctype, ctype),
        }

    # Passe 1 : identifiants exacts
    if mid and vid:
        for e in entries:
            if (e.get("fila_id", "").upper() == mid
                    and (e.get("fila_color_code") or "").upper() == vid):
                return build(e)

    # Passe 2 : meme famille + meme couleur
    want = [c for c in (scan["color_hex"], scan["second_color"]) if c and c != "00000000"]
    if mid and want:
        for e in entries:
            if e.get("fila_id", "").upper() != mid:
                continue
            colors = [c.lstrip("#")[:8].lower() for c in (e.get("fila_color") or [])]
            if not colors:
                continue
            # Comparaison sur le RGB seul : l'alpha du tag n'est pas toujours
            # celui du catalogue, et une difference d'opacite n'a aucun sens ici.
            if [c[:6] for c in colors] == [c[:6] for c in want]:
                return build(e)

    return None
