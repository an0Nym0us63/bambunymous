import React, { useCallback, useEffect, useRef, useState } from "react";
import { Stage, Title, useWin, useLoop, useKeys, Btn, rand, pick } from "./kit";

// L'arcade des pages cachees (22/10/2026) : douze petits jeux plein cadre sur
// le theme de l'impression 3D. Le secret de chaque page tombe a la reussite du
// defi (win), une seule fois ; on peut continuer a jouer ensuite.
// Toutes les scenes sont dessinees au canvas 2D en coordonnees logiques, mises
// a l'echelle de la largeur disponible et nettes en haute densite.

const TAU = Math.PI * 2;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const FIL = ["#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#ec4899"];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const hsh = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ------------------------------------------------------------ outils dessin */

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
/** Eclaircit (k > 0) ou assombrit (k < 0) une couleur hexa. */
function shade(hex, k) {
  const f = v => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  const [r, g, b] = rgb(hex);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function hexA(hex, a) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function circle(c, x, y, r, fill) {
  c.beginPath(); c.arc(x, y, Math.max(0, r), 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
}
function txt(c, s, x, y, size, color, o = {}) {
  c.font = `${o.weight || 800} ${size}px ${FONT}`;
  c.textAlign = o.align || "center";
  c.textBaseline = o.base || "middle";
  if (o.stroke) {
    c.lineJoin = "round"; c.lineWidth = o.stroke; c.strokeStyle = o.strokeColor || "rgba(0,0,0,.55)";
    c.strokeText(s, x, y);
  }
  c.fillStyle = color;
  c.fillText(s, x, y);
}
/** Ciel en degrade vertical, deborde un peu pour la secousse. */
function sky(c, W, H, stops) {
  const g = c.createLinearGradient(0, 0, 0, H);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  c.fillStyle = g;
  c.fillRect(-30, -30, W + 60, H + 60);
}

/** Une bobine vue de face (flasque, filament enroule, moyeu). */
function spoolFront(c, x, y, r, col, spin = 0) {
  c.save();
  c.translate(x, y);
  const gf = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  gf.addColorStop(0, "#5b6472"); gf.addColorStop(1, "#1f2530");
  circle(c, 0, 0, r, gf);
  const gc = c.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r * 0.86);
  gc.addColorStop(0, shade(col, 0.35)); gc.addColorStop(1, shade(col, -0.3));
  circle(c, 0, 0, r * 0.84, gc);
  c.strokeStyle = "rgba(0,0,0,.14)";
  c.lineWidth = Math.max(0.6, r * 0.03);
  c.beginPath();
  for (let k = 0.5; k < 0.84; k += 0.08) { c.moveTo(r * k, 0); c.arc(0, 0, r * k, 0, TAU); }
  c.stroke();
  circle(c, 0, 0, r * 0.42, "#d6d9de");
  circle(c, 0, 0, r * 0.16, "#2f3640");
  c.rotate(spin);
  c.fillStyle = "#8a919c";
  for (let i = 0; i < 3; i++) circle(c, Math.cos(i * TAU / 3) * r * 0.29, Math.sin(i * TAU / 3) * r * 0.29, r * 0.07, "#8a919c");
  c.rotate(-spin);
  c.fillStyle = "rgba(255,255,255,.22)";
  c.beginPath(); c.ellipse(-r * 0.35, -r * 0.45, r * 0.32, r * 0.14, -0.6, 0, TAU); c.fill();
  c.restore();
}

/* -------------------------------------------------------------- particules */

function burst(list, x, y, n, colors, sp = 160, o = {}) {
  for (let i = 0; i < n; i++) {
    const an = o.ang != null ? o.ang + rand(-(o.spread || 0.5), o.spread || 0.5) : rand(0, TAU);
    const v = rand(0.35, 1) * sp;
    const life = rand(0.55, 1) * (o.life || 0.8);
    list.push({ x: x + rand(-(o.jx || 0), o.jx || 0), y, vx: Math.cos(an) * v, vy: Math.sin(an) * v - (o.up || 0),
      life, max: life, r: rand(1.5, 3.2) * (o.size || 1), c: pick(colors), g: o.g != null ? o.g : 320,
      drag: o.drag || 0.985, kind: o.kind || "dot", rot: rand(0, TAU), vr: rand(-8, 8) });
  }
}
function floatText(list, x, y, s, c, size = 18) {
  list.push({ x, y, vx: 0, vy: -48, life: 0.95, max: 0.95, g: 0, drag: 1, kind: "text", s, c, r: size, rot: 0, vr: 0 });
}
function stepParts(list, dt) {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life -= dt;
    if (p.life <= 0) { list.splice(i, 1); continue; }
    const d = Math.pow(p.drag, dt * 60);
    p.vx *= d;
    p.vy = p.vy * d + p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
  }
}
function drawParts(c, list) {
  for (const p of list) {
    const al = clamp(p.life / p.max, 0, 1);
    c.globalAlpha = al;
    if (p.kind === "text") { txt(c, p.s, p.x, p.y, p.r, p.c, { stroke: 4 }); continue; }
    c.fillStyle = p.c;
    if (p.kind === "spark") {
      c.globalAlpha = al * (0.55 + 0.45 * Math.sin(p.life * 40 + p.rot * 3));
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
      const r = p.r * 1.7;
      c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.42, 0); c.lineTo(0, r); c.lineTo(-r * 0.42, 0); c.closePath(); c.fill();
      c.restore();
    } else if (p.kind === "smoke") {
      c.globalAlpha = al * 0.45;
      circle(c, p.x, p.y, p.r * (1 + (1 - al) * 3), p.c);
    } else {
      circle(c, p.x, p.y, p.r * (0.4 + al * 0.6), p.c);
    }
  }
  c.globalAlpha = 1;
}
/** Secousse d'ecran : decale le dessin, s'amortit toute seule. */
function shakeIt(c, s, dt) {
  if (s.shake > 0) {
    c.translate(rand(-s.shake, s.shake), rand(-s.shake, s.shake));
    s.shake = Math.max(0, s.shake - dt * 28);
  }
}

/* ------------------------------------------------------------------- crochets */

/** Canvas a taille logique W x H, adapte a la largeur (max 720) et au dpr. */
function useCanvas(W, H) {
  const box = useRef(null);
  const cv = useRef(null);
  const sc = useRef(1);
  const [size, setSize] = useState({ w: W, h: H });
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const fit = () => {
      const maxH = Math.max(220, window.innerHeight - 250);
      const cw = Math.floor(Math.min(el.clientWidth || W, 720, maxH * W / H));
      const ch = Math.floor(cw * H / W);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const c = cv.current;
      if (c) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
      sc.current = (cw / W) * dpr;
      setSize(s => (s.w === cw && s.h === ch ? s : { w: cw, h: ch }));
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", fit);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [W, H]);
  const ctx = useCallback(() => {
    const c = cv.current;
    if (!c) return null;
    const g = c.getContext("2d");
    g.setTransform(sc.current, 0, 0, sc.current, 0, 0);
    return g;
  }, []);
  const at = useCallback(e => {
    const r = cv.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }, [W, H]);
  return { box, cv, size, ctx, at };
}

/** Appui de touche (sans repetition), ecouteur retire au demontage. */
function useKeyPress(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = e => {
      if (e.repeat) return;
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
      ref.current(e);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
}

/** Etat commun d'un jeu : phase (menu, play, over), score, record, message. */
function useArcade(slug, goal) {
  const [won, win] = useWin(slug);
  const [phase, setPhase] = useState("menu");
  const [hud, setHud] = useState({ score: 0, best: 0, extra: "" });
  const [msg, setMsg] = useState({ head: "", text: "" });
  const ph = useRef("menu");
  const last = useRef(null);
  const lastX = useRef(null);
  const overAt = useRef(0);
  const score = useCallback(n => {
    if (n === last.current) return;
    last.current = n;
    setHud(h => ({ ...h, score: n, best: Math.max(h.best, n) }));
    if (goal != null && n >= goal && ph.current === "play") win();
  }, [goal, win]);
  const extra = useCallback(x => {
    if (x === lastX.current) return;
    lastX.current = x;
    setHud(h => ({ ...h, extra: x }));
  }, []);
  const go = useCallback(p => {
    ph.current = p;
    if (p === "over") overAt.current = performance.now();
    setPhase(p);
  }, []);
  const end = useCallback((text, head = "Partie terminée") => { setMsg({ head, text }); go("over"); }, [go]);
  return { won, win, phase, ph, go, end, msg, hud, score, extra, overAt };
}

/** Viseur au clavier pour les jeux a toucher (fleches + espace). */
function aimStep(s, keys, dt, W, H) {
  const k = keys.current;
  let dx = 0, dy = 0;
  if (k.has("ArrowLeft")) dx -= 1;
  if (k.has("ArrowRight")) dx += 1;
  if (k.has("ArrowUp")) dy -= 1;
  if (k.has("ArrowDown")) dy += 1;
  if (!dx && !dy) return;
  if (!s.aim) s.aim = { x: W / 2, y: H / 2 };
  s.aim.x = clamp(s.aim.x + dx * 290 * dt, 12, W - 12);
  s.aim.y = clamp(s.aim.y + dy * 290 * dt, 40, H - 12);
}
function drawAim(c, s, t, col = "#fff") {
  if (!s.aim) return;
  const { x, y } = s.aim, r = 14 + Math.sin(t * 6) * 1.5;
  c.save();
  c.strokeStyle = col; c.lineWidth = 2; c.globalAlpha = 0.9;
  c.shadowColor = "rgba(0,0,0,.6)"; c.shadowBlur = 4;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
  c.beginPath();
  c.moveTo(x - r - 6, y); c.lineTo(x - r + 5, y);
  c.moveTo(x + r - 5, y); c.lineTo(x + r + 6, y);
  c.moveTo(x, y - r - 6); c.lineTo(x, y - r + 5);
  c.moveTo(x, y + r - 5); c.lineTo(x, y + r + 6);
  c.stroke();
  c.restore();
}

/* ------------------------------------------------------------------- cadre */

const ARC_CSS = `
@keyframes arcade-fade { from { opacity:0; transform:scale(.97) } to { opacity:1; transform:none } }
@keyframes arcade-glow { 0%,100% { box-shadow:0 4px 0 rgba(0,0,0,.25), 0 0 0 0 rgba(255,255,255,.0) }
                         50% { box-shadow:0 4px 0 rgba(0,0,0,.25), 0 0 0 6px rgba(255,255,255,.18) } }
`;

function Chip({ children, dim }) {
  return (
    <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(10,8,20,.5)", color: "#fff",
      opacity: dim ? 0.85 : 1, backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", whiteSpace: "nowrap",
      boxShadow: "0 2px 8px rgba(0,0,0,.25)" }}>{children}</span>
  );
}

/**
 * Le cadre d'un jeu : canvas, bandeau de score, ecran d'accueil et de fin.
 * Espace ou Entree relance depuis l'accueil ou la fin.
 */
function Shell({ a, cvs, title, emoji, rule, hint, goal, accent = "#f59e0b", onStart, ev, pad,
  hudLeft, hudRight, summary }) {
  const startRef = useRef(onStart);
  startRef.current = onStart;
  useKeyPress(e => {
    if (a.ph.current === "play") return;
    if ((e.key === " " || e.key === "Enter") && performance.now() - a.overAt.current > 600) {
      e.preventDefault();
      e.stopImmediatePropagation();
      startRef.current();
    }
  });
  const { phase, hud, msg } = a;
  const compact = cvs.size.h < 320;
  const left = hudLeft != null ? hudLeft : `${emoji} ${hud.score}${goal ? ` / ${goal}` : ""}`;
  const right = hudRight != null ? hudRight : `Record ${hud.best}`;
  return (
    <div ref={cvs.box} style={{ width: "100%", maxWidth: 720, position: "relative", zIndex: 1 }}>
      <style>{ARC_CSS}</style>
      <div style={{ position: "relative", width: cvs.size.w, height: cvs.size.h, margin: "0 auto", borderRadius: 16,
        overflow: "hidden", background: "#000",
        boxShadow: "0 22px 50px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.12)" }}>
        <canvas ref={cvs.cv} {...ev}
          style={{ display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "pointer" }}/>
        {phase !== "menu" && (
          <div style={{ position: "absolute", top: 8, left: 8, right: 8, display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 6, pointerEvents: "none", fontFamily: FONT, fontWeight: 800,
            fontSize: compact ? 11.5 : 13 }}>
            <Chip>{left}</Chip>
            {hud.extra ? <Chip>{hud.extra}</Chip> : null}
            <Chip dim>{right}</Chip>
          </div>
        )}
        {phase !== "play" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: compact ? 6 : 12, padding: compact ? "10px 14px" : "18px 16px", textAlign: "center",
            color: "#fff", fontFamily: FONT, overflow: "auto",
            background: "radial-gradient(ellipse at 50% 45%, rgba(12,8,24,.42), rgba(12,8,24,.8))",
            animation: "arcade-fade .4s ease both" }}>
            {!compact && (
              <div style={{ fontSize: "clamp(36px, 10vw, 56px)", animation: "hk-float 2.6s ease-in-out infinite",
                filter: "drop-shadow(0 6px 14px rgba(0,0,0,.45))" }}>{emoji}</div>
            )}
            {compact ? (
              <div style={{ fontSize: 22, fontWeight: 900, textShadow: "0 2px 12px rgba(0,0,0,.4)" }}>
                {emoji} {phase === "menu" ? title : msg.head}
              </div>
            ) : (
              <Title color="#fff" sub={phase === "menu" ? rule : null}>{phase === "menu" ? title : msg.head}</Title>
            )}
            {compact && phase === "menu" && <p style={{ margin: 0, fontSize: 13, opacity: 0.85, maxWidth: 420 }}>{rule}</p>}
            {phase === "over" && <p style={{ margin: 0, fontSize: compact ? 13 : 15, opacity: 0.92, maxWidth: 420 }}>{msg.text}</p>}
            {phase === "over" && (
              <p style={{ margin: 0, fontWeight: 800, color: accent, fontSize: compact ? 13 : 15 }}>
                {summary != null ? summary : `Score ${hud.score} · Record ${hud.best}`}
              </p>
            )}
            {phase === "menu" && hud.best > 0 && (
              <p style={{ margin: 0, fontWeight: 700, opacity: 0.8, fontSize: 13 }}>Record de la session : {hud.best}</p>
            )}
            <Btn color={accent} onClick={e => { e.stopPropagation(); onStart(); }}
              style={{ fontSize: compact ? 15 : 17, padding: compact ? "9px 22px" : "12px 28px",
                animation: "arcade-glow 1.8s ease-in-out infinite" }}>
              {phase === "menu" ? "▶ Jouer" : "↻ Rejouer"}
            </Btn>
            {hint && <p style={{ margin: 0, fontSize: 11.5, opacity: 0.62 }}>{hint}</p>}
          </div>
        )}
      </div>
      {pad}
    </div>
  );
}

/** Boutons tactiles maintenus (gauche, droite, saut...) : ecrit dans vk. */
function Pad({ vk, buttons, onDown }) {
  const set = (k, v) => { vk.current[k] = v; };
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 12 }}>
      {buttons.map(b => (
        <button key={b.k} aria-label={b.aria}
          onPointerDown={e => {
            e.preventDefault();
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture refusee */ }
            set(b.k, true);
            if (onDown) onDown(b.k);
          }}
          onPointerUp={() => set(b.k, false)} onPointerCancel={() => set(b.k, false)}
          onLostPointerCapture={() => set(b.k, false)} onContextMenu={e => e.preventDefault()}
          style={{ width: b.wide ? 96 : 64, height: 56, borderRadius: 16, border: "1px solid rgba(255,255,255,.25)",
            background: b.color || "rgba(255,255,255,.14)", color: "#fff", fontSize: 24, fontWeight: 900,
            touchAction: "none", cursor: "pointer", boxShadow: "0 4px 0 rgba(0,0,0,.3)", fontFamily: FONT,
            backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", WebkitTapHighlightColor: "transparent" }}>
          {b.label}
        </button>
      ))}
    </div>
  );
}

/* ======================================================= 1. buse volante */

function drawNozzleHero(c, x, y, rot, t, flap, drip) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  // filament qui entre par le haut, en queue
  c.strokeStyle = "#22c55e"; c.lineWidth = 4; c.lineCap = "round";
  c.beginPath(); c.moveTo(0, -18);
  c.bezierCurveTo(-3, -30, -15, -31, -24, -25 + Math.sin(t * 7) * 3);
  c.stroke();
  // ailes (deux petits ventilateurs)
  const wa = flap > 0 ? Math.sin(t * 46) * 0.9 : Math.sin(t * 7) * 0.25;
  for (const sd of [-1, 1]) {
    c.save();
    c.translate(sd * 13, -6);
    c.rotate(sd * (-0.45 + wa));
    c.fillStyle = "rgba(255,255,255,.92)";
    c.beginPath(); c.ellipse(sd * 11, 0, 12, 6, 0, 0, TAU); c.fill();
    c.strokeStyle = "#94a3b8"; c.lineWidth = 1.2; c.stroke();
    c.beginPath(); c.moveTo(sd * 3, 0); c.lineTo(sd * 19, -1); c.moveTo(sd * 5, 2); c.lineTo(sd * 16, 4); c.stroke();
    c.restore();
  }
  // radiateur
  for (let i = 0; i < 4; i++) { rr(c, -10, -19 + i * 4, 20, 2.6, 1); c.fillStyle = i % 2 ? "#cbd5e1" : "#e2e8f0"; c.fill(); }
  // bloc chauffant en chaussette silicone
  const gb = c.createLinearGradient(-15, -5, 15, 15);
  gb.addColorStop(0, "#fdba74"); gb.addColorStop(0.5, "#f97316"); gb.addColorStop(1, "#c2410c");
  rr(c, -15, -5, 30, 20, 6); c.fillStyle = gb; c.fill();
  c.fillStyle = "rgba(255,255,255,.35)"; rr(c, -11, -3, 12, 4, 2); c.fill();
  // yeux
  for (const sd of [-1, 1]) {
    circle(c, sd * 6 + 2, 4, 4.3, "#fff");
    circle(c, sd * 6 + 3.5, 4.6, 2.1, "#1f2937");
    circle(c, sd * 6 + 4.2, 3.8, 0.7, "#fff");
  }
  // joues
  c.fillStyle = "rgba(244,63,94,.35)";
  circle(c, -9, 10, 2.4, "rgba(244,63,94,.35)"); circle(c, 13, 10, 2.4, "rgba(244,63,94,.35)");
  // buse laiton
  const gn = c.createLinearGradient(-7, 0, 7, 0);
  gn.addColorStop(0, "#a16207"); gn.addColorStop(0.45, "#fde68a"); gn.addColorStop(1, "#a16207");
  c.beginPath(); c.moveTo(-7, 15); c.lineTo(7, 15); c.lineTo(2.5, 24); c.lineTo(-2.5, 24); c.closePath();
  c.fillStyle = gn; c.fill();
  // goutte de filament
  circle(c, 0, 25 + drip * 4, 1.8 + drip * 2.2, "#22c55e");
  circle(c, -0.6, 24.4 + drip * 4, 0.7 + drip * 0.6, "rgba(255,255,255,.6)");
  c.restore();
}

