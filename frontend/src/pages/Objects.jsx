import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import HiddenMark from "../components/HiddenMark";
import Cachettes, { Hide } from "../components/Cachettes";
import { useUrlTab } from "../utils/useUrlTab";
import { Search, Package, ShoppingBag, ExternalLink, Image as ImageIcon, Plus } from "lucide-react";
import client, { apiUrl, apiThumb } from "../api/client";
import { showAlert, showConfirm } from "../utils/dialog";
import CategoryPicker from "../components/CategoryPicker";
import Select from "../components/Select";
import { isMoneyHidden, MONEY_MASK } from "../utils/money";
import AdminOnly from "../components/AdminOnly";
import { PrintDetail, GroupBottomSheet } from "./Prints";
import { useTrackDetail } from "../utils/track";
import { useKeyboardInset } from "../utils/keyboard";
import { useLongPress, openMenu } from "../components/ContextMenu";
import GroupMosaic from "../components/GroupMosaic";
import { KpiBar, SearchRow, EmptyCard, PageTabs, fGrad, FSheet, FTile, FCard, FRow, fChip, fBtn, dayFr } from "../components/FicheKit";
import { useIsAdmin } from "../store/auth";

// Les montants sont masques pour les comptes en lecture seule.
function fmtPrice(v) {
  if (isMoneyHidden()) return MONEY_MASK;
  return v != null ? `${Number(v).toFixed(2)} €` : "—";
}

// Dans les tuiles du haut (quatre sur une ligne de telephone) : sans centimes a partir de 100 €, pour que tout tienne
function fmtKpi(v) {
  if (isMoneyHidden()) return MONEY_MASK;
  return Math.abs(v || 0) >= 100 ? `${Math.round(v)} €` : fmtPrice(v || 0);
}

// ── Accessory Card ────────────────────────────────────────────────────────

// ── Fiche accessoire ──────────────────────────────────────────────────────
// Consultation (photo, stock, valeur, objets qui l'utilisent), edition,
// reapprovisionnement (prix moyen pondere), photo et suppression.
// un seul comparateur pour tous les tris par nom (un localeCompare par comparaison refaisait son travail)
const OBJ_COLLATOR = new Intl.Collator("fr", { numeric: true });

export function AccessorySheet({ accId, onClose, onChanged }) {
  const [d, setD] = React.useState(null);
  // Le nom n'arrive qu'apres le chargement : on annonce d'abord l'identifiant,
  // le libelle se precise ensuite. Deux lignes de journal, mais aucune vue
  // perdue si le chargement echoue.
  useTrackDetail(`Fiche accessoire · ${d?.name || "#" + accId}`);
  const [mode, setMode] = React.useState("view");     // view | edit | restock
  const [form, setForm] = React.useState({ name:"", quantity:"", unit_price:"" });
  const [restock, setRestock] = React.useState({ qty:"", total_price:"" });
  // Le prix peut se saisir en TOTAL (coût du lot) ou en UNITAIRE. Le serveur
  // n'attend qu'un total ; l'unitaire est donc converti a l'envoi. Deux clés
  // distinctes pour que basculer de mode ne mélange pas les valeurs saisies.
  const [priceMode, setPriceMode] = React.useState("total");  // total | unit
  const [unitInput, setUnitInput] = React.useState("");
  const [stockMode, setStockMode] = React.useState("add");    // add | remove | set
  const [setValue, setSetValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const fileRef = React.useRef(null);
  const [imgV, setImgV] = React.useState(0);          // cache-buster photo
  const [viewObj, setViewObj] = React.useState(null); // fiche objet ouverte sur place
  const [histOpen, setHistOpen] = React.useState(false);
  const isAdmin = useIsAdmin();
  const openObj = async (id) => {
    try { const r = await client.get(`/objects/objects/${id}`); setViewObj(r.data); } catch {}
  };

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
        // Le regroupement n'est PAS renvoye ici : il se modifie par son propre
        // selecteur, hors du formulaire. L'inclure aurait renvoye la valeur
        // capturee a l'ouverture de la fiche et annule un changement fait
        // entre-temps -- enregistrer le nom aurait remis l'ancien rangement.
      });
      setMode("view"); await load(); onChanged?.();
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };

  const doRestock = async () => {
    let payload;
    if (stockMode === "set") {
      const v = parseInt(setValue, 10);
      if (Number.isNaN(v) || v < 0) return;
      payload = { mode:"set", qty:0, new_quantity:v };
    } else {
      const qty = parseInt(restock.qty || "0", 10);
      if (!qty) return;
      payload = stockMode === "remove"
        ? { mode:"remove", qty }
        : { mode:"add", qty, total_price: priceMode === "unit"
              ? parseFloat(unitInput || "0") * qty
              : parseFloat(restock.total_price || "0") };
    }
    setBusy(true);
    try {
      await client.post(`/objects/accessories/${accId}/stock`, payload);
      setRestock({ qty:"", total_price:"" }); setUnitInput(""); setSetValue("");
      setStockMode("add"); setMode("view");
      await load(); onChanged?.();
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
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
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await client.delete(`/objects/accessories/${accId}`);
      onChanged?.(); onClose();
    } catch(e) {
      showAlert(e.response?.data?.detail || "Suppression impossible (accessoire peut-être lié à des objets).");
      setBusy(false); setConfirmDel(false);
    }
  };

  const inp = fInp, lbl = fLbl;

  // Prix moyen estime apres reappro (meme calcul que le backend).
  const newAvg = (() => {
    if (!d) return null;
    const q = parseInt(restock.qty || "0", 10);
    // Total effectif selon le mode : en unitaire, total = prix/u × quantité.
    const tp = priceMode === "unit"
      ? parseFloat(unitInput || "0") * q
      : parseFloat(restock.total_price || "0");
    if (!q || !tp) return null;
    return ((d.quantity * d.unit_price) + tp) / (d.quantity + q);
  })();

  const q = d?.quantity || 0;
  const tone = q === 0 ? "#ef4444" : q < LOW_STOCK ? "#f59e0b" : "#22c55e";
  const c = sectionColor((d?.category || "").trim() || null);
  const stockBlocked = busy || (stockMode === "set" ? setValue === "" : !restock.qty);
  const STOCK_OPS = { add:["➕", "Ajouter", "#22c55e"], remove:["➖", "Retirer", "#f59e0b"], set:["🎯", "Définir", "#3b82f6"] };
  const bottom = !d ? null
    : mode === "edit" ? <>
        <button onClick={() => { setMode("view"); load(); }} style={{ ...fBtn, flex:1 }}>Annuler</button>
        <button onClick={save} disabled={busy} style={{ ...fBtn, flex:2, border:"none", color:"#fff", opacity: busy ? .6 : 1,
          background:"linear-gradient(135deg, #3B82F6, #6366F1)", boxShadow:"0 8px 18px -10px #3B82F6" }}>{busy ? "Enregistrement…" : "✓ Enregistrer"}</button></>
    : mode === "restock" ? <>
        <button onClick={() => { setMode("view"); setStockMode("add"); }} style={{ ...fBtn, flex:1 }}>Annuler</button>
        <button onClick={doRestock} disabled={stockBlocked} style={{ ...fBtn, flex:2, border:"none", color:"#fff", opacity: stockBlocked ? .6 : 1,
          background:`linear-gradient(135deg, ${STOCK_OPS[stockMode][2]}, color-mix(in srgb, ${STOCK_OPS[stockMode][2]} 65%, #ffffff))` }}>
          {stockMode === "remove" ? "Retirer" : stockMode === "set" ? "Définir" : "Ajouter au stock"}</button></>
    : isAdmin ? <>
        <button onClick={() => { setStockMode("add"); setSetValue(String(d.quantity)); setMode("restock"); }} style={{ ...fBtn, flex:2, border:"none", color:"#fff",
          background:"linear-gradient(135deg, #14B8A6, #22C55E)", boxShadow:"0 8px 18px -10px #14B8A6" }}>📦 Stock</button>
        <button onClick={() => setMode("edit")} style={{ ...fBtn, flex:2 }}>✏️ Modifier</button>
        <button onClick={() => confirmDel ? remove() : setConfirmDel(true)} disabled={busy} aria-label="Supprimer l'accessoire"
          data-tip={confirmDel ? "Toucher encore pour supprimer" : "Supprimer l'accessoire"}
          style={{ ...fBtn, flex: confirmDel ? 2 : "0 0 auto", width: confirmDel ? undefined : 48, color: confirmDel ? "#fff" : "#ef4444",
            border: confirmDel ? "none" : "1px solid rgba(239,68,68,0.35)",
            background: confirmDel ? "linear-gradient(135deg, #EF4444, #F97316)" : "rgba(239,68,68,0.08)" }}>{confirmDel ? "Confirmer ?" : "🗑"}</button></>
    : null;

  return (
    <FSheet onClose={onClose} z={340} bottom={bottom}>
      {!d ? <p style={{ color:"var(--muted)", fontSize:13, padding:"60px 20px", textAlign:"center" }}>Chargement…</p> : (<>
        {/* l'accessoire en vedette : sa photo sur la couleur de son regroupement */}
        <div style={{ position:"relative", overflow:"hidden", padding:"52px 18px 18px", display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
          background:`radial-gradient(circle at 18% 45%, color-mix(in srgb, ${c} 40%, transparent), transparent 60%), linear-gradient(135deg, color-mix(in srgb, ${c} 16%, transparent), transparent 70%), var(--surface2)` }}>
          <div style={{ width:116, height:116, borderRadius:22, flexShrink:0, overflow:"hidden", padding:10, boxSizing:"border-box",
            display:"flex", alignItems:"center", justifyContent:"center", background:"var(--surface)", border:"1px solid rgba(255,255,255,.12)",
            boxShadow:`0 12px 28px -12px ${c}` }}>
            {d.has_image
              ? <img src={apiThumb(apiUrl(`/objects/accessories/${accId}/image?v=${imgV}`), 256)} alt="" style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }}/>
              : <Package size={46} style={{ color:c, opacity:.8 }}/>}
          </div>
          <div style={{ flex:"1 1 190px", minWidth:0, display:"flex", flexDirection:"column", gap:6 }}>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {d.category && fChip(`🔩 ${d.category}`, c)}
              {d.used_in_objects > 0 && fChip(`🎁 utilisé × ${d.used_quantity}`, "#8B5CF6")}
            </div>
            <div style={{ fontSize:23, fontWeight:900, color:"var(--text)", lineHeight:1.12, overflowWrap:"anywhere" }}>{d.name}</div>
            <div style={{ display:"flex", alignItems:"baseline", gap:8, flexWrap:"wrap" }}>
              <span style={{ fontSize:28, fontWeight:900, lineHeight:1.2, ...fGrad(tone, `color-mix(in srgb, ${tone} 60%, #ffffff)`) }}>{q === 0 ? "Rupture" : q}</span>
              {q > 0 && <span style={{ fontSize:13, fontWeight:800, color:"var(--muted)" }}>en stock{q < LOW_STOCK ? " · stock bas" : ""}</span>}
            </div>
            <AdminOnly><button onClick={()=>fileRef.current?.click()} disabled={busy}
              style={{ alignSelf:"flex-start", display:"inline-flex", alignItems:"center", gap:6, padding:"5px 11px", borderRadius:20, fontSize:11.5,
                fontWeight:800, cursor:"pointer", border:"1px solid var(--border)", background:"var(--surface)", color:"var(--text2)" }}>
              <ImageIcon size={13}/> {d.has_image ? "Changer la photo" : "Ajouter une photo"}
            </button></AdminOnly>
            <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
              onChange={e => { upload(e.target.files?.[0]); e.target.value=""; }}/>
          </div>
        </div>

        <div style={{ padding:"14px 14px 18px", display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))", gap:8 }}>
            <FTile label="📦 Stock" value={String(q)} sub={q === 0 ? "rupture" : q < LOW_STOCK ? "stock bas" : "unités"} c1={tone} c2={`color-mix(in srgb, ${tone} 60%, #ffffff)`}/>
            <FTile label="🏷️ Prix / u" value={fmtPrice(d.unit_price)} sub="prix moyen" c1="#F59E0B" c2="#FBBF24"/>
            <FTile label="💶 Valeur" value={fmtPrice(d.stock_value)} sub="du stock" c1="#22c55e" c2="#4ade80"/>
            <FTile label="🎁 Utilisé" value={String(d.used_quantity || 0)} sub={`dans ${d.used_in_objects || 0} objet${d.used_in_objects > 1 ? "s" : ""}`} c1="#8B5CF6" c2="#C084FC"/>
          </div>

          {/* Mode edition */}
          {mode === "edit" && (
            <FCard t="Modifier" i="✏️" c="#3B82F6">
              <div style={{ display:"flex", flexDirection:"column", gap:12, marginTop:6 }}>
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
              </div>
            </FCard>
          )}

          {/* Gestion du stock : ajouter, retirer, ou definir une valeur */}
          {mode === "restock" && (
            <FCard t="Le stock" i="📦" c={STOCK_OPS[stockMode][2]}>
              <div style={{ display:"flex", flexDirection:"column", gap:12, marginTop:6 }}>
                {/* Choix de l'operation. Retirer sert aux pertes et casses ;
                    definir corrige un inventaire. Ni l'un ni l'autre ne touche
                    au prix unitaire -- seul l'ajout d'un lot le recalcule. */}
                <Seg value={stockMode} onChange={setStockMode} opts={Object.entries(STOCK_OPS).map(([m, [ic, l, col]]) => [m, `${ic} ${l}`, col])}/>

                {stockMode === "set" ? (
                  <>
                    <div><label style={lbl}>Nouveau stock</label>
                      <input style={inp} type="number" min={0} value={setValue} autoFocus
                        onChange={e=>setSetValue(e.target.value)}/></div>
                    <p style={fNote}>
                      Correction d'inventaire. Le prix unitaire ({fmtPrice(d.unit_price)}) reste inchangé.
                    </p>
                  </>
                ) : stockMode === "remove" ? (
                  <>
                    <div><label style={lbl}>Quantité retirée</label>
                      <input style={inp} type="number" min={1} max={d.quantity} value={restock.qty} autoFocus
                        onChange={e=>setRestock(r=>({...r,qty:e.target.value}))}/></div>
                    <p style={fNote}>
                      Perte, casse ou utilisé ailleurs. Reste {Math.max(0, d.quantity - parseInt(restock.qty||"0",10))} en stock · prix inchangé.
                    </p>
                  </>
                ) : (
                  <>
                    <div><label style={lbl}>Quantité reçue</label>
                      <input style={inp} type="number" min={1} value={restock.qty} autoFocus
                        onChange={e=>setRestock(r=>({...r,qty:e.target.value}))}/></div>
                    <div>
                      <Seg value={priceMode} onChange={setPriceMode} opts={[["total", "Coût du lot", "#3B82F6"], ["unit", "Prix / unité", "#3B82F6"]]}/>
                      <div style={{ height:6 }}/>
                      {priceMode === "total" ? (
                        <input style={inp} type="number" step="0.01" placeholder="€ pour tout le lot"
                          value={restock.total_price}
                          onChange={e=>setRestock(r=>({...r,total_price:e.target.value}))}/>
                      ) : (
                        <input style={inp} type="number" step="0.01" placeholder="€ par unité"
                          value={unitInput} onChange={e=>setUnitInput(e.target.value)}/>
                      )}
                    </div>
                    <p style={fNote}>
                      {newAvg != null
                        ? `Nouveau stock : ${d.quantity + parseInt(restock.qty||"0",10)} · prix moyen ${fmtPrice(newAvg)}/u`
                        : "Laisser le coût vide pour ajouter du stock sans changer le prix unitaire."}
                    </p>
                  </>
                )}
              </div>
            </FCard>
          )}

          {/* Regroupement modifiable sans passer en mode edition : c'est un
              rangement, pas une caracteristique de l'accessoire, et l'imposer
              derriere "Modifier" rendait le simple deplacement laborieux. */}
          <AdminOnly>
            <FCard t="Regroupement" i="🗂️" c={c}>
              <div style={{ marginTop:6 }}>
                <CategoryPicker value={d.category || null}
                  onChange={async (v) => {
                    try {
                      await client.patch(`/objects/accessories/${accId}`, { category: v });
                      await load(); onChanged?.();
                    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
                  }}/>
              </div>
            </FCard>
          </AdminOnly>

          {/* Objets qui utilisent l'accessoire */}
          {(d.objects || []).length > 0 && (
            <FCard t={`Utilisé dans ${d.used_in_objects} objet${d.used_in_objects>1?"s":""}`} i="🎁" c="#8B5CF6">
              {d.objects.slice(0,20).map(o => (
                <div key={o.id} onClick={() => openObj(o.id)}
                  style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", cursor:"pointer", borderTop:"1px dashed var(--border)" }}>
                  <ObjThumb id={o.id} size={34}/>
                  <span style={{ fontSize:13.5, fontWeight:800, flex:1, minWidth:0, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis",
                    whiteSpace:"nowrap" }}>{o.name}</span>
                  <span style={{ fontSize:12, fontWeight:800, color:"var(--muted)" }}>×{o.quantity}</span>
                </div>
              ))}
            </FCard>
          )}

          {(d.created_at || d.updated_at) && <FCard t="Son histoire" i="🕓" c="#64748B" fold open={histOpen} onToggle={() => setHistOpen(o => !o)}
            summary={<p style={{ margin:"4px 0 0", fontSize:12.5, fontWeight:700, color:"var(--muted)" }}>
              {d.created_at ? `Créé le ${dayFr(String(d.created_at).slice(0, 10))}` : ""}</p>}>
            <FRow l="Créé le" v={d.created_at ? dayFr(String(d.created_at).slice(0, 10)) : null}/>
            <FRow l="Dernière modification" v={d.updated_at ? dayFr(String(d.updated_at).slice(0, 10)) : null}/>
          </FCard>}
        </div>
        {viewObj && (
          <ObjectSheet obj={viewObj} onClose={() => setViewObj(null)}
            onUpdated={(u) => { if (u) setViewObj(u); load(); }}/>
        )}
      </>)}
    </FSheet>
  );
}

