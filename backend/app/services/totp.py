"""
Double authentification par application (TOTP, RFC 6238) : Google
Authenticator, Aegis, 2FAS, Bitwarden... Bibliotheque standard seulement.

- code a 6 chiffres sur 30 s, une periode de tolerance de chaque cote (horloge
  du telephone un peu decalee) ;
- un code deja utilise ne repasse pas (anti-rejeu : on retient la derniere
  periode acceptee) ;
- codes de secours a usage unique, stockes haches (sha256) : ils evitent de
  rester enferme dehors si le telephone est perdu.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import secrets
import struct
import time
from typing import Optional
from urllib.parse import quote

STEP, DIGITS, WINDOW = 30, 6, 1
ISSUER = "BambuNymous"


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    h = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    n = (struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % (10 ** DIGITS)
    return str(n).zfill(DIGITS)


def verify(secret: str, code: str, last_step: Optional[int] = None, now: Optional[float] = None) -> Optional[int]:
    """Periode acceptee si le code est bon (et pas deja servi), sinon None."""
    code = "".join(c for c in (code or "") if c.isdigit())
    if not secret or len(code) != DIGITS:
        return None
    step = int((now if now is not None else time.time()) // STEP)
    for s in range(step - WINDOW, step + WINDOW + 1):
        if last_step is not None and s <= last_step:
            continue
        if hmac.compare_digest(_code(secret, s), code):
            return s
    return None


def otpauth_uri(username: str, secret: str) -> str:
    label = quote(f"{ISSUER}:{username}", safe=":@")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(ISSUER)}&digits={DIGITS}&period={STEP}"


def qr_data_url(text: str) -> str:
    import qrcode
    img = qrcode.make(text, box_size=6, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


# ── Codes de secours ─────────────────────────────────────────────────────────
def _h(code: str) -> str:
    return hashlib.sha256(code.replace("-", "").strip().lower().encode()).hexdigest()


def new_recovery_codes(n: int = 8) -> tuple[list[str], str]:
    """(codes en clair a montrer UNE fois, empreintes a stocker en JSON)."""
    codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(n)]
    return codes, json.dumps([_h(c) for c in codes])


def use_recovery_code(stored: Optional[str], code: str) -> Optional[str]:
    """Consomme un code de secours : rend le JSON restant, ou None s'il ne vaut rien."""
    try:
        hashes = json.loads(stored or "[]")
    except ValueError:
        return None
    h = _h(code or "")
    if h not in hashes:
        return None
    hashes.remove(h)
    return json.dumps(hashes)
