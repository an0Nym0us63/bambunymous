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
import zlib
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


def material(colors: list, mtype: Optional[str], finish: Optional[str], w: int, h: int) -> Image.Image:
    """Un echantillon de matiere w x h (31/10/2026, « les effets de matiere pas assez visibles ») : la case de
    l'appli (couleur, degrade ou tranches, finition), puis la finition appuyee et les fines couches d'une piece
    imprimee. Le hasard est fixe : la meme carte se redessine a l'identique."""
    S = max(w, h)
    # le translucide : pas de damier (criard en grand), la couleur eclaircie comme a travers la lumiere
    glass = min(c[3] for c in colors) / 255 if any(c[3] < 255 for c in colors) else 1.0
    if glass < 1:
        colors = [c[:3] + (255,) for c in colors]
    img = np.asarray(swatch(colors, mtype, finish, S).convert("RGB"), np.float32)[(S - h) // 2:(S - h) // 2 + h, (S - w) // 2:(S - w) // 2 + w] / 255
    rng = np.random.default_rng(zlib.crc32(repr((colors, mtype, finish, w, h)).encode()))
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    dark = _dark(colors[0])
    if finish == "silk":                                           # deux grands reflets satines, plus un liseré vif
        img = _over(img, _grad(w, h, 105, [(0, (1, 1, 1, 0)), (.18, (1, 1, 1, 0)), (.32, (1, 1, 1, .5)), (.42, (1, 1, 1, 0)),
                                           (.62, (1, 1, 1, 0)), (.72, (1, 1, 1, .28)), (.8, (1, 1, 1, 0)), (1, (1, 1, 1, 0))]))
        img = _over(img, _grad(w, h, 105, [(0, (1, 1, 1, 0)), (.29, (1, 1, 1, 0)), (.315, (1, 1, 1, .4)), (.345, (1, 1, 1, 0)), (1, (1, 1, 1, 0))]))
    elif finish == "metal":                                        # brosse : des stries fines, et un reflet large
        n = rng.normal(0, 1, (h, max(2, w // 40))).astype(np.float32)
        streak = np.asarray(Image.fromarray(((n * 0.5 + 0.5).clip(0, 1) * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR), np.float32) / 255
        fine = rng.normal(0, 1, (h, 1)).astype(np.float32) * 0.035
        img = np.clip(img * (0.9 + 0.2 * streak)[..., None] + fine[..., None], 0, 1)
        img = _over(img, _grad(w, h, 100, [(0, (1, 1, 1, 0)), (.38, (1, 1, 1, 0)), (.5, (1, 1, 1, .45)), (.62, (1, 1, 1, 0)), (1, (1, 1, 1, 0))]))
    elif finish == "matte":                                        # le mat : un grain serre, aucun reflet
        img = np.clip(img + rng.normal(0, 0.028, (h, w, 1)).astype(np.float32), 0, 1)
    elif finish == "marble":                                       # de vraies veines, en plus des grains
        lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        g = ImageDraw.Draw(lay)
        vein = (255, 255, 255) if dark else (40, 28, 24)
        for _ in range(7):
            x0, y0 = rng.uniform(-0.2, 1.2) * w, rng.uniform(0, 1) * h
            ang, ln, amp, ph = rng.uniform(-0.6, 0.6), rng.uniform(0.5, 1.1) * w, rng.uniform(4, 14), rng.uniform(0, 7)
            pts = [(x0 + t * math.cos(ang) - (amp * math.sin(t / 23 + ph) + amp * 0.4 * math.sin(t / 7 + ph)) * math.sin(ang),
                    y0 + t * math.sin(ang) + (amp * math.sin(t / 23 + ph) + amp * 0.4 * math.sin(t / 7 + ph)) * math.cos(ang))
                   for t in np.arange(0, ln, 3)]
            g.line(pts, fill=vein + (int(rng.uniform(70, 140)),), width=int(rng.uniform(1, 4)))
        lay = np.asarray(lay.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
        img = _over(img, lay)
    elif finish in ("sparkle", "galaxy"):                          # des eclats plus gros, et quelques etoiles
        lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        g = ImageDraw.Draw(lay)
        cols = [(255, 255, 255), (230, 236, 255)] if finish == "sparkle" else [(170, 190, 255), (220, 185, 255), (255, 255, 255)]
        for i in range(int(w * h / 700)):
            x, y, r = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(0.6, 1.8)
            g.ellipse((x - r, y - r, x + r, y + r), fill=cols[i % len(cols)] + (int(rng.uniform(150, 255)),))
        for _ in range(max(4, int(w * h / 22000))):
            x, y, L = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(6, 15)
            for dx, dy in ((L, 0), (0, L)):
                g.line((x - dx, y - dy, x + dx, y + dy), fill=(255, 255, 255, 200), width=2)
            g.ellipse((x - 2.5, y - 2.5, x + 2.5, y + 2.5), fill=(255, 255, 255, 255))
        glint = lay.filter(ImageFilter.GaussianBlur(2.5))
        lay = Image.alpha_composite(glint, lay)
        img = _over(img, np.asarray(lay, np.float32) / 255)
    elif finish == "glow":                                         # lumineux du centre
        d = np.hypot(xs - w / 2, ys - h / 2) / (math.hypot(w, h) / 2)
        lay = np.zeros((h, w, 4), np.float32)
        lay[..., 0], lay[..., 1], lay[..., 2] = 0.95, 1.0, 0.85
        lay[..., 3] = np.interp(d, [0, 0.5, 1], [0.55, 0.15, 0])
        img = _over(img, lay)
    # les couches d'une piece imprimee : de fines lignes horizontales, a peine marquees
    img = img * (1 - 0.045 * ((ys.astype(np.int32) % 6) == 0))[..., None]
    if glass < 1:                                                  # du verre teinte : plus clair au centre, un reflet
        d = np.hypot(xs - w * 0.4, ys - h * 0.35) / math.hypot(w, h)
        img = img * (1 - (0.45 * (1 - glass) + 0.25) * np.clip(1 - d * 1.6, 0, 1))[..., None]             + (0.45 * (1 - glass) + 0.25) * np.clip(1 - d * 1.6, 0, 1)[..., None]
        img = _over(img, _grad(w, h, 125, [(0, (1, 1, 1, 0)), (.18, (1, 1, 1, .4)), (.3, (1, 1, 1, 0)),
                                           (.36, (1, 1, 1, .2)), (.42, (1, 1, 1, 0)), (1, (1, 1, 1, 0))]))
    return Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")


def render(rows: list) -> Optional[bytes]:
    """rows : [{name, sub, weight, colors, mtype, finish}] -> JPEG ; None sans filament colore.
    Un nuancier clair (31/10/2026) : une carte par filament, facon echantillon -- une grande zone de matiere, son nom,
    sa marque et le poids dessous ; en grille presque carree (Telegram recadre les images d'un album en mosaique)."""
    rows = [r for r in rows if r.get("colors")]                    # tous : il ne doit en manquer aucun
    if not rows:
        return None
    n = len(rows)
    cols = 1 if n == 1 else 2 if n in (2, 4) else 3 if n <= 9 else 4
    gap, pad, head = 26, 44, 112
    cw = (W - 2 * pad - (cols - 1) * gap) // cols
    if n == 1:
        cw = 640
    sh = int(cw * (0.72 if n == 1 else 0.82))
    k = (1.0, 1.0, 0.82, 0.68)[cols - 1]
    f_name, f_sub, f_w = _font(int(38 * k), True), _font(int(24 * k)), _font(int(34 * k), True)
    f_head, f_cnt = _font(40, True), _font(28)
    tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    def lh(f):
        return f.getbbox("Ag")[3] + 6

    ip = int(22 * k)                                               # la marge du bandeau de la carte
    tw = cw - 2 * ip
    nl = max(len(_lines(tmp, r["name"], f_name, tw)) for r in rows)
    has_sub = any(r.get("sub") for r in rows)
    info_h = ip + nl * lh(f_name) + (lh(f_sub) if has_sub else 0) + 8 + lh(f_w) + ip
    ch = sh + info_h
    nrows = math.ceil(n / cols)
    width = W if n > 1 else cw + 2 * pad + 120
    H = head + nrows * ch + (nrows - 1) * gap + pad
    # le fond : un papier clair, a peine chaud
    ys, xs = np.mgrid[0:H, 0:width].astype(np.float32)
    g = (xs / width * 0.5 + ys / H * 0.5)[..., None]
    bg = np.array([246, 243, 238], np.float32) * (1 - g) + np.array([238, 236, 244], np.float32) * g
    im = Image.fromarray(bg.astype(np.uint8), "RGB").convert("RGBA")
    d = ImageDraw.Draw(im)
    for i, r in enumerate(rows):
        row_i, col_i = divmod(i, cols)
        in_row = min(cols, n - row_i * cols)                       # la derniere rangee, centree
        x0 = (width - (in_row * cw + (in_row - 1) * gap)) // 2 + col_i * (cw + gap)
        y0 = head + row_i * (ch + gap)
        rad = int(26 * k)
        # l'ombre, la carte blanche, la matiere en haut
        sha = Image.new("RGBA", (cw + 80, ch + 80), (0, 0, 0, 0))
        ImageDraw.Draw(sha).rounded_rectangle((40, 50, 40 + cw, 50 + ch), rad, fill=(60, 50, 80, 55))
        im.alpha_composite(sha.filter(ImageFilter.GaussianBlur(16)), (x0 - 40, y0 - 40))
        mask = Image.new("L", (cw * 3, ch * 3), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, cw * 3 - 1, ch * 3 - 1), rad * 3, fill=255)
        mask = mask.resize((cw, ch), Image.LANCZOS)
        card = Image.new("RGBA", (cw, ch), (255, 255, 255, 255))
        card.paste(material(r["colors"], r.get("mtype"), r.get("finish"), cw, sh), (0, 0))
        card.putalpha(mask)
        im.alpha_composite(card, (x0, y0))
    im = im.convert("RGB")
    d = ImageDraw.Draw(im, "RGBA")
    d.text((pad, 62), "Filaments", font=f_head, fill=(30, 27, 46), anchor="ls")
    if n > 1:
        d.text((pad + d.textlength("Filaments", font=f_head) + 16, 62), f"{n} couleurs", font=f_cnt, fill=(120, 113, 138), anchor="ls")
    for i, r in enumerate(rows):
        row_i, col_i = divmod(i, cols)
        in_row = min(cols, n - row_i * cols)
        x0 = (width - (in_row * cw + (in_row - 1) * gap)) // 2 + col_i * (cw + gap)
        y = head + row_i * (ch + gap) + sh + ip
        for line in _lines(d, r["name"], f_name, tw):
            d.text((x0 + ip, y), line, font=f_name, fill=(24, 22, 36))
            y += lh(f_name)
        if r.get("sub"):
            d.text((x0 + ip, y), _fit(d, r["sub"], f_sub, tw), font=f_sub, fill=(128, 122, 142))
        if r.get("weight"):
            c = r["colors"][0][:3]
            yy = head + row_i * (ch + gap) + ch - ip - lh(f_w)
            d.ellipse((x0 + ip, yy + 8 * k, x0 + ip + 22 * k, yy + 30 * k), fill=c + (255,), outline=(0, 0, 0, 40), width=1)
            d.text((x0 + ip + 32 * k, yy), r["weight"], font=f_w, fill=(24, 22, 36))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92, subsampling=0)
    return buf.getvalue()
