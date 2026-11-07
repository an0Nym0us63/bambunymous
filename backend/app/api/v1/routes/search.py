"""
La recherche globale (04/11/2026) : une seule barre, des resultats par categorie -- impressions, groupes, modeles
MakerWorld, filaments, bobines, objets, pages du guide. Lecture seule : un compte en lecture seule et un copain (par
le relais) cherchent aussi ; le guide reste aux comptes de la maison, comme sa route.

Chaque mot doit se trouver quelque part, n'importe ou dans un champ, sans accents ni majuscules (07/11/2026, comme
la recherche des impressions : « deco » trouve « Déco ») ; tous les mots doivent se retrouver, chacun dans l'un des
champs de la categorie. Les impressions cherchent partout (categories, etiquettes, filaments, teintes, createur...),
avec la condition meme de leur page.
"""
import html as _html
import re
import unicodedata
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select

from ....db.session import AsyncSessionLocal
from .auth import get_current_user, oauth2_scheme

router = APIRouter()

PER = 5                                    # resultats montres par categorie
GUIDE = Path(__file__).resolve().parents[4] / "guide" / "pages"
CHAPTERS = ["premiers-pas", "accueil", "tuiles", "imprimante", "impressions", "filaments", "objets", "stats",
            "makerworld", "notifications", "copains", "succes", "parametres"]


def _words(q: str) -> list:
    return [m for m in (q or "").split() if m][:8]


def _cond(cols: list, words: list):
    """Chaque mot se trouve dans l'un des champs, n'importe ou, sans accents (ET entre les mots)."""
    from ....db.textsearch import contains
    return and_(*(or_(*(contains(c, m) for c in cols)) for m in words))


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _norm(s)).strip("-")


