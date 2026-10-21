import React, { useState, useEffect, useRef, useMemo } from "react";
import { Stage, Title, useWin, useLoop, Btn, rand, pick } from "./kit";

// Les seize pages cachees (22/10/2026) : une scene par adresse secrete, et un
// secret qui ne tombe qu'a la reussite. Chaque page garde ses keyframes dans
// son propre <style>, prefixees par son slug.

const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SERIF = "Georgia, 'Times New Roman', serif";

/** Consigne discrete en bas de scene, masquee une fois gagne. */
function Hint({ children, won, color = "rgba(255,255,255,.66)", style }) {
  if (won) return null;
  return (
    <div style={{ position:"absolute", left:"50%", bottom:12, transform:"translateX(-50%)", zIndex:15,
      width:"max-content", maxWidth:"calc(100% - 32px)", textAlign:"center", fontSize:12.5, lineHeight:1.35,
      padding:"6px 12px", borderRadius:999, background:"rgba(0,0,0,.3)", color, fontFamily:SANS,
      backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)", pointerEvents:"none", ...style }}>
      {children}
    </div>
  );
}

/** Minuteries nettoyees au demontage : later(fn, ms). */
function useTimers() {
  const ids = useRef([]);
  useEffect(() => () => { ids.current.forEach(clearTimeout); ids.current = []; }, []);
  return useMemo(() => (fn, ms) => { const id = setTimeout(fn, ms); ids.current.push(id); return id; }, []);
}

const bare = { border:"none", background:"transparent", padding:0, margin:0, cursor:"pointer", font:"inherit", color:"inherit",
  WebkitTapHighlightColor:"transparent" };

/* ------------------------------------------------------------------ matrice */

const MAT_GLYPHS = "01PLAPETGTPUABSASAPCアイウエオカキクケコサシスセソタチツ{}<>#$%=+ΣΩλ".split("");
const MAT_LINES = ["Réveille-toi…", "La Matrice t'imprime en couches de 0,2 mm.", "Suis le lapin blanc.", "", "Toc, toc."];

function Matrice() {
  const [won, win] = useWin("matrice");
  const cols = useMemo(() => Array.from({ length: 34 }, (_, i) => ({
    left: (i / 34) * 100 + rand(0, 1.5), dur: rand(4, 11), delay: -rand(0, 11), size: rand(11, 17), op: rand(0.25, 0.65),
    text: Array.from({ length: 27 }, () => pick(MAT_GLYPHS)).join("\n"), head: pick(MAT_GLYPHS),
  })), []);
  // la machine a ecrire
  const [shown, setShown] = useState("");
  useEffect(() => {
    const all = MAT_LINES.join("\n");
    let i = 0;
    const t = setInterval(() => { i += 1; setShown(all.slice(0, i)); if (i >= all.length) clearInterval(t); }, 70);
    return () => clearInterval(t);
  }, []);
  // le lapin passe de temps en temps, et ne revient pas tout de suite
  const [bunny, setBunny] = useState(null);
  const caught = useRef(false);
  useEffect(() => {
    let t1, t2;
    const next = d => {
      t1 = setTimeout(() => {
        if (caught.current) return;
        setBunny({ id: Date.now(), top: rand(16, 76), rtl: Math.random() < 0.5 });
        t2 = setTimeout(() => { if (!caught.current) { setBunny(null); next(rand(6000, 9000)); } }, 2600);
      }, d);
    };
    next(4200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  const grab = e => {
    e.stopPropagation();
    if (caught.current) return;
    caught.current = true;
    setBunny(b => b && { ...b, caught: true });
    win();
  };

  return (
    <Stage bg="radial-gradient(ellipse at center, #0b1f14 0%, #020604 78%)" color="#22c55e" font={MONO} won={won}
      wonText="Tu as suivi le lapin blanc">
      <style>{`
        @keyframes matrice-rain { from { transform:translateY(-100%) } to { transform:translateY(115vh) } }
        @keyframes matrice-caret { 50% { opacity:0 } }
        @keyframes matrice-run { from { left:-70px } to { left:calc(100% + 10px) } }
        @keyframes matrice-run-rtl { from { left:calc(100% + 10px) } to { left:-70px } }
        @keyframes matrice-hop { from { transform:translateY(0) } to { transform:translateY(-12px) } }
        @keyframes matrice-scan { from { transform:translateY(-100%) } to { transform:translateY(400%) } }
        @keyframes matrice-glow { 0%,100% { filter:drop-shadow(0 0 6px #fff) } 50% { filter:drop-shadow(0 0 22px #bbf7d0) } }
      `}</style>
      {cols.map((c, i) => (
        <pre key={i} aria-hidden="true" style={{ position:"absolute", top:0, left:`${c.left}%`, margin:0, fontSize:c.size, lineHeight:1.12,
          color:`rgba(34,197,94,${c.op})`, animation:`matrice-rain ${c.dur}s linear ${c.delay}s infinite`, pointerEvents:"none",
          textShadow:"0 0 6px rgba(34,197,94,.7)", WebkitMaskImage:"linear-gradient(to bottom, transparent, #000 75%)",
          maskImage:"linear-gradient(to bottom, transparent, #000 75%)" }}>
          {c.text}{"\n"}<span style={{ color:"#ecfdf5", textShadow:"0 0 10px #bbf7d0" }}>{c.head}</span></pre>
      ))}
      <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none",
        background:"repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 1px, transparent 1px 3px)" }}/>
      <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, top:0, height:"25%", pointerEvents:"none",
        background:"linear-gradient(180deg, transparent, rgba(74,222,128,.06), transparent)", animation:"matrice-scan 6s linear infinite" }}/>

      <div style={{ position:"relative", zIndex:3, width:"100%", maxWidth:480, padding:"26px 22px", borderRadius:14,
        background:"rgba(1,6,3,.82)", border:"1px solid rgba(34,197,94,.4)", boxShadow:"0 0 50px rgba(34,197,94,.16)" }}>
        <div style={{ fontSize:11, letterSpacing:".35em", color:"rgba(74,222,128,.6)", marginBottom:14 }}>CANAL SÉCURISÉ · NOEUD 0x2A</div>
        <pre style={{ margin:0, whiteSpace:"pre-wrap", fontSize:"clamp(15px, 4.2vw, 19px)", lineHeight:1.6, color:"#86efac",
          textShadow:"0 0 8px rgba(74,222,128,.55)", minHeight:150 }}>
          {shown}<span style={{ animation:"matrice-caret 1s step-end infinite" }}>▌</span></pre>
        {won && <div style={{ marginTop:12, fontSize:14, color:"#ecfdf5", animation:"hk-fade .8s both" }}>
          Bienvenue dans le terrier. La cuillère n'existe pas, le filament si.</div>}
      </div>

      {bunny && (
        <div key={bunny.id} style={{ position:"absolute", left:0, right:0, top:`${bunny.top}%`, height:64, zIndex:8, pointerEvents:"none" }}>
          <button onClick={grab} aria-label="Lapin blanc" style={{ ...bare, position:"absolute", top:0, width:64, height:64,
            pointerEvents:"auto", animation:`${bunny.rtl ? "matrice-run-rtl" : "matrice-run"} 2.5s linear forwards`,
            animationPlayState: bunny.caught ? "paused" : "running" }}>
            <span style={{ display:"inline-block", transform: bunny.rtl ? "none" : "scaleX(-1)" }}>
              <span style={{ display:"inline-block", fontSize:46, lineHeight:"64px",
                animation: bunny.caught ? "matrice-glow 1.6s ease-in-out infinite" : "matrice-hop .3s ease-in-out infinite alternate",
                filter:"drop-shadow(0 0 8px rgba(255,255,255,.8))" }}>🐇</span>
            </span>
          </button>
        </div>
      )}
      <Hint won={won} color="rgba(134,239,172,.75)">Quelque chose de blanc passe parfois. Il n'attend personne.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------ quarante-deux */

function QuaranteDeux() {
  const [won, win] = useWin("quarante-deux");
  const layers = useMemo(() => [0.2, 0.5, 1].map((depth, li) => ({
    depth,
    stars: Array.from({ length: [80, 40, 16][li] }, () => ({
      x: rand(0, 100), y: rand(0, 100), s: [1, 1.7, 2.6][li] * rand(0.7, 1.3), tw: rand(2, 6), d: -rand(0, 6),
      c: pick(["#fff", "#fff", "#dbeafe", "#fde68a", "#fbcfe8"]),
    })),
  })), []);
  const [par, setPar] = useState({ x: 0, y: 0 });
  const move = e => {
    const r = e.currentTarget.getBoundingClientRect();
    setPar({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 });
  };
  const [got, setGot] = useState(false);
  const grab = e => { e.stopPropagation(); if (got) return; setGot(true); win(); };
  const shift = k => `translate(${-par.x * 50 * k}px, ${-par.y * 50 * k}px)`;

  return (
    <Stage won={won} wonText="N'oublie jamais ta serviette !" font={SANS} onPointerMove={move}
      bg="radial-gradient(ellipse at 20% 80%, rgba(124,58,237,.35), transparent 55%), radial-gradient(ellipse at 85% 20%, rgba(14,165,233,.22), transparent 50%), linear-gradient(180deg, #02030c 0%, #070a1f 60%, #0b0820 100%)">
      <style>{`
        @keyframes q42-tw { 0%,100% { opacity:.35 } 50% { opacity:1 } }
        @keyframes q42-drift {
          0% { left:-14%; top:70%; transform:rotate(-20deg) }
          25% { top:58%; transform:rotate(50deg) }
          50% { top:30%; transform:rotate(130deg) }
          75% { top:44%; transform:rotate(230deg) }
          100% { left:108%; top:22%; transform:rotate(340deg) } }
        @keyframes q42-spin { to { transform:rotate(360deg) } }
        @keyframes q42-glow { 0%,100% { text-shadow:0 0 24px rgba(251,191,36,.5) } 50% { text-shadow:0 0 50px rgba(251,191,36,.9) } }
        @keyframes q42-pulse { 0%,100% { filter:drop-shadow(0 0 6px #fde68a) } 50% { filter:drop-shadow(0 0 24px #fde68a) } }
      `}</style>
      {layers.map((l, i) => (
        <div key={i} aria-hidden="true" style={{ position:"absolute", inset:"-6%", transform:shift(l.depth), transition:"transform .4s ease-out", pointerEvents:"none" }}>
          {l.stars.map((s, j) => (
            <span key={j} style={{ position:"absolute", left:`${s.x}%`, top:`${s.y}%`, width:s.s, height:s.s, borderRadius:"50%",
              background:s.c, boxShadow: s.s > 2 ? `0 0 ${s.s * 3}px ${s.c}` : "none",
              animation:`q42-tw ${s.tw}s ease-in-out ${s.d}s infinite` }}/>
          ))}
        </div>
      ))}
      {/* la planete et sa lune */}
      <div aria-hidden="true" style={{ position:"absolute", top:"6%", right:"4%", width:"clamp(120px, 30vw, 230px)", transform:shift(1.6),
        transition:"transform .4s ease-out", pointerEvents:"none" }}>
        <svg viewBox="0 0 200 200" width="100%" style={{ display:"block", overflow:"visible" }}>
          <defs>
            <radialGradient id="q42-pl" cx="35%" cy="32%" r="75%">
              <stop offset="0" stopColor="#fed7aa"/><stop offset=".45" stopColor="#ea580c"/><stop offset="1" stopColor="#2a0a0a"/>
            </radialGradient>
            <clipPath id="q42-clip"><circle cx="100" cy="100" r="58"/></clipPath>
          </defs>
          <g transform="rotate(-18 100 100)">
            <ellipse cx="100" cy="100" rx="96" ry="22" fill="none" stroke="rgba(253,230,138,.35)" strokeWidth="7"/>
          </g>
          <circle cx="100" cy="100" r="58" fill="url(#q42-pl)"/>
          <g clipPath="url(#q42-clip)" opacity=".28">
            <path d="M30 80 Q100 70 170 86" stroke="#7c2d12" strokeWidth="8" fill="none"/>
            <path d="M30 108 Q100 98 170 112" stroke="#fdba74" strokeWidth="5" fill="none"/>
            <path d="M30 130 Q100 124 170 136" stroke="#7c2d12" strokeWidth="6" fill="none"/>
          </g>
          <g transform="rotate(-18 100 100)">
            <path d="M4 100 A96 22 0 0 0 196 100" fill="none" stroke="rgba(253,230,138,.7)" strokeWidth="7"/>
          </g>
          <circle cx="24" cy="30" r="9" fill="#cbd5e1"/><circle cx="21" cy="27" r="3" fill="#94a3b8"/>
        </svg>
      </div>

      <div style={{ position:"relative", zIndex:3, textAlign:"center", maxWidth:560, transform:shift(0.3), transition:"transform .4s ease-out" }}>
        <div style={{ fontSize:"clamp(90px, 26vw, 170px)", fontWeight:900, lineHeight:1, letterSpacing:"-.04em",
          background:"linear-gradient(180deg, #fef3c7, #f59e0b 60%, #b45309)", WebkitBackgroundClip:"text", backgroundClip:"text",
          color:"transparent", animation:"q42-glow 4s ease-in-out infinite", fontFamily:SERIF }}>42</div>
        <p style={{ margin:"6px 0 4px", fontSize:"clamp(18px, 5vw, 26px)", fontWeight:800, color:"#f8fafc" }}>La réponse est 42.</p>
        <p style={{ margin:0, fontSize:"clamp(14px, 4vw, 18px)", color:"#cbd5e1" }}>Mais quelle était la question ?</p>
        <p style={{ margin:"14px 0 0", fontSize:13, fontStyle:"italic", color:"#94a3b8" }}>
          (Probablement : « combien de Benchy avant le Benchy parfait ? »)</p>
        {got && <p style={{ margin:"18px 0 0", fontSize:17, fontWeight:800, color:"#fde68a", animation:"hk-fade .8s both" }}>
          N'oublie jamais ta serviette. Ni ta bobine de rechange.</p>}
      </div>

      <button onClick={grab} aria-label="Une serviette qui dérive" style={{ ...bare, position:"absolute", zIndex:6, width:88, height:70,
        animation:"q42-drift 26s linear -7s infinite", animationPlayState: got ? "paused" : "running" }}>
        <svg viewBox="0 0 80 62" width="88" height="70" style={{ display:"block", animation: got ? "q42-pulse 1.8s ease-in-out infinite" : "none" }}>
          <path d="M8 6 Q40 0 72 6 L70 50 Q40 56 10 50 Z" fill="#0ea5e9"/>
          <path d="M8 6 Q40 0 72 6 L71.4 14 Q40 8 8.6 14 Z" fill="#fbbf24"/>
          <path d="M9.6 40 Q40 36 70.4 40 L70.2 44 Q40 40 9.8 44 Z" fill="#fbbf24"/>
          <text x="40" y="30" textAnchor="middle" fontSize="7.2" fontWeight="900" fill="#fff" fontFamily={SANS}>PAS DE</text>
          <text x="40" y="38" textAnchor="middle" fontSize="7.2" fontWeight="900" fill="#fff" fontFamily={SANS}>PANIQUE</text>
          {Array.from({ length: 15 }, (_, i) => (
            <line key={i} x1={12 + i * 4} y1={50.5 + Math.sin(i) * 0.6} x2={12 + i * 4} y2={57} stroke="#fbbf24" strokeWidth="1.4" strokeLinecap="round"/>
          ))}
        </svg>
      </button>
      <Hint won={won}>Un voyageur galactique a égaré l'objet le plus indispensable de l'univers.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------- benchy */

// une vague repetable : la moitie droite reproduit la gauche (translation de -50 %)
const wavePath = (amp, period, base, w = 2400, h = 100) => {
  let d = `M0 ${base}`;
  for (let x = 0; x < w; x += period) d += ` q${period / 4} ${-amp} ${period / 2} 0 t${period / 2} 0`;
  return `${d} V${h} H0 Z`;
};

function Wave({ amp, period, base, color, height, bottom = 0, dur, z, foam }) {
  const d = useMemo(() => wavePath(amp, period, base), [amp, period, base]);
  return (
    <svg viewBox="0 0 2400 100" preserveAspectRatio="none" aria-hidden="true"
      style={{ position:"absolute", left:0, bottom, width:"200%", height, zIndex:z, pointerEvents:"none",
        animation:`benchy-wave ${dur}s linear infinite` }}>
      <path d={d} fill={color}/>
      {foam && <path d={d} fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>}
    </svg>
  );
}

const BENCHY_SAYS = ["Oh hisse !", "Encore !", "Ça monte !", "Plus haut !", "Hissez haut !"];

function Benchy() {
  const [won, win] = useWin("benchy");
  const [n, setN] = useState(0);
  const pull = e => {
    e.stopPropagation();
    if (n >= 5) return;
    const k = n + 1;
    setN(k);
    if (k === 5) win();
  };
  const gulls = useMemo(() => Array.from({ length: 3 }, (_, i) => ({ top: rand(8, 30), dur: rand(18, 28), delay: -rand(0, 20), s: rand(0.7, 1.2), i })), []);

  return (
    <Stage won={won} wonText="Voile hissée, cap sur la gloire" font={SANS}
      bg="linear-gradient(180deg, #7dd3fc 0%, #bae6fd 42%, #fde68a 62%, #fdba74 70%)">
      <style>{`
        @keyframes benchy-wave { from { transform:translateX(0) } to { transform:translateX(-50%) } }
        @keyframes benchy-rock { 0%,100% { transform:rotate(-4deg) translateY(0) } 50% { transform:rotate(4deg) translateY(-7px) } }
        @keyframes benchy-gull { from { left:-8% } to { left:108% } }
        @keyframes benchy-flap { 0%,100% { transform:scaleY(1) } 50% { transform:scaleY(.3) } }
        @keyframes benchy-cloud { from { transform:translateX(-30vw) } to { transform:translateX(120vw) } }
        @keyframes benchy-smoke { 0% { transform:translate(0,0) scale(.4); opacity:.7 } 100% { transform:translate(14px,-40px) scale(1.6); opacity:0 } }
        @keyframes benchy-say { 0% { transform:translate(-50%, 0) scale(.6); opacity:0 } 25% { transform:translate(-50%, -14px) scale(1.08); opacity:1 }
                                100% { transform:translate(-50%, -46px) scale(1); opacity:0 } }
        @keyframes benchy-flag { 0%,100% { transform:skewY(0) } 50% { transform:skewY(-8deg) } }
        @keyframes benchy-sun { 0%,100% { box-shadow:0 0 60px 20px rgba(253,224,71,.55) } 50% { box-shadow:0 0 90px 34px rgba(253,224,71,.7) } }
      `}</style>
      {/* soleil, nuages, mouettes */}
      <div aria-hidden="true" style={{ position:"absolute", top:"9%", left:"12%", width:72, height:72, borderRadius:"50%",
        background:"radial-gradient(circle, #fffbeb, #fde047 60%, #facc15)", animation:"benchy-sun 5s ease-in-out infinite" }}/>
      {[{ t: "14%", d: 70, dl: -20, s: 1 }, { t: "26%", d: 95, dl: -60, s: 0.7 }, { t: "6%", d: 120, dl: -90, s: 0.85 }].map((c, i) => (
        <div key={i} aria-hidden="true" style={{ position:"absolute", top:c.t, left:0, animation:`benchy-cloud ${c.d}s linear ${c.dl}s infinite`, pointerEvents:"none" }}>
          <div style={{ width:120 * c.s, height:36 * c.s, borderRadius:40, background:"rgba(255,255,255,.9)",
            boxShadow:`${30 * c.s}px ${-14 * c.s}px 0 ${4 * c.s}px rgba(255,255,255,.9), ${-26 * c.s}px ${-6 * c.s}px 0 0 rgba(255,255,255,.85)` }}/>
        </div>
      ))}
      {gulls.map(g => (
        <svg key={g.i} viewBox="0 0 24 10" width={30 * g.s} height={12 * g.s} aria-hidden="true"
          style={{ position:"absolute", top:`${g.top}%`, animation:`benchy-gull ${g.dur}s linear ${g.delay}s infinite`, overflow:"visible" }}>
          <path d="M1 6 Q6 0 12 6 Q18 0 23 6" fill="none" stroke="#334155" strokeWidth="1.8" strokeLinecap="round"
            style={{ transformOrigin:"12px 6px", animation:`benchy-flap ${0.5 + g.i * 0.12}s ease-in-out infinite` }}/>
        </svg>
      ))}

      <Title color="#0c4a6e" style={{ position:"absolute", top:20, left:16, right:16 }}
        sub={n >= 5 ? "Le Benchy file vers l'horizon, fier comme une première couche réussie." : "Le bateau le plus imprimé du monde attend son heure."}>
        <span style={{ textShadow:"0 2px 0 rgba(255,255,255,.6)" }}>Le Grand Large</span>
      </Title>

      <Wave amp={8} period={300} base={40} color="#3b82c4" height="44%" dur={16} z={1}/>
      <div style={{ position:"absolute", left:"50%", bottom:"19%", transform:"translateX(-50%)", width:"min(290px, 76vw)", zIndex:2 }}>
        <button onClick={pull} aria-label="Hisser la voile" style={{ ...bare, width:"100%", display:"block", position:"relative" }}>
          <div style={{ animation:"benchy-rock 4.2s ease-in-out infinite", transformOrigin:"50% 85%" }}>
            <svg viewBox="0 -44 200 204" width="100%" style={{ display:"block", overflow:"visible" }}>
              <defs>
                <linearGradient id="benchy-hull" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#fb923c"/><stop offset="1" stopColor="#c2410c"/>
                </linearGradient>
                <linearGradient id="benchy-sailg" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#ffffff"/><stop offset="1" stopColor="#dbe4ee"/>
                </linearGradient>
                <clipPath id="benchy-clip"><path d="M55 62 L55 -32 Q100 8 130 62 Z"/></clipPath>
              </defs>
              <rect x="50" y="-40" width="4.5" height="150" rx="2" fill="#7c4a1e"/>
              {n >= 5 && (
                <path d="M54.5 -40 L84 -33 L54.5 -26 Z" fill="#22c55e"
                  style={{ transformOrigin:"54px -33px", animation:"benchy-flag .8s ease-in-out infinite" }}/>
              )}
              <g style={{ transformOrigin:"54px 62px", transform:`scaleY(${Math.max(0.03, n / 5)})`,
                transition:"transform .6s cubic-bezier(.3,1.6,.5,1)" }}>
                <path d="M55 62 L55 -32 Q100 8 130 62 Z" fill="url(#benchy-sailg)" stroke="#cbd5e1" strokeWidth="1"/>
                <g clipPath="url(#benchy-clip)">
                  <rect x="50" y="20" width="90" height="9" fill="#22c55e" opacity=".85"/>
                  <rect x="50" y="34" width="90" height="3" fill="#22c55e" opacity=".6"/>
                </g>
              </g>
              {n === 0 && <rect x="56" y="57" width="72" height="7" rx="3.5" fill="#e2e8f0" stroke="#cbd5e1"/>}
              <rect x="54" y="61" width="78" height="3.5" rx="1.5" fill="#7c4a1e"/>
              <path d="M10 104 L150 104 Q172 100 192 88 L176 140 Q100 158 30 144 Z" fill="url(#benchy-hull)"/>
              <path d="M10 104 L150 104 Q172 100 192 88" stroke="#fdba74" strokeWidth="4" fill="none" strokeLinecap="round"/>
              {[60, 92, 124].map(x => <circle key={x} cx={x} cy={122} r={5} fill="#7c2d12" stroke="#fdba74" strokeWidth="2"/>)}
              <rect x="66" y="70" width="76" height="34" rx="3" fill="#f97316"/>
              <rect x="72" y="76" width="18" height="17" rx="3" fill="#1e293b"/>
              <rect x="96" y="76" width="18" height="17" rx="3" fill="#1e293b"/>
              <path d="M120 93 L120 80 Q128 74 136 80 L136 93 Z" fill="#1e293b"/>
              <rect x="60" y="62" width="88" height="9" rx="3" fill="#ea580c"/>
              <rect x="124" y="42" width="13" height="22" rx="2" fill="#ea580c" transform="rotate(-8 130 54)"/>
              {[0, 1, 2].map(i => (
                <circle key={i} cx="131" cy="38" r="6" fill="rgba(255,255,255,.75)"
                  style={{ transformBox:"fill-box", animation:`benchy-smoke 2.4s ease-out ${i * 0.8}s infinite` }}/>
              ))}
              <text x="98" y="139" fontSize="9" fill="#fff7ed" fontWeight="800" textAnchor="middle" fontFamily={SANS}>#3DBENCHY</text>
            </svg>
          </div>
          {n > 0 && (
            <span key={n} style={{ position:"absolute", left:"50%", top:"6%", fontWeight:900, fontSize:18, color:"#fff",
              textShadow:"0 2px 6px rgba(0,0,0,.45)", whiteSpace:"nowrap", pointerEvents:"none",
              animation:"benchy-say 1.1s ease-out forwards" }}>{BENCHY_SAYS[n - 1]}</span>
          )}
        </button>
      </div>
      <Wave amp={10} period={240} base={42} color="rgba(30,95,160,.92)" height="30%" dur={10} z={3} foam/>
      <Wave amp={7} period={400} base={46} color="#164e7a" height="17%" dur={7} z={4} foam/>
      <Hint won={won}>Le Benchy a les voiles en berne. Il a besoin d'un équipage motivé.</Hint>
    </Stage>
  );
}

/* ---------------------------------------------------------------- generique */

const CREDITS = [
  { t: "BAMBUNYMOUS PRODUCTIONS", cls: "small" },
  { t: "présente", cls: "tiny" },
  { t: "Une impression sans fin", cls: "big" },
  { role: "Réalisé par", names: ["Toi"] },
  { role: "Scénario", names: ["Un fichier .3mf retrouvé dans Téléchargements"] },
  { role: "Avec la participation de", names: ["La Buse (0,4 mm)", "Le Plateau texturé", "L'AMS et ses quatre bobines", "Le Benchy, dans son propre rôle"] },
  { role: "Premier rôle", names: ["La Première Couche"] },
  { role: "Cascades", names: ["Le Spaghetti", "(aucun fil n'a été blessé)"] },
  { role: "Effets spéciaux", names: ["Les supports arborescents"] },
  { role: "Maquillage", names: ["Le papier de verre, grain 400"] },
  { role: "Musique originale", names: ["Le ventilateur de pièce, à 100 %"] },
  { role: "Chef opérateur", names: ["La caméra du châssis, en presque 1080p"] },
  { role: "Doublure lumière", names: ["Le cube de calibration"] },
  { role: "Restauration", names: ["Le séchoir à filament"] },
  { role: "Remerciements", names: ["Ceux qui nettoient le plateau à l'alcool", "Le bâton de colle, toujours fidèle", "Le bouton Pause, jamais assez tôt", "La patience, souvent en rupture de stock"] },
  { t: "Aucune bobine n'a été maltraitée pendant le tournage.", cls: "note" },
  { t: "Les personnages et filaments sont imaginaires. Toute ressemblance avec un warping existant serait fortuite.", cls: "note" },
];

function Generique() {
  const [won, win] = useWin("generique");
  const [done, setDone] = useState(false);
  const end = e => { if (e.target !== e.currentTarget || done) return; setDone(true); win(); };
  const gold = { background:"linear-gradient(180deg, #fff7d6, #f5c451 55%, #b7862b)", WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" };

  return (
    <Stage won={won} wonText="Resté jusqu'au bout du générique" font={SERIF}
      bg="radial-gradient(ellipse at center, #121008 0%, #000 75%)">
      <style>{`
        @keyframes generique-roll { from { top:100%; transform:translateY(0) } to { top:0; transform:translateY(-100%) } }
        @keyframes generique-grain { 0%,100% { transform:translate(0,0) } 25% { transform:translate(-2%,1%) } 50% { transform:translate(1%,-2%) } 75% { transform:translate(2%,2%) } }
        @keyframes generique-fin { 0% { opacity:0; letter-spacing:.6em; filter:blur(8px) } 100% { opacity:1; letter-spacing:.25em; filter:blur(0) } }
      `}</style>
      <div style={{ position:"absolute", inset:0, overflow:"hidden" }}>
        {!done && (
          <div onAnimationEnd={end} style={{ position:"absolute", left:0, right:0, padding:"0 20px", textAlign:"center",
            animation:"generique-roll 40s linear forwards" }}>
            {CREDITS.map((c, i) => c.role ? (
              <div key={i} style={{ margin:"0 0 46px" }}>
                <div style={{ fontSize:12, letterSpacing:".32em", textTransform:"uppercase", color:"#a8916a", marginBottom:8, fontFamily:SANS }}>{c.role}</div>
                {c.names.map(nm => <div key={nm} style={{ fontSize:"clamp(19px, 5vw, 26px)", lineHeight:1.45, ...gold }}>{nm}</div>)}
              </div>
            ) : (
              <div key={i} style={{ margin: c.cls === "big" ? "10px 0 90px" : "0 0 30px",
                fontSize: c.cls === "big" ? "clamp(32px, 9vw, 54px)" : c.cls === "small" ? 15 : c.cls === "tiny" ? 13 : 13.5,
                letterSpacing: c.cls === "small" ? ".4em" : 0, fontStyle: c.cls === "note" || c.cls === "tiny" ? "italic" : "normal",
                maxWidth:440, marginLeft:"auto", marginRight:"auto", color: c.cls === "note" ? "#8a7a5c" : undefined,
                ...(c.cls === "note" || c.cls === "tiny" ? {} : gold) }}>{c.t}</div>
            ))}
          </div>
        )}
        <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, top:0, height:"22%", background:"linear-gradient(#000, transparent)", pointerEvents:"none" }}/>
        <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, bottom:0, height:"22%", background:"linear-gradient(transparent, #000)", pointerEvents:"none" }}/>
        <div aria-hidden="true" style={{ position:"absolute", inset:"-10%", pointerEvents:"none", opacity:.07, animation:"generique-grain .5s steps(4) infinite",
          background:"repeating-radial-gradient(circle at 30% 40%, #fff 0 1px, transparent 1px 3px)" }}/>
      </div>
      {done && (
        <div style={{ position:"relative", zIndex:3, textAlign:"center" }}>
          <div style={{ fontSize:"clamp(56px, 16vw, 96px)", animation:"generique-fin 2.4s ease-out both", ...gold }}>FIN</div>
          <div style={{ marginTop:14, color:"#a8916a", fontSize:14, fontStyle:"italic", animation:"hk-fade 2s 1.6s both" }}>
            Scène post-générique : le Benchy reviendra.</div>
        </div>
      )}
      <Hint won={won || done} color="rgba(214,190,140,.7)">Les vrais cinéphiles ne partent jamais avant la fin.</Hint>
    </Stage>
  );
}

/* -------------------------------------------------------------------- neant */

const NEANT_THINGS = [
  { x: 16, y: 16, t: "Il y a quelqu'un ?" },
  { x: 74, y: 12, t: "🕸️", big: true },
  { x: 78, y: 66, t: "Ci-gît un Benchy raté. 2024 – 2024." },
  { x: 22, y: 64, t: "👻", big: true },
  { x: 48, y: 36, t: "Ne te retourne pas… c'est le SAV." },
  { x: 58, y: 86, t: "🦴 restes de supports" },
  { x: 10, y: 42, t: "Chut. Le filament dort." },
  { x: 90, y: 38, t: "🕷️", big: true },
  { x: 30, y: 88, t: "Plus loin… encore." },
  { x: 46, y: 62, t: "👣" },
  { x: 62, y: 52, t: "Tu chauffes. Comme une buse à 220 °C." },
];
const NEANT_SPOTS = [{ x: 32, y: 28 }, { x: 64, y: 24 }, { x: 88, y: 84 }, { x: 10, y: 84 }, { x: 36, y: 50 }, { x: 80, y: 50 }, { x: 22, y: 34 }, { x: 70, y: 76 }];

function Neant() {
  const [won, win] = useWin("neant");
  const box = useRef(null);
  const [p, setP] = useState(null);
  const spot = useMemo(() => pick(NEANT_SPOTS), []);
  const move = e => {
    const r = box.current.getBoundingClientRect();
    setP({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const grab = e => { e.stopPropagation(); win(); };
  const at = p ? `${p.x}px ${p.y}px` : "50% 45%";

  return (
    <Stage won={won} wonText="Une bobine dans le néant" font={SANS} bg="#000" style={{ padding:0 }}>
      <style>{`
        @keyframes neant-flicker { 0%,100% { opacity:1 } 92% { opacity:1 } 93% { opacity:.86 } 95% { opacity:1 } 97% { opacity:.9 } }
        @keyframes neant-sway { 0%,100% { transform:translate(-50%,-50%) rotate(-6deg) } 50% { transform:translate(-50%,-50%) rotate(6deg) } }
      `}</style>
      <div ref={box} onPointerMove={move} onPointerDown={move}
        style={{ position:"absolute", inset:0, touchAction:"none", cursor:"none",
          background:"repeating-linear-gradient(0deg, #1c1917 0 38px, #0c0a09 38px 41px), #1c1917" }}>
        {/* les briques : joints verticaux decales une rangee sur deux */}
        <div aria-hidden="true" style={{ position:"absolute", inset:0, opacity:.7,
          background:"repeating-linear-gradient(90deg, transparent 0 78px, #0c0a09 78px 81px)",
          WebkitMaskImage:"repeating-linear-gradient(0deg, #000 0 41px, transparent 41px 82px)",
          maskImage:"repeating-linear-gradient(0deg, #000 0 41px, transparent 41px 82px)" }}/>
        <div aria-hidden="true" style={{ position:"absolute", inset:0, opacity:.7,
          background:"repeating-linear-gradient(90deg, transparent 0 38px, #0c0a09 38px 41px, transparent 41px 81px)",
          WebkitMaskImage:"repeating-linear-gradient(0deg, transparent 0 41px, #000 41px 82px)",
          maskImage:"repeating-linear-gradient(0deg, transparent 0 41px, #000 41px 82px)" }}/>
        {NEANT_THINGS.map((o, i) => (
          <div key={i} aria-hidden="true" style={{ position:"absolute", left:`${o.x}%`, top:`${o.y}%`, transform:"translate(-50%,-50%)",
            maxWidth:170, textAlign:"center", fontSize: o.big ? 38 : 14, color:"#e7e5e4", fontStyle: o.big ? "normal" : "italic",
            fontFamily: o.big ? SANS : SERIF, textShadow:"0 1px 2px #000", pointerEvents:"none" }}>{o.t}</div>
        ))}
        <button onClick={grab} aria-label="Bobine" style={{ ...bare, position:"absolute", left:`${spot.x}%`, top:`${spot.y}%`,
          width:52, height:52, fontSize:34, transform:"translate(-50%,-50%)", animation:"neant-sway 3s ease-in-out infinite", cursor:"none" }}>🧵</button>
        {won && (
          <div style={{ position:"absolute", left:"50%", top:"50%", transform:"translate(-50%,-50%)", textAlign:"center", zIndex:3,
            padding:"16px 22px", borderRadius:14, background:"rgba(0,0,0,.55)", animation:"hk-fade 1.2s .4s both" }}>
            <div style={{ fontSize:26, fontWeight:900, color:"#fde68a" }}>Lumière !</div>
            <div style={{ marginTop:4, color:"#e7e5e4", fontSize:14 }}>La bobine perdue retrouve son AMS.</div>
          </div>
        )}
        {/* la nuit, percee par la lampe */}
        <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none", zIndex:2,
          opacity: won ? 0 : 1, transition:"opacity 1.6s ease", animation:"neant-flicker 7s linear infinite",
          background:`radial-gradient(circle 135px at ${at}, rgba(255,214,140,.16), rgba(255,214,140,0) 70%),
            radial-gradient(circle 135px at ${at}, rgba(0,0,0,0) 0%, rgba(0,0,0,.25) 55%, rgba(0,0,0,.985) 100%)` }}/>
      </div>
      <Hint won={won} color="rgba(231,229,228,.55)" style={{ background:"rgba(255,255,255,.06)" }}>
        Il fait tout noir. Heureusement, tu as une lampe. Il manque une bobine…</Hint>
    </Stage>
  );
}

/* -------------------------------------------------------------------- retro */

const RETRO_INTRO = [
  "BAMBU-OS v1.0  (c) 1984 BambuNymous Corp.",
  "Mémoire vive : 640 Ko (largement suffisant)",
  "Buse détectée : 0,4 mm ........ OK",
  "Plateau détecté : froid ....... OK",
  "",
  "ACCÈS RESTREINT. Mot de passe requis.",
  "Tapez AIDE si vous êtes perdu.",
];

function retroAnswer(raw) {
  const c = raw.trim().toLowerCase();
  if (!c) return [];
  if (["aide", "help", "?", "h"].includes(c))
    return ["Commandes : AIDE  LS  CAT  DATE  WHOAMI  IMPRIME  SUDO  CLEAR", "Le mot de passe ? C'est le nom de ta meilleure amie à buse."];
  if (c === "ls" || c === "dir") return ["benchy.stl   cube_calibration.stl   secrets/   NE_PAS_OUVRIR.gcode"];
  if (c.startsWith("cd")) return ["Accès refusé. Il faut le mot de passe, petit malin."];
  if (c.startsWith("cat")) {
    if (c.includes("benchy")) return ["Fichier binaire. Ça ressemble vaguement à un bateau."];
    if (c.includes("gcode") || c.includes("ne_pas")) return ["G28 ; retour à la maison", "M104 S220 ; on chauffe", "; ...tu n'aurais pas dû ouvrir ça."];
    return ["Miaou."];
  }
  if (c.startsWith("sudo")) return ["[sudo] mot de passe pour toi : ********", "toi n'apparaît pas dans le fichier sudoers. Cet incident sera signalé."];
  if (c.startsWith("rm")) return ["Non. On ne supprime pas les Benchy."];
  if (c === "date") return ["Nous sommes en 1984. L'impression 3D relève de la science-fiction."];
  if (c === "whoami") return ["Un humain qui parle à un écran vert. Classique."];
  if (["imprime", "print", "imprimer"].includes(c)) return ["Préchauffage de la buse… 12 %… 47 %…", "ERREUR : filament épuisé. Comme d'habitude."];
  if (["exit", "quit", "quitter", "logout"].includes(c)) return ["On ne quitte pas les années 80 comme ça."];
  if (["bonjour", "salut", "hello"].includes(c)) return ["BONJOUR. VOULEZ-VOUS JOUER À UN JEU ?"];
  if (["mot de passe", "password", "mdp", "motdepasse"].includes(c)) return ["Bien essayé. Le mot de passe n'est pas « mot de passe »."];
  if (c.includes("bambu")) return ["Presque. Plus court, plus simple."];
  if (["123456", "admin", "root", "azerty", "0000"].includes(c)) return ["Sérieusement ?"];
  return [`Commande inconnue : ${raw.trim()}. Tapez AIDE.`];
}

function Retro() {
  const [won, win] = useWin("retro");
  const queue = useRef(RETRO_INTRO.slice());
  const st = useRef({ done: [], cur: null, i: 0 });
  const [, setTick] = useState(0);
  const [cmd, setCmd] = useState("");
  const input = useRef(null);
  const screen = useRef(null);
  // une seule machine a ecrire : elle vide la file ligne par ligne
  useEffect(() => {
    const t = setInterval(() => {
      const s = st.current;
      if (s.cur === null) {
        if (!queue.current.length) return;
        s.cur = queue.current.shift();
        s.i = 0;
      }
      s.i += 2;
      if (s.i >= s.cur.length) { s.done.push(s.cur); s.cur = null; if (s.done.length > 80) s.done.splice(0, s.done.length - 80); }
      setTick(x => x + 1);
    }, 24);
    return () => clearInterval(t);
  }, []);
  const s = st.current;
  useEffect(() => { if (screen.current) screen.current.scrollTop = screen.current.scrollHeight; });

  const send = () => {
    const raw = cmd;
    setCmd("");
    s.done.push("> " + raw);
    const c = raw.trim().toLowerCase();
    if (c === "clear" || c === "cls") { s.done = []; queue.current = []; s.cur = null; setTick(x => x + 1); return; }
    if (c === "bambu") {
      win();
      queue.current.push("MOT DE PASSE ACCEPTÉ.", "Chargement ██████████ 100 %", "Bienvenue, opérateur. La buse te salue bien bas.");
    } else queue.current.push(...retroAnswer(raw));
    setTick(x => x + 1);
  };
  const glow = "0 0 2px #7dff9c, 0 0 8px rgba(51,255,102,.6)";

  return (
    <Stage won={won} wonText="Accès BAMBU-OS accordé" font={MONO}
      bg="radial-gradient(ellipse at 50% 30%, #2a2418 0%, #120f0a 70%)">
      <style>{`
        @keyframes retro-flicker { 0%,100% { opacity:1 } 48% { opacity:.965 } 50% { opacity:1 } 77% { opacity:.975 } }
        @keyframes retro-bar { from { transform:translateY(-120%) } to { transform:translateY(420%) } }
        @keyframes retro-caret { 50% { opacity:0 } }
        .retro-in::placeholder { color:rgba(51,255,102,.35) }
      `}</style>
      <div style={{ width:"100%", maxWidth:620, padding:"clamp(12px, 3vw, 22px)", borderRadius:26, position:"relative", zIndex:2,
        background:"linear-gradient(160deg, #e8dfc8, #c9bd9d 60%, #a99c7b)", boxShadow:"0 24px 50px rgba(0,0,0,.6), inset 0 2px 0 rgba(255,255,255,.6), inset 0 -4px 0 rgba(0,0,0,.18)" }}>
        <div onClick={() => input.current && input.current.focus()}
          style={{ position:"relative", borderRadius:"22px / 30px", overflow:"hidden", padding:"18px 18px 14px",
            background:"radial-gradient(ellipse at 50% 45%, #0f3b1c 0%, #072611 55%, #020a04 100%)",
            boxShadow:"inset 0 0 70px rgba(0,0,0,.9), inset 0 0 12px rgba(0,0,0,.8), 0 0 0 6px #2b2b26",
            animation:"retro-flicker 4s infinite", cursor:"text" }}>
          <div ref={screen} style={{ height:"clamp(240px, 46vh, 360px)", overflowY:"auto", color:"#33ff66", textShadow:glow,
            fontSize:"clamp(12.5px, 3.4vw, 15px)", lineHeight:1.5, filter:"blur(.25px)", scrollbarWidth:"none" }}>
            {s.done.map((l, i) => <div key={i} style={{ whiteSpace:"pre-wrap", minHeight:"1.5em" }}>{l}</div>)}
            {s.cur !== null && <div style={{ whiteSpace:"pre-wrap" }}>{s.cur.slice(0, s.i)}<span style={{ animation:"retro-caret .8s step-end infinite" }}>█</span></div>}
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4 }}>
              <span>&gt;</span>
              <input ref={input} className="retro-in" value={cmd} onChange={e => setCmd(e.target.value)} autoFocus
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
                aria-label="Commande" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="_"
                style={{ flex:1, minWidth:0, background:"transparent", border:"none", outline:"none", color:"#33ff66",
                  textShadow:glow, fontFamily:MONO, fontSize:16, caretColor:"#33ff66", padding:"6px 0" }}/>
              <button onClick={e => { e.stopPropagation(); send(); }} aria-label="Valider"
                style={{ ...bare, minWidth:44, height:40, borderRadius:6, border:"1px solid rgba(51,255,102,.5)", color:"#33ff66",
                  textShadow:glow, fontFamily:MONO, fontSize:16 }}>⏎</button>
            </div>
          </div>
          <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none",
            background:"repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 1px, transparent 1px 3px)" }}/>
          <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, top:0, height:"22%", pointerEvents:"none",
            background:"linear-gradient(180deg, transparent, rgba(120,255,160,.06), transparent)", animation:"retro-bar 7s linear infinite" }}/>
          <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none",
            background:"radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.07), transparent 45%)" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10, padding:"0 6px",
          color:"#5b5240", fontSize:11, letterSpacing:".2em", fontFamily:SANS, fontWeight:800 }}>
          <span>BAMBU-TERM 2000</span>
          <span style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ width:9, height:9, borderRadius:"50%", background: won ? "#22c55e" : "#f59e0b",
              boxShadow:`0 0 8px ${won ? "#22c55e" : "#f59e0b"}` }}/>{won ? "ACCÈS" : "VERROU"}
          </span>
        </div>
      </div>
      <Hint won={won} color="rgba(232,223,200,.6)">Ce vieux terminal garde un secret. Il ne s'ouvre qu'avec le bon mot.</Hint>
    </Stage>
  );
}

