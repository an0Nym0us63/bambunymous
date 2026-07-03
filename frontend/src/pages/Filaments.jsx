import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Search, Archive, X, Save, RefreshCw } from "lucide-react";
import client from "../api/client";
import GalleryCompare from "../components/GalleryCompare";

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

function parseColorsList(color, colorsArray) {
  if (colorsArray) {
    const cols = colorsArray.split(",").map(c => c.trim()).filter(Boolean)
      .map(c => hexToCss(c)).filter(Boolean);
    if (cols.length > 1) return cols;
  }
  return color ? [hexToCss(color)].filter(Boolean) : null;
}
function colorBg(colors, type) {
  if (!colors?.length) return { backgroundColor: "var(--border)" };
  if (colors.length === 1) return { backgroundColor: colors[0] };
  if (type === "gradient") {
    // Fondu lisse entre les couleurs
    return { background: `linear-gradient(90deg, ${colors.join(", ")})` };
  }
  // Autres types (coaxial, etc.) : séparation nette
  const stops = colors.map((c,i) => {
    const a = Math.round(i/colors.length*100), b = Math.round((i+1)/colors.length*100);
    return `${c} ${a}%, ${c} ${b}%`;
  }).join(", ");
  return { background: `linear-gradient(90deg, ${stops})` };
}

// Détecte si une couleur hex 8 chars a de la transparence (alpha < FF)
function hasTransparency(hex) {
  const h = (hex||"").replace(/^#/,"").toLowerCase();
  if (h.length === 8) return parseInt(h.slice(6,8),16) < 255;
  return false;
}

// Swatch couleur avec damier visible si transparence
function ColorSwatch({ color, colorsArray, multicolorType, size=40, radius=10 }) {
  const colors = parseColorsList(color, colorsArray);
  const isTransparent = !colorsArray && hasTransparency(color);
  return (
    <div style={{ position:"relative", width:size, height:size, borderRadius:radius,
      flexShrink:0, overflow:"hidden", boxShadow:"inset 0 0 0 1px rgba(0,0,0,0.12)" }}>
      {isTransparent && (
        <div style={{ position:"absolute", inset:0,
          backgroundImage:"repeating-conic-gradient(#aaa 0% 25%, #eee 0% 50%)",
          backgroundSize:"8px 8px" }}/>
      )}
      <div style={{ position:"absolute", inset:0, ...colorBg(colors, multicolorType) }}/>
    </div>
  );
}

function ColorDot({ color, colorsArray, multicolorType, size=16 }) {
  return <ColorSwatch color={color} colorsArray={colorsArray} multicolorType={multicolorType}
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
function FilamentPhotos({ filamentId, onLightbox }) {
  const [photos, setPhotos] = React.useState([]);
  const [lightbox, setLightbox] = React.useState(null);

  React.useEffect(() => {
    if (!filamentId) return;
    client.get("/filaments/" + filamentId + "/photos")
      .then(r => setPhotos(r.data.files || []))
      .catch(() => {});
  }, [filamentId]);

  if (!photos.length) return null;

  return (
    <div style={{ marginBottom:16 }}>
      <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
        letterSpacing:"0.06em", marginBottom:8 }}>Photos</p>
      <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4 }}>
        {photos.map((f, i) => (
          <div key={i} onClick={() => onLightbox ? onLightbox(f.url) : setLightbox(f.url)}
            style={{ flexShrink:0, cursor:"pointer", borderRadius:8, overflow:"hidden",
              border:"1px solid var(--border)", width:90, height:90 }}>
            <img src={f.url} alt={f.name}
              style={{ width:"100%", height:"100%", objectFit:"cover" }}
              onError={e => { e.currentTarget.style.display="none"; }}/>
          </div>
        ))}
      </div>
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)",
            zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <img src={lightbox} alt=""
            style={{ maxWidth:"92vw", maxHeight:"92vh", borderRadius:12, objectFit:"contain" }}
            onClick={e => e.stopPropagation()}/>
        </div>
      )}
    </div>
  );
}


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
    } catch(e) { alert(e.response?.data?.detail || e.message); }
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

function PriceEditRow({ spoolId, current, onUpdated }) {
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
    } catch(e) { alert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
      <span style={{ fontSize:12, color:"var(--muted)", flexShrink:0 }}>Prix d'achat</span>
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
          <span style={{ fontSize:13, fontWeight:600, color:"var(--text)" }}>
            {current != null ? `${Number(current).toFixed(2)} €` : <span style={{color:"var(--muted)",fontWeight:400}}>—</span>}
          </span>
          <button onClick={() => { setVal(current != null ? String(Number(current).toFixed(2)) : ""); setEditing(true); }}
            style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)", padding:2 }}
            onMouseEnter={e=>e.currentTarget.style.color="#3b82f6"}
            onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
            ✏️
          </button>
        </div>
      )}
    </div>
  );
}

