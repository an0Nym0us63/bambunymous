import React, { useEffect, useState } from "react";
import CardHelp from "./CardHelp";
import { Trash2 } from "lucide-react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import { reloadSpoolTares } from "./TarePicker";

// Modeles de support vide : un nom (marque, modele de bobine) et son poids.
// Proposes en liste a la pesee et sur la fiche filament (« Poids support »).
export default function SpoolTaresCard({ card, cardTitle }) {
  const [rows, setRows] = useState(null);          // [{ name, weight }]
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [bilan, setBilan] = useState("");

  // from = nom d'origine de la ligne : un renommage garde les filaments lies.
  const toRows = tares => tares.map(t => ({ name: t.name, weight: String(t.weight_g), from: t.name }));
  const load = () => client.get("/settings/spool-tares").then(({ data }) =>
    setRows(toRows(data.tares || []))).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const tares = rows.filter(r => r.name.trim() || r.weight.trim())
        .map(r => ({ name: r.name.trim(), weight_g: parseFloat(String(r.weight).replace(",", ".")), from: r.from || null }));
      const { data } = await client.put("/settings/spool-tares", { tares });
      setRows(toRows(data.tares));
      reloadSpoolTares();
      const n = data.updated_filaments || 0;
      setBilan(n ? `${n} filament${n > 1 ? "s" : ""} mis à jour avec le nouveau poids.` : "");
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setSaving(false);
  };

  if (!rows) return null;
  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"7px 9px", fontSize:13, color:"var(--text)", outline:"none" };
  const set = (i, k, v) => setRows(rs => rs.map((x, j) => j === i ? { ...x, [k]: v } : x));

  return (
    <div className="card" style={card}>
      <div style={cardTitle}>Supports vides</div>
      <CardHelp title="Supports vides">
        Poids d'une bobine vide par marque ou modèle. Proposés en liste à la pesée
        et sur la fiche filament, avec « Autre » pour un poids libre. Un filament
        lié à un modèle suit ses changements de poids et de nom ; le restant des
        bobines déjà pesées n'est pas recalculé.
      </CardHelp>

      {rows.map((r, i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <input value={r.name} onChange={e => set(i, "name", e.target.value)} placeholder="Bambu Lab"
            maxLength={60} style={{ ...inp, flex:1, minWidth:0 }}/>
          <span style={{ display:"inline-flex", alignItems:"center", gap:6, flexShrink:0 }}>
            <input value={r.weight} onChange={e => set(i, "weight", e.target.value)} inputMode="decimal"
              placeholder="250" style={{ ...inp, width:64, textAlign:"right" }}/>
            <span style={{ fontSize:12, color:"var(--muted)" }}>g</span>
          </span>
          <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} title="Supprimer"
            style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)", padding:4, display:"flex" }}>
            <Trash2 size={14}/>
          </button>
        </div>
      ))}

      <div style={{ display:"flex", gap:8, marginTop:4 }}>
        <button onClick={() => setRows(rs => [...rs, { name: "", weight: "" }])}
          style={{ padding:"7px 12px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
            background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}>
          + Ajouter un support
        </button>
        <button onClick={save} disabled={saving}
          style={{ marginLeft:"auto", padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:700,
            cursor:"pointer", background: saved ? "#22c55e" : "#3b82f6", border:"none", color:"white" }}>
          {saving ? "…" : saved ? "Enregistré" : "Enregistrer"}
        </button>
      </div>
      {bilan && <p style={{ fontSize:12, color:"#22c55e", margin:"10px 0 0" }}>{bilan}</p>}
    </div>
  );
}
