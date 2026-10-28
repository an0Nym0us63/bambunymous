"""
Les commandes Bambu Lab lues dans les mails (28/10/2026).

La boutique n'a pas d'API : on lit la boite mail (IMAP, mot de passe d'application) et on repere les mails de la
boutique (confirmation, expedition, livraison, annulation), au format des boutiques Shopify. Chaque ligne de
commande est rapprochee du catalogue Bambu (type + nom de couleur) puis des filaments de l'appli ; les bobines
attendues apparaissent en « a venir » sur la page Filaments et dans les alertes, et s'effacent quand la bobine
arrive (ajoutee ou scannee), ou d'une coche a la main.
"""
from __future__ import annotations

import asyncio
import email
import email.header
import email.utils
import html
import imaplib
import json
import logging
import re
import time
import unicodedata
from datetime import datetime, timedelta
from html.parser import HTMLParser

logger = logging.getLogger(__name__)

K_HOST, K_PORT, K_USER, K_PASS = "MAIL_HOST", "MAIL_PORT", "MAIL_USER", "MAIL_PASS"
K_FOLDER, K_SENDER, K_ENABLED, K_DAYS, K_EVERY, K_LAST, K_SEEN = \
    "MAIL_FOLDER", "MAIL_SENDER", "MAIL_ENABLED", "MAIL_DAYS", "MAIL_EVERY_H", "MAIL_LAST", "MAIL_SEEN"
_STATE = {"running": False}
REREAD_MAX_DAYS = 21       # le plus loin qu'un releve remonte (reglage ou rattrapage)
# les adresses d'expediteur de la boutique (28/10/2026, d'apres un vrai mail) : seuls leurs mails sont lus, tout le
# reste de la boite est ignore ; d'autres adresses s'ajoutent dans les reglages (boutique US, CN…)
DEFAULT_SENDERS = "noreply@notify-eu.bambulab.com"
_SEEN_MAX = 2000


# ── Reglages ────────────────────────────────────────────────────────────────────
async def settings_get() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting as g_
    async with AsyncSessionLocal() as db:
        async def g(k, d=""):
            return await g_(db, k, d)
        out = {"host": await g(K_HOST, "imap.gmail.com"), "port": int((await g(K_PORT, "993")) or 993),
               "user": await g(K_USER, ""), "has_password": bool(await g(K_PASS, "")),
               "folder": await g(K_FOLDER, "INBOX"), "senders": [x.strip() for x in (await g(K_SENDER, DEFAULT_SENDERS)).split(",") if x.strip()],
               "enabled": (await g(K_ENABLED, "0")) == "1", "days": min(REREAD_MAX_DAYS, int((await g(K_DAYS, "21")) or 21)),
               "every_h": int((await g(K_EVERY, "3")) or 3), "running": _STATE["running"]}
        try:
            out["last"] = json.loads(await g(K_LAST, "") or "null")
        except ValueError:
            out["last"] = None
    return out


async def settings_set(body: dict) -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        for key, k in ((K_HOST, "host"), (K_USER, "user"), (K_FOLDER, "folder")):
            if k in body:
                await set_setting(db, key, str(body[k] or "").strip())
        if "senders" in body and isinstance(body["senders"], list):
            lst = sorted({str(x).strip().lower() for x in body["senders"] if str(x).strip() and "," not in str(x)})
            await set_setting(db, K_SENDER, ",".join(lst) or DEFAULT_SENDERS)
        if "port" in body:
            await set_setting(db, K_PORT, str(max(1, min(65535, int(body["port"] or 993)))))
        if "password" in body and body["password"] is not None:
            # vide : on garde l'ancien (le champ ne le reaffiche jamais) ; « - » : on l'efface
            pw = str(body["password"])
            if pw == "-":
                await set_setting(db, K_PASS, "")
            elif pw.strip():
                await set_setting(db, K_PASS, pw.strip().replace(" ", ""))   # Gmail affiche le mot de passe d'application avec des espaces
        if "enabled" in body:
            await set_setting(db, K_ENABLED, "1" if body["enabled"] else "0")
        if "days" in body:
            await set_setting(db, K_DAYS, str(max(1, min(REREAD_MAX_DAYS, int(body["days"] or 21)))))
        if "every_h" in body:
            await set_setting(db, K_EVERY, str(max(1, min(48, int(body["every_h"] or 3)))))
    return await settings_get()


async def _remember(report: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_LAST, json.dumps(report, ensure_ascii=False, default=str))


