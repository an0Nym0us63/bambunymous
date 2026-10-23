import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Title, useWin, Btn } from "./kit";

// Pages cachees, serie « defis » (23/10/2026) : neuf epreuves de reflexion.
// Le secret ne tombe qu'a la reussite du defi ; les solutions sont dans le
// code (inevitable), jamais affichees.

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SERIF = "Georgia, 'Times New Roman', serif";

/* ------------------------------------------------------------------ */
/* Outils communs                                                      */
/* ------------------------------------------------------------------ */

function Hint({ children, style }) {
  return (
    <p style={{ margin:"12px auto 0", fontSize:13, opacity:.78, textAlign:"center", maxWidth:440, lineHeight:1.45,
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
  return useCallback((fn, ms) => {
    const id = setTimeout(() => { ids.current.delete(id); fn(); }, ms);
    ids.current.add(id);
    return id;
  }, []);
}

/** Ecoute clavier hors des champs de saisie, avec le dernier gestionnaire. */
function useKeyDown(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = e => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      ref.current(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

let audioCtx = null;
function beep(freq, dur = 0.18, type = "sine", vol = 0.12) {
  try {
    if (!audioCtx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      audioCtx = new C();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    const ac = audioCtx, o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime;
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* audio indisponible */ }
}

/** Texte saisi ramene a l'essentiel : minuscules, sans accents ni espaces superflus. */
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'")
  .toLowerCase().trim().replace(/\s+/g, " ");
/** Un caractere tape compare a l'attendu (accents et casse ignores). */
const sameChar = (a, b) => a === b || norm(a) === norm(b);

const DF_CSS = `
@keyframes df-shake { 0%,100% { transform:translateX(0) } 20% { transform:translateX(-8px) } 40% { transform:translateX(7px) }
                      60% { transform:translateX(-5px) } 80% { transform:translateX(3px) } }
@keyframes df-in { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
`;

const FILS = [
  { c:"#ef4444", n:"Rouge" }, { c:"#f97316", n:"Orange" }, { c:"#facc15", n:"Jaune" },
  { c:"#22c55e", n:"Vert" }, { c:"#3b82f6", n:"Bleu" }, { c:"#a855f7", n:"Violet" },
];

/** Bobine vue de face (SVG), avec un chiffre facultatif au centre. */
function Spool({ color, size = 36, label, ring }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ display:"block", width:size, height:size }}>
      <circle cx="20" cy="20" r="19" fill={ring ? "#0b0f17" : "#1f2937"} stroke={ring ? "#e2e8f0" : "none"} strokeWidth="1.5"/>
      <circle cx="20" cy="20" r="15.5" fill={color}/>
      <circle cx="20" cy="20" r="12.5" fill="none" stroke="rgba(0,0,0,.18)"/>
      <path d="M8 14 A13 13 0 0 1 16 7.5" fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="20" cy="20" r="8" fill="#111827"/>
      {label != null && <text x="20" y="24.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff" fontFamily={FONT}>{label}</text>}
    </svg>
  );
}

/** Champ de reponse + bouton, valide a Entree. */
function AnswerBox({ onSubmit, placeholder = "Ta réponse", bad, width = 220, color = "#3b82f6", label = "Valider", inputMode }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={e => { e.preventDefault(); if (v.trim()) onSubmit(v); }}
      style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap", marginTop:14, position:"relative", zIndex:2,
        animation: bad ? "df-shake .45s ease" : "none" }}>
      <input value={v} onChange={e => setV(e.target.value)} placeholder={placeholder} autoComplete="off" autoCorrect="off"
        autoCapitalize="off" spellCheck={false} inputMode={inputMode} aria-label={placeholder}
        style={{ width, maxWidth:"58vw", padding:"10px 12px", borderRadius:12, border:"2px solid rgba(255,255,255,.25)",
          background:"rgba(0,0,0,.35)", color:"#fff", fontSize:16, fontFamily:FONT, outline:"none" }}/>
      <Btn color={color} type="submit">{label}</Btn>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* 1. radio : la frequence pirate                                      */
/* ------------------------------------------------------------------ */

const FMIN = 87.5, FMAX = 108;
const MORSE = { A:".-", B:"-...", C:"-.-.", D:"-..", E:".", F:"..-.", G:"--.", H:"....", I:"..", J:".---", K:"-.-",
  L:".-..", M:"--", N:"-.", O:"---", P:".--.", Q:"--.-", R:".-.", S:"...", T:"-", U:"..-", V:"...-", W:".--", X:"-..-",
  Y:"-.--", Z:"--.." };
const RADIO_WORD = "BRIM";
const RADIO_PIRATE = 105.0;
const STATIONS = [
  { f:88.6, name:"France Filament", txt:"… et maintenant l'info trafic : gros bouchon dans la buse numéro deux, prévoyez un démontage…" },
  { f:91.3, name:"Tube FM", txt:"♪ Oh oh oh, mon plateau est chaud, oh oh oh, ma pièce colle trop ♪ … ♪" },
  { f:95.8, name:"Radio Benchy", txt:"… la météo de l'atelier : averses de PLA sur la Bretagne, éclaircies de PETG en fin de journée…" },
  { f:99.1, name:"???", txt:"… psst… la fréquence pirate ? Prends la température de buse du PLA, deux cent dix degrés… coupe-la en deux… et règle-toi dessus…" },
  { f:102.4, name:"Nostalgie Ender", txt:"… souvenez-vous : le nivellement à la feuille de papier, le dimanche soir, en famille…" },
  { f:107.7, name:"Autoroute Info", txt:"… sur l'axe Z, la circulation est fluide. Attention, rétraction en approche…" },
];
const NOISE = "▒░▓#*~%&@·:";

/** Le message en temps de morse : 1 case = 1 unite, allumee ou non, avec le signe a ecrire. */
function morseTimeline(word) {
  const seq = [];
  [...word].forEach((ch, li) => {
    [...MORSE[ch]].forEach((s, si) => {
      const n = s === "." ? 1 : 3;
      for (let k = 0; k < n; k++) seq.push({ on:true, sym: k === 0 ? s : null });
      if (si < MORSE[ch].length - 1) seq.push({ on:false });
    });
    if (li < word.length - 1) { seq.push({ on:false, sym:" " }); seq.push({ on:false }); seq.push({ on:false }); }
  });
  for (let k = 0; k < 10; k++) seq.push({ on:false });
  return seq;
}

function Radio() {
  const [won, win] = useWin("radio");
  const [freq, setFreq] = useState(93.2);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState(false);
  const [bad, setBad] = useState(0);
  const [msg, setMsg] = useState("");
  const dialRef = useRef(null);
  const drag = useRef(false);
  const later = useTimers();
  const seq = useMemo(() => morseTimeline(RADIO_WORD), []);
  const freqRef = useRef(freq);
  freqRef.current = freq;
  const touched = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 130);
    return () => clearInterval(id);
  }, []);

  const pirateSig = Math.max(0, 1 - Math.abs(freq - RADIO_PIRATE) / 0.45);
  const sigRef = useRef(pirateSig);
  sigRef.current = pirateSig;
  const pos = tick % seq.length;
  useEffect(() => {
    const cell = seq[pos], s = sigRef.current;
    if (touched.current && cell.on && cell.sym && s > 0.5) beep(720, cell.sym === "." ? 0.12 : 0.36, "sine", 0.07 * s);
  }, [pos, seq]);

  const setF = f => { touched.current = true; setFreq(Math.round(Math.min(FMAX, Math.max(FMIN, f)) * 10) / 10); };
  const fromX = clientX => {
    const r = dialRef.current.getBoundingClientRect();
    setF(FMIN + (clientX - r.left) / r.width * (FMAX - FMIN));
  };
  useKeyDown(e => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowLeft" ? -1 : 1);
      setF(freqRef.current + step);
    }
  });

  // la station la mieux captee
  let best = null, sig = 0;
  for (const st of STATIONS) {
    const s = Math.max(0, 1 - Math.abs(freq - st.f) / 0.4);
    if (s > sig) { sig = s; best = st; }
  }
  if (pirateSig > sig) { sig = pirateSig; best = { pirate:true, name:"Radio Pirate" }; }

  // texte brouille selon la qualite de reception (pseudo-hasard qui change a chaque image)
  const garble = (txt, q) => [...txt].map((ch, i) => {
    const r = ((i * 7919 + tick * 104729) % 1000) / 1000;
    return ch !== " " && r > q * 1.15 - 0.05 ? NOISE[(i + tick) % NOISE.length] : ch;
  }).join("");

  let morseShown = "";
  if (best && best.pirate) for (let k = 0; k <= pos; k++) if (seq[k].sym) morseShown += seq[k].sym;
  const lampOn = !!(best && best.pirate && seq[pos].on);

  const submit = v => {
    if (norm(v).replace(/\s/g, "") === RADIO_WORD.toLowerCase()) {
      setMsg("Bien reçu. Terminé.");
      beep(880, .15); later(() => beep(1320, .3), 150);
      win();
    } else {
      setBad(b => b + 1); setMsg("Rien que de la friture sur la ligne…");
      later(() => setBad(0), 500);
    }
  };

  const ratio = (freq - FMIN) / (FMAX - FMIN);
  return (
    <Stage won={won} wonText="Message capté !" font={FONT}
      bg="radial-gradient(ellipse at 50% 20%, #4a3423 0%, #2a1c12 60%, #140d08 100%)">
      <style>{DF_CSS}</style>
      <Title color="#fcd9a8" sub="Quelque part entre deux stations, quelqu'un émet en cachette.">La radio</Title>

      <div style={{ marginTop:18, width:"min(100%, 440px)", boxSizing:"border-box", borderRadius:22, padding:"16px 14px 18px",
        position:"relative", zIndex:2, background:"linear-gradient(180deg, #8b5a2b, #5b3a1c)",
        boxShadow:"0 20px 40px rgba(0,0,0,.55), inset 0 2px 0 rgba(255,255,255,.2)", border:"3px solid #3b2410" }}>
        <div style={{ display:"flex", gap:10, alignItems:"stretch" }}>
          <div aria-hidden="true" style={{ width:64, flexShrink:0, borderRadius:12, position:"relative",
            background:"repeating-linear-gradient(0deg, #2b1a0c 0 3px, #c8a46e 3px 6px)", border:"2px solid #2b1a0c" }}>
            <span style={{ position:"absolute", top:8, right:8, width:12, height:12, borderRadius:"50%",
              background: lampOn ? "#fde047" : "#5b4a1a", boxShadow: lampOn ? "0 0 14px #fde047" : "none" }}/>
          </div>
          <div style={{ flex:1, minWidth:0, borderRadius:12, background:"#0f0a05", border:"2px solid #2b1a0c", padding:"8px 10px",
            color:"#fbbf24", fontFamily:MONO, minHeight:128, display:"flex", flexDirection:"column" }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, opacity:.8 }}>
              <span>{best && sig > 0.15 ? (sig > 0.6 ? best.name : "???") : "— bruit —"}</span>
              <span aria-label="Qualité du signal" style={{ display:"flex", gap:2, alignItems:"flex-end" }}>
                {[0, 1, 2, 3, 4].map(k => <i key={k} style={{ width:4, height:4 + k * 2.5, background: k < Math.round(sig * 5) ? "#fbbf24" : "#3b2a10" }}/>)}
              </span>
            </div>
            <div style={{ fontSize:26, fontWeight:900, textAlign:"center", margin:"4px 0", textShadow:"0 0 10px rgba(251,191,36,.6)" }}>
              {freq.toFixed(1).replace(".", ",")} <span style={{ fontSize:13 }}>MHz</span>
            </div>
            <div style={{ fontSize:12.5, lineHeight:1.4, color:"#fde68a", wordBreak:"break-word", minHeight:36 }}>
              {!best || sig <= 0.05 ? garble("kshhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", 0)
                : best.pirate ? <>
                    {garble("Ici Radio Pirate. Le mot de passe, en morse :", sig)}<br/>
                    <b style={{ fontSize:17, letterSpacing:".14em" }}>{garble(morseShown || "…", sig)}</b>
                  </>
                : garble(best.txt, sig)}
            </div>
          </div>
        </div>

        {/* le cadran a glisser */}
        <div ref={dialRef} role="slider" aria-label="Fréquence" aria-valuemin={FMIN} aria-valuemax={FMAX} aria-valuenow={freq}
          onPointerDown={e => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); fromX(e.clientX); }}
          onPointerMove={e => { if (drag.current) fromX(e.clientX); }}
          onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
          style={{ marginTop:14, height:54, borderRadius:10, position:"relative", cursor:"ew-resize", touchAction:"none",
            background:"linear-gradient(180deg, #f5e6c8, #d9c39a)", border:"2px solid #2b1a0c", overflow:"hidden" }}>
          {Array.from({ length: 42 }, (_, i) => {
            const f = FMIN + i * 0.5;
            return <span key={i} aria-hidden="true" style={{ position:"absolute", left:`${(f - FMIN) / (FMAX - FMIN) * 100}%`, top:0,
              width:1, height: i % 2 === 1 ? 18 : 10, background:"#5b3a1c" }}/>;
          })}
          {[88, 92, 96, 100, 104, 108].map(f => (
            <span key={f} aria-hidden="true" style={{ position:"absolute", left:`${(f - FMIN) / (FMAX - FMIN) * 100}%`, top:26,
              transform: f === 108 ? "translateX(-100%)" : "translateX(-50%)", fontSize:11, fontWeight:800, color:"#3b2410", fontFamily:MONO }}>{f}</span>
          ))}
          <span aria-hidden="true" style={{ position:"absolute", left:`calc(${ratio * 100}% - 1.5px)`, top:0, bottom:0, width:3,
            background:"#dc2626", boxShadow:"0 0 6px #dc2626" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10 }}>
          <Btn color="#3b2410" onClick={() => setF(freq - 0.1)} aria-label="Moins 0,1 mégahertz">◀ 0,1</Btn>
          <span style={{ fontSize:12, color:"#fde68a", opacity:.85, textAlign:"center" }}>glisse sur le cadran</span>
          <Btn color="#3b2410" onClick={() => setF(freq + 0.1)} aria-label="Plus 0,1 mégahertz">0,1 ▶</Btn>
        </div>
      </div>

      <AnswerBox onSubmit={submit} placeholder="Le mot capté" bad={bad} color="#b45309"/>
      {msg && <Hint style={{ color:"#fde68a", opacity:1 }}>{msg}</Hint>}

      <button onClick={() => setNotice(n => !n)} style={{ marginTop:12, background:"none", border:"none", color:"#fcd9a8",
        textDecoration:"underline", cursor:"pointer", fontSize:13, position:"relative", zIndex:2 }}>
        📜 {notice ? "Ranger la notice" : "Lire la notice collée sous le poste"}
      </button>
      {notice && (
        <div style={{ marginTop:8, background:"#f5e6c8", color:"#3b2410", borderRadius:10, padding:"10px 12px", fontFamily:MONO,
          fontSize:12, display:"grid", gridTemplateColumns:"repeat(4, auto)", gap:"3px 14px", position:"relative", zIndex:2,
          boxShadow:"0 6px 18px rgba(0,0,0,.4)", animation:"df-in .3s ease" }}>
          {Object.entries(MORSE).map(([k, v]) => <span key={k}><b>{k}</b> {v}</span>)}
        </div>
      )}
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 2. cryptex : deux parchemins, deux serrures (DIFFICILE)             */
/* ------------------------------------------------------------------ */

