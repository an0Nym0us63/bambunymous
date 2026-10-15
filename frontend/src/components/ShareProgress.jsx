import React from "react";
import { Send, Check, AlertTriangle, X } from "lucide-react";
import { useShares } from "../store/shares";
import { showAlert } from "../utils/dialog";

// Pastille flottante en haut de l'ecran, sur toutes les pages : un partage
// Telegram part en arriere-plan (album, conversion des gifs, plusieurs
// destinations : ca peut durer), on garde la main et on voit ou il en est.
const TONE = {
  sending: { bg: "#229ED9", icon: null,          text: (j) => `Envoi Telegram · ${j.title}` },
  done:    { bg: "#22c55e", icon: Check,         text: (j) => `Envoyé · ${j.detail}` },
  partial: { bg: "#f59e0b", icon: AlertTriangle, text: (j) => `Envoi partiel · ${j.title}` },
  error:   { bg: "#ef4444", icon: AlertTriangle, text: (j) => `Échec de l'envoi · ${j.title}` },
};

export default function ShareProgress() {
  const jobs = useShares(s => s.jobs);
  const dismiss = useShares(s => s.dismiss);
  if (!jobs.length) return null;
  return (
    <div className="share-progress" style={{ position:"fixed", left:"50%", transform:"translateX(-50%)",
      zIndex:1700, display:"flex", flexDirection:"column", gap:6, alignItems:"center",
      width:"max-content", maxWidth:"calc(100vw - 24px)", pointerEvents:"none" }}>
      {jobs.map(j => {
        const t = TONE[j.status];
        const Icon = t.icon;
        const failed = j.status === "error" || j.status === "partial";
        return (
          <div key={j.id} onClick={() => failed && showAlert(j.detail)}
            title={failed ? "Voir le détail" : undefined}
            style={{ pointerEvents:"auto", display:"flex", alignItems:"center", gap:8, maxWidth:"100%",
              padding:"7px 10px 7px 12px", borderRadius:20, background:t.bg, color:"white",
              fontSize:12, fontWeight:700, boxShadow:"0 4px 16px rgba(0,0,0,0.3)",
              cursor: failed ? "pointer" : "default" }}>
            {Icon ? <Icon size={14} style={{ flexShrink:0 }}/>
              : <span style={{ width:12, height:12, borderRadius:"50%", flexShrink:0,
                  border:"2px solid rgba(255,255,255,0.4)", borderTopColor:"white",
                  animation:"spin 0.9s linear infinite" }}/>}
            <Send size={12} style={{ flexShrink:0, opacity:0.8 }}/>
            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0 }}>
              {t.text(j)}{j.status === "sending" && j.count > 1 ? ` → ${j.count} destinations` : ""}
            </span>
            {j.status !== "sending" && (
              <button onClick={(e) => { e.stopPropagation(); dismiss(j.id); }} aria-label="Fermer"
                style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:"50%", width:18, height:18,
                  display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0,
                  color:"white", flexShrink:0 }}>
                <X size={11}/>
              </button>
            )}
          </div>
        );
      })}
      <style>{`
        .share-progress { top: 12px; }
        @media (max-width: 767px) { .share-progress { top: calc(var(--header-h, 52px) + 6px); } }
      `}</style>
    </div>
  );
}
