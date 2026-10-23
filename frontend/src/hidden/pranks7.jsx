import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

// Une farce faite pour une seule maison : un grand merci, une pluie d'argent, un recu qui
// s'imprime, puis le tampon. Une vingtaine de secondes, impossible a passer : ni bouton, ni Echap, ni clic ;
// tant qu'elle n'est pas allee au bout, elle revient a l'ouverture suivante.
const CSS = `
@keyframes pk7-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes pk7-fall { from { transform: translate(0, -12vh) rotate(0deg) } to { transform: translate(var(--dx), 112vh) rotate(var(--rot)) } }
@keyframes pk7-pop { 0% { transform: scale(.4) rotate(-6deg); opacity: 0 } 60% { transform: scale(1.06) rotate(1deg); opacity: 1 } 100% { transform: scale(1) rotate(0) } }
@keyframes pk7-shine { from { background-position: -200% 0 } to { background-position: 200% 0 } }
@keyframes pk7-line { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes pk7-paper { from { max-height: 0 } to { max-height: 420px } }
@keyframes pk7-stamp { 0% { transform: translate(-50%, -50%) scale(3.2) rotate(-24deg); opacity: 0 } 55% { transform: translate(-50%, -50%) scale(.92) rotate(-12deg); opacity: 1 }
  75% { transform: translate(-50%, -50%) scale(1.05) rotate(-12deg) } 100% { transform: translate(-50%, -50%) scale(1) rotate(-12deg); opacity: 1 } }
@keyframes pk7-shake { 0%, 100% { transform: translate(0, 0) } 20% { transform: translate(-7px, 4px) } 40% { transform: translate(6px, -5px) } 60% { transform: translate(-4px, 3px) } 80% { transform: translate(3px, -2px) } }
@keyframes pk7-glow { 0%, 100% { box-shadow: 0 0 40px rgba(250,204,21,.35), 0 30px 80px rgba(0,0,0,.5) } 50% { box-shadow: 0 0 80px rgba(250,204,21,.7), 0 30px 80px rgba(0,0,0,.5) } }
@keyframes pk7-pouf { 0% { transform: translate(-50%, -50%) scale(.1); opacity: 0 } 35% { opacity: 1 } 100% { transform: translate(-50%, -50%) scale(4.5); opacity: 0 } }
@keyframes pk7-wink { 0%, 100% { transform: rotate(0) } 25% { transform: rotate(-8deg) } 75% { transform: rotate(8deg) } }
`;
const RECU = [
  ["REÇU N° 0042-B", true],
  ["Donateur", "toi, évidemment"],
  ["Bénéficiaire", "BambuNymous"],
  ["Objet", "soutien moral et filament"],
  ["Montant", "500,00 €"],
  ["TVA", "0 € (on n'est pas des monstres)"],
  ["Statut", "MERCI ❤️"],
];
// d'abord la secousse : l'ecran tremble, le telephone vibre, les tuiles s'effondrent, et pouf ; puis la scene
const INTRO = 3600, POUF = 3000;
const T = Object.fromEntries(Object.entries({ card: 1300, count: 2000, paper: 4200, line: 650, stamp: 10600, nudge: 13600, close: 16200, end: 21000 })
  .map(([k, v]) => [k, k === "line" ? v : v + INTRO]));
const buzz = p => { try { navigator.vibrate?.(p); } catch { /* pas de vibreur */ } };

