import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Lightbox from "../components/Lightbox";
import { RefreshCw, Upload, Search, Filter, Clock, Package, CheckCircle, XCircle, Loader, Image as ImageIcon, List, Check, FolderPlus, X, FolderMinus, SlidersHorizontal, Pencil, Trash2, AlertTriangle, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useUrlTab } from "../utils/useUrlTab";
import MakerWorldView from "../components/MakerWorldView";
import MakerWorldCollectionsPicker from "../components/MakerWorldCollectionsPicker";
import MakerWorldModelSheet, { prefetchModel } from "../components/MakerWorldModelSheet";
import { openCreator } from "../components/MwCreatorPage";
import { useToRateSet, RateButton, GroupToRate } from "../components/MwToRate";
import { useFriend } from "../store/friend";
import MwImg from "../components/MwImg";
import client, { apiUrl } from "../api/client";
import { showAlert, showConfirm } from "../utils/dialog";
import { moneyVal } from "../utils/money";
import AdminOnly from "../components/AdminOnly";
import { useMine, MineBadge, FriendsPrints, useHasFriends, useShared, sharedCount, relayed } from "../components/Friends";
import { useMwAssign } from "../store/mwAssign";
import MwQueue from "../components/MwQueue";
import { mwImg } from "../components/MwImg";
import { toast } from "../store/toast";
import ShareSheet from "../components/ShareSheet";
import { useIsAdmin } from "../store/auth";
import { useTrackDetail } from "../utils/track";
import GalleryCompare from "../components/GalleryCompare";
import { FilamentSheetFromSpool } from "./Filaments";
import { useKeyboardInset } from "../utils/keyboard";
import PhotoAddButton from "../components/PhotoAddButton";
import GroupMosaic from "../components/GroupMosaic";
import ObjectCreateSheet from "../components/ObjectCreateSheet";
import ObjectQuotaButton from "../components/ObjectQuotaButton";
import Select from "../components/Select";
import { useLongPress, openMenu } from "../components/ContextMenu";

// PARTIAL et TO_REDO viennent de Spoolnymous, qui gerait cinq statuts. Les
// prints importes les portent toujours, mais l'application ne les connaissait
// pas : faute de configuration, ils tombaient dans le repli SUCCESS et
// s'affichaient comme REUSSIS. Une impression a refaire passait donc pour un
// succes, sans aucun signe.
const STATUS_CFG = {
  IN_PROGRESS: { label:"En cours",  color:"#3b82f6", bg:"rgba(59,130,246,0.75)",  icon:Loader },
  SUCCESS:     { label:"Réussi",    color:"#22c55e", bg:"rgba(34,197,94,0.75)",   icon:CheckCircle },
  PARTIAL:     { label:"Partiel",   color:"#f59e0b", bg:"rgba(245,158,11,0.75)",  icon:AlertTriangle },
  TO_REDO:     { label:"À refaire", color:"#a855f7", bg:"rgba(168,85,247,0.75)",  icon:RotateCcw },
  FAILED:      { label:"Échoué",    color:"#ef4444", bg:"rgba(239,68,68,0.75)",   icon:XCircle },
  CANCELLED:   { label:"Annulé",    color:"#94a3b8", bg:"rgba(148,163,184,0.75)", icon:XCircle },
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


function swatchBg(colorHex, colorsArray, multicolorType) {
  try {
    const cols = colorsArray ? colorsArray.split(',').map(c=>`#${c.trim().replace(/^#/,'').slice(0,6)}`).filter(c=>c.length===7) : null;
    if (cols && cols.length > 1) {
      if (multicolorType === 'gradient') return `linear-gradient(135deg, ${cols.join(',')})`;
      return `linear-gradient(90deg, ${cols.map((c,i,a)=>`${c} ${i/a.length*100}%, ${c} ${(i+1)/a.length*100}%`).join(',')})`;
    }
  } catch(e) {}
  return hexCss(colorHex);
}


/**
 * Pastille de couleur. Le dégradé vit sur un calque interne d'un conteneur
 * `overflow:hidden` et l'anneau est un box-shadow : contrairement à un `border`
 * sur l'élément peint, rien ne peut déborder ni se décaler (halo/artefacts).
 */
function ColorDot({ hex, colors, multicolor, size = 14, ring = "default", style }) {
  const rings = {
    default: "inset 0 0 0 1px rgba(128,128,128,0.35)",
    mapped:  "inset 0 0 0 1px rgba(128,128,128,0.35), 0 0 0 2px #22c55e",
    none:    "none",
  };
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", flexShrink:0,
      position:"relative", overflow:"hidden", boxShadow:rings[ring] ?? rings.default,
      ...style }}>
      <div style={{ position:"absolute", inset:0,
        background: swatchBg(hex, colors, multicolor) }}/>
    </div>
  );
}

function FilamentDots({ filaments }) {
  if (!filaments?.length) return null;
  return (
    <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
      {filaments.map((f, i) => (
        <div key={i}
          title={`${f.filament_type} — ${f.grams_used.toFixed(1)}g${f.spool_id ? " · Bobine liée" : " · Non mappé"}`}
          style={{ position:"relative", flexShrink:0 }}>
          <ColorDot hex={f.color_hex} colors={f.filament_colors_array}
            multicolor={f.filament_multicolor_type} size={14}
            ring={f.spool_id ? "mapped" : "default"}/>
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
  // Repli NEUTRE et non SUCCESS : un statut inconnu ne doit pas se deguiser en
  // reussite. Il s'affiche tel quel, ce qui le rend reperable.
  const cfg = STATUS_CFG[status] || { label: status || "?", color:"#94a3b8",
    bg:"rgba(148,163,184,0.75)", icon:AlertTriangle };
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
function SpoolMapPicker({ usageId, printId, colorHex, colorsArray, multicolorType, filamentType, onClose, onMapped }) {
  const [spools, setSpools] = useState([]);
  const [search, setSearch] = useState(filamentType || "");
  const [confirmSpool, setConfirmSpool] = useState(null);
  const [tab, setTab] = useState("active");   // active | archived
  const kb = useKeyboardInset();

  // Le backend renvoie non-archivees par defaut : on charge les deux jeux pour
  // pouvoir aussi mapper une bobine archivee (2e onglet).
  useEffect(() => {
    Promise.all([
      client.get("/filaments/spools", { params:{ limit:500, archived:false } }).then(r => r.data || []).catch(() => []),
      client.get("/filaments/spools", { params:{ limit:500, archived:true } }).then(r => r.data || []).catch(() => []),
    ]).then(([act, arch]) => setSpools([...act, ...arch]));
  }, []);

  const filtered = spools.filter(s => {
    if (tab === "active" && s.archived) return false;
    if (tab === "archived" && !s.archived) return false;
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
    } catch(e) { showAlert("Erreur: " + e.message); }
  };

  return (
    <>
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:3000,
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sheet-bg)",
        borderRadius:"20px 20px 0 0", width:"100%", maxWidth:640,
        marginBottom: kb, transition:"margin-bottom 0.15s ease",
        display:"flex", flexDirection:"column", maxHeight: kb > 0 ? `calc(92dvh - ${kb}px)` : "80dvh" }}>
        {/* Handle + titre */}
        <div style={{ padding:"12px 16px 8px", flexShrink:0 }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)", margin:"0 auto 10px" }}/>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <ColorDot hex={colorHex} colors={colorsArray} multicolor={multicolorType} size={18}/>
            <h3 style={{ fontSize:14, fontWeight:800, color:"var(--text)", margin:0, flex:1 }}>Associer une bobine</h3>
            <button onClick={onClose} style={{ width:26, height:26, borderRadius:"50%",
              background:"var(--surface2)", border:"none", cursor:"pointer",
              color:"var(--muted)", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
          <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:10, padding:3 }}>
            {[["active","Actives"],["archived","Archivées"]].map(([id,label]) => (
              <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:"6px 10px", borderRadius:8,
                fontSize:12, fontWeight:700, border:"none", cursor:"pointer",
                background: tab===id ? "#3b82f6" : "transparent", color: tab===id ? "#fff" : "var(--muted)" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {/* Liste scrollable */}
        <div style={{ flex:1, overflowY:"auto", padding:"0 16px" }}>
          {filtered.map(s => (
            <button key={s.id} onClick={()=>selectSpool(s)}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", width:"100%",
                background:"var(--surface2)", border:"1px solid var(--border)",
                borderRadius:8, cursor:"pointer", textAlign:"left", marginBottom:6 }}>
              <ColorDot hex={s.color_hex||s.filament_color} colors={s.filament_colors_array}
                multicolor={s.filament_multicolor_type} size={16}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:12, fontWeight:600, color:"var(--text)", margin:0,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.filament_translated_name||s.filament_name||"Bobine #"+s.id}</span>
                  {s.archived && <span style={{ flexShrink:0, fontSize:9, fontWeight:700, color:"var(--muted)", background:"var(--bg)", border:"1px solid var(--border)", borderRadius:5, padding:"1px 5px" }}>archivée</span>}
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
  // Texte BRUT de la saisie precise par usage : on ne reformate pas pendant la
  // frappe (sinon taper "37." effacerait le point avant les decimales) et on
  // accepte "." comme "," comme separateur decimal (pave numerique FR).
  const gFmt = (g) => String(+(g||0).toFixed(1));
  const [gtxt, setGtxt] = useState(() => Object.fromEntries(mapped.map(f=>[f.id, gFmt(f.grams_used)])));
  const OPTS = [0, 0.25, 0.5, 0.75, 1.0];
  const setAll = (v) => {
    setFracs(Object.fromEntries(mapped.map(f=>[f.id,v])));
    setGtxt(Object.fromEntries(mapped.map(f=>[f.id, gFmt(f.grams_used*v)])));
  };
  const setOne = (f, v) => {
    setFracs(prev=>({...prev,[f.id]:v}));
    setGtxt(prev=>({...prev,[f.id]:gFmt(f.grams_used*v)}));
  };
  const setGrams = (f, raw) => {
    setGtxt(prev=>({...prev,[f.id]:raw}));
    let g = parseFloat(String(raw).replace(",", "."));
    if (isNaN(g)) g = 0;
    g = Math.max(0, Math.min(f.grams_used, g));
    setFracs(prev=>({...prev,[f.id]:f.grams_used>0 ? g/f.grams_used : 0}));
  };
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
                  <ColorDot hex={f.color_hex} colors={f.filament_colors_array}
                    multicolor={f.filament_multicolor_type} size={16}/>
                  <span style={{ fontSize:12, fontWeight:600, color:"var(--text)", flex:1 }}>
                    {f.filament_translated_name||f.filament_fila_type||f.filament_type||"Filament"}
                  </span>
                  <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>{f.grams_used?.toFixed(1)}g</span>
                </div>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap", alignItems:"center" }}>
                  {OPTS.map(o=>(
                    <button key={o} onClick={()=>setOne(f,o)} style={{ padding:"4px 9px",
                      borderRadius:20, border:"none", cursor:"pointer", fontWeight:600, fontSize:11,
                      background:(fracs[f.id]??0)===o?"#22c55e":"var(--bg)",
                      color:(fracs[f.id]??0)===o?"white":"var(--muted)" }}>
                      {o===0?"Non":o===1?"100%":`${o*100}%`}
                    </button>
                  ))}
                  {/* Saisie precise en grammes : pilote la fraction (bornee a la
                      quantite consommee). Les boutons rapides mettent a jour ce champ. */}
                  <span style={{ fontSize:10, color:"var(--muted)", marginLeft:2 }}>ou</span>
                  <input type="text" inputMode="decimal"
                    value={gtxt[f.id] ?? ""}
                    onChange={e=>setGrams(f, e.target.value)}
                    onBlur={()=>setGtxt(prev=>({...prev,[f.id]:gFmt(f.grams_used*(fracs[f.id]??0))}))}
                    onFocus={e=>e.target.select()}
                    style={{ width:58, padding:"3px 6px", borderRadius:6, border:"1px solid var(--border)",
                      background:"var(--bg)", color:"var(--text)", fontSize:11, fontFamily:"monospace", textAlign:"right" }}/>
                  <span style={{ fontSize:10, color:"var(--muted)" }}>g</span>
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
    } catch(e) { showAlert("Erreur: " + e.message); }
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:4000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:16,
        width:"100%", maxWidth:360, padding:20, border:"1px solid var(--border)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <ColorDot hex={usage.color_hex} colors={usage.filament_colors_array}
            multicolor={usage.filament_multicolor_type} size={18}/>
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
          <ColorDot hex={f.color_hex} colors={f.filament_colors_array}
            multicolor={f.filament_multicolor_type} size={20}/>
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

function FilamentAccordion({ filaments, onSpoolClick, onSpoolPick, printId, onRestore, onUnmapped, onUnmap }) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
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
          {isAdmin && onRestore && filaments.some(f=>f.spool_id) && (
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
              <ColorDot hex={f.color_hex} colors={f.filament_colors_array}
                multicolor={f.filament_multicolor_type} size={16}/>
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
              onClick={e=>{e.stopPropagation(); if(f.spool_id){onSpoolClick&&onSpoolClick({filId:f.bam_filament_id||null,spoolId:f.spool_id,hex:f.color_hex||null});}else if(isAdmin){onSpoolPick&&onSpoolPick({usageId:f.id,colorHex:f.color_hex,colorsArray:f.filament_colors_array,multicolorType:f.filament_multicolor_type,filamentType:f.filament_fila_type||f.filament_type});}}}
              onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(isAdmin&&f.spool_id)onUnmap&&onUnmap(f);}}
              onPointerDown={e=>{ if(!isAdmin||!f.spool_id) return; const t=setTimeout(()=>{navigator.vibrate&&navigator.vibrate(20); onUnmap&&onUnmap(f);},600); e.currentTarget._lpt=t; }}
              onPointerUp={e=>clearTimeout(e.currentTarget._lpt)}
              onPointerLeave={e=>clearTimeout(e.currentTarget._lpt)}
              onPointerCancel={e=>clearTimeout(e.currentTarget._lpt)}
              style={{ display:"flex", alignItems:"center", gap:10,
              padding:"8px 12px", background:"var(--bg)",
              borderTop:"1px solid var(--border)",
              cursor: (f.spool_id || isAdmin) ? "pointer" : "default",
              opacity: f.spool_id ? 1 : 0.85 }}>
              <ColorDot hex={f.color_hex} colors={f.filament_colors_array}
                multicolor={f.filament_multicolor_type} size={20}
                ring={f.spool_id ? "mapped" : "default"}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:12, fontWeight:600, color:"var(--text)", margin:0,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {f.filament_translated_name || f.filament_fila_type || f.filament_name || "Inconnu"}
                  {f.spool_id && <span style={{ fontSize:9, color:"#22c55e", marginLeft:5 }}>✓#{f.spool_id}</span>}
                  {!f.spool_id && isAdmin && <span style={{ fontSize:9, color:"#f59e0b", marginLeft:5,
                    background:"rgba(245,158,11,0.12)", padding:"1px 5px", borderRadius:6 }}>▸ Mapper</span>}
                </p>
                <p style={{ fontSize:10, color:"var(--muted)", margin:"1px 0 0" }}>
                  {[f.filament_brand, f.filament_fila_type || f.filament_type, f.grams_used?.toFixed(1)+"g"].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                {/* Le cout principal est TOUJOURS affiche, meme a 0 (bobine
                    gratuite : c'est une info, pas une absence). f.cost peut
                    valoir 0 legitimement -> on ne bascule PAS sur normal_cost. */}
                <span style={{ fontSize:12, fontWeight:700, color:"var(--text)", fontFamily:"monospace" }}>
                  {moneyVal((f.cost || 0), 2)}€
                </span>
                {/* Toujours les DEUX couts, meme identiques : la parenthese
                    confirme le cout catalogue, son absence laisserait un doute. */}
                <p style={{ fontSize:9, color:"var(--muted)", margin:0 }}>({moneyVal((f.normal_cost || 0), 2)}€)</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

function PrintEditSheet({ p, onClose, onSaved }) {
  const kb = useKeyboardInset();
  const [form, setForm] = useState({
    file_name:     p.file_name || "",
    original_name: p.original_name || "",
    print_date:    (p.print_date || "").slice(0,16),
    status:        p.status || "SUCCESS",
    status_note:   p.status_note || "",
    design_id:     p.design_id || "",
    duration_min: Math.round((p.duration_seconds||p.estimated_seconds||0)/60),
  });
  const [saving, setSaving] = useState(false);

  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {...form};
      payload.duration_seconds = (parseInt(payload.duration_min)||0)*60;
      delete payload.duration_min;
      delete payload.original_name;
      await client.patch(`/prints/${p.id}`, payload);
      onSaved(form);
    } catch(e) { showAlert("Erreur: " + (e.response?.data?.detail || e.message)); }
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
          maxWidth:640, maxHeight: kb > 0 ? `calc(94dvh - ${kb}px)` : "90dvh", overflowY:"auto",
          marginBottom: kb, transition:"margin-bottom 0.15s ease",
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
            <Select style={sel} value={form.status} onChange={e=>set("status",e.target.value)}
              options={[{ value:"SUCCESS", label:"Réussi" },
                        { value:"PARTIAL", label:"Partiel" },
                        { value:"TO_REDO", label:"À refaire" },
                        { value:"FAILED",  label:"Échoué" },
                        { value:"IN_PROGRESS", label:"En cours" }]}/>
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

// Qui a fourni le nom de recherche (prints.translated_by), montre au survol.
const TRAD_BY = {
  gcloud:    "Traduit par Google Cloud Translation",
  deepl:     "Traduit par DeepL",
  google:    "Traduit par Google",
  mymemory:  "Traduit par MyMemory",
  identique: "Déjà en français : nom d'origine repris tel quel",
  manuel:    "Saisi à la main",
};

// Fiche publique du modele sur MakerWorld, lue en cache par le serveur. Pas
// encore lue : le serveur la lance, on redemande 4 s plus tard (une fois).
const fmtK = n => n == null ? null : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
function MakerWorldCard({ designId, note, prints = [] }) {
  const mineOf = useMine([designId]);            // chez un copain : l'ai-je deja ?
  const visiting = useFriend((s) => s.friend);
  const toRate = useToRateSet(!visiting);
  const [mw, setMw] = useState(undefined);       // undefined = en cours, null = rien
  const [pick, setPick] = useState(false);       // ranger dans mes collections
  const [sheet, setSheet] = useState(null);      // fiche du modele (ou d'un similaire)
  const hasFriends = useHasFriends();
  const shared = useShared(`/friends/shared/design/${encodeURIComponent(designId)}`, hasFriends && !!designId);
  const nShared = sharedCount(shared);           // section seulement s'il y a quelque chose chez eux
  const [showFr, setShowFr] = useState(false);   // « Chez les copains » : meme modele chez eux
  useEffect(() => {
    let alive = true, timer = null;
    const load = (again) => client.get(`/prints/makerworld/${encodeURIComponent(designId)}`).then(({ data }) => {
      if (!alive) return;
      setMw(data.makerworld || null);
      if (data.status === "pending" && again) timer = setTimeout(() => load(false), 4000);
    }).catch(() => alive && setMw(null));
    load(true);
    return () => { alive = false; clearTimeout(timer); };
  }, [designId]);

  const url = mw?.url || `https://makerworld.com/fr/models/${designId}`;
  if (!mw) return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6,
        width:"100%", padding:"8px", borderRadius:10, marginBottom:14,
        border:"1px solid rgba(59,130,246,0.3)", background:"rgba(59,130,246,0.06)",
        color:"#3b82f6", fontSize:12, fontWeight:700, textDecoration:"none" }}>
      🌐 Voir sur MakerWorld
    </a>
  );
  const stats = [["❤", mw.like_count, "j'aime"], ["⬇", mw.download_count, "téléchargements"],
    ["🖨", mw.print_count, "impressions"], ["⭐", mw.collection_count, "mises en collection"]]
    .filter(([, n]) => n != null);
  return (
    <div style={{ marginBottom:14, borderRadius:12, border:"1px solid var(--border)",
      background:"var(--surface2)", overflow:"hidden" }}>
      <a href={url} onClick={e => { e.preventDefault(); setSheet(designId); }} onPointerDown={() => prefetchModel(designId)}
        style={{ display:"flex", gap:10, padding:10, textDecoration:"none", color:"var(--text)", cursor:"pointer" }}>
        {mw.cover_url && (
          <MwImg src={mw.cover_url} w={64}
            style={{ width:64, height:64, borderRadius:8, objectFit:"cover", flexShrink:0, background:"var(--surface)" }}/>
        )}
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#3b82f6", letterSpacing:0.3, marginBottom:2 }}>
            MAKERWORLD ↗
          </div>
          <div style={{ fontSize:13, fontWeight:700, lineHeight:1.3, overflow:"hidden",
            display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{mw.title}</div>
          {mw.title_fr && mw.title_fr !== mw.title && (
            <div style={{ fontSize:11, color:"var(--muted)", marginTop:1, overflow:"hidden",
              textOverflow:"ellipsis", whiteSpace:"nowrap" }} title="Titre traduit (recherche)">{mw.title_fr}</div>
          )}
          {mw.creator_name && (
            <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"var(--muted)", marginTop:3 }}>
              {mw.creator_avatar && <MwImg src={mw.creator_avatar} w={28}
                style={{ width:14, height:14, borderRadius:"50%" }}/>}
              par {mw.creator_uid
                ? <span role="button" title="Tous ses modèles"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); openCreator({ uid: mw.creator_uid, name: mw.creator_name }); }}
                    style={{ color:"#3b82f6", fontWeight:600, cursor:"pointer" }}>{mw.creator_name}</span>
                : mw.creator_name}
            </div>
          )}
        </div>
      </a>
      {(stats.length > 0 || mw.categories?.length > 0) && (
        <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:6, padding:"0 10px 10px" }}>
          {mw.categories?.map(c => (
            <span key={c} style={{ fontSize:10.5, padding:"2px 8px", borderRadius:20,
              background:"rgba(59,130,246,0.1)", color:"#60a5fa", fontWeight:600 }}>{c}</span>
          ))}
          {stats.map(([ico, n, lbl]) => (
            <span key={lbl} title={`${n} ${lbl}`} style={{ fontSize:11, color:"var(--muted)" }}>{ico} {fmtK(n)}</span>
          ))}
        </div>
      )}
      {note && <div style={{ fontSize:10.5, color:"var(--muted)", padding:"0 10px 8px" }}>{note}</div>}
      {mineOf && <div style={{ padding:"0 10px 8px" }}><MineBadge m={mineOf(designId)}/></div>}
      {toRate.has(String(designId)) && (
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 10px 10px", flexWrap:"wrap" }}>
          <span style={{ fontSize:11, fontWeight:700, color:"#f59e0b" }}>⭐ Pas encore évalué</span>
          <RateButton did={designId} style={{ fontSize:11.5, fontWeight:700, padding:"4px 10px", borderRadius:10, background:"#f59e0b",
            color:"white", textDecoration:"none", border:"1px solid #f59e0b" }}/>
        </div>
      )}
      <MakerWorldPlates designId={designId} profiles={mw.profiles || []} prints={prints}/>
      <AdminOnly home mw>
        <button onClick={() => setPick(true)} style={{ display:"block", width:"100%", padding:"7px", border:"none",
          borderTop:"1px solid var(--border)", background:"none", color:"#3b82f6", fontSize:11.5, fontWeight:600,
          cursor:"pointer" }}>☆ Ranger dans mes collections</button>
      </AdminOnly>
      {pick && <MakerWorldCollectionsPicker designId={designId} title={mw.title} onClose={() => setPick(false)}/>}
      {nShared > 0 && (<>
        <button onClick={() => setShowFr(v => !v)} style={{ display:"flex", width:"100%", padding:"7px 10px", border:"none",
          borderTop:"1px solid var(--border)", background:"none", color:"#3b82f6", fontSize:11.5, fontWeight:600, cursor:"pointer" }}>
          <span style={{ flex:1, textAlign:"left" }}>👀 Chez les copains ({nShared})</span><span>{showFr ? "▴" : "▾"}</span></button>
        {showFr && <div style={{ padding:"4px 10px 10px" }}><FriendsPrints data={shared}/></div>}
      </>)}
      <MakerWorldSimilar designId={designId} onOpen={setSheet}/>
      {sheet && <MakerWorldModelSheet designId={sheet} onClose={() => setSheet(null)}/>}
    </div>
  );
}

