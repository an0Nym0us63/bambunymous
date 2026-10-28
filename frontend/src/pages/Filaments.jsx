import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import HiddenMark from "../components/HiddenMark";
import Cachettes, { Hide } from "../components/Cachettes";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useUrlTab, keepTabs } from "../utils/useUrlTab";
import ScanSheet from "../components/ScanSheet";
import RfidSheet from "../components/RfidSheet";
import { useRfidScan } from "../store/rfidScan";
import DryNowDialog from "../components/DryNowDialog";
import TarePicker, { useSpoolTares, tareForBrand } from "../components/TarePicker";
import HeaderAction from "../components/HeaderAction";
import { Plus, Search, Archive, X, Save, RefreshCw, Pencil, SlidersHorizontal, ScanLine, Droplets, Nfc, Palette, Tag, Sun } from "lucide-react";
import client, { apiUrl, apiThumb } from "../api/client";
import { useFriend } from "../store/friend";
import { showAlert, showConfirm } from "../utils/dialog";
import { moneyVal, isMoneyHidden, MONEY_MASK } from "../utils/money";
import AdminOnly from "../components/AdminOnly";
import IncomingOrders, { OrderSheet } from "../components/IncomingOrders";
import { useTrackDetail } from "../utils/track";
import Select from "../components/Select";
import { useIsAdmin } from "../store/auth";
import { Pressable, openMenu } from "../components/ContextMenu";
import { colorBg, parseColorsList, finishOf, autoFinishOf, FINISHES } from "../utils/colors";
import SpoolSVG from "../components/SpoolSVG";
import { EmptyCard, FCard, FLAB, FROW, FRow, FSheet, FTile, FVAL, KpiBar, PageTabs, SearchRow, agoFr, dayFr, fBtn, fChip, fGrad, fRound, isLight, lighten } from "../components/FicheKit";
import GalleryCompare from "../components/GalleryCompare";
import { PrintDetail, GroupBottomSheet } from "./Prints";
import { FriendsPrints, useHasFriends, useShared, sharedCount } from "../components/Friends";

const MATERIALS = ["PLA","PETG","ABS","ASA","PA","PC","TPU","PVA","BVOH","PLA-CF","PETG-CF","PA-CF","PPS"];

// ── Helpers ────────────────────────────────────────────────────────────────
const inp = {
  width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
  borderRadius:8, padding:"8px 12px", fontSize:13, color:"var(--text)",
  outline:"none", transition:"border-color 0.15s",
};
const inpFocus = e => e.target.style.borderColor="#3b82f6";
const inpBlur  = e => e.target.style.borderColor="var(--border)";

// Parse "colors_array" (CSV hex, sans #) → liste de couleurs CSS, avec fallback sur color simple
// Convertit hex 6 ou 8 chars → CSS color (rgba si alpha < FF)
function hexToCss(hex) {
  if (!hex) return null;
  const h = hex.replace(/^#/, "").toLowerCase();
  if (h.length === 8) {
    const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16),
          b=parseInt(h.slice(4,6),16), a=parseInt(h.slice(6,8),16);
    if (a === 255) return `#${h.slice(0,6)}`;
    return `rgba(${r},${g},${b},${(a/255).toFixed(3)})`;
  }
  if (h.length === 6) return `#${h}`;
  return null;
}

