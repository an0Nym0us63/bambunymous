import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Stage, Title, useWin, useLoop, Btn, rand, pick } from "./kit";

// Pages cachees, lot « atelier d'impression » (23/10/2026) : huit petits jeux
// autour de la machine (plateau, premiere couche, sechoir, tour de purge,
// supports, slicer, AMS, cold pull). Le secret ne tombe qu'a la reussite.
// Chaque page garde ses keyframes dans son propre <style>, prefixees par son slug.

const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ */
/* Outils communs                                                      */
/* ------------------------------------------------------------------ */

/** Consigne discrete sous la scene, masquee une fois gagne. */
function Hint({ children, won, style }) {
  if (won) return null;
  return (
    <p style={{ margin:"10px auto 0", fontSize:12.5, opacity:.74, textAlign:"center", maxWidth:440, lineHeight:1.45,
      position:"relative", zIndex:2, fontFamily:SANS, ...style }}>{children}</p>
  );
}

/** Ecoute clavier avec les derniers gestionnaires (hors champs de saisie). */
function useKeyDown(down, up) {
  const r = useRef({ down, up });
  r.current = { down, up };
  useEffect(() => {
    const skip = e => /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || "");
    const d = e => { if (!skip(e) && r.current.down) r.current.down(e); };
    const u = e => { if (!skip(e) && r.current.up) r.current.up(e); };
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    return () => { window.removeEventListener("keydown", d); window.removeEventListener("keyup", u); };
  }, []);
}

/** Canevas de taille logique fixe (W x H), net sur ecran dense. */
function useFixedCanvas(W, H) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr; c.height = H * dpr;
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [W, H]);
  return ref;
}

/** Point du pointeur dans le repere logique d'un element W x H. */
function canvasPos(e, el, W, H) {
  const r = el.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}

