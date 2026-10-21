import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { TicketStub } from "../pages/Achievements";

// Roue de la fortune, facon machine a sous : le lot est tire par le serveur,
// la page ne fait que jouer l'animation jusqu'a lui. Trois rouleaux qui
// defilent et s'arretent l'un apres l'autre ; trois symboles pareils = gagne.
// un symbole bien distinct par lot (🗝️ se confondait avec 🔑 sur certains ecrans)
const SYM = { key1: "🔑", key3: "🍀", key5: "💎", jackpot: "💰", replay: "🔁", hint: "🔍", ticket: "🎟️" };
const FILLER = ["🔑", "🍀", "💎", "💰", "🔁", "🔍", "🎟️", "🍒", "⭐", "🍋", "🔔"];
const LEGEND = [["🔑", "1 clé"], ["🍀", "3 clés"], ["💎", "5 clés"], ["💰", "10 clés"], ["🎟️", "ticket de palier"],
  ["🔁", "rejoue"], ["🔍", "coup de pouce"]];
const H = 76;                      // hauteur d'une case
const LEN = 28;                    // cases par rouleau avant l'arret
const pick = a => a[Math.floor(Math.random() * a.length)];
// ampoules tout autour du cadre (en % de la machine)
const BULBS = [
  ...[8, 22, 36, 50, 64, 78, 92].map(x => [x, 0]), ...[25, 50, 75].map(y => [100, y]),
  ...[92, 78, 64, 50, 36, 22, 8].map(x => [x, 100]), ...[75, 50, 25].map(y => [0, y]),
];

function targets(prize) {
  if (SYM[prize]) return [SYM[prize], SYM[prize], SYM[prize]];
  // perdu : trois symboles qui ne s'alignent pas
  const a = pick(FILLER);
  let b = pick(FILLER), c = pick(FILLER);
  while (b === a) b = pick(FILLER);
  while (c === a && c === b) c = pick(FILLER);
  return [a, b, c];
}

// un rouleau : il repart du symbole ou il s'etait arrete, et finit sur le lot
function strip(last, first) {
  return [first || pick(FILLER), ...Array.from({ length: LEN - 2 }, () => pick(FILLER)), last];
}