function drawSpoolColumn(c, x, w, edge, dir, limit, seed) {
  // pile de bobines posees a plat, depuis le bord du passage vers limit
  const uh = 30;
  const gf = c.createLinearGradient(x, 0, x + w, 0);
  gf.addColorStop(0, "#1f2430"); gf.addColorStop(0.4, "#5c6575"); gf.addColorStop(1, "#151922");
  for (let k = 0; k < 40; k++) {
    const top = dir < 0 ? edge - (k + 1) * uh : edge + k * uh;
    if (dir < 0 && top + uh < limit) break;
    if (dir > 0 && top > limit) break;
    const col = FIL[(seed + k * 3) % FIL.length];
    const g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, shade(col, -0.5)); g.addColorStop(0.32, shade(col, 0.28));
    g.addColorStop(0.6, col); g.addColorStop(1, shade(col, -0.55));
    c.fillStyle = g;
    c.fillRect(x + 4, top + 4, w - 8, uh - 8);
    c.strokeStyle = "rgba(0,0,0,.13)"; c.lineWidth = 1;
    c.beginPath();
    for (let yy = top + 7; yy < top + uh - 5; yy += 3) { c.moveTo(x + 4, yy); c.lineTo(x + w - 4, yy); }
    c.stroke();
    c.fillStyle = gf;
    rr(c, x - 3, top, w + 6, 5, 2); c.fill();
    rr(c, x - 3, top + uh - 5, w + 6, 5, 2); c.fill();
  }
  // bord du passage souligne
  c.fillStyle = "rgba(255,255,255,.25)";
  c.fillRect(x - 3, dir < 0 ? edge - 5 : edge, w + 6, 1.5);
}

function drawWorkshop(c, W, H, ground, scroll, t) {
  sky(c, W, H, ["#ffcf8f", "#ffa274", "#e86f7a"]);
  // soleil couchant par la verriere
  const sg = c.createRadialGradient(W * 0.75, 120, 5, W * 0.75, 120, 160);
  sg.addColorStop(0, "rgba(255,244,214,.9)"); sg.addColorStop(0.25, "rgba(255,214,150,.35)"); sg.addColorStop(1, "rgba(255,214,150,0)");
  c.fillStyle = sg; c.fillRect(0, 0, W, H);
  // etageres lointaines (parallaxe lente)
  const b1 = scroll * 0.22, first = Math.floor(b1 / 170);
  for (let j = first; j < first + 4; j++) {
    const x = j * 170 - b1;
    c.fillStyle = "rgba(120,53,40,.35)";
    for (const sy of [128, 238]) {
      c.fillRect(x, sy, 130, 6);
      for (let k = 0; k < 3; k++) {
        const h = hsh(j * 7 + k + sy);
        if (h < 0.18) continue;
        c.globalAlpha = 0.55;
        spoolFront(c, x + 22 + k * 42, sy - 15, 14, FIL[Math.floor(h * 8) % 8], 0);
        c.globalAlpha = 1;
      }
    }
    c.fillStyle = "rgba(120,53,40,.3)";
    c.fillRect(x + 2, 90, 4, 160); c.fillRect(x + 124, 90, 4, 160);
  }
  // imprimantes en silhouette (parallaxe moyenne)
  const b2 = scroll * 0.5, f2 = Math.floor(b2 / 150);
  for (let j = f2; j < f2 + 4; j++) {
    const x = j * 150 - b2 + 30, h = 70 + hsh(j) * 30, y = ground - h;
    c.fillStyle = "rgba(76,29,49,.42)";
    rr(c, x, y, 74, h, 6); c.fill();
    const glow = 0.5 + 0.5 * Math.sin(t * 2 + j);
    c.fillStyle = `rgba(255,200,120,${0.25 + glow * 0.2})`;
    rr(c, x + 8, y + 10, 58, h - 28, 4); c.fill();
    c.fillStyle = "rgba(76,29,49,.5)";
    c.fillRect(x + 16, y + h - 26, 42, 4);
  }
  // etabli
  const gw = c.createLinearGradient(0, ground, 0, H);
  gw.addColorStop(0, "#b7703f"); gw.addColorStop(1, "#6b3a1f");
  c.fillStyle = gw; c.fillRect(-30, ground, W + 60, H - ground + 30);
  c.fillStyle = "#e0a26b"; c.fillRect(-30, ground, W + 60, 4);
  c.strokeStyle = "rgba(60,25,10,.35)"; c.lineWidth = 1.2;
  c.beginPath();
  const off = scroll % 60;
  for (let x = -off; x < W + 60; x += 60) { c.moveTo(x, ground + 4); c.lineTo(x - 10, H); }
  c.stroke();
}

function BuseVolante() {
  const W = 360, H = 480, GROUND = 440, PW = 56, GAP = 152, HX = 96, SPEED = 132;
  const a = useArcade("buse-volante", 10);
  const cvs = useCanvas(W, H);
  const fresh = () => ({ y: 220, vy: 0, rot: 0, t: 0, scroll: 0, pipes: [], parts: [], next: 0, shake: 0,
    score: 0, alive: true, flap: 0, drip: 0, seed: 0 });
  const S = useRef(null);
  if (!S.current) S.current = fresh();

  const start = () => { S.current = fresh(); S.current.vy = -300; a.score(0); a.go("play"); };
  const flap = () => {
    const s = S.current;
    if (a.ph.current !== "play" || !s.alive) return;
    s.vy = -322; s.flap = 0.2;
    burst(s.parts, HX - 4, s.y + 6, 5, ["#fff", "#e2e8f0", "#fde68a"], 70, { g: 120, life: 0.45, size: 0.9, ang: Math.PI * 0.6, spread: 0.6 });
  };
  const die = s => {
    s.alive = false; s.shake = 9; s.vy = -160;
    burst(s.parts, HX, s.y, 26, ["#f97316", "#fde68a", "#22c55e", "#fff"], 220, { life: 0.9 });
    const m = s.score >= 10 ? "Dix colonnes et plus : la buse a des ailes !"
      : pick(["La buse s'est cognée dans une bobine. Pense au Z-hop !", "Collision tête-bobine, impression annulée.",
        "Crash plateau : recalibrage nécessaire.", "Trop d'élan, pas assez de rétraction."]);
    a.end(m, s.score >= 10 ? "Bravo !" : "Aïe !");
  };
  useKeyPress(e => { if (e.key === " " || e.key === "ArrowUp" || e.key === "z" || e.key === "w") flap(); });

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    const ph = a.ph.current;
    s.t += dt;
    s.flap = Math.max(0, s.flap - dt);
    if (ph === "menu") {
      s.scroll += SPEED * dt * 0.6;
      s.y = 220 + Math.sin(s.t * 3) * 12; s.rot = Math.sin(s.t * 3) * 0.08;
    } else if (ph === "play" && s.alive) {
      s.scroll += SPEED * dt;
      s.vy += 1120 * dt; s.y += s.vy * dt;
      s.next -= SPEED * dt;
      if (s.next <= 0) {
        s.seed += 1;
        s.pipes.push({ x: W + 10, gy: rand(130, GROUND - 120), passed: false, seed: Math.floor(rand(0, 8)) });
        s.next = 196;
      }
      for (const p of s.pipes) {
        p.x -= SPEED * dt;
        if (!p.passed && p.x + PW < HX - 12) {
          p.passed = true; s.score += 1; a.score(s.score);
          burst(s.parts, HX, s.y, 10, ["#fde68a", "#fff", "#facc15"], 120, { kind: "spark", g: 0, life: 0.7 });
          if (s.score === 10) floatText(s.parts, W / 2, 120, "10 colonnes !", "#fde68a", 26);
        }
      }
      s.pipes = s.pipes.filter(p => p.x > -PW - 20);
      // goutte qui tombe de temps en temps
      s.drip += dt * 1.4;
      if (s.drip >= 1) { s.drip = 0; s.parts.push({ x: HX, y: s.y + 28, vx: -SPEED, vy: 40, life: 1.2, max: 1.2, r: 2.6, c: "#22c55e", g: 600, drag: 1, kind: "dot", rot: 0, vr: 0 }); }
      if (s.y < 14) { s.y = 14; s.vy = 0; }
      if (s.y + 22 > GROUND) die(s);
      for (const p of s.pipes) {
        if (HX + 14 > p.x - 2 && HX - 14 < p.x + PW + 2 && (s.y - 12 < p.gy - GAP / 2 || s.y + 20 > p.gy + GAP / 2)) { die(s); break; }
      }
    } else {
      // chute apres le choc
      s.vy += 1200 * dt; s.y = Math.min(GROUND - 22, s.y + s.vy * dt);
    }
    s.rot = ph === "menu" ? s.rot : clamp(s.vy / 650, -0.45, s.alive ? 0.9 : 1.6);
    stepParts(s.parts, dt);

    c.save();
    shakeIt(c, s, dt);
    drawWorkshop(c, W, H, GROUND, s.scroll, s.t);
    for (const p of s.pipes) {
      c.save();
      c.shadowColor = "rgba(0,0,0,.3)"; c.shadowBlur = 10; c.shadowOffsetX = 4;
      drawSpoolColumn(c, p.x, PW, p.gy - GAP / 2, -1, -10, p.seed);
      drawSpoolColumn(c, p.x, PW, p.gy + GAP / 2, 1, GROUND, p.seed + 4);
      c.restore();
    }
    // ombre du heros sur l'etabli
    c.fillStyle = "rgba(0,0,0,.18)";
    c.beginPath(); c.ellipse(HX, GROUND + 6, clamp(22 - (GROUND - s.y) / 25, 6, 20), 4, 0, 0, TAU); c.fill();
    drawNozzleHero(c, HX, s.y, s.rot, s.t, s.flap, s.drip);
    drawParts(c, s.parts);
    if (ph === "play" && s.alive && s.t < 1.4 && s.score === 0) txt(c, "Tape pour voler !", W / 2, 120, 20, "#fff", { stroke: 4 });
    c.restore();
  });

  return (
    <Stage bg="radial-gradient(ellipse at 50% 20%, #ffb07a 0%, #9a3b52 55%, #2a1028 100%)" won={a.won}>
      <Shell a={a} cvs={cvs} title="Buse volante" emoji="🪶" goal={10} accent="#f97316" onStart={start}
        rule="Fais voler la buse entre les piles de bobines. Passe 10 colonnes !"
        hint="Espace, ↑ ou tap pour battre des ailes"
        ev={{ onPointerDown: e => { e.preventDefault(); flap(); } }}/>
    </Stage>
  );
}

/* ======================================================== 2. super bambu */

function drawBuddy(c, x, y, face, t, run, air, hurt) {
  if (hurt && Math.floor(t * 14) % 2) return;
  c.save();
  c.translate(x + 9, y + 30);
  c.scale(face, 1);
  const ph = run ? Math.sin(t * 17) : 0;
  // jambes
  c.strokeStyle = "#7c2d12"; c.lineWidth = 4.2; c.lineCap = "round";
  c.beginPath();
  c.moveTo(-3, -9); c.lineTo(-3 + ph * 4, air ? -3 : 0);
  c.moveTo(3, -9); c.lineTo(3 - ph * 4, air ? -1 : 0);
  c.stroke();
  // corps en couches
  const gb = c.createLinearGradient(-8, -22, 8, -8);
  gb.addColorStop(0, "#fdba74"); gb.addColorStop(1, "#ea580c");
  rr(c, -8, -22, 16, 14, 4); c.fillStyle = gb; c.fill();
  c.strokeStyle = "rgba(124,45,18,.25)"; c.lineWidth = 0.8; c.beginPath();
  for (let yy = -20; yy < -9; yy += 2.2) { c.moveTo(-7, yy); c.lineTo(7, yy); }
  c.stroke();
  // bras
  c.strokeStyle = "#ea580c"; c.lineWidth = 3.4;
  c.beginPath(); c.moveTo(5, -18); c.lineTo(10, air ? -26 : -12 - ph * 3); c.stroke();
  c.beginPath(); c.moveTo(-5, -18); c.lineTo(-9, air ? -24 : -12 + ph * 3); c.stroke();
  // tete
  const gh = c.createRadialGradient(-2, -32, 1, 0, -29, 9);
  gh.addColorStop(0, "#fed7aa"); gh.addColorStop(1, "#f97316");
  circle(c, 0, -29, 8.2, gh);
  c.save(); c.beginPath(); c.arc(0, -29, 8.2, 0, TAU); c.clip();
  c.strokeStyle = "rgba(124,45,18,.18)"; c.lineWidth = 0.8; c.beginPath();
  for (let yy = -37; yy < -21; yy += 2.2) { c.moveTo(-9, yy); c.lineTo(9, yy); }
  c.stroke(); c.restore();
  // petite buse en chapeau
  c.fillStyle = "#facc15";
  c.beginPath(); c.moveTo(-3, -37); c.lineTo(3, -37); c.lineTo(1.4, -41); c.lineTo(-1.4, -41); c.closePath(); c.fill();
  // yeux
  circle(c, 2.5, -30, 2.4, "#fff"); circle(c, 6.4, -30, 2.2, "#fff");
  circle(c, 3.3, -29.6, 1.2, "#1f2937"); circle(c, 7, -29.6, 1.1, "#1f2937");
  c.strokeStyle = "#7c2d12"; c.lineWidth = 1; c.beginPath(); c.arc(4.5, -26, 2, 0.2, Math.PI - 0.2); c.stroke();
  c.restore();
}

function drawPlug(c, x, y, w, h, t, sq) {
  c.save();
  c.translate(x + w / 2, y + h);
  c.scale(1 + sq * 0.5, 1 - sq * 0.75);
  const st = sq > 0 ? 0 : Math.sin(t * 10) * 2.2;
  c.fillStyle = "#3f1d0b";
  c.beginPath(); c.ellipse(-6 + st, -1.5, 4.5, 2.5, 0, 0, TAU); c.ellipse(6 - st, -1.5, 4.5, 2.5, 0, 0, TAU); c.fill();
  const g = c.createRadialGradient(-4, -h * 0.75, 1, 0, -h / 2, w * 0.7);
  g.addColorStop(0, "#f87171"); g.addColorStop(1, "#7f1d1d");
  c.fillStyle = g;
  c.beginPath(); c.ellipse(0, -h / 2 - 1, w / 2, h / 2, 0, 0, TAU); c.fill();
  // spires emmelees
  c.strokeStyle = "rgba(255,210,210,.45)"; c.lineWidth = 1.1;
  c.beginPath();
  c.ellipse(-3, -h * 0.55, 6, 3, 0.6, 0, TAU);
  c.ellipse(3, -h * 0.4, 5, 2.4, -0.5, 0, TAU);
  c.stroke();
  // yeux faches
  for (const sd of [-1, 1]) {
    circle(c, sd * 4, -h * 0.6, 3, "#fff");
    circle(c, sd * 4 - 1, -h * 0.58, 1.5, "#111");
  }
  c.strokeStyle = "#111"; c.lineWidth = 1.6; c.beginPath();
  c.moveTo(-7, -h * 0.82); c.lineTo(-2, -h * 0.72); c.moveTo(7, -h * 0.82); c.lineTo(2, -h * 0.72); c.stroke();
  c.restore();
}

function drawCoin(c, x, y, t, r = 8) {
  const sx = Math.abs(Math.cos(t * 3.5)) * 0.85 + 0.15;
  c.save();
  c.translate(x, y);
  c.scale(sx, 1);
  const g = c.createRadialGradient(-2, -3, 1, 0, 0, r);
  g.addColorStop(0, "#fff7c2"); g.addColorStop(0.5, "#facc15"); g.addColorStop(1, "#b45309");
  circle(c, 0, 0, r, g);
  c.strokeStyle = "#a16207"; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, r * 0.68, 0, TAU); c.stroke();
  if (sx > 0.45) txt(c, "B", 0, 0.5, r * 1.05, "#a16207", { weight: 900 });
  c.restore();
}

function makeLevel(GY, T) {
  const solids = [], coins = [], foes = [];
  let x = 10 * T;
  solids.push({ x: -300, y: GY, w: 300 + x, h: 120, k: "g" });
  for (let i = 0; i < 3; i++) coins.push({ x: 150 + i * 26, y: GY - 22, got: false });
  while (x < 3600 || coins.length < 31) {
    const gap = pick([2, 2, 3, 3, 0]) * T;
    if (gap > 0) {
      // arc de pieces au-dessus du trou
      coins.push({ x: x + gap / 2 - 20, y: GY - 58, got: false }, { x: x + gap / 2, y: GY - 74, got: false },
        { x: x + gap / 2 + 20, y: GY - 58, got: false });
    }
    x += gap;
    const len = (6 + Math.floor(rand(0, 7))) * T;
    solids.push({ x, y: GY, w: len, h: 120, k: "g" });
    const kind = pick(["plat", "row", "plat", "stairs"]);
    if (kind === "plat") {
      const pw = 4 * T, px = x + len / 2 - pw / 2;
      solids.push({ x: px, y: GY - 82, w: pw, h: 16, k: "p" });
      for (let k = 0; k < 3; k++) coins.push({ x: px + 20 + k * 40, y: GY - 104, got: false });
    } else if (kind === "stairs") {
      solids.push({ x: x + T, y: GY - 34, w: 2 * T, h: 34, k: "b" });
      solids.push({ x: x + 3 * T, y: GY - 68, w: 2 * T, h: 68, k: "b" });
      coins.push({ x: x + 4 * T, y: GY - 92, got: false }, { x: x + 2 * T, y: GY - 58, got: false });
    } else {
      for (let k = 0; k < 3; k++) coins.push({ x: x + len / 2 - 26 + k * 26, y: GY - 22, got: false });
    }
    if (len >= 8 * T && kind !== "stairs") {
      foes.push({ x: x + len * 0.65, y: GY - 20, w: 22, h: 20, vx: -42, min: x + 6, max: x + len - 28, sq: 0, dead: false });
    }
    x += len;
  }
  const end = x;
  solids.push({ x: end, y: GY, w: 8 * T, h: 120, k: "g" });
  return { solids, coins, foes, flagX: end + 3 * T, end: end + 8 * T };
}

