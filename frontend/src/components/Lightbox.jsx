import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mwImg, isVideo } from "./MwImg";

// Galerie plein ecran : on fait defiler les photos en grand (glisser sur
// telephone, fleches ou clavier sur ordinateur). data-no-pull : le
// tirer-pour-rafraichir de la coquille Android reste coupe pendant ce temps.
export default function Lightbox({ images, index = 0, onClose }) {
  const box = useRef(null);
  const [cur, setCur] = useState(index);

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollLeft = index * el.clientWidth;          // ouvre sur la photo touchee
    const key = e => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const go = d => {
    const el = box.current;
    if (!el) return;
    const i = Math.max(0, Math.min(images.length - 1, Math.round(el.scrollLeft / el.clientWidth) + d));
    setCur(i);
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const onScroll = e => setCur(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth));
  const w = typeof window !== "undefined" ? Math.min(1200, window.innerWidth) : 1000;
  const btn = { position:"absolute", top:"50%", transform:"translateY(-50%)", width:40, height:40, borderRadius:"50%",
    border:"none", background:"rgba(255,255,255,0.15)", color:"white", fontSize:22, cursor:"pointer" };

  return createPortal(
    <div data-no-pull="" style={{ position:"fixed", inset:0, zIndex:6000, background:"rgba(0,0,0,0.95)",
      display:"flex", flexDirection:"column" }}>
      <div style={{ display:"flex", alignItems:"center", padding:"calc(10px + env(safe-area-inset-top,0px)) 14px 8px",
        color:"white" }}>
        <span style={{ flex:1, fontSize:13, opacity:0.8 }}>{cur + 1} / {images.length}</span>
        <button onClick={onClose} aria-label="Fermer"
          style={{ background:"none", border:"none", color:"white", fontSize:24, cursor:"pointer" }}>✕</button>
      </div>
      <div ref={box} onScroll={onScroll}
        style={{ flex:1, display:"flex", overflowX:"auto", scrollSnapType:"x mandatory", overscrollBehavior:"contain" }}>
        {images.map((u, i) => (
          <div key={i} style={{ flex:"0 0 100%", height:"100%", scrollSnapAlign:"center", display:"flex",
            alignItems:"center", justifyContent:"center" }}>
            {Math.abs(i - cur) <= 2 && (
              isVideo(u) ? (
                <video src={u} autoPlay muted loop playsInline controls
                  style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }}/>
              ) : (
              <img src={mwImg(u, w, true)} alt="" referrerPolicy="no-referrer" decoding="async"
                onError={e => { if (e.currentTarget.src !== u) e.currentTarget.src = u; }}
                style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }}/>
              )
            )}
          </div>
        ))}
      </div>
      {images.length > 1 && (<>
        {cur > 0 && <button onClick={() => go(-1)} style={{ ...btn, left:10 }} aria-label="Précédente">‹</button>}
        {cur < images.length - 1 && <button onClick={() => go(1)} style={{ ...btn, right:10 }} aria-label="Suivante">›</button>}
      </>)}
      <div style={{ height:"calc(10px + env(safe-area-inset-bottom,0px))" }}/>
    </div>,
    document.body
  );
}