/* ---------------------------------------------------------------------- zen */

const ZEN_GOAL = 20;
const ZEN_STONE = { x: 0.7, y: 0.36 };

function paintSand(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#ede2c6");
  g.addColorStop(1, "#d8c79f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < (w * h) / 90; i += 1) {
    ctx.fillStyle = Math.random() < 0.5 ? "rgba(120,98,60,.18)" : "rgba(255,250,235,.35)";
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2);
  }
  // les sillons deja traces autour de la pierre
  const cx = w * ZEN_STONE.x, cy = h * ZEN_STONE.y;
  for (let r = 60; r < 150; r += 14) {
    ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.25, r * 0.85, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(120,98,60,.42)"; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.25 + 1.3, r * 0.85 + 1.3, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,250,235,.55)"; ctx.lineWidth = 1.1; ctx.stroke();
  }
}

function Zen() {
  const [won, win] = useWin("zen");
  const box = useRef(null);
  const cv = useRef(null);
  const st = useRef({ on: false, last: null, t: 0, total: 0, w: 0, h: 0 });
  const [calm, setCalm] = useState(0);

  useEffect(() => {
    const el = box.current, c = cv.current;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (Math.round(r.width) === st.current.w && Math.round(r.height) === st.current.h) return;
      st.current.w = Math.round(r.width); st.current.h = Math.round(r.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = r.width * dpr; c.height = r.height * dpr;
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintSand(ctx, r.width, r.height);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pos = e => { const r = cv.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = e => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pas de capture */ }
    st.current.on = true; st.current.last = pos(e); st.current.t = performance.now();
  };
  const up = () => { st.current.on = false; };
  const rake = e => {
    const s = st.current;
    if (!s.on) return;
    const p = pos(e), a = s.last;
    const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy);
    if (d < 1.5) return;
    const now = performance.now();
    s.total += Math.min(0.1, (now - s.t) / 1000);
    s.t = now;
    const nx = -dy / d, ny = dx / d;
    const ctx = cv.current.getContext("2d");
    ctx.lineCap = "round";
    for (let k = -2; k <= 2; k += 1) {
      const ox = nx * k * 8, oy = ny * k * 8;
      ctx.beginPath(); ctx.moveTo(a.x + ox, a.y + oy); ctx.lineTo(p.x + ox, p.y + oy);
      ctx.strokeStyle = "rgba(118,94,55,.5)"; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x + ox + nx * 1.6, a.y + oy + ny * 1.6); ctx.lineTo(p.x + ox + nx * 1.6, p.y + oy + ny * 1.6);
      ctx.strokeStyle = "rgba(255,251,238,.55)"; ctx.lineWidth = 1.2; ctx.stroke();
    }
    s.last = p;
    setCalm(Math.min(ZEN_GOAL, s.total));
    if (s.total >= ZEN_GOAL) win();
  };
  const ratio = calm / ZEN_GOAL;
  const mood = ratio >= 1 ? "Tu es en paix avec le warping." : ratio > 0.66 ? "Même la buse refroidit en silence…"
    : ratio > 0.33 ? "Respire. La première couche viendra." : "Ratisse. Prends ton temps.";

  return (
    <Stage won={won} wonText="Sérénité atteinte" font={SERIF} bg="#d8c79f" style={{ padding:0 }}>
      <style>{`
        @keyframes zen-leaf { 0%,100% { transform:rotate(-4deg) } 50% { transform:rotate(5deg) } }
        @keyframes zen-petal { 0% { transform:translate(0,-10px) rotate(0); opacity:0 } 10% { opacity:1 } 100% { transform:translate(-120px, 110vh) rotate(540deg); opacity:.2 } }
      `}</style>
      <div ref={box} style={{ position:"absolute", inset:0 }}>
        <canvas ref={cv} onPointerDown={down} onPointerMove={rake} onPointerUp={up} onPointerCancel={up}
          style={{ position:"absolute", inset:0, width:"100%", height:"100%", touchAction:"none", cursor:"crosshair" }}/>
        {/* la pierre */}
        <div aria-hidden="true" style={{ position:"absolute", left:`${ZEN_STONE.x * 100}%`, top:`${ZEN_STONE.y * 100}%`, width:96, height:66,
          transform:"translate(-50%,-50%)", borderRadius:"48% 52% 44% 56% / 58% 50% 50% 42%", pointerEvents:"none",
          background:"radial-gradient(ellipse at 35% 30%, #a8a29e, #57534e 55%, #292524)",
          boxShadow:"6px 10px 14px rgba(70,55,30,.45), inset -6px -8px 14px rgba(0,0,0,.35)" }}>
          <div style={{ position:"absolute", left:"22%", top:"8%", width:"46%", height:"24%", borderRadius:"50%",
            background:"radial-gradient(ellipse, rgba(101,163,13,.75), rgba(101,163,13,0) 70%)" }}/>
        </div>
        {/* le bambou, qui grandit avec la serenite */}
        <svg aria-hidden="true" viewBox="0 0 120 320" style={{ position:"absolute", left:6, bottom:0, height:"78%", pointerEvents:"none", overflow:"visible" }}>
          <g style={{ transformOrigin:"60px 320px", transform:`scaleY(${0.32 + 0.68 * ratio})`, transition:"transform 1s ease-out" }}>
            {[{ x: 38, h: 300, w: 11 }, { x: 64, h: 250, w: 9 }, { x: 86, h: 190, w: 8 }].map((b, i) => (
              <g key={i}>
                <rect x={b.x} y={320 - b.h} width={b.w} height={b.h} rx={b.w / 2} fill="#65a30d"/>
                <rect x={b.x + 1.5} y={320 - b.h} width={b.w * 0.3} height={b.h} fill="rgba(255,255,255,.22)"/>
                {Array.from({ length: Math.floor(b.h / 44) }, (_, j) => (
                  <rect key={j} x={b.x - 1} y={320 - (j + 1) * 44} width={b.w + 2} height={3.2} rx={1.5} fill="#3f6212"/>
                ))}
              </g>
            ))}
            {[{ x: 48, y: 40 }, { x: 72, y: 96 }, { x: 94, y: 160 }, { x: 44, y: 130 }].map((l, i) => (
              <g key={i} style={{ opacity: ratio > i * 0.22 ? 1 : 0, transition:"opacity 1.2s" }}>
                <g style={{ transformOrigin:`${l.x}px ${l.y}px`, animation:`zen-leaf ${3 + i * 0.7}s ease-in-out infinite` }}>
                  <path d={`M${l.x} ${l.y} q22 -10 40 2 q-20 8 -40 -2z`} fill="#84cc16"/>
                  <path d={`M${l.x} ${l.y} q-18 -14 -34 -8 q16 10 34 8z`} fill="#4d7c0f"/>
                </g>
              </g>
            ))}
          </g>
        </svg>
        {[0, 1, 2, 3].map(i => (
          <span key={i} aria-hidden="true" style={{ position:"absolute", top:0, left:`${30 + i * 18}%`, width:9, height:7, borderRadius:"60% 0",
            background:"#fbcfe8", pointerEvents:"none", animation:`zen-petal ${14 + i * 3}s linear ${-i * 4}s infinite` }}/>
        ))}
        <div style={{ position:"absolute", top:18, left:0, right:0, textAlign:"center", pointerEvents:"none", color:"#57472a" }}>
          <div style={{ fontSize:"clamp(26px, 7vw, 40px)", fontWeight:700, letterSpacing:".18em" }}>禅 Jardin</div>
          <div style={{ fontSize:14, fontStyle:"italic", marginTop:4, opacity:.8 }}>{mood}</div>
        </div>
        <div style={{ position:"absolute", right:16, bottom:52, width:140, pointerEvents:"none", color:"#57472a", fontFamily:SANS }}>
          <div style={{ fontSize:11, letterSpacing:".2em", textTransform:"uppercase", marginBottom:5, opacity:.75 }}>Sérénité</div>
          <div style={{ height:6, borderRadius:6, background:"rgba(87,71,42,.18)", overflow:"hidden" }}>
            <div style={{ width:`${ratio * 100}%`, height:"100%", borderRadius:6, background:"linear-gradient(90deg, #a3e635, #65a30d)",
              transition:"width .3s" }}/>
          </div>
        </div>
      </div>
      <Hint won={won} color="#57472a" style={{ background:"rgba(255,250,235,.55)" }}>Le sable attend le râteau. Personne ne te presse.</Hint>
    </Stage>
  );
}

