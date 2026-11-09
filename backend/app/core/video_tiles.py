"""La petite version d'une animation, pour les tuiles (09/11/2026).

Une animation de la vue 3D sort en 720 a 1080 px : 2 a 3 Mo pour une tuile de 180 px, sur une page qui en montre
des dizaines. L'original ne sert plus qu'au plein ecran et au partage. ``?tile=1`` (tuiles, vignettes) : une copie
en 320 px (~60-100 Ko, 30 fois moins lourde) ; ``?tile=2`` (le haut d'une fiche) : en 640 px. Elle est faite par
ffmpeg a la premiere demande puis gardee sur disque sous l'empreinte du fichier (taille + date : une animation
refaite donne une nouvelle copie). La transparence est gardee (VP9 avec alpha). En echec (ffmpeg
absent, fichier illisible) : None, l'original est servi. Une seule conversion a la fois : la page qui s'ouvre sur
vingt tuiles ne lance pas vingt ffmpeg.
"""
import hashlib
import json
import logging
import os
import subprocess
import threading
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

TILE_DIR = Path(os.getenv("DATA_DIR", "/data")) / "cache" / "tiles"
SIDES = {1: 320, 2: 640}
_LOCK = threading.Lock()
_FAILED: set = set()             # les fichiers que ffmpeg n'a pas su convertir : pas retentes a chaque tuile


def _probe(src: Path) -> tuple:
    """(codec, transparente) de la video ; ffprobe ne voit l'alpha d'un WebM que par son etiquette alpha_mode."""
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=codec_name:stream_tags=alpha_mode", "-of", "json", str(src)],
                         capture_output=True, timeout=20, check=True).stdout
    st = (json.loads(out or b"{}").get("streams") or [{}])[0]
    return st.get("codec_name") or "", str((st.get("tags") or {}).get("alpha_mode") or (st.get("tags") or {}).get("ALPHA_MODE") or "") == "1"


def tile_video(src: Path, size: int = 1) -> Optional[Path]:
    side = SIDES.get(size, SIDES[1])
    try:
        st = src.stat()
    except OSError:
        return None
    key = hashlib.sha1(f"{src}|{st.st_size}|{int(st.st_mtime)}|{side}".encode()).hexdigest()
    dst = TILE_DIR / key[:2] / f"{key}.webm"
    if dst.is_file():
        return dst
    if key in _FAILED:
        return None
    with _LOCK:
        if dst.is_file():
            return dst
        try:
            codec, alpha = _probe(src)
            # le decodeur libvpx : celui de ffmpeg par defaut ignore la couche alpha d'un WebM
            dec = ["-c:v", "libvpx-vp9"] if codec == "vp9" else ["-c:v", "libvpx"] if codec == "vp8" else []
            dst.parent.mkdir(parents=True, exist_ok=True)
            tmp = dst.with_suffix(".tmp.webm")
            subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *dec, "-i", str(src), "-an",
                            "-vf", f"scale='if(gt(iw,ih),-2,min({side},iw))':'if(gt(iw,ih),min({side},ih),-2)',fps=24",
                            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p" if alpha else "yuv420p",
                            "-b:v", "0", "-crf", "38" if side <= 320 else "36", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4",
                            "-auto-alt-ref", "0", str(tmp)],
                           capture_output=True, timeout=120, check=True)
            if tmp.stat().st_size >= st.st_size:          # rien de gagne : l'original
                tmp.unlink(missing_ok=True)
                _FAILED.add(key)
                return None
            os.replace(tmp, dst)
            log.info(f"[TILE] {src.name} : {st.st_size // 1024} Ko -> {dst.stat().st_size // 1024} Ko")
            return dst
        except Exception as e:
            log.warning(f"[TILE] petite version impossible pour {src.name} : {e}")
            _FAILED.add(key)
            try:
                dst.with_suffix(".tmp.webm").unlink(missing_ok=True)
            except OSError:
                pass
            return None
