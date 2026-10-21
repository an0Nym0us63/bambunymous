import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Title, useWin, useLoop, useKeys, Btn, rand, pick } from "./kit";

// Pages cachees, serie « enigmes et jeux » : vingt scenes plein cadre.
// Chaque page appelle win() au moment exact de la reussite, une seule fois.

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/* ------------------------------------------------------------------ */
/* Outils communs                                                      */
/* ------------------------------------------------------------------ */

/** Consigne discrete sous la scene. */
function Hint({ children, style }) {
  return (
    <p style={{ margin:"12px auto 0", fontSize:13, opacity:.74, textAlign:"center", maxWidth:440, lineHeight:1.45,
      position:"relative", zIndex:2, ...style }}>{children}</p>
  );
}

/** Minuteries nettoyees au demontage. */
function useTimers() {
  const ids = useRef(new Set());
  useEffect(() => {
    const set = ids.current;
    return () => { set.forEach(clearTimeout); set.clear(); };
  }, []);
  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => { ids.current.delete(id); fn(); }, ms);
    ids.current.add(id);
    return id;
  }, []);
  const clearAll = useCallback(() => { ids.current.forEach(clearTimeout); ids.current.clear(); }, []);
  return { later, clearAll };
}

/** Ecoute clavier avec le dernier gestionnaire (pas de reabonnement a chaque rendu). */
function useKeyDown(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = e => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      ref.current(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

let audioCtx = null;
function getAudio() {
  try {
    if (!audioCtx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      audioCtx = new C();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  } catch (e) {
    return null;
  }
}

/** Bip simple, silencieux si l'audio est indisponible. */
function beep(freq, dur = 0.22, type = "sine", vol = 0.16) {
  const ac = getAudio();
  if (!ac) return;
  try {
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t0 = ac.currentTime;
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  } catch (e) {
    /* audio indisponible */
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Une bobine vue de face. */
function SpoolIcon({ color = "#22c55e", size = 48, x, y, style }) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 48 48" style={style} aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill="#1f2937" stroke="#0b0f17" strokeWidth="1"/>
      <circle cx="24" cy="24" r="19" fill={color}/>
      <circle cx="24" cy="24" r="16.5" fill="none" stroke="rgba(0,0,0,.16)" strokeWidth="1"/>
      <circle cx="24" cy="24" r="13.5" fill="none" stroke="rgba(0,0,0,.12)" strokeWidth="1"/>
      <path d="M10 17 A15 15 0 0 1 20 9.5" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="2.2" strokeLinecap="round"/>
      <circle cx="24" cy="24" r="9" fill="#111827"/>
      <circle cx="24" cy="24" r="3.6" fill="#374151"/>
      {[0, 60, 120, 180, 240, 300].map(a => (
        <circle key={a} cx={24 + 6.3 * Math.cos(a * Math.PI / 180)} cy={24 + 6.3 * Math.sin(a * Math.PI / 180)} r="1.3" fill="#4b5563"/>
      ))}
    </svg>
  );
}

/** Un Benchy stylise, base au point (0,0), proue a droite, hauteur 74. */
function BenchyShape({ fill, stroke = "rgba(0,0,0,.35)" }) {
  return (
    <g stroke={stroke} strokeWidth="1" strokeLinejoin="round">
      <path d="M-42 -26 L44 -26 Q40 -9 26 0 L-26 0 Q-38 -10 -42 -26 Z" fill={fill}/>
      <path d="M-22 -26 L-22 -52 L16 -52 L22 -26 Z" fill={fill}/>
      <path d="M-27 -52 L21 -52 L16 -58 L-22 -58 Z" fill={fill}/>
      <path d="M2 -58 L2 -74 L11 -74 L11 -58 Z" fill={fill}/>
      <rect x="-16" y="-46" width="10" height="12" rx="2" fill="rgba(0,0,0,.55)" stroke="none"/>
      <rect x="0" y="-46" width="10" height="12" rx="2" fill="rgba(0,0,0,.55)" stroke="none"/>
      <circle cx="31" cy="-16" r="3" fill="rgba(0,0,0,.5)" stroke="none"/>
      <path d="M-40 -22 L42 -22" stroke="rgba(255,255,255,.28)" fill="none"/>
      <path d="M-20 -50 L-20 -28" stroke="rgba(255,255,255,.22)" fill="none"/>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* 1. bambulab : l'imprimante qui travaille                            */
/* ------------------------------------------------------------------ */

const BL_COLORS = ["#22c55e", "#f97316", "#3b82f6", "#e11d48"];
const BL_DUR = 30;
const BL_LAYERS = 370;
const BL_CSS = `
@keyframes bambulab-spin { to { transform:rotate(360deg) } }
@keyframes bambulab-glow { 0%,100% { filter:drop-shadow(0 0 2px rgba(253,224,71,.4)) } 50% { filter:drop-shadow(0 0 10px rgba(253,224,71,.95)) } }
@keyframes bambulab-pulse { 0%,100% { opacity:.35 } 50% { opacity:1 } }
@keyframes bambulab-spark { 0% { transform:scale(0); opacity:0 } 40% { opacity:1 } 100% { transform:scale(1.4) translateY(-14px); opacity:0 } }
`;

function BambuLab() {
  const [won, win] = useWin("bambulab");
  const [t, setT] = useState(0);
  const done = t >= BL_DUR;
  useLoop(dt => setT(v => Math.min(BL_DUR, v + dt)), !done);
  useEffect(() => { if (done) win(); }, [done, win]);

  const p = t / BL_DUR;
  const pct = Math.floor(p * 100);
  const active = Math.min(3, Math.floor(p * 4));
  const H = 74;
  const tipX = done ? 236 : 170 + 42 * Math.sin(t * 5.3);
  const tipY = 236 - H * p - 1;
  const spoolX = [326, 350, 374, 398];
  const sx = spoolX[active];
  const tube = `M ${sx} 208 C ${sx} 150, 336 26, 296 24 S ${tipX} 22, ${tipX} ${tipY - 32}`;

  return (
    <Stage bg="radial-gradient(ellipse at 50% 25%, #233044 0%, #0b1120 62%, #05070d 100%)" won={won} wonText="Impression réussie !" font={FONT}>
      <style>{BL_CSS}</style>
      <Title sub="Quelque part, une imprimante travaille pour toi.">La machine</Title>
      <svg viewBox="0 0 420 320" style={{ width:"min(94vw, 560px)", height:"auto", marginTop:10, overflow:"visible" }} aria-label="Imprimante 3D en cours d'impression">
        <defs>
          <linearGradient id="bl-shell" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a4048"/><stop offset="1" stopColor="#16181c"/>
          </linearGradient>
          <radialGradient id="bl-chamber" cx="50%" cy="15%" r="95%">
            <stop offset="0" stopColor="#2f3a48"/><stop offset="1" stopColor="#0a0d12"/>
          </radialGradient>
          <linearGradient id="bl-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity=".16"/>
            <stop offset=".42" stopColor="#ffffff" stopOpacity=".03"/>
            <stop offset=".48" stopColor="#ffffff" stopOpacity=".13"/>
            <stop offset=".55" stopColor="#ffffff" stopOpacity=".02"/>
            <stop offset="1" stopColor="#ffffff" stopOpacity=".08"/>
          </linearGradient>
          <linearGradient id="bl-bands" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="-74">
            {BL_COLORS.flatMap((c, i) => [
              <stop key={i + "a"} offset={i / 4} stopColor={c}/>,
              <stop key={i + "b"} offset={(i + 1) / 4} stopColor={c}/>,
            ])}
          </linearGradient>
          <linearGradient id="bl-plate" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#854d0e"/><stop offset=".5" stopColor="#ca8a04"/><stop offset="1" stopColor="#854d0e"/>
          </linearGradient>
          <clipPath id="bl-clip"><rect x="-60" y={-H * p - 0.5} width="120" height={H * p + 1}/></clipPath>
          <filter id="bl-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
        </defs>

        <ellipse cx="220" cy="300" rx="200" ry="12" fill="#000" opacity=".5" filter="url(#bl-blur)"/>
        {/* le caisson */}
        <rect x="40" y="18" width="262" height="278" rx="16" fill="url(#bl-shell)" stroke="#4b5563"/>
        <rect x="46" y="22" width="250" height="3" rx="1.5" fill="#ffffff" opacity=".12"/>
        <rect x="56" y="38" width="230" height="216" rx="8" fill="url(#bl-chamber)"/>
        {/* eclairage de chambre */}
        <rect x="80" y="42" width="182" height="4" rx="2" fill="#fef3c7"/>
        <rect x="70" y="40" width="202" height="40" fill="#fde68a" opacity=".13" filter="url(#bl-blur)"/>
        {/* tiges */}
        <line x1="70" y1="52" x2="70" y2="252" stroke="#64748b" strokeWidth="3"/>
        <line x1="272" y1="52" x2="272" y2="252" stroke="#64748b" strokeWidth="3"/>
        {/* plateau */}
        <rect x="80" y="236" width="182" height="8" rx="2" fill="url(#bl-plate)"/>
        <rect x="80" y="236" width="182" height="1.5" fill="#fde047" opacity=".6"/>
        <rect x="88" y="244" width="166" height="6" fill="#0b0d10"/>
        {/* la piece */}
        <g transform="translate(170 236)">
          <g clipPath="url(#bl-clip)" style={done ? { animation:"bambulab-glow 2.2s ease-in-out infinite" } : undefined}>
            <BenchyShape fill="url(#bl-bands)"/>
          </g>
        </g>
        {/* portique et tete */}
        <rect x="64" y={tipY - 27} width="214" height="6" rx="2" fill="#94a3b8"/>
        <rect x="64" y={tipY - 27} width="214" height="1.5" fill="#e2e8f0" opacity=".6"/>
        <g transform={`translate(${tipX} ${tipY})`}>
          <rect x="-17" y="-34" width="34" height="27" rx="5" fill="#e5e7eb" stroke="#94a3b8"/>
          <rect x="-17" y="-34" width="34" height="7" rx="3" fill="#cbd5e1"/>
          <circle cx="0" cy="-19" r="7" fill="#1f2937" stroke="#64748b"/>
          <path d="M0 -24 L1.5 -19 L0 -14 L-1.5 -19 Z" fill="#94a3b8" style={{ transformBox:"fill-box", transformOrigin:"center", animation: done ? "none" : "bambulab-spin .3s linear infinite" }}/>
          <path d="M-5 -7 L5 -7 L2 -1 L-2 -1 Z" fill="#d97706"/>
          {!done && <circle cx="0" cy="0" r="5" fill={BL_COLORS[active]} opacity=".7" filter="url(#bl-blur)"/>}
          {!done && <circle cx="0" cy="0" r="1.6" fill="#fff7ed"/>}
        </g>
        {/* la porte vitree */}
        <g style={{ transformBox:"fill-box", transformOrigin:"left center", transform: done ? "scaleX(.05)" : "none",
          opacity: done ? .45 : 1, transition:"transform 1.8s cubic-bezier(.45,.05,.2,1), opacity 1.8s" }}>
          <rect x="56" y="38" width="230" height="216" rx="8" fill="url(#bl-glass)" stroke="#ffffff" strokeOpacity=".22"/>
          <path d="M96 40 L62 140 M120 40 L66 196" stroke="#ffffff" strokeOpacity=".09" strokeWidth="7"/>
          <rect x="270" y="112" width="6" height="72" rx="3" fill="#9ca3af"/>
        </g>
        {done && [[150, 150], [196, 140], [214, 190], [124, 196]].map(([x, y], i) => (
          <text key={i} x={x} y={y} fontSize="14" style={{ transformBox:"fill-box", transformOrigin:"center",
            animation:`bambulab-spark 1.6s ease-out ${i * 0.35}s infinite` }}>✨</text>
        ))}
        {/* ecran et voyant */}
        <rect x="232" y="262" width="58" height="22" rx="4" fill="#0b1220" stroke="#334155"/>
        <text x="261" y="277" textAnchor="middle" fontSize="11" fill="#4ade80" fontFamily={MONO}>{pct}%</text>
        <circle cx="60" cy="273" r="3.2" fill={done ? "#4ade80" : "#22c55e"} style={{ animation: done ? "none" : "bambulab-pulse 1.4s ease-in-out infinite" }}/>
        <rect x="56" y="294" width="26" height="6" rx="2" fill="#111"/>
        <rect x="260" y="294" width="26" height="6" rx="2" fill="#111"/>
        {/* l'AMS */}
        <rect x="310" y="204" width="104" height="72" rx="10" fill="url(#bl-shell)" stroke="#4b5563"/>
        <rect x="314" y="208" width="96" height="42" rx="7" fill="#94a3b8" fillOpacity=".1" stroke="#ffffff" strokeOpacity=".14"/>
        {spoolX.map((x, i) => (
          <g key={i} style={{ transformBox:"fill-box", transformOrigin:"center",
            animation: i === active && !done ? "bambulab-spin 1.4s linear infinite" : "none" }}>
            <SpoolIcon x={x - 11} y={218} size={22} color={BL_COLORS[i]}/>
          </g>
        ))}
        {!done && <path d={`M${sx - 4} 257 L${sx + 4} 257 L${sx} 252 Z`} fill="#fef08a"/>}
        <text x="362" y="270" textAnchor="middle" fontSize="8" fill="#94a3b8" letterSpacing="3" fontFamily={FONT}>AMS</text>
        {/* le tube */}
        <path d={tube} fill="none" stroke="#ffffff" strokeOpacity=".28" strokeWidth="4" strokeLinecap="round"/>
        <path d={tube} fill="none" stroke={BL_COLORS[active]} strokeOpacity=".9" strokeWidth="1.6" strokeLinecap="round"/>
      </svg>

      <div style={{ width:"min(92vw, 460px)", marginTop:12, position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", justifyContent:"space-between", gap:10, fontSize:14, fontWeight:800, marginBottom:6 }}>
          <span>Impression : {pct} %</span>
          <span style={{ opacity:.7, fontFamily:MONO, fontWeight:500, fontSize:12.5 }}>
            {done ? "Terminé" : `Couche ${Math.max(1, Math.ceil(p * BL_LAYERS))}/${BL_LAYERS} · ${Math.ceil(BL_DUR - t)} s`}
          </span>
        </div>
        <div style={{ height:12, borderRadius:8, background:"rgba(255,255,255,.08)", overflow:"hidden", border:"1px solid rgba(255,255,255,.12)" }}>
          <div style={{ width:`${p * 100}%`, height:"100%", borderRadius:8,
            background:`linear-gradient(90deg, ${BL_COLORS[0]}, ${BL_COLORS[1]}, ${BL_COLORS[2]}, ${BL_COLORS[3]})`,
            boxShadow:`0 0 14px ${BL_COLORS[active]}` }}/>
        </div>
      </div>
      <Hint>{done ? "La porte s'ouvre… ton Benchy est prêt, encore tiède." : "Une belle impression ne se presse pas. Reste jusqu'au bout."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 2. pilule : rouge ou bleue                                          */
/* ------------------------------------------------------------------ */

const PIL_GLYPHS = "01アイウエオカキクケコサシスセソPLAPETGABSTPU{}<>#$%=+".split("");
const PIL_CSS = `
@keyframes pilule-rain { from { transform:translateY(-100%) } to { transform:translateY(120vh) } }
@keyframes pilule-dissolve { 0% { filter:none; opacity:1; transform:none }
  100% { filter:blur(12px) hue-rotate(90deg); opacity:0; transform:scale(1.08) } }
@keyframes pilule-in { from { opacity:0 } to { opacity:1 } }
@keyframes pilule-up { from { opacity:0; transform:translateY(18px) } to { opacity:1; transform:none } }
@keyframes pilule-pulse { 0%,100% { filter:brightness(1) } 50% { filter:brightness(1.55) } }
@keyframes pilule-flicker { 0%,100% { opacity:.9 } 47% { opacity:.9 } 48% { opacity:.4 } 50% { opacity:.95 } 52% { opacity:.5 } 53% { opacity:.9 } }
.pilule-hand { transition:transform .35s cubic-bezier(.2,1.4,.4,1) }
.pilule-hand:hover, .pilule-hand:focus-visible { transform:translateY(-10px); outline:none }
`;

function HandPill({ color, label, onClick, flip, disabled }) {
  const id = flip ? "b" : "r";
  const skin = `url(#pil-skin-${id})`;
  return (
    <button aria-label={label} onClick={onClick} disabled={disabled} className="pilule-hand"
      style={{ background:"none", border:"none", padding:0, cursor:"pointer", width:"min(42vw, 190px)", minHeight:44,
        WebkitTapHighlightColor:"transparent" }}>
      <svg viewBox="0 0 160 190" style={{ width:"100%", height:"auto", overflow:"visible", transform: flip ? "scaleX(-1)" : undefined }}>
        <defs>
          <linearGradient id={`pil-skin-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5a463e"/><stop offset="1" stopColor="#1b1311"/>
          </linearGradient>
          <linearGradient id={`pil-shade-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity=".55"/>
            <stop offset=".45" stopColor="#ffffff" stopOpacity="0"/>
            <stop offset="1" stopColor="#000000" stopOpacity=".5"/>
          </linearGradient>
          <filter id={`pil-glow-${id}`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <ellipse cx="82" cy="134" rx="78" ry="56" fill={color} opacity=".12"/>
        <path d="M58 190 L62 150 L114 150 L120 190 Z" fill={skin}/>
        {[[38, 66, -16], [60, 50, -6], [84, 48, 4], [106, 58, 14]].map(([x, y, r], i) => (
          <rect key={i} x={x - 10} y={y} width="20" height="72" rx="10" transform={`rotate(${r} ${x} ${y + 72})`}
            fill={skin} stroke={color} strokeOpacity=".55" strokeWidth="1.2"/>
        ))}
        <rect x="120" y="98" width="20" height="56" rx="10" transform="rotate(40 130 152)" fill={skin} stroke={color} strokeOpacity=".55" strokeWidth="1.2"/>
        <ellipse cx="82" cy="134" rx="50" ry="32" fill={skin} stroke={color} strokeOpacity=".75" strokeWidth="1.4"/>
        <path d="M50 132 Q80 146 112 128" fill="none" stroke="#000" strokeOpacity=".35" strokeWidth="1.5"/>
        <g filter={`url(#pil-glow-${id})`}>
          <g style={{ animation:"pilule-pulse 2.2s ease-in-out infinite" }}>
            <g transform="translate(82 124) rotate(-18)">
              <rect x="-28" y="-11" width="56" height="22" rx="11" fill={color}/>
              <rect x="-28" y="-11" width="56" height="22" rx="11" fill={`url(#pil-shade-${id})`}/>
              <ellipse cx="-8" cy="-5" rx="13" ry="2.8" fill="#ffffff" opacity=".7"/>
            </g>
          </g>
        </g>
      </svg>
    </button>
  );
}

function Pilule() {
  const [won, win] = useWin("pilule");
  const [choice, setChoice] = useState(null);
  const rain = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
    left: (i / 30) * 100 + Math.random() * 2, dur: rand(2.6, 6), delay: -rand(0, 6),
    text: Array.from({ length: 28 }, () => pick(PIL_GLYPHS)).join("\n"),
  })), []);
  const red = () => { if (choice) return; setChoice("rouge"); win(); };
  const blue = () => { if (choice) return; setChoice("bleue"); };

  return (
    <Stage won={won} wonText="Bienvenue dans le vrai monde" font={FONT}
      bg="radial-gradient(ellipse at 18% 62%, rgba(239,68,68,.24), transparent 42%), radial-gradient(ellipse at 82% 62%, rgba(59,130,246,.24), transparent 42%), linear-gradient(180deg, #04050a, #0b0d18 60%, #04050a)">
      <style>{PIL_CSS}</style>
      <div aria-hidden="true" style={{ position:"absolute", left:"-50%", right:"-50%", bottom:0, height:"46%", pointerEvents:"none",
        background:"repeating-linear-gradient(90deg, rgba(168,85,247,.28) 0 1px, transparent 1px 56px), repeating-linear-gradient(0deg, rgba(168,85,247,.28) 0 1px, transparent 1px 38px)",
        transform:"perspective(380px) rotateX(62deg)", transformOrigin:"bottom",
        WebkitMaskImage:"linear-gradient(to top, #000, transparent)", maskImage:"linear-gradient(to top, #000, transparent)" }}/>
      <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none",
        background:"repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 3px)" }}/>

      <div style={{ position:"relative", zIndex:2, display:"flex", flexDirection:"column", alignItems:"center",
        animation: choice === "rouge" ? "pilule-dissolve 2.4s ease forwards" : "pilule-in .8s ease both" }}>
        <Title sub="Deux mains, deux pilules. Une seule question." color="#f5f3ff">
          <span style={{ animation:"pilule-flicker 4s linear infinite" }}>Le choix</span>
        </Title>
        <p style={{ maxWidth:440, textAlign:"center", fontSize:14.5, lineHeight:1.6, opacity:.88, margin:"16px 0 10px" }}>
          <span style={{ color:"#93c5fd" }}>Bleue</span> : l'histoire s'arrête là, tu te réveilles devant ton trancheur et tu crois ce que tu veux.<br/>
          <span style={{ color:"#fca5a5" }}>Rouge</span> : tu restes au pays des bobines, et je te montre jusqu'où descend le filament.
        </p>
        <div style={{ display:"flex", gap:"clamp(6px, 5vw, 48px)", justifyContent:"center", alignItems:"flex-end", marginTop:8 }}>
          <HandPill color="#ef4444" label="Prendre la pilule rouge" onClick={red} disabled={!!choice}/>
          <HandPill color="#3b82f6" label="Prendre la pilule bleue" onClick={blue} flip disabled={!!choice}/>
        </div>
        <Hint>Choisis bien. Il n'y a pas de retour… enfin, presque.</Hint>
      </div>

      {choice === "rouge" && (
        <div aria-hidden="true" style={{ position:"absolute", inset:0, zIndex:5, background:"rgba(1,8,3,.94)", fontFamily:MONO,
          animation:"pilule-in 1.6s ease both", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
          {rain.map((c, i) => (
            <pre key={i} style={{ position:"absolute", top:0, left:`${c.left}%`, margin:0, fontSize:14, lineHeight:1.15,
              color:"rgba(74,222,128,.55)", textShadow:"0 0 8px rgba(34,197,94,.8)",
              animation:`pilule-rain ${c.dur}s linear ${c.delay}s infinite` }}>{c.text}</pre>
          ))}
          <div style={{ position:"relative", textAlign:"center", color:"#86efac", padding:"18px 22px", borderRadius:14,
            background:"rgba(0,0,0,.72)", border:"1px solid rgba(74,222,128,.5)", animation:"pilule-up 1s ease 1.4s both", maxWidth:360 }}>
            <div style={{ fontSize:18, fontWeight:800, color:"#4ade80" }}>&gt; Tu as choisi la rouge.</div>
            <div style={{ marginTop:8, fontSize:13.5, lineHeight:1.6 }}>Le terrier est plus profond que tu ne crois.<br/>On le descend… 0,2 mm à la fois.</div>
          </div>
        </div>
      )}
      {choice === "bleue" && (
        <div style={{ position:"absolute", inset:0, zIndex:5, display:"flex", flexDirection:"column", alignItems:"center",
          justifyContent:"center", gap:14, padding:20, textAlign:"center", animation:"pilule-in 1s ease both",
          background:"radial-gradient(ellipse at center, rgba(30,58,138,.55), #020617 72%)" }}>
          <div style={{ fontSize:64, animation:"hk-float 3s ease-in-out infinite" }}>🛏️</div>
          <div style={{ fontSize:20, fontWeight:800 }}>Tu te réveilles dans ton lit…</div>
          <div style={{ fontSize:14, opacity:.8, maxWidth:320, lineHeight:1.5 }}>
            L'imprimante ronronne dans la pièce d'à côté. Rien ne s'est passé. Vraiment rien ?
          </div>
          <Btn color="#3b82f6" onClick={() => setChoice(null)} style={{ minHeight:44 }}>Recommencer</Btn>
        </div>
      )}
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 3. coffre : le coffre-fort du bureau                                */
/* ------------------------------------------------------------------ */

const COFFRE_CODE = "1000";
const COFFRE_CSS = `
@keyframes coffre-shake { 0%,100% { transform:translateX(0) } 20% { transform:translateX(-8px) } 40% { transform:translateX(7px) }
  60% { transform:translateX(-5px) } 80% { transform:translateX(3px) } }
@keyframes coffre-glow { 0%,100% { box-shadow:inset 0 0 40px rgba(250,204,21,.35) } 50% { box-shadow:inset 0 0 80px rgba(250,204,21,.75) } }
.coffre-key:active { transform:translateY(2px); box-shadow:0 1px 0 #111 !important }
`;

function PostIt({ color, rot, children, style }) {
  return (
    <div style={{ width:"min(40vw, 150px)", minHeight:96, padding:"14px 12px 12px", background:color, color:"#3f3f46",
      transform:`rotate(${rot}deg)`, boxShadow:"0 10px 18px rgba(0,0,0,.35), inset 0 -10px 18px rgba(0,0,0,.06)",
      fontFamily:"'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive", fontSize:13.5, lineHeight:1.35, position:"relative", boxSizing:"border-box", ...style }}>
      <span aria-hidden="true" style={{ position:"absolute", top:-8, left:"50%", width:46, height:16, marginLeft:-23,
        background:"rgba(255,255,255,.45)", transform:"rotate(-3deg)" }}/>
      {children}
    </div>
  );
}

function Coffre() {
  const [won, win] = useWin("coffre");
  const [code, setCode] = useState("");
  const [state, setState] = useState("idle");
  const { later } = useTimers();
  const codeRef = useRef("");
  const stateRef = useRef("idle");
  codeRef.current = code;
  stateRef.current = state;

  const press = useCallback(k => {
    if (stateRef.current !== "idle") return;
    const cur = codeRef.current;
    if (k === "C") { setCode(""); beep(300, 0.08, "square", 0.05); return; }
    if (k === "<") { setCode(cur.slice(0, -1)); return; }
    if (k === "OK") {
      if (cur === COFFRE_CODE) {
        setState("open");
        beep(660, 0.15); later(() => beep(880, 0.15), 140); later(() => beep(1320, 0.4), 280);
        win();
      } else {
        setState("bad");
        beep(140, 0.4, "sawtooth", 0.08);
        later(() => { setState("idle"); setCode(""); }, 900);
      }
      return;
    }
    if (cur.length < 4) { setCode(cur + k); beep(1000 + Number(k) * 40, 0.07, "square", 0.04); }
  }, [later, win]);

  useKeyDown(e => {
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") press("<");
    else if (e.key === "Enter") press("OK");
    else if (e.key === "Escape") press("C");
  });

  const open = state === "open";
  const led = open ? "#22c55e" : state === "bad" ? "#ef4444" : "#f59e0b";
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"];

  return (
    <Stage won={won} wonText="Coffre ouvert !" font={FONT}
      bg="linear-gradient(180deg, #3a2c26 0%, #2a1f1b 64%, #6b4423 64%, #4a2d16 72%, #2b1a0d 100%)">
      <style>{COFFRE_CSS}</style>
      <div aria-hidden="true" style={{ position:"absolute", inset:"0 0 36% 0", pointerEvents:"none",
        background:"repeating-linear-gradient(90deg, rgba(255,255,255,.025) 0 2px, transparent 2px 34px)" }}/>
      <div aria-hidden="true" style={{ position:"absolute", top:-60, left:"50%", width:420, height:300, marginLeft:-210, pointerEvents:"none",
        background:"radial-gradient(ellipse at center, rgba(254,243,199,.18), transparent 70%)" }}/>
      <Title sub="Le patron a laissé quelques pense-bêtes. Tant pis pour lui." color="#fde68a">Le coffre</Title>

      <div style={{ display:"flex", gap:18, justifyContent:"center", flexWrap:"wrap", margin:"22px 0 18px", position:"relative", zIndex:2 }}>
        <PostIt color="#fde047" rot={-5}>Mémo : le code, c'est ce que pèse une neuve. 🧵</PostIt>
        <PostIt color="#f9a8d4" rot={4}>Ce coffre est têtu : il ne parle qu'en grammes. Jamais en kilos !</PostIt>
      </div>

      <div style={{ position:"relative", zIndex:2, width:"min(84vw, 290px)", height:340, perspective:1100 }}>
        {/* l'interieur */}
        <div style={{ position:"absolute", inset:0, borderRadius:14, background:"linear-gradient(160deg, #111827, #030712)",
          border:"6px solid #1f2937", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          animation: open ? "coffre-glow 2s ease-in-out infinite" : "none" }}>
          <SpoolIcon size={110} color="#facc15" style={{ filter:"drop-shadow(0 0 18px rgba(250,204,21,.7))" }}/>
          <div style={{ marginTop:12, fontWeight:900, color:"#fde68a", fontSize:16 }}>La bobine d'or</div>
          <div style={{ fontSize:12, opacity:.7, marginTop:4 }}>1000 g de pur bonheur</div>
        </div>
        {/* la porte */}
        <div style={{ position:"absolute", inset:0, borderRadius:14, transformOrigin:"left center",
          transform: open ? "rotateY(-100deg)" : "none", transition:"transform 1.7s cubic-bezier(.4,.05,.2,1) .55s",
          background:"linear-gradient(145deg, #7c8592 0%, #4b5563 40%, #2b313b 100%)",
          boxShadow:"0 24px 50px rgba(0,0,0,.6), inset 0 2px 0 rgba(255,255,255,.25), inset 0 -3px 0 rgba(0,0,0,.4)",
          border:"2px solid #1f2937", padding:"18px 18px", display:"flex", flexDirection:"column", alignItems:"center",
          animation: state === "bad" ? "coffre-shake .45s ease" : "none" }}>
          {[[8, 8], [8, null], [null, 8], [null, null]].map(([t, l], i) => (
            <span key={i} aria-hidden="true" style={{ position:"absolute", width:9, height:9, borderRadius:"50%",
              background:"radial-gradient(circle at 35% 35%, #e5e7eb, #4b5563)", top: t ?? undefined, bottom: t == null ? 8 : undefined,
              left: l ?? undefined, right: l == null ? 8 : undefined }}/>
          ))}
          <span aria-hidden="true" style={{ position:"absolute", left:-7, top:50, width:10, height:46, borderRadius:4, background:"#1f2937" }}/>
          <span aria-hidden="true" style={{ position:"absolute", left:-7, bottom:50, width:10, height:46, borderRadius:4, background:"#1f2937" }}/>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
            <div style={{ width:150, height:42, borderRadius:8, background:"#0a1f12", border:"2px solid #111", display:"flex",
              alignItems:"center", justifyContent:"center", gap:10, fontFamily:MONO, fontSize:24, fontWeight:700,
              color: state === "bad" ? "#f87171" : "#4ade80", textShadow:"0 0 8px currentColor", boxShadow:"inset 0 2px 8px rgba(0,0,0,.8)" }}>
              {state === "bad" ? "ERR" : open ? "OPEN" : [0, 1, 2, 3].map(i => <span key={i}>{code[i] ?? "_"}</span>)}
            </div>
            <span aria-hidden="true" style={{ width:14, height:14, borderRadius:"50%", background:led, boxShadow:`0 0 12px ${led}` }}/>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 56px)", gap:8 }}>
            {keys.map(k => (
              <button key={k} className="coffre-key" onClick={() => press(k)} aria-label={k === "C" ? "Effacer" : k === "OK" ? "Valider" : k}
                style={{ height:46, borderRadius:10, border:"1px solid #111", cursor:"pointer", fontWeight:800, fontSize:18,
                  fontFamily:FONT, color: k === "OK" ? "#052e16" : k === "C" ? "#450a0a" : "#e5e7eb",
                  background: k === "OK" ? "linear-gradient(#4ade80, #16a34a)" : k === "C" ? "linear-gradient(#fca5a5, #dc2626)" : "linear-gradient(#4b5563, #1f2937)",
                  boxShadow:"0 3px 0 #111", transition:"transform .05s" }}>{k}</button>
            ))}
          </div>
          <div aria-hidden="true" style={{ position:"absolute", right:-4, top:"50%", width:16, height:60, marginTop:-30, borderRadius:6,
            background:"linear-gradient(90deg, #d1d5db, #6b7280)", boxShadow:"0 2px 6px rgba(0,0,0,.5)" }}/>
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"flex-end", gap:16, marginTop:18, position:"relative", zIndex:2 }}>
        <div style={{ position:"relative" }}>
          <SpoolIcon size={70} color="#0ea5e9" style={{ filter:"drop-shadow(0 6px 6px rgba(0,0,0,.5))" }}/>
          <div style={{ position:"absolute", left:46, top:6, transform:"rotate(8deg)", background:"#f8fafc", color:"#111", fontSize:10.5,
            padding:"5px 7px", borderRadius:4, boxShadow:"0 3px 8px rgba(0,0,0,.4)", lineHeight:1.3, whiteSpace:"nowrap", fontFamily:MONO }}>
            PLA Basic · Cyan<br/>Poids net : 1 kg<br/>Ø 1,75 mm
          </div>
        </div>
        <div style={{ width:60 }}/>
        <span style={{ fontSize:34 }} aria-hidden="true">☕</span>
        <span style={{ fontSize:34 }} aria-hidden="true">🪴</span>
      </div>
      <Hint style={{ color:"#fde68a" }}>Quatre chiffres. Les indices traînent sur le bureau.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 4. labyrinthe : guider la buse jusqu'a la bobine d'or               */
/* ------------------------------------------------------------------ */

const LAB_N = 11;
const LAB_C = 30;
const LAB_CSS = `
@keyframes labyrinthe-glow { 0%,100% { filter:drop-shadow(0 0 3px rgba(250,204,21,.6)) } 50% { filter:drop-shadow(0 0 12px rgba(250,204,21,1)) } }
.labyrinthe-pad { width:52px; height:48px; border-radius:12px; border:1px solid rgba(255,255,255,.18); color:#fff; font-size:20px;
  background:linear-gradient(#334155, #1e293b); box-shadow:0 3px 0 #0f172a; cursor:pointer }
.labyrinthe-pad:active { transform:translateY(2px); box-shadow:0 1px 0 #0f172a }
`;

function makeMaze(n) {
  const cells = Array.from({ length: n * n }, () => ({ n: true, e: true, s: true, w: true }));
  const seen = new Array(n * n).fill(false);
  const stack = [0];
  seen[0] = true;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const x = c % n, y = Math.floor(c / n);
    const opts = [];
    if (y > 0 && !seen[c - n]) opts.push(["n", c - n, "s"]);
    if (x < n - 1 && !seen[c + 1]) opts.push(["e", c + 1, "w"]);
    if (y < n - 1 && !seen[c + n]) opts.push(["s", c + n, "n"]);
    if (x > 0 && !seen[c - 1]) opts.push(["w", c - 1, "e"]);
    if (!opts.length) { stack.pop(); continue; }
    const [d, nb, od] = pick(opts);
    cells[c][d] = false;
    cells[nb][od] = false;
    seen[nb] = true;
    stack.push(nb);
  }
  return cells;
}

function Labyrinthe() {
  const [won, win] = useWin("labyrinthe");
  const [maze, setMaze] = useState(() => makeMaze(LAB_N));
  const [pos, setPos] = useState(0);
  const [trail, setTrail] = useState([0]);
  const [moves, setMoves] = useState(0);
  const exit = LAB_N * LAB_N - 1;
  const arrived = pos === exit;
  const swipe = useRef(null);

  const move = useCallback(dir => {
    if (pos === exit) return;
    const c = maze[pos];
    let nb = -1;
    if (dir === "n" && !c.n) nb = pos - LAB_N;
    if (dir === "s" && !c.s) nb = pos + LAB_N;
    if (dir === "e" && !c.e) nb = pos + 1;
    if (dir === "w" && !c.w) nb = pos - 1;
    if (nb < 0) return;
    setPos(nb);
    setMoves(m => m + 1);
    setTrail(tr => (tr.length > 1 && tr[tr.length - 2] === nb ? tr.slice(0, -1) : [...tr, nb]));
    if (nb === exit) win();
  }, [maze, pos, exit, win]);

  useKeyDown(e => {
    const map = { ArrowUp:"n", ArrowDown:"s", ArrowLeft:"w", ArrowRight:"e", z:"n", w:"n", s:"s", q:"w", a:"w", d:"e" };
    const d = map[e.key];
    if (d) { e.preventDefault(); move(d); }
  });

  const reset = () => { setMaze(makeMaze(LAB_N)); setPos(0); setTrail([0]); setMoves(0); };

  const walls = useMemo(() => {
    let d = "";
    for (let i = 0; i < LAB_N * LAB_N; i++) {
      const x = (i % LAB_N) * LAB_C, y = Math.floor(i / LAB_N) * LAB_C;
      const c = maze[i];
      if (c.n && i >= LAB_N) d += `M${x} ${y}h${LAB_C}`;
      if (c.w && i % LAB_N) d += `M${x} ${y}v${LAB_C}`;
    }
    return d;
  }, [maze]);
  const S = LAB_N * LAB_C;
  const ctr = i => [(i % LAB_N) * LAB_C + LAB_C / 2, Math.floor(i / LAB_N) * LAB_C + LAB_C / 2];
  const [px, py] = ctr(pos);
  const [ex, ey] = ctr(exit);

  const onDown = e => { swipe.current = [e.clientX, e.clientY]; };
  const onUp = e => {
    if (!swipe.current) return;
    const dx = e.clientX - swipe.current[0], dy = e.clientY - swipe.current[1];
    swipe.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? "e" : "w");
    else move(dy > 0 ? "s" : "n");
  };

  return (
    <Stage won={won} wonText="Sortie trouvée !" font={FONT}
      bg="radial-gradient(ellipse at 50% 0%, #1e3a5f 0%, #0b1324 60%, #050811 100%)">
      <style>{LAB_CSS}</style>
      <Title sub="La buse s'est perdue sur le plateau. Ramène-la à la bobine d'or.">Le labyrinthe</Title>
      <div onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { swipe.current = null; }}
        style={{ marginTop:16, padding:10, borderRadius:16, touchAction:"none", position:"relative", zIndex:2,
          background:"linear-gradient(145deg, #3f3f46, #18181b)", boxShadow:"0 20px 50px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.12)" }}>
        <svg viewBox={`-6 -6 ${S + 12} ${S + 12}`} style={{ width:"min(88vw, 420px)", height:"auto", display:"block" }}>
          <defs>
            <pattern id="lab-pei" width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="#26201a"/><circle cx="2" cy="2" r=".8" fill="#3b3127"/><circle cx="5" cy="4.5" r=".6" fill="#1a1612"/>
            </pattern>
            <filter id="lab-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <rect x="-6" y="-6" width={S + 12} height={S + 12} rx="8" fill="url(#lab-pei)"/>
          <path d={`M0 ${LAB_C}V${S}H${S}M${S} ${S - LAB_C}V0H0`} stroke="#cbd5e1" strokeWidth="4" fill="none" strokeLinecap="round"/>
          <path d={walls} stroke="#e2e8f0" strokeWidth="3.4" fill="none" strokeLinecap="round" filter="url(#lab-glow)"/>
          <polyline points={trail.map(i => ctr(i).join(",")).join(" ")} fill="none" stroke="#f97316" strokeWidth="5"
            strokeLinecap="round" strokeLinejoin="round" opacity=".85"/>
          <g transform={`translate(${ex} ${ey})`} style={{ animation:"labyrinthe-glow 1.6s ease-in-out infinite" }}>
            <SpoolIcon x={-12} y={-12} size={24} color="#facc15"/>
          </g>
          <g transform={`translate(${px} ${py})`} style={{ transition:"transform .12s ease-out" }}>
            <circle r="11" fill="#f97316" opacity=".25"/>
            <path d="M-8 -9 L8 -9 L8 -2 L4 4 L1.5 9 L-1.5 9 L-4 4 L-8 -2 Z" fill="#fbbf24" stroke="#78350f" strokeWidth="1.2"/>
            <rect x="-8" y="-9" width="16" height="4" fill="#d97706"/>
            <circle cy="9" r="1.8" fill="#fff7ed"/>
          </g>
        </svg>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 52px)", gap:6, marginTop:14, position:"relative", zIndex:2 }}>
        <span/><button className="labyrinthe-pad" aria-label="Haut" onClick={() => move("n")}>▲</button><span/>
        <button className="labyrinthe-pad" aria-label="Gauche" onClick={() => move("w")}>◀</button>
        <button className="labyrinthe-pad" aria-label="Bas" onClick={() => move("s")}>▼</button>
        <button className="labyrinthe-pad" aria-label="Droite" onClick={() => move("e")}>▶</button>
      </div>
      <div style={{ display:"flex", gap:12, alignItems:"center", marginTop:12, position:"relative", zIndex:2 }}>
        <span style={{ fontFamily:MONO, fontSize:13, opacity:.8 }}>{arrived ? `Arrivée en ${moves} pas !` : `${moves} pas`}</span>
        <Btn color="#475569" onClick={reset} style={{ minHeight:42 }}>Nouveau plateau</Btn>
      </div>
      <Hint>Flèches du clavier, glissé du doigt sur le plateau ou boutons.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 5. memoire : les paires de bobines                                  */
/* ------------------------------------------------------------------ */

const MEM_CARDS = [
  { id: "pla-r", mat: "PLA", name: "Rouge", color: "#ef4444" },
  { id: "petg-b", mat: "PETG", name: "Bleu", color: "#3b82f6" },
  { id: "abs-j", mat: "ABS", name: "Jaune", color: "#eab308" },
  { id: "tpu-v", mat: "TPU", name: "Vert", color: "#22c55e" },
  { id: "asa-o", mat: "ASA", name: "Orange", color: "#f97316" },
  { id: "silk", mat: "Silk", name: "Or", color: "#c9a227" },
  { id: "petg-v", mat: "PETG", name: "Violet", color: "#a855f7" },
  { id: "pla-w", mat: "PLA", name: "Blanc", color: "#f1f5f9" },
];
const MEM_CSS = `
@keyframes memoire-found { 0%,100% { box-shadow:0 0 0 2px #22c55e, 0 6px 16px rgba(0,0,0,.35) } 50% { box-shadow:0 0 0 2px #4ade80, 0 0 22px rgba(74,222,128,.7) } }
.memoire-card:hover .memoire-inner:not(.memoire-up) { transform:rotateY(14deg) }
`;
const dealMemory = () => shuffle([...MEM_CARDS, ...MEM_CARDS]).map((c, i) => ({ ...c, key: i }));

function Memoire() {
  const [won, win] = useWin("memoire");
  const [deck, setDeck] = useState(dealMemory);
  const [open, setOpen] = useState([]);
  const [found, setFound] = useState(() => new Set());
  const [moves, setMoves] = useState(0);
  const { later, clearAll } = useTimers();
  const busy = useRef(false);

  const flip = i => {
    if (busy.current || open.includes(i) || found.has(deck[i].id)) return;
    beep(520, 0.06, "triangle", 0.06);
    if (open.length === 0) { setOpen([i]); return; }
    const a = open[0];
    setOpen([a, i]);
    setMoves(m => m + 1);
    busy.current = true;
    if (deck[a].id === deck[i].id) {
      later(() => {
        const nf = new Set(found);
        nf.add(deck[i].id);
        setFound(nf);
        setOpen([]);
        busy.current = false;
        beep(880, 0.15, "triangle", 0.1);
        if (nf.size === MEM_CARDS.length) win();
      }, 450);
    } else {
      later(() => { setOpen([]); busy.current = false; }, 900);
    }
  };

  const reset = () => { clearAll(); busy.current = false; setDeck(dealMemory()); setOpen([]); setFound(new Set()); setMoves(0); };
  const face = { position:"absolute", inset:0, borderRadius:12, backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden",
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" };
  const all = found.size === MEM_CARDS.length;

  return (
    <Stage won={won} wonText="Mémoire d'éléphant !" font={FONT}
      bg="radial-gradient(ellipse at 50% 10%, #134e4a 0%, #042f2e 55%, #021716 100%)">
      <style>{MEM_CSS}</style>
      <Title sub="L'AMS a tout mélangé. Retrouve les bobines jumelles.">Mémoire</Title>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"clamp(6px, 2.2vw, 12px)", width:"min(92vw, 420px)",
        marginTop:18, position:"relative", zIndex:2 }}>
        {deck.map((c, i) => {
          const ok = found.has(c.id);
          const up = ok || open.includes(i);
          return (
            <button key={c.key} className="memoire-card" onClick={() => flip(i)} aria-label={up ? `${c.mat} ${c.name}` : "Carte cachée"}
              style={{ aspectRatio:"3 / 4", perspective:700, background:"none", border:"none", padding:0, cursor:"pointer", minHeight:56 }}>
              <div className={"memoire-inner" + (up ? " memoire-up" : "")} style={{ position:"relative", width:"100%", height:"100%",
                transformStyle:"preserve-3d", transition:"transform .55s cubic-bezier(.3,1.35,.5,1)", transform: up ? "rotateY(180deg)" : "none" }}>
                <div style={{ ...face, background:"linear-gradient(140deg, #0d9488, #115e59)", border:"2px solid rgba(255,255,255,.18)",
                  boxShadow:"0 6px 16px rgba(0,0,0,.35)", overflow:"hidden" }}>
                  <div aria-hidden="true" style={{ position:"absolute", inset:5, borderRadius:8, border:"1px dashed rgba(255,255,255,.3)",
                    background:"repeating-linear-gradient(45deg, rgba(255,255,255,.06) 0 6px, transparent 6px 12px)" }}/>
                  <span style={{ fontSize:"clamp(20px, 6vw, 30px)", fontWeight:900, color:"rgba(255,255,255,.85)", textShadow:"0 0 12px rgba(94,234,212,.8)" }}>?</span>
                </div>
                <div style={{ ...face, transform:"rotateY(180deg)", background:"linear-gradient(160deg, #ffffff, #e2e8f0)", color:"#0f172a",
                  boxShadow:"0 6px 16px rgba(0,0,0,.35)", animation: ok ? "memoire-found 1.6s ease-in-out infinite" : "none" }}>
                  <SpoolIcon color={c.color} style={{ width:"62%", height:"auto", filter:"drop-shadow(0 3px 4px rgba(0,0,0,.3))" }}/>
                  <span style={{ fontSize:"clamp(10px, 2.8vw, 13px)", fontWeight:900, marginTop:4 }}>{c.mat}</span>
                  <span style={{ fontSize:"clamp(9px, 2.4vw, 11px)", opacity:.65 }}>{c.name}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:12, alignItems:"center", marginTop:16, position:"relative", zIndex:2 }}>
        <span style={{ fontFamily:MONO, fontSize:13, opacity:.85 }}>{found.size}/8 paires · {moves} essais</span>
        <Btn color="#0f766e" onClick={reset} style={{ minHeight:42 }}>Recommencer</Btn>
      </div>
      <Hint>{all ? "Toutes les bobines sont rangées. L'AMS te remercie." : "Retourne deux cartes à la fois. Même matière, même couleur : elles restent."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 6. morpion : la buse contre la bobine                               */
/* ------------------------------------------------------------------ */

const LINES3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
function ttWinner(b) {
  for (const l of LINES3) {
    const [a, c, d] = l;
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { p: b[a], line: l };
  }
  return b.every(Boolean) ? { p: "nul" } : null;
}
function ttScore(b, turn, depth) {
  const w = ttWinner(b);
  if (w) return w.p === "O" ? 10 - depth : w.p === "X" ? depth - 10 : 0;
  let best = turn === "O" ? -99 : 99;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = turn;
    const s = ttScore(b, turn === "O" ? "X" : "O", depth + 1);
    b[i] = null;
    best = turn === "O" ? Math.max(best, s) : Math.min(best, s);
  }
  return best;
}
function ttBest(b) {
  let best = -99, moves = [];
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    const c = b.slice();
    c[i] = "O";
    const s = ttScore(c, "X", 1);
    if (s > best) { best = s; moves = [i]; } else if (s === best) moves.push(i);
  }
  return pick(moves);
}
const MORPION_CSS = `
@keyframes morpion-draw { from { stroke-dashoffset:var(--len) } to { stroke-dashoffset:0 } }
@keyframes morpion-pop { from { transform:scale(.3); opacity:0 } to { transform:scale(1); opacity:1 } }
.morpion-cell:hover { background:rgba(255,255,255,.07) !important }
`;

function Morpion() {
  const [won, win] = useWin("morpion");
  const [board, setBoard] = useState(Array(9).fill(null));
  const [result, setResult] = useState(null);
  const [aiTurn, setAiTurn] = useState(false);
  const [aiFirst, setAiFirst] = useState(false);
  const [score, setScore] = useState({ nul: 0, perdu: 0, gagne: 0 });
  const { later, clearAll } = useTimers();

  const finish = useCallback(w => {
    setResult(w);
    setAiTurn(false);
    if (w.p === "O") { setScore(s => ({ ...s, perdu: s.perdu + 1 })); beep(160, 0.5, "sawtooth", 0.08); }
    else {
      setScore(s => (w.p === "X" ? { ...s, gagne: s.gagne + 1 } : { ...s, nul: s.nul + 1 }));
      beep(660, 0.15); later(() => beep(990, 0.3), 140);
      win();
    }
  }, [later, win]);

  const aiPlay = useCallback(b => {
    setAiTurn(true);
    later(() => {
      const nb = b.slice();
      nb[ttBest(nb)] = "O";
      setBoard(nb);
      beep(330, 0.08, "triangle", 0.08);
      const w = ttWinner(nb);
      if (w) finish(w); else setAiTurn(false);
    }, 520);
  }, [later, finish]);

  const play = i => {
    if (board[i] || result || aiTurn) return;
    const nb = board.slice();
    nb[i] = "X";
    setBoard(nb);
    beep(520, 0.08, "triangle", 0.08);
    const w = ttWinner(nb);
    if (w) finish(w); else aiPlay(nb);
  };

  const reset = () => {
    clearAll();
    const first = !aiFirst;
    setAiFirst(first);
    const b = Array(9).fill(null);
    setBoard(b);
    setResult(null);
    setAiTurn(false);
    if (first) aiPlay(b);
  };

  useKeyDown(e => {
    if (/^[1-9]$/.test(e.key)) play(Number(e.key) - 1);
  });

  const ctr = i => [50 + (i % 3) * 100, 50 + Math.floor(i / 3) * 100];
  const line = result && result.line ? [ctr(result.line[0]), ctr(result.line[2])] : null;
  const msg = result ? (result.p === "O" ? "La bobine l'emporte… elle ne pardonne rien." : result.p === "X" ? "Impossible… tu as battu la machine !" : "Match nul ! Personne ne casse la bobine.")
    : aiTurn ? "La bobine réfléchit…" : "À toi de jouer, buse.";

  return (
    <Stage won={won} wonText="Égalité arrachée !" font={FONT}
      bg="radial-gradient(ellipse at 50% 0%, #3b0764 0%, #1e1b4b 50%, #0b0a1f 100%)">
      <style>{MORPION_CSS}</style>
      <Title sub="La bobine n'a jamais perdu une partie. Tiens-lui tête.">Morpion</Title>
      <div style={{ position:"relative", width:"min(86vw, 330px)", aspectRatio:"1", marginTop:18, zIndex:2, borderRadius:18,
        background:"linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.02))", boxShadow:"0 24px 60px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.12)",
        display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gridTemplateRows:"repeat(3, 1fr)" }}>
        {board.map((v, i) => (
          <button key={i} className="morpion-cell" onClick={() => play(i)} aria-label={`Case ${i + 1}${v ? (v === "X" ? " : buse" : " : bobine") : ""}`}
            style={{ background:"transparent", border:"none", cursor: v || result ? "default" : "pointer", padding:"14%",
              borderRight: i % 3 < 2 ? "3px solid rgba(196,181,253,.35)" : "none", borderBottom: i < 6 ? "3px solid rgba(196,181,253,.35)" : "none",
              transition:"background .2s" }}>
            {v === "X" && (
              <svg viewBox="0 0 100 100" style={{ width:"100%", height:"100%", overflow:"visible" }}>
                <path d="M18 18 L82 82 M82 18 L18 82" stroke="#fb923c" strokeWidth="13" strokeLinecap="round" fill="none"
                  style={{ "--len":"182", strokeDasharray:182, animation:"morpion-draw .35s ease-out both", filter:"drop-shadow(0 0 6px rgba(251,146,60,.8))" }}/>
              </svg>
            )}
            {v === "O" && (
              <svg viewBox="0 0 100 100" style={{ width:"100%", height:"100%", overflow:"visible", animation:"morpion-pop .35s cubic-bezier(.2,1.5,.4,1) both" }}>
                <circle cx="50" cy="50" r="38" fill="none" stroke="#22d3ee" strokeWidth="12" style={{ filter:"drop-shadow(0 0 6px rgba(34,211,238,.8))" }}/>
                <circle cx="50" cy="50" r="30" fill="none" stroke="#0e7490" strokeWidth="3" strokeDasharray="3 4"/>
                <circle cx="50" cy="50" r="12" fill="#0e7490"/>
                <circle cx="50" cy="50" r="5" fill="#0b0a1f"/>
              </svg>
            )}
          </button>
        ))}
        {line && (
          <svg viewBox="0 0 300 300" style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}>
            <line x1={line[0][0]} y1={line[0][1]} x2={line[1][0]} y2={line[1][1]} stroke="#fde047" strokeWidth="8" strokeLinecap="round"
              style={{ "--len":"300", strokeDasharray:300, animation:"morpion-draw .5s ease-out both", filter:"drop-shadow(0 0 8px #fde047)" }}/>
          </svg>
        )}
      </div>
      <div style={{ marginTop:14, fontWeight:800, fontSize:15, minHeight:22, position:"relative", zIndex:2, textAlign:"center" }}>{msg}</div>
      <div style={{ display:"flex", gap:12, alignItems:"center", marginTop:10, position:"relative", zIndex:2, flexWrap:"wrap", justifyContent:"center" }}>
        <span style={{ fontFamily:MONO, fontSize:12.5, opacity:.8 }}>✕ buse · ◯ bobine — nuls {score.nul} · défaites {score.perdu}</span>
        {result && <Btn color="#7c3aed" onClick={reset} style={{ minHeight:42 }}>Rejouer</Btn>}
      </div>
      <Hint>Tu joues la buse ✕. Pavé 1 à 9 au clavier si tu préfères.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 7. simon : les couleurs de l'AMS                                    */
/* ------------------------------------------------------------------ */

const SIMON = [
  { c: "#ef4444", f: 329.63, r: "100% 0 0 0", top: 0, left: 0 },
  { c: "#22c55e", f: 261.63, r: "0 100% 0 0", top: 0, left: "52%" },
  { c: "#eab308", f: 220.0, r: "0 0 0 100%", top: "52%", left: 0 },
  { c: "#3b82f6", f: 164.81, r: "0 0 100% 0", top: "52%", left: "52%" },
];
const SIMON_GOAL = 6;

function Simon() {
  const [won, win] = useWin("simon");
  const [seq, setSeq] = useState([]);
  const [phase, setPhase] = useState("idle");
  const [lit, setLit] = useState(-1);
  const [step, setStep] = useState(0);
  const { later, clearAll } = useTimers();

  const playSeq = useCallback(s => {
    setPhase("show");
    setStep(0);
    s.forEach((k, i) => {
      later(() => { setLit(k); beep(SIMON[k].f, 0.4, "triangle", 0.22); }, 650 + i * 620);
      later(() => setLit(-1), 650 + i * 620 + 420);
    });
    later(() => setPhase("input"), 650 + s.length * 620);
  }, [later]);

  const start = () => {
    clearAll();
    setLit(-1);
    const s = [Math.floor(Math.random() * 4)];
    setSeq(s);
    playSeq(s);
  };

  const press = k => {
    if (phase !== "input") return;
    setLit(k);
    later(() => setLit(-1), 220);
    if (seq[step] !== k) { beep(110, 0.6, "sawtooth", 0.12); setPhase("fail"); return; }
    beep(SIMON[k].f, 0.3, "triangle", 0.22);
    const ns = step + 1;
    if (ns < seq.length) { setStep(ns); return; }
    if (seq.length >= SIMON_GOAL) { setPhase("done"); win(); return; }
    const s2 = [...seq, Math.floor(Math.random() * 4)];
    setSeq(s2);
    setPhase("show");
    later(() => playSeq(s2), 450);
  };

  useKeyDown(e => {
    if (/^[1-4]$/.test(e.key)) press(Number(e.key) - 1);
  });

  const msg = { idle: "Appuie sur Démarrer", show: "Regarde bien…", input: `À toi ! (${step}/${seq.length})`,
    fail: "Raté ! La buse s'est trompée de bobine.", done: "Séquence parfaite !" }[phase];

  return (
    <Stage won={won} wonText="Mémoire de bobine !" font={FONT}
      bg="radial-gradient(ellipse at 50% 40%, #1f2937 0%, #0b0f17 70%)">
      <Title sub="L'AMS joue une suite de couleurs. Rejoue-la sans te tromper.">Simon</Title>
      <div style={{ position:"relative", width:"min(84vw, 340px)", aspectRatio:"1", marginTop:20, zIndex:2, borderRadius:"50%",
        background:"#0b0f17", boxShadow:"0 25px 60px rgba(0,0,0,.6), 0 0 0 10px #111827, 0 0 0 12px #374151" }}>
        {SIMON.map((s, i) => (
          <button key={i} onPointerDown={e => { e.preventDefault(); press(i); }} aria-label={`Touche ${i + 1}`}
            style={{ position:"absolute", top:s.top, left:s.left, width:"48%", height:"48%", borderRadius:s.r, border:"none",
              cursor: phase === "input" ? "pointer" : "default", background:`radial-gradient(circle at ${i % 2 ? "25%" : "75%"} ${i < 2 ? "75%" : "25%"}, ${s.c}, ${s.c}aa 60%, ${s.c}66)`,
              filter: lit === i ? "brightness(1.45) saturate(1.2)" : "brightness(.5) saturate(.8)",
              boxShadow: lit === i ? `0 0 40px ${s.c}, inset 0 0 30px rgba(255,255,255,.5)` : "inset 0 -6px 14px rgba(0,0,0,.45)",
              transition:"filter .12s, box-shadow .12s", touchAction:"manipulation" }}/>
        ))}
        <div style={{ position:"absolute", top:"30%", left:"30%", width:"40%", height:"40%", borderRadius:"50%",
          background:"radial-gradient(circle at 40% 35%, #374151, #0b0f17)", border:"6px solid #0b0f17", display:"flex",
          flexDirection:"column", alignItems:"center", justifyContent:"center", boxShadow:"0 0 0 2px #4b5563" }}>
          <span style={{ fontSize:12, letterSpacing:".3em", opacity:.7, fontWeight:800 }}>AMS</span>
          <span style={{ fontFamily:MONO, fontSize:26, fontWeight:800, color:"#e5e7eb" }}>{seq.length || "–"}</span>
        </div>
      </div>
      <div style={{ display:"flex", gap:7, marginTop:16, position:"relative", zIndex:2 }}>
        {Array.from({ length: SIMON_GOAL }, (_, i) => {
          const on = i < (phase === "done" ? SIMON_GOAL : Math.max(0, seq.length - 1));
          return <span key={i} style={{ width:12, height:12, borderRadius:"50%", background: on ? "#4ade80" : "rgba(255,255,255,.15)",
            boxShadow: on ? "0 0 8px #4ade80" : "none", transition:"all .3s" }}/>;
        })}
      </div>
      <div style={{ marginTop:10, fontWeight:800, minHeight:22, position:"relative", zIndex:2 }}>{msg}</div>
      {(phase === "idle" || phase === "fail" || phase === "done") && (
        <Btn color="#16a34a" onClick={start} style={{ marginTop:10, minHeight:44, position:"relative", zIndex:2 }}>
          {phase === "idle" ? "Démarrer" : "Recommencer"}
        </Btn>
      )}
      <Hint>Monte le son. Six couleurs d'affilée suffisent. Touches 1 à 4 au clavier.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 8. pendu : l'impression qui part en spaghetti                       */
/* ------------------------------------------------------------------ */

const PENDU_WORDS = ["BUSE", "BOBINE", "PLATEAU", "FILAMENT", "EXTRUDEUR", "SUPPORT", "REMPLISSAGE", "BENCHY", "COUCHE",
  "TRANCHEUR", "RETRACTION", "PURGE", "ADHERENCE", "CALIBRATION", "VENTILATEUR", "RADEAU", "BORDURE", "IMPRIMANTE", "GYROIDE", "TOLERANCE"];
const PENDU_MAX = 7;
const PENDU_CSS = `
@keyframes pendu-draw { from { stroke-dashoffset:600 } to { stroke-dashoffset:0 } }
@keyframes pendu-in { from { opacity:0; transform:translateY(-6px) } to { opacity:1; transform:none } }
@keyframes pendu-wobble { 0%,100% { transform:rotate(0) } 50% { transform:rotate(3deg) } }
`;

function Pendu() {
  const [won, win] = useWin("pendu");
  const [word, setWord] = useState(() => pick(PENDU_WORDS));
  const [guessed, setGuessed] = useState(() => new Set());
  const letters = word.split("");
  const errors = [...guessed].filter(l => !word.includes(l)).length;
  const found = letters.every(l => guessed.has(l));
  const lost = errors >= PENDU_MAX;

  const guess = l => {
    if (found || lost || guessed.has(l)) return;
    const ng = new Set(guessed);
    ng.add(l);
    setGuessed(ng);
    if (word.includes(l)) {
      beep(700, 0.08, "triangle", 0.08);
      if (letters.every(ch => ng.has(ch))) win();
    } else beep(180, 0.2, "sawtooth", 0.06);
  };
  const reset = () => { setWord(w => { let n = pick(PENDU_WORDS); while (n === w) n = pick(PENDU_WORDS); return n; }); setGuessed(new Set()); };

  useKeyDown(e => {
    const k = (e.key || "").toUpperCase();
    if (/^[A-Z]$/.test(k)) guess(k);
  });

  const part = errors >= 4 ? "rotate(20 135 170) translate(10 2)" : undefined;
  const fil = "#f97316";

  return (
    <Stage won={won} wonText="Mot trouvé !" font={FONT}
      bg="linear-gradient(180deg, #1c1917 0%, #292524 55%, #0c0a09 100%)">
      <style>{PENDU_CSS}</style>
      <Title sub="Chaque erreur fait déraper l'impression. Trouve le mot avant le plat de spaghetti.">Le pendu</Title>
      <svg viewBox="0 0 220 196" style={{ width:"min(70vw, 260px)", height:"auto", marginTop:12, position:"relative", zIndex:2 }}>
        <defs>
          <linearGradient id="pendu-frame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#57534e"/><stop offset="1" stopColor="#292524"/></linearGradient>
        </defs>
        <rect x="14" y="14" width="192" height="176" rx="12" fill="url(#pendu-frame)" stroke="#78716c"/>
        <rect x="24" y="24" width="172" height="156" rx="6" fill="#0c0a09" opacity=".75"/>
        <rect x="30" y="34" width="160" height="5" rx="2" fill="#a8a29e"/>
        <g transform="translate(110 40)" style={{ animation: lost ? "pendu-wobble .4s ease-in-out infinite" : "none" }}>
          <rect x="-14" y="-4" width="28" height="20" rx="4" fill="#e7e5e4"/>
          <path d="M-4 16 L4 16 L2 22 L-2 22 Z" fill="#d97706"/>
        </g>
        {errors >= 1 && <g style={{ animation:"pendu-in .3s ease both" }}>
          <rect x="40" y="170" width="140" height="7" rx="2" fill="#ca8a04"/>
          <rect x="44" y="177" width="132" height="4" fill="#1c1917"/>
        </g>}
        <g transform={part} style={{ transition:"transform .5s" }}>
          {errors >= 2 && <rect x="88" y="165" width="46" height="5" rx="1" fill={fil} style={{ animation:"pendu-in .3s ease both" }}/>}
          {errors >= 3 && <g style={{ animation:"pendu-in .3s ease both" }}>
            <rect x="88" y="132" width="46" height="34" rx="2" fill={fil}/>
            {[138, 144, 150, 156, 162].map(y => <line key={y} x1="88" y1={y} x2="134" y2={y} stroke="#000" strokeOpacity=".18"/>)}
          </g>}
        </g>
        {errors >= 5 && <path d="M110 62 C 80 76, 142 86, 100 100 S 70 124, 118 122 S 152 104, 126 140" stroke={fil} strokeWidth="2.4" fill="none"
          strokeLinecap="round" style={{ strokeDasharray:600, animation:"pendu-draw 1s ease-out both" }}/>}
        {errors >= 6 && <path d="M110 62 C 156 66, 56 92, 146 108 S 56 142, 86 152 S 176 156, 152 124 S 84 86, 124 76 S 60 120, 72 160"
          stroke={fil} strokeWidth="2.4" fill="none" strokeLinecap="round" style={{ strokeDasharray:600, animation:"pendu-draw 1.2s ease-out both" }}/>}
        {errors >= 7 && <g style={{ animation:"pendu-in .4s ease both" }}>
          <path d="M92 50 Q90 34 110 36 Q132 34 128 52 Q132 66 114 68 Q96 72 92 50 Z" fill={fil} stroke="#9a3412"/>
          <path d="M100 66 Q99 76 102 80 M118 66 Q120 78 116 84" stroke={fil} strokeWidth="3" strokeLinecap="round" fill="none"/>
          <text x="110" y="58" textAnchor="middle" fontSize="14">💀</text>
        </g>}
      </svg>
      <div style={{ display:"flex", gap:"clamp(4px, 1.6vw, 8px)", marginTop:14, flexWrap:"wrap", justifyContent:"center", position:"relative", zIndex:2 }}>
        {letters.map((l, i) => {
          const show = guessed.has(l) || lost;
          return (
            <span key={i} style={{ width:"clamp(20px, 6.4vw, 30px)", textAlign:"center", fontSize:"clamp(18px, 5.4vw, 26px)", fontWeight:900,
              fontFamily:MONO, borderBottom:"3px solid rgba(255,255,255,.5)", paddingBottom:2,
              color: guessed.has(l) ? (found ? "#4ade80" : "#fafaf9") : "#f87171" }}>{show ? l : " "}</span>
          );
        })}
      </div>
      <div style={{ marginTop:8, fontSize:13, opacity:.8, position:"relative", zIndex:2 }}>
        {found ? "Bravo, l'impression est sauvée !" : lost ? "Plat de spaghetti… c'était perdu." : `Erreurs : ${errors}/${PENDU_MAX}`}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7, minmax(40px, 1fr))", gap:5, marginTop:12, width:"min(94vw, 400px)",
        position:"relative", zIndex:2 }}>
        {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(l => {
          const used = guessed.has(l);
          const good = used && word.includes(l);
          return (
            <button key={l} onClick={() => guess(l)} disabled={used || found || lost}
              style={{ height:42, borderRadius:9, border:"1px solid rgba(255,255,255,.14)", fontWeight:800, fontSize:16, fontFamily:FONT,
                cursor: used ? "default" : "pointer", color: used ? (good ? "#052e16" : "rgba(255,255,255,.35)") : "#fafaf9",
                background: used ? (good ? "#4ade80" : "#3f1d1d") : "linear-gradient(#57534e, #3a3532)",
                boxShadow: used ? "none" : "0 3px 0 #1c1917" }}>{l}</button>
          );
        })}
      </div>
      {(found || lost) && <Btn color="#ea580c" onClick={reset} style={{ marginTop:12, minHeight:44, position:"relative", zIndex:2 }}>Nouveau mot</Btn>}
      <Hint>Un mot de l'impression 3D, sans accent. Clavier physique accepté.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 9. calcul : la buse chauffe, compte vite                            */
/* ------------------------------------------------------------------ */

const CALC_N = 10;
const CALC_T = 30;
const CALC_CSS = `
@keyframes calcul-ok { 0% { box-shadow:0 0 0 0 rgba(74,222,128,.9) } 100% { box-shadow:0 0 0 18px rgba(74,222,128,0) } }
@keyframes calcul-ko { 0%,100% { transform:translateX(0) } 25% { transform:translateX(-7px) } 75% { transform:translateX(7px) } }
.calcul-key:active { transform:translateY(2px); box-shadow:0 1px 0 #0f172a !important }
`;
function makeOp() {
  const t = pick(["+", "+", "−", "×", "×"]);
  let a, b, r;
  if (t === "+") { a = 2 + Math.floor(Math.random() * 38); b = 2 + Math.floor(Math.random() * 28); r = a + b; }
  else if (t === "−") { a = 12 + Math.floor(Math.random() * 50); b = 2 + Math.floor(Math.random() * (a - 4)); r = a - b; }
  else { a = 2 + Math.floor(Math.random() * 8); b = 2 + Math.floor(Math.random() * 8); r = a * b; }
  return { a, b, t, r };
}

function Calcul() {
  const [won, win] = useWin("calcul");
  const [phase, setPhase] = useState("idle");
  const [ops, setOps] = useState(() => Array.from({ length: CALC_N }, makeOp));
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [left, setLeft] = useState(CALC_T);
  const [flash, setFlash] = useState(null);
  const { later } = useTimers();

  useLoop(dt => setLeft(l => Math.max(0, l - dt)), phase === "run");
  useEffect(() => { if (phase === "run" && left <= 0) { setPhase("over"); beep(150, 0.6, "sawtooth", 0.1); } }, [left, phase]);

  const start = () => {
    setOps(Array.from({ length: CALC_N }, makeOp));
    setIdx(0); setInput(""); setLeft(CALC_T); setFlash(null); setPhase("run");
  };
  const type = d => {
    if (phase !== "run") return;
    if (d === "<") { setInput(v => v.slice(0, -1)); return; }
    if (d === "C") { setInput(""); return; }
    const v = input + d;
    const target = String(ops[idx].r);
    if (v === target) {
      beep(880, 0.08, "triangle", 0.1);
      setFlash("ok"); later(() => setFlash(null), 300);
      setInput("");
      if (idx + 1 >= CALC_N) { setIdx(CALC_N); setPhase("done"); win(); }
      else setIdx(idx + 1);
    } else if (v.length >= target.length) {
      beep(200, 0.15, "square", 0.06);
      setFlash("ko"); later(() => setFlash(null), 350);
      setInput("");
    } else setInput(v);
  };

  useKeyDown(e => {
    if (/^[0-9]$/.test(e.key)) type(e.key);
    else if (e.key === "Backspace") type("<");
    else if (e.key === "Enter" && phase !== "run") start();
  });

  const frac = left / CALC_T;
  const temp = Math.round(25 + (1 - frac) * 195);
  const R = 52, L = 2 * Math.PI * R;
  const ring = frac > 0.5 ? "#22c55e" : frac > 0.2 ? "#f59e0b" : "#ef4444";
  const op = ops[Math.min(idx, CALC_N - 1)];

  return (
    <Stage won={won} wonText="Cerveau en surchauffe… réussie !" font={FONT}
      bg="radial-gradient(ellipse at 50% 0%, #1e3a8a 0%, #0f172a 55%, #020617 100%)">
      <style>{CALC_CSS}</style>
      <Title sub={`${CALC_N} calculs justes en ${CALC_T} secondes, avant que la buse ne soit à température.`}>Calcul mental</Title>
      <div style={{ display:"flex", alignItems:"center", gap:18, marginTop:16, position:"relative", zIndex:2 }}>
        <svg viewBox="0 0 130 130" style={{ width:112, height:112 }}>
          <circle cx="65" cy="65" r={R} fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.1)" strokeWidth="10"/>
          <circle cx="65" cy="65" r={R} fill="none" stroke={ring} strokeWidth="10" strokeLinecap="round" strokeDasharray={L}
            strokeDashoffset={L * (1 - frac)} transform="rotate(-90 65 65)" style={{ filter:`drop-shadow(0 0 6px ${ring})` }}/>
          <text x="65" y="64" textAnchor="middle" fontSize="28" fontWeight="800" fill="#fff" fontFamily={MONO}>{Math.ceil(left)}</text>
          <text x="65" y="84" textAnchor="middle" fontSize="11" fill="#fca5a5" fontFamily={MONO}>{temp} °C</text>
        </svg>
        <div style={{ textAlign:"left" }}>
          <div style={{ fontSize:13, opacity:.7 }}>Justes</div>
          <div style={{ fontFamily:MONO, fontSize:30, fontWeight:800 }}>{Math.min(idx, CALC_N)}<span style={{ opacity:.45, fontSize:18 }}>/{CALC_N}</span></div>
        </div>
      </div>
      <div style={{ marginTop:14, padding:"14px 22px", borderRadius:16, minWidth:"min(86vw, 300px)", textAlign:"center", position:"relative", zIndex:2,
        background:"rgba(15,23,42,.8)", border:"1px solid rgba(148,163,184,.25)",
        animation: flash === "ok" ? "calcul-ok .35s ease-out" : flash === "ko" ? "calcul-ko .3s ease" : "none" }}>
        {phase === "idle" && <div style={{ fontSize:18, fontWeight:700 }}>Prêt ? La buse attend.</div>}
        {phase === "run" && (
          <div style={{ fontFamily:MONO, fontSize:"clamp(26px, 8vw, 36px)", fontWeight:800 }}>
            {op.a} {op.t} {op.b} = <span style={{ color:"#fde047", borderBottom:"3px solid #fde047", minWidth:50, display:"inline-block" }}>{input || " "}</span>
          </div>
        )}
        {phase === "over" && <div style={{ fontSize:17, fontWeight:700, color:"#fca5a5" }}>Trop tard, la buse a fondu la pièce ! ({idx}/{CALC_N})</div>}
        {phase === "done" && <div style={{ fontSize:17, fontWeight:700, color:"#86efac" }}>Dix sur dix, avec {Math.ceil(left)} s d'avance !</div>}
      </div>
      {phase === "run" ? (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 68px)", gap:8, marginTop:14, position:"relative", zIndex:2 }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "<"].map(k => (
            <button key={k} className="calcul-key" onClick={() => type(k)} aria-label={k === "<" ? "Effacer un chiffre" : k === "C" ? "Tout effacer" : k}
              style={{ height:50, borderRadius:12, border:"1px solid rgba(148,163,184,.25)", color:"#e2e8f0", fontSize:20, fontWeight:800,
                fontFamily:MONO, cursor:"pointer", background:"linear-gradient(#334155, #1e293b)", boxShadow:"0 3px 0 #0f172a" }}>
              {k === "<" ? "⌫" : k}
            </button>
          ))}
        </div>
      ) : (
        <Btn color="#2563eb" onClick={start} style={{ marginTop:16, minHeight:46, position:"relative", zIndex:2 }}>
          {phase === "idle" ? "Chauffer la buse" : "Recommencer"}
        </Btn>
      )}
      <Hint>La réponse est validée dès qu'elle est complète. Clavier accepté.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 10. piano : Au clair de la lune                                     */
/* ------------------------------------------------------------------ */

const PIANO_WHITE = [
  { id: "do", f: 261.63, code: "KeyA", label: "do" }, { id: "re", f: 293.66, code: "KeyS", label: "ré" },
  { id: "mi", f: 329.63, code: "KeyD", label: "mi" }, { id: "fa", f: 349.23, code: "KeyF", label: "fa" },
  { id: "sol", f: 392.0, code: "KeyG", label: "sol" }, { id: "la", f: 440.0, code: "KeyH", label: "la" },
  { id: "si", f: 493.88, code: "KeyJ", label: "si" }, { id: "do2", f: 523.25, code: "KeyK", label: "do" },
];
const PIANO_BLACK = [
  { id: "do#", f: 277.18, code: "KeyW", after: 0 }, { id: "re#", f: 311.13, code: "KeyE", after: 1 },
  { id: "fa#", f: 369.99, code: "KeyT", after: 3 }, { id: "sol#", f: 415.3, code: "KeyY", after: 4 },
  { id: "la#", f: 466.16, code: "KeyU", after: 5 },
];
const PIANO_TUNE = ["do", "do", "do", "re", "mi", "re", "do", "mi", "re", "re", "do"];
const PIANO_STEP = { do: 0, re: 1, mi: 2 };
const PIANO_NAME = { do: "do", re: "ré", mi: "mi" };
const PIANO_CSS = `
@keyframes piano-note { from { transform:translateY(0); opacity:1 } to { transform:translateY(-60px); opacity:0 } }
@keyframes piano-err { 0%,100% { transform:translateX(0) } 30% { transform:translateX(-6px) } 70% { transform:translateX(6px) } }
`;

function playNote(f) {
  beep(f, 0.9, "triangle", 0.2);
  beep(f * 2, 0.5, "sine", 0.04);
}

function Piano() {
  const [won, win] = useWin("piano");
  const [prog, setProg] = useState(0);
  const [down, setDown] = useState(null);
  const [err, setErr] = useState(0);
  const [floats, setFloats] = useState([]);
  const { later } = useTimers();
  const progRef = useRef(0);
  const done = prog >= PIANO_TUNE.length;

  const play = useCallback((key, f) => {
    playNote(f);
    setDown(key);
    later(() => setDown(d => (d === key ? null : d)), 200);
    const id = Math.random();
    setFloats(fl => [...fl.slice(-6), { id, key }]);
    later(() => setFloats(fl => fl.filter(x => x.id !== id)), 900);
    const p = progRef.current;
    if (p >= PIANO_TUNE.length) return;
    if (key === PIANO_TUNE[p]) {
      progRef.current = p + 1;
      setProg(p + 1);
      if (p + 1 === PIANO_TUNE.length) win();
    } else {
      const n = key === PIANO_TUNE[0] ? 1 : 0;
      progRef.current = n;
      setProg(n);
      setErr(e => e + 1);
    }
  }, [later, win]);

  useKeyDown(e => {
    if (e.repeat) return;
    const k = PIANO_WHITE.find(w => w.code === e.code) || PIANO_BLACK.find(b => b.code === e.code);
    if (k) play(k.id, k.f);
  });

  const lineY = [30, 38, 46, 54, 62];
  return (
    <Stage won={won} wonText="Bravo, Pierrot !" font={FONT}
      bg="radial-gradient(ellipse at 50% 0%, #4c1d95 0%, #1e1b4b 45%, #0b0a1a 100%)">
      <style>{PIANO_CSS}</style>
      <div aria-hidden="true" style={{ position:"absolute", top:24, right:"8%", width:90, height:90, borderRadius:"50%",
        background:"radial-gradient(circle at 35% 35%, #fefce8, #fde68a 60%, #ca8a04)", boxShadow:"0 0 60px rgba(253,230,138,.5)", opacity:.85 }}/>
      <Title sub="Le chef d'atelier ne s'endort qu'avec cette berceuse. Joue-la sans fausse note.">Le piano</Title>
      <div style={{ marginTop:16, padding:"8px 10px 4px", borderRadius:12, background:"#fdfaf2", color:"#1c1917", position:"relative", zIndex:2,
        width:"min(94vw, 480px)", boxShadow:"0 14px 34px rgba(0,0,0,.45)", animation: err ? "piano-err .3s ease" : "none" }} key={err}>
        <div style={{ fontSize:12.5, fontStyle:"italic", textAlign:"center", fontFamily:"Georgia, serif" }}>Au clair de la lune</div>
        <svg viewBox="0 0 360 86" style={{ width:"100%", height:"auto", display:"block" }}>
          {lineY.map(y => <line key={y} x1="6" y1={y} x2="354" y2={y} stroke="#44403c" strokeWidth=".8"/>)}
          <text x="8" y="66" fontSize="46" fill="#292524" fontFamily="serif">𝄞</text>
          {PIANO_TUNE.map((n, i) => {
            const x = 64 + i * 26.5;
            const y = 70 - PIANO_STEP[n] * 4;
            const c = i < prog ? "#16a34a" : i === prog ? "#d97706" : "#292524";
            return (
              <g key={i}>
                {n === "do" && <line x1={x - 9} y1="70" x2={x + 9} y2="70" stroke="#44403c" strokeWidth=".8"/>}
                {i === prog && <circle cx={x} cy={y} r="10" fill="#fbbf24" opacity=".35"/>}
                <ellipse cx={x} cy={y} rx="5.6" ry="4" fill={c} transform={`rotate(-20 ${x} ${y})`}/>
                <line x1={x + 5.2} y1={y - 1} x2={x + 5.2} y2={y - 26} stroke={c} strokeWidth="1.2"/>
                <text x={x} y="84" textAnchor="middle" fontSize="7.5" fill={c} fontFamily={FONT}>{PIANO_NAME[n]}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ position:"relative", width:"min(94vw, 480px)", height:"clamp(150px, 42vw, 200px)", marginTop:18, zIndex:2,
        borderRadius:"0 0 12px 12px", padding:"10px 8px 8px", background:"linear-gradient(#1c1917, #0c0a09)", boxShadow:"0 20px 50px rgba(0,0,0,.6)" }}>
        <div style={{ position:"absolute", inset:"0 0 auto 0", height:10, background:"linear-gradient(90deg, #7f1d1d, #b91c1c, #7f1d1d)" }}/>
        <div style={{ position:"relative", display:"flex", height:"100%", gap:3, touchAction:"none" }}>
          {PIANO_WHITE.map(w => (
            <button key={w.id} onPointerDown={e => { e.preventDefault(); play(w.id, w.f); }} aria-label={w.label}
              style={{ flex:1, border:"none", borderRadius:"0 0 8px 8px", cursor:"pointer", display:"flex", alignItems:"flex-end",
                justifyContent:"center", paddingBottom:8, fontSize:12, fontWeight:700, color:"#78716c", fontFamily:FONT,
                background: down === w.id ? "linear-gradient(#e7e5e4, #fde68a)" : "linear-gradient(#fafaf9 80%, #e7e5e4)",
                boxShadow: down === w.id ? "inset 0 4px 8px rgba(0,0,0,.25)" : "inset 0 -6px 0 #d6d3d1, 0 2px 4px rgba(0,0,0,.4)",
                transform: down === w.id ? "translateY(2px)" : "none", transition:"transform .06s" }}>{w.label}</button>
          ))}
          {PIANO_BLACK.map(b => (
            <button key={b.id} onPointerDown={e => { e.preventDefault(); play(b.id, b.f); }} aria-label={b.id}
              style={{ position:"absolute", top:0, left:`calc(${(b.after + 1) * 12.5}% - 3.8%)`, width:"7.6%", height:"60%", border:"none",
                borderRadius:"0 0 6px 6px", cursor:"pointer", zIndex:3,
                background: down === b.id ? "linear-gradient(#44403c, #57534e)" : "linear-gradient(#292524, #0c0a09 85%, #44403c)",
                boxShadow:"0 4px 6px rgba(0,0,0,.6), inset 0 -4px 0 #000" }}/>
          ))}
        </div>
        {floats.map((f, i) => (
          <span key={f.id} aria-hidden="true" style={{ position:"absolute", top:-10, left:`${10 + ((f.id * 1000) % 80)}%`, fontSize:22,
            color:"#fde68a", pointerEvents:"none", animation:"piano-note .9s ease-out forwards" }}>{i % 2 ? "♪" : "♫"}</span>
        ))}
      </div>
      <div style={{ marginTop:12, fontFamily:MONO, fontSize:13, opacity:.85, position:"relative", zIndex:2 }}>
        {done ? "Le chef d'atelier dort comme un bébé. 😴" : `Notes justes : ${prog}/${PIANO_TUNE.length}`}
      </div>
      <Hint>Une fausse note et tout est à reprendre. Au clavier : rangée du milieu pour les touches blanches.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 11. etoiles : la constellation du Benchy                            */
/* ------------------------------------------------------------------ */

const STARS = [[40, 150], [82, 236], [292, 236], [356, 150], [252, 170], [246, 100], [170, 94], [164, 170], [100, 170]];
const ETOILES_CSS = `
@keyframes etoiles-tw { 0%,100% { opacity:.25 } 50% { opacity:1 } }
@keyframes etoiles-draw { from { stroke-dashoffset:var(--len) } to { stroke-dashoffset:0 } }
@keyframes etoiles-pulse { 0%,100% { transform:scale(1) } 50% { transform:scale(1.25) } }
@keyframes etoiles-shoot { 0% { transform:translate(0,0); opacity:0 } 5% { opacity:1 } 20% { transform:translate(-260px,140px); opacity:0 } 100% { opacity:0; transform:translate(-260px,140px) } }
@keyframes etoiles-bad { 0%,100% { fill:#fff } 50% { fill:#f87171 } }
`;

function Etoiles() {
  const [won, win] = useWin("etoiles");
  const [next, setNext] = useState(0);
  const [bad, setBad] = useState(-1);
  const [ptr, setPtr] = useState(null);
  const { later } = useTimers();
  const done = next >= STARS.length;
  const dust = useMemo(() => Array.from({ length: 80 }, () => ({
    x: rand(0, 400), y: rand(0, 300), r: rand(0.4, 1.4), d: rand(1.5, 4.5), dl: -rand(0, 4),
  })), []);

  const tap = i => {
    if (done) return;
    if (i === next) {
      beep(392 * Math.pow(2, i / 7), 0.35, "sine", 0.12);
      setNext(next + 1);
      if (next + 1 === STARS.length) { later(() => beep(784, 0.8, "sine", 0.12), 200); win(); }
    } else if (i > next) {
      setBad(i);
      later(() => setBad(-1), 450);
    }
  };
  const move = e => {
    const r = e.currentTarget.getBoundingClientRect();
    setPtr([((e.clientX - r.left) / r.width) * 400, ((e.clientY - r.top) / r.height) * 300]);
  };
  const seg = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

  return (
    <Stage won={won} wonText="Constellation complète !" font={FONT}
      bg="radial-gradient(ellipse at 50% 110%, #1e3a8a 0%, #0b1033 45%, #020314 100%)">
      <style>{ETOILES_CSS}</style>
      <Title sub="Les anciens imprimeurs voyaient une forme dans ces étoiles. Relie-les dans l'ordre.">Le ciel</Title>
      <svg viewBox="0 0 400 300" onPointerMove={move} onPointerLeave={() => setPtr(null)}
        style={{ width:"min(96vw, 620px)", height:"auto", marginTop:10, position:"relative", zIndex:2, overflow:"visible", touchAction:"manipulation" }}>
        <defs>
          <radialGradient id="et-star"><stop offset="0" stopColor="#fff"/><stop offset=".3" stopColor="#dbeafe"/><stop offset="1" stopColor="#93c5fd" stopOpacity="0"/></radialGradient>
          <filter id="et-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        {dust.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#e0e7ff" style={{ animation:`etoiles-tw ${s.d}s ease-in-out ${s.dl}s infinite` }}/>
        ))}
        <line x1="380" y1="20" x2="400" y2="10" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" style={{ animation:"etoiles-shoot 7s ease-out 2s infinite", opacity:0 }}/>
        <g filter="url(#et-glow)">
          {STARS.slice(0, Math.max(0, next - 1)).map((s, i) => {
            const t = STARS[i + 1];
            const len = seg(s, t);
            return <line key={i} x1={s[0]} y1={s[1]} x2={t[0]} y2={t[1]} stroke={done ? "#fde68a" : "#93c5fd"} strokeWidth={done ? 2.6 : 1.8}
              strokeLinecap="round" style={{ "--len":len, strokeDasharray:len, animation:"etoiles-draw .45s ease-out both", transition:"stroke .8s" }}/>;
          })}
          {done && (() => {
            const a = STARS[STARS.length - 1], b = STARS[0], len = seg(a, b);
            return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#fde68a" strokeWidth="2.6" strokeLinecap="round"
              style={{ "--len":len, strokeDasharray:len, animation:"etoiles-draw .6s ease-out both" }}/>;
          })()}
          {!done && next > 0 && ptr && (
            <line x1={STARS[next - 1][0]} y1={STARS[next - 1][1]} x2={ptr[0]} y2={ptr[1]} stroke="#93c5fd" strokeOpacity=".35" strokeDasharray="3 4"/>
          )}
        </g>
        {done && <path d={`M${STARS.map(s => s.join(" ")).join(" L")} Z`} fill="#fde68a" fillOpacity=".12" style={{ animation:"hk-fade 1.2s ease both" }}/>}
        {STARS.map(([x, y], i) => {
          const lit = i < next;
          return (
            <g key={i} onPointerDown={e => { e.preventDefault(); tap(i); }} style={{ cursor: done ? "default" : "pointer" }}>
              <circle cx={x} cy={y} r="24" fill="transparent"/>
              <circle cx={x} cy={y} r={lit ? 14 : 10} fill="url(#et-star)" opacity={lit ? 1 : .7}/>
              <g style={{ transformBox:"fill-box", transformOrigin:"center", animation: done ? `etoiles-pulse 2s ease-in-out ${i * 0.15}s infinite` : "none" }}>
                <path d={`M${x} ${y - 6} L${x + 1.6} ${y - 1.6} L${x + 6} ${y} L${x + 1.6} ${y + 1.6} L${x} ${y + 6} L${x - 1.6} ${y + 1.6} L${x - 6} ${y} L${x - 1.6} ${y - 1.6} Z`}
                  fill={lit ? "#fde68a" : "#fff"} style={{ animation: bad === i ? "etoiles-bad .45s ease" : "none" }}/>
              </g>
              <text x={x + 9} y={y - 8} fontSize="8" fill="#c7d2fe" opacity={done ? 0 : .5} fontFamily={MONO}>{i + 1}</text>
            </g>
          );
        })}
        {done && <text x="200" y="285" textAnchor="middle" fontSize="13" fill="#fde68a" fontStyle="italic" style={{ animation:"hk-fade 1.5s ease .4s both" }}>
          — Benchy, la Barque Céleste —</text>}
      </svg>
      <div style={{ display:"flex", gap:12, alignItems:"center", marginTop:6, position:"relative", zIndex:2 }}>
        <span style={{ fontFamily:MONO, fontSize:13, opacity:.75 }}>{next}/{STARS.length} étoiles</span>
        {next > 0 && !done && <Btn color="#4338ca" onClick={() => setNext(0)} style={{ minHeight:42 }}>Recommencer</Btn>}
      </div>
      <Hint>Plisse les yeux : chaque étoile porte un tout petit numéro.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 12. chat : le chat sur l'imprimante chaude                          */
/* ------------------------------------------------------------------ */

const CHAT_HOLD = 4;
const CHAT_CSS = `
@keyframes chat-breathe { 0%,100% { transform:scaleY(1) } 50% { transform:scaleY(1.05) } }
@keyframes chat-purr { 0%,100% { transform:translate(0,0) } 25% { transform:translate(.6px,-.4px) } 75% { transform:translate(-.6px,.4px) } }
@keyframes chat-twitch { 0%,100% { transform:translate(0,0) rotate(0) } 20% { transform:translate(-6px,-3px) rotate(-3deg) } 50% { transform:translate(5px,-1px) rotate(2deg) } 80% { transform:translate(-2px,0) rotate(-1deg) } }
@keyframes chat-z { 0% { transform:translate(0,0) scale(.6); opacity:0 } 20% { opacity:.8 } 100% { transform:translate(26px,-50px) scale(1.2); opacity:0 } }
@keyframes chat-heart { 0% { transform:translateY(0) scale(.4); opacity:0 } 20% { opacity:1; transform:translateY(-10px) scale(1) } 100% { transform:translateY(-110px) scale(1.1); opacity:0 } }
@keyframes chat-heat { 0%,100% { transform:translateY(0) scaleX(1); opacity:.25 } 50% { transform:translateY(-8px) scaleX(1.15); opacity:.55 } }
@keyframes chat-tail { 0%,100% { transform:rotate(0) } 50% { transform:rotate(-8deg) } }
`;

function Chat() {
  const [won, win] = useWin("chat");
  const [gauge, setGauge] = useState(0);
  const [holding, setHolding] = useState(false);
  const [twitch, setTwitch] = useState(0);
  const [hearts, setHearts] = useState([]);
  const hold = useRef(false);
  const lastUp = useRef(0);
  const quick = useRef(0);
  const lastHeart = useRef(0);
  const doneRef = useRef(false);
  const burst = useRef(false);
  const { later } = useTimers();

  useLoop((dt, now) => {
    if (!doneRef.current) {
      setGauge(g => (hold.current ? Math.min(1, g + dt / CHAT_HOLD) : Math.max(0, g - dt * 0.12)));
    }
    if ((hold.current || burst.current) && now - lastHeart.current > (burst.current ? 180 : 320)) {
      lastHeart.current = now;
      setHearts(h => [...h.filter(x => now - x.born < 1700), { id: now, born: now, x: rand(28, 70), s: rand(16, 28) }]);
    } else {
      setHearts(h => (h.length && now - h[0].born > 1700 ? h.filter(x => now - x.born < 1700) : h));
    }
  });

  useEffect(() => {
    if (gauge >= 1 && !doneRef.current) {
      doneRef.current = true;
      burst.current = true;
      hold.current = false;
      setHolding(false);
      win();
      later(() => { burst.current = false; }, 3000);
    }
  }, [gauge, win, later]);

  const down = e => {
    if (won) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* sans capture */ }
    const now = performance.now();
    quick.current = now - lastUp.current < 450 ? quick.current + 1 : 0;
    if (quick.current >= 2) {
      quick.current = 0;
      setTwitch(t => t + 1);
      setGauge(g => Math.max(0, g - 0.3));
      beep(700, 0.12, "triangle", 0.05);
    }
    hold.current = true;
    setHolding(true);
  };
  const up = () => {
    if (!hold.current) return;
    hold.current = false;
    setHolding(false);
    lastUp.current = performance.now();
  };

  const happy = won;
  return (
    <Stage won={won} wonText="Rrrrrrrr… 💕" font={FONT}
      bg="radial-gradient(ellipse at 30% 20%, #78350f 0%, #451a03 40%, #1c0a02 100%)">
      <style>{CHAT_CSS}</style>
      <div aria-hidden="true" style={{ position:"absolute", top:30, left:"10%", width:120, height:160, borderRadius:8,
        background:"linear-gradient(180deg, rgba(254,243,199,.25), rgba(254,243,199,.05))", boxShadow:"0 0 80px rgba(253,230,138,.25)" }}/>
      <Title sub="Il a trouvé l'endroit le plus chaud de la maison. Ne le brusque pas." color="#fde68a">Le chat</Title>
      <div onPointerDown={down} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
        style={{ position:"relative", width:"min(92vw, 440px)", marginTop:12, zIndex:2, touchAction:"none", cursor: won ? "default" : "grab" }}>
        <svg viewBox="0 0 320 260" style={{ width:"100%", height:"auto", display:"block", overflow:"visible" }}>
          <defs>
            <linearGradient id="chat-fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fdba74"/><stop offset="1" stopColor="#c2410c"/></linearGradient>
            <radialGradient id="chat-belly" cx="50%" cy="80%" r="60%"><stop offset="0" stopColor="#fff7ed"/><stop offset="1" stopColor="#fdba74" stopOpacity="0"/></radialGradient>
            <linearGradient id="chat-box" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4b5563"/><stop offset="1" stopColor="#111827"/></linearGradient>
            <filter id="chat-soft"><feGaussianBlur stdDeviation="3"/></filter>
          </defs>
          {/* l'imprimante */}
          <ellipse cx="160" cy="254" rx="140" ry="6" fill="#000" opacity=".5" filter="url(#chat-soft)"/>
          <rect x="40" y="176" width="240" height="78" rx="12" fill="url(#chat-box)" stroke="#6b7280"/>
          <rect x="52" y="190" width="160" height="56" rx="6" fill="#0b1220" stroke="#374151"/>
          <rect x="58" y="194" width="148" height="3" fill="#fde68a" opacity=".6"/>
          <rect x="100" y="228" width="60" height="14" rx="2" fill="#f97316" opacity=".8"/>
          <rect x="226" y="198" width="40" height="18" rx="3" fill="#0b1220"/>
          <text x="246" y="211" textAnchor="middle" fontSize="9" fill="#f87171" fontFamily={MONO}>55°</text>
          {[70, 150, 250].map((x, i) => (
            <path key={x} d={`M${x} 172 q6 -8 0 -16 q-6 -8 0 -16`} stroke="#fca5a5" strokeWidth="2" fill="none"
              style={{ transformBox:"fill-box", transformOrigin:"bottom", animation:`chat-heat 2.4s ease-in-out ${i * 0.6}s infinite` }}/>
          ))}
          {/* le chat */}
          <g key={twitch} style={{ animation: twitch ? "chat-twitch .6s ease" : "none", transformBox:"fill-box", transformOrigin:"center bottom" }}>
            <g style={{ animation: holding ? "chat-purr .08s linear infinite" : "none" }}>
              <ellipse cx="170" cy="176" rx="96" ry="8" fill="#000" opacity=".35" filter="url(#chat-soft)"/>
              <g style={{ transformBox:"fill-box", transformOrigin:"right center", animation:"chat-tail 3s ease-in-out infinite" }}>
                <path d="M244 160 Q284 162 268 178 Q240 192 170 186" stroke="#ea580c" strokeWidth="15" fill="none" strokeLinecap="round"/>
                <path d="M258 162 Q276 168 268 176" stroke="#9a3412" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".5"/>
              </g>
              <g style={{ transformBox:"fill-box", transformOrigin:"center bottom", animation:`chat-breathe ${holding ? 1.6 : 3.2}s ease-in-out infinite` }}>
                <ellipse cx="172" cy="146" rx="80" ry="34" fill="url(#chat-fur)"/>
                <ellipse cx="160" cy="160" rx="60" ry="16" fill="url(#chat-belly)"/>
                {[140, 166, 192, 216].map((x, i) => (
                  <path key={x} d={`M${x} ${116 + (i % 2) * 2} q8 14 2 30`} stroke="#9a3412" strokeWidth="5" fill="none" strokeLinecap="round" opacity=".45"/>
                ))}
              </g>
              <ellipse cx="124" cy="176" rx="14" ry="7" fill="#fdba74"/>
              <ellipse cx="148" cy="178" rx="14" ry="7" fill="#fed7aa"/>
              {/* la tete */}
              <path d="M78 122 L84 92 L104 114 Z" fill="#f97316"/>
              <path d="M84 116 L87 100 L98 113 Z" fill="#fda4af"/>
              <path d="M110 112 L126 88 L132 118 Z" fill="#f97316"/>
              <path d="M114 113 L125 98 L128 116 Z" fill="#fda4af"/>
              <circle cx="106" cy="142" r="32" fill="url(#chat-fur)"/>
              <path d="M96 116 q4 6 0 12 M106 113 q4 7 0 14 M116 116 q4 6 0 12" stroke="#9a3412" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".5"/>
              <ellipse cx="104" cy="156" rx="18" ry="11" fill="#fff7ed" opacity=".9"/>
              {happy ? (
                <>
                  <path d="M84 142 q6 -7 12 0" stroke="#431407" strokeWidth="2.6" fill="none" strokeLinecap="round"/>
                  <path d="M108 142 q6 -7 12 0" stroke="#431407" strokeWidth="2.6" fill="none" strokeLinecap="round"/>
                </>
              ) : (
                <>
                  <path d="M84 140 q6 5 12 0" stroke="#431407" strokeWidth="2.6" fill="none" strokeLinecap="round"/>
                  <path d="M108 140 q6 5 12 0" stroke="#431407" strokeWidth="2.6" fill="none" strokeLinecap="round"/>
                </>
              )}
              <circle cx="88" cy="150" r="5" fill="#fb7185" opacity={holding || happy ? .55 : .2}/>
              <circle cx="122" cy="150" r="5" fill="#fb7185" opacity={holding || happy ? .55 : .2}/>
              <path d="M100 150 L108 150 L104 155 Z" fill="#fb7185"/>
              <path d="M104 155 q-4 5 -8 2 M104 155 q4 5 8 2" stroke="#431407" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
              <path d="M70 150 L90 153 M70 158 L90 157 M138 150 L118 153 M138 158 L118 157" stroke="#fff" strokeWidth="1" opacity=".8"/>
            </g>
          </g>
          {!holding && !won && ["z", "Z", "z"].map((z, i) => (
            <text key={i} x="132" y="104" fontSize={12 + i * 4} fill="#fde68a" fontWeight="800" fontFamily={FONT}
              style={{ animation:`chat-z 3.6s ease-out ${i * 1.2}s infinite`, opacity:0 }}>{z}</text>
          ))}
        </svg>
        {hearts.map(h => (
          <span key={h.id} aria-hidden="true" style={{ position:"absolute", top:"30%", left:`${h.x}%`, fontSize:h.s, pointerEvents:"none",
            animation:"chat-heart 1.6s ease-out forwards" }}>💗</span>
        ))}
      </div>
      <div style={{ width:"min(80vw, 320px)", marginTop:14, position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:5 }}>
          <span>Ronronnement</span><span style={{ fontFamily:MONO }}>{Math.round(gauge * 100)} %</span>
        </div>
        <div style={{ height:12, borderRadius:8, background:"rgba(0,0,0,.35)", border:"1px solid rgba(253,230,138,.3)", overflow:"hidden" }}>
          <div style={{ width:`${gauge * 100}%`, height:"100%", borderRadius:8, background:"linear-gradient(90deg, #fda4af, #f43f5e)",
            boxShadow:"0 0 12px rgba(244,63,94,.7)" }}/>
        </div>
      </div>
      <Hint style={{ color:"#fed7aa" }}>{won ? "Il ronronne si fort que le plateau vibre." : "Les chats aiment la patience. Pose ta main sur lui… et laisse-la."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 13. tresor : la carte de l'ile de la Bobine perdue                  */
/* ------------------------------------------------------------------ */

const TR_N = 6;
const TR_MAX = 10;
const TR_HEAT = d => (d === 0 ? { w: "Trésor !", c: "#b45309", e: "💰" } : d === 1 ? { w: "Brûlant", c: "#dc2626", e: "🔥" }
  : d === 2 ? { w: "Chaud", c: "#ea580c", e: "♨️" } : d === 3 ? { w: "Tiède", c: "#a16207", e: "🌤️" } : { w: "Froid", c: "#1d4ed8", e: "❄️" });
const TRESOR_CSS = `
@keyframes tresor-dig { 0% { transform:scale(.4) rotate(-20deg); opacity:0 } 70% { transform:scale(1.15) rotate(4deg); opacity:1 } 100% { transform:scale(1) } }
@keyframes tresor-shine { 0%,100% { filter:drop-shadow(0 0 4px #facc15) } 50% { filter:drop-shadow(0 0 16px #fde047) } }
@keyframes tresor-wave { 0%,100% { transform:translateX(0) } 50% { transform:translateX(6px) } }
.tresor-cell:hover:not(:disabled) { background:rgba(120,72,20,.14) !important }
`;

function Tresor() {
  const [won, win] = useWin("tresor");
  const [treasure, setTreasure] = useState(() => Math.floor(Math.random() * TR_N * TR_N));
  const [dug, setDug] = useState({});
  const [state, setState] = useState("play");
  const { later } = useTimers();
  const used = Object.keys(dug).length;

  const dig = i => {
    if (state !== "play" || dug[i] !== undefined) return;
    const d = Math.abs((i % TR_N) - (treasure % TR_N)) + Math.abs(Math.floor(i / TR_N) - Math.floor(treasure / TR_N));
    const nd = { ...dug, [i]: d };
    setDug(nd);
    if (d === 0) {
      setState("found");
      [523, 659, 784, 1047].forEach((f, k) => later(() => beep(f, 0.25, "triangle", 0.12), k * 120));
      win();
    } else if (Object.keys(nd).length >= TR_MAX) {
      setState("lost");
      beep(130, 0.6, "sawtooth", 0.08);
    } else beep(120 + (5 - Math.min(d, 5)) * 60, 0.12, "square", 0.05);
  };
  const reset = () => { setTreasure(Math.floor(Math.random() * TR_N * TR_N)); setDug({}); setState("play"); };
  const ink = "#5b3a1a";

  return (
    <Stage won={won} wonText="Trésor déterré !" font="Georgia, 'Times New Roman', serif"
      bg="radial-gradient(ellipse at center, #6b4423 0%, #3b2412 60%, #1a0f06 100%)">
      <style>{TRESOR_CSS}</style>
      <div style={{ position:"relative", zIndex:2, width:"min(94vw, 440px)", padding:"22px 16px 18px", color:ink,
        background:"radial-gradient(ellipse at 40% 35%, #f8ecd0 0%, #ecd9ac 55%, #d2b277 100%)", borderRadius:"18px 26px 14px 30px",
        boxShadow:"inset 0 0 50px rgba(120,72,20,.55), inset 0 0 8px rgba(80,40,10,.6), 0 26px 60px rgba(0,0,0,.6)", transform:"rotate(-1deg)" }}>
        <svg viewBox="0 0 60 60" aria-hidden="true" style={{ position:"absolute", bottom:10, right:12, width:46, opacity:.7 }}>
          <circle cx="30" cy="30" r="22" fill="none" stroke={ink} strokeWidth="1"/>
          <circle cx="30" cy="30" r="16" fill="none" stroke={ink} strokeWidth=".6" strokeDasharray="2 2"/>
          <path d="M30 4 L34 30 L30 56 L26 30 Z" fill={ink}/>
          <path d="M4 30 L30 26 L56 30 L30 34 Z" fill={ink} opacity=".6"/>
          <text x="30" y="3" textAnchor="middle" fontSize="7" fill={ink} fontWeight="700">N</text>
        </svg>
        <span aria-hidden="true" style={{ position:"absolute", left:12, bottom:10, fontSize:24, opacity:.55, animation:"tresor-wave 4s ease-in-out infinite" }}>🐙</span>
        <div style={{ textAlign:"center", marginBottom:4 }}>
          <div style={{ fontSize:"clamp(22px, 6vw, 30px)", fontWeight:800, fontStyle:"italic", letterSpacing:".02em" }}>Île de la Bobine perdue</div>
          <div style={{ fontSize:13, opacity:.8, marginTop:2 }}>Le capitaine Benchy y a enterré sa bobine d'or.</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${TR_N}, 1fr)`, gap:4, margin:"14px auto 10px", width:"min(84vw, 340px)",
          padding:6, borderRadius:12, border:`2px dashed ${ink}55`, background:"rgba(255,255,255,.12)" }}>
          {Array.from({ length: TR_N * TR_N }, (_, i) => {
            const d = dug[i];
            const isT = (state !== "play" && i === treasure);
            const h = d !== undefined ? TR_HEAT(d) : null;
            return (
              <button key={i} className="tresor-cell" onClick={() => dig(i)} disabled={state !== "play" || d !== undefined}
                aria-label={h ? h.w : `Creuser ici, case ${i + 1}`}
                style={{ aspectRatio:"1", minHeight:42, borderRadius:8, border:"none", cursor: state === "play" && d === undefined ? "pointer" : "default",
                  padding:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1, fontFamily:"inherit",
                  background: h ? "radial-gradient(circle, rgba(60,30,10,.55) 0%, rgba(60,30,10,.2) 60%, transparent 75%)" : "rgba(120,72,20,.06)",
                  color: h ? h.c : ink, transition:"background .2s" }}>
                {h && <>
                  <span style={{ fontSize:"clamp(16px, 5vw, 22px)", animation: d === 0 ? "tresor-dig .5s ease both, tresor-shine 1.4s ease-in-out infinite" : "tresor-dig .4s ease both" }}>{h.e}</span>
                  <span style={{ fontSize:"clamp(8px, 2.3vw, 10px)", fontWeight:800, fontFamily:FONT, color:h.c, filter:"brightness(1.1)" }}>{h.w}</span>
                </>}
                {!h && isT && <span style={{ fontSize:26, color:"#b91c1c", fontWeight:900 }}>✕</span>}
                {!h && !isT && <span style={{ opacity:.25, fontSize:10 }}>·</span>}
              </button>
            );
          })}
        </div>
        <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:4, flexWrap:"wrap" }}>
          {Array.from({ length: TR_MAX }, (_, i) => (
            <span key={i} style={{ fontSize:18, opacity: i < TR_MAX - used ? 1 : .2, filter: i < TR_MAX - used ? "none" : "grayscale(1)" }}>⛏️</span>
          ))}
        </div>
        <div style={{ textAlign:"center", marginTop:8, fontWeight:700, fontSize:14.5 }}>
          {state === "found" ? `Trouvé en ${used} coup${used > 1 ? "s" : ""} ! La bobine d'or est à toi.`
            : state === "lost" ? "Plus de pioches… le ✕ marquait l'endroit." : `${TR_MAX - used} coups de pioche restants`}
        </div>
        {state !== "play" && <div style={{ textAlign:"center", marginTop:10 }}>
          <Btn color="#92400e" onClick={reset} style={{ minHeight:44 }}>{state === "lost" ? "Nouvelle carte" : "Rejouer"}</Btn>
        </div>}
      </div>
      <Hint style={{ color:"#f5deb3" }}>Chaque trou te dit si tu chauffes. Dix coups de pioche, pas un de plus.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 14. des : le double six                                             */
/* ------------------------------------------------------------------ */

const DIE_FRONT = { 1: [0, 0], 2: [90, 0], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 6: [0, 180] };
const DIE_PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const DIE_FACES = [[1, "translateZ(var(--h))"], [6, "rotateY(180deg) translateZ(var(--h))"], [3, "rotateY(90deg) translateZ(var(--h))"],
  [4, "rotateY(-90deg) translateZ(var(--h))"], [5, "rotateX(90deg) translateZ(var(--h))"], [2, "rotateX(-90deg) translateZ(var(--h))"]];
const DES_CSS = `
@keyframes des-toss { 0% { transform:translateY(0) } 30% { transform:translateY(-70px) } 60% { transform:translateY(0) } 75% { transform:translateY(-14px) } 100% { transform:translateY(0) } }
@keyframes des-shadow { 0%,60%,100% { transform:scale(1); opacity:.5 } 30% { transform:scale(.55); opacity:.2 } }
`;

function Die({ value, rot, color, pip, tossKey, size = 76 }) {
  return (
    <div style={{ position:"relative", width:size, height:size + 30 }}>
      <div key={"s" + tossKey} style={{ position:"absolute", left:"10%", right:"10%", bottom:0, height:14, borderRadius:"50%",
        background:"rgba(0,0,0,.5)", filter:"blur(4px)", animation: tossKey ? "des-shadow 1.2s ease" : "none" }}/>
      <div key={tossKey} style={{ position:"absolute", top:0, left:0, width:size, height:size, perspective:600,
        animation: tossKey ? "des-toss 1.2s cubic-bezier(.3,.6,.4,1)" : "none" }}>
        <div style={{ "--h":`${size / 2}px`, position:"relative", width:size, height:size, transformStyle:"preserve-3d",
          transform:`rotateX(${rot[0]}deg) rotateY(${rot[1]}deg)`, transition:"transform 1.2s cubic-bezier(.2,.75,.25,1)" }}>
          {DIE_FACES.map(([v, tr]) => (
            <div key={v} style={{ position:"absolute", inset:0, transform:tr, borderRadius:size * 0.18, background:color,
              boxShadow:"inset 0 0 14px rgba(0,0,0,.28), inset 0 2px 0 rgba(255,255,255,.5)", display:"grid",
              gridTemplateColumns:"repeat(3, 1fr)", gridTemplateRows:"repeat(3, 1fr)", padding:size * 0.13, backfaceVisibility:"hidden",
              WebkitBackfaceVisibility:"hidden" }}>
              {Array.from({ length: 9 }, (_, k) => (
                <span key={k} style={{ margin:"auto", width:size * 0.16, height:size * 0.16, borderRadius:"50%",
                  background: DIE_PIPS[v].includes(k) ? pip : "transparent",
                  boxShadow: DIE_PIPS[v].includes(k) ? "inset 0 2px 3px rgba(0,0,0,.55)" : "none" }}/>
              ))}
            </div>
          ))}
        </div>
      </div>
      <span style={{ position:"absolute", width:1, height:1, overflow:"hidden", clip:"rect(0 0 0 0)" }}>{value}</span>
    </div>
  );
}

function Des() {
  const [won, win] = useWin("des");
  const [vals, setVals] = useState([3, 5]);
  const [rots, setRots] = useState([[DIE_FRONT[3][0] - 20, DIE_FRONT[3][1] + 25], [DIE_FRONT[5][0] + 15, DIE_FRONT[5][1] - 30]]);
  const [rolling, setRolling] = useState(false);
  const [toss, setToss] = useState(0);
  const [count, setCount] = useState(0);
  const [hist, setHist] = useState([]);
  const turns = useRef([[0, 0], [0, 0]]);
  const { later } = useTimers();

  const roll = () => {
    if (rolling) return;
    const nv = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    turns.current = turns.current.map(([tx, ty]) => [tx + 2 + Math.floor(Math.random() * 2), ty + 1 + Math.floor(Math.random() * 2)]);
    setRots(nv.map((v, i) => [DIE_FRONT[v][0] + 360 * turns.current[i][0], DIE_FRONT[v][1] + 360 * turns.current[i][1]]));
    setRolling(true);
    setToss(t => t + 1);
    beep(200, 0.05, "square", 0.04);
    later(() => beep(260, 0.05, "square", 0.04), 700);
    later(() => beep(220, 0.05, "square", 0.04), 950);
    later(() => {
      setVals(nv);
      setRolling(false);
      setCount(c => c + 1);
      setHist(h => [nv, ...h].slice(0, 8));
      if (nv[0] === 6 && nv[1] === 6) { beep(784, 0.2); later(() => beep(1175, 0.4), 160); win(); }
    }, 1250);
  };

  useKeyDown(e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); roll(); } });
  const last = hist[0];
  const six = last && last[0] === 6 && last[1] === 6;

  return (
    <Stage won={won} wonText="Double six !" font={FONT}
      bg="radial-gradient(ellipse at 50% 45%, #15803d 0%, #14532d 55%, #052e16 100%)"
      style={{ boxShadow:"inset 0 0 0 14px #5b3a1e, inset 0 0 0 18px #3b2412, inset 0 0 80px rgba(0,0,0,.6)" }}>
      <style>{DES_CSS}</style>
      <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none", opacity:.18,
        background:"repeating-radial-gradient(circle at 30% 30%, rgba(255,255,255,.08) 0 1px, transparent 1px 3px)" }}/>
      <Title sub="Deux dés imprimés en PLA, remplissage 100 %. Il te faut le plus beau des lancers.">Les dés</Title>
      <div style={{ display:"flex", gap:"clamp(26px, 10vw, 60px)", marginTop:46, position:"relative", zIndex:2 }}>
        <Die value={vals[0]} rot={rots[0]} tossKey={toss} color="linear-gradient(145deg, #ffffff, #e5e7eb)" pip="#b91c1c"/>
        <Die value={vals[1]} rot={rots[1]} tossKey={toss} color="linear-gradient(145deg, #fdba74, #ea580c)" pip="#fff7ed"/>
      </div>
      <div style={{ marginTop:14, minHeight:24, fontWeight:800, fontSize:16, position:"relative", zIndex:2 }}>
        {rolling ? "Ça roule…" : last ? (six ? "🎉 DOUBLE SIX !" : `${last[0]} + ${last[1]} = ${last[0] + last[1]}`) : "À toi de lancer."}
      </div>
      <Btn color="#b45309" onClick={roll} disabled={rolling} style={{ marginTop:12, minHeight:48, fontSize:17, padding:"12px 28px",
        position:"relative", zIndex:2, opacity: rolling ? .7 : 1 }}>🎲 Lancer</Btn>
      <div style={{ display:"flex", gap:6, marginTop:14, flexWrap:"wrap", justifyContent:"center", position:"relative", zIndex:2, minHeight:24 }}>
        {hist.map((h, i) => (
          <span key={count - i} style={{ fontFamily:MONO, fontSize:12, padding:"3px 7px", borderRadius:6, background:"rgba(0,0,0,.3)",
            opacity:1 - i * 0.1 }}>{h[0]}·{h[1]}</span>
        ))}
      </div>
      <Hint>{count ? `${count} lancer${count > 1 ? "s" : ""}. La chance sourit aux obstinés.` : "Espace ou Entrée pour lancer au clavier."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 15. pile-ou-face : bobine ou buse                                   */
/* ------------------------------------------------------------------ */

const PF_GOAL = 5;
const PF_CSS = `
@keyframes pf-toss { 0% { transform:translateY(0) scale(1) } 45% { transform:translateY(-150px) scale(1.15) } 90% { transform:translateY(0) scale(1) } 95% { transform:translateY(-8px) } 100% { transform:translateY(0) } }
@keyframes pf-shadow { 0%,90%,100% { transform:scale(1); opacity:.55 } 45% { transform:scale(.45); opacity:.15 } }
`;

function CoinFace({ side }) {
  const pile = side === "pile";
  return (
    <div style={{ position:"absolute", inset:0, borderRadius:"50%", backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden",
      transform: pile ? "none" : "rotateX(180deg)",
      background:"radial-gradient(circle at 35% 30%, #fef9c3 0%, #facc15 35%, #ca8a04 75%, #854d0e 100%)",
      boxShadow:"inset 0 0 0 6px #a16207, inset 0 0 0 9px #fde68a, inset 0 -8px 18px rgba(0,0,0,.35)", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center" }}>
      <svg viewBox="0 0 60 60" style={{ width:"52%", height:"auto", filter:"drop-shadow(1px 1px 0 rgba(255,255,255,.6)) drop-shadow(-1px -1px 0 rgba(120,53,15,.6))" }}>
        {pile ? (
          <g fill="none" stroke="#854d0e" strokeWidth="3">
            <circle cx="30" cy="30" r="25"/><circle cx="30" cy="30" r="18" strokeWidth="1.5" strokeDasharray="2 3"/>
            <circle cx="30" cy="30" r="9" fill="#a16207"/><circle cx="30" cy="30" r="3.5" fill="#fde68a"/>
          </g>
        ) : (
          <g fill="#a16207" stroke="#854d0e" strokeWidth="2">
            <rect x="14" y="6" width="32" height="16" rx="3"/>
            <path d="M18 22 L42 22 L42 30 L36 40 L32 52 L28 52 L24 40 L18 30 Z"/>
            <circle cx="30" cy="54" r="2.5" fill="#fde68a"/>
          </g>
        )}
      </svg>
      <span style={{ fontWeight:900, fontSize:13, letterSpacing:".25em", color:"#78350f", marginTop:2 }}>{pile ? "PILE" : "FACE"}</span>
    </div>
  );
}

function PileOuFace() {
  const [won, win] = useWin("pile-ou-face");
  const [rot, setRot] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [toss, setToss] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [hist, setHist] = useState([]);
  const { later } = useTimers();

  const flip = () => {
    if (flipping) return;
    const res = Math.random() < 0.5 ? "pile" : "face";
    let nr = rot + 1800;
    if (((nr / 180) % 2 === 0) !== (res === "pile")) nr += 180;
    setRot(nr);
    setFlipping(true);
    setToss(t => t + 1);
    beep(1400, 0.06, "triangle", 0.06);
    later(() => {
      setFlipping(false);
      setHist(h => [res, ...h].slice(0, 12));
      beep(res === "pile" ? 880 : 330, 0.12, "triangle", 0.08);
      if (res === "pile") {
        const s = streak + 1;
        setStreak(s);
        setBest(b => Math.max(b, s));
        if (s >= PF_GOAL) win();
      } else setStreak(0);
    }, 1250);
  };
  useKeyDown(e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); } });
  const last = hist[0];

  return (
    <Stage won={won} wonText="Cinq piles d'affilée !" font={FONT}
      bg="radial-gradient(ellipse at 50% 30%, #44403c 0%, #1c1917 60%, #0c0a09 100%)">
      <style>{PF_CSS}</style>
      <div aria-hidden="true" style={{ position:"absolute", top:0, left:"50%", width:360, height:360, marginLeft:-180, pointerEvents:"none",
        background:"radial-gradient(circle, rgba(250,204,21,.15), transparent 65%)" }}/>
      <Title sub="Une pièce frappée d'une bobine et d'une buse. La bobine doit tomber, encore et encore.">Pile ou face</Title>
      <div style={{ position:"relative", width:150, height:150, marginTop:120, zIndex:2 }}>
        <div key={"s" + toss} style={{ position:"absolute", left:15, right:15, bottom:-24, height:16, borderRadius:"50%", background:"rgba(0,0,0,.6)",
          filter:"blur(5px)", animation: toss ? "pf-shadow 1.2s ease" : "none" }}/>
        <div key={toss} style={{ position:"absolute", inset:0, perspective:700, animation: toss ? "pf-toss 1.2s cubic-bezier(.3,.6,.4,1)" : "none" }}>
          <div style={{ position:"relative", width:"100%", height:"100%", transformStyle:"preserve-3d", transform:`rotateX(${rot}deg)`,
            transition:"transform 1.2s cubic-bezier(.25,.7,.3,1)" }}>
            <CoinFace side="pile"/>
            <CoinFace side="face"/>
          </div>
        </div>
      </div>
      <div style={{ marginTop:34, minHeight:24, fontWeight:800, fontSize:17, position:"relative", zIndex:2 }}>
        {flipping ? "…" : last ? (last === "pile" ? "Pile ! La bobine." : "Face… la buse.") : "Lance la pièce."}
      </div>
      <div style={{ display:"flex", gap:8, marginTop:10, position:"relative", zIndex:2 }}>
        {Array.from({ length: PF_GOAL }, (_, i) => (
          <span key={i} style={{ width:30, height:30, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14,
            background: i < streak ? "radial-gradient(circle at 35% 30%, #fef9c3, #eab308 60%, #a16207)" : "rgba(255,255,255,.08)",
            border:"1px solid rgba(250,204,21,.35)", boxShadow: i < streak ? "0 0 12px rgba(250,204,21,.6)" : "none",
            transition:"all .3s" }}>{i < streak ? "🧵" : ""}</span>
        ))}
      </div>
      <div style={{ fontFamily:MONO, fontSize:12.5, opacity:.75, marginTop:8, position:"relative", zIndex:2 }}>Série : {streak} · record : {best}</div>
      <Btn color="#ca8a04" onClick={flip} disabled={flipping} style={{ marginTop:12, minHeight:48, fontSize:17, padding:"12px 28px",
        position:"relative", zIndex:2, opacity: flipping ? .7 : 1, color:"#1c1917" }}>Lancer la pièce</Btn>
      <div style={{ display:"flex", gap:4, marginTop:12, position:"relative", zIndex:2, minHeight:16 }}>
        {hist.map((h, i) => <span key={toss - i} title={h} style={{ width:14, height:14, borderRadius:"50%",
          background: h === "pile" ? "#facc15" : "#57534e", opacity:1 - i * 0.07 }}/>)}
      </div>
      <Hint>Pile = bobine, face = buse. Espace pour lancer au clavier.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 16. morse : le phare qui clignote                                   */
/* ------------------------------------------------------------------ */

const MORSE = { A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
  M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--.." };
const MORSE_WORD = "BAMBU";
const MORSE_CSS = `
@keyframes morse-wave { 0%,100% { transform:translateX(0) } 50% { transform:translateX(-14px) } }
@keyframes morse-tw { 0%,100% { opacity:.3 } 50% { opacity:1 } }
`;
const morseSym = s => s.split("").map(c => (c === "." ? "•" : "—")).join(" ");

function buildMorse(word) {
  const steps = [];
  word.split("").forEach((l, li) => {
    const code = MORSE[l];
    code.split("").forEach((s, si) => {
      steps.push({ on: true, u: s === "." ? 1 : 3, sym: s, first: si === 0 });
      if (si < code.length - 1) steps.push({ on: false, u: 1 });
    });
    steps.push({ on: false, u: li < word.length - 1 ? 3 : 8 });
  });
  return steps;
}

function Morse() {
  const [won, win] = useWin("morse");
  const [on, setOn] = useState(false);
  const [tape, setTape] = useState("");
  const [slow, setSlow] = useState(false);
  const [text, setText] = useState("");
  const steps = useMemo(() => buildMorse(MORSE_WORD), []);

  useEffect(() => {
    const unit = slow ? 420 : 250;
    let i = 0, id;
    const run = () => {
      const s = steps[i];
      setOn(s.on);
      if (s.on) setTape(t => (s.first ? s.sym : t + s.sym));
      id = setTimeout(() => { i = (i + 1) % steps.length; run(); }, s.u * unit);
    };
    id = setTimeout(run, 600);
    return () => clearTimeout(id);
  }, [steps, slow]);

  const change = e => {
    const v = e.target.value.toUpperCase().normalize("NFD").replace(/[^A-Z]/g, "").slice(0, 12);
    setText(v);
    if (v === MORSE_WORD) win();
  };
  const ok = text === MORSE_WORD;

  return (
    <Stage won={won} wonText="Message reçu !" font={FONT}
      bg="linear-gradient(180deg, #020617 0%, #0f1e46 55%, #0c4a6e 56%, #082f49 100%)">
      <style>{MORSE_CSS}</style>
      <Title sub="Toutes les nuits, le vieux phare répète le même mot. Que dit-il ?">Le phare</Title>
      <svg viewBox="0 0 300 220" style={{ width:"min(90vw, 420px)", height:"auto", marginTop:6, position:"relative", zIndex:2, overflow:"visible" }}>
        <defs>
          <linearGradient id="mo-beam-l" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stopColor="#fef9c3" stopOpacity=".85"/><stop offset="1" stopColor="#fef9c3" stopOpacity="0"/></linearGradient>
          <linearGradient id="mo-beam-r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fef9c3" stopOpacity=".85"/><stop offset="1" stopColor="#fef9c3" stopOpacity="0"/></linearGradient>
          <radialGradient id="mo-halo"><stop offset="0" stopColor="#fef08a"/><stop offset=".3" stopColor="#fde047" stopOpacity=".6"/><stop offset="1" stopColor="#fde047" stopOpacity="0"/></radialGradient>
          <clipPath id="mo-tower"><path d="M136 70 L164 70 L172 186 L128 186 Z"/></clipPath>
        </defs>
        {[[20, 20], [60, 44], [250, 30], [280, 70], [210, 12], [30, 80], [100, 14]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.2" fill="#e0e7ff" style={{ animation:`morse-tw ${2 + i * 0.4}s ease-in-out infinite` }}/>
        ))}
        <g style={{ opacity: on ? 1 : 0, transition:"opacity .06s" }}>
          <path d="M150 56 L-40 20 L-40 96 Z" fill="url(#mo-beam-l)"/>
          <path d="M150 56 L340 20 L340 96 Z" fill="url(#mo-beam-r)"/>
          <circle cx="150" cy="56" r="40" fill="url(#mo-halo)"/>
        </g>
        <path d="M110 200 Q130 178 150 184 Q176 176 196 200 Z" fill="#1e293b"/>
        <path d="M136 70 L164 70 L172 186 L128 186 Z" fill="#f8fafc"/>
        <g clipPath="url(#mo-tower)">
          {[86, 118, 150].map(y => <rect key={y} x="120" y={y} width="60" height="16" fill="#dc2626"/>)}
          <rect x="120" y="70" width="14" height="120" fill="#000" opacity=".18"/>
        </g>
        <rect x="146" y="150" width="8" height="14" rx="4" fill="#1e293b"/>
        <rect x="130" y="64" width="40" height="6" rx="1" fill="#1e293b"/>
        <rect x="139" y="44" width="22" height="20" rx="2" fill={on ? "#fef08a" : "#334155"} stroke="#1e293b" strokeWidth="2"
          style={{ transition:"fill .06s", filter: on ? "drop-shadow(0 0 10px #fde047)" : "none" }}/>
        <path d="M136 44 L150 30 L164 44 Z" fill="#b91c1c"/>
        <circle cx="150" cy="28" r="2" fill="#1e293b"/>
        {[0, 1, 2].map(k => (
          <path key={k} d={`M-20 ${196 + k * 9} q 15 -5 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0`}
            stroke="#38bdf8" strokeOpacity={0.35 - k * 0.08} strokeWidth="1.5" fill="none"
            style={{ animation:`morse-wave ${3 + k}s ease-in-out infinite` }}/>
        ))}
        {on && <path d="M60 210 L240 210" stroke="#fef08a" strokeOpacity=".25" strokeWidth="5"/>}
      </svg>
      <div style={{ marginTop:4, fontFamily:MONO, fontSize:24, letterSpacing:".1em", minHeight:32, color:"#fde68a", position:"relative", zIndex:2,
        textShadow:"0 0 10px rgba(253,224,71,.6)" }}>{morseSym(tape)}</div>
      <input value={text} onChange={change} placeholder="Le mot du phare" aria-label="Le mot du phare" autoComplete="off" spellCheck={false}
        style={{ marginTop:10, width:"min(80vw, 280px)", height:48, borderRadius:12, textAlign:"center", fontFamily:MONO, fontSize:22,
          letterSpacing:".25em", fontWeight:800, color: ok ? "#4ade80" : "#e0f2fe", background:"rgba(2,6,23,.75)", outline:"none",
          border:`2px solid ${ok ? "#4ade80" : "rgba(125,211,252,.4)"}`, position:"relative", zIndex:2, userSelect:"text", WebkitUserSelect:"text" }}/>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginTop:10, position:"relative", zIndex:2 }}>
        <Btn color="#0e7490" onClick={() => setSlow(s => !s)} style={{ minHeight:42, fontSize:13.5 }}>{slow ? "Vitesse normale" : "Plus lentement"}</Btn>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(64px, 1fr))", gap:"4px 8px", width:"min(94vw, 520px)",
        marginTop:14, padding:"10px 12px", borderRadius:12, background:"rgba(2,6,23,.55)", border:"1px solid rgba(125,211,252,.2)",
        fontFamily:MONO, fontSize:12, position:"relative", zIndex:2 }}>
        {Object.entries(MORSE).map(([l, c]) => (
          <div key={l} style={{ display:"flex", gap:6, alignItems:"baseline" }}>
            <b style={{ color:"#7dd3fc", minWidth:12 }}>{l}</b><span style={{ opacity:.85, letterSpacing:".05em" }}>{morseSym(c)}</span>
          </div>
        ))}
      </div>
      <Hint>Un éclair bref, un éclair long. Une longue nuit noire, et ça recommence.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 17. taquin : le Benchy au coucher du soleil                         */
/* ------------------------------------------------------------------ */

const TAQUIN_CSS = `
@keyframes taquin-in { from { opacity:0; transform:scale(.6) } to { opacity:1; transform:none } }
@keyframes taquin-glow { 0%,100% { box-shadow:0 0 0 3px #fde047, 0 20px 50px rgba(0,0,0,.5) } 50% { box-shadow:0 0 0 3px #fde047, 0 0 40px rgba(253,224,71,.7) } }
`;

function TaquinArt() {
  return (
    <g>
      <rect width="300" height="300" fill="url(#tq-sky)"/>
      <circle cx="210" cy="118" r="44" fill="url(#tq-sun)"/>
      {[[40, 60], [70, 48], [250, 40]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y} q6 -6 12 0 q6 -6 12 0`} stroke="#4c1d95" strokeWidth="2" fill="none" strokeLinecap="round"/>
      ))}
      <ellipse cx="80" cy="96" rx="50" ry="12" fill="#fff" opacity=".35"/>
      <ellipse cx="110" cy="88" rx="30" ry="10" fill="#fff" opacity=".3"/>
      <rect y="186" width="300" height="114" fill="url(#tq-sea)"/>
      <rect x="170" y="190" width="80" height="6" fill="#fde68a" opacity=".5"/>
      <rect x="185" y="202" width="50" height="4" fill="#fde68a" opacity=".35"/>
      <g transform="translate(140 226) scale(2.2)">
        <BenchyShape fill="#f97316" stroke="#7c2d12"/>
      </g>
      <path d="M0 236 q25 -8 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 V300 H0 Z" fill="#0369a1" opacity=".75"/>
      <path d="M0 262 q25 -8 50 0 t50 0 t50 0 t50 0 t50 0 t50 0" stroke="#7dd3fc" strokeWidth="2" fill="none" opacity=".7"/>
      <path d="M0 284 q25 -8 50 0 t50 0 t50 0 t50 0 t50 0 t50 0" stroke="#7dd3fc" strokeWidth="2" fill="none" opacity=".45"/>
    </g>
  );
}
function TaquinDefs() {
  return (
    <svg width="0" height="0" style={{ position:"absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="tq-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7c3aed"/><stop offset=".45" stopColor="#f472b6"/><stop offset=".7" stopColor="#fb923c"/><stop offset="1" stopColor="#fde68a"/>
        </linearGradient>
        <radialGradient id="tq-sun"><stop offset="0" stopColor="#fffbeb"/><stop offset=".6" stopColor="#fde047"/><stop offset="1" stopColor="#f97316" stopOpacity=".2"/></radialGradient>
        <linearGradient id="tq-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0ea5e9"/><stop offset="1" stopColor="#0c4a6e"/></linearGradient>
      </defs>
    </svg>
  );
}
const TQ_SOLVED = [0, 1, 2, 3, 4, 5, 6, 7, 8];
function shuffleTaquin() {
  let t = TQ_SOLVED.slice();
  let prev = -1;
  do {
    for (let k = 0; k < 220; k++) {
      const b = t.indexOf(8);
      const r = Math.floor(b / 3), c = b % 3;
      const nbs = [];
      if (r > 0) nbs.push(b - 3);
      if (r < 2) nbs.push(b + 3);
      if (c > 0) nbs.push(b - 1);
      if (c < 2) nbs.push(b + 1);
      const opts = nbs.filter(n => n !== prev);
      const n = pick(opts.length ? opts : nbs);
      [t[b], t[n]] = [t[n], t[b]];
      prev = b;
    }
  } while (t.every((v, i) => v === i));
  return t;
}

function Taquin() {
  const [won, win] = useWin("taquin");
  const [tiles, setTiles] = useState(shuffleTaquin);
  const [moves, setMoves] = useState(0);
  const solved = tiles.every((v, i) => v === i);

  const slide = pos => {
    if (solved) return;
    const b = tiles.indexOf(8);
    if (Math.abs(Math.floor(pos / 3) - Math.floor(b / 3)) + Math.abs((pos % 3) - (b % 3)) !== 1) return;
    const t = tiles.slice();
    [t[b], t[pos]] = [t[pos], t[b]];
    setTiles(t);
    setMoves(m => m + 1);
    beep(420 + t[b] * 30, 0.05, "triangle", 0.05);
    if (t.every((v, i) => v === i)) win();
  };
  useKeyDown(e => {
    const b = tiles.indexOf(8);
    const r = Math.floor(b / 3), c = b % 3;
    if (e.key === "ArrowLeft" && c < 2) { e.preventDefault(); slide(b + 1); }
    if (e.key === "ArrowRight" && c > 0) { e.preventDefault(); slide(b - 1); }
    if (e.key === "ArrowUp" && r < 2) { e.preventDefault(); slide(b + 3); }
    if (e.key === "ArrowDown" && r > 0) { e.preventDefault(); slide(b - 3); }
  });
  const reset = () => { setTiles(shuffleTaquin()); setMoves(0); };

  return (
    <Stage won={won} wonText="Puzzle reconstitué !" font={FONT}
      bg="radial-gradient(ellipse at 50% 0%, #831843 0%, #3b0764 50%, #120320 100%)">
      <style>{TAQUIN_CSS}</style>
      <TaquinDefs/>
      <Title sub="Le tranchage a tout découpé. Remets le Benchy dans le bon ordre.">Le taquin</Title>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:12, position:"relative", zIndex:2 }}>
        <span style={{ fontSize:12.5, opacity:.75 }}>Modèle</span>
        <svg viewBox="0 0 300 300" style={{ width:64, height:64, borderRadius:8, boxShadow:"0 4px 12px rgba(0,0,0,.5)" }}><TaquinArt/></svg>
      </div>
      <div style={{ position:"relative", width:"min(86vw, 330px)", aspectRatio:"1", marginTop:14, borderRadius:14, padding:0, zIndex:2,
        background:"rgba(0,0,0,.45)", boxShadow:"0 20px 50px rgba(0,0,0,.5), inset 0 0 0 2px rgba(255,255,255,.08)",
        animation: solved ? "taquin-glow 2s ease-in-out infinite" : "none", overflow:"hidden" }}>
        {Array.from({ length: 9 }, (_, id) => {
          const pos = tiles.indexOf(id);
          const blank = id === 8;
          if (blank && !solved) return null;
          return (
            <button key={id} onClick={() => slide(pos)} aria-label={`Tuile ${id + 1}`} style={{ position:"absolute",
              left:`${(pos % 3) * 33.333}%`, top:`${Math.floor(pos / 3) * 33.333}%`, width:"33.333%", height:"33.333%",
              padding: solved ? 0 : 2, border:"none", background:"transparent", cursor: solved ? "default" : "pointer",
              transition:"left .18s ease, top .18s ease, padding .5s", animation: blank ? "taquin-in .6s ease both" : "none" }}>
              <svg viewBox={`${(id % 3) * 100} ${Math.floor(id / 3) * 100} 100 100`} style={{ width:"100%", height:"100%", display:"block",
                borderRadius: solved ? 0 : 8, boxShadow: solved ? "none" : "inset 0 0 0 1px rgba(255,255,255,.3), 0 3px 8px rgba(0,0,0,.4)" }}>
                <TaquinArt/>
                {!solved && <text x={(id % 3) * 100 + 8} y={Math.floor(id / 3) * 100 + 18} fontSize="13" fontWeight="800" fill="#fff" opacity=".55"
                  style={{ paintOrder:"stroke", stroke:"rgba(0,0,0,.4)", strokeWidth:3 }}>{id + 1}</text>}
              </svg>
            </button>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:12, alignItems:"center", marginTop:14, position:"relative", zIndex:2 }}>
        <span style={{ fontFamily:MONO, fontSize:13, opacity:.85 }}>{solved ? `Reconstitué en ${moves} coups !` : `${moves} coups`}</span>
        <Btn color="#be185d" onClick={reset} style={{ minHeight:42 }}>Mélanger</Btn>
      </div>
      <Hint>Touche une tuile voisine de la case vide pour la faire glisser. Flèches au clavier.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 18. bobine : devider la bobine geante                               */
/* ------------------------------------------------------------------ */

const BOB_TURNS = 6;
const BOB_GOAL = BOB_TURNS * 2 * Math.PI;

function Bobine() {
  const [won, win] = useWin("bobine");
  const [total, setTotal] = useState(0);
  const totalRef = useRef(0);
  const last = useRef(null);
  const svgRef = useRef(null);
  const doneRef = useRef(false);

  const angleOf = e => {
    const r = svgRef.current.getBoundingClientRect();
    const cx = r.left + (200 / 400) * r.width, cy = r.top + (165 / 420) * r.height;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    if (Math.hypot(dx, dy) < r.width * 0.05) return null;
    return Math.atan2(dy, dx);
  };
  const down = e => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* sans capture */ }
    last.current = angleOf(e);
  };
  const move = e => {
    if (last.current === null || doneRef.current) return;
    const a = angleOf(e);
    if (a === null) return;
    let d = a - last.current;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    last.current = a;
    const nt = Math.max(0, Math.min(BOB_GOAL, totalRef.current + d));
    totalRef.current = nt;
    setTotal(nt);
    if (nt >= BOB_GOAL && !doneRef.current) { doneRef.current = true; beep(660, 0.2); beep(990, 0.4, "triangle", 0.1); win(); }
  };
  const up = () => { last.current = null; };

  const prog = total / BOB_GOAL;
  const rem = 1 - prog;
  const R = 54 + 74 * rem;
  const deg = (total * 180) / Math.PI;
  const pts = [];
  const maxT = prog * 16 * Math.PI;
  for (let t = 0; t <= maxT; t += 0.18) {
    const r = 4 + t * 2.9;
    pts.push([200 + r * Math.cos(t), 382 + r * 0.26 * Math.sin(t)]);
  }
  const end = pts.length ? pts[pts.length - 1] : [200, 382];
  const grams = Math.round(rem * 1000);
  const col = "#ec4899";

  return (
    <Stage won={won} wonText="Bobine vidée !" font={FONT}
      bg="radial-gradient(ellipse at 50% 30%, #312e81 0%, #1e1b4b 50%, #0b0820 100%)">
      <Title sub="Une bobine géante, et pas d'imprimante pour la manger. Fais-la tourner à la main.">La bobine</Title>
      <svg ref={svgRef} viewBox="0 0 400 420" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ width:"min(92vw, 440px)", height:"auto", marginTop:8, touchAction:"none", cursor:"grab", position:"relative", zIndex:2 }}>
        <defs>
          <radialGradient id="bob-fil" cx="50%" cy="50%" r="50%">
            <stop offset=".55" stopColor="#9d174d"/><stop offset=".85" stopColor={col}/><stop offset="1" stopColor="#f9a8d4"/>
          </radialGradient>
          <radialGradient id="bob-flange" cx="40%" cy="35%" r="70%">
            <stop offset="0" stopColor="#334155" stopOpacity=".55"/><stop offset="1" stopColor="#0f172a" stopOpacity=".8"/>
          </radialGradient>
          <filter id="bob-blur"><feGaussianBlur stdDeviation="5"/></filter>
        </defs>
        <ellipse cx="200" cy="384" rx="170" ry="26" fill="#000" opacity=".35" filter="url(#bob-blur)"/>
        <rect x="186" y="165" width="28" height="210" fill="#475569"/>
        <rect x="140" y="370" width="120" height="12" rx="4" fill="#334155"/>
        {/* le fil au sol */}
        {pts.length > 1 && <polyline points={pts.map(p => p.join(",")).join(" ")} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" opacity=".9"/>}
        {!won && <path d={`M${200 + R} 165 Q ${200 + R + 20} ${(165 + end[1]) / 2} ${end[0]} ${end[1]}`} stroke={col} strokeWidth="2.2" fill="none"/>}
        {/* la bobine */}
        <g transform={`rotate(${deg} 200 165)`}>
          <circle cx="200" cy="165" r="140" fill="url(#bob-flange)" stroke="#94a3b8" strokeOpacity=".5" strokeWidth="2"/>
          {rem > 0.001 && <circle cx="200" cy="165" r={R} fill="url(#bob-fil)"/>}
          {rem > 0.001 && Array.from({ length: Math.max(1, Math.round(rem * 10)) }, (_, i) => (
            <circle key={i} cx="200" cy="165" r={54 + (i + 0.5) * (R - 54) / Math.max(1, Math.round(rem * 10))} fill="none" stroke="#000" strokeOpacity=".1"/>
          ))}
          <circle cx="200" cy="165" r="54" fill="#1e293b" stroke="#64748b"/>
          {[0, 60, 120, 180, 240, 300].map(a => {
            const x = 200 + 95 * Math.cos(a * Math.PI / 180), y = 165 + 95 * Math.sin(a * Math.PI / 180);
            return <circle key={a} cx={x} cy={y} r="11" fill="#0b0820" opacity={rem > 0.6 ? 0 : 0.85}/>;
          })}
          <rect x="166" y="120" width="68" height="26" rx="4" fill="#f8fafc" opacity={rem > 0.15 ? 0 : 0.95}/>
          <text x="200" y="137" textAnchor="middle" fontSize="11" fontWeight="800" fill="#0f172a" opacity={rem > 0.15 ? 0 : 1} fontFamily={FONT}>PLA · 1 kg</text>
          <circle cx="200" cy="165" r="22" fill="#0b0820" stroke="#94a3b8" strokeWidth="3"/>
          <path d="M200 150 L200 180 M185 165 L215 165" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round"/>
          <circle cx="200" cy="38" r="6" fill="#fde047"/>
        </g>
        <path d="M330 70 A150 150 0 0 1 350 165" stroke="#fde68a" strokeWidth="3" fill="none" strokeLinecap="round" opacity={prog < 0.05 ? .8 : 0}
          markerEnd="none" style={{ transition:"opacity .6s" }}/>
        <path d="M344 156 L351 168 L358 156" stroke="#fde68a" strokeWidth="3" fill="none" strokeLinecap="round" opacity={prog < 0.05 ? .8 : 0} style={{ transition:"opacity .6s" }}/>
      </svg>
      <div style={{ width:"min(84vw, 340px)", marginTop:6, position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13.5, fontWeight:700, marginBottom:5 }}>
          <span>Filament restant : {grams} g</span>
          <span style={{ fontFamily:MONO, opacity:.75, fontWeight:500 }}>{Math.min(BOB_TURNS, Math.floor(total / (2 * Math.PI)))}/{BOB_TURNS} tours</span>
        </div>
        <div style={{ height:12, borderRadius:8, background:"rgba(255,255,255,.08)", overflow:"hidden", border:"1px solid rgba(249,168,212,.3)" }}>
          <div style={{ width:`${rem * 100}%`, height:"100%", borderRadius:8, background:"linear-gradient(90deg, #9d174d, #ec4899, #f9a8d4)",
            boxShadow:"0 0 10px rgba(236,72,153,.7)" }}/>
        </div>
      </div>
      <Hint>{won ? "Mille grammes au sol. Bon courage pour le rembobiner." : "Attrape la bobine et fais de grands cercles autour de son axe, dans le sens des aiguilles d'une montre."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 19. lune : la phase du jour                                         */
/* ------------------------------------------------------------------ */

const LUNE_NAMES = ["Nouvelle lune", "Premier croissant", "Premier quartier", "Gibbeuse croissante", "Pleine lune",
  "Gibbeuse décroissante", "Dernier quartier", "Dernier croissant"];
const LUNE_CYCLE = 29.530588853;
function moonToday() {
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const days = (Date.now() - ref) / 86400000;
  const age = ((days % LUNE_CYCLE) + LUNE_CYCLE) % LUNE_CYCLE;
  return Math.floor((age / LUNE_CYCLE) * 8 + 0.5) % 8;
}
const moonLit = i => (1 - Math.cos((2 * Math.PI * i) / 8)) / 2;
function moonPath(i, r) {
  const f = i / 8;
  const rx = Math.abs(Math.cos(2 * Math.PI * f)) * r;
  if (f < 0.5) return `M0 ${-r} A${r} ${r} 0 0 1 0 ${r} A${rx} ${r} 0 0 ${f < 0.25 ? 0 : 1} 0 ${-r} Z`;
  return `M0 ${-r} A${r} ${r} 0 0 0 0 ${r} A${rx} ${r} 0 0 ${f > 0.75 ? 1 : 0} 0 ${-r} Z`;
}
function MoonDisc({ phase, uid, style }) {
  const r = 44;
  return (
    <svg viewBox="-50 -50 100 100" style={style} aria-hidden="true">
      <defs>
        <radialGradient id={`lu-lit-${uid}`} cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#fffbeb"/><stop offset="1" stopColor="#d6d3d1"/></radialGradient>
        <clipPath id={`lu-clip-${uid}`}>{phase === 4 ? <circle r={r}/> : phase === 0 ? <rect width="0" height="0"/> : <path d={moonPath(phase, r)}/>}</clipPath>
      </defs>
      <circle r={r} fill="#1e293b" stroke="#334155" strokeWidth="1"/>
      <g clipPath={`url(#lu-clip-${uid})`}>
        <circle r={r} fill={`url(#lu-lit-${uid})`}/>
        {[[-14, -12, 9], [12, 8, 6], [-4, 20, 5], [18, -18, 4], [-22, 10, 4]].map(([x, y, cr], k) => (
          <circle key={k} cx={x} cy={y} r={cr} fill="#a8a29e" opacity=".45"/>
        ))}
      </g>
    </svg>
  );
}
const LUNE_CSS = `
@keyframes lune-tw { 0%,100% { opacity:.25 } 50% { opacity:1 } }
@keyframes lune-drift { 0%,100% { transform:translateX(0) } 50% { transform:translateX(10px) } }
@keyframes lune-glow { 0%,100% { filter:drop-shadow(0 0 18px rgba(254,249,195,.5)) } 50% { filter:drop-shadow(0 0 36px rgba(254,249,195,.9)) } }
@keyframes lune-shake { 0%,100% { transform:translateX(0) } 25% { transform:translateX(-5px) } 75% { transform:translateX(5px) } }
`;

function Lune() {
  const [won, win] = useWin("lune");
  const today = useMemo(moonToday, []);
  const [guess, setGuess] = useState(null);
  const [tries, setTries] = useState(0);
  const { later } = useTimers();
  const stars = useMemo(() => Array.from({ length: 60 }, () => ({ x: rand(0, 100), y: rand(0, 55), s: rand(1, 2.4), d: rand(2, 5), dl: -rand(0, 5) })), []);
  const ok = guess === today;
  const dateTxt = useMemo(() => new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), []);

  const choose = i => {
    if (ok) return;
    setGuess(i);
    setTries(t => t + 1);
    if (i === today) { beep(523, 0.3, "sine", 0.1); later(() => beep(784, 0.6, "sine", 0.1), 200); win(); }
    else beep(196, 0.25, "sine", 0.08);
  };
  let hint = "";
  if (guess !== null && !ok) {
    const a = moonLit(today), g = moonLit(guess);
    if (g < a - 0.01) hint = "Elle est plus généreuse que ça, ce soir…";
    else if (g > a + 0.01) hint = "Plus pudique, ce soir : elle ne se montre pas autant.";
    else hint = "Tu la regardes dans un miroir : c'est l'autre joue qui brille.";
    if (today >= 1 && today <= 3) hint += " Elle s'arrondit de nuit en nuit.";
    if (today >= 5 && today <= 7) hint += " Elle s'amincit de nuit en nuit.";
  }

  return (
    <Stage won={won} wonText="Lunatique confirmé !" font={FONT}
      bg="linear-gradient(180deg, #020617 0%, #0f172a 40%, #1e1b4b 75%, #312e81 100%)">
      <style>{LUNE_CSS}</style>
      {stars.map((s, i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", left:`${s.x}%`, top:`${s.y}%`, width:s.s, height:s.s, borderRadius:"50%",
          background:"#e0e7ff", animation:`lune-tw ${s.d}s ease-in-out ${s.dl}s infinite`, pointerEvents:"none" }}/>
      ))}
      <svg aria-hidden="true" viewBox="0 0 400 120" preserveAspectRatio="none" style={{ position:"absolute", left:0, bottom:0, width:"100%", height:"28%", pointerEvents:"none" }}>
        <path d="M0 70 Q60 30 120 60 T240 50 T400 40 V120 H0 Z" fill="#1e1b4b"/>
        <path d="M0 90 Q80 60 160 85 T300 75 T400 80 V120 H0 Z" fill="#0b0820"/>
        <rect x="292" y="58" width="34" height="24" fill="#0b0820"/>
        <path d="M288 60 L309 44 L330 60 Z" fill="#0b0820"/>
        <rect x="302" y="66" width="9" height="8" fill="#fbbf24" opacity=".9"/>
      </svg>
      <Title sub={`Nous sommes ${dateTxt}. Les nuages cachent la lune… mais toi, tu sais à quoi elle ressemble ce soir ?`} color="#e0e7ff">La lune</Title>
      <div style={{ position:"relative", width:150, height:150, marginTop:16, zIndex:2 }}>
        <MoonDisc phase={today} uid="big" style={{ width:"100%", height:"100%", animation: ok ? "lune-glow 3s ease-in-out infinite" : "none",
          opacity: ok ? 1 : 0.15, transition:"opacity 1.6s" }}/>
        {[[-30, 30, 110, 46], [40, 60, 120, 50], [-10, 80, 140, 44], [60, 10, 90, 40]].map(([x, y, w, h], i) => (
          <div key={i} aria-hidden="true" style={{ position:"absolute", left:x, top:y, width:w, height:h,
            transform: ok ? `translateX(${i % 2 ? 260 : -260}px)` : "none", opacity: ok ? 0 : .95,
            transition:"transform 2.4s ease-in, opacity 2.4s" }}>
            <div style={{ width:"100%", height:"100%", borderRadius:"50%", background:"radial-gradient(ellipse at 50% 40%, #64748b, #334155 70%)",
              boxShadow:"0 6px 20px rgba(0,0,0,.4)", animation:`lune-drift ${5 + i}s ease-in-out infinite` }}/>
          </div>
        ))}
      </div>
      <div key={tries} style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(68px, 1fr))", gap:8, marginTop:20, width:"min(94vw, 460px)",
        position:"relative", zIndex:2, animation: guess !== null && !ok ? "lune-shake .3s ease" : "none" }}>
        {LUNE_NAMES.map((n, i) => {
          const sel = guess === i;
          return (
            <button key={i} onClick={() => choose(i)} aria-label={n}
              style={{ minHeight:44, padding:"8px 4px 6px", borderRadius:12, cursor: ok ? "default" : "pointer", fontFamily:FONT,
                border:`1px solid ${sel ? (ok ? "#4ade80" : "#f87171") : "rgba(199,210,254,.25)"}`,
                background: sel && ok ? "rgba(74,222,128,.15)" : "rgba(15,23,42,.6)", color:"#e0e7ff",
                display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
              <MoonDisc phase={i} uid={`b${i}`} style={{ width:38, height:38 }}/>
              <span style={{ fontSize:10.5, lineHeight:1.15, opacity:.85 }}>{n}</span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop:12, minHeight:40, maxWidth:380, textAlign:"center", fontSize:14, fontStyle:"italic", position:"relative", zIndex:2,
        color: ok ? "#bbf7d0" : "#c7d2fe" }}>
        {ok ? `${LUNE_NAMES[today]}, exactement. Les nuages s'écartent pour toi.` : hint}
      </div>
      <Hint style={{ color:"#c7d2fe" }}>Ni calendrier ni fenêtre ? Il reste le calcul… ou l'intuition.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 20. pluie : rester au sec                                           */
/* ------------------------------------------------------------------ */

const PL_W = 400;
const PL_H = 440;
const PL_GROUND = 396;
const PL_GOAL = 15;

function Pluie() {
  const [won, win] = useWin("pluie");
  const [phase, setPhase] = useState("idle");
  const [dry, setDry] = useState(0);
  const [hit, setHit] = useState(0);
  const canvasRef = useRef(null);
  const phaseRef = useRef("idle");
  const keys = useKeys();
  const sim = useRef(null);
  phaseRef.current = phase;

  if (!sim.current) {
    sim.current = {
      px: PL_W / 2, tx: PL_W / 2, cx: PL_W / 2, dry: 0, wet: 0, spawn: 1, t: 0, flash: 0,
      rain: Array.from({ length: 140 }, () => ({ x: rand(0, PL_W), y: rand(-PL_H, PL_H), v: rand(420, 620), l: rand(8, 16) })),
      big: [], splash: [],
    };
  }

  const start = () => {
    const s = sim.current;
    s.dry = 0; s.wet = 0; s.big = []; s.spawn = 1; s.t = 0;
    setDry(0);
    phaseRef.current = "run";
    setPhase("run");
  };

  const setTarget = e => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    sim.current.tx = Math.max(20, Math.min(PL_W - 20, ((e.clientX - r.left) / r.width) * PL_W));
  };

  useLoop((dt, now) => {
    const c = canvasRef.current;
    if (!c) return;
    const s = sim.current;
    const ph = phaseRef.current;
    const run = ph === "run";
    // taille du canevas
    const cw = Math.round(c.clientWidth * (window.devicePixelRatio || 1));
    if (c.width !== cw) { c.width = cw; c.height = Math.round(cw * PL_H / PL_W); }
    const ctx = c.getContext("2d");
    const k = c.width / PL_W;
    ctx.setTransform(k, 0, 0, k, 0, 0);

    // commandes clavier
    if (keys.current.has("ArrowLeft")) s.tx = Math.max(20, s.tx - 320 * dt);
    if (keys.current.has("ArrowRight")) s.tx = Math.min(PL_W - 20, s.tx + 320 * dt);
    const dx = s.tx - s.px;
    s.px += Math.sign(dx) * Math.min(Math.abs(dx), 360 * dt);
    s.cx += (s.px - s.cx) * Math.min(1, dt * (run ? 0.9 + s.t * 0.04 : 0.4));
    s.t += dt;

    // jeu
    if (run) {
      s.spawn -= dt;
      if (s.spawn <= 0) {
        s.spawn = Math.max(0.32, 0.85 - s.t * 0.025);
        s.big.push({ x: s.cx + rand(-60, 60), y: 70, v: 120 });
      }
      if (s.wet > 0) s.wet -= dt;
      else {
        s.dry += dt;
        if (s.dry >= PL_GOAL) {
          s.dry = PL_GOAL;
          phaseRef.current = "done";
          setPhase("done");
          win();
        }
      }
      setDry(Math.floor(s.dry * 10) / 10);
    } else if (s.wet > 0) s.wet -= dt;
    if (Math.random() < dt * 0.06) s.flash = 1;
    s.flash = Math.max(0, s.flash - dt * 2.5);

    // gouttes fines : rebondissent sur le parapluie
    const uy = PL_GROUND - 70;
    for (const d of s.rain) {
      d.y += d.v * dt;
      d.x -= d.v * dt * 0.08;
      const onUmb = Math.abs(d.x - s.px) < 30 && d.y > uy - 10 && d.y < uy;
      if (onUmb || d.y > PL_GROUND) {
        if (Math.random() < 0.35) s.splash.push({ x: d.x, y: onUmb ? uy - 8 : PL_GROUND, vx: rand(-40, 40), vy: rand(-90, -40), life: 0.35 });
        d.y = rand(-60, 0);
        d.x = rand(0, PL_W + 40);
      }
    }
    // grosses gouttes
    for (const b of s.big) {
      b.v += 520 * dt;
      b.y += b.v * dt;
      if (!b.done && run && b.y > PL_GROUND - 64 && b.y < PL_GROUND && Math.abs(b.x - s.px) < 26) {
        b.done = true;
        s.dry = Math.max(0, s.dry - 3);
        s.wet = 1.1;
        setHit(h => h + 1);
        for (let i = 0; i < 14; i++) s.splash.push({ x: b.x, y: PL_GROUND - 60, vx: rand(-120, 120), vy: rand(-160, -40), life: 0.6 });
      } else if (!b.done && b.y >= PL_GROUND) {
        b.done = true;
        for (let i = 0; i < 8; i++) s.splash.push({ x: b.x, y: PL_GROUND, vx: rand(-90, 90), vy: rand(-140, -50), life: 0.5 });
      }
    }
    s.big = s.big.filter(b => !b.done);
    for (const p of s.splash) { p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    s.splash = s.splash.filter(p => p.life > 0).slice(-220);

    // dessin : ciel
    const g = ctx.createLinearGradient(0, 0, 0, PL_H);
    g.addColorStop(0, "#111827"); g.addColorStop(0.6, "#1e293b"); g.addColorStop(1, "#334155");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PL_W, PL_H);
    if (ph === "done") {
      ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"].forEach((col, i) => {
        ctx.strokeStyle = col; ctx.globalAlpha = 0.35; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(PL_W / 2, PL_GROUND + 40, 250 - i * 7, Math.PI, 2 * Math.PI); ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    // ville au loin
    ctx.fillStyle = "#0f172a";
    [[10, 300, 40], [55, 270, 34], [95, 310, 50], [150, 285, 30], [240, 260, 44], [290, 300, 38], [335, 280, 55]].forEach(([x, y, w]) => ctx.fillRect(x, y, w, PL_GROUND - y));
    ctx.fillStyle = "rgba(251,191,36,.55)";
    [[20, 315], [65, 290], [110, 325], [250, 280], [255, 300], [345, 300], [360, 320]].forEach(([x, y]) => ctx.fillRect(x, y, 6, 7));
    // nuage menacant
    ctx.fillStyle = run ? "#0b1220" : "#1f2937";
    [[-50, 40, 34], [-20, 26, 40], [18, 30, 42], [52, 42, 30], [0, 52, 36]].forEach(([ox, oy, r]) => {
      ctx.beginPath(); ctx.arc(s.cx + ox, oy, r, 0, Math.PI * 2); ctx.fill();
    });
    // pluie fine
    ctx.strokeStyle = "rgba(186,230,253,.45)"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const d of s.rain) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.08, d.y - d.l); }
    ctx.stroke();
    // sol et flaques
    ctx.fillStyle = "#0b1120";
    ctx.fillRect(0, PL_GROUND, PL_W, PL_H - PL_GROUND);
    ctx.fillStyle = "rgba(96,165,250,.18)";
    [[60, 18], [210, 26], [330, 16]].forEach(([x, w]) => { ctx.beginPath(); ctx.ellipse(x, PL_GROUND + 18, w * 2, 5, 0, 0, Math.PI * 2); ctx.fill(); });
    // ombres et grosses gouttes
    for (const b of s.big) {
      const near = Math.min(1, b.y / PL_GROUND);
      ctx.fillStyle = `rgba(0,0,0,${0.15 + near * 0.4})`;
      ctx.beginPath(); ctx.ellipse(b.x, PL_GROUND + 4, 4 + near * 12, 2 + near * 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#60a5fa";
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - 16);
      ctx.quadraticCurveTo(b.x + 9, b.y - 2, b.x, b.y + 6);
      ctx.quadraticCurveTo(b.x - 9, b.y - 2, b.x, b.y - 16);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.7)";
      ctx.beginPath(); ctx.arc(b.x - 2.5, b.y - 2, 2, 0, Math.PI * 2); ctx.fill();
    }
    // le personnage
    const x = s.px, y = PL_GROUND;
    const wet = s.wet > 0;
    const bob = Math.sin(now / 120) * (Math.abs(dx) > 2 ? 2 : 0);
    ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x - 5, y - 18); ctx.lineTo(x - 6 - bob, y); ctx.moveTo(x + 5, y - 18); ctx.lineTo(x + 6 + bob, y); ctx.stroke();
    ctx.fillStyle = wet ? "#60a5fa" : "#facc15";
    ctx.beginPath(); ctx.moveTo(x - 12, y - 16); ctx.lineTo(x - 8, y - 44); ctx.lineTo(x + 8, y - 44); ctx.lineTo(x + 12, y - 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fcd9b6";
    ctx.beginPath(); ctx.arc(x, y - 52, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1f2937";
    ctx.beginPath(); ctx.arc(x - 3, y - 53, 1.2, 0, Math.PI * 2); ctx.arc(x + 3, y - 53, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (wet) ctx.arc(x, y - 47, 2.5, Math.PI * 1.15, Math.PI * 1.85); else ctx.arc(x, y - 50, 2.5, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    // le parapluie
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 6, y - 36); ctx.lineTo(x + 6, y - 72); ctx.stroke();
    const segs = ["#f97316", "#fff7ed", "#f97316", "#fff7ed", "#f97316"];
    segs.forEach((col, i) => {
      const a0 = Math.PI + (i / segs.length) * Math.PI, a1 = Math.PI + ((i + 1) / segs.length) * Math.PI;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(x + 6, y - 72); ctx.arc(x + 6, y - 70, 32, a0, a1); ctx.closePath(); ctx.fill();
    });
    if (wet) {
      ctx.fillStyle = "#93c5fd";
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x - 8 + i * 8, y - 30 + ((now / 4 + i * 40) % 30), 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
    // eclaboussures
    ctx.fillStyle = "rgba(191,219,254,.8)";
    for (const p of s.splash) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2); ctx.fill(); }
    // eclair
    if (s.flash > 0) { ctx.fillStyle = `rgba(226,232,240,${s.flash * 0.35})`; ctx.fillRect(0, 0, PL_W, PL_H); }
  });

  const pct = Math.min(1, dry / PL_GOAL);
  return (
    <Stage won={won} wonText="Resté au sec !" font={FONT} bg="linear-gradient(180deg, #0b1120 0%, #1e293b 100%)">
      <Title sub="Une averse sur le chemin de l'atelier. Le parapluie arrête la bruine, pas les grosses gouttes.">La pluie</Title>
      <div style={{ width:"min(92vw, 440px)", marginTop:12, position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13.5, fontWeight:700, marginBottom:5 }}>
          <span>Au sec : {dry.toFixed(1)} / {PL_GOAL} s</span>
          <span style={{ fontFamily:MONO, opacity:.7, fontWeight:500 }}>{hit} plouf{hit > 1 ? "s" : ""}</span>
        </div>
        <div style={{ height:10, borderRadius:8, background:"rgba(255,255,255,.08)", overflow:"hidden" }}>
          <div style={{ width:`${pct * 100}%`, height:"100%", borderRadius:8, background:"linear-gradient(90deg, #38bdf8, #facc15)" }}/>
        </div>
      </div>
      <div style={{ position:"relative", width:"min(92vw, 440px)", marginTop:10, zIndex:2 }}>
        <canvas ref={canvasRef} onPointerMove={setTarget} onPointerDown={setTarget}
          style={{ width:"100%", aspectRatio:`${PL_W} / ${PL_H}`, display:"block", borderRadius:14, touchAction:"none",
            boxShadow:"0 20px 50px rgba(0,0,0,.55)", cursor:"ew-resize" }}/>
        {phase !== "run" && (
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            gap:10, background:"rgba(2,6,23,.45)", borderRadius:14, textAlign:"center", padding:16 }}>
            {phase === "done" && <div style={{ fontWeight:800, fontSize:18 }}>Quinze secondes au sec. Arc-en-ciel mérité 🌈</div>}
            <Btn color="#0284c7" onClick={start} style={{ minHeight:46 }}>{phase === "idle" ? "Sortir sous la pluie" : "Ressortir"}</Btn>
          </div>
        )}
      </div>
      <Hint>Le personnage suit ton doigt ou ta souris (ou les flèches). Une grosse goutte sur la tête coûte 3 secondes.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */

export const PAGES = {
  "bambulab": BambuLab,
  "pilule": Pilule,
  "coffre": Coffre,
  "labyrinthe": Labyrinthe,
  "memoire": Memoire,
  "morpion": Morpion,
  "simon": Simon,
  "pendu": Pendu,
  "calcul": Calcul,
  "piano": Piano,
  "etoiles": Etoiles,
  "chat": Chat,
  "tresor": Tresor,
  "des": Des,
  "pile-ou-face": PileOuFace,
  "morse": Morse,
  "taquin": Taquin,
  "bobine": Bobine,
  "lune": Lune,
  "pluie": Pluie,
};
