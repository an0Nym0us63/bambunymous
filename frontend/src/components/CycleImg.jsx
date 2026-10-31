import React, { useEffect, useRef, useState } from "react";

/**
 * Plusieurs vues dans une meme case, l'une apres l'autre en fondu (30/10/2026) : les vues 3D choisies ensemble pour
 * une vignette, et celles de la galerie 3D. Une mosaique les montrait toutes en petit ; ici chacune a la case entiere
 * a son tour. Seulement a l'ecran et onglet visible, chaque case partant a son propre moment (toute la page ne change
 * pas en cadence), et rien ne bouge si le systeme demande a limiter les animations.
 * render(url, actif) : l'image (posee en absolu dans la case), son opacite suit « actif ».
 */
// (31/10/2026) un peu plus vite (3,4 s -> 2,6 s), et un filet tres fin tout en bas, un segment par vue (celle montree plus
// foncee) : on voit que ca tourne sans rien poser sur l'image (des points blancs sur l'image empietaient)
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
    {dots && urls.length > 1 && <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2, zIndex: 2,
      display: "flex", gap: 2, pointerEvents: "none" }}>
      {urls.map((u, k) => <span key={u} style={{ flex: 1, transition: "background .5s ease",
        background: `color-mix(in srgb, var(--text) ${k === cur ? 38 : 12}%, transparent)` }}/>)}
    </span>}
  </span>;
}
