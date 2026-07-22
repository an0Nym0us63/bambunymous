import React, { useState, useEffect, useCallback } from "react";
import { Search, Package, ShoppingBag, ExternalLink, Image as ImageIcon, Plus } from "lucide-react";
import client from "../api/client";
import { isMoneyHidden, MONEY_MASK } from "../utils/money";
import AdminOnly from "../components/AdminOnly";
import { PrintDetail, GroupBottomSheet } from "./Prints";
import { useTrackDetail } from "../utils/track";

// Les montants sont masques pour les comptes en lecture seule.
function fmtPrice(v) {
  if (isMoneyHidden()) return MONEY_MASK;
  return v != null ? `${Number(v).toFixed(2)} €` : "—";
}

// ── Accessory Card ────────────────────────────────────────────────────────

// ── Fiche accessoire ──────────────────────────────────────────────────────
// Consultation (photo, stock, valeur, objets qui l'utilisent), edition,
// reapprovisionnement (prix moyen pondere), photo et suppression.
function AccessorySheet({ accId, onClose, onChanged }) {
  const [d, setD] = React.useState(null);
  // Le nom n'arrive qu'apres le chargement : on annonce d'abord l'identifiant,
  // le libelle se precise ensuite. Deux lignes de journal, mais aucune vue
  // perdue si le chargement echoue.
  useTrackDetail(`Fiche accessoire · ${d?.name || "#" + accId}`);
  const [mode, setMode] = React.useState("view");     // view | edit | restock
  const [form, setForm] = React.useState({ name:"", quantity:"", unit_price:"" });
  const [restock, setRestock] = React.useState({ qty:"", total_price:"" });
  const [busy, setBusy] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const fileRef = React.useRef(null);
  const [imgV, setImgV] = React.useState(0);          // cache-buster photo

  const load = React.useCallback(async () => {
    try {
      const r = await client.get(`/objects/accessories/${accId}/detail`);
      setD(r.data);
      setForm({
        name: r.data.name || "",
        quantity: String(r.data.quantity ?? 0),
        unit_price: String(r.data.unit_price ?? 0),
      });
    } catch { setD(null); }
  }, [accId]);
  React.useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      await client.patch(`/objects/accessories/${accId}`, {
        name: form.name,
        quantity: parseInt(form.quantity || "0", 10),
        unit_price: parseFloat(form.unit_price || "0"),
      });
      setMode("view"); await load(); onChanged?.();
    } catch(e) { alert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };

  const doRestock = async () => {
    const qty = parseInt(restock.qty || "0", 10);
    if (!qty) return;
    setBusy(true);
    try {
      await client.post(`/objects/accessories/${accId}/stock`, {
        qty, total_price: parseFloat(restock.total_price || "0"),
      });
      setRestock({ qty:"", total_price:"" }); setMode("view");
      await load(); onChanged?.();
    } catch(e) { alert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      await client.post(`/objects/accessories/${accId}/photo/upload`, fd,
        { headers: { "Content-Type": "multipart/form-data" } });
      setImgV(v => v + 1); await load(); onChanged?.();
    } catch(e) { alert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await client.delete(`/objects/accessories/${accId}`);
      onChanged?.(); onClose();
    } catch(e) {
      alert(e.response?.data?.detail || "Suppression impossible (accessoire peut-être lié à des objets).");
      setBusy(false); setConfirmDel(false);
    }
  };

  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"8px 12px", fontSize:13, color:"var(--text)", outline:"none", width:"100%", boxSizing:"border-box" };
  const lbl = { fontSize:10, color:"var(--muted)", textTransform:"uppercase",
    letterSpacing:"0.05em", marginBottom:4, display:"block" };

  // Prix moyen estime apres reappro (meme calcul que le backend).
  const newAvg = (() => {
    if (!d) return null;
    const q = parseInt(restock.qty || "0", 10);
    const tp = parseFloat(restock.total_price || "0");
    if (!q || !tp) return null;
    return ((d.quantity * d.unit_price) + tp) / (d.quantity + q);
  })();

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:340,
      background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end" }}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ width:"100%", background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
          padding:"16px 16px 32px", maxHeight:"88vh", overflowY:"auto" }}>

        {!d ? <p style={{ color:"var(--muted)", fontSize:13, padding:20, textAlign:"center" }}>Chargement…</p> : (<>

          {/* En-tete : photo + nom */}
          <div style={{ display:"flex", gap:14, alignItems:"flex-start", marginBottom:16 }}>
            <div style={{ width:88, height:88, borderRadius:12, flexShrink:0, overflow:"hidden",
              background:"var(--surface2)", border:"1px solid var(--border)", padding:6,
              display:"flex", alignItems:"center", justifyContent:"center", boxSizing:"border-box" }}>
              {d.has_image
                ? <img src={`/api/v1/objects/accessories/${accId}/image?v=${imgV}`} alt=""
                    style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }}/>
                : <Package size={30} style={{ color:"var(--muted)" }}/>}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:17, fontWeight:800, color:"var(--text)", margin:0,
                wordBreak:"break-word" }}>{d.name}</p>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
                <span style={{ fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:20,
                  background: d.quantity > 0 ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                  color: d.quantity > 0 ? "#22c55e" : "#ef4444" }}>
                  Stock : {d.quantity}
                </span>
                {d.used_in_objects > 0 && (
                  <span style={{ fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:20,
                    background:"rgba(139,92,246,0.12)", color:"#a78bfa" }}>
                    Utilisé × {d.used_quantity}
                  </span>
                )}
              </div>
              <AdminOnly><button onClick={()=>fileRef.current?.click()} disabled={busy}
                style={{ marginTop:8, display:"inline-flex", alignItems:"center", gap:5,
                  padding:"4px 10px", borderRadius:8, fontSize:11, fontWeight:600, cursor:"pointer",
                  border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)" }}>
                <ImageIcon size={12}/> {d.has_image ? "Changer la photo" : "Ajouter une photo"}
              </button></AdminOnly>
              <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
                onChange={e => { upload(e.target.files?.[0]); e.target.value=""; }}/>
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:16 }}>
            {[["Stock", String(d.quantity)],
              ["Prix unitaire", fmtPrice(d.unit_price)],
              ["Valeur", fmtPrice(d.stock_value)]].map(([k,v]) => (
              <div key={k} style={{ background:"var(--surface2)", borderRadius:10, padding:"8px 10px" }}>
                <p style={{ fontSize:9, color:"var(--muted)", margin:"0 0 3px" }}>{k}</p>
                <p style={{ fontSize:14, fontWeight:800, color:"var(--text)", margin:0,
                  fontFamily:"monospace" }}>{v}</p>
              </div>
            ))}
          </div>

          {/* Mode edition */}
          {mode === "edit" && (
            <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:16 }}>
              <div><label style={lbl}>Nom</label>
                <input style={inp} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ flex:1 }}><label style={lbl}>Stock</label>
                  <input style={inp} type="number" value={form.quantity}
                    onChange={e=>setForm(f=>({...f,quantity:e.target.value}))}/></div>
                <div style={{ flex:1 }}><label style={lbl}>Prix unitaire (€)</label>
                  <input style={inp} type="number" step="0.01" value={form.unit_price}
                    onChange={e=>setForm(f=>({...f,unit_price:e.target.value}))}/></div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>{ setMode("view"); load(); }}
                  style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid var(--border)",
                    background:"var(--surface2)", color:"var(--muted)", fontSize:13, cursor:"pointer" }}>Annuler</button>
                <button onClick={save} disabled={busy}
                  style={{ flex:2, padding:"10px", borderRadius:10, border:"none", background:"#3b82f6",
                    color:"white", fontSize:13, fontWeight:700, cursor:"pointer", opacity:busy?0.6:1 }}>
                  {busy ? "Enregistrement…" : "Enregistrer"}</button>
              </div>
            </div>
          )}

          {/* Mode reapprovisionnement */}
          {mode === "restock" && (
            <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:16 }}>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ flex:1 }}><label style={lbl}>Quantité reçue</label>
                  <input style={inp} type="number" min={1} value={restock.qty} autoFocus
                    onChange={e=>setRestock(r=>({...r,qty:e.target.value}))}/></div>
                <div style={{ flex:1 }}><label style={lbl}>Coût du lot (€)</label>
                  <input style={inp} type="number" step="0.01" value={restock.total_price}
                    onChange={e=>setRestock(r=>({...r,total_price:e.target.value}))}/></div>
              </div>
              <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>
                {newAvg != null
                  ? `Nouveau stock : ${d.quantity + parseInt(restock.qty||"0",10)} · prix moyen ${fmtPrice(newAvg)}/u`
                  : "Laisser le coût vide pour ajouter du stock sans changer le prix unitaire."}
              </p>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>setMode("view")}
                  style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid var(--border)",
                    background:"var(--surface2)", color:"var(--muted)", fontSize:13, cursor:"pointer" }}>Annuler</button>
                <button onClick={doRestock} disabled={busy || !restock.qty}
                  style={{ flex:2, padding:"10px", borderRadius:10, border:"none", background:"#22c55e",
                    color:"white", fontSize:13, fontWeight:700, cursor:"pointer",
                    opacity:(busy||!restock.qty)?0.6:1 }}>Ajouter au stock</button>
              </div>
            </div>
          )}

          {/* Objets qui utilisent l'accessoire */}
          {(d.objects || []).length > 0 && (
            <div style={{ marginBottom:16 }}>
              <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
                letterSpacing:"0.06em", margin:"0 0 8px" }}>
                Utilisé dans {d.used_in_objects} objet{d.used_in_objects>1?"s":""}
              </p>
              {d.objects.slice(0,20).map(o => (
                <div key={o.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
                  background:"var(--surface2)", borderRadius:8, marginBottom:5,
                  border:"1px solid var(--border)" }}>
                  <span style={{ fontSize:12, flex:1, overflow:"hidden", textOverflow:"ellipsis",
                    whiteSpace:"nowrap" }}>{o.name}</span>
                  <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>×{o.quantity}</span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          {mode === "view" && (
            <AdminOnly><div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setMode("edit")}
                style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid var(--border)",
                  background:"var(--surface2)", color:"var(--text)", fontSize:12, fontWeight:700,
                  cursor:"pointer" }}>✏️ Modifier</button>
              <button onClick={()=>setMode("restock")}
                style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(34,197,94,0.3)",
                  background:"rgba(34,197,94,0.06)", color:"#22c55e", fontSize:12, fontWeight:700,
                  cursor:"pointer" }}>+ Stock</button>
              <button onClick={()=> confirmDel ? remove() : setConfirmDel(true)} disabled={busy}
                style={{ padding:"10px 14px", borderRadius:10, border:"1px solid rgba(239,68,68,0.3)",
                  background: confirmDel ? "#ef4444" : "rgba(239,68,68,0.06)",
                  color: confirmDel ? "white" : "#ef4444", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                {confirmDel ? "Confirmer ?" : "🗑"}
              </button>
            </div></AdminOnly>
          )}
        </>)}
      </div>
    </div>
  );
}

