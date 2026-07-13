import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { colorBg, parseColorsList } from "../utils/colors";

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

export default function AllAlertsModal({ onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [cat, setCat]   = useState("");
  const [q, setQ]       = useState("");
  const [showDis, setShowDis] = useState(false);
  const [err, setErr]   = useState(null);

  const load = () => {
    setErr(null);
    client.get("/attention/all")
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.detail || e.message));
  };
  useEffect(load, []);

  const alerts = data?.alerts || [];
  const visible = alerts.filter(a => showDis || !a.dismissed);

  const counts = {};
  visible.forEach(a => { counts[a.category] = (counts[a.category] || 0) + 1; });

  const shown = visible.filter(a => {
    if (cat && a.category !== cat) return false;
    if (!q.trim()) return true;
    const hay = [a.title, a.brand, a.material, a.detail, a.value, a.cat_label]
      .filter(Boolean).join(" ").toLowerCase();
    return q.trim().toLowerCase().split(/\s+/).every(w => hay.includes(w));
  });

  const mark = (key, dismissed) =>
    setData(d => ({ ...d, alerts: d.alerts.map(x =>
      x.key === key ? { ...x, dismissed } : x) }));

  const dismiss = async (a, days) => {
    mark(a.key, true);
    try { await client.post("/attention/dismiss", { key: a.key, days: days ?? null }); onChanged?.(); }
    catch { load(); }
  };
  const restore = async (a) => {
    mark(a.key, false);
    try { await client.delete(`/attention/dismiss/${encodeURIComponent(a.key)}`); onChanged?.(); }
    catch { load(); }
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

        <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", gap:10 }}>
          <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:0, flex:1 }}>
            Alertes ({shown.length})
          </p>
          <button type="button" onClick={onClose}
            style={{ background:"none", border:"none", color:"var(--muted)",
              fontSize:18, cursor:"pointer" }}>✕</button>
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
            <option value="">Toutes les catégories ({visible.length})</option>
            {(data?.categories || [])
              .filter(c => counts[c.category])
              .map(c => (
                <option key={c.category} value={c.category}>
                  {c.icon} {c.label} ({counts[c.category]})
                </option>
              ))}
          </select>

          <label style={{ display:"flex", alignItems:"center", gap:6,
            fontSize:11, color:"var(--muted)", cursor:"pointer" }}>
            <input type="checkbox" checked={showDis}
              onChange={e => setShowDis(e.target.checked)}/>
            Afficher aussi les alertes ignorées
          </label>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"0 8px 12px" }}>
          {!data ? (
            <p style={{ fontSize:12, color:"var(--muted)", padding:12, margin:0 }}>Chargement…</p>
          ) : !shown.length ? (
            <p style={{ fontSize:12, color:"var(--muted)", padding:12, margin:0 }}>Aucune alerte.</p>
          ) : shown.map(a => (
            <div key={a.key} style={{ display:"flex", alignItems:"center", gap:10,
              padding:"8px", borderRadius:8, opacity: a.dismissed ? 0.45 : 1 }}>
              <Dot a={a}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ margin:0, fontSize:12, fontWeight:600, color:"var(--text)",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {a.title}
                </p>
                <p style={{ margin:0, fontSize:10, color:"var(--muted)",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {a.cat_icon} {a.cat_label}
                  {a.brand ? ` · ${a.brand}` : ""}{a.detail ? ` · ${a.detail}` : ""}
                </p>
              </div>
              {a.value && (
                <span style={{ flexShrink:0, fontSize:10, fontWeight:700,
                  fontFamily:"JetBrains Mono,monospace",
                  color: a.severity === "warn" ? "#f59e0b" : "var(--muted)" }}>
                  {a.value}
                </span>
              )}
              {a.dismissed ? (
                <button type="button" onClick={() => restore(a)} title="Remettre en circulation"
                  style={iconBtn("var(--muted)")}>↩</button>
              ) : (<>
                <button type="button" onClick={() => dismiss(a, 7)} title="Ignorer 7 jours"
                  style={iconBtn("var(--muted)")}>7j</button>
                <button type="button" onClick={() => dismiss(a, null)} title="Ne plus jamais afficher"
                  style={iconBtn("#ef4444")}>✕</button>
              </>)}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
