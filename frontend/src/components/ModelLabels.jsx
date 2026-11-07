import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";

// Les familles, categories et etiquettes du modele d'une impression, donnees par Claude (07/11/2026). Un clic sur
// l'une d'elles cherche les impressions qui la partagent. Rien quand le modele n'est pas classe (ou chez un ami
// dont le serveur ne le sait pas encore : la route n'existe pas, la carte ne s'affiche pas).
const chip = (c, strong) => ({ display:"inline-flex", alignItems:"center", padding:"3px 9px", borderRadius:999, fontSize:12, fontWeight: strong ? 800 : 600,
  cursor:"pointer", background:`color-mix(in srgb, ${c} ${strong ? 16 : 9}%, transparent)`, color: strong ? c : "var(--text2)",
  border:`1px solid color-mix(in srgb, ${c} 30%, transparent)` });

export default function ModelLabels({ printId, onPick }) {
  const [l, setL] = useState(null);
  const nav = useNavigate();
  useEffect(() => {
    setL(null);
    if (printId == null) return;
    client.get(`/prints/${printId}/labels`).then(r => setL(r.data || {})).catch(() => setL({}));
  }, [printId]);
  if (!l || !(l.categories?.length || l.tags?.length)) return null;
  const go = q => { onPick?.(); nav(`/prints?q=${encodeURIComponent(q)}`); };
  return <div style={{ padding:"10px 14px", borderRadius:16, border:"1px solid var(--border)",
    background:"linear-gradient(135deg, color-mix(in srgb, #6366F1 10%, transparent), transparent 70%), var(--surface2)" }}>
    <div style={{ fontSize:10.5, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#6366F1", marginBottom:6 }}>
      🏷 Catégories et étiquettes</div>
    <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom: l.tags?.length ? 6 : 0 }}>
      {(l.families || []).map(f => <button type="button" key={"f" + f} onClick={() => go(f)} data-tip="Famille · voir les impressions" style={chip("#B45309", true)}>{f}</button>)}
      {(l.categories || []).map(c => <button type="button" key={"c" + c.name} onClick={() => go(c.name)} data-tip="Catégorie · voir les impressions" style={chip("#6366F1", true)}>{c.name}</button>)}
    </div>
    {l.tags?.length > 0 && <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
      {l.tags.map(t => <button type="button" key={t} onClick={() => go(t)} data-tip="Voir les impressions avec cette étiquette" style={chip("#64748B")}>#{t}</button>)}
    </div>}
  </div>;
}
