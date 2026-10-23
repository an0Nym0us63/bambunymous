import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Title, useWin, useLoop, Btn, rand, pick } from "./kit";

// Pages cachees, serie « fantaisie » (23/10/2026) : huit petits jouets droles.
// Chaque page appelle win() quand on est alle au bout de l'experience, jamais a l'arrivee.

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/* ------------------------------------------------------------------ */
/* Outils communs                                                      */
/* ------------------------------------------------------------------ */

function Hint({ children, style }) {
  return (
    <p style={{ margin:"12px auto 0", fontSize:13, opacity:.8, textAlign:"center", maxWidth:440, lineHeight:1.45,
      position:"relative", zIndex:2, ...style }}>{children}</p>
  );
}

/** Minuteries nettoyees au demontage. */
function useTimers() {
  const ids = useRef(new Set());
  useEffect(() => {
    const set = ids.current;
    return () => { set.forEach(clearTimeout); set.clear(); };
  }, []);
  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => { ids.current.delete(id); fn(); }, ms);
    ids.current.add(id);
    return id;
  }, []);
  const clearAll = useCallback(() => { ids.current.forEach(clearTimeout); ids.current.clear(); }, []);
  return { later, clearAll };
}

let audioCtx = null;
function getAudio() {
  try {
    if (!audioCtx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      audioCtx = new C();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  } catch (e) {
    return null;
  }
}

/** Bip simple, silencieux si l'audio est indisponible. */
function beep(freq, dur = 0.22, type = "sine", vol = 0.14, when = 0) {
  const ac = getAudio();
  if (!ac) return;
  try {
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t0 = ac.currentTime + when;
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  } catch (e) {
    /* audio indisponible */
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ */
/* 1. fortune : le biscuit de l'imprimante                            */
/* ------------------------------------------------------------------ */

const FORTUNES = [
  "Une première couche parfaite t'attend. Elle ne le sait pas encore, toi non plus.",
  "Tu trouveras bientôt l'amour… sous la forme d'un fil de PLA collé à ta manche.",
  "Ce que tu cherches est sous le plateau. Comme la vis M3 tombée mardi.",
  "Une impression de 14 heures réussira. La quinzième heure, en revanche…",
  "Un spaghetti géant croisera ton chemin. Ne le mange pas.",
  "Ta buse est plus sage que toi : elle sait quand se boucher.",
  "Un Benchy te sourira. C'est rare, profites-en.",
  "Le support que tu n'as pas mis te manquera cruellement vers 3 h du matin.",
  "Quelqu'un va te demander « tu peux m'imprimer un petit truc ? ». Fuis.",
  "La bobine que tu crois pleine ne l'est pas. Elle ne l'est jamais.",
  "Un grand voyage t'attend : du plateau à la poubelle, puis retour au slicer.",
  "Nettoie ton plateau à l'alcool : il t'offrira une adhérence divine.",
  "Ton prochain calibrage sera le bon. Comme les sept précédents.",
  "La patience est une vertu. Le temps estimé par le slicer, une œuvre de fiction.",
  "Une couleur de filament inconnue entrera dans ta vie. Tu l'achèteras en trois exemplaires.",
  "Le warping n'est qu'un coin de toi qui rêve de prendre son envol.",
  "Dans une vie antérieure, tu étais un cube de calibration de 20 mm. Tout s'explique.",
  "Méfie-toi du PETG qui sourit : il fait des fils en cachette.",
  "Ton AMS changera de couleur 412 fois pour une figurine de 3 cm. C'est ça, l'art.",
  "Le bonheur, c'est une rétraction bien réglée.",
  "Tu imprimeras un objet utile cette semaine : un support pour tes objets inutiles.",
  "Une alerte « filament épuisé » t'apprendra l'humilité. À 98 %.",
  "Le sage n'imprime pas à 500 mm/s. Le sage dort.",
  "Tes prochaines vis seront exactement de la bonne longueur. Non, on rigole.",
  "Ce biscuit a été cuit en couches de 0,2 mm. Toi aussi, tu as des couches.",
  "Ne laisse personne te dire que ta pièce a besoin d'un radeau.",
  "L'avenir appartient à ceux qui sèchent leur filament.",
  "Une petite lumière orange va s'allumer. Ce n'est pas grave. Probablement.",
  "La chance, c'est comme le remplissage : 15 % suffisent souvent.",
  "Tu croiseras quelqu'un qui imprime en résine. Reste poli·e, garde tes gants.",
  "Ton imprimante pense à toi pendant que tu dors. Elle fait d'ailleurs un bruit bizarre.",
  "Un jour, tu finiras ta bobine de PLA soie arc-en-ciel. Pas aujourd'hui.",
  "Sous un plateau rayé bat un cœur fidèle.",
  "Le pont de 80 mm que tu tentes ce soir tiendra. Dans tes rêves.",
];
const FT_GOAL = 3;
const FT_CSS = `
@keyframes ft-wobble { 0%,100% { transform:rotate(0) } 25% { transform:rotate(-4deg) } 75% { transform:rotate(4deg) } }
@keyframes ft-unroll { from { transform:scaleX(0); opacity:0 } to { transform:scaleX(1); opacity:1 } }
@keyframes ft-crumb { from { transform:translate(0,0); opacity:1 } to { transform:translate(var(--dx), 90px) rotate(200deg); opacity:0 } }
@keyframes ft-lantern { 0%,100% { transform:rotate(-3deg) } 50% { transform:rotate(3deg) } }
`;

function CookieHalf({ side, open }) {
  const left = side === "l";
  const d = left
    ? "M120 30 C 76 26, 34 58, 18 122 C 30 112, 44 106, 60 106 C 88 106, 106 112, 120 126 Z"
    : "M120 30 C 164 26, 206 58, 222 122 C 210 112, 196 106, 180 106 C 152 106, 134 112, 120 126 Z";
  const tr = open ? (left ? "translate(-58px, 34px) rotate(-22deg)" : "translate(58px, 34px) rotate(22deg)") : "none";
  return (
    <g style={{ transform:tr, transformOrigin:"120px 110px", transformBox:"view-box",
      transition:"transform .55s cubic-bezier(.2,1.3,.4,1)" }}>
      <path d={d} fill="url(#ft-dough)" stroke="#a16207" strokeWidth="2"/>
      <path d={left ? "M22 118 C 40 104, 90 102, 118 122" : "M218 118 C 200 104, 150 102, 122 122"} fill="none" stroke="#fde68a" strokeWidth="5" strokeLinecap="round" opacity=".7"/>
      <path d={left ? "M120 34 Q 108 80 120 124" : "M120 34 Q 132 80 120 124"} fill="none" stroke="#b45309" strokeWidth="3" opacity=".55"/>
      <path d={left ? "M46 78 Q 66 50 100 42" : "M194 78 Q 174 50 140 42"} fill="none" stroke="#fff7d6" strokeWidth="4" strokeLinecap="round" opacity=".55"/>
    </g>
  );
}

function Fortune() {
  const [won, win] = useWin("fortune");
  const deck = useRef(shuffle(FORTUNES));
  const [phase, setPhase] = useState("whole"); // whole | open
  const [count, setCount] = useState(0);
  const [text, setText] = useState("");
  const [lucky, setLucky] = useState([]);
  const [crumbs, setCrumbs] = useState([]);
  const { later } = useTimers();

  const crack = () => {
    if (phase !== "whole") return;
    beep(180, 0.06, "square", 0.08);
    beep(120, 0.08, "sawtooth", 0.06, 0.05);
    setText(deck.current[count % deck.current.length]);
    setLucky([pick(["0,2", "0,12", "0,28", "0,08"]), pick(["215", "220", "245", "260"]), pick(["60", "65", "80", "100"]), pick(["42", "7", "3", "13"])]);
    setCrumbs(Array.from({ length: 10 }, (_, i) => ({ id: Date.now() + i, x: rand(-30, 30), dx: rand(-80, 80) + "px", s: rand(4, 9) })));
    setPhase("open");
    const n = count + 1;
    setCount(n);
    if (n >= FT_GOAL) later(() => { beep(784, 0.15); beep(1175, 0.35, "sine", 0.14, 0.14); win(); }, 900);
  };
  const again = () => { setPhase("whole"); setText(""); setCrumbs([]); };

  return (
    <Stage won={won} wonText="Ton avenir est écrit (en G-code)" font={FONT}
      bg="radial-gradient(ellipse at 50% 30%, #7f1d1d 0%, #450a0a 55%, #1c0505 100%)">
      <style>{FT_CSS}</style>
      {[8, 86].map(l => (
        <div key={l} aria-hidden="true" style={{ position:"absolute", top:0, left:`${l}%`, display:"flex", flexDirection:"column",
          alignItems:"center", transformOrigin:"top center", animation:"ft-lantern 4s ease-in-out infinite", opacity:.85 }}>
          <div style={{ width:2, height:26, background:"#fbbf24" }}/>
          <div style={{ width:30, height:38, borderRadius:"45%", background:"radial-gradient(circle at 50% 40%, #fca5a5, #dc2626 60%, #7f1d1d)",
            boxShadow:"0 0 30px rgba(248,113,113,.6)", borderTop:"4px solid #fbbf24", borderBottom:"4px solid #fbbf24" }}/>
        </div>
      ))}
      <Title sub="Le biscuit chinois de l'atelier. Tape dessus pour lire ton avenir d'imprimeur." color="#fde68a">Le biscuit de la buse</Title>
      <div style={{ position:"relative", marginTop:24, width:"min(320px, 84vw)", height:200, zIndex:2 }}>
        <button onClick={crack} aria-label="Casser le biscuit" disabled={phase !== "whole"} data-cookie="1"
          style={{ position:"absolute", inset:0, background:"none", border:"none", padding:0, cursor: phase === "whole" ? "pointer" : "default",
            animation: phase === "whole" ? "ft-wobble 2.2s ease-in-out infinite" : "none" }}>
          <svg viewBox="0 0 240 170" width="100%" height="100%" style={{ overflow:"visible" }}>
            <defs>
              <radialGradient id="ft-dough" cx="45%" cy="35%" r="75%">
                <stop offset="0" stopColor="#fde68a"/><stop offset=".55" stopColor="#f59e0b"/><stop offset="1" stopColor="#b45309"/>
              </radialGradient>
            </defs>
            <ellipse cx="120" cy="150" rx="86" ry="10" fill="rgba(0,0,0,.35)"/>
            <CookieHalf side="l" open={phase === "open"}/>
            <CookieHalf side="r" open={phase === "open"}/>
          </svg>
        </button>
        {crumbs.map(c => (
          <span key={c.id} aria-hidden="true" style={{ position:"absolute", left:`calc(50% + ${c.x}px)`, top:90, width:c.s, height:c.s,
            borderRadius:2, background:"#d97706", "--dx":c.dx, animation:"ft-crumb .9s ease-in both", pointerEvents:"none" }}/>
        ))}
        {phase === "open" && (
          <div style={{ position:"absolute", left:"50%", top:62, width:"min(300px, 84vw)", marginLeft:"calc(min(300px, 84vw) / -2)",
            background:"linear-gradient(180deg, #fffdf5, #f5f0dc)", color:"#7f1d1d", borderRadius:3, padding:"12px 14px",
            boxShadow:"0 8px 22px rgba(0,0,0,.45)", fontFamily:"Georgia, serif", fontSize:15, lineHeight:1.4, textAlign:"center",
            transformOrigin:"center", animation:"ft-unroll .6s .25s cubic-bezier(.2,1.2,.4,1) both" }}>
            « {text} »
            <div style={{ marginTop:8, fontFamily:MONO, fontSize:11, color:"#991b1b", opacity:.8 }}>
              Numéros chanceux : {lucky.join(" · ")}
            </div>
          </div>
        )}
      </div>
      <div style={{ marginTop:phase === "open" ? 44 : 14, display:"flex", gap:10, alignItems:"center", zIndex:2, position:"relative" }}>
        {phase === "open"
          ? <Btn color="#b45309" onClick={again} data-again="1" style={{ minHeight:46 }}>🥠 Un autre biscuit</Btn>
          : <Btn color="#dc2626" onClick={crack} style={{ minHeight:46 }}>💥 Casser le biscuit</Btn>}
      </div>
      <div style={{ display:"flex", gap:8, marginTop:14, zIndex:2, position:"relative" }} aria-label={`${count} biscuits ouverts`}>
        {Array.from({ length: FT_GOAL }, (_, i) => (
          <span key={i} style={{ fontSize:22, filter: i < count ? "none" : "grayscale(1) opacity(.35)" }}>🥠</span>
        ))}
      </div>
      <Hint>{count < FT_GOAL ? "Un seul biscuit, c'est une anecdote. Trois, c'est une prophétie." : "La prophétie est complète. Il en reste plein le bocal, sers-toi."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 2. machine-a-cafe : la machine retro qui confond cafe et PLA       */
/* ------------------------------------------------------------------ */

const DRINKS = [
  { id: "expresso", label: "Expresso", color: "#3b1d0e", level: 0.4 },
  { id: "allonge", label: "Allongé", color: "#4a2512", level: 0.78 },
  { id: "noisette", label: "Noisette", color: "#6b3a1c", level: 0.55 },
  { id: "cappuccino", label: "Cappuccino", color: "#8b5a2b", level: 0.88 },
];
const MC_CSS = `
@keyframes mc-shake { 0%,100% { transform:translate(0,0) } 20% { transform:translate(-2px,1px) } 40% { transform:translate(2px,-1px) } 60% { transform:translate(-1px,-1px) } 80% { transform:translate(1px,1px) } }
@keyframes mc-steam { 0% { transform:translate(0,0) scale(.6); opacity:0 } 20% { opacity:.7 } 100% { transform:translate(var(--sx), -70px) scale(1.6); opacity:0 } }
@keyframes mc-blink { 50% { opacity:.25 } }
@keyframes mc-stream { from { background-position:0 0 } to { background-position:0 40px } }
`;

function McCup({ drink, fill, pla }) {
  const h = 60 * fill;
  const shape = "M12 14 L 72 14 L 66 70 Q 64 76 58 76 L 26 76 Q 20 76 18 70 Z";
  return (
    <svg viewBox="0 0 90 80" width="90" height="80" style={{ display:"block", overflow:"visible" }}>
      <path d="M68 28 q 18 2 16 18 q -2 14 -18 12" fill="none" stroke="#e5e7eb" strokeWidth="6"/>
      <clipPath id="mc-cup"><path d={shape}/></clipPath>
      <path d={shape} fill="#f8fafc"/>
      <g clipPath="url(#mc-cup)">
        {pla ? (
          Array.from({ length: Math.round(fill * 11) }, (_, i) => (
            <ellipse key={i} cx={42 + (i % 2 ? 4 : -4)} cy={72 - i * 5.5} rx={24 - (i % 3) * 3} ry="4" fill="none" stroke="#22c55e" strokeWidth="3"/>
          ))
        ) : (
          <>
            <rect x="0" y={76 - h} width="90" height={h + 2} fill={drink ? drink.color : "#3b1d0e"}/>
            {fill > 0.2 && <rect x="0" y={76 - h} width="90" height={drink && drink.id === "cappuccino" ? 9 : 4} fill="#d6a46a" opacity=".85"/>}
          </>
        )}
      </g>
      {pla && fill > 0.9 && <path d="M40 14 q 10 -16 -2 -22 q -14 -6 -6 -16" fill="none" stroke="#22c55e" strokeWidth="3"/>}
      <path d={shape} fill="none" stroke="#cbd5e1" strokeWidth="2"/>
    </svg>
  );
}

function MachineACafe() {
  const [won, win] = useWin("machine-a-cafe");
  const [drink, setDrink] = useState(null);
  const [sugar, setSugar] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | brewing | served
  const [step, setStep] = useState("");
  const [msg, setMsg] = useState("BONJOUR · CHOISIS TA BOISSON");
  const [err, setErr] = useState(0);
  const [fill, setFill] = useState(0);
  const [pla, setPla] = useState(false);
  const [served, setServed] = useState(0);
  const lastPla = useRef(false);
  const { later, clearAll } = useTimers();

  const say = (m, isErr = false) => {
    setMsg(m);
    setErr(e => (isErr ? Math.abs(e) + 1 : 0));
    if (isErr) beep(140, 0.25, "square", 0.08);
  };

  const chooseDrink = d => {
    if (phase === "brewing") return say("PATIENCE, JE CHAUFFE", true);
    if (phase === "served") return say("PRENDS D'ABORD TA TASSE", true);
    setDrink(d);
    setSugar(null);
    beep(660, 0.06, "square", 0.05);
    return say(`${d.label.toUpperCase()} · ET LE SUCRE ?`);
  };
  const chooseSugar = n => {
    if (phase !== "idle") return say(phase === "brewing" ? "TROP TARD POUR LE SUCRE" : "PRENDS D'ABORD TA TASSE", true);
    if (!drink) return say("LA BOISSON D'ABORD, LE SUCRE ENSUITE", true);
    setSugar(n);
    beep(880, 0.05, "square", 0.05);
    return say(`${drink.label.toUpperCase()} · ${n} SUCRE${n > 1 ? "S" : ""} · APPUIE SUR ▶`);
  };
  const brew = () => {
    if (phase === "brewing") return;
    if (phase === "served") { say("PRENDS D'ABORD TA TASSE", true); return; }
    if (!drink) { say("ERREUR 0xCAFE : CHOISIS UNE BOISSON", true); return; }
    if (sugar === null) { say("ET LE SUCRE ? 0, 1, 2 OU 3", true); return; }
    const willPla = lastPla.current ? false : (served === 0 ? Math.random() < 0.5 : Math.random() < 0.3);
    setPla(willPla);
    setPhase("brewing");
    setFill(0);
    say("MOUTURE…");
    setStep("grind");
    for (let i = 0; i < 14; i++) beep(rand(70, 120), 0.07, "sawtooth", 0.05, i * 0.09);
    later(() => { say("CHAUFFE DE LA BUSE À 92 °C…"); setStep("heat"); beep(1200, 0.08, "sine", 0.05); }, 1400);
    later(() => {
      say(willPla ? "EXTRUSION… EUH, EXTRACTION…" : "EXTRACTION…");
      setStep("pour");
      for (let i = 0; i < 10; i++) beep(rand(300, 420), 0.12, "triangle", 0.025, i * 0.22);
      const target = willPla ? 1 : drink.level;
      const t0 = performance.now();
      const tick = () => {
        const p = clamp((performance.now() - t0) / 2400, 0, 1);
        setFill(target * p);
        if (p < 1) later(tick, 60);
      };
      tick();
    }, 2600);
    later(() => {
      setStep("");
      setPhase("served");
      setServed(s => s + 1);
      lastPla.current = willPla;
      if (willPla) {
        say("OUPS · 3 M DE PLA VERT SERVIS", true);
      } else {
        say(`${drink.label.toUpperCase()} SERVI · BONNE JOURNÉE`);
        beep(988, 0.12, "sine", 0.1);
        beep(1319, 0.3, "sine", 0.1, 0.12);
        win();
      }
    }, 5300);
  };
  const take = () => {
    clearAll();
    setPhase("idle");
    setFill(0);
    setDrink(null);
    setSugar(null);
    setStep("");
    say(pla ? "DÉSOLÉE · ON RÉESSAIE ?" : "BONJOUR · CHOISIS TA BOISSON");
  };

  const pour = step === "pour";
  const steaming = step === "heat" || pour || (phase === "served" && !pla);
  return (
    <Stage won={won} wonText="Enfin un vrai café ☕" font={FONT}
      bg="repeating-linear-gradient(90deg, #f5e6c8 0 40px, #efdcb6 40px 80px)" color="#3b2412">
      <style>{MC_CSS}</style>
      <Title sub="Modèle 1974, firmware jamais mis à jour. Boisson, puis sucre, puis ▶." color="#7c2d12" style={{ textShadow:"none" }}>La machine à café</Title>
      <div style={{ marginTop:18, width:"min(330px, 84vw)", position:"relative", zIndex:2,
        animation: step === "grind" ? "mc-shake .12s linear infinite" : "none" }}>
        <div style={{ background:"linear-gradient(180deg, #dc2626, #991b1b)", borderRadius:"26px 26px 8px 8px", padding:"12px 14px 12px",
          boxShadow:"0 10px 30px rgba(0,0,0,.35), inset 0 2px 0 rgba(255,255,255,.3)" }}>
          <div style={{ fontFamily:"Georgia, serif", fontStyle:"italic", fontWeight:800, color:"#fef3c7", textAlign:"center", fontSize:18,
            letterSpacing:".04em" }}>Bambu-Presso</div>
          <div role="status" key={err} data-lcd="1" style={{ marginTop:8, background:"#14281a", color: err ? "#fca5a5" : "#86efac", fontFamily:MONO, fontSize:12,
            padding:"8px 10px", borderRadius:6, minHeight:34, display:"flex", alignItems:"center", justifyContent:"center", textAlign:"center",
            boxShadow:"inset 0 2px 6px rgba(0,0,0,.7)", textShadow:"0 0 6px currentColor",
            animation: err ? "mc-blink .3s steps(2) 3" : "none" }}>{msg}</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginTop:10 }}>
            {DRINKS.map(d => {
              const on = drink && drink.id === d.id;
              return (
                <button key={d.id} onClick={() => chooseDrink(d)} data-drink={d.id} style={{ padding:"9px 4px", borderRadius:8, fontWeight:800, fontSize:13,
                  border: on ? "2px solid #fde68a" : "2px solid transparent", cursor:"pointer",
                  background: on ? "#fde68a" : "#fff7ed", color:"#7c2d12",
                  boxShadow: on ? "inset 0 2px 4px rgba(0,0,0,.25)" : "0 3px 0 #7f1d1d" }}>☕ {d.label}</button>
              );
            })}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:10, justifyContent:"center" }}>
            <span style={{ color:"#fef3c7", fontSize:12, fontWeight:700, marginRight:2 }}>Sucre</span>
            {[0, 1, 2, 3].map(n => (
              <button key={n} onClick={() => chooseSugar(n)} aria-label={`${n} sucre`} data-sugar={n} style={{ width:36, height:34, borderRadius:7, cursor:"pointer",
                fontWeight:800, border:"none", background: sugar === n ? "#fde68a" : "#fff", color:"#7c2d12",
                boxShadow: sugar === n ? "inset 0 2px 4px rgba(0,0,0,.3)" : "0 3px 0 #7f1d1d" }}>{n}</button>
            ))}
            <button onClick={brew} aria-label="Servir" data-brew="1" style={{ marginLeft:8, width:48, height:48, borderRadius:"50%", border:"3px solid #fef3c7",
              background:"radial-gradient(circle at 40% 35%, #4ade80, #15803d)", color:"#fff", fontSize:18, cursor:"pointer",
              boxShadow:"0 4px 0 #14532d" }}>▶</button>
          </div>
        </div>
        <div style={{ position:"relative", height:170, background:"linear-gradient(180deg, #1f2937, #111827)", margin:"0 10px",
          boxShadow:"inset 0 8px 18px rgba(0,0,0,.7)", overflow:"hidden" }}>
          <div style={{ position:"absolute", left:"50%", top:0, width:34, height:20, marginLeft:-17, background:"linear-gradient(90deg, #9ca3af, #e5e7eb, #9ca3af)",
            borderRadius:"0 0 6px 6px" }}/>
          <div style={{ position:"absolute", left:"50%", top:20, width:0, height:0, marginLeft:-7, borderLeft:"7px solid transparent",
            borderRight:"7px solid transparent", borderTop:"10px solid #9ca3af" }}/>
          {pour && (
            <div style={{ position:"absolute", left:"50%", top:30, width: pla ? 4 : 6, marginLeft: pla ? -2 : -3, height:90,
              background: pla ? "repeating-linear-gradient(180deg, #22c55e 0 6px, #16a34a 6px 12px)" : `repeating-linear-gradient(180deg, ${drink ? drink.color : "#3b1d0e"} 0 8px, #6b3a1c 8px 12px)`,
              backgroundSize:"100% 40px", animation:"mc-stream .25s linear infinite", borderRadius:3,
              transform: pla ? "rotate(4deg)" : "none" }}/>
          )}
          {phase !== "idle" ? (
            <div style={{ position:"absolute", left:"50%", bottom:10, marginLeft:-45 }}>
              <McCup drink={drink} fill={fill} pla={pla}/>
            </div>
          ) : (
            <div style={{ position:"absolute", left:0, right:0, bottom:40, textAlign:"center", color:"#6b7280", fontSize:12 }}>
              (un gobelet tombera ici, en principe)
            </div>
          )}
          {steaming && [0, 1, 2].map(i => (
            <span key={i} aria-hidden="true" style={{ position:"absolute", left:`calc(50% + ${i * 10 - 14}px)`, bottom:80, width:18, height:18,
              borderRadius:"50%", background:"rgba(255,255,255,.55)", filter:"blur(5px)", "--sx": `${(i - 1) * 14}px`,
              animation:`mc-steam 1.8s ease-out ${i * 0.5}s infinite` }}/>
          ))}
          <div style={{ position:"absolute", left:0, right:0, bottom:0, height:10, background:"repeating-linear-gradient(90deg, #6b7280 0 6px, #374151 6px 10px)" }}/>
        </div>
        <div style={{ height:22, background:"linear-gradient(180deg, #991b1b, #7f1d1d)", borderRadius:"0 0 12px 12px" }}/>
      </div>
      <div style={{ marginTop:12, minHeight:46, zIndex:2, position:"relative" }}>
        {phase === "served" && (
          <Btn color={pla ? "#16a34a" : "#7c2d12"} onClick={take} data-take="1" style={{ minHeight:46 }}>
            {pla ? "🧵 Récupérer le filament" : "☕ Prendre ma tasse"}
          </Btn>
        )}
      </div>
      <Hint style={{ marginTop:4 }}>{pla && phase === "served"
        ? "La machine a confondu sa buse avec celle de ton imprimante. Ça arrive aux meilleures."
        : "Choisis ta boisson, ton sucre, puis le bouton vert. Dans cet ordre : elle est susceptible."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 3. chien : le chien low-poly qui reclame des caresses              */
/* ------------------------------------------------------------------ */

const DOG_CSS = `
@keyframes dog-wag { 0%,100% { transform:rotate(-14deg) } 50% { transform:rotate(22deg) } }
@keyframes dog-heart { from { transform:translateY(0) scale(.6); opacity:1 } to { transform:translateY(-90px) scale(1.2); opacity:0 } }
@keyframes dog-ball { 0% { transform:translate(0,0) } 50% { transform:translate(-45vw,-130px) } 100% { transform:translate(-95vw, -10px) } }
@keyframes dog-bob { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-6px) } }
`;
const DOG_MOODS = [
  [0, "Il te fixe avec des yeux de buse mouillée."],
  [0.25, "La queue commence à bouger. Doucement…"],
  [0.5, "Il se tortille de joie. Continue !"],
  [0.75, "Il pense que tu es la meilleure personne du monde (il a raison)."],
  [1, "Bonheur à 100 %. Remplissage complet."],
];

function DogSvg({ happy, petting, holding, wagSpeed }) {
  const A = "#f59e0b", B = "#d97706", C = "#b45309", D = "#fbbf24", E = "#92400e";
  const st = "rgba(60,30,0,.25)";
  return (
    <svg viewBox="0 0 300 250" width="100%" height="100%" style={{ overflow:"visible" }}>
      <ellipse cx="160" cy="232" rx="105" ry="10" fill="rgba(0,0,0,.2)"/>
      <g style={{ transformOrigin:"222px 130px", transformBox:"view-box", animation:`dog-wag ${wagSpeed}s ease-in-out infinite` }}>
        <polygon points="218,128 252,92 262,98 230,138" fill={B} stroke={st}/>
        <polygon points="252,92 270,78 262,98" fill={D} stroke={st}/>
      </g>
      <polygon points="196,170 214,168 218,226 202,226" fill={C} stroke={st}/>
      <polygon points="212,170 228,170 232,226 218,226" fill={B} stroke={st}/>
      <polygon points="200,220 220,220 222,230 198,230" fill={E}/>
      <polygon points="216,220 234,220 236,230 214,230" fill={E}/>
      <polygon points="110,118 212,112 162,150" fill={D} stroke={st}/>
      <polygon points="212,112 228,176 162,150" fill={A} stroke={st}/>
      <polygon points="228,176 114,182 162,150" fill={B} stroke={st}/>
      <polygon points="114,182 110,118 162,150" fill={A} stroke={st}/>
      <polygon points="118,174 134,176 132,226 118,226" fill={A} stroke={st}/>
      <polygon points="138,178 152,178 150,226 138,226" fill={B} stroke={st}/>
      <polygon points="114,220 134,220 136,230 112,230" fill={E}/>
      <polygon points="134,220 152,220 154,230 132,230" fill={E}/>
      <polygon points="96,98 124,94 130,130 104,128" fill={A} stroke={st}/>
      <polygon points="98,114 128,110 130,120 100,124" fill="#dc2626"/>
      <circle cx="114" cy="128" r="7" fill="#e5e7eb" stroke="#9ca3af"/>
      <text x="114" y="130" textAnchor="middle" fontSize="5" fontWeight="900" fill="#374151" fontFamily="system-ui">PLA</text>
      <g style={{ transformOrigin:"100px 100px", transformBox:"view-box", transform: petting ? "rotate(-8deg)" : "none", transition:"transform .3s" }}>
        <polygon points="60,66 104,52 92,90" fill={D} stroke={st}/>
        <polygon points="104,52 120,94 92,90" fill={A} stroke={st}/>
        <polygon points="60,66 92,90 52,100" fill={A} stroke={st}/>
        <polygon points="52,100 92,90 86,112" fill={B} stroke={st}/>
        <polygon points="92,90 120,94 86,112" fill={C} stroke={st}/>
        <polygon points="52,90 26,94 30,108 56,112" fill={D} stroke={st}/>
        <polygon points="30,108 56,112 50,118" fill={B} stroke={st}/>
        <polygon points="22,92 32,90 31,100 23,100" fill="#1f2937"/>
        {happy && !holding && <polygon points="38,110 48,111 46,126 40,124" fill="#f472b6" stroke="#db2777" strokeWidth=".8"/>}
        <polygon points="86,56 108,40 112,82" fill={E} stroke={st}
          style={{ transformOrigin:"100px 60px", transformBox:"view-box", transform: petting ? "rotate(18deg)" : "none", transition:"transform .25s" }}/>
        {petting || happy
          ? <path d="M70 80 q 6 -7 12 0" fill="none" stroke="#1f2937" strokeWidth="3" strokeLinecap="round"/>
          : <><circle cx="76" cy="79" r="5" fill="#1f2937"/><circle cx="74.5" cy="77.5" r="1.6" fill="#fff"/></>}
        {holding && <circle cx="34" cy="114" r="9" fill="#bef264" stroke="#65a30d" strokeWidth="2"/>}
      </g>
    </svg>
  );
}

function Chien() {
  const [won, win] = useWin("chien");
  const [joy, setJoy] = useState(0.1);
  const [petting, setPetting] = useState(false);
  const [hearts, setHearts] = useState([]);
  const [ball, setBall] = useState("none"); // none | fly | fetch | back
  const [bark, setBark] = useState("");
  const pet = useRef({ on: false, x: 0, y: 0, moved: 0, lastMove: 0 });
  const lastHeart = useRef(0);
  const done = useRef(false);
  const { later } = useTimers();

  useLoop((dt, now) => {
    if (done.current) return;
    const p = pet.current;
    const active = p.on && now - p.lastMove < 250;
    setPetting(active);
    const moved = p.moved;
    p.moved = 0;
    setJoy(j => {
      let n = j + moved * 0.0007;
      if (!active && ball === "none") n -= dt * 0.012;
      return clamp(n, 0, 1);
    });
    if (active && now - lastHeart.current > 260) {
      lastHeart.current = now;
      setHearts(h => [...h.filter(x => now - x.born < 1300), { id: now, born: now, x: rand(20, 60), s: rand(16, 26) }]);
    } else if (hearts.length && now - hearts[0].born > 1300) {
      setHearts(h => h.filter(x => now - x.born < 1300));
    }
  });

  useEffect(() => {
    if (joy >= 1 && !done.current) {
      done.current = true;
      setPetting(false);
      setBark("OUAF ! OUAF !");
      beep(330, 0.12, "square", 0.08);
      beep(300, 0.14, "square", 0.08, 0.2);
      win();
    }
  }, [joy, win]);

  const down = e => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* sans capture */ }
    pet.current.on = true;
    pet.current.x = e.clientX;
    pet.current.y = e.clientY;
  };
  const move = e => {
    const p = pet.current;
    if (!p.on) return;
    const d = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    p.x = e.clientX;
    p.y = e.clientY;
    if (d > 1 && ball === "none") { p.moved += Math.min(d, 60); p.lastMove = performance.now(); }
  };
  const up = () => { pet.current.on = false; };

  const throwBall = () => {
    if (ball !== "none") return;
    setBall("fly");
    setBark("");
    beep(500, 0.06, "triangle", 0.06);
    later(() => setBall("fetch"), 500);
    later(() => setBall("back"), 1700);
    later(() => {
      setBall("none");
      setJoy(j => clamp(j + 0.22, 0, 1));
      setBark(pick(["Ouaf !", "Encore !", "Wouf wouf !", "Re-lance !"]));
      beep(330, 0.1, "square", 0.07);
      later(() => setBark(b => (b === "OUAF ! OUAF !" ? b : "")), 1400);
    }, 2900);
  };

  const mood = DOG_MOODS.filter(m => joy >= m[0]).pop()[1];
  const wagSpeed = clamp(1.2 - joy * 1.0, 0.18, 1.2);
  return (
    <Stage won={won} wonText="Le chien t'adore 🐕" font={FONT}
      bg="linear-gradient(180deg, #7dd3fc 0%, #bae6fd 58%, #86efac 58%, #4ade80 100%)" color="#0f172a">
      <style>{DOG_CSS}</style>
      <Title sub="Imprimé en low-poly, 400 faces, zéro support. Il réclame des caresses." color="#0c4a6e" style={{ textShadow:"none" }}>Le chien</Title>
      <div style={{ marginTop:12, width:"min(300px, 82vw)", zIndex:2, position:"relative" }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, fontWeight:800, color:"#0c4a6e" }}>
          <span>🦴 Bonheur</span><span>{Math.round(joy * 100)} %</span>
        </div>
        <div style={{ height:14, borderRadius:8, background:"rgba(255,255,255,.6)", overflow:"hidden", marginTop:4,
          boxShadow:"inset 0 1px 3px rgba(0,0,0,.2)" }}>
          <div style={{ width:`${joy * 100}%`, height:"100%", background:"linear-gradient(90deg, #f472b6, #ef4444)", transition:"width .15s" }}/>
        </div>
      </div>
      <div style={{ position:"relative", width:"min(330px, 84vw)", height:250, marginTop:8, zIndex:2 }}>
        <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
          data-dog="1" style={{ position:"absolute", inset:0, cursor:"grab", touchAction:"none",
            transform:`translateX(${ball === "fetch" ? "-120vw" : "0px"})`, transition:"transform 1.1s ease-in-out" }}>
          <div style={{ width:"100%", height:"100%", animation: ball === "back" || ball === "fetch" ? "dog-bob .25s ease-in-out infinite" : "none" }}>
            <DogSvg happy={won || joy > 0.75} petting={petting} holding={ball === "back"} wagSpeed={wagSpeed}/>
          </div>
        </div>
        {hearts.map(h => (
          <span key={h.id} aria-hidden="true" style={{ position:"absolute", left:`${h.x}%`, top:30, fontSize:h.s, pointerEvents:"none",
            animation:"dog-heart 1.3s ease-out both" }}>❤️</span>
        ))}
        {bark && (
          <div style={{ position:"absolute", left:"2%", top:-4, background:"#fff", borderRadius:14, padding:"6px 12px", fontWeight:900,
            fontSize:15, boxShadow:"0 4px 12px rgba(0,0,0,.2)", color:"#b45309" }}>{bark}</div>
        )}
        {ball === "fly" && (
          <span aria-hidden="true" style={{ position:"absolute", right:6, bottom:30, width:20, height:20, borderRadius:"50%",
            background:"#bef264", border:"2px solid #65a30d", animation:"dog-ball .6s ease-out forwards" }}/>
        )}
      </div>
      <Btn color="#16a34a" onClick={throwBall} disabled={ball !== "none"} data-ball="1" style={{ minHeight:46, zIndex:2, position:"relative",
        opacity: ball !== "none" ? .6 : 1 }}>🎾 Lancer la balle</Btn>
      <Hint style={{ color:"#052e16", opacity:1, fontWeight:600 }}>{won ? "Il ne te lâchera plus. Tu viens d'adopter un chien en PLA." : mood}</Hint>
      <Hint style={{ marginTop:2, fontSize:12, color:"#052e16" }}>Caresse-le en glissant le doigt (ou la souris) sur lui.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 4. plante : la plante dans son pot imprime                         */
/* ------------------------------------------------------------------ */

const PL_STAGES = ["Une graine (et beaucoup d'espoir)", "Une pousse !", "Deux feuilles", "Une vraie tige", "Un bouton…", "En fleur !"];
const PL_CSS = `
@keyframes pl-drop { from { transform:translateY(-40px); opacity:1 } to { transform:translateY(70px); opacity:0 } }
@keyframes pl-sway { 0%,100% { transform:rotate(-2deg) } 50% { transform:rotate(2deg) } }
@keyframes pl-bloom { from { transform:scale(0) rotate(-90deg) } to { transform:scale(1) rotate(0) } }
`;

function PlantSvg({ stage, droop }) {
  const stemH = [0, 26, 46, 74, 96, 104][stage];
  const top = 150 - stemH;
  const tipX = 100 + droop * 16;
  const leaf = (y, side, s = 1) => (
    <path key={`${y}${side}`} d={side < 0 ? `M100 ${y} q -22 -16 -40 -4 q 18 14 40 4 Z` : `M100 ${y} q 22 -16 40 -4 q -18 14 -40 4 Z`}
      fill="#22c55e" stroke="#15803d" strokeWidth="1.5"
      style={{ transformOrigin:`100px ${y}px`, transformBox:"view-box", transform:`scale(${s}) rotate(${droop * side * -25}deg)`, transition:"transform .6s" }}/>
  );
  return (
    <svg viewBox="0 0 200 160" width="100%" height="100%" style={{ overflow:"visible" }}>
      <g style={{ transformOrigin:"100px 150px", transformBox:"view-box", animation:"pl-sway 4s ease-in-out infinite" }}>
        {stage === 0 && <ellipse cx="100" cy="148" rx="7" ry="5" fill="#a16207"/>}
        {stage >= 1 && <path d={`M100 150 Q ${97 + droop * 4} ${150 - stemH / 2} ${tipX} ${top}`} fill="none" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"/>}
        {stage === 1 && <>{leaf(top + 2, -1, 0.45)}{leaf(top + 2, 1, 0.45)}</>}
        {stage >= 2 && <>{leaf(150 - 34, -1, 0.9)}{leaf(150 - 34, 1, 0.9)}</>}
        {stage >= 3 && <>{leaf(150 - 62, 1, 0.8)}{leaf(150 - 70, -1, 0.7)}</>}
        {stage === 4 && <ellipse cx={tipX} cy={top - 6} rx="8" ry="11" fill="#f472b6" stroke="#be185d"/>}
        {stage >= 5 && (
          <g style={{ transformOrigin:`${tipX}px ${top - 10}px`, transformBox:"view-box", animation:"pl-bloom .9s cubic-bezier(.2,1.4,.4,1) both" }}>
            {Array.from({ length: 8 }, (_, i) => (
              <ellipse key={i} cx={tipX} cy={top - 24} rx="8" ry="14" fill={i % 2 ? "#f9a8d4" : "#ec4899"} stroke="#be185d" strokeWidth="1"
                transform={`rotate(${i * 45} ${tipX} ${top - 10})`}/>
            ))}
            <circle cx={tipX} cy={top - 10} r="9" fill="#facc15" stroke="#ca8a04" strokeWidth="2"/>
          </g>
        )}
      </g>
    </svg>
  );
}

function Plante() {
  const [won, win] = useWin("plante");
  const [s, setS] = useState({ water: 40, growth: 0, stage: 0 });
  const [light, setLight] = useState(false);
  const [drops, setDrops] = useState([]);
  const lightRef = useRef(false);
  lightRef.current = light;
  const done = useRef(false);

  // horloge a 10 Hz (pas besoin de 60 images/s pour faire pousser une plante)
  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1, (now - last) / 1000);
      last = now;
      if (!done.current) tick(dt);
    }, 100);
    return () => clearInterval(id);
  }, []);
  const tick = dt => {
    setS(prev => {
      const l = lightRef.current;
      const water = Math.max(0, prev.water - dt * (l ? 3.2 : 1.4));
      const ok = l && water >= 25 && water <= 80;
      let growth = prev.growth + (ok ? dt * 0.2 : 0);
      let stage = prev.stage;
      if (growth >= 1 && stage < 5) { stage += 1; growth = 0; }
      if (stage >= 5) growth = 1;
      return { water, growth, stage };
    });
  };

  useEffect(() => {
    if (s.stage >= 5 && !done.current) {
      done.current = true;
      [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.3, "sine", 0.1, i * 0.12));
      win();
    } else if (s.stage > 0 && !done.current) {
      beep(600 + s.stage * 90, 0.15, "triangle", 0.07);
    }
  }, [s.stage, win]);

  const water = () => {
    const now = Date.now();
    setDrops(d => [...d.filter(x => now - x.born < 1200), ...Array.from({ length: 6 }, (_, i) => ({ id: `${now}-${i}`, born: now, x: rand(-26, 26), delay: rand(0, 0.25) }))]);
    setS(p => ({ ...p, water: Math.min(110, p.water + 20) }));
    beep(rand(900, 1300), 0.08, "sine", 0.05);
  };
  const toggleLight = () => { setLight(l => !l); beep(light ? 300 : 500, 0.05, "square", 0.05); };

  const drowned = s.water > 85, dry = s.water < 25;
  const droop = s.stage >= 5 ? 0 : drowned ? 0.8 : dry ? 1 : 0;
  let status;
  if (s.stage >= 5) status = "Elle a fleuri ! Mille couches de patience.";
  else if (drowned) status = "Trop d'eau ! Elle fait la planche. Attends que la terre sèche.";
  else if (dry) status = "Elle a soif. Un petit coup d'arrosoir ?";
  else if (!light) status = "Il fait tout noir. Elle attend la lumière, comme une résine UV.";
  else status = "Elle pousse. Ne la regarde pas trop, ça la gêne.";

  const gauge = (label, v, color, lo, hi) => (
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ fontSize:11, fontWeight:800, marginBottom:3 }}>{label}</div>
      <div style={{ position:"relative", height:12, borderRadius:7, background:"rgba(255,255,255,.18)", overflow:"hidden" }}>
        {lo != null && <div style={{ position:"absolute", left:`${lo}%`, width:`${hi - lo}%`, top:0, bottom:0, background:"rgba(134,239,172,.3)" }}/>}
        <div style={{ position:"relative", width:`${clamp(v, 0, 100)}%`, height:"100%", background:color, transition:"width .2s" }}/>
      </div>
    </div>
  );

  return (
    <Stage won={won} wonText="Elle a fleuri 🌸" font={FONT}
      bg={light ? "linear-gradient(180deg, #1e3a5f 0%, #2d4a6b 62%, #5b3a1e 62%, #3b2412 100%)" : "linear-gradient(180deg, #0b1220 0%, #111827 62%, #2a1a0c 62%, #1c1208 100%)"}
      style={{ transition:"background .6s" }}>
      <style>{PL_CSS}</style>
      <Title sub="Une graine dans un pot en PLA terracotta, trois parois. Fais-la fleurir." color="#bbf7d0">La plante</Title>
      <div style={{ position:"relative", width:"min(320px, 84vw)", height:270, marginTop:14, zIndex:2 }}>
        <div aria-hidden="true" style={{ position:"absolute", right:4, top:0, width:70, height:60 }}>
          <div style={{ position:"absolute", right:30, top:-30, width:4, height:44, background:"#9a3412" }}/>
          <div style={{ position:"absolute", right:8, top:4, width:46, height:28, borderRadius:"24px 24px 4px 4px",
            background:"linear-gradient(180deg, #f97316, #c2410c)", transform:"rotate(-24deg)" }}/>
          <div style={{ position:"absolute", right:18, top:24, width:20, height:10, borderRadius:"0 0 10px 10px",
            background: light ? "#fef08a" : "#4b5563", boxShadow: light ? "0 0 26px 10px rgba(254,240,138,.7)" : "none", transform:"rotate(-24deg)" }}/>
        </div>
        {light && <div aria-hidden="true" style={{ position:"absolute", right:30, top:30, width:220, height:200, pointerEvents:"none",
          background:"linear-gradient(225deg, rgba(254,240,138,.45), rgba(254,240,138,0) 70%)", clipPath:"polygon(90% 0, 100% 8%, 30% 100%, 0 70%)" }}/>}
        <div style={{ position:"absolute", left:"50%", bottom:100, width:200, height:160, marginLeft:-100 }}>
          <PlantSvg stage={s.stage} droop={droop}/>
        </div>
        {drops.map(d => (
          <span key={d.id} aria-hidden="true" style={{ position:"absolute", left:`calc(50% + ${d.x}px)`, top:70, fontSize:16,
            animation:`pl-drop .8s ease-in ${d.delay}s both`, pointerEvents:"none" }}>💧</span>
        ))}
        <div style={{ position:"absolute", left:"50%", bottom:4, width:150, marginLeft:-75 }}>
          <div style={{ height:16, borderRadius:4, background: drowned ? "#1e3a5f" : dry ? "#a47148" : "#5b3a1e",
            margin:"0 -6px", boxShadow:"inset 0 4px 6px rgba(0,0,0,.4)", border:"4px solid #ea580c", transition:"background .5s" }}/>
          <div style={{ height:84, clipPath:"polygon(0 0, 100% 0, 88% 100%, 12% 100%)",
            background:"repeating-linear-gradient(180deg, #ea580c 0 3px, #c2410c 3px 4px)", position:"relative" }}>
            <div style={{ position:"absolute", left:0, right:0, top:30, textAlign:"center", fontFamily:MONO, fontSize:10, fontWeight:900,
              color:"rgba(255,255,255,.75)" }}>PLA · 0,2 mm</div>
          </div>
        </div>
      </div>
      <div style={{ display:"flex", gap:12, width:"min(320px, 84vw)", marginTop:8, zIndex:2, position:"relative" }}>
        {gauge("💧 Humidité", s.water, drowned ? "#60a5fa" : dry ? "#f59e0b" : "#38bdf8", 25, 80)}
        {gauge(`🌱 Stade ${s.stage}/5`, s.stage >= 5 ? 100 : (s.stage + s.growth) * 20, "#4ade80")}
      </div>
      <div style={{ fontSize:13, fontWeight:800, marginTop:8, color:"#bbf7d0", zIndex:2, position:"relative" }}>{PL_STAGES[s.stage]}</div>
      <div style={{ display:"flex", gap:10, marginTop:10, zIndex:2, position:"relative", flexWrap:"wrap", justifyContent:"center" }}>
        <Btn color="#0284c7" onClick={water} data-water="1" style={{ minHeight:46 }}>🚿 Arroser</Btn>
        <Btn color={light ? "#ca8a04" : "#475569"} onClick={toggleLight} data-light="1" style={{ minHeight:46 }}>{light ? "💡 Lampe allumée" : "🌑 Allumer la lampe"}</Btn>
      </div>
      <Hint style={{ color:"#e2e8f0" }}>{status}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 5. photomaton : quatre poses, une bande                            */
/* ------------------------------------------------------------------ */

const PH_FACES = ["😀", "😏", "🤨", "😮", "😺", "🐶", "🐸", "🤖", "👽", "🐵"];
const PH_HEADS = [
  { id: "none", label: "Rien" },
  { id: "hat", label: "🎩 Haut-de-forme" },
  { id: "crown", label: "👑 Couronne" },
  { id: "nozzle", label: "🔩 Buse" },
  { id: "welder", label: "🥽 Casque de soudeur" },
];
const PH_EXTRAS = [
  { id: "glasses", label: "👓 Lunettes" },
  { id: "moustache", label: "🥸 Moustache" },
  { id: "bow", label: "🎀 Nœud pap'" },
];
const PH_FILTERS = ["none", "sepia(.9)", "grayscale(1) contrast(1.2)", "hue-rotate(160deg) saturate(1.4)", "saturate(1.8)"];
const PH_CSS = `
@keyframes ph-flash { from { opacity:1 } to { opacity:0 } }
@keyframes ph-out { from { transform:translateY(-100%) } to { transform:translateY(0) } }
@keyframes ph-count { from { transform:scale(1.6); opacity:0 } 30% { opacity:1 } to { transform:scale(1); opacity:1 } }
`;

/** Un visage emoji et ses accessoires, dans un carre de 200 unites. */
function PhFace({ look, size = 200 }) {
  const { face, head, extras = [], tilt = 0 } = look;
  const has = id => extras.includes(id);
  const masked = head === "welder";
  return (
    <div style={{ position:"relative", width:size, height:size, transform:`rotate(${tilt}deg)`, transition:"transform .3s", flex:"none" }}>
      <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:size * 0.62, lineHeight:1, fontFamily:"'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif" }}>{face}</div>
      <svg viewBox="0 0 200 200" width={size} height={size} style={{ position:"absolute", inset:0, overflow:"visible" }}>
        {has("glasses") && !masked && (
          <g fill="rgba(56,189,248,.18)" stroke="#111827" strokeWidth="5">
            <circle cx="78" cy="90" r="17"/><circle cx="122" cy="90" r="17"/>
            <path d="M95 88 q 5 -6 10 0" fill="none"/><path d="M61 87 L 46 82 M139 87 L 154 82" fill="none"/>
          </g>
        )}
        {has("moustache") && !masked && (
          <path d="M100 124 c -8 -10 -24 -10 -32 -2 c -6 6 -14 6 -18 0 c 4 14 22 18 34 10 c 8 -4 12 -6 16 -8 c 4 2 8 4 16 8 c 12 8 30 4 34 -10 c -4 6 -12 6 -18 0 c -8 -8 -24 -8 -32 2 Z"
            fill="#3f2a14" stroke="#1c1208" strokeWidth="2"/>
        )}
        {has("bow") && (
          <g transform="translate(100 176)">
            <path d="M0 0 L -26 -12 L -26 12 Z M0 0 L 26 -12 L 26 12 Z" fill="#dc2626" stroke="#7f1d1d" strokeWidth="2"/>
            <circle r="6" fill="#b91c1c"/>
          </g>
        )}
        {head === "hat" && (
          <g>
            <rect x="66" y="0" width="68" height="46" rx="4" fill="#111827"/>
            <rect x="66" y="32" width="68" height="10" fill="#f97316"/>
            <ellipse cx="100" cy="46" rx="56" ry="9" fill="#111827"/>
          </g>
        )}
        {head === "crown" && (
          <path d="M60 48 L 64 12 L 81 32 L 100 6 L 119 32 L 136 12 L 140 48 Z" fill="#facc15" stroke="#a16207" strokeWidth="3"/>
        )}
        {head === "nozzle" && (
          <g>
            <rect x="72" y="-6" width="56" height="30" rx="4" fill="#9ca3af" stroke="#4b5563" strokeWidth="2"/>
            {[0, 6, 12, 18].map(y => <line key={y} x1="72" x2="128" y1={y} y2={y} stroke="#6b7280" strokeWidth="2"/>)}
            <rect x="84" y="24" width="32" height="10" fill="#d97706"/>
            <path d="M88 34 L 112 34 L 104 46 L 96 46 Z" fill="#f59e0b" stroke="#92400e" strokeWidth="2"/>
          </g>
        )}
        {masked && (
          <g>
            <path d="M36 62 Q 36 14 100 14 Q 164 14 164 62 L 160 152 Q 100 180 40 152 Z" fill="#374151" stroke="#111827" strokeWidth="4"/>
            <rect x="60" y="72" width="80" height="30" rx="5" fill="#14532d" stroke="#111827" strokeWidth="4"/>
            <rect x="66" y="76" width="22" height="6" rx="3" fill="rgba(255,255,255,.25)"/>
            <circle cx="40" cy="80" r="7" fill="#6b7280"/><circle cx="160" cy="80" r="7" fill="#6b7280"/>
            <text x="100" y="140" textAnchor="middle" fontSize="13" fontWeight="900" fill="#9ca3af" fontFamily="system-ui">GK</text>
          </g>
        )}
      </svg>
    </div>
  );
}