function SuperBambu() {
  const W = 480, H = 300, GY = 250, T = 30, PW = 18, PH = 30, GOAL = 20;
  const a = useArcade("super-bambu", GOAL);
  const cvs = useCanvas(W, H);
  const keys = useKeys();
  const vk = useRef({});
  const fresh = () => {
    const lv = makeLevel(GY, T);
    return { ...lv, p: { x: 60, y: GY - PH, vx: 0, vy: 0, ground: false, face: 1, coyote: 0, buf: 0, inv: 0, safe: { x: 60, y: GY - PH } },
      cam: 0, t: 0, parts: [], shake: 0, got: 0, lives: 3, done: false };
  };
  const S = useRef(null);
  if (!S.current) S.current = fresh();

  const start = () => { S.current = fresh(); a.score(0); a.extra("❤️❤️❤️"); a.go("play"); };
  const jump = () => { S.current.p.buf = 0.14; };
  useKeyPress(e => { if (["ArrowUp", " ", "z", "w"].includes(e.key)) jump(); });

  const hurt = (s, fell) => {
    s.lives -= 1; s.shake = 8;
    a.extra("❤️".repeat(Math.max(0, s.lives)) + "🖤".repeat(3 - Math.max(0, s.lives)));
    const p = s.p;
    burst(s.parts, p.x + 9, Math.min(p.y + 15, H - 10), 14, ["#f97316", "#fde68a", "#fff"], 160);
    if (s.lives <= 0) {
      s.done = true;
      a.end(s.got >= GOAL ? `${s.got} pièces ramassées, belle course !` : `Plus de vies… ${s.got} pièce${s.got > 1 ? "s" : ""} sur ${GOAL}.`,
        s.got >= GOAL ? "Bravo !" : "Game over");
      return;
    }
    p.inv = 1.6;
    if (fell) { p.x = p.safe.x; p.y = p.safe.y - 40; p.vx = 0; p.vy = 0; }
    else { p.vy = -300; }
  };

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    const ph = a.ph.current, p = s.p, k = keys.current, v = vk.current;
    s.t += dt;
    const live = ph === "play" && !s.done;
    if (live) {
      const left = k.has("ArrowLeft") || k.has("q") || k.has("a") || v.left;
      const right = k.has("ArrowRight") || k.has("d") || v.right;
      const held = k.has("ArrowUp") || k.has(" ") || k.has("z") || k.has("w") || v.jump;
      const ax = (right ? 1 : 0) - (left ? 1 : 0);
      if (ax) p.face = ax;
      const target = ax * 185, acc = (p.ground ? 1500 : 950) * dt;
      p.vx = p.vx < target ? Math.min(target, p.vx + acc) : Math.max(target, p.vx - acc);
      p.buf -= dt; p.coyote -= dt; p.inv = Math.max(0, p.inv - dt);
      if (p.buf > 0 && (p.ground || p.coyote > 0)) {
        p.vy = -545; p.buf = 0; p.coyote = 0; p.ground = false;
        burst(s.parts, p.x + 9, p.y + PH, 6, ["#fff", "#e5e7eb"], 60, { g: 0, life: 0.35, ang: Math.PI, spread: 1.2 });
      }
      p.vy += (held || p.vy > 0 ? 1450 : 2900) * dt;
      p.vy = Math.min(p.vy, 900);
      const hit = sd => sd.x < p.x + PW && sd.x + sd.w > p.x && sd.y < p.y + PH && sd.y + sd.h > p.y;
      p.x += p.vx * dt;
      for (const sd of s.solids) if (hit(sd)) { p.x = p.vx > 0 ? sd.x - PW : sd.x + sd.w; p.vx = 0; }
      p.x = clamp(p.x, 0, s.end - PW);
      const wasGround = p.ground;
      p.ground = false;
      p.y += p.vy * dt;
      for (const sd of s.solids) {
        if (!hit(sd)) continue;
        if (p.vy > 0) { p.y = sd.y - PH; p.vy = 0; p.ground = true; }
        else { p.y = sd.y + sd.h; p.vy = 0; }
      }
      if (p.ground) { p.coyote = 0.09; p.safe = { x: p.x, y: p.y }; }
      else if (wasGround) p.coyote = 0.09;
      if (p.y > H + 60) hurt(s, true);
      // pieces
      for (const cn of s.coins) {
        if (cn.got) continue;
        if (Math.abs(cn.x - (p.x + PW / 2)) < 16 && Math.abs(cn.y - (p.y + PH / 2)) < 22) {
          cn.got = true; s.got += 1; a.score(s.got);
          burst(s.parts, cn.x, cn.y, 9, ["#fde68a", "#facc15", "#fff"], 110, { kind: "spark", g: 60, life: 0.6 });
          if (s.got === GOAL) { floatText(s.parts, p.x + 9, p.y - 20, "20 pièces !", "#fde68a", 22); }
          else floatText(s.parts, cn.x, cn.y - 6, "+1", "#fde68a", 14);
        }
      }
      // bouchons
      for (const f of s.foes) {
        if (f.dead) { f.sq = Math.min(1, f.sq + dt * 4); continue; }
        f.x += f.vx * dt;
        if (f.x < f.min) { f.x = f.min; f.vx = Math.abs(f.vx); }
        if (f.x > f.max) { f.x = f.max; f.vx = -Math.abs(f.vx); }
        if (s.done) continue;
        const ov = f.x < p.x + PW && f.x + f.w > p.x && f.y < p.y + PH && f.y + f.h > p.y;
        if (!ov) continue;
        if (p.vy > 60 && p.y + PH - f.y < 16) {
          f.dead = true; p.vy = -380; s.shake = 3;
          burst(s.parts, f.x + f.w / 2, f.y + f.h / 2, 12, ["#f87171", "#7f1d1d", "#fde68a"], 150);
          floatText(s.parts, f.x + f.w / 2, f.y - 6, "Débouché !", "#fff", 13);
        } else if (p.inv <= 0) hurt(s, false);
      }
      if (!s.done && p.x > s.flagX) {
        s.done = true;
        burst(s.parts, s.flagX - s.cam, 120, 40, FIL, 200, { kind: "spark", life: 1.2 });
        a.end(s.got >= GOAL ? `Niveau terminé avec ${s.got} pièces. Champion du Benchy !`
          : `Arrivé, mais il manquait ${GOAL - s.got} pièce${GOAL - s.got > 1 ? "s" : ""}. Explore les plateformes !`,
        s.got >= GOAL ? "Niveau terminé !" : "Presque !");
      }
    }
    s.cam = lerp(s.cam, clamp(p.x - W * 0.38, 0, s.end - W), Math.min(1, dt * 8));
    stepParts(s.parts, dt);

    const cam = s.cam;
    c.save();
    shakeIt(c, s, dt);
    sky(c, W, H, ["#7cc8f5", "#bfe3f7", "#ffe1a8"]);
    // soleil
    const sg = c.createRadialGradient(W * 0.8, 60, 4, W * 0.8, 60, 70);
    sg.addColorStop(0, "#fff7d1"); sg.addColorStop(0.35, "rgba(255,236,170,.6)"); sg.addColorStop(1, "rgba(255,236,170,0)");
    c.fillStyle = sg; c.fillRect(0, 0, W, H);
    // nuages
    const cb = cam * 0.15 + s.t * 6, f0 = Math.floor(cb / 210);
    for (let j = f0; j < f0 + 4; j++) {
      const x = j * 210 - cb + 40, y = 40 + hsh(j) * 60, sz = 0.7 + hsh(j + 9) * 0.6;
      c.fillStyle = "rgba(255,255,255,.92)";
      c.beginPath();
      c.arc(x, y, 16 * sz, 0, TAU); c.arc(x + 18 * sz, y - 8 * sz, 20 * sz, 0, TAU); c.arc(x + 40 * sz, y, 15 * sz, 0, TAU);
      c.fill();
      c.fillRect(x, y, 40 * sz, 15 * sz);
    }
    // collines
    for (const [f, base, amp, col] of [[0.25, 185, 26, "#9bd3a5"], [0.5, 215, 20, "#5fb87a"]]) {
      c.fillStyle = col;
      c.beginPath(); c.moveTo(-30, H);
      for (let x = -30; x <= W + 30; x += 10) {
        const wx = x + cam * f;
        c.lineTo(x, base + Math.sin(wx * 0.011) * amp + Math.sin(wx * 0.027) * amp * 0.4);
      }
      c.lineTo(W + 30, H); c.closePath(); c.fill();
    }
    c.translate(-Math.round(cam), 0);
    // sol et plateformes imprimees
    for (const sd of s.solids) {
      if (sd.x + sd.w < cam - 20 || sd.x > cam + W + 20) continue;
      if (sd.k === "g") {
        const g = c.createLinearGradient(0, sd.y, 0, H);
        g.addColorStop(0, "#e8913f"); g.addColorStop(1, "#8c4a1c");
        c.fillStyle = g; c.fillRect(sd.x, sd.y, sd.w, H - sd.y + 10);
        c.strokeStyle = "rgba(80,30,5,.22)"; c.lineWidth = 1; c.beginPath();
        for (let yy = sd.y + 14; yy < H; yy += 5) { c.moveTo(sd.x, yy); c.lineTo(sd.x + sd.w, yy); }
        c.stroke();
        c.fillStyle = "#22c55e"; rr(c, sd.x - 2, sd.y - 3, sd.w + 4, 11, 4); c.fill();
        c.fillStyle = "#86efac"; c.fillRect(sd.x, sd.y - 2, sd.w, 2);
      } else {
        const col = sd.k === "p" ? "#8b5cf6" : "#14b8a6";
        const g = c.createLinearGradient(0, sd.y, 0, sd.y + sd.h);
        g.addColorStop(0, shade(col, 0.3)); g.addColorStop(1, shade(col, -0.35));
        rr(c, sd.x, sd.y, sd.w, sd.h, 4); c.fillStyle = g; c.fill();
        c.strokeStyle = "rgba(0,0,0,.16)"; c.lineWidth = 1; c.beginPath();
        for (let yy = sd.y + 3; yy < sd.y + sd.h - 1; yy += 3) { c.moveTo(sd.x + 2, yy); c.lineTo(sd.x + sd.w - 2, yy); }
        c.stroke();
        c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(sd.x + 3, sd.y + 1, sd.w - 6, 2);
      }
    }
    // drapeau d'arrivee
    const fx = s.flagX;
    c.fillStyle = "#e5e7eb"; c.fillRect(fx, GY - 130, 4, 130);
    circle(c, fx + 2, GY - 132, 5, "#facc15");
    const wave = Math.sin(s.t * 5) * 4;
    c.fillStyle = "#ef4444";
    c.beginPath(); c.moveTo(fx + 4, GY - 126); c.quadraticCurveTo(fx + 30, GY - 120 + wave, fx + 52, GY - 112);
    c.lineTo(fx + 4, GY - 96); c.closePath(); c.fill();
    txt(c, "🚤", fx + 22, GY - 111, 13, "#fff");
    for (const cn of s.coins) if (!cn.got && cn.x > cam - 20 && cn.x < cam + W + 20) drawCoin(c, cn.x, cn.y + Math.sin(s.t * 3 + cn.x) * 2, s.t + cn.x * 0.01);
    for (const f of s.foes) {
      if (f.dead && f.sq >= 1) continue;
      if (f.x < cam - 40 || f.x > cam + W + 40) continue;
      c.save(); if (f.vx > 0) { c.translate(f.x * 2 + f.w, 0); c.scale(-1, 1); }
      c.globalAlpha = f.dead ? 1 - f.sq * 0.6 : 1;
      drawPlug(c, f.x, f.y, f.w, f.h, s.t, f.sq);
      c.restore();
    }
    drawBuddy(c, p.x, p.y, p.face, s.t, Math.abs(p.vx) > 20 && p.ground, !p.ground, p.inv > 0);
    drawParts(c, s.parts);
    c.restore();
    if (ph === "play" && s.t < 2.5) txt(c, "Ramasse 20 pièces → drapeau", W / 2, 60, 16, "#fff", { stroke: 4 });
  });

  return (
    <Stage bg="linear-gradient(180deg, #3b82c4 0%, #1e3a5f 60%, #10213a 100%)" won={a.won}>
      <Shell a={a} cvs={cvs} title="Super Bambu" emoji="🪙" goal={GOAL} accent="#22c55e" onStart={start}
        rule="Cours, saute, écrase les bouchons de filament. Ramasse 20 pièces !"
        hint="← → pour courir, ↑ ou espace pour sauter (ou les boutons)"
        pad={<Pad vk={vk} onDown={k => { if (k === "jump") jump(); }}
          buttons={[{ k: "left", label: "◀", aria: "Gauche" }, { k: "right", label: "▶", aria: "Droite" },
            { k: "jump", label: "⤒", aria: "Sauter", wide: true, color: "rgba(34,197,94,.55)" }]}/>}/>
    </Stage>
  );
}

/* ============================================================== 3. serpent */

function Serpent() {
  const N = 18, C = 20, W = N * C, H = N * C, GOAL = 15;
  const a = useArcade("serpent", GOAL);
  const cvs = useCanvas(W, H);
  const place = s => {
    for (let k = 0; k < 500; k++) {
      const x = Math.floor(rand(0, N)), y = Math.floor(rand(1, N));
      if (!s.pos.some(p => p.x === x && p.y === y)) return { x, y, c: pick(FIL) };
    }
    return { x: 0, y: 1, c: FIL[0] };
  };
  const fresh = () => {
    const pos = [{ x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }];
    const s = { pos, prev: pos.map(p => ({ ...p })), cols: ["#f8f1e0", "#efe5cc", "#e4d7b8"], dir: { x: 1, y: 0 }, q: [],
      acc: 0, food: null, parts: [], shake: 0, t: 0, alive: true, sw: null, gulp: 0 };
    s.food = place(s);
    return s;
  };
  const S = useRef(null);
  if (!S.current) S.current = fresh();

  const start = () => { S.current = fresh(); a.score(3); a.go("play"); };
  const turn = (dx, dy) => {
    const s = S.current;
    if (a.ph.current !== "play" || !s.alive) return;
    const last = s.q.length ? s.q[s.q.length - 1] : s.dir;
    if ((dx === -last.x && dy === -last.y) || (dx === last.x && dy === last.y)) return;
    if (s.q.length < 3) s.q.push({ x: dx, y: dy });
  };
  useKeyPress(e => {
    const k = e.key;
    if (k === "ArrowLeft" || k === "q" || k === "a") turn(-1, 0);
    else if (k === "ArrowRight" || k === "d") turn(1, 0);
    else if (k === "ArrowUp" || k === "z" || k === "w") turn(0, -1);
    else if (k === "ArrowDown" || k === "s") turn(0, 1);
  });
  const die = (s, why) => {
    s.alive = false; s.shake = 8;
    s.pos.forEach((p, i) => burst(s.parts, p.x * C + C / 2, p.y * C + C / 2, 3, [s.cols[i]], 130));
    const n = s.pos.length;
    a.end(n >= GOAL ? `Longueur ${n} : un arc-en-ciel de filament !` : `${why} Longueur ${n} sur ${GOAL}.`, n >= GOAL ? "Bravo !" : "Emmêlé !");
  };
  const tick = s => {
    if (s.q.length) s.dir = s.q.shift();
    const h = s.pos[0], nx = h.x + s.dir.x, ny = h.y + s.dir.y;
    const grow = s.food && nx === s.food.x && ny === s.food.y;
    const body = grow ? s.pos : s.pos.slice(0, -1);
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) { die(s, "Sorti du plateau !"); return; }
    if (body.some(p => p.x === nx && p.y === ny)) { die(s, "Le filament s'est noué sur lui-même."); return; }
    const old = s.pos;
    s.pos = [{ x: nx, y: ny }, ...body];
    s.prev = s.pos.map((_, i) => ({ ...(i < old.length ? old[i] : old[old.length - 1]) }));
    if (grow) {
      s.cols.push(s.food.c);
      burst(s.parts, nx * C + C / 2, ny * C + C / 2, 12, [s.food.c, "#fff"], 120, { kind: "spark", g: 0, life: 0.6 });
      s.gulp = 1;
      a.score(s.pos.length);
      if (s.pos.length === GOAL) floatText(s.parts, W / 2, H / 2 - 40, "Longueur 15 !", "#fde68a", 26);
      else floatText(s.parts, nx * C + C / 2, ny * C - 4, "+1", s.food.c, 15);
      s.food = place(s);
    }
  };
  const ev = {
    onPointerDown: e => { e.preventDefault(); S.current.sw = cvs.at(e); },
    onPointerMove: e => {
      const s = S.current;
      if (!s.sw) return;
      const p = cvs.at(e), dx = p.x - s.sw.x, dy = p.y - s.sw.y;
      if (Math.hypot(dx, dy) > 20) {
        if (Math.abs(dx) > Math.abs(dy)) turn(Math.sign(dx), 0); else turn(0, Math.sign(dy));
        s.sw = p;
      }
    },
    onPointerUp: () => { S.current.sw = null; },
    onPointerCancel: () => { S.current.sw = null; },
  };

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    s.t += dt;
    s.gulp = Math.max(0, s.gulp - dt * 3);
    const play = a.ph.current === "play" && s.alive;
    const iv = Math.max(0.085, 0.145 - s.pos.length * 0.002);
    if (play) {
      s.acc += dt;
      while (s.acc >= iv && s.alive) { s.acc -= iv; tick(s); }
    } else if (a.ph.current === "menu") {
      // petite danse sur l'accueil
      s.acc += dt;
      if (s.acc > 0.18) {
        s.acc = 0;
        const h = s.pos[0];
        let d = s.dir;
        if (h.x + d.x > 13 || h.x + d.x < 4 || h.y + d.y > 13 || h.y + d.y < 4) d = { x: -d.y, y: d.x };
        s.dir = d;
        const old = s.pos;
        s.pos = [{ x: h.x + d.x, y: h.y + d.y }, ...old.slice(0, -1)];
        s.prev = old.map(p => ({ ...p }));
      }
    }
    stepParts(s.parts, dt);
    const f = a.ph.current === "menu" ? clamp(s.acc / 0.18, 0, 1) : play ? clamp(s.acc / iv, 0, 1) : 1;

    c.save();
    shakeIt(c, s, dt);
    // plateau PEI texture
    const gp = c.createLinearGradient(0, 0, W, H);
    gp.addColorStop(0, "#2b2f3a"); gp.addColorStop(1, "#14161d");
    c.fillStyle = gp; c.fillRect(-20, -20, W + 40, H + 40);
    c.fillStyle = "rgba(255,255,255,.035)";
    for (let i = 0; i < 260; i++) c.fillRect(hsh(i) * W, hsh(i + 500) * H, 1.4, 1.4);
    c.strokeStyle = "rgba(255,255,255,.05)"; c.lineWidth = 1; c.beginPath();
    for (let i = 1; i < N; i++) { c.moveTo(i * C, 0); c.lineTo(i * C, H); c.moveTo(0, i * C); c.lineTo(W, i * C); }
    c.stroke();
    c.strokeStyle = "rgba(255,255,255,.12)"; c.lineWidth = 1;
    rr(c, 1, 1, W - 2, H - 2, 8); c.stroke();
    txt(c, "BAMBUNYMOUS", W / 2, H - 14, 10, "rgba(255,255,255,.08)", { weight: 900 });
    // pastille
    if (s.food) {
      const fx = s.food.x * C + C / 2, fy = s.food.y * C + C / 2, pu = 1 + Math.sin(s.t * 6) * 0.12;
      const gl = c.createRadialGradient(fx, fy, 1, fx, fy, 18);
      gl.addColorStop(0, hexA(s.food.c, 0.55)); gl.addColorStop(1, hexA(s.food.c, 0));
      c.fillStyle = gl; c.fillRect(fx - 20, fy - 20, 40, 40);
      const gb = c.createRadialGradient(fx - 2, fy - 2, 1, fx, fy, 7 * pu);
      gb.addColorStop(0, shade(s.food.c, 0.6)); gb.addColorStop(1, s.food.c);
      circle(c, fx, fy, 6.5 * pu, gb);
      circle(c, fx - 2, fy - 2.4, 1.6, "rgba(255,255,255,.8)");
    }
    // filament
    const pts = s.pos.map((p, i) => {
      const q = s.prev[i] || p;
      return { x: lerp(q.x, p.x, f) * C + C / 2, y: lerp(q.y, p.y, f) * C + C / 2 };
    });
    c.lineCap = "round"; c.lineJoin = "round";
    c.save();
    c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 8; c.shadowOffsetY = 3;
    for (let i = pts.length - 1; i > 0; i--) {
      const A = pts[i], B = pts[i - 1];
      c.strokeStyle = s.cols[i] || "#fff"; c.lineWidth = 14;
      c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
    }
    c.restore();
    for (let i = pts.length - 1; i > 0; i--) {
      const A = pts[i], B = pts[i - 1];
      c.strokeStyle = "rgba(255,255,255,.35)"; c.lineWidth = 3.5;
      c.beginPath(); c.moveTo(A.x - 2, A.y - 3); c.lineTo(B.x - 2, B.y - 3); c.stroke();
    }
    // tete
    const hd = pts[0], d = s.dir, r = 9 + s.gulp * 2;
    const gh = c.createRadialGradient(hd.x - 3, hd.y - 3, 1, hd.x, hd.y, r);
    gh.addColorStop(0, "#fff"); gh.addColorStop(1, s.cols[0]);
    circle(c, hd.x, hd.y, r, gh);
    const px = -d.y, py = d.x;
    for (const sd of [-1, 1]) {
      const ex = hd.x + d.x * 3 + px * sd * 4.2, ey = hd.y + d.y * 3 + py * sd * 4.2;
      circle(c, ex, ey, 3, "#fff");
      circle(c, ex + d.x * 1.2, ey + d.y * 1.2, 1.6, s.alive ? "#111" : "#9ca3af");
    }
    drawParts(c, s.parts);
    c.restore();
  });

  return (
    <Stage bg="radial-gradient(ellipse at 50% 30%, #3b2a5a 0%, #171225 70%)" won={a.won}>
      <Shell a={a} cvs={cvs} title="Serpent de filament" emoji="🌈" goal={GOAL} accent="#a855f7" onStart={start}
        rule="Mange les pastilles : chacune ajoute un bout de sa couleur. Atteins une longueur de 15 !"
        hint="Flèches (ou ZQSD), ou glisse le doigt sur le plateau" ev={ev}/>
    </Stage>
  );
}

