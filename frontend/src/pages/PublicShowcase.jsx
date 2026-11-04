import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiThumb } from "../api/client";

// La vitrine publique (04/11/2026, refaite le meme jour) : /vitrine/<lien>, sans compte. Un portfolio sombre et vivant :
// une aurore aux couleurs de la vitrine et un halo qui suit la souris ; en tete, le titre en grand et un jeu de cartes
// en relief (les pieces phares, entieres, jamais rognees) qui s'incline sous la souris et se feuillette ; un ruban de
// noms qui defile ; la collection en mosaique (chaque photo a ses proportions), avec recherche, categories, « en 3D »
// et tri ; chaque carte s'incline avec un reflet ; la visionneuse plein ecran (photos zoomables, et la vue 3D quand la
// piece en a une : l'assemblage s'il y en a un), avec piece precedente / suivante et un lien direct (#piece) ; la
// boutique en carrousel. Lue par fetch (ni jeton, ni copain) ; les mouvements se calment si le systeme le demande.
const SERIF = "'Playfair Display', 'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const monthFr = ym => ym ? new Date(`${ym}-15T12:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "";
const price = v => `${Number(v || 0).toLocaleString("fr-FR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const big = u => apiThumb(u, 1600);
const mid = u => apiThumb(u, 800);
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const calm = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const fine = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;

function useReveal(margin = "0px 0px -6% 0px") {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, on];
}

function Reveal({ children, delay = 0, style, as: Tag = "div" }) {
  const [ref, on] = useReveal();
  return <Tag ref={ref} style={{ ...style, opacity: on ? 1 : 0, transform: on ? "none" : "translateY(28px) scale(.985)", filter: on ? "none" : "blur(6px)",
    transition: `opacity .9s ${delay}ms, transform 1s cubic-bezier(.2,.8,.2,1) ${delay}ms, filter .9s ${delay}ms` }}>{children}</Tag>;
}

// un nombre qui monte quand il apparait
function Count({ to }) {
  const [ref, on] = useReveal();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    if (calm()) { setV(to); return undefined; }
    let raf, t0;
    const f = t => { t0 = t0 || t; const k = Math.min(1, (t - t0) / 1400); setV(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [on, to]);
  return <span ref={ref}>{v.toLocaleString("fr-FR")}</span>;
}

const Dots = ({ colors, size = 12, max = 6 }) => <span style={{ display: "inline-flex", gap: 5 }}>
  {(colors || []).slice(0, max).map(c => <span key={c} style={{ width: size, height: size, borderRadius: "50%", background: `#${c}`,
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,.3), 0 2px 6px rgba(0,0,0,.35)" }}/>)}</span>;

// une image entiere sur un fond flou d'elle-meme : la piece n'est jamais rognee
function Framed({ src, alt = "", style, imgStyle, eager = false }) {
  return <div style={{ position: "relative", overflow: "hidden", background: "#111116", ...style }}>
    <img src={src} alt="" aria-hidden="true" loading={eager ? "eager" : "lazy"} style={{ position: "absolute", inset: "-10%", width: "120%", height: "120%", objectFit: "cover",
      filter: "blur(28px) saturate(1.3) brightness(.55)", transform: "scale(1.05)" }}/>
    <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} draggable={false} style={{ position: "relative", width: "100%", height: "100%", objectFit: "contain", ...imgStyle }}/>
  </div>;
}