export function MerciDon({ done }) {
  const [t, setT] = useState(0);                       // le temps ecoule, par paliers
  const [n, setN] = useState(0);                       // le montant qui monte
  const [gone, setGone] = useState(false);
  const money = useMemo(() => Array.from({ length: 70 }, (_, i) => ({ left: Math.random() * 100, delay: Math.random() * 14,
    dur: 3.2 + Math.random() * 3, dx: `${Math.round(Math.random() * 120 - 60)}px`, rot: `${Math.round(Math.random() * 900 - 450)}deg`,
    e: ["🪙", "💶", "💸", "🪙", "💰", "💶"][i % 6], size: 22 + Math.random() * 20 })), []);
  useEffect(() => {
    // ni Echap ni raccourci clavier pendant la farce
    const k = e => { e.preventDefault(); e.stopPropagation(); };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);
  // la secousse sur la vraie page, puis l'effondrement des tuiles ; tout est remis en place a la fin
  useEffect(() => {
    const main = document.querySelector("main.page-content") || document.body;
    const anims = [], timers = [];
    const shake = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ transform: i === 8 ? "none" : `translate(${(i % 2 ? 1 : -1) * (4 + i * 1.6)}px, ${(i % 3 - 1) * (3 + i)}px) rotate(${(i % 2 ? .4 : -.4) * (1 + i / 4)}deg)` }));
    try { anims.push(main.animate(shake, { duration: 1700, easing: "linear" })); } catch { /* sans animations */ }
    buzz([180, 70, 180, 70, 260, 60, 420]);
    timers.push(setTimeout(() => {
      buzz([350, 90, 600]);
      [...main.querySelectorAll(".card")].slice(0, 60).forEach((el, i) => {
        try { anims.push(el.animate([{ transform: "none" }, { transform: `translateY(${110 + Math.random() * 40}vh) rotate(${Math.round(Math.random() * 120 - 60)}deg)` }],
          { duration: 900 + Math.random() * 600, delay: (i % 12) * 55 + Math.random() * 120, easing: "cubic-bezier(.55,0,.9,.45)", fill: "forwards" })); } catch { /* rien */ }
      });
    }, 1500));
    timers.push(setTimeout(() => buzz([90]), POUF));
    return () => { timers.forEach(clearTimeout); anims.forEach(a => { try { a.cancel(); } catch { /* rien */ } }); };
  }, []);
  useEffect(() => {
    const start = Date.now();
    const iv = setInterval(() => {
      const el = Date.now() - start;
      setT(el);
      if (el >= T.count) setN(Math.min(500, Math.round(500 * Math.min(1, (el - T.count) / 1800) ** .6)));
      if (el >= T.end) { clearInterval(iv); finish(); }
    }, 60);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = () => { setGone(true); setTimeout(() => done?.(), 500); };
  const lines = Math.max(0, Math.min(RECU.length, Math.floor((t - T.paper) / T.line) + 1));
  return createPortal(
    <div role="dialog" aria-label="Merci pour ton don" onClickCapture={e => { e.preventDefault(); e.stopPropagation(); }}
      onTouchMoveCapture={e => e.stopPropagation()} style={{ touchAction: "none", position: "fixed", inset: 0, zIndex: 9990, overflow: "hidden",
      background: t >= POUF ? "radial-gradient(circle at 50% 40%, rgba(66,32,6,.86), rgba(2,6,23,.94))" : "transparent",
      opacity: gone ? 0 : 1, transition: "opacity .5s ease, background .5s ease", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <style>{CSS}</style>
      {/* pouf : un nuage blanc qui balaie l'ecran */}
      {t >= POUF && t < INTRO + 900 && <><span aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: "60vmax", height: "60vmax", borderRadius: "50%",
        background: "radial-gradient(circle, #fff 0 30%, rgba(255,255,255,.7) 45%, transparent 70%)", animation: "pk7-pouf 1.1s ease-out both", pointerEvents: "none" }}/>
        <span aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: 90, animation: "pk7-pop .5s ease both" }}>💥</span></>}
      {/* la pluie d'argent */}
      {t >= INTRO && money.map((m, i) => <span key={i} aria-hidden="true" style={{ position: "absolute", top: 0, left: `${m.left}%`, fontSize: m.size, "--dx": m.dx, "--rot": m.rot,
        animation: `pk7-fall ${m.dur}s linear ${m.delay}s both`, filter: "drop-shadow(0 4px 6px rgba(0,0,0,.4))" }}>{m.e}</span>)}
      {/* la secousse du tampon sur une enveloppe a part : changer les animations de la carte les relancerait toutes */}
      {t >= T.card && <div style={{ width: "min(460px, 100%)", animation: t >= T.stamp && t < T.stamp + 700 ? "pk7-shake .5s ease" : "none" }}>
      <div style={{ position: "relative", width: "100%", boxSizing: "border-box", borderRadius: 26, padding: "22px 20px 20px", textAlign: "center",
        color: "#3b2a05", animation: "pk7-pop .9s cubic-bezier(.3,1.4,.5,1) both, pk7-glow 2.4s ease-in-out 1s infinite",
        background: "linear-gradient(110deg, #fde68a 0%, #facc15 30%, #fff7cc 45%, #facc15 60%, #eab308 100%)", backgroundSize: "200% 100%" }}>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: 26, pointerEvents: "none", mixBlendMode: "overlay",
          background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,.75) 50%, transparent 70%)", backgroundSize: "200% 100%",
          animation: "pk7-shine 3s linear infinite" }}/>
        <div style={{ fontSize: 44, lineHeight: 1 }}>💸</div>
        <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6, letterSpacing: "-.01em" }}>Merci infiniment !</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>pour ton don de</div>
        <div style={{ fontSize: 46, fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", textShadow: "0 2px 0 rgba(255,255,255,.5)" }}>{n} €</div>
        {/* le recu qui sort de l'imprimante */}
        {t >= T.paper && <div style={{ margin: "14px auto 0", width: "min(330px, 100%)", overflow: "hidden", animation: "pk7-paper 4s ease-out both" }}>
          <div style={{ background: "#fffdf5", color: "#1f2937", borderRadius: 6, padding: "10px 14px 12px", textAlign: "left",
            fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 12.5, lineHeight: 1.7,
            boxShadow: "inset 0 -10px 12px -10px rgba(0,0,0,.25)",
            WebkitMaskImage: "linear-gradient(#000 calc(100% - 8px), transparent)", maskImage: "linear-gradient(#000 calc(100% - 8px), transparent)" }}>
            {RECU.slice(0, lines).map(([k, v], i) => <div key={k} style={{ animation: "pk7-line .55s steps(18) both", display: "flex", gap: 8,
              ...(v === true ? { justifyContent: "center", fontWeight: 900, borderBottom: "1px dashed #9ca3af", paddingBottom: 3, marginBottom: 3 } : {}),
              ...(i === 4 ? { fontWeight: 900, fontSize: 14 } : {}) }}>
              {v === true ? k : <><span style={{ color: "#6b7280", minWidth: 92 }}>{k}</span><span style={{ flex: 1, textAlign: "right" }}>{v}</span></>}</div>)}
          </div>
        </div>}
        {/* le tampon */}
        {t >= T.stamp && <div style={{ position: "absolute", left: "50%", top: "56%", zIndex: 2, padding: "8px 16px", borderRadius: 12, whiteSpace: "nowrap",
          border: "4px solid #dc2626", color: "#dc2626", background: "rgba(255,255,255,.82)", fontSize: "clamp(20px, 6vw, 30px)", fontWeight: 900,
          letterSpacing: ".04em", textTransform: "uppercase", animation: "pk7-stamp .55s cubic-bezier(.3,1.3,.6,1) both",
          boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}>…mais fallait pas ! <span style={{ display: "inline-block", animation: "pk7-wink 1s ease-in-out .6s 3" }}>😏</span></div>}
        {t >= T.nudge && <div style={{ marginTop: 14, fontSize: 16, fontWeight: 800, animation: "pk7-pop .7s ease both" }}>
          Bon… même 10 €, ça paie du filament 😇</div>}
        {t >= T.close && <div style={{ marginTop: 12, fontSize: 13, fontWeight: 800, opacity: .8 }}>
          Retour à l'accueil dans {Math.max(1, Math.ceil((T.end - t) / 1000))} s…</div>}
      </div></div>}
    </div>, document.body);
}

export const PRANKS = { don: { label: "Merci pour le don", Effect: MerciDon } };
