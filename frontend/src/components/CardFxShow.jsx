import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Medal } from "../pages/Achievements";
import { muted, setMuted, unlock, sBoom, sCard, sRoll, sTick, sWhoosh } from "./cardSounds";

// La fete d'une carte : elle se retourne au centre, et tout autour un effet qui
// grandit avec son rang. Valet : des confettis. Dame : plus, et des etincelles.
// Roi : des feux d'artifice et une couronne. As : arc-en-ciel, l'ecran tremble.
// Jokers : une pluie d'or, de plus en plus drue ; le Joker d'or, tout a la fois.
const RANKS = ["card_v", "card_d", "card_r", "card_a", "card_jv", "card_jd", "card_jr", "card_ja"];
const TITLES = ["Un Valet !", "Une Dame !", "Un Roi !", "Un As !", "Un Joker !", "Un Joker !", "Un Joker !", "Le Joker d'or !"];
const RAINBOW = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#d946ef"];
const GOLD = ["#FDE68A", "#FBBF24", "#D4A017", "#FFF7D6", "#B8860B"];

function useParty(canvasRef, lvl, color, go, onBoom) {
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !go) return undefined;
    const ctx = cv.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    fit();
    window.addEventListener("resize", fit);
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const k = calm ? 0.25 : 1;
    const W = () => innerWidth, H = () => innerHeight;
    const joker = lvl >= 4;
    const palette = lvl === 3 || lvl === 7 ? RAINBOW : joker ? GOLD : [color, "#ffffff", "#FBBF24", color];
    const ps = [];
    const pick = a => a[Math.floor(Math.random() * a.length)];
    // confettis : partent du bas des cotes (ou du centre), retombent en tournoyant
    const confetti = (n, from) => {
      for (let i = 0; i < n * k; i++) {
        const side = from === "center" ? 0 : Math.random() < 0.5 ? -1 : 1;
        const x = from === "center" ? W() / 2 : side < 0 ? 0 : W();
        const y = from === "center" ? H() * 0.45 : H() * 0.85;
        const a = from === "center" ? Math.random() * Math.PI * 2 : (side < 0 ? -Math.PI / 3 : -Math.PI * 2 / 3) + (Math.random() - 0.5) * 0.7;
        const v = (from === "center" ? 4 : 10) + Math.random() * (from === "center" ? 9 : 9);
        ps.push({ t:"c", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
          w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, c: pick(palette), life: 1 });
      }
    };
    // feu d'artifice : une gerbe ronde qui s'eteint
    const firework = () => {
      onBoom?.();
      const x = W() * (0.15 + Math.random() * 0.7), y = H() * (0.12 + Math.random() * 0.35), c = pick(palette);
      const n = Math.round((50 + Math.random() * 40) * k);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, v = 2 + Math.random() * 4.5;
        ps.push({ t:"s", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c, life: 1, fade: 0.012 + Math.random() * 0.01 });
      }
    };
    // pluie d'or : des pieces qui tombent du haut
    const rain = n => {
      for (let i = 0; i < n * k; i++) {
        ps.push({ t:"g", x: Math.random() * W(), y: -20 - Math.random() * H() * 0.6, vx: (Math.random() - 0.5) * 0.6,
          vy: 2 + Math.random() * 3, r: Math.random() * 6.28, vr: 0.05 + Math.random() * 0.1, s: 4 + Math.random() * 5,
          c: pick(GOLD), life: 1 });
      }
    };
    const timers = [];
    const at = (ms, f) => timers.push(setTimeout(f, ms));
    const big = [70, 110, 140, 200, 140, 170, 200, 260][lvl];
    const d0 = [600, 650, 800, 1000, 750, 800, 850, 1100][lvl];
    at(d0, () => confetti(big, "sides"));
    if (lvl >= 1) at(d0 + 450, () => confetti(Math.round(big * 0.6), "center"));
    const fw = [0, 0, 3, 6, 2, 4, 6, 10][lvl];
    for (let i = 0; i < fw; i++) at(d0 + 250 + i * (lvl === 7 ? 380 : 520), firework);
    if (joker) for (let i = 0; i < (lvl - 3); i++) at(d0 + i * 900, () => rain(lvl === 7 ? 160 : 70 + lvl * 15));
    if (lvl === 3 || lvl === 7) at(d0 + 2200, () => confetti(big, "sides"));
    let raf, last = performance.now();
    const step = now => {
      const dt = Math.min(2.5, (now - last) / 16.7);
      last = now;
      ctx.clearRect(0, 0, W(), H());
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        if (p.t === "c") {
          p.vy += 0.28 * dt; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
          if (p.y > H() + 30) p.life = 0;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.cos(p.r * 1.7));
          ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
        } else if (p.t === "s") {
          p.vy += 0.05 * dt; p.vx *= 0.97; p.vy *= 0.97; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.fade * dt;
          ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 6.28); ctx.fill(); ctx.globalAlpha = 1;
        } else {
          p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
          if (p.y > H() + 30) p.life = 0;
          ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.cos(p.r), 1);
          ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 6.28); ctx.fill();
          ctx.strokeStyle = "rgba(120,80,0,.45)"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
        }
        if (p.life <= 0) ps.splice(i, 1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); window.removeEventListener("resize", fit); };
  }, [canvasRef, lvl, color, go, onBoom]);
}

