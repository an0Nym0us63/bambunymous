import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import MwImg from "./MwImg";
import AdminOnly from "./AdminOnly";
import MakerWorldModelSheet, { prefetchModel } from "./MakerWorldModelSheet";
import { colorBg, parseColorsList } from "../utils/colors";
import { moneyVal } from "../utils/money";

// Impressions → File : les modeles de mes collections « a imprimer », avec le
// profil et les filaments retenus (depuis la fiche du modele : « 📌 Retenir
// pour la file »), les besoins additionnes par filament et ce qui est
// imprimable tout de suite avec l'AMS ou avec le stock.
const fmtDur = s => { if (!s) return "—"; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`; };
const g = v => `${Math.round(v || 0).toLocaleString("fr-FR")} g`;
const STATUS = {
  ams: ["✅ Prêt (AMS)", "#22c55e", "Tous les filaments choisis sont chargés dans l'AMS, en quantité suffisante."],
  stock: ["🟡 Stock OK", "#f59e0b", "Assez en stock, mais pas tout dans l'AMS : à charger avant."],
  short: ["🔴 Manque", "#ef4444", "Un filament manque ou n'a pas d'équivalent en stock."],
  unknown: ["— Inconnu", "var(--muted)", "Fiche ou profil illisible."],
};
const FILTERS = [["all", "Tous"], ["ams", "Prêts (AMS)"], ["stock", "Stock OK"], ["short", "Manque"]];

export default function MwQueue() {
  const [q, setQ] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [filter, setFilter] = useState("all");
  const [model, setModel] = useState(null);
  const [showFil, setShowFil] = useState(true);

  useEffect(() => {
    let alive = true;
    setErr(null);
    client.get("/makerworld/queue", { params: reload ? { fresh: 1 } : {} })
      .then(({ data }) => alive && setQ(data))
      .catch(e => alive && setErr(e.response?.data?.detail || e.message))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [reload]);

  const refresh = () => { setBusy(true); setReload(n => n + 1); };
  // Nombre d'exemplaires : affiche tout de suite, totaux recalcules par le serveur.
  const setQty = async (did, n) => {
    setQ(x => ({ ...x, models: x.models.map(r => r.design_id === did ? { ...r, qty: n } : r) }));
    try { await client.put(`/makerworld/queue/qty/${did}`, { qty: n }); refresh(); } catch { refresh(); }
  };
  if (err) return <p style={msg}>{err}</p>;
  if (!q) return <p style={msg}>Lecture de la file… (la première fois, chaque fiche est lue sur MakerWorld)</p>;
  const t = q.totals;
  const rows = q.models.filter(r => filter === "all" || r.status === filter);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12, paddingBottom:16 }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
        <span style={{ fontSize:12, color:"var(--muted)" }}>Collections :</span>
        {q.collections.length ? q.collections.map(c => (
          <span key={c.id} style={{ fontSize:11.5, fontWeight:700, padding:"3px 9px", borderRadius:20,
            background:"rgba(59,130,246,0.12)", color:"#3b82f6" }}>📁 {c.title}</span>
        )) : <span style={{ fontSize:12, color:"#f59e0b" }}>aucune choisie</span>}
        <AdminOnly><button onClick={() => setPick(true)} style={btn}>⚙ Choisir</button></AdminOnly>
        <button onClick={refresh} disabled={busy} title="Relire maintenant" style={{ ...btn, marginLeft:"auto" }}>
          {busy ? <span className="mw-spin" style={{ width:12, height:12 }}/> : "⟳"}</button>
      </div>

      {q.collections.length === 0 ? (
        <p style={msg}>Choisis une ou plusieurs collections MakerWorld (par exemple « À imprimer ») : leurs modèles forment la file.</p>
      ) : (<>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(104px,1fr))", gap:8 }}>
          {[[t.models, "modèles"], [fmtDur(t.seconds), "temps total"], [g(t.weight_g), "filament"],
            [t.cost ? `${moneyVal(t.cost, 2)} €` : "—", "coût estimé"], [t.ams, "prêts (AMS)", "#22c55e"],
            [t.stock, "stock OK", "#f59e0b"], [t.short, "à compléter", "#ef4444"], [t.printed, "déjà imprimés"]].map(([v, l, c]) => (
            <div key={l} style={card}>
              <div style={{ fontSize:15, fontWeight:800, color: c || "var(--text)" }}>{v}</div>
              <div style={{ fontSize:10.5, color:"var(--muted)" }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Filaments pour tout imprimer */}
        <div className="card" style={{ padding:"10px 12px" }}>
          <button onClick={() => setShowFil(v => !v)} style={{ display:"flex", width:"100%", alignItems:"center", background:"none",
            border:"none", padding:0, cursor:"pointer", color:"var(--text)" }}>
            <span style={{ flex:1, textAlign:"left", fontSize:13, fontWeight:800 }}>🧵 Filaments pour tout imprimer</span>
            <span style={{ fontSize:12, color:"var(--muted)" }}>{showFil ? "▴" : "▾"}</span>
          </button>
          {showFil && (<>
            {q.filaments.map(f => (
              <div key={f.filament_id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderTop:"1px solid var(--border)" }}>
                <Swatch f={f}/>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"block", fontSize:12, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                  <span style={{ display:"block", fontSize:10.5, color:"var(--muted)" }}>
                    {[f.brand, f.material, `${f.models} modèle${f.models > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}
                    {f.ams_g ? ` · AMS ${g(f.ams_g)}` : ""}</span>
                </span>
                <span style={{ textAlign:"right", flexShrink:0, fontSize:11.5 }}>
                  <span style={{ display:"block", fontWeight:800 }}>{g(f.need_g)} / {g(f.stock_g)}</span>
                  <span style={{ display:"block", fontSize:10.5, fontWeight:700, color: f.missing_g ? "#ef4444" : "#22c55e" }}>
                    {f.missing_g ? `manque ${g(f.missing_g)}` : `reste ${g(f.stock_g - f.need_g)}`}</span>
                </span>
              </div>
            ))}
            {q.unmatched.map(u => (
              <div key={u.type + u.color} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderTop:"1px solid var(--border)" }}>
                <span style={{ width:18, height:18, borderRadius:"50%", background:u.color, border:"1px solid rgba(128,128,128,0.45)", flexShrink:0 }}/>
                <span style={{ flex:1, fontSize:12, color:"#ef4444", fontWeight:700 }}>Aucun {u.type} de cette couleur en stock</span>
                <span style={{ fontSize:11.5, fontWeight:800 }}>{g(u.need_g)}</span>
              </div>
            ))}
          </>)}
        </div>

        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {FILTERS.map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={pill(filter === k)}>
              {l} ({k === "all" ? t.models : t[k] ?? 0})</button>
          ))}
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {rows.map(r => {
            const [label, color, help] = STATUS[r.status] || STATUS.unknown;
            return (
              <div key={r.design_id} role="button" tabIndex={0}
                onClick={() => setModel({ design_id: r.design_id, title: r.title, title_fr: r.title_fr, cover_url: r.cover_url })}
                onPointerDown={() => prefetchModel(r.design_id)}
                style={{ display:"flex", alignItems:"center", gap:10, padding:8, borderRadius:12, cursor:"pointer", textAlign:"left",
                  background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}>
                {r.cover_url ? <MwImg src={r.cover_url} w={110} style={{ width:54, height:54, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
                  : <span style={{ width:54, height:54, borderRadius:8, background:"var(--surface)", flexShrink:0 }}/>}
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"block", fontSize:12.5, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {r.planned && <span title="Profil et filaments retenus">📌 </span>}{r.title_fr || r.title || `Modèle ${r.design_id}`}</span>
                  <span style={{ display:"block", fontSize:10.5, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {r.profile ? `${r.profile.title || "Profil"}${r.profile.plates < r.profile.plates_total ? ` · ${r.profile.plates}/${r.profile.plates_total} plateaux` : ""}` : "profil inconnu"}
                    {" · "}{fmtDur(r.seconds)} · {g(r.weight_g)}{r.cost != null ? ` · ${moneyVal(r.cost, 2)} €` : ""}{r.printed ? ` · imprimé ${r.printed}×` : ""}</span>
                  <span style={{ display:"flex", gap:3, marginTop:4, flexWrap:"wrap" }}>
                    {r.filaments.map((f, i) => (
                      <span key={i} title={`${f.type} ${Math.round(f.g)} g → ${f.chosen ? f.chosen.name + (f.chosen.in_ams ? " (AMS)" : "") : "rien en stock"}`}
                        style={{ width:14, height:14, borderRadius:"50%", flexShrink:0,
                          ...(f.chosen ? colorBg(parseColorsList(f.chosen.color, f.chosen.colors_array), f.chosen.multicolor_type) : { background:f.color }),
                          border: !f.chosen ? "2px solid #ef4444" : f.chosen.enough_ams ? "2px solid #22c55e"
                            : f.chosen.enough_stock ? "2px solid #f59e0b" : "2px solid #ef4444" }}/>
                    ))}
                  </span>
                </span>
                <span style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5, flexShrink:0 }}>
                  <span title={help} style={{ fontSize:10.5, fontWeight:800, color, whiteSpace:"nowrap" }}>{label}</span>
                  <Qty value={r.qty || 1} onChange={n => setQty(r.design_id, n)}/>
                </span>
              </div>
            );
          })}
        </div>
        <p style={{ fontSize:11, color:"var(--muted)", margin:0, lineHeight:1.5 }}>
          Ouvre un modèle, déplie son profil, choisis plateaux et filaments, puis « 📌 Retenir pour la file ». Sans
          cela, la file prend le profil retenu, tous les plateaux et le filament le plus proche de ton stock.
          Pastilles : vert = dans l'AMS, orange = en stock, rouge = manque.</p>
      </>)}

      {pick && <CollectionsPicker chosen={q.collections.map(c => c.id)} onClose={() => setPick(false)}
        onSaved={() => { setPick(false); refresh(); }}/>}
      {model && <MakerWorldModelSheet designId={model.design_id} preview={model}
        onClose={() => { setModel(null); refresh(); }}/>}
    </div>
  );
}

