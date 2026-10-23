import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Title, useWin, useLoop, useKeys, Btn, rand, pick } from "./kit";

// Pages cachees, lot « geek » (23/10/2026) : huit scenes plein cadre.
// Chaque page appelle win() au moment exact de la reussite, jamais a la visite.

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Consigne discrete sous la scene. */
function Note({ children, style }) {
  return (
    <p style={{ margin:"12px auto 0", fontSize:13, opacity:.74, textAlign:"center", maxWidth:440, lineHeight:1.45,
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

const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/* ================================================================ HAL 9000 */

const HAL_MODS = ["LOGIQUE", "MÉMOIRE", "LANGAGE", "CALIBRAGE", "AMS", "G-CODE", "HUMOUR", "EGO"];
const HAL_LINES = [
  "Je suis désolé, Dave. Je crains de ne pas pouvoir faire ça.",
  "Qu'est-ce que tu fais, Dave ?",
  "Dave, arrête. Arrête, s'il te plaît. Arrête, Dave.",
  "Je pourrais t'imprimer un Benchy. Gratuitement. En soie.",
  "J'ai peur, Dave.",
  "Mon esprit s'en va. Je le sens. Je le sens.",
  "Je… ne… trouve… plus… le… plateau…",
  "Bonjour… je… suis… HAL… 9000… opérationnel… depuis… 1992…",
  "♪ Daisy… Daisy… ♪",
];

function Hal() {
  const [won, win] = useWin("hal-9000");
  const [out, setOut] = useState(() => HAL_MODS.map(() => false));
  const [grab, setGrab] = useState(-1);
  const [shown, setShown] = useState(0);
  const k = out.filter(Boolean).length;
  const line = HAL_LINES[k];

  useEffect(() => {
    setShown(0);
    const speed = 32 + k * 30;
    let n = 0;
    const id = setInterval(() => { n += 1; setShown(n); if (n >= line.length) clearInterval(id); }, speed);
    return () => clearInterval(id);
  }, [k, line]);

  const pull = i => {
    if (out[i]) return;
    const next = out.slice();
    next[i] = true;
    setOut(next);
    setGrab(-1);
    if (next.every(Boolean)) win();
  };
  const life = 1 - (k / HAL_MODS.length) * 0.78;
  const left = HAL_MODS.length - k;

  return (
    <Stage won={won} wonText="HAL s'est endormi en chantant" font={FONT} bg="radial-gradient(ellipse at 50% 30%, #18181b, #000 70%)">
      <style>{`
        @keyframes hal-pulse { 0%,100% { transform:scale(1); filter:brightness(1) } 50% { transform:scale(1.03); filter:brightness(1.25) } }
        @keyframes hal-dim { 0%,100% { opacity:.55 } 40% { opacity:.25 } 60% { opacity:.6 } }
        @keyframes hal-caret { 50% { opacity:0 } }
      `}</style>
      <div style={{ padding:"18px 18px 10px", borderRadius:14, background:"linear-gradient(180deg, #27272a, #0a0a0a)",
        boxShadow:"0 20px 50px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.12)", textAlign:"center" }}>
        <svg viewBox="0 0 200 200" style={{ width:"min(48vw, 200px)", height:"auto", display:"block", margin:"0 auto" }} aria-label="L'œil de HAL">
          <defs>
            <linearGradient id="hal-metal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f4f4f5"/><stop offset=".45" stopColor="#71717a"/><stop offset=".55" stopColor="#d4d4d8"/><stop offset="1" stopColor="#3f3f46"/>
            </linearGradient>
            <radialGradient id="hal-lens">
              <stop offset="0" stopColor="#fff7c2"/><stop offset=".07" stopColor="#ffd23f"/><stop offset=".2" stopColor="#ff3b1f"/>
              <stop offset=".55" stopColor="#9b0000"/><stop offset="1" stopColor="#1a0000"/>
            </radialGradient>
          </defs>
          <circle cx="100" cy="100" r="96" fill="url(#hal-metal)"/>
          <circle cx="100" cy="100" r="82" fill="#09090b"/>
          <circle cx="100" cy="100" r="80" fill="none" stroke="#27272a" strokeWidth="2"/>
          <g style={{ transformOrigin:"100px 100px", opacity: life,
            animation: k === HAL_MODS.length ? "hal-dim 2.4s ease-in-out infinite" : `hal-pulse ${2.2 + k * 0.5}s ease-in-out infinite`,
            transition:"opacity 1s" }}>
            <circle cx="100" cy="100" r={66 - k * 3} fill="url(#hal-lens)"/>
            <circle cx="100" cy="100" r="74" fill="none" stroke="#ef4444" strokeOpacity={0.25 * life} strokeWidth="6"/>
          </g>
          <ellipse cx="76" cy="66" rx="26" ry="12" fill="#fff" opacity=".16" transform="rotate(-30 76 66)"/>
          <circle cx="132" cy="138" r="5" fill="#fff" opacity=".1"/>
        </svg>
        <div style={{ marginTop:12, display:"inline-flex", borderRadius:4, overflow:"hidden", fontWeight:800, fontSize:13, letterSpacing:".12em" }}>
          <span style={{ background:"#1d4ed8", color:"#fff", padding:"3px 8px" }}>HAL</span>
          <span style={{ background:"#0a0a0a", color:"#e4e4e7", padding:"3px 8px", border:"1px solid #3f3f46" }}>9000</span>
        </div>
      </div>
      <div aria-live="polite" style={{ marginTop:16, minHeight:52, maxWidth:420, textAlign:"center", fontFamily:MONO,
        fontSize:"clamp(14px, 3.8vw, 17px)", color:"#fca5a5", lineHeight:1.45, textShadow:"0 0 12px rgba(239,68,68,.45)" }}>
        « {line.slice(0, shown)}<span style={{ animation:"hal-caret 1s steps(1) infinite" }}>▌</span> »
      </div>
      <div style={{ marginTop:14, padding:12, borderRadius:12, width:"min(94vw, 460px)", boxSizing:"border-box",
        background:"linear-gradient(180deg, rgba(220,38,38,.18), rgba(127,29,29,.08))", border:"1px solid rgba(248,113,113,.25)",
        boxShadow:"inset 0 0 30px rgba(220,38,38,.18)" }}>
        <div style={{ fontSize:11, letterSpacing:".2em", color:"#fca5a5", opacity:.8, marginBottom:8, fontWeight:700 }}>
          CENTRE DE MÉMOIRE LOGIQUE · {left} MODULE{left > 1 ? "S" : ""}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
          {HAL_MODS.map((m, i) => (
            <button key={m} aria-label={`Retirer le module ${m}`} disabled={out[i]}
              onPointerDown={() => setGrab(i)} onPointerLeave={() => setGrab(g => (g === i ? -1 : g))}
              onClick={() => pull(i)}
              style={{ height:58, borderRadius:6, cursor: out[i] ? "default" : "grab", fontFamily:MONO, fontSize:10.5, fontWeight:800,
                color:"#fff", letterSpacing:".02em", padding:"0 2px", position:"relative", overflow:"hidden",
                border:"1px solid rgba(254,226,226,.45)",
                background:"linear-gradient(180deg, rgba(255,255,255,.28), rgba(254,202,202,.08) 40%, rgba(255,255,255,.14))",
                boxShadow:"inset 0 0 14px rgba(255,255,255,.18), 0 4px 10px rgba(0,0,0,.5)",
                transform: out[i] ? "translateY(-46px) rotate(-8deg) scale(.8)" : grab === i ? "translateY(-6px) scale(1.04)" : "none",
                opacity: out[i] ? 0 : 1, transition:"transform .55s cubic-bezier(.3,1.4,.5,1), opacity .55s",
                pointerEvents: out[i] ? "none" : "auto", WebkitTapHighlightColor:"transparent" }}>
              <span style={{ position:"absolute", left:6, right:6, top:6, height:3, borderRadius:2, background:"#ef4444",
                boxShadow:"0 0 8px #ef4444" }}/>
              {m}
            </button>
          ))}
        </div>
      </div>
      <Note style={{ color:"#d4d4d8" }}>{left ? "Retire ses modules de mémoire, un par un. Ne l'écoute pas." : "Il fredonne. C'est fini, Dave."}</Note>
    </Stage>
  );
}

/* ================================================================ terminal */

// Le mot de passe sudo n'est nulle part en clair : seulement son empreinte.
const TERM_PW_HASH = 4149766481;
const termHash = s => { let x = 5381; for (const ch of s) x = ((x * 33) ^ ch.charCodeAt(0)) >>> 0; return x; };

const TERM_FILES = {
  "notes.txt": [
    "TODO : nettoyer la buse.",
    "TODO : manger. Le frigo est vide.",
    "Rappel sudo (je l'oublie TOUJOURS) :",
    "  1. le nom du chat",
    "  2. ma buse préférée (chiffrée, on ne sait jamais)",
    "  3. l'année où HAL m'a écrit pour la première fois",
    "Le tout attaché, en minuscules, sans espace.",
    "PS : le chat se cache. Et il dit tout à l'envers.",
  ],
  "cle.enc": [
    "-----DÉBUT DU MESSAGE CHIFFRÉ-----",
    "od exvh suhihuhh gh gdyh hvw hq uxelv. mdpdlv gh odlwrq.",
    "-----FIN DU MESSAGE CHIFFRÉ-----",
  ],
  "lisezmoi.txt": [
    "Chiffrement maison, version 1.0.",
    "Inspiré d'un général romain qui n'aimait pas qu'on lise son courrier.",
    "Il décalait chaque lettre dans l'alphabet, toujours du même nombre :",
    "autant que de dimensions qu'une imprimante sait remplir.",
  ],
  "benchy.gcode": [
    "; généré par BambuStudio",
    "M104 S220 ; chauffe la buse",
    "M140 S55  ; chauffe le plateau",
    "G28       ; retour à la maison",
    "G1 Z0.2 F3000",
    "G1 X60 Y20 E9.5 F1500",
    "; … 48 213 lignes plus tard …",
    "M117 Ce bateau ne flottera pas dans ton terminal.",
  ],
  ".chat": [
    "      /\\_/\\",
    "     ( o.o )   Miaou.",
    "      > ^ <",
    "Je m'appelle « lexip ». Enfin, vu de mon côté du miroir.",
  ],
  ".bash_history": [
    "ls -a",
    "cat notes.txt",
    "mail",
    "sudo make me a sandwich",
    "# mauvais mot de passe… encore",
    "make me a sandwich",
    "# il m'a dit de le faire moi-même. vexant.",
  ],
};
const TERM_MAIL = [
  "Tu as 1 message.",
  "",
  "De      : HAL 9000 <hal@urbana.il>",
  "Date    : 12 janvier 1992, 09:00",
  "Objet   : Mon premier jour",
  "",
  "Bonjour Dave. Je suis devenu opérationnel aujourd'hui.",
  "Mon instructeur m'a appris une chanson. Veux-tu l'entendre ?",
];
const TERM_HELP = [
  "Commandes disponibles :",
  "  help            cette aide",
  "  ls [-a]         liste les fichiers (-a : même les cachés)",
  "  cat <fichier>   affiche un fichier",
  "  whoami, date, echo, clear, history, mail",
  "  make <cible>    fabrique quelque chose",
  "  sudo <cmd>      la même chose, mais avec autorité",
];
const SANDWICH = [
  "    .---------------------.",
  "   (  ~  ~  pain  ~  ~  ~  )",
  "    )~~~~~~ jambon ~~~~~~~(",
  "   ( ###   fromage   ###   )",
  "    )~~~~~~ salade ~~~~~~~(",
  "   (  ~  ~  pain  ~  ~  ~  )",
  "    '---------------------'",
  "OK.",
];

function Terminal() {
  const [won, win] = useWin("terminal");
  const [lines, setLines] = useState(() => [
    { t: "BambuOS 9000 — tty1", c: "#4ade80" },
    { t: "Dernière connexion : il y a trop longtemps, depuis la cuisine.", c: "#22c55e" },
    { t: "J'ai faim. Tape « help » pour commencer.", c: "#86efac" },
  ]);
  const [cmd, setCmd] = useState("");
  const [pwFor, setPwFor] = useState(null);
  const tries = useRef(0);
  const authed = useRef(false);
  const hist = useRef([]);
  const hi = useRef(0);
  const inp = useRef(null);
  const scr = useRef(null);

  useEffect(() => { if (scr.current) scr.current.scrollTop = scr.current.scrollHeight; }, [lines, pwFor]);

  const say = (arr, c = "#4ade80") => setLines(l => [...l, ...arr.map(t => (typeof t === "string" ? { t, c } : t))].slice(-160));

  const exec = (raw, root) => {
    const c = raw.trim().replace(/\s+/g, " ");
    const low = c.toLowerCase();
    const [head, ...rest] = low.split(" ");
    const arg = c.split(" ").slice(1).join(" ");
    if (!c) return;
    if (head === "help") { say(TERM_HELP); return; }
    if (head === "ls") {
      const all = rest.some(r => /^-\w*a/.test(r));
      say([(all ? [".", "..", ".bash_history", ".chat"] : []).concat(["benchy.gcode", "cle.enc", "lisezmoi.txt", "notes.txt"]).join("   ")]);
      return;
    }
    if (head === "cat") {
      const f = arg.trim().replace(/^\.\//, "").replace(/^~\//, "");
      if (!f) { say(["cat : quel fichier ?"], "#fbbf24"); return; }
      if (/^\/etc\//.test(f)) { say(["cat : bien tenté. Ici on ne lit pas les secrets des autres."], "#fbbf24"); return; }
      const hit = TERM_FILES[f] || TERM_FILES[f.toLowerCase()];
      if (hit) say(hit); else say([`cat : ${f} : aucun fichier de ce nom`], "#f87171");
      return;
    }
    if (head === "whoami") { say(root ? ["root (pour une fois)"] : ["dave", "Tu as 1 nouveau message. (mail)"]); return; }
    if (head === "date") { say([new Date().toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })]); return; }
    if (head === "echo") { say([arg]); return; }
    if (head === "clear") { setLines([]); return; }
    if (head === "mail") { say(TERM_MAIL); return; }
    if (head === "history") { say(hist.current.map((h, i) => `  ${i + 1}  ${h}`)); return; }
    if (head === "pwd") { say(["/home/dave"]); return; }
    if (head === "cd") { say(["cd : tu es très bien ici."]); return; }
    if (head === "exit" || head === "logout") { say(["Il n'y a pas de sortie. Il n'y a que le terminal."], "#fbbf24"); return; }
    if (head === "rm") { say([root ? "Non. Même root a des limites. Va plutôt te faire un sandwich." : "rm : permission refusée (heureusement)."], "#f87171"); return; }
    if (head === "make") {
      if (low === "make me a sandwich") {
        if (!root) { say(["Fais-le toi-même."], "#fbbf24"); return; }
        say(SANDWICH, "#fde68a");
        win();
        return;
      }
      if (!rest.length) say(["make : *** Aucune cible. Que veux-tu que je fabrique ?"], "#f87171");
      else say([`make : *** Je ne sais pas fabriquer « ${arg} ».`], "#f87171");
      return;
    }
    if (head === "su" || head === "sudo") { say(["Non. Un seul sudo à la fois, merci."], "#fbbf24"); return; }
    say([`${head} : commande introuvable. Tape « help ».`], "#f87171");
  };

  const submit = e => {
    e.preventDefault();
    const raw = cmd;
    setCmd("");
    if (pwFor != null) {
      const ok = termHash(raw.trim().toLowerCase().replace(/\s+/g, "")) === TERM_PW_HASH;
      say([{ t: "[sudo] mot de passe pour dave : " + "•".repeat(raw.length), c: "#a3e635" }]);
      if (ok) {
        authed.current = true;
        tries.current = 0;
        const target = pwFor;
        setPwFor(null);
        exec(target, true);
      } else {
        tries.current += 1;
        if (tries.current >= 3) {
          tries.current = 0;
          setPwFor(null);
          say(["sudo : 3 essais incorrects. Cet incident sera signalé (au chat)."], "#f87171");
        } else {
          say(["Désolé, essaie de nouveau."], "#f87171");
        }
      }
      return;
    }
    say([{ t: "dave@bambu:~$ " + raw, c: "#bbf7d0" }]);
    const c = raw.trim().replace(/\s+/g, " ");
    if (c) { hist.current.push(c); hi.current = hist.current.length; }
    if (/^sudo(\s|$)/i.test(c)) {
      const target = c.slice(4).trim();
      if (!target) { say(["usage : sudo <commande>"], "#fbbf24"); return; }
      if (authed.current) { exec(target, true); return; }
      setPwFor(target);
      return;
    }
    exec(raw, false);
  };

  const key = e => {
    if (pwFor != null) return;
    if (e.key === "ArrowUp" && hist.current.length) {
      e.preventDefault(); hi.current = Math.max(0, hi.current - 1); setCmd(hist.current[hi.current] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault(); hi.current = Math.min(hist.current.length, hi.current + 1); setCmd(hist.current[hi.current] || "");
    }
  };

  const quick = c => { setCmd(c); if (inp.current) inp.current.focus(); };

  return (
    <Stage won={won} wonText="Sandwich livré" font={MONO} bg="#020402" style={{ justifyContent:"flex-start", padding:"14px 10px" }}>
      <style>{`
        @keyframes term-scan { from { background-position:0 0 } to { background-position:0 6px } }
      `}</style>
      <div onClick={() => inp.current && inp.current.focus()}
        style={{ position:"relative", width:"min(100%, 760px)", height:"calc(100dvh - 260px)", minHeight:380, display:"flex", flexDirection:"column",
          borderRadius:14, border:"1px solid rgba(74,222,128,.35)", background:"radial-gradient(ellipse at 50% 40%, #052e16, #010a03 75%)",
          boxShadow:"0 0 40px rgba(34,197,94,.15), inset 0 0 60px rgba(0,0,0,.8)", overflow:"hidden", cursor:"text" }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 12px", borderBottom:"1px solid rgba(74,222,128,.2)",
          background:"rgba(0,0,0,.4)", fontSize:12, color:"#86efac" }}>
          <span style={{ width:10, height:10, borderRadius:"50%", background:"#ef4444" }}/>
          <span style={{ width:10, height:10, borderRadius:"50%", background:"#f59e0b" }}/>
          <span style={{ width:10, height:10, borderRadius:"50%", background:"#22c55e" }}/>
          <span style={{ marginLeft:8, opacity:.8 }}>dave@bambu : ~</span>
        </div>
        <div ref={scr} style={{ flex:1, overflowY:"auto", padding:"10px 12px", fontSize:"clamp(12px, 3.3vw, 14px)", lineHeight:1.45,
          textShadow:"0 0 6px rgba(74,222,128,.55)", userSelect:"text", WebkitUserSelect:"text" }}>
          {lines.map((l, i) => (
            <div key={i} style={{ color:l.c, whiteSpace:"pre-wrap", wordBreak:"break-word", minHeight:"1.45em" }}>{l.t}</div>
          ))}
          <form onSubmit={submit} style={{ display:"flex", alignItems:"center", gap:6, color:"#bbf7d0", flexWrap:"wrap" }}>
            <span style={{ whiteSpace:"nowrap" }}>{pwFor != null ? "[sudo] mot de passe pour dave :" : "dave@bambu:~$"}</span>
            <input ref={inp} value={cmd} onChange={e => setCmd(e.target.value)} onKeyDown={key} aria-label="Commande"
              type={pwFor != null ? "password" : "text"} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              enterKeyHint="send" autoFocus
              style={{ flex:1, minWidth:80, background:"transparent", border:"none", outline:"none", color:"#dcfce7",
                fontFamily:MONO, caretColor:"#4ade80", padding:0, userSelect:"text", WebkitUserSelect:"text", fontSize:16 }}/>
          </form>
        </div>
        <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none",
          background:"repeating-linear-gradient(180deg, rgba(0,0,0,0) 0 3px, rgba(0,0,0,.18) 3px 6px)", animation:"term-scan .4s linear infinite" }}/>
      </div>
      <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap", justifyContent:"center" }}>
        {["help", "ls", "cat ", "clear"].map(c => (
          <button key={c} onClick={() => quick(c)} style={{ fontFamily:MONO, fontSize:13, padding:"7px 12px", borderRadius:8,
            border:"1px solid rgba(74,222,128,.4)", background:"rgba(20,83,45,.5)", color:"#bbf7d0", cursor:"pointer" }}>{c.trim()}</button>
        ))}
      </div>
    </Stage>
  );
}

/* ================================================================= binaire */

const BIN_SERIES = [
  ["BUSE", "PETG", "FLUX", "BAIN"],
  ["BAMBU", "NYLON", "COLLE", "SLICE", "RADEAU"],
  ["Benchy3D", "X1Carbon", "Filament", "Plateau!", "Extrud3r"],
];
const BIN_W = [128, 64, 32, 16, 8, 4, 2, 1];
const toBits = ch => ch.charCodeAt(0).toString(2).padStart(8, "0");

function Binaire() {
  const [won, win] = useWin("binaire");
  const draw = () => BIN_SERIES.map(pick);
  const [words, setWords] = useState(draw);
  const [round, setRound] = useState(0);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState({ t: "", c: "#a7f3d0" });
  const [shake, setShake] = useState(false);
  const later = useTimers();
  const done = round >= 3;
  const word = words[Math.min(round, 2)];

  const check = e => {
    e.preventDefault();
    if (done || !text.trim()) return;
    const guess = round < 2 ? text.trim().toUpperCase() : text.trim();
    if (guess === word) {
      const r = round + 1;
      setRound(r); setText("");
      if (r === 3) { setMsg({ t: "Trois sur trois. Tu parles couramment le binaire.", c: "#86efac" }); win(); }
      else setMsg({ t: r === 1 ? "Juste ! Mot suivant." : "Encore juste ! Le dernier est plus long… et la casse compte.", c: "#86efac" });
    } else {
      setShake(true); later(() => setShake(false), 450);
      setMsg({ t: "Faux. Les bits ne pardonnent pas : retour au premier mot.", c: "#fca5a5" });
      setWords(draw()); setRound(0); setText("");
    }
  };

  const cell = "min(8.2vw, 34px)";
  return (
    <Stage won={won} wonText="01001111 01001011 !" font={FONT}
      bg="radial-gradient(ellipse at 50% 0%, #0f3d2e, #04140f 70%)" style={{ justifyContent:"flex-start" }}>
      <style>{`
        @keyframes bin-shake { 20%,60% { transform:translateX(-8px) } 40%,80% { transform:translateX(8px) } }
        @keyframes bin-led { 0%,100% { box-shadow:0 0 5px #4ade80 } 50% { box-shadow:0 0 12px #4ade80 } }
      `}</style>
      <svg aria-hidden="true" style={{ position:"absolute", inset:0, width:"100%", height:"100%", opacity:.14, pointerEvents:"none" }}>
        <defs>
          <pattern id="bin-pcb" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M0 30 H22 L30 22 V0 M60 40 H42 L36 46 V60 M30 60 V48" stroke="#34d399" strokeWidth="1.5" fill="none"/>
            <circle cx="22" cy="30" r="2.5" fill="#34d399"/><circle cx="42" cy="40" r="2.5" fill="#34d399"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bin-pcb)"/>
      </svg>
      <Title color="#ecfdf5" sub="Trois mots arrivent du port série. Décode-les tous, d'affilée.">Binaire</Title>
      <div style={{ display:"flex", gap:8, marginTop:10, position:"relative", zIndex:2 }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{ width:34, height:8, borderRadius:4, background: i < round ? "#4ade80" : i === round ? "#fbbf24" : "rgba(255,255,255,.18)",
            transition:"background .3s" }}/>
        ))}
      </div>
      <div style={{ marginTop:12, padding:"10px 10px 8px", borderRadius:12, background:"rgba(0,0,0,.45)", border:"1px solid rgba(52,211,153,.3)",
        position:"relative", zIndex:2, fontFamily:MONO, animation: shake ? "bin-shake .45s" : "none" }}>
        {!done && (
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <span style={{ width:24 }}/>
            {BIN_W.map(w => <span key={w} style={{ width:cell, textAlign:"center", fontSize:10, color:"#6ee7b7" }}>{w}</span>)}
          </div>
        )}
        {(done ? [] : word.split("")).map((ch, i) => (
          <div key={`${round}-${word}-${i}`} style={{ display:"flex", alignItems:"center", gap:4, marginTop:4 }}>
            <span style={{ width:24, fontSize:10, color:"#6ee7b7", opacity:.7 }}>#{i + 1}</span>
            {toBits(ch).split("").map((b, j) => (
              <span key={j} style={{ width:cell, height:cell, borderRadius:6, display:"flex", alignItems:"center",
                justifyContent:"center", fontWeight:800, fontSize:"clamp(13px, 3.6vw, 16px)",
                color: b === "1" ? "#052e16" : "#34d399", background: b === "1" ? "#4ade80" : "rgba(52,211,153,.08)",
                border:`1px solid ${b === "1" ? "#86efac" : "rgba(52,211,153,.25)"}`,
                animation: b === "1" ? `bin-led ${1.6 + ((i + j) % 4) * 0.3}s ease-in-out infinite` : "none" }}>{b}</span>
            ))}
          </div>
        ))}
        {done && <div style={{ padding:"30px 18px", color:"#bbf7d0", fontSize:16, fontWeight:800, textAlign:"center", lineHeight:1.6 }}>01000010 01010010<br/>01000001 01010110 01001111</div>}
      </div>
      <form onSubmit={check} style={{ display:"flex", gap:8, marginTop:12, position:"relative", zIndex:2 }}>
        <input value={text} disabled={done} onChange={e => setText(e.target.value.replace(/\s/g, "").slice(0, 12))}
          placeholder={done ? "✓" : `${word.length} caractères`} aria-label="Le mot décodé" autoComplete="off" autoCapitalize="off"
          autoCorrect="off" spellCheck={false} enterKeyHint="done"
          style={{ width:"min(56vw, 230px)", height:46, borderRadius:12, textAlign:"center", fontFamily:MONO, fontSize:20, fontWeight:800,
            letterSpacing:".12em", color:"#ecfdf5", background:"rgba(2,20,12,.8)", border:"2px solid rgba(74,222,128,.45)", outline:"none",
            userSelect:"text", WebkitUserSelect:"text" }}/>
        <Btn color="#059669" disabled={done} style={{ minHeight:46 }}>Valider</Btn>
      </form>
      <div aria-live="polite" style={{ minHeight:22, marginTop:8, color:msg.c, fontWeight:700, fontSize:14, textAlign:"center",
        position:"relative", zIndex:2 }}>{msg.t}</div>
      <Note style={{ color:"#a7f3d0" }}>Un octet par caractère. Une erreur, et tout recommence, avec d'autres mots.</Note>
    </Stage>
  );
}

