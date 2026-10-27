import React from "react";
import { currentFriend } from "../store/friend";

// Documents joints d'un modele MakerWorld et pieces a prevoir (27/10/2026) : notice d'assemblage, nomenclature,
// autres (une solution, des conseils…), ceux du modele et ceux d'un profil ; puis ce qu'il faut acheter a cote.
// Un document garde sur le serveur s'ouvre depuis chez moi (il reste lisible si le createur le retire) ;
// sinon, et chez un copain, chez MakerWorld.
const KIND = { guide: ["📘", "#3B82F6"], bom: ["📋", "#8B5CF6"], other: ["📄", "#0EA5E9"] };

export default function MwDocs({ docs = [], parts = [], otherParts = null, style }) {
  if (!docs.length && !parts.length && !otherParts) return null;
  const friend = !!currentFriend();
  const head = t => <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>{t}</div>;
  return (
    <div onClick={e => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 8, ...style }}>
      {docs.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {head(`Documents (${docs.length})`)}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {docs.map(d => { const [ico, c] = KIND[d.kind] || KIND.other;
            const href = d.kept && !friend ? d.href : d.url;
            return <a key={d.id || d.url} href={href} target="_blank" rel="noopener noreferrer"
              data-tip={`${d.label}${d.profile ? ` · profil « ${d.profile} »` : ""}${d.kept ? " · gardé sur le serveur" : " · chez MakerWorld"}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", minWidth: 0, padding: "5px 10px", borderRadius: 12,
                textDecoration: "none", fontSize: 12, fontWeight: 700, color: "var(--text)", border: `1px solid ${c}40`,
                background: `linear-gradient(135deg, ${c}1f, ${c}0a)` }}>
              <span style={{ flexShrink: 0 }}>{ico}</span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.2 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: c }}>{d.label}{d.profile ? " · profil" : ""}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              </span>
              <span style={{ flexShrink: 0, color: "var(--muted)", fontSize: 11 }}>↗</span>
            </a>; })}
        </div>
      </div>}
      {(parts.length > 0 || otherParts) && <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {head("À prévoir")}
        {parts.map((p, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "var(--text2)", minWidth: 0 }}>
          <span style={{ flexShrink: 0, minWidth: 26, textAlign: "center", padding: "1px 6px", borderRadius: 8, fontWeight: 900, fontSize: 11,
            color: "#fff", background: "linear-gradient(135deg, #F59E0B, #EA580C)" }}>{p.quantity ? `${p.quantity}×` : "•"}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
          {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" data-tip="Dans la boutique Bambu Lab"
            style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "#3b82f6", textDecoration: "none" }}>Boutique ↗</a>}
        </div>)}
        {otherParts && <div style={{ fontSize: 12, color: "var(--text2)", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{otherParts}</div>}
      </div>}
    </div>
  );
}
