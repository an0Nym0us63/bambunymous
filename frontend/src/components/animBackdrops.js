// Les fonds des animations de la vue 3D (08/11/2026) : des decors peints, volontairement doux et flous (un halo plus
// clair derriere l'objet, un leger vignetage), pour mettre la piece en valeur sans la denaturer : ni ses couleurs ni sa
// forme ne se melangent au decor. makeBackdrop(cle, W, H) rend paint(ctx, u) : u de 0 a 1 sur la video (ce qui bouge,
// les nuages, les etoiles, boucle sans saut).
export const BACKDROPS = [
  ["studio", "🌑 Studio sombre"], ["light", "🌕 Studio clair"], ["sky", "☁️ Ciel"], ["mountain", "🏔 Montagne"], ["jungle", "🌿 Jungle"],
  ["sunset", "🌅 Coucher de soleil"], ["aurora", "🌠 Aurore"], ["lagoon", "🏝 Lagon"], ["night", "🌌 Nuit étoilée"], ["bokeh", "✨ Bokeh"],
  ["transparent", "◌ Transparent"],
];

// un tirage repetable (le meme decor d'une image a l'autre)
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const TAU = Math.PI * 2;

function vgrad(x, H, stops) { const g = x.createLinearGradient(0, 0, 0, H); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }

// une ligne de cretes, du lointain (clair, brumeux) au proche : des sommets et des cols, puis le relief fin par
// deplacement des milieux (une vraie silhouette de montagne, pas des collines en bulles)
function ridge(x, W, H, base, amp, color, seed, peaks = 5) {
  const r = rng(seed);
  let pts = [];
  for (let i = 0; i <= peaks * 2; i++) {
    const px = W * (i / (peaks * 2)) + (r() - 0.5) * W / (peaks * 3);
    pts.push([px, i % 2 ? base - amp * (0.55 + r() * 0.45) : base - amp * (0.05 + r() * 0.25)]);
  }
  for (let pass = 0, d = amp * 0.18; pass < 4; pass++, d *= 0.5) {
    const nx = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      nx.push([(ax + bx) / 2, (ay + by) / 2 + (r() - 0.5) * d], pts[i]);
    }
    pts = nx;
  }
  x.fillStyle = color; x.beginPath(); x.moveTo(0, H); x.lineTo(0, pts[0][1]);
  pts.forEach(([px, py]) => x.lineTo(Math.max(0, Math.min(W, px)), py));
  x.lineTo(W, pts[pts.length - 1][1]); x.lineTo(W, H); x.closePath(); x.fill();
}

