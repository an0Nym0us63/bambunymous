// Les motifs des finitions (28/10/2026), dessines une fois et partages par toute l'appli : pastilles et cases
// (fond CSS), bobines (motif SVG) et vue 3D (texture). Un seul dessin, donc le meme marbre partout -- avant,
// les pastilles avaient une grille de points reguliere, et la vue 3D des mouchetures au hasard.
//   mode "3d"      : fond blanc (le motif teinte la couleur) ou noir (paillettes : il brille), 256 px ;
//   mode "overlay" : fond transparent, a poser par-dessus la couleur.
const SIZE = { "3d": 256, overlay: 128 };
const cache = {};

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// des veines de bois : de longues lignes ondulees, de largeur et de teinte variables, plus ou moins serrees
function woodGrain(g, n, rnd, dark, light) {
  // d'abord de larges bandes plus ou moins foncees (le bois de printemps et d'ete), puis les veines
  for (let y = 0; y < n; ) {
    const h = n * (0.04 + rnd() * 0.09);
    g.fillStyle = rnd() < 0.5 ? dark(0.05 + rnd() * 0.08) : light(0.05 + rnd() * 0.08);
    g.fillRect(0, y, n, h); y += h;
  }
  const lines = 22;
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

// le motif en image (data URL), pour un fond CSS ou un motif SVG ; null si la finition n'a pas de motif
export const PATTERNED = ["sparkle", "galaxy", "marble", "wood", "carbon"];
export function finishImage(f) {
  if (!PATTERNED.includes(f) || typeof document === "undefined") return null;
  if (!(f in cache)) {
    try { cache[f] = finishCanvas(f, "overlay").cv.toDataURL("image/png"); } catch { cache[f] = null; }
  }
  return cache[f];
}