/* ======================================================== 4. casse-briques */

function CasseBriques() {
  const W = 360, H = 480, PY = 446, BR = 6;
  const a = useArcade("casse-briques", null);
  const cvs = useCanvas(W, H);
  const keys = useKeys();
  const makeBricks = () => {
    const out = [], cols = 6, rows = 5, gap = 6, bw = (W - 28 - gap * (cols - 1)) / cols, bh = 18;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      out.push({ x: 14 + k * (bw + gap), y: 72 + r * (bh + 10), w: bw, h: bh, c: FIL[(r * 2 + k) % FIL.length], hit: 0 });
    }
    return out;
  };
  const fresh = () => ({ px: W / 2, pw: 78, bx: W / 2, by: PY - BR - 1, vx: 0, vy: 0, stuck: true, bricks: makeBricks(),
    lives: 3, parts: [], trail: [], shake: 0, t: 0, broken: 0, done: false, speed: 300, flash: 0 });
  const S = useRef(null);
  if (!S.current) S.current = fresh();
  const total = 30;

  const start = () => { S.current = fresh(); a.score(0); a.extra("❤️❤️❤️"); a.go("play"); };
  const launch = () => {
    const s = S.current;
    if (a.ph.current !== "play" || !s.stuck || s.done) return;
    s.stuck = false;
    const an = rand(-0.5, 0.5);
    s.vx = Math.sin(an) * s.speed; s.vy = -Math.cos(an) * s.speed;
  };
  useKeyPress(e => { if (e.key === " " || e.key === "ArrowUp") launch(); });
  const ev = {
    onPointerDown: e => { e.preventDefault(); S.current.px = cvs.at(e).x; launch(); },
    onPointerMove: e => { S.current.px = cvs.at(e).x; },
  };

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    s.t += dt;
    s.flash = Math.max(0, s.flash - dt * 3);
    const play = a.ph.current === "play" && !s.done;
    const k = keys.current;
    if (k.has("ArrowLeft") || k.has("q")) s.px -= 430 * dt;
    if (k.has("ArrowRight") || k.has("d")) s.px += 430 * dt;
    s.px = clamp(s.px, s.pw / 2, W - s.pw / 2);
    if (a.ph.current === "menu") s.px = W / 2 + Math.sin(s.t * 1.5) * 90;
    if (s.stuck) { s.bx = s.px; s.by = PY - BR - 1; }
    else if (play) {
      const steps = Math.ceil((s.speed * dt) / 4);
      const h = dt / steps;
      for (let st = 0; st < steps; st++) {
        s.bx += s.vx * h; s.by += s.vy * h;
        if (s.bx < BR) { s.bx = BR; s.vx = Math.abs(s.vx); }
        if (s.bx > W - BR) { s.bx = W - BR; s.vx = -Math.abs(s.vx); }
        if (s.by < BR + 34) { s.by = BR + 34; s.vy = Math.abs(s.vy); }
        // plateau
        if (s.vy > 0 && s.by + BR >= PY && s.by + BR <= PY + 12 && Math.abs(s.bx - s.px) <= s.pw / 2 + BR) {
          const off = clamp((s.bx - s.px) / (s.pw / 2), -1, 1);
          s.vx = Math.sin(off * 1.05) * s.speed; s.vy = -Math.cos(off * 1.05) * s.speed;
          s.by = PY - BR;
          burst(s.parts, s.bx, PY, 5, ["#fde68a", "#fff"], 80, { ang: -Math.PI / 2, spread: 1, life: 0.35 });
        }
        // briques
        for (const b of s.bricks) {
          if (b.hit) continue;
          const nx = clamp(s.bx, b.x, b.x + b.w), ny = clamp(s.by, b.y, b.y + b.h);
          if ((s.bx - nx) ** 2 + (s.by - ny) ** 2 > BR * BR) continue;
          b.hit = 1;
          const ox = Math.min(s.bx + BR - b.x, b.x + b.w - (s.bx - BR));
          const oy = Math.min(s.by + BR - b.y, b.y + b.h - (s.by - BR));
          if (ox < oy) s.vx = -s.vx; else s.vy = -s.vy;
          s.broken += 1; a.score(s.broken);
          s.speed = Math.min(430, s.speed + 4);
          const m = Math.hypot(s.vx, s.vy);
          s.vx *= s.speed / m; s.vy *= s.speed / m;
          s.shake = 2.5;
          burst(s.parts, b.x + b.w / 2, b.y + b.h / 2, 14, [b.c, shade(b.c, 0.4), "#fff"], 170);
          if (s.broken >= total) {
            s.done = true;
            a.win();
            burst(s.parts, W / 2, H / 2, 60, FIL, 260, { kind: "spark", life: 1.3 });
            a.end("Plateau nettoyé, plus une miette de filament !", "Bravo !");
          }
          break;
        }
        if (s.by > H + 20) {
          s.lives -= 1; s.shake = 9; s.flash = 1;
          a.extra("❤️".repeat(Math.max(0, s.lives)) + "🖤".repeat(3 - Math.max(0, s.lives)));
          if (s.lives <= 0) {
            s.done = true;
            a.end(`Plus de balles… ${s.broken} bobine${s.broken > 1 ? "s" : ""} sur ${total}.`, "Perdu !");
          } else s.stuck = true;
          break;
        }
      }
    }
    s.trail.push({ x: s.bx, y: s.by });
    if (s.trail.length > 10) s.trail.shift();
    stepParts(s.parts, dt);

    c.save();
    shakeIt(c, s, dt);
    sky(c, W, H, ["#1e1b4b", "#2a1f4f", "#120f24"]);
    // eclairage de l'enceinte
    const gl = c.createRadialGradient(W / 2, 0, 10, W / 2, 0, 300);
    gl.addColorStop(0, "rgba(255,214,150,.35)"); gl.addColorStop(1, "rgba(255,214,150,0)");
    c.fillStyle = gl; c.fillRect(0, 0, W, H);
    c.fillStyle = "#fde68a"; c.fillRect(30, 30, W - 60, 3);
    c.strokeStyle = "rgba(255,255,255,.04)"; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x < W; x += 24) { c.moveTo(x, 34); c.lineTo(x, H); }
    c.stroke();
    // briques bobines
    for (const b of s.bricks) {
      if (b.hit) continue;
      c.fillStyle = "#30363f";
      rr(c, b.x, b.y - 3, 5, b.h + 6, 2); c.fill();
      rr(c, b.x + b.w - 5, b.y - 3, 5, b.h + 6, 2); c.fill();
      const g = c.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, shade(b.c, 0.4)); g.addColorStop(0.45, b.c); g.addColorStop(1, shade(b.c, -0.45));
      c.fillStyle = g; c.fillRect(b.x + 5, b.y, b.w - 10, b.h);
      c.strokeStyle = "rgba(0,0,0,.16)"; c.lineWidth = 1; c.beginPath();
      for (let xx = b.x + 8; xx < b.x + b.w - 6; xx += 3) { c.moveTo(xx, b.y); c.lineTo(xx, b.y + b.h); }
      c.stroke();
    }
    // trainee et balle
    s.trail.forEach((p, i) => { c.globalAlpha = (i / s.trail.length) * 0.35; circle(c, p.x, p.y, BR * (i / s.trail.length), "#fb923c"); });
    c.globalAlpha = 1;
    const gb = c.createRadialGradient(s.bx - 2, s.by - 2, 1, s.bx, s.by, BR + 1);
    gb.addColorStop(0, "#fff"); gb.addColorStop(0.5, "#fed7aa"); gb.addColorStop(1, "#f97316");
    c.save(); c.shadowColor = "#fb923c"; c.shadowBlur = 14; circle(c, s.bx, s.by, BR, gb); c.restore();
    // plateau d'impression
    const x0 = s.px - s.pw / 2;
    c.save(); c.shadowColor = "rgba(0,0,0,.5)"; c.shadowBlur = 10; c.shadowOffsetY = 4;
    const gpl = c.createLinearGradient(0, PY, 0, PY + 12);
    gpl.addColorStop(0, "#f3d38a"); gpl.addColorStop(1, "#a87526");
    rr(c, x0, PY, s.pw, 12, 4); c.fillStyle = gpl; c.fill(); c.restore();
    c.fillStyle = "rgba(120,80,20,.35)";
    for (let i = 0; i < 16; i++) c.fillRect(x0 + 4 + hsh(i) * (s.pw - 8), PY + 3 + hsh(i + 30) * 6, 1.2, 1.2);
    c.fillStyle = "#1f2937"; rr(c, s.px - 8, PY + 10, 16, 5, 2); c.fill();
    if (s.stuck && a.ph.current === "play" && !s.done) txt(c, "Tape ou espace pour lancer", W / 2, H / 2 + 60, 15, "#fff", { stroke: 4 });
    drawParts(c, s.parts);
    if (s.flash > 0) { c.fillStyle = `rgba(239,68,68,${s.flash * 0.25})`; c.fillRect(-20, -20, W + 40, H + 40); }
    c.restore();
  });

  return (
    <Stage bg="radial-gradient(ellipse at 50% 0%, #4c1d95 0%, #1e1b4b 50%, #0b0a18 100%)" won={a.won}>
      <Shell a={a} cvs={cvs} title="Casse-bobines" emoji="🧱" goal={total} accent="#8b5cf6" onStart={start}
        rule="Renvoie la goutte de filament avec le plateau et casse les 30 bobines. 3 vies."
        hint="Souris, doigt ou ← → ; espace pour lancer" ev={ev}/>
    </Stage>
  );
}

/* ================================================================ 5. taupe */

function drawTangle(c, x, y, r, t) {
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
  g.addColorStop(0, "#9ca3af"); g.addColorStop(1, "#374151");
  circle(c, x, y, r, g);
  c.strokeStyle = "rgba(239,68,68,.75)"; c.lineWidth = 1.6;
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a0 = i * 1.7 + t * 0.6;
    c.ellipse(x + Math.cos(a0) * r * 0.25, y + Math.sin(a0) * r * 0.2, r * 0.6, r * 0.25, a0, 0, TAU);
  }
  c.stroke();
  for (const sd of [-1, 1]) { circle(c, x + sd * r * 0.32, y - r * 0.05, r * 0.2, "#fff"); circle(c, x + sd * r * 0.32, y, r * 0.1, "#111"); }
  c.strokeStyle = "#111"; c.lineWidth = 2.2; c.beginPath();
  c.moveTo(x - r * 0.55, y - r * 0.38); c.lineTo(x - r * 0.15, y - r * 0.22);
  c.moveTo(x + r * 0.55, y - r * 0.38); c.lineTo(x + r * 0.15, y - r * 0.22);
  c.moveTo(x - r * 0.25, y + r * 0.42); c.quadraticCurveTo(x, y + r * 0.25, x + r * 0.25, y + r * 0.42);
  c.stroke();
}

function Taupe() {
  const W = 360, H = 420, GOAL = 15, DUR = 30;
  const a = useArcade("taupe", GOAL);
  const cvs = useCanvas(W, H);
  const HOLES = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) HOLES.push({ x: 66 + k * 114, y: 160 + r * 104 });
  const fresh = () => ({ holes: HOLES.map(h => ({ ...h, kind: null, up: 0, t: 0, dur: 1, hit: false, col: FIL[0], hitT: 0 })),
    time: DUR, spawn: 0.6, score: 0, parts: [], hammers: [], shake: 0, t: 0, done: false });
  const S = useRef(null);
  if (!S.current) S.current = fresh();

  const start = () => { S.current = fresh(); a.score(0); a.extra(`⏱ ${DUR}`); a.go("play"); };
  const whack = i => {
    const s = S.current;
    if (a.ph.current !== "play" || s.done) return;
    const h = s.holes[i];
    s.hammers.push({ x: h.x + 26, y: h.y - 50, life: 0.25 });
    if (!h.kind || h.hit || h.up < 0.35) return;
    h.hit = true; h.hitT = 0;
    if (h.kind === "spool") {
      s.score += 1; a.score(s.score);
      burst(s.parts, h.x, h.y - 40, 12, ["#fde68a", "#fff", h.col], 150, { kind: "spark", g: 200, life: 0.6 });
      floatText(s.parts, h.x, h.y - 70, s.score === GOAL ? "15 !" : "+1", "#fde68a", s.score === GOAL ? 26 : 18);
    } else {
      s.score = Math.max(0, s.score - 2); a.score(s.score); s.shake = 8;
      burst(s.parts, h.x, h.y - 40, 14, ["#ef4444", "#374151", "#9ca3af"], 160);
      floatText(s.parts, h.x, h.y - 70, "−2 bouchon !", "#fca5a5", 16);
    }
  };
  const ev = {
    onPointerDown: e => {
      e.preventDefault();
      const p = cvs.at(e), s = S.current;
      let best = -1, bd = 1e9;
      s.holes.forEach((h, i) => {
        if (Math.abs(p.x - h.x) > 52 || p.y < h.y - 95 || p.y > h.y + 22) return;
        const d = Math.hypot(p.x - h.x, p.y - (h.y - 35));
        if (d < bd) { bd = d; best = i; }
      });
      if (best >= 0) whack(best);
    },
  };
  useKeyPress(e => {
    const m = /^(Digit|Numpad)([1-9])$/.exec(e.code || "");
    if (!m) return;
    const n = +m[2];
    whack([6, 7, 8, 3, 4, 5, 0, 1, 2][n - 1]);
  });

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    s.t += dt;
    const play = a.ph.current === "play" && !s.done;
    if (play) {
      s.time -= dt;
      a.extra(`⏱ ${Math.max(0, Math.ceil(s.time))}`);
      s.spawn -= dt;
      if (s.spawn <= 0) {
        const free = s.holes.filter(h => !h.kind);
        if (free.length) {
          const h = pick(free), prog = 1 - s.time / DUR;
          h.kind = Math.random() < 0.2 ? "plug" : "spool"; h.t = 0; h.up = 0; h.hit = false; h.col = pick(FIL);
          h.dur = rand(0.85, 1.35) - prog * 0.3;
        }
        s.spawn = rand(0.55, 0.9) - (1 - s.time / DUR) * 0.25;
      }
      if (s.time <= 0) {
        s.done = true;
        a.end(s.score >= GOAL ? `${s.score} points : rien n'échappe à ton marteau !` : `${s.score} point${s.score > 1 ? "s" : ""}, il en fallait ${GOAL}. Gare aux bouchons !`,
          s.score >= GOAL ? "Bravo !" : "Temps écoulé");
      }
    }
    for (const h of s.holes) {
      if (!h.kind) continue;
      h.t += dt;
      if (h.hit) { h.hitT += dt; h.up = Math.max(0, h.up - dt * 5); if (h.up <= 0) h.kind = null; continue; }
      if (h.t < h.dur && (play || a.ph.current === "menu")) h.up = Math.min(1, h.up + dt * 7);
      else { h.up = Math.max(0, h.up - dt * 6); if (h.up <= 0) h.kind = null; }
    }
    if (a.ph.current === "menu" && s.holes.every(h => !h.kind) && Math.random() < dt * 2) {
      const h = pick(s.holes); h.kind = "spool"; h.t = 0; h.dur = 0.9; h.col = pick(FIL); h.hit = false;
    }
    s.hammers.forEach(m => { m.life -= dt; });
    s.hammers = s.hammers.filter(m => m.life > 0);
    stepParts(s.parts, dt);

    c.save();
    shakeIt(c, s, dt);
    // plateau dore texture
    const gp = c.createLinearGradient(0, 0, 0, H);
    gp.addColorStop(0, "#e9b866"); gp.addColorStop(1, "#b17a2c");
    c.fillStyle = gp; c.fillRect(-20, -20, W + 40, H + 40);
    c.fillStyle = "rgba(120,70,10,.22)";
    for (let i = 0; i < 400; i++) c.fillRect(hsh(i) * W, hsh(i + 900) * H, 1.5, 1.5);
    c.strokeStyle = "rgba(255,255,255,.25)"; c.lineWidth = 2;
    rr(c, 10, 52, W - 20, H - 62, 14); c.stroke();
    txt(c, "Plateau texturé · 256 × 256", W / 2, H - 22, 10, "rgba(90,50,10,.45)", { weight: 700 });
    for (const h of s.holes) {
      // trou
      const gh = c.createRadialGradient(h.x, h.y - 2, 4, h.x, h.y, 44);
      gh.addColorStop(0, "#0b0b10"); gh.addColorStop(1, "#3b2a14");
      c.fillStyle = gh;
      c.beginPath(); c.ellipse(h.x, h.y, 44, 15, 0, 0, TAU); c.fill();
      if (h.kind && h.up > 0) {
        c.save();
        c.beginPath(); c.rect(h.x - 60, h.y - 140, 120, 140); c.ellipse(h.x, h.y, 44, 15, 0, 0, Math.PI); c.clip();
        const ease = 1 - Math.pow(1 - h.up, 3), yy = h.y + 66 - ease * 72;
        if (h.kind === "spool") {
          const sq = h.hit ? 0.25 : 0;
          c.translate(h.x, yy - 26); c.scale(1 + sq, 1 - sq);
          spoolFront(c, 0, 0, 30, h.col, s.t * 2);
          if (!h.hit) {
            circle(c, -7, -2, 3.6, "#fff"); circle(c, 7, -2, 3.6, "#fff");
            circle(c, -6, -1.4, 1.8, "#111"); circle(c, 8, -1.4, 1.8, "#111");
            c.strokeStyle = "#111"; c.lineWidth = 1.6; c.beginPath(); c.arc(0, 4, 4, 0.2, Math.PI - 0.2); c.stroke();
          } else {
            txt(c, "✕ ✕", 0, -1, 10, "#111");
          }
        } else {
          drawTangle(c, h.x, yy - 26, 28, s.t);
        }
        c.restore();
      }
      // levre avant du trou
      c.strokeStyle = "rgba(255,230,180,.55)"; c.lineWidth = 3;
      c.beginPath(); c.ellipse(h.x, h.y, 44, 15, 0, 0.1, Math.PI - 0.1); c.stroke();
    }
    for (const m of s.hammers) {
      c.save(); c.translate(m.x, m.y); c.rotate(-0.9 + (1 - m.life / 0.25) * 1.2);
      c.globalAlpha = m.life / 0.25;
      txt(c, "🔨", 0, 0, 34, "#fff");
      c.restore();
    }
    drawParts(c, s.parts);
    c.restore();
  });

  return (
    <Stage bg="radial-gradient(ellipse at 50% 30%, #f6c76a 0%, #a8641f 60%, #3b2008 100%)" won={a.won}>
      <Shell a={a} cvs={cvs} title="Tape-bobine" emoji="🔨" goal={GOAL} accent="#d97706" onStart={start}
        rule="Tape les bobines qui sortent du plateau, évite les bouchons (−2). 15 points en 30 s !"
        hint="Tap ou clic ; au clavier, pavé 1 à 9" ev={ev}/>
    </Stage>
  );
}

