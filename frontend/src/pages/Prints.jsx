import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, Upload, Search, Filter, Clock, Package, CheckCircle, XCircle, Loader } from "lucide-react";
import client from "../api/client";

const STATUS_CFG = {
  IN_PROGRESS: { label:"En cours",  color:"#3b82f6", icon:Loader },
  SUCCESS:     { label:"Réussi",    color:"#22c55e", icon:CheckCircle },
  FAILED:      { label:"Échoué",    color:"#ef4444", icon:XCircle },
  CANCELLED:   { label:"Annulé",    color:"#94a3b8", icon:XCircle },
};

function fmtDur(s) {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2,"0")}min` : `${m}min`;
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
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

function PrintCard({ p, onClick, onDelete }) {
  const imgUrl = p.plate_image ? `/api/v1/prints/${p.id}/image` : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    try {
      await client.delete(`/prints/${p.id}`);
      onDelete(p.id);
    } catch(err) { alert("Erreur: " + (err.response?.data?.detail || err.message)); }
    setMenuOpen(false); setConfirming(false);
  };

  return (
    <div className="card" style={{ overflow:"hidden", display:"flex",
      flexDirection:"column", gap:0, position:"relative" }}>

      <div onClick={onClick} style={{ height:140, background:"#111",
        flexShrink:0, position:"relative", cursor:"pointer" }}>
        {imgUrl
          ? <img src={imgUrl} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
          : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center",
              justifyContent:"center", color:"var(--muted)", fontSize:11,
              background:"repeating-conic-gradient(var(--surface2) 0% 25%, var(--surface) 0% 50%) 0 0/20px 20px" }}>
              <span style={{ background:"var(--surface)", padding:"4px 10px", borderRadius:6, fontSize:10 }}>Pas de vignette</span>
            </div>
        }
        <div style={{ position:"absolute", top:6, left:6 }}>
          <StatusBadge status={p.status}/>
        </div>
        <button onClick={e=>{ e.stopPropagation(); setMenuOpen(m=>!m); setConfirming(false); }}
          style={{ position:"absolute", top:6, right:6, background:"rgba(0,0,0,0.55)",
            border:"none", borderRadius:"50%", width:26, height:26, cursor:"pointer",
            color:"white", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center",
            lineHeight:1 }}>
          ⋮
        </button>
        {menuOpen && (
          <div onClick={e=>e.stopPropagation()} style={{
            position:"absolute", top:36, right:6, background:"var(--surface)",
            border:"1px solid var(--border)", borderRadius:10,
            boxShadow:"0 4px 20px rgba(0,0,0,0.5)", zIndex:10, minWidth:170, overflow:"hidden",
          }}>
            <button onClick={handleDelete} style={{
              width:"100%", padding:"11px 16px", background:"none", border:"none",
              textAlign:"left", fontSize:13, cursor:"pointer",
              color: confirming ? "#ef4444" : "var(--text)",
              display:"flex", alignItems:"center", gap:8,
            }}>
              🗑 {confirming ? "Confirmer ?" : "Supprimer"}
            </button>
            {confirming && (
              <button onClick={e=>{ e.stopPropagation(); setConfirming(false); setMenuOpen(false); }}
                style={{ width:"100%", padding:"9px 16px", background:"none",
                  borderTop:"1px solid var(--border)", border:"none", textAlign:"left",
                  fontSize:12, cursor:"pointer", color:"var(--muted)" }}>
                Annuler
              </button>
            )}
          </div>
        )}
      </div>

      <div onClick={onClick} style={{ padding:"10px 12px", display:"flex",
        flexDirection:"column", gap:6, cursor:"pointer" }}>
        <p style={{ fontWeight:700, fontSize:13, color:"var(--text)",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {p.file_name || "Sans nom"}
        </p>
        <p style={{ fontSize:11, color:"var(--muted)" }}>{fmtDate(p.print_date)}</p>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <FilamentDots filaments={p.filament_usage}/>
          <div style={{ display:"flex", gap:10, fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>
            {p.total_weight_g > 0 && <span>{p.total_weight_g.toFixed(0)}g</span>}
            {p.duration_seconds > 0 && <span>{fmtDur(p.duration_seconds)}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function PrintDetail({ p, onClose }) {
  const [snaps, setSnaps] = useState([]);
  const imgUrl = p.plate_image ? `/api/v1/prints/${p.id}/image` : null;

  useEffect(() => {
    if (p.snapshots?.length) {
      setSnaps(p.snapshots.sort((a,b) => new Date(a.taken_at) - new Date(b.taken_at)));
    }
  }, [p]);

  const snapUrl = (trigger) => `/api/v1/prints/${p.id}/snapshot/${trigger}`;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000,
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:"var(--surface)", borderRadius:"20px 20px 0 0", width:"100%",
          maxWidth:600, maxHeight:"90dvh", overflowY:"auto", padding:20 }}>

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <h2 style={{ fontSize:16, fontWeight:700, color:"var(--text)", flex:1,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {p.file_name}
          </h2>
          <button onClick={onClose} style={{ background:"none", border:"none",
            color:"var(--muted)", cursor:"pointer", fontSize:20, padding:"0 4px" }}>✕</button>
        </div>

        <StatusBadge status={p.status}/>

        {/* Vignette */}
        {imgUrl && <img src={imgUrl} alt="" style={{ width:"100%", borderRadius:12,
          marginTop:12, marginBottom:12, objectFit:"cover", maxHeight:200 }}/>}

        {/* Infos */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
          {[
            ["Date",      fmtDate(p.print_date)],
            ["Type",      p.print_type],
            ["Durée",     fmtDur(p.duration_seconds || p.estimated_seconds)],
            ["Plateau",   p.plate_id || "1"],
            ["Poids",     p.total_weight_g ? `${p.total_weight_g.toFixed(1)}g` : "—"],
            ["Coût",      p.total_cost ? `${p.total_cost.toFixed(2)}€` : "—"],
          ].map(([label, value]) => (
            <div key={label} style={{ background:"var(--surface2)",
              border:"1px solid var(--border)", borderRadius:10, padding:"8px 12px" }}>
              <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
                letterSpacing:"0.05em", marginBottom:2 }}>{label}</p>
              <p style={{ fontSize:13, fontWeight:600, fontFamily:"monospace", color:"var(--text)" }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filaments */}
        {p.filament_usage?.length > 0 && (
          <div style={{ marginBottom:12 }}>
            <p style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase",
              letterSpacing:"0.05em", marginBottom:6 }}>Filaments</p>
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              {p.filament_usage.map((f,i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:8,
                  background:"var(--surface2)",
                  border:`1px solid ${f.spool_id ? "rgba(34,197,94,0.3)" : "var(--border)"}`,
                  borderRadius:8, padding:"6px 10px" }}>
                  <div style={{ position:"relative", flexShrink:0 }}>
                    <div style={{ width:22, height:22, borderRadius:"50%",
                      backgroundColor:hexCss(f.color_hex),
                      border: f.spool_id ? "2px solid #22c55e" : "1px solid rgba(255,255,255,0.15)" }}/>
                    {!f.spool_id && (
                      <span style={{ position:"absolute", top:-3, right:-3,
                        fontSize:9, color:"#f59e0b", fontWeight:700 }}>?</span>
                    )}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:12, color:"var(--text)", margin:0,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {f.filament_type || "Inconnu"}
                      {f.spool_id && <span style={{ fontSize:10, color:"#22c55e", marginLeft:6 }}>✓ liée</span>}
                    </p>
                    {!f.spool_id && (
                      <p style={{ fontSize:10, color:"#f59e0b", margin:0 }}>Non mappé à une bobine</p>
                    )}
                  </div>
                  <span style={{ fontSize:11, fontFamily:"monospace", color:"var(--muted)", flexShrink:0 }}>
                    {f.grams_used.toFixed(1)}g
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Snapshots */}
        {snaps.length > 0 && (
          <div>
            <p style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase",
              letterSpacing:"0.05em", marginBottom:6 }}>Snapshots</p>
            <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4 }}>
              {snaps.map((s,i) => (
                <img key={i} src={snapUrl(s.trigger)} alt={s.trigger}
                  style={{ height:100, borderRadius:8, flexShrink:0, objectFit:"cover",
                    border:"1px solid var(--border)" }}/>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Prints() {
  const [prints, setPrints]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [statusF, setStatusF] = useState("");
  const [selected, setSelected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError]     = useState(null);
  const [debugInfo, setDebugInfo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit:100 });
      if (search)  params.set("search",  search);
      if (statusF) params.set("status",  statusF);
      const { data } = await client.get(`/prints?${params}`);
      setDebugInfo(`total=${data.total} prints=${(data.prints||[]).length}`);
      setPrints(data.prints ?? []);
      setTotal(data.total ?? 0);
    } catch(e) {
      setError(e.response?.data?.detail || e.message || "Erreur");
      setDebugInfo("ERREUR: " + (e.response?.data?.detail || e.message));
    }
    setLoading(false);
  }, [search, statusF]);

  useEffect(() => { load(); }, [load]);

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const form = new FormData();
    form.append("file", file);
    try {
      await client.post("/prints/import", form, { headers:{"Content-Type":"multipart/form-data"} });
      await load();
    } catch(err) { alert("Erreur import: " + (err.response?.data?.detail || err.message)); }
    finally { setImporting(false); e.target.value = ""; }
  };

  const STATUSES = ["","IN_PROGRESS","SUCCESS","FAILED"];
  const STATUS_LABELS = {"":"Tous","IN_PROGRESS":"En cours","SUCCESS":"Réussis","FAILED":"Échoués"};

  return (
    <div style={{ maxWidth:900, margin:"0 auto", display:"flex", flexDirection:"column", gap:12 }}>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)" }}>Historique</h1>
          <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>{total} impressions</span>
          {debugInfo && <span style={{ fontSize:10, color:"#f59e0b", fontFamily:"monospace" }}>[{debugInfo}]</span>}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={load} style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 12px",
            borderRadius:8, fontSize:12, background:"var(--surface2)", border:"1px solid var(--border)",
            color:"var(--text2)", cursor:"pointer" }}>
            <RefreshCw size={13}/> Actualiser
          </button>
          <label style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 12px",
            borderRadius:8, fontSize:12, background:"var(--surface2)", border:"1px solid var(--border)",
            color:"var(--text2)", cursor:"pointer" }}>
            <Upload size={13}/> {importing ? "Import…" : "Importer .3mf"}
            <input type="file" accept=".3mf" onChange={handleImport} style={{ display:"none" }}/>
          </label>
        </div>
      </div>

      <div className="card" style={{ padding:"10px 12px", display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <Search size={13} style={{ color:"var(--muted)" }}/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher…"
          style={{ flex:1, minWidth:120, background:"var(--surface2)", border:"1px solid var(--border)",
            borderRadius:6, padding:"5px 10px", fontSize:12, color:"var(--text)", outline:"none" }}/>
        <div style={{ display:"flex", gap:4 }}>
          {STATUSES.map(s => (
            <button key={s} onClick={()=>setStatusF(s)} style={{
              padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600,
              cursor:"pointer", border:"none",
              background: statusF===s ? "#3b82f6" : "var(--surface2)",
              color: statusF===s ? "white" : "var(--muted)",
            }}>{STATUS_LABELS[s]}</button>
          ))}
        </div>
      </div>

      {loading && <p style={{ textAlign:"center", color:"var(--muted)", padding:"48px 0" }}>Chargement…</p>}

      {!loading && error && (
        <div style={{ margin:8, padding:"12px 16px", background:"rgba(239,68,68,0.1)",
          border:"1px solid rgba(239,68,68,0.3)", borderRadius:8, color:"#ef4444", fontSize:13 }}>
          ⚠ {error}
        </div>
      )}

      {!loading && !error && prints.length === 0 && (
        <p style={{ textAlign:"center", color:"var(--muted)", padding:"48px 0" }}>
          Aucune impression — les prochains prints apparaîtront automatiquement.
        </p>
      )}

      {!loading && !error && prints.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(200px, 1fr))", gap:12 }}>
          {prints.map(p => (
            <PrintCard key={p.id} p={p} onClick={()=>setSelected(p)}
              onDelete={id => { setPrints(ps => ps.filter(x => x.id !== id)); setTotal(t => t-1); }}/>
          ))}
        </div>
      )}

      {selected && <PrintDetail p={selected} onClose={()=>setSelected(null)}/>}
    </div>
  );
}