/* -------------------------------------------------------------------- disco */

const DISCO_COLORS = ["#ec4899", "#a855f7", "#3b82f6", "#22c55e", "#f59e0b", "#06b6d4", "#ef4444"];

function Disco() {
  const [won, win] = useWin("disco");
  const [hits, setHits] = useState(0);
  const party = hits >= 10;
  const k = party ? 0.2 : 1 / (1 + hits * 0.3);
  const hit = e => {
    e.stopPropagation();
    if (hits >= 10) return;
    const n = hits + 1;
    setHits(n);
    if (n === 10) win();
  };
  const tiles = useMemo(() => Array.from({ length: 48 }, (_, i) => ({ d: -rand(0, 4), dim: (i + Math.floor(i / 8)) % 2 === 0 })), []);
  const facets = "repeating-linear-gradient(90deg, rgba(15,23,42,.5) 0 1.5px, transparent 1.5px 13px), repeating-linear-gradient(0deg, rgba(15,23,42,.5) 0 1.5px, transparent 1.5px 13px), repeating-linear-gradient(90deg, #f8fafc 0 13px, #94a3b8 13px 26px, #e2e8f0 26px 39px, #c4b5fd 39px 52px, #cbd5e1 52px 65px, #fbcfe8 65px 78px)";

  return (
    <Stage won={won} wonText="La fête est lancée !" font={SANS} style={{ justifyContent:"flex-start" }}
      bg="radial-gradient(ellipse at 50% 10%, #3b0764 0%, #1e1b4b 40%, #05030f 85%)">
      <style>{`
        @keyframes disco-facets { to { transform:translateX(-50%) } }
        @keyframes disco-sweep { to { transform:rotate(360deg) } }
        @keyframes disco-tile { 0%,100% { background:#ec4899; box-shadow:0 0 18px #ec4899 } 25% { background:#a855f7; box-shadow:0 0 18px #a855f7 }
                                50% { background:#3b82f6; box-shadow:0 0 18px #3b82f6 } 75% { background:#22c55e; box-shadow:0 0 18px #22c55e } }
        @keyframes disco-bump { 0% { transform:scale(1) } 30% { transform:scale(1.12) } 100% { transform:scale(1) } }
        @keyframes disco-swing { 0%,100% { transform:translateX(-50%) rotate(-3deg) } 50% { transform:translateX(-50%) rotate(3deg) } }
        @keyframes disco-spark { 0%,100% { opacity:0; transform:scale(.4) rotate(0) } 50% { opacity:1; transform:scale(1) rotate(45deg) } }
        @keyframes disco-dance { 0%,100% { transform:translateY(0) rotate(-8deg) } 50% { transform:translateY(-16px) rotate(8deg) } }
        @keyframes disco-strobe { 0%,88%,100% { opacity:0 } 92% { opacity:.22 } }
      `}</style>
      {/* faisceaux */}
      <div aria-hidden="true" style={{ position:"absolute", left:"50%", top:118, width:0, height:0, zIndex:1,
        animation:`disco-sweep ${14 * k}s linear infinite`, pointerEvents:"none" }}>
        {DISCO_COLORS.map((c, i) => (
          <div key={i} style={{ position:"absolute", left:-40, top:0, width:80, height:900, transformOrigin:"50% 0",
            transform:`rotate(${(360 / DISCO_COLORS.length) * i}deg)`, clipPath:"polygon(50% 0, 100% 100%, 0 100%)",
            background:`linear-gradient(180deg, ${c}, transparent 80%)`, opacity: 0.28 + Math.min(0.3, hits * 0.03), mixBlendMode:"screen" }}/>
        ))}
      </div>
      {/* la boule */}
      <div style={{ position:"absolute", left:"50%", top:0, zIndex:4, display:"flex", flexDirection:"column",
        alignItems:"center", transformOrigin:"50% 0", animation:`disco-swing ${4 * k}s ease-in-out infinite` }}>
        <div style={{ width:2, height:40, background:"linear-gradient(#64748b, #cbd5e1)" }}/>
        <button key={hits} onClick={hit} aria-label="Boule à facettes" style={{ ...bare, width:156, height:156, borderRadius:"50%",
          animation:"disco-bump .35s ease-out" }}>
          <div style={{ position:"relative", width:156, height:156, borderRadius:"50%", overflow:"hidden",
            boxShadow:`0 0 ${30 + hits * 6}px rgba(255,255,255,${0.25 + hits * 0.04}), 0 0 80px rgba(168,85,247,.5)` }}>
            <div style={{ position:"absolute", top:0, left:0, width:"200%", height:"100%", background:facets,
              animation:`disco-facets ${6 * k}s linear infinite` }}/>
            <div style={{ position:"absolute", inset:0, borderRadius:"50%",
              background:"radial-gradient(circle at 34% 28%, rgba(255,255,255,.95) 0 6%, rgba(255,255,255,0) 26%), radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 48%, rgba(10,5,30,.75) 74%)" }}/>
          </div>
        </button>
        {[{ x: -100, y: 70 }, { x: 90, y: 120 }, { x: -80, y: 170 }, { x: 84, y: 40 }].map((s, i) => (
          <span key={i} aria-hidden="true" style={{ position:"absolute", left:`calc(50% + ${s.x}px)`, top:s.y, color:"#fff", fontSize:18,
            animation:`disco-spark ${1.6 * k + 0.3}s ease-in-out ${i * 0.4}s infinite`, pointerEvents:"none" }}>✦</span>
        ))}
      </div>

      <div style={{ position:"relative", zIndex:5, marginTop:210, textAlign:"center" }}>
        <Title color="#fdf4ff" sub={party ? "La fête bat son plein ! Même l'AMS se déhanche." : "La piste est prête. La boule, un peu moins."}>
          <span style={{ background:"linear-gradient(90deg, #f472b6, #c084fc, #60a5fa, #34d399)", WebkitBackgroundClip:"text",
            backgroundClip:"text", color:"transparent" }}>Filament Fever</span>
        </Title>
        <div aria-label="Ambiance" style={{ display:"flex", gap:4, justifyContent:"center", alignItems:"flex-end", height:24, marginTop:12 }}>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} style={{ width:12, height:6 + i * 1.6, borderRadius:2,
              background: i < hits ? DISCO_COLORS[i % DISCO_COLORS.length] : "rgba(255,255,255,.12)",
              boxShadow: i < hits ? `0 0 8px ${DISCO_COLORS[i % DISCO_COLORS.length]}` : "none", transition:"background .2s" }}/>
          ))}
        </div>
      </div>

      {/* la piste */}
      <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, bottom:0, height:"36%", perspective:420, zIndex:2, pointerEvents:"none" }}>
        <div style={{ position:"absolute", left:"-30%", width:"160%", bottom:0, height:"190%", transformOrigin:"50% 100%",
          transform:"rotateX(62deg)", display:"grid", gridTemplateColumns:"repeat(8, 1fr)", gridTemplateRows:"repeat(6, 1fr)", gap:4 }}>
          {tiles.map((t, i) => (
            <div key={i} style={{ borderRadius:3, opacity: t.dim ? 0.35 : 0.9, animation:`disco-tile ${4 * k}s steps(1) ${t.d}s infinite` }}/>
          ))}
        </div>
      </div>
      {party && (
        <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, bottom:"14%", display:"flex", justifyContent:"space-around",
          zIndex:6, fontSize:40, pointerEvents:"none" }}>
          {["🕺", "💃", "🦖", "💃", "🕺"].map((d, i) => (
            <span key={i} style={{ animation:`disco-dance ${0.42 + i * 0.05}s ease-in-out ${i * 0.1}s infinite` }}>{d}</span>
          ))}
        </div>
      )}
      {party && <div aria-hidden="true" style={{ position:"absolute", inset:0, background:"#fff", zIndex:7, pointerEvents:"none",
        animation:"disco-strobe .9s linear infinite" }}/>}
      <Hint won={won}>Cette boule manque cruellement d'élan. Donne-lui de quoi lancer la soirée.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------- envers */