/** Bouton a maintenir (souris, doigt) : on(true) a l'appui, on(false) au relacher. */
function HoldBtn({ on, children, color, disabled, style }) {
  const press = v => e => {
    if (disabled) return;
    if (v) { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* rien */ } }
    on(v);
  };
  return (
    <button type="button" disabled={disabled} onPointerDown={press(true)} onPointerUp={press(false)}
      onPointerCancel={press(false)} onLostPointerCapture={() => on(false)} onContextMenu={e => e.preventDefault()}
      style={{ padding:"14px 20px", borderRadius:14, border:"none", fontWeight:900, fontSize:16, color:"#fff",
        background: disabled ? "#475569" : color, cursor: disabled ? "default" : "pointer", touchAction:"none",
        boxShadow:"0 5px 0 rgba(0,0,0,.3)", fontFamily:SANS, opacity: disabled ? .55 : 1, ...style }}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* /plateau : nivellement aux quatre molettes                          */
/* ------------------------------------------------------------------ */

const PL_TOL = 2.5;                       // centiemes de mm
const PL_NAMES = ["Arrière gauche", "Arrière droit", "Avant gauche", "Avant droit"];
const PL_NEIGH = [[1, 2], [0, 3], [0, 3], [1, 2]];
const PL_PTS = [[64, 34], [256, 34], [24, 166], [296, 166]];
const PL_COL = { ok: "#22c55e", tight: "#ef4444", loose: "#38bdf8" };
const plState = g => (Math.abs(g) <= PL_TOL ? "ok" : g < 0 ? "tight" : "loose");
const plStart = () => [0, 1, 2, 3].map(() => { let v = 0; while (Math.abs(v) < 9) v = Math.round(rand(-24, 24)); return v; });
function plText(g) {
  const s = plState(g);
  if (s === "ok") return "Ça frotte juste ✓";
  if (s === "tight") return g < -14 ? "La buse laboure le PEI !" : "Trop serré : la feuille coince";
  return g > 14 ? "On glisserait un sandwich" : "Trop lâche : la feuille s'envole";
}
const plMm = g => `${g < 0 ? "−" : "+"}${(Math.abs(g) / 100).toFixed(2).replace(".", ",")} mm`;

function PlKnob({ angle, color, onDown, onMove, onUp }) {
  return (
    <svg viewBox="0 0 60 60" width="56" height="56" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      onPointerCancel={onUp} style={{ touchAction:"none", cursor:"grab", flex:"0 0 auto" }}>
      <circle cx="30" cy="30" r="28" fill="#0f172a" opacity=".4"/>
      <g transform={`rotate(${angle} 30 30)`}>
        {Array.from({ length: 12 }, (_, k) => (
          <rect key={k} x="27" y="1" width="6" height="8" rx="2" fill="#94a3b8" transform={`rotate(${k * 30} 30 30)`}/>
        ))}
        <circle cx="30" cy="30" r="23" fill="url(#plateau-knob)" stroke="#1e293b" strokeWidth="1.5"/>
        <rect x="28" y="9" width="4" height="12" rx="2" fill={color}/>
      </g>
      <circle cx="30" cy="30" r="5" fill="#334155"/>
    </svg>
  );
}

function Plateau() {
  const [won, win] = useWin("plateau");
  const [gap, setGap] = useState(plStart);
  const [ang, setAng] = useState([0, 0, 0, 0]);
  const [sel, setSel] = useState(0);
  const [crans, setCrans] = useState(0);
  const selRef = useRef(0);
  selRef.current = sel;

  // d = +1 : sens horaire, le coin remonte (l'ecart sous la buse diminue) ; les voisins suivent un peu
  const turn = useCallback((i, d) => {
    setGap(g => g.map((v, k) => (k === i ? v - d * 1.5 : PL_NEIGH[i].includes(k) ? v - d * 0.4 : v)));
    setAng(a => a.map((v, k) => (k === i ? v + d * 30 : v)));
    setSel(i);
    setCrans(n => n + 1);
  }, []);

  const okCount = gap.filter(v => plState(v) === "ok").length;
  useEffect(() => { if (crans > 0 && okCount === 4) win(); }, [okCount, crans, win]);

  useKeyDown(e => {
    if (e.key === "ArrowLeft") { e.preventDefault(); turn(selRef.current, -1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); turn(selRef.current, 1); }
    else if (["1", "2", "3", "4"].includes(e.key)) setSel(+e.key - 1);
  });

  const drag = useRef(null);
  const kDown = i => e => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* rien */ }
    const r = e.currentTarget.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    drag.current = { i, cx, cy, a: Math.atan2(e.clientY - cy, e.clientX - cx), acc: 0 };
    setSel(i);
  };
  const kMove = e => {
    const d = drag.current;
    if (!d) return;
    const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
    let da = a - d.a;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    d.a = a;
    d.acc += da * 180 / Math.PI;
    while (d.acc >= 30) { d.acc -= 30; turn(d.i, 1); }
    while (d.acc <= -30) { d.acc += 30; turn(d.i, -1); }
  };
  const kUp = () => { drag.current = null; };

  const [hx, hy] = PL_PTS[sel];
  const selState = plState(gap[sel]);
  return (
    <Stage won={won} wonText="Plateau de niveau, champagne !" font={SANS}
      bg="radial-gradient(circle at 50% 0%, #334155, #0f172a 72%)" style={{ justifyContent:"flex-start" }}>
      <style>{`
        @keyframes plateau-ring { 0%,100% { opacity:.9 } 50% { opacity:.25 } }
        @keyframes plateau-flap { 0%,100% { transform:translateY(0) rotate(-4deg) } 50% { transform:translateY(-4px) rotate(5deg) } }
      `}</style>
      <Title sub="Une feuille de papier sous la buse : elle doit frotter juste aux quatre coins.">Nivellement</Title>
      <svg viewBox="0 0 320 196" style={{ width:"100%", maxWidth:420, marginTop:34, overflow:"visible" }}>
        <defs>
          <linearGradient id="plateau-pei" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d6b06a"/><stop offset=".5" stopColor="#b8893f"/><stop offset="1" stopColor="#8a6328"/>
          </linearGradient>
          <radialGradient id="plateau-knob" cx=".35" cy=".3"><stop offset="0" stopColor="#e2e8f0"/><stop offset="1" stopColor="#64748b"/></radialGradient>
          <pattern id="plateau-dots" width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r=".9" fill="rgba(255,255,255,.22)"/><circle cx="5.5" cy="5" r=".7" fill="rgba(0,0,0,.18)"/>
          </pattern>
        </defs>
        <polygon points="58,26 262,26 306,176 14,176" fill="#020617" transform="translate(0,8)" opacity=".6"/>
        <polygon points="64,34 256,34 296,166 24,166" fill="url(#plateau-pei)" stroke="#5b4320" strokeWidth="2"/>
        <polygon points="64,34 256,34 296,166 24,166" fill="url(#plateau-dots)"/>
        <text x="160" y="110" textAnchor="middle" fontSize="13" fontWeight="800" fill="rgba(60,40,10,.5)">PEI texturé</text>
        {PL_PTS.map(([x, y], i) => {
          const s = plState(gap[i]);
          return (
            <g key={i} onClick={() => setSel(i)} style={{ cursor:"pointer" }}>
              {sel === i && <circle cx={x} cy={y} r="13" fill="none" stroke={PL_COL[s]} strokeWidth="2.5" style={{ animation:"plateau-ring 1.2s infinite" }}/>}
              <circle cx={x} cy={y} r="8" fill={PL_COL[s]} stroke="#0f172a" strokeWidth="2"/>
              <line x1={x - 4} y1={y} x2={x + 4} y2={y} stroke="#0f172a" strokeWidth="1.6" transform={`rotate(${ang[i]} ${x} ${y})`}/>
            </g>
          );
        })}
        {/* la tete et la feuille, au coin choisi */}
        <g style={{ transform:`translate(${hx}px, ${hy}px)`, transition:"transform .45s cubic-bezier(.3,1.3,.5,1)" }}>
          <g style={{ animation: selState === "loose" ? "plateau-flap .5s infinite" : "none" }}>
            <rect x="-14" y="-6" width="28" height="12" rx="1.5" fill="#f8fafc" stroke="#cbd5e1" transform={selState === "tight" ? "skewX(18)" : ""}/>
          </g>
          <polygon points="-6,-12 6,-12 0,-3" fill="#d4a017"/>
          <rect x="-16" y="-44" width="32" height="32" rx="5" fill="#e2e8f0" stroke="#475569" strokeWidth="1.5"/>
          <rect x="-16" y="-24" width="32" height="7" fill="#22c55e"/>
        </g>
      </svg>
      <div style={{ fontWeight:900, fontSize:15, margin:"4px 0 8px" }}>
        Coins réglés : <span style={{ color: okCount === 4 ? "#4ade80" : "#fbbf24" }}>{okCount} / 4</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, width:"100%", maxWidth:420 }}>
        {gap.map((g, i) => {
          const s = plState(g);
          const pos = clamp((g + 25) / 50, 0, 1);
          return (
            <div key={i} onClick={() => setSel(i)} style={{ borderRadius:14, padding:"8px 8px 9px",
              background: sel === i ? "rgba(255,255,255,.13)" : "rgba(255,255,255,.06)",
              border:`2px solid ${sel === i ? PL_COL[s] : "transparent"}`, transition:"background .2s" }}>
              <div style={{ fontSize:12, fontWeight:800, opacity:.85, textAlign:"center" }}>{i + 1}. {PL_NAMES[i]}</div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:4, margin:"4px 0" }}>
                <Btn color="#475569" style={{ padding:"8px 10px", fontSize:16 }} onClick={e => { e.stopPropagation(); turn(i, -1); }} aria-label="Baisser le coin">↺</Btn>
                <PlKnob angle={ang[i]} color={PL_COL[s]} onDown={kDown(i)} onMove={kMove} onUp={kUp}/>
                <Btn color="#475569" style={{ padding:"8px 10px", fontSize:16 }} onClick={e => { e.stopPropagation(); turn(i, 1); }} aria-label="Remonter le coin">↻</Btn>
              </div>
              <div style={{ position:"relative", height:10, borderRadius:6, overflow:"hidden",
                background:"linear-gradient(90deg, #ef4444, #f59e0b 38%, #22c55e 45%, #22c55e 55%, #38bdf8 62%, #3b82f6)" }}>
                <div style={{ position:"absolute", top:-2, bottom:-2, width:4, left:`calc(${pos * 100}% - 2px)`, background:"#fff",
                  boxShadow:"0 0 6px #000", transition:"left .2s" }}/>
              </div>
              <div style={{ fontSize:11.5, marginTop:5, textAlign:"center", color:PL_COL[s], fontWeight:700, minHeight:30 }}>
                {plText(g)}<br/><span style={{ fontFamily:MONO, opacity:.75, color:"#cbd5e1" }}>{plMm(g)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <Hint won={won}>↻ remonte le coin, ↺ le baisse (ou fais tourner la molette). Attention : un coin tire un peu sur ses voisins.
        Clavier : 1 à 4 puis ← →.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* /premiere-couche : tracer la premiere couche a la bonne vitesse     */
/* ------------------------------------------------------------------ */

const PC_W = 360, PC_H = 420, PC_LW = 22;
function pcPath() {
  const pts = [];
  const x0 = 50, x1 = 310, R = 28, lanes = 6, y0 = 62;
  for (let l = 0; l < lanes; l += 1) {
    const y = y0 + l * 2 * R, ltr = l % 2 === 0;
    const xa = ltr ? x0 : x1, xb = ltr ? x1 : x0;
    const n = Math.ceil(Math.abs(xb - xa) / 4);
    for (let k = 0; k <= n; k += 1) pts.push({ x: xa + (xb - xa) * k / n, y });
    if (l < lanes - 1) {
      const m = Math.ceil(Math.PI * R / 4);
      for (let k = 1; k < m; k += 1) {
        const a = -Math.PI / 2 + Math.PI * k / m;
        pts.push({ x: xb + (ltr ? 1 : -1) * Math.cos(a) * R, y: y + R + Math.sin(a) * R });
      }
    }
  }
  return pts;
}
function distSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const pcWidth = v => PC_LW * clamp(1.3 - 0.6 * v, 0.2, 1.3);
const PC_GOOD_MIN = 0.55, PC_GOOD_MAX = 1.2;
const pcFresh = n => ({ on: false, last: null, t: 0, v: 0.5, cov: new Uint8Array(n), total: 0, over: 0 });

function PremiereCouche() {
  const [won, win] = useWin("premiere-couche");
  const path = useMemo(pcPath, []);
  const base = useFixedCanvas(PC_W, PC_H);
  const ink = useFixedCanvas(PC_W, PC_H);
  const S = useRef(null);
  if (!S.current) S.current = pcFresh(path.length);
  const [st, setSt] = useState({ cov: 0, bad: 0, v: 0.5 });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const ctx = base.current.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, PC_W, PC_H);
    g.addColorStop(0, "#d4ac64"); g.addColorStop(.55, "#b5853b"); g.addColorStop(1, "#86602a");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(4, 4, PC_W - 8, PC_H - 8, 16); ctx.fill();
    for (let i = 0; i < 900; i += 1) {
      ctx.fillStyle = Math.random() < .5 ? "rgba(255,255,255,.16)" : "rgba(0,0,0,.12)";
      ctx.fillRect(rand(8, PC_W - 8), rand(8, PC_H - 8), 1.6, 1.6);
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = "rgba(34,197,94,.28)"; ctx.lineWidth = PC_LW; ctx.stroke();
    ctx.setLineDash([5, 7]); ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    const a = path[0], z = path[path.length - 1];
    ctx.fillStyle = "#16a34a"; ctx.beginPath(); ctx.arc(a.x, a.y, 9, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "900 10px system-ui"; ctx.textAlign = "center";
    ctx.fillText("DÉPART", a.x, a.y - 15);
    ctx.fillStyle = "#dc2626"; ctx.beginPath(); ctx.arc(z.x, z.y, 7, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText("FIN", z.x, z.y + 22);
  }, [base, path]);

  const reset = () => {
    ink.current.getContext("2d").clearRect(0, 0, PC_W, PC_H);
    S.current = pcFresh(path.length);
    setSt({ cov: 0, bad: 0, v: 0.5 });
    setMsg("Plateau gratté. On recommence, et en douceur.");
  };
  const down = e => {
    if (won) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* rien */ }
    const s = S.current;
    s.on = true; s.last = canvasPos(e, ink.current, PC_W, PC_H); s.t = performance.now(); s.v = 0.5;
  };
  const up = () => {
    const s = S.current;
    if (!s.on) return;
    s.on = false;
    const cov = s.cov.reduce((a, b) => a + b, 0) / path.length, bad = s.total ? s.over / s.total : 0;
    if (!won && cov < 0.85) setMsg(bad > 0.25 ? "Beaucoup de ratés : une première couche, ça se pose, ça ne se jette pas." : "Continue, il reste des trous dans le chemin.");
  };
  const move = e => {
    const s = S.current;
    if (!s.on || won) return;
    const p = canvasPos(e, ink.current, PC_W, PC_H), a = s.last, now = performance.now();
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < 2) return;
    const dt = Math.max(1, now - s.t);
    s.v = s.v * 0.6 + (d / dt) * 0.4;
    const w = pcWidth(s.v);
    const good = w >= PC_LW * PC_GOOD_MIN && w <= PC_LW * PC_GOOD_MAX;
    let dmin = Infinity;
    for (let i = 0; i < path.length; i += 1) {
      const ds = distSeg(path[i], a, p);
      if (ds < dmin) dmin = ds;
      if (good && ds <= w / 2 + 2) s.cov[i] = 1;
    }
    s.total += d;
    if (!good || dmin > PC_LW * 0.5) s.over += d;
    const ctx = ink.current.getContext("2d");
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = w < PC_LW * PC_GOOD_MIN ? "rgba(34,211,238,.45)" : w > PC_LW * PC_GOOD_MAX ? "#0e7490" : "#22d3ee";
    ctx.lineWidth = w; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x, a.y - w * 0.18); ctx.lineTo(p.x, p.y - w * 0.18);
    ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = Math.max(1, w * 0.22); ctx.stroke();
    s.last = p; s.t = now;
    const cov = s.cov.reduce((x, y) => x + y, 0) / path.length, bad = s.over / s.total;
    setSt({ cov, bad, v: s.v });
    if (cov >= 0.85 && bad <= 0.25) { win(); setMsg(""); }
  };

  const w = pcWidth(st.v) / PC_LW;
  const speed = w > PC_GOOD_MAX ? { t: "Trop lent : pâté !", c: "#f59e0b" } : w < PC_GOOD_MIN ? { t: "Trop vite : ça n'accroche pas", c: "#ef4444" } : { t: "Vitesse parfaite", c: "#22c55e" };
  const vPos = clamp(st.v / 2, 0, 1);
  return (
    <Stage won={won} wonText="Première couche parfaite !" font={SANS}
      bg="linear-gradient(180deg, #1f2937, #111827)" style={{ justifyContent:"flex-start" }}>
      <Title sub="Suis le chemin de la buse, du départ à la fin. Trop vite, c'est trop fin ; trop lent, c'est un pâté.">Première couche</Title>
      <div style={{ display:"flex", gap:14, margin:"10px 0 8px", fontWeight:800, fontSize:14, flexWrap:"wrap", justifyContent:"center" }}>
        <span>Couverture : <b style={{ color: st.cov >= .85 ? "#4ade80" : "#fbbf24" }}>{Math.round(st.cov * 100)} %</b> / 85</span>
        <span>Ratés : <b style={{ color: st.bad <= .25 ? "#4ade80" : "#f87171" }}>{Math.round(st.bad * 100)} %</b> (25 max)</span>
      </div>
      <div style={{ position:"relative", width:"100%", maxWidth:400, aspectRatio:`${PC_W} / ${PC_H}` }}>
        <canvas ref={base} style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}/>
        <canvas ref={ink} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ position:"absolute", inset:0, width:"100%", height:"100%", touchAction:"none", cursor:"crosshair" }}/>
      </div>
      <div style={{ width:"100%", maxWidth:400, marginTop:10 }}>
        <div style={{ position:"relative", height:12, borderRadius:7, overflow:"hidden",
          background:"linear-gradient(90deg, #f59e0b 0%, #f59e0b 6%, #22c55e 10%, #22c55e 52%, #ef4444 62%, #ef4444)" }}>
          <div style={{ position:"absolute", top:-2, bottom:-2, width:5, left:`calc(${vPos * 100}% - 2px)`, background:"#fff", boxShadow:"0 0 6px #000" }}/>
        </div>
        <div style={{ textAlign:"center", fontWeight:800, fontSize:13, color:speed.c, marginTop:4 }}>{speed.t}</div>
      </div>
      <div style={{ minHeight:20, fontSize:13, marginTop:4, opacity:.85, textAlign:"center" }}>{msg}</div>
      <Btn color="#64748b" onClick={reset} style={{ marginTop:6 }}>Gratter le plateau</Btn>
      <Hint won={won}>Garde le doigt (ou la souris) appuyé, à vitesse régulière, bien au milieu du sillon.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* /sechoir : garder la bobine au sec sans la faire fondre              */
