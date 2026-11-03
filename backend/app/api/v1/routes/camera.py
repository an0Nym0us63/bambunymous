"""
Proxy caméra Bambu Lab — supporte RTSP (X1/H2D) et TLS:6000 (P1S/A1/A1 Mini).
Détection automatique par modèle imprimante.
"""
import time, logging, asyncio, subprocess, socket, ssl, struct
from collections import deque
import threading
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response, StreamingResponse
from ....services.settings_service import get_setting
from ....db.session import AsyncSessionLocal
from ....core.mqtt import get_state

router = APIRouter()
logger = logging.getLogger(__name__)

_TIMEOUT = 10.0


# ── Flux continu (22/10/2026) ────────────────────────────────────────────────
# Une seule connexion a la camera tant que quelqu'un regarde, partagee par tous
# les spectateurs : ffmpeg reste ouvert sur le RTSP (X1/H2), la socket TLS:6000
# reste ouverte (P1/A1). La derniere image sert aussi aux captures ponctuelles.
# Plus personne depuis 10 s : la connexion se ferme.
_STREAM_FPS = 8
_IDLE_STOP = 10.0
_STALL_S = 8.0
_START_S = 20.0


def _end_ffmpeg(proc) -> None:
    """Arreter ffmpeg proprement (03/11/2026) : un kill net ne laisse pas ffmpeg fermer la session RTSP (TEARDOWN) ;
    l'imprimante la garde ouverte un moment, et apres quelques blocages suivis de reconnexions, son serveur video
    plein ne repondait plus du tout (« Connection timed out » sur le port 322, chez un copain). Sur SIGTERM ffmpeg
    ferme son entree, donc la session ; kill seulement s'il ne s'est pas arrete en 3 s."""
    if proc is None or proc.poll() is not None:
        return
    try:
        proc.terminate()
    except Exception:
        return

    def finish():
        try:
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    threading.Thread(target=finish, name="camera-ffmpeg-stop", daemon=True).start()


class _Hub:
    def __init__(self):
        self.lock = threading.Lock()
        self.frame = None
        self.seq = 0
        self.ts = 0.0
        self.subs = 0
        self.idle_since = time.monotonic()
        self.thread = None
        self.retry_at = 0.0
        self.fails = 0
        self.pulled = 0.0            # la derniere demande d'une image tiree (/frame)
        self.pullers = {}            # qui tire, et quand (le nombre de spectateurs des travaux)
        # le releve (/stats, 02/11/2026) : la cadence reellement produite, les demarrages, la derniere erreur
        self.times = deque(maxlen=120)
        self.starts = 0
        self.started_at = 0.0
        self.method = ""
        self.err = ""
        self.err_at = 0.0
        self.ff_log = deque(maxlen=8)
        self.proc = None             # le ffmpeg du direct (RTSP), pour l'arreter s'il se fige
        self.socket = None           # la socket du direct (TLS:6000), idem
        self.stalls = 0
        # la methode qui a deja donne des images (02/11/2026) : un modele non reconnu (mode « both ») essayait aussi la
        # connexion des P1/A1 apres chaque blocage d'une X1/H2, en vain, et c'est son erreur qui restait
        self.good = None
        self.stall_times = deque(maxlen=10)

    def unstick(self) -> None:
        """Le direct se fige sans erreur (02/11/2026 : plus une image depuis 33 s, ffmpeg vivant, le serveur attendait
        indefiniment et seul un redemarrage le relancait) : au-dela de STALL_S sans image, la connexion est coupee ;
        le producteur s'arrete sur une erreur et repart."""
        with self.lock:
            now = time.monotonic()
            if self.thread is None:
                return
            # au demarrage, la premiere image peut tarder (connexion RTSP, image cle) : 20 s avant de couper
            if self.ts < self.started_at:
                if now - self.started_at < _START_S:
                    return
            elif now - self.ts < _STALL_S:
                return
            proc, sock = self.proc, self.socket
            self.started_at = now                  # une seule coupure par blocage
            self.stalls += 1
            self.stall_times.append(now)
        logger.info("Camera flux : fige, connexion coupee")
        try:
            _end_ffmpeg(proc)
            if sock:
                sock.close()
        except Exception:
            pass

    def stop(self) -> bool:
        with self.lock:
            now = time.monotonic()
            return self.subs == 0 and now - self.idle_since > _IDLE_STOP and now - self.pulled > _IDLE_STOP

    def viewers(self) -> int:
        with self.lock:
            now = time.monotonic()
            self.pullers = {k: t for k, t in self.pullers.items() if now - t < _IDLE_STOP}
            return self.subs + len(self.pullers)

    def put(self, jpg: bytes) -> None:
        with self.lock:
            self.frame, self.ts = jpg, time.monotonic()
            self.seq += 1
            self.fails = 0
            self.times.append(self.ts)


