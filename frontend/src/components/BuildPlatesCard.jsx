import React, { useEffect, useState } from "react";
import client from "../api/client";
import { egg } from "../eggs";
import { toast } from "../store/toast";

// Les plateaux d'impression possedes (06/11/2026), dans Parametres › Imprimante : combien de chaque type, un nom, et ce
// que l'on y deconseille en plus de Bambu. Le planning s'en sert pour dire quand changer de plateau. Enregistre aussitot.
const COL = { textured: "#B45309", supertack: "#0EA5E9", cool: "#6366F1", hot: "#64748B", eng: "#7C3AED" };

export default function BuildPlatesCard({ card, cardTitle }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.get("/makerworld/plan/plates").then(r => setD(r.data)).catch(() => setD({ plates: [], kinds: [] })); }, []);
  if (!d) return null;
  const of = k => d.plates.find(p => p.kind === k) || { kind: k, n: 0, name: "", avoid: [] };
  const save = async plates => {
    setD(x => ({ ...x, plates }));
    setBusy(true);
    try { await client.put("/makerworld/plan/settings", { plates }); egg("plateaux_impression"); }
    catch (e) { toast(e.response?.data?.detail || "Pas enregistré", "error", 4000); }
    finally { setBusy(false); }
  };
  // l'ordre de la liste est l'ordre de preference (06/11/2026) : un plateau ajoute se range a la fin
  const order = [...d.plates.map(p => p.kind), ...d.kinds.map(x => x.kind).filter(k => !d.plates.some(p => p.kind === k))];
  const put = (k, patch) => save(order.map(kk => kk === k ? { ...of(kk), ...patch } : of(kk)).filter(p => p.n > 0 || p.name || p.avoid?.length));
  const owned = order.filter(k => of(k).n > 0);
  const move = (k, dlt) => { const o = [...owned], i = o.indexOf(k), j = i + dlt; if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; save([...o, ...order.filter(x => !o.includes(x))].map(of).filter(p => p.n > 0 || p.name || p.avoid?.length)); };
  const kinds = [...owned, ...d.kinds.map(x => x.kind).filter(k => !owned.includes(k))].map(k => d.kinds.find(x => x.kind === k)).filter(Boolean);
  const mounted = d.mounted?.kind && d.kinds.find(x => x.kind === d.mounted.kind);
  return <div className="card" style={card}>
    <div style={cardTitle}>🔲 Plateaux d'impression</div>
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45, marginBottom: 10 }}>
      Ceux que tu as, <b>dans ton ordre de préférence</b> (↑ ↓) : chaque impression prend le premier qui convient à ses filaments, et le planning
      te dit quand en changer (carte, tuile, notification). Ce que Bambu déconseille vient de Bambu Studio.
      {mounted && <> En place : <b style={{ color: "var(--text)" }}>{mounted.label}</b> (celui de la dernière impression).</>}</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {kinds.map(k => { const p = of(k.kind), c = COL[k.kind] || "#64748B", rank = owned.indexOf(k.kind);
        return <div key={k.kind} style={{ padding: "9px 11px", borderRadius: 12, border: `1px solid ${p.n ? `color-mix(in srgb, ${c} 40%, var(--border))` : "var(--border)"}`,
          background: p.n ? `color-mix(in srgb, ${c} 6%, var(--surface))` : "var(--surface)", opacity: p.n ? 1 : 0.8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", rowGap: 6 }}>
            {rank >= 0 && <span data-tip="Ordre de préférence" style={{ fontSize: 10.5, fontWeight: 900, color: "#fff", background: c, borderRadius: 6, padding: "1px 6px" }}>
              {rank === 0 ? "1er choix" : `${rank + 1}e choix`}</span>}
            <span style={{ flex: "1 1 110px", minWidth: 0, fontSize: 13.5, fontWeight: 900, color: p.n ? c : "var(--text2)" }}>{k.label}</span>
            {rank >= 0 && owned.length > 1 && <>
              <button type="button" disabled={busy || rank === 0} onClick={() => move(k.kind, -1)} aria-label="Préféré" data-tip="Le préférer" style={step}>↑</button>
              <button type="button" disabled={busy || rank === owned.length - 1} onClick={() => move(k.kind, 1)} aria-label="Moins préféré" data-tip="Le préférer moins" style={step}>↓</button>
              <span style={{ width: 6 }}/></>}
            <button type="button" disabled={busy || !p.n} onClick={() => put(k.kind, { n: p.n - 1 })} aria-label="Un de moins" style={step}>−</button>
            <span style={{ minWidth: 22, textAlign: "center", fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{p.n}</span>
            <button type="button" disabled={busy || p.n >= 9} onClick={() => put(k.kind, { n: p.n + 1 })} aria-label="Un de plus" style={step}>＋</button>
          </div>
          {k.bambu_no?.length > 0 && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginTop: 4, lineHeight: 1.4 }}>
            Bambu le déconseille pour : {k.bambu_no.join(", ")}</div>}
          {p.n > 0 && <label style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)" }}>Déconseillé aussi pour (séparés par des virgules)</span>
            <input defaultValue={(p.avoid || []).join(", ")} placeholder="ex. PLA Silk, PETG"
              onBlur={e => { const v = e.target.value.split(",").map(x => x.trim()).filter(Boolean); if (v.join() !== (p.avoid || []).join()) put(k.kind, { avoid: v }); }}
              style={{ padding: "6px 9px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13 }}/>
          </label>}
        </div>; })}
    </div>
  </div>;
}

const step = { width: 28, height: 26, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer",
  fontSize: 15, fontWeight: 900, lineHeight: 1 };
