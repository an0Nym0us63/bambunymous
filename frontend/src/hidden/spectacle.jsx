import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Stage, Title, useWin, Btn, rand } from "./kit";

// Lot « spectacle » (23/10/2026) : huit scenes a regarder, pas a jouer. Le
// secret tombe quand on est reste jusqu'au bout du spectacle, jamais a
// l'arrivee. Le son est facultatif : il ne demarre qu'apres un geste, et
// l'AudioContext est ferme au demontage. Keyframes prefixees par page.

const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SERIF = "Georgia, 'Times New Roman', serif";
const CANVAS_STYLE = { position:"absolute", inset:0, width:"100%", height:"100%", display:"block", zIndex:0 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, v) => { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const hexRgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, k) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], k))).join(",")})`; };
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

/** Consigne discrete en bas de scene, masquee une fois gagne. */
function Hint({ children, won, color = "rgba(255,255,255,.66)", style }) {
  if (won) return null;
  return (
    <div style={{ position:"absolute", left:"50%", bottom:12, transform:"translateX(-50%)", zIndex:15,
      width:"max-content", maxWidth:"calc(100% - 32px)", textAlign:"center", fontSize:12.5, lineHeight:1.35,
      padding:"6px 12px", borderRadius:999, background:"rgba(0,0,0,.35)", color, fontFamily:SANS,
      backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)", pointerEvents:"none", ...style }}>
      {children}
    </div>
  );
}

/**
 * Boucle d'images a temps reel : fn(dt, now, dtReel). dt est plafonne a 50 ms (physique stable),
 * dtReel a 250 ms : une scene suit l'horloge meme sur un appareil lent, et s'arrete quand l'onglet dort.
 */
function useRaf(fn, running = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!running) return undefined;
    let id, last = performance.now();
    const tick = now => {
      const raw = Math.max(0, (now - last) / 1000);
      last = now;
      ref.current(Math.min(0.05, raw), now, Math.min(0.25, raw));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [running]);
}

/** Horloge de scene en secondes (suspendue quand l'onglet dort), rafraichie `fps` fois par seconde. */
function useClock(running = true, fps = 30) {
  const acc = useRef(0), last = useRef(-1);
  const [t, setT] = useState(0);
  useRaf((dt, now, real) => {
    acc.current += real;
    const k = Math.floor(acc.current * fps);
    if (k !== last.current) { last.current = k; setT(acc.current); }
  }, running);
  return t;
}

/** AudioContext cree au premier geste (open), ferme au demontage. */
function useAudioCtx() {
  const ref = useRef(null);
  useEffect(() => () => {
    const c = ref.current;
    ref.current = null;
    if (c) { try { c.close(); } catch { /* deja ferme */ } }
  }, []);
  const open = useCallback(() => {
    if (!ref.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ref.current = new AC(); } catch { return null; }
    }
    if (ref.current.state === "suspended") ref.current.resume().catch(() => {});
    return ref.current;
  }, []);
  return [open, ref];
}

function noiseBuffer(ctx, secs = 1) {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Une note simple : oscillateur, filtre passe-bas facultatif, enveloppe douce. */
function tone(ctx, dest, { t, dur, freq, type = "sine", vol = 0.1, cut = 0, att = 0.01, rel = 0.08 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.setValueAtTime(vol, Math.max(t + att, t + dur - rel));
  g.gain.linearRampToValueAtTime(0, t + dur);
  let node = o;
  if (cut) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cut; o.connect(f); node = f; }
  node.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Toile plein cadre (taille du parent, ecran Retina compris) redessinee a chaque image. */
function useCanvas(draw) {
  const ref = useRef(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const c = ref.current;
    if (!c) return undefined;
    const parent = c.parentElement;
    const fit = () => {
      const r = parent.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      size.current = { w: r.width, h: r.height, dpr };
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(parent); else window.addEventListener("resize", fit);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener("resize", fit); };
  }, []);
  useRaf((dt, now, real) => {
    const c = ref.current, { w, h, dpr } = size.current;
    if (!c || !w) return;
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    drawRef.current(ctx, w, h, dt, real);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  });
  return ref;
}

/** Halo rond pre-rendu (bien moins cher qu'un degrade par particule). */
function makeSprite(r, g, b, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d"), gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.4, `rgba(${r},${g},${b},.55)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr;
  x.fillRect(0, 0, size, size);
  return c;
}

// Le Benchy, en 120 x 100 (base a y = 100), pour le timelapse et le cinema
const BENCHY_HULL = "M4 62 L16 100 L102 100 L118 56 L84 64 L28 64 Z";
const BENCHY_CABIN = "M24 64 V28 H76 V64 Z M18 22 H82 V30 H18 Z M56 4 H66 V22 H56 Z";
const BENCHY_WIN = "M32 36 H46 V50 H32 Z M54 36 H68 V50 H54 Z";
const BENCHY_PORTS = [[42, 80], [62, 80], [82, 80]];

/* -------------------------------------------------------------- feu de camp */

const FEU_LIFE = 36;
const FEU_SAYS = [
  "Le feu prend…",
  "Il ronfle. Rapproche-toi, il fait frais.",
  "Il crépite. C'est l'heure des histoires d'impressions ratées.",
  "Les flammes baissent doucement…",
  "Plus que quelques flammes.",
  "Il ne reste que les braises. Belle soirée.",
];

function crackle(ctx, buf, t, vol) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = rand(1200, 3600);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  src.connect(f); f.connect(g); g.connect(ctx.destination);
  src.start(t, rand(0, buf.duration - 0.08), 0.05);
}

const newSpark = ({ cx, by, sc }) => ({ x: cx + rand(-20, 20) * sc, y: by - rand(10, 40) * sc, vx: rand(-30, 30),
  vy: -rand(90, 220) * sc, life: 0, max: rand(1, 2.4), ph: rand(0, 6) });

