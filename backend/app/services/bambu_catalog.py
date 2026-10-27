"""
Synchronisation du catalogue filaments Bambu Lab.
- filaments_color_codes.json  : fila_id + color_code → nom couleur, hex, type.
  Source officielle : le nuancier de Bambu Studio (depot bambulab/BambuStudio,
  tenu par Bambu Lab). A defaut, la copie du depot communautaire
  m0h31h31/3DPrint-Filament-RFID-Tool (meme format, en retard sur l'officiel).
- filaments_type_mapping.json : type détaillé → famille (PLA/PETG/ABS...), du
  depot communautaire. Bambu Studio n'en publie pas : la famille se DEDUIT du
  type (« PLA Basic » → PLA) et ce fichier ne sert qu'en secours.
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
OFFICIAL_RAW = "https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL/filament"
FILAMENTS_URL   = f"{OFFICIAL_RAW}/filaments_color_codes.json"
FILAMENTS_FALLBACK_URL = f"{BASE_RAW}/filaments_color_codes.json"
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
            if fname == FILAMENTS_FILE and not (isinstance(data, dict) and isinstance(data.get("data"), list)
                                                and data["data"]):
                raise ValueError("pas de liste « data »")
            if fname == FILAMENTS_FILE:
                # l'officiel ecrit parfois les couleurs en minuscules (#6e88bcFF) :
                # en majuscules, comme la copie communautaire qu'on lisait avant
                for e in data["data"]:
                    if isinstance(e, dict) and isinstance(e.get("fila_color"), list):
                        e["fila_color"] = [c.upper() if isinstance(c, str) else c for c in e["fila_color"]]
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
        if st_fil not in (200, 304) and not os.path.exists(os.path.join(self.catalog_dir, FILAMENTS_FILE)):
            # source officielle injoignable ou deplacee, et rien en local : la
            # copie communautaire (une copie officielle deja la est gardee)
            log.warning(f"[CATALOG] source officielle en échec ({st_fil}), copie communautaire")
            w_fil, st_fil = self._fetch(FILAMENTS_FALLBACK_URL, FILAMENTS_FILE)
        w_typ, st_typ = self._fetch(TYPE_MAP_URL,  TYPE_MAP_FILE)
        log.info(f"[CATALOG] Sync terminée en {time.time()-t0:.1f}s "
                 f"(filaments={'maj' if w_fil else 'ok'}, types={'maj' if w_typ else 'ok'})")
        return {"filaments": w_fil, "types": w_typ, "status": {"filaments": st_fil, "types": st_typ}}

    def run_periodic(self) -> None:
        from ..core import tasks as _tasks
        log.info(f"[CATALOG] Démarrage BambuCatalogSync (dir={self.catalog_dir}, interval={self.interval_sec}s)")
        _tasks.start("catalog")
        try:
            self.sync_once()
        except Exception:
            _tasks.error("catalog")
            log.exception("[CATALOG] Sync initiale échouée")
        _tasks.waiting("catalog", self.interval_sec)
        while not self._stop_evt.wait(self.interval_sec):
            _tasks.start("catalog")
            try:
                self.sync_once()
            except Exception:
                _tasks.error("catalog")
                log.exception("[CATALOG] Sync périodique échouée")
            _tasks.waiting("catalog", self.interval_sec)
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
        Retourne {name, name_en, name_fr, type, color_hex, colors, color_code, fila_id,
                  fila_color_code, color_type, color_type_fr} ou None.
        FR fallback : si l'entrée n'a pas de nom FR, cherche un autre enregistrement
        du catalogue qui a le même nom EN et une traduction FR.
        """
        path = os.path.join(self.catalog_dir, FILAMENTS_FILE)
        if not os.path.exists(path):
            return None
        try:
            data = json.loads(open(path, encoding="utf-8").read())
        except Exception:
            return None

        entries = data.get("data", [])
        fila_id    = (fila_id or "").strip().upper()
        color_code = _normalize_color_code(color_code)

        COLOR_TYPE_FR = {"单色": "monochrome", "渐变色": "gradient", "多拼色": "coaxial"}

        # Pré-construire un dict en→fr à partir de toutes les entrées qui ont les deux
        en_to_fr: dict = {}
        for e in entries:
            n = e.get("fila_color_name", {})
            en, fr = n.get("en", ""), n.get("fr", "")
            if en and fr:
                en_to_fr[en] = fr

        for entry in entries:
            if entry.get("fila_id", "").upper() != fila_id:
                continue
            if _normalize_color_code(entry.get("color_code", "")) != color_code:
                continue
            names   = entry.get("fila_color_name", {})
            name_en = names.get("en") or names.get("fr") or next(iter(names.values()), "")
            name_fr = names.get("fr") or en_to_fr.get(name_en, "") or name_en
            name    = name_fr if lang == "fr" else name_en
            colors  = entry.get("fila_color", [])
            ctype   = entry.get("fila_color_type", "")
            return {
                "name":            name,
                "name_en":         name_en,
                "name_fr":         name_fr,
                "type":            entry.get("fila_type", ""),
                "color_hex":       (colors[0].lstrip("#")[:8] if colors else ""),
                "colors":          [c.lstrip("#")[:8] for c in colors],
                "color_code":      entry.get("color_code", ""),
                "fila_id":         fila_id,
                "fila_color_code": entry.get("fila_color_code", ""),
                "color_type":      ctype,
                "color_type_fr":   COLOR_TYPE_FR.get(ctype, ctype),
            }
        return None

    def _fallback_mapping(self) -> dict:
        path = os.path.join(self.catalog_dir, TYPE_MAP_FILE)
        try:
            d = json.loads(open(path, encoding="utf-8").read())
        except Exception:
            return {}
        return d if isinstance(d, dict) else {}

    def type_mapping(self) -> dict:
        """Famille → types détaillés ({"PLA": ["PLA Basic", …]}), pour tous les
        types du catalogue : famille deduite du nom du type, le fichier
        communautaire en secours quand la deduction ne reconnait rien."""
        path = os.path.join(self.catalog_dir, FILAMENTS_FILE)
        try:
            entries = json.loads(open(path, encoding="utf-8").read()).get("data", [])
        except Exception:
            entries = []
        fallback = self._fallback_mapping()
        known = {_norm_type(t): fam for fam, ts in fallback.items() if isinstance(ts, list) for t in ts}
        out: dict = {}
        for t in sorted({e.get("fila_type", "") for e in entries if isinstance(e, dict)} - {""}):
            fam = family_of(t) or known.get(_norm_type(t)) or t.split()[0]
            out.setdefault(fam, []).append(t)
        if not out:                       # catalogue absent : le secours tel quel
            return fallback
        return out

    def type_to_family(self) -> dict:
        """type détaillé (minuscules) → famille."""
        return {t.lower(): fam for fam, ts in self.type_mapping().items() for t in ts}


