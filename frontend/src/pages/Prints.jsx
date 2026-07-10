import React, { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Upload, Search, Filter, Clock, Package, CheckCircle, XCircle, Loader, Image as ImageIcon, List, Check, FolderPlus, X, FolderMinus, SlidersHorizontal } from "lucide-react";
import client from "../api/client";
import GalleryCompare from "../components/GalleryCompare";
import { FilamentSheetFromSpool } from "./Filaments";

const STATUS_CFG = {
  IN_PROGRESS: { label:"En cours", color:"#3b82f6", bg:"rgba(59,130,246,0.75)",  icon:Loader },
  SUCCESS:     { label:"Réussi",   color:"#22c55e", bg:"rgba(34,197,94,0.75)",   icon:CheckCircle },
  FAILED:      { label:"Échoué",   color:"#ef4444", bg:"rgba(239,68,68,0.75)",   icon:XCircle },
  CANCELLED:   { label:"Annulé",   color:"#94a3b8", bg:"rgba(148,163,184,0.75)", icon:XCircle },
};

function fmtDur(s) {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2,"0")}min` : `${m}min`;
}
function fmtDate(d) {
  if (!d) return "—";
  // Les datetimes DB sont en UTC sans 'Z' → forcer UTC pour conversion correcte en heure locale
  const s = typeof d === "string" && !d.includes("Z") && !d.includes("+")
    ? d.replace(" ", "T") + "Z" : d;
  return new Date(s).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
}
function hexCss(h) {
  if (!h) return "#888";
  return h.startsWith("#") ? h.slice(0,7) : `#${h.slice(0,6)}`;
}

