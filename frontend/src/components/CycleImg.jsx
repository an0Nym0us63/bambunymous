import React, { useEffect, useRef, useState } from "react";

/**
 * Plusieurs vues dans une meme case, l'une apres l'autre en fondu (30/10/2026) : les vues 3D choisies ensemble pour
 * une vignette, et celles de la galerie 3D. Une mosaique les montrait toutes en petit ; ici chacune a la case entiere
 * a son tour. Seulement a l'ecran et onglet visible, chaque case partant a son propre moment (toute la page ne change
 * pas en cadence), et rien ne bouge si le systeme demande a limiter les animations.
 * render(url, actif) : l'image (posee en absolu dans la case), son opacite suit « actif ».
 */
export default function CycleImg({ urls, render, period = 3400 }) {
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
  return <span ref={box} style={{ position: "absolute", inset: 0, display: "block" }}>
    {urls.map((u, k) => <React.Fragment key={u}>{render(u, k === i % urls.length)}</React.Fragment>)}
  </span>;
}
