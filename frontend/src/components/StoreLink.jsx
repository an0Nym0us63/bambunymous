import React, { useEffect, useState } from "react";
import client from "../api/client";

// Le lien direct de la boutique Bambu pour racheter un filament (31/10/2026) : sa recharge 1 kg (sinon sa bobine 1 kg,
// sinon la variante trouvee), d'apres son code couleur Bambu. L'index (code -> liens, filament -> code) est lu une
// fois par session ; un filament sans code Bambu connu de la boutique n'a pas de lien.
let cache = null;
const loadLinks = () => {
  if (!cache) cache = client.get("/filaments/store-links").then(r => r.data || {}).catch(() => { cache = null; return {}; });
  return cache;
};

export function useStoreLink({ filamentId = null, code = null } = {}) {
  const [hit, setHit] = useState(null);
  useEffect(() => {
    let alive = true;
    loadLinks().then(d => {
      if (!alive) return;
      const c = code ? String(code).trim() : (filamentId != null ? d.filaments?.[String(filamentId)] : null);
      const e = c ? d.codes?.[c] : null;
      setHit(e ? { url: e.refill || e.spool || e.any, kind: e.refill ? "recharge 1 kg" : e.spool ? "bobine 1 kg" : null, name: e.name } : null);
    });
    return () => { alive = false; };
  }, [filamentId, code]);
  return hit;
}

// look : « link » (un petit ↗ bleu, comme les filaments recommandes), « pill » (une pastille, comme celles du stock)
export default function StoreLink({ filamentId = null, code = null, look = "link", label = null }) {
  const hit = useStoreLink({ filamentId, code });
  if (!hit) return null;
  const tip = `Racheter chez Bambu Lab${hit.kind ? ` (${hit.kind})` : ""} : ${hit.name}`;
  const stop = e => e.stopPropagation();
  if (look === "pill") return <a href={hit.url} target="_blank" rel="noopener noreferrer" onClick={stop} data-tip={tip}
    style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 20, whiteSpace: "nowrap", textDecoration: "none", color: "#3b82f6",
      background: "#3b82f61f", border: "1px solid #3b82f640" }}>{label || "🛒 Boutique ↗"}</a>;
  return <a href={hit.url} target="_blank" rel="noopener noreferrer" onClick={stop} data-tip={tip}
    style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "#3b82f6", textDecoration: "none", whiteSpace: "nowrap" }}>{label || "🛒 ↗"}</a>;
}
