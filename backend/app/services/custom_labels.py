"""Planche d'etiquettes libres (09/11/2026) : des textes, chacun sa couleur de fond et de texte, sur le format de la planche
du modele Word (Etiquette.docx) : A4, etiquettes de 20 x 10 mm, 4 mm entre elles dans les deux sens, 8 colonnes centrees,
13,5 mm en haut ; 20 rangees, 160 etiquettes par planche. Les cotes sont exactes (reportlab, en millimetres) : a imprimer
a 100 %, sans « ajuster a la page »."""
from io import BytesIO

LABEL_W, LABEL_H, GAP, TOP, COLS = 20.0, 10.0, 4.0, 13.5, 8
PAGE_W, PAGE_H = 210.0, 297.0
ROWS = int((PAGE_H - TOP + GAP) // (LABEL_H + GAP))          # 20
PER_PAGE = COLS * ROWS                                        # 160
LEFT = (PAGE_W - (COLS * LABEL_W + (COLS - 1) * GAP)) / 2     # 11 mm (centre, comme le tableau du modele)
PT_MAX = 11.0                                                 # le corps du modele (Calibri 11)


def _hex(v, dflt):
    s = str(v or "").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    try:
        return tuple(int(s[i:i + 2], 16) / 255 for i in (0, 2, 4)) if len(s) >= 6 else dflt
    except ValueError:
        return dflt


def _font():
    """(10/11/2026) Comfortaa Bold (arrondie, sympa et bien lisible petite ; paquet fonts-comfortaa de l'image), sinon
    DejaVu Sans Bold (accents, symboles), sinon Helvetica-Bold."""
    import os
    import glob
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    for p in [*glob.glob("/usr/share/fonts/**/Comfortaa-Bold.ttf", recursive=True), "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(p):
            try:
                pdfmetrics.registerFont(TTFont("LblBold", p))
                return "LblBold"
            except Exception:
                pass
    return "Helvetica-Bold"


def _lines(text: str, font: str, max_w: float, max_h: float):
    """La plus grande police (<= PT_MAX) qui fait tenir le texte en une ligne, sinon en deux (coupe aux espaces)."""
    from reportlab.pdfbase.pdfmetrics import stringWidth
    words = text.split()
    cands = [[text]]
    for i in range(1, len(words)):
        cands.append([" ".join(words[:i]), " ".join(words[i:])])
    best = None
    for ls in cands:
        pt = PT_MAX
        while pt > 3.5:
            if max(stringWidth(l, font, pt) for l in ls) <= max_w and len(ls) * pt * 1.15 <= max_h:
                break
            pt -= 0.25
        if best is None or pt > best[0] + 0.01:
            best = (pt, ls)
    return best


def _fill(c, rgb) -> None:
    """(10/11/2026) un gris (noir compris) en encre noire seule (CMYK K) : en RGB, l'imprimante le compose avec les
    couleurs et un noir sort grisatre ; un noir presque pur (#111) passe en noir franc"""
    r, g, b = rgb
    if abs(r - g) < 0.02 and abs(g - b) < 0.02:
        c.setFillColorCMYK(0, 0, 0, 1.0 if r < 0.1 else 1.0 - r)
    else:
        c.setFillColorRGB(r, g, b)


def render(items: list, skip: int = 0) -> bytes:
    """items : [{text, bg, fg, n}] (n : combien de fois) ; skip : etiquettes deja utilisees au debut de la premiere
    planche (une planche entamee)."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    cells = []
    for it in items[:400]:
        t = str(it.get("text") or "").strip()[:80]
        if not t:
            continue
        n = max(1, min(PER_PAGE * 5, int(it.get("n") or 1)))
        cells += [(t, _hex(it.get("bg"), (1, 1, 1)), _hex(it.get("fg"), (0, 0, 0)))] * n
    if not cells:
        raise ValueError("Aucun texte")
    cells = [None] * max(0, min(PER_PAGE - 1, int(skip or 0))) + cells
    font = _font()
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(PAGE_W * mm, PAGE_H * mm))
    c.setTitle("Planche d'étiquettes")
    pad = 0.8                                                  # mm de marge interieure pour le texte
    for i, cell in enumerate(cells):
        if i and i % PER_PAGE == 0:
            c.showPage()
        if cell is None:
            continue
        k = i % PER_PAGE
        r, col = divmod(k, COLS)
        x = (LEFT + col * (LABEL_W + GAP)) * mm
        y = (PAGE_H - TOP - LABEL_H - r * (LABEL_H + GAP)) * mm
        text, bg, fg = cell
        if bg != (1, 1, 1):
            _fill(c, bg)
            c.rect(x, y, LABEL_W * mm, LABEL_H * mm, stroke=0, fill=1)
        pt, ls = _lines(text, font, (LABEL_W - 2 * pad) * mm, (LABEL_H - 2 * pad) * mm)
        _fill(c, fg)
        c.setFont(font, pt)
        lh = pt * 1.15
        y0 = y + LABEL_H * mm / 2 + (len(ls) * lh) / 2 - pt * 0.85
        for li, l in enumerate(ls):
            c.drawCentredString(x + LABEL_W * mm / 2, y0 - li * lh, l)
    c.save()
    return buf.getvalue()
