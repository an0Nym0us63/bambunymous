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


_MADE: set = set()


def _dir() -> Path:
    from ..core.config import settings
    d = Path(settings.DATA_DIR) / "mw_3mf"
    # cree une fois par demarrage (la liste des impressions passe ici pour chacune : un mkdir a chaque fois)
    if d not in _MADE:
        d.mkdir(parents=True, exist_ok=True)
        _MADE.add(d)
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


# La recuperation d'un 3MF, rendue plus solide (28/10/2026) : les memes en-tetes que les lectures publiques
# (l'appli se presente toujours comme elle-meme), une reprise sur les pannes passageres (coupure, delai, 5xx :
# trois essais espaces de 2, 4 puis 8 s), le « Retry-After » d'un 429 respecte (au plus une minute), la seconde
# porte de l'API en secours, et un telechargement coupe repris la ou il en etait (en-tete Range). Jamais de
# reprise sur un 418 (« es-tu un robot ? » : c'est a toi de repondre sur le site), un 401 ou la limite du jour.
RETRIES = 3
BACKOFF_S = (2, 4, 8)
RETRY_AFTER_MAX_S = 60
_SECOND_GATE = "https://makerworld.com/api/v1"


def _headers(tok: str = None) -> dict:
    h = {"User-Agent": "Mozilla/5.0 (BambuNymous)", "Accept": "application/json",
         "Accept-Language": "fr-FR,fr;q=0.9", "x-bbl-language": "fr"}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


def _transient(status: int) -> bool:
    return status >= 500 or status in (408, 425)


def _retry_after(r, default: float) -> float:
    try:
        return min(RETRY_AFTER_MAX_S, max(1.0, float(r.headers.get("Retry-After", default))))
    except (TypeError, ValueError):
        return default


def _link(iid: str, tok: str, dev_model: str = "") -> dict:
    """Le lien signe (temporaire) du 3MF d'une instance : {url, name}. Les deux portes, avec reprises."""
    import time
    from urllib.parse import quote
    from .makerworld import session
    from .makerworld_account import WRITE_HOST
    path = DOWNLOAD.format(iid=iid) + (f"&devModelName={quote(dev_model)}" if dev_model else "")
    gates = [WRITE_HOST] + ([_SECOND_GATE] if _SECOND_GATE != WRITE_HOST else [])
    last = "MakerWorld injoignable"
    for attempt in range(RETRIES):
        for host in gates:
            try:
                r = session().get(host + path, headers=_headers(tok), timeout=20)
            except Exception as e:
                last = f"MakerWorld injoignable ({type(e).__name__})"
                continue
            code = r.status_code
            if code == 401:
                raise ExactError("Jeton refusé ou expiré : reconnecte le compte")
            if code == 418:
                raise ExactError("HTTP 418 : MakerWorld demande de vérifier que tu n'es pas un robot (fais le captcha sur makerworld.com)")
            try:
                d = r.json()
            except ValueError:
                d = None
            url = d.get("url") if isinstance(d, dict) else None
            if code < 400 and isinstance(url, str) and url.startswith("http"):
                return {"url": url, "name": d.get("name") if isinstance(d.get("name"), str) else f"{iid}.3mf"}
            msg = (d or {}).get("message") or (d or {}).get("error") if isinstance(d, dict) else None
            last = f"Lien du 3MF non obtenu (HTTP {code}{' : ' + str(msg) if msg else ''})"
            if code == 429:
                # trop d'appels : on attend ce que le serveur demande, puis on reessaie (la meme porte d'abord)
                time.sleep(_retry_after(r, BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)]))
                break
            if not _transient(code):
                raise ExactError(last)          # 400 (limite du jour…), 403, 404 : inutile d'insister
        else:
            if attempt < RETRIES - 1:
                time.sleep(BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)])
    raise ExactError(last)


def download_link(iid: str, tok: str, dev_model: str = "") -> dict:
    """Lien signe (temporaire) du 3MF d'un profil, comme le bouton « Ouvrir
    dans Bambu Studio » du site (releve le 19/10/2026). Compte comme un
    telechargement sur MakerWorld."""
    return _link(iid, tok, dev_model)


def _download(iid: str, tok: str) -> bytes:
    """Le 3MF d'une instance, en entier. Un flux coupe est repris la ou il en etait (Range), trois essais."""
    import time
    from .makerworld import session
    url = _link(iid, tok)["url"]
    buf = io.BytesIO()
    last = "Téléchargement du 3MF interrompu"
    for attempt in range(RETRIES):
        h = {k: v for k, v in _headers().items() if k != "Accept"}
        have = buf.tell()
        if have:
            h["Range"] = f"bytes={have}-"
        try:
            with session().get(url, stream=True, timeout=60, headers=h) as f:
                if f.status_code == 429 or _transient(f.status_code):
                    last = f"Téléchargement du 3MF refusé (HTTP {f.status_code})"
                    time.sleep(_retry_after(f, BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)]))
                    continue
                if f.status_code >= 400:
                    raise ExactError(f"Téléchargement du 3MF refusé (HTTP {f.status_code})")
                if have and f.status_code != 206:
                    buf = io.BytesIO()                  # le serveur ne reprend pas : tout depuis le debut
                for chunk in f.iter_content(1 << 16):
                    buf.write(chunk)
                    if buf.tell() > MAX_BYTES:
                        raise ExactError("3MF trop gros (plus de 300 Mo)")
                want = f.headers.get("Content-Length")
                got = buf.tell() - (have if f.status_code == 206 else 0)
                if want and want.isdigit() and got < int(want):
                    raise OSError("flux coupé")       # moins que promis : on reprend
                return buf.getvalue()
        except ExactError:
            raise
        except Exception as e:
            last = f"Téléchargement du 3MF interrompu ({type(e).__name__})"
            if attempt < RETRIES - 1:
                time.sleep(BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)])
    raise ExactError(last)


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
