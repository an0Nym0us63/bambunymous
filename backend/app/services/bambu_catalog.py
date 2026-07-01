"""
Synchronisation du catalogue filaments Bambu Lab.
Source : repo public m0h31h31/3DPrint-Filament-RFID-Tool (assets APK).
- filaments_color_codes.json  : fila_id + color_code → nom couleur, hex, type
- filaments_type_mapping.json : type détaillé → famille (PLA/PETG/ABS...)
Téléchargés au démarrage, re-vérifiés toutes les 24h via ETag.
Stockés dans DATA_DIR/bambu_catalog/.
"""
from __future__ import annotations
import os, json, time, hashlib, threading, logging
from typing import Optional, Tuple
import urllib.request
import urllib.error

log = logging.getLogger(__name__)

BASE_RAW = "https://raw.githubusercontent.com/m0h31h31/3DPrint-Filament-RFID-Tool/master/app/src/main/assets"
FILAMENTS_URL   = f"{BASE_RAW}/filaments_color_codes.json"
TYPE_MAP_URL    = f"{BASE_RAW}/filaments_type_mapping.json"
FILAMENTS_FILE  = "filaments_color_codes.json"
TYPE_MAP_FILE   = "filaments_type_mapping.json"
INTERVAL_SEC    = 86400  # 24h
TIMEOUT_SEC     = 20
USER_AGENT      = "BambuNymous-CatalogSync/1.0"