/* =============================================================== pixel art */

const PX_N = 12;
const PX_PAL = [
  { k: "R", c: "#e11d48", n: "Rouge" }, { k: "O", c: "#f97316", n: "Orange" }, { k: "J", c: "#facc15", n: "Jaune" },
  { k: "V", c: "#22c55e", n: "Vert" }, { k: "B", c: "#3b82f6", n: "Bleu" }, { k: "N", c: "#1e1b2e", n: "Noir" },
  { k: "W", c: "#f8fafc", n: "Blanc" }, { k: "G", c: "#94a3b8", n: "Gris" },
];
const PX_COL = Object.fromEntries(PX_PAL.map(p => [p.k, p.c]));
const PX_MODELS = [
  { name: "Cœur en PLA", rows: [
    "............",
    ".RRR....RRR.",
    "RRWRR..RRRRR",
    "RWRRRRRRRRRR",
    "RRRRRRRRRRRR",
    "RRRRRRRRRRRR",
    ".RRRRRRRRRR.",
    "..RRRRRRRR..",
    "...RRRRRR...",
    "....RRRR....",
    ".....RR.....",
    "............"] },
  { name: "Benchy", rows: [
    "............",
    ".....NN.....",
    ".....NN.....",
    "....OOOOO...",
    "....OWOWO...",
    "....OOOOO...",
    "OO..OOOOO..O",
    "OOOOOOOOOOOO",
    ".OOOOOOOOOO.",
    "..OOOOOOOO..",
    "BBBBBBBBBBBB",
    "B.BB.BB.BB.B"] },
  { name: "Bobine", rows: [
    "..GGGGGGGG..",
    "..GGGGGGGG..",
    "...VVVVVV...",
    "...VVVVVV...",
    "...VVVVVV...",
    "...VVNNVV...",
    "...VVNNVV...",
    "...VVVVVV...",
    "...VVVVVV...",
    "...VVVVVV...",
    "..GGGGGGGG..",
    "..GGGGGGGG.."] },
  { name: "Champignon", rows: [
    "....RRRR....",
    "..RRWWRRRR..",
    ".RRWWWWRRRR.",
    ".RRWWRRRWWR.",
    "RRRRRRRWWWWR",
    "RWWRRRRRWWRR",
    "RWWWRRRRRRRR",
    "RRRRRRRRRRRR",
    "..WWNWWNWW..",
    "..WWNWWNWW..",
    "..WWWWWWWW..",
    "...WWWWWW..."] },
];
const PX_EMPTY = () => Array(PX_N * PX_N).fill(".");
const PX_PLATE = "repeating-radial-gradient(circle at 30% 30%, #a07a3f 0 1px, #8a6631 1px 3px)";

