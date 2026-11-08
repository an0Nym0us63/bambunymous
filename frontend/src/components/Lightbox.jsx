import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { mwImg, isVideo } from "./MwImg";
import { apiThumb } from "../api/client";
import { useStackZ } from "../utils/zstack";

// Galerie plein ecran, la meme partout (25/10/2026) : photos d'une impression, galerie, fiche
// MakerWorld, copains, accueil. On fait defiler en grand (glisser sur telephone, fleches ou
// clavier sur ordinateur) ; derriere, l'image en cours floutee ; en haut le titre et « 2 / 5 ·
// legende » ; en bas les vignettes et, selon l'endroit, des boutons (actions).
// images : des adresses, ou des { url, label, poster, fallback } ; actions(i, fermer) : les boutons du bas.
// Une video ne se charge que quand elle est affichee (les voisines montrent leur image « poster ») ; si le
// navigateur ne sait pas la lire, « fallback » (une version convertie) prend le relais (26/10/2026).
// data-no-pull : le tirer-pour-rafraichir de la coquille Android reste coupe pendant ce temps.
// Le zoom (08/11/2026) : pincer a deux doigts sur telephone, la molette sur ordinateur (vers le curseur), un double appui
// ou double clic pour zoomer / revenir ; zoomee, un doigt ou la souris la deplace, et le glisser ne change plus de photo.
// Changer de photo la remet a sa taille ; zoomee, elle passe en pleine definition (hi).
function ZoomImg({ src, hi, alt, active, onZoom }) {
  const ref = useRef(null);
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const zr = useRef(z);
  zr.current = z;
  const g = useRef(null), tap = useRef(0);
  const zoomed = z.s > 1.01;
  useEffect(() => { if (!active) setZ({ s: 1, x: 0, y: 0 }); }, [active]);
  useEffect(() => { onZoom?.(zoomed); }, [zoomed]); // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (s, x, y) => {
    const el = ref.current;
    if (!el || s <= 1.01) return { s: 1, x: 0, y: 0 };
    const mx = (s - 1) * el.clientWidth / 2, my = (s - 1) * el.clientHeight / 2;
    return { s, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  // zoomer vers un point de l'ecran : ce point reste sous le doigt ou le curseur
  const at = (cx, cy, s2) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect(), { s, x, y } = zr.current;
    const px = cx - (r.left + r.width / 2 - x), py = cy - (r.top + r.height / 2 - y);
    s2 = Math.max(1, Math.min(6, s2));
    setZ(clamp(s2, px - (px - x) * (s2 / s), py - (py - y) * (s2 / s)));
  };
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return undefined;
    const wheel = e => { e.preventDefault(); at(e.clientX, e.clientY, zr.current.s * Math.exp(-e.deltaY * 0.0018)); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = t => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  const toggle = (cx, cy) => zr.current.s > 1.01 ? setZ({ s: 1, x: 0, y: 0 }) : at(cx, cy, 2.5);
  const touch = {
    onTouchStart: e => {
      const t = e.touches;
      if (t.length === 2) g.current = { k: "pinch", d0: dist(t), s0: zr.current.s };
      else if (t.length === 1 && zr.current.s > 1.01) g.current = { k: "pan", x0: t[0].clientX, y0: t[0].clientY, tx: zr.current.x, ty: zr.current.y };
      else g.current = null;
    },
    onTouchMove: e => {
      const t = e.touches, q = g.current;
      if (!q) return;
      if (q.k === "pinch" && t.length === 2) { const m = mid(t); at(m.x, m.y, q.s0 * dist(t) / q.d0); }
      else if (q.k === "pan" && t.length === 1) setZ(clamp(zr.current.s, q.tx + t[0].clientX - q.x0, q.ty + t[0].clientY - q.y0));
    },
    onTouchEnd: e => {
      if (e.touches.length === 0 && e.changedTouches.length === 1 && g.current?.k !== "pinch") {
        const now = Date.now(), c = e.changedTouches[0];
        if (now - tap.current < 300) { toggle(c.clientX, c.clientY); tap.current = 0; } else tap.current = now;
      }
      if (e.touches.length < 2 && g.current?.k === "pinch") g.current = null;
    },
  };
  // la souris : glisser pour deplacer une photo zoomee
  const down = e => {
    if (e.button !== 0 || zr.current.s <= 1.01) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, tx = zr.current.x, ty = zr.current.y;
    const move = ev => setZ(clamp(zr.current.s, tx + ev.clientX - x0, ty + ev.clientY - y0));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  return <img ref={ref} src={zoomed && hi ? hi : src} alt={alt} referrerPolicy="no-referrer" decoding="async" draggable={false}
    {...touch} onMouseDown={down} onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); toggle(e.clientX, e.clientY); }}
    onError={e => { if (hi && e.currentTarget.src !== hi) e.currentTarget.src = hi; }}
    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: zoomed ? 6 : 18, userSelect: "none",
      boxShadow: "0 24px 60px rgba(0,0,0,0.6)", transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})`, transformOrigin: "center",
      transition: g.current ? "none" : "transform .12s ease-out", cursor: zoomed ? "grab" : "zoom-in", position: "relative", zIndex: zoomed ? 2 : undefined,
      touchAction: zoomed ? "none" : "pan-x", willChange: "transform" }}/>;
}

export default function Lightbox({ images, index = 0, onClose, title = null, actions = null, onIndex = null }) {
  const zTop = useStackZ(6000);         // au-dessus de toute fenetre deja ouverte (06/11/2026)
  const items = (images || []).map(x => typeof x === "string" ? { url: x, label: "" } : x);
  const box = useRef(null);
  const strip = useRef(null);
  const [cur, setCur] = useState(Math.min(index, Math.max(0, items.length - 1)));
  const [vstate, setVstate] = useState({});        // url -> "loading" | "ok" | "fallback" | "error"
  const [zoomed, setZoomed] = useState(false);      // la photo en cours est zoomee : le glisser la deplace, sans changer de photo
  const curRef = useRef(cur);
  curRef.current = cur;

  // zoomee, le defilement est bloque : les fleches et la bande la remettent d'abord a sa taille, puis changent de photo
  const go = d => {
    const el = box.current;
    if (!el) return;
    const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / el.clientWidth) + d));
    setZoomed(false);
    setTimeout(() => el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }), 0);
  };
  const jump = i => {
    const el = box.current;
    setZoomed(false);
    if (el) setTimeout(() => el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }), 0);
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
    setZoomed(false);                                   // une autre photo : a sa taille
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
  // nos photos aussi en reduit, a la taille de l'ecran (28/10/2026 : les originales de plusieurs Mo partaient)
  const src = u => isVideo(u) ? u : String(u || "").startsWith("/api/") ? apiThumb(u, w) : mwImg(u, w, true);
  // en petit (fond flou, vignettes) : notre serveur reduit les siennes, MakerWorld les leurs
  const small = (u, n) => String(u || "").startsWith("/api/") ? apiThumb(u, n) : mwImg(u, n);

  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: zTop, background: "#05060a",
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
          style={{ height: "100%", display: "flex", overflowX: zoomed ? "hidden" : "auto", overflowY: "hidden", scrollSnapType: "x mandatory",
            overscrollBehavior: "contain" }}>
          {items.map((it, i) => (
            <div key={i} style={{ flex: "0 0 100%", height: "100%", scrollSnapAlign: "center", display: "flex",
              alignItems: "center", justifyContent: "center", padding: "6px 14px", boxSizing: "border-box" }}>
              {Math.abs(i - cur) <= 2 && (
                isVideo(it.url) ? (i !== cur ? (it.poster ? <img src={it.poster} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: "100%",
                    objectFit: "contain", borderRadius: 18, opacity: 0.6 }}/> : null) : (() => {
                  const vs = vstate[it.url];
                  // une seule tentative de chaque : l'originale, puis la convertie ; ensuite on s'arrete (sans boucle)
                  const src = vs === "error" ? undefined : vs === "fallback" && it.fallback ? it.fallback : it.url;
                  return <span onClick={e => e.stopPropagation()} style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
                    width: "100%", height: "100%" }}>
                    <video key={src} src={src} poster={it.poster || undefined} autoPlay muted loop playsInline controls preload="auto"
                      onLoadedData={() => setVstate(v => ({ ...v, [it.url]: vs === "fallback" ? "fallback" : "ok" }))}
                      onError={() => setVstate(v => v[it.url] === "error" ? v
                        : ({ ...v, [it.url]: it.fallback && v[it.url] !== "fallback" ? "fallback" : "error" }))}
                      style={{ maxWidth: "100%", maxHeight: "100%", width: vs === "ok" || vs === "fallback" ? undefined : "min(100%, 960px)",
                        objectFit: "contain", borderRadius: 18, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", background: "#000" }}/>
                    {vs !== "ok" && vs !== "error" && !(vs === "fallback" && false) && (
                      <span style={{ ...glass, cursor: "default", position: "absolute", padding: "8px 14px", borderRadius: 20, fontSize: 12.5, fontWeight: 800,
                        pointerEvents: "none", display: vs === "fallback" ? "flex" : undefined }}>
                        {vs === "fallback" ? "Conversion de la vidéo…" : "Chargement de la vidéo…"}</span>)}
                    {vs === "error" && <span style={{ ...glass, cursor: "default", position: "absolute", padding: "8px 14px", borderRadius: 20, fontSize: 12.5,
                      fontWeight: 800, background: "rgba(239,68,68,0.8)" }}>Vidéo illisible</span>}
                  </span>;
                })()) : (
                  <ZoomImg src={src(it.url)} alt={it.label || ""} active={i === cur} onZoom={i === cur ? setZoomed : undefined}
                    hi={String(it.url || "").startsWith("/api/") ? it.url : mwImg(it.url, 3000, true) || it.url}/>
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
            // une video en vignette : son image si on l'a, sinon un pictogramme (jamais la video elle-meme : une
            // galerie de timelapses en chargeait des centaines d'un coup)
            return isVideo(it.url)
              ? (it.poster ? <img key={i} src={it.poster} alt={it.label || ""} loading="lazy" draggable={false} onClick={() => jump(i)} style={st}/>
                : <span key={i} onClick={() => jump(i)} style={{ ...st, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 18 }}>▶</span>)
              : <img key={i} src={small(it.url, 128)} alt={it.label || ""} referrerPolicy="no-referrer" loading="lazy" draggable={false}
                  onClick={() => jump(i)} style={st}/>;
          })}
        </div>}
      </div>
    </div>,
    document.body
  );
}