// Affichage texte d'une couleur : toujours en hex (#rrggbb ou #rrggbbaa)
// hexToCss sert uniquement pour les background-color CSS
function hexDisplay(hex) {
  if (!hex) return null;
  const h = hex.replace(/^#/, "").toLowerCase();
  if (h.length === 6 || h.length === 8) return `#${h}`;
  return null;
}


// Swatch couleur — le damier de transparence est géré par colorBg.
// La finition d'un filament : preremplie d'apres son nom ou son type (« PLA Silk+ »), a choisir pour tout
// filament (une autre marque n'a pas forcement le mot dans son nom). L'apercu la montre sur sa couleur.
function FinishPicker({ value, auto, colors, style, lStyle, onChange }) {
  return <div style={{ marginBottom:10 }}>
    <label style={lStyle}>Finition</label>
    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
      <div style={{ flex:1, minWidth:0 }}>
        <Select style={style} value={value || "none"} onChange={e => onChange(e.target.value)}
          options={[{ value:"none", label: auto ? "Aucune" : "Aucune · d'après le nom" },
            ...FINISHES.map(([k, l]) => ({ value:k, label: k === auto ? `${l} · d'après le nom` : l }))]}/></div>
      <span style={{ width:34, height:34, flexShrink:0, borderRadius:9, border:"1px solid var(--border)", overflow:"hidden",
        ...colorBg(colors?.length ? colors : ["#9CA3AF"], null, value === "none" ? null : value, { size: 34 }) }}/>
    </div>
  </div>;
}

function ColorSwatch({ color, colorsArray, multicolorType, finish = null, size=40, radius=10 }) {
  const colors = parseColorsList(color, colorsArray);
  return (
    <div style={{ width:size, height:size, borderRadius:radius, flexShrink:0,
      overflow:"hidden", boxShadow:"inset 0 0 0 1px rgba(0,0,0,0.12)",
      ...colorBg(colors, multicolorType, finish, { size: size }) }}/>
  );
}

function ColorDot({ color, colorsArray, multicolorType, finish = null, size=16 }) {
  return <ColorSwatch color={color} colorsArray={colorsArray} multicolorType={multicolorType} finish={finish}
    size={size} radius={4}/>;
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
function AddSpoolModal({ filaments: filamentsProp, onSave, onClose, preselect }) {
  useTrackDetail("Filaments · Ajouter une bobine");
  const [form, setForm] = useState({ filament_id: preselect ? String(preselect) : "",
    remaining_weight_g:"", price_override:"", tag_number:"", comment:"" });
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  // Ouvrable depuis la fiche filament, qui ne connait pas la liste complete.
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (filamentsProp) return;
    client.get("/filaments/filaments").then(r => setFetched(r.data || [])).catch(() => setFetched([]));
  }, [filamentsProp]);
  const filaments = filamentsProp || fetched || [];

  const selected = filaments.find(f => String(f.id) === String(form.filament_id));

  const handleSave = async () => {
    if (!form.filament_id) return;
    setSaving(true);
    try {
      await client.post("/filaments/spools", {
        filament_id: parseInt(form.filament_id),
        remaining_weight_g: form.remaining_weight_g ? parseFloat(form.remaining_weight_g) : null,
        price_override: form.price_override ? parseFloat(form.price_override) : null,
        tag_number: form.tag_number || null,
        comment: form.comment || null,
      });
      onSave();
    } finally { setSaving(false); }
  };

  const Label = ({ children }) => (
    <label style={{ display:"block", fontSize:12, fontWeight:800, color:"var(--muted)", marginBottom:5 }}>{children}</label>
  );
  const field = { width:"100%", boxSizing:"border-box", height:42, padding:"0 12px", borderRadius:12, fontSize:14, fontWeight:700,
    background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" };
  const selColors = selected ? parseColorsList(selected.color, selected.colors_array) : null;
  const selMain = selected ? (paleHex(selected.color) ? "#94a3b8" : (hexToCss(selected.color) || "#3B82F6")) : "#3B82F6";
  const full = selected?.filament_weight_g || 1000;

  return (
    <FSheet onClose={onClose} z={1100}
      bottom={<>
        <button onClick={onClose} style={{ ...fBtn, flex:1, color:"var(--muted)" }}>Annuler</button>
        <button onClick={handleSave} disabled={saving||!form.filament_id}
          style={{ ...fBtn, flex:2, border:"none", color:"#fff", opacity: saving||!form.filament_id ? 0.5 : 1,
            background:"linear-gradient(135deg, #22C55E, #16A34A)", boxShadow:"0 8px 18px -10px #22C55E" }}>
          {saving ? <RefreshCw size={14} style={{animation:"spin 1s linear infinite"}}/> : <Save size={14}/>}
          Enregistrer la bobine
        </button>
      </>}>
      {/* en-tete : la bobine qui va naitre, a la couleur du filament choisi */}
      <div style={{ padding:"44px 16px 16px", display:"flex", alignItems:"center", gap:14,
        background:`radial-gradient(circle at 15% 50%, ${selMain}50, transparent 60%), linear-gradient(135deg, ${selMain}22, transparent 70%), var(--surface2)` }}>
        <span style={{ display:"inline-flex", flexShrink:0, filter:`drop-shadow(0 6px 14px ${selMain}66)` }}>
          {selected ? <SpoolSVG colors={selColors} finish={finishOf(selected)} size={74} type={selected.multicolor_type}/>
            : <span style={{ width:74, height:74, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30,
                border:"2px dashed var(--border)", color:"var(--muted)" }}>＋</span>}</span>
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ fontSize:10.5, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#22C55E" }}>＋ Nouvelle bobine</div>
          <div style={{ fontSize:19, fontWeight:900, color:"var(--text)", lineHeight:1.2 }}>
            {selected ? (selected.translated_name || selected.name) : "Choisis le filament"}</div>
          {selected && <div style={{ fontSize:12.5, fontWeight:700, color:"var(--text2)" }}>
            {[selected.manufacturer, selected.fila_type || selected.material].filter(Boolean).join(" · ")}</div>}
        </div>
      </div>

      <div style={{ padding:"12px 14px 18px", display:"flex", flexDirection:"column", gap:12 }}>
        <FCard t="Filament *" i="🎨" c="#8B5CF6" aside={selected && <button onClick={() => { setForm(f => ({...f, filament_id:""})); setQ(""); }}
          style={{ padding:"4px 10px", borderRadius:20, fontSize:11.5, fontWeight:800, cursor:"pointer", border:"1px solid var(--border)",
            background:"var(--surface)", color:"var(--text2)" }}>Changer</button>}>
          {/* Un <select> natif avec des centaines de references, en vrac et sans
              couleur, etait inutilisable : liste cherchable, groupee par matiere,
              avec la pastille. */}
          {selected ? (
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", marginTop:4,
              borderRadius:12, background:"rgba(139,92,246,0.12)", border:"1px solid rgba(139,92,246,0.3)" }}>
              <ColorDot color={selected.color} colorsArray={selected.colors_array} finish={finishOf(selected)}
                multicolorType={selected.multicolor_type} size={20}/>
              <span style={{ flex:1, minWidth:0, fontSize:13, color:"var(--text)", fontWeight:800,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {selected.translated_name || selected.name}
                <span style={{ color:"var(--muted)", fontWeight:600 }}>
                  {" · "}{[selected.manufacturer, selected.fila_type || selected.material].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button onClick={() => { setForm(f => ({...f, filament_id:""})); setQ(""); }} aria-label="Changer de filament"
                style={{ background:"none", border:"none", cursor:"pointer",
                  color:"var(--muted)", fontSize:14 }}>✕</button>
            </div>
          ) : (<>
            <div style={{ position:"relative", margin:"4px 0 8px" }}>
              <Search size={15} style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
              <input value={q} onChange={e => setQ(e.target.value)} autoFocus
                placeholder="Rechercher : nom, marque, matière, teinte…"
                style={{ ...field, height:40, borderRadius:20, padding:"0 14px 0 38px", fontWeight:600, fontSize:13 }}/>
            </div>
            <div style={{ maxHeight:240, overflowY:"auto", display:"flex",
              flexDirection:"column", gap:3 }}>
              {(() => {
                const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
                const list = filaments.filter(f => {
                  if (!words.length) return true;
                  const hay = [f.translated_name, f.name, f.manufacturer, f.material,
                    f.fila_type, f.color_bucket, "#" + f.id].filter(Boolean).join(" ").toLowerCase();
                  return words.every(w => hay.includes(w));
                });
                if (!list.length) return (
                  <p style={{ fontSize:12, fontWeight:700, color:"var(--muted)", padding:8, margin:0 }}>
                    Aucun filament ne correspond.
                  </p>
                );
                const byMat = {};
                list.forEach(f => { (byMat[f.material || "Autre"] ||= []).push(f); });
                return Object.keys(byMat).sort().map(mat => (
                  <div key={mat}>
                    <p style={{ fontSize:10, fontWeight:900, color:"#8B5CF6",
                      textTransform:"uppercase", letterSpacing:"0.06em", margin:"6px 0 4px",
                      position:"sticky", top:0, background:"var(--surface2)", padding:"2px 0", zIndex:1 }}>
                      {mat} <span style={{ opacity:0.6 }}>({byMat[mat].length})</span>
                    </p>
                    {byMat[mat]
                      .sort((a,b) => (a.translated_name||a.name||"").localeCompare(b.translated_name||b.name||""))
                      .map(f => (
                      <button key={f.id} onClick={() => setForm(fm => ({...fm, filament_id:String(f.id)}))}
                        style={{ display:"flex", alignItems:"center", gap:9, width:"100%",
                          padding:"8px 10px", borderRadius:12, border:"1px solid var(--border)", cursor:"pointer",
                          textAlign:"left", marginBottom:3, background:"var(--surface)" }}>
                        <ColorDot color={f.color} colorsArray={f.colors_array} finish={finishOf(f)}
                          multicolorType={f.multicolor_type} size={18}/>
                        <span style={{ flex:1, minWidth:0, fontSize:12.5, fontWeight:800, color:"var(--text)",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {f.translated_name || f.name}
                          <span style={{ color:"var(--muted)", fontWeight:600 }}>
                            {" · "}{[f.manufacturer, f.fila_type].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ));
              })()}
            </div>
          </>)}
        </FCard>

        <FCard t="Quantité et prix" i="⚖" c="#F59E0B">
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:4 }}>
            {[["Reste (g)","remaining_weight_g","number",String(full)],["Prix (€)","price_override","number",selected?.price != null ? String(selected.price) : ""]].map(([l,n,t,p])=>(
              <div key={n}>
                <Label>{l}</Label>
                <input type={t} inputMode="decimal" value={form[n]||""} placeholder={p}
                  onChange={e=>setForm(f=>({...f,[n]:e.target.value}))} style={field}/>
              </div>
            ))}
          </div>
          {/* raccourcis : une bobine neuve, ou entamee */}
          <div style={{ display:"flex", gap:5, marginTop:8 }}>
            {[[1, "Pleine"], [0.75, "¾"], [0.5, "½"], [0.25, "¼"]].map(([k, l]) => {
              const v = String(Math.round(full * k)), on = form.remaining_weight_g === v;
              return <button key={l} onClick={() => setForm(f => ({ ...f, remaining_weight_g: v }))} style={{ flex:1, padding:"6px 0", borderRadius:10,
                fontSize:12, fontWeight:800, cursor:"pointer", border: on ? "1px solid transparent" : "1px solid var(--border)",
                background: on ? "linear-gradient(135deg, #F59E0B, #FBBF24)" : "var(--surface)", color: on ? "#fff" : "var(--text2)" }}>{l}</button>;
            })}
          </div>
          <p style={{ fontSize:11.5, fontWeight:600, color:"var(--muted)", margin:"8px 0 0" }}>Vides, ils valent une bobine pleine au prix du filament.</p>
        </FCard>

        {/* location n'est PAS editable : geree automatiquement (Tiroir / AMS xxx)
            par le worker spool_location selon la presence en AMS. */}
        <FCard t="Le reste (facultatif)" i="🏷️" c="#06B6D4">
          {[["Tag NFC","tag_number","text","UUID"],["Commentaire","comment","text",""]].map(([l,n,t,p])=>(
            <div key={n} style={{ marginTop:6 }}>
              <Label>{l}</Label>
              <input type={t} value={form[n]||""} placeholder={p}
                onChange={e=>setForm(f=>({...f,[n]:e.target.value}))}
                style={{ ...field, fontFamily: n === "tag_number" ? "JetBrains Mono,monospace" : "inherit" }}/>
            </div>
          ))}
        </FCard>
      </div>
    </FSheet>
  );
}

// ── Bottom sheet détail bobine ────────────────────────────────────────────
function WeightAdjustInline({ spoolId, current, onUpdated, isPrix = false }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("set");
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = parseFloat(val);
    if (isNaN(n) || n < 0) return;
    setSaving(true);
    try {
      if (isPrix) {
        await client.patch(`/filaments/spools/${spoolId}`, { price_override: n });
      } else {
        await client.post(`/filaments/spools/${spoolId}/weight`, { mode, value: n });
      }
      setOpen(false); setVal("");
      onUpdated?.();
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  if (!open) return (
    <div style={{ padding:"6px 0 4px" }}>
      <button onClick={() => setOpen(true)}
        style={{ padding:"5px 12px", borderRadius:8, fontSize:11, fontWeight:600,
          background:"rgba(59,130,246,0.08)", border:"1px solid rgba(59,130,246,0.2)",
          color:"#60a5fa", cursor:"pointer" }}>
        {isPrix ? `💰 Prix achat : ${current != null ? Number(current).toFixed(2)+"€" : "non défini"}` : "⚖ Réajuster la quantité"}
      </button>
    </div>
  );

  return (
    <div style={{ margin:"6px 0", padding:"12px", borderRadius:10,
      background:"var(--surface2)", border:"1px solid var(--border)",
      display:"flex", flexDirection:"column", gap:8 }}>
      {!isPrix && <div style={{ display:"flex", gap:6 }}>
        {[["set","= Définir"],["add","+ Ajouter"],["sub","− Enlever"]].map(([m,l]) => (
          <button key={m} onClick={() => setMode(m)}
            style={{ flex:1, padding:"5px 0", borderRadius:7, fontSize:10, fontWeight:700, cursor:"pointer",
              background: mode===m ? "#3b82f6" : "var(--surface)",
              color: mode===m ? "white" : "var(--muted)",
              border: mode===m ? "none" : "1px solid var(--border)" }}>
            {l}
          </button>
        ))}
      </div>}
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        <input type="number" min="0" value={val} autoFocus
          onChange={e => setVal(e.target.value)}
          placeholder={mode==="set" ? `${Math.round(current)}g actuellement` : "grammes"}
          style={{ flex:1, padding:"8px 10px", borderRadius:8, fontSize:13,
            background:"var(--surface)", border:"1px solid var(--border)",
            color:"var(--text)", outline:"none" }}/>
        <span style={{ fontSize:12, color:"var(--muted)" }}>g</span>
      </div>
      <div style={{ display:"flex", gap:6 }}>
        <button onClick={() => { setOpen(false); setVal(""); }}
          style={{ flex:1, padding:"8px", borderRadius:8, fontSize:12,
            background:"var(--surface)", border:"1px solid var(--border)",
            color:"var(--muted)", cursor:"pointer" }}>Annuler</button>
        <button onClick={save} disabled={saving || !val}
          style={{ flex:2, padding:"8px", borderRadius:8, fontSize:12, fontWeight:700,
            background: saving||!val ? "var(--border)" : "#3b82f6",
            color:"white", border:"none", cursor: saving||!val ? "default" : "pointer" }}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

// Poids restant : plusieurs facons de le corriger. « Restant » le pose tel
// quel ; « Retirer » / « Ajouter » appliquent un ecart (un bout coupe, un
// reste rembobine) ; « Pesee » part du poids lu sur la balance, support compris,
// et en deduit le support vide (poids support du filament, modifiable ici).
const WEIGHT_MODES = [
  ["set",   "Restant", "Poids restant de filament"],
  ["sub",   "Retirer", "Grammes à retirer"],
  ["add",   "Ajouter", "Grammes à ajouter"],
  ["scale", "Pesée",   "Poids sur la balance, support compris"],
];

function WeightEditRow({ spoolId, filamentId, brand, current, total, tare, tareName, onUpdated, openKey = 0 }) {
  const tares = useSpoolTares();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState("set");
  const [val, setVal] = useState("");
  // Support vide connu du filament (mis a jour si on le corrige ici).
  const [savedTare, setSavedTare] = useState(tare);
  const [savedTareName, setSavedTareName] = useState(tareName || null);
  const [tareVal, setTareVal] = useState(tare != null ? String(Math.round(tare)) : "");
  const [tareValName, setTareValName] = useState(tareName || null);
  const [tareEditName, setTareEditName] = useState(null);
  const [saving, setSaving] = useState(false);
  // Fenetre de validation, et correction du support vide depuis celle-ci.
  const [asking, setAsking] = useState(false);
  const [tareEdit, setTareEdit] = useState(null);     // null = ferme, sinon saisie
  const [tareSaving, setTareSaving] = useState(false);

  const cur = current != null ? current : 0;
  const n = parseFloat(val);
  const t = parseFloat(tareVal);
  // Resultat attendu, montre avant d'enregistrer.
  const next = isNaN(n) || n < 0 ? null
    : mode === "set" ? n
    : mode === "add" ? cur + n
    : mode === "sub" ? cur - n
    : isNaN(t) ? null : n - t;
  const valide = next != null;
  const fin = valide ? Math.max(0, next) : 0;
  const g = x => `${Math.round(x)} g`;

  // Support inconnu du filament : on propose le modele qui porte le nom de sa marque.
  const brandTare = savedTare == null ? tareForBrand(tares, brand) : null;
  const open = () => {
    setMode("set"); setVal("");
    setTareVal(savedTare != null ? String(Math.round(savedTare)) : brandTare ? String(brandTare.weight_g) : "");
    setTareValName(savedTare != null ? savedTareName : brandTare ? brandTare.name : null);
    setEditing(true);
  };

  const save = () => { if (valide) { setTareEdit(null); setAsking(true); } };
  // ouvert depuis la barre d'actions ou la tuile du poids de la fiche
  useEffect(() => { if (openKey) open(); }, [openKey]);

  // Nouveau support vide : enregistre sur le FILAMENT (vaut pour ses autres
  // bobines), applique au calcul, et la validation se repropose avec le
  // nouveau poids final.
  const applyTare = async () => {
    const v = parseFloat(tareEdit);
    if (isNaN(v) || v < 0) return;
    setTareSaving(true);
    try {
      if (filamentId) await client.put(`/filaments/filaments/${filamentId}/spool-weight`,
        { spool_weight_g: v, tare_name: tareEditName || "" });
      setSavedTare(v); setSavedTareName(tareEditName || null);
      setTareVal(String(Math.round(v))); setTareValName(tareEditName || null);
      setTareEdit(null);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setTareSaving(false); }
  };

  const doSave = async () => {
    setSaving(true);
    try {
      // La pesee devient une valeur absolue (jamais sous 0 : support mal estime).
      const body = mode === "scale" ? { mode:"set", value: fin } : { mode, value: n };
      await client.post(`/filaments/spools/${spoolId}/weight`, body);
      setAsking(false);
      onUpdated?.();
      setEditing(false);
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  const confirmDlg = asking && valide && createPortal(
    <div onClick={() => setAsking(false)}
      style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.6)",
        display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={e => e.stopPropagation()} className="sheet-panel"
        style={{ width:"100%", maxWidth:380, borderRadius:16, padding:20,
          border:"1px solid var(--border)", boxShadow:"0 12px 48px rgba(0,0,0,0.4)" }}>
        <p style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:"0 0 10px" }}>Valider le nouveau poids ?</p>
        <div style={{ fontSize:13.5, color:"var(--text)", lineHeight:1.6 }}>
          {mode === "set" && <div>Poids restant saisi : {g(n)}</div>}
          {mode === "sub" && <div>{g(cur)} − {g(n)} retirés</div>}
          {mode === "add" && <div>{g(cur)} + {g(n)} ajoutés</div>}
          {mode === "scale" && (<>
            <div>Balance : {g(n)}</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <span>Support vide : − {g(t)}</span>
              {tareEdit == null && (
                <button onClick={() => { setTareEdit(String(Math.round(t))); setTareEditName(tareValName); }}
                  style={{ padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:700, cursor:"pointer",
                    background:"var(--surface2)", border:"1px solid var(--border)", color:"#60a5fa" }}>Changer</button>
              )}
            </div>
            {tareEdit != null && (
              <div style={{ margin:"6px 0 4px", padding:10, borderRadius:10, background:"var(--surface2)",
                border:"1px solid var(--border)" }}>
                <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>
                  Nouveau poids du support vide — enregistré sur le filament, pour toutes ses bobines
                </div>
                <div style={{ display:"flex", marginBottom:8 }}>
                  <TarePicker value={tareEdit} tareName={tareEditName} autoFocus
                    onChange={(v, name) => { setTareEdit(v); setTareEditName(name); }}
                    selectStyle={{ padding:"6px 8px", borderRadius:7, fontSize:13, background:"var(--surface)",
                      border:"1px solid var(--border)", color:"var(--text)" }}
                    inputStyle={{ padding:"6px 8px", borderRadius:7, fontSize:13, textAlign:"right",
                      background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text)", outline:"none",
                      fontFamily:"JetBrains Mono,monospace" }}/>
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center", justifyContent:"flex-end" }}>
                  <button onClick={() => setTareEdit(null)}
                    style={{ padding:"6px 8px", borderRadius:7, fontSize:12, cursor:"pointer",
                      background:"var(--surface)", border:"1px solid var(--border)", color:"var(--muted)" }}>✕</button>
                  <button onClick={applyTare} disabled={tareSaving || isNaN(parseFloat(tareEdit))}
                    style={{ padding:"6px 10px", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer",
                      background:"#3b82f6", border:"none", color:"white" }}>{tareSaving ? "…" : "Appliquer"}</button>
                </div>
              </div>
            )}
          </>)}
          <div style={{ marginTop:10 }}>Avant : {g(cur)}</div>
          <div>Enregistré : <b>{g(fin)}</b></div>
          {next < 0 && <div style={{ color:"#ef4444", marginTop:6 }}>Le calcul passe sous 0 : la bobine sera mise à 0 g.</div>}
          {total > 0 && fin > total && <div style={{ color:"#f59e0b", marginTop:6 }}>Attention : plus qu'une bobine neuve ({g(total)}).</div>}
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:18 }}>
          <button onClick={() => setAsking(false)}
            style={{ padding:"9px 16px", borderRadius:10, border:"1px solid var(--border)",
              background:"var(--surface2)", color:"var(--muted)", fontSize:13, fontWeight:600, cursor:"pointer" }}>Annuler</button>
          <button onClick={doSave} disabled={saving || tareEdit != null}
            title={tareEdit != null ? "Applique d'abord le nouveau support" : undefined}
            style={{ padding:"9px 18px", borderRadius:10, border:"none", color:"white", fontSize:13, fontWeight:700,
              background: tareEdit != null ? "var(--border)" : "#3b82f6",
              cursor: saving || tareEdit != null ? "default" : "pointer" }}>{saving ? "…" : "Valider"}</button>
        </div>
      </div>
    </div>,
    document.body
  );

  const inputStyle = { width:"100%", padding:"8px 10px", borderRadius:8, fontSize:14,
    background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text)",
    outline:"none", textAlign:"right", fontFamily:"JetBrains Mono,monospace", boxSizing:"border-box" };

  return (
    <div style={{ padding:"8px 0", borderTop:"1px dashed var(--border)" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <span style={FLAB}>Poids restant</span>
      {(
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={FVAL}>
            {current != null ? `${Math.round(current)} g` : <span style={{color:"var(--muted)",fontWeight:400}}>—</span>}
          </span>
          <AdminOnly><button onClick={() => editing ? setEditing(false) : open()}
            style={{ background:"none", border:"none", cursor:"pointer", color: editing ? "#3b82f6" : "var(--muted)", padding:2, display:"flex" }}
            onMouseEnter={e=>e.currentTarget.style.color="#3b82f6"}
            onMouseLeave={e=>e.currentTarget.style.color= editing ? "#3b82f6" : "var(--muted)"}><Pencil size={13}/></button></AdminOnly>
        </div>
      )}
    </div>
    {editing && (
      <div style={{ marginTop:8, padding:10, borderRadius:10, background:"var(--surface2)",
        border:"1px solid var(--border)", display:"flex", flexDirection:"column", gap:8 }}>
        <div style={{ display:"flex", gap:4 }}>
          {WEIGHT_MODES.map(([m, l]) => (
            <button key={m} onClick={() => { setMode(m); setVal(""); }}
              style={{ flex:1, padding:"6px 0", borderRadius:7, fontSize:11, fontWeight:700, cursor:"pointer",
                background: mode===m ? "#3b82f6" : "var(--surface)",
                color: mode===m ? "white" : "var(--muted)",
                border: mode===m ? "1px solid #3b82f6" : "1px solid var(--border)" }}>{l}</button>
          ))}
        </div>
        <label style={{ fontSize:11, color:"var(--muted)" }}>
          {WEIGHT_MODES.find(x => x[0] === mode)[2]}
          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
            <input type="number" inputMode="decimal" min="0" value={val} autoFocus key={mode}
              placeholder={mode === "set" ? String(Math.round(cur)) : mode === "scale" ? "ex. 742" : "ex. 50"}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if(e.key==="Enter") save(); if(e.key==="Escape") setEditing(false); }}
              style={inputStyle}/>
            <span style={{ fontSize:12, color:"var(--muted)" }}>g</span>
          </div>
        </label>
        {mode === "set" && total > 0 && (
          <div style={{ display:"flex", gap:4 }}>
            {[[0, "Vide"], [0.25, "¼"], [0.5, "½"], [0.75, "¾"], [1, "Pleine"]].map(([f, l]) => (
              <button key={l} onClick={() => setVal(String(Math.round(total * f)))}
                style={{ flex:1, padding:"4px 0", borderRadius:6, fontSize:10.5, fontWeight:600, cursor:"pointer",
                  background:"var(--surface)", border:"1px solid var(--border)", color:"var(--muted)" }}>{l}</button>
            ))}
          </div>
        )}
        {mode === "scale" && (
          <div style={{ fontSize:11, color:"var(--muted)" }}>
            Support vide {savedTare == null && (
              <span style={{ color:"#f59e0b" }}>
                {brandTare ? `(inconnu du filament : modèle « ${brandTare.name} » proposé)` : "(inconnu du filament : à choisir)"}
              </span>)}
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
              <TarePicker value={tareVal} tareName={tareValName}
                onChange={(v, name) => { setTareVal(v); setTareValName(name); }}
                selectStyle={{ ...inputStyle, textAlign:"left", fontFamily:"inherit" }}
                inputStyle={inputStyle}/>
            </div>
          </div>
        )}
        <div style={{ fontSize:12, color:"var(--muted)", textAlign:"center", minHeight:16 }}>
          {valide && (<>
            {Math.round(cur)} g → <b style={{ color: next < 0 ? "#ef4444" : "var(--text)" }}>{Math.max(0, Math.round(next))} g</b>
            {next < 0 && <span style={{ color:"#ef4444" }}> (plafonné à 0)</span>}
            {total > 0 && next > total && <span style={{ color:"#f59e0b" }}> (plus que la bobine neuve : {Math.round(total)} g)</span>}
          </>)}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={() => setEditing(false)}
            style={{ flex:1, padding:8, borderRadius:8, fontSize:12, background:"var(--surface)",
              border:"1px solid var(--border)", color:"var(--muted)", cursor:"pointer" }}>Annuler</button>
          <button onClick={save} disabled={saving || !valide}
            style={{ flex:2, padding:8, borderRadius:8, fontSize:12, fontWeight:700, border:"none", color:"white",
              background: saving || !valide ? "var(--border)" : "#3b82f6",
              cursor: saving || !valide ? "default" : "pointer" }}>{saving ? "…" : "Enregistrer"}</button>
        </div>
      </div>
    )}
    {confirmDlg}
    </div>
  );
}

// Edition du tag NFC d'une bobine. Utile quand une bobine a ete mappee sur le
// mauvais tag, ou pour saisir/corriger l'UID a la main.
// Date du dernier sechage, modifiable : l'AMS ne la pose que s'il seche la
// bobine lui-meme ; un sechage au four ou sans inserer la bobine se saisit ici.
function DryEditRow({ spoolId, spoolName, current, aSecher, onUpdated }) {
  const [dryOpen, setDryOpen] = useState(false);
  // Date LOCALE du jour (toISOString donnerait celle d'UTC : la veille la nuit).
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current?.slice(0, 10) || today());
  const [saving, setSaving] = useState(false);

  const save = async (day) => {
    setSaving(true);
    try {
      // Aujourd'hui : l'instant present (midi UTC serait « dans le futur » le
      // matin). Un autre jour : midi, une date seule a minuit UTC tomberait la
      // veille selon le fuseau.
      const at = !day ? null : day === today() ? new Date().toISOString() : `${day}T12:00:00`;
      await client.patch(`/filaments/spools/${spoolId}`, { last_dried_at: at });
      onUpdated?.();
      setEditing(false);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  const small = { padding:"4px 10px", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer" };
  return (
    <div style={{ ...FROW, gap:8, flexWrap:"wrap" }}>
      <span style={FLAB}>Dernier séchage</span>
      {editing ? (
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
          <input type="date" value={val} max={today()} autoFocus onChange={e => setVal(e.target.value)}
            style={{ padding:"4px 8px", borderRadius:7, fontSize:12, background:"var(--surface2)",
              border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
          <button onClick={() => save(val)} disabled={saving || !val}
            style={{ ...small, background:"#3b82f6", color:"white", border:"none" }}>{saving ? "…" : "OK"}</button>
          {current && (
            <button onClick={() => save(null)} disabled={saving} title="Remettre à « jamais séchée »"
              style={{ ...small, background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--muted)" }}>
              Effacer</button>
          )}
          <button onClick={() => setEditing(false)}
            style={{ ...small, fontWeight:400, background:"var(--surface2)", border:"1px solid var(--border)",
              color:"var(--muted)" }}>✕</button>
        </div>
      ) : (
        <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
          <span style={{ ...FVAL, color: aSecher ? "#0EA5E9" : "var(--text)" }}>
            {current ? dayFr(current) : "jamais"}{aSecher ? " · à sécher" : ""}
          </span>
          <AdminOnly>
            {/* Le cas courant : « je viens de la secher ». Icone de sechage (la
                meme que le bandeau de l'AMS) et confirmation : un libelle
                « Aujourd'hui » se lisait comme une date, pas comme une action. */}
            <button disabled={saving} data-tip="Je viens de la sécher"
              onClick={() => setDryOpen(true)}
              style={{ background:"none", border:"none", cursor:"pointer", color:"#f59e0b", padding:2, display:"flex" }}>
              <Sun size={14}/>
            </button>
            <button onClick={() => { setVal(current?.slice(0, 10) || today()); setEditing(true); }}
              data-tip="Modifier la date de séchage"
              style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)", padding:2, display:"flex" }}
              onMouseEnter={e=>e.currentTarget.style.color="#3b82f6"}
              onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
              <Pencil size={13}/>
            </button>
          </AdminOnly>
        </div>
      )}
      {dryOpen && <DryNowDialog spoolId={spoolId} spoolName={spoolName} onClose={() => setDryOpen(false)}
        onDone={() => { setDryOpen(false); onUpdated?.(); }}/>}
    </div>
  );
}

function TagEditRow({ spoolId, current, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      // Champ vide -> on detache le tag (null cote API).
      await client.patch(`/filaments/spools/${spoolId}`, { tag_number: val.trim() || null });
      onUpdated?.();
      setEditing(false);
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ ...FROW, gap:8 }}>
      <span style={FLAB}>Tag NFC</span>
      {editing ? (
        <div style={{ display:"flex", gap:6, alignItems:"center", flex:1, justifyContent:"flex-end" }}>
          {/* Le placeholder dit ce que le champ vide provoque : sans lui, rien
              n'indique qu'effacer detache le tag. */}
          <input value={val} autoFocus placeholder="UID — vide = détacher"
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter") save(); if(e.key==="Escape") setEditing(false); }}
            style={{ flex:1, maxWidth:190, padding:"4px 8px", borderRadius:7, fontSize:12,
              background:"var(--surface2)", border:"1px solid var(--border)",
              color:"var(--text)", outline:"none", textAlign:"right",
              fontFamily:"JetBrains Mono,monospace" }}/>
          <button onClick={save} disabled={saving}
            style={{ padding:"4px 10px", borderRadius:7, fontSize:12, fontWeight:700,
              background:"#3b82f6", color:"white", border:"none", cursor:"pointer" }}>
            {saving ? "…" : "OK"}
          </button>
          <button onClick={() => { setVal(current || ""); setEditing(false); }}
            style={{ padding:"4px 8px", borderRadius:7, fontSize:12,
              background:"var(--surface2)", border:"1px solid var(--border)",
              color:"var(--muted)", cursor:"pointer" }}>✕</button>
        </div>
      ) : (
        <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
          {current ? (
            <span style={{ ...FVAL, fontSize:13, fontFamily:"JetBrains Mono,monospace",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {current}
            </span>
          ) : (
            <span style={{ fontSize:12, color:"var(--muted)", fontStyle:"italic" }}>aucun</span>
          )}
          <AdminOnly>
            <button onClick={() => { setVal(current || ""); setEditing(true); }}
              data-tip="Modifier le tag NFC"
              style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)",
                padding:2, display:"flex" }}
              onMouseEnter={e=>e.currentTarget.style.color="#3b82f6"}
              onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
              <Pencil size={13}/>
            </button>
          </AdminOnly>
        </div>
      )}
    </div>
  );
}

function PriceEditRow({ spoolId, current, filamentPrice, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current != null ? String(Number(current).toFixed(2)) : "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = parseFloat(val);
    if (isNaN(n) || n < 0) return;
    setSaving(true);
    try {
      await client.patch(`/filaments/spools/${spoolId}`, { price_override: n });
      onUpdated?.();
      setEditing(false);
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={FROW}>
      <span style={FLAB}>Prix d'achat</span>
      {editing ? (
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <input type="number" min="0" step="0.01" value={val} autoFocus
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter") save(); if(e.key==="Escape") setEditing(false); }}
            style={{ width:90, padding:"4px 8px", borderRadius:7, fontSize:13,
              background:"var(--surface2)", border:"1px solid var(--border)",
              color:"var(--text)", outline:"none", textAlign:"right" }}/>
          <span style={{ fontSize:12, color:"var(--muted)" }}>€</span>
          <button onClick={save} disabled={saving}
            style={{ padding:"4px 10px", borderRadius:7, fontSize:12, fontWeight:700,
              background:"#3b82f6", color:"white", border:"none", cursor:"pointer" }}>
            {saving ? "…" : "OK"}
          </button>
          <button onClick={() => setEditing(false)}
            style={{ padding:"4px 8px", borderRadius:7, fontSize:12,
              background:"var(--surface2)", border:"1px solid var(--border)",
              color:"var(--muted)", cursor:"pointer" }}>✕</button>
        </div>
      ) : (
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {current != null ? (
            <span style={{ ...FVAL, color:"#16a34a" }}>
              {moneyVal(Number(current), 2)} €
            </span>
          ) : filamentPrice != null ? (
            <span style={{ ...FVAL, color:"#d97706" }}
              data-tip="Prix du filament (non personnalisé)">
              {moneyVal(Number(filamentPrice), 2)} €
            </span>
          ) : (
            <span style={{ fontSize:12, color:"var(--muted)", fontStyle:"italic" }}>non défini</span>
          )}
          <AdminOnly><button onClick={() => { setVal(current != null ? String(Number(current).toFixed(2)) : filamentPrice != null ? String(Number(filamentPrice).toFixed(2)) : ""); setEditing(true); }}
            style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)", padding:2, display:"flex" }}
            onMouseEnter={e=>e.currentTarget.style.color="#3b82f6"}
            onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
            <Pencil size={13}/>
          </button></AdminOnly>
        </div>
      )}
    </div>
  );
}

// ── Fiches bobine et filament (25/10/2026) : le langage du popup de la tuile « Filament en cours »
// (la bobine en vedette sur un fond de sa couleur, des cartes de faits), les actions en bas a portee du pouce.
// la bobine en vedette : son dessin sur un fond de sa couleur, les pastilles, le nom, puis ce qu'on veut mettre dessous
function FHero({ colors, type, finish = null, color, chips, name, sub, children, stack = 0 }) {
  return (
    <div style={{ position:"relative", overflow:"hidden", padding:"52px 18px 18px", display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
      background:`radial-gradient(circle at 18% 45%, ${color}55, transparent 60%), linear-gradient(135deg, ${color}26, transparent 70%), var(--surface2)` }}>
      <span style={{ position:"relative", display:"inline-flex", flexShrink:0, filter:`drop-shadow(0 8px 18px ${color}66)`,
        marginRight: stack > 0 ? (stack > 1 ? 30 : 18) : 0 }}>
        {/* d'autres bobines du meme filament en stock : leurs ombres, decalees derriere (deux au plus) */}
        {stack > 1 && <span aria-hidden="true" style={{ position:"absolute", top:10, left:34, opacity:0.35 }}>
          <SpoolSVG colors={colors} finish={finish} size={100} type={type}/></span>}
        {stack > 0 && <span aria-hidden="true" style={{ position:"absolute", top:5, left:18, opacity:0.6 }}>
          <SpoolSVG colors={colors} finish={finish} size={108} type={type}/></span>}
        <span style={{ position:"relative", display:"inline-flex" }}><SpoolSVG colors={colors} finish={finish} size={118} type={type}/></span></span>
      <div style={{ flex:"1 1 190px", minWidth:0, display:"flex", flexDirection:"column", gap:6 }}>
        {chips.filter(Boolean).length > 0 && <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
          {chips.filter(Boolean).map((c, k) => <React.Fragment key={k}>{c}</React.Fragment>)}</div>}
        <div style={{ fontSize:24, fontWeight:900, color:"var(--text)", lineHeight:1.12, overflowWrap:"anywhere" }}>{name}</div>
        {sub}
        {children}
      </div>
    </div>);
}

export function SpoolBottomSheet({ spool, onClose, onArchive, onDelete }) {
  useTrackDetail(spool ? `Fiche bobine · ${spool.filament_translated_name || spool.filament_name || "#" + spool.id}` : null);
  const [filSheet, setFilSheet] = React.useState(null);   // fiche filament ouverte par-dessus
  const isAdmin = useIsAdmin();
  const [dryOpen, setDryOpen] = useState(false);   // fenetre « sechee aujourd'hui »
  const [filOpen, setFilOpen] = useState(false);   // la carte du filament, repliee a chaque ouverture
  const [weighKey, setWeighKey] = useState(0);     // ouvre l'ajustement du poids depuis la barre ou la tuile
  const [addOpen, setAddOpen] = useState(false);   // une autre bobine de ce filament
  const [detail, setDetail] = useState(null);      // une impression de l'historique, ouverte en fiche
  const openFilament = async () => {
    try {
      const r = await client.get(`/filaments/filaments/${spool.filament_id}`);
      setFilSheet(r.data);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const [deleting, setDeleting] = React.useState(false);
  const [showUsage, setShowUsage] = React.useState(false);
  // l'historique, et la fiche d'impression qu'il ouvre, juste au-dessus des fiches deja ouvertes (la bobine peut
  // venir d'une fiche AMS...), mais sous la vue 3D, la fiche MakerWorld et les dialogues : a 9999 / 10000, la vue 3D
  // ouverte depuis la fiche d'impression s'affichait derriere
  const [usageZ, setUsageZ] = React.useState(1300);
  const [usageHistory, setUsageHistory] = React.useState([]);
  const [loadingUsage, setLoadingUsage] = React.useState(false);

  const loadUsage = async () => {
    setLoadingUsage(true);
    try {
      const r = await client.get(`/filaments/spools/${spool.id}/usage`);
      setUsageHistory(r.data || []);
      setUsageZ(Math.max(1300, ...[...document.body.children].map(e => parseInt(getComputedStyle(e).zIndex, 10) || 0)
        .filter(z => z < 4000).map(z => z + 1)));
      setShowUsage(true);
    } catch(e) { showAlert('Erreur: ' + e.message); }
    setLoadingUsage(false);
  };

  // Suppression definitive : le serveur demande une seconde confirmation si la bobine a servi.
  const handleDelete = async () => {
    if (!(await showConfirm(`Supprimer définitivement la bobine #${spool.id} ?`, { danger: true, confirmLabel: "Supprimer" }))) return;
    setDeleting(true);
    try {
      const r = await client.delete(`/filaments/spools/${spool.id}/permanent`, { params: { force: false } });
      if (r.data.confirm_required) {
        if (!(await showConfirm(r.data.message || `Bobine utilisée par ${r.data.usage_count} impression(s). Supprimer quand même ?`,
          { danger: true, confirmLabel: "Supprimer" }))) return;
        await client.delete(`/filaments/spools/${spool.id}/permanent`, { params: { force: true } });
      }
      onDelete?.();
      onClose();
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setDeleting(false); }
  };
  const archive = async () => {
    if (!(await showConfirm(
      `Archiver la bobine #${spool.id} ? Elle passera en Archives avec une quantité remise à 0 et sortira du stock.`,
      { confirmLabel: "Archiver" }
    ))) return;
    await onArchive(spool.id); onClose();
  };
  const openDetail = id => client.get(`/prints/${id}`).then(r => setDetail(r.data))
    .catch(e => showAlert(e.response?.data?.detail || "Impression introuvable"));
  if (!spool) return null;
  const name = spool.filament_translated_name || spool.filament_name || `Bobine #${spool.id}`;
  const color = hexDisplay(spool.filament_color);
  const colorsList = parseColorsList(spool.filament_color, spool.filament_colors_array);
  const main = hexToCss(spool.filament_color) || "#8B5CF6";
  const total = spool.filament_weight_g || 1000;
  const remaining = spool.remaining_weight_g ?? total;
  const pct = Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
  const barColor = pct < 15 ? "#ef4444" : pct < 35 ? "#f59e0b" : main;
  const light = isLight(barColor);

  // Stock du filament : cette bobine (si active) + les autres actives.
  const stockFil = spool.sibling_weight_g != null
    ? (spool.archived ? 0 : (spool.remaining_weight_g || 0)) + spool.sibling_weight_g : null;
  // Calcule par le serveur (delai par defaut, ou celui de la famille / sous-
  // famille du filament, Parametres) : meme regle que l'alerte et l'AMS.
  const aSecher = !!spool.needs_drying;
  // Bientot : moins de 30 jours avant d'atteindre le delai de ce filament.
  const ageSechage = spool.last_dried_at
    ? Math.floor((Date.now() - new Date(spool.last_dried_at).getTime()) / 86400000) : null;
  const resteSechage = ageSechage == null ? null : (spool.dry_days || 180) - ageSechage;
  const secherBientot = !aSecher && resteSechage != null && resteSechage <= 30;
  // Le prix reel de la bobine (le sien, sinon celui du filament) et ce qu'il en reste.
  const price = spool.price_override ?? spool.filament_price;
  const worth = price != null && total ? price * remaining / total : null;
  const eur = v => `${moneyVal(Number(v), 2)} €`;
  const weigh = () => { setWeighKey(k => k + 1); setTimeout(() => document.getElementById(`weigh-${spool.id}`)?.scrollIntoView({ behavior:"smooth", block:"center" }), 60); };

  const dryChip = (aSecher || secherBientot) && (
    <span key="dry" role={isAdmin ? "button" : undefined} onClick={isAdmin ? () => setDryOpen(true) : undefined}
      data-tip={(aSecher
        ? `Jamais séchée, ou pas depuis plus de ${Math.round((spool.dry_days || 180) / 30 * 10) / 10} mois`
        : `Délai de séchage atteint dans ${resteSechage} j`) + (isAdmin ? " — toucher pour la marquer séchée" : "")}
      style={{ cursor: isAdmin ? "pointer" : "default" }}>
      {fChip(<><Droplets size={11}/>{aSecher ? "Séchage nécessaire" : resteSechage <= 0 ? "Séchage aujourd'hui" : `Séchage dans ${resteSechage} j`}
        {isAdmin && <Sun size={11} style={{ marginLeft:2 }}/>}</>, aSecher ? "#0EA5E9" : "#f59e0b")}</span>);

  const menu = e => openMenu(e, {
    title: name, subtitle: `Bobine #${spool.id} · ${Math.round(remaining)} g`, color: main,
    items: [
      isAdmin && { icon: "⚖", label: "Ajuster le poids", hint: "Restant, retirer, ajouter, pesée", tone: "#F59E0B", onClick: weigh },
      isAdmin && { icon: "☀", label: "Je viens de la sécher", hint: spool.last_dried_at ? `Dernier séchage ${agoFr(spool.last_dried_at)}` : "Jamais séchée", tone: "#0EA5E9",
        onClick: () => setDryOpen(true) },
      { icon: "📋", label: "Historique d'utilisation", hint: "Les impressions qui l'ont consommée", tone: "#8B5CF6", onClick: loadUsage },
      spool.filament_id && { icon: "🧵", label: "Voir le filament", hint: `Filament #${spool.filament_id}`, tone: "#EC4899", onClick: openFilament },
      isAdmin && spool.filament_id && { icon: "＋", label: "Ajouter une bobine de ce filament", tone: "#22C55E", onClick: () => setAddOpen(true) },
      isAdmin && "-",
      isAdmin && !spool.archived && { icon: "📦", label: "Archiver…", hint: "Quantité remise à 0, sort du stock", tone: "#64748B", onClick: archive },
      isAdmin && { icon: "🗑", label: "Supprimer définitivement…", danger: true, disabled: deleting, onClick: handleDelete },
    ],
  });

  return (
    <FSheet onClose={onClose} top={<button onClick={menu} aria-label="Plus d'actions" style={fRound}>⋯</button>}
      bottom={<>
        {isAdmin && <button onClick={weigh} style={{ ...fBtn, flex:1, color:"#d97706", borderColor:"rgba(245,158,11,0.4)", background:"rgba(245,158,11,0.1)" }}>⚖ Ajuster le poids</button>}
        <button onClick={loadUsage} disabled={loadingUsage} style={{ ...fBtn, flex:1 }}>📋 {loadingUsage ? "…" : "Historique"}</button>
        {!isAdmin && spool.filament_id && <button onClick={openFilament} style={{ ...fBtn, flex:1 }}>🧵 Filament</button>}
        <button onClick={menu} aria-label="Plus d'actions" style={{ ...fBtn, width:48, flex:"0 0 auto" }}>⋯</button>
      </>}>
      <FHero colors={colorsList} type={spool.filament_multicolor_type} finish={finishOf(spool)} color={main} name={name}
        stack={spool.archived ? 0 : (spool.sibling_count || 0)}
        chips={[fChip(`#${spool.id}`, "#64748B"), spool.archived && fChip("Archivée", "#94a3b8"),
          // commandee, pas encore recue : son statut, et ce qu'il faut faire a l'arrivee (28/10/2026)
          spool.ordered && <span key="ord" data-tip="Créée depuis une commande lue dans les mails : hors du stock jusqu'à l'arrivée. Le scan RFID, ou l'ajout d'une bobine de ce filament, l'adoptera.">{fChip("📬 Commandée, pas encore reçue", "#0EA5E9")}</span>,
          !spool.ordered && spool.location && fChip(`📍 ${spool.location}`, "#8B5CF6"),
          !spool.archived && spool.sibling_count > 0 && fChip(`🧵 +${spool.sibling_count} en stock${spool.sibling_weight_g ? ` · ${fmtStock(spool.sibling_weight_g)}` : ""}`, "#22C55E"),
          !spool.archived && spool.ordered_siblings > 0 && <span key="osib" data-tip="D'autres bobines de ce filament sont commandées, pas encore reçues">{fChip(`📬 +${spool.ordered_siblings} en commande`, "#0EA5E9")}</span>,
          dryChip, fChip(<><Palette size={11}/>{spool.filament_swatch ? "Échantillon" : "Sans échantillon"}</>, spool.filament_swatch ? "#22c55e" : "#94a3b8")]}
        sub={<>
          {spool.filament_translated_name && spool.filament_name && spool.filament_name !== spool.filament_translated_name &&
            <div style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)", marginTop:-3 }}>{spool.filament_name}</div>}
          {/* Marque en tete puis sous-type : meme ordre que la fiche filament. */}
          <div style={{ fontSize:14, fontWeight:700, color:"var(--text2)" }}>
            {[spool.filament_manufacturer, spool.filament_fila_type || spool.filament_material].filter(Boolean).join(" · ")}</div></>}>
        <div style={{ display:"flex", alignItems:"baseline", gap:8, flexWrap:"wrap", marginTop:2 }}>
          <span style={{ fontSize:30, fontWeight:900, lineHeight:1.2, paddingBottom:2, ...(light ? { color:"var(--text)" } : fGrad(barColor, `${barColor}bb`)) }}>{Math.round(remaining)} g</span>
          <span style={{ padding:"1px 8px", borderRadius:20, fontSize:14, fontWeight:900, color: light ? "#0f172a" : "#fff",
            background: light ? `linear-gradient(135deg, ${barColor}, #e2e8f0)` : `linear-gradient(135deg, ${barColor}, ${barColor}cc)`,
            border: light ? "1px solid rgba(0,0,0,0.18)" : "none", boxShadow:`0 3px 10px ${light ? "rgba(0,0,0,0.12)" : `${barColor}55`}` }}>{pct} %</span>
          <span style={{ fontSize:12.5, fontWeight:700, color:"var(--muted)" }}>sur {Math.round(total)} g</span>
        </div>
        <div style={{ height:10, borderRadius:10, background:"var(--surface)", overflow:"hidden", boxShadow:"inset 0 0 0 1px var(--border)" }}>
          <div style={{ height:"100%", width:`${pct}%`, borderRadius:10, background:barColor, transition:"width .5s",
            boxShadow: light ? "inset 0 0 0 1px rgba(0,0,0,0.28)" : `0 0 8px ${barColor}66` }}/></div>
      </FHero>

      <div style={{ padding:"12px 14px 18px", display:"flex", flexDirection:"column", gap:12 }}>
        {/* les chiffres qu'on cherche d'un coup d'oeil ; chacun mene a son action */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0, 1fr))", gap:6 }}>
          <FTile label="⚖ Restant" value={`${Math.round(remaining)} g`} sub={`${pct} %`} c1="#F59E0B" c2="#FBBF24"
            onClick={isAdmin ? weigh : undefined} tip={isAdmin ? "Ajuster le poids" : undefined}/>
          <FTile label="💶 Valeur" value={worth != null ? eur(worth) : "—"} sub={price != null ? `sur ${eur(price)}` : "prix non défini"} c1="#16A34A" c2="#4ADE80"
            tip="Ce qu'il reste de la bobine, à son prix"/>
          <FTile label="💧 Séchage" value={ageSechage == null ? "jamais" : ageSechage <= 0 ? "auj." : `${ageSechage} j`}
            sub={aSecher ? "à sécher" : secherBientot ? `dans ${Math.max(0, resteSechage)} j` : "à jour"}
            c1={aSecher ? "#0EA5E9" : "#06B6D4"} c2={aSecher ? "#38BDF8" : "#67E8F9"}
            onClick={isAdmin ? () => setDryOpen(true) : undefined} tip={isAdmin ? "Je viens de la sécher" : undefined}/>
          <FTile label="🧵 Stock" value={stockFil != null ? fmtStock(stockFil) : "—"}
            sub={spool.sibling_count == null ? "du filament" : spool.sibling_count > 0 ? `+${spool.sibling_count} bobine${spool.sibling_count > 1 ? "s" : ""}` : "seule bobine"}
            c1="#EC4899" c2="#F472B6" onClick={spool.filament_id ? openFilament : undefined} tip={spool.filament_id ? "Ouvrir la fiche du filament" : undefined}/>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(250px, 1fr))", gap:12 }}>
          <FCard t="La bobine" i="🧵" c="#8B5CF6">
            <div id={`weigh-${spool.id}`}>
              <WeightEditRow spoolId={spool.id} filamentId={spool.filament_id} brand={spool.filament_manufacturer}
                current={remaining} total={total} openKey={weighKey}
                tare={spool.filament_spool_weight_g} tareName={spool.filament_spool_tare_name} onUpdated={onClose}/></div>
            <PriceEditRow spoolId={spool.id} current={spool.price_override} filamentPrice={spool.filament_price} onUpdated={onClose}/>
            <FRow l="Ce qu'il en reste" v={worth != null ? eur(worth) : null} vc="#16a34a"/>
            <TagEditRow spoolId={spool.id} current={spool.tag_number} onUpdated={onClose}/>
            <FRow l="Emplacement" v={spool.location}/>
          </FCard>
          <FCard t="Son histoire" i="🗓️" c="#3B82F6">
            <FRow l="Première utilisation" v={dayFr(spool.first_used_at) || "jamais"} d={agoFr(spool.first_used_at)}/>
            <FRow l="Dernière utilisation" v={dayFr(spool.last_used_at) || "jamais"} d={agoFr(spool.last_used_at)}/>
            <DryEditRow spoolId={spool.id} spoolName={name} current={spool.last_dried_at} aSecher={aSecher} onUpdated={onClose}/>
            <div style={FROW}>
              <span style={FLAB}>Utilisation</span>
              <button onClick={loadUsage} disabled={loadingUsage} style={{ padding:"4px 11px", borderRadius:9, fontSize:12, fontWeight:800, cursor:"pointer",
                border:"1px solid rgba(139,92,246,0.35)", background:"rgba(139,92,246,0.1)", color:"#8B5CF6" }}>
                📋 {loadingUsage ? "Chargement…" : "Voir l'historique"}</button>
            </div>
          </FCard>
        </div>

        {/* Le filament : replie, son resume suffit ; deplie, toute sa fiche */}
        <FCard t={`Le filament${spool.filament_id ? ` #${spool.filament_id}` : ""}`} i="🎨" c={main} fold open={filOpen} onToggle={() => setFilOpen(o => !o)}
          aside={<>
            {/* Autres bobines du meme filament : savoir qu'il en reste evite d'en racheter. */}
            {spool.sibling_count != null && fChip(spool.sibling_count > 0
              ? `+${spool.sibling_count} en stock${spool.sibling_weight_g ? ` · ${Math.round(spool.sibling_weight_g)} g` : ""}` : "seule bobine",
              spool.sibling_count > 0 ? "#22c55e" : "#94a3b8")}
            {spool.filament_id && <button onClick={e => { e.stopPropagation(); openFilament(); }} aria-label="Ouvrir la fiche du filament" data-tip="Ouvrir la fiche du filament"
              style={{ width:30, height:30, borderRadius:10, border:"1px solid var(--border)", background:"var(--surface)", color:"#EC4899", cursor:"pointer",
                fontSize:14, fontWeight:900, flexShrink:0 }}>↗</button>}</>}
          summary={<div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, fontSize:12.5, fontWeight:700, color:"var(--muted)", minWidth:0 }}>
            <ColorSwatch color={spool.filament_color} colorsArray={spool.filament_colors_array} multicolorType={spool.filament_multicolor_type} finish={finishOf(spool)} size={18} radius={5}/>
            <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {[spool.filament_material, color, spool.filament_price != null ? `${moneyVal(Number(spool.filament_price), 2)} € au catalogue` : null].filter(Boolean).join(" · ")}</span></div>}>
          <FRow l="Nom" v={name}/>
          {spool.filament_translated_name && spool.filament_name !== spool.filament_translated_name && <FRow l="Nom EN" v={spool.filament_name}/>}
          <FRow l="Marque" v={spool.filament_manufacturer}/>
          <FRow l="Matière" v={spool.filament_material}/>
          <FRow l="Sous-type" v={spool.filament_fila_type}/>
          <FRow l="Échantillon" v={spool.filament_swatch ? "fait" : "à faire"} vc={spool.filament_swatch ? "#16a34a" : "#d97706"}/>
          <FRow l="Couleur" v={color} mono pre={<ColorSwatch color={spool.filament_color} colorsArray={spool.filament_colors_array}
            multicolorType={spool.filament_multicolor_type} finish={finishOf(spool)} size={16} radius={4}/>}/>
          <FRow l="Code Bambu" v={spool.filament_profile_id} mono/>
          <FRow l="Code couleur Bambu" v={spool.filament_fila_color_code} mono/>
          <FRow l="Stock du filament" v={stockFil != null ? fmtStock(stockFil) : null} d="toutes bobines"/>
          <FRow l="Poids total" v={spool.filament_weight_g ? `${spool.filament_weight_g} g` : null}/>
          <FRow l="Prix catalogue" v={spool.filament_price ? `${moneyVal(Number(spool.filament_price), 2)} €` : null}/>
        </FCard>

        {spool.comment && <div style={{ position:"relative", padding:"12px 14px 12px 18px", borderRadius:16, overflow:"hidden",
          background:"linear-gradient(135deg, color-mix(in srgb, #A855F7 12%, transparent), transparent 70%), var(--surface2)", border:"1px solid var(--border)" }}>
          <span aria-hidden="true" style={{ position:"absolute", left:0, top:10, bottom:10, width:4, borderRadius:4, background:"linear-gradient(#A855F7, #EC4899)" }}/>
          <div style={{ fontSize:10.5, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#A855F7", marginBottom:4 }}>💬 Commentaire</div>
          <p style={{ fontSize:13.5, color:"var(--text)", margin:0, lineHeight:1.5, fontStyle:"italic" }}>« {spool.comment} »</p></div>}
      </div>

      {dryOpen && <DryNowDialog spoolId={spool.id} spoolName={name}
        onClose={() => setDryOpen(false)} onDone={() => { setDryOpen(false); onClose?.(); }}/>}
      {addOpen && <AddSpoolModal preselect={spool.filament_id} onClose={() => setAddOpen(false)}
        onSave={() => { setAddOpen(false); onDelete?.(); }}/>}
      {showUsage && createPortal(
        <FSheet onClose={() => setShowUsage(false)} z={usageZ}>
          <div style={{ padding:"40px 16px 14px", display:"flex", alignItems:"center", gap:12,
            background:`radial-gradient(circle at 12% 50%, ${main}40, transparent 60%), var(--surface2)` }}>
            <SpoolSVG colors={colorsList} finish={finishOf(spool)} size={52} type={spool.filament_multicolor_type}/>
            <div style={{ minWidth:0, flex:1 }}>
              <div style={{ fontSize:10.5, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#8B5CF6" }}>📋 Historique · bobine #{spool.id}</div>
              <div style={{ fontSize:17, fontWeight:900, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{name}</div>
              <div style={{ fontSize:12, fontWeight:700, color:"var(--muted)" }}>
                {usageHistory.length} impression{usageHistory.length !== 1 ? "s" : ""}
                {usageHistory.length > 0 && ` · ${Math.round(usageHistory.reduce((t, u) => t + (u.grams_used || 0), 0))} g consommés`}</div>
            </div>
          </div>
          <div style={{ padding:"12px 14px 18px", display:"flex", flexDirection:"column", gap:6 }}>
            {usageHistory.length === 0 && <p style={{ color:"var(--muted)", fontSize:13, textAlign:"center", padding:"24px 0" }}>Aucune utilisation enregistrée</p>}
            {usageHistory.map((u, i) => {
              const st = u.status === "SUCCESS" ? ["Réussie", "#22c55e"] : u.status === "FAILED" ? ["Échouée", "#ef4444"] : null;
              return <button key={i} onClick={() => openDetail(u.print_id)} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:14,
                border:"1px solid var(--border)", cursor:"pointer", textAlign:"left", font:"inherit", color:"inherit",
                background:`linear-gradient(135deg, ${main}14, transparent 55%), var(--surface2)` }}>
                <img src={apiThumb(apiUrl(`/prints/${u.print_id}/image`), 128)} alt="" loading="lazy" decoding="async" style={{ width:46, height:46, objectFit:"cover", borderRadius:10, flexShrink:0, background:"var(--surface)" }}
                  onError={e => e.currentTarget.style.visibility = "hidden"}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{u.file_name || "Print #" + u.print_id}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11.5, fontWeight:700, color:"var(--muted)", marginTop:2 }}>
                    {u.print_date && <span>{new Date(u.print_date).toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric" })}</span>}
                    {st && <span style={{ color:st[1] }}>● {st[0]}</span>}</div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div style={{ fontSize:14, fontWeight:900, ...fGrad("#ef4444", "#f97316") }}>−{u.grams_used?.toFixed(1)} g</div>
                  {u.cost > 0 && <div style={{ fontSize:11, fontWeight:700, color:"#16a34a" }}>{moneyVal(u.cost, 2)} €</div>}
                </div>
              </button>; })}
          </div>
        </FSheet>, document.body)}
      {detail && createPortal(<div onClick={e => e.stopPropagation()} style={{ position:"relative", zIndex:usageZ + 1 }}>
        <PrintDetail p={detail} onClose={() => setDetail(null)} onDelete={() => { setDetail(null); loadUsage(); }}/></div>, document.body)}
      {filSheet && createPortal(
        <FilamentSheet f={filSheet} onClose={() => setFilSheet(null)}/>,
        document.body
      )}
    </FSheet>
  );
}

// ── Vue Bobines ────────────────────────────────────────────────────────────
// Les chiffres d'une liste, en tuiles (meme dessin que la page Impressions).
const KPI_ICON = { bobines:"🧵", marques:"🏷️", "en stock":"⚖", valeur:"💶", archivées:"🗄", références:"🎨", types:"🧪", "à commander":"🛒" };
// Les filtres actifs : une etiquette chacun, ✕ pour l'enlever (comme la page Impressions).
const STOCK_L = { instock:"En stock", unavailable:"Non disponible" };
function FilterChips({ filters, setFilters, sort, setSort, defSort }) {
  const label = Object.fromEntries(SPOOL_SORTS);
  const drop = (k, v) => setFilters(f => ({ ...f, [k]: (f[k] || []).filter(x => x !== v) }));
  const chips = [
    ...(filters.mat || []).map(v => ["🧪", v, () => drop("mat", v)]),
    ...(filters.sub || []).map(v => ["🏷️", v, () => drop("sub", v)]),
    ...(filters.brand || []).map(v => ["🏭", v, () => drop("brand", v)]),
    filters.stock && filters.stock !== "all" && ["📦", STOCK_L[filters.stock] || filters.stock, () => setFilters(f => ({ ...f, stock:"all" }))],
    sort && sort !== defSort && ["↕", label[sort] || sort, () => setSort(defSort)],
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
      {chips.map(([ic, l, off], i) => (
        <button key={i} onClick={off} data-tip="Retirer ce filtre" style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 6px 4px 10px",
          borderRadius:20, fontSize:12, fontWeight:800, cursor:"pointer", color:"#3b82f6", background:"rgba(59,130,246,0.12)",
          border:"1px solid rgba(59,130,246,0.3)" }}>
          {ic} {l}<span style={{ width:18, height:18, borderRadius:"50%", background:"rgba(59,130,246,0.2)", display:"inline-flex", alignItems:"center",
            justifyContent:"center", fontSize:10 }}>✕</span></button>))}
      {chips.length > 1 && <button onClick={() => { setFilters({ brand:[], mat:[], sub:[], stock:"all" }); setSort(defSort); }}
        style={{ padding:"4px 10px", borderRadius:20, fontSize:12, fontWeight:800, cursor:"pointer", border:"none", background:"none", color:"var(--muted)",
          textDecoration:"underline" }}>Tout effacer</button>}
    </div>
  );
}

function SpoolCard({ s, colorsList, onClick, menu }) {
  const total = s.filament_weight_g || 1000;
  const rem   = s.remaining_weight_g;
  const pct   = rem != null ? Math.max(0, Math.min(100, Math.round(rem / total * 100))) : 0;
  // Vert -> rouge selon ce qu'il reste : la couleur previent avant qu'on lise
  // le chiffre, ce qui est tout l'interet d'une grille qu'on parcourt vite.
  const barColor = pct > 60 ? "#22c55e" : pct > 35 ? "#f59e0b"
                 : pct > 15 ? "#f97316" : "#ef4444";
  const sub = s.filament_fila_type || s.filament_material;
  // une bobine blanche (ou tres claire) prend un liseré gris : sinon elle disparait sur le fond clair
  const main = paleHex(s.filament_color) ? "#94a3b8" : (hexToCss(s.filament_color) || "#94a3b8");
  const more = s.archived ? 0 : (s.sibling_count || 0);

  return (
    <Pressable onClick={onClick} menu={menu} className="card-sm"
      style={{ overflow:"hidden", cursor:"pointer", padding:0, position:"relative", borderRadius:18, opacity: s.ordered ? 0.72 : 1,
        display:"flex", flexDirection:"column", border:`1px ${s.ordered ? "dashed" : "solid"} color-mix(in srgb, ${main} 30%, var(--border))`,
        background:`radial-gradient(120% 60% at 50% 0%, ${main}2e, transparent 70%), var(--surface)`,
        boxShadow:`0 10px 22px -16px ${main}` }}>

      {/* Sous-type, comme sur l'accueil ; « a secher » en coin (l'emplacement est en bas, en pastille 📍) */}
      <p style={{ fontSize:9, fontWeight:800, color:"var(--muted)", textAlign:"center",
        letterSpacing:"0.05em", textTransform:"uppercase", margin:"8px 24px 0",
        height:12, lineHeight:"12px", overflow:"hidden", whiteSpace:"nowrap",
        textOverflow:"ellipsis" }}>
        {sub || " "}
      </p>
      {s.needs_drying && !s.ordered && <span data-tip="À sécher" style={{ position:"absolute", top:5, right:6, fontSize:10 }}>💧</span>}
      {/* commandee, pas encore recue (28/10/2026) : hors du stock jusqu'a l'arrivee, ou le scan ou l'ajout l'adopte */}


      {/* La bobine, meme dessin qu'au slot AMS de l'accueil */}
      <div style={{ position:"relative", display:"flex", justifyContent:"center", margin:"3px 0 0", filter:`drop-shadow(0 6px 10px ${main}55)` }}>
        {/* d'autres bobines du meme filament en stock : une bobine estompee derriere, et leur nombre en discret
            (pas dans les archives : elles ne sont plus en stock) */}
        {more > 1 && <span aria-hidden="true" style={{ position:"absolute", top:7, left:"calc(50% - 12px)", opacity:0.3 }}>
          <SpoolSVG colors={colorsList} finish={finishOf(s)} empty={false} size={56} type={s.filament_multicolor_type}/></span>}
        {more > 0 && <span aria-hidden="true" style={{ position:"absolute", top:3, left:"calc(50% - 24px)", opacity:0.6 }}>
          <SpoolSVG colors={colorsList} finish={finishOf(s)} empty={false} size={64} type={s.filament_multicolor_type}/></span>}
        <span style={{ position:"relative" }}><SpoolSVG colors={colorsList} finish={finishOf(s)} empty={false} size={70}
          type={s.filament_multicolor_type}/></span>
        {more > 0 && <span data-tip={`${more} autre${more > 1 ? "s" : ""} bobine${more > 1 ? "s" : ""} de ce filament en stock`
          + (s.sibling_weight_g ? ` (${fmtStock(s.sibling_weight_g)})` : "")}
          style={{ position:"absolute", right:"calc(50% - 40px)", bottom:0, fontSize:9.5, fontWeight:700, color:"var(--muted)", opacity:.85,
            padding:"0 5px", borderRadius:8, background:"color-mix(in srgb, var(--muted) 12%, transparent)" }}>+{more}</span>}
      </div>

      <div style={{ padding:"2px 9px 10px", display:"flex", flexDirection:"column", gap:5 }}>
        {/* Le poids en couleur, le pourcentage en pastille, puis la jauge */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:4, whiteSpace:"nowrap" }}>
          <span style={{ fontSize:13, fontWeight:900, backgroundImage:`linear-gradient(135deg, ${barColor}, ${lighten(barColor)})`,
            WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }}>{rem != null ? `${Math.round(rem)} g` : "—"}</span>
          {rem != null && <span style={{ fontSize:8.5, fontWeight:900, padding:"1px 5px", borderRadius:20, color:"#fff", background:barColor }}>{pct}%</span>}
        </div>
        <div style={{ height:5, borderRadius:5, background:"var(--surface2)", overflow:"hidden", boxShadow:"inset 0 0 0 1px var(--border)" }}>
          <div style={{ width:`${pct}%`, height:"100%", borderRadius:5, transition:"width 0.5s",
            background:`linear-gradient(90deg, ${barColor}, ${lighten(barColor)})` }}/>
        </div>
        <div style={{ fontSize:9, fontWeight:700, color:"var(--muted)", textAlign:"center", marginTop:-2 }}>sur {total} g</div>

        {/* Nom sur deux lignes fixes : sans hauteur imposee, les tuiles d'une
            meme rangee se decalent des qu'un nom passe a la ligne. */}
        <div style={{ height:"2.6em", display:"flex", alignItems:"center",
          justifyContent:"center" }}>
          <p style={{ fontWeight:800, fontSize:11.5, color:"var(--text)", margin:0,
            lineHeight:"1.3", maxHeight:"2.6em", overflow:"hidden", textAlign:"center",
            display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
            {s.filament_translated_name || s.filament_name}
          </p>
        </div>

        {s.filament_manufacturer && (
          <p style={{ fontSize:9.5, fontWeight:600, color:"var(--muted)", margin:"-3px 0 0",
            textAlign:"center", overflow:"hidden", whiteSpace:"nowrap",
            textOverflow:"ellipsis" }}>
            {s.filament_manufacturer}
          </p>
        )}

        {/* Emplacement en pastille pleine largeur : c'est l'info qu'on cherche
            quand on veut aller chercher la bobine physiquement. */}
        {s.location && (
          <span data-tip={s.ordered ? "Commandée, pas encore reçue : le scan RFID ou l'ajout d'une bobine de ce filament l'adoptera" : undefined}
            style={{ fontSize:9, fontWeight:800, padding:"3px 6px", borderRadius:20,
            background: s.ordered ? "rgba(14,165,233,0.16)" : "rgba(139,92,246,0.14)", color: s.ordered ? "#0EA5E9" : "#8B5CF6", textAlign:"center",
            overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>
            {s.ordered ? "📬" : "📍"} {s.location}
          </span>
        )}
      </div>

    </Pressable>
  );
}

const SPOOL_SORTS = [
  ["recent",    "Plus récent"],
  ["hue",       "Teinte"],
  ["name",      "Nom"],
  ["brand",     "Marque"],
  ["remaining", "Poids restant ↓"],
  ["fullest",   "Poids restant ↑"],
  ["dried_old", "Séchage le plus ancien"],
  ["dried_new", "Séchage le plus récent"],
];

// Sous-type d'un élément, quel que soit le jeu de champs : les bobines portent
// filament_*, le catalogue et la galerie non. Une seule fonction plutôt que la
// même expression recopiée dans les quatre endroits qui filtrent.
const itemSub   = (s) => s.filament_fila_type || s.filament_material || s.fila_type || s.material || "";
const itemBrand = (s) => s.filament_manufacturer || s.manufacturer || "";

/** Décompte par valeur, trié du plus fréquent au plus rare. */
function tally(items, get) {
  const m = new Map();
  for (const it of items) {
    const v = get(it);
    if (v) m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Groupe de pastilles à bascule, multi-sélection.
 *
 * Remplace un <select> : au doigt, choisir plusieurs valeurs dans une liste
 * native est impraticable, et sa popup restait en thème clair. Les valeurs sont
 * triées par fréquence — les trois marques réellement utilisées remontent en
 * tête — et repliées au-delà de huit, sinon vingt sous-types faisaient un mur.
 */
function ChipGroup({ label, icon = null, c = "#3B82F6", options, selected, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  if (!options.length) return null;
  const LIMIT = 8;
  const shown = expanded ? options : options.slice(0, LIMIT);
  const hidden = options.length - shown.length;
  return (
    <div style={{ padding:"11px 12px", borderRadius:16, border:`1px solid ${c}33`, background:`linear-gradient(160deg, ${c}14, transparent 55%), var(--surface2)` }}>
      <p style={{ display:"flex", alignItems:"center", gap:7, fontSize:12.5, fontWeight:900, color:"var(--text)", margin:"0 0 8px" }}>
        {icon && <span style={{ width:24, height:24, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, background:`${c}26` }}>{icon}</span>}
        {label}{selected.length > 0 && <span style={{ fontSize:11, fontWeight:900, color:c }}>· {selected.length}</span>}</p>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        {shown.map(([v, n]) => {
          const on = selected.includes(v);
          return (
            <button key={v} onClick={()=>onToggle(v)}
              style={{ padding:"6px 11px", borderRadius:20, fontSize:12, fontWeight:800,
                cursor:"pointer", whiteSpace:"nowrap", border: on ? "1px solid transparent" : "1px solid var(--border)",
                background: on ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "var(--surface)",
                color: on ? "#fff" : "var(--text2)", boxShadow: on ? `0 6px 14px -8px ${c}` : "none" }}>
              {v}<span style={{ opacity:0.7, marginLeft:5 }}>{n}</span>
            </button>
          );
        })}
        {hidden > 0 && (
          <button onClick={()=>setExpanded(true)}
            style={{ padding:"6px 11px", borderRadius:20, fontSize:12, fontWeight:800,
              cursor:"pointer", border:"1px dashed var(--border)",
              background:"transparent", color:"var(--muted)" }}>
            +{hidden}
          </button>
        )}
      </div>
    </div>
  );
}

function FilterSortSheet({ allItems, getFamily, filters, sort, onApply, onClose }) {
  useTrackDetail("Filtres et tri");
  // Tableaux et non chaînes : le multi-choix est tout l'objet de ce composant.
  const [fb, setFb] = useState(filters.brand || []);
  const [fm, setFm] = useState(filters.mat   || []);
  const [fs, setFs] = useState(filters.sub   || []);
  const [fst,setFst]= useState(filters.stock || "all"); // all/instock/unavailable
  const [so, setSo] = useState(sort           || "recent");

  const toggle = (setter) => (v) =>
    setter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  // Options TOUJOURS depuis le dataset complet (pas filtré)
  const brands = useMemo(() => tally(allItems, itemBrand), [allItems]);
  const fams   = useMemo(() => tally(allItems, getFamily), [allItems, getFamily]);
  // Les sous-types se restreignent aux matériaux cochés : proposer "PETG-HF"
  // alors qu'on a coché PLA ne mène qu'à zéro résultat.
  const subs   = useMemo(() => {
    const base = fm.length ? allItems.filter(s => fm.includes(getFamily(s))) : allItems;
    return tally(base, itemSub);
  }, [allItems, fm, getFamily]);

  // Un sous-type coché puis devenu hors périmètre est retiré en silence,
  // sinon la liste se vide sans que rien n'explique pourquoi.
  useEffect(() => {
    const ok = new Set(subs.map(([v]) => v));
    setFs(prev => prev.filter(v => ok.has(v)));
  }, [subs]);

  const activeCount = fb.length + fm.length + fs.length + (fst !== "all" ? 1 : 0);
  const card = (c) => ({ padding:"11px 12px", borderRadius:16, border:`1px solid ${c}33`, background:`linear-gradient(160deg, ${c}14, transparent 55%), var(--surface2)` });
  const head = (ic, l, c) => <p style={{ display:"flex", alignItems:"center", gap:7, fontSize:12.5, fontWeight:900, color:"var(--text)", margin:"0 0 8px" }}>
    <span style={{ width:24, height:24, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, background:`${c}26` }}>{ic}</span>{l}</p>;

  return (
    <div data-no-pull="" style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ width:"100%", maxWidth:600, maxHeight:"88dvh", background:"var(--sheet-bg)", overflow:"hidden",
        borderRadius:"22px 22px 0 0", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"16px 16px 12px", background:"linear-gradient(135deg, rgba(59,130,246,0.22), transparent 70%)" }}>
          <span style={{ width:38, height:38, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff",
            background:"linear-gradient(135deg, #3B82F6, #6366F1)" }}><SlidersHorizontal size={18}/></span>
          <span style={{ flex:1, fontWeight:900, fontSize:16, color:"var(--text)" }}>Filtres & tri
            {activeCount > 0 && <span style={{ marginLeft:8, fontSize:11.5, fontWeight:900, color:"#fff", padding:"1px 8px", borderRadius:20,
              background:"linear-gradient(135deg, #3B82F6, #6366F1)" }}>{activeCount}</span>}</span>
          <button onClick={onClose} aria-label="Fermer" style={{ width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text2)", fontSize:15, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"4px 14px 14px", display:"flex", flexDirection:"column", gap:10 }}>
          {/* Tri */}
          <div style={card("#8B5CF6")}>
            {head("↕", "Trier par", "#8B5CF6")}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:6 }}>
              {SPOOL_SORTS.map(([id,label]) => (
                <button key={id} onClick={()=>setSo(id)}
                  style={{ padding:"8px 10px", borderRadius:12, fontSize:12, fontWeight:800, cursor:"pointer", textAlign:"left",
                    border: so===id ? "1px solid transparent" : "1px solid var(--border)",
                    background: so===id ? "linear-gradient(135deg, #8B5CF6, #A855F7)" : "var(--surface)",
                    color: so===id ? "white" : "var(--text2)" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Disponibilite */}
          <div style={card("#22C55E")}>
            {head("📦", "Disponibilité", "#22C55E")}
            <div style={{ display:"flex", gap:3, padding:3, borderRadius:14, background:"var(--surface)", border:"1px solid var(--border)" }}>
              {[["all","Tous"],["instock","En stock"],["unavailable","Non disponible"]].map(([id,label])=>(
                <button key={id} onClick={()=>setFst(id)}
                  style={{ flex:1, padding:"7px 4px", borderRadius:11, fontSize:12, fontWeight:800, cursor:"pointer", border:"none",
                    background: fst===id ? "linear-gradient(135deg, #22C55E, #16A34A)" : "transparent", color: fst===id ? "white" : "var(--muted)" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Filtres */}
          <ChipGroup label="Matière" icon="🧪" c="#F59E0B" options={fams} selected={fm} onToggle={toggle(setFm)}/>
          {subs.length > 1 && (
            <ChipGroup label="Sous-type" icon="🏷️" c="#EC4899" options={subs} selected={fs} onToggle={toggle(setFs)}/>
          )}
          <ChipGroup label="Marque" icon="🏭" c="#06B6D4" options={brands} selected={fb} onToggle={toggle(setFb)}/>
        </div>

        {/* le pied, toujours visible */}
        <div style={{ display:"flex", gap:8, padding:"10px 14px calc(10px + env(safe-area-inset-bottom, 0px))", borderTop:"1px solid var(--border)" }}>
          <button onClick={()=>{ setFb([]); setFm([]); setFs([]); setFst("all"); }} disabled={!activeCount}
            style={{ flex:1, padding:"12px", borderRadius:12, fontSize:13.5, fontWeight:800, cursor:"pointer",
              background:"var(--surface2)", border:"1px solid var(--border)", color: activeCount ? "var(--text)" : "var(--muted)" }}>
            Tout effacer
          </button>
          <button onClick={()=>onApply({brand:fb,mat:fm,sub:fs,stock:fst},so)}
            style={{ flex:2, padding:"12px", borderRadius:12, fontSize:13.5, fontWeight:800,
              background:"linear-gradient(135deg, #3B82F6, #6366F1)", color:"white", border:"none", cursor:"pointer", boxShadow:"0 8px 18px -10px #3B82F6" }}>
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}

// Les listes et les reglages (recherche, filtres, tri) de chaque onglet, gardes le temps de la page (28/10/2026 :
// chaque changement d'onglet demontait la vue, relançait la liste complete et perdait la recherche). La liste
// gardee s'affiche tout de suite, et se relit derriere.
const _KEEP = { lists: {}, ui: {} };
const _kept = (k, dflt) => (k in _KEEP.ui ? _KEEP.ui[k] : dflt);

function SpoolsView({ filaments, showArchived }) {
  const isAdmin = useIsAdmin();
  const KEY = `spools:${showArchived ? 1 : 0}`;
  const [selFil, setSelFil] = useState(null);
  // Appui long / clic droit sur une bobine.
  const spoolMenu = s => {
    const fil = (filaments || []).find(f => f.id === s.filament_id);
    const name = s.filament_translated_name || s.filament_name || `Bobine #${s.id}`;
    return {
      title: name, subtitle: `#${s.id}${s.remaining_weight_g != null ? ` · ${Math.round(s.remaining_weight_g)} g` : ""}`,
      color: paleHex(s.filament_color) ? "#94a3b8" : (hexToCss(s.filament_color) || "#3B82F6"),
      items: [
        { icon: "📄", label: "Ouvrir la bobine", tone: "#3B82F6", onClick: () => setSelected(s) },
        fil && { icon: "🧵", label: "Voir le filament", tone: "#EC4899", onClick: () => setSelFil(fil) },
        isAdmin && fil && { icon: "＋", label: "Ajouter une bobine de ce filament", tone: "#22C55E", onClick: () => setShowAdd(fil.id) },
        isAdmin && !s.archived && "-",
        isAdmin && !s.archived && { icon: "📦", label: "Archiver…", hint: "Quantité remise à 0, sort du stock", tone: "#64748B", onClick: async () => {
          if (!(await showConfirm(`Archiver la bobine #${s.id} ? Elle passera en Archives avec une quantité remise à 0 et sortira du stock.`,
            { confirmLabel: "Archiver" }))) return;
          try { await client.delete(`/filaments/spools/${s.id}`); load(); }
          catch (e) { showAlert(e.response?.data?.detail || e.message); }
        } },
        isAdmin && { icon: "🗑", label: "Supprimer définitivement…", danger: true, onClick: async () => {
          if (!(await showConfirm(`Supprimer définitivement la bobine #${s.id} ?`, { danger: true, confirmLabel: "Supprimer" }))) return;
          try {
            let r = await client.delete(`/filaments/spools/${s.id}/permanent`, { params: { force: false } });
            if (r.data.confirm_required) {
              if (!(await showConfirm(r.data.message || `Bobine utilisée par ${r.data.usage_count} impression(s). Supprimer quand même ?`,
                { danger: true, confirmLabel: "Supprimer" }))) return;
              await client.delete(`/filaments/spools/${s.id}/permanent`, { params: { force: true } });
            }
            load();
          } catch (e) { showAlert(e.response?.data?.detail || e.message); }
        } },
      ],
    };
  };
  const [allSpools, setAllSpools] = useState(() => _KEEP.lists[KEY] || []);
  const [q, setQ] = useState(() => _kept(KEY + ":q", ""));
  const [loading, setLoading] = useState(() => !_KEEP.lists[KEY]);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState(() => _kept(KEY + ":f", { brand:[], mat:[], sub:[] }));
  const [sort, setSort] = useState(() => _kept(KEY + ":s", "recent"));
  useEffect(() => { _KEEP.ui[KEY + ":q"] = q; _KEEP.ui[KEY + ":f"] = filters; _KEEP.ui[KEY + ":s"] = sort; }, [KEY, q, filters, sort]);

  const FAMILIES = ["PLA","PETG","ABS","ASA","PA","PC","TPU","PVA","PLA-CF","PETG-CF","PA-CF","PPS"];
  const getFamily = s => {
    const sub = s.filament_material || s.filament_fila_type || "";
    return FAMILIES.find(f => sub === f || sub.startsWith(f+" ") || sub.startsWith(f+"-")) || sub.split(/[\s-]/)[0] || "";
  };

  const load = useCallback(async () => {
    if (!_KEEP.lists[KEY]) setLoading(true);
    try {
      const { data } = await client.get("/filaments/spools", { params:{ archived:showArchived } });
      _KEEP.lists[KEY] = data;
      setAllSpools(data);
    } finally { setLoading(false); }
  }, [showArchived, KEY]);

  useEffect(() => { load(); }, [load]);

  // Filtrage + recherche client-side (options depuis allSpools = pas de cascade cassée)
  const spools = useMemo(() => {
    let res = allSpools;
    if (q.trim()) {
      // Partout (nom, marque, matiere, SOUS-TYPE « PLA Silk+ », couleur, code,
      // emplacement, tag, commentaire, n° de bobine) et mot par mot : « silk
      // rouge » trouve les Silk rouges, quel que soit l'ordre des mots.
      const words = q.replace(/#/g, "").toLowerCase().split(/\s+/).filter(Boolean);
      res = res.filter(s => {
        const hay = [
          s.filament_translated_name, s.filament_name, s.filament_manufacturer,
          s.filament_material, s.filament_fila_type, (s.filament_color||"").replace("#",""),
          s.filament_fila_color_code, s.location, s.tag_number, s.comment, s.external_spool_id,
          String(s.id),
        ].filter(Boolean).join(" ").toLowerCase();
        return words.every(w => hay.includes(w));
      });
    }
    // Multi-choix : une valeur cochee suffit (OU au sein d'un critere), mais
    // tous les criteres renseignes doivent etre satisfaits (ET entre criteres).
    if (filters.brand?.length) res = res.filter(s => filters.brand.includes(itemBrand(s)));
    if (filters.mat?.length)   res = res.filter(s => filters.mat.includes(getFamily(s)));
    if (filters.sub?.length)   res = res.filter(s => filters.sub.includes(itemSub(s)));
    if (filters.stock === "instock")     res = res.filter(s => (s.remaining_weight_g||0) > 0);
    if (filters.stock === "unavailable") res = res.filter(s => !(s.remaining_weight_g > 0));
    // Tri (les bobines commandees, pas encore la, toujours en dernier)
    res = [...res].sort((a,b) => {
      if (!!a.ordered !== !!b.ordered) return a.ordered ? 1 : -1;
      if (sort==="hue") return compareHue(a.filament_color, b.filament_color);
      if (sort==="name")      return (a.filament_translated_name||a.filament_name||"").localeCompare(b.filament_translated_name||b.filament_name||"");
      if (sort==="brand")     return (a.filament_manufacturer||"").localeCompare(b.filament_manufacturer||"");
      if (sort==="remaining") return (b.remaining_weight_g||0)-(a.remaining_weight_g||0);
      if (sort==="fullest")   return (a.remaining_weight_g||0)-(b.remaining_weight_g||0);
      // Jamais sechee = la plus ancienne (en tete du tri « plus ancien »).
      if (sort==="dried_old" || sort==="dried_new") {
        const t = x => x.last_dried_at ? new Date(x.last_dried_at).getTime() : 0;
        return sort==="dried_old" ? t(a) - t(b) : t(b) - t(a);
      }
      return 0;
    });
    return res;
  }, [allSpools, q, filters, sort]);

  const activeFilters = (filters.brand?.length||0) + (filters.mat?.length||0) + (filters.sub?.length||0)
    + (filters.stock && filters.stock !== "all" ? 1 : 0);

  // KPIs dynamiques (recalculés à chaque changement de spools filtrés)
  const kpis = useMemo(() => {
    if (showArchived) {
      const prixTotal = spools.reduce((s, b) => s + (b.price_override || 0), 0);
      return [
        { label:"archivées", value: spools.length, accent:"#94a3b8" },
        { label:"valeur",    value: prixTotal > 0 ? `${moneyVal(prixTotal, 0)} €` : null, accent:"#94a3b8" },
      ];
    }
    const here = spools.filter(b => !b.ordered), ordered = spools.length - here.length;
    const marques = new Set(here.map(b => b.filament_manufacturer).filter(Boolean)).size;
    const poids = here.reduce((s, b) => s + (b.remaining_weight_g ?? b.filament_weight_g ?? 0), 0);
    const prix  = here.reduce((s, b) => s + (b.price_override || 0), 0);
    return [
      { label:"bobines",  value: ordered ? `${here.length} +${ordered}` : here.length, accent:"#3b82f6" },
      { label:"marques",  value: marques || null, accent:"#8b5cf6" },
      { label:"en stock", value: poids > 0 ? `${(poids/1000).toFixed(2)} kg` : null, accent:"#f59e0b" },
      { label:"valeur",   value: prix > 0 ? `${moneyVal(prix, 0)} €` : null, accent:"#22c55e" },
    ];
  }, [spools, showArchived]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <KpiBar kpis={kpis} icons={KPI_ICON}/>
      {!showArchived && <IncomingOrders/>}
      {/* Pas de « + Bobine » dans l'onglet Archivees : on y consulte un historique, une
          bobine neuve n'a aucune raison d'y naitre -- elle apparaitrait
          aussitot dans l'onglet Stock, hors de la vue en cours. */}
      <SearchRow q={q} setQ={setQ} placeholder="Nom, marque, type (silk…), couleur, code…" active={activeFilters}
        onFilter={() => setFilterOpen(true)} addLabel={showArchived ? null : "Bobine"} onAdd={() => setShowAdd(true)}/>
      <FilterChips filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} defSort="recent"/>
      {filterOpen && (
        <FilterSortSheet
          allItems={allSpools}
          getFamily={getFamily}
          filters={filters}
          sort={sort}
          onApply={(f,s)=>{ setFilters(f); setSort(s); setFilterOpen(false); }}
          onClose={()=>setFilterOpen(false)}
        />
      )}
      {/* 104px mini : trois colonnes des 360px de large, donc sur les plus
          petits telephones aussi, et la grille s'elargit ensuite d'elle-meme
          sur tablette et bureau -- aucun point de rupture a maintenir. */}
      {!loading && !spools.length && <EmptyCard icon={showArchived ? "🗄" : "🧵"} text={allSpools.length ? "Aucune bobine ne correspond." : showArchived ? "Aucune bobine archivée." : "Aucune bobine en stock."}/>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(108px,1fr))", gap:8 }}>
        {spools.map(s => {
          const colorsList = parseColorsList(s.filament_color, s.filament_colors_array);
          return (
            <SpoolCard key={s.id} s={s} colorsList={colorsList} onClick={()=>setSelected(s)} menu={() => spoolMenu(s)}/>
          );
        })}
      </div>
      {showAdd && <AddSpoolModal filaments={filaments} preselect={showAdd === true ? undefined : showAdd}
        onSave={()=>{ setShowAdd(false); load(); }} onClose={()=>setShowAdd(false)}/>}
      {selFil && <FilamentSheet f={selFil} onClose={() => setSelFil(null)} onDeleted={() => { setSelFil(null); load(); }}/>}
      {selected && (
        <SpoolBottomSheet
          spool={selected}
          onClose={()=>setSelected(null)}
          onArchive={async(id)=>{ await client.delete(`/filaments/spools/${id}`); load(); }}
          onDelete={load}
        />
      )}
    </div>
  );
}

// ── Vue Catalogue ──────────────────────────────────────────────────────────
// ── Fiche filament catalogue ────────────────────────────────────────────────
export function FilamentSheet({ f, onClose, onDeleted, onUpdated }) {
  useTrackDetail(f ? `Fiche filament · ${f.translated_name || f.name || "#" + f.id}` : null);
  const [addSpool, setAddSpool] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name:             f.name || "",
    name_en:          f.name_en || "",
    translated_name:  f.translated_name || "",
    manufacturer:     f.manufacturer || "",
    material:         f.material || "",
    fila_type:        f.fila_type || "",
    // Champ unifié : si multi → toutes les couleurs CSV, si mono → juste la couleur principale
    colors_input:     f.colors_array
      ? f.colors_array.split(",").map(c=>c.trim().replace(/^#/,"")).join(", ")
      : (f.color || ""),
    multicolor_type:  f.multicolor_type || "monochrome",
    fila_finish:      f.fila_finish || autoFinishOf(f) || "none",
    profile_id:       f.profile_id || "",
    fila_color_code:  f.fila_color_code || "",
    filament_weight_g: f.filament_weight_g || 1000,
    spool_weight_g:   f.spool_weight_g || "",
    spool_tare_name:  f.spool_tare_name || "",
    // != null et non "||" : un filament a 0 EUR (offert, echantillon) affichait
    // un champ VIDE, et le reenregistrer effacait le zero saisi.
    price:            f.price != null ? f.price : "",
    comment:          f.comment || "",
    swatch:           f.swatch || false,
    label_printed:    f.label_printed || false,
    to_order:         f.to_order || false,
  });

  const color = hexDisplay(f.color);

  // Parse le champ unifié couleurs → color + colors_array + multicolor_type inféré
  const parseColorsInput = (raw, currentType) => {
    const parts = (raw||"").split(",").map(c=>c.trim().replace(/^#/,"")).filter(c=>c.length>=6);
    if (parts.length === 0) return { color: null, colors_array: null, multicolor_type: "monochrome" };
    if (parts.length === 1) return { color: parts[0], colors_array: null, multicolor_type: "monochrome" };
    return {
      color: parts[0],
      colors_array: parts.map(c=>`#${c}`).join(","),
      multicolor_type: currentType !== "monochrome" ? currentType : "coaxial",
    };
  };

  // Swatches live du champ couleurs_input
  const liveColors = (form.colors_input||"").split(",")
    .map(c=>c.trim().replace(/^#/,"")).filter(c=>c.length>=6)
    .map(c=>hexToCss(c)).filter(Boolean);
  const colorsList = parseColorsList(f.color, f.colors_array);

  const iStyle = { width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
    borderRadius:8, padding:"8px 10px", fontSize:13, color:"var(--text)", outline:"none",
    boxSizing:"border-box" };
  const lStyle = { fontSize:11, color:"var(--muted)", margin:"0 0 4px", display:"block" };

  const handleSave = async () => {
    const { color: col, colors_array: ca, multicolor_type: mct } = parseColorsInput(form.colors_input, form.multicolor_type);
    setSaving(true);
    try {
      const r = await client.patch(`/filaments/filaments/${f.id}`, {
        name:              form.name,
        name_en:           form.name_en || undefined,
        translated_name:   form.translated_name || undefined,
        manufacturer:      form.manufacturer || undefined,
        material:          form.fila_type || form.material || "PLA",
        fila_type:         form.fila_type || undefined,
        color:             col || undefined,
        colors_array:      ca ?? null,
        multicolor_type:   mct,
        // gardee seulement si elle differe de celle que le nom donne ("" : on suit le nom)
        fila_finish:       form.fila_finish === (autoFinishOf(form) || "none") ? "" : form.fila_finish,
        profile_id:        form.profile_id || undefined,
        fila_color_code:   form.fila_color_code || undefined,
        filament_weight_g: Number(form.filament_weight_g) || 1000,
        spool_weight_g:    form.spool_weight_g ? Number(form.spool_weight_g) : undefined,
        spool_tare_name:   form.spool_tare_name || "",     // "" = Autre : lien retire
        price:             form.price ? Number(form.price) : undefined,
        comment:           form.comment || undefined,
        swatch:            form.swatch,
        label_printed:     form.label_printed,
        to_order:          form.to_order,
      });
      setEditing(false);
      onUpdated?.(r.data);
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    // Meme regle que le serveur, annoncee AVANT le clic de confirmation : le
    // garde-fou qui compte vit cote serveur, mais laisser confirmer une
    // suppression vouee a echouer n'apprend rien a personne.
    if (f.swatch) {
      showAlert("Ce filament a un échantillon imprimé : la plaquette du nuancier porte "
          + "un QR qui pointe cette fiche. Décoche la case Échantillon si elle a été jetée.");
      return;
    }
    if (!(await showConfirm(`Supprimer le filament "${f.name}" ?`, { danger: true, confirmLabel: "Supprimer" }))) return;
    setDeleting(true);
    try {
      await client.delete(`/filaments/filaments/${f.id}`);
      onDeleted?.();
      onClose();
    } catch(e) {
      showAlert(e.response?.data?.detail || e.message);
    } finally { setDeleting(false); }
  };

  const F = (label, k, type="text", options=null) => (
    <div style={{ marginBottom:10 }}>
      <label style={lStyle}>{label}</label>
      {options ? (
        <Select style={iStyle} value={form[k]} onChange={e => setForm(p=>({...p,[k]:e.target.value}))}
          options={options.map(([v,l])=>({ value:v, label:l }))}/>
      ) : (
        <input style={iStyle} type={type} value={form[k]}
          onChange={e => setForm(p=>({...p,[k]:e.target.value}))}/>
      )}
    </div>
  );

  const isAdmin = useIsAdmin();
  const name = f.translated_name || f.name;
  const main = hexToCss(f.color) || "#8B5CF6";
  const labelDay = f.label_printed && f.label_printed_at
    ? new Date(f.label_printed_at + (String(f.label_printed_at).endsWith("Z") ? "" : "Z")).toLocaleDateString("fr-FR") : null;
  const stock = f.remaining_weight_total_g || 0;
  const nAct = f.active_spool_count || 0;
  const colorTxt = colorsList?.length > 1
    ? (f.colors_array || "").split(",").map(c => hexDisplay(c.trim())).filter(Boolean).join(" / ") : color;
  const menu = e => openMenu(e, {
    title: name, subtitle: `Filament #${f.id}`, color: main,
    items: [
      { icon: "✏️", label: "Éditer", hint: "Nom, couleurs, poids, prix…", tone: "#3B82F6", onClick: () => setEditing(true) },
      { icon: "＋", label: "Créer une bobine", hint: "de ce filament", tone: "#22C55E", onClick: () => setAddSpool(true) },
      "-",
      { icon: "🗑", label: "Supprimer…", danger: true, disabled: deleting, onClick: handleDelete },
    ],
  });

  return (
    <FSheet onClose={onClose} top={isAdmin && !editing && <button onClick={menu} aria-label="Plus d'actions" style={fRound}>⋯</button>}
      bottom={isAdmin && (editing ? <>
        <button onClick={() => setEditing(false)} style={{ ...fBtn, flex:1, color:"var(--muted)" }}>Annuler</button>
        <button onClick={handleSave} disabled={saving} style={{ ...fBtn, flex:2, border:"none", color:"#fff",
          background: saving ? "var(--border)" : "linear-gradient(135deg, #3B82F6, #6366F1)" }}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
      </> : <>
        <button onClick={() => setEditing(true)} style={{ ...fBtn, flex:1 }}>✏️ Éditer</button>
        <button onClick={() => setAddSpool(true)} style={{ ...fBtn, flex:1, color:"#16a34a", borderColor:"rgba(34,197,94,0.35)", background:"rgba(34,197,94,0.1)" }}>
          <Plus size={15}/> Bobine</button>
        <button onClick={menu} aria-label="Plus d'actions" style={{ ...fBtn, width:48, flex:"0 0 auto" }}>⋯</button>
      </>)}>
      <FHero colors={colorsList} type={f.multicolor_type} finish={finishOf(f)} color={main} name={name}
        chips={[fChip(`#${f.id}`, "#64748B"),
          f.ordered_spool_count > 0 && fChip(`📬 ${f.ordered_spool_count} en commande`, "#0EA5E9"),
          fChip(<><Palette size={11}/>{f.swatch ? "Échantillon" : "Sans échantillon"}</>, f.swatch ? "#22c55e" : "#94a3b8"),
          <span key="lbl" data-tip={labelDay ? `Étiquette imprimée le ${labelDay}` : undefined}>
            {fChip(<><Tag size={11}/>{f.label_printed ? "Étiquette" : "Sans étiquette"}</>, f.label_printed ? "#3b82f6" : "#94a3b8")}</span>,
          f.to_order && fChip("🛒 À commander", "#f97316")]}
        sub={<>
          {f.translated_name && f.translated_name !== f.name && <div style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)", marginTop:-3 }}>{f.name}</div>}
          {/* Marque puis SOUS-TYPE (PLA Basic), repli sur la matiere : comme la fiche bobine. */}
          <div style={{ fontSize:14, fontWeight:700, color:"var(--text2)" }}>{[f.manufacturer, f.fila_type || f.material].filter(Boolean).join(" · ")}</div></>}>
        <div style={{ display:"flex", alignItems:"baseline", gap:8, flexWrap:"wrap", marginTop:2 }}>
          <span style={{ fontSize:28, fontWeight:900, lineHeight:1.2, paddingBottom:2, ...(nAct ? fGrad("#16A34A", "#4ADE80") : { color:"var(--muted)" }) }}>{nAct ? fmtStock(stock) : "0 g"}</span>
          <span style={{ fontSize:12.5, fontWeight:700, color:"var(--muted)" }}>en stock · {nAct} bobine{nAct !== 1 ? "s" : ""} active{nAct !== 1 ? "s" : ""}{f.ordered_spool_count > 0 ? ` · ${f.ordered_spool_count} en commande` : ""}</span>
        </div>
      </FHero>

      <div style={{ padding:"12px 14px 18px", display:"flex", flexDirection:"column", gap:12 }}>
        {editing ? (
          <FCard t="Modifier le filament" i="✏️" c="#3B82F6">
            <div style={{ paddingTop:6 }}>
              {F("Nom (anglais / officiel) *","name")}
              {F("Nom traduit (français)","translated_name")}
              {F("Marque","manufacturer")}
              {F("Sous-type (ex: PLA Basic)","fila_type")}
              <div style={{ marginBottom:10 }}>
                <label style={lStyle}>Couleur(s) — hex séparées par virgule si multi</label>
                <input style={iStyle} value={form.colors_input}
                  placeholder="ex: 0047bb  ou  0047bb, bb22a3"
                  onChange={e => setForm(f=>({...f, colors_input: e.target.value}))}/>
                {liveColors.length > 0 && (
                  <div style={{ display:"flex", gap:4, marginTop:6, alignItems:"center" }}>
                    {liveColors.map((c,i) => (
                      <div key={i} style={{ width:24, height:24, borderRadius:5,
                        overflow:"hidden", border:"1px solid var(--border)", ...colorBg([c], null, null, { size: 24 }) }}/>
                    ))}
                    {liveColors.length === 1
                      ? <span style={{ fontSize:10, color:"var(--muted)", marginLeft:4 }}>Monochrome</span>
                      : <span style={{ fontSize:10, color:"#3b82f6", marginLeft:4, fontWeight:600 }}>
                          {liveColors.length} couleurs → {form.multicolor_type !== "monochrome" ? form.multicolor_type : "coaxial"}
                        </span>
                    }
                  </div>
                )}
              </div>
              {liveColors.length > 1 && (
                <div style={{ marginBottom:10 }}>
                  <label style={lStyle}>Type multicolore</label>
                  <Select style={iStyle} value={form.multicolor_type === "monochrome" ? "coaxial" : form.multicolor_type}
                    onChange={e => setForm(f=>({...f, multicolor_type: e.target.value}))}
                    options={[{ value:"gradient", label:"Gradient (dégradé)" },
                              { value:"coaxial",  label:"Coaxial (segments)" }]}/>
                </div>
              )}
              <FinishPicker value={form.fila_finish} auto={autoFinishOf(form)} colors={liveColors} style={iStyle} lStyle={lStyle}
                onChange={v => setForm(p => ({ ...p, fila_finish: v }))}/>
              {F("Profile ID Bambu (ex: GFA00)","profile_id")}
              {F("Code couleur Bambu (ex: 10600)","fila_color_code")}
              {F("Poids total (g)","filament_weight_g","number")}
              <div style={{ marginBottom:10 }}>
                <label style={lStyle}>Poids support vide</label>
                <div style={{ display:"flex" }}>
                  <TarePicker value={form.spool_weight_g === "" || form.spool_weight_g == null ? "" : String(form.spool_weight_g)}
                    tareName={form.spool_tare_name || null}
                    onChange={(v, name) => setForm(p => ({ ...p, spool_weight_g: v, spool_tare_name: name || "" }))}
                    selectStyle={iStyle} inputStyle={iStyle}/>
                </div>
              </div>
              {F("Prix (€)","price","number")}
              {F("Commentaire","comment")}
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                {[["swatch","Échantillon"],["label_printed","Étiquette imprimée"],["to_order","À commander"]].map(([k,l])=>(
                  <label key={k} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12.5, fontWeight:700, cursor:"pointer", padding:"6px 10px",
                    borderRadius:10, border:"1px solid var(--border)", background: form[k] ? "rgba(59,130,246,0.12)" : "var(--surface)", color: form[k] ? "#3b82f6" : "var(--text2)" }}>
                    <input type="checkbox" checked={!!form[k]}
                      onChange={e => setForm(f=>({...f,[k]:e.target.checked}))}/>
                    {l}
                  </label>
                ))}
              </div>
            </div>
          </FCard>
        ) : <>
          {/* les chiffres du filament */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0, 1fr))", gap:6 }}>
            <FTile label="🧵 Stock" value={nAct ? fmtStock(stock) : "—"} sub={`${nAct} active${nAct !== 1 ? "s" : ""}${f.ordered_spool_count > 0 ? ` · ${f.ordered_spool_count} en commande` : ""}`} c1="#16A34A" c2="#4ADE80"
              onClick={isAdmin ? () => setAddSpool(true) : undefined} tip={isAdmin ? "Créer une bobine" : undefined}/>
            <FTile label="💶 Prix" value={f.price != null && f.price !== "" ? `${moneyVal(Number(f.price), 2)} €` : "—"}
              sub={f.price && f.filament_weight_g ? `${moneyVal(Number(f.price) * 1000 / f.filament_weight_g, 2)} €/kg` : null} c1="#F59E0B" c2="#FBBF24"/>
            <FTile label="⚖ Bobine" value={f.filament_weight_g ? `${f.filament_weight_g} g` : "—"} sub="de filament" c1="#8B5CF6" c2="#C084FC"/>
            <FTile label="◎ Support" value={f.spool_weight_g ? `${f.spool_weight_g} g` : "—"} sub={f.spool_tare_name || "vide"} c1="#64748B" c2="#94A3B8"/>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(250px, 1fr))", gap:12 }}>
            <FCard t="Le filament" i="🎨" c={main}>
              <FRow l="Marque" v={f.manufacturer}/>
              <FRow l="Matière" v={f.material}/>
              <FRow l="Sous-type" v={f.fila_type}/>
              <FRow l="Couleur" v={colorTxt} mono pre={<ColorSwatch color={f.color} colorsArray={f.colors_array} multicolorType={f.multicolor_type} finish={finishOf(f)} size={16} radius={4}/>}/>
              <FRow l="Multicolor" v={f.multicolor_type && f.multicolor_type !== "monochrome" ? f.multicolor_type : null}/>
              <FRow l="Finition" v={FINISHES.find(([k]) => k === finishOf(f))?.[1] || null}/>
            </FCard>
            <FCard t="Côté Bambu" i="🏷️" c="#0EA5E9">
              <FRow l="Profile ID" v={f.profile_id} mono/>
              <FRow l="Code couleur Bambu" v={f.fila_color_code} mono/>
              <FRow l="Échantillon" v={f.swatch ? "fait" : "à faire"} vc={f.swatch ? "#16a34a" : "#d97706"}/>
              <FRow l="Étiquette" v={f.label_printed ? "imprimée" : "à imprimer"} d={labelDay ? `le ${labelDay}` : null} vc={f.label_printed ? "#3b82f6" : "#d97706"}/>
              <FRow l="À commander" v={f.to_order ? "oui" : null} vc="#f97316"/>
            </FCard>
          </div>
          {f.comment && <div style={{ position:"relative", padding:"12px 14px 12px 18px", borderRadius:16, overflow:"hidden",
            background:"linear-gradient(135deg, color-mix(in srgb, #A855F7 12%, transparent), transparent 70%), var(--surface2)", border:"1px solid var(--border)" }}>
            <span aria-hidden="true" style={{ position:"absolute", left:0, top:10, bottom:10, width:4, borderRadius:4, background:"linear-gradient(#A855F7, #EC4899)" }}/>
            <div style={{ fontSize:10.5, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#A855F7", marginBottom:4 }}>💬 Commentaire</div>
            <p style={{ fontSize:13.5, color:"var(--text)", margin:0, lineHeight:1.5, fontStyle:"italic" }}>« {f.comment} »</p></div>}
        </>}
      </div>
      {addSpool && (
        <AddSpoolModal preselect={f.id}
          onClose={() => setAddSpool(false)}
          onSave={() => { setAddSpool(false); onUpdated?.(); }}/>
      )}
    </FSheet>
  );
}

// Carte d'un filament : sa couleur en fond, nom, marque, matiere, bobines en
// stock. Partagee par l'onglet Filaments et la galerie Photos, qui doivent se
// lire pareil. `extra` ajoute une pastille en bas a droite.
// Stock lisible : grammes sous le kilo, kilos au-dela.
const fmtStock = (g) => g >= 1000 ? `${(g / 1000).toFixed(2).replace(".", ",")} kg` : `${Math.round(g)} g`;

// une teinte tres claire (blanc, ivoire…) se perd sur un fond clair : elle garde un liseré
const paleHex = h => { const m = /^#?([0-9a-f]{6})/i.exec(h || ""); if (!m) return false; const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.8; };

function FilamentCard({ f, onClick, extra = null, menu, onLong }) {
  const colorsList = parseColorsList(f.color, f.colors_array);
  const flt = "drop-shadow(0 1px 4px rgba(0,0,0,0.95)) drop-shadow(0 2px 10px rgba(0,0,0,0.6))";
  const glass = { fontSize:9, fontWeight:800, padding:"2px 7px", borderRadius:20, whiteSpace:"nowrap", flexShrink:0,
    background:"rgba(15,23,42,0.38)", color:"rgba(255,255,255,0.92)", backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)" };
  const pale = paleHex(f.color);
  return (
    <Pressable onClick={onClick} menu={menu} onLong={onLong} className="card-sm"
      style={{ overflow:"hidden", cursor:"pointer", padding:0, position:"relative", borderRadius:18, minHeight:96,
        boxShadow:`0 10px 22px -14px ${hexToCss(f.color) || "#000"}`, border: pale ? "1px solid rgba(0,0,0,0.18)" : "1px solid transparent" }}>
      {/* fond couleur (damier de transparence géré par colorBg), un reflet en haut */}
      <div style={{ position:"absolute", inset:0, ...colorBg(colorsList, f.multicolor_type, finishOf(f), { size: 140 }) }}/>
      <div style={{ position:"absolute", inset:0, background:"linear-gradient(160deg, rgba(255,255,255,0.22), transparent 45%, rgba(0,0,0,0.25))" }}/>
      {f.to_order && <span data-tip="À commander" style={{ ...glass, position:"absolute", top:7, right:7, background:"rgba(249,115,22,0.85)" }}>🛒</span>}
      <div style={{ position:"relative", padding:"10px 11px 32px", display:"flex", flexDirection:"column", gap:0 }}>
        {/* Meme centrage que la grille des bobines : le tronquage
            alignait les noms d'une seule ligne en haut du bloc. */}
        <div style={{ height:"2.7em", margin:"0 0 7px", display:"flex", paddingRight: f.to_order ? 22 : 0,
          alignItems:"center" }}>
          <p style={{ fontWeight:800, fontSize:12.5, color:"white", margin:0,
            lineHeight:"1.35", maxHeight:"2.7em", overflow:"hidden",
            display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical",
            letterSpacing:"0.01em", filter:flt }}>
            {f.translated_name || f.name}
          </p>
        </div>
        <div style={{ display:"flex", gap:4, flexWrap:"nowrap", overflow:"hidden", alignItems:"center" }}>
          {f.manufacturer && <span style={glass}>{f.manufacturer}</span>}
          {(f.fila_type||f.material) && <span style={{ ...glass, background:"rgba(15,23,42,0.28)" }}>{f.fila_type||f.material}</span>}
        </div>
      </div>
      {/* `extra` (galerie : nombre d'impressions) REMPLACE le stock : les deux
          cote a cote se chevauchaient, et la galerie n'a que faire des bobines. */}
      <span style={{ ...glass, position:"absolute", bottom:8, left:10, fontSize:9.5 }}>
        {extra != null ? extra : (<>
          {f.active_spool_count>0 ? `🧵 ${f.active_spool_count} bobine${f.active_spool_count>1?"s":""}` : "0 bobine"}{f.ordered_spool_count > 0 ? ` +${f.ordered_spool_count} 📬` : ""}
          {f.active_spool_count>0 && f.remaining_weight_total_g > 0 && ` · ${fmtStock(f.remaining_weight_total_g)}`}
        </>)}
      </span>
    </Pressable>
  );
}

// Galerie des impressions d'un filament : les prints qui ont utilise une de
// ses bobines, archivee ou non (onglet Galerie > Photos). Vignette = la photo
// prise (couverture d'abord), celle du groupe a defaut, sinon l'image du
// plateau. Un clic ouvre la fiche du print PAR-DESSUS, sans quitter la page :
// la meme fiche que l'historique (photos comprises).
function FilamentPrintsSheet({ f, onClose }) {
  useTrackDetail("Filaments · Impressions d'un filament");
  const hasFriends = useHasFriends();
  const shared = useShared(`/friends/shared/filament/${f.id}`, hasFriends);
  const nShared = sharedCount(shared);                 // onglet seulement s'il y a quelque chose chez eux
  const [tab, setTab] = useState("mine");             // mine | friends
  const [prints, setPrints] = useState(null);
  const [err, setErr] = useState(null);
  const [groups, setGroups] = useState([]);
  const [detail, setDetail] = useState(null);   // print complet ouvert en fiche
  const [groupOpen, setGroupOpen] = useState(null);   // groupe ouvert en fiche
  const load = useCallback(() => {
    client.get(`/filaments/filaments/${f.id}/prints`)
      .then(r => { setPrints(r.data?.prints || []); setGroups(r.data?.groups || []); })
      .catch(e => setErr(e.response?.data?.detail || "Chargement impossible"));
  }, [f.id]);

  // Plusieurs prints du meme groupe = UNE vignette, celle du groupe (ses
  // photos, sa couverture d'abord) ; un print seul de son groupe reste une
  // vignette de print. Avec photo d'abord, puis les plus recents.
  const tiles = useMemo(() => {
    if (!prints) return null;
    const byG = {};
    prints.forEach(p => { if (p.group_id != null) (byG[p.group_id] ||= []).push(p); });
    const info = Object.fromEntries(groups.map(g => [g.id, g]));
    const out = [], done = new Set();
    for (const p of prints) {
      const members = p.group_id != null ? byG[p.group_id] : null;
      if (members && members.length > 1) {
        if (done.has(p.group_id)) continue;
        done.add(p.group_id);
        const g = info[p.group_id] || { id:p.group_id, name:p.group_name, number_of_items:1 };
        const photos = g.photos?.length ? g.photos : (members.find(m => m.photos.length)?.photos || []);
        const date = members.map(m => m.print_date || "").sort().pop();
        const grams = Math.round(members.reduce((t, m) => t + (m.grams || 0), 0) * 10) / 10;
        out.push({ kind:"group", key:"g" + g.id, g, members, photos, date, grams, image: members[0].image });
      } else {
        out.push({ kind:"print", key:"p" + p.id, p, photos:p.photos, date:p.print_date });
      }
    }
    out.sort((a, b) => (!a.photos.length - !b.photos.length) || (b.date || "").localeCompare(a.date || ""));
    return out;
  }, [prints, groups]);
  useEffect(() => { load(); }, [load]);
  const openDetail = (id) => client.get(`/prints/${id}`)
    .then(r => setDetail(r.data))
    .catch(e => showAlert(e.response?.data?.detail || "Impression introuvable"));
  const colorsList = parseColorsList(f.color, f.colors_array);
  const STATUS = { FINISHED:["Terminé","#22c55e"], FAILED:["Échoué","#ef4444"],
    CANCELLED:["Annulé","#94a3b8"], IN_PROGRESS:["En cours","#3b82f6"] };
  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"2-digit" }) : "";
  const fMain = paleHex(f.color) ? "#94a3b8" : (hexToCss(f.color) || "#EC4899");
  const tileSt = c => ({ padding:0, overflow:"hidden", cursor:"pointer", borderRadius:16, border:`1px solid color-mix(in srgb, ${c} 25%, var(--border))`,
    background:`linear-gradient(160deg, ${c}12, transparent 50%), var(--surface)`, boxShadow:"0 8px 20px -14px rgba(0,0,0,.6)" });
  const glassChip = { position:"absolute", background:"rgba(15,23,42,0.6)", color:"white", fontSize:10, fontWeight:800, padding:"2px 7px", borderRadius:20,
    backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)" };

  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:990, background:"rgba(0,0,0,0.7)",
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:760, maxHeight:"88vh",
        display:"flex", flexDirection:"column", background:"var(--sheet-bg)", borderRadius:22, overflow:"hidden" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px",
          borderBottom:"1px solid var(--border)", background:`radial-gradient(circle at 10% 50%, ${fMain}45, transparent 60%), var(--surface2)` }}>
          <span style={{ display:"inline-flex", flexShrink:0, filter:`drop-shadow(0 4px 10px ${fMain}66)` }}>
            <SpoolSVG colors={colorsList} finish={finishOf(f)} size={46} type={f.multicolor_type}/></span>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ margin:0, fontSize:10.5, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#EC4899" }}>🖨️ Imprimé avec</p>
            <p style={{ margin:0, fontSize:16, fontWeight:900, color:"var(--text)",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.translated_name || f.name}</p>
            <p style={{ margin:0, fontSize:12, fontWeight:600, color:"var(--muted)" }}>
              {[f.manufacturer, f.fila_type || f.material].filter(Boolean).join(" · ")}
              {prints ? ` — ${prints.length} impression${prints.length > 1 ? "s" : ""}` : ""}<Hide at="filament-prints" size={9}/>
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)", flexShrink:0,
            background:"var(--surface)", color:"var(--text2)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}><X size={16}/></button>
        </div>
        {nShared > 0 && (
          <div style={{ display:"flex", gap:3, margin:"10px 12px 0", background:"var(--surface2)", borderRadius:16, padding:3,
            border:"1px solid var(--border)" }}>
            {[["mine", `🖨️ Mes impressions${prints ? ` (${prints.length})` : ""}`, "#EC4899"], ["friends", `👀 Chez les copains (${nShared})`, "#8B5CF6"]].map(([k, l, c]) => (
              <button key={k} onClick={() => setTab(k)} style={{ flex:1, padding:"8px 8px", borderRadius:12, fontSize:12.5, fontWeight:800,
                cursor:"pointer", border:"none", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                background: tab === k ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "transparent",
                color: tab === k ? "white" : "var(--muted)", boxShadow: tab === k ? `0 6px 14px -6px ${c}` : "none" }}>{l}</button>
            ))}
          </div>
        )}
        <div style={{ flex:1, overflowY:"auto", padding:12 }}>
          {tab === "friends" && nShared > 0 ? <FriendsPrints data={shared}/> : (<>
          {err && <p style={{ color:"#ef4444", fontSize:13 }}>⚠ {err}</p>}
          {!prints && !err && <p style={{ color:"var(--muted)", fontSize:13, textAlign:"center", padding:24 }}>Chargement…</p>}
          {prints && !prints.length && (
            <EmptyCard icon="🖨️" text="Aucune impression n'a encore utilisé une bobine de ce filament."/>
          )}
          {prints && prints.length > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
              {tiles.map(t => {
                if (t.kind === "group") {
                  const cover = t.photos[0] || t.image;
                  return (
                    <div key={t.key} className="card-sm" style={tileSt("#8B5CF6")}
                      onClick={() => setGroupOpen(t.g)}>
                      <div style={{ position:"relative", aspectRatio:"1", background:"var(--surface2)" }}>
                        <img src={cover} alt="" loading="lazy" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}
                          onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>
                        <span style={{ position:"absolute", top:6, left:6, fontSize:9.5, fontWeight:900, padding:"2px 8px",
                          borderRadius:20, color:"white", background:"linear-gradient(135deg, #8B5CF6, #A855F7)" }}>
                          📁 Groupe · {t.members.length} prints
                        </span>
                        {t.photos.length > 0 && (
                          <span data-tip="Photos du groupe" style={{ ...glassChip, top:6, right:6 }}>📷 {t.photos.length}</span>
                        )}
                      </div>
                      <div style={{ padding:"7px 9px 9px" }}>
                        <p title={t.g.name} style={{ margin:0, fontSize:12, fontWeight:800, color:"var(--text)",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.g.name}</p>
                        <p style={{ margin:"2px 0 0", fontSize:10.5, fontWeight:700, color:"var(--muted)" }}>
                          {fmtDate(t.date)} · <span style={{ color:"#F59E0B" }}>{t.grams} g</span>
                        </p>
                      </div>
                    </div>
                  );
                }
                const p = t.p;
                const [stLabel, stColor] = STATUS[p.status] || [p.status, "#94a3b8"];
                const cover = p.photos[0] || p.image;
                return (
                  <div key={p.id} className="card-sm" style={tileSt(stColor)}
                    onClick={() => openDetail(p.id)}>
                    <div style={{ position:"relative", aspectRatio:"1", background:"var(--surface2)" }}>
                      <img src={cover} alt="" loading="lazy" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}
                        onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>
                      {p.photos.length > 0 && (
                        <span data-tip={p.photo_source === "group"
                            ? "Pas de photo pour cette impression : photos de son groupe"
                            : "Photos prises de cette impression"}
                          style={{ ...glassChip, top:6, right:6 }}>
                          📷 {p.photos.length}{p.photo_source === "group" ? " groupe" : ""}
                        </span>
                      )}
                      <span style={{ position:"absolute", top:6, left:6, fontSize:9.5, fontWeight:900, padding:"2px 8px",
                        borderRadius:20, color:"white", background:`linear-gradient(135deg, ${stColor}, color-mix(in srgb, ${stColor} 70%, #ffffff))` }}>{stLabel}</span>
                    </div>
                    <div style={{ padding:"7px 9px 9px" }}>
                      <p title={p.name} style={{ margin:0, fontSize:12, fontWeight:800, color:"var(--text)",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</p>
                      <p style={{ margin:"2px 0 0", fontSize:10.5, fontWeight:700, color:"var(--muted)" }}>
                        {fmtDate(p.print_date)} · <span style={{ color:"#F59E0B" }}>{p.grams} g</span>{p.group_name ? ` · ${p.group_name}` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </>)}
        </div>
      </div>

      {groupOpen && (
        <div onClick={e => e.stopPropagation()}>
          <GroupBottomSheet groupId={groupOpen.id} name={groupOpen.name} prints={[]}
            number_of_items={groupOpen.number_of_items || 1} cover_print_id={groupOpen.cover_print_id}
            onClose={() => setGroupOpen(null)}
            onSelectPrint={() => {}}
            onDelete={() => { setGroupOpen(null); load(); }}
            onUngroup={() => { setGroupOpen(null); load(); }}
            onUpdated={load}/>
        </div>
      )}
      {detail && (
        <div onClick={e => e.stopPropagation()}>
          <PrintDetail p={detail} onClose={() => setDetail(null)}
            onDelete={() => { setDetail(null); load(); }}
            onChanged={load}/>
        </div>
      )}
    </div>,
    document.body
  );
}

function FilamentsView() {
  const isAdmin = useIsAdmin();
  const [addFor, setAddFor] = useState(null);
  const filMenu = f => ({
    title: f.translated_name || f.name || `Filament #${f.id}`,
    subtitle: [f.manufacturer, f.fila_type || f.material].filter(Boolean).join(" · ") || null,
    color: paleHex(f.color) ? "#94a3b8" : (hexToCss(f.color) || "#8B5CF6"),
    items: [
      { icon: "📄", label: "Ouvrir", tone: "#3B82F6", onClick: () => setSelectedFil(f) },
      isAdmin && { icon: "＋", label: "Ajouter une bobine", tone: "#22C55E", onClick: () => setAddFor(f.id) },
    ],
  });
  const [allFilaments, setAllFilaments] = useState(() => _KEEP.lists.filaments || []);
  const [q, setQ] = useState(() => _kept("fil:q", ""));
  const [loading, setLoading] = useState(() => !_KEEP.lists.filaments);
  const [selectedFil, setSelectedFil] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState(() => _kept("fil:f", { brand:[], mat:[], sub:[] }));
  const [sort, setSort] = useState(() => _kept("fil:s", "name"));
  useEffect(() => { _KEEP.ui["fil:q"] = q; _KEEP.ui["fil:f"] = filters; _KEEP.ui["fil:s"] = sort; }, [q, filters, sort]);

  const FAMILIES_F = ["PLA","PETG","ABS","ASA","PA","PC","TPU","PVA","PLA-CF","PETG-CF","PA-CF","PPS"];
  const getFamilyF = f => {
    const sub = f.fila_type || f.material || "";
    return FAMILIES_F.find(m => sub === m || sub.startsWith(m+" ") || sub.startsWith(m+"-")) || sub.split(/[\s-]/)[0] || "";
  };

  const load = useCallback(async () => {
    if (!_KEEP.lists.filaments) setLoading(true);
    try {
      const { data } = await client.get("/filaments/filaments");
      _KEEP.lists.filaments = data;
      setAllFilaments(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // la fiche renvoie le filament a jour : on le remplace dans la liste, sans tout relire
  const onFilUpdated = useCallback(u => {
    if (!u?.id) { load(); return; }
    setAllFilaments(l => { const n = l.map(x => x.id === u.id ? u : x); _KEEP.lists.filaments = n; return n; });
    setSelectedFil(s => (s && s.id === u.id ? u : s));
  }, [load]);

  const filaments = useMemo(() => {
    let res = allFilaments;
    if (q) {
      const ql = q.toLowerCase();
      const words = ql.split(/\s+/).filter(Boolean);   // mot par mot, dans tous les champs
      res = res.filter(f => { const hay = [f.translated_name,f.name,f.manufacturer,f.material,f.fila_type,f.fila_color_code,f.color,String(f.id)].filter(Boolean).join(" ").toLowerCase();
        return words.every(w => hay.includes(w)); });
    }
    if (filters.brand?.length) res = res.filter(f => filters.brand.includes(itemBrand(f)));
    if (filters.mat?.length)   res = res.filter(f => filters.mat.includes(getFamilyF(f)));
    if (filters.sub?.length)   res = res.filter(f => filters.sub.includes(itemSub(f)));
    return [...res].sort((a,b) => {
      // Manquait ici : "Teinte" figurait dans la liste des tris mais aucune
      // branche ne le traitait, le tri retombait donc silencieusement sur le
      // nom. Le choix semblait sans effet.
      if (sort==="hue")       return compareHue(a.color, b.color);
      if (sort==="brand")     return (a.manufacturer||"").localeCompare(b.manufacturer||"");
      if (sort==="remaining") return (b.remaining_weight_total_g||0)-(a.remaining_weight_total_g||0);
      if (sort==="fullest")   return (a.remaining_weight_total_g||0)-(b.remaining_weight_total_g||0);
      return (a.translated_name||a.name||"").localeCompare(b.translated_name||b.name||"");
    });
  }, [allFilaments, q, filters, sort]);

  const activeFilters = (filters.brand?.length||0) + (filters.mat?.length||0) + (filters.sub?.length||0)
    + (filters.stock && filters.stock !== "all" ? 1 : 0);

  const kpis = useMemo(() => {
    const marques = new Set(filaments.map(f => f.manufacturer).filter(Boolean)).size;
    const types   = new Set(filaments.map(f => f.fila_type || f.material).filter(Boolean)).size;
    const aCommander = filaments.filter(f => f.to_order).length;
    const avecBobines = filaments.filter(f => (f.active_spool_count || 0) > 0).length;
    return [
      { label:"références",  value: filaments.length, accent:"#3b82f6" },
      { label:"marques",     value: marques || null,  accent:"#8b5cf6" },
      { label:"types",       value: types || null,    accent:"#06b6d4" },
      { label:"en stock",    value: avecBobines || null, accent:"#22c55e" },
      ...(aCommander > 0 ? [{ label:"à commander", value: aCommander, accent:"#f59e0b" }] : []),
    ];
  }, [filaments]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <KpiBar kpis={kpis} icons={KPI_ICON}/>
      <SearchRow q={q} setQ={setQ} placeholder="Nom, marque, code couleur…" active={activeFilters}
        onFilter={() => setFilterOpen(true)} addLabel="Filament" onAdd={() => setCreateOpen(true)}/>
      <FilterChips filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} defSort="name"/>
      {filterOpen && (
        <FilterSortSheet allItems={allFilaments} getFamily={getFamilyF} filters={filters} sort={sort}
          onApply={(f,s)=>{ setFilters(f); if(s) setSort(s); setFilterOpen(false); }}
          onClose={()=>setFilterOpen(false)}/>
      )}

      {loading ? (
        <p style={{ textAlign:"center", color:"var(--muted)", fontSize:13, padding:"32px 0" }}>Chargement…</p>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
          {filaments.map(f => <FilamentCard key={f.id} f={f} onClick={() => setSelectedFil(f)} menu={() => filMenu(f)}/>)}
          {!filaments.length && <div style={{ gridColumn:"1/-1" }}><EmptyCard icon="🎨" text="Aucun filament"/></div>}
        </div>
      )}
      {selectedFil && <FilamentSheet f={selectedFil} onClose={() => setSelectedFil(null)}
        onDeleted={() => { setSelectedFil(null); load(); }}
        onUpdated={onFilUpdated}/>}
      {createOpen && <FilamentCreateSheet onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }}/>}
      {addFor && <AddSpoolModal preselect={addFor} filaments={allFilaments} onSave={() => { setAddFor(null); load(); }} onClose={() => setAddFor(null)}/>}
    </div>
  );
}

// ── Création filament (saisie libre ou import catalogue Bambu) ─────────────
function FilamentCreateSheet({ onClose, onCreated, prefill = null }) {
  useTrackDetail("Filaments · Nouveau filament");
  // prefill: objet pré-rempli depuis le catalogue ou un tray MQTT
  const [mode, setMode] = useState(prefill ? "free" : "choose"); // "choose"|"catalog"|"free"
  const [saving, setSaving] = useState(false);

  // Catalogue Bambu
  const [families, setFamilies] = useState([]);
  const [typesByFamily, setTypesByFamily] = useState({});
  const [selectedFamily, setSelectedFamily] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [catalogQ, setCatalogQ] = useState("");
  const [catalogEntries, setCatalogEntries] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogEntry, setCatalogEntry] = useState(null); // entrée choisie

  // Formulaire libre
  const [form, setForm] = useState(prefill || {
    name:"", manufacturer:"", material:"PLA Basic",
    colors_input:"", multicolor_type:"monochrome",
    fila_type:"", profile_id:"", fila_color_code:"", weight:1000,
    translated_name:"",
  });
  const iStyle = { width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
    borderRadius:8, padding:"8px 10px", fontSize:13, color:"var(--text)", outline:"none", boxSizing:"border-box" };
  const lStyle = { fontSize:12, fontWeight:800, color:"var(--muted)", margin:"0 0 5px", display:"block" };

  // Parse colors_input → color + colors_array + multicolor_type
  const parseColorsInput = (raw, currentType) => {
    const parts = (raw||"").split(",").map(c=>c.trim().replace(/^#/,"")).filter(c=>c.length>=6);
    if (parts.length === 0) return { color: null, colors_array: null, multicolor_type: "monochrome" };
    if (parts.length === 1) return { color: parts[0], colors_array: null, multicolor_type: "monochrome" };
    return {
      color: parts[0],
      colors_array: parts.map(c=>`#${c}`).join(","),
      multicolor_type: currentType !== "monochrome" ? currentType : "coaxial",
    };
  };

  const liveColors = (form.colors_input||"").split(",")
    .map(c=>c.trim().replace(/^#/,"")).filter(c=>c.length>=6)
    .map(c=>hexToCss(c)).filter(Boolean);

  // Charger les familles/types catalogue
  useEffect(() => {
    if (mode !== "catalog") return;
    client.get("/filaments/catalog/types").then(({ data }) => {
      setFamilies(data.families || []);
      setTypesByFamily(data.types || {});
    }).catch(() => {});
  }, [mode]);

  // Chercher dans le catalogue, un quart de seconde apres la derniere frappe (28/10/2026 : un appel par frappe)
  const [catalogDq, setCatalogDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setCatalogDq(catalogQ), 250); return () => clearTimeout(t); }, [catalogQ]);
  useEffect(() => {
    if (mode !== "catalog") return;
    setCatalogLoading(true);
    const params = {};
    if (selectedFamily) params.family = selectedFamily;
    if (selectedType) params.fila_type = selectedType;
    if (catalogDq.trim()) params.q = catalogDq.trim();
    params.lang = "fr";
    client.get("/filaments/catalog/search", { params })
      .then(({ data }) => {
        setCatalogEntries(data.entries || []);
        if (!data.available) setCatalogEntries([]);
      })
      .catch(() => setCatalogEntries([]))
      .finally(() => setCatalogLoading(false));
  }, [mode, selectedFamily, selectedType, catalogDq]);

  // Helper : affiche la couleur selon le type (gradient / coaxial / mono)
  const colorSwatch = (e, size=28) => {
    const cols = (e.colors || []).map(c => `#${c}`);
    let bg;
    if (e.color_type_fr === "gradient" && cols.length > 1) {
      bg = `linear-gradient(135deg, ${cols.join(",")})`;
    } else if (e.color_type_fr === "coaxial" && cols.length > 1) {
      const pct = 100 / cols.length;
      bg = `linear-gradient(90deg, ${cols.map((c,i)=>`${c} ${i*pct}%, ${c} ${(i+1)*pct}%`).join(",")})`;
    } else {
      bg = `#${e.color_hex || "888"}`;
    }
    return <div style={{ width:size, height:size, borderRadius:Math.round(size*0.22), flexShrink:0, background:bg }}/>;
  };

  const pickFromCatalog = (entry) => {
    setCatalogEntry(entry);
    // Construire colors_input : si multi → toutes les couleurs CSV, si mono → juste la première
    const colorsInput = entry.colors?.length > 1
      ? entry.colors.join(", ")   // ex: "0047bb, bb22a3"
      : (entry.color_hex || "");
    setForm({
      name:            entry.name,
      manufacturer:    "Bambu Lab",
      material:        entry.fila_type,
      fila_type:       entry.fila_type,
      translated_name: entry.name_fr || "",
      colors_input:    colorsInput,
      multicolor_type: entry.color_type_fr || "monochrome",
      profile_id:      entry.fila_id,
      fila_color_code: entry.fila_color_code || "",
      weight:          1000,
    });
    setMode("free");
  };

  const [duplicate, setDuplicate] = useState(null);

  const save = async () => {
    const { color: col, colors_array: ca, multicolor_type: mct } = parseColorsInput(form.colors_input, form.multicolor_type);
    setSaving(true); setDuplicate(null);
    try {
      await client.post("/filaments/filaments", {
        name:              form.name || "Sans nom",
        name_en:           form.name || undefined,
        translated_name:   form.translated_name || undefined,
        manufacturer:      form.manufacturer || undefined,
        material:          form.fila_type || form.material || "PLA",
        fila_type:         form.fila_type || undefined,
        color:             col || undefined,
        colors_array:      ca ?? null,
        multicolor_type:   mct,
        fila_finish:       form.fila_finish && form.fila_finish !== (autoFinishOf(form) || "none") ? form.fila_finish : undefined,
        profile_id:        form.profile_id || undefined,
        fila_color_code:   form.fila_color_code || undefined,
        filament_weight_g: Number(form.weight) || 1000,
      });
      onCreated();
    } catch(e) {
      if (e.response?.status === 409) {
        const d = e.response.data?.detail || {};
        setDuplicate({ id: d.existing_id, name: d.existing_name, message: d.message });
      } else { showAlert(e.response?.data?.detail || e.message); }
    } finally { setSaving(false); }
  };

  const types = selectedFamily ? (typesByFamily[selectedFamily] || []) : Object.values(typesByFamily).flat();

  // l'apercu : la bobine aux couleurs saisies
  const heroCols = liveColors.length ? liveColors : null;
  const heroMain = liveColors.length && !paleHex(liveColors[0]) ? liveColors[0] : "#8B5CF6";
  const field = { ...iStyle, height:42, padding:"0 12px", borderRadius:12, background:"var(--surface)", fontWeight:700, fontSize:14 };
  const F = (label, k, ph = "", extra = {}) => (
    <div style={{ marginTop:8 }}>
      <label style={lStyle}>{label}</label>
      <input style={{ ...field, ...extra }} value={form[k] || ""} placeholder={ph}
        onChange={e => setForm(f => ({...f, [k]: e.target.value}))}/>
    </div>);

  return (
    <FSheet onClose={onClose} z={1200}
      bottom={mode === "free" ? <>
        {!prefill && (
          <button onClick={() => { setMode("choose"); setCatalogEntry(null); }} style={{ ...fBtn, flex:1, color:"var(--muted)" }}>← Retour</button>
        )}
        <button onClick={save} disabled={saving}
          style={{ ...fBtn, flex:2, border:"none", color:"#fff", background: saving ? "var(--border)" : "linear-gradient(135deg, #8B5CF6, #6366F1)",
            boxShadow:"0 8px 18px -10px #8B5CF6" }}>
          {saving ? "Création…" : "✓ Créer le filament"}
        </button>
      </> : mode === "catalog" ? <button onClick={() => setMode("choose")} style={{ ...fBtn, flex:1, color:"var(--muted)" }}>← Retour</button> : null}>
      {/* en-tete : la bobine aux couleurs saisies, le nom au fur et a mesure */}
      <div style={{ padding:"44px 16px 16px", display:"flex", alignItems:"center", gap:14,
        background:`radial-gradient(circle at 15% 50%, ${heroMain}50, transparent 60%), linear-gradient(135deg, ${heroMain}22, transparent 70%), var(--surface2)` }}>
        <span style={{ display:"inline-flex", flexShrink:0, filter:`drop-shadow(0 6px 14px ${heroMain}66)` }}>
          {heroCols ? <SpoolSVG colors={heroCols} size={74} type={liveColors.length > 1 ? (form.multicolor_type !== "monochrome" ? form.multicolor_type : "coaxial") : undefined}/>
            : <span style={{ width:74, height:74, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30,
                border:"2px dashed var(--border)", color:"var(--muted)" }}>🎨</span>}</span>
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ fontSize:10.5, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#8B5CF6" }}>＋ Nouveau filament</div>
          <div style={{ fontSize:19, fontWeight:900, color:"var(--text)", lineHeight:1.2, overflowWrap:"anywhere" }}>
            {mode === "free" ? (form.translated_name || form.name || "Sans nom") : mode === "catalog" ? "Catalogue Bambu" : "D'où vient-il ?"}</div>
          {mode === "free" && (form.manufacturer || form.fila_type) && <div style={{ fontSize:12.5, fontWeight:700, color:"var(--text2)" }}>
            {[form.manufacturer, form.fila_type].filter(Boolean).join(" · ")}</div>}
        </div>
      </div>

      <div style={{ padding:"12px 14px 18px", display:"flex", flexDirection:"column", gap:12 }}>
          {mode === "choose" && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[["catalog", "📦", "Importer depuis le catalogue Bambu", "Type → Couleur → Préremplissage automatique (nom officiel, hex, profil…)", "#22C55E"],
                ["free", "✏️", "Saisie libre", "Remplir manuellement tous les champs", "#8B5CF6"]].map(([m, ic, t, d, c]) => (
                <button key={m} onClick={() => setMode(m)}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 14px", borderRadius:18, cursor:"pointer", textAlign:"left",
                    border:`1px solid ${c}55`, background:`linear-gradient(135deg, ${c}1f, transparent 60%), var(--surface2)`, boxShadow:`0 10px 22px -16px ${c}` }}>
                  <span style={{ width:44, height:44, borderRadius:14, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22,
                    background:`linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` }}>{ic}</span>
                  <span style={{ flex:1, minWidth:0 }}>
                    <span style={{ display:"block", fontSize:14.5, fontWeight:900, color:"var(--text)" }}>{t}</span>
                    <span style={{ display:"block", fontSize:12, fontWeight:600, color:"var(--muted)", marginTop:2 }}>{d}</span>
                  </span>
                  <span style={{ color:c, fontWeight:900 }}>›</span>
                </button>
              ))}
            </div>
          )}

          {mode === "catalog" && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                <Select value={selectedFamily} onChange={e => { setSelectedFamily(e.target.value); setSelectedType(""); }}
                  style={{ ...field, flex:1, minWidth:120 }}
                  options={[{ value:"", label:"Toutes familles" },
                            ...families.map(f => ({ value:f, label:f }))]}/>
                <Select value={selectedType} onChange={e => setSelectedType(e.target.value)}
                  style={{ ...field, flex:1, minWidth:140 }}
                  options={[{ value:"", label:"Tous types" },
                            ...types.map(t => ({ value:t, label:t }))]}/>
              </div>
              <div style={{ position:"relative" }}>
                <Search size={15} style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
                <input value={catalogQ} onChange={e => setCatalogQ(e.target.value)}
                  placeholder="Rechercher une couleur (Jade White, Orange…)"
                  style={{ ...field, height:40, borderRadius:20, padding:"0 14px 0 38px", fontWeight:600, fontSize:13 }}/>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {catalogLoading && <p style={{ color:"var(--muted)", fontSize:12.5, fontWeight:700 }}>Recherche…</p>}
                {!catalogLoading && catalogEntries.length === 0 &&
                  <p style={{ color:"var(--muted)", fontSize:12.5, fontWeight:700 }}>
                    {families.length === 0 ? "Catalogue non disponible (démarrage en cours…)" : "Aucun résultat"}
                  </p>}
                {catalogEntries.map((e,i) => (
                  <button key={i} onClick={() => pickFromCatalog(e)}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 12px",
                      borderRadius:14, border:"1px solid var(--border)", background:`linear-gradient(135deg, #${e.color_hex || "888888"}22, transparent 55%), var(--surface2)`,
                      cursor:"pointer", textAlign:"left" }}>
                    <span style={{ borderRadius:9, boxShadow:"inset 0 0 0 1px rgba(0,0,0,0.25)", display:"inline-flex" }}>{colorSwatch(e, 34)}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:1 }}>
                        <p style={{ fontSize:13.5, fontWeight:800, color:"var(--text)", margin:0,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.name}</p>
                        {e.color_type_fr && e.color_type_fr !== "monochrome" && (
                          <span style={{ fontSize:9, padding:"1px 6px", borderRadius:20, flexShrink:0,
                            background: e.color_type_fr==="gradient" ? "rgba(139,92,246,0.15)" : "rgba(59,130,246,0.15)",
                            color: e.color_type_fr==="gradient" ? "#8b5cf6" : "#3b82f6",
                            fontWeight:800, textTransform:"uppercase" }}>
                            {e.color_type_fr}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize:11, fontWeight:600, color:"var(--muted)", margin:0 }}>
                        {e.fila_type} · <span style={{ fontFamily:"monospace" }}>{e.fila_color_code}</span>
                      </p>
                    </div>
                    <span style={{ fontSize:14, color:"#22C55E", fontWeight:900, flexShrink:0 }}>›</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "free" && (
            <>
              {catalogEntry && (
                <div style={{ padding:"9px 12px", borderRadius:14, fontSize:12, fontWeight:800, color:"#16a34a",
                  background:"rgba(34,197,94,0.10)", border:"1px solid rgba(34,197,94,0.3)" }}>
                  📦 Pré-rempli depuis le catalogue Bambu · {catalogEntry.fila_type} · {catalogEntry.color_code}
                </div>
              )}
              <FCard t="Identité" i="🏷️" c="#8B5CF6">
                <div style={{ marginTop:4 }}>
                  <label style={lStyle}>Nom de la couleur * (anglais / officiel)</label>
                  <input style={field} value={form.name} autoFocus placeholder="ex: Jade White"
                    onChange={e => setForm(f => ({...f, name: e.target.value}))}/>
                </div>
                {F("Nom traduit (français)", "translated_name", "ex: Blanc Jade")}
                {F("Marque", "manufacturer")}
                {F("Sous-type filament (ex: PLA Basic, PLA Matte…)", "fila_type", "ex: PLA Basic")}
              </FCard>
              <FCard t="Couleur" i="🎨" c="#EC4899">
                <div style={{ marginTop:4 }}>
                  <label style={lStyle}>Couleur(s) — hex séparées par virgule si multi</label>
                  <input style={{ ...field, fontFamily:"JetBrains Mono,monospace" }} value={form.colors_input || ""}
                    placeholder="ex: 0047bb  ou  0047bb, bb22a3"
                    onChange={e => setForm(f => ({...f, colors_input: e.target.value}))}/>
                  {liveColors.length > 0 && (
                    <div style={{ display:"flex", gap:5, marginTop:8, alignItems:"center" }}>
                      {liveColors.map((c,i) => (
                        <div key={i} style={{ width:28, height:28, borderRadius:8,
                          overflow:"hidden", boxShadow:"inset 0 0 0 1px rgba(0,0,0,0.25)", ...colorBg([c], null, null, { size: 28 }) }}/>
                      ))}
                      {liveColors.length === 1
                        ? <span style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)", marginLeft:4 }}>Monochrome</span>
                        : <span style={{ fontSize:11.5, color:"#EC4899", marginLeft:4, fontWeight:800 }}>
                            {liveColors.length} couleurs → {form.multicolor_type !== "monochrome" ? form.multicolor_type : "coaxial"}
                          </span>
                      }
                    </div>
                  )}
                </div>
                {liveColors.length > 1 && (
                  <div style={{ marginTop:8 }}>
                    <label style={lStyle}>Type multicolore</label>
                    <Select style={field} value={form.multicolor_type === "monochrome" ? "coaxial" : form.multicolor_type}
                      onChange={e => setForm(f => ({...f, multicolor_type: e.target.value}))}
                      options={[{ value:"gradient", label:"Gradient (dégradé)" },
                                { value:"coaxial",  label:"Coaxial (segments)" }]}/>
                  </div>
                )}
                <div style={{ marginTop:8 }}>
                  <FinishPicker value={form.fila_finish || autoFinishOf(form) || "none"} auto={autoFinishOf(form)} colors={liveColors}
                    style={field} lStyle={lStyle} onChange={v => setForm(p => ({ ...p, fila_finish: v }))}/></div>
              </FCard>
              <FCard t="Côté Bambu et poids" i="⚖" c="#0EA5E9">
                {F("Profile ID Bambu (ex: GFA00)", "profile_id", "", { fontFamily:"JetBrains Mono,monospace" })}
                {F("Code couleur Bambu (ex: 10600)", "fila_color_code", "", { fontFamily:"JetBrains Mono,monospace" })}
                <div style={{ marginTop:8 }}>
                  <label style={lStyle}>Poids total (g)</label>
                  <input style={field} type="number" value={form.weight}
                    onChange={e => setForm(f => ({...f, weight: e.target.value}))}/>
                </div>
              </FCard>
              {duplicate && (
                <div style={{ padding:"10px 14px", borderRadius:14,
                  background:"rgba(245,158,11,0.10)", border:"1px solid rgba(245,158,11,0.4)" }}>
                  <p style={{ fontSize:12.5, color:"#d97706", fontWeight:900, margin:"0 0 4px" }}>
                    ⚠ Filament identique déjà en base
                  </p>
                  <p style={{ fontSize:12, fontWeight:600, color:"var(--muted)", margin:0 }}>
                    {duplicate.message || `Filament #${duplicate.id} « ${duplicate.name} »`}
                  </p>
                </div>
              )}
            </>
          )}
      </div>
    </FSheet>
  );
}

// ── Page principale ────────────────────────────────────────────────────────
function hexToHsl(hex) {
  const h = (hex||"").replace(/^#/,"").toLowerCase().slice(0,6);
  if (h.length < 6) return [0,0,100];
  const r=parseInt(h.slice(0,2),16)/255, g=parseInt(h.slice(2,4),16)/255, b=parseInt(h.slice(4,6),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), l=(max+min)/2;
  if (max===min) return [0,0,Math.round(l*100)];
  const d=max-min, s=l>0.5?d/(2-max-min):d/(max+min);
  const hue = max===r?((g-b)/d+(g<b?6:0)):max===g?((b-r)/d+2):((r-g)/d+4);
  return [Math.round(hue*60), Math.round(s*100), Math.round(l*100)];
}

/**
 * Comparateur du tri "Teinte", partagé par les bobines, le nuancier et la
 * galerie — il en existait deux copies quasi identiques.
 *
 * Trois corrections par rapport à la version d'origine :
 *
 *  1. Les NEUTRES formaient trois groupes incohérents : les gris, puis le
 *     blanc, puis le noir. Le blanc arrivait donc APRÈS le gris foncé. Ils
 *     forment maintenant un seul bloc en fin de liste, en rampe de clarté du
 *     blanc au noir, ce que l'œil attend.
 *  2. Aucun tri SECONDAIRE : tous les rouges partageaient la même clé, leur
 *     ordre relatif était donc celui du hasard. À teinte égale on va désormais
 *     du plus clair au plus foncé, comme sur un nuancier imprimé.
 *  3. Les teintes sont regroupées par paliers de 12°, sinon deux rouges
 *     imperceptiblement différents se retrouvaient séparés par leur clarté.
 *
 * La coupure rouge / magenta est conservée volontairement : c'est l'ordre
 * conventionnel d'un arc-en-ciel (rouge, orange, jaune, vert, bleu, violet,
 * rose) et le déplacer surprendrait plus qu'il n'aiderait.
 */
const _HUE_KEYS = new Map();   // quelques centaines de couleurs au plus : la conversion ne se refait pas a chaque comparaison
function hueSortKey(hex) {
  const hit = _HUE_KEYS.get(hex);
  if (hit) return hit;
  const k = _hueSortKey(hex);
  _HUE_KEYS.set(hex, k);
  return k;
}
function _hueSortKey(hex) {
  const [h, s, l] = hexToHsl(hex);
  // s est en 0-100 ici. En dessous de 12 la teinte n'est plus perceptible et
  // devient instable : un gris très légèrement chaud tomberait au milieu des
  // oranges.
  if (s < 12) return [1, 0, -l];
  return [0, Math.round(h / 12), -l];
}

function compareHue(a, b) {
  const ka = hueSortKey(a), kb = hueSortKey(b);
  return (ka[0]-kb[0]) || (ka[1]-kb[1]) || (ka[2]-kb[2]);
}

function SwatchView({ filaments: allFilaments, sort, selectMode, onSelectModeChange, onItemClick, onReload, preselect }) {
  // Filaments déjà filtrés ET triés par le parent



  return (
    <>
      <GalleryCompare
        items={allFilaments}
        selectMode={selectMode}
        onSelectModeChange={onSelectModeChange}
        preselect={preselect}
        onItemClick={onItemClick}
        getId={f => f.id}
        getTitle={f => f.translated_name || f.name}
        getSubtitle={f => [f.manufacturer, f.fila_type || f.material].filter(Boolean).join(" · ")}
        emptyLabel="Aucun filament"
        swatchMode={true}
        swatchInfo={true}
        getTone={f => {
          // Teinte claire -> voile clair et texte sombre (luminance percue).
          const hex = (parseColorsList(f.color, f.colors_array)?.[0] || "").replace("#", "");
          if (hex.length < 6) return "dark";
          const [r, g, b] = [0, 2, 4].map(k => parseInt(hex.slice(k, k + 2), 16));
          return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "light" : "dark";
        }}
        renderCover={f => {
          const colors = parseColorsList(f.color, f.colors_array);
          return <div style={{ width:"100%", height:"100%", ...colorBg(colors, f.multicolor_type, finishOf(f), { size: 140 }) }}/>;
        }}
        compareFields={[
          ["Matière",  f => f.material],
          ["Sous-type", f => f.fila_type || null],
          ["Marque",   f => f.manufacturer],
          ["Finition", f => { const x = FINISHES.find(([k]) => k === finishOf(f)); return x ? x[1] : null; }],
          ["Couleur",  f => f.color ? `#${f.color}` : null],
          ["Poids",    f => f.filament_weight_g ? `${f.filament_weight_g}g` : null],
          ["Prix",     f => isMoneyHidden() ? MONEY_MASK : (f.price ? `${f.price}€` : null)],
          ["Bobines",  f => `${f.active_spool_count} active${f.active_spool_count!==1?"s":""}/${f.spool_count}`],
        ]}
      />
    </>
  );
}


export function FilamentSheetFromSpool({ filamentId, spoolId, filamentColorHex, onClose }) {
  const [spool, setSpool] = React.useState(null);
  // bobine introuvable : la fiche de son filament (setFil n'existait pas, rien ne s'ouvrait)
  const [fil, setFil] = React.useState(null);
  React.useEffect(() => {
    const load = async () => {
      try {
        // La bobine par sa route (28/10/2026 : deux listes completes partaient pour la retrouver)
        if (spoolId) {
          try {
            const r = await client.get(`/filaments/spools/${spoolId}`);
            if (r.data?.id) { setSpool(r.data); return; }
          } catch { /* introuvable : la fiche de son filament, ci-dessous */ }
        }
        if (filamentId) {
          const r = await client.get("/filaments/filaments/" + filamentId);
          setFil(r.data); return;
        }
        if (filamentColorHex) {
          const hex = filamentColorHex.replace("#","");
          const r = await client.get("/filaments/filaments", { params:{ search: hex, limit:5 } });
          const list = r.data || [];
          const match = list.find(f => (f.color||"").toLowerCase().replace("#","") === hex.toLowerCase());
          if (match || list[0]) setFil(match || list[0]);
        }
      } catch {}
    };
    load();
  }, [spoolId, filamentColorHex]);
  if (!spool) return fil ? <FilamentSheet f={fil} onClose={onClose}/> : null;
  return <SpoolBottomSheet spool={spool} onClose={onClose} onArchive={onClose} onDelete={onClose}/>;
}

const GAL_DEF_SORT = "hue";     // la galerie se lit par teinte

export default function Filaments() {
  const [tab, setTab] = useUrlTab("tab", "spools", ["spools", "archived", "catalog", "gallery"]);
  const [searchParams, setSearchParams] = useSearchParams();
  useTrackDetail(`Filaments · ${ {spools:"Stock", archived:"Archivées",
    catalog:"Filaments", gallery:"Galerie"}[tab] || tab }`);
  const [deepFil, setDeepFil] = useState(null);   // fiche ouverte via /filaments?id=XXX
  const [deepErr, setDeepErr] = useState(null);
  const [galleryMode, setGalleryMode] = useState("photos");
  const [allFilaments, setAllFilaments] = useState([]);
  const [galQ, setGalQ] = useState("");
  const [galFilterOpen, setGalFilterOpen] = useState(false);
  const [galFilters, setGalFilters] = useState({ brand:[], mat:[], sub:[], stock:"all" });
  const [galSort, setGalSort] = useState(GAL_DEF_SORT);
  const [galSelectMode, setGalSelectMode] = useState(false);
  const [galPreselect, setGalPreselect] = useState(null);   // filament coche en arrivant de la vue Photos
  const [galSelected, setGalSelected] = useState(null);
  // Impressions par filament (badge des cartes de la galerie Photos), et le
  // filament dont la galerie d'impressions est ouverte.
  const [printCounts, setPrintCounts] = useState({});
  const [galPrintsOf, setGalPrintsOf] = useState(null);

  // Liens directs :
  //   /filaments?spool=YY[&id=XX] -> ouvre la fiche BOBINE (scan RFID, creation).
  //   /filaments?id=XX (sans spool) -> ouvre la fiche FILAMENT (scan QR d'un
  //     swatch, marque-page…).
  // La fiche bobine a la priorite : un scan de bobine doit montrer LA bobine, pas
  // son filament. On passe par l'API plutot que par la liste deja chargee : la
  // cible peut etre absente du filtre/onglet courant.
  const deepId    = searchParams.get("id");
  const deepSpool = searchParams.get("spool");
  const deepOrder = searchParams.get("order");     // une commande (mails) depuis une notification

  // ?swatch=1 dans l'URL = on arrive par le scan du QR d'un echantillon (le QR
  // imprime sur la planche encode ce parametre). Dans ce seul cas on coche la
  // case echantillon AVANT d'afficher : le POST renvoie la fiche a jour, donc
  // "Echantillon : Oui" est visible des l'ouverture, sans rechargement. Un lien
  // ordinaire vers la fiche (sans swatch=1) ne declenche rien.
  const deepSwatch = searchParams.get("swatch") === "1";
  useEffect(() => {
    // Fiche filament uniquement si on N'ouvre PAS une bobine.
    if (!deepId || deepSpool) { setDeepFil(null); setDeepErr(null); return; }
    let cancelled = false;
    const req = deepSwatch
      ? client.post(`/filaments/filaments/${deepId}/mark-swatch`)
      : client.get(`/filaments/filaments/${deepId}`);
    req
      .then(r => { if (!cancelled) { setDeepFil(r.data); setDeepErr(null); } })
      .catch(() => { if (!cancelled) { setDeepFil(null); setDeepErr(`#${deepId}`); } });
    return () => { cancelled = true; };
  }, [deepId, deepSpool, deepSwatch]);

  const closeDeep = () => {
    setDeepFil(null); setDeepErr(null);
    const next = new URLSearchParams(searchParams);
    next.delete("id"); next.delete("spool"); next.delete("swatch");
    setSearchParams(next, { replace: true });
  };

  // ── Scan RFID ────────────────────────────────────────────────────────────
  // L'application Android POSTe le tag au backend, qui repond par une URL :
  //   bobine connue   -> /filaments?id=..&spool=..   (fiche ouverte directement)
  //   bobine inconnue -> /filaments?rfid=<scan_id>   (creation guidee)
  const rfidId = searchParams.get("rfid");
  const closeRfid = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("rfid");
    setSearchParams(next, { replace: true });
  };
  // Écoute NFC continue via le shell WebView (absente en PWA pure). Le mode est
  // GLOBAL (store/rfidScan) : il s'active ici seulement, mais reste actif sur
  // les autres pages, et les scans y sont recus par RfidScanBridge (Layout),
  // qui ramene ici avec la fiche ouverte.
  const scan = useRfidScan();
  const friend = useFriend((st) => st.friend);   // chez un copain : pas de scan
  const rfidScan = { available: scan.available, listening: scan.listening,
    toggle: () => (scan.listening ? scan.stop() : scan.start()) };

  const onRfidCreated = (res) => {
    // On enchaine sur la fiche du filament fraichement cree.
    setSearchParams(
      keepTabs(searchParams, { id: String(res.filament_id), ...(res.spool_id ? { spool: String(res.spool_id) } : {}) }),
      { replace: true },
    );
    // Rafraichir la galerie : la nouvelle reference doit y apparaitre sans recharger.
    client.get("/filaments/filaments")
      .then(r => setAllFilaments(r.data || []))
      .catch(() => {});
  };

  // Scan : le QR encode l'ID, on passe par l'URL — le lien reste partageable et
  // le retour arriere referme naturellement la fiche.
  const [scanOpen, setScanOpen] = useState(false);
  const onScanned = (id) => {
    setScanOpen(false);
    // Ce scanner-ci est celui des ECHANTILLONS (les deux boutons qui l'ouvrent
    // disent "Scanner un echantillon") : tout ce qui en sort est donc, par
    // construction, le QR d'un echantillon. On ajoute swatch=1, ce qui fait
    // cocher la case avant l'ouverture de la fiche -- sans rien attendre de
    // l'app Android, l'information est deja connue ici.
    setSearchParams(keepTabs(searchParams, { id, swatch: "1" }), { replace: false });
  };

  const FAMILIES_G = ["PLA","PETG","ABS","ASA","PA","PC","TPU","PVA","PLA-CF","PETG-CF","PA-CF","PPS"];
  const getFamilyG = f => {
    const sub = f.fila_type || f.material || "";
    return FAMILIES_G.find(m => sub===m||sub.startsWith(m+" ")||sub.startsWith(m+"-")) || sub.split(/[\s-]/)[0] || "";
  };

  useEffect(() => {
    client.get("/filaments/filaments").then(({ data }) => setAllFilaments(data));
  }, []);

  // Filaments filtrés pour la galerie
  const filaments = useMemo(() => {
    let res = allFilaments;
    if (galQ) {
      const ql = galQ.toLowerCase();
      const words = ql.split(/\s+/).filter(Boolean);
      res = res.filter(f => { const hay = [f.translated_name,f.name,f.manufacturer,f.material,f.fila_type,f.fila_color_code,f.color].filter(Boolean).join(" ").toLowerCase();
        return words.every(w => hay.includes(w)); });
    }
    if (galFilters.brand?.length) res = res.filter(f => galFilters.brand.includes(itemBrand(f)));
    if (galFilters.mat?.length)   res = res.filter(f => galFilters.mat.includes(getFamilyG(f)));
    if (galFilters.sub?.length)   res = res.filter(f => galFilters.sub.includes(itemSub(f)));
    if (galFilters.stock === "instock")     res = res.filter(f => (f.active_spool_count||0) > 0);
    if (galFilters.stock === "unavailable") res = res.filter(f => !(f.active_spool_count > 0));
    // Tri
    res = [...res].sort((a,b) => {
      if (galSort === "hue") return compareHue(a.color, b.color);
      if (galSort === "name")     return (a.translated_name||a.name||"").localeCompare(b.translated_name||b.name||"");
      if (galSort === "brand")    return (a.manufacturer||"").localeCompare(b.manufacturer||"");
      if (galSort === "remaining") return (b.remaining_weight_total_g||0)-(a.remaining_weight_total_g||0);
      if (galSort === "fullest")   return (a.remaining_weight_total_g||0)-(b.remaining_weight_total_g||0);
      if (galSort === "recent")   return new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0);
      return 0;
    });
    return res;
  }, [allFilaments, galQ, galFilters, galSort]);

  const pcDone = useRef(false);
  useEffect(() => {
    if (tab !== "gallery" || pcDone.current) return;
    pcDone.current = true;
    client.get("/filaments/filaments/print-counts")
      .then(r => setPrintCounts(r.data || {})).catch(() => {});
  }, [tab]);

  const galActiveFilters = (galFilters.brand?.length||0) + (galFilters.mat?.length||0) + (galFilters.sub?.length||0)
    + (galFilters.stock && galFilters.stock !== "all" ? 1 : 0);

  const tabs = [
    { id:"spools",   label:"Stock",     ic:"🧵", c:"#3B82F6" },
    { id:"archived", label:"Archivées", ic:"🗄", c:"#64748B" },
    { id:"catalog",  label:"Filaments", ic:"🎨", c:"#8B5CF6" },
    { id:"gallery",  label:"Galerie",   ic:"🖼️", c:"#EC4899" },
  ];

  return (
    <div className="page-wide">
      {/* Mobile : le bouton part dans le header (une ligne de gagnee).
          Desktop : le header mobile n'existe pas, on le garde dans le flux. */}
      <HeaderAction>
        {/* Chez un copain : rien a scanner (ses bobines ne sont pas ici). */}
        {!friend && rfidScan.available && (
          <button onClick={rfidScan.toggle} aria-label="Scan RFID en continu"
            title={rfidScan.listening ? "Scan RFID actif" : "Scan RFID"}
            style={{ display:"flex", alignItems:"center", justifyContent:"center",
              width:34, height:34, borderRadius:"50%", border:"none", cursor:"pointer",
              background: rfidScan.listening ? "#22c55e" : "rgba(249,168,89,0.22)",
              color: rfidScan.listening ? "white" : "#e07b00",
              boxShadow: rfidScan.listening ? "0 0 0 3px rgba(34,197,94,0.25)" : "none",
              transition:"all 0.15s" }}>
            <Nfc size={17}/>
          </button>
        )}
        {!friend && <button onClick={() => setScanOpen(true)} aria-label="Scanner un échantillon" title="Scanner un échantillon"
          style={{ display:"flex", alignItems:"center", justifyContent:"center",
            width:34, height:34, borderRadius:"50%", border:"none", cursor:"pointer",
            background:"#3b82f6", color:"white" }}>
          <ScanLine size={17}/>
        </button>}
      </HeaderAction>

      <div className="hidden-mobile" style={{ display:"none", alignItems:"center",
        justifyContent:"flex-end", gap:10 }}>
        <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)",
          margin:0, marginRight:"auto" }}>Filaments</h1>
        {!friend && rfidScan.available && (
          <button onClick={rfidScan.toggle}
            aria-label="Scan RFID en continu" title={rfidScan.listening ? "Scan RFID actif" : "Scan RFID"}
            style={{ display:"flex", alignItems:"center", justifyContent:"center",
              width:38, height:38, borderRadius:"50%", border:"none", cursor:"pointer",
              background: rfidScan.listening ? "#22c55e" : "rgba(249,168,89,0.22)",
              color: rfidScan.listening ? "white" : "#e07b00",
              boxShadow: rfidScan.listening ? "0 0 0 3px rgba(34,197,94,0.25)" : "none",
              transition:"all 0.15s" }}>
            <Nfc size={18}/>
          </button>
        )}
        {!friend && <button onClick={() => setScanOpen(true)}
          aria-label="Scanner un échantillon" title="Scanner un échantillon"
          style={{ display:"flex", alignItems:"center", justifyContent:"center",
            width:38, height:38, borderRadius:"50%", border:"none", cursor:"pointer",
            background:"#3b82f6", color:"white" }}>
          <ScanLine size={18}/>
        </button>}
      </div>

      {/* Tabs */}
      <PageTabs tabs={tabs} tab={tab} setTab={setTab}/>

      {tab==="catalog" && <FilamentsView/>}
      {tab==="gallery" && (
        <>
          {/* Barre recherche + filtres partages Photos/Nuancier */}
          <SearchRow q={galQ} setQ={setGalQ} placeholder="Nom, marque, matériau…" active={galActiveFilters} onFilter={() => setGalFilterOpen(true)}/>
          <FilterChips filters={galFilters} setFilters={setGalFilters} sort={galSort} setSort={setGalSort} defSort={GAL_DEF_SORT}/>
          {galFilterOpen && (
            <FilterSortSheet allItems={allFilaments} getFamily={getFamilyG} filters={galFilters} sort={galSort}
              onApply={(f,s)=>{ setGalFilters(f); if(s) setGalSort(s); setGalFilterOpen(false); }}
              onClose={()=>setGalFilterOpen(false)}/>
          )}
          {/* Switch Photos / Nuancier + bouton Sélectionner */}
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <div style={{ display:"flex", gap:3, padding:3, borderRadius:14, background:"var(--surface2)", border:"1px solid var(--border)" }}>
              {[["photos","📷 Photos","#EC4899"],["swatch","🎨 Nuancier","#F59E0B"]].map(([id,label,c]) => (
                <button key={id} onClick={()=>{ setGalleryMode(id); setGalSelectMode(false); setGalPreselect(null); }} style={{
                  padding:"6px 12px", borderRadius:11, fontSize:12, fontWeight:800, cursor:"pointer", border:"none", whiteSpace:"nowrap",
                  background: galleryMode===id ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "transparent",
                  color: galleryMode===id ? "white" : "var(--muted)", boxShadow: galleryMode===id ? `0 6px 14px -6px ${c}` : "none",
                }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ marginLeft:"auto" }}>
              {galSelectMode ? (
                <button onClick={()=>{ setGalSelectMode(false); setGalPreselect(null); }}
                  style={{ height:34, padding:"0 13px", borderRadius:17, fontSize:12, fontWeight:800, border:"1px solid var(--border)",
                    background:"var(--surface2)", color:"var(--muted)", cursor:"pointer" }}>
                  Annuler
                </button>
              ) : (
                <button onClick={()=>{ setGalleryMode("swatch"); setGalSelectMode(true); }} data-tip="Choisir des filaments à comparer"
                  style={{ height:34, padding:"0 13px", borderRadius:17, fontSize:12, fontWeight:800, border:"1px solid rgba(59,130,246,0.35)",
                    background:"rgba(59,130,246,0.12)", color:"#3b82f6", cursor:"pointer" }}>
                  ☑ Comparer
                </button>
              )}
            </div>
          </div>

          {galleryMode==="photos" && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
              {filaments.map(f => {
                const n = printCounts[String(f.id)] || 0;
                // Appui long : comparer, dans le nuancier (la comparaison y vit), ce filament deja coche.
                return <FilamentCard key={f.id} f={f} onClick={() => setGalPrintsOf(f)}
                  onLong={() => { setGalPreselect([f]); setGalleryMode("swatch"); setGalSelectMode(true); }}
                  extra={n ? `${n} impression${n > 1 ? "s" : ""}` : "0 impression"}/>;
              })}
              {!filaments.length && <div style={{ gridColumn:"1/-1" }}><EmptyCard icon="🖼️" text="Aucun filament"/></div>}
            </div>
          )}
          {galPrintsOf && <FilamentPrintsSheet f={galPrintsOf} onClose={() => setGalPrintsOf(null)}/>}
          {galSelected && <FilamentSheet f={galSelected} onClose={()=>setGalSelected(null)} onDeleted={()=>{setGalSelected(null); client.get("/filaments/filaments").then(r=>setAllFilaments(r.data));}} onUpdated={()=>client.get("/filaments/filaments").then(r=>setAllFilaments(r.data))}/>}
          {galleryMode==="swatch" && <SwatchView filaments={filaments} sort={galSort} selectMode={galSelectMode} onSelectModeChange={v => { setGalSelectMode(v); if (!v) setGalPreselect(null); }}
            onItemClick={f=>setGalSelected(f)} preselect={galPreselect}
            onReload={() => client.get("/filaments/filaments").then(r => setAllFilaments(r.data || [])).catch(()=>{})}/>}
        </>
      )}
      {(tab==="spools" || tab==="archived") && (
        <SpoolsView filaments={filaments} showArchived={tab==="archived"}/>
      )}

      {scanOpen && <ScanSheet onDetect={onScanned} onClose={() => setScanOpen(false)}/>}

      {rfidId && (
        <RfidSheet scanId={rfidId} onClose={closeRfid} onCreated={onRfidCreated}/>
      )}

      {/* Fiche ouverte via lien direct ?id=XXX (scan QR ou URL) */}
      {deepFil && (
        <FilamentSheet f={deepFil} onClose={closeDeep}
          onDeleted={() => { closeDeep(); client.get("/filaments/filaments").then(({data}) => setAllFilaments(data)).catch(()=>{}); }}
          onUpdated={() => client.get(`/filaments/filaments/${deepId}`)
            .then(r => setDeepFil(r.data)).catch(()=>{})}/>
      )}
      {deepSpool && (
        <FilamentSheetFromSpool
          spoolId={Number(deepSpool)}
          filamentId={deepId ? Number(deepId) : undefined}
          onClose={closeDeep}/>
      )}
      {deepOrder && <OrderSheet id={Number(deepOrder)} onClose={() => { const n = new URLSearchParams(searchParams); n.delete("order"); setSearchParams(n, { replace: true }); }}/>}
      {deepErr && (
        <div style={{ padding:"12px 16px", borderRadius:10,
          background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)",
          color:"#ef4444", fontSize:13, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ flex:1 }}>Aucun filament {deepErr}.</span>
          <button onClick={closeDeep} style={{ background:"none", border:"none",
            color:"#ef4444", cursor:"pointer", fontWeight:700 }}>Fermer</button>
        </div>
      )}
      <HiddenMark egg="snail" e="🐌" side="left"/>
      <Cachettes spot="filaments"/>
    </div>
  );
}