/* ================================================================= 6. tour */

function Tour() {
  const W = 360, H = 480, BH = 22, BASE = 420, GOAL = 10;
  const a = useArcade("tour", GOAL);
  const cvs = useCanvas(W, H);
  const colOf = n => `hsl(${(18 + n * 27) % 360}, 82%, 58%)`;
  const fresh = () => ({ stack: [{ x: 90, w: 180, c: colOf(0) }], m: { x: -10, w: 180, dir: 1, c: colOf(1) },
    debris: [], parts: [], cam: 0, shake: 0, t: 0, done: false, fall: null, perfect: 0 });
  const S = useRef(null);
  if (!S.current) S.current = fresh();

  const start = () => { S.current = fresh(); a.score(0); a.go("play"); };
  const drop = () => {
    const s = S.current;
    if (a.ph.current !== "play" || s.done) return;
    const top = s.stack[s.stack.length - 1], m = s.m, n = s.stack.length;
    const y = BASE - (n + 1) * BH;
    let left = Math.max(m.x, top.x), right = Math.min(m.x + m.w, top.x + top.w);
    if (right - left <= 0) {
      s.done = true; s.shake = 8;
      s.debris.push({ x: m.x, y, w: m.w, vy: 0, vx: m.dir * 40, rot: 0, vr: m.dir * 2, c: m.c });
      const f = n - 1;
      a.end(f >= GOAL ? `${f} étages : une tour digne d'un test de surplomb !` : `Couche dans le vide… ${f} étage${f > 1 ? "s" : ""} sur ${GOAL}.`,
        f >= GOAL ? "Bravo !" : "Effondrement !");
      return;
    }
    if (Math.abs(m.x - top.x) < 5) {
      left = top.x; right = top.x + top.w;
      s.perfect = 1;
      burst(s.parts, left + (right - left) / 2, y + BH / 2, 18, ["#fff", "#fde68a", m.c], 160, { kind: "spark", g: 50, life: 0.7 });
      floatText(s.parts, W / 2, y - 20, "Parfait !", "#fff", 18);
    } else {
      const cutX = m.x < top.x ? m.x : right, cutW = m.w - (right - left);
      s.debris.push({ x: cutX, y, w: cutW, vy: 0, vx: (m.x < top.x ? -1 : 1) * 60, rot: 0, vr: (m.x < top.x ? -1 : 1) * rand(1.5, 3), c: m.c });
      s.shake = 2.5;
      burst(s.parts, m.x < top.x ? left : right, y + BH / 2, 8, [m.c, "#fff"], 90, { life: 0.5 });
    }
    s.stack.push({ x: left, w: right - left, c: m.c });
    const floors = s.stack.length - 1;
    a.score(floors);
    if (floors === GOAL) floatText(s.parts, W / 2, y - 50, "10 étages !", "#fde68a", 26);
    const fromLeft = s.stack.length % 2 === 0;
    s.m = { x: fromLeft ? -24 : W + 24 - (right - left), w: right - left, dir: fromLeft ? 1 : -1, c: colOf(s.stack.length) };
  };
  useKeyPress(e => { if (e.key === " " || e.key === "ArrowDown") drop(); });

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    s.t += dt;
    s.perfect = Math.max(0, s.perfect - dt * 2);
    const n = s.stack.length;
    if (!s.done) {
      const sp = a.ph.current === "play" ? Math.min(330, 135 + (n - 1) * 11) : 110;
      s.m.x += s.m.dir * sp * dt;
      if (s.m.x + s.m.w > W + 24) { s.m.x = W + 24 - s.m.w; s.m.dir = -1; }
      if (s.m.x < -24) { s.m.x = -24; s.m.dir = 1; }
    }
    s.cam = lerp(s.cam, Math.max(0, (n + 1) * BH - 230), Math.min(1, dt * 4));
    for (const d of s.debris) { d.vy += 900 * dt; d.y += d.vy * dt; d.x += d.vx * dt; d.rot += d.vr * dt; }
    s.debris = s.debris.filter(d => d.y < BASE + 600);
    stepParts(s.parts, dt);

    const cam = s.cam, p = clamp(cam / 520, 0, 1);
    c.save();
    shakeIt(c, s, dt);
    sky(c, W, H, ["#ffd9a0", "#f6a26b", "#d9667a"]);
    if (p > 0) {
      c.globalAlpha = p;
      sky(c, W, H, ["#0f1033", "#2b2165", "#6b3a8a"]);
      for (let i = 0; i < 70; i++) circle(c, hsh(i) * W, hsh(i + 70) * H * 0.8, 0.6 + hsh(i + 140) * 1.2, `rgba(255,255,255,${0.4 + 0.6 * Math.abs(Math.sin(s.t + i))})`);
      c.globalAlpha = 1;
    }
    c.save();
    c.translate(0, cam);
    // nuages en altitude
    for (const [wy, sp] of [[-120, 14], [-360, 22], [-620, 10]]) {
      const x = ((s.t * sp + wy * -0.7) % (W + 200)) - 100;
      c.fillStyle = "rgba(255,255,255,.55)";
      c.beginPath(); c.ellipse(x, wy, 46, 13, 0, 0, TAU); c.ellipse(x + 30, wy - 8, 30, 12, 0, 0, TAU); c.fill();
    }
    // plateau d'impression
    const gpl = c.createLinearGradient(0, BASE, 0, BASE + 20);
    gpl.addColorStop(0, "#3a3f4b"); gpl.addColorStop(1, "#16181e");
    c.fillStyle = gpl; rr(c, 20, BASE, W - 40, 18, 4); c.fill();
    c.fillStyle = "#1f2229"; c.fillRect(-20, BASE + 18, W + 40, 200);
    c.fillStyle = "rgba(255,255,255,.08)"; c.fillRect(24, BASE + 2, W - 48, 2);
    const drawBlock = (x, y, w, col, glow) => {
      c.save();
      c.shadowColor = "rgba(0,0,0,.3)"; c.shadowBlur = 6; c.shadowOffsetY = 2;
      c.fillStyle = col; rr(c, x, y, w, BH, 3); c.fill();
      c.restore();
      const g = c.createLinearGradient(0, y, 0, y + BH);
      g.addColorStop(0, "rgba(255,255,255,.35)"); g.addColorStop(0.4, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,.25)");
      c.fillStyle = g; rr(c, x, y, w, BH, 3); c.fill();
      c.strokeStyle = "rgba(0,0,0,.12)"; c.lineWidth = 1; c.beginPath();
      for (let yy = y + 4; yy < y + BH - 1; yy += 3.5) { c.moveTo(x + 2, yy); c.lineTo(x + w - 2, yy); }
      c.stroke();
      if (glow) { c.strokeStyle = `rgba(255,255,255,${glow})`; c.lineWidth = 2; rr(c, x - 1, y - 1, w + 2, BH + 2, 4); c.stroke(); }
    };
    s.stack.forEach((b, i) => drawBlock(b.x, BASE - (i + 1) * BH, b.w, b.c, i === n - 1 ? s.perfect : 0));
    if (!s.done) {
      const my = BASE - (n + 1) * BH;
      drawBlock(s.m.x, my, s.m.w, s.m.c, 0);
      // buse qui depose la couche
      const nx = s.m.x + s.m.w / 2;
      c.fillStyle = "#cbd5e1"; c.fillRect(nx - 9, my - 30, 18, 12);
      c.fillStyle = "#f97316"; rr(c, nx - 11, my - 20, 22, 10, 3); c.fill();
      c.fillStyle = "#eab308"; c.beginPath(); c.moveTo(nx - 4, my - 10); c.lineTo(nx + 4, my - 10); c.lineTo(nx, my - 3); c.fill();
      c.fillStyle = "#64748b"; c.fillRect(-20, my - 30, W + 40, 3);
    }
    for (const d of s.debris) {
      c.save(); c.translate(d.x + d.w / 2, d.y + BH / 2); c.rotate(d.rot);
      c.fillStyle = d.c; rr(c, -d.w / 2, -BH / 2, d.w, BH, 3); c.fill();
      c.fillStyle = "rgba(0,0,0,.2)"; c.fillRect(-d.w / 2, BH / 2 - 5, d.w, 5);
      c.restore();
    }
    drawParts(c, s.parts);
    c.restore();
    if (a.ph.current === "play" && n === 1 && !s.done) txt(c, "Tape pour poser la couche", W / 2, 90, 17, "#fff", { stroke: 4 });
    c.restore();
  });

  return (
    <Stage bg="linear-gradient(180deg, #2b2165 0%, #c25a72 55%, #f6a26b 100%)" won={a.won}>
      <Shell a={a} cvs={cvs} title="Tour de couches" emoji="🏗️" goal={GOAL} accent="#ec4899" onStart={start}
        rule="Pose chaque couche sur la précédente : ce qui dépasse tombe. Monte 10 étages !"
        hint="Tap, clic ou espace pour poser"
        ev={{ onPointerDown: e => { e.preventDefault(); drop(); } }}/>
    </Stage>
  );
}

/* =============================================================== 7. dragon */

function drawWing(c, sx, sy, t, wake, back) {
  const spread = lerp(0.42, 1, wake), flap = Math.sin(t * 4) * 0.14 * wake;
  c.save();
  c.translate(sx, sy);
  c.rotate(lerp(0.75, -0.05, wake) + flap + (back ? -0.25 : 0));
  c.scale(spread * (back ? 0.85 : 1), spread * (back ? 0.85 : 1));
  const g = c.createLinearGradient(0, 0, -70, -60);
  g.addColorStop(0, back ? "#5b1414" : "#991b1b"); g.addColorStop(1, back ? "#3a0a0a" : "#dc2626");
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(0, 0); c.lineTo(-12, -58); c.lineTo(-74, -48);
  c.quadraticCurveTo(-62, -34, -66, -20);
  c.quadraticCurveTo(-50, -16, -48, -4);
  c.quadraticCurveTo(-30, -4, -24, 8);
  c.closePath(); c.fill();
  c.strokeStyle = back ? "#2a0606" : "#5b0f0f"; c.lineWidth = 2.4; c.lineCap = "round";
  c.beginPath();
  c.moveTo(0, 0); c.lineTo(-12, -58); c.lineTo(-74, -48);
  c.moveTo(-12, -58); c.lineTo(-66, -20); c.moveTo(-12, -58); c.lineTo(-48, -4);
  c.stroke();
  circle(c, -12, -58, 3, "#f5deb3");
  c.restore();
}

function drawDragon(c, t, wake, jaw, flinch) {
  const br = Math.sin(t * (wake > 0.5 ? 3 : 1.5));
  c.save();
  if (flinch > 0) c.translate(rand(-2, 2) * flinch, 0);
  // queue
  c.lineCap = "round"; c.strokeStyle = "#8f1d1d";
  c.lineWidth = 16;
  const tw = Math.sin(t * 1.2) * 5;
  c.beginPath(); c.moveTo(62, 252); c.bezierCurveTo(14, 270, -2, 236, 22, 212 + tw); c.stroke();
  c.lineWidth = 9; c.beginPath(); c.moveTo(22, 212 + tw); c.quadraticCurveTo(36, 196, 30, 186 + tw); c.stroke();
  c.fillStyle = "#facc15";
  c.beginPath(); c.moveTo(30, 178 + tw); c.lineTo(40, 188 + tw); c.lineTo(22, 190 + tw); c.closePath(); c.fill();
  drawWing(c, 96, 212, t + 0.4, wake, true);
  // corps
  const cy = 236 - br * 1.5, ry = 32 * (1 + br * 0.03);
  const gb = c.createRadialGradient(80, 214, 6, 98, 236, 70);
  gb.addColorStop(0, "#f87171"); gb.addColorStop(0.55, "#dc2626"); gb.addColorStop(1, "#7f1d1d");
  c.fillStyle = gb;
  c.beginPath(); c.ellipse(100, cy, 60, ry, 0, 0, TAU); c.fill();
  // ecailles
  c.save();
  c.beginPath(); c.ellipse(100, cy, 60, ry, 0, 0, TAU); c.clip();
  c.strokeStyle = "rgba(80,10,10,.32)"; c.lineWidth = 1.2;
  c.beginPath();
  for (let row = 0; row < 6; row++) for (let k = 0; k < 11; k++) {
    const x = 44 + k * 11 + (row % 2) * 5.5, y = cy - ry + 6 + row * 9;
    c.moveTo(x + 5.5, y); c.arc(x, y, 5.5, 0, Math.PI);
  }
  c.stroke();
  c.restore();
  // ventre
  const gv = c.createLinearGradient(0, cy, 0, cy + ry);
  gv.addColorStop(0, "#fde68a"); gv.addColorStop(1, "#f59e0b");
  c.fillStyle = gv;
  c.beginPath(); c.ellipse(110, cy + 15, 42, 14, 0, 0, TAU); c.fill();
  c.strokeStyle = "rgba(180,83,9,.4)"; c.lineWidth = 1; c.beginPath();
  for (let x = 80; x < 145; x += 8) { c.moveTo(x, cy + 4); c.lineTo(x - 2, cy + 27); }
  c.stroke();
  // crete dorsale
  c.fillStyle = "#facc15";
  for (let k = 0; k < 6; k++) {
    const x = 58 + k * 14, y = cy - ry * Math.sqrt(Math.max(0, 1 - ((x - 100) / 60) ** 2)) + 3;
    c.beginPath(); c.moveTo(x - 5, y + 2); c.lineTo(x, y - 9); c.lineTo(x + 5, y + 2); c.closePath(); c.fill();
  }
  // pattes
  for (const [px, py] of [[70, 262], [138, 262]]) {
    c.fillStyle = "#991b1b"; c.beginPath(); c.ellipse(px, py, 13, 9, 0, 0, TAU); c.fill();
    c.fillStyle = "#fef3c7";
    for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(px + 8 + k * 2, py + 4 + k * 3); c.lineTo(px + 15, py + 6 + k * 3); c.lineTo(px + 9, py + 8 + k * 3); c.fill(); }
  }
  drawWing(c, 104, 214, t, wake, false);
  // cou et tete
  const hx = lerp(158, 176, wake), hy = lerp(252, 192, wake), hr = lerp(0.18, -0.08, wake);
  c.strokeStyle = "#b91c1c"; c.lineWidth = 22;
  c.beginPath(); c.moveTo(138, 232); c.quadraticCurveTo(lerp(152, 150, wake), lerp(246, 214, wake), hx - 8, hy + 2); c.stroke();
  c.save();
  c.translate(hx, hy); c.rotate(hr);
  // cornes
  c.fillStyle = "#fef3c7";
  c.beginPath(); c.moveTo(-8, -10); c.quadraticCurveTo(-22, -22, -30, -18); c.quadraticCurveTo(-20, -14, -14, -4); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(-2, -12); c.quadraticCurveTo(-12, -28, -20, -28); c.quadraticCurveTo(-12, -20, -8, -6); c.closePath(); c.fill();
  // machoire basse
  c.save(); c.translate(6, 6); c.rotate(jaw * 0.55);
  c.fillStyle = "#991b1b"; rr(c, 0, -3, 34, 9, 4); c.fill();
  c.fillStyle = "#fff";
  for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(10 + k * 8, -3); c.lineTo(13 + k * 8, -7); c.lineTo(16 + k * 8, -3); c.fill(); }
  c.restore();
  if (jaw > 0.05) { circle(c, 26, 6, 6 * jaw, "#7f1d1d"); }
  // crane et museau
  const gh = c.createRadialGradient(-2, -6, 2, 6, 0, 30);
  gh.addColorStop(0, "#f87171"); gh.addColorStop(1, "#b91c1c");
  c.fillStyle = gh;
  c.beginPath(); c.arc(0, -2, 15, 0, TAU); c.fill();
  c.beginPath(); c.ellipse(20, 0, 22, 11, 0, 0, TAU); c.fill();
  circle(c, 37, -4, 2, "#5b0f0f");
  // oeil
  if (wake < 0.5) {
    c.strokeStyle = "#5b0f0f"; c.lineWidth = 2; c.beginPath(); c.arc(4, -5, 5, 0.2, Math.PI - 0.2); c.stroke();
  } else {
    c.fillStyle = "#fde047"; c.beginPath(); c.ellipse(4, -6, 6, 5, 0, 0, TAU); c.fill();
    c.fillStyle = "#111"; c.beginPath(); c.ellipse(5, -6, 1.5, 4.4, 0, 0, TAU); c.fill();
    circle(c, 3, -8, 1.2, "#fff");
    c.strokeStyle = "#5b0f0f"; c.lineWidth = 2.6; c.beginPath(); c.moveTo(-3, -13); c.lineTo(12, -10); c.stroke();
  }
  c.restore();
  c.restore();
}

function drawKnight(c, k, t) {
  c.save();
  c.translate(k.x, 270);
  const m = k.melt;
  if (m > 0) c.scale(1 + m * 0.7, 1 - m * 0.85);
  const bob = m > 0 ? 0 : Math.abs(Math.sin(t * 8 + k.ph)) * 2;
  // socle de figurine
  c.fillStyle = shade(k.c, -0.45); c.beginPath(); c.ellipse(0, -2, 13, 4.5, 0, 0, TAU); c.fill();
  c.translate(0, -bob);
  const sw = m > 0 ? 0 : Math.sin(t * 8 + k.ph) * 3;
  c.strokeStyle = shade(k.c, -0.3); c.lineWidth = 4; c.lineCap = "round";
  c.beginPath(); c.moveTo(-3, -12); c.lineTo(-3 - sw, -4); c.moveTo(3, -12); c.lineTo(3 + sw, -4); c.stroke();
  // tabard
  const g = c.createLinearGradient(-7, -28, 7, -10);
  g.addColorStop(0, shade(k.c, 0.3)); g.addColorStop(1, shade(k.c, -0.2));
  c.fillStyle = g; rr(c, -7, -28, 14, 17, 3); c.fill();
  c.fillStyle = "#fde68a"; c.fillRect(-1, -27, 2, 15);
  // epee levee
  c.strokeStyle = "#e5e7eb"; c.lineWidth = 2.2;
  c.beginPath(); c.moveTo(6, -22); c.lineTo(9, -42); c.stroke();
  c.strokeStyle = "#a16207"; c.lineWidth = 2; c.beginPath(); c.moveTo(3, -24); c.lineTo(10, -23); c.stroke();
  // casque
  const gh = c.createRadialGradient(-2, -36, 1, 0, -33, 8);
  gh.addColorStop(0, "#f3f4f6"); gh.addColorStop(1, "#6b7280");
  circle(c, 0, -33, 7, gh);
  c.fillStyle = "#1f2937"; c.fillRect(-6, -34, 6, 1.8);
  c.fillStyle = k.plume; c.beginPath(); c.moveTo(0, -40); c.quadraticCurveTo(6, -48, 9, -42); c.quadraticCurveTo(4, -42, 2, -38); c.fill();
  // bouclier
  c.fillStyle = shade(k.c, -0.1);
  c.beginPath(); c.moveTo(-12, -27); c.lineTo(-3, -27); c.lineTo(-3, -17); c.quadraticCurveTo(-7, -11, -12, -17); c.closePath(); c.fill();
  c.strokeStyle = "#fde68a"; c.lineWidth = 1.2; c.stroke();
  if (m > 0) { c.fillStyle = `rgba(30,20,10,${m * 0.8})`; c.fillRect(-14, -50, 28, 50); }
  c.restore();
}

