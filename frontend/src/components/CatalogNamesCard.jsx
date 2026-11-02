import React, { useEffect, useState } from "react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import CardHelp from "./CardHelp";

// Nos correspondances de noms (02/11/2026) : un nom anglais du catalogue Bambu -> notre nom francais. Elles passent
// avant le catalogue (une traduction absente ou qui ne convient pas) ; a l'enregistrement, les fiches filament qui
// portaient l'ancien nom (anglais, catalogue ou notre ancienne correspondance) prennent le nouveau ; un nom tape a la
// main sur une fiche n'est jamais touche.
export default function CatalogNamesCard({ card, cardTitle }) {
  const [rows, setRows] = useState(null);
  const [builtin, setBuiltin] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    client.get("/filaments/catalog-names").then(r => { setRows(r.data.items || []); setBuiltin(r.data.builtin || []); })
      .catch(() => setRows([]));
  }, []);
  const set = (i, k, v) => { setSaved(false); setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r)); };
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await client.put("/filaments/catalog-names", { items: rows.filter(r => r.en?.trim() && r.fr?.trim()) });
      setRows(data.items || []); setSaved(true);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  const inp = { flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)",
    color: "var(--text)", fontSize: 13 };
  return <div className="card" style={card}>
    <div style={{ ...cardTitle, display: "flex", alignItems: "center", gap: 6 }}>🔤 Noms du catalogue
      <CardHelp inline title="Noms du catalogue">
        Le catalogue Bambu n'a pas traduit toutes ses couleurs, et certaines traductions ne collent pas à la boutique.
        Ici, un nom anglais du catalogue (« Dawn Radiance ») et le nom français à montrer (« Éclat de l'Aube »). Il passe
        avant le catalogue : scan RFID, AMS, commandes lues dans les mails, fiches filament. En enregistrant, les fiches qui
        portaient l'ancien nom sont renommées ; un nom tapé à la main sur une fiche n'est jamais touché.</CardHelp></div>
    {rows == null ? <span style={{ fontSize: 13, color: "var(--muted)" }}>…</span> : <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.length === 0 && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Aucune correspondance pour l'instant.</span>}
        {rows.map((r, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input value={r.en} onChange={e => set(i, "en", e.target.value)} placeholder="Nom anglais (catalogue)" aria-label="Nom anglais" style={inp}/>
          <span style={{ color: "var(--muted)", fontWeight: 800 }}>→</span>
          <input value={r.fr} onChange={e => set(i, "fr", e.target.value)} placeholder="Notre nom français" aria-label="Nom français" style={inp}/>
          <button type="button" onClick={() => { setSaved(false); setRows(rs => rs.filter((_, j) => j !== i)); }} aria-label="Retirer"
            data-tip="Retirer cette correspondance" style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 15, padding: "0 4px" }}>✕</button>
        </div>)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button type="button" onClick={() => { setSaved(false); setRows(rs => [...rs, { en: "", fr: "" }]); }}
          style={{ padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", border: "1px solid var(--border)",
            background: "var(--surface)", color: "var(--text2)" }}>＋ Ajouter</button>
        <button type="button" onClick={save} disabled={busy}
          style={{ padding: "8px 18px", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: "pointer", border: "none", color: "#fff",
            background: "linear-gradient(135deg, #3B82F6, #6366F1)", opacity: busy ? .6 : 1 }}>{saved ? "Enregistré ✓" : busy ? "…" : "Enregistrer"}</button>
      </div>
      {builtin.length > 0 && <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "10px 0 0", lineHeight: 1.45 }}>
        Déjà connus de l'appli (utilisés si rien d'autre) : {builtin.map(b => `${b.en} → ${b.fr}`).join(" · ")}.</p>}
    </>}
  </div>;
}