/* ------------------------------------------------------------------ */

const SE_SOFT = 72, SE_DRY = 15, SE_HOLD = 10;
const SE_GUSTS = ["Quelqu'un a ouvert la porte du garage !", "Une bouilloire siffle à côté…", "Il pleut dehors, l'humidité s'invite.",
  "Le chat a renversé son bol d'eau.", "Ta douche de 40 minutes n'aide pas."];

function Sechoir() {
  const [won, win] = useWin("sechoir");
  const S = useRef({ h: 48, T: 24, heat: false, ok: 0, gust: rand(9, 13), msg: "", msgT: 0, soft: 0, ang: 0 });
  const wonRef = useRef(false);
  wonRef.current = won;
  const [, force] = useState(0);
  const setHeat = useCallback(v => { S.current.heat = v; }, []);

  useKeyDown(e => { if (e.key === " ") { e.preventDefault(); setHeat(true); } }, e => { if (e.key === " ") setHeat(false); });

  useLoop(dt => {
    const s = S.current;
    if (s.heat) s.T += 10 * dt;
    s.T = clamp(s.T - (s.T - 24) * 0.055 * dt, 18, 95);
    const softening = s.T > SE_SOFT;
    const dry = Math.max(0, s.T - 35) * 0.13 * (softening ? 0.4 : 1);
    s.h = clamp(s.h + (1.6 - dry) * dt, 4, 85);
    s.gust -= dt;
    if (s.gust <= 0) { s.gust = rand(9, 14); s.h = Math.min(85, s.h + 4); s.msg = pick(SE_GUSTS); s.msgT = 2.8; }
    if (s.msgT > 0) s.msgT -= dt;
    s.soft = softening ? Math.min(1, s.soft + dt) : Math.max(0, s.soft - dt * 0.5);
    if (!wonRef.current) {
      if (softening) s.ok = Math.max(0, s.ok - 2 * dt);
      else if (s.h < SE_DRY) s.ok += dt;
      else s.ok = 0;
      if (s.ok >= SE_HOLD) win();
    }
    s.ang = (s.ang + dt * (s.heat ? 70 : 30)) % 360;
    force(n => (n + 1) % 1000000);
  });

  const s = S.current;
  const heatA = clamp((s.T - 24) / 60, 0, 1);
  const drops = Math.round(s.h / 5);
  const hCol = s.h < SE_DRY ? "#4ade80" : s.h < 30 ? "#fbbf24" : "#60a5fa";
  const mood = s.T > SE_SOFT ? "Aïe ! Le PLA ramollit, la bobine s'avachit !"
    : s.h > 40 ? "Ta bobine boit l'air comme une éponge."
      : s.h > 25 ? "Ça crépite à la buse, des petites bulles partout."
        : s.h >= SE_DRY ? "Presque… encore un effort."
          : "Sec comme une biscotte. Tiens bon !";
  return (
    <Stage won={won} wonText="Filament sec comme un désert !" font={SANS}
      bg="radial-gradient(circle at 50% 30%, #3f2a1d, #160f0b 75%)" style={{ justifyContent:"flex-start" }}>
      <style>{`
        @keyframes sechoir-up { 0% { transform:translateY(0); opacity:0 } 15% { opacity:1 } 100% { transform:translateY(-90px); opacity:0 } }
        @keyframes sechoir-wave { 0%,100% { transform:translateY(0) scaleX(1) } 50% { transform:translateY(-6px) scaleX(1.1) } }
      `}</style>
      <Title sub="L'humidité remonte toute seule. Chauffe pour sécher… mais au-delà de 72 °C, le PLA ramollit.">Le séchoir</Title>
      <svg viewBox="0 0 300 236" style={{ width:"100%", maxWidth:340, marginTop:8 }}>
        <defs>
          <radialGradient id="sechoir-glow" cx=".5" cy="1" r=".9">
            <stop offset="0" stopColor="#ef4444" stopOpacity={heatA}/><stop offset="1" stopColor="#ef4444" stopOpacity="0"/>
          </radialGradient>
        </defs>
        <rect x="24" y="12" width="252" height="206" rx="24" fill="#e7e5e4" stroke="#a8a29e" strokeWidth="3"/>
        <rect x="40" y="26" width="220" height="164" rx="16" fill="#1c1917"/>
        <rect x="40" y="26" width="220" height="164" rx="16" fill="url(#sechoir-glow)"/>
        <g style={{ transformOrigin:"150px 180px", transform:`scaleY(${1 - 0.14 * s.soft}) scaleX(${1 + 0.06 * s.soft})` }}>
          <g transform={`rotate(${s.ang} 150 108)`}>
            <circle cx="150" cy="108" r="70" fill="#292524" stroke="#57534e" strokeWidth="3"/>
            <circle cx="150" cy="108" r="62" fill={s.soft > .4 ? "#c2410c" : "#f97316"}/>
            {[56, 50, 44, 38].map(r => <circle key={r} cx="150" cy="108" r={r} fill="none" stroke="rgba(0,0,0,.15)" strokeWidth="1.2"/>)}
            <circle cx="150" cy="108" r="26" fill="#44403c"/>
            {[0, 120, 240].map(a => <rect key={a} x="147" y="84" width="6" height="22" rx="2" fill="#78716c" transform={`rotate(${a} 150 108)`}/>)}
            <circle cx="150" cy="108" r="8" fill="#1c1917"/>
            <path d="M104 72 A60 60 0 0 1 132 52" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="4" strokeLinecap="round"/>
          </g>
        </g>
        {Array.from({ length: drops }, (_, i) => (
          <circle key={i} cx={95 + (i * 37) % 112} cy={150 - (i % 3) * 10} r={2.5 + (i % 3)} fill="#93c5fd"
            style={{ animation:`sechoir-up ${2.2 + (i % 4) * 0.4}s linear ${(i * 0.37) % 2}s infinite` }}/>
        ))}
        {s.heat && [80, 150, 220].map(x => (
          <path key={x} d={`M${x - 12} 186 q6 -8 12 0 t12 0`} fill="none" stroke="#fca5a5" strokeWidth="2.5"
            style={{ animation:"sechoir-wave .6s ease-in-out infinite", transformOrigin:`${x}px 186px` }}/>
        ))}
        <rect x="40" y="196" width="220" height="10" rx="5" fill={`rgba(239,68,68,${0.25 + heatA * 0.75})`}/>
        <text x="150" y="232" textAnchor="middle" fontSize="11" fontWeight="800" fill="#d6d3d1">FILAMENT DRYER 3000</text>
      </svg>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, width:"100%", maxWidth:380, marginTop:6 }}>
        <div style={{ background:"rgba(255,255,255,.07)", borderRadius:12, padding:"8px 10px" }}>
          <div style={{ fontSize:12, opacity:.75 }}>Humidité</div>
          <div style={{ fontSize:28, fontWeight:900, color:hCol, fontFamily:MONO }}>{s.h.toFixed(0)} %</div>
          <div style={{ position:"relative", height:8, borderRadius:5, background:"#334155", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:0, bottom:0, left:0, width:`${s.h / 0.85}%`, background:hCol }}/>
            <div style={{ position:"absolute", top:0, bottom:0, left:`${SE_DRY / 0.85}%`, width:2, background:"#fff" }}/>
          </div>
        </div>
        <div style={{ background:"rgba(255,255,255,.07)", borderRadius:12, padding:"8px 10px" }}>
          <div style={{ fontSize:12, opacity:.75 }}>Température</div>
          <div style={{ fontSize:28, fontWeight:900, color: s.T > SE_SOFT ? "#f87171" : "#fdba74", fontFamily:MONO }}>{s.T.toFixed(0)} °C</div>
          <div style={{ position:"relative", height:8, borderRadius:5, background:"#334155", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:0, bottom:0, left:0, width:`${(s.T - 18) / 0.77}%`, background:"linear-gradient(90deg,#fbbf24,#ef4444)" }}/>
            <div style={{ position:"absolute", top:0, bottom:0, left:`${(SE_SOFT - 18) / 0.77}%`, right:0, background:"repeating-linear-gradient(45deg, rgba(0,0,0,.5) 0 3px, transparent 3px 6px)" }}/>
          </div>
        </div>
      </div>
      <div style={{ width:"100%", maxWidth:380, marginTop:10 }}>
        <div style={{ fontSize:12.5, fontWeight:800, marginBottom:4 }}>Au sec (sous {SE_DRY} %) : {Math.min(SE_HOLD, s.ok).toFixed(1)} / {SE_HOLD} s</div>
        <div style={{ height:10, borderRadius:6, background:"#334155", overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${Math.min(1, s.ok / SE_HOLD) * 100}%`, background:"linear-gradient(90deg,#22c55e,#a3e635)" }}/>
        </div>
      </div>
      <div style={{ minHeight:40, margin:"8px 0", textAlign:"center", fontSize:13.5, fontWeight:700,
        color: s.msgT > 0 ? "#fbbf24" : "#e7e5e4" }}>{s.msgT > 0 ? `💨 ${s.msg}` : mood}</div>
      <HoldBtn on={setHeat} color={s.heat ? "#dc2626" : "#ea580c"}>🔥 Chauffer (maintenir)</HoldBtn>
      <Hint won={won}>Maintiens le bouton (ou la barre d'espace) pour chauffer. Garde l'humidité sous {SE_DRY} % pendant {SE_HOLD} secondes d'affilée.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* /purge : la tour de purge, un jeu d'empilement                      */
/* ------------------------------------------------------------------ */

const PU_W = 360, PU_H = 500, PU_BH = 20, PU_BASE = 450, PU_GOAL = 15, PU_W0 = 190;
const PU_COLS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#f5f5f4", "#a3e635"];
const puFresh = () => ({ stack: [{ x: (PU_W - PU_W0) / 2, w: PU_W0, c: PU_COLS[0] }], m: { x: -10, w: PU_W0, dir: 1, c: PU_COLS[1] },
  debris: [], cam: 0, combo: 0, pop: null, popT: 0 });

function Purge() {
  const [won, win] = useWin("purge");
  const cv = useFixedCanvas(PU_W, PU_H);
  const S = useRef(null);
  if (!S.current) S.current = puFresh();
  const ph = useRef("ready");
  const [phase, setPhase] = useState("ready");
  const [floors, setFloors] = useState(0);
  const go = p => { ph.current = p; setPhase(p); };

  const start = () => { S.current = puFresh(); setFloors(0); go("play"); };
  const drop = () => {
    const s = S.current, top = s.stack[s.stack.length - 1], m = s.m, n = s.stack.length;
    const y = PU_BASE - (n + 1) * PU_BH;
    let L = Math.max(m.x, top.x), R = Math.min(m.x + m.w, top.x + top.w);
    if (R - L <= 0) {
      s.debris.push({ x: m.x, y, w: m.w, c: m.c, vy: 0, vx: m.dir * 50, rot: 0, vr: m.dir * 2 });
      go("over");
      return;
    }
    if (Math.abs(m.x - top.x) <= 6) {
      L = top.x; R = top.x + top.w;
      s.combo += 1;
      s.pop = "Parfait !"; s.popT = 0.9;
      if (s.combo >= 3) {
        const g = Math.min(14, PU_W0 - (R - L));
        if (g > 0) { L -= g / 2; R += g / 2; s.pop = "Purge propre : bonus !"; }
        s.combo = 0;
      }
    } else {
      s.combo = 0;
      const left = m.x < top.x;
      s.debris.push({ x: left ? m.x : R, y, w: m.w - (R - L), c: m.c, vy: 0, vx: (left ? -1 : 1) * 70, rot: 0, vr: (left ? -1 : 1) * rand(1.5, 3) });
    }
    s.stack.push({ x: L, w: R - L, c: m.c });
    const f = s.stack.length - 1;
    setFloors(f);
    if (f >= PU_GOAL) { go("won"); win(); return; }
    const fromLeft = f % 2 === 0;
    s.m = { x: fromLeft ? -16 : PU_W + 16 - (R - L), w: R - L, dir: fromLeft ? 1 : -1, c: PU_COLS[(f + 1) % PU_COLS.length] };
  };
  const act = () => { if (ph.current === "play") drop(); else start(); };
  useKeyDown(e => { if ((e.key === " " || e.key === "ArrowDown" || e.key === "Enter") && !e.repeat) { e.preventDefault(); act(); } });

  useLoop(dt => {
    const c = cv.current;
    if (!c) return;
    const ctx = c.getContext("2d"), s = S.current, n = s.stack.length;
    if (ph.current === "play" || ph.current === "ready") {
      const sp = ph.current === "play" ? Math.min(250, 120 + n * 8) : 90;
      s.m.x += s.m.dir * sp * dt;
      if (s.m.x + s.m.w > PU_W + 16) { s.m.x = PU_W + 16 - s.m.w; s.m.dir = -1; }
      if (s.m.x < -16) { s.m.x = -16; s.m.dir = 1; }
    }
    s.cam += (Math.max(0, (n + 2) * PU_BH - 250) - s.cam) * Math.min(1, dt * 4);
    for (const d of s.debris) { d.vy += 900 * dt; d.y += d.vy * dt; d.x += d.vx * dt; d.rot += d.vr * dt; }
    s.debris = s.debris.filter(d => d.y < PU_BASE + 700);
    if (s.popT > 0) s.popT -= dt;

    const bg = ctx.createLinearGradient(0, 0, 0, PU_H);
    bg.addColorStop(0, "#1e1b4b"); bg.addColorStop(1, "#0f172a");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, PU_W, PU_H);
    ctx.save();
    ctx.translate(0, s.cam);
    ctx.fillStyle = "#475569"; ctx.fillRect(0, PU_BASE, PU_W, 60);
    ctx.fillStyle = "#94a3b8"; ctx.fillRect(0, PU_BASE, PU_W, 3);
    for (let x = 10; x < PU_W; x += 24) { ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fillRect(x, PU_BASE + 8, 12, 2); }
    s.stack.forEach((b, i) => {
      const y = PU_BASE - (i + 1) * PU_BH;
      const g = ctx.createLinearGradient(0, y + PU_BH, 0, y);
      g.addColorStop(0, i ? s.stack[i - 1].c : b.c); g.addColorStop(.7, b.c);
      ctx.fillStyle = g; ctx.fillRect(b.x, y, b.w, PU_BH);
      ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(b.x, y, b.w, 2);
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(b.x, y + PU_BH - 2, b.w, 2);
      for (let k = 6; k < PU_BH - 2; k += 5) { ctx.fillStyle = "rgba(0,0,0,.08)"; ctx.fillRect(b.x, y + k, b.w, 1); }
    });
    if (ph.current === "play" || ph.current === "ready") {
      const m = s.m, y = PU_BASE - (n + 1) * PU_BH, cx = m.x + m.w / 2;
      ctx.fillStyle = m.c; ctx.fillRect(m.x, y, m.w, PU_BH);
      ctx.fillStyle = "rgba(255,255,255,.3)"; ctx.fillRect(m.x, y, m.w, 2);
      ctx.strokeStyle = m.c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, y - 500); ctx.lineTo(cx, y - 40); ctx.stroke();
      ctx.fillStyle = "#e2e8f0"; ctx.beginPath(); ctx.roundRect(cx - 18, y - 46, 36, 30, 5); ctx.fill();
      ctx.fillStyle = "#ef4444"; ctx.fillRect(cx - 18, y - 26, 36, 6);
      ctx.fillStyle = "#d4a017"; ctx.beginPath(); ctx.moveTo(cx - 7, y - 16); ctx.lineTo(cx + 7, y - 16); ctx.lineTo(cx, y - 4); ctx.fill();
    }
    for (const d of s.debris) {
      ctx.save(); ctx.translate(d.x + d.w / 2, d.y + PU_BH / 2); ctx.rotate(d.rot);
      ctx.fillStyle = d.c; ctx.fillRect(-d.w / 2, -PU_BH / 2, d.w, PU_BH); ctx.restore();
    }
    if (s.popT > 0 && s.pop) {
      const y = PU_BASE - (n + 2) * PU_BH - 40 - (0.9 - s.popT) * 30;
      ctx.globalAlpha = clamp(s.popT / 0.4, 0, 1);
      ctx.fillStyle = "#fde68a"; ctx.font = "900 20px system-ui"; ctx.textAlign = "center"; ctx.fillText(s.pop, PU_W / 2, y);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.font = "800 15px system-ui"; ctx.textAlign = "left";
    ctx.fillText(`Étages : ${Math.min(n - 1, PU_GOAL)} / ${PU_GOAL}`, 12, 24);
  });

  return (
    <Stage won={won} wonText="Tour de purge de 15 étages !" font={SANS}
      bg="linear-gradient(180deg, #312e81, #0f172a)" style={{ justifyContent:"flex-start" }}>
      <Title sub="Chaque changement de couleur purge sur la tour. Lâche le bloc pile sur le précédent : ce qui dépasse tombe.">La tour de purge</Title>
      <div style={{ position:"relative", width:"100%", maxWidth:380, aspectRatio:`${PU_W} / ${PU_H}`, marginTop:10 }}>
        <canvas ref={cv} onPointerDown={e => { e.preventDefault(); act(); }}
          style={{ position:"absolute", inset:0, width:"100%", height:"100%", borderRadius:14, touchAction:"none", cursor:"pointer" }}/>
        {phase !== "play" && (
          <div onPointerDown={e => { e.preventDefault(); act(); }} style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center", gap:10, background:"rgba(15,23,42,.45)", borderRadius:14, cursor:"pointer", textAlign:"center", padding:16 }}>
            <div style={{ fontSize:22, fontWeight:900 }}>
              {phase === "ready" ? "Prêt à purger ?" : phase === "won" ? "Quinze étages, zéro spaghetti !" : "Effondrement !"}
            </div>
            <div style={{ fontSize:14, opacity:.85 }}>
              {phase === "ready" ? `Monte une tour de ${PU_GOAL} étages.` : phase === "won" ? "Ton slicer est fier de toi." : `${floors} étage${floors > 1 ? "s" : ""} : la buse a purgé dans le vide.`}
            </div>
            <Btn color="#7c3aed">{phase === "ready" ? "Lancer" : "Recommencer"}</Btn>
          </div>
        )}
      </div>
      <Hint won={won}>Touche l'écran (ou espace) pour lâcher le bloc. Trois « Parfait ! » d'affilée élargissent un peu la tour.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* /supports : poser des supports avant d'imprimer                     */
/* ------------------------------------------------------------------ */

const SU_COLS = 16, SU_ROWS = 14, SU_C = 22;
const SU_EMPTY = "................";
const SU_LEVELS = [
  { name: "Le pont", budget: 3, rows: [SU_EMPTY, SU_EMPTY, SU_EMPTY, SU_EMPTY,
    ".##############.", ".##############.", ...Array(8).fill(".###........###.")] },
  { name: "Le T", budget: 5, rows: [SU_EMPTY, SU_EMPTY, SU_EMPTY,
    ".##############.", ".##############.", ...Array(9).fill("......####......")] },
  { name: "L'arche", budget: 2, rows: [SU_EMPTY, "....########....", "..############..", ".##############.",
    ".####......####.", ...Array(9).fill(".###........###.")] },
];

/** Impression simulee : une case tient si la couche du dessous la porte (45° permis pour le modele). */
function suSim(model, sup) {
  const solid = Array.from({ length: SU_ROWS }, () => Array(SU_COLS).fill(false));
  const st = Array.from({ length: SU_ROWS }, () => Array(SU_COLS).fill(null));
  const fails = [];
  for (let r = SU_ROWS - 1; r >= 0; r -= 1) {
    for (let c = 0; c < SU_COLS; c += 1) {
      const m = model[r][c], s = sup[r][c];
      if (!m && !s) continue;
      const below = k => r === SU_ROWS - 1 || (k >= 0 && k < SU_COLS && solid[r + 1][k]);
      const ok = s ? below(c) : below(c) || below(c - 1) || below(c + 1);
      if (ok) { solid[r][c] = true; st[r][c] = s ? "s" : "m"; } else { st[r][c] = s ? "sf" : "f"; fails.push([r, c]); }
    }
  }
  return { st, fails };
}
function suSquiggle(r, c) {
  const x = c * SU_C, y = r * SU_C;
  const k = (r * 7 + c * 13) % 5;
  return `M${x + 2} ${y + 8 + k} q4 -9 8 0 t8 0 t6 4 M${x + 3} ${y + 15} q5 -7 9 1 t9 -2`;
}

function Supports() {
  const [won, win] = useWin("supports");
  const [lv, setLv] = useState(0);
  const L = SU_LEVELS[lv];
  const model = useMemo(() => L.rows.map(r => [...r].map(ch => ch === "#")), [L]);
  const topRow = useMemo(() => model.findIndex(r => r.some(Boolean)), [model]);
  const [sups, setSups] = useState([]);
  const [phase, setPhase] = useState("edit");
  const [row, setRow] = useState(SU_ROWS);
  const [shown, setShown] = useState(null);       // resultat de la derniere impression (cases ratees)
  const [msg, setMsg] = useState("");
  const svg = useRef(null);

  const supGrid = useMemo(() => {
    const g = Array.from({ length: SU_ROWS }, () => Array(SU_COLS).fill(false));
    sups.forEach(s => { for (let r = s.top; r <= s.bot; r += 1) g[r][s.c] = true; });
    return g;
  }, [sups]);
  const res = useMemo(() => suSim(model, supGrid), [model, supGrid]);

  useEffect(() => {
    if (phase !== "print") return undefined;
    const id = setInterval(() => setRow(r => r - 1), 210);
    return () => clearInterval(id);
  }, [phase]);
  useEffect(() => {
    if (phase !== "print" || row > topRow) return;
    setShown(res);
    if (res.fails.length === 0) {
      setPhase("ok");
      setMsg(lv === SU_LEVELS.length - 1 ? "Les trois tiennent debout. Tu peux arracher les supports à la pince." : "Ça tient ! Pas un poil de spaghetti.");
      if (lv === SU_LEVELS.length - 1) win();
    } else {
      setPhase("fail");
      setMsg(pick(["Spaghetti ! Le porte-à-faux s'est effondré.", "Plat de pâtes servi : il manquait un support.",
        "La buse a imprimé dans le vide. Joli nid d'oiseau."]));
    }
  }, [phase, row, topRow, res, lv, win]);

  const tap = e => {
    if (phase === "print" || phase === "ok") return;
    const p = canvasPos(e, svg.current, SU_COLS * SU_C, SU_ROWS * SU_C + 24);
    const r = Math.floor(p.y / SU_C), c = Math.floor(p.x / SU_C);
    if (r < 0 || r >= SU_ROWS || c < 0 || c >= SU_COLS || model[r][c]) return;
    if (phase === "fail") setPhase("edit");
    const hit = sups.findIndex(s => s.c === c && r >= s.top && r <= s.bot);
    if (hit >= 0) { setSups(sups.filter((_, i) => i !== hit)); setMsg("Support retiré."); return; }
    if (sups.length >= L.budget) { setMsg(`Budget atteint (${L.budget}) : le patron dit que le filament coûte cher.`); return; }
    let k = r - 1;
    while (k >= 0 && !model[k][c]) k -= 1;
    const top = k >= 0 ? k + 1 : r;
    let bot = top;
    while (bot + 1 < SU_ROWS && !model[bot + 1][c]) bot += 1;
    if (sups.some(s => s.c === c && !(bot < s.top || top > s.bot))) return;
    setSups([...sups, { c, top, bot }]);
    setMsg(k >= 0 ? "Support posé sous le porte-à-faux." : "Un support qui ne porte rien… c'est de l'art ?");
  };
  const print = () => { if (phase === "print") return; setShown(null); setRow(SU_ROWS); setPhase("print"); setMsg("Impression en cours…"); };
  const next = () => { setLv(l => l + 1); setSups([]); setShown(null); setPhase("edit"); setRow(SU_ROWS); setMsg(""); };
  const clear = () => { if (phase === "print") return; setSups([]); setShown(null); setPhase("edit"); setMsg(""); };

  const printing = phase === "print";
  const after = phase === "ok" || phase === "fail";
  const GW = SU_COLS * SU_C, GH = SU_ROWS * SU_C;
  const cells = [];
  for (let r = 0; r < SU_ROWS; r += 1) {
    for (let c = 0; c < SU_COLS; c += 1) {
      const m = model[r][c], s = supGrid[r][c];
      if (!m && !s) continue;
      const printed = printing ? r >= row : after;
      const st = res.st[r][c];
      const x = c * SU_C, y = r * SU_C;
      if (printed && (st === "f" || st === "sf")) {
        cells.push(
          <g key={`${r}-${c}`} style={{ "--d": `${(SU_ROWS - 1 - r) * SU_C}px`, animation:"supports-fall .9s ease-in forwards" }}>
            <path d={suSquiggle(r, c)} fill="none" stroke={m ? "#fb923c" : "#a8a29e"} strokeWidth="2.4" strokeLinecap="round"/>
          </g>);
        continue;
      }
      if (m) {
        const failedBefore = !printed && shown && shown.st[r][c] === "f";
        cells.push(<rect key={`${r}-${c}`} x={x + 1} y={y + 1} width={SU_C - 2} height={SU_C - 2} rx="3"
          fill={printed ? "#fb923c" : "rgba(251,146,60,.28)"} stroke={failedBefore ? "#ef4444" : printed ? "#c2410c" : "rgba(251,146,60,.7)"}
          strokeWidth={failedBefore ? 2.5 : 1.2} strokeDasharray={printed || failedBefore ? "" : "3 2"}/>);
      } else {
        cells.push(<rect key={`${r}-${c}`} x={x + 5} y={y} width={SU_C - 10} height={SU_C} fill="url(#supports-hatch)"
          opacity={printed ? 1 : 0.6} stroke="#78716c" strokeWidth="1"/>);
      }
    }
  }
  return (
    <Stage won={won} wonText="Zéro spaghetti, maître des supports !" font={SANS}
      bg="linear-gradient(180deg, #134e4a, #042f2e)" style={{ justifyContent:"flex-start" }}>
      <style>{`
        @keyframes supports-fall { 0% { transform:translateY(0); opacity:1 } 100% { transform:translateY(var(--d)); opacity:.85 } }
        @keyframes supports-sweep { 0%,100% { transform:translateX(0) } 50% { transform:translateX(${GW - 30}px) } }
      `}</style>
      <Title sub="Le slicer imprime couche par couche. Un porte-à-faux tient jusqu'à 45° ; au-delà, il lui faut un support.">Les supports</Title>
      <div style={{ display:"flex", gap:12, alignItems:"center", margin:"10px 0 6px", fontWeight:800, fontSize:14, flexWrap:"wrap", justifyContent:"center" }}>
        <span style={{ padding:"3px 10px", borderRadius:999, background:"rgba(255,255,255,.12)" }}>{lv + 1} / {SU_LEVELS.length} · {L.name}</span>
        <span>Supports : <b style={{ color: sups.length >= L.budget ? "#fbbf24" : "#5eead4" }}>{sups.length} / {L.budget}</b></span>
      </div>
      <svg ref={svg} viewBox={`0 0 ${GW} ${GH + 24}`} onPointerDown={tap}
        style={{ width:"100%", maxWidth:420, background:"rgba(0,0,0,.25)", borderRadius:12, touchAction:"none", cursor:"pointer" }}>
        <defs>
          <pattern id="supports-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#d6d3d1"/><line x1="0" y1="0" x2="0" y2="6" stroke="#78716c" strokeWidth="2.5"/>
          </pattern>
        </defs>
        {Array.from({ length: SU_COLS + 1 }, (_, i) => <line key={`v${i}`} x1={i * SU_C} y1="0" x2={i * SU_C} y2={GH} stroke="rgba(255,255,255,.06)"/>)}
        {Array.from({ length: SU_ROWS + 1 }, (_, i) => <line key={`h${i}`} x1="0" y1={i * SU_C} x2={GW} y2={i * SU_C} stroke="rgba(255,255,255,.06)"/>)}
        {printing && <rect x="0" y={row * SU_C} width={GW} height="2" fill="#5eead4" opacity=".7"/>}
        {cells}
        <rect x="0" y={GH} width={GW} height="24" fill="#334155"/>
        <rect x="0" y={GH} width={GW} height="3" fill="#94a3b8"/>
        {printing && (
          <g style={{ transform:`translateY(${row * SU_C - 26}px)`, transition:"transform .2s" }}>
            <g style={{ animation:"supports-sweep .42s linear infinite" }}>
              <rect x="2" y="0" width="26" height="18" rx="4" fill="#e2e8f0"/>
              <polygon points="10,18 20,18 15,26" fill="#d4a017"/>
            </g>
          </g>
        )}
      </svg>
      <div style={{ minHeight:22, margin:"8px 0 4px", fontSize:13.5, fontWeight:700, textAlign:"center",
        color: phase === "fail" ? "#fca5a5" : phase === "ok" ? "#86efac" : "#e2e8f0" }}>{msg}</div>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", justifyContent:"center" }}>
        {phase === "ok" && lv < SU_LEVELS.length - 1 && <Btn color="#16a34a" onClick={next}>Modèle suivant ▶</Btn>}
        {phase !== "ok" && <Btn color="#0d9488" onClick={print} disabled={printing}>Imprimer ▶</Btn>}
        {phase !== "ok" && <Btn color="#64748b" onClick={clear} disabled={printing}>Tout retirer</Btn>}
      </div>
      <Hint won={won}>Touche une case vide sous une partie qui dépasse : un support y monte depuis le dessous. Touche-le à nouveau pour l'enlever.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* /slicer : un code cache dans les couches                            */
/* ------------------------------------------------------------------ */

const SL_MAX = 120, SL_CV = 240;
const SL_CHARS = "BCDEFGJKLNPRSZ234579";       // aucun n'est symetrique dans un miroir
const slR = z => 30 + 30 * Math.sin(Math.PI * (0.15 + 0.75 * z / SL_MAX));
function slPuzzle() {
  const layers = [];
  while (layers.length < 9) { const z = Math.floor(rand(8, SL_MAX - 6)); if (layers.every(o => Math.abs(o - z) > 4)) layers.push(z); }
  const code = Array.from({ length: 4 }, () => pick([...SL_CHARS])).join("");
  const marks = {};
  layers.slice(0, 4).forEach((z, i) => { marks[z] = { ch: code[i], pos: i + 1, mirror: false }; });
  // leurres : caracteres en miroir (pas J, L ni Z, dont le miroir ressemble trop a une vraie lettre)
  layers.slice(4).forEach(z => { marks[z] = { ch: pick([..."BCDEFGKNPRS234579"]), pos: 1 + Math.floor(Math.random() * 4), mirror: true }; });
  return { code, marks };
}

function Slicer() {
  const [won, win] = useWin("slicer");
  const P = useMemo(slPuzzle, []);
  const [z, setZ] = useState(0);
  const [guess, setGuess] = useState("");
  const [msg, setMsg] = useState("");
  const [tries, setTries] = useState(0);
  const cv = useFixedCanvas(SL_CV, SL_CV);

  useEffect(() => {
    const ctx = cv.current.getContext("2d"), C = SL_CV / 2;
    ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, SL_CV, SL_CV);
    ctx.strokeStyle = "rgba(148,163,184,.12)"; ctx.lineWidth = 1;
    for (let i = 0; i <= SL_CV; i += 20) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, SL_CV); ctx.moveTo(0, i); ctx.lineTo(SL_CV, i); ctx.stroke(); }
    const R = slR(z) * 1.75;
    [R - 2, R - 6, R - 10].forEach(r => { ctx.beginPath(); ctx.arc(C, C, r, 0, Math.PI * 2); ctx.strokeStyle = "#f97316"; ctx.lineWidth = 3; ctx.stroke(); });
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, R - 13, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = "rgba(250,204,21,.55)"; ctx.lineWidth = 1.6;
    const dir = z % 2 ? 1 : -1;
    for (let k = -SL_CV; k < SL_CV * 2; k += 12) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + dir * SL_CV, SL_CV); ctx.stroke(); }
    const mk = P.marks[z];
    if (mk) {
      ctx.translate(C, C - 4);
      if (mk.mirror) ctx.scale(-1, 1);
      ctx.font = "900 84px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#38bdf8"; ctx.fillText(mk.ch, 0, 0);
      ctx.strokeStyle = "#0b1220"; ctx.lineWidth = 2; ctx.strokeText(mk.ch, 0, 0);
      if (mk.mirror) ctx.scale(-1, 1);
      ctx.fillStyle = "#38bdf8";
      for (let i = 0; i < mk.pos; i += 1) { ctx.beginPath(); ctx.arc((i - (mk.pos - 1) / 2) * 15, 48, 4.5, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    ctx.fillStyle = "rgba(226,232,240,.8)"; ctx.font = "700 11px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(`Z = ${(z * 0.2).toFixed(1)} mm`, 8, SL_CV - 8);
  }, [z, P, cv]);

  useKeyDown(e => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); setZ(v => Math.max(0, v - 1)); }
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); setZ(v => Math.min(SL_MAX, v + 1)); }
  });

  const submit = e => {
    e.preventDefault();
    if (won) return;
    const g = guess.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (g.length !== 4) { setMsg("Le code fait quatre caractères."); return; }
    setTries(t => t + 1);
    if (g === P.code) { win(); setMsg("Code accepté : le G-code part, la machine chante."); return; }
    const good = [...g].filter((ch, i) => ch === P.code[i]).length;
    setMsg(`${pick(["Code refusé.", "Le slicer fronce les sourcils.", "Erreur de tranchage."])} ${good} caractère${good > 1 ? "s" : ""} à la bonne place.`);
  };

  const prof = [];
  for (let k = 0; k <= SL_MAX; k += 4) prof.push([70 + slR(k) * 0.95, 238 - k * 1.8]);
  const poly = [...prof.map(([x, y]) => `${x},${y}`), ...prof.map(([x, y]) => `${140 - x},${y}`).reverse()].join(" ");
  const ly = 238 - z * 1.8;
  return (
    <Stage won={won} wonText="Code du slicer percé !" font={SANS}
      bg="linear-gradient(180deg, #0f172a, #020617)" style={{ justifyContent:"flex-start" }}>
      <Title sub="Un code de quatre caractères dort dans ce vase. Parcours les couches, une par une.">Le slicer</Title>
      <div style={{ display:"flex", gap:12, alignItems:"center", justifyContent:"center", marginTop:12, width:"100%" }}>
        <svg viewBox="0 0 140 250" style={{ width:"28%", maxWidth:120, flex:"0 0 auto" }}>
          <defs>
            <linearGradient id="slicer-body" x1="0" x2="1"><stop offset="0" stopColor="#c2410c"/><stop offset=".45" stopColor="#fb923c"/><stop offset="1" stopColor="#9a3412"/></linearGradient>
          </defs>
          <polygon points={poly} fill="url(#slicer-body)"/>
          {Array.from({ length: 30 }, (_, i) => <line key={i} x1="0" x2="140" y1={238 - i * 7.2} y2={238 - i * 7.2} stroke="rgba(0,0,0,.12)"/>)}
          <rect x="0" y="238" width="140" height="8" fill="#475569"/>
          <rect x="0" y={ly - 1.5} width="140" height="3" fill="#38bdf8"/>
          <polygon points={`0,${ly - 6} 8,${ly} 0,${ly + 6}`} fill="#38bdf8"/>
        </svg>
        <canvas ref={cv} style={{ width:"min(60vw, 240px)", aspectRatio:"1", borderRadius:12, border:"1px solid #1e293b" }}/>
      </div>
      <div style={{ width:"100%", maxWidth:400, marginTop:12 }}>
        <div style={{ fontWeight:800, fontSize:14, marginBottom:4 }}>
          Couche <span style={{ fontFamily:MONO, color:"#38bdf8" }}>{String(z).padStart(3, "0")}</span> / {SL_MAX}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <Btn color="#334155" style={{ padding:"8px 12px" }} onClick={() => setZ(v => Math.max(0, v - 1))} aria-label="Couche précédente">◀</Btn>
          <input type="range" min="0" max={SL_MAX} step="1" value={z} onChange={e => setZ(+e.target.value)}
            style={{ flex:1, minWidth:0, accentColor:"#38bdf8", height:28 }} aria-label="Couche"/>
          <Btn color="#334155" style={{ padding:"8px 12px" }} onClick={() => setZ(v => Math.min(SL_MAX, v + 1))} aria-label="Couche suivante">▶</Btn>
        </div>
      </div>
      <form onSubmit={submit} style={{ display:"flex", gap:8, marginTop:12, alignItems:"center" }}>
        <input value={guess} onChange={e => setGuess(e.target.value.toUpperCase().slice(0, 4))} maxLength={4} placeholder="????"
          autoComplete="off" spellCheck="false" aria-label="Code"
          style={{ width:130, fontSize:24, fontFamily:MONO, fontWeight:900, letterSpacing:".3em", textAlign:"center", padding:"6px 8px",
            borderRadius:10, border:"2px solid #334155", background:"#0b1220", color:"#e2e8f0", userSelect:"text" }}/>
        <Btn color="#0284c7" type="submit">Valider</Btn>
      </form>
      <div style={{ minHeight:20, marginTop:8, fontSize:13.5, fontWeight:700, textAlign:"center", color: won ? "#86efac" : "#fbbf24" }}>{msg}</div>
      <Hint won={won}>{tries >= 3 ? "Le slicer est taquin : tout ce qui s'affiche ne se lit pas forcément dans le bon sens." : "Flèches, curseur ou boutons ◀ ▶ pour changer de couche."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* /tri-ams : ranger les bobines dans le bon emplacement              */
/* ------------------------------------------------------------------ */

const AMS_SLOTS = [{ n: "Rouge", c: "#ef4444" }, { n: "Bleu", c: "#3b82f6" }, { n: "Jaune", c: "#facc15" }, { n: "Vert", c: "#22c55e" }];
const AMS_GOAL = 12;
const AMS_GOOD = ["Clac ! Bien rangé.", "L'AMS ronronne de bonheur.", "Pile au bon endroit.", "Un changement de couleur sans drame."];

function AmsSpool({ color, label, size = 120 }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true" style={{ display:"block" }}>
      <circle cx="60" cy="60" r="57" fill="#1f2937" stroke="#0b0f17" strokeWidth="2"/>
      <circle cx="60" cy="60" r="50" fill={color}/>
      {[45, 40, 35].map(r => <circle key={r} cx="60" cy="60" r={r} fill="none" stroke="rgba(0,0,0,.16)" strokeWidth="1.3"/>)}
      <path d="M22 44 A40 40 0 0 1 46 20" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="5" strokeLinecap="round"/>
      <circle cx="60" cy="60" r="20" fill="#111827"/>
      <circle cx="60" cy="60" r="7" fill="#374151"/>
      {label && (
        <g>
          <rect x="24" y="76" width="72" height="22" rx="4" fill="#f8fafc" stroke="#cbd5e1"/>
          <text x="60" y="92" textAnchor="middle" fontSize="14" fontWeight="900" fill="#111827" fontFamily={SANS}>{label}</text>
        </g>
      )}
    </svg>
  );
}

function TriAms() {
  const [won, win] = useWin("tri-ams");
  const [phase, setPhase] = useState("ready");
  const S = useRef({ spool: null, n: 0, lives: 3, id: 0 });
  const [, force] = useState(0);
  const [msg, setMsg] = useState("");
  const [flash, setFlash] = useState(null);       // { i, ok }
  const [drag, setDrag] = useState(null);         // { dx, dy }
  const dragRef = useRef(null);
  const slotRefs = useRef([]);
  const flashT = useRef(null);
  useEffect(() => () => clearTimeout(flashT.current), []);

  const newSpool = n => {
    const k = Math.floor(Math.random() * 4);
    const lie = n >= 4 && Math.random() < 0.55;
    const label = lie ? pick(AMS_SLOTS.filter((_, i) => i !== k)).n : AMS_SLOTS[k].n;
    const T = Math.max(2.3, 5 - n * 0.22);
    S.current.id += 1;
    return { k, label, t: T, T, id: S.current.id };
  };
  const start = () => {
    S.current = { spool: null, n: 0, lives: 3, id: S.current.id };
    S.current.spool = newSpool(0);
    setMsg("Range chaque bobine dans l'emplacement de sa couleur !");
    setPhase("play");
  };
  const lose = text => {
    const s = S.current;
    s.lives -= 1;
    setMsg(text);
    if (s.lives <= 0) { s.spool = null; setPhase("over"); return; }
    s.spool = newSpool(s.n);
  };
  const doFlash = (i, ok) => { setFlash({ i, ok }); clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(null), 380); };
  const place = i => {
    const s = S.current;
    if (phase !== "play" || !s.spool) return;
    const sp = s.spool;
    if (i === sp.k) {
      s.n += 1;
      doFlash(i, true);
      if (s.n >= AMS_GOAL) { s.spool = null; setPhase("won"); setMsg("Douze bobines rangées, l'AMS est au carré."); win(); return; }
      s.spool = newSpool(s.n);
      setMsg(s.n === 4 ? "Attention : désormais, certaines étiquettes mentent. Fie-toi au filament !" : pick(AMS_GOOD));
    } else {
      doFlash(i, false);
      lose(`Du ${AMS_SLOTS[sp.k].n.toLowerCase()} dans l'emplacement ${AMS_SLOTS[i].n.toLowerCase()} : ton prochain Benchy sera couleur vomi.`);
    }
    force(x => x + 1);
  };
  useKeyDown(e => {
    if (["1", "2", "3", "4"].includes(e.key)) place(+e.key - 1);
    else if ((e.key === " " || e.key === "Enter") && phase !== "play" && phase !== "won") { e.preventDefault(); start(); }
  });

  useLoop(dt => {
    const s = S.current;
    if (!s.spool) return;
    s.spool.t -= dt * (dragRef.current ? 0.6 : 1);
    if (s.spool.t <= 0) { dragRef.current = null; setDrag(null); lose("La bobine a roulé sous l'établi… avec le chat."); }
    force(x => (x + 1) % 1000000);
  }, phase === "play");

  const pDown = e => {
    if (phase !== "play") return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* rien */ }
    dragRef.current = { x0: e.clientX, y0: e.clientY, id: S.current.spool && S.current.spool.id };
    setDrag({ dx: 0, dy: 0 });
  };
  const pMove = e => { const d = dragRef.current; if (d) setDrag({ dx: e.clientX - d.x0, dy: e.clientY - d.y0 }); };
  const pUp = e => {
    const d = dragRef.current;
    dragRef.current = null; setDrag(null);
    if (!d || !S.current.spool || d.id !== S.current.spool.id) return;
    const i = slotRefs.current.findIndex(el => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 20 && e.clientY <= r.bottom;
    });
    if (i >= 0) place(i);
  };

  const s = S.current, sp = s.spool;
  return (
    <Stage won={won} wonText="AMS rangé au poil !" font={SANS}
      bg="radial-gradient(circle at 50% 10%, #3f3f46, #18181b 75%)" style={{ justifyContent:"flex-start" }}>
      <style>{`
        @keyframes tri-ams-in { from { transform:translateY(-40px) scale(.7); opacity:0 } to { transform:none; opacity:1 } }
        @keyframes tri-ams-shake { 0%,100% { transform:translateX(0) } 25% { transform:translateX(-6px) } 75% { transform:translateX(6px) } }
      `}</style>
      <Title sub={`Range ${AMS_GOAL} bobines dans l'AMS, chacune à l'emplacement de sa couleur, avant qu'elle ne roule par terre.`}>Le tri de l'AMS</Title>
      <div style={{ display:"flex", gap:16, margin:"10px 0", fontWeight:800, fontSize:15 }}>
        <span>Rangées : <b style={{ color:"#4ade80" }}>{s.n} / {AMS_GOAL}</b></span>
        <span>Vies : <b style={{ color:"#f87171", letterSpacing:2 }}>{"♥".repeat(Math.max(0, s.lives))}<span style={{ opacity:.25 }}>{"♥".repeat(3 - Math.max(0, s.lives))}</span></b></span>
      </div>
      <div style={{ height:170, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        {phase === "play" && sp ? (
          <>
            <div key={sp.id} onPointerDown={pDown} onPointerMove={pMove} onPointerUp={pUp} onPointerCancel={pUp}
              style={{ touchAction:"none", cursor:"grab", animation:"tri-ams-in .25s ease-out", zIndex:5, position:"relative",
                transform: drag ? `translate(${drag.dx}px, ${drag.dy}px) scale(.85)` : "none" }}>
              <AmsSpool color={AMS_SLOTS[sp.k].c} label={sp.label} size={128}/>
            </div>
            <div style={{ width:150, height:8, borderRadius:5, background:"#3f3f46", overflow:"hidden", marginTop:8 }}>
              <div style={{ height:"100%", width:`${clamp(sp.t / sp.T, 0, 1) * 100}%`, background: sp.t / sp.T < .35 ? "#ef4444" : "#a3e635" }}/>
            </div>
          </>
        ) : (
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:20, fontWeight:900, marginBottom:10 }}>
              {phase === "ready" ? "Une palette de bobines arrive !" : phase === "won" ? "Tout est rangé 🎉" : "Trop de bobines par terre…"}
            </div>
            {phase !== "won" && <Btn color="#16a34a" onClick={start}>{phase === "ready" ? "C'est parti" : "Recommencer"}</Btn>}
          </div>
        )}
      </div>
      <div style={{ width:"100%", maxWidth:420, background:"linear-gradient(180deg, #e4e4e7, #a1a1aa)", borderRadius:18, padding:"10px 8px 8px",
        boxShadow:"0 10px 30px rgba(0,0,0,.5)", marginTop:4 }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:6 }}>
          {AMS_SLOTS.map((sl, i) => (
            <button key={i} type="button" ref={el => { slotRefs.current[i] = el; }} onClick={() => place(i)}
              style={{ border:"none", borderRadius:12, padding:"8px 2px 6px", cursor:"pointer", fontFamily:SANS,
                background: flash && flash.i === i ? (flash.ok ? "#bbf7d0" : "#fecaca") : "#27272a",
                animation: flash && flash.i === i && !flash.ok ? "tri-ams-shake .3s" : "none",
                display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
              <div style={{ width:"78%", height:10, borderRadius:5, background:sl.c, boxShadow:`0 0 10px ${sl.c}` }}/>
              <AmsSpool color={sl.c} size={46}/>
              <span style={{ fontSize:12, fontWeight:900, color: flash && flash.i === i ? "#111" : "#e4e4e7" }}>{i + 1}. {sl.n}</span>
            </button>
          ))}
        </div>
        <div style={{ textAlign:"center", fontSize:10, fontWeight:900, color:"#3f3f46", marginTop:6, letterSpacing:".2em" }}>AMS · 4 SLOTS</div>
      </div>
      <div style={{ minHeight:38, marginTop:10, fontSize:13.5, fontWeight:700, textAlign:"center", maxWidth:420 }}>{msg}</div>
      <Hint won={won}>Glisse la bobine sur son emplacement, ou touche l'emplacement (clavier : 1 à 4).</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* /buse-bouchee : trois cold pulls reussis d'affilee                  */
/* ------------------------------------------------------------------ */

const BB_TMAX = 300, BB_HEAT = [238, 248], BB_SOAK = 1.2, BB_STREAK = 3, BB_PULLW = 12;
const bbPullBand = () => { const lo = Math.round(rand(82, 106)); return [lo, lo + BB_PULLW]; };

function BuseBouchee() {
  const [won, win] = useWin("buse-bouchee");
  const S = useRef(null);
  if (!S.current) S.current = { T: 26, heat: false, th: 0, tc: 0, soak: 0, step: "heat", band: bbPullBand(), streak: 0, anim: null, animT: 0 };
  const wonRef = useRef(false);
  wonRef.current = won;
  const [, force] = useState(0);
  const [msg, setMsg] = useState("Étape 1 : chauffe la buse et tiens-la dans la plage verte.");

  const setHeat = useCallback(v => {
    const s = S.current;
    if (v && (s.step !== "heat" || s.anim === "ok")) return;
    if (v && !s.heat) s.th = 0;
    if (!v && s.heat) s.tc = 0;
    s.heat = v;
  }, []);

  const miss = text => {
    const s = S.current;
    s.streak = 0; s.step = "heat"; s.soak = 0; s.band = bbPullBand(); s.heat = false; s.tc = 0;
    s.anim = "fail"; s.animT = 0.9;
    setMsg(`${text} Série remise à zéro : on rechauffe.`);
  };
  const pull = () => {
    const s = S.current;
    if (wonRef.current || s.anim === "ok") return;
    if (s.step === "heat") { setMsg("Doucement ! D'abord on chauffe, puis on laisse refroidir."); return; }
    const [lo, hi] = s.band;
    if (s.T > hi) { miss(`Trop chaud (${Math.round(s.T)} °C) : ça file comme de la mozzarella, le filament casse dans la buse.`); return; }
    if (s.T < lo) { miss(`Trop froid (${Math.round(s.T)} °C) : c'est figé, ça ne bouge pas d'un poil.`); return; }
    s.streak += 1; s.anim = "ok"; s.animT = 1.4; s.heat = false;
    if (s.streak >= BB_STREAK) { setMsg("Trois bouchons parfaits d'affilée : la buse est propre comme un sou neuf !"); win(); }
    else setMsg(`Cold pull réussi (${s.streak} / ${BB_STREAK}) ! Un joli bouchon en forme de buse. On remet ça.`);
  };

  useKeyDown(e => {
    if (e.key === " ") { e.preventDefault(); if (!e.repeat) setHeat(true); }
    else if ((e.key === "t" || e.key === "T" || e.key === "Enter" || e.key === "ArrowUp") && !e.repeat) { e.preventDefault(); pull(); }
  }, e => { if (e.key === " ") setHeat(false); });

  useLoop(dt => {
    const s = S.current;
    if (s.heat) { s.th += dt; s.T += Math.min(130, 15 + 60 * s.th) * dt; }
    else { s.tc += dt; s.T -= Math.min(36, 4 + 9 * s.tc) * dt * clamp((s.T - 22) / 60, 0, 1); }
    s.T = clamp(s.T, 22, BB_TMAX);
    if (s.animT > 0) {
      s.animT -= dt;
      if (s.animT <= 0) {
        const was = s.anim;
        s.anim = null;
        if (was === "ok" && !wonRef.current) {
          s.step = "heat"; s.soak = 0; s.band = bbPullBand(); s.tc = 0;
          setMsg(`Étape 1 : rechauffe (${s.streak} / ${BB_STREAK} d'affilée).`);
        }
      }
    }
    if (s.step === "heat" && !wonRef.current && s.anim !== "ok") {
      if (s.T >= BB_HEAT[0] && s.T <= BB_HEAT[1]) {
        s.soak += dt;
        if (s.soak >= BB_SOAK) {
          s.step = "cool"; s.heat = false; s.tc = 0;
          setMsg("Étape 2 : chauffage coupé, le ventilo s'emballe. Tire pile dans la plage bleue !");
        }
      } else s.soak = Math.max(0, s.soak - dt * 2);
    }
    if (!wonRef.current && s.step === "cool" && s.T < s.band[0] - 1 && s.anim !== "ok") miss("Trop tard : le filament est figé dans la buse.");
    force(x => (x + 1) % 1000000);
  });

  const s = S.current;
  const yOf = t => 228 - (t / BB_TMAX) * 210;
  const glow = clamp((s.T - 60) / 200, 0, 1);
  const pulled = s.anim === "ok" ? clamp((1.4 - s.animT) / 0.5, 0, 1) : won ? 1 : 0;
  const smoke = s.T > 268;
  const steps = [
    { k: "heat", t: `Chauffe ${BB_HEAT[0]}–${BB_HEAT[1]} °C`, on: s.step === "heat" },
    { k: "cool", t: `Refroidis ${s.band[0]}–${s.band[1]} °C`, on: s.step === "cool" && s.T > s.band[1] },
    { k: "pull", t: "Tire !", on: s.step === "cool" && s.T <= s.band[1] && s.T >= s.band[0] },
  ];
  return (
    <Stage won={won} wonText="Buse débouchée, trois fois de suite !" font={SANS}
      bg="radial-gradient(circle at 50% 20%, #44403c, #0c0a09 75%)" style={{ justifyContent:"flex-start" }}>
      <style>{`
        @keyframes buse-bouchee-shake { 0%,100% { transform:translateX(0) } 20% { transform:translateX(-5px) } 60% { transform:translateX(5px) } }
        @keyframes buse-bouchee-smoke { 0% { transform:translateY(0) scale(.6); opacity:.7 } 100% { transform:translateY(-50px) scale(1.6); opacity:0 } }
      `}</style>
      <Title sub={`Le cold pull : chauffer, laisser refroidir, tirer au bon moment. Réussis-en ${BB_STREAK} d'affilée.`}>Buse bouchée</Title>
      <div style={{ display:"flex", gap:6, margin:"10px 0 4px" }}>
        {Array.from({ length: BB_STREAK }, (_, i) => (
          <div key={i} style={{ width:30, height:30, borderRadius:8, display:"grid", placeItems:"center", fontWeight:900,
            background: i < s.streak ? "#16a34a" : "rgba(255,255,255,.1)", border:"2px solid rgba(255,255,255,.2)" }}>{i < s.streak ? "✓" : i + 1}</div>
        ))}
      </div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center", margin:"4px 0 6px" }}>
        {steps.map((st, i) => (
          <span key={st.k} style={{ fontSize:12, fontWeight:800, padding:"4px 9px", borderRadius:999,
            background: st.on ? (i === 2 ? "#0284c7" : i === 1 ? "#1d4ed8" : "#c2410c") : "rgba(255,255,255,.08)",
            opacity: st.on ? 1 : .6 }}>{i + 1}. {st.t}</span>
        ))}
      </div>
      <svg viewBox="0 0 300 240" style={{ width:"100%", maxWidth:380, animation: s.anim === "fail" ? "buse-bouchee-shake .35s 2" : "none" }}>
        <defs>
          <linearGradient id="buse-bouchee-merc" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#f59e0b"/><stop offset="1" stopColor="#ef4444"/></linearGradient>
        </defs>
        {/* thermometre */}
        <rect x="236" y="14" width="26" height="218" rx="13" fill="#1c1917" stroke="#57534e" strokeWidth="2"/>
        {s.step === "heat" && <rect x="238" y={yOf(BB_HEAT[1])} width="22" height={yOf(BB_HEAT[0]) - yOf(BB_HEAT[1])} fill="#22c55e" opacity=".6"/>}
        {s.step === "cool" && <rect x="238" y={yOf(s.band[1])} width="22" height={yOf(s.band[0]) - yOf(s.band[1])} fill="#38bdf8" opacity=".7"/>}
        <rect x="244" y={yOf(s.T)} width="10" height={228 - yOf(s.T)} rx="5" fill="url(#buse-bouchee-merc)"/>
        {[0, 100, 200, 300].map(t => (
          <g key={t}><line x1="264" x2="272" y1={yOf(t)} y2={yOf(t)} stroke="#a8a29e"/>
            <text x="274" y={yOf(t) + 4} fontSize="10" fill="#d6d3d1">{t}</text></g>
        ))}
        {/* tete : radiateur, bloc de chauffe, buse */}
        <g transform="translate(40,0)">
          {Array.from({ length: 6 }, (_, i) => <rect key={i} x="40" y={20 + i * 11} width="100" height="6" rx="2" fill="#94a3b8"/>)}
          <rect x="80" y="18" width="20" height="74" fill="#cbd5e1"/>
          <rect x="52" y="92" width="76" height="52" rx="6" fill={`rgb(${Math.round(150 + glow * 105)}, ${Math.round(150 - glow * 90)}, ${Math.round(150 - glow * 110)})`} stroke="#334155" strokeWidth="2"/>
          <text x="90" y="124" textAnchor="middle" fontSize="12" fontWeight="900" fill="#1f2937">{Math.round(s.T)} °C</text>
          <polygon points="74,144 106,144 96,172 84,172" fill="#d4a017" stroke="#92400e" strokeWidth="1.5"/>
          {pulled > 0 ? (
            <g style={{ transform:`translateY(${-pulled * 110}px)` }}>
              <rect x="86" y="-120" width="8" height="236" fill="#f5f5f4"/>
              <polygon points="84,116 96,116 92,140 88,140" fill="#f5f5f4"/>
              <polygon points="86.5,132 93.5,132 92,140 88,140" fill="#292524"/>
            </g>
          ) : <polygon points="86,160 94,160 92,170 88,170" fill="#292524"/>}
          {smoke && [0, 1, 2].map(i => (
            <circle key={i} cx={70 + i * 20} cy="86" r="8" fill="rgba(200,200,200,.5)"
              style={{ animation:`buse-bouchee-smoke 1.2s ease-out ${i * 0.3}s infinite`, transformOrigin:`${70 + i * 20}px 86px` }}/>
          ))}
          {pulled > 0.9 && <text x="104" y="40" fontSize="13" fontWeight="900" fill="#fde68a">← le bouchon !</text>}
        </g>
        {s.step === "heat" && (
          <g>
            <rect x="20" y="214" width="180" height="8" rx="4" fill="#292524"/>
            <rect x="20" y="214" width={180 * clamp(s.soak / BB_SOAK, 0, 1)} height="8" rx="4" fill="#22c55e"/>
            <text x="20" y="236" fontSize="10" fill="#d6d3d1">Chauffe à cœur</text>
          </g>
        )}
      </svg>
      <div style={{ minHeight:40, margin:"6px 0 8px", fontSize:13.5, fontWeight:700, textAlign:"center", maxWidth:420,
        color: s.anim === "fail" ? "#fca5a5" : "#f5f5f4" }}>{smoke && s.step === "heat" ? "Ça fume ! Le PTFE n'aime pas ça du tout." : msg}</div>
      <div style={{ display:"flex", gap:12, flexWrap:"wrap", justifyContent:"center" }}>
        <HoldBtn on={setHeat} color={s.heat ? "#dc2626" : "#ea580c"} disabled={s.step !== "heat" || won}>🔥 Chauffer</HoldBtn>
        <Btn color="#0284c7" onClick={pull} disabled={won} style={{ padding:"14px 22px", fontSize:16 }}>🪝 Tirer !</Btn>
      </div>
      <Hint won={won}>Maintiens « Chauffer » (ou espace) : ça monte de plus en plus vite. Une fois coupé, ça refroidit de plus en plus vite. Tirer : bouton ou touche T.</Hint>
    </Stage>
  );
}

export const PAGES = {
  "plateau": Plateau,
  "premiere-couche": PremiereCouche,
  "sechoir": Sechoir,
  "purge": Purge,
  "supports": Supports,
  "slicer": Slicer,
  "tri-ams": TriAms,
  "buse-bouchee": BuseBouchee,
};