// ── Creation d'un accessoire ──────────────────────────────────────────────
function AccessoryCreateSheet({ onClose, onCreated }) {
  useTrackDetail("Objets · Nouvel accessoire");
  const [form, setForm] = React.useState({ name:"", quantity:"0", unit_price:"0", total_price:"" });
  const [priceMode, setPriceMode] = React.useState("unit");  // unit | total
  const [busy, setBusy] = React.useState(false);
  const inp = fInp;

  const qty = parseInt(form.quantity || "0", 10);
  // Prix unitaire effectif : saisi tel quel, ou deduit du total reparti sur la
  // quantite. Repartir un total sans quantite n'a pas de sens -> 0.
  const effUnit = priceMode === "total"
    ? (qty > 0 ? parseFloat(form.total_price || "0") / qty : 0)
    : parseFloat(form.unit_price || "0");
  const lbl = fLbl;

  const create = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const r = await client.post("/objects/accessories", {
        name: form.name.trim(),
        quantity: qty,
        // Le serveur stocke un prix unitaire : on lui envoie l'unitaire
        // effectif, que l'utilisateur ait saisi l'un ou l'autre.
        unit_price: effUnit,
      });
      onCreated?.(r.data?.id);
    } catch(e) {
      showAlert(e.response?.data?.detail || "Création impossible (nom déjà utilisé ?)");
      setBusy(false);
    }
  };

  const off = busy || !form.name.trim();
  return (
    <FSheet onClose={onClose} z={340} bottom={<>
      <button onClick={onClose} style={{ ...fBtn, flex:1 }}>Annuler</button>
      <button onClick={create} disabled={off} style={{ ...fBtn, flex:2, border:"none", color:"#fff", opacity: off ? .6 : 1,
        cursor: off ? "not-allowed" : "pointer", background:"linear-gradient(135deg, #14B8A6, #2DD4BF)", boxShadow:"0 8px 18px -10px #14B8A6" }}>
        {busy ? "Création…" : "✓ Créer"}</button></>}>
      <div style={{ padding:"52px 18px 16px", background:"radial-gradient(circle at 15% 40%, rgba(20,184,166,0.35), transparent 60%), var(--surface2)" }}>
        <div style={{ fontSize:12, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#0d9488" }}>🔩 Nouvel accessoire</div>
        <div style={{ fontSize:22, fontWeight:900, color: form.name.trim() ? "var(--text)" : "var(--muted)", lineHeight:1.15, overflowWrap:"anywhere" }}>
          {form.name.trim() || "Son nom ?"}</div>
        <div style={{ fontSize:12.5, fontWeight:700, color:"var(--muted)", marginTop:2 }}>
          {qty > 0 ? `${qty} en stock · ${fmtPrice(effUnit)} / u` : "Aucun stock pour l'instant"}</div>
      </div>
      <div style={{ padding:"14px 16px 18px", display:"flex", flexDirection:"column", gap:12 }}>
          <div><label style={lbl}>Nom</label>
            <input style={inp} autoFocus value={form.name} placeholder="Ex : Aimant 10×3"
              onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
          <div><label style={lbl}>Stock initial</label>
            <input style={inp} type="number" value={form.quantity}
              onChange={e=>setForm(f=>({...f,quantity:e.target.value}))}/></div>
          <div>
            <Seg value={priceMode} onChange={setPriceMode} opts={[["unit", "Prix / unité", "#14B8A6"], ["total", "Coût total", "#14B8A6"]]}/>
            <div style={{ height:6 }}/>
            {priceMode === "unit" ? (
              <input style={inp} type="number" step="0.01" placeholder="€ par unité"
                value={form.unit_price}
                onChange={e=>setForm(f=>({...f,unit_price:e.target.value}))}/>
            ) : (
              <input style={inp} type="number" step="0.01" placeholder="€ pour tout le stock"
                value={form.total_price}
                onChange={e=>setForm(f=>({...f,total_price:e.target.value}))}/>
            )}
          </div>
          <p style={fNote}>
            {priceMode === "total" && qty > 0
              ? `Soit ${fmtPrice(effUnit)} / unité. `
              : ""}
            La photo pourra être ajoutée depuis la fiche, juste après la création.
          </p>
      </div>
    </FSheet>
  );
}

/**
 * Applique un regroupement a plusieurs accessoires d'un coup.
 *
 * Reutilise le meme selecteur que la fiche individuelle : une seule facon de
 * nommer un regroupement, donc pas de divergence possible entre les deux
 * chemins -- et l'anti-doublon vaut ici aussi.
 */
function BulkCategorySheet({ ids, onClose, onDone }) {
  useTrackDetail("Objets · Catégorie en lot");
  const [cat, setCat] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const apply = async () => {
    setBusy(true);
    try {
      // En serie et non en parallele : quelques accessoires tout au plus, et
      // une erreur reste ainsi rattachable a une ligne precise.
      for (const id of ids) {
        await client.patch(`/objects/accessories/${id}`, { category: cat });
      }
      onDone();
    } catch (e) {
      showAlert(e.response?.data?.detail || e.message);
      setBusy(false);
    }
  };

  return (
    <FSheet onClose={onClose} z={6000} bottom={<>
      <button onClick={onClose} style={{ ...fBtn, flex:1 }}>Annuler</button>
      <button onClick={apply} disabled={busy} style={{ ...fBtn, flex:2, border:"none", color:"#fff", opacity: busy ? .6 : 1,
        background:"linear-gradient(135deg, #14B8A6, #2DD4BF)", boxShadow:"0 8px 18px -10px #14B8A6" }}>{busy ? "Application…" : "✓ Appliquer"}</button></>}>
      <div style={{ padding:"52px 18px 16px", background:"radial-gradient(circle at 15% 40%, rgba(20,184,166,0.3), transparent 60%), var(--surface2)" }}>
        <div style={{ fontSize:12, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#0d9488" }}>🗂️ Regrouper</div>
        <div style={{ fontSize:21, fontWeight:900, color:"var(--text)", lineHeight:1.15 }}>{ids.length} accessoire{ids.length>1?"s":""}</div>
        <div style={{ fontSize:12.5, fontWeight:700, color:"var(--muted)", marginTop:2 }}>Choisis un regroupement existant, ou crée-en un.</div>
      </div>
      <div style={{ padding:"14px 16px 18px" }}>
        <CategoryPicker value={cat} onChange={setCat}/>
        {/* Bouton distinct plutot qu'un champ laisse vide : sortir du
            regroupement est une action a part entiere, pas une absence de
            choix, et rien ne l'aurait signale autrement. */}
        <button onClick={() => setCat(null)}
          style={{ marginTop:10, padding:"7px 13px", borderRadius:20, fontSize:12,
            fontWeight:800, cursor:"pointer", border:"1px solid " + (cat === null ? "rgba(239,68,68,0.4)" : "var(--border)"),
            background: cat === null ? "rgba(239,68,68,0.12)" : "transparent",
            color: cat === null ? "#ef4444" : "var(--muted)" }}>
          {cat === null ? "✓ " : ""}Retirer de tout regroupement
        </button>
      </div>
    </FSheet>
  );
}

function AccessoryCard({ acc, onClick, onLongPress, selectMode, selected }) {
  // Appui long / clic droit : menu (ouvrir, selectionner).
  const [press, guard] = useLongPress(e => openMenu(e, {
    title: acc.name || "Accessoire", subtitle: acc.quantity != null ? `Stock : ${acc.quantity}` : null,
    items: [
      onClick && { icon: "📄", label: "Ouvrir", onClick },
      onLongPress && { icon: "☑", label: "Sélectionner", hint: "Pour changer la catégorie de plusieurs", onClick: onLongPress },
    ],
  }), { disabled: selectMode });
  const [imgOk, setImgOk] = useState(true);
  const q = acc.quantity || 0;
  // l'etat du stock se lit avant le chiffre : rupture en rouge sur toute la carte, stock bas en orange
  const tone = q === 0 ? "#ef4444" : q < LOW_STOCK ? "#f59e0b" : "#22c55e";
  const c = sectionColor((acc.category || "").trim() || null);
  return (
    <div className="card" {...press}
      onClick={guard(() => onClick && onClick())}
      style={{ WebkitTouchCallout:"none", userSelect:"none", padding:0, overflow:"hidden", cursor: onClick ? "pointer" : "default",
        position:"relative", borderRadius:18, display:"flex", flexDirection:"column",
        border:`1px solid ${q === 0 ? "rgba(239,68,68,0.55)" : `color-mix(in srgb, ${c} 30%, var(--border))`}`,
        background: q === 0 ? "linear-gradient(170deg, rgba(239,68,68,0.12), transparent 55%), var(--surface2)"
          : `linear-gradient(170deg, color-mix(in srgb, ${c} 10%, transparent), transparent 55%), var(--surface2)`,
        boxShadow:`0 8px 22px -16px ${q === 0 ? "#ef4444" : c}`,
        outline: selected ? "2px solid #3b82f6" : "none", outlineOffset:-2 }}>
      {selectMode && <SelDot on={selected}/>}
      <div style={{ position:"relative", aspectRatio:"1 / 0.78", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden",
        padding:10, boxSizing:"border-box", background:`radial-gradient(70% 70% at 50% 45%, color-mix(in srgb, ${c} 22%, transparent), transparent 75%), var(--surface)` }}>
        {acc.has_image && imgOk
          ? <img src={apiThumb(apiUrl(`/objects/accessories/${acc.id}/image`), 384)} alt={acc.name} loading="lazy" decoding="async"
              // contain : l'image entiere est visible, plus de rognage.
              style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }}
              onError={() => setImgOk(false)}/>
          : <Package size={40} style={{ color:c, opacity:.75 }}/>}
        <span style={{ ...pill, position:"absolute", top:7, left:7, color:"#fff",
          background:`linear-gradient(135deg, ${tone}, color-mix(in srgb, ${tone} 65%, #ffffff))` }}>
          {q === 0 ? "Rupture" : `${q} en stock`}</span>
      </div>
      <div style={{ padding:"8px 10px 10px", display:"flex", flexDirection:"column", gap:3 }}>
        <p style={{ ...cardName }}>{acc.name}</p>
        <span style={{ display:"flex", justifyContent:"space-between", gap:6, fontSize:11, fontWeight:700, color:"var(--muted)" }}>
          <span>{fmtPrice(acc.unit_price)} / u</span>
          {q > 0 && <span style={{ fontWeight:800, color:"var(--text2)" }}>{fmtPrice(q * (acc.unit_price || 0))}</span>}
        </span>
      </div>
    </div>
  );
}

// La vignette d'un accessoire : sa photo, sinon un paquet
function AccThumb({ id, size = 34 }) {
  const [ok, setOk] = useState(true);
  return <span style={{ width:size, height:size, borderRadius:10, overflow:"hidden", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
    background:"radial-gradient(circle, rgba(20,184,166,0.25), transparent 75%), var(--surface)", border:"1px solid var(--border)" }}>
    {ok ? <img src={apiThumb(apiUrl(`/objects/accessories/${id}/image`), 128)} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={() => setOk(false)}/>
      : <Package size={size * 0.5} style={{ color:"#14B8A6" }}/>}</span>;
}

// Vente rapide (25/10/2026) : le prix (le prix vise propose) et la date (aujourd'hui), deux gestes depuis la fiche.
// La feuille Modifier garde tout le reste (annuler une vente, changer d'etat).
function QuickSell({ obj, onClose, onDone }) {
  useTrackDetail("Objets · Vendre");
  const today = new Date().toISOString().slice(0, 10);
  const [price, setPrice] = useState(obj.desired_price > 0 ? String(obj.desired_price) : "");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const p = parseFloat(String(price).replace(",", "."));
  const ok = p > 0;
  const margin = ok ? p - (obj.cost_total || 0) : null;
  const sell = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try { await client.patch(`/objects/objects/${obj.id}`, { sold_price: p, sold_date: date || today }); onDone(); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); setBusy(false); }
  };
  const inp = { width:"100%", boxSizing:"border-box", padding:"12px 14px", borderRadius:14, border:"1px solid var(--border)", background:"var(--surface)",
    color:"var(--text)", fontSize:16, fontWeight:800, outline:"none" };
  return (
    <FSheet onClose={onClose} z={330} bottom={<>
      <button onClick={onClose} style={{ ...fBtn, flex:1 }}>Annuler</button>
      <button onClick={sell} disabled={!ok || busy} style={{ ...fBtn, flex:2, border:"none", color:"#fff", opacity: ok ? 1 : .5,
        background:"linear-gradient(135deg, #22C55E, #16A34A)", boxShadow:"0 8px 18px -10px #22C55E" }}>{busy ? "…" : "✓ Marquer vendu"}</button>
    </>}>
      <div style={{ padding:"52px 18px 14px", background:"radial-gradient(circle at 15% 40%, rgba(34,197,94,0.35), transparent 60%), var(--surface2)" }}>
        <div style={{ fontSize:12, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#16a34a" }}>💶 Vendre</div>
        <div style={{ fontSize:22, fontWeight:900, color:"var(--text)", lineHeight:1.15 }}>{obj.translated_name || obj.name}</div>
        <div style={{ fontSize:12.5, fontWeight:700, color:"var(--muted)", marginTop:2 }}>Coût {costLine(obj)}</div>
      </div>
      <div style={{ padding:"14px 16px 18px", display:"flex", flexDirection:"column", gap:12 }}>
        <label style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <span style={{ fontSize:12.5, fontWeight:800, color:"var(--muted)" }}>Prix de vente (€)</span>
          <input autoFocus inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" style={inp}/>
        </label>
        <label style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <span style={{ fontSize:12.5, fontWeight:800, color:"var(--muted)" }}>Date de la vente</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, fontSize:15, fontWeight:700 }}/>
        </label>
        {margin != null && !isMoneyHidden() && <div style={{ padding:"10px 12px", borderRadius:14, fontSize:13.5, fontWeight:900,
          color: margin >= 0 ? "#16a34a" : "#ef4444", background: margin >= 0 ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.1)",
          border:`1px solid ${margin >= 0 ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}` }}>
          {margin >= 0 ? `+${fmtPrice(margin)} de marge` : `${fmtPrice(margin)} : vendu à perte`}
          {obj.cost_total > 0 && <span style={{ fontWeight:700, opacity:.8 }}> · {((p / obj.cost_total - 1) * 100).toFixed(0)} %</span>}</div>}
      </div>
    </FSheet>
  );
}

