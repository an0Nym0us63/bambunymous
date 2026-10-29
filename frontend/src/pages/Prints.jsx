import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { colorBg, parseColorsList, finishOf } from "../utils/colors";
import HiddenMark from "../components/HiddenMark";
import Cachettes, { Hide } from "../components/Cachettes";
import { createPortal } from "react-dom";
import Lightbox from "../components/Lightbox";
import { RefreshCw, Upload, Search, Filter, Clock, Package, CheckCircle, XCircle, Loader, Image as ImageIcon, List, Check, FolderPlus, X, FolderMinus, SlidersHorizontal, Pencil, Trash2, AlertTriangle, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useUrlTab } from "../utils/useUrlTab";
import MakerWorldView from "../components/MakerWorldView";
import MakerWorldCollectionsPicker from "../components/MakerWorldCollectionsPicker";
import MwDocs from "../components/MwDocs";
import Model3D from "../components/Model3D";
import MakerWorldModelSheet, { prefetchModel } from "../components/MakerWorldModelSheet";
import { openCreator } from "../components/MwCreatorPage";
import { useToRateSet, RateButton, RateStar as RateStarBtn } from "../components/MwToRate";
import { useFriend, currentFriend } from "../store/friend";
import MwImg from "../components/MwImg";
import client, { apiUrl, apiThumb } from "../api/client";
import { showAlert, showConfirm } from "../utils/dialog";
import { egg } from "../eggs";
import { moneyVal } from "../utils/money";
import AdminOnly from "../components/AdminOnly";
import { useMine, MineBadge, FriendsPrints, useHasFriends, useShared, sharedCount, relayed } from "../components/Friends";
import MwQueue from "../components/MwQueue";
import { mwImg } from "../components/MwImg";
import { toast } from "../store/toast";
import ShareSheet from "../components/ShareSheet";
import { FSheet, fBtn, lighten } from "../components/FicheKit";
import { useIsAdmin } from "../store/auth";
import { useTrackDetail } from "../utils/track";
import GalleryCompare from "../components/GalleryCompare";
import { FilamentSheetFromSpool } from "./Filaments";
import { useKeyboardInset } from "../utils/keyboard";
import PhotoAddButton from "../components/PhotoAddButton";
import GroupMosaic from "../components/GroupMosaic";
import ObjectCreateSheet from "../components/ObjectCreateSheet";
import Select from "../components/Select";
import { useLongPress, openMenu } from "../components/ContextMenu";
import NasChip from "../components/NasChip";
import ColorMap from "../components/ColorMap";

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
function ColorDot({ hex, colors, multicolor, finish = null, size = 14, ring = "default", style }) {
  const rings = {
    default: "inset 0 0 0 1px rgba(128,128,128,0.35)",
    mapped:  "inset 0 0 0 1px rgba(128,128,128,0.35), 0 0 0 2px #22c55e",
    none:    "none",
  };
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", flexShrink:0,
      position:"relative", overflow:"hidden", boxShadow:rings[ring] ?? rings.default,
      ...style }}>
      {/* la couleur avec sa transparence (damier) et sa finition (silk, paillettes…) */}
      <div style={{ position:"absolute", inset:0,
        ...colorBg(parseColorsList(hex, colors), multicolor, finish, { size: 40 }) }}/>
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
            multicolor={f.filament_multicolor_type} finish={finishOf(f)} size={14}
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

  // la couleur de la fenetre : verte pour rendre du poids, rouge pour supprimer
  const C = restoreOnly ? "#22C55E" : "#EF4444";
  const pct = o => o === 0 ? "Non" : o === 1 ? "100 %" : `${o * 100} %`;
  return (
    <FSheet onClose={onCancel} z={3000} bottom={<>
      <button onClick={onCancel} style={{ ...fBtn, flex:1 }}>Annuler</button>
      <button onClick={()=>onConfirm(fracs)} style={{ ...fBtn, flex:2, border:"none", color:"#fff", fontWeight:900,
        background:`linear-gradient(135deg, ${C}, ${lighten(C)})`, boxShadow:`0 8px 18px -10px ${C}` }}>
        {restoreOnly ? `✓ Restituer${totalAdded > 0 ? ` ${totalAdded.toFixed(1).replace(".", ",")} g` : ""}` : "🗑 Supprimer"}</button></>}>
      {/* l'en-tete : ce qu'on fait, et a quelle impression */}
      <div style={{ padding:"52px 18px 16px", display:"flex", alignItems:"center", gap:14,
        background:`radial-gradient(circle at 15% 40%, ${C}40, transparent 60%), var(--surface2)` }}>
        <span style={{ width:54, height:54, borderRadius:17, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26,
          background:`linear-gradient(135deg, ${C}, ${lighten(C)})`, boxShadow:`0 8px 20px -8px ${C}` }}>{restoreOnly ? "⚖️" : "🗑️"}</span>
        <div style={{ minWidth:0, display:"flex", flexDirection:"column", gap:3 }}>
          <span style={{ fontSize:12, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:C }}>
            {restoreOnly ? "Rendre aux bobines" : "Supprimer l'impression"}</span>
          <span style={{ fontSize:19, fontWeight:900, color:"var(--text)", lineHeight:1.2 }}>
            {restoreOnly ? "Restituer les grammes" : "Supprimer ce print ?"}</span>
          <span style={{ fontSize:12.5, fontWeight:700, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {p.file_name || "Sans nom"}</span>
        </div>
      </div>
      <div style={{ padding:"14px 16px 18px", display:"flex", flexDirection:"column", gap:12 }}>
        {mapped.length > 0 ? (<>
          {!restoreOnly && <p style={{ margin:0, fontSize:12.5, fontWeight:600, color:"var(--muted)" }}>
            Et le filament consommé : le rendre aux bobines ?</p>}
          {/* d'un geste, la meme part pour toutes les bobines */}
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <span style={{ fontSize:12, fontWeight:800, color:"var(--text2)", marginRight:"auto" }}>Pour toutes</span>
            {OPTS.map(o=>(
              <button key={o} onClick={()=>setAll(o)} style={pill(allSame===o)}>{pct(o)}</button>
            ))}
          </div>
          {mapped.map(f=>{ const on = (fracs[f.id]??0) > 0;
            return (
            <div key={f.id} style={{ borderRadius:16, padding:"11px 12px", display:"flex", flexDirection:"column", gap:9,
              border:`1px solid ${on ? "rgba(34,197,94,0.35)" : "var(--border)"}`,
              background: on ? "linear-gradient(135deg, rgba(34,197,94,0.10), transparent 60%), var(--surface2)" : "var(--surface2)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                <ColorDot hex={f.color_hex} colors={f.filament_colors_array} multicolor={f.filament_multicolor_type} size={20}/>
                <span style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column" }}>
                  <span style={{ fontSize:13.5, fontWeight:800, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {f.filament_translated_name||f.filament_fila_type||f.filament_type||"Filament"}</span>
                  <span style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)" }}>bobine #{f.spool_id} · {gFmt(f.grams_used).replace(".", ",")} g utilisés</span>
                </span>
                {on && <span style={{ fontSize:12.5, fontWeight:900, color:"#16a34a", whiteSpace:"nowrap" }}>
                  +{((f.grams_used||0)*(fracs[f.id]??0)).toFixed(1).replace(".", ",")} g</span>}
              </div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
                {OPTS.map(o=>(
                  <button key={o} onClick={()=>setOne(f,o)} style={pill((fracs[f.id]??0)===o)}>{pct(o)}</button>
                ))}
                {/* Saisie precise en grammes : pilote la fraction (bornee a la
                    quantite consommee). Les boutons rapides mettent a jour ce champ. */}
                <span style={{ display:"inline-flex", alignItems:"center", gap:5, marginLeft:"auto" }}>
                  <input type="text" inputMode="decimal" aria-label="Grammes à restituer"
                    value={gtxt[f.id] ?? ""}
                    onChange={e=>setGrams(f, e.target.value)}
                    onBlur={()=>setGtxt(prev=>({...prev,[f.id]:gFmt(f.grams_used*(fracs[f.id]??0))}))}
                    onFocus={e=>e.target.select()}
                    style={{ width:64, height:30, padding:"0 10px", borderRadius:20, border:"1px solid var(--border)", boxSizing:"border-box",
                      background:"var(--surface)", color:"var(--text)", fontSize:12.5, fontWeight:800, textAlign:"right" }}/>
                  <span style={{ fontSize:12, fontWeight:800, color:"var(--muted)" }}>g</span>
                </span>
              </div>
            </div>); })}
          {totalAdded>0 && <div style={{ textAlign:"center", fontSize:13, fontWeight:900, color:"#16a34a", padding:"8px 10px", borderRadius:14,
            background:"rgba(34,197,94,0.12)", border:"1px solid rgba(34,197,94,0.3)" }}>+{totalAdded.toFixed(1).replace(".", ",")} g rendus aux bobines</div>}
        </>) : <p style={{ margin:0, fontSize:12.5, fontWeight:600, color:"var(--muted)" }}>
          {restoreOnly ? "Aucune bobine associée : rien à restituer." : "Aucune bobine associée : aucun poids à rendre."}</p>}
      </div>
    </FSheet>
  );
}
// une pastille de choix (part a restituer)
const pill = on => ({ padding:"5px 11px", borderRadius:20, cursor:"pointer", fontWeight:800, fontSize:12, whiteSpace:"nowrap",
  border: on ? "none" : "1px solid var(--border)", color: on ? "#fff" : "var(--text2)",
  background: on ? "linear-gradient(135deg, #22C55E, #4ADE80)" : "var(--surface)", boxShadow: on ? "0 6px 14px -8px #22C55E" : "none" });

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

  const g = (f.grams_used||0)*fraction;
  return (
    <FSheet onClose={onClose} z={4000} bottom={<>
      <button onClick={onClose} style={{ ...fBtn, flex:1 }}>Annuler</button>
      <button onClick={confirm} style={{ ...fBtn, flex:2, border:"none", color:"#fff", fontWeight:900,
        background:"linear-gradient(135deg, #EF4444, #F87171)", boxShadow:"0 8px 18px -10px #EF4444" }}>⛓ Dissocier</button></>}>
      <div style={{ padding:"52px 18px 16px", display:"flex", alignItems:"center", gap:14,
        background:"radial-gradient(circle at 15% 40%, rgba(239,68,68,0.28), transparent 60%), var(--surface2)" }}>
        <span style={{ width:54, height:54, borderRadius:17, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
          background:"var(--surface)", boxShadow:"0 8px 20px -10px rgba(0,0,0,.5)" }}>
          <ColorDot hex={f.color_hex} colors={f.filament_colors_array} multicolor={f.filament_multicolor_type} size={30}/></span>
        <div style={{ minWidth:0, display:"flex", flexDirection:"column", gap:3 }}>
          <span style={{ fontSize:12, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#EF4444" }}>⛓ Dissocier la bobine</span>
          <span style={{ fontSize:19, fontWeight:900, color:"var(--text)", lineHeight:1.2 }}>
            {f.filament_translated_name||f.filament_fila_type||"Filament"}</span>
          <span style={{ fontSize:12.5, fontWeight:700, color:"var(--muted)" }}>bobine #{f.spool_id} · {(f.grams_used||0).toFixed(1).replace(".", ",")} g utilisés</span>
        </div>
      </div>
      <div style={{ padding:"14px 16px 18px", display:"flex", flexDirection:"column", gap:12 }}>
        <p style={{ margin:0, fontSize:12.5, fontWeight:600, color:"var(--muted)" }}>Le filament ne sera plus lié à cette bobine. Lui rendre les grammes ?</p>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
          {OPTS.map(o=>(
            <button key={o} onClick={()=>setFraction(o)} style={pill(fraction===o)}>{o===0?"Non":o===1?"100 %":`${o*100} %`}</button>
          ))}
        </div>
        {fraction>0 && <div style={{ textAlign:"center", fontSize:13, fontWeight:900, color:"#16a34a", padding:"8px 10px", borderRadius:14,
          background:"rgba(34,197,94,0.12)", border:"1px solid rgba(34,197,94,0.3)" }}>+{g.toFixed(1).replace(".", ",")} g rendus à la bobine</div>}
      </div>
    </FSheet>
  );
}

function PrintEditSheet({ p, onClose, onSaved }) {
  useTrackDetail("Historique · Modifier une impression");
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
          ✏️ Éditer le print <Hide at="print-edit"/>
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
// pourquoi ce modele n'est pas (ou plus) dans « A evaluer » : deja note, le mien, pas encore reussi…
function RateStatusLine({ designId }) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let dead = false;
    client.get(`/makerworld/rate-status/${designId}`).then(r => { if (!dead) setSt(r.data); }).catch(() => {});
    return () => { dead = true; };
  }, [designId]);
  if (!st) return null;
  const txt = {
    rated: st.noscore ? "⭐ Compté comme évalué : MakerWorld a une évaluation sans note pour ce modèle"
      : `⭐ Déjà évalué sur MakerWorld${st.score ? ` (${st.score}/5)` : ""}`,
    pending: "⭐ MakerWorld attend ton évaluation",
    mine: "Ton modèle : pas d'évaluation à faire",
    no_print: "Pas encore d'impression réussie de ce modèle",
    unknown: "Évaluations MakerWorld illisibles pour le moment",
    to_rate: "⭐ À évaluer",
  }[st.state];
  return txt ? <div style={{ fontSize:11, fontWeight:700, color: st.state === "rated" && st.noscore ? "#d97706" : "var(--muted)", padding:"0 10px 8px" }}>{txt}</div> : null;
}
// la portee d'un choix de couleur a la main : l'impression, ou le groupe de ces impressions
const colorScope = prints => prints.length === 1 ? `print:${prints[0].id}` : prints[0]?.group_id ? `group:${prints[0].group_id}` : null;

// others : les autres impressions du groupe, pas (encore) liees a ce modele ; onLinked : l'une d'elles vient de l'etre
function MakerWorldCard({ designId, note, prints = [], rateElsewhere = false, others = [], onLinked = null }) {
  const [open, setOpen] = useState(false);       // replie a chaque ouverture : le resume suffit
  const mineOf = useMine([designId]);            // chez un copain : l'ai-je deja ?
  const visiting = useFriend((s) => s.friend);
  const toRate = useToRateSet(!visiting);
  const [mw, setMw] = useState(undefined);       // undefined = en cours, null = rien
  const [pick, setPick] = useState(false);       // ranger dans mes collections
  const [sheet, setSheet] = useState(null);      // fiche du modele (ou d'un similaire)
  const [view3d, setView3d] = useState(false);   // la vue 3D du modele
  const [shown, setShown] = useState(undefined);   // le profil montre par les plateaux {id, title, deduced} ; undefined : pas encore deduit
  const shownProf = shown === undefined ? undefined : shown?.id || null;
  // chez un copain (29/10/2026) : la vue 3D ne se calcule pas chez lui a ma demande ; on regarde seulement si elle existe deja
  const [ready3d, setReady3d] = useState(null);
  useEffect(() => {
    if (!visiting || !designId || shownProf === undefined) { setReady3d(null); return; }
    let alive = true;
    const pid = (prints.find(x => x.mw_profile_id || x.mw_plates) || prints[0])?.id;
    client.get(`/makerworld/3d/${encodeURIComponent(designId)}`, { params: { peek: 1, profile: shownProf || "", print_id: pid || 0 } })
      .then(r => alive && setReady3d(!!r.data?.ready)).catch(() => alive && setReady3d(false));
    return () => { alive = false; };
  }, [visiting, designId, shownProf]);   // eslint-disable-line react-hooks/exhaustive-deps
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
        width:"100%", padding:"10px", borderRadius:14, boxSizing:"border-box",
        border:"1px solid rgba(59,130,246,0.3)", background:"rgba(59,130,246,0.06)",
        color:"#3b82f6", fontSize:12, fontWeight:700, textDecoration:"none" }}>
      🌐 Voir sur MakerWorld
    </a>
  );
  const stats = [["❤", mw.like_count, "j'aime"], ["⬇", mw.download_count, "téléchargements"],
    ["🖨", mw.print_count, "impressions"], ["🔖", mw.collection_count, "mises en collection"]]
    .filter(([, n]) => n != null);
  const rated = !toRate.has(String(designId));
  return (
    <div style={{ borderRadius:18, border:"1px solid color-mix(in srgb, #3B82F6 25%, var(--border))", overflow:"hidden",
      background:"linear-gradient(160deg, color-mix(in srgb, #3B82F6 10%, transparent), transparent 60%), var(--surface2)" }}>
      {/* le resume : toucher deplie le detail ; la fleche ↗ ouvre la fiche du modele */}
      <div onClick={() => setOpen(o => !o)} style={{ display:"flex", gap:12, padding:12, cursor:"pointer", alignItems:"center" }}>
        {mw.cover_url && <MwImg src={mw.cover_url} w={64} style={{ width:58, height:58, borderRadius:14, objectFit:"cover", flexShrink:0,
          background:"var(--surface)", boxShadow:"0 6px 16px rgba(0,0,0,.18)" }}/>}
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:10.5, fontWeight:900, color:"#3b82f6", letterSpacing:".05em" }}>
            🌐 MAKERWORLD
            {!rated && <span style={{ fontSize:10.5, fontWeight:800, color:"#f59e0b", letterSpacing:0 }}>· ⭐ à évaluer</span>}</div>
          <div style={{ fontSize:13.5, fontWeight:800, color:"var(--text)", lineHeight:1.3, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{mw.title_fr || mw.title}</div>
          <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, fontWeight:700, color:"var(--muted)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden" }}>
            {mw.creator_name && <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>par {mw.creator_name}</span>}
            {stats.slice(0, 2).map(([ico, n, lbl]) => <span key={lbl}>{ico} {fmtK(n)}</span>)}
          </div>
          {/* le profil imprime (ou deduit) : visible sans deplier la carte */}
          {shown?.title && <div data-tip={shown.deduced ? "Profil déduit de tes impressions : déplie la carte pour le corriger" : "Profil imprimé"}
            style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700, color:"#0891b2", marginTop:4, minWidth:0 }}>
            {shown.cover ? <MwImg src={shown.cover} w={48} style={{ width:22, height:22, borderRadius:6, objectFit:"cover", flexShrink:0,
              border:"1px solid var(--border)" }}/> : <span>🧩</span>}
            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{shown.title}
              {shown.deduced && <span style={{ color:"var(--muted)", fontWeight:600 }}> · déduit</span>}</span></div>}
        </div>
        {(!visiting || ready3d !== null) && <button onClick={e => { e.stopPropagation(); if (!visiting || ready3d) setView3d(true); }} aria-label="Voir en 3D"
          disabled={visiting && !ready3d} data-tip={visiting ? (ready3d ? "Voir en 3D (sa vue, déjà calculée chez lui)" : "Vue 3D pas encore calculée chez lui") : "Voir en 3D"}
          style={{ width:32, height:32, borderRadius:10, border:"1px solid rgba(14,165,233,0.4)", background:"rgba(14,165,233,0.1)",
            cursor: visiting && !ready3d ? "not-allowed" : "pointer", opacity: visiting && !ready3d ? 0.45 : 1, flexShrink:0, fontSize:14 }}>🧊</button>}
        <button onClick={e => { e.stopPropagation(); setSheet(designId); }} onPointerDown={() => prefetchModel(designId)} aria-label="Fiche du modèle"
          data-tip="Fiche du modèle" style={{ width:32, height:32, borderRadius:10, border:"1px solid var(--border)", background:"var(--surface)",
            color:"#3b82f6", cursor:"pointer", flexShrink:0, fontSize:14, fontWeight:900 }}>↗</button>
        <span style={{ fontSize:11, color:"var(--muted)", transform: open ? "rotate(90deg)" : "none", transition:"transform .15s", flexShrink:0 }}>▶</span>
      </div>
      {/* ses documents joints et ce qu'il faut prevoir : visibles meme replie */}
      <MwDocs docs={mw.docs || []} parts={mw.parts || []} otherParts={mw.other_parts} filaments={mw.filaments || []} style={{ padding:"0 12px 10px" }}/>
      {/* les couleurs du createur et ce qui les a remplacees (3MF d'origine garde) : a corriger d'un toucher */}
      {!visiting && <ColorMap designId={designId} profileId={shownProf || null} wait={shownProf === undefined} usedPrints={prints.map(x => x.id)}
        printId={(prints.find(x => x.mw_profile_id || x.mw_plates) || prints[0])?.id} scope={colorScope(prints)} style={{ padding:"0 12px 10px" }}/>}
      {open && <>
      <a href={url} onClick={e => { e.preventDefault(); setSheet(designId); }} onPointerDown={() => prefetchModel(designId)}
        style={{ display:"flex", gap:10, padding:"0 12px 10px", textDecoration:"none", color:"var(--text)", cursor:"pointer" }}>
        <div style={{ minWidth:0, flex:1 }}>
          {/* le titre (traduit) entier seulement s'il est coupe dans le resume ; dessous, celui d'origine */}
          {(mw.title_fr || mw.title)?.length > 34 && <div style={{ fontSize:13, fontWeight:700, lineHeight:1.3, overflow:"hidden",
            display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{mw.title_fr || mw.title}</div>}
          {mw.title_fr && mw.title_fr !== mw.title && (
            <div style={{ fontSize:11, color:"var(--muted)", marginTop:1, overflow:"hidden",
              textOverflow:"ellipsis", whiteSpace:"nowrap" }} data-tip="Titre d'origine">{mw.title}</div>
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
      {toRate.has(String(designId)) && !rateElsewhere && (
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 10px 10px", flexWrap:"wrap" }}>
          <span style={{ fontSize:11, fontWeight:700, color:"#f59e0b" }}>⭐ Pas encore évalué</span>
          <RateButton did={designId} style={{ fontSize:11.5, fontWeight:700, padding:"4px 10px", borderRadius:10, background:"#f59e0b",
            color:"white", textDecoration:"none", border:"1px solid #f59e0b" }}/>
        </div>
      )}
      {!toRate.has(String(designId)) && <RateStatusLine designId={designId}/>}
      <MakerWorldPlates designId={designId} profiles={mw.profiles || []} prints={prints} onProfile={setShown}
        modelTitle={mw.title} modelTitleFr={mw.title_fr} others={others} onLinked={onLinked}/>
      <AdminOnly home mw>
        <button onClick={() => setPick(true)} style={{ display:"block", width:"100%", padding:"7px", border:"none",
          borderTop:"1px solid var(--border)", background:"none", color:"#3b82f6", fontSize:11.5, fontWeight:600,
          cursor:"pointer" }}>🔖 Ranger dans mes collections</button>
      </AdminOnly>
      {pick && <MakerWorldCollectionsPicker designId={designId} title={mw.title} onClose={() => setPick(false)}/>}
      {nShared > 0 && (<>
        <button onClick={() => setShowFr(v => !v)} style={{ display:"flex", width:"100%", padding:"7px 10px", border:"none",
          borderTop:"1px solid var(--border)", background:"none", color:"#3b82f6", fontSize:11.5, fontWeight:600, cursor:"pointer" }}>
          <span style={{ flex:1, textAlign:"left" }}>👀 Chez les copains ({nShared})</span><span>{showFr ? "▴" : "▾"}</span></button>
        {showFr && <div style={{ padding:"4px 10px 10px" }}><FriendsPrints data={shared}/></div>}
      </>)}
      <MakerWorldSimilar designId={designId} onOpen={setSheet}/>
      </>}
      {sheet && <MakerWorldModelSheet designId={sheet} onClose={() => setSheet(null)}/>}
      {/* carte repliee : les plateaux deduisent quand meme le profil, sans s'afficher (le resume le montre, la vue
          3D l'attend) ; la vue 3D, au profil montre par les plateaux (sinon celui de l'impression) */}
      {!open && <div style={{ display:"none" }}>
        <MakerWorldPlates designId={designId} profiles={mw.profiles || []} prints={prints} onProfile={setShown}
        modelTitle={mw.title} modelTitleFr={mw.title_fr}/></div>}
      {view3d && <Model3D designId={designId} profileId={shownProf || null} wait={shownProf === undefined} printId={(prints.find(x => x.mw_profile_id || x.mw_plates) || prints[0])?.id}
        usedPrints={prints.map(x => x.id)} scope={colorScope(prints)}
        title={mw.title_fr || mw.title} onClose={() => setView3d(false)}/>}
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

// les corrections faites sur la page, avant relecture des prints : partagees par la carte depliee et son double
// cache (carte repliee), sinon replier la carte oubliait le profil qu'on venait de retenir
const PLATES_OVER = {};
function MakerWorldPlates({ designId, profiles, prints: printsIn, onProfile, modelTitle, modelTitleFr, others = [], onLinked = null }) {
  const [over, setOver] = useState(() => ({ ...PLATES_OVER }));          // corrections faites ici, avant relecture
  const [imgGuess, setImgGuess] = useState({});        // plateau probable par print (silhouette de son apercu)
  const guessIds = printsIn.filter(pr => !manualPlates(pr.mw_plates) && pr.status !== "FAILED" && pr.status !== "CANCELLED")
    .map(pr => pr.id).join(",");
  const [guessed, setGuessed] = useState(false);       // reconnaissance a l'image terminee (le profil deduit est final)
  useEffect(() => {
    if (!designId || !guessIds) { setGuessed(true); return; }
    let alive = true;
    client.get(`/makerworld/model/${designId}/plate-guess`, { params: { ids: guessIds } })
      .then(({ data }) => alive && setImgGuess(data.guesses || {})).catch(() => {})
      .finally(() => alive && setGuessed(true));
    return () => { alive = false; };
  }, [designId, guessIds]);
  const isAdmin = useIsAdmin();
  const visiting = useFriend((s) => s.friend);
  const prints = printsIn.map(pr => pr.id in over ? { ...pr, mw_plates: over[pr.id] } : pr);
  const avec = profiles.filter(x => x.plates?.length);
  // l'imprimante donne parfois l'identifiant d'instance du profil a la place du sien : ramene au profil
  // (27/10/2026 : sans cela le profil imprime passait pour inconnu, et on le devinait -- mal)
  const byInst = {};
  profiles.forEach(x => { if (x.instance_id) byInst[String(x.instance_id)] = String(x.profile_id); });
  const profOf = v => (v ? byInst[String(v)] || String(v) : null);
  const known = {};
  prints.forEach(pr => {
    const pp = profOf(manualPlates(pr.mw_plates)?.profile || pr.mw_profile_id);
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
  // les mots du titre du MODELE ne disent rien du profil (la tache reprend souvent ce titre : « Art The Clown
  // multipart no AMS » designait a tort le profil « Version Multipart sans ams ») : on ne compte que les autres
  const modelWords = words(`${modelTitle || ""} ${modelTitleFr || ""}`);
  const nameScore = (pr, x) => {
    const name = `${pr.original_name || ""} ${pr.task_name || ""} ${pr.file_name || ""}`;
    const nw = words(name);
    // le titre du profil, traduit et d'origine : la meilleure part retrouvee dans le nom
    return Math.max(0, ...[x.title, x.title_original].map(t => {
      const pw = new Set([...words(t)].filter(w => !modelWords.has(w)));
      return pw.size < 2 ? 0 : [...pw].filter(w => nw.has(w)).length / pw.size;
    }));
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
  // le profil montre ici, pour la vue 3D de la carte
  const shownP = prints.length ? avec.find(x => x.profile_id === pid) || guess || null : null;
  const shownId = shownP?.profile_id ?? null;
  useEffect(() => {
    if (guessed) onProfile?.(shownP ? { id: shownId, title: shownP.title, cover: shownP.cover, deduced: !sure && !pid } : null);
  }, [shownId, guessed, !sure && !pid]);   // eslint-disable-line react-hooks/exhaustive-deps
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
    const pp = profOf(pr.mw_profile_id);
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
      PLATES_OVER[pr.id] = data.mw_plates;
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
        ...(probable[pl.index] || []).map(({ pr, score, sure }) => ({ icon: "💡", img: apiThumb(apiUrl(`/prints/${pr.id}/image`), 128),
          label: `Valider : ${pr.translated_name || pr.file_name}`,
          hint: `Reconnu à l'image (ressemblance ${Math.round(score * 100)} %)`
            + (sure === false ? " · d'autres plateaux se ressemblent : le plus proche, départagé au poids" : ""),
          onClick: () => save(pr, [pl.index]) })),
        probable[pl.index] && "-",
        ...prints.map(pr => {
          const cur = platesOf(pr) || [];
          const on = cur.includes(pl.index);
          return { icon: on ? "✅" : "⬜", img: apiThumb(apiUrl(`/prints/${pr.id}/image`), 128), label: pr.translated_name || pr.file_name,
            hint: [fmtDate(pr.print_date), STATUS_CFG[pr.status]?.label].filter(Boolean).join(" · "),
            onClick: () => save(pr, on ? cur.filter(i => i !== pl.index) : [...cur, pl.index]) };
        }),
        // les impressions du groupe pas encore liees a ce modele (28/10/2026 : elles manquaient a la liste) : les choisir
        // les lie au modele et marque le plateau
        others.length > 0 && "-",
        ...others.map(pr => ({ icon: "🔗", img: apiThumb(apiUrl(`/prints/${pr.id}/image`), 128), label: pr.translated_name || pr.file_name,
          hint: [fmtDate(pr.print_date), "pas encore liée à ce modèle : la lier et marquer ce plateau"].filter(Boolean).join(" · "),
          onClick: async () => {
            try { await client.patch(`/prints/${pr.id}`, { design_id: designId }); await save(pr, [pl.index]); onLinked?.(); }
            catch (e) { showAlert(e.response?.data?.detail || e.message); }
          } })),
        prints.some(pr => manualPlates(pr.mw_plates)) && "-",
        prints.some(pr => manualPlates(pr.mw_plates)) && { icon: "↺", label: "Revenir à la détection",
          hint: "Oublie les choix faits à la main sur ces prints",
          onClick: () => prints.filter(pr => manualPlates(pr.mw_plates)).forEach(pr => save(pr, [], true)) },
      ],
    });
  };
  // « C'est celui-la » : le profil montre devient celui de tous ces prints (choix a la main, garde en base) ; leurs
  // plateaux suivent -- ceux deja coches pour ce profil, sinon le numero lu dans le fichier s'il existe ici
  const confirmed = sure && String(sure.profile_id) === String(prof.profile_id);
  const confirm = async () => {
    for (const pr of prints) {
      const i = parseInt(pr.plate_id, 10);
      await save(pr, platesOf(pr) || (i && prof.plates.some(q => q.index === i) ? [i] : []));
    }
    setPid(null);
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
        {deduit && !pid && <span data-tip="L'imprimante n'a pas donné le profil de ces prints : profil déduit"
          style={{ fontSize:10, color:"var(--muted)", opacity:0.8 }}>(profil déduit)</span>}
        {isAdmin && !visiting && !confirmed && (
          <button onClick={confirm} data-tip="C'est bien ce profil : le retenir pour ces prints"
            style={{ width:22, height:22, padding:0, borderRadius:"50%", cursor:"pointer", fontSize:12, fontWeight:800,
              lineHeight:"20px", color:"#16a34a", background:"rgba(34,197,94,0.12)", border:"1px solid rgba(34,197,94,0.5)" }}>✓</button>
        )}
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

// les nombres a la francaise : « 0,63 € », « 20 g », « 1 h 05 »
const eur2 = v => `${String(moneyVal(v, 2)).replace(".", ",")} €`;
const gFr = g => (g || 0) >= 1000 ? `${((g || 0) / 1000).toFixed(2).replace(".", ",")} kg` : (g || 0) >= 100 ? `${Math.round(g)} g` : `${(g || 0).toFixed(1).replace(".", ",")} g`;
const durFr = s => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; };
const utcDate = d => { if (!d) return null; const s = typeof d === "string" && !d.includes("Z") && !d.includes("+") ? d.replace(" ", "T") + "Z" : d; const x = new Date(s); return isNaN(x) ? null : x; };
const whenFr = d => {
  if (!d) return ["—", ""];
  const t = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()), n0 = new Date(), b = new Date(n0.getFullYear(), n0.getMonth(), n0.getDate());
  const n = Math.round((b - a) / 86400000);
  // court : la case est etroite sur telephone (la date entiere est dans l'infobulle)
  const day = n <= 0 ? "Auj." : n === 1 ? "Hier" : n < 7 ? d.toLocaleDateString("fr-FR", { weekday: "short" }) : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: n > 300 ? "2-digit" : undefined });
  // dessous : l'heure et la date (l'annee quand ce n'est pas celle-ci) -- rien de l'ancienne fiche ne se perd
  const full = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: d.getFullYear() !== n0.getFullYear() ? "2-digit" : undefined });
  return [day.charAt(0).toUpperCase() + day.slice(1), `${t} · ${full}`];
};
const V2_STATUS = { SUCCESS: ["Réussie", "#22c55e", "✓"], PARTIAL: ["En partie", "#f59e0b", "◐"], FAILED: ["Échouée", "#ef4444", "✕"],
  IN_PROGRESS: ["En cours", "#3b82f6", "●"], CANCELLED: ["Annulée", "#94a3b8", "■"] };