function FeuDeCamp() {
  const [won, win] = useWin("feu-de-camp");
  const [phase, setPhase] = useState(0);
  const [openAudio, audioRef] = useAudioCtx();
  const S = useRef(null);
  if (!S.current) {
    S.current = { t: 0, fuel: 1, ign: 0, end: 0, phase: 0, won: false, parts: [], sparks: [], smoke: [], sprites: null, noise: null,
      geo: { cx: 200, by: 400, sc: 1 },
      logs: [{ a: -0.38, dx: -6, born: 0 }, { a: 0.38, dx: 6, born: 0 }, { a: 0.04, dx: 0, born: 0 }],
      stars: Array.from({ length: 120 }, () => ({ x: Math.random(), y: Math.random() * 0.58, r: rand(0.5, 1.6), p: rand(0, 6) })),
      trees: Array.from({ length: 18 }, (_, i) => ({ x: i / 17 + rand(-0.025, 0.025), h: rand(0.09, 0.2) })),
      stones: Array.from({ length: 11 }, (_, i) => ({ a: (i / 11) * Math.PI * 2 + rand(-0.1, 0.1), r: rand(9, 13) })) };
  }

  const ref = useCanvas((ctx, w, h, dt, real) => {
    const s = S.current;
    if (!s.sprites) s.sprites = [[255, 246, 214], [255, 196, 84], [255, 122, 34], [190, 40, 12], [140, 140, 150]].map(([r, g, b]) => makeSprite(r, g, b));
    s.t += real;
    s.ign = Math.min(1, s.ign + real / 2.5);
    if (s.t > 2.5) s.fuel = Math.max(0, s.fuel - real / FEU_LIFE);
    const I = s.ign * Math.min(1, s.fuel * 1.25);
    const fl = 0.88 + 0.12 * Math.sin(s.t * 13) * Math.sin(s.t * 7.3 + 1);
    const G = (0.12 + 0.88 * I) * fl;
    const ph = s.ign < 1 ? 0 : s.fuel > 0.7 ? 1 : s.fuel > 0.42 ? 2 : s.fuel > 0.14 ? 3 : s.fuel > 0 ? 4 : 5;
    if (ph !== s.phase) { s.phase = ph; setPhase(ph); }
    if (s.fuel <= 0) { s.end += real; if (s.end > 2.5 && !s.won) { s.won = true; win(); } } else s.end = 0;

    const cx = w / 2, by = h * 0.77, hy = h * 0.6, sc = clamp(w / 420, 0.8, 1.3);
    s.geo = { cx, by, sc };
    // ciel et etoiles
    let g = ctx.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, "#02030a"); g.addColorStop(1, "#0d1226");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, hy + 2);
    ctx.fillStyle = "#e8eefc";
    for (const st of s.stars) { ctx.globalAlpha = 0.25 + 0.55 * Math.sin(s.t * 1.1 + st.p) ** 2; ctx.fillRect(st.x * w, st.y * h, st.r, st.r); }
    ctx.globalAlpha = 1;
    // sapins a l'horizon
    ctx.fillStyle = "#04060a";
    for (const tr of s.trees) {
      const x = tr.x * w, th = tr.h * h, tw = th * 0.3;
      ctx.beginPath(); ctx.moveTo(x, hy - th); ctx.lineTo(x - tw, hy + 4); ctx.lineTo(x + tw, hy + 4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, hy - th * 1.12); ctx.lineTo(x - tw * 0.6, hy - th * 0.45); ctx.lineTo(x + tw * 0.6, hy - th * 0.45); ctx.closePath(); ctx.fill();
    }
    // sol
    g = ctx.createLinearGradient(0, hy, 0, h);
    g.addColorStop(0, "#07080b"); g.addColorStop(1, "#140d08");
    ctx.fillStyle = g; ctx.fillRect(0, hy, w, h - hy);
    // lueur du feu sur le ciel et le sol
    ctx.globalCompositeOperation = "lighter";
    g = ctx.createRadialGradient(cx, by, 0, cx, by, h * 0.7);
    g.addColorStop(0, `rgba(255,110,30,${0.2 * G})`); g.addColorStop(1, "rgba(255,110,30,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(cx, by); ctx.scale(1, 0.35);
    const R = (140 + 260 * G) * sc;
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, `rgba(255,120,40,${0.55 * G})`); g.addColorStop(1, "rgba(255,90,20,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    // tente
    const tx = cx - 150 * sc, ty = by - 4 * sc, tw2 = 58 * sc, th2 = 84 * sc;
    ctx.beginPath(); ctx.moveTo(tx - tw2, ty); ctx.lineTo(tx, ty - th2); ctx.lineTo(tx + tw2, ty); ctx.closePath();
    ctx.fillStyle = "#17110d"; ctx.fill();
    g = ctx.createLinearGradient(tx + tw2, 0, tx - tw2, 0);
    g.addColorStop(0, `rgba(255,140,60,${0.42 * G})`); g.addColorStop(1, "rgba(255,140,60,0)");
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx - 14 * sc, ty); ctx.lineTo(tx, ty - th2 * 0.62); ctx.lineTo(tx + 14 * sc, ty); ctx.closePath();
    ctx.fillStyle = "#070504"; ctx.fill();
    // pierres du fond, buches, braises, pierres de devant
    const stone = st => {
      const x = cx + Math.cos(st.a) * 50 * sc, y = by + 4 * sc + Math.sin(st.a) * 13 * sc;
      ctx.fillStyle = "#26211d";
      ctx.beginPath(); ctx.ellipse(x, y, st.r * sc, st.r * 0.62 * sc, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,130,50,${0.35 * G})`;
      ctx.beginPath(); ctx.ellipse(x, y - st.r * 0.25 * sc, st.r * 0.8 * sc, st.r * 0.3 * sc, 0, 0, Math.PI * 2); ctx.fill();
    };
    s.stones.filter(st => Math.sin(st.a) < 0).forEach(stone);
    for (const lg of s.logs) {
      const age = clamp((s.t - lg.born) / 30, 0, 1), L = 44 * sc, T = 7 * sc;
      ctx.save(); ctx.translate(cx + lg.dx * sc, by - 2 * sc); ctx.rotate(lg.a);
      ctx.fillStyle = mix("#5a3a22", "#1a110c", age);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-L, -T, 2 * L, 2 * T, T); else ctx.rect(-L, -T, 2 * L, 2 * T);
      ctx.fill();
      ctx.fillStyle = mix("#c79a66", "#3a2414", age);
      ctx.beginPath(); ctx.ellipse(L, 0, T * 0.55, T, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-L, 0, T * 0.55, T, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255,80,20,${(0.15 + 0.6 * age) * (0.4 + 0.6 * G) * (0.7 + 0.3 * Math.sin(s.t * 3 + lg.dx))})`;
      ctx.fillRect(-L * 0.6, -T * 0.3, L * 1.2, T * 0.6);
      ctx.restore();
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 9; i++) {
      const x = cx + (i - 4) * 9 * sc, y = by + 2 * sc + Math.sin(i * 2.1) * 3 * sc, sz = (26 + (i % 3) * 6) * sc;
      ctx.globalAlpha = clamp(0.38 + 0.3 * Math.sin(s.t * (1.3 + i * 0.17) + i), 0, 1);
      ctx.drawImage(s.sprites[2], x - sz / 2, y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    s.stones.filter(st => Math.sin(st.a) >= 0).forEach(stone);
    // flammes
    ctx.globalCompositeOperation = "lighter";
    for (let n = Math.floor(I * dt * 150 + Math.random()); n > 0 && s.parts.length < 420; n--) {
      s.parts.push({ x: cx + rand(-1, 1) * 30 * sc * (0.5 + 0.5 * I), y: by - 6 * sc, vx: rand(-12, 12),
        vy: -rand(60, 130) * (0.55 + 0.6 * I) * sc, life: 0, max: rand(0.45, 1) * (0.55 + 0.6 * I), size: rand(20, 36) * (0.6 + 0.5 * I) * sc });
    }
    s.parts = s.parts.filter(p => (p.life += dt) < p.max);
    for (const p of s.parts) {
      p.x += (p.vx + (cx - p.x) * 1.6 + Math.sin(s.t * 7 + p.y * 0.05) * 14) * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max, sz = p.size * (1 - 0.55 * k);
      ctx.globalAlpha = (1 - k) * (k < 0.1 ? 0.45 : 0.7);
      ctx.drawImage(s.sprites[k < 0.1 ? 0 : k < 0.38 ? 1 : k < 0.7 ? 2 : 3], p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    // etincelles
    if (Math.random() < I * dt * 7) s.sparks.push(newSpark(s.geo));
    s.sparks = s.sparks.filter(p => (p.life += dt) < p.max);
    for (const p of s.sparks) {
      p.vy *= 1 - dt * 0.5;
      p.vx += Math.sin(s.t * 5 + p.ph) * 30 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.life / p.max;
      ctx.globalAlpha = 1 - k; ctx.fillStyle = "#ffd28a"; ctx.fillRect(p.x, p.y, 2, 2);
      ctx.globalAlpha = (1 - k) * 0.5; ctx.drawImage(s.sprites[1], p.x - 5, p.y - 5, 10, 10);
    }
    // fumee
    ctx.globalCompositeOperation = "source-over";
    if (s.t > 1 && Math.random() < dt * (1.5 + 3 * (1 - I))) {
      s.smoke.push({ x: cx + rand(-12, 12) * sc, y: by - (20 + 70 * I) * sc, vx: rand(-4, 10), vy: -rand(14, 28) * sc, life: 0, max: rand(3, 5), size: rand(24, 36) * sc });
    }
    s.smoke = s.smoke.filter(p => (p.life += dt) < p.max);
    for (const p of s.smoke) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.life / p.max, sz = p.size * (1 + 1.6 * k);
      ctx.globalAlpha = 0.12 * Math.sin(Math.PI * k);
      ctx.drawImage(s.sprites[4], p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    // vignette
    g = ctx.createRadialGradient(cx, h * 0.6, h * 0.25, cx, h * 0.6, Math.max(w, h) * 0.85);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.6)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // crepitements, une fois le son ouvert par un geste
    const ac = audioRef.current;
    if (ac && s.noise && ac.state === "running" && Math.random() < dt * (0.5 + 9 * I)) {
      crackle(ac, s.noise, ac.currentTime + 0.01, rand(0.02, 0.08) * (0.3 + 0.7 * I));
    }
  });

  const addLog = () => {
    const s = S.current;
    s.fuel = Math.min(1, s.fuel + 0.22);
    s.end = 0;
    s.logs.push({ a: rand(-0.7, 0.7), dx: rand(-12, 12), born: s.t });
    if (s.logs.length > 6) s.logs.shift();
    for (let i = 0; i < 26; i++) s.sparks.push(newSpark(s.geo));
    const ac = openAudio();
    if (ac) {
      if (!s.noise) s.noise = noiseBuffer(ac, 1);
      for (let i = 0; i < 7; i++) crackle(ac, s.noise, ac.currentTime + 0.02 + rand(0, 0.7), rand(0.05, 0.13));
    }
  };

  return (
    <Stage won={won} wonText="Veillée jusqu'aux braises" font={SANS} bg="#02030a" onClick={addLog}
      style={{ justifyContent:"flex-start", cursor:"pointer" }}>
      <canvas ref={ref} aria-hidden="true" style={CANVAS_STYLE}/>
      <Title color="#fde7c7" sub="Aucune impression en cours. Rien que le feu." style={{ marginTop:6 }}>Feu de camp</Title>
      <div key={phase} style={{ position:"relative", zIndex:2, marginTop:12, fontSize:14, fontStyle:"italic", color:"#fcd9a8",
        textAlign:"center", maxWidth:340, animation:"hk-fade 1.2s ease-out both" }}>{FEU_SAYS[phase]}</div>
      <Hint won={won} color="rgba(253,214,170,.78)">Touche le feu pour y jeter une bûche.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------- cinema */

const CINE = [
  { d: 5, k: "leader" },
  { d: 0.8, k: "noir" },
  { d: 3, k: "card", t: "Cet été…" },
  { d: 3.6, k: "calme" },
  { d: 3, k: "card", t: "Une seule couche…" },
  { d: 3, k: "card", t: "…n'a pas adhéré.", shake: true },
  { d: 4.2, k: "spaghetti" },
  { d: 1.8, k: "flash", t: "La buse était bouchée." },
  { d: 1.8, k: "flash", t: "L'AMS ne répondait plus." },
  { d: 2.4, k: "flash", t: "Et le Wi-Fi… était en 2,4 GHz." },
  { d: 1.5, k: "card", t: "Un maker.", small: true },
  { d: 1.5, k: "card", t: "Une spatule.", small: true },
  { d: 2.3, k: "card", t: "Aucun retour en arrière." },
  { d: 3.6, k: "benchy" },
  { d: 2.6, k: "card", t: "Ils avaient tort.", red: true },
  { d: 4.4, k: "titre" },
  { d: 4.2, k: "billing" },
  { d: 3.2, k: "card", t: "Prochainement dans ton atelier.", gold: true },
  { d: 2.8, k: "rating" },
];
const CINE_STARTS = CINE.reduce((a, s, i) => { a.push(i ? a[i - 1] + CINE[i - 1].d : 0); return a; }, []);
const CINE_TOTAL = CINE_STARTS[CINE.length - 1] + CINE[CINE.length - 1].d;

const CINE_CSS = `
@keyframes cine-card { 0% { opacity:0; transform:scale(1.05) } 16% { opacity:1 } 84% { opacity:1 } 100% { opacity:0; transform:scale(1) } }
@keyframes cine-zoom { from { transform:scale(1) } to { transform:scale(1.14) } }
@keyframes cine-shake { 0%,100% { transform:translate(0,0) } 20% { transform:translate(-1.5%,1%) } 40% { transform:translate(1.5%,-1%) } 60% { transform:translate(-1%,-1%) } 80% { transform:translate(1%,1%) } }
@keyframes cine-sweep { to { transform:rotate(360deg) } }
@keyframes cine-flash { from { opacity:1 } to { opacity:0 } }
@keyframes cine-punch { from { transform:scale(1.25); opacity:0 } 30% { opacity:1 } to { transform:scale(1); opacity:1 } }
@keyframes cine-draw { from { stroke-dashoffset:1 } to { stroke-dashoffset:0 } }
@keyframes cine-rise { from { transform:translateY(14%) scale(.9) } to { transform:none } }
@keyframes cine-fog { from { transform:translateX(-8%) } to { transform:translateX(8%) } }
@keyframes cine-liftL { from { transform:none } to { transform:rotate(-16deg) translateY(-10%) } }
@keyframes cine-liftR { from { transform:none } to { transform:rotate(16deg) translateY(-10%) } }
@keyframes cine-grain { 0%,100% { transform:translate(0,0) } 25% { transform:translate(-2%,1%) } 50% { transform:translate(1%,-2%) } 75% { transform:translate(2%,2%) } }
@keyframes cine-scratch { 0%,100% { opacity:0; left:22% } 10% { opacity:.5 } 12% { opacity:0 } 55% { opacity:0; left:71% } 56% { opacity:.4 } 58% { opacity:0 } }
@keyframes cine-red { 0%,100% { opacity:.35 } 50% { opacity:.85 } }
@keyframes cine-blink { 50% { opacity:.2 } }
@keyframes cine-beam { 0%,100% { opacity:.6 } 40% { opacity:.45 } 70% { opacity:.55 } }
`;

function spaghettiPaths() {
  return Array.from({ length: 16 }, (_, i) => {
    let x = 215 + rand(-10, 10), y = 112 + rand(-6, 10);
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    const a0 = rand(0, Math.PI * 2);
    for (let k = 0; k < 7; k++) {
      const r = 10 + k * 7, a = a0 + rand(-1.6, 1.6);
      const nx = clamp(x + Math.cos(a) * r, 110, 330), ny = clamp(y + Math.sin(a) * r * 0.8 + 4, 60, 205);
      d += ` Q${(x + rand(-25, 25)).toFixed(1)} ${(y + rand(-25, 25)).toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`;
      x = nx; y = ny;
    }
    return { d, c: i % 3 === 0 ? "#e5e7eb" : "#f97316", dl: rand(0, 1.4) };
  });
}

function CinePrinter({ alarm }) {
  return (
    <svg viewBox="0 0 400 225" style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}>
      <rect width="400" height="225" fill="#05070d"/>
      <rect x="40" y="28" width="72" height="92" fill="#0b1530" stroke="#1c2436" strokeWidth="4"/>
      <circle cx="86" cy="54" r="10" fill="#e5e7eb" opacity=".85"/>
      <path d="M76 28 V120 M40 74 H112" stroke="#1c2436" strokeWidth="3"/>
      <rect x="0" y="170" width="400" height="55" fill="#0f0c09"/>
      <rect x="0" y="170" width="400" height="2" fill="#1f1913"/>
      <ellipse cx="215" cy="172" rx="95" ry="9" fill={alarm ? "rgba(239,68,68,.28)" : "rgba(186,230,253,.12)"}/>
      <rect x="160" y="48" width="110" height="122" rx="7" fill="#16181d" stroke="#2b3038" strokeWidth="1.5"/>
      <rect x="170" y="58" width="90" height="84" rx="3" fill={alarm ? "#1a0505" : "#070a10"}/>
      <rect x="170" y="58" width="90" height="84" rx="3" fill={alarm ? "#ef4444" : "#bae6fd"} opacity={alarm ? 0.35 : 0.08}
        style={alarm ? { animation:"cine-red .9s ease-in-out infinite" } : undefined}/>
      <rect x="176" y="61" width="78" height="2" rx="1" fill={alarm ? "#fecaca" : "#fef3c7"} opacity=".8"/>
      <rect x="176" y="126" width="78" height="4" fill="#b59a5a"/>
      {!alarm && <path d="M206 126 L208 116 L222 116 L226 112 L228 116 L224 126 Z" fill="#f97316"/>}
      <rect x="198" y="72" width="22" height="16" rx="2" fill="#d1d5db"/>
      <rect x="174" y="150" width="40" height="12" rx="2" fill={alarm ? "#7f1d1d" : "#0c4a6e"}/>
      {alarm && <text x="194" y="160" textAnchor="middle" fontSize="10" fontWeight="900" fill="#fecaca" fontFamily={SANS}>!</text>}
      <circle cx="255" cy="156" r="3" fill={alarm ? "#ef4444" : "#22c55e"} style={{ animation:`cine-blink ${alarm ? 0.4 : 2}s steps(2) infinite` }}/>
    </svg>
  );
}

function CineCaption({ children, d }) {
  return (
    <div style={{ position:"absolute", left:0, right:0, bottom:"9%", textAlign:"center", fontFamily:SERIF, fontStyle:"italic",
      fontSize:"4.4cqw", color:"#f5f5f4", textShadow:"0 2px 8px #000", padding:"0 6%", animation:`cine-card ${d}s ease both` }}>{children}</div>
  );
}

function CineShot({ s, lt, strands }) {
  const fill = { position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", textAlign:"center", padding:"0 6%" };
  if (s.k === "leader") {
    const n = Math.max(1, 5 - Math.floor(lt));
    return (
      <div style={{ ...fill, background:"radial-gradient(circle, #a8a29e 0%, #57534e 85%)" }}>
        <div style={{ position:"absolute", left:0, right:0, top:"50%", height:"0.4cqw", background:"#292524" }}/>
        <div style={{ position:"absolute", top:0, bottom:0, left:"50%", width:"0.4cqw", background:"#292524" }}/>
        <div style={{ position:"absolute", width:"44cqw", height:"44cqw", borderRadius:"50%", overflow:"hidden", border:"0.6cqw solid #e7e5e4" }}>
          <div style={{ position:"absolute", inset:0, background:"conic-gradient(rgba(0,0,0,.35) 0deg 110deg, transparent 110deg)", animation:"cine-sweep 1s linear infinite" }}/>
        </div>
        <div style={{ position:"absolute", width:"36cqw", height:"36cqw", borderRadius:"50%", border:"0.4cqw solid #e7e5e4" }}/>
        <div style={{ position:"relative", fontFamily:SANS, fontWeight:800, fontSize:"26cqw", color:"#1c1917", lineHeight:1 }}>{n}</div>
      </div>
    );
  }
  if (s.k === "noir") return <div style={{ ...fill, background:"#000" }}/>;
  if (s.k === "card") {
    return (
      <div style={{ ...fill, animation: s.shake ? "cine-shake .45s ease-in-out 1.1s 2" : undefined }}>
        <div style={{ fontFamily:SERIF, fontStyle:"italic", fontSize: s.small ? "6cqw" : "7cqw", letterSpacing:".04em",
          color: s.red ? "#f87171" : s.gold ? "#fcd34d" : "#f5f5f4", textShadow: s.red ? "0 0 3cqw rgba(239,68,68,.5)" : "none",
          animation:`cine-card ${s.d}s ease both` }}>{s.t}</div>
      </div>
    );
  }
  if (s.k === "calme" || s.k === "spaghetti") {
    const alarm = s.k === "spaghetti";
    return (
      <>
        <div style={{ position:"absolute", inset:0, animation:`cine-zoom ${s.d}s linear both${alarm ? ", cine-shake .35s ease-in-out 1.5s 3" : ""}` }}>
          <CinePrinter alarm={alarm}/>
          {alarm && (
            <svg viewBox="0 0 400 225" style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}>
              {strands.map((p, i) => (
                <path key={i} d={p.d} fill="none" stroke={p.c} strokeWidth="2.2" strokeLinecap="round" pathLength="1"
                  strokeDasharray="1 1" style={{ animation:`cine-draw 2.8s ease-out ${p.dl}s both` }}/>
              ))}
            </svg>
          )}
        </div>
        <CineCaption d={s.d}>{alarm ? "Le plateau était froid." : "Tout semblait normal."}</CineCaption>
      </>
    );
  }
  if (s.k === "flash") {
    return (
      <div style={{ ...fill, background:"radial-gradient(circle, #2a0606, #050000 75%)" }}>
        <div style={{ fontFamily:SANS, fontWeight:900, fontSize:"6.2cqw", color:"#fecaca", letterSpacing:".02em",
          textShadow:"0 0 2cqw rgba(239,68,68,.6)", animation:"cine-punch .5s ease-out both" }}>{s.t}</div>
        <div style={{ position:"absolute", inset:0, background:"#fff", animation:"cine-flash .28s ease-out both", pointerEvents:"none" }}/>
      </div>
    );
  }
  if (s.k === "benchy") {
    return (
      <>
        <svg viewBox="0 0 400 225" style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}>
          <defs>
            <radialGradient id="cine-rg" cx="50%" cy="88%" r="75%">
              <stop offset="0" stopColor="#b91c1c"/><stop offset=".5" stopColor="#3f0808"/><stop offset="1" stopColor="#000"/>
            </radialGradient>
          </defs>
          <rect width="400" height="225" fill="url(#cine-rg)"/>
          <g style={{ animation:`cine-rise ${s.d}s ease-out both`, transformBox:"view-box", transformOrigin:"200px 210px" }}>
            <g transform="translate(119 52) scale(1.35)">
              <path d={BENCHY_HULL + " " + BENCHY_CABIN} fill="#050505"/>
              <path d={BENCHY_WIN} fill="#ef4444" style={{ animation:"cine-red 1.4s ease-in-out infinite" }}/>
            </g>
          </g>
          <ellipse cx="200" cy="214" rx="260" ry="24" fill="rgba(255,210,210,.12)" style={{ animation:"cine-fog 4s ease-in-out infinite alternate" }}/>
          <ellipse cx="160" cy="224" rx="220" ry="18" fill="rgba(255,210,210,.1)" style={{ animation:"cine-fog 5s ease-in-out infinite alternate-reverse" }}/>
        </svg>
        <CineCaption d={s.d}>Ils pensaient que le Benchy était inoffensif.</CineCaption>
      </>
    );
  }
  if (s.k === "titre") {
    const metal = { background:"linear-gradient(180deg, #ffffff 0%, #d1d5db 45%, #4b5563 52%, #e5e7eb 100%)",
      WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent", display:"inline-block" };
    return (
      <div style={{ ...fill, flexDirection:"column", background:"radial-gradient(ellipse at 50% 60%, #1f2937, #000 70%)", animation:"cine-shake .5s ease-in-out 2" }}>
        <div style={{ fontFamily:SANS, fontWeight:900, fontSize:"13cqw", letterSpacing:".08em", lineHeight:1, animation:"cine-punch .9s ease-out both" }}>
          {"WARPING".split("").map((ch, i, a) => (
            <span key={i} style={{ ...metal, transformOrigin: i === 0 ? "100% 100%" : "0% 100%",
              animation: i === 0 ? "cine-liftL 3.6s ease-in .5s both" : i === a.length - 1 ? "cine-liftR 3.6s ease-in .5s both" : undefined }}>{ch}</span>
          ))}
        </div>
        <div style={{ marginTop:"2.4cqw", fontFamily:SERIF, fontStyle:"italic", fontSize:"3.6cqw", color:"#fca5a5", animation:"hk-fade 1.5s .8s both" }}>
          Quand les coins se soulèvent.</div>
      </div>
    );
  }
  if (s.k === "billing") {
    const line = { margin:"0.6cqw 0", fontFamily:"'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', sans-serif", fontStretch:"condensed",
      letterSpacing:".03em", color:"#d6d3d1", textTransform:"uppercase", lineHeight:1.2 };
    return (
      <div style={{ ...fill, flexDirection:"column", background:"#000", animation:`cine-card ${s.d}s ease both` }}>
        <div style={{ ...line, fontSize:"2.4cqw" }}>Bambunymous Pictures présente une production du dimanche soir</div>
        <div style={{ ...line, fontSize:"3.4cqw", color:"#fafaf9" }}>un film de <b>toi</b></div>
        <div style={{ ...line, fontSize:"2.9cqw" }}>la buse · le plateau texturé · l'AMS · la spatule</div>
        <div style={{ ...line, fontSize:"2.4cqw" }}>et le Benchy dans son propre rôle</div>
        <div style={{ ...line, fontSize:"2.1cqw", color:"#a8a29e" }}>musique originale le ventilateur à 100 % · effets spéciaux les supports arborescents</div>
      </div>
    );
  }
  if (s.k === "rating") {
    return (
      <div style={{ ...fill, background:"#000", animation:`cine-card ${s.d}s ease both` }}>
        <div style={{ border:"0.4cqw solid #e7e5e4", padding:"2.4cqw 3.6cqw", maxWidth:"74cqw", fontFamily:SANS, color:"#e7e5e4" }}>
          <div style={{ fontWeight:900, fontSize:"4cqw", letterSpacing:".04em" }}>DÉCONSEILLÉ AUX MOINS DE 0,2 MM</div>
          <div style={{ marginTop:"1.2cqw", fontSize:"2.3cqw", color:"#a8a29e" }}>
            Contient des scènes de warping, de stringing et un spaghetti de grande taille.</div>
        </div>
      </div>
    );
  }
  return null;
}

function Cinema() {
  const [won, win] = useWin("cinema");
  const t = useClock(true, 20);
  const strands = useMemo(spaghettiPaths, []);
  const done = t >= CINE_TOTAL;
  let idx = 0;
  for (let i = 0; i < CINE.length; i++) if (CINE_STARTS[i] <= t) idx = i;
  useEffect(() => {
    if (!done) return undefined;
    const id = setTimeout(win, 1400);
    return () => clearTimeout(id);
  }, [done, win]);
  const red = "repeating-linear-gradient(90deg, #4c0a0f 0 9px, #7f1d1d 9px 17px, #3b0709 17px 24px)";

  return (
    <Stage won={won} wonText="Bande-annonce vue jusqu'au bout" font={SANS}
      bg="radial-gradient(ellipse at 50% 42%, #1c1515 0%, #070505 70%)">
      <style>{CINE_CSS}</style>
      <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, top:0, height:30, background:red, zIndex:4,
        boxShadow:"0 6px 18px rgba(0,0,0,.6)", borderBottom:"3px solid #a16207" }}/>
      <div aria-hidden="true" style={{ position:"absolute", left:0, top:0, bottom:0, width:"8%", background:red, zIndex:4, boxShadow:"inset -10px 0 18px rgba(0,0,0,.6)" }}/>
      <div aria-hidden="true" style={{ position:"absolute", right:0, top:0, bottom:0, width:"8%", background:red, zIndex:4, boxShadow:"inset 10px 0 18px rgba(0,0,0,.6)" }}/>
      <div aria-hidden="true" style={{ position:"absolute", left:"50%", bottom:0, width:"120%", height:"72%", transform:"translateX(-50%)", zIndex:1,
        clipPath:"polygon(48% 100%, 52% 100%, 90% 0, 10% 0)", background:"linear-gradient(to top, rgba(220,225,255,.14), rgba(220,225,255,.02))",
        animation:"cine-beam 3s ease-in-out infinite", pointerEvents:"none" }}/>
      <div style={{ position:"relative", zIndex:3, marginBottom:14, fontSize:11, letterSpacing:".35em", color:"#d4a65a", textTransform:"uppercase" }}>
        Salle 3 · Avant-première</div>
      <div style={{ position:"relative", zIndex:3, width:"min(84%, 760px)", aspectRatio:"16 / 9", background:"#000", overflow:"hidden",
        borderRadius:3, containerType:"inline-size", boxShadow:"0 0 0 1px #1c1917, 0 0 80px rgba(190,200,255,.15)" }}>
        <div key={done ? "fin" : idx} style={{ position:"absolute", inset:0 }}>
          {done ? (
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              textAlign:"center", padding:"0 8%", animation:"hk-fade 1.5s both" }}>
              <div style={{ fontSize:"9cqw" }}>🍿</div>
              <div style={{ fontFamily:SERIF, fontSize:"4.6cqw", color:"#f5f5f4", letterSpacing:".12em" }}>FIN DE LA BANDE-ANNONCE</div>
              <div style={{ marginTop:"1.6cqw", fontFamily:SERIF, fontStyle:"italic", fontSize:"2.7cqw", color:"#a8a29e" }}>
                Sortie prévue quand l'impression sera terminée. Estimation : 4 h 12. Donc plutôt 7 h.</div>
            </div>
          ) : <CineShot s={CINE[idx]} lt={t - CINE_STARTS[idx]} strands={strands}/>}
        </div>
        <div aria-hidden="true" style={{ position:"absolute", inset:"-10%", pointerEvents:"none", opacity:.08, animation:"cine-grain .45s steps(4) infinite",
          background:"repeating-radial-gradient(circle at 30% 40%, #fff 0 1px, transparent 1px 3px)" }}/>
        <div aria-hidden="true" style={{ position:"absolute", top:0, bottom:0, width:1, background:"rgba(255,255,255,.6)", pointerEvents:"none",
          animation:"cine-scratch 2.3s linear infinite" }}/>
        <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none", boxShadow:"inset 0 0 8cqw rgba(0,0,0,.85)" }}/>
      </div>
      <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, bottom:-22, display:"flex", justifyContent:"center", gap:"1.2%", zIndex:5 }}>
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} style={{ width:"10.4%", height: i % 2 ? 74 : 82, background:"#0e0808", borderRadius:"40% 40% 8px 8px",
            boxShadow:"inset 0 8px 10px rgba(255,255,255,.04)" }}/>
        ))}
      </div>
      <Hint won={won || done} color="rgba(214,190,140,.8)" style={{ bottom:70 }}>Éteins ton téléphone… enfin, pas celui-là.</Hint>
    </Stage>
  );
}