const ENV_WORD = "BAMBU";
const ENV_ROWS = ["ABCDEFG", "HIJKLMN", "OPQRSTU", "VWXYZ"];
const ENV_BULBS = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#ec4899", "#f97316"];

function Envers() {
  const [won, win] = useWin("envers");
  const later = useTimers();
  const [prog, setProg] = useState(0);
  const [flash, setFlash] = useState(null);
  const [err, setErr] = useState(false);
  const tilt = useMemo(() => Object.fromEntries(ENV_ROWS.join("").split("").map(l => [l, rand(-9, 9)])), []);
  const spores = useMemo(() => Array.from({ length: 34 }, () => ({ x: rand(0, 100), s: rand(2, 5), d: rand(10, 22), dl: -rand(0, 22), dx: rand(-40, 40) })), []);
  const press = L => {
    if (won || err) return;
    setFlash(L);
    later(() => setFlash(f => (f === L ? null : f)), 650);
    if (L === ENV_WORD[prog]) {
      const n = prog + 1;
      setProg(n);
      if (n === ENV_WORD.length) win();
    } else {
      setErr(true);
      later(() => { setErr(false); setProg(0); }, 1000);
    }
  };
  const lit = new Set(ENV_WORD.slice(0, prog).split(""));
  let idx = 0;

  return (
    <Stage won={won} wonText="Message reçu de l'Envers" font={SERIF}
      bg="radial-gradient(ellipse at 50% 110%, rgba(220,38,38,.35), transparent 55%), linear-gradient(180deg, #0a0f1f 0%, #1a0b16 55%, #2a0a0e 100%)">
      <style>{`
        @keyframes envers-spore { from { transform:translate(0, 0) } to { transform:translate(var(--dx), -110vh) } }
        @keyframes envers-storm { 0%,90%,94%,100% { opacity:0 } 91% { opacity:.35 } 92% { opacity:.08 } 93% { opacity:.28 } }
        @keyframes envers-err { 0%,100% { opacity:.15 } 20%,60% { opacity:1 } 40%,80% { opacity:.1 } }
        @keyframes envers-shake { 0%,100% { transform:translateX(0) } 25% { transform:translateX(-6px) } 75% { transform:translateX(6px) } }
        @keyframes envers-vine { 0%,100% { transform:rotate(-2deg) } 50% { transform:rotate(2deg) } }
        @keyframes envers-win { 0%,100% { opacity:1 } 50% { opacity:.55 } }
      `}</style>
      {spores.map((s, i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", bottom:-10, left:`${s.x}%`, width:s.s, height:s.s, borderRadius:"50%",
          background:"rgba(226,232,240,.55)", boxShadow:"0 0 6px rgba(226,232,240,.5)", pointerEvents:"none", "--dx":`${s.dx}px`,
          animation:`envers-spore ${s.d}s linear ${s.dl}s infinite` }}/>
      ))}
      <div aria-hidden="true" style={{ position:"absolute", inset:0, background:"#dc2626", mixBlendMode:"screen", pointerEvents:"none",
        animation:"envers-storm 9s linear infinite" }}/>
      {/* la foret, la tete en bas */}
      <svg aria-hidden="true" viewBox="0 0 400 90" preserveAspectRatio="none"
        style={{ position:"absolute", top:0, left:0, width:"100%", height:90, transform:"scaleY(-1)", pointerEvents:"none", opacity:.9 }}>
        <path d="M0 90 V60 L12 30 L22 58 L34 18 L48 60 L58 40 L70 62 L84 10 L98 58 L110 36 L124 64 L140 22 L154 60 L166 44 L180 66 L196 14 L210 60 L222 40 L236 64 L252 24 L266 58 L280 34 L294 66 L310 16 L324 58 L338 38 L352 64 L368 20 L382 58 L400 40 V90Z" fill="#05070d"/>
      </svg>
      {[8, 22, 64, 80, 92].map((x, i) => (
        <svg key={i} aria-hidden="true" viewBox="0 0 20 120" width="20" height={70 + i * 14}
          style={{ position:"absolute", top:60, left:`${x}%`, transformOrigin:"10px 0", animation:`envers-vine ${5 + i}s ease-in-out infinite`, pointerEvents:"none" }}>
          <path d="M10 0 Q2 30 12 60 Q20 90 8 120" stroke="#1e1b1b" strokeWidth="3" fill="none"/>
        </svg>
      ))}

      <div style={{ position:"relative", zIndex:3, transform:"rotate(180deg)", textAlign:"center", marginBottom:16 }}>
        <div style={{ fontSize:"clamp(30px, 8vw, 50px)", fontWeight:700, letterSpacing:".06em", color:"transparent",
          WebkitTextStroke:"1.5px #ef4444", textShadow:"0 0 18px rgba(239,68,68,.75), 0 0 40px rgba(239,68,68,.4)" }}>BAMBU THINGS</div>
        <div style={{ fontSize:13, color:"#fca5a5", fontStyle:"italic", marginTop:4 }}>Ici, même le plateau est à l'envers.</div>
      </div>

      <div style={{ position:"relative", zIndex:3, width:"100%", maxWidth:390, padding:"12px 6px 16px", borderRadius:6,
        background:"radial-gradient(circle at 25% 25%, rgba(120,72,40,.32) 0 5px, transparent 6px) 0 0 / 36px 36px, radial-gradient(circle at 75% 75%, rgba(77,98,52,.3) 0 4px, transparent 5px) 0 0 / 36px 36px, linear-gradient(180deg, #d9c9a2, #b9a67c)",
        boxShadow:"inset 0 0 60px rgba(40,20,10,.65), 0 20px 40px rgba(0,0,0,.6)",
        animation: err ? "envers-shake .25s linear 3" : "none" }}>
        {ENV_ROWS.map(row => (
          <div key={row} style={{ position:"relative", display:"flex", justifyContent:"center", gap:2, marginBottom:4 }}>
            <svg aria-hidden="true" viewBox="0 0 300 16" preserveAspectRatio="none" style={{ position:"absolute", left:6, right:6, top:2, width:"calc(100% - 12px)", height:16, pointerEvents:"none" }}>
              <path d="M0 4 Q21 14 43 4 T86 4 T129 4 T172 4 T215 4 T258 4 T300 4" stroke="#1f2937" strokeWidth="1.6" fill="none"/>
            </svg>
            {row.split("").map(L => {
              const color = ENV_BULBS[idx++ % ENV_BULBS.length];
              const on = won || flash === L || lit.has(L);
              return (
                <button key={L} onClick={() => press(L)} aria-label={`Lettre ${L}`}
                  style={{ ...bare, width:42, minHeight:72, display:"flex", flexDirection:"column", alignItems:"center", paddingTop:6 }}>
                  <svg viewBox="0 0 18 26" width="18" height="26" style={{ overflow:"visible",
                    filter: on ? `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 14px ${color})` : "none",
                    animation: err ? "envers-err .9s linear" : won ? `envers-win ${0.8 + (idx % 5) * 0.2}s ease-in-out infinite` : "none" }}>
                    <rect x="6" y="0" width="6" height="6" rx="1" fill="#1f2937"/>
                    <path d="M9 5 C2 9 3 18 9 25 C15 18 16 9 9 5Z" fill={on || err ? color : "rgba(255,255,255,.18)"}
                      stroke={on ? "#fff" : "rgba(0,0,0,.35)"} strokeWidth=".8"/>
                  </svg>
                  <span style={{ fontFamily:"Impact, 'Arial Black', sans-serif", fontSize:30, lineHeight:1.15, color:"#141010",
                    transform:`rotate(${tilt[L]}deg)`, textShadow:"1px 1px 0 rgba(0,0,0,.25)", opacity:.88 }}>{L}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ position:"relative", zIndex:3, display:"flex", gap:8, marginTop:16 }}>
        {ENV_WORD.split("").map((c, i) => (
          <span key={i} style={{ width:30, height:38, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:6,
            border:"1px solid rgba(252,165,165,.35)", color:"#fecaca", fontSize:22, fontFamily:"Impact, 'Arial Black', sans-serif",
            background: i < prog ? "rgba(239,68,68,.25)" : "rgba(0,0,0,.3)", textShadow: i < prog ? "0 0 10px #ef4444" : "none" }}>
            {i < prog ? c : ""}</span>
        ))}
      </div>
      <div style={{ position:"relative", zIndex:3, minHeight:22, marginTop:8, fontSize:13, color:"#fca5a5", fontStyle:"italic" }}>
        {err ? "Les lumières s'éteignent… Le message s'est perdu." : won ? "Bien reçu. Ne réponds pas, ça porte malheur." : ""}</div>
      <Hint won={won} color="rgba(254,202,202,.7)">De l'autre côté, quelqu'un attend que tu épelles le nom de ta marque d'imprimante.</Hint>
    </Stage>
  );
}

/* --------------------------------------------------------------------- cafe */

const CAFE_NO = [
  "418 : je suis une théière, tu le sais bien.",
  "Je fais du thé. Uniquement. Depuis 1998.",
  "Café ? Connais pas. Un Earl Grey, peut-être ?",
  "Ma buse est réglée pour l'infusion, pas pour l'extraction.",
  "Tu insistes… c'est presque mignon.",
  "Erreur 418 bis : toujours une théière.",
  "Je sens une légère pression… non, fausse alerte.",
  "Il me reste peut-être un grain, quelque part, au fond…",
  "Arrête, je vais finir par craquer.",
];

function Cafe() {
  const [won, win] = useWin("cafe");
  const later = useTimers();
  const [n, setN] = useState(0);
  const [phase, setPhase] = useState("no");
  const ask = () => {
    if (phase !== "no") return;
    const k = n + 1;
    setN(k);
    if (k >= 10) {
      setPhase("pour");
      later(() => { setPhase("done"); win(); }, 2600);
    }
  };
  const msg = phase === "pour" ? "Bon… d'accord. Mais tu ne le dis à personne."
    : phase === "done" ? "Voilà ton espresso. Je retourne être une théière."
    : n === 0 ? "Bonjour. Je suis une machine à café. Enfin, en théorie." : CAFE_NO[(n - 1) % CAFE_NO.length];
  const needle = -120 + Math.min(n, 10) * 24;
  const served = phase !== "no";

  return (
    <Stage won={won} wonText="Un café arraché à une théière" font={SANS}
      bg="radial-gradient(ellipse at 50% 0%, rgba(253,230,138,.22), transparent 55%), linear-gradient(180deg, #3b2416 0%, #2a1a10 66%, #7a4a28 66%, #5a3520 100%)">
      <style>{`
        @keyframes cafe-shake { 0%,100% { transform:rotate(0) } 20% { transform:rotate(-2.5deg) } 40% { transform:rotate(2.5deg) } 60% { transform:rotate(-1.5deg) } 80% { transform:rotate(1deg) } }
        @keyframes cafe-puff { 0% { transform:translateY(0) scale(.4); opacity:.8 } 100% { transform:translateY(-50px) scale(1.8); opacity:0 } }
        @keyframes cafe-pour { 0% { transform:scaleY(0) } 15%,85% { transform:scaleY(1) } 100% { transform:scaleY(1); opacity:0 } }
        @keyframes cafe-steam { 0% { transform:translateY(0); opacity:0 } 30% { opacity:.8 } 100% { transform:translateY(-30px); opacity:0 } }
        @keyframes cafe-fill { from { transform:scaleY(0) } to { transform:scaleY(1) } }
        @keyframes cafe-bubble { from { transform:translateY(8px) scale(.9); opacity:0 } to { transform:none; opacity:1 } }
      `}</style>
      <div aria-hidden="true" style={{ position:"absolute", top:16, left:16, padding:"8px 12px", borderRadius:6, background:"#1f2a1f",
        border:"5px solid #6b4423", color:"rgba(255,255,255,.82)", fontFamily:"'Comic Sans MS', 'Chalkboard SE', cursive", fontSize:12,
        lineHeight:1.4, transform:"rotate(-3deg)", boxShadow:"0 6px 14px rgba(0,0,0,.4)" }}>
        <div style={{ fontWeight:700, textDecoration:"underline" }}>Carte</div>
        <div>Thé · Thé · Thé</div><div>Thé (glacé)</div>
      </div>

      <div key={msg} style={{ position:"relative", zIndex:3, maxWidth:320, marginTop:40, padding:"12px 16px", borderRadius:16,
        background:"#fffbeb", color:"#3b2416", fontWeight:700, fontSize:15, textAlign:"center", boxShadow:"0 8px 20px rgba(0,0,0,.35)",
        animation:"cafe-bubble .3s ease-out both" }}>
        {msg}
        <span aria-hidden="true" style={{ position:"absolute", left:"50%", bottom:-9, width:18, height:18, background:"#fffbeb",
          transform:"translateX(-50%) rotate(45deg)" }}/>
      </div>

      <div key={`m${n}`} style={{ position:"relative", zIndex:2, width:"min(260px, 70vw)", marginTop:18,
        animation: n > 0 && !served ? "cafe-shake .45s ease-in-out" : "none", transformOrigin:"50% 100%" }}>
        {n > 0 && !served && [0, 1].map(i => (
          <span key={i} aria-hidden="true" style={{ position:"absolute", left:`${40 + i * 18}%`, top:0, width:26, height:26, borderRadius:"50%",
            background:"rgba(255,255,255,.55)", animation:`cafe-puff 1s ease-out ${i * 0.15}s both`, pointerEvents:"none" }}/>
        ))}
        <svg viewBox="0 0 240 262" width="100%" style={{ display:"block", overflow:"visible" }}>
          <defs>
            <linearGradient id="cafe-steel" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#6b7280"/><stop offset=".3" stopColor="#e5e7eb"/><stop offset=".55" stopColor="#9ca3af"/>
              <stop offset=".78" stopColor="#f3f4f6"/><stop offset="1" stopColor="#6b7280"/>
            </linearGradient>
          </defs>
          {[60, 104, 148].map(x => (
            <g key={x}><path d={`M${x} 6 L${x + 26} 6 L${x + 23} 22 L${x + 3} 22 Z`} fill="#f8fafc"/><rect x={x - 2} y="21" width="30" height="3" rx="1.5" fill="#e2e8f0"/></g>
          ))}
          <rect x="20" y="24" width="200" height="24" rx="8" fill="url(#cafe-steel)"/>
          <rect x="28" y="44" width="184" height="182" rx="14" fill="url(#cafe-steel)" stroke="rgba(0,0,0,.2)"/>
          <rect x="44" y="60" width="104" height="42" rx="6" fill="#0b0f19" stroke="#374151" strokeWidth="3"/>
          <text x="96" y="90" textAnchor="middle" fontSize="25" fontWeight="700" fontFamily={MONO} fill={served ? "#4ade80" : "#ef4444"}
            style={{ filter:`drop-shadow(0 0 4px ${served ? "#4ade80" : "#ef4444"})` }}>{served ? "OK" : "418"}</text>
          <circle cx="182" cy="81" r="20" fill="#f8fafc" stroke="#9ca3af" strokeWidth="4"/>
          {Array.from({ length: 11 }, (_, i) => {
            const a = ((-120 + i * 24) - 90) * Math.PI / 180;
            return <line key={i} x1={182 + Math.cos(a) * 13} y1={81 + Math.sin(a) * 13} x2={182 + Math.cos(a) * 16} y2={81 + Math.sin(a) * 16}
              stroke={i > 7 ? "#ef4444" : "#475569"} strokeWidth="1.5"/>;
          })}
          <line x1="182" y1="81" x2="182" y2="66" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round"
            style={{ transformOrigin:"182px 81px", transform:`rotate(${needle}deg)`, transition:"transform .4s cubic-bezier(.3,1.6,.5,1)" }}/>
          <circle cx="182" cy="81" r="2.6" fill="#111"/>
          <text x="120" y="120" textAnchor="middle" fontSize="9" fontWeight="800" letterSpacing="2" fill="#374151">BAMBU EXPRESSO</text>
          <path d="M46 132 L46 192 Q46 200 54 202" stroke="#9ca3af" strokeWidth="5" fill="none" strokeLinecap="round"/>
          <rect x="88" y="128" width="64" height="16" rx="4" fill="#374151"/>
          <rect x="94" y="144" width="52" height="8" rx="3" fill="#1f2937"/>
          <rect x="86" y="150" width="68" height="12" rx="6" fill="#111827"/>
          <rect x="150" y="152" width="64" height="9" rx="4.5" fill="#000"/>
          {phase === "pour" && <rect x="117" y="162" width="6" height="34" fill="#5b3416"
            style={{ transformOrigin:"120px 162px", animation:"cafe-pour 2.5s ease-in-out forwards" }}/>}
          {served && (
            <g style={{ animation:"hk-fade .4s both" }}>
              <ellipse cx="120" cy="225" rx="32" ry="4" fill="#e5e7eb"/>
              <path d="M98 194 L142 194 L138 222 Q120 228 102 222 Z" fill="#fff"/>
              <path d="M141 200 q13 2 8 12 q-3 6 -10 4" stroke="#fff" strokeWidth="4" fill="none"/>
              <ellipse cx="120" cy="196" rx="20" ry="3" fill="#c08a4d"
                style={{ transformOrigin:"120px 196px", animation:"cafe-fill 2.2s ease-in both" }}/>
            </g>
          )}
          {phase === "done" && [0, 1, 2].map(i => (
            <path key={i} d={`M${112 + i * 8} 188 q-4 -6 0 -12 q4 -6 0 -12`} stroke="rgba(255,255,255,.7)" strokeWidth="2" fill="none"
              strokeLinecap="round" style={{ animation:`cafe-steam 2s ease-out ${i * 0.5}s infinite` }}/>
          ))}
          <rect x="38" y="226" width="164" height="14" rx="4" fill="#374151"/>
          {Array.from({ length: 13 }, (_, i) => <rect key={i} x={46 + i * 12} y="229" width="6" height="8" rx="1" fill="#1f2937"/>)}
          <rect x="44" y="240" width="18" height="8" rx="2" fill="#1f2937"/><rect x="178" y="240" width="18" height="8" rx="2" fill="#1f2937"/>
        </svg>
      </div>
      <Btn onClick={ask} color={served ? "#57534e" : "#b45309"} disabled={served}
        style={{ position:"relative", zIndex:3, marginTop:18, minHeight:48, minWidth:160, fontSize:17, opacity: served ? 0.6 : 1 }}>
        ☕ Un café !</Btn>
      <Hint won={won} color="rgba(253,230,138,.7)">Elle dit non. Mais la persévérance, c'est comme la première couche : ça finit par accrocher.</Hint>
    </Stage>
  );
}

/* --------------------------------------------------------------------- labo */

const LABO_FLASKS = [
  { id: "jaune", c: "#facc15" }, { id: "bleu", c: "#3b82f6" }, { id: "violet", c: "#a855f7" }, { id: "rouge", c: "#ef4444" }, { id: "vert", c: "#22c55e" },
];
const LABO_ORDER = ["bleu", "rouge", "vert"];

function Flask({ c, pouring }) {
  return (
    <svg viewBox="0 0 60 92" width="52" height="80" style={{ display:"block", overflow:"visible",
      transform: pouring ? "rotate(-38deg) translateY(-14px)" : "none", transition:"transform .3s ease", transformOrigin:"50% 80%" }}>
      <rect x="23" y="0" width="14" height="9" rx="2" fill="#92400e"/>
      <path d="M15 59 L45 59 L52 78 Q54 86 46 86 L14 86 Q6 86 8 78 Z" fill={c} opacity=".9"/>
      <path d="M15 59 L45 59 L47 64 L13 64 Z" fill="rgba(255,255,255,.25)"/>
      {[0, 1, 2].map(i => (
        <circle key={i} cx={22 + i * 8} cy="80" r={1.6 + i * 0.5} fill="rgba(255,255,255,.75)"
          style={{ transformBox:"fill-box", animation:`labo-bub ${1.2 + i * 0.35}s ease-in ${i * 0.4}s infinite` }}/>
      ))}
      <path d="M24 8 L24 32 L8 78 Q6 86 14 86 L46 86 Q54 86 52 78 L36 32 L36 8" fill="rgba(255,255,255,.06)"
        stroke="rgba(226,232,240,.75)" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M28 14 L28 34 L16 70" stroke="rgba(255,255,255,.35)" strokeWidth="2" fill="none" strokeLinecap="round"/>
    </svg>
  );
}

function Labo() {
  const [won, win] = useWin("labo");
  const later = useTimers();
  const [seq, setSeq] = useState([]);
  const [pour, setPour] = useState(null);
  const [fx, setFx] = useState(null);
  const tap = f => {
    if (pour || fx || won) return;
    setPour(f);
    later(() => {
      setPour(null);
      if (f.id === LABO_ORDER[seq.length]) {
        const s = [...seq, f.id];
        setSeq(s);
        if (s.length === LABO_ORDER.length) { setFx("boom"); win(); }
      } else {
        setFx("smoke");
        later(() => { setFx(null); setSeq([]); }, 1600);
      }
    }, 750);
  };
  const mix = fx === "smoke" ? "#57534e" : seq.length ? LABO_FLASKS.find(f => f.id === seq[seq.length - 1]).c : "#4d7c0f";
  const sparks = useMemo(() => Array.from({ length: 44 }, (_, i) => {
    const a = rand(0, Math.PI * 2), d = rand(60, 170);
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d - 40, c: pick(["#facc15", "#f472b6", "#60a5fa", "#4ade80", "#fff", "#c084fc"]), s: rand(4, 9), dl: rand(0, 1.6), i };
  }), []);
  const chalk = "'Comic Sans MS', 'Chalkboard SE', 'Segoe Print', cursive";

  return (
    <Stage won={won} wonText="Potion n° 42 réussie" font={SANS}
      bg="radial-gradient(ellipse at 50% 60%, rgba(74,222,128,.14), transparent 60%), repeating-linear-gradient(0deg, #1b1f24 0 30px, #121518 30px 32px), #1b1f24">
      <style>{`
        @keyframes labo-bub { 0% { transform:translateY(0); opacity:0 } 20% { opacity:1 } 100% { transform:translateY(-22px); opacity:0 } }
        @keyframes labo-flame { 0%,100% { transform:scaleY(1) } 50% { transform:scaleY(1.25) } }
        @keyframes labo-drop { 0% { transform:translate(-50%, -60px) scale(.6); opacity:1 } 90% { opacity:1 } 100% { transform:translate(-50%, 34px) scale(1); opacity:0 } }
        @keyframes labo-smoke { 0% { transform:translate(-50%, 0) scale(.5); opacity:.85 } 100% { transform:translate(calc(-50% + var(--dx)), -120px) scale(2.4); opacity:0 } }
        @keyframes labo-burst { 0% { transform:translate(-50%,-50%) scale(1); opacity:1 } 100% { transform:translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.2); opacity:0 } }
        @keyframes labo-rainbow { 0% { filter:hue-rotate(0) } 100% { filter:hue-rotate(360deg) } }
        @keyframes labo-pop { 0%,100% { transform:scale(.6); opacity:0 } 50% { transform:scale(1); opacity:1 } }
      `}</style>
      {/* le tableau noir */}
      <div style={{ position:"relative", zIndex:2, width:"100%", maxWidth:420, padding:"12px 16px", borderRadius:6, background:"#20302a",
        border:"8px solid #6b4423", boxShadow:"0 10px 24px rgba(0,0,0,.5), inset 0 0 30px rgba(0,0,0,.4)", color:"rgba(255,255,255,.88)",
        fontFamily:chalk, fontSize:"clamp(13px, 3.6vw, 15px)", lineHeight:1.45, textAlign:"center" }}>
        <div style={{ fontSize:17, textDecoration:"underline", marginBottom:4 }}>Potion n° 42</div>
        <div>D'abord le ciel sans nuage,</div>
        <div>puis le feu sous la buse,</div>
        <div>enfin l'herbe du plateau.</div>
        <div style={{ marginTop:4, opacity:.7, fontSize:12 }}>Trois gouttes. Pas une de plus.  (E = mc² + PLA)</div>
      </div>

      {/* le chaudron */}
      <div style={{ position:"relative", zIndex:2, width:200, marginTop:22 }}>
        {pour && <span aria-hidden="true" style={{ position:"absolute", left:"50%", top:0, width:12, height:16, borderRadius:"50% 50% 50% 50% / 60% 60% 40% 40%",
          background:pour.c, boxShadow:`0 0 10px ${pour.c}`, animation:"labo-drop .7s ease-in forwards", zIndex:3 }}/>}
        <svg viewBox="0 0 200 150" width="200" style={{ display:"block", overflow:"visible" }}>
          {[60, 84, 108, 132].map((x, i) => (
            <path key={x} d={`M${x} 150 Q${x - 10} 130 ${x + 4} 112 Q${x + 18} 132 ${x + 8} 150 Z`} fill={i % 2 ? "#f97316" : "#facc15"}
              style={{ transformOrigin:`${x + 4}px 150px`, animation:`labo-flame ${0.35 + i * 0.07}s ease-in-out infinite` }}/>
          ))}
          <path d="M28 46 Q26 132 100 136 Q174 132 172 46 Z" fill="#1f2328"/>
          <path d="M40 60 Q40 120 90 128" stroke="rgba(255,255,255,.08)" strokeWidth="6" fill="none" strokeLinecap="round"/>
          <ellipse cx="100" cy="46" rx="76" ry="15" fill="#2b3036" stroke="#4b5563" strokeWidth="3"/>
          <ellipse cx="100" cy="48" rx="66" ry="10" style={{ fill:mix, transition:"fill .6s", filter:`drop-shadow(0 0 10px ${mix})`,
            animation: fx === "boom" ? "labo-rainbow 2s linear infinite" : "none" }}/>
          {[0, 1, 2, 3].map(i => (
            <circle key={i} cx={64 + i * 22} cy="47" r={3 + (i % 2) * 2} fill="rgba(255,255,255,.35)"
              style={{ transformBox:"fill-box", transformOrigin:"center", animation:`labo-pop ${1 + i * 0.3}s ease-in-out ${i * 0.25}s infinite` }}/>
          ))}
        </svg>
        {fx === "smoke" && [0, 1, 2, 3, 4, 5].map(i => (
          <span key={i} aria-hidden="true" style={{ position:"absolute", left:"50%", top:30, width:46, height:46, borderRadius:"50%",
            background:"radial-gradient(circle, rgba(120,113,108,.9), rgba(120,113,108,0) 70%)", "--dx":`${(i - 2.5) * 22}px`,
            animation:`labo-smoke 1.4s ease-out ${i * 0.08}s both`, pointerEvents:"none" }}/>
        ))}
        {fx === "boom" && sparks.map(s => (
          <span key={s.i} aria-hidden="true" style={{ position:"absolute", left:"50%", top:44, width:s.s, height:s.s, borderRadius:"50%",
            background:s.c, boxShadow:`0 0 8px ${s.c}`, "--dx":`${s.dx}px`, "--dy":`${s.dy}px`, zIndex:4, pointerEvents:"none",
            animation:`labo-burst 1.5s ease-out ${s.dl}s infinite` }}/>
        ))}
      </div>
      <div style={{ position:"relative", zIndex:2, minHeight:22, marginTop:6, fontSize:14, color: fx === "smoke" ? "#d6d3d1" : "#bbf7d0", textAlign:"center" }}>
        {fx === "smoke" ? "Pfff… Ça sent le PLA brûlé. On recommence." : won ? "BOUM ! Une potion de première couche parfaite." :
          <span aria-label={`${seq.length} goutte(s)`} style={{ letterSpacing:6 }}>{LABO_ORDER.map((_, i) => (i < seq.length ? "●" : "○")).join("")}</span>}
      </div>

      {/* la paillasse */}
      <div style={{ position:"relative", zIndex:2, display:"flex", gap:"clamp(4px, 2vw, 14px)", justifyContent:"center", alignItems:"flex-end",
        marginTop:12, padding:"10px 12px 12px", borderRadius:8, width:"100%", maxWidth:420,
        background:"linear-gradient(180deg, transparent 0 74%, #57381f 74%, #3f2815 100%)" }}>
        {LABO_FLASKS.map(f => (
          <button key={f.id} onClick={() => tap(f)} aria-label={`Fiole ${f.id}`} style={{ ...bare, width:58, height:92, display:"flex",
            justifyContent:"center", alignItems:"flex-end", filter:`drop-shadow(0 0 8px ${f.c}66)` }}>
            <Flask c={f.c} pouring={pour && pour.id === f.id}/>
          </button>
        ))}
      </div>
      <Hint won={won}>Le tableau donne la recette. Verse les bonnes fioles dans le bon ordre.</Hint>
    </Stage>
  );
}

/* -------------------------------------------------------------------- musee */

const MUSEE_WORKS = [
  { title: "La Joconde en PLA", who: "Léonard de Vinci-Bambu", when: "1503 couches", tech: "PLA mat, buse 0,4 mm",
    text: "Son sourire énigmatique ? Un défaut d'extrusion devenu chef-d'œuvre. Ses yeux vous suivent, comme la tête d'impression." },
  { title: "La Nuit étoilée sur le plateau", who: "Vincent van Bambu", when: "1889, imprimé de nuit", tech: "PETG pailleté, mode silencieux",
    text: "Réalisée pendant une impression de 14 heures. Le cyprès est en réalité un support arborescent que personne n'a osé retirer." },
  { title: "Le Cri du support", who: "Edvard Munch-Lab", when: "1893", tech: "PLA orange et désespoir",
    text: "L'instant précis où l'on découvre que les supports ont fusionné avec la pièce. Universel, intemporel." },
  { title: "La Persistance de la bobine", who: "Salvador Dalí-Bambu", when: "1931", tech: "TPU, très flexible",
    text: "Ce qui arrive quand on oublie le séchoir à filament en plein mois d'août. L'artiste n'a jamais retrouvé sa buse." },
  { title: "La Jeune Fille à la buse", who: "Johannes Vermeer", when: "vers 1665", tech: "Laiton trempé, 0,4 mm",
    text: "Une buse en laiton portée en boucle d'oreille : le chic absolu des makers flamands du XVIIe siècle." },
  { title: "La Grande Vague du PETG", who: "Katsushika Hokusai", when: "vers 1831", tech: "PETG bleu, fils d'ange compris",
    text: "Le PETG, quand il file, file vraiment. Observez l'écume : du stringing à l'état pur." },
];

function MuseeArt({ i }) {
  const paintings = [
    <g key="0">
      <rect width="100" height="125" fill="#7b8a5a"/>
      <path d="M0 0 H100 V60 Q70 50 50 58 Q30 48 0 60Z" fill="#aab68a"/>
      <path d="M0 62 Q20 50 40 60 L40 125 H0Z" fill="#5c6b40"/>
      <path d="M60 58 Q80 48 100 56 V125 H60Z" fill="#56653c"/>
      <path d="M8 70 Q20 80 14 92" stroke="#c9b27a" fill="none" strokeWidth="2"/>
      <path d="M34 52 Q34 28 50 28 Q66 28 66 52 L68 84 Q60 76 58 66 L42 66 Q40 76 32 84Z" fill="#241a10"/>
      <path d="M18 125 Q22 82 50 76 Q78 82 82 125Z" fill="#2b2418"/>
      <path d="M38 80 Q50 92 62 80 Z" fill="#d9a877"/>
      <ellipse cx="50" cy="50" rx="12" ry="15" fill="#e2b483"/>
      <path d="M38 40 Q50 30 62 40" stroke="#3b2a18" strokeWidth="1" fill="none" opacity=".6"/>
      <ellipse cx="45" cy="47" rx="1.8" ry="1" fill="#3b2a18"/><ellipse cx="55" cy="47" rx="1.8" ry="1" fill="#3b2a18"/>
      <path d="M50 49 L49 54 L51 54" stroke="#b0835a" strokeWidth=".7" fill="none"/>
      <path d="M45.5 57.5 Q50 60 54.5 57.5" stroke="#7a4a2a" strokeWidth="1" fill="none"/>
      <ellipse cx="46" cy="112" rx="10" ry="5" fill="#d9a877"/><ellipse cx="57" cy="114" rx="9" ry="4.5" fill="#cf9c6b"/>
    </g>,
    <g key="1">
      <rect width="100" height="125" fill="#1e3a8a"/>
      <path d="M0 30 Q25 15 50 30 T100 28" stroke="#60a5fa" strokeWidth="3" fill="none"/>
      <path d="M0 46 Q30 32 55 46 T100 42" stroke="#93c5fd" strokeWidth="2.5" fill="none"/>
      <path d="M36 36 a10 8 0 1 1 12 6 a5 4 0 1 1 -4 -6" stroke="#bfdbfe" strokeWidth="2" fill="none"/>
      <circle cx="82" cy="18" r="13" fill="none" stroke="#fde68a" strokeWidth="2" opacity=".6"/>
      <circle cx="82" cy="18" r="8" fill="#fde047"/>
      {[[15, 14, 3], [30, 22, 2.4], [58, 12, 3], [66, 30, 2.2], [92, 44, 2]].map(([x, y, r], k) => (
        <g key={k}><circle cx={x} cy={y} r={r * 2} fill="none" stroke="#fde68a" strokeWidth="1" opacity=".5"/><circle cx={x} cy={y} r={r} fill="#fde68a"/></g>
      ))}
      <path d="M0 80 Q30 70 60 78 T100 74 V125 H0Z" fill="#1e40af"/>
      <rect x="10" y="92" width="80" height="9" fill="#374151"/>
      {[20, 30, 40, 50, 60, 70, 80].map(x => <line key={x} x1={x} y1="92" x2={x} y2="101" stroke="#4b5563" strokeWidth=".6"/>)}
      <path d="M44 92 L64 92 L61 86 L46 86Z" fill="#f97316"/><rect x="50" y="81" width="8" height="5" fill="#f97316"/>
      <path d="M14 125 Q6 90 16 46 Q24 90 26 125Z" fill="#14532d"/>
      <path d="M16 60 Q12 80 18 100" stroke="#166534" strokeWidth="2" fill="none"/>
    </g>,
    <g key="2">
      <rect width="100" height="125" fill="#f97316"/>
      {[10, 22, 34].map((y, k) => (
        <path key={y} d={`M0 ${y} Q25 ${y - 8} 50 ${y + 2} T100 ${y - 2}`} stroke={k % 2 ? "#facc15" : "#dc2626"} strokeWidth="5" fill="none"/>
      ))}
      <path d="M0 50 Q30 40 60 55 Q80 62 100 50 V72 H0Z" fill="#1e3a8a"/>
      <path d="M0 125 L34 125 L100 66 L100 58Z" fill="#92400e"/>
      <path d="M0 104 L100 54" stroke="#451a03" strokeWidth="1.6"/>
      <path d="M44 125 Q40 96 50 88 Q60 96 58 125Z" fill="#1f2937"/>
      <ellipse cx="50" cy="74" rx="9" ry="12.5" fill="#e7d7a8"/>
      <ellipse cx="46.5" cy="71" rx="1.8" ry="2.6" fill="#1f2937"/><ellipse cx="53.5" cy="71" rx="1.8" ry="2.6" fill="#1f2937"/>
      <ellipse cx="50" cy="80" rx="2.4" ry="4" fill="#1f2937"/>
      <ellipse cx="40.5" cy="76" rx="3" ry="7" fill="#e7d7a8"/><ellipse cx="59.5" cy="76" rx="3" ry="7" fill="#e7d7a8"/>
      <path d="M66 125 L70 108 L74 125 M70 108 L70 98 M64 112 L76 112" stroke="#cbd5e1" strokeWidth="1.6" fill="none"/>
    </g>,
    <g key="3">
      <rect width="100" height="56" fill="#7dd3fc"/>
      <rect y="52" width="100" height="6" fill="#38bdf8"/>
      <rect y="56" width="100" height="69" fill="#e0c088"/>
      <path d="M68 56 Q84 38 100 44 V58 H68Z" fill="#b45309"/>
      <rect x="6" y="80" width="42" height="20" fill="#7c2d12"/>
      <path d="M36 80 L36 52 Q38 44 46 40 L62 37" stroke="#3f2a14" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <path d="M44 39 Q53 34 62 37 Q66 52 61 66 Q57 72 53 63 Q49 71 45 62Z" fill="#22c55e"/>
      <path d="M46 42 Q53 38 60 40" stroke="#94a3b8" strokeWidth="2.5" fill="none"/>
      <path d="M18 80 Q33 75 47 80 Q51 92 45 104 Q41 98 39 108 Q35 96 30 101 Q26 90 18 94Z" fill="#f97316"/>
      <ellipse cx="32" cy="80" rx="14" ry="3.5" fill="none" stroke="#94a3b8" strokeWidth="2.5"/>
      <ellipse cx="32" cy="80" rx="4" ry="1.4" fill="#57534e"/>
      <ellipse cx="62" cy="112" rx="26" ry="4" fill="rgba(0,0,0,.18)"/>
    </g>,
    <g key="4">
      <rect width="100" height="125" fill="#0b0b0b"/>
      <path d="M26 125 Q32 90 52 86 Q72 90 80 125Z" fill="#a16207"/>
      <path d="M42 89 Q52 96 63 89" stroke="#f8fafc" strokeWidth="3" fill="none"/>
      <ellipse cx="52" cy="62" rx="18" ry="22" fill="#e8c9a0"/>
      <path d="M66 40 Q80 52 74 84 Q70 72 65 60Z" fill="#facc15"/>
      <path d="M32 54 Q32 30 54 30 Q72 32 71 50 Q60 44 50 46 Q40 46 32 54Z" fill="#2563eb"/>
      <path d="M34 48 Q50 40 70 46" stroke="#1e40af" strokeWidth="3" fill="none"/>
      <ellipse cx="57" cy="60" rx="3.2" ry="2.2" fill="#fff"/><circle cx="57.6" cy="60" r="1.5" fill="#1c1917"/>
      <ellipse cx="45" cy="60" rx="2.6" ry="1.8" fill="#fff"/><circle cx="45.4" cy="60" r="1.2" fill="#1c1917"/>
      <path d="M51 63 L50 69 L53 69" stroke="#b08060" strokeWidth=".8" fill="none"/>
      <path d="M48 74 Q52.5 77.5 57 74 Q52.5 75.5 48 74Z" fill="#be123c"/>
      <polygon points="33,68 39,68 41,71 39,74 33,74 31,71" fill="#d4a017"/>
      <path d="M33 74 L39 74 L36 80Z" fill="#b8860b"/><circle cx="34.5" cy="70" r=".9" fill="#fff8dc"/>
    </g>,
    <g key="5">
      <rect width="100" height="125" fill="#f1e4c3"/>
      <path d="M52 92 L70 66 L88 92Z" fill="#1e3a8a"/>
      <path d="M65 73 L70 66 L75 73 L72.5 71.5 L70 74 L67.5 71.5Z" fill="#fff"/>
      <path d="M0 125 L0 70 Q10 30 45 28 Q62 28 66 42 Q56 36 48 42 Q60 46 56 58 Q46 50 40 60 Q30 80 50 100 Q70 112 100 104 V125Z" fill="#1e3a8a"/>
      <path d="M6 125 L6 78 Q14 44 42 38 Q30 50 30 66 Q32 88 52 106 Q72 116 100 112 V125Z" fill="#3b82f6" opacity=".55"/>
      {[[45, 28], [52, 30], [59, 33], [64, 38], [55, 44], [48, 46]].map(([x, y], k) => <circle key={k} cx={x} cy={y} r="2.6" fill="#fff"/>)}
      <path d="M14 108 Q36 116 60 108 L58 113 Q36 120 16 113Z" fill="#fef3c7"/>
      <path d="M60 116 Q76 121 92 115 L90 119 Q76 125 62 120Z" fill="#fef3c7"/>
    </g>,
  ];
  return (
    <svg viewBox="0 0 100 125" width="100%" style={{ display:"block" }} aria-hidden="true">{paintings[i]}</svg>
  );
}

function MuseeFrame({ i, size }) {
  return (
    <div style={{ position:"relative", padding:size > 150 ? 12 : 7, borderRadius:3,
      background:"linear-gradient(135deg, #f8e08e, #b8860b 38%, #fff1b8 55%, #8b6508 85%)",
      boxShadow:"0 12px 22px rgba(0,0,0,.55), inset 0 0 0 2px rgba(0,0,0,.25)" }}>
      <div style={{ position:"relative", boxShadow:"inset 0 0 0 2px #5c4306", overflow:"hidden" }}>
        <MuseeArt i={i}/>
        <div style={{ position:"absolute", inset:0, pointerEvents:"none",
          background:"repeating-linear-gradient(0deg, rgba(0,0,0,.09) 0 1px, transparent 1px 3px), linear-gradient(135deg, rgba(255,255,255,.12), transparent 40%)" }}/>
      </div>
    </div>
  );
}

function Musee() {
  const [won, win] = useWin("musee");
  const [seen, setSeen] = useState(() => new Set());
  const [open, setOpen] = useState(null);
  const look = i => {
    setOpen(i);
    if (seen.has(i)) return;
    const s = new Set(seen);
    s.add(i);
    setSeen(s);
    if (s.size === MUSEE_WORKS.length) win();
  };
  const w = open === null ? null : MUSEE_WORKS[open];

  return (
    <Stage won={won} wonText="Visite guidée terminée" font={SERIF}
      bg="linear-gradient(180deg, #3d1518 0%, #57201f 60%, #2a1a12 60%, #2a1a12 61%, #6b4a2b 61%, #4a3018 100%)">
      <style>{`
        @keyframes musee-in { from { transform:scale(.92); opacity:0 } to { transform:none; opacity:1 } }
      `}</style>
      <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, bottom:0, height:"39%", pointerEvents:"none",
        background:"repeating-linear-gradient(90deg, rgba(0,0,0,.18) 0 2px, transparent 2px 46px), repeating-linear-gradient(0deg, rgba(255,255,255,.04) 0 1px, transparent 1px 14px), linear-gradient(180deg, #6b4a2b, #3f2814)" }}/>
      <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, top:"58%", height:"2.4%", background:"linear-gradient(#7a5530, #3a2412)", pointerEvents:"none" }}/>

      <Title color="#fde68a" sub="Collection permanente · Entrée libre, sortie par la boutique de filament" style={{ marginBottom:22 }}>
        Musée du Filament</Title>
      <div style={{ position:"relative", zIndex:2, display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:"clamp(12px, 4vw, 30px)",
        width:"100%", maxWidth:600, padding:"0 4px" }}>
        {MUSEE_WORKS.map((wk, i) => (
          <div key={i} style={{ position:"relative", paddingTop:22 }}>
            <div aria-hidden="true" style={{ position:"absolute", top:0, left:"50%", width:30, height:6, borderRadius:3, transform:"translateX(-50%)",
              background:"linear-gradient(#cbd5e1, #64748b)" }}/>
            <div aria-hidden="true" style={{ position:"absolute", top:4, left:"-25%", width:"150%", height:"105%", pointerEvents:"none",
              background:"radial-gradient(ellipse 50% 60% at 50% 0%, rgba(255,240,200,.28), transparent 70%)" }}/>
            <button onClick={() => look(i)} aria-label={wk.title} style={{ ...bare, display:"block", width:"100%", position:"relative" }}>
              <MuseeFrame i={i} size={100}/>
            </button>
            <div style={{ margin:"8px auto 0", width:"fit-content", padding:"2px 8px", borderRadius:2, fontSize:10.5,
              background:"linear-gradient(#e7c871, #a07a1e)", color:"#3a2a06", fontFamily:SANS, fontWeight:800 }}>
              n° {i + 1}{seen.has(i) ? " ✓" : ""}</div>
          </div>
        ))}
      </div>
      <div style={{ position:"relative", zIndex:2, marginTop:16, fontSize:13, color:"#fcd9a8", fontStyle:"italic" }}>
        Œuvres contemplées : {seen.size} / {MUSEE_WORKS.length}</div>

      {w && (
        <div onClick={() => setOpen(null)} style={{ position:"absolute", inset:0, zIndex:12, background:"rgba(12,6,6,.82)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:360, display:"flex", flexDirection:"column",
            alignItems:"center", animation:"musee-in .35s ease-out both" }}>
            <div style={{ width:"min(200px, 56vw)" }}><MuseeFrame i={open} size={200}/></div>
            <div style={{ marginTop:16, padding:"14px 16px", background:"#fafaf5", color:"#1c1917", borderRadius:4, width:"100%",
              boxShadow:"0 8px 22px rgba(0,0,0,.5)" }}>
              <div style={{ fontWeight:700, fontSize:18 }}>{w.title}</div>
              <div style={{ fontSize:14, marginTop:2 }}>{w.who}</div>
              <div style={{ fontSize:12.5, fontStyle:"italic", color:"#57534e", marginTop:2 }}>{w.when} · {w.tech}</div>
              <div style={{ fontSize:13.5, lineHeight:1.45, marginTop:8, fontFamily:SANS }}>{w.text}</div>
            </div>
            <Btn onClick={() => setOpen(null)} color="#8b6508" style={{ marginTop:14, minHeight:44 }}>Retour à la galerie</Btn>
          </div>
        </div>
      )}
      <Hint won={won} color="rgba(253,230,138,.7)">Un vrai amateur d'art lit chaque cartel. Tous.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ horloge */