// ‒ N + (ne declenche pas l'ouverture de la fiche).
function Qty({ value, onChange }) {
  const b = { width:24, height:24, borderRadius:7, border:"1px solid var(--border)", background:"var(--surface)",
    color:"var(--text)", fontSize:14, fontWeight:800, cursor:"pointer", lineHeight:1, padding:0 };
  return (
    <AdminOnly fallback={value > 1 ? <span style={{ fontSize:11.5, fontWeight:800 }}>×{value}</span> : null}>
      <span onClick={e => e.stopPropagation()} style={{ display:"flex", alignItems:"center", gap:4 }}>
        <button onClick={() => value > 1 && onChange(value - 1)} disabled={value <= 1} aria-label="Un de moins" style={b}>‒</button>
        <span style={{ minWidth:22, textAlign:"center", fontSize:12, fontWeight:800 }}>×{value}</span>
        <button onClick={() => value < 99 && onChange(value + 1)} aria-label="Un de plus" style={b}>+</button>
      </span>
    </AdminOnly>
  );
}

function CollectionsPicker({ chosen, onClose, onSaved }) {
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(new Set(chosen));
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.get("/makerworld/collections").then(({ data }) => setList(data.collections || [])).catch(() => setList([])); }, []);
  const save = async () => {
    setBusy(true);
    try { await client.put("/makerworld/queue/collections", { ids: [...sel] }); onSaved(); } catch { setBusy(false); }
  };
  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4000, background:"rgba(0,0,0,0.55)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", width:"100%",
        maxWidth:520, maxHeight:"75dvh", display:"flex", flexDirection:"column", paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        <h3 style={{ margin:0, padding:"14px 16px 6px", fontSize:15, fontWeight:800, color:"var(--text)" }}>Collections de la file</h3>
        <p style={{ margin:0, padding:"0 16px 8px", fontSize:12, color:"var(--muted)" }}>Leurs modèles forment la file (sans doublon).</p>
        <div style={{ flex:1, overflowY:"auto", padding:"0 8px" }}>
          {list === null ? <p style={msg}>…</p> : list.map(c => (
            <label key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 8px", cursor:"pointer", fontSize:13, color:"var(--text)" }}>
              <input type="checkbox" checked={sel.has(c.id)} onChange={() => setSel(s => { const x = new Set(s); x.has(c.id) ? x.delete(c.id) : x.add(c.id); return x; })}/>
              <span style={{ flex:1 }}>{c.title}</span>
              {c.count != null && <span style={{ fontSize:11, color:"var(--muted)" }}>{c.count}</span>}
            </label>
          ))}
        </div>
        <div style={{ display:"flex", gap:8, padding:"10px 16px", borderTop:"1px solid var(--border)" }}>
          <button onClick={onClose} style={{ ...btn, flex:1 }}>Annuler</button>
          <button onClick={save} disabled={busy} style={{ ...btn, flex:2, background:"#3b82f6", color:"white", border:"none" }}>
            {busy ? "…" : `Utiliser ${sel.size} collection${sel.size > 1 ? "s" : ""}`}</button>
        </div>
      </div>
    </div>, document.body);
}

function Swatch({ f }) {
  return <span style={{ width:18, height:18, borderRadius:"50%", flexShrink:0, border:"1px solid rgba(128,128,128,0.45)",
    ...colorBg(parseColorsList(f.color, f.colors_array), f.multicolor_type) }}/>;
}

const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
const btn = { padding:"6px 11px", borderRadius:9, fontSize:12, fontWeight:700, cursor:"pointer",
  background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" };
const card = { padding:"8px 10px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" };
const pill = on => ({ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer",
  background: on ? "rgba(59,130,246,0.15)" : "var(--surface2)", color: on ? "#3b82f6" : "var(--text2)",
  border: on ? "1px solid #3b82f6" : "1px solid var(--border)" });
