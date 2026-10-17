import React from "react";
import { useToast } from "../store/toast";

// Affichage des messages ephemeres (store/toast) : en bas, au-dessus de la
// barre de navigation sur telephone ; ne capte aucun clic.
const TONE = {
  error: { bg: "rgba(239,68,68,0.95)" },
  ok:    { bg: "rgba(34,197,94,0.95)" },
  info:  { bg: "rgba(30,41,59,0.95)" },
};

export default function Toast() {
  const items = useToast(s => s.items);
  if (!items.length) return null;
  return (
    <div className="app-toast" style={{ position:"fixed", left:"50%", transform:"translateX(-50%)",
      zIndex:9500, display:"flex", flexDirection:"column", gap:6, alignItems:"center",
      width:"max-content", maxWidth:"calc(100vw - 32px)", pointerEvents:"none" }}>
      {items.map(t => (
        <div key={t.id} style={{ padding:"9px 14px", borderRadius:12, color:"white", fontSize:13,
          fontWeight:600, lineHeight:1.35, textAlign:"center", boxShadow:"0 6px 20px rgba(0,0,0,0.35)",
          background:(TONE[t.tone] || TONE.info).bg, animation:"toast-in 0.15s ease-out" }}>
          {t.text}
        </div>
      ))}
      <style>{`
        .app-toast { bottom: 24px; }
        @media (max-width: 767px) { .app-toast { bottom: calc(84px + env(safe-area-inset-bottom, 0px)); } }
        @keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
