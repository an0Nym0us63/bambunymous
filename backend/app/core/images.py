"""Images servies par l'API : vignettes a la demande et cache du navigateur (25/10/2026).

Un middleware ASGI, pose devant toutes les routes, plutot qu'une retouche de
chaque point d'entree (vignette d'impression, photos, objets, accessoires,
groupes) : tout ce qui repond une image en profite, y compris les routes a venir.

- ``?w=256`` sur une image PNG/JPEG/WebP : une vignette WebP dont le plus petit
  cote fait ``w`` px (une tuile carree en « cover » reste nette), gardee sur disque
  sous l'empreinte (ETag) du fichier d'origine : un fichier remplace donne une
  nouvelle vignette. Une photo de telephone de plusieurs Mo devient ~20 Ko.
- Cache : ``?v=`` dans l'adresse (version du fichier) -> gardee un an ; sinon
  « no-cache » : le navigateur garde l'image et redemande seulement si elle a
  change (304, sans le corps). Avant, tout /api/ etait « no-store » : chaque
  vignette repartait en entier a chaque affichage.
"""
import asyncio
import hashlib
import io
import logging
import os
from pathlib import Path
from urllib.parse import parse_qs

log = logging.getLogger(__name__)

THUMB_DIR = Path(os.getenv("DATA_DIR", "/data")) / "cache" / "thumbs"
_RESIZABLE = ("image/png", "image/jpeg", "image/webp")
_WIDTHS = (96, 128, 192, 256, 384, 512, 768, 1024, 1280, 1600)   # quelques tailles : le cache reste petit ; 1024+ pour la visionneuse


def _bucket(w: int) -> int:
    for b in _WIDTHS:
        if w <= b:
            return b
    return _WIDTHS[-1]


def _resize(raw: bytes, w: int):
    """La vignette WebP, ou None quand l'original est deja assez petit (ou illisible)."""
    from PIL import Image, ImageOps
    try:
        im = Image.open(io.BytesIO(raw))
        if getattr(im, "is_animated", False):
            return None
        if min(im.size) <= w * 1.15:
            return None
        im = ImageOps.exif_transpose(im)
        r = w / min(im.size)
        im = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if "A" in im.getbands() or im.mode == "P" else "RGB")
        out = io.BytesIO()
        im.save(out, "WEBP", quality=80, method=4)
        data = out.getvalue()
        return data if len(data) < len(raw) else None
    except Exception as e:
        log.debug(f"[THUMB] vignette impossible : {e}")
        return None


class ImageCacheMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in ("GET", "HEAD") \
                or not scope.get("path", "").startswith("/api/"):
            await self.app(scope, receive, send)
            return
        qs = parse_qs(scope.get("query_string", b"").decode("latin-1"))
        try:
            want = _bucket(int(qs["w"][0])) if "w" in qs else 0
        except (ValueError, IndexError):
            want = 0
        versioned = "v" in qs
        inm = next((v.decode("latin-1") for k, v in scope.get("headers", []) if k == b"if-none-match"), None)
        state = {"start": None, "mode": "pass", "body": []}

        def _cache_headers(headers):
            headers = [(k, v) for k, v in headers if k.lower() not in (b"cache-control", b"pragma", b"expires")]
            headers.append((b"cache-control", b"private, max-age=31536000, immutable" if versioned else b"private, no-cache"))
            return headers

        async def _send(message):
            if message["type"] == "http.response.start":
                hdrs = {k.lower(): v for k, v in message.get("headers", [])}
                ctype = hdrs.get(b"content-type", b"").decode("latin-1").split(";")[0].strip().lower()
                if message.get("status") != 200 or not ctype.startswith("image/"):
                    await send(message)
                    return
                etag = hdrs.get(b"etag", b"").decode("latin-1")
                if want and ctype in _RESIZABLE and etag and scope["method"] == "GET":
                    # la vignette deja faite, ou deja chez le navigateur : repondue ici, sans lire le corps de
                    # l'original (28/10/2026 : chaque vignette de la page Impressions relisait son original entier,
                    # meme pour un 304)
                    key = hashlib.sha1(f"{scope['path']}|{etag}|{want}".encode()).hexdigest()
                    tetag = f'"t{key[:20]}"'
                    headers = _cache_headers([(k, v) for k, v in message.get("headers", [])
                                              if k.lower() not in (b"content-type", b"content-length", b"etag", b"content-disposition")])
                    if inm and tetag in [x.strip() for x in inm.split(",")]:
                        state["mode"] = "drop"
                        await send({"type": "http.response.start", "status": 304,
                                    "headers": [(k, v) for k, v in headers if k.lower() in (b"cache-control", b"last-modified")] + [(b"etag", tetag.encode())]})
                        await send({"type": "http.response.body", "body": b""})
                        return
                    cached = THUMB_DIR / key[:2] / f"{key}.webp"
                    try:
                        data = cached.read_bytes() if cached.is_file() else None
                    except OSError:
                        data = None
                    if data:
                        state["mode"] = "drop"
                        await send({"type": "http.response.start", "status": 200, "headers": headers + [
                            (b"content-type", b"image/webp"), (b"etag", tetag.encode()), (b"content-length", str(len(data)).encode())]})
                        await send({"type": "http.response.body", "body": data})
                        return
                    # pas encore de vignette : on attend le corps de l'original pour la faire
                    state["start"], state["mode"], state["etag"] = message, "thumb", etag
                    return
                headers = _cache_headers(message.get("headers", []))
                if etag and inm and etag in [x.strip() for x in inm.split(",")]:
                    state["mode"] = "drop"
                    await send({"type": "http.response.start", "status": 304,
                                "headers": [(k, v) for k, v in headers if k.lower() in (b"etag", b"cache-control", b"last-modified")]})
                    await send({"type": "http.response.body", "body": b""})
                    return
                await send({**message, "headers": headers})
                return
            if message["type"] == "http.response.body":
                if state["mode"] == "drop":
                    return
                if state["mode"] == "thumb":
                    state["body"].append(message.get("body", b""))
                    if not message.get("more_body"):
                        await self._thumb(scope, send, state, want, versioned, inm, _cache_headers)
                    return
            await send(message)

        await self.app(scope, receive, _send)

    async def _thumb(self, scope, send, state, want, versioned, inm, cache_headers):
        start, raw = state["start"], b"".join(state["body"])
        key = hashlib.sha1(f"{scope['path']}|{state['etag']}|{want}".encode()).hexdigest()
        path = THUMB_DIR / key[:2] / f"{key}.webp"
        data = None
        try:
            if path.is_file():
                data = path.read_bytes()
        except OSError:
            data = None
        if data is None:
            data = await asyncio.to_thread(_resize, raw, want)
            if data:
                try:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    tmp = path.with_suffix(".tmp")
                    tmp.write_bytes(data)
                    os.replace(tmp, path)
                except OSError as e:
                    log.debug(f"[THUMB] cache impossible : {e}")
        if not data:
            # l'original est deja petit : servi tel quel (avec son cache)
            headers = cache_headers(start.get("headers", []))
            if inm and state["etag"] in [x.strip() for x in inm.split(",")]:
                await send({"type": "http.response.start", "status": 304,
                            "headers": [(k, v) for k, v in headers if k.lower() in (b"etag", b"cache-control", b"last-modified")]})
                await send({"type": "http.response.body", "body": b""})
                return
            await send({**start, "headers": headers})
            await send({"type": "http.response.body", "body": raw})
            return
        etag = f'"t{key[:20]}"'
        headers = [(k, v) for k, v in start.get("headers", [])
                   if k.lower() not in (b"content-type", b"content-length", b"etag", b"content-disposition")]
        headers = cache_headers(headers) + [(b"content-type", b"image/webp"), (b"etag", etag.encode()),
                                            (b"content-length", str(len(data)).encode())]
        if inm and etag in [x.strip() for x in inm.split(",")]:
            await send({"type": "http.response.start", "status": 304,
                        "headers": [(k, v) for k, v in headers if k.lower() in (b"etag", b"cache-control", b"last-modified")]})
            await send({"type": "http.response.body", "body": b""})
            return
        await send({"type": "http.response.start", "status": 200, "headers": headers})
        await send({"type": "http.response.body", "body": data})
