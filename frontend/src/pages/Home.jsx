import React, { useEffect, useState, useCallback, useRef } from "react";
import { usePrinter } from "../store/printer";
import { Wifi, WifiOff, Clock, Pause, Layers, Thermometer, Wind, Droplets, Sun, Moon, LayoutGrid, Printer, Disc3, AlertTriangle, ExternalLink, Calendar, ArrowLeftRight } from "lucide-react";
import { useAuth } from "../store/auth";
import { useFriend } from "../store/friend";
import { create } from "zustand";
import client, { apiUrl } from "../api/client";
import AttentionSection from "../components/AttentionSection";
import HomeGrid from "../components/HomeGrid";
import { gradeOf } from "./Achievements";
import LiveCamera from "../components/LiveCamera";
import Lightbox from "../components/Lightbox";
import { relayed } from "../components/Friends";
import { AMSBox, AMSDetail, TrayBottomSheet } from "../components/AMSSection";
import { grilleAccueil, lireDisposition, columnWeight, slotCount, slotLabel } from "../utils/ams";

// ── Helpers ────────────────────────────────────────────────────────────────
function hexCss(hex) {
  if (!hex) return null;
  const h = hex.slice(0, 6);
  if (h.replace(/0/g,"") === "") return null;
  return `#${h}`;
}
function fmtTime(mins) {
  if (!mins) return null;
  const h = Math.floor(mins/60), m = mins%60;
  return h > 0 ? `${h}h ${m > 0 ? m+"min" : ""}` : `${m}min`;
}

