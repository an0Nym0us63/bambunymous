"""Les plateaux d'impression (06/11/2026) : ceux qu'on possede, celui qu'un plateau du planning demande, celui en place.

Le plateau voulu se lit dans le 3MF du profil MakerWorld (le type de plateau du plateau, sinon celui du projet) ; celui en
place, dans le 3MF de la derniere impression (on imprime sur le plateau pour lequel on a tranche). Ce qui ne va pas sur un
plateau vient de Bambu Studio : chaque profil de filament y donne une temperature par type de plateau, et 0 veut dire
« ce filament ne va pas sur ce plateau » (profils @BBL H2C de Studio, releves le 06/11/2026). On y ajoute ce que
l'utilisateur deconseille lui-meme pour un plateau.
"""
import json
import logging
import os
import re
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))

# les types de plateau de Bambu (BedType de Studio) : la cle, le nom affiche
KINDS = {"textured": "PEI texturé", "supertack": "SuperTack", "cool": "Cool Plate", "hot": "PEI lisse", "eng": "Engineering"}
ORDER = ("textured", "supertack", "cool", "hot", "eng")

# ce qui ne va pas sur chaque plateau, d'apres Studio (temperature de plateau a 0) : par sous-type Bambu, puis par matiere
NO_SUB = {"ABS": ["cool", "supertack"], "ABS-GF": ["cool", "supertack"], "ASA": ["cool", "supertack"], "ASA-Aero": ["cool", "supertack"],
          "ASA-CF": ["cool", "supertack"], "PA-CF": ["cool", "supertack"], "PA6-CF": ["cool", "supertack"], "PA6-GF": ["cool", "supertack"],
          "PAHT-CF": ["cool", "supertack"], "PC": ["cool", "supertack"], "PC FR": ["cool", "supertack"], "PET-CF": ["cool"],
          "PETG Basic": ["cool"], "PETG HF": ["cool"], "PETG Matte": ["cool"], "PETG Translucent": ["cool"], "PETG-CF": ["cool"],
          "PLA Aero": ["supertack"], "PLA Silk": ["supertack"], "PPA-CF": ["cool", "supertack"], "PPS-CF": ["cool", "supertack"],
          "Support for ABS": ["cool", "supertack"], "Support For PA/PET": ["cool", "supertack"], "Support For PLA/PETG": ["supertack"],
          "Support G": ["cool", "supertack"], "TPU 85A": ["supertack"], "TPU 90A": ["supertack"], "TPU 95A": ["supertack"],
          "TPU 95A HF": ["supertack"], "TPU for AMS": ["supertack"]}
NO_MAT = {"ABS": ["cool", "supertack"], "ASA": ["cool", "supertack"], "BVOH": ["supertack"], "EVA": ["supertack"], "HIPS": ["cool", "supertack"],
          "PA": ["cool", "supertack"], "PA-CF": ["cool", "supertack"], "PC": ["cool", "supertack"], "PCTG": ["cool", "supertack"],
          "PE": ["supertack"], "PE-CF": ["supertack"], "PETG": ["cool"], "PETG-CF": ["cool"], "PHA": ["supertack"], "PP": ["supertack"],
          "PP-CF": ["supertack"], "PP-GF": ["supertack"], "PPA-CF": ["cool", "supertack"], "PPA-GF": ["cool", "supertack"],
          "PPS": ["cool", "supertack"], "PPS-CF": ["cool", "supertack"], "TPU": ["supertack"], "TPU-AMS": ["supertack"]}


def kind_of(v) -> str | None:
    """Un type de plateau tel que l'ecrit un 3MF (« Supertack Plate », « Textured PEI Plate », « textured_plate »…)."""
    s = str(v or "").lower()
    if not s:
        return None
    if "supertack" in s:
        return "supertack"
    if "textured" in s or "pte" in s:
        return "textured"
    if "eng" in s:
        return "eng"
    if "high temp" in s or "hot" in s or "smooth" in s or "pei" in s:
        return "hot"
    if "cool" in s or s in ("pc", "default plate"):
        return "cool"
    return None


def bad_kinds(material: str | None, fila_type: str | None, extra: dict | None = None) -> set:
    """Les plateaux deconseilles pour ce filament : ceux de Studio (sous-type, sinon matiere), et ceux que l'utilisateur
    deconseille (extra : {plateau: [matieres ou sous-types]})."""
    out = set()
    ft = (fila_type or "").strip()
    m = (material or "").strip().upper()
    sub = next((v for k, v in NO_SUB.items() if k.lower() == ft.lower()), None)
    if sub is None and ft.lower().startswith("bambu "):
        sub = next((v for k, v in NO_SUB.items() if k.lower() == ft[6:].lower()), None)
    out |= set(sub if sub is not None else NO_MAT.get(m, NO_MAT.get(m.split("-")[0], [])) if m else [])
    for k, mats in (extra or {}).items():
        for x in mats or []:
            x = str(x).strip().lower()
            if x and (x == ft.lower() or x == m.lower() or (ft and ft.lower().startswith(x + " "))):
                out.add(k)
    return out


