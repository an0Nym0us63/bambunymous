import React, { useEffect, useMemo, useRef, useState } from "react";
import HiddenMark from "../components/HiddenMark";
import Cachettes from "../components/Cachettes";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { currentFriend } from "../store/friend";
import { useIsAdmin, useAuth } from "../store/auth";
import client from "../api/client";
import { isMoneyHidden } from "../utils/money";
import { egg, tapper, rulesOpened } from "../eggs";
import { useTrackDetail } from "../utils/track";
import SlotMachine from "../components/SlotMachine";
import TicketCeremony from "../components/TicketCeremony";
import { Zoom, FamilyBoardZoom } from "../components/HomeTiles";

// Succes : medailles gagnees sur l'historique (impressions, filaments, objets,
// MakerWorld, copains, secrets). Chaque succes a jusqu'a neuf paliers (bronze,
// argent, or, platine, diamant, legende, mythique, cosmique, eternel) ou une
// medaille unique.

const fmt = (n, unit) => {
  if (n == null) return "";
  // des heures qui avancent a la minute : « 0 h 22 »
  if (unit === "h" && typeof n === "number" && !Number.isInteger(n)) { const m = Math.round(n * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; }
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
  const [usage, setUsage] = useState(null);             // releve des depenses : "tickets" | "keys"
  const atFriend = !!currentFriend();             // chez un copain : pas de podium (ce sont ses copains a lui)
  const isAdmin = useIsAdmin();
  // la surprise de chaque compte (chez un copain : les siens) ; absente d'un serveur plus ancien
  const [odds, setOdds] = useState(null);
  const [oddsOpen, setOddsOpen] = useState(false);
  // le classement de la famille (compte principal et famille) : lu a l'ouverture
  const [famBoard, setFamBoard] = useState(null);
  const [famOpen, setFamOpen] = useState(false);
  useEffect(() => {
    if (!data || atFriend || !(data.me?.main || data.family)) return;
    client.get("/achievements/family-board").then(r => setFamBoard(r.data)).catch(() => setFamBoard(null));
  }, [!!data, data?.me?.main, !!data?.family]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => {
    client.get("/achievements/surprise/odds").then(r => setOdds(r.data?.accounts?.length ? r.data : null)).catch(() => setOdds(null));
    return client.get("/achievements").then(r => setData(r.data)).catch(e => setErr(e.response?.data?.detail || e.message));
  };
  // cles : reveler l'etape suivante d'un secret, puis relire la page
  const [keyErr, setKeyErr] = useState(null);
  const spend = async aid => {
    setKeyErr(null);
    try { await client.post(`/achievements/keys/${aid}`); await load(); }
    catch (e) { setKeyErr(e.response?.data?.detail || e.message); }
  };
  // cles et tickets : le compte principal seul ; la roue : lui, ou un compte a qui il l'a permise
  const canSpend = isAdmin && !atFriend && !!data?.keys && data?.me?.main !== false;
  // famille : une loupe sur un secret que la maison a deja (son indice)
  const loupe = async aid => {
    setKeyErr(null);
    try { await client.post(`/achievements/loupe/${aid}`); await load(); }
    catch (e) { setKeyErr(e.response?.data?.detail || e.message); }
  };
  const canSpin = !atFriend && !!data?.keys?.wheel && (canSpend || !!data?.me?.wheel);
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
    // compte de la famille : ce que la maison a deja trouve et lui pas encore
    if (!atFriend) for (const it of data?.items || []) if (it.house && it.level < 0 && !(out[it.id] || []).includes(it.house)) add([it.id], it.house);
    // compte principal : ce que la famille a trouve et la maison pas encore
    if (!atFriend) for (const it of data?.items || []) if (it.level < 0) for (const n of it.family_has || []) if (!(out[it.id] || []).includes(n)) add([it.id], n);
    return out;
  }, [pod, mine, atFriend, data]);
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
  // la main de cartes d'une section (c_…) ou d'un tiroir (s_…), dans l'ordre Valet, Dame, Roi, As
  const Hand = ({ of, size = 22 }) => {
    const h = data.items.filter(x => x.cat === "cards" && x.sub === of)
      .sort((a, b) => CARD_ORDER.indexOf(a.tiers[0].id) - CARD_ORDER.indexOf(b.tiers[0].id));
    return h.length ? <span title="Tes cartes" style={{ display:"flex", gap:2, flexShrink:0 }}>
      {h.map(x => <Medal key={x.id} tier={x.tiers[0]} emoji={x.emoji} size={size} locked={x.level < 0}/>)}</span> : null;
  };

  return (
    <div className={embedded ? "ach-room" : "ach-room page-wide"} style={{ "--page-max":"900px", width:"100%", margin:"0 auto", display:"flex", flexDirection:"column", gap:14 }}>
      {!embedded && <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Succès</h1>}

      {/* Le grade de maker, en tete, a part */}
      <GradePlate v={data.score_max ? data.score / data.score_max : 0} friend={atFriend}/>

      {/* Bilan : score (jauge), vitrine des medailles, puis le tresor (cles, tickets, machine) */}
      <div className="card" style={{ padding:"16px 18px", display:"flex", flexDirection:"column", gap:16, position:"relative",
        background:"linear-gradient(135deg, rgba(245,183,0,0.10), rgba(139,92,246,0.10)), var(--surface)" }}>
        {/* les regles : un petit « ? » discret dans le coin de la carte */}
        <button onClick={() => setRules(true)} aria-label="Règles des succès" title="Règles : paliers, points, clés, secrets"
          style={{ position:"absolute", top:8, right:8, zIndex:2, width:22, height:22, borderRadius:"50%", border:"none", background:"transparent",
            color:"var(--muted)", fontSize:12, fontWeight:900, cursor:"pointer", opacity:0.65, display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow:"inset 0 0 0 1.5px var(--border)" }}>?</button>
        <div style={{ display:"flex", gap:18, alignItems:"center", flexWrap:"wrap" }}>
          <ScoreHero data={data}/>
          <div style={{ flex:"2 1 300px", minWidth:0, display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:"4px 10px", flexWrap:"wrap" }}>
              <button onClick={() => setVitrine(null)} title={atFriend ? "Ouvrir sa vitrine : toutes ses médailles" : "Ouvrir ta vitrine : toutes tes médailles"}
                style={{ fontSize:11, fontWeight:800, letterSpacing:".12em", textTransform:"uppercase", color:"var(--muted)", whiteSpace:"nowrap",
                  background:"none", border:"none", padding:0, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 }}>
                🏛️ {atFriend ? "Sa vitrine" : "Ta vitrine"} <span style={{ fontSize:9 }}>▸</span></button>
              {data.tickets_used > 0 && <button onClick={() => setUsage("tickets")} title="Où sont passés tes tickets"
                style={usageBtn}><TicketStub size={0.7}/> {data.tickets_used} utilisé{data.tickets_used > 1 ? "s" : ""} ▸</button>}
              {data.keys_spent > 0 && <button onClick={() => setUsage("keys")} title="Ce que tes clés ont révélé"
                style={usageBtn}>🔑 {data.keys_spent} dépensée{data.keys_spent > 1 ? "s" : ""} ▸</button>}
            </div>
            <MedalShelf tiers={shelfTiers(data.tiers)} medals={data.medals} onOpen={t => setVitrine(t)}/>
          </div>
        </div>
        {!atFriend && (data.family ? <Treasure keys={canSpin ? data.keys || {} : {}} loupes={data.family} onRules={() => setRules(true)}
            onWheel={canSpin ? () => setSlot(true) : null}/>
          : data.keys && <Treasure keys={data.keys} onRules={() => setRules(true)} onSpent={canSpend ? load : null}
          onWheel={canSpin ? () => setSlot(true) : null}/>)}
        {/* la prochaine surprise, sous la roue (sortie de la section Secrets) ; un clic : tous les comptes */}
        {!atFriend && odds && <OddsBanner odds={odds} onOpen={() => setOddsOpen(true)}/>}
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

      {/* Classement de la famille (secrets a chercher), sous celui des copains ; un clic : le detail */}
      {!atFriend && famBoard?.people?.length > 1 && (
        <button type="button" onClick={() => setFamOpen(true)} className="card" style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:10,
          cursor:"pointer", textAlign:"left", font:"inherit", color:"inherit", ...feltCard("#EC4899", "#8B5CF6"),
          background:`radial-gradient(45% 70% at 50% 0%, rgba(236,72,153,0.22), transparent 70%), ${feltBg("#EC4899", "#8B5CF6")}` }}>
          <div style={{ ...sectionTitle, display:"flex", alignItems:"center", gap:6 }}>🏠 Classement de la famille
            <span style={{ marginLeft:"auto", fontSize:11, fontWeight:800, letterSpacing:0, textTransform:"none", color:"#EC4899" }}>Détail ›</span></div>
          <Podium places={4} people={famBoard.people.map(x => ({ id: x.username, name: x.username, me: x.username === famBoard.me, score: x.count }))} score={p => p.score}/>
          <span style={{ fontSize:11.5, color:"var(--muted)" }}>Sur les secrets à chercher : easter eggs, cachettes, farces, fêtes, pages cachées et appli Android.</span>
        </button>
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

      {/* Sections : sur PC, en colonnes ; celle qu'on ouvre prend toute la ligne. */}
      <div className="wide-list" style={{ "--wl-gap":"14px", "--wl-min":"440px" }}>
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
          <div key={c.id} className={open ? "card wide-span" : "card"} style={{ padding:0, overflow:"hidden", ...feltCard(CAT_COLOR[c.id] || "#8B5CF6") }}>
            <button onClick={() => toggle(c.id)} aria-expanded={open}
              style={{ width:"100%", display:"flex", flexDirection:"column", gap:8, padding:"14px 16px", background:"none",
                border:"none", cursor:"pointer", textAlign:"left", color:"var(--text)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, width:"100%" }}>
                <Chip emoji={c.emoji} color={CAT_COLOR[c.id] || "#8B5CF6"}/>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:"4px 8px", fontSize:15, fontWeight:800 }}>{c.name}
                    <GradeBadge g={gradeOf(c.id, sum.max ? sum.score / sum.max : 0)}/>
                    {/* mes cles, la ou on les depense */}
                    {c.id === "secret" && data.family && !atFriend && (
                      <span title="Tes loupes, pour révéler l'indice d'un secret que la maison a déjà" style={{ fontSize:12, fontWeight:900,
                        padding:"2px 8px", borderRadius:20, background:"rgba(14,165,233,0.15)", color:"#0EA5E9" }}>🔍 {data.family.loupes}</span>
                    )}
                    {c.id === "secret" && data.keys && !atFriend && !data.family && (
                      <span title="Tes clés, pour révéler les secrets (touche un secret)" style={{ fontSize:12, fontWeight:900,
                        padding:"2px 8px", borderRadius:20, background:"rgba(245,158,11,0.15)", color:"#F59E0B" }}>
                        🔑 {data.keys.balance}</span>
                    )}</span>
                  <span style={{ display:"block", fontSize:11.5, color:"var(--muted)", marginTop:1 }}>
                    {got}/{items.length} succès · {sum.score} pts
                    {spentIn(items).tickets > 0 && <span title="Tickets utilisés dans cette section" style={{ color:"#F59E0B", fontWeight:700 }}>
                      {" "}· 🎟️ {spentIn(items).tickets}</span>}
                    {spentIn(items).keys > 0 && <span title="Clés dépensées dans cette section" style={{ color:"#F59E0B", fontWeight:700 }}>
                      {" "}· 🔑 {spentIn(items).keys}</span>}
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
                {c.id !== "cards" && c.id !== "secret" && <span style={{ marginLeft:"auto" }}><Hand of={`c_${c.id}`}/></span>}
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
                {c.id === "secret" && (near > 0 || common + toFind > 0 || data.family) && (
                  <div style={{ display:"flex", flexDirection:"column", gap:4, padding:"8px 10px", borderRadius:10, fontSize:11.5,
                    lineHeight:1.45, color:"var(--text2)", background:"rgba(245,158,11,0.08)", border:"1px dashed rgba(245,158,11,0.5)" }}>
                    {data.family && <span><b style={{ color:"#EC4899" }}>🥚 Tes trouvailles : {data.family.found} / {data.family.total}</b>
                      {" · "}<b style={{ color:"#0EA5E9" }}>🔍 {data.family.loupes} loupe{data.family.loupes > 1 ? "s" : ""}</b> pour révéler l'indice d'un secret
                      que {data.family.house} a déjà ({data.family.loupes_day} de plus chaque jour, {data.family.loupes_max} au plus).
                      Easter eggs, cachettes, Android, farces, fêtes et pages cachées : ici, ce sont les tiennes. Le reste des succès est celui
                      de la maison.</span>}
                    {near > 0 && !atFriend && <span><b style={{ color:"#F59E0B" }}>👀 À portée</b> : pas encore à toi, mais {data.family
                      ? "quelqu'un de la maison ou un copain" : "un copain"} l'a déjà
                      débloqué (son initiale est sur la médaille). Rien n'est dévoilé : à toi de trouver comment.</span>}
                    {data.family?.scoops > 0 && !atFriend && <span><b style={{ color:"#EC4899" }}>✨ avant {data.family.house}</b> : tu l'as trouvé
                      et {data.family.house} pas encore ({data.family.scoops} en tout).</span>}
                    {near > 0 && atFriend && <span><b style={{ color:"#F59E0B" }}>« toi »</b> : tu l'as déjà, lui pas encore.</span>}
                    {common + toFind > 0 && <span><b style={{ color:"#22c55e" }}>✓ toi aussi</b> / <b style={{ color:"#ef4444" }}>pas toi</b> :
                      ses médailles comparées aux tiennes.</span>}
                  </div>
                )}
                {/* la prochaine surprise du compte principal ; un clic : tous les comptes. De quoi voir si,
                    chez quelqu'un, elle ne tombe jamais */}

                {/* Secrets : rangés en sous-sections (calendrier, heures, couleurs…) */}
                {/* Secrets : les gagnes (et ceux dont une cle a revele la categorie) dans
                    leur sous-section ; les autres « a decouvrir ». Les en-tetes ne disent
                    que ce qu'ils montrent : rien sur la taille cachee d'une categorie. */}
                {(c.id === "secret" && data.subs?.length
                  ? [...data.subs.map(sb => ({ ...sb, items: items.filter(x => x.sub === sb.id) })),
                     { id:"unknown", emoji:"❓", name:"À découvrir", items: items.filter(x => !x.sub) }].filter(sb => sb.items.length)
                  : c.id === "cards" && data.card_groups?.length
                  ? data.card_groups.map(g => ({ ...g, hand: true, items: items.filter(x => x.sub === g.id)
                      .sort((a, b) => CARD_ORDER.indexOf(a.tiers[0].id) - CARD_ORDER.indexOf(b.tiers[0].id)) }))
                      .filter(g => g.items.length)
                      // les mains des sections, puis celles des tiroirs de secrets (memes noms parfois : Copains, MakerWorld…)
                      .map((g, i, arr) => ({ ...g, head: g.id[0] !== arr[i - 1]?.id[0]
                        ? { c:"Mains des sections", s:"Mains des tiroirs de secrets" }[g.id[0]] : null }))
                  : [{ id:"", items }]
                ).map(sb => (
                  <div key={sb.id} style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {sb.head && <div style={{ ...sectionTitle, marginTop:6 }}>{sb.head}</div>}
                    {sb.id && (() => {
                      const col = SUB_COLOR[sb.id] || (sb.hand && (CAT_COLOR[sb.id.slice(2)] || SUB_COLOR[sb.id.slice(2)])) || "#A855F7";
                      const isOpen = openSubs.has(sb.id), mystery = sb.id === "unknown";
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
                            <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1, fontSize:14 }}>{sb.emoji}</span>
                          </span>
                          <span style={{ flex:1, minWidth:0 }}>{sb.name}
                            {data.family?.subs?.includes(sb.id) && <span title="Dans ce tiroir, ce sont tes trouvailles à toi"
                              style={{ marginLeft:6, fontSize:10.5, fontWeight:900, padding:"1px 7px", borderRadius:20, background:"#EC4899", color:"#fff",
                                verticalAlign:"middle", whiteSpace:"nowrap", display:"inline-block" }}>à toi</span>}
                            {(n => n > 0 && <span data-tip={`${n} trouvé${n > 1 ? "s" : ""} avant ${data.family?.house || "la maison"}`}
                              style={{ marginLeft:5, fontSize:10.5, fontWeight:900, padding:"1px 7px", borderRadius:20, color:"#fff", verticalAlign:"middle",
                              whiteSpace:"nowrap", display:"inline-block", background:"linear-gradient(135deg, #EC4899, #F59E0B)" }}>✨ {n}</span>)(sb.items.filter(x => x.scoop).length)}
                            {spentIn(sb.items).keys > 0 && <span title="Clés dépensées dans ce tiroir"
                              style={{ marginLeft:6, fontSize:11, fontWeight:800, color:"#F59E0B" }}>🔑 {spentIn(sb.items).keys}</span>}
                            {c.id === "secret" && <span style={{ display:"flex", marginTop:3 }}><Hand of={`s_${sb.id}`} size={18}/></span>}</span>
                          {/* que ce qu'on voit : rien sur la taille cachee d'une categorie */}
                          {sb.hand
                            ? <span style={{ display:"flex", gap:2 }}>
                                {sb.items.map(x => <Medal key={x.id} tier={x.tiers[0]} emoji={x.emoji} size={24} locked={x.level < 0}/>)}</span>
                            : mystery
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
      </div>

      {data.since && <p style={{ ...msg, padding:"4px", fontSize:11 }}>
        Les dates viennent de ton historique ; ce qui ne s'y lit pas (MakerWorld, stock, copains) est daté du jour où il a été constaté.</p>}

      {rules && createPortal(<Rules data={data} onClose={() => setRules(false)}/>, document.body)}
      {slot && <SlotMachine wheel={data.keys?.wheel} onDone={load} onClose={() => setSlot(false)}/>}
      {famOpen && famBoard && <Zoom icon={<span style={{ fontSize:20 }}>🏠</span>} color="#EC4899" label="Classement de la famille" onClose={() => setFamOpen(false)}>
        <FamilyBoardZoom b={famBoard}/></Zoom>}
      {oddsOpen && odds && <OddsSheet odds={odds} admin={!atFriend && !!data.me?.main} uniq={data.tiers.find(t => t.id === "unique")} onClose={() => setOddsOpen(false)}/>}
      {ceremony && <TicketCeremony {...ceremony} onClose={() => setCeremony(null)}/>}
      {usage && createPortal(<UsageSheet data={data} kind={usage} onKind={setUsage} onOpen={id => setDetail(id)}
        onClose={() => setUsage(null)}/>, document.body)}
      {vitrine !== undefined && createPortal(<Showcase data={data} tier={vitrine} onTier={setVitrine}
        mine={atFriend ? mine : null} owner={atFriend ? currentFriend()?.name : null}
        onOpen={id => setDetail(id)} onClose={() => setVitrine(undefined)}/>, document.body)}
      {detail && byId[detail] && createPortal(
        <div data-no-pull="" className="ach-room" onClick={closeDetail} style={{ position:"fixed", inset:0, zIndex:4300, background:"rgba(0,0,0,0.6)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:420, maxHeight:"90vh", overflowY:"auto",
            position:"relative" }}>
            <button onClick={closeDetail} aria-label="Fermer" style={{ position:"absolute", top:8, right:10, zIndex:1,
              background:"none", border:"none", color:"var(--muted)", fontSize:20, cursor:"pointer" }}>✕</button>
            <Track label={`Succès · ${byId[detail].name}`}/>
            <Card it={byId[detail]} sheet others={ringBy[detail]} shared={shared(byId[detail])} rivals={rivalsOf(byId[detail])}
              tickets={canSpend ? data.keys?.wheel?.tickets || 0 : 0} onTicket={() => useTicket(detail)}
              keys={canSpend ? data.keys : null} onSpend={() => spend(detail)} keyErr={keyErr}
              loupes={data.family ? data.family.loupes : null} onLoupe={() => loupe(detail)}/>
          </div>
        </div>, document.body
      )}
      <HiddenMark egg="egg_in_egg" e="🥚" side="left"/>
      <Cachettes spot="achievements"/>
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
      background: it.scoop ? `linear-gradient(160deg, rgba(236,72,153,0.16), ${top.color}14 60%)` : got ? `${top.color}14` : near ? "rgba(245,158,11,0.08)" : "transparent",
      border:`1px ${near ? "dashed" : "solid"} ${it.scoop ? "#EC4899" : got ? top.color + "55" : near ? "#F59E0B" : "var(--border)"}` }}>
      <span style={{ borderRadius:"50%", padding:2, boxShadow: near ? "0 0 0 2px #F59E0B, 0 0 12px rgba(245,158,11,0.55)" : "none" }}>
        <Medal tier={top} emoji={it.emoji} size={46} locked={!got}/></span>
      {/* compte de la famille : trouve avant la maison */}
      {it.scoop && (
        <span style={{ position:"absolute", top:-9, left:"50%", transform:"translateX(-50%)", maxWidth:"calc(100% + 6px)", overflow:"hidden", textOverflow:"ellipsis",
          fontSize:9.5, fontWeight:900, padding:"2px 6px", borderRadius:20, whiteSpace:"nowrap", zIndex:1,
          color:"#fff", background:"linear-gradient(135deg, #EC4899, #F59E0B)", border:"1.5px solid var(--sheet-bg)",
          boxShadow:"0 0 10px rgba(236,72,153,0.55)" }}>✨ avant {it.scoop_house || "la maison"}</span>
      )}
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
      {(it.tickets > 0 || it.key_use) && (
        <span title={it.tickets > 0 ? `${it.tickets} ticket${it.tickets > 1 ? "s" : ""} utilisé${it.tickets > 1 ? "s" : ""} ici`
          : `Révélé avec des clés${it.key_use.keys ? ` (${it.key_use.keys})` : ""}`}
          style={{ fontSize:9.5, fontWeight:800, padding:"1px 6px", borderRadius:20, marginTop:-2,
            background:"rgba(245,158,11,0.16)", color:"#D97706", lineHeight:1.3 }}>
          {it.tickets > 0 ? `🎟️${it.tickets}` : `🔑${it.key_use.keys || ""}`}</span>
      )}
      {it.prog && !got && (
        <span title={`${it.prog[0]}/${it.prog[1]}`} style={{ width:"70%", height:3, borderRadius:3, background:"var(--surface2)", overflow:"hidden" }}>
          <span style={{ display:"block", width:`${Math.round(100 * Math.min(1, it.prog[0] / (it.prog[1] || 1)))}%`, height:"100%",
            background: top.color }}/></span>
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
function Podium({ people, score, small = false, places = 3 }) {
  const top = [...people].sort((a, b) => score(b) - score(a)).slice(0, places);
  const order = top.length >= 3 ? [top[1], top[0], top[2], ...top.slice(3)] : top.length === 2 ? [top[1], top[0]] : top;
  const rank = p => top.indexOf(p);
  const H = small ? [52, 38, 28, 20] : [68, 50, 36, 26];
  return (
    <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"center", gap:8 }}>
      {order.map(p => {
        const r = rank(p);
        return (
          <div key={p.id} style={{ flex:"0 1 110px", minWidth:0, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
            <span style={{ fontSize: small ? 18 : 22 }}>{["🥇", "🥈", "🥉", "🏅"][r]}</span>
            <span style={{ fontSize:12, fontWeight:800, color: p.me ? "#F59E0B" : "var(--text)", maxWidth:"100%",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.me ? "Toi" : p.name}</span>
            <div style={{ width:"100%", height:H[r], borderRadius:"10px 10px 4px 4px", display:"flex", alignItems:"center",
              justifyContent:"center", fontSize:13, fontWeight:900, color:"#fff",
              background: ["#F5B700", "#B8C2CC", "#CD7F32", "#8B5CF6"][r], boxShadow: p.me ? "0 0 0 2px #F59E0B" : "none" }}>
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
  const ladder = tiers.filter(t => t.id !== "unique" && !t.card);
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
    <div data-egg="score_tap" data-egg-n="10" style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <div aria-hidden="true" style={{ position:"absolute", inset:8, borderRadius:"50%",
        background:`radial-gradient(circle, ${t.color}33, transparent 70%)`, animation:"bn-ring-glow 3s ease-in-out infinite" }}/>
      <svg width={size} height={size} viewBox="0 0 138 138" style={{ position:"absolute", inset:0, transform:"rotate(-90deg)" }}>
        <circle cx="69" cy="69" r={R} fill="none" stroke="var(--surface2)" strokeWidth="10"/>
        <circle cx="69" cy="69" r={R} fill="none" stroke={t.color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={go ? C * (1 - v) : C}
          style={{ transition:"stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)", filter:`drop-shadow(0 0 4px ${t.color})` }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontSize:Math.min(27 * k, size * 0.92 / Math.max(4, shown.toLocaleString("fr-FR").length)), fontWeight:900, color:"var(--text)",
          fontVariantNumeric:"tabular-nums", lineHeight:1, whiteSpace:"nowrap" }}>
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
  const ladder = data.tiers.filter(t => t.id !== "unique" && !t.card);
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
          {(() => {
            const n = data.tiers.filter(t => t.card).reduce((a, t) => a + (data.medals?.[t.id] || 0), 0);
            return n > 0 && <span style={chip("rgba(212,160,23,0.14)", "#B8860B")}>🃏 {n} carte{n > 1 ? "s" : ""}</span>;
          })()}
        </div>
      </div>
    </div>
  );
}

// Les types de la vitrine : les paliers, puis les cartes par rang (Valets, Dames,
// Rois, As) et les quatre Jokers ensemble.
function shelfTiers(tiers) {
  const by = Object.fromEntries(tiers.map(t => [t.id, t]));
  const cards = [["card_v", "Valets"], ["card_d", "Dames"], ["card_r", "Rois"], ["card_a", "As"]]
    .filter(([id]) => by[id]).map(([id, label]) => ({ ...by[id], label, of:[id] }));
  const jokers = tiers.filter(t => t.id.startsWith("card_j")).map(t => t.id);
  if (by.card_ja) cards.push({ ...by.card_ja, id:"jokers", label:"Jokers", of: jokers });
  return [...tiers.filter(t => !t.card), ...cards];
}
const countOf = (t, medals) => t.of ? t.of.reduce((n, id) => n + (medals[id] || 0), 0) : medals[t.id] || 0;

// La vitrine : chaque palier, sa medaille (animee aux hauts rangs) et combien tu en as.
function MedalShelf({ tiers, medals, onOpen }) {
  return (
    <div style={{ position:"relative", display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(48px, 1fr))", gap:"10px 4px",
      padding:"10px 6px 14px", borderRadius:14, background:"linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.06))" }}>
      {tiers.map(t => {
        const n = countOf(t, medals);
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
// Ce qu'ont coute les paliers et les revelations : par section, dans la fiche, et le releve complet
const usageBtn = { display:"inline-flex", alignItems:"center", gap:4, fontSize:11, fontWeight:700, color:"var(--muted)",
  background:"none", border:"none", padding:0, cursor:"pointer", whiteSpace:"nowrap" };

function spentIn(items) {
  let tickets = 0, keys = 0;
  for (const it of items || []) { tickets += it.tickets || 0; keys += it.key_use?.keys || 0; }
  return { tickets, keys };
}

// Pages cachees et farces deja gagnees : un bouton pour y retourner
const PLACE_OF = id => id === "egg_anonymous" ? ["/anonymous", "page"] : id === "egg_teapot" ? ["/teapot", "page"]
  : id.startsWith("egg_h_") ? ["/" + id.slice(6).replace(/_/g, "-"), "page"]
  : id.startsWith("egg_p_") ? ["/" + id.slice(6).replace(/_/g, "-"), "farce"]
  : id === "egg_merci_don" ? ["/don", "farce"] : null;

const oddsPct = p => (p * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const oddsWhen = s => { if (!s) return "jamais"; const d = new Date(/Z|[+-]\d\d:\d\d$/.test(s) ? s : s + "Z");
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`; };
// la surprise de chaque compte : chance a la prochaine ouverture, ouvertures sans, surprises recues
// la prochaine surprise du compte principal ; un clic : tous les comptes (de quoi voir si, chez quelqu'un, elle ne tombe jamais)
function OddsBanner({ odds, onOpen }) {
  // la surprise du compte connecte (le detail de tous les comptes au toucher)
  const me = useAuth(st => st.username);
  const m = odds.accounts.find(x => x.username === me) || odds.accounts.find(x => x.main) || odds.accounts[0];
  // dans le style des cases du tresor : un fond lumineux, le de qui flotte, le pourcentage en grand
  return (
    <button type="button" onClick={onOpen} title="La surprise de chaque compte" style={{ position:"relative", overflow:"hidden", display:"flex", alignItems:"center",
      gap:12, padding:"10px 14px", borderRadius:14, cursor:"pointer", width:"100%", textAlign:"left", font:"inherit", color:"inherit",
      background:"radial-gradient(circle at 8% 50%, rgba(139,92,246,.35), transparent 55%), var(--surface2)", border:"1px solid rgba(139,92,246,.45)" }}>
      <span style={{ fontSize:26, lineHeight:1, animation:"bn-float 3.8s ease-in-out infinite" }}>🎲</span>
      {m.pending
        ? <span style={{ fontSize:22, lineHeight:1 }}>🎁</span>
        : <span style={{ fontSize:24, fontWeight:900, lineHeight:1, whiteSpace:"nowrap", background:"linear-gradient(180deg,#c084fc,#7c3aed)",
            WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }}>{oddsPct(m.next)} %</span>}
      <span style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:1 }}>
        <span style={{ fontSize:12, fontWeight:800, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {m.pending ? "Une surprise t'attend" : "Prochaine surprise"}</span>
        <span style={{ fontSize:10.5, color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {m.n} ouverture{m.n > 1 ? "s" : ""} sans · {m.shown} reçue{m.shown > 1 ? "s" : ""}</span>
      </span>
      <span style={{ fontSize:11, fontWeight:800, color:"#8B5CF6", whiteSpace:"nowrap" }}>Comptes ›</span>
    </button>
  );
}

function OddsSheet({ odds, admin, uniq, onClose }) {
  useEffect(() => { const k = e => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  // pour l'administrateur : les secrets que chaque compte a trouves lui-meme (compte ou pas)
  const [secrets, setSecrets] = useState(null);
  const [subs, setSubs] = useState([]);
  const [openU, setOpenU] = useState(null);
  useEffect(() => {
    if (!admin) return;
    client.get("/achievements/secrets-by-account").then(r => { setSecrets(Object.fromEntries((r.data?.accounts || []).map(a => [a.username, a])));
      setSubs(r.data?.subs || []); }).catch(() => {});
  }, [admin]);
  return createPortal(
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4000, background:"rgba(2,6,23,0.6)", backdropFilter:"blur(4px)",
      display:"flex", alignItems:"center", justifyContent:"center", padding:14 }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width:"min(520px, 100%)", maxHeight:"86vh", overflowY:"auto", padding:16,
        display:"flex", flexDirection:"column", gap:12, background:"var(--sheet-bg)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:24 }}>🎲</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:16, fontWeight:900, color:"var(--text)" }}>Les surprises, compte par compte</div>
            <div style={{ fontSize:11.5, color:"var(--muted)", lineHeight:1.4 }}>Chance d'une surprise à la prochaine ouverture de l'appli. Elle monte à chaque
              ouverture sans surprise (une ouverture compte au plus toutes les {odds.gap_min} min) et repart de zéro quand une surprise s'affiche.</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ width:32, height:32, borderRadius:10, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text2)", cursor:"pointer", flexShrink:0 }}>✕</button>
        </div>
        {odds.accounts.map(a => (
          <div key={a.username} className="card-sm" style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px",
            border: a.main ? "1.5px solid #8B5CF6" : undefined }}>
            <div style={{ width:58, height:58, borderRadius:16, flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              background: a.pending ? "linear-gradient(135deg,#F59E0B,#EC4899)" : "linear-gradient(135deg,#8B5CF6,#6366F1)", color:"#fff" }}>
              <span style={{ fontSize: a.pending ? 22 : 17, fontWeight:900, lineHeight:1 }}>{a.pending ? "🎁" : `${oddsPct(a.next)} %`}</span>
              {!a.pending && <span style={{ fontSize:9.5, fontWeight:700, opacity:.85 }}>prochaine</span>}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                <span style={{ fontSize:14.5, fontWeight:900, color:"var(--text)" }}>{a.username}</span>
                {a.main && <span style={{ fontSize:10.5, fontWeight:800, color:"#8B5CF6", border:"1px solid currentColor", borderRadius:20, padding:"0 7px" }}>principal</span>}
                {a.role === "admin" && !a.main && <span style={{ fontSize:10.5, fontWeight:800, color:"var(--muted)" }}>admin</span>}
              </div>
              <div style={{ fontSize:12, color:"var(--text2)", lineHeight:1.45 }}>
                {a.pending ? "Une surprise est tirée : elle tombe à la prochaine ouverture" : `${a.n} ouverture${a.n > 1 ? "s" : ""} sans surprise`}
                {" · "}<b>{a.shown}</b> surprise{a.shown > 1 ? "s" : ""} reçue{a.shown > 1 ? "s" : ""}</div>
              <div style={{ fontSize:11, color:"var(--muted)" }}>Dernière ouverture comptée : {oddsWhen(a.last)}</div>
              {/* ses propres trouvailles (pas le principal : les siennes sont celles de la maison) */}
              {!a.main && secrets?.[a.username] && (sc => (
                <button type="button" onClick={() => (sc.count || sc.loupes?.used?.length) && setOpenU(a.username)} disabled={!sc.count && !sc.loupes?.used?.length}
                  style={{ marginTop:4, padding:0, border:"none", background:"none", cursor: sc.count ? "pointer" : "default", fontSize:12, fontWeight:800,
                    color:"#EC4899", textAlign:"left" }}>
                  🥚 {sc.count} secret{sc.count > 1 ? "s" : ""} trouvé{sc.count > 1 ? "s" : ""} lui-même{sc.count ? " ›" : ""}</button>
              ))(secrets[a.username])}
            </div>
          </div>
        ))}
      </div>
      {openU && secrets?.[openU] && <AccountSecrets acc={secrets[openU]} subs={subs} uniq={uniq} onClose={() => setOpenU(null)}/>}
    </div>, document.body);
}

// Les secrets qu'un compte de la maison a trouves lui-meme, rangés par tiroir comme sur sa page
// (pour l'administrateur, depuis « Les surprises, compte par compte »)
function AccountSecrets({ acc, subs, uniq, onClose }) {
  const [open, setOpen] = useState(() => new Set());
  const [pick, setPick] = useState(null);           // la medaille touchee : son detail sous la grille
  useEffect(() => { const k = e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);
  const groups = subs.map(sb => ({ ...sb, items: acc.items.filter(x => x.sub === sb.id) }));
  const toggle = id => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const both = acc.items.filter(x => x.house).length;
  return (
    <div onClick={e => { e.stopPropagation(); onClose(); }} style={{ position:"fixed", inset:0, zIndex:4010, background:"rgba(2,6,23,0.55)",
      display:"flex", alignItems:"center", justifyContent:"center", padding:14 }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width:"min(520px, 100%)", maxHeight:"86vh", overflowY:"auto", padding:16,
        display:"flex", flexDirection:"column", gap:10, background:"var(--sheet-bg)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <Avatar name={acc.username} size={30}/>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:16, fontWeight:900, color:"var(--text)" }}>Les secrets de {acc.username}</div>
            <div style={{ fontSize:11.5, color:"var(--muted)" }}>{acc.count} trouvé{acc.count > 1 ? "s" : ""} lui-même
              {acc.last ? ` · le dernier ${oddsWhen(acc.last)}` : ""}</div>
            <div style={{ fontSize:11.5, fontWeight:700, marginTop:1 }}>
              <span style={{ color:"#22c55e" }}>✓ {both} que tu as aussi</span><span style={{ color:"var(--muted)" }}> · </span>
              <span style={{ color:"#ef4444" }}>{acc.count - both} pas toi</span></div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ width:32, height:32, borderRadius:10, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text2)", cursor:"pointer", flexShrink:0 }}>✕</button>
        </div>
        {/* ses loupes : combien il lui en reste, et sur quels secrets (deja trouve ensuite, ou pas encore) */}
        {(acc.loupes?.used?.length > 0 || acc.loupes?.left != null) && (
          <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"9px 11px", borderRadius:12,
            background:"linear-gradient(135deg, rgba(14,165,233,0.12), transparent 60%), var(--surface2)", border:"1px solid rgba(14,165,233,0.3)" }}>
            <div style={{ fontSize:12.5, fontWeight:800, color:"var(--text)" }}>🔍 Loupes
              <span style={{ fontWeight:700, color:"var(--muted)" }}> · {acc.loupes.used.length} utilisée{acc.loupes.used.length > 1 ? "s" : ""}
                {acc.loupes.left != null ? ` · ${acc.loupes.left} en main` : ""}</span></div>
            {acc.loupes.used.length > 0 && <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {acc.loupes.used.map(x => <span key={x.id} title={`${x.name}\nloupe ${oddsWhen(x.at)}${x.found ? "\ntrouvé ensuite" : "\npas encore trouvé"}`}
                style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:11.5, fontWeight:700, padding:"2px 8px", borderRadius:12,
                  background:"var(--surface)", color:"var(--text2)", border:`1px solid ${x.found ? "rgba(34,197,94,0.5)" : "var(--border)"}` }}>
                {x.emoji} {x.name}{x.found && <b style={{ color:"#16a34a" }}>✓</b>}</span>)}</div>}
          </div>
        )}
        {groups.map(g => {
          const col = SUB_COLOR[g.id] || "#A855F7", isOpen = open.has(g.id), n = g.items.length;
          const sel = g.items.find(x => x.id === pick);
          return (
            <div key={g.id} style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <button onClick={() => n && toggle(g.id)} aria-expanded={isOpen} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px",
                borderRadius:12, cursor: n ? "pointer" : "default", textAlign:"left", width:"100%", fontSize:13, fontWeight:800, color:"var(--text)",
                ...feltCard(col), opacity: n ? 1 : 0.55 }}>
                <span style={{ fontSize:17 }}>{g.emoji}</span>
                <span style={{ flex:1, minWidth:0 }}>{g.name}</span>
                <span style={pill(col)}>{n} / {g.total}</span>
                {n > 0 && <span style={{ fontSize:10, color:"var(--muted)", transform: isOpen ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span>}
              </button>
              {isOpen && <>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(62px, 1fr))", gap:6, padding:"0 2px" }}>
                  {g.items.map(x => (
                    <button key={x.id} onClick={() => setPick(p => p === x.id ? null : x.id)} title={x.name}
                      style={{ position:"relative", display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"6px 2px 5px",
                        borderRadius:10, cursor:"pointer", background: pick === x.id ? rgba(col, 0.18) : "var(--surface2)",
                        border:`1.5px solid ${pick === x.id ? col : "transparent"}` }}>
                      {uniq ? <Medal tier={uniq} emoji={x.emoji} size={34}/> : <span style={{ fontSize:24 }}>{x.emoji}</span>}
                      {/* comme entre copains : toi aussi (vert) ou pas toi (rouge) */}
                      <span style={{ position:"absolute", top:3, right:3, width:15, height:15, borderRadius:"50%", fontSize:9, fontWeight:900,
                        display:"flex", alignItems:"center", justifyContent:"center", color:"#fff",
                        background: x.house ? "#22c55e" : "#ef4444" }}>{x.house ? "✓" : "✕"}</span>
                      <span style={{ fontSize:9.5, fontWeight:700, color:"var(--text2)", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis",
                        whiteSpace:"nowrap", padding:"0 3px" }}>{x.name}</span>
                    </button>
                  ))}
                </div>
                {sel && (
                  <div style={{ display:"flex", gap:10, padding:"8px 10px", borderRadius:12, background:"var(--surface2)", border:`1px solid ${rgba(col, 0.4)}` }}>
                    <span style={{ fontSize:24, lineHeight:1.1 }}>{sel.emoji}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:800, color:"var(--text)" }}>{sel.name}</div>
                      {sel.house
                        ? <div style={{ fontSize:12, color:"var(--text2)", lineHeight:1.4 }}>{sel.desc}</div>
                        : <div style={{ fontSize:12, fontWeight:700, color:"#ef4444", lineHeight:1.4 }}>Tu ne l'as pas encore : à toi de le trouver !</div>}
                      {sel.at && <div style={{ fontSize:10.5, color:"var(--muted)", marginTop:2 }}>{acc.username} l'a trouvé {oddsWhen(sel.at)}</div>}
                    </div>
                  </div>
                )}
              </>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SecretPlace({ it }) {
  const nav = useNavigate();
  const place = PLACE_OF(it.id);
  // chez un copain : ses secrets se regardent, on n'y joue pas
  if (!place || currentFriend()) return null;
  const [path, kind] = place;
  return (
    <button onClick={e => { e.stopPropagation(); nav(path); }}
      style={{ marginTop:8, display:"inline-flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:20,
        border:"none", cursor:"pointer", fontWeight:800, fontSize:12.5, color:"#fff",
        background: kind === "farce" ? "linear-gradient(135deg,#8B5CF6,#6366F1)" : "linear-gradient(135deg,#22C55E,#0EA5E9)" }}>
      {kind === "farce" ? "🌀 Rejouer la farce" : "🗺️ Y retourner"}</button>
  );
}

function Spent({ it }) {
  const uses = it.ticket_uses || [], k = it.key_use;
  if (!uses.length && !k) return null;
  return (
    <div style={{ marginTop:6, padding:"6px 8px", borderRadius:9, fontSize:11.5, lineHeight:1.45,
      background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.3)", color:"var(--text2)" }}>
      {uses.length > 0 && <div>🎟️ <b>{uses.reduce((n, u) => n + u.tickets, 0)} ticket{uses.reduce((n, u) => n + u.tickets, 0) > 1 ? "s" : ""}</b> :{" "}
        {uses.map((u, i) => <span key={i}>{i ? ", " : ""}{u.tier} ({u.tickets}{u.at ? ` · ${dateFr(u.at)}` : ""})</span>)}</div>}
      {k && <div>🔑 {k.keys ? <b>{k.keys} clé{k.keys > 1 ? "s" : ""}</b> : <b>Clés</b>} : {k.steps.join(", ")}</div>}
    </div>
  );
}

function UsageSheet({ data, kind, onKind, onOpen, onClose }) {
  useTrackDetail(kind === "keys" ? "Succès · Clés dépensées" : "Succès · Tickets utilisés");
  const tickets = data.items.flatMap(it => (it.ticket_uses || []).map(u => ({ it, ...u })))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const keys = data.items.filter(it => it.key_use).map(it => ({ it, ...it.key_use }))
    .sort((a, b) => (b.keys || 0) - (a.keys || 0) || String(b.at || "").localeCompare(String(a.at || "")));
  const row = { display:"flex", alignItems:"center", gap:10, padding:"8px 6px", borderRadius:10, cursor:"pointer",
    background:"none", border:"none", width:"100%", textAlign:"left", font:"inherit", color:"var(--text)" };
  const tab = on => ({ flex:1, padding:"7px 0", borderRadius:9, fontSize:12.5, fontWeight:800, cursor:"pointer",
    border:`1px solid ${on ? "#F59E0B" : "var(--border)"}`, background: on ? "rgba(245,158,11,0.15)" : "transparent",
    color: on ? "var(--text)" : "var(--text2)" });
  return (
    <div data-no-pull="" className="ach-room" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4300,
      background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width:"100%", maxWidth:460, maxHeight:"85vh",
        display:"flex", flexDirection:"column", padding:"14px 16px", background:"var(--sheet-bg)", backdropFilter:"none", gap:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16, fontWeight:900, color:"var(--text)", flex:1 }}>
            {kind === "keys" ? "🔑 Où sont passées tes clés" : "🎟️ Où sont passés tes tickets"}</span>
          <button onClick={onClose} aria-label="Fermer" style={{ background:"none", border:"none", color:"var(--muted)",
            fontSize:20, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={() => onKind("tickets")} style={tab(kind !== "keys")}>🎟️ Tickets · {data.tickets_used || 0}</button>
          <button onClick={() => onKind("keys")} style={tab(kind === "keys")}>🔑 Clés · {data.keys_spent || 0}</button>
        </div>
        <div style={{ overflowY:"auto", display:"flex", flexDirection:"column", gap:2 }}>
          {kind !== "keys" ? (tickets.length ? tickets.map((u, i) => (
            <button key={i} onClick={() => onOpen(u.it.id)} style={row}>
              <Medal tier={u.it.tiers.find(t => t.label === u.tier) || u.it.tiers[0]} emoji={u.it.emoji} size={34}/>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:"block", fontSize:13, fontWeight:800 }}>{u.it.name}</span>
                <span style={{ fontSize:11.5, color:"var(--muted)" }}>passé {u.tier}{u.at ? ` · ${dateFr(u.at)}` : ""}</span>
              </span>
              <TicketStub n={u.tickets} size={0.9}/>
            </button>
          )) : <p style={msg}>Aucun ticket utilisé pour l'instant.</p>)
          : (keys.length ? keys.map((k, i) => (
            <button key={i} onClick={() => onOpen(k.it.id)} style={row}>
              <Medal tier={k.it.tiers[0]} emoji={k.it.emoji} size={34} locked={k.it.level < 0}/>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:"block", fontSize:13, fontWeight:800 }}>{k.it.name}
                  {k.it.level >= 0 && <span style={{ fontSize:11, color:"#22c55e", fontWeight:700 }}> · gagné</span>}</span>
                <span style={{ fontSize:11.5, color:"var(--muted)" }}>{k.steps.join(", ")}{k.at ? ` · ${dateFr(k.at)}` : ""}</span>
              </span>
              <span style={{ fontSize:13, fontWeight:900, color:"#D97706", whiteSpace:"nowrap" }}>{k.keys ? `🔑 ${k.keys}` : "🔑"}</span>
            </button>
          )) : <p style={msg}>Aucune clé dépensée pour l'instant.</p>)}
        </div>
      </div>
    </div>
  );
}

// Une vue pour le journal d'activite, le temps qu'elle est affichee
function Track({ label }) { useTrackDetail(label); return null; }

function Showcase({ data, tier, onTier, onOpen, onClose, mine, owner }) {
  useEffect(() => { egg("showcase"); }, []);
  useTrackDetail(owner ? `Succès · Vitrine de ${owner}` : "Succès · Vitrine");
  // Chez un copain : ses medailles, et discretement celles que j'ai aussi
  const [own, setOwn] = useState("all");          // all | yes | no
  const myLvl = mine?.levels || null;
  const iHave = (it, idx) => myLvl ? (myLvl[it.id] ?? -1) >= idx || (idx === 0 && it.tiers.length === 1
    && (mine.uniques || []).includes(it.id)) : null;
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const shelves = shelfTiers(data.tiers).map(t => ({
    t,
    items: data.items.flatMap(it => it.tiers.map((x, idx) => ({ x, idx }))
      .filter(({ x }) => (t.of ? t.of.includes(x.id) : x.id === t.id) && x.at)
      .map(({ x, idx }) => ({ it, at: x.at, have: iHave(it, idx), x })))
      .filter(m => own === "all" || (own === "yes") === !!m.have)
      .sort((a, b) => String(b.at).localeCompare(String(a.at))),
  }));
  const all = myLvl ? data.items.flatMap(it => it.tiers.map((x, idx) => x.at ? iHave(it, idx) : null)
    .filter(v => v !== null)) : [];
  const nYes = all.filter(Boolean).length, nNo = all.length - nYes;
  const shown = shelves.filter(s => (tier == null || s.t.id === tier) && s.items.length);
  const total = data.items.reduce((n, it) => n + it.tiers.filter(x => x.at).length, 0);   // jamais filtre
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
              <span style={{ display:"block", fontSize:17, fontWeight:900, color:"var(--text)" }}>
                {owner ? `La vitrine de ${owner}` : "Ta vitrine"}</span>
              <span style={{ fontSize:11.5, color:"var(--muted)" }}>{total} médaille{total > 1 ? "s" : ""} gagnée{total > 1 ? "s" : ""}
                {tier != null && ` · ${shown[0]?.items.length || 0} en ${shelfTiers(data.tiers).find(t => t.id === tier)?.label}`}</span>
            </span>
            <button onClick={onClose} aria-label="Fermer" style={{ background:"none", border:"none", color:"var(--muted)",
              fontSize:22, cursor:"pointer" }}>✕</button>
          </div>
          {myLvl && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
              {[["all", "Toutes", null], ["yes", "✓ Que tu as aussi", nYes], ["no", "Qui te manquent", nNo]].map(([k, l, n]) => (
                <button key={k} onClick={() => setOwn(k)} style={{ fontSize:11.5, fontWeight:800, padding:"4px 10px",
                  borderRadius:20, cursor:"pointer", border:`1px solid ${own === k ? "#22c55e" : "var(--border)"}`,
                  background: own === k ? "rgba(34,197,94,0.14)" : "transparent",
                  color: own === k ? "var(--text)" : "var(--text2)" }}>
                  {l}{n != null && <span style={{ color:"var(--muted)", fontWeight:700 }}> {n}</span>}</button>
              ))}
            </div>
          )}
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
                  {items.map(({ it, at, have, x }) => (
                    <button key={it.id} onClick={() => onOpen(it.id)}
                      title={`${it.name} · ${dateFr(at)}${have === true ? " · tu l'as aussi" : have === false ? " · tu ne l'as pas encore" : ""}`}
                      style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, minWidth:0, background:"none",
                        border:"none", padding:"2px 0", cursor:"pointer", font:"inherit" }}>
                      <span style={{ position:"relative", display:"inline-flex" }}>
                        {/* il me manque : un anneau ambre en pointilles autour (la medaille reste la sienne) */}
                        {have === false && <span aria-hidden="true" style={{ position:"absolute", inset:-4, borderRadius:"50%",
                          border:"2px dashed rgba(245,158,11,0.85)", boxShadow:"0 0 12px rgba(245,158,11,0.35)" }}/>}
                        <Medal tier={x || t} emoji={it.emoji} size={46}/>
                        {/* je l'ai aussi : une petite coche, la medaille reste la sienne */}
                        {have === true && <span aria-label="Tu l'as aussi" style={{ position:"absolute", right:-2, bottom:2,
                          width:16, height:16, borderRadius:"50%", background:"#22c55e", color:"#fff", fontSize:10,
                          fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1,
                          border:"2px solid var(--sheet-bg)", boxShadow:"0 1px 3px rgba(0,0,0,0.25)" }}>✓</span>}
                        {have === false && <span aria-label="Tu ne l'as pas encore" style={{ position:"absolute", right:-4, bottom:0,
                          width:17, height:17, borderRadius:"50%", background:"#F59E0B", color:"#fff", fontSize:13,
                          fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1,
                          border:"2px solid var(--sheet-bg)", boxShadow:"0 1px 3px rgba(0,0,0,0.25)" }}>+</span>}
                      </span>
                      <span style={{ fontSize:10.5, fontWeight:700, color: have === false ? "#D97706" : "var(--text)",
                        textAlign:"center", lineHeight:1.2,
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

// Depenser plusieurs cles d'un coup : on choisit combien, le serveur choisit ou
// (le plus d'indices possible) ; on voit l'apercu avant de valider.
function AutoSpend({ keys, onSpent }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(keys.balance);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  useEffect(() => { if (!open) { setPlan(null); setErr(null); setN(keys.balance); } }, [open, keys.balance]);
  useEffect(() => {
    if (!open || n < 1) { setPlan(null); return undefined; }
    const t = setTimeout(() => client.post("/achievements/keys-auto", { n, dry: true })
      .then(r => setPlan(r.data)).catch(e => setErr(e.response?.data?.detail || e.message)), 250);
    return () => clearTimeout(t);
  }, [open, n]);
  if (!onSpent || keys.balance < 1) return null;
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await client.post("/achievements/keys-auto", { n }); setDone(r.data); setOpen(false); await onSpent(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const line = p => p.steps.map(x => `${x.n} ${x.label.split(" ").slice(1).join(" ")}${x.n > 1 ? "s" : ""}`).join(" · ");
  return (
    <div onClick={e => e.stopPropagation()} style={{ position:"relative", marginTop:8 }}>
      {!open ? (
        <button onClick={() => { setDone(null); setOpen(true); }} style={{ width:"100%", padding:"7px 10px", borderRadius:10, cursor:"pointer",
          border:"1px solid rgba(250,204,21,.5)", background:"rgba(250,204,21,.12)", color:"#d97706", fontWeight:800, fontSize:12.5 }}>
          ⚡ Dépenser des clés automatiquement</button>
      ) : (
        <div style={{ borderRadius:12, padding:"10px 12px", background:"var(--surface2)", border:"1px solid rgba(250,204,21,.45)",
          display:"flex", flexDirection:"column", gap:8, fontSize:12.5, color:"var(--text2)", textAlign:"left" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontWeight:800, color:"var(--text)" }}>Dépenser</span>
            <input type="range" min={1} max={keys.balance} value={Math.min(n, keys.balance)}
              onChange={e => setN(+e.target.value)} style={{ flex:1, minWidth:0, accentColor:"#f59e0b" }}/>
            <span style={{ fontWeight:900, color:"#d97706", minWidth:44, textAlign:"right" }}>{n} 🔑</span>
          </div>
          <div style={{ fontSize:11.5, color:"var(--muted)", lineHeight:1.45 }}>
            Le plus d'indices possible : d'abord les secrets les moins chers à mener jusqu'à leur indice (ceux qu'un copain a
            gagnés, ceux déjà entamés), puis le reste étape par étape.</div>
          {plan && (plan.steps.length
            ? <div style={{ fontWeight:700, color:"var(--text)" }}>{line(plan)}
                <span style={{ fontWeight:500, color:"var(--muted)" }}> · {plan.secrets} secret{plan.secrets > 1 ? "s" : ""} · {plan.cost} 🔑
                  {plan.left > 0 ? ` (${plan.left} gardée${plan.left > 1 ? "s" : ""} : pas assez pour l'étape suivante)` : ""}</span></div>
            : <div style={{ color:"var(--muted)" }}>Rien à révéler avec {n} clé{n > 1 ? "s" : ""}.</div>)}
          {err && <div style={{ color:"#ef4444", fontSize:12 }}>{err}</div>}
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <button onClick={() => setOpen(false)} style={{ padding:"6px 12px", borderRadius:9, border:"1px solid var(--border)",
              background:"var(--surface)", color:"var(--text2)", cursor:"pointer", fontWeight:700 }}>Annuler</button>
            <button disabled={busy || !plan?.cost} onClick={go} style={{ padding:"6px 14px", borderRadius:9, border:"none",
              cursor: busy || !plan?.cost ? "default" : "pointer", opacity: busy || !plan?.cost ? .6 : 1, fontWeight:800, color:"#7c2d12",
              background:"linear-gradient(180deg,#fde047,#f59e0b)" }}>Valider{plan?.cost ? ` (${plan.cost} 🔑)` : ""}</button>
          </div>
        </div>
      )}
      {done && !open && <div style={{ marginTop:6, fontSize:12, color:"#16a34a", fontWeight:700 }}>
        ✓ Révélé : {line(done)}. Va voir tes secrets !</div>}
    </div>
  );
}

function Treasure(props) {
  return useNarrow() || props.loupes ? <TreasureRow {...props}/> : <TreasureWide {...props}/>;
}

// Sur telephone : cles, tickets et roue cote a cote, trois cases.
function TreasureRow({ keys, onRules, onWheel, onSpent, loupes = null }) {
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
      <div style={{ display:"grid", gridTemplateColumns:`repeat(${1 + (w && !loupes ? 1 : 0) + (w ? 1 : 0)}, minmax(0, 1fr))`, gap:8 }}>
        {loupes ? (
          <div style={{ ...box("rgba(14,165,233,.35)", "rgba(14,165,233,.45)") }}>
            <button type="button" onClick={onRules} aria-label="Les loupes, comment ça marche" title="Une loupe révèle l'indice d'un secret que la maison a déjà. Deux de plus chaque jour, trois au plus."
              style={{ position:"absolute", top:4, right:4, width:18, height:18, borderRadius:"50%", border:"none", cursor:"pointer", fontSize:10.5, fontWeight:900,
                color:"var(--muted)", background:"var(--surface)", boxShadow:"inset 0 0 0 1px var(--border)" }}>?</button>
            <span style={iconSlot}><span style={{ fontSize:24, lineHeight:1, animation:"bn-float 3.5s ease-in-out infinite" }}>🔍</span></span>
            <span style={{ fontSize:24, fontWeight:900, lineHeight:1, background:"linear-gradient(180deg,#38bdf8,#6366f1)",
              WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }}>{loupes.loupes || 0}</span>
            <span style={{ fontSize:10.5, color:"var(--muted)", fontWeight:700 }}>loupe{(loupes.loupes || 0) > 1 ? "s" : ""}</span>
            <span style={{ display:"flex", gap:4, marginTop:3 }}>{[...Array(loupes.loupes_max || 3).keys()].map(i =>
              <span key={i} style={{ width:7, height:7, borderRadius:"50%", background: i < (loupes.loupes || 0) ? "#0EA5E9" : "var(--surface)" }}/>)}</span>
            <span style={{ fontSize:9.5, color:"var(--muted)" }}>+{loupes.loupes_day || 2} demain</span>
          </div>
        ) : (
        <button onClick={() => (log.length || onSpent) && setOpen(o => !o)} style={{ ...box("rgba(250,204,21,.35)", "rgba(250,204,21,.45)"), cursor:"pointer",
          font:"inherit", color:"inherit", margin:0, justifyContent:"flex-start" }}>
          <span style={iconSlot}><span style={{ fontSize:24, lineHeight:1, animation:"bn-float 3.5s ease-in-out infinite" }}>🔑</span></span>
          <span style={{ fontSize:24, fontWeight:900, lineHeight:1, background:"linear-gradient(180deg,#fde047,#f59e0b)",
            WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }}>{keys.balance}</span>
          <span style={{ fontSize:10.5, color:"var(--muted)", fontWeight:700 }}>clés</span>
          {mini(Math.round(100 * (1 - (keys.to_next || prints) / prints)), "linear-gradient(90deg,#fde047,#f59e0b)")}
          <span style={{ fontSize:9.5, color:"var(--muted)" }}>dans {keys.to_next} impr.</span>
        </button>
        )}
        {w && !loupes && (
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
          <AutoSpend keys={keys} onSpent={onSpent}/>
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

function TreasureWide({ keys, onRules, onWheel, onSpent }) {
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
          <AutoSpend keys={keys} onSpent={onSpent}/>
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
  const ladder = (tiers || []).filter(t => t.id !== "unique" && !t.card);
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

function Card({ it, focus, sheet = false, others, shared, keys, onSpend, keyErr, rivals, tickets = 0, onTicket, loupes = null, onLoupe }) {
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
                  {/* chacun avec ce qu'il demande, en gras : on ne confond plus l'acquis et le suivant */}
                  <span style={{ display:"flex", alignItems:"flex-start", gap:5 }}>
                    <span style={{ minWidth:58, fontSize:11, fontWeight:700, paddingTop:1 }}>Actuel</span>
                    {got ? <span style={{ display:"inline-flex", flexWrap:"wrap", alignItems:"center", gap:"0 5px" }}>
                        <Medal tier={top} emoji="" size={14}/><span style={{ color:"var(--text)" }}>{top.label}</span>
                        {top.desc && <b style={{ color:"var(--text)" }}>· {top.desc}</b>}</span>
                      : <span>pas encore de palier</span>}
                  </span>
                  <span style={{ display:"flex", alignItems:"flex-start", gap:5 }}>
                    <span style={{ minWidth:58, fontSize:11, fontWeight:700, paddingTop:1 }}>Prochain</span>
                    <span style={{ display:"inline-flex", flexWrap:"wrap", alignItems:"center", gap:"0 5px" }}>
                      <Medal tier={it.tiers[it.level + 1]} emoji="" size={14} locked/>
                      <span style={{ color:"var(--text2)" }}>{it.tiers[it.level + 1]?.label}</span>
                      <b style={{ color:"var(--text)" }}>· {it.tiers[it.level + 1]?.desc || it.desc}</b></span>
                  </span>
                </span>
              )}</div>
          {unique && got && (
            <div style={{ fontSize:11, fontWeight:700, color:top.color, marginTop:3 }}>Gagné le {dateFr(top.at)}</div>
          )}
          {it.prog && !got && (
            <div style={{ fontSize:11.5, color:"var(--text2)", marginTop:3 }}>Où tu en es : <b>{it.prog[0]} / {it.prog[1]}</b></div>
          )}
          {sheet && <Spent it={it}/>}
          {sheet && got && <SecretPlace it={it}/>}
        </div>
      </div>
      {it.scoop && (
        <p style={{ margin:0, fontSize:12.5, fontWeight:800, lineHeight:1.45, background:"linear-gradient(90deg, #EC4899, #F59E0B)",
          WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }}>
          ✨ Trouvé avant {it.scoop_house || "la maison"} : {it.scoop_house || "la maison"} ne l'a pas encore !</p>
      )}
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
      {/* famille : une loupe revele l'indice d'un secret que la maison a deja */}
      {sheet && unique && !got && it.house && !it.hint && loupes != null && (
        <button type="button" onClick={onLoupe} disabled={!loupes}
          style={{ alignSelf:"flex-start", display:"inline-flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:20, border:"none",
            cursor: loupes ? "pointer" : "default", fontWeight:800, fontSize:12.5, color:"#fff", opacity: loupes ? 1 : 0.55,
            background:"linear-gradient(135deg, #0EA5E9, #6366F1)" }}>
          🔍 {loupes ? `Révéler l'indice (il te reste ${loupes} loupe${loupes > 1 ? "s" : ""})` : "Plus de loupe aujourd'hui : deux de plus demain"}</button>
      )}
      {sheet && unique && !got && it.gift_from?.length > 0 && (
        <p style={{ margin:0, fontSize:12.5, fontWeight:700, color:"#8B5CF6" }}>
          🎁 Catégorie, vignette et titre offerts grâce à {it.gift_from.join(", ")}</p>
      )}
      {sheet && unique && it.secret && !got && keys && <Reveal it={it} keys={keys} onSpend={onSpend} err={keyErr}/>}
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
  useTrackDetail("Succès · Règles");
  const ladder = data.tiers.filter(t => t.id !== "unique" && !t.card);
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
        <P>Ce qui se lit <b>au présent</b> (stock, MakerWorld, copains…) garde ce qui a été gagné, même si la valeur redescend.
          Exception : les secrets qui tiennent à <b>ta disposition de l'accueil</b> suivent ce qu'elle est : la défaire les
          retire, la refaire les rend, sans nouvelle clé.</P>
        <P>Certains gestes ne laissent de trace nulle part ailleurs : l'appli les note elle-même <b>à partir du moment où elle
          les voit</b> (séchages dans l'AMS, pesées, réassorts, visites chez tes copains et des copains chez toi ; et depuis
          le 22/10/2026 : connexion de l'imprimante, couches, changements de bobine, alertes, humidité des AMS, impressions en
          même temps que les copains, dispositions de l'accueil, temps de caméra en direct). Tes
          évaluations et tes points MakerWorld, eux, sont relus sur <b>tout ton historique</b>.</P>
        <P>Quand des seuils changent ou qu'un succès apparaît, tout se recalcule en silence : ce que ton historique méritait
          déjà t'est donné, sans notification ni clé.</P>

        <H>🤫 Secrets</H>
        <P>Une médaille unique, cachée tant qu'elle n'est pas gagnée. Les secrets inconnus attendent dans « À découvrir » ;
          une fois gagnés, ils rejoignent leur sous-section. Les <b>collections</b> récompensent une section entière à un même
          palier intermédiaire (Argent, Or, Diamant, Légende, Cosmique) ; les autres sont des cartes.</P>
        <P><b>Complétude</b> : toutes les collections, une section entièrement à son dernier palier, et tout à
          100 %. Un tiroir de secrets entièrement trouvé, c'est son As. Ces médailles-là, comme les collections, <b>se perdent</b> si un nouveau secret ou un nouveau palier arrive avec
          une mise à jour : il suffit de le décrocher pour les retrouver.</P>
        <P>Certains secrets se cachent derrière une adresse, d'autres derrière un geste. Et de temps en temps, en ouvrant
          l'appli, l'accueil te joue un tour : plus il se fait attendre, plus il devient probable. Ces tours-là ne se gagnent
          que s'ils te tombent dessus par surprise, et ceux des jours de fête, seulement le jour même. Un tour déjà vécu peut se rejouer ; les autres, personne ne peut les provoquer.
          En tête des Secrets, 🎲 dit ta chance à la prochaine ouverture ; touche-le pour voir celle de chaque compte et combien de surprises chacun a déjà eues.</P>

        <H>🎓 Grades</H>
        <P>Chaque section te donne un titre selon la part de ses points que tu as gagnés ({GRADE_AT.map(x => `${Math.round(x * 100)} %`).join(", ")}) :
          par exemple, aux Impressions, de « {GRADES.prints[0]} » à « {GRADES.prints[4]} ». Ton <b>grade général</b> suit ton score
          total, de « {GRADES._[0]} » à « {GRADES._[4]} ». Chaque grade a trois échelons (I, II, III), un par tiers de son
          intervalle. Les grades ne rapportent pas de points : ils disent où tu en es.</P>

        <H>🃏 Mes cartes</H>
        <P>Chaque section et chaque tiroir de secrets a sa main de quatre cartes. Pour une section : le <b>Valet</b> quand tous
          ses succès ont au moins le Bronze, la <b>Dame</b> au Platine, le <b>Roi</b> au Mythique, l'<b>As</b> à l'Éternel. Pour
          un tiroir : 25, 50, 75 % de ses secrets trouvés, et tous pour l'As. Une section ou un tiroir qui apparaît a d'office
          sa main.</P>
        <P>Quatre <b>Jokers</b> : un pour tous les Valets, un pour toutes les Dames, un pour tous les Rois, et le <b>Joker
          d'or</b> pour tous les As (la carte des secrets de l'appli Android n'y compte qu'une fois l'un d'eux trouvé). Comme les collections, une carte <b>se retourne</b> si un nouveau succès ou secret arrive :
          il suffit de le décrocher pour la retrouver. Une carte gagnée se fête à la prochaine ouverture de l'appli, sur le compte principal : c'est à toi de la retourner, et plus elle est haute, plus la fête est grande (son, vibration, reflet holographique pour l'As et les Jokers). Elle rapporte {k ? k.rules.secret : 3} clés et un tour de roue
          (celles de « Clés et roue », un tour seulement).</P>

        {k && <>
          <H>🔑 Clés</H>
          <P><b>Gagner des clés</b> : {k.rules.start} au départ · 1 toutes les {k.rules.prints} impressions réussies ·
            {" "}{k.rules.tier} par palier franchi · {k.rules.secret} par secret gagné. Et parfois, une surprise.
            Rien de rétroactif : ce qui est reconnu après coup ne rapporte rien.</P>
          <P><b>Les dépenser</b> pour révéler un secret pas encore gagné, une étape après l'autre :</P>
          <div style={{ display:"flex", flexDirection:"column", gap:3, margin:"0 0 6px 4px", fontSize:12.5, color:"var(--text2)" }}>
            {k.steps.map((st, i) => <span key={st.id}>{i + 1}. {st.label.charAt(0).toUpperCase() + st.label.slice(1)} — {st.cost} 🔑</span>)}
          </div>
          <P><b>Dépense automatique</b> (⚡ sous tes clés) : tu choisis combien en dépenser, l'appli choisit où. Elle vise le plus
            d'indices possible. Les secrets liés à une date (calendrier, fêtes, cachettes de saison) passent en premier, pour que tu
            puisses les anticiper ; les tours qui ne tombent que par hasard sont laissés de côté (un indice n'y changerait rien), et les
            secrets de l'appli Android aussi, tant qu'aucun n'a été trouvé (sans l'appli, ils sont introuvables). Ensuite, les secrets les moins chers à mener jusqu'à leur indice (ceux qu'un copain a gagnés, ceux
            déjà entamés), puis elle avance les suivants étape par étape ; les descriptifs ne passent qu'une fois tous les indices
            pris. Tu vois ce qui sera révélé avant de valider.</P>
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

        <H>🏠 Les comptes de la maison</H>
        <P>Les <b>clés</b> et les <b>tickets</b> ne se dépensent que depuis le compte principal. La <b>roue</b> aussi, sauf
          pour un compte à qui il l'a permise : le lot va alors à la maison.</P>
        <P>Un compte de la <b>famille</b> (case cochée par l'administrateur) cherche les easter eggs, cachettes, secrets Android,
          farces, fêtes et pages cachées pour lui-même : il voit ses trouvailles en entier, et celles de la maison comme chez un
          copain (catégorie, médaille et titre, « untel l'a déjà »). Le reste des succès est celui de la maison.</P>
        <P>Chaque compte de la famille a des <b>loupes</b> : deux de plus chaque jour, trois au plus. Une loupe révèle l'indice d'un
          secret que le compte principal a déjà trouvé. Dans l'autre sens, ce que la famille trouve et que le principal n'a pas encore
          apparaît chez lui « à portée », avec l'initiale de celui qui l'a, et ses trois premières étapes offertes.</P>
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
// Une carte a jouer : de dos tant qu'elle n'est pas gagnee ; de face, son rang
// dans les coins et l'enseigne de sa section au centre. L'As a le liseré
// arc-en-ciel de l'Eternel, le Joker d'or brille.
export const CARD_ORDER = ["card_v", "card_d", "card_r", "card_a", "card_jv", "card_jd", "card_jr", "card_ja"];
function PlayCard({ tier, emoji, size, locked }) {
  const h = size, w = Math.round(size * 0.72), c = tier.color;
  // dos : une couleur trop sombre (l'As, noir comme l'Eternel) se perdrait sur le tapis
  const n = parseInt(c.slice(1), 16), dark = ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 80;
  const bc = dark ? "#C4B5FD" : c;
  const r = Math.max(3, size * 0.11), b = Math.max(1.2, size / 30);
  const corners = size >= 34, gold = tier.id === "card_ja" || tier.id === "jokers", ace = tier.id === "card_a";
  const corner = flip => (
    <span style={{ position:"absolute", [flip ? "bottom" : "top"]: size * 0.04, [flip ? "right" : "left"]: size * 0.06,
      transform: flip ? "rotate(180deg)" : "none", fontSize: size * 0.2, fontWeight:900, lineHeight:1,
      fontFamily:"Georgia, 'Times New Roman', serif", color: gold ? "#7a5300" : c }}>{tier.card}</span>
  );
  return (
    <span style={{ position:"relative", width:size, height:size, flexShrink:0, display:"inline-flex", alignItems:"center",
      justifyContent:"center" }}>
      {ace && !locked && size >= 30 && (
        <span aria-hidden="true" style={{ position:"absolute", width: w + 4, height: h + 4, borderRadius: r + 2, overflow:"hidden" }}>
          <span style={{ position:"absolute", inset:"-50%", animation:"bn-medal-turn 4s linear infinite",
            background:"conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)" }}/>
        </span>
      )}
      {locked ? (
        <span style={{ position:"relative", width:w, height:h, borderRadius:r, boxSizing:"border-box", opacity:0.7,
          border:`${b}px solid ${rgba(bc, 0.55)}`, boxShadow:"0 1px 4px rgba(0,0,0,0.25)",
          background:`repeating-linear-gradient(45deg, ${rgba(bc, 0.30)} 0 ${Math.max(2, size / 16)}px, transparent 0 ${Math.max(4, size / 8)}px), ` +
            "linear-gradient(160deg, #3b3355, #1d1830)" }}>
          <span style={{ position:"absolute", inset: size * 0.09, borderRadius: r * 0.6, border:`1px solid ${rgba(bc, 0.45)}` }}/>
        </span>
      ) : (
        <span style={{ position:"relative", width:w, height:h, borderRadius:r, boxSizing:"border-box", overflow:"hidden",
          display:"flex", alignItems:"center", justifyContent:"center",
          border:`${b}px solid ${gold ? "#B8860B" : c}`, boxShadow:`0 2px 6px rgba(0,0,0,0.28), 0 0 ${size / 6}px ${rgba(c, 0.35)}`,
          background: gold ? "linear-gradient(135deg, #fff6cf, #e9b62f 45%, #fff1b5 60%, #c99412)"
            : `linear-gradient(160deg, #fffdf7, #f1ebde)` }}>
          {size >= 30 && <span aria-hidden="true" style={{ position:"absolute", inset: size * 0.07, borderRadius: r * 0.6,
            border:`1px solid ${rgba(gold ? "#B8860B" : c, 0.35)}` }}/>}
          {corners && corner(false)}
          {corners && corner(true)}
          <span style={{ position:"relative", fontSize: size * (corners ? 0.34 : 0.42), lineHeight:1 }}>{emoji || (corners ? "" : tier.card)}</span>
          {gold && size >= 30 && (
            <span aria-hidden="true" style={{ position:"absolute", top:"-20%", bottom:"-20%", width:"40%",
              background:"linear-gradient(90deg, transparent, rgba(255,255,255,.8), transparent)",
              animation:"bn-medal-sweep 3s ease-in-out infinite" }}/>
          )}
        </span>
      )}
    </span>
  );
}

export function Medal({ tier, emoji, size = 48, locked = false }) {
  if (tier?.card) return <PlayCard tier={tier} emoji={emoji} size={size} locked={locked}/>;
  const c = locked ? "#8a8f98" : tier.color;
  const id = `m${tier.id}${locked ? "l" : ""}`;
  // chaque palier vit a sa facon, de plus en plus fort : lueur (Bronze), eclat (Argent), paillettes (Or),
  // givre (Platine), prisme (Diamant), reflet (Legende), halo (Mythique), etoiles (Cosmique),
  // liseré arc-en-ciel (Eternel), coeurs (Unique)
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
      {fx === "bronze" && (
        <span aria-hidden="true" style={{ ...disc, boxShadow:`0 0 10px 3px ${tier.color}`,
          animation:"bn-medal-breath 4s ease-in-out infinite" }}/>
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
      {fx === "silver" && (
        <span aria-hidden="true" style={{ position:"absolute", left: disc.left + r * 0.15, top: disc.top - r * 0.05,
          fontSize: Math.max(9, size * 0.28), color:"#fff", textShadow:"0 0 6px #fff, 0 0 10px #cbd5e1", lineHeight:1,
          pointerEvents:"none", animation:"bn-medal-glint 3.6s ease-in-out infinite" }}>✦</span>
      )}
      {fx === "gold" && [[0.08, 0.38, 0], [0.86, 0.42, 0.6], [0.5, 0.98, 1.2], [0.92, 0.88, 1.8], [0.06, 0.9, 2.4]].map(([x, y, d], i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", left: size * x - 2, top: size * y - 2, width:4, height:4,
          borderRadius:"50%", background:"#fde68a", boxShadow:"0 0 6px 1px #fbbf24", pointerEvents:"none",
          animation:`bn-medal-fizz 3s ${d}s ease-in-out infinite` }}/>
      ))}
      {fx === "platinum" && (
        <span aria-hidden="true" style={{ ...disc, overflow:"hidden" }}>
          <span style={{ position:"absolute", inset:"-25%", borderRadius:"50%",
            background:"conic-gradient(from 0deg, transparent 0 60%, rgba(255,255,255,.55) 70%, transparent 80% 100%)",
            animation:"bn-medal-frost 5s linear infinite" }}/>
        </span>
      )}
      {fx === "diamond" && (
        <span aria-hidden="true" style={{ ...disc, overflow:"hidden" }}>
          <span style={{ position:"absolute", inset:0,
            background:"linear-gradient(120deg, transparent 20%, rgba(244,114,182,.7) 35%, rgba(96,165,250,.7) 50%, rgba(52,211,153,.7) 65%, transparent 80%)",
            animation:"bn-medal-prism 2.6s ease-in-out infinite" }}/>
          <span style={{ position:"absolute", inset:0,
            background:"linear-gradient(60deg, transparent 25%, rgba(253,224,71,.65) 45%, rgba(167,139,250,.7) 60%, transparent 78%)",
            animation:"bn-medal-prism 2.6s 1.3s ease-in-out infinite" }}/>
        </span>
      )}
      {fx === "unique" && [[0.12, 0], [0.78, 1.1], [0.45, 2.2]].map(([x, d], i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", left: size * x, top: disc.top - 2, lineHeight:1,
          fontSize: Math.max(7, size * 0.18), color:"#f9a8d4", textShadow:"0 0 5px #ec4899", pointerEvents:"none",
          animation:`bn-medal-rise 3.3s ${d}s ease-out infinite` }}>♥</span>
      ))}
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

// Grades : un titre par section selon la part de ses points gagnes, et un grade
// general sur le score total. Une section sans titres a elle prend ceux du compagnonnage.
const GRADE_AT = [0.05, 0.2, 0.4, 0.65, 0.9];
const GRADES = {
  _: ["Curieux", "Bidouilleur", "Maker", "Fabricant", "Légende du fablab"],
  prints: ["Bidouilleur", "Imprimeur", "Artisan", "Maître imprimeur", "Légende de la buse"],
  filaments: ["Curieux", "Collectionneur", "Coloriste", "Alchimiste", "Gardien de l'arc-en-ciel"],
  objects: ["Brocanteur", "Marchand", "Commerçant", "Négociant", "Magnat"],
  mw: ["Visiteur", "Habitué", "Créateur", "Star", "Icône"],
  photos: ["Amateur", "Photographe", "Reporter", "Artiste", "Légende du cadre"],
  app: ["Nouveau", "Familier", "Habitué", "Expert", "Ange gardien"],
  social: ["Solitaire", "Sociable", "Rassembleur", "Chef de bande", "Âme de la bande"],
  game: ["Chanceux", "Joueur", "Parieur", "Flambeur", "Maître du casino"],
  cards: ["Joueur du dimanche", "Habitué du tapis", "Croupier", "Brelan d'as", "Roi du tapis vert"],
  secret: ["Fureteur", "Détective", "Chasseur de trésors", "Initié", "Gardien des secrets"],
  other: ["Apprenti", "Compagnon", "Artisan", "Maître", "Grand Maître"],
};
// Chaque grade a trois echelons (I, II, III), chacun un tiers de son intervalle
// (le dernier grade va de 90 a 100 %). sub : l'echelon (0 a 2) ; stepLo et
// nextAt : le debut de l'echelon et le seuil du suivant.
const ROMAN = ["I", "II", "III"];
export function gradeOf(cat, v) {
  const names = cat == null ? GRADES._ : GRADES[cat] || GRADES.other;
  let i = -1;
  GRADE_AT.forEach((x, j) => { if (v >= x) i = j; });
  if (i < 0) return { i, sub: -1, name: null, base: null, next: `${names[0]} I`, nextAt: GRADE_AT[0], stepLo: 0, general: cat == null };
  const lo = GRADE_AT[i], hi = GRADE_AT[i + 1] ?? 1, step = (hi - lo) / 3;
  const sub = Math.max(0, Math.min(2, Math.floor((v - lo) / step + 1e-9)));
  const next = sub < 2 ? `${names[i]} ${ROMAN[sub + 1]}` : names[i + 1] ? `${names[i + 1]} I` : null;
  const nextAt = sub < 2 ? lo + step * (sub + 1) : names[i + 1] ? hi : null;
  return { i, sub, name: `${names[i]} ${ROMAN[sub]}`, base: names[i], next, nextAt, stepLo: lo + step * sub, general: cat == null };
}
// Les metaux des grades : fer, bronze, argent, or, puis l'irise de la legende
const GRADE_METAL = [
  { a:"#D1D5DB", b:"#6B7280", ink:"#374151", name:"Fer" },
  { a:"#F6C48F", b:"#9A4E1C", ink:"#7C3A10", name:"Bronze" },
  { a:"#F8FAFC", b:"#94A3B8", ink:"#475569", name:"Argent" },
  { a:"#FDE68A", b:"#B7791F", ink:"#8A5A00", name:"Or" },
  { a:"#F5D0FE", b:"#7C3AED", ink:"#6D28D9", name:"Légende" },
];
// L'ecusson d'un grade : un blason de metal, une buse gravee au centre, et ses
// echelons (etoiles) en dessous. Le dernier a un liseré arc-en-ciel et un reflet.
export function GradeEmblem({ i, size = 22, locked = false }) {
  const m = GRADE_METAL[Math.max(0, i)], id = `ge${i}${locked ? "l" : ""}${size}`, top = i === 4 && !locked;
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 40 46" aria-hidden="true" style={{ flexShrink:0, overflow:"visible",
      filter: locked ? "grayscale(1) opacity(.35)" : top ? "drop-shadow(0 0 6px rgba(168,85,247,.7))" : `drop-shadow(0 1px 2px ${m.b}88)` }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={m.a}/><stop offset=".55" stopColor={m.b}/><stop offset="1" stopColor={m.a}/>
        </linearGradient>
        {top && <linearGradient id={id + "r"} x1="0" y1="0" x2="1" y2="0">
          {["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#d946ef"].map((c, k) =>
            <stop key={c} offset={k / 6} stopColor={c}/>)}
        </linearGradient>}
      </defs>
      <path d="M20 2 L37 8 V22 C37 33 29 40 20 44 C11 40 3 33 3 22 V8 Z" fill={`url(#${id})`}
        stroke={top ? `url(#${id}r)` : m.b} strokeWidth={top ? 2.6 : 1.6}/>
      <path d="M20 6 L33 10.5 V22 C33 31 27 36.5 20 40 C13 36.5 7 31 7 22 V10.5 Z" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="1"/>
      {/* la buse */}
      <path d="M13.5 12 H26.5 V17 H24 L22 25 H18 L16 17 H13.5 Z" fill="#fff" fillOpacity=".92"/>
      <path d="M18.6 25 H21.4 L20 28.5 Z" fill="#fff" fillOpacity=".92"/>
      {/* les echelons */}
      {[0, 1, 2, 3, 4].map(k => <circle key={k} cx={12 + k * 4} cy="34" r="1.5" fill="#fff" fillOpacity={k <= i ? 0.95 : 0.3}/>)}
      {top && !locked && <rect x="-20" y="0" width="14" height="46" fill="#fff" opacity=".45" transform="skewX(-20)"
        style={{ animation:"bn-grade-sweep 3.2s ease-in-out infinite" }}/>}
    </svg>
  );
}
// le grade d'une section, dans son en-tete : l'ecusson et le titre grave dans son metal
function GradeBadge({ g }) {
  if (!g || g.i < 0) return null;
  const m = GRADE_METAL[g.i];
  return (
    <span title={`Ton grade dans cette section (${m.name})`} style={{ display:"inline-flex", alignItems:"center", gap:5,
      whiteSpace:"nowrap", padding:"1px 9px 1px 3px", borderRadius:20, fontSize:11.5, fontWeight:900, letterSpacing:".02em",
      background:`linear-gradient(135deg, ${m.a}55, ${m.b}22)`, border:`1px solid ${m.b}66` }}>
      <GradeEmblem i={g.i} size={18}/>
      <span style={{ color:"var(--text)" }}>{g.name}</span>
    </span>
  );
}
// le grade general : une plaque sur toute la largeur, l'ecusson en grand, le
// titre, les cinq echelons et le chemin jusqu'au suivant
function GradePlate({ v, friend }) {
  const g = gradeOf(null, v);
  const i = Math.max(0, g.i), m = GRADE_METAL[i], none = g.i < 0;
  const lo = g.stepLo, hi = g.nextAt;
  const p = hi ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 1;
  const nx = GRADE_METAL[g.sub < 2 && !none ? i : Math.min(4, g.i + 1)];
  return (
    <div className="card gplate" style={{ position:"relative", overflow:"hidden", padding:"16px 18px", borderRadius:18,
      border:`1px solid ${m.b}77`,
      // le metal sur toute la largeur : teinte a gauche, reflets en biais, l'eclat du grade suivant a droite
      background:`linear-gradient(100deg, ${m.a}88 0%, ${m.b}33 45%, ${nx.a}55 100%), ` +
        `repeating-linear-gradient(115deg, rgba(255,255,255,0.07) 0 2px, transparent 2px 14px), var(--surface)`,
      boxShadow:`inset 0 1px 0 rgba(255,255,255,.3), 0 10px 28px -16px ${m.b}` }}>
      <style>{`
        @keyframes bn-grade-sweep { 0%, 55% { transform: translateX(0) skewX(-20deg) } 100% { transform: translateX(80px) skewX(-20deg) } }
        .gplate-in { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
        .gplate-ladder { display:flex; gap:6px; align-items:flex-end; margin-left:auto; }
        @media (max-width: 620px) { .gplate-ladder { margin-left:0; width:100%; justify-content:space-between; } }
      `}</style>
      <div className="gplate-in">
        <span data-pk=""><GradeEmblem i={i} size={62} locked={none}/></span>
        <div style={{ flex:"1 1 180px", minWidth:0, display:"flex", flexDirection:"column", gap:4 }}>
          <span style={{ fontSize:10.5, fontWeight:800, letterSpacing:".16em", textTransform:"uppercase", color:"var(--muted)" }}>
            🎓 {friend ? "Son grade de maker" : "Ton grade de maker"}</span>
          <span style={{ fontSize:24, fontWeight:900, lineHeight:1.1,
            ...(i === 4 && !none ? { backgroundImage:"linear-gradient(90deg, #dc2626, #d97706, #ca8a04, #16a34a, #0891b2, #4f46e5, #c026d3)",
              WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }
              : { color: none ? "var(--muted)" : "var(--text)", textShadow: none ? "none" : `0 0 14px ${m.b}88` }) }}>
            {none ? "Pas encore de grade" : g.name}</span>
          {g.next ? (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:2 }}>
              <span style={{ flex:1, height:7, borderRadius:7, background:"rgba(0,0,0,0.10)", overflow:"hidden", minWidth:60 }}>
                <span style={{ display:"block", height:"100%", width:`${Math.round(p * 100)}%`, borderRadius:7,
                  background:`linear-gradient(90deg, ${m.b}, ${nx.b})` }}/></span>
              <span style={{ fontSize:11.5, color:"var(--text2)", whiteSpace:"nowrap" }}>
                <b>{g.next}</b> à {Math.round(hi * 100)} %</span>
            </div>
          ) : <span style={{ fontSize:12, fontWeight:800, color:m.b }}>Tout en haut ✨</span>}
        </div>
        {/* l'echelle des cinq grades : le mien en avant, les suivants a conquerir */}
        <div className="gplate-ladder">
          {GRADE_AT.map((x, k) => {
            const mine = k === g.i, got = k <= g.i;
            return (
              <div key={k} title={`${GRADES._[k]} · ${Math.round(x * 100)} %`} style={{ display:"flex", flexDirection:"column",
                alignItems:"center", gap:3, width:58, padding:"6px 2px", borderRadius:12,
                background: mine ? "rgba(255,255,255,0.35)" : "transparent",
                border: mine ? `1px solid ${GRADE_METAL[k].b}88` : "1px solid transparent" }}>
                <span data-pk=""><GradeEmblem i={k} size={mine ? 30 : 24} locked={!got}/></span>
                <span style={{ fontSize:9.5, fontWeight: mine ? 900 : 700, textAlign:"center", lineHeight:1.15,
                  color: got ? "var(--text)" : "var(--muted)" }}>{GRADES._[k]}</span>
                {/* ses trois echelons : ceux deja franchis en plein */}
                <span style={{ display:"flex", gap:2 }}>
                  {ROMAN.map((r, j) => {
                    const on = k < g.i || (mine && j <= g.sub);
                    return <span key={r} data-pk="" style={{ fontSize:8.5, fontWeight:900, padding:"0 3px", borderRadius:4, lineHeight:"13px",
                      color: on ? "#fff" : "var(--muted)", background: on ? GRADE_METAL[k].b : "transparent",
                      border: on ? "none" : "1px solid var(--border)" }}>{r}</span>;
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Ambiance « salle de jeu » : chaque section a sa couleur (tapis, reflets, jeton)
const CAT_COLOR = { prints:"#0EA5E9", filaments:"#F97316", objects:"#EC4899", mw:"#22C55E", photos:"#8B5CF6",
  app:"#6366F1", social:"#14B8A6", game:"#EF4444", cards:"#D4A017", secret:"#A855F7" };
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
const SUB_COLOR = { android:"#3DDC84", calendar:"#F97316", clock:"#6366F1", measures:"#0EA5E9", colors:"#EC4899", counts:"#14B8A6",
  ups:"#EF4444", trade:"#F59E0B", mw:"#22C55E", social:"#06B6D4", app:"#8B5CF6", eggs:"#EAB308", game:"#DC2626",
  sets:"#D4A017", jokers:"#D4A017" };
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
      <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1, fontSize:19 }}>{emoji}</span>
    </span>
  );
}
const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
