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


def spool(colors: list, mtype: Optional[str], finish: Optional[str], size: int) -> Image.Image:
    """Une bobine vue de face (31/10/2026, « c'est bien mais c'est moche ») : le fil enroule (sa couleur et sa
    finition, en relief, avec ses spires et un reflet), le moyeu sombre et ajoure, la joue en plastique fume."""
    S = size * 2                                                   # dessinee en double, reduite : bords lisses
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    dx, dy = (xs + 0.5 - S / 2) / (S / 2), (ys + 0.5 - S / 2) / (S / 2)
    r = np.hypot(dx, dy)
    ux, uy = dx / np.maximum(r, 1e-6), dy / np.maximum(r, 1e-6)
    out = np.zeros((S, S, 4), np.float32)
    px = 1.5 / (S / 2)

    def aa(edge):                                                  # couverture lissee d'un bord
        return np.clip(edge / px + 0.5, 0, 1)

    L = np.array([-0.45, -0.62, 0.64], np.float32)
    L /= np.linalg.norm(L)
    Hh = L + np.array([0, 0, 1], np.float32)
    Hh /= np.linalg.norm(Hh)
    # la joue : un disque de plastique fume, son bord eclaire en haut a gauche
    lit = np.clip(-(ux * 0.55 + uy * 0.83), 0, 1)
    rim = np.clip(1 - np.abs(r - 0.975) / 0.025, 0, 1)
    base = np.stack([np.full_like(r, 22), np.full_like(r, 26), np.full_like(r, 36)], -1) / 255
    base = base * (0.85 + 0.3 * (1 - r))[..., None] + (rim * (0.25 + 0.5 * lit))[..., None]
    out[..., :3], out[..., 3] = base, aa(1.0 - r) * 0.96
    # le fil enroule
    R0, R1 = 0.41, 0.925
    t = np.clip((r - R0) / (R1 - R0), 0, 1)
    band = aa(r - R0) * aa(R1 - r)
    # un translucide (31/10/2026) : sans damier, la couleur laisse voir la joue fumee, comme du verre teinte
    glass = min(c[3] for c in colors) / 255 if any(c[3] < 255 for c in colors) else 1.0
    tex = np.asarray(swatch([c[:3] + (255,) for c in colors], mtype, finish, S).convert("RGB"), np.float32) / 255
    nr, nz = -np.cos(np.pi * t) * 0.4, np.sin(np.pi * t) + 0.6          # un relief doux (31/10/2026 : « trop 3D »)
    nx, ny = ux * nr, uy * nr
    nn = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / nn, ny / nn, nz / nn
    diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    spec = np.clip(nx * Hh[0] + ny * Hh[1] + nz * Hh[2], 0, 1) ** 60
    spires = 1 - 0.06 * (0.5 + 0.5 * np.sin(r * (S / 2) * 2 * np.pi / 3.2))   # une spire tous les ~1,6 px
    shine = {"silk": 0.5, "metal": 0.55, "glow": 0.15, "matte": 0.05}.get(finish, 0.22) if glass >= 1 else 0.5
    fil = tex * (0.72 + 0.34 * diff)[..., None] * spires[..., None] + (spec * shine)[..., None]
    fil = fil * (0.86 + 0.14 * np.clip(np.sin(np.pi * t), 0, 1) ** 0.5)[..., None]   # les creux contre les joues
    cover = band * (1.0 if glass >= 1 else 0.35 + 0.5 * glass)
    out[..., :3] = out[..., :3] * (1 - cover[..., None]) + fil * cover[..., None]
    if glass < 1:                                                  # le reflet du verre, par-dessus
        out[..., :3] += (spec * band * 0.6)[..., None]
    out[..., 3] = np.maximum(out[..., 3], band)
    # le moyeu : sombre, une levre claire, une gorge, quatre jours et le trou central
    hub = aa(R0 - 0.012 - r)
    hcol = np.stack([np.full_like(r, 48), np.full_like(r, 54), np.full_like(r, 66)], -1) / 255
    hcol = hcol * (0.9 + 0.18 * np.clip(-(dx * 0.55 + dy * 0.83), -1, 1))[..., None]
    lip = np.clip(1 - np.abs(r - (R0 - 0.03)) / 0.014, 0, 1)
    groove = np.clip(1 - np.abs(r - 0.2) / 0.01, 0, 1)
    hcol = hcol + (lip * 0.22 * (0.4 + lit))[..., None] - (groove * 0.12)[..., None]
    out[..., :3] = out[..., :3] * (1 - hub[..., None]) + hcol * hub[..., None]
    holes = aa(0.085 - r)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        hx, hy = math.cos(a) * 0.29, math.sin(a) * 0.29
        holes = np.maximum(holes, aa(0.062 - np.hypot(dx - hx, dy - hy)))
    out[..., 3] *= 1 - holes
    img = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
    return img.resize((size, size), Image.LANCZOS)


