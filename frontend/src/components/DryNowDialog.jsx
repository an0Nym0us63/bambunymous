import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Sun } from "lucide-react";
import client from "../api/client";
import { usePrinter } from "../store/printer";
import { amsName, slotLabel } from "../utils/ams";
import { showAlert } from "../utils/dialog";

// « Sechee aujourd'hui » : date la bobine, et dit OU elle seche. Par defaut
// « Ailleurs » (four, dessiccateur...) ; sinon un emplacement AMS VIDE ou elle
// est simplement posee : l'AMS la fait tourner sans la voir, l'appli retient
// l'emplacement tant qu'il reste vide pour montrer ce qui seche.
export default function DryNowDialog({ spoolId, spoolName, onClose, onDone }) {
  const status = usePrinter(s => s.status);
  const [where, setWhere] = useState("");          // "" = ailleurs, sinon "ams:tray"
  const [busy, setBusy] = useState(false);

  const empties = [];
  for (const a of status?.ams_list || []) {
    for (const t of a.trays || []) {
      if (!(t.empty || !t.filament_type)) continue;
      const occupant = t.drying_spool && t.drying_spool.id !== spoolId
        ? (t.drying_spool.translated_name || t.drying_spool.name) : null;
      empties.push({ key: `${a.id}:${t.id}`, label: `${amsName(a.id)} · ${slotLabel(a.id, t.id)}`, occupant,
        mine: t.drying_spool?.id === spoolId });
    }
  }

  const confirm = async () => {
    setBusy(true);
    try {
      await client.patch(`/filaments/spools/${spoolId}`,
        { last_dried_at: `${new Date().toISOString().slice(0, 10)}T12:00:00` });
      if (where) {
        const [a, t] = where.split(":");
        await client.put(`/printer/ams/${a}/${t}/drying`, { spool_id: spoolId });
        usePrinter.getState().fetch?.();
      }
      onDone?.();
    } catch (e) {
      showAlert(e.response?.data?.detail || e.message);
      setBusy(false);
    }
  };

  const opt = (key, label, sub) => {
    const on = where === key;
    return (
      <button key={key || "ailleurs"} onClick={() => setWhere(key)}
        style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 12px", marginBottom:6,
          borderRadius:10, cursor:"pointer", textAlign:"left", color:"var(--text)",
          background: on ? "rgba(245,158,11,0.12)" : "var(--surface2)",
          border: on ? "1.5px solid #f59e0b" : "1px solid var(--border)" }}>
        <span style={{ width:14, height:14, borderRadius:"50%", flexShrink:0,
          border: on ? "4px solid #f59e0b" : "1.5px solid var(--muted)" }}/>
        <span style={{ flex:1, minWidth:0 }}>
          <span style={{ fontSize:13, fontWeight:600 }}>{label}</span>
          {sub && <span style={{ display:"block", fontSize:10.5, color:"var(--muted)" }}>{sub}</span>}
        </span>
      </button>
    );
  };

  return createPortal(
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4500, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:460, maxHeight:"85dvh", overflowY:"auto", padding:"16px 18px",
        paddingBottom:"calc(16px + env(safe-area-inset-bottom,0px))" }}>
        <h3 style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:"0 0 4px",
          display:"flex", alignItems:"center", gap:8 }}>
          <Sun size={16} color="#f59e0b"/> Séchée aujourd'hui
        </h3>
        <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 12px" }}>
          {spoolName ? `${spoolName} · ` : ""}Où sèche-t-elle ?
        </p>
        {opt("", "Ailleurs", "four, dessiccateur… — la date suffit")}
        {empties.length > 0 && (
          <p style={{ fontSize:10.5, fontWeight:700, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:0.4, margin:"10px 0 6px" }}>Posée dans un AMS (emplacement vide)</p>
        )}
        {empties.map(e => opt(e.key, e.label,
          e.mine ? "déjà posée ici" : e.occupant ? `remplace ${e.occupant}` : null))}
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          <button onClick={onClose} style={{ flex:1, padding:10, borderRadius:12, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text)", fontSize:13, fontWeight:700, cursor:"pointer" }}>Annuler</button>
          <button onClick={confirm} disabled={busy} style={{ flex:2, padding:10, borderRadius:12, border:"none",
            background:"#f59e0b", color:"white", fontSize:13, fontWeight:700, cursor:"pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "…" : "Séchée"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
