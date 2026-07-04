import React, { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Upload, Search, Filter, Clock, Package, CheckCircle, XCircle, Loader, Image as ImageIcon, List, Check, FolderPlus, X, FolderMinus, SlidersHorizontal } from "lucide-react";
import client from "../api/client";
import GalleryCompare from "../components/GalleryCompare";

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
function GroupBottomSheet({ groupId, name, prints, latestDate, number_of_items, onClose, onSelectPrint, onDelete, onUngroup, onUpdated }) {
  const [selectedPrint, setSelectedPrint] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [groupPhotos, setGroupPhotos] = useState([]);
  const [nbItems, setNbItems] = useState(number_of_items || 1);

  useEffect(() => {
    if (!groupId) { setGroupPhotos([]); return; }
    client.get("/prints/groups/" + groupId + "/photos")
      .then(r => setGroupPhotos(r.data?.files || []))
      .catch(() => setGroupPhotos([]));
  }, [groupId]);

  // Stats agrégées
  const totalWeight  = prints.reduce((s, p) => s + (p.total_weight_g || 0), 0);
  const totalFil     = prints.reduce((s, p) => s + (p.total_cost_filament || 0), 0);
  const totalFilN    = prints.reduce((s, p) => s + (p.total_cost_filament_normal || 0), 0);
  const totalElec    = prints.reduce((s, p) => s + (p.electric_cost || 0), 0);
  const totalCost    = prints.reduce((s, p) => s + (p.total_cost || 0), 0);
  const totalDur     = prints.reduce((s, p) => s + (p.duration_seconds || p.estimated_seconds || 0), 0);
  const costPerItem  = nbItems > 1 ? totalCost / nbItems : null;

  // Agrégation filaments par couleur+type
  const filAgg = {};
  prints.forEach(p => {
    (p.filament_usage || []).forEach(f => {
      const key = (f.color_hex || "#888") + "|" + (f.filament_type || "?");
      if (!filAgg[key]) filAgg[key] = { color: f.color_hex, type: f.filament_type,
        name: f.filament_name, brand: f.filament_brand, grams: 0, spool_id: f.spool_id };
      filAgg[key].grams += f.grams_used || 0;
    });
  });
  const filaments = Object.values(filAgg).sort((a,b) => b.grams - a.grams);

  // Photos du dossier groupe uniquement — les vignettes des prints sont déjà
  // affichées juste en dessous dans la grille "Prints", pas besoin de doublon
  const photoItems = groupPhotos.map(f => ({ url: f.url, label: f.name }));

  return (
    <>
      {/* Bottom sheet groupe — z-index 1000 */}
      <div onClick={onClose} style={{ position:"fixed", inset:0,
        background:"rgba(0,0,0,0.55)", zIndex:1000,
        display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
        <div onClick={e => e.stopPropagation()}
          className="sheet-inner" className="sheet-inner" style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
            width:"100%", maxWidth:640, maxHeight:"88dvh", overflowY:"auto",
            paddingBottom:"env(safe-area-inset-bottom,16px)" }}>

          {/* Handle */}
          <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
            <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>

          <div style={{ padding:"16px 20px 20px" }}>
            {/* Titre */}
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
              <span style={{ fontSize:20 }}>📁</span>
              <div style={{ flex:1 }}>
                <h2 style={{ fontSize:18, fontWeight:800, color:"#a78bfa", margin:0 }}>{name}</h2>
                <p style={{ fontSize:11, color:"var(--muted)", margin:"2px 0 0" }}>
                  {prints.length} print{prints.length>1?"s":""} · {fmtDate(latestDate)}
                </p>
              </div>
            </div>

            {/* Photos — en premier */}
            {photoItems.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <p style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>
                  Photos ({photoItems.length})
                </p>
                <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:6, scrollbarWidth:"thin" }}>
                  {photoItems.map((item, i) => (
                    <div key={i} onClick={() => setLightbox(item)}
                      style={{ position:"relative", flexShrink:0, cursor:"pointer" }}>
                      <img src={item.url} alt={item.label}
                        style={{ height:110, width:"auto", borderRadius:8, objectFit:"cover",
                          border:"1px solid var(--border)", display:"block" }}
                        onError={e => { e.currentTarget.style.display="none"; }}/>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stats globales */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:6, marginBottom:12 }}>
              {[
                ["Durée totale",       totalDur > 0     ? fmtDur(totalDur)          : null],
                ["Poids filament",     totalWeight > 0  ? totalWeight.toFixed(0)+"g": null],
                ["Coût fil. (bobine)",  totalFil > 0     ? totalFil.toFixed(2)+"€"   : null],
                ["Coût fil. normal",   totalFilN > 0    ? totalFilN.toFixed(2)+"€"  : null],
                ["Coût électricité",   totalElec > 0    ? totalElec.toFixed(2)+"€"  : null],
              ].filter(([,v]) => v).map(([label, val]) => (
                <div key={label} style={{ background:"var(--surface2)",
                  border:"1px solid var(--border)", borderRadius:10, padding:"8px 10px" }}>
                  <p style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase",
                    letterSpacing:"0.06em", margin:"0 0 3px" }}>{label}</p>
                  <p style={{ fontSize:13, fontWeight:700, color:"var(--text)",
                    margin:0, fontFamily:"monospace" }}>{val}</p>
                </div>
              ))}
              {totalCost > 0 && (
                <div style={{ gridColumn:"1/-1", background:"rgba(59,130,246,0.06)",
                  border:"1px solid rgba(59,130,246,0.2)", borderRadius:10, padding:"8px 12px",
                  display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <p style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase",
                    letterSpacing:"0.06em", margin:0 }}>Coût total</p>
                  <p style={{ fontSize:16, fontWeight:800, color:"var(--text)", margin:0, fontFamily:"monospace" }}>
                    {totalCost.toFixed(2)}€
                  </p>
                </div>
              )}
              {costPerItem && (
                <div style={{ gridColumn:"1/-1", background:"rgba(34,197,94,0.06)",
                  border:"1px solid rgba(34,197,94,0.2)", borderRadius:10, padding:"8px 12px",
                  display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <p style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase",
                    letterSpacing:"0.06em", margin:0 }}>Coût / élément × {nbItems}</p>
                  <p style={{ fontSize:16, fontWeight:800, color:"#22c55e", margin:0, fontFamily:"monospace" }}>
                    {costPerItem.toFixed(2)}€
                  </p>
                </div>
              )}
            </div>

            <QuantityEditor id={groupId} type="group" value={nbItems}
              onChange={n => setNbItems(n)}/>

            {/* Filaments agrégés */}
            {filaments.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
                  letterSpacing:"0.06em", marginBottom:8 }}>Filaments utilisés</p>
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  {filaments.map((f, i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:8,
                      background:"var(--surface2)",
                      border:"1px solid " + (f.spool_id ? "rgba(34,197,94,0.25)" : "var(--border)"),
                      borderRadius:8, padding:"6px 10px" }}>
                      <div style={{ width:22, height:22, borderRadius:"50%", flexShrink:0,
                        backgroundColor: hexCss(f.color),
                        border: f.spool_id ? "2px solid #22c55e" : "1.5px solid rgba(255,255,255,0.2)",
                        boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:12, fontWeight:700, color:"var(--text)", margin:0,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {f.name || f.type || "Inconnu"}
                          {f.spool_id && <span style={{ fontSize:9, color:"#22c55e", marginLeft:6, fontWeight:400 }}>✓</span>}
                        </p>
                        <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>
                          {[f.brand, f.type, f.grams.toFixed(0)+"g"].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Galerie prints */}
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
              letterSpacing:"0.06em", marginBottom:8 }}>Prints</p>
            <div style={{ display:"grid",
              gridTemplateColumns:"repeat(auto-fill, minmax(120px, 1fr))", gap:8 }}>
              {prints.map(p => (
                <div key={p.id} style={{ position:"relative", borderRadius:10, overflow:"hidden",
                    border:"1px solid var(--border)", background:"var(--surface2)" }}>
                  <div onClick={() => setSelectedPrint(p)}
                    style={{ position:"relative", paddingTop:"75%", cursor:"pointer" }}>
                    <img src={"/api/v1/prints/" + p.id + "/image"} alt=""
                      style={{ position:"absolute", inset:0, width:"100%", height:"100%",
                        objectFit:"contain" }}
                      onError={e => { e.currentTarget.style.display="none"; }}/>
                    {/* Pastilles filament */}
                    {p.filament_usage?.length > 0 && (
                      <div style={{ position:"absolute", bottom:4, left:4,
                        display:"flex", gap:2, flexWrap:"wrap", maxWidth:"calc(100% - 8px)" }}>
                        {p.filament_usage.map((f, i) => (
                          <div key={i} style={{ width:10, height:10, borderRadius:"50%",
                            backgroundColor: hexCss(f.color_hex),
                            border:"1.5px solid rgba(255,255,255,0.8)",
                            boxShadow:"0 1px 3px rgba(0,0,0,0.4)", flexShrink:0 }}/>
                        ))}
                      </div>
                    )}
                    <button title="Retirer du groupe"
                      onClick={async e => {
                        e.stopPropagation();
                        if (!confirm("Retirer ce print du groupe ?")) return;
                        try {
                          await client.post("/prints/" + p.id + "/group", {});
                          onUngroup?.(p.id);
                        } catch(err) { alert("Erreur: " + (err.response?.data?.detail || err.message)); }
                      }}
                      style={{ position:"absolute", top:4, right:4, width:20, height:20, borderRadius:"50%",
                        background:"rgba(0,0,0,0.6)", border:"none", color:"white", cursor:"pointer",
                        display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <FolderMinus size={11}/>
                    </button>
                  </div>
                  <p style={{ fontSize:9, color:"var(--muted)", margin:"4px 6px 4px",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {p.file_name || "Sans nom"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:1200,
            display:"flex", alignItems:"center", justifyContent:"center" }}>
          <img src={lightbox.url} alt={lightbox.label}
            style={{ maxWidth:"90vw", maxHeight:"90vh", borderRadius:12, objectFit:"contain" }}
            onClick={e => e.stopPropagation()}/>
        </div>
      )}

      {/* Bottom sheet print par dessus — z-index 1100 */}
      {selectedPrint && (
        <div style={{ position:"fixed", inset:0, zIndex:1100 }}>
          <PrintDetail p={selectedPrint}
            onClose={() => setSelectedPrint(null)}
            onDelete={id => { onDelete(id); setSelectedPrint(null); }}
            onChanged={() => onUngroup?.(selectedPrint.id)}/>
        </div>
      )}
    </>
  );
}

function GroupTile({ groupId, name, prints, latestDate, number_of_items, onSelectPrint, onDelete, onUngroup }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const coverPrint = prints[0];

  return (
    <>
      <div className="card" onClick={() => setSheetOpen(true)}
        style={{ overflow:"hidden", display:"flex", flexDirection:"column",
          position:"relative", padding:0, cursor:"pointer" }}>
        <div style={{ position:"relative", paddingTop:"75%",
          background:"var(--surface2)", overflow:"hidden" }}>
          {coverPrint && (
            <img src={"/api/v1/prints/" + coverPrint.id + "/image"} alt=""
              style={{ position:"absolute", inset:0, width:"100%", height:"100%",
                objectFit:"contain" }}
              onError={e => { e.currentTarget.style.display="none"; }}/>
          )}
          <div style={{ position:"absolute", inset:0, background:"rgba(124,58,237,0.08)" }}/>
          <span style={{ position:"absolute", top:6, left:6,
            background:"rgba(124,58,237,0.85)", color:"white",
            fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>
            📁 {prints.length} print{prints.length>1?"s":""}
          </span>
          {number_of_items > 1 && (
            <span style={{ position:"absolute", top:6, right:6,
              background:"rgba(59,130,246,0.85)", color:"white",
              fontSize:9, fontWeight:800, padding:"2px 7px", borderRadius:20 }}>
              ×{number_of_items}
            </span>
          )}
        </div>
        <div style={{ padding:"8px 10px" }}>
          <p style={{ fontWeight:700, fontSize:12, color:"#a78bfa", margin:"0 0 2px",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</p>
          <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>{fmtDate(latestDate)}</p>
        </div>
      </div>

      {sheetOpen && (
        <GroupBottomSheet
          groupId={groupId} name={name} prints={prints} latestDate={latestDate}
          number_of_items={number_of_items}
          onClose={() => setSheetOpen(false)}
          onSelectPrint={onSelectPrint}
          onUngroup={onUngroup}
          onDelete={id => { onDelete(id); }}/>
      )}
    </>
  );
}


function QuantityEditor({ id, type, value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = parseInt(val);
    if (isNaN(n) || n < 1) return;
    setSaving(true);
    try {
      if (type === "print") await client.patch(`/prints/${id}`, { number_of_items: n });
      else await client.patch(`/prints/groups/${id}`, { number_of_items: n });
      onChange?.(n);
      setEditing(false);
    } catch(e) { alert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ marginBottom:12, padding:"8px 12px", borderRadius:10,
      background:"var(--surface2)", border:"1px solid var(--border)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:11, color:"var(--muted)" }}>Nombre d'éléments imprimés</span>
        {!editing && (
          <button onClick={() => { setVal(String(value)); setEditing(true); }}
            style={{ fontSize:11, color:"#60a5fa", background:"none", border:"none", cursor:"pointer" }}>
            {value > 1 ? `× ${value} ✏️` : "Définir"}
          </button>
        )}
      </div>
      {editing && (
        <div style={{ display:"flex", gap:6, marginTop:6, alignItems:"center" }}>
          <input type="number" min="1" value={val} autoFocus
            onChange={e => setVal(e.target.value)}
            style={{ width:70, padding:"5px 8px", borderRadius:7, fontSize:13,
              background:"var(--surface)", border:"1px solid var(--border)",
              color:"var(--text)", outline:"none" }}/>
          <button onClick={save} disabled={saving}
            style={{ padding:"5px 12px", borderRadius:7, fontSize:12, fontWeight:700,
              background:"#3b82f6", color:"white", border:"none", cursor:"pointer" }}>
            {saving ? "…" : "OK"}
          </button>
          <button onClick={() => setEditing(false)}
            style={{ padding:"5px 10px", borderRadius:7, fontSize:12,
              background:"var(--surface)", border:"1px solid var(--border)",
              color:"var(--muted)", cursor:"pointer" }}>✕</button>
        </div>
      )}
    </div>
  );
}

function PrintCard({ p, onClick, onDelete, selectMode, selected, onToggleSelect, onLongPress }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const statusCfg = STATUS_CFG[p.status] || { bg:"rgba(0,0,0,0.5)", color:"white", label: p.status || "?" };
  const pressTimer = useRef(null);
  const longPressed = useRef(false);

  const startPress = () => {
    if (selectMode) return;
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      if (navigator.vibrate) navigator.vibrate(15);
      onLongPress?.(p.id);
    }, 480);
  };
  const cancelPress = () => { if (pressTimer.current) clearTimeout(pressTimer.current); };
  const handleClick = () => {
    if (longPressed.current) { longPressed.current = false; return; } // évite d'ouvrir la fiche juste après le long-press
    if (selectMode) onToggleSelect(p.id); else onClick();
  };

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
    <div className="card" onClick={handleClick}
      onTouchStart={startPress} onTouchEnd={cancelPress} onTouchMove={cancelPress}
      onMouseDown={startPress} onMouseUp={cancelPress} onMouseLeave={cancelPress}
      onContextMenu={e => e.preventDefault()}
      style={{ overflow:"hidden", display:"flex",
      flexDirection:"column", position:"relative", padding:0, cursor:"pointer",
      outline: selected ? "2px solid #3b82f6" : "none",
      userSelect:"none", WebkitUserSelect:"none", WebkitTouchCallout:"none", touchAction:"manipulation" }}>

      {/* Vignette pleine largeur ratio 4/3 */}
      <div style={{ position:"relative", paddingTop:"75%",
        background:"var(--surface2)", overflow:"hidden" }}>
        <img src={"/api/v1/prints/" + p.id + "/image"} alt="" draggable={false}
          style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover",
            WebkitTouchCallout:"none", WebkitUserDrag:"none" }}
          onError={e => { e.currentTarget.style.display="none"; }}/>
        {selectMode && (
          <div style={{ position:"absolute", top:6, left:6, width:20, height:20, borderRadius:6,
            border: selected ? "none" : "1.5px solid rgba(255,255,255,0.8)",
            background: selected ? "#3b82f6" : "rgba(0,0,0,0.4)",
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            {selected && <Check size={13} color="white" strokeWidth={3}/>}
          </div>
        )}
        {/* Badge quantité */}
        {p.number_of_items > 1 && (
          <span style={{ position:"absolute", top:6, right:6,
            background:"rgba(59,130,246,0.85)", color:"white",
            fontSize:9, fontWeight:800, padding:"2px 7px", borderRadius:20,
            boxShadow:"0 1px 4px rgba(0,0,0,0.4)" }}>
            ×{p.number_of_items}
          </span>
        )}
        {/* Badge statut */}
        {p.status !== "SUCCESS" && (
          <span style={{ position:"absolute", top:6, left:6,
            background: statusCfg.bg, color:"white",
            fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20,
            boxShadow:"0 1px 4px rgba(0,0,0,0.4)", letterSpacing:"0.03em",
            visibility: selectMode ? "hidden" : "visible" }}>
            {statusCfg.label}
          </span>
        )}
        {/* Pastilles filament */}
        {p.filament_usage?.length > 0 && (
          <div style={{ position:"absolute", bottom:6, left:6, display:"flex", gap:3 }}>
            {p.filament_usage.map((f,i) => (
              <div key={i} style={{ width:12, height:12, borderRadius:"50%",
                backgroundColor: hexCss(f.color_hex),
                border:"1.5px solid rgba(255,255,255,0.8)", flexShrink:0,
                boxShadow:"0 1px 3px rgba(0,0,0,0.3)" }}/>
            ))}
          </div>
        )}
      </div>

      {/* Infos minimales */}
      <div style={{ padding:"8px 10px" }}>
        <p style={{ fontWeight:700, fontSize:12, color:"var(--text)", margin:"0 0 2px",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {p.file_name || "Sans nom"}
        </p>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:10, color:"var(--muted)" }}>{fmtDate(p.print_date)}</span>
          {p.duration_seconds > 0 && <span style={{ fontSize:10, color:"var(--muted)" }}>{fmtDur(p.duration_seconds)}</span>}
          {p.total_cost > 0 && (
            <span style={{ fontSize:10, fontWeight:700, color:"var(--text)", fontFamily:"monospace" }}>
              {p.total_cost.toFixed(2)}€{p.number_of_items > 1 ? ` (${(p.total_cost/p.number_of_items).toFixed(2)}€/u)` : ""}
            </span>
          )}
        </div>
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

  const LABELS = { layer1:"Fin couche 1", layer2:"Fin couche 2", pct50:"50%", pct99:"99%", pct100:"100%", manual:"Manuel" };

  const handleDelete = async (e, s) => {
    e.stopPropagation();
    try {
      await client.delete("/prints/" + printId + "/snapshots/" + s.id);
      onDelete(s.id);
      if (lightbox && lightbox.snap && lightbox.snap.id === s.id) setLightbox(null);
    } catch(err) { alert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };

  const snapByName = {};
  (snaps||[]).forEach(s => {
    const base = s.file_path ? s.file_path.split("/").pop() : ("snapshot-" + s.trigger + ".jpg");
    snapByName[base] = s;
  });

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

  // Photos = fichiers manuels (pas un snapshot milestone connu) ; Milestones = snapshots auto pct/layer
  const photoItems     = allItems.filter(i => !i.snap);
  const milestoneItems = allItems.filter(i => i.snap);

  const Row = ({ title, items, startIdx = 0 }) => {
    const scrollRef = React.useRef(null);
    if (!items.length) return null;
    const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 120, behavior: "smooth" });
    return (
      <div style={{ marginBottom:12 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <p style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.05em", margin:0 }}>
            {title} ({items.length})
          </p>
          {items.length > 2 && (
            <div style={{ display:"flex", gap:4 }}>
              <button onClick={()=>scroll(-1)} style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"50%", width:22, height:22, cursor:"pointer", fontSize:14, color:"var(--text)", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
              <button onClick={()=>scroll(1)}  style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"50%", width:22, height:22, cursor:"pointer", fontSize:14, color:"var(--text)", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
            </div>
          )}
        </div>
        <div ref={scrollRef} style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:6, scrollbarWidth:"none" }}>
          {items.map((item, i) => (
            <div key={i} onClick={() => setLightbox(flatItems[startIdx + i])}
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
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const flatItems = [...photoItems, ...milestoneItems];
  const lbIdx = lightbox ? flatItems.findIndex(i => i.url === lightbox.url) : -1;
  const moveLb = (dir) => {
    const ni = (lbIdx + dir + flatItems.length) % flatItems.length;
    setLightbox(flatItems[ni]);
  };

  return (
    <>
      <Row title="Photos"     items={photoItems} startIdx={0}/>
      <Row title="Milestones" items={milestoneItems} startIdx={photoItems.length}/>
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:2000,
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
          {/* Titre */}
          <p style={{ color:"rgba(255,255,255,0.7)", fontSize:12, margin:"0 0 10px",
            fontWeight:600 }}>{lightbox.label}</p>
          {/* Image + flèches */}
          <div style={{ position:"relative", display:"flex", alignItems:"center", gap:12 }}
            onClick={e => e.stopPropagation()}>
            {flatItems.length > 1 && (
              <button onClick={()=>moveLb(-1)}
                style={{ background:"rgba(255,255,255,0.12)", border:"none", borderRadius:"50%",
                  width:36, height:36, cursor:"pointer", color:"white", fontSize:20,
                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                ‹
              </button>
            )}
            <img src={lightbox.url} alt={lightbox.label}
              style={{ maxWidth:"80vw", maxHeight:"80vh", borderRadius:12, objectFit:"contain" }}/>
            {flatItems.length > 1 && (
              <button onClick={()=>moveLb(1)}
                style={{ background:"rgba(255,255,255,0.12)", border:"none", borderRadius:"50%",
                  width:36, height:36, cursor:"pointer", color:"white", fontSize:20,
                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                ›
              </button>
            )}
          </div>
          {/* Indicateur */}
          {flatItems.length > 1 && (
            <p style={{ color:"rgba(255,255,255,0.4)", fontSize:11, margin:"10px 0 0" }}>
              {lbIdx + 1} / {flatItems.length}
            </p>
          )}
        </div>
      )}
    </>
  );
}


function PrintDetail({ p: pProp, onClose, onDelete, onChanged }) {
  const [snaps, setSnaps] = useState([]);
  const [ungrouped, setUngrouped] = useState(false);
  const [p, setP] = useState(pProp);

  // Refetcher le print complet (avec tous les champs coût) si nécessaire
  useEffect(() => {
    if (pProp.total_cost_filament == null) {
      client.get("/prints/" + pProp.id)
        .then(r => setP(r.data))
        .catch(() => setP(pProp));
    } else {
      setP(pProp);
    }
  }, [pProp.id]);

  const groupe = ungrouped ? null : p.group_name;

  const handleUngroup = async () => {
    if (!confirm("Retirer ce print de son groupe ?")) return;
    try {
      await client.post("/prints/" + p.id + "/group", {});
      setUngrouped(true);
      onChanged?.();
    } catch(err) { alert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000,
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}
        className="sheet-inner" className="sheet-inner" style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", width:"100%",
          maxWidth:640, maxHeight:"92dvh", overflowY:"auto",
          paddingBottom:"env(safe-area-inset-bottom,16px)" }}>

        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>

        {/* Vignette pleine largeur — contain pour voir tout sans rogner */}
        <div style={{ width:"100%", background:"var(--surface2)", position:"relative",
          minHeight:180, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <img src={"/api/v1/prints/" + p.id + "/image"} alt=""
            style={{ width:"100%", maxHeight:320, objectFit:"contain",
              imageRendering:"auto" }}
            onError={e => { e.currentTarget.parentElement.style.display="none"; }}/>
          <button onClick={onClose}
            style={{ position:"absolute", top:8, right:8, background:"rgba(0,0,0,0.5)",
              border:"none", borderRadius:"50%", width:28, height:28, cursor:"pointer",
              color:"white", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>
            ✕
          </button>
        </div>

        <div style={{ padding:"0 20px 12px" }}>
          <SnapshotGallery snaps={snaps} printId={p.id}
            onDelete={sid => setSnaps(ss => ss.filter(s => s.id !== sid))}/>
        </div>

        <div style={{ padding:"16px 20px 8px" }}>
          {/* Titre + groupe */}
          <h2 style={{ fontSize:16, fontWeight:800, color:"var(--text)", margin:"0 0 4px",
            letterSpacing:"-0.01em" }}>
            {p.file_name || "Sans nom"}
          </h2>
          {p.original_name && p.original_name !== p.file_name && (
            <p style={{ fontSize:11, color:"var(--muted)", margin:"0 0 4px" }}>{p.original_name}</p>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
            <StatusBadge status={p.status}/>
            {groupe && (
              <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:10,
                background:"rgba(167,139,250,0.15)",
                color:"#a78bfa", padding:"2px 6px 2px 8px", borderRadius:20, fontWeight:700 }}>
                📁 {groupe}
                <button onClick={handleUngroup} title="Retirer du groupe"
                  style={{ background:"none", border:"none", color:"#a78bfa", cursor:"pointer",
                    padding:0, display:"flex", alignItems:"center", opacity:0.8 }}>
                  <X size={11}/>
                </button>
              </span>
            )}
          </div>

          {/* Infos principales */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:14 }}>
            {[
              ["Date",         fmtDate(p.print_date)],
              ["Durée",        fmtDur(p.duration_seconds || p.estimated_seconds)],
              ["Poids filament", p.total_weight_g ? p.total_weight_g.toFixed(1)+"g" : null],
              ["Coût fil. (bobine)", p.total_cost_filament ? p.total_cost_filament.toFixed(2)+"€" : null],
              ["Coût fil. normal",  p.total_cost_filament_normal ? p.total_cost_filament_normal.toFixed(2)+"€" : null],
              ["Coût électricité",  p.electric_cost ? p.electric_cost.toFixed(2)+"€" : null],
              ["Coût total",   p.total_cost ? p.total_cost.toFixed(2)+"€" : null],
              ["Éléments",     p.number_of_items > 1 ? `× ${p.number_of_items}` : null],
              ["Coût/élément", p.number_of_items > 1 && p.total_cost ? (p.total_cost/p.number_of_items).toFixed(2)+"€" : null],
              ["Type",         p.print_type || null],
              ["Plateau",      p.plate_id || "1"],
            ].filter(([,v]) => v).map(([label, value]) => (
              <div key={label} style={{ background:"var(--surface2)",
                border:"1px solid var(--border)", borderRadius:8, padding:"6px 10px",
                ...(label==="Coût total" ? { gridColumn:"1/-1", background:"rgba(59,130,246,0.06)", borderColor:"rgba(59,130,246,0.2)" } : {}),
                ...(label==="Coût/élément" ? { gridColumn:"1/-1", background:"rgba(34,197,94,0.06)", borderColor:"rgba(34,197,94,0.2)" } : {}),
              }}>
                <p style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase",
                  letterSpacing:"0.06em", margin:"0 0 2px" }}>{label}</p>
                <p style={{ fontSize:label==="Coût total"||label==="Coût/élément" ? 15 : 12,
                  fontWeight:700, color:"var(--text)", margin:0, fontFamily:"monospace" }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Éditeur quantité */}
          <QuantityEditor id={p.id} type="print" value={p.number_of_items||1}
            onChange={nb => onUpdated?.({...p, number_of_items:nb})}/>

          {/* Filaments */}
          {p.filament_usage?.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
                letterSpacing:"0.06em", marginBottom:6 }}>Filaments utilisés</p>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {p.filament_usage.map((f,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8,
                    background:"var(--surface2)",
                    border:"1px solid " + (f.spool_id ? "rgba(34,197,94,0.3)" : "var(--border)"),
                    borderRadius:8, padding:"6px 10px" }}>
                    <div style={{ width:20, height:20, borderRadius:"50%", flexShrink:0,
                      backgroundColor:hexCss(f.color_hex),
                      border: f.spool_id ? "2px solid #22c55e" : "1px solid rgba(255,255,255,0.2)" }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:12, fontWeight:600, color:"var(--text)", margin:0 }}>
                        {f.filament_name || f.filament_type || "Inconnu"}
                        {f.spool_id && <span style={{ fontSize:9, color:"#22c55e", marginLeft:6 }}>✓ #{f.spool_id}</span>}
                      </p>
                      <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>
                        {[f.filament_brand, f.filament_type, f.color_hex, f.grams_used?.toFixed(1)+"g"].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Identifiants — utiles pour recherche / debug */}
          <details style={{ marginBottom:12 }}>
            <summary style={{ fontSize:10, color:"var(--muted)", cursor:"pointer",
              textTransform:"uppercase", letterSpacing:"0.06em", userSelect:"none" }}>
              Identifiants
            </summary>
            <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:3 }}>
              {[
                ["ID BambuNymous", p.id],
                ["Job ID",         p.job_id],
                ["External ref",   p.external_ref],
                ["Design ID",      p.design_id],
                ["Modèle printer", p.printer_model],
                ["Groupe",         p.group_id ? `#${p.group_id} — ${p.group_name || ""}` : null],
              ].filter(([,v]) => v).map(([label, value]) => (
                <div key={label} style={{ display:"flex", gap:8, alignItems:"baseline" }}>
                  <span style={{ fontSize:10, color:"var(--muted)", flexShrink:0, minWidth:100 }}>{label}</span>
                  <span style={{ fontSize:11, fontFamily:"monospace", color:"var(--text)",
                    wordBreak:"break-all" }}>{value}</span>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* Actions */}
        <div style={{ padding:"0 20px 20px", display:"flex", gap:8 }}>
          <button onClick={async () => {
            if (!window.confirm("Supprimer ce print ?")) return;
            try {
              await client.delete("/prints/" + p.id);
              onDelete(p.id);
              onClose();
            } catch(e) { alert("Erreur: " + (e.response?.data?.detail || e.message)); }
          }} style={{ flex:1, padding:"10px", background:"rgba(239,68,68,0.1)",
            border:"1px solid rgba(239,68,68,0.3)", borderRadius:10,
            color:"#ef4444", fontSize:13, fontWeight:600, cursor:"pointer" }}>
            🗑 Supprimer
          </button>
          <button onClick={onClose}
            style={{ flex:2, padding:"10px", background:"#3b82f6",
              border:"none", borderRadius:10, color:"white",
              fontSize:13, fontWeight:600, cursor:"pointer" }}>✕</button>
        </div>
      </div>
    </div>
  );
}

// ── Galerie — indépendante de la pagination, parcourt tout l'historique ────
function PrintsGalleryView({ search, sortF = "recent" }) {
  const [data, setData] = useState(null); // { prints:[], groups:[] }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.get("/prints/gallery")
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setData({ prints:[], groups:[] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p style={{ textAlign:"center", color:"var(--muted)", padding:"48px 0" }}>Chargement…</p>;

  let items = [
    ...(data?.prints || []).map(p => ({ ...p, kind:"print" })),
    ...(data?.groups || []).map(g => ({ ...g, kind:"group", title: g.name, count: g.prints })),
  ];
  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    items = items.filter(it => (it.title || "").toLowerCase().includes(q));
  }
  items.sort((a,b) => {
    if (sortF === "oldest")   return (a.print_date||a.latest_date||"").localeCompare(b.print_date||b.latest_date||"");
    if (sortF === "cost")     return (b.total_cost||0)-(a.total_cost||0);
    if (sortF === "weight")   return (b.total_weight_g||0)-(a.total_weight_g||0);
    if (sortF === "duration") return (b.duration_seconds||0)-(a.duration_seconds||0);
    return (b.print_date||b.latest_date||"").localeCompare(a.print_date||a.latest_date||""); // recent
  });

  return (
    <GalleryCompare
      items={items}
      getId={it => it.kind + it.id}
      getCoverImage={it => it.photos?.[0]?.url}
      getPhotos={it => it.photos}
      getTitle={it => it.title}
      getSubtitle={it => it.kind==="group" ? `📁 ${it.count} print${it.count>1?"s":""}` : fmtDate(it.print_date)}
      emptyLabel={search?.trim() ? `Aucun résultat pour « ${search.trim()} »` : "Aucune photo manuelle uploadée sur tes prints (hors milestones auto)"}
      enableCompare={false}
    />
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortF, setSortF]     = useState("recent");
  const [viewMode, setViewMode] = useState("list"); // "list" | "gallery"
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const LIMIT = 40;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOffset(0);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: 0 });
      if (search)  params.set("search", search);
      if (statusF) params.set("status", statusF);
      if (groupF)  params.set("group_id", groupF);
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
      if (groupF)  params.set("group_id", groupF);
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

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Historique</h1>
        <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>{total} impressions</span>
        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
          {/* Switch Liste / Galerie */}
          <div style={{ display:"flex", gap:2, background:"var(--surface2)", borderRadius:10, padding:3, border:"1px solid var(--border)" }}>
            {[["list",<List size={13}/>,"Liste"],["gallery",<ImageIcon size={13}/>,"Galerie"]].map(([id,icon,label])=>(
              <button key={id} onClick={()=>setViewMode(id)}
                style={{ padding:"4px 10px", borderRadius:8, fontSize:11, fontWeight:600, cursor:"pointer", border:"none",
                  background:viewMode===id?"var(--text)":"transparent", color:viewMode===id?"var(--bg)":"var(--muted)",
                  display:"flex", alignItems:"center", gap:4 }}>
                {icon}{label}
              </button>
            ))}
          </div>
          {/* Sélectionner */}
          {viewMode==="list" && (
            <button onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:"none",
                background: selectMode?"#3b82f6":"var(--surface2)", color:selectMode?"white":"var(--muted)" }}>
              {selectMode ? "Annuler" : "Sélectionner"}
            </button>
          )}
          {/* Importer */}
          <label style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer",
            background:"var(--surface2)", color:"var(--muted)", display:"flex", alignItems:"center", gap:5 }}>
            <Upload size={12}/>{importing ? "…" : ".3mf"}
            <input type="file" accept=".3mf" onChange={handleImport} style={{ display:"none" }}/>
          </label>
        </div>
      </div>

      <div style={{ display:"flex", gap:8 }}>
        <div style={{ position:"relative", flex:1 }}>
          <Search size={14} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un print…"
            style={{ width:"100%", paddingLeft:36, padding:"8px 10px 8px 36px", boxSizing:"border-box",
              background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10,
              fontSize:12, color:"var(--text)", outline:"none" }}/>
        </div>
        <button onClick={()=>setFilterOpen(true)}
          style={{ display:"flex", alignItems:"center", gap:5, padding:"8px 14px",
            background: (statusF||sortF!=="recent") ? "#3b82f6" : "var(--surface2)",
            color: (statusF||sortF!=="recent") ? "white" : "var(--text)",
            border:"1px solid var(--border)", borderRadius:10, fontSize:12, cursor:"pointer", flexShrink:0 }}>
          <SlidersHorizontal size={14}/>
          {(statusF||sortF!=="recent") ? `Filtres (actifs)` : "Filtres"}
        </button>
      </div>

      {filterOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:200, display:"flex", alignItems:"flex-end" }}
          onClick={()=>setFilterOpen(false)}>
          <div onClick={e=>e.stopPropagation()} className="sheet-inner"
            style={{ width:"100%", background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
              padding:"0 16px 32px", overflowY:"auto", maxHeight:"75dvh", position:"relative" }}>
            <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)", margin:"12px auto 8px" }}/>
            <button onClick={()=>setFilterOpen(false)} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <p style={{ fontWeight:700, fontSize:15, color:"var(--text)", margin:0 }}>Filtres & tri</p>
              {(statusF||sortF!=="recent") && (
                <button onClick={()=>{ setStatusF(""); setSortF("recent"); }}
                  style={{ fontSize:11, color:"#60a5fa", background:"none", border:"none", cursor:"pointer" }}>
                  Effacer filtres
                </button>
              )}
            </div>
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 8px" }}>Statut</p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
              {STATUSES.map(s => (
                <button key={s} onClick={()=>setStatusF(s)}
                  style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600,
                    cursor:"pointer", border:"none",
                    background: statusF===s ? "#3b82f6" : "var(--surface2)",
                    color: statusF===s ? "white" : "var(--muted)" }}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 8px" }}>Trier par</p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:24 }}>
              {[["recent","Plus récent"],["oldest","Plus ancien"],["cost","Coût ↓"],["weight","Poids ↓"],["duration","Durée ↓"]].map(([id,label]) => (
                <button key={id} onClick={()=>setSortF(id)}
                  style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600,
                    cursor:"pointer", border:"none",
                    background: sortF===id ? "#3b82f6" : "var(--surface2)",
                    color: sortF===id ? "white" : "var(--muted)" }}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={()=>setFilterOpen(false)}
              style={{ width:"100%", padding:"12px", borderRadius:10, border:"none",
                background:"#3b82f6", color:"white", fontSize:14, fontWeight:700, cursor:"pointer" }}>
              Appliquer
            </button>
          </div>
        </div>
      )}


      {loading && <p style={{ textAlign:"center", color:"var(--muted)", padding:"48px 0" }}>Chargement…</p>}

      {!loading && error && (
        <div style={{ margin:8, padding:"12px 16px", background:"rgba(239,68,68,0.1)",
          border:"1px solid rgba(239,68,68,0.3)", borderRadius:8, color:"#ef4444", fontSize:13 }}>
          ⚠ {error}
        </div>
      )}

      {viewMode==="list" && !loading && !error && prints.length === 0 && (
        <p style={{ textAlign:"center", color:"var(--muted)", padding:"48px 0" }}>
          Aucune impression — les prochains prints apparaîtront automatiquement.
        </p>
      )}

      {viewMode==="gallery" && <PrintsGalleryView search={search} sortF={sortF}/>}

      {!loading && !error && prints.length > 0 && viewMode==="list" && (() => {
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

        // Agréger les groupes par id (et non par nom — deux groupes distincts peuvent
        // porter le même nom, ex. import Spoolnymous à des dates différentes)
        const groupMap = {};   // group_id → { name, prints[], latestDate }
        prints.forEach(p => {
          if (!p.group_id) return;
          if (!groupMap[p.group_id]) groupMap[p.group_id] = { name: p.group_name, prints:[], latestDate:"" };
          groupMap[p.group_id].prints.push(p);
          if (!groupMap[p.group_id].latestDate || p.print_date > groupMap[p.group_id].latestDate)
            groupMap[p.group_id].latestDate = p.print_date;
        });

        // Construire la liste d'items : soit un print solo, soit un groupe entier
        const items = [];
        const addedGroups = new Set();
        prints.forEach(p => {
          if (!p.group_id) {
            // Print solo → item individuel
            items.push({ type:"print", p, date: p.print_date });
          } else if (!addedGroups.has(p.group_id)) {
            // Print de groupe → ajouter le groupe une seule fois à sa date max
            addedGroups.add(p.group_id);
            items.push({ type:"group", groupId:p.group_id, ...groupMap[p.group_id] });
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
                onDelete={onDelete}
                selectMode={selectMode}
                selected={selectedIds.has(item.p.id)}
                onToggleSelect={toggleSelect}
                onLongPress={id => { setSelectMode(true); setSelectedIds(new Set([id])); }}/>
            ) : (
              <GroupTile key={item.groupId} groupId={item.groupId} name={item.name}
                prints={item.prints} latestDate={item.latestDate}
                number_of_items={item.number_of_items}
                onSelectPrint={setSelected}
                onUngroup={() => load()}
                onDelete={id=>{setPrints(ps=>ps.filter(p=>p.id!==id));setTotal(t=>t-1);}}/>
            ))}
          </div>
        );
      })()}

      {viewMode==="list" && hasMore && !loading && (
        <button onClick={loadMore} disabled={loadingMore}
          style={{ width:"100%", padding:"12px", marginTop:8,
            background:"var(--surface2)", border:"1px solid var(--border)",
            borderRadius:10, cursor:loadingMore?"not-allowed":"pointer",
            color:"var(--muted)", fontSize:13, fontWeight:600 }}>
          {loadingMore ? "Chargement…" : "Charger plus (" + (total - prints.length) + " restants)"}
        </button>
      )}

      {selected && <PrintDetail p={selected} onClose={()=>setSelected(null)}
        onDelete={id=>{setPrints(ps=>ps.filter(p=>p.id!==id));setTotal(t=>t-1);}}
        onChanged={() => { load(); loadGroups(); }}/>}

      {/* Barre flottante de sélection multiple */}
      {selectMode && selectedIds.size > 0 && (
        <div style={{ position:"fixed", bottom:76, left:12, right:12, zIndex:500,
          background:"var(--sheet-bg)", border:"1px solid var(--border)", borderRadius:14,
          padding:10, display:"flex", alignItems:"center", gap:10, boxShadow:"0 4px 24px rgba(0,0,0,0.35)" }}>
          <span style={{ fontSize:12, color:"var(--text)", fontWeight:700, flexShrink:0 }}>
            {selectedIds.size} sélectionné{selectedIds.size>1?"s":""}
          </span>
          <div style={{ flex:1 }}/>
          <button onClick={() => setGroupPickerOpen(true)}
            style={{ display:"flex", alignItems:"center", gap:5, padding:"7px 12px", borderRadius:8,
              fontSize:12, fontWeight:700, background:"#3b82f6", color:"white", border:"none", cursor:"pointer" }}>
            <FolderPlus size={14}/> Grouper
          </button>
          <button onClick={exitSelectMode}
            style={{ padding:"7px 10px", borderRadius:8, fontSize:12, background:"none",
              border:"1px solid var(--border)", color:"var(--muted)", cursor:"pointer" }}>
            Annuler
          </button>
        </div>
      )}

      {/* Sélecteur de groupe — créer ou choisir un groupe existant (recherche substring) */}
      {groupPickerOpen && (
        <GroupPickerSheet
          groups={groups}
          onClose={() => setGroupPickerOpen(false)}
          onPick={async (payload) => {
            try {
              await client.post("/prints/group/bulk", { print_ids: Array.from(selectedIds), ...payload });
              setGroupPickerOpen(false);
              exitSelectMode();
              await Promise.all([load(), loadGroups()]);
            } catch(err) { alert("Erreur: " + (err.response?.data?.detail || err.message)); }
          }}
        />
      )}
    </div>
  );
}

// ── Sélecteur de groupe — recherche substring + création ───────────────────
function GroupPickerSheet({ groups, onClose, onPick }) {
  const [q, setQ] = useState("");
  const [vh, setVh] = useState(typeof window !== "undefined" ? window.innerHeight : 800);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setVh(vv.height);
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  const filtered = q.trim()
    ? groups.filter(g => g.name.toLowerCase().includes(q.trim().toLowerCase()))
    : groups;
  const exactNameExists = groups.some(g => g.name.toLowerCase() === q.trim().toLowerCase());

  return (
    <div onClick={onClose} style={{ position:"fixed", left:0, right:0, top:0, height: vh + "px", zIndex:1400,
      background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)",
        borderRadius:"20px 20px 0 0", width:"100%", maxWidth:480,
        maxHeight: Math.round(vh * 0.9) + "px",
        display:"flex", flexDirection:"column",
        paddingBottom:"env(safe-area-inset-bottom,16px)" }}>

        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>

        <div style={{ padding:"14px 18px 10px" }}>
          <h3 style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:"0 0 10px" }}>
            Ajouter à un groupe
          </h3>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher ou créer un groupe…"
            autoFocus
            style={{ width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
              borderRadius:8, padding:"9px 12px", fontSize:13, color:"var(--text)", outline:"none" }}/>
        </div>

        <div style={{ overflowY:"auto", padding:"0 18px 16px", flex:1 }}>
          {q.trim() && !exactNameExists && (
            <button onClick={() => onPick({ group_name: q.trim() })}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
                marginBottom:8, borderRadius:10, background:"rgba(59,130,246,0.12)",
                border:"1px solid rgba(59,130,246,0.35)", color:"#3b82f6", fontSize:13, fontWeight:700,
                cursor:"pointer", textAlign:"left" }}>
              <FolderPlus size={15}/> Créer le groupe « {q.trim()} »
            </button>
          )}

          {filtered.length === 0 && !q.trim() && (
            <p style={{ textAlign:"center", color:"var(--muted)", fontSize:12, padding:"20px 0" }}>
              Aucun groupe pour l'instant — tape un nom pour en créer un.
            </p>
          )}

          {filtered.map(g => (
            <button key={g.id} onClick={() => onPick({ group_id: g.id })}
              style={{ width:"100%", padding:"12px 14px", textAlign:"left", background:"var(--surface2)",
                border:"1px solid var(--border)", borderRadius:8, cursor:"pointer",
                color:"var(--text)", fontSize:13 }}>
              📁 {g.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