const HORL_NUM = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];

function Horloge() {
  const [won, win] = useWin("horloge");
  const later = useTimers();
  const big = useRef(null);
  const small = useRef(null);
  const ang = useRef(rand(60, 300));
  const run = useRef(true);
  const [msg, setMsg] = useState(null);
  const [stopped, setStopped] = useState(false);
  // la grande aiguille recule d'un tour toutes les 6 s
  useLoop(dt => {
    if (!run.current) return;
    ang.current -= 60 * dt;
    if (big.current) big.current.setAttribute("transform", `rotate(${ang.current} 150 150)`);
    if (small.current) small.current.setAttribute("transform", `rotate(${ang.current / 12} 150 150)`);
  });
  const stop = () => {
    if (!run.current || won) return;
    run.current = false;
    setStopped(true);
    const a = ((ang.current % 360) + 360) % 360;
    const off = Math.round(a <= 180 ? a : 360 - a);
    if (off <= 8) {
      setMsg({ ok: true, t: `Midi pile, à ${off}° près. Le temps a cédé.` });
      win();
      return;
    }
    const early = a <= 180;
    setMsg({ ok: false, t: pick([
      early ? `Trop tôt de ${off}°. Patience, le temps recule.` : `Trop tard de ${off}°. Midi est déjà passé… à l'envers.`,
      `Raté de ${off}°. Même ta buse est plus précise.`,
      `${off}° d'écart. Le temps te file entre les doigts, comme du PETG.`,
    ]) });
    later(() => { run.current = true; setStopped(false); }, 1700);
  };

  return (
    <Stage won={won} wonText="Maître du temps (à l'envers)" font={SERIF}
      bg="radial-gradient(ellipse at 50% 30%, #3b2a1a 0%, #1a120b 70%), #1a120b">
      <style>{`
        @keyframes horloge-pend { from { transform:rotate(-14deg) } to { transform:rotate(14deg) } }
        @keyframes horloge-dust { 0%,100% { transform:translateY(0); opacity:.2 } 50% { transform:translateY(-18px); opacity:.7 } }
      `}</style>
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", left:`${(i * 37) % 100}%`, top:`${(i * 53) % 90}%`, width:3, height:3,
          borderRadius:"50%", background:"#fde68a", animation:`horloge-dust ${5 + (i % 4)}s ease-in-out ${-i}s infinite`, pointerEvents:"none" }}/>
      ))}
      <Title color="#fde68a" sub="Ici, le temps s'imprime de la dernière couche à la première." style={{ marginBottom:16 }}>L'Horloge Rebelle</Title>
      <div style={{ position:"relative", zIndex:2, width:"min(300px, 78vw)" }}>
        <svg viewBox="0 0 300 300" width="100%" style={{ display:"block", filter:"drop-shadow(0 16px 30px rgba(0,0,0,.6))" }}>
          <defs>
            <linearGradient id="horloge-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff1b8"/><stop offset=".35" stopColor="#d4a017"/><stop offset=".6" stopColor="#fbe7a1"/><stop offset="1" stopColor="#8b6508"/>
            </linearGradient>
            <radialGradient id="horloge-face" cx="45%" cy="40%" r="70%">
              <stop offset="0" stopColor="#fffdf5"/><stop offset=".8" stopColor="#efe2c2"/><stop offset="1" stopColor="#d6c296"/>
            </radialGradient>
          </defs>
          <circle cx="150" cy="150" r="148" fill="url(#horloge-gold)"/>
          <circle cx="150" cy="150" r="138" fill="#3b2314"/>
          <circle cx="150" cy="150" r="131" fill="url(#horloge-gold)"/>
          {Array.from({ length: 36 }, (_, i) => {
            const a = (i * 10) * Math.PI / 180;
            return <circle key={i} cx={150 + Math.cos(a) * 143} cy={150 + Math.sin(a) * 143} r="2.4" fill="#fff3c4"/>;
          })}
          <circle cx="150" cy="150" r="123" fill="url(#horloge-face)"/>
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i * 6 - 90) * Math.PI / 180, major = i % 5 === 0;
            return <line key={i} x1={150 + Math.cos(a) * (major ? 108 : 113)} y1={150 + Math.sin(a) * (major ? 108 : 113)}
              x2={150 + Math.cos(a) * 118} y2={150 + Math.sin(a) * 118} stroke="#3b2314" strokeWidth={major ? 3 : 1.2}/>;
          })}
          {HORL_NUM.map((t, i) => {
            const a = (i * 30 - 90) * Math.PI / 180;
            return <text key={t} x={150 + Math.cos(a) * 92} y={150 + Math.sin(a) * 92 + 6} textAnchor="middle" fontSize={i === 0 ? 20 : 16}
              fontFamily={SERIF} fontWeight="700" fill={i === 0 ? "#9a3412" : "#3b2314"}>{t}</text>;
          })}
          <circle cx="150" cy="150" r="58" fill="none" stroke="rgba(139,101,8,.35)" strokeWidth="1.5"/>
          <circle cx="150" cy="150" r="52" fill="none" stroke="rgba(139,101,8,.2)" strokeWidth="6" strokeDasharray="2 6"/>
          <text x="150" y="205" textAnchor="middle" fontSize="9" letterSpacing="3" fill="#7c5a2a" fontFamily={SERIF}>BAMBU · 1888</text>
          <g ref={small} transform={`rotate(${ang.current / 12} 150 150)`}>
            <path d="M146.5 160 L147.5 96 Q150 84 152.5 96 L153.5 160 Z" fill="#1c1208"/>
            <circle cx="150" cy="104" r="7" fill="none" stroke="#1c1208" strokeWidth="2.6"/>
          </g>
          <g ref={big} transform={`rotate(${ang.current} 150 150)`}>
            <path d="M148.4 170 L148.8 48 L150 34 L151.2 48 L151.6 170 Z" fill={won ? "#b45309" : "#1c1208"}/>
            <circle cx="150" cy="176" r="6" fill={won ? "#b45309" : "#1c1208"}/>
            <path d="M144 58 Q150 48 156 58 Q150 64 144 58Z" fill={won ? "#b45309" : "#1c1208"}/>
          </g>
          <circle cx="150" cy="150" r="8" fill="url(#horloge-gold)" stroke="#5c4306"/>
          <circle cx="150" cy="150" r="3" fill="#3b2314"/>
        </svg>
      </div>
      <div style={{ position:"relative", zIndex:1, width:96, height:110, marginTop:-6, borderRadius:"0 0 14px 14px", overflow:"hidden",
        background:"linear-gradient(90deg, #4a2c17, #6b3f1f 50%, #4a2c17)", boxShadow:"inset 0 0 0 5px #3b2314, 0 10px 20px rgba(0,0,0,.5)" }}>
        <div style={{ position:"absolute", inset:10, borderRadius:8, background:"rgba(20,12,6,.7)", boxShadow:"inset 0 0 12px #000" }}/>
        <div style={{ position:"absolute", left:"50%", top:0, width:0, height:0, animation:`horloge-pend 1s ease-in-out infinite alternate`,
          animationPlayState: stopped ? "paused" : "running" }}>
          <div style={{ position:"absolute", left:-1.5, top:0, width:3, height:72, background:"linear-gradient(#d4a017, #8b6508)" }}/>
          <div style={{ position:"absolute", left:-14, top:68, width:28, height:28, borderRadius:"50%",
            background:"radial-gradient(circle at 35% 35%, #fff1b8, #d4a017 55%, #8b6508)" }}/>
        </div>
      </div>
      <div style={{ minHeight:44, marginTop:12, textAlign:"center", maxWidth:340, fontSize:15, color: msg && msg.ok ? "#86efac" : "#fcd9a8",
        fontStyle:"italic", position:"relative", zIndex:2 }}>{msg ? msg.t : ""}</div>
      <Btn onClick={stop} color={won ? "#4d7c0f" : "#9a3412"} disabled={stopped}
        style={{ position:"relative", zIndex:2, minHeight:48, minWidth:140, fontSize:18, opacity: stopped && !won ? 0.6 : 1 }}>
        {won ? "Figée ✓" : "⏸ Stop"}</Btn>
      <Hint won={won} color="rgba(253,230,138,.65)">Fige la grande aiguille pile sur le chiffre du haut.</Hint>
    </Stage>
  );
}