// le decor fixe, peint une fois
function paintStatic(key, x, W, H) {
  const M = Math.min(W, H), r = rng(7);
  switch (key) {
    case "sky":
      x.fillStyle = vgrad(x, H, [[0, "#5b9be0"], [0.55, "#a9cdf2"], [1, "#e8f2fb"]]); x.fillRect(0, 0, W, H); break;
    case "mountain":
      x.fillStyle = vgrad(x, H, [[0, "#8fb4d8"], [0.5, "#d9e4ee"], [1, "#eef1f2"]]); x.fillRect(0, 0, W, H);
      x.filter = `blur(${Math.round(M * 0.006)}px)`;
      ridge(x, W, H, H * 0.66, H * 0.3, "rgba(150,168,192,.55)", 3, 4);
      ridge(x, W, H, H * 0.8, H * 0.26, "rgba(108,130,152,.62)", 5, 5);
      ridge(x, W, H, H * 0.94, H * 0.18, "rgba(76,96,110,.7)", 9, 6);
      x.filter = "none"; break;
    case "jungle": {
      x.fillStyle = vgrad(x, H, [[0, "#1f4d2c"], [0.5, "#2f6b3a"], [1, "#183a22"]]); x.fillRect(0, 0, W, H);
      x.filter = `blur(${Math.round(M * 0.012)}px)`;
      for (let i = 0; i < 46; i++) {                          // des feuilles floues, surtout sur les bords
        const side = r() < 0.5 ? r() * 0.32 : 0.68 + r() * 0.32;
        const px = side * W, py = r() * H, s = M * (0.06 + r() * 0.12);
        x.save(); x.translate(px, py); x.rotate(r() * TAU);
        x.fillStyle = `hsla(${105 + r() * 40}, ${45 + r() * 25}%, ${18 + r() * 22}%, .75)`;
        x.beginPath(); x.ellipse(0, 0, s, s * 0.38, 0, 0, TAU); x.fill(); x.restore();
      }
      x.filter = "none"; break;
    }
    case "sunset": {
      x.fillStyle = vgrad(x, H, [[0, "#3b2a5a"], [0.45, "#c45f7a"], [0.75, "#f2a65a"], [1, "#f7d29a"]]); x.fillRect(0, 0, W, H);
      const g = x.createRadialGradient(W * 0.5, H * 0.8, 0, W * 0.5, H * 0.8, M * 0.45);
      g.addColorStop(0, "rgba(255,236,190,.85)"); g.addColorStop(1, "rgba(255,236,190,0)"); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.filter = `blur(${Math.round(M * 0.005)}px)`;
      ridge(x, W, H, H * 0.93, H * 0.1, "rgba(60,35,70,.6)", 4, 4); x.filter = "none"; break;
    }
    // (08/11/2026) l'ocean s'en va : un horizon net contre un objet qui tourne cassait l'effet ; les decors restent lointains et flous
    case "aurora":
      x.fillStyle = vgrad(x, H, [[0, "#06121f"], [0.55, "#0b2233"], [1, "#10172e"]]); x.fillRect(0, 0, W, H); break;
    case "lagoon":
      x.fillStyle = vgrad(x, H, [[0, "#3fc1c9"], [0.5, "#1f9bb0"], [1, "#0b5c78"]]); x.fillRect(0, 0, W, H); break;
    case "night":
      x.fillStyle = vgrad(x, H, [[0, "#070b1d"], [0.6, "#141c3d"], [1, "#24305a"]]); x.fillRect(0, 0, W, H);
      x.save(); x.translate(W / 2, H / 2); x.rotate(-0.5); x.filter = `blur(${Math.round(M * 0.05)}px)`;   // la voie lactee, a peine
      x.fillStyle = "rgba(150,160,220,.18)"; x.fillRect(-W, -M * 0.08, W * 2, M * 0.16); x.restore(); x.filter = "none"; break;
    case "bokeh":
      x.fillStyle = vgrad(x, H, [[0, "#1d1630"], [1, "#0f1a2b"]]); x.fillRect(0, 0, W, H);
      x.filter = `blur(${Math.round(M * 0.01)}px)`;
      for (let i = 0; i < 34; i++) {
        const px = r() * W, py = r() * H, s = M * (0.03 + r() * 0.08);
        x.fillStyle = `hsla(${[30, 45, 200, 280, 330][i % 5]}, 80%, 65%, ${0.12 + r() * 0.2})`;
        x.beginPath(); x.arc(px, py, s, 0, TAU); x.fill();
      }
      x.filter = "none"; break;
    case "light": {
      const g = x.createRadialGradient(W / 2, H * 0.42, M * 0.08, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#d9dee7"); x.fillStyle = g; x.fillRect(0, 0, W, H); break;
    }
    default: {                                                 // studio sombre
      const g = x.createRadialGradient(W / 2, H * 0.42, M * 0.08, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, "#2d3446"); g.addColorStop(1, "#0d1016"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    }
  }
  if (key !== "studio" && key !== "light") {
    // le halo derriere l'objet et le vignetage : l'oeil va a la piece, le decor reste un decor
    const h = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, M * 0.55);
    h.addColorStop(0, key === "night" || key === "bokeh" || key === "jungle" ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.28)");
    h.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = h; x.fillRect(0, 0, W, H);
    const v = x.createRadialGradient(W / 2, H / 2, M * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.28)"); x.fillStyle = v; x.fillRect(0, 0, W, H);
  }
}

export function makeBackdrop(key, W, H) {
  if (key === "transparent") return (x) => x.clearRect(0, 0, W, H);
  const still = document.createElement("canvas"); still.width = W; still.height = H;
  paintStatic(key, still.getContext("2d"), W, H);
  const M = Math.min(W, H), r = rng(11);
  // ce qui bouge, en boucle : les nuages filent d'une largeur, les etoiles scintillent, l'ecume ondule
  const clouds = key === "sky" || key === "mountain" ? Array.from({ length: key === "sky" ? 9 : 4 }, () =>
    ({ x: r(), y: r() * (key === "sky" ? 0.75 : 0.35), s: M * (0.08 + r() * 0.1), k: 1 + Math.floor(r() * 2) })) : null;
  const stars = key === "night" ? Array.from({ length: 140 }, () => ({ x: r() * W, y: r() * H * 0.85, s: 0.4 + r() * 1.4, p: r() })) : null;
  // aurore et lagon : des nappes de lumiere floutees une fois (une image chacune), qui ondulent ou derivent en boucle
  const glows = key === "aurora" || key === "lagoon" ? (key === "aurora"
    ? [["#3df5a0", 0.30, 0.55], ["#7c5cff", 0.42, 0.45], ["#2fd4ff", 0.24, 0.4]]
    : [["#d8fff7", 0.25, 0.35], ["#8ff0e6", 0.6, 0.4], ["#ffffff", 0.45, 0.25], ["#5fe0d8", 0.8, 0.35]]).map(([col, y, a], k) => {
      const c = document.createElement("canvas"), cw = Math.round(W * 1.6), ch = Math.round(H * (key === "aurora" ? 0.5 : 0.6));
      c.width = cw; c.height = ch; const g = c.getContext("2d");
      g.filter = `blur(${Math.round(M * (key === "aurora" ? 0.05 : 0.07))}px)`; g.globalAlpha = a; g.fillStyle = col;
      if (key === "aurora") {                                   // un rideau : une bande ondulee
        g.beginPath(); g.moveTo(0, ch * 0.5);
        for (let i = 0; i <= 24; i++) g.lineTo(cw * i / 24, ch * (0.35 + 0.2 * Math.sin(i * 0.9 + k * 2)));
        for (let i = 24; i >= 0; i--) g.lineTo(cw * i / 24, ch * (0.62 + 0.18 * Math.sin(i * 0.7 + k)));
        g.closePath(); g.fill();
      } else {                                                  // des reflets : quelques taches de lumiere
        for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(cw * (0.08 + i * 0.14), ch * (0.3 + 0.4 * ((i * 37 + k * 11) % 10) / 10), M * 0.12, M * 0.06, 0, 0, TAU); g.fill(); }
      }
      return { c, y, k, cw, ch };
    }) : null;
  return (x, u) => {
    x.clearRect(0, 0, W, H);
    x.drawImage(still, 0, 0);
    if (clouds) {
      x.save(); x.filter = `blur(${Math.round(M * 0.018)}px)`; x.fillStyle = key === "sky" ? "rgba(255,255,255,.75)" : "rgba(255,255,255,.45)";
      for (const c of clouds) {
        const px = ((c.x + u * c.k) % 1) * (W + c.s * 4) - c.s * 2, py = c.y * H;
        for (let j = 0; j < 4; j++) { x.beginPath(); x.ellipse(px + (j - 1.5) * c.s * 0.7, py + (j % 2) * c.s * 0.15, c.s, c.s * 0.45, 0, 0, TAU); x.fill(); }
      }
      x.restore();
    }
    if (stars) for (const s of stars) {
      x.fillStyle = `rgba(255,255,255,${0.35 + 0.55 * (0.5 + 0.5 * Math.sin(TAU * (u * 2 + s.p)))})`;
      x.beginPath(); x.arc(s.x, s.y, s.s, 0, TAU); x.fill();
    }
    if (glows) {
      x.save(); x.globalCompositeOperation = "screen";
      for (const gl of glows) {
        const dx = (Math.sin(TAU * (u + gl.k * 0.31)) * 0.5 + 0.5) * (gl.cw - W), dy = Math.sin(TAU * (u + gl.k * 0.17)) * H * 0.04;
        x.drawImage(gl.c, -dx, gl.y * H - gl.ch / 2 + dy);
      }
      x.restore();
      // le halo et le vignetage par-dessus la lumiere qui bouge : l'objet reste le sujet
      const v = x.createRadialGradient(W / 2, H / 2, M * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.6);
      v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.25)"); x.fillStyle = v; x.fillRect(0, 0, W, H);
    }
  };
}
