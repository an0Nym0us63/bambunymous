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
  // (08/11/2026) de petites icones seules, discretes : les etiquettes ecrites gachaient l'image ; leur nom en infobulle
  return <span onClick={e => e.stopPropagation()} style={{ position: "absolute", zIndex: 3, display: "flex", gap: 2, padding: 2, borderRadius: 10,
    background: "color-mix(in srgb, var(--sheet-bg) 55%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", opacity: .85, ...style }}>
    {modes.map(([k, l, tip]) => { const on = mode ? mode === k : k !== "plate";
      return <button key={k} type="button" onClick={() => setMode(mode === k ? null : k)} data-tip={tip} aria-label={tip} style={{ width: 24, height: 22, padding: 0,
        borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
        filter: on ? "none" : "grayscale(1)", opacity: on ? 1 : 0.55,
        background: on ? "color-mix(in srgb, #0EA5E9 35%, transparent)" : "transparent" }}>{l.split(" ")[0]}</button>; })}
  </span>;
}

// la duree de chaque animation, partagee par les tuiles (le defilement attend la fin de sa boucle)
export const animDurs = { current: {} };
export const animPeriod = u => isVid(u) ? animDurs.current[u] || 6000 : 2600;

// une tuile de liste ou de galerie (08/11/2026) : une animation n'y est chargee que si la tuile est a l'ecran et que c'est
// son tour (des centaines de tuiles ne lancent pas des centaines de videos) ; ses bords fondus comme en haut de fiche
export function TileVideo({ u, on, visible, style }) {
  if (!on || !visible) return null;
  return <video src={u} autoPlay loop muted playsInline aria-hidden="true"
    onLoadedMetadata={e => { if (isFinite(e.currentTarget.duration)) animDurs.current[u] = Math.max(2500, e.currentTarget.duration * 1000); }}
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", WebkitMaskImage: MASK, maskImage: MASK, ...style }}/>;
}