// vibration (Android) : a la mesure de la carte ; rien sur iPhone
const BUZZ = [[40], [40, 60, 40], [60, 50, 60, 50, 120], [30, 30, 30, 30, 30, 30, 220], [80, 60, 80], [80, 60, 80, 60, 80],
  [80, 60, 80, 60, 80, 60, 160], [100, 80, 100, 80, 300, 120, 300]];
const buzz = p => { try { navigator.vibrate?.(p); } catch { /* rien */ } };

// La carte inclinee sous le doigt (ou le telephone qu'on penche) : un reflet
// holographique glisse dessus. Pour l'As et les Jokers.
function useTilt(on) {
  const [t, setT] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!on) return undefined;
    const mv = e => {
      const p = e.touches?.[0] || e;
      setT({ x: (p.clientX / innerWidth - 0.5) * 2, y: (p.clientY / innerHeight - 0.5) * 2 });
    };
    const or = e => {
      if (e.gamma == null) return;
      setT({ x: Math.max(-1, Math.min(1, e.gamma / 30)), y: Math.max(-1, Math.min(1, (e.beta - 45) / 30)) });
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("touchmove", mv, { passive: true });
    window.addEventListener("deviceorientation", or);
    return () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("touchmove", mv);
      window.removeEventListener("deviceorientation", or);
    };
  }, [on]);
  return t;
}

