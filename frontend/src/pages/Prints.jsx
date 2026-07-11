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
  const [confirmSpool, setConfirmSpool] = useState(null);

  useEffect(() => {
    client.get("/filaments/spools", { params:{ limit:500 } })
      .then(r => setSpools(r.data || []))
      .catch(() => {});
  }, []);

  const filtered = spools.filter(s => {
    if (s.archived) return false;
    if (!search.trim()) return true;
    const words = search.trim().toLowerCase().split(/\s+/);
    const hay = [s.filament_name, s.filament_translated_name, s.filament_manufacturer,
      s.color_hex, s.filament_material, s.filament_fila_type, "#"+(s.id||"")
    ].filter(Boolean).join(" ").toLowerCase();
    return words.every(w => hay.includes(w));
  });

  const selectSpool = async (spool) => {
    try {
      await client.patch(`/prints/${printId}/filament-usage/${usageId}`, { spool_id: spool.id });
      const resp = await client.get(`/prints/${printId}`).catch(()=>({data:{}}));
      const fu = (resp.data?.filament_usage||[]).find(f=>f.id===usageId);
      if (fu?.grams_used > 0) {
        setConfirmSpool({ spool, grams_used: fu.grams_used });
      } else {
        onMapped?.();
      }
    } catch(e) { alert("Erreur: " + e.message); }
  };

  return (
    <>
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:3000,
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sheet-bg)",
        borderRadius:"20px 20px 0 0", width:"100%", maxWidth:640,
        display:"flex", flexDirection:"column", maxHeight:"80dvh" }}>
        {/* Handle + titre */}
        <div style={{ padding:"12px 16px 8px", flexShrink:0 }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)", margin:"0 auto 10px" }}/>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ width:18, height:18, borderRadius:"50%", flexShrink:0,
              backgroundColor:hexCss(colorHex), border:"1px solid rgba(255,255,255,0.2)" }}/>
            <h3 style={{ fontSize:14, fontWeight:800, color:"var(--text)", margin:0, flex:1 }}>Associer une bobine</h3>
            <button onClick={onClose} style={{ width:26, height:26, borderRadius:"50%",
              background:"var(--surface2)", border:"none", cursor:"pointer",
              color:"var(--muted)", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
        </div>
        {/* Liste scrollable */}
        <div style={{ flex:1, overflowY:"auto", padding:"0 16px" }}>
          {filtered.map(s => (
            <button key={s.id} onClick={()=>selectSpool(s)}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", width:"100%",
                background:"var(--surface2)", border:"1px solid var(--border)",
                borderRadius:8, cursor:"pointer", textAlign:"left", marginBottom:6 }}>
              <div style={{ width:16, height:16, borderRadius:"50%", flexShrink:0,
                backgroundColor:hexCss(s.color_hex||s.filament_color), border:"1px solid rgba(255,255,255,0.15)" }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:12, fontWeight:600, color:"var(--text)", margin:0,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {s.filament_translated_name||s.filament_name||"Bobine #"+s.id}
                </p>
                <p style={{ fontSize:10, color:"var(--muted)", margin:"1px 0 0" }}>
                  {[s.filament_manufacturer, s.filament_fila_type||s.filament_material,
                    s.remaining_weight_g?.toFixed(0)+"g"].filter(Boolean).join(" · ")}
                </p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p style={{ color:"var(--muted)", fontSize:12, textAlign:"center", padding:"20px 0" }}>Aucune bobine trouvée</p>}
        </div>
        {/* Search sticky en bas au dessus du clavier */}
        <div style={{ padding:"10px 16px", borderTop:"1px solid var(--border)", flexShrink:0,
          background:"var(--sheet-bg)", paddingBottom:"env(safe-area-inset-bottom,10px)" }}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Rechercher (PLA matte bambu…)"
            autoComplete="off"
            style={{ width:"100%", boxSizing:"border-box", padding:"10px 14px", borderRadius:10,
              border:"1px solid var(--border)", background:"var(--surface2)",
              color:"var(--text)", fontSize:13, outline:"none" }}/>
        </div>
      </div>
    </div>
    {confirmSpool && (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:4000,
        display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
        <div style={{ background:"var(--sheet-bg)", borderRadius:16, width:"100%",
          maxWidth:360, padding:20, border:"1px solid var(--border)" }}>
          <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>Décompter les grammes ?</p>
          <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 16px" }}>
            Déduire <b style={{color:"var(--text)"}}>{confirmSpool.grams_used?.toFixed(1)}g</b> de <b style={{color:"var(--text)"}}>{confirmSpool.spool?.filament_translated_name||confirmSpool.spool?.filament_name}</b> ?
          </p>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>{ setConfirmSpool(null); onMapped?.(); }}
              style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid var(--border)",
                background:"var(--surface2)", color:"var(--muted)", fontSize:13, cursor:"pointer" }}>Non</button>
            <button onClick={async()=>{
              // Déduire les grammes (mode sub) + recalculer les coûts du print
              await client.post(`/filaments/spools/${confirmSpool.spool.id}/weight`,
                { mode: "sub", value: confirmSpool.grams_used }).catch(e=>console.error("weight err:", e));
              // Recalculer les coûts du print
              await client.post(`/prints/${printId}/recalc-costs`).catch(()=>{});
              setConfirmSpool(null); onMapped?.();
            }} style={{ flex:2, padding:"10px", borderRadius:10, border:"none",
              background:"#22c55e", color:"white", fontSize:13, fontWeight:700, cursor:"pointer" }}>Oui, déduire</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function DeletePrintConfirm({ p, onCancel, onConfirm, restoreOnly = false }) {
  const mapped = (p.filament_usage || []).filter(f => f.spool_id && f.grams_used > 0);
  const [fracs, setFracs] = useState(() => Object.fromEntries(mapped.map(f=>[f.id, 1.0])));
  const OPTS = [0, 0.25, 0.5, 0.75, 1.0];
  const setAll = (v) => setFracs(Object.fromEntries(mapped.map(f=>[f.id,v])));
  const setOne = (id, v) => setFracs(prev=>({...prev,[id]:v}));
  const allSame = OPTS.find(o => mapped.every(f=>(fracs[f.id]??0)===o));
  const totalAdded = mapped.reduce((s,f)=>s+(f.grams_used||0)*(fracs[f.id]??0),0);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:3000,
      display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={onCancel}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", width:"100%",
          maxWidth:640, maxHeight:"85dvh", overflowY:"auto", padding:"0 16px 24px",
          paddingBottom:"env(safe-area-inset-bottom,24px)" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 8px" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
        </div>
        <h3 style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:"0 0 4px" }}>
          {restoreOnly ? "⚖ Restituer les grammes" : "🗑 Supprimer ce print ?"}
        </h3>
        <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 14px" }}>{p.file_name || "Sans nom"}</p>
        {mapped.length > 0 && (<>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
            <span style={{ fontSize:11, color:"var(--muted)", flex:1 }}>Tous :</span>
            {OPTS.map(o=>(
              <button key={o} onClick={()=>setAll(o)} style={{ padding:"4px 10px", borderRadius:20,
                border:"none", cursor:"pointer", fontWeight:600, fontSize:11,
                background:allSame===o?"#22c55e":"var(--surface2)",
                color:allSame===o?"white":"var(--muted)" }}>
                {o===0?"Non":o===1?"100%":`${o*100}%`}
              </button>
            ))}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
            {mapped.map(f=>(
              <div key={f.id} style={{ background:"var(--surface2)", borderRadius:10,
                padding:"10px 12px", border:"1px solid var(--border)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                  <div style={{ width:16, height:16, borderRadius:"50%", flexShrink:0,
                    backgroundColor:hexCss(f.color_hex), border:"1px solid rgba(255,255,255,0.15)" }}/>
                  <span style={{ fontSize:12, fontWeight:600, color:"var(--text)", flex:1 }}>
                    {f.filament_translated_name||f.filament_fila_type||f.filament_type||"Filament"}
                  </span>
                  <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>{f.grams_used?.toFixed(1)}g</span>
                </div>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap", alignItems:"center" }}>
                  {OPTS.map(o=>(
                    <button key={o} onClick={()=>setOne(f.id,o)} style={{ padding:"4px 9px",
                      borderRadius:20, border:"none", cursor:"pointer", fontWeight:600, fontSize:11,
                      background:(fracs[f.id]??0)===o?"#22c55e":"var(--bg)",
                      color:(fracs[f.id]??0)===o?"white":"var(--muted)" }}>
                      {o===0?"Non":o===1?"100%":`${o*100}%`}
                    </button>
                  ))}
                  {(fracs[f.id]??0)>0 && (
                    <span style={{ fontSize:10, color:"#22c55e", marginLeft:4 }}>+{(f.grams_used*(fracs[f.id]??0)).toFixed(1)}g</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {totalAdded>0 && <p style={{ fontSize:12, color:"#22c55e", fontWeight:700, textAlign:"center", margin:"0 0 14px" }}>Total : +{totalAdded.toFixed(1)}g restitués</p>}
        </>)}
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onCancel} style={{ flex:1, padding:"11px", borderRadius:12,
            border:"1px solid var(--border)", background:"var(--surface2)",
            color:"var(--muted)", fontSize:13, cursor:"pointer" }}>Annuler</button>
          <button onClick={()=>onConfirm(fracs)} style={{ flex:2, padding:"11px", borderRadius:12,
            border:"none", background:restoreOnly?"#22c55e":"#ef4444", color:"white",
            fontSize:13, fontWeight:700, cursor:"pointer" }}>
            {restoreOnly?"✓ Restituer":"Supprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DissociateDialog({ usage, printId, onClose, onDone }) {
  const [restore, setRestore] = useState(true);
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    try {
      if (restore && usage.grams_used > 0 && usage.spool_id) {
        await client.post(`/filaments/spools/${usage.spool_id}/weight`,
          { mode: "add", value: usage.grams_used }).catch(()=>{});
      }
      await client.patch(`/prints/${printId}/filament-usage/${usage.id}`, { spool_id: null });
      await client.post(`/prints/${printId}/recalc-costs`).catch(()=>{});
      onDone?.();
    } catch(e) { alert("Erreur: " + e.message); }
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:4000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:16,
        width:"100%", maxWidth:360, padding:20, border:"1px solid var(--border)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <div style={{ width:18, height:18, borderRadius:"50%", flexShrink:0,
            backgroundColor:hexCss(usage.color_hex), border:"1px solid rgba(255,255,255,0.15)" }}/>
          <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:0 }}>Dissocier la bobine</p>
        </div>
        <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 14px" }}>
          {usage.filament_translated_name||usage.filament_fila_type||usage.filament_type} · {usage.grams_used?.toFixed(1)}g · bobine #{usage.spool_id}
        </p>
        {usage.grams_used > 0 && (
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16,
            padding:"10px 12px", borderRadius:10,
            background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.2)", cursor:"pointer" }}
            onClick={()=>setRestore(r=>!r)}>
            <div style={{ width:20, height:20, borderRadius:4, border:"2px solid #22c55e",
              background:restore?"#22c55e":"transparent", flexShrink:0,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              {restore && <span style={{ color:"white", fontSize:13 }}>✓</span>}
            </div>
            <span style={{ fontSize:12, color:"var(--text)" }}>
              Remettre <b>{usage.grams_used?.toFixed(1)}g</b> dans la bobine
            </span>
          </div>
        )}
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:"10px", borderRadius:10,
            border:"1px solid var(--border)", background:"var(--surface2)",
            color:"var(--muted)", fontSize:13, cursor:"pointer" }}>Annuler</button>
          <button onClick={confirm} disabled={loading} style={{ flex:2, padding:"10px",
            borderRadius:10, border:"none", background:"#ef4444", color:"white",
            fontSize:13, fontWeight:700, cursor:"pointer", opacity:loading?0.7:1 }}>
            {loading?"…":"Dissocier"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UnmapFilamentConfirm({ f, printId, onClose, onDone }) {
  const [fraction, setFraction] = useState(1.0);
  const OPTS = [0, 0.25, 0.5, 0.75, 1.0];

  const confirm = async () => {
    // 1. Restituer les grammes à la bobine si demandé et si non archivée
    if (fraction > 0 && f.spool_id) {
      await client.post(`/filaments/spools/${f.spool_id}/weight`,
        { mode:"add", value: (f.grams_used||0)*fraction }).catch(()=>{});
    }
    // 2. Démapper le filament
    await client.patch(`/prints/${printId}/filament-usage/${f.id}`, { spool_id: null }).catch(()=>{});
    // 3. Recalculer les coûts
    await client.post(`/prints/${printId}/recalc-costs`).catch(()=>{});
    onDone?.();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:4000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:16,
        width:"100%", maxWidth:380, padding:20, border:"1px solid var(--border)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <div style={{ width:20, height:20, borderRadius:"50%", flexShrink:0,
            backgroundColor:hexCss(f.color_hex), border:"1px solid rgba(255,255,255,0.15)" }}/>
          <p style={{ fontSize:14, fontWeight:800, color:"var(--text)", margin:0 }}>
            {f.filament_translated_name||f.filament_fila_type||"Filament"}
          </p>
        </div>
        <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 14px" }}>
          Démapper ce filament de la bobine #{f.spool_id}. Restituer les grammes ?
        </p>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:14 }}>
          <span style={{ fontSize:11, color:"var(--muted)", flex:1 }}>Restituer {f.grams_used?.toFixed(1)}g :</span>
          {OPTS.map(o=>(
            <button key={o} onClick={()=>setFraction(o)}
              style={{ padding:"4px 9px", borderRadius:20, border:"none", cursor:"pointer",
                fontWeight:600, fontSize:11,
                background:fraction===o?"#22c55e":"var(--surface2)",
                color:fraction===o?"white":"var(--muted)" }}>
              {o===0?"Non":o===1?"100%":`${o*100}%`}
            </button>
          ))}
        </div>
        {fraction>0 && <p style={{ fontSize:11, color:"#22c55e", margin:"0 0 14px" }}>
          +{((f.grams_used||0)*fraction).toFixed(1)}g restitués à la bobine
        </p>}
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:"10px", borderRadius:10,
            border:"1px solid var(--border)", background:"var(--surface2)",
            color:"var(--muted)", fontSize:13, cursor:"pointer" }}>Annuler</button>
          <button onClick={confirm} style={{ flex:2, padding:"10px", borderRadius:10,
            border:"none", background:"#ef4444", color:"white",
            fontSize:13, fontWeight:700, cursor:"pointer" }}>Démapper</button>
        </div>
      </div>
    </div>
  );
}