// le jeu de cartes des pieces phares : celle du dessus en grand, les suivantes en eventail derriere ; il s'incline sous
// la souris, se feuillette au glisser, aux fleches et tout seul
function Deck({ items, accent, onOpen }) {
  const [i, setI] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(false);
  const start = useRef(null);
  const n = items.length;
  useEffect(() => {
    if (n < 2 || hover || calm()) return undefined;
    const t = setTimeout(() => setI(x => (x + 1) % n), 4600);
    return () => clearTimeout(t);
  }, [i, n, hover]);
  if (!n) return null;
  const go = d => setI(x => (x + d + n) % n);
  const move = e => {
    if (!fine() || calm()) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTilt({ x: ((e.clientX - r.left) / r.width - .5) * 2, y: ((e.clientY - r.top) / r.height - .5) * 2 });
  };
  return <div className="sc-deck" onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setTilt({ x: 0, y: 0 }); }} onMouseMove={move}
    onPointerDown={e => { start.current = e.clientX; }}
    onPointerUp={e => { if (start.current != null && Math.abs(e.clientX - start.current) > 40) go(e.clientX < start.current ? 1 : -1); start.current = null; }}
    style={{ position: "relative", perspective: 1400, touchAction: "pan-y", userSelect: "none" }}>
    <div style={{ position: "relative", width: "100%", height: "100%", transformStyle: "preserve-3d",
      transform: `rotateY(${tilt.x * 9}deg) rotateX(${-tilt.y * 7}deg)`, transition: "transform .5s cubic-bezier(.2,.8,.2,1)" }}>
      {items.map((it, k) => {
        const d = (k - i + n) % n;                       // 0 : dessus ; 1, 2 : derriere ; les autres, caches
        const back = d > 0 && d < 3;
        const hidden = d >= 3;
        const t = d === 0 ? "translate3d(0,0,60px)" : back ? `translate3d(${d * 34}px, ${-d * 18}px, ${-d * 70}px) rotateZ(${d * 4}deg)` : "translate3d(-60px, 20px, -260px) rotateZ(-8deg)";
        return <button key={it.key} type="button" tabIndex={d === 0 ? 0 : -1} aria-hidden={d !== 0} onClick={() => (d === 0 ? onOpen(it) : setI(k))}
          style={{ position: "absolute", inset: 0, padding: 0, border: "none", borderRadius: 26, overflow: "hidden", cursor: "pointer", background: "#111",
            transform: t, opacity: hidden ? 0 : d === 0 ? 1 : .55 - d * .12, zIndex: 10 - d, pointerEvents: hidden ? "none" : "auto",
            boxShadow: d === 0 ? `0 50px 120px -30px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.08), 0 30px 90px -50px ${accent}` : "0 30px 80px -30px rgba(0,0,0,.8)",
            transition: "transform .9s cubic-bezier(.2,.8,.2,1), opacity .9s, box-shadow .9s", filter: d === 0 ? "none" : "saturate(.7) brightness(.8)" }}>
          <Framed src={big(it.photos[0])} alt={it.title} eager={d < 3} style={{ width: "100%", height: "100%" }}
            imgStyle={{ transform: d === 0 && !calm() ? "scale(1.04)" : "none", transition: "transform 6s ease-out" }}/>
          {/* le reflet qui suit la souris */}
          {d === 0 && <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", mixBlendMode: "screen",
            background: `radial-gradient(60% 50% at ${50 + tilt.x * 30}% ${30 + tilt.y * 30}%, rgba(255,255,255,.18), transparent 70%)` }}/>}
          <span style={{ position: "absolute", left: 14, right: 14, bottom: 14, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 18,
            background: "rgba(10,10,14,.45)", backdropFilter: "blur(14px) saturate(1.4)", WebkitBackdropFilter: "blur(14px) saturate(1.4)", border: "1px solid rgba(255,255,255,.1)",
            opacity: d === 0 ? 1 : 0, transform: d === 0 ? "none" : "translateY(10px)", transition: "all .7s .2s", textAlign: "left" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: SERIF, fontSize: 19, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</span>
              <span style={{ fontSize: 11, letterSpacing: ".2em", textTransform: "uppercase", color: accent }}>{[it.categories?.[0], monthFr(it.date)].filter(Boolean).join(" · ") || "Pièce phare"}</span>
            </span>
            {it.has3d && <span style={chip3d}>3D</span>}
            <Dots colors={it.colors} size={11} max={4}/>
          </span>
        </button>;
      })}
    </div>
    {n > 1 && <div style={{ position: "absolute", left: 0, right: 0, bottom: -44, display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
      <button type="button" aria-label="Précédente" onClick={() => go(-1)} style={roundBtn}>‹</button>
      <span style={{ display: "flex", gap: 6 }}>{items.map((it, k) => <button key={it.key} type="button" aria-label={`Pièce ${k + 1}`} onClick={() => setI(k)}
        style={{ width: k === i ? 26 : 7, height: 7, borderRadius: 7, border: "none", padding: 0, cursor: "pointer", background: k === i ? accent : "rgba(255,255,255,.3)", transition: "all .5s" }}/>)}</span>
      <button type="button" aria-label="Suivante" onClick={() => go(1)} style={roundBtn}>›</button>
    </div>}
  </div>;
}

// une carte de la collection : elle s'incline sous la souris avec un reflet ; au survol, la deuxieme photo
function Card({ it, accent, onOpen, i }) {
  const [hov, setHov] = useState(false);
  const [p, setP] = useState({ x: .5, y: .5 });
  const move = e => {
    if (!fine() || calm()) return;
    const r = e.currentTarget.getBoundingClientRect();
    setP({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };
  const rx = hov ? (p.y - .5) * -10 : 0, ry = hov ? (p.x - .5) * 12 : 0;
  return <Reveal delay={(i % 6) * 70} style={{ breakInside: "avoid", marginBottom: "var(--sc-gap)" }}>
    <button type="button" onClick={() => onOpen(it)} onMouseEnter={() => setHov(true)} onMouseLeave={() => { setHov(false); setP({ x: .5, y: .5 }); }} onMouseMove={move}
      style={{ display: "block", width: "100%", padding: 0, border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "inherit", perspective: 900 }}>
      <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", background: "#15151B", transformStyle: "preserve-3d",
        transform: `rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0) ${hov ? "scale(1.015)" : ""}`, transition: hov ? "transform .12s linear, box-shadow .5s" : "transform .7s cubic-bezier(.2,.8,.2,1), box-shadow .5s",
        boxShadow: hov ? `0 40px 70px -30px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.12), 0 20px 60px -40px ${accent}` : "0 12px 30px -20px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.05)" }}>
        <img src={mid(it.photos[0])} alt={it.title} loading="lazy" style={{ display: "block", width: "100%", height: "auto", minHeight: 120,
          transform: hov ? "scale(1.06)" : "scale(1)", transition: "transform 1.2s cubic-bezier(.2,.8,.2,1)" }}/>
        {it.photos[1] && <img src={mid(it.photos[1])} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
          opacity: hov ? 1 : 0, transition: "opacity .7s" }}/>}
        <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: hov ? 1 : 0, transition: "opacity .4s", mixBlendMode: "screen",
          background: `radial-gradient(50% 40% at ${p.x * 100}% ${p.y * 100}%, rgba(255,255,255,.22), transparent 70%)` }}/>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 50%, rgba(5,5,8,.85))", opacity: hov ? 1 : .85, transition: "opacity .5s" }}/>
        <div style={{ position: "absolute", top: 10, left: 10, right: 10, display: "flex", gap: 6, justifyContent: "space-between", pointerEvents: "none" }}>
          {it.has3d ? <span style={chip3d}>🧊 3D</span> : <span/>}
          {it.photos.length > 1 && <span style={glassTag}>{it.photos.length} photos</span>}
        </div>
        <div style={{ position: "absolute", left: 14, right: 14, bottom: 12, transform: hov ? "translateY(-4px)" : "none", transition: "transform .5s" }}>
          <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: "#fff", lineHeight: 1.2, textShadow: "0 2px 14px rgba(0,0,0,.6)" }}>{it.title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, letterSpacing: ".18em", textTransform: "uppercase", color: hov ? accent : "rgba(255,255,255,.6)", transition: "color .4s",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[it.categories?.[0], monthFr(it.date)].filter(Boolean).join(" · ")}</span>
            <Dots colors={it.colors} size={10} max={5}/>
          </div>
        </div>
      </div>
    </button>
  </Reveal>;
}