# ── Lecture des mails ──────────────────────────────────────────────────────────
class _Text(HTMLParser):
    """Le texte d'un HTML de mail : une ligne par bloc (ligne de tableau, paragraphe), les cellules d'une
    meme ligne separees par des espaces ; styles et scripts ignores."""
    BLOCK = {"tr", "p", "div", "br", "li", "h1", "h2", "h3", "h4", "table", "ul", "ol"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self._skip, self._tr = [], 0, 0
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "script", "head"):
            self._skip += 1
        elif tag == "tr":
            self._tr += 1
            self.parts.append("\n")
        elif tag == "br" and self._tr:
            self.parts.append(" ")                 # dans une ligne de tableau, le saut reste sur la ligne (« Produit<br>1 kg »)
        elif tag in self.BLOCK:
            self.parts.append("\n")
        elif tag in ("td", "th"):
            self.parts.append(" ")
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag in ("style", "script", "head") and self._skip:
            self._skip -= 1
        elif tag == "tr":
            self._tr = max(0, self._tr - 1)
            self.parts.append("\n")
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)

    def text(self) -> str:
        t = "".join(self.parts)
        lines = [re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in t.splitlines()]
        return "\n".join(ln for ln in lines if ln)


def _decode(h) -> str:
    try:
        return str(email.header.make_header(email.header.decode_header(h or "")))
    except Exception:
        return str(h or "")


def _body(msg) -> tuple[str, list]:
    """(texte, liens) : la partie texte, sinon le HTML converti."""
    plain, htmls = [], []
    for part in msg.walk() if msg.is_multipart() else [msg]:
        ct = part.get_content_type()
        if ct not in ("text/plain", "text/html"):
            continue
        try:
            payload = part.get_payload(decode=True) or b""
            cs = part.get_content_charset() or "utf-8"
            s = payload.decode(cs, errors="replace")
        except Exception:
            continue
        (plain if ct == "text/plain" else htmls).append(s)
    links = []
    for h in htmls:
        p = _Text()
        try:
            p.feed(h)
        except Exception:
            continue
        links += p.links
    if htmls:                                   # le HTML porte les lignes de produits en tableau : plus fiable
        p = _Text()
        p.feed(htmls[0])
        text = p.text()
        if plain and len(plain[0]) > len(text):
            text = plain[0] + "\n" + text
        return text, links
    text = "\n".join(plain)
    links += re.findall(r"https?://\S+", text)
    return text, links


