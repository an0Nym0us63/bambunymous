// Les motifs des finitions (28/10/2026), dessines une fois et partages par toute l'appli : pastilles et cases
// (fond CSS), bobines (motif SVG) et vue 3D (texture). Un seul dessin, donc le meme marbre partout -- avant,
// les pastilles avaient une grille de points reguliere, et la vue 3D des mouchetures au hasard.
//   mode "3d"      : fond blanc (le motif teinte la couleur) ou noir (paillettes : il brille), 256 px ;
//   mode "overlay" : fond transparent, a poser par-dessus la couleur.
//   Les motifs 2D ont quatre paliers selon la taille de la zone (28/10/2026) : une pastille de 12 px ne peut pas
//   porter le meme marbre qu'une carte de 200 px -- des taches enormes sur une bobine, une bouillie sur un point.
//   xs (jusqu'a 18 px) : quelques grains fins ; sm (44 px) ; md (110 px) ; lg : la pleine densite, avec les veines.
const SIZE = { "3d": 256, overlay: 128 };
export const TIER_PX = { xs: 16, sm: 32, md: 64, lg: 128 };
export function tierOf(px) {
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) return "md";
  return n <= 18 ? "xs" : n <= 44 ? "sm" : n <= 110 ? "md" : "lg";
}
const cache = {};

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// des veines de bois : de longues lignes ondulees, de largeur et de teinte variables, plus ou moins serrees
function woodGrain(g, n, rnd, dark, light, lines = 22) {
  // d'abord de larges bandes plus ou moins foncees (le bois de printemps et d'ete), puis les veines
  for (let y = 0; y < n; ) {
    const h = n * (0.04 + rnd() * 0.09);
    g.fillStyle = rnd() < 0.5 ? dark(0.05 + rnd() * 0.08) : light(0.05 + rnd() * 0.08);
    g.fillRect(0, y, n, h); y += h;
  }
  for (let i = 0; i < lines; i++) {
    const y0 = (i / lines) * n + rnd() * (n / lines) * 0.8;
    const amp = n * (0.006 + rnd() * 0.014), fr = (Math.PI * 2) / n * (1 + Math.floor(rnd() * 2)), ph = rnd() * 7;
    g.beginPath();
    for (let x = -2; x <= n + 2; x += 2) {
      const y = y0 + amp * Math.sin(x * fr + ph) + amp * 0.25 * Math.sin(x * fr * 3 + ph * 2);
      x < 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    const strong = rnd() < 0.35;
    g.strokeStyle = strong ? dark(0.55 + rnd() * 0.25) : rnd() < 0.5 ? dark(0.18 + rnd() * 0.2) : light(0.25 + rnd() * 0.2);
    g.lineWidth = (strong ? 1.6 + rnd() * 1.6 : 0.6 + rnd() * 1.2) * n / 128;
    g.stroke();
  }
}

export function finishCanvas(f, mode = "overlay") {
  const n = SIZE[mode];
  const cv = document.createElement("canvas"); cv.width = cv.height = n;
  const g = cv.getContext("2d");
  const rnd = rng(7);
  const k = n / 256;                                  // les tailles sont pensees pour 256 px
  const dots = (cnt, cols, rmin, rmax) => { for (let i = 0; i < cnt; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath();
    // un point coupe par un bord est redessine de l'autre cote : le motif se repete sans couture
    const x = rnd() * n, y = rnd() * n, r = (rmin + rnd() * (rmax - rmin)) * k;
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) { g.moveTo(x + dx + r, y + dy); g.arc(x + dx, y + dy, r, 0, 7); }
    g.fill(); } };
  const emit = f === "sparkle" || f === "galaxy";
  if (mode === "3d") { g.fillStyle = emit ? "#000" : "#fff"; g.fillRect(0, 0, n, n); }
  if (f === "sparkle") dots(260, ["#fff", "#eee", "#ccc"], 0.6, 1.5);
  if (f === "galaxy") dots(320, ["#9db8ff", "#d8b4ff", "#7aa2ff", "#fff"], 0.6, 1.5);
  if (f === "marble") dots(90, ["rgba(40,26,20,.85)", "rgba(60,40,30,.7)", "rgba(40,26,20,.5)"], 1.6, 5);
  if (f === "wood") woodGrain(g, n, rnd, a => `rgba(70,38,12,${a})`, a => `rgba(255,236,205,${a})`);
  if (f === "carbon") {
    const t = n / (mode === "3d" ? 8 : 16);
    for (let y = 0; y < n; y += t) for (let x = 0; x < n; x += t) {
      const a = ((x + y) / t) % 2 === 0;
      const gr = a ? g.createLinearGradient(x, 0, x + t, 0) : g.createLinearGradient(0, y, 0, y + t);
      if (mode === "3d") { gr.addColorStop(0, "#7a7a7a"); gr.addColorStop(0.5, "#ffffff"); gr.addColorStop(1, "#7a7a7a"); }
      else { gr.addColorStop(0, "rgba(0,0,0,.35)"); gr.addColorStop(0.5, "rgba(255,255,255,.18)"); gr.addColorStop(1, "rgba(0,0,0,.35)"); }
      g.fillStyle = gr; g.fillRect(x, y, t, t);
    }
  }
  return { cv, emit };
}

