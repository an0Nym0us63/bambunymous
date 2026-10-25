import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { mwImg, isVideo } from "./MwImg";
import { apiThumb } from "../api/client";

// Galerie plein ecran, la meme partout (25/10/2026) : photos d'une impression, galerie, fiche
// MakerWorld, copains, accueil. On fait defiler en grand (glisser sur telephone, fleches ou
// clavier sur ordinateur) ; derriere, l'image en cours floutee ; en haut le titre et « 2 / 5 ·
// legende » ; en bas les vignettes et, selon l'endroit, des boutons (actions).
// images : des adresses, ou des { url, label } ; actions(i, fermer) : les boutons du bas.
// data-no-pull : le tirer-pour-rafraichir de la coquille Android reste coupe pendant ce temps.
export default function Lightbox({ images, index = 0, onClose, title = null, actions = null, onIndex = null }) {
  const items = (images || []).map(x => typeof x === "string" ? { url: x, label: "" } : x);
  const box = useRef(null);
  const strip = useRef(null);
  const [cur, setCur] = useState(Math.min(index, Math.max(0, items.length - 1)));
  const curRef = useRef(cur);
  curRef.current = cur;

  const go = d => {
    const el = box.current;
    if (!el) return;
    const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / el.clientWidth) + d));
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const jump = i => {
    const el = box.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollLeft = cur * el.clientWidth;          // ouvre sur la photo touchee
    const key = e => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    // la page dessous ne defile plus
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // la vignette en cours reste en vue dans la bande
  useEffect(() => {
    onIndex?.(cur);
    // la bande seule (scrollIntoView faisait aussi glisser toute la visionneuse : decalee sur la derniere image)
    const bar = strip.current, t = bar?.children[cur];
    if (bar && t) bar.scrollTo({ left: t.offsetLeft - (bar.clientWidth - t.offsetWidth) / 2, behavior: "smooth" });
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = e => {
    const i = Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth);
    if (i !== curRef.current) setCur(i);
  };
  const w = typeof window !== "undefined" ? Math.min(1600, Math.round(window.innerWidth * (window.devicePixelRatio || 1))) : 1200;
  const now = items[cur] || {};
  const many = items.length > 1;
  const glass = { border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.12)", backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  const arrow = { ...glass, position: "absolute", top: "50%", transform: "translateY(-50%)", width: 46, height: 46, borderRadius: "50%",
    zIndex: 2, boxShadow: "0 8px 24px rgba(0,0,0,0.35)" };
  const src = u => isVideo(u) ? u : mwImg(u, w, true);
  // en petit (fond flou, vignettes) : notre serveur reduit les siennes, MakerWorld les leurs
  const small = (u, n) => String(u || "").startsWith("/api/") ? apiThumb(u, n) : mwImg(u, n);

  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 6000, background: "#05060a",
      display: "flex", flexDirection: "column", animation: "bn-fade .18s ease-out", overflow: "hidden" }}>
      {/* le fond : l'image en cours, tres floutee, assombrie */}
      {now.url && !isVideo(now.url) && <img key={now.url} src={small(now.url, 96)} alt="" aria-hidden="true" referrerPolicy="no-referrer"
        style={{ position: "absolute", inset: "-10%", width: "120%", height: "120%", objectFit: "cover", filter: "blur(40px) saturate(1.4)",
          opacity: 0.45, pointerEvents: "none" }}/>}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(120% 80% at 50% 50%, rgba(0,0,0,0.15), rgba(0,0,0,0.75))" }}/>

      {/* en haut : le titre, ou on en est, fermer */}
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", zIndex: 3, display: "flex", alignItems: "center", gap: 12,
        padding: "calc(12px + env(safe-area-inset-top,0px)) 14px 10px" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          {title && <span style={{ color: "#fff", fontSize: 16, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            textShadow: "0 2px 10px rgba(0,0,0,0.5)" }}>{title}</span>}
          {(many || now.label) && <span style={{ ...glass, cursor: "default", alignSelf: "flex-start", maxWidth: "100%", display: "inline-flex",
            justifyContent: "flex-start", gap: 6, padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 800, overflow: "hidden", whiteSpace: "nowrap" }}>
            {many && <b style={{ fontWeight: 900 }}>{cur + 1} / {items.length}</b>}
            {many && now.label && <span style={{ opacity: 0.5 }}>·</span>}
            {now.label && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{now.label}</span>}</span>}
        </div>
        <button onClick={onClose} aria-label="Fermer" style={{ ...glass, width: 42, height: 42, borderRadius: "50%", flexShrink: 0 }}>
          <X size={19}/></button>
      </div>

      {/* les images, cote a cote : on glisse de l'une a l'autre */}
      <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0 }}>
        <div ref={box} onScroll={onScroll} className="no-scrollbar"
          style={{ height: "100%", display: "flex", overflowX: "auto", overflowY: "hidden", scrollSnapType: "x mandatory",
            overscrollBehavior: "contain" }}>
          {items.map((it, i) => (
            <div key={i} style={{ flex: "0 0 100%", height: "100%", scrollSnapAlign: "center", display: "flex",
              alignItems: "center", justifyContent: "center", padding: "6px 14px", boxSizing: "border-box" }}>
              {Math.abs(i - cur) <= 2 && (
                isVideo(it.url) ? (
                  <video src={it.url} autoPlay muted loop playsInline controls onClick={e => e.stopPropagation()}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 18, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}/>
                ) : (
                  <img src={src(it.url)} alt={it.label || ""} referrerPolicy="no-referrer" decoding="async" draggable={false}
                    onClick={e => e.stopPropagation()}
                    onError={e => { if (e.currentTarget.src !== it.url) e.currentTarget.src = it.url; }}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 18, userSelect: "none",
                      boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}/>
                )
              )}
            </div>
          ))}
        </div>
        {many && cur > 0 && <button onClick={e => { e.stopPropagation(); go(-1); }} style={{ ...arrow, left: 12 }} aria-label="Précédente">
          <ChevronLeft size={22}/></button>}
        {many && cur < items.length - 1 && <button onClick={e => { e.stopPropagation(); go(1); }} style={{ ...arrow, right: 12 }} aria-label="Suivante">
          <ChevronRight size={22}/></button>}
      </div>

      {/* en bas : les boutons de l'endroit, puis les vignettes */}
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", zIndex: 3, display: "flex", flexDirection: "column", gap: 10,
        padding: "10px 0 calc(12px + env(safe-area-inset-bottom,0px))" }}>
        {actions && <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", padding: "0 14px" }}>{actions(cur, onClose)}</div>}
        {many && <div ref={strip} className="no-scrollbar" style={{ display: "flex", gap: 7, overflowX: "auto", padding: "4px 14px", alignItems: "center",
          justifyContent: items.length <= 6 ? "center" : "flex-start" }}>
          {items.map((it, i) => {
            const on = i === cur;
            const st = { width: on ? 58 : 50, height: on ? 58 : 50, objectFit: "cover", borderRadius: 13, flexShrink: 0, cursor: "pointer", display: "block",
              border: on ? "2px solid #fff" : "2px solid rgba(255,255,255,0.15)", opacity: on ? 1 : 0.55, transition: "all .18s", boxSizing: "border-box",
              boxShadow: on ? "0 8px 20px -6px rgba(0,0,0,0.8), 0 0 0 3px rgba(255,255,255,0.15)" : "none", background: "rgba(255,255,255,0.08)" };
            return isVideo(it.url)
              ? <video key={i} src={it.url} muted playsInline preload="metadata" onClick={() => jump(i)} style={st}/>
              : <img key={i} src={small(it.url, 128)} alt={it.label || ""} referrerPolicy="no-referrer" loading="lazy" draggable={false}
                  onClick={() => jump(i)} style={st}/>;
          })}
        </div>}
      </div>
    </div>,
    document.body
  );
}