/* -------------------------------------------------------------- planetarium */

const PLA_T0 = 3, PLA_SLOT = 9, PLA_FIN = PLA_T0 + 4 * PLA_SLOT;
const PLA_RAW = [
  { name: "Le Grand Benchy", lore: "Il navigue dans le ciel depuis la toute première calibration.", at: [35, 60], label: [104, 172],
    pts: [[0, 40], [12, 58], [78, 58], [92, 36], [62, 40], [22, 40], [22, 18], [52, 18], [52, 40], [44, 18], [44, 4], [50, 4], [50, 18]],
    lines: [[5, 0, 1, 2, 3, 4], [5, 6, 7, 8], [8, 4], [9, 10, 11, 12]] },
  { name: "La Bobine", lore: "Elle ne se vide jamais… sauf à trois couches de la fin.", at: [235, 40], label: [300, 186],
    pts: [...Array.from({ length: 8 }, (_, i) => [40 + 34 * Math.cos(i * Math.PI / 4), 40 + 34 * Math.sin(i * Math.PI / 4)]),
      ...Array.from({ length: 4 }, (_, i) => [40 + 10 * Math.cos(i * Math.PI / 2 + Math.PI / 4), 40 + 10 * Math.sin(i * Math.PI / 2 + Math.PI / 4)]),
      [88, 66], [100, 82]],
    lines: [[0, 1, 2, 3, 4, 5, 6, 7, 0], [8, 9, 10, 11, 8], [0, 12, 13]] },
  { name: "La Buse", lore: "Zéro virgule quatre millimètres d'éternité.", at: [80, 268], label: [125, 420],
    pts: [[30, 0], [30, 20], [18, 4], [42, 4], [18, 12], [42, 12], [5, 20], [55, 20], [55, 46], [5, 46], [20, 46], [24, 58], [30, 70], [36, 58], [40, 46], [30, 84]],
    lines: [[0, 1], [2, 3], [4, 5], [6, 7, 8, 9, 6], [10, 11, 12, 13, 14], [12, 15]] },
  { name: "L'Imprimante", lore: "Elle veille sur toutes les impressions de nuit.", at: [228, 282], label: [296, 440],
    pts: [[0, 0], [90, 0], [90, 90], [0, 90], [0, 30], [90, 30], [38, 22], [52, 22], [52, 40], [38, 40], [12, 72], [78, 72], [38, 72], [45, 60], [52, 72]],
    lines: [[0, 1, 2, 3, 0], [4, 5], [6, 7, 8, 9, 6], [10, 11], [12, 13, 14]] },
];
const PLA = PLA_RAW.map(c => ({ ...c, P: c.pts.map(([x, y]) => [c.at[0] + x * 1.5, c.at[1] + y * 1.5]) }));

