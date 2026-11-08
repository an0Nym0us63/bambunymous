// Le diaporama de la galerie des vues 3D (08/11/2026) : toucher une tuile montre ses vues 3D, puis ses animations, et en
// dernier le modele a faire tourner, comme la vitrine (l'assemblage du groupe, sinon la vue assemblee du modele : celle
// qui a servi a la vignette). Fleches, glisser, clavier ; la bande du bas saute a une vue ; « Vue 3D complete » ouvre la
// vue de l'appli (edition, plateaux…), « Fiche » la fiche de l'impression ou du groupe.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import client, { apiUrl, apiThumb } from "../api/client";
import { useStackZ } from "../utils/zstack";
import Piece3D from "./Piece3D";

const u = url => url ? apiUrl(String(url).replace(/^\/api\/v1/, "")) : null;
const btn = { height: 38, padding: "0 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.1)", color: "#fff",
  cursor: "pointer", fontSize: 13, fontWeight: 800, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", whiteSpace: "nowrap" };

export default function Vue3DSlides({ item, onClose, onFull, onFiche }) {
  const z = useStackZ(6800);
  const vues = (item.photos || []).map((p, i) => ({ k: `v${i}`, kind: "vue", src: u(p.url), label: `🧊 Vue ${i + 1}${p.sel ? " · vignette" : ""}` }));
  const anims = (item.anims || []).map((a, i) => ({ k: `a${i}`, kind: "anim", src: u(a.url), label: `🎬 ${a.label}` }));
  const can3d = !!(item.design_id || item.design_3d) || item.kind === "group";
  const slides = [...vues, ...anims, ...(can3d ? [{ k: "3d", kind: "3d", label: "🧊 Le modèle en 3D" }] : [])];
  const [i, setI] = useState(0);
  const go = d => setI(x => Math.max(0, Math.min(slides.length - 1, x + d)));
  const cur = slides[i] || slides[0];
  const start = useRef(null);
  useEffect(() => {
    const f = e => { if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [slides.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = `${item.kind === "group" ? "g" : "p"}${item.id}`;
  if (!cur) return null;
  // glisser pour passer a la suivante, sauf sur la 3D (le doigt y fait tourner le modele)
  const touch = cur.kind === "3d" ? {} : {
    onTouchStart: e => { start.current = e.touches[0].clientX; },
    onTouchEnd: e => { if (start.current == null) return; const dx = e.changedTouches[0].clientX - start.current; start.current = null; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); },
  };
  return createPortal(<div style={{ position: "fixed", inset: 0, zIndex: z, background: "radial-gradient(80% 70% at 50% 40%, #1b2133, #07090f)", display: "flex", flexDirection: "column", color: "#fff" }}>
    {/* en haut : le titre, ou on en est, fermer */}
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(10px + env(safe-area-inset-top, 0px)) 14px 8px" }}>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 15, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
        <span style={{ fontSize: 12, fontWeight: 700, opacity: .75 }}>{i + 1} / {slides.length} · {cur.label}</span>
      </span>
      {onFiche && <button type="button" onClick={onFiche} style={btn}>📄 Fiche</button>}
      <button type="button" onClick={onClose} aria-label="Fermer" style={{ ...btn, width: 38, padding: 0 }}>✕</button>
    </div>
    {/* la vue montree */}
    <div {...touch} style={{ position: "relative", flex: 1, minHeight: 0, margin: "0 10px" }}>
      {cur.kind === "3d"
        ? <div style={{ position: "absolute", inset: 0, borderRadius: 18, overflow: "hidden" }}>
            <Piece3D key={key} accent="#0EA5E9" load={() => client.get(`/showcase/piece3d/${key}`).then(r => r.data)}/>
            {onFull && <button type="button" onClick={onFull} style={{ ...btn, position: "absolute", right: 12, bottom: 12, zIndex: 2,
              background: "linear-gradient(135deg, #0EA5E9, #6366F1)", border: "none" }}>✏️ Vue 3D complète</button>}
          </div>
        : cur.kind === "anim"
          ? <video key={cur.src} src={cur.src} autoPlay loop muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}/>
          : <img key={cur.src} src={cur.src} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain",
              filter: "drop-shadow(0 18px 30px rgba(0,0,0,.45))" }}/>}
      {i > 0 && <button type="button" onClick={() => go(-1)} aria-label="Précédente" style={{ ...btn, position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", width: 42, height: 42, padding: 0, borderRadius: "50%", zIndex: 3 }}>‹</button>}
      {i < slides.length - 1 && <button type="button" onClick={() => go(1)} aria-label="Suivante" style={{ ...btn, position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 42, height: 42, padding: 0, borderRadius: "50%", zIndex: 3 }}>›</button>}
    </div>
    {/* la bande : chaque vue, chaque animation, puis la 3D */}
    <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 14px calc(12px + env(safe-area-inset-bottom, 0px))", justifyContent: slides.length < 8 ? "center" : "flex-start" }}>
      {slides.map((s, k) => <button key={s.k} type="button" onClick={() => setI(k)} data-tip={s.label} style={{ flexShrink: 0, width: 58, height: 58, padding: 0, borderRadius: 12,
        overflow: "hidden", cursor: "pointer", border: k === i ? "2.5px solid #0EA5E9" : "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.06)", opacity: k === i ? 1 : .7,
        display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 900 }}>
        {s.kind === "3d" ? <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}><span style={{ fontSize: 20 }}>🧊</span>3D</span>
          : s.kind === "anim" ? <video src={s.src} muted loop autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}/>
          : <img src={apiThumb(s.src, 128)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }}/>}
      </button>)}
    </div>
  </div>, document.body);
}