// ── Creation d'un accessoire ──────────────────────────────────────────────
function AccessoryCreateSheet({ onClose, onCreated }) {
  const [form, setForm] = React.useState({ name:"", quantity:"0", unit_price:"0" });
  const [busy, setBusy] = React.useState(false);
  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"8px 12px", fontSize:13, color:"var(--text)", outline:"none", width:"100%", boxSizing:"border-box" };
  const lbl = { fontSize:10, color:"var(--muted)", textTransform:"uppercase",
    letterSpacing:"0.05em", marginBottom:4, display:"block" };

  const create = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const r = await client.post("/objects/accessories", {
        name: form.name.trim(),
        quantity: parseInt(form.quantity || "0", 10),
        unit_price: parseFloat(form.unit_price || "0"),
      });
      onCreated?.(r.data?.id);
    } catch(e) {
      alert(e.response?.data?.detail || "Création impossible (nom déjà utilisé ?)");
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:340,
      background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end" }}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ width:"100%", background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
          padding:"16px 16px 32px", maxHeight:"80vh", overflowY:"auto" }}>
        <p style={{ fontWeight:700, fontSize:15, margin:"0 0 16px" }}>Nouvel accessoire</p>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div><label style={lbl}>Nom</label>
            <input style={inp} autoFocus value={form.name} placeholder="Ex : Aimant 10×3"
              onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ flex:1 }}><label style={lbl}>Stock initial</label>
              <input style={inp} type="number" value={form.quantity}
                onChange={e=>setForm(f=>({...f,quantity:e.target.value}))}/></div>
            <div style={{ flex:1 }}><label style={lbl}>Prix unitaire (€)</label>
              <input style={inp} type="number" step="0.01" value={form.unit_price}
                onChange={e=>setForm(f=>({...f,unit_price:e.target.value}))}/></div>
          </div>
          <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>
            La photo pourra être ajoutée depuis la fiche, juste après la création.
          </p>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:20 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:"11px", borderRadius:10, border:"1px solid var(--border)",
              background:"var(--surface2)", color:"var(--muted)", fontSize:13, cursor:"pointer" }}>Annuler</button>
          <button onClick={create} disabled={busy || !form.name.trim()}
            style={{ flex:2, padding:"11px", borderRadius:10, border:"none", background:"#3b82f6",
              color:"white", fontSize:13, fontWeight:700,
              cursor:(busy||!form.name.trim())?"not-allowed":"pointer",
              opacity:(busy||!form.name.trim())?0.6:1 }}>
            {busy ? "Création…" : "Créer"}</button>
        </div>
      </div>
    </div>
  );
}

