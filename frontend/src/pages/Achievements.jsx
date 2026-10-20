import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { currentFriend } from "../store/friend";
import { useIsAdmin } from "../store/auth";
import client from "../api/client";
import { isMoneyHidden } from "../utils/money";

// Succes : medailles gagnees sur l'historique (impressions, filaments, objets,
// MakerWorld, copains, secrets). Chaque succes a jusqu'a neuf paliers (bronze,
// argent, or, platine, diamant, legende, mythique, cosmique, eternel) ou une
// medaille unique.

const fmt = (n, unit) => {
  if (n == null) return "";
  const v = typeof n === "number" && !Number.isInteger(n) ? n.toFixed(n < 10 ? 2 : 1).replace(".", ",")
    : Number(n).toLocaleString("fr-FR");
  return unit ? `${v} ${unit}` : v;
};
const dateFr = iso => iso ? new Date(iso + (iso.endsWith("Z") || iso.includes("+") ? "" : "Z"))
  .toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" }) : "";

// embedded : dans l'onglet Succes des statistiques (sans son propre titre).
// Une carte par section : ses chiffres, et depliee, son podium entre copains,
// la comparaison avec chacun, puis toutes ses medailles (detail au toucher).
// ?cat= deplie une section ; ?a= ouvre le detail d'un succes (notifications).
export default function Achievements({ embedded = false }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [pod, setPod] = useState(null);           // podium : moi et mes copains
  const [sp, setSp] = useSearchParams();
  const focus = sp.get("a") || "";
  const [openCats, setOpenCats] = useState(() => new Set([sp.get("cat")].filter(Boolean)));
  // sous-sections des Secrets : repliees par defaut
  const [openSubs, setOpenSubs] = useState(() => new Set());
  const toggleSub = id => setOpenSubs(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [detail, setDetail] = useState(null);
  const atFriend = !!currentFriend();             // chez un copain : pas de podium (ce sont ses copains a lui)
  const isAdmin = useIsAdmin();
  const load = () => client.get("/achievements").then(r => setData(r.data)).catch(e => setErr(e.response?.data?.detail || e.message));
  // cles : reveler l'etape suivante d'un secret, puis relire la page
  const [keyErr, setKeyErr] = useState(null);
  const spend = async aid => {
    setKeyErr(null);
    try { await client.post(`/achievements/keys/${aid}`); await load(); }
    catch (e) { setKeyErr(e.response?.data?.detail || e.message); }
  };
  const canSpend = isAdmin && !atFriend && !!data?.keys;
  const [mine, setMine] = useState(null);         // en visite : mes propres medailles uniques (lues chez moi)

  useEffect(() => {
    load();
    // le podium tient a jour les secrets des copains (etapes offertes) : on relit ensuite
    if (!atFriend) client.get("/achievements/podium").then(r => { setPod(r.data); load(); }).catch(() => {});
    else client.get("/achievements/mine", { home: true }).then(r => setMine(r.data)).catch(() => {});
  }, []);
  // Secrets « a portee » : pas encore gagnes ici, mais deja par quelqu'un de la
  // bande. Chez moi : mes copains ; chez un copain : moi.
  const ringBy = useMemo(() => {
    const out = {};
    const add = (ids, name) => (ids || []).forEach(id => { (out[id] = out[id] || []).push(name); });
    if (atFriend) add(mine?.uniques, "Toi");
    else for (const p of pod?.people || []) if (!p.me && p.status === "ok") add(p.uniques, p.name);
    return out;
  }, [pod, mine, atFriend]);
  // En visite : parmi ses medailles uniques, celles que j'ai aussi (ou pas)
  const mineSet = useMemo(() => atFriend && mine ? new Set(mine.uniques || []) : null, [mine, atFriend]);
  const shared = it => mineSet && it.tiers.length === 1 && it.level >= 0 ? mineSet.has(it.id) : undefined;
  const byId = useMemo(() => Object.fromEntries((data?.items || []).map(x => [x.id, x])), [data]);
  // lien d'une notification : deplier sa section et ouvrir son detail
  useEffect(() => {
    if (!focus || !byId[focus]) return;
    setOpenCats(s => new Set([...s, byId[focus].cat]));
    setOpenSubs(s => new Set([...s, byId[focus].sub || "unknown"]));
    setDetail(focus);
  }, [focus, byId]);

  if (err) return <p style={msg}>{err}</p>;
  if (!data) return <p style={msg}>…</p>;

  const toggle = c => setOpenCats(s => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const closeDetail = () => {
    setDetail(null);
    if (focus) { const n = new URLSearchParams(sp); n.delete("a"); setSp(n, { replace:true }); }
  };
  const pct = data.score_max ? Math.round(100 * data.score / data.score_max) : 0;
  const people = (pod?.people || []).filter(p => p.status === "ok");
  const others = (pod?.people || []).filter(p => !p.me);
  const withFriends = people.length > 1;
  const tiersById = Object.fromEntries(data.tiers.map(t => [t.id, t]));

  return (
    <div style={{ maxWidth: embedded ? undefined : 900, width:"100%", margin:"0 auto", display:"flex", flexDirection:"column", gap:14 }}>
      {!embedded && <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Succès</h1>}

      {/* Bilan : score et medailles */}
      <div className="card" style={{ padding:"16px 18px", display:"flex", flexDirection:"column", gap:12,
        background:"linear-gradient(135deg, rgba(245,183,0,0.12), rgba(139,92,246,0.10)), var(--surface)" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:28, fontWeight:900, color:"var(--text)", fontVariantNumeric:"tabular-nums" }}>{data.score}</span>
          <span style={{ fontSize:13, color:"var(--muted)", fontWeight:600 }}>points sur {data.score_max} · {pct} %</span>
        </div>
        <Bar value={pct / 100}/>
        <MedalCounts tiers={data.tiers} medals={data.medals}/>
        {data.keys && !atFriend && <KeysBox keys={data.keys}/>}
      </div>

      {/* Podium general entre copains */}
      {withFriends && (
        <div className="card" style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
          <div style={sectionTitle}>🏆 Podium entre copains</div>
          <Podium people={people} score={p => p.score}/>
          {others.filter(p => p.status !== "ok").map(p => (
            <div key={p.id} style={{ fontSize:11.5, color:"var(--muted)" }}>
              {p.name} : {p.status === "outdated" ? "son BambuNymous n'a pas encore les succès" : "injoignable pour le moment"}</div>
          ))}
        </div>
      )}

      {/* Derniers succes */}
      {data.recent.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={sectionTitle}>Derniers succès</div>
          <div className="no-scrollbar" style={{ display:"flex", gap:8, overflowX:"auto", padding:"2px 0" }}>
            {data.recent.map(r => {
              const it = byId[r.id]; if (!it) return null;
              const t = it.tiers[r.tier];
              return (
                <button key={r.id + r.tier} onClick={() => setDetail(r.id)}
                  className="card" style={{ flexShrink:0, display:"flex", alignItems:"center", gap:10, padding:"8px 12px 8px 8px",
                    cursor:"pointer", border:"1px solid var(--border)", textAlign:"left" }}>
                  <Medal tier={t} emoji={it.emoji} size={40}/>
                  <span style={{ display:"flex", flexDirection:"column", minWidth:0 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:"var(--text)", whiteSpace:"nowrap" }}>{it.name}</span>
                    <span style={{ fontSize:11, color:"var(--muted)", whiteSpace:"nowrap" }}>{t.label} · {dateFr(r.at)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Sections */}
      {data.categories.map(c => {
        const items = data.items.filter(x => x.cat === c.id)
          .sort((a, b) => (b.level - a.level) || (progress(b) - progress(a)));
        if (!items.length) return null;
        const got = items.filter(x => x.level >= 0).length;
        const sum = { score:0, max:0, medals:{} };
        for (const it of items) for (const t of it.tiers) {
          const sc = tiersById[t.id]?.score || 0;
          sum.max += sc;
          if (t.at) { sum.score += sc; sum.medals[t.id] = (sum.medals[t.id] || 0) + 1; }
        }
        const ranked = withFriends ? [...people].sort((a, b) => (b.cats?.[c.id]?.score || 0) - (a.cats?.[c.id]?.score || 0)) : [];
        const myRank = ranked.findIndex(p => p.me) + 1;
        const open = openCats.has(c.id);
        const near = items.filter(x => x.level < 0 && ringBy[x.id]).length;
        const common = items.filter(x => shared(x) === true).length;
        const toFind = items.filter(x => shared(x) === false).length;
        return (
          <div key={c.id} className="card" style={{ padding:0, overflow:"hidden" }}>
            <button onClick={() => toggle(c.id)} aria-expanded={open}
              style={{ width:"100%", display:"flex", flexDirection:"column", gap:8, padding:"14px 16px", background:"none",
                border:"none", cursor:"pointer", textAlign:"left", color:"var(--text)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, width:"100%" }}>
                <span style={{ fontSize:22 }}>{c.emoji}</span>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"flex", alignItems:"center", gap:8, fontSize:15, fontWeight:800 }}>{c.name}
                    {/* mes cles, la ou on les depense */}
                    {c.id === "secret" && data.keys && !atFriend && (
                      <span title="Tes clés, pour révéler les secrets (touche un secret)" style={{ fontSize:12, fontWeight:900,
                        padding:"2px 8px", borderRadius:20, background:"rgba(245,158,11,0.15)", color:"#F59E0B" }}>
                        🔑 {data.keys.balance}</span>
                    )}</span>
                  <span style={{ display:"block", fontSize:11.5, color:"var(--muted)", marginTop:1 }}>
                    {got}/{items.length} succès · {sum.score} pts
                    {near > 0 && <span style={{ color:"#F59E0B", fontWeight:700 }}> · 👀 {near} à portée</span>}
                    {mineSet && (common + toFind) > 0 && (
                      <span style={{ display:"block", marginTop:2 }}>
                        <span style={{ color:"#22c55e", fontWeight:700 }}>✓ {common} en commun</span>
                        <span style={{ color:"var(--muted)" }}> · </span>
                        <span style={{ color:"#ef4444", fontWeight:700 }}>{toFind} à trouver</span></span>
                    )}</span>
                </span>
                {myRank > 0 && (
                  <span title="Ta place entre copains" style={{ fontSize:11.5, fontWeight:800, padding:"3px 9px", borderRadius:20,
                    whiteSpace:"nowrap", background:"var(--surface2)", color:"var(--text2)" }}>
                    {["🥇", "🥈", "🥉"][myRank - 1] || "🏅"} {myRank}ᵉ/{ranked.length}</span>
                )}
                <span style={{ fontSize:11, color:"var(--muted)", transform: open ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span>
              </div>
              <Bar value={sum.max ? sum.score / sum.max : 0}/>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                {data.tiers.filter(t => sum.medals[t.id]).map(t => (
                  <span key={t.id} style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:12, fontWeight:800 }}>
                    <Medal tier={t} emoji="" size={16}/>{sum.medals[t.id]}</span>
                ))}
                {!Object.keys(sum.medals).length && <span style={{ fontSize:11.5, color:"var(--muted)" }}>Aucune médaille pour l'instant</span>}
              </div>
            </button>
            {open && (
              <div style={{ padding:"0 16px 16px", display:"flex", flexDirection:"column", gap:14 }}>
                {withFriends && (
                  <div style={{ display:"flex", flexDirection:"column", gap:10, padding:"12px", borderRadius:12,
                    background:"var(--surface2)", border:"1px solid var(--border)" }}>
                    <Podium people={people} score={p => p.cats?.[c.id]?.score || 0} small/>
                    <Compare people={people} cat={c.id}/>
                  </div>
                )}
                {/* Legende des reperes entre copains (ce qui s'applique ici seulement) */}
                {c.id === "secret" && (near > 0 || common + toFind > 0) && (
                  <div style={{ display:"flex", flexDirection:"column", gap:4, padding:"8px 10px", borderRadius:10, fontSize:11.5,
                    lineHeight:1.45, color:"var(--text2)", background:"rgba(245,158,11,0.08)", border:"1px dashed rgba(245,158,11,0.5)" }}>
                    {near > 0 && !atFriend && <span><b style={{ color:"#F59E0B" }}>👀 À portée</b> : pas encore à toi, mais un copain l'a déjà
                      débloqué (son initiale est sur la médaille). Rien n'est dévoilé : à toi de trouver comment.</span>}
                    {near > 0 && atFriend && <span><b style={{ color:"#F59E0B" }}>« toi »</b> : tu l'as déjà, lui pas encore.</span>}
                    {common + toFind > 0 && <span><b style={{ color:"#22c55e" }}>✓ toi aussi</b> / <b style={{ color:"#ef4444" }}>pas toi</b> :
                      ses médailles comparées aux tiennes.</span>}
                  </div>
                )}
                {/* Secrets : rangés en sous-sections (calendrier, heures, couleurs…) */}
                {/* Secrets : les gagnes (et ceux dont une cle a revele la categorie) dans
                    leur sous-section ; les autres « a decouvrir ». Les en-tetes ne disent
                    que ce qu'ils montrent : rien sur la taille cachee d'une categorie. */}
                {(c.id === "secret" && data.subs?.length
                  ? [...data.subs.map(sb => ({ ...sb, items: items.filter(x => x.sub === sb.id) })),
                     { id:"unknown", emoji:"❓", name:"À découvrir", items: items.filter(x => !x.sub) }].filter(sb => sb.items.length)
                  : [{ id:"", items }]
                ).map(sb => (
                  <div key={sb.id} style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {sb.id && (
                      <button onClick={() => toggleSub(sb.id)} aria-expanded={openSubs.has(sb.id)}
                        style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, fontWeight:800, color:"var(--text2)",
                          background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, padding:"8px 10px",
                          cursor:"pointer", textAlign:"left", width:"100%" }}>
                        <span style={{ fontSize:10, color:"var(--muted)", transform: openSubs.has(sb.id) ? "rotate(90deg)" : "none",
                          transition:"transform .15s" }}>▶</span>
                        <span>{sb.emoji}</span>{sb.name}
                        <span style={{ marginLeft:"auto", fontSize:11, fontWeight:700, color:"var(--muted)" }}>
                          {sb.id === "unknown" ? `${sb.items.length} à découvrir` : (() => {
                            const won = sb.items.filter(x => x.level >= 0).length, seen = sb.items.length - won;
                            return `${won} gagné${won > 1 ? "s" : ""}` + (seen ? ` · ${seen} en vue` : "");
                          })()}</span>
                      </button>
                    )}
                    {(!sb.id || openSubs.has(sb.id)) && (
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(84px, 1fr))", gap:8 }}>
                        {sb.items.map(it => <Tile key={it.id} it={it} others={ringBy[it.id]} shared={shared(it)} onOpen={() => setDetail(it.id)}/>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {data.since && <p style={{ ...msg, padding:"4px", fontSize:11 }}>
        Les dates viennent de ton historique ; ce qui ne s'y lit pas (MakerWorld, stock, copains) est daté du jour où il a été constaté.</p>}

      {detail && byId[detail] && createPortal(
        <div data-no-pull="" onClick={closeDetail} style={{ position:"fixed", inset:0, zIndex:4300, background:"rgba(0,0,0,0.6)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:420, maxHeight:"90vh", overflowY:"auto",
            position:"relative" }}>
            <button onClick={closeDetail} aria-label="Fermer" style={{ position:"absolute", top:8, right:10, zIndex:1,
              background:"none", border:"none", color:"var(--muted)", fontSize:20, cursor:"pointer" }}>✕</button>
            <Card it={byId[detail]} sheet others={ringBy[detail]} shared={shared(byId[detail])}
              keys={canSpend ? data.keys : null} onSpend={() => spend(detail)} keyErr={keyErr}/>
          </div>
        </div>, document.body
      )}
    </div>
  );
}

// Une medaille de la grille d'une section : grisee tant qu'elle n'est pas
// gagnee, avec un petit liseré de progression vers le palier suivant.
function Tile({ it, onOpen, others, shared }) {
  const got = it.level >= 0;
  const top = got ? it.tiers[it.level] : it.tiers[0];
  const p = progress(it);
  // secret pas encore gagne ici, mais deja par quelqu'un de la bande : cercle
  const near = !got && others?.length;
  return (
    <button onClick={onOpen} title={near ? `${it.name} · ${others.join(", ")} l'${others.length > 1 ? "ont" : "a"}` : it.name}
      style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5,
      padding:"10px 4px 8px", borderRadius:12, cursor:"pointer", minWidth:0, position:"relative",
      background: got ? `${top.color}14` : near ? "rgba(245,158,11,0.08)" : "transparent",
      border:`1px ${near ? "dashed" : "solid"} ${got ? top.color + "55" : near ? "#F59E0B" : "var(--border)"}` }}>
      <span style={{ borderRadius:"50%", padding:2, boxShadow: near ? "0 0 0 2px #F59E0B, 0 0 12px rgba(245,158,11,0.55)" : "none" }}>
        <Medal tier={top} emoji={it.emoji} size={46} locked={!got}/></span>
      {/* en visite : sa medaille, l'ai-je aussi ? */}
      {shared !== undefined && (
        <span style={{ position:"absolute", top:4, right:4, fontSize:9.5, fontWeight:800, padding:"2px 6px", borderRadius:20,
          whiteSpace:"nowrap", color:"#fff", background: shared ? "#22c55e" : "#ef4444",
          border:"1.5px solid var(--sheet-bg)" }}>{shared ? "✓ toi aussi" : "pas toi"}</span>
      )}
      {near && (
        <span style={{ position:"absolute", top:4, right:4, display:"flex" }}>
          {others.slice(0, 2).map((n, i) => (
            <span key={n} style={{ width:18, height:18, borderRadius:"50%", marginLeft: i ? -6 : 0, display:"flex",
              alignItems:"center", justifyContent:"center", fontSize:9.5, fontWeight:800, color:"#fff",
              background: n === "Toi" ? "#F59E0B" : "#8B5CF6", border:"1.5px solid var(--sheet-bg)" }}>
              {n === "Toi" ? "toi" : n.slice(0, 1).toUpperCase()}</span>
          ))}
          {others.length > 2 && <span style={{ fontSize:9.5, fontWeight:800, color:"#F59E0B", marginLeft:2 }}>+{others.length - 2}</span>}
        </span>
      )}
      <span style={{ fontSize:11, fontWeight:700, color: got ? "var(--text)" : "var(--muted)", textAlign:"center",
        lineHeight:1.2, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden",
        width:"100%" }}>{it.name}</span>
      {!got && it.reveal > 0 && (
        <span title={`${it.reveal}/5 révélé par des clés`} style={{ display:"flex", gap:3 }}>
          {[1, 2, 3, 4, 5].map(i => <span key={i} style={{ width:5, height:5, borderRadius:"50%",
            background: i <= it.reveal ? "#F59E0B" : "var(--border)" }}/>)}
        </span>
      )}
      {it.tiers.length > 1 && it.next != null && (
        <span style={{ width:"70%", height:3, borderRadius:3, background:"var(--surface2)", overflow:"hidden" }}>
          <span style={{ display:"block", width:`${Math.round(p * 100)}%`, height:"100%",
            background: it.tiers[it.level + 1]?.color || top.color }}/></span>
      )}
    </button>
  );
}

// Podium : les trois premiers (2e, 1er, 3e), moi mis en avant.
function Podium({ people, score, small = false }) {
  const top = [...people].sort((a, b) => score(b) - score(a)).slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  const rank = p => top.indexOf(p);
  const H = small ? [52, 38, 28] : [68, 50, 36];
  return (
    <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"center", gap:8 }}>
      {order.map(p => {
        const r = rank(p);
        return (
          <div key={p.id} style={{ flex:"0 1 110px", minWidth:0, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
            <span style={{ fontSize: small ? 18 : 22 }}>{["🥇", "🥈", "🥉"][r]}</span>
            <span style={{ fontSize:12, fontWeight:800, color: p.me ? "#F59E0B" : "var(--text)", maxWidth:"100%",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.me ? "Toi" : p.name}</span>
            <div style={{ width:"100%", height:H[r], borderRadius:"10px 10px 4px 4px", display:"flex", alignItems:"center",
              justifyContent:"center", fontSize:13, fontWeight:900, color:"#fff",
              background: ["#F5B700", "#B8C2CC", "#CD7F32"][r], boxShadow: p.me ? "0 0 0 2px #F59E0B" : "none" }}>
              {score(p)}</div>
          </div>
        );
      })}
    </div>
  );
}

// Moi face a chacun de mes copains, sur une section : son score, l'ecart.
function Compare({ people, cat }) {
  const me = people.find(p => p.me);
  const mine = me?.cats?.[cat]?.score || 0;
  const max = Math.max(1, ...people.map(p => p.cats?.[cat]?.score || 0));
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      {people.filter(p => !p.me).map(p => {
        const his = p.cats?.[cat]?.score || 0;
        const d = mine - his;
        return (
          <div key={p.id} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
            <span style={{ width:70, flexShrink:0, fontWeight:700, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis",
              whiteSpace:"nowrap" }}>{p.name}</span>
            <span style={{ flex:1, display:"flex", flexDirection:"column", gap:2 }}>
              <span style={{ height:5, borderRadius:5, background:"var(--border)", overflow:"hidden" }}>
                <span style={{ display:"block", width:`${100 * mine / max}%`, height:"100%", background:"#F59E0B" }}/></span>
              <span style={{ height:5, borderRadius:5, background:"var(--border)", overflow:"hidden" }}>
                <span style={{ display:"block", width:`${100 * his / max}%`, height:"100%", background:"#8B5CF6" }}/></span>
            </span>
            <span style={{ width:58, flexShrink:0, textAlign:"right", fontWeight:800,
              color: d > 0 ? "#22c55e" : d < 0 ? "#ef4444" : "var(--muted)" }}>
              {d > 0 ? `+${d}` : d < 0 ? `${d}` : "="} pts</span>
          </div>
        );
      })}
      <div style={{ display:"flex", gap:12, fontSize:10.5, color:"var(--muted)" }}>
        <span><span style={{ color:"#F59E0B" }}>■</span> toi</span><span><span style={{ color:"#8B5CF6" }}>■</span> ton copain</span>
      </div>
    </div>
  );
}

// Mes cles : le compte, la prochaine, et (deplie) comment on en gagne et
// les derniers mouvements.
function KeysBox({ keys }) {
  const [open, setOpen] = useState(false);
  const r = keys.rules;
  return (
    <div style={{ borderRadius:12, padding:"8px 12px", background:"rgba(245,158,11,0.10)", border:"1px solid rgba(245,158,11,0.35)" }}>
      <button onClick={() => setOpen(o => !o)} style={{ width:"100%", display:"flex", alignItems:"center", gap:10, background:"none",
        border:"none", padding:0, cursor:"pointer", color:"var(--text)", textAlign:"left" }}>
        <span style={{ fontSize:22 }}>🔑</span>
        <span style={{ flex:1, minWidth:0 }}>
          <span style={{ display:"block", fontSize:15, fontWeight:900 }}>{keys.balance} clé{keys.balance > 1 ? "s" : ""}</span>
          <span style={{ display:"block", fontSize:11.5, color:"var(--muted)" }}>
            Prochaine dans {keys.to_next} impression{keys.to_next > 1 ? "s" : ""} réussie{keys.to_next > 1 ? "s" : ""}</span>
        </span>
        <span style={{ fontSize:11, color:"var(--muted)", transform: open ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span>
      </button>
      {open && (
        <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:6, fontSize:12, color:"var(--text2)", lineHeight:1.45 }}>
          <div>
            <b>Gagner des clés</b> : {r.start} au départ · 1 toutes les {r.prints} impressions réussies · {r.tier} par palier franchi ·
            {" "}{r.secret} par secret gagné. Et parfois, une surprise.
            {" "}Rien de rétroactif : ce qui est reconnu après coup (anciennes impressions importées, nouveau succès, seuils
            changés) ne rapporte rien.
          </div>
          <div>
            <b>Les dépenser</b> sur un secret pas encore gagné, dans l'ordre :{" "}
            {keys.steps.map((st, i) => <span key={st.id}>{i ? " → " : ""}{st.label} ({st.cost} 🔑)</span>)}.
          </div>
          {keys.log?.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:2, marginTop:2 }}>
              {keys.log.slice(0, 8).map((l, i) => (
                <div key={i} style={{ display:"flex", gap:8 }}>
                  <span style={{ width:34, flexShrink:0, fontWeight:800, color: l.n > 0 ? "#22c55e" : "#ef4444" }}>
                    {l.n > 0 ? `+${l.n}` : l.n}</span>
                  <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.why}</span>
                  <span style={{ color:"var(--muted)", fontSize:11 }}>{dateFr(l.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Reveler un secret pas a pas : vignette, titre, indice, descriptif.
function Reveal({ it, keys, onSpend, err }) {
  const lvl = it.reveal || 0;
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); await onSpend(); setBusy(false); };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6, borderTop:"1px solid var(--border)", paddingTop:8 }}>
      <div style={{ fontSize:12, fontWeight:800, color:"var(--text2)" }}>
        🔑 Révéler ce secret · tu as {keys.balance} clé{keys.balance > 1 ? "s" : ""}</div>
      {keys.steps.map((st, i) => {
        const done = i < lvl, next = i === lvl, poor = keys.balance < st.cost;
        const gift = done && i < 3 && it.gift_from?.length > 0;      // offert par un copain qui l'a
        return (
          <div key={st.id} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12.5,
            color: done ? "#22c55e" : next ? "var(--text)" : "var(--muted)" }}>
            <span style={{ width:18 }}>{done ? "✓" : next ? "▸" : "🔒"}</span>
            <span style={{ flex:1 }}>{st.label.charAt(0).toUpperCase() + st.label.slice(1)}</span>
            {gift ? <span style={{ fontSize:11, color:"#8B5CF6", fontWeight:700 }}>offert</span> : next ? (
              <button onClick={go} disabled={busy || poor} style={{ padding:"5px 11px", borderRadius:20, fontSize:12,
                fontWeight:800, cursor: poor ? "default" : "pointer", border:"none",
                background: poor ? "var(--surface2)" : "#F59E0B", color: poor ? "var(--muted)" : "#fff" }}>
                {busy ? "…" : `${st.cost} 🔑`}</button>
            ) : <span style={{ fontSize:11.5 }}>{st.cost} 🔑</span>}
          </div>
        );
      })}
      {err && <p style={{ margin:0, fontSize:12, color:"#ef4444" }}>{err}</p>}
    </div>
  );
}

function Bar({ value }) {
  return (
    <div style={{ height:8, borderRadius:8, background:"var(--surface2)", overflow:"hidden", width:"100%" }}>
      <div style={{ width:`${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, height:"100%", borderRadius:8,
        background:"linear-gradient(90deg, #CD7F32, #F5B700, #6EC6D9, #8B5CF6, #E11D48, #0D9488, #4338CA)" }}/>
    </div>
  );
}

// Bilan des medailles : une case par type (medaille, nombre, nom), en grille
// qui passe a la ligne plutot que de serrer les chiffres les uns sur les autres.
function MedalCounts({ tiers, medals }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(52px, 1fr))", gap:6 }}>
      {tiers.map(t => {
        const n = medals[t.id] || 0;
        return (
          <div key={t.id} title={t.label} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3,
            padding:"7px 2px 6px", borderRadius:10, minWidth:0, background: n ? `${t.color}14` : "var(--surface2)",
            border:`1px solid ${n ? t.color + "40" : "var(--border)"}` }}>
            <Medal tier={t} emoji="" size={22} locked={!n}/>
            <span style={{ fontSize:15, fontWeight:900, color: n ? "var(--text)" : "var(--muted)", lineHeight:1,
              fontVariantNumeric:"tabular-nums" }}>{n}</span>
            <span style={{ fontSize:10, color:"var(--muted)", whiteSpace:"nowrap", maxWidth:"100%", overflow:"hidden",
              textOverflow:"ellipsis" }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}

const progress = it => {
  if (it.next == null || it.value == null) return it.level >= 0 ? 1 : 0;
  const span = it.next - (it.prev || 0);
  return span > 0 ? Math.max(0, Math.min(1, (it.value - (it.prev || 0)) / span)) : 0;
};

function Card({ it, focus, sheet = false, others, shared, keys, onSpend, keyErr }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(sheet);
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    // apres la mise en page (cartes au-dessus, ouverture de celle-ci)
    const t = setTimeout(() => ref.current?.scrollIntoView({ block:"center" }), 150);
    return () => clearTimeout(t);
  }, [focus]);
  const got = it.level >= 0;
  const top = got ? it.tiers[it.level] : it.tiers[0];
  const p = progress(it);
  const money = it.money && isMoneyHidden();
  const done = got && it.next == null;
  const unique = it.tiers.length === 1;
  return (
    <div ref={ref} className="card" onClick={() => !sheet && setOpen(o => !o)}
      style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:9, cursor:"pointer",
        border: focus ? `2px solid ${top.color}` : undefined,
        boxShadow: focus ? `0 0 0 4px ${top.color}33` : undefined,
        // en feuille de detail : fond opaque des feuilles (la carte seule est translucide)
        background: done ? `linear-gradient(135deg, ${top.color}1f, transparent 70%), ${sheet ? "var(--sheet-bg)" : "var(--surface)"}`
          : sheet ? "var(--sheet-bg)" : undefined,
        ...(sheet ? { backdropFilter:"none", boxShadow:"0 12px 40px rgba(0,0,0,0.45)", paddingRight:36 } : {}) }}>
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        <Medal tier={top} emoji={it.emoji} size={52} locked={!got}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:800, color: got ? "var(--text)" : "var(--text2)" }}>{it.name}</div>
          <div style={{ fontSize:12, color:"var(--muted)", marginTop:2, lineHeight:1.35,
            fontStyle: it.masked ? "italic" : "normal" }}>
            {it.masked ? "🔒 Descriptif caché" : unique && got ? it.desc : done ? `✓ Tous les paliers atteints · ${it.desc}` : it.desc}</div>
          {unique && got && (
            <div style={{ fontSize:11, fontWeight:700, color:top.color, marginTop:3 }}>Gagné le {dateFr(top.at)}</div>
          )}
        </div>
      </div>
      {shared !== undefined && (
        <p style={{ margin:0, fontSize:12.5, fontWeight:700, color: shared ? "#22c55e" : "#ef4444" }}>
          {shared ? "✓ Toi aussi, tu l'as." : "Tu ne l'as pas encore : à toi de le trouver !"}</p>
      )}
      {!got && others?.length > 0 && (
        <p style={{ margin:0, fontSize:12.5, fontWeight:700, color:"#F59E0B", lineHeight:1.45 }}>
          {others.length === 1 && others[0] === "Toi" ? "👀 Toi, tu l'as déjà !"
            : `👀 ${others.join(", ")} ${others.length > 1 ? "l'ont" : "l'a"} déjà débloqué : à toi de le trouver !`}</p>
      )}
      {/* secret pas encore gagne : ce que les cles ont revele, et la suite */}
      {sheet && unique && !got && it.hint && (
        <p style={{ margin:0, fontSize:12.5, color:"var(--text2)", fontStyle:"italic" }}>💡 Indice : {it.hint}</p>
      )}
      {sheet && unique && !got && it.gift_from?.length > 0 && (
        <p style={{ margin:0, fontSize:12.5, fontWeight:700, color:"#8B5CF6" }}>
          🎁 Catégorie, vignette et titre offerts grâce à {it.gift_from.join(", ")}</p>
      )}
      {sheet && unique && !got && keys && <Reveal it={it} keys={keys} onSpend={onSpend} err={keyErr}/>}
      {unique && got && it.lore && (
        <p style={{ margin:0, fontSize:12.5, color:"var(--text2)", lineHeight:1.5, fontStyle:"italic",
          padding:"8px 10px", borderRadius:10, background:`${top.color}14`, borderLeft:`3px solid ${top.color}` }}>
          {it.lore}</p>
      )}
      {!it.secret || got ? (
        it.tiers.length > 1 && (
          <>
            {it.next != null && (
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ flex:1, height:6, borderRadius:6, background:"var(--surface2)", overflow:"hidden" }}>
                  <div style={{ width:`${Math.round(p * 100)}%`, height:"100%", borderRadius:6,
                    background: it.tiers[it.level + 1]?.color || top.color }}/>
                </div>
                {!money && <span style={{ fontSize:11, fontWeight:700, color:"var(--text2)", whiteSpace:"nowrap",
                  fontVariantNumeric:"tabular-nums" }}>{fmt(it.value, it.unit)} / {fmt(it.next, it.unit)}</span>}
              </div>
            )}
            <div style={{ display:"flex", gap:6 }}>
              {it.tiers.map(t => <Medal key={t.id} tier={t} emoji="" size={18} locked={!t.at}/>)}
            </div>
          </>
        )
      ) : null}
      {open && !unique && (got || !it.secret) && (
        <div style={{ display:"flex", flexDirection:"column", gap:4, borderTop:"1px solid var(--border)", paddingTop:8 }}>
          {it.tiers.map(t => (
            <div key={t.id} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12,
              color: t.at ? "var(--text)" : "var(--muted)" }}>
              <Medal tier={t} emoji="" size={16} locked={!t.at}/>
              <span style={{ fontWeight:700, minWidth:58 }}>{t.label}</span>
              <span style={{ flex:1 }}>{money ? "" : it.tiers.length > 1 ? fmt(t.n, it.unit) : ""}</span>
              <span style={{ fontSize:11 }}>{t.at ? dateFr(t.at) : "à gagner"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Medaille : disque a la teinte du cran, liseré, ruban ; grisee tant qu'elle
// n'est pas gagnee.
export function Medal({ tier, emoji, size = 48, locked = false }) {
  const c = locked ? "#8a8f98" : tier.color;
  const id = `m${tier.id}${locked ? "l" : ""}`;
  return (
    <span style={{ position:"relative", width:size, height:size, flexShrink:0, display:"inline-flex",
      alignItems:"center", justifyContent:"center", opacity: locked ? 0.45 : 1 }}>
      <svg width={size} height={size} viewBox="0 0 48 48" style={{ position:"absolute", inset:0 }} aria-hidden="true">
        <defs>
          <radialGradient id={id} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.85"/>
            <stop offset="45%" stopColor={c}/>
            <stop offset="100%" stopColor={c} stopOpacity="0.75"/>
          </radialGradient>
        </defs>
        {size >= 30 && <>
          <path d="M14 2 L22 18 L17 20 L9 4 Z" fill={c} opacity="0.55"/>
          <path d="M34 2 L26 18 L31 20 L39 4 Z" fill={c} opacity="0.55"/>
        </>}
        <circle cx="24" cy={size >= 30 ? 28 : 24} r={size >= 30 ? 18 : 21} fill={`url(#${id})`}
          stroke={c} strokeWidth="2.5"/>
        <circle cx="24" cy={size >= 30 ? 28 : 24} r={size >= 30 ? 13.5 : 15.5} fill="none"
          stroke="#fff" strokeOpacity="0.45" strokeWidth="1.2"/>
      </svg>
      {emoji && <span style={{ position:"relative", top: size >= 30 ? size * 0.08 : 0, fontSize:size * 0.36,
        filter: locked ? "grayscale(1)" : "none", lineHeight:1 }}>{emoji}</span>}
    </span>
  );
}

const sectionTitle = { fontSize:11, fontWeight:800, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", padding:"0 4px" };
const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