class _Guide(HTMLParser):
    """Les parties d'un chapitre du guide : {id, title, text}, avec les memes ancres que la page Guide (l'id du titre,
    celui de sa section s'il en est le premier titre, sinon le slug de son texte)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.sections = [], []        # sections : [id, a deja son premier titre]
        self.h, self.hid, self.htxt, self.chap = None, None, "", ""
        self.shown, self.badge = "", 0           # le titre sans ses pastilles (« admin ») ; l'ancre, elle, les compte
        self.cur = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.h and tag == "span" and ("admin" in (a.get("class") or "").split() or self.badge):
            self.badge += 1
        if tag == "section":
            self.sections.append([a.get("id"), False])
        elif tag in ("h1", "h2", "h3", "h4"):
            self.h, self.htxt, self.shown, self.badge = tag, "", "", 0
            sec = self.sections[-1] if self.sections else None
            first = bool(sec and not sec[1])
            if sec:
                sec[1] = True
            self.hid = a.get("id") or (sec[0] if first and sec[0] else None)

    def handle_endtag(self, tag):
        if self.h and tag == "span" and self.badge:
            self.badge -= 1
            return
        if tag == "section" and self.sections:
            self.sections.pop()
        elif tag == self.h:
            t, shown = " ".join(self.htxt.split()), " ".join(self.shown.split())
            if tag == "h1":
                self.chap = shown or t
            else:
                self.cur = {"id": self.hid or _slug(t), "title": shown or t, "text": ""}
                self.blocks.append(self.cur)
            self.h = None

    def handle_data(self, data):
        if self.h:
            self.htxt += data
            if not self.badge:
                self.shown += data
        elif self.cur is not None:
            self.cur["text"] += data


_GUIDE_CACHE: dict = {}


def _guide_index() -> list:
    out = []
    for name in CHAPTERS:
        f = GUIDE / f"{name}.html"
        try:
            mt = f.stat().st_mtime
        except OSError:
            continue
        hit = _GUIDE_CACHE.get(name)
        if not hit or hit[0] != mt:
            p = _Guide()
            p.feed(f.read_text(encoding="utf-8"))
            blocks = [{**b, "chap": p.chap or name, "file": name, "n_title": _norm(b["title"]),
                       "n_text": _norm(" ".join(b["text"].split()))} for b in p.blocks]
            blocks.insert(0, {"id": name, "title": p.chap or name, "chap": p.chap or name, "file": name, "text": "",
                              "n_title": _norm(p.chap or name), "n_text": ""})
            hit = _GUIDE_CACHE[name] = (mt, blocks)
        out += hit[1]
    return out


def _guide(words: list) -> list:
    ws = [_norm(w) for w in words]
    starts = lambda t, w: w in t
    found = []
    for b in _guide_index():
        if not all(starts(b["n_title"], w) or starts(b["n_text"], w) for w in ws):
            continue
        score = sum(2 if starts(b["n_title"], w) else 0 for w in ws)
        snip = ""
        if b["n_text"]:
            i = b["n_text"].find(ws[0])
            t = " ".join(b["text"].split())
            if i >= 0:
                a = max(0, i - 40)
                snip = ("…" if a else "") + t[a:a + 120].strip() + "…"
        found.append((score, {"title": b["title"], "sub": b["chap"] if b["id"] != b["file"] else "Chapitre du guide",
                              "snippet": snip, "to": f"/guide#{b['id']}", "icon": "📘"}))
    found.sort(key=lambda x: -x[0])
    return [x[1] for x in found]


@router.get("")
async def search(q: str = Query("", max_length=120), _: str = Depends(get_current_user), token: str = Depends(oauth2_scheme)):
    """{q, groups: [{key, label, icon, color, total, items: [{title, sub, img, mw, swatch, to}], more}]}"""
    from ....models.print_history import Print, Group, MakerWorldDesign as MW
    from ....models.filament import Filament, Spool
    from ....models.object_history import Object
    words = _words(q)
    if not words or len(" ".join(words)) < 2:
        return {"q": q, "groups": []}
    groups = []
    async with AsyncSessionLocal() as db:
        async def run(stmt, count_stmt):
            rows = (await db.execute(stmt.limit(PER))).all()
            total = (await db.execute(count_stmt)).scalar() or 0 if len(rows) >= PER else len(rows)
            return rows, total

        # impressions : leur nom (pas leurs filaments, qui ont leur categorie) et le modele MakerWorld
        from .prints import _search_condition
        c = _search_condition(" ".join(words))      # partout, comme la page Impressions (07/11/2026)
        rows, total = await run(select(Print.id, Print.translated_name, Print.file_name, Print.print_date, Print.status)
                                .where(c).order_by(Print.print_date.desc()),
                                select(func.count(Print.id)).where(c))
        if rows:
            groups.append({"key": "prints", "label": "Impressions", "icon": "🖨️", "color": "#3B82F6", "total": total,
                           "more": f"/prints?q={quote(q.strip())}",
                           "items": [{"title": r.translated_name or r.file_name or f"Impression {r.id}",
                                      "sub": " · ".join(x for x in (r.print_date.strftime("%d/%m/%Y") if r.print_date else "",
                                                                    {"SUCCESS": "réussie", "FAILED": "échouée", "CANCELLED": "annulée",
                                                                     "PARTIAL": "partielle"}.get(r.status or "", "")) if x),
                                      "img": f"/prints/{r.id}/image", "to": f"/prints?id={r.id}"} for r in rows]})
        # groupes
        c = _cond([Group.name], words)
        n_prints = select(func.count(Print.id)).where(Print.group_id == Group.id).scalar_subquery()
        rows, total = await run(select(Group.id, Group.name, Group.cover_print_id, n_prints.label("n")).where(c)
                                .order_by(Group.created_at.desc()), select(func.count(Group.id)).where(c))
        if rows:
            firsts = {}
            need = [r.id for r in rows if not r.cover_print_id]
            if need:
                for gid, pid in (await db.execute(select(Print.group_id, func.max(Print.id)).where(Print.group_id.in_(need))
                                                  .group_by(Print.group_id))).all():
                    firsts[gid] = pid
            groups.append({"key": "groups", "label": "Groupes", "icon": "🗂️", "color": "#8B5CF6", "total": total,
                           "items": [{"title": r.name, "sub": f"{r.n} impression{'s' if (r.n or 0) > 1 else ''}",
                                      "img": f"/prints/{r.cover_print_id or firsts.get(r.id)}/image" if (r.cover_print_id or firsts.get(r.id)) else None,
                                      "to": f"/prints?group={r.id}"} for r in rows]})
        # modeles MakerWorld connus
        c = and_(MW.status == "ok", _cond([MW.title, MW.title_fr, MW.creator_name, MW.tags], words))
        rows, total = await run(select(MW.design_id, MW.title, MW.title_fr, MW.creator_name, MW.cover_url).where(c)
                                .order_by(MW.design_id.desc()), select(func.count(MW.design_id)).where(c))
        if rows:
            groups.append({"key": "models", "label": "Modèles MakerWorld", "icon": "🌐", "color": "#06B6D4", "total": total,
                           "items": [{"title": _html.unescape(r.title_fr or r.title or f"Modèle {r.design_id}"),
                                      "sub": f"par {r.creator_name}" if r.creator_name else "", "mw": r.cover_url,
                                      "to": f"?model={r.design_id}"} for r in rows]})
        # createurs (04/11/2026) : ceux des modeles de ma bibliotheque, avec mes impressions de leurs modeles ; toucher
        # mene a ces impressions
        c = _cond([MW.creator_name, MW.creator_handle], words)
        n_mine = func.count(func.distinct(Print.id))
        rows = (await db.execute(select(MW.creator_name, MW.creator_uid, func.max(MW.creator_avatar).label("avatar"),
                                        func.count(func.distinct(MW.design_id)).label("models"), n_mine.label("prints"))
                                 .outerjoin(Print, Print.design_id == MW.design_id)
                                 .where(and_(c, MW.creator_name.isnot(None)))
                                 .group_by(MW.creator_name, MW.creator_uid).order_by(n_mine.desc()).limit(PER + 1))).all()
        if rows:
            groups.append({"key": "creators", "label": "Créateurs", "icon": "🎨", "color": "#EC4899", "total": len(rows[:PER]),
                           "items": [{"title": r.creator_name,
                                      "sub": " · ".join(x for x in (f"{r.prints} impression{'s' if r.prints > 1 else ''}" if r.prints else "aucune impression",
                                                                    f"{r.models} modèle{'s' if r.models > 1 else ''}") if x),
                                      "mw": r.avatar, "round": True,
                                      "to": f"/prints?q={quote(r.creator_name)}"} for r in rows[:PER]]})
        # filaments (references)
        fcols = [Filament.name, Filament.translated_name, Filament.manufacturer, Filament.material, Filament.fila_type]
        c = _cond(fcols, words)
        rows, total = await run(select(Filament.id, Filament.name, Filament.translated_name, Filament.manufacturer,
                                       Filament.material, Filament.fila_type, Filament.color).where(c).order_by(Filament.name),
                                select(func.count(Filament.id)).where(c))
        if rows:
            groups.append({"key": "filaments", "label": "Filaments", "icon": "🧵", "color": "#F59E0B", "total": total,
                           "items": [{"title": r.translated_name or r.name,
                                      "sub": " · ".join(x for x in (r.manufacturer, r.fila_type or r.material) if x),
                                      "swatch": f"#{str(r.color)[:6]}" if r.color else None, "to": f"/filaments?id={r.id}"} for r in rows]})
        # bobines (en stock) : celles du filament, ou leur emplacement
        c = and_(Spool.archived.is_(False), _cond(fcols + [Spool.location], words))
        rows, total = await run(select(Spool.id, Spool.filament_id, Spool.remaining_weight_g, Spool.location, Spool.ams_tray,
                                       Filament.name, Filament.translated_name, Filament.manufacturer, Filament.color)
                                .join(Filament, Filament.id == Spool.filament_id).where(c).order_by(Filament.name, Spool.id),
                                select(func.count(Spool.id)).join(Filament, Filament.id == Spool.filament_id).where(c))
        if rows:
            groups.append({"key": "spools", "label": "Bobines", "icon": "🎞️", "color": "#EA580C", "total": total,
                           "items": [{"title": r.translated_name or r.name,
                                      "sub": " · ".join(x for x in (f"{round(r.remaining_weight_g)} g" if r.remaining_weight_g is not None else "",
                                                                    r.ams_tray and f"AMS {r.ams_tray}", r.location, r.manufacturer) if x),
                                      "swatch": f"#{str(r.color)[:6]}" if r.color else None,
                                      "to": f"/filaments?spool={r.id}&id={r.filament_id}"} for r in rows]})
        # objets
        c = _cond([Object.name, Object.translated_name], words)
        rows, total = await run(select(Object.id, Object.name, Object.translated_name, Object.status, Object.sold_price)
                                .where(c).order_by(Object.created_at.desc()), select(func.count(Object.id)).where(c))
        if rows:
            st = {"available": "disponible", "sold": "vendu", "personal": "à moi", "gifted": "offert", "unavailable": "indisponible"}
            groups.append({"key": "objects", "label": "Objets", "icon": "📦", "color": "#10B981", "total": total,
                           "items": [{"title": r.translated_name or r.name, "sub": st.get(r.status or "", r.status or ""),
                                      "img": f"/objects/objects/{r.id}/image", "to": f"/objects?id={r.id}"} for r in rows]})
    # le guide : seulement chez soi (pas pour une cle de copain)
    if not str(token or "").startswith("fk_"):
        g = _guide(words)
        if g:
            groups.append({"key": "guide", "label": "Guide", "icon": "📘", "color": "#64748B", "total": len(g), "items": g[:PER]})
    return {"q": q, "groups": groups}
