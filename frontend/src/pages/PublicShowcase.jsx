import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiThumb } from "../api/client";

// La vitrine publique (04/11/2026) : /vitrine/<lien>, sans compte -- un portfolio sombre et soigne, comme une boutique :
// le grand carrousel des pieces phares (fondu et lent zoom), la collection filtrable, une visionneuse plein ecran par
// piece (photos, date, couleurs, modele et createur), et les objets a vendre. Lue par fetch (ni jeton, ni copain).
const SERIF = "'Playfair Display', 'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const monthFr = ym => ym ? new Date(`${ym}-15T12:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "";
const price = v => `${Number(v || 0).toLocaleString("fr-FR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const big = u => apiThumb(u, 1600);
const mid = u => apiThumb(u, 700);

function useReveal() {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on];
}

function Reveal({ children, delay = 0, style }) {
  const [ref, on] = useReveal();
  return <div ref={ref} style={{ ...style, opacity: on ? 1 : 0, transform: on ? "none" : "translateY(26px)", transition: `opacity .9s ${delay}ms, transform .9s cubic-bezier(.2,.8,.2,1) ${delay}ms` }}>{children}</div>;
}

const Dots = ({ colors, size = 12 }) => <span style={{ display: "inline-flex", gap: 5 }}>
  {(colors || []).slice(0, 6).map(c => <span key={c} style={{ width: size, height: size, borderRadius: "50%", background: `#${c}`, boxShadow: "inset 0 0 0 1px rgba(255,255,255,.25)" }}/>)}</span>;

// le grand carrousel : les pieces phares, en fondu, chacune avec un lent zoom ; glisser, fleches, points ; pause au survol
function Hero({ items, accent, onOpen }) {
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const start = useRef(null);
  const n = items.length;
  useEffect(() => {
    if (n < 2 || hover) return undefined;
    const t = setTimeout(() => setI(x => (x + 1) % n), 5600);
    return () => clearTimeout(t);
  }, [i, n, hover]);
  if (!n) return null;
  const go = d => setI(x => (x + d + n) % n);
  return <section onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    onPointerDown={e => { start.current = e.clientX; }} onPointerUp={e => { if (start.current != null && Math.abs(e.clientX - start.current) > 40) go(e.clientX < start.current ? 1 : -1); start.current = null; }}
    style={{ position: "relative", height: "min(82vh, 860px)", minHeight: 420, overflow: "hidden", background: "#000", touchAction: "pan-y" }}>
    {items.map((it, k) => <div key={it.key} aria-hidden={k !== i} style={{ position: "absolute", inset: 0, opacity: k === i ? 1 : 0, transition: "opacity 1.4s ease" }}>
      <img src={big(it.photos[0])} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover",
        transform: k === i ? "scale(1.09)" : "scale(1)", transition: k === i ? "transform 7s ease-out" : "transform 1.4s", filter: "saturate(1.05)" }}/>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,.35) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,.15) 55%, rgba(0,0,0,.85) 100%)" }}/>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "0 clamp(20px, 6vw, 80px) clamp(54px, 9vh, 96px)", maxWidth: 1100 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".32em", textTransform: "uppercase", color: accent, marginBottom: 12,
          opacity: k === i ? 1 : 0, transform: k === i ? "none" : "translateY(12px)", transition: "all .9s .3s" }}>
          {[it.categories?.[0], monthFr(it.date)].filter(Boolean).join(" · ") || "Pièce phare"}</div>
        <h2 style={{ margin: 0, fontFamily: SERIF, fontWeight: 600, fontSize: "clamp(34px, 6.5vw, 76px)", lineHeight: 1.02, color: "#fff", letterSpacing: "-.01em",
          opacity: k === i ? 1 : 0, transform: k === i ? "none" : "translateY(18px)", transition: "all 1s .45s", textShadow: "0 8px 40px rgba(0,0,0,.5)" }}>{it.title}</h2>
        {it.note && <p style={{ margin: "14px 0 0", maxWidth: 560, fontSize: "clamp(14px, 1.6vw, 17px)", lineHeight: 1.6, color: "rgba(255,255,255,.82)",
          opacity: k === i ? 1 : 0, transition: "opacity 1s .65s" }}>{it.note}</p>}
        <button type="button" onClick={() => onOpen(it)} style={{ marginTop: 22, padding: "12px 26px", borderRadius: 40, cursor: "pointer", fontSize: 13, fontWeight: 800,
          letterSpacing: ".18em", textTransform: "uppercase", color: "#0B0B0F", background: accent, border: "none", boxShadow: `0 14px 40px -12px ${accent}`,
          opacity: k === i ? 1 : 0, transition: "opacity 1s .8s" }}>Découvrir</button>
      </div>
    </div>)}
    {n > 1 && <>
      <button type="button" aria-label="Précédente" onClick={() => go(-1)} style={{ ...arrow, left: 18 }}>‹</button>
      <button type="button" aria-label="Suivante" onClick={() => go(1)} style={{ ...arrow, right: 18 }}>›</button>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, display: "flex", justifyContent: "center", gap: 8 }}>
        {items.map((it, k) => <button key={it.key} type="button" aria-label={`Pièce ${k + 1}`} onClick={() => setI(k)}
          style={{ width: k === i ? 34 : 10, height: 4, borderRadius: 4, border: "none", padding: 0, cursor: "pointer", background: k === i ? accent : "rgba(255,255,255,.4)",
            transition: "all .5s" }}/>)}
      </div>
    </>}
  </section>;
}

