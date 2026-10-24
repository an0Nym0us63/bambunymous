import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { mwCollections } from "../utils/mwSync";

// Ranger un modele dans mes collections MakerWorld : une case par collection,
// creation rapide. MakerWorld REMPLACE la liste a chaque enregistrement :
// si l'appli n'a pas su lire ou se trouve deja le modele, elle refuse
// d'enregistrer plutot que de le retirer des autres collections.
export default function MakerWorldCollectionsPicker({ designId, title, item, onClose, onSaved }) {
  const [data, setData] = useState(null);         // { collections, in, known } | { error }
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState(null);  // null = ferme
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = (check) => client.get(`/makerworld/design/${designId}/collections`).then(({ data }) => {
    setData(data);
    setSel(s => new Set([...(data.in || []), ...(check ? [check] : []), ...(check ? s : [])]));
  }).catch(e => setData({ error: e.response?.data?.detail || e.message }));
  useEffect(() => { load(); }, [designId]);

  const toggle = id => setSel(s => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const { data: r } = await client.post("/makerworld/collections", { title: newName });
      setNewName(null);
      await load(r.id);                            // la nouvelle collection arrive cochee
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await client.put(`/makerworld/design/${designId}/collections`, { ids: [...sel] });
      mwCollections(designId, [...sel], item);
      onSaved?.([...sel]); onClose();
    } catch (e) { setErr(e.response?.data?.detail || e.message); setBusy(false); }
  };

  const norm = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cols = (data?.collections || []).filter(c => !q.trim() || norm(c.title).includes(norm(q.trim())));
  const before = new Set(data?.in || []);
  const changed = data?.known && (sel.size !== before.size || [...sel].some(i => !before.has(i)));
  const btn = { padding:"10px 12px", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer",
    background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" };
  const nIn = sel.size;

  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4500, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"22px 22px 0 0", overflow:"hidden",
        width:"100%", maxWidth:480, maxHeight:"80dvh", display:"flex", flexDirection:"column",
        paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        {/* en-tete : l'etoile, le modele, combien de collections le contiennent */}
        <div style={{ padding:"16px 16px 12px", borderBottom:"1px solid var(--border)", background:"linear-gradient(135deg, rgba(20,184,166,0.22), transparent 70%)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ width:38, height:38, borderRadius:12, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:19,
              background:"linear-gradient(135deg, #14B8A6, #2DD4BF)", color:"#fff", boxShadow:"0 6px 16px -6px #14B8A6" }}>🔖</span>
            <span style={{ flex:1, minWidth:0 }}>
              <span style={{ display:"block", fontSize:16, fontWeight:900, color:"var(--text)" }}>Ranger dans mes collections</span>
              {title && <span style={{ display:"block", fontSize:12, fontWeight:700, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis",
                whiteSpace:"nowrap" }}>{title}</span>}
            </span>
            <button onClick={onClose} aria-label="Fermer" style={{ width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)", flexShrink:0,
              background:"var(--surface2)", color:"var(--text2)", fontSize:15, cursor:"pointer" }}>✕</button>
          </div>
          {(data?.collections?.length || 0) > 8 && (
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Chercher une collection…" autoComplete="off"
              style={{ width:"100%", boxSizing:"border-box", marginTop:12, height:40, padding:"0 14px", borderRadius:20, fontSize:13,
                background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
          )}
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"8px 12px", display:"flex", flexDirection:"column", gap:6 }}>
          {data === null ? <p style={msg}>Chargement…</p>
            : data.error ? <p style={{ ...msg, color:"#f59e0b" }}>{data.error}</p>
            : (<>
              {!data.known && (
                <p style={{ ...msg, color:"#f59e0b", borderRadius:14, border:"1px solid rgba(245,158,11,0.4)", background:"rgba(245,158,11,0.1)" }}>
                  Je n'arrive pas à lire dans quelles collections est déjà ce modèle :
                  enregistrer pourrait le retirer des autres, c'est donc bloqué.
                  {data.raw && <span style={{ display:"block", marginTop:6, fontFamily:"JetBrains Mono,monospace", fontSize:10.5,
                    color:"var(--muted)", wordBreak:"break-all" }}>Réponse de MakerWorld : {data.raw}</span>}</p>
              )}
              {cols.map(c => {
                const on = sel.has(c.id), was = before.has(c.id);
                return (
                  <label key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:14,
                    cursor: data.known ? "pointer" : "default", border:`1px solid ${on ? "rgba(245,158,11,0.5)" : "var(--border)"}`,
                    background: on ? "linear-gradient(135deg, rgba(245,158,11,0.14), transparent 70%), var(--surface2)" : "var(--surface2)" }}>
                    <input type="checkbox" checked={on} disabled={!data.known} onChange={() => toggle(c.id)} style={{ width:18, height:18, accentColor:"#F59E0B" }}/>
                    <span style={{ flex:1, minWidth:0, fontSize:13.5, fontWeight:800, color:"var(--text)" }}>📁 {c.title}</span>
                    {/* ce qui changera a l'enregistrement */}
                    {on !== was && <span style={{ fontSize:10.5, fontWeight:900, padding:"1px 7px", borderRadius:20,
                      color: on ? "#16a34a" : "#ef4444", background: on ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)" }}>{on ? "+ ajout" : "− retrait"}</span>}
                    {c.count != null && <span style={{ fontSize:11.5, fontWeight:800, color:"var(--muted)", padding:"1px 8px", borderRadius:20, background:"var(--surface)" }}>{c.count}</span>}
                  </label>);
              })}
            </>)}
        </div>
        <div style={{ padding:"10px 16px", borderTop:"1px solid var(--border)", display:"flex", flexDirection:"column", gap:8 }}>
          {newName === null ? (
            <button onClick={() => setNewName("")} disabled={busy || !data?.known} style={{ ...btn, background:"none", borderStyle:"dashed", color:"#F59E0B" }}>＋ Nouvelle collection</button>
          ) : (
            <div style={{ display:"flex", gap:6 }}>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nom de la collection" autoFocus
                maxLength={60} autoComplete="off" onKeyDown={e => { if (e.key === "Enter" && newName.trim()) create(); }}
                style={{ flex:1, minWidth:0, padding:"9px 12px", borderRadius:12, fontSize:13, background:"var(--surface2)",
                  border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
              <button onClick={() => setNewName(null)} aria-label="Annuler" style={btn}>✕</button>
              <button onClick={create} disabled={busy || !newName.trim()}
                style={{ ...btn, background:"linear-gradient(135deg, #F59E0B, #F97316)", border:"none", color:"white" }}>Créer</button>
            </div>
          )}
          {err && <div style={{ fontSize:12, fontWeight:700, color:"#ef4444" }}>{err}</div>}
          <button onClick={save} disabled={busy || !changed}
            style={{ ...btn, border:"none", color:"white", background: changed ? "linear-gradient(135deg, #F59E0B, #F97316)" : "var(--border)",
              boxShadow: changed ? "0 8px 18px -10px #F59E0B" : "none" }}>
            {busy ? "…" : changed ? `Enregistrer · ${nIn} collection${nIn > 1 ? "s" : ""}` : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const msg = { fontSize:12.5, color:"var(--muted)", padding:"12px 8px", margin:0, lineHeight:1.5 };