const v2grad = (a, b) => ({ backgroundImage: `linear-gradient(135deg, ${a}, ${b})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" });

// Les filaments (nouvelle fiche) : la repartition du poids en une barre de couleurs, puis une rangee par
// filament, toujours visible. Toucher : la bobine (ou l'associer) ; ⋯ et appui long : les memes actions
// qu'avant (ouvrir, associer, dissocier) ; « Restituer » dans le titre. Cout reel puis normal entre parentheses.
function FilamentsV2({ filaments, onSpoolClick, onSpoolPick, onRestore, onUnmap }) {
  const isAdmin = useIsAdmin();
  const [open0, setOpen0] = useState(false);   // replie a chaque ouverture
  const toggle = () => setOpen0(o => !o);
  const total = filaments.reduce((t, f) => t + (f.grams_used || 0), 0);
  const hex = f => f.color_hex ? (String(f.color_hex).startsWith("#") ? f.color_hex : `#${f.color_hex}`).slice(0, 7) : "#94a3b8";
  const open = f => {
    if (f.spool_id) onSpoolClick?.({ filId: f.bam_filament_id || null, spoolId: f.spool_id, hex: f.color_hex || null });
    else if (isAdmin && onSpoolPick) onSpoolPick({ usageId: f.id, colorHex: f.color_hex, colorsArray: f.filament_colors_array, multicolorType: f.filament_multicolor_type,
      filamentType: f.filament_fila_type || f.filament_type });
  };
  const menu = (e, f) => openMenu(e, {
    title: f.filament_translated_name || f.filament_fila_type || f.filament_name || "Filament",
    subtitle: [f.filament_brand, `${(f.grams_used || 0).toFixed(1).replace(".", ",")} g`].filter(Boolean).join(" · "),
    items: [
      f.spool_id && { icon: "🧵", label: `Ouvrir la bobine #${f.spool_id}`, onClick: () => open(f) },
      !f.spool_id && isAdmin && onSpoolPick && { icon: "▸", label: "Associer une bobine", onClick: () => open(f) },
      f.spool_id && isAdmin && { icon: "⛓", label: "Dissocier la bobine", hint: "Le poids lui est rendu", onClick: () => onUnmap?.(f) },
    ],
  });
  return (
    <div style={{ borderRadius: 18, background: "linear-gradient(160deg, color-mix(in srgb, #F97316 7%, transparent), transparent 60%), var(--surface2)",
      border: "1px solid var(--border)", padding: "12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)" }}>🧵 Filaments</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{filaments.length} · {gFr(total)}</span>
        {/* a gauche, pres du titre : colle a la fleche, on le touchait en voulant replier */}
        {isAdmin && onRestore && filaments.some(f => f.spool_id) && <button onClick={e => { e.stopPropagation(); onRestore(); }} data-tip="Rendre aux bobines une part du poids"
          style={{ fontSize: 11.5, fontWeight: 800, padding: "3px 10px", borderRadius: 20, cursor: "pointer", background: "rgba(34,197,94,0.14)",
            color: "#16a34a", border: "1px solid rgba(34,197,94,0.3)", marginLeft: 2 }}>⚖ Restituer</button>}
        <span style={{ marginLeft: "auto" }}/>
        {/* les bobines manquantes se voient meme replie */}
        {!open0 && onSpoolPick && filaments.some(f => !f.spool_id) && <span style={{ fontSize: 11, fontWeight: 800, color: "#d97706" }}>▸ {filaments.filter(f => !f.spool_id).length} à associer</span>}
        <span style={{ fontSize: 11, color: "var(--muted)", transform: open0 ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
      </div>
      {/* la repartition du poids */}
      {total > 0 && <div style={{ display: "flex", height: 9, borderRadius: 6, overflow: "hidden", gap: 3 }}>
        {filaments.map((f, i) => <span key={i} data-tip={`${f.filament_translated_name || f.filament_fila_type || f.filament_name || "Filament"} · ${Math.round(100 * (f.grams_used || 0) / total)} %`}
          style={{ flex: `${Math.max(0.02, (f.grams_used || 0) / total)} 1 0`, background: hex(f), borderRadius: 4,
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent)" }}/>)}
      </div>}
      {open0 && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filaments.map((f, i) => (
          <div key={i} onClick={() => open(f)} onContextMenu={e => { e.preventDefault(); menu(e, f); }}
            onPointerDown={e => { const t = setTimeout(() => { navigator.vibrate && navigator.vibrate(20); menu(e, f); }, 600); e.currentTarget._lpt = t; }}
            onPointerUp={e => clearTimeout(e.currentTarget._lpt)} onPointerLeave={e => clearTimeout(e.currentTarget._lpt)} onPointerCancel={e => clearTimeout(e.currentTarget._lpt)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 6px 7px 8px", borderRadius: 12,
              background: `linear-gradient(90deg, color-mix(in srgb, ${hex(f)} 16%, transparent), color-mix(in srgb, ${hex(f)} 4%, transparent))`,
              border: `1px solid color-mix(in srgb, ${hex(f)} 22%, var(--border))`, cursor: f.spool_id || isAdmin ? "pointer" : "default" }}>
            <ColorDot hex={f.color_hex} colors={f.filament_colors_array} multicolor={f.filament_multicolor_type} size={24} ring={f.spool_id ? "mapped" : "default"}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {f.filament_translated_name || f.filament_fila_type || f.filament_name || "Inconnu"}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {f.spool_id ? <span data-tip="Bobine associée" style={{ color: "#16a34a", fontWeight: 800 }}>✓ · </span>
                  : isAdmin && onSpoolPick ? <span style={{ color: "#d97706", fontWeight: 800 }}>▸ Associer · </span> : null}
                {/* la marque, et le type s'il n'est pas deja le titre */}
                {[f.filament_brand, (t => t !== (f.filament_translated_name || f.filament_fila_type || f.filament_name) ? t : null)(f.filament_fila_type || f.filament_type)]
                  .filter(Boolean).join(" · ")}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text)" }}>{(f.grams_used || 0).toFixed(1).replace(".", ",")} g</div>
              {/* le cout reel, puis le cout normal entre parentheses (toujours les deux) */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>{eur2(f.cost || 0)} ({eur2(f.normal_cost || 0)})</div>
            </div>
            {isAdmin && <button onClick={e => { e.stopPropagation(); menu(e, f); }} aria-label="Actions du filament"
              style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 9, border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 15 }}>⋯</button>}
          </div>))}
      </div>}
    </div>);
}

// telecharger un 3MF d'une impression (« source » : d'origine MakerWorld, « sliced » : tranche) ; group : ceux d'un
// groupe (un seul fichier s'ils sont identiques, sinon un zip)
async function download3mf(pid, kind, group = false) {
  try {
    const r = await client.get(group ? `/prints/groups/${pid}/3mf` : `/prints/${pid}/3mf`, { params: { kind }, responseType: "blob", timeout: 600000 });
    const cd = r.headers?.["content-disposition"] || "";
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url; a.download = m ? decodeURIComponent(m[1]) : group ? `groupe-${pid}.zip` : `impression-${pid}.3mf`;
    a.dispatchEvent(new MouseEvent("click"));
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    if (group && /\.zip$/i.test(a.download)) egg("demenageur");
  } catch (e) { showAlert(e.response?.status === 404 ? "Ce 3MF n'est pas sur le serveur." : (e.message || "Téléchargement impossible")); }
}

// onPrev / onNext (28/10/2026) : la fiche precedente / suivante de la liste d'ou elle vient (null = pas de fleche) ;
// deux boutons ronds ‹ › dans la barre du haut, et un glisse horizontal sur l'en-tete. Quand l'impression change,
// la fiche recharge ses donnees et replie ce qui etait ouvert (cout, identifiants, champs en edition).
export function PrintDetail({ p: pProp, onClose, onDelete, onChanged, onPrev = null, onNext = null }) {
  const [sharing, setSharing] = useState(false);
  const [ungrouped, setUngrouped] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [userPhotos, setUserPhotos] = useState([]);
  const loadUserPhotos = () => client.get(`/prints/${pProp.id}/photos`).then(r => setUserPhotos(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  useEffect(() => { loadUserPhotos(); }, [pProp.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const uploadPhoto = async (file) => { const fd = new FormData(); fd.append("file", file); await client.post(`/prints/${pProp.id}/photos/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } }); loadUserPhotos(); };
  const [p, setP] = useState(pProp);
  const [editFr, setEditFr] = useState(false);
  const [frVal, setFrVal] = useState("");
  useTrackDetail(`Fiche print · ${p?.file_name || pProp?.file_name || "#" + pProp.id}`);
  const scrollRef = useRef(null);
  const firstId = useRef(pProp.id);
  useEffect(() => {
    if (pProp.total_cost_filament == null) client.get("/prints/" + pProp.id).then(r => setP(r.data)).catch(() => setP(pProp));
    else setP(pProp);
    if (firstId.current !== pProp.id) {
      // une autre impression dans la meme fiche (‹ › ou glisse) : etat propre, retour en haut
      firstId.current = pProp.id;
      setUngrouped(false); setEditFr(false); setEditNb(false); setCostOpen(false); setIdsOpen(false); setUserPhotos([]);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [pProp.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // le glisse horizontal sur l'en-tete : vers la gauche la suivante, vers la droite la precedente (seuil 60 px) ; ignore quand
  // le doigt part d'une bande qui defile a l'horizontale, ou quand le geste est surtout vertical (le defilement de la fiche)
  const swipe = useRef(null);
  const swipeStart = e => {
    swipe.current = null;
    if (!onPrev && !onNext) return;
    for (let el = e.target; el && el !== e.currentTarget; el = el.parentElement) {
      const ox = getComputedStyle(el).overflowX;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth) return;
    }
    swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const swipeEnd = e => {
    const s = swipe.current; swipe.current = null;
    if (!s || !e.changedTouches?.length) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) onNext?.(); else onPrev?.();
    egg("feuilleteur");
  };
  // au clavier : ← → (hors d'un champ de saisie)
  useEffect(() => {
    if (!onPrev && !onNext) return;
    const k = e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "")) return;
      if (e.key === "ArrowLeft" && onPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === "ArrowRight" && onNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onPrev, onNext]);
  const isAdmin = useIsAdmin();
  const visiting = useFriend(s => s.friend);
  const toRateSet = useToRateSet(!visiting && !!pProp.design_id);
  const groupe = ungrouped ? null : p.group_name;
  const [editNb, setEditNb] = useState(false);
  const [spoolPicker, setSpoolPicker] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [objCreate, setObjCreate] = useState(null);
  const [unmapping, setUnmapping] = useState(null);
  const [, setPhotoCount] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selSpool, setSelSpool] = useState(null);
  // le detail du cout : ouvert par defaut (comme l'ancien bloc) ; l'appareil retient le choix
  // le compte des objets crees (pour l'entree du menu, comme le faisait le bouton)
  const [objQ, setObjQ] = useState(null);
  useEffect(() => {
    if (!isAdmin) return;
    client.get("/objects/objects/quota", { params: { parent_type: "print", parent_id: pProp.id } }).then(r => setObjQ(r.data)).catch(() => setObjQ(null));
  }, [pProp.id, refreshKey, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  const [idsOpen, setIdsOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);   // replie a chaque ouverture
  const [localNb, setLocalNb] = useState(pProp.number_of_items || 1);
  const [nbVal, setNbVal] = useState(String(pProp.number_of_items || 1));
  useEffect(() => { setLocalNb(p.number_of_items || 1); setNbVal(String(p.number_of_items || 1)); }, [p.number_of_items]);
  const wide = typeof window !== "undefined" && window.innerWidth >= 900;
  const saveNb = async () => {
    const n = parseInt(nbVal);
    if (!isNaN(n) && n >= 1) {
      try { await client.patch(`/prints/${p.id}`, { number_of_items: n }); setLocalNb(n); onChanged?.({ ...p, number_of_items: n }); } catch { /* garde l'ancien */ }
    }
    setEditNb(false);
  };
  const SNAP_LABELS = { "snapshot-layer1": "Couche 1", "snapshot-layer2": "Couche 2", "pct50": "50%", "snapshot-pct50": "50%", "pct99": "99%",
    "snapshot-pct99": "99%", "pct100": "100%", "snapshot-pct100": "100%", "fail": "Échec", "manual": "Manuel" };
  const handleUngroup = async () => {
    if (!(await showConfirm("Retirer ce print de son groupe ?"))) return;
    try { await client.post("/prints/" + p.id + "/group", {}); setUngrouped(true); onChanged?.(); }
    catch (err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };
  const reload = () => client.get("/prints/" + p.id).then(r => { setP(r.data); setRefreshKey(k => k + 1); }).catch(() => {});
  // hors des classements de la page Stats (echantillons, supports…) ; le groupe peut l'imposer a toutes ses impressions
  const toggleRanked = async () => {
    const v = !p.stats_excluded;
    try { await client.patch(`/prints/${p.id}`, { stats_excluded: v }); setP(prev => ({ ...prev, stats_excluded: v ? 1 : 0 })); onChanged?.(); }
    catch (err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };
  const costFil = p.total_cost_filament || 0, costNormal = p.total_cost_filament_normal || 0, costElec = p.electric_cost || 0;
  const totalBobine = costFil + costElec, totalNormal = costNormal + costElec;
  const [stL, stC, stI] = V2_STATUS[p.status] || [p.status || "—", "#94a3b8", "•"];
  const [day, hour] = whenFr(utcDate(p.print_date));
  const dur = p.duration_seconds || p.estimated_seconds;
  const fils = p.filament_usage || [];
  const more = e => openMenu(e, {
    title: p.file_name || "Sans nom", subtitle: `${stL} · ${day} ${hour.split(" · ")[0]}`, color: stC,
    items: [
      { icon: "✏️", label: "Éditer", hint: "Nom, date, état, quantité…", tone: "#3B82F6", onClick: () => setEditMode(true) },
      { icon: "📣", label: "Partager", hint: "Telegram", tone: "#229ED9", onClick: () => setSharing(true) },
      objQ && objQ.remaining > 0 ? { icon: "📦", label: "Créer des objets", hint: `${objQ.used} / ${objQ.total} déjà créés`, tone: "#22C55E",
        onClick: () => setObjCreate({ name: p.file_name || "Sans nom", cost: totalBobine }) }
        : objQ ? { icon: "📦", label: "Objets : tous créés", hint: `${objQ.used} / ${objQ.total}`, tone: "#22C55E", onClick: () => setObjCreate({ name: p.file_name || "Sans nom", cost: totalBobine }) } : null,
      groupe && { icon: "⛓", label: "Retirer du groupe", hint: groupe, tone: "#A78BFA", onClick: handleUngroup },
      isAdmin && (p.group_stats_excluded
        ? { icon: "📊", label: "Hors classements des stats", hint: "Imposé par son groupe", tone: "#64748B", disabled: true }
        : { icon: "📊", label: p.stats_excluded ? "Remettre dans les classements des stats" : "Retirer des classements des stats",
            hint: p.stats_excluded ? "Il compte de nouveau dans les tops" : "Les totaux le comptent toujours", tone: "#64748B", onClick: toggleRanked }),
      (p.source_3mf || p.model_3mf || (p.design_id && p.mw_profile_id)) && "-",
      p.source_3mf && { icon: "⤓", label: "Télécharger le 3MF d'origine", hint: "MakerWorld · à retrancher", tone: "#F97316", onClick: () => download3mf(p.id, "source") },
      !p.source_3mf && p.design_id && p.mw_profile_id && { icon: "⇣", label: "Récupérer le 3MF d'origine", hint: "depuis MakerWorld", tone: "#F97316",
        onClick: async () => { try { await client.post(`/makerworld/source3mf/print/${p.id}`); setP(prev => ({ ...prev, source_3mf: true })); toast("3MF d'origine récupéré"); }
          catch (e) { showAlert(e.response?.data?.detail || e.message); } } },
      p.model_3mf && { icon: "⤓", label: "Télécharger le 3MF tranché", hint: "pour mon imprimante", tone: "#F59E0B", onClick: () => download3mf(p.id, "sliced") },
      isAdmin && p.has_vue3d && { icon: p.thumb_3d ? "🖼" : "🧊", label: p.thumb_3d ? "Vignette : image du plateau" : "Vignette : vue 3D assemblée",
        hint: p.thumb_3d ? "Revenir à l'image du plateau" : "Celle prise dans la vue 3D", tone: "#0EA5E9",
        onClick: async () => { try { await client.put(`/prints/${p.id}/thumb`, { use3d: !p.thumb_3d }); setP(prev => ({ ...prev, thumb_3d: !prev.thumb_3d, updated_at: new Date().toISOString() }));
          window.dispatchEvent(new Event("bn-prints-changed")); } catch (e) { showAlert(e.response?.data?.detail || e.message); } } },
      (p.job_id || p.design_id) && { icon: "#", label: "Identifiants", hint: "Travail, modèle MakerWorld", tone: "#64748B", onClick: () => setIdsOpen(true) },
      "-",
      { icon: "🗑", label: "Supprimer…", danger: true, onClick: () => setShowDeleteConfirm(true) },
    ],
  });
  const tile = (label, value, sub, c1, c2, onClick, tip) => (
    <button onClick={onClick} disabled={!onClick} data-tip={tip} style={{ minWidth: 0, padding: "9px 8px", borderRadius: 16, border: `1px solid color-mix(in srgb, ${c1} 22%, var(--border))`,
      background: `radial-gradient(90% 70% at 100% 0%, ${c1}22, transparent 70%), var(--surface2)`, cursor: onClick ? "pointer" : "default", textAlign: "left",
      font: "inherit", color: "inherit", display: "flex", flexDirection: "column", gap: 1, boxShadow: `0 6px 18px -12px ${c1}` }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...v2grad(c1, c2) }}>{value}</span>
      {sub && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>}
    </button>);
  // l'en-tete : le plateau en grand, le titre et l'etat poses dessus
  const hero = (
    <div onTouchStart={swipeStart} onTouchEnd={swipeEnd} onTouchCancel={() => { swipe.current = null; }}
      style={{ position: "relative", height: wide ? 300 : "min(36vh, 280px)", minHeight: 200, borderRadius: wide ? 20 : 0, overflow: "hidden",
      background: "var(--surface2)" }}>
      {/* le fond : l'image floutee et saturee, une lueur de la couleur de l'etat */}
      <img src={thumbUrl(p, 128)} alt="" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
        objectFit: "cover", filter: "blur(26px) saturate(1.6)", opacity: 0.4, transform: "scale(1.3)" }} onError={e => { e.currentTarget.style.display = "none"; }}/>
      <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: `radial-gradient(60% 70% at 50% 38%, ${stC}33, transparent 72%)` }}/>
      <img src={thumbUrl(p, 512)} alt="" className="bn-plate" style={{ position: "absolute", inset: "4% 8% 26%", width: "84%", height: "70%",
        objectFit: "contain", filter: "drop-shadow(0 14px 24px rgba(0,0,0,.35))" }}
        onError={e => { e.currentTarget.style.display = "none"; }}/>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "34px 16px 12px",
        background: "linear-gradient(transparent, color-mix(in srgb, var(--sheet-bg) 92%, transparent) 55%)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <h2 style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 19, fontWeight: 900, color: "var(--text)", letterSpacing: "-.01em", lineHeight: 1.2,
            overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.file_name || "Sans nom"}</h2>
        </div>
        {p.original_name && p.original_name !== p.file_name && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.original_name}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 900,
            color: "#fff", background: `linear-gradient(135deg, ${stC}, color-mix(in srgb, ${stC} 70%, #ffffff))`, boxShadow: `0 4px 14px ${stC}55` }}>{stI} {stL}</span>
          {!visiting && <NasChip count={p.nas_only} url={`/prints/${p.id}/nas`}/>}
          {groupe && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px 2px 9px", borderRadius: 20, fontSize: 11.5, fontWeight: 800,
            color: "#a78bfa", background: "rgba(167,139,250,0.16)" }}>📁 {groupe}
            <AdminOnly><button onClick={handleUngroup} aria-label="Retirer du groupe" data-tip="Retirer du groupe" style={{ background: "none", border: "none",
              color: "#a78bfa", cursor: "pointer", padding: 0, display: "flex" }}><X size={12}/></button></AdminOnly></span>}
          {(p.stats_excluded || p.group_stats_excluded) ? <span data-tip={p.group_stats_excluded ? "Son groupe est hors des classements de la page Stats (les totaux le comptent)"
            : "Hors des classements de la page Stats (les totaux le comptent)"} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px",
            borderRadius: 20, fontSize: 11.5, fontWeight: 800, color: "#64748b", background: "color-mix(in srgb, #64748b 14%, transparent)" }}>📊 hors classements</span> : null}
          {/* le nom de recherche (ne remplace jamais le titre) */}
          {editFr ? null : <AdminOnly>
            <button onClick={() => { setFrVal(p.translated_name || ""); setEditFr(true); }}
              data-tip={p.translated_name ? (TRAD_BY[p.translated_by] || "Origine inconnue (traduit avant le suivi du service)") : "Le nom sous lequel tu la cherches"}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 20, fontSize: 11.5, fontWeight: 700,
                border: "1px solid var(--border)", background: "color-mix(in srgb, var(--surface) 70%, transparent)", color: "var(--muted)", cursor: "pointer",
                maxWidth: "100%", overflow: "hidden" }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>🔎 {p.translated_name || "Nom de recherche"}</span><Pencil size={10}/></button>
          </AdminOnly>}
        </div>
        {editFr && <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input value={frVal} onChange={e => setFrVal(e.target.value)} autoFocus placeholder="Nom en français (recherche)"
            style={{ flex: 1, minWidth: 0, fontSize: 13, padding: "6px 10px", borderRadius: 9, background: "var(--surface2)", border: "1px solid var(--border)",
              color: "var(--text)", outline: "none" }}/>
          <button onClick={async () => {
            const v = frVal.trim();
            try { await client.patch(`/prints/${p.id}`, { translated_name: v }); setP(prev => ({ ...prev, translated_name: v, translated_by: v ? "manuel" : null })); onChanged && onChanged(); }
            catch (e) { showAlert(e.response?.data?.detail || e.message); }
            setEditFr(false);
          }} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 9, cursor: "pointer", border: "none", background: "#3b82f6", color: "white", fontWeight: 700 }}>OK</button>
          <button onClick={() => setEditFr(false)} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 9, cursor: "pointer", border: "1px solid var(--border)",
            background: "transparent", color: "var(--muted)" }}>✕</button>
        </div>}
      </div>
    </div>);
  // les chiffres : quand, duree, poids, cout (le cout se deplie)
  const figures = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
        {tile("📅 Quand", day, hour, "#3B82F6", "#60A5FA", null, fmtDate(p.print_date))}
        {tile("⏱ Durée", dur > 0 ? durFr(dur) : "—", p.duration_seconds ? null : dur > 0 ? "estimée" : null, "#8B5CF6", "#C084FC")}
        {tile("⚖ Poids", p.total_weight_g > 0 ? gFr(p.total_weight_g) : "—", null, "#F59E0B", "#FBBF24")}
        {tile(<>💶 Coût<span>{costOpen ? "▴" : "▾"}</span></>, eur2(totalBobine), `(${eur2(totalNormal)})`, "#16A34A", "#4ADE80", () => setCostOpen(o => !o),
          "Le prix réel, puis le prix normal entre parenthèses ; touche pour le détail")}
      </div>
      {costOpen && (
        <div style={{ padding: "10px 12px", borderRadius: 16, border: "1px solid color-mix(in srgb, #16A34A 22%, var(--border))", display: "flex",
          flexDirection: "column", gap: 7, fontSize: 12.5, background: "radial-gradient(80% 60% at 100% 0%, #16A34A18, transparent 70%), var(--surface2)" }}>
          {/* le prix reel en couleur, puis le prix normal entre parentheses */}
          {[["🧵", "Filament", eur2(costFil), eur2(costNormal), "#F97316", "#FDBA74"], ["⚡", "Électricité", eur2(costElec), null, "#EAB308", "#FDE047"],
            ["💶", "Total", eur2(totalBobine), eur2(totalNormal), "#16A34A", "#4ADE80"]].map(([ic, l, v, s, c1, c2]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, padding: l === "Total" ? "6px 0 0" : 0,
              borderTop: l === "Total" ? "1px dashed var(--border)" : "none" }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                background: `color-mix(in srgb, ${c1} 16%, transparent)`, flexShrink: 0 }}>{ic}</span>
              <span style={{ flex: 1, fontWeight: 800, color: "var(--muted)", fontSize: 12 }}>{l}</span>
              <span style={{ fontWeight: 900, fontSize: l === "Total" ? 15 : 13.5, ...v2grad(c1, c2) }}>{v}</span>
              {s ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", minWidth: 60 }}>({s})</span> : <span style={{ minWidth: 60 }}/>}</div>))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 7 }}>
            <span style={{ fontWeight: 800, color: "#16a34a" }}>{localNb} élément{localNb > 1 ? "s" : ""}</span>
            {localNb > 1 && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#16a34a" }}>· {eur2(totalBobine / localNb)}/u ({eur2(totalNormal / localNb)}/u)</span>}
            <span style={{ marginLeft: "auto" }}/>
            {!editNb ? <AdminOnly><button onClick={() => { setNbVal(String(localNb)); setEditNb(true); }} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 7,
              border: "1px solid rgba(34,197,94,0.35)", background: "none", color: "#16a34a", cursor: "pointer", fontWeight: 700 }}>Modifier</button></AdminOnly>
              : <span style={{ display: "flex", gap: 5 }}>
                <input type="number" min="1" value={nbVal} onChange={e => setNbVal(e.target.value)} autoFocus style={{ width: 58, padding: "3px 6px", borderRadius: 7,
                  border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12.5 }}/>
                <button onClick={saveNb} style={{ padding: "3px 10px", borderRadius: 7, border: "none", background: "#22c55e", color: "white", cursor: "pointer" }}>✓</button>
                <button onClick={() => setEditNb(false)} style={{ padding: "3px 8px", borderRadius: 7, border: "none", background: "var(--surface)", color: "var(--muted)", cursor: "pointer" }}>✕</button>
              </span>}
          </div>
        </div>)}
    </div>);
  const canRate = !!p.design_id && (p.status === "SUCCESS" || p.status === "PARTIAL") && toRateSet.has(String(p.design_id));
  const sections = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SnapshotGallery snaps={[]} printId={p.id} userPhotos={userPhotos}
        onDelete={() => {}} onUpload={async f => { await uploadPhoto(f); }}
        onDeleteUpload={async filename => { await client.delete(`/prints/${p.id}/upload/${filename}`); loadUserPhotos(); }}
        onCountChange={setPhotoCount} coverPhoto={p.cover_photo}
        onCoverChange={name => { setP(prev => ({ ...prev, cover_photo: name })); onChanged?.(); }}/>
      {/* les filaments ont deja leur titre repliable (et « Restituer ») */}
      {fils.length > 0 && <FilamentsV2 filaments={fils} onSpoolClick={setSelSpool} onSpoolPick={setSpoolPicker}
        onRestore={() => setShowDeleteConfirm("restore")} onUnmap={setUnmapping}/>}
      {p.design_id && <MakerWorldCard designId={p.design_id} prints={[p]} rateElsewhere/>}
      {p.status_note && <div style={{ position: "relative", padding: "12px 14px 12px 18px", borderRadius: 16, overflow: "hidden",
        background: "linear-gradient(135deg, color-mix(in srgb, #A855F7 12%, transparent), transparent 70%), var(--surface2)", border: "1px solid var(--border)" }}>
        <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 4, borderRadius: 4, background: "linear-gradient(#A855F7, #EC4899)" }}/>
        <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#A855F7", marginBottom: 4 }}>💬 Commentaire</div>
        <p style={{ fontSize: 13.5, color: "var(--text)", margin: 0, lineHeight: 1.5, fontStyle: "italic" }}>« {p.status_note} »</p></div>}

    </div>);
  return (
    <>
      <div data-no-pull="" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: wide ? "center" : "flex-end",
        justifyContent: "center", padding: wide ? 20 : 0 }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} className="sheet-inner" style={{ background: "var(--sheet-bg)", borderRadius: wide ? 24 : "22px 22px 0 0",
          width: "100%", maxWidth: wide ? 980 : 640, maxHeight: wide ? "90dvh" : "94dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative" }}>
            {/* la barre du haut : poignee, ‹ › a gauche (quand la fiche vient d'une liste), ⋯ et ✕ par-dessus l'image */}
            <div style={{ position: "sticky", top: 0, zIndex: 10, height: 0 }}>
              {!wide && <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", width: 38, height: 4, borderRadius: 2, background: "rgba(148,163,184,.6)" }}/>}
              {(onPrev || onNext) && <div style={{ position: "absolute", top: 10, left: 12, display: "flex", gap: 8 }}>
                <button onClick={onPrev || undefined} disabled={!onPrev} aria-label="Impression précédente" data-tip={onPrev ? "Précédente" : undefined}
                  style={{ ...v2Round, fontSize: 20, opacity: onPrev ? 1 : 0.3, cursor: onPrev ? "pointer" : "default" }}>‹</button>
                <button onClick={onNext ? () => { onNext(); egg("feuilleteur"); } : undefined} disabled={!onNext} aria-label="Impression suivante" data-tip={onNext ? "Suivante" : undefined}
                  style={{ ...v2Round, fontSize: 20, opacity: onNext ? 1 : 0.3, cursor: onNext ? "pointer" : "default" }}>›</button>
              </div>}
              <div style={{ position: "absolute", top: 10, right: 12, display: "flex", gap: 8 }}>
                {canRate && <RateStar designs={[p.design_id]} name={p.file_name} enabled={!visiting}/>}
                {isAdmin && <button onClick={more} aria-label="Plus d'actions" style={v2Round}>⋯</button>}
                <button onClick={onClose} aria-label="Fermer" style={v2Round}>✕</button>
              </div>
            </div>
            {wide ? (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)", gap: 18, padding: 18 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{hero}{figures}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 34 }}>{sections}</div>
              </div>
            ) : <>{hero}<div style={{ padding: "12px 14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>{figures}{sections}</div></>}
          </div>
          {/* les actions, toujours a portee du pouce */}
          {isAdmin && <div style={{ flexShrink: 0, display: "flex", gap: 8, padding: "10px 14px calc(10px + env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid var(--border)", background: "color-mix(in srgb, var(--sheet-bg) 94%, transparent)", backdropFilter: "blur(8px)" }}>
            <button onClick={() => setEditMode(true)} style={{ ...v2Btn, flex: 1 }}>✏️ Éditer</button>
            <button onClick={() => setSharing(true)} style={{ ...v2Btn, flex: 1, color: "#229ED9", borderColor: "rgba(34,158,217,0.35)", background: "rgba(34,158,217,0.08)" }}>📣 Partager</button>
            <button onClick={more} aria-label="Plus d'actions" style={{ ...v2Btn, width: 48, flex: "0 0 auto" }}>⋯</button>
          </div>}
        </div>
      </div>
      {idsOpen && createPortal(<div onClick={() => setIdsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 6500, background: "rgba(2,6,23,0.5)",
        backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={e => e.stopPropagation()} style={{ width: "min(380px, 100%)", borderRadius: 20, overflow: "hidden", background: "var(--sheet-bg)",
          border: "1px solid var(--border)", boxShadow: "0 30px 80px rgba(0,0,0,0.45)", animation: "bn-pop .2s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "linear-gradient(135deg, #64748B38, transparent 70%)" }}>
            <span style={{ width: 36, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "#64748B",
              color: "#fff", fontWeight: 900 }}>#</span>
            <span style={{ flex: 1, fontSize: 16, fontWeight: 900, color: "var(--text)" }}>Identifiants</span>
            <button onClick={() => setIdsOpen(false)} aria-label="Fermer" style={v2Round}>✕</button>
          </div>
          <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {[["Travail (imprimante)", p.job_id], ["Modèle MakerWorld", p.design_id], ["Profil MakerWorld", p.mw_profile_id], ["Impression", p.id]].filter(x => x[1]).map(([l, v]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 12, background: "var(--surface2)" }}>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", userSelect: "all" }}>{v}</span>
                <button onClick={() => { try { navigator.clipboard.writeText(String(v)); toast("Copié"); } catch { /* indisponible */ } }} aria-label="Copier"
                  data-tip="Copier" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>⧉</button>
              </div>))}
          </div>
        </div></div>, document.body)}
      {objCreate && <ObjectCreateSheet parentType="print" parentId={p.id} defaultName={objCreate.name} costFabrication={objCreate.cost}
        onDone={() => { setRefreshKey(k => k + 1); onChanged?.(); }} onClose={() => setObjCreate(null)}/>}
      {sharing && <ShareSheet kind="print" id={p.id} onClose={() => setSharing(false)}/>}
      {spoolPicker && <SpoolMapPicker usageId={spoolPicker.usageId} printId={p.id} colorHex={spoolPicker.colorHex} colorsArray={spoolPicker.colorsArray}
        multicolorType={spoolPicker.multicolorType} filamentType={spoolPicker.filamentType} onClose={() => setSpoolPicker(null)}
        onMapped={() => { setSpoolPicker(null); reload(); onChanged?.(); }}/>}
      {selSpool && <FilamentSheetFromSpool filamentId={selSpool.filId} spoolId={selSpool.spoolId} filamentColorHex={selSpool.hex} onClose={() => setSelSpool(null)} zIndex={2000}/>}
      {editMode && <PrintEditSheet p={p} onClose={() => setEditMode(false)} onSaved={updated => { setP(prev => ({ ...prev, ...updated })); setEditMode(false); onChanged?.(); }}/>}
      {unmapping && <UnmapFilamentConfirm f={unmapping} printId={p.id} onClose={() => setUnmapping(null)} onDone={() => { setUnmapping(null); reload(); onChanged?.(); }}/>}
      {showDeleteConfirm && <DeletePrintConfirm p={p} restoreOnly={showDeleteConfirm === "restore"} onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={async fracs => {
          const hasRestore = Object.values(fracs).some(v => v > 0);
          if (hasRestore) await client.post("/prints/" + p.id + "/restore-weights", { fracs }).catch(() => {});
          if (showDeleteConfirm !== "restore") { client.delete("/prints/" + p.id).then(() => { onDelete?.(p.id); onClose(); }).catch(() => showAlert("Erreur")); }
          else { setShowDeleteConfirm(false); reload(); onChanged?.(); }
        }}/>}
    </>);
}
// l'etoile de la barre du haut : un modele attend une evaluation ; la toucher l'ouvre (plus de bandeau au milieu)
function RateStar(props) {
  return <RateStarBtn {...props} style={{ ...v2Round, border: "none", background: "linear-gradient(135deg, #F59E0B, #FBBF24)", color: "#fff",
    boxShadow: "0 6px 16px rgba(245,158,11,.45)", animation: "bn-float 3s ease-in-out infinite" }}/>;
}
const v2Round = { width: 34, height: 34, borderRadius: "50%", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--sheet-bg) 80%, transparent)",
  backdropFilter: "blur(6px)", color: "var(--text2)", cursor: "pointer", fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" };
const v2Btn = { padding: "11px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13.5,
  fontWeight: 800, cursor: "pointer" };


function GroupEditSheet({ groupId, name, onClose, onSaved }) {
  useTrackDetail("Historique · Modifier un groupe");
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
      display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={onClose}>
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

// les photos du groupe (nouvelle fiche) : une bande qui defile ; ⭐ la vignette, 🗑 en deux temps, visionneuse
function GroupPhotosV2({ groupId, onUpdated, prints = [] }) {   // prints : relire Technique quand la liste change
  const [photos, setPhotos] = useState([]);
  const [tab, setTab] = useState("souv");
  const [tech, setTech] = useState(null);        // par impression : { p, tl, snaps }
  const [tlb, setTlb] = useState(-1);
  const [allTech, setAllTech] = useState(false);   // les 4 premieres impressions, puis « Voir les autres »
  const [cover, setCover] = useState(null);
  const [armed, setArmed] = useState(null);
  const [lb, setLb] = useState(-1);
  const load = () => client.get(`/prints/groups/${groupId}/photos`).then(r => { setPhotos(r.data?.files || []); setCover(r.data?.cover_photo || null); }).catch(() => {});
  useEffect(() => { if (groupId) load(); }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async file => { const fd = new FormData(); fd.append("file", file);
    await client.post(`/prints/groups/${groupId}/photos/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } }); load(); };
  const setCoverPhoto = async name => { try { await client.post(`/prints/groups/${groupId}/photo/${name}/cover`); setCover(name); onUpdated?.(); } catch (e) { showAlert(e.response?.data?.detail || e.message); } };
  const del = async name => { try { await client.delete(`/prints/groups/${groupId}/photo/${name}`); setArmed(null); load(); } catch (e) { showAlert(e.response?.data?.detail || e.message); } };
  const imgs = photos.filter(x => !isVideoUrl(x.url));
  // Technique : pour chaque impression du groupe, son timelapse et ses captures des couches (une requete,
  // faite a l'ouverture : l'onglet affiche son nombre tout de suite)
  const pkey = prints.map(x => x.id).join(",");
  useEffect(() => {
    if (!groupId) return undefined;
    let alive = true;
    client.get(`/prints/groups/${groupId}/tech`).then(r => {
      if (!alive) return;
      setTech((r.data?.prints || []).map(x => ({ p: { id: x.id, translated_name: x.name, print_date: x.print_date }, plate: x.plate,
        tl: x.timelapse ? { url: x.timelapse } : null,
        snaps: (x.snaps || []).sort((a, b) => snapRank(a.name) - snapRank(b.name))
          .map(f => ({ url: f.url, label: SNAP_NAMES[snapKey(f.name)] || snapKey(f.name) })) })));
    }).catch(() => { if (alive) setTech([]); });
    return () => { alive = false; };
  }, [groupId, pkey]);
  const techFlat = (tech || []).flatMap(r => [...(r.tl ? [{ url: r.tl.url, label: `Timelapse · ${r.p.translated_name || r.p.file_name || ""}` }] : []),
    ...r.snaps.map(s => ({ url: s.url, label: `${s.label} · ${r.p.translated_name || r.p.file_name || ""}` }))]);
  const techN = tech ? techFlat.length : 0;
  const when = d => d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
  return (
    <div className="card-sm" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px" }}>
      {lb >= 0 && <Lightbox images={imgs.map(x => x.url)} index={lb} onClose={() => setLb(-1)}/>}
      {tlb >= 0 && <Lightbox images={techFlat} index={tlb} onClose={() => setTlb(-1)}/>}
      <MediaTabs tab={tab} setTab={setTab} souv={photos.length} tech={techN}
        right={tab === "souv" ? <PhotoAddButton onPick={f => upload(f)}/> : null}/>
      {tab === "tech" && (!tech ? <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 6px" }}>⏳ Lecture des impressions du groupe…</p>
        : !tech.length ? <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 6px" }}>Ni timelapse ni capture des couches pour ses impressions.</p>
        : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(allTech ? tech : tech.slice(0, 4)).map(r => { const base = techFlat.findIndex(x => x.url === (r.tl?.url || r.snaps[0]?.url));
            return (
              <div key={r.p.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {r.plate && <img src={r.plate} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
                    style={{ width: 30, height: 30, borderRadius: 8, objectFit: "contain", flexShrink: 0, background: "var(--surface2)", border: "1px solid var(--border)" }}/>}
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                    {r.p.translated_name || r.p.file_name || `Impression ${r.p.id}`} <span style={{ color: "var(--muted)", fontWeight: 700 }}>· {when(r.p.print_date)}</span></span></span>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, alignItems: "center", touchAction: "pan-x pan-y", overscrollBehaviorX: "contain" }}>
                  {r.tl && <TimelapseTile small url={r.tl.url} onOpen={() => setTlb(base)}/>}
                  {r.snaps.map((s, i) => (
                    <div key={s.url} onClick={() => setTlb(base + (r.tl ? 1 : 0) + i)} style={{ position: "relative", flexShrink: 0, cursor: "zoom-in" }}>
                      <img src={s.url} alt={s.label} style={{ height: 84, width: "auto", borderRadius: 8, display: "block", boxShadow: "0 0 0 1px var(--border)" }}/>
                      <span style={{ position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.65)", color: "white", fontSize: 9, fontWeight: 700,
                        padding: "2px 6px", borderRadius: 4, pointerEvents: "none" }}>{s.label}</span>
                    </div>))}
                </div>
              </div>); })}
          {!allTech && tech.length > 4 && <button onClick={() => setAllTech(true)} style={{ ...fBtn, alignSelf: "flex-start", fontSize: 12.5, padding: "6px 12px" }}>
            Voir les {tech.length - 4} autres impressions</button>}
        </div>)}
      {tab === "souv" && !photos.length && <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 6px" }}>Aucune photo du groupe : ajoute la première avec ＋.</p>}
      {tab === "souv" && photos.length > 0 && <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, touchAction: "pan-x pan-y", overscrollBehaviorX: "contain" }}>
        {photos.map((ph, i) => { const isCover = cover === ph.name, arm = armed === ph.name;
          return (
            <div key={i} style={{ position: "relative", flexShrink: 0, borderRadius: 14, overflow: "hidden",
              boxShadow: isCover ? "0 0 0 2px #22c55e" : "0 0 0 1px var(--border)" }}>
              {isVideoUrl(ph.url)
                ? <video src={ph.url} muted loop autoPlay playsInline preload="metadata" style={{ height: 110, width: 110, objectFit: "cover", display: "block" }}/>
                : <img src={ph.url} alt="" onClick={() => setLb(imgs.findIndex(x => x.url === ph.url))}
                  style={{ height: 110, width: 110, objectFit: "cover", display: "block", cursor: "zoom-in" }}/>}
              <AdminOnly>
                <button onClick={() => !isCover && setCoverPhoto(ph.name)} data-tip={isCover ? "Vignette de la galerie" : "Définir comme vignette"}
                  style={{ position: "absolute", top: 5, left: 5, width: 24, height: 24, borderRadius: "50%", border: "none", cursor: isCover ? "default" : "pointer",
                    background: "rgba(0,0,0,0.55)", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center",
                    filter: isCover ? "none" : "grayscale(1)", opacity: isCover ? 1 : 0.8 }}>⭐</button>
                <button onClick={() => arm ? del(ph.name) : setArmed(ph.name)} onBlur={() => setArmed(null)} data-tip={arm ? "Confirmer la suppression" : "Supprimer"}
                  style={{ position: "absolute", top: 5, right: 5, height: 24, width: arm ? "auto" : 24, padding: arm ? "0 8px" : 0, borderRadius: 12, border: "none",
                    cursor: "pointer", background: arm ? "#ef4444" : "rgba(0,0,0,0.55)", color: "white", fontSize: arm ? 10.5 : 12, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center" }}>{arm ? "Supprimer ?" : "🗑"}</button>
              </AdminOnly>
            </div>); })}
      </div>}
    </div>);
}

export function GroupBottomSheet({ groupId, name, number_of_items: nbItemsProp, cover_print_id: coverPrintIdProp, onClose, onDelete, onUngroup, onUpdated }) {
  useTrackDetail(`Fiche groupe · ${name || "#" + groupId}`);
  const isAdmin = useIsAdmin();
  const groupVisiting = useFriend(s => s.friend);
  const [prints, setPrints] = useState([]);
  const [sharing, setSharing] = useState(false);
  const [nbItems, setNbItems] = useState(nbItemsProp || 1);
  const [editNb, setEditNb] = useState(false);
  const [nbVal, setNbVal] = useState(String(nbItemsProp || 1));
  const [selectedPrint, setSelectedPrint] = useState(null);
  const [selSpool, setSelSpool] = useState(null);
  const [unmapping, setUnmapping] = useState(null);
  const [coverPrintId, setCoverPrintId] = useState(coverPrintIdProp || null);
  const [objCreate, setObjCreate] = useState(false);
  const [objRefresh, setObjRefresh] = useState(0);
  const [objQ, setObjQ] = useState(null);
  const [editGroup, setEditGroup] = useState(false);
  const [costOpen, setCostOpen] = useState(false);     // replie a chaque ouverture
  const [grid, setGrid] = useState(false);              // les impressions en rangees, ou en grille
  const [listOpen, setListOpen] = useState(false);      // les impressions : repliees a chaque ouverture
  const groupToRate = useToRateSet(!groupVisiting);
  const wide = typeof window !== "undefined" && window.innerWidth >= 900;
  const loadPrints = () => client.get("/prints", { params: { group_id: groupId, limit: 200 } }).then(r => {
    const d = r.data; setPrints(Array.isArray(d) ? d : Array.isArray(d?.prints) ? d.prints : []); }).catch(() => {});
  useEffect(() => { if (groupId) loadPrints(); }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isAdmin) return;
    client.get("/objects/objects/quota", { params: { parent_type: "group", parent_id: groupId } }).then(r => setObjQ(r.data)).catch(() => setObjQ(null));
  }, [groupId, objRefresh, isAdmin]);
  const title = prints.find(x => x.group_name)?.group_name || name || "Groupe sans nom";
  const totalDur = prints.reduce((s, x) => s + (x.duration_seconds || x.estimated_seconds || 0), 0);
  const totalW = prints.reduce((s, x) => s + (x.total_weight_g || 0), 0);
  // le prix reel (total_cost) et, entre parentheses, le prix normal (filament au tarif catalogue + electricite)
  const totalCost = prints.reduce((s, x) => s + (x.total_cost || 0), 0);
  const totalNormal = prints.reduce((s, x) => s + (x.total_cost_filament_normal || 0) + (x.electric_cost || 0), 0);
  const filsMap = {};
  prints.forEach(x => (x.filament_usage || []).forEach(f => {
    const key = f.spool_id || f.color_hex || f.filament_name || "?";
    if (!filsMap[key]) filsMap[key] = { ...f, print_id: x.id, grams_used: 0, cost: 0, normal_cost: 0 };
    filsMap[key].grams_used += f.grams_used || 0; filsMap[key].cost += f.cost || 0; filsMap[key].normal_cost += f.normal_cost || 0;
  }));
  const filaments = Object.values(filsMap).sort((a, b) => (b.grams_used || 0) - (a.grams_used || 0));
  const counts = prints.reduce((m, x) => { m[x.status] = (m[x.status] || 0) + 1; return m; }, {});
  const latest = prints.reduce((d, x) => { const t = utcDate(x.print_date); return t && (!d || t > d) ? t : d; }, null);
  const [lDay, lHour] = whenFr(latest);
  const designs = (() => { const cpt = {}; prints.forEach(x => { const d = String(x.design_id || "").trim(); if (d && d !== "0") cpt[d] = (cpt[d] || 0) + 1; });
    return Object.keys(cpt).sort((a, b) => cpt[b] - cpt[a]).map(d => [d, cpt[d]]); })();
  const saveNb = async () => {
    const n = parseInt(nbVal);
    if (!isNaN(n) && n >= 1) { try { await client.patch(`/prints/groups/${groupId}`, { number_of_items: n }); setNbItems(n); onUpdated?.(); } catch { /* garde l'ancien */ } }
    setEditNb(false);
  };
  const handleDelete = async () => {
    if (!(await showConfirm(`Supprimer le groupe "${title}" et ses ${prints.length} prints ?`, { danger: true, confirmLabel: "Supprimer" }))) return;
    try { await Promise.all(prints.map(x => client.delete("/prints/" + x.id))); onDelete?.(); onClose(); }
    catch (err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };
  const handleUngroup = async () => {
    if (!(await showConfirm(`Dégrouper "${title}" (les prints resteront) ?`, { confirmLabel: "Dégrouper" }))) return;
    try { await client.delete("/prints/groups/" + groupId); onUngroup?.(); onClose(); }
    catch (err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };
  // hors des classements de la page Stats : tout le groupe (echantillons regroupes…), ou une impression a la fois
  const groupRankedOff = prints.some(x => x.group_stats_excluded);
  const toggleGroupRanked = async () => {
    const v = !groupRankedOff;
    try { await client.patch("/prints/groups/" + groupId, { stats_excluded: v }); setPrints(ps => ps.map(x => ({ ...x, group_stats_excluded: v }))); onUpdated?.(); }
    catch (err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };
  const togglePrintRanked = async x => {
    const v = !x.stats_excluded;
    try { await client.patch("/prints/" + x.id, { stats_excluded: v }); setPrints(ps => ps.map(y => y.id === x.id ? { ...y, stats_excluded: v ? 1 : 0 } : y)); onUpdated?.(); }
    catch (err) { showAlert("Erreur: " + (err.response?.data?.detail || err.message)); }
  };
  const setCoverPrint = async x => { try { await client.patch("/prints/groups/" + groupId, { cover_print_id: x.id }); setCoverPrintId(x.id); onUpdated?.(); } catch { /* rien */ } };
  const removeFromGroup = async x => {
    if (!(await showConfirm(`Retirer "${x.file_name || "ce print"}" du groupe ?`))) return;
    try { await client.post("/prints/" + x.id + "/group", {}); setPrints(ps => ps.filter(y => y.id !== x.id)); onUpdated?.(); } catch { /* rien */ }
  };
  const thumb3d = !!prints[0]?.group_thumb_3d;
  const more = e => openMenu(e, {
    title, subtitle: `${prints.length} impression${prints.length > 1 ? "s" : ""}`, color: "#A78BFA",
    items: [
      { icon: "✏️", label: "Éditer", hint: "Le nom du groupe", tone: "#3B82F6", onClick: () => setEditGroup(true) },
      { icon: "📣", label: "Partager", hint: "Telegram", tone: "#229ED9", onClick: () => setSharing(true) },
      objQ && { icon: "📦", label: objQ.remaining > 0 ? "Créer des objets" : "Objets : tous créés", hint: `${objQ.used} / ${objQ.total} déjà créés`, tone: "#22C55E",
        onClick: () => setObjCreate(true) },
      { icon: "📤", label: "Dégrouper", hint: "Les impressions restent", tone: "#A78BFA", onClick: handleUngroup },
      isAdmin && prints[0]?.group_has_vue3d && { icon: thumb3d ? "🧩" : "🧊", label: thumb3d ? "Vignette : mosaïque des impressions" : "Vignette : vue 3D assemblée",
        hint: thumb3d ? "Revenir à la mosaïque" : "Celle prise dans la vue 3D, à la place de la mosaïque", tone: "#0EA5E9",
        onClick: async () => { try { await client.put(`/prints/groups/${groupId}/thumb`, { use3d: !thumb3d }); setPrints(ps => ps.map(x => ({ ...x, group_thumb_3d: !thumb3d })));
          onUpdated?.(); window.dispatchEvent(new Event("bn-prints-changed")); } catch (e) { showAlert(e.response?.data?.detail || e.message); } } },
      (prints.some(x => x.source_3mf) || prints.some(x => x.model_3mf)) && "-",
      prints.some(x => x.source_3mf) && { icon: "⤓", label: "Télécharger les 3MF d'origine", hint: "Un fichier s'ils sont identiques, sinon un zip",
        tone: "#F97316", onClick: () => download3mf(groupId, "source", true) },
      prints.some(x => x.model_3mf) && { icon: "⤓", label: "Télécharger les 3MF tranchés", hint: "Un fichier s'ils sont identiques, sinon un zip",
        tone: "#F59E0B", onClick: () => download3mf(groupId, "sliced", true) },
      isAdmin && { icon: "📊", label: groupRankedOff ? "Remettre le groupe dans les classements" : "Retirer le groupe des classements des stats",
        hint: groupRankedOff ? "Ses impressions comptent de nouveau dans les tops" : "Toutes ses impressions ; les totaux les comptent toujours",
        tone: "#64748B", onClick: toggleGroupRanked },
      "-",
      { icon: "🗑", label: "Supprimer…", hint: "Le groupe et ses impressions", danger: true, onClick: handleDelete },
    ],
  });
  const printMenu = (e, x) => openMenu(e, {
    title: x.file_name || "Sans nom", subtitle: fmtDate(x.print_date), img: thumbUrl(x, 256),
    items: [
      { icon: "📄", label: "Ouvrir la fiche", tone: "#3B82F6", onClick: () => setSelectedPrint(x) },
      isAdmin && { icon: "★", label: coverPrintId === x.id ? "Vignette du groupe" : "En faire la vignette du groupe", tone: "#F59E0B",
        disabled: coverPrintId === x.id, onClick: () => setCoverPrint(x) },
      isAdmin && !groupRankedOff && { icon: "📊", label: x.stats_excluded ? "Remettre dans les classements des stats" : "Retirer des classements des stats",
        hint: "Cette impression seulement", tone: "#64748B", onClick: () => togglePrintRanked(x) },
      isAdmin && "-",
      isAdmin && { icon: "⛓", label: "Retirer du groupe", danger: true, onClick: () => removeFromGroup(x) },
    ],
  });
  const tile = (label, value, sub, c1, c2, onClick, tip) => (
    <button onClick={onClick} disabled={!onClick} data-tip={tip} style={{ minWidth: 0, padding: "9px 8px", borderRadius: 16, border: `1px solid color-mix(in srgb, ${c1} 22%, var(--border))`,
      background: `radial-gradient(90% 70% at 100% 0%, ${c1}22, transparent 70%), var(--surface2)`, cursor: onClick ? "pointer" : "default", textAlign: "left",
      font: "inherit", color: "inherit", display: "flex", flexDirection: "column", gap: 1, boxShadow: `0 6px 18px -12px ${c1}` }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...v2grad(c1, c2) }}>{value}</span>
      {sub && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>}
    </button>);
  // l'en-tete : une mosaique des plateaux sur leur image floutee
  const cover = prints.find(x => x.id === coverPrintId) || prints[0];
  // la vignette 3D du groupe, choisie a la place de la mosaique (29/10/2026)
  const v3u = thumb3d ? `${apiUrl(`/prints/groups/${groupId}/photo/Vue3D.png`)}?v=${prints[0]?.group_vue3d_v || 0}` : null;
  const mosaic = v3u ? [{ id: "vue3d", _src: w => apiThumb(v3u, w) }] : [cover, ...prints.filter(x => x !== cover)].filter(Boolean).slice(0, 4);
  const srcOf = (x, w) => (x._src ? x._src(w) : thumbUrl(x, w));
  const hero = (
    <div style={{ position: "relative", height: wide ? 300 : "min(36vh, 280px)", minHeight: 200, borderRadius: wide ? 20 : 0, overflow: "hidden", background: "var(--surface2)" }}>
      {cover && <img src={thumbUrl(cover, 128)} alt="" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
        objectFit: "cover", filter: "blur(26px) saturate(1.6)", opacity: 0.4, transform: "scale(1.3)" }}/>}
      <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "radial-gradient(60% 70% at 50% 38%, #A78BFA33, transparent 72%)" }}/>
      <div style={{ position: "absolute", inset: "8% 6% 34%", display: "grid", gap: 8,
        gridTemplateColumns: `repeat(${Math.min(mosaic.length, 4) || 1}, minmax(0, 1fr))` }}>
        {mosaic.map((x, i) => <div key={x.id} style={{ position: "relative", borderRadius: 14, overflow: "hidden", transform: `rotate(${[-3, 2, -1.5, 3][i]}deg)`,
          // en sombre, des cartes grises faisaient des dalles : un verre lavande, bord clair (le clair reste tel quel)
          ...(document.documentElement.getAttribute("data-theme") === "light"
            ? { background: "color-mix(in srgb, var(--surface) 55%, transparent)", boxShadow: "0 10px 24px rgba(0,0,0,.25)" }
            : { background: "linear-gradient(160deg, rgba(167,139,250,0.22), rgba(167,139,250,0.05))", border: "1px solid rgba(255,255,255,0.10)",
                boxShadow: "0 10px 24px rgba(0,0,0,.35)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }) }}>
          {/* le halo de chaque carte, comme celui de la fiche d'une impression : son image floutee et saturee derriere */}
          <img src={srcOf(x, 128)} alt="" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", filter: "blur(18px) saturate(1.8)", opacity: 0.55, transform: "scale(1.35)" }} onError={e => { e.currentTarget.style.display = "none"; }}/>
          <img src={srcOf(x, 384)} alt="" loading="lazy" decoding="async" style={{ position: "relative", width: "100%", height: "100%", objectFit: "contain" }} onError={e => { e.currentTarget.style.display = "none"; }}/>
        </div>)}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "34px 16px 12px",
        background: "linear-gradient(transparent, color-mix(in srgb, var(--sheet-bg) 92%, transparent) 55%)" }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: "var(--text)", letterSpacing: "-.01em", lineHeight: 1.2, overflow: "hidden",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>📁 {title}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 900, color: "#fff",
            background: "linear-gradient(135deg, #A78BFA, #C4B5FD)", boxShadow: "0 4px 14px #A78BFA55" }}>{prints.length} impression{prints.length > 1 ? "s" : ""}</span>
          {!groupVisiting && <NasChip count={prints.reduce((n, x) => n + (x.nas_only || 0), 0)} url={`/prints/groups/${groupId}/nas`} what="ce groupe"/>}
          {(groupRankedOff || prints.some(x => x.stats_excluded)) && <span data-tip={groupRankedOff ? "Tout le groupe est hors des classements de la page Stats (les totaux le comptent)"
            : "Ces impressions sont hors des classements de la page Stats (les totaux les comptent)"} style={{ display: "inline-flex", alignItems: "center", gap: 3,
            padding: "2px 9px", borderRadius: 20, fontSize: 11.5, fontWeight: 800, color: "#64748b", background: "color-mix(in srgb, #64748b 14%, transparent)" }}>
            📊 {groupRankedOff ? "hors classements" : `${prints.filter(x => x.stats_excluded).length} hors classements`}</span>}
          {Object.entries(counts).map(([st, n]) => { const [l, c, ic] = V2_STATUS[st] || [st, "#94a3b8", "•"];
            return <span key={st} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 9px", borderRadius: 20, fontSize: 11.5, fontWeight: 800,
              color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{ic} {n} {l.toLowerCase()}{n > 1 && /e$/.test(l) ? "s" : ""}</span>; })}
        </div>
      </div>
    </div>);
  const figures = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
        {tile("📅 Dernière", lDay, lHour, "#3B82F6", "#60A5FA", null, latest ? fmtDate(latest.toISOString()) : null)}
        {tile("⏱ Durée", totalDur > 0 ? durFr(totalDur) : "—", null, "#8B5CF6", "#C084FC")}
        {tile("⚖ Poids", totalW > 0 ? gFr(totalW) : "—", null, "#F59E0B", "#FBBF24")}
        {tile(<>💶 Coût<span>{costOpen ? "▴" : "▾"}</span></>, eur2(totalCost), `(${eur2(totalNormal)})`, "#16A34A", "#4ADE80", () => setCostOpen(o => !o),
          "Le prix réel, puis le prix normal entre parenthèses ; touche pour le détail")}
      </div>
      {costOpen && (
        <div style={{ padding: "10px 12px", borderRadius: 16, border: "1px solid color-mix(in srgb, #16A34A 22%, var(--border))", display: "flex",
          flexDirection: "column", gap: 7, fontSize: 12.5, background: "radial-gradient(80% 60% at 100% 0%, #16A34A18, transparent 70%), var(--surface2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
              background: "color-mix(in srgb, #16A34A 16%, transparent)", flexShrink: 0 }}>💶</span>
            <span style={{ flex: 1, fontWeight: 800, color: "var(--muted)", fontSize: 12 }}>Total</span>
            <span style={{ fontWeight: 900, fontSize: 15, ...v2grad("#16A34A", "#4ADE80") }}>{eur2(totalCost)}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", minWidth: 60 }}>({eur2(totalNormal)})</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 7 }}>
            <span style={{ fontWeight: 800, color: "#16a34a" }}>{nbItems} élément{nbItems > 1 ? "s" : ""}</span>
            {nbItems > 1 && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#16a34a" }}>· {eur2(totalCost / nbItems)}/u ({eur2(totalNormal / nbItems)}/u)</span>}
            <span style={{ marginLeft: "auto" }}/>
            {!editNb ? <AdminOnly><button onClick={() => { setNbVal(String(nbItems)); setEditNb(true); }} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 7,
              border: "1px solid rgba(34,197,94,0.35)", background: "none", color: "#16a34a", cursor: "pointer", fontWeight: 700 }}>Modifier</button></AdminOnly>
              : <span style={{ display: "flex", gap: 5 }}>
                <input type="number" min="1" value={nbVal} onChange={e => setNbVal(e.target.value)} autoFocus style={{ width: 58, padding: "3px 6px", borderRadius: 7,
                  border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12.5 }}/>
                <button onClick={saveNb} style={{ padding: "3px 10px", borderRadius: 7, border: "none", background: "#22c55e", color: "white", cursor: "pointer" }}>✓</button>
                <button onClick={() => setEditNb(false)} style={{ padding: "3px 8px", borderRadius: 7, border: "none", background: "var(--surface)", color: "var(--muted)", cursor: "pointer" }}>✕</button>
              </span>}
          </div>
        </div>)}
    </div>);
  // les impressions : des rangees (ou une grille) ; toucher ouvre la fiche, ⋯ : vignette du groupe, retirer
  const row = x => { const [l, c, ic] = V2_STATUS[x.status] || [x.status || "", "#94a3b8", "•"], d = utcDate(x.print_date), [dy, hr] = whenFr(d);
    return (
      <div key={x.id} onClick={() => setSelectedPrint(x)} onContextMenu={e => { e.preventDefault(); printMenu(e, x); }}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 6px 6px", borderRadius: 14, cursor: "pointer",
          background: `linear-gradient(90deg, color-mix(in srgb, ${c} 9%, transparent), transparent 70%), var(--surface2)`, border: "1px solid var(--border)" }}>
        <span style={{ position: "relative", flexShrink: 0 }}>
          <img src={thumbUrl(x, 128)} alt="" loading="lazy" decoding="async" style={{ width: 52, height: 52, borderRadius: 11, objectFit: "cover", background: "var(--surface)", display: "block" }}
            onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>
          {coverPrintId === x.id && <span data-tip="Vignette du groupe" style={{ position: "absolute", left: -4, top: -4, width: 18, height: 18, borderRadius: "50%",
            background: "#F59E0B", color: "#fff", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--sheet-bg)" }}>★</span>}
          <span style={{ position: "absolute", right: -3, bottom: -3, width: 14, height: 14, borderRadius: "50%", background: c, border: "2px solid var(--sheet-bg)" }}/>
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.file_name || "Sans nom"}</span>
          <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: c }}>{ic} {l}</span> · {dy} {hr.split(" · ")[0]}</span>
        </span>
        <span style={{ textAlign: "right", flexShrink: 0 }}>
          <span style={{ display: "block", fontSize: 12, fontWeight: 900, color: "var(--text)" }}>{(x.duration_seconds || x.estimated_seconds) ? durFr(x.duration_seconds || x.estimated_seconds) : "—"}</span>
          <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>{x.total_weight_g ? gFr(x.total_weight_g) : ""}</span>
        </span>
        <button onClick={e => { e.stopPropagation(); printMenu(e, x); }} aria-label="Actions de l'impression"
          style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 9, border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 15 }}>⋯</button>
      </div>); };
  const card = x => { const [, c] = V2_STATUS[x.status] || ["", "#94a3b8"];
    return (
      <div key={x.id} onClick={() => setSelectedPrint(x)} style={{ position: "relative", borderRadius: 14, overflow: "hidden", cursor: "pointer", background: "var(--surface2)",
        border: "1px solid var(--border)" }}>
        <div style={{ position: "relative", paddingTop: "78%" }}>
          <img src={thumbUrl(x, 384)} alt="" loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            onError={e => { e.currentTarget.style.display = "none"; }}/>
          {coverPrintId === x.id && <span style={{ position: "absolute", left: 6, top: 6, width: 20, height: 20, borderRadius: "50%", background: "#F59E0B", color: "#fff",
            fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>★</span>}
          <span style={{ position: "absolute", right: 6, bottom: 6, width: 12, height: 12, borderRadius: "50%", background: c, border: "2px solid var(--sheet-bg)" }}/>
          <button onClick={e => { e.stopPropagation(); printMenu(e, x); }} aria-label="Actions de l'impression" style={{ position: "absolute", right: 6, top: 6, width: 26, height: 26,
            borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.5)", color: "#fff", cursor: "pointer", fontSize: 13 }}>⋯</button>
        </div>
        <div style={{ padding: "6px 8px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.file_name || "Sans nom"}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{fmtDate(x.print_date)}</div>
        </div>
      </div>); };
  const printsBlock = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "11px 12px", borderRadius: 18, border: "1px solid var(--border)",
      background: "linear-gradient(160deg, color-mix(in srgb, #A78BFA 9%, transparent), transparent 60%), var(--surface2)" }}>
      <div onClick={() => setListOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)" }}>🖨️ Impressions</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{prints.length}</span>
        <span style={{ marginLeft: "auto" }}/>
        {listOpen && <span onClick={e => e.stopPropagation()} style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
          {[[false, "☰", "En rangées"], [true, "▦", "En grille"]].map(([g, ic, tip]) => <button key={tip} onClick={() => setGrid(g)} data-tip={tip}
            style={{ width: 34, height: 28, border: "none", cursor: "pointer", fontSize: 13, background: grid === g ? "#A78BFA" : "var(--surface)",
              color: grid === g ? "#fff" : "var(--muted)" }}>{ic}</button>)}
        </span>}
        <span style={{ fontSize: 11, color: "var(--muted)", transform: listOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
      </div>
      {/* replie : les vignettes en pile, les etats, la premiere et la derniere date */}
      {!listOpen && prints.length > 0 && (() => { const ds = prints.map(x => utcDate(x.print_date)).filter(Boolean).sort((a, b) => a - b);
        return <div onClick={() => setListOpen(true)} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
          <span style={{ display: "flex", flexShrink: 0 }}>{prints.slice(0, 6).map((x, i) => (
            <span key={x.id} style={{ position: "relative", width: 44, height: 44, marginLeft: i ? -14 : 0, borderRadius: 12, overflow: "hidden",
              border: "2px solid var(--surface2)", background: "var(--surface)", boxShadow: "0 4px 10px rgba(0,0,0,.18)", zIndex: 10 - i }}>
              <img src={thumbUrl(x, 128)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>
              <span style={{ position: "absolute", right: 2, bottom: 2, width: 9, height: 9, borderRadius: "50%", background: (V2_STATUS[x.status] || [0, "#94a3b8"])[1],
                border: "1.5px solid var(--surface2)" }}/></span>))}
            {prints.length > 6 && <span style={{ width: 44, height: 44, marginLeft: -14, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
              background: "#A78BFA", color: "#fff", fontSize: 12, fontWeight: 900, border: "2px solid var(--surface2)" }}>+{prints.length - 6}</span>}</span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11.5, fontWeight: 800 }}>
              {Object.entries(counts).map(([st, n]) => { const [l, c, ic] = V2_STATUS[st] || [st, "#94a3b8", "•"];
                return <span key={st} style={{ color: c }}>{ic} {n} {l.toLowerCase()}{n > 1 && /e$/.test(l) ? "s" : ""}</span>; })}</span>
            {ds.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {ds.length > 1 ? `du ${ds[0].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} au ${ds[ds.length - 1].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`
                : ds[0].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>}
          </span>
        </div>; })()}
      {listOpen && (grid ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>{prints.map(card)}</div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{prints.map(row)}</div>)}
    </div>);
  const sections = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <GroupPhotosV2 groupId={groupId} onUpdated={onUpdated} prints={prints}/>
      {printsBlock}
      {filaments.length > 0 && <FilamentsV2 filaments={filaments} onSpoolClick={setSelSpool} onUnmap={setUnmapping}/>}
      {designs.map(([d, n]) => <MakerWorldCard key={d} designId={d} rateElsewhere prints={prints.filter(x => String(x.design_id || "").trim() === d)}
        others={prints.filter(x => String(x.design_id || "").trim() !== d)} onLinked={loadPrints}
        note={designs.length > 1 || n < prints.length ? `${n} print${n > 1 ? "s" : ""} sur ${prints.length} de ce modèle` : null}/>)}
    </div>);
  return (
    <>
      <div data-no-pull="" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: wide ? "center" : "flex-end",
        justifyContent: "center", padding: wide ? 20 : 0 }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} className="sheet-inner" style={{ background: "var(--sheet-bg)", borderRadius: wide ? 24 : "22px 22px 0 0",
          width: "100%", maxWidth: wide ? 980 : 640, maxHeight: wide ? "90dvh" : "94dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 10, height: 0 }}>
              {!wide && <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", width: 38, height: 4, borderRadius: 2, background: "rgba(148,163,184,.6)" }}/>}
              <div style={{ position: "absolute", top: 10, right: 12, display: "flex", gap: 8 }}>
                {prints.some(x => (x.status === "SUCCESS" || x.status === "PARTIAL") && x.design_id && groupToRate.has(String(x.design_id)))
                  && <RateStar name={title} enabled={!groupVisiting}
                    designs={prints.filter(x => x.status === "SUCCESS" || x.status === "PARTIAL").map(x => String(x.design_id || "").trim()).filter(Boolean)}/>}
                {isAdmin && <button onClick={more} aria-label="Plus d'actions" style={v2Round}>⋯</button>}
                <button onClick={onClose} aria-label="Fermer" style={v2Round}>✕</button>
              </div>
            </div>
            {wide ? (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)", gap: 18, padding: 18 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{hero}{figures}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 34 }}>{sections}</div>
              </div>
            ) : <>{hero}<div style={{ padding: "12px 14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>{figures}{sections}</div></>}
          </div>
          {isAdmin && <div style={{ flexShrink: 0, display: "flex", gap: 8, padding: "10px 14px calc(10px + env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid var(--border)", background: "color-mix(in srgb, var(--sheet-bg) 94%, transparent)", backdropFilter: "blur(8px)" }}>
            <button onClick={() => setEditGroup(true)} style={{ ...v2Btn, flex: 1 }}>✏️ Éditer</button>
            <button onClick={() => setSharing(true)} style={{ ...v2Btn, flex: 1, color: "#229ED9", borderColor: "rgba(34,158,217,0.35)", background: "rgba(34,158,217,0.08)" }}>📣 Partager</button>
            <button onClick={more} aria-label="Plus d'actions" style={{ ...v2Btn, width: 48, flex: "0 0 auto" }}>⋯</button>
          </div>}
        </div>
      </div>
      {objCreate && <ObjectCreateSheet parentType="group" parentId={groupId} defaultName={title} costFabrication={totalCost / nbItems}
        onDone={() => { setObjRefresh(k => k + 1); onUpdated?.(); }} onClose={() => setObjCreate(false)}/>}
      {sharing && <ShareSheet kind="group" id={groupId} onClose={() => setSharing(false)}/>}
      {unmapping && <UnmapFilamentConfirm f={unmapping} printId={unmapping.print_id} onClose={() => setUnmapping(null)} onDone={() => { setUnmapping(null); loadPrints(); onUpdated?.(); }}/>}
      {editGroup && <GroupEditSheet groupId={groupId} name={title} onClose={() => setEditGroup(false)} onSaved={() => { setEditGroup(false); loadPrints(); onUpdated?.(); }}/>}
      {selSpool && <FilamentSheetFromSpool filamentId={selSpool.filId} spoolId={selSpool.spoolId} filamentColorHex={selSpool.hex} onClose={() => setSelSpool(null)} zIndex={2000}/>}
      {selectedPrint && (() => {
        // ‹ › dans la fiche : les impressions du groupe, dans l'ordre affiche (28/10/2026)
        const i = prints.findIndex(x => x.id === selectedPrint.id);
        return <PrintDetail p={selectedPrint} onClose={() => setSelectedPrint(null)}
          onPrev={i > 0 ? () => setSelectedPrint(prints[i - 1]) : null}
          onNext={i >= 0 && i < prints.length - 1 ? () => setSelectedPrint(prints[i + 1]) : null}
          onDelete={() => { setSelectedPrint(null); setPrints(ps => ps.filter(x => x.id !== selectedPrint.id)); }} onChanged={() => loadPrints()}/>;
      })()}
    </>);
}


function GroupTile({ groupId, name, prints, latestDate, number_of_items, duration_seconds, cover_print_id, onSelectPrint, onDelete, onUngroup,
                    selectMode, selected, onToggleSelect, onLongPress, row = false }) {
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
    const byId = Object.fromEntries(prints.map(pr => [pr.id, pr]));
    // chaque case garde la teinte de son print, comme une vignette seule
    // des vignettes (pas les originaux), versionnees ; « small » pour la pile de 46 px des rangees
    // la vignette 3D du groupe, choisie a la place de la mosaique (29/10/2026)
    if (prints[0]?.group_thumb_3d) {
      const u = `${apiUrl(`/prints/groups/${groupId}/photo/Vue3D.png`)}?v=${prints[0].group_vue3d_v || 0}`;
      return [{ url: apiThumb(u, 384), small: apiThumb(u, 128), tint: printTint(prints[0]) }];
    }
    return ordered.map(id => ({ url: thumbUrl(byId[id], 384), small: thumbUrl(byId[id], 128), tint: printTint(byId[id]) }));
  }, [prints, cover_print_id, groupId]);

  // Seul "en cours" est remonte sur la carte du groupe : un echec ou un partiel
  // isole ne doit pas faire paraitre en echec un groupe globalement reussi ;
  // en revanche un print encore en cours merite d'etre visible sans ouvrir.
  const inProgress = React.useMemo(
    () => prints.some(pr => pr.status === "IN_PROGRESS"), [prints]);
  const aggCfg = inProgress ? STATUS_CFG.IN_PROGRESS : null;
  const AggIcon = aggCfg?.icon;

  const [gDay, gHour] = whenFr(utcDate(latestDate));
  const gCheck = selectMode && <div style={{ position:"absolute", top:6, right:6, width:22, height:22, borderRadius:"50%", zIndex:2,
    display:"flex", alignItems:"center", justifyContent:"center", border: selected ? "none" : "1.5px solid rgba(255,255,255,0.85)",
    background: selected ? "#3b82f6" : "rgba(0,0,0,0.4)" }}>{selected && <Check size={13} color="white" strokeWidth={3}/>}</div>;
  const gFrame = { position:"relative", cursor:"pointer", userSelect:"none", WebkitUserSelect:"none", WebkitTouchCallout:"none", touchAction:"manipulation",
    outline: selected ? "2px solid #3b82f6" : "none", outlineOffset: 2 };
  return (
    <>
      {row ? (
        // en rangee : les vignettes en pile, le nom, combien et quand ; a droite la duree
        <div onClick={handleClick} {...press} style={{ ...gFrame, display:"flex", alignItems:"center", gap:11, padding:7, borderRadius:16,
          border:"1px solid color-mix(in srgb, #A78BFA 30%, var(--border))",
          background:"linear-gradient(90deg, color-mix(in srgb, #A78BFA 12%, transparent), transparent 60%), var(--surface2)" }}>
          <span style={{ position:"relative", display:"flex", flexShrink:0, width:60, height:60 }}>
            {mosaicUrls.slice(0, 3).map(({ url: u, small }, i) => <img key={u} src={small || u} alt="" draggable={false} loading="lazy" decoding="async" style={{ position:"absolute", left: i * 9, top: i * 4,
              width:46, height:46, borderRadius:12, objectFit:"cover", background:"var(--surface)", border:"2px solid var(--surface2)", zIndex: 3 - i,
              boxShadow:"0 4px 10px rgba(0,0,0,.2)" }} onError={e => { e.currentTarget.style.visibility="hidden"; }}/>)}
            {gCheck}
          </span>
          <span style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:2 }}>
            <span style={{ fontSize:13.5, fontWeight:800, color:"#8B5CF6", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>📁 {name}</span>
            <span style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {prints.length} print{prints.length > 1 ? "s" : ""}{number_of_items > 1 ? ` · ×${number_of_items}` : ""} · {gDay} {gHour.split(" · ")[0]}</span>
            <span style={{ display:"flex", gap:6, alignItems:"center", fontSize:10.5, fontWeight:800 }}>
              {aggCfg && <span style={{ color: aggCfg.color }}>● {aggCfg.label}</span>}
              {nToRate > 0 && <span style={{ color:"#d97706" }}>⭐ {nToRate > 1 ? `${nToRate} à évaluer` : "à évaluer"}</span>}</span>
          </span>
          <span style={{ fontSize:13, fontWeight:900, color:"var(--text)", flexShrink:0 }}>{duration_seconds > 0 ? durFr(duration_seconds) : ""}</span>
        </div>
      ) : (
      <div onClick={handleClick} {...press} style={{ ...gFrame, overflow:"hidden", display:"flex", flexDirection:"column", borderRadius:18,
        border:"1px solid color-mix(in srgb, #A78BFA 30%, var(--border))", background:"var(--surface2)", boxShadow:"0 8px 22px -16px rgba(124,58,237,.6)" }}>
        <div style={{ position:"relative", paddingTop:"78%", background:"var(--surface)", overflow:"hidden" }}>
          <div style={{ position:"absolute", inset:0 }}>
            <GroupMosaic photos={mosaicUrls} title={name}/>
          </div>
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg, rgba(124,58,237,0.10), transparent 40%)" }}/>
          <span style={{ position:"absolute", top:7, left:7, background:"linear-gradient(135deg, #8B5CF6, #A78BFA)", color:"white",
            fontSize:10, fontWeight:900, padding:"2px 9px", borderRadius:20, boxShadow:"0 4px 12px rgba(124,58,237,.45)" }}>
            📁 {prints.length} print{prints.length>1?"s":""}
          </span>
          {gCheck}
          {!selectMode && number_of_items > 1 && (
            <span style={{ position:"absolute", top:7, right:7, background:"rgba(59,130,246,0.92)", color:"white",
              fontSize:10, fontWeight:900, padding:"2px 8px", borderRadius:20 }}>×{number_of_items}</span>
          )}
          {nToRate > 0 && !selectMode && (
            <span data-tip={`${nToRate} modèle${nToRate > 1 ? "s" : ""} à évaluer`} style={{ position:"absolute", bottom:7, right:7,
              background:"linear-gradient(135deg, #F59E0B, #FBBF24)", color:"white", fontSize:10, fontWeight:900, padding:"2px 8px", borderRadius:20,
              boxShadow:"0 3px 10px rgba(245,158,11,.5)" }}>
              ⭐ {nToRate > 1 ? `${nToRate} à évaluer` : "À évaluer"}</span>
          )}
          {aggCfg && (
            <span style={{ position:"absolute", bottom:7, left:7, display:"inline-flex",
              alignItems:"center", gap:4, background:aggCfg.bg, color:"white",
              fontSize:10, fontWeight:900, padding:"2px 8px", borderRadius:20 }}>
              <AggIcon size={10}/> {aggCfg.label}
            </span>
          )}
        </div>
        <div style={{ padding:"8px 10px 9px" }}>
          <p style={{ fontWeight:800, fontSize:12.5, color:"#8B5CF6", margin:"0 0 3px",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</p>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:6 }}>
            <span data-tip={fmtDate(latestDate)} style={{ fontSize:10.5, fontWeight:700, color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{gDay} {gHour.split(" · ")[0]}</span>
            {duration_seconds > 0 && <span style={{ fontSize:10.5, fontWeight:800, color:"#8B5CF6", whiteSpace:"nowrap" }}>{durFr(duration_seconds)}</span>}
          </div>
        </div>
      </div>
      )}

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

// La teinte d'une vignette : le premier filament franc (pas blanc ni tres clair), sinon le lavande des groupes.
function printTint(p) {
  for (const f of p?.filament_usage || []) {
    const m = /^#?([0-9a-f]{6})/i.exec(f.color_hex || ""); if (!m) continue;
    const n = parseInt(m[1], 16);
    if ((0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.8) return `#${m[1]}`;
  }
  return "#A78BFA";
}

function PrintCard({ p, onClick, onDelete, onChanged, selectMode, selected, onToggleSelect, onLongPress, row = false }) {
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

  const [stL, stC, stI] = V2_STATUS[p.status] || [statusCfg.label, "#94a3b8", "•"];
  const tint = printTint(p);
  const [day, hour] = whenFr(utcDate(p.print_date));
  const dur = p.duration_seconds || p.estimated_seconds;
  const rateMe = p.status === "SUCCESS" && p.design_id && toRate.has(String(p.design_id));
  const check = selectMode && <div style={{ position:"absolute", top:6, left:6, width:22, height:22, borderRadius:7, zIndex:2,
    border: selected ? "none" : "1.5px solid rgba(255,255,255,0.85)", background: selected ? "#3b82f6" : "rgba(0,0,0,0.4)",
    display:"flex", alignItems:"center", justifyContent:"center" }}>{selected && <Check size={13} color="white" strokeWidth={3}/>}</div>;
  const dots = p.filament_usage?.length > 0 && <span style={{ display:"flex", gap:3 }}>{p.filament_usage.slice(0, 6).map((f,i) => (
    <ColorDot key={i} hex={f.color_hex} colors={f.filament_colors_array} multicolor={f.filament_multicolor_type} size={row ? 11 : 12} ring="none"
      style={{ boxShadow:"0 0 0 1.5px rgba(255,255,255,0.85), 0 1px 3px rgba(0,0,0,0.3)" }}/>))}</span>;
  const frame = { position:"relative", cursor:"pointer", userSelect:"none", WebkitUserSelect:"none", WebkitTouchCallout:"none", touchAction:"manipulation",
    outline: selected ? "2px solid #3b82f6" : "none", outlineOffset: 2 };
  return (<>
    {row ? (
      // en rangee : vignette (etat, ×N, ⭐), nom, etat et date, filaments ; a droite la duree et le poids
      <div onClick={handleClick} {...press} style={{ ...frame, display:"flex", alignItems:"center", gap:11, padding:7, borderRadius:16,
        border:"1px solid var(--border)", background:`linear-gradient(90deg, color-mix(in srgb, ${stC} 8%, transparent), transparent 60%), var(--surface2)` }}>
        <span style={{ position:"relative", flexShrink:0, width:60, height:60 }}>
          <img src={thumbUrl(p, 128)} alt="" loading="lazy" decoding="async" draggable={false} style={{ width:60, height:60, borderRadius:13, objectFit:"cover",
            background:"var(--surface)", display:"block", WebkitTouchCallout:"none" }} onError={e => { e.currentTarget.style.visibility="hidden"; }}/>
          {check}
          <span style={{ position:"absolute", right:-3, bottom:-3, width:15, height:15, borderRadius:"50%", background:stC, border:"2px solid var(--sheet-bg)" }}/>
          {p.number_of_items > 1 && <span style={{ position:"absolute", left:-4, top:-4, fontSize:9.5, fontWeight:900, color:"#fff", background:"#3b82f6", borderRadius:8,
            padding:"0 5px", lineHeight:"15px", border:"1.5px solid var(--sheet-bg)", visibility: selectMode ? "hidden" : "visible" }}>×{p.number_of_items}</span>}
        </span>
        <span style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:2 }}>
          <span style={{ fontSize:13.5, fontWeight:800, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.file_name || "Sans nom"}</span>
          <span style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            <span style={{ color:stC }}>{stI} {stL}</span> · {day} {hour}</span>
          <span style={{ display:"flex", alignItems:"center", gap:6 }}>{dots}
            {rateMe && <span data-tip="À évaluer sur MakerWorld" style={{ fontSize:10.5, fontWeight:800, color:"#d97706" }}>⭐ à évaluer</span>}</span>
        </span>
        <span style={{ textAlign:"right", flexShrink:0, display:"flex", flexDirection:"column", gap:2 }}>
          <span style={{ fontSize:13, fontWeight:900, color:"var(--text)" }}>{dur > 0 ? durFr(dur) : "—"}</span>
          {p.total_weight_g > 0 && <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)" }}>{gFr(p.total_weight_g)}</span>}
        </span>
      </div>
    ) : (
    <div onClick={handleClick} {...press} style={{ ...frame, overflow:"hidden", display:"flex", flexDirection:"column", borderRadius:18,
      border:"1px solid var(--border)", background:"var(--surface2)", boxShadow:"0 8px 22px -16px rgba(0,0,0,.45)" }}>
      {/* la vignette, l'etat en pastille, ×N, ⭐ a evaluer, les filaments */}
      <div style={{ position:"relative", paddingTop:"78%", overflow:"hidden",
        background:`radial-gradient(75% 70% at 50% 45%, ${tint}2e, transparent 75%), linear-gradient(180deg, ${tint}1a, transparent 55%), var(--surface2)` }}>
        <img src={thumbUrl(p, 384)} alt="" loading="lazy" decoding="async" draggable={false}
          style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", WebkitTouchCallout:"none", WebkitUserDrag:"none" }}
          onError={e => { e.currentTarget.style.display="none"; }}/>
        {check}
        {p.number_of_items > 1 && <span style={{ position:"absolute", top:7, right:7, background:"rgba(59,130,246,0.92)", color:"white", fontSize:10, fontWeight:900,
          padding:"2px 8px", borderRadius:20, boxShadow:"0 2px 6px rgba(0,0,0,0.35)" }}>×{p.number_of_items}</span>}
        {p.status !== "SUCCESS" && <span style={{ position:"absolute", top:7, left:7, background:stC, color:"white", fontSize:10, fontWeight:900,
          padding:"2px 9px", borderRadius:20, boxShadow:`0 4px 12px ${stC}66`, visibility: selectMode ? "hidden" : "visible" }}>{stI} {stL}</span>}
        {rateMe && <span data-tip="À évaluer sur MakerWorld" style={{ position:"absolute", bottom:7, right:7, fontSize:11, fontWeight:900, color:"#fff",
          background:"linear-gradient(135deg, #F59E0B, #FBBF24)", borderRadius:20, padding:"1px 7px", boxShadow:"0 3px 10px rgba(245,158,11,.5)" }}>⭐</span>}
        {dots && <span style={{ position:"absolute", bottom:7, left:7 }}>{dots}</span>}
      </div>
      <div style={{ padding:"8px 10px 9px" }}>
        <p style={{ fontWeight:800, fontSize:12.5, color:"var(--text)", margin:"0 0 3px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {p.file_name || "Sans nom"}
        </p>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:6 }}>
          <span data-tip={fmtDate(p.print_date)} style={{ fontSize:10.5, fontWeight:700, color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{day} {hour.split(" · ")[0]}</span>
          {/* Repli sur estimated_seconds, comme la fiche */}
          {dur > 0 && <span style={{ fontSize:10.5, fontWeight:800, color:"#8B5CF6", whiteSpace:"nowrap" }}>{durFr(dur)}</span>}
        </div>
      </div>
    </div>
    )}
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

// Les medias d'une fiche (26/10/2026) : deux onglets, « Souvenirs » (mes photos et videos) et « Technique »
// (le timelapse, les captures des couches dans l'ordre de l'impression). Une seule bande visible a la fois.
const TL_NAME = "Video-Timelapse.mp4";
// la fin d'abord (le resultat), puis en remontant vers la premiere couche
const SNAP_ORDER = ["fail", "pct100", "pct99", "pct50", "layer2", "layer1"];
const SNAP_NAMES = { layer1: "Couche 1", layer2: "Couche 2", pct50: "50 %", pct99: "99 %", pct100: "Fin", fail: "Échec" };
const snapKey = name => (name || "").replace(/^snapshot-/, "").replace(/\.[^.]+$/, "");
const snapRank = name => { const i = SNAP_ORDER.indexOf(snapKey(name)); return i < 0 ? 99 : i; };
function MediaTabs({ tab, setTab, souv, tech, right }) {
  const b = (k, label, n, c) => {
    const on = tab === k;
    return <button onClick={() => setTab(k)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 10px",
      borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 800, transition: "background .15s",
      color: on ? "#fff" : n ? "var(--text2)" : "var(--muted)", opacity: on || n ? 1 : .6,
      background: on ? `linear-gradient(135deg, ${c}, ${lighten(c)})` : "transparent", boxShadow: on ? `0 6px 14px -8px ${c}` : "none" }}>
      {label}<span style={{ fontSize: 11, fontWeight: 900, padding: "0 6px", borderRadius: 8, background: on ? "rgba(255,255,255,.25)" : "var(--surface)" }}>{n}</span></button>;
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ flex: 1, display: "flex", gap: 4, padding: 3, borderRadius: 13, background: "var(--surface2)" }}>
        {b("souv", "📸 Souvenirs", souv, "#EC4899")}{b("tech", "🛠 Technique", tech, "#3B82F6")}</div>
      {right}
    </div>);
}
// le timelapse : une tuile large, lancee a la demande (rien ne se lit tant qu'on ne touche pas)
function TimelapseTile({ url, label = "Timelapse", sub, onOpen, small }) {
  return (
    <div onClick={onOpen} data-tip="Lire le timelapse" style={{ position: "relative", flexShrink: 0, cursor: "pointer", borderRadius: 12, overflow: "hidden",
      width: small ? 150 : "min(100%, 300px)", aspectRatio: "16 / 9", background: "linear-gradient(135deg, #1e293b, #0f172a)", boxShadow: "0 0 0 1px var(--border)" }}>
      <video src={`${url}#t=1`} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}/>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ width: small ? 34 : 44, height: small ? 34 : 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(135deg, #3B82F6, #8B5CF6)", color: "#fff", fontSize: small ? 13 : 16, boxShadow: "0 6px 16px rgba(0,0,0,.35)" }}>▶</span></span>
      <span style={{ position: "absolute", left: 6, bottom: 6, right: 6, display: "flex", flexDirection: "column", gap: 1, pointerEvents: "none" }}>
        <span style={{ alignSelf: "flex-start", fontSize: 10.5, fontWeight: 800, color: "#fff", padding: "2px 7px", borderRadius: 6, background: "rgba(0,0,0,.6)" }}>🎬 {label}</span>
        {sub && <span style={{ alignSelf: "flex-start", fontSize: 10, fontWeight: 700, color: "#e2e8f0", padding: "1px 6px", borderRadius: 6, background: "rgba(0,0,0,.5)",
          maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>}
      </span>
    </div>);
}

// Bande de vignettes d'un onglet de la galerie. Definie au niveau module (28/10/2026) : declaree dans
// SnapshotGallery, elle etait recreee a chaque rendu du parent, React demontait donc la bande (defilement
// remis au debut, videos relancees) des qu'un etat changeait. Tout ce qu'elle lit du parent arrive en props.
// onDeleteItem est recu mais inutilise (la corbeille passe par onDeleteUpload), garde pour ne pas changer l'appel.
function SnapRow({ title, items, startIdx = 0, onAdd, onDeleteItem, canCover = false,
                   isAdmin, coverPhoto, confirmDelPhoto, setConfirmDelPhoto, setAsCover,
                   flatItems, setLightbox, handleDelete, setDeletedNames, onDeleteUpload }) {
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
      {/* pan-x pan-y : le glisse vertical fait defiler la fiche ; la fiche porte data-no-pull, le
          tirer-pour-rafraichir ne se declenche donc pas depuis cette bande. */}
      <div ref={scrollRef} style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:6,
        scrollbarWidth:"none", touchAction:"pan-x pan-y", overscrollBehaviorX:"contain" }}>
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
}

function SnapshotGallery({ snaps, printId, onDelete, onUpload, userPhotos = [], onDeleteUpload,
                           onCountChange, coverPhoto, onCoverChange }) {
  const [lightbox, setLightbox] = useState(null);
  const [diskFiles, setDiskFiles] = useState([]);
  const [photoToDelete, setPhotoToDelete] = useState(null);
  const [deletedNames, setDeletedNames] = useState(new Set());
  const [tab, setTab] = useState(null);
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

  // Souvenirs : mes photos, puis mes videos (en boucle) ; Technique : le timelapse, puis les captures des
  // couches de la fin vers le debut (Fin -> 99 % -> 50 % -> Couche 2 -> Couche 1)
  const isSnapName = n => /^snapshot-/.test(n || "");
  const vids = (userPhotos || []).filter(x => isVideoUrl(x.url) && x.filename !== TL_NAME && !deletedNames.has(x.filename))
    .map(x => ({ url: x.url, name: x.filename, label: "Vidéo" }));
  const photoItems = [...allItems.filter(i => !isSnapName(i.name)), ...vids];
  const milestoneItems = allItems.filter(i => isSnapName(i.name))
    .map(i => ({ ...i, label: SNAP_NAMES[snapKey(i.name)] || i.label }))
    .sort((a, b) => snapRank(a.name) - snapRank(b.name));
  const tl = (userPhotos || []).find(x => x.filename === TL_NAME && !deletedNames.has(x.filename));
  const techItems = [...(tl ? [{ url: tl.url, name: tl.filename, label: "Timelapse" }] : []), ...milestoneItems];
  const cur = tab || (photoItems.length || !techItems.length ? "souv" : "tech");

  const flatItems = cur === "souv" ? photoItems : techItems;   // la visionneuse reste dans l'onglet ouvert
  const lbIdx = lightbox ? flatItems.findIndex(i => i.url === lightbox.url) : -1;
  const moveLb = (dir) => {
    const ni = (lbIdx + dir + flatItems.length) % flatItems.length;
    setLightbox(flatItems[ni]);
  };

  return (
    <>
      <div className="card-sm" style={{ padding: "10px 12px 4px" }}>
        <MediaTabs tab={cur} setTab={setTab} souv={photoItems.length} tech={techItems.length}/>
        {cur === "souv"
          ? <SnapRow title="Photos et vidéos" items={photoItems} startIdx={0} canCover
              onAdd={async(f)=>{ await onUpload?.(f); reloadDiskFiles(); }} onDeleteItem={onDeleteUpload}
              isAdmin={isAdmin} coverPhoto={coverPhoto} confirmDelPhoto={confirmDelPhoto}
              setConfirmDelPhoto={setConfirmDelPhoto} setAsCover={setAsCover} flatItems={flatItems}
              setLightbox={setLightbox} handleDelete={handleDelete} setDeletedNames={setDeletedNames}
              onDeleteUpload={onDeleteUpload}/>
          : <>
            {tl && <div style={{ marginBottom: 12 }}><TimelapseTile url={tl.url} onOpen={() => setLightbox(techItems[0])}/></div>}
            <SnapRow title="Captures des couches" items={milestoneItems} startIdx={tl ? 1 : 0}
              isAdmin={isAdmin} coverPhoto={coverPhoto} confirmDelPhoto={confirmDelPhoto}
              setConfirmDelPhoto={setConfirmDelPhoto} setAsCover={setAsCover} flatItems={flatItems}
              setLightbox={setLightbox} handleDelete={handleDelete} setDeletedNames={setDeletedNames}
              onDeleteUpload={onDeleteUpload}/>
            {!techItems.length && <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>
              Ni timelapse ni capture des couches pour cette impression.</p>}
          </>}
      </div>
      {/* Hors de la fiche (portail) : dans le panneau qui defile, la visionneuse
          restait coincee a l'interieur au lieu de couvrir l'ecran. */}
      {lightbox && lbIdx >= 0 && <Lightbox images={flatItems.map(i => ({ url: i.url, label: i.label }))} index={lbIdx}
        onClose={() => setLightbox(null)}/>}
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
  const [who, setWho] = useState("mine");          // mine | friends | sd
  const [nTl, setNTl] = useState(null);            // les timelapses (selon la recherche), une fois lus
  // Les galeries des copains : relayees a la premiere ouverture de leur onglet (gardees 5 min), pas des l'arrivee
  // (28/10/2026 : tous les copains etaient interroges juste pour afficher un nombre) ; le nombre suit la recherche.
  const [askedFriends, setAskedFriends] = useState(false);
  useEffect(() => { if (who === "friends") setAskedFriends(true); }, [who]);
  const fdata = useShared("/friends/shared/gallery", hasFriends && askedFriends);
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
  const tiny = typeof window !== "undefined" && window.innerWidth < 420;
  return (<>
    {!currentFriend() && (
      <div style={{ display:"flex", gap:3, background:"var(--surface2)", borderRadius:16, padding:3,
        border:"1px solid var(--border)", marginBottom:10 }}>
        {/* des libelles courts, le nombre dessous : au telephone, « Chez les copains (12) » etait coupe en « Chez les co… » */}
        {[["mine", "🖼️", "Ma galerie", nMine, "#EC4899"],
          hasFriends && ["friends", "👀", "Copains", nFr, "#8B5CF6"],
          ["sd", "🎞️", "Timelapses", nTl, "#F97316"]].filter(Boolean).map(([k, e, l, n, c]) => (
          <button key={k} onClick={() => setWho(k)} title={l} style={{ flex:1, minWidth:0, padding:"6px 6px", borderRadius:12, fontSize:12.5,
            fontWeight:800, cursor:"pointer", border:"none", display:"flex", flexDirection:"column", alignItems:"center", gap:1, lineHeight:1.15,
            background: who === k ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "transparent",
            color: who === k ? "white" : "var(--muted)", boxShadow: who === k ? `0 6px 14px -6px ${c}` : "none" }}>
            {/* petit ecran : l'emoji passe sur la ligne du nombre (« Timelapses » ne tenait plus a 360 px avec trois onglets) */}
            <span style={{ whiteSpace:"nowrap", maxWidth:"100%", overflow:"hidden" }}>{tiny ? l : `${e} ${l}`}</span>
            <span style={{ fontSize:10.5, fontWeight:800, opacity: n != null || tiny ? 0.85 : 0, fontVariantNumeric:"tabular-nums" }}>
              {tiny ? `${e}${n != null ? ` ${n}` : ""}` : n != null ? n : "·"}</span>
          </button>
        ))}
      </div>
    )}
    {who === "sd" && !currentFriend() ? <TimelapsesView search={search} onCount={setNTl}/>
      : who === "friends" && hasFriends ? <FriendsGalleryView search={search} data={fdata}/> : <MyGalleryView search={search} sortF={sortF} data={mine} loading={mineLoading}/>}
  </>);
}

// Les timelapses de la carte SD de l'imprimante (26/10/2026) : les vignettes de la plus recente a la plus
// ancienne, l'impression retrouvee pour chacune, la video dans la visionneuse (copiee sur le serveur a la
// premiere lecture), puis « Fiche », « Telecharger » et, pour l'admin, « Supprimer » de la carte.
function TimelapsesView({ search, onCount }) {
  const isAdmin = useIsAdmin();
  const [data, setData] = useState(null);
  const [shown, setShown] = useState(48);
  const [open, setOpen] = useState(null);           // index dans la liste filtree
  const [sheet, setSheet] = useState(null);         // la fiche de l'impression
  const more = useRef(null);
  const load = fresh => client.get("/printer/sd/timelapses", { params: fresh ? { fresh: 1 } : {}, timeout: 120000 })
    .then(r => setData(r.data)).catch(e => setData({ error: e.response?.data?.detail || e.message }));
  useEffect(() => { load(false); }, []);
  // la recherche de la Galerie : le nom de l'impression (traduit, d'origine, le fichier), la date (« 25 oct »),
  // « non retrouvée », le nom du fichier video ; chaque mot doit s'y trouver, accents ignores
  const norm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const words = norm(search).trim().split(/\s+/).filter(Boolean);
  const hay = it => { const d = it.at || it.start ? new Date(it.at || it.start) : null;
    return norm(`${it.name} ${it.print?.name || "impression non retrouvee"} ${it.print?.other || ""} ${d ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) + " " + d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " " + d.toLocaleDateString("fr-FR") : ""}`); };
  const all = (data?.items || []).filter(it => !words.length || words.every(w => hay(it).includes(w)));
  useEffect(() => { if (data?.items) onCount?.(all.length); }, [data, all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // le rattrapage : les timelapses retrouves qui ne sont pas encore dans la fiche de leur impression
  const [att, setAtt] = useState(null);
  const todo = (data?.items || []).filter(it => it.print && !it.attached);
  useEffect(() => { client.get("/printer/sd/timelapses/attach").then(r => setAtt(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    if (!att?.running) return undefined;
    const t = setInterval(() => client.get("/printer/sd/timelapses/attach").then(r => {
      setAtt(r.data);
      if (!r.data.running) load(false);                 // fini : la liste dit ce qui est maintenant dans les fiches
    }).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [att?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const attach = async () => {
    const mb = Math.round(todo.reduce((n, it) => n + (it.size || 0), 0) / 1048576);
    if (!(await showConfirm(`Copier ${todo.length} timelapse${todo.length > 1 ? "s" : ""} (${mb} Mo) dans la fiche de leur impression ? Ils restent aussi sur l'imprimante.`,
      { confirmLabel: "Copier" }))) return;
    // suivi tout de suite (le serveur relit d'abord l'imprimante, quelques secondes)
    setAtt(a => ({ ...(a || {}), running: true, done: 0, total: 0, current: "lecture de l'imprimante", error: null }));
    try { const { data: a } = await client.post("/printer/sd/timelapses/attach"); setAtt(x => ({ ...a, running: a.running || !a.finished_at || x?.running })); }
    catch (e) { setAtt(null); showAlert(e.response?.data?.detail || e.message); }
  };
  useEffect(() => {
    if (!more.current || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setShown(n => n + 48); }, { rootMargin: "400px" });
    io.observe(more.current);
    return () => io.disconnect();
  }, [shown, all.length]);
  if (!data) return <p style={{ textAlign:"center", color:"var(--muted)", padding:"40px 0" }}>Lecture du stockage de l'imprimante…</p>;
  if (data.error) return <p style={{ textAlign:"center", color:"#ef4444", padding:"40px 0" }}>⚠ {data.error}</p>;
  const when = iso => { try { const d = new Date(iso); return `${d.toLocaleDateString("fr-FR", { day:"numeric", month:"short", year:"numeric" })} · ${d.toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" })}`; } catch { return ""; } };
  const mo = n => n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;
  const vid = it => apiUrl(`/printer/sd/timelapse/video/${it.name}`);
  const thumb = it => apiUrl(`/printer/sd/timelapse/thumb/${it.name.replace(/\.(mp4|avi)$/, ".jpg")}`);
  const openSheet = async it => { try { const { data: p } = await client.get(`/prints/${it.print.id}`); setSheet(p); } catch { /* introuvable */ } };
  const remove = async (it, close) => {
    if (!(await showConfirm(`Supprimer ce timelapse du stockage de l'imprimante ?`, { danger: true, confirmLabel: "Supprimer" }))) return;
    try { await client.delete(`/printer/sd/timelapse/${it.name}`); close(); setData(d => ({ ...d, items: d.items.filter(x => x.name !== it.name), total: d.total - 1 })); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const pill = (bg, c) => ({ padding:"10px 18px", borderRadius:22, cursor:"pointer", fontSize:13.5, fontWeight:900, color:c, background:bg, border:"none",
    backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)", textDecoration:"none" });
  return (<>
    <p style={{ fontSize:11.5, color:"var(--muted)", margin:"0 0 10px", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
      <span>{words.length ? <>{all.length} sur {(data.items || []).length} pour « <b style={{ color:"var(--text2)" }}>{search.trim()}</b> »</>
        : <>{all.length} timelapse{all.length > 1 ? "s" : ""} sur l'imprimante · {mo(data.bytes || 0)}</>}</span>
      <button onClick={() => { setData(null); load(true); }} style={{ padding:"2px 10px", borderRadius:20, border:"1px solid var(--border)",
        background:"var(--surface2)", color:"var(--text2)", fontSize:11, fontWeight:800, cursor:"pointer" }}>↻ Relire</button></p>
    {isAdmin && (att?.running || todo.length > 0) && (
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", padding:"10px 12px", borderRadius:14, marginBottom:10,
        background:"linear-gradient(135deg, rgba(249,115,22,0.14), transparent 70%), var(--surface2)", border:"1px solid rgba(249,115,22,0.35)" }}>
        {att?.running ? <>
          <span style={{ fontSize:12.5, fontWeight:800, color:"var(--text)", flex:1, minWidth:180 }}>
            📥 {att.total ? <>Copie dans les fiches… {att.done} / {att.total}</> : "Lecture de l'imprimante…"}
            {att.total && att.current ? <span style={{ color:"var(--muted)", fontWeight:700 }}> · {att.current}</span> : null}</span>
          <span style={{ flexBasis:"100%", height:6, borderRadius:4, background:"var(--surface)", overflow:"hidden" }}>
            <span style={{ display:"block", height:"100%", width:`${att.total ? 100 * att.done / att.total : 0}%`, background:"linear-gradient(90deg, #F97316, #FBBF24)", transition:"width .4s" }}/></span>
        </> : <>
          <span style={{ fontSize:12.5, fontWeight:700, color:"var(--text2)", flex:1, minWidth:180 }}>
            <b>{todo.length}</b> timelapse{todo.length > 1 ? "s" : ""} retrouvé{todo.length > 1 ? "s" : ""} ne {todo.length > 1 ? "sont" : "est"} pas encore dans la fiche de {todo.length > 1 ? "leur" : "son"} impression.</span>
          <button onClick={attach} style={{ padding:"7px 14px", borderRadius:10, border:"none", cursor:"pointer", fontSize:12.5, fontWeight:800, color:"#fff",
            background:"linear-gradient(135deg, #F97316, #FB923C)" }}>📥 Les copier</button>
        </>}
      </div>)}
    {!att?.running && att?.error && <p style={{ fontSize:12, color:"#ef4444", fontWeight:800, margin:"0 0 10px" }}>⚠ Copie interrompue : {att.error}</p>}
    {!att?.running && att?.finished_at && att.total > 0 && Date.now() / 1000 - att.finished_at < 120 && (
      <p style={{ fontSize:12, color:"#16a34a", fontWeight:800, margin:"0 0 10px" }}>✓ {att.total - att.errors} timelapse{att.total - att.errors > 1 ? "s" : ""} copié{att.total - att.errors > 1 ? "s" : ""} dans les fiches{att.errors ? ` · ${att.errors} en échec` : ""}</p>)}
    {!all.length && words.length > 0 && <p style={{ textAlign:"center", color:"var(--muted)", padding:"30px 0" }}>Aucun timelapse ne correspond.</p>}
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:10 }}>
      {all.slice(0, shown).map((it, i) => (
        <button key={it.name} onClick={() => setOpen(i)} style={{ textAlign:"left", padding:0, borderRadius:14, overflow:"hidden", cursor:"pointer",
          border:"1px solid var(--border)", background:"var(--surface2)", color:"inherit", font:"inherit", display:"flex", flexDirection:"column" }}>
          <span style={{ position:"relative", aspectRatio:"16 / 9", background:"#0f172a", display:"block" }}>
            {it.thumb && <img src={thumb(it)} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}
              onError={e => { e.currentTarget.style.display = "none"; }}/>}
            <span style={{ position:"absolute", left:6, bottom:6, padding:"1px 7px", borderRadius:10, fontSize:10, fontWeight:900, color:"#fff",
              background:"rgba(15,23,42,0.65)" }}>▶ {mo(it.size)}</span>
            {it.attached && <span data-tip="Déjà copié dans la fiche de l'impression" style={{ position:"absolute", right:6, top:6, padding:"1px 7px", borderRadius:10,
              fontSize:10, fontWeight:900, color:"#fff", background:"linear-gradient(135deg, #16a34a, #22c55e)" }}>📎 dans sa fiche</span>}
          </span>
          <span style={{ padding:"7px 9px", display:"flex", flexDirection:"column", gap:2, minWidth:0 }}>
            <span style={{ fontSize:12.5, fontWeight:800, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {it.print?.name || "Impression non retrouvée"}</span>
            <span style={{ fontSize:10.5, color:"var(--muted)" }}>{when(it.at || it.start)}</span>
          </span>
        </button>
      ))}
    </div>
    {shown < all.length && <div ref={more} style={{ textAlign:"center", color:"var(--muted)", padding:12 }}>…</div>}
    {open != null && all[open] && (
      <Lightbox images={all.map(it => ({ url: vid(it), label: it.print?.name || when(it.at || it.start),
          poster: it.thumb ? thumb(it) : null, fallback: `${vid(it)}?h264=1` }))} index={open}
        title="Timelapse" onIndex={i => setOpen(i)} onClose={() => setOpen(null)}
        actions={(i, close) => { const it = all[i]; return <>
          {it.print && <button onClick={() => { close(); openSheet(it); }} style={{ ...pill("linear-gradient(135deg, #3B82F6, #6366F1)", "#fff") }}>📄 Fiche</button>}
          <a href={vid(it)} download={it.name} style={{ ...pill("rgba(255,255,255,0.14)", "#fff") }}>⤓ Télécharger</a>
          {isAdmin && <button onClick={() => remove(it, close)} style={{ ...pill("rgba(239,68,68,0.85)", "#fff") }}>🗑 Supprimer</button>}
        </>; }}/>
    )}
    {sheet && <PrintDetail p={sheet} onClose={() => setSheet(null)} onDelete={() => setSheet(null)} onChanged={() => {}}/>}
  </>);
}

function FriendsGalleryView({ search, data }) {
  const items = useMemo(() => {
    let list = (data?.items || []).map(it => ({ ...it, title: it.kind === "group" ? it.name : (it.title || it.file_name),
      photos: (it.photos || []).map(ph => ({ ...ph, url: relayed(ph.url) })) }));
    if (search?.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(it => friendMatch(it, q));
    }
    return list;
  }, [data, search]);
  if (!data) return <p style={{ textAlign:"center", color:"var(--muted)", padding:"40px 0" }}>Je demande à tes copains…</p>;
  if (data.error) return <p style={{ textAlign:"center", color:"#ef4444", padding:"40px 0" }}>⚠ {data.error}</p>;
  const off = (data.friends || []).filter(f => f.status !== "ok");
  return (<>
    {off.length > 0 && (
      <p style={{ fontSize:11.5, color:"var(--muted)", margin:"0 0 8px" }}>
        Pas joignable pour l'instant : {off.map(f => f.name).join(", ")}</p>
    )}
    <GalleryCompare
      items={items}
      // « Fiche » (25/10/2026) : chez le copain, en lecture seule, sur la fiche de cette impression ou de ce groupe
      onItemClick={async it => {
        let f = { id: it.friend_id, name: it.friend_name };
        try { const { data: d } = await client.get("/friends"); f = (d.friends || []).find(x => String(x.id) === String(it.friend_id)) || f; } catch { /* le nom suffit */ }
        useFriend.getState().visitAt(f, it.kind === "group" ? `/prints?group=${it.id}` : `/prints?id=${it.id}`);
      }}
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
  // la liste ne change qu'avec les donnees, la recherche ou le tri (28/10/2026 : recreee a chaque rendu, la
  // grille repartait a ses 30 premieres tuiles a chaque ouverture de fiche ou de visionneuse)
  const items = useMemo(() => {
    let list = [
      ...(data?.prints||[]).map(p => ({ ...p, kind:"print", title:p.title||p.file_name, count:1 })),
      ...(data?.groups||[]).map(g => ({ ...g, kind:"group", title:g.name, count:g.prints })),
    ];
    if (search?.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(it => (it.title||"").toLowerCase().includes(q));
    }
    list.sort((a,b) => {
      if (sortF==="oldest")   return (a.print_date||a.latest_date||"").localeCompare(b.print_date||b.latest_date||"");
      if (sortF==="cost")     return (b.total_cost||0)-(a.total_cost||0);
      if (sortF==="weight")   return (b.total_weight_g||0)-(a.total_weight_g||0);
      if (sortF==="duration") return (b.duration_seconds||0)-(a.duration_seconds||0);
      return (b.print_date||b.latest_date||"").localeCompare(a.print_date||a.latest_date||"");
    });
    return list;
  }, [data, search, sortF]);

  if (loading) return <p style={{ textAlign:"center", color:"var(--muted)", padding:"40px 0" }}>Chargement…</p>;
  if (!data) return null;

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

// la vignette d'une impression, versionnee (28/10/2026) : avec ?v=, le navigateur la garde un an sans redemander ;
// sans, il revalidait chaque vignette de la page a chaque ouverture (une requete par carte, 304 ou pas)
const thumbUrl = (p, w) => `${apiThumb(apiUrl("/prints/" + p.id + "/image"), w)}&v=${encodeURIComponent(String(p.updated_at || p.print_date || "").slice(0, 19))}`;

const STATUSES = ["","IN_PROGRESS","SUCCESS","PARTIAL","TO_REDO","FAILED"];
const STATUS_LABELS = {"":"Tous","IN_PROGRESS":"En cours","SUCCESS":"Réussis",
  "PARTIAL":"Partiels","TO_REDO":"À refaire","FAILED":"Échoués"};
const SORT_KEYS = ["recent", "oldest", "cost", "weight", "duration"];
// Les filtres de la liste dans l'adresse (28/10/2026) : cles courtes, une valeur par defaut n'y est pas ecrite.
const FILTER_DEFAULTS = { q: "", st: "", sort: "recent", mat: "", type: "", fil: "", col: "", from: "", to: "" };
const FILTER_KEYS = Object.keys(FILTER_DEFAULTS);
const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

// La cle de tri d'un element de la liste, la meme que celle du serveur : un groupe est classe sur sa valeur
// agregee, un print solo sur la sienne.
const sortKeyOf = (it, sortF) => {
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
const sortItems = (items, sortF) => {
  const asc = sortF === "oldest";
  return items.sort((a,b) => {
    const ka = sortKeyOf(a, sortF), kb = sortKeyOf(b, sortF);
    const cmp = typeof ka === "string" ? ka.localeCompare(kb) : (ka - kb);
    return asc ? cmp : -cmp;
  });
};
// La liste affichee : un print solo, ou un groupe entier (une seule carte, classee sur ses totaux).
// Agréger les groupes par id (et non par nom — deux groupes distincts peuvent porter le même nom,
// ex. import Spoolnymous à des dates différentes) ; dédupliquer (le lazy load peut introduire des doublons).
function buildDisplayItems(prints, sortF) {
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
  const items = [];
  const addedGroups = new Set();
  uniquePrints.forEach(p => {
    if (!p.group_id) items.push({ type:"print", p, date: p.print_date });
    else if (!addedGroups.has(p.group_id)) { addedGroups.add(p.group_id); items.push({ type:"group", groupId:p.group_id, ...groupMap[p.group_id] }); }
  });
  return sortItems(items, sortF);
}
// La liste aplatie, pour passer d'une fiche a la suivante (28/10/2026) : les solos et les membres des groupes,
// dans l'ordre du tri (les membres d'un groupe classes entre eux sur la meme cle).
const flattenItems = (items, sortF) => items.flatMap(it => it.type === "print" ? [it.p]
  : sortItems(it.prints.map(p => ({ type: "print", p })), sortF).map(x => x.p));

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
  // un groupe ouvert par son adresse (?group=ID, depuis l'accueil) : ses impressions, puis sa fiche
  const deepGroup = searchParams.get("group");
  const [groupDeep, setGroupDeep] = useState(null);
  useEffect(() => {
    if (!deepGroup) { setGroupDeep(null); return; }
    client.get("/prints", { params: { group_id: deepGroup, limit: 200 } })
      .then(r => { const ps = r.data?.prints || r.data?.items || [];
        if (ps.length) setGroupDeep({ id: Number(deepGroup), name: ps[0].group_name || `Groupe #${deepGroup}`, prints: ps,
          latestDate: ps.reduce((d, p) => !d || (p.print_date && p.print_date > d) ? p.print_date : d, null),
          number_of_items: ps[0].group_number_of_items || 1, cover_print_id: ps[0].group_cover_print_id }); })
      .catch(() => {});
  }, [deepGroup]);
  const closeGroupDeep = () => {
    setGroupDeep(null);
    const next = new URLSearchParams(searchParams);
    next.delete("group");
    setSearchParams(next, { replace: true });
  };
  const sentinelRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const printsRef = useRef([]);
  printsRef.current = prints;
  // Les filtres, la recherche, le tri et les dates vivent dans l'adresse (28/10/2026) : ?q=…&st=…&sort=…&mat=…&type=…
  // &fil=…&col=…&from=…&to=…. Un retour sur la page (ou un lien de l'accueil, /prints?st=FAILED&from=…) retrouve les
  // memes filtres ; l'adresse est remplacee, pas empilee, pour ne pas polluer l'historique (comme useUrlTab).
  // Plusieurs changements dans un meme geste s'enchainent via pendingUrl : setSearchParams repart sinon de l'adresse
  // du dernier rendu, et seul le dernier gagnerait. Une valeur inconnue (lien ancien) retombe sur le defaut.
  const paramsRef = useRef(searchParams); paramsRef.current = searchParams;
  const pendingUrl = useRef(null);
  useEffect(() => { pendingUrl.current = null; }, [searchParams]);
  const patchUrl = useCallback(patch => {
    const base = pendingUrl.current || paramsRef.current;
    const next = new URLSearchParams(base);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "" || v === FILTER_DEFAULTS[k]) next.delete(k); else next.set(k, String(v));
    }
    if (next.toString() === base.toString()) return;
    pendingUrl.current = next;
    setSearchParams(next, { replace: true });
  }, [setSearchParams]);
  const urlQ = searchParams.get("q") || "";
  const [search, setSearch]   = useState(urlQ);
  // Texte reellement envoye au serveur : 300 ms apres la derniere frappe. Une
  // requete par lettre, sans garde, laissait la reponse d'une frappe ancienne
  // (« p », lente car large) arriver apres la bonne et l'ecraser -- le champ
  // disait une chose, la liste en montrait une autre. C'est ce texte-la qui
  // s'ecrit dans l'adresse (?q=), pas chaque frappe.
  const [searchQ, setSearchQ] = useState(urlQ.trim());
  useEffect(() => {
    const t = setTimeout(() => { const v = search.trim(); setSearchQ(v); patchUrl({ q: v }); }, 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  // l'adresse change sans passer par le champ (« Tout effacer », lien de l'accueil) : le champ suit
  useEffect(() => { if (urlQ.trim() !== searchQ) { setSearch(urlQ); setSearchQ(urlQ.trim()); } }, [urlQ]); // eslint-disable-line react-hooks/exhaustive-deps
  // Numero de la derniere demande de liste / de totaux : une reponse qui
  // n'est plus la derniere est ignoree.
  const loadGen = useRef(0);
  const kpiGen = useRef(0);
  const urlVal = (k, allowed) => { const v = searchParams.get(k) || ""; return v && allowed && !allowed.includes(v) ? "" : v; };
  const statusF = urlVal("st", STATUSES);
  const setStatusF = v => patchUrl({ st: v });
  const [selected, setSelected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError]     = useState(null);
  const [groups, setGroups]   = useState([]);
  const [groupF, setGroupF]   = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const materialF = urlVal("mat"), setMaterialF = v => patchUrl({ mat: v });
  const filaTypeF = urlVal("type"), setFilaTypeF = v => patchUrl({ type: v });
  const filamentIdF = urlVal("fil"), setFilamentIdF = v => patchUrl({ fil: v });
  const colorF = urlVal("col"), setColorF = v => patchUrl({ col: v });
  const dateFrom = isYmd(searchParams.get("from")) ? searchParams.get("from") : "";  // borne debut plage temporelle
  const dateTo = isYmd(searchParams.get("to")) ? searchParams.get("to") : "";        // borne fin (incluse)
  const setDateFrom = v => patchUrl({ from: v });
  const setDateTo = v => patchUrl({ to: v });
  const setDates = (a, b) => patchUrl({ from: a, to: b });
  const [colorBuckets, setColorBuckets] = useState([]);
  const [allFilaments, setAllFilaments] = useState([]);
  const [allMaterials, setAllMaterials] = useState([]);
  const [allFilaTypes, setAllFilaTypes] = useState([]);
  const [filSearch, setFilSearch] = useState("");
  const sortF = urlVal("sort", SORT_KEYS) || "recent";
  const setSortF = v => patchUrl({ sort: v });
  // « Tout effacer » : plus aucun parametre de filtre dans l'adresse (recherche comprise)
  const clearFilters = () => { patchUrl(Object.fromEntries(FILTER_KEYS.map(k => [k, ""]))); setFilSearch(""); };
  const [viewMode, setViewMode] = useUrlTab("tab", "list", ["list", "gallery", "makerworld", "queue"]);
  // la liste en grille de cartes, ou en rangees compactes (choix retenu sur l'appareil)
  const [rows, setRows0] = useState(() => { try { return localStorage.getItem("bn-prints-rows") === "1"; } catch { return false; } });
  const setRows = v => { setRows0(v); try { localStorage.setItem("bn-prints-rows", v ? "1" : "0"); } catch { /* indisponible */ } };
  useTrackDetail(`Historique · ${ {list:"Liste", gallery:"Galerie", makerworld:"MakerWorld", queue:"À faire"}[viewMode] || viewMode }`);
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
  // une association a un modele MakerWorld (fenetre dediee) vient de changer des impressions
  useEffect(() => {
    const f = () => load();
    window.addEventListener("bn-prints-changed", f);
    return () => window.removeEventListener("bn-prints-changed", f);
  }); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Le serveur pagine par CARTES (un print seul ou un groupe entier) depuis le
  // 22/10/2026 : une page = LIMIT cartes, et il dit ou reprendre (next_offset).
  const LIMIT = 24;
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

  // la liste et ses KPI ne servent qu'a l'onglet Liste : en galerie, MakerWorld ou file, on note seulement que les
  // filtres ont change, et on recharge au retour sur la liste si besoin (28/10/2026 : chaque recherche en galerie
  // relançait la liste paginee et les KPI)
  const listDirty = useRef(true), kpisDirty = useRef(true);
  useEffect(() => { kpisDirty.current = true; }, [loadKpis]);
  useEffect(() => { if (viewMode === "list" && kpisDirty.current) { kpisDirty.current = false; loadKpis(); } }, [loadKpis, viewMode]);

  // Charger la palette de teintes (n'affiche que celles réellement utilisées)
  // Les options des filtres (teintes, filaments : jusqu'a 2 000 lignes) : lues seulement quand
  // le panneau s'ouvre ou qu'un de ces filtres est pose, plus a chaque ouverture de la page.
  const needFilterOpts = filterOpen || !!filamentIdF || !!colorF || !!materialF || !!filaTypeF;
  const filterOptsLoaded = useRef(false);
  useEffect(() => {
    if (!needFilterOpts || filterOptsLoaded.current) return;
    filterOptsLoaded.current = true;
    client.get("/filaments/color-buckets")
      .then(r => setColorBuckets((r.data||[]).filter(b => b.count > 0)))
      .catch(()=>{});
    client.get("/filaments/filaments", { params:{ limit:2000, archived_too:true } }).then(r=>{
      const fils = r.data || [];
      setAllFilaments(fils);
      setAllMaterials([...new Set(fils.map(f=>f.material).filter(Boolean))].sort());
      setAllFilaTypes([...new Set(fils.map(f=>f.fila_type).filter(Boolean))].sort());
    }).catch(()=>{});
  }, [needFilterOpts]);

  // une liste qui se recharge (filtre, groupe cree…) : la suite au defilement attend qu'elle soit la
  const reloadingRef = useRef(false);
  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    reloadingRef.current = true;
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
      setOffset(data.next_offset ?? LIMIT);
    } catch(e) {
      if (gen !== loadGen.current) return;
      setError(e.response?.data?.detail || e.message || "Erreur");
    }
    if (gen === loadGen.current) reloadingRef.current = false;
    setLoading(false);
  }, [searchQ, statusF, groupF, materialF, filaTypeF, filamentIdF, colorF, dateFrom, dateTo, sortF]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loadingMoreRef.current || reloadingRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      // la liste d'ou l'on part : si un rechargement la remplace entre-temps (groupe cree, filtre…),
      // cette suite est perimee et ne doit pas la reecrire (les prints groupes revenaient seuls)
      const base = printsRef.current;
      let acc = base.slice();
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
        const next = curOffset;
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
        // reprise donnee par le serveur ; un ancien serveur (copain pas a jour) : offset + limit
        curOffset = data.next_offset ?? next + LIMIT;
        more = data.has_more ?? false;
      }
      if (acc && printsRef.current === base && gen === loadGen.current) {
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

  useEffect(() => { listDirty.current = true; }, [load]);
  useEffect(() => { if (viewMode === "list" && listDirty.current) { listDirty.current = false; load(); } }, [load, viewMode]);
  // la liste des groupes ne sert qu'au selecteur « Ajouter a un groupe » : lue a son ouverture (28/10/2026 :
  // elle partait a chaque ouverture de la page), puis rafraichie apres les actions qui la changent
  useEffect(() => { if (groupPickerOpen) loadGroups(); }, [groupPickerOpen, loadGroups]);

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

  // La liste affichee (solos + groupes, tries) et sa version aplatie, pour les ‹ › de la fiche (28/10/2026) :
  // la precedente / la suivante dans l'ordre de l'ecran, les membres d'un groupe compris. Au bout de la liste,
  // s'il reste des cartes a charger, › les charge puis avance.
  const listItems = useMemo(() => groupF ? [] : buildDisplayItems(prints, sortF), [prints, sortF, groupF]);
  const flatPrints = useMemo(() => groupF ? prints : flattenItems(listItems, sortF), [prints, listItems, sortF, groupF]);
  const selIdx = selected && viewMode === "list" ? flatPrints.findIndex(x => x.id === selected.id) : -1;
  const goTo = useCallback(q => {
    setSelected(q);
    // ouverte par son adresse (?id=…) : l'adresse suit, pour que Retour / rafraichir retombent sur la bonne
    if (paramsRef.current.get("id")) patchUrl({ id: String(q.id) });
  }, [patchUrl]);
  const wantNext = useRef(false);
  useEffect(() => {
    if (!wantNext.current) return;
    if (selIdx >= 0 && selIdx < flatPrints.length - 1) { wantNext.current = false; goTo(flatPrints[selIdx + 1]); }
    else if (!hasMore && !loadingMore) wantNext.current = false;
  }, [flatPrints, selIdx, hasMore, loadingMore, goTo]);
  const onPrevPrint = selIdx > 0 ? () => goTo(flatPrints[selIdx - 1]) : null;
  const onNextPrint = selIdx < 0 ? null
    : selIdx < flatPrints.length - 1 ? () => goTo(flatPrints[selIdx + 1])
    : hasMore ? () => { wantNext.current = true; loadMore(); } : null;

  return (
    <div className="page-wide">

      {/* Titre */}
      <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Impressions</h1>

      {/* Tabs Liste / Galerie / MakerWorld */}
      <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:16, padding:4, border:"1px solid var(--border)" }}>
        {[["list","Liste","☰","#3B82F6"],["gallery","Galerie","🖼️","#EC4899"],["makerworld","MakerWorld","🌐","#06B6D4"],["queue","À faire","✅","#22C55E"]].map(([id,label,ic,c])=>(
          // comme les Stats : largeur selon le texte, qui retrecit avec l'ecran
          <button key={id} onClick={()=>setViewMode(id)} style={{
            flex:"1 1 auto", minWidth:0, padding:"8px 4px", borderRadius:12, fontWeight:800, cursor:"pointer",
            fontSize:"clamp(10.5px, 3.1vw, 12.5px)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
            display:"flex", alignItems:"center", justifyContent:"center", gap:5,
            background: viewMode===id ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "transparent",
            color: viewMode===id ? "white" : "var(--muted)", boxShadow: viewMode===id ? `0 6px 16px -6px ${c}` : "none",
            border:"none", transition:"all 0.15s",
          }}><span style={{ fontSize:"clamp(11px, 3.2vw, 13px)", filter: viewMode===id ? "none" : "grayscale(.5)" }}>{ic}</span>{label}</button>
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
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0, 1fr))", gap:6 }}>
          {[
            ["🖨️ Impressions", `${kpis.count}`, "#3B82F6", "#60A5FA"],
            ["⏱ Durée", kpis.duration > 0 ? (kpis.duration >= 100 * 3600 ? `${Math.round(kpis.duration / 3600)} h` : fmtDur(kpis.duration)) : "—", "#8B5CF6", "#C084FC"],
            ["⚖ Poids", kpis.weight_g > 0 ? `${(kpis.weight_g/1000).toFixed(kpis.weight_g >= 10000 ? 1 : 2).replace(".", ",")} kg` : "—", "#F59E0B", "#FBBF24"],
            ["💶 Coût", kpis.cost > 0 ? `${moneyVal(kpis.cost, kpis.cost >= 100 ? 0 : 2).replace(".", ",")} €` : "—", "#16A34A", "#4ADE80"],
          ].map(([label, val, c1, c2])=>(
            <div key={label} style={{ minWidth:0, padding:"7px 8px", borderRadius:14, border:`1px solid color-mix(in srgb, ${c1} 22%, var(--border))`,
              background:`radial-gradient(90% 70% at 100% 0%, ${c1}22, transparent 70%), var(--surface2)`, boxShadow:`0 6px 18px -12px ${c1}` }}>
              <div style={{ fontSize:9.5, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase", color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden" }}>{label}</div>
              <div style={{ fontSize:"clamp(13px, 3.9vw, 16px)", fontWeight:900, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", fontVariantNumeric:"tabular-nums",
                ...v2grad(c1, c2) }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Recherche + Filtres + .3mf */}
      {viewMode!=="makerworld" && viewMode!=="queue" && (() => {
        // les filtres actifs : une etiquette chacun, ✕ pour l'enlever
        const fil = (Array.isArray(allFilaments) ? allFilaments : []).find(f => String(f.id) === filamentIdF);
        const bucket = (Array.isArray(colorBuckets) ? colorBuckets : []).find(b => b.slug === colorF);
        const dFr = d => d ? new Date(d + "T00:00").toLocaleDateString("fr-FR", { day:"numeric", month:"short" }) : "…";
        const SORTS = { oldest:"Plus ancien", cost:"Coût ↓", weight:"Poids ↓", duration:"Durée ↓" };
        const chips = [
          (dateFrom || dateTo) && ["📅", `${dFr(dateFrom)} → ${dFr(dateTo)}`, () => setDates("", "")],
          statusF && ["●", STATUS_CFG[statusF]?.label || statusF, () => setStatusF("")],
          sortF !== "recent" && ["↕", SORTS[sortF] || sortF, () => setSortF("recent")],
          materialF && ["🧪", materialF, () => setMaterialF("")],
          filaTypeF && ["🏷️", filaTypeF, () => setFilaTypeF("")],
          colorF && ["🎨", bucket?.label || colorF, () => setColorF("")],
          filamentIdF && ["🧵", fil ? (fil.translated_name || fil.name) : `#${filamentIdF}`, () => setFilamentIdF("")],
        ].filter(Boolean);
        const round = on => ({ width:40, height:40, borderRadius:14, border:"1px solid var(--border)", flexShrink:0, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center", background: on ? "rgba(59,130,246,0.14)" : "var(--surface2)", color: on ? "#3b82f6" : "var(--muted)" });
        return <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <div style={{ position:"relative", flex:1, minWidth:0 }}>
              <Search size={15} style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un print…"
                style={{ width:"100%", height:40, padding:"0 34px 0 38px", boxSizing:"border-box",
                  background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:20,
                  fontSize:13, color:"var(--text)", outline:"none" }}/>
              {search && <button onClick={() => setSearch("")} aria-label="Effacer la recherche" style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)",
                width:24, height:24, borderRadius:"50%", border:"none", background:"var(--surface)", color:"var(--muted)", cursor:"pointer", fontSize:12 }}>✕</button>}
            </div>
            <button onClick={()=>setFilterOpen(true)} aria-label="Filtres et tri" data-tip="Filtres et tri" style={{ ...round(chips.length > 0), position:"relative" }}>
              <SlidersHorizontal size={16}/>
              {chips.length > 0 && <span style={{ position:"absolute", top:-5, right:-5, minWidth:18, height:18, padding:"0 4px", borderRadius:9, fontSize:10.5,
                fontWeight:900, color:"#fff", background:"#3b82f6", display:"flex", alignItems:"center", justifyContent:"center", border:"2px solid var(--bg)" }}>{chips.length}</span>}
            </button>
            {viewMode==="list" && <button onClick={() => setRows(!rows)} aria-label={rows ? "Afficher en grille" : "Afficher en rangées"}
              data-tip={rows ? "En grille" : "En rangées"} style={round(false)}>{rows ? "▦" : "☰"}</button>}
            {viewMode==="list" && (
              <AdminOnly><button onClick={()=>selectMode?exitSelectMode():setSelectMode(true)}
                aria-label={selectMode?"Annuler la sélection":"Sélectionner"} data-tip={selectMode?"Annuler la sélection":"Sélectionner"} style={round(selectMode)}>
                <Check size={16}/>
              </button></AdminOnly>
            )}
            <AdminOnly><label data-tip="Importer un .3mf" style={round(false)}>
              <Upload size={16}/>
              <input type="file" accept=".3mf" onChange={handleImport} style={{ display:"none" }}/>
            </label></AdminOnly>
          </div>
          {chips.length > 0 && <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            {chips.map(([ic, l, off]) => <span key={l} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 6px 4px 10px", borderRadius:20,
              fontSize:12, fontWeight:800, color:"#3b82f6", background:"rgba(59,130,246,0.12)", border:"1px solid rgba(59,130,246,0.25)" }}>
              <span>{ic}</span>{l}
              <button onClick={off} aria-label={`Retirer ${l}`} style={{ width:18, height:18, borderRadius:"50%", border:"none", background:"rgba(59,130,246,0.2)",
                color:"#3b82f6", cursor:"pointer", fontSize:10, fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button></span>)}
            {chips.length > 1 && <button onClick={clearFilters}
              style={{ fontSize:12, fontWeight:800, color:"var(--muted)", background:"none", border:"none", cursor:"pointer" }}>Tout effacer</button>}
          </div>}
        </div>;
      })()}

      {filterOpen && (() => {
        // Le panneau des filtres (25/10/2026) : une carte par critere (son titre et ce qui est choisi), des
        // raccourcis de periode, les etats en couleur, le tri en grille, les teintes en pastilles ; en bas, toujours
        // visibles, « Tout effacer » et « Voir N impressions » (le compte suit les filtres en direct).
        const ymdL = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const today = new Date();
        const back = n => { const d = new Date(); d.setDate(d.getDate() - n + 1); return ymdL(d); };
        const PERIODS = [["all", "Tout", "", ""], ["7", "7 jours", back(7), ""], ["30", "30 jours", back(30), ""],
          ["month", "Ce mois", ymdL(new Date(today.getFullYear(), today.getMonth(), 1)), ""], ["year", "Cette année", ymdL(new Date(today.getFullYear(), 0, 1)), ""]];
        const period = PERIODS.find(([, , a, b]) => a === dateFrom && b === dateTo);
        const anyF = !!(searchQ || statusF || sortF !== "recent" || materialF || filaTypeF || filamentIdF || colorF || dateFrom || dateTo);   // la recherche aussi : « Tout effacer » la vide
        const clearAll = clearFilters;
        const chip = (on, c = "#3b82f6") => ({ display:"inline-flex", alignItems:"center", gap:5, padding:"7px 13px", borderRadius:20, fontSize:12.5, fontWeight:800,
          cursor:"pointer", border:`1px solid ${on ? c : "var(--border)"}`, background: on ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 72%, #ffffff))` : "var(--surface)",
          color: on ? "#fff" : "var(--text2)", boxShadow: on ? `0 4px 12px -4px ${c}` : "none" });
        const sec = (ic, title, val, c, body) => (
          <div style={{ padding:"12px 12px 13px", borderRadius:18, border:"1px solid var(--border)",
            background:`radial-gradient(80% 60% at 100% 0%, ${c}14, transparent 70%), var(--surface2)`, display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ width:28, height:28, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, background:`${c}22`, flexShrink:0 }}>{ic}</span>
              <span style={{ fontSize:13.5, fontWeight:900, color:"var(--text)" }}>{title}</span>
              {val && <span style={{ marginLeft:"auto", fontSize:11.5, fontWeight:800, color:c, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"55%" }}>{val}</span>}
            </div>
            {body}
          </div>);
        const dateIn = (v, on, lbl, extra) => <label style={{ flex:1, minWidth:0, fontSize:11, fontWeight:700, color:"var(--muted)" }}>{lbl}
          <input type="date" value={v} {...extra} onChange={e => on(e.target.value)} style={{ display:"block", width:"100%", boxSizing:"border-box", marginTop:4, height:40,
            padding:"0 10px", borderRadius:12, border:"1px solid var(--border)", background:"var(--surface)", color:"var(--text)", fontSize:13 }}/></label>;
        const STATUS_C = { "":"#64748B", IN_PROGRESS:"#3B82F6", SUCCESS:"#22C55E", PARTIAL:"#F59E0B", TO_REDO:"#A855F7", FAILED:"#EF4444" };
        const STATUS_I = { "":"✱", IN_PROGRESS:"●", SUCCESS:"✓", PARTIAL:"◐", TO_REDO:"↻", FAILED:"✕" };
        const SORTS = [["recent","🕒","Plus récent"],["oldest","🕰️","Plus ancien"],["cost","💶","Coût ↓"],["weight","⚖","Poids ↓"],["duration","⏱","Durée ↓"]];
        const types = materialF ? allFilaTypes.filter(t => allFilaments.some(f => f.material === materialF && f.fila_type === t)) : allFilaTypes;
        const selFil = (Array.isArray(allFilaments) ? allFilaments : []).find(f => String(f.id) === filamentIdF);
        const bucket = colorBuckets.find(b => b.slug === colorF);
        return (
        <div data-no-pull="" style={{ position:"fixed", inset:0, background:"rgba(2,6,23,0.55)", backdropFilter:"blur(6px)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
          onClick={()=>setFilterOpen(false)}>
          <div onClick={e=>e.stopPropagation()} className="sheet-inner"
            style={{ width:"100%", maxWidth:640, background:"var(--sheet-bg)", borderRadius:"26px 26px 0 0", border:"1px solid var(--border)",
              maxHeight:"88dvh", display:"flex", flexDirection:"column", overflow:"hidden", animation:"bn-sheet-up .3s cubic-bezier(.2,.8,.2,1)" }}>
            <div style={{ padding:"10px 16px 14px", flexShrink:0, background:"linear-gradient(135deg, color-mix(in srgb, #3B82F6 22%, var(--sheet-bg)), var(--sheet-bg) 70%)" }}>
              <div style={{ width:42, height:4, borderRadius:4, background:"var(--border)", margin:"0 auto 10px" }}/>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ width:40, height:40, borderRadius:13, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff",
                  background:"linear-gradient(135deg, #3B82F6, #60A5FA)", boxShadow:"0 8px 20px #3B82F655", flexShrink:0 }}><SlidersHorizontal size={19}/></span>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"block", fontSize:18, fontWeight:900, color:"var(--text)" }}>Filtres & tri</span>
                  <span style={{ display:"block", fontSize:12, fontWeight:700, color:"var(--muted)" }}>{total} impression{total > 1 ? "s" : ""}{anyF ? " avec ces filtres" : ""}</span>
                </span>
                <button onClick={()=>setFilterOpen(false)} aria-label="Fermer" style={{ width:34, height:34, borderRadius:11, background:"var(--surface)", border:"1px solid var(--border)",
                  cursor:"pointer", color:"var(--text2)", fontSize:15 }}>✕</button>
              </div>
            </div>

            <div style={{ flex:1, minHeight:0, overflowY:"auto", padding:"4px 14px 14px", display:"flex", flexDirection:"column", gap:10 }}>
              {sec("📅", "Période", period ? (period[0] === "all" ? null : period[1]) : `${dateFrom || "…"} → ${dateTo || "…"}`, "#3B82F6", <>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {PERIODS.map(([id, l, a, b]) => <button key={id} onClick={() => setDates(a, b)} style={chip(period?.[0] === id)}>{l}</button>)}
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  {dateIn(dateFrom, setDateFrom, "Début", { max: dateTo || undefined })}
                  {dateIn(dateTo, setDateTo, "Fin (incluse)", { min: dateFrom || undefined })}
                </div></>)}

              {sec("●", "Statut", statusF ? STATUS_LABELS[statusF] : null, STATUS_C[statusF] || "#64748B",
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {STATUSES.map(s => <button key={s} onClick={()=>setStatusF(s)} style={chip(statusF===s, STATUS_C[s])}>
                    <span style={{ color: statusF===s ? "#fff" : STATUS_C[s] }}>{STATUS_I[s]}</span>{STATUS_LABELS[s]}</button>)}
                </div>)}

              {sec("↕", "Trier par", sortF !== "recent" ? SORTS.find(x => x[0] === sortF)?.[2] : null, "#8B5CF6",
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(118px, 1fr))", gap:6 }}>
                  {SORTS.map(([id, ic, l]) => <button key={id} onClick={()=>setSortF(id)} style={{ ...chip(sortF===id, "#8B5CF6"), justifyContent:"center", borderRadius:14 }}>
                    <span>{ic}</span>{l}</button>)}
                </div>)}

              {(allMaterials.length > 0 || allFilaTypes.length > 0) && sec("🧪", "Matière", [materialF, filaTypeF].filter(Boolean).join(" · ") || null, "#F97316", <>
                {allMaterials.length > 0 && <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  <button onClick={()=>{ setMaterialF(""); }} style={chip(!materialF, "#F97316")}>Toutes</button>
                  {allMaterials.map(m => <button key={m} onClick={()=>setMaterialF(materialF===m?"":m)} style={chip(materialF===m, "#F97316")}>{m}</button>)}
                </div>}
                {types.length > 0 && <>
                  <div style={{ fontSize:10.5, fontWeight:800, letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)" }}>Type de filament{materialF ? ` (${materialF})` : ""}</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {types.map(t => <button key={t} onClick={()=>setFilaTypeF(filaTypeF===t?"":t)} style={{ ...chip(filaTypeF===t, "#F97316"), fontSize:12, padding:"6px 11px" }}>{t}</button>)}
                  </div></>}
              </>)}

              {colorBuckets.length > 0 && sec("🎨", "Teinte", bucket?.label || null, "#EC4899", <>
                <div style={{ fontSize:11.5, color:"var(--muted)", marginTop:-4 }}>Les prints qui utilisent un filament de cette couleur.</div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {colorBuckets.map(b => { const on = colorF === b.slug;
                    return <button key={b.slug} onClick={()=>setColorF(on ? "" : b.slug)} data-tip={`${b.label} · ${b.count}`}
                      style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, width:58, padding:"6px 2px", borderRadius:14, cursor:"pointer",
                        border:`1px solid ${on ? "#EC4899" : "transparent"}`, background: on ? "rgba(236,72,153,0.12)" : "transparent" }}>
                      <span style={{ width:30, height:30, borderRadius:"50%", background:b.hex, boxShadow: on ? "0 0 0 3px var(--sheet-bg), 0 0 0 5px #EC4899" : "0 0 0 1px rgba(128,128,128,0.4)" }}/>
                      <span style={{ fontSize:10.5, fontWeight:800, color: on ? "#EC4899" : "var(--text2)", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.label}</span>
                      <span style={{ fontSize:9.5, fontWeight:700, color:"var(--muted)" }}>{b.count}</span>
                    </button>; })}
                </div></>)}

              {sec("🧵", "Filament exact", selFil ? (selFil.translated_name || selFil.name) : null, "#14B8A6", <>
                {selFil && <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 8px 7px 10px", borderRadius:12, background:"rgba(20,184,166,0.12)",
                  border:"1px solid rgba(20,184,166,0.35)" }}>
                  <ColorDot hex={selFil.color} colors={selFil.colors_array} multicolor={selFil.multicolor_type} size={18}/>
                  <span style={{ flex:1, minWidth:0, fontSize:12.5, fontWeight:800, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                    {selFil.translated_name || selFil.name}</span>
                  <button onClick={()=>setFilamentIdF("")} aria-label="Retirer ce filament" style={{ border:"none", background:"none", color:"#0d9488", cursor:"pointer", fontWeight:900 }}>✕</button>
                </div>}
                <div style={{ position:"relative" }}>
                  <Search size={14} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
                  <input value={filSearch} onChange={e=>setFilSearch(e.target.value)} placeholder="Nom, marque, matériau, type…"
                    style={{ width:"100%", boxSizing:"border-box", height:40, padding:"0 12px 0 34px", borderRadius:20, border:"1px solid var(--border)", background:"var(--surface)",
                      color:"var(--text)", fontSize:13, outline:"none" }}/>
                </div>
                <div style={{ maxHeight:240, overflowY:"auto", display:"flex", flexDirection:"column", gap:3, overscrollBehavior:"contain" }}>
                  {(() => {
                    // Cohérent avec les autres filtres : on n'affiche que les filaments
                    // compatibles avec matériau / type / teinte déjà sélectionnés.
                    const words = filSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
                    const list = (Array.isArray(allFilaments) ? allFilaments : []).filter(f => {
                      if (materialF && f.material !== materialF) return false;
                      if (filaTypeF && f.fila_type !== filaTypeF) return false;
                      if (colorF && !(f.color_bucket||"").split(",").map(t=>t.trim()).includes(colorF)) return false;
                      if (!words.length) return true;
                      const hay = [f.translated_name, f.name, f.name_en, f.manufacturer,
                        f.material, f.fila_type, f.color_bucket, "#"+f.id].filter(Boolean).join(" ").toLowerCase();
                      return words.every(w => hay.includes(w));
                    });
                    if (!list.length) return <p style={{ fontSize:12, color:"var(--muted)", padding:"8px 4px", margin:0 }}>Aucun filament ne correspond.</p>;
                    // Groupé par matériau, trié alphabétiquement (liste complète, pas de troncature)
                    const byMat = {};
                    list.forEach(f => { (byMat[f.material||"Autre"] ||= []).push(f); });
                    return Object.keys(byMat).sort().map(mat => (
                      <div key={mat}>
                        <p style={{ fontSize:10, fontWeight:800, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"8px 0 3px",
                          position:"sticky", top:0, background:"var(--surface2)", padding:"2px 0", zIndex:1 }}>
                          {mat} <span style={{ opacity:0.6 }}>({byMat[mat].length})</span>
                        </p>
                        {byMat[mat]
                          .sort((a,b)=>(a.translated_name||a.name||"").localeCompare(b.translated_name||b.name||""))
                          .map(f => { const on = filamentIdF===String(f.id);
                            return <button key={f.id} onClick={()=>{ setFilamentIdF(on?"":String(f.id)); }}
                              style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", width:"100%", borderRadius:12, cursor:"pointer", textAlign:"left",
                                marginBottom:3, border:`1px solid ${on ? "rgba(20,184,166,0.5)" : "transparent"}`, background: on ? "rgba(20,184,166,0.14)" : "var(--surface)" }}>
                              <ColorDot hex={f.color} colors={f.colors_array} multicolor={f.multicolor_type} size={18}/>
                              <span style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column" }}>
                                <span style={{ fontSize:12.5, fontWeight:800, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.translated_name||f.name}</span>
                                <span style={{ fontSize:11, fontWeight:600, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                  {[f.manufacturer, f.fila_type].filter(Boolean).join(" · ")}</span>
                              </span>
                              {on && <span style={{ color:"#0d9488", fontWeight:900 }}>✓</span>}
                            </button>; })}
                      </div>
                    ));
                  })()}
                </div></>)}
            </div>

            {/* en bas, toujours a portee : tout effacer, et voir le resultat */}
            <div style={{ flexShrink:0, display:"flex", gap:8, padding:"10px 14px calc(12px + env(safe-area-inset-bottom, 0px))", borderTop:"1px solid var(--border)",
              background:"color-mix(in srgb, var(--sheet-bg) 94%, transparent)" }}>
              <button onClick={clearAll} disabled={!anyF} style={{ flex:1, padding:"12px", borderRadius:14, border:"1px solid var(--border)", background:"var(--surface2)",
                color: anyF ? "var(--text)" : "var(--muted)", fontSize:13.5, fontWeight:800, cursor: anyF ? "pointer" : "default", opacity: anyF ? 1 : 0.6 }}>Tout effacer</button>
              <button onClick={()=>setFilterOpen(false)} style={{ flex:2, padding:"12px", borderRadius:14, border:"none",
                background:"linear-gradient(135deg, #2563EB, #60A5FA)", color:"white", fontSize:14, fontWeight:900, cursor:"pointer", boxShadow:"0 8px 20px -8px #3B82F6" }}>
                Voir {total} impression{total > 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>);
      })()}

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
            <div style={rows ? { display:"flex", flexDirection:"column", gap:8 } : { display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))", gap:10 }}>
              {prints.map(p => <PrintCard key={p.id} p={p} row={rows} onClick={()=>setSelected(p)} onDelete={onDelete} onChanged={() => load()} onLongPress={id=>{ setSelectMode(true); setSelectedIds(new Set([id])); }}/>)}
            </div>
          );
        }

        // la liste d'items (solos et groupes, tries) est calculee plus haut (listItems), partagee avec les ‹ › de la fiche
        const items = listItems;
        const GRID = "repeat(auto-fill, minmax(160px, 1fr))";
        return (
          <div style={rows ? { display:"flex", flexDirection:"column", gap:8 } : { display:"grid", gridTemplateColumns:GRID, gap:10 }}>
            {items.map((item, idx) => item.type === "print" ? (
              <PrintCard key={item.p.id} p={item.p} row={rows}
                onClick={()=>setSelected(item.p)}
                onDelete={onDelete}
                onChanged={() => load()}
                selectMode={selectMode}
                selected={selectedIds.has(item.p.id)}
                onToggleSelect={toggleSelect}
                onLongPress={id => { setSelectMode(true); setSelectedIds(new Set([id])); }}/>
            ) : (
              <GroupTile key={item.groupId} groupId={item.groupId} name={item.name} row={rows}
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

      {groupDeep && <GroupBottomSheet groupId={groupDeep.id} name={groupDeep.name} prints={groupDeep.prints} latestDate={groupDeep.latestDate}
        number_of_items={groupDeep.number_of_items} cover_print_id={groupDeep.cover_print_id} onClose={closeGroupDeep}
        onSelectPrint={p => setSelected(p)} onUngroup={() => { closeGroupDeep(); load(); loadGroups(); }}
        onDelete={id => setPrints(ps => ps.filter(p => p.id !== id))} onUpdated={() => { load(); loadGroups(); }}/>}

      {selected && <PrintDetail p={selected} onClose={()=>{ setSelected(null); closeDeep(); }} onPrev={onPrevPrint} onNext={onNextPrint}
        onDelete={id=>{setPrints(ps=>ps.filter(p=>p.id!==id));setTotal(t=>t-1);}}
        onChanged={() => { load(); loadGroups(); }}/>}

      {/* Barre flottante de sélection multiple */}
      {selectMode && (selectedIds.size > 0 || selectedGroups.length > 0) && (
        /* Deux rangees plutot qu'une seule : quatre elements cote a cote
           debordaient de l'ecran sur telephone, "Annuler" se retrouvait coupe.
           Le compte et l'abandon tiennent sur la premiere ligne, les deux
           actions se partagent la seconde en parts egales -- cibles larges au
           doigt, et aucune largeur a deviner. */
        <div style={{ position:"fixed", bottom:"calc(76px + env(safe-area-inset-bottom,0px))",
          left:12, right:12, zIndex:500, maxWidth:620, margin:"0 auto",
          background:"color-mix(in srgb, var(--sheet-bg) 92%, transparent)", backdropFilter:"blur(10px)",
          border:"1px solid color-mix(in srgb, #3B82F6 30%, var(--border))", borderRadius:20,
          padding:12, display:"flex", flexDirection:"column", gap:8,
          boxShadow:"0 14px 40px rgba(0,0,0,0.35)" }}>

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
      <HiddenMark egg="rubber_duck" e="🦆" side="right"/>
      <Cachettes spot="prints"/>
    </div>
  );
}

// ── Fusion de groupes ───────────────────────────────────────────────────────
// Les groupes choisis n'en font plus qu'un. On choisit celui qui reste (son nom,
// ses vignettes) ; le nombre d'elements propose est la somme de ceux de chaque
// groupe (1 par defaut), a valider ou corriger avant d'envoyer.
function GroupMergeSheet({ groups, onClose, onDone }) {
  useTrackDetail("Historique · Fusionner des groupes");
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
  useTrackDetail("Historique · Choisir un groupe");
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
