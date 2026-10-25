import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Medal, TicketStub } from "./medals";

// Ceremonie d'un palier passe avec des tickets : les tickets sont poinçonnes
// un a un, puis la medaille du nouveau palier monte en tournant, dans son halo,
// sous une pluie de confettis a sa couleur.
export default function TicketCeremony({ tier, emoji, name, cost, added, unit, onClose }) {
  const [punched, setPunched] = useState(0);
  const [show, setShow] = useState(false);              // la medaille entre en scene
  useEffect(() => {
    const ts = [];
    for (let i = 1; i <= cost; i++) ts.push(setTimeout(() => setPunched(i), 350 + i * 420));
    ts.push(setTimeout(() => setShow(true), 450 + cost * 420 + 250));
    return () => ts.forEach(clearTimeout);
  }, [cost]);
  const c = tier?.color || "#F59E0B";
  return createPortal(
    <div data-no-pull="" onClick={show ? onClose : undefined} style={{ position:"fixed", inset:0, zIndex:4500,
      background:"radial-gradient(circle at 50% 45%, rgba(0,0,0,.55), rgba(0,0,0,.85))", display:"flex",
      alignItems:"center", justifyContent:"center", padding:16 }}>
      <style>{`
        @keyframes bn-punch { 0% { transform:scale(1) } 40% { transform:scale(.82) rotate(-6deg) } 100% { transform:scale(.92) rotate(-4deg); opacity:.55 } }
        @keyframes bn-rise { 0% { transform:translateY(60px) scale(.2) rotateY(0); opacity:0 }
                             60% { transform:translateY(-8px) scale(1.12) rotateY(540deg); opacity:1 }
                             100% { transform:translateY(0) scale(1) rotateY(720deg); opacity:1 } }
        @keyframes bn-halo { 0%,100% { transform:scale(1); opacity:.75 } 50% { transform:scale(1.15); opacity:1 } }
        @keyframes bn-rays { to { transform:rotate(360deg) } }
        @keyframes bn-banner { from { transform:scale(.6); opacity:0 } to { transform:scale(1); opacity:1 } }
        @keyframes bn-confetti { to { transform:translateY(105vh) rotate(900deg) } }
      `}</style>
      {show && Array.from({ length: 60 }).map((_, i) => (
        <span key={i} style={{ position:"fixed", top:-16, left:`${Math.random() * 100}%`, width:8, height:12, borderRadius:2,
          background: i % 3 ? c : "#fff", opacity:.9, pointerEvents:"none",
          animation:`bn-confetti ${1.8 + Math.random() * 1.6}s ${Math.random() * .5}s ease-in forwards` }}/>
      ))}
      <div onClick={e => e.stopPropagation()} style={{ textAlign:"center", color:"#fff", maxWidth:340, width:"100%" }}>
        {/* les tickets, poinçonnes l'un apres l'autre */}
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap", minHeight:40, marginBottom:18 }}>
          {Array.from({ length: cost }).map((_, i) => (
            <span key={i} style={{ position:"relative", display:"inline-flex",
              animation: i < punched ? "bn-punch .35s ease-out forwards" : "none" }}>
              <TicketStub size={1.8} dim={i < punched}/>
              {i < punched && <span style={{ position:"absolute", left:"58%", top:"50%", width:10, height:10, marginTop:-5,
                borderRadius:"50%", background:"rgba(0,0,0,.75)" }}/>}
              {i === punched - 1 && !show && <span style={{ position:"absolute", top:-18, left:"50%", transform:"translateX(-50%)",
                fontSize:12, fontWeight:900, color:"#fde68a" }}>clac !</span>}
            </span>
          ))}
        </div>
        {/* la medaille */}
        <div style={{ position:"relative", height:170, display:"flex", alignItems:"center", justifyContent:"center" }}>
          {show && <>
            <span style={{ position:"absolute", width:230, height:230, borderRadius:"50%",
              background:`repeating-conic-gradient(${c}55 0 10deg, transparent 10deg 20deg)`, animation:"bn-rays 9s linear infinite",
              WebkitMask:"radial-gradient(circle, #000 30%, transparent 70%)", mask:"radial-gradient(circle, #000 30%, transparent 70%)" }}/>
            <span style={{ position:"absolute", width:150, height:150, borderRadius:"50%",
              background:`radial-gradient(circle, ${c}aa, transparent 70%)`, animation:"bn-halo 1.6s ease-in-out infinite" }}/>
            <span style={{ animation:"bn-rise 1.2s cubic-bezier(.2,.9,.3,1.2) forwards", display:"inline-flex" }}>
              <Medal tier={tier} emoji={emoji} size={130}/>
            </span>
          </>}
          {!show && <span style={{ fontSize:13, color:"rgba(255,255,255,.7)" }}>🎟️ Poinçonnage…</span>}
        </div>
        {show && (
          <div style={{ animation:"bn-banner .5s .6s ease-out both" }}>
            <div style={{ fontSize:26, fontWeight:900, color:"#fff", textShadow:`0 0 18px ${c}` }}>{tier?.emoji} {tier?.label} !</div>
            <div style={{ fontSize:13.5, marginTop:4, color:"rgba(255,255,255,.85)" }}>{name}
              {added ? ` · +${added}${unit ? ` ${unit}` : ""} au compteur` : ""}</div>
            <button onClick={onClose} style={{ marginTop:16, padding:"9px 22px", borderRadius:20, border:"none", fontWeight:900,
              fontSize:14, cursor:"pointer", color:"#7c2d12", background:"linear-gradient(180deg, #fde047, #f59e0b)" }}>Super !</button>
          </div>
        )}
      </div>
    </div>, document.body
  );
}