// la vue 3D d'une piece (l'assemblage s'il y en a un), avec le moteur de l'appli, charge seulement a la demande
function Piece3D({ token, it, accent }) {
  const [st, setSt] = useState({ load: true });
  const [V, setV] = useState(null);
  useEffect(() => {
    let alive = true;
    setSt({ load: true });
    Promise.all([
      fetch(`/api/v1/showcase/public/${encodeURIComponent(token)}/3d/${it.key}`).then(r => (r.ok ? r.json() : Promise.reject(r.status))),
      import("../components/Model3D"),
    ]).then(([m, mod]) => { if (!alive) return; setV(() => mod.Model3DViewer); setSt({ m, isGlb: mod.isGlb }); })
      .catch(() => alive && setSt({ error: true }));
    return () => { alive = false; };
  }, [token, it.key]);
  const m = st.m;
  const plate = m ? ((m.plates || []).find(p => p.assembled && !p.skipped) || (m.plates || []).find(p => !p.skipped)) : null;
  const n = plate ? String(plate.n) : null;
  const pal = m && n ? (m.used_plates?.[n] || m.used_palette || null) : null;
  const piecePal = useMemo(() => {
    if (!plate?.assembled || !pal || !plate.pieces) return null;
    const out = {};
    for (const pc of Object.values(plate.pieces)) {
      const pn = m.piece_plates?.[String(pc.k || "").split(":").slice(0, 2).join(":")];
      const pp = pn != null ? m.used_plates?.[String(pn)] : null;
      if (pp) out[pc.k] = { ...pal, ...pp };
    }
    return Object.keys(out).length ? out : null;
  }, [m, plate, pal]);
  if (st.error || (!st.load && V && !plate)) return <Center>La vue 3D n'est pas disponible pour cette pièce.</Center>;
  if (st.load || !V) return <Center><span className="sc-spin" style={{ borderTopColor: accent }}/>Préparation de la vue 3D…</Center>;
  const fin = pal ? { ...(m.finishes || {}), ...((m.used_finishes_plates || {})[n] || m.used_finishes || {}) } : m.finishes;
  const multi = pal ? ((m.used_multi_plates || {})[n] || m.used_multi || null) : null;
  return <div style={{ position: "absolute", inset: 0 }}>
    <V url={plate.url} glb={st.isGlb(plate.url)} onState={() => {}} palette={pal} piecePalettes={piecePal} finishes={fin} multi={multi} glows={m.glows || null}
      pieces={plate.assembled ? plate.pieces : null} edit={plate.assembled ? m.assembly_edit : null} litho={!!plate.litho} bare/>
    <span style={{ position: "absolute", left: 14, bottom: 14, ...glassTag, pointerEvents: "none" }}>
      {plate.assembled ? "Assemblage · " : ""}glisser pour tourner · molette ou pincer pour zoomer</span>
  </div>;
}

const Center = ({ children }) => <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 14, alignItems: "center", justifyContent: "center",
  color: "rgba(255,255,255,.7)", fontSize: 14, textAlign: "center", padding: 20 }}>{children}</div>;

