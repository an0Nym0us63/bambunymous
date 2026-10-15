"""
Partage d'une impression ou d'un groupe dans Telegram, EN SON NOM.

On passe par l'API « utilisateur » officielle de Telegram (MTProto, via
Telethon) et non par un bot : un bot posterait sous son propre nom. La
connexion se fait une fois depuis les Parametres (numero, code recu dans
Telegram, mot de passe 2FA s'il y en a un). La session obtenue est une cle
d'acces au compte : elle reste en base (table settings) et n'est JAMAIS
renvoyee par l'API ; « Se deconnecter » la revoque cote Telegram.

Les destinations (groupe, ou sujet d'un groupe a sujets) se choisissent dans
la liste des discussions du compte et sont memorisees avec leur access_hash :
une session en chaine ne garde pas le cache des entites, sans lui un id seul
ne suffirait pas a retrouver le groupe apres un redemarrage.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import os
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from ..db.session import AsyncSessionLocal
from .settings_service import get_setting, set_setting

logger = logging.getLogger(__name__)
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))

K_API_ID, K_API_HASH, K_SESSION, K_DEST = "TG_API_ID", "TG_API_HASH", "TG_SESSION", "TG_DESTINATIONS"
ALBUM_MAX = 10          # limite Telegram d'un album
CAPTION_MAX = 1024      # limite Telegram d'une legende de media

_lock = asyncio.Lock()
_client = None          # client connecte et autorise, reutilise
_pending: dict = {}     # connexion en cours : {client, phone, phone_code_hash}


class ShareError(Exception):
    """Erreur a montrer telle quelle a l'utilisateur."""


# ── Reglages ────────────────────────────────────────────────────────────────
async def _get(key: str) -> str:
    async with AsyncSessionLocal() as db:
        return await get_setting(db, key, "")


async def _set(key: str, value: str) -> None:
    async with AsyncSessionLocal() as db:
        await set_setting(db, key, value)


async def destinations() -> list[dict]:
    raw = await _get(K_DEST)
    try:
        val = json.loads(raw) if raw else []
    except ValueError:
        val = []
    return val if isinstance(val, list) else []


async def save_destinations(items: list[dict]) -> list[dict]:
    clean = []
    for d in items:
        peer = d.get("peer") or {}
        if peer.get("type") not in ("channel", "chat", "user") or not peer.get("id"):
            raise ShareError("Destination invalide")
        clean.append({
            "id": d.get("id") or uuid.uuid4().hex[:8],
            "label": (d.get("label") or d.get("chat_title") or "Sans nom").strip()[:80],
            "chat_title": d.get("chat_title") or "",
            "topic_id": int(d["topic_id"]) if d.get("topic_id") else None,
            "topic_title": d.get("topic_title") or None,
            "peer": {"type": peer["type"], "id": int(peer["id"]),
                     "access_hash": str(int(peer["access_hash"])) if peer.get("access_hash") is not None else None},
        })
    await _set(K_DEST, json.dumps(clean, ensure_ascii=False))
    return clean


# ── Connexion ───────────────────────────────────────────────────────────────
def _new_client(session: str, api_id: str, api_hash: str):
    from telethon import TelegramClient
    from telethon.sessions import StringSession
    return TelegramClient(StringSession(session or None), int(api_id), api_hash,
                          device_model="BambuNymous", app_version="1.0")


async def _connected_client():
    """Client autorise, ou ShareError si le compte n'est pas relie."""
    global _client
    if _client is not None and _client.is_connected():
        return _client
    session, api_id, api_hash = await _get(K_SESSION), await _get(K_API_ID), await _get(K_API_HASH)
    if not (session and api_id and api_hash):
        raise ShareError("Compte Telegram non relié (Paramètres > Partage Telegram)")
    c = _new_client(session, api_id, api_hash)
    await c.connect()
    if not await c.is_user_authorized():
        await c.disconnect()
        raise ShareError("Session Telegram expirée : reconnecte le compte dans les Paramètres")
    _client = c
    return c


