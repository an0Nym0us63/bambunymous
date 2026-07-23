import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import AdminOnly from "./AdminOnly";
import { colorBg, parseColorsList } from "../utils/colors";
import { FilamentSheet, FilamentSheetFromSpool } from "../pages/Filaments";
import { PrintDetail } from "../pages/Prints";

/**
 * Toutes les alertes, filtrables.
 *
 * Composant partagé : ouvert depuis Paramètres ET depuis la section d'accueil.
 * Le dupliquer aurait garanti que les deux versions divergent.
 */
function Dot({ a, size = 22 }) {
  const box = { width:size, height:size, borderRadius:6, flexShrink:0,
    position:"relative", overflow:"hidden",
    boxShadow:"inset 0 0 0 1px rgba(128,128,128,0.30)" };
  if (a.entity === "print") {
    return (
      <div style={{ ...box, background:"var(--surface)" }}>
        {a.image ? (
          <img src={a.image} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}
            onError={e => { e.currentTarget.style.display = "none"; }}/>
        ) : (
          <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center",
            justifyContent:"center", fontSize:size * 0.5 }}>🖨</span>
        )}
      </div>
    );
  }
  const cols = parseColorsList(a.color, a.colors_array);
  return (
    <div style={box}>
      <div style={{ position:"absolute", inset:0, ...colorBg(cols, a.multicolor_type) }}/>
    </div>
  );
}

