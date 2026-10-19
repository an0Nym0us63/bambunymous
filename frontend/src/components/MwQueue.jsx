import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import MwImg from "./MwImg";
import AdminOnly from "./AdminOnly";
import { Pressable } from "./ContextMenu";
import { useIsAdmin } from "../store/auth";
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
  partial: ["🟩 En partie", "#16a34a", "Une partie est faisable tout de suite avec l'AMS (plateaux ou exemplaires)."],
  short: ["🔴 Manque", "#ef4444", "Un filament manque ou n'a pas d'équivalent en stock."],
  unknown: ["— Inconnu", "var(--muted)", "Fiche ou profil illisible."],
};
const FILTERS = [["all", "Tous"], ["ams", "Prêts (AMS)"], ["partial", "En partie"], ["stock", "Stock OK"], ["short", "Manque"]];

// Libelle d'etat precis : plateaux ou exemplaires faisables avec l'AMS.
function statusText(r) {
  if (r.status !== "partial") return (STATUS[r.status] || STATUS.unknown)[0];
  const bits = [];
  if (r.plates_count > 1 && r.plates_ready?.length) bits.push(`${r.plates_ready.length}/${r.plates_count} plateaux`);
  if ((r.qty || 1) > 1 && r.copies_ready > 0) bits.push(`${r.copies_ready}/${r.qty} ex.`);
  return `🟩 ${bits.join(" · ") || "en partie"} prêt${bits.length ? "s" : ""}`;
}