// Heure de fin estimée + décalage en jours (0 = aujourd'hui, 1 = demain, etc.)
function fmtFinishTime(mins) {
  if (!mins) return null;
  const now = new Date();
  const finish = new Date(now.getTime() + mins * 60000);
  const dayDiff = Math.round(
    (new Date(finish.getFullYear(), finish.getMonth(), finish.getDate()) -
     new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000
  );
  const time = finish.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  return { time, dayDiff };
}

// ── Status Banner ──────────────────────────────────────────────────────────
const STATUS_CFG = {
  RUNNING: { label:"En cours",    color:"#3b82f6", dot:"#60a5fa" },
  PAUSE:   { label:"En pause",    color:"#f59e0b", dot:"#fbbf24" },
  FINISH:  { label:"Terminé",     color:"#22c55e", dot:"#4ade80" },
  FAILED:  { label:"Erreur",      color:"#ef4444", dot:"#f87171" },
  IDLE:    { label:"En veille",   color:"#475569", dot:"#64748b" },
  PREPARE: { label:"Préparation", color:"#6366f1", dot:"#818cf8" },
};


// (alerte HMS désormais affichée en badge discret dans StatusBanner)


const HMS_SEV = {
  fatal:   { label: "Fatal",   color: "#dc2626" },
  serious: { label: "Sérieux", color: "#f97316" },
  common:  { label: "Courant", color: "#f59e0b" },
  info:    { label: "Info",    color: "#3b82f6" },
};

const FR_ACCENT = "#8b5cf6";      // violet : le bandeau d'une autre machine ne se confond pas avec le mien

function StatusBanner({ status, friend = null, switcher = null, defaultExpanded = false, showCamera = true, showTemps = true }) {
  // Chez un copain : ses donnees (impression en cours, camera) passent par le relais.
  const via = (path) => friend ? `/friends/${friend.id}/p${path}` : path;
  const img = (path) => friend ? relayed(`/api/v1/friends/${friend.id}/p${path}`) : apiUrl(path);
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => { setExpanded(defaultExpanded); }, [defaultExpanded]);
  const camRef      = useRef(null);
  const timerRef    = useRef(null);
  const inFlightRef = useRef(false);
  // Adresse de la camera lue a chaque image : changer de machine (moi / un
  // copain) ne laisse jamais tourner le flux de l'autre.
  const camUrl = useRef(null);
  camUrl.current = () => img(`/camera/snapshot?t=${Date.now()}`);

  const stopCam = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    inFlightRef.current = false;
    // Réinitialiser l'image pour éviter l'icône cassée au prochain déploi
    if (camRef.current) { camRef.current.removeAttribute("src"); camRef.current.style.display = ""; }
  };
  const tickCam = () => {
    if (inFlightRef.current || !camRef.current) return;
    inFlightRef.current = true;
    camRef.current.src = camUrl.current();
  };
  const startCam = () => {
    if (timerRef.current) return;
    tickCam();
    // Chez un copain, tout passe par le relais : une image toutes les 3 s suffit.
    timerRef.current = setInterval(tickCam, friend ? 3000 : 1500);
  };

  const isRunning = status?.status === "RUNNING";
  const [visKey, setVisKey] = React.useState(0);
  React.useEffect(() => {
    const onVisible = () => { if (!document.hidden) setVisKey(k => k+1); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  // Déplier possible même hors impression (pour voir temps, températures)
  // visKey est incremente au retour de l'app (visibilitychange) : sans lui dans
  // les deps, le flux coupe par le navigateur en arriere-plan ne redemarrait pas
  // et il fallait replier/deplier. Le cleanup (stopCam) remet timer, inFlightRef
  // et l'img a zero, puis startCam repart proprement.
  useEffect(() => {

    // la camera du panneau est desormais LiveCamera (flux reel, ou captures) : plus de releve ici
    stopCam();
    return stopCam;
  }, [expanded, isRunning, visKey, friend?.id]);

  const [printInfo, setPrintInfo] = useState(null);

  // Au moins un tray chargé dont le filament n'a pas été retrouvé en base
  const hasUnmatched = (status?.ams_list || []).some(ams =>
    (ams.trays || []).some(t => t.match_mode === "notfound")
  );

  // Charger les infos du print en cours (vignette + nom).
  // En cours, en pause ou en preparation : l'impression IN_PROGRESS. Sinon
  // (arretee, echouee, terminee, au repos) : la plus RECENTE, quel que soit son
  // resultat -- avant, tout ce qui n'etait pas RUNNING allait chercher le
  // dernier print REUSSI, d'ou la vignette d'un autre print en pause ou apres
  // un arret. Rechargee aussi quand le travail change (job_id).
  useEffect(() => {
    if (!status?.status) return;
    const live = ["RUNNING", "PAUSE", "PREPARE", "SLICING"].includes(status.status);
    client.get(via("/prints"), { params: { limit: 1, ...(live ? { status: "IN_PROGRESS" } : {}) } })
      .then(r => { const p = r.data?.prints?.[0]; if (p) setPrintInfo(p); })
      .catch(() => {});
  }, [status?.status, status?.job_id, friend?.id]);
  // Changement de machine (moi / un copain) : la vignette de l'autre ne reste pas.
  useEffect(() => { setPrintInfo(null); }, [friend?.id]);

  if (!status) return <div className="card" style={{ height:56, animation:"pulse 2s infinite" }} />;
  const cfg    = STATUS_CFG[status.status] ?? STATUS_CFG.IDLE;
  const pct    = status.progress ?? 0;
  const remain = fmtTime(status.remaining_minutes);
  const finish = fmtFinishTime(status.remaining_minutes);
  // Double buse si le MQTT remonte 2 buses (H2C, H2D, X2D...)
  const isDualNozzle = (status.nozzle_count ?? (status.nozzles?.length ?? 0)) >= 2;
  const _allNozzles = status.nozzles || [];
  const nozzle0 = _allNozzles.find(n => n.id === 0);
  const nozzle1 = _allNozzles.find(n => n.id === 1);
  const left   = isDualNozzle ? nozzle1 : (nozzle1 || nozzle0);
  const right  = isDualNozzle ? nozzle0 : null;



  const TempChip = ({ label, current, target, active, accent }) => {
    const hot = current > 40;
    return (
      <div style={{ flex:1, background: active ? "rgba(59,130,246,0.08)" : "var(--surface2)",
        border:`1px solid ${active ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
        borderRadius:10, padding:"8px 10px", position:"relative", overflow:"hidden" }}>
        {active && <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:"linear-gradient(90deg,transparent,#3b82f6,transparent)" }}/>}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:2 }}>
          <span style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em" }}>{label}</span>
          {active && <span style={{ fontSize:8, color:"#3b82f6", fontWeight:700 }}>ACTIF</span>}
        </div>
        <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
          <span style={{ fontSize:22, fontWeight:700, fontFamily:"monospace", lineHeight:1,
            color: current===0 ? "var(--muted)" : hot ? (accent||"#fb923c") : "var(--text)" }}>
            {current > 0 ? Math.round(current) : "—"}
          </span>
          <span style={{ fontSize:11, color:"var(--muted)" }}>°</span>
          {target > 0 && <span style={{ fontSize:11, color:"var(--muted)", marginLeft:"auto", fontFamily:"monospace" }}>/{Math.round(target)}°</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="card" style={{ overflow:"hidden", ...(friend ? { borderColor:"rgba(139,92,246,0.45)" } : null) }}>

      {/* Header cliquable (div : il peut contenir le selecteur des copains) */}
      <div role="button" tabIndex={0} onClick={() => setExpanded(e => !e)}
        style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:0, position:"relative", zIndex:1 }}>

        {/* Nom du print — ligne complète en haut */}
        <div style={{ padding:"10px 16px 4px", display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", backgroundColor:cfg.dot, flexShrink:0,
            animation:isRunning?"livePulse 2s infinite":"none" }} />
          {friend && <span style={{ fontSize:11, fontWeight:600, color:FR_ACCENT, flexShrink:0 }}>👀 {friend.name} ·</span>}
          <p style={{ fontWeight:700, fontSize:14, color:"var(--text)", margin:0,
            flex:1, textAlign:"left", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"clip" }}>
            {printInfo?.file_name || status.print_name || cfg.label}
          </p>
          {hasUnmatched && (
            <span title="Au moins un filament détecté par l'imprimante est introuvable en base">
              <AlertTriangle size={13} style={{ color:"#ef4444", flexShrink:0 }} />
            </span>
          )}
          {status.hms_errors?.length > 0 && (
            <span title={`${status.hms_errors.length} alerte${status.hms_errors.length>1?"s":""} HMS imprimante`}>
              <AlertTriangle size={13} style={{ color:"#f59e0b", flexShrink:0 }} />
            </span>
          )}
          {status.connected
            ? <Wifi size={14} style={{ color:"#22c55e", flexShrink:0 }} />
            : <WifiOff size={14} style={{ color:"#ef4444", flexShrink:0 }} />}
        </div>

        {/* Ligne du bas : vignette + infos + % */}
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"4px 16px 12px" }}>
          {/* Vignette */}
          <div style={{ width:72, height:72, borderRadius:10, overflow:"hidden", flexShrink:0,
            background:"var(--surface2)" }}>
            {printInfo && (friend || printInfo.plate_image) && (
              <img key={`${friend?.id || "me"}-${printInfo.id}`} src={img(`/prints/${printInfo.id}/image`)} alt=""
                style={{ width:"100%", height:"100%", objectFit:"cover" }}
                onError={e => e.currentTarget.style.display="none"}/>
            )}
          </div>
          <div style={{ flex:1, minWidth:0, textAlign:"left" }}>
            <p style={{ fontSize:11, color:"var(--muted)", margin:"0 0 6px" }}>{cfg.label}</p>
            {/* Barre de progression */}
            {isRunning && pct > 0 && (
              <div style={{ marginBottom:6 }}>
                <div style={{ height:9, borderRadius:5, background:"var(--border)", overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${pct}%`,
                    background:`linear-gradient(90deg,${cfg.color},${cfg.color}cc)`,
                    boxShadow:`0 0 8px ${cfg.color}99`,
                    borderRadius:5, transition:"width 1s" }}/>
                </div>
              </div>
            )}
            {isRunning && (
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {remain && <span style={{ fontSize:11, color:"var(--muted)", display:"flex", alignItems:"center", gap:3 }}><Clock size={10}/>{remain}</span>}
                {status.total_layers > 0 && <span style={{ fontSize:11, color:"var(--muted)", display:"flex", alignItems:"center", gap:3 }}><Layers size={10}/>{status.layer}/{status.total_layers}</span>}
                {finish && (
                  <span style={{ fontSize:11, color:"var(--muted)", display:"flex", alignItems:"center", gap:3 }}>
                    <Calendar size={10}/>{finish.time}
                    {finish.dayDiff > 0 && (
                      <sup style={{ fontSize:9, fontWeight:800, color:cfg.color, marginLeft:1 }}>+{finish.dayDiff}</sup>
                    )}
                  </span>
                )}
              </div>
            )}
          </div>
          {(isRunning || switcher) && (
            <span style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6, flexShrink:0 }}>
              {isRunning && <span style={{ fontSize:24, fontWeight:800, fontFamily:"monospace",
                color: friend ? FR_ACCENT : cfg.color, letterSpacing:"-0.02em" }}>{pct}%</span>}
              {switcher}
            </span>
          )}
        </div>
      </div>

      {/* Panneau déplié */}
      {expanded && (
        <div style={{ borderTop:"1px solid var(--border)" }}>
          {/* Caméra */}
          {/* Camera injoignable (chez un copain notamment) : le bloc disparait, le panneau se reduit. */}
          {showCamera && <LiveCamera maxHeight={280}/>}

          {/* Températures + infos */}
          <div style={{ padding:12, display:"flex", flexDirection:"column", gap:10 }}>
            {/* Buses */}
            {showTemps && <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {left  && <TempChip label={isDualNozzle ? "Buse Gauche" : "Buse"} current={left.temp}  target={left.target}  active={left.active}/>}
              {right && isDualNozzle && <TempChip label="Buse Droite" current={right.temp} target={right.target} active={right.active}/>}
              <TempChip label="Plateau" current={status.bed_temp}     target={status.target_bed_temp} accent="#ef4444" />
              <TempChip label="Chambre" current={status.chamber_temp} target={status.target_chamber_temp} />
            </div>}
            {/* Encart alertes HMS : criticite + libelle + lien wiki */}
            {status.hms_decoded?.length > 0 && (() => {
              const worst = status.hms_decoded[0]?.severity || "info";
              const tone = HMS_SEV[worst] || HMS_SEV.info;
              return (
                <div style={{ borderRadius:14, overflow:"hidden",
                  border:`1px solid ${tone.color}44`,
                  background:`linear-gradient(180deg, ${tone.color}1f, ${tone.color}0a)` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7, padding:"9px 12px",
                    background:`${tone.color}22`, color:tone.color, fontSize:11, fontWeight:800,
                    letterSpacing:"0.02em" }}>
                    <AlertTriangle size={14}/>
                    {status.hms_decoded.length} alerte{status.hms_decoded.length>1?"s":""} imprimante
                  </div>
                  <div style={{ display:"flex", flexDirection:"column" }}>
                    {status.hms_decoded.map((h,i) => {
                      const sc = HMS_SEV[h.severity] || HMS_SEV.info;
                      return (
                        <a key={i} href={h.wiki} target="_blank" rel="noreferrer"
                          style={{ display:"flex", gap:10, alignItems:"flex-start", textDecoration:"none",
                            padding:"10px 12px",
                            borderTop: i>0 ? "1px solid var(--border)" : "none" }}>
                          <span style={{ flexShrink:0, width:8, height:8, borderRadius:"50%",
                            background:sc.color, marginTop:5, boxShadow:`0 0 0 3px ${sc.color}22` }}/>
                          <span style={{ flex:1, minWidth:0 }}>
                            <span style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                              <span style={{ fontSize:9, fontWeight:800, color:sc.color,
                                textTransform:"uppercase", letterSpacing:"0.04em" }}>{sc.label}</span>
                              <span style={{ fontSize:10, color:"var(--muted)", fontFamily:"monospace" }}>{h.code}</span>
                            </span>
                            <span style={{ display:"block", fontSize:12.5, color:"var(--text)", lineHeight:1.45, marginTop:2 }}>
                              {h.label || "Code non répertorié — appuyez pour ouvrir le wiki"}
                            </span>
                          </span>
                          <ExternalLink size={13} style={{ flexShrink:0, color:"var(--muted)", marginTop:3 }}/>
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Icône détection filament ─────────────────────────────────────────────────
function MatchBadge({ mode }) {
  const cfg = { rfid:{symbol:"⬡",color:"#22c55e",title:"Tag RFID Bambu Lab"},
                color:{symbol:"◈",color:"#f59e0b",title:"Matching couleur"},
                manual:{symbol:"◇",color:"#94a3b8",title:"Non identifié"} }[mode];
  if (!cfg) return null;
  return <span title={cfg.title} style={{ fontSize:9, color:cfg.color,
    textShadow:"0 0 3px rgba(0,0,0,0.9)", userSelect:"none", lineHeight:1 }}>{cfg.symbol}</span>;
}

// ── Vortek Rack ────────────────────────────────────────────────────────────

// Déduire l'état du slot
function slotStatus(slot, isOnHead) {
  if (isOnHead)                                                        return "head";     // monté sur la buse droite, slot vide
  if (!slot?.filament_id && !slot?.wear && !slot?.print_time)          return "empty";    // pas de hotend
  if (!slot?.filament_id)                                              return "no_fila";  // hotend sans filament
  return "loaded";
}

function WearBar({ wear }) {
  const filled = Math.min(5, Math.max(0, Math.round((wear / 255) * 5)));
  const color  = filled <= 2 ? "#22c55e" : filled <= 3 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display:"flex", gap:2 }}>
      {[1,2,3,4,5].map(i => (
        <div key={i} style={{ height:4, flex:1, borderRadius:2,
          backgroundColor: i <= filled ? color : "var(--border)" }} />
      ))}
    </div>
  );
}

function SlotMini({ slot, num, isOnHead, isSelected, onClick, headColor, activeNozzleId }) {
  const status = slotStatus(slot, isOnHead);
  const isHead = status === "head";
  const color  = isHead
    ? (headColor ? `#${headColor.slice(0,6)}` : null)
    : (status === "loaded" ? `#${slot?.color?.slice(0,6)}` : null);
  // id=0 = buse droite, id=1 = buse gauche
  const isRightNozzle = activeNozzleId === 0;
  const headBorderStyle = isHead ? (isRightNozzle ? "solid" : "dashed") : "solid";

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
      <button onClick={onClick} style={{
        border: isHead ? `1.5px ${headBorderStyle} rgba(59,130,246,0.6)` : isSelected ? "1.5px solid rgba(255,255,255,0.2)" : status === "empty" ? "1.5px dashed rgba(148,163,184,0.5)" : "1.5px solid var(--border)",
        borderRadius:10, padding:8,
        background: isHead ? "rgba(59,130,246,0.06)" : "var(--surface2)",
        display:"flex", flexDirection:"column", gap:4,
        alignItems:"center", cursor:"pointer", transition:"all 0.2s", minWidth:44,
        boxShadow: isHead ? "0 4px 16px rgba(59,130,246,0.15)" : "none",
      }}>
        {/* Couleur du slot — couleur réelle même sur la tête */}
        <div style={{ width:22, height:22, borderRadius:6,
          background: color
            ? color
            : isHead ? "rgba(59,130,246,0.15)"
            // Hotend présent mais pas de filament → hachures -45° (même sens que AMS)
            : status === "no_fila" ? "repeating-linear-gradient(-45deg, rgba(148,163,184,0.25) 0px, rgba(148,163,184,0.25) 2px, transparent 2px, transparent 6px)"
            // Pas de hotend du tout → fond gris très léger
            : status === "empty" ? "rgba(148,163,184,0.08)"
            : "var(--border)",
          border: isHead ? `1.5px ${headBorderStyle} #3b82f6` : "1px solid rgba(255,255,255,0.1)",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:10 }}>
          {status === "empty" && <span style={{ fontSize:13, color:"rgba(148,163,184,0.6)", lineHeight:1, fontWeight:400 }}>✕</span>}
        </div>
        {slot?.match_mode && !isHead && status==="loaded" && (
          <span style={{ position:"absolute", top:-2, right:-2, zIndex:1 }}><MatchBadge mode={slot.match_mode}/></span>
        )}
        <span style={{ fontSize:9, fontFamily:"monospace", fontWeight:700,
          color: isHead ? "#60a5fa" : "var(--muted)" }}>{num}</span>
      </button>
      {/* Barre de sélection — identique à AMSBox pour cohérence visuelle */}
      <div style={{ height:2, borderRadius:1, background: isSelected ? "#3b82f6" : "transparent",
        width: isSelected ? 32 : 8, transition:"all 0.3s" }} />
    </div>
  );
}

function SlotDetail({ slot, num, isOnHead, headSlot }) {
  const status   = slotStatus(slot, isOnHead);
  // Quand sur la tête, utiliser la couleur du headSlot
  const _colorSrc = (status === "head" && headSlot) ? headSlot : slot;
  const rawColor = (_colorSrc?.color || "").replace(/^#/, "");
  const cssColor = rawColor.length >= 6 ? `#${rawColor.slice(0,6)}` : null;
  const [filInfo, setFilInfo] = React.useState(null);

  // Chercher le filament dans notre BDD par profile_id + couleur
  React.useEffect(() => {
    const fid = ((isOnHead && headSlot ? headSlot.filament_id : slot?.filament_id) || "").toUpperCase();
    const col  = rawColor.slice(0,6).toLowerCase();
    if (!fid) { setFilInfo(null); return; }
    client.get("/filaments/filaments")
      .then(r => {
        const fils = r.data || [];
        // Match exact : profile_id + couleur
        let match = fils.find(f =>
          f.profile_id?.toUpperCase() === fid &&
          (f.color || "").toLowerCase().slice(0,6) === col
        );
        // Fallback : juste le profile_id
        if (!match) match = fils.find(f => f.profile_id?.toUpperCase() === fid);
        setFilInfo(match || null);
      }).catch(() => setFilInfo(null));
  }, [slot?.filament_id, rawColor, headSlot?.filament_id]);

  if (!slot) return <div style={{ flex:1 }}/>;

  const displaySlot = (status === "head" && headSlot) ? headSlot : slot;
  const fid = displaySlot.filament_id || "";
  const hours = displaySlot.print_time ? Math.floor(displaySlot.print_time / 3600) : 0;
  const mins  = displaySlot.print_time ? Math.floor((displaySlot.print_time % 3600) / 60) : 0;
  const timeStr = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}min` : ""}` : mins > 0 ? `${mins}min` : null;

  const isHead = status === "head";
  const borderColor = isHead ? "rgba(59,130,246,0.4)" : "var(--border)";
  const bg = isHead ? "rgba(59,130,246,0.04)" : "var(--surface2)";

  // Couleur swatch : colors_array de notre filament si dispo, sinon couleur du slot
  const swatchHexes = filInfo?.colors_array
    ? filInfo.colors_array.split(",").map(c => c.trim())
    : cssColor ? [cssColor] : [];
  const multiType = filInfo?.multicolor_type;

  return (
    <div style={{ border:`1px solid ${borderColor}`, borderRadius:16, overflow:"hidden",
      background: bg, flex:1,
      boxShadow: isHead ? "0 0 0 2px rgba(59,130,246,0.12)" : "0 2px 8px rgba(0,0,0,0.06)" }}>

      {/* Bandeau couleur */}
      {swatchHexes.length > 0 && (
        <div style={{ height:6,
          background: swatchHexes.length > 1
            ? multiType === "gradient"
              ? `linear-gradient(90deg, ${swatchHexes.join(",")})`
              : `repeating-linear-gradient(90deg, ${swatchHexes.map((c,i,a) => `${c} ${i/a.length*100}%, ${c} ${(i+1)/a.length*100}%`).join(",")})`
            : swatchHexes[0]
        }}/>
      )}

      <div style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
        {/* En-tête */}
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {/* Swatch couleur */}
          <div style={{ width:44, height:44, borderRadius:12, flexShrink:0, overflow:"hidden",
            border:"1px solid rgba(0,0,0,0.08)",
            background: swatchHexes.length > 1
              ? multiType === "gradient"
                ? `linear-gradient(135deg, ${swatchHexes.join(",")})`
                : `linear-gradient(90deg, ${swatchHexes.map((c,i,a) => `${c} ${i/a.length*100}%, ${c} ${(i+1)/a.length*100}%`).join(",")})`
              : swatchHexes[0] || "var(--border)" }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
              <span style={{ fontWeight:800, fontSize:15, color:"var(--text)" }}>Slot {num}</span>
              {isHead && (
                <span style={{ fontSize:9, background:"rgba(59,130,246,0.12)", color:"#60a5fa",
                  padding:"2px 8px", borderRadius:20, fontWeight:700 }}>Sur la tête</span>
              )}
              {status === "no_fila" && (
                <span style={{ fontSize:9, background:"rgba(245,158,11,0.12)", color:"#f59e0b",
                  padding:"2px 8px", borderRadius:20, fontWeight:700 }}>Sans filament</span>
              )}
              {status === "empty" && (
                <span style={{ fontSize:9, background:"var(--border)", color:"var(--muted)",
                  padding:"2px 8px", borderRadius:20, fontWeight:700 }}>Vide</span>
              )}
            </div>
            <p style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace", margin:0 }}>
              {displaySlot.nozzle_type || "—"} · {displaySlot.diameter}mm
            </p>
          </div>
        </div>

        {status !== "empty" && (
          <>
            {/* Filament identifié */}
            <div style={{ padding:"10px 12px", borderRadius:10,
              background:"var(--surface)", border:"1px solid var(--border)" }}>
              {filInfo ? (
                <>
                  <p style={{ fontWeight:700, fontSize:13, color:"var(--text)", margin:"0 0 2px" }}>
                    {filInfo.translated_name || filInfo.name}
                  </p>
                  {filInfo.translated_name && filInfo.translated_name !== filInfo.name && (
                    <p style={{ fontSize:10, color:"var(--muted)", margin:"0 0 4px" }}>{filInfo.name}</p>
                  )}
                  <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>
                    {[filInfo.manufacturer, filInfo.fila_type || filInfo.material].filter(Boolean).join(" · ")}
                    {filInfo.fila_color_code && <span style={{ fontFamily:"monospace" }}> · {filInfo.fila_color_code}</span>}
                  </p>
                </>
              ) : fid ? (
                <p style={{ fontFamily:"monospace", fontSize:13, color:"var(--text)", margin:0 }}>{fid}</p>
              ) : (
                <p style={{ fontSize:12, color:"var(--muted)", fontStyle:"italic", margin:0 }}>Filament non identifié</p>
              )}
            </div>

            {/* Durée usage */}
            {timeStr && (
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <Clock size={13} style={{ color:"var(--muted)", flexShrink:0 }}/>
                <span style={{ fontSize:12, color:"var(--muted)" }}>
                  <b style={{ color:"var(--text)", fontFamily:"monospace" }}>{timeStr}</b> d'utilisation cumulées
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


// Vue retenue de la tuile AMS/rack, par appareil.
const VIEW_KEY = "home.deviceView";
// Duree du clignotement du bouton de bascule quand l'unite active change sur
// la vue cachee : assez pour etre vu, pas au point de devenir un bruit de fond.
const BLINK_MS = 20000;

// La selection (AMS ou buse regardes, vue AMS/rack) est partagee : l'apercu et
// le detail peuvent vivre dans deux tuiles de l'accueil et rester accordes.
const useDevSel = create(set => ({
  selAms: null, selHotend: null,
  view: (() => { try { return localStorage.getItem(VIEW_KEY) === "rack" ? "rack" : "ams"; } catch { return "ams"; } })(),
  setSelAms: v => set({ selAms: v }), setSelHotend: v => set({ selHotend: v }), setView: v => set({ view: v }),
}));

// part : "overview" (les AMS ou le rack), "detail" (la fiche de l'AMS ou de la buse
// choisie), ou rien (les deux, l'un sous l'autre)
export function DeviceGrid({ amsList, activeAmsId, activeTrayId, rack, spoolLookup, activeNozzleId, part = null }) {
  const uniqueAmsList = amsList ? [...new Map(amsList.map(a=>[a.id,a])).values()] : [];
  const hasRack = (rack?.hotends ?? []).some(h => !h.empty && h.filament_id);
  const headId  = rack?.head_id ?? -1;
  const headSlot = hasRack ? (rack.hotends.find(s => s.id === 0) ?? null) : null;
  // Couleur réelle du filament en train d'être extrudé (le champ color du headSlot
  // est parfois vide une fois le hotend monté) — fallback sur le tray AMS actif
  const activeAms      = amsList?.find(a => a.id === activeAmsId) ?? null;
  const activeTray      = activeAms?.trays?.find(t => t.id === activeTrayId) ?? null;
  const headColorValue  = headSlot?.color || activeTray?.color || null;

  const slots = hasRack ? [1,2,3,4,5,6].map(num => {
    const targetId = num + 15; // slot 1→id16 ... slot 6→id21
    const onHead   = headId === targetId;
    const slot     = rack.hotends.find(s => s.id === targetId) ?? null;
    const displaySlot = slot ?? (onHead ? { id: targetId, filament_id:"", color:"", diameter:0.4, nozzle_type:"HS01", wear:0, print_time:0, empty:true } : null);
    return { slot: displaySlot, num, onHead };
  }) : [];
  const filled = slots.filter(s => s.slot?.filament_id && !s.onHead).length;

  const autoAmsId = uniqueAmsList.length ? (activeAmsId >= 0 ? activeAmsId : uniqueAmsList[0]?.id ?? 0) : null;
  // Deux selections, une par vue : basculer vers le rack puis revenir ne doit
  // pas perdre l'AMS qu'on regardait.
  const selAms = useDevSel(s => s.selAms), setSelAms = useDevSel(s => s.setSelAms);
  const selHotend = useDevSel(s => s.selHotend), setSelHotend = useDevSel(s => s.setSelHotend);
  const [selectedTray, setSelectedTray] = useState(null);
  const [amsOrder, setAmsOrder] = useState(null);

  // La tuile montre SOIT les AMS, SOIT le rack : cote a cote, trois colonnes
  // d'AMS ecrasaient tout sur un telephone, et empiler le rack dessous doublait
  // la hauteur de la carte. Choix retenu par appareil (commodite locale).
  const view = useDevSel(s => s.view), setViewState = useDevSel(s => s.setView);
  const setView = (v) => {
    setViewState(v);
    setBlink(false);
    try { localStorage.setItem(VIEW_KEY, v); } catch {}
  };
  const showRack = hasRack && view === "rack";

  // Si l'AMS/tray actif change pendant qu'on est sur l'accueil, suivre automatiquement
  // (comme si on avait cliqué dessus) plutôt que de rester figé sur une vieille sélection.
  // La VUE, elle, ne bascule jamais seule : une tuile qui change sous le doigt
  // pendant une impression est penible. Si le changement a lieu sur la vue
  // cachee, c'est le bouton de bascule qui clignote.
  const [blink, setBlink] = useState(false);
  const blinkTimer = useRef(null);
  const signal = () => {
    setBlink(true);
    clearTimeout(blinkTimer.current);
    blinkTimer.current = setTimeout(() => setBlink(false), BLINK_MS);
  };
  useEffect(() => () => clearTimeout(blinkTimer.current), []);

  const prevActive = useRef({ ams: activeAmsId, tray: activeTrayId });
  useEffect(() => {
    if (prevActive.current.ams !== activeAmsId || prevActive.current.tray !== activeTrayId) {
      if (activeAmsId >= 0) {
        setSelAms(activeAmsId);
        if (showRack) signal();
      }
      prevActive.current = { ams: activeAmsId, tray: activeTrayId };
    }
  }, [activeAmsId, activeTrayId]);

  const prevHead = useRef(headId);
  useEffect(() => {
    if (prevHead.current !== headId) {
      if (hasRack && !showRack && headId >= 0) signal();
      prevHead.current = headId;
    }
  }, [headId]);

  useEffect(() => {
    client.get("/settings/ams-order").then(({ data }) => setAmsOrder(data.order ?? null))
      .catch(() => setAmsOrder(null));
  }, []);

  if (!uniqueAmsList.length && !hasRack) return part === "detail" ? null : (
    <div className="card" style={{ padding:24, textAlign:"center", color:"var(--muted)", fontSize:14 }}>Aucun AMS détecté</div>
  );

  const headEntry = slots.find(s => s.onHead) ?? null;
  const selectedAms = uniqueAmsList.find(a => a.id === (selAms ?? autoAmsId)) ?? uniqueAmsList[0] ?? null;
  const hotendNum = selHotend ?? headEntry?.num ?? 1;
  const selectedHotend = slots.find(s => s.num === hotendNum) ?? null;
  // La fiche du dessous suit la vue affichee. Sans AMS du tout, seul le rack
  // a quelque chose a montrer.
  const detailKind = (showRack || !uniqueAmsList.length) && hasRack ? "hotend" : "ams";

  // Grille des AMS : les dimensions et les cases choisies dans les reglages
  // (lignes x colonnes). Sans reglage, une rangee jusqu'a quatre unites.
  const cols = grilleAccueil(uniqueAmsList, lireDisposition(amsOrder));
  const nbLignes = cols[0]?.length || 1;
  const template = cols.map(c => `${columnWeight(c)}fr`).join(" ");

  // Chaque unite est posee sur SA ligne d'une grille commune, et non dans
  // une sous-grille par colonne : une case vide en haut d'une colonne avait
  // alors une hauteur nulle, et l'unite du bas remontait d'un cran, decalee
  // de ses voisines (l'externe seul en bas de sa colonne).
  const units = cols.flatMap((col, ci) => col.map((ams, ri) => ams && (
    <div key={ams.id} style={{ gridColumn: ci + 1, gridRow: ri + 1, minWidth:0 }}>
      <AMSBox ams={ams} activeAmsId={activeAmsId} activeTrayId={activeTrayId}
        isSelected={detailKind === "ams" && selectedAms?.id === ams.id}
        onClick={() => setSelAms(ams.id)}
        spoolLookup={spoolLookup}
        slotsWidth={`${(slotCount(ams) / columnWeight(col)) * 100}%`}/>
    </div>
  ))).filter(Boolean);

  // Bouton de bascule : il annonce l'essentiel de la vue CACHEE, pour qu'on
  // n'ait pas a basculer juste pour savoir. Vue AMS → buse montee sur la tete
  // et sa couleur ; vue rack → emplacement AMS actif et sa couleur.
  const toggle = hasRack && (() => {
    const toRack = !showRack;
    const label = toRack
      ? (headEntry ? `Rack · buse ${headEntry.num}` : "Rack")
      : (activeAms && activeTray ? `AMS · ${slotLabel(activeAms.id, activeTray.id)}` : "AMS");
    const dot = toRack ? (headEntry ? headColorValue : null) : (activeTray?.color ?? null);
    const dotCss = dot ? `#${String(dot).replace("#", "").slice(0, 6)}` : null;
    return (
      <button onClick={() => setView(toRack ? "rack" : "ams")}
        title={toRack ? "Afficher le rack Vortek" : "Afficher les AMS"}
        style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 10px", borderRadius:20,
          border:`1px solid ${blink ? "rgba(59,130,246,0.6)" : "var(--border)"}`,
          background: blink ? "rgba(59,130,246,0.10)" : "var(--surface2)",
          color: blink ? "#3b82f6" : "var(--muted)", fontSize:11, fontWeight:700, cursor:"pointer",
          whiteSpace:"nowrap", animation: blink ? "toggleBlink 1s ease-in-out infinite" : "none" }}>
        {dotCss && <span style={{ width:10, height:10, borderRadius:"50%", background:dotCss,
          boxShadow:"inset 0 0 0 1px rgba(0,0,0,0.2)" }}/>}
        {label}
        <ArrowLeftRight size={12}/>
      </button>
    );
  })();

  const showOverview = part !== "detail", showDetail = part !== "overview";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {showOverview && <div className="card" style={{ padding:12 }}>
        {hasRack && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:10 }}>
            <span style={{ fontSize:10, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em" }}>
              {showRack ? <>Rack Vortek <span style={{ fontFamily:"monospace", marginLeft:4 }}>{filled}/6</span></> : "AMS"}
            </span>
            {toggle}
          </div>
        )}

        {!showRack && (
          <div style={{ display:"grid", gridTemplateColumns: template,
            gridTemplateRows: `repeat(${nbLignes}, auto)`, columnGap:10, rowGap:10 }}>
            {units}
          </div>
        )}

        {/* Les 6 hotends du rack Vortek, dans leur disposition physique */}
        {showRack && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"4px 0" }}>
            {[[slots[0], slots[2], slots[4]], [slots[1], slots[3], slots[5]]].map((row, i) => (
              <div key={i} style={{ display:"flex", gap:5, justifyContent:"center" }}>
                {row.map(({ slot, num, onHead }) => (
                  <SlotMini key={num} slot={slot} num={num} isOnHead={onHead}
                    headColor={onHead ? headColorValue : null}
                    isSelected={detailKind === "hotend" && hotendNum === num}
                    activeNozzleId={activeNozzleId}
                    onClick={() => setSelHotend(num)}/>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* Détail partagé — AMS (grille de trays) ou hotend rack (fiche), selon la vue */}
      {showDetail && detailKind === "ams" && selectedAms && (
        <AMSDetail ams={selectedAms} activeAmsId={activeAmsId} activeTrayId={activeTrayId}
          spoolLookup={spoolLookup} onTrayClick={setSelectedTray}/>
      )}
      {showDetail && detailKind === "hotend" && selectedHotend?.slot && (
        <SlotDetail slot={selectedHotend.slot} num={selectedHotend.num}
          isOnHead={selectedHotend.onHead}
          headSlot={selectedHotend.onHead ? headSlot : null}/>
      )}
      {selectedTray && <TrayBottomSheet tray={selectedTray.tray} amsId={selectedTray.amsId} amsLabel={selectedTray.amsLabel}
        slotNo={selectedTray.slotNo} onClose={()=>setSelectedTray(null)}/>}
    </div>
  );
}


// ── La tuile imprimante : son en-tete, et sa version en demi-largeur ─────────
const LIVE_ST = ["RUNNING", "PAUSE", "PAUSED", "PREPARE", "SLICING"];
function stateOf(status) {
  const st = String(status?.status || "").toUpperCase();
  if (!status) return { label: "…", color: "#94a3b8" };
  if (!status.connected) return { label: "Injoignable", color: "#ef4444" };
  if (st === "PAUSE" || st === "PAUSED") return { label: "En pause", color: "#f59e0b" };
  if (LIVE_ST.includes(st)) return { label: "En cours", color: "#22c55e" };
  if (st === "FINISH") return { label: "Terminée", color: "#3b82f6" };
  if (st === "FAILED") return { label: "Échouée", color: "#ef4444" };
  return { label: "Au repos", color: "#94a3b8" };
}
// Les pictogrammes des temperatures : la buse, le plateau, la chambre
const IcoNozzle = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
  strokeLinejoin="round" aria-hidden="true"><path d="M5 3h14v6h-3l-2 7h-4L8 9H5z"/><path d="M11 16h2l-1 4z" fill="currentColor"/></svg>;
const IcoBed = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
  strokeLinecap="round" aria-hidden="true"><rect x="3" y="12" width="18" height="5" rx="1"/><path d="M6 20v-3M18 20v-3M8 8c0-2 2-2 2-4M12 8c0-2 2-2 2-4"/></svg>;
const IcoChamber = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
  strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M12 8h5M12 12h5"/></svg>;
// a droite du titre : l'etat (« Injoignable » dit aussi la connexion), et les temperatures en pictogrammes
function PrinterHead({ status, temps = true }) {
  const s = stateOf(status);
  const nz = (status?.nozzles || []).find(n => n.active) || (status?.nozzles || [])[0];
  const hot = (v, t) => v > 40 ? t : "var(--text2)";
  const chip = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 800, padding: "2px 8px",
    borderRadius: 20, whiteSpace: "nowrap", background: "var(--surface2)", color: "var(--text2)", fontVariantNumeric: "tabular-nums" };
  const on = temps && status?.connected;
  return <>
    <span data-pk="" style={{ ...chip, color: s.color, background: `${s.color}1f` }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color }}/>{s.label}</span>
    {on && nz && <span data-pk="" title={`Buse : ${Math.round(nz.temp || 0)}°${nz.target > 0 ? ` (consigne ${Math.round(nz.target)}°)` : ""}`}
      style={{ ...chip, color: hot(nz.temp, "#ea580c") }}><IcoNozzle/>{Math.round(nz.temp || 0)}°</span>}
    {on && <span data-pk="" title={`Plateau : ${Math.round(status.bed_temp || 0)}°${status.target_bed_temp > 0 ? ` (consigne ${Math.round(status.target_bed_temp)}°)` : ""}`}
      style={{ ...chip, color: hot(status.bed_temp, "#dc2626") }}><IcoBed/>{Math.round(status.bed_temp || 0)}°</span>}
    {on && status.chamber_temp > 0 && <span data-pk="" title={`Chambre : ${Math.round(status.chamber_temp)}°`}
      style={{ ...chip, color: hot(status.chamber_temp, "#ca8a04") }}><IcoChamber/>{Math.round(status.chamber_temp)}°</span>}
  </>;
}
// sur une ligne : la vignette (un clic l'ouvre en grand), le nom, puis selon l'etat :
// en cours = pourcentage, temps restant et barre ; en pause = pareil en orange ;
// sinon l'etat seul (terminee, au repos, echouee, injoignable)
function PrinterLine({ status }) {
  const [info, setInfo] = useState(null);
  const [big, setBig] = useState(false);
  const st = String(status?.status || "").toUpperCase();
  const live = LIVE_ST.includes(st);
  const paused = st === "PAUSE" || st === "PAUSED";
  useEffect(() => {
    if (!status?.status) return;
    client.get("/prints", { params: { limit: 1, ...(live ? { status: "IN_PROGRESS" } : {}) } })
      .then(r => { const p = (r.data?.prints || r.data?.items || [])[0]; if (p) setInfo(p); }).catch(() => {});
  }, [status?.status, status?.job_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = stateOf(status);
  const pct = Math.round(status?.progress || 0);
  const img = info ? apiUrl(`/prints/${info.id}/image`) : null;
  return (
    <div className="card" role={img ? "button" : undefined} onClick={img ? () => setBig(true) : undefined}
      style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: "0 12px", display: "flex", alignItems: "center", gap: 10,
        overflow: "hidden", minWidth: 0, cursor: img ? "zoom-in" : "default" }}>
      <span data-pk="" style={{ width: 36, height: 36, borderRadius: 9, overflow: "hidden", flexShrink: 0, background: "var(--surface2)",
        display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
        {img ? <img src={img} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/> : <Printer size={17}/>}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden",
        textOverflow: "ellipsis" }}>{info?.file_name || status?.print_name || info?.translated_name || "Imprimante"}</span>
      {live ? <>
        {status.remaining_minutes > 0 && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700,
          color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}><Clock size={12}/>{fmtTime(status.remaining_minutes)}</span>}
        <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 16, fontWeight: 900, color: s.color, flexShrink: 0,
          fontVariantNumeric: "tabular-nums" }}>{paused && <Pause size={14}/>}{pct}%</span>
        <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: "var(--border)" }}>
          <span data-pk="" style={{ display: "block", height: "100%", width: `${pct}%`, background: s.color, boxShadow: `0 0 8px ${s.color}88`,
            transition: "width 1s" }}/></span>
      </> : <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800, padding: "2px 8px",
        borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0, color: s.color, background: `${s.color}1f` }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color }}/>{s.label}</span>}
      {/* le portail renvoie ses clics a la ligne : on les arrete pour que fermer ne rouvre pas */}
      {big && img && <span onClick={e => e.stopPropagation()}><Lightbox images={[img]} index={0} onClose={() => setBig(false)}/></span>}
    </div>
  );
}
// en demi-largeur : grande (vignette 4/3 au-dessus), moyenne (vignette 16/9), ou compacte (vignette a gauche)
function PrinterCompact({ status, size = "big", showFin = true, showLayer = true }) {
  const [info, setInfo] = useState(null);
  const st = String(status?.status || "").toUpperCase();
  const live = LIVE_ST.includes(st);
  useEffect(() => {
    if (!status?.status) return;
    client.get("/prints", { params: { limit: 1, ...(live ? { status: "IN_PROGRESS" } : {}) } })
      .then(r => { const p = (r.data?.prints || r.data?.items || [])[0]; if (p) setInfo(p); }).catch(() => {});
  }, [status?.status, status?.job_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = stateOf(status);
  const pct = Math.round(status?.progress || 0);
  const fin = live && status?.remaining_minutes ? fmtFinishTime(status.remaining_minutes) : null;
  const small = size === "small";
  const thumb = (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "var(--surface2)", flexShrink: 0,
      ...(small ? { width: 56, height: 56 } : { width: "100%", aspectRatio: size === "mid" ? "16 / 9" : "4 / 3" }) }}>
      {info && <img data-pk="" src={apiUrl(`/prints/${info.id}/image`)} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
        style={{ width: "100%", height: "100%", objectFit: small ? "cover" : "contain", display: "block" }}/>}
      {live && !small && <span data-pk="" style={{ position: "absolute", right: 8, top: 8, fontSize: 17, fontWeight: 900, color: "#fff",
        padding: "2px 9px", borderRadius: 10, background: `${s.color}dd`, boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}>{pct}%</span>}
    </div>
  );
  const facts = live && (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 12, color: "var(--muted)" }}>
      {status.remaining_minutes > 0 && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Clock size={12}/>{fmtTime(status.remaining_minutes)}</span>}
      {showFin && fin && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Calendar size={12}/>{fin.dayDiff ? "demain " : ""}{fin.time}</span>}
      {showLayer && status.total_layers > 0 && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Layers size={12}/>{status.layer}/{status.total_layers}</span>}
    </div>
  );
  const bar = live && (
    <div style={{ height: small ? 7 : 10, borderRadius: 6, background: "var(--border)", overflow: "hidden" }}>
      <div data-pk="" style={{ height: "100%", width: `${pct}%`, borderRadius: 6, background: `linear-gradient(90deg, ${s.color}, ${s.color}cc)`,
        boxShadow: `0 0 8px ${s.color}88`, transition: "width 1s" }}/></div>
  );
  const name = (
    <div style={{ fontSize: small ? 13 : 14, fontWeight: 800, color: "var(--text)", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box",
      WebkitLineClamp: small ? 1 : 2, WebkitBoxOrient: "vertical" }}><Words text={info?.file_name || status?.print_name || s.label}/></div>
  );
  if (small) return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      {thumb}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{name}</div>
          {live && <span data-pk="" style={{ fontSize: 15, fontWeight: 900, color: s.color }}>{pct}%</span>}
        </div>
        {/* une seule ligne : le temps restant, et la fin si elle tient */}
        {live ? <div style={{ display: "flex", gap: 8, fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden" }}>
          {status.remaining_minutes > 0 && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Clock size={11}/>{fmtTime(status.remaining_minutes)}</span>}
          {showFin && fin && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Calendar size={11}/>{fin.time}</span>}
        </div> : <div style={{ fontSize: 12, color: "var(--muted)" }}><Words text={info ? "Dernière impression" : "Prête à imprimer"}/></div>}
        {bar}
      </div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {thumb}
      {name}
      {live ? <>{facts}{bar}</> : <div style={{ fontSize: 12, color: "var(--muted)" }}><Words text={info ? "Dernière impression" : "Prête à imprimer"}/></div>}
    </div>
  );
}

// ── Page Home ──────────────────────────────────────────────────────────────
// Un texte decoupe en mots : chacun peut bouger seul (effets de l'accueil)
function Words({ text }) {
  return String(text ?? "").split(/(\s+)/).map((p, i) => /\s/.test(p) || !p ? p : <span key={i} data-pk="">{p}</span>);
}

// Le bonjour : un bandeau aux couleurs du moment de la journee (matin dore,
// apres-midi bleu, soiree violette, nuit), le nom, et ou en est l'imprimante
// -- avec le vrai nom de l'impression (celui de la carte, pas celui de la tache).
const SKY = [
  { from: 5, a: "#F59E0B", b: "#EC4899", c: "#FDE68A" },     // matin
  { from: 12, a: "#0EA5E9", b: "#6366F1", c: "#BAE6FD" },    // apres-midi
  { from: 18, a: "#7C3AED", b: "#DB2777", c: "#F5D0FE" },    // soiree
  { from: 22, a: "#1E1B4B", b: "#4338CA", c: "#C7D2FE" },    // nuit
];
// les ambiances fixes du bandeau
const MOODS = {
  ocean: { a: "#0EA5E9", b: "#2563EB", c: "#BAE6FD" }, aurora: { a: "#10B981", b: "#6366F1", c: "#A7F3D0" },
  sunset: { a: "#F97316", b: "#DB2777", c: "#FED7AA" }, forest: { a: "#15803D", b: "#0F766E", c: "#BBF7D0" },
  grape: { a: "#7C3AED", b: "#C026D3", c: "#F5D0FE" }, carbon: { a: "#334155", b: "#0F172A", c: "#94A3B8" },
};
// une astuce par jour (la meme toute la journee)
const TIPS = [
  "Un plateau propre, sans traces de doigts, colle bien mieux : un coup d'alcool isopropylique avant d'imprimer.",
  "Le PLA n'aime pas l'humidité : une bobine qui craque en sortant de la buse a besoin d'un séchage.",
  "Pour des pièces solides, augmente le nombre de parois avant le remplissage.",
  "Un Benchy de temps en temps permet de vérifier que tout va bien.",
  "Le PETG colle trop sur le PEI lisse : un peu de colle en bâton sert de démoulant.",
  "Orienter la pièce pour limiter les supports, c'est du temps et du filament gagnés.",
  "Les bobines à moitié vides vont bien dans l'AMS : finis-les avant d'en entamer d'autres.",
  "Une première couche légèrement écrasée, c'est la moitié d'une impression réussie.",
  "Le TPU s'imprime lentement, sans rétraction excessive : patience !",
  "Un « brim » de quelques millimètres évite que les coins se soulèvent sur l'ABS et l'ASA.",
  "Les filaments chargés (fibre de carbone, bois) usent les buses : préfère l'acier trempé.",
  "Photographie tes impressions réussies : ton historique n'en sera que plus beau.",
  "Évaluer les modèles sur MakerWorld rapporte des points… et aide les créateurs.",
  "Une ironing (repassage) sur la dernière couche donne des dessus parfaitement lisses.",
];
function Greeting({ status, o = {} }) {
  const username = useAuth(s => s.username) || "";
  const visiting = useFriend(s => s.friend);         // chez un copain : son accueil, pas de personnalisation
  // le bouton de personnalisation peut se masquer (Reglages > Affichage), choix de cet appareil
  const editBtn = (() => { try { return localStorage.getItem("bn-home-edit-btn") !== "0"; } catch { return true; } })();
  const [name, setName] = useState(null);
  const [x, setX] = useState({});                    // ce que montrent les pastilles en option
  const st = String(status?.status || "").toUpperCase();
  const live = ["RUNNING", "PAUSE", "PAUSED", "PREPARE", "SLICING"].includes(st);
  const opt = (k, d) => o[k] ?? d;
  useEffect(() => {
    if (!live) { setName(null); return; }
    client.get("/prints", { params: { limit: 1, status: "IN_PROGRESS" } })
      .then(r => { const p = (r.data?.prints || r.data?.items || [])[0]; setName(p ? (p.file_name || p.translated_name) : null); })
      .catch(() => {});
  }, [live, status?.job_id]);
  useEffect(() => {
    const put = (k, p) => p.then(r => setX(v => ({ ...v, [k]: r.data }))).catch(() => {});
    if (opt("pToday", true)) put("today", client.get("/prints/kpis", { params: { date_from: new Date().toLocaleDateString("sv") } }));
    if (opt("pNext", false)) put("queue", client.get("/makerworld/queue"));
    if (opt("pFriends", false)) put("friends", client.get("/friends/shared/printing"));
    if (opt("pGrade", false) || opt("pWheel", false)) put("ach", client.get("/achievements"));
  }, [st, o.pToday, o.pNext, o.pFriends, o.pGrade, o.pWheel]); // eslint-disable-line react-hooks/exhaustive-deps
  const h = new Date().getHours();
  const mood = opt("mood", "time");
  const sky = mood !== "time" && MOODS[mood] ? MOODS[mood] : h < 5 ? SKY[3] : [...SKY].reverse().find(v => h >= v.from);
  const night = h >= 18 || h < 5;
  const size = opt("size", "normal");
  const first = username ? username.charAt(0).toUpperCase() + username.slice(1) : "";
  const hello = opt("hello", "auto") === "auto" ? (night ? "Bonsoir" : "Bonjour") : opt("hello", "auto");
  const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const what = name || "L'impression";
  const line = !status ? "" : !status.connected ? "L'imprimante ne répond pas pour l'instant."
    : st === "PAUSE" || st === "PAUSED" ? `${what} est en pause.`
    : live ? `${what} est en cours d'impression.`
    : "L'imprimante est au repos, prête à imprimer.";
  const fin = live && status.remaining_minutes ? fmtFinishTime(status.remaining_minutes) : null;
  const tip = TIPS[Math.floor(Date.now() / 86400000) % TIPS.length];
  const next = (x.queue?.models || []).find(m => m.status === "ready") || (x.queue?.models || [])[0];
  const grade = x.ach ? gradeOf(null, x.ach.score_max ? x.ach.score / x.ach.score_max : 0) : null;
  const nf = (x.friends?.printing || []).length;
  const spins = x.ach?.keys?.wheel?.spins || 0;
  const pill = { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, fontSize: 12.5,
    fontWeight: 700, color: "#fff", background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)",
    backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", whiteSpace: "nowrap" };
  const mini = size === "mini";
  return (
    <div data-hues={[sky.a, sky.b].join(",")} className={`card home-hello${size === "compact" ? " hh-compact" : ""}${mini ? " hh-mini" : ""}`} style={{ position: "relative",
      overflow: "hidden", border: "none", color: "#fff", background: `linear-gradient(120deg, ${sky.a}, ${sky.b})`,
      backgroundSize: opt("anim", false) ? "200% 200%" : undefined, animation: opt("anim", false) ? "hh-drift 14s ease-in-out infinite" : undefined,
      boxShadow: `0 14px 34px -18px ${sky.b}` }}>
      <style>{`
        @keyframes hh-drift { 0%, 100% { background-position: 0% 50% } 50% { background-position: 100% 50% } }
        .home-hello { padding:18px 20px; }
        .hh-title { font-size:26px; } .hh-icon { width:48px; height:48px; } .hh-pills > * { font-size:12.5px; }
        .hh-compact { padding:12px 16px; } .hh-compact .hh-title { font-size:20px; } .hh-compact .hh-icon { width:38px; height:38px; }
        .hh-mini { padding:8px 14px; } .hh-mini .hh-title { font-size:16px; } .hh-mini .hh-icon { width:30px; height:30px; border-radius:10px !important; }
        @media (max-width: 600px) {
          .home-hello { padding:12px 14px; }
          .hh-title { font-size:20px; } .hh-icon { width:38px !important; height:38px !important; border-radius:12px !important; }
          .hh-date { font-size:10.5px !important; } .hh-line { font-size:12.5px !important; margin-top:3px !important; }
          .hh-pills { width:100%; gap:6px !important; } .hh-pills > * { font-size:11.5px; padding:5px 9px !important; }
          .hh-edit { position:absolute; top:-2px; right:-4px; }
        }
      `}</style>
      {/* le decor : un astre et sa lueur, des points tres discrets */}
      {opt("decor", true) && <>
        <span aria-hidden="true" style={{ position: "absolute", right: -40, top: -60, width: 220, height: 220, borderRadius: "50%",
          background: `radial-gradient(circle at 40% 40%, ${sky.c}, transparent 65%)`, opacity: 0.55, pointerEvents: "none" }}/>
        <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.25,
          background: "radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1.5px) 0 0 / 18px 18px",
          WebkitMaskImage: "linear-gradient(90deg, transparent 30%, #000)", maskImage: "linear-gradient(90deg, transparent 30%, #000)" }}/>
      </>}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: mini ? "6px 12px" : "10px 16px", flexWrap: "wrap" }}>
        {opt("icon", true) && <span data-pk="" aria-hidden="true" className="hh-icon" style={{ borderRadius: 16, flexShrink: 0, display: "flex",
          alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.3)" }}>
          {night ? <Moon size={mini ? 17 : 24}/> : <Sun size={mini ? 17 : 24}/>}</span>}
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          {opt("date", true) && !mini && <div className="hh-date" style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".12em",
            textTransform: "uppercase", opacity: 0.85 }}><Words text={date}/></div>}
          <div className="hh-title" style={{ fontWeight: 900, lineHeight: 1.1, marginTop: mini ? 0 : 2, letterSpacing: "-.01em" }}>
            <Words text={`${hello}${opt("name", true) && first ? " " + first : ""}`}/>
            {mini && opt("line", true) && line && <span style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.9, marginLeft: 10 }}><Words text={line}/></span>}</div>
          {!mini && opt("line", true) && line && <div className="hh-line" style={{ fontSize: 13.5, marginTop: 5, opacity: 0.92 }}><Words text={line}/></div>}
          {!mini && opt("message", "") && <div style={{ fontSize: 13, marginTop: 4, fontStyle: "italic", opacity: 0.95 }}>
            <Words text={opt("message", "")}/></div>}
          {!mini && opt("tip", false) && <div style={{ fontSize: 12, marginTop: 6, padding: "6px 10px", borderRadius: 10,
            background: "rgba(255,255,255,0.14)", lineHeight: 1.4 }}>💡 <Words text={tip}/></div>}
        </div>
        <div className="hh-pills" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {opt("pProgress", true) && live && <span data-pk="" style={pill}>
            <span style={{ width: 46, height: 6, borderRadius: 6, background: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${Math.round(status.progress || 0)}%`, background: "#fff" }}/></span>
            {Math.round(status.progress || 0)} %</span>}
          {opt("pFin", true) && fin && <span data-pk="" style={pill}><Clock size={14}/>fin {fin.dayDiff ? "demain " : ""}{fin.time}</span>}
          {opt("pToday", true) && x.today && <span data-pk="" style={pill}><Layers size={14}/>{x.today.count} aujourd'hui</span>}
          {opt("pNext", false) && next && <span data-pk="" style={pill} title="Prochaine impression de « À faire »">⏭️ {next.title_fr || next.title}</span>}
          {opt("pFriends", false) && x.friends && <span data-pk="" style={pill}>👥 {nf ? `${nf} copain${nf > 1 ? "s" : ""} imprime${nf > 1 ? "nt" : ""}` : "copains au repos"}</span>}
          {opt("pGrade", false) && grade?.name && <span data-pk="" style={pill}>🎓 {grade.name}</span>}
          {opt("pWheel", false) && spins > 0 && <span data-pk="" style={pill}>🎰 {spins} tour{spins > 1 ? "s" : ""} de roue</span>}
          {!visiting && editBtn && <button className="hh-edit" onClick={() => window.dispatchEvent(new Event("bn-home-edit"))} aria-label="Personnaliser l'accueil"
            title="Personnaliser l'accueil" style={{ ...pill, cursor: "pointer", padding: "7px 9px" }}><LayoutGrid size={15}/></button>}
        </div>
      </div>
    </div>
  );
}
// les options du bandeau (communes a toutes les dispositions du compte)
const GREETING_OPTIONS = [
  { group: "Allure", key: "mood", label: "Ambiance", hint: "Les couleurs du bandeau : selon le moment de la journée, ou une teinte fixe.", def: "time",
    choices: [["time", "selon l'heure"], ["ocean", "océan"], ["aurora", "aurore"], ["sunset", "couchant"], ["forest", "forêt"], ["grape", "raisin"], ["carbon", "carbone"]] },
  { group: "Allure", key: "size", label: "Taille", hint: "« mini » tient sur une ligne.", def: "normal", choices: [["normal", "normale"], ["compact", "compacte"], ["mini", "mini"]] },
  { group: "Allure", key: "decor", label: "Décor", hint: "La lueur de l'astre et le semis de points.", def: true },
  { group: "Allure", key: "anim", label: "Couleurs qui ondulent", hint: "Le dégradé glisse doucement.", def: false },
  { group: "Allure", key: "icon", label: "Soleil ou lune", def: true },
  { group: "Texte", key: "hello", label: "Salutation", def: "auto",
    choices: [["auto", "Bonjour / Bonsoir"], ["Salut", "Salut"], ["Hello", "Hello"], ["Coucou", "Coucou"], ["Yo", "Yo"]] },
  { group: "Texte", key: "name", label: "Ton prénom", def: true },
  { group: "Texte", key: "date", label: "La date", def: true },
  { group: "Texte", key: "line", label: "Où en est l'imprimante", def: true },
  { group: "Texte", key: "message", label: "Un message à toi", hint: "Une phrase sous le bonjour (laisse vide pour rien).", type: "text",
    placeholder: "Aujourd'hui, on imprime le monde !", def: "", max: 90 },
  { group: "Texte", key: "tip", label: "L'astuce du jour", hint: "Un conseil d'impression, différent chaque jour.", def: false },
  { group: "Pastilles", key: "pProgress", label: "Avancement de l'impression", def: true },
  { group: "Pastilles", key: "pFin", label: "Heure de fin", def: true },
  { group: "Pastilles", key: "pToday", label: "Impressions du jour", def: true },
  { group: "Pastilles", key: "pNext", label: "Prochaine impression de « À faire »", def: false },
  { group: "Pastilles", key: "pFriends", label: "Copains qui impriment", def: false },
  { group: "Pastilles", key: "pGrade", label: "Ton grade de maker", def: false },
  { group: "Pastilles", key: "pWheel", label: "Tours de roue disponibles", def: false },
];

export default function Home() {
  const { status, startPolling, stopPolling } = usePrinter();
  const [spoolLookup, setSpoolLookup] = useState({});
  const isRunning = status?.status === "RUNNING" || status?.status === "PAUSED";
  const [visKey, setVisKey] = useState(0);
  useEffect(() => {
    const fn = () => { if (!document.hidden) setVisKey(k => k+1); };
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);

  const fetchSpoolLookup = useCallback(async () => {
    try {
      const [{ data: spools }, { data: filaments }] = await Promise.all([
        client.get("/filaments/spools", { params: { archived: false } }),
        client.get("/filaments/filaments"),
      ]);
      const filMap = {};
      filaments.forEach(f => { filMap[f.id] = f; });
      const map = {};
      spools.forEach(s => {
        const fil = filMap[s.filament_id] ?? {};
        const info = {
          filament_name: s.filament_translated_name || s.filament_name,  // FR prioritaire
          filament_manufacturer: s.filament_manufacturer,
          filament_material: s.filament_material,
          filament_color: s.filament_color,
          remaining_weight_g: s.remaining_weight_g,
          filament_weight_g: fil.filament_weight_g ?? 1000,
        };
        if (s.tag_number) map[s.tag_number] = info;
      });
      setSpoolLookup(map);
    } catch {}
  }, []);

  useEffect(() => {
    startPolling(3000);
    fetchSpoolLookup();
    const spoolInterval = setInterval(fetchSpoolLookup, 5000);
    return () => { stopPolling(); clearInterval(spoolInterval); };
  }, []);

  const devices = (st, part) => (st?.status === "RUNNING" || st?.status === "PAUSED" || (st?.ams_list?.length > 0)) ? <DeviceGrid
    key={`${visKey}-${part}`} part={part}
    amsList={st?.ams_list ?? []}
    activeAmsId={isRunning ? (st?.active_ams_id ?? -1) : -1}
    activeTrayId={isRunning ? (st?.active_tray_id ?? -1) : -1}
    rack={st?.hotend_rack}
    spoolLookup={spoolLookup}
    activeNozzleId={st?.nozzles?.find(n => n.active)?.id ?? null}/> : null;
  // a demi-hauteur, l'AMS se resume a ses bacs : une pastille par bobine chargee
  const amsSummary = st => {
    const trays = (st?.ams_list || []).filter(a => a.id !== 255 && a.id !== 254).flatMap(a => a.trays || []);
    if (!trays.length) return null;
    return <span style={{ display: "inline-flex", gap: 3 }}>{trays.slice(0, 16).map((t, i) => <span key={i} data-pk="" title={t.empty ? "vide" : t.filament_type || ""}
      style={{ width: 14, height: 14, borderRadius: "50%", border: "1px solid rgba(0,0,0,0.2)",
        background: !t.empty && t.color ? `#${String(t.color).replace("#", "").slice(0, 6)}` : "var(--surface2)" }}/>)}</span>;
  };
  // les blocs de l'accueil, tuiles de la grille comme les autres (l'imprimante ne se masque pas)
  const blocks = {
    printer: { label: "Imprimante", w: [2, 1], h: ["auto", 0.5, 1, 2, 3, 4], h1: [2, 3, 4, 1, 0.5], required: true,
      mini: (d, st) => <PrinterLine status={st}/>,
      summary: (d, st) => ["RUNNING", "PAUSE", "PAUSED"].includes(String(st?.status || "").toUpperCase())
        ? <span data-pk="" style={{ fontSize: 14 }}>{Math.round(st.progress || 0)} %</span> : null,
      frame: { icon: <Printer size={15}/>, color: "#3B82F6",
        extra: (st, item, o) => <PrinterHead status={st} temps={o.headTemps && item.w !== 1}/> },
      render: (d, st, o, item) => item?.w === 1 || item?.h === 1 ? <PrinterCompact status={st} size={item.w !== 1 || item.h <= 1 ? "small" : o.half} showFin={o.fin} showLayer={o.layer}/>
        : <StatusBanner status={st} defaultExpanded={o.open} showCamera={o.cam} showTemps={o.temps}/>,
      options: [
        { when: it => it.w !== 1, key: "headTemps", label: "Températures dans l'en-tête", def: true },
        { when: it => it.w === 1 && it.h > 1, key: "half", label: "Vignette", def: "big", hint: "Sur une rangée, la tuile est toujours compacte.",
          choices: [["big", "grande"], ["mid", "moyenne"], ["small", "compacte"]] },
        { when: it => it.w === 1, key: "fin", label: "Heure de fin", def: true },
        { when: it => it.w === 1, key: "layer", label: "Couches", def: true },
        { when: it => it.w !== 1, key: "open", label: "Volet déplié à l'ouverture", def: false },
        { when: it => it.w !== 1, key: "cam", label: "Caméra dans le volet", def: true },
        { when: it => it.w !== 1, key: "temps", label: "Températures dans le volet", def: true }] },
    ams: { label: "AMS", w: [2], h: ["auto", 0.5, 1, 2, 3, 4], summary: (d, st) => amsSummary(st), frame: { icon: <Disc3 size={15}/>, color: "#8B5CF6" }, render: (d, st) => devices(st, "overview") },
    amsdetail: { label: "Détail de l'AMS", w: [2], h: ["auto", 0.5, 1, 2, 3, 4], summary: (d, st) => amsSummary(st), frame: { icon: <Layers size={15}/>, color: "#6366F1" },
      render: (d, st) => devices(st, "detail") },
    attention: { label: "Points d'attention", w: [2], h: ["auto", 0.5, 1, 2, 3, 4], summary: d => {
        const cats = (d.attention?.categories || []).filter(c => c.total);
        return <span style={{ display: "inline-flex", gap: 6, fontSize: 13 }}>{cats.length ? cats.map(c => <span key={c.category} title={c.label}>
          {c.icon}<b style={{ color: "#b45309" }}>{c.total}</b></span>) : "rien à signaler"}</span>;
      }, frame: { icon: <AlertTriangle size={15}/>, color: "#F59E0B" },
      render: (d, st, o) => <AttentionSection bare startOpen={o.open === "keep" ? null : o.open === "open"}/>,
      options: [{ key: "open", label: "À l'arrivée sur l'accueil", def: "keep",
        choices: [["keep", "comme je l'ai laissée"], ["open", "dépliée"], ["closed", "repliée"]] }] },
  };
  return (
    <div className="home-grid">
      <style>{`
        .home-grid { display:flex; flex-direction:column; gap:12px; max-width:640px; width:100%; margin:0 auto; }
        @media (min-width: 1024px) { .home-grid { max-width:none; } }
      `}</style>
      <HomeGrid status={status} blocks={blocks}
        top={{ label: "Bandeau d'accueil", options: GREETING_OPTIONS, render: o => <Greeting status={status} o={o}/> }}/>
    </div>
  );
}