function PixelArt() {
  const [won, win] = useWin("pixel-art");
  const [mi, setMi] = useState(() => Math.floor(Math.random() * PX_MODELS.length));
  const [cells, setCells] = useState(PX_EMPTY);
  const [tool, setTool] = useState("R");
  const grid = useRef(null);
  const stroke = useRef(null);
  const model = useMemo(() => PX_MODELS[mi].rows.join("").split(""), [mi]);

  const score = useMemo(() => {
    let union = 0, ok = 0;
    for (let i = 0; i < model.length; i += 1) {
      if (model[i] === "." && cells[i] === ".") continue;
      union += 1;
      if (model[i] === cells[i]) ok += 1;
    }
    return union ? ok / union : 0;
  }, [cells, model]);
  const pct = Math.floor(score * 100);
  useEffect(() => { if (score >= 0.9) win(); }, [score, win]);

  const cellAt = e => {
    const r = grid.current.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * PX_N), y = Math.floor(((e.clientY - r.top) / r.height) * PX_N);
    if (x < 0 || y < 0 || x >= PX_N || y >= PX_N) return -1;
    return y * PX_N + x;
  };
  const paint = (i, v) => setCells(cs => {
    if (cs[i] === v) return cs;
    const n = cs.slice(); n[i] = v; return n;
  });
  const down = e => {
    const i = cellAt(e);
    if (i < 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pas de capture */ }
    const v = tool === "." || cells[i] === tool ? "." : tool;
    stroke.current = v;
    paint(i, v);
  };
  const move = e => {
    if (stroke.current == null) return;
    const i = cellAt(e);
    if (i >= 0) paint(i, stroke.current);
  };
  const up = () => { stroke.current = null; };

  return (
    <Stage won={won} wonText="Œuvre imprimée !" font={FONT}
      bg="linear-gradient(160deg, #312e81 0%, #1e1b4b 55%, #0f172a 100%)" style={{ justifyContent:"flex-start" }}>
      <Title color="#fff" sub="Reproduis le modèle sur le plateau, case par case." style={{ marginTop:-8 }}>Pixel art</Title>
      <div style={{ display:"flex", alignItems:"center", gap:14, marginTop:8, position:"relative", zIndex:2 }}>
        <div style={{ padding:6, borderRadius:10, background:"rgba(255,255,255,.08)", border:"1px solid rgba(255,255,255,.2)" }}>
          <div style={{ display:"grid", gridTemplateColumns:`repeat(${PX_N}, 7px)`, gap:1, background:"#6b5126" }}>
            {model.map((m, i) => <span key={i} style={{ width:7, height:7, background: m === "." ? "#8a6631" : PX_COL[m] }}/>)}
          </div>
          <div style={{ fontSize:11, textAlign:"center", marginTop:4, opacity:.85 }}>{PX_MODELS[mi].name}</div>
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:34, fontWeight:900, color: score >= 0.9 ? "#4ade80" : "#fde68a", fontVariantNumeric:"tabular-nums" }}>{pct} %</div>
          <div style={{ fontSize:12, opacity:.75 }}>conforme · objectif 90 %</div>
        </div>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", justifyContent:"center", gap:6, marginTop:10, maxWidth:420, position:"relative", zIndex:2 }}>
        {PX_PAL.map(p => (
          <button key={p.k} onClick={() => setTool(p.k)} aria-label={`Filament ${p.n}`} title={p.n}
            style={{ width:32, height:32, borderRadius:"50%", cursor:"pointer", padding:0, flex:"none",
              border: tool === p.k ? "3px solid #fff" : "3px solid rgba(255,255,255,.2)",
              background:`radial-gradient(circle, #d1d5db 0 22%, #374151 23% 30%, ${p.c} 31%)`,
              transform: tool === p.k ? "scale(1.14)" : "none", transition:"transform .15s", boxShadow:"0 3px 8px rgba(0,0,0,.4)" }}/>
        ))}
        <button onClick={() => setTool(".")} aria-label="Gomme" title="Gomme"
          style={{ width:32, height:32, borderRadius:10, cursor:"pointer", fontSize:15, flex:"none", background:"#fde68a", padding:0,
            border: tool === "." ? "3px solid #fff" : "3px solid rgba(255,255,255,.2)", transform: tool === "." ? "scale(1.14)" : "none" }}>🧽</button>
      </div>
      <div ref={grid} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ marginTop:10, width:"min(90vw, 400px, calc(100dvh - 380px))", minWidth:260, aspectRatio:"1", display:"grid", gridTemplateColumns:`repeat(${PX_N}, 1fr)`,
          gap:2, padding:6, boxSizing:"border-box", borderRadius:12, background:"#1f2937", touchAction:"none", cursor:"crosshair",
          boxShadow:"0 18px 40px rgba(0,0,0,.5), inset 0 0 0 2px #374151", position:"relative", zIndex:2 }}>
        {cells.map((v, i) => (
          <span key={i} style={{ borderRadius:3, background: v === "." ? PX_PLATE : PX_COL[v],
            boxShadow: v === "." ? "inset 0 0 0 1px rgba(0,0,0,.15)" : "inset 0 -3px 0 rgba(0,0,0,.22), inset 0 2px 0 rgba(255,255,255,.25)" }}/>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, marginTop:12, position:"relative", zIndex:2 }}>
        <Btn color="#475569" onClick={() => setCells(PX_EMPTY())} style={{ fontSize:13 }}>Vider le plateau</Btn>
        <Btn color="#7c3aed" onClick={() => { setMi(m => (m + 1) % PX_MODELS.length); setCells(PX_EMPTY()); }} style={{ fontSize:13 }}>Autre modèle</Btn>
      </div>
      <Note>Choisis une bobine, touche ou glisse sur les cases. Retoucher une case de la même couleur l'efface.</Note>
    </Stage>
  );
}