const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// rangs dans l'alphabet (0 = A) ; « near » : la bonne idee mal ecrite, qui merite un coup de pouce
const CRYPTEX = [
  { key:[2, 14, 20, 2, 7, 4], near:null },
  { key:[17, 8, 14, 17, 8, 12], near:[12, 8, 17, 14, 8, 17] },
];
const CRYPTEX_POEMS = [
  [
    "Plus fine qu'un cheveu, je ne vis qu'empilée,",
    "par centaines de sœurs, du plateau jusqu'au faîte.",
    "Que la toute première vienne à être ratée,",
    "et c'est l'ouvrage entier qui finit en défaite.",
    "Hors de l'atelier, un nourrisson me salit,",
    "et toi, rompu le soir, tu t'y glisses sans bruit.",
  ],
  [
    "Muet, je te réponds pourtant à chaque geste,",
    "Imitant tes grimaces sans jamais les comprendre.",
    "Rien ne m'appartient : ce que tu montres, je le reste ;",
    "Ombre sans épaisseur, je n'ai rien à te rendre,",
    "Inversé, sinon toi : ta droite est ma main gauche.",
    "Romps-moi, et sept hivers le malheur te chevauche.",
  ],
];
const ARROW_BTN = { width:"min(11vw, 46px)", height:34, borderRadius:8, border:"none", background:"rgba(0,0,0,.35)", color:"#fde68a",
  fontSize:14, cursor:"pointer", padding:0 };

