// Une vignette a cocher, avec ce qu'elle est (08/11/2026 : au partage et a l'evaluation, des vignettes sans nom, et
// les videos ne montraient que le logo gris de lecture) : une video tourne en boucle, muette ; son nom en bas
// (Photo, Vue 2, Tour de camera, Capture 50 %…), d'ou elle vient en infobulle.
import React from "react";

const ANIM = { turntable: "🎠 Plateau tournant", orbit: "🎥 Tour de caméra", swing: "↔️ Balancement", travel: "🛤️ Travelling", zoom: "🔍 Zoom",
  reveal: "🎬 Révélation", spiral: "🌀 Spirale", drone: "🚁 Survol", float: "🎈 Lévitation", vertigo: "🌪️ Effet vertigo", dive: "🦅 Plongée",
  crane: "🏗️ Grue", spotlight: "🔦 Projecteur" };

export const isVideoSrc = u => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u || "");
export const isAnimSrc = u => /\/vue3d_anim[^/]*\.(webm|mp4)(\?|$)/i.test(u || "");

// ce qu'est un media d'apres son adresse (l'evaluation n'a que des adresses)
export function labelOf(u) {
  const n = String(u || "").split("?")[0].split("/").pop().toLowerCase();
  let m = n.match(/^vue3d_anim(?:_([a-z]+))?\.(webm|mp4)$/);
  if (m) return ANIM[m[1]] || "🎞 Animation";
  m = n.match(/^vue3d(?:_(\d))?\.png$/);
  if (m) return `🧊 Vue ${m[1] || 1}`;
  if (u && u.includes("/rate-card/")) return "🎨 Filaments";
  if (n.startsWith("snapshot-")) return "📷 Capture";
  if (n.startsWith("plate.")) return "🖼 Plateau";
  if (isVideoSrc(n)) return "🎥 Vidéo";
  return "📸 Photo";
}

export default function MediaThumb({ src, video, label, on, onClick, tip, accent = "#229ED9", size = 76, poster = null }) {
  return <span onClick={onClick} data-tip={tip} style={{ position: "relative", display: "block", width: size, height: size, flexShrink: 0, cursor: "pointer",
    borderRadius: 12, overflow: "hidden", background: "#0f172a", boxSizing: "border-box",
    border: on ? `2.5px solid ${accent}` : "2px solid transparent", opacity: on ? 1 : 0.5, transition: "opacity .15s" }}>
    {video ? <video src={src} poster={poster || undefined} muted loop autoPlay playsInline preload="metadata"
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}/>
      : <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>}
    {label && <span style={{ position: "absolute", left: 3, right: 3, bottom: 3, fontSize: 9.5, fontWeight: 800, color: "#fff", padding: "1px 5px", borderRadius: 6,
      background: "rgba(0,0,0,.66)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{label}</span>}
    {on && <span style={{ position: "absolute", top: 3, right: 3, width: 16, height: 16, borderRadius: "50%", background: accent, color: "#fff", fontSize: 10,
      fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>✓</span>}
  </span>;
}