function AccessoryCard({ acc, onClick }) {
  return (
    <div className="card" onClick={onClick}
      style={{ padding:0, overflow:"hidden", cursor: onClick ? "pointer" : "default" }}>
      <div style={{ height:120, background:"var(--surface2)", display:"flex",
        alignItems:"center", justifyContent:"center", overflow:"hidden", padding:8,
        boxSizing:"border-box" }}>
        {acc.has_image
          ? <img src={`/api/v1/objects/accessories/${acc.id}/image`} alt={acc.name}
              // contain : l'image entiere est visible, plus de rognage.
              style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }}
              onError={e => e.currentTarget.style.display="none"}/>
          : <Package size={36} style={{ color:"var(--muted)" }}/>}
      </div>
      <div style={{ padding:"10px 12px" }}>
        <p style={{ fontWeight:700, fontSize:13, color:"var(--text)", margin:"0 0 4px",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{acc.name}</p>
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:11, color:"var(--muted)" }}>
            Stock : <b style={{ color: acc.quantity > 0 ? "#22c55e" : "#ef4444" }}>{acc.quantity}</b>
          </span>
          <span style={{ fontSize:11, fontFamily:"monospace" }}>{fmtPrice(acc.unit_price)}/u</span>
        </div>
      </div>
    </div>
  );
}

// ── Object Detail Sheet ───────────────────────────────────────────────────

// ── Sélecteur d'accessoire ────────────────────────────────────────────────
// Recherche filtrée en direct, vignette, choix de quantité borne au stock,
// estimation du restant. Inspiré de Spoolnymous.

