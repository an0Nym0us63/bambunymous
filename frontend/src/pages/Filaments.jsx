import React, { useState, useEffect, useCallback } from "react";
import { Plus, Search, Archive, X, Save, RefreshCw } from "lucide-react";
import client from "../api/client";

const MATERIALS = ["PLA","PETG","ABS","ASA","PA","PC","TPU","PVA","BVOH","PLA-CF","PETG-CF","PA-CF","PPS"];

// ── Helpers ────────────────────────────────────────────────────────────────
const inp = {
  width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
  borderRadius:8, padding:"8px 12px", fontSize:13, color:"var(--text)",
  outline:"none", transition:"border-color 0.15s",
};
const inpFocus = e => e.target.style.borderColor="#3b82f6";
const inpBlur  = e => e.target.style.borderColor="var(--border)";

function ColorDot({ color, size=16 }) {
  return (
    <div style={{ width:size, height:size, borderRadius:4, flexShrink:0,
      backgroundColor: color ? `#${color.slice(0,6)}` : "var(--border)",
      border:"1px solid rgba(255,255,255,0.1)" }} />
  );
}

function RemainBar({ remaining, total=1000 }) {
  if (remaining == null) return null;
  const pct = Math.max(0, Math.min(100, (remaining/total)*100));
  const color = pct > 30 ? "#3b82f6" : pct > 15 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flex:1, height:4, background:"var(--border)", borderRadius:2, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, backgroundColor:color, borderRadius:2 }} />
      </div>
      <span style={{ fontSize:10, fontFamily:"monospace", color:"var(--muted)", flexShrink:0 }}>{Math.round(remaining)}g</span>
    </div>
  );
}