function FilamentAccordion({ filaments, onSpoolClick, onSpoolPick, printId, onRestore, onUnmapped }) {
  const [open, setOpen] = useState(false);
  const [unmapping, setUnmapping] = useState(null); // filament à démapper
  const [dissociate, setDissociate] = useState(null); // filament usage à dissocier
  return (
    <>
    <div style={{ marginBottom:14, border:"1px solid var(--border)", borderRadius:10 }}>
      {/* Header cliquable */}
      <button onClick={()=>setOpen(o=>!o)}
        style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
          background:"var(--surface2)", border:"none", cursor:"pointer", textAlign:"left" }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
          <span style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:"0.06em", whiteSpace:"nowrap" }}>Filaments ({filaments.length})</span>
          {onRestore && filaments.some(f=>f.spool_id) && (
            <span onClick={e=>{e.stopPropagation();onRestore();}}
              style={{ fontSize:10, fontWeight:700, cursor:"pointer",
                padding:"2px 8px", borderRadius:20, whiteSpace:"nowrap",
                background:"rgba(34,197,94,0.15)", color:"#22c55e",
                border:"1px solid rgba(34,197,94,0.3)" }}>⚖ Restituer</span>
          )}
        </div>
        {/* Pastilles de couleur */}
        <div style={{ display:"flex", gap:4, flexWrap:"wrap", justifyContent:"flex-end" }}>
          {filaments.map((f,i) => (
            <div key={i} style={{ position:"relative", flexShrink:0 }}>
              <div style={{ width:16, height:16, borderRadius:"50%",
                backgroundColor:hexCss(f.color_hex),
                border:"1px solid rgba(255,255,255,0.2)" }}/>
              {!f.spool_id && <span style={{ position:"absolute", top:-3, right:-3,
                width:8, height:8, borderRadius:"50%", background:"#f59e0b",
                border:"1px solid var(--bg)" }}/>}
            </div>
          ))}
        </div>
        <span style={{ color:"var(--muted)", fontSize:12 }}>{open?"▲":"▼"}</span>
      </button>
      {/* Détail déplié */}
      {open && (
        <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
          {filaments.map((f,i) => (
            <div key={i}
              onClick={e=>{e.stopPropagation(); if(f.spool_id){onSpoolClick&&onSpoolClick({filId:f.bam_filament_id||null,spoolId:f.spool_id,hex:f.color_hex||null});}else{onSpoolPick&&onSpoolPick({usageId:f.id,colorHex:f.color_hex,filamentType:f.filament_fila_type||f.filament_type});}}}
              onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(f.spool_id)setUnmapping(f);}}
              onPointerDown={e=>{ if(!f.spool_id) return; const t=setTimeout(()=>{setUnmapping(f); navigator.vibrate&&navigator.vibrate(20);},600); e.currentTarget._lpt=t; }}
              onPointerUp={e=>clearTimeout(e.currentTarget._lpt)}
              onPointerLeave={e=>clearTimeout(e.currentTarget._lpt)}
              onPointerCancel={e=>clearTimeout(e.currentTarget._lpt)}
              style={{ display:"flex", alignItems:"center", gap:10,
              padding:"8px 12px", background:"var(--bg)",
              borderTop:"1px solid var(--border)", cursor:"pointer",
              opacity: f.spool_id ? 1 : 0.85 }}>
              <div style={{ width:20, height:20, borderRadius:"50%", flexShrink:0,
                backgroundColor:hexCss(f.color_hex),
                border:f.spool_id?"2px solid #22c55e":"1px solid rgba(255,255,255,0.15)" }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:12, fontWeight:600, color:"var(--text)", margin:0,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {f.filament_translated_name || f.filament_fila_type || f.filament_name || "Inconnu"}
                  {f.spool_id && <span style={{ fontSize:9, color:"#22c55e", marginLeft:5 }}>✓#{f.spool_id}</span>}
                  {!f.spool_id && <span style={{ fontSize:9, color:"#f59e0b", marginLeft:5,
                    background:"rgba(245,158,11,0.12)", padding:"1px 5px", borderRadius:6 }}>▸ Mapper</span>}
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
    {unmapping && <UnmapFilamentConfirm f={unmapping} printId={printId} onClose={()=>setUnmapping(null)} onDone={()=>{ setUnmapping(null); onUnmapped?.(); }}/>}
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [photoCount, setPhotoCount] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selSpool, setSelSpool] = useState(null);
  const [localNb, setLocalNb] = useState(pProp.number_of_items || 1);
  const [nbVal, setNbVal]     = useState(String(pProp.number_of_items || 1));
  useEffect(() => { setLocalNb(p.number_of_items || 1); setNbVal(String(p.number_of_items || 1)); }, [p.number_of_items]);

  const saveNb = async () => {
    const n = parseInt(nbVal);
    if (!isNaN(n) && n >= 1) {
      try {
        await client.patch(`/prints/${p.id}`, { number_of_items: n });
        setLocalNb(n); onChanged?.({...p, number_of_items: n});
      } catch {}
    }
    setEditNb(false);
  };

  const SNAP_LABELS = {
    "snapshot-layer1":"Couche 1","snapshot-layer2":"Couche 2",
    "pct50":"50%","snapshot-pct50":"50%","pct99":"99%","snapshot-pct99":"99%",
    "pct100":"100%","snapshot-pct100":"100%","fail":"Échec","manual":"Manuel",
  };

  const handleUngroup = async () => {
    if (!confirm("Retirer ce print de son groupe ?")) return;
    try { await client.post("/prints/" + p.id + "/group", {}); setUngrouped(true); onChanged?.(); }
    catch(err) { alert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };

  // Prix à afficher — si pas de prix bobine, fallback sur normal
  const costBobine  = p.total_cost_filament || 0;
  const costNormal  = p.total_cost_filament_normal || 0;
  const costElec    = p.electric_cost || 0;
  const costFil     = costBobine > 0 ? costBobine : costNormal; // si pas de prix bobine, prendre normal
  const totalBobine = costFil + costElec;
  const totalNormal = costNormal + costElec;
  const nb          = p.number_of_items || 1;

  return (
    <>
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000,
      display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", width:"100%",
          maxWidth:640, maxHeight:"92dvh", overflowY:"auto",
          paddingBottom:"env(safe-area-inset-bottom,16px)" }}>

        {/* Handle + ✕ — sticky pour rester au-dessus du visuel */}
        <div style={{ position:"sticky", top:0, zIndex:10, background:"var(--sheet-bg)",
          display:"flex", justifyContent:"center", padding:"12px 0 8px" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:10, right:12, width:28, height:28,
            borderRadius:"50%", background:"var(--surface2)", border:"1px solid var(--border)",
            cursor:"pointer", color:"var(--muted)", fontSize:15,
            display:"flex", alignItems:"center", justifyContent:"center", zIndex:11 }}>✕</button>
        </div>

        {/* Image vignette */}
        <div style={{ width:"100%", background:"var(--surface2)", position:"relative",
          minHeight:160, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <img src={"/api/v1/prints/" + p.id + "/image"} alt=""
            style={{ width:"100%", maxHeight:280, objectFit:"contain" }}
            onError={e => { e.currentTarget.parentElement.style.minHeight=0; e.currentTarget.style.display="none"; }}/>
        </div>




        <div style={{ padding:"0 16px 16px" }}>
          {/* Titre */}
          <h2 style={{ fontSize:17, fontWeight:800, color:"var(--text)", margin:"0 0 4px", letterSpacing:"-0.01em" }}>
            {p.file_name || "Sans nom"}
          </h2>
          {p.original_name && p.original_name !== p.file_name && (
            <p style={{ fontSize:11, color:"var(--muted)", margin:"0 0 6px" }}>{p.original_name}</p>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            <StatusBadge status={p.status}/>
            {groupe && (
              <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:10,
                background:"rgba(167,139,250,0.15)", color:"#a78bfa",
                padding:"2px 6px 2px 8px", borderRadius:20, fontWeight:700 }}>
                📁 {groupe}
                <button onClick={handleUngroup} style={{ background:"none", border:"none",
                  color:"#a78bfa", cursor:"pointer", padding:0, display:"flex" }}>
                  <X size={11}/>
                </button>
              </span>
            )}
          </div>

          {/* Date + Durée + Poids — badges colorés */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
            {[
              fmtDate(p.print_date) && ["📅", fmtDate(p.print_date), "#3b82f6"],
              (p.duration_seconds||p.estimated_seconds)>0 && ["⏱", fmtDur(p.duration_seconds||p.estimated_seconds), "#8b5cf6"],
              p.total_weight_g>0 && ["⚖", p.total_weight_g.toFixed(1)+"g", "#f59e0b"],
            ].filter(Boolean).map(([ic,val,color])=>(
              <div key={ic} style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 10px",
                borderRadius:20, background:`${color}18`, border:`1px solid ${color}30` }}>
                <span style={{ fontSize:11 }}>{ic}</span>
                <span style={{ fontSize:11, fontWeight:700, color, fontFamily:"monospace" }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Coûts — bloc principal */}
          <div style={{ background:"linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06))",
            border:"1px solid rgba(59,130,246,0.15)", borderRadius:14, padding:"14px 16px", marginBottom:12 }}>
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
              letterSpacing:"0.06em", margin:"0 0 10px" }}>Coûts</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {/* Filament */}
              <div style={{ background:"var(--surface2)", borderRadius:10, padding:"8px 10px" }}>
                <p style={{ fontSize:9, color:"var(--muted)", margin:"0 0 3px" }}>Filament</p>
                <p style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:0, fontFamily:"monospace" }}>
                  {costFil.toFixed(2)}€
                </p>
                {costBobine > 0 && costNormal > 0 && costBobine !== costNormal && (
                  <p style={{ fontSize:10, color:"var(--muted)", margin:"2px 0 0" }}>
                    ({costNormal.toFixed(2)}€ sans bobine)
                  </p>
                )}
              </div>
              {/* Électricité */}
              <div style={{ background:"var(--surface2)", borderRadius:10, padding:"8px 10px" }}>
                <p style={{ fontSize:9, color:"var(--muted)", margin:"0 0 3px" }}>Électricité</p>
                <p style={{ fontSize:15, fontWeight:800, color:"#f59e0b", margin:0, fontFamily:"monospace" }}>
                  {costElec.toFixed(2)}€
                </p>
              </div>
            </div>
            {/* Total + éléments intégrés */}
            <div style={{ marginTop:8, padding:"10px 12px", borderRadius:10,
              background:"rgba(59,130,246,0.1)", border:"1px solid rgba(59,130,246,0.2)" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <p style={{ fontSize:10, color:"#60a5fa", fontWeight:700,
                  textTransform:"uppercase", letterSpacing:"0.06em", margin:0 }}>Total</p>
                <div style={{ textAlign:"right" }}>
                  <span style={{ fontSize:20, fontWeight:900, color:"var(--text)", fontFamily:"monospace" }}>
                    {totalBobine.toFixed(2)}€
                  </span>
                  {totalNormal !== totalBobine && totalNormal > 0 && (
                    <span style={{ fontSize:11, color:"var(--muted)", marginLeft:8 }}>
                      ({totalNormal.toFixed(2)}€)
                    </span>
                  )}
                </div>
              </div>
              {/* Éléments — intégré dans le bloc total */}
              <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid rgba(59,130,246,0.15)",
                display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:12, fontWeight:700, color:"#22c55e" }}>
                    {localNb} élément{localNb>1?"s":""}
                  </span>
                  {localNb > 1 && (
                    <span style={{ fontSize:12, color:"#22c55e", fontFamily:"monospace", fontWeight:700 }}>
                      · {(totalBobine/localNb).toFixed(2)}€/u
                    </span>
                  )}
                </div>
                {!editNb ? (
                  <button onClick={()=>{setNbVal(String(localNb));setEditNb(true);}}
                    style={{ fontSize:10, padding:"2px 8px", borderRadius:6,
                      border:"1px solid rgba(34,197,94,0.3)", background:"none",
                      color:"#22c55e", cursor:"pointer" }}>Modifier</button>
                ) : (
                  <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                    <input type="number" min="1" value={nbVal} onChange={e=>setNbVal(e.target.value)}
                      style={{ width:55, padding:"3px 6px", borderRadius:6,
                        border:"1px solid var(--border)", background:"var(--surface2)",
                        color:"var(--text)", fontSize:12, fontFamily:"monospace" }} autoFocus/>
                    <button onClick={saveNb}
                      style={{ padding:"3px 10px", borderRadius:6, border:"none",
                        background:"#22c55e", color:"white", fontSize:11, cursor:"pointer" }}>✓</button>
                    <button onClick={()=>setEditNb(false)}
                      style={{ padding:"3px 8px", borderRadius:6, border:"none",
                        background:"var(--surface2)", color:"var(--muted)", fontSize:11, cursor:"pointer" }}>✕</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section Photos */}
          <SnapshotGallery snaps={snaps.map(s=>({...s,
            label: SNAP_LABELS[s.trigger] || SNAP_LABELS[s.filename?.replace(/\.(jpg|png|webp)$/,"")] || s.trigger || s.filename
          }))} printId={p.id} userPhotos={userPhotos}
            onDelete={sid => setSnaps(ss=>ss.filter(s=>s.id!==sid))}
            onUpload={async(f)=>{ await uploadPhoto(f); }}
            onDeleteUpload={async(filename)=>{ await client.delete(`/prints/${p.id}/upload/${filename}`); loadUserPhotos(); }}
            onCountChange={setPhotoCount}/>

          {/* Bouton MakerWorld si design_id disponible */}
          {p.design_id && (
            <a href={`https://makerworld.com/en/models/${p.design_id}`} target="_blank" rel="noopener noreferrer"
              style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                width:"100%", padding:"8px", borderRadius:10, marginBottom:14,
                border:"1px solid rgba(59,130,246,0.3)", background:"rgba(59,130,246,0.06)",
                color:"#3b82f6", fontSize:12, fontWeight:700, textDecoration:"none" }}>
              🌐 Voir sur MakerWorld
            </a>
          )}

          {/* Créer objet depuis ce print */}
          <button onClick={async () => {
            const n = parseInt(prompt(`Créer combien d'objets depuis ce print ?
(Max restant calculé automatiquement)`, "1"));
            if (!n || isNaN(n)) return;
            try {
              const r = await client.post("/objects/objects", {
                parent_type: "print", parent_id: p.id,
                name: p.file_name || "Sans nom", qty: n,
                cost_fabrication: totalBobine,
              });
              alert(`✅ ${r.data.created} objet(s) créé(s)`);
            } catch(e) { alert("Erreur: " + (e.response?.data?.detail || e.message)); }
          }} style={{ width:"100%", padding:"10px", borderRadius:10, marginBottom:14,
            border:"1px solid rgba(34,197,94,0.3)", background:"rgba(34,197,94,0.06)",
            color:"#22c55e", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            📦 Créer un objet depuis ce print
          </button>

          {/* Filaments — accordéon */}
          {p.filament_usage?.length > 0 && <FilamentAccordion filaments={p.filament_usage} onSpoolClick={setSelSpool} onSpoolPick={setSpoolPicker} printId={p.id} onRestore={()=>setShowDeleteConfirm('restore')} onUnmapped={()=>{ client.get('/prints/'+p.id).then(r=>{ setP(r.data); setRefreshKey(k=>k+1); }).catch(()=>{}); onChanged?.(); }}/>}

          {/* Commentaire */}
          {p.status_note && (
            <div style={{ marginBottom:14, padding:"10px 14px", borderRadius:10,
              background:"rgba(168,85,247,0.06)", border:"1px solid rgba(168,85,247,0.2)" }}>
              <p style={{ fontSize:9, color:"#a78bfa", textTransform:"uppercase",
                letterSpacing:"0.06em", margin:"0 0 6px", fontWeight:700 }}>💬 Commentaire</p>
              <p style={{ fontSize:13, color:"var(--text)", margin:0, lineHeight:1.5 }}>{p.status_note}</p>
            </div>
          )}

          {/* Identifiants (sans printer_model) */}
          {(p.job_id || p.design_id) && (
            <details style={{ marginBottom:12 }}>
              <summary style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
                letterSpacing:"0.06em", cursor:"pointer", userSelect:"none" }}>
                Identifiants
              </summary>
              <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:4 }}>
                {p.job_id && <p style={{ fontSize:10, fontFamily:"monospace", color:"var(--muted)", margin:0 }}>Job: {p.job_id}</p>}
                {p.design_id && <p style={{ fontSize:10, fontFamily:"monospace", color:"var(--muted)", margin:0 }}>Design: {p.design_id}</p>}
              </div>
            </details>
          )}

          {/* Actions */}
          <div style={{ display:"flex", gap:8, marginTop:8 }}>
            <button onClick={()=>setEditMode(true)}
              style={{ flex:1, padding:"11px", borderRadius:12, border:"1px solid var(--border)",
                background:"var(--surface2)", color:"var(--text)", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              ✏️ Éditer
            </button>


            <button onClick={() => {
              setShowDeleteConfirm(true);
            }} style={{ flex:1, padding:"11px", borderRadius:12, border:"1px solid rgba(239,68,68,0.3)",
              background:"rgba(239,68,68,0.06)", color:"#ef4444", fontSize:13, fontWeight:700,
              cursor:"pointer" }}>🗑 Supprimer</button>
            <button onClick={onClose}
              style={{ flex:2, padding:"11px", borderRadius:12, border:"none",
                background:"#3b82f6", color:"white", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
    {spoolPicker && <SpoolMapPicker usageId={spoolPicker.usageId} printId={p.id} colorHex={spoolPicker.colorHex} filamentType={spoolPicker.filamentType} onClose={()=>setSpoolPicker(null)} onMapped={()=>{ setSpoolPicker(null); window.location.reload(); }}/> }
    {selSpool && <FilamentSheetFromSpool filamentId={selSpool.filId} spoolId={selSpool.spoolId} filamentColorHex={selSpool.hex} onClose={()=>setSelSpool(null)} zIndex={2000}/>}
    {editMode && <PrintEditSheet p={p} onClose={()=>setEditMode(false)} onSaved={updated=>{ setP(prev=>({...prev,...updated})); setEditMode(false); onChanged?.(); }}/>}
    {showDeleteConfirm && <DeletePrintConfirm
      p={p}
      restoreOnly={showDeleteConfirm==="restore"}
      onCancel={()=>setShowDeleteConfirm(false)}
      onConfirm={async(fracs)=>{
        // fracs = {usageId: fraction, ...}
        const hasRestore = Object.values(fracs).some(v=>v>0);
        if (hasRestore) await client.post("/prints/"+p.id+"/restore-weights", {fracs}).catch(()=>{});
        if (showDeleteConfirm !== "restore") { client.delete("/prints/"+p.id).then(()=>{ onDelete?.(p.id); onClose(); }).catch(()=>alert("Erreur")); }
        else { setShowDeleteConfirm(false); client.get("/prints/"+p.id).then(r=>{ console.log('[RESTORE REFRESH] grams_used:', r.data?.filament_usage?.map(f=>({id:f.id, g:f.grams_used}))); setP(r.data); setRefreshKey(k=>k+1); }).catch(()=>{}); onChanged?.(); }
      }}/>}
  </>);
}


function GroupEditSheet({ groupId, name, onClose, onSaved }) {
  const [form, setForm] = useState({ name: name || "" });
  const [saving, setSaving] = useState(false);
  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"8px 12px", fontSize:13, color:"var(--text)", outline:"none", width:"100%", boxSizing:"border-box" };
  const lbl = { fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4, display:"block" };
  const save = async () => {
    setSaving(true);
    try { await client.patch(`/prints/groups/${groupId}`, form); onSaved(form.name); }
    catch(e) { alert("Erreur: " + (e.response?.data?.detail || e.message)); }
    setSaving(false);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:2000,
      display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", width:"100%",
          maxWidth:640, padding:"0 16px 24px", paddingBottom:"env(safe-area-inset-bottom,24px)" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 8px", position:"relative" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:10, right:0, width:28, height:28,
            borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer",
            color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>
        <h3 style={{ fontSize:15, fontWeight:800, margin:"0 0 16px", color:"var(--text)" }}>✏️ Éditer le groupe</h3>
        <div>
          <label style={lbl}>Nom du groupe</label>
          <input style={inp} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1, padding:"11px", borderRadius:12,
            border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--muted)", fontSize:13, cursor:"pointer" }}>
            Annuler
          </button>
          <button onClick={save} disabled={saving} style={{ flex:2, padding:"11px", borderRadius:12,
            border:"none", background:"#3b82f6", color:"white", fontSize:13, fontWeight:700, cursor:"pointer" }}>
            {saving ? "…" : "💾 Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GroupBottomSheet({ groupId, name, prints: printsProp, latestDate, number_of_items: nbItemsProp, cover_print_id: coverPrintIdProp, onClose, onSelectPrint, onDelete, onUngroup, onUpdated }) {
  const [localPrints, setLocalPrints] = useState([]);
  const [nbItems, setNbItems]         = useState(nbItemsProp || 1);
  const [editNb, setEditNb]           = useState(false);
  const [nbVal, setNbVal]             = useState(String(nbItemsProp || 1));
  const [selectedPrint, setSelectedPrint] = useState(null);
  const [selSpoolG, setSelSpoolG] = useState(null);
  const [coverPrintId, setCoverPrintId] = useState(coverPrintIdProp||null);
  const [groupPhotoToDelete, setGroupPhotoToDelete] = useState(null);
  const [editGroup, setEditGroup] = useState(false);
  const [groupPhotos, setGroupPhotos] = useState([]);

  const loadGroupPhotos = () => client.get(`/prints/groups/${groupId}/photos`).then(r=>setGroupPhotos(r.data?.files||[])).catch(()=>{});
  useEffect(() => { if(groupId) loadGroupPhotos(); }, [groupId]);
  const uploadGroupPhoto = async (file) => {
    const fd = new FormData(); fd.append('file', file);
    await client.post(`/prints/groups/${groupId}/photos/upload`, fd, {headers:{'Content-Type':'multipart/form-data'}});
    loadGroupPhotos();
  };

  useEffect(() => {
    if (!groupId) return;
    client.get("/prints", { params:{ group_id:groupId, limit:200 } })
      .then(r => {
        const d = r.data;
        const arr = Array.isArray(d) ? d : Array.isArray(d?.prints) ? d.prints : [];
        setLocalPrints(arr);
      }).catch(() => {});
  }, [groupId]);

  const totalDur  = localPrints.reduce((s,p) => s + (p.duration_seconds || p.estimated_seconds || 0), 0);
  const totalCost = localPrints.reduce((s,p) => s + (p.total_cost || 0), 0);
  const totalW    = localPrints.reduce((s,p) => s + (p.total_weight_g || 0), 0);

  // Agrégation filaments
  const filsMap = {};
  localPrints.forEach(p => {
    (p.filament_usage || []).forEach(f => {
      const key = f.spool_id || f.color_hex || f.filament_name || "?";
      if (!filsMap[key]) filsMap[key] = { ...f, grams_used:0, cost:0, normal_cost:0 };
      filsMap[key].grams_used  += f.grams_used || 0;
      filsMap[key].cost        += f.cost || 0;
      filsMap[key].normal_cost += f.normal_cost || 0;
    });
  });
  const filaments = Object.values(filsMap).sort((a,b) => (b.grams_used||0)-(a.grams_used||0));

  const saveNbItems = async () => {
    const n = parseInt(nbVal);
    if (!isNaN(n) && n >= 1) {
      try {
        await client.patch(`/prints/groups/${groupId}`, { number_of_items: n });
        setNbItems(n); onUpdated?.();
      } catch(e) {}
    }
    setEditNb(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Supprimer le groupe "${name}" et ses ${localPrints.length} prints ?`)) return;
    try {
      await Promise.all(localPrints.map(p => client.delete("/prints/" + p.id)));
      onDelete?.(); onClose();
    } catch(err) { alert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };

  const handleUngroup = async () => {
    if (!confirm(`Dégrouper "${name}" (les prints resteront) ?`)) return;
    try {
      await client.delete("/prints/groups/" + groupId);
      onUngroup?.(); onClose();
    } catch(err) { alert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };

  return (
    <>
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000,
      display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", width:"100%",
          maxWidth:640, maxHeight:"92dvh", overflowY:"auto",
          paddingBottom:"env(safe-area-inset-bottom,16px)" }}>

        {/* Handle + ✕ — sticky */}
        <div style={{ position:"sticky", top:0, zIndex:10, background:"var(--sheet-bg)",
          display:"flex", justifyContent:"center", padding:"12px 0 8px" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:10, right:12, width:28, height:28,
            borderRadius:"50%", background:"var(--surface2)", border:"1px solid var(--border)",
            cursor:"pointer", color:"var(--muted)", fontSize:15,
            display:"flex", alignItems:"center", justifyContent:"center", zIndex:11 }}>✕</button>
        </div>

        <div style={{ padding:"14px 16px 16px" }}>
          {/* Titre */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
            <span style={{ fontSize:22 }}>📁</span>
            <div>
              <h2 style={{ fontSize:17, fontWeight:800, color:"var(--text)", margin:"0 0 2px" }}>
                {name || "Groupe sans nom"}
              </h2>
              <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>
                {localPrints.length} print{localPrints.length>1?"s":""}
              </p>
            </div>
          </div>

          {/* KPIs — badges */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
            {[
              totalDur>0 && ["⏱", fmtDur(totalDur), "#8b5cf6"],
              totalW>0   && ["⚖", totalW.toFixed(0)+"g", "#f59e0b"],
              totalCost>0 && ["💰", totalCost.toFixed(2)+"€", "#22c55e"],
            ].filter(Boolean).map(([ic,val,color])=>(
              <div key={ic} style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 10px",
                borderRadius:20, background:`${color}18`, border:`1px solid ${color}30` }}>
                <span style={{ fontSize:11 }}>{ic}</span>
                <span style={{ fontSize:11, fontWeight:700, color, fontFamily:"monospace" }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Bloc coût + éléments */}
          {totalCost > 0 && (
            <div style={{ background:"linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06))",
              border:"1px solid rgba(59,130,246,0.15)", borderRadius:14, padding:"12px 14px", marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <p style={{ fontSize:10, color:"#60a5fa", fontWeight:700, textTransform:"uppercase",
                  letterSpacing:"0.06em", margin:0 }}>Coût total</p>
                <span style={{ fontSize:22, fontWeight:900, color:"var(--text)", fontFamily:"monospace" }}>
                  {totalCost.toFixed(2)}€
                </span>
              </div>
              {/* Éléments — même style que PrintDetail */}
              <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid rgba(59,130,246,0.15)",
                display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:12, fontWeight:700, color:"#22c55e" }}>
                    {nbItems} élément{nbItems>1?"s":""}
                  </span>
                  {nbItems > 1 && (
                    <span style={{ fontSize:12, color:"#22c55e", fontFamily:"monospace", fontWeight:700 }}>
                      · {(totalCost/nbItems).toFixed(2)}€/u
                    </span>
                  )}
                </div>
                {editNb ? (
                  <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                    <input type="number" min="1" value={nbVal} onChange={e=>setNbVal(e.target.value)}
                      style={{ width:55, padding:"3px 6px", borderRadius:6,
                        border:"1px solid var(--border)", background:"var(--surface2)",
                        color:"var(--text)", fontSize:12, fontFamily:"monospace" }} autoFocus/>
                    <button onClick={saveNbItems}
                      style={{ padding:"3px 10px", borderRadius:6, border:"none",
                        background:"#22c55e", color:"white", fontSize:11, cursor:"pointer" }}>✓</button>
                    <button onClick={()=>setEditNb(false)}
                      style={{ padding:"3px 8px", borderRadius:6, border:"none",
                        background:"var(--surface2)", color:"var(--muted)", fontSize:11, cursor:"pointer" }}>✕</button>
                  </div>
                ) : (
                  <button onClick={()=>{setNbVal(String(nbItems));setEditNb(true);}}
                    style={{ fontSize:10, padding:"2px 8px", borderRadius:6,
                      border:"1px solid rgba(34,197,94,0.3)", background:"none",
                      color:"#22c55e", cursor:"pointer" }}>Modifier</button>
                )}
              </div>
            </div>
          )}

          {/* Photos du groupe */}
          {(groupPhotos.length > 0 || true) && (
            <div style={{ marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:0 }}>
                  Photos ({groupPhotos.length})
                </p>
                <label style={{ width:20, height:20, borderRadius:"50%", background:"#3b82f6",
                  border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:14, color:"white", fontWeight:700 }}>
                  +<input type="file" accept="image/*" capture="environment" style={{ display:"none" }}
                    onChange={e=>e.target.files[0]&&uploadGroupPhoto(e.target.files[0])}/>
                </label>
              </div>
              {groupPhotos.length > 0 && (
                <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4 }}>
                  {groupPhotos.map((ph,i)=>(
                    <div key={i} style={{ position:"relative", flexShrink:0 }}>
                      <img src={ph.url} alt="" style={{ height:80, width:80, objectFit:"cover", borderRadius:8 }}/>
                      <button onClick={async()=>{ if(window._confirmedDeletePhoto){
                        await client.delete(`/prints/groups/${groupId}/photo/${ph.name}`);
                        loadGroupPhotos();
                      }}} style={{ position:"absolute", top:2, right:2, width:18, height:18,
                        borderRadius:"50%", background:"rgba(0,0,0,0.6)", border:"none",
                        cursor:"pointer", color:"white", fontSize:12,
                        display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Filaments agrégés — accordéon */}
          {filaments.length > 0 && <FilamentAccordion filaments={filaments} onSpoolClick={setSelSpoolG}/>}

          {/* Prints en tuiles */}
          {/* Créer objet depuis ce groupe */}
          <button onClick={async () => {
            const n = parseInt(prompt(`Créer combien d'objets depuis ce groupe ?
(Max restant calculé automatiquement)`, "1"));
            if (!n || isNaN(n)) return;
            try {
              const r = await client.post("/objects/objects", {
                parent_type: "group", parent_id: groupId,
                name: name, qty: n,
                cost_fabrication: totalCost / nbItems,
              });
              alert(`✅ ${r.data.created} objet(s) créé(s)`);
            } catch(e) { alert("Erreur: " + (e.response?.data?.detail || e.message)); }
          }} style={{ width:"100%", padding:"10px", borderRadius:10, marginBottom:14,
            border:"1px solid rgba(34,197,94,0.3)", background:"rgba(34,197,94,0.06)",
            color:"#22c55e", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            📦 Créer un objet depuis ce groupe
          </button>

          <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:"0.06em", margin:"0 0 8px" }}>
            Prints ({localPrints.length})
          </p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:8, marginBottom:16 }}>
            {localPrints.map(p => (
              <div key={p.id} style={{
                borderRadius:10, overflow:"hidden", position:"relative",
                background:"var(--surface2)", border:"1px solid var(--border)" }}>
                {/* Bouton retirer du groupe */}
                <button onClick={async e=>{ e.stopPropagation();
                  if(!confirm(`Retirer "${p.file_name||"ce print"}" du groupe ?`)) return;
                  try { await client.post("/prints/"+p.id+"/group", {}); setLocalPrints(ps=>ps.filter(x=>x.id!==p.id)); } catch{}
                }} style={{ position:"absolute", top:4, right:4, zIndex:2, width:20, height:20,
                  borderRadius:"50%", background:"rgba(0,0,0,0.55)", border:"none",
                  cursor:"pointer", color:"white", fontSize:11,
                  display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                {/* Bouton étoile = définir comme référence visuelle */}
                <button onClick={async e=>{ e.stopPropagation();
                  try {
                    await client.patch("/prints/groups/"+groupId, { cover_print_id: p.id });
                    setCoverPrintId(p.id);
                    onUpdated?.();
                  } catch{}
                }} title="Définir comme référence visuelle"
                  style={{ position:"absolute", top:4, left:4, zIndex:2, width:20, height:20,
                  borderRadius:"50%", background: coverPrintId===p.id ? "#f59e0b" : "rgba(0,0,0,0.5)",
                  border:"none", cursor:"pointer", color:"white", fontSize:11,
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
                  ★
                </button>
                <div onClick={()=>setSelectedPrint(p)} style={{ cursor:"pointer" }}>
                <div style={{ position:"relative", paddingTop:"75%", background:"var(--surface2)" }}>
                  <img src={"/api/v1/prints/"+p.id+"/image"} alt="" style={{
                    position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}
                    onError={e=>{e.currentTarget.style.display="none"}}/>
                  <StatusBadge status={p.status} style={{ position:"absolute", bottom:4, right:4 }}/>
                </div>
                <div style={{ padding:"6px 8px" }}>
                  <p style={{ fontSize:10, fontWeight:600, color:"var(--text)", margin:0,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {p.file_name || "Sans nom"}
                  </p>
                  <p style={{ fontSize:9, color:"var(--muted)", margin:"1px 0 0" }}>
                    {fmtDate(p.print_date)}
                  </p>
                </div>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>setEditGroup(true)}
              style={{ flex:1, padding:"10px", borderRadius:12, border:"1px solid var(--border)",
                background:"var(--surface2)", color:"var(--text)", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              ✏️ Éditer
            </button>
            <button onClick={handleDelete}
              style={{ flex:1, padding:"10px", borderRadius:12,
                border:"1px solid rgba(239,68,68,0.3)", background:"rgba(239,68,68,0.06)",
                color:"#ef4444", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              🗑 Supprimer
            </button>
            <button onClick={handleUngroup}
              style={{ flex:1, padding:"10px", borderRadius:12,
                border:"1px solid rgba(167,139,250,0.3)", background:"rgba(167,139,250,0.06)",
                color:"#a78bfa", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              📤 Dégrouper
            </button>
            <button onClick={onClose}
              style={{ flex:2, padding:"10px", borderRadius:12, border:"none",
                background:"#3b82f6", color:"white", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
    {groupPhotoToDelete && <PhotoDeleteConfirm label={groupPhotoToDelete.name} onCancel={()=>setGroupPhotoToDelete(null)} onConfirm={async()=>{ await client.delete(`/prints/groups/${groupId}/photo/${groupPhotoToDelete.name}`); setGroupPhotoToDelete(null); loadGroupPhotos(); }}/>}
    {editGroup && <GroupEditSheet groupId={groupId} name={name} onClose={()=>setEditGroup(false)} onSaved={()=>{ setEditGroup(false); onUpdated?.(); }}/>}
    {selSpoolG && <FilamentSheetFromSpool filamentId={selSpoolG.filId} spoolId={selSpoolG.spoolId} filamentColorHex={selSpoolG.hex} onClose={()=>setSelSpoolG(null)} zIndex={2000}/>}
    {selectedPrint && (
      <PrintDetail p={selectedPrint} onClose={()=>setSelectedPrint(null)}
        onDelete={()=>{ setSelectedPrint(null); setLocalPrints(ps=>ps.filter(p=>p.id!==selectedPrint.id)); }}
        onChanged={()=>{}}/>
    )}
    </>
  );
}

function GroupTile({ groupId, name, prints, latestDate, number_of_items, duration_seconds, cover_print_id, onSelectPrint, onDelete, onUngroup }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const coverImgId = cover_print_id || (prints[0]?.id ?? null);

  return (
    <>
      <div className="card" onClick={() => setSheetOpen(true)}
        style={{ overflow:"hidden", display:"flex", flexDirection:"column",
          position:"relative", padding:0, cursor:"pointer" }}>
        <div style={{ position:"relative", paddingTop:"75%",
          background:"var(--surface2)", overflow:"hidden" }}>
          {coverImgId && (
            <img src={"/api/v1/prints/" + coverImgId + "/image"} alt=""
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
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:10, color:"var(--muted)" }}>{fmtDate(latestDate)}</span>
            {duration_seconds > 0 && <span style={{ fontSize:10, color:"var(--muted)" }}>{fmtDur(duration_seconds)}</span>}
          </div>
        </div>
      </div>

      {sheetOpen && (
        <GroupBottomSheet
          groupId={groupId} name={name} prints={prints} latestDate={latestDate}
          number_of_items={number_of_items}
          cover_print_id={cover_print_id}
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
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:10, color:"var(--muted)" }}>{fmtDate(p.print_date)}</span>
          {p.duration_seconds > 0 && <span style={{ fontSize:10, color:"var(--muted)" }}>{fmtDur(p.duration_seconds)}</span>}
        </div>
      </div>
    </div>
  );
}


function PhotoDeleteConfirm({ label, onCancel, onConfirm }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:4000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:16,
        width:"100%", maxWidth:340, padding:20, border:"1px solid var(--border)" }}>
        <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>Supprimer la photo ?</p>
        <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 18px" }}>{label}</p>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onCancel} style={{ flex:1, padding:"10px", borderRadius:10,
            border:"1px solid var(--border)", background:"var(--surface2)",
            color:"var(--muted)", fontSize:13, cursor:"pointer" }}>Annuler</button>
          <button onClick={onConfirm} style={{ flex:2, padding:"10px", borderRadius:10,
            border:"none", background:"#ef4444", color:"white", fontSize:13,
            fontWeight:700, cursor:"pointer" }}>Supprimer</button>
        </div>
      </div>
    </div>
  );
}

function SnapshotGallery({ snaps, printId, onDelete, onUpload, userPhotos = [], onDeleteUpload, onCountChange }) {
  const [lightbox, setLightbox] = useState(null);
  const [diskFiles, setDiskFiles] = useState([]);
  const [photoToDelete, setPhotoToDelete] = useState(null);
  const [deletedNames, setDeletedNames] = useState(new Set());

  const reloadDiskFiles = () => client.get("/prints/" + printId + "/snapshots")
      .then(r => setDiskFiles(r.data.files || []))
      .catch(() => {});

  useEffect(() => { reloadDiskFiles(); }, [printId]);

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
  (snaps||[]).forEach(s => {
    const base = s.file_path ? s.file_path.split("/").pop() : ("snapshot-" + s.trigger + ".jpg");
    snapByName[base] = s;
  });

  // Fusionner photos disk + photos uploadées manuellement
  // userPhotos ignorés : déjà couverts par diskFiles via PrintSnapshot(trigger=manual)
  const extraPhotos = [];
  const baseItems = diskFiles.length > 0
    ? diskFiles.map(f => {
        const s = snapByName[f.name] || null;
        const FNAME_LABELS = {
          "snapshot-layer1":"Couche 1","snapshot-layer2":"Couche 2",
          "snapshot-pct50":"50%","snapshot-pct99":"99%","snapshot-pct100":"100%"
        };
        const fname = f.name?.replace(/\.[^.]+$/, "") || "";
        return { url: f.url, name: f.name, snap: s,
          label: s ? (LABELS[s.trigger] || FNAME_LABELS[s.trigger] || s.trigger)
                   : (FNAME_LABELS[fname] || fname) };
      })
    : (snaps||[]).map(s => ({
        url: "/api/v1/prints/" + printId + "/snapshot/" + s.trigger,
        name: "snapshot-" + s.trigger + ".jpg", snap: s,
        label: LABELS[s.trigger] || s.trigger,
      }));

  const allItems = [...baseItems, ...extraPhotos].filter(i => !deletedNames.has(i.name));
  useEffect(()=>{ onCountChange?.(allItems.length); }, [allItems.length]);

  // Photos = fichiers manuels (pas un snapshot milestone connu) ; Milestones = snapshots auto pct/layer
  // Photos = non-snap + manual snaps (uploaded)
  const photoItems     = allItems.filter(i => !i.snap || i.snap?.trigger === "manual");
  // Milestones triés: 100% → 99% → 50% → Couche2 → Couche1
  const MILE_ORDER = { "pct100":1, "pct99":2, "pct50":3, "layer2":4, "layer1":5 };
  const milestoneItems = allItems.filter(i => i.snap && i.snap?.trigger !== "manual").sort((a,b)=>{
    const oa = MILE_ORDER[a.snap?.trigger] ?? 9;
    const ob = MILE_ORDER[b.snap?.trigger] ?? 9;
    return oa - ob;
  });

  const Row = ({ title, items, startIdx = 0, onAdd, onDeleteItem }) => {
    const scrollRef = React.useRef(null);
    if (!items.length) return null;
    const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 120, behavior: "smooth" });
    return (
      <div style={{ marginBottom:12 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <p style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.05em", margin:0 }}>
              {title} ({items.length})
            </p>
            {onAdd && (
              <label style={{ width:20, height:20, borderRadius:"50%", background:"#3b82f6",
                border:"none", cursor:"pointer", display:"flex",
                alignItems:"center", justifyContent:"center", fontSize:14, color:"white", fontWeight:700 }}>
                +
                <input type="file" accept="image/*" capture="environment" style={{ display:"none" }}
                  onChange={e=>e.target.files[0]&&onAdd(e.target.files[0])}/>
              </label>
            )}
          </div>
          {items.length > 2 && (
            <div style={{ display:"flex", gap:4 }}>
              <button onClick={()=>scroll(-1)} style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"50%", width:22, height:22, cursor:"pointer", fontSize:14, color:"var(--text)", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
              <button onClick={()=>scroll(1)}  style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"50%", width:22, height:22, cursor:"pointer", fontSize:14, color:"var(--text)", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
            </div>
          )}
        </div>
        <div ref={scrollRef} style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:6, scrollbarWidth:"none" }}>
          {items.map((item, i) => (
            <div key={i} style={{ position:"relative", flexShrink:0 }}>
              {onDeleteItem && item.name && (
                <button onClick={e=>{ e.stopPropagation();
                  setPhotoToDelete(item);
                }} style={{ position:"absolute", top:4, right:4, zIndex:2, width:22, height:22,
                  borderRadius:"50%", background:"rgba(0,0,0,0.6)", border:"none",
                  cursor:"pointer", color:"white", fontSize:14,
                  display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              )}
              <div onClick={() => setLightbox(flatItems[startIdx + i])} style={{ cursor:"pointer" }}>
              <img src={item.url} alt={item.label}
                style={{ height:110, width:"auto", borderRadius:8, objectFit:"cover",
                  border:"1px solid var(--border)", display:"block" }}
                onError={e => { e.currentTarget.style.display="none"; }}/>
              </div>
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

  const flatItems = [...photoItems, ...milestoneItems];  // Photos → 100% → 99% → 50% → Couche2 → Couche1
  const lbIdx = lightbox ? flatItems.findIndex(i => i.url === lightbox.url) : -1;
  const moveLb = (dir) => {
    const ni = (lbIdx + dir + flatItems.length) % flatItems.length;
    setLightbox(flatItems[ni]);
  };

  return (
    <>
      <Row title="Photos" items={photoItems} startIdx={0} onAdd={async(f)=>{ await onUpload?.(f); reloadDiskFiles(); }} onDeleteItem={onDeleteUpload}/>
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
    {photoToDelete && <PhotoDeleteConfirm
      label={photoToDelete.label||photoToDelete.name}
      onCancel={()=>setPhotoToDelete(null)}
      onConfirm={()=>{ setDeletedNames(prev=>new Set([...prev,photoToDelete.name])); onDeleteUpload&&onDeleteUpload(photoToDelete.name); setPhotoToDelete(null); }}/> }
    </>
  );
}



function PrintsGalleryView({ search, sortF = "recent" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPrint, setSelectedPrint] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.get("/prints/gallery")
      .then(r => { if (!cancelled) setData(r.data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p style={{ textAlign:"center", color:"var(--muted)", padding:"40px 0" }}>Chargement…</p>;
  if (!data) return null;

  let items = [
    ...(data.prints||[]).map(p => ({ ...p, kind:"print", title:p.title||p.file_name, count:1 })),
    ...(data.groups||[]).map(g => ({ ...g, kind:"group", title:g.name, count:g.prints })),
  ];
  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    items = items.filter(it => (it.title||"").toLowerCase().includes(q));
  }
  items.sort((a,b) => {
    if (sortF==="oldest")   return (a.print_date||a.latest_date||"").localeCompare(b.print_date||b.latest_date||"");
    if (sortF==="cost")     return (b.total_cost||0)-(a.total_cost||0);
    if (sortF==="weight")   return (b.total_weight_g||0)-(a.total_weight_g||0);
    if (sortF==="duration") return (b.duration_seconds||0)-(a.duration_seconds||0);
    return (b.print_date||b.latest_date||"").localeCompare(a.print_date||a.latest_date||"");
  });

  return (
    <>
    <GalleryCompare
      items={items}
      getId={it => `${it.kind}-${it.id}`}
      getCoverImage={it => it.photos?.[0]?.url || null}
      getPhotos={it => it.photos||[]}
      getTitle={it => it.title||"Sans nom"}
      getSubtitle={it => it.kind==="group" ? `📁 ${it.count} prints` : fmtDate(it.print_date)}
      emptyLabel="Aucune photo disponible"
      onItemClick={it => {
        if (it.kind==="group") setSelectedGroup(it);
        else setSelectedPrint(it);
      }}
      compareFields={[
        ["Coût",   it => it.total_cost ? `${it.total_cost.toFixed(2)}€` : null],
        ["Durée",  it => fmtDur(it.duration_seconds)],
        ["Poids",  it => it.total_weight_g ? `${it.total_weight_g.toFixed(0)}g` : null],
      ]}
    />
    {selectedPrint && (
      <PrintDetail p={selectedPrint} onClose={()=>setSelectedPrint(null)}
        onDelete={()=>setSelectedPrint(null)} onChanged={()=>{}}/>
    )}
    {selectedGroup && (
      <GroupBottomSheet
        groupId={selectedGroup.id} name={selectedGroup.name}
        prints={[]} number_of_items={selectedGroup.number_of_items||1}
        onClose={()=>setSelectedGroup(null)}
        onSelectPrint={()=>{}} onDelete={()=>{}} onUngroup={()=>{}}/>
    )}
    </>
  );
}

export default function Prints() {
  const [prints, setPrints]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset]   = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [kpis, setKpis] = useState(null);
  const sentinelRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const [search, setSearch]   = useState("");
  const [statusF, setStatusF] = useState("");
  const [selected, setSelected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError]     = useState(null);
  const [debugInfo, setDebugInfo] = useState("");
  const [groups, setGroups]   = useState([]);
  const [groupF, setGroupF]   = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [materialF, setMaterialF] = useState("");
  const [filaTypeF, setFilaTypeF] = useState("");
  const [filamentIdF, setFilamentIdF] = useState("");
  const [allFilaments, setAllFilaments] = useState([]);
  const [allMaterials, setAllMaterials] = useState([]);
  const [allFilaTypes, setAllFilaTypes] = useState([]);
  const [filSearch, setFilSearch] = useState("");
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

  const loadKpis = useCallback(async () => {
    const p = new URLSearchParams();
    if (search)      p.set("search", search);
    if (statusF)     p.set("status", statusF);
    if (groupF)      p.set("group_id", groupF);
    if (materialF)   p.set("material", materialF);
    if (filaTypeF)   p.set("fila_type", filaTypeF);
    if (filamentIdF) p.set("filament_id", filamentIdF);
    try {
      const { data } = await client.get("/prints/kpis?" + p);
      setKpis(data);
    } catch {}
  }, [search, statusF, groupF, materialF, filaTypeF, filamentIdF]);

  useEffect(() => { loadKpis(); }, [loadKpis]);

  // Charger les options de filtres filament
  useEffect(() => {
    client.get("/filaments/filaments", { params:{ limit:2000, archived_too:true } }).then(r=>{
      const fils = r.data || [];
      setAllFilaments(fils);
      setAllMaterials([...new Set(fils.map(f=>f.material).filter(Boolean))].sort());
      setAllFilaTypes([...new Set(fils.map(f=>f.fila_type).filter(Boolean))].sort());
    }).catch(()=>{});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOffset(0);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: 0 });
      if (search)      params.set("search", search);
      if (statusF)     params.set("status", statusF);
      if (groupF)      params.set("group_id", groupF);
      if (materialF)   params.set("material", materialF);
      if (filaTypeF)   params.set("fila_type", filaTypeF);
      if (filamentIdF) params.set("filament_id", filamentIdF);
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

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = offset + LIMIT;
      const params = new URLSearchParams({ limit: LIMIT, offset: next });
      if (search)      params.set("search", search);
      if (statusF)     params.set("status", statusF);
      if (groupF)      params.set("group_id", groupF);
      if (materialF)   params.set("material", materialF);
      if (filaTypeF)   params.set("fila_type", filaTypeF);
      if (filamentIdF) params.set("filament_id", filamentIdF);
      const { data } = await client.get("/prints?" + params);
      const existingIds = new Set((prints||[]).map(p => p.id));
      const fresh = (data.prints || []).filter(p => !existingIds.has(p.id));
      setPrints(prev => [...prev, ...fresh]);
      setOffset(next);
      setHasMore(data.has_more ?? false);
    } catch(e) {}
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }, [loadingMore, hasMore, offset, statusF, search, groupF, materialF, filaTypeF, filamentIdF]);

  useEffect(() => {
    const container = document.querySelector(".page-content");
    if (!container || !hasMore || viewMode !== "list") return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 400) loadMore();
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [loadMore, hasMore, viewMode]);

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
    <div style={{ maxWidth:960, margin:"0 auto", display:"flex", flexDirection:"column", gap:16 }}>

      {/* Titre */}
      <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Historique</h1>

      {/* Tabs Liste / Galerie */}
      <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:12, padding:4, border:"1px solid var(--border)" }}>
        {[["list","Liste"],["gallery","Galerie"]].map(([id,label])=>(
          <button key={id} onClick={()=>setViewMode(id)} style={{
            flex:1, padding:"8px 12px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
            background: viewMode===id ? "#3b82f6" : "transparent",
            color: viewMode===id ? "white" : "var(--muted)",
            border:"none", transition:"all 0.15s",
          }}>{label}</button>
        ))}
      </div>

      {/* KPIs — données complètes depuis API (pas juste les éléments chargés) */}
      {kpis && (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[
            [`${kpis.count}`, "prints", "#3b82f6"],
            kpis.duration > 0 ? [fmtDur(kpis.duration), null, "#8b5cf6"] : null,
            kpis.weight_g > 0 ? [`${(kpis.weight_g/1000).toFixed(2)} kg`, null, "#f59e0b"] : null,
            kpis.cost > 0 ? [`${kpis.cost.toFixed(2)} €`, null, "#22c55e"] : null,
          ].filter(Boolean).map(([val, label, color])=>(
            <div key={val} style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 10px",
              borderRadius:20, background:`${color}18`, border:`1px solid ${color}30` }}>
              <span style={{ fontSize:12, fontWeight:700, color, fontFamily:"monospace" }}>{val}</span>
              {label && <span style={{ fontSize:11, color:"var(--muted)" }}>{label}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Recherche + Filtres + .3mf */}
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
          {[statusF, sortF!=="recent", materialF, filaTypeF, filamentIdF].filter(Boolean).length > 0 ? `Filtres (${[statusF, sortF!=="recent", materialF, filaTypeF, filamentIdF].filter(Boolean).length})` : "Filtres"}
        </button>
        {viewMode==="list" && (
          <button onClick={()=>selectMode?exitSelectMode():setSelectMode(true)}
            title={selectMode?"Annuler sélection":"Sélectionner"}
            style={{ width:36, height:36, borderRadius:10, border:"1px solid var(--border)",
              background:selectMode?"rgba(59,130,246,0.1)":"var(--surface2)",
              color:selectMode?"#3b82f6":"var(--muted)", cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Check size={14}/>
          </button>
        )}
        <label title="Importer .3mf"
          style={{ width:36, height:36, borderRadius:10, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--muted)", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <Upload size={14}/>
          <input type="file" accept=".3mf" onChange={handleImport} style={{ display:"none" }}/>
        </label>

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
              {(statusF||sortF!=="recent"||materialF||filaTypeF||filamentIdF) && (
                <button onClick={()=>{ setStatusF(""); setSortF("recent"); setMaterialF(""); setFilaTypeF(""); setFilamentIdF(""); setFilSearch(""); }}
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
            {/* Filtre matériau */}
            {allMaterials.length > 0 && (<>
              <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 8px" }}>Matériau</p>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
                <button onClick={()=>setMaterialF("")} style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer", border:"none", background:!materialF?"#3b82f6":"var(--surface2)", color:!materialF?"white":"var(--muted)" }}>Tous</button>
                {allMaterials.map(m=>(
                  <button key={m} onClick={()=>setMaterialF(materialF===m?"":m)} style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer", border:"none", background:materialF===m?"#8b5cf6":"var(--surface2)", color:materialF===m?"white":"var(--muted)" }}>{m}</button>
                ))}
              </div>
            </>)}

            {/* Filtre type filament */}
            {allFilaTypes.length > 0 && (<>
              <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 8px" }}>Type de filament</p>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
                {(materialF ? allFilaTypes.filter(t=>allFilaments.some(f=>f.material===materialF&&f.fila_type===t)) : allFilaTypes).map(t=>(
                  <button key={t} onClick={()=>setFilaTypeF(filaTypeF===t?"":t)} style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:"none", background:filaTypeF===t?"#8b5cf6":"var(--surface2)", color:filaTypeF===t?"white":"var(--muted)" }}>{t}</button>
                ))}
              </div>
            </>)}

            {/* Filtre filament exact */}
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 8px" }}>Filament exact</p>
            <input value={filSearch} onChange={e=>setFilSearch(e.target.value)} placeholder="Rechercher un filament…"
              style={{ width:"100%", boxSizing:"border-box", padding:"8px 12px", borderRadius:8, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)", fontSize:12, outline:"none", marginBottom:6 }}/>
            <div style={{ maxHeight:140, overflowY:"auto", display:"flex", flexDirection:"column", gap:4, marginBottom:16 }}>
              {filamentIdF && <button onClick={()=>setFilamentIdF("")} style={{ padding:"5px 12px", borderRadius:8, fontSize:11, background:"rgba(239,68,68,0.1)", color:"#ef4444", border:"none", cursor:"pointer", textAlign:"left" }}>✕ Effacer filament sélectionné</button>}
              {allFilaments.filter(f=>!filSearch || (f.name||"").toLowerCase().includes(filSearch.toLowerCase()) || (f.translated_name||"").toLowerCase().includes(filSearch.toLowerCase()) || (f.manufacturer||"").toLowerCase().includes(filSearch.toLowerCase())).slice(0,30).map(f=>(
                <button key={f.id} onClick={()=>{ setFilamentIdF(filamentIdF===String(f.id)?"":String(f.id)); setFilSearch(""); }} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 10px", borderRadius:8, border:"none", cursor:"pointer", textAlign:"left", background:filamentIdF===String(f.id)?"rgba(59,130,246,0.15)":"var(--surface2)" }}>
                  <div style={{ width:12, height:12, borderRadius:"50%", flexShrink:0, backgroundColor:`#${f.color||"ccc"}` }}/>
                  <span style={{ fontSize:11, color:"var(--text)" }}>{f.translated_name||f.name} <span style={{ color:"var(--muted)" }}>· {f.manufacturer}</span></span>
                </button>
              ))}
            </div>

            <button onClick={()=>setFilterOpen(false)} style={{ width:"100%", padding:"12px", borderRadius:10, border:"none", background:"#3b82f6", color:"white", fontSize:14, fontWeight:700, cursor:"pointer" }}>
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
              {prints.map(p => <PrintCard key={p.id} p={p} onClick={()=>setSelected(p)} onDelete={onDelete} onLongPress={id=>{ setSelectMode(true); setSelectedIds(new Set([id])); }}/>)}
            </div>
          );
        }

        // Agréger les groupes par id (et non par nom — deux groupes distincts peuvent
        // porter le même nom, ex. import Spoolnymous à des dates différentes)
        // Déduplication (lazy load peut introduire des doublons)
        const seenIds = new Set();
        const uniquePrints = prints.filter(p => { if (seenIds.has(p.id)) return false; seenIds.add(p.id); return true; });
        const groupMap = {};   // group_id → { name, prints[], latestDate }
        uniquePrints.forEach(p => {
          if (!p.group_id) return;
          if (!groupMap[p.group_id]) groupMap[p.group_id] = { name: p.group_name, prints:[], latestDate:"", duration_seconds:0, number_of_items:p.group_number_of_items||1, cover_print_id:p.group_cover_print_id||null };
          groupMap[p.group_id].prints.push(p);
          if (!groupMap[p.group_id].latestDate || p.print_date > groupMap[p.group_id].latestDate)
            groupMap[p.group_id].latestDate = p.print_date;
          groupMap[p.group_id].duration_seconds = (groupMap[p.group_id].duration_seconds||0) + (p.duration_seconds||0);
        });

        // Construire la liste d'items : soit un print solo, soit un groupe entier
        const items = [];
        const addedGroups = new Set();
        uniquePrints.forEach(p => {
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
                duration_seconds={item.duration_seconds}
                cover_print_id={item.cover_print_id}
                onSelectPrint={setSelected}
                onUngroup={() => load()}
                onDelete={id=>{setPrints(ps=>ps.filter(p=>p.id!==id));setTotal(t=>t-1);}}/>
            ))}
          </div>
        );
      })()}



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