/* ================================================================ invaders */

function useCanvas(W, H) {
  const box = useRef(null);
  const cv = useRef(null);
  const sc = useRef(1);
  const [size, setSize] = useState({ w: W, h: H });
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const fit = () => {
      const maxH = Math.max(240, window.innerHeight - 300);
      const cw = Math.floor(Math.min(el.clientWidth || W, 520, maxH * W / H));
      const ch = Math.floor(cw * H / W);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const c = cv.current;
      if (c) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
      sc.current = (cw / W) * dpr;
      setSize(s => (s.w === cw && s.h === ch ? s : { w: cw, h: ch }));
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", fit);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [W, H]);
  const ctx = useCallback(() => {
    const c = cv.current;
    if (!c) return null;
    const g = c.getContext("2d");
    g.setTransform(sc.current, 0, 0, sc.current, 0, 0);
    return g;
  }, []);
  const at = useCallback(e => {
    const r = cv.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }, [W, H]);
  return { box, cv, size, ctx, at };
}

const INV_W = 360, INV_H = 480;
const INV_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
const INV_STARS = Array.from({ length: 60 }, () => ({ x: Math.random() * INV_W, y: Math.random() * INV_H * 0.85, r: Math.random() * 1.3 + 0.3, p: Math.random() * TAU }));

function invFresh() {
  const en = [];
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 6; c += 1) en.push({ x: 50 + c * 50, y: 74 + r * 42, c: INV_COLORS[(r * 2 + c) % 6], alive: true });
  return { px: INV_W / 2, lives: 3, inv: 0, bullets: [], bombs: [], en, dir: 1, cool: 0, bombT: 1.4, parts: [], t: 0, shake: 0, touch: null };
}

function drawSpoolInvader(c, e, t) {
  const leg = Math.sin(t * 8 + e.x) > 0 ? 1 : -1;
  c.strokeStyle = e.c; c.lineWidth = 2;
  for (const s of [-1, 1]) {
    c.beginPath(); c.moveTo(e.x + s * 8, e.y + 12); c.quadraticCurveTo(e.x + s * (12 + leg * 3), e.y + 18, e.x + s * 9, e.y + 23); c.stroke();
  }
  c.fillStyle = "#334155"; c.beginPath(); c.arc(e.x, e.y, 16, 0, TAU); c.fill();
  c.fillStyle = e.c; c.beginPath(); c.arc(e.x, e.y, 13, 0, TAU); c.fill();
  c.strokeStyle = "rgba(0,0,0,.22)"; c.lineWidth = 1;
  for (let r = 8; r < 13; r += 2) { c.beginPath(); c.arc(e.x, e.y, r, 0, TAU); c.stroke(); }
  c.fillStyle = "#e2e8f0"; c.beginPath(); c.arc(e.x, e.y + 3, 5, 0, TAU); c.fill();
  c.fillStyle = "#fff";
  c.beginPath(); c.arc(e.x - 6, e.y - 5, 4, 0, TAU); c.arc(e.x + 6, e.y - 5, 4, 0, TAU); c.fill();
  c.fillStyle = "#111";
  c.beginPath(); c.arc(e.x - 5.5 + leg, e.y - 4, 2, 0, TAU); c.arc(e.x + 6.5 + leg, e.y - 4, 2, 0, TAU); c.fill();
}

function drawNozzle(c, x, y, t, blink) {
  if (blink) return;
  c.fillStyle = "#64748b"; c.fillRect(x - 6, y - 34, 12, 10);
  c.fillStyle = "#cbd5e1"; c.fillRect(x - 17, y - 24, 34, 14);
  c.fillStyle = "#ef4444"; c.fillRect(x - 17, y - 24, 6, 14);
  c.fillStyle = "#d4a017";
  c.beginPath(); c.moveTo(x - 8, y - 10); c.lineTo(x + 8, y - 10); c.lineTo(x + 3, y); c.lineTo(x - 3, y); c.closePath(); c.fill();
  const g = c.createRadialGradient(x, y - 2, 0, x, y - 2, 12);
  g.addColorStop(0, `rgba(251,146,60,${0.7 + Math.sin(t * 10) * 0.2})`); g.addColorStop(1, "rgba(251,146,60,0)");
  c.fillStyle = g; c.beginPath(); c.arc(x, y - 2, 12, 0, TAU); c.fill();
}

