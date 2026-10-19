import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Send, Check, AlertTriangle, X, ImagePlus, Star } from "lucide-react";
import { useShares } from "../store/shares";
import { showAlert } from "../utils/dialog";

// Suivi des travaux partis en arriere-plan -- partages Telegram (album,
// conversion des gifs, plusieurs destinations) et ajouts de photos/videos
// (envoi + compression d'une grosse video) -- visible sur toutes les pages.
// Telephone : une puce compacte DANS le header (#header-status). Ordinateur
// (pas de header) : sous le logo de la barre laterale (#sidebar-status).
const up = (j) => j.kind === "upload";
const rt = (j) => j.kind === "rate";
const TONE = {
  sending: { bg: "#229ED9", icon: null,
    long: (j) => rt(j) ? `Évaluation · ${j.title}${j.detail ? ` · ${j.detail}` : "…"}` : up(j) ? `Ajout de ${j.title}…` : `Envoi Telegram · ${j.title}`,
    short: (j) => rt(j) ? "Évaluation" : up(j) ? (j.video ? "Vidéo" : "Photo") : "Envoi" },
  done:    { bg: "#22c55e", icon: Check,
    long: (j) => rt(j) ? `${j.forget ? "Oublié" : "Évaluation publiée"} · ${j.title}` : up(j) ? `${j.video ? "Vidéo ajoutée" : "Photo ajoutée"}` : `Envoyé · ${j.detail}`,
    short: (j) => rt(j) ? (j.forget ? "Oublié" : "Publiée") : up(j) ? "Ajoutée" : "Envoyé" },
  partial: { bg: "#f59e0b", icon: AlertTriangle,
    long: (j) => `Envoi partiel · ${j.title}`, short: () => "Partiel" },
  error:   { bg: "#ef4444", icon: AlertTriangle,
    long: (j) => rt(j) ? `Évaluation non publiée · ${j.title}` : up(j) ? `Échec de l'ajout · ${j.title}` : `Échec de l'envoi · ${j.title}`,
    short: () => "Échec" },
};
const KindIcon = ({ j, size }) => rt(j) ? <Star size={size} style={{ flexShrink:0, opacity:0.85 }}/>
                                : up(j) ? <ImagePlus size={size} style={{ flexShrink:0, opacity:0.85 }}/>
                                        : <Send size={size} style={{ flexShrink:0, opacity:0.85 }}/>;
const MOBILE = "(max-width: 767px)";

function useMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(MOBILE).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    on();   // la largeur a pu changer entre le premier rendu et cet ecouteur
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

const Spinner = ({ size = 12 }) => (
  <span style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, boxSizing:"border-box",
    border:"2px solid rgba(255,255,255,0.4)", borderTopColor:"white", animation:"spin 0.9s linear infinite" }}/>
);

// Clic sur la puce : le detail (raison d'un echec, ou ce qui est en cours) ;
// un envoi termine se ferme en plus.
function open(j, dismiss) {
  if (j.status === "sending") {
    showAlert(rt(j) ? `Publication de l'évaluation de « ${j.title} » en cours (photos puis note).`
      : up(j) ? `Ajout de ${j.title} en cours (envoi puis compression).`
      : `Envoi Telegram en cours : « ${j.title} »` + (j.count > 1 ? ` vers ${j.count} destinations.` : "."));
    return;
  }
  if (j.status === "done") { dismiss(j.id); return; }
  showAlert(j.detail);
  dismiss(j.id);
}

export default function ShareProgress() {
  const jobs = useShares(s => s.jobs);
  const dismiss = useShares(s => s.dismiss);
  const mobile = useMobile();
  const [slot, setSlot] = useState(null);
  // Evaluations en file sur le serveur : leur etat se relit a l'ouverture.
  useEffect(() => { useShares.getState().syncRates(); }, []);
  useEffect(() => { setSlot(document.getElementById(mobile ? "header-status" : "sidebar-status")); }, [mobile]);
  if (!jobs.length) return null;

  if (mobile && slot) {
    // Une seule puce : l'envoi en cours s'il y en a un, sinon le dernier resultat.
    const j = jobs.find(x => x.status === "sending") || jobs[jobs.length - 1];
    const t = TONE[j.status];
    const Icon = t.icon;
    const n = jobs.filter(x => x.status === "sending").length;
    return createPortal(
      <button onClick={() => open(j, dismiss)} aria-label={t.long(j)} title={t.long(j)}
        style={{ display:"flex", alignItems:"center", gap:5, height:26, padding:"0 9px", borderRadius:13,
          border:"none", background:t.bg, color:"white", fontSize:11, fontWeight:700, cursor:"pointer",
          flexShrink:0, whiteSpace:"nowrap" }}>
        {Icon ? <Icon size={12}/> : <Spinner size={11}/>}
        <KindIcon j={j} size={11}/>
        {t.short(j)}{n > 1 ? ` ×${n}` : j.status === "sending" && j.count > 1 ? (rt(j) ? ` ×${j.count}` : ` → ${j.count}`) : ""}
      </button>,
      slot
    );
  }

  if (!slot) return null;
  return createPortal(
    <>
      {jobs.map(j => {
        const t = TONE[j.status];
        const Icon = t.icon;
        const failed = j.status === "error" || j.status === "partial";
        return (
          <div key={j.id} onClick={() => failed && showAlert(j.detail)}
            title={failed ? "Voir le détail" : undefined}
            style={{ display:"flex", alignItems:"center", gap:7, minWidth:0,
              padding:"6px 8px 6px 10px", borderRadius:10, background:t.bg, color:"white",
              fontSize:11.5, fontWeight:700, cursor: failed ? "pointer" : "default" }}>
            {Icon ? <Icon size={14} style={{ flexShrink:0 }}/> : <Spinner/>}
            <KindIcon j={j} size={12}/>
            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0 }}>
              {t.long(j)}{j.status === "sending" && j.count > 1 && !rt(j) ? ` → ${j.count} destinations` : ""}
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
    </>,
    slot
  );
}