// Les champs des feuilles de la page
const fInp = { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:12, padding:"10px 12px", fontSize:14,
  fontWeight:700, color:"var(--text)", outline:"none", width:"100%", boxSizing:"border-box" };
const fLbl = { fontSize:12, fontWeight:800, color:"var(--muted)", marginBottom:5, display:"block" };
const fNote = { fontSize:12, fontWeight:600, color:"var(--muted)", margin:0, lineHeight:1.4 };
// un choix a quelques options, en pastilles (l'active dans sa couleur)
function Seg({ value, onChange, opts }) {
  return <div style={{ display:"flex", gap:4, padding:3, borderRadius:14, background:"var(--surface)", border:"1px solid var(--border)" }}>
    {opts.map(([v, l, col]) => { const on = value === v;
      return <button key={v} type="button" onClick={() => onChange(v)} style={{ flex:1, padding:"7px 6px", borderRadius:11, fontSize:12.5, fontWeight:800,
        cursor:"pointer", border:"none", whiteSpace:"nowrap", color: on ? "#fff" : "var(--muted)",
        background: on ? `linear-gradient(135deg, ${col}, color-mix(in srgb, ${col} 65%, #ffffff))` : "transparent",
        boxShadow: on ? `0 4px 12px -6px ${col}` : "none" }}>{l}</button>; })}
  </div>;
}
// la vignette d'un objet : sa photo, sinon un paquet cadeau
function ObjThumb({ id, size = 34 }) {
  const [ok, setOk] = useState(true);
  return <span style={{ width:size, height:size, borderRadius:10, overflow:"hidden", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
    background:"radial-gradient(circle, rgba(139,92,246,0.25), transparent 75%), var(--surface)", border:"1px solid var(--border)", fontSize:size * 0.45 }}>
    {ok ? <img src={apiThumb(apiUrl(`/objects/objects/${id}/image`), 128)} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={() => setOk(false)}/> : "🎁"}</span>;
}

// Les petits morceaux communs aux cartes de la page
const LOW_STOCK = 5;
const pill = { fontSize:10, fontWeight:900, padding:"2px 8px", borderRadius:20, whiteSpace:"nowrap", boxShadow:"0 3px 10px rgba(0,0,0,.25)" };
const glassPill = { ...pill, color:"#fff", background:"rgba(15,23,42,0.6)", backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)",
  border:"1px solid rgba(255,255,255,.2)" };
const cardName = { fontWeight:800, fontSize:13, lineHeight:1.25, color:"var(--text)", margin:0, overflow:"hidden",
  display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" };
function SelDot({ on }) {
  return <span style={{ position:"absolute", top:7, right:7, zIndex:3, width:24, height:24, borderRadius:"50%", display:"flex", alignItems:"center",
    justifyContent:"center", fontSize:12, border:"2px solid " + (on ? "#3b82f6" : "rgba(255,255,255,0.8)"),
    background: on ? "linear-gradient(135deg, #3B82F6, #6366F1)" : "rgba(0,0,0,0.35)", color:"white", fontWeight:900 }}>{on ? "✓" : ""}</span>;
}
// le cout d'un objet, reel puis au prix normal du filament entre parentheses quand il differe
const costLine = o => {
  const real = o.cost_total || 0, normal = (o.normal_cost_unit ?? o.cost_fabrication ?? 0) + (o.cost_accessory || 0);
  return Math.abs(normal - real) >= 0.01 ? `${fmtPrice(real)} (${fmtPrice(normal)})` : fmtPrice(real);
};

// ── Object Detail Sheet ───────────────────────────────────────────────────

// ── Sélecteur d'accessoire ────────────────────────────────────────────────
// Recherche filtrée en direct, vignette, choix de quantité borne au stock,
// estimation du restant. Inspiré de Spoolnymous.

// ── Édition d'un objet ────────────────────────────────────────────────────
// Formulaire complet : nom FR, commentaire, perso, disponibilité, prix desire,
// vente (prix + date) et annulation de vente.
function ObjectEditSheet({ obj, onClose, onSaved }) {
  useTrackDetail("Objets · Modifier un objet");
  const kb = useKeyboardInset();
  const [form, setForm] = React.useState({
    translated_name: obj.translated_name || obj.name || "",
    comment:         obj.comment || "",
    personal:        !!obj.personal,
    status:          objStatus(obj),
    available:       !!obj.available,
    desired_price:   obj.desired_price != null ? String(obj.desired_price) : "",
    sold_price:      obj.sold_price != null && obj.sold_price > 0 ? String(obj.sold_price) : "",
    sold_date:       obj.sold_date ? String(obj.sold_date).slice(0,10) : "",
  });
  const [saving, setSaving] = React.useState(false);
  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));
  const wasSold = obj.sold_price != null && obj.sold_price > 0;

  const inp = fInp, lbl = fLbl;
  const cur = OBJ_STATUS[form.status] || OBJ_STATUS.available;

  const save = async (extra={}) => {
    setSaving(true);
    try {
      const payload = { ...extra };
      if (!("unsell" in extra)) {
        payload.translated_name = form.translated_name;
        payload.comment = form.comment;
        payload.personal = form.personal;
        // Un objet vendu garde son etat : il se quitte en effacant le prix,
        // pas en changeant d'etiquette.
        if (form.status !== "sold") payload.status = form.status;
        payload.available = form.available;
        // Champ vide = EFFACER, et non mettre a zero. Un zero se serait
        // affiche sur la tuile comme un prix vise a 0 EUR.
        payload.desired_price = form.desired_price.trim() === ""
          ? null : parseFloat(form.desired_price);
        if (form.sold_price !== "") {
          payload.sold_price = parseFloat(form.sold_price);
          if (form.sold_date) payload.sold_date = form.sold_date;
        }
      }
      await client.patch(`/objects/objects/${obj.id}`, payload);
      onSaved();
    } catch(e) { showAlert("Erreur: " + (e.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  return (
    <FSheet onClose={onClose} z={320} bottom={<>
      <button onClick={onClose} style={{ ...fBtn, flex:1 }}>Annuler</button>
      <button onClick={()=>save()} disabled={saving} style={{ ...fBtn, flex:2, border:"none", color:"#fff", opacity: saving ? .6 : 1,
        background:"linear-gradient(135deg, #3B82F6, #6366F1)", boxShadow:"0 8px 18px -10px #3B82F6" }}>{saving ? "Enregistrement…" : "✓ Enregistrer"}</button></>}>
      <div style={{ padding:"52px 18px 16px",
        background:`radial-gradient(circle at 15% 40%, ${cur.color}55, transparent 60%), var(--surface2)` }}>
        <div style={{ fontSize:12, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:cur.color }}>✏️ Modifier l'objet <Hide at="object-edit"/></div>
        <div style={{ fontSize:22, fontWeight:900, color:"var(--text)", lineHeight:1.15, overflowWrap:"anywhere" }}>{form.translated_name || obj.name}</div>
        <div style={{ marginTop:6 }}>{fChip(`${cur.icon} ${cur.label}`, cur.color)}</div>
      </div>

        <div style={{ display:"flex", flexDirection:"column", gap:14, padding:"14px 16px 18px", paddingBottom: 18 + kb }}>
          <div>
            <label style={lbl}>Nom</label>
            <input style={inp} value={form.translated_name} onChange={e=>set("translated_name",e.target.value)}/>
          </div>

          <div>
            <label style={lbl}>Commentaire</label>
            <textarea style={{ ...inp, minHeight:64, resize:"vertical", fontFamily:"inherit", fontWeight:600 }}
              value={form.comment} onChange={e=>set("comment",e.target.value)}/>
          </div>

          {/* Un choix UNIQUE remplace deux bascules independantes : elles
              autorisaient des combinaisons sans signification (perso ET
              disponible) et n'offraient aucune case pour "offert". La vente,
              elle, se fait par le champ prix -- elle porte un montant et une
              date, ce n'est pas une simple etiquette. */}
          <div>
            <label style={lbl}>État</label>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              {["available","personal","gifted","unavailable"].map(k => {
                const c = OBJ_STATUS[k], on = form.status === k;
                return (
                  <button key={k} onClick={()=>set("status",k)}
                    style={{ padding:"11px 8px", borderRadius:14, cursor:"pointer", fontSize:13, fontWeight:800,
                      display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                      border: on ? "none" : "1px solid var(--border)",
                      background: on ? `linear-gradient(135deg, ${c.color}, color-mix(in srgb, ${c.color} 65%, #ffffff))` : "var(--surface)",
                      boxShadow: on ? `0 6px 14px -8px ${c.color}` : "none",
                      color: on ? "#fff" : "var(--text2)" }}>
                    <span>{c.icon}</span>{c.label}
                  </button>
                );
              })}
            </div>
            {form.status === "sold" && (
              <p style={{ ...fNote, marginTop:8 }}>
                Objet vendu. Efface le prix de vente pour le remettre en circulation.
              </p>
            )}
          </div>

          <div>
            <label style={lbl}>Prix désiré (€)</label>
            <input style={inp} type="number" step="0.01" value={form.desired_price}
              onChange={e=>set("desired_price",e.target.value)} placeholder="—"/>
          </div>

          {/* Vente */}
          <FCard t="Vente" i="💶" c="#22C55E">
            <div style={{ display:"flex", gap:8, marginTop:6 }}>
              <input style={{ ...inp, flex:1, minWidth:0 }} type="number" step="0.01" value={form.sold_price}
                onChange={e=>set("sold_price",e.target.value)} placeholder="Prix de vente"/>
              <input style={{ ...inp, flex:1, minWidth:0 }} type="date" value={form.sold_date}
                onChange={e=>set("sold_date",e.target.value)}/>
            </div>
            {wasSold && (
              <button onClick={()=>save({ unsell:true })} disabled={saving}
                style={{ marginTop:10, width:"100%", padding:"10px", borderRadius:12, cursor:"pointer",
                  fontSize:13, fontWeight:800, border:"1px solid rgba(239,68,68,0.35)",
                  background:"rgba(239,68,68,0.08)", color:"#ef4444" }}>
                Annuler la vente (remettre disponible)
              </button>
            )}
          </FCard>
        </div>
    </FSheet>
  );
}

function AccessoryPicker({ accessories, onClose, onConfirm, multiplier = 1 }) {
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(null);   // accessoire choisi
  const [qty, setQty] = React.useState(1);
  const kb = useKeyboardInset();

  const filtered = React.useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return accessories;
    return accessories.filter(a => (a.name || "").toLowerCase().includes(t));
  }, [q, accessories]);

  const mult = Math.max(1, Number(multiplier) || 1);   // ex. nb d'objets d'un groupe
  const stock = sel ? Number(sel.quantity || 0) : 0;
  const qn = Math.max(1, Number(qty || 1));
  const total = qn * mult;                             // quantite reellement prise au stock
  const maxQty = Math.max(1, Math.floor(stock / mult));
  const tooMuch = sel && total > stock;
  const remaining = sel ? stock - total : 0;

  const confirm = () => {
    if (!sel || tooMuch || qn < 1) return;
    onConfirm(sel.id, qn);
  };

  const blocked = !sel || tooMuch || qn < 1;
  const stepB = (label, on, off) => <button onClick={on} disabled={off} style={{ width:40, height:40, borderRadius:12, border:"1px solid var(--border)",
    background:"var(--surface)", color:"var(--text)", cursor:"pointer", fontSize:18, fontWeight:900, opacity: off ? .4 : 1 }}>{label}</button>;
  return (
    <FSheet onClose={onClose} z={300} bottom={<>
      <button onClick={onClose} style={{ ...fBtn, flex:1 }}>Annuler</button>
      <button onClick={confirm} disabled={blocked} style={{ ...fBtn, flex:2, border:"none", color:"#fff", opacity: blocked ? .5 : 1,
        cursor: blocked ? "not-allowed" : "pointer", background:"linear-gradient(135deg, #14B8A6, #2DD4BF)", boxShadow:"0 8px 18px -10px #14B8A6" }}>
        {sel ? `✓ Ajouter ${qn > 1 ? `×${qn}` : ""}` : "Choisis un accessoire"}</button></>}>
      <div style={{ padding:"52px 18px 14px", background:"radial-gradient(circle at 15% 40%, rgba(20,184,166,0.32), transparent 60%), var(--surface2)" }}>
        <div style={{ fontSize:12, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#0d9488" }}>🔩 Ajouter un accessoire</div>
        <div style={{ fontSize:21, fontWeight:900, color: sel ? "var(--text)" : "var(--muted)", lineHeight:1.15, overflowWrap:"anywhere" }}>
          {sel ? sel.name : "Lequel ?"}</div>
        {mult > 1 && <div style={{ fontSize:12.5, fontWeight:700, color:"var(--muted)", marginTop:2 }}>Pour chacun des {mult} objets du groupe</div>}
      </div>
      <div style={{ padding:"12px 16px 16px", paddingBottom: 16 + kb, display:"flex", flexDirection:"column", gap:10 }}>
        {/* Recherche */}
        <div style={{ position:"relative" }}>
          <Search size={15} style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--muted)" }}/>
          <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher un accessoire…"
            style={{ width:"100%", height:40, padding:"0 12px 0 38px", background:"var(--surface)",
              border:"1px solid var(--border)", borderRadius:20, color:"var(--text)", fontSize:13.5, boxSizing:"border-box", outline:"none" }}/>
        </div>

        {/* Résultats filtrés avec vignette */}
        <div style={{ maxHeight:"34vh", overflowY:"auto", display:"flex", flexDirection:"column", gap:6 }}>
          {filtered.length === 0 && <p style={{ ...fNote, textAlign:"center", padding:"10px 0" }}>Aucun accessoire</p>}
          {filtered.map(a => {
            const active = sel?.id === a.id;
            const st = a.quantity || 0, t = st === 0 ? "#ef4444" : st < LOW_STOCK ? "#f59e0b" : "#22c55e";
            return (
              <button key={a.id} onClick={()=>{ setSel(a); setQty(1); }}
                style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"8px 10px", textAlign:"left", cursor:"pointer",
                  borderRadius:14, font:"inherit", color:"inherit",
                  background: active ? "linear-gradient(135deg, rgba(20,184,166,0.2), transparent 70%), var(--surface)" : "var(--surface)",
                  border: active ? "1.5px solid #14B8A6" : "1px solid var(--border)" }}>
                <AccThumb id={a.id} size={38}/>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"block", fontSize:13.5, fontWeight:800, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</span>
                  <span style={{ display:"block", fontSize:11.5, fontWeight:700, color:"var(--muted)", marginTop:1 }}>
                    <b style={{ color:t }}>{st === 0 ? "rupture" : `${st} en stock`}</b> · {fmtPrice(a.unit_price)}/u</span>
                </span>
                {active && <span style={{ color:"#14B8A6", fontWeight:900 }}>✓</span>}
              </button>
            );
          })}
        </div>

        {/* Quantité + estimation (visible une fois un accessoire choisi) */}
        {sel && (
          <FCard t={mult > 1 ? "Quantité par objet" : "Quantité"} i="🔢" c="#14B8A6"
            aside={<span style={{ fontSize:11.5, fontWeight:800, color:"var(--muted)" }}>stock dispo : {stock}</span>}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:6 }}>
              {stepB("−", ()=>setQty(Math.max(1, qn-1)), qn <= 1)}
              <input type="number" min={1} max={maxQty} value={qty}
                onChange={e=>{ let v=Math.max(1, Number(e.target.value||1)); if(v>maxQty) v=maxQty; setQty(v); }}
                style={{ ...fInp, flex:1, height:40, textAlign:"center", fontSize:18, fontWeight:900, color:"#0d9488" }}/>
              {stepB("+", ()=>setQty(Math.min(maxQty, qn+1)), qn >= maxQty)}
            </div>
            {/* Estimation du restant */}
            <p style={{ ...fNote, marginTop:8, color: tooMuch ? "#ef4444" : "var(--muted)" }}>
              {tooMuch
                ? `Stock insuffisant : maximum ${maxQty} par objet (${stock} en stock).`
                : mult > 1
                  ? `${qn} × ${mult} objets = ${total} retiré(s) · reste ${remaining} · coût ${fmtPrice((sel.unit_price||0)*total)}.`
                  : `Après ajout, il restera ${remaining} en stock · coût ${fmtPrice((sel.unit_price||0)*qn)}.`}
            </p>
          </FCard>
        )}
      </div>
    </FSheet>
  );
}

