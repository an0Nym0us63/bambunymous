import React, { useEffect, useState } from "react";
import client from "../api/client";

// Ce que les catalogues savent d'un filament (05/11/2026) : chaque fait avec sa source (Bambu Studio, boutique Bambu,
// Open Filament Database, notre catalogue, FilamentColors). Sur la fiche d'un filament et dans le navigateur des
// catalogues. url : la route qui rend {facts, measured, sources}.
const SRC_C = { bambu: "#0EA5E9", boutique: "#22C55E", ofd: "#8B5CF6", own: "#F59E0B", fc: "#14B8A6" };
const SRC_S = { bambu: "Bambu Studio", boutique: "Boutique", ofd: "OFD", own: "Nous", fc: "FilamentColors" };
// l'ordre de la fiche : la couleur, puis l'impression, le sechage, la bobine, l'achat
const ORDER = ["measured", "td", "ral", "pantone", "nozzle", "bed", "flow", "density", "dtol", "soften", "dry", "spool", "core", "refill",
  "gtin", "article", "print_temp", "soluble", "support", "cost", "disc", "brand", "origin"];
const rank = k => { const i = ORDER.indexOf(k); return i < 0 ? (k.startsWith("buy") ? 900 : 800) : i; };

export function useCatalogFacts(url, params, deps = []) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let on = true;
    setD(null);
    client.get(url, { params }).then(r => { if (on) setD(r.data); }).catch(() => { if (on) setD({ facts: [], measured: [] }); });
    return () => { on = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return d;
}

export function SrcChip({ s }) {
  return <span data-tip={{ bambu: "Profil Bambu Studio (Bambu Lab)", boutique: "Boutique Bambu Lab", ofd: "Open Filament Database (libre, communautaire)",
    own: "Notre catalogue", fc: "FilamentColors.xyz : échantillons imprimés et mesurés" }[s]}
    style={{ fontSize: 9.5, fontWeight: 900, padding: "1px 6px", borderRadius: 20, whiteSpace: "nowrap", color: SRC_C[s] || "#64748B",
      background: `color-mix(in srgb, ${SRC_C[s] || "#64748B"} 14%, transparent)` }}>{SRC_S[s] || s}</span>;
}

// la liste des faits ; ours : notre couleur (hex), pour la montrer a cote de la mesuree
export function FactsList({ facts, ours }) {
  const list = [...(facts || [])].sort((a, b) => rank(a.k) - rank(b.k));
  if (!list.length) return <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Les catalogues ne disent rien de plus sur ce filament.</div>;
  return <div style={{ display: "flex", flexDirection: "column" }}>
    {list.map((f, i) => <div key={`${f.k}${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: i ? "1px dashed var(--border)" : "none", minWidth: 0 }}>
      <span style={{ flex: "0 0 auto", minWidth: 118, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{f.label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {f.k === "measured" && <>
          {ours && <span data-tip="La nôtre" style={{ width: 13, height: 13, borderRadius: 3, background: `#${String(ours).replace(/^#/, "").slice(0, 6)}`, border: "1px solid var(--border)" }}/>}
          {ours && <span style={{ color: "var(--muted)" }}>→</span>}
          <span data-tip="Mesurée" style={{ width: 13, height: 13, borderRadius: 3, background: `#${f.hex}`, border: "1px solid var(--border)" }}/></>}
        {f.url ? <a href={f.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "#3B82F6", overflowWrap: "anywhere" }}>{f.value} ›</a>
          : <span style={{ overflowWrap: "anywhere", fontFamily: f.k === "gtin" || f.k === "article" || f.k === "measured" ? "monospace" : "inherit" }}>{f.value}</span>}
      </span>
      <SrcChip s={f.src}/>
    </div>)}
  </div>;
}

// l'echantillon FilamentColors : sa photo, son nom, son type ; « teinte proche » quand ce n'est pas le meme nom
export function MeasuredHead({ m }) {
  if (!m) return null;
  return <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
    {m.img ? <img src={m.img} alt="" loading="lazy" style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", flexShrink: 0, background: "var(--surface2)" }}/>
      : <span style={{ width: 52, height: 52, borderRadius: 12, flexShrink: 0, background: `#${m.hex}` }}/>}
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{m.name} <span style={{ color: "var(--muted)", fontWeight: 600 }}>· {m.type}</span></div>
      <div style={{ fontSize: 11, fontWeight: 700, color: m.how === "teinte" ? "#d97706" : "var(--muted)" }}>
        {m.how === "teinte" ? "Pas d'échantillon à ce nom : la teinte la plus proche de la marque, pour info" : "Échantillon imprimé et mesuré"}</div>
    </div>
  </div>;
}