_CACHE: dict = {}
# (06/11/2026) gardes aussi sur disque : apres un redemarrage, le premier planning rouvrait le 3MF de chaque profil
# (2 a 4 s de boucle figee). La cle porte la date du fichier : un 3MF change est relu.
_DISK = {"v": None, "timer": None}


def _disk_file() -> Path:
    return DATA_DIR / "cache" / "plate_beds.json"


def _disk() -> dict:
    if _DISK["v"] is None:
        try:
            v = json.loads(_disk_file().read_text(encoding="utf-8"))
            _DISK["v"] = v if isinstance(v, dict) else {}
        except (OSError, ValueError):
            _DISK["v"] = {}
    return _DISK["v"]


def _disk_flush() -> None:
    _DISK["timer"] = None
    try:
        f = _disk_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(dict(_disk())), encoding="utf-8")
        tmp.replace(f)
    except (OSError, RuntimeError):
        pass


def _disk_put(k: str, v) -> None:
    import threading
    d = _disk()
    if d.get(k, "∅") == v:
        return
    if len(d) > 4000:
        d.clear()
    d[k] = v
    # ecrit 5 s apres la derniere nouveaute (une rafale au demarrage : une seule ecriture)
    if _DISK.get("timer") is None:
        t = threading.Timer(5.0, _disk_flush)
        t.daemon = True
        _DISK["timer"] = t
        t.start()


def bed_of_3mf(path, plate=None) -> str | None:
    """Le type de plateau d'un 3MF : celui du plateau `plate` (son reglage propre, ou celui du G-code tranche), sinon celui
    du projet. Garde en memoire selon la date du fichier."""
    # la date du fichier est toujours relue, NAS compris (une copie peut y etre remplacee) : un fichier change est relu
    try:
        p = Path(path)
        st = p.stat()
        key = (str(p), st.st_mtime, str(plate or ""))
    except OSError:
        return None
    if key in _CACHE:
        return _CACHE[key]
    dk = f"{key[0]}|{key[1]}|{key[2]}"
    hit = _disk().get(dk, "∅")
    if hit != "∅":
        _CACHE[key] = hit
        return hit
    out = None
    try:
        with zipfile.ZipFile(p) as z:
            names = set(z.namelist())
            n = str(plate or 1)
            if f"Metadata/plate_{n}.json" in names:                  # un 3MF tranche : le plateau de son G-code
                try:
                    out = kind_of(json.loads(z.read(f"Metadata/plate_{n}.json")).get("bed_type"))
                except ValueError:
                    pass
            if not out and "Metadata/model_settings.config" in names:  # le reglage propre du plateau
                xml = z.read("Metadata/model_settings.config").decode("utf-8", "ignore")
                for blk in re.findall(r"<plate>(.*?)</plate>", xml, re.S):
                    if re.search(rf'key="plater_id" value="{re.escape(n)}"', blk):
                        m = re.search(r'key="bed_type" value="([^"]*)"', blk)
                        out = kind_of(m.group(1)) if m else None
                        break
            if not out and "Metadata/project_settings.config" in names:  # celui du projet
                try:
                    out = kind_of(json.loads(z.read("Metadata/project_settings.config")).get("curr_bed_type"))
                except ValueError:
                    pass
    except (zipfile.BadZipFile, OSError):
        logger.info(f"[PLATEAUX] 3MF illisible : {path}")
    if len(_CACHE) > 2000:
        _CACHE.clear()
    _CACHE[key] = out
    _disk_put(dk, out)
    return out


def profile_bed(design_id, profile_id, plate=None) -> str | None:
    """Le plateau que demande un plateau d'un profil MakerWorld (son 3MF d'origine, s'il est deja la)."""
    try:
        from .mw_source import print_file
        f = print_file(design_id, profile_id)
    except Exception:
        return None
    return bed_of_3mf(f, plate) if f else None


def printer_code() -> str | None:
    """Le code du plateau que l'imprimante voit en place (device.plate.cur_id, lu grace au repere du plateau)."""
    try:
        from ..core.mqtt import get_state
        raw = getattr(get_state(), "raw", None) or {}
        return str(((raw.get("device") or {}).get("plate") or {}).get("cur_id") or "") or None
    except Exception:
        return None