// ── Modal ajout bobine ─────────────────────────────────────────────────────
function AddSpoolModal({ filaments, onSave, onClose }) {
  const [form, setForm] = useState({ filament_id:"", remaining_weight_g:"", price_override:"", location:"", tag_number:"", comment:"" });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.filament_id) return;
    setSaving(true);
    try {
      await client.post("/filaments/spools", {
        filament_id: parseInt(form.filament_id),
        remaining_weight_g: form.remaining_weight_g ? parseFloat(form.remaining_weight_g) : null,
        price_override: form.price_override ? parseFloat(form.price_override) : null,
        location: form.location || null,
        tag_number: form.tag_number || null,
        comment: form.comment || null,
      });
      onSave();
    } finally { setSaving(false); }
  };

  const Label = ({ children }) => (
    <label style={{ display:"block", fontSize:11, color:"var(--muted)", marginBottom:4, textTransform:"uppercase", letterSpacing:"0.05em" }}>{children}</label>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div className="card" style={{ width:"100%", maxWidth:420, padding:20, display:"flex", flexDirection:"column", gap:14 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <h2 style={{ fontWeight:700, fontSize:15, color:"var(--text)" }}>Nouvelle bobine</h2>
          <button onClick={onClose} style={{ color:"var(--muted)", background:"none", border:"none", cursor:"pointer" }}><X size={18}/></button>
        </div>

        <div>
          <Label>Filament *</Label>
          <select value={form.filament_id} onChange={e => setForm(f=>({...f,filament_id:e.target.value}))}
            style={{ ...inp }} onFocus={inpFocus} onBlur={inpBlur}>
            <option value="">— Choisir un filament —</option>
            {filaments.map(f => <option key={f.id} value={f.id}>{f.manufacturer} — {f.name} ({f.material})</option>)}
          </select>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {[["Reste (g)","remaining_weight_g","number","1000"],["Prix (€)","price_override","number",""]].map(([l,n,t,p])=>(
            <div key={n}>
              <Label>{l}</Label>
              <input type={t} value={form[n]||""} placeholder={p}
                onChange={e=>setForm(f=>({...f,[n]:e.target.value}))}
                style={inp} onFocus={inpFocus} onBlur={inpBlur} />
            </div>
          ))}
        </div>

        {[["Emplacement","location","text","AMS 1, Tiroir..."],["Tag NFC","tag_number","text","UUID"],["Commentaire","comment","text",""]].map(([l,n,t,p])=>(
          <div key={n}>
            <Label>{l}</Label>
            <input type={t} value={form[n]||""} placeholder={p}
              onChange={e=>setForm(f=>({...f,[n]:e.target.value}))}
              style={inp} onFocus={inpFocus} onBlur={inpBlur} />
          </div>
        ))}

        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:4 }}>
          <button onClick={onClose} style={{ padding:"8px 16px", fontSize:13, color:"var(--muted)", background:"none", border:"1px solid var(--border)", borderRadius:8, cursor:"pointer" }}>Annuler</button>
          <button onClick={handleSave} disabled={saving||!form.filament_id}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 16px", fontSize:13, background:"#3b82f6", color:"white", border:"none", borderRadius:8, cursor:"pointer", opacity:saving||!form.filament_id?0.5:1 }}>
            {saving ? <RefreshCw size={13} style={{animation:"spin 1s linear infinite"}}/> : <Save size={13}/>}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bottom sheet détail bobine ────────────────────────────────────────────
function SpoolBottomSheet({ spool, onClose, onArchive }) {
  if (!spool) return null;
  const color = spool.filament_color ? `#${spool.filament_color.slice(0,6)}` : null;
  const total = spool.filament_weight_g || 1000;
  const remaining = spool.remaining_weight_g ?? total;
  const pct = Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
  const barColor = pct > 30 ? "#3b82f6" : pct > 15 ? "#f59e0b" : "#ef4444";

  const Row = ({ label, value, mono, accent }) => (value == null || value === "") ? null : (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
      padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
      <span style={{ fontSize:12, color:"var(--muted)", flexShrink:0 }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:600,
        color: accent || "var(--text)",
        fontFamily: mono ? "JetBrains Mono,monospace" : "inherit",
        textAlign:"right", marginLeft:12 }}>{value}</span>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
      zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:"var(--surface)", borderRadius:"20px 20px 0 0",
          width:"100%", maxWidth:540, maxHeight:"90dvh", overflowY:"auto",
          paddingBottom:"env(safe-area-inset-bottom,20px)" }}>

        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
        </div>

        <div style={{ padding:"16px 20px 28px" }}>
          {/* En-tête */}
          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24 }}>
            <div style={{ width:64, height:64, borderRadius:16, flexShrink:0,
              backgroundColor: color || "var(--border)",
              boxShadow:"0 2px 14px rgba(0,0,0,0.25)", border:"2px solid var(--border)" }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:20, fontWeight:800, color:"var(--text)", margin:0,
                letterSpacing:"-0.01em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {spool.filament_name}
              </p>
              <p style={{ fontSize:13, color:"var(--muted)", margin:"4px 0 0" }}>
                {spool.filament_material}
                {spool.filament_manufacturer ? ` · ${spool.filament_manufacturer}` : ""}
              </p>
              {spool.archived && (
                <span style={{ fontSize:10, background:"rgba(148,163,184,0.15)",
                  color:"#94a3b8", padding:"2px 8px", borderRadius:20,
                  fontWeight:600, display:"inline-block", marginTop:4 }}>Archivée</span>
              )}
            </div>
          </div>

          {/* Jauge restant */}
          <div style={{ marginBottom:24 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ fontSize:12, color:"var(--muted)" }}>Filament restant</span>
              <span style={{ fontSize:15, fontWeight:700, fontFamily:"monospace",
                color: barColor }}>
                {remaining.toFixed(0)}g
                <span style={{ fontSize:11, color:"var(--muted)", fontWeight:400, marginLeft:4 }}>
                  / {total}g ({pct}%)
                </span>
              </span>
            </div>
            <div style={{ height:12, borderRadius:6, background:"var(--border)", overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${pct}%`, borderRadius:6,
                background: barColor, transition:"width 0.5s" }}/>
            </div>
          </div>

          {/* ── Filament (catalogue) ── */}
          <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:"0.08em", marginBottom:4 }}>Filament (catalogue)</p>
          <Row label="Nom"            value={spool.filament_name}/>
          <Row label="Nom traduit"    value={spool.filament_translated_name}/>
          <Row label="Marque"         value={spool.filament_manufacturer}/>
          <Row label="Matière"        value={spool.filament_material}/>
          <Row label="Couleur"        value={color} mono/>
          <Row label="Profile ID"     value={spool.filament_profile_id} mono/>
          <Row label="Multicolor"     value={spool.filament_multicolor_type !== "monochrome" ? spool.filament_multicolor_type : null}/>
          <Row label="Poids total"    value={spool.filament_weight_g ? `${spool.filament_weight_g}g` : null}/>
          <Row label="Poids support"  value={spool.filament_spool_weight_g ? `${spool.filament_spool_weight_g}g` : null}/>
          <Row label="Prix catalogue" value={spool.filament_price ? `${Number(spool.filament_price).toFixed(2)}€` : null}/>
          <Row label="Réf. externe"   value={spool.filament_external_id} mono/>

          {/* ── Bobine physique ── */}
          <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:"0.08em", margin:"16px 0 4px" }}>Bobine #{spool.id}</p>
          <Row label="Restant"        value={`${remaining.toFixed(0)}g`} accent={barColor}/>
          <Row label="Prix achat"     value={spool.price_override ? `${Number(spool.price_override).toFixed(2)}€` : null}/>
          <Row label="Emplacement"    value={spool.location}/>
          <Row label="Tag NFC"        value={spool.tag_number} mono/>
          <Row label="Tray AMS"       value={spool.ams_tray}/>
          <Row label="ID externe"     value={spool.external_spool_id} mono/>
          <Row label="Mode détection" value={spool.found_mode}/>
          <Row label="Première util." value={spool.first_used_at?.slice(0,10)}/>
          <Row label="Dernière util." value={spool.last_used_at?.slice(0,10)}/>
          <Row label="Commentaire"    value={spool.comment}/>


          {/* Actions */}
          <div style={{ display:"flex", gap:8, marginTop:20 }}>
            {!spool.archived && (
              <button onClick={async()=>{ await onArchive(spool.id); onClose(); }}
                style={{ flex:1, padding:"10px", background:"var(--surface2)",
                  border:"1px solid var(--border)", borderRadius:10, cursor:"pointer",
                  color:"var(--muted)", fontSize:13, display:"flex",
                  alignItems:"center", justifyContent:"center", gap:6 }}>
                <Archive size={14}/> Archiver
              </button>
            )}
            <button onClick={onClose}
              style={{ flex:1, padding:"10px", background:"#3b82f6",
                border:"none", borderRadius:10, cursor:"pointer",
                color:"white", fontSize:13, fontWeight:600 }}>
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Vue Bobines ────────────────────────────────────────────────────────────
function SpoolsView({ filaments, showArchived }) {
  const [spools, setSpools] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/filaments/spools", { params:{ archived:showArchived, q:q||undefined } });
      setSpools(data);
    } finally { setLoading(false); }
  }, [showArchived, q]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Barre de recherche + bouton */}
      <div style={{ display:"flex", gap:8 }}>
        <div style={{ position:"relative", flex:1 }}>
          <Search size={14} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher…"
            style={{ ...inp, paddingLeft:36 }} onFocus={inpFocus} onBlur={inpBlur}/>
        </div>
        <button onClick={()=>setShowAdd(true)} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 14px", background:"#3b82f6", color:"white", border:"none", borderRadius:8, fontSize:13, cursor:"pointer", flexShrink:0 }}>
          <Plus size={14}/> Bobine
        </button>
      </div>

      {loading ? (
        <p style={{ textAlign:"center", color:"var(--muted)", fontSize:13, padding:"32px 0" }}>Chargement…</p>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:8 }}>
          {spools.map(s => (
            <div key={s.id} onClick={()=>setSelected(s)} className="card-sm"
              style={{ padding:12, display:"flex", flexDirection:"column", gap:8, cursor:"pointer" }}>
              <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                <ColorDot color={s.filament_color} size={18}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontWeight:600, fontSize:13, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.filament_name}</p>
                  <p style={{ fontSize:11, color:"var(--muted)" }}>{s.filament_material}{s.filament_manufacturer ? ` · ${s.filament_manufacturer}` : ""}</p>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                  {s.location && (
                    <span style={{ fontSize:10, background:"var(--surface)", border:"1px solid var(--border)", padding:"2px 6px", borderRadius:4, color:"var(--muted)" }}>{s.location}</span>
                  )}
                  {!showArchived && (
                    <button onClick={async()=>{ await client.delete(`/filaments/spools/${s.id}`); load(); }}
                      style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)", padding:2 }}
                      onMouseEnter={e=>e.currentTarget.style.color="#ef4444"}
                      onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
                      <Archive size={13}/>
                    </button>
                  )}
                </div>
              </div>
              <RemainBar remaining={s.remaining_weight_g}/>
              {s.comment && <p style={{ fontSize:10, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.comment}</p>}
            </div>
          ))}
          {!spools.length && <p style={{ gridColumn:"1/-1", textAlign:"center", color:"var(--muted)", fontSize:13, padding:"32px 0" }}>Aucune bobine</p>}
        </div>
      )}

      {showAdd && <AddSpoolModal filaments={filaments} onSave={()=>{ setShowAdd(false); load(); }} onClose={()=>setShowAdd(false)}/>}
      {selected && (
        <SpoolBottomSheet
          spool={selected}
          onClose={()=>setSelected(null)}
          onArchive={async(id)=>{ await client.delete(`/filaments/spools/${id}`); load(); }}
        />
      )}
    </div>
  );
}

// ── Vue Catalogue ──────────────────────────────────────────────────────────
function FilamentsView() {
  const [filaments, setFilaments] = useState([]);
  const [q, setQ] = useState("");
  const [material, setMaterial] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/filaments/filaments", { params:{ q:q||undefined, material:material||undefined } });
      setFilaments(data);
    } finally { setLoading(false); }
  }, [q, material]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <div style={{ position:"relative", flex:1, minWidth:180 }}>
          <Search size={14} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Nom, fabricant…"
            style={{ ...inp, paddingLeft:36 }} onFocus={inpFocus} onBlur={inpBlur}/>
        </div>
        <select value={material} onChange={e=>setMaterial(e.target.value)}
          style={{ ...inp, width:"auto", minWidth:140 }} onFocus={inpFocus} onBlur={inpBlur}>
          <option value="">Tous matériaux</option>
          {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {loading ? (
        <p style={{ textAlign:"center", color:"var(--muted)", fontSize:13, padding:"32px 0" }}>Chargement…</p>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          {filaments.map(f => (
            <div key={f.id} className="card-sm" style={{ padding:"10px 14px", display:"flex", alignItems:"center", gap:12 }}>
              <ColorDot color={f.color}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontWeight:500, fontSize:13, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</p>
                <p style={{ fontSize:11, color:"var(--muted)" }}>{f.manufacturer} · {f.material}</p>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                <span style={{
                  fontSize:10, padding:"2px 8px", borderRadius:20, fontWeight:600,
                  background: f.active_spool_count > 0 ? "rgba(34,197,94,0.12)" : "var(--surface2)",
                  color: f.active_spool_count > 0 ? "#22c55e" : "var(--muted)",
                }}>
                  {f.active_spool_count} bobine{f.active_spool_count!==1?"s":""}
                </span>
                {f.price && <span style={{ fontSize:10, color:"var(--muted)", fontFamily:"monospace" }}>{f.price}€</span>}
              </div>
            </div>
          ))}
          {!filaments.length && <p style={{ textAlign:"center", color:"var(--muted)", fontSize:13, padding:"32px 0" }}>Aucun filament</p>}
        </div>
      )}
    </div>
  );
}

// ── Page principale ────────────────────────────────────────────────────────
export default function Filaments() {
  const [tab, setTab] = useState("spools");
  const [filaments, setFilaments] = useState([]);

  useEffect(() => {
    client.get("/filaments/filaments").then(({ data }) => setFilaments(data));
  }, []);

  const tabs = [
    { id:"spools",   label:"Bobines actives" },
    { id:"archived", label:"Archivées" },
    { id:"catalog",  label:"Catalogue" },
  ];

  return (
    <div style={{ maxWidth:768, margin:"0 auto", display:"flex", flexDirection:"column", gap:16 }}>
      <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)" }}>Filaments</h1>

      {/* Tabs */}
      <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:12, padding:4, border:"1px solid var(--border)" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flex:1, padding:"8px 12px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
            background: tab===t.id ? "#3b82f6" : "transparent",
            color: tab===t.id ? "white" : "var(--muted)",
            border:"none", transition:"all 0.15s",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab==="catalog"
        ? <FilamentsView/>
        : <SpoolsView filaments={filaments} showArchived={tab==="archived"}/>
      }
    </div>
  );
}
