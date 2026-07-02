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


def _clean_name(raw: str) -> str:
    name, _ = os.path.splitext(raw)
    name = name.replace("_", " ").replace("–", " ")
    name = re.sub(r"\b(v|rev|final)\d*\b", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+", " ", name).strip()
    return (name[:1].upper() + name[1:]) if name else name


async def _download_http(url: str) -> bytes:
    logger.info(f"[3MF-HTTP] ▶ Téléchargement: {url[:80]}")
    async with aiohttp.ClientSession() as s:
        async with s.get(url, timeout=aiohttp.ClientTimeout(total=60)) as r:
            r.raise_for_status()
            data = await r.read()
            logger.info(f"[3MF-HTTP] ✅ {len(data)} bytes téléchargés")
            return data


def _download_ftp_sync(taskname: str, ip: str, code: str) -> bytes:
    """FTPS — attend que le fichier soit stable avant de télécharger (≡ Spoolnymous)."""
    import pycurl, urllib.parse as _up, io as _io

    def _enc(s):
        return "".join(f"{ord(c):02x}" if c in "/:*|" else c for c in s)

    remote = f"/cache/{_up.quote(_enc(taskname) + '.gcode.3mf')}"
    raw    = f"/cache/{_enc(taskname)}.gcode.3mf"
    url    = f"ftps://{ip}{remote}"
    MDTM   = re.compile(r"(?:^|[\r\n])\s*\d{3}\s+(\d{14})\b", re.IGNORECASE)

    def mk():
        c = pycurl.Curl()
        for opt, val in [
            (c.URL, url), (c.USERPWD, f"bblp:{code}"),
            (c.SSL_VERIFYPEER, 0), (c.SSL_VERIFYHOST, 0),
            (c.FTP_SSL, c.FTPSSL_ALL), (c.FTPSSLAUTH, c.FTPAUTH_TLS),
            (c.FTP_FILEMETHOD, c.FTPMETHOD_NOCWD),
            (c.CONNECTTIMEOUT, 10), (c.TIMEOUT, 5), (c.NOBODY, True),
        ]: c.setopt(opt, val)
        return c

    c = mk(); start = time.time(); last = None; stable = 0
    try:
        while time.time() - start < 240:
            size = None
            try:
                c.perform()
                cl = int(c.getinfo(c.CONTENT_LENGTH_DOWNLOAD))
                size = cl if cl >= 0 else None
            except Exception: pass

            buf = []
            c.setopt(c.VERBOSE, True)
            c.setopt(c.DEBUGFUNCTION, lambda t, m: buf.append(m.decode("latin1", "ignore")))
            c.setopt(c.QUOTE, [f"MDTM {raw}".encode()])
            try: c.perform()
            except Exception: pass
            finally:
                c.setopt(c.QUOTE, []); c.setopt(c.VERBOSE, False)
                c.setopt(c.DEBUGFUNCTION, lambda *a: None)

            m = MDTM.search("".join(buf)); mtime = None
            if m:
                try:
                    dt = datetime.strptime(m.group(1)[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                    mtime = int(dt.timestamp())
                except Exception: pass

            now_utc = int(datetime.now(timezone.utc).timestamp())
            fresh = mtime and 0 <= (now_utc - mtime) <= 60
            sig = (size or -1, mtime or -1)
            if size and size > 0 and fresh:
                stable = (stable + 1) if sig == last else 1
                last = sig
                if stable >= 3: break
            else:
                last = sig; stable = 0
            time.sleep(5)
        else:
            raise TimeoutError("Timeout 240s: fichier FTP non disponible")

        c.setopt(c.NOBODY, False); c.setopt(c.TIMEOUT, 0)
        out = _io.BytesIO()
        c.setopt(c.WRITEFUNCTION, out.write)
        c.perform()
        return out.getvalue()
    finally:
        try: c.close()
        except Exception: pass


def _parse_3mf(data: bytes, print_id: int) -> dict:
    """Parse le 3MF, sauvegarde vignette + fichier, retourne les métadonnées."""
    result = {
        "title": "", "file": "", "plate_id": "1",
        "estimated_seconds": 0, "filaments": {},
        "plate_image": None, "model_3mf": None, "design_id": "",
    }
    print_dir = DATA_DIR / "prints" / str(print_id)
    logger.info(f"[3MF-PARSE] ▶ Parsing {len(data)} bytes, print_id={print_id}")
    print_dir.mkdir(parents=True, exist_ok=True)

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
                    break
                    logger.info(f"[3MF-PARSE] ✅ Vignette: {dest}")

    except zipfile.BadZipFile: logger.error("3MF BadZipFile")
    except Exception as e: logger.error(f"_parse_3mf: {e}")

    # Sauvegarder le 3MF
    model_name = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{str(uuid.uuid4())[:8]}.3mf"
    (print_dir / model_name).write_bytes(data)
    result["model_3mf"] = f"prints/{print_id}/{model_name}"
    logger.info(f"[3MF-PARSE] ✅ 3MF sauvegardé: {model_name}")
    return result
    logger.info(f"[3MF-PARSE] ✅ titre={result['title']!r} plateau={result['plate_id']} durée={result['estimated_seconds']}s filaments={len(result['filaments'])}")


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
            logger.warning(f"URL non reconnue: {url}"); return {}
        return _parse_3mf(data, print_id)
    except Exception as e:
        logger.error(f"extract_3mf failed: {e}"); return {}
