import React, { useEffect, useMemo, useState } from "react";
import { egg } from "../eggs";

// Une page cachee : le nom de l'appli porte un mot de trop... Pluie de
// caracteres, titre qui se brouille, message tape a la machine.
const GLYPHS = "01PLAPETGTPUABSASA░▒▓{}<>/\\#$%&*+=?ΣΩλ∆".split("");
const LINES = [
  "> connexion établie…",
  "> identité : masquée",
  "> Nous sommes BambuNymous.",
  "> Nous imprimons en couches de 0,2 mm.",
  "> Nous ne gâchons pas le filament.",
  "> Nous n'oublions pas la première couche.",
  "> Attendez-nous… au prochain plateau.",
];

export default function Anonymous() {
  useEffect(() => { egg("anonymous"); }, []);
  // la pluie : des colonnes de caracteres qui tombent a leur rythme
  const cols = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    left: (i / 28) * 100 + Math.random() * 2, dur: 4 + Math.random() * 6, delay: -Math.random() * 8,
    text: Array.from({ length: 22 }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join("\n"),
  })), []);
  // la machine a ecrire
  const [shown, setShown] = useState("");
  useEffect(() => {
    const all = LINES.join("\n");
    let i = 0;
    const t = setInterval(() => { i += 1; setShown(all.slice(0, i)); if (i >= all.length) clearInterval(t); }, 38);
    return () => clearInterval(t);
  }, []);
  // le titre qui se brouille de temps en temps
  const [glitch, setGlitch] = useState(false);
  useEffect(() => {
    const t = setInterval(() => { setGlitch(true); setTimeout(() => setGlitch(false), 220); }, 2600);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ position:"relative", minHeight:"calc(100dvh - 140px)", borderRadius:18, overflow:"hidden",
      background:"radial-gradient(ellipse at center, #0b1f14 0%, #020604 75%)", color:"#22c55e",
      fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", display:"flex", alignItems:"center",
      justifyContent:"center", padding:"40px 16px" }}>
      <style>{`
        @keyframes bn-rain { from { transform:translateY(-100%) } to { transform:translateY(110vh) } }
        @keyframes bn-mask { 0%,100% { transform:translateY(0) rotate(-3deg); filter:drop-shadow(0 0 18px #22c55e) }
                             50% { transform:translateY(-8px) rotate(3deg); filter:drop-shadow(0 0 30px #4ade80) } }
        @keyframes bn-caret { 50% { opacity:0 } }
        @keyframes bn-scan { from { transform:translateY(-100%) } to { transform:translateY(100%) } }
      `}</style>
      {/* la pluie */}
      {cols.map((c, i) => (
        <pre key={i} aria-hidden="true" style={{ position:"absolute", top:0, left:`${c.left}%`, margin:0, fontSize:13, lineHeight:1.15,
          color:"rgba(34,197,94,0.35)", animation:`bn-rain ${c.dur}s linear ${c.delay}s infinite`, pointerEvents:"none",
          textShadow:"0 0 6px rgba(34,197,94,.6)" }}>{c.text}</pre>
      ))}
      {/* balayage d'ecran */}
      <div aria-hidden="true" style={{ position:"absolute", inset:0, pointerEvents:"none",
        background:"repeating-linear-gradient(0deg, rgba(0,0,0,.25) 0 1px, transparent 1px 3px)" }}/>
      <div aria-hidden="true" style={{ position:"absolute", left:0, right:0, height:"30%", pointerEvents:"none",
        background:"linear-gradient(180deg, transparent, rgba(74,222,128,.07), transparent)", animation:"bn-scan 5s linear infinite" }}/>

      <div style={{ position:"relative", maxWidth:520, width:"100%", textAlign:"center", padding:"28px 20px", borderRadius:16,
        background:"rgba(2,6,4,.78)", border:"1px solid rgba(34,197,94,.45)", boxShadow:"0 0 40px rgba(34,197,94,.18)" }}>
        <div style={{ fontSize:84, lineHeight:1, animation:"bn-mask 3.2s ease-in-out infinite" }}>🎭</div>
        <h1 style={{ margin:"14px 0 4px", fontSize:30, letterSpacing:".12em", color:"#4ade80", position:"relative",
          textShadow: glitch ? "3px 0 #ef4444, -3px 0 #3b82f6" : "0 0 12px rgba(74,222,128,.7)",
          transform: glitch ? "skewX(-8deg) translateX(2px)" : "none", transition:"transform .05s" }}>
          {glitch ? "B4MBU_NYM0US" : "BAMBU·NYMOUS"}</h1>
        <div style={{ fontSize:12, color:"rgba(74,222,128,.7)", letterSpacing:".3em" }}>ANONYMOUS PRINT CLUB</div>
        <pre style={{ margin:"20px 0 0", textAlign:"left", whiteSpace:"pre-wrap", fontSize:13.5, lineHeight:1.6, color:"#86efac",
          minHeight: LINES.length * 22 }}>
          {shown}<span style={{ animation:"bn-caret 1s step-end infinite" }}>▌</span></pre>
        <a href="/" style={{ display:"inline-block", marginTop:18, fontSize:12.5, color:"#4ade80", textDecoration:"none",
          border:"1px solid rgba(74,222,128,.5)", padding:"6px 14px", borderRadius:8 }}>&gt; quitter le terminal</a>
      </div>
    </div>
  );
}