class BambuCatalogSync:
    def __init__(self, data_dir: str, interval_sec: int = INTERVAL_SEC) -> None:
        self.catalog_dir = os.path.join(data_dir, "bambu_catalog")
        self.interval_sec = interval_sec
        self._stop_evt = threading.Event()
        os.makedirs(self.catalog_dir, exist_ok=True)

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _etag_path(self, fname: str) -> str:
        return os.path.join(self.catalog_dir, fname + ".etag")

    def _load_etag(self, fname: str) -> Optional[str]:
        try:
            return open(self._etag_path(fname)).read().strip() or None
        except FileNotFoundError:
            return None

    def _save_etag(self, fname: str, etag: Optional[str]) -> None:
        if etag:
            open(self._etag_path(fname), "w").write(etag)

    def _write_if_changed(self, fname: str, content: bytes) -> bool:
        path = os.path.join(self.catalog_dir, fname)
        new_hash = hashlib.sha256(content).hexdigest()
        hash_path = path + ".sha256"
        try:
            old_hash = open(hash_path).read().strip()
        except FileNotFoundError:
            old_hash = None
        if new_hash == old_hash:
            return False
        tmp = path + ".tmp"
        open(tmp, "wb").write(content)
        os.replace(tmp, path)
        open(hash_path, "w").write(new_hash)
        return True

    # ── Fetch ─────────────────────────────────────────────────────────────

    def _fetch(self, url: str, fname: str) -> Tuple[bool, int]:
        req_headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        etag = self._load_etag(fname)
        if etag:
            req_headers["If-None-Match"] = etag
        try:
            request = urllib.request.Request(url, headers=req_headers)
            try:
                raw = urllib.request.urlopen(request, timeout=TIMEOUT_SEC)
                status = raw.status
                etag_resp = raw.headers.get("ETag") or raw.headers.get("etag")
                body = raw.read()
            except urllib.error.HTTPError as e:
                if e.code == 304:
                    log.info(f"[CATALOG] {fname} inchangé (304)")
                    return False, 304
                log.warning(f"[CATALOG] HTTP {e.code} pour {fname}")
                return False, e.code
        except Exception as e:
            log.warning(f"[CATALOG] Erreur réseau {fname}: {e}")
            return False, 0

        try:
            data = json.loads(body)
            pretty = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        except Exception as e:
            log.warning(f"[CATALOG] JSON invalide pour {fname}: {e}")
            return False, status

        written = self._write_if_changed(fname, pretty)
        self._save_etag(fname, etag_resp)
        if written:
            log.info(f"[CATALOG] {fname} mis à jour ({len(pretty)} octets)")
        else:
            log.info(f"[CATALOG] {fname} identique (hash inchangé)")
        return written, status

    # ── Public ─────────────────────────────────────────────────────────────

    def sync_once(self) -> dict:
        t0 = time.time()
        w_fil, st_fil = self._fetch(FILAMENTS_URL, FILAMENTS_FILE)
        w_typ, st_typ = self._fetch(TYPE_MAP_URL,  TYPE_MAP_FILE)
        log.info(f"[CATALOG] Sync terminée en {time.time()-t0:.1f}s "
                 f"(filaments={'maj' if w_fil else 'ok'}, types={'maj' if w_typ else 'ok'})")
        return {"filaments": w_fil, "types": w_typ, "status": {"filaments": st_fil, "types": st_typ}}

    def run_periodic(self) -> None:
        log.info(f"[CATALOG] Démarrage BambuCatalogSync (dir={self.catalog_dir}, interval={self.interval_sec}s)")
        try:
            self.sync_once()
        except Exception:
            log.exception("[CATALOG] Sync initiale échouée")
        while not self._stop_evt.wait(self.interval_sec):
            try:
                self.sync_once()
            except Exception:
                log.exception("[CATALOG] Sync périodique échouée")
        log.info("[CATALOG] Arrêt BambuCatalogSync.")

    def start(self) -> threading.Thread:
        t = threading.Thread(target=self.run_periodic, name="BambuCatalogSync", daemon=True)
        t.start()
        return t

    def stop(self) -> None:
        self._stop_evt.set()

    # ── Lookup (utilisable depuis spool_matcher ou le frontend) ────────────

    def lookup(self, fila_id: str, color_code: str, lang: str = "fr") -> Optional[dict]:
        """
        Cherche un filament par fila_id (ex: GFA00) et color_code (ex: Y1 ou W1).
        Retourne {name, type, color_hex, color_code, fila_id} ou None.
        """
        path = os.path.join(self.catalog_dir, FILAMENTS_FILE)
        if not os.path.exists(path):
            return None
        try:
            data = json.loads(open(path).read())
        except Exception:
            return None

        fila_id    = (fila_id or "").strip().upper()
        color_code = _normalize_color_code(color_code)

        COLOR_TYPE_FR = {"单色": "monochrome", "渐变色": "gradient", "多拼色": "coaxial"}

        for entry in data.get("data", []):
            if entry.get("fila_id", "").upper() != fila_id:
                continue
            if _normalize_color_code(entry.get("color_code", "")) != color_code:
                continue
            names = entry.get("fila_color_name", {})
            name    = names.get(lang) or names.get("en") or names.get("fr") or next(iter(names.values()), "")
            name_en = names.get("en") or names.get("fr") or next(iter(names.values()), "")
            colors = entry.get("fila_color", [])
            ctype  = entry.get("fila_color_type", "")
            return {
                "name":           name,
                "name_en":        name_en,
                "type":           entry.get("fila_type", ""),
                "color_hex":      (colors[0].lstrip("#")[:6] if colors else ""),
                "colors":         [c.lstrip("#")[:6] for c in colors],
                "color_code":     entry.get("color_code", ""),
                "fila_id":        fila_id,
                "fila_color_code": entry.get("fila_color_code", ""),
                "color_type":     ctype,
                "color_type_fr":  COLOR_TYPE_FR.get(ctype, ctype),
            }
        return None

    def type_mapping(self) -> dict:
        """Retourne le mapping type_détaillé → famille (PLA, PETG…)."""
        path = os.path.join(self.catalog_dir, TYPE_MAP_FILE)
        if not os.path.exists(path):
            return {}
        try:
            return json.loads(open(path).read())
        except Exception:
            return {}


def _normalize_color_code(raw: str) -> str:
    """Ex: 'W01' → 'W1', 'Y4' → 'Y4', 'A0' → 'A0'."""
    import re
    raw = (raw or "").strip().upper()
    m = re.match(r'^([A-Z]+)(\d+)$', raw)
    if not m:
        return raw
    prefix, digits = m.group(1), m.group(2)
    return prefix + str(int(digits))   # strip leading zeros