function Dragon() {
  const W = 480, H = 320, GOAL = 10, MOUTH = { x: 214, y: 200 };
  const a = useArcade("dragon", GOAL);
  const cvs = useCanvas(W, H);
  const fresh = () => ({ mode: "sleep", taps: 0, wake: 0, t: 0, knights: [], balls: [], parts: [], zs: [], zT: 0,
    spawn: 1.2, cool: 0, jaw: 0, burned: 0, hits: 0, flinch: 0, shake: 0, done: false, hint: 0 });
  const S = useRef(null);
  if (!S.current) S.current = fresh();

  const start = () => { S.current = fresh(); a.score(0); a.extra("🛡️ 0 / 3"); a.go("play"); };
  const fireAt = (tx, ty) => {
    const s = S.current;
    if (s.cool > 0) return;
    s.cool = 0.3; s.jaw = 1;
    const dx = tx - MOUTH.x, dy = ty - MOUTH.y, d = Math.max(1, Math.hypot(dx, dy));
    s.balls.push({ x: MOUTH.x, y: MOUTH.y, vx: (dx / d) * 560, vy: (dy / d) * 560, tx, ty, life: 1.2 });
    burst(s.parts, MOUTH.x, MOUTH.y, 10, ["#fde047", "#f97316", "#ef4444"], 120, { ang: Math.atan2(dy, dx), spread: 0.5, g: -40, life: 0.4 });
  };
  const act = p => {
    const s = S.current;
    if (a.ph.current !== "play" || s.done) return;
    if (s.mode === "sleep") {
      if (p && p.x > 260) { s.hint = 1.5; return; }
      s.taps += 1; s.flinch = 1; s.shake = 2;
      floatText(s.parts, 170, 150, ["Grmbl…", "Hmmf ?!", "QUI OSE ?!"][s.taps - 1] || "", "#fde68a", 16);
      if (s.taps >= 3) { s.mode = "wake"; s.shake = 6; }
      return;
    }
    if (s.mode !== "fight") return;
    if (p) { fireAt(p.x, p.y); return; }
    let target = null;
    for (const k of s.knights) if (k.melt <= 0 && (!target || k.x < target.x)) target = k;
    if (target) {
      const d = Math.hypot(target.x - MOUTH.x, 250 - MOUTH.y) / 560;
      fireAt(target.x - target.v * d, 250);
    } else fireAt(MOUTH.x + 200, 255);
  };
  useKeyPress(e => { if (e.key === " " || e.key === "Enter") act(null); });

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    s.t += dt;
    s.cool = Math.max(0, s.cool - dt); s.jaw = Math.max(0, s.jaw - dt * 3.5);
    s.flinch = Math.max(0, s.flinch - dt * 3); s.hint = Math.max(0, s.hint - dt);
    const play = a.ph.current === "play" && !s.done;
    if (s.mode === "wake") {
      s.wake = Math.min(1, s.wake + dt * 1.6);
      if (s.wake >= 1) { s.mode = "fight"; floatText(s.parts, 220, 120, "Brûle les figurines !", "#fff", 18); }
    }
    if (s.mode === "sleep") {
      s.zT -= dt;
      if (s.zT <= 0) { s.zT = 0.9; s.zs.push({ x: 180, y: 232, life: 2.4 }); }
    }
    s.zs.forEach(z => { z.life -= dt; z.y -= 18 * dt; z.x += Math.sin(z.life * 3) * 10 * dt + 8 * dt; });
    s.zs = s.zs.filter(z => z.life > 0);
    if (s.mode === "fight" && play) {
      s.spawn -= dt;
      if (s.spawn <= 0) {
        s.spawn = Math.max(0.8, 1.7 - s.burned * 0.06) * rand(0.8, 1.2);
        s.knights.push({ x: W + 20, v: rand(30, 44) + s.burned * 1.4, c: pick(["#2563eb", "#16a34a", "#9333ea", "#0891b2", "#ca8a04"]),
          plume: pick(["#ef4444", "#f472b6", "#fde047", "#fff"]), ph: rand(0, 6), melt: 0 });
      }
    }
    for (const k of s.knights) {
      if (k.melt > 0) { k.melt = Math.min(1, k.melt + dt * 1.4); if (Math.random() < dt * 12) burst(s.parts, k.x, 258, 1, ["#6b7280", "#9ca3af"], 20, { kind: "smoke", g: -60, life: 1, size: 3 }); continue; }
      if (!play) continue;
      k.x -= k.v * dt;
      if (k.x < 205) {
        k.melt = 2;
        s.hits += 1; s.shake = 7; s.flinch = 1;
        a.extra(`🛡️ ${s.hits} / 3`);
        floatText(s.parts, 200, 200, "Aïe !", "#fca5a5", 20);
        if (s.hits >= 3) {
          s.done = true;
          a.end(s.burned >= GOAL ? `${s.burned} figurines fondues avant la chute : la grotte est à toi !`
            : `Les figurines ont envahi la grotte… ${s.burned} brûlée${s.burned > 1 ? "s" : ""} sur ${GOAL}.`,
          s.burned >= GOAL ? "Bravo !" : "Assiégé !");
        }
      }
    }
    s.knights = s.knights.filter(k => k.melt < 1 && k.melt !== 2);
    for (const b of s.balls) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (Math.random() < 0.8) burst(s.parts, b.x, b.y, 1, ["#fde047", "#f97316", "#ef4444"], 30, { g: -60, life: 0.35, size: 1.6 });
      let boom = Math.hypot(b.x - b.tx, b.y - b.ty) < 10 || b.y > 268 || b.life <= 0 || b.x > W + 10 || b.x < 0 || b.y < 0;
      if (!boom) for (const k of s.knights) if (k.melt <= 0 && Math.hypot(k.x - b.x, 250 - b.y) < 20) boom = true;
      if (boom) {
        b.life = -1;
        burst(s.parts, b.x, b.y, 22, ["#fde047", "#f97316", "#ef4444", "#fff"], 170, { g: -80, life: 0.55 });
        s.shake = Math.max(s.shake, 3);
        for (const k of s.knights) {
          if (k.melt > 0 || Math.hypot(k.x - b.x, 250 - b.y) > 36) continue;
          k.melt = 0.01; s.burned += 1;
          if (play) a.score(s.burned);
          floatText(s.parts, k.x, 210, s.burned === GOAL ? "10 fondues !" : "Fondu !", s.burned === GOAL ? "#fde68a" : "#fed7aa", s.burned === GOAL ? 22 : 14);
        }
      }
    }
    s.balls = s.balls.filter(b => b.life > 0);
    stepParts(s.parts, dt);

    c.save();
    shakeIt(c, s, dt);
    // grotte
    sky(c, W, H, ["#1c1326", "#2d1b2e", "#3b2416"]);
    const tg = c.createRadialGradient(W - 70, 120, 4, W - 70, 120, 200 + Math.sin(s.t * 13) * 6);
    tg.addColorStop(0, "rgba(255,180,90,.55)"); tg.addColorStop(1, "rgba(255,180,90,0)");
    c.fillStyle = tg; c.fillRect(0, 0, W, H);
    c.fillStyle = "#150d1b";
    c.beginPath(); c.moveTo(-20, -20); c.lineTo(W + 20, -20); c.lineTo(W + 20, 40);
    for (let x = W; x >= 0; x -= 30) c.lineTo(x, 30 + hsh(x) * 26 + (x % 60 === 0 ? 30 + hsh(x + 1) * 26 : 0));
    c.lineTo(-20, 40); c.closePath(); c.fill();
    // torche
    c.fillStyle = "#5b3a1e"; c.fillRect(W - 74, 120, 7, 34);
    const fl = 1 + Math.sin(s.t * 17) * 0.15;
    c.fillStyle = "#f97316"; c.beginPath(); c.ellipse(W - 70, 112, 7 * fl, 12 * fl, 0, 0, TAU); c.fill();
    c.fillStyle = "#fde047"; c.beginPath(); c.ellipse(W - 70, 115, 3.5 * fl, 6 * fl, 0, 0, TAU); c.fill();
    // sol
    const gg = c.createLinearGradient(0, 262, 0, H);
    gg.addColorStop(0, "#4a3020"); gg.addColorStop(1, "#21140c");
    c.fillStyle = gg; c.fillRect(-20, 266, W + 40, 80);
    c.fillStyle = "rgba(0,0,0,.25)";
    for (let i = 0; i < 12; i++) { c.beginPath(); c.ellipse(hsh(i) * W, 280 + hsh(i + 5) * 30, 10 + hsh(i + 9) * 14, 4, 0, 0, TAU); c.fill(); }
    // tresor : bobines et pieces
    for (let i = 0; i < 4; i++) spoolFront(c, 24 + i * 22, 276 - (i % 2) * 6, 11, FIL[i * 2], 0);
    for (let i = 0; i < 9; i++) circle(c, 130 + i * 9 + hsh(i) * 4, 276 + hsh(i + 3) * 6, 4, i % 2 ? "#facc15" : "#eab308");
    drawDragon(c, s.t, s.wake, s.jaw, s.flinch);
    for (const z of s.zs) {
      c.globalAlpha = clamp(z.life / 2.4, 0, 1);
      txt(c, "Z", z.x, z.y, 12 + (2.4 - z.life) * 7, "#c4b5fd", { stroke: 3, strokeColor: "rgba(30,20,60,.6)" });
    }
    c.globalAlpha = 1;
    for (const k of s.knights) drawKnight(c, k, s.t);
    for (const b of s.balls) {
      const gb = c.createRadialGradient(b.x, b.y, 1, b.x, b.y, 12);
      gb.addColorStop(0, "#fff"); gb.addColorStop(0.35, "#fde047"); gb.addColorStop(1, "rgba(249,115,22,0)");
      c.fillStyle = gb; c.fillRect(b.x - 12, b.y - 12, 24, 24);
    }
    c.globalCompositeOperation = "lighter";
    drawParts(c, s.parts.filter(p => p.kind !== "text" && p.kind !== "smoke"));
    c.globalCompositeOperation = "source-over";
    drawParts(c, s.parts.filter(p => p.kind === "text" || p.kind === "smoke"));
    if (a.ph.current === "play" && s.mode === "sleep") {
      txt(c, `Tape le dragon pour le réveiller (${s.taps}/3)`, W / 2 + 40, 70, 16, "#fff", { stroke: 4 });
      if (s.hint > 0) txt(c, "Non, le dragon ! À gauche ! 🐉", W / 2 + 40, 96, 13, "#fde68a", { stroke: 3 });
    }
    c.restore();
  });

  return (
    <Stage bg="radial-gradient(ellipse at 30% 70%, #5b2a1a 0%, #1c1326 60%, #0a0710 100%)" won={a.won}>
      <Shell a={a} cvs={cvs} title="Le dragon de l'atelier" emoji="🐉" goal={GOAL} accent="#dc2626" onStart={start}
        rule="Réveille le dragon (3 taps), puis crache du feu sur les figurines. Brûles-en 10 avant que 3 ne t'atteignent !"
        hint="Tap pour viser ; espace vise la figurine la plus proche"
        ev={{ onPointerDown: e => { e.preventDefault(); act(cvs.at(e)); } }}/>
    </Stage>
  );
}

/* ================================================================= 8. ovni */

function drawSaucer(c, u, t) {
  c.save();
  c.translate(u.x, u.y);
  c.rotate(Math.sin(t * 2 + u.ph) * 0.09);
  const r = u.r;
  const gl = c.createRadialGradient(0, r * 0.3, 0, 0, r * 0.3, r * 1.7);
  gl.addColorStop(0, hexA(u.c, 0.35)); gl.addColorStop(1, hexA(u.c, 0));
  c.fillStyle = gl; c.fillRect(-r * 1.8, -r * 1.5, r * 3.6, r * 3.4);
  // faisceau
  c.fillStyle = hexA(u.c, 0.08 + 0.05 * Math.sin(t * 5 + u.ph));
  c.beginPath(); c.moveTo(-r * 0.3, r * 0.2); c.lineTo(r * 0.3, r * 0.2); c.lineTo(r * 0.8, r * 2.2); c.lineTo(-r * 0.8, r * 2.2); c.closePath(); c.fill();
  // dome et pilote
  const gd = c.createRadialGradient(-r * 0.15, -r * 0.45, 1, 0, -r * 0.2, r * 0.6);
  gd.addColorStop(0, "rgba(224,242,254,.95)"); gd.addColorStop(1, "rgba(56,189,248,.45)");
  c.fillStyle = gd; c.beginPath(); c.arc(0, -r * 0.12, r * 0.5, Math.PI, 0); c.fill();
  circle(c, 0, -r * 0.24, r * 0.2, "#4ade80");
  circle(c, -r * 0.07, -r * 0.27, r * 0.06, "#111"); circle(c, r * 0.07, -r * 0.27, r * 0.06, "#111");
  c.fillStyle = "rgba(255,255,255,.6)"; c.beginPath(); c.ellipse(-r * 0.22, -r * 0.38, r * 0.12, r * 0.06, -0.6, 0, TAU); c.fill();
  // disque
  const gs = c.createLinearGradient(0, -r * 0.3, 0, r * 0.3);
  gs.addColorStop(0, "#f3f4f6"); gs.addColorStop(0.5, "#9ca3af"); gs.addColorStop(1, "#4b5563");
  c.fillStyle = gs; c.beginPath(); c.ellipse(0, 0, r, r * 0.3, 0, 0, TAU); c.fill();
  c.fillStyle = "#374151"; c.beginPath(); c.ellipse(0, r * 0.07, r * 0.72, r * 0.12, 0, 0, TAU); c.fill();
  for (let i = 0; i < 6; i++) {
    const x = -r * 0.75 + i * r * 0.3;
    circle(c, x, r * 0.07, r * 0.06, FIL[(i + Math.floor(t * 6 + u.ph)) % FIL.length]);
  }
  c.restore();
}

function useStars(n, W, H) {
  const ref = useRef(null);
  if (!ref.current) ref.current = Array.from({ length: n }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(0.4, 1.6), ph: rand(0, TAU) }));
  return ref.current;
}
function drawStars(c, stars, t, alpha = 1) {
  for (const st of stars) {
    c.globalAlpha = alpha * (0.35 + 0.65 * Math.abs(Math.sin(t * 1.3 + st.ph)));
    circle(c, st.x, st.y, st.r, "#fff");
  }
  c.globalAlpha = 1;
}

function Ovni() {
  const W = 360, H = 480, GOAL = 10, DUR = 30;
  const a = useArcade("ovni", GOAL);
  const cvs = useCanvas(W, H);
  const keys = useKeys();
  const stars = useStars(130, W, H * 0.8);
  const fresh = () => ({ ufos: [], parts: [], rings: [], spawn: 0.4, time: DUR, score: 0, shake: 0, t: 0, done: false, aim: null });
  const S = useRef(null);
  if (!S.current) S.current = fresh();

  const start = () => { const aim = S.current.aim; S.current = fresh(); S.current.aim = aim; a.score(0); a.extra(`⏱ ${DUR}`); a.go("play"); };
  const shoot = p => {
    const s = S.current;
    if (a.ph.current !== "play" || s.done) return;
    s.rings.push({ x: p.x, y: p.y, life: 0.3, hit: false });
    for (let i = s.ufos.length - 1; i >= 0; i--) {
      const u = s.ufos[i];
      if (Math.hypot(u.x - p.x, (u.y - p.y) * 1.3) > u.r + 12) continue;
      s.ufos.splice(i, 1);
      s.score += 1; a.score(s.score); s.shake = 3;
      s.rings[s.rings.length - 1].hit = true;
      burst(s.parts, u.x, u.y, 34, ["#fde68a", "#f0abfc", "#a5f3fc", "#fff", u.c], 190, { kind: "spark", g: 70, life: 1.1, drag: 0.96 });
      floatText(s.parts, u.x, u.y - 24, s.score === GOAL ? "10 soucoupes !" : "+1", "#fde68a", s.score === GOAL ? 24 : 16);
      break;
    }
  };
  useKeyPress(e => {
    if (e.key !== " ") return;
    const s = S.current;
    if (!s.aim) s.aim = { x: W / 2, y: H / 2 };
    shoot(s.aim);
  });

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    s.t += dt;
    const ph = a.ph.current, play = ph === "play" && !s.done;
    if (play) {
      aimStep(s, keys, dt, W, H);
      s.time -= dt;
      a.extra(`⏱ ${Math.max(0, Math.ceil(s.time))}`);
      if (s.time <= 0) {
        s.done = true;
        a.end(s.score >= GOAL ? `${s.score} soucoupes en paillettes. La Terre te dit merci !` : `${s.score} soucoupe${s.score > 1 ? "s" : ""} sur ${GOAL}. Elles reviendront…`,
          s.score >= GOAL ? "Bravo !" : "Temps écoulé");
      }
    }
    if (ph !== "over") {
      s.spawn -= dt;
      if (s.spawn <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1, fast = Math.random() < 0.3;
        s.ufos.push({ x: dir > 0 ? -40 : W + 40, y: rand(70, 330), by: 0, vx: dir * (fast ? rand(170, 230) : rand(70, 140)),
          r: fast ? rand(15, 18) : rand(20, 25), c: pick(["#22d3ee", "#a855f7", "#f472b6", "#4ade80", "#facc15"]), ph: rand(0, TAU) });
        s.ufos[s.ufos.length - 1].by = s.ufos[s.ufos.length - 1].y;
        s.spawn = ph === "play" ? rand(0.6, 1.05) : 1.6;
      }
    }
    for (const u of s.ufos) { u.x += u.vx * dt; u.y = u.by + Math.sin(s.t * 2.4 + u.ph) * 16; }
    s.ufos = s.ufos.filter(u => u.x > -60 && u.x < W + 60);
    s.rings.forEach(r => { r.life -= dt; });
    s.rings = s.rings.filter(r => r.life > 0);
    stepParts(s.parts, dt);

    c.save();
    shakeIt(c, s, dt);
    sky(c, W, H, ["#05061a", "#151a45", "#3a2a6b"]);
    drawStars(c, stars, s.t);
    // lune
    const gm = c.createRadialGradient(W - 70, 70, 4, W - 70, 70, 60);
    gm.addColorStop(0, "rgba(254,243,199,.5)"); gm.addColorStop(1, "rgba(254,243,199,0)");
    c.fillStyle = gm; c.fillRect(W - 140, 0, 140, 140);
    circle(c, W - 70, 70, 22, "#fef3c7");
    circle(c, W - 76, 64, 4, "rgba(180,160,120,.35)"); circle(c, W - 62, 78, 3, "rgba(180,160,120,.35)");
    // collines et ferme d'impression
    c.fillStyle = "#0d0b24";
    c.beginPath(); c.moveTo(-20, H);
    for (let x = -20; x <= W + 20; x += 12) c.lineTo(x, 400 + Math.sin(x * 0.02) * 14 + Math.sin(x * 0.051) * 6);
    c.lineTo(W + 20, H); c.closePath(); c.fill();
    c.fillStyle = "#16123a"; c.fillRect(60, 372, 110, 40);
    c.beginPath(); c.moveTo(54, 374); c.lineTo(115, 350); c.lineTo(176, 374); c.fill();
    for (let i = 0; i < 4; i++) { c.fillStyle = (i + Math.floor(s.t)) % 3 ? "rgba(253,224,71,.8)" : "rgba(253,224,71,.35)"; c.fillRect(70 + i * 25, 384, 12, 9); }
    txt(c, "FERME D'IMPRESSION", 115, 404, 7, "rgba(253,224,71,.5)", { weight: 800 });
    for (const u of s.ufos) drawSaucer(c, u, s.t);
    for (const r of s.rings) {
      c.strokeStyle = r.hit ? `rgba(253,230,138,${r.life / 0.3})` : `rgba(255,255,255,${r.life / 0.3 * 0.6})`;
      c.lineWidth = 2; c.beginPath(); c.arc(r.x, r.y, 26 - r.life * 50, 0, TAU); c.stroke();
    }
    c.globalCompositeOperation = "lighter";
    drawParts(c, s.parts.filter(p => p.kind !== "text"));
    c.globalCompositeOperation = "source-over";
    drawParts(c, s.parts.filter(p => p.kind === "text"));
    if (play) drawAim(c, s, s.t, "#a5f3fc");
    c.restore();
  });

  return (
    <Stage bg="radial-gradient(ellipse at 50% 20%, #2b2a6b 0%, #0b0b25 60%, #03030c 100%)" won={a.won}>
      <Shell a={a} cvs={cvs} title="Invasion d'OVNI" emoji="🛸" goal={GOAL} accent="#06b6d4" onStart={start}
        rule="Des soucoupes lorgnent la ferme d'impression. Touche-les pour les changer en paillettes : 10 en 30 s !"
        hint="Tap ou clic ; au clavier, flèches pour viser et espace"
        ev={{ onPointerDown: e => { e.preventDefault(); shoot(cvs.at(e)); } }}/>
    </Stage>
  );
}