export default function CardFxShow({ cards, onClose }) {
  const top = cards[0];
  const lvl = Math.max(0, RANKS.indexOf(top.tier.id));
  // plusieurs cartes : les petites d'abord (de la plus basse a la plus haute), la grande pour finir
  const minors = cards.slice(1).reverse();
  const [phase, setPhase] = useState(minors.length ? "minors" : "arrive");    // minors → arrive → wait → roll → show
  const [flipped, setFlipped] = useState(0);
  const [flash, setFlash] = useState(false);
  const [flipDone, setFlipDone] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [mute, setMute] = useState(muted());
  const cv = useRef(null);
  const timers = useRef([]);
  const later = (ms, f) => timers.current.push(setTimeout(f, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (phase === "arrive") later(700, () => setPhase("wait"));
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const flipDur = [1.1, 1.2, 1.5, 1.8, 1.4, 1.5, 1.6, 2.0][lvl];
  useParty(cv, lvl, top.tier.color, phase === "show", sBoom);
  const holo = lvl >= 3 && flipDone;
  const tilt = useTilt(holo);

  const reveal = () => {
    sWhoosh();
    if (lvl >= 2) later(flipDur * 550, () => { setFlash(true); later(500, () => setFlash(false)); });
    later(flipDur * 550, () => { sCard(lvl); buzz(BUZZ[lvl]); });
    later(flipDur * 1000, () => setFlipDone(true));
    later(flipDur * 1000 + 2200 + lvl * 300, () => setCanClose(true));
    setPhase("show");
  };
  const tap = () => {
    unlock();                                                  // le geste qui autorise le son
    if (phase === "minors" && flipped === 0) {
      minors.forEach((c, i) => later(i * 380, () => {
        setFlipped(i + 1); sTick(); sCard(RANKS.indexOf(c.tier.id), true); buzz([25]);
      }));
      later(minors.length * 380 + 700, () => setPhase("arrive"));
      setFlipped(0.5);
    } else if (phase === "wait") {
      if (lvl === 3 || lvl === 7) {                            // roulement de tambour : la carte tremble, puis se retourne
        setPhase("roll"); sRoll(1.2); later(1200, reveal);
      } else reveal();
    } else if (phase === "show" && canClose) onClose();
  };

  const shake = phase === "show" && (lvl === 3 || lvl === 7);
  const size = Math.min(210, Math.round(Math.min(innerHeight * 0.3, innerWidth * 0.55)));
  const glow = [0.25, 0.35, 0.5, 0.75, 0.6, 0.7, 0.8, 1][lvl];
  const waiting = phase === "wait" || phase === "roll";
  return createPortal(
    <div data-no-pull="" onClick={tap} role="dialog" aria-label="Carte gagnée"
      style={{ position:"fixed", inset:0, zIndex:6000, display:"flex", flexDirection:"column", alignItems:"center",
        justifyContent:"center", gap:14, padding:16, cursor:"pointer", userSelect:"none", WebkitUserSelect:"none",
        background: phase === "show" ? `radial-gradient(60% 50% at 50% 45%, ${top.tier.color}66, rgba(8,4,20,0.9) 70%)`
          : "radial-gradient(60% 50% at 50% 45%, rgba(139,92,246,0.25), rgba(8,4,20,0.92) 70%)",
        transition:"background .8s", animation:`bnfx-in .35s ease-out${shake ? ", bnfx-shake .5s " + flipDur * 0.55 + "s ease-in-out 2" : ""}` }}>
      <style>{`
        @keyframes bnfx-in { from { opacity:0 } to { opacity:1 } }
        @keyframes bnfx-flip { 0% { transform: rotateY(0deg) scale(1) } 55% { transform: rotateY(200deg) scale(1.15) }
          75% { transform: rotateY(170deg) scale(1) } 100% { transform: rotateY(180deg) scale(1) } }
        @keyframes bnfx-shake { 0%,100% { transform: translate(0,0) } 20% { transform: translate(-7px,3px) }
          40% { transform: translate(6px,-4px) } 60% { transform: translate(-4px,-3px) } 80% { transform: translate(3px,4px) } }
        @keyframes bnfx-spin { to { transform: rotate(360deg) } }
        @keyframes bnfx-up { from { opacity:0; transform: translateY(12px) } to { opacity:1; transform:none } }
        @keyframes bnfx-float { 0%,100% { transform: translateY(0) rotate(-2deg) } 50% { transform: translateY(-10px) rotate(2deg) } }
        @keyframes bnfx-quiver { 0%,100% { transform: translate(0,0) rotate(0) } 25% { transform: translate(-3px,1px) rotate(-3deg) }
          75% { transform: translate(3px,-1px) rotate(3deg) } }
        @keyframes bnfx-arrive { from { opacity:0; transform: translateY(-60vh) rotate(-25deg) scale(.6) } to { opacity:1; transform:none } }
        @keyframes bnfx-pulse { 0%,100% { opacity:.55 } 50% { opacity:1 } }
        @keyframes bnfx-pop { 0% { transform: rotateY(90deg) scale(.8) } 100% { transform: none } }
        @keyframes bnfx-flash { from { opacity:.9 } to { opacity:0 } }
        @keyframes bnfx-crown { 0% { opacity:0; transform: translateY(-120px) rotate(-20deg) } 70% { opacity:1; transform: translateY(6px) rotate(4deg) }
          100% { opacity:1; transform: translateY(0) rotate(0) } }
        @media (prefers-reduced-motion: reduce) { .bnfx-move { animation: none !important } }
      `}</style>
      <canvas ref={cv} aria-hidden="true" style={{ position:"fixed", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}/>
      {flash && <span aria-hidden="true" style={{ position:"fixed", inset:0, background:"#fff", pointerEvents:"none",
        animation:"bnfx-flash .5s ease-out both" }}/>}
      <button onClick={e => { e.stopPropagation(); setMute(m => { setMuted(!m); return !m; }); }}
        aria-label={mute ? "Remettre le son" : "Couper le son"} title={mute ? "Remettre le son" : "Couper le son"}
        style={{ position:"fixed", top:"calc(12px + env(safe-area-inset-top,0px))", right:12, width:38, height:38, borderRadius:"50%",
          border:"1px solid rgba(255,255,255,0.25)", background:"rgba(255,255,255,0.08)", color:"#fff", fontSize:17, cursor:"pointer" }}>
        {mute ? "🔇" : "🔊"}</button>

      {/* les petites cartes, distribuees de dos, retournees une a une */}
      {minors.length > 0 && (
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"center", maxWidth:380,
          order: phase === "minors" ? 0 : 3, transition:"all .4s" }}>
          {minors.slice(0, 12).map((c, i) => (
            <span key={c.id + (i < flipped ? "f" : "b")} title={i < flipped ? c.name : undefined} className="bnfx-move"
              style={{ display:"inline-flex", animation: i < flipped ? "bnfx-pop .35s ease-out both"
                : `bnfx-arrive .5s ${i * 0.12}s ease-out both` }}>
              <Medal tier={c.tier} emoji={c.emoji} size={phase === "minors" ? 64 : 38} locked={i >= flipped}/></span>
          ))}
        </div>
      )}
      {phase === "minors" && (
        <div style={{ fontSize:14, fontWeight:800, color:"#fff", animation:"bnfx-pulse 1.4s ease-in-out infinite", textAlign:"center" }}>
          {flipped ? `${minors.length} carte${minors.length > 1 ? "s" : ""}… et ce n'est pas fini` : "Touche pour retourner tes cartes"}</div>
      )}

      {/* la grande carte */}
      {phase !== "minors" && (
        <div style={{ position:"relative", width:size * 1.6, height:size * 1.2, display:"flex", alignItems:"center", justifyContent:"center",
          order:1, animation: phase === "arrive" ? "bnfx-arrive .7s cubic-bezier(.2,.8,.2,1) both" : "none" }}>
          {phase === "show" && lvl >= 3 && <span aria-hidden="true" className="bnfx-move" style={{ position:"absolute", width:size * 1.9,
            height:size * 1.9, borderRadius:"50%", opacity:0.6, animation:"bnfx-spin 9s linear infinite",
            background: lvl === 3 ? `conic-gradient(${RAINBOW.map((c, i) => `${c}77 ${i * 14}%, transparent ${i * 14 + 7}%`).join(", ")})`
              : `repeating-conic-gradient(${top.tier.color}99 0 8deg, transparent 8deg 20deg)`,
            WebkitMaskImage:"radial-gradient(circle, #000 35%, transparent 70%)", maskImage:"radial-gradient(circle, #000 35%, transparent 70%)" }}/>}
          {/* avant : la carte de dos flotte, son halo trahit un peu son rang ; au roulement, elle tremble */}
          <div className="bnfx-move" style={{ position:"relative", width:size, height:size,
            animation: phase === "wait" ? "bnfx-float 2.4s ease-in-out infinite" : phase === "roll" ? "bnfx-quiver .09s linear infinite" : "none",
            filter: waiting ? `drop-shadow(0 0 ${size * 0.06 + size * 0.14 * glow}px rgba(253,230,138,${0.3 + glow * 0.5}))` : "none" }}>
            <div style={{ position:"absolute", inset:0, perspective:900 }}>
              <div style={{ position:"absolute", inset:0, transformStyle:"preserve-3d",
                transform: holo ? `rotateY(${180 + tilt.x * 16}deg) rotateX(${-tilt.y * 12}deg)` : phase === "show" ? "rotateY(180deg)" : "none",
                transition: holo ? "transform .12s ease-out" : "none",
                animation: phase === "show" && !flipDone ? `bnfx-flip ${flipDur}s cubic-bezier(.2,.8,.2,1) both` : "none" }}>
                <span style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden" }}>
                  <Medal tier={top.tier} emoji="" size={size} locked/></span>
                <span style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden",
                  transform:"rotateY(180deg)", filter:`drop-shadow(0 0 ${size / 8}px ${top.tier.color})` }}>
                  <Medal tier={top.tier} emoji={top.emoji} size={size}/>
                  {/* reflet holographique (As, Jokers) */}
                  {holo && <span aria-hidden="true" style={{ position:"absolute", top:0, left: size * 0.14, width: Math.round(size * 0.72),
                    height:size, borderRadius: size * 0.11, pointerEvents:"none", mixBlendMode:"color-dodge", opacity:0.75,
                    background:"linear-gradient(115deg, transparent 20%, rgba(255,0,170,.55) 32%, rgba(0,229,255,.55) 42%, " +
                      "rgba(255,255,0,.55) 52%, rgba(120,255,120,.45) 60%, transparent 72%)",
                    backgroundSize:"260% 260%", backgroundPosition:`${50 + tilt.x * 45}% ${50 + tilt.y * 45}%` }}/>}
                </span>
              </div>
            </div>
          </div>
          {phase === "show" && (lvl === 2 || lvl === 6 || lvl === 7) && <span aria-hidden="true" className="bnfx-move" style={{ position:"absolute",
            top: -size * 0.1, fontSize: size * 0.28, animation:`bnfx-crown .8s ${flipDur * 0.9}s ease-out both` }}>👑</span>}
        </div>
      )}
      {waiting && (
        <div style={{ order:2, fontSize:14, fontWeight:800, color:"#fff", textAlign:"center",
          animation: phase === "wait" ? "bnfx-pulse 1.4s ease-in-out infinite" : "none" }}>
          {phase === "roll" ? "…" : "🃏 Une carte t'attend · touche-la pour la retourner"}</div>
      )}
      {phase === "show" && (
        <div style={{ order:2, textAlign:"center", animation:`bnfx-up .5s ${flipDur * 0.8}s ease-out both` }}>
          <div style={{ fontSize:13, fontWeight:900, letterSpacing:".14em", textTransform:"uppercase",
            color: lvl >= 4 ? "#FDE68A" : "#fff", textShadow:`0 0 12px ${top.tier.color}` }}>🃏 {TITLES[lvl]}</div>
          <div style={{ fontSize:22, fontWeight:900, color:"#fff", marginTop:4 }}>{top.name}</div>
          {holo && <div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", marginTop:4 }}>Penche-la, elle brille</div>}
        </div>
      )}
      <span style={{ order:4, fontSize:11.5, color:"rgba(255,255,255,0.6)", opacity: canClose ? 1 : 0, transition:"opacity .4s" }}>
        Touche pour continuer</span>
    </div>, document.body);
}