/* ----------------------------------------------------------------- aquarium */

const AQ_KINDS = [
  { body: "#f97316", fin: "#ea580c", stripe: "#fff" },
  { body: "#3b82f6", fin: "#1d4ed8", stripe: "#facc15" },
  { body: "#facc15", fin: "#ca8a04", stripe: "#fb923c" },
  { body: "#a855f7", fin: "#7e22ce", stripe: "#f0abfc" },
  { body: "#ef4444", fin: "#b91c1c", stripe: "#fecaca" },
];
const AQ_GOAL = 10;

function Fish({ f }) {
  const c = f.c;
  return (
    <svg viewBox="0 0 64 40" width={f.size} height={f.size * 0.625} aria-hidden="true"
      style={{ position:"absolute", left:0, top:0, overflow:"visible", pointerEvents:"none",
        transform:`translate(${f.x - f.size / 2}px, ${f.y - f.size * 0.31}px) scaleX(${f.dir})` }}>
      <path d="M15 20 L0 6 L5 20 L0 34 Z" fill={c.fin} style={{ transformOrigin:"15px 20px", animation:`aquarium-tail ${0.35 + f.id * 0.05}s ease-in-out infinite alternate` }}/>
      <path d="M28 8 Q38 -1 48 9 Z" fill={c.fin}/>
      <ellipse cx="36" cy="20" rx="24" ry="14" fill={c.body}/>
      <path d="M28 7.5 Q23.5 20 28 32.5" stroke={c.stripe} strokeWidth="3.5" fill="none" opacity=".85"/>
      <path d="M44 8.5 Q40.5 20 44 31.5" stroke={c.stripe} strokeWidth="3" fill="none" opacity=".85"/>
      <ellipse cx="36" cy="13" rx="14" ry="4" fill="rgba(255,255,255,.25)"/>
      <ellipse cx="37" cy="26" rx="6" ry="3" fill={c.fin} opacity=".75"/>
      <circle cx="51" cy="16" r="3.8" fill="#fff"/><circle cx="52" cy="16" r="2" fill="#111"/>
      <path d="M58.5 21 Q56 23.5 58.5 25" stroke="rgba(0,0,0,.5)" strokeWidth="1.2" fill="none"/>
    </svg>
  );
}

