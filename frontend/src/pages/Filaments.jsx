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

// ── Vue Bobines ────────────────────────────────────────────────────────────
function SpoolsView({ filaments, showArchived }) {
  const [spools, setSpools] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

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
            <div key={s.id} className="card-sm" style={{ padding:12, display:"flex", flexDirection:"column", gap:8 }}>
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