function CryptexRing({ value, onChange, active, onFocus, color }) {
  const start = useRef(null);
  const step = d => onChange((value + d + 26) % 26);
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
      <button aria-label="Lettre précédente" onClick={() => { onFocus(); step(-1); }} style={ARROW_BTN}>▲</button>
      <div onPointerDown={e => { onFocus(); start.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => {
          if (start.current == null) return;
          const d = e.clientY - start.current;
          if (Math.abs(d) > 22) { step(d > 0 ? -1 : 1); start.current = e.clientY; }
        }}
        onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}
        style={{ width:"min(11vw, 46px)", height:112, borderRadius:8, overflow:"hidden", touchAction:"none", cursor:"ns-resize",
          background:`linear-gradient(90deg, #3a2a10, ${color} 30%, #fff3c4 50%, ${color} 70%, #3a2a10)`,
          border: active ? "2px solid #fde047" : "2px solid #2a1d08", display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center", fontFamily:SERIF, color:"#2a1d08", boxShadow:"inset 0 0 12px rgba(0,0,0,.6)",
          boxSizing:"border-box" }}>
        <span style={{ fontSize:15, opacity:.45 }}>{ABC[(value + 25) % 26]}</span>
        <span style={{ fontSize:28, fontWeight:900, lineHeight:1.2, borderTop:"1px solid rgba(0,0,0,.35)",
          borderBottom:"1px solid rgba(0,0,0,.35)", width:"100%", textAlign:"center", background:"rgba(255,255,255,.18)" }}>{ABC[value]}</span>
        <span style={{ fontSize:15, opacity:.45 }}>{ABC[(value + 1) % 26]}</span>
      </div>
      <button aria-label="Lettre suivante" onClick={() => { onFocus(); step(1); }} style={ARROW_BTN}>▼</button>
    </div>
  );
}

