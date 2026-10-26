import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GRADES, ROMAN, GRADE_METAL, GradeEmblem } from "./medals";
import { unlock, sGrade, sWhoosh, sTick, muted, setMuted } from "./cardSounds";

// La fete des grades (26/10/2026), en grand, comme celle des cartes. Un ecusson scelle attend qu'on le touche
// (le son ne peut partir qu'apres un geste) ; puis :
//  - un nouvel echelon (Curieux II…) : l'ecusson jaillit, une onde, les etoiles d'echelon s'allument ;
//  - un nouveau grade (Bidouilleur I…) : l'ancien ecusson se brise, un eclair, l'onde de choc, le nouveau
//    s'abat en tournant devant des rayons, pluie de confettis aux couleurs du metal, « PROMOTION ! ».
// La legende (le dernier grade) a ses rayons arc-en-ciel.
const buzz = p => { try { navigator.vibrate?.(p); } catch { /* rien */ } };
const nameOf = l => l < 0 ? null : `${GRADES._[Math.floor(l / 3)]} ${ROMAN[l % 3]}`;
const RAINBOW = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#d946ef"];

const CSS = `
@keyframes gfx-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes gfx-breathe { 0%,100% { transform: scale(1); filter: brightness(1) } 50% { transform: scale(1.06); filter: brightness(1.25) } }
@keyframes gfx-shatter { 0% { transform: scale(1); opacity: 1; filter: blur(0) } 60% { transform: scale(1.25) rotate(-6deg); opacity: .9; filter: blur(1px) }
  100% { transform: scale(1.9) rotate(8deg); opacity: 0; filter: blur(10px) } }
@keyframes gfx-shard { from { transform: translate(0,0) rotate(0); opacity: 1 } to { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); opacity: 0 } }
@keyframes gfx-flash { 0% { opacity: 0 } 15% { opacity: .95 } 100% { opacity: 0 } }
@keyframes gfx-slam { 0% { transform: scale(2.6) rotateY(0deg); opacity: 0 } 55% { transform: scale(.9) rotateY(330deg); opacity: 1 }
  75% { transform: scale(1.08) rotateY(360deg) } 100% { transform: scale(1) rotateY(360deg) } }
@keyframes gfx-pop { 0% { transform: scale(.3); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
@keyframes gfx-ring { from { transform: translate(-50%,-50%) scale(.2); opacity: .9 } to { transform: translate(-50%,-50%) scale(3.2); opacity: 0 } }
@keyframes gfx-rays { to { transform: translate(-50%,-50%) rotate(360deg) } }
@keyframes gfx-confetti { 0% { transform: translate(0,0) rotate(0); opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); opacity: 0 } }
@keyframes gfx-letter { 0% { transform: translateY(18px) scale(.6); opacity: 0 } 70% { transform: translateY(-4px) scale(1.12); opacity: 1 } 100% { transform: none; opacity: 1 } }
@keyframes gfx-shine { 0% { background-position: -150% 0 } 100% { background-position: 250% 0 } }
@keyframes gfx-star { 0% { transform: scale(0) rotate(-90deg); opacity: 0 } 70% { transform: scale(1.4) rotate(10deg); opacity: 1 } 100% { transform: scale(1) rotate(0) } }
@keyframes gfx-up { from { transform: translateY(14px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes gfx-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
@keyframes bn-grade-sweep { 0%, 55% { transform: translateX(0) skewX(-20deg) } 100% { transform: translateX(80px) skewX(-20deg) } }
@media (prefers-reduced-motion: reduce) { .gfx * { animation-duration: .01s !important; animation-iteration-count: 1 !important } }
`;