_HUB = _Hub()


def _rtsp_frames(ip: str, code: str, stop):
    url = f"rtsps://bblp:{code}@{ip}:322/streaming/live/1"
    # la commande d'origine (02/11/2026 : des options de faible latence essayees ce jour ont coupe le direct)
    proc = subprocess.Popen(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
                             "-i", url, "-an", "-r", str(_STREAM_FPS), "-f", "image2pipe", "-vcodec", "mjpeg",
                             "-q:v", "6", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _HUB.proc = proc

    def errors():                  # ce que dit ffmpeg, garde pour le releve (sans le code d'acces)
        for line in iter(proc.stderr.readline, b""):
            _HUB.ff_log.append(line.decode("utf-8", "ignore").strip().replace(code, "***")[:300])
    threading.Thread(target=errors, name="camera-ffmpeg-log", daemon=True).start()
    buf = b""
    try:
        while not stop():
            chunk = proc.stdout.read1(65536) if hasattr(proc.stdout, "read1") else proc.stdout.read(65536)
            if not chunk:
                raise RuntimeError("ffmpeg : flux termine")
            buf += chunk
            while True:
                a = buf.find(b"\xff\xd8")
                b = buf.find(b"\xff\xd9", a + 2) if a >= 0 else -1
                if a < 0 or b < 0:
                    if a > 0:
                        buf = buf[a:]
                    break
                yield buf[a:b + 2]
                buf = buf[b + 2:]
    finally:
        _HUB.proc = None
        _end_ffmpeg(proc)


def _tls_frames(ip: str, code: str, stop):
    auth = bytearray()
    auth += struct.pack("<I", 0x40) + struct.pack("<I", 0x3000) + struct.pack("<I", 0) + struct.pack("<I", 0)
    for ch in "bblp".ljust(32, "\x00"):
        auth += ch.encode("ascii")
    for ch in code.ljust(32, "\x00"):
        auth += ch.encode("ascii")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    sock = socket.create_connection((ip, 6000), timeout=_TIMEOUT)
    try:
        with ctx.wrap_socket(sock, server_hostname=ip) as ss:
            _HUB.socket = ss
            ss.settimeout(_TIMEOUT)
            ss.sendall(auth)
            buf, size = bytearray(), None
            while not stop():
                try:
                    chunk = ss.recv(65536)
                except ssl.SSLWantReadError:
                    time.sleep(0.02)
                    continue
                if not chunk:
                    raise RuntimeError("TLS6000 : flux termine")
                buf += chunk
                while True:
                    if size is None:
                        if len(buf) < 16:
                            break
                        size = int.from_bytes(buf[0:4], "little")
                        buf = buf[16:]
                    if len(buf) < size:
                        break
                    jpg, buf, size = bytes(buf[:size]), buf[size:], None
                    if jpg[:2] == b"\xff\xd8":
                        yield jpg if jpg[-2:] == b"\xff\xd9" else jpg + b"\xff\xd9"
    finally:
        _HUB.socket = None
        try:
            sock.close()
        except Exception:
            pass


def _produce(ip: str, code: str, mode: str) -> None:
    order = (["rtsp"] if mode == "rtsp" else ["tls"] if mode == "tls" else [_HUB.good] if _HUB.good else ["rtsp", "tls"])
    err = None
    for m in order:
        with _HUB.lock:
            _HUB.starts += 1
            _HUB.started_at, _HUB.method = time.monotonic(), m
        try:
            gen = _rtsp_frames(ip, code, _HUB.stop) if m == "rtsp" else _tls_frames(ip, code, _HUB.stop)
            for jpg in gen:
                _HUB.put(jpg)
                if _HUB.good != m:
                    _HUB.good = m
            err = None
            break                                  # plus personne : arret normal
        except Exception as e:
            err = e
            with _HUB.lock:
                _HUB.err, _HUB.err_at = f"{m} : {e}".replace(code, "***")[:300], time.monotonic()
            logger.info(f"Camera flux {m}: {e}")
    with _HUB.lock:
        _HUB.thread = None
        if err:
            _HUB.fails = min(_HUB.fails + 1, 6)
            _HUB.retry_at = time.monotonic() + min(5 * 2 ** (_HUB.fails - 1), 60)
            if _HUB.ts and _HUB.ts > _HUB.started_at - 60:     # il donnait des images il y a peu : on repart vite
                # ... mais pas en boucle (02/11/2026) : une imprimante dont le serveur ne suit pas se figeait toutes les
                # quelques secondes, et chaque reconnexion immediate finissait par faire tomber sa vue en direct (alerte
                # HMS « impossible d'obtenir la liveview »). 03/11/2026 : 5 s au premier blocage (le temps que l'imprimante
                # libere la session coupee), puis 10, 20, 30, 60 s s'ils se suivent.
                now = time.monotonic()
                n = len([t for t in _HUB.stall_times if now - t < 300])
                _HUB.retry_at = now + (5, 5, 10, 20, 30, 60)[min(n, 5)]


def _ensure_producer(ip: str, code: str, mode: str) -> None:
    with _HUB.lock:
        if _HUB.thread is not None or time.monotonic() < _HUB.retry_at:
            return
        _HUB.thread = threading.Thread(target=_produce, args=(ip, code, mode), name="camera-flux", daemon=True)
        _HUB.thread.start()


# Codes Bambu Lab → méthode caméra
_BAMBU_CODES = {
    "BL-P001": "rtsp",  # X1 Carbon
    "BL-P002": "rtsp",  # X1
    "C11": "rtsp",      # X1 Carbon alt
    "C12": "rtsp",      # H2D
    "C13": "tls",       # P1S
    "C21": "tls",       # A1
    "C20": "tls",       # A1 Mini
    "C24": "tls",       # P1P → None (pas de camera)
}

def _select_grab(model: str, model_id: str = ""):
    """Retourne la méthode de capture adaptée au modèle."""
    mid = (model_id or "").upper()
    if mid and mid.startswith("C24"):  # P1P
        return None
    if mid in _BAMBU_CODES:
        return _BAMBU_CODES[mid]
    m = (model or "").upper()
    if "P1P" in m:
        return None
    if any(x in m for x in ["H2D", "H2C", "X1", "X1C", "X1 CARBON", "X1E"]):
        return "rtsp"
    if any(x in m for x in ["P1S", "A1", "A1 MINI", "A1M"]):
        return "tls"
    return "both"


# Une seule connexion a la camera (02/11/2026). Les captures (secours de la page, partage, cliches des etapes d'une
# impression) ouvraient chacune leur ffmpeg pendant que celui du direct tournait : l'imprimante supporte mal deux
# connexions, le direct se figeait (plus une image depuis 33 s), et chaque capture de secours en rouvrait une autre.
# Desormais une capture prend l'image du direct : elle le demarre au besoin (il s'arrete seul 10 s apres) ; une
# capture a part n'est tentee que si le direct ne peut pas tourner (en attente apres des echecs).
async def _hub_wait(ip: str, code: str, mode: str, wait: float = 10.0):
    end = time.monotonic() + wait
    while True:
        with _HUB.lock:
            _HUB.pulled = time.monotonic()
            fr, ts, alive, retry = _HUB.frame, _HUB.ts, _HUB.thread is not None, _HUB.retry_at
        if fr and time.monotonic() - ts < 3:
            return fr
        if time.monotonic() > end or (not alive and time.monotonic() < retry):
            return None
        if alive:
            _HUB.unstick()
        else:
            _ensure_producer(ip, code, mode)
        await asyncio.sleep(0.05)


async def grab_jpeg() -> bytes:
    """Une image de la camera, par la connexion du direct (cliches des etapes d'une impression)."""
    ip, code, model, model_id = await _printer_conf()
    if not ip or not code:
        raise RuntimeError("camera non configuree")
    r = await _serve(ip, code, model, model_id)
    if r.status_code != 200:
        raise RuntimeError(r.body.decode("utf-8", "ignore")[:200] or f"HTTP {r.status_code}")
    if r.headers.get("X-Camera-Status") == "stale":       # une vieille image ne vaut pas une photo d'etape
        raise RuntimeError("camera muette (seule une ancienne image)")
    return r.body


async def _serve(ip: str, code: str, model: str, model_id: str = "", fresh: bool = False) -> Response:
    now = time.monotonic()
    # un flux tourne : sa derniere image, sans relancer de capture
    with _HUB.lock:
        if _HUB.frame and now - _HUB.ts < 3:
            return Response(_HUB.frame, media_type="image/jpeg",
                            headers={"Cache-Control": "no-store", "X-Camera-Status": "ok-stream"})
    mode = _select_grab(model, model_id)
    if mode is None:
        return Response(status_code=503, content=b"Pas de camera chambre sur ce modele")
    fr = await _hub_wait(ip, code, mode)
    if fr:
        return Response(fr, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Camera-Status": "ok-stream"})
    # Rien du direct (02/11/2026) : sa derniere image si elle a moins de 5 min, sinon « muette ». Jamais de seconde
    # connexion a cote : une capture a part (son propre ffmpeg) s'ouvrait quand le direct n'avait pas encore donne
    # d'image ; sur un reseau qui hoquette, ces connexions en plus finissaient par faire tomber la vue en direct de
    # l'imprimante (alerte HMS « impossible d'obtenir la liveview »).
    # fresh (03/11/2026) : la camera de la page ne veut que du frais ; une ancienne image laissait croire un moment
    # que tout allait bien, avant « injoignable »
    with _HUB.lock:
        fr, ts = _HUB.frame, _HUB.ts
    if fr and time.monotonic() - ts < 300 and not fresh:
        return Response(fr, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Camera-Status": "stale"})
    return Response(status_code=503, content=(_HUB.err or "camera muette").encode())


# Le temps de camera regardee (succes) : une seule horloge pour tout ce qui montre la camera (le flux
# continu ou les captures qui se rafraichissent), qui compte le temps reel une seule fois meme si
# plusieurs ecrans la montrent. Credite au fil de l'eau (toutes les 30 s) : avant, le flux ne creditait
# qu'a sa fin, et l'enregistrement etait annule avec lui a la fermeture de la page ; les captures ne
# comptaient pas du tout. Un copain qui regarde par le relais ne compte pas.
WATCH_GAP = 15.0        # au-dela, l'ecran ne regardait plus : le trou ne compte pas
WATCH_FLUSH = 30.0
_WATCH = {"last": None, "pending": 0.0}


def _printing_here() -> bool:
    try:
        return str(getattr(get_state(), "status", "") or "").upper() in ("RUNNING", "PAUSE", "PAUSED", "PREPARE")
    except Exception:
        return False


def _watch_tick(request: Request | None = None, printing: bool | None = None):
    """Une image de camera montree. Ne compte que pendant une vraie impression (la mienne, ou
    celle du copain qu'on regarde : « printing » le dit) ; hors impression, l'horloge s'arrete."""
    if request is not None:
        auth = request.headers.get("authorization") or ""
        tok = auth.split(" ", 1)[1].strip() if auth.lower().startswith("bearer ") else request.query_params.get("_t", "")
        if tok.startswith("fk_"):
            return
    if not (_printing_here() if printing is None else printing):
        _WATCH["last"] = None
        return
    now = time.monotonic()
    last = _WATCH["last"]
    _WATCH["last"] = now
    if last is not None and 0 < now - last <= WATCH_GAP:
        _WATCH["pending"] += now - last
    if _WATCH["pending"] >= WATCH_FLUSH:
        sec, _WATCH["pending"] = _WATCH["pending"], 0.0
        try:
            from ....services import home_stats
            asyncio.get_running_loop().create_task(home_stats.camera_watched(sec))
        except Exception:
            logger.debug("camera : temps regarde non compte")


@router.get("/snapshot")
async def camera_snapshot(request: Request, fresh: int = 0):
    ip, code, model, model_id = await _printer_conf()
    if not ip or not code:
        return Response(status_code=503, content=b"non configure")
    r = await _serve(ip, code, model, model_id, fresh=bool(fresh))
    if r.status_code == 200:
        _watch_tick(request)                 # le temps regarde : seulement une vraie image montree
    return r


async def _printer_conf():
    async with AsyncSessionLocal() as db:
        ip = await get_setting(db, "PRINTER_IP")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")
    try:
        st = get_state()
        model, model_id = getattr(st, "printer_model", "") or "", getattr(st, "model_id", "") or ""
    except Exception:
        model = model_id = ""
    if not model:
        # l'etat MQTT ne porte pas le nom du modele (03/11/2026 : toujours vide, la camera essayait les deux methodes) :
        # celui de l'appli (Parametres, sinon numero de serie, sinon historique), garde 5 min
        try:
            from .printer import _model
            model = await _model() or ""
        except Exception:
            pass
    return ip, code, model, model_id


# Le direct tire image par image (02/11/2026) : la page demande l'image suivante des qu'elle a recu la precedente.
# Le flux MJPEG poussait les images dans un tuyau ou elles s'empilaient (tampons du systeme, proxy) : sur une liaison
# lente, le retard grandissait jusqu'a une image toutes les quelques secondes, et seul un onglet rouvert le remettait a
# zero ; le relais copain, lui, ne transporte pas de flux. Ici la cadence suit d'elle-meme ce que la liaison laisse
# passer (8 images/s sur le wifi, moins en 4G ou par le relais), toujours l'image la plus recente, jamais de retard
# accumule. La source ne change pas : la connexion a la camera reste ouverte sur le serveur (_HUB), pas de capture
# relancee a chaque image.
_PULL_WAIT = 4.0


@router.get("/frame")
async def camera_frame(request: Request, after: int = 0, v: str = ""):
    """La premiere image plus recente que « after » (le numero rendu par X-Seq), attendue au plus 4 s (204 sinon)."""
    ip, code, model, model_id = await _printer_conf()
    if not ip or not code:
        return Response(status_code=503, content=b"non configure")
    mode = _select_grab(model, model_id)
    if mode is None:
        return Response(status_code=503, content=b"Pas de camera chambre sur ce modele")

    def touch():
        with _HUB.lock:
            _HUB.pulled = time.monotonic()
            if v:
                _HUB.pullers[v[:40]] = _HUB.pulled
    touch()
    _ensure_producer(ip, code, mode)
    end = time.monotonic() + _PULL_WAIT
    while True:
        with _HUB.lock:
            seq, fr, ts, alive = _HUB.seq, _HUB.frame, _HUB.ts, _HUB.thread is not None
        # « differente » et pas « plus grande » : apres un redemarrage du serveur, les numeros repartent de zero
        if fr and seq != after and time.monotonic() - ts < 3:
            _watch_tick(request)
            return Response(fr, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Seq": str(seq)})
        if time.monotonic() > end or await request.is_disconnected():
            return Response(status_code=204, headers={"Cache-Control": "no-store"})
        if not alive:
            _ensure_producer(ip, code, mode)
        else:
            _HUB.unstick()
        await asyncio.sleep(0.03)
        touch()


@router.get("/stats")
async def camera_stats():
    """Le releve du direct (02/11/2026), pour comprendre une camera saccadee : ce que le serveur recoit vraiment."""
    now = time.monotonic()
    with _HUB.lock:
        t = [x for x in _HUB.times if now - x <= 10]
        gaps = [round(b - a, 2) for a, b in zip(list(_HUB.times)[-11:], list(_HUB.times)[-10:])]
        out = {"producteur": _HUB.thread is not None, "methode": _HUB.method or None, "demarrages": _HUB.starts,
               "depuis_s": round(now - _HUB.started_at, 1) if _HUB.started_at else None,
               "images_par_s_10s": round(len(t) / 10, 1), "derniers_ecarts_s": gaps,
               "derniere_image_il_y_a_s": round(now - _HUB.ts, 1) if _HUB.ts else None,
               "taille_derniere_ko": round(len(_HUB.frame) / 1024) if _HUB.frame else None,
               "echecs": _HUB.fails, "figes_coupes": _HUB.stalls, "figes_5min": len([t for t in _HUB.stall_times if now - t < 300]), "nouvel_essai_dans_s": max(0, round(_HUB.retry_at - now, 1)),
               "derniere_erreur": _HUB.err or None, "erreur_il_y_a_s": round(now - _HUB.err_at) if _HUB.err_at else None,
               "ffmpeg": list(_HUB.ff_log), "methode_qui_marche": _HUB.good, "spectateurs_flux": _HUB.subs,
               "spectateurs_tires": len([1 for v in _HUB.pullers.values() if now - v < _IDLE_STOP])}
    try:
        import os
        # la charge du serveur : un ffmpeg qui ne suit pas le decodage (machine modeste) ralentit puis fige le direct
        out["serveur"] = {"charge_1_5_15min": [round(x, 2) for x in os.getloadavg()], "coeurs": os.cpu_count()}
    except (AttributeError, OSError):
        pass
    try:
        _ip, _code, nom, mid = await _printer_conf()
        out["modele"] = {"nom": nom, "id": mid}
        out["mode_choisi"] = _select_grab(out["modele"]["nom"], out["modele"]["id"])
    except Exception:
        pass
    return out


@router.get("/stream")
async def camera_stream(request: Request):
    """Le flux continu (MJPEG, multipart) : une image des qu'elle arrive. S'il
    n'en vient plus pendant 8 s, la reponse se termine : la page repasse aux
    captures et retentera le flux plus tard."""
    ip, code, model, model_id = await _printer_conf()
    if not ip or not code:
        return Response(status_code=503, content=b"non configure")
    mode = _select_grab(model, model_id)
    if mode is None:
        return Response(status_code=503, content=b"Pas de camera chambre sur ce modele")
    _ensure_producer(ip, code, mode)

    async def frames():
        with _HUB.lock:
            _HUB.subs += 1
        last, waited = -1, 0.0
        tick_at = 0.0
        try:
            while True:
                if await request.is_disconnected():
                    break
                with _HUB.lock:
                    seq, fr, alive = _HUB.seq, _HUB.frame, _HUB.thread is not None
                if fr and seq != last:
                    last, waited = seq, 0.0
                    if time.monotonic() - tick_at >= 2:      # le temps regarde, au fil de l'eau
                        tick_at = time.monotonic(); _watch_tick(request)
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(fr)).encode()
                           + b"\r\n\r\n" + fr + b"\r\n")
                    continue
                await asyncio.sleep(0.04)
                waited += 0.04
                if waited > 8:
                    break
                if not alive:
                    _ensure_producer(ip, code, mode)
                else:
                    _HUB.unstick()
        finally:
            with _HUB.lock:
                _HUB.subs -= 1
                if _HUB.subs <= 0:
                    _HUB.subs = 0
                    _HUB.idle_since = time.monotonic()
    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