export default function AllAlertsModal({ onClose, onChanged, initialTab = "all" }) {
  const [tab, setTab]   = useState(initialTab);   // "all" | "dismissed"
  const [data, setData] = useState(null);
  const [dis, setDis]   = useState(null);         // sourdines, avec leur duree
  const [cat, setCat]   = useState("");
  const [q, setQ]       = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const [sheet, setSheet] = useState(null);   // fiche ouverte par-dessus la liste

  // Meme comportement que sur l'accueil : la liste ne servait a rien si on ne
  // pouvait pas ouvrir ce qu'elle signale.
  // Une alerte n'est ouvrable que si sa CIBLE est complete. Sans ce garde-fou, une
  // entite supprimee (ou une cle mal formee) partait chercher /prints/undefined.
  const canOpen = (a) => !!a?.entity && a.entity_id != null
    && (a.entity !== "spool" || a.filament_id != null);

  const openAlert = async (a) => {
    if (!canOpen(a)) return;
    try {
      if (a.entity === "filament") {
        const r = await client.get(`/filaments/filaments/${a.entity_id}`);
        setSheet({ kind:"filament", data:r.data });
      } else if (a.entity === "spool") {
        setSheet({ kind:"spool", spoolId:a.entity_id, filamentId:a.filament_id, hex:a.color });
      } else if (a.entity === "print") {
        const r = await client.get(`/prints/${a.entity_id}`);
        setSheet({ kind:"print", data:r.data });
      }
    } catch (e) {
      setErr("Impossible d'ouvrir la fiche : " + (e.response?.data?.detail || e.message));
    }
  };

  const load = () => {
    setErr(null);
    // Les deux onglets viennent de sources differentes : /all recalcule les
    // alertes, /dismissed porte la DUREE de chaque sourdine (que /all ignore).
    client.get("/attention/all")
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.detail || e.message));
    client.get("/attention/dismissed")
      .then(r => setDis(r.data?.dismissed || []))
      .catch(e => setErr(e.response?.data?.detail || e.message));
  };
  useEffect(load, []);

  // Onglet courant -> jeu de donnees. Le reste (filtres, lignes) est mutualise :
  // les deux fenetres separees affichaient deja la meme chose.
  const source = tab === "all"
    ? (data?.alerts || []).filter(a => !a.dismissed)
    : (dis || []);

  const counts = {};
  source.forEach(a => { counts[a.category] = (counts[a.category] || 0) + 1; });

  const catList = tab === "all"
    ? (data?.categories || []).filter(c => counts[c.category])
    : Object.keys(counts).map(c => {
        const r = source.find(x => x.category === c);
        return { category:c, label:r?.label || c, icon:r?.icon || "•" };
      }).sort((a, b) => a.label.localeCompare(b.label));

  const match = (a) => {
    if (cat && a.category !== cat) return false;
    if (!q.trim()) return true;
    const hay = [a.title, a.brand, a.material, a.detail, a.value, a.cat_label, a.label]
      .filter(Boolean).join(" ").toLowerCase();
    return q.trim().toLowerCase().split(/\s+/).every(w => hay.includes(w));
  };
  const shown = source.filter(match);

  const fmtUntil = (r) => {
    if (r.forever) return "Définitivement";
    if (!r.until)  return "—";
    if (r.expired) return "Expiré";
    const days = Math.max(0, Math.ceil((new Date(r.until) - new Date()) / 86400000));
    return `Encore ${days} j`;
  };

  // Restaure exactement les lignes VISIBLES, c'est-a-dire ce que la recherche
  // et la categorie ont laisse passer. Il n'existe pas de route "restaurer un
  // lot" : on enchaine les suppressions unitaires, puis on recharge une seule
  // fois a la fin plutot qu'a chaque appel.
  const clearFiltered = async () => {
    const keys = shown.map(a => a.key);
    if (!keys.length) return;
    if (!window.confirm(
      `Remettre en circulation ${keys.length} alerte${keys.length > 1 ? "s" : ""} ?`)) return;
    setBusy(true);
    try {
      for (const k of keys) {
        await client.delete(`/attention/dismiss/${encodeURIComponent(k)}`);
      }
      setDis(ds => (ds || []).filter(d => !keys.includes(d.key)));
      load(); onChanged?.();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const clearAll = async () => {
    if (!window.confirm("Remettre en circulation TOUTES les alertes ignorées ?")) return;
    setBusy(true);
    try { await client.delete("/attention/dismissed"); setDis([]); load(); onChanged?.(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const mark = (key, dismissed) =>
    setData(d => ({ ...d, alerts: d.alerts.map(x =>
      x.key === key ? { ...x, dismissed } : x) }));

  const dismiss = async (a, days) => {
    mark(a.key, true);
    try {
      await client.post("/attention/dismiss", { key: a.key, days: days ?? null });
      load(); onChanged?.();          // l'onglet "ignorees" doit refleter le changement
    } catch { load(); }
  };
  const restore = async (a) => {
    mark(a.key, false);
    setDis(ds => (ds || []).filter(d => d.key !== a.key));
    try {
      await client.delete(`/attention/dismiss/${encodeURIComponent(a.key)}`);
      load(); onChanged?.();
    } catch { load(); }
  };

  const iconBtn = (color) => ({ flexShrink:0, background:"none", border:"none",
    cursor:"pointer", color, fontSize:12, padding:"0 3px" });

  return createPortal(
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9999,
      background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center",
      justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:600,
        maxHeight:"88vh", display:"flex", flexDirection:"column",
        background:"var(--sheet-bg)", borderRadius:16, overflow:"hidden" }}>

        <div style={{ padding:"12px 16px 0", display:"flex", alignItems:"center", gap:10 }}>
          <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:0, flex:1 }}>
            Points d'attention
          </p>
          <button type="button" onClick={onClose}
            style={{ background:"none", border:"none", color:"var(--muted)",
              fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        {/* Deux onglets plutot que deux fenetres : elles affichaient deja les
            memes lignes, avec les memes filtres. */}
        <div style={{ display:"flex", gap:4, padding:"10px 16px 14px" }}>
          {[["all", "Toutes", (data?.alerts || []).filter(a => !a.dismissed).length],
            ["dismissed", "Ignorées", (dis || []).length]].map(([k, lbl, n]) => (
            <button key={k} type="button"
              onClick={() => { setTab(k); setCat(""); }}
              style={{ flex:1, padding:"7px 10px", borderRadius:8, border:"none",
                cursor:"pointer", fontSize:12, fontWeight:700,
                background: tab === k ? "#3b82f6" : "var(--surface2)",
                color: tab === k ? "white" : "var(--muted)" }}>
              {lbl} ({n})
            </button>
          ))}
        </div>

        {err && <p style={{ margin:0, padding:"0 16px 8px", fontSize:12, color:"#ef4444" }}>⚠ {err}</p>}

        <div style={{ padding:"0 16px 10px", display:"flex", flexDirection:"column", gap:8 }}>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Filtrer : nom, marque, matière…"
            style={{ width:"100%", boxSizing:"border-box", padding:"8px 12px", borderRadius:8,
              border:"1px solid var(--border)", background:"var(--surface2)",
              color:"var(--text)", fontSize:13, outline:"none" }}/>

          {/* Menu déroulant plutôt que des pastilles : avec dix catégories, elles
              occupaient trois lignes pour pas grand-chose. */}
          <select value={cat} onChange={e => setCat(e.target.value)}
            style={{ width:"100%", boxSizing:"border-box", padding:"8px 12px", borderRadius:8,
              border:"1px solid var(--border)", background:"var(--surface2)",
              color:"var(--text)", fontSize:13, outline:"none" }}>
            <option value="">Toutes les catégories ({source.length})</option>
            {catList.map(c => (
              <option key={c.category} value={c.category}>
                {c.icon} {c.label} ({counts[c.category]})
              </option>
            ))}
          </select>

        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"0 8px 12px" }}>
          {(tab === "all" ? !data : !dis) ? (
            <p style={{ fontSize:12, color:"var(--muted)", padding:12, margin:0 }}>Chargement…</p>
          ) : !shown.length ? (
            <p style={{ fontSize:12, color:"var(--muted)", padding:12, margin:0 }}>
              {source.length ? "Aucune alerte ne correspond."
                : tab === "all" ? "Aucune alerte." : "Aucune alerte ignorée."}
            </p>
          ) : shown.map(a => (
            <div key={a.key} style={{ display:"flex", alignItems:"center", gap:10,
              padding:"8px", borderRadius:8 }}>
              <div onClick={() => openAlert(a)}
                style={{ display:"flex", alignItems:"center", gap:10, flex:1, minWidth:0,
                  cursor: canOpen(a) ? "pointer" : "default" }}>
                <Dot a={a}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ margin:0, fontSize:12, fontWeight:600, color:"var(--text)",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {a.title}
                  </p>
                  {/* Marque et matiere manquaient : deux alertes sur le meme nom de
                      teinte etaient impossibles a distinguer. */}
                  <p style={{ margin:0, fontSize:10, color:"var(--muted)",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {[a.brand, a.material, a.detail].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p style={{ margin:0, fontSize:9, color:"var(--muted)", opacity:0.75,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {a.cat_icon || a.icon} {a.cat_label || a.label}
                  </p>
                </div>
              </div>
              {tab === "dismissed" ? (<>
                <span style={{ flexShrink:0, fontSize:10, fontWeight:700,
                  fontFamily:"JetBrains Mono,monospace",
                  color: a.forever ? "#ef4444" : a.expired ? "var(--muted)" : "#f59e0b" }}>
                  {fmtUntil(a)}
                </span>
                <AdminOnly><button type="button" onClick={() => restore(a)} title="Remettre en circulation"
                  style={iconBtn("var(--muted)")}>↩</button></AdminOnly>
              </>) : (<>
                {a.value && (
                  <span style={{ flexShrink:0, fontSize:10, fontWeight:700,
                    fontFamily:"JetBrains Mono,monospace",
                    color: a.severity === "warn" ? "#f59e0b" : "var(--muted)" }}>
                    {a.value}
                  </span>
                )}
                <AdminOnly><button type="button" onClick={() => dismiss(a, 7)} title="Ignorer 7 jours"
                  style={iconBtn("var(--muted)")}>7j</button>
                <button type="button" onClick={() => dismiss(a, null)} title="Ne plus jamais afficher"
                  style={iconBtn("#ef4444")}>✕</button></AdminOnly>
              </>)}
            </div>
          ))}
        </div>

        {tab === "dismissed" && !!(dis || []).length && (
          <div style={{ padding:"10px 16px", display:"flex", flexDirection:"column", gap:8 }}>
            {/* Le bouton restreint n'apparait que si un filtre est actif ET
                qu'il ne selectionne pas deja tout : sinon il ferait doublon
                avec celui d'en dessous. */}
            {shown.length > 0 && shown.length < (dis || []).length && (
              <AdminOnly><button type="button" disabled={busy} onClick={clearFiltered}
                style={{ width:"100%", padding:"9px", borderRadius:8, border:"none",
                  background:"rgba(59,130,246,0.12)", color:"#3b82f6",
                  fontSize:12, fontWeight:700, cursor:"pointer" }}>
                {busy ? "…" : `Remettre en circulation ces ${shown.length} alertes`}
              </button></AdminOnly>
            )}
            <AdminOnly><button type="button" disabled={busy} onClick={clearAll}
              style={{ width:"100%", padding:"9px", borderRadius:8, border:"none",
                background:"rgba(239,68,68,0.12)", color:"#ef4444",
                fontSize:12, fontWeight:700, cursor:"pointer" }}>
              {busy ? "…" : `Tout remettre en circulation (${(dis || []).length})`}
            </button></AdminOnly>
          </div>
        )}
      </div>

      {/* Fiches ouvertes par-dessus la liste — on ne perd pas ses filtres. */}
      {sheet?.kind === "filament" && (
        <FilamentSheet f={sheet.data} onClose={() => setSheet(null)}
          onDeleted={() => { setSheet(null); load(); onChanged?.(); }}
          onUpdated={() => { load(); onChanged?.(); }}/>
      )}
      {sheet?.kind === "spool" && (
        <FilamentSheetFromSpool filamentId={sheet.filamentId} spoolId={sheet.spoolId}
          filamentColorHex={sheet.hex}
          onClose={() => { setSheet(null); load(); onChanged?.(); }}/>
      )}
      {sheet?.kind === "print" && (
        <PrintDetail p={sheet.data} onClose={() => setSheet(null)}
          onDelete={() => { setSheet(null); load(); onChanged?.(); }}
          onChanged={() => { load(); onChanged?.(); }}/>
      )}
    </div>,
    document.body
  );
}
