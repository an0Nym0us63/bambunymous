import React, { useEffect, useRef, useState } from "react";
import { plateRound, plateDoneInRound } from "../utils/queueSort";
import { QUEUE_SORTS, sortQueue } from "../utils/queueSort";
import { useTrackDetail } from "../utils/track";
import { useUrlTab } from "../utils/useUrlTab";
import { createPortal } from "react-dom";
import client from "../api/client";
import MwImg from "./MwImg";
import AdminOnly from "./AdminOnly";
import { Pressable } from "./ContextMenu";
import { useCanMw } from "../store/auth";
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

// Les plateaux d'un modele, un par pastille : vert = faisable tout de suite avec
// l'AMS ; coche = deja imprime par moi ; gris = il manque un filament dans l'AMS ;
// orange avec sablier = en cours d'impression.
function PlateChips({ plates }) {
  // ou j'en suis, en series (un modele refait des mois plus tard repart d'une nouvelle serie)
  const round = plateRound(plates.map(p => p.printed));
  const todo = plates.filter(p => p.ready && !plateDoneInRound(p.printed, round) && !p.printing);   // faisables, ni faits (cette serie) ni en cours
  return (
    <span style={{ display:"flex", gap:5, marginTop:5, flexWrap:"wrap", alignItems:"center" }}>
      <span style={{ fontSize:10, color:"var(--muted)", marginRight:1 }}>Plateaux
        {/* combien des plateaux retenus sont deja faits */}
        <b style={{ marginLeft:4, color: round?.complete ? "#16a34a" : "var(--text2)" }}>{round?.label}</b></span>
      {plates.map(p => {
        const done = plateDoneInRound(p.printed, round);
        const tip = `Plateau ${p.index}${p.name ? ` · ${p.name}` : ""} : `
          + (p.ready ? "faisable maintenant avec l'AMS" : "un filament manque dans l'AMS")
          + (done ? ` · déjà imprimé${p.printed > 1 ? ` ${p.printed}×` : ""}` : " · pas encore imprimé")
          + (p.printing ? " · en cours d'impression" : "");
        return (
          <span key={p.index} data-tip={tip} style={{ position:"relative", minWidth:20, height:20, padding:"0 5px", borderRadius:7,
            fontSize:10, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center", gap:1,
            color: p.printing || p.ready ? "#fff" : "var(--muted)",
            background: p.printing ? "linear-gradient(135deg, #F59E0B, #FBBF24)" : p.ready ? (done ? "rgba(34,197,94,0.55)" : "linear-gradient(135deg, #22C55E, #4ADE80)") : "var(--surface)",
            border: p.printing ? "1px solid #f59e0b" : p.ready ? "1px solid #22c55e" : done ? "1px solid #22c55e" : "1px solid var(--border)",
            textDecoration: "none" }}>
            {p.printing && <span style={{ fontSize:9 }}>⏳</span>}
            {p.index}
            {/* deja imprime : une coche verte dans le coin, quelle que soit la couleur du carre */}
            {done && <span style={{ position:"absolute", top:-5, right:-5, width:11, height:11, borderRadius:"50%",
              background:"#22c55e", color:"#fff", fontSize:7.5, lineHeight:"11px", textAlign:"center",
              boxShadow:"0 0 0 1.5px var(--surface)" }}>✓</span>}
          </span>
        );
      })}
      {todo.length > 0 && (
        <span style={{ fontSize:10, fontWeight:700, color:"#16a34a", marginLeft:2 }}>
          à lancer : {todo.map(p => p.index).join(", ")}</span>
      )}
    </span>
  );
}