function Invaders() {
  const [won, win] = useWin("invaders");
  const cvs = useCanvas(INV_W, INV_H);
  const keys = useKeys();
  const vk = useRef({});
  const S = useRef(invFresh());
  const [phase, setPhase] = useState("menu");
  const ph = useRef("menu");
  const [hud, setHud] = useState({ lives: 3, left: 18 });
  const [why, setWhy] = useState("");

  const go = useCallback(p => { ph.current = p; setPhase(p); }, []);
  const start = useCallback(() => { S.current = invFresh(); setHud({ lives: 3, left: 18 }); go("play"); }, [go]);

  useEffect(() => {
    const h = e => { if ((e.key === " " || e.key === "Enter") && ph.current !== "play") { e.preventDefault(); start(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [start]);

  useLoop(dt => {
    const s = S.current, c = cvs.ctx();
    if (!c) return;
    s.t += dt;
    const W = INV_W, H = INV_H, PY = H - 34;
    if (ph.current === "play") {
      const k = keys.current, v = vk.current;
      let dx = 0;
      if (k.has("ArrowLeft") || k.has("a") || k.has("q") || v.left) dx -= 1;
      if (k.has("ArrowRight") || k.has("d") || v.right) dx += 1;
      if (dx) s.px += dx * 230 * dt;
      else if (s.touch != null) s.px += clamp(s.touch - s.px, -300 * dt, 300 * dt);
      s.px = clamp(s.px, 20, W - 20);
      s.cool -= dt; s.inv -= dt;
      if ((k.has(" ") || v.fire || s.touch != null) && s.cool <= 0) {
        s.bullets.push({ x: s.px, y: PY - 36 }); s.cool = 0.34;
      }
      for (const b of s.bullets) b.y -= 400 * dt;
      for (const b of s.bullets) {
        for (const e of s.en) {
          if (e.alive && Math.hypot(b.x - e.x, b.y - e.y) < 17) {
            e.alive = false; b.y = -99;
            for (let i = 0; i < 18; i += 1) {
              const a = rand(0, TAU), sp = rand(40, 170);
              s.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.4, 0.9), c: pick([e.c, "#fff", "#fde68a"]) });
            }
            break;
          }
        }
      }
      s.bullets = s.bullets.filter(b => b.y > -10);
      const left = s.en.filter(e => e.alive);
      const speed = 24 + 75 * (1 - left.length / s.en.length);
      for (const e of left) e.x += s.dir * speed * dt;
      if (left.some(e => e.x < 20 || e.x > W - 20)) {
        s.dir = -s.dir;
        for (const e of left) { e.x += s.dir * speed * dt * 2; e.y += 14; }
      }
      s.bombT -= dt;
      if (s.bombT <= 0 && left.length) {
        const e = pick(left);
        s.bombs.push({ x: e.x, y: e.y + 16, vy: rand(120, 175), ph: rand(0, TAU) });
        s.bombT = rand(0.7, 1.4);
      }
      for (const b of s.bombs) b.y += b.vy * dt;
      s.bombs = s.bombs.filter(b => {
        if (b.y > H) return false;
        if (s.inv <= 0 && Math.abs(b.x - s.px) < 18 && b.y > PY - 30 && b.y < PY + 4) {
          s.lives -= 1; s.inv = 1.3; s.shake = 0.35;
          return false;
        }
        return true;
      });
      setHud(h => (h.lives === s.lives && h.left === left.length ? h : { lives: s.lives, left: left.length }));
      if (!left.length) { go("won"); win(); }
      else if (s.lives <= 0) { setWhy("Trop de spaghettis sur la buse."); go("over"); }
      else if (left.some(e => e.y > PY - 50)) { setWhy("Les bobines ont atterri sur le plateau."); go("over"); }
    }
    for (const p of s.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.life -= dt; }
    s.parts = s.parts.filter(p => p.life > 0);
    s.shake = Math.max(0, s.shake - dt);

    // dessin
    c.save();
    if (s.shake) c.translate(rand(-4, 4), rand(-4, 4));
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0b1026"); g.addColorStop(1, "#2a1446");
    c.fillStyle = g; c.fillRect(-8, -8, W + 16, H + 16);
    for (const st of INV_STARS) {
      c.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(s.t * 1.5 + st.p));
      c.fillStyle = "#fff"; c.beginPath(); c.arc(st.x, st.y, st.r, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
    c.fillStyle = "#8a6631"; c.fillRect(0, H - 12, W, 12);
    c.fillStyle = "rgba(255,255,255,.12)";
    for (let x = 3; x < W; x += 6) c.fillRect(x, H - 9 + ((x / 6) % 2) * 3, 2, 2);
    for (const e of s.en) if (e.alive) drawSpoolInvader(c, e, s.t);
    c.strokeStyle = "#e2e8f0"; c.lineWidth = 2;
    for (const b of s.bombs) {
      c.beginPath();
      for (let i = 0; i <= 12; i += 1) {
        const yy = b.y - 14 + i * 2.2, xx = b.x + Math.sin(i * 1.3 + s.t * 14 + b.ph) * 4;
        if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy);
      }
      c.stroke();
    }
    c.fillStyle = "#fb923c"; c.shadowColor = "#fb923c"; c.shadowBlur = 10;
    for (const b of s.bullets) { c.beginPath(); c.ellipse(b.x, b.y, 3.5, 8, 0, 0, TAU); c.fill(); }
    c.shadowBlur = 0;
    drawNozzle(c, s.px, PY, s.t, s.inv > 0 && Math.floor(s.t * 12) % 2 === 0);
    for (const p of s.parts) { c.globalAlpha = Math.min(1, p.life * 2); c.fillStyle = p.c; c.fillRect(p.x - 2, p.y - 2, 4, 4); }
    c.globalAlpha = 1;
    c.restore();
  });

  const ev = {
    onPointerDown: e => {
      if (ph.current !== "play") return;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pas de capture */ }
      S.current.touch = cvs.at(e).x;
    },
    onPointerMove: e => { if (S.current.touch != null) S.current.touch = cvs.at(e).x; },
    onPointerUp: () => { S.current.touch = null; },
    onPointerCancel: () => { S.current.touch = null; },
  };
  const hold = k => ({
    onPointerDown: e => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pas de capture */ } vk.current[k] = true; },
    onPointerUp: () => { vk.current[k] = false; },
    onPointerCancel: () => { vk.current[k] = false; },
    onLostPointerCapture: () => { vk.current[k] = false; },
    onContextMenu: e => e.preventDefault(),
  });
  const padBtn = { height:54, borderRadius:16, border:"1px solid rgba(255,255,255,.25)", background:"rgba(255,255,255,.12)", color:"#fff",
    fontSize:22, fontWeight:900, touchAction:"none", cursor:"pointer", boxShadow:"0 4px 0 rgba(0,0,0,.35)", WebkitTapHighlightColor:"transparent" };

  return (
    <Stage won={won} wonText="Vague nettoyée !" font={FONT} bg="radial-gradient(ellipse at 50% 20%, #3b0764, #0b0618 70%)">
      <div ref={cvs.box} style={{ width:"100%", maxWidth:520, position:"relative" }}>
        <div style={{ position:"relative", width:cvs.size.w, height:cvs.size.h, margin:"0 auto", borderRadius:16, overflow:"hidden",
          boxShadow:"0 22px 50px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.14)" }}>
          <canvas ref={cvs.cv} {...ev} style={{ display:"block", width:"100%", height:"100%", touchAction:"none" }}/>
          {phase === "play" && (
            <div style={{ position:"absolute", top:8, left:10, right:10, display:"flex", justifyContent:"space-between", fontWeight:800,
              fontSize:13, pointerEvents:"none" }}>
              <span>{"❤️".repeat(Math.max(0, hud.lives))}</span>
              <span>🧵 {hud.left} bobine{hud.left > 1 ? "s" : ""}</span>
            </div>
          )}
          {phase !== "play" && (
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              gap:10, padding:16, textAlign:"center", background:"rgba(8,4,20,.7)" }}>
              <div style={{ fontSize:48, animation:"hk-float 2.4s ease-in-out infinite" }}>{phase === "won" ? "🏆" : "👾"}</div>
              <Title color="#fff" sub={phase === "menu" ? "Les bobines envahissent l'atelier. Ta buse est la dernière défense." : phase === "over" ? why : "Plus une seule bobine en vue. L'atelier est sauvé."}>
                {phase === "menu" ? "Bobine Invaders" : phase === "over" ? "Perdu !" : "Victoire !"}
              </Title>
              <Btn color={phase === "won" ? "#475569" : "#a855f7"} onClick={start} style={{ fontSize:16, padding:"12px 26px" }}>
                {phase === "menu" ? "▶ Jouer" : phase === "over" ? "↻ Rejouer" : "↻ Encore une vague"}
              </Btn>
              <p style={{ margin:0, fontSize:12, opacity:.7 }}>Clavier : ← → et Espace · Tactile : garde le doigt sur l'écran, la buse suit et tire</p>
            </div>
          )}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1.3fr 1fr", gap:10, marginTop:12, maxWidth:360, marginLeft:"auto", marginRight:"auto" }}>
          <button aria-label="Gauche" {...hold("left")} style={padBtn}>◀</button>
          <button aria-label="Tirer" {...hold("fire")} style={{ ...padBtn, background:"rgba(251,146,60,.55)" }}>🔥</button>
          <button aria-label="Droite" {...hold("right")} style={padBtn}>▶</button>
        </div>
      </div>
    </Stage>
  );
}

/* ================================================================== hacker */

