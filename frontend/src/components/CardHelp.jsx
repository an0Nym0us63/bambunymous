import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// L'explication d'une tuile (28/10/2026) : un petit « ? » dans son angle, qui ouvre une bulle avec le texte. Les
// pages de reglages restent legeres a lire ; le detail est la quand on le veut. La tuile doit etre en position
// relative (les cartes des Parametres le sont). « inline » : le « ? » se pose dans le texte (une partie de la tuile).
export default function CardHelp({ title = "", children, inline = false, color = "var(--set-c, #3B82F6)" }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const k = e => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  const btn = (
    <button type="button" onClick={e => { e.stopPropagation(); setOpen(true); }} aria-label={title ? `À propos : ${title}` : "Explication"}
      data-tip="Explication"
      style={{ ...(inline ? { display: "inline-flex", verticalAlign: "middle", marginLeft: 6 } : { position: "absolute", top: 12, right: 12, display: "flex" }),
        width: inline ? 20 : 26, height: inline ? 20 : 26, borderRadius: "50%", alignItems: "center", justifyContent: "center", cursor: "pointer",
        fontSize: inline ? 11.5 : 13.5, fontWeight: 900, lineHeight: 1, padding: 0, zIndex: 2,
        color, background: `color-mix(in srgb, ${color} 12%, var(--surface))`, border: `1.5px solid color-mix(in srgb, ${color} 45%, transparent)` }}>?</button>
  );
  return <>
    {btn}
    {open && createPortal(
      <div data-no-pull="" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(2,6,23,0.6)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label={title || "Explication"}
          style={{ position: "relative", width: "100%", maxWidth: 460, maxHeight: "80dvh", overflowY: "auto", borderRadius: 20, padding: "18px 18px 16px",
            // fond plein (le fond des fiches), sa couleur en halo dans l'angle
            background: `radial-gradient(90% 60% at 100% 0%, color-mix(in srgb, ${color} 14%, transparent), transparent 70%), var(--sheet-bg, var(--surface2))`,
            border: `1px solid color-mix(in srgb, ${color} 30%, var(--border))`, boxShadow: "0 20px 50px rgba(0,0,0,0.45)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, paddingRight: 34 }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 900, color: "#fff", background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 60%, #ffffff))` }}>?</span>
            <span style={{ fontSize: 15.5, fontWeight: 900, color: "var(--text)" }}>{title || "Explication"}</span>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Fermer"
            style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text2)", cursor: "pointer", fontSize: 14 }}>✕</button>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
        </div>
      </div>, document.body)}
  </>;
}
