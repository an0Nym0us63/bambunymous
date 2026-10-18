import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";

// Mes modeles MakerWorld (compte connecte dans les Parametres) : j'aime et
// favoris, chacun avec « deja imprime N fois » ou « jamais imprime », croise
// avec l'historique. Lecture seule. Si l'API ne repond plus, la fenetre le
// dit et rien d'autre n'est touche.
const TABS = [["favorites", "Favoris"], ["likes", "J'aime"]];

export default function MakerWorldSheet({ onClose, onSearch }) {
  const [tab, setTab] = useState("favorites");
  const [data, setData] = useState(null);       // { items, pending } | { error }
  const [onlyNew, setOnlyNew] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    client.get("/makerworld/status").then(({ data }) => setStatus(data)).catch(() => setStatus({}));
  }, []);

  useEffect(() => {
    if (!status?.connected) return;
    let alive = true, timer = null;
    const load = (again) => client.get(`/makerworld/collection/${tab}`).then(({ data }) => {
      if (!alive) return;
      setData(data);
      // Modeles pas encore en cache : lus en arriere-plan, on recharge une fois.
      if (data.pending && again) timer = setTimeout(() => load(false), 8000);
    }).catch(e => alive && setData({ error: e.response?.data?.detail || e.message }));
    setData(null);
    load(true);
    return () => { alive = false; clearTimeout(timer); };
  }, [tab, status?.connected]);

  const items = (data?.items || []).filter(x => !onlyNew || !x.printed);
  const nNew = (data?.items || []).filter(x => !x.printed).length;

  return createPortal(
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4000, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:640, height:"85dvh", display:"flex", flexDirection:"column",
        paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        <div style={{ padding:"14px 16px 8px", borderBottom:"1px solid var(--border)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <h3 style={{ flex:1, fontSize:15, fontWeight:800, color:"var(--text)", margin:0 }}>Mes modèles MakerWorld</h3>
            <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)",
              fontSize:18, cursor:"pointer" }}>✕</button>
          </div>
          {status?.connected && (
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:10, flexWrap:"wrap" }}>
              {TABS.map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)}
                  style={{ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer",
                    background: tab === k ? "#3b82f6" : "var(--surface2)", color: tab === k ? "white" : "var(--muted)",
                    border: tab === k ? "none" : "1px solid var(--border)" }}>{l}</button>
              ))}
              <label style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6, fontSize:12,
                color:"var(--text2)", cursor:"pointer" }}>
                <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)}/>
                Jamais imprimés{data?.items ? ` (${nNew})` : ""}
              </label>
            </div>
          )}
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"10px 16px 16px" }}>
          {status === null ? <p style={msg}>…</p>
            : !status.connected ? (
              <p style={msg}>Connecte ton compte MakerWorld dans <b>Paramètres → Données → MakerWorld</b> pour voir
                tes favoris et tes j'aime ici.</p>
            ) : data === null ? <p style={msg}>Chargement…</p>
            : data.error ? <p style={{ ...msg, color:"#f59e0b" }}>MakerWorld ne répond pas comme prévu : {data.error}</p>
            : items.length === 0 ? <p style={msg}>{onlyNew ? "Tout a déjà été imprimé 🎉" : "Rien dans cette liste."}</p>
            : (<>
              {data.pending > 0 && (
                <p style={{ ...msg, padding:"0 0 8px" }}>{data.pending} modèle{data.pending > 1 ? "s" : ""} en cours de lecture…</p>
              )}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
                {items.map(x => (
                  <div key={x.design_id} style={{ borderRadius:12, border:"1px solid var(--border)",
                    background:"var(--surface2)", overflow:"hidden", display:"flex", flexDirection:"column" }}>
                    <a href={x.url} target="_blank" rel="noopener noreferrer" style={{ display:"block" }}>
                      {x.cover_url
                        ? <img src={x.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer"
                            style={{ width:"100%", aspectRatio:"1", objectFit:"cover", display:"block", background:"var(--surface)" }}/>
                        : <div style={{ width:"100%", aspectRatio:"1", background:"var(--surface)" }}/>}
                    </a>
                    <div style={{ padding:"7px 8px 8px", display:"flex", flexDirection:"column", gap:4, flex:1 }}>
                      <a href={x.url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize:12, fontWeight:700, color:"var(--text)", textDecoration:"none", lineHeight:1.3,
                          overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                        {x.title || `Modèle ${x.design_id}`}
                      </a>
                      {x.creator_name && <span style={{ fontSize:10.5, color:"var(--muted)" }}>par {x.creator_name}</span>}
                      <div style={{ marginTop:"auto" }}>
                        {x.printed > 0 ? (
                          <button onClick={() => onSearch?.(x)} title="Voir ces prints dans l'historique"
                            style={{ fontSize:11, fontWeight:700, color:"#22c55e", background:"rgba(34,197,94,0.1)",
                              border:"none", borderRadius:20, padding:"2px 8px", cursor:"pointer" }}>
                            ✓ imprimé {x.printed} fois
                          </button>
                        ) : (
                          <span style={{ fontSize:11, color:"var(--muted)" }}>jamais imprimé</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>)}
        </div>
      </div>
    </div>,
    document.body
  );
}

const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
