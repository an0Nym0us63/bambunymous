import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import AdminOnly from "./AdminOnly";
import MakerWorldCollectionsPicker from "./MakerWorldCollectionsPicker";

// Fiche d'un modele MakerWorld dans l'appli : galerie, createur, compteurs,
// descriptif, profils et leurs plateaux (coches s'ils sont imprimes),
// commentaires. Lecture seule ; le lien vers le site reste a portee.
const fmtK = n => n == null ? null : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
const fmtDur = s => { if (!s) return null; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`; };
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString("fr-FR", { day:"numeric", month:"short", year:"numeric" }); } catch { return ""; } };

export default function MakerWorldModelSheet({ designId, onClose, onSearch }) {
  const [id, setId] = useState(designId);          // permet d'ouvrir un similaire sans empiler
  const [m, setM] = useState(null);
  const [more, setMore] = useState(false);         // descriptif deplie
  const [open, setOpen] = useState(null);          // profil deplie (instance_id)
  const [com, setCom] = useState(null);            // { items, total }
  const [comBusy, setComBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [sim, setSim] = useState(null);

  useEffect(() => {
    let alive = true;
    setM(null); setCom(null); setSim(null); setMore(false);
    client.get(`/makerworld/model/${id}`).then(({ data }) => {
      if (!alive) return;
      setM(data);
      const p = (data.profiles || []).find(x => x.default) || (data.profiles || [])[0];
      setOpen(p?.instance_id || null);
    }).catch(e => alive && setM({ error: e.response?.data?.detail || e.message }));
    client.get(`/makerworld/model/${id}/comments`).then(({ data }) => alive && setCom(data)).catch(() => alive && setCom({ items: [], total: 0 }));
    client.get(`/makerworld/similar/${id}`).then(({ data }) => alive && setSim(data.items || [])).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const moreComments = () => {
    setComBusy(true);
    client.get(`/makerworld/model/${id}/comments`, { params: { offset: com.items.length } })
      .then(({ data }) => setCom(c => ({ ...c, items: [...c.items, ...(data.items || [])] })))
      .finally(() => setComBusy(false));
  };

  const done = new Set(m?.printed_plates || []);
  const plateDone = (prof, idx) => done.has(`${prof.profile_id}:${idx}`) || done.has(`:${idx}`);

  return createPortal(
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4200, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:640, height:"92dvh", display:"flex", flexDirection:"column",
        paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 16px 8px" }}>
          <span style={{ flex:1, fontSize:11, fontWeight:700, color:"#3b82f6", letterSpacing:0.3 }}>MAKERWORLD</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"0 16px 20px" }}>
          {m === null ? <p style={msg}>Chargement…</p>
            : m.error ? (<>
              <p style={{ ...msg, color:"#f59e0b" }}>{m.error}</p>
              <a href={m.url || `https://makerworld.com/fr/models/${id}`} target="_blank" rel="noopener noreferrer" style={linkBtn}>Ouvrir sur MakerWorld ↗</a>
            </>) : (<>
            {/* Galerie */}
            {m.pictures?.length > 0 && (
              <div style={{ display:"flex", gap:8, overflowX:"auto", scrollSnapType:"x mandatory", margin:"0 -16px 12px",
                padding:"0 16px" }}>
                {m.pictures.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noopener noreferrer"
                    style={{ flexShrink:0, width:"78%", maxWidth:360, scrollSnapAlign:"center" }}>
                    <img src={u} alt="" loading={i < 2 ? "eager" : "lazy"} referrerPolicy="no-referrer"
                      style={{ width:"100%", aspectRatio:"1", objectFit:"cover", borderRadius:12, display:"block",
                        background:"var(--surface2)" }}/>
                  </a>
                ))}
              </div>
            )}

            <h2 style={{ fontSize:17, fontWeight:800, color:"var(--text)", margin:"0 0 2px", lineHeight:1.3 }}>{m.title}</h2>
            {m.title_fr && m.title_fr !== m.title && <div style={{ fontSize:12, color:"var(--muted)" }}>{m.title_fr}</div>}
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"var(--muted)", margin:"6px 0" }}>
              {m.creator_avatar && <img src={m.creator_avatar} alt="" referrerPolicy="no-referrer" style={{ width:18, height:18, borderRadius:"50%" }}/>}
              <span>par <b style={{ color:"var(--text2)" }}>{m.creator_name}</b>{m.created ? ` · ${fmtDate(m.created)}` : ""}</span>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:10, fontSize:12, color:"var(--muted)", margin:"4px 0 10px" }}>
              {[["❤", m.like_count, "j'aime"], ["⬇", m.download_count, "téléchargements"], ["🖨", m.print_count, "impressions"],
                ["⭐", m.collection_count, "collections"], ["💬", m.comment_count, "commentaires"]]
                .filter(([, n]) => n != null).map(([i, n, l]) => <span key={l} title={`${n} ${l}`}>{i} {fmtK(n)}</span>)}
            </div>

            {(m.printed > 0 || m.in_progress > 0) && (
              <div style={{ padding:"8px 12px", borderRadius:10, marginBottom:10, fontSize:12.5, fontWeight:700,
                background: m.printed ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
                color: m.printed ? "#22c55e" : "#f59e0b", border:`1px solid ${m.printed ? "#22c55e55" : "#f59e0b55"}` }}>
                {m.printed ? `✓ Imprimé · ${m.printed} impression${m.printed > 1 ? "s" : ""}` : "⏳ En cours d'impression"}
                {m.in_progress > 0 && m.printed > 0 ? " · une en cours" : ""}
                {m.printed > 0 && onSearch && (
                  <button onClick={() => { onSearch(m); onClose(); }} style={{ marginLeft:8, fontSize:11.5, fontWeight:600,
                    color:"#22c55e", background:"none", border:"none", textDecoration:"underline", cursor:"pointer", padding:0 }}>
                    voir mes prints</button>
                )}
              </div>
            )}

            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
              <a href={m.url} target="_blank" rel="noopener noreferrer" style={linkBtn}>Ouvrir sur MakerWorld ↗</a>
              <AdminOnly><button onClick={() => setPick(true)} style={{ ...linkBtn, cursor:"pointer" }}>☆ Collections</button></AdminOnly>
            </div>
            {pick && <MakerWorldCollectionsPicker designId={id} title={m.title} onClose={() => setPick(false)}/>}

            {m.categories?.length > 0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
                {m.categories.map(c => <span key={c} style={chip}>{c}</span>)}
                {m.license && <span style={{ ...chip, background:"var(--surface2)", color:"var(--muted)" }}>{m.license}</span>}
              </div>
            )}

            {/* Descriptif */}
            {m.description && (
              <Section title="Descriptif">
                <div style={{ fontSize:13, color:"var(--text2)", lineHeight:1.55, whiteSpace:"pre-wrap",
                  ...(more ? null : { maxHeight:150, overflow:"hidden", maskImage:"linear-gradient(#000 70%, transparent)" }) }}>
                  {m.description}
                </div>
                {m.description.length > 300 && (
                  <button onClick={() => setMore(v => !v)} style={textBtn}>{more ? "Réduire" : "Lire la suite"}</button>
                )}
              </Section>
            )}

            {/* Profils et plateaux */}
            {m.profiles?.length > 0 && (
              <Section title={`Profils (${m.profiles.length})`}>
                {m.profiles.map(p => {
                  const isOpen = open === p.instance_id;
                  const nDone = p.plates.filter(pl => plateDone(p, pl.index)).length;
                  return (
                    <div key={p.instance_id} style={{ border:"1px solid var(--border)", borderRadius:10, marginBottom:8,
                      background:"var(--surface2)", overflow:"hidden" }}>
                      <button onClick={() => setOpen(isOpen ? null : p.instance_id)}
                        style={{ width:"100%", textAlign:"left", padding:"9px 10px", background:"none", border:"none",
                          cursor:"pointer", color:"var(--text)" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ flex:1, fontSize:13, fontWeight:700 }}>{p.title || "Profil"}{p.default ? " ★" : ""}</span>
                          {nDone > 0 && <span style={{ fontSize:10.5, fontWeight:800, color:"white", background:"#22c55e",
                            padding:"1px 7px", borderRadius:20 }}>✓ {nDone}/{p.plates.length}</span>}
                          <span style={{ color:"var(--muted)", fontSize:12 }}>{isOpen ? "▾" : "▸"}</span>
                        </div>
                        <div style={{ fontSize:11, color:"var(--muted)", marginTop:2 }}>
                          {[p.printer, `${p.plates.length} plateau${p.plates.length > 1 ? "x" : ""}`,
                            p.weight_g ? `${Math.round(p.weight_g)} g` : null, fmtDur(p.seconds),
                            p.settings?.layerHeight ? `${p.settings.layerHeight} mm` : null,
                            p.settings?.sparseInfillDensity ? `remplissage ${p.settings.sparseInfillDensity}` : null,
                            p.print_count != null ? `${fmtK(p.print_count)} impressions` : null].filter(Boolean).join(" · ")}
                        </div>
                      </button>
                      {isOpen && (
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:8, padding:"0 10px 10px" }}>
                          {p.plates.map(pl => {
                            const ok = plateDone(p, pl.index);
                            return (
                              <div key={pl.index} style={{ borderRadius:8, overflow:"hidden", background:"var(--surface)",
                                border: ok ? "2px solid #22c55e" : "1px solid var(--border)" }}>
                                <div style={{ position:"relative" }}>
                                  {pl.thumb ? <img src={pl.thumb} alt="" loading="lazy" referrerPolicy="no-referrer"
                                    style={{ width:"100%", aspectRatio:"1", objectFit:"cover", display:"block" }}/>
                                    : <div style={{ width:"100%", aspectRatio:"1" }}/>}
                                  {ok && <span style={{ position:"absolute", top:4, left:4, fontSize:9.5, fontWeight:800, color:"white",
                                    background:"#22c55e", padding:"1px 6px", borderRadius:20 }}>✓ IMPRIMÉ</span>}
                                </div>
                                <div style={{ padding:"5px 6px 6px" }}>
                                  <div style={{ fontSize:11.5, fontWeight:700, color:"var(--text)", overflow:"hidden",
                                    textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{pl.index}. {pl.name || "Plateau"}</div>
                                  <div style={{ fontSize:10.5, color:"var(--muted)" }}>
                                    {[pl.weight_g ? `${Math.round(pl.weight_g)} g` : null, fmtDur(pl.seconds)].filter(Boolean).join(" · ")}
                                  </div>
                                  {pl.filaments?.length > 0 && (
                                    <div style={{ display:"flex", gap:3, marginTop:3, flexWrap:"wrap" }}>
                                      {pl.filaments.map((f, i) => (
                                        <span key={i} title={`${f.type || ""} ${f.g ? `${f.g} g` : ""}`}
                                          style={{ width:12, height:12, borderRadius:"50%", background: f.color || "#888",
                                            border:"1px solid rgba(255,255,255,0.3)" }}/>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Section>
            )}

            {/* Commentaires */}
            <Section title={`Commentaires${com?.total ? ` (${com.total})` : ""}`}>
              {com === null ? <p style={msg}>…</p> : com.items.length === 0 ? <p style={msg}>Aucun commentaire.</p> : (<>
                {com.items.map(c => (
                  <div key={c.id} style={{ display:"flex", gap:8, padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
                    {c.avatar ? <img src={c.avatar} alt="" loading="lazy" referrerPolicy="no-referrer"
                      style={{ width:26, height:26, borderRadius:"50%", flexShrink:0 }}/>
                      : <span style={{ width:26, height:26, borderRadius:"50%", background:"var(--surface2)", flexShrink:0 }}/>}
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ fontSize:11.5, color:"var(--muted)" }}>
                        <b style={{ color:"var(--text2)" }}>{c.user}</b>{c.when ? ` · ${fmtDate(c.when)}` : ""}
                        {c.score != null && <span style={{ color:"#f59e0b" }}> · {"★".repeat(Math.round(c.score))}</span>}
                      </div>
                      {c.text && <div style={{ fontSize:12.5, color:"var(--text)", lineHeight:1.45, whiteSpace:"pre-wrap",
                        marginTop:2 }}>{c.text.trim()}</div>}
                      {c.images?.length > 0 && (
                        <div style={{ display:"flex", gap:4, marginTop:4, overflowX:"auto" }}>
                          {c.images.map((u, i) => <a key={i} href={u} target="_blank" rel="noopener noreferrer">
                            <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer"
                              style={{ width:64, height:64, objectFit:"cover", borderRadius:6 }}/></a>)}
                        </div>
                      )}
                      <div style={{ fontSize:10.5, color:"var(--muted)", marginTop:3 }}>
                        ♥ {c.likes}{c.replies ? ` · ${c.replies} réponse${c.replies > 1 ? "s" : ""}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
                {com.total > com.items.length && (
                  <button onClick={moreComments} disabled={comBusy} style={textBtn}>
                    {comBusy ? "…" : `Plus de commentaires (${com.items.length} / ${com.total})`}</button>
                )}
              </>)}
            </Section>

            {/* Similaires */}
            {sim?.length > 0 && (
              <Section title="Modèles similaires">
                <div style={{ display:"flex", gap:8, overflowX:"auto" }}>
                  {sim.map(x => (
                    <button key={x.design_id} onClick={() => setId(x.design_id)}
                      style={{ flexShrink:0, width:100, padding:0, background:"none", border:"none", textAlign:"left",
                        cursor:"pointer", color:"var(--text)" }}>
                      <div style={{ position:"relative", width:100, height:100, borderRadius:8, overflow:"hidden", background:"var(--surface2)" }}>
                        {x.cover_url && <img src={x.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer"
                          style={{ width:"100%", height:"100%", objectFit:"cover" }}/>}
                        {x.printed > 0 && <span style={{ position:"absolute", left:4, bottom:4, fontSize:9, fontWeight:800,
                          padding:"1px 5px", borderRadius:20, background:"#22c55e", color:"white" }}>✓ IMPRIMÉ</span>}
                      </div>
                      <div style={{ fontSize:10.5, marginTop:3, lineHeight:1.25, overflow:"hidden", display:"-webkit-box",
                        WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{x.title}</div>
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {m.tags?.length > 0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:6 }}>
                {m.tags.map(t => <span key={t} style={{ fontSize:10.5, color:"var(--muted)" }}>#{t}</span>)}
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:12, fontWeight:800, color:"var(--text)", textTransform:"uppercase", letterSpacing:0.4,
        margin:"0 0 8px" }}>{title}</div>
      {children}
    </div>
  );
}

const msg = { fontSize:13, color:"var(--muted)", padding:"12px 0", margin:0 };
const linkBtn = { padding:"7px 12px", borderRadius:10, fontSize:12, fontWeight:700, textDecoration:"none",
  color:"#3b82f6", background:"rgba(59,130,246,0.08)", border:"1px solid rgba(59,130,246,0.3)" };
const textBtn = { marginTop:6, fontSize:12, fontWeight:600, color:"#3b82f6", background:"none", border:"none",
  padding:0, cursor:"pointer" };
const chip = { fontSize:10.5, padding:"2px 8px", borderRadius:20, background:"rgba(59,130,246,0.1)", color:"#60a5fa", fontWeight:600 };