// ── Édition d'un objet ────────────────────────────────────────────────────
// Formulaire complet : nom FR, commentaire, perso, disponibilité, prix desire,
// vente (prix + date) et annulation de vente.
function ObjectEditSheet({ obj, onClose, onSaved }) {
  const [form, setForm] = React.useState({
    translated_name: obj.translated_name || obj.name || "",
    comment:         obj.comment || "",
    personal:        !!obj.personal,
    available:       !!obj.available,
    desired_price:   obj.desired_price != null ? String(obj.desired_price) : "",
    sold_price:      obj.sold_price != null && obj.sold_price > 0 ? String(obj.sold_price) : "",
    sold_date:       obj.sold_date ? String(obj.sold_date).slice(0,10) : "",
  });
  const [saving, setSaving] = React.useState(false);
  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));
  const wasSold = obj.sold_price != null && obj.sold_price > 0;

  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"8px 12px", fontSize:13, color:"var(--text)", outline:"none", width:"100%", boxSizing:"border-box" };
  const lbl = { fontSize:10, color:"var(--muted)", textTransform:"uppercase",
    letterSpacing:"0.05em", marginBottom:4, display:"block" };

  const save = async (extra={}) => {
    setSaving(true);
    try {
      const payload = { ...extra };
      if (!("unsell" in extra)) {
        payload.translated_name = form.translated_name;
        payload.comment = form.comment;
        payload.personal = form.personal;
        payload.available = form.available;
        payload.desired_price = form.desired_price === "" ? 0 : parseFloat(form.desired_price);
        if (form.sold_price !== "") {
          payload.sold_price = parseFloat(form.sold_price);
          if (form.sold_date) payload.sold_date = form.sold_date;
        }
      }
      await client.patch(`/objects/objects/${obj.id}`, payload);
      onSaved();
    } catch(e) { alert("Erreur: " + (e.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:320, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ width:"100%", background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
          padding:"16px 16px 32px", maxHeight:"85vh", overflowY:"auto" }}>
        <p style={{ fontWeight:700, fontSize:15, margin:"0 0 16px" }}>Modifier l'objet</p>

        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div>
            <label style={lbl}>Nom</label>
            <input style={inp} value={form.translated_name} onChange={e=>set("translated_name",e.target.value)}/>
          </div>

          <div>
            <label style={lbl}>Commentaire</label>
            <textarea style={{ ...inp, minHeight:60, resize:"vertical", fontFamily:"inherit" }}
              value={form.comment} onChange={e=>set("comment",e.target.value)}/>
          </div>

          {/* Toggles Perso / Disponible */}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>set("personal",!form.personal)}
              style={{ flex:1, padding:"10px", borderRadius:10, cursor:"pointer", fontSize:12, fontWeight:700,
                border:"1px solid " + (form.personal ? "#a78bfa" : "var(--border)"),
                background: form.personal ? "rgba(168,85,247,0.12)" : "var(--surface2)",
                color: form.personal ? "#a78bfa" : "var(--muted)" }}>
              {form.personal ? "✓ " : ""}Perso
            </button>
            <button onClick={()=>set("available",!form.available)}
              style={{ flex:1, padding:"10px", borderRadius:10, cursor:"pointer", fontSize:12, fontWeight:700,
                border:"1px solid " + (form.available ? "#22c55e" : "var(--border)"),
                background: form.available ? "rgba(34,197,94,0.12)" : "var(--surface2)",
                color: form.available ? "#22c55e" : "var(--muted)" }}>
              {form.available ? "✓ Disponible" : "Indisponible"}
            </button>
          </div>

          <div>
            <label style={lbl}>Prix désiré (€)</label>
            <input style={inp} type="number" step="0.01" value={form.desired_price}
              onChange={e=>set("desired_price",e.target.value)} placeholder="—"/>
          </div>

          {/* Vente */}
          <div style={{ borderTop:"1px solid var(--border)", paddingTop:12 }}>
            <label style={lbl}>Vente</label>
            <div style={{ display:"flex", gap:8 }}>
              <input style={{ ...inp, flex:1 }} type="number" step="0.01" value={form.sold_price}
                onChange={e=>set("sold_price",e.target.value)} placeholder="Prix de vente"/>
              <input style={{ ...inp, flex:1 }} type="date" value={form.sold_date}
                onChange={e=>set("sold_date",e.target.value)}/>
            </div>
            {wasSold && (
              <button onClick={()=>save({ unsell:true })} disabled={saving}
                style={{ marginTop:8, width:"100%", padding:"9px", borderRadius:8, cursor:"pointer",
                  fontSize:12, fontWeight:700, border:"1px solid rgba(239,68,68,0.3)",
                  background:"rgba(239,68,68,0.06)", color:"#ef4444" }}>
                Annuler la vente (remettre disponible)
              </button>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display:"flex", gap:8, marginTop:20 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:"11px", borderRadius:10, border:"1px solid var(--border)",
              background:"var(--surface2)", color:"var(--muted)", fontSize:13, cursor:"pointer" }}>
            Annuler
          </button>
          <button onClick={()=>save()} disabled={saving}
            style={{ flex:2, padding:"11px", borderRadius:10, border:"none",
              background:"#3b82f6", color:"white", fontSize:13, fontWeight:700, cursor:"pointer",
              opacity: saving?0.6:1 }}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessoryPicker({ accessories, onClose, onConfirm }) {
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(null);   // accessoire choisi
  const [qty, setQty] = React.useState(1);

  const filtered = React.useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return accessories;
    return accessories.filter(a => (a.name || "").toLowerCase().includes(t));
  }, [q, accessories]);

  const stock = sel ? Number(sel.quantity || 0) : 0;
  const qn = Math.max(1, Number(qty || 1));
  const tooMuch = sel && qn > stock;
  const remaining = sel ? stock - qn : 0;

  const confirm = () => {
    if (!sel || tooMuch || qn < 1) return;
    onConfirm(sel.id, qn);
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ width:"100%", background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
          padding:"16px 16px 32px", maxHeight:"80vh", overflowY:"auto" }}>
        <p style={{ fontWeight:700, fontSize:14, margin:"0 0 12px" }}>Ajouter un accessoire</p>

        {/* Recherche */}
        <div style={{ position:"relative", marginBottom:10 }}>
          <Search size={14} style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--muted)" }}/>
          <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher un accessoire…"
            style={{ width:"100%", padding:"9px 10px 9px 32px", background:"var(--surface2)",
              border:"1px solid var(--border)", borderRadius:8, color:"var(--text)", fontSize:13, boxSizing:"border-box" }}/>
        </div>

        {/* Résultats filtrés avec vignette */}
        <div style={{ maxHeight:"32vh", overflowY:"auto", marginBottom:12 }}>
          {filtered.length === 0 && <p style={{ color:"var(--muted)", fontSize:12 }}>Aucun accessoire</p>}
          {filtered.map(a => {
            const active = sel?.id === a.id;
            return (
              <button key={a.id} onClick={()=>{ setSel(a); setQty(1); }}
                style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"8px 10px", marginBottom:6,
                  textAlign:"left", cursor:"pointer", borderRadius:8,
                  background: active ? "rgba(59,130,246,0.12)" : "var(--surface2)",
                  border: active ? "1px solid #3b82f6" : "1px solid var(--border)" }}>
                <div style={{ width:36, height:36, borderRadius:6, overflow:"hidden", flexShrink:0,
                  background:"var(--bg)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <img src={`/api/v1/objects/accessories/${a.id}/image`} alt=""
                    style={{ width:"100%", height:"100%", objectFit:"cover" }}
                    onError={e=>e.currentTarget.style.display="none"}/>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:13, fontWeight:600, color:"var(--text)", margin:0,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</p>
                  <p style={{ fontSize:11, color:"var(--muted)", margin:"2px 0 0" }}>
                    Stock : {a.quantity} · {fmtPrice(a.unit_price)}/u
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Quantité + estimation (visible une fois un accessoire choisi) */}
        {sel && (
          <div style={{ borderTop:"1px solid var(--border)", paddingTop:12 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{sel.name}</span>
              <span style={{ fontSize:11, color:"var(--muted)" }}>Stock dispo : {stock}</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
              <span style={{ fontSize:12, color:"var(--muted)" }}>Quantité</span>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <button onClick={()=>setQty(Math.max(1, qn-1))}
                  style={{ width:28, height:28, borderRadius:6, border:"1px solid var(--border)",
                    background:"var(--surface2)", color:"var(--text)", cursor:"pointer", fontSize:16 }}>−</button>
                <input type="number" min={1} max={stock} value={qty}
                  onChange={e=>{ let v=Math.max(1, Number(e.target.value||1)); if(v>stock) v=stock; setQty(v); }}
                  style={{ width:56, textAlign:"center", padding:"6px", background:"var(--surface2)",
                    border:"1px solid var(--border)", borderRadius:6, color:"var(--text)", fontSize:13 }}/>
                <button onClick={()=>setQty(Math.min(stock, qn+1))}
                  style={{ width:28, height:28, borderRadius:6, border:"1px solid var(--border)",
                    background:"var(--surface2)", color:"var(--text)", cursor:"pointer", fontSize:16 }}>+</button>
              </div>
            </div>
            {/* Estimation du restant */}
            <p style={{ fontSize:11, color: tooMuch ? "#ef4444" : "var(--muted)", margin:"0 0 12px" }}>
              {tooMuch
                ? `Stock insuffisant : maximum ${stock} disponible${stock>1?"s":""}.`
                : `Après ajout, il restera ${remaining} en stock · coût ${fmtPrice((sel.unit_price||0)*qn)}.`}
            </p>
            <button onClick={confirm} disabled={tooMuch || qn<1}
              style={{ width:"100%", padding:"11px", borderRadius:10, border:"none", fontSize:13, fontWeight:700,
                cursor: (tooMuch||qn<1) ? "not-allowed" : "pointer",
                background: (tooMuch||qn<1) ? "var(--surface2)" : "#3b82f6",
                color: (tooMuch||qn<1) ? "var(--muted)" : "white" }}>
              Ajouter {qn > 1 ? `×${qn}` : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ObjectSheet({ obj, onClose, onUpdated }) {
  if (!obj) return null;
  useTrackDetail(`Fiche objet · ${obj.name || "#" + obj.id}`);
  const [accessories, setAccessories] = React.useState([]);
  const [addingAcc, setAddingAcc] = React.useState(false);
  const [allAccs, setAllAccs] = React.useState([]);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);  // panneau de suppression
  const [restock, setRestock] = React.useState({});           // accessory_id -> { on, qty }
  // Ouverture en overlay du print / groupe parent (sans navigation).
  const [parentPrint, setParentPrint] = React.useState(null);
  const [parentGroup, setParentGroup] = React.useState(null);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    client.get(`/objects/objects/${obj.id}/accessories`).then(r=>setAccessories(r.data)).catch(()=>{});
  }, [obj.id]);

  // Ouvre la fiche du parent (print ou groupe) par-dessus, en la chargeant.
  const openParent = async () => {
    if (!obj.parent_type || !obj.parent_id) return;
    try {
      if (obj.parent_type === "print") {
        const r = await client.get(`/prints/${obj.parent_id}`);
        setParentPrint(r.data);
      } else if (obj.parent_type === "group") {
        // /prints/groups renvoie { groups: [...] }, pas un tableau direct.
        const r = await client.get("/prints/groups");
        const list = r.data?.groups || r.data || [];
        const g = list.find(x => Number(x.id) === Number(obj.parent_id));
        if (g) setParentGroup(g);
      }
    } catch { /* parent introuvable : rien */ }
  };

  const isSold = obj.sold_price > 0;

  const openAddAcc = async () => {
    const r = await client.get("/objects/accessories");
    setAllAccs(r.data); setAddingAcc(true);
  };

  const linkAcc = async (accId, qty) => {
    await client.post(`/objects/objects/${obj.id}/accessories`, { accessory_id: accId, qty });
    const r = await client.get(`/objects/objects/${obj.id}/accessories`);
    setAccessories(r.data); setAddingAcc(false); onUpdated?.();
  };

  const unlinkAcc = async (aid) => {
    await client.delete(`/objects/objects/${obj.id}/accessories/${aid}`);
    setAccessories(a => a.filter(x => x.accessory_id !== aid));
    onUpdated?.();
  };

  // Ouvre le panneau de confirmation. On y pre-remplit la restitution : chaque
  // accessoire lie est coche par defaut, quantite = celle du lien. Si l'objet
  // n'a aucun accessoire, le panneau est une simple confirmation.
  const askDelete = () => {
    const init = {};
    for (const a of accessories) {
      init[a.accessory_id] = { on: true, qty: a.qty };
    }
    setRestock(init);
    setConfirmDel(true);
  };

  const doDelete = async () => {
    setDeleting(true);
    // "accessory_id:qty" pour chaque accessoire coche avec une quantite > 0.
    const parts = accessories
      .map(a => {
        const r = restock[a.accessory_id];
        const q = r?.on ? Math.min(Math.max(0, r.qty|0), a.qty) : 0;
        return q > 0 ? `${a.accessory_id}:${q}` : null;
      })
      .filter(Boolean);
    try {
      await client.delete(`/objects/objects/${obj.id}`,
        { params: parts.length ? { restock: parts.join(",") } : {} });
      onClose(); onUpdated?.();
    } catch (e) {
      alert(e.response?.data?.detail || e.message);
      setDeleting(false);
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:200, display:"flex", alignItems:"flex-end" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ width:"100%", maxHeight:"90vh", overflowY:"auto", background:"var(--sheet-bg)",
          borderRadius:"20px 20px 0 0", padding:"0 16px 24px", position:"relative" }}>

        {/* Handle + ✕ */}
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 8px" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:10, right:12, width:28, height:28,
            borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer",
            color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>

        {/* Header */}
        <div style={{ display:"flex", gap:12, marginBottom:14 }}>
          <img src={`/api/v1/objects/objects/${obj.id}/image`} alt=""
            style={{ width:72, height:72, borderRadius:10, objectFit:"cover", flexShrink:0, background:"var(--surface2)" }}
            onError={e=>e.currentTarget.style.display="none"}/>
          <div>
            <h2 style={{ fontSize:16, fontWeight:800, color:"var(--text)", margin:"0 0 4px" }}>
              {obj.translated_name || obj.name}
            </h2>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {isSold && <span style={{ fontSize:10, background:"rgba(34,197,94,0.12)", color:"#22c55e", padding:"2px 8px", borderRadius:20, fontWeight:700 }}>Vendu {fmtPrice(obj.sold_price)}</span>}
              {!obj.available && !isSold && <span style={{ fontSize:10, background:"rgba(239,68,68,0.1)", color:"#ef4444", padding:"2px 8px", borderRadius:20 }}>Non disponible</span>}
              {obj.personal && <span style={{ fontSize:10, background:"rgba(168,85,247,0.1)", color:"#a78bfa", padding:"2px 8px", borderRadius:20 }}>Perso</span>}
            </div>
            {(obj.parent_type === "print" || obj.parent_type === "group") && obj.parent_id && (
              <button onClick={openParent}
                style={{ marginTop:8, display:"inline-flex", alignItems:"center", gap:6,
                  padding:"5px 10px", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:600,
                  border:"1px solid var(--border)", background:"var(--surface2)", color:"#60a5fa" }}>
                <ExternalLink size={13}/>
                {obj.parent_type === "print" ? "Voir l'impression" : "Voir le groupe"}
              </button>
            )}
          </div>
        </div>

        {/* Coûts — meme presentation que la fiche print/groupe */}
        <div style={{ background:"linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06))",
          border:"1px solid rgba(59,130,246,0.15)", borderRadius:14, padding:"14px 16px", marginBottom:14 }}>
          <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:"0.06em", margin:"0 0 10px" }}>Coûts</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {/* Fabrication (avec le prix normal catalogue entre parentheses) */}
            <div style={{ background:"var(--surface2)", borderRadius:10, padding:"8px 10px" }}>
              <p style={{ fontSize:9, color:"var(--muted)", margin:"0 0 3px" }}>Fabrication</p>
              <p style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:0, fontFamily:"monospace" }}>
                {fmtPrice(obj.cost_fabrication)}
              </p>
              <p style={{ fontSize:10, color:"var(--muted)", margin:"2px 0 0" }}>
                ({fmtPrice(obj.normal_cost_unit || obj.cost_fabrication)} au prix normal)
              </p>
            </div>
            {/* Accessoires */}
            <div style={{ background:"var(--surface2)", borderRadius:10, padding:"8px 10px" }}>
              <p style={{ fontSize:9, color:"var(--muted)", margin:"0 0 3px" }}>Accessoires</p>
              <p style={{ fontSize:15, fontWeight:800, color:"#a78bfa", margin:0, fontFamily:"monospace" }}>
                {fmtPrice(obj.cost_accessory)}
              </p>
            </div>
          </div>
          {/* Total */}
          <div style={{ marginTop:8, padding:"10px 12px", borderRadius:10,
            background:"rgba(59,130,246,0.1)", border:"1px solid rgba(59,130,246,0.2)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:10, color:"#60a5fa", fontWeight:700,
                textTransform:"uppercase", letterSpacing:"0.06em" }}>Total</span>
              <div style={{ textAlign:"right" }}>
                <span style={{ fontSize:20, fontWeight:900, color:"var(--text)", fontFamily:"monospace" }}>
                  {fmtPrice(obj.cost_total)}
                </span>
                {/* Total au prix normal (catalogue) + accessoires, toujours affiche
                    comme sur la fiche print. Repli sur le cout de fabrication si le
                    cout normal n'est pas renseigne. */}
                <span style={{ fontSize:11, color:"var(--muted)", marginLeft:8 }}>
                  ({fmtPrice((obj.normal_cost_unit || obj.cost_fabrication || 0) + (obj.cost_accessory || 0))})
                </span>
              </div>
            </div>
            {obj.desired_price > 0 && (
              <div style={{ marginTop:6, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:10, color:"var(--muted)" }}>Prix désiré</span>
                <span style={{ fontSize:13, fontWeight:700, color:"var(--text)", fontFamily:"monospace" }}>
                  {fmtPrice(obj.desired_price)}
                </span>
              </div>
            )}
            {isSold && (
              <div style={{ marginTop:6, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:10, color:"#22c55e" }}>Vendu</span>
                <span style={{ fontSize:14, fontWeight:700, color:"#22c55e", fontFamily:"monospace" }}>
                  {fmtPrice(obj.sold_price)}
                  {obj.sold_price > 0 && obj.cost_total > 0 &&
                    <span style={{ fontSize:10, marginLeft:6 }}>({((obj.sold_price/obj.cost_total-1)*100).toFixed(0)}%)</span>}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Accessoires associés */}
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:0 }}>Accessoires</p>
            <AdminOnly><button onClick={openAddAcc}
              style={{ fontSize:11, padding:"2px 10px", borderRadius:20, border:"1px solid var(--border)",
                background:"var(--surface2)", color:"var(--text)", cursor:"pointer" }}>+ Ajouter</button></AdminOnly>
          </div>
          {accessories.length === 0 && <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>Aucun accessoire</p>}
          {accessories.map(a => (
            <div key={a.accessory_id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
              background:"var(--surface2)", borderRadius:8, marginBottom:5, border:"1px solid var(--border)" }}>
              <div style={{ width:28, height:28, borderRadius:6, overflow:"hidden", flexShrink:0,
                background:"var(--bg)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <img src={`/api/v1/objects/accessories/${a.accessory_id}/image`} alt=""
                  style={{ width:"100%", height:"100%", objectFit:"cover" }}
                  onError={e=>e.currentTarget.style.display="none"}/>
              </div>
              <span style={{ fontSize:12, flex:1 }}>{a.name}</span>
              <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>×{a.qty}</span>
              <span style={{ fontSize:11, color:"var(--text)", fontFamily:"monospace" }}>{fmtPrice(a.unit_price * a.qty)}</span>
              <button onClick={()=>unlinkAcc(a.accessory_id)}
                style={{ width:18, height:18, borderRadius:"50%", background:"rgba(239,68,68,0.1)",
                  border:"none", cursor:"pointer", color:"#ef4444", fontSize:12 }}>✕</button>
            </div>
          ))}
        </div>

        {/* Commentaire */}
        {obj.comment && <p style={{ fontSize:12, color:"var(--muted)", marginBottom:14, fontStyle:"italic" }}>{obj.comment}</p>}

        {/* Actions */}
        <div style={{ display:"flex", gap:8 }}>
          <AdminOnly><button onClick={()=>setEditing(true)}
            style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid var(--border)",
              background:"var(--surface2)", color:"var(--text)", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            ✏️ Modifier
          </button></AdminOnly>
          <AdminOnly><button onClick={askDelete}
            style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(239,68,68,0.3)",
              background:"rgba(239,68,68,0.06)", color:"#ef4444", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            🗑 Supprimer
          </button></AdminOnly>
          <button onClick={onClose}
            style={{ flex:2, padding:"10px", borderRadius:10, border:"none",
              background:"#3b82f6", color:"white", fontSize:13, fontWeight:700, cursor:"pointer" }}>✕</button>
        </div>
      </div>

      {/* Picker accessoire — recherche filtrée, vignette, quantité bornee au stock */}
      {addingAcc && (
        <AccessoryPicker accessories={allAccs} onClose={()=>setAddingAcc(false)} onConfirm={linkAcc}/>
      )}

      {/* Édition complete de l'objet */}
      {editing && (
        <ObjectEditSheet obj={obj} onClose={()=>setEditing(false)}
          onSaved={async ()=>{
            setEditing(false);
            try {
              const r = await client.get(`/objects/objects/${obj.id}`);
              onUpdated?.(r.data);   // remonte l'objet mis a jour au parent
            } catch { onUpdated?.(); }
          }}/>
      )}

      {parentPrint && (
        <PrintDetail p={parentPrint} onClose={()=>setParentPrint(null)}
          onDelete={()=>setParentPrint(null)} onChanged={()=>{}}/>
      )}
      {parentGroup && (
        <GroupBottomSheet groupId={parentGroup.id} name={parentGroup.name}
          prints={[]} number_of_items={parentGroup.number_of_items||1}
          onClose={()=>setParentGroup(null)}
          onSelectPrint={()=>{}} onDelete={()=>{}} onUngroup={()=>{}}/>
      )}

      {confirmDel && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:300,
          display:"flex", alignItems:"flex-end", justifyContent:"center" }}
          onClick={()=>!deleting && setConfirmDel(false)}>
          <div onClick={e=>e.stopPropagation()} className="sheet-panel"
            style={{ width:"100%", maxWidth:520, borderTopLeftRadius:20, borderTopRightRadius:20,
              padding:"20px 20px 24px", maxHeight:"80vh", overflowY:"auto" }}>
            <h3 style={{ margin:"0 0 4px", fontSize:16, fontWeight:700, color:"var(--text)" }}>
              Supprimer « {obj.name} » ?
            </h3>
            <p style={{ margin:"0 0 16px", fontSize:12.5, color:"var(--muted)" }}>
              {accessories.length
                ? "Choisis les accessoires à remettre en stock. Ce qui n'est pas coché part avec l'objet."
                : "Cette action est définitive."}
            </p>

            {accessories.length > 0 && (
              <>
                {/* Bascule global : au-dessus de la liste, pour trancher d'un
                    geste avant d'ajuster au cas par cas. */}
                <button
                  onClick={()=>{
                    const allOn = accessories.every(a => restock[a.accessory_id]?.on);
                    const next = {};
                    for (const a of accessories)
                      next[a.accessory_id] = { on: !allOn, qty: restock[a.accessory_id]?.qty ?? a.qty };
                    setRestock(next);
                  }}
                  style={{ marginBottom:10, padding:"5px 12px", borderRadius:20, fontSize:11,
                    fontWeight:600, cursor:"pointer", border:"1px solid var(--border)",
                    background:"transparent", color:"var(--muted)" }}>
                  {accessories.every(a => restock[a.accessory_id]?.on) ? "Tout décocher" : "Tout cocher"}
                </button>

                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:18 }}>
                  {accessories.map(a => {
                    const r = restock[a.accessory_id] || { on:false, qty:a.qty };
                    return (
                      <div key={a.accessory_id} style={{ display:"flex", alignItems:"center", gap:10,
                        padding:"8px 10px", borderRadius:10, background:"var(--surface2)",
                        opacity: r.on ? 1 : 0.55 }}>
                        <button onClick={()=>setRestock(p=>({ ...p,
                            [a.accessory_id]: { on: !r.on, qty: r.qty } }))}
                          style={{ width:22, height:22, borderRadius:6, flexShrink:0, cursor:"pointer",
                            border:"1px solid " + (r.on ? "#22c55e" : "var(--border)"),
                            background: r.on ? "#22c55e" : "transparent", color:"white",
                            fontSize:13, lineHeight:1, display:"flex", alignItems:"center",
                            justifyContent:"center" }}>
                          {r.on ? "✓" : ""}
                        </button>
                        <span style={{ flex:1, fontSize:13, color:"var(--text)",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {a.name}
                        </span>
                        <span style={{ fontSize:11, color:"var(--muted)" }}>sur {a.qty}</span>
                        <input type="number" min={0} max={a.qty} value={r.on ? r.qty : ""}
                          disabled={!r.on}
                          onChange={e=>{
                            const q = Math.min(Math.max(0, parseInt(e.target.value||"0",10)), a.qty);
                            setRestock(p=>({ ...p, [a.accessory_id]: { on:true, qty:q } }));
                          }}
                          style={{ width:56, textAlign:"center", fontSize:13, padding:"5px 6px",
                            borderRadius:8, border:"1px solid var(--border)",
                            background:"var(--surface)", color:"var(--text)" }}/>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setConfirmDel(false)} disabled={deleting}
                style={{ flex:1, padding:"11px", borderRadius:12, fontSize:13, fontWeight:600,
                  cursor:"pointer", border:"1px solid var(--border)", background:"transparent",
                  color:"var(--text)" }}>
                Annuler
              </button>
              <button onClick={doDelete} disabled={deleting}
                style={{ flex:1, padding:"11px", borderRadius:12, fontSize:13, fontWeight:700,
                  cursor:"pointer", border:"none", background:"#ef4444", color:"white" }}>
                {deleting ? "Suppression…" : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ObjectCard({ obj, onClick }) {
  const isSold = obj.sold_price > 0;
  return (
    <div className="card" onClick={onClick} style={{ padding:0, overflow:"hidden", cursor:"pointer", position:"relative",
      opacity: !obj.available && !isSold ? 0.6 : 1 }}>
      <div style={{ position:"relative", height:130, background:"var(--surface2)",
        display:"flex", alignItems:"center", justifyContent:"center" }}>
        <img src={`/api/v1/objects/objects/${obj.id}/image`} alt=""
          style={{ width:"100%", height:"100%", objectFit:"cover" }}
          onError={e => e.currentTarget.style.display="none"}/>
        {isSold && <span style={{ position:"absolute", top:6, right:6,
          background:"rgba(34,197,94,0.85)", color:"white",
          fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>Vendu</span>}
        {obj.personal && <span style={{ position:"absolute", top:6, left:6,
          background:"rgba(168,85,247,0.85)", color:"white",
          fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>Perso</span>}
      </div>
      <div style={{ padding:"8px 10px" }}>
        <p style={{ fontWeight:700, fontSize:12, color:"var(--text)", margin:"0 0 3px",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {obj.translated_name || obj.name}
        </p>
        <div style={{ display:"flex", gap:6, justifyContent:"space-between" }}>
          <span style={{ fontSize:10, color:"var(--muted)" }}>{fmtPrice(obj.cost_total)}</span>
          {obj.desired_price && <span style={{ fontSize:10, color:"#22c55e", fontFamily:"monospace" }}>{fmtPrice(obj.desired_price)}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Object Group Sheet ────────────────────────────────────────────────────
function ObjectGroupSheet({ group, objects, onClose, onSelectObj }) {
  const totalCost = objects.reduce((s,o) => s+(o.cost_total||0), 0);
  const soldCount = objects.filter(o => o.sold_price > 0).length;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:200, display:"flex", alignItems:"flex-end" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner" style={{ width:"100%", maxHeight:"88vh", overflowY:"auto", background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", padding:"20px 16px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
            <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)", margin:"8px auto 0", flex:1 }}/>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
          <div>
            <p style={{ fontWeight:800, fontSize:16, color:"#a78bfa", margin:"0 0 4px" }}>{group.name}</p>
            <p style={{ fontSize:12, color:"var(--muted)", margin:0 }}>
              {objects.length} objet{objects.length!==1?"s":""} · {fmtPrice(totalCost)}
              {soldCount > 0 && ` · ${soldCount} vendu${soldCount>1?"s":""}`}
            </p>
          </div>
          {group.desired_price && (
            <span style={{ fontSize:12, fontFamily:"monospace", color:"#22c55e",
              background:"rgba(34,197,94,0.1)", padding:"4px 10px", borderRadius:20 }}>
              Prix souhaité : {fmtPrice(group.desired_price)}
            </span>
          )}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:8 }}>
          {objects.map(o => <ObjectCard key={o.id} obj={o} onClick={() => { onClose(); onSelectObj(o); }}/>)}
        </div>
      </div>
    </div>
  );
}

// ── Object Group Tile ─────────────────────────────────────────────────────
function ObjectGroupTile({ group, objects }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const cover = objects[0];
  const soldCount = objects.filter(o => o.sold_price > 0).length;
  return (<>
    <div className="card" onClick={() => setOpen(true)}
      style={{ padding:0, overflow:"hidden", cursor:"pointer", position:"relative" }}>
      <div style={{ position:"relative", height:130, background:"var(--surface2)",
        display:"flex", alignItems:"center", justifyContent:"center" }}>
        {cover && <img src={`/api/v1/objects/objects/${cover.id}/image`} alt=""
          style={{ width:"100%", height:"100%", objectFit:"cover" }}
          onError={e => e.currentTarget.style.display="none"}/>}
        <div style={{ position:"absolute", inset:0, background:"rgba(167,139,250,0.12)" }}/>
        <span style={{ position:"absolute", top:6, left:6, background:"rgba(167,139,250,0.85)",
          color:"white", fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>
          📁 {objects.length}
        </span>
        {soldCount > 0 && <span style={{ position:"absolute", top:6, right:6,
          background:"rgba(34,197,94,0.85)", color:"white",
          fontSize:9, fontWeight:800, padding:"2px 7px", borderRadius:20 }}>
          {soldCount} vendu{soldCount>1?"s":""}
        </span>}
      </div>
      <div style={{ padding:"8px 10px" }}>
        <p style={{ fontWeight:700, fontSize:12, color:"#a78bfa", margin:"0 0 2px",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{group.name}</p>
        {group.desired_price && <p style={{ fontSize:10, color:"#22c55e", margin:0, fontFamily:"monospace" }}>{fmtPrice(group.desired_price)}</p>}
      </div>
    </div>
    {open && <ObjectGroupSheet group={group} objects={objects} onClose={() => setOpen(false)}
      onSelectObj={o => setSelected(o)}/>}
    {selected && <ObjectSheet obj={selected} onClose={() => setSelected(null)}
      onUpdated={(updated) => { if (updated) setSelected(updated); }}/>}
  </>);
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function Objects() {
  const [tab, setTab] = useState("objects");
  useTrackDetail(`Objets · ${tab === "accessories" ? "Accessoires" : "Objets"}`);
  const [q, setQ] = useState("");
  const [objects, setObjects] = useState([]);
  const [accessories, setAccessories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedAcc, setSelectedAcc] = useState(null);   // fiche accessoire
  const [creatingAcc, setCreatingAcc] = useState(false);  // creation accessoire
  const [filter, setFilter] = useState("all");

  const loadObjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = { q: q||undefined, limit:500 };
      if (filter === "available") params.available = true;
      if (filter === "sold") params.sold = true;
      if (filter === "personal") params.personal = true;
      const { data } = await client.get("/objects/objects", { params });
      setObjects(data.items || []);
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }, [q, filter]);

  const loadAccessories = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/objects/accessories", { params: { q: q||undefined } });
      setAccessories(data || []);
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    if (tab === "objects") loadObjects(); else loadAccessories();
  }, [tab, q, filter]);

  const FILTERS = [["all","Tous"],["available","Disponibles"],["sold","Vendus"],["personal","Perso"]];

  // Séparer objets groupés vs solo — comme les prints
  const grouped = {};
  const solo = [];
  for (const o of objects) {
    if (o.group_id) { (grouped[o.group_id] = grouped[o.group_id] || { name: o.group_name, desired_price: null, items: [] }).items.push(o); }
    else solo.push(o);
  }
  // Items pour la grille : groupes d'abord puis solos — comme galerie prints
  const gridItems = [
    ...Object.entries(grouped).map(([gid, g]) => ({ kind:"group", group_id:Number(gid), group:g, objects:g.items })),
    ...solo.map(o => ({ kind:"object", obj:o })),
  ];

  return (
    <div style={{ maxWidth:900, margin:"0 auto", display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Objets & Accessoires</h1>
        {tab === "accessories" && (
          <AdminOnly><button onClick={()=>setCreatingAcc(true)}
            style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5,
              padding:"7px 14px", borderRadius:20, border:"none", cursor:"pointer",
              background:"#3b82f6", color:"white", fontSize:12, fontWeight:700 }}>
            <Plus size={14}/> Accessoire
          </button></AdminOnly>
        )}
      </div>

      {/* Onglets Objets / Accessoires — meme composant visuel que Filaments/Historique. */}
      <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:12,
        padding:4, border:"1px solid var(--border)" }}>
        {[["objects","Objets"],["accessories","Accessoires"]].map(([id,label]) => (
          <button key={id} onClick={() => { setTab(id); setQ(""); }} style={{
            flex:1, padding:"8px 12px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
            background: tab===id ? "#3b82f6" : "transparent",
            color: tab===id ? "white" : "var(--muted)",
            border:"none", transition:"all 0.15s",
          }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ position:"relative", flex:1, minWidth:160 }}>
          <Search size={13} style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--muted)" }}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher…"
            style={{ width:"100%", paddingLeft:32, padding:"7px 10px 7px 32px",
              background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
              fontSize:12, color:"var(--text)", outline:"none", boxSizing:"border-box" }}/>
        </div>
        {tab === "objects" && FILTERS.map(([id,label]) => (
          <button key={id} onClick={() => setFilter(id)}
            style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:"none",
              background:filter===id?"#3b82f6":"var(--surface2)", color:filter===id?"white":"var(--muted)" }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>Chargement…</p>
      : tab === "objects" ? (
        gridItems.length === 0
          ? <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>Aucun objet</p>
          : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
              {gridItems.map(item => item.kind === "group"
                ? <ObjectGroupTile key={`g${item.group_id}`} group={item.group} objects={item.objects}/>
                : <ObjectCard key={item.obj.id} obj={item.obj} onClick={() => setSelected(item.obj)}/>
              )}
            </div>
      ) : (
        accessories.length === 0
          ? <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>Aucun accessoire</p>
          : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
              {accessories.map(a => <AccessoryCard key={a.id} acc={a} onClick={()=>setSelectedAcc(a.id)}/>)}
            </div>
      )}

      {selected && <ObjectSheet obj={selected} onClose={() => setSelected(null)}
        onUpdated={(updated) => { if (updated) setSelected(updated); loadObjects(); }}/>}

      {selectedAcc && (
        <AccessorySheet accId={selectedAcc} onClose={()=>setSelectedAcc(null)}
          onChanged={loadAccessories}/>
      )}
      {creatingAcc && (
        <AccessoryCreateSheet onClose={()=>setCreatingAcc(false)}
          onCreated={(id)=>{ setCreatingAcc(false); loadAccessories(); if (id) setSelectedAcc(id); }}/>
      )}
    </div>
  );
}
