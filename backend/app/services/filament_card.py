"""
La carte des filaments d'un partage Telegram (30/10/2026).

Le texte de Telegram n'a pas de couleur libre : la legende ne peut montrer qu'un rond emoji approchant (🔴 🟠 🟡…).
Cette image, jointe a l'album, montre chaque filament comme l'appli (utils/colors.js) : sa couleur exacte, ses
couleurs en degrade ou en tranches, sa transparence (damier) et sa finition (soie, metal, paillettes, galaxie,
marbre, bois, carbone, phosphorescent, mat), avec son nom et le poids utilise.
"""
import io
import math
import os
import random
from typing import Optional

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W = 1080                     # la largeur de la carte (Telegram la garde telle quelle)
PAD = 36
BG = (248, 250, 252)
TEXT = (15, 23, 42)
MUTED = (100, 116, 139)
TILE = 256                   # le motif d'une finition, repete (le palier « lg » de l'appli, dessine en double)


def _font(size: int, bold: bool = False):
    """DejaVu (Debian), sinon la Vera livree avec reportlab, sinon la police de Pillow."""
    names = ["DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", "VeraBd.ttf" if bold else "Vera.ttf"]
    dirs = ["/usr/share/fonts/truetype/dejavu"]
    try:
        import reportlab
        dirs.append(os.path.join(os.path.dirname(reportlab.__file__), "fonts"))
    except ImportError:
        pass
    for d in dirs:
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def _rgba(h: str) -> Optional[tuple]:
    h = str(h or "").strip().lstrip("#")
    try:
        if len(h) >= 8:
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4, 6))
        if len(h) >= 6:
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    except ValueError:
        return None
    return None


def colors_of(color: Optional[str], colors_array: Optional[str]) -> list:
    """Comme parseColorsList de l'appli : la liste des couleurs, l'alpha du filament reporte sur chacune."""
    main = _rgba(color)
    alpha = main[3] if main and len(str(color or "").strip().lstrip("#")) >= 8 else None
    out = []
    for c in str(colors_array or "").split(","):
        v = _rgba(c)
        if v:
            out.append(v[:3] + (alpha,) if alpha is not None and len(c.strip().lstrip("#")) < 8 else v)
    return out or ([main] if main else [])


def _dark(c) -> bool:
    return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 < 95


def _grad(w: int, h: int, deg: float, stops: list) -> np.ndarray:
    """linear-gradient(deg, stops) de CSS : stops = [(position 0..1, (r, g, b, a 0..1))] -> tableau h x w x 4."""
    th = math.radians(deg)
    dx, dy = math.sin(th), -math.cos(th)
    L = abs(w * dx) + abs(h * dy)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    t = ((xs + 0.5 - w / 2) * dx + (ys + 0.5 - h / 2) * dy) / L + 0.5
    pos = np.array([s[0] for s in stops], np.float32)
    out = np.zeros((h, w, 4), np.float32)
    for k in range(4):
        out[..., k] = np.interp(t, pos, np.array([s[1][k] for s in stops], np.float32))
    return out


def _over(base: np.ndarray, layer: np.ndarray) -> np.ndarray:
    """Pose layer (rgba 0..1, couleurs non premultipliees) sur base (rgb 0..1)."""
    a = layer[..., 3:4]
    return base * (1 - a) + layer[..., :3] * a