// la visionneuse d'une piece : ses photos en grand (glisser, fleches, vignettes), et ce qu'on sait d'elle
function Viewer({ it, accent, onClose }) {
  const [k, setK] = useState(0);
  const start = useRef(null);
  const n = it.photos.length;
  useEffect(() => {
    const f = e => { if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight") setK(x => (x + 1) % n); else if (e.key === "ArrowLeft") setK(x => (x - 1 + n) % n); };
    window.addEventListener("keydown", f);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", f); document.body.style.overflow = ""; };
  }, [n, onClose]);
  return <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(6,6,9,.96)", backdropFilter: "blur(10px)",
    display: "flex", flexDirection: "column", animation: "scIn .35s ease" }}>
    <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", color: "rgba(255,255,255,.7)", fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase" }}>
      <span style={{ flex: 1 }}>{n > 1 ? `${k + 1} / ${n}` : ""}</span>
      <button type="button" onClick={onClose} aria-label="Fermer" style={{ ...arrow, position: "static", transform: "none", width: 42, height: 42, fontSize: 22 }}>×</button>
    </div>
    <div className="sc-viewer" onClick={e => e.stopPropagation()} style={{ flex: 1, minHeight: 0, display: "grid", gap: 24, padding: "0 clamp(12px, 4vw, 48px) 24px" }}>
      <div onPointerDown={e => { start.current = e.clientX; }} onPointerUp={e => { if (start.current != null && Math.abs(e.clientX - start.current) > 40) setK(x => (x + (e.clientX < start.current ? 1 : -1) + n) % n); start.current = null; }}
        style={{ position: "relative", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "pan-y" }}>
        <img key={k} src={big(it.photos[k])} alt={it.title} draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6,
          boxShadow: "0 30px 80px rgba(0,0,0,.6)", animation: "scFade .5s ease" }}/>
        {n > 1 && <>
          <button type="button" aria-label="Précédente" onClick={() => setK(x => (x - 1 + n) % n)} style={{ ...arrow, left: 4 }}>‹</button>
          <button type="button" aria-label="Suivante" onClick={() => setK(x => (x + 1) % n)} style={{ ...arrow, right: 4 }}>›</button></>}
      </div>
      <aside style={{ color: "#EDEDED", overflowY: "auto", minHeight: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".3em", textTransform: "uppercase", color: accent }}>
          {[it.kind === "group" && it.count > 1 ? `${it.count} pièces` : null, it.categories?.join(" · ")].filter(Boolean).join(" · ") || "Impression 3D"}</div>
        <h3 style={{ margin: "10px 0 6px", fontFamily: SERIF, fontWeight: 600, fontSize: "clamp(28px, 3.4vw, 42px)", lineHeight: 1.08, color: "#fff" }}>{it.title}</h3>
        {it.date && <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.6)" }}>Imprimé en {monthFr(it.date)}</div>}
        {it.note && <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "rgba(255,255,255,.85)", margin: "18px 0 0" }}>{it.note}</p>}
        {it.colors?.length > 0 && <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: ".24em", textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: 8 }}>Couleurs</div>
          <Dots colors={it.colors} size={20}/></div>}
        {it.model && <div style={{ marginTop: 22, padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.03)" }}>
          <div style={{ fontSize: 11, letterSpacing: ".24em", textTransform: "uppercase", color: "rgba(255,255,255,.5)" }}>Modèle</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{it.model.title}</div>
          {it.model.creator && <div style={{ fontSize: 13, color: "rgba(255,255,255,.65)" }}>conçu par {it.model.creator}</div>}
          <a href={it.model.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 12.5, fontWeight: 800, color: accent, textDecoration: "none", letterSpacing: ".08em" }}>
            Voir sur MakerWorld ↗</a></div>}
        {n > 1 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 8, marginTop: 22 }}>
          {it.photos.map((p, j) => <button key={p} type="button" onClick={() => setK(j)} style={{ padding: 0, border: "none", borderRadius: 8, overflow: "hidden", cursor: "pointer",
            aspectRatio: "1", outline: j === k ? `2px solid ${accent}` : "none", outlineOffset: 2, opacity: j === k ? 1 : .55, transition: "opacity .3s" }}>
            <img src={apiThumb(p, 160)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/></button>)}
        </div>}
      </aside>
    </div>
  </div>;
}