function SpoolBottomSheet({ spool, onClose, onArchive, onDelete }) {
  const [confirmDelete, setConfirmDelete] = React.useState(null); // null | {usage_count}
  const [deleting, setDeleting] = React.useState(false);

  const handleDelete = async (force = false) => {
    setDeleting(true);
    try {
      const r = await client.delete(`/filaments/spools/${spool.id}/permanent`, { params: { force } });
      if (r.data.confirm_required) {
        setConfirmDelete({ usage_count: r.data.usage_count, message: r.data.message });
        return;
      }
      onDelete?.();
      onClose();
    } catch(e) { alert(e.response?.data?.detail || e.message); }
    finally { setDeleting(false); }
  };
  if (!spool) return null;
  const color = hexDisplay(spool.filament_color);
  const colorsList = parseColorsList(spool.filament_color, spool.filament_colors_array);
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
        style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
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
              overflow:"hidden", boxShadow:"0 2px 14px rgba(0,0,0,0.25), inset 0 0 0 2px var(--border)", ...colorBg(colorsList, spool.filament_multicolor_type) }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:20, fontWeight:800, color:"var(--text)", margin:0,
                letterSpacing:"-0.01em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {spool.filament_translated_name || spool.filament_name}
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

          {/* Photos du filament */}
          <FilamentPhotos filamentId={spool.filament_id} />

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

          {/* ── Bobine physique ── */}
          <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:"0.08em", marginBottom:4 }}>Bobine #{spool.id}</p>
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:8 }}>
            <WeightAdjustInline spoolId={spool.id} current={remaining} onUpdated={onClose}/>
          </div>
          <PriceEditRow spoolId={spool.id} current={spool.price_override} onUpdated={onClose}/>
          <Row label="Emplacement"    value={spool.location}/>
          <Row label="Tag NFC"        value={spool.tag_number} mono/>
          <Row label="Tray AMS"       value={spool.ams_tray}/>
          <Row label="Première util." value={spool.first_used_at?.slice(0,10)}/>
          <Row label="Dernière util." value={spool.last_used_at?.slice(0,10)}/>
          <Row label="Commentaire"    value={spool.comment}/>

          {/* ── Filament (catalogue) ── */}
          <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:"0.08em", margin:"16px 0 4px" }}>Filament (catalogue)</p>
          <Row label="Nom"            value={spool.filament_translated_name || spool.filament_name}/>
          {spool.filament_translated_name && spool.filament_name !== spool.filament_translated_name &&
            <Row label="Nom EN"       value={spool.filament_name}/>}
          <Row label="Marque"         value={spool.filament_manufacturer}/>
          <Row label="Matière"        value={spool.filament_material}/>
          <Row label="Couleur"        value={color} mono/>
          {spool.filament_profile_id && <Row label="Code Bambu" value={spool.filament_profile_id} mono/>}
          <Row label="Poids total"    value={spool.filament_weight_g ? `${spool.filament_weight_g}g` : null}/>
          <Row label="Prix catalogue" value={spool.filament_price ? `${Number(spool.filament_price).toFixed(2)}€` : null}/>


          {/* Actions */}
          <div style={{ display:"flex", gap:8, marginTop:20, flexWrap:"wrap" }}>
            {!spool.archived && (
              <button onClick={async()=>{ await onArchive(spool.id); onClose(); }}
                style={{ flex:1, padding:"10px", background:"var(--surface2)",
                  border:"1px solid var(--border)", borderRadius:10, cursor:"pointer",
                  color:"var(--muted)", fontSize:13, display:"flex",
                  alignItems:"center", justifyContent:"center", gap:6 }}>
                <Archive size={14}/> Archiver
              </button>
            )}
            <button onClick={() => handleDelete(false)} disabled={deleting}
              style={{ flex:1, padding:"10px", background:"rgba(239,68,68,0.08)",
                border:"1px solid rgba(239,68,68,0.3)", borderRadius:10, cursor:"pointer",
                color:"#ef4444", fontSize:13, display:"flex",
                alignItems:"center", justifyContent:"center", gap:6 }}>
              🗑 Supprimer
            </button>
            <button onClick={onClose}
              style={{ flex:1, padding:"10px", background:"#3b82f6",
                border:"none", borderRadius:10, cursor:"pointer",
                color:"white", fontSize:13, fontWeight:600 }}>
              Fermer
            </button>
          </div>
          {confirmDelete && (
            <div style={{ marginTop:12, background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.25)",
              borderRadius:10, padding:"12px 14px" }}>
              <p style={{ fontSize:12, color:"#ef4444", margin:"0 0 10px" }}>{confirmDelete.message}</p>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => handleDelete(true)} disabled={deleting}
                  style={{ flex:1, padding:"8px", background:"#ef4444", border:"none", borderRadius:8,
                    color:"white", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                  Confirmer la suppression
                </button>
                <button onClick={() => setConfirmDelete(null)}
                  style={{ flex:1, padding:"8px", background:"var(--surface2)", border:"1px solid var(--border)",
                    borderRadius:8, color:"var(--muted)", fontSize:12, cursor:"pointer" }}>
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Vue Bobines ────────────────────────────────────────────────────────────
function KpiBar({ kpis }) {
  return (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
      {kpis.map(({ label, value, accent }) => (
        <div key={label} style={{ flex:"1 1 100px", padding:"10px 14px", borderRadius:12,
          background:"var(--surface2)", border:"1px solid var(--border)",
          display:"flex", flexDirection:"column", gap:2 }}>
          <span style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:"0.06em" }}>{label}</span>
          <span style={{ fontSize:18, fontWeight:800, fontFamily:"JetBrains Mono,monospace",
            color: accent || "var(--text)" }}>{value ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

function SpoolCard({ s, colorsList, onClick }) {
  const pct = s.remaining_weight_g != null
    ? Math.min(100, Math.round(s.remaining_weight_g / (s.filament_weight_g||1000) * 100)) : 0;
  const barColor = pct > 60 ? "#22c55e" : pct > 35 ? "#f59e0b" : pct > 15 ? "#f97316" : "#ef4444";
  const shd = "0 1px 3px rgba(0,0,0,0.7)";
  return (
    <div onClick={onClick} className="card-sm"
      style={{ overflow:"hidden", cursor:"pointer", padding:0, position:"relative",
        ...colorBg(colorsList, s.filament_multicolor_type) }}>
      <div style={{ padding:"9px 10px 28px", display:"flex", flexDirection:"column", gap:0 }}>
        {/* Nom : toujours 2 lignes fixes */}
        <p style={{ fontWeight:700, fontSize:11, color:"white", margin:"0 0 7px",
          lineHeight:"1.35", height:"2.7em", overflow:"hidden",
          display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical",
          textShadow:shd }}>
          {s.filament_translated_name || s.filament_name}
        </p>
        {/* Étiquettes marque + type — hauteur fixe */}
        <div style={{ display:"flex", gap:3, flexWrap:"nowrap", overflow:"hidden",
          height:16, alignItems:"center", marginBottom:7 }}>
          {s.filament_manufacturer && (
            <span style={{ fontSize:8, fontWeight:500, padding:"1px 5px", borderRadius:3,
              background:"rgba(0,0,0,0.28)", color:"rgba(255,255,255,0.85)",
              whiteSpace:"nowrap", flexShrink:0 }}>
              {s.filament_manufacturer}
            </span>
          )}
          {s.filament_material && (
            <span style={{ fontSize:8, fontWeight:500, padding:"1px 5px", borderRadius:3,
              background:"rgba(0,0,0,0.20)", color:"rgba(255,255,255,0.75)",
              whiteSpace:"nowrap", flexShrink:0 }}>
              {s.filament_material}
            </span>
          )}
        </div>
        {/* Barre + poids — hauteur fixe */}
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ flex:1, height:5, borderRadius:3,
            background:"rgba(0,0,0,0.25)", border:"1px solid rgba(255,255,255,0.2)",
            overflow:"hidden" }}>
            <div style={{ width:`${pct}%`, height:"100%", background:barColor, borderRadius:3 }}/>
          </div>
          <span style={{ fontSize:9, fontFamily:"monospace", fontWeight:700, color:"white",
            flexShrink:0, textShadow:shd, minWidth:28, textAlign:"right" }}>
            {s.remaining_weight_g != null ? `${Math.round(s.remaining_weight_g)}g` : "—"}
          </span>
        </div>
      </div>
      {/* Emplacement : coin bas gauche absolu */}
      {s.location && (
        <span style={{ position:"absolute", bottom:6, left:8,
          fontSize:8, fontWeight:500, background:"rgba(0,0,0,0.28)",
          color:"rgba(255,255,255,0.85)", padding:"1px 7px", borderRadius:20 }}>
          {s.location}
        </span>
      )}
    </div>
  );
}

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

  // KPIs dynamiques (recalculés à chaque changement de spools filtrés)
  const kpis = useMemo(() => {
    if (showArchived) {
      const prixTotal = spools.reduce((s, b) => s + (b.price_override || 0), 0);
      return [
        { label:"Bobines", value: spools.length },
        { label:"Valeur archivée", value: prixTotal > 0 ? `${prixTotal.toFixed(0)}€` : "—" },
      ];
    }
    const marques = new Set(spools.map(b => b.filament_manufacturer).filter(Boolean)).size;
    const poids = spools.reduce((s, b) => s + (b.remaining_weight_g ?? b.filament_weight_g ?? 0), 0);
    const prix  = spools.reduce((s, b) => s + (b.price_override || 0), 0);
    return [
      { label:"Bobines",  value: spools.length, accent: spools.length > 0 ? "#22c55e" : undefined },
      { label:"Marques",  value: marques },
      { label:"En stock", value: poids > 0 ? `${(poids/1000).toFixed(2).replace(/\.?0+$/,"")} kg` : "—", accent:"#3b82f6" },
      { label:"Valeur",   value: prix > 0 ? `${prix.toFixed(0)}€` : "—" },
    ];
  }, [spools, showArchived]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <KpiBar kpis={kpis}/>
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
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
          {spools.map(s => {
            const colorsList = parseColorsList(s.filament_color, s.filament_colors_array);
            return (
              <SpoolCard key={s.id} s={s} colorsList={colorsList} onClick={()=>setSelected(s)}/>
            );
          })}
        </div>
      )}
      {showAdd && <AddSpoolModal filaments={filaments} onSave={()=>{ setShowAdd(false); load(); }} onClose={()=>setShowAdd(false)}/>}
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
function FilamentSheet({ f, onClose, onDeleted, onUpdated }) {
  const [lightbox, setLightbox] = useState(null);
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
    profile_id:       f.profile_id || "",
    fila_color_code:  f.fila_color_code || "",
    filament_weight_g: f.filament_weight_g || 1000,
    spool_weight_g:   f.spool_weight_g || "",
    price:            f.price || "",
    comment:          f.comment || "",
    swatch:           f.swatch || false,
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
      await client.patch(`/filaments/filaments/${f.id}`, {
        name:              form.name,
        name_en:           form.name_en || undefined,
        translated_name:   form.translated_name || undefined,
        manufacturer:      form.manufacturer || undefined,
        material:          form.fila_type || form.material || "PLA",
        fila_type:         form.fila_type || undefined,
        color:             col || undefined,
        colors_array:      ca || undefined,
        multicolor_type:   mct,
        profile_id:        form.profile_id || undefined,
        fila_color_code:   form.fila_color_code || undefined,
        filament_weight_g: Number(form.filament_weight_g) || 1000,
        spool_weight_g:    form.spool_weight_g ? Number(form.spool_weight_g) : undefined,
        price:             form.price ? Number(form.price) : undefined,
        comment:           form.comment || undefined,
        swatch:            form.swatch,
        to_order:          form.to_order,
      });
      setEditing(false);
      onUpdated?.();
    } catch(e) { alert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Supprimer le filament "${f.name}" ?`)) return;
    setDeleting(true);
    try {
      await client.delete(`/filaments/filaments/${f.id}`);
      onDeleted?.();
      onClose();
    } catch(e) {
      alert(e.response?.data?.detail || e.message);
    } finally { setDeleting(false); }
  };

  const F = ({ label, k, type="text", options=null }) => (
    <div style={{ marginBottom:10 }}>
      <label style={lStyle}>{label}</label>
      {options ? (
        <select style={iStyle} value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))}>
          {options.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
      ) : (
        <input style={iStyle} type={type} value={form[k]}
          onChange={e => setForm(f=>({...f,[k]: type==="number"?e.target.value:e.target.value}))}/>
      )}
    </div>
  );

  const Row = ({ label, value, mono }) => (!value && value !== 0) ? null : (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
      padding:"7px 0", borderBottom:"1px solid var(--border)" }}>
      <span style={{ fontSize:12, color:"var(--muted)", flexShrink:0 }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:600, color:"var(--text)", marginLeft:12,
        fontFamily: mono ? "JetBrains Mono,monospace" : "inherit", textAlign:"right" }}>
        {value}
      </span>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
      zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
          width:"100%", maxWidth:540, maxHeight:"92dvh", overflowY:"auto",
          paddingBottom:"env(safe-area-inset-bottom,20px)" }}>

        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
        </div>

        <div style={{ padding:"16px 20px 24px" }}>
          {/* En-tête */}
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
            <div style={{ width:56, height:56, borderRadius:14, flexShrink:0,
              overflow:"hidden", boxShadow:"0 2px 12px rgba(0,0,0,0.2), inset 0 0 0 2px var(--border)", ...colorBg(colorsList, f.multicolor_type) }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:18, fontWeight:800, color:"var(--text)", margin:0,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {f.name}
              </p>
              {f.translated_name && f.translated_name !== f.name && (
                <p style={{ fontSize:11, color:"var(--muted)", margin:"2px 0 0" }}>{f.translated_name}</p>
              )}
              <p style={{ fontSize:12, color:"var(--muted)", margin:"4px 0 0" }}>
                {[f.manufacturer, f.material].filter(Boolean).join(" · ")}
              </p>
            </div>
            <button onClick={() => setEditing(e=>!e)}
              style={{ padding:"6px 12px", borderRadius:8, fontSize:12, fontWeight:700,
                background: editing ? "var(--surface2)" : "#3b82f6",
                color: editing ? "var(--muted)" : "white",
                border:"1px solid var(--border)", cursor:"pointer", flexShrink:0 }}>
              {editing ? "Annuler" : "✏️ Éditer"}
            </button>
          </div>

          {editing ? (
            <div>
              <F label="Nom (anglais / officiel) *" k="name"/>
              <F label="Nom traduit (français)"     k="translated_name"/>
              <F label="Marque"                     k="manufacturer"/>
              <F label="Sous-type (ex: PLA Basic)"  k="fila_type"/>
              <div style={{ marginBottom:10 }}>
                <label style={lStyle}>Couleur(s) — hex séparées par virgule si multi</label>
                <input style={iStyle} value={form.colors_input}
                  placeholder="ex: 0047bb  ou  0047bb, bb22a3"
                  onChange={e => setForm(f=>({...f, colors_input: e.target.value}))}/>
                {liveColors.length > 0 && (
                  <div style={{ display:"flex", gap:4, marginTop:6, alignItems:"center" }}>
                    {liveColors.map((c,i) => (
                      <div key={i} style={{ width:24, height:24, borderRadius:5,
                        background:c, border:"1px solid var(--border)" }}/>
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
                  <select style={iStyle} value={form.multicolor_type === "monochrome" ? "coaxial" : form.multicolor_type}
                    onChange={e => setForm(f=>({...f, multicolor_type: e.target.value}))}>
                    <option value="gradient">Gradient (dégradé)</option>
                    <option value="coaxial">Coaxial (segments)</option>
                  </select>
                </div>
              )}
              <F label="Profile ID Bambu (ex: GFA00)"  k="profile_id"/>
              <F label="Code couleur Bambu (ex: 10600)" k="fila_color_code"/>
              <F label="Poids total (g)"  k="filament_weight_g" type="number"/>
              <F label="Poids support (g)" k="spool_weight_g"   type="number"/>
              <F label="Prix (€)"          k="price"            type="number"/>
              <F label="Commentaire"       k="comment"/>
              <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
                {[["swatch","Échantillon"],["to_order","À commander"]].map(([k,l])=>(
                  <label key={k} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, cursor:"pointer" }}>
                    <input type="checkbox" checked={!!form[k]}
                      onChange={e => setForm(f=>({...f,[k]:e.target.checked}))}/>
                    {l}
                  </label>
                ))}
              </div>
              <button onClick={handleSave} disabled={saving}
                style={{ width:"100%", padding:"11px", borderRadius:10, fontSize:13, fontWeight:700,
                  background: saving ? "var(--border)" : "#3b82f6",
                  color:"white", border:"none", cursor: saving?"default":"pointer" }}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          ) : (
            <>
              {/* Photos */}
              <FilamentPhotos filamentId={f.id} onLightbox={setLightbox} />

              {/* Infos */}
              <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
                letterSpacing:"0.08em", marginBottom:4 }}>Caractéristiques</p>
              <Row label="Marque"           value={f.manufacturer}/>
              <Row label="Matière"          value={f.material}/>
              <Row label="Couleur"          value={colorsList?.length > 1 ? (f?.colors_array||spool?.filament_colors_array||"").split(",").map(c=>hexDisplay(c)).filter(Boolean).join(" / ") : color} mono/>
              <Row label="Profile ID"       value={f.profile_id} mono/>
              <Row label="Code couleur Bambu" value={f.fila_color_code} mono/>
              <Row label="Poids bobine"     value={f.filament_weight_g ? f.filament_weight_g+"g" : null}/>
              <Row label="Poids support"    value={f.spool_weight_g ? f.spool_weight_g+"g" : null}/>
              <Row label="Prix"             value={f.price ? f.price+"€" : null}/>
              <Row label="Multicolor"       value={f.multicolor_type !== "monochrome" ? f.multicolor_type : null}/>

              {/* Bobines */}
              <div style={{ marginTop:16, display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                  Bobines
                </span>
                <span style={{ fontSize:12, fontWeight:700,
                  color: f.active_spool_count > 0 ? "#22c55e" : "var(--muted)" }}>
                  {f.active_spool_count || 0} active{f.active_spool_count !== 1 ? "s" : ""}
                </span>
              </div>

              <div style={{ display:"flex", gap:8, marginTop:20 }}>
                <button onClick={handleDelete} disabled={deleting}
                  style={{ flex:1, padding:"10px", background:"rgba(239,68,68,0.08)",
                    border:"1px solid rgba(239,68,68,0.3)", borderRadius:10, cursor:"pointer",
                    color:"#ef4444", fontSize:13, display:"flex",
                    alignItems:"center", justifyContent:"center", gap:6 }}>
                  🗑 Supprimer
                </button>
            <button onClick={onClose}
              style={{ flex:2, padding:"10px", background:"#3b82f6",
                border:"none", borderRadius:10, cursor:"pointer",
                color:"white", fontSize:13, fontWeight:600 }}>
              Fermer
            </button>
          </div>
            </>
          )}
        </div>
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)",
            zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <img src={lightbox} alt="" onClick={e=>e.stopPropagation()}
            style={{ maxWidth:"92vw", maxHeight:"92vh", borderRadius:12, objectFit:"contain" }}/>
        </div>
      )}
    </div>
  );
}

function FilamentsView() {
  const [filaments, setFilaments] = useState([]);
  const [q, setQ] = useState("");
  const [material, setMaterial] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedFil, setSelectedFil] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/filaments/filaments", { params:{ q:q||undefined, material:material||undefined } });
      setFilaments(data);
    } finally { setLoading(false); }
  }, [q, material]);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => {
    const marques = new Set(filaments.map(f => f.manufacturer).filter(Boolean)).size;
    const types   = new Set(filaments.map(f => f.fila_type || f.material).filter(Boolean)).size;
    const aCommander = filaments.filter(f => f.to_order).length;
    const avecBobines = filaments.filter(f => (f.active_spool_count || 0) > 0).length;
    return [
      { label:"Références",  value: filaments.length },
      { label:"Marques",     value: marques },
      { label:"Types",       value: types },
      { label:"En stock",    value: avecBobines, accent:"#22c55e" },
      ...(aCommander > 0 ? [{ label:"À commander", value: aCommander, accent:"#f59e0b" }] : []),
    ];
  }, [filaments]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <KpiBar kpis={kpis}/>
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
        <button onClick={() => setCreateOpen(true)}
          style={{ padding:"8px 14px", borderRadius:10, background:"#3b82f6", border:"none",
            color:"white", fontSize:13, fontWeight:700, cursor:"pointer",
            display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <Plus size={14}/> Filament
        </button>
      </div>

      {loading ? (
        <p style={{ textAlign:"center", color:"var(--muted)", fontSize:13, padding:"32px 0" }}>Chargement…</p>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
          {filaments.map(f => {
            const colorsList = parseColorsList(f.color, f.colors_array);
            return (
              <div key={f.id} className="card-sm"
                onClick={() => setSelectedFil(f)}
                style={{ overflow:"hidden", cursor:"pointer", display:"flex",
                  flexDirection:"column", padding:0, gap:0, position:"relative" }}>
                {/* Bandeau couleur en haut — plus épais, plus lisible */}
                <div style={{ height:8, flexShrink:0, position:"relative", overflow:"hidden" }}>
                  {hasTransparency(f.color) && !f.colors_array && (
                    <div style={{ position:"absolute", inset:0,
                      backgroundImage:"repeating-conic-gradient(#aaa 0% 25%,#eee 0% 50%)",
                      backgroundSize:"6px 6px" }}/>
                  )}
                  <div style={{ position:"absolute", inset:0, ...colorBg(colorsList, f.multicolor_type) }}/>
                </div>
                <div style={{ padding:"12px 12px 10px", display:"flex", flexDirection:"column", gap:8, flex:1 }}>
                  {/* Swatch + nom */}
                  <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                    <ColorSwatch color={f.color} colorsArray={f.colors_array}
                      multicolorType={f.multicolor_type} size={36} radius={8}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      {/* Nom FR (fallback EN) — affiché entier, wrap autorisé */}
                      <p style={{ fontWeight:700, fontSize:12, color:"var(--text)",
                        lineHeight:"1.3", margin:"0 0 2px", wordBreak:"break-word" }}>
                        {f.translated_name || f.name}
                      </p>
                      {/* Nom EN si différent du nom affiché */}
                      {f.translated_name && f.translated_name !== f.name && (
                        <p style={{ fontSize:10, color:"var(--muted)", margin:"0 0 2px",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {f.name}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Marque · Sous-type */}
                  <p style={{ fontSize:10, color:"var(--muted)", margin:0,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {[f.manufacturer, f.fila_type || f.material].filter(Boolean).join(" · ")}
                  </p>
                  {/* Badge bobines */}
                  <div>
                    <span style={{
                      display:"inline-block",
                      fontSize:10, padding:"2px 8px", borderRadius:20, fontWeight:600,
                      background: f.active_spool_count > 0 ? "rgba(34,197,94,0.12)" : "var(--surface2)",
                      color: f.active_spool_count > 0 ? "#22c55e" : "var(--muted)",
                    }}>
                      {f.active_spool_count} bobine{f.active_spool_count!==1?"s":""}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {!filaments.length && <p style={{ gridColumn:"1/-1", textAlign:"center", color:"var(--muted)", fontSize:13, padding:"32px 0" }}>Aucun filament</p>}
        </div>
      )}
      {selectedFil && <FilamentSheet f={selectedFil} onClose={() => setSelectedFil(null)}
        onDeleted={() => { setSelectedFil(null); load(); }}
        onUpdated={load}/>}
      {createOpen && <FilamentCreateSheet onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }}/>}
    </div>
  );
}

// ── Création filament (saisie libre ou import catalogue Bambu) ─────────────
function FilamentCreateSheet({ onClose, onCreated, prefill = null }) {
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
  const lStyle = { fontSize:11, color:"var(--muted)", margin:"0 0 4px", display:"block" };

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

  // Chercher dans le catalogue
  useEffect(() => {
    if (mode !== "catalog") return;
    setCatalogLoading(true);
    const params = {};
    if (selectedFamily) params.family = selectedFamily;
    if (selectedType) params.fila_type = selectedType;
    if (catalogQ.trim()) params.q = catalogQ.trim();
    params.lang = "fr";
    client.get("/filaments/catalog/search", { params })
      .then(({ data }) => {
        setCatalogEntries(data.entries || []);
        if (!data.available) setCatalogEntries([]);
      })
      .catch(() => setCatalogEntries([]))
      .finally(() => setCatalogLoading(false));
  }, [mode, selectedFamily, selectedType, catalogQ]);

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
        colors_array:      ca || undefined,
        multicolor_type:   mct,
        profile_id:        form.profile_id || undefined,
        fila_color_code:   form.fila_color_code || undefined,
        filament_weight_g: Number(form.weight) || 1000,
      });
      onCreated();
    } catch(e) {
      if (e.response?.status === 409) {
        const d = e.response.data?.detail || {};
        setDuplicate({ id: d.existing_id, name: d.existing_name, message: d.message });
      } else { alert(e.response?.data?.detail || e.message); }
    } finally { setSaving(false); }
  };

  const types = selectedFamily ? (typesByFamily[selectedFamily] || []) : Object.values(typesByFamily).flat();

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1200,
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:540, maxHeight:"92dvh", overflowY:"auto",
        paddingBottom:"env(safe-area-inset-bottom,16px)", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 4px" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
        </div>
        <div style={{ padding:"12px 20px 24px" }}>
          <h3 style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:"0 0 16px" }}>
            Nouveau filament
          </h3>

          {mode === "choose" && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <button onClick={() => setMode("catalog")}
                style={{ padding:"14px 16px", borderRadius:12, border:"1px solid var(--border)",
                  background:"var(--surface2)", cursor:"pointer", textAlign:"left" }}>
                <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 4px" }}>
                  📦 Importer depuis le catalogue Bambu
                </p>
                <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>
                  Type → Couleur → Préremplissage automatique (nom officiel, hex, profil…)
                </p>
              </button>
              <button onClick={() => setMode("free")}
                style={{ padding:"14px 16px", borderRadius:12, border:"1px solid var(--border)",
                  background:"var(--surface2)", cursor:"pointer", textAlign:"left" }}>
                <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 4px" }}>
                  ✏️ Saisie libre
                </p>
                <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>
                  Remplir manuellement tous les champs
                </p>
              </button>
            </div>
          )}

          {mode === "catalog" && (
            <div>
              <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                <select value={selectedFamily} onChange={e => { setSelectedFamily(e.target.value); setSelectedType(""); }}
                  style={{ ...iStyle, flex:1, minWidth:120 }}>
                  <option value="">Toutes familles</option>
                  {families.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select value={selectedType} onChange={e => setSelectedType(e.target.value)}
                  style={{ ...iStyle, flex:1, minWidth:140 }}>
                  <option value="">Tous types</option>
                  {types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <input value={catalogQ} onChange={e => setCatalogQ(e.target.value)}
                placeholder="Rechercher une couleur (Jade White, Orange…)"
                style={{ ...iStyle, marginBottom:10 }}/>
              <div style={{ maxHeight:300, overflowY:"auto" }}>
                {catalogLoading && <p style={{ color:"var(--muted)", fontSize:12 }}>Recherche…</p>}
                {!catalogLoading && catalogEntries.length === 0 &&
                  <p style={{ color:"var(--muted)", fontSize:12 }}>
                    {families.length === 0 ? "Catalogue non disponible (démarrage en cours…)" : "Aucun résultat"}
                  </p>}
                {catalogEntries.map((e,i) => (
                  <button key={i} onClick={() => pickFromCatalog(e)}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 12px",
                      borderRadius:10, border:"1px solid var(--border)", background:"var(--surface2)",
                      marginBottom:6, cursor:"pointer", textAlign:"left" }}>
                    {colorSwatch(e, 30)}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:1 }}>
                        <p style={{ fontSize:13, fontWeight:700, color:"var(--text)", margin:0,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.name}</p>
                        {e.color_type_fr && e.color_type_fr !== "monochrome" && (
                          <span style={{ fontSize:9, padding:"1px 5px", borderRadius:4, flexShrink:0,
                            background: e.color_type_fr==="gradient" ? "rgba(139,92,246,0.15)" : "rgba(59,130,246,0.15)",
                            color: e.color_type_fr==="gradient" ? "#8b5cf6" : "#3b82f6",
                            fontWeight:700, textTransform:"uppercase" }}>
                            {e.color_type_fr}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>
                        {e.fila_type} · <span style={{ fontFamily:"monospace" }}>{e.fila_color_code}</span>
                      </p>
                    </div>
                    <span style={{ fontSize:10, color:"#3b82f6", fontWeight:700, flexShrink:0 }}>→</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setMode("choose")}
                style={{ marginTop:10, padding:"7px 12px", borderRadius:8, fontSize:11,
                  background:"none", border:"1px solid var(--border)", color:"var(--muted)", cursor:"pointer" }}>
                ← Retour
              </button>
            </div>
          )}

          {mode === "free" && (
            <>
              {catalogEntry && (
                <div style={{ marginBottom:14, padding:"8px 12px", borderRadius:10,
                  background:"rgba(59,130,246,0.06)", border:"1px solid rgba(59,130,246,0.2)",
                  fontSize:11, color:"#60a5fa" }}>
                  📦 Pré-rempli depuis le catalogue Bambu · {catalogEntry.fila_type} · {catalogEntry.color_code}
                </div>
              )}
              <div style={{ marginBottom:10 }}>
                <label style={lStyle}>Nom de la couleur * (anglais / officiel)</label>
                <input style={iStyle} value={form.name} autoFocus placeholder="ex: Jade White"
                  onChange={e => setForm(f => ({...f, name: e.target.value}))}/>
              </div>
              <div style={{ marginBottom:10 }}>
                <label style={lStyle}>Nom traduit (français)</label>
                <input style={iStyle} value={form.translated_name || ""}
                  placeholder="ex: Blanc Jade"
                  onChange={e => setForm(f => ({...f, translated_name: e.target.value}))}/>
              </div>
              <div style={{ marginBottom:10 }}>
                <label style={lStyle}>Marque</label>
                <input style={iStyle} value={form.manufacturer}
                  onChange={e => setForm(f => ({...f, manufacturer: e.target.value}))}/>
              </div>
              <div style={{ marginBottom:10 }}>
                <label style={lStyle}>Sous-type filament (ex: PLA Basic, PLA Matte…)</label>
                <input style={iStyle} value={form.fila_type || ""}
                  placeholder="ex: PLA Basic"
                  onChange={e => setForm(f => ({...f, fila_type: e.target.value}))}/>
              </div>
              <div style={{ marginBottom:10 }}>
                <label style={lStyle}>Couleur(s) — hex séparées par virgule si multi</label>
                <input style={iStyle} value={form.colors_input || ""}
                  placeholder="ex: 0047bb  ou  0047bb, bb22a3"
                  onChange={e => setForm(f => ({...f, colors_input: e.target.value}))}/>
                {liveColors.length > 0 && (
                  <div style={{ display:"flex", gap:4, marginTop:6, alignItems:"center" }}>
                    {liveColors.map((c,i) => (
                      <div key={i} style={{ width:24, height:24, borderRadius:5,
                        background:c, border:"1px solid var(--border)" }}/>
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
                  <select style={iStyle} value={form.multicolor_type === "monochrome" ? "coaxial" : form.multicolor_type}
                    onChange={e => setForm(f => ({...f, multicolor_type: e.target.value}))}>
                    <option value="gradient">Gradient (dégradé)</option>
                    <option value="coaxial">Coaxial (segments)</option>
                  </select>
                </div>
              )}
              <div style={{ marginBottom:10 }}>
                <label style={lStyle}>Profile ID Bambu (ex: GFA00)</label>
                <input style={iStyle} value={form.profile_id}
                  onChange={e => setForm(f => ({...f, profile_id: e.target.value}))}/>
              </div>
              <div style={{ marginBottom:10 }}>
                <label style={lStyle}>Code couleur Bambu (ex: 10600)</label>
                <input style={iStyle} value={form.fila_color_code || ""}
                  onChange={e => setForm(f => ({...f, fila_color_code: e.target.value}))}/>
              </div>
              <div style={{ marginBottom:16 }}>
                <label style={lStyle}>Poids total (g)</label>
                <input style={iStyle} type="number" value={form.weight}
                  onChange={e => setForm(f => ({...f, weight: e.target.value}))}/>
              </div>
              {duplicate && (
                <div style={{ marginBottom:12, padding:"10px 14px", borderRadius:10,
                  background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.35)" }}>
                  <p style={{ fontSize:12, color:"#f59e0b", fontWeight:700, margin:"0 0 4px" }}>
                    ⚠ Filament identique déjà en base
                  </p>
                  <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>
                    {duplicate.message || `Filament #${duplicate.id} « ${duplicate.name} »`}
                  </p>
                </div>
              )}
              <div style={{ display:"flex", gap:8 }}>
                {!prefill && (
                  <button onClick={() => { setMode("choose"); setCatalogEntry(null); }}
                    style={{ flex:1, padding:"10px", borderRadius:10, fontSize:13,
                      background:"var(--surface2)", border:"1px solid var(--border)",
                      color:"var(--muted)", cursor:"pointer" }}>← Retour</button>
                )}
                <button onClick={save} disabled={saving}
                  style={{ flex:2, padding:"10px", borderRadius:10, fontSize:13, fontWeight:700,
                    background: saving ? "var(--border)" : "#3b82f6",
                    color:"white", border:"none", cursor: saving ? "default" : "pointer" }}>
                  {saving ? "Création…" : "Créer le filament"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
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

function SwatchView({ filaments: allFilaments }) {
  const [swatchSort, setSwatchSort]   = useState("hue");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterType, setFilterType]   = useState("");
  const [filterSub, setFilterSub]     = useState("");
  const [showEmpty, setShowEmpty]     = useState(false); // archivés/sans stock

  const iStyle = { background:"var(--surface2)", border:"1px solid var(--border)",
    borderRadius:8, padding:"6px 10px", fontSize:12, color:"var(--text)", outline:"none" };

  const SORTS = [["hue","Teinte"],["material","Matière"],["manufacturer","Marque"],["name","Nom"]];

  // Extraire la famille (type) depuis fila_type ou material
  // Ex: "PLA Basic" → "PLA", "PETG-HF" → "PETG", "TPU 95A" → "TPU"
  const getFamily = (f) => {
    const sub = (f.fila_type || f.material || "").trim();
    return MATERIALS.find(m => sub === m || sub.startsWith(m + " ") || sub.startsWith(m + "-")) || sub.split(/[\s-]/)[0] || "";
  };

  // Filtrages en cascade
  const afterEmpty = useMemo(() =>
    showEmpty ? allFilaments : allFilaments.filter(f => (f.active_spool_count||0) > 0)
  , [allFilaments, showEmpty]);

  const brands   = useMemo(() => [...new Set(afterEmpty.map(f=>f.manufacturer).filter(Boolean))].sort(), [afterEmpty]);
  const afterBrand = useMemo(() => filterBrand ? afterEmpty.filter(f=>f.manufacturer===filterBrand) : afterEmpty, [afterEmpty, filterBrand]);

  // Types = familles (PLA, PETG…) dérivées depuis fila_type/material
  const types    = useMemo(() => [...new Set(afterBrand.map(f=>getFamily(f)).filter(Boolean))].sort(), [afterBrand]);
  const afterType = useMemo(() => filterType ? afterBrand.filter(f=>getFamily(f)===filterType) : afterBrand, [afterBrand, filterType]);

  // Sous-types = fila_type complet (PLA Basic, PLA Silk…)
  const subtypes = useMemo(() => [...new Set(afterType.map(f=>f.fila_type).filter(Boolean))].sort(), [afterType]);
  const afterSub = useMemo(() => filterSub ? afterType.filter(f=>f.fila_type===filterSub) : afterType, [afterType, filterSub]);

  // Réinitialiser les filtres dépendants quand le parent change
  useEffect(() => { if (filterBrand && !brands.includes(filterBrand)) setFilterBrand(""); }, [brands]);
  useEffect(() => { if (filterType && !types.includes(filterType)) setFilterType(""); }, [types]);
  useEffect(() => { if (filterSub && !subtypes.includes(filterSub)) setFilterSub(""); }, [subtypes]);

  const sorted = useMemo(() => [...afterSub].sort((a,b) => {
    if (swatchSort === "hue") {
      const [ah,as_,al] = hexToHsl(a.color), [bh,bs,bl] = hexToHsl(b.color);
      if (al > 90 && bl <= 90) return 1; if (bl > 90 && al <= 90) return -1;
      if (al < 10 && bl >= 10) return 1; if (bl < 10 && al >= 10) return -1;
      if (as_ < 15 && bs >= 15) return 1; if (bs < 15 && as_ >= 15) return -1;
      return ah - bh || bl - al;
    }
    if (swatchSort === "material") return (a.material||"").localeCompare(b.material||"")||((a.translated_name||a.name||"").localeCompare(b.translated_name||b.name||""));
    if (swatchSort === "manufacturer") return (a.manufacturer||"").localeCompare(b.manufacturer||"")||(a.material||"").localeCompare(b.material||"");
    return (a.translated_name||a.name||"").localeCompare(b.translated_name||b.name||"");
  }), [afterSub, swatchSort]);

  const activeCount = allFilaments.filter(f => (f.active_spool_count||0) > 0).length;
  const emptyCount  = allFilaments.length - activeCount;

  return (
    <>
      {/* Filtres */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {/* Ligne 1 : sélecteurs */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <select value={filterBrand} onChange={e=>{setFilterBrand(e.target.value); setFilterType(""); setFilterSub("");}}
            style={{ ...iStyle, flex:"1 1 120px" }}>
            <option value="">Toutes marques{brands.length ? ` (${brands.length})` : ""}</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={filterType} onChange={e=>{setFilterType(e.target.value); setFilterSub("");}}
            style={{ ...iStyle, flex:"1 1 100px" }}>
            <option value="">Tous matériaux</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {subtypes.length > 1 && (
            <select value={filterSub} onChange={e=>setFilterSub(e.target.value)}
              style={{ ...iStyle, flex:"1 1 140px" }}>
              <option value="">Tous sous-types</option>
              {subtypes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
        {/* Ligne 2 : tri + switch archivé */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {SORTS.map(([id,label]) => (
            <button key={id} onClick={()=>setSwatchSort(id)}
              style={{ padding:"4px 10px", borderRadius:20, fontSize:10, fontWeight:600, cursor:"pointer",
                background: swatchSort===id ? "#3b82f6" : "var(--surface2)",
                color: swatchSort===id ? "white" : "var(--muted)",
                border:"1px solid var(--border)" }}>
              {label}
            </button>
          ))}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, color:"var(--muted)" }}>
              Sans stock {emptyCount > 0 ? `(${emptyCount})` : ""}
            </span>
            <button onClick={()=>setShowEmpty(v=>!v)}
              style={{ width:40, height:22, borderRadius:11, border:"none", cursor:"pointer",
                background: showEmpty ? "#3b82f6" : "var(--border)",
                position:"relative", flexShrink:0, transition:"background 0.2s" }}>
              <span style={{ position:"absolute", top:3, left: showEmpty ? 20 : 3,
                width:16, height:16, borderRadius:"50%", background:"white",
                transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.3)" }}/>
            </button>
          </div>
        </div>
        {/* Résultat */}
        {(filterBrand || filterType || filterSub) && (
          <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>
            {sorted.length} filament{sorted.length!==1?"s":""} · 
            <button onClick={()=>{setFilterBrand("");setFilterType("");setFilterSub("");}}
              style={{ background:"none", border:"none", color:"#60a5fa", cursor:"pointer", fontSize:11, padding:"0 4px" }}>
              Effacer filtres
            </button>
          </p>
        )}
      </div>

      <GalleryCompare
        items={sorted}
        getId={f => f.id}
        getTitle={f => f.translated_name || f.name}
        getSubtitle={f => [f.manufacturer, f.fila_type || f.material].filter(Boolean).join(" · ")}
        emptyLabel="Aucun filament"
        swatchMode={true}
        renderCover={f => {
          const colors = parseColorsList(f.color, f.colors_array);
          return <div style={{ width:"100%", height:"100%", ...colorBg(colors, f.multicolor_type) }}/>;
        }}
        compareFields={[
          ["Matière",  f => f.material],
          ["Marque",   f => f.manufacturer],
          ["Couleur",  f => f.color ? `#${f.color}` : null],
          ["Poids",    f => f.filament_weight_g ? `${f.filament_weight_g}g` : null],
          ["Prix",     f => f.price ? `${f.price}€` : null],
          ["Bobines",  f => `${f.active_spool_count} active${f.active_spool_count!==1?"s":""}/${f.spool_count}`],
        ]}
      />
    </>
  );
}

export default function Filaments() {
  const [tab, setTab] = useState("spools");
  const [galleryMode, setGalleryMode] = useState("photos"); // "photos" | "swatch"
  const [filaments, setFilaments] = useState([]);

  useEffect(() => {
    client.get("/filaments/filaments").then(({ data }) => setFilaments(data));
  }, []);

  const tabs = [
    { id:"spools",   label:"Stock" },
    { id:"archived", label:"Archivées" },
    { id:"catalog",  label:"Filaments" },
    { id:"gallery",  label:"Galerie" },
  ];

  return (
    <div style={{ maxWidth:960, margin:"0 auto", display:"flex", flexDirection:"column", gap:16 }}>
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

      {tab==="catalog" && <FilamentsView/>}
      {tab==="gallery" && (
        <>
          {/* Sous-mode : photos réelles vs nuancier de couleurs */}
          <div style={{ display:"flex", gap:6 }}>
            {[["photos","Photos"],["swatch","Nuancier"]].map(([id,label]) => (
              <button key={id} onClick={()=>setGalleryMode(id)} style={{
                padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer",
                background: galleryMode===id ? "#3b82f6" : "var(--surface2)",
                color: galleryMode===id ? "white" : "var(--muted)",
                border:"1px solid var(--border)",
              }}>
                {label}
              </button>
            ))}
          </div>

          {galleryMode==="photos" ? (
            <GalleryCompare
              items={filaments}
              getId={f => f.id}
              getCoverImage={f => f.photo_url}
              getPhotos={f => f.photos}
              getTitle={f => f.name}
              getSubtitle={f => [f.manufacturer, f.material].filter(Boolean).join(" · ")}
              emptyLabel="Aucune photo de filament"
              compareFields={[
                ["Matière",   f => f.material],
                ["Marque",    f => f.manufacturer],
                ["Couleur",   f => f.color ? `#${f.color}` : null],
                ["Poids",     f => f.filament_weight_g ? `${f.filament_weight_g}g` : null],
                ["Prix",      f => f.price ? `${f.price}€` : null],
                ["Bobines",   f => `${f.active_spool_count} active${f.active_spool_count!==1?"s":""} / ${f.spool_count}`],
              ]}
            />
          ) : null}
          {galleryMode==="swatch" && <SwatchView filaments={filaments}/>}
        </>
      )}
      {(tab==="spools" || tab==="archived") && (
        <SpoolsView filaments={filaments} showArchived={tab==="archived"}/>
      )}
    </div>
  );
}
