import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";

// Ranger un modele dans mes collections MakerWorld : une case par collection,
// creation rapide. MakerWorld REMPLACE la liste a chaque enregistrement :
// si l'appli n'a pas su lire ou se trouve deja le modele, elle refuse
// d'enregistrer plutot que de le retirer des autres collections.
export default function MakerWorldCollectionsPicker({ designId, title, onClose, onSaved }) {
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
      onSaved?.([...sel]); onClose();
    } catch (e) { setErr(e.response?.data?.detail || e.message); setBusy(false); }
  };

  const norm = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cols = (data?.collections || []).filter(c => !q.trim() || norm(c.title).includes(norm(q.trim())));
  const before = new Set(data?.in || []);
  const changed = data?.known && (sel.size !== before.size || [...sel].some(i => !before.has(i)));
  const btn = { padding:"8px 12px", borderRadius:10, fontSize:12.5, fontWeight:600, cursor:"pointer",
    background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" };

  return createPortal(
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4500, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:480, maxHeight:"80dvh", display:"flex", flexDirection:"column",
        paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        <div style={{ padding:"14px 16px 10px", borderBottom:"1px solid var(--border)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <h3 style={{ flex:1, minWidth:0, fontSize:15, fontWeight:800, color:"var(--text)", margin:0 }}>Ranger dans mes collections</h3>
            <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", fontSize:18, cursor:"pointer" }}>✕</button>
          </div>
          {title && <div style={{ fontSize:12, color:"var(--muted)", marginTop:2, overflow:"hidden", textOverflow:"ellipsis",
            whiteSpace:"nowrap" }}>{title}</div>}
          {(data?.collections?.length || 0) > 8 && (
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher une collection…" autoComplete="off"
              style={{ width:"100%", boxSizing:"border-box", marginTop:10, padding:"7px 10px", borderRadius:10, fontSize:13,
                background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
          )}
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"6px 8px" }}>
          {data === null ? <p style={msg}>Chargement…</p>
            : data.error ? <p style={{ ...msg, color:"#f59e0b" }}>{data.error}</p>
            : (<>
              {!data.known && (
                <p style={{ ...msg, color:"#f59e0b" }}>Je n'arrive pas à lire dans quelles collections est déjà ce modèle :
                  enregistrer pourrait le retirer des autres, c'est donc bloqué. (Diagnostic : essais_appartenance.)</p>
              )}
              {cols.map(c => (
                <label key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px", borderRadius:10,
                  cursor: data.known ? "pointer" : "default", background: sel.has(c.id) ? "rgba(59,130,246,0.08)" : "none" }}>
                  <input type="checkbox" checked={sel.has(c.id)} disabled={!data.known} onChange={() => toggle(c.id)}/>
                  <span style={{ flex:1, fontSize:13, color:"var(--text)" }}>{c.title}</span>
                  {c.count != null && <span style={{ fontSize:11, color:"var(--muted)" }}>{c.count}</span>}
                </label>
              ))}
            </>)}
        </div>
        <div style={{ padding:"10px 16px", borderTop:"1px solid var(--border)", display:"flex", flexDirection:"column", gap:8 }}>
          {newName === null ? (
            <button onClick={() => setNewName("")} disabled={busy || !data?.known} style={{ ...btn, background:"none" }}>+ Nouvelle collection</button>
          ) : (
            <div style={{ display:"flex", gap:6 }}>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nom de la collection" autoFocus
                maxLength={60} autoComplete="off" onKeyDown={e => { if (e.key === "Enter" && newName.trim()) create(); }}
                style={{ flex:1, minWidth:0, padding:"8px 10px", borderRadius:10, fontSize:13, background:"var(--surface2)",
                  border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
              <button onClick={() => setNewName(null)} style={btn}>✕</button>
              <button onClick={create} disabled={busy || !newName.trim()}
                style={{ ...btn, background:"#3b82f6", border:"none", color:"white", fontWeight:700 }}>Créer</button>
            </div>
          )}
          {err && <div style={{ fontSize:12, color:"#ef4444" }}>{err}</div>}
          <button onClick={save} disabled={busy || !changed}
            style={{ ...btn, background: changed ? "#3b82f6" : "var(--border)", border:"none", color:"white", fontWeight:700 }}>
            {busy ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const msg = { fontSize:12.5, color:"var(--muted)", padding:"12px 8px", margin:0, lineHeight:1.5 };