// Gestion du groupe (ObjectGroup) d'un objet APRES creation : associer a un
// groupe existant, en creer un, ou dissocier. Le backend expose deja
// GET/POST /objects/object-groups et PATCH group_id (null pour dissocier).
function ObjectGroupControl({ obj, onChanged }) {
  const [busy, setBusy] = React.useState(false);
  // Plus de bouton "+ Ajouter" ici : l'ajout a un groupe se fait par selection
  // multiple (appui long) dans la liste. La fiche ne sert plus qu'a VOIR le
  // groupe et a en RETIRER l'objet.
  if (!obj.group_id) return null;
  const remove = async () => {
    setBusy(true);
    try {
      await client.patch(`/objects/objects/${obj.id}`, { group_id: null });
      const r = await client.get(`/objects/objects/${obj.id}`);
      onChanged?.(r.data);
    } catch { onChanged?.(); }
    setBusy(false);
  };
  return (
    <FCard t="Groupe" i="📁" c="#8B5CF6" aside={<button disabled={busy} onClick={remove}
      style={{ padding:"4px 11px", borderRadius:20, fontSize:12, fontWeight:800, cursor:"pointer", border:"1px solid var(--border)",
        background:"var(--surface)", color:"var(--text2)", opacity: busy ? 0.6 : 1 }}>Retirer du groupe</button>}>
      <span style={{ marginTop:4, alignSelf:"flex-start", padding:"5px 12px", borderRadius:20, fontSize:13, fontWeight:900, color:"#fff",
        background:"linear-gradient(135deg, #8B5CF6, #A78BFA)" }}>📁 {obj.group_name || "Groupe"}</span>
    </FCard>
  );
}