def _text_on(c) -> tuple:
    return (15, 23, 42) if (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 > 150 else (255, 255, 255)


def render(rows: list) -> Optional[bytes]:
    """rows : [{name, sub, weight, colors, mtype, finish}] -> JPEG ; None sans filament colore.
    Une bobine par filament sur fond sombre teinte de leurs couleurs, en grille presque carree (Telegram recadre
    les images d'un album en mosaique)."""
    rows = [r for r in rows if r.get("colors")]                    # tous : il ne doit en manquer aucun
    if not rows:
        return None
    n = len(rows)
    cols = 1 if n == 1 else 2 if n in (2, 4) else 3 if n <= 9 else 4
    gap, pad, head = 24, 40, 92
    cw = (W - 2 * pad - (cols - 1) * gap) // cols
    sp = min(560, int(cw * (0.62 if n == 1 else 0.8)))
    k = (1.0, 1.0, 0.8, 0.66)[cols - 1]
    f_name, f_sub, f_w = _font(int(40 * k), True), _font(int(25 * k)), _font(int(30 * k), True)
    f_head, f_cnt = _font(26, True), _font(26)
    tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    def lh(f):
        return f.getbbox("Ag")[3] + 6

    tw = cw - 32
    nl = max(len(_lines(tmp, r["name"], f_name, tw)) for r in rows)
    has_sub = any(r.get("sub") for r in rows)
    pill_h = lh(f_w) + 14
    cell_h = 28 + sp + 22 + nl * lh(f_name) + (lh(f_sub) if has_sub else 0) + 12 + pill_h + 26
    nrows = math.ceil(n / cols)
    H = head + pad + nrows * cell_h + (nrows - 1) * gap
    # le fond : un degrade nuit, et une lueur de la couleur de chaque filament derriere sa bobine
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    g = (xs / W * 0.4 + ys / H * 0.6)[..., None]
    bg = np.array([11, 14, 28], np.float32) * (1 - g) + np.array([30, 22, 52], np.float32) * g
    im = Image.fromarray(bg.astype(np.uint8), "RGB").convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cells = []
    for i, r in enumerate(rows):
        row_i, col_i = divmod(i, cols)
        in_row = min(cols, n - row_i * cols)                       # la derniere rangee, centree
        x0 = (W - (in_row * cw + (in_row - 1) * gap)) // 2 + col_i * (cw + gap)
        y0 = head + row_i * (cell_h + gap)
        cells.append((x0, y0))
        c = r["colors"][0][:3]
        cx, cy, rr = x0 + cw / 2, y0 + 28 + sp / 2, sp * 0.62
        gd.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=c + (120 if r.get("finish") == "glow" else 80,))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(max(40, cw // 5))))
    for (x0, y0), r in zip(cells, rows):
        # la carte de verre
        panel = Image.new("RGBA", (cw, cell_h), (0, 0, 0, 0))
        ImageDraw.Draw(panel).rounded_rectangle((0, 0, cw - 1, cell_h - 1), 28, fill=(255, 255, 255, 14),
                                                outline=(255, 255, 255, 34), width=2)
        im.alpha_composite(panel, (x0, y0))
        # la bobine, et son ombre
        sx, sy = x0 + (cw - sp) // 2, y0 + 28
        sh = Image.new("RGBA", (sp + 80, sp + 80), (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse((40, 52, 40 + sp, 52 + sp), fill=(0, 0, 0, 150))
        im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)), (sx - 40, sy - 40))
        im.alpha_composite(spool(r["colors"], r.get("mtype"), r.get("finish"), sp), (sx, sy))
    # les textes et les traits, sur l'image en RGB : Pillow n'y melange la transparence que la
    im = im.convert("RGB")
    d = ImageDraw.Draw(im, "RGBA")
    d.text((pad, 44), "FILAMENTS", font=f_head, fill=(203, 213, 225), anchor="lm")
    if n > 1:
        hw = d.textlength("FILAMENTS", font=f_head)
        d.text((pad + hw + 14, 44), f"·  {n} couleurs", font=f_cnt, fill=(148, 163, 184), anchor="lm")
    d.line((pad, 74, W - pad, 74), fill=(255, 255, 255, 28), width=2)
    for (x0, y0), r in zip(cells, rows):
        sy = y0 + 28
        # les textes, centres
        cx, y = x0 + cw // 2, sy + sp + 22
        for line in _lines(d, r["name"], f_name, tw):
            d.text((cx, y), line, font=f_name, fill=(248, 250, 252), anchor="mt")
            y += lh(f_name)
        if r.get("sub"):
            d.text((cx, y), _fit(d, r["sub"], f_sub, tw), font=f_sub, fill=(148, 163, 184), anchor="mt")
        y = y0 + cell_h - 26 - pill_h
        if r.get("weight"):
            c = r["colors"][0][:3]
            pw = int(d.textlength(r["weight"], font=f_w)) + 40
            d.rounded_rectangle((cx - pw // 2, y, cx + pw // 2, y + pill_h), pill_h // 2, fill=c + (255,),
                                outline=(255, 255, 255, 60), width=2)
            d.text((cx, y + pill_h / 2), r["weight"], font=f_w, fill=_text_on(c), anchor="mm")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92, subsampling=0)
    return buf.getvalue()