// Plateaux du profil imprime, coches d'apres les prints (plate_id, et profil
// MakerWorld quand l'imprimante l'a donne). Profil inconnu (vieux prints) :
// on deduit -- profil unique, ou celui par defaut -- et on le dit.
// Plateaux choisis a la main sur un print ({profile, plates}) : passent avant
// le numero de plateau lu dans le fichier (renumerote dans mon projet, ou
// plusieurs plateaux MakerWorld regroupes sur un seul).
const manualPlates = (raw) => { try { const m = JSON.parse(raw || "null"); return m && Array.isArray(m.plates) ? m : null; } catch { return null; } };

function MakerWorldPlates({ designId, profiles, prints: printsIn }) {
  const [over, setOver] = useState({});          // corrections faites ici, avant relecture
  const [imgGuess, setImgGuess] = useState({});        // plateau probable par print (silhouette de son apercu)
  const guessIds = printsIn.filter(pr => !manualPlates(pr.mw_plates) && pr.status !== "FAILED" && pr.status !== "CANCELLED")
    .map(pr => pr.id).join(",");
  useEffect(() => {
    if (!designId || !guessIds) return;
    let alive = true;
    client.get(`/makerworld/model/${designId}/plate-guess`, { params: { ids: guessIds } })
      .then(({ data }) => alive && setImgGuess(data.guesses || {})).catch(() => {});
    return () => { alive = false; };
  }, [designId, guessIds]);
  const isAdmin = useIsAdmin();
  const visiting = useFriend((s) => s.friend);
  const prints = printsIn.map(pr => pr.id in over ? { ...pr, mw_plates: over[pr.id] } : pr);
  const avec = profiles.filter(x => x.plates?.length);
  const known = {};
  prints.forEach(pr => {
    const pp = manualPlates(pr.mw_plates)?.profile || pr.mw_profile_id;
    if (pp) known[pp] = (known[pp] || 0) + 1;
  });
  const sure = avec.find(x => known[x.profile_id] && known[x.profile_id] === Math.max(...Object.values(known)));
  // Profil inconnu : on le deduit des indices de mes prints, du plus fort au plus
  // faible -- profil reconnu a l'image de l'apercu, puis plateaux qui collent
  // (le numero de plateau existe dans ce profil, poids voisin de celui du
  // plateau). A egalite, l'ordre recu (deja classe pour mon imprimante).
  // Nom de la tache (sous-tache envoyee a l'imprimante) : lance depuis Studio,
  // il reprend souvent le titre du profil MakerWorld, en tout ou en partie.
  const words = (t) => new Set(String(t || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    .split(/[^a-z0-9.]+/).filter(w => w.length > 1 && !/^(plate|plateau|the|and|for|with|de|du|la|le|les|et)$/.test(w)));
  const nameScore = (pr, x) => {
    const name = `${pr.original_name || ""} ${pr.task_name || ""} ${pr.file_name || ""}`;
    const pw = words(x.title);
    if (pw.size < 2) return 0;
    const nw = words(name);
    const common = [...pw].filter(w => nw.has(w)).length;
    return common / pw.size;                  // part du titre du profil retrouvee dans le nom
  };
  const scoreOf = (x) => {
    let sc = 0;
    prints.forEach(pr => {
      const ns = nameScore(pr, x);
      if (ns >= 0.5) sc += 12 * ns;            // indice fort : le nom de la tache cite ce profil
      const g = imgGuess[pr.id];
      if (g && String(g.profile) === String(x.profile_id)) sc += g.sure === false ? 6 : 10;
      const i = parseInt(pr.plate_id, 10);
      const pl = i ? x.plates.find(q => q.index === i) : null;
      if (i && !pl) sc -= 4;                                   // ce profil n'a pas ce plateau
      else if (pl?.weight_g && pr.total_weight_g > 0) {
        const r = Math.min(pl.weight_g, pr.total_weight_g) / Math.max(pl.weight_g, pr.total_weight_g);
        sc += 3 * r;                                            // 3 si meme poids, ~0 si tres different
      }
    });
    return sc;
  };
  const deduced = !sure && avec.length > 1
    ? avec.map((x, k) => ({ x, sc: scoreOf(x), k })).sort((a, b) => b.sc - a.sc || a.k - b.k)[0]
    : null;
  const guess = sure || (avec.length === 1 ? avec[0]
    : deduced && deduced.sc > 0 ? deduced.x : avec.find(x => x.default) || avec[0]);
  const [pid, setPid] = useState(null);
  if (!avec.length || !prints.length) return null;
  const prof = avec.find(x => x.profile_id === pid) || guess;
  const deduit = !sure;
  // un print compte pour ce profil s'il en vient, ou si son profil est inconnu
  // ou sans plateaux connus (profil retouche, renvoye depuis Studio...) : on ne
  // l'ecarte que s'il vient d'un AUTRE profil dont on connait les plateaux.
  // Termine (reussi / partiel) seulement ; un plateau en cours est signale a part.
  const withPlates = new Set(avec.map(x => String(x.profile_id)));
  const done = {}, running = {};
  // Plateaux de ce profil couverts par un print (choix manuel, sinon detection).
  const platesOf = (pr) => {
    const m = manualPlates(pr.mw_plates);
    if (m) return !m.profile || String(m.profile) === String(prof.profile_id) ? m.plates : null;
    const pp = pr.mw_profile_id ? String(pr.mw_profile_id) : null;
    if (pp && pp !== String(prof.profile_id) && withPlates.has(pp)) return null;
    const i = parseInt(pr.plate_id, 10);
    return i ? [i] : null;
  };
  prints.forEach(pr => {
    (platesOf(pr) || []).forEach(i => {
      if (pr.status === "SUCCESS" || pr.status === "PARTIAL") done[i] = (done[i] || 0) + 1;
      else if (pr.status === "IN_PROGRESS") running[i] = true;
    });
  });
  // Propositions : plateau reconnu a l'image, pas encore couvert par le print.
  const probable = {};
  prints.forEach(pr => {
    const g = imgGuess[pr.id];
    if (!g || manualPlates(pr.mw_plates) || String(g.profile) !== String(prof.profile_id)) return;
    if ((platesOf(pr) || []).includes(g.plate) || done[g.plate]) return;
    (probable[g.plate] = probable[g.plate] || []).push({ pr, score: g.score, sure: g.sure });
  });
  const nProbable = Object.keys(probable).length;
  const acceptAll = () => Object.entries(probable).forEach(([i, l]) => l.forEach(({ pr }) => save(pr, [Number(i)])));
  const save = async (pr, plates, reset = false) => {
    try {
      const { data } = await client.put(`/prints/${pr.id}/mw-plates`, { profile: prof.profile_id, plates, reset });
      setOver(o => ({ ...o, [pr.id]: data.mw_plates }));
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  // Touche sur un plateau : quels prints l'ont imprime (plusieurs plateaux
  // peuvent venir d'un meme print).
  const pick = (e, pl) => {
    if (!isAdmin || visiting) return;
    openMenu(e, {
      title: `${pl.index}. ${pl.name || "Plateau"}`, subtitle: "Imprimé par…", img: pl.thumb ? mwImg(pl.thumb, 120) : null,
      items: [
        ...(probable[pl.index] || []).map(({ pr, score, sure }) => ({ icon: "💡", img: apiUrl(`/prints/${pr.id}/image`),
          label: `Valider : ${pr.translated_name || pr.file_name}`,
          hint: `Reconnu à l'image (ressemblance ${Math.round(score * 100)} %)`
            + (sure === false ? " · d'autres plateaux se ressemblent : le plus proche, départagé au poids" : ""),
          onClick: () => save(pr, [pl.index]) })),
        probable[pl.index] && "-",
        ...prints.map(pr => {
          const cur = platesOf(pr) || [];
          const on = cur.includes(pl.index);
          return { icon: on ? "✅" : "⬜", img: apiUrl(`/prints/${pr.id}/image`), label: pr.translated_name || pr.file_name,
            hint: [fmtDate(pr.print_date), STATUS_CFG[pr.status]?.label].filter(Boolean).join(" · "),
            onClick: () => save(pr, on ? cur.filter(i => i !== pl.index) : [...cur, pl.index]) };
        }),
        prints.some(pr => manualPlates(pr.mw_plates)) && "-",
        prints.some(pr => manualPlates(pr.mw_plates)) && { icon: "↺", label: "Revenir à la détection",
          hint: "Oublie les choix faits à la main sur ces prints",
          onClick: () => prints.filter(pr => manualPlates(pr.mw_plates)).forEach(pr => save(pr, [], true)) },
      ],
    });
  };
  const nDone = prof.plates.filter(pl => done[pl.index]).length;
  return (
    <div style={{ padding:"8px 10px 10px", borderTop:"1px solid var(--border)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginBottom:6 }}>
        <span style={{ fontSize:11.5, fontWeight:700, color:"var(--text)" }}>
          Plateaux · {nDone}/{prof.plates.length} imprimé{nDone > 1 ? "s" : ""}
        </span>
        {avec.length > 1 ? (
          <select value={prof.profile_id} onChange={e => setPid(e.target.value)}
            style={{ maxWidth:"100%", fontSize:11, padding:"2px 6px", borderRadius:6, background:"var(--surface)",
              border:"1px solid var(--border)", color:"var(--muted)" }}>
            {avec.map(x => <option key={x.profile_id} value={x.profile_id}>{x.title || `Profil ${x.profile_id}`}</option>)}
          </select>
        ) : <span style={{ fontSize:11, color:"var(--muted)" }}>{prof.title}</span>}
        {deduit && !pid && <span title="L'imprimante n'a pas donné le profil de ces prints : profil déduit"
          style={{ fontSize:10, color:"var(--muted)", opacity:0.8 }}>(profil déduit)</span>}
        {isAdmin && !visiting && <span style={{ fontSize:10, color:"var(--muted)", opacity:0.8 }}>· touche un plateau pour corriger</span>}
        {isAdmin && !visiting && nProbable > 0 && (
          <button onClick={acceptAll} title="Plateaux reconnus à l'image de tes prints"
            style={{ fontSize:10.5, fontWeight:700, padding:"2px 8px", borderRadius:10, cursor:"pointer",
              background:"rgba(59,130,246,0.12)", color:"#3b82f6", border:"1px solid rgba(59,130,246,0.4)" }}>
            💡 Valider {nProbable} plateau{nProbable > 1 ? "x" : ""} reconnu{nProbable > 1 ? "s" : ""}</button>
        )}
      </div>
      <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:2 }}>
        {prof.plates.map(pl => {
          const ok = !!done[pl.index], cours = !ok && running[pl.index], maybe = !ok && !cours && probable[pl.index];
          return (
            <div key={pl.index} title={`${pl.index}. ${pl.name || "Plateau"}${pl.weight_g ? ` · ${pl.weight_g} g` : ""}${ok ? ` · imprimé ${done[pl.index]}×` : " · pas encore imprimé"}`}
              onClick={e => pick(e, pl)}
              style={{ flexShrink:0, width:62, textAlign:"center", opacity: ok || cours || maybe ? 1 : 0.55,
                cursor: isAdmin && !visiting ? "pointer" : "default" }}>
              <div style={{ position:"relative", width:62, height:62, borderRadius:8, overflow:"hidden",
                border: ok ? "2px solid #22c55e" : cours ? "2px solid #f59e0b" : maybe ? "2px dashed #3b82f6" : "1px dashed var(--border)",
                background:"var(--surface)" }}>
                {pl.thumb && <MwImg src={pl.thumb} w={62}
                  style={{ width:"100%", height:"100%", objectFit:"cover" }}/>}
                {ok && <span style={{ position:"absolute", top:2, right:2, width:16, height:16, borderRadius:"50%",
                  background:"#22c55e", color:"white", fontSize:10, fontWeight:800, lineHeight:"16px" }}>✓</span>}
                {maybe && <span title={`Probablement imprimé par ${maybe[0].pr.translated_name || maybe[0].pr.file_name}`}
                  style={{ position:"absolute", top:2, right:2, width:16, height:16, borderRadius:"50%", background:"#3b82f6",
                    color:"white", fontSize:10, fontWeight:800, lineHeight:"16px" }}>?</span>}
                {cours && <span title="En cours d'impression" style={{ position:"absolute", top:2, right:2, width:16, height:16,
                  borderRadius:"50%", background:"#f59e0b", color:"white", fontSize:9, lineHeight:"16px" }}>⏳</span>}
              </div>
              <div style={{ fontSize:9.5, color:"var(--muted)", marginTop:2, overflow:"hidden", textOverflow:"ellipsis",
                whiteSpace:"nowrap" }}>{pl.index}. {pl.name || "Plateau"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Modeles similaires, charges a la demande (une requete, pas a l'ouverture).
function MakerWorldSimilar({ designId, onOpen }) {
  const [sim, setSim] = useState(null);           // null = pas demande, undefined = en cours
  const load = () => {
    setSim(undefined);
    client.get(`/makerworld/similar/${encodeURIComponent(designId)}`)
      .then(({ data }) => setSim(data.items || [])).catch(() => setSim([]));
  };
  if (sim === null) return (
    <button onClick={load} style={{ display:"block", width:"100%", padding:"7px", border:"none",
      borderTop:"1px solid var(--border)", background:"none", color:"#3b82f6", fontSize:11.5, fontWeight:600,
      cursor:"pointer" }}>Modèles similaires</button>
  );
  return (
    <div style={{ padding:"8px 10px 10px", borderTop:"1px solid var(--border)" }}>
      <div style={{ fontSize:11.5, fontWeight:700, color:"var(--text)", marginBottom:6 }}>Modèles similaires</div>
      {sim === undefined ? <div style={{ fontSize:11, color:"var(--muted)" }}>…</div>
        : sim.length === 0 ? <div style={{ fontSize:11, color:"var(--muted)" }}>Rien trouvé.</div> : (
        <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:2 }}>
          {sim.map(x => (
            <a key={x.design_id} href={x.url} onClick={e => { if (onOpen) { e.preventDefault(); onOpen(x.design_id); } }}
              onPointerDown={() => prefetchModel(x.design_id)}
              target="_blank" rel="noopener noreferrer"
              style={{ flexShrink:0, width:96, textDecoration:"none", color:"var(--text)" }}>
              <div style={{ position:"relative", width:96, height:96, borderRadius:8, overflow:"hidden", background:"var(--surface)" }}>
                {x.cover_url && <MwImg src={x.cover_url} w={96}
                  style={{ width:"100%", height:"100%", objectFit:"cover" }}/>}
                {x.printed > 0 && <span style={{ position:"absolute", left:4, bottom:4, fontSize:9.5, fontWeight:800,
                  padding:"1px 6px", borderRadius:20, background:"#22c55e", color:"white" }}>✓ IMPRIMÉ</span>}
              </div>
              <div style={{ fontSize:10.5, marginTop:3, lineHeight:1.25, overflow:"hidden", display:"-webkit-box",
                WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{x.title}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function PrintDetail({ p: pProp, onClose, onDelete, onChanged }) {
  const [snaps, setSnaps] = useState([]);
  const [sharing, setSharing] = useState(false);   // partage Telegram
  const [ungrouped, setUngrouped] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [userPhotos, setUserPhotos] = useState([]);
  const loadUserPhotos = () => client.get(`/prints/${pProp.id}/photos`).then(r=>setUserPhotos(Array.isArray(r.data)?r.data:[])).catch(()=>{});
  useEffect(() => { loadUserPhotos(); }, [pProp.id]);
  const uploadPhoto = async (file) => { const fd = new FormData(); fd.append("file", file); await client.post(`/prints/${pProp.id}/photos/upload`, fd, { headers:{"Content-Type":"multipart/form-data"} }); loadUserPhotos(); };
  const [p, setP] = useState(pProp);
  const [editFr, setEditFr] = useState(false);
  const [frVal, setFrVal]   = useState("");
  // file_name et non name : un Print n'a pas de champ "name" -- la fiche elle
  // meme affiche file_name. Le libelle tombait donc systematiquement sur le
  // repli "#id", et le journal ne montrait que des numeros.
  useTrackDetail(`Fiche print · ${p?.file_name || pProp?.file_name || "#" + pProp.id}`);

  useEffect(() => {
    if (pProp.total_cost_filament == null) {
      client.get("/prints/" + pProp.id).then(r => setP(r.data)).catch(() => setP(pProp));
    } else { setP(pProp); }
  }, [pProp.id]);

  const groupe = ungrouped ? null : p.group_name;
  const [editNb, setEditNb]   = useState(false);
  const [spoolPicker, setSpoolPicker] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [objCreate, setObjCreate] = useState(null);   // feuille de creation d'objets
  const [unmapping, setUnmapping] = useState(null);
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
    if (!(await showConfirm("Retirer ce print de son groupe ?"))) return;
    try { await client.post("/prints/" + p.id + "/group", {}); setUngrouped(true); onChanged?.(); }
    catch(err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };

  // Les deux coûts viennent du backend, qui applique deja la cascade (bobine ->
  // filament -> 20 €/kg pour le principal ; filament -> 20 €/kg pour l'autre).
  // Le front ne refait PLUS de fallback : il ne faisait que dupliquer -- et
  // desormais contredire -- cette logique.
  const costFil     = p.total_cost_filament || 0;          // coût principal
  const costNormal  = p.total_cost_filament_normal || 0;   // coût entre parenthèses
  const costElec    = p.electric_cost || 0;
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
          <img src={apiUrl("/prints/" + p.id + "/image")} alt=""
            style={{ width:"100%", maxHeight:280, objectFit:"contain" }}
            onError={e => { e.currentTarget.parentElement.style.minHeight=0; e.currentTarget.style.display="none"; }}/>
        </div>




        <div style={{ padding:"0 16px 16px" }}>
          {/* Titre — le bouton Éditer existait, mais tout en bas de la fiche,
              apres les photos et les filaments : introuvable en pratique. On le
              remet aussi ici, comme sur la fiche filament. */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
            <h2 style={{ flex:1, minWidth:0, fontSize:17, fontWeight:800, color:"var(--text)",
              margin:"0 0 4px", letterSpacing:"-0.01em" }}>
              {p.file_name || "Sans nom"}
            </h2>
            <AdminOnly><button onClick={()=>setEditMode(true)} aria-label="Éditer"
              style={{ flexShrink:0, background:"none", border:"none", cursor:"pointer",
                color:"var(--muted)", padding:4, display:"flex" }}
              onMouseEnter={e=>e.currentTarget.style.color="#3b82f6"}
              onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
              <Pencil size={16}/>
            </button></AdminOnly>
          </div>
          {p.original_name && p.original_name !== p.file_name && (
            <p style={{ fontSize:11, color:"var(--muted)", margin:"0 0 6px" }}>{p.original_name}</p>
          )}
          {/* Nom francais : sert uniquement a la recherche, il ne remplace
              jamais le titre. Modifiable, car une traduction automatique se
              trompe parfois -- et surtout parce que le nom sous lequel on
              cherche un print est souvent personnel ("la tirelire de Matteo")
              et qu'aucun traducteur ne peut le deviner. */}
          <div style={{ display:"flex", alignItems:"center", gap:6, margin:"0 0 8px" }}>
            {editFr ? (
              <>
                <input value={frVal} onChange={e=>setFrVal(e.target.value)} autoFocus
                  placeholder="Nom en français (recherche)"
                  style={{ flex:1, minWidth:0, fontSize:12, padding:"4px 8px", borderRadius:7,
                    background:"var(--surface2)", border:"1px solid var(--border)",
                    color:"var(--text)", outline:"none" }}/>
                <button onClick={async()=>{
                    const v = frVal.trim();
                    try {
                      await client.patch(`/prints/${p.id}`, { translated_name: v });
                      setP(prev => ({ ...prev, translated_name: v, translated_by: v ? "manuel" : null }));
                      onChanged && onChanged();
                    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
                    setEditFr(false);
                  }}
                  style={{ fontSize:11, padding:"4px 10px", borderRadius:7, cursor:"pointer",
                    border:"none", background:"#3b82f6", color:"white", fontWeight:600 }}>OK</button>
                <button onClick={()=>setEditFr(false)}
                  style={{ fontSize:11, padding:"4px 8px", borderRadius:7, cursor:"pointer",
                    border:"1px solid var(--border)", background:"transparent",
                    color:"var(--muted)" }}>✕</button>
              </>
            ) : (
              <AdminOnly>
                <button onClick={()=>{ setFrVal(p.translated_name || ""); setEditFr(true); }}
                  title={p.translated_name ? (TRAD_BY[p.translated_by] || "Origine inconnue (traduit avant le suivi du service)") : undefined}
                  style={{ display:"flex", alignItems:"center", gap:5, fontSize:11,
                    padding:"2px 9px", borderRadius:20, cursor:"pointer",
                    border:"1px solid var(--border)", background:"transparent",
                    color:"var(--muted)", maxWidth:"100%" }}>
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    🔎 {p.translated_name || "Ajouter un nom de recherche"}
                  </span>
                  <Pencil size={11} style={{ flexShrink:0 }}/>
                </button>
              </AdminOnly>
            )}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            <StatusBadge status={p.status}/>
            {groupe && (
              <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:10,
                background:"rgba(167,139,250,0.15)", color:"#a78bfa",
                padding:"2px 6px 2px 8px", borderRadius:20, fontWeight:700 }}>
                📁 {groupe}
                <AdminOnly><button onClick={handleUngroup} style={{ background:"none", border:"none",
                  color:"#a78bfa", cursor:"pointer", padding:0, display:"flex" }}>
                  <X size={11}/>
                </button></AdminOnly>
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
                  {moneyVal(costFil, 2)}€
                </p>
                <p style={{ fontSize:10, color:"var(--muted)", margin:"2px 0 0" }}>
                  ({moneyVal(costNormal, 2)}€ sans bobine)
                </p>
              </div>
              {/* Électricité */}
              <div style={{ background:"var(--surface2)", borderRadius:10, padding:"8px 10px" }}>
                <p style={{ fontSize:9, color:"var(--muted)", margin:"0 0 3px" }}>Électricité</p>
                <p style={{ fontSize:15, fontWeight:800, color:"#f59e0b", margin:0, fontFamily:"monospace" }}>
                  {moneyVal(costElec, 2)}€
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
                    {moneyVal(totalBobine, 2)}€
                  </span>
                  <span style={{ fontSize:11, color:"var(--muted)", marginLeft:8 }}>
                    ({moneyVal(totalNormal, 2)}€)
                  </span>
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
                      · {moneyVal((totalBobine/localNb), 2)}€/u
                      {` (${moneyVal((totalNormal/localNb), 2)}€/u)`}
                    </span>
                  )}
                </div>
                {!editNb ? (
                  <AdminOnly><button onClick={()=>{setNbVal(String(localNb));setEditNb(true);}}
                    style={{ fontSize:10, padding:"2px 8px", borderRadius:6,
                      border:"1px solid rgba(34,197,94,0.3)", background:"none",
                      color:"#22c55e", cursor:"pointer" }}>Modifier</button></AdminOnly>
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
            onCountChange={setPhotoCount}
            coverPhoto={p.cover_photo}
            onCoverChange={(name)=>{ setP(prev=>({ ...prev, cover_photo:name })); onChanged?.(); }}/>

          {/* Fiche MakerWorld du modele (titre, createur, categories, compteurs),
              ou a defaut le simple lien. */}
          {p.design_id && <MakerWorldCard designId={p.design_id} prints={[p]}/>}

          {/* Creation d'objets : le bouton porte le quota et se desactive
              quand tout est cree, plutot que de laisser tenter puis echouer. */}
          <AdminOnly>
            <ObjectQuotaButton parentType="print" parentId={p.id}
              label="depuis ce print" refreshKey={refreshKey}
              onOpen={() => setObjCreate({ name: p.file_name || "Sans nom",
                cost: totalBobine })}/>
          </AdminOnly>
          {objCreate && (
            <ObjectCreateSheet parentType="print" parentId={p.id}
              defaultName={objCreate.name} costFabrication={objCreate.cost}
              onDone={() => { setRefreshKey(k=>k+1); onChanged?.(); }}
              onClose={() => setObjCreate(null)}/>
          )}

          {/* Filaments — accordéon */}
          {p.filament_usage?.length > 0 && <FilamentAccordion filaments={p.filament_usage} onSpoolClick={setSelSpool} onSpoolPick={setSpoolPicker} printId={p.id} onRestore={()=>setShowDeleteConfirm('restore')} onUnmap={setUnmapping} onUnmapped={()=>{ client.get('/prints/'+p.id).then(r=>{ setP(r.data); setRefreshKey(k=>k+1); }).catch(()=>{}); onChanged?.(); }}/>}

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
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:8 }}>
            <AdminOnly>
            <button onClick={()=>setEditMode(true)}
              style={{ flex:"1 1 0", minWidth:96, padding:"11px", borderRadius:12, border:"1px solid var(--border)",
                background:"var(--surface2)", color:"var(--text)", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              ✏️ Éditer
            </button>

            <button onClick={() => setSharing(true)} title="Partager sur Telegram"
              style={{ flex:"1 1 0", minWidth:96, padding:"11px", borderRadius:12,
                border:"1px solid rgba(34,158,217,0.35)", background:"rgba(34,158,217,0.08)",
                color:"#229ED9", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              📣 Partager
            </button>
            {/* Supprimer en dernier ; plus de bouton ✕ ici, celui du haut suffit. */}
            <button onClick={() => {
              setShowDeleteConfirm(true);
            }} style={{ flex:"1 1 0", minWidth:96, padding:"11px", borderRadius:12, border:"1px solid rgba(239,68,68,0.3)",
              background:"rgba(239,68,68,0.06)", color:"#ef4444", fontSize:13, fontWeight:700,
              cursor:"pointer" }}>🗑 Supprimer</button>
            </AdminOnly>
          </div>
        </div>
      </div>
    </div>
    {sharing && <ShareSheet kind="print" id={p.id} onClose={() => setSharing(false)}/>}
    {spoolPicker && <SpoolMapPicker usageId={spoolPicker.usageId} printId={p.id} colorHex={spoolPicker.colorHex} colorsArray={spoolPicker.colorsArray} multicolorType={spoolPicker.multicolorType} filamentType={spoolPicker.filamentType} onClose={()=>setSpoolPicker(null)} onMapped={()=>{
      // Rechargeait toute l'application (bundle re-telecharge, etat perdu).
      setSpoolPicker(null);
      client.get("/prints/" + p.id).then(r => { setP(r.data); setRefreshKey(k => k + 1); }).catch(()=>{});
      onChanged?.();
    }}/> }
    {selSpool && <FilamentSheetFromSpool filamentId={selSpool.filId} spoolId={selSpool.spoolId} filamentColorHex={selSpool.hex} onClose={()=>setSelSpool(null)} zIndex={2000}/>}
    {editMode && <PrintEditSheet p={p} onClose={()=>setEditMode(false)} onSaved={updated=>{ setP(prev=>({...prev,...updated})); setEditMode(false); onChanged?.(); }}/>}
    {unmapping && <UnmapFilamentConfirm f={unmapping} printId={p.id} onClose={()=>setUnmapping(null)} onDone={()=>{ setUnmapping(null); client.get('/prints/'+p.id).then(r=>{ setP(r.data); setRefreshKey(k=>k+1); }).catch(()=>{}); onChanged?.(); }}/>}
    {showDeleteConfirm && <DeletePrintConfirm
      p={p}
      restoreOnly={showDeleteConfirm==="restore"}
      onCancel={()=>setShowDeleteConfirm(false)}
      onConfirm={async(fracs)=>{
        // fracs = {usageId: fraction, ...}
        const hasRestore = Object.values(fracs).some(v=>v>0);
        if (hasRestore) await client.post("/prints/"+p.id+"/restore-weights", {fracs}).catch(()=>{});
        if (showDeleteConfirm !== "restore") { client.delete("/prints/"+p.id).then(()=>{ onDelete?.(p.id); onClose(); }).catch(()=>showAlert("Erreur")); }
        else { setShowDeleteConfirm(false); client.get("/prints/"+p.id).then(r=>{ setP(r.data); setRefreshKey(k=>k+1); }).catch(()=>{}); onChanged?.(); }
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
    catch(e) { showAlert("Erreur: " + (e.response?.data?.detail || e.message)); }
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
  useTrackDetail(`Fiche groupe · ${name || "#" + groupId}`);
  const [localPrints, setLocalPrints] = useState([]);
  const groupVisiting = useFriend((s) => s.friend);
  const [sharing, setSharing] = useState(false);   // partage Telegram
  const [nbItems, setNbItems]         = useState(nbItemsProp || 1);
  const [editNb, setEditNb]           = useState(false);
  const [nbVal, setNbVal]             = useState(String(nbItemsProp || 1));
  const [selectedPrint, setSelectedPrint] = useState(null);
  const [selSpoolG, setSelSpoolG] = useState(null);
  const [coverPrintId, setCoverPrintId] = useState(coverPrintIdProp||null);
  // Boutons visibles plutot qu'appui long : sur une bande qui defile, le
  // scroll natif capte le geste avant React et le menu s'ouvrait en plein
  // defilement.
  const [groupPhotoToDelete, setGroupPhotoToDelete] = useState(null);  // nom arme
  const [objCreate, setObjCreate] = useState(false);   // feuille de creation d'objets
  const [objRefresh, setObjRefresh] = useState(0);     // relecture du quota apres creation
  const setGroupCoverPhoto = async (name) => {
    try {
      await client.post(`/prints/groups/${groupId}/photo/${name}/cover`);
      setGroupCover(name); onUpdated?.();
    } catch(e){ showAlert(e.response?.data?.detail || e.message); }
  };
  const delGroupPhoto = async (name) => {
    try {
      await client.delete(`/prints/groups/${groupId}/photo/${name}`);
      setGroupPhotoToDelete(null); loadGroupPhotos();
    } catch(e){ showAlert(e.response?.data?.detail || e.message); }
  };
  const [unmappingG, setUnmappingG] = useState(null);
  const [editGroup, setEditGroup] = useState(false);
  const [groupPhotos, setGroupPhotos] = useState([]);
  const [groupLb, setGroupLb] = useState(-1);          // photo du groupe en grand (visionneuse par-dessus)
  const [groupCover, setGroupCover] = useState(null);

  const loadGroupPhotos = () => client.get(`/prints/groups/${groupId}/photos`).then(r=>{ setGroupPhotos(r.data?.files||[]); setGroupCover(r.data?.cover_photo||null); }).catch(()=>{});
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
  const totalW    = localPrints.reduce((s,p) => s + (p.total_weight_g || 0), 0);
  // Deux coûts, comme pour un print : le principal (total_cost) et celui entre
  // parenthèses (filament au tarif catalogue + électricité). On somme les prints.
  const totalCost   = localPrints.reduce((s,p) => s + (p.total_cost || 0), 0);
  const totalNormal = localPrints.reduce((s,p) =>
    s + (p.total_cost_filament_normal || 0) + (p.electric_cost || 0), 0);

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
    if (!(await showConfirm(`Supprimer le groupe "${name}" et ses ${localPrints.length} prints ?`, { danger: true, confirmLabel: "Supprimer" }))) return;
    try {
      await Promise.all(localPrints.map(p => client.delete("/prints/" + p.id)));
      onDelete?.(); onClose();
    } catch(err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };

  const handleUngroup = async () => {
    if (!(await showConfirm(`Dégrouper "${name}" (les prints resteront) ?`, { confirmLabel: "Dégrouper" }))) return;
    try {
      await client.delete("/prints/groups/" + groupId);
      onUngroup?.(); onClose();
    } catch(err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
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
                  {moneyVal(totalCost, 2)}€
                  <span style={{ fontSize:13, fontWeight:700, color:"var(--muted)", marginLeft:6 }}>
                    ({moneyVal(totalNormal, 2)}€)
                  </span>
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
                      · {moneyVal((totalCost/nbItems), 2)}€/u
                      {` (${moneyVal((totalNormal/nbItems), 2)}€/u)`}
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
                  <AdminOnly><button onClick={()=>{setNbVal(String(nbItems));setEditNb(true);}}
                    style={{ fontSize:10, padding:"2px 8px", borderRadius:6,
                      border:"1px solid rgba(34,197,94,0.3)", background:"none",
                      color:"#22c55e", cursor:"pointer" }}>Modifier</button></AdminOnly>
                )}
              </div>
            </div>
          )}

          {/* Photos du groupe */}
          {groupLb >= 0 && <Lightbox images={groupPhotos.filter(x => !isVideoUrl(x.url)).map(x => x.url)} index={groupLb}
            onClose={() => setGroupLb(-1)}/>}
          {(groupPhotos.length > 0 || true) && (
            <div style={{ marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:0 }}>
                  Photos ({groupPhotos.length})
                </p>
                <PhotoAddButton onPick={(f)=>uploadGroupPhoto(f)}/>
              </div>
              {groupPhotos.length > 0 && (
                <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4,
                  touchAction:"pan-x", overscrollBehaviorX:"contain" }}>
                  {groupPhotos.map((ph,i)=>{
                    const isCover = groupCover === ph.name;
                    const armed   = groupPhotoToDelete === ph.name;
                    return (
                    <div key={i} style={{ position:"relative", flexShrink:0, borderRadius:8,
                        border: isCover ? "2px solid #22c55e" : "1px solid var(--border)" }}>
                      {/* Aucun handler tactile : le defilement reste natif. */}
                      {isVideoUrl(ph.url) ? (
                        <video src={ph.url} muted loop autoPlay playsInline preload="metadata"
                          style={{ height:80, width:80, objectFit:"cover", display:"block", borderRadius:6 }}/>
                      ) : (
                        <img src={ph.url} alt="" onClick={() => setGroupLb(groupPhotos.filter(x => !isVideoUrl(x.url)).findIndex(x => x.url === ph.url))}
                          style={{ height:80, width:80, objectFit:"cover", display:"block", borderRadius:6, cursor:"zoom-in" }}/>
                      )}
                      <AdminOnly>
                        {/* Etoile a gauche, doree sur la vignette actuelle et
                            grise sur les autres : l'etat se lit sans chercher. */}
                        <button onClick={()=> !isCover && setGroupCoverPhoto(ph.name)}
                          title={isCover ? "Vignette de la galerie" : "Définir comme vignette"}
                          style={{ position:"absolute", top:2, left:2,
                            width:20, height:20, borderRadius:"50%", border:"none",
                            cursor: isCover ? "default" : "pointer",
                            background:"rgba(0,0,0,0.6)", fontSize:10, lineHeight:1,
                            display:"flex", alignItems:"center", justifyContent:"center",
                            filter: isCover ? "none" : "grayscale(1)", opacity: isCover ? 1 : 0.75 }}>⭐</button>
                      </AdminOnly>
                      <AdminOnly>
                        <div style={{ position:"absolute", top:2, right:2 }}>
                          <button onClick={()=> armed ? delGroupPhoto(ph.name) : setGroupPhotoToDelete(ph.name)}
                            onBlur={()=>setGroupPhotoToDelete(null)}
                            title={armed ? "Confirmer la suppression" : "Supprimer"}
                            style={{ height:20, width: armed ? "auto" : 20, padding: armed ? "0 6px" : 0,
                              borderRadius: armed ? 10 : "50%", border:"none", cursor:"pointer",
                              background: armed ? "#ef4444" : "rgba(0,0,0,0.6)", color:"white",
                              fontSize: armed ? 9 : 10, fontWeight:600, lineHeight:1,
                              display:"flex", alignItems:"center", justifyContent:"center" }}>
                            {armed ? "Supprimer ?" : "🗑"}</button>
                        </div>
                      </AdminOnly>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <GroupToRate name={name} enabled={!groupVisiting}
            designs={localPrints.filter(pr => pr.status === "SUCCESS" || pr.status === "PARTIAL").map(pr => String(pr.design_id || "").trim()).filter(Boolean)}/>

          {/* Modele(s) MakerWorld du groupe : normalement un seul, ses prints
              etant des plateaux du meme modele ; s'il y en a plusieurs, le
              plus imprime d'abord. */}
          {(() => {
            const cpt = {};
            localPrints.forEach(pr => { const d = String(pr.design_id || "").trim();
              if (d && d !== "0") cpt[d] = (cpt[d] || 0) + 1; });
            const ds = Object.keys(cpt).sort((a, b) => cpt[b] - cpt[a]);
            return ds.map(d => (
              <MakerWorldCard key={d} designId={d}
                prints={localPrints.filter(pr => String(pr.design_id || "").trim() === d)}
                note={ds.length > 1 || cpt[d] < localPrints.length
                  ? `${cpt[d]} print${cpt[d] > 1 ? "s" : ""} sur ${localPrints.length} de ce modèle` : null}/>
            ));
          })()}

          {/* Filaments agrégés — accordéon */}
          {filaments.length > 0 && <FilamentAccordion filaments={filaments} onSpoolClick={setSelSpoolG} onUnmap={setUnmappingG}/>}

          {/* Prints en tuiles */}
          <AdminOnly>
            <ObjectQuotaButton parentType="group" parentId={groupId}
              label="depuis ce groupe" refreshKey={objRefresh}
              onOpen={() => setObjCreate(true)}/>
          </AdminOnly>
          {objCreate && (
            <ObjectCreateSheet parentType="group" parentId={groupId}
              defaultName={name} costFabrication={totalCost / nbItems}
              onDone={() => { setObjRefresh(k=>k+1); onUpdated?.(); }}
              onClose={() => setObjCreate(false)}/>
          )}

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
                <AdminOnly><button onClick={async e=>{ e.stopPropagation();
                  if(!(await showConfirm(`Retirer "${p.file_name||"ce print"}" du groupe ?`))) return;
                  try { await client.post("/prints/"+p.id+"/group", {}); setLocalPrints(ps=>ps.filter(x=>x.id!==p.id)); } catch{}
                }} style={{ position:"absolute", top:4, right:4, zIndex:2, width:20, height:20,
                  borderRadius:"50%", background:"rgba(0,0,0,0.55)", border:"none",
                  cursor:"pointer", color:"white", fontSize:11,
                  display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button></AdminOnly>
                {/* Bouton étoile = définir comme référence visuelle */}
                <AdminOnly fallback={coverPrintId===p.id ? (
                  <span title="Référence visuelle" style={{ position:"absolute", top:4, left:4, zIndex:2,
                    width:20, height:20, borderRadius:"50%", background:"#f59e0b", color:"white",
                    fontSize:11, display:"flex", alignItems:"center", justifyContent:"center" }}>★</span>
                ) : null}>
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
                </button></AdminOnly>
                <div onClick={()=>setSelectedPrint(p)} style={{ cursor:"pointer" }}>
                <div style={{ position:"relative", paddingTop:"75%", background:"var(--surface2)" }}>
                  <img src={apiUrl("/prints/"+p.id+"/image")} alt="" style={{
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

          {/* Actions : une rangee sur ordinateur, deux de deux sur telephone
              (minWidth 140). Supprimer en dernier ; plus de bouton ✕ ici, celui
              du haut suffit. */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            <AdminOnly>
            <button onClick={()=>setEditGroup(true)}
              style={{ flex:"1 1 0", minWidth:140, padding:"10px", borderRadius:12, border:"1px solid var(--border)",
                background:"var(--surface2)", color:"var(--text)", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              ✏️ Éditer
            </button>
            <button onClick={handleUngroup}
              style={{ flex:"1 1 0", minWidth:140, padding:"10px", borderRadius:12,
                border:"1px solid rgba(167,139,250,0.3)", background:"rgba(167,139,250,0.06)",
                color:"#a78bfa", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              📤 Dégrouper
            </button>
            <button onClick={() => setSharing(true)} title="Partager sur Telegram"
              style={{ flex:"1 1 0", minWidth:140, padding:"10px", borderRadius:12,
                border:"1px solid rgba(34,158,217,0.35)", background:"rgba(34,158,217,0.08)",
                color:"#229ED9", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              📣 Partager
            </button>
            <button onClick={handleDelete}
              style={{ flex:"1 1 0", minWidth:140, padding:"10px", borderRadius:12,
                border:"1px solid rgba(239,68,68,0.3)", background:"rgba(239,68,68,0.06)",
                color:"#ef4444", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              🗑 Supprimer
            </button>
            </AdminOnly>
          </div>
        </div>
      </div>
    </div>
    {sharing && <ShareSheet kind="group" id={groupId} onClose={() => setSharing(false)}/>}
    {unmappingG && <UnmapFilamentConfirm f={unmappingG} printId={unmappingG.print_id} onClose={()=>setUnmappingG(null)} onDone={()=>{ setUnmappingG(null); onUpdated?.(); }}/>}
    {/* Ancien PhotoDeleteConfirm retire : il coexistait avec la confirmation en
        deux temps sur la pastille (plus haut) et se declenchait en meme temps.
        Il lisait groupPhotoToDelete.name en attendant un objet, alors que la
        pastille y stocke une chaine (ph.name) -> .name valait undefined ->
        DELETE .../photo/undefined -> 404 silencieux. C'est ce qui faisait que
        la popup confirmait mais que rien n'etait supprime. */}
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

function GroupTile({ groupId, name, prints, latestDate, number_of_items, duration_seconds, cover_print_id, onSelectPrint, onDelete, onUngroup,
                    selectMode, selected, onToggleSelect, onLongPress }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Appui long : passe en selection avec ce groupe coche (meme geste que sur
  // une carte de print) ; en selection, un appui coche / decoche.
  const isAdmin = useIsAdmin();
  const [mw, setMw] = useState(null);
  const designs = [...new Set(prints.map(pr => String(pr.design_id || "").trim()).filter(Boolean))];
  const tileVisiting = useFriend((s) => s.friend);
  const toRateSet = useToRateSet(!tileVisiting && designs.length > 0);
  const nToRate = designs.filter(d => toRateSet.has(d)).length;
  const ungroup = async () => {
    if (!(await showConfirm(`Dégrouper "${name}" (les prints resteront) ?`, { confirmLabel: "Dégrouper" }))) return;
    try { await client.delete(`/prints/groups/${groupId}`); onUngroup?.(); }
    catch (e) { showAlert("Erreur: " + (e.response?.data?.detail || e.message)); }
  };
  const [press, guard] = useLongPress(e => openMenu(e, {
    title: name, subtitle: `${prints.length} prints · ${fmtDate(latestDate)}`,
    items: [
      { icon: "📄", label: "Ouvrir le groupe", onClick: () => setSheetOpen(true) },
      onLongPress && { icon: "☑", label: "Sélectionner", hint: "Pour fusionner ou supprimer plusieurs groupes", onClick: () => onLongPress(groupId) },
      designs.length === 1 && { icon: "🌐", label: "Modèle MakerWorld", onClick: () => setMw(designs[0]) },
      isAdmin && "-",
      isAdmin && { icon: "⛓", label: "Dégrouper…", hint: "Les prints restent", onClick: ungroup },
    ],
  }), { disabled: selectMode, onTouch: onLongPress ? () => onLongPress(groupId) : null });
  const handleClick = guard(() => {
    if (selectMode && onToggleSelect) onToggleSelect(groupId); else setSheetOpen(true);
  });
  // Mosaique des prints du groupe, le print de couverture en tete. Une seule
  // vignette ne montrait qu'une piece sur N et ne laissait pas deviner ce que
  // le groupe contient -- c'est pourtant la question qu'on se pose en
  // parcourant l'historique.
  const mosaicUrls = React.useMemo(() => {
    const ids = prints.map(pr => pr.id).filter(Boolean);
    const i = cover_print_id ? ids.indexOf(cover_print_id) : -1;
    const ordered = i > 0 ? [ids[i], ...ids.slice(0, i), ...ids.slice(i + 1)] : ids;
    return ordered.map(id => apiUrl(`/prints/${id}/image`));
  }, [prints, cover_print_id]);

  // Seul "en cours" est remonte sur la carte du groupe : un echec ou un partiel
  // isole ne doit pas faire paraitre en echec un groupe globalement reussi ;
  // en revanche un print encore en cours merite d'etre visible sans ouvrir.
  const inProgress = React.useMemo(
    () => prints.some(pr => pr.status === "IN_PROGRESS"), [prints]);
  const aggCfg = inProgress ? STATUS_CFG.IN_PROGRESS : null;
  const AggIcon = aggCfg?.icon;

  return (
    <>
      <div className="card" onClick={handleClick} {...press}
        style={{ overflow:"hidden", display:"flex", flexDirection:"column",
          position:"relative", padding:0, cursor:"pointer",
          outline: selected ? "2px solid #3b82f6" : "none",
          userSelect:"none", WebkitUserSelect:"none", WebkitTouchCallout:"none", touchAction:"manipulation" }}>
        <div style={{ position:"relative", paddingTop:"75%",
          background:"var(--surface2)", overflow:"hidden" }}>
          <div style={{ position:"absolute", inset:0 }}>
            <GroupMosaic photos={mosaicUrls} title={name}/>
          </div>
          <div style={{ position:"absolute", inset:0, background:"rgba(124,58,237,0.08)" }}/>
          <span style={{ position:"absolute", top:6, left:6,
            background:"rgba(124,58,237,0.85)", color:"white",
            fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>
            📁 {prints.length} print{prints.length>1?"s":""}
          </span>
          {selectMode && (
            <div style={{ position:"absolute", top:6, right:6, width:22, height:22, borderRadius:"50%",
              display:"flex", alignItems:"center", justifyContent:"center", zIndex:2,
              border: selected ? "none" : "1.5px solid rgba(255,255,255,0.8)",
              background: selected ? "#3b82f6" : "rgba(0,0,0,0.4)" }}>
              {selected && <Check size={13} color="white" strokeWidth={3}/>}
            </div>
          )}
          {!selectMode && number_of_items > 1 && (
            <span style={{ position:"absolute", top:6, right:6,
              background:"rgba(59,130,246,0.85)", color:"white",
              fontSize:9, fontWeight:800, padding:"2px 7px", borderRadius:20 }}>
              ×{number_of_items}
            </span>
          )}
          {nToRate > 0 && !selectMode && (
            <span title={`${nToRate} modèle${nToRate > 1 ? "s" : ""} à évaluer`} style={{ position:"absolute", bottom:6, right:6,
              background:"rgba(245,158,11,0.92)", color:"white", fontSize:9, fontWeight:800, padding:"2px 7px", borderRadius:20 }}>
              ⭐ {nToRate > 1 ? `${nToRate} à évaluer` : "À évaluer"}</span>
          )}
          {aggCfg && (
            <span style={{ position:"absolute", bottom:6, left:6, display:"inline-flex",
              alignItems:"center", gap:4, background:aggCfg.bg, color:"white",
              fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>
              <AggIcon size={9}/> {aggCfg.label}
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
      {mw && <MakerWorldModelSheet designId={mw} onClose={() => setMw(null)}/>}
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
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
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

function PrintCard({ p, onClick, onDelete, onChanged, selectMode, selected, onToggleSelect, onLongPress }) {
  const statusCfg = STATUS_CFG[p.status] || { bg:"rgba(0,0,0,0.5)", color:"white", label: p.status || "?" };
  const visiting = useFriend((s) => s.friend);
  const toRate = useToRateSet(!visiting && !!p.design_id);
  const isAdmin = useIsAdmin();
  const [full, setFull] = useState(null);           // { mode: "edit" | "delete", p } : fiche complete lue a la demande
  const [mw, setMw] = useState(false);
  const loadFull = mode => client.get("/prints/" + p.id).then(r => setFull({ mode, p: r.data }))
    .catch(e => showAlert("Erreur: " + (e.response?.data?.detail || e.message)));
  // Appui long au doigt : selection (grouper, supprimer...) ; clic droit : menu du print.
  const [press, guard] = useLongPress(e => openMenu(e, {
    title: p.file_name || "Sans nom", subtitle: fmtDate(p.print_date),
    items: [
      { icon: "📄", label: "Ouvrir", onClick },
      onLongPress && { icon: "☑", label: "Sélectionner", hint: "Pour grouper ou supprimer plusieurs prints", onClick: () => onLongPress(p.id) },
      p.design_id && { icon: "🌐", label: "Modèle MakerWorld", onClick: () => setMw(true) },
      isAdmin && "-",
      isAdmin && { icon: "✏️", label: "Modifier", onClick: () => loadFull("edit") },
      isAdmin && { icon: "🗑", label: "Supprimer…", danger: true, onClick: () => loadFull("delete") },
    ],
  }), { disabled: selectMode, onTouch: onLongPress ? () => onLongPress(p.id) : null });
  const handleClick = guard(() => { if (selectMode) onToggleSelect(p.id); else onClick(); });

  return (<>
    <div className="card" onClick={handleClick} {...press}
      style={{ overflow:"hidden", display:"flex",
      flexDirection:"column", position:"relative", padding:0, cursor:"pointer",
      outline: selected ? "2px solid #3b82f6" : "none",
      userSelect:"none", WebkitUserSelect:"none", WebkitTouchCallout:"none", touchAction:"manipulation" }}>

      {/* Vignette pleine largeur ratio 4/3 */}
      <div style={{ position:"relative", paddingTop:"75%",
        background:"var(--surface2)", overflow:"hidden" }}>
        <img src={apiUrl("/prints/" + p.id + "/image")} alt="" draggable={false}
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
        {/* Modele MakerWorld imprime mais pas encore evalue */}
        {p.status === "SUCCESS" && p.design_id && toRate.has(String(p.design_id)) && (
          <span title="À évaluer sur MakerWorld" style={{ position:"absolute", bottom:6, right:6, fontSize:11,
            background:"rgba(0,0,0,0.55)", borderRadius:20, padding:"1px 6px", lineHeight:1.5 }}>⭐</span>
        )}
        {/* Pastilles filament */}
        {p.filament_usage?.length > 0 && (
          <div style={{ position:"absolute", bottom:6, left:6, display:"flex", gap:3 }}>
            {p.filament_usage.map((f,i) => (
              <ColorDot key={i} hex={f.color_hex} colors={f.filament_colors_array}
                multicolor={f.filament_multicolor_type} size={12} ring="none"
                style={{ boxShadow:"0 0 0 1.5px rgba(255,255,255,0.8), 0 1px 3px rgba(0,0,0,0.3)" }}/>
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
          {/* Repli sur estimated_seconds, comme la fiche : sans ca, un print dont
              la duree REELLE n'a pas ete captee (coupure MQTT, import) mais qui a
              une estimation 3MF n'affichait rien sur la tuile alors que sa fiche,
              elle, montrait la duree. */}
          {(p.duration_seconds || p.estimated_seconds) > 0 &&
            <span style={{ fontSize:10, color:"var(--muted)" }}>{fmtDur(p.duration_seconds || p.estimated_seconds)}</span>}
        </div>
      </div>
    </div>
    {mw && <MakerWorldModelSheet designId={String(p.design_id)} onClose={() => setMw(false)}/>}
    {full?.mode === "edit" && <PrintEditSheet p={full.p} onClose={() => setFull(null)}
      onSaved={() => { setFull(null); onChanged?.(); }}/>}
    {full?.mode === "delete" && <DeletePrintConfirm p={full.p} onCancel={() => setFull(null)}
      onConfirm={async fracs => {
        if (Object.values(fracs).some(v => v > 0)) await client.post("/prints/" + p.id + "/restore-weights", { fracs }).catch(() => {});
        client.delete("/prints/" + p.id).then(() => { setFull(null); onDelete?.(p.id); }).catch(() => showAlert("Erreur"));
      }}/>}
  </>);
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

const isVideoUrl = (u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u || "");

function SnapshotGallery({ snaps, printId, onDelete, onUpload, userPhotos = [], onDeleteUpload,
                           onCountChange, coverPhoto, onCoverChange }) {
  const [lightbox, setLightbox] = useState(null);
  const [diskFiles, setDiskFiles] = useState([]);
  const [photoToDelete, setPhotoToDelete] = useState(null);
  const [deletedNames, setDeletedNames] = useState(new Set());
  const isAdmin = useIsAdmin();

  // Plus d'appui long : sur une bande qui defile horizontalement, le scroll
  // natif capte le geste avant React et le menu s'ouvrait en plein
  // defilement. Deux boutons visibles sur chaque vignette a la place.
  const [confirmDelPhoto, setConfirmDelPhoto] = useState(null);  // url armee

  const setAsCover = async (name) => {
    if (!name) return;
    try {
      await client.post(`/prints/${printId}/photo/${name}/primary`);
      onCoverChange?.(name);
    } catch (e) { showAlert("Erreur : " + (e.response?.data?.detail || e.message)); }
  };

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
    } catch(err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
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
        url: apiUrl("/prints/" + printId + "/snapshot/" + s.trigger),
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

  const Row = ({ title, items, startIdx = 0, onAdd, onDeleteItem, canCover = false }) => {
    const scrollRef = React.useRef(null);
    if (!items.length && !onAdd) return null;
    const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 120, behavior: "smooth" });
    return (
      <div style={{ marginBottom:12 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <p style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.05em", margin:0 }}>
              {title} ({items.length})
            </p>
            {onAdd && (
              <PhotoAddButton onPick={(f)=>onAdd(f)}/>
            )}
          </div>
          {items.length > 2 && (
            <div style={{ display:"flex", gap:4 }}>
              <button onClick={()=>scroll(-1)} style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"50%", width:22, height:22, cursor:"pointer", fontSize:14, color:"var(--text)", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
              <button onClick={()=>scroll(1)}  style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"50%", width:22, height:22, cursor:"pointer", fontSize:14, color:"var(--text)", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
            </div>
          )}
        </div>
        {/* touchAction pan-x : cette bande ne repond qu'au glissement
            horizontal, le composant vertical du geste n'est plus consomme ici
            et ne declenche donc plus le tirer-pour-rafraichir. */}
        <div ref={scrollRef} style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:6,
          scrollbarWidth:"none", touchAction:"pan-x", overscrollBehaviorX:"contain" }}>
          {items.map((item, i) => {
            const isCover = item.name && item.name === coverPhoto;
            const armed   = confirmDelPhoto === item.url;
            return (
            <div key={i} style={{ position:"relative", flexShrink:0 }}>
              {/* Aucun handler tactile ici : le defilement reste 100% natif. */}
              <div onClick={() => setLightbox(flatItems[startIdx + i])}
                style={{ cursor:"pointer" }}>
                {isVideoUrl(item.url) ? (
                  <video src={item.url} muted loop autoPlay playsInline preload="metadata"
                    style={{ height:110, width:"auto", borderRadius:8, objectFit:"cover",
                      border: isCover ? "2px solid #22c55e" : "1px solid var(--border)", display:"block" }}/>
                ) : (
                  <img src={item.url} alt={item.label}
                    style={{ height:110, width:"auto", borderRadius:8, objectFit:"cover",
                      border: isCover ? "2px solid #22c55e" : "1px solid var(--border)",
                      display:"block" }}
                    onError={e => { e.currentTarget.style.display="none"; }}/>
                )}
              </div>
              <span style={{ position:"absolute", bottom:4, left:4,
                background:"rgba(0,0,0,0.65)", color:"white",
                fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:4,
                pointerEvents:"none" }}>
                {item.label}
              </span>
              {/* Etoile a gauche, doree si principale et grise sinon. Reservee
                  aux vraies photos : les milestones sont des captures
                  automatiques, pas des cliches a mettre en avant. */}
              {isAdmin && canCover && item.name && (
                <button onClick={()=> !isCover && setAsCover(item.name)}
                  title={isCover ? "Photo principale" : "Définir comme photo principale"}
                  style={{ position:"absolute", top:4, left:4,
                    width:22, height:22, borderRadius:"50%", border:"none",
                    cursor: isCover ? "default" : "pointer",
                    background:"rgba(0,0,0,0.6)", fontSize:11, lineHeight:1,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    filter: isCover ? "none" : "grayscale(1)", opacity: isCover ? 1 : 0.75 }}>⭐</button>
              )}
              {!isAdmin && isCover && (
                <span style={{ position:"absolute", top:4, left:4, fontSize:11,
                  pointerEvents:"none" }}>⭐</span>
              )}
              {isAdmin && (
                <div style={{ position:"absolute", top:4, right:4 }}>
                  <button
                    onClick={() => {
                      if (!armed) { setConfirmDelPhoto(item.url); return; }
                      setConfirmDelPhoto(null);
                      if (item.snap) handleDelete({ stopPropagation(){} }, item.snap);
                      else { setDeletedNames(prev=>new Set([...prev,item.name])); onDeleteUpload?.(item.name); }
                    }}
                    onBlur={()=>setConfirmDelPhoto(null)}
                    title={armed ? "Confirmer la suppression" : "Supprimer"}
                    style={{ height:22, width: armed ? "auto" : 22, padding: armed ? "0 7px" : 0,
                      borderRadius: armed ? 11 : "50%", border:"none", cursor:"pointer",
                      background: armed ? "#ef4444" : "rgba(0,0,0,0.6)", color:"white",
                      fontSize: armed ? 9 : 11, fontWeight:600, lineHeight:1,
                      display:"flex", alignItems:"center", justifyContent:"center" }}>
                    {armed ? "Supprimer ?" : "🗑"}</button>
                </div>
              )}
            </div>
            );
          })}
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
      <Row title="Photos" items={photoItems} startIdx={0} canCover
        onAdd={async(f)=>{ await onUpload?.(f); reloadDiskFiles(); }} onDeleteItem={onDeleteUpload}/>
      <Row title="Milestones" items={milestoneItems} startIdx={photoItems.length}/>
      {/* Hors de la fiche (portail) : dans le panneau qui defile, la visionneuse
          restait coincee a l'interieur au lieu de couvrir l'ecran. */}
      {lightbox && createPortal(
        <div data-no-pull="" onClick={() => setLightbox(null)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:6000,
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
            {isVideoUrl(lightbox.url) ? (
              <video src={lightbox.url} controls autoPlay playsInline
                style={{ maxWidth:"80vw", maxHeight:"80vh", borderRadius:12 }}/>
            ) : (
              <img src={lightbox.url} alt={lightbox.label}
                style={{ maxWidth:"80vw", maxHeight:"80vh", borderRadius:12, objectFit:"contain" }}/>
            )}
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
        </div>, document.body
      )}
    {photoToDelete && <PhotoDeleteConfirm
      label={photoToDelete.label||photoToDelete.name}
      onCancel={()=>setPhotoToDelete(null)}
      onConfirm={()=>{ setDeletedNames(prev=>new Set([...prev,photoToDelete.name])); onDeleteUpload&&onDeleteUpload(photoToDelete.name); setPhotoToDelete(null); }}/> }
    </>
  );
}



// Galerie : la mienne, ou celles de mes copains reunies (onglet a part, en
// lecture seule : on regarde leurs photos, rien ne se melange a la mienne).
// Recherche dans la galerie des copains : titre ou nom du copain.
const friendMatch = (it, q) => `${it.kind === "group" ? it.name : (it.title || it.file_name) || ""} ${it.friend_name || ""}`
  .toLowerCase().includes(q);

function PrintsGalleryView({ search, sortF = "recent" }) {
  const hasFriends = useHasFriends();
  const [who, setWho] = useState("mine");          // mine | friends
  // Lue des l'ouverture (gardee 5 min) : le nombre d'elements suit la recherche.
  const fdata = useShared("/friends/shared/gallery", hasFriends);
  const q = (search || "").trim().toLowerCase();
  const nFr = fdata?.items ? (q ? fdata.items.filter(it => friendMatch(it, q)).length : fdata.items.length) : null;
  // Ma galerie, lue ici pour compter aussi ses elements selon la recherche.
  const [mine, setMine] = useState(null);
  const [mineLoading, setMineLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    client.get("/prints/gallery")
      .then(r => { if (!cancelled) setMine(r.data); })
      .finally(() => { if (!cancelled) setMineLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const nMine = mine ? [...(mine.prints || []).map(p => p.title || p.file_name), ...(mine.groups || []).map(g => g.name)]
    .filter(t => !q || (t || "").toLowerCase().includes(q)).length : null;
  return (<>
    {hasFriends && (
      <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:12, padding:4,
        border:"1px solid var(--border)", marginBottom:10 }}>
        {[["mine", `Ma galerie${nMine != null ? ` (${nMine})` : ""}`], ["friends", `👀 Chez les copains${nFr != null ? ` (${nFr})` : ""}`]].map(([k, l]) => (
          <button key={k} onClick={() => setWho(k)} style={{ flex:1, padding:"7px 8px", borderRadius:8, fontSize:12,
            fontWeight:700, cursor:"pointer", border:"none", background: who === k ? "#3b82f6" : "transparent",
            color: who === k ? "white" : "var(--muted)" }}>{l}</button>
        ))}
      </div>
    )}
    {who === "friends" && hasFriends ? <FriendsGalleryView search={search} data={fdata}/> : <MyGalleryView search={search} sortF={sortF} data={mine} loading={mineLoading}/>}
  </>);
}

function FriendsGalleryView({ search, data }) {
  if (!data) return <p style={{ textAlign:"center", color:"var(--muted)", padding:"40px 0" }}>Je demande à tes copains…</p>;
  if (data.error) return <p style={{ textAlign:"center", color:"#ef4444", padding:"40px 0" }}>⚠ {data.error}</p>;
  let items = data.items.map(it => ({ ...it, title: it.kind === "group" ? it.name : (it.title || it.file_name),
    photos: (it.photos || []).map(ph => ({ ...ph, url: relayed(ph.url) })) }));
  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    items = items.filter(it => friendMatch(it, q));
  }
  const off = (data.friends || []).filter(f => f.status !== "ok");
  return (<>
    {off.length > 0 && (
      <p style={{ fontSize:11.5, color:"var(--muted)", margin:"0 0 8px" }}>
        Pas joignable pour l'instant : {off.map(f => f.name).join(", ")}</p>
    )}
    <GalleryCompare
      items={items}
      getId={it => `${it.friend_id}-${it.kind}-${it.id}`}
      getCoverImage={it => it.photos?.[0]?.url || null}
      getPhotos={it => it.photos || []}
      getTitle={it => it.title || "Sans nom"}
      getSubtitle={it => `👀 ${it.friend_name}${it.kind === "group" ? ` · 📁 ${it.prints} prints` : it.print_date ? ` · ${fmtDate(it.print_date)}` : ""}`}
      renderCover={it => <GroupMosaic photos={it.photos} title={it.title} cover={it.kind === "group" ? it.cover_photo : null}/>}
      emptyLabel="Aucune photo chez tes copains"
      compareFields={[
        ["Chez", it => it.friend_name],
        ["Durée", it => fmtDur(it.duration_seconds)],
        ["Poids", it => it.total_weight_g ? `${it.total_weight_g.toFixed(0)}g` : null],
      ]}
    />
  </>);
}

function MyGalleryView({ search, sortF = "recent", data, loading }) {
  const [selectedPrint, setSelectedPrint] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);

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
      /* Mosaique pour les groupes ET les prints : un print porte lui aussi
         plusieurs photos (captures d'impression et cliches ajoutes), et n'en
         montrer qu'une revenait a cacher le reste. Pour un print, le serveur
         trie deja ses photos couverture en tete : la case dominante est donc
         la bonne sans avoir a lui passer cover_photo. */
      renderCover={it => (
        <GroupMosaic photos={it.photos} title={it.title}
          cover={it.kind === "group" ? it.cover_photo : null}/>
      )}
      emptyLabel="Aucune photo disponible"
      onItemClick={it => {
        if (it.kind==="group") setSelectedGroup(it);
        else setSelectedPrint(it);
      }}

      compareFields={[
        ["Coût",   it => it.total_cost ? `${moneyVal(it.total_cost, 2)}€` : null],
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

// Nombre de CARTES affichees pour un lot de prints : un print solo = 1 carte, un
// groupe = 1 carte quel que soit son nombre de prints. Sert a paginer par
// elements affiches et non par prints bruts (un lot de 40 prints peut ne donner
// que quelques cartes si de gros groupes s'y trouvent).
function countDisplayItems(list) {
  const groups = new Set();
  const seen = new Set();
  let solo = 0;
  for (const p of (list || [])) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.group_id) groups.add(p.group_id);
    else solo++;
  }
  return solo + groups.size;
}

export default function Prints() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [prints, setPrints]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset]   = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [kpis, setKpis] = useState(null);

  // Lien direct /prints?id=XXX (points d'attention, favoris…). On interroge l'API
  // plutot que la liste chargee : le print peut etre hors de la page courante ou
  // exclu par les filtres.
  const deepId = searchParams.get("id");
  useEffect(() => {
    if (!deepId) return;
    client.get(`/prints/${deepId}`)
      .then(r => setSelected(r.data))
      .catch(() => {});
  }, [deepId]);

  const closeDeep = () => {
    if (!searchParams.get("id")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("id");
    setSearchParams(next, { replace: true });
  };
  const sentinelRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const printsRef = useRef([]);
  printsRef.current = prints;
  const [search, setSearch]   = useState("");
  // Texte reellement envoye au serveur : 300 ms apres la derniere frappe. Une
  // requete par lettre, sans garde, laissait la reponse d'une frappe ancienne
  // (« p », lente car large) arriver apres la bonne et l'ecraser -- le champ
  // disait une chose, la liste en montrait une autre.
  const [searchQ, setSearchQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  // Numero de la derniere demande de liste / de totaux : une reponse qui
  // n'est plus la derniere est ignoree.
  const loadGen = useRef(0);
  const kpiGen = useRef(0);
  const [statusF, setStatusF] = useState("");
  const [selected, setSelected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError]     = useState(null);
  const [groups, setGroups]   = useState([]);
  const [groupF, setGroupF]   = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [materialF, setMaterialF] = useState("");
  const [filaTypeF, setFilaTypeF] = useState("");
  const [filamentIdF, setFilamentIdF] = useState("");
  const [colorF, setColorF] = useState("");
  const [dateFrom, setDateFrom] = useState("");  // borne debut plage temporelle
  const [dateTo, setDateTo] = useState("");      // borne fin (incluse)
  const [colorBuckets, setColorBuckets] = useState([]);
  const [allFilaments, setAllFilaments] = useState([]);
  const [allMaterials, setAllMaterials] = useState([]);
  const [allFilaTypes, setAllFilaTypes] = useState([]);
  const [filSearch, setFilSearch] = useState("");
  const [sortF, setSortF]     = useState("recent");
  const [viewMode, setViewMode] = useUrlTab("tab", "list", ["list", "gallery", "makerworld", "queue"]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  // Groupes selectionnes (appui long sur une tuile de groupe), dans l'ordre de
  // selection : le premier est celui qui reste, sauf choix contraire.
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);  // 1er clic -> confirme
  const [deleting, setDeleting] = useState(false);

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroup = (g) => setSelectedGroups(prev =>
    prev.some(x => x.groupId === g.groupId) ? prev.filter(x => x.groupId !== g.groupId) : [...prev, g]);
  // Association a un modele MakerWorld (lancee depuis sa fiche) : la liste
  // passe en selection, la bulle du bas rappelle le modele et valide.
  const assign = useMwAssign((s) => s.item);
  const clearAssign = useMwAssign((s) => s.clear);
  const [assignBusy, setAssignBusy] = useState(false);
  useEffect(() => {
    if (!assign) return;
    setViewMode("list"); setSelectMode(true); setSelectedIds(new Set()); setSelectedGroups([]);
  }, [assign]);
  const cancelAssign = () => { clearAssign(); setSelectMode(false); setSelectedIds(new Set()); setSelectedGroups([]); };
  const applyAssign = async () => {
    const n = selectedIds.size + selectedGroups.reduce((s, g) => s + (g.prints?.length || 0), 0);
    if (!await showConfirm(`Associer « ${assign.title_fr || assign.title || "ce modèle"} » à ${n} impression${n > 1 ? "s" : ""} ?`
      + (selectedGroups.length ? "\nLes groupes choisis sont associés en entier." : ""), { confirmLabel:"Associer" })) return;
    setAssignBusy(true);
    try {
      const { data } = await client.post("/prints/makerworld/assign", { design_id: assign.design_id,
        print_ids: [...selectedIds], group_ids: selectedGroups.map(g => g.groupId) });
      toast(`Modèle associé à ${data.count} impression${data.count > 1 ? "s" : ""}`, "success");
      cancelAssign(); load();
    } catch (e) { toast(e.response?.data?.detail || e.message, "error"); }
    setAssignBusy(false);
  };

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); setSelectedGroups([]); setConfirmDelete(false); setMergeOpen(false); };

  // Suppression des prints selectionnes (pas d'endpoint bulk -> un par un, comme
  // ailleurs dans le code). Confirmation a deux temps dans la barre.
  const deleteSelected = async () => {
    setDeleting(true);
    try {
      await Promise.all(Array.from(selectedIds).map(id => client.delete("/prints/" + id)));
      exitSelectMode();
      await Promise.all([load(), loadGroups()]);
    } catch (err) {
      showAlert("Erreur: " + (err.response?.data?.detail || err.message));
    } finally { setDeleting(false); }
  };

  const LIMIT = 40;
  const CARDS_PER_LOAD = 20;   // cartes AFFICHEES visees par chargement (solos + groupes)

  const loadKpis = useCallback(async () => {
    const gen = ++kpiGen.current;
    const p = new URLSearchParams();
    if (searchQ)     p.set("search", searchQ);
    if (statusF)     p.set("status", statusF);
    if (groupF)      p.set("group_id", groupF);
    if (materialF)   p.set("material", materialF);
    if (filaTypeF)   p.set("fila_type", filaTypeF);
    if (filamentIdF) p.set("filament_id", filamentIdF);
    if (colorF)      p.set("color", colorF);
    if (dateFrom)    p.set("date_from", dateFrom);
    if (dateTo)      p.set("date_to", dateTo);
    try {
      const { data } = await client.get("/prints/kpis?" + p);
      if (gen === kpiGen.current) setKpis(data);
    } catch {}
  }, [searchQ, statusF, groupF, materialF, filaTypeF, filamentIdF, colorF, dateFrom, dateTo]);

  useEffect(() => { loadKpis(); }, [loadKpis]);

  // Charger la palette de teintes (n'affiche que celles réellement utilisées)
  useEffect(() => {
    client.get("/filaments/color-buckets")
      .then(r => setColorBuckets((r.data||[]).filter(b => b.count > 0)))
      .catch(()=>{});
  }, []);

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
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    setOffset(0);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: 0 });
      if (searchQ)     params.set("search", searchQ);
      if (statusF)     params.set("status", statusF);
      if (groupF)      params.set("group_id", groupF);
      if (materialF)   params.set("material", materialF);
      if (filaTypeF)   params.set("fila_type", filaTypeF);
      if (filamentIdF) params.set("filament_id", filamentIdF);
      if (colorF)      params.set("color", colorF);
      if (dateFrom)    params.set("date_from", dateFrom);
      if (dateTo)      params.set("date_to", dateTo);
      if (sortF)       params.set("sort", sortF);
      const { data } = await client.get("/prints?" + params);
      if (gen !== loadGen.current) return;   // une demande plus recente est partie
      setPrints(data.prints ?? []);
      setTotal(data.total ?? 0);
      setHasMore(data.has_more ?? false);
    } catch(e) {
      if (gen !== loadGen.current) return;
      setError(e.response?.data?.detail || e.message || "Erreur");
    }
    setLoading(false);
  }, [searchQ, statusF, groupF, materialF, filaTypeF, filamentIdF, colorF, dateFrom, dateTo, sortF]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      let acc = printsRef.current.slice();
      let curOffset = offset;
      let more = true;
      const startCount = countDisplayItems(acc);
      let guard = 0;
      // On enchaine les lots de prints jusqu'a ~CARDS_PER_LOAD nouvelles CARTES
      // affichees : les prints d'un meme groupe se replient en une seule carte,
      // donc un lot de 40 prints peut n'en produire que quelques-unes. Garde-fou
      // a 12 lots pour ne jamais tourner indefiniment.
      // La suite d'une liste que la recherche a remplacee entre-temps ne doit
      // pas s'y ajouter.
      const gen = loadGen.current;
      while (more && guard < 12 && (countDisplayItems(acc) - startCount) < CARDS_PER_LOAD) {
        guard++;
        const next = curOffset + LIMIT;
        const params = new URLSearchParams({ limit: LIMIT, offset: next });
        if (searchQ)     params.set("search", searchQ);
        if (statusF)     params.set("status", statusF);
        if (groupF)      params.set("group_id", groupF);
        if (materialF)   params.set("material", materialF);
        if (filaTypeF)   params.set("fila_type", filaTypeF);
        if (filamentIdF) params.set("filament_id", filamentIdF);
        if (colorF)      params.set("color", colorF);
        if (dateFrom)    params.set("date_from", dateFrom);
        if (dateTo)      params.set("date_to", dateTo);
        if (sortF)       params.set("sort", sortF);
        const { data } = await client.get("/prints?" + params);
        if (gen !== loadGen.current) { more = false; acc = null; break; }
        const existingIds = new Set(acc.map(p => p.id));
        const fresh = (data.prints || []).filter(p => !existingIds.has(p.id));
        acc = [...acc, ...fresh];
        curOffset = next;
        more = data.has_more ?? false;
      }
      if (acc) {
        setPrints(acc);
        setOffset(curOffset);
        setHasMore(more);
      }
    } catch(e) {}
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }, [loadingMore, hasMore, offset, statusF, searchQ, groupF, materialF, filaTypeF, filamentIdF, colorF, dateFrom, dateTo, sortF]);

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

  // Le lazy load ci-dessus est piloté par le scroll : si le contenu ne déborde
  // pas de l'écran, il ne se déclenche jamais. Cas typique d'un tri par
  // coût/durée où une page entière de prints tient dans un ou deux groupes,
  // repliés en autant de cartes. On amorce donc explicitement.
  useEffect(() => {
    if (viewMode !== "list" || !hasMore || loading || loadingMore) return;
    const container = document.querySelector(".page-content");
    if (!container) return;
    if (container.scrollHeight <= container.clientHeight + 40) {
      const t = setTimeout(() => loadMore(), 80);
      return () => clearTimeout(t);
    }
  }, [prints, hasMore, loading, loadingMore, viewMode, loadMore]);

  // Chargement au defilement via une SENTINELLE (IntersectionObserver) : plus
  // fiable que le calcul de scroll manuel -- fonctionne quel que soit le
  // conteneur de defilement et se declenche meme quand le contenu remplit pile
  // l'ecran (cas desktop ou une page de gros groupes tient en un ecran). Le
  // rootMargin large precharge avant d'atteindre le bas. Se re-observe a chaque
  // ajout de cartes ; loadMore boucle jusqu'a ~CARDS_PER_LOAD nouvelles cartes.
  useEffect(() => {
    if (viewMode !== "list" || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const root = document.querySelector(".page-content") || null;
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) loadMore();
    }, { root, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, viewMode, hasMore, prints.length]);

  const loadGroups = useCallback(async () => {
    try {
      const { data } = await client.get("/prints/groups");
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
    } catch(err) { showAlert("Erreur import: " + (err.response?.data?.detail || err.message)); }
    finally { setImporting(false); e.target.value = ""; }
  };

  const STATUSES = ["","IN_PROGRESS","SUCCESS","PARTIAL","TO_REDO","FAILED"];
  const STATUS_LABELS = {"":"Tous","IN_PROGRESS":"En cours","SUCCESS":"Réussis",
    "PARTIAL":"Partiels","TO_REDO":"À refaire","FAILED":"Échoués"};

  return (
    <div style={{ maxWidth:960, margin:"0 auto", display:"flex", flexDirection:"column", gap:16 }}>

      {/* Titre */}
      <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Impressions</h1>

      {/* Tabs Liste / Galerie / MakerWorld */}
      <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:12, padding:4, border:"1px solid var(--border)" }}>
        {[["list","Liste"],["gallery","Galerie"],["makerworld","MakerWorld"],["queue","À faire"]].map(([id,label])=>(
          // comme les Stats : largeur selon le texte, qui retrecit avec l'ecran
          <button key={id} onClick={()=>setViewMode(id)} style={{
            flex:"1 1 auto", minWidth:0, padding:"8px 3px", borderRadius:8, fontWeight:600, cursor:"pointer",
            fontSize:"clamp(10px, 3.1vw, 12px)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
            background: viewMode===id ? "#3b82f6" : "transparent",
            color: viewMode===id ? "white" : "var(--muted)",
            border:"none", transition:"all 0.15s",
          }}>{label}</button>
        ))}
      </div>

      {/* Onglet MakerWorld : collections, j'aime, « deja imprime ». Un clic
          sur « imprime N fois » revient a la liste, recherche posee. */}
      {/* File : modeles des collections « a imprimer », besoins en filament, pret / stock / manque. */}
      {viewMode==="queue" && <MwQueue/>}
      {viewMode==="makerworld" && (
        <MakerWorldView onSearch={x => { setSearch(x.title || ""); setViewMode("list"); }}/>
      )}

      {/* KPIs — données complètes depuis API (pas juste les éléments chargés) */}
      {kpis && viewMode==="list" && (
        // Une seule ligne : les pastilles se partagent la largeur, et les grands
        // nombres s'arrondissent (3938 h plutot que 3938h 30min).
        <div style={{ display:"flex", gap:6 }}>
          {[
            [`${kpis.count}`, "prints", "#3b82f6"],
            kpis.duration > 0 ? [kpis.duration >= 100 * 3600 ? `${Math.round(kpis.duration / 3600)} h` : fmtDur(kpis.duration), null, "#8b5cf6"] : null,
            kpis.weight_g > 0 ? [`${(kpis.weight_g/1000).toFixed(kpis.weight_g >= 10000 ? 1 : 2).replace(".", ",")} kg`, null, "#f59e0b"] : null,
            kpis.cost > 0 ? [`${moneyVal(kpis.cost, kpis.cost >= 100 ? 0 : 2).replace(".", ",")} €`, null, "#22c55e"] : null,
          ].filter(Boolean).map(([val, label, color])=>(
            <div key={val} style={{ flex:"1 1 auto", minWidth:0, display:"flex", alignItems:"center", justifyContent:"center",
              gap:4, padding:"4px 8px", borderRadius:20, background:`${color}18`, border:`1px solid ${color}30`, whiteSpace:"nowrap" }}>
              <span style={{ fontSize:"clamp(11px, 3.2vw, 12.5px)", fontWeight:700, color, fontVariantNumeric:"tabular-nums",
                overflow:"hidden", textOverflow:"ellipsis" }}>{val}</span>
              {label && <span style={{ fontSize:"clamp(10px, 2.9vw, 11px)", color:"var(--muted)" }}>{label}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Recherche + Filtres + .3mf */}
      {viewMode!=="makerworld" && viewMode!=="queue" && <div style={{ display:"flex", gap:8 }}>
        <div style={{ position:"relative", flex:1 }}>
          <Search size={14} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un print…"
            style={{ width:"100%", paddingLeft:36, padding:"8px 10px 8px 36px", boxSizing:"border-box",
              background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10,
              fontSize:12, color:"var(--text)", outline:"none" }}/>
        </div>
        <button onClick={()=>setFilterOpen(true)}
          style={{ display:"flex", alignItems:"center", gap:5, padding:"8px 14px",
            background: (statusF||sortF!=="recent"||dateFrom||dateTo) ? "#3b82f6" : "var(--surface2)",
            color: (statusF||sortF!=="recent"||dateFrom||dateTo) ? "white" : "var(--text)",
            border:"1px solid var(--border)", borderRadius:10, fontSize:12, cursor:"pointer", flexShrink:0 }}>
          <SlidersHorizontal size={14}/>
          {[statusF, sortF!=="recent", materialF, filaTypeF, filamentIdF, colorF, dateFrom||dateTo].filter(Boolean).length > 0 ? `Filtres (${[statusF, sortF!=="recent", materialF, filaTypeF, filamentIdF, colorF, dateFrom||dateTo].filter(Boolean).length})` : "Filtres"}
        </button>
        {viewMode==="list" && (
          <AdminOnly><button onClick={()=>selectMode?exitSelectMode():setSelectMode(true)}
            title={selectMode?"Annuler sélection":"Sélectionner"}
            style={{ width:36, height:36, borderRadius:10, border:"1px solid var(--border)",
              background:selectMode?"rgba(59,130,246,0.1)":"var(--surface2)",
              color:selectMode?"#3b82f6":"var(--muted)", cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Check size={14}/>
          </button></AdminOnly>
        )}
        <AdminOnly><label title="Importer .3mf"
          style={{ width:36, height:36, borderRadius:10, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--muted)", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <Upload size={14}/>
          <input type="file" accept=".3mf" onChange={handleImport} style={{ display:"none" }}/>
        </label></AdminOnly>

      </div>}

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
              {(statusF||sortF!=="recent"||materialF||filaTypeF||filamentIdF||colorF||dateFrom||dateTo) && (
                <button onClick={()=>{ setStatusF(""); setSortF("recent"); setMaterialF(""); setFilaTypeF(""); setFilamentIdF(""); setColorF(""); setDateFrom(""); setDateTo(""); setFilSearch(""); }}
                  style={{ fontSize:11, color:"#60a5fa", background:"none", border:"none", cursor:"pointer" }}>
                  Effacer filtres
                </button>
              )}
            </div>
            {/* Filtre période (temporel) — en tete du sheet : plage Debut/Fin +
                bascule "Tout" qui vide les bornes. Meme sens que le filtre periode
                de Stats, reduit a la plage personnalisee. Cases a largeur fixe et
                bouton aligne en bas sur les champs (aligns-items flex-end). */}
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 8px" }}>Période</p>
            <div style={{ display:"flex", gap:8, alignItems:"flex-end", flexWrap:"wrap", marginBottom:20 }}>
              <button onClick={()=>{ setDateFrom(""); setDateTo(""); }}
                style={{ height:35, padding:"0 16px", borderRadius:20, fontSize:12, fontWeight:600,
                  cursor:"pointer", border:"none",
                  background:(!dateFrom && !dateTo) ? "#3b82f6" : "var(--surface2)",
                  color:(!dateFrom && !dateTo) ? "white" : "var(--muted)" }}>
                Tout
              </button>
              <label style={{ fontSize:11, color:"var(--muted)" }}>Début
                <input type="date" value={dateFrom} max={dateTo || undefined}
                  onChange={e=>setDateFrom(e.target.value)}
                  style={{ display:"block", width:150, boxSizing:"border-box", marginTop:4, padding:"8px 10px",
                    borderRadius:8, border:"1px solid var(--border)", background:"var(--surface2)",
                    color:"var(--text)", fontSize:13 }}/>
              </label>
              <label style={{ fontSize:11, color:"var(--muted)" }}>Fin
                <input type="date" value={dateTo} min={dateFrom || undefined}
                  onChange={e=>setDateTo(e.target.value)}
                  style={{ display:"block", width:150, boxSizing:"border-box", marginTop:4, padding:"8px 10px",
                    borderRadius:8, border:"1px solid var(--border)", background:"var(--surface2)",
                    color:"var(--text)", fontSize:13 }}/>
              </label>
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

            {/* Filtre teinte */}
            {colorBuckets.length > 0 && (<>
              <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 8px" }}>
                Teinte <span style={{ textTransform:"none", letterSpacing:0 }}>— prints utilisant un filament contenant cette couleur</span>
              </p>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
                {colorBuckets.map(b => {
                  const on = colorF === b.slug;
                  return (
                    <button key={b.slug} onClick={()=>setColorF(on ? "" : b.slug)}
                      style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 12px 5px 6px",
                        borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:"none",
                        background: on ? "#3b82f6" : "var(--surface2)",
                        color: on ? "white" : "var(--muted)" }}>
                      <span style={{ width:14, height:14, borderRadius:"50%", flexShrink:0,
                        boxSizing:"border-box", backgroundClip:"padding-box",
                        background:b.hex, border:"1px solid rgba(128,128,128,0.35)" }}/>
                      {b.label}
                      <span style={{ opacity:0.6, fontSize:10 }}>{b.count}</span>
                    </button>
                  );
                })}
              </div>
            </>)}

            {/* Filtre filament exact */}
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 8px" }}>Filament exact</p>
            <input value={filSearch} onChange={e=>setFilSearch(e.target.value)} placeholder="Nom, marque, matériau, type…"
              style={{ width:"100%", boxSizing:"border-box", padding:"8px 12px", borderRadius:8, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)", fontSize:12, outline:"none", marginBottom:6 }}/>
            <div style={{ maxHeight:220, overflowY:"auto", display:"flex", flexDirection:"column", gap:2, marginBottom:16 }}>
              {filamentIdF && <button onClick={()=>setFilamentIdF("")} style={{ padding:"5px 12px", borderRadius:8, fontSize:11, background:"rgba(239,68,68,0.1)", color:"#ef4444", border:"none", cursor:"pointer", textAlign:"left", marginBottom:4 }}>✕ Effacer filament sélectionné</button>}
              {(() => {
                // Cohérent avec les autres filtres : on n'affiche que les filaments
                // compatibles avec matériau / type / teinte déjà sélectionnés.
                const words = filSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
                const list = allFilaments.filter(f => {
                  if (materialF && f.material !== materialF) return false;
                  if (filaTypeF && f.fila_type !== filaTypeF) return false;
                  if (colorF && !(f.color_bucket||"").split(",").map(t=>t.trim()).includes(colorF)) return false;
                  if (!words.length) return true;
                  const hay = [f.translated_name, f.name, f.name_en, f.manufacturer,
                    f.material, f.fila_type, f.color_bucket, "#"+f.id].filter(Boolean).join(" ").toLowerCase();
                  return words.every(w => hay.includes(w));
                });
                if (!list.length) return (
                  <p style={{ fontSize:11, color:"var(--muted)", padding:"8px 4px", margin:0 }}>Aucun filament ne correspond.</p>
                );
                // Groupé par matériau, trié alphabétiquement (liste complète, pas de troncature)
                const byMat = {};
                list.forEach(f => { (byMat[f.material||"Autre"] ||= []).push(f); });
                return Object.keys(byMat).sort().map(mat => (
                  <div key={mat}>
                    <p style={{ fontSize:9, fontWeight:700, color:"var(--muted)", textTransform:"uppercase",
                      letterSpacing:"0.06em", margin:"8px 0 3px", position:"sticky", top:0,
                      background:"var(--sheet-bg)", padding:"2px 0" }}>
                      {mat} <span style={{ opacity:0.6 }}>({byMat[mat].length})</span>
                    </p>
                    {byMat[mat]
                      .sort((a,b)=>(a.translated_name||a.name||"").localeCompare(b.translated_name||b.name||""))
                      .map(f => (
                      <button key={f.id} onClick={()=>{ setFilamentIdF(filamentIdF===String(f.id)?"":String(f.id)); }}
                        style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", width:"100%",
                          borderRadius:8, border:"none", cursor:"pointer", textAlign:"left", marginBottom:2,
                          background: filamentIdF===String(f.id) ? "rgba(59,130,246,0.15)" : "var(--surface2)" }}>
                        <ColorDot hex={f.color} colors={f.colors_array}
                          multicolor={f.multicolor_type} size={14}/>
                        <span style={{ flex:1, minWidth:0, fontSize:11, color:"var(--text)",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {f.translated_name||f.name}
                          <span style={{ color:"var(--muted)" }}>
                            {" · "}{[f.manufacturer, f.fila_type].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ));
              })()}
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
              {prints.map(p => <PrintCard key={p.id} p={p} onClick={()=>setSelected(p)} onDelete={onDelete} onChanged={() => load()} onLongPress={id=>{ setSelectMode(true); setSelectedIds(new Set([id])); }}/>)}
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
          if (!groupMap[p.group_id]) groupMap[p.group_id] = { name: p.group_name, prints:[], latestDate:"", earliestDate:"", duration_seconds:0, total_cost:0, total_weight_g:0, number_of_items:p.group_number_of_items||1, cover_print_id:p.group_cover_print_id||null };
          const g = groupMap[p.group_id];
          g.prints.push(p);
          if (!g.latestDate   || p.print_date > g.latestDate)   g.latestDate   = p.print_date;
          if (!g.earliestDate || p.print_date < g.earliestDate) g.earliestDate = p.print_date;
          // Un groupe est trié sur SA valeur agrégée, pas sur celle d'un membre
          g.duration_seconds = (g.duration_seconds||0) + (p.duration_seconds || p.estimated_seconds || 0);
          g.total_cost       = (g.total_cost||0)       + (p.total_cost || 0);
          g.total_weight_g   = (g.total_weight_g||0)   + (p.total_weight_g || 0);
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

        // Trier selon le filtre actif, avec les mêmes clés que le backend :
        // un groupe est classé sur sa valeur agrégée, un print solo sur la sienne.
        const keyOf = (it) => {
          const isG = it.type === "group";
          switch (sortF) {
            case "oldest":   return isG ? (it.earliestDate||"") : (it.p.print_date||"");
            case "cost":     return isG ? (it.total_cost||0)     : (it.p.total_cost||0);
            case "weight":   return isG ? (it.total_weight_g||0) : (it.p.total_weight_g||0);
            case "duration": return isG ? (it.duration_seconds||0)
                                        : (it.p.duration_seconds || it.p.estimated_seconds || 0);
            default:         return isG ? (it.latestDate||"") : (it.p.print_date||"");
          }
        };
        const asc = sortF === "oldest";
        items.sort((a,b) => {
          const ka = keyOf(a), kb = keyOf(b);
          const cmp = typeof ka === "string" ? ka.localeCompare(kb) : (ka - kb);
          return asc ? cmp : -cmp;
        });

        // Grille responsive : 2 cols mobile, 3-4 cols desktop
        const GRID = "repeat(auto-fill, minmax(160px, 1fr))";
        return (
          <div style={{ display:"grid", gridTemplateColumns:GRID, gap:10 }}>
            {items.map((item, idx) => item.type === "print" ? (
              <PrintCard key={item.p.id} p={item.p}
                onClick={()=>setSelected(item.p)}
                onDelete={onDelete}
                onChanged={() => load()}
                selectMode={selectMode}
                selected={selectedIds.has(item.p.id)}
                onToggleSelect={toggleSelect}
                onLongPress={id => { setSelectMode(true); setSelectedIds(new Set([id])); }}/>
            ) : (
              <GroupTile key={item.groupId} groupId={item.groupId} name={item.name}
                selectMode={selectMode}
                selected={selectedGroups.some(g => g.groupId === item.groupId)}
                onToggleSelect={() => toggleGroup(item)}
                onLongPress={() => { setSelectMode(true); setSelectedIds(new Set()); setSelectedGroups([item]); }}
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

      {/* Filet de sécurité : si l'amorçage auto échoue, on garde une action explicite */}
      {viewMode==="list" && !loading && !error && hasMore && (
        <div ref={sentinelRef} aria-hidden style={{ height: 1 }}/>
      )}
      {viewMode==="list" && !loading && !error && hasMore && (
        <div style={{ display:"flex", justifyContent:"center", padding:"16px 0 8px" }}>
          <button onClick={loadMore} disabled={loadingMore}
            style={{ padding:"9px 18px", borderRadius:20, fontSize:12, fontWeight:700,
              border:"1px solid var(--border)", background:"var(--surface2)",
              color:"var(--muted)", cursor: loadingMore ? "default" : "pointer" }}>
            {loadingMore ? "Chargement…" : `Charger plus (${prints.length}/${total})`}
          </button>
        </div>
      )}

      {selected && <PrintDetail p={selected} onClose={()=>{ setSelected(null); closeDeep(); }}
        onDelete={id=>{setPrints(ps=>ps.filter(p=>p.id!==id));setTotal(t=>t-1);}}
        onChanged={() => { load(); loadGroups(); }}/>}

      {/* Barre flottante de sélection multiple */}
      {assign && (
        <div style={{ position:"fixed", bottom:"calc(76px + env(safe-area-inset-bottom,0px))", left:12, right:12, zIndex:500,
          background:"var(--sheet-bg)", border:"1px solid var(--border)", borderRadius:14, padding:8,
          display:"flex", alignItems:"center", gap:8, boxShadow:"0 4px 24px rgba(0,0,0,0.35)" }}>
          {assign.cover_url
            ? <img src={mwImg(assign.cover_url, 44)} alt="" style={{ width:40, height:40, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
            : <span style={{ width:40, height:40, borderRadius:8, background:"var(--surface2)", flexShrink:0 }}/>}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis",
              whiteSpace:"nowrap" }}>🔗 {assign.title_fr || assign.title || `Modèle ${assign.design_id}`}</div>
            <div style={{ fontSize:11, color:"var(--muted)" }}>
              {selectedIds.size + selectedGroups.length
                ? [selectedIds.size && `${selectedIds.size} print${selectedIds.size > 1 ? "s" : ""}`,
                   selectedGroups.length && `${selectedGroups.length} groupe${selectedGroups.length > 1 ? "s" : ""}`].filter(Boolean).join(" + ")
                : "Cherche et touche les impressions ou groupes"}
            </div>
          </div>
          <button onClick={applyAssign} disabled={assignBusy || !(selectedIds.size + selectedGroups.length)}
            style={{ padding:"7px 12px", borderRadius:8, fontSize:12, fontWeight:700, flexShrink:0, border:"none",
              background: selectedIds.size + selectedGroups.length ? "#3b82f6" : "var(--border)",
              color: selectedIds.size + selectedGroups.length ? "white" : "var(--muted)",
              cursor: selectedIds.size + selectedGroups.length ? "pointer" : "default" }}>{assignBusy ? "…" : "Valider"}</button>
          <button onClick={cancelAssign} aria-label="Annuler l'association"
            style={{ padding:"6px 10px", borderRadius:8, fontSize:12, flexShrink:0, background:"none",
              border:"1px solid var(--border)", color:"var(--muted)", cursor:"pointer" }}>✕</button>
        </div>
      )}

      {!assign && selectMode && (selectedIds.size > 0 || selectedGroups.length > 0) && (
        /* Deux rangees plutot qu'une seule : quatre elements cote a cote
           debordaient de l'ecran sur telephone, "Annuler" se retrouvait coupe.
           Le compte et l'abandon tiennent sur la premiere ligne, les deux
           actions se partagent la seconde en parts egales -- cibles larges au
           doigt, et aucune largeur a deviner. */
        <div style={{ position:"fixed", bottom:"calc(76px + env(safe-area-inset-bottom,0px))",
          left:12, right:12, zIndex:500,
          background:"var(--sheet-bg)", border:"1px solid var(--border)", borderRadius:14,
          padding:10, display:"flex", flexDirection:"column", gap:8,
          boxShadow:"0 4px 24px rgba(0,0,0,0.35)" }}>

          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:12.5, color:"var(--text)", fontWeight:700,
              flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis",
              whiteSpace:"nowrap" }}>
              {[selectedIds.size && `${selectedIds.size} print${selectedIds.size>1?"s":""}`,
                selectedGroups.length && `${selectedGroups.length} groupe${selectedGroups.length>1?"s":""}`]
                .filter(Boolean).join(" + ")} sélectionné{selectedIds.size + selectedGroups.length > 1 ? "s" : ""}
            </span>
            <button onClick={exitSelectMode}
              style={{ padding:"5px 12px", borderRadius:8, fontSize:12, background:"none",
                border:"1px solid var(--border)", color:"var(--muted)", cursor:"pointer",
                flexShrink:0 }}>
              Annuler
            </button>
          </div>

          {selectedGroups.length > 0 && selectedIds.size > 0 && (
            <p style={{ margin:0, fontSize:11.5, color:"var(--muted)" }}>
              Sélectionne soit des prints (pour les grouper), soit des groupes (pour les fusionner).
            </p>
          )}
          {selectedGroups.length > 0 && selectedIds.size === 0 && (
            <button onClick={() => setMergeOpen(true)} disabled={selectedGroups.length < 2}
              style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                padding:"10px 8px", borderRadius:10, fontSize:12.5, fontWeight:700, border:"none",
                background: selectedGroups.length < 2 ? "var(--surface2)" : "#7c3aed",
                color: selectedGroups.length < 2 ? "var(--muted)" : "white",
                cursor: selectedGroups.length < 2 ? "default" : "pointer" }}>
              🔗 {selectedGroups.length < 2 ? "Sélectionne au moins 2 groupes" : `Fusionner ${selectedGroups.length} groupes`}
            </button>
          )}
          {selectedIds.size > 0 && selectedGroups.length === 0 && (
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => setGroupPickerOpen(true)}
              style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                gap:6, padding:"10px 8px", borderRadius:10, fontSize:12.5, fontWeight:700,
                background:"#3b82f6", color:"white", border:"none", cursor:"pointer",
                minWidth:0 }}>
              <FolderPlus size={15} style={{ flexShrink:0 }}/>
              <span style={{ overflow:"hidden", textOverflow:"ellipsis",
                whiteSpace:"nowrap" }}>Grouper</span>
            </button>
            {confirmDelete ? (
              <button onClick={deleteSelected} disabled={deleting}
                style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                  gap:6, padding:"10px 8px", borderRadius:10, fontSize:12.5, fontWeight:700,
                  background:"#ef4444", color:"white", border:"none", cursor:"pointer",
                  opacity: deleting?0.6:1, minWidth:0 }}>
                <Trash2 size={15} style={{ flexShrink:0 }}/>
                <span style={{ overflow:"hidden", textOverflow:"ellipsis",
                  whiteSpace:"nowrap" }}>{deleting ? "Suppression…" : "Confirmer ?"}</span>
              </button>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                  gap:6, padding:"10px 8px", borderRadius:10, fontSize:12.5, fontWeight:700,
                  background:"rgba(239,68,68,0.12)", color:"#ef4444",
                  border:"none", cursor:"pointer", minWidth:0 }}>
                <Trash2 size={15} style={{ flexShrink:0 }}/>
                <span style={{ overflow:"hidden", textOverflow:"ellipsis",
                  whiteSpace:"nowrap" }}>Supprimer</span>
              </button>
            )}
          </div>
          )}
        </div>
      )}

      {mergeOpen && (
        <GroupMergeSheet groups={selectedGroups} onClose={() => setMergeOpen(false)}
          onDone={async () => { exitSelectMode(); await Promise.all([load(), loadGroups()]); }}/>
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
            } catch(err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
          }}
        />
      )}
    </div>
  );
}

// ── Fusion de groupes ───────────────────────────────────────────────────────
// Les groupes choisis n'en font plus qu'un. On choisit celui qui reste (son nom,
// ses vignettes) ; le nombre d'elements propose est la somme de ceux de chaque
// groupe (1 par defaut), a valider ou corriger avant d'envoyer.
function GroupMergeSheet({ groups, onClose, onDone }) {
  const [keepId, setKeepId] = useState(groups[0]?.groupId);
  const sum = groups.reduce((t, g) => t + Math.max(1, g.number_of_items || 1), 0);
  const [nb, setNb] = useState(String(sum));
  const [busy, setBusy] = useState(false);
  const nbOk = /^\d+$/.test(nb) && +nb >= 1;
  const keep = groups.find(g => g.groupId === keepId);
  const nPrints = groups.reduce((t, g) => t + (g.prints?.length || 0), 0);

  const submit = async () => {
    setBusy(true);
    try {
      await client.post(`/prints/groups/${keepId}/merge`, {
        source_ids: groups.filter(g => g.groupId !== keepId).map(g => g.groupId),
        number_of_items: +nb,
      });
      await onDone();
    } catch (err) {
      showAlert("Erreur: " + (err.response?.data?.detail || err.message));
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:1400, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:480, maxHeight:"90dvh", overflowY:"auto",
        padding:"16px 18px", paddingBottom:"calc(16px + env(safe-area-inset-bottom,0px))" }}>
        <h3 style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:"0 0 4px" }}>
          Fusionner {groups.length} groupes
        </h3>
        <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 12px" }}>
          {nPrints} print{nPrints > 1 ? "s" : ""}, leurs photos et leurs objets iront dans un seul groupe.
          Choisis celui qui reste :
        </p>

        {groups.map(g => {
          const on = g.groupId === keepId;
          return (
            <button key={g.groupId} onClick={() => setKeepId(g.groupId)}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px",
                marginBottom:6, borderRadius:10, cursor:"pointer", textAlign:"left",
                background: on ? "rgba(124,58,237,0.12)" : "var(--surface2)",
                border: on ? "1.5px solid #7c3aed" : "1px solid var(--border)", color:"var(--text)" }}>
              <span style={{ width:16, height:16, borderRadius:"50%", flexShrink:0,
                border: on ? "5px solid #7c3aed" : "1.5px solid var(--muted)" }}/>
              <span style={{ flex:1, minWidth:0, fontSize:13, fontWeight:600, overflow:"hidden",
                textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{g.name}</span>
              <span style={{ flexShrink:0, fontSize:10, color:"var(--muted)", fontFamily:"JetBrains Mono, monospace",
                textAlign:"right", lineHeight:1.35 }}>
                {g.prints?.length || 0} print{(g.prints?.length || 0) > 1 ? "s" : ""}<br/>
                {Math.max(1, g.number_of_items || 1)} élément{(g.number_of_items || 1) > 1 ? "s" : ""}
              </span>
            </button>
          );
        })}

        <label style={{ display:"block", fontSize:11, fontWeight:700, color:"var(--muted)",
          textTransform:"uppercase", letterSpacing:0.4, margin:"14px 0 6px" }}>
          Nombre d'éléments du groupe fusionné
        </label>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <input value={nb} onChange={e => setNb(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric"
            style={{ width:90, background:"var(--surface2)", border:`1.5px solid ${nbOk ? "var(--border)" : "#ef4444"}`,
              borderRadius:8, padding:"9px 12px", fontSize:15, fontWeight:700, color:"var(--text)", outline:"none" }}/>
          <span style={{ fontSize:11, color:"var(--muted)" }}>
            {groups.map(g => Math.max(1, g.number_of_items || 1)).join(" + ")} = {sum}
          </span>
        </div>

        <div style={{ display:"flex", gap:8, marginTop:16 }}>
          <button onClick={onClose} style={{ flex:1, padding:10, borderRadius:12, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text)", fontSize:13, fontWeight:700, cursor:"pointer" }}>
            Annuler
          </button>
          <button onClick={submit} disabled={busy || !nbOk}
            style={{ flex:2, padding:10, borderRadius:12, border:"none", fontSize:13, fontWeight:700,
              cursor: busy || !nbOk ? "default" : "pointer",
              background: busy || !nbOk ? "var(--surface2)" : "#7c3aed",
              color: busy || !nbOk ? "var(--muted)" : "white" }}>
            {busy ? "Fusion…" : `Fusionner dans « ${keep?.name ?? "?"} »`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Date courte et lisible pour distinguer les groupes homonymes.
function fmtGroupDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date)) return "—";
  return date.toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"2-digit" });
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
  // Un homonyme exact ne bloque PLUS la création : plusieurs groupes peuvent
  // porter le même nom (deux lots distincts d'un même modèle, par ex.). On propose
  // donc toujours de créer, tout en listant les groupes existants juste dessous.
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
          {q.trim() && (
            <button onClick={() => onPick({ group_name: q.trim() })}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
                marginBottom: exactNameExists ? 4 : 8, borderRadius:10, background:"rgba(59,130,246,0.12)",
                border:"1px solid rgba(59,130,246,0.35)", color:"#3b82f6", fontSize:13, fontWeight:700,
                cursor:"pointer", textAlign:"left" }}>
              <FolderPlus size={15}/> Créer un nouveau groupe « {q.trim()} »
            </button>
          )}
          {q.trim() && exactNameExists && (
            <p style={{ margin:"0 0 10px", fontSize:11, color:"var(--muted)", padding:"0 2px" }}>
              Un groupe porte déjà ce nom. Tu peux le rejoindre ci-dessous, ou en créer un nouveau.
            </p>
          )}

          {filtered.length === 0 && !q.trim() && (
            <p style={{ textAlign:"center", color:"var(--muted)", fontSize:12, padding:"20px 0" }}>
              Aucun groupe pour l'instant — tape un nom pour en créer un.
            </p>
          )}

          {filtered.map(g => (
            <button key={g.id} onClick={() => onPick({ group_id: g.id })}
              style={{ width:"100%", padding:"10px 14px", textAlign:"left", background:"var(--surface2)",
                border:"1px solid var(--border)", borderRadius:8, cursor:"pointer",
                color:"var(--text)", fontSize:13, marginBottom:6,
                display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:15, flexShrink:0 }}>📁</span>
              <span style={{ flex:1, minWidth:0, fontWeight:600, overflow:"hidden",
                textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{g.name}</span>
              {/* Date du print le plus récent + nombre : c'est ce qui permet de
                  distinguer deux groupes de même nom. */}
              <span style={{ flexShrink:0, fontSize:10, color:"var(--muted)",
                fontFamily:"JetBrains Mono, monospace", textAlign:"right", lineHeight:1.35 }}>
                {fmtGroupDate(g.latest_date)}<br/>
                {g.print_count} print{g.print_count > 1 ? "s" : ""}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