function FilamentDots({ filaments }) {
  if (!filaments?.length) return null;
  return (
    <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
      {filaments.map((f, i) => (
        <div key={i}
          title={`${f.filament_type} — ${f.grams_used.toFixed(1)}g${f.spool_id ? " · Bobine liée" : " · Non mappé"}`}
          style={{ position:"relative", flexShrink:0 }}>
          <div style={{
            width:14, height:14, borderRadius:"50%",
            backgroundColor: hexCss(f.color_hex),
            border: f.spool_id
              ? "2px solid #22c55e"
              : "1px solid rgba(255,255,255,0.15)",
          }}/>
          {!f.spool_id && (
            <span style={{ position:"absolute", top:-2, right:-2,
              fontSize:7, lineHeight:1, color:"#f59e0b" }}>?</span>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.SUCCESS;
  const Icon = cfg.icon;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4,
      fontSize:10, fontWeight:700, color:cfg.color,
      background:`${cfg.color}18`, padding:"2px 8px", borderRadius:20 }}>
      <Icon size={9}/> {cfg.label}
    </span>
  );
}

// ── Tuile groupe collapsible ────────────────────────────────────────────────
function SpoolMapPicker({ usageId, printId, colorHex, filamentType, onClose, onMapped }) {
  const [spools, setSpools] = useState([]);
  const [search, setSearch] = useState(filamentType || "");

  useEffect(() => {
    client.get("/filaments/spools", { params:{ limit:500 } })
      .then(r => setSpools(r.data || []))
      .catch(() => {});
  }, []);

  const filtered = spools.filter(s => !s.archived && (
    !search || (s.filament_name||"").toLowerCase().includes(search.toLowerCase()) ||
    (s.filament_manufacturer||"").toLowerCase().includes(search.toLowerCase())
  ));

  const map = async (spoolId) => {
    await client.patch(`/prints/${printId}/filament-usage/${usageId}`, { spool_id: spoolId });
    onMapped?.();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:3000,
      display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", width:"100%",
          maxWidth:640, maxHeight:"80dvh", overflowY:"auto", padding:"0 16px 24px" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 8px", position:"relative" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:10, right:0, width:28, height:28,
            borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer",
            color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <div style={{ width:20, height:20, borderRadius:"50%", flexShrink:0,
            backgroundColor:hexCss(colorHex), border:"1px solid rgba(255,255,255,0.2)" }}/>
          <h3 style={{ fontSize:14, fontWeight:800, color:"var(--text)", margin:0 }}>
            Associer une bobine
          </h3>
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Rechercher..." style={{ width:"100%", boxSizing:"border-box",
            padding:"8px 12px", borderRadius:8, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text)", fontSize:13, outline:"none",
            marginBottom:10 }}/>
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          {filtered.map(s => (
            <button key={s.id} onClick={()=>map(s.id)}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
                background:"var(--surface2)", border:"1px solid var(--border)",
                borderRadius:8, cursor:"pointer", textAlign:"left" }}>
              <div style={{ width:18, height:18, borderRadius:"50%", flexShrink:0,
                backgroundColor:hexCss(s.color_hex || s.filament_color),
                border:"1px solid rgba(255,255,255,0.15)" }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:12, fontWeight:600, color:"var(--text)", margin:0,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {s.filament_name || "Bobine #"+s.id}
                </p>
                <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>
                  {s.filament_manufacturer} · #{s.id} · {s.remaining_weight_g?.toFixed(0)}g restants
                </p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p style={{ color:"var(--muted)", fontSize:12, textAlign:"center", padding:"20px 0" }}>Aucune bobine trouvée</p>}
        </div>
      </div>
    </div>
  );
}

function DeletePrintConfirm({ p, onCancel, onConfirm, restoreOnly = false }) {
  const hasMapped = (p.filament_usage || []).some(f => f.spool_id);
  const totalG = (p.filament_usage || []).filter(f => f.spool_id).reduce((s,f)=>s+(f.grams_used||0),0);
  const [fraction, setFraction] = useState(hasMapped ? 1.0 : 0);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:3000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:16,
        width:"100%", maxWidth:380, padding:20, border:"1px solid var(--border)" }}>
        <h3 style={{ fontSize:16, fontWeight:800, color:"var(--text)", margin:"0 0 8px" }}>
          {restoreOnly ? "⚖ Restituer les grammes" : "🗑 Supprimer ce print ?"}
        </h3>
        <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 16px" }}>
          {p.file_name || "Sans nom"}
        </p>
        {hasMapped && totalG > 0 && (
          <div style={{ background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.2)",
            borderRadius:10, padding:"12px 14px", marginBottom:16 }}>
            <p style={{ fontSize:12, fontWeight:700, color:"#22c55e", margin:"0 0 10px" }}>
              Restituer les grammes aux bobines ?
            </p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {[0, 0.25, 0.5, 0.75, 1.0].map(f => (
                <button key={f} onClick={()=>setFraction(f)}
                  style={{ padding:"5px 12px", borderRadius:20, border:"none", cursor:"pointer",
                    fontWeight:600, fontSize:12,
                    background: fraction===f ? "#22c55e" : "var(--surface2)",
                    color: fraction===f ? "white" : "var(--muted)" }}>
                  {f === 0 ? "Non" : f === 1 ? "100%" : `${f*100}%`}
                </button>
              ))}
            </div>
            {fraction > 0 && (
              <p style={{ fontSize:11, color:"#22c55e", margin:"8px 0 0" }}>
                → +{(totalG * fraction).toFixed(1)}g restitués aux bobines
              </p>
            )}
          </div>
        )}
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onCancel}
            style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid var(--border)",
              background:"var(--surface2)", color:"var(--muted)", fontSize:13, cursor:"pointer" }}>
            Annuler
          </button>
          <button onClick={()=>onConfirm(fraction)}
            style={{ flex:2, padding:"10px", borderRadius:10, border:"none",
              background:restoreOnly?"#22c55e":"#ef4444", color:"white", fontSize:13, fontWeight:700, cursor:"pointer" }}>
            {restoreOnly ? "✓ Restituer" : "Supprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilamentAccordion({ filaments, onSpoolClick, onSpoolPick, printId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
    <div style={{ marginBottom:14, border:"1px solid var(--border)", borderRadius:10 }}>
      {/* Header cliquable */}
      <button onClick={()=>setOpen(o=>!o)}
        style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
          background:"var(--surface2)", border:"none", cursor:"pointer", textAlign:"left" }}>
        <span style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
          letterSpacing:"0.06em", flex:1 }}>Filaments ({filaments.length})</span>
        {/* Pastilles de couleur */}
        <div style={{ display:"flex", gap:4, flexWrap:"wrap", justifyContent:"flex-end" }}>
          {filaments.map((f,i) => (
            <div key={i} style={{ width:16, height:16, borderRadius:"50%",
              backgroundColor:hexCss(f.color_hex),
              border:"1px solid rgba(255,255,255,0.2)", flexShrink:0 }}/>
          ))}
        </div>
        <span style={{ color:"var(--muted)", fontSize:12 }}>{open?"▲":"▼"}</span>
      </button>
      {/* Détail déplié */}
      {open && (
        <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
          {filaments.map((f,i) => (
            <div key={i} onClick={e=>{e.stopPropagation();console.log("[FILAMENT CLICK]",f);onSpoolClick&&onSpoolClick({filId:f.bam_filament_id||null,spoolId:f.spool_id||null,hex:f.color_hex||null});}}
              style={{ display:"flex", alignItems:"center", gap:10,
              padding:"8px 12px", background:"var(--bg)",
              borderTop:"1px solid var(--border)", cursor:"pointer" }}>
              <div style={{ width:20, height:20, borderRadius:"50%", flexShrink:0,
                backgroundColor:hexCss(f.color_hex),
                border:f.spool_id?"2px solid #22c55e":"1px solid rgba(255,255,255,0.15)" }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:12, fontWeight:600, color:"var(--text)", margin:0,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {f.filament_translated_name || f.filament_fila_type || f.filament_name || "Inconnu"}
                  {f.spool_id && <span style={{ fontSize:9, color:"#22c55e", marginLeft:5 }}>✓#{f.spool_id}</span>}
                </p>
                <p style={{ fontSize:10, color:"var(--muted)", margin:"1px 0 0" }}>
                  {[f.filament_brand, f.filament_fila_type || f.filament_type, f.grams_used?.toFixed(1)+"g"].filter(Boolean).join(" · ")}
                </p>
              </div>
              {(f.cost > 0 || f.normal_cost > 0) && (
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <span style={{ fontSize:12, fontWeight:700, color:"var(--text)", fontFamily:"monospace" }}>
                    {(f.cost||f.normal_cost||0).toFixed(2)}€
                  </span>
                  {f.cost > 0 && f.normal_cost > 0 && f.cost !== f.normal_cost && (
                    <p style={{ fontSize:9, color:"var(--muted)", margin:0 }}>({f.normal_cost.toFixed(2)}€)</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

function PrintEditSheet({ p, onClose, onSaved }) {
  const [form, setForm] = useState({
    file_name:     p.file_name || "",
    original_name: p.original_name || "",
    print_date:    (p.print_date || "").slice(0,16),
    status:        p.status || "SUCCESS",
    status_note:   p.status_note || "",
    design_id:     p.design_id || "",
    duration_h: Math.floor((p.duration_seconds||p.estimated_seconds||0)/3600),
    duration_m: Math.floor(((p.duration_seconds||p.estimated_seconds||0)%3600)/60),
  });
  const [saving, setSaving] = useState(false);

  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {...form};
      payload.duration_seconds = ((parseInt(payload.duration_h)||0)*3600) + ((parseInt(payload.duration_m)||0)*60);
      delete payload.duration_h; delete payload.duration_m;
      delete payload.original_name;
      await client.patch(`/prints/${p.id}`, payload);
      onSaved(form);
    } catch(e) { alert("Erreur: " + (e.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"8px 12px", fontSize:13, color:"var(--text)", outline:"none",
    width:"100%", boxSizing:"border-box" };
  const sel = { ...inp, cursor:"pointer" };
  const lbl = { fontSize:10, color:"var(--muted)", textTransform:"uppercase",
    letterSpacing:"0.05em", marginBottom:4, display:"block" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:2000,
      display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", width:"100%",
          maxWidth:640, maxHeight:"90dvh", overflowY:"auto",
          padding:"0 16px 24px", paddingBottom:"env(safe-area-inset-bottom,24px)" }}>

        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 8px", position:"relative" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:10, right:0, width:28, height:28,
            borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer",
            color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>

        <h3 style={{ fontSize:15, fontWeight:800, margin:"0 0 16px", color:"var(--text)" }}>
          ✏️ Éditer le print
        </h3>

        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div>
            <label style={lbl}>Nom affiché</label>
            <input style={inp} value={form.file_name} onChange={e=>set("file_name",e.target.value)}/>
          </div>
          <div>
            <label style={lbl}>Nom original (lecture seule)</label>
            <input style={{...inp, color:"var(--muted)", cursor:"default"}} value={form.original_name} readOnly/>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <div>
              <label style={lbl}>Date et heure</label>
              <input type="datetime-local" style={inp} value={form.print_date} onChange={e=>set("print_date",e.target.value)}/>
            </div>
            <div>
              <label style={lbl}>Durée (minutes)</label>
              <input type="number" min="0" style={inp} value={form.duration_min} onChange={e=>set("duration_min",e.target.value)} placeholder="ex: 125"/>
            </div>
          </div>
          <div>
            <label style={lbl}>Statut</label>
            <select style={sel} value={form.status} onChange={e=>set("status",e.target.value)}>
              <option value="SUCCESS">Réussi</option>
              <option value="FAILED">Échoué</option>
              <option value="IN_PROGRESS">En cours</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Note de statut</label>
            <textarea style={{...inp, minHeight:80, resize:"vertical"}} value={form.status_note}
              onChange={e=>set("status_note",e.target.value)} placeholder="Détails sur l'impression…"/>
          </div>
          <div>
            <label style={lbl}>ID MakerWorld (design_id)</label>
            <input style={inp} value={form.design_id} onChange={e=>set("design_id",e.target.value)}
              placeholder="ex: 123456"/>
          </div>
        </div>

        <div style={{ display:"flex", gap:8, marginTop:20 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:"11px", borderRadius:12, border:"1px solid var(--border)",
              background:"var(--surface2)", color:"var(--muted)", fontSize:13, cursor:"pointer" }}>
            Annuler
          </button>
          <button onClick={save} disabled={saving}
            style={{ flex:2, padding:"11px", borderRadius:12, border:"none",
              background:"#3b82f6", color:"white", fontSize:13, fontWeight:700,
              cursor:saving?"not-allowed":"pointer", opacity:saving?0.7:1 }}>
            {saving ? "Enregistrement…" : "💾 Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PrintDetail({ p: pProp, onClose, onDelete, onChanged }) {
  const [snaps, setSnaps] = useState([]);
  const [ungrouped, setUngrouped] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [userPhotos, setUserPhotos] = useState([]);
  const loadUserPhotos = () => client.get(`/prints/${pProp.id}/photos`).then(r=>setUserPhotos(Array.isArray(r.data)?r.data:[])).catch(()=>{});
  useEffect(() => { loadUserPhotos(); }, [pProp.id]);
  const uploadPhoto = async (file) => { const fd = new FormData(); fd.append("file", file); await client.post(`/prints/${pProp.id}/photos/upload`, fd, { headers:{"Content-Type":"multipart/form-data"} }); loadUserPhotos(); };
  const [p, setP] = useState(pProp);

  useEffect(() => {
    if (pProp.total_cost_filament == null) {
      client.get("/prints/" + pProp.id).then(r => setP(r.data)).catch(() => setP(pProp));
    } else { setP(pProp); }
  }, [pProp.id]);

  const groupe = ungrouped ? null : p.group_name;
  const [editNb, setEditNb]   = useState(false);
  const [spoolPicker, setSpoolPicker] = useState(null);
