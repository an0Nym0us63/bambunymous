import React, { useEffect, useState } from "react";
import CardHelp from "./CardHelp";
import client from "../api/client";
import { showAlert } from "../utils/dialog";

// Delais de sechage : une valeur par defaut, et des cas declares un par un
// (famille ou sous-famille de filament + duree). Ce qui est declare s'applique,
// tout le reste prend la valeur par defaut ; une sous-famille l'emporte sur sa
// famille. Saisie en mois, stockee en jours (30 j par mois).
const toMonths = (d) => Math.round((d / 30) * 10) / 10;
const toDays = (m) => Math.max(1, Math.round(parseFloat(String(m).replace(",", ".")) * 30) || 0);

export default function DryRulesCard({ card, cardTitle }) {
  const [data, setData] = useState(null);          // { default_days, rules, families, types }
  const [def, setDef] = useState("6");
  const [rules, setRules] = useState([]);           // [{ sel: "family:PETG", months: "3" }]
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () => client.get("/settings/dry-rules").then(({ data }) => {
    setData(data);
    setDef(String(toMonths(data.default_days)));
    setRules(data.rules.map(r => ({ sel: `${r.level}:${r.key}`, months: String(toMonths(r.days)) })));
  }).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        default_days: toDays(def),
        rules: rules.filter(r => r.sel && r.months).map(r => {
          const i = r.sel.indexOf(":");
          return { level: r.sel.slice(0, i), key: r.sel.slice(i + 1), days: toDays(r.months) };
        }),
      };
      await client.put("/settings/dry-rules", body);
      await load();
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setSaving(false);
  };

  if (!data) return null;
  const used = new Set(rules.map(r => r.sel));
  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"7px 9px", fontSize:13, color:"var(--text)", outline:"none" };
  const monthsInput = (value, onChange) => (
    <span style={{ display:"inline-flex", alignItems:"center", gap:6, flexShrink:0 }}>
      <input value={value} onChange={e => onChange(e.target.value)} inputMode="decimal"
        style={{ ...inp, width:52, textAlign:"right" }}/>
      <span style={{ fontSize:12, color:"var(--muted)" }}>mois</span>
    </span>
  );

  return (
    <div className="card" style={card}>
      <div style={cardTitle}>Délais de séchage</div>
      <CardHelp title="Délais de séchage">
        Au-delà, une bobine passe « à sécher ». Les cas déclarés s'appliquent ;
        tout le reste prend la valeur par défaut. Une sous-famille l'emporte sur sa famille.
      </CardHelp>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:10 }}>
        <span style={{ fontSize:13, color:"var(--text2)", fontWeight:600 }}>Par défaut</span>
        {monthsInput(def, setDef)}
      </div>

      {rules.map((r, i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <select value={r.sel} onChange={e => setRules(rs => rs.map((x, j) => j === i ? { ...x, sel: e.target.value } : x))}
            style={{ ...inp, flex:1, minWidth:0 }}>
            <option value="">— Choisir —</option>
            <optgroup label="Famille">
              {data.families.map(f => <option key={"f" + f} value={`family:${f}`}
                disabled={used.has(`family:${f}`) && r.sel !== `family:${f}`}>{f}</option>)}
            </optgroup>
            <optgroup label="Sous-famille">
              {data.types.map(t => <option key={"t" + t} value={`type:${t}`}
                disabled={used.has(`type:${t}`) && r.sel !== `type:${t}`}>{t}</option>)}
            </optgroup>
          </select>
          {monthsInput(r.months, v => setRules(rs => rs.map((x, j) => j === i ? { ...x, months: v } : x)))}
          <button onClick={() => setRules(rs => rs.filter((_, j) => j !== i))} title="Retirer ce cas"
            style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:15, padding:"0 4px" }}>✕</button>
        </div>
      ))}

      <div style={{ display:"flex", gap:8, marginTop:6 }}>
        <button onClick={() => setRules(rs => [...rs, { sel: "", months: "3" }])}
          style={{ flex:1, padding:"8px", borderRadius:10, border:"1px dashed var(--border)",
            background:"none", color:"var(--muted)", fontSize:12, fontWeight:600, cursor:"pointer" }}>
          + Ajouter un cas
        </button>
        <button onClick={save} disabled={saving}
          style={{ flex:1, padding:"8px", borderRadius:10, border:"none", background:"#3b82f6",
            color:"white", fontSize:12, fontWeight:700, cursor:"pointer", opacity: saving ? 0.6 : 1 }}>
          {saved ? "Enregistré ✓" : saving ? "…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
