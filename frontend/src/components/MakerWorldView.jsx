import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import AdminOnly from "./AdminOnly";
import { showAlert, showConfirm } from "../utils/dialog";
import MakerWorldCollectionsPicker from "./MakerWorldCollectionsPicker";

// Onglet MakerWorld de l'Historique (compte connecte dans les Parametres) : collections
// de favoris puis leurs modeles, et modeles aimes ; chacun avec « deja
// imprime N fois » ou « jamais imprime », croise avec l'historique. Lecture
// seule. Si l'API ne repond plus, la fenetre le dit et rien d'autre n'est touche.
// La recherche MakerWorld est publique : elle marche sans compte.
const TABS = [["favorites", "Collections"], ["likes", "J'aime"], ["following", "Suivis"], ["search", "Recherche"]];
// « Il y a 3 j » : date de publication (Suivis).
const ago = iso => {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (!(d >= 0)) return null;
  return d < 1 ? "aujourd'hui" : d < 2 ? "hier" : d < 31 ? `il y a ${Math.floor(d)} j`
    : d < 365 ? `il y a ${Math.floor(d / 30)} mois` : `il y a ${Math.floor(d / 365)} an${d >= 730 ? "s" : ""}`;
};
const FILTERS = [["all", "Tous"], ["printed", "Déjà imprimés"], ["new", "Jamais imprimés"]];

