import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import ScanSheet from "../components/ScanSheet";
import RfidSheet from "../components/RfidSheet";
import { useNativeScan } from "../hooks/useNativeScan";
import HeaderAction from "../components/HeaderAction";
import { Plus, Search, Archive, X, Save, RefreshCw, Pencil, SlidersHorizontal, ScanLine, Droplets, Nfc, Palette } from "lucide-react";
import client from "../api/client";
import { colorBg, parseColorsList } from "../utils/colors";
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
function AddSpoolModal({ filaments: filamentsProp, onSave, onClose, preselect }) {
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

          {/* Un <select> natif avec des centaines de references, en vrac et sans
              couleur, etait inutilisable : liste cherchable, groupee par matiere,
              avec la pastille. */}
          {selected ? (
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px",
              borderRadius:8, background:"rgba(59,130,246,0.10)",
              border:"1px solid rgba(59,130,246,0.25)" }}>
              <ColorDot color={selected.color} colorsArray={selected.colors_array}
                multicolorType={selected.multicolor_type} size={16}/>
              <span style={{ flex:1, minWidth:0, fontSize:12, color:"var(--text)", fontWeight:600,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {selected.translated_name || selected.name}
                <span style={{ color:"var(--muted)", fontWeight:400 }}>
                  {" · "}{[selected.manufacturer, selected.fila_type || selected.material].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button onClick={() => { setForm(f => ({...f, filament_id:""})); setQ(""); }}
                style={{ background:"none", border:"none", cursor:"pointer",
                  color:"var(--muted)", fontSize:14 }}>✕</button>
            </div>
          ) : (<>
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus
              placeholder="Rechercher : nom, marque, matière, teinte…"
              style={{ ...inp, marginBottom:6 }} onFocus={inpFocus} onBlur={inpBlur}/>
            <div style={{ maxHeight:200, overflowY:"auto", display:"flex",
              flexDirection:"column", gap:2 }}>
              {(() => {
                const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
                const list = filaments.filter(f => {
                  if (!words.length) return true;
                  const hay = [f.translated_name, f.name, f.manufacturer, f.material,
                    f.fila_type, f.color_bucket, "#" + f.id].filter(Boolean).join(" ").toLowerCase();
                  return words.every(w => hay.includes(w));
                });
                if (!list.length) return (
                  <p style={{ fontSize:11, color:"var(--muted)", padding:8, margin:0 }}>
                    Aucun filament ne correspond.
                  </p>
                );
                const byMat = {};
                list.forEach(f => { (byMat[f.material || "Autre"] ||= []).push(f); });
                return Object.keys(byMat).sort().map(mat => (
                  <div key={mat}>
                    <p style={{ fontSize:9, fontWeight:700, color:"var(--muted)",
                      textTransform:"uppercase", letterSpacing:"0.06em", margin:"6px 0 3px",
                      position:"sticky", top:0, background:"var(--sheet-bg)", padding:"2px 0" }}>
                      {mat} <span style={{ opacity:0.6 }}>({byMat[mat].length})</span>
                    </p>
                    {byMat[mat]
                      .sort((a,b) => (a.translated_name||a.name||"").localeCompare(b.translated_name||b.name||""))
                      .map(f => (
                      <button key={f.id} onClick={() => setForm(fm => ({...fm, filament_id:String(f.id)}))}
                        style={{ display:"flex", alignItems:"center", gap:8, width:"100%",
                          padding:"6px 8px", borderRadius:8, border:"none", cursor:"pointer",
                          textAlign:"left", marginBottom:2, background:"var(--surface2)" }}>
                        <ColorDot color={f.color} colorsArray={f.colors_array}
                          multicolorType={f.multicolor_type} size={14}/>
                        <span style={{ flex:1, minWidth:0, fontSize:11, color:"var(--text)",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {f.translated_name || f.name}
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
          </>)}
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

        {/* location n'est PAS editable : geree automatiquement (Tiroir / AMS xxx)
            par le worker spool_location selon la presence en AMS. */}
        {[["Tag NFC","tag_number","text","UUID"],["Commentaire","comment","text",""]].map(([l,n,t,p])=>(
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
  const [photoMenu, setPhotoMenu] = React.useState(null);

  const reload = () => client.get("/filaments/" + filamentId + "/photos")
    .then(r => setPhotos(r.data.files || [])).catch(() => {});

  React.useEffect(() => { if (filamentId) reload(); }, [filamentId]);

  const fileRef = React.useRef(null);
  const cameraRef = React.useRef(null);
  // Dans la WebView Android, le sélecteur natif propose DEJA "Appareil photo" +
  // "Galerie" -> notre propre popup ferait doublon. On declenche alors directement
  // l'input sans capture (Android affiche son choix). En navigateur, on garde le
  // popup : selon la plateforme, <input capture> ouvre soit la camera seule soit
  // l'explorateur, et c'est ce popup qui laisse l'utilisateur choisir.
  const isWebView = typeof window !== "undefined" && !!window.BambuScan;
  const onAddPhoto = () => {
    if (isWebView) fileRef.current?.click();
    else setAddPhotoOpen(true);
  };
  const [uploading, setUploading] = React.useState(false);
  const [addPhotoOpen, setAddPhotoOpen] = React.useState(false);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await client.post(`/filaments/${filamentId}/photos/upload`, form, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      reload();
    } catch(e) { alert(e.response?.data?.detail || "Erreur upload"); }
    finally { setUploading(false); }
  };

  const pressTimer = React.useRef(null);
  const startPhotoPress = (photo, idx) => {
    pressTimer.current = setTimeout(() => {
      setPhotoMenu({ url: photo.url, filename: photo.url.split("/").pop(), index: idx });
    }, 500);
  };
  const cancelPhotoPress = () => clearTimeout(pressTimer.current);

  const deletePhoto = async () => {
    if (!window.confirm("Supprimer cette photo ?")) return;
    await client.delete(`/filaments/${filamentId}/photo/${photoMenu.filename}`);
    setPhotoMenu(null); reload();
  };
  const setPrimary = async () => {
    await client.post(`/filaments/${filamentId}/photo/${photoMenu.filename}/primary`);
    setPhotoMenu(null); reload();
  };

  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
          letterSpacing:"0.06em", margin:0 }}>
          Photos{photos.length ? ` (${photos.length})` : ""}
        </p>
        <button onClick={onAddPhoto} disabled={uploading}
          style={{ width:26, height:26, borderRadius:"50%", background:"#3b82f6", color:"white",
            border:"none", cursor:"pointer", fontSize:18, lineHeight:1, display:"flex",
            alignItems:"center", justifyContent:"center" }}>
          +
        </button>
      </div>
      {/* Inputs cachés */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }}
        onChange={e => { handleUpload(e.target.files?.[0]); setAddPhotoOpen(false); }}/>
      <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
        onChange={e => { handleUpload(e.target.files?.[0]); setAddPhotoOpen(false); }}/>
      {/* Bottom sheet ajout photo */}
      {addPhotoOpen && (
        <div style={{ position:"fixed", inset:0, zIndex:3000, background:"rgba(0,0,0,0.5)" }}
          onClick={() => setAddPhotoOpen(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ position:"absolute", bottom:0, left:0, right:0,
            background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", padding:"20px 16px 32px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
            <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)", margin:"8px auto 0", flex:1 }}/>
          <button onClick={() => setAddPhotoOpen(false)} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
            <p style={{ fontWeight:700, fontSize:15, color:"var(--text)", margin:"0 0 16px" }}>Ajouter une photo</p>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <button onClick={() => cameraRef.current?.click()}
                style={{ padding:"14px", borderRadius:12, border:"none", cursor:"pointer",
                  background:"var(--surface2)", color:"var(--text)", fontSize:14, fontWeight:600,
                  display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:22 }}>📷</span> Prendre une photo
              </button>
              <button onClick={() => fileRef.current?.click()}
                style={{ padding:"14px", borderRadius:12, border:"none", cursor:"pointer",
                  background:"var(--surface2)", color:"var(--text)", fontSize:14, fontWeight:600,
                  display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:22 }}>📁</span> Choisir depuis la galerie
              </button>
              <button onClick={() => setAddPhotoOpen(false)}
                style={{ padding:"12px", borderRadius:12, border:"1px solid var(--border)", cursor:"pointer",
                  background:"none", color:"var(--muted)", fontSize:13 }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4 }}>
        {photos.map((photo, i) => (
          <div key={i}
            onClick={() => { if(!photoMenu) { onLightbox ? onLightbox(photo.url) : setLightbox(photo.url); }}}
            onMouseDown={() => startPhotoPress(photo, i)}
            onMouseUp={cancelPhotoPress} onMouseLeave={cancelPhotoPress}
            onTouchStart={() => startPhotoPress(photo, i)} onTouchEnd={cancelPhotoPress}
            onContextMenu={e => e.preventDefault()}
            style={{ flexShrink:0, cursor:"pointer", borderRadius:8, overflow:"hidden", position:"relative",
              border: i===0 ? "2px solid #22c55e" : "1px solid var(--border)", width:90, height:90 }}>
            <img src={photo.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}
              onError={e => { e.currentTarget.style.display="none"; }}/>
            {i===0 && <span style={{ position:"absolute", bottom:2, left:2, fontSize:7,
              background:"rgba(34,197,94,0.85)", color:"white", padding:"1px 4px", borderRadius:4 }}>⭐</span>}
          </div>
        ))}
      </div>
      {photoMenu && (
        <div style={{ position:"fixed", inset:0, zIndex:3000, background:"rgba(0,0,0,0.5)" }}
          onClick={() => setPhotoMenu(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ position:"absolute", bottom:0, left:0, right:0,
            background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", padding:"20px 16px 32px" }}>
            <img src={photoMenu.url} alt="" style={{ width:"100%", maxHeight:180, objectFit:"contain", borderRadius:10, marginBottom:14 }}/>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {photoMenu.index !== 0 && (
                <button onClick={setPrimary} style={{ padding:"12px", borderRadius:10, border:"none",
                  cursor:"pointer", background:"rgba(34,197,94,0.12)", color:"#22c55e", fontSize:14, fontWeight:700 }}>
                  ⭐ Définir comme photo principale
                </button>
              )}
              <button onClick={deletePhoto} style={{ padding:"12px", borderRadius:10, border:"none",
                cursor:"pointer", background:"rgba(239,68,68,0.1)", color:"#ef4444", fontSize:14, fontWeight:700 }}>
                🗑 Supprimer cette photo
              </button>
              <button onClick={()=>setPhotoMenu(null)} style={{ padding:"12px", borderRadius:10,
                border:"1px solid var(--border)", cursor:"pointer", background:"var(--surface2)", color:"var(--muted)", fontSize:13 }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)",
          zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <img src={lightbox} alt="" style={{ maxWidth:"90vw", maxHeight:"90vh", objectFit:"contain", borderRadius:12 }}/>
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

function WeightEditRow({ spoolId, current, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current != null ? String(Math.round(current)) : "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = parseFloat(val);
    if (isNaN(n) || n < 0) return;
    setSaving(true);
    try {
      await client.post(`/filaments/spools/${spoolId}/weight`, { mode:"set", value: n });
      onUpdated?.();
      setEditing(false);
    } catch(e) { alert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
      <span style={{ fontSize:12, color:"var(--muted)", flexShrink:0 }}>Poids restant</span>
      {editing ? (
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <input type="number" min="0" value={val} autoFocus
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter") save(); if(e.key==="Escape") setEditing(false); }}
            style={{ width:80, padding:"4px 8px", borderRadius:7, fontSize:13,
              background:"var(--surface2)", border:"1px solid var(--border)",
              color:"var(--text)", outline:"none", textAlign:"right" }}/>
          <span style={{ fontSize:12, color:"var(--muted)" }}>g</span>
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
          <span style={{ fontSize:13, fontWeight:600, fontFamily:"JetBrains Mono,monospace",
            color:"var(--text)" }}>
            {current != null ? `${Math.round(current)} g` : <span style={{color:"var(--muted)",fontWeight:400}}>—</span>}
          </span>
          <button onClick={() => { setVal(current != null ? String(Math.round(current)) : ""); setEditing(true); }}
            style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)", padding:2, display:"flex" }}
            onMouseEnter={e=>e.currentTarget.style.color="#3b82f6"}
            onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}><Pencil size={13}/></button>
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
          {current != null ? (
            <span style={{ fontSize:13, fontWeight:600, fontFamily:"JetBrains Mono,monospace", color:"#22c55e" }}>
              {Number(current).toFixed(2)} €
            </span>
          ) : filamentPrice != null ? (
            <span style={{ fontSize:13, fontWeight:600, fontFamily:"JetBrains Mono,monospace", color:"#f59e0b" }}
              title="Prix du filament (non personnalisé)">
              {Number(filamentPrice).toFixed(2)} €
            </span>
          ) : (
            <span style={{ fontSize:12, color:"var(--muted)", fontStyle:"italic" }}>non défini</span>
          )}
          <button onClick={() => { setVal(current != null ? String(Number(current).toFixed(2)) : filamentPrice != null ? String(Number(filamentPrice).toFixed(2)) : ""); setEditing(true); }}
            style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)", padding:2, display:"flex" }}
            onMouseEnter={e=>e.currentTarget.style.color="#3b82f6"}
            onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
            <Pencil size={13}/>
          </button>
        </div>
      )}
    </div>
  );
}

export function SpoolBottomSheet({ spool, onClose, onArchive, onDelete }) {
  const [confirmDelete, setConfirmDelete] = React.useState(null);
  const [filSheet, setFilSheet] = React.useState(null);   // fiche filament ouverte par-dessus
  const openFilament = async () => {
    try {
      const r = await client.get(`/filaments/filaments/${spool.filament_id}`);
      setFilSheet(r.data);
    } catch (e) { alert(e.response?.data?.detail || e.message); }
  };
  const [deleting, setDeleting] = React.useState(false);
  const [showUsage, setShowUsage] = React.useState(false);
  const [usageHistory, setUsageHistory] = React.useState([]);
  const [loadingUsage, setLoadingUsage] = React.useState(false);

  const loadUsage = async () => {
    setLoadingUsage(true);
    try {
      const r = await client.get(`/filaments/spools/${spool.id}/usage`);
      // Calculer poids avant/après chaque print (chronologique)
      setUsageHistory(r.data || []);
      setShowUsage(true);
    } catch(e) { alert('Erreur: ' + e.message); }
    setLoadingUsage(false);
  };

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
        className="sheet-inner" className="sheet-inner" style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
          width:"100%", maxWidth:540, maxHeight:"90dvh", overflowY:"auto",
          paddingBottom:"env(safe-area-inset-bottom,20px)" }}>

        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
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
                {spool.filament_fila_type || spool.filament_material}
                {spool.filament_manufacturer ? ` · ${spool.filament_manufacturer}` : ""}
              </p>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:4 }}>
                {spool.archived && (
                  <span style={{ fontSize:10, background:"rgba(148,163,184,0.15)",
                    color:"#94a3b8", padding:"2px 8px", borderRadius:20,
                    fontWeight:600, display:"inline-block" }}>Archivée</span>
                )}
                {/* Indicateur echantillon (nuancier) du filament. */}
                <span style={{ display:"inline-flex", alignItems:"center", gap:4,
                  fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
                  background: spool.filament_swatch ? "rgba(34,197,94,0.12)" : "var(--surface2)",
                  color:      spool.filament_swatch ? "#22c55e" : "var(--muted)",
                  border: "1px solid " + (spool.filament_swatch ? "rgba(34,197,94,0.3)" : "var(--border)") }}>
                  <Palette size={10}/>
                  {spool.filament_swatch ? "Échantillon" : "Sans échantillon"}
                </span>
              </div>
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
          <Row label="Emplacement"    value={spool.location}/>
          <WeightEditRow spoolId={spool.id} current={remaining} onUpdated={onClose}/>
          <PriceEditRow spoolId={spool.id} current={spool.price_override} filamentPrice={spool.filament_price} onUpdated={onClose}/>
          <Row label="Tag NFC"        value={spool.tag_number} mono/>
          <Row label="Tray AMS"       value={spool.ams_tray}/>
          <Row label="Première util." value={spool.first_used_at?.slice(0,10)}/>
          <Row label="Dernière util." value={spool.last_used_at?.slice(0,10)}/>
          <Row label="Dernier séchage" value={spool.last_dried_at?.slice(0,10)}/>
          <Row label="Commentaire"    value={spool.comment}/>

          {/* ── Filament (catalogue) ── */}
          <div style={{ display:"flex", alignItems:"center", gap:8, margin:"16px 0 4px" }}>
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
              letterSpacing:"0.08em", margin:0 }}>Filament (catalogue)</p>
            {spool.filament_id && (
              <button
                onClick={openFilament}
                title="Ouvrir la fiche du filament"
                style={{ display:"inline-flex", alignItems:"center", justifyContent:"center",
                  width:22, height:22, borderRadius:6, cursor:"pointer",
                  background:"var(--surface2)", border:"1px solid var(--border)",
                  color:"var(--accent, #6366f1)", padding:0, flexShrink:0 }}>
                <Droplets size={13}/>
              </button>
            )}
          </div>
          <Row label="Nom"            value={spool.filament_translated_name || spool.filament_name}/>
          {spool.filament_translated_name && spool.filament_name !== spool.filament_translated_name &&
            <Row label="Nom EN"       value={spool.filament_name}/>}
          <Row label="Marque"         value={spool.filament_manufacturer}/>
          <Row label="Matière"        value={spool.filament_material}/>
          <Row label="Sous-type"      value={spool.filament_fila_type}/>
          <Row label="Échantillon"    value={spool.filament_swatch ? "Oui" : "Non"}
            accent={spool.filament_swatch ? "#22c55e" : "var(--muted)"}/>
          <Row label="Couleur"        value={color} mono/>
          {spool.filament_profile_id && <Row label="Code Bambu" value={spool.filament_profile_id} mono/>}
          {spool.filament_fila_color_code && <Row label="Code couleur Bambu" value={spool.filament_fila_color_code} mono/>}
          <Row label="Poids total"    value={spool.filament_weight_g ? `${spool.filament_weight_g}g` : null}/>
          <Row label="Prix catalogue" value={spool.filament_price ? `${Number(spool.filament_price).toFixed(2)}€` : null}/>


          {/* Historique utilisation */}
          <button onClick={loadUsage} disabled={loadingUsage}
            style={{ width:"100%", marginTop:16, padding:"10px", background:"var(--surface2)",
              border:"1px solid var(--border)", borderRadius:10, cursor:"pointer",
              color:"var(--text)", fontSize:13, fontWeight:600,
              display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            📋 {loadingUsage ? "Chargement…" : "Voir l'historique d'utilisation"}
          </button>

          {/* Actions */}
          <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
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
              ✕</button>
          </div>
          {showUsage && createPortal(
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:9999,
          display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={()=>setShowUsage(false)}>
          <div onClick={e=>e.stopPropagation()} className="sheet-inner"
            style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", width:"100%",
              maxWidth:640, maxHeight:"80dvh", overflowY:"auto", padding:"0 16px 24px" }}>
            <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 10px" }}>
              <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <h3 style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:0 }}>
                📋 Historique bobine #{spool.id}
              </h3>
              <span style={{ fontSize:12, color:"var(--muted)" }}>
                {usageHistory.length} print{usageHistory.length!==1?"s":""}
              </span>
            </div>
            {usageHistory.length === 0 && (
              <p style={{ color:"var(--muted)", fontSize:13, textAlign:"center", padding:"24px 0" }}>
                Aucune utilisation enregistrée
              </p>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {usageHistory.map((u,i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10,
                  padding:"8px 10px", background:"var(--surface2)",
                  borderRadius:10, border:"1px solid var(--border)" }}>
                  {/* Vignette */}
                  <img src={`/api/v1/prints/${u.print_id}/image`} alt=""
                    style={{ width:44, height:44, objectFit:"cover", borderRadius:6, flexShrink:0 }}
                    onError={e=>e.currentTarget.style.display="none"}/>
                  {/* Infos */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:12, fontWeight:600, color:"var(--text)", margin:0,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {u.file_name || "Print #"+u.print_id}
                    </p>
                    <p style={{ fontSize:10, color:"var(--muted)", margin:"2px 0 0" }}>
                      {u.print_date ? new Date(u.print_date).toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"}) : ""}
                      {u.status==="SUCCESS"?" · ✅":u.status==="FAILED"?" · ❌":""}
                    </p>

                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <p style={{ fontSize:13, fontWeight:700, color:"#ef4444", margin:0, fontFamily:"monospace" }}>
                      -{u.grams_used?.toFixed(1)}g
                    </p>
                    {u.cost > 0 && (
                      <p style={{ fontSize:10, color:"var(--muted)", margin:0, fontFamily:"monospace" }}>
                        {u.cost.toFixed(2)}€
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={()=>setShowUsage(false)} style={{ width:"100%", marginTop:16,
              padding:"11px", borderRadius:12, border:"none", background:"#3b82f6",
              color:"white", fontSize:13, fontWeight:700, cursor:"pointer" }}>Fermer</button>
          </div>
        </div>
        , document.body)}
      {filSheet && createPortal(
        <FilamentSheet f={filSheet} onClose={() => setFilSheet(null)}/>,
        document.body
      )}
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
// Pastilles compactes — meme langage visuel que les KPIs de l'Historique.
function KpiBar({ kpis }) {
  return (
    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
      {kpis.filter(k => k && k.value !== "—" && k.value != null).map(({ label, value, accent }) => {
        const color = accent || "#94a3b8";
        return (
          <div key={label} style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 10px",
            borderRadius:20, background:`${color}18`, border:`1px solid ${color}30` }}>
            <span style={{ fontSize:12, fontWeight:700, color, fontFamily:"monospace" }}>{value}</span>
            <span style={{ fontSize:11, color:"var(--muted)" }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function SpoolCard({ s, colorsList, onClick }) {
  const pct = s.remaining_weight_g != null
    ? Math.min(100, Math.round(s.remaining_weight_g / (s.filament_weight_g||1000) * 100)) : 0;
  const barColor = pct > 60 ? "#22c55e" : pct > 35 ? "#f59e0b" : pct > 15 ? "#f97316" : "#ef4444";
  const shd = null; // remplacé par filter drop-shadow
  const flt = "drop-shadow(0 1px 4px rgba(0,0,0,0.95)) drop-shadow(0 2px 10px rgba(0,0,0,0.6))";
  return (
    <div onClick={onClick} className="card-sm"
      style={{ overflow:"hidden", cursor:"pointer", padding:0, position:"relative",
        ...colorBg(colorsList, s.filament_multicolor_type),
        // Une bordure translucide sur un fond peint laisse transparaitre le fond
        // de page (liseré clair) : on la remplace par un liseré en inset shadow.
        border:"none",
        boxShadow:"inset 0 0 0 1px rgba(255,255,255,0.18), 0 1px 3px rgba(0,0,0,0.12)" }}>
      <div style={{ padding:"9px 10px 28px", display:"flex", flexDirection:"column", gap:0 }}>
        {/* Nom : toujours 2 lignes fixes */}
        <p style={{ fontWeight:600, fontSize:11, color:"white", margin:"0 0 7px",
          lineHeight:"1.35", height:"2.7em", overflow:"hidden",
          display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical",
          fontFamily:"'Inter','DM Sans','Segoe UI',system-ui,sans-serif",
          letterSpacing:"0.01em", filter:flt }}>
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
          {(s.filament_fila_type || s.filament_material) && (
            <span style={{ fontSize:8, fontWeight:500, padding:"1px 5px", borderRadius:3,
              background:"rgba(0,0,0,0.20)", color:"rgba(255,255,255,0.75)",
              whiteSpace:"nowrap", flexShrink:0 }}>
              {s.filament_fila_type || s.filament_material}
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
          <span style={{ fontSize:9, fontFamily:"'Inter','DM Sans',system-ui,sans-serif",
            fontWeight:700, color:"white", flexShrink:0, filter:flt,
            minWidth:28, textAlign:"right", letterSpacing:"0.02em" }}>
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


const SPOOL_SORTS = [
  ["recent",    "Plus récent"],
  ["hue",       "Teinte"],
  ["name",      "Nom"],
  ["brand",     "Marque"],
  ["remaining", "Poids restant ↓"],
  ["fullest",   "Poids restant ↑"],
];

function FilterSortSheet({ allItems, getFamily, filters, sort, onApply, onClose }) {
  const [fb, setFb] = useState(filters.brand  || "");
  const [fm, setFm] = useState(filters.mat    || "");
  const [fs, setFs] = useState(filters.sub    || "");
  const [fst,setFst]= useState(filters.stock  || "all"); // all/instock/unavailable
  const [so, setSo] = useState(sort            || "recent");

  // Options TOUJOURS depuis le dataset complet (pas filtré)
  const brands  = useMemo(() => [...new Set(allItems.map(s => s.filament_manufacturer || s.manufacturer).filter(Boolean))].sort(), [allItems]);
  const fams    = useMemo(() => [...new Set(allItems.map(s => getFamily(s)).filter(Boolean))].sort(), [allItems]);
  const subs    = useMemo(() => {
    const base = !fm ? allItems : allItems.filter(s => getFamily(s) === fm);
    return [...new Set(base.map(s => s.filament_fila_type || s.filament_material || s.fila_type || s.material).filter(Boolean))].sort();
  }, [allItems, fm]);

  const iStyle = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"8px 10px", fontSize:12, color:"var(--text)", outline:"none", width:"100%" };

  const activeCount = [fb,fm,fs].filter(Boolean).length;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:300, display:"flex", alignItems:"flex-end" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ width:"100%", background:"var(--sheet-bg)",
        borderRadius:"20px 20px 0 0", padding:"20px 16px 32px", display:"flex", flexDirection:"column", gap:14 }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)", margin:"0 auto 4px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontWeight:700, fontSize:15, color:"var(--text)" }}>Filtres & tri</span>
          {(fb||fm||fs) && <button onClick={()=>{setFb("");setFm("");setFs("");}}
            style={{ fontSize:11, color:"#60a5fa", background:"none", border:"none", cursor:"pointer" }}>
            Effacer filtres
          </button>}
        </div>

        {/* Tri */}
        <div>
          <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 8px" }}>Trier par</p>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {SPOOL_SORTS.map(([id,label]) => (
              <button key={id} onClick={()=>setSo(id)}
                style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:"none",
                  background:so===id?"#3b82f6":"var(--surface2)",
                  color:so===id?"white":"var(--muted)" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Filtres */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:0 }}>Filtrer</p>
          <select value={fb} onChange={e=>setFb(e.target.value)} style={iStyle}>
            <option value="">Toutes marques ({brands.length})</option>
            {brands.map(b=><option key={b} value={b}>{b}</option>)}
          </select>
          <select value={fm} onChange={e=>{setFm(e.target.value);setFs("");}} style={iStyle}>
            <option value="">Tous matériaux</option>
            {fams.map(f=><option key={f} value={f}>{f}</option>)}
          </select>
          {subs.length > 1 && (
            <select value={fs} onChange={e=>setFs(e.target.value)} style={iStyle}>
              <option value="">Tous sous-types</option>
              {subs.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <div style={{ display:"flex", gap:6 }}>
            {[["all","Tous"],["instock","En stock"],["unavailable","Non disponible"]].map(([id,label])=>(
              <button key={id} onClick={()=>setFst(id)}
                style={{ flex:1, padding:"7px", borderRadius:8, fontSize:11, fontWeight:600, cursor:"pointer", border:"none",
                  background:fst===id?"#3b82f6":"var(--surface2)", color:fst===id?"white":"var(--muted)" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={()=>onApply({brand:fb,mat:fm,sub:fs,stock:fst},so)}
          style={{ padding:"12px", borderRadius:12, fontSize:14, fontWeight:700,
            background:"#3b82f6", color:"white", border:"none", cursor:"pointer" }}>
          Appliquer
        </button>
      </div>
    </div>
  );
}

function SpoolsView({ filaments, showArchived }) {
  const [allSpools, setAllSpools] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ brand:"", mat:"", sub:"" });
  const [sort, setSort] = useState("recent");

  const FAMILIES = ["PLA","PETG","ABS","ASA","PA","PC","TPU","PVA","PLA-CF","PETG-CF","PA-CF","PPS"];
  const getFamily = s => {
    const sub = s.filament_material || s.filament_fila_type || "";
    return FAMILIES.find(f => sub === f || sub.startsWith(f+" ") || sub.startsWith(f+"-")) || sub.split(/[\s-]/)[0] || "";
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/filaments/spools", { params:{ archived:showArchived } });
      setAllSpools(data);
    } finally { setLoading(false); }
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  // Filtrage + recherche client-side (options depuis allSpools = pas de cascade cassée)
  const spools = useMemo(() => {
    let res = allSpools;
    if (q) {
      const ql = q.replace("#","").toLowerCase();
      res = res.filter(s => [
        s.filament_translated_name, s.filament_name, s.filament_manufacturer,
        s.filament_material, (s.filament_color||"").replace("#",""),
        s.filament_fila_color_code, s.location, s.tag_number,
      ].some(v => v && v.toLowerCase().includes(ql)));
    }
    if (filters.brand) res = res.filter(s => s.filament_manufacturer === filters.brand);
    if (filters.mat)   res = res.filter(s => getFamily(s) === filters.mat);
    if (filters.sub)   res = res.filter(s => (s.filament_fila_type || s.filament_material || "") === filters.sub);
    if (filters.stock === "instock")     res = res.filter(s => (s.remaining_weight_g||0) > 0);
    if (filters.stock === "unavailable") res = res.filter(s => !(s.remaining_weight_g > 0));
    // Tri
    res = [...res].sort((a,b) => {
      if (sort==="hue") {
        const hexToH = h => { h=(h||"888888").slice(0,6).padEnd(6,"0"); const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,l=(mx+mn)/2; if(!d) return l>0.9?370:l<0.1?380:360; const H=mx===r?((g-b)/d+(g<b?6:0)):mx===g?((b-r)/d+2):((r-g)/d+4); const s=l>0.5?d/(2-mx-mn):d/(mx+mn); if(s<0.12) return l>0.85?370:380; return H*60; };
        return hexToH(a.filament_color)-hexToH(b.filament_color);
      }
      if (sort==="name")      return (a.filament_translated_name||a.filament_name||"").localeCompare(b.filament_translated_name||b.filament_name||"");
      if (sort==="brand")     return (a.filament_manufacturer||"").localeCompare(b.filament_manufacturer||"");
      if (sort==="remaining") return (b.remaining_weight_g||0)-(a.remaining_weight_g||0);
      if (sort==="fullest")   return (a.remaining_weight_g||0)-(b.remaining_weight_g||0);
      return 0;
    });
    return res;
  }, [allSpools, q, filters, sort]);

  const activeFilters = [filters.brand, filters.mat, filters.sub].filter(Boolean).length;

  // KPIs dynamiques (recalculés à chaque changement de spools filtrés)
  const kpis = useMemo(() => {
    if (showArchived) {
      const prixTotal = spools.reduce((s, b) => s + (b.price_override || 0), 0);
      return [
        { label:"archivées", value: spools.length, accent:"#94a3b8" },
        { label:"valeur",    value: prixTotal > 0 ? `${prixTotal.toFixed(0)} €` : null, accent:"#94a3b8" },
      ];
    }
    const marques = new Set(spools.map(b => b.filament_manufacturer).filter(Boolean)).size;
    const poids = spools.reduce((s, b) => s + (b.remaining_weight_g ?? b.filament_weight_g ?? 0), 0);
    const prix  = spools.reduce((s, b) => s + (b.price_override || 0), 0);
    return [
      { label:"bobines",  value: spools.length, accent:"#3b82f6" },
      { label:"marques",  value: marques || null, accent:"#8b5cf6" },
      { label:"en stock", value: poids > 0 ? `${(poids/1000).toFixed(2)} kg` : null, accent:"#f59e0b" },
      { label:"valeur",   value: prix > 0 ? `${prix.toFixed(0)} €` : null, accent:"#22c55e" },
    ];
  }, [spools, showArchived]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <KpiBar kpis={kpis}/>
      <div style={{ display:"flex", gap:8 }}>
        <div style={{ position:"relative", flex:1 }}>
          <Search size={14} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher par nom, marque, couleur hex, code Bambu…"
            style={{ ...inp, paddingLeft:36 }} onFocus={inpFocus} onBlur={inpBlur}/>
        </div>
        <button onClick={()=>setFilterOpen(true)}
          style={{ display:"flex", alignItems:"center", gap:5, padding:"8px 14px",
            background: activeFilters > 0 ? "#3b82f6" : "var(--surface2)",
            color: activeFilters > 0 ? "white" : "var(--text)",
            border:"1px solid var(--border)", borderRadius:8, fontSize:12, cursor:"pointer", flexShrink:0 }}>
          <SlidersHorizontal size={14}/>
          {activeFilters > 0 ? `Filtres (${activeFilters})` : "Filtres"}
        </button>
        <button onClick={()=>setShowAdd(true)} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 14px", background:"#3b82f6", color:"white", border:"none", borderRadius:8, fontSize:13, cursor:"pointer", flexShrink:0 }}>
          <Plus size={14}/> Bobine
        </button>
      </div>
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
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
        {spools.map(s => {
          const colorsList = parseColorsList(s.filament_color, s.filament_colors_array);
          return (
            <SpoolCard key={s.id} s={s} colorsList={colorsList} onClick={()=>setSelected(s)}/>
          );
        })}
      </div>
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
export function FilamentSheet({ f, onClose, onDeleted, onUpdated }) {
  const [addSpool, setAddSpool] = useState(false);
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

  const F = (label, k, type="text", options=null) => (
    <div style={{ marginBottom:10 }}>
      <label style={lStyle}>{label}</label>
      {options ? (
        <select style={iStyle} value={form[k]} onChange={e => setForm(p=>({...p,[k]:e.target.value}))}>
          {options.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
      ) : (
        <input style={iStyle} type={type} value={form[k]}
          onChange={e => setForm(p=>({...p,[k]:e.target.value}))}/>
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
        className="sheet-inner" className="sheet-inner" style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
          width:"100%", maxWidth:540, maxHeight:"92dvh", overflowY:"auto",
          paddingBottom:"env(safe-area-inset-bottom,20px)" }}>

        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>

        <div style={{ padding:"16px 20px 24px" }}>
          {/* En-tête */}
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
            <div style={{ width:56, height:56, borderRadius:14, flexShrink:0,
              overflow:"hidden", boxShadow:"0 2px 12px rgba(0,0,0,0.2), inset 0 0 0 2px var(--border)", ...colorBg(colorsList, f.multicolor_type) }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:18, fontWeight:800, color:"var(--text)", margin:0,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {f.translated_name || f.name}
              </p>
              {f.translated_name && f.translated_name !== f.name && (
                <p style={{ fontSize:11, color:"var(--muted)", margin:"2px 0 0" }}>{f.name}</p>
              )}
              <p style={{ fontSize:12, color:"var(--muted)", margin:"4px 0 0" }}>
                {[f.manufacturer, f.material].filter(Boolean).join(" · ")}
              </p>
              {/* Indicateur echantillon (nuancier) imprime ou non. */}
              <span style={{ display:"inline-flex", alignItems:"center", gap:4, marginTop:6,
                padding:"3px 9px", borderRadius:20, fontSize:10, fontWeight:700,
                background: f.swatch ? "rgba(34,197,94,0.12)" : "var(--surface2)",
                color:      f.swatch ? "#22c55e" : "var(--muted)",
                border: "1px solid " + (f.swatch ? "rgba(34,197,94,0.3)" : "var(--border)") }}>
                <Palette size={11}/>
                {f.swatch ? "Échantillon" : "Sans échantillon"}
              </span>
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
              {F("Profile ID Bambu (ex: GFA00)","profile_id")}
              {F("Code couleur Bambu (ex: 10600)","fila_color_code")}
              {F("Poids total (g)","filament_weight_g","number")}
              {F("Poids support (g)","spool_weight_g","number")}
              {F("Prix (€)","price","number")}
              {F("Commentaire","comment")}
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
                letterSpacing:"0.08em", marginBottom:4 }}>Filament #{f.id}</p>
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
                {f.active_spool_count > 0 && f.remaining_weight_total_g > 0 && (
                  <span style={{ fontSize:12, fontWeight:700, fontFamily:"JetBrains Mono,monospace",
                    color:"var(--text)" }}>
                    · {f.remaining_weight_total_g >= 1000
                        ? `${(f.remaining_weight_total_g/1000).toFixed(2)} kg`
                        : `${Math.round(f.remaining_weight_total_g)} g`} restants
                  </span>
                )}
                <button onClick={() => setAddSpool(true)}
                  style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5,
                    padding:"5px 12px", borderRadius:20, border:"none", cursor:"pointer",
                    background:"rgba(34,197,94,0.12)", color:"#22c55e",
                    fontSize:11, fontWeight:700 }}>
                  <Plus size={13}/> Créer une bobine
                </button>
              </div>

              {addSpool && (
                <AddSpoolModal preselect={f.id}
                  onClose={() => setAddSpool(false)}
                  onSave={() => { setAddSpool(false); onUpdated?.(); }}/>
              )}

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
              ✕</button>
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
  const [allFilaments, setAllFilaments] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedFil, setSelectedFil] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ brand:"", mat:"", sub:"" });
  const [sort, setSort] = useState("name");

  const FAMILIES_F = ["PLA","PETG","ABS","ASA","PA","PC","TPU","PVA","PLA-CF","PETG-CF","PA-CF","PPS"];
  const getFamilyF = f => {
    const sub = f.fila_type || f.material || "";
    return FAMILIES_F.find(m => sub === m || sub.startsWith(m+" ") || sub.startsWith(m+"-")) || sub.split(/[\s-]/)[0] || "";
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/filaments/filaments");
      setAllFilaments(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filaments = useMemo(() => {
    let res = allFilaments;
    if (q) {
      const ql = q.toLowerCase();
      res = res.filter(f => [f.translated_name,f.name,f.manufacturer,f.material,f.fila_type,f.fila_color_code].some(v=>v&&v.toLowerCase().includes(ql)));
    }
    if (filters.brand) res = res.filter(f => f.manufacturer === filters.brand);
    if (filters.mat)   res = res.filter(f => getFamilyF(f) === filters.mat);
    if (filters.sub)   res = res.filter(f => (f.fila_type||f.material||"") === filters.sub);
    return [...res].sort((a,b) => {
      if (sort==="brand")     return (a.manufacturer||"").localeCompare(b.manufacturer||"");
      if (sort==="remaining") return (b.remaining_weight_total_g||0)-(a.remaining_weight_total_g||0);
      if (sort==="fullest")   return (a.remaining_weight_total_g||0)-(b.remaining_weight_total_g||0);
      return (a.translated_name||a.name||"").localeCompare(b.translated_name||b.name||"");
    });
  }, [allFilaments, q, filters, sort]);

  const activeFilters = [filters.brand,filters.mat,filters.sub].filter(Boolean).length;

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
      <KpiBar kpis={kpis}/>
      <div style={{ display:"flex", gap:8 }}>
        <div style={{ position:"relative", flex:1 }}>
          <Search size={14} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Nom, marque, code couleur…"
            style={{ ...inp, paddingLeft:36 }} onFocus={inpFocus} onBlur={inpBlur}/>
        </div>
        <button onClick={()=>setFilterOpen(true)}
          style={{ display:"flex", alignItems:"center", gap:5, padding:"8px 14px",
            background:activeFilters>0?"#3b82f6":"var(--surface2)", color:activeFilters>0?"white":"var(--text)",
            border:"1px solid var(--border)", borderRadius:8, fontSize:12, cursor:"pointer", flexShrink:0 }}>
          <SlidersHorizontal size={14}/>{activeFilters>0?` Filtres (${activeFilters})`:" Filtres"}
        </button>
        <button onClick={() => setCreateOpen(true)}
          style={{ padding:"8px 14px", borderRadius:10, background:"#3b82f6", border:"none",
            color:"white", fontSize:13, fontWeight:700, cursor:"pointer",
            display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <Plus size={14}/> Filament
        </button>
      </div>
      {filterOpen && (
        <FilterSortSheet allItems={allFilaments} getFamily={getFamilyF} filters={filters} sort={sort}
          onApply={(f,s)=>{ setFilters(f); if(s) setSort(s); setFilterOpen(false); }}
          onClose={()=>setFilterOpen(false)}/>
      )}

      {loading ? (
        <p style={{ textAlign:"center", color:"var(--muted)", fontSize:13, padding:"32px 0" }}>Chargement…</p>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
          {filaments.map(f => {
            const colorsList = parseColorsList(f.color, f.colors_array);
            return (
              (() => {
                const pct = f.active_spool_count > 0 ? Math.min(100, f.active_spool_count * 20) : 0;
                const flt = "drop-shadow(0 1px 4px rgba(0,0,0,0.95)) drop-shadow(0 2px 10px rgba(0,0,0,0.6))";
                const hasT = hasTransparency(f.color) && !f.colors_array;
                return (
                  <div key={f.id} onClick={() => setSelectedFil(f)} className="card-sm"
                    style={{ overflow:"hidden", cursor:"pointer", padding:0, position:"relative" }}>
                    {/* fond couleur pur + couche checker si transparent */}
                    {hasT && <div style={{ position:"absolute", inset:0, backgroundImage:"repeating-conic-gradient(#aaa 0% 25%,#eee 0% 50%)", backgroundSize:"6px 6px" }}/>}
                    <div style={{ position:"absolute", inset:0, ...colorBg(colorsList, f.multicolor_type) }}/>
                    <div style={{ position:"relative", padding:"8px 10px 28px", display:"flex", flexDirection:"column", gap:0 }}>
                      <p style={{ fontWeight:600, fontSize:11, color:"white", margin:"0 0 7px",
                        lineHeight:"1.35", height:"2.7em", overflow:"hidden",
                        display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical",
                        fontFamily:"'Inter','DM Sans','Segoe UI',system-ui,sans-serif",
                        letterSpacing:"0.01em", filter:flt }}>
                        {f.translated_name || f.name}
                      </p>
                      <div style={{ display:"flex", gap:3, flexWrap:"nowrap", overflow:"hidden", height:16, alignItems:"center" }}>
                        {f.manufacturer && <span style={{ fontSize:8, fontWeight:500, padding:"1px 5px", borderRadius:3, background:"rgba(0,0,0,0.28)", color:"rgba(255,255,255,0.85)", whiteSpace:"nowrap", flexShrink:0 }}>{f.manufacturer}</span>}
                        {(f.fila_type||f.material) && <span style={{ fontSize:8, fontWeight:500, padding:"1px 5px", borderRadius:3, background:"rgba(0,0,0,0.20)", color:"rgba(255,255,255,0.75)", whiteSpace:"nowrap", flexShrink:0 }}>{f.fila_type||f.material}</span>}
                      </div>
                    </div>
                    <span style={{ position:"absolute", bottom:6, left:8, fontSize:8, fontWeight:500, background:"rgba(0,0,0,0.28)", color:"rgba(255,255,255,0.85)", padding:"1px 7px", borderRadius:20 }}>
                      {f.active_spool_count>0 ? `${f.active_spool_count} bobine${f.active_spool_count>1?"s":""}` : "aucune bobine"}
                    </span>
                  </div>
                );
              })()
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
      <div onClick={e=>e.stopPropagation()} className="sheet-inner" className="sheet-inner" style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:540, maxHeight:"92dvh", overflowY:"auto",
        paddingBottom:"env(safe-area-inset-bottom,16px)", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 4px" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
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

function SwatchView({ filaments: allFilaments, sort, selectMode, onSelectModeChange, onItemClick, onReload }) {
  // Filaments déjà filtrés ET triés par le parent



  return (
    <>
      <GalleryCompare
        items={allFilaments}
        onDeletePhoto={async (item, filename) =>
          client.delete(`/filaments/${item.id}/photo/${filename}`)}
        onSetPrimaryPhoto={async (item, filename) =>
          client.post(`/filaments/${item.id}/photo/${filename}/primary`)}
        onPhotosChanged={() => onReload?.()}
        selectMode={selectMode}
        onSelectModeChange={onSelectModeChange}
        onItemClick={onItemClick}
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


export function FilamentSheetFromSpool({ filamentId, spoolId, filamentColorHex, onClose }) {
  const [spool, setSpool] = React.useState(null);
  React.useEffect(() => {
    const load = async () => {
      try {
        // Chercher la bobine directement
        if (spoolId) {
          const r = await client.get("/filaments/spools", { params:{ limit:2000, archived:false } });
          const r2 = await client.get("/filaments/spools", { params:{ limit:2000, archived:true } });
          const allSpools = [...(r.data||[]), ...(r2.data||[])];
          const found = allSpools.find(s => s.id === spoolId);
          if (found) { setSpool(found); return; }
        }
        if (filamentId) {
          const r = await client.get("/filaments/filaments/" + filamentId);
          setFil(r.data); return;
        }
        if (spoolId) {
          const spools = await client.get("/filaments/spools", { params:{ limit:1000 } });
          const spool = (spools.data || []).find(s => s.id === spoolId);
          if (spool?.filament_id) {
            const r = await client.get("/filaments/filaments/" + spool.filament_id);
            setFil(r.data); return;
          }
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
  if (!spool) return null;
  return <SpoolBottomSheet spool={spool} onClose={onClose} onArchive={onClose} onDelete={onClose}/>;
}

export default function Filaments() {
  const [tab, setTab] = useState("spools");
  const [searchParams, setSearchParams] = useSearchParams();
  const [deepFil, setDeepFil] = useState(null);   // fiche ouverte via /filaments?id=XXX
  const [deepErr, setDeepErr] = useState(null);
  const [galleryMode, setGalleryMode] = useState("photos");
  const [allFilaments, setAllFilaments] = useState([]);
  const [galQ, setGalQ] = useState("");
  const [galFilterOpen, setGalFilterOpen] = useState(false);
  const [galFilters, setGalFilters] = useState({ brand:"", mat:"", sub:"", stock:"all" });
  const [galSort, setGalSort] = useState("hue");
  const [galSelectMode, setGalSelectMode] = useState(false);
  const [galSelected, setGalSelected] = useState(null);

  // Liens directs :
  //   /filaments?spool=YY[&id=XX] -> ouvre la fiche BOBINE (scan RFID, creation).
  //   /filaments?id=XX (sans spool) -> ouvre la fiche FILAMENT (scan QR d'un
  //     swatch, marque-page…).
  // La fiche bobine a la priorite : un scan de bobine doit montrer LA bobine, pas
  // son filament. On passe par l'API plutot que par la liste deja chargee : la
  // cible peut etre absente du filtre/onglet courant.
  const deepId    = searchParams.get("id");
  const deepSpool = searchParams.get("spool");

  useEffect(() => {
    // Fiche filament uniquement si on N'ouvre PAS une bobine.
    if (!deepId || deepSpool) { setDeepFil(null); setDeepErr(null); return; }
    let cancelled = false;
    client.get(`/filaments/filaments/${deepId}`)
      .then(r => { if (!cancelled) { setDeepFil(r.data); setDeepErr(null); } })
      .catch(() => { if (!cancelled) { setDeepFil(null); setDeepErr(`#${deepId}`); } });
    return () => { cancelled = true; };
  }, [deepId, deepSpool]);

  const closeDeep = () => {
    setDeepFil(null); setDeepErr(null);
    const next = new URLSearchParams(searchParams);
    next.delete("id"); next.delete("spool");
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
  // Écoute NFC continue via le shell WebView (absente en PWA pure).
  const onNativeScan = React.useCallback((detail) => {
    if (detail.error) { setDeepErr(detail.error); return; }
    const redirect = detail.redirect || "/";
    // On ne navigue pas hors de l'app : on rejoue le lien interne, comme le POST
    // Android le faisait via l'URL. La feuille (fiche ou création) s'ouvre par-dessus.
    const qs = redirect.split("?")[1] || "";
    setSearchParams(new URLSearchParams(qs), { replace: true });
  }, [setSearchParams]);
  const rfidScan = useNativeScan(onNativeScan);

  const onRfidCreated = (res) => {
    // On enchaine sur la fiche du filament fraichement cree.
    setSearchParams(
      { id: String(res.filament_id), ...(res.spool_id ? { spool: String(res.spool_id) } : {}) },
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
    setSearchParams({ id }, { replace: false });
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
      res = res.filter(f => [f.translated_name,f.name,f.manufacturer,f.material,f.fila_type].some(v=>v&&v.toLowerCase().includes(ql)));
    }
    if (galFilters.brand) res = res.filter(f => f.manufacturer === galFilters.brand);
    if (galFilters.mat)   res = res.filter(f => getFamilyG(f) === galFilters.mat);
    if (galFilters.sub)   res = res.filter(f => (f.fila_type||f.material||"") === galFilters.sub);
    if (galFilters.stock === "instock")     res = res.filter(f => (f.active_spool_count||0) > 0);
    if (galFilters.stock === "unavailable") res = res.filter(f => !(f.active_spool_count > 0));
    // Tri
    res = [...res].sort((a,b) => {
      if (galSort === "hue") {
        const hexH = h => { const hx=(h||"888888").replace("#","").slice(0,6).padEnd(6,"0"); const r=parseInt(hx.slice(0,2),16)/255,g=parseInt(hx.slice(2,4),16)/255,b2=parseInt(hx.slice(4,6),16)/255,mx=Math.max(r,g,b2),mn=Math.min(r,g,b2),d=mx-mn,l=(mx+mn)/2; if(!d) return l>0.9?370:l<0.1?380:360; const H=mx===r?((g-b2)/d+(g<b2?6:0)):mx===g?((b2-r)/d+2):((r-g)/d+4); const s=l>0.5?d/(2-mx-mn):d/(mx+mn); if(s<0.12) return l>0.85?370:380; return H*60; };
        return hexH(a.color)-hexH(b.color);
      }
      if (galSort === "name")     return (a.translated_name||a.name||"").localeCompare(b.translated_name||b.name||"");
      if (galSort === "brand")    return (a.manufacturer||"").localeCompare(b.manufacturer||"");
      if (galSort === "remaining") return (b.remaining_weight_total_g||0)-(a.remaining_weight_total_g||0);
      if (galSort === "fullest")   return (a.remaining_weight_total_g||0)-(b.remaining_weight_total_g||0);
      if (galSort === "recent")   return new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0);
      return 0;
    });
    return res;
  }, [allFilaments, galQ, galFilters, galSort]);

  const galActiveFilters = [galFilters.brand,galFilters.mat,galFilters.sub].filter(Boolean).length;

  const tabs = [
    { id:"spools",   label:"Stock" },
    { id:"archived", label:"Archivées" },
    { id:"catalog",  label:"Filaments" },
    { id:"gallery",  label:"Galerie" },
  ];

  return (
    <div style={{ maxWidth:960, margin:"0 auto", display:"flex", flexDirection:"column", gap:16 }}>
      {/* Mobile : le bouton part dans le header (une ligne de gagnee).
          Desktop : le header mobile n'existe pas, on le garde dans le flux. */}
      <HeaderAction>
        {rfidScan.available && (
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
        <button onClick={() => setScanOpen(true)} aria-label="Scanner un échantillon" title="Scanner un échantillon"
          style={{ display:"flex", alignItems:"center", justifyContent:"center",
            width:34, height:34, borderRadius:"50%", border:"none", cursor:"pointer",
            background:"#3b82f6", color:"white" }}>
          <ScanLine size={17}/>
        </button>
      </HeaderAction>

      <div className="hidden-mobile" style={{ display:"none", alignItems:"center",
        justifyContent:"flex-end", gap:10 }}>
        <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)",
          margin:0, marginRight:"auto" }}>Filaments</h1>
        {rfidScan.available && (
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
        <button onClick={() => setScanOpen(true)}
          aria-label="Scanner un échantillon" title="Scanner un échantillon"
          style={{ display:"flex", alignItems:"center", justifyContent:"center",
            width:38, height:38, borderRadius:"50%", border:"none", cursor:"pointer",
            background:"#3b82f6", color:"white" }}>
          <ScanLine size={18}/>
        </button>
      </div>

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
          {/* Barre recherche + filtres partagés Photos/Nuancier */}
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ position:"relative", flex:1 }}>
              <Search size={14} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
              <input value={galQ} onChange={e=>setGalQ(e.target.value)} placeholder="Nom, marque, matériau…"
                style={{ ...inp, paddingLeft:36 }} onFocus={inpFocus} onBlur={inpBlur}/>
            </div>
            <button onClick={()=>setGalFilterOpen(true)}
              style={{ display:"flex", alignItems:"center", gap:5, padding:"8px 14px",
                background:galActiveFilters>0?"#3b82f6":"var(--surface2)", color:galActiveFilters>0?"white":"var(--text)",
                border:"1px solid var(--border)", borderRadius:8, fontSize:12, cursor:"pointer", flexShrink:0 }}>
              <SlidersHorizontal size={14}/>{galActiveFilters>0?` Filtres (${galActiveFilters})`:" Filtres"}
            </button>
          </div>
          {galFilterOpen && (
            <FilterSortSheet allItems={allFilaments} getFamily={getFamilyG} filters={galFilters} sort={galSort}
              onApply={(f,s)=>{ setGalFilters(f); if(s) setGalSort(s); setGalFilterOpen(false); }}
              onClose={()=>setGalFilterOpen(false)}/>
          )}
          {/* Switch Photos / Nuancier + bouton Sélectionner */}
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            {[["photos","Photos"],["swatch","Nuancier"]].map(([id,label]) => (
              <button key={id} onClick={()=>{ setGalleryMode(id); setGalSelectMode(false); }} style={{
                padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer",
                background: galleryMode===id ? "#3b82f6" : "var(--surface2)",
                color: galleryMode===id ? "white" : "var(--muted)",
                border:"1px solid var(--border)",
              }}>
                {label}
              </button>
            ))}
            <div style={{ marginLeft:"auto" }}>
              {galSelectMode ? (
                <button onClick={()=>setGalSelectMode(false)}
                  style={{ padding:"5px 12px", borderRadius:20, fontSize:11, border:"1px solid var(--border)",
                    background:"var(--surface2)", color:"var(--muted)", cursor:"pointer" }}>
                  Annuler
                </button>
              ) : (
                <button onClick={()=>setGalSelectMode(true)}
                  style={{ padding:"5px 12px", borderRadius:20, fontSize:11, border:"1px solid var(--border)",
                    background:"var(--surface2)", color:"var(--text)", cursor:"pointer" }}>
                  Sélectionner
                </button>
              )}
            </div>
          </div>

          {galleryMode==="photos" ? (
            <GalleryCompare
              items={filaments}
              onDeletePhoto={async (item, filename) =>
                client.delete(`/filaments/${item.id}/photo/${filename}`)}
              onSetPrimaryPhoto={async (item, filename) =>
                client.post(`/filaments/${item.id}/photo/${filename}/primary`)}
              onPhotosChanged={() => client.get("/filaments/filaments")
                .then(r => setAllFilaments(r.data || [])).catch(()=>{})}
              selectMode={galSelectMode}
              onSelectModeChange={setGalSelectMode}
              onItemClick={f=>setGalSelected(f)}
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
          {galSelected && <FilamentSheet f={galSelected} onClose={()=>setGalSelected(null)} onDeleted={()=>{setGalSelected(null); client.get("/filaments/filaments").then(r=>setAllFilaments(r.data));}} onUpdated={()=>client.get("/filaments/filaments").then(r=>setAllFilaments(r.data))}/>}
          {galleryMode==="swatch" && <SwatchView filaments={filaments} sort={galSort} selectMode={galSelectMode} onSelectModeChange={setGalSelectMode} onItemClick={f=>setGalSelected(f)}
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
      {deepErr && (
        <div style={{ padding:"12px 16px", borderRadius:10,
          background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)",
          color:"#ef4444", fontSize:13, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ flex:1 }}>Aucun filament {deepErr}.</span>
          <button onClick={closeDeep} style={{ background:"none", border:"none",
            color:"#ef4444", cursor:"pointer", fontWeight:700 }}>Fermer</button>
        </div>
      )}
    </div>
  );
}
