"""
Parser 3MF pour BambuNymous.
Supporte : cloud (HTTP), FTP local imprimante (FTPS), fichier local.
Identique à Spoolnymous tools_3mf.py mais adapté FastAPI/async.
"""
import asyncio, io, logging, os, re, shutil, time, uuid, xml.etree.ElementTree as ET, zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import aiofiles, aiohttp

logger = logging.getLogger(__name__)
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))

# Timeouts / retries — volontairement genereux : perdre les donnees d'un print
# est bien pire que d'attendre quelques minutes de plus.
FTP_TIMEOUT_S      = int(os.getenv("TMF_FTP_TIMEOUT", "600"))   # 240 -> 600
FTP_CHECK_INTERVAL = 5
FTP_STABLE_CYCLES  = 3
FTP_FRESH_MAX_AGE  = 60
HTTP_ATTEMPTS      = 4
HTTP_TIMEOUT_S     = 90


class Invalid3MF(Exception):
    """Archive absente, tronquee ou inexploitable -> doit declencher un retry."""


def _validate_3mf(data: bytes) -> None:
    """
    Verifie qu'on a bien une archive 3MF exploitable AVANT de la considerer
    comme un succes. Sans ce garde-fou, un telechargement partiel produisait un
    print sans filament ni cout, et surtout SANS retry (le parse avalait
    l'exception et renvoyait un dict non vide).
    """
    if not data:
        raise Invalid3MF("téléchargement vide (0 byte)")
    if len(data) < 1024:
        raise Invalid3MF(f"archive suspecte : {len(data)} bytes")
    if not data.startswith(b"PK"):
        raise Invalid3MF("ce n'est pas une archive ZIP (signature PK absente)")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if z.testzip() is not None:
                raise Invalid3MF("archive ZIP corrompue (CRC)")
            if "Metadata/slice_info.config" not in z.namelist():
                raise Invalid3MF("slice_info.config absent de l'archive")
    except zipfile.BadZipFile as e:
        raise Invalid3MF(f"archive ZIP illisible : {e}")