// la visionneuse d'une piece : photos (clic pour zoomer, la souris deplace) ou vue 3D ; piece precedente / suivante
function Viewer({ it, list, token, accent, onClose, onGo }) {
  const [k, setK] = useState(0);
  const [tab, setTab] = useState("photos");
  const [zoom, setZoom] = useState(null);
  const [copied, setCopied] = useState(false);
  const start = useRef(null);
  const n = it.photos.length;
  const idx = list.findIndex(x => x.key === it.key);
  useEffect(() => { setK(0); setZoom(null); setTab("photos"); }, [it.key]);
  useEffect(() => {
    const f = e => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") { if (tab === "photos" && k < n - 1) setK(k + 1); else onGo(1); }
      else if (e.key === "ArrowLeft") { if (tab === "photos" && k > 0) setK(k - 1); else onGo(-1); }
    };
    window.addEventListener("keydown", f);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", f); document.body.style.overflow = ""; };
  }, [n, k, tab, onClose, onGo]);
  const share = async () => {
    const u = `${window.location.origin}${window.location.pathname}#${it.key}`;
    try { await navigator.clipboard.writeText(u); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* rien */ }
  };
  return <div role="dialog" aria-modal="true" aria-label={it.title} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(5,5,8,.9)",
    backdropFilter: "blur(18px) saturate(1.2)", WebkitBackdropFilter: "blur(18px) saturate(1.2)", display: "flex", flexDirection: "column", animation: "scIn .35s ease" }}>
    <div onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px clamp(12px, 3vw, 28px)" }}>
      {it.has3d && <div style={{ display: "flex", padding: 4, borderRadius: 30, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)" }}>
        {[["photos", "Photos"], ["3d", "🧊 Vue 3D"]].map(([v, l]) => <button key={v} type="button" onClick={() => setTab(v)}
          style={{ padding: "7px 16px", borderRadius: 26, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 800, letterSpacing: ".04em",
            background: tab === v ? accent : "transparent", color: tab === v ? "#0B0B0F" : "rgba(255,255,255,.8)", transition: "all .3s" }}>{l}</button>)}
      </div>}
      <span style={{ flex: 1, fontSize: 11.5, letterSpacing: ".22em", textTransform: "uppercase", color: "rgba(255,255,255,.5)" }}>
        {tab === "photos" && n > 1 ? `${k + 1} / ${n}` : ""}</span>
      <button type="button" onClick={share} style={{ ...pillBtn, color: copied ? accent : "#fff" }}>{copied ? "Lien copié ✓" : "↗ Partager"}</button>
      <button type="button" onClick={onClose} aria-label="Fermer" style={{ ...roundBtn, width: 42, height: 42, fontSize: 22 }}>×</button>
    </div>
    <div className="sc-viewer" onClick={e => e.stopPropagation()} style={{ flex: 1, minHeight: 0, display: "grid", gap: "clamp(14px, 2.4vw, 30px)", padding: "0 clamp(12px, 3vw, 28px) 18px",
      animation: "scPop .5s cubic-bezier(.2,.8,.2,1)" }}>
      <div style={{ position: "relative", minHeight: 0, borderRadius: 24, overflow: "hidden", background: "radial-gradient(120% 90% at 50% 0%, #1c1c26, #0c0c11)",
        border: "1px solid rgba(255,255,255,.07)" }}>
        {tab === "3d" ? <Piece3D token={token} it={it} accent={accent}/> : <>
          <div onPointerDown={e => { start.current = e.clientX; }}
            onPointerUp={e => { if (!zoom && start.current != null && Math.abs(e.clientX - start.current) > 40) setK(x => Math.max(0, Math.min(n - 1, x + (e.clientX < start.current ? 1 : -1)))); start.current = null; }}
            onClick={e => { if (!fine()) return; const r = e.currentTarget.getBoundingClientRect(); setZoom(z => (z ? null : { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })); }}
            onMouseMove={e => { if (!zoom) return; const r = e.currentTarget.getBoundingClientRect(); setZoom({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); }}
            style={{ position: "absolute", inset: 0, touchAction: "pan-y", cursor: fine() ? (zoom ? "zoom-out" : "zoom-in") : "default" }}>
            <Framed key={k} src={big(it.photos[k])} alt={it.title} eager style={{ position: "absolute", inset: 0, background: "transparent", animation: "scFade .5s ease" }}
              imgStyle={{ transform: zoom ? "scale(2.2)" : "none", transformOrigin: zoom ? `${zoom.x * 100}% ${zoom.y * 100}%` : "50% 50%", transition: zoom ? "transform-origin .08s" : "transform .5s" }}/>
          </div>
          {n > 1 && !zoom && <>
            <button type="button" aria-label="Photo précédente" disabled={!k} onClick={() => setK(k - 1)} style={{ ...roundBtn, position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: k ? 1 : .3 }}>‹</button>
            <button type="button" aria-label="Photo suivante" disabled={k >= n - 1} onClick={() => setK(k + 1)} style={{ ...roundBtn, position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", opacity: k < n - 1 ? 1 : .3 }}>›</button>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 12, display: "flex", justifyContent: "center", gap: 8, padding: "0 12px", overflowX: "auto" }}>
              {it.photos.map((ph, j) => <button key={ph} type="button" onClick={() => setK(j)} style={{ flexShrink: 0, width: 46, height: 46, padding: 0, borderRadius: 12, overflow: "hidden",
                cursor: "pointer", border: `2px solid ${j === k ? accent : "rgba(255,255,255,.15)"}`, opacity: j === k ? 1 : .6, transition: "all .3s", background: "#111" }}>
                <img src={apiThumb(ph, 120)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/></button>)}
            </div>
          </>}
        </>}
      </div>
      <aside style={{ color: "#EDEDED", overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 18, paddingRight: 4 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".3em", textTransform: "uppercase", color: accent }}>
            {[it.kind === "group" && it.count > 1 ? `${it.count} pièces` : null, it.categories?.join(" · ")].filter(Boolean).join(" · ") || "Impression 3D"}</div>
          <h3 style={{ margin: "10px 0 6px", fontFamily: SERIF, fontWeight: 600, fontSize: "clamp(28px, 3.2vw, 44px)", lineHeight: 1.05, color: "#fff" }}>{it.title}</h3>
          {it.date && <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.55)" }}>Imprimé en {monthFr(it.date)}</div>}
        </div>
        {it.note && <p style={{ fontSize: 15.5, lineHeight: 1.75, color: "rgba(255,255,255,.85)", margin: 0, paddingLeft: 14, borderLeft: `2px solid ${accent}` }}>{it.note}</p>}
        {it.colors?.length > 0 && <div>
          <div style={label}>Couleurs</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            {it.colors.map(c => <span key={c} title={`#${c}`} style={{ width: 34, height: 34, borderRadius: 12, background: `#${c}`,
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,.25), 0 8px 18px -8px rgba(0,0,0,.8)" }}/>)}</div></div>}
        {it.has3d && tab === "photos" && <button type="button" onClick={() => setTab("3d")} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 18,
          border: `1px solid color-mix(in srgb, ${accent} 50%, transparent)`, background: `linear-gradient(120deg, color-mix(in srgb, ${accent} 22%, transparent), transparent)`,
          color: "#fff", cursor: "pointer", textAlign: "left" }}>
          <span style={{ fontSize: 26 }}>🧊</span>
          <span><span style={{ display: "block", fontWeight: 800, fontSize: 14.5 }}>La voir en 3D</span>
            <span style={{ fontSize: 12.5, color: "rgba(255,255,255,.65)" }}>Tourner autour, zoomer, aux couleurs de l'impression</span></span></button>}
        {it.model && <div style={{ padding: "14px 16px", borderRadius: 18, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.03)" }}>
          <div style={label}>Modèle</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{it.model.title}</div>
          {it.model.creator && <div style={{ fontSize: 13, color: "rgba(255,255,255,.65)" }}>conçu par {it.model.creator}</div>}
          <a href={it.model.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 12.5, fontWeight: 800, color: accent, textDecoration: "none", letterSpacing: ".08em" }}>
            Voir sur MakerWorld ↗</a></div>}
        {list.length > 1 && <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
          {[[-1, "‹ Précédente"], [1, "Suivante ›"]].map(([d, l]) => { const o = list[(idx + d + list.length) % list.length];
            return <button key={d} type="button" onClick={() => onGo(d)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: 8, borderRadius: 16, cursor: "pointer",
              border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)", color: "#fff", flexDirection: d < 0 ? "row" : "row-reverse", textAlign: d < 0 ? "left" : "right" }}>
              <img src={apiThumb(o.photos[0], 120)} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}/>
              <span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 10.5, letterSpacing: ".18em", textTransform: "uppercase", color: "rgba(255,255,255,.5)" }}>{l}</span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.title}</span></span>
            </button>; })}
        </div>}
      </aside>
    </div>
  </div>;
}

export default function PublicShowcase() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [only3d, setOnly3d] = useState(false);
  const [sort, setSort] = useState("recent");
  const [scrolled, setScrolled] = useState(false);
  const glow = useRef(null);
  const searchRef = useRef(null);
  const colRef = useRef(null);
  const rootRef = useRef(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/showcase/public/${encodeURIComponent(token || "")}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(x => alive && setD(x)).catch(() => alive && setD({ error: true }));
    return () => { alive = false; };
  }, [token]);
  useEffect(() => { if (d?.title) document.title = d.title; }, [d?.title]);
  // la page defile dans son propre conteneur (l'appli fige la fenetre) : c'est lui qu'on ecoute
  const ready = !!d && !d.error;
  useEffect(() => {
    const sc = rootRef.current;
    const f = () => setScrolled((sc?.scrollTop || 0) > 40);
    const m = e => { if (glow.current) glow.current.style.transform = `translate3d(${e.clientX - 300}px, ${e.clientY - 300}px, 0)`; };
    const k = e => { if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); searchRef.current?.focus(); } };
    sc?.addEventListener("scroll", f, { passive: true });
    if (fine() && !calm()) window.addEventListener("pointermove", m, { passive: true });
    window.addEventListener("keydown", k);
    return () => { sc?.removeEventListener("scroll", f); window.removeEventListener("pointermove", m); window.removeEventListener("keydown", k); };
  }, [ready]);
  const items = useMemo(() => (d?.items || []).filter(it => it.photos?.length), [d]);
  const hero = useMemo(() => { const f = items.filter(it => it.featured && !it.cover); return (f.length ? f : items.filter(it => !it.cover).length ? items.filter(it => !it.cover) : items).slice(0, 8); }, [items]);
  const cats = useMemo(() => {
    const c = {};
    items.forEach(it => (it.categories || []).forEach(x => { c[x] = (c[x] || 0) + 1; }));
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [items]);
  const n3d = items.filter(it => it.has3d).length;
  const nColors = useMemo(() => new Set(items.flatMap(it => it.colors || [])).size, [items]);
  const nModels = useMemo(() => new Set(items.map(it => it.model?.creator).filter(Boolean)).size, [items]);
  const shown = useMemo(() => {
    const qq = norm(q.trim());
    let l = items.filter(it => (!cat || (it.categories || []).includes(cat)) && (!only3d || it.has3d)
      && (!qq || norm([it.title, it.note, it.model?.title, it.model?.creator, ...(it.categories || [])].join(" ")).includes(qq)));
    if (sort === "az") l = [...l].sort((a, b) => a.title.localeCompare(b.title, "fr"));
    else if (sort === "old") l = [...l].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    return l;
  }, [items, cat, only3d, q, sort]);
  // une piece ouverte se partage par son adresse (#p12) ; l'adresse qui en porte une l'ouvre
  useEffect(() => {
    if (!items.length) return;
    const h = window.location.hash.slice(1);
    const it = h && items.find(x => x.key === h);
    if (it) setOpen(it);
  }, [items]);
  const openIt = useCallback(it => { setOpen(it); try { window.history.replaceState(null, "", `#${it.key}`); } catch { /* rien */ } }, []);
  const close = useCallback(() => { setOpen(null); try { window.history.replaceState(null, "", window.location.pathname); } catch { /* rien */ } }, []);
  const list = shown.length ? shown : items;
  const goTo = useCallback(dd => setOpen(o => { if (!o) return o; const i = list.findIndex(x => x.key === o.key); const nx = list[(i + dd + list.length) % list.length];
    try { window.history.replaceState(null, "", `#${nx.key}`); } catch { /* rien */ } return nx; }), [list]);
  const accent = d?.accent || "#C9A96E";
  if (!d || d.error) return <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#08080B", color: "#EDEDED",
    fontFamily: SERIF, fontSize: 22, padding: 24, textAlign: "center" }}>{!d ? <span className="sc-spin" style={{ borderTopColor: "#C9A96E" }}/> : "Cette vitrine n'existe pas, a expiré ou a été retirée."}
    <style>{baseCss}</style></div>;
  const toCol = () => colRef.current?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
  return <div ref={rootRef} style={{ height: "100dvh", overflowY: "auto", overflowX: "hidden", background: "#08080B", color: "#EDEDED", position: "relative", "--sc-accent": accent }}>
    <style>{baseCss}{`
      .sc-viewer { grid-template-columns: minmax(0, 1fr) 380px; }
      @media (max-width: 900px) { .sc-viewer { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; } .sc-viewer aside { max-height: 40vh; } }
      .sc-hero { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: clamp(30px, 5vw, 80px); align-items: center; }
      .sc-deck { width: min(440px, 100%); aspect-ratio: 4 / 5; margin: 0 auto 60px; }
      @media (max-width: 900px) { .sc-hero { grid-template-columns: 1fr; } .sc-deck { width: min(340px, 82vw); } }
      .sc-masonry { --sc-gap: clamp(14px, 2vw, 24px); columns: 4; column-gap: var(--sc-gap); }
      @media (max-width: 1200px) { .sc-masonry { columns: 3; } }
      @media (max-width: 760px) { .sc-masonry { columns: 2; --sc-gap: 12px; } }
      .sc-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; -webkit-mask-image: linear-gradient(90deg, #000 92%, transparent); }
      .sc-chips::-webkit-scrollbar { display: none; }
      .sc-shine { background: linear-gradient(100deg, #fff 20%, ${accent} 40%, #fff 60%); background-size: 220% 100%; -webkit-background-clip: text; background-clip: text;
        color: transparent; animation: scShine 7s linear infinite; }
      .sc-cta { transition: transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s; }
      .sc-cta:hover { transform: translateY(-2px) scale(1.02); }
    `}</style>
    {/* l'aurore et le grain */}
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      <span className="sc-blob" style={{ background: accent, top: "-18%", left: "-10%" }}/>
      <span className="sc-blob" style={{ background: "#6D28D9", top: "10%", right: "-15%", animationDelay: "-6s", opacity: .28 }}/>
      <span className="sc-blob" style={{ background: "#0EA5E9", bottom: "-25%", left: "25%", animationDelay: "-12s", opacity: .18 }}/>
      <span style={{ position: "absolute", inset: 0, opacity: .07, backgroundImage: GRAIN }}/>
    </div>
    <div ref={glow} aria-hidden="true" style={{ position: "fixed", left: 0, top: 0, width: 600, height: 600, borderRadius: "50%", pointerEvents: "none", zIndex: 1,
      background: `radial-gradient(circle, color-mix(in srgb, ${accent} 16%, transparent), transparent 65%)`, transform: "translate3d(-999px,-999px,0)", transition: "transform .25s ease-out" }}/>
    {/* la barre du haut : transparente, puis verre au defilement */}
    <header style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 40, display: "flex", alignItems: "center", gap: 14, padding: scrolled ? "10px clamp(16px, 5vw, 64px)" : "20px clamp(16px, 5vw, 64px)",
      background: scrolled ? "rgba(8,8,11,.65)" : "transparent", backdropFilter: scrolled ? "blur(18px) saturate(1.4)" : "none", WebkitBackdropFilter: scrolled ? "blur(18px) saturate(1.4)" : "none",
      borderBottom: `1px solid ${scrolled ? "rgba(255,255,255,.07)" : "transparent"}`, transition: "all .4s" }}>
      <span style={{ fontFamily: SERIF, fontSize: scrolled ? 18 : 20, fontWeight: 600, color: "#fff", transition: "font-size .4s", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        <span style={{ color: accent }}>✦</span> {d.title}</span>
      <span style={{ flex: 1 }}/>
      <button type="button" onClick={() => { toCol(); setTimeout(() => searchRef.current?.focus(), 500); }} style={{ ...pillBtn, display: "inline-flex", alignItems: "center", gap: 8 }}>
        {LENS}<span className="sc-hide-sm">Rechercher</span><kbd className="sc-hide-sm" style={kbd}>/</kbd></button>
      {d.contact && <span className="sc-hide-sm" style={{ fontSize: 12.5, color: "rgba(255,255,255,.7)", maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.contact}</span>}
    </header>

    <main style={{ position: "relative", zIndex: 2 }}>
      {/* l'en-tete : le titre en grand, et le jeu de cartes des pieces phares */}
      <section className="sc-hero" style={{ maxWidth: 1360, margin: "0 auto", padding: "clamp(96px, 14vh, 140px) clamp(18px, 5vw, 64px) clamp(30px, 6vh, 70px)" }}>
        <div>
          <Reveal><span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 30, fontSize: 11.5, fontWeight: 800, letterSpacing: ".22em",
            textTransform: "uppercase", color: "rgba(255,255,255,.85)", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", backdropFilter: "blur(8px)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: accent, boxShadow: `0 0 12px ${accent}` }}/>Vitrine · imprimé en 3D</span></Reveal>
          <Reveal delay={120}><h1 className="sc-shine" style={{ margin: "22px 0 0", fontFamily: SERIF, fontWeight: 600, fontSize: "clamp(42px, 7vw, 96px)", lineHeight: .98, letterSpacing: "-.02em" }}>{d.title}</h1></Reveal>
          {d.tagline && <Reveal delay={240}><p style={{ margin: "22px 0 0", maxWidth: 520, fontSize: "clamp(15px, 1.5vw, 18px)", lineHeight: 1.7, color: "rgba(255,255,255,.66)" }}>{d.tagline}</p></Reveal>}
          <Reveal delay={360} style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 30 }}>
            <button type="button" className="sc-cta" onClick={toCol} style={{ padding: "14px 28px", borderRadius: 40, cursor: "pointer", fontSize: 13, fontWeight: 800, letterSpacing: ".14em",
              textTransform: "uppercase", color: "#0B0B0F", background: accent, border: "none", boxShadow: `0 18px 50px -14px ${accent}` }}>Explorer la collection ↓</button>
            {d.sale?.length > 0 && <a href="#boutique" className="sc-cta" style={{ padding: "14px 24px", borderRadius: 40, fontSize: 13, fontWeight: 800, letterSpacing: ".14em",
              textTransform: "uppercase", color: "#fff", textDecoration: "none", border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.04)" }}>La boutique</a>}
          </Reveal>
          <Reveal delay={480} style={{ display: "flex", gap: "clamp(18px, 3vw, 40px)", marginTop: 40, flexWrap: "wrap" }}>
            {[[items.length, "pièces"], [nColors, "couleurs"], n3d ? [n3d, "en 3D"] : nModels ? [nModels, "créateurs"] : null].filter(Boolean).map(([v, l]) =>
              <div key={l}><div style={{ fontFamily: SERIF, fontSize: "clamp(28px, 3.4vw, 42px)", color: "#fff", lineHeight: 1 }}><Count to={v}/></div>
                <div style={{ fontSize: 11, letterSpacing: ".24em", textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginTop: 6 }}>{l}</div></div>)}
          </Reveal>
        </div>
        <Reveal delay={200}><Deck items={hero} accent={accent} onOpen={openIt}/></Reveal>
      </section>

      {/* le ruban des noms */}
      {items.length > 2 && <div aria-hidden="true" style={{ overflow: "hidden", borderTop: "1px solid rgba(255,255,255,.06)", borderBottom: "1px solid rgba(255,255,255,.06)", padding: "16px 0",
        background: "rgba(255,255,255,.015)" }}>
        <div className="sc-marquee" style={{ display: "flex", gap: 34, width: "max-content" }}>
          {[0, 1].map(r => <div key={r} style={{ display: "flex", gap: 34, alignItems: "center" }}>
            {items.slice(0, 24).map(it => <span key={it.key} style={{ display: "inline-flex", alignItems: "center", gap: 34, fontFamily: SERIF, fontSize: "clamp(20px, 2.4vw, 30px)",
              color: "transparent", WebkitTextStroke: "1px rgba(255,255,255,.35)", whiteSpace: "nowrap" }}>{it.title}<span style={{ color: accent, WebkitTextStroke: 0, fontSize: 16 }}>✦</span></span>)}
          </div>)}
        </div>
      </div>}

      {/* la collection */}
      <section ref={colRef} style={{ maxWidth: 1440, margin: "0 auto", padding: "clamp(50px, 8vw, 100px) clamp(14px, 4vw, 56px) clamp(60px, 9vw, 120px)", scrollMarginTop: 60 }}>
        <Reveal style={{ display: "flex", alignItems: "flex-end", flexWrap: "wrap", gap: 14, marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontFamily: SERIF, fontWeight: 500, fontSize: "clamp(30px, 4vw, 52px)", color: "#fff", lineHeight: 1 }}>La collection</h2>
          <span style={{ fontSize: 12, letterSpacing: ".22em", textTransform: "uppercase", color: "rgba(255,255,255,.45)", paddingBottom: 6 }}>
            {shown.length} pièce{shown.length > 1 ? "s" : ""}{shown.length !== items.length ? ` sur ${items.length}` : ""}</span>
        </Reveal>
        {/* la barre de recherche et de tri, qui reste en haut */}
        <div style={{ position: "sticky", top: scrolled ? 58 : 70, zIndex: 20, display: "flex", flexDirection: "column", gap: 10, padding: "10px 0 14px", marginBottom: 8,
          background: "linear-gradient(#08080B 70%, transparent)", transition: "top .4s" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ flex: "1 1 260px", position: "relative", display: "flex", alignItems: "center" }}>
              <span style={{ position: "absolute", left: 16, color: "rgba(255,255,255,.5)", display: "flex", pointerEvents: "none" }}>{LENS}</span>
              <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher une pièce, un modèle, un créateur…" aria-label="Rechercher"
                style={{ width: "100%", height: 46, padding: "0 40px 0 42px", borderRadius: 30, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.05)",
                  color: "#fff", fontSize: 14.5, outline: "none", backdropFilter: "blur(10px)", boxShadow: q ? `0 0 0 3px color-mix(in srgb, ${accent} 30%, transparent)` : "none", transition: "box-shadow .3s" }}/>
              {q && <button type="button" onClick={() => setQ("")} aria-label="Effacer" style={{ position: "absolute", right: 10, ...roundBtn, width: 28, height: 28, fontSize: 14 }}>×</button>}
            </label>
            {n3d > 0 && <button type="button" onClick={() => setOnly3d(v => !v)} aria-pressed={only3d} style={{ ...pillBtn, height: 46, padding: "0 18px",
              background: only3d ? accent : "rgba(255,255,255,.05)", color: only3d ? "#0B0B0F" : "#fff", borderColor: only3d ? accent : "rgba(255,255,255,.12)" }}>🧊 En 3D · {n3d}</button>}
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Trier" style={{ ...pillBtn, height: 46, padding: "0 16px", appearance: "none", WebkitAppearance: "none" }}>
              <option value="recent" style={{ color: "#111" }}>Les plus récentes</option>
              <option value="old" style={{ color: "#111" }}>Les plus anciennes</option>
              <option value="az" style={{ color: "#111" }}>De A à Z</option>
            </select>
          </div>
          {cats.length > 1 && <div className="sc-chips">
            {[["", items.length], ...cats].map(([c, nn]) => <button key={c || "_"} type="button" onClick={() => setCat(c)} style={{ flexShrink: 0, padding: "8px 15px", borderRadius: 30,
              cursor: "pointer", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 800, border: `1px solid ${cat === c ? accent : "rgba(255,255,255,.14)"}`,
              background: cat === c ? accent : "rgba(255,255,255,.03)", color: cat === c ? "#0B0B0F" : "rgba(255,255,255,.75)", transition: "all .3s" }}>
              {c || "Tout"} <span style={{ opacity: .6, fontWeight: 700 }}>{nn}</span></button>)}
          </div>}
        </div>
        {shown.length ? <div className="sc-masonry" key={`${cat}|${only3d}|${sort}`}>
          {shown.map((it, i) => <Card key={it.key} it={it} i={i} accent={accent} onOpen={openIt}/>)}
        </div> : <div style={{ textAlign: "center", padding: "70px 20px", color: "rgba(255,255,255,.6)" }}>
          <div style={{ fontFamily: SERIF, fontSize: 28, color: "#fff" }}>Rien de ce côté-là</div>
          <div style={{ marginTop: 8 }}>Aucune pièce ne répond à « {q} ».</div>
          <button type="button" onClick={() => { setQ(""); setCat(""); setOnly3d(false); }} style={{ ...pillBtn, marginTop: 18 }}>Tout revoir</button></div>}
      </section>

      {/* la boutique, en carrousel */}
      {d.sale?.length > 0 && <section id="boutique" style={{ padding: "clamp(60px, 9vw, 110px) 0", background: "linear-gradient(180deg, transparent, rgba(255,255,255,.025) 30%, transparent)", scrollMarginTop: 60 }}>
        <Reveal style={{ textAlign: "center", marginBottom: 34, padding: "0 20px" }}>
          <div style={{ fontSize: 11, letterSpacing: ".34em", textTransform: "uppercase", color: accent }}>Disponibles</div>
          <h2 style={{ margin: "10px 0 0", fontFamily: SERIF, fontWeight: 500, fontSize: "clamp(30px, 4vw, 52px)", color: "#fff" }}>La boutique</h2>
        </Reveal>
        <div style={{ display: "flex", gap: 18, overflowX: "auto", scrollSnapType: "x mandatory", padding: "10px clamp(18px, 5vw, 64px) 26px", scrollbarWidth: "none" }}>
          {d.sale.map((o, i) => <Reveal key={o.id} delay={(i % 5) * 80} style={{ flex: "0 0 clamp(220px, 26vw, 300px)", scrollSnapAlign: "start" }}>
            <div className="sc-cta" style={{ position: "relative", aspectRatio: "4 / 5", overflow: "hidden", borderRadius: 22, background: "#15151B", boxShadow: "0 24px 50px -30px rgba(0,0,0,.9)" }}>
              <Framed src={mid(o.img)} alt={o.title} style={{ position: "absolute", inset: 0 }}/>
              <span style={{ position: "absolute", top: 12, left: 12, padding: "7px 13px", borderRadius: 30, fontSize: 14, fontWeight: 900, background: accent, color: "#0B0B0F",
                boxShadow: `0 10px 30px -10px ${accent}` }}>{price(o.price)}</span>
            </div>
            <div style={{ padding: "12px 4px 0", fontFamily: SERIF, fontSize: 18, color: "#F5F5F4" }}>{o.title}</div>
          </Reveal>)}
        </div>
        {d.contact && <Reveal style={{ textAlign: "center", marginTop: 20, fontSize: 15.5, color: "rgba(255,255,255,.75)", padding: "0 20px" }}>
          Une pièce vous plaît ? <span style={{ color: accent, fontWeight: 800 }}>{d.contact}</span></Reveal>}
      </section>}

      <footer style={{ position: "relative", padding: "60px 24px 44px", textAlign: "center", overflow: "hidden" }}>
        <div aria-hidden="true" style={{ fontFamily: SERIF, fontSize: "clamp(48px, 12vw, 170px)", lineHeight: .9, color: "transparent", WebkitTextStroke: "1px rgba(255,255,255,.08)",
          whiteSpace: "nowrap", userSelect: "none" }}>{d.title}</div>
        {d.contact && !d.sale?.length && <div style={{ marginTop: 18, fontSize: 15, color: "rgba(255,255,255,.75)" }}>{d.contact}</div>}
        <div style={{ marginTop: 18, fontSize: 11.5, letterSpacing: ".24em", textTransform: "uppercase", color: "rgba(255,255,255,.38)" }}>Imprimé en 3D · Fait avec BambuNymous</div>
      </footer>
    </main>
    {open && <Viewer it={open} list={list} token={token} accent={accent} onClose={close} onGo={goTo}/>}
  </div>;
}