async def status() -> dict:
    api_id = await _get(K_API_ID)
    out = {"app_configured": bool(api_id and await _get(K_API_HASH)), "api_id": api_id or "",
           "connected": False, "me": None, "pending": bool(_pending),
           "destinations": await destinations()}
    if await _get(K_SESSION):
        try:
            async with _lock:
                c = await _connected_client()
                me = await c.get_me()
            out["connected"] = True
            out["me"] = {"name": " ".join(filter(None, [me.first_name, me.last_name])),
                         "username": me.username}
        except ShareError as e:
            out["error"] = str(e)
        except Exception as e:      # reseau : on le dit sans tout casser
            logger.warning(f"[TG] statut : {e}")
            out["error"] = f"Telegram injoignable : {e}"
    return out


async def login_start(api_id: str, api_hash: str, phone: str) -> dict:
    global _pending
    api_id, api_hash, phone = str(api_id).strip(), api_hash.strip(), phone.strip().replace(" ", "")
    if not api_id.isdigit() or not api_hash or not phone:
        raise ShareError("api_id (nombre), api_hash et numéro sont requis")
    await _drop_pending()
    c = _new_client("", api_id, api_hash)
    await c.connect()
    try:
        sent = await c.send_code_request(phone)
    except Exception as e:
        await c.disconnect()
        raise ShareError(f"Envoi du code refusé par Telegram : {e}")
    await _set(K_API_ID, api_id)
    await _set(K_API_HASH, api_hash)
    _pending = {"client": c, "phone": phone, "hash": sent.phone_code_hash}
    return {"step": "code"}


async def login_code(code: str) -> dict:
    from telethon.errors import SessionPasswordNeededError
    if not _pending:
        raise ShareError("Aucune connexion en cours : recommence")
    c = _pending["client"]
    try:
        await c.sign_in(phone=_pending["phone"], code=code.strip(), phone_code_hash=_pending["hash"])
    except SessionPasswordNeededError:
        return {"step": "password"}
    except Exception as e:
        raise ShareError(f"Code refusé : {e}")
    return await _finish_login()


async def login_password(password: str) -> dict:
    if not _pending:
        raise ShareError("Aucune connexion en cours : recommence")
    try:
        await _pending["client"].sign_in(password=password)
    except Exception as e:
        raise ShareError(f"Mot de passe refusé : {e}")
    return await _finish_login()


async def _finish_login() -> dict:
    global _client, _pending
    c = _pending["client"]
    await _set(K_SESSION, c.session.save())
    if _client is not None and _client is not c:
        await _client.disconnect()
    _client, _pending = c, {}
    return {"step": "done"}


async def _drop_pending():
    global _pending
    if _pending:
        try:
            await _pending["client"].disconnect()
        except Exception:
            pass
    _pending = {}


async def logout() -> None:
    """Revoque la session cote Telegram, puis l'oublie ici."""
    global _client
    await _drop_pending()
    try:
        c = await _connected_client()
        await c.log_out()
    except Exception as e:
        logger.info(f"[TG] deconnexion : {e}")
    _client = None
    await _set(K_SESSION, "")


# ── Discussions ─────────────────────────────────────────────────────────────
async def list_chats() -> list[dict]:
    """
    Discussions du compte : groupes (avec leurs sujets), canaux, personnes,
    et ses propres « Messages enregistres » (pratique pour un premier essai).
    Groupes d'abord, puis personnes, chacun dans l'ordre des discussions.
    """
    from telethon.tl.types import Channel, Chat, User
    from telethon.tl.functions.channels import GetForumTopicsRequest
    async with _lock:
        c = await _connected_client()
        out = []
        async for d in c.iter_dialogs(limit=300):
            e = d.entity
            # access_hash en TEXTE : c'est un entier 64 bits, et le navigateur
            # (JavaScript) arrondit tout nombre au-dela de 2^53. Renvoye tel quel a
            # l'enregistrement, il arrivait faux -> « An invalid Peer was used ».
            if isinstance(e, Channel):
                peer = {"type": "channel", "id": e.id, "access_hash": str(e.access_hash)}
                kind = "canal" if e.broadcast else "groupe"
            elif isinstance(e, Chat):
                peer = {"type": "chat", "id": e.id, "access_hash": None}
                kind = "groupe"
            elif isinstance(e, User) and not e.deleted:
                peer = {"type": "user", "id": e.id, "access_hash": str(e.access_hash)}
                kind = "moi" if e.is_self else ("bot" if e.bot else "personne")
            else:
                continue
            title = "Messages enregistrés" if kind == "moi" else d.name
            item = {"title": title, "kind": kind, "peer": peer, "topics": []}
            if getattr(e, "forum", False):
                try:
                    r = await c(GetForumTopicsRequest(channel=e, offset_date=None, offset_id=0,
                                                      offset_topic=0, limit=100))
                    item["topics"] = [{"id": t.id, "title": t.title}
                                      for t in r.topics if getattr(t, "title", None)]
                except Exception as ex:
                    logger.info(f"[TG] sujets de {d.name} : {ex}")
            out.append(item)
    order = {"moi": 0, "groupe": 1, "canal": 2, "personne": 3, "bot": 4}
    return sorted(out, key=lambda c: order[c["kind"]])    # tri stable : l'ordre des discussions reste


