import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import CardHelp from "./CardHelp";
import { Trash2 } from "lucide-react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import { reloadSpoolTares } from "./TarePicker";
import { FSheet, fBtn } from "./FicheKit";
import SpoolSVG from "./SpoolSVG";
import { FilamentSheetFromSpool } from "./LazySheets";
import { parseColorsList, finishOf } from "../utils/colors";
import { egg } from "../eggs";

// (03/11/2026) les bobines en stock qui utilisent un support : celles dont le filament y est lie
function TareUsers({ name, weight, spools, onClose }) {
  const [open, setOpen] = useState(null);
  const list = spools.filter(x => (x.filament_spool_tare_name || "") === name);
  const byFil = [];
  for (const x of list) {
    let g = byFil.find(f => f.id === x.filament_id);
    if (!g) byFil.push(g = { id: x.filament_id, s: x, list: [] });
    g.list.push(x);
  }
  return createPortal(<>
    <FSheet onClose={onClose} z={1000} bottom={<button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button>}>
      <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>🧺 {name}</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
            Support de {weight} g · {list.length} bobine{list.length > 1 ? "s" : ""} en stock · {byFil.length} filament{byFil.length > 1 ? "s" : ""}</div>
        </div>
        {!list.length && <div style={{ padding: 20, textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
          Aucune bobine en stock n'utilise ce support.</div>}
        {byFil.map(g => <div key={g.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>
            {g.s.filament_translated_name || g.s.filament_name} · {[g.s.filament_fila_type || g.s.filament_material, g.s.filament_manufacturer].filter(Boolean).join(" · ")}</div>
          {g.list.map(x => <button key={x.id} type="button" onClick={() => setOpen(x)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
            borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
            <SpoolSVG colors={parseColorsList(x.filament_color, x.filament_colors_array)} finish={finishOf(x)} size={34} type={x.filament_multicolor_type}/>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 13, fontWeight: 900 }}>Bobine #{x.id}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {[x.remaining_weight_g != null ? `${Math.round(x.remaining_weight_g)} g` : null, x.ams_tray || x.location].filter(Boolean).join(" · ")}</span>
            </span>
            <span style={{ color: "var(--muted)" }}>›</span>
          </button>)}
        </div>)}
      </div>
    </FSheet>
    {open && <FilamentSheetFromSpool filamentId={open.filament_id} spoolId={open.id} filamentColorHex={open.filament_color} onClose={() => setOpen(null)}/>}
  </>, document.body);
}

// Modeles de support vide : un nom (marque, modele de bobine) et son poids.
// Proposes en liste a la pesee et sur la fiche filament (« Poids support »).
export default function SpoolTaresCard({ card, cardTitle }) {
  const [rows, setRows] = useState(null);          // [{ name, weight }]
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [bilan, setBilan] = useState("");
  // les bobines en stock : combien utilisent chaque support, et lesquelles (au toucher)
  const [spools, setSpools] = useState(null);
  const [users, setUsers] = useState(null);
  useEffect(() => { client.get("/filaments/spools", { params: { archived: false } }).then(({ data }) => setSpools(Array.isArray(data) ? data : data?.items || []))
    .catch(() => setSpools([])); }, []);
  const count = useMemo(() => { const c = {}; for (const x of spools || []) if (x.filament_spool_tare_name) c[x.filament_spool_tare_name] = (c[x.filament_spool_tare_name] || 0) + 1; return c; }, [spools]);

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
      // (09/11/2026) le dire sans laisser croire que le stock a bouge : seul le poids du support enregistre sur les fiches
      // change, le restant des bobines reste tel quel et ne s'en sert qu'a la prochaine pesee
      setBilan(n ? `Nouveau poids du support enregistré sur ${n} fiche${n > 1 ? "s" : ""} filament. Le restant de tes bobines ne bouge pas : `
        + "il servira à la prochaine pesée, pour retirer le bon support du poids mesuré." : "");
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
          {/* les bobines qui l'utilisent (sous son nom enregistre) */}
          {spools && r.from && <button type="button" onClick={() => { setUsers(r); egg("support_bobines"); }} data-tip="Les bobines en stock qui utilisent ce support"
            style={{ flexShrink:0, padding:"4px 9px", borderRadius:20, cursor:"pointer", fontSize:11.5, fontWeight:800, whiteSpace:"nowrap",
              border:"1px solid var(--border)", background: count[r.from] ? "rgba(59,130,246,.10)" : "var(--surface2)", color: count[r.from] ? "#3b82f6" : "var(--muted)" }}>
            🧵 {count[r.from] || 0}</button>}
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
      {users && <TareUsers name={users.from} weight={users.weight} spools={spools || []} onClose={() => setUsers(null)}/>}
    </div>
  );
}