function Card({ it, accent, onOpen, i }) {
  const [hov, setHov] = useState(false);
  return <Reveal delay={(i % 4) * 90}>
    <button type="button" onClick={() => onOpen(it)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: "block", width: "100%", padding: 0, border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "inherit" }}>
      <div style={{ position: "relative", aspectRatio: "4 / 5", overflow: "hidden", borderRadius: 4, background: "#16161C",
        boxShadow: hov ? "0 30px 60px -24px rgba(0,0,0,.8)" : "0 10px 30px -18px rgba(0,0,0,.6)", transform: hov ? "translateY(-4px)" : "none", transition: "all .5s cubic-bezier(.2,.8,.2,1)" }}>
        <img src={mid(it.photos[0])} alt={it.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", transform: hov ? "scale(1.07)" : "scale(1)",
          transition: "transform 1.1s cubic-bezier(.2,.8,.2,1)" }}/>
        {it.photos[1] && <img src={mid(it.photos[1])} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
          opacity: hov ? 1 : 0, transition: "opacity .7s" }}/>}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 55%, rgba(0,0,0,.6))", opacity: hov ? 1 : .7, transition: "opacity .5s" }}/>
        {it.photos.length > 1 && <span style={{ position: "absolute", top: 12, right: 12, fontSize: 11, fontWeight: 800, letterSpacing: ".08em", padding: "4px 9px", borderRadius: 20,
          background: "rgba(0,0,0,.45)", color: "#fff", backdropFilter: "blur(6px)" }}>{it.photos.length} photos</span>}
        <div style={{ position: "absolute", left: 14, bottom: 12 }}><Dots colors={it.colors}/></div>
      </div>
      <div style={{ padding: "14px 2px 0" }}>
        <div style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, color: "#F5F5F4", lineHeight: 1.25 }}>{it.title}</div>
        <div style={{ marginTop: 4, fontSize: 11.5, letterSpacing: ".18em", textTransform: "uppercase", color: hov ? accent : "rgba(255,255,255,.45)", transition: "color .4s" }}>
          {[it.categories?.[0], monthFr(it.date)].filter(Boolean).join(" · ")}</div>
      </div>
    </button>
  </Reveal>;
}