function Planetarium() {
  const [won, win] = useWin("planetarium");
  const t = useClock(true, 10);
  const [shoots, setShoots] = useState([]);
  const sky = useMemo(() => Array.from({ length: 150 }, () => ({ x: rand(0, 100), y: rand(0, 100), r: rand(0.25, 1.1), d: rand(2, 6), dl: -rand(0, 6) })), []);
  const finale = t >= PLA_FIN, over = t >= PLA_FIN + 2.5;
  useEffect(() => { if (over) win(); }, [over, win]);
  const idx = Math.floor((t - PLA_T0) / PLA_SLOT);
  const cur = idx >= 0 && idx < PLA.length ? PLA[idx] : null;
  const named = cur && t - (PLA_T0 + idx * PLA_SLOT) > 4.5;
  const shoot = () => setShoots(s => [...s.slice(-5), { id: Date.now() + Math.random(), x: rand(30, 95), y: rand(4, 40) }]);

  return (
    <Stage won={won} wonText="Toutes les constellations tracées" font={SERIF} onClick={shoot}
      bg="radial-gradient(ellipse at 50% 110%, #1e1b4b 0%, #0b0b26 40%, #020312 80%)" style={{ justifyContent:"flex-start", cursor:"pointer" }}>
      <style>{`
        @keyframes pla-tw { 0%,100% { opacity:.25 } 50% { opacity:1 } }
        @keyframes pla-shoot { from { transform:translate(0,0) rotate(-28deg); opacity:0 } 15% { opacity:1 } to { transform:translate(-160px,90px) rotate(-28deg); opacity:0 } }
        @keyframes pla-pulse { 0%,100% { filter:brightness(1) } 50% { filter:brightness(1.6) drop-shadow(0 0 6px #a5b4fc) } }
        .pla-pulse { animation: pla-pulse 2.4s ease-in-out infinite }
      `}</style>
      <div aria-hidden="true" style={{ position:"absolute", inset:"-20%", filter:"blur(14px)", pointerEvents:"none",
        background:"linear-gradient(118deg, transparent 36%, rgba(170,180,255,.07) 45%, rgba(220,200,255,.12) 50%, rgba(170,180,255,.07) 55%, transparent 64%)" }}/>
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}>
        {sky.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.18} fill="#fff" style={{ animation:`pla-tw ${s.d}s ease-in-out ${s.dl}s infinite` }}/>)}
      </svg>
      {shoots.map(s => (
        <span key={s.id} aria-hidden="true" onAnimationEnd={() => setShoots(a => a.filter(x => x.id !== s.id))}
          style={{ position:"absolute", left:`${s.x}%`, top:`${s.y}%`, width:90, height:2, borderRadius:2, zIndex:3, pointerEvents:"none",
            background:"linear-gradient(90deg, #fff, rgba(255,255,255,0))", animation:"pla-shoot 1.1s ease-out forwards" }}/>
      ))}
      <Title color="#e0e7ff" sub="Séance de 21 h. Les makers aussi ont leurs constellations." style={{ marginTop:4 }}>Planétarium</Title>
      <svg viewBox="0 0 400 470" preserveAspectRatio="xMidYMid meet" style={{ position:"relative", zIndex:2, width:"100%", maxWidth:620, height:"min(58vh, 560px)", marginTop:6 }}>
        <defs>
          <filter id="pla-glow" x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="2.2" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {PLA.map((c, i) => {
          const st = t - (PLA_T0 + i * PLA_SLOT), on = st > 0, lines = st > 1.5, nm = st > 4.5, dim = st > 8.5 && !finale;
          return (
            <g key={i} className={finale ? "pla-pulse" : undefined}>
              {c.lines.map((ln, k) => (
                <path key={k} d={"M" + ln.map(j => c.P[j].map(v => v.toFixed(1)).join(" ")).join(" L")} pathLength="1" fill="none"
                  stroke="#a5b4fc" strokeWidth="1.3" strokeLinejoin="round" strokeDasharray="1 1" strokeDashoffset={lines ? 0 : 1}
                  opacity={dim ? 0.4 : 0.9} style={{ transition:`stroke-dashoffset 2.6s ease-in-out ${k * 0.45}s, opacity 1.5s` }}/>
              ))}
              {c.P.map(([x, y], j) => (
                <circle key={j} cx={x} cy={y} r={on ? 2.5 : 1} fill="#fff" opacity={on ? (dim ? 0.7 : 1) : 0.18} filter="url(#pla-glow)"
                  style={{ transition:`r .9s ease ${j * 0.06}s, opacity .9s ease ${j * 0.06}s` }}/>
              ))}
              <text x={c.label[0]} y={c.label[1]} textAnchor="middle" fill="#e0e7ff" fontSize="15" fontFamily={SERIF} fontStyle="italic"
                opacity={nm ? (dim ? 0.55 : 1) : 0} style={{ transition:"opacity 1.4s" }}>{c.name}</text>
            </g>
          );
        })}
      </svg>
      <div style={{ position:"relative", zIndex:2, minHeight:56, maxWidth:360, textAlign:"center", color:"#c7d2fe", fontSize:14.5, fontStyle:"italic", marginBottom:44 }}>
        {t < PLA_T0 ? <div key="i" style={{ animation:"hk-fade 1.5s both" }}>Les lumières s'éteignent. Lève les yeux…</div>
          : finale ? <div key="f" style={{ animation:"hk-fade 1.5s both" }}>Le ciel des makers est complet. Bonne nuit, astronome.</div>
            : named ? (
              <div key={cur.name} style={{ animation:"hk-fade 1.2s both" }}>
                <div style={{ fontStyle:"normal", fontWeight:700, color:"#e0e7ff", fontSize:16 }}>{cur.name}</div>{cur.lore}
              </div>
            ) : <div key={"w" + idx} style={{ animation:"hk-fade 1s both", opacity:.7 }}>Une nouvelle constellation se dessine…</div>}
      </div>
      <svg aria-hidden="true" viewBox="0 0 100 40" style={{ position:"absolute", left:"50%", bottom:0, transform:"translateX(-50%)", width:110, zIndex:1, pointerEvents:"none" }}>
        <rect x="46" y="18" width="8" height="22" fill="#0a0c1f"/>
        <circle cx="30" cy="16" r="12" fill="#0a0c1f"/><circle cx="70" cy="16" r="12" fill="#0a0c1f"/>
        <rect x="30" y="12" width="40" height="8" fill="#0a0c1f"/>
      </svg>
      <Hint won={won} color="rgba(199,210,254,.8)">Touche le ciel pour une étoile filante. Les constellations, elles, prennent leur temps.</Hint>
    </Stage>
  );
}

/* ---------------------------------------------------------------- timelapse */

const TL_START = 1.5, TL_DUR = 36, TL_LAYERS = 250, TL_MIN = 252;
const tri = x => { const f = x - Math.floor(x); return f < 0.5 ? f * 4 - 1 : 3 - f * 4; };
const hm = m => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")}`;

function ding(ac) {
  const t = ac.currentTime + 0.02;
  tone(ac, ac.destination, { t, dur: 1.6, freq: 1318.5, vol: 0.12, att: 0.004, rel: 1.5 });
  tone(ac, ac.destination, { t, dur: 1.2, freq: 2637, vol: 0.04, att: 0.004, rel: 1.1 });
  tone(ac, ac.destination, { t: t + 0.22, dur: 1.8, freq: 1760, vol: 0.1, att: 0.004, rel: 1.7 });
}

