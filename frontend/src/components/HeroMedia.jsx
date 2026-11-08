// Une image d'en-tete de fiche, ou une animation de la vue 3D integree comme elle (08/11/2026) : ses bords fondent dans le
// halo de la fiche (un masque doux), son decor ne fait plus un rectangle pose dessus. Avec des vues : elle defile parmi
// elles (CycleImg), le temps de sa boucle (durs : la duree de chaque video, relevee a son chargement).
import React from "react";

export const isVid = u => /\.(webm|mp4|mov|m4v)(\?|$)/i.test(u || "");
const MASK = "radial-gradient(ellipse closest-side, #000 60%, transparent 100%)";

export default function HeroMedia({ u, on = true, durs = null, className = "bn-plate", shadow = "drop-shadow(0 14px 24px rgba(0,0,0,.35))" }) {
  const base = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: on ? 1 : 0, transition: "opacity .8s ease" };
  if (isVid(u)) return <video src={u} autoPlay loop muted playsInline aria-hidden="true"
    onLoadedMetadata={e => { if (durs && isFinite(e.currentTarget.duration)) durs.current[u] = Math.max(2500, e.currentTarget.duration * 1000); }}
    style={{ ...base, WebkitMaskImage: MASK, maskImage: MASK }}/>;
  return <img src={u} alt="" className={className} style={{ ...base, filter: shadow }} onError={e => { e.currentTarget.style.display = "none"; }}/>;
}

// Le choix du haut de fiche (08/11/2026) : Animation / Vues 3D / Plateau(x), seulement ce qui existe. D'office tout ce qui
// est choisi est allume et defile ; toucher un mode ne montre que lui, le retoucher revient a tout.
export function HeroModes({ modes, mode, setMode, style }) {
  if (modes.length < 2) return null;
  return <span onClick={e => e.stopPropagation()} style={{ position: "absolute", zIndex: 3, display: "flex", gap: 3, padding: 3, borderRadius: 12,
    background: "color-mix(in srgb, var(--sheet-bg) 78%, transparent)", border: "1px solid color-mix(in srgb, var(--border) 80%, #fff)",
    boxShadow: "0 6px 16px rgba(0,0,0,.2)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", ...style }}>
    {modes.map(([k, l, tip]) => { const on = mode ? mode === k : k !== "plate";
      return <button key={k} type="button" onClick={() => setMode(mode === k ? null : k)} data-tip={tip} style={{ padding: "4px 8px", borderRadius: 9, border: "none",
        cursor: "pointer", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap", color: on ? "#fff" : "var(--text2)",
        background: on ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "transparent" }}>{l}</button>; })}
  </span>;
}