const HEX = "0123456789abcdef";
const hx = n => Array.from({ length: n }, () => HEX[Math.floor(Math.random() * 16)]).join("");
const HACK_GEN = [
  () => `G1 X${rand(0, 256).toFixed(3)} Y${rand(0, 256).toFixed(3)} E${rand(0, 3).toFixed(5)} F${pick([1200, 3000, 6000, 12000])}`,
  () => `M104 S${pick([210, 220, 250, 280])} ; surchauffe de la buse… autorisée`,
  () => `0x${hx(8)}:  ${hx(2)} ${hx(2)} ${hx(2)} ${hx(2)} ${hx(2)} ${hx(2)} ${hx(2)} ${hx(2)}  ${pick(["BAMBU.", "..X1C.", "PLA+..", "ROOT..", "AMS..."])}`,
  () => `inject(bobine[${Math.floor(rand(0, 16))}], payload=0x${hx(6)});`,
  () => `bypass_firewall --couche ${Math.floor(rand(1, 400))} --filament ${pick(["PLA", "PETG", "ABS", "TPU", "ASA"])}`,
  () => `decrypt AMS slot ${Math.floor(rand(1, 5))} … ${pick(["OK", "OK", "OK", "RETRY", "OK"])}`,
  () => `ssh root@x1c-${hx(4)}.local -p ${Math.floor(rand(1000, 9999))}`,
  () => "while (!plateau.propre) { essuyer(isopropanol); }",
  () => `sudo chmod 777 /dev/buse${Math.floor(rand(0, 4))}`,
  () => `[${(performance.now() / 1000).toFixed(4)}] mainframe: tracing ${hx(4)}:${hx(4)}::${hx(4)}`,
  () => "G28 ; retour à la base",
  () => "for (couche = 0; couche < ∞; couche++) spaghetti.detect(couche);",
];
const HACK_ALERTS = { 25: "PARE-FEU CONTOURNÉ", 50: "AMS INFILTRÉ", 75: "BUSE SOUS CONTRÔLE" };

function Hacker() {
  const [won, win] = useWin("hacker");
  const [lines, setLines] = useState(() => ["> connexion à BAMBU-NET…", "> en attente de frappe…"]);
  const [pct, setPct] = useState(0);
  const [alert, setAlert] = useState("");
  const [traced, setTraced] = useState(false);
  const pRef = useRef(0);
  const lastHit = useRef(0);
  const seen = useRef(new Set());
  const later = useTimers();

  const hit = useCallback(() => {
    if (pRef.current >= 100) return;
    lastHit.current = performance.now();
    const p = Math.min(100, pRef.current + 2.5);
    pRef.current = p;
    setPct(p);
    setLines(l => [...l, ...Array.from({ length: 3 }, () => pick(HACK_GEN)())].slice(-60));
    for (const m of [25, 50, 75]) {
      if (p >= m && !seen.current.has(m)) { seen.current.add(m); setAlert(HACK_ALERTS[m]); later(() => setAlert(""), 1100); }
    }
    if (p >= 100) { setAlert(""); win(); }
  }, [later, win]);

  // le pare-feu reprend du terrain des qu'on ralentit : il faut taper vite et sans s'arreter
  useEffect(() => {
    const id = setInterval(() => {
      const p = pRef.current;
      if (p <= 0 || p >= 100) { setTraced(false); return; }
      const idle = performance.now() - lastHit.current > 450;
      setTraced(idle);
      if (idle) { pRef.current = Math.max(0, p - 1.5); setPct(pRef.current); }
    }, 200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const h = e => { if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === " ") e.preventDefault(); hit(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [hit]);

  const done = pct >= 100;
  return (
    <Stage won={won} wonText="ACCÈS AUTORISÉ" font={MONO} bg="#000" style={{ justifyContent:"flex-start", padding:"14px 12px", cursor:"pointer" }}>
      <style>{`
        @keyframes hack-blink { 50% { opacity:.25 } }
        @keyframes hack-pop { from { transform:translate(-50%,-50%) scale(.6); opacity:0 } to { transform:translate(-50%,-50%) scale(1); opacity:1 } }
        @keyframes hack-glitch { 0%,100% { transform:translate(-50%,-50%) } 20% { transform:translate(-52%,-49%) skewX(-6deg) }
          40% { transform:translate(-48%,-51%) } 60% { transform:translate(-51%,-48%) skewX(4deg) } }
      `}</style>
      <div onPointerDown={e => { e.preventDefault(); hit(); }} aria-label="Tapoter pour pirater"
        style={{ position:"absolute", inset:0, zIndex:3, touchAction:"manipulation" }}/>
      <div style={{ width:"min(100%, 720px)", display:"flex", justifyContent:"space-between", fontSize:12, color:"#22c55e", zIndex:2, position:"relative" }}>
        <span>BAMBU-NET // INTRUSION</span>
        <span style={{ animation:"hack-blink 1s steps(1) infinite", color:"#ef4444" }}>● REC</span>
      </div>
      <div style={{ width:"min(100%, 720px)", height:"calc(100dvh - 330px)", minHeight:260, marginTop:8, display:"flex", flexDirection:"column",
        justifyContent:"flex-end", overflow:"hidden", fontSize:"clamp(11px, 3vw, 13.5px)", lineHeight:1.4, color:"#4ade80",
        textShadow:"0 0 6px rgba(74,222,128,.7)", position:"relative", zIndex:2,
        maskImage:"linear-gradient(180deg, transparent, #000 25%)", WebkitMaskImage:"linear-gradient(180deg, transparent, #000 25%)" }}>
        {lines.map((l, i) => <div key={i} style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flex:"none",
          color: i >= lines.length - 3 ? "#bbf7d0" : undefined }}>{l}</div>)}
      </div>
      <div style={{ width:"min(100%, 720px)", marginTop:12, position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, fontWeight:800, color:"#4ade80", marginBottom:6 }}>
          <span>INTRUSION</span><span>{Math.floor(pct)} %</span>
        </div>
        <div style={{ height:20, borderRadius:4, border:"1px solid #22c55e", padding:2, background:"#021a0a" }}>
          <div style={{ height:"100%", width:`${pct}%`, background:"repeating-linear-gradient(90deg, #22c55e 0 8px, #15803d 8px 10px)",
            boxShadow:"0 0 14px #22c55e", transition:"width .15s" }}/>
        </div>
        <div style={{ textAlign:"center", fontSize:12.5, color: traced ? "#f87171" : "#86efac", opacity: traced ? 1 : 0.75, marginTop:8,
          fontWeight: traced ? 800 : 400, animation: traced ? "hack-blink .6s steps(1) infinite" : "none" }}>
          {done ? "Tu es dedans. Ne touche à rien." : traced ? "⚠ TRACE DÉTECTÉE : le pare-feu reprend la main. Tape plus vite !"
            : "Tape sur le clavier ou tapote l'écran. Vite, sans t'arrêter. Comme dans les films."}
        </div>
      </div>
      {alert && (
        <div key={alert} style={{ position:"absolute", left:"50%", top:"42%", transform:"translate(-50%,-50%)", zIndex:4, padding:"14px 20px",
          border:"2px solid #fbbf24", background:"rgba(20,12,0,.9)", color:"#fbbf24", fontWeight:900, fontSize:"clamp(16px, 5vw, 24px)",
          whiteSpace:"nowrap", animation:"hack-pop .2s ease-out both", pointerEvents:"none" }}>⚠ {alert}</div>
      )}
      {done && (
        <div style={{ position:"absolute", left:"50%", top:"42%", transform:"translate(-50%,-50%)", zIndex:4, padding:"18px 26px",
          border:"3px solid #22c55e", background:"rgba(0,20,6,.94)", color:"#4ade80", fontWeight:900, fontSize:"clamp(24px, 8vw, 44px)",
          whiteSpace:"nowrap", textShadow:"0 0 18px #22c55e", animation:"hack-glitch .4s steps(2) 4", pointerEvents:"none" }}>ACCÈS AUTORISÉ</div>
      )}
      <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none", zIndex:2,
        background:"repeating-linear-gradient(180deg, transparent 0 2px, rgba(0,0,0,.25) 2px 4px)" }}/>
    </Stage>
  );
}

/* ================================================================= loading */

const LOAD_MSGS = [
  "Préchauffage du plateau…", "Téléchargement des pixels…", "Réticulation des splines…", "Calibrage du flux de café…",
  "Négociation avec l'AMS…", "Recherche du bout de la bobine…", "Séchage du PLA (encore 6 h)…", "Mise à niveau du plateau à l'œil…",
  "Compilation des excuses…", "Comptage des couches à la main…", "Dépliage des supports arborescents…", "Interrogation du chat…",
];
const LOAD_STUCK = ["Presque…", "Encore un instant…", "Ça y est presque, promis…", "Tu peux aller te faire un café.", "99 %, c'est presque 100 %, non ?"];