/* ================================================================ 9. fusee */

function drawRocket(c, x, y, t, firing) {
  c.save();
  c.translate(x, y);
  if (firing) {
    const fl = 1 + Math.sin(t * 40) * 0.12 + Math.sin(t * 23) * 0.08;
    const gf = c.createLinearGradient(0, 0, 0, 70 * fl);
    gf.addColorStop(0, "rgba(255,255,255,.95)"); gf.addColorStop(0.25, "rgba(253,224,71,.95)");
    gf.addColorStop(0.6, "rgba(249,115,22,.8)"); gf.addColorStop(1, "rgba(239,68,68,0)");
    c.fillStyle = gf;
    c.beginPath(); c.moveTo(-11, 0); c.quadraticCurveTo(-14, 30 * fl, 0, 72 * fl); c.quadraticCurveTo(14, 30 * fl, 11, 0); c.closePath(); c.fill();
  }
  // ailerons
  c.fillStyle = "#dc2626";
  c.beginPath(); c.moveTo(-14, -30); c.lineTo(-28, -2); c.lineTo(-14, -6); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(14, -30); c.lineTo(28, -2); c.lineTo(14, -6); c.closePath(); c.fill();
  // tuyere
  c.fillStyle = "#4b5563"; c.beginPath(); c.moveTo(-9, -6); c.lineTo(9, -6); c.lineTo(12, 2); c.lineTo(-12, 2); c.closePath(); c.fill();
  // corps
  const g = c.createLinearGradient(-15, 0, 15, 0);
  g.addColorStop(0, "#9ca3af"); g.addColorStop(0.35, "#ffffff"); g.addColorStop(1, "#6b7280");
  c.fillStyle = g;
  c.beginPath(); c.moveTo(-15, -6); c.lineTo(-15, -70); c.quadraticCurveTo(-14, -100, 0, -118); c.quadraticCurveTo(14, -100, 15, -70); c.lineTo(15, -6); c.closePath(); c.fill();
  c.strokeStyle = "rgba(0,0,0,.08)"; c.lineWidth = 1; c.beginPath();
  for (let yy = -10; yy > -70; yy -= 4) { c.moveTo(-15, yy); c.lineTo(15, yy); }
  c.stroke();
  c.fillStyle = "#f97316"; c.fillRect(-15, -40, 30, 7);
  // hublot
  circle(c, 0, -76, 8, "#374151");
  const gw = c.createRadialGradient(-2, -78, 1, 0, -76, 7);
  gw.addColorStop(0, "#e0f2fe"); gw.addColorStop(1, "#0284c7");
  circle(c, 0, -76, 6, gw);
  txt(c, "BN", 0, -54, 9, "#1f2937", { weight: 900 });
  // nez
  c.fillStyle = "#dc2626";
  c.beginPath(); c.moveTo(-8, -106); c.quadraticCurveTo(0, -124, 8, -106); c.quadraticCurveTo(0, -102, -8, -106); c.fill();
  c.restore();
}

function Fusee() {
  const W = 360, H = 520, GROUND = 470, STEP = 0.42, WIN = 0.3;
  const a = useArcade("fusee", null);
  const cvs = useCanvas(W, H);
  const stars = useStars(110, W, H);
  const [best, setBest] = useState(null);
  const [tries, setTries] = useState(0);
  const fresh = () => ({ mode: "idle", t: 0, t0: 0, zero: 0, ry: 0, rv: 0, cam: 0, parts: [], shake: 0, gap: 0, flash: 0, lt: 0 });
  const S = useRef(null);
  if (!S.current) S.current = fresh();

  const start = () => {
    const s = fresh();
    s.mode = "count"; s.t0 = 0.8; s.zero = s.t0 + 10 * STEP;
    S.current = s; setTries(n => n + 1); a.go("play");
  };
  const press = () => {
    const s = S.current;
    if (a.ph.current !== "play" || s.mode !== "count") return;
    const d = s.t - s.zero, ms = Math.round(Math.abs(d) * 1000);
    if (Math.abs(d) <= WIN) {
      s.mode = "launch"; s.gap = ms; s.shake = 6; s.flash = 1; s.lt = 0;
      a.win();
      setBest(b => (b == null ? ms : Math.min(b, ms)));
    } else if (d < 0) {
      s.mode = "fail";
      a.end(`Trop tôt de ${(-d).toFixed(2).replace(".", ",")} s : les moteurs n'étaient pas chauds.`, "Faux départ !");
    }
  };
  useKeyPress(e => { if (e.key === " " || e.key === "Enter" || e.key === "ArrowUp") press(); });

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    s.t += dt;
    s.flash = Math.max(0, s.flash - dt * 2);
    if (s.mode === "count" && s.t - s.zero > WIN) {
      s.mode = "fail";
      a.end("Trop tard ! La fenêtre de tir s'est refermée.", "Raté !");
    }
    if (s.mode === "launch") {
      s.lt += dt;
      s.rv += (40 + s.lt * 90) * dt;
      s.ry += s.rv * dt;
      if (s.lt < 5) s.shake = Math.max(s.shake, s.ry < 200 ? 2.5 : 0.8);
      const ny = GROUND - 20 - s.ry;
      burst(s.parts, W / 2, ny + 30, 3, ["#fde047", "#f97316", "#fff"], 90, { ang: Math.PI / 2, spread: 0.35, g: 200, life: 0.4 });
      if (s.ry < 260) {
        for (let i = 0; i < 2; i++) {
          const sd = Math.random() < 0.5 ? -1 : 1;
          s.parts.push({ x: W / 2 + rand(-10, 10), y: GROUND - 6, vx: sd * rand(40, 170), vy: rand(-30, -5), life: rand(1.4, 2.4), max: 2.4,
            r: rand(8, 14), c: pick(["#e5e7eb", "#d1d5db", "#f3f4f6"]), g: -8, drag: 0.97, kind: "smoke", rot: 0, vr: 0 });
        }
      }
      if (s.lt > 5.5 && a.ph.current === "play") {
        a.end(`Décollage parfait, à ${s.gap} ms du zéro. Direction l'orbite !`, "Bravo ! 🚀");
      }
    }
    s.cam = Math.max(0, s.ry - 160);
    stepParts(s.parts, dt);

    const cam = s.cam, alt = clamp(cam / 1600, 0, 1);
    c.save();
    shakeIt(c, s, dt);
    sky(c, W, H, ["#2a2f6b", "#c25a72", "#ffb36b"]);
    if (alt > 0) { c.globalAlpha = alt; sky(c, W, H, ["#020214", "#0b0f33", "#1e1b4b"]); c.globalAlpha = 1; }
    drawStars(c, stars, s.t, 0.25 + alt * 0.75);
    c.save();
    c.translate(0, cam);
    // nuages en altitude
    for (const [wy, x0] of [[-260, 60], [-600, 220], [-1000, 90]]) {
      c.fillStyle = "rgba(255,255,255,.7)";
      c.beginPath(); c.ellipse(x0, wy, 60, 16, 0, 0, TAU); c.ellipse(x0 + 40, wy - 10, 40, 14, 0, 0, TAU); c.fill();
    }
    // montagnes
    c.fillStyle = "#5b2a52";
    c.beginPath(); c.moveTo(-20, GROUND);
    for (let x = -20; x <= W + 20; x += 20) c.lineTo(x, 380 + Math.sin(x * 0.03) * 24 + Math.sin(x * 0.07) * 10);
    c.lineTo(W + 20, GROUND); c.closePath(); c.fill();
    // sol
    const gg = c.createLinearGradient(0, GROUND, 0, GROUND + 60);
    gg.addColorStop(0, "#3f2a3a"); gg.addColorStop(1, "#1a1018");
    c.fillStyle = gg; c.fillRect(-20, GROUND, W + 40, 300);
    // pas de tir
    c.fillStyle = "#4b5563"; c.fillRect(W / 2 - 50, GROUND - 14, 100, 14);
    c.fillStyle = "#facc15";
    for (let i = 0; i < 6; i++) c.fillRect(W / 2 - 48 + i * 17, GROUND - 14, 8, 3);
    // tour de lancement
    c.strokeStyle = "#9ca3af"; c.lineWidth = 2;
    const tx = W / 2 + 46;
    c.beginPath();
    c.moveTo(tx, GROUND - 14); c.lineTo(tx, GROUND - 150); c.moveTo(tx + 18, GROUND - 14); c.lineTo(tx + 18, GROUND - 150);
    for (let y = GROUND - 14; y > GROUND - 150; y -= 16) { c.moveTo(tx, y); c.lineTo(tx + 18, y - 16); c.moveTo(tx + 18, y); c.lineTo(tx, y - 16); }
    c.stroke();
    const armA = s.mode === "launch" ? Math.min(1, s.lt * 2) : 0;
    c.fillStyle = "#6b7280"; c.save(); c.translate(tx, GROUND - 100); c.rotate(-armA * 0.9); c.fillRect(-28, -3, 28, 6); c.restore();
    circle(c, tx + 9, GROUND - 154, 3, Math.floor(s.t * 2) % 2 ? "#ef4444" : "#7f1d1d");
    drawParts(c, s.parts.filter(p => p.kind === "smoke"));
    drawRocket(c, W / 2, GROUND - 14 - s.ry, s.t, s.mode === "launch");
    c.globalCompositeOperation = "lighter";
    drawParts(c, s.parts.filter(p => p.kind !== "smoke"));
    c.globalCompositeOperation = "source-over";
    c.restore();
    // compte a rebours
    if (s.mode === "count" || s.mode === "fail") {
      const rem = s.zero - s.t;
      const label = s.t < s.t0 ? "Prêts ?" : rem > 0 ? String(Math.min(10, Math.ceil(rem / STEP))) : "0";
      const frac = s.t < s.t0 ? 0 : rem > 0 ? (rem / STEP) % 1 : 0;
      c.save();
      c.strokeStyle = "rgba(255,255,255,.18)"; c.lineWidth = 8;
      c.beginPath(); c.arc(W / 2, 140, 58, 0, TAU); c.stroke();
      c.strokeStyle = rem <= STEP ? "#ef4444" : "#fde68a";
      c.beginPath(); c.arc(W / 2, 140, 58, -Math.PI / 2, -Math.PI / 2 + TAU * frac); c.stroke();
      txt(c, label, W / 2, 142, label.length > 2 ? 28 : 64, rem <= STEP && s.t >= s.t0 ? "#fecaca" : "#fff", { stroke: 6, weight: 900 });
      txt(c, "Appuie sur Décollage pile à 0 !", W / 2, 228, 14, "#fff", { stroke: 4 });
      c.restore();
    }
    if (s.mode === "launch") {
      txt(c, `Décollage ! (${s.gap} ms)`, W / 2, 110, 24, "#fde68a", { stroke: 5 });
      txt(c, `Altitude ${Math.round(s.ry * 3)} m`, W / 2, 142, 14, "#fff", { stroke: 4 });
    }
    if (s.flash > 0) { c.fillStyle = `rgba(255,240,200,${s.flash * 0.5})`; c.fillRect(-20, -20, W + 40, H + 40); }
    c.restore();
  });

  const counting = a.phase === "play";
  return (
    <Stage bg="linear-gradient(180deg, #0b0f33 0%, #5b2a52 60%, #c25a72 100%)" won={a.won}>
      <Shell a={a} cvs={cvs} title="Compte à rebours" emoji="🚀" accent="#ef4444" onStart={start}
        rule="Le compte défile vite : appuie sur Décollage pile à 0 (à 0,3 s près) pour lancer la fusée !"
        hint="Bouton, tap sur la scène ou espace"
        hudLeft={`🎯 Essai ${tries}`} hudRight={`Meilleur écart ${best == null ? "—" : `${best} ms`}`}
        summary={`Essais : ${tries} · Meilleur écart : ${best == null ? "—" : `${best} ms`}`}
        ev={{ onPointerDown: e => { e.preventDefault(); press(); } }}
        pad={(
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <Btn color="#dc2626" onPointerDown={e => { e.preventDefault(); press(); }} disabled={!counting}
              style={{ fontSize: 20, padding: "14px 34px", borderRadius: 16, opacity: counting ? 1 : 0.5, touchAction: "none" }}>
              🚀 Décollage
            </Btn>
          </div>
        )}/>
    </Stage>
  );
}

/* =============================================================== 10. bulles */

function drawBubble(c, b, t) {
  const { x, y, r } = b;
  const h = (b.hue + t * 40) % 360;
  const g = c.createRadialGradient(x - r * 0.2, y - r * 0.25, r * 0.1, x, y, r);
  g.addColorStop(0, "rgba(255,255,255,.03)"); g.addColorStop(0.7, "rgba(255,255,255,.06)");
  g.addColorStop(0.9, `hsla(${h},90%,72%,.3)`); g.addColorStop(1, `hsla(${(h + 70) % 360},90%,78%,.6)`);
  circle(c, x, y, r, g);
  let st;
  if (c.createConicGradient) {
    st = c.createConicGradient(t * 0.8 + b.ph, x, y);
    for (let i = 0; i <= 6; i++) st.addColorStop(i / 6, `hsla(${(h + i * 60) % 360},95%,70%,.55)`);
  } else st = `hsla(${h},90%,75%,.5)`;
  c.strokeStyle = st; c.lineWidth = 1.6;
  c.beginPath(); c.arc(x, y, r - 0.8, 0, TAU); c.stroke();
  c.fillStyle = "rgba(255,255,255,.75)";
  c.beginPath(); c.ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.11, -0.7, 0, TAU); c.fill();
  circle(c, x + r * 0.35, y + r * 0.4, r * 0.06, "rgba(255,255,255,.6)");
  if (b.benchy) { c.globalAlpha = 0.85; txt(c, "🚤", x, y + 1, r * 0.8, "#fff"); c.globalAlpha = 1; }
}

function Bulles() {
  const W = 360, H = 480, GOAL = 50, DUR = 40;
  const a = useArcade("bulles", GOAL);
  const cvs = useCanvas(W, H);
  const keys = useKeys();
  const fresh = () => ({ bubbles: [], parts: [], pops: [], spawn: 0, time: DUR, score: 0, t: 0, done: false, shake: 0, aim: null });
  const S = useRef(null);
  if (!S.current) S.current = fresh();
  const bokeh = useStars(16, W, H);

  const start = () => { const aim = S.current.aim; S.current = fresh(); S.current.aim = aim; a.score(0); a.extra(`⏱ ${DUR}`); a.go("play"); };
  const pop = p => {
    const s = S.current;
    if (a.ph.current !== "play" || s.done) return;
    for (let i = s.bubbles.length - 1; i >= 0; i--) {
      const b = s.bubbles[i];
      if (Math.hypot(b.x - p.x, b.y - p.y) > b.r + 8) continue;
      s.bubbles.splice(i, 1);
      s.score += 1; a.score(s.score);
      s.pops.push({ x: b.x, y: b.y, r: b.r, life: 0.3, hue: b.hue });
      burst(s.parts, b.x, b.y, 10, ["#e0f2fe", "#fbcfe8", "#ddd6fe", "#fff"], 120, { g: 260, life: 0.5, size: 0.8 });
      floatText(s.parts, b.x, b.y - b.r, s.score === GOAL ? "50 !" : "pop", s.score === GOAL ? "#fde68a" : "#fff", s.score === GOAL ? 26 : 12);
      return;
    }
  };
  useKeyPress(e => {
    if (e.key !== " ") return;
    const s = S.current;
    if (!s.aim) s.aim = { x: W / 2, y: H / 2 };
    pop(s.aim);
  });

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    s.t += dt;
    const ph = a.ph.current, play = ph === "play" && !s.done;
    if (play) {
      aimStep(s, keys, dt, W, H);
      s.time -= dt;
      a.extra(`⏱ ${Math.max(0, Math.ceil(s.time))}`);
      if (s.time <= 0) {
        s.done = true;
        a.end(s.score >= GOAL ? `${s.score} bulles éclatées : le roi du pop !` : `${s.score} bulle${s.score > 1 ? "s" : ""}, il en fallait ${GOAL}. Plus vite !`,
          s.score >= GOAL ? "Bravo !" : "Temps écoulé");
      }
    }
    if (ph !== "over") {
      s.spawn -= dt;
      if (s.spawn <= 0) {
        const r = rand(16, 34);
        s.bubbles.push({ x: rand(r, W - r), y: H + r, r, vy: rand(55, 95) * (34 / r) ** 0.35, ph: rand(0, TAU), hue: rand(0, 360),
          sway: rand(10, 26), bx: 0, benchy: Math.random() < 0.08 });
        const b = s.bubbles[s.bubbles.length - 1];
        b.bx = b.x;
        s.spawn = ph === "play" ? Math.max(0.28, 0.48 - (1 - s.time / DUR) * 0.18) : 0.7;
      }
    }
    for (const b of s.bubbles) {
      b.y -= b.vy * dt * (play ? 1 + (1 - s.time / DUR) * 0.4 : 1);
      b.x = b.bx + Math.sin(s.t * 1.4 + b.ph) * b.sway;
    }
    s.bubbles = s.bubbles.filter(b => b.y > -b.r - 10);
    s.pops.forEach(p => { p.life -= dt; });
    s.pops = s.pops.filter(p => p.life > 0);
    stepParts(s.parts, dt);

    c.save();
    shakeIt(c, s, dt);
    sky(c, W, H, ["#ffd6c2", "#f9b9d4", "#c7b8f5", "#9ec5f7"]);
    for (const k of bokeh) {
      c.globalAlpha = 0.12 + 0.08 * Math.sin(s.t + k.ph);
      circle(c, k.x, k.y, 20 + k.r * 20, "#fff");
    }
    c.globalAlpha = 1;
    // souffleur : un anneau imprime en bas
    c.strokeStyle = "#f97316"; c.lineWidth = 5;
    c.beginPath(); c.ellipse(W / 2, H - 18, 26, 8, 0, 0, TAU); c.stroke();
    c.fillStyle = "#f97316"; c.fillRect(W / 2 - 3, H - 12, 6, 20);
    for (const b of s.bubbles) drawBubble(c, b, s.t);
    for (const p of s.pops) {
      const k = 1 - p.life / 0.3;
      c.strokeStyle = `hsla(${p.hue},90%,80%,${p.life / 0.3})`; c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * TAU, r0 = p.r * (0.8 + k * 0.5), r1 = p.r * (1 + k * 0.9);
        c.moveTo(p.x + Math.cos(an) * r0, p.y + Math.sin(an) * r0); c.lineTo(p.x + Math.cos(an) * r1, p.y + Math.sin(an) * r1);
      }
      c.stroke();
    }
    drawParts(c, s.parts);
    if (play) drawAim(c, s, s.t, "#7c3aed");
    c.restore();
  });

  return (
    <Stage bg="linear-gradient(160deg, #ffd6c2 0%, #f3a8c8 45%, #8fb3f0 100%)" color="#2e1065" won={a.won}>
      <Shell a={a} cvs={cvs} title="Bulles de savon" emoji="🫧" goal={GOAL} accent="#a855f7" onStart={start}
        rule="Éclate les bulles irisées avant qu'elles s'envolent : 50 bulles en 40 s !"
        hint="Tap ou clic ; au clavier, flèches pour viser et espace"
        ev={{ onPointerDown: e => { e.preventDefault(); pop(cvs.at(e)); } }}/>
    </Stage>
  );
}

