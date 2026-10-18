"""
Filaments EXACTS d'un profil MakerWorld, lus dans son 3MF a la demande.

La fiche publique ne donne que le type vu par le trancheur (PLA, PETG…) :
ni la finition (Matte, Silk, Basic) ni la marque. Le 3MF du profil, lui,
porte dans Metadata/project_settings.config, emplacement par emplacement :
  filament_ids          GFA01 (reference Bambu : Filament.profile_id en stock)
  filament_settings_id  « Bambu PLA Matte @BBL X1C »
  filament_vendor       « Bambu Lab »
  filament_type / filament_colour
Le telecharger demande le compte MakerWorld et compte comme un telechargement
sur le site : seulement sur demande, et le resultat est garde sur disque
(data/mw_3mf/<instance>.json) pour ne jamais retelecharger.
"""
import io
import json
import logging
import re
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

MAX_BYTES = 300 * 1024 * 1024
DOWNLOAD = "/design-service/instance/{iid}/f3mf?type=download"


class ExactError(Exception):
    pass


def _dir() -> Path:
    from ..core.config import settings
    d = Path(settings.DATA_DIR) / "mw_3mf"
    d.mkdir(parents=True, exist_ok=True)
    return d


def cached(iid: str):
    p = _dir() / f"{iid}.json"
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None
    except (OSError, ValueError):
        return None


def subtype_of(settings_id: str) -> str:
    """« Bambu PLA Matte @BBL X1C » -> « PLA Matte » ; « Generic PETG » -> « PETG »."""
    s = re.sub(r"\s*@.*$", "", str(settings_id or "")).strip()
    s = re.sub(r"^(Bambu|Generic)\s+", "", s, flags=re.I)
    return s


def parse_project(data: bytes) -> list:
    """Emplacements de filament du projet : [{slot, id, setting, subtype, vendor, type, color}]."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ExactError("Le fichier reçu n'est pas un 3MF")
    with z:
        if "Metadata/project_settings.config" not in z.namelist():
            raise ExactError("3MF sans réglages de projet (project_settings.config)")
        try:
            ps = json.loads(z.read("Metadata/project_settings.config").decode("utf-8", "replace"))
        except ValueError:
            raise ExactError("Réglages de projet illisibles")
    col = lambda k: ps.get(k) if isinstance(ps.get(k), list) else []
    colors, types, sets, ids, vendors = (col("filament_colour"), col("filament_type"), col("filament_settings_id"),
                                         col("filament_ids"), col("filament_vendor"))
    n = max(len(colors), len(types), len(sets))
    at = lambda lst, i: str(lst[i]).strip() if i < len(lst) and lst[i] is not None else ""
    out = []
    for i in range(n):
        st = at(sets, i)
        out.append({"slot": i + 1, "id": at(ids, i), "setting": st, "subtype": subtype_of(st),
                    "vendor": at(vendors, i), "type": at(types, i), "color": at(colors, i)[:7].upper()})
    return out


def _download(iid: str, tok: str) -> bytes:
    from .makerworld import session
    from .makerworld_account import WRITE_HOST
    h = {"User-Agent": "Mozilla/5.0 (BambuNymous)", "Accept": "application/json", "Authorization": f"Bearer {tok}"}
    try:
        r = session().get(WRITE_HOST + DOWNLOAD.format(iid=iid), headers=h, timeout=20)
    except Exception as e:
        raise ExactError(f"MakerWorld injoignable ({type(e).__name__})")
    if r.status_code == 401:
        raise ExactError("Jeton refusé ou expiré : reconnecte le compte")
    try:
        d = r.json()
    except ValueError:
        d = None
    url = d.get("url") if isinstance(d, dict) else None
    if r.status_code >= 400 or not isinstance(url, str) or not url.startswith("http"):
        msg = (d or {}).get("message") or (d or {}).get("error") if isinstance(d, dict) else None
        raise ExactError(f"Lien du 3MF non obtenu (HTTP {r.status_code}{' : ' + str(msg) if msg else ''})")
    try:
        with session().get(url, stream=True, timeout=60, headers={"User-Agent": "Mozilla/5.0 (BambuNymous)"}) as f:
            if f.status_code >= 400:
                raise ExactError(f"Téléchargement du 3MF refusé (HTTP {f.status_code})")
            buf = io.BytesIO()
            for chunk in f.iter_content(1 << 16):
                buf.write(chunk)
                if buf.tell() > MAX_BYTES:
                    raise ExactError("3MF trop gros (plus de 300 Mo)")
            return buf.getvalue()
    except ExactError:
        raise
    except Exception as e:
        raise ExactError(f"Téléchargement du 3MF interrompu ({type(e).__name__})")


async def exact_filaments(iid: str) -> dict:
    """Lit (ou reprend du disque) les emplacements exacts d'un profil."""
    import asyncio
    iid = str(iid or "").strip()
    if not iid.isdigit():
        raise ExactError("Profil inconnu")
    hit = cached(iid)
    if hit is not None:
        return {"slots": hit, "cached": True}
    from .makerworld_account import token
    tok = await token()
    if not tok:
        raise ExactError("Compte MakerWorld non connecté (Paramètres → Données → MakerWorld)")
    data = await asyncio.to_thread(_download, iid, tok)
    slots = parse_project(data)
    (_dir() / f"{iid}.json").write_text(json.dumps(slots, ensure_ascii=False), encoding="utf-8")
    logger.info(f"[MW] profil {iid} : filaments exacts lus ({len(slots)} emplacements, {len(data) // 1024} Ko)")
    return {"slots": slots, "cached": False}


def slot_for(slots: list, mw_type: str, color: str):
    """L'emplacement du projet qui correspond a un filament de la fiche (couleur, puis type)."""
    c = str(color or "").strip().upper()[:7]
    same = [s for s in slots or [] if s["color"] == c]
    if not same:
        return None
    t = str(mw_type or "").upper()
    return next((s for s in same if s["type"].upper() == t), same[0])
