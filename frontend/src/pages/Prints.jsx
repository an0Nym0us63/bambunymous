import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, Upload, Search, Filter, Clock, Package, CheckCircle, XCircle, Loader } from "lucide-react";
import client from "../api/client";

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

// ── Tuile groupe collapsible ────────────────────────────────────────────────
function GroupTile({ name, prints, latestDate, onSelectPrint, onDelete }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ gridColumn:"1 / -1" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width:"100%", background:"var(--surface)", border:"1px solid rgba(167,139,250,0.35)",
          borderRadius: open ? "12px 12px 0 0" : 12, padding:"10px 16px",
          cursor:"pointer", display:"flex", alignItems:"center", gap:10, textAlign:"left" }}>
        <span style={{ fontSize:15 }}>{open ? "📂" : "📁"}</span>
        <span style={{ flex:1, fontWeight:700, fontSize:13, color:"#a78bfa" }}>{name}</span>
        <span style={{ fontSize:11, color:"var(--muted)" }}>
          {prints.length} print{prints.length > 1 ? "s" : ""} · {fmtDate(latestDate)}
        </span>
        <span style={{ fontSize:11, color:"var(--muted)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ borderLeft:"3px solid rgba(167,139,250,0.45)",
          borderRight:"1px solid rgba(167,139,250,0.2)",
          borderBottom:"1px solid rgba(167,139,250,0.2)",
          borderRadius:"0 0 12px 12px",
          padding:"12px 12px 12px 16px",
          background:"rgba(167,139,250,0.03)" }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:10 }}>
            {prints.map(p => (
              <PrintCard key={p.id} p={p}
                onClick={() => onSelectPrint(p)}
                onDelete={onDelete}/>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function PrintCard({ p, onClick, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const statusCfg = STATUS_CFG[p.status] || { bg:"rgba(0,0,0,0.5)", color:"white", label: p.status || "?" };

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    try {
      await client.delete("/prints/" + p.id);
      onDelete(p.id);
    } catch(err) { alert("Erreur: " + (err.response?.data?.detail || err.message)); }
    setMenuOpen(false); setConfirming(false);
  };

  return (
    <div className="card" style={{ overflow:"hidden", display:"flex",
      flexDirection:"column", position:"relative", padding:0 }}>

      {/* Vignette pleine largeur ratio 4/3 */}
      <div onClick={onClick} style={{ cursor:"pointer", position:"relative",
        paddingTop:"75%", background:"var(--surface2)", overflow:"hidden" }}>
        <img src={"/api/v1/prints/" + p.id + "/image"} alt=""
          style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}
          onError={e => { e.currentTarget.style.display="none"; }}/>
        {/* Badge statut */}
        <span style={{ position:"absolute", top:6, left:6,
          background: statusCfg.bg, color: statusCfg.color,
          fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:20 }}>
          {statusCfg.label}
        </span>
        {/* Pastilles filament */}
        {p.filament_usage?.length > 0 && (
          <div style={{ position:"absolute", bottom:6, left:6, display:"flex", gap:3 }}>
            {p.filament_usage.map((f,i) => (
              <div key={i} style={{ width:11, height:11, borderRadius:"50%",
                backgroundColor: hexCss(f.color_hex),
                border:"1.5px solid rgba(255,255,255,0.7)", flexShrink:0 }}/>
            ))}
          </div>
        )}
        {/* Menu */}
        <div style={{ position:"absolute", top:6, right:6 }}>
          <button onClick={e=>{e.stopPropagation();setMenuOpen(o=>!o);setConfirming(false);}}
            style={{ background:"rgba(0,0,0,0.55)", border:"none", borderRadius:"50%",
              width:24, height:24, cursor:"pointer", color:"white", fontSize:14,
              display:"flex", alignItems:"center", justifyContent:"center" }}>⋮</button>
          {menuOpen && (
            <div style={{ position:"absolute", top:28, right:0, background:"var(--surface)",
              border:"1px solid var(--border)", borderRadius:8, padding:4,
              minWidth:120, zIndex:10 }}>
              <button onClick={handleDelete}
                style={{ width:"100%", padding:"6px 10px", background:"none", border:"none",
                  color:confirming?"#ef4444":"var(--text)", cursor:"pointer",
                  fontSize:12, textAlign:"left", borderRadius:4 }}>
                {confirming ? "Confirmer ?" : "Supprimer"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Infos minimales */}
      <div onClick={onClick} style={{ padding:"8px 10px", cursor:"pointer" }}>
        <p style={{ fontWeight:700, fontSize:12, color:"var(--text)", margin:"0 0 2px",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {p.file_name || "Sans nom"}
        </p>
        <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>{fmtDate(p.print_date)}</p>
      </div>
    </div>
  );
}


function SnapshotGallery({ snaps, printId, onDelete }) {
  const [lightbox, setLightbox] = useState(null);
  const [diskFiles, setDiskFiles] = useState([]);

  useEffect(() => {
    client.get("/prints/" + printId + "/snapshots")
      .then(r => setDiskFiles(r.data.files || []))
      .catch(() => {});
  }, [printId]);

  const LABELS = { layer1:"Couche 1", layer2:"Couche 2", pct50:"50%", pct99:"99%", pct100:"100%", manual:"Manuel" };

  const handleDelete = async (e, s) => {
    e.stopPropagation();
    try {
      await client.delete("/prints/" + printId + "/snapshots/" + s.id);
      onDelete(s.id);
      if (lightbox && lightbox.snap && lightbox.snap.id === s.id) setLightbox(null);
    } catch(err) { alert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };

  const snapByName = {};
  (snaps||[]).forEach(s => { snapByName["snapshot-" + s.trigger + ".jpg"] = s; });

  const allItems = diskFiles.length > 0
    ? diskFiles.map(f => {
        const s = snapByName[f.name] || null;
        return { url: f.url, name: f.name, snap: s, label: s ? (LABELS[s.trigger] || s.trigger) : f.name.replace(/\.[^.]+$/, "") };
      })
    : (snaps||[]).map(s => ({
        url: "/api/v1/prints/" + printId + "/snapshot/" + s.trigger,
        name: "snapshot-" + s.trigger + ".jpg", snap: s,
        label: LABELS[s.trigger] || s.trigger,
      }));

  if (!allItems.length) return null;

  return (
    <>
      <p style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>
        Photos ({allItems.length})
      </p>
      <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:6, scrollbarWidth:"thin" }}>
        {allItems.map((item, i) => (
          <div key={i} onClick={() => setLightbox(item)}
            style={{ position:"relative", flexShrink:0, cursor:"pointer" }}>
            <img src={item.url} alt={item.label}
              style={{ height:110, width:"auto", borderRadius:8, objectFit:"cover",
                border:"1px solid var(--border)", display:"block" }}
              onError={e => { e.currentTarget.style.display="none"; }}/>
            <span style={{ position:"absolute", bottom:4, left:4,
              background:"rgba(0,0,0,0.65)", color:"white",
              fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:4 }}>
              {item.label}
            </span>
            {item.snap && (
              <button onClick={e => handleDelete(e, item.snap)}
                style={{ position:"absolute", top:4, right:4,
                  background:"rgba(0,0,0,0.6)", border:"none", borderRadius:"50%",
                  width:20, height:20, cursor:"pointer", color:"white", fontSize:11,
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
                x
              </button>
            )}
          </div>
        ))}
      </div>
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:2000,
            display:"flex", alignItems:"center", justifyContent:"center" }}>
          <img src={lightbox.url} alt={lightbox.label}
            style={{ maxWidth:"90vw", maxHeight:"90vh", borderRadius:12, objectFit:"contain" }}
            onClick={e => e.stopPropagation()}/>
        </div>
      )}
    </>
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
                    <p style={{ fontSize:12, color:"var(--text)", margin:0, fontWeight:600 }}>
                      {f.filament_name || f.filament_type || "Inconnu"}
                      {f.spool_id && <span style={{ fontSize:10, color:"#22c55e", marginLeft:6, fontWeight:400 }}>✓</span>}
                    </p>
                    <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>
                      {[f.filament_type, f.grams_used?.toFixed(1)+"g"].filter(Boolean).join(" · ")}
                      {!f.spool_id && <span style={{ color:"#f59e0b", marginLeft:4 }}>Non mappé</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Snapshots */}
        {snaps.length > 0 && (
          <SnapshotGallery snaps={snaps} printId={p.id}
            onDelete={sid => setSnaps(ss => ss.filter(s => s.id !== sid))}/>
        )}
      </div>
    </div>
  );
}

export default function Prints() {
  const [prints, setPrints]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset]   = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch]   = useState("");
  const [statusF, setStatusF] = useState("");
  const [selected, setSelected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError]     = useState(null);
  const [debugInfo, setDebugInfo] = useState("");
  const [groups, setGroups]   = useState([]);
  const [groupF, setGroupF]   = useState("");


  const LIMIT = 40;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOffset(0);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: 0 });
      if (search)  params.set("search", search);
      if (statusF) params.set("status", statusF);
      if (groupF)  params.set("group",  groupF);
      const { data } = await client.get("/prints?" + params);
      setDebugInfo("total=" + data.total + " prints=" + (data.prints||[]).length);
      setPrints(data.prints ?? []);
      setTotal(data.total ?? 0);
      setHasMore(data.has_more ?? false);
    } catch(e) {
      setError(e.response?.data?.detail || e.message || "Erreur");
    }
    setLoading(false);
  }, [search, statusF, groupF]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = offset + LIMIT;
      const params = new URLSearchParams({ limit: LIMIT, offset: next });
      if (search)  params.set("search", search);
      if (statusF) params.set("status", statusF);
      if (groupF)  params.set("group",  groupF);
      const { data } = await client.get("/prints?" + params);
      const existingIds = new Set(prints.map(p => p.id));
      const fresh = (data.prints || []).filter(p => !existingIds.has(p.id));
      setPrints(prev => [...prev, ...fresh]);
      setOffset(next);
      setHasMore(data.has_more ?? false);
    } catch(e) {}
    setLoadingMore(false);
  };


  const loadGroups = useCallback(async () => {
    try {
      const { data } = await client.get("/prints/groups");
      console.log("[GROUPES]", data.groups);
      setGroups(data.groups || []);
    } catch(e) { console.error("[GROUPES] erreur", e); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadGroups(); }, [loadGroups]);

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

      {!loading && !error && prints.length > 0 && (() => {
        const onDelete = id => { setPrints(ps => ps.filter(x => x.id !== id)); setTotal(t => t-1); };
        // Si un groupe est sélectionné ou pas de groupes → grille flat
        // Construire une liste d'items entrelacés triés par date décroissante.
        // Un groupe est représenté une seule fois à la date de son print le plus récent.
        // Grille flat si filtre actif
        if (groupF) {
          return (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))", gap:10 }}>
              {prints.map(p => <PrintCard key={p.id} p={p} onClick={()=>setSelected(p)} onDelete={onDelete}/>)}
            </div>
          );
        }

        // Agréger les groupes
        const groupMap = {};   // nom → { prints[], latestDate }
        const seen = new Set();
        prints.forEach(p => {
          const gtags = (p.tags||[]).filter(t=>t.startsWith("groupe:"));
          if (gtags.length) {
            gtags.forEach(t => {
              const g = t.replace("groupe:","");
              if (!groupMap[g]) groupMap[g] = { prints:[], latestDate:"" };
              groupMap[g].prints.push(p);
              if (!groupMap[g].latestDate || p.print_date > groupMap[g].latestDate)
                groupMap[g].latestDate = p.print_date;
            });
          }
        });

        // Construire la liste d'items : soit un print solo, soit un groupe entier
        const items = [];
        const addedGroups = new Set();
        prints.forEach(p => {
          const gtags = (p.tags||[]).filter(t=>t.startsWith("groupe:"));
          if (!gtags.length) {
            // Print solo → item individuel
            items.push({ type:"print", p, date: p.print_date });
          } else {
            // Print de groupe → ajouter le groupe une seule fois à sa date max
            gtags.forEach(t => {
              const g = t.replace("groupe:","");
              if (!addedGroups.has(g)) {
                addedGroups.add(g);
                items.push({ type:"group", name:g, ...groupMap[g] });
              }
            });
          }
        });

        // Trier par date décroissante (groupes à la date de leur print le plus récent)
        items.sort((a,b) => (b.date||b.latestDate||"").localeCompare(a.date||a.latestDate||""));

        // Grille responsive : 2 cols mobile, 3-4 cols desktop
        const GRID = "repeat(auto-fill, minmax(160px, 1fr))";
        return (
          <div style={{ display:"grid", gridTemplateColumns:GRID, gap:10 }}>
            {items.map((item, idx) => item.type === "print" ? (
              <PrintCard key={item.p.id} p={item.p}
                onClick={()=>setSelected(item.p)}
                onDelete={onDelete}/>
            ) : (
              <GroupTile key={item.name} name={item.name}
                prints={item.prints} latestDate={item.latestDate}
                onSelectPrint={setSelected} onDelete={onDelete}/>
            ))}
          </div>
        );
      })()}

      {hasMore && !loading && (
        <button onClick={loadMore} disabled={loadingMore}
          style={{ width:"100%", padding:"12px", marginTop:8,
            background:"var(--surface2)", border:"1px solid var(--border)",
            borderRadius:10, cursor:loadingMore?"not-allowed":"pointer",
            color:"var(--muted)", fontSize:13, fontWeight:600 }}>
          {loadingMore ? "Chargement…" : "Charger plus (" + (total - prints.length) + " restants)"}
        </button>
      )}

      {selected && <PrintDetail p={selected} onClose={()=>setSelected(null)}/>}
    </div>
  );
}