export default function MwQueue() {
  const [q, setQ] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [filter, setFilter] = useState("all");
  const [model, setModel] = useState(null);
  const [tab, setTab] = useState("models");        // models | filaments
  const [sorting, setSorting] = useState(false);   // mode « Réorganiser »
  // « Jusqu'ici » : les stats ne portent que sur le debut de la file (garde dans ce navigateur).
  const [until, setUntilState] = useState(() => { try { return localStorage.getItem("mwQueueUntil") || null; } catch { return null; } });
  const [cutting, setCutting] = useState(false);
  const isAdmin = useIsAdmin();
  const fresh = useRef(false);
  const setUntil = v => {
    setUntilState(v);
    try { v ? localStorage.setItem("mwQueueUntil", v) : localStorage.removeItem("mwQueueUntil"); } catch { /* stockage indisponible */ }
  };

  useEffect(() => {
    let alive = true;
    setErr(null);
    const params = {};
    if (fresh.current) params.fresh = 1;
    if (until) params.until = until;
    fresh.current = false;
    client.get("/makerworld/queue", { params })
      .then(({ data }) => {
        if (!alive) return;
        setQ(data);
        if (until && !data.until) setUntil(null);    // modele sorti de la file : on revient au tout
      })
      .catch(e => alive && setErr(e.response?.data?.detail || e.message))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [reload, until]);

  const refresh = () => { fresh.current = true; setBusy(true); setReload(n => n + 1); };
  // Nombre d'exemplaires : affiche tout de suite, totaux recalcules par le serveur.
  const setQty = async (did, n) => {
    setQ(x => ({ ...x, models: x.models.map(r => r.design_id === did ? { ...r, qty: n } : r) }));
    try { await client.put(`/makerworld/queue/qty/${did}`, { qty: n }); refresh(); } catch { refresh(); }
  };
  // Ordre de priorite : deplace, enregistre l'ordre complet (les nouveaux y entrent).
  const move = async (did, to) => {
    const ids = q.models.map(r => r.design_id);
    const i = ids.indexOf(did);
    const j = to === "top" ? 0 : to === "bottom" ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, i + to));
    if (i < 0 || i === j) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    const byId = Object.fromEntries(q.models.map(r => [r.design_id, r]));
    setQ(x => ({ ...x, models: ids.map(d => ({ ...byId[d], new: false })) }));
    try { await client.put("/makerworld/queue/order", { ids }); } catch { refresh(); }
  };
  const forget = async did => {
    try { await client.delete(`/makerworld/queue/plan/${did}`); } finally { refresh(); }
  };
  // Menu de la ligne (appui long / clic droit).
  const rowMenu = r => {
    const i = q.models.findIndex(x => x.design_id === r.design_id);
    const last = q.models.length - 1;
    const isCut = q.until?.design_id === r.design_id;
    const open = () => setModel({ design_id: r.design_id, title: r.title, title_fr: r.title_fr, cover_url: r.cover_url });
    return {
      title: r.title_fr || r.title || `Modèle ${r.design_id}`,
      subtitle: statusText(r),
      items: [
        { icon: "📄", label: "Ouvrir la fiche", onClick: open },
        { icon: "🌐", label: "Voir sur MakerWorld", onClick: () => window.open(`https://makerworld.com/fr/models/${r.design_id}`, "_blank", "noopener") },
        "-",
        isCut ? { icon: "↺", label: "Revenir à toute la liste", onClick: () => setUntil(null) }
          : { icon: "✂", label: "Compter jusqu'ici", hint: `Stats sur les ${i + 1} premier${i ? "s" : ""}`, onClick: () => setUntil(r.design_id) },
        isAdmin && "-",
        isAdmin && i > 0 && { icon: "⤒", label: "Mettre en tête", onClick: () => move(r.design_id, "top") },
        isAdmin && i > 0 && { icon: "↑", label: "Monter d'un cran", onClick: () => move(r.design_id, -1) },
        isAdmin && i < last && { icon: "↓", label: "Descendre d'un cran", onClick: () => move(r.design_id, 1) },
        isAdmin && i < last && { icon: "⤓", label: "Mettre en bas", onClick: () => move(r.design_id, "bottom") },
        isAdmin && { icon: "↕", label: "Réorganiser toute la liste", onClick: () => { setCutting(false); setSorting(true); } },
        isAdmin && "-",
        isAdmin && { icon: "＋", label: `Un exemplaire de plus (×${(r.qty || 1) + 1})`, onClick: () => setQty(r.design_id, Math.min(99, (r.qty || 1) + 1)) },
        isAdmin && (r.qty || 1) > 1 && { icon: "－", label: `Un de moins (×${r.qty - 1})`, onClick: () => setQty(r.design_id, r.qty - 1) },
        isAdmin && r.planned && { icon: "📌", label: "Oublier le plan retenu", hint: "Revient au profil et aux filaments par défaut", danger: true, onClick: () => forget(r.design_id) },
      ],
    };
  };
  if (err) return <p style={msg}>{err}</p>;
  if (!q) return <p style={msg}>Lecture de la liste… (la première fois, chaque fiche est lue sur MakerWorld)</p>;
  const t = q.totals;
  const rows = q.models.filter(r => sorting || cutting || filter === "all" || r.status === filter);
  const cutAt = q.until ? q.models.findIndex(r => r.design_id === q.until.design_id) : -1;
  const pos = Object.fromEntries(q.models.map((r, i) => [r.design_id, i]));
  const cutRow = cutAt >= 0 ? q.models[cutAt] : null;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12, paddingBottom: cutting || cutRow ? 80 : 16 }}>
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
        <p style={msg}>Choisis une ou plusieurs collections MakerWorld (par exemple « À faire ») : leurs modèles forment la liste « À faire ».</p>
      ) : (<>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(104px,1fr))", gap:8 }}>
          {[[t.models, "modèles"], [fmtDur(t.seconds), "temps total"], [g(t.weight_g), "filament"],
            [t.cost ? `${moneyVal(t.cost, 2)} €` : "—", "coût estimé"], [t.ams, "prêts (AMS)", "#22c55e"],
            [t.partial ?? 0, "en partie (AMS)", "#16a34a"], [t.stock, "stock OK", "#f59e0b"], [t.short, "à compléter", "#ef4444"], [t.printed, "déjà imprimés"]].map(([v, l, c]) => (
            <div key={l} style={card}>
              <div style={{ fontSize:15, fontWeight:800, color: c || "var(--text)" }}>{v}</div>
              <div style={{ fontSize:10.5, color:"var(--muted)" }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:12, padding:4, border:"1px solid var(--border)" }}>
          {[["models", `Modèles (${t.models})`], ["filaments", "🧵 Filaments pour tout imprimer"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ flex:1, padding:"7px 8px", borderRadius:8, fontSize:12, fontWeight:700,
              cursor:"pointer", border:"none", background: tab === k ? "#3b82f6" : "transparent", color: tab === k ? "white" : "var(--muted)" }}>{l}</button>
          ))}
        </div>

        {tab === "filaments" && (
        <div className="card" style={{ padding:"4px 12px 10px" }}>
          {(<>
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
          {q.filaments.length === 0 && q.unmatched.length === 0 && <p style={msg}>Aucun filament à prévoir.</p>}
        </div>
        )}

        {tab === "models" && (<>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {!sorting && !cutting && FILTERS.map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={pill(filter === k)}>
              {l} ({k === "all" ? t.models : t[k] ?? 0})</button>
          ))}
          {sorting && <span style={{ fontSize:12, color:"var(--muted)" }}>Ordre de priorité : ⤒ en haut, ↑ ↓, ⤓ en bas.</span>}
          {!sorting && <button onClick={() => setCutting(v => !v)} title="Stats limitées aux premiers modèles de la liste"
            style={{ ...pill(cutting || !!cutRow), marginLeft:"auto" }}>✂ Jusqu'ici</button>}
          <AdminOnly><button onClick={() => { setSorting(v => !v); setCutting(false); }} style={{ ...pill(sorting), marginLeft: sorting ? "auto" : 0 }}>
            {sorting ? "✓ Terminé" : "↕ Réorganiser"}</button></AdminOnly>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {rows.map(r => {
            const [label, color, help] = STATUS[r.status] || STATUS.unknown;
            const out = cutAt >= 0 && pos[r.design_id] > cutAt;
            return (
              <React.Fragment key={r.design_id}>
              <Pressable role="button" tabIndex={0} menu={sorting || cutting ? null : () => rowMenu(r)}
                onClick={() => cutting ? (setUntil(r.design_id), setCutting(false))
                  : setModel({ design_id: r.design_id, title: r.title, title_fr: r.title_fr, cover_url: r.cover_url })}
                onPointerDown={() => prefetchModel(r.design_id)}
                style={{ display:"flex", alignItems:"center", gap:10, padding:8, borderRadius:12, cursor:"pointer", textAlign:"left",
                  background:"var(--surface2)", color:"var(--text)", opacity: out ? 0.45 : 1,
                  border: cutting ? "1px dashed #3b82f6" : r.printing ? "1.5px solid #3b82f6" : "1px solid var(--border)" }}>
                {r.cover_url ? <MwImg src={r.cover_url} w={110} style={{ width:54, height:54, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
                  : <span style={{ width:54, height:54, borderRadius:8, background:"var(--surface)", flexShrink:0 }}/>}
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"block", fontSize:12.5, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {r.title_fr || r.title || `Modèle ${r.design_id}`}</span>
                  <span style={{ display:"flex", gap:4, flexWrap:"wrap", margin:"2px 0 1px" }}>
                    {r.printing && <span title="En cours d'impression" style={{ ...tag, color:"white", background:"#3b82f6" }}>
                      🖨️ En cours{r.progress != null ? ` · ${r.progress} %` : ""}{r.remaining_min ? ` · ${fmtDur(r.remaining_min * 60)}` : ""}</span>}
                    {r.new && <span style={{ ...tag, color:"#3b82f6", background:"rgba(59,130,246,0.12)" }}>Nouveau</span>}
                    {r.planned
                      ? <span title="Profil, plateaux et filaments retenus depuis la fiche" style={{ ...tag, color:"#16a34a", background:"rgba(34,197,94,0.12)" }}>📌 Retenu</span>
                      : <span title="Profil retenu par l'appli, tous les plateaux, filament le plus proche du stock" style={{ ...tag, color:"var(--muted)", background:"var(--surface)", border:"1px dashed var(--border)" }}>Par défaut</span>}
                  </span>
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
                  {/* Tout ce qui dit « faisable ou non » se lit ici, a droite. */}
                  <span style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2 }}>
                    <span title={help} style={{ fontSize:10.5, fontWeight:800, color, whiteSpace:"nowrap" }}>{statusText(r)}</span>
                    {r.status === "partial" && (r.stock_ok
                      ? <span title="Le reste (autres plateaux ou exemplaires) est faisable avec le stock, à charger dans l'AMS" style={{ ...tag, color:"#f59e0b", background:"rgba(245,158,11,0.12)", whiteSpace:"nowrap" }}>reste : stock OK</span>
                      : <span title="Pour le reste, un filament manque en stock" style={{ ...tag, color:"#ef4444", background:"rgba(239,68,68,0.12)", whiteSpace:"nowrap" }}>reste : manque</span>)}
                  </span>
                  {sorting ? (
                    <span onClick={e => e.stopPropagation()} style={{ display:"flex", gap:3 }}>
                      {[["top", "⤒", "En haut"], [-1, "↑", "Monter"], [1, "↓", "Descendre"], ["bottom", "⤓", "En bas"]].map(([to, ic, l]) => (
                        <button key={l} onClick={() => move(r.design_id, to)} aria-label={l} title={l} style={mv}>{ic}</button>
                      ))}
                    </span>
                  ) : <Qty value={r.qty || 1} onChange={n => setQty(r.design_id, n)}/>}
                </span>
              </Pressable>
              {!cutting && pos[r.design_id] === cutAt && cutAt < q.models.length - 1 && (
                <div style={{ display:"flex", alignItems:"center", gap:8, color:"#3b82f6", fontSize:11, fontWeight:800 }}>
                  <span style={{ flex:1, borderTop:"2px dashed #3b82f6" }}/>✂ jusqu'ici<span style={{ flex:1, borderTop:"2px dashed #3b82f6" }}/>
                </div>
              )}
              </React.Fragment>
            );
          })}
        </div>
        <p style={{ fontSize:11, color:"var(--muted)", margin:0, lineHeight:1.5 }}>
          Ouvre un modèle, déplie son profil, choisis plateaux et filaments, puis « 📌 Retenir pour « À faire » ». Sans
          cela, la liste prend le profil retenu, tous les plateaux et le filament le plus proche de ton stock.
          Pastilles : vert = dans l'AMS, orange = en stock, rouge = manque. Un modèle arrivé dans la liste sans place
          définie se met en haut (« Nouveau »).</p>
        </>)}
      </>)}

      {(cutting || cutRow) && (
        <div style={{ position:"fixed", bottom:"calc(76px + env(safe-area-inset-bottom,0px))", left:12, right:12, zIndex:500,
          maxWidth:560, margin:"0 auto", display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:14,
          background:"var(--sheet-bg)", border:"1px solid #3b82f6", boxShadow:"0 8px 24px rgba(0,0,0,0.3)" }}>
          <span style={{ fontSize:18 }}>✂</span>
          <span style={{ flex:1, minWidth:0, fontSize:12.5, lineHeight:1.35 }}>
            {cutting ? <b>Touche le dernier modèle à compter</b> : (<>
              <b>{q.until.count} élément{q.until.count > 1 ? "s" : ""}</b> jusqu'à « <span style={{ fontWeight:700 }}>
                {cutRow.title_fr || cutRow.title || `Modèle ${cutRow.design_id}`}</span> »
              <span style={{ display:"block", fontSize:11, color:"var(--muted)" }}>Stats et filaments limités à ce début de liste.</span></>)}
          </span>
          {!cutting && <button onClick={() => setCutting(true)} style={btn}>Changer</button>}
          <button onClick={() => cutting ? setCutting(false) : setUntil(null)}
            title={cutting ? "Ne rien changer" : "Revenir à toute la liste"}
            style={{ ...btn, background:"#3b82f6", color:"white", border:"none" }}>Annuler</button>
        </div>
      )}
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
        <h3 style={{ margin:0, padding:"14px 16px 6px", fontSize:15, fontWeight:800, color:"var(--text)" }}>Collections « À faire »</h3>
        <p style={{ margin:0, padding:"0 16px 8px", fontSize:12, color:"var(--muted)" }}>Leurs modèles forment la liste (sans doublon).</p>
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
const tag = { fontSize:9.5, fontWeight:800, padding:"1px 6px", borderRadius:20, lineHeight:1.5 };
const mv = { width:26, height:26, borderRadius:7, border:"1px solid var(--border)", background:"var(--surface)",
  color:"var(--text)", fontSize:13, fontWeight:800, cursor:"pointer", padding:0, lineHeight:1 };
const card = { padding:"8px 10px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" };
const pill = on => ({ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer",
  background: on ? "rgba(59,130,246,0.15)" : "var(--surface2)", color: on ? "#3b82f6" : "var(--text2)",
  border: on ? "1px solid #3b82f6" : "1px solid var(--border)" });
