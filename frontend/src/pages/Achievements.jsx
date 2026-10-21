import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { currentFriend } from "../store/friend";
import { useIsAdmin } from "../store/auth";
import client from "../api/client";
import { isMoneyHidden } from "../utils/money";
import { egg, tapper, rulesOpened } from "../eggs";
import SlotMachine from "../components/SlotMachine";
import TicketCeremony from "../components/TicketCeremony";

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
  // la page a son decor : tout le fond de la zone de contenu (voir index.css)
  useEffect(() => {
    document.body.classList.add("ach-room-on");
    return () => document.body.classList.remove("ach-room-on");
  }, []);
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
  const [rules, setRules] = useState(false);
  useEffect(() => { if (rules) rulesOpened(); }, [rules]);
  const [slot, setSlot] = useState(false);
  const [vitrine, setVitrine] = useState(undefined);   // undefined : fermee ; null : tout ; id : un type de medaille
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
  // ticket de palier : passer un succes a son palier suivant
  const [ceremony, setCeremony] = useState(null);
  const useTicket = async aid => {
    setKeyErr(null);
    const it = byId[aid];
    try {
      const { data: r } = await client.post(`/achievements/ticket/${aid}`);
      closeDetail();
      setCeremony({ tier: it.tiers[r.level] || it.tiers[it.level + 1], emoji: it.emoji, name: it.name, cost: r.cost || 1,
                    added: r.added, unit: it.unit });
      await load();
    }
    catch (e) { setKeyErr(e.response?.data?.detail || e.message); }
  };
  const [mine, setMine] = useState(null);         // en visite : mes propres medailles uniques (lues chez moi)

  useEffect(() => {
    load();
    // le podium tient a jour les secrets des copains (etapes offertes) : on relit ensuite
    // le podium ne fait recharger la page que s'il a appris quelque chose (secrets des copains)
    if (!atFriend) client.get("/achievements/podium").then(r => { setPod(r.data); if (r.data?.refresh) load(); }).catch(() => {});
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
  // Chez moi : le palier de chacun de mes copains sur un succes (-1 : pas encore)
  const pals = atFriend ? [] : (pod?.people || []).filter(p => !p.me && p.status === "ok" && p.levels);
  const rivalsOf = it => pals.length ? pals.map(p => ({ name: p.name, level: p.levels[it.id]?.[0] ?? -1 })) : null;

  return (
    <div className="ach-room" style={{ maxWidth: embedded ? undefined : 900, width:"100%", margin:"0 auto", display:"flex", flexDirection:"column", gap:14 }}>
      {!embedded && <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Succès</h1>}

      {/* Bilan : score (jauge), vitrine des medailles, puis le tresor (cles, tickets, machine) */}
      <div className="card" style={{ padding:"16px 18px", display:"flex", flexDirection:"column", gap:16,
        background:"linear-gradient(135deg, rgba(245,183,0,0.10), rgba(139,92,246,0.10)), var(--surface)" }}>
        <div style={{ display:"flex", gap:18, alignItems:"center", flexWrap:"wrap" }}>
          <ScoreHero data={data}/>
          <div style={{ flex:"2 1 300px", minWidth:0, display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <button onClick={() => setVitrine(null)} title="Ouvrir ta vitrine : toutes tes médailles"
                style={{ fontSize:11, fontWeight:800, letterSpacing:".12em", textTransform:"uppercase", color:"var(--muted)",
                  background:"none", border:"none", padding:0, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 }}>
                🏛️ Ta vitrine <span style={{ fontSize:9 }}>▸</span></button>
              {data.tickets_used > 0 && <span title="Paliers passés avec des tickets" style={{ display:"inline-flex", alignItems:"center",
                gap:4, fontSize:11, color:"var(--muted)" }}><TicketStub size={0.7}/> {data.tickets_used} utilisé{data.tickets_used > 1 ? "s" : ""}</span>}
              <span style={{ flex:1 }}/>
              <button onClick={() => setRules(true)} aria-label="Règles des succès" title="Règles : paliers, points, clés, secrets"
                style={{ width:26, height:26, borderRadius:"50%", border:"1px solid var(--border)", background:"var(--surface2)",
                  color:"var(--text2)", fontSize:13, fontWeight:900, cursor:"pointer", flexShrink:0 }}>?</button>
            </div>
            <MedalShelf tiers={data.tiers} medals={data.medals} onOpen={t => setVitrine(t)}/>
          </div>
        </div>
        {data.keys && !atFriend && <Treasure keys={data.keys} onRules={() => setRules(true)}
          onWheel={canSpend && data.keys.wheel ? () => setSlot(true) : null}/>}
      </div>

      {/* Podium general entre copains */}
      {withFriends && (
        <div className="card" style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:10,
          ...feltCard("#F5B700", "#8B5CF6"),
          // projecteur sur la scene, en plus du tapis
          background:`radial-gradient(45% 70% at 50% 0%, rgba(255,215,0,0.22), transparent 70%), ${feltBg("#F5B700", "#8B5CF6")}` }}>
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
                    cursor:"pointer", textAlign:"left", ...feltCard(t.color || "#8B5CF6") }}>
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
          <div key={c.id} className="card" style={{ padding:0, overflow:"hidden", ...feltCard(CAT_COLOR[c.id] || "#8B5CF6") }}>
            <button onClick={() => toggle(c.id)} aria-expanded={open}
              style={{ width:"100%", display:"flex", flexDirection:"column", gap:8, padding:"14px 16px", background:"none",
                border:"none", cursor:"pointer", textAlign:"left", color:"var(--text)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, width:"100%" }}>
                <Chip emoji={c.emoji} color={CAT_COLOR[c.id] || "#8B5CF6"}/>
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
              <Bar value={sum.max ? sum.score / sum.max : 0} tiers={data.tiers}/>
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
                    ...feltCard(CAT_COLOR[c.id] || "#8B5CF6", "#F5B700"),
                    background:`radial-gradient(45% 80% at 50% 0%, rgba(255,215,0,0.18), transparent 70%), ${feltBg(CAT_COLOR[c.id] || "#8B5CF6", "#F5B700")}` }}>
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
                    {sb.id && (() => {
                      const col = SUB_COLOR[sb.id] || "#A855F7", isOpen = openSubs.has(sb.id), mystery = sb.id === "unknown";
                      const won = sb.items.filter(x => x.level >= 0).length, seen = sb.items.length - won;
                      return (
                        <button onClick={() => toggleSub(sb.id)} aria-expanded={isOpen}
                          style={{ display:"flex", alignItems:"center", gap:10, fontSize:13, fontWeight:800, color:"var(--text)",
                            borderRadius:12, padding:"7px 10px 7px 7px", cursor:"pointer", textAlign:"left", width:"100%",
                            transition:"box-shadow .15s, transform .15s",
                            ...(mystery ? {
                              background:`radial-gradient(80% 140% at 0% 50%, rgba(168,85,247,0.30), transparent 70%), ` +
                                `radial-gradient(rgba(245,183,0,0.35) 1px, transparent 1.6px) 0 0 / 14px 14px, ` +
                                `linear-gradient(135deg, #2a1650, #160d2e)`,
                              color:"#f5edff", border:"1px solid rgba(196,167,255,0.45)",
                              boxShadow:"0 6px 18px -10px rgba(124,58,237,0.8), inset 0 1px 0 rgba(255,255,255,0.12)" }
                              : { ...feltCard(col), boxShadow: isOpen
                                ? `0 0 0 2px ${rgba(col, 0.35)}, 0 8px 20px -10px ${rgba(col, 0.7)}`
                                : `0 4px 14px -10px ${rgba(col, 0.7)}, inset 0 1px 0 rgba(255,255,255,0.10)` }) }}>
                          <span aria-hidden style={{ width:30, height:30, flexShrink:0, borderRadius:"50%", display:"flex",
                            alignItems:"center", justifyContent:"center", fontSize:15, position:"relative",
                            background:`radial-gradient(circle at 35% 30%, ${rgba(col, 0.5)}, ${col} 72%)`,
                            boxShadow:`0 2px 6px ${rgba(col, 0.45)}, inset 0 -2px 0 rgba(0,0,0,0.18)` }}>
                            <span style={{ position:"absolute", inset:2, borderRadius:"50%", border:"1.5px dashed rgba(255,255,255,0.75)" }}/>
                            <span style={{ position:"absolute", inset:6, borderRadius:"50%", background:"rgba(255,255,255,0.92)" }}/>
                            <span style={{ position:"relative" }}>{sb.emoji}</span>
                          </span>
                          <span style={{ flex:1, minWidth:0 }}>{sb.name}</span>
                          {/* que ce qu'on voit : rien sur la taille cachee d'une categorie */}
                          {mystery
                            ? <span style={pill("#F5B700", true)}>🔒 {sb.items.length} à découvrir</span>
                            : <>
                                {won > 0 && <span style={pill(col)}>✓ {won} gagné{won > 1 ? "s" : ""}</span>}
                                {seen > 0 && <span style={pill("#8B5CF6")}>👁 {seen} en vue</span>}
                              </>}
                          <span style={{ fontSize:10, color: mystery ? "#d8c8ff" : "var(--muted)",
                            transform: isOpen ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span>
                        </button>
                      );
                    })()}
                    {(!sb.id || openSubs.has(sb.id)) && (
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(84px, 1fr))", gap:8 }}>
                        {sb.items.map(it => <Tile key={it.id} it={it} others={ringBy[it.id]} shared={shared(it)} rivals={rivalsOf(it)} onOpen={() => setDetail(it.id)}/>)}
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

      {rules && createPortal(<Rules data={data} onClose={() => setRules(false)}/>, document.body)}
      {slot && <SlotMachine wheel={data.keys?.wheel} onDone={load} onClose={() => setSlot(false)}/>}
      {ceremony && <TicketCeremony {...ceremony} onClose={() => setCeremony(null)}/>}
      {vitrine !== undefined && createPortal(<Showcase data={data} tier={vitrine} onTier={setVitrine}
        onOpen={id => setDetail(id)} onClose={() => setVitrine(undefined)}/>, document.body)}
      {detail && byId[detail] && createPortal(
        <div data-no-pull="" className="ach-room" onClick={closeDetail} style={{ position:"fixed", inset:0, zIndex:4300, background:"rgba(0,0,0,0.6)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:420, maxHeight:"90vh", overflowY:"auto",
            position:"relative" }}>
            <button onClick={closeDetail} aria-label="Fermer" style={{ position:"absolute", top:8, right:10, zIndex:1,
              background:"none", border:"none", color:"var(--muted)", fontSize:20, cursor:"pointer" }}>✕</button>
            <Card it={byId[detail]} sheet others={ringBy[detail]} shared={shared(byId[detail])} rivals={rivalsOf(byId[detail])}
              tickets={canSpend ? data.keys?.wheel?.tickets || 0 : 0} onTicket={() => useTicket(detail)}
              keys={canSpend ? data.keys : null} onSpend={() => spend(detail)} keyErr={keyErr}/>
          </div>
        </div>, document.body
      )}
    </div>
  );
}

// Une medaille de la grille d'une section : grisee tant qu'elle n'est pas
// gagnee, avec un petit liseré de progression vers le palier suivant.
function Tile({ it, onOpen, others, shared, rivals }) {
  const got = it.level >= 0;
  const top = got ? it.tiers[it.level] : it.tiers[0];
  const p = progress(it);
  // succes a paliers : les copains qui sont devant moi
  const ahead = it.tiers.length > 1 ? (rivals || []).filter(r => r.level > it.level) : [];
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
      {ahead.length > 0 && (
        <span title={`${ahead.map(r => r.name).join(", ")} : devant toi`}
          style={{ position:"absolute", top:4, left:4, display:"flex", alignItems:"center", gap:1, padding:"1px 4px 1px 2px",
          borderRadius:20, background:"rgba(139,92,246,0.15)" }}>
          <span style={{ fontSize:9, fontWeight:900, color:"#8B5CF6", lineHeight:1 }}>▲</span>
          {ahead.slice(0, 2).map((r, i) => <Avatar key={r.name} name={r.name} size={15} style={{ marginLeft: i ? -5 : 0 }}/>)}
          {ahead.length > 2 && <span style={{ fontSize:9, fontWeight:800, color:"#8B5CF6" }}>+{ahead.length - 2}</span>}
        </span>
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
// Le score dans une jauge : l'anneau prend la couleur du palier atteint (un
// neuvieme du chemin par palier), le nombre monte au chargement.
function ScoreRing({ score, max, tiers, size = 138 }) {
  const ladder = tiers.filter(t => t.id !== "unique");
  const v = max ? Math.max(0, Math.min(1, score / max)) : 0;
  const t = ladder[Math.min(ladder.length - 1, Math.floor(v * ladder.length))] || ladder[0];
  const [shown, setShown] = useState(0);
  const [go, setGo] = useState(false);
  useEffect(() => {
    let raf, t0;
    const step = ts => {
      t0 = t0 || ts;
      const k = Math.min(1, (ts - t0) / 1100);
      setShown(Math.round(score * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const g = setTimeout(() => setGo(true), 50);
    return () => { cancelAnimationFrame(raf); clearTimeout(g); };
  }, [score]);
  const R = 56, C = 2 * Math.PI * R;
  const k = size / 138;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <div aria-hidden="true" style={{ position:"absolute", inset:8, borderRadius:"50%",
        background:`radial-gradient(circle, ${t.color}33, transparent 70%)`, animation:"bn-ring-glow 3s ease-in-out infinite" }}/>
      <svg width={size} height={size} viewBox="0 0 138 138" style={{ position:"absolute", inset:0, transform:"rotate(-90deg)" }}>
        <circle cx="69" cy="69" r={R} fill="none" stroke="var(--surface2)" strokeWidth="10"/>
        <circle cx="69" cy="69" r={R} fill="none" stroke={t.color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={go ? C * (1 - v) : C}
          style={{ transition:"stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)", filter:`drop-shadow(0 0 4px ${t.color})` }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontSize:27 * k, fontWeight:900, color:"var(--text)", fontVariantNumeric:"tabular-nums", lineHeight:1 }}>
          {shown.toLocaleString("fr-FR")}</span>
        <span style={{ fontSize:Math.max(10, 11 * k), color:"var(--muted)", marginTop:2 }}>points</span>
        <span style={{ marginTop:4, fontSize:Math.max(10, 11 * k), fontWeight:900, padding:"1px 8px", borderRadius:20, color:"#fff",
          background:t.color }}>{Math.round(v * 100)} %</span>
      </div>
    </div>
  );
}

// Le bandeau du score : la jauge, et a cote ton rang general, ce qu'il manque
// pour le suivant, tes succes et tes secrets.
function ScoreHero({ data }) {
  const ladder = data.tiers.filter(t => t.id !== "unique");
  const max = data.score_max || 1;
  const i = Math.min(ladder.length - 1, Math.floor(Math.min(1, data.score / max) * ladder.length));
  const t = ladder[i], nx = ladder[i + 1];
  const need = nx ? Math.max(0, Math.ceil(((i + 1) / ladder.length) * max) - data.score) : 0;
  const items = data.items || [];
  const tiered = items.filter(x => x.tiers.length > 1);
  const got = tiered.filter(x => x.level >= 0).length;
  const done = tiered.filter(x => x.next == null && x.level >= 0).length;
  const chip = (bg, c) => ({ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 9px", borderRadius:20,
    fontSize:11.5, fontWeight:700, background:bg, color:c, whiteSpace:"nowrap" });
  return (
    <div style={{ display:"flex", alignItems:"center", gap:14, flex:"1 1 300px", maxWidth:420, minWidth:0 }}>
      <ScoreRing score={data.score} max={data.score_max} tiers={data.tiers} size={112}/>
      <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:6 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <Medal tier={t} emoji="" size={34}/>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:11, color:"var(--muted)", fontWeight:700, letterSpacing:".06em", textTransform:"uppercase" }}>Rang</div>
            <div style={{ fontSize:19, fontWeight:900, color:t.color, lineHeight:1.1 }}>{t.label}</div>
          </div>
        </div>
        {nx && <div style={{ fontSize:12, color:"var(--text2)" }}>
          encore <b>{need.toLocaleString("fr-FR")} pts</b> pour <span style={{ color:nx.color, fontWeight:800 }}>{nx.label}</span></div>}
        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          <span style={chip("rgba(59,130,246,0.12)", "#3b82f6")}>🏅 {got}/{tiered.length} succès</span>
          {done > 0 && <span style={chip("rgba(34,197,94,0.12)", "#16a34a")}>✓ {done} au max</span>}
          <span style={chip("rgba(236,72,153,0.12)", "#db2777")}>🔮 {data.medals?.unique || 0} secrets</span>
        </div>
      </div>
    </div>
  );
}

// La vitrine : chaque palier, sa medaille (animee aux hauts rangs) et combien tu en as.
function MedalShelf({ tiers, medals, onOpen }) {
  return (
    <div style={{ position:"relative", display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(48px, 1fr))", gap:"10px 4px",
      padding:"10px 6px 14px", borderRadius:14, background:"linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.06))" }}>
      {tiers.map(t => {
        const n = medals[t.id] || 0;
        return (
          <button key={t.id} title={`${t.label} : ${n} — voir ces médailles`} onClick={() => onOpen?.(t.id)}
            style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, minWidth:0, background:"none",
              border:"none", padding:0, cursor:"pointer", font:"inherit" }}>
            <Medal tier={t} emoji="" size={36} locked={!n}/>
            <span style={{ fontSize:16, fontWeight:900, lineHeight:1.1, fontVariantNumeric:"tabular-nums",
              color: n ? "var(--text)" : "var(--muted)" }}>{n}</span>
            <span style={{ fontSize:9.5, color:"var(--muted)", whiteSpace:"nowrap", maxWidth:"100%", overflow:"hidden",
              textOverflow:"ellipsis" }}>{t.label}</span>
          </button>
        );
      })}
      <span aria-hidden="true" style={{ position:"absolute", left:10, right:10, bottom:6, height:3, borderRadius:3,
        background:"linear-gradient(90deg, transparent, var(--border), transparent)" }}/>
    </div>
  );
}

// La vitrine : toutes mes medailles gagnees, rangees sur des etageres de verre,
// une par type (Bronze… Eternel, Unique). Ouverte sur un type, elle ne montre
// que lui. Toucher une medaille ouvre sa fiche.
function Showcase({ data, tier, onTier, onOpen, onClose }) {
  useEffect(() => { egg("showcase"); }, []);
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const shelves = data.tiers.map(t => ({
    t,
    items: data.items.flatMap(it => it.tiers.filter(x => x.id === t.id && x.at).map(x => ({ it, at: x.at })))
      .sort((a, b) => String(b.at).localeCompare(String(a.at))),
  }));
  const shown = shelves.filter(s => (tier == null || s.t.id === tier) && s.items.length);
  const total = shelves.reduce((n, s) => n + s.items.length, 0);
  const chip = (on, c) => ({ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px 4px 5px", borderRadius:20,
    fontSize:11.5, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0,
    border:`1px solid ${on ? c : "var(--border)"}`, color: on ? "var(--text)" : "var(--text2)",
    background: on ? rgba(c, 0.18) : "var(--surface2)" });
  return (
    <div data-no-pull="" className="ach-room" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4300,
      background:"rgba(8,4,20,0.72)", display:"flex", alignItems:"center", justifyContent:"center", padding:12 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:760, maxHeight:"92vh", display:"flex",
        flexDirection:"column", borderRadius:22, overflow:"hidden", position:"relative",
        // le meuble : cadre dore, fond de velours
        border:"3px solid #C9A227", boxShadow:"0 24px 70px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,236,170,0.35)",
        background:"radial-gradient(120% 60% at 50% 0%, rgba(255,215,0,0.16), transparent 60%), " +
          "radial-gradient(90% 70% at 50% 110%, rgba(139,92,246,0.20), transparent 60%), var(--sheet-bg)" }}>
        <div style={{ padding:"14px 16px 10px", display:"flex", flexDirection:"column", gap:10,
          borderBottom:"1px solid rgba(201,162,39,0.35)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:24 }}>🏛️</span>
            <span style={{ flex:1, minWidth:0 }}>
              <span style={{ display:"block", fontSize:17, fontWeight:900, color:"var(--text)" }}>Ta vitrine</span>
              <span style={{ fontSize:11.5, color:"var(--muted)" }}>{total} médaille{total > 1 ? "s" : ""} gagnée{total > 1 ? "s" : ""}
                {tier != null && ` · ${shown[0]?.items.length || 0} en ${data.tiers.find(t => t.id === tier)?.label}`}</span>
            </span>
            <button onClick={onClose} aria-label="Fermer" style={{ background:"none", border:"none", color:"var(--muted)",
              fontSize:22, cursor:"pointer" }}>✕</button>
          </div>
          <div className="no-scrollbar" style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:2 }}>
            <button onClick={() => onTier(null)} style={chip(tier == null, "#C9A227")}>
              <span style={{ width:18, textAlign:"center" }}>✨</span>Tout</button>
            {shelves.map(({ t, items }) => (
              <button key={t.id} onClick={() => onTier(t.id)} disabled={!items.length}
                style={{ ...chip(tier === t.id, t.color), opacity: items.length ? 1 : 0.45, cursor: items.length ? "pointer" : "default" }}>
                <Medal tier={t} emoji="" size={18} locked={!items.length}/>{t.label}
                <span style={{ color:"var(--muted)", fontWeight:700 }}>{items.length}</span></button>
            ))}
          </div>
        </div>
        <div style={{ overflowY:"auto", padding:"6px 14px 18px", display:"flex", flexDirection:"column", gap:18 }}>
          {!shown.length && <p style={{ ...msg, textAlign:"center" }}>Aucune médaille de ce type pour l'instant.</p>}
          {shown.map(({ t, items }) => (
            <div key={t.id} style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 2px 0" }}>
                <Medal tier={t} emoji="" size={22}/>
                <span style={{ fontSize:13, fontWeight:900, color:t.color }}>{t.label}</span>
                <span style={{ fontSize:11.5, color:"var(--muted)", fontWeight:700 }}>{items.length}</span>
                <span style={{ flex:1, height:1, background:`linear-gradient(90deg, ${rgba(t.color, 0.5)}, transparent)` }}/>
              </div>
              {/* l'etagere : un fond de verre teinte, et une tablette eclairee dessous */}
              <div style={{ position:"relative", borderRadius:14, padding:"12px 8px 16px",
                background:`linear-gradient(180deg, ${rgba(t.color, 0.10)}, ${rgba(t.color, 0.03)} 70%, ${rgba(t.color, 0.16)})`,
                border:`1px solid ${rgba(t.color, 0.28)}`, boxShadow:"inset 0 1px 0 rgba(255,255,255,0.25)" }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(78px, 1fr))", gap:"12px 6px" }}>
                  {items.map(({ it, at }) => (
                    <button key={it.id} onClick={() => onOpen(it.id)} title={`${it.name} · ${dateFr(at)}`}
                      style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, minWidth:0, background:"none",
                        border:"none", padding:"2px 0", cursor:"pointer", font:"inherit" }}>
                      <Medal tier={t} emoji={it.emoji} size={46}/>
                      <span style={{ fontSize:10.5, fontWeight:700, color:"var(--text)", textAlign:"center", lineHeight:1.2,
                        maxWidth:"100%", overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2,
                        WebkitBoxOrient:"vertical" }}>{it.name}</span>
                    </button>
                  ))}
                </div>
                <span aria-hidden="true" style={{ position:"absolute", left:8, right:8, bottom:5, height:4, borderRadius:4,
                  background:`linear-gradient(90deg, transparent, ${rgba(t.color, 0.55)}, transparent)`,
                  boxShadow:`0 2px 10px ${rgba(t.color, 0.45)}` }}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Ce que tu as (cles, tickets) a gauche, la machine a sous a droite : la
// toucher ouvre la roue.
function useNarrow(px = 640) {
  const q = `(max-width: ${px}px)`;
  const [n, setN] = useState(() => typeof window !== "undefined" && window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setN(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [q]);
  return n;
}

function Treasure(props) {
  return useNarrow() ? <TreasureRow {...props}/> : <TreasureWide {...props}/>;
}

// Sur telephone : cles, tickets et roue cote a cote, trois cases.
function TreasureRow({ keys, onRules, onWheel }) {
  const [open, setOpen] = useState(false);
  const log = keys.log || [];
  const w = keys.wheel;
  const per = w?.secrets_per_ticket || 5;
  const toT = w?.to_ticket || per;
  const perP = w?.prints_per_ticket || 5, toTP = w?.to_ticket_prints || perP;
  const perS = w?.prints_per_spin || 8, toSP = w?.to_spin_prints || perS;
  const prints = keys.rules?.prints || 10;
  const has = (w?.spins || 0) > 0;
  const box = (glow, edge) => ({ position:"relative", overflow:"hidden", borderRadius:14, padding:"10px 6px 8px", minWidth:0,
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-start", gap:3, textAlign:"center",
    background:`radial-gradient(circle at 50% 0%, ${glow}, transparent 70%), var(--surface2)`, border:`1px solid ${edge}` });
  const iconSlot = { height:30, display:"flex", alignItems:"center", justifyContent:"center" };
  const mini = (pct, c) => <div style={{ width:"80%", height:4, borderRadius:4, background:"var(--surface)", overflow:"hidden", marginTop:2 }}>
    <div style={{ width:`${pct}%`, height:"100%", background:c }}/></div>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0, 1fr))", gap:8 }}>
        <button onClick={() => log.length && setOpen(o => !o)} style={{ ...box("rgba(250,204,21,.35)", "rgba(250,204,21,.45)"), cursor:"pointer",
          font:"inherit", color:"inherit", margin:0, justifyContent:"flex-start" }}>
          <span style={iconSlot}><span style={{ fontSize:24, lineHeight:1, animation:"bn-float 3.5s ease-in-out infinite" }}>🔑</span></span>
          <span style={{ fontSize:24, fontWeight:900, lineHeight:1, background:"linear-gradient(180deg,#fde047,#f59e0b)",
            WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }}>{keys.balance}</span>
          <span style={{ fontSize:10.5, color:"var(--muted)", fontWeight:700 }}>clés</span>
          {mini(Math.round(100 * (1 - (keys.to_next || prints) / prints)), "linear-gradient(90deg,#fde047,#f59e0b)")}
          <span style={{ fontSize:9.5, color:"var(--muted)" }}>dans {keys.to_next} impr.</span>
        </button>
        {w && (
          <div style={box("rgba(249,115,22,.32)", "rgba(249,115,22,.45)")}>
            <span style={iconSlot}><span style={{ display:"inline-flex", animation:"bn-float 4s ease-in-out infinite" }}>
              <TicketStub size={1.15} dim={!w.tickets}/></span></span>
            <span style={{ fontSize:24, fontWeight:900, lineHeight:1, color:"#f97316" }}>{w.tickets || 0}</span>
            <span style={{ fontSize:10.5, color:"var(--muted)", fontWeight:700 }}>tickets</span>
            {mini(Math.round(100 * (1 - toTP / perP)), "linear-gradient(90deg,#fb923c,#f97316)")}
            <span style={{ fontSize:9.5, color:"var(--muted)" }}>dans {toTP} impr.</span>
          </div>
        )}
        {w && (
          <div role={onWheel ? "button" : undefined} onClick={onWheel || undefined} style={{ position:"relative", borderRadius:14,
            padding:"8px 6px", minWidth:0, display:"flex", flexDirection:"column", alignItems:"center", gap:4,
            cursor: onWheel ? "pointer" : "default", background:"linear-gradient(180deg,#c81e1e,#7f1d1d)", border:"2px solid #f59e0b",
            boxShadow:"0 6px 16px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.25)" }}>
            <div aria-hidden="true" style={{ position:"absolute", inset:3, pointerEvents:"none" }}>
              {[[10, 0], [50, 0], [90, 0], [10, 100], [50, 100], [90, 100]].map(([x, y], i) => <span key={i} style={{ position:"absolute",
                width:5, height:5, borderRadius:"50%", background:"#fde047", left:`calc(${x}% - 2.5px)`, top:`calc(${y}% - 2.5px)`,
                animation:`bn-lamp ${has ? 0.9 : 1.6}s ${i * 0.12}s infinite` }}/>)}
            </div>
            <span style={{ fontSize:10, fontWeight:900, color:"#fde047", letterSpacing:".08em", marginTop:2,
              textShadow:"0 1px 0 #7c2d12" }}>🎰 ROUE</span>
            <div style={{ display:"flex", gap:2, padding:2, borderRadius:6, background:"#1c1917", width:"92%" }}>
              {[8, 6, 10].map((d, i) => {
                const seq = [...IDLE.slice(i * 3), ...IDLE.slice(0, i * 3)];
                return (
                  <div key={i} style={{ flex:1, height:24, overflow:"hidden", borderRadius:4, background:"#fff" }}>
                    <div style={{ animation:`bn-reel-idle ${d}s linear infinite` }}>
                      {[...seq, ...seq].map((x, j) => <div key={j} style={{ height:24, display:"flex", alignItems:"center",
                        justifyContent:"center", fontSize:14 }}>{x}</div>)}
                    </div>
                  </div>
                );
              })}
            </div>
            <span style={{ fontFamily:"'Courier New', monospace", fontWeight:900, color:"#fb923c", background:"#0c0a09",
              borderRadius:5, padding:"0 6px", fontSize:14, textShadow:"0 0 6px #f97316" }}>{String(w.spins || 0).padStart(2, "0")}</span>
            <span style={{ fontSize:9.5, fontWeight:900, color:"#7c2d12", borderRadius:8, padding:"3px 0", width:"92%", textAlign:"center",
              background: has ? "linear-gradient(180deg,#fde047,#f59e0b)" : "#d6c79f",
              animation: has && onWheel ? "bn-press 2s ease-in-out infinite" : "none" }}>{has ? "TOURNER" : "LUNDI"}</span>
          </div>
        )}
      </div>
      {open && (
        <div style={{ borderRadius:12, padding:"8px 10px", background:"var(--surface2)", border:"1px solid var(--border)",
          display:"flex", flexDirection:"column", gap:3, fontSize:12, color:"var(--text2)" }}>
          {log.slice(0, 12).map((l, i) => (
            <div key={i} style={{ display:"flex", gap:8 }}>
              <span style={{ width:30, flexShrink:0, fontWeight:800, color: l.n > 0 ? "#22c55e" : l.n < 0 ? "#ef4444" : "var(--muted)" }}>
                {l.n > 0 ? `+${l.n}` : l.n || "·"}</span>
              <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.why}</span>
              <span style={{ color:"var(--muted)", fontSize:11 }}>{dateFr(l.at)}</span>
            </div>
          ))}
          <button onClick={onRules} style={{ alignSelf:"flex-start", marginTop:4, background:"none", border:"none", padding:0,
            fontSize:11.5, fontWeight:700, color:"#F59E0B", cursor:"pointer" }}>Comment gagner et dépenser des clés ?</button>
        </div>
      )}
    </div>
  );
}

function TreasureWide({ keys, onRules, onWheel }) {
  const [open, setOpen] = useState(false);
  const log = keys.log || [];
  const w = keys.wheel;
  const hero = (glow, edge) => ({ position:"relative", overflow:"hidden", borderRadius:16, padding:"12px 14px",
    background:`radial-gradient(circle at 12% 50%, ${glow}, transparent 60%), var(--surface2)`, border:`1px solid ${edge}` });
  const glint = <span aria-hidden="true" style={{ position:"absolute", top:"-40%", bottom:"-40%", width:"28%", pointerEvents:"none",
    background:"linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent)", animation:"bn-glint 4.5s ease-in-out infinite" }}/>;
  const per = w?.secrets_per_ticket || 5;
  const toT = w?.to_ticket || per;
  const perP = w?.prints_per_ticket || 5, toTP = w?.to_ticket_prints || perP;
  const perS = w?.prints_per_spin || 8, toSP = w?.to_spin_prints || perS;
  const prints = keys.rules?.prints || 10;
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:12 }}>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {/* cles */}
        <div style={hero("rgba(250,204,21,.30)", "rgba(250,204,21,.4)")}>
          {glint}
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <span style={{ fontSize:38, animation:"bn-float 3.5s ease-in-out infinite",
              filter:"drop-shadow(0 4px 10px rgba(250,204,21,.5))" }}>🔑</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <span style={{ fontSize:34, fontWeight:900, lineHeight:1, background:"linear-gradient(180deg,#fde047,#f59e0b)",
                  WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }}>{keys.balance}</span>
                <span style={{ fontSize:12.5, fontWeight:700, color:"var(--text2)" }}>clé{keys.balance > 1 ? "s" : ""}</span>
              </div>
              <div style={{ fontSize:11.5, color:"var(--muted)" }}>pour révéler les secrets</div>
              <div style={{ height:6, borderRadius:6, background:"var(--surface)", overflow:"hidden", marginTop:6 }}>
                <div style={{ width:`${Math.round(100 * (1 - (keys.to_next || prints) / prints))}%`, height:"100%",
                  background:"linear-gradient(90deg,#fde047,#f59e0b)" }}/></div>
              <div style={{ fontSize:11, color:"var(--muted)", marginTop:3 }}>
                prochaine dans {keys.to_next} impression{keys.to_next > 1 ? "s" : ""} réussie{keys.to_next > 1 ? "s" : ""}</div>
            </div>
            {log.length > 0 && <button onClick={() => setOpen(o => !o)} style={{ alignSelf:"flex-start", background:"var(--surface)",
              border:"1px solid var(--border)", borderRadius:20, padding:"3px 9px", fontSize:11, color:"var(--muted)", cursor:"pointer",
              position:"relative" }}>Historique {open ? "▾" : "▸"}</button>}
          </div>
          {open && (
            <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:3, fontSize:12, color:"var(--text2)", position:"relative" }}>
              {log.slice(0, 12).map((l, i) => (
                <div key={i} style={{ display:"flex", gap:8 }}>
                  <span style={{ width:34, flexShrink:0, fontWeight:800, color: l.n > 0 ? "#22c55e" : l.n < 0 ? "#ef4444" : "var(--muted)" }}>
                    {l.n > 0 ? `+${l.n}` : l.n || "·"}</span>
                  <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.why}</span>
                  <span style={{ color:"var(--muted)", fontSize:11 }}>{dateFr(l.at)}</span>
                </div>
              ))}
              <button onClick={onRules} style={{ alignSelf:"flex-start", marginTop:4, background:"none", border:"none", padding:0,
                fontSize:11.5, fontWeight:700, color:"#F59E0B", cursor:"pointer" }}>Comment gagner et dépenser des clés ?</button>
            </div>
          )}
        </div>
        {/* tickets, a part */}
        {w && (
          <div style={hero("rgba(249,115,22,.28)", "rgba(249,115,22,.4)")}>
            {glint}
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ position:"relative", width:96, height:52, flexShrink:0 }}>
                {[[-16, .55, 0], [-7, .8, 9], [3, 1, 18]].map(([r, o, x], i) => (
                  <span key={i} style={{ position:"absolute", left:x, top:10, transform:`rotate(${r}deg)`, opacity:o }}>
                    <TicketStub n={i === 2 ? w.tickets || 0 : null} size={1.5} dim={!w.tickets}/></span>
                ))}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:900, fontSize:14, color:"var(--text)" }}>Tickets de palier</div>
                <div style={{ fontSize:11.5, color:"var(--muted)" }}>
                  +{w.weekly_tickets || 1} chaque lundi · 1 toutes les {perP} impressions · 1 tous les {per} secrets</div>
                <div style={{ height:6, borderRadius:6, background:"var(--surface)", overflow:"hidden", marginTop:6 }}>
                  <div style={{ width:`${Math.round(100 * (1 - toTP / perP))}%`, height:"100%",
                    background:"linear-gradient(90deg,#fb923c,#f97316)" }}/></div>
                <div style={{ fontSize:11, color:"var(--muted)", marginTop:3 }}>
                  prochain dans {toTP} impression{toTP > 1 ? "s" : ""} réussie{toTP > 1 ? "s" : ""} (ou {toT} secret{toT > 1 ? "s" : ""}) · à utiliser dans un succès</div>
              </div>
            </div>
          </div>
        )}
      </div>
      {w && <MiniMachine w={w} onOpen={onWheel}/>}
    </div>
  );
}