// Le motif 2D d'un palier, fond transparent, a poser par-dessus la couleur. Un seul dessin par finition et par
// palier, partage par les pastilles, les cases, les barres, les bobines et les buses.
//   marbre : des grains fins aux tons varies, quelques-uns plus gros, de legeres veines a partir de md (fini les
//   grosses taches noires) ; paillettes et galaxie : des eclats minuscules ; bois : les veines a l'echelle ;
//   carbone : un tissage dont la maille suit le palier.
const DENSITY = {
  marble:  { xs: 4, sm: 10, md: 34, lg: 110 },
  sparkle: { xs: 5, sm: 16, md: 60, lg: 220 },
  galaxy:  { xs: 6, sm: 20, md: 70, lg: 260 },
  wood:    { xs: 4, sm: 7, md: 14, lg: 22 },
  carbon:  { xs: 4, sm: 6, md: 10, lg: 16 },
};
function overlayCanvas(f, tier, dark = false) {
  const n = TIER_PX[tier] || TIER_PX.md;
  const cv = document.createElement("canvas"); cv.width = cv.height = n;
  const g = cv.getContext("2d");
  const rnd = rng(11 + n);
  const d = DENSITY[f][tier];
  const dots = (cnt, cols, rmin, rmax) => { for (let i = 0; i < cnt; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath();
    const x = rnd() * n, y = rnd() * n, r = rmin + rnd() * (rmax - rmin);
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) { g.moveTo(x + dx + r, y + dy); g.arc(x + dx, y + dy, r, 0, 7); }
    g.fill(); } };
  if (f === "marble") {
    const s = tier === "xs" ? 0.55 : tier === "sm" ? 0.7 : tier === "md" ? 0.9 : 1.1;
    // sur une couleur foncee, des grains clairs (un marbre noir est moucheté de clair) ; sinon des grains sombres
    const G = dark ? ["rgba(255,255,255,.3)", "rgba(230,225,215,.22)", "rgba(255,255,255,.4)", "rgba(0,0,0,.25)", "rgba(255,255,255,.26)"]
                   : ["rgba(38,26,22,.42)", "rgba(60,44,36,.3)", "rgba(38,26,22,.55)", "rgba(255,255,255,.22)", "rgba(38,26,22,.35)"];
    const B = dark ? ["rgba(255,255,255,.34)", "rgba(230,225,215,.28)"] : ["rgba(38,26,22,.5)", "rgba(60,44,36,.4)"];
    dots(d, G, 0.45 * s, 1.35 * s);
    dots(Math.max(1, Math.round(d / 7)), B, 1.2 * s, 2.3 * s);          // quelques grains plus gros
    if (tier === "lg") {                                                   // de tres legeres veines, courtes et irregulieres
      for (let i = 0; i < 5; i++) {
        const x0 = rnd() * n, y0 = rnd() * n, len = n * (0.25 + rnd() * 0.35), ang = rnd() * Math.PI, amp = 1.5 + rnd() * 2.5, ph = rnd() * 7;
        g.beginPath();
        for (let t = 0; t <= len; t += 2) {
          const w = amp * Math.sin(t * 0.25 + ph) + amp * 0.5 * Math.sin(t * 0.7 + ph * 2);
          const x = x0 + t * Math.cos(ang) - w * Math.sin(ang), y = y0 + t * Math.sin(ang) + w * Math.cos(ang);
          t === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.strokeStyle = dark ? `rgba(255,255,255,${0.06 + rnd() * 0.08})` : `rgba(38,26,22,${0.06 + rnd() * 0.08})`; g.lineWidth = 0.5 + rnd() * 0.6; g.stroke();
      }
    }
  }
  if (f === "sparkle") dots(d, ["rgba(255,255,255,.95)", "rgba(255,255,255,.7)", "rgba(230,230,230,.5)"], 0.35, 0.9);
  if (f === "galaxy") dots(d, ["rgba(157,184,255,.9)", "rgba(216,180,255,.85)", "rgba(122,162,255,.8)", "rgba(255,255,255,.95)"], 0.35, 0.9);
  if (f === "wood") woodGrain(g, n, rnd, a => `rgba(70,38,12,${a})`, a => `rgba(255,236,205,${a})`, d);
  if (f === "carbon") {
    const t = n / d;
    for (let y = 0; y < n; y += t) for (let x = 0; x < n; x += t) {
      const a = Math.round((x + y) / t) % 2 === 0;
      const gr = a ? g.createLinearGradient(x, 0, x + t, 0) : g.createLinearGradient(0, y, 0, y + t);
      gr.addColorStop(0, "rgba(0,0,0,.35)"); gr.addColorStop(0.5, "rgba(255,255,255,.18)"); gr.addColorStop(1, "rgba(0,0,0,.35)");
      g.fillStyle = gr; g.fillRect(x, y, t, t);
    }
  }
  return cv;
}

// le motif en image (data URL) du palier, pour un fond CSS ou un motif SVG ; null si la finition n'a pas de motif
export const PATTERNED = ["sparkle", "galaxy", "marble", "wood", "carbon"];
// dark : la variante pour une couleur foncee (marbre : des grains clairs)
export function finishImage(f, tier = "md", dark = false) {
  if (!PATTERNED.includes(f) || typeof document === "undefined") return null;
  const k = `${f}|${tier}|${dark ? "d" : "l"}`;
  if (!(k in cache)) {
    try { cache[k] = overlayCanvas(f, tier, dark).toDataURL("image/png"); } catch { cache[k] = null; }
  }
  return cache[k];
}