def _tile(f: str, dark: bool) -> Optional[Image.Image]:
    """Le motif d'une finition (utils/finishTex, palier lg), fond transparent, raccordable par ses bords."""
    if f not in ("sparkle", "galaxy", "marble", "wood", "carbon"):
        return None
    n, k = TILE, TILE / 128
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    g = ImageDraw.Draw(im, "RGBA")
    rnd = random.Random(f"{f}{dark}").random

    def col(c, a):
        return c + (int(a * 255),)

    def dots(cnt, cols, rmin, rmax):
        for i in range(cnt):
            x, y, r = rnd() * n, rnd() * n, (rmin + rnd() * (rmax - rmin)) * k
            for ox in (-n, 0, n):
                for oy in (-n, 0, n):
                    g.ellipse((x + ox - r, y + oy - r, x + ox + r, y + oy + r), fill=cols[i % len(cols)])

    if f == "marble":
        if dark:
            G = [col((255, 255, 255), .3), col((230, 225, 215), .22), col((255, 255, 255), .4), col((0, 0, 0), .25)]
            B = [col((255, 255, 255), .34), col((230, 225, 215), .28)]
        else:
            G = [col((38, 26, 22), .42), col((60, 44, 36), .3), col((38, 26, 22), .55), col((255, 255, 255), .22)]
            B = [col((38, 26, 22), .5), col((60, 44, 36), .4)]
        dots(110, G, 0.5, 1.5)
        dots(16, B, 1.3, 2.5)
        vein = (255, 255, 255) if dark else (38, 26, 22)
        for _ in range(5):
            x0, y0, ln, ang = rnd() * n, rnd() * n, n * (0.25 + rnd() * 0.35), rnd() * math.pi
            amp, ph = (1.5 + rnd() * 2.5) * k, rnd() * 7
            pts = []
            for t in range(0, int(ln) + 1, 2):
                w = amp * math.sin(t / k * 0.25 + ph) + amp * 0.5 * math.sin(t / k * 0.7 + ph * 2)
                pts.append((x0 + t * math.cos(ang) - w * math.sin(ang), y0 + t * math.sin(ang) + w * math.cos(ang)))
            g.line(pts, fill=col(vein, 0.06 + rnd() * 0.08), width=max(1, round((0.5 + rnd() * 0.6) * k)))
    elif f == "sparkle":
        dots(220, [col((255, 255, 255), .95), col((255, 255, 255), .7), col((230, 230, 230), .5)], 0.35, 0.9)
    elif f == "galaxy":
        dots(260, [col((157, 184, 255), .9), col((216, 180, 255), .85), col((122, 162, 255), .8), col((255, 255, 255), .95)], 0.35, 0.9)
    elif f == "wood":
        y = 0.0
        while y < n:                                   # de larges bandes plus ou moins foncees, puis les veines
            h = n * (0.04 + rnd() * 0.09)
            c = col((70, 38, 12), .05 + rnd() * .08) if rnd() < 0.5 else col((255, 236, 205), .05 + rnd() * .08)
            g.rectangle((0, y, n, y + h), fill=c)
            y += h
        lines = 22
        for i in range(lines):
            y0 = i / lines * n + rnd() * (n / lines) * 0.8
            amp, fr, ph = n * (0.006 + rnd() * 0.014), 2 * math.pi / n * (1 + int(rnd() * 2)), rnd() * 7
            pts = [(x, y0 + amp * math.sin(x * fr + ph) + amp * 0.25 * math.sin(x * fr * 3 + ph * 2)) for x in range(-2, n + 3, 2)]
            strong = rnd() < 0.35
            c = col((70, 38, 12), .55 + rnd() * .25) if strong else (col((70, 38, 12), .18 + rnd() * .2) if rnd() < 0.5
                                                                     else col((255, 236, 205), .25 + rnd() * .2))
            g.line(pts, fill=c, width=max(1, round(((1.6 + rnd() * 1.6) if strong else (0.6 + rnd() * 1.2)) * k)))
    elif f == "carbon":
        t = n // 16
        for yy in range(0, n, t):
            for xx in range(0, n, t):
                horiz = ((xx + yy) // t) % 2 == 0
                gr = _grad(t, t, 90 if horiz else 180, [(0, (0, 0, 0, .35)), (.5, (1, 1, 1, .18)), (1, (0, 0, 0, .35))])
                im.alpha_composite(Image.fromarray((gr * 255).astype(np.uint8), "RGBA"), (xx, yy))
    return im


def swatch(colors: list, mtype: Optional[str], finish: Optional[str], size: int) -> Image.Image:
    """Une case de filament, comme colorBg de l'appli : couleur(s), damier sous la transparence, finition dessus."""
    s = size
    base = np.ones((s, s, 3), np.float32)
    if any(c[3] < 255 for c in colors):                    # le damier, sous la couleur translucide
        ck = max(8, s // 24)
        ys, xs = np.mgrid[0:s, 0:s]
        on = ((xs // ck + ys // ck) % 2) == 0
        base[:] = 240 / 255
        base[on] = 192 / 255
    if len(colors) == 1:
        c = colors[0]
        layer = np.empty((s, s, 4), np.float32)
        layer[...] = [c[0] / 255, c[1] / 255, c[2] / 255, c[3] / 255]
    elif mtype == "gradient":
        n = len(colors)
        layer = _grad(s, s, 90, [(i / (n - 1), tuple(v / 255 for v in c)) for i, c in enumerate(colors)])
    else:                                                    # coaxial : des tranches nettes
        n = len(colors)
        layer = np.empty((s, s, 4), np.float32)
        for i, c in enumerate(colors):
            layer[:, round(i * s / n):round((i + 1) * s / n)] = [v / 255 for v in c]
    img = _over(base, layer)
    dark = _dark(colors[0])
    if finish == "silk":
        img = _over(img, _grad(s, s, 115, [(0, (0, 0, 0, .2)), (.3, (0, 0, 0, 0)), (.7, (0, 0, 0, 0)), (1, (0, 0, 0, .2))]))
        img = _over(img, _grad(s, s, 115, [(0, (1, 1, 1, 0)), (.22, (1, 1, 1, 0)), (.45, (1, 1, 1, .55)), (.62, (1, 1, 1, 0)), (1, (1, 1, 1, 0))]))
    elif finish == "metal":
        img = _over(img, _grad(s, s, 135, [(0, (1, 1, 1, .55)), (.35, (1, 1, 1, 0)), (.6, (0, 0, 0, .3)), (.85, (1, 1, 1, .35)), (1, (1, 1, 1, .35))]))
    elif finish == "matte":
        img = _over(img, _grad(s, s, 180, [(0, (1, 1, 1, .07)), (1, (0, 0, 0, .07))]))
    elif finish == "glow":
        ys, xs = np.mgrid[0:s, 0:s].astype(np.float32)
        d = np.hypot(xs - s / 2, ys - s / 2) / (s / 2 * math.sqrt(2))      # radial-gradient(circle) : jusqu'au coin
        lay = np.empty((s, s, 4), np.float32)
        lay[..., 0], lay[..., 1], lay[..., 2] = 235 / 255, 1.0, 215 / 255
        lay[..., 3] = np.interp(d, [0, .35, .7, 1], [.85, .45, 0, 0])
        img = _over(img, lay)
    elif finish == "galaxy":
        img = _over(img, _grad(s, s, 125, [(0, (1, 1, 1, 0)), (.25, (1, 1, 1, 0)), (.45, (200 / 255, 190 / 255, 1, .16)), (.65, (1, 1, 1, 0)), (1, (1, 1, 1, 0))]))
    out = Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").convert("RGBA")
    tile = _tile(finish, dark)
    if tile:
        pat = Image.new("RGBA", (s, s))
        for y in range(0, s, TILE):
            for x in range(0, s, TILE):
                pat.paste(tile, (x, y))
        out.alpha_composite(pat)
    return out


def _fit(draw, text: str, font, width: int) -> str:
    if draw.textlength(text, font=font) <= width:
        return text
    while text and draw.textlength(text + "…", font=font) > width:
        text = text[:-1]
    return text.rstrip() + "…"


def _lines(draw, text: str, font, width: int, most: int = 2) -> list:
    """Le nom sur deux lignes au plus, coupe aux espaces."""
    words, out, cur = text.split(), [], ""
    for w in words:
        t = f"{cur} {w}".strip()
        if draw.textlength(t, font=font) <= width or not cur:
            cur = t
        else:
            out.append(cur)
            cur = w
    if cur:
        out.append(cur)
    if len(out) > most:
        out = out[:most - 1] + [" ".join(out[most - 1:])]
    return [_fit(draw, l, font, width) for l in out]


def render(rows: list) -> Optional[bytes]:
    """rows : [{name, sub, weight, colors, mtype, finish}] -> JPEG ; None sans filament colore.
    Une case par filament, en grille presque carree (Telegram recadre les images d'un album en mosaique)."""
    rows = [r for r in rows if r.get("colors")]                    # tous : il ne doit en manquer aucun
    if not rows:
        return None
    n = len(rows)
    cols = 1 if n == 1 else 2 if n <= 4 else 3 if n <= 9 else 4
    gap = 28
    cw = (W - 2 * PAD - (cols - 1) * gap) // cols
    sw = cw if n > 1 else min(cw, 640)
    f_name, f_sub, f_w = _font((42, 42, 32, 26)[cols - 1], True), _font((28, 28, 23, 19)[cols - 1]), _font((36, 36, 28, 23)[cols - 1], True)
    tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    lh = lambda f: f.getbbox("Ag")[3] + 8
    # la place des textes : ce que prend le plus long (un nom sur deux lignes, des details)
    tw0 = min(cw, 640) if n == 1 else cw
    nl = max(len(_lines(tmp, r["name"], f_name, tw0)) for r in rows)
    text_h = nl * lh(f_name) + (lh(f_sub) if any(r.get("sub") for r in rows) else 0) + lh(f_w) + 14
    nrows = math.ceil(n / cols)
    H = PAD * 2 + nrows * (sw + 18 + text_h) + (nrows - 1) * gap
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    for i, r in enumerate(rows):
        cx, cy = PAD + (i % cols) * (cw + gap), PAD + (i // cols) * (sw + 18 + text_h + gap)
        x0 = cx + (cw - sw) // 2
        tx, tw = (x0, sw) if n == 1 else (cx, cw)
        sq = swatch(r["colors"], r.get("mtype"), r.get("finish"), sw)
        rad = sw // 7
        mask = Image.new("L", (sw * 3, sw * 3), 0)                      # coins arrondis, lisses (trace a x3)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw * 3 - 1, sw * 3 - 1), rad * 3, fill=255)
        mask = mask.resize((sw, sw), Image.LANCZOS)
        if r.get("finish") == "glow":                                  # le phosphorescent : un halo autour
            halo = Image.new("RGBA", (sw + 80, sw + 80), (0, 0, 0, 0))
            halo.paste(r["colors"][0][:3] + (170,), (40, 40), mask)
            im.paste(halo.filter(ImageFilter.GaussianBlur(16)), (x0 - 40, cy - 40), halo.filter(ImageFilter.GaussianBlur(16)))
        shadow = Image.new("RGBA", (sw + 40, sw + 40), (0, 0, 0, 0))
        shadow.paste((30, 41, 59, 60), (20, 26), mask)
        shadow = shadow.filter(ImageFilter.GaussianBlur(9))
        im.paste(shadow, (x0 - 20, cy - 20), shadow)
        im.paste(sq.convert("RGB"), (x0, cy), mask)
        d.rounded_rectangle((x0, cy, x0 + sw - 1, cy + sw - 1), rad, outline=(203, 213, 225), width=2)
        y = cy + sw + 18
        for line in _lines(d, r["name"], f_name, tw):
            d.text((tx, y), line, font=f_name, fill=TEXT)
            y += lh(f_name)
        if r.get("sub"):
            d.text((tx, y), _fit(d, r["sub"], f_sub, tw), font=f_sub, fill=MUTED)
            y += lh(f_sub)
        if r.get("weight"):
            d.text((tx, y + 4), r["weight"], font=f_w, fill=TEXT)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92, subsampling=0)
    return buf.getvalue()