function Timelapse() {
  const [won, win] = useWin("timelapse");
  const [openAudio, audioRef] = useAudioCtx();
  const [sound, setSound] = useState(false);
  const t = useClock(true, 30);
  const p = clamp((t - TL_START) / TL_DUR, 0, 1);
  const done = t >= TL_START + TL_DUR + 0.1;
  useEffect(() => {
    if (!done) return undefined;
    const ac = audioRef.current;
    if (ac) { try { ding(ac); } catch { /* sans son */ } }
    const id = setTimeout(win, 1500);
    return () => clearTimeout(id);
  }, [done, win, audioRef]);

  const hx = done ? 262 : t < TL_START ? 150 : 200 + 56 * tri(t * 0.95) + 3 * Math.sin(t * 23);
  const bedTop = 153 + p * 110;
  // dehors, les jours passent : 6 s de jour, 6 s de nuit
  const u = (t / 12) % 1, isDay = u < 0.5, k = isDay ? u * 2 : (u - 0.5) * 2;
  const b = isDay ? Math.pow(Math.sin(Math.PI * k), 0.6) : 0;
  const ox = 30 + 340 * k, oy = 222 - 165 * Math.sin(Math.PI * k);
  const say = done ? "Ding ! Impression terminée. Personne n'a touché au plateau." : t < TL_START ? "Chauffe de la buse… 220 °C."
    : p < 0.3 ? "Les premières couches. On retient son souffle." : p < 0.62 ? "La coque prend forme." : p < 0.9 ? "La cabine, puis la cheminée : la partie délicate…" : "Dernières couches !";

  return (
    <Stage won={won} wonText="Impression suivie jusqu'au ding" font={SANS} onClick={() => { if (!sound) { openAudio(); setSound(true); } }}
      bg="linear-gradient(180deg, #11151f 0%, #0a0d14 100%)">
      <style>{`
        @keyframes tl-rec { 50% { opacity:.2 } }
        @keyframes tl-ring { from { transform:translate(-50%,-50%) scale(.3); opacity:.9 } to { transform:translate(-50%,-50%) scale(2.2); opacity:0 } }
        @keyframes tl-ding { 0% { transform:translate(-50%, 10px) scale(.4) rotate(-10deg); opacity:0 } 50% { transform:translate(-50%, -4px) scale(1.15) rotate(6deg); opacity:1 }
          100% { transform:translate(-50%, 0) scale(1) rotate(0); opacity:1 } }
      `}</style>
      <Title color="#f8fafc" sub="Quatre heures d'impression, accélérées six cents fois.">Timelapse</Title>
      <div key={say} style={{ position:"relative", zIndex:2, marginTop:8, minHeight:20, fontSize:13.5, fontStyle:"italic", color:"#cbd5e1",
        textAlign:"center", animation:"hk-fade .8s both" }}>{say}</div>
      <div style={{ position:"relative", width:"min(100%, 440px)", marginTop:8 }}>
        <svg viewBox="0 0 400 420" width="100%" style={{ display:"block" }}>
          <defs>
            <linearGradient id="tl-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={mix("#040817", "#3b8fd6", b)}/>
              <stop offset="1" stopColor={mix("#111b3d", b > 0 && b < 0.45 ? "#f8b98a" : "#bfe3f7", b)}/>
            </linearGradient>
            <linearGradient id="tl-chamber" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2a2618"/><stop offset=".25" stopColor="#12141a"/><stop offset="1" stopColor="#0a0c10"/>
            </linearGradient>
            <pattern id="tl-lines" width="4" height="2" patternUnits="userSpaceOnUse">
              <rect width="4" height="0.7" fill="rgba(0,0,0,.2)"/>
            </pattern>
            <clipPath id="tl-win"><rect x="36" y="16" width="328" height="214" rx="4"/></clipPath>
            <clipPath id="tl-clip"><rect x="-5" y={100 - p * 100} width="130" height={p * 100 + 0.5}/></clipPath>
          </defs>
          <rect width="400" height="420" fill="#161a24"/>
          <rect x="36" y="16" width="328" height="214" rx="4" fill="url(#tl-sky)"/>
          <g clipPath="url(#tl-win)">
          {!isDay && Array.from({ length: 22 }, (_, i) => <circle key={i} cx={46 + ((i * 97) % 310)} cy={26 + ((i * 53) % 150)} r=".9" fill="#fff" opacity=".7"/>)}
          <circle cx={ox} cy={oy} r={isDay ? 16 : 11} fill={isDay ? "#fde68a" : "#e5e7eb"} opacity={isDay ? 1 : 0.9}/>
          {isDay && <circle cx={ox} cy={oy} r="30" fill="#fde68a" opacity=".18"/>}
          <path d="M36 196 Q90 176 140 192 T250 188 T364 194 V230 H36 Z" fill={mix("#0b1222", "#5b8a6a", b)}/>
          </g>
          <rect x="36" y="16" width="328" height="214" rx="4" fill="none" stroke="#2b3242" strokeWidth="8"/>
          <path d="M200 16 V230 M36 122 H364" stroke="#2b3242" strokeWidth="5"/>
          <rect x="0" y="372" width="400" height="48" fill="#3b2a1e"/>
          <rect x="0" y="372" width="400" height="4" fill="#5a4330"/>
          <ellipse cx="200" cy="374" rx="150" ry="6" fill="rgba(0,0,0,.4)"/>
          {/* imprimante */}
          <rect x="80" y="70" width="240" height="304" rx="14" fill="#20242c" stroke="#323844" strokeWidth="2"/>
          <rect x="94" y="88" width="212" height="236" rx="6" fill="url(#tl-chamber)"/>
          <rect x="108" y="93" width="184" height="3" rx="1.5" fill={done ? "#86efac" : "#fef3c7"} opacity=".9"/>
          <rect x="110" y="96" width="3" height="226" fill="#3a404c"/>
          <rect x="287" y="96" width="3" height="226" fill="#3a404c"/>
          <rect x="100" y="118" width="200" height="6" rx="3" fill="#6b7280"/>
          <g transform={`translate(134 ${bedTop - 110}) scale(1.1)`}>
            <g clipPath="url(#tl-clip)">
              <path d={BENCHY_HULL} fill="#f97316"/>
              <path d={BENCHY_CABIN} fill="#fb923c"/>
              <path d={BENCHY_WIN} fill="#9a3412"/>
              {BENCHY_PORTS.map(([x, y]) => <circle key={x} cx={x} cy={y} r="4" fill="#9a3412"/>)}
              <rect x="0" y="0" width="120" height="100" fill="url(#tl-lines)"/>
              {p > 0 && p < 1 && <rect x="0" y={100 - p * 100} width="120" height="1.3" fill="#fed7aa"/>}
            </g>
          </g>
          <rect x="104" y={bedTop} width="192" height="7" rx="2" fill="#c8a868"/>
          <rect x="108" y={bedTop + 7} width="184" height="6" fill="#2b2f38"/>
          <g transform={`translate(${hx.toFixed(1)} 0)`} style={{ transition: done ? "transform 1.2s ease" : "none" }}>
            <rect x="-22" y="104" width="44" height="40" rx="5" fill="#e5e7eb"/>
            <rect x="-16" y="110" width="32" height="12" rx="3" fill="#111827"/>
            <circle cx="11" cy="116" r="2" fill={done ? "#22c55e" : "#38bdf8"}/>
            <rect x="-7" y="144" width="14" height="5" fill="#9ca3af"/>
            <path d="M-4 149 L4 149 L0 153 Z" fill="#d97706"/>
          </g>
          <path d="M96 90 L168 90 L112 322 L96 322 Z" fill="rgba(255,255,255,.035)"/>
          <path d="M190 90 L204 90 L150 322 L136 322 Z" fill="rgba(255,255,255,.03)"/>
          <rect x="116" y="334" width="96" height="28" rx="4" fill="#0b1220"/>
          <text x="164" y="353" textAnchor="middle" fontSize="13" fontFamily={MONO} fill={done ? "#86efac" : "#7dd3fc"}>{Math.floor(p * 100)} %</text>
          <circle cx="284" cy="348" r="8" fill="#334155"/>
        </svg>
        <div style={{ position:"absolute", top:"6%", right:"11%", padding:"2px 8px", borderRadius:6, background:"rgba(0,0,0,.55)", color:"#fca5a5",
          fontFamily:MONO, fontSize:11, fontWeight:700 }}>
          <span style={{ color:"#ef4444", animation:"tl-rec 1s steps(2) infinite" }}>●</span> REC ×600</div>
        {done && (
          <>
            <div aria-hidden="true" style={{ position:"absolute", left:"50%", top:"40%", width:120, height:120, borderRadius:"50%",
              border:"3px solid rgba(134,239,172,.8)", animation:"tl-ring 1.2s ease-out 2 both" }}/>
            <div style={{ position:"absolute", left:"50%", top:"28%", padding:"6px 14px", borderRadius:14, background:"#fef3c7", color:"#92400e",
              fontWeight:900, fontSize:18, boxShadow:"0 6px 20px rgba(0,0,0,.4)", animation:"tl-ding .7s cubic-bezier(.2,1.4,.4,1) both" }}>🔔 Ding !</div>
          </>
        )}
      </div>
      <div style={{ width:"min(100%, 400px)", marginTop:10, marginBottom:40, position:"relative", zIndex:2 }}>
        <div style={{ height:8, borderRadius:99, background:"#1f2937", overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${p * 100}%`, borderRadius:99, background:"linear-gradient(90deg, #16a34a, #4ade80)" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:12.5, color:"#94a3b8", fontFamily:MONO }}>
          <span>Couche {Math.round(p * TL_LAYERS)} / {TL_LAYERS}</span>
          <span>{done ? "terminé" : `reste ${hm((1 - p) * TL_MIN)}`}</span>
        </div>
      </div>
      <Hint won={won} color="rgba(203,213,225,.8)">{sound ? "🔔 Le ding final sonnera." : "Touche une fois l'écran pour entendre le ding final."}</Hint>
    </Stage>
  );
}

/* ---------------------------------------------------------------- orchestre */

// Melodie originale, Do majeur, 16 mesures a 112 noires/min (une case = une croche)
const ORC_STEP = 60 / 112 / 2;
const ORC_LEAD = [
  "E4 . G4 . C5 - B4 A4", "G4 - D4 . G4 A4 B4 .", "C5 . A4 . E4 - A4 B4", "C5 - A4 F4 G4 - - .",
  "E4 . G4 . C5 - D5 E5", "D5 - B4 . G4 A4 B4 D5", "C5 . E5 . A4 - C5 B4", "A4 - F4 A4 G4 - - .",
  "A4 A4 C5 - F5 - E5 D5", "D5 - B4 . G4 - B4 D5", "E5 - B4 G4 E4 - G4 B4", "A4 - C5 E5 A5 - - .",
  "F5 . E5 . D5 - C5 A4", "B4 - D5 . G5 - F5 D5", "E5 - C5 G4 E4 G4 C5 -", "C5 - - - - - - -",
];
const ORC_CHORDS = ["C", "G", "Am", "F", "C", "G", "Am", "G", "F", "G", "Em", "Am", "F", "G", "C", "C"];
const ORC_CH = { C: [36, [60, 64, 67]], G: [43, [59, 62, 67]], Am: [45, [57, 60, 64]], F: [41, [57, 60, 65]], Em: [40, [55, 59, 64]] };
const NOTE_OF = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const noteMidi = s => 12 * (Number(s.slice(-1)) + 1) + NOTE_OF[s[0]];
const ORC_SCORE = (() => {
  const v = [[], [], [], []];
  ORC_LEAD.forEach((bar, b) => bar.split(" ").forEach((k, i) => {
    const t = (b * 8 + i) * ORC_STEP;
    if (k === "-") { const l = v[0][v[0].length - 1]; if (l) l.d += ORC_STEP; }
    else if (k !== ".") v[0].push({ t, d: ORC_STEP, m: noteMidi(k) });
  }));
  ORC_CHORDS.forEach((c, b) => {
    const [root, tri3] = ORC_CH[c], t0 = b * 8 * ORC_STEP;
    if (b === ORC_CHORDS.length - 1) {
      tri3.forEach(m => v[1].push({ t: t0, d: 8 * ORC_STEP, m }));
      v[2].push({ t: t0, d: 8 * ORC_STEP, m: root });
      v[3].push({ t: t0, d: 0.3, m: 1, big: true });
      return;
    }
    [0, 1, 2, 1].forEach((n, q) => v[1].push({ t: t0 + q * 2 * ORC_STEP, d: 2 * ORC_STEP * 0.95, m: tri3[n] }));
    [0, 7, 12, 7].forEach((n, q) => v[2].push({ t: t0 + q * 2 * ORC_STEP, d: 2 * ORC_STEP * 0.9, m: root + n }));
    for (let e = 0; e < 8; e++) {
      if (e === 2 || e === 6) v[3].push({ t: t0 + e * ORC_STEP, d: 0.07, m: 1 });
      else if (b >= 4 && e % 2 === 1) v[3].push({ t: t0 + e * ORC_STEP, d: 0.04, m: 0.3 });
    }
  });
  return v;
})();
const ORC_END = ORC_CHORDS.length * 8 * ORC_STEP;
const ORC_LO = [62, 55, 36], ORC_HI = [81, 67, 57];
const ORC_PLAYERS = [
  { name: "X1 Carbone", role: "premier violon", c: "#f59e0b" },
  { name: "P1S", role: "alto", c: "#22c55e" },
  { name: "A1", role: "contrebasse", c: "#3b82f6" },
  { name: "A1 mini", role: "percussions (le plateau)", c: "#ec4899" },
];
const ORC_GLYPHS = ["♪", "♫", "♩", "♬"];

function orcPlay(ctx, t0) {
  const out = ctx.createGain();
  out.gain.value = 0.3;
  const comp = ctx.createDynamicsCompressor();
  out.connect(comp); comp.connect(ctx.destination);
  const nb = noiseBuffer(ctx, 0.5);
  const fin = e => (e.d > 1 ? 0.9 : 0.04);
  ORC_SCORE[0].forEach(e => tone(ctx, out, { t: t0 + e.t, dur: e.d, freq: midiHz(e.m), type: "square", vol: 0.06, cut: 2200, rel: fin(e) }));
  ORC_SCORE[1].forEach(e => tone(ctx, out, { t: t0 + e.t, dur: e.d, freq: midiHz(e.m), type: "triangle", vol: 0.09, rel: e.d > 1 ? 1 : 0.1 }));
  ORC_SCORE[2].forEach(e => tone(ctx, out, { t: t0 + e.t, dur: e.d, freq: midiHz(e.m), type: "sawtooth", vol: 0.1, cut: 600, rel: e.d > 1 ? 1 : 0.08 }));
  ORC_SCORE[3].forEach(e => {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = t0 + e.t;
    src.buffer = nb;
    f.type = "bandpass"; f.frequency.value = e.big ? 900 : 2400;
    g.gain.setValueAtTime(e.big ? 0.5 : 0.35 * e.m, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + e.d + 0.03);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, 0, e.d + 0.05);
  });
}

function OrcPrinter({ c, pos, hits }) {
  return (
    <svg viewBox="0 0 120 100" width="100%" style={{ display:"block", position:"relative" }}>
      <rect x="10" y="8" width="100" height="84" rx="8" fill="#1f2430" stroke={c} strokeOpacity=".45" strokeWidth="1.5"/>
      <rect x="18" y="16" width="84" height="60" rx="3" fill="#0b0e15"/>
      <rect key={hits} x="18" y="16" width="84" height="60" rx="3" fill={c} style={{ animation:"orc-glow .4s ease-out both" }}/>
      <rect x="20" y="26" width="80" height="3" rx="1.5" fill="#4b5563"/>
      <g style={{ transform:`translateX(${(20 + pos * 64).toFixed(1)}px)`, transition:"transform .12s ease-out" }}>
        <rect x="0" y="20" width="16" height="16" rx="2" fill="#e5e7eb"/>
        <circle cx="12" cy="24" r="1.6" fill={c}/>
        <path d="M6 36 L10 36 L8 40 Z" fill="#d97706"/>
      </g>
      <rect x="22" y="66" width="76" height="4" fill="#b59a5a"/>
      <rect x="52" y="58" width="14" height="8" rx="1" fill={c} opacity=".8"/>
      <rect x="18" y="80" width="84" height="8" rx="2" fill="#111827"/>
      <rect x="24" y="82" width="20" height="4" rx="1" fill={c} opacity=".6"/>
    </svg>
  );
}

function Orchestre() {
  const [won, win] = useWin("orchestre");
  const [openAudio, audioRef] = useAudioCtx();
  const [state, setState] = useState("idle");
  const [view, setView] = useState({ heads: [0.5, 0.5, 0.5, 0.5], hits: [0, 0, 0, 0], prog: 0 });
  const [notes, setNotes] = useState([]);
  const R = useRef({ t0: 0, acc: 0, ptr: [0, 0, 0, 0], id: 0, alt: 0, heads: [0.5, 0.5, 0.5, 0.5], hits: [0, 0, 0, 0], ended: false, ctx: false });
  const roses = useMemo(() => Array.from({ length: 12 }, () => ({ x: rand(5, 95), d: rand(1.6, 2.6), dl: rand(0, 1.2), r: rand(-60, 60) })), []);

  const start = e => {
    e.stopPropagation();
    if (state !== "idle") return;
    const ac = openAudio(), r = R.current;
    r.ptr = [0, 0, 0, 0]; r.acc = 0; r.ctx = !!ac;
    if (ac) { r.t0 = ac.currentTime + 0.3; r.ct0 = ac.currentTime; try { orcPlay(ac, r.t0); } catch { r.ctx = false; } }
    setState("play");
  };

  useRaf((dt, _now, real) => {
    const r = R.current, ac = audioRef.current;
    r.acc += real;
    // l'horloge du son fait foi ; si elle ne tourne pas (son bloque), la pendule murale prend le relais
    if (r.ctx && (!ac || (r.acc > 0.6 && ac.currentTime - r.ct0 < 0.1))) r.ctx = false;
    const now = r.ctx ? ac.currentTime - r.t0 : r.acc - 0.3;
    let changed = false;
    const born = [];
    for (let v = 0; v < 4; v++) {
      const ev = ORC_SCORE[v];
      while (r.ptr[v] < ev.length && ev[r.ptr[v]].t <= now) {
        const e = ev[r.ptr[v]++];
        changed = true;
        if (v === 3) { r.alt = 1 - r.alt; r.heads[3] = 0.2 + r.alt * 0.6; }
        else r.heads[v] = clamp((e.m - ORC_LO[v]) / (ORC_HI[v] - ORC_LO[v]), 0, 1);
        r.hits[v] += 1;
        if ((v !== 3 || e.m >= 1) && Math.random() < (v === 0 ? 0.75 : 0.4)) {
          born.push({ id: ++r.id, v, x: rand(15, 80), dx: rand(-40, 40), g: ORC_GLYPHS[r.id % 4] });
        }
      }
    }
    if (changed) {
      setView({ heads: [...r.heads], hits: [...r.hits], prog: clamp(now / ORC_END, 0, 1) });
      if (born.length) setNotes(ns => [...ns.slice(-36), ...born]);
    }
    if (now > ORC_END + 0.8 && !r.ended) { r.ended = true; setState("end"); }
  }, state === "play");
  useEffect(() => {
    if (state !== "end") return undefined;
    const id = setTimeout(win, 1800);
    return () => clearTimeout(id);
  }, [state, win]);
  const red = "repeating-linear-gradient(90deg, #5b0d12 0 10px, #7f1d1d 10px 18px, #450a0a 18px 26px)";

  return (
    <Stage won={won} wonText="Concert écouté jusqu'aux saluts" font={SANS}
      bg="radial-gradient(ellipse at 50% 0%, #3b1d0e 0%, #140a05 55%, #070302 100%)">
      <style>{`
        @keyframes orc-glow { from { opacity:.35 } to { opacity:0 } }
        @keyframes orc-fly { 0% { transform:translate(0,0) scale(.6); opacity:0 } 15% { opacity:1 } 100% { transform:translate(var(--dx), -120px) scale(1.15) rotate(18deg); opacity:0 } }
        @keyframes orc-bow { from { transform:none } to { transform:translateY(8px) rotate(-6deg) } }
        @keyframes orc-rose { from { transform:translateY(-40px) rotate(0); opacity:0 } 10% { opacity:1 } to { transform:translateY(calc(100dvh - 260px)) rotate(var(--r)); opacity:1 } }
      `}</style>
      <div aria-hidden="true" style={{ position:"absolute", left:0, top:0, bottom:0, width:"7%", background:red, boxShadow:"inset -10px 0 16px rgba(0,0,0,.6)" }}/>
      <div aria-hidden="true" style={{ position:"absolute", right:0, top:0, bottom:0, width:"7%", background:red, boxShadow:"inset 10px 0 16px rgba(0,0,0,.6)" }}/>
      <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, bottom:0, height:"24%",
        background:"repeating-linear-gradient(90deg, rgba(0,0,0,.18) 0 2px, transparent 2px 60px), linear-gradient(#4a2c17, #23130a)" }}/>
      <Title color="#fde68a" sub="Concerto pour quatre moteurs pas-à-pas, opus 0,2">L'Orchestre</Title>
      <div style={{ position:"relative", zIndex:2, display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:18,
        width:"min(86%, 680px)", marginTop:22 }}>
        {ORC_PLAYERS.map((pl, i) => (
          <div key={i} style={{ position:"relative", textAlign:"center",
            animation: state === "end" ? `orc-bow .9s ease-in-out ${i * 0.12}s 2 alternate both` : undefined }}>
            <div aria-hidden="true" style={{ position:"absolute", left:"50%", top:-50, width:"130%", height:"150%", transform:"translateX(-50%)", pointerEvents:"none",
              background:`radial-gradient(ellipse at 50% 30%, ${pl.c}2e, transparent 66%)` }}/>
            <OrcPrinter c={pl.c} pos={view.heads[i]} hits={view.hits[i]}/>
            <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
              {notes.filter(n => n.v === i).map(n => (
                <span key={n.id} onAnimationEnd={() => setNotes(ns => ns.filter(x => x.id !== n.id))}
                  style={{ position:"absolute", left:`${n.x}%`, top:"18%", color:pl.c, fontSize:22, textShadow:`0 0 8px ${pl.c}`, "--dx":`${n.dx}px`,
                    animation:"orc-fly 1.8s ease-out forwards" }}>{n.g}</span>
              ))}
            </div>
            <div style={{ marginTop:6, fontWeight:800, fontSize:14, color:"#fef3c7" }}>{pl.name}</div>
            <div style={{ fontSize:11.5, color:"#d6b98c", fontStyle:"italic" }}>{pl.role}</div>
          </div>
        ))}
      </div>
      <div style={{ position:"relative", zIndex:3, marginTop:22, minHeight:46, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:40 }}>
        {state === "idle" && <Btn onClick={start} color="#b45309">🎼 Lever la baguette</Btn>}
        {state === "play" && (
          <div style={{ width:"min(70vw, 320px)", height:3, borderRadius:3, background:"rgba(253,230,138,.18)" }}>
            <div style={{ height:"100%", width:`${view.prog * 100}%`, borderRadius:3, background:"#fde68a" }}/>
          </div>
        )}
        {state === "end" && <div style={{ fontFamily:SERIF, fontSize:28, color:"#fde68a", animation:"hk-fade 1s both" }}>Bravo ! 👏</div>}
      </div>
      {state === "end" && roses.map((r, i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", top:0, left:`${r.x}%`, fontSize:22, zIndex:4, pointerEvents:"none", "--r":`${r.r}deg`,
          animation:`orc-rose ${r.d}s ease-in ${r.dl}s both` }}>🌹</span>
      ))}
      <Hint won={won} color="rgba(253,230,138,.8)">
        {state === "idle" ? "Monte un peu le son : le concert va commencer." : "Chaque moteur chante la note de son déplacement."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------- vinyle */

const VIN_C = [165, 160], VIN_P = [335, 55], VIN_L = 200, VIN_SIDE = 30, VIN_LEAD = 1.4;
function armAngle(r) {
  let lo = 0, hi = 60;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2, a = (m * Math.PI) / 180;
    const d = Math.hypot(VIN_P[0] - VIN_L * Math.sin(a) - VIN_C[0], VIN_P[1] + VIN_L * Math.cos(a) - VIN_C[1]);
    if (d > r) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
const VIN_OUT = armAngle(114), VIN_IN = armAngle(48), VIN_REST = 4;
const VIN_TRACKS = [
  { name: "Première couche, 2 h du matin", hue: 190, ch: [[57, 60, 64, 67], [50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59]] },
  { name: "Valse du plateau texturé", hue: 300, ch: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]] },
  { name: "Ballade pour une bobine vide", hue: 35, ch: [[53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62], [48, 52, 55, 59]] },
];

function kick(ctx, dest, t, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + 0.32);
}

function vinMusic(ctx, dest, t0) {
  // le craquement du disque, du poser du diamant a la fin de la face
  const n = Math.floor(ctx.sampleRate * 3), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.012;
  for (let j = 0; j < 40; j++) { const i = Math.floor(Math.random() * (n - 2)), a = rand(0.15, 0.6) * (Math.random() < 0.5 ? -1 : 1); d[i] += a; d[i + 1] -= a * 0.6; }
  const cr = ctx.createBufferSource(), cg = ctx.createGain();
  cr.buffer = buf; cr.loop = true; cg.gain.value = 0.5;
  cr.connect(cg); cg.connect(dest);
  cr.start(t0 - 1); cr.stop(t0 + VIN_SIDE + 0.4);
  VIN_TRACKS.forEach((tr, k) => {
    const base = t0 + k * 10;
    tr.ch.forEach((c, j) => {
      const tc = base + j * 2.4;
      c.forEach(m => tone(ctx, dest, { t: tc, dur: 2.4, freq: midiHz(m), type: "triangle", vol: 0.022, att: 0.35, rel: 0.7 }));
      tone(ctx, dest, { t: tc, dur: 2.3, freq: midiHz(c[0] - 12), type: "sine", vol: 0.09, att: 0.02, rel: 0.5 });
      const pat = k === 1 ? [0, 2, 3, 1, 2, 3, 0, 2] : [0, 1, 2, 3, 2, 1, 3, 2];
      pat.forEach((nn, e) => {
        if (k === 2 && e % 4 === 3) return;
        tone(ctx, dest, { t: tc + e * 0.3, dur: 0.28, freq: midiHz(c[nn] + 12), type: "sine", vol: 0.045, att: 0.004, rel: 0.22 });
      });
      for (let bt = 0; bt < 4; bt++) kick(ctx, dest, tc + bt * 0.6, bt % 2 ? 0.05 : 0.09);
    });
  });
}

function Vinyle() {
  const [won, win] = useWin("vinyle");
  const [openAudio] = useAudioCtx();
  const [phase, setPhase] = useState("idle");
  const [muted, setMuted] = useState(false);
  const t = useClock(phase === "play", 15);
  const A = useRef({ master: null, an: null, data: null });
  const bars = useRef([]);
  const grooves = useMemo(() => Array.from({ length: 29 }, (_, i) => 46 + i * 2.5), []);

  const start = () => {
    if (phase !== "idle") return;
    const ac = openAudio();
    if (ac) {
      try {
        const master = ac.createGain(), an = ac.createAnalyser(), bus = ac.createGain();
        master.connect(ac.destination);
        an.fftSize = 64; an.smoothingTimeConstant = 0.75; an.connect(master);
        bus.gain.value = 0.8; bus.connect(an);
        vinMusic(ac, bus, ac.currentTime + VIN_LEAD);
        A.current = { master, an, data: new Uint8Array(an.frequencyBinCount) };
      } catch { /* sans son */ }
    }
    setPhase("play");
  };
  const toggleMute = e => {
    e.stopPropagation();
    const m = !muted;
    setMuted(m);
    const g = A.current.master;
    if (g) g.gain.setTargetAtTime(m ? 0 : 1, g.context.currentTime, 0.05);
  };

  const endT = VIN_LEAD + VIN_SIDE, el = t - VIN_LEAD;
  const over = phase === "play" && t >= endT + 1.8;
  useEffect(() => { if (over) { setPhase("done"); win(); } }, [over, win]);
  useRaf((dt, now) => {
    const { data } = A.current;
    let an = A.current.an;
    if (an) { an.getByteFrequencyData(data); if (!data.some(Boolean)) an = null; }
    bars.current.forEach((b, i) => {
      if (!b) return;
      const v = el < 0 || el > VIN_SIDE ? 0.03 : an ? data[i + 1] / 255 : 0.35 + 0.3 * Math.sin(now / 260 + i * 0.8);
      b.style.transform = `scaleY(${Math.max(0.03, v).toFixed(3)})`;
    });
  }, phase === "play");

  let ang = VIN_REST, tr = "transform 1.4s cubic-bezier(.4,0,.2,1)";
  if (phase === "play" && t < endT) {
    ang = el < 0 ? VIN_OUT : lerp(VIN_OUT, VIN_IN, clamp(el / VIN_SIDE, 0, 1));
    if (el >= 0) tr = "transform .2s linear";
  }
  const spinning = phase === "play" && t < endT + 1;
  const k = phase !== "play" || el < 0 ? -1 : Math.min(2, Math.floor(el / 10));
  const sounding = k >= 0 && el < VIN_SIDE && el % 10 < 9.6;
  const hue = k < 0 ? 210 : VIN_TRACKS[k].hue;
  const sec = Math.floor(clamp(el, 0, VIN_SIDE));
  const wedge = (a1, a2) => {
    const p = a => [VIN_C[0] + 120 * Math.cos((a * Math.PI) / 180), VIN_C[1] + 120 * Math.sin((a * Math.PI) / 180)].map(v => v.toFixed(1)).join(" ");
    return `M${VIN_C[0]} ${VIN_C[1]} L${p(a1)} A120 120 0 0 1 ${p(a2)} Z`;
  };

  return (
    <Stage won={won} wonText="Face A écoutée jusqu'au bout" font={SANS} onClick={start}
      bg={`radial-gradient(ellipse at 50% 45%, hsla(${hue},70%,32%,${sounding ? 0.6 : 0.25}) 0%, #07070c 70%)`}
      style={{ cursor: phase === "idle" ? "pointer" : "default" }}>
      <style>{`
        @keyframes vin-spin { to { transform:rotate(360deg) } }
        @keyframes vin-ring { from { transform:translate(-50%,-50%) scale(.45); opacity:.75 } to { transform:translate(-50%,-50%) scale(1.9); opacity:0 } }
      `}</style>
      <Title color="#f5f3ff" sub="Bambu Records présente « Couches lointaines ».">Vinyle</Title>
      {phase !== "idle" && (
        <button onClick={toggleMute} aria-label={muted ? "Remettre le son" : "Couper le son"}
          style={{ position:"absolute", top:14, right:14, zIndex:6, border:"none", borderRadius:99, width:36, height:36, cursor:"pointer",
            background:"rgba(255,255,255,.1)", color:"#fff", fontSize:16 }}>{muted ? "🔇" : "🔊"}</button>
      )}
      <div style={{ position:"relative", width:"min(100%, 520px)", marginTop:16 }}>
        <svg viewBox="0 0 400 320" width="100%" style={{ display:"block" }}>
          <defs>
            <linearGradient id="vin-wood" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6b4428"/><stop offset=".5" stopColor="#4a2d19"/><stop offset="1" stopColor="#3a2213"/>
            </linearGradient>
          </defs>
          <rect x="8" y="8" width="384" height="304" rx="18" fill="url(#vin-wood)"/>
          <rect x="16" y="16" width="368" height="288" rx="12" fill="rgba(0,0,0,.2)"/>
          <circle cx={VIN_C[0]} cy={VIN_C[1]} r="128" fill="#26262b" stroke="#4b5563" strokeWidth="1.5"/>
          <g style={{ transformBox:"view-box", transformOrigin:`${VIN_C[0]}px ${VIN_C[1]}px`, animation:"vin-spin 1.8s linear infinite",
            animationPlayState: spinning ? "running" : "paused" }}>
            <circle cx={VIN_C[0]} cy={VIN_C[1]} r="120" fill="#0b0b0d"/>
            {grooves.map(r => <circle key={r} cx={VIN_C[0]} cy={VIN_C[1]} r={r} fill="none" stroke="rgba(255,255,255,.04)" strokeWidth=".8"/>)}
            {[70, 94].map(r => <circle key={r} cx={VIN_C[0]} cy={VIN_C[1]} r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1.6"/>)}
            <circle cx={VIN_C[0]} cy={VIN_C[1]} r="40" fill="#f59e0b"/>
            <circle cx={VIN_C[0]} cy={VIN_C[1]} r="36" fill="none" stroke="#b45309" strokeWidth=".8"/>
            <text x={VIN_C[0]} y={VIN_C[1] - 12} textAnchor="middle" fontSize="7.5" fontWeight="900" fill="#451a03" fontFamily={SANS}>BAMBU RECORDS</text>
            <text x={VIN_C[0]} y={VIN_C[1] + 16} textAnchor="middle" fontSize="8" fill="#451a03" fontFamily={SERIF} fontStyle="italic">Face A</text>
            <text x={VIN_C[0]} y={VIN_C[1] + 26} textAnchor="middle" fontSize="5.5" fill="#78350f" fontFamily={SANS}>33 ⅓ tours</text>
            <circle cx={VIN_C[0]} cy={VIN_C[1]} r="3" fill="#111"/>
          </g>
          <path d={wedge(-72, -42)} fill="rgba(255,255,255,.05)"/>
          <path d={wedge(108, 138)} fill="rgba(255,255,255,.04)"/>
          <circle cx="318" cy="205" r="5" fill="#1f2937" stroke="#6b7280"/>
          <circle cx={VIN_P[0]} cy={VIN_P[1]} r="22" fill="#374151" stroke="#6b7280" strokeWidth="1.5"/>
          <g style={{ transformBox:"view-box", transformOrigin:`${VIN_P[0]}px ${VIN_P[1]}px`, transform:`rotate(${ang.toFixed(2)}deg)`, transition:tr }}>
            <rect x={VIN_P[0] - 10} y={VIN_P[1] - 36} width="20" height="22" rx="4" fill="#9ca3af"/>
            <line x1={VIN_P[0]} y1={VIN_P[1] - 14} x2={VIN_P[0]} y2={VIN_P[1] + 178} stroke="#d1d5db" strokeWidth="4" strokeLinecap="round"/>
            <rect x={VIN_P[0] - 8} y={VIN_P[1] + 176} width="16" height="25" rx="3" fill="#e5e7eb"/>
            <rect x={VIN_P[0] + 8} y={VIN_P[1] + 182} width="9" height="3" rx="1.5" fill="#cbd5e1"/>
            <rect x={VIN_P[0] - 2} y={VIN_P[1] + 197} width="4" height="4" fill="#111827"/>
            <circle cx={VIN_P[0]} cy={VIN_P[1]} r="8" fill="#9ca3af" stroke="#4b5563"/>
          </g>
          <rect x="296" y="272" width="26" height="14" rx="3" fill={phase === "play" ? "#fbbf24" : "#1f2937"}/>
          <text x="309" y="282.5" textAnchor="middle" fontSize="8" fontWeight="800" fill={phase === "play" ? "#451a03" : "#9ca3af"} fontFamily={SANS}>33</text>
          <rect x="328" y="272" width="26" height="14" rx="3" fill="#1f2937"/>
          <text x="341" y="282.5" textAnchor="middle" fontSize="8" fontWeight="800" fill="#9ca3af" fontFamily={SANS}>45</text>
          <circle cx="370" cy="279" r="4" fill={spinning ? "#ef4444" : "#3f1d1d"}/>
          <rect x="365" y="112" width="6" height="90" rx="3" fill="#1f2937"/>
          <rect x="360" y="152" width="16" height="9" rx="2" fill="#9ca3af"/>
        </svg>
        {sounding && [0, 1, 2, 3].map(i => (
          <div key={`${k}-${i}`} aria-hidden="true" style={{ position:"absolute", left:`${(VIN_C[0] / 400) * 100}%`, top:`${(VIN_C[1] / 320) * 100}%`,
            width:"62%", aspectRatio:"1", borderRadius:"50%", pointerEvents:"none", mixBlendMode:"screen",
            border:`2px solid hsla(${hue},90%,65%,.7)`, boxShadow:`0 0 18px hsla(${hue},90%,60%,.5), inset 0 0 18px hsla(${hue},90%,60%,.35)`,
            animation:`vin-ring 2.4s ease-out ${i * 0.6}s infinite both` }}/>
        ))}
      </div>
      <div style={{ position:"relative", zIndex:2, marginTop:14, textAlign:"center", minHeight:42 }}>
        {phase === "idle" && <div style={{ color:"#c4b5fd", fontStyle:"italic", fontSize:14 }}>Le disque attend son diamant.</div>}
        {phase === "play" && (k < 0 ? <div style={{ color:"#c4b5fd", fontStyle:"italic", fontSize:14 }}>Craaac… le diamant se pose.</div> : el >= VIN_SIDE
          ? <div style={{ color:"#c4b5fd", fontStyle:"italic", fontSize:14 }}>Le sillon de fin tourne en rond…</div> : (
            <div key={k} style={{ animation:"hk-fade 1s both" }}>
              <div style={{ fontSize:11, letterSpacing:".2em", textTransform:"uppercase", color:`hsl(${hue},80%,75%)` }}>Face A · piste {k + 1}</div>
              <div style={{ fontFamily:SERIF, fontStyle:"italic", fontSize:17, color:"#f5f3ff", marginTop:2 }}>{VIN_TRACKS[k].name}</div>
            </div>
          ))}
        {phase === "done" && <div style={{ fontFamily:SERIF, fontStyle:"italic", fontSize:16, color:"#f5f3ff", animation:"hk-fade 1s both" }}>
          Fin de la face A. La face B ? Une autre fois.</div>}
      </div>
      <div aria-hidden="true" style={{ display:"flex", alignItems:"flex-end", gap:4, height:34, marginTop:8, marginBottom:44 }}>
        {Array.from({ length: 16 }, (_, i) => (
          <div key={i} ref={el2 => { bars.current[i] = el2; }} style={{ width:8, height:"100%", borderRadius:2, transformOrigin:"bottom",
            transform:"scaleY(.03)", background:`hsl(${hue + i * 4},85%,62%)`, boxShadow:`0 0 8px hsla(${hue},90%,60%,.6)` }}/>
        ))}
      </div>
      {phase === "play" && <div style={{ position:"absolute", left:14, top:16, fontFamily:MONO, fontSize:12, color:"#a78bfa", zIndex:5 }}>
        {`0:${String(sec).padStart(2, "0")} / 0:30`}</div>}
      <Hint won={won} color="rgba(221,214,254,.8)">{phase === "idle" ? "Pose le diamant : touche la platine." : "Une face, trente secondes. Ne bouge plus."}</Hint>
    </Stage>
  );
}

/* -------------------------------------------------------------------- ascii */

const ASC_W = 40, ASC_H = 22;
const ASC_BOOT = [
  "BAMBU-TTY v0.4 -- atelier",
  "",
  "> connexion imprimante ...... OK",
  "> chauffe buse     220C [####]",
  "> chauffe plateau   65C [####]",
  "> nivellement ............... OK",
  "> print benchy.gcode",
];
const ASC_T_BOOT = ASC_BOOT.reduce((n, l) => n + l.length + 4, 0) / 32 + 0.8;
const ASC_BENCHY = [
  "              __",
  "             |  |",
  "       ______|  |_______",
  "      |   __     __     |",
  "      |  |__|   |__|    |",
  " _____|_________________|______",
  " \\                            /",
  "  \\    ()      ()      ()    /",
  "   \\________________________/",
];
const ASC_OX = 4, ASC_BOTTOM = 18;
const ASC_PLAN = (() => {
  const rows = [];
  let t = 0;
  for (let k = ASC_BENCHY.length - 1, dir = 1; k >= 0; k--, dir = -dir) {
    const l = ASC_BENCHY[k], a = l.search(/\S/), b = l.trimEnd().length - 1, dur = (b - a + 1) * 0.05 + 0.3;
    rows.push({ k, a, b, dir, t0: t, dur });
    t += dur;
  }
  return { rows, total: t };
})();
const ASC_RAMP = " .:-=+*#%@";
const ASC_MSG = "    *** BAMBUNYMOUS DEMO 2026 ***  SALUTATIONS À LA BUSE, AU PLATEAU, À L'AMS ET À TOUS LES BENCHY DU MONDE  ***  AUCUN SPAGHETTI N'A ÉTÉ BLESSÉ PENDANT CETTE DÉMO  ***    ";
const ASC_PAL = [{ fg: "#4dff88", bg: "#03140a" }, { fg: "#ffb84d", bg: "#140c02" }, { fg: "#a5dcff", bg: "#020c16" }];

const ascGrid = () => Array.from({ length: ASC_H }, () => Array(ASC_W).fill(" "));
function ascPut(g, r, c, s) {
  for (let i = 0; i < s.length; i++) { const x = c + i; if (r >= 0 && r < ASC_H && x >= 0 && x < ASC_W) g[r][x] = s[i]; }
}
const ascCenter = (g, r, s) => ascPut(g, r, Math.floor((ASC_W - s.length) / 2), s);

function ascBoot(t) {
  const g = ascGrid();
  let n = Math.floor(t * 32), r = 1, cur = null;
  for (const line of ASC_BOOT) {
    if (n <= 0) break;
    const k = Math.min(line.length, n);
    ascPut(g, r, 1, line.slice(0, k));
    cur = [r, 1 + k];
    n -= line.length + 4;
    r++;
  }
  if (cur && Math.floor(t * 2.5) % 2 === 0) ascPut(g, cur[0], cur[1], "_");
  return g;
}
function ascFrame(g, header, pct) {
  ascPut(g, 0, 0, header);
  const ps = String(pct).padStart(3, " ") + "%";
  ascPut(g, 0, ASC_W - ps.length, ps);
  const n = Math.round((pct / 100) * 30);
  ascPut(g, 1, 0, "[" + "#".repeat(n) + ".".repeat(30 - n) + "]");
  ascPut(g, 2, 0, "+" + "-".repeat(ASC_W - 2) + "+");
  for (let r = 3; r < 20; r++) { g[r][0] = "|"; g[r][ASC_W - 1] = "|"; }
  ascPut(g, 19, 1, "#".repeat(ASC_W - 2));
  ascPut(g, 20, 0, "+" + "-".repeat(ASC_W - 2) + "+");
}
function ascCarriage(g, row, col) { ascPut(g, row, 1, "=".repeat(ASC_W - 2)); ascPut(g, row, col - 1, "[V]"); }
const ascRow = k => ASC_BOTTOM - (ASC_BENCHY.length - 1 - k);

function ascPrint(tp) {
  const g = ascGrid();
  ascFrame(g, "IMPRESSION benchy.gcode", Math.min(100, Math.floor((tp / ASC_PLAN.total) * 100)));
  let car = [3, 20];
  for (const r of ASC_PLAN.rows) {
    const line = ASC_BENCHY[r.k], gr = ascRow(r.k);
    if (tp >= r.t0 + r.dur) { ascPut(g, gr, ASC_OX + r.a, line.slice(r.a, r.b + 1)); continue; }
    if (tp < r.t0) break;
    const n = clamp(Math.floor((tp - r.t0 - 0.3) / 0.05) + 1, 0, r.b - r.a + 1);
    if (r.dir > 0) {
      if (n) ascPut(g, gr, ASC_OX + r.a, line.slice(r.a, r.a + n));
      car = [gr - 1, ASC_OX + (n ? r.a + n - 1 : r.a)];
    } else {
      if (n) ascPut(g, gr, ASC_OX + r.b - n + 1, line.slice(r.b - n + 1, r.b + 1));
      car = [gr - 1, ASC_OX + (n ? r.b - n + 1 : r.b)];
    }
    break;
  }
  ascCarriage(g, car[0], car[1]);
  ascPut(g, 21, 1, "buse 220°C  plateau 65°C  ventilo 100%");
  return g;
}
function ascDone(td) {
  const g = ascGrid();
  ascFrame(g, "TERMINÉ    benchy.gcode", 100);
  ASC_BENCHY.forEach((l, k) => ascPut(g, ascRow(k), ASC_OX, l));
  ascCarriage(g, 3, ASC_W - 4);
  if (Math.floor(td * 3) % 2 === 0) ascCenter(g, 21, "> 0 spaghetti détecté. Bravo !");
  return g;
}
function ascDemo(T) {
  const g = ascGrid();
  for (let y = 1; y < ASC_H - 1; y++) {
    for (let x = 0; x < ASC_W; x++) {
      const v = Math.sin(x * 0.22 + T * 1.1) + Math.sin(y * 0.38 - T * 1.4) + Math.sin((x + y) * 0.13 + T * 0.8)
        + Math.sin(Math.hypot(x - 20, (y - 11) * 1.9) * 0.32 - T * 2.2);
      let k = clamp(Math.floor(((v + 4) / 8) * ASC_RAMP.length), 0, ASC_RAMP.length - 1);
      if (y >= 8 && y <= 14) k = y >= 9 && y <= 13 ? 0 : Math.min(k, 1);
      g[y][x] = ASC_RAMP[k];
    }
  }
  ascCenter(g, 0, "~ BAMBUNYMOUS · DEMO 2026 ~");
  const off = Math.floor(T * 11);
  const sr = 11 + Math.round(Math.sin(T * 2.2));
  for (let c = 0; c < ASC_W; c++) g[sr][c] = ASC_MSG[(off + c) % ASC_MSG.length];
  ascCenter(g, ASC_H - 1, "musique : le ventilo  ·  code : la buse");
  return g;
}
function ascEnd(te) {
  const g = ascGrid();
  ["FIN DE LA DÉMO", "", "merci d'avoir regardé jusqu'au bout", "", "aucun filament n'a été blessé"].forEach((l, i) => ascCenter(g, 6 + i, l));
  ascPut(g, 14, 2, "> " + (Math.floor(te * 2.5) % 2 ? " " : "_"));
  return g;
}

function Ascii() {
  const [won, win] = useWin("ascii");
  const t = useClock(true, 20);
  const [pal, setPal] = useState(0);
  const [fs, setFs] = useState(12);
  const box = useRef(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const fit = () => setFs(Math.min(17, Math.max(6, (el.clientWidth - 24) / (ASC_W * 0.61))));
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el); else window.addEventListener("resize", fit);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener("resize", fit); };
  }, []);
  const T1 = ASC_T_BOOT, T2 = T1 + ASC_PLAN.total, T3 = T2 + 3, T4 = T3 + 14;
  const phase = t < T1 ? 0 : t < T2 ? 1 : t < T3 ? 2 : t < T4 ? 3 : 4;
  const g = phase === 0 ? ascBoot(t) : phase === 1 ? ascPrint(t - T1) : phase === 2 ? ascDone(t - T2) : phase === 3 ? ascDemo(t - T3) : ascEnd(t - T4);
  const text = g.map(r => r.join("")).join("\n");
  useEffect(() => {
    if (phase !== 4) return undefined;
    const id = setTimeout(win, 1400);
    return () => clearTimeout(id);
  }, [phase, win]);
  const P = ASC_PAL[pal];

  return (
    <Stage won={won} wonText="Démo regardée jusqu'au bout" font={MONO} onClick={() => setPal(p => (p + 1) % ASC_PAL.length)}
      bg="radial-gradient(ellipse at 50% 40%, #1a1d22 0%, #08090b 75%)" style={{ cursor:"pointer" }}>
      <style>{`
        @keyframes asc-flick { 0%,100% { opacity:1 } 50% { opacity:.94 } 52% { opacity:.86 } 54% { opacity:.97 } }
        @keyframes asc-hue { to { filter:hue-rotate(360deg) } }
      `}</style>
      <div ref={box} style={{ position:"relative", width:"min(100%, 660px)", borderRadius:14, overflow:"hidden", background:"#1f2328",
        boxShadow:"0 20px 50px rgba(0,0,0,.6), 0 0 0 1px #2d333b" }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 12px", background:"#2d333b", fontFamily:SANS, fontSize:12, color:"#9ca3af" }}>
          <span style={{ width:10, height:10, borderRadius:"50%", background:"#ef4444" }}/>
          <span style={{ width:10, height:10, borderRadius:"50%", background:"#f59e0b" }}/>
          <span style={{ width:10, height:10, borderRadius:"50%", background:"#22c55e" }}/>
          <span style={{ marginLeft:8 }}>tty1 — benchy.gcode</span>
        </div>
        <div style={{ position:"relative", background:P.bg, padding:"12px", transition:"background .4s" }}>
          <pre aria-label="Animation en caractères" style={{ margin:0, fontFamily:MONO, fontSize:fs, lineHeight:1.18, color:P.fg, whiteSpace:"pre",
            textShadow:`0 0 ${(fs * 0.5).toFixed(1)}px ${P.fg}`, animation: phase === 3 ? "asc-hue 5s linear infinite, asc-flick 3s infinite" : "asc-flick 3s infinite",
            transition:"color .4s" }}>{text}</pre>
          <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none",
            background:"repeating-linear-gradient(rgba(0,0,0,.28) 0 1px, transparent 1px 3px)" }}/>
          <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none", boxShadow:"inset 0 0 60px rgba(0,0,0,.75)" }}/>
        </div>
      </div>
      <Hint won={won} color="rgba(209,213,219,.8)">Touche l'écran pour changer la couleur du phosphore.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------- ciel polaire */

const POL_END = 50;
const POL_SAYS = [
  "Il fait −18 °C. Le ciel s'allume…",
  "Les rideaux de lumière ondulent au-dessus de la plaine.",
  "Un renard passe. Lui aussi s'arrête pour regarder.",
  "L'aurore danse encore un peu…",
  "L'aube arrive. L'aurore s'éteint doucement.",
  "Bonjour. Le ciel est allé se coucher.",
];
const POL_STOPS = [
  [[0, "rgba(150,70,220,0)"], [0.4, "rgba(140,90,230,.25)"], [0.72, "rgba(60,230,150,.55)"], [0.94, "rgba(170,255,210,.95)"], [1, "rgba(60,240,150,0)"]],
  [[0, "rgba(80,120,255,0)"], [0.45, "rgba(60,200,230,.25)"], [0.8, "rgba(80,255,170,.6)"], [0.96, "rgba(200,255,230,.9)"], [1, "rgba(80,255,170,0)"]],
];
const POL_CURTAINS = [
  { k: 0, y: 0.35, amp: 0.07, hh: 0.27, sp: 0 },
  { k: 1.7, y: 0.27, amp: 0.05, hh: 0.2, sp: 1 },
  { k: 3.1, y: 0.43, amp: 0.06, hh: 0.17, sp: 0 },
];
const foxX = t => (t < 14 ? -20 : t < 21 ? lerp(-20, 42, (t - 14) / 7) : t < 27 ? 42 : t < 36 ? lerp(42, 120, (t - 27) / 9) : 125);
const polCap = t => (t < 9 ? 0 : t < 19 ? 1 : t < 28 ? 2 : t < 37 ? 3 : t < POL_END ? 4 : 5);

function auroraSprite(stops) {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 256;
  const x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g; x.fillRect(0, 0, 2, 256);
  return c;
}

function Fox() {
  return (
    <svg viewBox="0 0 100 60" width="100%" style={{ display:"block", overflow:"visible" }}>
      <ellipse cx="52" cy="56" rx="30" ry="3" fill="rgba(0,0,0,.25)"/>
      <path d="M32 30 C20 36 8 34 2 22 C10 26 20 24 31 25 Z" fill="#ea580c"/>
      <path d="M2 22 C5 25 9 26 12 26 C8 28 4 27 2 22 Z" fill="#fff7ed"/>
      {[[38, 0], [44, -0.275], [60, -0.275], [66, 0]].map(([x, d], i) => (
        <line key={i} className="pol-leg" x1={x} y1="33" x2={x} y2="54" stroke="#1c1917" strokeWidth="3.4" strokeLinecap="round"
          style={{ transformBox:"view-box", transformOrigin:`${x}px 33px`, animationDelay:`${d}s` }}/>
      ))}
      <ellipse cx="52" cy="30" rx="22" ry="9.5" fill="#ea580c"/>
      <ellipse cx="67" cy="34" rx="7" ry="5" fill="#fff7ed"/>
      <g style={{ transformBox:"view-box", transformOrigin:"70px 27px", transform:"rotate(var(--head, 0deg))", transition:"transform 1.2s ease" }}>
        <path d="M68 29 L73 17 L86 14 L99 22 L97 25 L86 28 Z" fill="#ea580c"/>
        <path d="M86 24 L97 25 L88 29 Z" fill="#fff7ed"/>
        <path d="M74 18 L76 4 L82 15 Z M80 15 L84 4 L87 15 Z" fill="#c2410c"/>
        <path d="M76 4 L77.4 9 L79.4 8.4 Z M84 4 L84.4 9 L86 9 Z" fill="#1c1917"/>
        <circle cx="86.5" cy="19" r="1.3" fill="#1c1917"/>
        <circle cx="98.5" cy="23" r="1.4" fill="#1c1917"/>
      </g>
    </svg>
  );
}

function CielPolaire() {
  const [won, win] = useWin("ciel-polaire");
  const [cap, setCap] = useState(0);
  const refl = useRef(null), tint = useRef(null), fox = useRef(null);
  const S = useRef(null);
  if (!S.current) {
    S.current = { t: 0, boost: 0, cap: 0, won: false, spr: null,
      stars: Array.from({ length: 200 }, () => ({ x: Math.random(), y: Math.random() * 0.66, r: rand(0.4, 1.5), p: rand(0, 6) })) };
  }

  const ref = useCanvas((ctx, w, h, dt, real) => {
    const s = S.current;
    if (!s.spr) s.spr = POL_STOPS.map(auroraSprite);
    s.t += real;
    s.boost = Math.max(0, s.boost - dt * 0.45);
    const t = s.t;
    const A = clamp(smooth(0, 8, t) * (1 - smooth(32, 44, t)) * (1 + s.boost * 0.8), 0, 1.6);
    const D = smooth(34, POL_END, t);
    const c = polCap(t);
    if (c !== s.cap) { s.cap = c; setCap(c); }
    if (t >= POL_END + 0.6 && !s.won) { s.won = true; win(); }
    const hz = h * 0.64;
    // ciel, de la nuit a l'aube
    let g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, mix("#01030d", "#27406b", D));
    g.addColorStop(0.55, mix("#050c1f", "#8a6f9e", D));
    g.addColorStop(1, mix("#0c2236", "#fdba74", D));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f1f5ff";
    for (const st of s.stars) {
      ctx.globalAlpha = (1 - D) * (0.3 + 0.6 * Math.sin(t * 0.9 + st.p) ** 2);
      ctx.fillRect(st.x * w, st.y * h, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
    if (D > 0) {
      g = ctx.createRadialGradient(w * 0.7, hz, 0, w * 0.7, hz, h * 0.65);
      g.addColorStop(0, `rgba(255,190,120,${0.55 * D * D})`); g.addColorStop(1, "rgba(255,190,120,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    // l'aurore : des colonnes de lumiere le long de courbes qui ondulent
    if (A > 0.003) {
      const step = Math.max(2, Math.round(w / 260)), sp = 1 + 0.5 * s.boost;
      for (const cu of POL_CURTAINS) {
        for (let x = 0; x < w; x += step) {
          const u = x / w;
          const base = h * (cu.y + cu.amp * Math.sin(u * 5.2 + t * 0.22 * sp + cu.k) + 0.025 * Math.sin(u * 17 - t * 0.6 + cu.k * 2));
          const ht = h * cu.hh * (0.7 + 0.45 * Math.sin(u * 9 + t * 0.5 + cu.k));
          const a = A * (0.22 + 0.78 * Math.pow(0.5 + 0.5 * Math.sin(u * 11 + t * 0.9 * sp + cu.k * 3), 2));
          ctx.globalAlpha = clamp(a * 0.85, 0, 1);
          ctx.drawImage(s.spr[cu.sp], x, base - ht, step + 0.6, ht);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (refl.current) refl.current.style.opacity = (Math.min(1, A) * 0.55).toFixed(3);
    if (tint.current) tint.current.style.opacity = (D * 0.7).toFixed(3);
    const fe = fox.current;
    if (fe) {
      const walking = (t >= 14 && t < 21) || (t >= 27 && t < 36);
      fe.style.left = `${foxX(t).toFixed(2)}%`;
      fe.style.setProperty("--play", walking ? "running" : "paused");
      fe.style.setProperty("--head", t >= 21.6 && t < 26.6 ? "-24deg" : "0deg");
    }
  });

  return (
    <Stage won={won} wonText="Aurore regardée jusqu'à l'aube" font={SANS} bg="#01030d"
      onClick={() => { S.current.boost = Math.min(1.2, S.current.boost + 0.6); }} style={{ justifyContent:"flex-start", cursor:"pointer" }}>
      <style>{`
        @keyframes pol-leg { 0%,100% { transform:rotate(-20deg) } 50% { transform:rotate(20deg) } }
        .pol-leg { animation: pol-leg .55s ease-in-out infinite; animation-play-state: var(--play, paused) }
      `}</style>
      <canvas ref={ref} aria-hidden="true" style={CANVAS_STYLE}/>
      <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, bottom:0, height:"38%", zIndex:1, pointerEvents:"none", overflow:"hidden" }}>
        <svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMax slice" style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}>
          <path d="M0 40 L40 18 L70 34 L110 6 L150 30 L190 14 L230 36 L270 10 L320 32 L360 16 L400 30 V160 H0 Z" fill="#0c1729"/>
          <path d="M104 10 L110 6 L117 11 L112 12 Z M264 14 L270 10 L277 15 L271 16 Z" fill="#9fb0c8"/>
          <path d="M0 58 Q100 42 200 54 T400 50 V160 H0 Z" fill="#24324a"/>
          {[[24, 60, 0.5], [50, 57, 0.7], [80, 56, 0.45], [300, 54, 0.6], [330, 56, 0.8], [362, 55, 0.5], [386, 58, 0.65]].map(([x, y, sc], i) => (
            <path key={i} transform={`translate(${x} ${y}) scale(${sc})`} d="M0 -50 L-14 -24 L-7 -24 L-20 0 L20 0 L7 -24 L14 -24 Z" fill="#06101c"/>
          ))}
          <path d="M0 96 Q120 80 240 92 T400 88 V160 H0 Z" fill="#3a4d6c"/>
          <path d="M0 128 Q140 114 260 124 T400 122 V160 H0 Z" fill="#4a5f80"/>
        </svg>
        <div ref={fox} style={{ position:"absolute", bottom:"20%", left:"-20%", width:"clamp(72px, 20vw, 120px)", transform:"translateX(-50%)" }}><Fox/></div>
        <div ref={refl} style={{ position:"absolute", inset:0, opacity:0, mixBlendMode:"screen",
          background:"radial-gradient(ellipse at 50% 0%, rgba(80,255,170,.6), transparent 70%)" }}/>
        <div ref={tint} style={{ position:"absolute", inset:0, opacity:0, mixBlendMode:"screen",
          background:"linear-gradient(rgba(255,196,170,.55), rgba(233,213,255,.45))" }}/>
      </div>
      <Title color="#ecfeff" sub="Laponie, quelque part. La nuit est claire." style={{ marginTop:4 }}>Ciel polaire</Title>
      <div key={cap} style={{ position:"relative", zIndex:2, marginTop:10, maxWidth:340, textAlign:"center", fontSize:14, fontStyle:"italic",
        color:"#d1fae5", textShadow:"0 1px 8px rgba(0,0,0,.6)", animation:"hk-fade 1.4s ease-out both" }}>{POL_SAYS[cap]}</div>
      <Hint won={won} color="rgba(209,250,229,.85)">Touche le ciel : l'aurore te répond.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------- export */

export const PAGES = {
  "feu-de-camp": FeuDeCamp,
  "cinema": Cinema,
  "planetarium": Planetarium,
  "timelapse": Timelapse,
  "orchestre": Orchestre,
  "vinyle": Vinyle,
  "ascii": Ascii,
  "ciel-polaire": CielPolaire,
};