export default function SlotMachine({ wheel, onClose, onDone }) {
  const [spins, setSpins] = useState(wheel?.spins || 0);
  const [phase, setPhase] = useState("idle");          // idle | spinning | done
  const [reels, setReels] = useState(() => [0, 1, 2].map(() => strip(pick(FILLER))));
  const [go, setGo] = useState(false);                 // declenche la translation
  const [res, setRes] = useState(null);
  const [bonus, setBonus] = useState(null);           // cles rapportees en plus par les succes debloques
  const [err, setErr] = useState(null);
  const [help, setHelp] = useState(false);            // l'aide : les lots, ce qu'ils valent, leurs chances
  const timers = useRef([]);
  const finish = useRef(null);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const spin = async () => {
    if (phase === "spinning" || spins <= 0) return;
    setErr(null); setRes(null); setBonus(null);
    let r;
    try { r = (await client.post("/achievements/wheel/spin")).data; }
    catch (e) { setErr(e.response?.data?.detail || e.message); return; }
    // le tour fait avancer des succes (paliers, secrets) : ce qu'ils rapportent en plus, a part
    const bonusP = client.post("/achievements/wheel/settle", null, { params: { since: r.at } })
      .then(x => x.data.bonus || []).catch(() => []);
    const t = targets(r.prize);
    setGo(false);
    setReels(rs => t.map((x, i) => strip(x, rs[i][rs[i].length - 1])));
    setPhase("spinning");
    // une image plus tard : la translation part de zero vers la derniere case
    requestAnimationFrame(() => requestAnimationFrame(() => setGo(true)));
    // le resultat s'affiche quand le dernier rouleau s'arrete (filet : 6 s)
    let shown = false;
    finish.current = () => {
      if (shown) return;
      shown = true;
      setRes(r); setSpins(r.spins); setPhase("done");
      bonusP.then(b => { setBonus(b); onDone?.(); });
    };
    timers.current.push(setTimeout(() => finish.current?.(), 6000));
  };

  const win = res && res.prize !== "none";
  const big = res && (res.prize === "jackpot" || res.prize === "key5");
  return createPortal(
    <div data-no-pull="" onClick={phase === "spinning" ? undefined : onClose}
      style={{ position:"fixed", inset:0, zIndex:4400, background:"rgba(0,0,0,0.7)", display:"flex",
        alignItems:"center", justifyContent:"center", padding:16 }}>
      <style>{`
        @keyframes bn-bulb { 0%,100% { opacity:1; box-shadow:0 0 8px 2px #fde047 } 50% { opacity:.35; box-shadow:none } }
        @keyframes bn-win { 0%,100% { transform:scale(1) } 50% { transform:scale(1.08) } }
        @keyframes bn-fall { to { transform:translateY(110vh) rotate(720deg); opacity:.2 } }
        @keyframes bn-lever { 0% { transform:rotate(0) } 40% { transform:rotate(38deg) } 100% { transform:rotate(0) } }
        @keyframes bn-flash { 0%,100% { opacity:0 } 15% { opacity:.85 } 45% { opacity:0 } 60% { opacity:.6 } }
        @keyframes bn-ticket-out { from { transform:translateY(-100%) } to { transform:translateY(0) } }
        @keyframes bn-ticket-wiggle { 0%,100% { transform:rotate(0) } 50% { transform:rotate(-4deg) } }
      `}</style>
      {win && Array.from({ length: big ? 70 : 28 }).map((_, i) => (
        <span key={`${res.prize}${i}`} style={{ position:"fixed", top:-20, left:`${Math.random() * 100}%`, fontSize: 14 + Math.random() * 14,
          animation:`bn-fall ${1.6 + Math.random() * 1.8}s ${Math.random() * 0.6}s ease-in forwards`, pointerEvents:"none", zIndex:4401 }}>
          {pick(big ? ["💰", "🔑", "✨", "💎", "🎉"] : ["🔑", "✨", "🎉"])}</span>
      ))}
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:360, position:"relative" }}>
        {/* la machine */}
        <div style={{ borderRadius:26, padding:"18px 18px 20px", position:"relative",
          background:"linear-gradient(180deg, #b91c1c, #7f1d1d)", border:"4px solid #f59e0b",
          boxShadow:"0 20px 60px rgba(0,0,0,.6), inset 0 2px 0 rgba(255,255,255,.25)" }}>
          {/* ampoules */}
          <div style={{ position:"absolute", inset:5, pointerEvents:"none" }}>
            {BULBS.map(([x, y], i) => (
              <span key={i} style={{ position:"absolute", width:7, height:7, borderRadius:"50%", background:"#fde047",
                left:`calc(${x}% - 3.5px)`, top:`calc(${y}% - 3.5px)`,
                animation:`bn-bulb ${phase === "spinning" ? 0.35 : big && phase === "done" ? 0.22 : 1.2}s ${i * (big && phase === "done" ? 0.03 : 0.07)}s infinite` }}/>
            ))}
          </div>
          <button onClick={() => setHelp(h => !h)} aria-label="Les lots de la roue" title="Les lots et leurs chances"
            style={{ position:"absolute", top:12, right:14, width:24, height:24, borderRadius:"50%", zIndex:2,
              border:"1.5px solid #fde047", background:"rgba(0,0,0,.25)", color:"#fde047", fontWeight:900, fontSize:13,
              cursor:"pointer" }}>{help ? "✕" : "?"}</button>
          {help && (
            <div style={{ position:"absolute", inset:"44px 12px 12px", zIndex:3, borderRadius:14, overflowY:"auto",
              background:"rgba(28,25,23,.97)", border:"1px solid rgba(253,224,71,.5)", padding:"10px 12px",
              color:"rgba(255,255,255,.9)", fontSize:12, lineHeight:1.45 }}>
              <div style={{ fontWeight:900, color:"#fde047", marginBottom:6 }}>Les lots, du plus courant au plus rare</div>
              {(wheel?.prizes || []).map(p => (
                <div key={p.id} style={{ display:"flex", gap:8, padding:"4px 0", borderTop:"1px solid rgba(255,255,255,.08)" }}>
                  <span style={{ width:22, textAlign:"center", fontSize:16 }}>{SYM[p.id] || "✖️"}</span>
                  <span style={{ flex:1, minWidth:0 }}>
                    <b>{p.label}</b>
                    <span style={{ display:"block", fontSize:11, color:"rgba(255,255,255,.65)" }}>{p.help}</span>
                  </span>
                  <span style={{ fontWeight:800, color:"#fde047", fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" }}>
                    {String(p.pct).replace(".", ",")} %</span>
                </div>
              ))}
              <div style={{ marginTop:6, fontSize:11, color:"rgba(255,255,255,.65)" }}>
                {wheel?.weekly || 3} tours offerts chaque lundi, 1 toutes les {wheel?.prints_per_spin || 8} impressions
                réussies et 1 par secret gagné ; un ticket de palier toutes les {wheel?.prints_per_ticket || 5} impressions
                réussies et tous les {wheel?.secrets_per_ticket || 5} secrets. Gagner des paliers ou un secret pendant un tour rapporte aussi
                ses clés, affichées en bonus.</div>
            </div>
          )}
          <div style={{ textAlign:"center", fontWeight:900, fontSize:20, color:"#fde047", letterSpacing:".04em",
            textShadow:"0 2px 0 #7c2d12, 0 0 12px rgba(253,224,71,.6)" }}>🎰 ROUE DE LA FORTUNE</div>
          <div style={{ textAlign:"center", fontSize:11.5, color:"rgba(255,255,255,.8)", marginTop:2 }}>
            {spins} tour{spins > 1 ? "s" : ""} · prochain lundi</div>
          {/* les rouleaux */}
          <div style={{ display:"flex", gap:8, margin:"14px 0 12px", padding:8, borderRadius:14,
            background:"#1c1917", boxShadow:"inset 0 4px 12px rgba(0,0,0,.8)" }}>
            {reels.map((s, i) => (
              <div key={i} style={{ flex:1, height:H, overflow:"hidden", borderRadius:10, position:"relative",
                background:"linear-gradient(180deg, #e7e5e4, #fff 40%, #fff 60%, #d6d3d1)" }}>
                <div onTransitionEnd={i === 2 ? () => finish.current?.() : undefined}
                  style={{ transform:`translateY(${go ? -(LEN - 1) * H : 0}px)`,
                  transition: go ? `transform ${1.6 + i * 0.6}s cubic-bezier(.12,.75,.22,1.03)` : "none" }}>
                  {s.map((x, j) => <div key={j} style={{ height:H, display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:40, filter: go && phase === "spinning" ? "blur(.6px)" : "none" }}>{x}</div>)}
                </div>
                {/* reflet */}
                <div style={{ position:"absolute", inset:0, pointerEvents:"none",
                  background:"linear-gradient(180deg, rgba(0,0,0,.25), transparent 30%, transparent 70%, rgba(0,0,0,.25))" }}/>
                {phase === "done" && win && <div style={{ position:"absolute", inset:0, borderRadius:10, boxShadow:"inset 0 0 0 3px #22c55e" }}/>}
              </div>
            ))}
          </div>
          {phase === "done" && big && <div aria-hidden="true" style={{ position:"absolute", inset:0, borderRadius:22,
            background:"radial-gradient(circle, #fff, #fde047 60%, transparent)", pointerEvents:"none", zIndex:1,
            animation:"bn-flash 1.4s ease-out 2" }}/>}
          {/* le resultat */}
          <div style={{ minHeight:46, textAlign:"center", display:"flex", flexDirection:"column", justifyContent:"center" }}>
            {phase === "done" && res && (
              <div style={{ animation: win ? "bn-win .6s ease-in-out 3" : "none" }}>
                <div style={{ fontSize: big ? 22 : 18, fontWeight:900, color: win ? "#fde047" : "rgba(255,255,255,.85)" }}>
                  {res.prize === "none" ? "Pas cette fois…" : res.prize === "replay" ? "🔁 Tour rejoué !"
                    : res.prize === "ticket" ? "🎟️ Ticket de palier !"
                    : res.prize === "hint" ? "🔍 Coup de pouce !" : `🎉 ${res.label} !`}</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,.75)", marginTop:2 }}>
                  {res.prize === "hint" && res.secret ? `${res.secret.step.charAt(0).toUpperCase() + res.secret.step.slice(1)} d'un secret, offert`
                    : res.keys ? `Tu as maintenant ${res.balance + (bonus || []).reduce((a, b) => a + b.n, 0)} clé${res.balance > 1 ? "s" : ""}`
                    : res.prize === "replay" ? "Le tour t'est rendu"
                    : res.prize === "ticket" ? "Ouvre un succès à paliers pour l'utiliser" : "Retente ta chance"}</div>
              </div>
            )}
            {phase === "done" && bonus?.length > 0 && (
              <div style={{ marginTop:6, padding:"6px 8px", borderRadius:10, background:"rgba(0,0,0,.25)", fontSize:11.5,
                color:"#fde68a", lineHeight:1.4 }}>
                🎁 Et +{bonus.reduce((a, b) => a + b.n, 0)} clé{bonus.reduce((a, b) => a + b.n, 0) > 1 ? "s" : ""} en bonus :
                {" "}{bonus.map(b => `${b.why} (+${b.n})`).join(", ")}</div>
            )}
            {phase === "spinning" && <div style={{ fontSize:14, fontWeight:800, color:"rgba(255,255,255,.85)" }}>Ça tourne…</div>}
            {err && <div style={{ fontSize:12.5, color:"#fecaca", fontWeight:700 }}>{err}</div>}
          </div>
          {/* la legende : trois pareils = */}
          <div style={{ display:"flex", flexWrap:"wrap", justifyContent:"center", gap:"2px 10px", marginTop:6,
            fontSize:10.5, color:"rgba(255,255,255,.75)" }}>
            <span style={{ fontWeight:700 }}>3 pareils :</span>
            {LEGEND.map(([e, l]) => <span key={e}>{e} {l}</span>)}
          </div>
          {/* le bouton */}
          <button onClick={spin} disabled={phase === "spinning" || spins <= 0}
            style={{ width:"100%", marginTop:8, padding:"12px 0", borderRadius:14, border:"none", cursor: spins > 0 && phase !== "spinning" ? "pointer" : "default",
              fontSize:16, fontWeight:900, letterSpacing:".05em", color:"#7c2d12",
              background: spins > 0 && phase !== "spinning" ? "linear-gradient(180deg, #fde047, #f59e0b)" : "#a8a29e",
              boxShadow: spins > 0 ? "0 4px 0 #b45309" : "none" }}>
            {phase === "spinning" ? "…" : spins > 0 ? "TOURNER" : "Plus de tour : rendez-vous lundi"}</button>
          {/* la fente a ticket : il en sort un quand on en gagne */}
          <div style={{ margin:"12px auto 0", width:150, position:"relative" }}>
            <div style={{ height:8, borderRadius:4, background:"#1c1917", boxShadow:"inset 0 2px 4px rgba(0,0,0,.9)",
              position:"relative", zIndex:2 }}/>
            <div style={{ textAlign:"center", fontSize:9, fontWeight:900, letterSpacing:".25em", color:"rgba(253,224,71,.7)",
              marginTop:2 }}>TICKET</div>
            {phase === "done" && res?.prize === "ticket" && (
              <div style={{ position:"absolute", top:4, left:0, right:0, display:"flex", justifyContent:"center", overflow:"hidden",
                height:52, zIndex:1 }}>
                <span style={{ animation:"bn-ticket-out .9s cubic-bezier(.2,.8,.3,1.1) forwards, bn-ticket-wiggle .6s .9s ease-in-out 2",
                  display:"inline-flex", marginTop:4 }}><TicketStub size={2}/></span>
              </div>
            )}
          </div>
          {/* le levier */}
          <div style={{ position:"absolute", right:-22, top:70, width:14, height:90, transformOrigin:"50% 100%",
            animation: phase === "spinning" ? "bn-lever .6s ease-out" : "none" }}>
            <div style={{ width:6, height:80, margin:"0 auto", borderRadius:3, background:"linear-gradient(90deg, #9ca3af, #e5e7eb, #9ca3af)" }}/>
            <div style={{ width:22, height:22, borderRadius:"50%", marginLeft:-4, marginTop:-96,
              background:"radial-gradient(circle at 35% 35%, #fca5a5, #dc2626)" }}/>
          </div>
        </div>
        <button onClick={onClose} disabled={phase === "spinning"} style={{ display:"block", margin:"12px auto 0", background:"none",
          border:"none", color:"rgba(255,255,255,.8)", fontSize:13, cursor:"pointer" }}>Fermer</button>
      </div>
    </div>, document.body
  );
}
