import React, { useEffect, useState } from "react";
import client from "../api/client";

// Onglet MakerWorld de l'Historique (compte connecte dans les Parametres) : collections
// de favoris puis leurs modeles, et modeles aimes ; chacun avec « deja
// imprime N fois » ou « jamais imprime », croise avec l'historique. Lecture
// seule. Si l'API ne repond plus, la fenetre le dit et rien d'autre n'est touche.
// La recherche MakerWorld est publique : elle marche sans compte.
const TABS = [["favorites", "Collections"], ["likes", "J'aime"], ["search", "Recherche"]];

export default function MakerWorldView({ onSearch }) {
  const [tab, setTab] = useState("favorites");
  const [coll, setColl] = useState(null);          // collection ouverte { id, title }
  const [data, setData] = useState(null);          // { items } | { collections } | { error }
  const [onlyNew, setOnlyNew] = useState(false);
  const [status, setStatus] = useState(null);
  const [q, setQ] = useState("");                  // saisie de recherche
  const [sq, setSq] = useState("");                // recherche lancee
  const [more, setMore] = useState(false);         // page suivante en cours

  useEffect(() => {
    client.get("/makerworld/status").then(({ data }) => setStatus(data)).catch(() => setStatus({}));
  }, []);

  useEffect(() => {
    if (tab === "search") {
      if (!sq) { setData({ items: [] }); return; }
      let alive = true;
      setData(null);
      client.get("/makerworld/search", { params: { q: sq } })
        .then(({ data }) => alive && setData(data))
        .catch(e => alive && setData({ error: e.response?.data?.detail || e.message }));
      return () => { alive = false; };
    }
    if (!status?.connected) return;
    let alive = true, timer = null;
    const url = tab === "likes" ? "/makerworld/collection/likes"
      : coll ? `/makerworld/collections/${coll.id}` : "/makerworld/collections";
    const load = (again) => client.get(url).then(({ data }) => {
      if (!alive) return;
      setData(data);
      // Modeles sans fiche : lus en arriere-plan, on recharge une fois.
      if (data.pending && again) timer = setTimeout(() => load(false), 8000);
    }).catch(e => alive && setData({ error: e.response?.data?.detail || e.message }));
    setData(null);
    load(true);
    return () => { alive = false; clearTimeout(timer); };
  }, [tab, coll?.id, status?.connected, sq]);

  const loadMore = () => {
    setMore(true);
    client.get("/makerworld/search", { params: { q: sq, offset: data.items.length } })
      .then(({ data: d }) => setData(prev => ({ ...prev, items: [...prev.items,
        ...(d.items || []).filter(x => !prev.items.some(y => y.design_id === x.design_id))] })))
      .catch(() => {}).finally(() => setMore(false));
  };

  const showModels = tab !== "favorites" || !!coll;
  const items = (data?.items || []).filter(x => !onlyNew || !x.printed);
  const nNew = (data?.items || []).filter(x => !x.printed).length;

  return (
      <div style={{ display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"2px 0 8px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {coll && tab === "favorites" && (
              <button onClick={() => setColl(null)} title="Toutes les collections"
                style={{ background:"none", border:"none", color:"var(--text)", fontSize:18, cursor:"pointer", padding:"0 4px 0 0" }}>‹</button>
            )}
            {coll && tab === "favorites" && (
              <h3 style={{ flex:1, minWidth:0, fontSize:15, fontWeight:800, color:"var(--text)", margin:0,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{coll.title}</h3>
            )}
          </div>
          {status && (
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:10, flexWrap:"wrap" }}>
              {TABS.map(([k, l]) => (
                <button key={k} onClick={() => { setTab(k); if (k !== "favorites") setColl(null); }}
                  style={{ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer",
                    background: tab === k ? "#3b82f6" : "var(--surface2)", color: tab === k ? "white" : "var(--muted)",
                    border: tab === k ? "none" : "1px solid var(--border)" }}>{l}</button>
              ))}
              {showModels && (
                <label style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6, fontSize:12,
                  color:"var(--text2)", cursor:"pointer" }}>
                  <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)}/>
                  Jamais imprimés{data?.items ? ` (${nNew})` : ""}
                </label>
              )}
            </div>
          )}
          {tab === "search" && (
            <form onSubmit={e => { e.preventDefault(); setSq(q.trim()); }}
              style={{ display:"flex", gap:6, marginTop:10 }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher sur MakerWorld…"
                autoComplete="off" enterKeyHint="search"
                style={{ flex:1, minWidth:0, padding:"8px 10px", borderRadius:10, fontSize:13,
                  background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
              <button type="submit" disabled={!q.trim()}
                style={{ padding:"8px 14px", borderRadius:10, fontSize:12, fontWeight:700, border:"none",
                  background:"#3b82f6", color:"white", cursor:"pointer" }}>Chercher</button>
            </form>
          )}
        </div>

        <div style={{ padding:"4px 0 16px" }}>
          {status === null ? <p style={msg}>…</p>
            : tab === "search" && !sq ? <p style={msg}>Cherche un modèle sur MakerWorld : ceux que tu as déjà imprimés sont signalés.</p>
            : tab !== "search" && !status.connected ? (
              <p style={msg}>Connecte ton compte MakerWorld dans <b>Paramètres → Données → MakerWorld</b> pour voir
                tes collections et tes j'aime ici.</p>
            ) : data === null ? <p style={msg}>Chargement…</p>
            : data.error ? <p style={{ ...msg, color:"#f59e0b" }}>MakerWorld ne répond pas comme prévu : {data.error}</p>
            : !showModels ? (
              (data.collections || []).length === 0 ? <p style={msg}>Aucune collection.</p> : (
                <div style={grid}>
                  {data.collections.map(c => (
                    <button key={c.id} onClick={() => setColl(c)}
                      style={{ ...card, cursor:"pointer", padding:0, textAlign:"left", color:"var(--text)" }}>
                      <Mosaic covers={c.covers}/>
                      <div style={{ padding:"7px 8px 8px" }}>
                        <div style={{ fontSize:12.5, fontWeight:700 }}>{c.title}</div>
                        {c.count != null && <div style={{ fontSize:10.5, color:"var(--muted)" }}>{c.count} modèle{c.count > 1 ? "s" : ""}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : items.length === 0 ? <p style={msg}>{onlyNew ? "Tout a déjà été imprimé 🎉"
                : tab === "search" ? "Aucun résultat." : "Rien dans cette liste."}</p>
            : (<>
              {data.pending > 0 && (
                <p style={{ ...msg, padding:"0 0 8px" }}>{data.pending} modèle{data.pending > 1 ? "s" : ""} en cours de lecture…</p>
              )}
              <div style={grid}>
                {items.map(x => (
                  <div key={x.design_id} style={card}>
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
              {tab === "search" && data.total > data.items.length && (
                <button onClick={loadMore} disabled={more}
                  style={{ display:"block", margin:"14px auto 0", padding:"8px 18px", borderRadius:10, fontSize:12,
                    fontWeight:700, cursor:"pointer", background:"var(--surface2)", border:"1px solid var(--border)",
                    color:"var(--text)" }}>{more ? "…" : `Plus de résultats (${data.items.length} / ${data.total})`}</button>
              )}
            </>)}
        </div>
      </div>
  );
}

// Couverture d'une collection : jusqu'a 4 modeles en mosaique.
function Mosaic({ covers = [] }) {
  const c = covers.slice(0, 4);
  if (!c.length) return <div style={{ width:"100%", aspectRatio:"1", background:"var(--surface)" }}/>;
  return (
    // Carre fixe quoi qu'il arrive : sans minHeight/minWidth a 0, une image
    // haute etirait sa rangee et la tuile depassait ses voisines.
    <div style={{ width:"100%", aspectRatio:"1", display:"grid", gap:1, background:"var(--border)", overflow:"hidden",
      gridTemplateColumns: c.length > 1 ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)",
      gridTemplateRows: c.length > 2 ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)" }}>
      {c.map((u, i) => (
        <img key={i} src={u} alt="" loading="lazy" referrerPolicy="no-referrer"
          style={{ width:"100%", height:"100%", minWidth:0, minHeight:0, objectFit:"cover", display:"block",
            background:"var(--surface)", gridRow: c.length === 3 && i === 0 ? "span 2" : undefined }}/>
      ))}
    </div>
  );
}

const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
const grid = { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 };
const card = { borderRadius:12, border:"1px solid var(--border)", background:"var(--surface2)",
  overflow:"hidden", display:"flex", flexDirection:"column" };