def _clean_name(raw: str) -> str:
    name, _ = os.path.splitext(raw)
    name = name.replace("_", " ").replace("–", " ")
    name = re.sub(r"\b(v|rev|final)\d*\b", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+", " ", name).strip()
    return (name[:1].upper() + name[1:]) if name else name


async def _download_http(url: str) -> bytes:
    """
    Les URLs cloud sont pre-signees et expirent vite : on retente immediatement
    (backoff court) plutot que d'attendre le retry long de l'appelant.
    """
    last = None
    for attempt in range(1, HTTP_ATTEMPTS + 1):
        try:
            logger.info(f"[3MF-HTTP] ▶ Téléchargement ({attempt}/{HTTP_ATTEMPTS}): {url[:80]}")
            async with aiohttp.ClientSession() as s:
                async with s.get(url, timeout=aiohttp.ClientTimeout(total=HTTP_TIMEOUT_S)) as r:
                    r.raise_for_status()
                    data = await r.read()
            _validate_3mf(data)
            logger.info(f"[3MF-HTTP] ✅ {len(data)} bytes téléchargés et validés")
            return data
        except Exception as e:
            last = e
            logger.warning(f"[3MF-HTTP] ⚠ Tentative {attempt}/{HTTP_ATTEMPTS} échouée : {e}")
            if attempt < HTTP_ATTEMPTS:
                await asyncio.sleep(2 * attempt)
    raise Invalid3MF(f"échec HTTP après {HTTP_ATTEMPTS} tentatives : {last}")


def _download_ftp_sync(taskname: str, ip: str, code: str) -> bytes:
    """
    FTPS — attend l'apparition du fichier, verifie sa fraicheur et sa stabilite,
    puis telecharge. Portage complet de Spoolnymous + garde-fous supplementaires.
    """
    import pycurl, urllib.parse as _up, io as _io

    BACKOFF_ON_SIZE_CHANGE = 0.25   # laisse le fs finir son rename
    RECREATE_AFTER_STALE   = 2      # cycles size_ok + MDTM muet -> session sourde
    RETR_ATTEMPTS          = 4

    def _enc(s):
        return "".join(f"{ord(c):02x}" if c in "/:*|" else c for c in s)

    remote = f"/cache/{_up.quote(_enc(taskname) + '.gcode.3mf')}"
    raw    = f"/cache/{_enc(taskname)}.gcode.3mf"
    url    = f"ftps://{ip}{remote}"
    MDTM   = re.compile(r"(?:^|[\r\n])\s*\d{3}\s+(\d{14})(?:\.\d+)?\b", re.IGNORECASE)

    def mk():
        c = pycurl.Curl()
        for opt, val in [
            (c.URL, url), (c.USERPWD, f"bblp:{code}"),
            (c.SSL_VERIFYPEER, 0), (c.SSL_VERIFYHOST, 0),
            (c.FTP_SSL, c.FTPSSL_ALL), (c.FTPSSLAUTH, c.FTPAUTH_TLS),
            (c.FTP_FILEMETHOD, c.FTPMETHOD_NOCWD),
            (c.TRANSFERTEXT, False),
            (c.CONNECTTIMEOUT, 10), (c.TIMEOUT, FTP_CHECK_INTERVAL), (c.NOBODY, True),
        ]:
            c.setopt(opt, val)
        return c

    c = mk()
    start = time.time()
    last_sig = None
    last_size = None
    stable = 0
    stale_stable = 0          # stabilite d'un fichier NON frais
    mdtm_deaf_streak = 0
    accepted_stale = False

    try:
        while time.time() - start < FTP_TIMEOUT_S:
            size = mtime = None

            # 1) Taille
            try:
                c.perform()
                cl = int(c.getinfo(c.CONTENT_LENGTH_DOWNLOAD))
                size = cl if cl >= 0 else None
            except Exception:
                pass

            # 2) La taille vient de changer : le fichier est en cours d'ecriture,
            #    on laisse retomber avant d'interroger MDTM (fenetre de course).
            if last_size is not None and size is not None and size != last_size:
                time.sleep(BACKOFF_ON_SIZE_CHANGE)

            # 3) MDTM via le transcript verbeux
            buf = []
            c.setopt(c.VERBOSE, True)
            c.setopt(c.DEBUGFUNCTION, lambda t, m: buf.append(m.decode("latin1", "ignore")))
            c.setopt(c.QUOTE, [f"MDTM {raw}".encode()])
            try:
                c.perform()
            except Exception:
                pass
            finally:
                c.setopt(c.QUOTE, [])
                c.setopt(c.VERBOSE, False)
                c.setopt(c.DEBUGFUNCTION, lambda *a: None)

            m = MDTM.search("".join(buf))
            if m:
                try:
                    dt = datetime.strptime(m.group(1)[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                    mtime = int(dt.timestamp())
                except Exception:
                    mtime = None

            now_utc = int(datetime.now(timezone.utc).timestamp())
            age = (now_utc - mtime) if mtime is not None else None
            fresh   = mtime is not None and 0 <= age <= FTP_FRESH_MAX_AGE
            size_ok = size is not None and size > 0
            sig = (size if size is not None else -1, mtime if mtime is not None else -1)

            logger.debug(f"[3MF-FTP] size={size} mtime={mtime} age={age} fresh={fresh}")

            # 4) Session devenue sourde a MDTM : on la recree
            if size_ok and mtime is None:
                mdtm_deaf_streak += 1
                if mdtm_deaf_streak >= RECREATE_AFTER_STALE:
                    logger.warning("[3MF-FTP] 🔌 Session sourde à MDTM — recréation de la connexion")
                    try:
                        c.close()
                    except Exception:
                        pass
                    c = mk()
                    mdtm_deaf_streak = 0
                    last_sig = None
                    stable = 0
                    last_size = size
                    time.sleep(0.2)
                    continue
            else:
                mdtm_deaf_streak = 0

            # 5) Stabilisation
            if size_ok and fresh:
                stable = (stable + 1) if sig == last_sig else 1
                last_sig = sig
                if stable >= FTP_STABLE_CYCLES:
                    break
            else:
                # Repli : le fichier existe et ne bouge plus, mais MDTM le dit
                # vieux (reimpression depuis le cache : l'imprimante ne reecrit
                # pas toujours le fichier). Le nom est propre a la tache, donc
                # un fichier "perime" du meme taskname est bien le bon contenu.
                # Mieux vaut le prendre que de perdre les donnees du print.
                if size_ok and sig == last_sig:
                    stale_stable += 1
                    if stale_stable >= FTP_STABLE_CYCLES and time.time() - start > 60:
                        logger.warning(
                            f"[3MF-FTP] ⚠ Fichier stable mais non frais (age={age}s) — "
                            f"accepté quand même après {int(time.time()-start)}s"
                        )
                        accepted_stale = True
                        break
                else:
                    stale_stable = 0
                if sig != last_sig:
                    last_sig = sig
                    stable = 0

            last_size = size
            time.sleep(FTP_CHECK_INTERVAL)
        else:
            raise Invalid3MF(
                f"timeout {FTP_TIMEOUT_S}s : {raw} introuvable ou jamais stabilisé"
            )

        # 6) Telechargement, avec retry (RETR peut echouer en 550 sur session usee)
        logger.info(f"[3MF-FTP] 📥 Fichier stable{' (périmé)' if accepted_stale else ''}, téléchargement…")
        last_err = None
        for attempt in range(1, RETR_ATTEMPTS + 1):
            try:
                c.setopt(c.NOBODY, False)
                c.setopt(c.TIMEOUT, 0)
                out = _io.BytesIO()
                c.setopt(c.WRITEFUNCTION, out.write)
                c.perform()
                data = out.getvalue()
                _validate_3mf(data)
                logger.info(f"[3MF-FTP] ✅ {len(data)} bytes téléchargés et validés")
                return data
            except Exception as e:
                last_err = e
                code_err = e.args[0] if (hasattr(e, "args") and e.args) else None
                logger.warning(f"[3MF-FTP] ⚠ RETR tentative {attempt}/{RETR_ATTEMPTS} : {e}")
                if attempt < RETR_ATTEMPTS:
                    # bascule de methode puis recreation complete de la session
                    if attempt == 1 and code_err == 78:
                        c.setopt(c.FTP_FILEMETHOD, c.FTPMETHOD_SINGLECWD)
                    else:
                        try:
                            c.close()
                        except Exception:
                            pass
                        c = mk()
                        c.setopt(c.FTP_FILEMETHOD, c.FTPMETHOD_SINGLECWD)
                    time.sleep(0.5 * attempt)
        raise Invalid3MF(f"échec RETR après {RETR_ATTEMPTS} tentatives : {last_err}")
    finally:
        try:
            c.close()
        except Exception:
            pass


def _parse_3mf(data: bytes, print_id: int, strict: bool = True) -> dict:
    """Parse le 3MF, sauvegarde vignette + fichier, retourne les métadonnées."""
    result = {
        "title": "", "file": "", "plate_id": "1",
        "estimated_seconds": 0, "filaments": {},
        "plate_image": None, "model_3mf": None, "design_id": "",
    }
    print_dir = DATA_DIR / "prints" / str(print_id)
    logger.info(f"[3MF-PARSE] ▶ Parsing {len(data)} bytes, print_id={print_id}")
    print_dir.mkdir(parents=True, exist_ok=True)

    _validate_3mf(data)   # leve Invalid3MF -> l'appelant retente

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = z.namelist()

            # Titre & design_id
            if "3D/3dmodel.model" in names:
                try:
                    with z.open("3D/3dmodel.model") as f:
                        tree = ET.parse(f)
                        for meta in tree.getroot().findall(".//{*}metadata"):
                            k = meta.attrib.get("name", "").lower()
                            if k == "title":    result["title"]     = (meta.text or "").strip()
                            if k == "design_id": result["design_id"] = (meta.text or "").strip()
                            logger.debug(f"[3MF] metadata k={k!r} v={(meta.text or "").strip()!r}")
                except Exception as e: logger.debug(f"3dmodel parse: {e}")

            # slice_info.config
            if "Metadata/slice_info.config" in names:
                with z.open("Metadata/slice_info.config") as f:
                    root = ET.parse(f).getroot()
                for meta in root.findall(".//plate/metadata"):
                    k, v = meta.attrib.get("key"), meta.attrib.get("value", "")
                    if k == "index":      result["plate_id"] = v
                    elif k == "prediction":
                        try: result["estimated_seconds"] = int(v)
                        except Exception: pass
                _seq = 1  # fallback si pas d'attribut id
                for plate in root.findall(".//plate"):
                    for fil in plate.findall(".//filament"):
                        try:
                            # L'attribut 'id' du 3MF est le numéro de slot AMS réel
                            # (1=A1, 2=A2, 3=A3, 4=A4, 5=B1, 6=B2… etc.)
                            # Ne pas utiliser un compteur séquentiel qui casse le mapping multi-AMS
                            raw_id = fil.attrib.get("id")
                            slot_key = int(raw_id) if raw_id and raw_id.isdigit() else _seq
                            result["filaments"][slot_key] = {
                                "slot": slot_key,
                                "tray_info_idx": fil.attrib.get("tray_info_idx", ""),
                                "type":  fil.attrib.get("type", ""),
                                "color": fil.attrib.get("color", ""),
                                "used_g": float(fil.attrib.get("used_g", 0)),
                                "used_m": float(fil.attrib.get("used_m", 0)),
                            }
                            _seq += 1
                        except Exception: pass

            # Vignette
            img_key = f"Metadata/plate_{result['plate_id']}.png"
            candidates = [img_key] + [n for n in names if n.startswith("Metadata/plate_") and n.endswith(".png")]
            for key in candidates:
                if key in names:
                    dest = print_dir / "plate.png"
                    with z.open(key) as src, open(dest, "wb") as dst: dst.write(src.read())
                    result["plate_image"] = f"prints/{print_id}/plate.png"
                    logger.info(f"[3MF-PARSE] ✅ Vignette: {dest}")
                    break

    except zipfile.BadZipFile as e:
        raise Invalid3MF(f"BadZipFile: {e}")
    except Invalid3MF:
        raise
    except Exception as e:
        # Une erreur de parsing n'est pas un succes : on veut un retry.
        raise Invalid3MF(f"parsing impossible : {e}")

    # Un 3MF sans aucun filament consomme n'est pas exploitable : on considere
    # que le fichier etait incomplet et on laisse l'appelant retenter.
    used = sum(1 for f in result["filaments"].values() if float(f.get("used_g") or 0) > 0)
    if used == 0 and strict:
        # Pendant un print, cela signifie que le fichier etait incomplet -> retry.
        # Sur un import manuel (strict=False), c'est le fichier de l'utilisateur :
        # aucun retry n'y changerait rien, on le prend tel quel.
        raise Invalid3MF("aucun filament consommé dans slice_info.config")

    # Sauvegarder le 3MF
    model_name = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{str(uuid.uuid4())[:8]}.3mf"
    (print_dir / model_name).write_bytes(data)
    result["model_3mf"] = f"prints/{print_id}/{model_name}"
    logger.info(
        f"[3MF-PARSE] ✅ titre={result['title']!r} plateau={result['plate_id']} "
        f"durée={result['estimated_seconds']}s filaments={used} 3mf={model_name}"
    )
    return result


async def extract_3mf(url: str, taskname: str, print_id: int,
                       printer_ip: str = "", printer_code: str = "") -> dict:
    """Point d'entrée principal — détecte le type d'URL et dispatch."""
    logger.info(f"extract_3mf url={url[:60]!r} print_id={print_id}")
    logger.info(f"[3MF] ▶ URL={url[:60]!r}")
    try:
        if url.startswith("http"):
            data = await _download_http(url)
        elif url.startswith("ftp://"):
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(None, _download_ftp_sync, taskname, printer_ip, printer_code)
        elif url.startswith("local:"):
            async with aiofiles.open(url[6:], "rb") as f: data = await f.read()
        else:
            raise Invalid3MF(f"URL non reconnue: {url}")
        return _parse_3mf(data, print_id)
    except Invalid3MF:
        raise                      # remonte a l'appelant -> retry
    except Exception as e:
        raise Invalid3MF(f"extract_3mf: {type(e).__name__}: {e}")