function Aquarium() {
  const [won, win] = useWin("aquarium");
  const box = useRef(null);
  const W = useRef({ fish: [], food: [], eaten: 0, t: 0, yums: [] });
  const [, setTick] = useState(0);
  const [eaten, setEaten] = useState(0);
  const bubbles = useMemo(() => Array.from({ length: 16 }, () => ({ x: rand(3, 97), s: rand(4, 12), d: rand(5, 11), dl: -rand(0, 11) })), []);

  useLoop(dt => {
    const s = W.current, el = box.current;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight, floor = h - 50;
    s.t += dt;
    if (!s.fish.length && w > 0) {
      s.fish = AQ_KINDS.map((c, i) => ({ id: i, c, size: rand(48, 72), x: rand(60, w - 60), y: rand(90, floor - 40), vx: 0, vy: 0, dir: 1,
        tx: rand(40, w - 40), ty: rand(90, floor - 30), sp: rand(30, 55) }));
    }
    for (const p of s.food) {
      if (p.y < floor) { p.y = Math.min(floor, p.y + 34 * dt); p.x += Math.sin(s.t * 3 + p.ph) * 12 * dt; }
    }
    for (const f of s.fish) {
      let best = null, bd = 1e9;
      for (const p of s.food) { const d = Math.hypot(p.x - f.x, p.y - f.y); if (d < bd) { bd = d; best = p; } }
      let tx = f.tx, ty = f.ty, sp = f.sp;
      if (best) { tx = best.x; ty = best.y; sp = 135; }
      else if (Math.hypot(tx - f.x, ty - f.y) < 14 || Math.random() < dt * 0.15) { f.tx = rand(40, w - 40); f.ty = rand(90, floor - 30); }
      const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, dt * 2.5);
      f.vx += ((dx / d) * sp - f.vx) * k;
      f.vy += ((dy / d) * sp * 0.75 - f.vy) * k;
      f.x = Math.max(24, Math.min(w - 24, f.x + f.vx * dt));
      f.y = Math.max(60, Math.min(floor - 6, f.y + f.vy * dt + Math.sin(s.t * 2 + f.id) * 5 * dt));
      if (f.vx > 6) f.dir = 1; else if (f.vx < -6) f.dir = -1;
      if (best && bd < f.size * 0.42) {
        s.food.splice(s.food.indexOf(best), 1);
        s.eaten += 1;
        s.yums.push({ x: f.x, y: f.y - f.size * 0.4, t: s.t, id: s.eaten });
        setEaten(s.eaten);
        if (s.eaten === AQ_GOAL) win();
      }
    }
    s.yums = s.yums.filter(y => s.t - y.t < 1);
    setTick(x => (x + 1) % 1e6);
  });

  const feed = e => {
    const r = box.current.getBoundingClientRect(), s = W.current;
    if (s.food.length > 24) return;
    const x = e.clientX - r.left, y = Math.max(16, e.clientY - r.top);
    for (let i = 0; i < 2; i += 1) {
      s.food.push({ x: x + rand(-12, 12), y: y + rand(-6, 6), ph: rand(0, 6), r: rand(0, 180),
        c: pick(["#f97316", "#22c55e", "#3b82f6", "#facc15", "#ec4899", "#f8fafc"]) });
    }
  };
  const s = W.current;

  return (
    <Stage won={won} wonText="Poissons repus, aquarium heureux" font={SANS} style={{ padding:0 }}
      bg="linear-gradient(180deg, #67e8f9 0%, #0891b2 35%, #0e5a7a 75%, #0b3b55 100%)">
      <style>{`
        @keyframes aquarium-tail { from { transform:scaleY(1) skewY(8deg) } to { transform:scaleY(.8) skewY(-8deg) } }
        @keyframes aquarium-bub { 0% { transform:translate(0, 0); opacity:0 } 10% { opacity:.8 } 100% { transform:translate(14px, -110vh); opacity:0 } }
        @keyframes aquarium-sway { 0%,100% { transform:skewX(-8deg) } 50% { transform:skewX(8deg) } }
        @keyframes aquarium-ray { 0%,100% { opacity:.12 } 50% { opacity:.3 } }
        @keyframes aquarium-yum { from { transform:translate(-50%, 0); opacity:1 } to { transform:translate(-50%, -26px); opacity:0 } }
      `}</style>
      <div ref={box} onPointerDown={feed} style={{ position:"absolute", inset:0, cursor:"pointer", overflow:"hidden" }}>
        {[12, 34, 58, 80].map((x, i) => (
          <div key={x} aria-hidden="true" style={{ position:"absolute", top:-20, left:`${x}%`, width:"14%", height:"80%", pointerEvents:"none",
            background:"linear-gradient(180deg, rgba(255,255,255,.55), transparent)", transform:"skewX(-14deg)", filter:"blur(6px)",
            animation:`aquarium-ray ${5 + i}s ease-in-out ${-i * 1.3}s infinite` }}/>
        ))}
        {/* le sable, l'epave du Benchy, les algues */}
        <svg aria-hidden="true" viewBox="0 0 400 70" preserveAspectRatio="none"
          style={{ position:"absolute", left:0, bottom:0, width:"100%", height:70, pointerEvents:"none" }}>
          <path d="M0 26 Q60 12 120 24 T240 20 T400 22 V70 H0Z" fill="#e7d2a0"/>
          <path d="M0 40 Q80 30 160 40 T320 36 T400 40 V70 H0Z" fill="#d4bb82"/>
          {[30, 95, 170, 260, 330, 372].map((x, i) => <ellipse key={x} cx={x} cy={44 + (i % 3) * 6} rx={5 + (i % 2) * 3} ry="3" fill="#a8916a"/>)}
        </svg>
        <svg aria-hidden="true" viewBox="0 0 80 50" width="88" style={{ position:"absolute", right:"12%", bottom:22, transform:"rotate(-14deg)", opacity:.85, pointerEvents:"none" }}>
          <path d="M4 30 L62 30 Q72 28 78 22 L72 44 Q40 52 12 46Z" fill="#c2410c"/>
          <rect x="26" y="16" width="30" height="14" rx="2" fill="#ea580c"/><rect x="30" y="20" width="7" height="6" fill="#0b3b55"/>
          <rect x="41" y="20" width="7" height="6" fill="#0b3b55"/><rect x="24" y="12" width="35" height="4" fill="#9a3412"/>
          <path d="M14 46 Q16 38 22 40" stroke="#4d7c0f" strokeWidth="2" fill="none"/>
        </svg>
        {[{ x: 6, h: 120, c: "#15803d" }, { x: 14, h: 80, c: "#16a34a" }, { x: 64, h: 100, c: "#166534" }, { x: 90, h: 140, c: "#15803d" }, { x: 46, h: 60, c: "#22c55e" }].map((a, i) => (
          <svg key={i} aria-hidden="true" viewBox={`0 0 30 ${a.h}`} width="30" height={a.h}
            style={{ position:"absolute", left:`${a.x}%`, bottom:26, transformOrigin:"50% 100%", pointerEvents:"none",
              animation:`aquarium-sway ${3.5 + i * 0.6}s ease-in-out ${-i}s infinite` }}>
            <path d={`M15 ${a.h} Q4 ${a.h * 0.7} 14 ${a.h * 0.45} Q24 ${a.h * 0.22} 13 0 Q20 ${a.h * 0.25} 19 ${a.h * 0.5} Q12 ${a.h * 0.72} 19 ${a.h}Z`} fill={a.c}/>
          </svg>
        ))}
        {bubbles.map((b, i) => (
          <span key={i} aria-hidden="true" style={{ position:"absolute", bottom:-14, left:`${b.x}%`, width:b.s, height:b.s, borderRadius:"50%",
            border:"1.5px solid rgba(255,255,255,.7)", background:"radial-gradient(circle at 30% 30%, rgba(255,255,255,.7), transparent 60%)",
            animation:`aquarium-bub ${b.d}s linear ${b.dl}s infinite`, pointerEvents:"none" }}/>
        ))}
        {s.food.map((p, i) => (
          <span key={i} aria-hidden="true" style={{ position:"absolute", left:0, top:0, width:7, height:4, borderRadius:2, background:p.c,
            transform:`translate(${p.x - 3.5}px, ${p.y - 2}px) rotate(${p.r}deg)`, boxShadow:"0 0 3px rgba(0,0,0,.3)", pointerEvents:"none" }}/>
        ))}
        {s.fish.map(f => <Fish key={f.id} f={f}/>)}
        {s.yums.map(y => (
          <span key={y.id} aria-hidden="true" style={{ position:"absolute", left:y.x, top:y.y, fontSize:13, fontWeight:800, color:"#fff",
            textShadow:"0 1px 3px rgba(0,0,0,.5)", animation:"aquarium-yum 1s ease-out forwards", pointerEvents:"none" }}>miam</span>
        ))}
        <div style={{ position:"absolute", top:16, left:0, right:0, textAlign:"center", pointerEvents:"none" }}>
          <Title color="#ecfeff" sub={won ? "Ils n'ont jamais aussi bien mangé. Même pas du PLA recyclé." : "Ils raffolent des chutes de filament."}>
            L'Aquarium</Title>
          <div style={{ marginTop:8, fontSize:13, color:"rgba(236,254,255,.8)" }}>bouchées : {eaten} / {AQ_GOAL}</div>
        </div>
        <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none",
          background:"linear-gradient(115deg, rgba(255,255,255,.12) 0 12%, transparent 12% 18%, rgba(255,255,255,.06) 18% 21%, transparent 21%)" }}/>
      </div>
      <Hint won={won} color="rgba(236,254,255,.75)">Ils ont faim. Il suffit de toucher l'eau.</Hint>
    </Stage>
  );
}