export default function MwQueue() {
  const [q, setQ] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [filter, setFilter] = useState("all");
  // le tri au sein d'un filtre (l'ordre de priorite par defaut) ; garde dans ce navigateur
  // le tri : a chaque ouverture, l'ordre de priorite (le choix ne se garde pas)
  const [sortBy, setSortBy] = useState("prio");
  const [model, setModel] = useState(null);
  const [tab, setTab] = useUrlTab("afaire", "models", ["models", "filaments"]);
  useTrackDetail(`À faire · ${tab === "filaments" ? "Filaments pour tout imprimer" : "Modèles"}`);
  const [sorting, setSorting] = useState(false);   // mode « Réorganiser »
  // « Jusqu'ici » : les stats ne portent que sur le debut de la file (garde dans ce navigateur).
  const [until, setUntilState] = useState(() => { try { return localStorage.getItem("mwQueueUntil") || null; } catch { return null; } });
  const [cutting, setCutting] = useState(false);
  // « Choisir » : stats sur des modeles coches un a un (garde dans ce navigateur).
  const [chosen, setChosenState] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mwQueuePick") || "[]"); } catch { return []; }
  });
  const [choosing, setChoosing] = useState(false);
  const setChosen = v => {
    setChosenState(v);
    try { v.length ? localStorage.setItem("mwQueuePick", JSON.stringify(v)) : localStorage.removeItem("mwQueuePick"); } catch { /* stockage indisponible */ }
  };
  const toggleChosen = did => setChosen(chosen.includes(did) ? chosen.filter(x => x !== did) : [...chosen, did]);
  const isAdmin = useCanMw();            // gerer « A faire » : droit MakerWorld
  const fresh = useRef(false);
  const staleT = useRef(null);
  useEffect(() => () => clearTimeout(staleT.current), []);
  const setUntil = v => {
    setUntilState(v);
    try { v ? localStorage.setItem("mwQueueUntil", v) : localStorage.removeItem("mwQueueUntil"); } catch { /* stockage indisponible */ }
  };

  useEffect(() => {
    let alive = true;
    setErr(null);
    const params = {};
    if (fresh.current) params.fresh = 1;
    if (chosen.length) params.ids = chosen.join(",");
    else if (until) params.until = until;
    fresh.current = false;
    client.get("/makerworld/queue", { params })
      .then(({ data }) => {
        if (!alive) return;
        setQ(data);
        if (until && !chosen.length && !data.until) setUntil(null);    // modele sorti de la liste : on revient au tout
        if (chosen.length && !data.picked) setChosen([]);
        // Ancien calcul (redemarrage) : affiche tout de suite, on redemande jusqu'au nouveau.
        if (data.stale) staleT.current = setTimeout(() => setReload(n => n + 1), 3000);
      })
      .catch(e => alive && setErr(e.response?.data?.detail || e.message))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [reload, until, chosen.join(",")]);

  const refresh = () => { fresh.current = true; setBusy(true); setReload(n => n + 1); };
  // Nombre d'exemplaires : affiche tout de suite, totaux recalcules par le serveur.
  const setQty = async (did, n) => {
    setQ(x => ({ ...x, models: x.models.map(r => r.design_id === did ? { ...r, qty: n } : r) }));
    try { await client.put(`/makerworld/queue/qty/${did}`, { qty: n }); refresh(); } catch { refresh(); }
  };
  // Ordre de priorite : deplace, enregistre l'ordre complet (les nouveaux y entrent).
  const [posFor, setPosFor] = useState(null);     // { id, title, at, n } : fenetre « position »
  const move = async (did, to) => {
    const ids = q.models.map(r => r.design_id);
    const i = ids.indexOf(did);
    // to : "top", "bottom", un pas (-1 / +1) ou {at: rang 1..n}
    const j = to === "top" ? 0 : to === "bottom" ? ids.length - 1
      : typeof to === "object" ? Math.max(0, Math.min(ids.length - 1, (to.at | 0) - 1))
      : Math.max(0, Math.min(ids.length - 1, i + to));
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
      subtitle: statusText(r), color: (STATUS[r.status] || STATUS.unknown)[1].startsWith("var") ? "#94A3B8" : (STATUS[r.status] || STATUS.unknown)[1],
      items: [
        { icon: "📄", label: "Ouvrir la fiche", tone: "#3B82F6", onClick: open },
        { icon: "🌐", label: "Voir sur MakerWorld", tone: "#06B6D4", onClick: () => window.open(`https://makerworld.com/fr/models/${r.design_id}`, "_blank", "noopener") },
        "-",
        isCut ? { icon: "↺", label: "Revenir à toute la liste", tone: "#3B82F6", onClick: () => setUntil(null) }
          : { icon: "✂", label: "Compter jusqu'ici", tone: "#3B82F6", hint: `Stats sur les ${i + 1} premier${i ? "s" : ""}`, onClick: () => setUntil(r.design_id) },
        isAdmin && "-",
        isAdmin && i > 0 && { icon: "⤒", label: "Mettre en tête", tone: "#22C55E", onClick: () => move(r.design_id, "top") },
        isAdmin && i > 0 && { icon: "↑", label: "Monter d'un cran", tone: "#22C55E", onClick: () => move(r.design_id, -1) },
        isAdmin && i < last && { icon: "↓", label: "Descendre d'un cran", tone: "#22C55E", onClick: () => move(r.design_id, 1) },
        isAdmin && i < last && { icon: "⤓", label: "Mettre en bas", tone: "#22C55E", onClick: () => move(r.design_id, "bottom") },
        isAdmin && last > 0 && { icon: "#", label: "Mettre à la position…", tone: "#22C55E", hint: `Actuellement ${i + 1} sur ${last + 1}`,
          onClick: () => setPosFor({ id: r.design_id, title: r.title_fr || r.title, at: String(i + 1), n: last + 1 }) },
        isAdmin && { icon: "⇅", label: "Réorganiser toute la liste", tone: "#22C55E", onClick: () => { setCutting(false); setSorting(true); } },
        isAdmin && "-",
        isAdmin && { icon: "＋", tone: "#8B5CF6", label: `Un exemplaire de plus (×${(r.qty || 1) + 1})`, onClick: () => setQty(r.design_id, Math.min(99, (r.qty || 1) + 1)) },
        isAdmin && (r.qty || 1) > 1 && { icon: "－", tone: "#8B5CF6", label: `Un de moins (×${r.qty - 1})`, onClick: () => setQty(r.design_id, r.qty - 1) },
        isAdmin && r.planned && { icon: "📌", label: "Oublier le plan retenu", hint: "Revient au profil et aux filaments par défaut", danger: true, onClick: () => forget(r.design_id) },
      ],
    };
  };
  if (err) return <p style={msg}>{err}</p>;
  if (!q) return <p style={msg}>Lecture de la liste… (la première fois, chaque fiche est lue sur MakerWorld)</p>;
  const t = q.totals;
  const filtered = q.models.filter(r => sorting || cutting || choosing || filter === "all" || r.status === filter);
  const rows = sorting || cutting ? filtered : sortQueue(filtered, sortBy);
  const cutAt = q.until ? q.models.findIndex(r => r.design_id === q.until.design_id) : -1;
  const picked = q.picked ? new Set(q.picked.ids) : null;
  const marks = choosing || picked;                // cases a cocher visibles
  const pos = Object.fromEntries(q.models.map((r, i) => [r.design_id, i]));
  const cutRow = cutAt >= 0 ? q.models[cutAt] : null;

  const commitPos = () => {
    const at = parseInt(posFor.at, 10);
    if (at >= 1) move(posFor.id, { at });
    setPosFor(null);
  };

  // les etats, dans l'ordre de la barre « pret a imprimer » (couleur, degrade)
  const SEG = [["ams", "Prêts (AMS)", "#22C55E", "#4ADE80"], ["partial", "En partie", "#16A34A", "#86EFAC"],
    ["stock", "Stock OK", "#F59E0B", "#FBBF24"], ["short", "Manque", "#EF4444", "#F87171"]];
  const segTotal = SEG.reduce((s, [k]) => s + (t[k] ?? 0), 0);
  const locked = sorting || cutting || choosing;   // filtres sans effet pendant ces modes
  const kpis = [["📋 Modèles", t.models, "#3B82F6", "#60A5FA"], ["⏱ Temps", fmtDur(t.seconds), "#8B5CF6", "#C084FC"],
    ["⚖ Filament", g(t.weight_g), "#F59E0B", "#FBBF24"], ["💶 Coût", t.cost ? `${moneyVal(t.cost, 2)} €` : "—", "#16A34A", "#4ADE80"]];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12, paddingBottom: cutting || cutRow || choosing || picked ? 92 : 16 }}>
      {/* « Mettre à la position… » : un numero, Entree pour valider */}
      {posFor && createPortal(
        <div onClick={() => setPosFor(null)} style={{ position:"fixed", inset:0, zIndex:3000, background:"rgba(2,6,23,0.5)", backdropFilter:"blur(4px)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:340, borderRadius:20, overflow:"hidden", background:"var(--sheet-bg)",
            border:"1px solid var(--border)", boxShadow:"0 30px 80px rgba(0,0,0,0.45)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", background:"linear-gradient(135deg, #3B82F638, transparent 70%)" }}>
              <span style={{ width:34, height:34, borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center", background:"#3B82F6",
                color:"#fff", fontWeight:900 }}>#</span>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:"block", fontSize:15, fontWeight:900, color:"var(--text)" }}>Mettre à la position</span>
                <span style={{ display:"block", fontSize:12, fontWeight:700, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{posFor.title}</span>
              </span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 16px 16px" }}>
              <input type="number" inputMode="numeric" min={1} max={posFor.n} value={posFor.at} autoFocus
                onFocus={e => e.target.select()}
                onChange={e => setPosFor(p => ({ ...p, at: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") commitPos(); if (e.key === "Escape") setPosFor(null); }}
                style={{ width:80, padding:"9px 10px", borderRadius:12, fontSize:17, fontWeight:900, textAlign:"center",
                  background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}/>
              <span style={{ fontSize:12.5, fontWeight:700, color:"var(--muted)" }}>sur {posFor.n}</span>
              <span style={{ flex:1 }}/>
              <button onClick={() => setPosFor(null)} style={btn}>Annuler</button>
              <button onClick={commitPos} style={{ ...btn, background:"linear-gradient(135deg, #3B82F6, #6366F1)", border:"none", color:"white" }}>OK</button>
            </div>
          </div>
        </div>, document.body)}

      {/* les collections qui forment la liste ; choisir, relire */}
      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
        {q.collections.length ? q.collections.map(c => (
          <span key={c.id} style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:12, fontWeight:800, padding:"5px 11px", borderRadius:20,
            background:"linear-gradient(135deg, rgba(59,130,246,0.16), rgba(99,102,241,0.10))", color:"#3b82f6", border:"1px solid rgba(59,130,246,0.25)" }}>📁 {c.title}</span>
        )) : <span style={{ fontSize:12.5, fontWeight:700, color:"#f59e0b" }}>Aucune collection choisie</span>}
        <AdminOnly mw><button onClick={() => setPick(true)} style={{ ...btn, borderRadius:20 }}>⚙ Choisir</button></AdminOnly>
        <button onClick={refresh} disabled={busy} data-tip="Relire maintenant" aria-label="Relire maintenant" style={{ ...round, marginLeft:"auto" }}>
          {busy || q.stale ? <span className="mw-spin" style={{ width:13, height:13 }}/> : "⟳"}</button>
      </div>

      {q.collections.length === 0 ? (
        <div style={{ padding:"18px 16px", borderRadius:18, border:"1px dashed var(--border)", textAlign:"center",
          background:"radial-gradient(80% 80% at 50% 0%, rgba(34,197,94,0.12), transparent 70%), var(--surface2)" }}>
          <div style={{ fontSize:30, marginBottom:6 }}>✅</div>
          <p style={{ ...msg, padding:0 }}>Choisis une ou plusieurs collections MakerWorld (par exemple « À faire ») : leurs modèles forment la liste « À faire ».</p>
        </div>
      ) : (<>
        {/* les chiffres de la liste (ou de son debut / des modeles choisis) */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0, 1fr))", gap:6 }}>
          {kpis.map(([label, val, c1, c2]) => (
            <div key={label} style={{ minWidth:0, padding:"7px 8px", borderRadius:14, border:`1px solid color-mix(in srgb, ${c1} 22%, var(--border))`,
              background:`radial-gradient(90% 70% at 100% 0%, ${c1}22, transparent 70%), var(--surface2)`, boxShadow:`0 6px 18px -12px ${c1}` }}>
              <div style={{ fontSize:9.5, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase", color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden" }}>{label}</div>
              <div style={{ fontSize:"clamp(13px, 3.9vw, 16px)", fontWeight:900, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", ...grad(c1, c2) }}>{val}</div>
            </div>))}
        </div>

        {/* pret a imprimer : la barre des etats, et ses pastilles qui filtrent la liste */}
        <div style={{ padding:"11px 12px", borderRadius:18, border:"1px solid color-mix(in srgb, #22C55E 22%, var(--border))", display:"flex", flexDirection:"column", gap:9,
          background:"radial-gradient(70% 90% at 0% 0%, rgba(34,197,94,0.14), transparent 70%), var(--surface2)" }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
            <span style={{ fontSize:13, fontWeight:900, color:"var(--text)" }}>Prêt à imprimer ?</span>
            {t.printed > 0 && <span style={{ fontSize:11.5, fontWeight:800, color:"var(--muted)" }}>· ✓ {t.printed} déjà imprimé{t.printed > 1 ? "s" : ""}</span>}
          </div>
          <div style={{ display:"flex", height:10, borderRadius:10, overflow:"hidden", background:"var(--surface)", boxShadow:"inset 0 0 0 1px var(--border)" }}>
            {segTotal > 0 && SEG.map(([k, , c1, c2]) => (t[k] ?? 0) > 0 && (
              <span key={k} style={{ width:`${100 * t[k] / segTotal}%`, background:`linear-gradient(90deg, ${c1}, ${c2})` }}/>))}
          </div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            <button onClick={() => { setTab("models"); setFilter("all"); }} disabled={locked} style={chip(tab === "models" && filter === "all" && !locked, "#3B82F6", locked)}>
              Tous <b>{t.models}</b></button>
            {SEG.map(([k, l, c1]) => (
              <button key={k} onClick={() => { setTab("models"); setFilter(f => f === k ? "all" : k); }} disabled={locked} data-tip={STATUS[k][2]}
                style={chip(tab === "models" && filter === k && !locked, c1, locked)}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:c1, flexShrink:0 }}/>{l} <b>{t[k] ?? 0}</b></button>))}
          </div>
        </div>

        {/* Modeles / Filaments pour tout imprimer */}
        <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:16, padding:4, border:"1px solid var(--border)" }}>
          {[["models", `Modèles (${t.models})`, "📋", "#3B82F6"], ["filaments", "Filaments pour tout imprimer", "🧵", "#EC4899"]].map(([k, l, ic, c]) => (
            <button key={k} onClick={() => setTab(k)} style={{ flex:1, minWidth:0, padding:"8px 6px", borderRadius:12, fontSize:"clamp(11px, 3.2vw, 12.5px)", fontWeight:800,
              cursor:"pointer", border:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:5, whiteSpace:"nowrap", overflow:"hidden",
              background: tab === k ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "transparent",
              color: tab === k ? "white" : "var(--muted)", boxShadow: tab === k ? `0 6px 16px -6px ${c}` : "none" }}>
              <span>{ic}</span><span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{l}</span></button>
          ))}
        </div>

        {tab === "filaments" && (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {q.filaments.map(f => {
              const ok = !f.missing_g, c = ok ? "#22C55E" : "#EF4444";
              const fill = f.stock_g > 0 ? Math.min(1, f.need_g / f.stock_g) : 1;
              return (
                <div key={f.filament_id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:16, border:"1px solid var(--border)",
                  background:`linear-gradient(135deg, ${hexOf(f)}1f, transparent 55%), var(--surface2)` }}>
                  <Swatch f={f} size={30}/>
                  <span style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:3 }}>
                    <span style={{ fontSize:13, fontWeight:800, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {[f.brand, f.material, `${f.models} modèle${f.models > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}
                      {f.ams_g ? <span style={{ color:"#22c55e" }}> · AMS {g(f.ams_g)}</span> : ""}</span>
                    {/* ce qu'il faut, rapporte au stock */}
                    <span data-tip={`${g(f.need_g)} nécessaires sur ${g(f.stock_g)} en stock`} style={{ height:6, borderRadius:6, background:"var(--surface)", overflow:"hidden",
                      boxShadow:"inset 0 0 0 1px var(--border)" }}>
                      <span style={{ display:"block", height:"100%", width:`${fill * 100}%`, borderRadius:6, background:`linear-gradient(90deg, ${c}, ${ok ? "#86EFAC" : "#FCA5A5"})` }}/></span>
                  </span>
                  <span style={{ textAlign:"right", flexShrink:0 }}>
                    <span style={{ display:"block", fontSize:13, fontWeight:900, color:"var(--text)" }}>{g(f.need_g)} <span style={{ color:"var(--muted)", fontWeight:700 }}>/ {g(f.stock_g)}</span></span>
                    <span style={{ display:"inline-block", marginTop:3, fontSize:10.5, fontWeight:800, padding:"1px 8px", borderRadius:20, color:c, background:`${c}1f` }}>
                      {f.missing_g ? `manque ${g(f.missing_g)}` : `reste ${g(f.stock_g - f.need_g)}`}</span>
                  </span>
                </div>);
            })}
            {q.unmatched.map(u => (
              <div key={u.type + u.color} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:16,
                border:"1px solid rgba(239,68,68,0.35)", background:"linear-gradient(135deg, rgba(239,68,68,0.12), transparent 60%), var(--surface2)" }}>
                <span style={{ width:30, height:30, borderRadius:"50%", background:u.color, border:"2px dashed #ef4444", flexShrink:0 }}/>
                <span style={{ flex:1, fontSize:12.5, color:"#ef4444", fontWeight:800 }}>Aucun {u.type} de cette couleur en stock</span>
                <span style={{ fontSize:13, fontWeight:900, color:"var(--text)" }}>{g(u.need_g)}</span>
              </div>
            ))}
            {q.filaments.length === 0 && q.unmatched.length === 0 && <p style={msg}>Aucun filament à prévoir.</p>}
          </div>
        )}

        {tab === "models" && (<>
        {/* tri et modes : compter jusqu'ici, choisir, reorganiser (sur grand ecran, sur une ligne) */}
        <div className="queue-tools" style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {sorting && <span style={{ fontSize:12, fontWeight:700, color:"var(--muted)" }}>Ordre de priorité : ⤒ en haut, ↑ ↓, ⤓ en bas.</span>}
          {!sorting && !cutting && (
            <label style={{ position:"relative", display:"flex", alignItems:"center", minWidth:0 }}>
              <span style={{ position:"absolute", left:12, fontSize:12, pointerEvents:"none" }}>↕</span>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Trier" style={{ width:"100%", height:36, borderRadius:18,
                border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)", fontWeight:800, fontSize:12.5, padding:"0 10px 0 28px" }}>
                {QUEUE_SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
          <div style={{ display:"flex", gap:6 }}>
          {!sorting && <button onClick={() => { setChoosing(false); setCutting(v => !v); }} data-tip="Stats limitées aux premiers modèles de la liste"
            style={mode(cutting || (!!cutRow && !picked))}>✂ Jusqu'ici</button>}
          {!sorting && <button onClick={() => { setCutting(false); setChoosing(v => !v); }} data-tip="Stats sur les modèles que tu coches"
            style={mode(choosing || !!picked)}>☑ Choisir</button>}
          <AdminOnly mw><button onClick={() => { setSorting(v => !v); setCutting(false); }} style={mode(sorting, "#22C55E")}>
            {sorting ? "✓ Terminé" : "⇅ Réorganiser"}</button></AdminOnly>
          </div>
        </div>

        <div className="wide-list" style={{ alignItems: "stretch" }}>
          {rows.map(r => {
            const [, color, help] = STATUS[r.status] || STATUS.unknown;
            const sc = color.startsWith("var") ? "#94A3B8" : color;
            const isPicked = choosing ? chosen.includes(r.design_id) : !!picked?.has(r.design_id);
            const out = picked ? !isPicked && !choosing : cutAt >= 0 && pos[r.design_id] > cutAt;
            return (
              <React.Fragment key={r.design_id}>
              <Pressable role="button" tabIndex={0} menu={sorting || cutting || choosing ? null : () => rowMenu(r)}
                onClick={() => choosing ? toggleChosen(r.design_id) : cutting ? (setChosen([]), setUntil(r.design_id), setCutting(false))
                  : setModel({ design_id: r.design_id, title: r.title, title_fr: r.title_fr, cover_url: r.cover_url })}
                onPointerDown={() => prefetchModel(r.design_id)}
                style={{ position:"relative", display:"flex", alignItems:"flex-start", gap:10, padding:"10px 10px 10px 14px", borderRadius:18, cursor:"pointer",
                  textAlign:"left", height:"100%", boxSizing:"border-box", overflow:"hidden", color:"var(--text)", opacity: out ? 0.45 : 1,
                  background:`linear-gradient(135deg, ${sc}17, transparent 50%), var(--surface2)`,
                  border: cutting || choosing ? "1.5px dashed #3b82f6" : r.printing ? "1.5px solid #3b82f6" : `1px solid color-mix(in srgb, ${sc} 22%, var(--border))`,
                  boxShadow: r.printing ? "0 8px 22px -12px #3b82f6" : "none" }}>
                {/* l'etat, en liseré a gauche */}
                <span aria-hidden="true" style={{ position:"absolute", left:0, top:10, bottom:10, width:4, borderRadius:4, background:`linear-gradient(${sc}, ${sc}88)` }}/>
                {marks && <span style={{ width:22, height:22, borderRadius:7, flexShrink:0, display:"flex", alignItems:"center",
                  justifyContent:"center", fontSize:13, fontWeight:900, color:"white",
                  background: isPicked ? "linear-gradient(135deg, #3B82F6, #6366F1)" : "transparent", border: isPicked ? "none" : "1.5px solid var(--muted)" }}>
                  {isPicked ? "✓" : ""}</span>}
                <span style={{ position:"relative", flexShrink:0 }}>
                  {r.cover_url ? <MwImg src={r.cover_url} w={130} style={{ width:62, height:62, borderRadius:14, objectFit:"cover", display:"block",
                    boxShadow:"0 6px 14px -8px rgba(0,0,0,.5)" }}/>
                    : <span style={{ display:"block", width:62, height:62, borderRadius:14, background:"var(--surface)" }}/>}
                  {(r.qty || 1) > 1 && <span style={{ position:"absolute", right:-4, bottom:-4, padding:"1px 6px", borderRadius:20, fontSize:10.5, fontWeight:900,
                    color:"#fff", background:"linear-gradient(135deg, #8B5CF6, #A855F7)", boxShadow:"0 0 0 2px var(--surface2)" }}>×{r.qty}</span>}
                </span>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"flex", alignItems:"flex-start", gap:6 }}>
                    <span style={{ flex:1, minWidth:0, fontSize:13.5, fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", paddingTop:2 }}>
                      {r.title_fr || r.title || `Modèle ${r.design_id}`}</span>
                    {/* Tout ce qui dit « faisable ou non » se lit ici, a droite du titre. */}
                    <span style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3, flexShrink:0 }}>
                      <span data-tip={help} style={{ fontSize:10.5, fontWeight:900, color: sc, whiteSpace:"nowrap", padding:"2px 8px", borderRadius:20,
                        background:`${sc}1f`, border:`1px solid ${sc}40` }}>{statusText(r)}</span>
                      {r.status === "partial" && (r.stock_ok
                        ? <span data-tip="Le reste (autres plateaux ou exemplaires) est faisable avec le stock, à charger dans l'AMS" style={{ ...tag, color:"#f59e0b", background:"rgba(245,158,11,0.12)", whiteSpace:"nowrap" }}>reste : stock OK</span>
                        : <span data-tip="Pour le reste, un filament manque en stock" style={{ ...tag, color:"#ef4444", background:"rgba(239,68,68,0.12)", whiteSpace:"nowrap" }}>reste : manque</span>)}
                    </span>
                  </span>
                  <span style={{ display:"flex", gap:4, flexWrap:"wrap", margin:"3px 0 2px" }}>
                    {r.printing && <span data-tip="En cours d'impression" style={{ ...tag, color:"white", background:"linear-gradient(135deg, #3B82F6, #6366F1)" }}>
                      🖨️ En cours{r.progress != null ? ` · ${r.progress} %` : ""}{r.remaining_min ? ` · ${fmtDur(r.remaining_min * 60)}` : ""}</span>}
                    {r.new && <span style={{ ...tag, color:"#3b82f6", background:"rgba(59,130,246,0.14)" }}>✨ Nouveau</span>}
                    {r.planned
                      ? <span data-tip="Profil, plateaux et filaments retenus depuis la fiche" style={{ ...tag, color:"#16a34a", background:"rgba(34,197,94,0.14)" }}>📌 Retenu</span>
                      : <span data-tip="Profil retenu par l'appli, tous les plateaux, filament le plus proche du stock" style={{ ...tag, color:"var(--muted)", background:"var(--surface)", border:"1px dashed var(--border)" }}>Par défaut</span>}
                    {r.printed > 0 && <span style={{ ...tag, color:"#8B5CF6", background:"rgba(139,92,246,0.14)" }}>✓ imprimé {r.printed}×</span>}
                  </span>
                  <span style={{ display:"block", fontSize:11, fontWeight:600, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {r.profile ? `${r.profile.title || "Profil"}${r.profile.plates < r.profile.plates_total ? ` · ${r.profile.plates}/${r.profile.plates_total} plateaux` : ""}` : "profil inconnu"}</span>
                  <span style={{ display:"flex", gap:8, marginTop:2, fontSize:11.5, fontWeight:800, flexWrap:"wrap" }}>
                    <span style={grad("#8B5CF6", "#C084FC")}>⏱ {fmtDur(r.seconds)}</span>
                    <span style={grad("#F59E0B", "#FBBF24")}>⚖ {g(r.weight_g)}</span>
                    {r.cost != null && <span style={grad("#16A34A", "#4ADE80")}>💶 {moneyVal(r.cost, 2)} €</span>}
                  </span>
                  {r.plates?.length > 1 && <PlateChips plates={r.plates}/>}
                  {r.ready_now?.plates > 0 && (
                    <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:11, fontWeight:800, color:"#16a34a", marginTop:5, padding:"2px 8px",
                      borderRadius:20, background:"rgba(34,197,94,0.12)" }}>
                      ▶ faisable maintenant : {r.ready_now.plates} plateau{r.ready_now.plates > 1 ? "x" : ""}
                      {r.ready_now.seconds ? ` · ${fmtDur(r.ready_now.seconds)}` : ""}{r.ready_now.weight_g ? ` · ${g(r.ready_now.weight_g)}` : ""}</span>
                  )}
                  {/* les filaments, et a droite la quantite (ou les fleches du rangement) */}
                  <span style={{ display:"flex", alignItems:"flex-end", gap:8, marginTop:6 }}>
                  <span style={{ display:"flex", gap:4, flexWrap:"wrap", flex:1, minWidth:0, paddingBottom:5 }}>
                    {r.filaments.map((f, i) => (
                      <span key={i} data-tip={`${f.type} ${Math.round(f.g)} g → ${f.chosen ? f.chosen.name + (f.chosen.in_ams ? " (AMS)" : "") : "rien en stock"}`}
                        style={{ width:16, height:16, borderRadius:"50%", flexShrink:0,
                          ...(f.chosen ? colorBg(parseColorsList(f.chosen.color, f.chosen.colors_array), f.chosen.multicolor_type) : { background:f.color }),
                          border: !f.chosen ? "2px solid #ef4444" : f.chosen.enough_ams ? "2px solid #22c55e"
                            : f.chosen.enough_stock ? "2px solid #f59e0b" : "2px solid #ef4444" }}/>
                    ))}
                  </span>
                  {sorting ? (
                    <span onClick={e => e.stopPropagation()} style={{ display:"flex", gap:4 }}>
                      {[["top", "⤒", "En haut"], [-1, "↑", "Monter"], [1, "↓", "Descendre"], ["bottom", "⤓", "En bas"]].map(([to, ic, l]) => (
                        <button key={l} onClick={() => move(r.design_id, to)} aria-label={l} data-tip={l} style={mv}>{ic}</button>
                      ))}
                    </span>
                  ) : isAdmin ? <Qty value={r.qty || 1} onChange={n => setQty(r.design_id, n)}/> : null}
                  </span>
                </span>
              </Pressable>
              {!cutting && !marks && pos[r.design_id] === cutAt && cutAt < q.models.length - 1 && (
                <div className="wide-span" style={{ display:"flex", alignItems:"center", gap:8, color:"#3b82f6", fontSize:11.5, fontWeight:900 }}>
                  <span style={{ flex:1, borderTop:"2px dashed #3b82f6" }}/>✂ jusqu'ici<span style={{ flex:1, borderTop:"2px dashed #3b82f6" }}/>
                </div>
              )}
              </React.Fragment>
            );
          })}
        </div>
        {/* le mode d'emploi, replie a chaque ouverture */}
        <details style={{ borderRadius:14, border:"1px solid var(--border)", background:"var(--surface2)", padding:"8px 12px" }}>
          <summary style={{ cursor:"pointer", fontSize:12, fontWeight:800, color:"var(--muted)" }}>ⓘ Comment ça marche</summary>
          <p style={{ fontSize:11.5, color:"var(--muted)", margin:"8px 0 2px", lineHeight:1.55 }}>
            Ouvre un modèle, déplie son profil, choisis plateaux et filaments, puis « 📌 Retenir pour « À faire » ». Sans
            cela, la liste prend le profil retenu, tous les plateaux et le filament le plus proche de ton stock.
            Pastilles : vert = dans l'AMS, orange = en stock, rouge = manque. Un modèle arrivé dans la liste sans place
            définie se met en haut (« Nouveau »). Appui long ou clic droit sur un modèle : son menu.</p>
        </details>
        </>)}
      </>)}

      {(choosing || picked) && !cutting && (
        <div style={floatBar}>
          <span style={floatIco}>☑</span>
          <span style={{ flex:1, minWidth:0, fontSize:12.5, lineHeight:1.35, color:"var(--text)" }}>
            <b>{chosen.length} modèle{chosen.length > 1 ? "s" : ""} choisi{chosen.length > 1 ? "s" : ""}</b>
            <span style={{ display:"block", fontSize:11, fontWeight:600, color:"var(--muted)" }}>
              {choosing ? "Touche les modèles à compter." : "Stats et filaments limités à ces modèles."}</span>
          </span>
          {choosing
            ? <button onClick={() => setChoosing(false)} style={btn}>OK</button>
            : <button onClick={() => setChoosing(true)} style={btn}>Changer</button>}
          <button onClick={() => { setChoosing(false); setChosen([]); }} data-tip="Revenir à toute la liste"
            style={{ ...btn, background:"linear-gradient(135deg, #3B82F6, #6366F1)", color:"white", border:"none" }}>Annuler</button>
        </div>
      )}
      {(cutting || (cutRow && !picked)) && !choosing && (
        <div style={floatBar}>
          <span style={floatIco}>✂</span>
          <span style={{ flex:1, minWidth:0, fontSize:12.5, lineHeight:1.35, color:"var(--text)" }}>
            {cutting ? <b>Touche le dernier modèle à compter</b> : (<>
              <b>{q.until.count} élément{q.until.count > 1 ? "s" : ""}</b> jusqu'à « <span style={{ fontWeight:700 }}>
                {cutRow.title_fr || cutRow.title || `Modèle ${cutRow.design_id}`}</span> »
              <span style={{ display:"block", fontSize:11, fontWeight:600, color:"var(--muted)" }}>Stats et filaments limités à ce début de liste.</span></>)}
          </span>
          {!cutting && <button onClick={() => setCutting(true)} style={btn}>Changer</button>}
          <button onClick={() => cutting ? setCutting(false) : setUntil(null)}
            data-tip={cutting ? "Ne rien changer" : "Revenir à toute la liste"}
            style={{ ...btn, background:"linear-gradient(135deg, #3B82F6, #6366F1)", color:"white", border:"none" }}>Annuler</button>
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
  const b = { width:26, height:26, borderRadius:9, border:"1px solid var(--border)", background:"var(--surface)",
    color:"var(--text)", fontSize:14, fontWeight:900, cursor:"pointer", lineHeight:1, padding:0 };
  return (
    <AdminOnly mw fallback={value > 1 ? <span style={{ fontSize:11.5, fontWeight:800 }}>×{value}</span> : null}>
      <span onClick={e => e.stopPropagation()} style={{ display:"flex", alignItems:"center", gap:3, padding:2, borderRadius:12,
        background:"var(--surface)", border:"1px solid var(--border)" }}>
        <button onClick={() => value > 1 && onChange(value - 1)} disabled={value <= 1} aria-label="Un de moins" style={{ ...b, border:"none", opacity: value <= 1 ? 0.4 : 1 }}>‒</button>
        <span style={{ minWidth:24, textAlign:"center", fontSize:12.5, fontWeight:900, ...grad("#8B5CF6", "#C084FC") }}>×{value}</span>
        <button onClick={() => value < 99 && onChange(value + 1)} aria-label="Un de plus" style={{ ...b, border:"none" }}>+</button>
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
    <div data-no-pull="" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4000, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"22px 22px 0 0", width:"100%", overflow:"hidden",
        maxWidth:520, maxHeight:"75dvh", display:"flex", flexDirection:"column", paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"16px 16px 12px", background:"linear-gradient(135deg, rgba(34,197,94,0.22), transparent 70%)" }}>
          <span style={{ width:38, height:38, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
            background:"linear-gradient(135deg, #22C55E, #4ADE80)", color:"#fff" }}>📁</span>
          <span style={{ flex:1, minWidth:0 }}>
            <span style={{ display:"block", fontSize:16, fontWeight:900, color:"var(--text)" }}>Collections « À faire »</span>
            <span style={{ display:"block", fontSize:12, fontWeight:600, color:"var(--muted)" }}>Leurs modèles forment la liste (sans doublon).</span>
          </span>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"8px 12px", display:"flex", flexDirection:"column", gap:6 }}>
          {list === null ? <p style={msg}>…</p> : list.map(c => {
            const on = sel.has(c.id);
            return (
              <label key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", cursor:"pointer", fontSize:13.5, fontWeight:700,
                color:"var(--text)", borderRadius:14, border:`1px solid ${on ? "rgba(34,197,94,0.45)" : "var(--border)"}`,
                background: on ? "linear-gradient(135deg, rgba(34,197,94,0.14), transparent 70%), var(--surface2)" : "var(--surface2)" }}>
                <input type="checkbox" checked={on} onChange={() => setSel(s => { const x = new Set(s); x.has(c.id) ? x.delete(c.id) : x.add(c.id); return x; })}
                  style={{ width:18, height:18, accentColor:"#22C55E" }}/>
                <span style={{ flex:1 }}>{c.title}</span>
                {c.count != null && <span style={{ fontSize:11.5, fontWeight:800, color:"var(--muted)", padding:"1px 8px", borderRadius:20, background:"var(--surface)" }}>{c.count}</span>}
              </label>);
          })}
        </div>
        <div style={{ display:"flex", gap:8, padding:"10px 16px", borderTop:"1px solid var(--border)" }}>
          <button onClick={onClose} style={{ ...btn, flex:1, padding:"11px" }}>Annuler</button>
          <button onClick={save} disabled={busy} style={{ ...btn, flex:2, padding:"11px", background:"linear-gradient(135deg, #22C55E, #16A34A)", color:"white", border:"none" }}>
            {busy ? "…" : `Utiliser ${sel.size} collection${sel.size > 1 ? "s" : ""}`}</button>
        </div>
      </div>
    </div>, document.body);
}

const hexOf = f => { const c = parseColorsList(f.color, f.colors_array)?.[0]; return /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#94A3B8"; };
function Swatch({ f, size = 18 }) {
  return <span style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, border:"1px solid rgba(128,128,128,0.45)",
    boxShadow:`0 4px 10px -4px ${hexOf(f)}`, ...colorBg(parseColorsList(f.color, f.colors_array), f.multicolor_type) }}/>;
}

const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
const btn = { padding:"7px 12px", borderRadius:11, fontSize:12.5, fontWeight:800, cursor:"pointer",
  background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" };
const round = { width:36, height:36, borderRadius:12, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--muted)",
  cursor:"pointer", fontSize:15, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 };
const tag = { fontSize:10, fontWeight:800, padding:"1px 7px", borderRadius:20, lineHeight:1.5 };
const mv = { width:28, height:28, borderRadius:9, border:"1px solid var(--border)", background:"var(--surface)",
  color:"var(--text)", fontSize:13, fontWeight:900, cursor:"pointer", padding:0, lineHeight:1 };
const grad = (a, b) => ({ backgroundImage:`linear-gradient(135deg, ${a}, ${b})`, WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" });
// une pastille d'etat qui filtre ; grisee quand un mode la rend sans effet
const chip = (on, c, off) => ({ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 11px", borderRadius:20, fontSize:12, fontWeight:700,
  cursor: off ? "default" : "pointer", opacity: off ? 0.5 : 1, color: on ? "#fff" : "var(--text2)", border: on ? "1px solid transparent" : "1px solid var(--border)",
  background: on ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "var(--surface)", boxShadow: on ? `0 6px 14px -8px ${c}` : "none" });
const mode = (on, c = "#3B82F6") => ({ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", height:36, padding:"0 12px", borderRadius:18, fontSize:12.5, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap",
  color: on ? "#fff" : "var(--text2)", border: on ? "1px solid transparent" : "1px solid var(--border)",
  background: on ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "var(--surface2)", boxShadow: on ? `0 6px 14px -8px ${c}` : "none" });
const floatBar = { position:"fixed", bottom:"calc(76px + env(safe-area-inset-bottom,0px))", left:12, right:12, zIndex:500,
  maxWidth:560, margin:"0 auto", display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:18,
  background:"color-mix(in srgb, var(--sheet-bg) 92%, transparent)", backdropFilter:"blur(10px)", border:"1px solid rgba(59,130,246,0.5)",
  boxShadow:"0 14px 34px -10px rgba(59,130,246,0.45)" };
const floatIco = { width:34, height:34, borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0,
  color:"#fff", background:"linear-gradient(135deg, #3B82F6, #6366F1)" };
