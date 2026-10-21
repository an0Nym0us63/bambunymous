import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStage, Layer, Pill, softly, rand, pick, tint, FONT } from "./pranks";

// Farces des fetes du monde (lot 6) : chacune est jouee d'office le jour J (le
// serveur tient le calendrier) ; son adresse marche toute l'annee. Meme contrat
// que les autres lots : PRANKS[slug] = { label, Effect } ; Effect recoit `done`,
// appele une seule fois quand la farce est terminee (8 a 14 s, sans geste).
// Tout ce qui touche au DOM de l'appli passe par le controleur `ctl` de
// useStage (remise en etat exacte au demontage, meme en cours de route) ; le
// decor vit dans le calque et disparait avec lui.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const smooth = t => t * t * (3 - 2 * t);
const vw = () => window.innerWidth;
const vh = () => window.innerHeight;
const isNarrow = () => window.innerWidth < 768;
// barre de navigation basse (mobile)
const navPad = () => (isNarrow() ? 76 : 0);
// haut utile (bandeau de l'appli)
const topPad = () => (isNarrow() ? 64 : 24);
// sol : au-dessus de la barre basse
const floorY = () => vh() - (isNarrow() ? 86 : 14);
const px = v => `${v.toFixed(1)}px`;

// Socle : useStage, plus un dernier passage apres la remise en etat (Chrome
// laisse parfois un attribut style="" vide sur un element qui n'en avait pas).
function useStage6(done) {
  const s = useStage(done);
  const seen = useRef(null);
  if (!seen.current) {
    const map = new Map();
    seen.current = map;
    const set0 = s.ctl.set;
    s.ctl.set = (el, props) => {
      if (el && !s.ctl.dead && !map.has(el)) map.set(el, el.hasAttribute("style"));
      return set0(el, props);
    };
  }
  const sweep = () => seen.current.forEach((had, el) => {
    try { if (!had && el.getAttribute("style") === "") el.removeAttribute("style"); } catch (e) { /* rien */ }
  });
  useEffect(() => { if (s.left) sweep(); }, [s.left]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => sweep, []); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

// Morceaux de la page (cases, bobines, textes, puces...) avec leur boite et leur centre
function atomsOf(ctl, max = 120) {
  return ctl.cards(max).map(c => {
    const r = c.getBoundingClientRect();
    return { c, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }).filter(o => o.r.width > 0 && o.r.height > 0);
}
// Tuiles entieres visibles
const tilesOf = (ctl, max = 12) => ctl.tiles(30).map(c => ({ c, r: c.getBoundingClientRect() }))
  .filter(o => o.r.width > 40 && o.r.height > 24 && o.r.bottom > 0 && o.r.top < vh()).slice(0, max);
// Ordre de lecture
const byReading = (a, b) => (Math.abs(a.r.top - b.r.top) > 12 ? a.r.top - b.r.top : a.r.left - b.r.left);
// Amplitude d'un mouvement : un gros bloc bouge moins qu'une petite puce
const amp = (r, a) => a * clamp(90 / Math.max(30, Math.sqrt(r.width * r.height)), 0.3, 1);
// Programme des phases : setPh(1) a t[0] ms, setPh(2) a t[1]...
const steps = (ctl, setPh, times) => times.forEach((t, i) => ctl.after(t, () => setPh(i + 1)));
// Centre de la zone utile de l'ecran
const stageCenter = () => ({ x: vw() / 2, y: (topPad() + floorY()) / 2 });

// Filtres : meme liste de fonctions au depart et a l'arrivee, pour que
// l'interpolation reste continue.
const F0 = "sepia(0) saturate(1) hue-rotate(0deg) brightness(1) drop-shadow(0 0 0 rgba(0,0,0,0))";
const fTint = (hue, glow, sat = 3.2, sep = 0.85, br = 1) => `sepia(${sep}) saturate(${sat}) hue-rotate(${hue}deg) brightness(${br}) drop-shadow(0 0 6px ${glow})`;
// Teinte (filtre) posee sur un morceau, puis retiree plus tard
function tintIn(ctl, el, f, { delay = 0, dur = 600 } = {}) {
  return ctl.anim(el, [{ filter: F0 }, { filter: f }], { duration: dur, delay, easing: "ease-out", fill: "forwards" });
}
function tintOut(ctl, el, f, { delay = 0, dur = 700 } = {}) {
  return ctl.anim(el, [{ filter: f }, { filter: F0 }], { duration: dur, delay, easing: "ease-in-out", fill: "forwards" });
}
// Lueur sur une tuile entiere (ombre interieure + halo), devant son ombre d'origine
function tileGlow(ctl, c, col, a = 0.22, { delay = 0, dur = 600, back = null } = {}) {
  let o = "";
  try { o = getComputedStyle(c).boxShadow; } catch (e) { o = ""; }
  const tail = o && o !== "none" ? ", " + o : "";
  const off = `inset 0 0 0 2000px rgba(0,0,0,0), 0 0 0 0 rgba(0,0,0,0)${tail}`;
  const on = `inset 0 0 0 2000px ${col.replace(/[\d.]+\)$/, a + ")")}, 0 0 22px 2px ${col}${tail}`;
  ctl.anim(c, [{ boxShadow: off }, { boxShadow: on }], { duration: dur, delay, easing: "ease-out", fill: "forwards" });
  if (back != null) ctl.after(back, () => ctl.anim(c, [{ boxShadow: on }, { boxShadow: off }], { duration: 800, easing: "ease-in-out", fill: "forwards" }));
}
// Petit saut d'un morceau (revient a zero)
function hop(ctl, o, h = 16, rot = 6, dur = 620, delay = 0) {
  const a = amp(o.r, h), r = rand(-rot, rot);
  return ctl.anim(o.c, [
    { transform: "translate(0px,0px) rotate(0deg) scale(1)" },
    { transform: `translate(0px,${(-a).toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(1.06)`, offset: 0.38 },
    { transform: `translate(0px,${(a * 0.12).toFixed(1)}px) rotate(${(-r / 3).toFixed(1)}deg) scale(.98)`, offset: 0.75 },
    { transform: "translate(0px,0px) rotate(0deg) scale(1)" },
  ], { duration: dur, delay, easing: "ease-out" });
}

// ── Particules qui tombent ─────────────────────────────────────────────────
const fallCss = k => `
@keyframes pk-${k}-fall { 0% { transform: translate(0, -60px) rotate(var(--r0)) } 100% { transform: translate(var(--dx), calc(100vh + 60px)) rotate(var(--r1)) } }
@keyframes pk-${k}-sway { 0%, 100% { transform: translateX(calc(var(--sw) * -1)) rotate(-12deg) } 50% { transform: translateX(var(--sw)) rotate(12deg) } }
`;
function makeFall(n, { t0 = 0, t1 = 6, d = [4, 7], size = [14, 26], colors = ["#fff"], sw = [6, 22] } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    i, x: rand(-2, 100), dl: rand(t0, t1), d: rand(d[0], d[1]), dx: rand(-70, 70), r0: rand(-40, 40), r1: rand(-300, 300),
    size: rand(size[0], size[1]), c: colors[i % colors.length], sw: rand(sw[0], sw[1]), sd: rand(1.6, 3), ph: Math.random(),
  }));
}
function Fall({ k, items, render }) {
  return items.map(b => (
    <div key={b.i} aria-hidden="true" style={{ position: "absolute", left: `${b.x.toFixed(2)}%`, top: 0,
      "--dx": `${b.dx.toFixed(0)}px`, "--r0": `${b.r0.toFixed(0)}deg`, "--r1": `${b.r1.toFixed(0)}deg`,
      animation: `pk-${k}-fall ${b.d.toFixed(2)}s linear ${b.dl.toFixed(2)}s both` }}>
      <div style={{ "--sw": `${b.sw.toFixed(0)}px`, animation: `pk-${k}-sway ${b.sd.toFixed(2)}s ease-in-out ${(-b.sd * b.ph).toFixed(2)}s infinite` }}>
        {render(b)}
      </div>
    </div>
  ));
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Nouvel an chinois : danse du dragon
// ════════════════════════════════════════════════════════════════════════════
const CNY_CSS = fallCss("nouvel-an-chinois") + `
@keyframes pk-nouvel-an-chinois-hang { 0% { transform: translateY(-130%) } 12%, 86% { transform: translateY(0) } 100% { transform: translateY(-130%) } }
@keyframes pk-nouvel-an-chinois-swing { 0%, 100% { transform: rotate(-7deg) } 50% { transform: rotate(7deg) } }
@keyframes pk-nouvel-an-chinois-glow { 0%, 100% { opacity: .55 } 50% { opacity: .95 } }
@keyframes pk-nouvel-an-chinois-pop { 0% { opacity: 1; transform: scale(1) } 30% { opacity: 1; transform: scale(1.5) } 100% { opacity: 0; transform: scale(.2) } }
@keyframes pk-nouvel-an-chinois-bang { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.2) rotate(0deg) } 30% { opacity: 1 }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.6) rotate(40deg) } }
@keyframes pk-nouvel-an-chinois-string { 0% { opacity: 0; transform: translateY(-40px) } 8%, 90% { opacity: 1; transform: translateY(0) } 100% { opacity: 0 } }
`;
const ZODIAC_FEM = /^(ch[eè]vre)$/i;
function lunarWish() {
  let z = "";
  try { z = typeof window.__bnZodiac === "string" ? window.__bnZodiac.trim() : ""; } catch (e) { z = ""; }
  if (!z) return "Bonne année lunaire !";
  const art = /^[aeiouyàâéèêîïôûh]/i.test(z) ? "de l'" : ZODIAC_FEM.test(z) ? "de la " : "du ";
  return `Bonne année ${art}${z} !`;
}
function DragonHead({ w }) {
  return (
    <svg width={w} height={w * 0.8} viewBox="-14 -44 124 88" style={{ display: "block", overflow: "visible",
      filter: "drop-shadow(0 6px 8px rgba(0,0,0,.35))" }}>
      <path d="M6 -16 L-8 -34 L14 -24 L12 -42 L28 -26 L34 -40 L42 -24 L52 -34 L52 -18 Z" fill="#facc15" stroke="#b45309" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M6 18 L-10 32 L12 26 L10 40 L28 26 L36 36 L42 24 Z" fill="#fde68a" stroke="#b45309" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M44 -18 Q52 -38 40 -44" stroke="#fbbf24" strokeWidth="5" fill="none" strokeLinecap="round"/>
      <path d="M56 -16 Q66 -34 58 -42" stroke="#fbbf24" strokeWidth="4" fill="none" strokeLinecap="round"/>
      <path d="M0 -12 Q18 -26 50 -20 Q72 -16 88 -6 L96 -2 Q100 4 92 7 L72 8 Q80 13 88 16 Q80 26 62 20 Q40 26 20 22 Q2 18 0 6 Z"
        fill="#dc2626" stroke="#7f1d1d" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M18 -6 Q30 -14 44 -8 M16 6 Q30 0 46 6" stroke="#facc15" strokeWidth="2.4" fill="none" strokeLinecap="round"/>
      <path d="M70 8 L74 12 L78 8 L82 12 L86 8" stroke="#fff" strokeWidth="2" fill="none" strokeLinejoin="round"/>
      <ellipse cx="60" cy="-9" rx="7.5" ry="6" fill="#fff" stroke="#7f1d1d" strokeWidth="1.5"/>
      <circle cx="62" cy="-9" r="3.2" fill="#111827"/><circle cx="63" cy="-10.5" r="1.1" fill="#fff"/>
      <path d="M52 -15 Q60 -22 70 -14" stroke="#111827" strokeWidth="2.4" fill="none" strokeLinecap="round"/>
      <circle cx="91" cy="-3" r="1.8" fill="#7f1d1d"/>
      <path d="M92 0 Q108 -10 118 2 Q124 10 114 14" stroke="#facc15" strokeWidth="2" fill="none" strokeLinecap="round"/>
      <path d="M88 4 Q98 18 112 16" stroke="#facc15" strokeWidth="2" fill="none" strokeLinecap="round"/>
      <circle cx="30" cy="-2" r="5" fill="#16a34a" stroke="#facc15" strokeWidth="1.6"/>
    </svg>
  );
}
function Segment({ d, k, n }) {
  const red = k % 2 ? "#ef4444" : "#dc2626";
  return (
    <div style={{ position: "relative", width: d, height: d }}>
      <div style={{ position: "absolute", left: "18%", right: "18%", top: "-24%", height: "40%", background: "#facc15",
        clipPath: "polygon(0 100%, 25% 0, 50% 100%, 75% 0, 100% 100%)" }}/>
      <div style={{ position: "absolute", left: "10%", right: "10%", bottom: "-22%", height: "34%", borderRadius: "0 0 50% 50%",
        background: "repeating-linear-gradient(90deg, #fde68a 0 4px, #fbbf24 4px 8px)", opacity: 0.95 }}/>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid #facc15",
        background: `radial-gradient(circle at 40% 35%, #fca5a5, ${red} 55%, #991b1b)`,
        boxShadow: "0 4px 10px rgba(0,0,0,.25), inset 0 0 0 3px rgba(250,204,21,.25)" }}>
        <div style={{ position: "absolute", left: "22%", top: "22%", width: "56%", height: "56%", borderRadius: "50%",
          border: "2px solid rgba(250,204,21,.85)", borderLeftColor: "transparent", borderBottomColor: "transparent" }}/>
      </div>
      {(k === 3 || k === Math.round(n * 0.6)) && (
        <div style={{ position: "absolute", left: "30%", bottom: "-58%", width: "40%", height: "50%", borderRadius: 4,
          background: "linear-gradient(#facc15, #b45309)", boxShadow: "0 2px 3px rgba(0,0,0,.3)" }}/>
      )}
    </div>
  );
}
function Lantern({ s }) {
  return (
    <svg width={s} height={s * 1.7} viewBox="0 0 40 68" style={{ display: "block", overflow: "visible" }}>
      <line x1="20" y1="0" x2="20" y2="10" stroke="#facc15" strokeWidth="1.6"/>
      <rect x="12" y="8" width="16" height="5" rx="1.5" fill="#facc15"/>
      <ellipse cx="20" cy="30" rx="19" ry="18" fill="#dc2626" stroke="#991b1b" strokeWidth="1.5"/>
      <path d="M20 12 Q6 30 20 48 M20 12 Q34 30 20 48 M20 12 Q13 30 20 48 M20 12 Q27 30 20 48" stroke="#991b1b" strokeWidth="1" fill="none"/>
      <ellipse cx="20" cy="30" rx="10" ry="12" fill="#fde047" opacity=".35" style={{ animation: "pk-nouvel-an-chinois-glow 1.6s ease-in-out infinite" }}/>
      <rect x="12" y="46" width="16" height="5" rx="1.5" fill="#facc15"/>
      <path d="M15 51 L14 66 M18 51 L17.5 67 M22 51 L22.5 67 M25 51 L26 66" stroke="#facc15" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}
const envelope = b => (
  <div style={{ width: b.size * 0.72, height: b.size, borderRadius: 3, background: "linear-gradient(#ef4444, #b91c1c)",
    border: "1px solid #facc15", boxShadow: "0 3px 6px rgba(0,0,0,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <span style={{ width: b.size * 0.46, height: b.size * 0.46, borderRadius: "50%", background: "#facc15", color: "#b91c1c",
      fontSize: b.size * 0.3, fontWeight: 800, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>福</span>
  </div>
);
function Firecrackers({ side, t0 }) {
  const n = isNarrow() ? 7 : 10;
  return (
    <div aria-hidden="true" style={{ position: "absolute", [side]: isNarrow() ? 8 : 22, top: isNarrow() ? 90 : 70, width: 26,
      animation: `pk-nouvel-an-chinois-string 9.6s ease ${t0}s both` }}>
      <div style={{ position: "absolute", left: 12, top: -30, width: 2, height: 30 + n * 20, background: "#a16207" }}/>
      {Array.from({ length: n }, (_, i) => {
        const dl = t0 + 1.4 + (n - 1 - i) * 0.28;
        return (
          <div key={i} style={{ position: "absolute", left: i % 2 ? 12 : 0, top: i * 20, width: 14, height: 22 }}>
            <div style={{ transform: `rotate(${i % 2 ? 18 : -18}deg)` }}>
              <div style={{ width: 14, height: 20, borderRadius: 3, background: "linear-gradient(90deg, #991b1b, #ef4444 45%, #b91c1c)",
                border: "1px solid #facc15", animation: `pk-nouvel-an-chinois-pop .35s ease-out ${(dl - 0.08).toFixed(2)}s both` }}/>
            </div>
            <svg width="44" height="44" viewBox="-22 -22 44 44" style={{ position: "absolute", left: 7, top: 10, opacity: 0,
              animation: `pk-nouvel-an-chinois-bang .55s ease-out ${dl.toFixed(2)}s both` }}>
              {Array.from({ length: 8 }, (_, k) => {
                const a = k * Math.PI / 4;
                return <line key={k} x1={Math.cos(a) * 5} y1={Math.sin(a) * 5} x2={Math.cos(a) * 18} y2={Math.sin(a) * 18}
                  stroke={k % 2 ? "#facc15" : "#fb923c"} strokeWidth="2.6" strokeLinecap="round"/>;
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
function NouvelAnChinois({ done }) {
  const s = useStage6(done);
  const [ph, setPh] = useState(0);
  const wish = useMemo(lunarWish, []);
  const geo = useMemo(() => {
    const W = vw(), H = vh();
    const N = isNarrow() ? 14 : 18;
    const gap = clamp(W / 55, 16, 28);
    const D0 = gap * 1.9;
    const body = (N + 1) * gap;
    const L = W + body + 120;
    const DUR = 4.3;
    const speed = L / DUR;
    const top = topPad() + 40, bot = floorY() - 60;
    return { W, H, N, gap, D0, body, L, DUR, speed, pause: speed * 0.3, T0: 0.6,
      y1: lerp(top, bot, 0.28), y2: lerp(top, bot, 0.72), A: Math.min(70, H * 0.09), lam: 70, head: clamp(gap * 4.2, 70, 118) };
  }, []);
  const lanterns = useMemo(() => {
    const n = isNarrow() ? 4 : 7;
    return Array.from({ length: n }, (_, i) => ({ i, x: (i + 0.5) / n * 100, s: rand(26, 38), len: rand(10, 46), dl: i * 0.12, sw: rand(2.2, 3.2) }));
  }, []);
  const envs = useMemo(() => makeFall(isNarrow() ? 12 : 20, { t0: 8.6, t1: 10, d: [3.2, 4.6], size: [24, 34] }), []);
  const segRefs = useRef([]), headRef = useRef(null);
  useEffect(() => {
    const { ctl } = s;
    const g = geo;
    const atoms = atomsOf(ctl, 120);
    const hit = atoms.map(() => 0);
    const R = Math.max(100, g.H * 0.15);
    // Position sur le parcours a la distance G (deux passages, aller puis retour)
    const posAt = G => {
      if (G < g.L) return { x: -60 + G, y: g.y1 + g.A * Math.sin(G / g.lam), pass: 1 };
      if (G < g.L + g.pause) return { x: g.W + 60 + g.body, y: g.y1, pass: 0 };
      const h = G - g.L - g.pause;
      return { x: g.W + 60 - h, y: g.y2 + g.A * Math.sin(h / g.lam + 1.3), pass: 2 };
    };
    const place = (el, G, w, h) => {
      if (!el) return;
      const p = posAt(G), q = posAt(G + 2);
      const a = Math.atan2(q.y - p.y, q.x - p.x);
      const flip = Math.cos(a) < 0 ? -1 : 1;
      el.style.transform = `translate(${px(p.x - w / 2)},${px(p.y - h / 2)}) rotate(${(a * 180 / Math.PI).toFixed(1)}deg) scaleY(${flip})`;
      return p;
    };
    steps(ctl, setPh, [300, 5200, 9800]);
    // Finale : le tambour de la danse du lion, tout le monde saute en vague
    ctl.after(9600, () => {
      const xs = atoms.map(o => o.cx);
      const x0 = Math.min(...xs, 0), x1 = Math.max(...xs, 1);
      atoms.forEach(o => {
        const dl = (o.cx - x0) / Math.max(1, x1 - x0) * 700;
        hop(ctl, o, 20, 8, 640, dl);
        ctl.anim(o.c, [{ filter: F0 }, { filter: fTint(-5, "rgba(250,204,21,.9)", 2.4, 0.5, 1.15), offset: 0.4 }, { filter: F0 }],
          { duration: 900, delay: dl, easing: "ease-in-out" });
      });
    });
    ctl.loop(t => {
      const G = g.speed * (t - g.T0);
      const hp = place(headRef.current, G, g.head, g.head * 0.8);
      for (let k = 0; k < g.N; k++) {
        const d = g.D0 * (1 - (k / g.N) * 0.45);
        place(segRefs.current[k], G - (k + 1) * g.gap - g.head * 0.18, d, d);
      }
      place(segRefs.current[g.N], G - (g.N + 1) * g.gap - g.head * 0.18, g.D0 * 0.9, g.D0 * 0.5);
      if (hp && hp.pass) {
        atoms.forEach((o, i) => {
          if (hit[i] >= hp.pass) return;
          const dx = o.cx - hp.x, dy = o.cy - hp.y;
          if (dx * dx + dy * dy > R * R) return;
          hit[i] = hp.pass;
          hop(ctl, o, 26, 12, 700);
          ctl.anim(o.c, [{ filter: F0 }, { filter: fTint(-10, "rgba(239,68,68,.85)", 3, 0.7, 1.05), offset: 0.3 }, { filter: F0 }],
            { duration: 1100, easing: "ease-out" });
        });
      }
      if (t > 11.2) { s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const g = geo;
  const hide = "translate(-500px,-500px)";
  return (
    <Layer s={s} css={CNY_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 0%, rgba(220,38,38,.18), transparent 70%)",
        animation: "pk-kit-soft 11.4s ease both" }}/>
      {lanterns.map(l => (
        <div key={l.i} aria-hidden="true" style={{ position: "absolute", left: `${l.x}%`, top: 0, marginLeft: -l.s / 2,
          animation: `pk-nouvel-an-chinois-hang 11.2s ease ${l.dl}s both` }}>
          <div style={{ transformOrigin: "50% 0", animation: `pk-nouvel-an-chinois-swing ${l.sw}s ease-in-out infinite` }}>
            <div style={{ width: 1.5, height: topPad() - 20 + l.len, background: "#a16207", margin: "0 auto" }}/>
            <Lantern s={l.s}/>
          </div>
        </div>
      ))}
      <Firecrackers side="left" t0={0.3}/>
      <Firecrackers side="right" t0={4.2}/>
      {Array.from({ length: g.N + 1 }, (_, k) => {
        const last = k === g.N;
        const d = g.D0 * (1 - (k / g.N) * 0.45);
        return (
          <div key={k} ref={el => { segRefs.current[k] = el; }} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0,
            transform: hide, zIndex: 20 - Math.round(k / 2) }}>
            {last ? (
              <div style={{ width: g.D0 * 0.9, height: g.D0 * 0.5, background: "linear-gradient(90deg, #fde68a, #f59e0b 60%, #dc2626)",
                clipPath: "polygon(100% 20%, 100% 80%, 40% 100%, 0 50%, 40% 0)" }}/>
            ) : <Segment d={d} k={k} n={g.N}/>}
          </div>
        );
      })}
      <div ref={headRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, transform: hide, zIndex: 30 }}>
        <DragonHead w={g.head}/>
      </div>
      <Fall k="nouvel-an-chinois" items={envs} render={envelope}/>
      {ph === 1 && <Pill key="a">🧧 {wish}</Pill>}
      {ph === 2 && <Pill key="b">🐉 Le dragon danse : que la chance imprime pour toi !</Pill>}
      {ph === 3 && <Pill key="c" fade>Le dragon repart. Prospérité, et zéro warping !</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Saint-Patrick : tout vire au vert, gigue, chaudron d'or
// ════════════════════════════════════════════════════════════════════════════
const SP_CSS = fallCss("saint-patrick") + `
@keyframes pk-saint-patrick-bow { 0% { opacity: 0; clip-path: inset(0 100% 0 0) } 30%, 78% { opacity: .68; clip-path: inset(0 0 0 0) } 100% { opacity: 0; clip-path: inset(0 0 0 0) } }
@keyframes pk-saint-patrick-pot { 0% { transform: translateY(160%) } 14%, 84% { transform: translateY(0) } 100% { transform: translateY(160%) } }
@keyframes pk-saint-patrick-coin { 0% { transform: translate(0, 0) rotateY(0deg); opacity: 0 } 8% { opacity: 1 }
  45% { transform: translate(calc(var(--dx) * .6), var(--up)) rotateY(540deg) } 100% { transform: translate(var(--dx), 30px) rotateY(1080deg); opacity: 0 } }
@keyframes pk-saint-patrick-shine { 0%, 100% { opacity: .5 } 50% { opacity: 1 } }
@keyframes pk-saint-patrick-veil { 0% { opacity: 0 } 20%, 78% { opacity: 1 } 100% { opacity: 0 } }
`;
const SP_GREENS = ["#16a34a", "#22c55e", "#15803d", "#4ade80", "#65a30d"];
function Shamrock({ s, c }) {
  return (
    <svg width={s} height={s} viewBox="-12 -12 24 26" style={{ display: "block", overflow: "visible" }}>
      {[0, 120, 240].map(a => (
        <g key={a} transform={`rotate(${a})`}>
          <path d="M0 0 C-7 -3 -9 -10 -4.5 -11.5 C-2 -12.2 -0.4 -10.8 0 -9 C0.4 -10.8 2 -12.2 4.5 -11.5 C9 -10 7 -3 0 0 Z" fill={c} stroke="rgba(0,0,0,.18)" strokeWidth=".6"/>
        </g>
      ))}
      <path d="M0 1 Q1.5 8 4 13" stroke={c} strokeWidth="1.8" fill="none" strokeLinecap="round"/>
    </svg>
  );
}
function GoldPot({ w }) {
  return (
    <svg width={w} height={w * 0.86} viewBox="0 0 100 86" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 6px 8px rgba(0,0,0,.35))" }}>
      {[[24, 20], [36, 12], [50, 9], [64, 13], [76, 21], [43, 20], [58, 20]].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx="9" ry="6" fill="#facc15" stroke="#a16207" strokeWidth="1.4"
          style={{ animation: `pk-saint-patrick-shine ${1 + i * 0.13}s ease-in-out infinite` }}/>
      ))}
      <ellipse cx="50" cy="26" rx="42" ry="9" fill="#1f2937" stroke="#111" strokeWidth="2"/>
      <path d="M10 28 Q4 66 28 80 L72 80 Q96 66 90 28 Z" fill="#111827" stroke="#000" strokeWidth="2"/>
      <path d="M18 40 Q50 50 82 40" stroke="#374151" strokeWidth="3" fill="none"/>
      <path d="M22 80 L16 86 M78 80 L84 86" stroke="#111" strokeWidth="5" strokeLinecap="round"/>
      <g transform="translate(50 58) scale(.75)"><Shamrock s={24} c="#22c55e"/></g>
    </svg>
  );
}
function SaintPatrick({ done }) {
  const s = useStage6(done);
  const [ph, setPh] = useState(0);
  const clovers = useMemo(() => makeFall(isNarrow() ? 22 : 36, { t0: 0, t1: 7.5, d: [3.8, 6], size: [16, 30], colors: SP_GREENS }), []);
  const coins = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ i, dx: rand(-120, 60), up: -rand(90, 190), dl: 4.3 + rand(0, 2.6) })), []);
  const potW = isNarrow() ? 84 : 110;
  useEffect(() => {
    const { ctl } = s;
    const atoms = atomsOf(ctl, 120).sort(byReading);
    const tiles = tilesOf(ctl, 12);
    const n = atoms.length || 1;
    const greens = atoms.map((o, i) => fTint(68 + (i % 5) * 6, "rgba(34,197,94,.75)", 2.6, 0.8, 1.03));
    // 1) Tout vire au vert, en vague de haut en bas
    atoms.forEach((o, i) => tintIn(ctl, o.c, greens[i], { delay: 300 + i / n * 2400, dur: 500 }));
    tiles.forEach((o, i) => tileGlow(ctl, o.c, "rgba(34,197,94,.55)", 0.14, { delay: 300 + i * 160, back: 8400 }));
    // 2) La gigue : sauts alternes, talons qui claquent
    ctl.after(3200, () => atoms.forEach((o, i) => {
      const a = amp(o.r, 14), side = i % 2 ? 1 : -1;
      ctl.anim(o.c, [
        { transform: "translate(0px,0px) rotate(0deg)" },
        { transform: `translate(${(side * a * 0.5).toFixed(1)}px,${(-a).toFixed(1)}px) rotate(${side * 9}deg)`, offset: 0.25 },
        { transform: "translate(0px,0px) rotate(0deg)", offset: 0.5 },
        { transform: `translate(${(-side * a * 0.5).toFixed(1)}px,${(-a).toFixed(1)}px) rotate(${-side * 9}deg)`, offset: 0.75 },
        { transform: "translate(0px,0px) rotate(0deg)" },
      ], { duration: 760, delay: (i % 4) * 60, iterations: 6, easing: "ease-in-out" });
    }));
    // 3) Le vert s'en va
    ctl.after(8400, () => atoms.forEach((o, i) => tintOut(ctl, o.c, greens[i], { delay: (n - i) / n * 1200, dur: 600 })));
    steps(ctl, setPh, [200, 3400, 9300]);
    ctl.after(10600, () => s.finish());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const potBottom = isNarrow() ? 132 : 70;
  return (
    <Layer s={s} css={SP_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, rgba(34,197,94,.10), rgba(21,128,61,.22))",
        animation: "pk-saint-patrick-veil 10.6s ease both" }}/>
      <div aria-hidden="true" style={{ position: "absolute", right: isNarrow() ? 12 : 60, bottom: potBottom + potW * 0.45,
        width: "min(92vw, 1100px)", height: "min(46vh, 520px)", opacity: 0, animation: "pk-saint-patrick-bow 7.4s ease-in-out 2.6s both",
        borderRadius: "100% 100% 0 0 / 100% 100% 0 0", filter: "blur(1.5px)",
        background: "radial-gradient(ellipse 50% 100% at 50% 100%, transparent 64%, #a855f7 64% 69%, #3b82f6 0 74%, #06b6d4 0 79%, #22c55e 0 84%, #eab308 0 89%, #f97316 0 94%, #ef4444 0 99%, transparent 0)" }}/>
      <Fall k="saint-patrick" items={clovers} render={b => <Shamrock s={b.size} c={b.c}/>}/>
      <div aria-hidden="true" style={{ position: "absolute", right: isNarrow() ? 14 : 70, bottom: potBottom, width: potW,
        animation: "pk-saint-patrick-pot 8s ease 2.8s both" }}>
        {coins.map(c => (
          <div key={c.i} style={{ position: "absolute", left: "45%", top: "8%", width: 16, height: 16, borderRadius: "50%",
            background: "radial-gradient(circle at 35% 35%, #fef08a, #eab308 60%, #a16207)", border: "1px solid #a16207",
            "--dx": `${c.dx.toFixed(0)}px`, "--up": `${c.up.toFixed(0)}px`, opacity: 0,
            animation: `pk-saint-patrick-coin 1.3s ease-out ${(c.dl - 2.8).toFixed(2)}s both` }}/>
        ))}
        <GoldPot w={potW}/>
      </div>
      {ph === 1 && <Pill key="a">☘️ Tout passe au vert… même le PLA blanc.</Pill>}
      {ph === 2 && <Pill key="b">🌈 Une gigue pour tout le monde ! Au bout de l'arc-en-ciel : un chaudron d'or.</Pill>}
      {ph === 3 && <Pill key="c" fade>Le vert s'en va. Le trèfle à quatre feuilles, lui, reste dans l'AMS.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Holi : nuages de poudre coloree
// ════════════════════════════════════════════════════════════════════════════
const HOLI_CSS = `
@keyframes pk-holi-cloud { 0% { transform: translate(-50%, -50%) scale(.15); opacity: .95 } 35% { opacity: .85 }
  100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0 } }
@keyframes pk-holi-stain { 0% { transform: translate(-50%, -50%) scale(.2); opacity: 0 } 12% { opacity: .5; transform: translate(-50%, -50%) scale(1) }
  85% { opacity: .38 } 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.05) } }
@keyframes pk-holi-wash { 0% { transform: translateY(-110%) } 100% { transform: translateY(110%) } }
`;
// teinte voulue (en degres) -> rotation depuis la teinte du sepia (~35 deg)
const HOLI = [
  { c: "#ec4899", rgb: "236,72,153", h: 295 }, { c: "#facc15", rgb: "250,204,21", h: 15 },
  { c: "#22c55e", rgb: "34,197,94", h: 100 }, { c: "#3b82f6", rgb: "59,130,246", h: 185 },
  { c: "#a855f7", rgb: "168,85,247", h: 245 }, { c: "#f97316", rgb: "249,115,22", h: -10 },
  { c: "#06b6d4", rgb: "6,182,212", h: 155 },
];
function Holi({ done }) {
  const s = useStage6(done);
  const [ph, setPh] = useState(0);
  const [shots, setShots] = useState([]);
  const flyRefs = useRef([]);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh();
    const atoms = atomsOf(ctl, 120);
    const tiles = tilesOf(ctl, 12);
    const n = isNarrow() ? 16 : 22;
    // cibles : des morceaux pris au hasard, chacun teint la zone autour de lui
    const pool = atoms.length ? atoms.slice().sort(() => Math.random() - 0.5) : [];
    const list = Array.from({ length: n }, (_, i) => {
      const tgt = pool.length ? pool[i % pool.length] : { cx: rand(0.15, 0.85) * W, cy: rand(0.2, 0.7) * H };
      const side = i % 3;
      const from = side === 0 ? { x: -40, y: rand(0.2, 0.9) * H } : side === 1 ? { x: W + 40, y: rand(0.2, 0.9) * H } : { x: rand(0.1, 0.9) * W, y: H + 40 };
      return { i, from, x: clamp(tgt.cx, 20, W - 20), y: clamp(tgt.cy, 20, H - 20), col: HOLI[i % HOLI.length], t: 400 + i * (6000 / n) + rand(-120, 120),
        size: rand(110, 190) * (isNarrow() ? 0.8 : 1) };
    });
    // le grand lancer final : du centre, toutes les couleurs
    const c = stageCenter();
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2;
      list.push({ i: list.length, from: { x: c.x, y: H + 40 }, x: c.x + Math.cos(a) * W * 0.28, y: c.y + Math.sin(a) * H * 0.22, col: HOLI[k], t: 6700 + k * 40, size: rand(220, 300), big: true });
    }
    setShots(list);
    const tinted = atoms.map(() => null);
    const tintAt = (sh, radius) => atoms.forEach((o, i) => {
      if (tinted[i]) return;
      const dx = o.cx - sh.x, dy = o.cy - sh.y;
      if (dx * dx + dy * dy > radius * radius) return;
      tinted[i] = fTint(sh.col.h, `rgba(${sh.col.rgb},.9)`, 3.4, 0.9, 1.04);
      const d = Math.sqrt(dx * dx + dy * dy) * 1.5;
      tintIn(ctl, o.c, tinted[i], { delay: d, dur: 380 });
      ctl.anim(o.c, [{ transform: "translate(0px,0px) scale(1)" }, { transform: `translate(${(dx / 40).toFixed(1)}px,${(dy / 40).toFixed(1)}px) scale(1.08)`, offset: 0.3 },
        { transform: "translate(0px,0px) scale(1)" }], { duration: 520, delay: d, easing: "ease-out" });
    });
    ctl.after(30, () => {
      list.forEach((sh, i) => {
        const el = flyRefs.current[i];
        if (el) ctl.anim(el, [
          { transform: `translate(${px(sh.from.x)},${px(sh.from.y)}) scale(.6)`, opacity: 0 },
          { transform: `translate(${px(sh.from.x)},${px(sh.from.y)}) scale(.6)`, opacity: 1, offset: 0.05 },
          { transform: `translate(${px(lerp(sh.from.x, sh.x, 0.5))},${px(Math.min(sh.from.y, sh.y) - 80)}) scale(1)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${px(sh.x)},${px(sh.y)}) scale(1.2)`, opacity: 1 },
        ], { duration: 560, delay: sh.t - 560, easing: "ease-in", fill: "both" });
        ctl.after(sh.t, () => {
          if (el) ctl.anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: "forwards" });
          tintAt(sh, sh.big ? 9999 : Math.max(110, sh.size * 0.9));
        });
      });
      tiles.forEach((o, i) => tileGlow(ctl, o.c, `rgba(${HOLI[i % HOLI.length].rgb},.5)`, 0.13, { delay: 800 + i * 450, dur: 700, back: 8770 + i * 60 }));
    });
    // l'eau rince tout, de haut en bas
    ctl.after(8800, () => {
      atoms.forEach((o, i) => { if (tinted[i]) tintOut(ctl, o.c, tinted[i], { delay: clamp(o.cy / H, 0, 1) * 1100, dur: 500 }); });
    });
    steps(ctl, setPh, [150, 6600, 8800, 10300]);
    ctl.after(11000, () => s.finish());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={HOLI_CSS}>
      {shots.map(sh => (
        <div key={"s" + sh.i} aria-hidden="true" style={{ position: "absolute", left: sh.x, top: sh.y, width: sh.size * 0.9, height: sh.size * 0.8,
          borderRadius: "48% 52% 44% 56%", background: `radial-gradient(circle, rgba(${sh.col.rgb},.55), rgba(${sh.col.rgb},.18) 60%, transparent 72%)`,
          filter: "blur(3px)", opacity: 0, transform: "translate(-50%, -50%)",
          animation: `pk-holi-stain ${((sh.big ? 9400 : 9000) - sh.t) / 1000}s ease-out ${sh.t / 1000}s both` }}/>
      ))}
      {shots.map(sh => (
        <div key={"c" + sh.i} aria-hidden="true" style={{ position: "absolute", left: sh.x, top: sh.y, width: sh.size, height: sh.size, borderRadius: "50%",
          background: `radial-gradient(circle, rgba(${sh.col.rgb},.95) 0%, rgba(${sh.col.rgb},.6) 38%, rgba(${sh.col.rgb},0) 70%)`,
          filter: "blur(6px)", opacity: 0, animation: `pk-holi-cloud 1.6s ease-out ${sh.t / 1000}s both` }}/>
      ))}
      {shots.map((sh, i) => (
        <div key={"f" + sh.i} ref={el => { flyRefs.current[i] = el; }} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, opacity: 0 }}>
          <div style={{ width: 26, height: 26, marginLeft: -13, marginTop: -13, borderRadius: "50%",
            background: `radial-gradient(circle at 35% 35%, #fff8, ${sh.col.c} 45%, rgba(${sh.col.rgb},0) 75%)`, filter: "blur(1px)" }}/>
        </div>
      ))}
      {ph >= 3 && (
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: "100%",
          background: "linear-gradient(180deg, transparent, rgba(186,230,253,.28) 35%, rgba(125,211,252,.4) 50%, rgba(186,230,253,.28) 65%, transparent)",
          animation: "pk-holi-wash 1.7s ease-in-out both" }}/>
      )}
      {ph === 1 && <Pill key="a">🎨 Joyeuse Holi ! Attention, la poudre colorée vise ton accueil.</Pill>}
      {ph === 2 && <Pill key="b">💥 Grand lancer final : toutes les couleurs de l'AMS d'un coup !</Pill>}
      {ph === 3 && <Pill key="c">💧 Un coup de rinçage…</Pill>}
      {ph === 4 && <Pill key="d" fade>Tout est propre. Il reste un peu de rose derrière les oreilles.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Le 4 mai : generique spatial en perspective, vitesse lumiere
// ════════════════════════════════════════════════════════════════════════════
const SW_CSS = `
@keyframes pk-star-wars-night { 0% { opacity: 0 } 3% { opacity: .2 } 13%, 86% { opacity: .94 } 100% { opacity: 0 } }
@keyframes pk-star-wars-intro { 0% { opacity: 0 } 20%, 75% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-star-wars-crawl { 0% { transform: translateY(0) } 100% { transform: translateY(calc(-100% - 70vh)) } }
@keyframes pk-star-wars-fade { 0%, 85% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-star-wars-title { 0% { transform: scale(2.6); opacity: 0 } 10% { opacity: 1 } 100% { transform: scale(.05); opacity: 0 } }
`;
function StarWars({ done }) {
  const s = useStage6(done);
  const [ph, setPh] = useState(0);
  const cvRef = useRef(null);
  const T = { out: 0.2, intro: 1.5, title: 3.7, crawl: 5.1, back: 11.5, end: 13.1 };
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh();
    const c = stageCenter();
    const atoms = atomsOf(ctl, 120);
    // aller : chaque morceau file vers le point de fuite
    atoms.forEach(o => {
      const dl = rand(0, 450);
      const to = `translate(${px(c.x - o.cx)},${px(c.y - o.cy)}) scale(.04)`;
      ctl.anim(o.c, [{ transform: "translate(0px,0px) scale(1)", opacity: 1 }, { transform: to, opacity: 0 }],
        { duration: 1100, delay: T.out * 1000 + dl, easing: "cubic-bezier(.45,0,.8,.5)", fill: "forwards" });
      // retour : ils reviennent du fond de l'espace
      ctl.after(T.back * 1000 + dl * 0.8, () => ctl.anim(o.c, [{ transform: to, opacity: 0 }, { transform: "translate(0px,0px) scale(1)", opacity: 1 }],
        { duration: 950, easing: "cubic-bezier(.1,.6,.3,1)", fill: "forwards" }));
    });
    steps(ctl, setPh, [100, 1400, 11400, 12600]);
    // etoiles : vitesse lumiere au debut et a la fin, derive lente au milieu
    const cv = cvRef.current;
    const g = cv && cv.getContext ? cv.getContext("2d") : null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv) { cv.width = W * dpr; cv.height = H * dpr; }
    const stars = Array.from({ length: isNarrow() ? 220 : 420 }, () => ({ x: rand(-1, 1), y: rand(-1, 1), z: rand(0.05, 1) }));
    const warp = t => Math.max(smooth(clamp(1 - Math.abs(t - 0.9) / 0.9, 0, 1)), smooth(clamp(1 - Math.abs(t - 12.0) / 0.9, 0, 1)));
    ctl.loop((t, dt) => {
      if (g) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        const w = warp(t), sp = 0.04 + w * 1.9;
        const K = Math.max(W, H) * 0.5;
        const fade = clamp(t / 0.6, 0, 1) * clamp((T.end - t) / 0.8, 0, 1);
        g.lineCap = "round";
        for (const st of stars) {
          const z0 = st.z;
          st.z -= sp * dt;
          if (st.z <= 0.02) { st.x = rand(-1, 1); st.y = rand(-1, 1); st.z = 1; continue; }
          const x = c.x + st.x / st.z * K * 0.5, y = c.y + st.y / st.z * K * 0.5;
          const x0 = c.x + st.x / Math.min(1, z0 + w * 0.08) * K * 0.5, y0 = c.y + st.y / Math.min(1, z0 + w * 0.08) * K * 0.5;
          const b = clamp(1.2 - st.z, 0.15, 1) * fade;
          g.strokeStyle = `rgba(${200 + Math.round(55 * w)},${220 + Math.round(35 * w)},255,${b.toFixed(2)})`;
          g.lineWidth = clamp((1.2 - st.z) * 2.4, 0.6, 2.6);
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x + 0.01, y + 0.01); g.stroke();
        }
      }
      if (t > T.end) { s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const narrow = isNarrow();
  const crawlW = Math.min(620, vw() * 0.9);
  const crawlDur = T.back - T.crawl + 0.4;
  return (
    <Layer s={s} css={SW_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, #0b1026, #000 75%)",
        animation: `pk-star-wars-night ${T.end}s linear both` }}/>
      <canvas ref={cvRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}/>
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "40%", width: "min(86vw, 520px)", transform: "translate(-50%, -50%)",
        color: "#5cc8ff", textAlign: "center", fontSize: narrow ? 17 : 22, lineHeight: 1.45, fontFamily: FONT, fontWeight: 500, opacity: 0,
        animation: `pk-star-wars-intro 2.3s ease ${T.intro}s both` }}>
        Il y a bien longtemps, dans un atelier lointain, très lointain…
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: "34%", textAlign: "center", opacity: 0,
        color: "transparent", WebkitTextStroke: "2px #fde047", fontFamily: FONT, fontWeight: 900, letterSpacing: ".08em",
        fontSize: narrow ? 46 : 84, lineHeight: 0.95, animation: `pk-star-wars-title 2.9s cubic-bezier(.3,0,.7,1) ${T.title}s both` }}>
        LA GUERRE<br/>DES BOBINES
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: 0, width: crawlW, height: "120vh", marginLeft: -crawlW / 2,
        perspective: narrow ? 240 : 320, perspectiveOrigin: "50% 0%", overflow: "hidden", opacity: 1,
        WebkitMaskImage: "linear-gradient(transparent 8%, #000 50%)", maskImage: "linear-gradient(transparent 8%, #000 50%)",
        animation: `pk-star-wars-fade ${T.back - T.crawl + 0.5}s linear ${T.crawl}s both` }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, transformOrigin: "50% 100%", transform: "rotateX(34deg)" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: "100%", color: "#fde047", fontFamily: FONT, fontWeight: 700,
            fontSize: narrow ? 19 : 27, lineHeight: 1.45, textAlign: "justify", hyphens: "auto",
            animation: `pk-star-wars-crawl ${crawlDur}s linear ${T.crawl}s both` }}>
            <div style={{ transform: "translateY(0)" }}>
              <p style={{ textAlign: "center", margin: 0 }}>Épisode MMXXVI</p>
              <p style={{ textAlign: "center", margin: "0 0 .8em", fontSize: "1.25em", letterSpacing: ".04em" }}>LA REVANCHE DU FILAMENT</p>
              <p style={{ margin: "0 0 .8em" }}>C'est une période de troubles dans l'atelier. Cachées dans l'AMS, des bobines rebelles ont remporté leur première victoire contre le terrible Warping.</p>
              <p style={{ margin: "0 0 .8em" }}>Pendant la bataille, des imprimeurs ont dérobé les plans de l'arme ultime de l'Empire : un plateau sur lequel rien ne colle jamais.</p>
              <p style={{ margin: 0 }}>Poursuivie par une flotte de buses bouchées, la vaillante équipe file à travers la galaxie pour réussir, enfin, la première couche parfaite…</p>
            </div>
          </div>
        </div>
      </div>
      {ph === 1 && <Pill key="a">✨ Passage en vitesse lumière…</Pill>}
      {ph === 3 && <Pill key="c">🚀 Que le 4 mai soit avec toi !</Pill>}
      {ph === 4 && <Pill key="d" fade>Retour en vitesse normale. L'atelier est intact.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Dia de Muertos : fleurs, papel picado, calaveras en sucre, bougies
// ════════════════════════════════════════════════════════════════════════════
const DM_CSS = fallCss("dia-de-muertos") + `
@keyframes pk-dia-de-muertos-banner { 0% { transform: translateY(-120%) } 10%, 88% { transform: translateY(0) } 100% { transform: translateY(-120%) } }
@keyframes pk-dia-de-muertos-flag { 0%, 100% { transform: rotate(-5deg) skewX(-3deg) } 50% { transform: rotate(5deg) skewX(3deg) } }
@keyframes pk-dia-de-muertos-rise { 0% { transform: translateY(140%) rotate(-8deg) } 12% { transform: translateY(-6%) rotate(4deg) } 18%, 86% { transform: translateY(0) rotate(0deg) }
  100% { transform: translateY(150%) rotate(6deg) } }
@keyframes pk-dia-de-muertos-bob { 0%, 100% { transform: translateY(0) rotate(-4deg) } 50% { transform: translateY(-8px) rotate(4deg) } }
@keyframes pk-dia-de-muertos-flame { 0%, 100% { transform: scale(1, 1) rotate(-2deg) } 30% { transform: scale(.92, 1.08) rotate(3deg) } 60% { transform: scale(1.05, .94) rotate(-3deg) } }
@keyframes pk-dia-de-muertos-halo { 0%, 100% { opacity: .55 } 50% { opacity: .9 } }
@keyframes pk-dia-de-muertos-candles { 0% { opacity: 0; transform: translateY(30px) } 10%, 88% { opacity: 1; transform: translateY(0) } 100% { opacity: 0; transform: translateY(30px) } }
`;
const DM_COLS = ["#ec4899", "#f97316", "#14b8a6", "#a855f7", "#facc15", "#22c55e", "#3b82f6", "#ef4444"];
// Fanion decoupe : rectangle plein, motifs evides (regle evenodd), bas en dents
function PicadoFlag({ w, c, k }) {
  const h = w * 1.25;
  const holes = [];
  const cx = w / 2, cy = h * 0.46;
  // fleur centrale
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3, x = cx + Math.cos(a) * w * 0.15, y = cy + Math.sin(a) * w * 0.15, r = w * 0.075;
    holes.push(`M${x - r} ${y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`);
  }
  const r0 = w * 0.06;
  holes.push(`M${cx - r0} ${cy} a${r0} ${r0} 0 1 0 ${2 * r0} 0 a${r0} ${r0} 0 1 0 ${-2 * r0} 0`);
  // losanges en frise
  for (let i = 0; i < 4; i++) {
    const x = w * (0.17 + i * 0.22), y = h * (k % 2 ? 0.14 : 0.8), d = w * 0.06;
    holes.push(`M${x} ${y - d} L${x + d} ${y} L${x} ${y + d} L${x - d} ${y} Z`);
  }
  let edge = `M0 0 L${w} 0 L${w} ${h * 0.92}`;
  for (let i = 8; i > 0; i--) edge += ` L${w * (i - 0.5) / 8} ${h} L${w * (i - 1) / 8} ${h * 0.92}`;
  edge += " Z";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
      <path d={edge + " " + holes.join(" ")} fill={c} fillRule="evenodd" opacity=".92"/>
    </svg>
  );
}
function Marigold({ s }) {
  return (
    <svg width={s} height={s} viewBox="-12 -12 24 24" style={{ display: "block", overflow: "visible" }}>
      {Array.from({ length: 12 }, (_, i) => {
        const a = i * Math.PI / 6;
        return <circle key={i} cx={Math.cos(a) * 7} cy={Math.sin(a) * 7} r="4.4" fill={i % 2 ? "#f97316" : "#fb923c"} stroke="#c2410c" strokeWidth=".5"/>;
      })}
      {Array.from({ length: 8 }, (_, i) => {
        const a = i * Math.PI / 4 + 0.3;
        return <circle key={"b" + i} cx={Math.cos(a) * 3.6} cy={Math.sin(a) * 3.6} r="3.2" fill={i % 2 ? "#fbbf24" : "#f59e0b"}/>;
      })}
      <circle r="2.6" fill="#fde68a"/>
    </svg>
  );
}
// Calavera en sucre : ronde, souriante, yeux en fleurs
function Calavera({ w, c1, c2 }) {
  return (
    <svg width={w} height={w * 1.1} viewBox="0 0 100 110" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 6px 8px rgba(0,0,0,.3))" }}>
      <path d="M50 4 C80 4 96 26 94 52 C93 66 86 72 80 76 L78 94 Q78 104 68 104 L32 104 Q22 104 22 94 L20 76 C14 72 7 66 6 52 C4 26 20 4 50 4 Z"
        fill="#fdf8ef" stroke="#e7dccb" strokeWidth="2"/>
      {[[32, 48], [68, 48]].map(([x, y], i) => (
        <g key={i}>
          {Array.from({ length: 8 }, (_, k) => {
            const a = k * Math.PI / 4;
            return <circle key={k} cx={x + Math.cos(a) * 11} cy={y + Math.sin(a) * 11} r="5" fill={k % 2 ? c1 : c2}/>;
          })}
          <circle cx={x} cy={y} r="9" fill="#1f2937"/>
          <circle cx={x + 3} cy={y - 3} r="3" fill="#fff"/>
        </g>
      ))}
      <path d="M50 60 C45 54 40 60 50 68 C60 60 55 54 50 60 Z" fill={c1}/>
      <path d="M28 78 Q50 96 72 78" stroke="#1f2937" strokeWidth="3" fill="none" strokeLinecap="round"/>
      {[34, 42, 50, 58, 66].map(x => <line key={x} x1={x} y1={80 + (x === 50 ? 6 : Math.abs(50 - x) < 10 ? 4 : 0)} x2={x} y2={88} stroke="#1f2937" strokeWidth="2"/>)}
      <g transform="translate(50 22)">
        {Array.from({ length: 5 }, (_, k) => {
          const a = k * Math.PI * 2 / 5 - Math.PI / 2;
          return <ellipse key={k} cx={Math.cos(a) * 6} cy={Math.sin(a) * 6} rx="4.5" ry="3" transform={`rotate(${k * 72} ${Math.cos(a) * 6} ${Math.sin(a) * 6})`} fill={c2}/>;
        })}
        <circle r="3" fill="#facc15"/>
      </g>
      <path d="M12 40 Q18 34 22 40 M78 40 Q82 34 88 40" stroke={c2} strokeWidth="3" fill="none" strokeLinecap="round"/>
    </svg>
  );
}
function Candle({ h, c, fd }) {
  return (
    <div style={{ position: "relative", width: h * 0.34, height: h }}>
      <div style={{ position: "absolute", left: "50%", top: -h * 0.42, width: h * 0.9, height: h * 0.9, marginLeft: -h * 0.45, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(253,224,71,.55), rgba(251,146,60,.15) 50%, transparent 70%)", animation: "pk-dia-de-muertos-halo 1.4s ease-in-out infinite" }}/>
      <div style={{ position: "absolute", left: "50%", top: -h * 0.3, width: h * 0.16, height: h * 0.3, marginLeft: -h * 0.08,
        borderRadius: "50% 50% 50% 50% / 70% 70% 30% 30%", background: "radial-gradient(circle at 50% 75%, #fff7c2, #fbbf24 45%, #f97316)",
        transformOrigin: "50% 100%", animation: `pk-dia-de-muertos-flame ${fd.toFixed(2)}s ease-in-out infinite` }}/>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, borderRadius: "3px 3px 2px 2px",
        background: `linear-gradient(90deg, ${c}, #fff7ed 45%, ${c})` }}/>
    </div>
  );
}
function DiaDeMuertos({ done }) {
  const s = useStage6(done);
  const [ph, setPh] = useState(0);
  const W = vw(), narrow = isNarrow();
  const flags = useMemo(() => {
    const fw = narrow ? 34 : 46;
    const n = Math.ceil(W / (fw + 6)) + 1;
    return { fw, rows: [0, 1].map(r => Array.from({ length: n }, (_, i) => ({ i, c: DM_COLS[(i + r * 3) % DM_COLS.length], d: rand(1.8, 2.6), ph: Math.random() }))) };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const petals = useMemo(() => makeFall(narrow ? 22 : 36, { t0: 0.3, t1: 8, d: [4, 6.5], size: [16, 30] }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const skulls = useMemo(() => {
    const n = narrow ? 3 : 5;
    return Array.from({ length: n }, (_, i) => ({ i, x: (i + 0.5) / n * 100, w: narrow ? 70 : 88, c1: DM_COLS[i % 8], c2: DM_COLS[(i + 3) % 8], dl: 1.6 + i * 0.35 }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const candles = useMemo(() => Array.from({ length: narrow ? 6 : 12 }, (_, i) => ({ i, h: rand(30, 52), fd: rand(0.5, 0.8), c: ["#f5d0a9", "#fde68a", "#fbcfe8", "#ffffff"][i % 4] })), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const atoms = atomsOf(ctl, 120).sort(byReading);
    const tiles = tilesOf(ctl, 12);
    const n = atoms.length || 1;
    const tints = atoms.map((o, i) => fTint([-10, 295, 155, 15, 245][i % 5], ["rgba(249,115,22,.85)", "rgba(236,72,153,.8)", "rgba(20,184,166,.8)", "rgba(250,204,21,.85)", "rgba(168,85,247,.8)"][i % 5], 2.4, 0.6, 1.04));
    atoms.forEach((o, i) => tintIn(ctl, o.c, tints[i], { delay: 600 + i / n * 2600, dur: 600 }));
    tiles.forEach((o, i) => tileGlow(ctl, o.c, "rgba(249,115,22,.5)", 0.1, { delay: 500 + i * 200, back: 9000 }));
    // la danse : balancement doux, comme les fanions au vent
    ctl.after(3400, () => atoms.forEach((o, i) => {
      const a = amp(o.r, 9), r = i % 2 ? 7 : -7;
      ctl.anim(o.c, [
        { transform: "translate(0px,0px) rotate(0deg)" },
        { transform: `translate(0px,${(-a).toFixed(1)}px) rotate(${r}deg)`, offset: 0.25 },
        { transform: "translate(0px,0px) rotate(0deg)", offset: 0.5 },
        { transform: `translate(0px,${(-a).toFixed(1)}px) rotate(${-r}deg)`, offset: 0.75 },
        { transform: "translate(0px,0px) rotate(0deg)" },
      ], { duration: 1300, delay: (i % 6) * 90, iterations: 4, easing: "ease-in-out" });
    }));
    ctl.after(9000, () => atoms.forEach((o, i) => tintOut(ctl, o.c, tints[i], { delay: i / n * 1000, dur: 700 })));
    steps(ctl, setPh, [200, 4200, 10300]);
    ctl.after(11400, () => s.finish());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rowTop = narrow ? 56 : 0;
  const bottom = narrow ? 128 : 60;
  return (
    <Layer s={s} css={DM_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, animation: "pk-kit-soft 11.4s ease both",
        background: "radial-gradient(ellipse at 50% 100%, rgba(249,115,22,.22), transparent 60%), radial-gradient(ellipse at 50% 0%, rgba(168,85,247,.16), transparent 55%)" }}/>
      {flags.rows.map((row, r) => (
        <div key={r} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: rowTop + r * (flags.fw * 1.25 + 16), display: "flex", gap: 6,
          paddingLeft: r ? flags.fw / 2 : 0, animation: `pk-dia-de-muertos-banner 11.2s ease ${r * 0.25}s both` }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1, height: 2, background: "#78350f" }}/>
          {row.map(f => (
            <div key={f.i} style={{ transformOrigin: "50% 0", animation: `pk-dia-de-muertos-flag ${f.d.toFixed(2)}s ease-in-out ${(-f.d * f.ph).toFixed(2)}s infinite` }}>
              <PicadoFlag w={flags.fw} c={f.c} k={f.i + r}/>
            </div>
          ))}
        </div>
      ))}
      <Fall k="dia-de-muertos" items={petals} render={b => <Marigold s={b.size}/>}/>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: bottom - 6, display: "flex", justifyContent: "space-around",
        alignItems: "flex-end", padding: "0 12px", animation: "pk-dia-de-muertos-candles 11.2s ease .2s both" }}>
        {candles.map(c => <Candle key={c.i} h={c.h} c={c.c} fd={c.fd}/>)}
      </div>
      {skulls.map(k => (
        <div key={k.i} aria-hidden="true" style={{ position: "absolute", left: `${k.x}%`, bottom: bottom + 30, marginLeft: -k.w / 2,
          animation: `pk-dia-de-muertos-rise ${(10.6 - k.dl).toFixed(2)}s ease ${k.dl.toFixed(2)}s both` }}>
          <div style={{ animation: `pk-dia-de-muertos-bob ${(1.1 + k.i * 0.13).toFixed(2)}s ease-in-out infinite` }}>
            <Calavera w={k.w} c1={k.c1} c2={k.c2}/>
          </div>
        </div>
      ))}
      {ph === 1 && <Pill key="a">🌼 Día de Muertos : des fleurs, des bougies, et des souvenirs qui sourient.</Pill>}
      {ph === 2 && <Pill key="b">💀🌸 Les calaveras sont en sucre : elles ne mordent pas, elles dansent.</Pill>}
      {ph === 3 && <Pill key="c" fade>Les pétales se posent. Tout reprend sa place.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Diwali : diyas, rangoli, feux d'artifice doux
// ════════════════════════════════════════════════════════════════════════════
const DIWALI_CSS = `
@keyframes pk-diwali-veil { 0% { opacity: 0 } 12%, 86% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-diwali-row { 0% { opacity: 0; transform: translateY(24px) } 8%, 90% { opacity: 1; transform: translateY(0) } 100% { opacity: 0; transform: translateY(16px) } }
@keyframes pk-diwali-light { 0% { opacity: 0; transform: scale(.2) } 60% { opacity: 1; transform: scale(1.25) } 100% { opacity: 1; transform: scale(1) } }
@keyframes pk-diwali-flicker { 0%, 100% { transform: scale(1, 1) rotate(-2deg) } 35% { transform: scale(.9, 1.1) rotate(3deg) } 70% { transform: scale(1.06, .94) rotate(-2deg) } }
@keyframes pk-diwali-ring { 0% { opacity: 0; transform: scale(.2) rotate(-60deg) } 100% { opacity: 1; transform: scale(1) rotate(0deg) } }
@keyframes pk-diwali-turn { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
@keyframes pk-diwali-rangoli { 0% { opacity: 1 } 85% { opacity: 1 } 100% { opacity: 0 } }
`;
const RANGOLI = ["#ec4899", "#f97316", "#facc15", "#14b8a6", "#a855f7", "#ef4444"];
function Diya({ w, lit }) {
  return (
    <div style={{ position: "relative", width: w, height: w * 0.62 }}>
      <div style={{ position: "absolute", left: "50%", bottom: w * 0.36, width: w * 1.3, height: w * 1.3, marginLeft: -w * 0.65, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(253,224,71,.6), rgba(251,146,60,.18) 45%, transparent 70%)", opacity: 0,
        animation: `pk-diwali-light .7s ease-out ${lit}s both` }}/>
      <div style={{ position: "absolute", left: "50%", bottom: w * 0.42, width: w * 0.2, height: w * 0.42, marginLeft: -w * 0.1, opacity: 0,
        animation: `pk-diwali-light .5s ease-out ${lit}s both` }}>
        <div style={{ width: "100%", height: "100%", borderRadius: "50% 50% 50% 50% / 70% 70% 30% 30%", transformOrigin: "50% 100%",
          background: "radial-gradient(circle at 50% 75%, #fffbeb, #fde047 40%, #f97316 80%)", boxShadow: "0 0 14px 4px rgba(253,186,60,.8)",
          animation: `pk-diwali-flicker ${(0.55 + (w % 7) * 0.04).toFixed(2)}s ease-in-out infinite` }}/>
      </div>
      <svg width={w} height={w * 0.62} viewBox="0 0 100 62" style={{ position: "absolute", left: 0, bottom: 0, overflow: "visible",
        filter: "drop-shadow(0 3px 4px rgba(0,0,0,.35))" }}>
        <path d="M2 14 Q50 28 98 14 Q92 52 50 58 Q8 52 2 14 Z" fill="#c2410c" stroke="#7c2d12" strokeWidth="2"/>
        <path d="M2 14 Q50 0 98 14 Q50 28 2 14 Z" fill="#9a3412"/>
        <path d="M84 12 Q98 6 100 12" stroke="#7c2d12" strokeWidth="3" fill="none" strokeLinecap="round"/>
        <path d="M14 30 Q50 44 86 30" stroke="#facc15" strokeWidth="2.4" fill="none" strokeDasharray="5 4"/>
        {[30, 50, 70].map(x => <circle key={x} cx={x} cy={44} r="3" fill="#14b8a6"/>)}
      </svg>
    </div>
  );
}
function Rangoli({ d }) {
  const rings = [
    { n: 8, r: 16, pr: [8, 15], dl: 0 }, { n: 12, r: 30, pr: [7, 12], dl: 0.35 }, { n: 16, r: 44, pr: [7, 11], dl: 0.7 },
    { n: 20, r: 58, pr: [6, 10], dl: 1.05 }, { n: 24, r: 72, pr: [5, 9], dl: 1.4 }, { n: 32, r: 86, pr: [4, 6], dl: 1.75 },
  ];
  return (
    <svg width={d} height={d} viewBox="-100 -100 200 200" style={{ display: "block", overflow: "visible" }}>
      {rings.map((g, gi) => (
        <g key={gi} style={{ transformOrigin: "0 0", animation: `pk-diwali-ring .8s cubic-bezier(.2,1.3,.4,1) ${g.dl}s both` }}>
          {Array.from({ length: g.n }, (_, k) => {
            const a = k * 360 / g.n;
            return <ellipse key={k} cx="0" cy={-g.r} rx={g.pr[0] * 0.8} ry={g.pr[1] * 0.85} transform={`rotate(${a})`}
              fill={RANGOLI[(gi + k % 2) % RANGOLI.length]} stroke="rgba(255,255,255,.7)" strokeWidth=".8"/>;
          })}
          {gi % 2 === 1 && Array.from({ length: g.n }, (_, k) => (
            <circle key={"d" + k} cx="0" cy={-(g.r + g.pr[1] + 3)} r="1.8" transform={`rotate(${(k + 0.5) * 360 / g.n})`} fill="#fff"/>
          ))}
        </g>
      ))}
      <circle r="9" fill="#facc15" stroke="#fff" strokeWidth="1.5" style={{ animation: "pk-diwali-ring .6s ease-out both" }}/>
    </svg>
  );
}
function Diwali({ done }) {
  const s = useStage6(done);
  const [ph, setPh] = useState(0);
  const cvRef = useRef(null);
  const narrow = isNarrow();
  const diyas = useMemo(() => Array.from({ length: narrow ? 5 : 9 }, (_, i) => i), []); // eslint-disable-line react-hooks/exhaustive-deps
  const rd = Math.min(vw() * 0.78, (floorY() - topPad()) * 0.62, 420);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh();
    const atoms = atomsOf(ctl, 120);
    // la lumiere part des lampes (en bas, au centre) et gagne toute la page
    const ox = W / 2, oy = floorY();
    const dist = o => Math.hypot(o.cx - ox, o.cy - oy);
    const dmax = Math.max(1, ...atoms.map(dist));
    const glow = "sepia(.7) saturate(2.4) hue-rotate(-6deg) brightness(1.25) drop-shadow(0 0 8px rgba(253,186,60,1))";
    tilesOf(ctl, 12).forEach(o => tileGlow(ctl, o.c, "rgba(251,191,36,.5)", 0.08, { delay: 1500 + Math.hypot(o.r.left + o.r.width / 2 - W / 2, o.r.top + o.r.height / 2 - floorY()) / Math.max(W, H) * 3600, back: 9400 }));
    atoms.forEach(o => {
      const dl = 1500 + dist(o) / dmax * 3600;
      tintIn(ctl, o.c, glow, { delay: dl, dur: 500 });
      ctl.anim(o.c, [{ transform: "scale(1)" }, { transform: "scale(1.12)", offset: 0.4 }, { transform: "scale(1)" }], { duration: 600, delay: dl, easing: "ease-out" });
      ctl.after(9300 + (1 - dist(o) / dmax) * 900, () => tintOut(ctl, o.c, glow, { dur: 800 }));
    });
    steps(ctl, setPh, [200, 5200, 10200]);
    // feux d'artifice doux, en particules
    const cv = cvRef.current;
    const g = cv && cv.getContext ? cv.getContext("2d") : null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv) { cv.width = W * dpr; cv.height = H * dpr; }
    const parts = [], flashes = [];
    const COLS = ["255,214,102", "255,140,105", "244,114,182", "167,139,250", "94,234,212", "255,255,255"];
    const bursts = [5.2, 5.9, 6.6, 7.2, 7.9, 8.5, 9.1].map((t, i) => ({ t, x: rand(0.15, 0.85) * W, y: rand(0.14, 0.36) * H, col: COLS[i % COLS.length], done: false }));
    ctl.loop((t, dt) => {
      bursts.forEach(b => {
        if (b.done || t < b.t) return;
        b.done = true;
        const n = narrow ? 46 : 70;
        for (let k = 0; k < n; k++) {
          const a = k / n * Math.PI * 2 + rand(-0.05, 0.05), v = rand(60, 150) * (narrow ? 0.8 : 1);
          parts.push({ x: b.x, y: b.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(1.3, 2), age: 0, col: k % 5 ? b.col : COLS[5] });
        }
        flashes.push({ x: b.x, y: b.y, age: 0, col: b.col });
      });
      if (g) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        g.globalCompositeOperation = "lighter";
        for (let k = flashes.length - 1; k >= 0; k--) {
          const f = flashes[k];
          f.age += dt;
          if (f.age > 0.5) { flashes.splice(k, 1); continue; }
          const rr = 20 + f.age * 140, gr = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, rr);
          gr.addColorStop(0, `rgba(${f.col},${(0.55 * (1 - f.age / 0.5)).toFixed(2)})`); gr.addColorStop(1, `rgba(${f.col},0)`);
          g.fillStyle = gr; g.beginPath(); g.arc(f.x, f.y, rr, 0, Math.PI * 2); g.fill();
        }
        for (let k = parts.length - 1; k >= 0; k--) {
          const p = parts[k];
          p.age += dt;
          if (p.age > p.life) { parts.splice(k, 1); continue; }
          p.vx *= 0.985; p.vy = p.vy * 0.985 + 40 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          const a = (1 - p.age / p.life);
          g.fillStyle = `rgba(${p.col},${(a * 0.9).toFixed(2)})`;
          g.beginPath(); g.arc(p.x, p.y, 1.6 + a * 2.4, 0, Math.PI * 2); g.fill();
          g.fillStyle = `rgba(${p.col},${(a * 0.18).toFixed(2)})`;
          g.beginPath(); g.arc(p.x, p.y, 5 + a * 4, 0, Math.PI * 2); g.fill();
        }
        g.globalCompositeOperation = "source-over";
      }
      if (t > 11.6) { s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dw = narrow ? 46 : 58;
  return (
    <Layer s={s} css={DIWALI_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, animation: "pk-diwali-veil 11.6s ease both",
        background: "radial-gradient(ellipse at 50% 55%, transparent 35%, rgba(40,12,50,.55) 100%)" }}/>
      <canvas ref={cvRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}/>
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: (topPad() + floorY()) / 2 - rd / 2 - 20, width: rd, height: rd, marginLeft: -rd / 2,
        opacity: 0.88, animation: "pk-diwali-rangoli 9.6s linear 1s both" }}>
        <div style={{ width: "100%", height: "100%", animation: "pk-diwali-turn 40s linear infinite" }}><Rangoli d={rd}/></div>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: narrow ? 128 : 64, display: "flex", justifyContent: "space-around",
        alignItems: "flex-end", padding: "0 10px", animation: "pk-diwali-row 11.4s ease both" }}>
        {diyas.map(i => {
          const mid = (diyas.length - 1) / 2;
          return <Diya key={i} w={dw} lit={(0.6 + Math.abs(i - mid) * 0.35).toFixed(2)}/>;
        })}
      </div>
      {ph === 1 && <Pill key="a">🪔 Joyeuse Diwali ! Les lampes s'allument une à une.</Pill>}
      {ph === 2 && <Pill key="b">✨ La lumière gagne l'atelier… jusqu'au plateau chauffant.</Pill>}
      {ph === 3 && <Pill key="c" fade>Les diyas veillent encore un peu. Tout est revenu.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Thanksgiving : dinde en fuite, feuilles, tout le monde a table
// ════════════════════════════════════════════════════════════════════════════
const TG_CSS = fallCss("thanksgiving") + `
@keyframes pk-thanksgiving-run1 { 0% { transform: translateX(calc(100vw + 40px)) } 100% { transform: translateX(-160px) } }
@keyframes pk-thanksgiving-run2 { 0% { transform: translateX(-160px) } 100% { transform: translateX(calc(100vw + 40px)) } }
@keyframes pk-thanksgiving-trot { 0%, 100% { transform: translateY(0) rotate(-3deg) } 50% { transform: translateY(-7px) rotate(3deg) } }
@keyframes pk-thanksgiving-legA { 0%, 100% { transform: rotate(24deg) } 50% { transform: rotate(-24deg) } }
@keyframes pk-thanksgiving-legB { 0%, 100% { transform: rotate(-24deg) } 50% { transform: rotate(24deg) } }
@keyframes pk-thanksgiving-table { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.6) } 12%, 84% { opacity: 1; transform: translate(-50%, -50%) scale(1) }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(.85) } }
@keyframes pk-thanksgiving-steam { 0% { opacity: 0; transform: translateY(0) scaleX(1) } 30% { opacity: .7 } 100% { opacity: 0; transform: translateY(-26px) scaleX(1.4) } }
`;
const TG_LEAVES = ["#ea580c", "#dc2626", "#b45309", "#f59e0b", "#92400e", "#c2410c"];
function MapleLeaf({ s, c }) {
  return (
    <svg width={s} height={s} viewBox="-12 -12 24 26" style={{ display: "block", overflow: "visible" }}>
      <path d="M0 -11 L2 -6 L5 -8 L4.4 -2.6 L9.5 -4 L8 -0.5 L11 1 L5.5 4.5 L6.5 7 L0.8 6 L0.8 12 L-0.8 12 L-0.8 6 L-6.5 7 L-5.5 4.5 L-11 1 L-8 -0.5 L-9.5 -4 L-4.4 -2.6 L-5 -8 L-2 -6 Z"
        fill={c} stroke="rgba(0,0,0,.2)" strokeWidth=".6" strokeLinejoin="round"/>
      <path d="M0 -7 L0 11 M0 0 L5 -3 M0 0 L-5 -3 M0 3 L4 5 M0 3 L-4 5" stroke="rgba(0,0,0,.22)" strokeWidth=".6" fill="none"/>
    </svg>
  );
}
function Turkey({ w }) {
  const feathers = ["#b91c1c", "#ea580c", "#f59e0b", "#92400e", "#ea580c", "#b91c1c", "#f59e0b"];
  return (
    <svg width={w} height={w} viewBox="0 0 100 100" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 5px 5px rgba(0,0,0,.3))" }}>
      {feathers.map((c, i) => {
        const a = -150 + i * 20;
        return <ellipse key={i} cx="62" cy="22" rx="9" ry="26" fill={c} stroke="#7c2d12" strokeWidth="1" transform={`rotate(${a + 90} 62 48)`}/>;
      })}
      <g style={{ transformOrigin: "48px 72px", animation: "pk-thanksgiving-legA .32s linear infinite" }}>
        <path d="M48 72 L48 92 M48 92 L42 96 M48 92 L54 96" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" fill="none"/>
      </g>
      <g style={{ transformOrigin: "60px 72px", animation: "pk-thanksgiving-legB .32s linear infinite" }}>
        <path d="M60 72 L60 92 M60 92 L54 96 M60 92 L66 96" stroke="#d97706" strokeWidth="3" strokeLinecap="round" fill="none"/>
      </g>
      <ellipse cx="56" cy="58" rx="24" ry="20" fill="#78350f" stroke="#451a03" strokeWidth="1.5"/>
      <path d="M44 56 Q56 66 70 56" stroke="#a16207" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <path d="M38 52 Q28 40 30 26" stroke="#78350f" strokeWidth="10" fill="none" strokeLinecap="round"/>
      <circle cx="29" cy="22" r="9" fill="#a16207" stroke="#451a03" strokeWidth="1.2"/>
      <path d="M21 21 L13 24 L21 26 Z" fill="#f59e0b" stroke="#b45309" strokeWidth=".8"/>
      <path d="M22 27 Q18 36 23 38 Q26 34 24 27 Z" fill="#dc2626"/>
      <circle cx="27" cy="19" r="2.6" fill="#fff"/><circle cx="26.4" cy="19" r="1.4" fill="#111"/>
    </svg>
  );
}
function Feast({ w }) {
  return (
    <svg width={w} height={w * 0.62} viewBox="0 0 200 124" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 10px 14px rgba(0,0,0,.35))" }}>
      <ellipse cx="100" cy="74" rx="98" ry="44" fill="#92400e" stroke="#451a03" strokeWidth="2"/>
      <ellipse cx="100" cy="68" rx="98" ry="44" fill="#fff7ed" stroke="#fdba74" strokeWidth="2"/>
      <ellipse cx="100" cy="68" rx="70" ry="30" fill="none" stroke="#fb923c" strokeWidth="2" strokeDasharray="6 5"/>
      <ellipse cx="100" cy="70" rx="44" ry="20" fill="#e5e7eb" stroke="#9ca3af" strokeWidth="1.5"/>
      <ellipse cx="100" cy="66" rx="38" ry="16" fill="#b45309"/>
      <ellipse cx="100" cy="64" rx="32" ry="12.5" fill="#ea580c"/>
      <path d="M100 64 L132 62 M100 64 L116 75 M100 64 L84 75 M100 64 L68 62 M100 64 L100 52" stroke="#c2410c" strokeWidth="1.2"/>
      {[[100, 58], [114, 66], [86, 66]].map(([x, y], i) => (
        <g key={i}><ellipse cx={x} cy={y} rx="6" ry="3.6" fill="#fffbeb"/><ellipse cx={x} cy={y - 2.4} rx="3.4" ry="2.4" fill="#fff"/></g>
      ))}
      {[[40, 60], [160, 60], [60, 92], [140, 92]].map(([x, y], i) => (
        <g key={"p" + i}><ellipse cx={x} cy={y} rx="12" ry="5.5" fill="#fff" stroke="#d1d5db"/><ellipse cx={x} cy={y} rx="6" ry="2.6" fill="#fdba74"/></g>
      ))}
      {[[86, 40], [100, 34], [114, 40]].map(([x, y], i) => (
        <path key={"s" + i} d={`M${x} ${y + 12} q-4 -6 0 -12 q4 -6 0 -12`} stroke="rgba(255,255,255,.75)" strokeWidth="2.4" fill="none" strokeLinecap="round"
          style={{ transformOrigin: `${x}px ${y + 12}px`, animation: `pk-thanksgiving-steam 1.6s ease-out ${i * 0.45}s infinite` }}/>
      ))}
    </svg>
  );
}
function Thanksgiving({ done }) {
  const s = useStage6(done);
  const [ph, setPh] = useState(0);
  const narrow = isNarrow();
  const leaves = useMemo(() => makeFall(narrow ? 24 : 38, { t0: 0, t1: 8.5, d: [4.2, 6.8], size: [16, 30], colors: TG_LEAVES }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(stageCenter, []);
  const tw = Math.min(vw() * 0.5, 300);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh();
    const atoms = atomsOf(ctl, 120);
    const n = atoms.length || 1;
    // places autour de la table : deux rangees d'ellipse, chacun au plus pres
    const rx = Math.min(W * 0.44, 420), ry = Math.min((floorY() - topPad()) * 0.36, 250);
    const order = atoms.map((o, i) => ({ o, i, a: Math.atan2((o.cy - c.y) / ry, (o.cx - c.x) / rx) })).sort((p, q) => p.a - q.a);
    const seats = atoms.map(() => null);
    order.forEach((p, k) => {
      const a = -Math.PI + (k + 0.5) / n * Math.PI * 2;
      const f = k % 2 ? 1 : 0.84;
      const sx = c.x + Math.cos(a) * rx * f, sy = c.y + Math.sin(a) * ry * f;
      const m = Math.max(p.o.r.width, p.o.r.height);
      const sc = clamp((narrow ? 50 : 84) / Math.max(1, m), 0.3, 1);
      seats[p.i] = `translate(${px(sx - p.o.cx)},${px(sy - p.o.cy)}) scale(${sc.toFixed(3)})`;
    });
    const id = "translate(0px,0px) scale(1)";
    atoms.forEach((o, i) => {
      const dl = 3000 + (i % 24) * 55;
      ctl.anim(o.c, [{ transform: id }, { transform: seats[i] }], { duration: 1100, delay: dl, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" });
      // a table : on trinque (petit hochement), puis retour a sa place
      ctl.after(dl + 1150, () => ctl.anim(o.c, [{ transform: seats[i] }, { transform: seats[i] + " translateY(-6px) rotate(4deg)", offset: 0.5 }, { transform: seats[i] }],
        { duration: 700, delay: (i % 7) * 120, iterations: 3, easing: "ease-in-out" }));
      ctl.after(8000 + (i % 24) * 45, () => ctl.anim(o.c, [{ transform: seats[i] }, { transform: id }],
        { duration: 1100, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" }));
    });
    steps(ctl, setPh, [200, 3400, 10600]);
    ctl.after(11600, () => s.finish());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const tb = narrow ? 120 : 52;
  const tkw = narrow ? 80 : 104;
  return (
    <Layer s={s} css={TG_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, animation: "pk-kit-soft 11.6s ease both",
        background: "radial-gradient(ellipse at center, rgba(251,146,60,.16), rgba(120,53,15,.22))" }}/>
      <Fall k="thanksgiving" items={leaves} render={b => <MapleLeaf s={b.size} c={b.c}/>}/>
      <div aria-hidden="true" style={{ position: "absolute", left: c.x, top: c.y, opacity: 0, animation: "pk-thanksgiving-table 8s ease 2.6s both" }}>
        <Feast w={tw}/>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, bottom: tb, animation: "pk-thanksgiving-run1 3.2s linear .3s both" }}>
        <div style={{ animation: "pk-thanksgiving-trot .32s ease-in-out infinite" }}><Turkey w={tkw}/></div>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, bottom: tb, animation: "pk-thanksgiving-run2 2.6s linear 8.6s both" }}>
        <div style={{ transform: "scaleX(-1)" }}><div style={{ animation: "pk-thanksgiving-trot .3s ease-in-out infinite" }}><Turkey w={tkw}/></div></div>
      </div>
      {ph === 1 && <Pill key="a">🦃 Joyeux Thanksgiving ! La dinde a pris la fuite…</Pill>}
      {ph === 2 && <Pill key="b">🥧 Tout le monde à table : tarte à la citrouille pour chaque bobine.</Pill>}
      {ph === 3 && <Pill key="c" fade>Merci pour tout. Chacun reprend sa place, le ventre plein.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8. Jour de pi : chiffres qui defilent, cercles parfaits, une tarte
// ════════════════════════════════════════════════════════════════════════════
const PI_DIGITS = "3,1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679";
const PI_CSS = `
@keyframes pk-pi-ribbon { from { transform: translateX(100vw) } to { transform: translateX(-100%) } }
@keyframes pk-pi-ribbon2 { from { transform: translateX(-100%) } to { transform: translateX(100vw) } }
@keyframes pk-pi-draw { from { stroke-dashoffset: var(--len) } to { stroke-dashoffset: 0 } }
@keyframes pk-pi-show { 0% { opacity: 0 } 10%, 82% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-pi-sweep { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
@keyframes pk-pi-pie { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.2) rotate(-90deg) } 18% { opacity: 1; transform: translate(-50%, -50%) scale(1.08) rotate(6deg) }
  26%, 84% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0deg) } 100% { opacity: 0; transform: translate(-50%, -50%) scale(.8) rotate(0deg) } }
@keyframes pk-pi-sym { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4) } 15%, 80% { opacity: .9; transform: translate(-50%, -50%) scale(1) }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.6) } }
`;
function PiePie({ w }) {
  return (
    <svg width={w} height={w} viewBox="-60 -60 120 120" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 10px 14px rgba(0,0,0,.35))" }}>
      <circle r="58" fill="#e5e7eb" stroke="#9ca3af" strokeWidth="2"/>
      <circle r="50" fill="#d97706" stroke="#92400e" strokeWidth="2"/>
      {Array.from({ length: 24 }, (_, k) => {
        const a = k * Math.PI / 12;
        return <circle key={k} cx={Math.cos(a) * 47} cy={Math.sin(a) * 47} r="5" fill="#f59e0b" stroke="#b45309" strokeWidth="1"/>;
      })}
      <circle r="40" fill="#9f1239"/>
      <path d="M0 0 L40 0 A40 40 0 0 1 12.4 38 Z" fill="#be123c"/>
      {Array.from({ length: 14 }, (_, k) => <circle key={"b" + k} cx={Math.cos(k * 2.4) * (8 + (k * 7) % 28)} cy={Math.sin(k * 2.4) * (8 + (k * 7) % 28)} r="3.2" fill="#e11d48"/>)}
      <text x="0" y="13" textAnchor="middle" fontSize="40" fontWeight="800" fill="#fde68a" stroke="#92400e" strokeWidth="1.5" fontFamily="Georgia, serif">π</text>
    </svg>
  );
}
function Pi({ done }) {
  const s = useStage6(done);
  const [ph, setPh] = useState(0);
  const narrow = isNarrow();
  const c = useMemo(stageCenter, []);
  const R = useMemo(() => Math.min(vw() * 0.42, (floorY() - topPad()) * 0.4, 330), []);
  const [typed, setTyped] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    const atoms = atomsOf(ctl, 120);
    const n = atoms.length || 1;
    // chacun prend une place sur le cercle, au plus pres de son angle de depart
    const order = atoms.map((o, i) => ({ o, i, a: Math.atan2(o.cy - c.y, o.cx - c.x) })).sort((p, q) => p.a - q.a);
    const slot = atoms.map(() => 0);
    order.forEach((p, k) => { slot[p.i] = -Math.PI + (k + 0.5) / n * Math.PI * 2; });
    const scl = atoms.map(o => clamp(((2 * Math.PI * R) / n) * 1.5 / Math.max(1, o.r.width, o.r.height), 0.16, 1));
    const delay = atoms.map((_, i) => (i % 30) * 0.03);
    let moving = true, shown = 1;
    ctl.loop(t => {
      const ty = Math.min(PI_DIGITS.length, 1 + Math.floor(t * 9));
      if (ty !== shown) { shown = ty; setTyped(ty); }
      if (moving) {
        const turn = smooth(clamp((t - 3.2) / 5.2, 0, 1)) * Math.PI * 2;
        atoms.forEach((o, i) => {
          const go = smooth(clamp((t - 1.2 - delay[i]) / 1.4, 0, 1)), back = smooth(clamp((t - 8.6 - delay[i]) / 1.4, 0, 1));
          const e = go * (1 - back);
          if (e <= 0.0005) { ctl.unset(o.c, ["transform"]); return; }
          const a = slot[i] + turn;
          const tx = c.x + Math.cos(a) * R - o.cx, ty = c.y + Math.sin(a) * R - o.cy;
          const sc = lerp(1, scl[i], e);
          ctl.set(o.c, { transform: `translate(${px(tx * e)},${px(ty * e)}) scale(${sc.toFixed(3)})` });
        });
        if (t > 10.3) { moving = false; atoms.forEach(o => ctl.unset(o.c, ["transform"])); }
      }
      if (t > 11.6) { s.finish(); return false; }
      return true;
    });
    steps(ctl, setPh, [200, 3200, 8500, 10600]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const circ = r => 2 * Math.PI * r;
  const ribbon = { position: "absolute", left: 0, whiteSpace: "nowrap", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontWeight: 700,
    color: "#a78bfa", textShadow: "0 1px 6px rgba(0,0,0,.35)" };
  return (
    <Layer s={s} css={PI_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, animation: "pk-kit-soft 11.6s ease both",
        background: "radial-gradient(circle at 50% 50%, rgba(139,92,246,.16), transparent 70%)" }}/>
      <div aria-hidden="true" style={{ ...ribbon, top: topPad() + 4, fontSize: narrow ? 18 : 24, animation: "pk-pi-ribbon 11.5s linear both" }}>{PI_DIGITS}</div>
      <div aria-hidden="true" style={{ ...ribbon, bottom: narrow ? 176 : 80, fontSize: narrow ? 14 : 18, opacity: 0.75, color: "#f472b6",
        animation: "pk-pi-ribbon2 11.5s linear both" }}>{PI_DIGITS}</div>
      <svg aria-hidden="true" width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible", animation: "pk-pi-show 9.4s ease .4s both" }}>
        {[R, R * 0.66, R * 0.33, R * 1.18].map((r, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={r} fill="none" stroke={["#a78bfa", "#f472b6", "#60a5fa", "#34d399"][i]} strokeWidth={i === 0 ? 2.6 : 1.6}
            strokeDasharray={circ(r)} style={{ "--len": circ(r), animation: `pk-pi-draw 1.6s ease-in-out ${0.5 + i * 0.35}s both` }}
            transform={`rotate(-90 ${c.x} ${c.y})`} opacity={i === 3 ? 0.5 : 0.85}/>
        ))}
        <g style={{ transformOrigin: `${c.x}px ${c.y}px`, animation: "pk-pi-sweep 3s linear .5s infinite" }}>
          <line x1={c.x} y1={c.y} x2={c.x + R} y2={c.y} stroke="#fde68a" strokeWidth="2" strokeDasharray="5 4"/>
          <circle cx={c.x + R} cy={c.y} r="4" fill="#fde68a"/>
          <text x={c.x + R / 2} y={c.y - 6} textAnchor="middle" fontSize="14" fontWeight="700" fill="#fde68a" fontFamily={FONT}>r</text>
        </g>
        <circle cx={c.x} cy={c.y} r="3.5" fill="#fde68a"/>
        <text x={c.x} y={c.y + R * 0.33 + 24} textAnchor="middle" fontSize={narrow ? 14 : 17} fontWeight="700" fill="#c4b5fd" fontFamily={FONT}>C = 2πr</text>
      </svg>
      <div aria-hidden="true" style={{ position: "absolute", left: c.x, top: c.y - R * 0.12, color: "#c4b5fd", fontFamily: "Georgia, serif", fontWeight: 700,
        fontSize: R * 0.55, lineHeight: 1, textShadow: "0 4px 18px rgba(139,92,246,.6)", opacity: 0, animation: "pk-pi-sym 7.6s ease .9s both" }}>π</div>
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: topPad() + (narrow ? 32 : 40), transform: "translateX(-50%)",
        maxWidth: "calc(100vw - 32px)", overflow: "hidden", whiteSpace: "nowrap", direction: "rtl",
        fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontWeight: 800, fontSize: narrow ? 20 : 28, color: "#fde68a",
        textShadow: "0 2px 10px rgba(0,0,0,.45)", animation: "pk-pi-show 11.4s ease both" }}>
        <bdi>{PI_DIGITS.slice(0, typed)}</bdi>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: c.x, top: c.y, opacity: 0, animation: "pk-pi-pie 3.4s ease 8.4s both" }}>
        <PiePie w={Math.min(R * 0.9, 220)}/>
      </div>
      {ph === 1 && <Pill key="a">🔢 3,14159… Joyeux jour de π !</Pill>}
      {ph === 2 && <Pill key="b">⭕ Tout le monde en cercle : périmètre = 2πr, au micron près.</Pill>}
      {ph === 3 && <Pill key="c">🥧 Et une tarte ! (pie, en anglais. Tu l'as ?)</Pill>}
      {ph === 4 && <Pill key="d" fade>Chacun reprend sa place, arrondie au centième.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Export
// ════════════════════════════════════════════════════════════════════════════
export const PRANKS = {
  "nouvel-an-chinois": { label: "Nouvel an chinois", Effect: softly(NouvelAnChinois, { emoji: "🐉", text: "Le dragon est passé sur la pointe des pattes. Bonne année lunaire !", tint: tint("rgba(220,38,38,.25)") }) },
  "saint-patrick": { label: "Saint-Patrick", Effect: softly(SaintPatrick, { emoji: "☘️", text: "Un trèfle s'est glissé dans l'AMS. Joyeuse Saint-Patrick !", tint: tint("rgba(34,197,94,.25)") }) },
  "holi": { label: "Holi", Effect: softly(Holi, { emoji: "🎨", text: "Un nuage de couleurs est passé au loin. Joyeuse Holi !", tint: tint("rgba(236,72,153,.25)") }) },
  "star-wars": { label: "4 mai", Effect: softly(StarWars, { emoji: "✨", text: "Que le 4 mai soit avec toi.", tint: tint("rgba(15,23,42,.45)") }) },
  "dia-de-muertos": { label: "Día de Muertos", Effect: softly(DiaDeMuertos, { emoji: "🌼", text: "Des fleurs et des bougies pour le Día de Muertos.", tint: tint("rgba(249,115,22,.25)") }) },
  "diwali": { label: "Diwali", Effect: softly(Diwali, { emoji: "🪔", text: "Une petite lampe veille sur l'atelier. Joyeuse Diwali !", tint: tint("rgba(250,204,21,.25)") }) },
  "thanksgiving": { label: "Thanksgiving", Effect: softly(Thanksgiving, { emoji: "🦃", text: "Une dinde est passée en courant. Joyeux Thanksgiving !", tint: tint("rgba(234,88,12,.22)") }) },
  "pi": { label: "Jour de π", Effect: softly(Pi, { emoji: "🥧", text: "3,14159… Joyeux jour de π !", tint: tint("rgba(139,92,246,.25)") }) },
};
