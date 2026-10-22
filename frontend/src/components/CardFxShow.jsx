import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Medal } from "../pages/Achievements";

// La fete d'une carte : elle se retourne au centre, et tout autour un effet qui
// grandit avec son rang. Valet : des confettis. Dame : plus, et des etincelles.
// Roi : des feux d'artifice et une couronne. As : arc-en-ciel, l'ecran tremble.
// Jokers : une pluie d'or, de plus en plus drue ; le Joker d'or, tout a la fois.
const RANKS = ["card_v", "card_d", "card_r", "card_a", "card_jv", "card_jd", "card_jr", "card_ja"];
const TITLES = ["Un Valet !", "Une Dame !", "Un Roi !", "Un As !", "Un Joker !", "Un Joker !", "Un Joker !", "Le Joker d'or !"];
const RAINBOW = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#d946ef"];
const GOLD = ["#FDE68A", "#FBBF24", "#D4A017", "#FFF7D6", "#B8860B"];

function useParty(canvasRef, lvl, color) {
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
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
    at(450, () => confetti(big, "sides"));
    if (lvl >= 1) at(900, () => confetti(Math.round(big * 0.6), "center"));
    const fw = [0, 0, 3, 6, 2, 4, 6, 10][lvl];
    for (let i = 0; i < fw; i++) at(700 + i * (lvl === 7 ? 380 : 520), firework);
    if (joker) for (let i = 0; i < (lvl - 3); i++) at(500 + i * 900, () => rain(lvl === 7 ? 160 : 70 + lvl * 15));
    if (lvl === 3 || lvl === 7) at(2600, () => confetti(big, "sides"));
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
  }, [canvasRef, lvl, color]);
}

export default function CardFxShow({ cards, onClose }) {
  const top = cards[0];
  const lvl = Math.max(0, RANKS.indexOf(top.tier.id));
  const cv = useRef(null);
  const [canClose, setCanClose] = useState(false);
  useParty(cv, lvl, top.tier.color);
  useEffect(() => {
    const a = setTimeout(() => setCanClose(true), 1200);
    const b = setTimeout(onClose, 9000 + lvl * 800);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [lvl, onClose]);
  const shake = lvl === 3 || lvl === 7;
  const rays = lvl >= 3;
  const size = Math.min(200, Math.round(innerHeight * 0.26));
  return createPortal(
    <div data-no-pull="" onClick={() => canClose && onClose()} role="dialog" aria-label="Carte gagnée"
      style={{ position:"fixed", inset:0, zIndex:6000, display:"flex", flexDirection:"column", alignItems:"center",
        justifyContent:"center", gap:14, padding:16, cursor: canClose ? "pointer" : "default",
        background:`radial-gradient(60% 50% at 50% 45%, ${top.tier.color}55, rgba(8,4,20,0.88) 70%)`,
        animation:`bnfx-in .35s ease-out${shake ? ", bnfx-shake .5s 1.05s ease-in-out 2" : ""}` }}>
      <style>{`
        @keyframes bnfx-in { from { opacity:0 } to { opacity:1 } }
        @keyframes bnfx-flip { 0% { transform: rotateY(0deg) scale(.35) } 55% { transform: rotateY(200deg) scale(1.1) }
          75% { transform: rotateY(170deg) scale(1) } 100% { transform: rotateY(180deg) scale(1) } }
        @keyframes bnfx-shake { 0%,100% { transform: translate(0,0) } 20% { transform: translate(-6px,3px) }
          40% { transform: translate(5px,-4px) } 60% { transform: translate(-4px,-2px) } 80% { transform: translate(3px,4px) } }
        @keyframes bnfx-spin { to { transform: rotate(360deg) } }
        @keyframes bnfx-up { from { opacity:0; transform: translateY(12px) } to { opacity:1; transform:none } }
        @keyframes bnfx-crown { 0% { opacity:0; transform: translateY(-120px) rotate(-20deg) } 70% { opacity:1; transform: translateY(6px) rotate(4deg) }
          100% { opacity:1; transform: translateY(0) rotate(0) } }
        @media (prefers-reduced-motion: reduce) { .bnfx-move { animation: none !important } }
      `}</style>
      <canvas ref={cv} aria-hidden="true" style={{ position:"fixed", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}/>
      <div style={{ position:"relative", width:size * 1.6, height:size * 1.2, display:"flex", alignItems:"center", justifyContent:"center" }}>
        {rays && <span aria-hidden="true" className="bnfx-move" style={{ position:"absolute", width:size * 1.9, height:size * 1.9, borderRadius:"50%",
          opacity:0.55, animation:"bnfx-spin 9s linear infinite",
          background: lvl === 3 ? `conic-gradient(${RAINBOW.map((c, i) => `${c}66 ${i * 14}%, transparent ${i * 14 + 7}%`).join(", ")})`
            : `repeating-conic-gradient(${top.tier.color}88 0 8deg, transparent 8deg 20deg)`,
          WebkitMaskImage:"radial-gradient(circle, #000 35%, transparent 70%)", maskImage:"radial-gradient(circle, #000 35%, transparent 70%)" }}/>}
        <div className="bnfx-move" style={{ position:"relative", width:size, height:size, transformStyle:"preserve-3d",
          animation:"bnfx-flip 1.1s cubic-bezier(.2,.8,.2,1) both", transform:"rotateY(180deg)" }}>
          {/* dos, puis face : la carte se retourne */}
          <span style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden" }}>
            <Medal tier={top.tier} emoji="" size={size} locked/></span>
          <span style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden",
            transform:"rotateY(180deg)", filter:`drop-shadow(0 0 ${size / 8}px ${top.tier.color})` }}>
            <Medal tier={top.tier} emoji={top.emoji} size={size}/></span>
        </div>
        {(lvl === 2 || lvl === 6 || lvl === 7) && <span aria-hidden="true" className="bnfx-move" style={{ position:"absolute",
          top: -size * 0.1, fontSize: size * 0.28, animation:"bnfx-crown .8s 1.1s ease-out both" }}>👑</span>}
      </div>
      <div style={{ textAlign:"center", animation:"bnfx-up .5s .9s ease-out both" }}>
        <div style={{ fontSize:13, fontWeight:900, letterSpacing:".14em", textTransform:"uppercase",
          color: lvl >= 4 ? "#FDE68A" : "#fff", textShadow:`0 0 12px ${top.tier.color}` }}>🃏 {TITLES[lvl]}</div>
        <div style={{ fontSize:22, fontWeight:900, color:"#fff", marginTop:4 }}>{top.name}</div>
      </div>
      {cards.length > 1 && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, animation:"bnfx-up .5s 1.3s ease-out both" }}>
          <span style={{ fontSize:12, color:"#e9e3ff" }}>et aussi {cards.length - 1} autre{cards.length > 2 ? "s" : ""} carte{cards.length > 2 ? "s" : ""}</span>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center", maxWidth:360 }}>
            {cards.slice(1, 13).map(c => <span key={c.id} title={c.name}><Medal tier={c.tier} emoji={c.emoji} size={38}/></span>)}
          </div>
        </div>
      )}
      <span style={{ fontSize:11.5, color:"rgba(255,255,255,0.6)", opacity: canClose ? 1 : 0, transition:"opacity .4s" }}>
        Touche pour continuer</span>
    </div>, document.body);
}