export default function PublicShowcase() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);
  const [cat, setCat] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/showcase/public/${encodeURIComponent(token || "")}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(x => alive && setD(x)).catch(() => alive && setD({ error: true }));
    return () => { alive = false; };
  }, [token]);
  useEffect(() => { if (d?.title) document.title = d.title; }, [d?.title]);
  const items = useMemo(() => (d?.items || []).filter(it => it.photos?.length), [d]);
  const hero = useMemo(() => { const f = items.filter(it => it.featured); return (f.length ? f : items).slice(0, 8); }, [items]);
  const cats = useMemo(() => [...new Set(items.flatMap(it => it.categories || []))].slice(0, 10), [items]);
  const shown = cat ? items.filter(it => (it.categories || []).includes(cat)) : items;
  const accent = d?.accent || "#C9A96E";
  if (!d || d.error) return <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0B0B0F", color: "#EDEDED",
    fontFamily: SERIF, fontSize: 22, padding: 24, textAlign: "center" }}>{!d ? "…" : "Cette vitrine n'existe pas, a expiré ou a été retirée."}</div>;
  return <div style={{ minHeight: "100vh", background: "#0B0B0F", color: "#EDEDED", overflowX: "hidden" }}>
    <style>{`
      @keyframes scIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes scFade { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
      .sc-viewer { grid-template-columns: minmax(0, 1fr) 360px; }
      @media (max-width: 860px) { .sc-viewer { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; } .sc-viewer aside { max-height: 38vh; } }
      .sc-grid { display: grid; gap: clamp(18px, 2.6vw, 34px); grid-template-columns: repeat(4, minmax(0, 1fr)); }
      @media (max-width: 1100px) { .sc-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      @media (max-width: 760px) { .sc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; } }
    `}</style>
    {/* l'en-tete, pose sur le carrousel (et defile avec lui) */}
    <div style={{ position: "relative" }}>
    <header style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 5, display: "flex", alignItems: "center", padding: "22px clamp(20px, 6vw, 80px)" }}>
      <span style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 600, color: "#fff", letterSpacing: ".02em", textShadow: "0 2px 18px rgba(0,0,0,.5)" }}>{d.title}</span>
      <span style={{ flex: 1 }}/>
      <span style={{ fontSize: 11, letterSpacing: ".3em", textTransform: "uppercase", color: "rgba(255,255,255,.75)" }}>{items.length} pièce{items.length > 1 ? "s" : ""}</span>
    </header>
    <Hero items={hero} accent={accent} onOpen={setOpen}/>
    </div>
    {/* l'accroche */}
    <Reveal style={{ maxWidth: 820, margin: "0 auto", padding: "clamp(56px, 9vw, 110px) 24px clamp(30px, 5vw, 60px)", textAlign: "center" }}>
      <div style={{ width: 46, height: 1, background: accent, margin: "0 auto 26px" }}/>
      <h1 style={{ margin: 0, fontFamily: SERIF, fontWeight: 500, fontSize: "clamp(30px, 4.6vw, 54px)", lineHeight: 1.12, color: "#fff" }}>{d.title}</h1>
      {d.tagline && <p style={{ margin: "18px auto 0", maxWidth: 600, fontSize: "clamp(15px, 1.7vw, 18px)", lineHeight: 1.7, color: "rgba(255,255,255,.65)" }}>{d.tagline}</p>}
    </Reveal>
    {/* la collection */}
    <section style={{ maxWidth: 1360, margin: "0 auto", padding: "0 clamp(16px, 5vw, 64px) clamp(60px, 9vw, 120px)" }}>
      <Reveal style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 18, marginBottom: 30 }}>
        <h2 style={{ margin: 0, fontFamily: SERIF, fontWeight: 500, fontSize: "clamp(26px, 3.2vw, 38px)", color: "#fff" }}>La collection</h2>
        {cats.length > 1 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["", ...cats].map(c => <button key={c || "_"} type="button" onClick={() => setCat(c)} style={{ padding: "7px 15px", borderRadius: 30, cursor: "pointer", fontSize: 12,
            letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700, border: `1px solid ${cat === c ? accent : "rgba(255,255,255,.18)"}`,
            background: cat === c ? accent : "transparent", color: cat === c ? "#0B0B0F" : "rgba(255,255,255,.75)", transition: "all .3s" }}>{c || "Tout"}</button>)}
        </div>}
      </Reveal>
      <div className="sc-grid">{shown.map((it, i) => <Card key={it.key} it={it} i={i} accent={accent} onOpen={setOpen}/>)}</div>
    </section>
    {/* la boutique */}
    {d.sale?.length > 0 && <section style={{ background: "linear-gradient(180deg, #0B0B0F, #121218 30%, #0B0B0F)", padding: "clamp(60px, 9vw, 110px) clamp(16px, 5vw, 64px)" }}>
      <div style={{ maxWidth: 1360, margin: "0 auto" }}>
        <Reveal style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 11, letterSpacing: ".34em", textTransform: "uppercase", color: accent }}>Disponibles</div>
          <h2 style={{ margin: "10px 0 0", fontFamily: SERIF, fontWeight: 500, fontSize: "clamp(28px, 3.6vw, 44px)", color: "#fff" }}>La boutique</h2>
        </Reveal>
        <div className="sc-grid">
          {d.sale.map((o, i) => <Reveal key={o.id} delay={(i % 4) * 90}>
            <div style={{ position: "relative", aspectRatio: "1", overflow: "hidden", borderRadius: 4, background: "#16161C" }}>
              <img src={mid(o.img)} alt={o.title} loading="lazy" onError={e => { e.currentTarget.style.opacity = 0; }} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
              <span style={{ position: "absolute", top: 12, left: 12, padding: "6px 12px", borderRadius: 30, fontSize: 13, fontWeight: 800, background: accent, color: "#0B0B0F" }}>{price(o.price)}</span>
            </div>
            <div style={{ padding: "12px 2px 0", fontFamily: SERIF, fontSize: 18, color: "#F5F5F4" }}>{o.title}</div>
          </Reveal>)}
        </div>
        {d.contact && <Reveal style={{ textAlign: "center", marginTop: 40, fontSize: 15, color: "rgba(255,255,255,.75)" }}>
          Une pièce vous plaît ? <span style={{ color: accent, fontWeight: 700 }}>{d.contact}</span></Reveal>}
      </div>
    </section>}
    <footer style={{ borderTop: "1px solid rgba(255,255,255,.07)", padding: "34px 24px 40px", textAlign: "center", fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase",
      color: "rgba(255,255,255,.4)" }}>
      {d.contact && !d.sale?.length && <div style={{ marginBottom: 12, letterSpacing: ".05em", textTransform: "none", fontSize: 14, color: "rgba(255,255,255,.7)" }}>{d.contact}</div>}
      Imprimé en 3D · Fait avec BambuNymous
    </footer>
    {open && <Viewer it={open} accent={accent} onClose={() => setOpen(null)}/>}
  </div>;
}

const arrow = { position: "absolute", top: "50%", transform: "translateY(-50%)", zIndex: 3, width: 48, height: 48, borderRadius: "50%", border: "1px solid rgba(255,255,255,.25)",
  background: "rgba(0,0,0,.25)", color: "#fff", fontSize: 26, lineHeight: 1, cursor: "pointer", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" };