const LENS = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>;
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
const baseCss = `
  @keyframes scIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes scPop { from { opacity: 0; transform: translateY(18px) scale(.97); } to { opacity: 1; transform: none; } }
  @keyframes scFade { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
  @keyframes scShine { from { background-position: 120% 0; } to { background-position: -120% 0; } }
  @keyframes scDrift { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(8vw, 6vh) scale(1.15); } 66% { transform: translate(-6vw, 4vh) scale(.92); } }
  @keyframes scMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @keyframes scSpin { to { transform: rotate(360deg); } }
  .sc-blob { position: absolute; width: 55vmax; height: 55vmax; border-radius: 50%; filter: blur(110px); opacity: .22; animation: scDrift 24s ease-in-out infinite; }
  .sc-marquee { animation: scMarquee 60s linear infinite; }
  .sc-marquee:hover { animation-play-state: paused; }
  .sc-spin { width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgba(255,255,255,.12); animation: scSpin .9s linear infinite; display: inline-block; }
  @media (max-width: 640px) { .sc-hide-sm { display: none !important; } }
  @media (prefers-reduced-motion: reduce) { .sc-blob, .sc-marquee, .sc-shine { animation: none !important; } }
`;
const roundBtn = { width: 44, height: 44, borderRadius: "50%", border: "1px solid rgba(255,255,255,.18)", background: "rgba(10,10,14,.45)", color: "#fff", fontSize: 24, lineHeight: 1,
  cursor: "pointer", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3 };
const pillBtn = { padding: "9px 16px", borderRadius: 30, border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)", color: "#fff", fontSize: 13, fontWeight: 800,
  cursor: "pointer", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", whiteSpace: "nowrap" };
const kbd = { fontSize: 11, padding: "1px 6px", borderRadius: 6, border: "1px solid rgba(255,255,255,.25)", color: "rgba(255,255,255,.7)", fontFamily: "inherit" };
const glassTag = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", padding: "4px 9px", borderRadius: 20, background: "rgba(0,0,0,.45)", color: "#fff",
  backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" };
const chip3d = { fontSize: 10.5, fontWeight: 900, letterSpacing: ".08em", padding: "4px 9px", borderRadius: 20, color: "#0B0B0F", background: "var(--sc-accent, #C9A96E)",
  boxShadow: "0 6px 18px -6px var(--sc-accent, #C9A96E)" };
const label = { fontSize: 11, letterSpacing: ".24em", textTransform: "uppercase", color: "rgba(255,255,255,.5)" };