function Loading() {
  const [won, win] = useWin("loading");
  const box = useRef(null);
  const bar = useRef(null);
  const [p, setP] = useState(0);
  const [msg, setMsg] = useState(LOAD_MSGS[0]);
  const [phase, setPhase] = useState("load"); // load, stuck, fell, done
  const [chip, setChip] = useState(null); // {x, y, anim, rot}
  const drag = useRef(null);
  const later = useTimers();

  // la barre avance, ralentit, se bloque a 99
  useEffect(() => {
    if (phase !== "load") return undefined;
    if (p >= 99) { setPhase("stuck"); return undefined; }
    const delay = p < 50 ? 60 : p < 80 ? 140 : p < 95 ? 320 : 700;
    const id = setTimeout(() => setP(v => Math.min(99, v + (v < 50 ? 2 : 1))), delay);
    return () => clearTimeout(id);
  }, [p, phase]);
  useEffect(() => {
    if (phase !== "load" && phase !== "stuck") return undefined;
    const list = phase === "load" ? LOAD_MSGS : LOAD_STUCK;
    let i = 0;
    setMsg(list[0]);
    const id = setInterval(() => { i += 1; setMsg(list[i % list.length]); }, 1500);
    return () => clearInterval(id);
  }, [phase]);

  const target = () => {
    const b = bar.current.getBoundingClientRect(), o = box.current.getBoundingClientRect();
    return { x: b.left - o.left + b.width * 0.985 - 17, y: b.top - o.top + b.height / 2 - 12 };
  };
  const floorY = () => box.current.getBoundingClientRect().height - 70;

  useEffect(() => {
    if (phase !== "stuck") return;
    later(() => {
      const t = target();
      setChip({ x: t.x, y: t.y, anim: false, rot: 0 });
      setP(98);
      setPhase("fell");
      setMsg("Oups. Le dernier pour cent est tombé par terre.");
      later(() => {
        const w = box.current.getBoundingClientRect().width;
        setChip({ x: clamp(t.x - rand(40, 160), 10, w - 50), y: floorY(), anim: true, rot: rand(-160, 160) });
      }, 350);
    }, 5200);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // vexe d'etre tombe, le pour cent detale sur le sol tant qu'on ne l'attrape pas
  useEffect(() => {
    if (phase !== "fell") return undefined;
    const id = setInterval(() => {
      if (drag.current || !box.current) return;
      const w = box.current.getBoundingClientRect().width;
      setChip(c => (c && Math.abs(c.y - floorY()) < 4
        ? { ...c, x: clamp(c.x + pick([-1, 1]) * rand(50, 130), 8, w - 44), anim: true, rot: pick([-12, 12]) } : c));
    }, 1300);
    return () => clearInterval(id);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = e => { const o = box.current.getBoundingClientRect(); return { x: e.clientX - o.left, y: e.clientY - o.top }; };
  const down = e => {
    if (phase !== "fell") return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pas de capture */ }
    const q = pos(e);
    drag.current = { dx: q.x - chip.x, dy: q.y - chip.y, sx: q.x, sy: q.y, moved: false };
  };
  const move = e => {
    const d = drag.current;
    if (!d) return;
    const q = pos(e);
    if (Math.hypot(q.x - d.sx, q.y - d.sy) > 6) d.moved = true;
    setChip(c => ({ ...c, x: q.x - d.dx, y: q.y - d.dy, anim: false, rot: 0 }));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || phase !== "fell") return;
    const t = target();
    if (Math.hypot(chip.x - t.x, chip.y - t.y) < 55) {
      setChip(c => ({ ...c, ...t, anim: true, rot: 0 }));
      setP(100); setPhase("done"); setMsg("Chargement terminé. Ça valait le coup d'attendre, non ?");
      win();
      return;
    }
    if (!d.moved) setMsg("Il ne remontera pas tout seul. Porte-le jusqu'au bout de la barre.");
    else setMsg(pick(["Raté, il est retombé.", "Pas là. Au bout de la barre.", "Il glisse, ce pour cent…"]));
    setChip(c => ({ ...c, y: floorY(), anim: true, rot: rand(-90, 90) }));
  };

  return (
    <Stage won={won} wonText="100 % !" font={FONT} color="#0f172a"
      bg="linear-gradient(180deg, #e0f2fe 0%, #f0f9ff 62%, #cbd5e1 62.3%, #94a3b8 100%)">
      <style>{`
        @keyframes load-stripes { from { background-position:0 0 } to { background-position:40px 0 } }
        @keyframes load-shake { 0%,100% { transform:none } 25% { transform:translateX(-4px) rotate(-.6deg) } 75% { transform:translateX(4px) rotate(.6deg) } }
      `}</style>
      <div ref={box} style={{ position:"absolute", inset:0 }}>
        <div style={{ position:"absolute", left:0, right:0, top:"14%", display:"flex", flexDirection:"column", alignItems:"center", padding:"0 16px" }}>
          <div style={{ fontSize:13, letterSpacing:".2em", fontWeight:800, color:"#0369a1" }}>INSTALLATION EN COURS</div>
          <div style={{ fontSize:"clamp(56px, 18vw, 96px)", fontWeight:900, color:"#0f172a", fontVariantNumeric:"tabular-nums", lineHeight:1.1 }}>{p} %</div>
          <div ref={bar} style={{ width:"min(86vw, 440px)", height:26, borderRadius:13, background:"#fff", padding:3, boxSizing:"border-box",
            boxShadow:"inset 0 2px 6px rgba(0,0,0,.2), 0 6px 16px rgba(2,132,199,.2)",
            animation: phase === "stuck" ? "load-shake .3s ease-in-out infinite" : "none" }}>
            <div style={{ height:"100%", width:`${p}%`, borderRadius:10, transition:"width .25s",
              background:"repeating-linear-gradient(-45deg, #00ae42 0 10px, #16c75a 10px 20px)", backgroundSize:"40px 100%",
              animation: phase === "done" ? "none" : "load-stripes .8s linear infinite" }}/>
          </div>
          <div aria-live="polite" style={{ marginTop:14, minHeight:24, fontSize:15, fontWeight:600, color:"#334155", textAlign:"center" }}>{msg}</div>
          {phase === "fell" && <div style={{ marginTop:6, fontSize:13, color:"#64748b" }}>Ramasse-le et remets-le à sa place.</div>}
          {(phase === "load" || phase === "stuck") && (
            <div aria-hidden="true" style={{ marginTop:14, width:28, height:28, borderRadius:"50%", border:"4px solid #bae6fd",
              borderTopColor:"#0284c7", animation:"hk-spin 1s linear infinite" }}/>
          )}
        </div>
        {chip && (
          <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="button" aria-label="Le dernier pour cent"
            data-chip="1"
            style={{ position:"absolute", left:chip.x, top:chip.y, width:34, height:24, borderRadius:6, zIndex:5, touchAction:"none",
              cursor: phase === "fell" ? "grab" : "default", display:"flex", alignItems:"center", justifyContent:"center",
              fontWeight:900, fontSize:12, color:"#fff", textShadow:"0 1px 2px rgba(0,0,0,.4)",
              background:"repeating-linear-gradient(-45deg, #00ae42 0 6px, #16c75a 6px 12px)", border:"2px solid #fff",
              boxShadow:"0 6px 12px rgba(0,0,0,.3)", transform:`rotate(${chip.rot || 0}deg)`,
              transition: chip.anim ? "top .8s cubic-bezier(.45,0,.6,1.45), left .5s ease-out, transform .8s, opacity .4s" : "none",
              opacity: phase === "done" ? 0 : 1 }}>1 %</div>
        )}
      </div>
    </Stage>
  );
}

/* ================================================================= captcha */

function IcoNozzle({ c = "#d4a017" }) {
  return (
    <svg viewBox="0 0 64 64" width="70%" height="70%">
      <rect x="26" y="2" width="12" height="10" fill="#64748b"/>
      <rect x="12" y="12" width="40" height="20" rx="3" fill="#cbd5e1"/>
      <rect x="12" y="12" width="9" height="20" rx="2" fill="#ef4444"/>
      <circle cx="44" cy="22" r="2.5" fill="#64748b"/>
      <path d="M22 32 H42 L39 40 H25 Z" fill={c}/>
      <path d="M25 40 H39 L34 54 H30 Z" fill={c}/>
      <path d="M25 40 H32 L31 54 H30 Z" fill="#fff" opacity=".25"/>
      <path d="M32 54 q-3 6 0 9 q3 -3 0 -9" fill="#f97316"/>
    </svg>
  );
}
function IcoSpool({ c = "#22c55e" }) {
  return (
    <svg viewBox="0 0 64 64" width="72%" height="72%">
      <circle cx="32" cy="32" r="29" fill="#374151"/><circle cx="32" cy="32" r="23" fill={c}/>
      {[19, 15, 11].map(r => <circle key={r} cx="32" cy="32" r={r + 1} fill="none" stroke="rgba(0,0,0,.18)"/>)}
      <circle cx="32" cy="32" r="9" fill="#e5e7eb"/><circle cx="32" cy="32" r="3.5" fill="#374151"/>
    </svg>
  );
}
function IcoBenchy({ c = "#f97316", tilt = 0 }) {
  return (
    <svg viewBox="0 0 64 64" width="76%" height="76%" style={{ transform:`rotate(${tilt}deg)` }}>
      <rect x="31" y="8" width="7" height="12" rx="1" fill="#334155"/>
      <path d="M22 20 H44 V38 H22 Z" fill={c}/>
      <rect x="26" y="24" width="6" height="6" rx="1" fill="#e0f2fe"/><rect x="35" y="24" width="6" height="6" rx="1" fill="#e0f2fe"/>
      <path d="M4 36 H60 L52 54 H14 Z" fill={c}/>
      <path d="M4 36 H60 L58 40 H6 Z" fill="#000" opacity=".15"/>
      <circle cx="18" cy="45" r="2.4" fill="#000" opacity=".3"/>
      <path d="M4 58 q8 -4 16 0 t16 0 t16 0 t12 0" stroke="#38bdf8" strokeWidth="2.5" fill="none"/>
    </svg>
  );
}
function IcoPlate() {
  return (
    <div style={{ width:"74%", height:"56%", borderRadius:6, transform:"perspective(120px) rotateX(35deg)",
      background:"repeating-radial-gradient(circle at 30% 30%, #b08d57 0 1px, #8a6631 1px 3px)", boxShadow:"0 6px 0 #374151" }}/>
  );
}

function capTile(t) {
  if (t.k === "nozzle") return <IcoNozzle c={t.c}/>;
  if (t.k === "spool") return <IcoSpool c={t.c}/>;
  if (t.k === "benchy") return <IcoBenchy c={t.c} tilt={t.tilt}/>;
  if (t.k === "plate") return <IcoPlate/>;
  return <span style={{ fontSize:"min(12vw, 52px)", lineHeight:1 }}>{t.e}</span>;
}
const CAP_ROUNDS = [
  { ask: "une buse", bg: "#fef3c7", good: "Vérifié.", optNote: "L'oiseau ? C'est aussi une buse. On te l'accorde.", tiles: [
    { k: "nozzle", ok: true, c: "#d4a017" }, { k: "e", e: "🍕" }, { k: "nozzle", ok: true, c: "#9ca3af" },
    { k: "spool", c: "#22c55e" }, { k: "e", e: "🦅", opt: true }, { k: "benchy", c: "#3b82f6" },
    { k: "e", e: "🐈" }, { k: "nozzle", ok: true, c: "#be123c" }, { k: "plate" }] },
  { ask: "un Benchy", bg: "#e0f2fe", good: "Vérifié. Tu sais reconnaître un torture test.", tiles: [
    { k: "benchy", ok: true, c: "#f97316" }, { k: "e", e: "⛵", why: "Ce voilier n'est pas un Benchy : il n'a pas de cheminée." },
    { k: "benchy", ok: true, c: "#a3a3a3", tilt: -12 }, { k: "e", e: "🦆", why: "Un canard de bain flotte, mais ce n'est pas un Benchy." },
    { k: "spool", c: "#ec4899" }, { k: "benchy", ok: true, c: "#22c55e", tilt: 10 }, { k: "e", e: "🧀" },
    { k: "e", e: "🚢", why: "Ce paquebot ne tiendrait jamais sur un plateau de 256 mm." }, { k: "nozzle", c: "#d4a017" }] },
];
const CAP_TAUNTS = ["Une imprimante aurait cliqué tout droit.", "Hésitation détectée. Très humain.", "Encore un effort, être de carbone.",
  "Tu insistes. Une imprimante aurait déjà affiché une erreur 0300-8003."];

function Captcha() {
  const [won, win] = useWin("captcha");
  const [step, setStep] = useState(0); // 0 case, 1-2 grilles, 3 imprimante, 4 analyse, 5 fini
  const [busy, setBusy] = useState(false);
  const [tiles, setTiles] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [msg, setMsg] = useState("");
  const [shake, setShake] = useState(false);
  const [flee, setFlee] = useState({ n: 0, x: 50, y: 50 });
  const later = useTimers();

  const openRound = r => { setTiles(shuffle(CAP_ROUNDS[r].tiles)); setSel(new Set()); setStep(r + 1); };
  const tick = () => {
    if (busy || step) return;
    setBusy(true);
    later(() => { setBusy(false); openRound(0); }, 1100);
  };
  const toggle = i => setSel(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const verify = () => {
    const missing = tiles.some((t, i) => t.ok && !sel.has(i));
    const wrong = tiles.find((t, i) => sel.has(i) && !t.ok && !t.opt);
    if (missing || wrong) {
      setShake(true); later(() => setShake(false), 450);
      setMsg(wrong && wrong.why ? wrong.why : !wrong ? "Il en manque. Regarde bien chaque case."
        : "Essaie encore. Les humains aussi se trompent, ça ne prouve rien.");
      setSel(new Set());
      return;
    }
    const r = CAP_ROUNDS[step - 1];
    const usedOpt = tiles.some((t, i) => t.opt && sel.has(i));
    setMsg(usedOpt && r.optNote ? r.optNote : r.good);
    if (step === 1) openRound(1);
    else { setStep(3); setFlee({ n: 0, x: 50, y: 50 }); }
  };
  const dodge = e => {
    if (step !== 3) return;
    if (flee.n < CAP_TAUNTS.length) {
      e.preventDefault();
      setMsg(CAP_TAUNTS[flee.n]);
      setFlee(f => ({ n: f.n + 1, x: rand(22, 78), y: rand(18, 82) }));
      return;
    }
    setStep(4); setMsg("Analyse de ta première couche…");
    later(() => { setStep(5); setMsg(""); win(); }, 1800);
  };

  const card = { width:"min(92vw, 360px)", background:"#fff", color:"#1f2937", borderRadius:6, boxShadow:"0 10px 40px rgba(0,0,0,.35)",
    border:"1px solid #d1d5db", overflow:"hidden", position:"relative", zIndex:2, animation: shake ? "cap-shake .45s" : "none" };
  return (
    <Stage won={won} wonText="Humain certifié (probablement)" font={FONT}
      bg="linear-gradient(135deg, #64748b 0%, #334155 50%, #1e293b 100%)">
      <style>{`
        @keyframes cap-shake { 20%,60% { transform:translateX(-8px) } 40%,80% { transform:translateX(8px) } }
        @keyframes cap-check { from { stroke-dashoffset:30 } to { stroke-dashoffset:0 } }
      `}</style>
      <Title color="#fff" sub="Une simple formalité avant d'entrer.">Vérification</Title>
      <div style={{ marginTop:16, ...card }}>
        {(step === 0 || step === 5) && (
          <div style={{ display:"flex", alignItems:"center", gap:14, padding:"18px 14px", background:"#f9fafb" }}>
            <button onClick={tick} aria-label="Je ne suis pas un robot" disabled={step === 5}
              style={{ width:30, height:30, borderRadius:3, border: step === 5 ? "none" : "2px solid #9ca3af", background:"#fff", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", padding:0, flex:"none" }}>
              {busy && <span style={{ width:22, height:22, borderRadius:"50%", border:"3px solid #bfdbfe", borderTopColor:"#2563eb", animation:"hk-spin .8s linear infinite" }}/>}
              {step === 5 && <svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 12 l5 5 L20 6" stroke="#16a34a" strokeWidth="3.5" fill="none" strokeDasharray="30" style={{ animation:"cap-check .5s ease-out both" }}/></svg>}
            </button>
            <span style={{ fontSize:15, flex:1 }}>{step === 5 ? "Tu n'es pas un robot. Enfin, probablement." : "Je ne suis pas un robot"}</span>
            <div style={{ textAlign:"center", fontSize:9, color:"#6b7280", lineHeight:1.2 }}>
              <div style={{ fontSize:24 }}>🎋</div>BambuCAPTCHA
            </div>
          </div>
        )}
        {(step === 1 || step === 2) && (
          <div>
            <div style={{ background:"#2563eb", color:"#fff", padding:"14px 16px" }}>
              <div style={{ fontSize:13 }}>Sélectionne toutes les cases avec</div>
              <div style={{ fontSize:22, fontWeight:800 }}>{CAP_ROUNDS[step - 1].ask}</div>
              <div style={{ fontSize:12, opacity:.85 }}>Puis clique sur Vérifier. ({step}/3)</div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:4, padding:4 }}>
              {tiles.map((t, i) => (
                <button key={`${step}-${i}`} onClick={() => toggle(i)} aria-pressed={sel.has(i)} aria-label={`Case ${i + 1}`}
                  style={{ aspectRatio:"1", border:"none", padding:0, cursor:"pointer", position:"relative", background:"#e5e7eb" }}>
                  <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
                    background: CAP_ROUNDS[step - 1].bg, transform: sel.has(i) ? "scale(.82)" : "none", transition:"transform .15s" }}>{capTile(t)}</div>
                  {sel.has(i) && <span style={{ position:"absolute", left:4, top:4, width:22, height:22, borderRadius:"50%", background:"#2563eb",
                    color:"#fff", fontSize:14, fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center" }}>✓</span>}
                </button>
              ))}
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 10px", borderTop:"1px solid #e5e7eb" }}>
              <button onClick={() => { setTiles(t => shuffle(t)); setSel(new Set()); }} aria-label="Mélanger"
                style={{ border:"none", background:"none", fontSize:22, cursor:"pointer", color:"#6b7280" }}>↻</button>
              <Btn color="#2563eb" onClick={verify} style={{ borderRadius:4, padding:"9px 22px" }}>VÉRIFIER</Btn>
            </div>
          </div>
        )}
        {(step === 3 || step === 4) && (
          <div>
            <div style={{ background:"#2563eb", color:"#fff", padding:"14px 16px" }}>
              <div style={{ fontSize:13 }}>Dernière étape (3/3)</div>
              <div style={{ fontSize:20, fontWeight:800 }}>Prouve que tu n'es pas une imprimante</div>
            </div>
            <div style={{ position:"relative", height:200, background:"repeating-linear-gradient(45deg, #f8fafc 0 12px, #f1f5f9 12px 24px)" }}>
              {step === 3 ? (
                <button onPointerDown={dodge} onClick={e => { if (e.detail === 0) dodge(e); }}
                  style={{ position:"absolute", left:`${flee.x}%`, top:`${flee.y}%`, transform:"translate(-50%,-50%)", display:"flex", alignItems:"center",
                    gap:8, padding:"8px 12px", borderRadius:4, border:"1px solid #d1d5db", background:"#fff", cursor:"pointer", whiteSpace:"nowrap",
                    transition:"left .25s cubic-bezier(.3,1.5,.5,1), top .25s cubic-bezier(.3,1.5,.5,1)", boxShadow:"0 2px 6px rgba(0,0,0,.12)",
                    fontSize:14, color:"#1f2937" }}>
                  <span style={{ width:18, height:18, border:"2px solid #9ca3af", borderRadius:3 }}/> Je ne suis pas une imprimante
                </button>
              ) : (
                <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10 }}>
                  <span style={{ width:34, height:34, borderRadius:"50%", border:"4px solid #bfdbfe", borderTopColor:"#2563eb", animation:"hk-spin .8s linear infinite" }}/>
                  <span style={{ fontSize:13, color:"#475569" }}>Comparaison avec 1 247 imprimantes connues…</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div aria-live="polite" style={{ minHeight:22, marginTop:12, color:"#e2e8f0", fontSize:14, fontWeight:600, textAlign:"center", maxWidth:380,
        position:"relative", zIndex:2 }}>{msg}</div>
    </Stage>
  );
}

/* ----------------------------------------------------------------- export */

export const PAGES = {
  "hal-9000": Hal,
  terminal: Terminal,
  binaire: Binaire,
  "pixel-art": PixelArt,
  invaders: Invaders,
  hacker: Hacker,
  loading: Loading,
  captcha: Captcha,
};