def _input_peer(peer: dict):
    from telethon.tl.types import InputPeerChannel, InputPeerChat, InputPeerUser
    if peer["type"] == "channel":
        return InputPeerChannel(int(peer["id"]), int(peer["access_hash"]))
    if peer["type"] == "user":
        return InputPeerUser(int(peer["id"]), int(peer["access_hash"]))
    return InputPeerChat(int(peer["id"]))


async def _refresh_peer(c, dest: dict) -> Optional[dict]:
    """
    Retrouve la destination dans les discussions du compte et rend son peer a
    jour (access_hash juste). Repare les destinations enregistrees avant la
    correction des 64 bits, ou dont la cle a change. None si introuvable.
    """
    from telethon.tl.types import Channel, Chat, User
    want = dest["peer"]
    async for d in c.iter_dialogs(limit=500):
        e = d.entity
        if int(getattr(e, "id", 0)) != int(want["id"]):
            continue
        if want["type"] == "channel" and isinstance(e, Channel):
            return {"type": "channel", "id": e.id, "access_hash": str(e.access_hash)}
        if want["type"] == "user" and isinstance(e, User):
            return {"type": "user", "id": e.id, "access_hash": str(e.access_hash)}
        if want["type"] == "chat" and isinstance(e, Chat):
            return {"type": "chat", "id": e.id, "access_hash": None}
    return None