# Familles reconnues dans le nom d'un type Bambu (« PETG HF » → PETG,
# « PA6-CF » → PA, « Support for PLA/PETG » → Support).
FAMILIES = ("PLA", "PETG", "PET", "ABS", "ASA", "PA", "PC", "PPA", "PPS", "PVA", "TPU", "HIPS", "PEEK", "PEI")
_FAMILY_ALIASES = {"PA6": "PA", "PA12": "PA", "PAHT": "PA", "PA11": "PA"}


def _norm_type(t: str) -> str:
    import re
    return re.sub(r"[\s\-_/]+", " ", (t or "").strip().lower())


def family_of(fila_type: str) -> Optional[str]:
    """Famille deduite du type détaillé, ou None si rien n'est reconnu."""
    import re
    t = (fila_type or "").strip()
    if not t:
        return None
    if t.lower().startswith("support"):
        return "Support"
    head = re.split(r"[\s\-_/+]+", t)[0].upper()
    head = _FAMILY_ALIASES.get(head, head)
    return head if head in FAMILIES else None


def _normalize_color_code(raw: str) -> str:
    """Ex: 'W01' → 'W1', 'Y4' → 'Y4', 'A0' → 'A0'."""
    import re
    raw = (raw or "").strip().upper()
    m = re.match(r'^([A-Z]+)(\d+)$', raw)
    if not m:
        return raw
    prefix, digits = m.group(1), m.group(2)
    return prefix + str(int(digits))   # strip leading zeros