/* ============================================================ 11. feux */

const FW = ["#f87171", "#fb923c", "#fde047", "#4ade80", "#22d3ee", "#60a5fa", "#c084fc", "#f472b6", "#ffffff"];

function Feux() {
  const W = 360, H = 480, GOAL = 20;
  const a = useArcade("feux", GOAL);
  const cvs = useCanvas(W, H);
  const keys = useKeys();
  const stars = useStars(90, W, H * 0.7);
  const city = useRef(null);
  if (!city.current) {
    const b = [];
    let x = -10;
    while (x < W + 10) {
      const w = rand(26, 48), h = rand(50, 150), wins = [];
      for (let yy = H - h + 10; yy < H - 12; yy += 12) for (let xx = x + 5; xx < x + w - 8; xx += 9) if (Math.random() < 0.45) wins.push({ x: xx, y: yy, ph: rand(0, 50) });
      b.push({ x, w, h, wins, ant: Math.random() < 0.25 });
      x += w + rand(-2, 4);
    }
    city.current = b;
  }
  const fresh = () => ({ rockets: [], sparks: [], parts: [], count: 0, finale: [], flash: 0, flashC: "#fff", t: 0, shake: 0, aim: null, auto: 0 });
  const S = useRef(null);
  if (!S.current) S.current = fresh();

  const start = () => { const aim = S.current.aim; S.current = fresh(); S.current.aim = aim; a.score(0); a.go("play"); };
  const rocket = (s, tx, ty) => {
    ty = clamp(ty, 50, H - 170);
    const x0 = clamp(tx + rand(-30, 30), 10, W - 10);
    s.rockets.push({ x: x0, y: H, sx: x0, sy: H, tx, ty, t: 0, dur: rand(0.75, 1.05), c: pick(FW) });
  };
  const launch = p => {
    const s = S.current;
    if (a.ph.current !== "play") return;
    rocket(s, p.x, p.y);
    s.count += 1; a.score(s.count);
    if (s.count === GOAL) {
      floatText(s.parts, W / 2, 110, "Bouquet final !", "#fde68a", 26);
      for (let i = 0; i < 30; i++) s.finale.push(0.6 + i * 0.12 + rand(0, 0.1));
    }
  };
  useKeyPress(e => {
    if (e.key !== " ") return;
    const s = S.current;
    if (!s.aim) s.aim = { x: W / 2, y: H / 3 };
    launch(s.aim);
  });
  const explode = (s, x, y, col) => {
    const type = pick(["pivoine", "pivoine", "anneau", "palmier", "saule", "coeur", "double"]);
    const c2 = pick(FW);
    const add = (vx, vy, c, o = {}) => s.sparks.push({ x, y, vx, vy, c, life: o.life || rand(1.1, 1.6), max: o.life || 1.6,
      g: o.g || 70, drag: o.drag || 0.975, tr: [], tw: Math.random() < 0.4 });
    if (type === "pivoine" || type === "double") {
      const n = 70;
      for (let i = 0; i < n; i++) { const an = (i / n) * TAU + rand(-0.05, 0.05), v = rand(110, 150); add(Math.cos(an) * v, Math.sin(an) * v, col); }
      if (type === "double") for (let i = 0; i < 40; i++) { const an = (i / 40) * TAU, v = 70; add(Math.cos(an) * v, Math.sin(an) * v, c2); }
    } else if (type === "anneau") {
      const tilt = rand(0.3, 0.7), rot = rand(0, Math.PI);
      for (let i = 0; i < 56; i++) {
        const an = (i / 56) * TAU, vx = Math.cos(an) * 140, vy = Math.sin(an) * 140 * tilt;
        add(vx * Math.cos(rot) - vy * Math.sin(rot), vx * Math.sin(rot) + vy * Math.cos(rot), i % 2 ? col : c2, { g: 40 });
      }
    } else if (type === "palmier") {
      for (let i = 0; i < 9; i++) {
        const an = -Math.PI / 2 + (i - 4) * 0.36;
        for (let k = 0; k < 6; k++) add(Math.cos(an) * (80 + k * 18), Math.sin(an) * (80 + k * 18), "#fcd34d", { g: 130, life: 1.5 });
      }
    } else if (type === "saule") {
      for (let i = 0; i < 70; i++) { const an = rand(0, TAU), v = rand(40, 120); add(Math.cos(an) * v, Math.sin(an) * v, "#fde68a", { g: 55, drag: 0.965, life: rand(1.8, 2.4) }); }
    } else {
      for (let i = 0; i < 60; i++) {
        const q = (i / 60) * TAU;
        const hx = 16 * Math.sin(q) ** 3, hy = -(13 * Math.cos(q) - 5 * Math.cos(2 * q) - 2 * Math.cos(3 * q) - Math.cos(4 * q));
        add(hx * 7.5, hy * 7.5, "#f472b6", { g: 30 });
      }
    }
    s.flash = 1; s.flashC = col; s.shake = 2.5;
  };

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    s.t += dt;
    s.flash = Math.max(0, s.flash - dt * 3);
    const ph = a.ph.current;
    if (ph === "play") aimStep(s, keys, dt, W, H);
    if (ph === "menu") { s.auto -= dt; if (s.auto <= 0) { s.auto = rand(0.9, 1.6); rocket(s, rand(60, W - 60), rand(80, 220)); } }
    if (s.finale.length) {
      s.finale = s.finale.map(v => v - dt);
      while (s.finale.length && s.finale[0] <= 0) { s.finale.shift(); rocket(s, rand(30, W - 30), rand(60, 240)); }
    }
    for (const r of s.rockets) {
      r.t += dt;
      const k = clamp(r.t / r.dur, 0, 1), e = 1 - (1 - k) * (1 - k);
      r.x = lerp(r.sx, r.tx, e); r.y = lerp(r.sy, r.ty, e);
      if (Math.random() < 0.9) s.parts.push({ x: r.x + rand(-1, 1), y: r.y + 4, vx: rand(-15, 15), vy: rand(20, 60), life: 0.45, max: 0.45, r: 1.4, c: "#fed7aa", g: 60, drag: 0.97, kind: "dot", rot: 0, vr: 0 });
      if (k >= 1) { r.done = true; explode(s, r.x, r.y, r.c); }
    }
    s.rockets = s.rockets.filter(r => !r.done);
    for (let i = s.sparks.length - 1; i >= 0; i--) {
      const p = s.sparks[i];
      p.life -= dt;
      if (p.life <= 0) { s.sparks.splice(i, 1); continue; }
      p.tr.push(p.x, p.y);
      if (p.tr.length > 12) p.tr.splice(0, 2);
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    stepParts(s.parts, dt);

    c.save();
    shakeIt(c, s, dt);
    sky(c, W, H, ["#04051a", "#10133d", "#2a1d4f", "#4a2a5a"]);
    drawStars(c, stars, s.t, 0.8);
    if (s.flash > 0) { c.globalAlpha = s.flash * 0.18; c.fillStyle = s.flashC; c.fillRect(-20, -20, W + 40, H + 40); c.globalAlpha = 1; }
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    for (const p of s.sparks) {
      const al = clamp(p.life / p.max, 0, 1) * (p.tw ? 0.6 + 0.4 * Math.sin(p.life * 50) : 1);
      c.strokeStyle = hexA(p.c, al * 0.55); c.lineWidth = 1.6;
      c.beginPath();
      for (let k = 0; k < p.tr.length; k += 2) { if (k === 0) c.moveTo(p.tr[k], p.tr[k + 1]); else c.lineTo(p.tr[k], p.tr[k + 1]); }
      c.lineTo(p.x, p.y); c.stroke();
      c.globalAlpha = al; circle(c, p.x, p.y, 1.7, p.c); c.globalAlpha = 1;
    }
    for (const r of s.rockets) circle(c, r.x, r.y, 2.4, "#fff7ed");
    drawParts(c, s.parts.filter(p => p.kind !== "text"));
    c.globalCompositeOperation = "source-over";
    // ville
    for (const b of city.current) {
      const g = c.createLinearGradient(0, H - b.h, 0, H);
      g.addColorStop(0, "#1b1840"); g.addColorStop(1, "#0a0920");
      c.fillStyle = g; c.fillRect(b.x, H - b.h, b.w, b.h + 5);
      if (s.flash > 0) { c.fillStyle = hexA(s.flashC, s.flash * 0.12); c.fillRect(b.x, H - b.h, b.w, 3); }
      if (b.ant) { c.fillStyle = "#1b1840"; c.fillRect(b.x + b.w / 2 - 1, H - b.h - 18, 2, 18); circle(c, b.x + b.w / 2, H - b.h - 19, 2, Math.floor(s.t * 1.5 + b.x) % 2 ? "#ef4444" : "#450a0a"); }
      for (const w of b.wins) {
        const on = Math.sin(s.t * 0.3 + w.ph) > -0.6;
        c.fillStyle = on ? "rgba(253,224,140,.85)" : "rgba(253,224,140,.15)";
        c.fillRect(w.x, w.y, 4, 5);
      }
    }
    drawParts(c, s.parts.filter(p => p.kind === "text"));
    if (ph === "play") drawAim(c, s, s.t, "#fde68a");
    if (ph === "play" && s.count === 0) txt(c, "Tape le ciel pour lancer un feu", W / 2, 90, 16, "#fff", { stroke: 4 });
    c.restore();
  });

  return (
    <Stage bg="radial-gradient(ellipse at 50% 10%, #3b2a6b 0%, #10133d 55%, #04051a 100%)" won={a.won}>
      <Shell a={a} cvs={cvs} title="Feux d'artifice" emoji="🎆" goal={GOAL} accent="#f472b6" onStart={start}
        rule="Chaque tap lance une fusée qui éclate là où tu as tapé. Lance-en 20 pour le bouquet final !"
        hint="Tap ou clic dans le ciel ; au clavier, flèches pour viser et espace"
        hudRight={`Record ${a.hud.best}`}
        ev={{ onPointerDown: e => { e.preventDefault(); launch(cvs.at(e)); } }}/>
    </Stage>
  );
}

/* ============================================================ 12. reflexe */

function Reflexe() {
  const [won, win] = useWin("reflexe");
  const [st, setSt] = useState("menu");
  const [ms, setMs] = useState(0);
  const [best, setBest] = useState(null);
  const [hist, setHist] = useState([]);
  const goAt = useRef(0);
  const switchAt = useRef(0);
  const shownAt = useRef(0);

  useLoop(() => {
    if (performance.now() >= switchAt.current) { goAt.current = performance.now(); setSt("go"); }
  }, st === "wait");

  const arm = () => { switchAt.current = performance.now() + rand(1400, 4200); setSt("wait"); };
  const press = () => {
    if (st === "wait") { setSt("early"); shownAt.current = performance.now(); return; }
    if (st === "go") {
      const d = Math.round(performance.now() - goAt.current);
      setMs(d);
      setBest(b => (b == null ? d : Math.min(b, d)));
      setHist(h => [d, ...h].slice(0, 5));
      if (d < 300) win();
      shownAt.current = performance.now();
      setSt("res");
      return;
    }
    if ((st === "res" || st === "early") && performance.now() - shownAt.current > 400) arm();
  };
  useKeyPress(e => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (st === "menu") arm(); else press();
  });

  const verdict = d => (d < 200 ? "Réflexes de buse à 500 mm/s !" : d < 250 ? "Excellent, du premier coup de buse !"
    : d < 300 ? "Très bien, sous les 300 ms !" : d < 400 ? "Pas mal… mais la première couche attend." : "Il faut préchauffer un peu…");
  const theme = {
    menu: { bg: "radial-gradient(ellipse at 50% 30%, #fb923c 0%, #9a3412 60%, #431407 100%)" },
    wait: { bg: "radial-gradient(ellipse at 50% 40%, #ef4444 0%, #991b1b 60%, #450a0a 100%)" },
    go: { bg: "radial-gradient(ellipse at 50% 40%, #4ade80 0%, #15803d 60%, #052e16 100%)" },
    res: { bg: "radial-gradient(ellipse at 50% 30%, #60a5fa 0%, #1e40af 60%, #0b1437 100%)" },
    early: { bg: "radial-gradient(ellipse at 50% 30%, #f59e0b 0%, #b45309 60%, #451a03 100%)" },
  }[st];

  return (
    <Stage bg={theme.bg} won={won}>
      <style>{`
        @keyframes reflexe-pulse { 0%,100% { transform:scale(1) } 50% { transform:scale(1.06) } }
        @keyframes reflexe-heat { 0%,100% { filter:drop-shadow(0 0 8px rgba(255,120,60,.6)) } 50% { filter:drop-shadow(0 0 22px rgba(255,200,80,.9)) } }
        @keyframes reflexe-go { from { transform:scale(.7); opacity:0 } to { transform:scale(1); opacity:1 } }
        @keyframes reflexe-shake { 0%,100% { transform:translateX(0) } 25% { transform:translateX(-8px) } 75% { transform:translateX(8px) } }
      `}</style>
      <div onPointerDown={e => { if (st !== "menu") { e.preventDefault(); press(); } }}
        style={{ width: "100%", maxWidth: 720, minHeight: "min(480px, calc(100dvh - 220px))", borderRadius: 22,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 20,
          cursor: st === "menu" ? "default" : "pointer", touchAction: "manipulation", textAlign: "center",
          background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.18)",
          boxShadow: "inset 0 0 60px rgba(0,0,0,.25), 0 20px 50px rgba(0,0,0,.35)", fontFamily: FONT, position: "relative" }}>
        {st === "menu" && (
          <>
            <div style={{ fontSize: 64, animation: "hk-float 2.6s ease-in-out infinite" }}>⚡</div>
            <Title sub="L'écran est rouge : attends. Dès qu'il passe au vert, tape ! Fais moins de 300 ms.">Réflexe de buse</Title>
            <Btn color="#ea580c" onClick={arm} style={{ fontSize: 18, padding: "12px 30px" }}>▶ Jouer</Btn>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.65 }}>Tap, clic, espace ou Entrée</p>
          </>
        )}
        {st === "wait" && (
          <>
            <div style={{ fontSize: 72, animation: "reflexe-heat 1s ease-in-out infinite" }}>🔥</div>
            <div style={{ fontSize: "clamp(34px, 9vw, 60px)", fontWeight: 900, animation: "reflexe-pulse 1.2s ease-in-out infinite" }}>Attends…</div>
            <p style={{ margin: 0, opacity: 0.85 }}>La buse chauffe. Pas encore !</p>
          </>
        )}
        {st === "go" && (
          <div style={{ animation: "reflexe-go .12s ease-out both" }}>
            <div style={{ fontSize: 80 }}>🟢</div>
            <div style={{ fontSize: "clamp(40px, 11vw, 72px)", fontWeight: 900 }}>Imprime !</div>
          </div>
        )}
        {st === "res" && (
          <>
            <div style={{ fontSize: "clamp(56px, 16vw, 96px)", fontWeight: 900, lineHeight: 1, textShadow: "0 4px 24px rgba(0,0,0,.35)",
              color: ms < 300 ? "#fde68a" : "#fff", animation: "reflexe-go .3s ease-out both" }}>{ms} ms</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{verdict(ms)}</div>
            <p style={{ margin: 0, opacity: 0.85 }}>Meilleur temps : <b>{best} ms</b>{hist.length > 1 ? ` · derniers : ${hist.join(", ")}` : ""}</p>
            <Btn color="#2563eb" onPointerDown={e => e.stopPropagation()} onClick={arm} style={{ fontSize: 16 }}>↻ Rejouer</Btn>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.65 }}>ou touche n'importe où</p>
          </>
        )}
        {st === "early" && (
          <div style={{ animation: "reflexe-shake .35s ease-in-out 2" }}>
            <div style={{ fontSize: 64 }}>🙈</div>
            <div style={{ fontSize: "clamp(30px, 8vw, 52px)", fontWeight: 900 }}>Faux départ !</div>
            <p style={{ margin: "8px 0 14px", opacity: 0.9 }}>La couche n'était pas prête. Attends bien le vert.</p>
            <Btn color="#b45309" onPointerDown={e => e.stopPropagation()} onClick={arm} style={{ fontSize: 16 }}>↻ Rejouer</Btn>
          </div>
        )}
      </div>
    </Stage>
  );
}

/* ---------------------------------------------------------------- export */

export const PAGES = {
  "buse-volante": BuseVolante,
  "super-bambu": SuperBambu,
  serpent: Serpent,
  "casse-briques": CasseBriques,
  taupe: Taupe,
  tour: Tour,
  dragon: Dragon,
  ovni: Ovni,
  fusee: Fusee,
  bulles: Bulles,
  feux: Feux,
  reflexe: Reflexe,
};