export default function MakerWorldView({ onSearch }) {
  const [tab, setTab] = useState("favorites");
  const [coll, setColl] = useState(null);          // collection ouverte { id, title }
  const [data, setData] = useState(null);          // { items } | { collections } | { error }
  const [pf, setPf] = useState("all");           // tous / deja imprimes / jamais imprimes
  const [creators, setCreators] = useState(null);  // Suivis : createurs suivis (liste du profil)
  const [picked, setPicked] = useState([]);        // Suivis : createurs choisis (vide = tous)
  const [picker, setPicker] = useState(false);     // Suivis : fenetre de choix des createurs
  const [progress, setProgress] = useState(null);  // Suivis : { done, total } pendant le chargement
  const [pickFor, setPickFor] = useState(null);    // modele a ranger dans mes collections
  const [reload, setReload] = useState(0);         // relecture apres une ecriture
  const [nameEdit, setNameEdit] = useState(null);  // { mode: "new"|"rename", value }
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
    if (tab === "following") {
      // Par lots de 20 createurs : les premiers modeles s'affichent tout de
      // suite, la suite se complete (250 suivis ne font pas attendre).
      setData(null); setProgress(null);
      (async () => {
        try {
          let list = creators;
          if (!list) {
            list = (await client.get("/makerworld/following/creators")).data.creators || [];
            if (!alive) return;
            setCreators(list);
          }
          const target = picked.length ? picked : list.map(c => c.uid);
          const per = target.length <= 5 ? 40 : 12;
          let acc = [];
          setProgress({ done: 0, total: target.length });
          if (!target.length) { setData({ items: [] }); return; }
          for (let i = 0; i < target.length && alive; i += 20) {
            const { data: d } = await client.get("/makerworld/following",
              { params: { uids: target.slice(i, i + 20).join(","), per } });
            if (!alive) return;
            const seen = new Set(acc.map(x => x.design_id));
            acc = [...acc, ...(d.items || []).filter(x => !seen.has(x.design_id))]
              .sort((a, b) => (b.published || "").localeCompare(a.published || ""));
            setData({ items: acc });
            setProgress({ done: Math.min(i + 20, target.length), total: target.length });
          }
        } catch (e) { alive && setData({ error: e.response?.data?.detail || e.message }); }
      })();
      return () => { alive = false; };
    }
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
  }, [tab, coll?.id, status?.connected, sq, picked.join(","), reload]);

  const loadMore = () => {
    setMore(true);
    client.get("/makerworld/search", { params: { q: sq, offset: data.items.length } })
      .then(({ data: d }) => setData(prev => ({ ...prev, items: [...prev.items,
        ...(d.items || []).filter(x => !prev.items.some(y => y.design_id === x.design_id))] })))
      .catch(() => {}).finally(() => setMore(false));
  };

  const saveName = async () => {
    const v = (nameEdit?.value || "").trim();
    if (!v) return;
    try {
      if (nameEdit.mode === "new") await client.post("/makerworld/collections", { title: v });
      else { await client.put(`/makerworld/collections/${coll.id}`, { title: v }); setColl(c => ({ ...c, title: v })); }
      setNameEdit(null); setReload(n => n + 1);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const delColl = async () => {
    if (!(await showConfirm(`Supprimer la collection « ${coll.title} » sur MakerWorld ? Les modèles, eux, restent.`,
      { danger: true, confirmLabel: "Supprimer" }))) return;
    try { await client.delete(`/makerworld/collections/${coll.id}`); setColl(null); setReload(n => n + 1); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };

  const showModels = tab !== "favorites" || !!coll;
  const all = data?.items || [];
  const items = all.filter(x => pf === "all" || (pf === "new" ? !x.printed : x.printed > 0));
  const count = { all: all.length, printed: all.filter(x => x.printed > 0).length, new: all.filter(x => !x.printed).length };

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
            {coll && tab === "favorites" && status?.connected && (
              <AdminOnly>
                <button onClick={() => setNameEdit({ mode: "rename", value: coll.title })} title="Renommer"
                  style={iconBtn}>✎</button>
                <button onClick={delColl} title="Supprimer la collection" style={{ ...iconBtn, color:"#ef4444" }}>🗑</button>
              </AdminOnly>
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
                <select value={pf} onChange={e => setPf(e.target.value)}
                  style={{ marginLeft:"auto", fontSize:12, padding:"4px 8px", borderRadius:8, background:"var(--surface2)",
                    border:"1px solid var(--border)", color:"var(--text2)" }}>
                  {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}{data?.items ? ` (${count[k]})` : ""}</option>)}
                </select>
              )}
            </div>
          )}
          {nameEdit && (
            <div style={{ display:"flex", gap:6, marginTop:10 }}>
              <input value={nameEdit.value} onChange={e => setNameEdit(n => ({ ...n, value: e.target.value }))} autoFocus
                maxLength={60} autoComplete="off" placeholder={nameEdit.mode === "new" ? "Nom de la nouvelle collection" : "Nouveau nom"}
                onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setNameEdit(null); }}
                style={{ flex:1, minWidth:0, padding:"8px 10px", borderRadius:10, fontSize:13, background:"var(--surface2)",
                  border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
              <button onClick={() => setNameEdit(null)} style={iconBtn}>✕</button>
              <button onClick={saveName} disabled={!nameEdit.value.trim()}
                style={{ padding:"8px 14px", borderRadius:10, fontSize:12, fontWeight:700, border:"none",
                  background:"#3b82f6", color:"white", cursor:"pointer" }}>{nameEdit.mode === "new" ? "Créer" : "Renommer"}</button>
            </div>
          )}
          {tab === "following" && creators && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, flexWrap:"wrap" }}>
              <button onClick={() => setPicker(true)}
                style={{ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
                  background: picked.length ? "rgba(59,130,246,0.15)" : "var(--surface2)",
                  color: picked.length ? "#3b82f6" : "var(--text2)",
                  border: picked.length ? "1px solid #3b82f6" : "1px solid var(--border)" }}>
                👤 {picked.length ? `${picked.length} créateur${picked.length > 1 ? "s" : ""}` : `Tous les créateurs (${creators.length})`}
              </button>
              {picked.length > 0 && (
                <button onClick={() => setPicked([])} title="Tous les créateurs"
                  style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:13 }}>✕</button>
              )}
              {progress && progress.done < progress.total && (
                <span style={{ fontSize:11.5, color:"#3b82f6" }}>Chargement {progress.done} / {progress.total} créateurs…</span>
              )}
            </div>
          )}
          {picker && creators && (
            <CreatorPicker creators={creators} picked={picked}
              onClose={() => setPicker(false)} onApply={ids => { setPicked(ids); setPicker(false); }}/>
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

        {pickFor && (
          <MakerWorldCollectionsPicker designId={pickFor.design_id} title={pickFor.title}
            onClose={() => setPickFor(null)} onSaved={() => tab === "favorites" && setReload(n => n + 1)}/>
        )}
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
                  <AdminOnly>
                    <button onClick={() => setNameEdit({ mode: "new", value: "" })}
                      style={{ ...card, cursor:"pointer", alignItems:"center", justifyContent:"center", minHeight:120,
                        border:"1.5px dashed var(--border)", color:"var(--muted)", fontSize:13, fontWeight:600 }}>
                      <span style={{ fontSize:26, lineHeight:1 }}>+</span>Nouvelle collection
                    </button>
                  </AdminOnly>
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
            ) : items.length === 0 ? <p style={msg}>{pf === "new" && all.length ? "Tout a déjà été imprimé 🎉"
                : pf === "printed" && all.length ? "Aucun n'a encore été imprimé."
                : tab === "search" ? "Aucun résultat."
                : tab === "following" ? "Aucun modèle (ou aucun créateur suivi)." : "Rien dans cette liste."}</p>
            : (<>
              {data.pending > 0 && (
                <p style={{ ...msg, padding:"0 0 8px" }}>{data.pending} modèle{data.pending > 1 ? "s" : ""} en cours de lecture…</p>
              )}
              <div style={grid}>
                {items.map(x => (
                  <div key={x.design_id} style={{ ...card, ...(x.printed > 0 ? printedCard : null) }}>
                    <a href={x.url} target="_blank" rel="noopener noreferrer" style={{ display:"block", position:"relative" }}>
                      {x.cover_url
                        ? <img src={x.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer"
                            style={{ width:"100%", aspectRatio:"1", objectFit:"cover", display:"block", background:"var(--surface)" }}/>
                        : <div style={{ width:"100%", aspectRatio:"1", background:"var(--surface)" }}/>}
                      {x.printed > 0 && <span style={ribbon("#22c55e")}>✓ IMPRIMÉ</span>}
                      {!x.printed && x.in_progress > 0 && <span style={ribbon("#f59e0b")}>EN COURS</span>}
                    </a>
                    <div style={{ padding:"7px 8px 8px", display:"flex", flexDirection:"column", gap:4, flex:1 }}>
                      <a href={x.url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize:12, fontWeight:700, color:"var(--text)", textDecoration:"none", lineHeight:1.3,
                          overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                        {x.title || `Modèle ${x.design_id}`}
                      </a>
                      {x.creator_name && <span style={{ fontSize:10.5, color:"var(--muted)" }}>par {x.creator_name}
                        {x.published && ago(x.published) ? ` · ${ago(x.published)}` : ""}</span>}
                      <div style={{ marginTop:"auto" }}>
                        {x.printed > 0 ? (
                          <button onClick={() => onSearch?.(x)} title="Voir ces prints dans l'historique"
                            style={{ fontSize:11, fontWeight:700, color:"#22c55e", background:"rgba(34,197,94,0.12)",
                              border:"none", borderRadius:20, padding:"2px 8px", cursor:"pointer", textAlign:"left" }}>
                            {printedLabel(x)}
                          </button>
                        ) : x.in_progress > 0 ? (
                          <span style={{ fontSize:11, fontWeight:600, color:"#f59e0b" }}>⏳ en cours d'impression</span>
                        ) : (
                          <span style={{ fontSize:11, color:"var(--muted)" }}>jamais imprimé</span>
                        )}
                        {status?.connected && (
                          <AdminOnly>
                            <button onClick={() => setPickFor(x)} title="Ranger dans mes collections"
                              style={{ display:"block", marginTop:5, fontSize:11, fontWeight:600, color:"#3b82f6", background:"none",
                                border:"none", padding:0, cursor:"pointer" }}>☆ Collections</button>
                          </AdminOnly>
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

// Choix des createurs suivis : recherche dynamique (nom ou pseudo qui
// contient le texte, sans tenir compte des accents), cases a cocher.
const norm = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function CreatorPicker({ creators, picked, onClose, onApply }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(new Set(picked));
  const n = norm(q.trim());
  const shown = creators.filter(c => !n || norm(c.name).includes(n) || norm(c.handle).includes(n));
  const toggle = uid => setSel(s => { const x = new Set(s); x.has(uid) ? x.delete(uid) : x.add(uid); return x; });
  return createPortal(
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4000, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:520, height:"80dvh", display:"flex", flexDirection:"column",
        paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        <div style={{ padding:"14px 16px 10px", borderBottom:"1px solid var(--border)" }}>
          <div style={{ display:"flex", alignItems:"center", marginBottom:10 }}>
            <h3 style={{ flex:1, fontSize:15, fontWeight:800, color:"var(--text)", margin:0 }}>
              Créateurs suivis <span style={{ color:"var(--muted)", fontWeight:500 }}>({creators.length})</span></h3>
            <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", fontSize:18, cursor:"pointer" }}>✕</button>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un créateur…" autoFocus
            autoComplete="off" style={{ width:"100%", boxSizing:"border-box", padding:"8px 10px", borderRadius:10, fontSize:13,
              background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"4px 8px" }}>
          {shown.length === 0 && <p style={msg}>Aucun créateur ne correspond.</p>}
          {shown.map(c => (
            <label key={c.uid} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 8px",
              borderRadius:10, cursor:"pointer", background: sel.has(c.uid) ? "rgba(59,130,246,0.08)" : "none" }}>
              <input type="checkbox" checked={sel.has(c.uid)} onChange={() => toggle(c.uid)}/>
              {c.avatar ? <img src={c.avatar} alt="" loading="lazy" referrerPolicy="no-referrer"
                style={{ width:28, height:28, borderRadius:"50%", flexShrink:0 }}/>
                : <span style={{ width:28, height:28, borderRadius:"50%", background:"var(--surface2)", flexShrink:0 }}/>}
              <span style={{ minWidth:0, flex:1 }}>
                <span style={{ display:"block", fontSize:13, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis",
                  whiteSpace:"nowrap" }}>{c.name || c.handle}</span>
                {c.handle && <span style={{ fontSize:11, color:"var(--muted)" }}>@{c.handle}</span>}
              </span>
            </label>
          ))}
        </div>
        <div style={{ display:"flex", gap:8, padding:"10px 16px", borderTop:"1px solid var(--border)" }}>
          <button onClick={() => setSel(new Set())}
            style={{ flex:1, padding:9, borderRadius:10, fontSize:12.5, fontWeight:600, cursor:"pointer",
              background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}>Tous</button>
          <button onClick={() => onApply([...sel])}
            style={{ flex:2, padding:9, borderRadius:10, fontSize:12.5, fontWeight:700, cursor:"pointer",
              background:"#3b82f6", border:"none", color:"white" }}>
            {sel.size ? `Voir ${sel.size} créateur${sel.size > 1 ? "s" : ""}` : "Voir tous les créateurs"}
          </button>
        </div>
      </div>
    </div>,
    document.body
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

// « 3 plateaux · 5 impressions » plutot qu'un « 5 fois » ambigu.
function printedLabel(x) {
  const n = x.printed, p = x.plates_printed || 1;
  const det = p > 1 ? `${p} plateaux · ${n} impression${n > 1 ? "s" : ""}` : n > 1 ? `${n} impressions` : null;
  return det ? `✓ Imprimé · ${det}` : "✓ Imprimé";
}
const printedCard = { border:"2px solid #22c55e", boxShadow:"0 0 0 3px rgba(34,197,94,0.12)" };
const ribbon = c => ({ position:"absolute", top:6, left:6, fontSize:10, fontWeight:800, letterSpacing:0.4,
  padding:"3px 8px", borderRadius:20, background:c, color:"white", boxShadow:"0 1px 4px rgba(0,0,0,0.35)" });

const iconBtn = { padding:"5px 9px", borderRadius:9, fontSize:13, cursor:"pointer", background:"var(--surface2)",
  border:"1px solid var(--border)", color:"var(--text)" };
const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
const grid = { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 };
const card = { borderRadius:12, border:"1px solid var(--border)", background:"var(--surface2)",
  overflow:"hidden", display:"flex", flexDirection:"column" };