/* -------------------------------------------------------------------- neige */

function Pine({ x, y, s, c = "#14532d" }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-3" y="-4" width="6" height="12" fill="#3f2a14"/>
      <path d="M0 -60 L-18 -30 L-10 -30 L-26 -4 L26 -4 L10 -30 L18 -30 Z" fill={c}/>
      <path d="M0 -60 L-8 -46 L-3 -44 L0 -48 L3 -44 L8 -46 Z" fill="#f8fafc"/>
      <path d="M-18 -30 L-12 -27 L-6 -30 Z M6 -30 L12 -27 L18 -30 Z M-26 -4 L-18 -1 L-10 -4 Z M10 -4 L18 -1 L26 -4 Z" fill="#f1f5f9"/>
    </g>
  );
}

function Neige() {
  const [won, win] = useWin("neige");
  const later = useTimers();
  const [step, setStep] = useState(0);
  const [carrot, setCarrot] = useState(false);
  const flakes = useMemo(() => Array.from({ length: 70 }, () => {
    const z = Math.random();
    return { x: rand(0, 100), s: 2 + z * 5, d: 14 - z * 8, dl: -rand(0, 14), dx: rand(-40, 40), o: 0.4 + z * 0.6 };
  }), []);
  const build = e => {
    e.stopPropagation();
    if (step >= 3) return;
    const n = step + 1;
    setStep(n);
    if (n === 3) later(() => { setCarrot(true); win(); }, 1100);
  };
  const say = carrot ? "Le voilà complet ! Il s'appelle Benchy-des-Neiges."
    : ["La neige est parfaite. Bien collante, comme une première couche réussie.", "Une belle boule. Ça manque de hauteur.",
      "Il prend forme…", "Il lui manque quelque chose au milieu de la figure…"][step];

  return (
    <Stage won={won} wonText="Bonhomme de neige terminé" font={SANS} style={{ justifyContent:"flex-start" }}
      bg="linear-gradient(180deg, #0b1a3a 0%, #1e3a6e 45%, #5b7fb5 75%, #a5bfe0 100%)">
      <style>{`
        @keyframes neige-fall { from { transform:translate(0, -20px) } to { transform:translate(var(--dx), 110vh) } }
        @keyframes neige-roll { from { transform:translateX(-160px) rotate(-360deg) scale(.4) } to { transform:none } }
        @keyframes neige-drop { 0% { transform:translateY(-220px) } 70% { transform:translateY(6px) } 85% { transform:translateY(-4px) } 100% { transform:none } }
        @keyframes neige-carrot { from { transform:translate(120px, -160px) rotate(260deg) } to { transform:none } }
        @keyframes neige-say { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
      `}</style>
      <div aria-hidden="true" style={{ position:"absolute", top:"8%", right:"12%", width:58, height:58, borderRadius:"50%",
        background:"radial-gradient(circle at 40% 40%, #fefce8, #e2e8f0)", boxShadow:"0 0 50px 14px rgba(254,252,232,.35)" }}/>
      <svg aria-hidden="true" viewBox="0 0 400 220" preserveAspectRatio="xMidYMax slice"
        style={{ position:"absolute", left:0, bottom:0, width:"100%", height:"72%", pointerEvents:"none" }}>
        <path d="M0 120 L60 60 L110 100 L170 40 L240 105 L300 55 L360 95 L400 70 V220 H0Z" fill="#3b5a8c"/>
        <path d="M150 54 L170 40 L190 58 L180 56 L170 62 L160 56Z M286 66 L300 55 L316 68 L306 66 L300 70 L292 66Z" fill="#e2e8f0"/>
        <path d="M0 150 Q100 120 200 140 T400 130 V220 H0Z" fill="#c7d6ec"/>
        {[[30, 150, 0.8, "#1e3a3a"], [70, 146, 1, "#14532d"], [330, 140, 0.9, "#1e3a3a"], [370, 150, 1.15, "#14532d"], [120, 152, 0.6, "#1e3a3a"], [290, 148, 0.65, "#1e3a3a"]].map(([x, y, s, c], i) => (
          <Pine key={i} x={x} y={y} s={s} c={c}/>
        ))}
      </svg>
      {flakes.map((f, i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", top:0, left:`${f.x}%`, width:f.s, height:f.s, borderRadius:"50%",
          background:"#fff", opacity:f.o, "--dx":`${f.dx}px`, animation:`neige-fall ${f.d}s linear ${f.dl}s infinite`, pointerEvents:"none", zIndex:5 }}/>
      ))}
      <Title color="#f8fafc" sub="Il neige sur l'atelier." style={{ marginTop:8 }}>Nuit d'hiver</Title>
      <div key={say} style={{ position:"relative", zIndex:6, marginTop:10, maxWidth:340, textAlign:"center", fontSize:14, color:"#e0f2fe",
        fontStyle:"italic", animation:"neige-say .5s ease-out both" }}>{say}</div>

      <button onClick={build} aria-label="Le sol enneigé" style={{ ...bare, position:"absolute", left:0, right:0, bottom:0, height:"36%", zIndex:2 }}>
        <svg viewBox="0 0 400 100" preserveAspectRatio="none" width="100%" height="100%" style={{ display:"block" }}>
          <path d="M0 18 Q100 0 200 14 T400 10 V100 H0Z" fill="#f8fafc"/>
          <path d="M0 60 Q120 44 240 58 T400 54 V100 H0Z" fill="#e2ebf7"/>
        </svg>
      </button>
      <div style={{ position:"absolute", left:"50%", bottom:"9%", transform:"translateX(-50%)", width:"min(190px, 48vw)", zIndex:3, pointerEvents:"none" }}>
        <svg viewBox="0 0 200 270" width="100%" style={{ display:"block", overflow:"visible" }}>
          <defs>
            <radialGradient id="neige-ball" cx="38%" cy="32%" r="70%">
              <stop offset="0" stopColor="#ffffff"/><stop offset=".75" stopColor="#e2ebf7"/><stop offset="1" stopColor="#b6c8e2"/>
            </radialGradient>
          </defs>
          <ellipse cx="100" cy="262" rx={step ? 58 : 0} ry="7" fill="rgba(30,58,110,.25)" style={{ transition:"rx .5s" }}/>
          {step >= 1 && <circle cx="100" cy="214" r="50" fill="url(#neige-ball)"
            style={{ transformBox:"fill-box", transformOrigin:"center", animation:"neige-roll .9s cubic-bezier(.2,.8,.3,1) both" }}/>}
          {step >= 2 && (
            <g style={{ animation:"neige-drop .8s ease-out both" }}>
              <path d="M66 135 L30 108 M38 114 L30 100 M134 135 L172 106 M162 113 L172 98" stroke="#5b3a1e" strokeWidth="4" strokeLinecap="round" fill="none"/>
              <circle cx="100" cy="140" r="37" fill="url(#neige-ball)"/>
              {[126, 142, 158].map(y => <circle key={y} cx="100" cy={y} r="3.6" fill="#1f2937"/>)}
            </g>
          )}
          {step >= 3 && (
            <g style={{ animation:"neige-drop .8s ease-out both" }}>
              <circle cx="100" cy="82" r="27" fill="url(#neige-ball)"/>
              <path d="M74 104 Q100 116 126 104 L126 110 Q100 122 74 110Z" fill="#f97316"/>
              <path d="M112 108 L118 132 L108 132 L106 110Z" fill="#ea580c"/>
              <circle cx="91" cy="76" r="3.2" fill="#111"/><circle cx="109" cy="76" r="3.2" fill="#111"/>
              {[[88, 92], [94, 95], [100, 96], [106, 95], [112, 92]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="1.6" fill="#1f2937"/>)}
              <rect x="82" y="40" width="36" height="20" fill="#22c55e"/>
              <path d="M82 46 H118 M82 52 H118" stroke="rgba(0,0,0,.18)" strokeWidth="1.2"/>
              <ellipse cx="100" cy="60" rx="24" ry="5" fill="#94a3b8"/>
              <ellipse cx="100" cy="40" rx="24" ry="5" fill="#cbd5e1"/>
              <ellipse cx="100" cy="40" rx="6" ry="1.6" fill="#475569"/>
            </g>
          )}
          {carrot && <path d="M100 81 L130 86 L100 90 Z" fill="#f97316" stroke="#c2410c" strokeWidth="1"
            style={{ transformBox:"fill-box", transformOrigin:"left center", animation:"neige-carrot .7s cubic-bezier(.3,1.4,.5,1) both" }}/>}
        </svg>
      </div>
      <Hint won={won} color="rgba(224,242,254,.8)">Toute cette neige… de quoi construire un ami.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------- volcan */

const VOLCAN_SAYS = [
  "Il dort. Enfin… il ronfle.",
  "Un petit grondement. Rien de grave.",
  "Ça chauffe à 190 °C. Température PLA.",
  "220 °C. On passe en PETG.",
  "Le sol vibre. L'AMS s'inquiète.",
  "260 °C. ASA, tu es là ?",
  "La pression monte. Comme avant un premier Benchy.",
  "Ça fume de partout !",
  "Il va craquer…",
  "Plus qu'un tout petit…",
];

function Volcan() {
  const [won, win] = useWin("volcan");
  const [p, setP] = useState(0);
  const boom = p >= 10;
  const poke = e => {
    e.stopPropagation();
    if (p >= 10) return;
    const n = p + 1;
    setP(n);
    if (n === 10) win();
  };
  const lava = useMemo(() => Array.from({ length: 54 }, (_, i) => ({
    i, dx: rand(-180, 180), up: rand(80, 230), down: rand(60, 180), d: rand(1.4, 2.6), dl: rand(0, 2.4), s: rand(5, 12),
    c: pick(["#fde047", "#fb923c", "#f97316", "#ef4444", "#facc15"]),
  })), []);
  const smoke = boom ? 9 : 3 + Math.floor(p / 2);

  return (
    <Stage won={won} wonText="Éruption réussie !" font={SANS} style={{ justifyContent:"flex-start" }}
      bg={`linear-gradient(180deg, ${boom ? "#450a0a" : "#1e1b3a"} 0%, ${boom ? "#9a3412" : "#7c3a4a"} 55%, ${boom ? "#f97316" : "#e0846a"} 100%)`}>
      <style>{`
        @keyframes volcan-shake { 0%,100% { transform:translate(0,0) } 25% { transform:translate(var(--a), calc(var(--a) * -1)) }
                                  50% { transform:translate(calc(var(--a) * -1), var(--a)) } 75% { transform:translate(var(--a), var(--a)) } }
        @keyframes volcan-smoke { 0% { transform:translate(-50%, 0) scale(.4); opacity:.75 } 100% { transform:translate(calc(-50% + var(--dx)), -170px) scale(2.6); opacity:0 } }
        @keyframes volcan-x { from { transform:translateX(0) } to { transform:translateX(var(--dx)) } }
        @keyframes volcan-y { 0% { transform:translateY(0); opacity:1; animation-timing-function:cubic-bezier(.2,.7,.4,1) }
                              40% { transform:translateY(var(--up)); animation-timing-function:cubic-bezier(.6,0,.8,.4) }
                              100% { transform:translateY(var(--down)); opacity:.15 } }
        @keyframes volcan-flow { from { stroke-dashoffset:300 } to { stroke-dashoffset:0 } }
        @keyframes volcan-glow { 0%,100% { opacity:.55 } 50% { opacity:1 } }
      `}</style>
      <Title color="#fff7ed" sub={boom ? "Coulée de lave en 0,4 mm de diamètre. Joli débit." : VOLCAN_SAYS[p]} style={{ marginTop:8 }}>
        Le Mont Extrudeur</Title>

      {/* jauge de pression */}
      <div aria-label={`Pression ${p} sur 10`} style={{ position:"absolute", right:14, top:"30%", zIndex:6, display:"flex", flexDirection:"column-reverse",
        gap:3, padding:5, borderRadius:8, background:"rgba(0,0,0,.35)" }}>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} style={{ width:16, height:10, borderRadius:2, transition:"background .2s",
            background: i < p ? `hsl(${110 - i * 12}, 85%, 50%)` : "rgba(255,255,255,.12)", boxShadow: i < p ? `0 0 6px hsl(${110 - i * 12}, 85%, 50%)` : "none" }}/>
        ))}
        <span style={{ fontSize:9, color:"#fed7aa", textAlign:"center", marginBottom:2 }}>bar</span>
      </div>

      <div style={{ position:"absolute", left:"50%", bottom:0, width:"min(520px, 100%)", transform:"translateX(-50%)", zIndex:3 }}>
        <div style={{ "--a":`${boom ? 3 : p * 0.45}px`, animation: p > 0 ? "volcan-shake .12s linear infinite" : "none", position:"relative" }}>
          {Array.from({ length: smoke }, (_, i) => (
            <span key={i} aria-hidden="true" style={{ position:"absolute", left:"50%", top:"34%", width:50, height:50, borderRadius:"50%", zIndex:1,
              background:`radial-gradient(circle, rgba(${boom ? "60,50,50" : "160,150,150"},.85), rgba(80,70,70,0) 70%)`, "--dx":`${(i % 2 ? 1 : -1) * (10 + i * 9)}px`,
              animation:`volcan-smoke ${3 - Math.min(1.4, p * 0.12)}s ease-out ${i * 0.45}s infinite`, pointerEvents:"none" }}/>
          ))}
          {boom && lava.map(l => (
            <span key={l.i} aria-hidden="true" style={{ position:"absolute", left:"50%", top:"36%", zIndex:4, "--dx":`${l.dx}px`,
              animation:`volcan-x ${l.d}s linear ${l.dl}s infinite`, pointerEvents:"none" }}>
              <span style={{ display:"block", width:l.s, height:l.s, borderRadius:"50%", background:l.c, boxShadow:`0 0 10px ${l.c}`,
                "--up":`${-l.up}px`, "--down":`${l.down}px`, animation:`volcan-y ${l.d}s linear ${l.dl}s infinite` }}/>
            </span>
          ))}
          <button onClick={poke} aria-label="Le volcan" style={{ ...bare, display:"block", width:"100%", position:"relative", zIndex:2 }}>
            <svg viewBox="0 0 400 300" width="100%" style={{ display:"block" }}>
              <defs>
                <linearGradient id="volcan-body" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#4a3329"/><stop offset="1" stopColor="#1c1412"/>
                </linearGradient>
                <linearGradient id="volcan-lava" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#fde047"/><stop offset=".5" stopColor="#f97316"/><stop offset="1" stopColor="#b91c1c"/>
                </linearGradient>
              </defs>
              <path d="M0 300 L0 220 Q60 190 110 214 L150 300Z M260 300 L300 206 Q350 186 400 214 V300Z" fill="#2b1d2e"/>
              <path d="M30 300 L165 112 Q200 100 235 112 L370 300 Z" fill="url(#volcan-body)"/>
              <path d="M165 112 Q180 160 150 220 Q140 260 120 300 L30 300Z" fill="rgba(0,0,0,.22)"/>
              <ellipse cx="200" cy="112" rx="36" ry="8" fill="url(#volcan-lava)" style={{ opacity:0.35 + p * 0.065, filter:"drop-shadow(0 0 10px #f97316)" }}/>
              {["M200 120 L192 160 L200 190 L188 232", "M216 124 L228 168 L220 212", "M184 128 L170 174 L177 218"].map((d, i) => (
                <path key={i} d={d} stroke="#f97316" strokeWidth="2.6" fill="none" strokeLinecap="round"
                  style={{ opacity:p / 10, filter:"drop-shadow(0 0 4px #f97316)", animation:"volcan-glow 1.2s ease-in-out infinite", transition:"opacity .3s" }}/>
              ))}
              {boom && ["M190 114 Q176 170 150 210 Q130 250 110 300", "M210 114 Q226 160 248 206 Q268 250 296 300", "M200 116 Q204 190 196 300"].map((d, i) => (
                <path key={i} d={d} stroke="url(#volcan-lava)" strokeWidth={12 - i * 2} fill="none" strokeLinecap="round" strokeDasharray="300"
                  style={{ animation:`volcan-flow ${2.2 + i * 0.6}s ease-out both`, filter:"drop-shadow(0 0 8px #f97316)" }}/>
              ))}
              <rect y="286" width="400" height="14" fill="#120c0a"/>
            </svg>
          </button>
        </div>
      </div>
      <Hint won={won} color="rgba(255,237,213,.75)">Ce volcan a juste besoin d'un peu d'encouragement.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------- export */

export const PAGES = {
  "matrice": Matrice,
  "quarante-deux": QuaranteDeux,
  "benchy": Benchy,
  "generique": Generique,
  "neant": Neant,
  "retro": Retro,
  "zen": Zen,
  "disco": Disco,
  "envers": Envers,
  "cafe": Cafe,
  "labo": Labo,
  "musee": Musee,
  "horloge": Horloge,
  "aquarium": Aquarium,
  "neige": Neige,
  "volcan": Volcan,
};