async def mounted(plates: list | None = None) -> dict | None:
    """Le plateau en place (06/11/2026) : celui dont l'imprimante voit le code, s'il a ete reconnu (« C'est celui en
    place ») ; sinon celui de l'impression en cours ou de la derniere (son 3MF tranche). {kind, name, code, how}."""
    code = printer_code()
    learned = await _learn(plates, code) if code else None
    if code:
        hits = [(p["kind"], (u.get("name") or f"{KINDS[p['kind']]} {i + 1}")) for p in plates or [] if p.get("kind") in KINDS
                for i, u in enumerate(p.get("units") or []) if u.get("code") == code]
        if hits:
            return {"kind": hits[0][0], "name": " ou ".join(h[1] for h in hits), "code": code, "how": "printer",
                    **({"learned": True} if learned else {})}
    out = await _mounted_3mf()
    if out:
        out["code"] = code
    return out or ({"kind": None, "code": code, "how": None} if code else None)


async def _learn(plates: list | None, code: str) -> bool:
    """Un code que l'imprimante lit pour la premiere fois (06/11/2026) : si une impression tourne, son 3MF dit le type
    du plateau ; s'il ne reste qu'un plateau de ce type sans code, c'est lui : le code lui est associe (et enregistre).
    Plusieurs candidats, ou aucun : rien (« C'est celui en place » dans Parametres › Imprimante)."""
    if not plates or any(u.get("code") == code for p in plates for u in p.get("units") or []):
        return False
    try:
        from ..core.mqtt import get_state
        if str(get_state().status or "").upper() not in ("RUNNING", "PAUSE", "PREPARE"):
            return False
        from sqlalchemy import select
        from ..db.session import AsyncSessionLocal
        from ..models.print_history import Print
        async with AsyncSessionLocal() as db:
            row = (await db.execute(select(Print.model_3mf, Print.plate_id).where(Print.status == "IN_PROGRESS")
                                    .order_by(Print.print_date.desc()).limit(1))).first()
    except Exception:
        logger.exception("[PLATEAUX] apprendre le code")
        return False
    k = bed_of_3mf(DATA_DIR / row[0], row[1]) if row and row[0] else None
    p = next((x for x in plates if x.get("kind") == k), None)
    if not p:
        return False
    n = int(p.get("n") or 0)
    units = list(p.get("units") or [])[:n]
    while len(units) < n:
        units.append({"name": "", "code": None})
    free = [i for i, u in enumerate(units) if not u.get("code")]
    if len(free) != 1:
        return False
    units[free[0]] = {**units[free[0]], "code": code}
    p["units"] = units                       # en place : la config deja chargee le garde aussi
    try:
        from . import planner as P
        await P.set_settings({"plates": plates})
    except Exception:
        logger.exception("[PLATEAUX] enregistrer le code appris")
        return False
    logger.info(f"[PLATEAUX] code {code} appris : {KINDS.get(k, k)} n°{free[0] + 1} (d'apres le 3MF de l'impression)")
    return True


async def _mounted_3mf() -> dict | None:
    """Le plateau de l'impression en cours, sinon de la derniere (son 3MF tranche). {kind, print_id, how}."""
    try:
        from sqlalchemy import select
        from ..db.session import AsyncSessionLocal
        from ..models.print_history import Print
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(Print.id, Print.model_3mf, Print.plate_id).where(Print.model_3mf.is_not(None))
                                     .order_by(Print.print_date.desc()).limit(3))).all()
    except Exception:
        logger.exception("[PLATEAUX] derniere impression")
        return None
    for pid, f, pl in rows:
        k = bed_of_3mf(DATA_DIR / f, pl)
        if k:
            return {"kind": k, "print_id": pid, "how": "3mf"}
    return None


def bambu_no(kind: str) -> list:
    """Ce que Bambu deconseille sur un plateau, en court : les familles (ABS, PA, TPU… sans leurs -CF/-GF), puis les
    sous-types qui font exception dans une famille permise (PLA Silk sur le SuperTack)."""
    fam = lambda x: re.split(r"[ -]", x.strip())[0].upper()
    mats = sorted({fam(m) for m, v in NO_MAT.items() if kind in v})
    subs = sorted({s for s, v in NO_SUB.items() if kind in v and not any(fam(s).startswith(m) for m in mats) and not s.lower().startswith("support")})
    return mats + subs


def owned(plates: list) -> list:
    """Les types de plateau possedes, dans l'ordre de preference de l'utilisateur (celui de la liste, 06/11/2026)."""
    out = []
    for p in plates or []:
        if p.get("kind") in KINDS and int(p.get("n") or 0) > 0 and p["kind"] not in out:
            out.append(p["kind"])
    return out


def avoid_map(plates: list) -> dict:
    return {p["kind"]: p.get("avoid") or [] for p in plates or [] if p.get("kind") in KINDS}