export default function GradeFxShow({ from, to, score, scoreMax, onClose }) {
  const i = Math.floor(to / 3), sub = to % 3, m = GRADE_METAL[i];
  const promo = from < 0 || Math.floor(from / 3) < i, legend = i === 4;
  const oldI = from >= 0 ? Math.floor(from / 3) : -1;
  const [phase, setPhase] = useState("sealed");       // sealed -> (break) -> reveal -> done
  const [mute, setMute] = useState(muted());
  const ts = useRef([]);
  const later = (ms, f) => ts.current.push(setTimeout(f, ms));
  useEffect(() => () => ts.current.forEach(clearTimeout), []);
  const W = typeof window !== "undefined" ? window.innerWidth : 400;
  const emb = Math.min(170, W * 0.38);

  const go = () => {
    if (phase !== "sealed") return;
    unlock();
    if (promo && oldI >= 0) {
      setPhase("break"); sWhoosh(); buzz([30]);
      later(650, () => { setPhase("reveal"); sGrade(true, legend); buzz([60, 40, 120]); });
    } else {
      setPhase("reveal"); sGrade(promo, legend); buzz(promo ? [60, 40, 120] : [40]);
    }
    later(promo ? 3200 : 2200, () => setPhase("done"));
    [0, 1, 2].forEach(k => k <= sub && later((promo ? 2000 : 1100) + k * 260, () => sTick()));
  };

  // les confettis et les eclats : tires une fois
  const confetti = useMemo(() => Array.from({ length: promo ? 90 : 36 }, (_, k) => {
    const a = Math.random() * Math.PI * 2, d = (promo ? 260 : 170) + Math.random() * (promo ? 320 : 160);
    const pal = legend ? RAINBOW : [m.a, m.b, "#fde68a", "#ffffff"];
    return { k, dx: Math.cos(a) * d, dy: Math.sin(a) * d + 120 + Math.random() * 160, r: (Math.random() * 720 - 360) | 0,
      c: pal[k % pal.length], w: 5 + Math.random() * 7, h: 8 + Math.random() * 10, delay: Math.random() * 0.25, dur: 1.4 + Math.random() * 1.3 };
  }), [promo, legend, m.a, m.b]);
  const shards = useMemo(() => Array.from({ length: 14 }, (_, k) => {
    const a = (k / 14) * Math.PI * 2;
    return { k, dx: Math.cos(a) * (90 + Math.random() * 90), dy: Math.sin(a) * (90 + Math.random() * 90), r: (Math.random() * 540 - 270) | 0 };
  }), []);

  const revealed = phase === "reveal" || phase === "done";
  const title = promo ? (legend ? "LÉGENDE !" : "PROMOTION !") : "NOUVEL ÉCHELON";
  const name = nameOf(to);
  const pct = scoreMax ? Math.round(100 * score / scoreMax) : 0;
  const metalText = { backgroundImage: legend ? `linear-gradient(90deg, ${RAINBOW.join(",")})`
    : `linear-gradient(100deg, ${m.b} 0%, ${m.a} 35%, #ffffff 50%, ${m.a} 65%, ${m.b} 100%)`, backgroundSize: "250% 100%",
    WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "gfx-shine 2.6s linear infinite" };

  return createPortal(
    <div className="gfx" onClick={() => { if (phase === "sealed") go(); else if (phase === "done") onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
        cursor: phase === "sealed" || phase === "done" ? "pointer" : "default", userSelect: "none", WebkitTapHighlightColor: "transparent",
        background: `radial-gradient(60% 50% at 50% 45%, ${m.b}55, transparent 70%), rgba(2,6,23,.93)`, animation: "gfx-in .35s ease-out" }}>
      <style>{CSS}</style>
      <button onClick={e => { e.stopPropagation(); setMuted(!mute); setMute(!mute); }} aria-label={mute ? "Remettre le son" : "Couper le son"}
        style={{ position: "absolute", top: 14, right: 14, width: 38, height: 38, borderRadius: 12, border: "1px solid rgba(255,255,255,.2)",
          background: "rgba(255,255,255,.08)", color: "#fff", fontSize: 16, cursor: "pointer", zIndex: 5 }}>{mute ? "🔇" : "🔊"}</button>

      {/* les rayons, derriere l'ecusson */}
      {revealed && <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "42%", width: emb * 5, height: emb * 5, borderRadius: "50%",
        transform: "translate(-50%,-50%)", opacity: promo ? 0.55 : 0.3, animation: `gfx-rays ${promo ? 14 : 22}s linear infinite, gfx-in .8s ease-out`,
        background: `repeating-conic-gradient(from 0deg, ${legend ? "rgba(217,70,239,.55)" : `${m.a}aa`} 0deg 6deg, transparent 6deg 18deg)`,
        WebkitMask: "radial-gradient(circle, #000 15%, transparent 65%)", mask: "radial-gradient(circle, #000 15%, transparent 65%)" }}/>}

      {/* les ondes */}
      {revealed && [0, 1, promo ? 2 : null].filter(x => x != null).map(k => (
        <span key={k} aria-hidden="true" style={{ position: "absolute", left: "50%", top: "42%", width: emb * 1.4, height: emb * 1.4, borderRadius: "50%",
          border: `${promo ? 4 : 3}px solid ${legend ? RAINBOW[k * 2] : m.a}`, boxShadow: `0 0 24px ${m.a}`,
          animation: `gfx-ring ${promo ? 1.3 : 1.1}s cubic-bezier(.2,.7,.3,1) ${(promo ? 0.15 : 0.05) + k * 0.22}s both` }}/>))}

      {/* l'eclair d'un nouveau grade */}
      {revealed && promo && <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "#fff", pointerEvents: "none", animation: "gfx-flash .55s ease-out both" }}/>}

      {/* les confettis */}
      {revealed && <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "42%" }}>
        {confetti.map(p => <span key={p.k} style={{ position: "absolute", width: p.w, height: p.h, borderRadius: 2, background: p.c,
          "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--r": `${p.r}deg`,
          animation: `gfx-confetti ${p.dur}s cubic-bezier(.15,.6,.35,1) ${(promo ? 0.25 : 0.1) + p.delay}s both` }}/>)}
      </div>}

      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "0 20px", maxWidth: 520, textAlign: "center" }}>
        {/* l'ecusson : scelle, ou l'ancien qui se brise, puis le nouveau */}
        <div style={{ position: "relative", width: emb * 1.2, height: emb * 1.3, display: "flex", alignItems: "center", justifyContent: "center", perspective: 800 }}>
          {phase === "sealed" && <div style={{ animation: "gfx-breathe 1.6s ease-in-out infinite", filter: `drop-shadow(0 0 22px ${m.a})` }}>
            <GradeEmblem i={promo && oldI >= 0 ? oldI : i} size={emb}/></div>}
          {phase === "break" && <>
            <div style={{ animation: "gfx-shatter .65s ease-in both" }}><GradeEmblem i={oldI} size={emb}/></div>
            {shards.map(s => <span key={s.k} aria-hidden="true" style={{ position: "absolute", width: 10, height: 14, background: GRADE_METAL[oldI].a,
              clipPath: "polygon(50% 0, 100% 60%, 30% 100%, 0 40%)", "--dx": `${s.dx}px`, "--dy": `${s.dy}px`, "--r": `${s.r}deg`,
              animation: "gfx-shard .65s ease-out both" }}/>)}
          </>}
          {revealed && <div style={{ animation: `${promo ? "gfx-slam 1.1s cubic-bezier(.2,.8,.2,1)" : "gfx-pop .7s cubic-bezier(.2,.8,.2,1)"} both${phase === "done" ? ", gfx-float 3s ease-in-out 1.2s infinite" : ""}`,
            filter: `drop-shadow(0 0 ${promo ? 34 : 22}px ${legend ? "#d946ef" : m.a})`, transformStyle: "preserve-3d" }}>
            <GradeEmblem i={i} size={emb}/></div>}
        </div>

        {phase === "sealed" && <div style={{ animation: "gfx-up .5s ease-out .2s both", color: "#e2e8f0" }}>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: ".18em", color: m.a }}>TON GRADE DE MAKER</div>
          <div style={{ fontSize: 20, fontWeight: 900, marginTop: 6 }}>{promo ? "Quelque chose de grand t'attend…" : "Tu as franchi un cap…"}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginTop: 8 }}>Touche pour découvrir</div>
        </div>}

        {revealed && <>
          <div aria-label={title} style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 1, fontSize: promo ? 34 : 24, fontWeight: 900,
            letterSpacing: ".06em", lineHeight: 1 }}>
            {[...title].map((ch, k) => <span key={k} style={{ display: "inline-block", whiteSpace: "pre", ...metalText,
              animation: `gfx-letter .5s cubic-bezier(.2,.8,.2,1) ${(promo ? 0.9 : 0.35) + k * 0.045}s both, gfx-shine 2.6s linear infinite` }}>{ch}</span>)}
          </div>
          <div style={{ fontSize: promo ? 30 : 26, fontWeight: 900, color: "#fff", animation: `gfx-up .6s ease-out ${promo ? 1.5 : 0.8}s both`,
            textShadow: `0 0 18px ${m.a}aa` }}>{name}</div>
          {/* les echelons du grade : trois etoiles, celles gagnees s'allument */}
          <div style={{ display: "flex", gap: 10, animation: `gfx-up .4s ease-out ${promo ? 1.8 : 0.95}s both` }}>
            {[0, 1, 2].map(k => <span key={k} style={{ fontSize: 30, lineHeight: 1, display: "inline-block",
              color: k <= sub ? undefined : "rgba(255,255,255,.18)", ...(k <= sub ? { ...metalText, filter: `drop-shadow(0 0 8px ${m.a})` } : {}),
              animation: k <= sub ? `gfx-star .55s cubic-bezier(.2,.8,.2,1) ${(promo ? 2.0 : 1.1) + k * 0.26}s both, gfx-shine 2.6s linear infinite` : undefined }}>★</span>)}
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#cbd5e1", lineHeight: 1.5, animation: `gfx-up .6s ease-out ${promo ? 2.5 : 1.6}s both` }}>
            {from >= 0 ? <>{nameOf(from)} → <b style={{ color: "#fff" }}>{name}</b></> : <>Ton tout premier grade : <b style={{ color: "#fff" }}>{name}</b></>}
            <br/><span style={{ color: "#94a3b8" }}>{score.toLocaleString("fr-FR")} pts · {pct} % de tous les points · métal {m.name.toLowerCase()}</span>
          </div>
          {phase === "done" && <div style={{ fontSize: 12.5, fontWeight: 800, color: "#94a3b8", animation: "gfx-up .5s ease-out both" }}>Touche pour continuer</div>}
        </>}
      </div>
    </div>,
    document.body);
}
