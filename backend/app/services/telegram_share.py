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
                     "access_hash": int(peer["access_hash"]) if peer.get("access_hash") is not None else None},
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
            if isinstance(e, Channel):
                peer = {"type": "channel", "id": e.id, "access_hash": e.access_hash}
                kind = "canal" if e.broadcast else "groupe"
            elif isinstance(e, Chat):
                peer = {"type": "chat", "id": e.id, "access_hash": None}
                kind = "groupe"
            elif isinstance(e, User) and not e.deleted:
                peer = {"type": "user", "id": e.id, "access_hash": e.access_hash}
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
        return InputPeerChannel(peer["id"], peer["access_hash"])
    if peer["type"] == "user":
        return InputPeerUser(peer["id"], peer["access_hash"])
    return InputPeerChat(peer["id"])


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


def _makerworld(design_id) -> Optional[str]:
    d = str(design_id or "").strip()
    return f"https://makerworld.com/models/{d}" if d and d != "0" else None


async def build_share(kind: str, obj_id: int) -> dict:
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
            names = {sid: f"{f.translated_name or f.name} ({f.fila_type or f.material})" for sid, f in rows}
        fil = {}
        for p in prints:
            for u in p.filament_usage:
                key = names.get(u.spool_id) or (u.filament_type or "Filament")
                fil[key] = fil.get(key, 0) + (u.grams_used or 0)

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
    fil_lines = [f"• {html.escape(k)} — {_weight(v) or '0 g'}"
                 for k, v in sorted(fil.items(), key=lambda kv: -kv[1]) if v > 0][:6]

    media = media[:ALBUM_MAX]
    return {"title": title, "stats": stats, "filaments": fil_lines, "links": links,
            "media": media}


def render_caption(share: dict, message: str = "") -> str:
    """Legende HTML (mode d'analyse Telegram), coupee sous 1024 caracteres."""
    parts = [f"<b>{html.escape(share['title'])}</b>"]
    if message.strip():
        parts.append(html.escape(message.strip()))
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


async def send(kind: str, obj_id: int, destination_id: str, message: str = "") -> dict:
    dest = next((d for d in await destinations() if d["id"] == destination_id), None)
    if not dest:
        raise ShareError("Destination inconnue")
    share = await build_share(kind, obj_id)
    caption = render_caption(share, message)
    with tempfile.TemporaryDirectory() as tmp:
        files = await asyncio.to_thread(prepare_media, share["media"], Path(tmp))
        async with _lock:
            c = await _connected_client()
            peer = _input_peer(dest["peer"])
            kw = {"parse_mode": "html"}
            if dest.get("topic_id"):
                kw["reply_to"] = dest["topic_id"]       # sujet d'un groupe a sujets
            if files:
                paths = [str(p) for p, _ in files]
                cap = [caption] + [""] * (len(paths) - 1)
                await asyncio.wait_for(c.send_file(
                    peer, paths if len(paths) > 1 else paths[0],
                    caption=cap if len(paths) > 1 else caption,
                    supports_streaming=True, **kw), timeout=300)
            else:
                await c.send_message(peer, caption, link_preview=True, **kw)
    return {"ok": True, "media": len(files), "destination": dest["label"]}