# ── Medias ──────────────────────────────────────────────────────────────────
MEDIA_EXT = (".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".m4v", ".webm")


def _is_animated_webp(path: Path) -> bool:
    with open(path, "rb") as f:
        head = f.read(64 * 1024)
    return head[:4] == b"RIFF" and head[8:12] == b"WEBP" and b"ANIM" in head


def prepare_media(paths: list[Path], workdir: Path) -> list[tuple[Path, bool]]:
    """
    Rend chaque fichier envoyable dans un album : (chemin, est_video).
    Telegram n'accepte dans un album que photos et videos : un WebP anime
    (les « gifs » de l'appli) devient une video muette, un WebP fixe un JPEG.
    ffmpeg ne lit pas le WebP anime : Pillow le decode d'abord en GIF.
    """
    from PIL import Image
    out = []
    for i, p in enumerate(paths):
        ext = p.suffix.lower()
        try:
            if ext in (".mp4", ".mov", ".m4v", ".webm"):
                out.append((p, True))
            elif ext == ".webp" and _is_animated_webp(p):
                gif, mp4 = workdir / f"{i}.gif", workdir / f"{i}.mp4"
                with Image.open(p) as im:
                    im.save(gif, save_all=True, loop=0)
                subprocess.run(["ffmpeg", "-y", "-i", str(gif), "-movflags", "faststart",
                                "-pix_fmt", "yuv420p", "-an",
                                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", str(mp4)],
                               check=True, capture_output=True, timeout=120)
                out.append((mp4, True))
            elif ext == ".webp":
                jpg = workdir / f"{i}.jpg"
                with Image.open(p) as im:
                    im.convert("RGB").save(jpg, quality=90)
                out.append((jpg, False))
            else:
                out.append((p, False))
        except Exception as e:
            logger.warning(f"[TG] media {p.name} ignore : {e}")
    return out


def _photos_of_dir(d: Path, cover: Optional[str]) -> list[Path]:
    if not d.exists():
        return []
    files = [f for f in sorted(d.iterdir())
             if f.is_file() and f.suffix.lower() in MEDIA_EXT
             and (f.name.startswith("Photo-") or f.name.startswith("Video-") or d.parent.name == "groups")]
    if cover:
        files.sort(key=lambda f: f.name != cover)     # la couverture en tete
    return files


def _plate(print_id: int) -> list[Path]:
    d = DATA_DIR / "prints" / str(print_id)
    for n in ("plate.png", "plate.jpg"):
        if (d / n).exists():
            return [d / n]
    return []


# ── Contenu du message ──────────────────────────────────────────────────────
def _dur(seconds) -> Optional[str]:
    if not seconds:
        return None
    m = int(round(seconds / 60))
    return f"{m // 60} h {m % 60:02d}" if m >= 60 else f"{m} min"


def _weight(g) -> Optional[str]:
    if not g:
        return None
    return f"{g / 1000:.2f} kg".replace(".", ",") if g >= 1000 else f"{round(g)} g"


LIVE_STATES = ("RUNNING", "PAUSE", "PREPARE", "SLICING")


def _live(prints, tz_offset_min: Optional[int]) -> Optional[dict]:
    """
    L'impression (ou un membre du groupe) est celle qui tourne en ce moment :
    avancement lu dans l'etat MQTT de l'imprimante. L'heure de fin est donnee
    dans le fuseau du navigateur (decalage envoye par la fenetre, comme
    Date.getTimezoneOffset) : le conteneur, lui, vit souvent en UTC.
    """
    from datetime import datetime, timedelta
    try:
        from ..core.mqtt import get_state
        s = get_state()
    except Exception:
        return None
    if (s.status or "").upper() not in LIVE_STATES:
        return None
    p = next((p for p in prints if p.status == "IN_PROGRESS"
              and (not p.job_id or not s.job_id or str(p.job_id) == str(s.job_id))), None)
    if p is None:
        return None
    rem = int(s.remaining_minutes or 0)
    eta = None
    if rem > 0:
        end = datetime.utcnow() + timedelta(minutes=rem) - timedelta(minutes=tz_offset_min or 0)
        eta = end.strftime("%H:%M")
    return {"print_id": p.id, "paused": (s.status or "").upper() == "PAUSE",
            "progress": int(round(s.progress or 0)), "layer": s.layer, "total_layers": s.total_layers,
            "remaining": _dur(rem * 60) if rem else None, "eta": eta}


def color_dot(hex_color: Optional[str]) -> str:
    """
    Pastille emoji la plus proche d'une couleur de filament : Telegram n'a pas
    de couleur libre dans le texte, il faut passer par les ronds de couleur.
    """
    import colorsys
    h = str(hex_color or "").strip().lstrip("#")[:6]
    if len(h) != 6:
        return "⚪"
    try:
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return "⚪"
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    hue *= 360
    if light < 0.18:
        return "⚫"
    if sat < 0.18:                          # gris : clair ou fonce
        return "⚪" if light > 0.55 else "⚫"
    if light > 0.9:
        return "⚪"
    if 15 <= hue < 45 and light < 0.42:     # orange sombre = marron
        return "🟤"
    if hue < 15 or hue >= 340:
        return "🔴"
    if hue < 45:
        return "🟠"
    if hue < 70:
        return "🟡"
    if hue < 170:
        return "🟢"
    if hue < 260:
        return "🔵"
    return "🟣"


def _makerworld(design_id) -> Optional[str]:
    d = str(design_id or "").strip()
    return f"https://makerworld.com/models/{d}" if d and d != "0" else None


async def build_share(kind: str, obj_id: int, tz_offset_min: Optional[int] = None) -> dict:
    """
    Ce qui partira : titre, statistiques, lien MakerWorld, medias. Sert a
    l'apercu de la fenetre ET a l'envoi : on montre exactement ce qui part.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from ..models.print_history import Print, Group
    from ..models.filament import Spool, Filament

    async with AsyncSessionLocal() as db:
        if kind == "print":
            p = await db.get(Print, obj_id, options=[selectinload(Print.filament_usage)])
            if not p:
                raise ShareError("Impression introuvable")
            prints, title = [p], (p.translated_name or p.file_name or "Impression")
            media = _photos_of_dir(DATA_DIR / "prints" / str(p.id), p.cover_photo) or _plate(p.id)
            items = p.number_of_items or 1
        elif kind == "group":
            g = await db.get(Group, obj_id)
            if not g:
                raise ShareError("Groupe introuvable")
            prints = (await db.execute(
                select(Print).options(selectinload(Print.filament_usage))
                .where(Print.group_id == obj_id).order_by(Print.print_date)
            )).scalars().all()
            title = g.name
            media = _photos_of_dir(DATA_DIR / "groups" / str(g.id), g.cover_photo)
            for p in prints:
                media += _photos_of_dir(DATA_DIR / "prints" / str(p.id), p.cover_photo)
            if not media:
                ordered = sorted(prints, key=lambda p: p.id != g.cover_print_id)
                for p in ordered:
                    media += _plate(p.id)
            items = g.number_of_items or 1
        else:
            raise ShareError("Type inconnu")

        # Filaments utilises : nom du filament de la bobine, sinon matiere.
        spool_ids = {u.spool_id for p in prints for u in p.filament_usage if u.spool_id}
        names = {}
        if spool_ids:
            rows = (await db.execute(
                select(Spool.id, Filament).join(Filament, Filament.id == Spool.filament_id)
                .where(Spool.id.in_(spool_ids))
            )).all()
            names = {sid: (f"{f.translated_name or f.name} ({f.fila_type or f.material})", f.color)
                     for sid, f in rows}
        fil = {}
        for p in prints:
            for u in p.filament_usage:
                key, col = names.get(u.spool_id) or (u.filament_type or "Filament", u.color_hex)
                g0, c0 = fil.get(key, (0, None))
                fil[key] = (g0 + (u.grams_used or 0), c0 or col)

    duration = sum((p.duration_seconds or 0) for p in prints)
    weight = sum((p.total_weight_g or 0) for p in prints)
    links = list(dict.fromkeys(filter(None, (_makerworld(p.design_id) for p in prints))))
    dates = [p.print_date for p in prints if p.print_date]

    stats = []
    if kind == "group":
        stats.append(f"🗂 {len(prints)} impression{'s' if len(prints) > 1 else ''}")
    if items > 1:
        stats.append(f"🧩 {items} pièces")
    if _dur(duration):
        stats.append(f"⏱ {_dur(duration)}")
    if _weight(weight):
        stats.append(f"⚖️ {_weight(weight)}")
    if dates:
        stats.append(f"📅 {max(dates).strftime('%d/%m/%Y')}")
    fil_lines = [f"{color_dot(c)} {html.escape(k)} — {_weight(g) or '0 g'}"
                 for k, (g, c) in sorted(fil.items(), key=lambda kv: -kv[1][0]) if g > 0][:6]

    live = _live(prints, tz_offset_min)
    # En cours : la vue de la camera prend la premiere place de l'album.
    media = media[:ALBUM_MAX - 1] if live else media[:ALBUM_MAX]
    return {"title": title, "stats": stats, "filaments": fil_lines, "links": links,
            "media": media, "live": live}


def render_caption(share: dict, message: str = "") -> str:
    """Legende HTML (mode d'analyse Telegram), coupee sous 1024 caracteres."""
    parts = [f"<b>{html.escape(share['title'])}</b>"]
    live = share.get("live")
    if live:
        bits = [f"{'⏸ En pause' if live['paused'] else '🟢 En cours'} — {live['progress']} %"]
        if live.get("total_layers"):
            bits.append(f"couche {live['layer']}/{live['total_layers']}")
        if live.get("remaining"):
            bits.append(f"reste {live['remaining']}")
        if live.get("eta"):
            bits.append(f"fin vers {live['eta']}")
        parts.append(" · ".join(bits))
    if message.strip():
        # Encadre (citation Telegram) : le mot ajoute se distingue d'un coup
        # d'oeil des informations generees.
        parts.append(f"<blockquote>💬 {html.escape(message.strip())}</blockquote>")
    if share["stats"]:
        parts.append(" · ".join(share["stats"]))
    if share["filaments"]:
        parts.append("🎨 Filaments\n" + "\n".join(share["filaments"]))
    for url in share["links"][:3]:
        parts.append(f'🔗 <a href="{url}">Voir sur MakerWorld</a>')
    text = "\n\n".join(parts)
    if len(text) > CAPTION_MAX and share["filaments"]:   # on raccourcit d'abord la liste
        return render_caption({**share, "filaments": share["filaments"][:-1]}, message)
    if len(text) > CAPTION_MAX:                          # puis le message lui-meme
        over = len(text) - CAPTION_MAX + 1
        return render_caption(share, message.strip()[:-over] + "…")
    return text


async def _camera_jpeg() -> Optional[bytes]:
    """Image de la camera, comme sur l'accueil ; None si indisponible."""
    try:
        from ..api.v1.routes.camera import camera_snapshot
        r = await camera_snapshot()
        return r.body if r.status_code == 200 and r.body[:2] == b"\xff\xd8" else None
    except Exception as e:
        logger.info(f"[TG] camera : {e}")
        return None


async def send(kind: str, obj_id: int, destination_id: str, message: str = "",
               tz_offset_min: Optional[int] = None) -> dict:
    dest = next((d for d in await destinations() if d["id"] == destination_id), None)
    if not dest:
        raise ShareError("Destination inconnue")
    share = await build_share(kind, obj_id, tz_offset_min)
    caption = render_caption(share, message)
    with tempfile.TemporaryDirectory() as tmp:
        files = await asyncio.to_thread(prepare_media, share["media"], Path(tmp))
        if share["live"]:
            jpg = await _camera_jpeg()
            if jpg:
                cam = Path(tmp) / "camera.jpg"
                cam.write_bytes(jpg)
                files.insert(0, (cam, False))
        async with _lock:
            from telethon.errors import (PeerIdInvalidError, ChannelInvalidError,
                                         UserIdInvalidError, ChatIdInvalidError)
            c = await _connected_client()
            kw = {"parse_mode": "html"}
            if dest.get("topic_id"):
                kw["reply_to"] = dest["topic_id"]       # sujet d'un groupe a sujets

            async def _go(peer):
                if files:
                    paths = [str(p) for p, _ in files]
                    cap = [caption] + [""] * (len(paths) - 1)
                    await asyncio.wait_for(c.send_file(
                        peer, paths if len(paths) > 1 else paths[0],
                        caption=cap if len(paths) > 1 else caption,
                        supports_streaming=True, **kw), timeout=300)
                else:
                    await c.send_message(peer, caption, link_preview=True, **kw)

            try:
                try:
                    await _go(_input_peer(dest["peer"]))
                except (PeerIdInvalidError, ChannelInvalidError, UserIdInvalidError, ChatIdInvalidError):
                    # Cle perimee ou abimee : on la relit dans les discussions,
                    # on la corrige dans les destinations, et on reessaie une fois.
                    fresh = await _refresh_peer(c, dest)
                    if not fresh:
                        raise ShareError(f"« {dest['label']} » est introuvable dans tes discussions Telegram : "
                                         f"retire-la et ajoute-la de nouveau")
                    all_d = await destinations()
                    for d in all_d:
                        if d["id"] == dest["id"]:
                            d["peer"] = fresh
                    await _set(K_DEST, json.dumps(all_d, ensure_ascii=False))
                    logger.info(f"[TG] destination {dest['label']} reparee")
                    await _go(_input_peer(fresh))
            except ShareError:
                raise
            except asyncio.TimeoutError:
                raise ShareError("Telegram n'a pas répondu à temps (envoi trop long ?)")
            except Exception as e:
                # Refus de Telegram (confidentialite, bloque, anti-spam, destination
                # perimee...) : on montre la raison au lieu d'une erreur 500.
                logger.warning(f"[TG] envoi vers {dest['label']} refuse : {type(e).__name__}: {e}")
                raise ShareError(f"Telegram a refusé l'envoi vers « {dest['label']} » : {e}")
    return {"ok": True, "media": len(files), "destination": dest["label"]}
