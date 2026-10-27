import React from "react";
import { currentFriend } from "../store/friend";

// Documents joints d'un modele MakerWorld et pieces a prevoir (27/10/2026) : notice d'assemblage, nomenclature,
// autres (une solution, des conseils…), ceux du modele et ceux d'un profil ; puis ce qu'il faut acheter a cote.
// Un document garde sur le serveur s'ouvre depuis chez moi (il reste lisible si le createur le retire) ;
// sinon, et chez un copain, chez MakerWorld.
const KIND = { guide: ["📘", "#3B82F6"], bom: ["📋", "#8B5CF6"], other: ["📄", "#0EA5E9"] };

// les filaments recommandes par le createur, face a mon stock (meme code couleur Bambu)
const kg = g => g >= 1000 ? `${(g / 1000).toFixed(1).replace(".", ",")} kg` : `${Math.round(g)} g`;
function FilaLine({ f }) {
  const s = f.stock, has = s && s.spools > 0;
  const hex = f.hex ? `#${String(f.hex).replace("#", "").slice(0, 6)}` : "#94a3b8";
  return <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
    <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${hex} 55%, #ffffff), ${hex})`,
      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.18)" }}/>
    <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, lineHeight: 1.25 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {f.quantity > 1 ? `${f.quantity} × ` : ""}{f.product} · {f.color}{f.code ? ` (${f.code})` : ""}</span>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {[f.variant, f.size].filter(Boolean).join(" · ")}</span>
    </span>
    {has
      ? <span data-tip={`${s.name} : ${s.spools} bobine${s.spools > 1 ? "s" : ""} en stock, ${kg(s.grams)} restants`} style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800,
          padding: "2px 8px", borderRadius: 20, color: "#fff", background: "linear-gradient(135deg, #22C55E, #16A34A)", whiteSpace: "nowrap" }}>
          ✓ {s.spools} · {kg(s.grams)}</span>
      : <span data-tip={s ? "Au catalogue, mais plus de bobine" : "Pas dans ton stock"} style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, padding: "2px 8px",
          borderRadius: 20, color: "#fff", background: "linear-gradient(135deg, #F59E0B, #EA580C)", whiteSpace: "nowrap" }}>à commander</span>}
    {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" data-tip="Dans la boutique Bambu Lab"
      style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "#3b82f6", textDecoration: "none" }}>↗</a>}
  </div>;
}

export default function MwDocs({ docs = [], parts = [], otherParts = null, filaments = [], style }) {
  if (!docs.length && !parts.length && !otherParts && !filaments.length) return null;
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
      {filaments.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {head(`Filaments recommandés (${filaments.length})`)}
        {filaments.map((f, i) => <FilaLine key={i} f={f}/>)}
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