export function ObjectSheet({ obj, onClose, onUpdated }) {
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
  const [viewAcc, setViewAcc] = React.useState(null);   // fiche accessoire ouverte sur place

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
        // le groupe seul (28/10/2026 : toute la liste des groupes partait pour en retrouver un)
        const r = await client.get(`/prints/groups/${obj.parent_id}`);
        if (r.data?.id) setParentGroup(r.data);
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
      showAlert(e.response?.data?.detail || e.message);
      setDeleting(false);
    }
  };

  const st = objStatus(obj), cfg = OBJ_STATUS[st], c = cfg.color;
  const [imgOk, setImgOk] = React.useState(true);
  const [costOpen, setCostOpen] = React.useState(false);     // detail des couts, replie a l'ouverture
  const [selling, setSelling] = React.useState(false);       // vente rapide
  const isAdmin = useIsAdmin();
  const normalFab = obj.normal_cost_unit || obj.cost_fabrication || 0;
  const normalTot = normalFab + (obj.cost_accessory || 0);
  const diff = v => Math.abs(v - (obj.cost_total || 0)) >= 0.01;
  const margin = isSold ? obj.sold_price - (obj.cost_total || 0) : null;
  const parentLabel = obj.parent_type === "print" ? "Voir l'impression" : "Voir le groupe d'impressions";
  const hasParent = (obj.parent_type === "print" || obj.parent_type === "group") && obj.parent_id;
  const menu = e => openMenu(e, {
    title: obj.translated_name || obj.name, subtitle: cfg.label, color: c,
    items: [
      hasParent && { icon: "🖨️", label: parentLabel, onClick: openParent },
      isAdmin && "-",
      isAdmin && { icon: "✏️", label: "Modifier", hint: "Nom, commentaire, état, prix, vente", onClick: () => setEditing(true) },
      isAdmin && st === "available" && { icon: "💶", label: "Vendre…", tone: "#22c55e", onClick: () => setSelling(true) },
      isAdmin && { icon: "🔩", label: "Ajouter un accessoire", tone: "#14B8A6", onClick: openAddAcc },
      isAdmin && "-",
      isAdmin && { icon: "🗑", label: "Supprimer l'objet…", tone: "#ef4444", onClick: askDelete },
    ],
  });

  return (<>
    <FSheet onClose={onClose} z={200} bottom={<>
      {isAdmin && st === "available"
        ? <button onClick={() => setSelling(true)} style={{ ...fBtn, flex:1, border:"none", color:"#fff",
            background:"linear-gradient(135deg, #22C55E, #16A34A)", boxShadow:"0 8px 18px -10px #22C55E" }}>💶 Vendre</button>
        : hasParent && <button onClick={openParent} style={{ ...fBtn, flex:1, color:"#3b82f6", borderColor:"rgba(59,130,246,0.4)",
            background:"rgba(59,130,246,0.1)" }}>🖨️ {obj.parent_type === "print" ? "L'impression" : "Le groupe"}</button>}
      <AdminOnly><button onClick={() => setEditing(true)} style={{ ...fBtn, flex:1 }}>✏️ Modifier</button></AdminOnly>
      <button onClick={menu} aria-label="Plus d'actions" style={{ ...fBtn, width:48, flex:"0 0 auto" }}>⋯</button>
    </>}>
      {/* l'objet en vedette : sa photo sur un fond de la couleur de son etat */}
      <div style={{ position:"relative", overflow:"hidden", padding:"52px 18px 18px", display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
        background:`radial-gradient(circle at 18% 45%, ${c}55, transparent 60%), linear-gradient(135deg, ${c}26, transparent 70%), var(--surface2)` }}>
        <div style={{ width:124, height:124, borderRadius:22, overflow:"hidden", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
          background:`radial-gradient(circle, ${c}33, transparent 70%), var(--surface)`, boxShadow:`0 12px 28px -12px ${c}`, border:"1px solid rgba(255,255,255,.12)" }}>
          {imgOk ? <img src={apiThumb(apiUrl(`/objects/objects/${obj.id}/image`), 256)} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}
              onError={() => setImgOk(false)}/>
            : <span style={{ fontSize:52, opacity:.6 }}>{cfg.icon}</span>}
        </div>
        <div style={{ flex:"1 1 190px", minWidth:0, display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {/* Un seul badge, celui de l'etat reel : deux etiquettes potentiellement contradictoires ne renseignaient pas. */}
            {fChip(`${cfg.icon} ${cfg.label}`, c)}
            {obj.group_id && fChip(`📁 ${obj.group_name || "Groupe"}`, "#8B5CF6")}
            {isSold && obj.sold_date && fChip(`📅 ${dayFr(String(obj.sold_date).slice(0, 10))}`, "#22c55e")}
          </div>
          <div style={{ fontSize:24, fontWeight:900, color:"var(--text)", lineHeight:1.12, overflowWrap:"anywhere" }}>{obj.translated_name || obj.name}</div>
          {obj.translated_name && obj.translated_name !== obj.name && <div style={{ fontSize:12.5, fontWeight:700, color:"var(--muted)" }}>{obj.name}</div>}
          {/* le prix qui compte pour cet etat, en grand */}
          {isSold ? <div style={{ display:"flex", alignItems:"baseline", gap:8, flexWrap:"wrap" }}>
              <span style={{ fontSize:28, fontWeight:900, lineHeight:1.2, ...fGrad("#16a34a", "#4ade80") }}>{fmtPrice(obj.sold_price)}</span>
              {margin != null && !isMoneyHidden() && <span style={{ fontSize:13, fontWeight:900, color: margin >= 0 ? "#16a34a" : "#ef4444" }}>
                {margin >= 0 ? "+" : ""}{fmtPrice(margin)} de marge</span>}</div>
            : obj.desired_price > 0 ? <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
              <span style={{ fontSize:28, fontWeight:900, lineHeight:1.2, ...fGrad(c, `color-mix(in srgb, ${c} 60%, #ffffff)`) }}>{fmtPrice(obj.desired_price)}</span>
              <span style={{ fontSize:12.5, fontWeight:800, color:"var(--muted)" }}>prix visé</span></div>
            : null}
          {hasParent && <button onClick={openParent} style={{ alignSelf:"flex-start", display:"inline-flex", alignItems:"center", gap:6, padding:"5px 11px",
            borderRadius:20, cursor:"pointer", fontSize:11.5, fontWeight:800, border:"1px solid rgba(59,130,246,0.35)",
            background:"rgba(59,130,246,0.12)", color:"#3b82f6" }}><ExternalLink size={13}/>{parentLabel}</button>}
        </div>
      </div>

      <div style={{ padding:"14px 14px 18px", display:"flex", flexDirection:"column", gap:12 }}>
        {/* les chiffres : cout reel (normal), part des accessoires, prix vise ou vendu */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))", gap:8 }}>
          <FTile label="💰 Coût" value={fmtPrice(obj.cost_total)} sub={diff(normalTot) ? `(${fmtPrice(normalTot)} au normal)` : "réel"} c1="#3b82f6" c2="#60a5fa"
            tip="Coût de revient réel ; entre parenthèses, au prix normal du filament"/>
          <FTile label="🖨️ Fabrication" value={fmtPrice(obj.cost_fabrication)} sub={diff(normalFab + (obj.cost_accessory || 0)) ? `(${fmtPrice(normalFab)})` : "filament et énergie"}
            c1="#8B5CF6" c2="#C084FC"/>
          <FTile label="🔩 Accessoires" value={fmtPrice(obj.cost_accessory)} sub={`${accessories.length} pièce${accessories.length > 1 ? "s" : ""}`} c1="#14B8A6" c2="#2DD4BF"/>
          {isSold
            ? <FTile label="✅ Vendu" value={fmtPrice(obj.sold_price)}
                sub={obj.cost_total > 0 ? `${obj.sold_price >= obj.cost_total ? "+" : ""}${((obj.sold_price / obj.cost_total - 1) * 100).toFixed(0)} %` : null} c1="#22c55e" c2="#4ade80"/>
            : <FTile label="🎯 Prix visé" value={obj.desired_price > 0 ? fmtPrice(obj.desired_price) : "—"}
                sub={obj.desired_price > 0 && obj.cost_total > 0 && !isMoneyHidden() ? `+${fmtPrice(obj.desired_price - obj.cost_total)} espérés` : "pas de prix"} c1="#F59E0B" c2="#FBBF24"/>}
        </div>

        {obj.comment && <FCard t="Commentaire" i="💬" c="#64748B">
          <p style={{ margin:"4px 0 2px", fontSize:13.5, lineHeight:1.45, color:"var(--text)", whiteSpace:"pre-wrap" }}>{obj.comment}</p></FCard>}

        {/* Accessoires montes : toucher l'un ouvre sa fiche */}
        <FCard t="Accessoires" i="🔩" c="#14B8A6" aside={<AdminOnly><button onClick={openAddAcc} style={{ padding:"4px 11px", borderRadius:20, fontSize:12,
          fontWeight:800, cursor:"pointer", border:"1px solid rgba(20,184,166,0.4)", background:"rgba(20,184,166,0.12)", color:"#0d9488" }}>+ Ajouter</button></AdminOnly>}>
          {accessories.length === 0 && <p style={{ fontSize:12.5, color:"var(--muted)", margin:"4px 0 2px" }}>Aucun accessoire monté.</p>}
          {accessories.map(a => (
            <div key={a.accessory_id} onClick={() => setViewAcc(a.accessory_id)}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", cursor:"pointer", borderTop:"1px dashed var(--border)" }}>
              <AccThumb id={a.accessory_id} size={34}/>
              <span style={{ flex:1, minWidth:0, fontSize:13.5, fontWeight:800, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</span>
              <span style={{ fontSize:12, fontWeight:800, color:"var(--muted)" }}>×{a.qty}</span>
              <span style={{ fontSize:13, fontWeight:900, color:"var(--text)" }}>{fmtPrice(a.unit_price * a.qty)}</span>
              <AdminOnly><button onClick={(e)=>{ e.stopPropagation(); unlinkAcc(a.accessory_id); }} aria-label="Retirer cet accessoire" data-tip="Retirer (rendu au stock)"
                style={{ width:26, height:26, borderRadius:"50%", background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.25)",
                  cursor:"pointer", color:"#ef4444", fontSize:12, flexShrink:0 }}>✕</button></AdminOnly>
            </div>
          ))}
        </FCard>

        {obj.group_id && <ObjectGroupControl obj={obj} onChanged={onUpdated}/>}

        {/* Le detail des couts, replie (le total est deja en tuile) */}
        <FCard t="Le détail des coûts" i="🧾" c="#3B82F6" fold open={costOpen} onToggle={() => setCostOpen(o => !o)}
          summary={<p style={{ margin:"4px 0 0", fontSize:12.5, fontWeight:700, color:"var(--muted)" }}>
            {fmtPrice(obj.cost_total)}{diff(normalTot) ? ` (${fmtPrice(normalTot)})` : ""} · fabrication et accessoires</p>}>
          <FRow l="Fabrication" v={fmtPrice(obj.cost_fabrication)} d={`${fmtPrice(normalFab)} au prix normal`}/>
          <FRow l="Accessoires" v={fmtPrice(obj.cost_accessory)} vc="#0d9488"/>
          <FRow l="Total" v={`${fmtPrice(obj.cost_total)} (${fmtPrice(normalTot)})`} d="réel (au prix normal)"/>
          {obj.desired_price > 0 && <FRow l="Prix désiré" v={fmtPrice(obj.desired_price)} vc="#d97706"/>}
          {isSold && <FRow l="Vendu" vc="#16a34a" v={fmtPrice(obj.sold_price)}
            d={obj.cost_total > 0 ? `${((obj.sold_price / obj.cost_total - 1) * 100).toFixed(0)} % au-dessus du coût` : null}/>}
          {isSold && obj.sold_date && <FRow l="Date de vente" v={dayFr(String(obj.sold_date).slice(0, 10))}/>}
        </FCard>
      </div>
    </FSheet>

    {selling && <QuickSell obj={obj} onClose={() => setSelling(false)}
      onDone={async () => { setSelling(false); try { const r = await client.get(`/objects/objects/${obj.id}`); onUpdated?.(r.data); } catch { onUpdated?.(); } }}/>}

      {/* Picker accessoire — recherche filtrée, vignette, quantité bornee au stock */}
      {addingAcc && (
        <AccessoryPicker accessories={allAccs} onClose={()=>setAddingAcc(false)} onConfirm={linkAcc}/>
      )}

      {viewAcc && (
        <AccessorySheet accId={viewAcc} onClose={()=>setViewAcc(null)}
          onChanged={()=>client.get(`/objects/objects/${obj.id}/accessories`).then(r=>setAccessories(r.data)).catch(()=>{})}/>
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
        <div data-no-pull="" style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:300,
          display:"flex", alignItems:"flex-end", justifyContent:"center" }}
          onClick={()=>!deleting && setConfirmDel(false)}>
          <div onClick={e=>e.stopPropagation()} className="sheet-panel"
            style={{ width:"100%", maxWidth:520, borderTopLeftRadius:20, borderTopRightRadius:20,
              padding:"20px 20px 24px", maxHeight:"80vh", overflowY:"auto" }}>
            <h3 style={{ margin:"0 0 4px", fontSize:17, fontWeight:900, color:"var(--text)" }}>
              🗑 Supprimer « {obj.name} » ?
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
                style={{ flex:1, padding:"11px", borderRadius:12, fontSize:13, fontWeight:800,
                  cursor:"pointer", border:"none", background:"linear-gradient(135deg, #EF4444, #F97316)", color:"white",
                  boxShadow:"0 8px 18px -10px #EF4444" }}>
                {deleting ? "Suppression…" : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
  </>);
}

// Un etat = un libelle et une couleur, definis une seule fois et partages par
// la tuile, la fiche et les filtres. Les tuiles ne sont plus grisees : le statut
// est deja porte par la section (sold/gifted/perso/unavailable) et par le badge
// de couleur sur la tuile -- le grise en plus n'apportait rien et alourdissait.
export const OBJ_STATUS = {
  // "short" sert aux comptes ("3 vendus") ; certains libelles sont invariables
  // en nombre, d'ou le drapeau plutot qu'un s ajoute aveuglement.
  available:   { label:"À vendre",     short:"à vendre",     plural:false, color:"#3b82f6", dim:false, icon:"🏷️" },
  sold:        { label:"Vendu",        short:"vendu",        plural:true,  color:"#22c55e", dim:true,  icon:"✅" },
  gifted:      { label:"Offert",       short:"offert",       plural:true,  color:"#f59e0b", dim:true,  icon:"🎁" },
  personal:    { label:"Perso",        short:"perso",        plural:false, color:"#a855f7", dim:true,  icon:"🏠" },
  unavailable: { label:"Indisponible", short:"indisponible", plural:true,  color:"#94a3b8", dim:true,  icon:"⛔" },
};
// Repli pour les objets anterieurs a la colonne status, si la reprise n'a pas
// encore tourne : on rededuit plutot que d'afficher un etat vide.
export const objStatus = (o) =>
  o.status && OBJ_STATUS[o.status] ? o.status
  : (o.sold_price > 0 ? "sold" : o.personal ? "personal"
     : o.available === false ? "unavailable" : "available");

/**
 * Section repliable regroupant les objets d'un meme etat.
 *
 * L'en-tete resume ce qu'elle contient meme fermee -- nombre, et le montant
 * qui a du sens pour CET etat -- pour qu'on n'ait pas a deplier chaque
 * section pour savoir si elle merite un regard. Le montant pertinent n'est
 * pas le meme partout : ce qu'on espere pour les objets a vendre, ce qu'on a
 * encaisse pour les vendus, ce que ca a coute pour tout le reste.
 */
function StatusSection({ sec, open, onToggle, children }) {
  const cfg = OBJ_STATUS[sec.st];
  const resume =
    sec.st === "sold"      ? `${fmtPrice(sec.revenue)} encaissés`
    : sec.st === "available" ? (sec.desired > 0 ? `${fmtPrice(sec.desired)} espérés`
                                                : `${fmtPrice(sec.cost)} de production`)
    : `${fmtPrice(sec.cost)} de production`;
  return <FoldSection color={cfg.color} icon={cfg.icon} title={cfg.label} count={sec.count}
    sub={`${sec.count} objet${sec.count>1?"s":""} · ${resume}`} thumbs={sec.thumbs} open={open} onToggle={onToggle}>{children}</FoldSection>;
}

// Une section repliable de la page (etats d'objets, regroupements d'accessoires) : une carte teintee de sa couleur,
// son icone, son resume et, repliee, un apercu de ce qu'elle contient.
function FoldSection({ color, icon, title, muted = false, count, sub, alert = null, thumbs = [], open, onToggle, children }) {
  const ref = React.useRef(null);
  // Accordeon : a l'ouverture, ramener le haut de la section sous le header fixe.
  // Sinon, quand une grande section au-dessus vient de se replier, on reste
  // visuellement "dans le vide" au lieu d'etre en haut de la section ouverte.
  React.useEffect(() => {
    if (open && ref.current) ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);
  return (
    <div ref={ref} className={open ? "fold-open" : undefined} style={{ borderRadius:20, overflow:"hidden", border:`1px solid color-mix(in srgb, ${color} 32%, var(--border))`,
      background:`radial-gradient(90% 120% at 0% 0%, color-mix(in srgb, ${color} 16%, transparent), transparent 60%), var(--surface2)`,
      boxShadow: open ? `0 10px 26px -18px ${color}` : "none",
      scrollMarginTop:"calc(64px + var(--sat, env(safe-area-inset-top, 0px)))" }}>
      <button onClick={onToggle}
        style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"12px 14px", border:"none", background:"none",
          cursor:"pointer", textAlign:"left", color:"inherit", font:"inherit" }}>
        <span style={{ width:40, height:40, borderRadius:13, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:19,
          background:`linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 60%, #ffffff))`, boxShadow:`0 6px 14px -6px ${color}` }}>{icon}</span>
        <span style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:2 }}>
          <span style={{ fontSize:15, fontWeight:900, color: muted ? "var(--muted)" : "var(--text)" }}>{title}</span>
          <span style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {sub}{alert && <span style={{ color:"#ef4444", fontWeight:800 }}>{" · "}{alert}</span>}</span>
        </span>
        {/* repliee : les premieres vignettes, pour savoir ce qu'il y a dedans sans ouvrir */}
        {!open && thumbs.length > 0 && <span aria-hidden="true" style={{ display:"flex", flexShrink:0 }}>
          {thumbs.slice(0, 3).map((u, i) => <img key={u} src={u} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
            style={{ width:30, height:30, borderRadius:9, objectFit:"cover", marginLeft: i ? -10 : 0, border:"2px solid var(--surface2)",
              background:"var(--surface)", boxShadow:"0 2px 6px rgba(0,0,0,.25)" }}/>)}</span>}
        <span style={{ fontSize:12, fontWeight:900, minWidth:26, textAlign:"center", padding:"3px 9px", borderRadius:20, flexShrink:0, color:"#fff",
          background:`linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 65%, #ffffff))` }}>{count}</span>
        <span style={{ color:"var(--muted)", fontSize:11, flexShrink:0, transform: open ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span>
      </button>
      {open && (
        <div style={{ padding:"2px 10px 12px", display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Section repliable d'accessoires, par regroupement.
 *
 * Meme principe que les sections d'objets, mais le decoupage vient d'un champ
 * libre et non d'une liste fermee : il n'y a donc pas d'ordre naturel a
 * respecter, d'ou l'alphabetique. Le resume porte l'information qu'on cherche
 * sur un stock -- combien d'unites, combien ca vaut, combien sont a zero.
 */
// Teinte stable deduite du NOM du regroupement : le meme nom donne toujours
// la meme couleur, d'une session a l'autre et d'un appareil a l'autre, sans
// rien stocker ni demander a l'utilisateur. Un bleu unique pour toutes les
// sections ne distinguait rien -- c'etait un decor, pas un repere.
//
// Saturation et clarte fixes : seule la teinte varie, donc toutes les couleurs
// se valent en intensite et aucune section ne crie plus fort qu'une autre.
function hueFromName(name) {
  // FNV-1a puis angle d'or. Un simple modulo 360 sur une somme ponderee
  // donnait des teintes voisines pour des noms voisins -- "Ressorts" et
  // "Roulements" tombaient a 9 degres l'un de l'autre, donc identiques a
  // l'oeil. Le melange FNV casse cette correlation, et l'angle d'or ecarte
  // au maximum les valeurs consecutives.
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.round((((h >>> 0) % 1000) * 137.508) % 360);
}
// en hexadecimal (meme teinte que hsl(h 62% 56%)) : la page y colle une transparence (« #rrggbb1f »)
const hslHex = (h, s, l) => {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, "0");
  return `#${f(0)}${f(8)}${f(4)}`;
};
const sectionColor = (name) =>
  name ? hslHex(hueFromName(name), 0.62, 0.56) : "#94a3b8";

function AccessorySection({ sec, open, onToggle, children }) {
  return <FoldSection color={sectionColor(sec.name)} icon={sec.name ? "🔩" : "📦"} title={sec.name || "Sans regroupement"} muted={!sec.name}
    count={sec.count} sub={`${sec.units} unité${sec.units>1?"s":""} · ${fmtPrice(sec.value)}`}
    alert={sec.out > 0 ? `${sec.out} en rupture` : null} thumbs={sec.thumbs} open={open} onToggle={onToggle}>{children}</FoldSection>;
}

// Ajoute une SELECTION d'objets a un groupe (existant ou nouveau).
// Selecteur de groupe facon prints : un champ de recherche filtre les groupes
// existants et propose de creer celui qu'on tape. onPick recoit {group_id} ou
// {group_name} (nouveau). Le parent gere l'action (rattachement, etc.).
function ObjectGroupPickerSheet({ title, onClose, onPick }) {
  useTrackDetail("Objets · Choisir un groupe");
  const kb = useKeyboardInset();
  const [q, setQ] = React.useState("");
  const [groups, setGroups] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    client.get("/objects/object-groups").then(r => setGroups(r.data || [])).catch(() => {});
  }, []);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? groups.filter(g => (g.name || "").toLowerCase().includes(needle)) : groups;
  const exact = needle && groups.some(g => (g.name || "").toLowerCase() === needle);
  const pick = async (payload) => {
    if (busy) return;
    setBusy(true);
    try { await onPick(payload); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); setBusy(false); }
  };
  return (
    <FSheet onClose={onClose} z={6000}>
      <div style={{ padding:"52px 18px 14px", background:"radial-gradient(circle at 15% 40%, rgba(139,92,246,0.32), transparent 60%), var(--surface2)" }}>
        <div style={{ fontSize:12, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"#8B5CF6" }}>📁 Groupe d'objets</div>
        <div style={{ fontSize:20, fontWeight:900, color:"var(--text)", lineHeight:1.2 }}>{title}</div>
      </div>
      <div style={{ padding:"12px 16px 18px", paddingBottom: 18 + kb, display:"flex", flexDirection:"column", gap:8 }}>
        <input value={q} onChange={e => setQ(e.target.value)} autoFocus
          placeholder="Rechercher ou créer un groupe…"
          style={{ ...fInp, borderRadius:20, height:42 }}/>
        {needle && (
          <button disabled={busy} onClick={() => pick({ group_name: q.trim() })}
            style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"11px 12px", borderRadius:14, border:"none",
              background:"linear-gradient(135deg, #8B5CF6, #A78BFA)", color:"#fff", fontSize:13.5, fontWeight:800,
              cursor:"pointer", textAlign:"left", opacity: busy ? 0.6 : 1, boxShadow:"0 8px 18px -10px #8B5CF6" }}>
            <Plus size={16}/> Créer un nouveau groupe « {q.trim()} »
          </button>
        )}
        {exact && (
          <p style={{ ...fNote, padding:"0 2px" }}>
            Un groupe porte déjà ce nom — tu peux le rejoindre ci-dessous.
          </p>
        )}
        {filtered.length === 0 && !needle && (
          <p style={{ ...fNote, textAlign:"center", padding:"16px 0" }}>
            Aucun groupe — tape un nom pour en créer un.
          </p>
        )}
        {filtered.map(g => (
          <button key={g.id} disabled={busy} onClick={() => pick({ group_id: g.id })}
            style={{ width:"100%", padding:"11px 14px", textAlign:"left", background:"linear-gradient(135deg, rgba(139,92,246,0.12), transparent 70%), var(--surface)",
              border:"1px solid color-mix(in srgb, #8B5CF6 30%, var(--border))", borderRadius:14, cursor:"pointer", color:"var(--text)",
              fontSize:13.5, display:"flex", alignItems:"center", gap:10, opacity: busy ? 0.6 : 1 }}>
            <span style={{ fontSize:16, flexShrink:0 }}>📁</span>
            <span style={{ flex:1, minWidth:0, fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{g.name}</span>
            {g.desired_price > 0 && <span style={{ fontSize:12, fontWeight:800, color:"var(--muted)" }}>{fmtPrice(g.desired_price)}</span>}
          </button>
        ))}
      </div>
    </FSheet>
  );
}

function ObjectCard({ obj, onClick, onLongPress, selectMode, selected, onToggleSelect }) {
  const st = objStatus(obj);
  const cfg = OBJ_STATUS[st];
  // Appui long / clic droit : menu (ouvrir, selectionner).
  const [press, guard] = useLongPress(e => openMenu(e, {
    title: obj.name || "Objet", subtitle: cfg?.label || null,
    items: [
      onClick && { icon: "📄", label: "Ouvrir", onClick },
      onLongPress && { icon: "☑", label: "Sélectionner", hint: "Pour ajouter plusieurs objets à un groupe", onClick: onLongPress },
    ],
  }), { disabled: selectMode });
  const handleClick = guard(() => {
    if (selectMode) { onToggleSelect && onToggleSelect(obj.id); return; }
    onClick && onClick();
  });
  const [imgOk, setImgOk] = useState(true);
  const c = cfg.color;
  // le prix qui compte pour cet etat : encaisse si vendu, vise sinon
  const price = st === "sold" ? obj.sold_price : obj.desired_price;
  const margin = st === "sold" && obj.sold_price > 0 ? obj.sold_price - (obj.cost_total || 0) : null;
  const nAcc = (obj.accessories || []).length;
  return (
    <div className="card" onClick={handleClick} {...press}
      style={{ WebkitTouchCallout:"none", userSelect:"none", padding:0, overflow:"hidden", cursor:"pointer", position:"relative",
        borderRadius:18, display:"flex", flexDirection:"column", border:`1px solid color-mix(in srgb, ${c} 30%, var(--border))`,
        background:`linear-gradient(170deg, color-mix(in srgb, ${c} 9%, transparent), transparent 55%), var(--surface2)`,
        boxShadow:`0 8px 22px -16px ${c}`, outline: selected ? "2px solid #3b82f6" : "none", outlineOffset:-2 }}>
      {selectMode && <SelDot on={selected}/>}
      <div style={{ position:"relative", aspectRatio:"1 / 0.85", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden",
        background:`radial-gradient(75% 70% at 50% 45%, color-mix(in srgb, ${c} 20%, transparent), transparent 75%), var(--surface)` }}>
        {imgOk ? <img src={apiThumb(apiUrl(`/objects/objects/${obj.id}/image`), 384)} alt="" loading="lazy" decoding="async"
            style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={() => setImgOk(false)}/>
          : <span style={{ fontSize:40, opacity:.55 }}>{cfg.icon}</span>}
        <span style={{ ...pill, position:"absolute", top:7, left:7, color:"#fff",
          background:`linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 65%, #ffffff))` }}>{cfg.label}</span>
        {price > 0 && !selectMode && <span style={{ ...glassPill, position:"absolute", top:7, right:7,
          fontFamily:"'JetBrains Mono',ui-monospace,monospace" }}>{fmtPrice(price)}</span>}
        {nAcc > 0 && <span data-tip={`${nAcc} accessoire${nAcc > 1 ? "s" : ""}`} style={{ ...glassPill, position:"absolute", bottom:7, left:7 }}>🔩 {nAcc}</span>}
      </div>
      <div style={{ padding:"8px 10px 10px", display:"flex", flexDirection:"column", gap:3 }}>
        <p style={cardName}>{obj.translated_name || obj.name}</p>
        <span data-tip="Coût de revient : réel (au prix normal du filament)" style={{ fontSize:11, fontWeight:700, color:"var(--muted)",
          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>Coût {costLine(obj)}</span>
        {margin != null && !isMoneyHidden() && <span style={{ fontSize:11.5, fontWeight:900, ...fGrad(margin >= 0 ? "#16a34a" : "#ef4444", margin >= 0 ? "#4ade80" : "#f87171") }}>
          {margin >= 0 ? "+" : ""}{fmtPrice(margin)} de marge</span>}
      </div>
    </div>
  );
}

// ── Object Group Sheet ────────────────────────────────────────────────────
// Actions EN MASSE sur un groupe : statut / prix desire a tous les membres, et
// accessoires ajoutes/retires a tout le groupe (stock = qty x nb de membres).
function GroupBulkPanel({ group, memberCount, onChanged }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [price, setPrice] = React.useState(group.desired_price > 0 ? String(group.desired_price) : "");
  const [allAccs, setAllAccs] = React.useState([]);
  const [groupAccs, setGroupAccs] = React.useState([]);
  const [pickAcc, setPickAcc] = React.useState(false);

  const base = `/objects/object-groups/${group.id}`;
  const reloadAccs = () => client.get(`${base}/accessories`).then(r => setGroupAccs(r.data || [])).catch(() => {});
  React.useEffect(() => {
    if (!open) return;
    client.get("/objects/accessories").then(r => setAllAccs(r.data || [])).catch(() => {});
    reloadAccs();
  }, [open]);

  const run = async (fn, okMsg) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); onChanged?.(); setMsg(typeof okMsg === "function" ? okMsg(r) : okMsg); }
    catch (e) {
      const d = e.response?.data?.detail;
      const text = Array.isArray(d) ? (d[0]?.msg || "Requête invalide")
        : (typeof d === "string" ? d : (e.message || "Erreur"));
      setMsg("⚠ " + text);
    }
    setBusy(false);
  };
  const applyStatus = (st) => run(() => client.patch(`${base}/members`, { status: st }),
    `Statut appliqué aux ${memberCount} objets.`);
  const applyPrice = () => run(() => client.patch(`${base}/members`,
    price.trim() === "" ? { clear_desired_price: true } : { desired_price: parseFloat(price) }),
    "Prix désiré appliqué au groupe.");
  const addAcc = (aId, qty) => run(async () => {
    const r = await client.post(`${base}/accessories`, { accessory_id: Number(aId), qty_per_object: Number(qty) });
    reloadAccs(); return r;
  }, (r) => `${r.data.total_deducted} unité(s) retirée(s) du stock.`);
  const removeAcc = (aid) => run(async () => {
    const r = await client.delete(`${base}/accessories/${aid}`); reloadAccs(); return r;
  }, (r) => `${r.data.restocked} unité(s) rendue(s) au stock.`);

  const chip = (active) => ({ padding:"8px 12px", borderRadius:12, fontSize:12.5, fontWeight:800,
    cursor: busy ? "default" : "pointer", border: active ? "none" : "1px solid var(--border)",
    background: active ? "linear-gradient(135deg, #8B5CF6, #A78BFA)" : "var(--surface)", color: active ? "#fff" : "var(--text2)", opacity: busy ? 0.6 : 1 });
  const lbl = { ...fLbl, margin:"0 0 6px" };

  const STATUSES = ["available","gifted","personal","unavailable"];

  return (
    <FCard t={`Actions sur tout le groupe (${memberCount})`} i="⚡" c="#8B5CF6" fold open={open} onToggle={() => setOpen(o => !o)}
      summary={<p style={{ margin:"4px 0 0", fontSize:12.5, fontWeight:700, color:"var(--muted)" }}>État, prix désiré et accessoires de tous les objets</p>}>
        <div style={{ paddingTop:8, display:"flex", flexDirection:"column", gap:16 }}>
          {msg && <p style={{ fontSize:12.5, fontWeight:800, color: msg.startsWith("⚠") ? "#ef4444" : "#16a34a", margin:0 }}>{msg}</p>}

          {/* Statut */}
          <div>
            <p style={lbl}>Statut de tous les objets</p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {STATUSES.map(st => { const c = OBJ_STATUS[st];
                return <button key={st} disabled={busy} onClick={() => applyStatus(st)}
                  style={{ ...chip(false), color:c.color, borderColor:`color-mix(in srgb, ${c.color} 40%, var(--border))` }}>{c.icon} {c.label}</button>; })}
            </div>
            <p style={{ ...fNote, marginTop:6 }}>« Vendu » reste objet par objet (chacun son prix).</p>
          </div>

          {/* Prix desire */}
          <div>
            <p style={lbl}>Prix désiré de tous les objets</p>
            <div style={{ display:"flex", gap:8 }}>
              <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)}
                placeholder="Vider pour effacer" style={{ ...fInp, flex:1, minWidth:0 }}/>
              <button disabled={busy} onClick={applyPrice} style={chip(true)}>Appliquer</button>
            </div>
          </div>

          {/* Ajouter un accessoire a tout le groupe */}
          <div>
            <p style={lbl}>Ajouter un accessoire à tout le groupe</p>
            <button disabled={busy} onClick={() => setPickAcc(true)}
              style={{ ...chip(false), color:"#0d9488", borderColor:"rgba(20,184,166,0.4)" }}>🔩 Choisir un accessoire</button>
            <p style={{ ...fNote, marginTop:6 }}>
              La quantité choisie est appliquée à chacun des {memberCount} objets (stock déduit × {memberCount}).
            </p>
            {pickAcc && (
              <AccessoryPicker accessories={allAccs} multiplier={memberCount}
                onClose={() => setPickAcc(false)}
                onConfirm={(aId, qty) => { setPickAcc(false); addAcc(aId, qty); }}/>
            )}
          </div>

          {/* Accessoires deja poses sur le groupe */}
          {groupAccs.length > 0 && (
            <div>
              <p style={lbl}>Accessoires du groupe</p>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {groupAccs.map(a => (
                  <div key={a.accessory_id} style={{ display:"flex", alignItems:"center", gap:10,
                    background:"var(--surface)", border:"1px solid var(--border)", borderRadius:12, padding:"8px 10px" }}>
                    <AccThumb id={a.accessory_id} size={30}/>
                    <span style={{ flex:1, fontSize:13, fontWeight:800, color:"var(--text)", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {a.name} <span style={{ color:"var(--muted)", fontWeight:700 }}>· {a.total_qty} sur {a.objects} objet{a.objects > 1 ? "s" : ""}</span>
                    </span>
                    <button disabled={busy} onClick={() => removeAcc(a.accessory_id)}
                      style={{ ...chip(false), flexShrink:0, padding:"5px 10px", color:"#ef4444", borderColor:"rgba(239,68,68,0.35)" }}>Retirer</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
    </FCard>
  );
}

function ObjectGroupSheet({ group, objects, allObjects, sectionStatus, onClose, onSelectObj, onChanged }) {
  useTrackDetail("Objets · Fiche groupe d'objets");
  // Ouverte depuis une section, la feuille montre d'abord les objets de CETTE
  // section -- c'est ce qu'on venait consulter. Mais on veut souvent verifier
  // le lot entier dans la foulee, d'ou la bascule plutot qu'une fermeture et
  // une reouverture depuis une autre section.
  const [showAll, setShowAll] = useState(false);
  const full = allObjects || objects;
  const canToggle = !!sectionStatus && full.length > objects.length;
  const shown = showAll ? full : objects;
  const cfg = sectionStatus ? OBJ_STATUS[sectionStatus] : null;

  const totalCost = shown.reduce((s,o) => s+(o.cost_total||0), 0);
  const soldCount = shown.filter(o => o.sold_price > 0).length;
  const shownSold = shown.filter(o => o.sold_price > 0);
  const revenue = shownSold.reduce((a, o) => a + (o.sold_price || 0), 0);
  return (
    <FSheet onClose={onClose} z={200}>
      {/* le groupe en vedette : la mosaique de ses objets sur un fond lavande */}
      <div style={{ position:"relative", overflow:"hidden", padding:"52px 18px 18px", display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
        background:"radial-gradient(circle at 18% 45%, rgba(139,92,246,0.4), transparent 60%), linear-gradient(135deg, rgba(167,139,250,0.18), transparent 70%), var(--surface2)" }}>
        <div style={{ width:124, height:124, borderRadius:22, overflow:"hidden", flexShrink:0, background:"var(--surface)",
          boxShadow:"0 12px 28px -12px #8B5CF6", border:"1px solid rgba(255,255,255,.12)" }}>
          <GroupMosaic photos={shown.map(o => ({ url: apiUrl(`/objects/objects/${o.id}/image`), tint:"#A78BFA" }))} title={group.name}/>
        </div>
        <div style={{ flex:"1 1 190px", minWidth:0, display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {fChip(`📁 ${shown.length} objet${shown.length!==1?"s":""}`, "#8B5CF6")}
            {cfg && !showAll && fChip(`${cfg.icon} ${cfg.label}`, cfg.color)}
            {soldCount > 0 && fChip(`✅ ${soldCount} vendu${soldCount>1?"s":""}`, "#22c55e")}
          </div>
          <div style={{ fontSize:24, fontWeight:900, lineHeight:1.15, overflowWrap:"anywhere", ...fGrad("#8B5CF6", "#C084FC") }}>{group.name}</div>
          <div style={{ fontSize:13, fontWeight:800, color:"var(--muted)" }}>
            Coût {fmtPrice(totalCost)}{revenue > 0 ? ` · ${fmtPrice(revenue)} encaissés` : ""}</div>
          {group.desired_price > 0 && <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
            <span style={{ fontSize:24, fontWeight:900, lineHeight:1.2, ...fGrad("#16a34a", "#4ade80") }}>{fmtPrice(group.desired_price)}</span>
            <span style={{ fontSize:12.5, fontWeight:800, color:"var(--muted)" }}>prix souhaité</span></div>}
          {canToggle && (
            <button onClick={()=>setShowAll(v=>!v)}
              style={{ alignSelf:"flex-start", padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:800, cursor:"pointer",
                border:"1px solid " + (showAll ? "var(--border)" : (cfg?.color || "var(--border)")),
                background: showAll ? "var(--surface)" : (cfg ? cfg.color+"1f" : "transparent"),
                color: showAll ? "var(--muted)" : (cfg?.color || "var(--muted)") }}>
              {showAll
                ? `Voir seulement : ${cfg.label.toLowerCase()} (${objects.length})`
                : `Voir tout le groupe (${full.length})`}
            </button>
          )}
        </div>
      </div>
      <div style={{ padding:"14px 14px 18px", display:"flex", flexDirection:"column", gap:12 }}>
        <AdminOnly><GroupBulkPanel group={group} memberCount={full.length} onChanged={onChanged}/></AdminOnly>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
          {shown.map(o => <ObjectCard key={o.id} obj={o} onClick={() => { onClose(); onSelectObj(o); }}/>)}
        </div>
      </div>
    </FSheet>
  );
}

// ── Object Group Tile ─────────────────────────────────────────────────────
function ObjectGroupTile({ group, objects, sectionStatus, totalCount, onChanged }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  // Dans une section d'etat, la tuile ne montre QUE les objets concernes : le
  // compte affiche est donc celui de la section, pas celui du groupe entier.
  const cfg = sectionStatus ? OBJ_STATUS[sectionStatus] : null;
  const partial = totalCount != null && totalCount > objects.length;
  const cost = objects.reduce((a, o) => a + (o.cost_total || 0), 0);
  return (<>
    <div className="card" onClick={() => setOpen(true)}
      style={{ padding:0, overflow:"hidden", cursor:"pointer", position:"relative", borderRadius:18, display:"flex", flexDirection:"column",
        border:"1px solid color-mix(in srgb, #A78BFA 35%, var(--border))",
        background:"linear-gradient(170deg, rgba(167,139,250,0.14), transparent 55%), var(--surface2)", boxShadow:"0 8px 22px -14px rgba(124,58,237,.7)" }}>
      <div style={{ position:"relative", aspectRatio:"1 / 0.85", overflow:"hidden", background:"var(--surface)" }}>
        <div style={{ position:"absolute", inset:0 }}>
          <GroupMosaic photos={objects.map(o => ({ url: apiUrl(`/objects/objects/${o.id}/image`), tint: "#A78BFA" }))} title={group.name}/>
        </div>
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg, rgba(124,58,237,0.12), transparent 45%)", pointerEvents:"none" }}/>
        <span style={{ ...pill, position:"absolute", top:7, left:7, color:"#fff", background:"linear-gradient(135deg, #8B5CF6, #A78BFA)" }}>
          {/* "3 / 7" quand le groupe deborde de la section : on voit d'un coup
              qu'il en existe d'autres ailleurs, sans avoir a l'ouvrir. */}
          📁 {objects.length}{partial ? ` / ${totalCount}` : ""}
        </span>
        {group.desired_price > 0 && <span style={{ ...glassPill, position:"absolute", top:7, right:7,
          fontFamily:"'JetBrains Mono',ui-monospace,monospace" }}>{fmtPrice(group.desired_price)}</span>}
        {cfg && <span style={{ ...pill, position:"absolute", bottom:7, left:7, color:"#fff",
          background:`linear-gradient(135deg, ${cfg.color}, color-mix(in srgb, ${cfg.color} 65%, #ffffff))` }}>
          {objects.length} {cfg.short}{cfg.plural && objects.length > 1 ? "s" : ""}
        </span>}
      </div>
      <div style={{ padding:"8px 10px 10px", display:"flex", flexDirection:"column", gap:3 }}>
        <p style={{ ...cardName, ...fGrad("#8B5CF6", "#C084FC") }}>📁 {group.name}</p>
        <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)" }}>Coût {fmtPrice(cost)}</span>
      </div>
    </div>
    {open && <ObjectGroupSheet group={group} objects={objects}
      allObjects={group.items} sectionStatus={sectionStatus} onClose={() => setOpen(false)}
      onSelectObj={o => setSelected(o)} onChanged={onChanged}/>}
    {selected && <ObjectSheet obj={selected} onClose={() => setSelected(null)}
      onUpdated={(updated) => { if (updated) setSelected(updated); }}/>}
  </>);
}

// ── Main ──────────────────────────────────────────────────────────────────
const KPI_ICONS = { "à vendre":"🏷️", espéré:"🎯", encaissé:"💶", marge:"📈", articles:"🔩", unités:"📦", valeur:"💶", rupture:"⚠" };
export default function Objects() {
  const [tab, setTab] = useUrlTab("tab", "objects", ["objects", "accessories"]);
  useTrackDetail(`Objets · ${tab === "accessories" ? "Accessoires" : "Objets"}`);
  const [q, setQ] = useState("");
  const [objects, setObjects] = useState([]);
  const [accessories, setAccessories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedAcc, setSelectedAcc] = useState(null);   // fiche accessoire
  // ?id=… (depuis l'accueil) : la fiche de cet objet s'ouvre directement
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    client.get(`/objects/objects/${id}`).then(r => setSelected(r.data)).catch(() => {});
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const [creatingAcc, setCreatingAcc] = useState(false);  // creation accessoire
  // Plus de filtre par etat : les sections repliables le font, et mieux --
  // elles montrent les cinq etats a la fois avec leurs comptes, la ou une
  // pastille en isolait un seul. Surtout, filtrer cote serveur privait les
  // en-tetes des donnees necessaires a leurs resumes.

  // « Chargement… » seulement quand il n'y a encore rien a montrer : un rechargement apres une action se fait en
  // place (28/10/2026 : la grille entiere disparaissait a chaque vente, lien d'accessoire ou edition). La recherche
  // filtre la liste deja en memoire (elle est complete, 500 au plus) : plus un appel serveur par frappe.
  const nObj = useRef(0), nAcc = useRef(0);
  nObj.current = objects.length; nAcc.current = accessories.length;
  const loadObjects = useCallback(async () => {
    if (!nObj.current) setLoading(true);
    try {
      const { data } = await client.get("/objects/objects", { params: { limit: 500 } });
      setObjects(data.items || []);
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }, []);

  const loadAccessories = useCallback(async () => {
    if (!nAcc.current) setLoading(true);
    try {
      const { data } = await client.get("/objects/accessories");
      setAccessories(data || []);
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === "objects") loadObjects(); else loadAccessories();
  }, [tab, loadObjects, loadAccessories]);
  const qn = q.trim().toLowerCase();
  const seen = useMemo(() => !qn ? objects : objects.filter(o => `${o.translated_name || ""} ${o.name || ""}`.toLowerCase().includes(qn)), [objects, qn]);
  const seenAcc = useMemo(() => !qn ? accessories : accessories.filter(a => (a.name || "").toLowerCase().includes(qn)), [accessories, qn]);

  // Séparer objets groupés vs solo — comme les prints (memoise : refait seulement quand la liste ou la recherche change)
  const { grouped, solo } = useMemo(() => {
    const grouped = {}, solo = [];
    for (const o of seen) {
      if (o.group_id) { (grouped[o.group_id] = grouped[o.group_id] || { id: o.group_id, name: o.group_name, desired_price: o.desired_price ?? null, items: [] }).items.push(o); }
      else solo.push(o);
    }
    return { grouped, solo };
  }, [seen]);
  // Items pour la grille : groupes d'abord puis solos — comme galerie prints
  const [openSections, setOpenSections] = React.useState({});
  const [openAccSections, setOpenAccSections] = React.useState({});
  const [accSel, setAccSel] = React.useState(null);   // null = pas en selection
  const [objSel, setObjSel] = React.useState(null);   // selection multiple d'objets
  const [bulkGroup, setBulkGroup] = React.useState(false);
  const objSelCount = objSel ? objSel.size : 0;
  const toggleObjSel = (id) => setObjSel(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const [objSort, setObjSort] = React.useState("name");

  // Le tri s'applique A L'INTERIEUR de chaque section, jamais entre elles :
  // l'ordre des etats est porteur de sens -- ce sur quoi on peut agir d'abord --
  // et le laisser bousculer par un tri l'aurait efface.
  const OBJ_SORTS = [
    ["name",    "Nom (A→Z)"],
    ["recent",  "Plus récents"],
    ["cost",    "Coût décroissant"],
    ["value",   "Valeur décroissante"],
  ];
  const objLabel = (it) => (it.kind === "group"
    ? (it.group.name || "") : (it.obj.translated_name || it.obj.name || ""));
  const objCost = (it) => (it.kind === "group"
    ? it.objects.reduce((a, o) => a + (o.cost_total || 0), 0) : (it.obj.cost_total || 0));
  // "Valeur" = ce que la ligne represente en euros : le prix encaisse si elle
  // est vendue, le prix vise sinon. Deux colonnes distinctes n'auraient servi
  // a rien puisqu'un objet ne peut pas etre dans les deux etats.
  const objValue = (it) => {
    const arr = it.kind === "group" ? it.objects : [it.obj];
    return arr.reduce((a, o) => a + (o.sold_price || o.desired_price || 0), 0);
  };
  const objId = (it) => (it.kind === "group"
    ? Math.max(...it.objects.map(o => o.id || 0)) : (it.obj.id || 0));

  const sortItems = (arr) => {
    const c = [...arr];
    if (objSort === "recent") c.sort((a, b) => objId(b) - objId(a));
    else if (objSort === "cost")  c.sort((a, b) => objCost(b) - objCost(a));
    else if (objSort === "value") c.sort((a, b) => objValue(b) - objValue(a));
    else c.sort((a, b) => OBJ_COLLATOR.compare(objLabel(a), objLabel(b)));
    return c;
  };
  const [bulkCat, setBulkCat] = React.useState(false);
  const selCount = accSel ? accSel.size : 0;

  // Sections d'accessoires, deduites du regroupement saisi sur chaque fiche.
  // Alphabetique, et les non classes en DERNIER : ce sont ceux a ranger, pas
  // ceux a consulter, et les remonter en tete aurait mis le desordre devant.
  const accSections = React.useMemo(() => {
    const by = new Map();
    for (const a of seenAcc) {
      const k = (a.category || "").trim() || null;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(a);
    }
    const named = [...by.entries()].filter(([k]) => k)
      .sort((x, y) => x[0].localeCompare(y[0]));
    const none = by.get(null);
    const all = none ? [...named, [null, none]] : named;
    return all.map(([name, items]) => ({
      name,
      items,
      count: items.length,
      units: items.reduce((a, x) => a + (x.quantity || 0), 0),
      value: items.reduce((a, x) => a + (x.quantity || 0) * (x.unit_price || 0), 0),
      out: items.filter(x => (x.quantity || 0) === 0).length,
      thumbs: items.filter(x => x.has_image).sort((x, y) => y.id - x.id).map(x => apiThumb(apiUrl(`/objects/accessories/${x.id}/image`), 128)),
    }));
  }, [accessories]);
  const accKpis = React.useMemo(() => [
    { label:"articles", value:String(accessories.length), accent:"#14B8A6" },
    { label:"unités", value:String(accessories.reduce((a, x) => a + (x.quantity || 0), 0)), accent:"#06B6D4" },
    { label:"valeur", value: fmtKpi(accessories.reduce((a, x) => a + (x.quantity || 0) * (x.unit_price || 0), 0)), accent:"#22c55e" },
    { label:"rupture", value:String(accessories.filter(x => !(x.quantity > 0)).length),
      accent: accessories.some(x => !(x.quantity > 0)) ? "#ef4444" : "#94a3b8" },
  ], [accessories]);

  const gridItems = useMemo(() => [
    ...Object.entries(grouped).map(([gid, g]) => ({ kind:"group", group_id:Number(gid), group:g, objects:g.items })),
    ...solo.map(o => ({ kind:"object", obj:o })),
  ], [grouped, solo]);

  // Ordre volontaire : ce sur quoi on peut agir en premier, l'archive en
  // dernier. "A vendre" ouvre la page parce que c'est la seule section qui
  // appelle une decision ; les autres consignent ce qui est deja arrive.
  const SECTION_ORDER = ["available", "sold", "gifted", "personal", "unavailable"];

  // Un groupe apparait dans CHAQUE etat ou il compte au moins un membre, avec
  // uniquement les objets concernes. Un lot de 7 dont 3 vendus se montre donc
  // dans "Vendus" avec ses 3, et dans "A vendre" avec ses 4 : le forcer dans
  // une seule section aurait cache la moitie de son contenu, et le scinder en
  // objets isoles aurait defait le regroupement.
  const sections = useMemo(() => SECTION_ORDER.map(st => {
    const items = [];
    for (const it of gridItems) {
      if (it.kind === "object") {
        if (objStatus(it.obj) === st) items.push(it);
      } else {
        const part = it.objects.filter(o => objStatus(o) === st);
        if (part.length) items.push({ ...it, objects: part, sectionStatus: st });
      }
    }
    if (!items.length) return null;
    const objs = items.flatMap(it => it.kind === "object" ? [it.obj] : it.objects);
    items.splice(0, items.length, ...sortItems(items));
    const cost = objs.reduce((a, o) => a + (o.cost_total || 0), 0);
    const revenue = objs.reduce((a, o) => a + (o.sold_price || 0), 0);
    const desired = objs.reduce((a, o) => a + (o.desired_price || 0), 0);
    // l'apercu montre les plus recents : les derniers vendus (date de vente), sinon les derniers crees
    const recent = [...objs].sort((x, y) => st === "sold" && (x.sold_date || y.sold_date)
      ? String(y.sold_date || "").localeCompare(String(x.sold_date || "")) || (y.id - x.id) : (y.id - x.id));
    // l'en-tete n'en montre que trois : pas la peine de fabriquer une adresse par objet
    const thumbs = recent.slice(0, 3).map(o => apiThumb(apiUrl(`/objects/objects/${o.id}/image`), 128));
    return { st, items, count: objs.length, cost, revenue, desired, thumbs };
  }).filter(Boolean), [gridItems, objSort]);   // eslint-disable-line react-hooks/exhaustive-deps
  // les chiffres de l'onglet Objets : ce qui attend une vente, ce qu'on en espere, ce qu'on a encaisse et gagne
  const objKpis = React.useMemo(() => {
    const av = objects.filter(o => objStatus(o) === "available"), sold = objects.filter(o => objStatus(o) === "sold");
    const rev = sold.reduce((a, o) => a + (o.sold_price || 0), 0), cost = sold.reduce((a, o) => a + (o.cost_total || 0), 0);
    return [{ label:"à vendre", value:String(av.length), accent:"#3b82f6" },
      { label:"espéré", value: fmtKpi(av.reduce((a, o) => a + (o.desired_price || 0), 0)), accent:"#8B5CF6" },
      { label:"encaissé", value: fmtKpi(rev), accent:"#22c55e" },
      { label:"marge", value: isMoneyHidden() ? MONEY_MASK : `${rev - cost >= 0 ? "+" : ""}${fmtKpi(rev - cost)}`, accent: rev - cost >= 0 ? "#16a34a" : "#ef4444" }];
  }, [objects]);

  return (
    <div className="page-wide" style={{ "--page-max":"900px", gap:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Objets & Accessoires</h1>
      </div>

      {/* Onglets Objets / Accessoires — chacun sa couleur, comme Filaments et Impressions. */}
      <PageTabs tab={tab} setTab={id => { setTab(id); setQ(""); }}
        tabs={[{ id:"objects", label:"Objets", ic:"🎁", c:"#8B5CF6" }, { id:"accessories", label:"Accessoires", ic:"🔩", c:"#14B8A6" }]}/>

      {/* Les chiffres de l'onglet, en tuiles */}
      {tab === "objects" ? <KpiBar kpis={objKpis} icons={KPI_ICONS}/> : <KpiBar kpis={accKpis} icons={KPI_ICONS}/>}

      {/* Recherche en pilule ; le tri des objets dans le bouton rond (il s'applique DANS chaque section : l'ordre
          des etats reste celui qu'on a voulu). L'ajout d'un accessoire se range avec les outils du contenu. */}
      <SearchRow q={q} setQ={setQ} placeholder={tab === "objects" ? "Rechercher un objet…" : "Rechercher un accessoire…"}
        active={tab === "objects" && objSort !== "name" ? 1 : 0} filterTip="Trier"
        onFilter={tab === "objects" ? (e => openMenu(e, { title:"Trier les objets", subtitle:"dans chaque section", color:"#8B5CF6",
          items: OBJ_SORTS.map(([v, l]) => ({ icon: objSort === v ? "✓" : "↕", label: l, tone: objSort === v ? "#8B5CF6" : undefined,
            onClick: () => setObjSort(v) })) })) : null}
        addLabel={tab === "accessories" ? "Accessoire" : null} onAdd={() => setCreatingAcc(true)}/>

      {loading ? <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>Chargement…</p>
      : tab === "objects" ? (
        gridItems.length === 0
          ? <EmptyCard icon="🎁" text={q ? "Aucun objet ne correspond" : "Aucun objet : crée-en un depuis la fiche d'une impression"}/>
          : <div className="fold-grid">
              {sections.map(sec => (
                /* Toutes fermees au depart : l'en-tete porte deja le compte et
                   le montant, donc la page se lit d'un coup d'oeil et on ne
                   deplie que ce qu'on veut voir. Ouvrir une section par defaut
                   repoussait les autres hors de l'ecran. */
                <StatusSection key={sec.st} sec={sec}
                  open={openSections[sec.st] ?? false}
                  onToggle={() => setOpenSections(o =>
                    o[sec.st] ? {} : { [sec.st]: true })}>
                  {sec.items.map(item => item.kind === "group"
                    ? <ObjectGroupTile key={`g${item.group_id}-${sec.st}`} group={item.group}
                        objects={item.objects} sectionStatus={sec.st}
                        totalCount={item.group.items?.length} onChanged={loadObjects}/>
                    : <ObjectCard key={item.obj.id} obj={item.obj}
                        onClick={() => setSelected(item.obj)}
                        selectMode={!!objSel}
                        selected={!!objSel && objSel.has(item.obj.id)}
                        onToggleSelect={toggleObjSel}
                        onLongPress={() => setObjSel(new Set([item.obj.id]))}/>
                  )}
                </StatusSection>
              ))}
            </div>
      ) : (
        accessories.length === 0
          ? <EmptyCard icon="🔩" text={q ? "Aucun accessoire ne correspond" : "Aucun accessoire : ajoute le premier avec « + Accessoire »"}/>
          : <div className="fold-grid">
              {accSections.map(sec => (
                <AccessorySection key={sec.name || "_none"} sec={sec}
                  open={openAccSections[sec.name || "_none"] ?? false}
                  onToggle={() => setOpenAccSections(o => {
                    const k = sec.name || "_none";
                    return o[k] ? {} : { [k]: true };
                  })}>
                  {sec.items.map(a => (
                    <AccessoryCard key={a.id} acc={a} selectMode={!!accSel}
                      selected={accSel?.has(a.id)}
                      onLongPress={() => setAccSel(new Set([a.id]))}
                      onClick={() => {
                        if (!accSel) { setSelectedAcc(a.id); return; }
                        setAccSel(prev => {
                          const n = new Set(prev);
                          n.has(a.id) ? n.delete(a.id) : n.add(a.id);
                          return n;
                        });
                      }}/>
                  ))}
                </AccessorySection>
              ))}
            </div>
      )}

      {selected && <ObjectSheet obj={selected} onClose={() => setSelected(null)}
        onUpdated={(updated) => { if (updated) setSelected(updated); loadObjects(); }}/>}

      {tab === "objects" && objSelCount > 0 && (
        <div style={{ position:"fixed", bottom:"calc(76px + env(safe-area-inset-bottom,0px))",
          left:12, right:12, zIndex:500, background:"var(--sheet-bg)", border:"1px solid var(--border)",
          borderRadius:14, padding:10, display:"flex", flexDirection:"column", gap:8,
          boxShadow:"0 4px 24px rgba(0,0,0,0.35)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ flex:1, minWidth:0, fontSize:12.5, fontWeight:700, color:"var(--text)",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {objSelCount} sélectionné{objSelCount>1?"s":""}
            </span>
            <button onClick={()=>setObjSel(null)}
              style={{ flexShrink:0, padding:"5px 12px", borderRadius:8, fontSize:12, background:"none",
                border:"1px solid var(--border)", color:"var(--muted)", cursor:"pointer" }}>Annuler</button>
          </div>
          <button onClick={()=>setBulkGroup(true)}
            style={{ width:"100%", padding:"11px", borderRadius:12, border:"none", background:"linear-gradient(135deg, #8B5CF6, #A78BFA)",
              color:"white", fontSize:13, fontWeight:800, cursor:"pointer", boxShadow:"0 8px 18px -10px #8B5CF6" }}>
            Ajouter ces {objSelCount} objet{objSelCount>1?"s":""} à un groupe
          </button>
        </div>
      )}

      {bulkGroup && (
        <ObjectGroupPickerSheet
          title={`Ajouter ${objSelCount} objet${objSelCount>1?"s":""} à un groupe`}
          onClose={()=>setBulkGroup(false)}
          onPick={async ({ group_id, group_name }) => {
            let gid = group_id;
            if (!gid && group_name) { const r = await client.post("/objects/object-groups", { name: group_name }); gid = r.data?.id; }
            if (gid) await client.post(`/objects/object-groups/${gid}/add-members`, { object_ids: [...objSel] });
            setBulkGroup(false); setObjSel(null); loadObjects();
          }}/>
      )}

      {selCount > 0 && (
        /* Deux rangees, comme la barre de selection des prints : quatre
           elements cote a cote debordent sur telephone. */
        <div style={{ position:"fixed", bottom:"calc(76px + env(safe-area-inset-bottom,0px))",
          left:12, right:12, zIndex:500, background:"var(--sheet-bg)",
          border:"1px solid var(--border)", borderRadius:14, padding:10,
          display:"flex", flexDirection:"column", gap:8,
          boxShadow:"0 4px 24px rgba(0,0,0,0.35)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ flex:1, minWidth:0, fontSize:12.5, fontWeight:700,
              color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis",
              whiteSpace:"nowrap" }}>
              {selCount} sélectionné{selCount>1?"s":""}
            </span>
            <button onClick={()=>setAccSel(null)}
              style={{ flexShrink:0, padding:"5px 12px", borderRadius:8, fontSize:12,
                background:"none", border:"1px solid var(--border)",
                color:"var(--muted)", cursor:"pointer" }}>Annuler</button>
          </div>
          <button onClick={()=>setBulkCat(true)}
            style={{ width:"100%", padding:"11px", borderRadius:12, border:"none",
              background:"linear-gradient(135deg, #14B8A6, #2DD4BF)", color:"white", fontSize:13, fontWeight:800,
              cursor:"pointer", boxShadow:"0 8px 18px -10px #14B8A6" }}>
            Regrouper ces {selCount} accessoire{selCount>1?"s":""}
          </button>
        </div>
      )}

      {bulkCat && (
        <BulkCategorySheet ids={[...accSel]}
          onClose={()=>setBulkCat(false)}
          onDone={()=>{ setBulkCat(false); setAccSel(null); loadAccessories(); }}/>
      )}

      {selectedAcc && (
        <AccessorySheet accId={selectedAcc} onClose={()=>setSelectedAcc(null)}
          onChanged={loadAccessories}/>
      )}
      {creatingAcc && (
        <AccessoryCreateSheet onClose={()=>setCreatingAcc(false)}
          onCreated={(id)=>{ setCreatingAcc(false); loadAccessories(); if (id) setSelectedAcc(id); }}/>
      )}
      <HiddenMark egg="lost_key" e="🗝️" side="left"/>
      <Cachettes spot="objects"/>
    </div>
  );
}