function Cryptex() {
  const [won, win] = useWin("cryptex");
  const [level, setLevel] = useState(0);
  const [rings, setRings] = useState(() => [0, 1, 2, 3, 4, 5].map(i => (i * 7 + 3) % 26));
  const [cur, setCur] = useState(0);
  const [opening, setOpening] = useState(false);
  const [msg, setMsg] = useState("");
  const later = useTimers();

  useEffect(() => {
    if (opening || won) return;
    const def = CRYPTEX[level];
    if (rings.every((v, i) => v === def.key[i])) {
      setOpening(true); setMsg("");
      beep(520, .12); later(() => beep(780, .12), 120); later(() => beep(1040, .35), 240);
      later(() => {
        if (level === 0) {
          setLevel(1); setRings([0, 1, 2, 3, 4, 5].map(i => (i * 11 + 5) % 26)); setCur(0); setOpening(false);
        } else win();
      }, 1700);
    } else if (def.near && rings.every((v, i) => v === def.near[i])) {
      setMsg("Le mécanisme frémit… mais ne cède pas. Relis la dernière ligne du parchemin.");
    } else setMsg("");
  }, [rings, level, opening, won, later, win]);

  const setRing = (i, v) => { if (!opening) setRings(r => r.map((x, j) => (j === i ? v : x))); };
  useKeyDown(e => {
    if (opening) return;
    const k = e.key.length === 1 ? e.key.toUpperCase() : "";
    if (/^[A-Z]$/.test(k)) { setRing(cur, ABC.indexOf(k)); setCur(c => Math.min(5, c + 1)); }
    else if (e.key === "ArrowLeft") setCur(c => Math.max(0, c - 1));
    else if (e.key === "ArrowRight") setCur(c => Math.min(5, c + 1));
    else if (e.key === "ArrowUp") { e.preventDefault(); setRing(cur, (rings[cur] + 25) % 26); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setRing(cur, (rings[cur] + 1) % 26); }
    else if (e.key === "Backspace") setCur(c => Math.max(0, c - 1));
  });

  const color = level === 0 ? "#b8860b" : "#8796a8";
  return (
    <Stage won={won} wonText="Les deux cryptex sont ouverts !" font={FONT}
      bg="radial-gradient(ellipse at 50% 30%, #3b2a1a 0%, #1c130b 65%, #0b0704 100%)">
      <style>{DF_CSS}</style>
      <Title color="#fde68a" sub={level === 0 ? "Six anneaux, un seul mot. Le parchemin le décrit… à sa façon." : "Il y avait un second parchemin roulé à l'intérieur, et un second cryptex."}>
        Le cryptex {level === 0 ? "I" : "II"}
      </Title>

      <div key={"parchemin" + level} style={{ marginTop:16, width:"min(100%, 420px)", boxSizing:"border-box", padding:"14px 18px", borderRadius:6,
        position:"relative", zIndex:2, background:"linear-gradient(180deg, #f3e2b6, #e3c98c)", color:"#3b2410", fontFamily:SERIF,
        fontSize:"clamp(13px, 3.6vw, 15px)", lineHeight:1.55, boxShadow:"0 10px 30px rgba(0,0,0,.5), inset 0 0 30px rgba(120,80,20,.35)",
        animation:"df-in .5s ease" }}>
        {CRYPTEX_POEMS[level].map((l, i) => <div key={i}>{l}</div>)}
        <div style={{ marginTop:8, fontStyle:"italic", fontSize:"0.92em" }}>
          {level === 0 ? "Qui suis-je ? Six lettres, pas une de plus." : "Et prends garde : écris-moi comme moi je t'écrirais."}
        </div>
      </div>

      <div style={{ marginTop:18, display:"flex", alignItems:"center", gap:"min(1.2vw, 6px)", position:"relative", zIndex:2,
        padding:"10px 8px", borderRadius:16, background:"linear-gradient(180deg, #5b4318, #2a1d08)",
        boxShadow: opening ? "0 0 40px rgba(253,224,71,.6)" : "0 16px 40px rgba(0,0,0,.6)", transition:"box-shadow .6s" }}>
        <span aria-hidden="true" style={{ width:10, height:70, borderRadius:6, background:color, opacity:.9,
          transform: opening ? "translateX(-14px)" : "none", transition:"transform 1s ease" }}/>
        {rings.map((v, i) => (
          <CryptexRing key={i} value={v} color={color} active={cur === i && !opening} onFocus={() => setCur(i)} onChange={nv => setRing(i, nv)}/>
        ))}
        <span aria-hidden="true" style={{ width:10, height:70, borderRadius:6, background:color, opacity:.9,
          transform: opening ? "translateX(14px)" : "none", transition:"transform 1s ease" }}/>
      </div>
      {opening && !won && <Hint style={{ color:"#fde047", opacity:1 }}>Clic… le cryptex s'ouvre !</Hint>}
      {msg && <Hint style={{ color:"#fca5a5", opacity:1 }}>{msg}</Hint>}
      <Hint>Fais tourner les anneaux (flèches ou glisser du doigt), ou tape directement les lettres au clavier.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 3. sudoku : six bobines, six couleurs                               */
/* ------------------------------------------------------------------ */

// grille 6x6, regions de 2 lignes sur 3 colonnes ; solution unique (verifiee par force brute)
const SDK_GIVEN = "064000005000000005203060000401500030";
const SDK_SOL = "364512125643416325253164632451541236";

function Sudoku() {
  const [won, win] = useWin("sudoku");
  const [cells, setCells] = useState(() => [...SDK_GIVEN].map(Number));
  const [sel, setSel] = useState(null);
  const fixed = useMemo(() => [...SDK_GIVEN].map(c => c !== "0"), []);

  const conflicts = useMemo(() => {
    const bad = new Set();
    for (let i = 0; i < 36; i++) {
      if (!cells[i]) continue;
      const r = Math.floor(i / 6), c = i % 6;
      for (let j = 0; j < 36; j++) {
        if (j === i || cells[j] !== cells[i]) continue;
        const r2 = Math.floor(j / 6), c2 = j % 6;
        if (r === r2 || c === c2 || (Math.floor(r / 2) === Math.floor(r2 / 2) && Math.floor(c / 3) === Math.floor(c2 / 3))) bad.add(i);
      }
    }
    return bad;
  }, [cells]);

  useEffect(() => { if (cells.join("") === SDK_SOL) win(); }, [cells, win]);

  const put = v => {
    if (sel == null || fixed[sel] || won) return;
    setCells(cs => cs.map((x, i) => (i === sel ? v : x)));
    beep(400 + v * 90, .07, "triangle", .06);
  };
  useKeyDown(e => {
    if (/^[1-6]$/.test(e.key)) put(Number(e.key));
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") put(0);
    else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const s = sel ?? 0, r = Math.floor(s / 6), c = s % 6;
      const d = { ArrowUp:[-1, 0], ArrowDown:[1, 0], ArrowLeft:[0, -1], ArrowRight:[0, 1] }[e.key];
      setSel(((r + d[0] + 6) % 6) * 6 + (c + d[1] + 6) % 6);
    }
  });

  return (
    <Stage won={won} wonText="Grille parfaite !" font={FONT}
      bg="linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)">
      <Title color="#e2e8f0" sub="Dans chaque ligne, chaque colonne et chaque bac de 2×3 : les six couleurs, une seule fois chacune.">Le sudoku des bobines</Title>
      <div role="grid" style={{ marginTop:18, display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gridTemplateRows:"repeat(6, 1fr)",
        width:"min(100%, 372px)", aspectRatio:"1", background:"#0b1120", border:"3px solid #94a3b8", borderRadius:10, overflow:"hidden",
        position:"relative", zIndex:2 }}>
        {cells.map((v, i) => {
          const r = Math.floor(i / 6), c = i % 6;
          const isSel = sel === i;
          const same = sel != null && cells[sel] && cells[sel] === v;
          return (
            <button key={i} role="gridcell" aria-label={`Ligne ${r + 1}, colonne ${c + 1}${v ? ", " + FILS[v - 1].n : ", vide"}`}
              onClick={() => setSel(i)}
              style={{ border:"none", padding:0, cursor: fixed[i] ? "default" : "pointer", display:"flex", alignItems:"center",
                justifyContent:"center", minWidth:0, minHeight:0,
                background: isSel ? "#475569" : same ? "#26344f" : (Math.floor(r / 2) + Math.floor(c / 3)) % 2 ? "#162033" : "#1b263b",
                borderRight: c === 2 ? "3px solid #94a3b8" : c < 5 ? "1px solid #334155" : "none",
                borderBottom: r % 2 === 1 && r < 5 ? "3px solid #94a3b8" : r < 5 ? "1px solid #334155" : "none",
                boxShadow: conflicts.has(i) ? "inset 0 0 0 3px #ef4444" : "none" }}>
              {v ? <svg viewBox="0 0 40 40" style={{ width:"78%", height:"78%", display:"block" }} aria-hidden="true">
                <circle cx="20" cy="20" r="19" fill={fixed[i] ? "#0b0f17" : "#1f2937"} stroke={fixed[i] ? "#e2e8f0" : "none"} strokeWidth="1.8"/>
                <circle cx="20" cy="20" r="15.5" fill={FILS[v - 1].c}/>
                <circle cx="20" cy="20" r="8" fill="#111827"/>
                <text x="20" y="24.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff" fontFamily={FONT}>{v}</text>
              </svg> : null}
            </button>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:5, marginTop:14, flexWrap:"wrap", justifyContent:"center", position:"relative", zIndex:2 }}>
        {FILS.map((f, k) => (
          <button key={k} onClick={() => put(k + 1)} aria-label={f.n}
            style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.15)", borderRadius:12, padding:3, cursor:"pointer" }}>
            <Spool color={f.c} size={40} label={k + 1}/>
          </button>
        ))}
        <button onClick={() => put(0)} aria-label="Effacer"
          style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.15)", borderRadius:12, width:48, color:"#e2e8f0",
            fontSize:20, cursor:"pointer" }}>⌫</button>
      </div>
      <Hint style={{ color:"#cbd5e1" }}>Touche une case, puis une bobine. Les bobines cerclées de blanc sont posées d'office. Au clavier : flèches et 1 à 6.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 4. laser : graver le plateau (DIFFICILE)                            */
/* ------------------------------------------------------------------ */

// > source (tire vers la droite) ; T plateau a graver ; # mur ; / et \ miroirs visses ;
// M miroir pivotant (depart en /) ; C losange de gravure obligatoire ; . vide.
// Chaque niveau n'a qu'un seul trajet gagnant (verifie par force brute sur toutes les positions).
const LASER_LEVELS = [
  [">MMCM.", "#....\\", ".M..M.", "...#..", "..T..#", "..#.M."],
  ["M......", ".M....M", "T..M.#.", ">C....M", "#MC..M.", ".##.M/.", "...M/.#"],
  ["....MM./", ">...M...", "..#M...M", ".#...M.M", "M......M", "..#C.#TM", "\\CCM....", "#..#M..."],
];

function laserTrace(rows, mirrors) {
  const H = rows.length, W = rows[0].length;
  let x = 0, y = 0, dx = 1, dy = 0;
  rows.forEach((l, yy) => { const xx = l.indexOf(">"); if (xx >= 0) { x = xx; y = yy; } });
  const pts = [[x, y]];
  const seen = new Set();
  const hits = new Set();
  for (let step = 0; step < 400; step++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) { pts.push([x + dx * 0.5, y + dy * 0.5]); return { pts, end:"out", hits }; }
    x = nx; y = ny;
    const c = rows[y][x];
    const key = `${x},${y},${dx},${dy}`;
    if (seen.has(key)) { pts.push([x, y]); return { pts, end:"loop", hits }; }
    seen.add(key);
    if (c === "#") { pts.push([x - dx * 0.5, y - dy * 0.5]); return { pts, end:"wall", hits }; }
    if (c === "T") { pts.push([x, y]); return { pts, end:"target", hits }; }
    if (c === "C") hits.add(`${x},${y}`);
    let m = null;
    if (c === "/" || c === "\\") m = c;
    else if (c === "M") m = mirrors[`${x},${y}`] ? "\\" : "/";
    if (m) {
      pts.push([x, y]);
      if (m === "/") [dx, dy] = [-dy, -dx]; else [dx, dy] = [dy, dx];
    }
  }
  return { pts, end:"loop", hits };
}

function Laser() {
  const [won, win] = useWin("laser");
  const [lv, setLv] = useState(0);
  const [mirrors, setMirrors] = useState({});
  const [moves, setMoves] = useState(0);
  const [done, setDone] = useState(false);
  const later = useTimers();
  const rows = LASER_LEVELS[lv];
  const H = rows.length, W = rows[0].length;
  const cps = useMemo(() => {
    const a = [];
    rows.forEach((l, y) => [...l].forEach((c, x) => { if (c === "C") a.push(`${x},${y}`); }));
    return a;
  }, [rows]);
  const tr = useMemo(() => laserTrace(rows, mirrors), [rows, mirrors]);
  const solved = tr.end === "target" && cps.every(c => tr.hits.has(c));

  useEffect(() => {
    if (!solved || done) return;
    setDone(true);
    beep(660, .12); later(() => beep(990, .3), 130);
    if (lv === LASER_LEVELS.length - 1) later(win, 700);
  }, [solved, done, lv, later, win]);

  const next = () => { setLv(l => l + 1); setMirrors({}); setMoves(0); setDone(false); };
  const rotate = (x, y) => {
    if (done) return;
    setMirrors(m => ({ ...m, [`${x},${y}`]: !m[`${x},${y}`] }));
    setMoves(n => n + 1);
    beep(300, .05, "square", .04);
  };

  const S = 50;
  const beamPts = tr.pts.map(([x, y]) => `${x * S + S / 2},${y * S + S / 2}`).join(" ");
  return (
    <Stage won={won} wonText="Trois plateaux gravés !" font={FONT}
      bg="radial-gradient(ellipse at 50% 30%, #1a1030 0%, #0a0614 70%, #000 100%)">
      <Title color="#f0abfc" sub="Fais pivoter les miroirs : le laser doit traverser chaque losange, puis frapper le plateau doré.">Le laser</Title>
      <div style={{ marginTop:10, display:"flex", gap:8, alignItems:"center", fontSize:14, color:"#e9d5ff", position:"relative", zIndex:2,
        flexWrap:"wrap", justifyContent:"center" }}>
        <b>Niveau {lv + 1} / 3</b><span>· {moves} rotation{moves > 1 ? "s" : ""}</span>
        <span>· losanges {cps.filter(c => tr.hits.has(c)).length}/{cps.length}</span>
      </div>
      <svg viewBox={`-6 -6 ${W * S + 12} ${H * S + 12}`} style={{ marginTop:12, width:`min(100%, ${W * 58}px)`, height:"auto",
        position:"relative", zIndex:2 }} role="img" aria-label="Grille du laser">
        <defs>
          <filter id="lz-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
        </defs>
        <rect x={-6} y={-6} width={W * S + 12} height={H * S + 12} rx="10" fill="#140b24" stroke="#4c1d95" strokeWidth="2"/>
        {rows.map((l, y) => [...l].map((c, x) => {
          const cx = x * S + S / 2, cy = y * S + S / 2, k = `${x},${y}`;
          let item = null;
          if (c === "#") item = <g><rect x={x * S + 3} y={y * S + 3} width={S - 6} height={S - 6} rx="4" fill="#475569"/>
            <path d={`M${x * S + 8} ${y * S + 17} h${S - 16} M${x * S + 8} ${y * S + 33} h${S - 16}`} stroke="#334155" strokeWidth="3"/></g>;
          else if (c === ">") item = <g><rect x={x * S + 5} y={cy - 12} width={S - 12} height={24} rx="5" fill="#0f172a" stroke="#f472b6" strokeWidth="2"/>
            <circle cx={x * S + S - 9} cy={cy} r="5" fill="#f43f5e"/></g>;
          else if (c === "T") item = <g><rect x={x * S + 4} y={cy - 10} width={S - 8} height={20} rx="3"
            fill={solved ? "#fbbf24" : "#a16207"} stroke="#fde68a" strokeWidth="1.5"/>
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fontWeight="800" fill="#3b2410" fontFamily={FONT}>PEI</text></g>;
          else if (c === "C") {
            const hit = tr.hits.has(k);
            item = <path d={`M${cx} ${cy - 13} L${cx + 13} ${cy} L${cx} ${cy + 13} L${cx - 13} ${cy} Z`}
              fill={hit ? "#22d3ee" : "none"} stroke="#22d3ee" strokeWidth="2.5"/>;
          } else if (c === "/" || c === "\\" || c === "M") {
            const m = c === "M" ? (mirrors[k] ? "\\" : "/") : c;
            const d = m === "/" ? `M${x * S + 9} ${y * S + S - 9} L${x * S + S - 9} ${y * S + 9}` : `M${x * S + 9} ${y * S + 9} L${x * S + S - 9} ${y * S + S - 9}`;
            item = (
              <g onClick={c === "M" ? () => rotate(x, y) : undefined} style={{ cursor: c === "M" ? "pointer" : "default" }}
                role={c === "M" ? "button" : undefined} aria-label={c === "M" ? "Miroir pivotant" : undefined}>
                <rect x={x * S + 1} y={y * S + 1} width={S - 2} height={S - 2} rx="5" fill={c === "M" ? "#2e1065" : "#1d1233"}/>
                {c === "M" && <circle cx={cx} cy={cy} r="20" fill="none" stroke="#8b5cf6" strokeDasharray="3 4"/>}
                <path d={d} stroke={c === "M" ? "#e0e7ff" : "#64748b"} strokeWidth="6" strokeLinecap="round"/>
                {c !== "M" && <><circle cx={x * S + 7} cy={y * S + 7} r="2.2" fill="#94a3b8"/><circle cx={x * S + S - 7} cy={y * S + S - 7} r="2.2" fill="#94a3b8"/>
                  <circle cx={x * S + S - 7} cy={y * S + 7} r="2.2" fill="#94a3b8"/><circle cx={x * S + 7} cy={y * S + S - 7} r="2.2" fill="#94a3b8"/></>}
              </g>
            );
          }
          return <g key={k}><rect x={x * S + 1} y={y * S + 1} width={S - 2} height={S - 2} rx="5" fill="#1d1233"/>{item}</g>;
        }))}
        <polyline points={beamPts} fill="none" stroke="#f43f5e" strokeWidth="7" opacity=".55" filter="url(#lz-glow)" pointerEvents="none"/>
        <polyline points={beamPts} fill="none" stroke="#fecdd3" strokeWidth="2.2" pointerEvents="none" strokeLinejoin="round"/>
      </svg>
      <div style={{ display:"flex", gap:10, marginTop:14, position:"relative", zIndex:2 }}>
        {done && lv < LASER_LEVELS.length - 1 && <Btn color="#a21caf" onClick={next}>Niveau suivant ▶</Btn>}
        {!done && <Btn color="#4c1d95" onClick={() => { setMirrors({}); setMoves(0); }}>Remettre à zéro</Btn>}
      </div>
      <Hint style={{ color:"#e9d5ff" }}>
        {done ? (lv < LASER_LEVELS.length - 1 ? "Gravure réussie ! Le niveau suivant est plus retors." : "Trois plateaux gravés. Respect.")
          : "Touche un miroir à cadran pointillé pour le faire pivoter d'un quart de tour. Les miroirs vissés ne bougent pas, les murs arrêtent tout."}
      </Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 5. nonogramme : l'image cachee                                      */
/* ------------------------------------------------------------------ */

// 10x10 ; solution unique, resoluble ligne par ligne sans hypothese (verifie)
const NONO = [
  ".....##...",
  ".....##...",
  "..######..",
  "..#.##.#..",
  "..######..",
  "##########",
  "#########.",
  ".########.",
  "..######..",
  "#.#.#.#.#.",
];
const nonoClue = line => {
  const r = [];
  let n = 0;
  for (const v of line) { if (v) n++; else if (n) { r.push(n); n = 0; } }
  if (n) r.push(n);
  return r.length ? r : [0];
};
const emptyNono = () => Array.from({ length: 10 }, () => Array(10).fill(0));

function Nonogramme() {
  const [won, win] = useWin("nonogramme");
  const sol = useMemo(() => NONO.map(r => [...r].map(c => (c === "#" ? 1 : 0))), []);
  const rowClues = useMemo(() => sol.map(nonoClue), [sol]);
  const colClues = useMemo(() => sol[0].map((_, c) => nonoClue(sol.map(r => r[c]))), [sol]);
  const [g, setG] = useState(emptyNono); // 0 vide, 1 plein, 2 croix
  const [mode, setMode] = useState(1);
  const paint = useRef(null);

  const rowOk = r => nonoClue(g[r].map(v => (v === 1 ? 1 : 0))).join() === rowClues[r].join();
  const colOk = c => nonoClue(g.map(row => (row[c] === 1 ? 1 : 0))).join() === colClues[c].join();
  const allOk = g.every((_, r) => rowOk(r)) && g[0].every((_, c) => colOk(c));
  useEffect(() => { if (allOk) win(); }, [allOk, win]);

  const apply = (r, c, val) => setG(old => {
    if (old[r][c] === val) return old;
    const n = old.map(row => row.slice());
    n[r][c] = val;
    return n;
  });
  const start = (e, r, c, m) => {
    if (won) return;
    e.preventDefault();
    const val = g[r][c] === m ? 0 : m;
    paint.current = val;
    apply(r, c, val);
  };
  const move = e => {
    if (paint.current == null || won) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const d = el && el.dataset;
    if (d && d.nr != null) apply(Number(d.nr), Number(d.nc), paint.current);
  };
  useEffect(() => {
    const up = () => { paint.current = null; };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, []);

  const CELL = "min(29px, calc((100vw - 160px) / 10))";
  return (
    <Stage won={won} wonText="Image révélée !" font={FONT}
      bg="linear-gradient(180deg, #0c4a6e 0%, #082f49 70%, #04202f 100%)">
      <Title color="#e0f2fe" sub="Les nombres disent combien de cases pleines se suivent, dans l'ordre. Une figure culte se cache dessous.">Le nonogramme</Title>
      <div onPointerMove={move} style={{ marginTop:16, display:"grid", gridTemplateColumns:`auto repeat(10, ${CELL})`, position:"relative",
        zIndex:2, touchAction:"none", background:"rgba(0,0,0,.2)", padding:6, borderRadius:10 }}>
        <div/>
        {colClues.map((cl, c) => (
          <div key={c} style={{ display:"flex", flexDirection:"column", justifyContent:"flex-end", alignItems:"center", fontSize:11,
            fontWeight:700, lineHeight:1.15, paddingBottom:3, color: colOk(c) ? "#4b6b80" : "#e0f2fe", fontFamily:MONO }}>
            {cl.map((n, i) => <span key={i}>{n}</span>)}
          </div>
        ))}
        {g.map((row, r) => (
          <React.Fragment key={r}>
            <div style={{ display:"flex", gap:4, justifyContent:"flex-end", alignItems:"center", paddingRight:5, fontSize:11, fontWeight:700,
              color: rowOk(r) ? "#4b6b80" : "#e0f2fe", fontFamily:MONO, whiteSpace:"nowrap" }}>
              {rowClues[r].map((n, i) => <span key={i}>{n}</span>)}
            </div>
            {row.map((v, c) => (
              <div key={c} data-nr={r} data-nc={c} role="button" aria-label={`Ligne ${r + 1}, colonne ${c + 1}`}
                onPointerDown={e => start(e, r, c, e.button === 2 ? 2 : mode)} onContextMenu={e => e.preventDefault()}
                style={{ width:CELL, height:CELL, boxSizing:"border-box", cursor:"pointer",
                  background: v === 1 ? (won ? "#fde68a" : "#f8fafc") : "#0f3a52",
                  borderRight: c === 4 ? "2px solid #7dd3fc" : "1px solid #1e5a7a",
                  borderBottom: r === 4 ? "2px solid #7dd3fc" : "1px solid #1e5a7a",
                  display:"flex", alignItems:"center", justifyContent:"center", color:"#7dd3fc", fontSize:13, fontWeight:900,
                  transition:"background .3s" }}>
                {v === 2 ? "✕" : ""}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, marginTop:14, position:"relative", zIndex:2, flexWrap:"wrap", justifyContent:"center" }}>
        <Btn color={mode === 1 ? "#0284c7" : "#164e63"} onClick={() => setMode(1)}>■ Remplir</Btn>
        <Btn color={mode === 2 ? "#0284c7" : "#164e63"} onClick={() => setMode(2)}>✕ Croix</Btn>
        <Btn color="#334155" onClick={() => setG(emptyNono())}>Effacer</Btn>
      </div>
      <Hint style={{ color:"#bae6fd" }}>Glisse le doigt pour peindre plusieurs cases d'un coup. Les croix servent de pense-bête (clic droit à la souris).</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 6. mastermind : la combinaison de l'AMS                             */
/* ------------------------------------------------------------------ */

const MM_ROWS = 10;
const newSecret = () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 6));
function mmScore(guess, secret) {
  let black = 0;
  const g = [], s = [];
  guess.forEach((v, i) => { if (v === secret[i]) black++; else { g.push(v); s.push(secret[i]); } });
  let white = 0;
  g.forEach(v => { const k = s.indexOf(v); if (k >= 0) { white++; s.splice(k, 1); } });
  return { black, white };
}

function Peg({ k, size = 30, onClick }) {
  return (
    <div onClick={onClick} style={{ width:size, height:size, borderRadius:"50%", cursor: onClick ? "pointer" : "default", flexShrink:0,
      background: k == null ? "rgba(255,255,255,.08)" : FILS[k].c, border: k == null ? "2px dashed rgba(255,255,255,.25)" : "2px solid rgba(0,0,0,.4)",
      boxShadow: k == null ? "none" : "inset -3px -4px 0 rgba(0,0,0,.25), inset 3px 3px 0 rgba(255,255,255,.3)", boxSizing:"border-box" }}/>
  );
}
function MmScore({ s }) {
  const pins = [...Array(s.black).fill("b"), ...Array(s.white).fill("w")];
  while (pins.length < 4) pins.push(null);
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 11px)", gap:3 }} aria-label={`${s.black} bien placées, ${s.white} mal placées`}>
      {pins.map((p, i) => <span key={i} style={{ width:11, height:11, borderRadius:"50%", boxSizing:"border-box",
        background: p === "b" ? "#0a0a0a" : p === "w" ? "#fff" : "rgba(255,255,255,.12)", border: p === "b" ? "1px solid #999" : "none" }}/>)}
    </div>
  );
}

function Mastermind() {
  const [won, win] = useWin("mastermind");
  const [secret, setSecret] = useState(newSecret);
  const [rows, setRows] = useState([]);
  const [cur, setCur] = useState([null, null, null, null]);
  const later = useTimers();
  const found = rows.length > 0 && rows[rows.length - 1].score.black === 4;
  const lost = !found && rows.length >= MM_ROWS;

  const add = k => {
    if (found || lost) return;
    const i = cur.indexOf(null);
    if (i < 0) return;
    setCur(c => c.map((x, j) => (j === i ? k : x)));
    beep(350 + k * 70, .06, "triangle", .05);
  };
  const submit = () => {
    if (cur.includes(null) || found || lost) return;
    const score = mmScore(cur, secret);
    setRows(r => [...r, { g:cur, score }]);
    setCur([null, null, null, null]);
    if (score.black === 4) { beep(880, .15); later(() => beep(1320, .3), 150); win(); }
  };
  const restart = () => { setSecret(newSecret()); setRows([]); setCur([null, null, null, null]); };
  useKeyDown(e => {
    if (/^[1-6]$/.test(e.key)) add(Number(e.key) - 1);
    else if (e.key === "Backspace") {
      let i = 3;
      while (i >= 0 && cur[i] == null) i--;
      if (i >= 0) setCur(c => c.map((x, j) => (j === i ? null : x)));
    } else if (e.key === "Enter") submit();
  });

  return (
    <Stage won={won} wonText="Combinaison trouvée !" font={FONT}
      bg="linear-gradient(180deg, #3f2a14 0%, #241708 100%)">
      <Title color="#fde68a" sub="L'AMS a chargé 4 filaments en secret (une couleur peut revenir). Tu as 10 essais pour retrouver l'ordre.">Le mastermind</Title>
      <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:4, padding:"10px 12px", borderRadius:14, position:"relative", zIndex:2,
        background:"linear-gradient(180deg, #6b4423, #4a2d16)", boxShadow:"0 14px 30px rgba(0,0,0,.5)" }}>
        {Array.from({ length: MM_ROWS }, (_, i) => {
          const row = rows[i];
          const isCur = i === rows.length && !found && !lost;
          const g = row ? row.g : isCur ? cur : [null, null, null, null];
          return (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8, opacity: row || isCur ? 1 : .35,
              background: isCur ? "rgba(255,255,255,.12)" : "transparent", borderRadius:8, padding:"2px 6px" }}>
              <span style={{ width:18, fontSize:11, color:"#fde68a", fontFamily:MONO }}>{i + 1}</span>
              {g.map((k, j) => <Peg key={j} k={k} size={26}
                onClick={isCur && k != null ? () => setCur(c => c.map((x, jj) => (jj === j ? null : x))) : undefined}/>)}
              <div style={{ width:28, display:"flex", justifyContent:"center" }}>{row && <MmScore s={row.score}/>}</div>
            </div>
          );
        })}
      </div>
      {!found && !lost && <>
        <div style={{ display:"flex", gap:5, marginTop:12, flexWrap:"wrap", justifyContent:"center", position:"relative", zIndex:2 }}>
          {FILS.map((f, k) => (
            <button key={k} onClick={() => add(k)} aria-label={f.n} title={f.n}
              style={{ background:"rgba(0,0,0,.25)", border:"1px solid rgba(255,255,255,.15)", borderRadius:12, padding:3, cursor:"pointer" }}>
              <Spool color={f.c} size={40}/>
            </button>
          ))}
        </div>
        <div style={{ marginTop:10, position:"relative", zIndex:2 }}>
          <Btn color={cur.includes(null) ? "#57534e" : "#b45309"} onClick={submit} disabled={cur.includes(null)}>Charger dans l'AMS</Btn>
        </div>
      </>}
      {lost && (
        <div style={{ marginTop:12, textAlign:"center", position:"relative", zIndex:2 }}>
          <div style={{ color:"#fca5a5", fontWeight:700 }}>Raté ! La combinaison était :</div>
          <div style={{ display:"flex", gap:6, justifyContent:"center", margin:"8px 0" }}>{secret.map((k, i) => <Peg key={i} k={k}/>)}</div>
          <Btn color="#b45309" onClick={restart}>Nouvelle partie</Btn>
        </div>
      )}
      <Hint style={{ color:"#fde68a" }}>Pion noir : bonne couleur, bien placée. Pion blanc : bonne couleur, mauvaise place. Touche un pion posé pour le retirer.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 7. hanoi : les cinq bobines                                         */
/* ------------------------------------------------------------------ */

const HANOI_N = 5;
const HANOI_COL = ["#a855f7", "#3b82f6", "#22c55e", "#f97316", "#ef4444"];
const hanoiStart = () => [[5, 4, 3, 2, 1], [], []];

function Hanoi() {
  const [won, win] = useWin("hanoi");
  const [pegs, setPegs] = useState(hanoiStart);
  const [sel, setSel] = useState(null);
  const [moves, setMoves] = useState(0);
  const [bad, setBad] = useState(null);
  const later = useTimers();

  const click = i => {
    if (won) return;
    if (sel == null) {
      if (pegs[i].length) { setSel(i); beep(500, .05, "triangle", .05); }
      return;
    }
    if (sel === i) { setSel(null); return; }
    const from = pegs[sel], to = pegs[i];
    const disk = from[from.length - 1];
    if (to.length && to[to.length - 1] < disk) {
      setBad(i); beep(140, .25, "sawtooth", .06);
      later(() => setBad(null), 500);
      return;
    }
    const n = pegs.map(p => p.slice());
    n[i].push(n[sel].pop());
    setPegs(n); setSel(null); setMoves(m => m + 1);
    beep(380 + disk * 60, .08, "triangle", .06);
    if (n[2].length === HANOI_N) win();
  };
  useKeyDown(e => { if (/^[1-3]$/.test(e.key)) click(Number(e.key) - 1); });

  return (
    <Stage won={won} wonText={`Pile déplacée en ${moves} coups !`} font={FONT}
      bg="linear-gradient(180deg, #1e1b4b 0%, #111827 100%)">
      <style>{DF_CSS}</style>
      <Title color="#e0e7ff" sub="Fais passer toute la pile sur le porte-bobine de droite. Une bobine à la fois, jamais une grosse sur une petite.">Les tours de Hanoï</Title>
      <div style={{ marginTop:10, color:"#c7d2fe", fontSize:14, position:"relative", zIndex:2 }}>
        Coups : <b>{moves}</b> <span style={{ opacity:.65 }}>(le minimum possible : 31)</span>
      </div>
      <div style={{ marginTop:18, display:"flex", gap:8, width:"min(100%, 470px)", position:"relative", zIndex:2 }}>
        {pegs.map((p, i) => (
          <div key={i} onClick={() => click(i)} role="button" aria-label={`Porte-bobine ${i + 1}`}
            style={{ flex:1, minWidth:0, height:230, position:"relative", cursor:"pointer", borderRadius:12,
              background: sel === i ? "rgba(165,180,252,.16)" : "rgba(255,255,255,.04)",
              animation: bad === i ? "df-shake .45s ease" : "none", outline: bad === i ? "2px solid #ef4444" : "none" }}>
            <div style={{ position:"absolute", left:"50%", bottom:14, width:10, height:190, marginLeft:-5, borderRadius:5,
              background:"linear-gradient(90deg, #9ca3af, #e5e7eb, #6b7280)" }}/>
            <div style={{ position:"absolute", left:6, right:6, bottom:4, height:12, borderRadius:6, background:"#4b5563" }}/>
            {p.map((d, k) => {
              const lifted = sel === i && k === p.length - 1;
              return (
                <div key={d} style={{ position:"absolute", left:"50%", bottom: 16 + k * 30 + (lifted ? 18 : 0), width:`${26 + d * 14}%`, height:28,
                  transform:"translateX(-50%)", transition:"bottom .15s", display:"flex", alignItems:"stretch",
                  filter: lifted ? "drop-shadow(0 0 8px rgba(255,255,255,.5))" : "none" }}>
                  <span style={{ width:6, background:"#1f2937", borderRadius:"3px 0 0 3px" }}/>
                  <span style={{ flex:1, background:`repeating-linear-gradient(90deg, ${HANOI_COL[d - 1]} 0 4px, rgba(0,0,0,.12) 4px 5px)`,
                    boxShadow:"inset 0 4px 0 rgba(255,255,255,.3), inset 0 -4px 0 rgba(0,0,0,.25)" }}/>
                  <span style={{ width:6, background:"#1f2937", borderRadius:"0 3px 3px 0" }}/>
                </div>
              );
            })}
            <span style={{ position:"absolute", bottom:-22, left:0, right:0, textAlign:"center", color:"#a5b4fc", fontSize:12 }}>{i + 1}</span>
          </div>
        ))}
      </div>
      <Hint style={{ marginTop:30, color:"#c7d2fe" }}>Touche un porte-bobine pour prendre la bobine du dessus, puis un autre pour la poser. Au clavier : 1, 2, 3.</Hint>
      {!won && moves > 0 && <Btn color="#3730a3" style={{ marginTop:10, position:"relative", zIndex:2 }}
        onClick={() => { setPegs(hanoiStart()); setSel(null); setMoves(0); }}>Recommencer</Btn>}
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 8. dactylo : soixante secondes au clavier                          */
/* ------------------------------------------------------------------ */

const DACTYLO_PHRASES = [
  "la premiere couche fait toute la difference",
  "nettoie le plateau avant chaque impression",
  "une buse bouchee ne se repare pas en criant",
  "le filament humide craque comme du pop corn",
  "garde toujours une bobine de secours",
  "les supports se retirent mieux a froid",
  "un benchy par jour eloigne le docteur",
  "la retraction evite les fils entre les pieces",
  "calibre le debit avant de changer de marque",
  "le chat dort sur la seule zone chaude",
  "imprime lentement et tu iras plus vite",
  "le gyroide est joli mais il prend son temps",
];
const DUR = 60;
const shuffled = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(p => p[1]);

function Dactylo() {
  const [won, win] = useWin("dactylo");
  const coarse = useMemo(() => !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches), []);
  const goal = coarse ? 22 : 30;
  const [order, setOrder] = useState(() => shuffled(DACTYLO_PHRASES));
  const [idx, setIdx] = useState(0);
  const [val, setVal] = useState("");
  const [startAt, setStartAt] = useState(null);
  const [now, setNow] = useState(0);
  const [over, setOver] = useState(false);
  const stats = useRef({ keys:0, good:0, doneChars:0 });
  const inputRef = useRef(null);
  const later = useTimers();

  useEffect(() => {
    if (startAt == null || over) return undefined;
    const id = setInterval(() => {
      const t = (performance.now() - startAt) / 1000;
      setNow(t);
      if (t >= DUR) setOver(true);
    }, 150);
    return () => clearInterval(id);
  }, [startAt, over]);

  const phrase = order[idx % order.length];
  const goodInCurrent = [...val].filter((ch, i) => sameChar(ch, phrase[i])).length;
  const correctChars = stats.current.doneChars + goodInCurrent;
  const elapsed = Math.min(DUR, startAt == null ? 0 : now);
  const wpm = elapsed > 3 ? Math.round(correctChars / 5 / (elapsed / 60)) : 0;
  const acc = stats.current.keys ? Math.round(stats.current.good / stats.current.keys * 1000) / 10 : 100;
  const finalWpm = Math.round(correctChars / 5 / (DUR / 60));

  useEffect(() => {
    if (over && finalWpm >= goal && acc >= 95) win();
  }, [over]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = e => {
    if (over) return;
    let v = e.target.value;
    if (startAt == null && v.length) setStartAt(performance.now());
    if (v.length > val.length) {
      for (let i = val.length; i < v.length && i < phrase.length; i++) {
        stats.current.keys++;
        if (sameChar(v[i], phrase[i])) stats.current.good++;
      }
    }
    if (v.length >= phrase.length) {
      v = v.slice(0, phrase.length);
      stats.current.doneChars += [...v].filter((ch, i) => sameChar(ch, phrase[i])).length + 1; // + l'espace entre deux phrases
      setIdx(i => i + 1);
      setVal("");
      return;
    }
    setVal(v);
  };
  const restart = () => {
    stats.current = { keys:0, good:0, doneChars:0 };
    setOrder(shuffled(DACTYLO_PHRASES));
    setIdx(0); setVal(""); setStartAt(null); setNow(0); setOver(false);
    later(() => inputRef.current && inputRef.current.focus(), 50);
  };

  const left = Math.max(0, Math.ceil(DUR - elapsed));
  return (
    <Stage won={won} wonText={`${finalWpm} mots/min à ${acc} % !`} font={FONT}
      bg="linear-gradient(180deg, #052e16 0%, #0a1f14 100%)">
      <style>{DF_CSS}</style>
      <Title color="#bbf7d0" sub={`Recopie les phrases de l'atelier. Objectif : ${goal} mots/min et 95 % de précision en ${DUR} secondes.`}>La dactylo</Title>
      <div style={{ marginTop:14, display:"flex", gap:14, fontFamily:MONO, color:"#86efac", fontSize:15, position:"relative", zIndex:2,
        flexWrap:"wrap", justifyContent:"center" }}>
        <span>⏱ <b style={{ color: left <= 10 && startAt ? "#fca5a5" : "#dcfce7" }}>{left} s</b></span>
        <span>⚡ <b style={{ color:"#dcfce7" }}>{wpm}</b> mots/min</span>
        <span>🎯 <b style={{ color:"#dcfce7" }}>{acc}</b> %</span>
      </div>
      <div onClick={() => inputRef.current && inputRef.current.focus()}
        style={{ marginTop:14, width:"min(100%, 560px)", boxSizing:"border-box", padding:"14px 14px", borderRadius:14, background:"#0b1a10",
          position:"relative", zIndex:2, border:"2px solid #166534", fontFamily:MONO, whiteSpace:"pre-wrap", wordBreak:"break-word", fontSize:"clamp(16px, 4.4vw, 20px)", lineHeight:1.5,
          minHeight:70, cursor:"text" }}>
        {[...phrase].map((ch, i) => {
          const t = val[i];
          const st = t == null ? "todo" : sameChar(t, ch) ? "ok" : "ko";
          return <span key={i} style={{ color: st === "ok" ? "#4ade80" : st === "ko" ? "#fff" : "#7fa88b",
            background: st === "ko" ? "#b91c1c" : i === val.length && !over ? "rgba(74,222,128,.28)" : "transparent",
            borderRadius:2 }}>{ch}</span>;
        })}
        <div style={{ marginTop:8, fontSize:"0.72em", color:"#4b7a5b" }}>ensuite : {order[(idx + 1) % order.length]}</div>
      </div>
      <input ref={inputRef} value={val} onChange={onChange} disabled={over} autoComplete="off" autoCorrect="off" autoCapitalize="off"
        spellCheck={false} onPaste={e => e.preventDefault()} onDrop={e => e.preventDefault()} aria-label="Zone de frappe"
        placeholder={startAt == null ? "Tape ici : le chrono part tout seul" : ""}
        style={{ marginTop:12, width:"min(100%, 560px)", boxSizing:"border-box", padding:"12px 14px", borderRadius:12, fontSize:17,
          border:"2px solid #22c55e", background:"#03140a", color:"#dcfce7", fontFamily:MONO, outline:"none", position:"relative", zIndex:2 }}/>
      {over && (
        <div style={{ marginTop:14, textAlign:"center", position:"relative", zIndex:2, animation:"df-in .4s ease" }}>
          <div style={{ fontSize:18, fontWeight:800, color: won ? "#4ade80" : "#fca5a5" }}>
            {finalWpm} mots/min · {acc} % de précision
          </div>
          <div style={{ fontSize:13, color:"#bbf7d0", margin:"6px 0 10px" }}>
            {finalWpm >= goal && acc >= 95 ? "Tu tapes plus vite qu'une buse en mode ludique." : finalWpm < goal ? "Encore un peu de vitesse !" : "Rapide, mais trop de fautes."}
          </div>
          <Btn color="#15803d" onClick={restart}>Rejouer</Btn>
        </div>
      )}
      <Hint style={{ color:"#bbf7d0" }}>Ni accents ni majuscules à taper. Un mot = 5 caractères justes ; les fautes corrigées comptent quand même.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* 9. enigme : la chaine des cinq (DIFFICILE)                          */
/* ------------------------------------------------------------------ */

const bare = a => a.replace(/^(le |la |les |l')/, "").replace(/[\s.!]/g, "");
const ENIGMES = [
  {
    kind:"Devinette",
    body:<>Je suis fait de vide autant que de matière.<br/>On me règle en pour cent ; parfois je prends la forme des abeilles.<br/>
      Sans moi, tout s'effondre ; et pourtant, la pièce finie, plus personne ne me voit jamais.<br/><i>Qui suis-je ?</i></>,
    ok:a => ["remplissage", "infill"].includes(bare(a)),
  },
  {
    kind:"Rébus",
    body:<><span style={{ fontSize:46, letterSpacing:".1em" }}>🍽️ + 💧</span><br/>Lis-le à voix haute : c'est là que tout commence.</>,
    ok:a => ["plateau", "plateaux"].includes(bare(a)),
  },
  {
    kind:"Suite logique",
    body:<><span style={{ fontSize:"clamp(22px, 7vw, 30px)", fontFamily:MONO, letterSpacing:".16em" }}>U D T Q C S S ?</span><br/>Quelle lettre vient ensuite ?</>,
    ok:a => bare(a) === "h",
  },
  {
    kind:"Anagramme",
    body:<><span style={{ fontSize:"clamp(22px, 7vw, 28px)", fontFamily:MONO, letterSpacing:".12em" }}>CITRON RATÉ</span><br/>
      Remets toutes ces lettres dans l'ordre : un seul mot, un réglage du trancheur qui chasse les fils d'ange.</>,
    ok:a => bare(a) === "retraction",
  },
  {
    kind:"Calcul · une erreur et tu redescends à la 3ᵉ",
    body:<>Une bobine contient <b>1 kg</b> de PLA, de masse volumique <b>1,24 g/cm³</b>.<br/>
      Le fil fait <b>1,75 mm</b> de diamètre.<br/><i>Combien de mètres de fil y a-t-il sur la bobine ? Arrondis au mètre.</i></>,
    ok:a => {
      const n = parseFloat(a.replace(",", ".").replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) && Math.round(n) >= 334 && Math.round(n) <= 336;
    },
    numeric:true,
  },
];

function Enigme() {
  const [won, win] = useWin("enigme");
  const [step, setStep] = useState(0);
  const [bad, setBad] = useState(0);
  const [msg, setMsg] = useState("");
  const later = useTimers();
  const e = ENIGMES[Math.min(step, ENIGMES.length - 1)];

  const submit = v => {
    if (won) return;
    if (e.ok(norm(v))) {
      beep(700 + step * 120, .15);
      if (step === ENIGMES.length - 1) { setStep(ENIGMES.length); setMsg(""); win(); return; }
      setStep(s => s + 1);
      setMsg("Juste ! La porte suivante s'ouvre…");
      return;
    }
    beep(150, .3, "sawtooth", .06);
    setBad(b => b + 1);
    later(() => setBad(0), 500);
    if (step === ENIGMES.length - 1) {
      setStep(2);
      setMsg("Raté ! La dernière épreuve est sans pitié : retour à la troisième.");
    } else setMsg("Non… relis bien, chaque mot compte.");
  };

  return (
    <Stage won={won} wonText="Les cinq énigmes sont tombées !" font={FONT}
      bg="radial-gradient(ellipse at 50% 0%, #312e81 0%, #1e1b4b 45%, #0b0a1f 100%)">
      <style>{DF_CSS}</style>
      <Title color="#c7d2fe" sub="Cinq énigmes enchaînées. Chaque réponse ouvre la suivante.">La chaîne des énigmes</Title>
      <div style={{ display:"flex", gap:8, marginTop:14, position:"relative", zIndex:2 }} aria-label={`Énigme ${Math.min(step + 1, 5)} sur 5`}>
        {ENIGMES.map((_, i) => (
          <span key={i} style={{ width:34, height:34, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center",
            fontWeight:800, fontSize:14, background: i < step ? "#22c55e" : i === step ? "#6366f1" : "rgba(255,255,255,.08)",
            color:"#fff", border: i === step ? "2px solid #c7d2fe" : "2px solid transparent" }}>{i < step ? "✓" : i + 1}</span>
        ))}
      </div>
      {step < ENIGMES.length ? (
        <div key={"carte" + step} style={{ marginTop:18, width:"min(100%, 460px)", boxSizing:"border-box", padding:"16px 18px", borderRadius:16,
          background:"rgba(15,14,40,.85)", border:"1px solid rgba(199,210,254,.25)", color:"#e0e7ff", textAlign:"center", lineHeight:1.55,
          fontSize:"clamp(14px, 3.8vw, 16px)", position:"relative", zIndex:2, animation:"df-in .4s ease" }}>
          <div style={{ fontSize:12, textTransform:"uppercase", letterSpacing:".1em", color:"#a5b4fc", marginBottom:8 }}>
            {step + 1}. {e.kind}
          </div>
          {e.body}
        </div>
      ) : (
        <div style={{ marginTop:18, fontSize:60, animation:"df-in .5s ease" }}>🗝️</div>
      )}
      {step < ENIGMES.length && <AnswerBox key={"rep" + step} onSubmit={submit} bad={bad} color="#4f46e5" inputMode={e.numeric ? "decimal" : undefined}/>}
      {msg && <Hint style={{ color: msg.startsWith("Juste") ? "#86efac" : "#fca5a5", opacity:1 }}>{msg}</Hint>}
      <Hint style={{ color:"#a5b4fc" }}>Majuscules et accents ne comptent pas. Un seul mot, ou un nombre.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ */

export const PAGES = {
  "radio": Radio,
  "cryptex": Cryptex,
  "sudoku": Sudoku,
  "laser": Laser,
  "nonogramme": Nonogramme,
  "mastermind": Mastermind,
  "hanoi": Hanoi,
  "dactylo": Dactylo,
  "enigme": Enigme,
};
