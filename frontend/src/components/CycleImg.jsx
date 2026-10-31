import React, { useEffect, useRef, useState } from "react";

/**
 * Plusieurs vues dans une meme case, l'une apres l'autre en fondu (30/10/2026) : les vues 3D choisies ensemble pour
 * une vignette, et celles de la galerie 3D. Une mosaique les montrait toutes en petit ; ici chacune a la case entiere
 * a son tour. Seulement a l'ecran et onglet visible, chaque case partant a son propre moment (toute la page ne change
 * pas en cadence), et rien ne bouge si le systeme demande a limiter les animations.
 * render(url, actif) : l'image (posee en absolu dans la case), son opacite suit « actif ».
 */
// (31/10/2026) un peu plus vite (3,4 s -> 2,6 s), et de petits points discrets en bas : on voit que ca tourne, et ou on en est
export default function CycleImg({ urls, render, period = 2600, dots = true }) {
  const [i, setI] = useState(0);
  const box = useRef(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") { setOnScreen(true); return; }
    const io = new IntersectionObserver(es => setOnScreen(es.some(e => e.isIntersecting)), { rootMargin: "60px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (urls.length < 2 || !onScreen) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    let id = 0;
    const start = setTimeout(() => {
      id = setInterval(() => { if (!document.hidden) setI(k => (k + 1) % urls.length); }, period);
    }, Math.floor(Math.random() * period));
    return () => { clearTimeout(start); clearInterval(id); };
  }, [urls.length, onScreen, period]);
  const cur = i % urls.length;
  return <span ref={box} style={{ position: "absolute", inset: 0, display: "block" }}>
    {urls.map((u, k) => <React.Fragment key={u}>{render(u, k === cur)}</React.Fragment>)}
    {dots && urls.length > 1 && <span aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: 6, transform: "translateX(-50%)", zIndex: 2,
      display: "flex", gap: 3, pointerEvents: "none" }}>
      {urls.map((u, k) => <span key={u} style={{ width: k === cur ? 9 : 4, height: 4, borderRadius: 2, transition: "width .35s ease, background .35s ease",
        background: k === cur ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.45)", boxShadow: "0 0 2px rgba(0,0,0,.45)" }}/>)}
    </span>}
  </span>;
}