function Photomaton() {
  const [won, win] = useWin("photomaton");
  const [face, setFace] = useState("😀");
  const [head, setHead] = useState("none");
  const [extras, setExtras] = useState(["glasses"]);
  const [phase, setPhase] = useState("setup"); // setup | shooting | develop | strip
  const [count, setCount] = useState(0);
  const [shots, setShots] = useState([]);
  const [flash, setFlash] = useState(0);
  const [pose, setPose] = useState({ tilt: 0 });
  const { later, clearAll } = useTimers();

  const toggle = id => setExtras(x => (x.includes(id) ? x.filter(e => e !== id) : [...x, id]));

  const shoot = () => {
    if (phase !== "setup") return;
    setPhase("shooting");
    setShots([]);
    let t = 300;
    const taken = [];
    for (let k = 0; k < 4; k++) {
      [3, 2, 1].forEach(n => {
        later(() => { setCount(n); beep(n === 1 ? 880 : 660, 0.08, "square", 0.05); }, t);
        t += 450;
      });
      const p = { tilt: k === 0 ? 0 : rand(-14, 14), filter: k === 0 ? "none" : pick(PH_FILTERS), deco: k === 0 ? "" : pick(["✌️", "💥", "⭐", "🧵", ""]) };
      later(() => {
        setCount(0);
        setFlash(f => Math.abs(f) + 1);
        later(() => setFlash(f => -Math.abs(f)), 450);
        beep(2000, 0.04, "square", 0.06);
        beep(300, 0.1, "sawtooth", 0.04, 0.04);
        setPose(p);
        taken.push({ face, head, extras, ...p });
        setShots([...taken]);
      }, t);
      t += 550;
    }
    later(() => { setPhase("develop"); setPose({ tilt: 0 }); }, t + 200);
    later(() => setPhase("strip"), t + 1800);
    later(() => { beep(784, 0.12); beep(1047, 0.3, "sine", 0.12, 0.12); win(); }, t + 1800 + 1700);
  };
  const reset = () => { clearAll(); setPhase("setup"); setShots([]); setCount(0); setPose({ tilt: 0 }); };

  const live = { face, head, extras, tilt: pose.tilt };
  const chip = (on, onClick, label, key) => (
    <button key={key} onClick={onClick} style={{ padding:"7px 10px", borderRadius:999, fontSize:13, fontWeight:700,
      cursor:"pointer", border: on ? "2px solid #fbbf24" : "2px solid rgba(255,255,255,.18)", background: on ? "rgba(251,191,36,.2)" : "rgba(255,255,255,.06)",
      color:"#fff" }}>{label}</button>
  );
  const today = new Date().toLocaleDateString("fr-FR");
  return (
    <Stage won={won} wonText="Bande tirée, quelle allure 📸" font={FONT}
      bg="radial-gradient(ellipse at 50% 20%, #312e81 0%, #1e1b4b 50%, #0b0a1f 100%)" style={{ justifyContent:"flex-start" }}>
      <style>{PH_CSS}</style>
      <Title sub="Quatre poses pour 2 € (payables en chutes de filament)." color="#fde68a">Photomaton</Title>
      <div style={{ marginTop:14, width:"min(300px, 84vw)", background:"linear-gradient(180deg, #e5e7eb, #9ca3af)", borderRadius:16, padding:10,
        boxShadow:"0 14px 30px rgba(0,0,0,.5)", position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 6px 8px", color:"#1f2937" }}>
          <span style={{ fontWeight:900, letterSpacing:".12em", fontSize:12 }}>PHOTO · AUTO</span>
          <span style={{ width:26, height:26, borderRadius:"50%", background:"radial-gradient(circle at 40% 35%, #60a5fa, #1e3a8a 55%, #020617)",
            border:"3px solid #374151" }}/>
          <span style={{ width:10, height:10, borderRadius:"50%", background: phase === "shooting" ? "#ef4444" : "#4b5563",
            boxShadow: phase === "shooting" ? "0 0 10px #ef4444" : "none" }}/>
        </div>
        <div style={{ position:"relative", height:220, borderRadius:10, overflow:"hidden",
          background:"linear-gradient(180deg, #0f766e, #134e4a)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ position:"absolute", left:0, top:0, bottom:0, width:26, background:"repeating-linear-gradient(90deg, #b91c1c 0 8px, #7f1d1d 8px 12px)" }}/>
          <PhFace look={live} size={180}/>
          {pose.deco && phase === "shooting" && <span style={{ position:"absolute", right:20, bottom:16, fontSize:34 }}>{pose.deco}</span>}
          {count > 0 && <span key={`${count}-${shots.length}`} style={{ position:"absolute", top:8, right:14, fontSize:40, fontWeight:900, color:"#fde68a",
            textShadow:"0 2px 10px rgba(0,0,0,.6)", animation:"ph-count .45s ease-out both" }}>{count}</span>}
          {phase === "shooting" && <span style={{ position:"absolute", left:34, top:8, fontSize:12, fontWeight:800, color:"#ccfbf1" }}>Photo {Math.min(shots.length + 1, 4)}/4</span>}
          {phase === "develop" && <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.6)", display:"flex", alignItems:"center",
            justifyContent:"center", fontWeight:800, color:"#fde68a" }}>Développement… 🧪</div>}
          {flash > 0 && <div key={flash} style={{ position:"absolute", inset:0, background:"#fff", animation:"ph-flash .45s ease-out both", pointerEvents:"none" }}/>}
        </div>
        <div style={{ margin:"10px auto 0", width:124, height:8, borderRadius:4, background:"#111827", boxShadow:"inset 0 2px 3px #000" }}/>
      </div>
      {phase === "strip" && (
        <div style={{ overflow:"hidden", marginTop:-6, zIndex:1, position:"relative", paddingBottom:16 }}>
          <div style={{ width:112, background:"#fafaf9", padding:"8px 8px 6px", boxShadow:"0 8px 16px rgba(0,0,0,.5)",
            animation:"ph-out 1.6s cubic-bezier(.3,.8,.4,1) both" }} data-strip="1">
            {shots.map((p, i) => (
              <div key={i} style={{ height:92, marginBottom:6, background:"linear-gradient(180deg, #0f766e, #134e4a)", overflow:"hidden",
                display:"flex", alignItems:"center", justifyContent:"center", filter:p.filter, position:"relative" }}>
                <PhFace look={p} size={84}/>
                {p.deco && <span style={{ position:"absolute", right:3, bottom:2, fontSize:16 }}>{p.deco}</span>}
              </div>
            ))}
            <div style={{ fontFamily:MONO, fontSize:9, color:"#57534e", textAlign:"center" }}>BambuNymous · {today}</div>
          </div>
        </div>
      )}
      {phase === "setup" && (
        <div style={{ width:"min(360px, 84vw)", marginTop:14, zIndex:2, position:"relative" }}>
          <div style={{ fontSize:12, fontWeight:800, opacity:.8, marginBottom:6 }}>Visage</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {PH_FACES.map(f => (
              <button key={f} onClick={() => setFace(f)} style={{ width:40, height:40, borderRadius:10, fontSize:24, cursor:"pointer", padding:0,
                border: f === face ? "2px solid #fbbf24" : "2px solid transparent", background:"rgba(255,255,255,.08)" }}>{f}</button>
            ))}
          </div>
          <div style={{ fontSize:12, fontWeight:800, opacity:.8, margin:"12px 0 6px" }}>Sur la tête</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{PH_HEADS.map(h => chip(head === h.id, () => setHead(h.id), h.label, h.id))}</div>
          <div style={{ fontSize:12, fontWeight:800, opacity:.8, margin:"12px 0 6px" }}>Accessoires</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{PH_EXTRAS.map(x => chip(extras.includes(x.id), () => toggle(x.id), x.label, x.id))}</div>
        </div>
      )}
      <div style={{ marginTop:14, zIndex:2, position:"relative" }}>
        {phase === "setup" && <Btn color="#e11d48" onClick={shoot} data-shoot="1" style={{ minHeight:48, fontSize:16 }}>📸 Prendre les 4 photos</Btn>}
        {phase === "strip" && <Btn color="#4f46e5" onClick={reset} style={{ minHeight:46 }}>🔁 Une autre bande</Btn>}
      </div>
      <Hint style={{ marginBottom: won ? 60 : 0 }}>{phase === "shooting" ? "Souris ! Ou pas. Le photomaton ne juge pas." : phase === "strip" ? "Ta bande sort, encore tiède. À coller sur ton imprimante." : "Habille ton visage, puis prends la pose. Le flash est garanti, le talent non."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 6. horoscope : l'horoscope des makers                              */
/* ------------------------------------------------------------------ */

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const SIGNS = [
  { e: "🧵", n: "Capricorne de la bobine", t: "Tenace, tu enroules les problèmes jusqu'à en faire une bobine bien rangée." },
  { e: "🌀", n: "Verseau du ventilateur", t: "Tu refroidis toutes les situations. Parfois trop : demande au PETG." },
  { e: "🐟", n: "Poissons du PETG", t: "Sensible, collant, tu laisses des fils partout où tu passes. On t'aime quand même." },
  { e: "🐏", n: "Bélier de la buse", t: "Tu fonces tête la première, en 0,4 mm. Rien ne t'arrête, sauf un bouchon." },
  { e: "🐂", n: "Taureau du plateau", t: "Stable, plat, solide. Tout le monde s'appuie sur toi, surtout les premières couches." },
  { e: "👯", n: "Gémeaux de l'AMS", t: "Quatre couleurs dans la tête, et tu changes d'avis toutes les dix couches." },
  { e: "🦀", n: "Cancer du warping", t: "Tu te recroquevilles dès qu'il fait un peu frais. Un caisson te ferait du bien." },
  { e: "🦁", n: "Lion du lit chauffant", t: "Chaleureux, rayonnant, à 60 °C en permanence. On vient se coller à toi." },
  { e: "✨", n: "Vierge de la première couche", t: "Perfectionniste : tu recommences tant que ce n'est pas lisse comme un miroir." },
  { e: "⚖️", n: "Balance du nivelage", t: "Tu cherches l'équilibre en 49 points. Tu le trouves, puis quelqu'un cogne la table." },
  { e: "🦂", n: "Scorpion du stringing", t: "Mystérieux, tu laisses de fins fils d'araignée derrière toi. Personne ne sait comment." },
  { e: "🏹", n: "Sagittaire du support", t: "Généreux, tu soutiens tout le monde, même ceux qui n'en ont pas besoin. Surtout eux." },
];
const HS_LOVE = [
  "Une rencontre près de la poubelle à chutes. Ne la jette pas tout de suite.",
  "Quelqu'un admire ton Benchy en secret. Ose le lui offrir.",
  "Ton cœur balance entre le PLA et le PETG. Les deux sont de bons partis.",
  "Évite les déclarations à 3 h du matin pendant une impression : la buse est jalouse.",
  "On va te demander d'imprimer un cadeau. C'est ça, l'amour (non rémunéré).",
  "Vénus traverse ton plateau : nettoie-le, au cas où.",
  "Ta moitié trouve que l'imprimante prend trop de place. Elle n'a pas tort, ne le dis pas.",
  "Le grand frisson du jour : décoller une pièce d'un plateau flexible. Savoure.",
];
const HS_WORK = [
  "Une impression longue réussira, à condition de ne pas la regarder toutes les cinq minutes.",
  "Mercure est rétrograde : ta rétraction aussi. Vérifie tes réglages.",
  "Jour idéal pour calibrer. Ou pour faire semblant et lancer quand même.",
  "Une pièce sortira parfaite du premier coup. Tu ne sauras jamais pourquoi.",
  "Le slicer annonce 2 h. Les astres annoncent 3 h 40.",
  "Un support récalcitrant te résistera. La pince coupante est ton alliée.",
  "Tu trouveras enfin la bonne température pour ce filament mystère sans étiquette.",
  "Ne lance rien de plus grand que ton avant-bras avant midi.",
];
const HS_HEALTH = [
  "Tes ventilateurs vont bien, ton dos un peu moins : redresse-toi.",
  "Bois de l'eau. Ton filament, lui, doit rester sec.",
  "Une pause entre deux impressions recharge tes batteries (pas celles de l'imprimante).",
  "Lave-toi les mains après l'alcool isopropylique, ça pique les yeux.",
  "Ta buse a besoin d'une purge. Toi aussi : range l'établi.",
  "Évite de respirer au-dessus de l'ABS. Ouvre la fenêtre, les astres insistent.",
];
const HS_COLORS = ["PLA rouge pompier", "PETG bleu lagon", "PLA soie or", "TPU noir mat", "PLA vert Benchy", "ASA blanc lunaire", "PLA bois de chêne", "PLA arc-en-ciel"];

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seeded(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Le meme texte toute la journee pour un signe donne. */
function horoscopeFor(i, d) {
  const r = seeded(hashStr(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${i}`));
  const p = arr => arr[Math.floor(r() * arr.length)];
  const stars = () => 1 + Math.floor(r() * 5);
  let compat = Math.floor(r() * 12);
  if (compat === i) compat = (compat + 5) % 12;
  return {
    love: p(HS_LOVE), work: p(HS_WORK), health: p(HS_HEALTH), color: p(HS_COLORS),
    temp: 190 + Math.floor(r() * 14) * 5, compat, sLove: stars(), sWork: stars(), sHealth: stars(),
  };
}

function Horoscope() {
  const [won, win] = useWin("horoscope");
  const [mine, setMine] = useState(null);
  const [cur, setCur] = useState(null);
  const [read, setRead] = useState([]);
  const card = useRef(null);
  const today = useMemo(() => new Date(), []);
  const { later } = useTimers();

  const open = i => {
    if (mine === null) setMine(i);
    setCur(i);
    beep(1046 + i * 20, 0.12, "sine", 0.06);
    setRead(r => (r.includes(i) ? r : [...r, i]));
    later(() => { try { card.current && card.current.scrollIntoView({ behavior:"smooth", block:"nearest" }); } catch (e) { /* rien */ } }, 60);
  };
  useEffect(() => {
    if (read.length >= 2) {
      const t = setTimeout(() => { beep(784, 0.15); beep(1175, 0.3, "sine", 0.12, 0.14); win(); }, 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [read.length, win]);

  const h = cur !== null ? horoscopeFor(cur, today) : null;
  const dateTxt = today.toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
  const stars = n => "★".repeat(n) + "☆".repeat(5 - n);
  const sect = (ic, title, n, txt) => (
    <div style={{ marginTop:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontWeight:800, fontSize:13 }}>
        <span>{ic} {title}</span><span style={{ color:"#fbbf24", letterSpacing:1 }}>{stars(n)}</span>
      </div>
      <div style={{ fontSize:14, lineHeight:1.45, marginTop:3, opacity:.92 }}>{txt}</div>
    </div>
  );
  return (
    <Stage won={won} wonText="Les astres sont alignés ✨" font={FONT}
      bg="radial-gradient(ellipse at 50% 0%, #4c1d95 0%, #2e1065 45%, #0c0420 100%)" style={{ justifyContent:"flex-start" }}>
      <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none", opacity:.7,
        background:"radial-gradient(1px 1px at 10% 20%, #fff, transparent), radial-gradient(1px 1px at 70% 10%, #fff, transparent), radial-gradient(1.5px 1.5px at 40% 60%, #fff, transparent), radial-gradient(1px 1px at 85% 45%, #fff, transparent), radial-gradient(1px 1px at 25% 85%, #fff, transparent), radial-gradient(1.5px 1.5px at 60% 90%, #fff, transparent)" }}/>
      <Title sub={`L'horoscope des makers · ${dateTxt}`} color="#e9d5ff">Horoscope</Title>
      <p style={{ margin:"10px 0 0", fontSize:14, fontWeight:700, textAlign:"center", zIndex:2, position:"relative" }}>
        {mine === null ? "Quel est ton mois de naissance ?" : "Et les autres, que leur réservent les astres ?"}
      </p>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(92px, 1fr))", gap:6, width:"min(440px, 84vw)", marginTop:10,
        zIndex:2, position:"relative" }}>
        {SIGNS.map((s, i) => (
          <button key={i} onClick={() => open(i)} data-sign={i} style={{ padding:"8px 4px", borderRadius:10, cursor:"pointer", color:"#fff",
            border: cur === i ? "2px solid #fbbf24" : "2px solid rgba(255,255,255,.12)",
            background: cur === i ? "rgba(251,191,36,.18)" : read.includes(i) ? "rgba(167,139,250,.22)" : "rgba(255,255,255,.06)",
            position:"relative" }}>
            <div style={{ fontSize:20 }}>{s.e}</div>
            <div style={{ fontSize:12, fontWeight:800 }}>{MONTHS[i]}</div>
            {mine === i && <span style={{ position:"absolute", top:3, right:5, fontSize:9, fontWeight:900, color:"#fbbf24" }}>TOI</span>}
          </button>
        ))}
      </div>
      {h && (
        <div ref={card} key={cur} style={{ width:"min(440px, 84vw)", marginTop:14, padding:"14px 16px", borderRadius:16, zIndex:2, position:"relative",
          background:"linear-gradient(160deg, rgba(76,29,149,.85), rgba(30,27,75,.92))", border:"1px solid rgba(233,213,255,.25)",
          boxShadow:"0 12px 30px rgba(0,0,0,.4)", animation:"hk-fade .4s ease-out both", boxSizing:"border-box" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:34 }}>{SIGNS[cur].e}</span>
            <div>
              <div style={{ fontWeight:900, fontSize:17, color:"#fde68a" }}>{SIGNS[cur].n}</div>
              <div style={{ fontSize:12, opacity:.75 }}>Mois de {MONTHS[cur].toLowerCase()}{mine === cur ? " · c'est toi !" : ""}</div>
            </div>
          </div>
          <div style={{ fontSize:13, fontStyle:"italic", marginTop:8, opacity:.85 }}>{SIGNS[cur].t}</div>
          {sect("💘", "Amour", h.sLove, h.love)}
          {sect("🖨️", "Impressions", h.sWork, h.work)}
          {sect("🩺", "Santé", h.sHealth, h.health)}
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:12, fontSize:12 }}>
            <span style={{ padding:"4px 8px", borderRadius:8, background:"rgba(255,255,255,.1)" }}>🎨 {h.color}</span>
            <span style={{ padding:"4px 8px", borderRadius:8, background:"rgba(255,255,255,.1)" }}>🌡️ Buse à {h.temp} °C</span>
            <span style={{ padding:"4px 8px", borderRadius:8, background:"rgba(255,255,255,.1)" }}>💞 {SIGNS[h.compat].n}</span>
          </div>
        </div>
      )}
      <Hint style={{ marginBottom: won ? 60 : 0 }}>{read.length === 0 ? "Promis, c'est scientifique. Autant qu'un temps estimé par le slicer." : read.length === 1 ? "Maintenant, espionne le signe de quelqu'un d'autre." : "Tu connais l'avenir de deux signes. Le reste dépend de ta buse."}</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 7. dessin : l'ardoise magique qui slice                            */
/* ------------------------------------------------------------------ */

const DS_COLORS = [
  { c: "#ef4444", n: "PLA rouge" }, { c: "#f97316", n: "PLA orange" }, { c: "#facc15", n: "PLA jaune" },
  { c: "#22c55e", n: "PLA vert" }, { c: "#3b82f6", n: "PETG bleu" }, { c: "#a855f7", n: "PLA violet" },
  { c: "#d4af37", n: "PLA soie or" }, { c: "#111827", n: "PLA noir" }, { c: "#f8fafc", n: "PLA blanc" },
];
const DS_LAYER = 6;
const DS_MIN = 140;
const DS_CSS = `@keyframes ds-shake { 0%,100% { transform:translateX(0) } 25% { transform:translateX(-10px) rotate(-1deg) } 75% { transform:translateX(10px) rotate(1deg) } }`;

function Dessin() {
  const [won, win] = useWin("dessin");
  const wrap = useRef(null);
  const cv = useRef(null);
  const ov = useRef(null);
  const [color, setColor] = useState(DS_COLORS[0]);
  const [ink, setInk] = useState(0);
  const [slicing, setSlicing] = useState(null); // null | { layer, layers }
  const [result, setResult] = useState(null);
  const [shake, setShake] = useState(0);
  const draw = useRef({ on: false, x: 0, y: 0 });
  const box = useRef({ minY: 1e9, maxY: -1, used: new Set() });
  const size = useRef({ w: 300, h: 234, dpr: 1 });
  const sl = useRef(null);
  const inkRef = useRef(0);
  inkRef.current = ink;

  useEffect(() => {
    const w = Math.min(340, wrap.current ? wrap.current.clientWidth - 28 : 300);
    const h = Math.round(w * 0.78);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    size.current = { w, h, dpr };
    [cv.current, ov.current].forEach(c => {
      if (!c) return;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.width = w + "px"; c.style.height = h + "px";
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }, []);

  const pos = e => {
    const r = cv.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const down = e => {
    if (slicing) return;
    if (result) {
      // un nouveau trait efface le resultat du slice, pas le dessin
      setResult(null);
    }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* sans capture */ }
    const [x, y] = pos(e);
    draw.current = { on: true, x, y };
    const g = cv.current.getContext("2d");
    g.fillStyle = color.c;
    g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
    box.current.minY = Math.min(box.current.minY, y - 4); box.current.maxY = Math.max(box.current.maxY, y + 4);
    box.current.used.add(color.n);
  };
  const move = e => {
    const d = draw.current;
    if (!d.on || slicing) return;
    const [x, y] = pos(e);
    const g = cv.current.getContext("2d");
    g.strokeStyle = color.c; g.lineWidth = 7; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(x, y); g.stroke();
    const len = Math.hypot(x - d.x, y - d.y);
    d.x = x; d.y = y;
    box.current.minY = Math.min(box.current.minY, y - 4); box.current.maxY = Math.max(box.current.maxY, y + 4);
    setInk(i => i + len);
  };
  const up = () => { draw.current.on = false; };

  const clear = () => {
    if (slicing) return;
    const { w, h } = size.current;
    cv.current.getContext("2d").clearRect(0, 0, w, h);
    ov.current.getContext("2d").clearRect(0, 0, w, h);
    box.current = { minY: 1e9, maxY: -1, used: new Set() };
    setInk(0); setResult(null); setShake(s => s + 1);
    beep(200, 0.15, "sawtooth", 0.04);
  };

  const slice = () => {
    if (slicing || ink < DS_MIN) return;
    const { h } = size.current;
    const top = clamp(Math.floor(box.current.minY / DS_LAYER) * DS_LAYER, 0, h);
    const bot = clamp(Math.ceil(box.current.maxY / DS_LAYER) * DS_LAYER, 0, h);
    const layers = Math.max(1, Math.round((bot - top) / DS_LAYER));
    sl.current = { t0: performance.now(), dur: clamp(layers * 110, 2200, 5200), bot, layers, lastLayer: -1 };
    setResult(null);
    setSlicing({ layer: 0, layers });
  };

  useLoop(() => {
    const s = sl.current;
    if (!s) return;
    const { w, h, dpr } = size.current;
    const p = clamp((performance.now() - s.t0) / s.dur, 0, 1);
    const g = ov.current.getContext("2d");
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 1;
    for (let x = 10; x < w; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 10; y < h; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const done = p * s.layers;
    const full = Math.floor(done);
    const frac = done - full;
    for (let i = 0; i <= Math.min(full, s.layers - 1); i++) {
      const y = s.bot - (i + 1) * DS_LAYER;
      const partial = i >= full;
      const cw = partial ? w * frac : w;
      if (cw <= 0) continue;
      const x0 = partial && i % 2 ? w - cw : 0; // une couche sur deux, la buse revient
      const off = i % 2 ? 0.7 : -0.7;
      g.drawImage(cv.current, x0 * dpr, y * dpr, cw * dpr, DS_LAYER * dpr, x0 + off, y, cw, DS_LAYER);
      g.fillStyle = "rgba(0,0,0,.3)";
      g.fillRect(x0, y + DS_LAYER - 1, cw, 1);
    }
    if (p < 1) {
      const layer = Math.min(full, s.layers - 1);
      const ny = s.bot - (layer + 1) * DS_LAYER;
      const nx = layer % 2 ? w - frac * w : frac * w;
      g.save();
      g.translate(nx, ny);
      g.fillStyle = "#9ca3af"; g.fillRect(-12, -30, 24, 16);
      g.fillStyle = "#f59e0b"; g.beginPath(); g.moveTo(-7, -14); g.lineTo(7, -14); g.lineTo(2, -2); g.lineTo(-2, -2); g.closePath(); g.fill();
      g.fillStyle = "rgba(251,191,36,.7)"; g.beginPath(); g.arc(0, 1, 3, 0, Math.PI * 2); g.fill();
      g.restore();
      if (layer !== s.lastLayer) { s.lastLayer = layer; setSlicing({ layer: layer + 1, layers: s.layers }); beep(300 + (layer % 6) * 40, 0.04, "square", 0.025); }
    } else {
      sl.current = null;
      const used = box.current.used.size || 1;
      const inkLen = inkRef.current;
      setSlicing(null);
      setResult({ layers: s.layers, min: Math.max(1, Math.round(inkLen / 60)), grams: (inkLen / 180).toFixed(1).replace(".", ","),
        swaps: (used - 1) * s.layers, used });
      beep(784, 0.12); beep(1047, 0.3, "sine", 0.12, 0.12);
      win();
    }
  });

  const showOv = !!slicing || !!result;
  return (
    <Stage won={won} wonText="Dessin slicé, prêt à imprimer 🖍️" font={FONT}
      bg="linear-gradient(160deg, #0f172a 0%, #1e293b 100%)" style={{ justifyContent:"flex-start" }}>
      <style>{DS_CSS}</style>
      <Title sub="Dessine au doigt avec tes filaments, puis envoie au slicer." color="#fca5a5">L'ardoise magique</Title>
      <div ref={wrap} style={{ marginTop:14, width:"min(370px, 84vw)", display:"flex", justifyContent:"center", zIndex:2, position:"relative" }}>
        <div key={shake} style={{ padding:14, borderRadius:20, background:"linear-gradient(180deg, #dc2626, #991b1b)",
          boxShadow:"0 14px 30px rgba(0,0,0,.5), inset 0 2px 0 rgba(255,255,255,.3)", animation: shake ? "ds-shake .35s ease-in-out 2" : "none" }}>
          <div style={{ position:"relative", borderRadius:8, overflow:"hidden", background: showOv ? "#1f2937" : "#d6d3d1",
            boxShadow:"inset 0 3px 8px rgba(0,0,0,.4)", transition:"background .4s" }}>
            <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
              data-slate="1" style={{ display:"block", touchAction:"none", cursor:"crosshair", opacity: showOv ? 0 : 1 }}/>
            <canvas ref={ov} style={{ position:"absolute", left:0, top:0, pointerEvents:"none", opacity: showOv ? 1 : 0 }}/>
            {slicing && <div style={{ position:"absolute", left:8, top:6, fontFamily:MONO, fontSize:11, color:"#a7f3d0" }}>
              Couche {slicing.layer}/{slicing.layers} · 0,2 mm</div>}
            {result && <div style={{ position:"absolute", left:8, top:6, fontFamily:MONO, fontSize:11, color:"#a7f3d0" }}>Aperçu du tranchage</div>}
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
            <span style={{ width:22, height:22, borderRadius:"50%", background:"radial-gradient(circle at 40% 35%, #f5f5f4, #a8a29e)" }}/>
            <span style={{ color:"#fef2f2", fontWeight:900, fontStyle:"italic", fontSize:13, letterSpacing:".06em" }}>Ardoise · Slicer</span>
            <span style={{ width:22, height:22, borderRadius:"50%", background:"radial-gradient(circle at 40% 35%, #f5f5f4, #a8a29e)" }}/>
          </div>
        </div>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center", marginTop:12, width:"min(370px, 84vw)", zIndex:2, position:"relative" }}>
        {DS_COLORS.map(c => (
          <button key={c.c} onClick={() => setColor(c)} aria-label={c.n} title={c.n} style={{ width:30, height:30, borderRadius:"50%", padding:0,
            background:c.c, cursor:"pointer", border: color.c === c.c ? "3px solid #fff" : "3px solid rgba(255,255,255,.15)",
            boxShadow: color.c === c.c ? "0 0 0 2px #fca5a5" : "none" }}/>
        ))}
      </div>
      <div style={{ fontSize:12, opacity:.8, marginTop:6, zIndex:2, position:"relative" }}>Filament : {color.n}</div>
      <div style={{ display:"flex", gap:10, marginTop:10, zIndex:2, position:"relative" }}>
        <Btn color="#475569" onClick={clear} disabled={!!slicing} style={{ minHeight:46 }}>🧽 Secouer</Btn>
        <Btn color="#16a34a" onClick={slice} disabled={!!slicing || ink < DS_MIN} data-slice="1"
          style={{ minHeight:46, opacity: slicing || ink < DS_MIN ? .5 : 1 }}>🔪 Slicer</Btn>
      </div>
      {result ? (
        <div style={{ marginTop:12, fontFamily:MONO, fontSize:12, textAlign:"center", lineHeight:1.6, zIndex:2, position:"relative",
          background:"rgba(0,0,0,.3)", padding:"8px 12px", borderRadius:10, marginBottom: won ? 60 : 0 }}>
          {result.layers} couches · {result.min} min (estimées, donc {result.min * 2 + 7} en vrai)<br/>
          {result.grams} g de filament{result.used > 1 ? ` · ${result.swaps} changements de couleur 🙃` : ""}
        </div>
      ) : (
        <Hint>{ink < DS_MIN ? "Dessine quelque chose : un Benchy, un chat, un gribouillis assumé." : "Beau travail. Le slicer t'attend."}</Hint>
      )}
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 8. boite-a-musique : la manivelle et la ballerine-bobine           */
/* ------------------------------------------------------------------ */

// Melodie originale, petite valse en do : numeros MIDI, 0 = silence
const MB_TUNE = [
  76, 79, 84, 83, 79, 76, 77, 81, 86, 84, 81, 77,
  76, 79, 84, 86, 84, 83, 81, 83, 79, 84, 0, 0,
  79, 76, 79, 81, 77, 81, 83, 79, 83, 84, 88, 86,
  84, 83, 81, 79, 77, 74, 76, 74, 72, 72, 0, 0,
];
const MB_STEP = (36 * Math.PI) / 180;
const MB_CSS = `
@keyframes mb-note { from { transform:translate(0,0) rotate(0); opacity:1 } to { transform:translate(var(--nx), -90px) rotate(25deg); opacity:0 } }
@keyframes mb-bow { 0%,100% { transform:rotate(0) } 50% { transform:rotate(18deg) } }
`;

function musicNote(midi) {
  const ac = getAudio();
  if (!ac || !midi) return;
  try {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const t0 = ac.currentTime;
    const out = ac.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(0.16, t0 + 0.005);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    out.connect(ac.destination);
    [[1, 1], [3.01, 0.25], [5.2, 0.08]].forEach(([m, v]) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = f * m;
      g.gain.value = v;
      o.connect(g); g.connect(out);
      o.start(t0); o.stop(t0 + 1.5);
    });
  } catch (e) {
    /* audio indisponible */
  }
}

function BoiteAMusique() {
  const [won, win] = useWin("boite-a-musique");
  const [angle, setAngle] = useState(-Math.PI / 2);
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState([]);
  const [spin, setSpin] = useState(0);
  const crank = useRef(null);
  const drag = useRef({ on: false, a: 0 });
  const acc = useRef(0);
  const stepRef = useRef(0);
  const finished = step >= MB_TUNE.length;

  const centerAngle = e => {
    const r = crank.current.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  const down = e => {
    if (finished) return;
    getAudio(); // l'audio ne demarre qu'apres ce geste
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* sans capture */ }
    drag.current = { on: true, a: centerAngle(e) };
  };
  const move = e => {
    const d = drag.current;
    if (!d.on || stepRef.current >= MB_TUNE.length) return;
    const a = centerAngle(e);
    let da = a - d.a;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    d.a = a;
    if (da <= 0) return; // la manivelle ne tourne que dans le sens horaire
    da = Math.min(da, 0.6);
    acc.current += da;
    setAngle(x => x + da);
    setSpin(x => x + da * 2.2);
    while (acc.current >= MB_STEP && stepRef.current < MB_TUNE.length) {
      acc.current -= MB_STEP;
      const n = MB_TUNE[stepRef.current];
      stepRef.current += 1;
      musicNote(n);
      if (n) {
        const id = `${performance.now()}-${stepRef.current}`;
        setNotes(ns => [...ns.slice(-8), { id, x: rand(-40, 40), nx: rand(-50, 50) + "px", c: pick(["♪", "♫", "♩", "♬"]) }]);
      }
      setStep(stepRef.current);
    }
  };
  const up = () => { drag.current.on = false; };

  useEffect(() => {
    if (finished) {
      const t = setTimeout(win, 900);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [finished, win]);

  const restart = () => { stepRef.current = 0; acc.current = 0; setStep(0); setNotes([]); };
  const hx = 50 + Math.cos(angle) * 34, hy = 50 + Math.sin(angle) * 34;
  return (
    <Stage won={won} wonText="Fin de la valse, révérence 🩰" font={FONT}
      bg="radial-gradient(ellipse at 50% 30%, #fce7f3 0%, #f9a8d4 45%, #9d174d 100%)" color="#4a044e">
      <style>{MB_CSS}</style>
      <Title sub="Une valse inédite, gravée sur un cylindre en PETG. Tourne la manivelle." color="#831843" style={{ textShadow:"none" }}>La boîte à musique</Title>
      <div style={{ position:"relative", width:"min(340px, 84vw)", height:300, marginTop:14, zIndex:2 }}>
        <div style={{ position:"absolute", left:"calc(50% - 30px)", top:0, width:80, marginLeft:-40, height:152 }}>
          {notes.map(n => (
            <span key={n.id} aria-hidden="true" style={{ position:"absolute", left:`calc(50% + ${n.x}px)`, top:30, fontSize:22, color:"#831843",
              "--nx":n.nx, animation:"mb-note 1.6s ease-out both", pointerEvents:"none" }}>{n.c}</span>
          ))}
          <div style={{ position:"absolute", left:0, right:0, bottom:0, height:150,
            transform:`scaleX(${(Math.cos(spin) < 0 ? -1 : 1) * Math.max(0.3, Math.abs(Math.cos(spin)))})` }}>
            <div style={{ height:150, animation: won ? "mb-bow 1s ease-in-out 2" : "none", transformOrigin:"50% 100%" }}>
              <svg viewBox="0 0 80 150" width="80" height="150">
                <line x1="40" y1="150" x2="40" y2="118" stroke="#d4af37" strokeWidth="3"/>
                <line x1="40" y1="118" x2="36" y2="96" stroke="#fde68a" strokeWidth="3"/>
                <line x1="40" y1="118" x2="46" y2="98" stroke="#fde68a" strokeWidth="3"/>
                <path d="M14 92 Q 40 76 66 92 Q 52 100 40 98 Q 28 100 14 92 Z" fill="#fbcfe8" stroke="#ec4899" strokeWidth="1.5"/>
                <rect x="24" y="44" width="32" height="6" rx="2" fill="#7c3aed"/>
                <rect x="28" y="50" width="24" height="34" fill="#22c55e"/>
                {[54, 60, 66, 72, 78].map(y => <line key={y} x1="28" x2="52" y1={y} y2={y} stroke="#15803d" strokeWidth="1.5"/>)}
                <rect x="24" y="84" width="32" height="6" rx="2" fill="#7c3aed"/>
                <path d="M28 54 Q 12 40 20 22" fill="none" stroke="#fde68a" strokeWidth="3" strokeLinecap="round"/>
                <path d="M52 54 Q 68 40 60 22" fill="none" stroke="#fde68a" strokeWidth="3" strokeLinecap="round"/>
                <circle cx="40" cy="32" r="10" fill="#fde68a"/>
                <circle cx="40" cy="20" r="5" fill="#92400e"/>
                <circle cx="36" cy="32" r="1.3" fill="#4a044e"/><circle cx="44" cy="32" r="1.3" fill="#4a044e"/>
                <path d="M37 36 q 3 2 6 0" fill="none" stroke="#be185d" strokeWidth="1.2"/>
              </svg>
            </div>
          </div>
        </div>
        <div style={{ position:"absolute", left:0, right:60, bottom:20, height:130, borderRadius:10,
          background:"linear-gradient(180deg, #92400e, #78350f 60%, #451a03)", boxShadow:"0 14px 26px rgba(0,0,0,.4), inset 0 2px 0 rgba(255,255,255,.2)" }}>
          <div style={{ position:"absolute", left:10, right:10, top:-8, height:14, borderRadius:4, background:"#b45309" }}/>
          <div style={{ position:"absolute", left:18, right:18, top:28, height:34, borderRadius:17, overflow:"hidden",
            background:"linear-gradient(180deg, #e5e7eb, #9ca3af 50%, #6b7280)", boxShadow:"inset 0 2px 4px rgba(0,0,0,.4)" }}>
            <div style={{ position:"absolute", inset:0,
              backgroundImage:"radial-gradient(circle, #374151 1.6px, transparent 2px)", backgroundSize:"14px 9px",
              backgroundPosition:`0 ${(angle * 30) % 9}px` }}/>
          </div>
          <div style={{ position:"absolute", left:18, right:18, top:66, height:8, background:"repeating-linear-gradient(90deg, #d4af37 0 3px, transparent 3px 6px)" }}/>
          <div style={{ position:"absolute", left:0, right:0, bottom:12, textAlign:"center", fontFamily:"Georgia, serif", fontStyle:"italic",
            color:"#fde68a", fontSize:14 }}>Valse de la bobine</div>
        </div>
        <div ref={crank} data-crank="1" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
          style={{ position:"absolute", right:-6, bottom:30, width:120, height:120, touchAction:"none", cursor: finished ? "default" : "grab",
            borderRadius:"50%", background:"rgba(255,255,255,.18)", border:"2px dashed rgba(131,24,67,.4)" }}>
          <svg viewBox="0 0 100 100" width="120" height="120" style={{ pointerEvents:"none", overflow:"visible" }}>
            <defs><marker id="mb-arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#831843"/></marker></defs>
            {!finished && step === 0 && <path d="M58 9 A 42 42 0 0 1 91 42" fill="none" stroke="#831843" strokeWidth="2.5" markerEnd="url(#mb-arr)"/>}
            <circle cx="50" cy="50" r="9" fill="#d4af37" stroke="#92400e" strokeWidth="2"/>
            <line x1="50" y1="50" x2={hx} y2={hy} stroke="#d4af37" strokeWidth="6" strokeLinecap="round"/>
            <circle cx={hx} cy={hy} r="9" fill="#7c2d12" stroke="#451a03" strokeWidth="2"/>
          </svg>
        </div>
      </div>
      <div style={{ width:"min(300px, 84vw)", height:10, borderRadius:6, background:"rgba(255,255,255,.45)", overflow:"hidden", zIndex:2, position:"relative" }}>
        <div style={{ width:`${(step / MB_TUNE.length) * 100}%`, height:"100%", background:"#831843", transition:"width .15s" }}/>
      </div>
      <div style={{ marginTop:12, minHeight:46, zIndex:2, position:"relative" }}>
        {finished && <Btn color="#9d174d" onClick={restart} style={{ minHeight:46 }}>🔁 Remonter la boîte</Btn>}
      </div>
      <Hint style={{ marginTop:2, color:"#fdf2f8", opacity:1, marginBottom: won ? 60 : 0 }}>{finished
        ? "La ballerine salue. Imprimée d'une seule pièce, sans support : un exploit."
        : step === 0 ? "Attrape la poignée et tourne dans le sens des aiguilles d'une montre."
        : "Continue de tourner, bien régulièrement. Une boîte à musique ne connaît pas l'avance rapide."}</Hint>
    </Stage>
  );
}

export const PAGES = {
  "fortune": Fortune,
  "machine-a-cafe": MachineACafe,
  "chien": Chien,
  "plante": Plante,
  "photomaton": Photomaton,
  "horoscope": Horoscope,
  "dessin": Dessin,
  "boite-a-musique": BoiteAMusique,
};
