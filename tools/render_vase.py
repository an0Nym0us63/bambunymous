"""
Genere les deux calques du nuancier (frontend/public/vase-*.png).

Le modele est un prisme a section polygonale arrondie, torsade autour de Y, avec
un profil en tonneau -- la forme du vase de demo Bambu.

Pourquoi 8 cotes et pas un cube : une section carree torsadee fait osciller la
largeur de la silhouette (on voit tantot une face, tantot une diagonale), ce qui
donne une forme en cacahuete, pincee au milieu. Avec 8 cotes la silhouette reste
lisse et la torsion se lit comme des nervures en spirale sur la surface,
exactement comme sur le rendu produit.

Sortie :
  vase-shade.png : ombrage -> mix-blend-mode: multiply
  vase-spec.png  : reflets -> mix-blend-mode: screen
L'alpha des deux fichiers porte la silhouette (sert aussi de mask-image).
"""
import numpy as np
from PIL import Image

N_SIDES = 8      # cotes de la section
TWIST   = 2.6    # torsion (rad par unite de hauteur)
R0      = 0.66   # rayon de la section
H       = 0.64   # demi-hauteur
BARREL  = 0.20   # renflement : 0 = cylindre, plus = tonneau
ROUND_R = 0.05   # arrondi des aretes
CAM     = 1.05   # demi-largeur du cadre (marge autour de l'objet)

OUT, SS = 384, 3
S = OUT * SS

def sdf(p):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    a = TWIST * y                                  # torsion
    c, s = np.cos(a), np.sin(a)
    xr, zr = c*x - s*z, s*x + c*z
    r  = np.sqrt(xr**2 + zr**2) + 1e-9             # section polygonale arrondie
    th = np.arctan2(zr, xr)
    seg = 2*np.pi/N_SIDES
    th_m = np.abs((th % seg) - seg/2)
    poly = r * np.cos(th_m) / np.cos(seg/2)
    t = np.clip(y/H, -1, 1)                        # profil en tonneau
    Ry = R0 * (1 - BARREL*t**2) * (1 - 0.06*t)
    d2 = poly - Ry
    dy = np.abs(y) - H
    d = (np.minimum(np.maximum(d2, dy), 0)
         + np.sqrt(np.maximum(d2, 0)**2 + np.maximum(dy, 0)**2))
    return d - ROUND_R

def normal(p):
    e = 1e-3; out = []
    for i in range(3):
        d = np.zeros_like(p); d[..., i] = e
        out.append(sdf(p+d) - sdf(p-d))
    n = np.stack(out, -1)
    return n / (np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9)

xs = np.linspace(-CAM, CAM, S); ys = np.linspace(CAM, -CAM, S)
X, Y = np.meshgrid(xs, ys)
ro = np.stack([X, Y, np.full_like(X, -3.0)], -1)
rd = np.array([0.0, 0.0, 1.0])

t = np.zeros((S, S)); hit = np.zeros((S, S), bool)
for _ in range(110):
    d = sdf(ro + rd*t[..., None])
    hit |= (d < 8e-4)
    t = np.where(hit, t, t + np.maximum(d, 1e-4))

p = ro + rd*t[..., None]
nrm = normal(p)

L = np.array([-0.5, 0.66, -0.56]); L /= np.linalg.norm(L)
V = np.array([0.0, 0.0, -1.0])
ndl = np.clip((nrm*L).sum(-1), 0, 1)
Hv = L + V; Hv /= np.linalg.norm(Hv)
ndh = np.clip((nrm*Hv).sum(-1), 0, 1)

ao   = np.clip(0.62 + 0.38*(Y/H + 1.0), 0.52, 1.0)          # contact au sol
fill = 0.14*np.clip((nrm*np.array([0.7, 0.1, -0.7])).sum(-1), 0, 1)
rim  = np.clip(1.0 - np.abs((nrm*V).sum(-1)), 0, 1)**2.5

shade = np.clip((0.40 + 0.60*ndl + fill) * ao, 0, 1)        # multiply
spec  = np.clip(0.20*ndh**26 + 0.13*rim*ndl, 0, 1)          # screen

def save(gray, path, alpha):
    g = (np.clip(gray, 0, 1)*255).astype(np.uint8)
    a = (alpha*255).astype(np.uint8)
    Image.fromarray(np.dstack([g, a]), "LA").resize((OUT, OUT), Image.LANCZOS).save(path, optimize=True)

save(shade, "vase-shade.png", hit.astype(float))
save(spec,  "vase-spec.png",  hit.astype(float))

ys_, xs_ = np.where(hit)
w = (xs_.max()-xs_.min())/S; h = (ys_.max()-ys_.min())/S
prof = [int(hit[int(S*f)].sum()) for f in (0.30, 0.40, 0.50, 0.60, 0.70)]
print(f"silhouette : largeur={w:.2f} hauteur={h:.2f} ratio={h/w:.2f}")
print(f"profil de largeur (haut->bas) : {prof}  (doit culminer au milieu)")
