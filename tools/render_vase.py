import numpy as np
from PIL import Image

N = 512
AA = 2                     # supersampling
S = N * AA

def rot(p, a):
    c, s = np.cos(a), np.sin(a)
    x, z = p[..., 0], p[..., 2]
    return np.stack([c*x - s*z, p[..., 1], s*x + c*z], -1)

def sdf(p):
    """Cube arrondi torsadé autour de Y, legerement bombé."""
    y = p[..., 1]
    a = 1.5 * y                       # torsion
    q = rot(p, a)
    # renflement : plus large au centre
    bulge = 1.0 + 0.08 * np.cos(np.clip(y, -1, 1) * 1.35)
    # Proportions calees sur la reference Bambu : bbox ~carree (h/l = 1.03)
    # occupant ~65% du cadre. La version precedente (0.62/0.72) donnait
    # 95% de large pour 72% de haut -> objet ecrase et colle aux bords.
    b = np.array([0.52, 0.82, 0.52]) * np.stack([bulge, np.ones_like(bulge), bulge], -1)
    r = 0.20                          # rayon d'arrondi
    d = np.abs(q) - b
    outside = np.linalg.norm(np.maximum(d, 0), axis=-1)
    inside = np.minimum(np.max(d, axis=-1), 0)
    return outside + inside - r

def normal(p):
    e = 1e-3
    ex = np.zeros_like(p); ex[..., 0] = e
    ey = np.zeros_like(p); ey[..., 1] = e
    ez = np.zeros_like(p); ez[..., 2] = e
    n = np.stack([sdf(p+ex)-sdf(p-ex), sdf(p+ey)-sdf(p-ey), sdf(p+ez)-sdf(p-ez)], -1)
    return n / (np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9)

# Camera orthographique, legerement de trois-quarts
xs = np.linspace(-1.50, 1.50, S)   # marge autour de l'objet
ys = np.linspace(1.50, -1.50, S)
X, Y = np.meshgrid(xs, ys)
ro = np.stack([X, Y, np.full_like(X, -3.0)], -1)
rd = np.array([0.0, 0.0, 1.0])

t = np.zeros((S, S))
hit = np.zeros((S, S), bool)
for _ in range(90):
    p = ro + rd * t[..., None]
    d = sdf(p)
    hit |= (d < 1e-3)
    t = np.where(hit, t, t + np.maximum(d, 1e-4))
    if (t > 6).all(): break

p = ro + rd * t[..., None]
nrm = normal(p)

L = np.array([-0.55, 0.62, -0.56]); L /= np.linalg.norm(L)
V = np.array([0.0, 0.0, -1.0])
ndl = np.clip((nrm * L).sum(-1), 0, 1)
H = (L + V); H /= np.linalg.norm(H)
ndh = np.clip((nrm * H).sum(-1), 0, 1)

# occlusion douce vers le bas + rim
rim = np.clip(1.0 - np.abs((nrm * V).sum(-1)), 0, 1) ** 2.2
ao  = np.clip(0.58 + 0.42 * (Y + 1.1), 0.48, 1.0)

# Calque MULTIPLY : ombrage matte (PLA), toujours <= 1
shade = (0.42 + 0.58 * ndl) * ao
shade = np.clip(shade, 0, 1)

# Calque SCREEN : reflets doux + liseré
spec = 0.22 * ndh ** 22 + 0.16 * rim * np.clip(ndl + 0.3, 0, 1)
spec = np.clip(spec, 0, 1)

def save(gray, path, alpha):
    a = (alpha * 255).astype(np.uint8)
    g = (np.clip(gray, 0, 1) * 255).astype(np.uint8)
    img = np.dstack([g, g, g, a])
    im = Image.fromarray(img, "RGBA").resize((N, N), Image.LANCZOS)
    im.save(path)

mask = hit.astype(float)
save(shade, "vase-shade.png", mask)
save(spec,  "vase-spec.png",  mask)
# apercu teinte
for name, hexc in [("rose","#F5B7C3"), ("bleu","#0047bb"), ("noir","#1a1a1a")]:
    c = np.array([int(hexc[i:i+2],16)/255 for i in (1,3,5)])
    rgb = c[None,None,:] * shade[...,None] + spec[...,None]*(1-c[None,None,:]*shade[...,None])
    rgb = np.clip(rgb,0,1)
    bg = np.array([0.957,0.965,0.984])
    out = rgb*mask[...,None] + bg[None,None,:]*(1-mask[...,None])
    Image.fromarray((out*255).astype(np.uint8)).resize((N,N), Image.LANCZOS).save(f"prev-{name}.png")
print("rendu ok")
