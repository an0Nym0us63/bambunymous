import React, { useCallback, useEffect, useRef, useState } from "react";
import { egg } from "../eggs";

// Socle des pages cachees (22/10/2026) : chaque page est une scene plein cadre,
// a une adresse qu'aucun menu ne donne. Le secret tombe quand on y REUSSIT
// quelque chose (ou des l'arrivee pour les pages a contempler) : win(slug).
// Le nom du secret cote serveur est « h_<slug> » (tirets en soulignes).

export const eggName = slug => "h_" + slug.replace(/-/g, "_");

/** Le secret de la page : rend [gagne, gagner]. Gagner une seconde fois ne fait rien. */
export function useWin(slug) {
  const [won, setWon] = useState(false);
  const win = useCallback(() => {
    setWon(w => {
      if (!w) egg(eggName(slug));
      return true;
    });
  }, [slug]);
  return [won, win];
}

/** Le secret des l'arrivee (pages a contempler). */
export function useWinOnVisit(slug, delayMs = 1500) {
  const [won, win] = useWin(slug);
  useEffect(() => { const t = setTimeout(win, delayMs); return () => clearTimeout(t); }, [win, delayMs]);
  return won;
}

/**
 * Le cadre d'une page cachee : plein ecran dans la zone de contenu, coins
 * arrondis, fond fourni par la page, contenu centre. `won` affiche le bandeau
 * de reussite (avec `wonText`).
 */
export function Stage({ bg, color = "#fff", font, children, won, wonText = "Secret débloqué !", style, onClick, onPointerMove }) {
  return (
    <div onClick={onClick} onPointerMove={onPointerMove}
      style={{ position:"relative", minHeight:"calc(100dvh - 140px)", borderRadius:18, overflow:"hidden",
        background:bg, color, fontFamily:font, display:"flex", flexDirection:"column", alignItems:"center",
        justifyContent:"center", padding:"28px 16px", userSelect:"none", WebkitUserSelect:"none",
        touchAction:"manipulation", ...style }}>
      <style>{KIT_CSS}</style>
      {children}
      {won && <Victory text={wonText}/>}
    </div>
  );
}

const KIT_CSS = `
@keyframes hk-pop { 0% { transform:translate(-50%, 30px) scale(.6); opacity:0 } 60% { transform:translate(-50%, -6px) scale(1.06); opacity:1 }
                    100% { transform:translate(-50%, 0) scale(1); opacity:1 } }
@keyframes hk-shine { 0%,100% { filter:brightness(1) } 50% { filter:brightness(1.35) } }
@keyframes hk-float { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-8px) } }
@keyframes hk-spin { to { transform:rotate(360deg) } }
@keyframes hk-fade { from { opacity:0 } to { opacity:1 } }
@keyframes hk-confetti { from { transform:translateY(-10vh) rotate(0) } to { transform:translateY(110vh) rotate(720deg) } }
`;

/** Bandeau de reussite, avec quelques confettis. */
export function Victory({ text }) {
  const bits = useRef(Array.from({ length: 26 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.8, dur: 2.4 + Math.random() * 1.8,
    c: ["#f59e0b", "#22c55e", "#3b82f6", "#ec4899", "#a855f7", "#ef4444"][i % 6], s: 6 + Math.random() * 6,
  }))).current;
  return (
    <>
      {bits.map((b, i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", top:0, left:`${b.left}%`, width:b.s, height:b.s * 0.5,
          background:b.c, borderRadius:2, pointerEvents:"none", zIndex:20,
          animation:`hk-confetti ${b.dur}s linear ${b.delay}s 2 both` }}/>
      ))}
      <div role="status" style={{ position:"absolute", left:"50%", bottom:24, zIndex:21, transform:"translateX(-50%)",
        padding:"10px 18px", borderRadius:14, background:"rgba(10,10,20,0.82)", color:"#fff", fontWeight:800,
        fontSize:15, fontFamily:"system-ui, sans-serif", border:"1px solid rgba(255,215,0,0.6)",
        boxShadow:"0 10px 30px rgba(0,0,0,0.45), 0 0 0 4px rgba(255,215,0,0.15)", whiteSpace:"nowrap",
        animation:"hk-pop .6s cubic-bezier(.2,1.4,.4,1) both" }}>
        🏆 {text}
      </div>
    </>
  );
}

/** Titre de page, gros et lisible. */
export function Title({ children, sub, color, style }) {
  return (
    <div style={{ textAlign:"center", zIndex:2, position:"relative", ...style }}>
      <h1 style={{ margin:0, fontSize:"clamp(26px, 6vw, 44px)", fontWeight:900, color, letterSpacing:".02em",
        textShadow:"0 2px 18px rgba(0,0,0,0.35)" }}>{children}</h1>
      {sub && <p style={{ margin:"8px 0 0", fontSize:"clamp(13px, 3.4vw, 16px)", opacity:.82 }}>{sub}</p>}
    </div>
  );
}

/** Boucle d'animation (requestAnimationFrame), dt en secondes, arretee au demontage. */
export function useLoop(fn, running = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!running) return undefined;
    let id, last = performance.now();
    const tick = now => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ref.current(dt, now);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [running]);
}

/** Touches appuyees (pour les jeux) : un Set lu a chaque image. */
export function useKeys() {
  const keys = useRef(new Set());
  useEffect(() => {
    const down = e => {
      keys.current.add(e.key);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    };
    const up = e => keys.current.delete(e.key);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);
  return keys;
}

/** Bouton rond et net, pour les commandes des jeux (tactile compris). */
export function Btn({ children, onClick, color = "#3b82f6", style, ...rest }) {
  return (
    <button onClick={onClick} {...rest} style={{ padding:"10px 18px", borderRadius:12, border:"none", fontWeight:800,
      fontSize:15, color:"#fff", background:color, cursor:"pointer", boxShadow:`0 4px 0 rgba(0,0,0,0.25)`,
      fontFamily:"system-ui, sans-serif", ...style }}>{children}</button>
  );
}

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