def _fold(t: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", str(t or "").lower()) if unicodedata.category(ch) != "Mn")


_ORDER_RE = re.compile(r"(?:order|commande|bestellung|pedido|ordine)\s*(?:#|n[°o]\.?|no\.?|num(?:ber|éro|ero)?)?\s*:?\s*#?\s*([A-Z]{0,4}[-]?\d{3,})", re.I)
_QTY_RE = re.compile(r"^(?P<title>.+?)\s*(?:[×x]\s*(?P<qty>\d{1,3})|(?P<qty2>\d{1,3})\s*[×x])\s*(?:[\d.,]+\s*(?:€|\$|£|EUR|USD)?)?$", re.I)
_PRICE_RE = re.compile(r"(?:€\s?[\d.,]+|[\d.,]+\s?(?:€|EUR)|\$\s?[\d.,]+|£\s?[\d.,]+)")
_SKIP = ("sous-total", "subtotal", "total", "taxes", "tva", "tax", "livraison", "shipping", "remise", "discount", "frais",
         "quantité", "quantity", "prix", "price", "articles", "items")


def _kind_of(s: str) -> str | None:
    if re.search(r"annul|cancel", s):
        return "cancelled"
    if re.search(r"livree|delivered|est arrivee|has arrived|a ete livre", s):
        return "delivered"
    if re.search(r"confirm|merci pour votre commande|thank you for your (order|purchase)|recapitulatif|received your order", s):
        return "confirmed"
    if re.search(r"expedie|shipped|on the way|en route|en cours de livraison|out for delivery|has been sent|envoyee|un envoi", s):
        return "shipped"
    return None


def classify(subject: str, text: str) -> str | None:
    """L'objet decide d'abord (28/10/2026 : le corps d'une confirmation Bambu dit deja « pour l'expedier », qui la
    faisait passer pour une expedition) ; le corps ne sert qu'a un objet muet."""
    return _kind_of(_fold(subject)) or _kind_of(_fold(text[:400]))


def order_number(subject: str, text: str) -> str | None:
    for src in (subject, text[:3000]):
        m = _ORDER_RE.search(src)
        if m:
            return m.group(1).upper().replace("-", "")
    return None


_TRACK_URL = {"dhl": "https://www.dhl.com/fr-fr/home/tracking.html?tracking-id={n}", "ups": "https://www.ups.com/track?tracknum={n}",
              "fedex": "https://www.fedex.com/fedextrack/?trknbr={n}", "dpd": "https://www.dpd.com/fr/fr/suivre-mon-colis/?parcelNumber={n}",
              "gls": "https://gls-group.com/FR/fr/suivi-colis?match={n}", "colissimo": "https://www.laposte.fr/outils/suivre-vos-envois?code={n}",
              "chronopost": "https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT={n}", "usps": "https://tools.usps.com/go/TrackConfirmAction?tLabels={n}",
              "la poste": "https://www.laposte.fr/outils/suivre-vos-envois?code={n}", "tnt": "https://www.tnt.com/express/fr_fr/site/outils-expedition/suivi.html?searchType=con&cons={n}"}


def tracking(text: str, links: list) -> tuple[str | None, str | None, str | None]:
    """(adresse de suivi, transporteur, numero) : le « Numero de suivi de DHL : XXX » en clair d'abord (format
    Bambu, 28/10/2026), sinon un lien de transporteur."""
    m = re.search(r"(?:num[ée]ro de suivi|tracking number|suivi)\s*(?:de|du|:)?\s*([A-Za-z][A-Za-z ]{1,20}?)?\s*:\s*([A-Z0-9]{8,})", text, re.I)
    if m:
        name = (m.group(1) or "").strip()
        n = m.group(2).strip()
        key = next((k for k in _TRACK_URL if k in name.lower()), None)
        url = _TRACK_URL[key].format(n=n) if key else None
        if not url:
            url = next((u for u in links if n in u), None)
        return url, (name or None), n
    carriers = (("ups.com", "UPS"), ("dhl", "DHL"), ("fedex", "FedEx"), ("dpd", "DPD"), ("gls", "GLS"), ("laposte", "La Poste"),
                ("colissimo", "Colissimo"), ("chronopost", "Chronopost"), ("tnt", "TNT"), ("usps", "USPS"), ("17track", None),
                ("aftership", None), ("track", None))
    for u in links:
        lu = u.lower()
        if "unsubscribe" in lu or "mailto:" in lu:
            continue
        for key, name in carriers:
            if key in lu:
                return u, name, None
    return None, None, None


# « PLA Marble x 1 » (ou « × 1 ») puis « Granit rouge (13201) / Filament avec bobine / 1 kg » : le produit, la
# quantite, le nom de couleur, le CODE COULEUR Bambu (celui du catalogue : plus rien a deviner), bobine ou recharge
_BAMBU_RE = re.compile(r"(?P<title>[A-Za-z][A-Za-z0-9+\- ]{1,40}?)\s*[×x]\s*(?P<qty>\d{1,3})\s+(?P<color>[^/\n()]{1,60}?)\s*\((?P<code>\d{5})\)\s*/\s*(?P<pack>[^/\n]{1,40})(?:/\s*(?P<w>[\d.,]+\s*k?g))?", re.I)


def items_bambu(text: str) -> list[dict]:
    out = []
    for m in _BAMBU_RE.finditer(text):
        pack = _fold(m.group("pack"))[:30]
        out.append({"title": f"{m.group('title').strip()} - {m.group('color').strip()}", "qty": int(m.group("qty")),
                    "product": m.group("title").strip(), "color_name": m.group("color").strip(), "fila_color_code": m.group("code"),
                    "refill": "recharge" in pack or "refill" in pack, "weight": (m.group("w") or "").replace(" ", "") or None})
    return out


def items_from_text(text: str) -> list[dict]:
    """Les lignes « Produit - Variante × 2 » du mail (format des boutiques Shopify, texte ou tableau HTML)."""
    out, seen, prev = [], set(), ""
    for ln in text.splitlines():
        low = _fold(ln)
        if any(low.startswith(k) for k in _SKIP) or len(ln) > 160:
            prev = ""
            continue
        m = _QTY_RE.match(ln)
        if not m:
            prev = ln
            continue
        title = _PRICE_RE.sub("", m.group("title")).strip(" -–:·")
        # la quantite sur la ligne de la variante seule (« 1 kg × 2 ») : le produit est la ligne d'avant
        if prev and (len(title) < 4 or re.fullmatch(r"[\d.,]+\s*(kg|g|mm|m)\b.*", title, re.I)):
            title = f"{prev.strip()} {title}".strip()
        prev = ""
        if len(title) < 4 or not re.search(r"[a-zA-Z]", title):
            continue
        qty = int(m.group("qty") or m.group("qty2") or 1)
        key = (title.lower(), qty)
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": title, "qty": qty})
    return out


# ── Rapprochement avec le catalogue et les filaments ───────────────────────────
_CAT = {"n": -1, "types": [], "colors": {}}


def _catalog_index():
    """Les types (« pla basic », « petg hf »…) du plus long au plus court, et par type les couleurs (nom
    francais et anglais replies -> entree)."""
    from .bambu_catalog import catalog_entries
    data, _ = catalog_entries()
    data = data or []
    if _CAT["n"] == len(data):
        return _CAT["types"], _CAT["colors"]
    colors: dict = {}
    for e in data:
        t = _fold(e.get("fila_type", ""))
        if not t:
            continue
        names = e.get("fila_color_name") or {}
        for nm in (names.get("fr"), names.get("en")):
            if nm:
                colors.setdefault(t, {})[_fold(nm)] = e
    types = sorted(colors, key=len, reverse=True)
    _CAT.update(n=len(data), types=types, colors=colors)
    return types, colors


def match_catalog_code(code: str) -> dict | None:
    """L'entree du catalogue par son code couleur Bambu (« 13201 »), exact."""
    from .bambu_catalog import catalog_entries
    data, _ = catalog_entries()
    for e in data or []:
        if str(e.get("fila_color_code") or "") == str(code):
            names = e.get("fila_color_name") or {}
            cols = e.get("fila_color") or []
            return {"fila_id": e.get("fila_id"), "fila_color_code": e.get("fila_color_code"), "fila_type": e.get("fila_type"),
                    "name_fr": names.get("fr") or names.get("en"), "name_en": names.get("en"),
                    "color_hex": (cols[0].lstrip("#")[:6] if cols else None), "refill": False}
    return None


def match_catalog(title: str) -> dict | None:
    """L'entree du catalogue Bambu qu'une ligne de commande designe : le type le plus long present dans le
    titre, puis le nom de couleur le plus long present. Rend {fila_id, fila_color_code, fila_type, name_fr,
    name_en, color_hex, refill}."""
    low = _fold(title)
    types, colors = _catalog_index()
    for t in types:
        if t not in low:
            continue
        rest = low.replace(t, " ")
        best = None
        for nm, e in colors[t].items():
            if nm and nm in rest and (best is None or len(nm) > len(best[0])):
                best = (nm, e)
        if best:
            e = best[1]
            names = e.get("fila_color_name") or {}
            cols = e.get("fila_color") or []
            return {"fila_id": e.get("fila_id"), "fila_color_code": e.get("fila_color_code"), "fila_type": e.get("fila_type"),
                    "name_fr": names.get("fr") or names.get("en"), "name_en": names.get("en"),
                    "color_hex": (cols[0].lstrip("#")[:6] if cols else None), "refill": "refill" in low or "recharge" in low}
        return {"fila_type": e_type_label(t, types, colors), "fila_id": None, "fila_color_code": None, "name_fr": None,
                "name_en": None, "color_hex": None, "refill": "refill" in low or "recharge" in low}
    return None


def e_type_label(t: str, types, colors) -> str:
    for e in colors.get(t, {}).values():
        return e.get("fila_type") or t
    return t


async def _filament_for(db, cat: dict):
    """Le filament de l'appli qui correspond a une entree du catalogue : meme code couleur Bambu, sinon meme
    profil et meme couleur."""
    from sqlalchemy import select
    from ..models.filament import Filament
    if not cat:
        return None
    if cat.get("fila_color_code"):
        f = (await db.execute(select(Filament).where(Filament.fila_color_code == str(cat["fila_color_code"])))).scalars().first()
        if f:
            return f
    if cat.get("fila_id") and cat.get("color_hex"):
        rows = (await db.execute(select(Filament).where(Filament.profile_id == cat["fila_id"]))).scalars().all()
        for f in rows:
            if (f.color or "").lower()[:6] == cat["color_hex"].lower():
                return f
    return None


async def enrich_items(items: list[dict]) -> list[dict]:
    from ..db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        for it in items:
            cat = match_catalog_code(it["fila_color_code"]) if it.get("fila_color_code") else None
            if cat:
                cat["refill"] = bool(it.get("refill"))
            elif it.get("fila_color_code"):
                # un code que le catalogue local ne connait pas encore : le produit et le nom de couleur du mail
                cat = {"fila_id": None, "fila_color_code": it["fila_color_code"], "fila_type": it.get("product"),
                       "name_fr": it.get("color_name"), "name_en": None, "color_hex": None, "refill": bool(it.get("refill"))}
            else:
                cat = match_catalog(it["title"])
            it["kind"] = "filament" if cat else "other"
            it.setdefault("received", 0)
            if cat:
                it.update({k: cat.get(k) for k in ("fila_id", "fila_color_code", "fila_type", "name_fr", "color_hex", "refill")})
                f = await _filament_for(db, cat)
                it["filament_id"] = f.id if f else None
                if f and not it.get("color_hex"):
                    it["color_hex"] = f.color
    return items


# ── Le releve ──────────────────────────────────────────────────────────────────
def _fetch_sync(cfg: dict, password: str, seen: set) -> tuple[list, list]:
    """Se connecte, cherche les mails de la boutique, rend (nouveaux mails analyses, erreurs). Un releve
    automatique ne regarde que depuis le dernier mail deja vu (UID IMAP superieur, 28/10/2026) : pas de retour dans
    le temps ; sans mail deja vu, ou pour un releve a la main ou une relecture, la fenetre de N jours."""
    since = (datetime.utcnow() - timedelta(days=cfg["days"])).strftime("%d-%b-%Y")
    last_uid = max((int(u) for u in seen if str(u).isdigit()), default=0) if cfg.get("from_last") else 0
    found, errors = [], []
    M = imaplib.IMAP4_SSL(cfg["host"], cfg["port"])
    try:
        M.login(cfg["user"], password)
        typ, _ = M.select(cfg["folder"] or "INBOX", readonly=True)
        if typ != "OK":
            raise RuntimeError(f"Dossier « {cfg['folder']} » introuvable")
        senders = cfg.get("senders") or DEFAULT_SENDERS.split(",")
        uids = set()
        for s in senders:
            crit = f'(UID {last_uid + 1}:* FROM "{s}")' if last_uid else f'(SINCE {since} FROM "{s}")'
            typ, data = M.uid("search", None, crit)
            if typ == "OK" and data and data[0]:
                uids |= set(data[0].split())
        # « UID n:* » rend aussi le dernier mail connu quand rien de neuf n'est arrive : les deja vus sont ecartes
        new = [u for u in sorted(uids, key=lambda x: int(x)) if u.decode() not in seen and int(u) > last_uid]
        for u in new[-200:]:
            try:
                typ, data = M.uid("fetch", u, "(RFC822)")
                if typ != "OK" or not data or not isinstance(data[0], tuple):
                    continue
                msg = email.message_from_bytes(data[0][1])
                subject = _decode(msg.get("Subject"))
                frm = _decode(msg.get("From"))
                try:
                    when = email.utils.parsedate_to_datetime(msg.get("Date"))
                    when = when.astimezone(tz=None).replace(tzinfo=None) if when.tzinfo else when
                except Exception:
                    when = datetime.utcnow()
                text, links = _body(msg)
                found.append({"uid": u.decode(), "subject": subject, "from": frm, "date": when, "text": text, "links": links})
            except Exception as e:
                errors.append(f"mail {u.decode()} : {e}")
    finally:
        try:
            M.logout()
        except Exception:
            pass
    return found, errors


async def _seen() -> set:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        try:
            return set(json.loads(await get_setting(db, K_SEEN, "") or "[]"))
        except ValueError:
            return set()


async def _seen_put(s: set) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    lst = sorted(s, key=lambda x: int(x) if str(x).isdigit() else 0)[-_SEEN_MAX:]
    async with AsyncSessionLocal() as db:
        await set_setting(db, K_SEEN, json.dumps(lst))


async def sync(trigger: str = "manuel", days: int | None = None, reread: bool = False) -> dict:
    """Un releve : les nouveaux mails de la boutique, et les commandes creees ou mises a jour. days : remonter
    sur ce nombre de jours au lieu du reglage ; reread : relire aussi les mails deja vus (rattrapage dans le passe,
    28/10/2026) -- une commande deja connue est simplement remise a jour, jamais doublee."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    if _STATE["running"]:
        return {"error": "Un relevé est déjà en cours."}
    cfg = await settings_get()
    if days:
        # un rattrapage ne remonte jamais au-dela de 21 jours (28/10/2026 : relire un an ramenait de vieilles
        # commandes a confirmer) ; le releve courant est borne pareil par ses reglages
        cfg["days"] = max(1, min(REREAD_MAX_DAYS, int(days)))
    async with AsyncSessionLocal() as db:
        password = await get_setting(db, K_PASS, "")
    if not (cfg["user"] and password):
        rep = {"at": datetime.utcnow().isoformat() + "Z", "trigger": trigger, "error": "Adresse ou mot de passe d'application manquant"}
        await _remember(rep)
        return rep
    _STATE["running"] = True
    t0 = time.time()
    try:
        seen = await _seen()
        cfg["from_last"] = trigger == "auto" and not reread     # automatique : depuis le dernier mail vu seulement
        mails, errors = await asyncio.to_thread(_fetch_sync, cfg, password, set() if reread else seen)
        created, updated, ignored = 0, 0, 0
        # seules les lectures automatiques previennent (28/10/2026) : une relecture ou un releve a la main ne
        # doit pas faire pleuvoir les notifications de commandes deja connues
        notify = trigger == "auto"
        for m in sorted(mails, key=lambda x: x["date"]):
            seen.add(m["uid"])
            r = await _apply(m, notify=notify)
            if r == "created":
                created += 1
            elif r == "updated":
                updated += 1
            else:
                ignored += 1
        await _seen_put(seen)
        rep = {"at": datetime.utcnow().isoformat() + "Z", "trigger": trigger, "mails": len(mails), "created": created,
               "updated": updated, "ignored": ignored, "errors": errors[:5], "seconds": round(time.time() - t0, 1),
               "days": cfg["days"], "reread": bool(reread)}
    except imaplib.IMAP4.error as e:
        rep = {"at": datetime.utcnow().isoformat() + "Z", "trigger": trigger,
               "error": f"Connexion refusée : {str(e)[:160]} (pour Gmail : un mot de passe d'application, pas celui du compte)"}
    except Exception as e:
        logger.exception("[MAIL] relevé")
        rep = {"at": datetime.utcnow().isoformat() + "Z", "trigger": trigger, "error": str(e)[:300]}
    finally:
        _STATE["running"] = False
    await _remember(rep)
    logger.info(f"[MAIL] relevé ({trigger}) : {rep}")
    return rep


AUTO_CLOSE_DAYS = 60       # une commande plus vieille que ca est arrivee depuis longtemps : rien a attendre
MATCH_WINDOW_DAYS = 21     # les bobines ajoutees dans cette fenetre apres la commande comptent comme recues (90 avant le 28/10/2026)


async def _reconcile_existing(items: list, ordered_at) -> None:
    """Les bobines deja dans l'appli pour les lignes d'une commande (28/10/2026 : relire un mail de six mois ne
    doit pas remettre en « a venir » des bobines recues depuis longtemps) : chaque bobine du filament ajoutee
    apres la commande (dans les 21 jours) compte comme recue ; au-dela de 60 jours, tout est considere recu."""
    from sqlalchemy import select, func
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Spool
    if not ordered_at:
        return
    old = ordered_at < datetime.utcnow() - timedelta(days=AUTO_CLOSE_DAYS)
    async with AsyncSessionLocal() as db:
        for it in items:
            if it.get("kind") != "filament":
                continue
            qty = int(it.get("qty") or 1)
            n = 0
            if it.get("filament_id"):
                # les bobines du filament ajoutees apres la commande (sans limite pour une vieille commande)
                q = select(func.count(Spool.id)).where(Spool.filament_id == it["filament_id"], Spool.created_at >= ordered_at)
                if not old:
                    q = q.where(Spool.created_at <= ordered_at + timedelta(days=MATCH_WINDOW_DAYS))
                n = int((await db.execute(q)).scalar() or 0)
            it["received"] = min(qty, n)
            it["auto"] = min(qty, n)                      # ce que les dates de creation de bobines expliquent
            if old and it["received"] < qty:
                it["assumed"] = qty - it["received"]      # presume recu par anciennete : a confirmer
                it["received"] = qty


async def _apply(m: dict, notify: bool = True) -> str:
    """Un mail analyse -> une commande creee ou mise a jour. Rend created / updated / ignored."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.mail_order import MailOrder
    kind = classify(m["subject"], m["text"])
    no = order_number(m["subject"], m["text"])
    if not kind or not no:
        return "ignored"
    parsed = items_bambu(m["text"]) or items_from_text(m["text"])
    items = parsed if kind == "confirmed" else []
    if kind == "confirmed" and not items:
        return "ignored"
    if items:
        items = await enrich_items(items)
        await _reconcile_existing(items, m["date"])
    url, carrier, tno = tracking(m["text"], m["links"]) if kind in ("shipped", "delivered") else (None, None, None)
    store = None
    mm = re.search(r"https?://([a-z0-9.-]*store\.bambulab\.com)", m["text"] + " " + " ".join(m["links"]), re.I)
    if mm:
        store = mm.group(1).lower()
    async with AsyncSessionLocal() as db:
        o = (await db.execute(select(MailOrder).where(MailOrder.order_no == no))).scalar_one_or_none()
        res = "updated"
        if o is None:
            if kind != "confirmed":
                # une expedition dont on n'a pas vu la confirmation : une commande sans lignes, pour le suivi
                o = MailOrder(order_no=no, status=kind, items_json="[]", ordered_at=m["date"], store=store, subject=m["subject"][:250])
            else:
                o = MailOrder(order_no=no, status="confirmed", items_json=json.dumps(items, ensure_ascii=False), ordered_at=m["date"],
                              store=store, subject=m["subject"][:250])
            db.add(o)
            res = "created"
        else:
            if kind == "confirmed" and items and not json.loads(o.items_json or "[]"):
                o.items_json = json.dumps(items, ensure_ascii=False)
                o.ordered_at = o.ordered_at or m["date"]
            rank = {"confirmed": 0, "shipped": 1, "delivered": 2, "cancelled": 3}
            if rank.get(kind, 0) >= rank.get(o.status, 0):
                o.status = kind
        if kind == "shipped":
            o.shipped_at = o.shipped_at or m["date"]
            # un envoi (souvent partiel) : les lignes qu'il contient passent « en route », et il est garde avec son suivi
            cur = json.loads(o.items_json or "[]")
            sent = []
            for p_ in parsed:
                tgt = next((i for i in cur if i.get("kind") == "filament" and (i.get("shipped") or 0) < (i.get("qty") or 0)
                            and ((p_.get("fila_color_code") and p_["fila_color_code"] == i.get("fila_color_code"))
                                 or _fold(p_["title"]) == _fold(i.get("title")))), None)
                if tgt is not None:
                    tgt["shipped"] = min(int(tgt.get("qty") or 0), int(tgt.get("shipped") or 0) + int(p_.get("qty") or 1))
                    sent.append(tgt.get("name_fr") or tgt.get("title"))
            ships = json.loads(o.shipments_json or "[]")
            if not any(sh.get("tracking") == tno for sh in ships if tno) or not tno:
                ships.append({"at": m["date"].isoformat(), "carrier": carrier, "tracking": tno, "url": url, "items": sent or [p_["title"] for p_ in parsed]})
            if not parsed:                       # pas de detail d'articles : tout est en route
                for i in cur:
                    if i.get("kind") == "filament":
                        i["shipped"] = i.get("qty") or 0
            o.items_json = json.dumps(cur, ensure_ascii=False)
            o.shipments_json = json.dumps(ships, ensure_ascii=False)
        if kind == "delivered":
            o.delivered_at = o.delivered_at or m["date"]
        if url:
            o.tracking_url, o.carrier = url, carrier
        if kind == "cancelled":
            o.done = True
        if store and not o.store:
            o.store = store
        cur = json.loads(o.items_json or "[]")
        if cur and not o.done:
            o.done = all((i.get("received") or 0) >= (i.get("qty") or 0) for i in cur if i.get("kind") == "filament")
            _settle(o)
        elif not cur and o.status in ("confirmed", "shipped") and (o.ordered_at or m["date"]) < datetime.utcnow() - timedelta(days=AUTO_CLOSE_DAYS):
            o.done = True                      # une expedition de plus de deux mois sans lignes connues : rien a suivre
        await db.commit()
        oid, status, items_now = o.id, o.status, json.loads(o.items_json or "[]")
    if notify:
        try:
            from . import notify_events as NE
            # une vieille commande fermee par anciennete : une notification « a confirmer » plutot qu'une confirmation
            assumed = res == "created" and any(i.get("assumed") for i in items_now)
            NE._spawn(NE.order_mail, oid, "assumed" if assumed else kind, [p_["title"] for p_ in parsed] if kind == "shipped" else None)
        except Exception:
            pass
    return res


# ── A venir, et l'arrivee des bobines ─────────────────────────────────────────
def _item_view(it: dict) -> dict:
    return {k: it.get(k) for k in ("title", "qty", "received", "kind", "fila_type", "name_fr", "color_hex", "filament_id", "refill",
                                   "fila_color_code", "auto", "assumed", "confirmed", "shipped")}


async def one(order_id: int) -> dict | None:
    """Une commande seule (la fenetre dediee), meme finie ou cachee."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.mail_order import MailOrder
    async with AsyncSessionLocal() as db:
        o = await db.get(MailOrder, order_id)
        if not o:
            return None
        rows = [o]
    return _views(rows)[0]


async def incoming(include_done: bool = False) -> list[dict]:
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.mail_order import MailOrder
    async with AsyncSessionLocal() as db:
        q = select(MailOrder).where(MailOrder.hidden.is_(False)).order_by(MailOrder.ordered_at.desc())
        rows = (await db.execute(q)).scalars().all()
    views = _views(rows)
    # sans include_done : ce qui attend encore, et les commandes fermees par anciennete pas encore confirmees
    return views if include_done else [v for v in views if not v["done"] or v["to_confirm"] > 0]


def _views(rows) -> list[dict]:
    out = []
    for o in rows:
        items = [_item_view(i) for i in json.loads(o.items_json or "[]")]
        stage = "cancelled" if o.status == "cancelled" else "delivered" if (o.status == "delivered" or o.done) else \
            "shipping" if o.status == "shipped" else "ordered"
        out.append({"id": o.id, "order_no": o.order_no, "store": o.store, "status": o.status, "stage": stage, "ordered_at": o.ordered_at,
                    "shipped_at": o.shipped_at, "delivered_at": o.delivered_at, "tracking_url": o.tracking_url, "carrier": o.carrier,
                    "done": bool(o.done), "hidden": bool(o.hidden), "items": items, "shipments": json.loads(o.shipments_json or "[]"),
                    "pending": sum(max(0, (i.get("qty") or 0) - (i.get("received") or 0)) for i in items if i.get("kind") == "filament"),
                    "to_confirm": sum(int(i.get("assumed") or 0) for i in items if not i.get("confirmed"))})
    return out


async def mark(order_id: int, index: int | None = None, received: bool = True, hide: bool | None = None,
               confirm: bool = False) -> dict | None:
    """Coche (ou decoche) une ligne a la main ; hide : cache la commande ; confirm : les lignes presumees recues
    sont confirmees (ou, index donne et received False, la ligne repasse attendue)."""
    from ..db.session import AsyncSessionLocal
    from ..models.mail_order import MailOrder
    async with AsyncSessionLocal() as db:
        o = await db.get(MailOrder, order_id)
        if not o:
            return None
        items = json.loads(o.items_json or "[]")
        if index is not None and 0 <= index < len(items):
            it = items[index]
            it["received"] = (it.get("qty") or 1) if received else 0
            it["assumed"] = 0
            it["confirmed"] = bool(received)
        if confirm:
            for it in items:
                if it.get("assumed"):
                    it["confirmed"] = True
        o.items_json = json.dumps(items, ensure_ascii=False)
        if hide is not None:
            o.hidden = bool(hide)
        o.done = all((i.get("received") or 0) >= (i.get("qty") or 0) for i in items if i.get("kind") == "filament") if items else o.done
        if not o.done and o.status == "delivered" and not o.delivered_at:
            o.status = "shipped"                      # une ligne rouverte : la commande n'est plus « livree par anciennete »
        elif not o.done and o.status == "delivered":
            o.status = "shipped"
        _settle(o)
        await db.commit()
    return (await incoming(include_done=True))


def _settle(o) -> None:
    """Tout est arrive (coche a la main ou bobines scannees) : la commande est livree, meme sans mail de livraison."""
    if o.done and o.status in ("confirmed", "shipped"):
        o.status = "delivered"
        o.delivered_at = o.delivered_at or datetime.utcnow()


async def spool_arrived(filament) -> int:
    """Une bobine de ce filament vient d'etre ajoutee (a la main ou par scan) : la ligne de commande qui
    l'attendait est comptee comme recue (la plus ancienne d'abord). Rend le nombre de lignes touchees."""
    from sqlalchemy import select
    from ..db.session import AsyncSessionLocal
    from ..models.mail_order import MailOrder
    if filament is None:
        return 0
    n = 0
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(MailOrder).where(MailOrder.done.is_(False), MailOrder.status != "cancelled")
                                 .order_by(MailOrder.ordered_at))).scalars().all()
        for o in rows:
            items = json.loads(o.items_json or "[]")
            hit = False
            for it in items:
                if it.get("kind") != "filament" or (it.get("received") or 0) >= (it.get("qty") or 0):
                    continue
                same = (it.get("filament_id") == filament.id) or \
                       (it.get("fila_color_code") and str(it["fila_color_code"]) == str(getattr(filament, "fila_color_code", "") or "")) or \
                       (it.get("fila_id") and it["fila_id"] == getattr(filament, "profile_id", None)
                        and (it.get("color_hex") or "").lower() == (filament.color or "").lower()[:6])
                if same:
                    it["received"] = (it.get("received") or 0) + 1
                    it["filament_id"] = filament.id
                    hit = True
                    n += 1
                    break
            if hit:
                o.items_json = json.dumps(items, ensure_ascii=False)
                o.done = all((i.get("received") or 0) >= (i.get("qty") or 0) for i in items if i.get("kind") == "filament")
                _settle(o)
                await db.commit()
                break
    return n


# ── La boucle ──────────────────────────────────────────────────────────────────
async def loop() -> None:
    from ..core import tasks as _tasks
    await _tasks.sleep("mail", 180)
    while True:
        try:
            cfg = await settings_get()
            if cfg["enabled"] and cfg["user"] and cfg["has_password"]:
                await sync("auto")
            every = max(1, int(cfg.get("every_h") or 3))
        except Exception:
            logger.exception("[MAIL] boucle")
            every = 3
        await _tasks.sleep("mail", every * 3600)