// La machine a sous en vitrine : rouleaux au ralenti, ampoules, compteur des tours.
const IDLE = ["🔑", "🍀", "💎", "🎟️", "💰", "🔁", "🍒", "🔍"];
const LAMPS = [...[6, 20, 34, 48, 62, 76, 90].map(x => [x, 0]), ...[30, 60].map(y => [100, y]),
  ...[90, 76, 62, 48, 34, 20, 6].map(x => [x, 100]), ...[60, 30].map(y => [0, y])];
function MiniMachine({ w, onOpen }) {
  const perS = w?.prints_per_spin || 8, toSP = w?.to_spin_prints || perS;
  const can = !!onOpen;
  const has = (w.spins || 0) > 0;
  return (
    <div role={can ? "button" : undefined} tabIndex={can ? 0 : undefined} onClick={can ? onOpen : undefined}
      onKeyDown={e => { if (can && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      title={can ? "Ouvrir la machine à sous" : undefined}
      style={{ position:"relative", borderRadius:20, padding:"14px 16px 16px", cursor: can ? "pointer" : "default",
        background:"linear-gradient(180deg,#c81e1e,#7f1d1d)", border:"3px solid #f59e0b", marginRight:12,
        boxShadow:"0 10px 30px rgba(0,0,0,.35), inset 0 2px 0 rgba(255,255,255,.25)", transition:"transform .15s" }}
      onMouseEnter={e => { if (can) e.currentTarget.style.transform = "translateY(-2px) scale(1.01)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; }}>
      <div aria-hidden="true" style={{ position:"absolute", inset:5, pointerEvents:"none" }}>
        {LAMPS.map(([x, y], i) => <span key={i} style={{ position:"absolute", width:7, height:7, borderRadius:"50%", background:"#fde047",
          left:`calc(${x}% - 3.5px)`, top:`calc(${y}% - 3.5px)`, animation:`bn-lamp ${has ? 0.9 : 1.6}s ${i * 0.08}s infinite` }}/>)}
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
        <span style={{ fontWeight:900, color:"#fde047", letterSpacing:".05em", fontSize:14.5,
          textShadow:"0 2px 0 #7c2d12, 0 0 10px rgba(253,224,71,.6)" }}>🎰 ROUE DE LA FORTUNE</span>
        <span style={{ fontFamily:"'Courier New', monospace", fontWeight:900, color:"#fb923c", background:"#0c0a09",
          border:"2px solid #44403c", borderRadius:8, padding:"2px 8px", letterSpacing:".1em", textShadow:"0 0 8px #f97316",
          fontSize:18 }}>{String(w.spins || 0).padStart(2, "0")}</span>
      </div>
      <div style={{ display:"flex", gap:6, padding:6, borderRadius:12, background:"#1c1917", boxShadow:"inset 0 4px 10px rgba(0,0,0,.8)",
        margin:"10px 0" }}>
        {[9, 7, 11].map((d, i) => {
          const seq = [...IDLE.slice(i * 3), ...IDLE.slice(0, i * 3)];
          return (
            <div key={i} style={{ flex:1, height:62, overflow:"hidden", borderRadius:8, position:"relative",
              background:"linear-gradient(180deg,#e7e5e4,#fff 40%,#fff 60%,#d6d3d1)" }}>
              <div style={{ animation:`bn-reel-idle ${d}s linear infinite` }}>
                {[...seq, ...seq].map((x, j) => <div key={j} style={{ height:62, display:"flex", alignItems:"center",
                  justifyContent:"center", fontSize:32 }}>{x}</div>)}
              </div>
              <div aria-hidden="true" style={{ position:"absolute", inset:0,
                background:"linear-gradient(180deg,rgba(0,0,0,.28),transparent 30%,transparent 70%,rgba(0,0,0,.28))" }}/>
            </div>
          );
        })}
      </div>
      <div style={{ textAlign:"center", color:"rgba(255,255,255,.85)", fontSize:11.5 }}>
        +{w.weekly || 3} chaque lundi · +1 toutes les {perS} impressions · +{w.per_secret || 1} par secret · prochain dans {toSP} impr.</div>
      <div style={{ marginTop:9, padding:"10px 0", borderRadius:12, textAlign:"center", fontWeight:900, letterSpacing:".08em",
        fontSize:13.5, color:"#7c2d12", boxShadow: has ? "0 4px 0 #b45309" : "none",
        background: has ? "linear-gradient(180deg,#fde047,#f59e0b)" : "linear-gradient(180deg,#e7d9b4,#bfae86)",
        animation: has && can ? "bn-press 2s ease-in-out infinite" : "none" }}>
        {has ? (can ? "TOURNER" : `${w.spins} TOUR${w.spins > 1 ? "S" : ""}`) : "PROCHAINS TOURS LUNDI"}</div>
      <span aria-hidden="true" style={{ position:"absolute", right:-15, top:46, width:8, height:70, borderRadius:4,
        background:"linear-gradient(90deg,#9ca3af,#e5e7eb,#9ca3af)" }}>
        <span style={{ position:"absolute", top:-14, left:-7, width:22, height:22, borderRadius:"50%",
          background:"radial-gradient(circle at 35% 35%,#fca5a5,#dc2626)" }}/></span>
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

// Barre du score : sa couleur suit l'avancement, palier par palier (un neuvieme
// du chemin par palier : Bronze au debut, Eternel tout au bout).
function Bar({ value, tiers }) {
  const ladder = (tiers || []).filter(t => t.id !== "unique");
  const v = Math.max(0, Math.min(1, value));
  const color = ladder.length ? ladder[Math.min(ladder.length - 1, Math.floor(v * ladder.length))].color : "#F59E0B";
  return (
    <div style={{ height:8, borderRadius:8, background:"var(--surface2)", overflow:"hidden", width:"100%" }}>
      <div style={{ width:`${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, height:"100%", borderRadius:8,
        background: color, transition:"background .3s" }}/>
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

function Card({ it, focus, sheet = false, others, shared, keys, onSpend, keyErr, rivals, tickets = 0, onTicket }) {
  const [sure, setSure] = useState(false);       // ticket : un second toucher pour confirmer
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
  // une medaille gagnee, ca s'astique
  const [shine, setShine] = useState(0);
  const polish = useMemo(() => tapper(10, 5000, () => egg("polish")), []);
  const pick = useMemo(() => tapper(10, 5000, () => egg("lockpick")), []);
  return (
    <div ref={ref} className="card" onClick={() => !sheet && setOpen(o => !o)}
      style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:9, cursor:"pointer",
        border: focus ? `2px solid ${top.color}` : undefined,
        boxShadow: focus ? `0 0 0 4px ${top.color}33` : undefined,
        // en feuille de detail : fond opaque des feuilles (la carte seule est translucide)
        background: sheet
          // feuille de detail : le decor de la page, eclaire par la couleur de la medaille
          ? `radial-gradient(90% 55% at 15% 0%, ${top.color}${done ? "33" : "1a"}, transparent 70%), ` +
            `radial-gradient(70% 50% at 100% 100%, rgba(139,92,246,0.14), transparent 70%), var(--sheet-bg)`
          : done ? `linear-gradient(135deg, ${top.color}1f, transparent 70%), var(--surface)` : undefined,
        ...(sheet ? { backdropFilter:"none", paddingRight:36, border:`1px solid ${top.color}66`,
          boxShadow:`0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06) inset, 0 0 30px ${top.color}33` } : {}) }}>
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        <span key={shine} onClick={e => {
            if (!sheet) return;
            e.stopPropagation(); setShine(n => n + 1);
            if (got) polish(); else if (unique) pick();
          }}
          style={{ display:"inline-flex", animation: !shine ? "none" : got ? "bn-shine .35s ease-out" : "bn-jiggle .3s ease-in-out" }}>
          <Medal tier={top} emoji={it.emoji} size={52} locked={!got}/></span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:800, color: got ? "var(--text)" : "var(--text2)" }}>{it.name}
            {it.tickets > 0 && <span title={`${it.tickets} palier${it.tickets > 1 ? "s" : ""} passé${it.tickets > 1 ? "s" : ""} avec un ticket`}
              style={{ marginLeft:6, fontSize:11, fontWeight:800, color:"#F59E0B" }}>🎟️{it.tickets > 1 ? `×${it.tickets}` : ""}</span>}</div>
          <div style={{ fontSize:12, color:"var(--muted)", marginTop:2, lineHeight:1.35,
            fontStyle: it.masked ? "italic" : "normal" }}>
            {it.masked ? "🔒 Descriptif caché" : unique && got ? it.desc : done ? `✓ Tous les paliers atteints · ${it.desc}`
              : unique ? it.desc : (
                // a paliers : ou j'en suis, et ce que demande le suivant
                <span style={{ display:"flex", flexDirection:"column", gap:3, marginTop:2 }}>
                  <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <span style={{ minWidth:58, fontSize:11, fontWeight:700 }}>Actuel</span>
                    {got ? <><Medal tier={top} emoji="" size={14}/><b style={{ color:"var(--text)" }}>{top.label}</b></>
                      : <span>pas encore de palier</span>}
                  </span>
                  <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <span style={{ minWidth:58, fontSize:11, fontWeight:700 }}>Prochain</span>
                    <Medal tier={it.tiers[it.level + 1]} emoji="" size={14} locked/>
                    <b style={{ color:"var(--text2)" }}>{it.tiers[it.level + 1]?.label}</b>
                  </span>
                  <span style={{ paddingLeft:63 }}>{it.desc}</span>
                </span>
              )}</div>
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
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              {it.tiers.map((t, i) => {
                const cur = i === it.level, nxt = i === it.level + 1;
                return (
                  <span key={t.id} title={cur ? `Actuel : ${t.label}` : nxt ? `Prochain : ${t.label}` : t.label}
                    style={{ position:"relative", display:"inline-flex", borderRadius:"50%", padding:2,
                      boxShadow: cur ? `0 0 0 2px ${t.color}` : "none",
                      outline: nxt ? "1.5px dashed var(--muted)" : "none", outlineOffset: nxt ? 1 : 0 }}>
                    <Medal tier={t} emoji="" size={18} locked={!t.at}/>
                    {nxt && <span style={{ position:"absolute", top:-9, left:"50%", transform:"translateX(-50%)", fontSize:8,
                      color:"var(--muted)" }}>▼</span>}
                  </span>
                );
              })}
            </div>
          </>
        )
      ) : null}
      {sheet && !unique && it.next != null && tickets > 0 && onTicket && (() => {
        const cost = it.ticket_cost || 1, enough = tickets >= cost;
        const nt = it.tiers[it.level + 1];
        const gain = fmt(it.next - (it.value || 0), it.unit);
        return (
          <div style={{ display:"flex", flexDirection:"column", gap:6, alignItems:"flex-start" }}>
            <button onClick={e => { e.stopPropagation(); if (!enough) return; if (sure) { setSure(false); onTicket(); } else setSure(true); }}
              disabled={!enough}
              style={{ display:"inline-flex", alignItems:"center", gap:10, padding:"7px 14px 7px 8px", borderRadius:20, textAlign:"left",
                fontSize:12.5, fontWeight:800, cursor: enough ? "pointer" : "default", border:"1px solid #F59E0B",
                background: sure ? "#F59E0B" : "rgba(245,158,11,0.12)", color: sure ? "#fff" : "#b45309", opacity: enough ? 1 : .6 }}>
              {/* ce qu'on depense : un ticket dessine, et combien */}
              <span style={{ display:"inline-flex", padding:"3px 4px", borderRadius:7, background: sure ? "rgba(124,45,18,.45)" : "transparent" }}>
                <TicketStub n={cost} size={1} dim={!enough}/></span>
              <span style={{ display:"flex", flexDirection:"column", lineHeight:1.3 }}>
                <span>{sure ? "Confirmer" : "Utiliser"} {cost} ticket{cost > 1 ? "s" : ""}</span>
                <span style={{ fontSize:11, fontWeight:700, opacity:.9 }}>
                  → passer <span style={{ color: sure ? "#fff" : nt?.color }}>{nt?.label}</span> · compteur +{gain}</span>
              </span>
            </button>
            {!enough && <span style={{ fontSize:11.5, color:"var(--muted)" }}>
              Il en faut {cost}, tu en as {tickets}.</span>}
          </div>
        );
      })()}
      {sheet && keyErr && !unique && <p style={{ margin:0, fontSize:12, color:"#ef4444" }}>{keyErr}</p>}
      {rivals?.length > 0 && (got || !it.secret) && (unique ? got && <PalsUnique rivals={rivals}/> : <Versus it={it} rivals={rivals}/>)}
      {open && !unique && (got || !it.secret) && (
        <div style={{ display:"flex", flexDirection:"column", gap:4, borderTop:"1px solid var(--border)", paddingTop:8 }}>
          {it.tiers.map(t => (
            <div key={t.id} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12,
              color: t.at ? "var(--text)" : "var(--muted)" }}>
              <Medal tier={t} emoji="" size={16} locked={!t.at}/>
              <span style={{ fontWeight:700, minWidth:58 }}>{t.label}</span>
              <span style={{ flex:1 }}>{money ? "" : it.tiers.length > 1 ? fmt(t.n, it.unit) : ""}</span>
              <span style={{ fontSize:11 }}>{t.ticket && <span title="Passé avec un ticket de palier">🎟️ </span>}{t.at ? dateFr(t.at) : "à gagner"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Les regles, en une feuille : paliers et points, secrets, cles, copains.
function Rules({ data, onClose }) {
  const ladder = data.tiers.filter(t => t.id !== "unique");
  const uniq = data.tiers.find(t => t.id === "unique");
  const k = data.keys;
  const cum = ladder.map((t, i) => ladder.slice(0, i + 1).reduce((a, x) => a + x.score, 0));
  const H = ({ children }) => <div style={{ fontSize:13, fontWeight:900, color:"var(--text)", margin:"14px 0 6px" }}>{children}</div>;
  const P = ({ children }) => <p style={{ margin:"0 0 6px", fontSize:12.5, color:"var(--text2)", lineHeight:1.55 }}>{children}</p>;
  return (
    <div data-no-pull="" className="ach-room" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4300, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width:"100%", maxWidth:460, maxHeight:"88vh", overflowY:"auto",
        padding:"16px 18px", background:"var(--sheet-bg)", backdropFilter:"none", position:"relative" }}>
        <button onClick={onClose} aria-label="Fermer" style={{ position:"absolute", top:8, right:10, background:"none", border:"none",
          color:"var(--muted)", fontSize:20, cursor:"pointer" }}>✕</button>
        <div style={{ fontSize:16, fontWeight:900, color:"var(--text)" }}>📖 Règles des succès</div>

        <H>🏅 Paliers et points</H>
        <P>Chaque succès a jusqu'à neuf paliers. Chaque palier gagné rapporte ses points, <b>et ceux d'en dessous restent
          acquis</b> : un succès en {ladder[2]?.label} vaut {cum[2]} points ({ladder.slice(0, 3).map(t => t.score).join(" + ")}).</P>
        <div style={{ display:"grid", gridTemplateColumns:"auto 1fr auto auto", gap:"4px 10px", alignItems:"center",
          fontSize:12, margin:"4px 0 8px" }}>
          <span/><span style={{ color:"var(--muted)" }}>Palier</span><span style={{ color:"var(--muted)", textAlign:"right" }}>pts</span>
          <span style={{ color:"var(--muted)", textAlign:"right" }}>cumul</span>
          {ladder.map((t, i) => (
            <React.Fragment key={t.id}>
              <Medal tier={t} emoji="" size={16}/>
              <span style={{ fontWeight:700, color:"var(--text)" }}>{t.label}</span>
              <span style={{ textAlign:"right", fontWeight:800, color:"var(--text)" }}>{t.score}</span>
              <span style={{ textAlign:"right", color:"var(--muted)" }}>{cum[i]}</span>
            </React.Fragment>
          ))}
          {uniq && <>
            <Medal tier={uniq} emoji="" size={16}/>
            <span style={{ fontWeight:700, color:"var(--text)" }}>{uniq.label} (secret)</span>
            <span style={{ textAlign:"right", fontWeight:800, color:"var(--text)" }}>{uniq.score}</span><span/>
          </>}
        </div>
        <P>Ton <b>score</b> est la somme de tous les points gagnés ; le total possible additionne tous les paliers de tous les
          succès. Les seuils des paliers se voient dans le détail de chaque succès.</P>
        <P>Un succès qui a <b>moins de neuf seuils</b> (un plafond naturel : 5 AMS, le niveau MakerWorld…) les place en haut de
          l'échelle : son premier seuil donne d'un coup tous les paliers d'en dessous.</P>
        <P>Ce qui se lit <b>au présent</b> (stock, MakerWorld, copains…) garde ce qui a été gagné, même si la valeur redescend.</P>
        <P>Certains gestes ne laissent de trace nulle part ailleurs : l'appli les note elle-même <b>à partir du moment où elle
          les voit</b> (séchages dans l'AMS, pesées, réassorts, visites chez tes copains et des copains chez toi). Tes
          évaluations et tes points MakerWorld, eux, sont relus sur <b>tout ton historique</b>.</P>
        <P>Quand des seuils changent ou qu'un succès apparaît, tout se recalcule en silence : ce que ton historique méritait
          déjà t'est donné, sans notification ni clé.</P>

        <H>🤫 Secrets</H>
        <P>Une médaille unique, cachée tant qu'elle n'est pas gagnée. Les secrets inconnus attendent dans « À découvrir » ;
          une fois gagnés, ils rejoignent leur sous-section. Les <b>collections</b> récompensent une section entière à un même
          palier.</P>

        {k && <>
          <H>🔑 Clés</H>
          <P><b>Gagner des clés</b> : {k.rules.start} au départ · 1 toutes les {k.rules.prints} impressions réussies ·
            {" "}{k.rules.tier} par palier franchi · {k.rules.secret} par secret gagné. Et parfois, une surprise.
            Rien de rétroactif : ce qui est reconnu après coup ne rapporte rien.</P>
          <P><b>Les dépenser</b> pour révéler un secret pas encore gagné, une étape après l'autre :</P>
          <div style={{ display:"flex", flexDirection:"column", gap:3, margin:"0 0 6px 4px", fontSize:12.5, color:"var(--text2)" }}>
            {k.steps.map((st, i) => <span key={st.id}>{i + 1}. {st.label.charAt(0).toUpperCase() + st.label.slice(1)} — {st.cost} 🔑</span>)}
          </div>
        </>}

        {k?.wheel && <>
          <H>🎰 Roue de la fortune</H>
          <P>{k.wheel.start} tours offerts au départ, puis {k.wheel.weekly} chaque lundi (une semaine manquée ne se rattrape pas).
            Toutes les {k.wheel.prints_per_spin || 8} impressions réussies, un tour de plus
            {k.wheel.to_spin_prints ? ` (le prochain dans ${k.wheel.to_spin_prints} impression${k.wheel.to_spin_prints > 1 ? "s" : ""})` : ""},
            et chaque secret gagné en offre {k.wheel.per_secret || 1}.
            Chaque tour tire un lot ; plus un lot vaut, plus il est rare :</P>
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:"3px 12px", fontSize:12.5, color:"var(--text2)",
            margin:"0 0 8px 4px" }}>
            {k.wheel.prizes.map(p => (
              <React.Fragment key={p.id}>
                <span>{p.label}{p.help && <span style={{ display:"block", fontSize:11, color:"var(--muted)" }}>{p.help}</span>}</span>
                <span style={{ textAlign:"right", fontWeight:700, fontVariantNumeric:"tabular-nums" }}>
                  {String(p.pct).replace(".", ",")} %</span>
              </React.Fragment>
            ))}
          </div>
          <P><b>Tickets de palier</b> <TicketStub size={0.8}/> : {k.wheel.weekly_tickets || 1} offert chaque lundi, un toutes
            les {k.wheel.prints_per_ticket || 5} impressions réussies, un tous les {k.wheel.secrets_per_ticket || 5} secrets, et la
            roue en donne{k.wheel.to_ticket_prints ? ` (le prochain dans ${k.wheel.to_ticket_prints} impression${k.wheel.to_ticket_prints > 1 ? "s" : ""}
            ou ${k.wheel.to_ticket} secret${k.wheel.to_ticket > 1 ? "s" : ""})` : ""}. Les impressions comptent à partir du
            22 octobre 2026 : celles d'avant ne rapportent ni tour ni ticket. Sur un succès à paliers (jamais un secret), ils
            ajoutent au compteur ce qui manquait pour le palier suivant : le compte avance pour de bon, la suite se compte à
            partir de là. Le prix dépend du palier visé :</P>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 12px", margin:"0 0 8px 4px", fontSize:12, color:"var(--text2)" }}>
            {(k.wheel.ticket_costs || []).map((c, i) => data.tiers[i] && (
              <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                <Medal tier={data.tiers[i]} emoji="" size={14}/>{data.tiers[i].label} <b>{c}</b></span>
            ))}
          </div>
          <P>Un palier passé avec des tickets ne rapporte pas de clé, et il est marqué 🎟️, chez toi comme chez tes copains.</P>
          <P>Un tour peut aussi faire franchir des paliers ou débloquer un secret : leurs clés s'ajoutent au lot, et la
            machine les affiche en bonus. Les paliers de la section « Clés et roue » ne rapportent pas de clé (sinon, des
            clés en appelleraient d'autres sans fin) ; ses secrets, si.</P>
        </>}

        <H>👥 Copains</H>
        <P>Le <b>podium</b> compare les scores, en tout et par section. Dans le détail d'un succès, l'échelle « Toi et tes copains »
          montre le palier de chacun ; dans la grille, ▲ signale un copain devant toi.</P>
        <P>Un secret qu'un copain a déjà est <b>cerclé</b> chez toi, et ses trois premières étapes te sont offertes
          (« grâce à … »). Ses descriptifs restent cachés, sauf si tu as le droit de voir ses secrets.</P>
      </div>
    </div>
  );
}

// Pastille d'une personne : « toi » en orange, un copain en violet (son initiale).
function Avatar({ name, me = false, size = 18, style }) {
  return (
    <span title={me ? "Toi" : name} style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, display:"inline-flex",
      alignItems:"center", justifyContent:"center", fontSize: me ? size * 0.42 : size * 0.55, fontWeight:900, color:"#fff",
      background: me ? "#F59E0B" : "#8B5CF6", border:"1.5px solid var(--sheet-bg)", lineHeight:1, ...style }}>
      {me ? "toi" : (name || "?").slice(0, 1).toUpperCase()}</span>
  );
}

// Moi et mes copains sur un succes a paliers : l'echelle des paliers avec
// chacun au-dessus du sien, puis la liste du plus avance au moins avance.
function Versus({ it, rivals }) {
  const people = [{ name:"Toi", me:true, level: it.level }, ...rivals];
  const stack = Math.max(1, ...it.tiers.map((_, i) => people.filter(p => p.level === i).length));
  const ranked = [...people].sort((a, b) => b.level - a.level || (b.me ? 1 : 0) - (a.me ? 1 : 0));
  return (
    <div onClick={e => e.stopPropagation()} style={{ display:"flex", flexDirection:"column", gap:8,
      borderTop:"1px solid var(--border)", paddingTop:8, cursor:"default" }}>
      <div style={{ fontSize:12, fontWeight:800, color:"var(--text2)" }}>👥 Toi et tes copains</div>
      <div style={{ display:"flex", gap:2, alignItems:"flex-end" }}>
        {it.tiers.map((t, i) => {
          const here = people.filter(p => p.level === i);
          return (
            <div key={t.id} style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
              <div style={{ display:"flex", flexDirection:"column-reverse", alignItems:"center", gap:2,
                minHeight: stack * 20 - 2, justifyContent:"flex-start" }}>
                {here.map(p => <Avatar key={p.name} name={p.name} me={p.me}/>)}
              </div>
              <Medal tier={t} emoji="" size={20} locked={!people.some(p => p.level >= i)}/>
              <span style={{ width:"100%", height:3, borderRadius:2,
                background: people.some(p => p.level >= i) ? t.color : "var(--border)" }}/>
            </div>
          );
        })}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {ranked.map(p => {
          const t = p.level >= 0 ? it.tiers[p.level] : null;
          const d = p.level - it.level;
          return (
            <div key={p.name} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12.5 }}>
              <Avatar name={p.name} me={p.me} size={20}/>
              <span style={{ flex:1, minWidth:0, fontWeight: p.me ? 800 : 700, color: p.me ? "#F59E0B" : "var(--text)",
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.me ? "Toi" : p.name}</span>
              <span style={{ display:"flex", alignItems:"center", gap:5, color: t ? "var(--text)" : "var(--muted)", fontWeight:700 }}>
                {t && <Medal tier={t} emoji="" size={16}/>}{t ? t.label : "pas encore"}</span>
              <span style={{ width:74, flexShrink:0, textAlign:"right", fontSize:11, fontWeight:800,
                color: p.me ? "transparent" : d > 0 ? "#8B5CF6" : d < 0 ? "#22c55e" : "var(--muted)" }}>
                {p.me ? "" : d > 0 ? `▲ devant toi` : d < 0 ? "▼ derrière toi" : "= à égalité"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Un secret gagne : qui l'a aussi parmi mes copains.
function PalsUnique({ rivals }) {
  const yes = rivals.filter(r => r.level >= 0), no = rivals.filter(r => r.level < 0);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4, fontSize:12.5, borderTop:"1px solid var(--border)", paddingTop:8 }}>
      {yes.length > 0 && <span style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", color:"var(--text)", fontWeight:700 }}>
        👥 L'ont aussi : {yes.map(r => <span key={r.name} style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
          <Avatar name={r.name}/>{r.name}</span>)}</span>}
      {no.length > 0 && <span style={{ color:"var(--muted)" }}>Pas encore : {no.map(r => r.name).join(", ")}</span>}
    </div>
  );
}

// Medaille : disque a la teinte du cran, liseré, ruban ; grisee tant qu'elle
// n'est pas gagnee.
export function Medal({ tier, emoji, size = 48, locked = false }) {
  const c = locked ? "#8a8f98" : tier.color;
  const id = `m${tier.id}${locked ? "l" : ""}`;
  // les hauts rangs vivent : reflet (Legende), halo (Mythique), etoiles (Cosmique), liseré arc-en-ciel (Eternel)
  const fx = !locked && size >= 30 ? tier.id : null;
  const big = size >= 30;
  const cy = size * (big ? 28 : 24) / 48, r = size * (big ? 18 : 21) / 48;
  const disc = { position:"absolute", left: size / 2 - r, top: cy - r, width: r * 2, height: r * 2, borderRadius:"50%" };
  return (
    <span style={{ position:"relative", width:size, height:size, flexShrink:0, display:"inline-flex",
      alignItems:"center", justifyContent:"center", opacity: locked ? 0.45 : 1 }}>
      {fx === "eternal" && (
        <span aria-hidden="true" style={{ ...disc, left: disc.left - 3, top: disc.top - 3, width: r * 2 + 6, height: r * 2 + 6,
          background:"conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)",
          animation:"bn-medal-turn 4s linear infinite" }}/>
      )}
      {fx === "mythic" && (
        <span aria-hidden="true" style={{ ...disc, "--glow": `${tier.color}cc`, animation:"bn-medal-pulse 2.2s ease-in-out infinite" }}/>
      )}
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
      {fx === "legend" && (
        <span aria-hidden="true" style={{ ...disc, overflow:"hidden" }}>
          <span style={{ position:"absolute", top:"-20%", bottom:"-20%", width:"35%",
            background:"linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent)",
            animation:"bn-medal-sweep 3s ease-in-out infinite" }}/>
        </span>
      )}
      {fx === "cosmic" && [[-0.05, 0.25, 0], [0.92, 0.18, 0.7], [0.85, 0.92, 1.3], [0.02, 0.85, 1.9]].map(([x, y, d], i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", left: size * x, top: size * y, fontSize: Math.max(8, size * 0.2),
          color:"#c7d2fe", textShadow:"0 0 6px #818cf8", animation:`bn-medal-twinkle 2.4s ${d}s ease-in-out infinite`,
          pointerEvents:"none", lineHeight:1 }}>✦</span>
      ))}
      {emoji && <span style={{ position:"relative", top: size >= 30 ? size * 0.08 : 0, fontSize:size * 0.36,
        filter: locked ? "grayscale(1)" : "none", lineHeight:1 }}>{emoji}</span>}
    </span>
  );
}

// Un ticket de palier dessine : bords echancres, talon perfore, et le nombre.
export function TicketStub({ n, size = 1, dim = false }) {
  const h = 18 * size, w = (n != null ? 40 : 26) * size;
  const notch = `radial-gradient(circle at 0 50%, transparent ${3 * size}px, #000 ${3 * size + 0.5}px) left / 51% 100% no-repeat,
    radial-gradient(circle at 100% 50%, transparent ${3 * size}px, #000 ${3 * size + 0.5}px) right / 51% 100% no-repeat`;
  return (
    <span aria-label={n != null ? `${n} ticket${n > 1 ? "s" : ""}` : "ticket"} style={{ display:"inline-flex", alignItems:"center",
      height:h, width:w, flexShrink:0, position:"relative", verticalAlign:"middle",
      background: dim ? "linear-gradient(135deg, #a8a29e, #78716c)" : "linear-gradient(135deg, #fbbf24, #f97316)",
      WebkitMask: notch, mask: notch, borderRadius: 2 * size, boxShadow:"inset 0 0 0 1px rgba(255,255,255,.35)" }}>
      <span style={{ width: 9 * size, height:"100%", borderRight:`${size}px dashed rgba(255,255,255,.75)`,
        display:"flex", alignItems:"center", justifyContent:"center", fontSize: 8 * size, color:"#fff" }}>★</span>
      {n != null && <span style={{ flex:1, textAlign:"center", fontSize: 10.5 * size, fontWeight:900, color:"#fff",
        textShadow:"0 1px 0 rgba(0,0,0,.25)" }}>×{n}</span>}
    </span>
  );
}

const sectionTitle = { fontSize:11, fontWeight:800, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", padding:"0 4px" };

// Ambiance « salle de jeu » : chaque section a sa couleur (tapis, reflets, jeton)
const CAT_COLOR = { prints:"#0EA5E9", filaments:"#F97316", objects:"#EC4899", mw:"#22C55E", photos:"#8B5CF6",
  app:"#6366F1", social:"#14B8A6", game:"#EF4444", secret:"#A855F7" };
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
// Fond d'une carte : deux halos de sa couleur, un motif en biais tres discret, sur la surface du theme
const feltBg = (c, c2 = c) => [
  `radial-gradient(120% 90% at 0% 0%, ${rgba(c, 0.20)}, transparent 55%)`,
  `radial-gradient(90% 80% at 100% 100%, ${rgba(c2, 0.12)}, transparent 60%)`,
  "linear-gradient(180deg, rgba(255,255,255,0.07), transparent 45%)",
  "var(--surface)",
].join(", ");
const feltCard = (c, c2) => ({ background: feltBg(c, c2), border:`1px solid ${rgba(c, 0.35)}`,
  boxShadow:`0 6px 18px -10px ${rgba(c, 0.55)}, inset 0 1px 0 rgba(255,255,255,0.10)` });
// Tiroirs des secrets : une couleur chacun
const SUB_COLOR = { calendar:"#F97316", clock:"#6366F1", measures:"#0EA5E9", colors:"#EC4899", counts:"#14B8A6",
  ups:"#EF4444", trade:"#F59E0B", mw:"#22C55E", social:"#06B6D4", app:"#8B5CF6", eggs:"#EAB308", game:"#DC2626",
  sets:"#D4A017" };
const pill = (c, dark = false) => ({ fontSize:11, fontWeight:800, whiteSpace:"nowrap", padding:"3px 9px", borderRadius:20,
  color: dark ? "#FFE08A" : c, background: rgba(c, dark ? 0.18 : 0.13), border:`1px solid ${rgba(c, 0.35)}` });
// L'emoji d'une section, pose sur un jeton de casino
function Chip({ emoji, color }) {
  return (
    <span aria-hidden style={{ width:42, height:42, flexShrink:0, borderRadius:"50%", display:"flex", alignItems:"center",
      justifyContent:"center", fontSize:21, position:"relative",
      background:`radial-gradient(circle at 35% 30%, ${rgba(color, 0.55)}, ${color} 70%)`,
      boxShadow:`0 3px 8px ${rgba(color, 0.45)}, inset 0 -3px 0 rgba(0,0,0,0.18)` }}>
      <span style={{ position:"absolute", inset:3, borderRadius:"50%", border:"2px dashed rgba(255,255,255,0.75)" }}/>
      <span style={{ position:"absolute", inset:8, borderRadius:"50%", background:"rgba(255,255,255,0.92)" }}/>
      <span style={{ position:"relative" }}>{emoji}</span>
    </span>
  );
}
const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
