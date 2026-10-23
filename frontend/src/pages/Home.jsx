import React, { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
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
import SpoolSVG from "../components/SpoolSVG";
import Lightbox from "../components/Lightbox";
import AmsOrderEditor from "../components/AmsOrderEditor";
import { relayed } from "../components/Friends";
import { AMSBox, AMSDetail, TrayBottomSheet, DryCard, amsRoute } from "../components/AMSSection";
import { Zoom, TempPanel, HeadArt } from "../components/HomeTiles";
import { grilleAccueil, lireDisposition, columnWeight, slotCount, slotLabel, amsName, switchRoutes, trayPct } from "../utils/ams";

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

// « terminee il y a 12 min », « il y a 3 h », « hier », « il y a 4 j »
function agoFr(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!(m >= 0)) return null;
  return m < 60 ? `il y a ${Math.max(1, m)} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : m < 2880 ? "hier" : `il y a ${Math.round(m / 1440)} j`;
}
// l'heure de fin et, le lendemain ou plus tard, le nombre de jours en exposant : 01:34⁺¹
const SUPS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const plusDays = n => n > 0 ? "⁺" + String(n).split("").map(c => SUPS[c]).join("") : "";
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

function SlotMini({ slot, num, isOnHead, isSelected, onClick, headColor, activeNozzleId, swatch = null }) {
  const fill = swatch != null;
  const status = slotStatus(slot, isOnHead);
  const isHead = status === "head";
  const color  = isHead
    ? (headColor ? `#${headColor.slice(0,6)}` : null)
    : (status === "loaded" ? `#${slot?.color?.slice(0,6)}` : null);
  // id=0 = buse droite, id=1 = buse gauche
  const isRightNozzle = activeNozzleId === 0;
  const headBorderStyle = isHead ? (isRightNozzle ? "solid" : "dashed") : "solid";

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap: fill ? 2 : 4, ...(fill ? { width:"100%", minWidth:0 } : {}) }}>
      <button onClick={onClick} style={{ position:"relative", ...(fill ? { width:"100%", padding:6, boxSizing:"border-box" } : {}),
        border: isHead ? `1.5px ${headBorderStyle} rgba(59,130,246,0.6)` : isSelected ? "1.5px solid rgba(255,255,255,0.2)" : status === "empty" ? "1.5px dashed rgba(148,163,184,0.5)" : "1.5px solid var(--border)",
        borderRadius:10, padding:8,
        background: isHead ? "rgba(59,130,246,0.06)" : "var(--surface2)",
        display:"flex", flexDirection:"column", gap:4,
        alignItems:"center", cursor:"pointer", transition:"all 0.2s", minWidth:44,
        boxShadow: isHead ? "0 4px 16px rgba(59,130,246,0.15)" : "none",
      }}>
        {/* Couleur du slot — couleur réelle même sur la tête */}
        <div style={{ width: fill ? `min(100%, ${Math.round(swatch * 1.3)}px)` : 22, height: fill ? swatch : 22, borderRadius: fill ? Math.max(6, Math.round(swatch / 4)) : 6,
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
        <span style={{ fontSize: fill ? 11 : 9, fontWeight:800,
          color: isHead ? "#60a5fa" : "var(--muted)" }}>{num}</span>
      </button>
      {/* Barre de sélection — identique à AMSBox pour cohérence visuelle */}
      {!fill && <div style={{ height:2, borderRadius:1, background: isSelected ? "#3b82f6" : "transparent",
        width: isSelected ? 32 : 8, transition:"all 0.3s" }} />}
    </div>
  );
}

function SlotDetail({ slot, num, isOnHead, headSlot, fitH = null }) {
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
    setFilInfo(null);   // on change d'emplacement : rien de l'ancien ne reste affiche
    if (!fid) return;
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
  // la couleur est celle de l'emplacement ; celle du catalogue seulement si c'est le meme
  // filament a la meme couleur (un repli sur le seul profil donnerait un autre coloris)
  const exact = filInfo && (filInfo.color || "").toLowerCase().slice(0, 6) === rawColor.slice(0, 6).toLowerCase();
  const swatchHexes = exact && filInfo.colors_array
    ? filInfo.colors_array.split(",").map(c => c.trim())
    : cssColor ? [cssColor] : [];
  const multiType = filInfo?.multicolor_type;
  const swatchBg = swatchHexes.length > 1
    ? multiType === "gradient" ? `linear-gradient(135deg, ${swatchHexes.join(",")})`
      : `linear-gradient(90deg, ${swatchHexes.map((c,i,a) => `${c} ${i/a.length*100}%, ${c} ${(i+1)/a.length*100}%`).join(",")})`
    : swatchHexes[0] || "var(--border)";

  // tuile a hauteur choisie : la couleur en grand a gauche, l'essentiel a cote
  if (fitH != null) {
    const sw = Math.max(40, Math.min(110, fitH - 14));
    const filName = filInfo && exact ? (filInfo.translated_name || filInfo.name)
      : filInfo ? (filInfo.fila_type || filInfo.material || fid) : fid || (status === "empty" ? "Pas de hotend" : "Filament non identifié");
    const sub = filInfo ? [filInfo.manufacturer, filInfo.fila_type || filInfo.material].filter(Boolean).join(" · ") : "";
    const chip = (txt, c, bg) => <span style={{ fontSize:10.5, fontWeight:800, padding:"1px 8px", borderRadius:20, color:c, background:bg, whiteSpace:"nowrap" }}>{txt}</span>;
    return (
      <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0, height:"100%" }}>
        <div style={{ width:sw, height:sw, margin:5, borderRadius:Math.round(sw / 4), flexShrink:0, background: status === "empty" ? "rgba(148,163,184,0.12)" : swatchBg,
          border:"1px solid rgba(0,0,0,0.08)", boxShadow: isHead ? "0 0 0 2px var(--surface), 0 0 0 4px #3b82f6" : "none" }}/>
        <div style={{ minWidth:0, flex:1, display:"flex", flexDirection:"column", gap:3 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0, flexWrap:"wrap" }}>
            <span style={{ fontSize:12, fontWeight:900, color: isHead ? "#3b82f6" : "var(--muted)" }}>Slot {num}</span>
            {isHead && chip("Sur la tête", "#3b82f6", "rgba(59,130,246,0.12)")}
            {status === "no_fila" && chip("Sans filament", "#d97706", "rgba(245,158,11,0.12)")}
            {status === "empty" && chip("Vide", "var(--muted)", "var(--border)")}
          </div>
          {status !== "empty" && <div style={{ fontSize:15, fontWeight:900, color:"var(--text)", lineHeight:1.2, overflow:"hidden", display:"-webkit-box",
            WebkitLineClamp: fitH >= 120 ? 2 : 1, WebkitBoxOrient:"vertical" }}>{filName}</div>}
          {(sub || displaySlot.nozzle_type) && <div style={{ fontSize:11.5, color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {[sub, displaySlot.nozzle_type && `${nozzleKind(displaySlot.nozzle_type) || displaySlot.nozzle_type} · ${displaySlot.diameter} mm`].filter(Boolean).join(" · ")}</div>}
          {timeStr && fitH >= 84 && <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11.5, color:"var(--muted)" }}>
            <Clock size={12}/><b style={{ color:"var(--text)" }}>{timeStr}</b> d'utilisation</div>}
        </div>
      </div>
    );
  }

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
            {(nozzleKind(displaySlot.nozzle_type) || nozzleHealth(displaySlot.stat)) && <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:5 }}>
              {nozzleKind(displaySlot.nozzle_type) && <span style={{ fontSize:11, fontWeight:800, color:"var(--text2)", background:"var(--surface)",
                border:"1px solid var(--border)", padding:"1px 8px", borderRadius:20 }}>{nozzleKind(displaySlot.nozzle_type)}</span>}
              {(h => h && <span style={{ fontSize:11, fontWeight:800, color:h[1], background:`${h[1]}1f`, padding:"1px 8px", borderRadius:20 }}>● {h[0]}</span>)(nozzleHealth(displaySlot.stat))}
            </div>}
          </div>
        </div>

        {status !== "empty" && (
          <>
            {/* Filament identifié */}
            <div style={{ padding:"10px 12px", borderRadius:10,
              background:"var(--surface)", border:"1px solid var(--border)" }}>
              {filInfo && exact ? (
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


// ── Ce que dit le rack Vortek (cf. DevNozzleRack / DevNozzleSystem de Bambu Studio) ──
// position du support (holder.pos), ce qu'il fait (holder.stat), sa calibration (holder.info)
const RACK_POS = { 1: "Côté A en haut", 2: "Côté B en haut", 3: "Au centre" };
const RACK_DOING = { 1: "Centrage de la buse", 2: "Centrage de la tête", 3: "Calibration du rack", 4: "Coupe du filament", 5: "Déverrouillage de la buse",
  6: "Levée du rack", 7: "Dépose de la buse", 8: "Prise de la buse", 9: "Verrouillage de la buse" };
// le type d'une buse (« HS01 ») : la 2e lettre dit le debit, les 2 chiffres la matiere
function nozzleKind(type) {
  const t = String(type || "").toUpperCase();
  if (t.length < 4 || t === "N/A") return null;
  const flow = { S: "Débit standard", A: "Débit standard", X: "Débit standard", H: "Haut débit", E: "Haut débit", U: "Haut débit TPU", B: "Haut débit E3D" }[t[1]];
  const mat = { "00": "acier inoxydable", "01": "acier trempé", "05": "carbure de tungstène" }[t.slice(2, 4)];
  return [flow, mat].filter(Boolean).join(" · ") || null;
}
// l'etat d'une buse (stat) : bit 0 = infos pas encore sures ; bits 1-2 : normal, anormal, inconnu
function nozzleHealth(stat) {
  if (stat == null || stat < 0) return null;
  const st = (stat >> 1) & 3;
  if (st === 1) return ["Anomalie signalée", "#ef4444"];
  if (st === 2) return ["État inconnu", "#94a3b8"];
  if (stat & 1) return ["Infos à confirmer", "#f59e0b"];
  return ["En bon état", "#16a34a"];
}
// une ligne d'etat du rack : position, ce qu'il fait en ce moment, calibration, lecture des buses
function RackState({ rack, compact = false }) {
  if (!rack) return null;
  const doing = RACK_DOING[rack.holder_stat];
  const swap = rack.target_id >= 16 && rack.active_id >= 0 && rack.target_id !== rack.active_id;
  const chip = (txt, c, pulse) => <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: compact ? 10.5 : 11.5, fontWeight: 800,
    padding: compact ? "1px 8px" : "3px 10px", borderRadius: 20, color: c, background: `${c === "var(--muted)" ? "#94a3b8" : c}1f`, whiteSpace: "nowrap" }}>
    {pulse && <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, animation: "livePulse 1.4s infinite" }}/>}{txt}</span>;
  const items = [
    doing && chip(swap ? `${doing} · vers la ${rack.target_id - 15}` : doing, "#3b82f6", true),
    rack.reading > 0 && chip(`Lecture des buses · ${rack.reading}`, "#8b5cf6", true),
    RACK_POS[rack.holder_pos] && chip(RACK_POS[rack.holder_pos], "var(--muted)"),
    rack.holder_cali === 0 && chip("Rack à calibrer", "#f59e0b"),
  ].filter(Boolean);
  if (!items.length) return null;
  return <div style={{ display: "flex", gap: 6, flexWrap: compact ? "nowrap" : "wrap", overflow: "hidden", minWidth: 0 }}>{items}</div>;
}

// le rack en une bande : son etat, puis ses six buses (couleur, numero, type), celle sur la tete en bleu
function RackStrip({ rack }) {
  const slots = [1, 2, 3, 4, 5, 6].map(num => ({ num, slot: rack.hotends.find(h => h.id === num + 15), head: rack.head_id === num + 15 }));
  const headSlot = rack.hotends.find(h => h.id === 0) || null;
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <RackState rack={rack}/>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6 }}>
      {slots.map(({ num, slot, head }) => {
        const src = head && headSlot ? headSlot : slot;
        const c = src && !src.empty && src.color ? `#${String(src.color).replace("#", "").slice(0, 6)}` : null;
        const h = nozzleHealth(src?.stat);
        return <div key={num} title={[nozzleKind(src?.nozzle_type), src?.diameter && `${src.diameter} mm`, h?.[0]].filter(Boolean).join(" · ")}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 4px", borderRadius: 12, minWidth: 0,
            background: head ? "rgba(59,130,246,0.10)" : "var(--surface2)", border: `1.5px solid ${head ? "#3b82f6" : "transparent"}` }}>
          <span style={{ width: "70%", aspectRatio: "1", borderRadius: 9, background: c || "repeating-linear-gradient(-45deg, rgba(148,163,184,0.25) 0 2px, transparent 2px 6px)",
            border: c ? "1px solid rgba(0,0,0,0.18)" : "1px dashed rgba(148,163,184,0.6)", position: "relative" }}>
            {h && h[0] !== "En bon état" && <span style={{ position: "absolute", top: -3, right: -3, width: 9, height: 9, borderRadius: "50%", background: h[1],
              boxShadow: "0 0 0 2px var(--surface)" }}/>}</span>
          <span style={{ fontSize: 12, fontWeight: 900, color: head ? "#3b82f6" : "var(--text2)" }}>{num}</span>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
            {head ? "sur la tête" : src?.nozzle_type ? `${src.nozzle_type} · ${src.diameter}` : "vide"}</span>
        </div>;
      })}
    </div>
  </div>;
}
// ── Le rack Vortek en dessin (comme Bambu Studio) : la tete d'outil a gauche, le rack en 3 x 2
// (rang A en haut : 1 3 5, rang B en bas : 2 4 6), les rangs a droite, fleche sur celui qui est leve ──
const FLOW_SHORT = { S: "Standard", A: "Standard", X: "Standard", H: "Haut débit", E: "Haut débit", U: "TPU HF", B: "E3D HF" };
const flowShort = t => FLOW_SHORT[String(t || "").toUpperCase()[1]] || "";
// une buse dessinee : le radiateur a ailettes, le corps (un trait a la couleur du filament), la pointe
function NozzleArt({ color, h = 54, dim = false }) {
  const w = h * 0.5;
  return <svg width={w} height={h} viewBox="0 0 26 52" aria-hidden="true" style={{ opacity: dim ? 0.35 : 1, flexShrink: 0 }}>
    <rect x="2" y="1" width="22" height="13" rx="2.5" fill="#cbd5e1" stroke="#64748b" strokeWidth="1"/>
    {[4.5, 8, 11.5].map(y => <line key={y} x1="4" x2="22" y1={y} y2={y} stroke="#64748b" strokeWidth="1"/>)}
    <rect x="7" y="14" width="12" height="27" rx="2" fill="#e2e8f0" stroke="#64748b" strokeWidth="1"/>
    <rect x="11" y="16" width="4" height="23" rx="2" fill={color || "#94a3b8"} stroke={color ? "rgba(0,0,0,0.25)" : "none"} strokeWidth=".6"/>
    <path d="M9 41 H17 L14.5 50 H11.5 Z" fill="#94a3b8" stroke="#475569" strokeWidth="1" strokeLinejoin="round"/>
  </svg>;
}
function VortekRack({ rack, H = 240, sel = null, onPick }) {
  const box = useRef(null);
  const [W, setW] = useState(400);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = W < 330, tiny = W < 240;   // tres etroit : la tete en bandeau au-dessus du rack
  const slot = num => rack.hotends.find(h => h.id === num + 15) || null;
  const headId = rack.head_id, headNum = headId >= 16 ? headId - 15 : null;
  const head = rack.hotends.find(h => h.id === 0) || (headNum ? slot(headNum) : null);
  const col = x => x && !x.empty && x.color ? `#${String(x.color).replace("#", "").slice(0, 6)}` : null;
  const cellH = Math.max(narrow ? 56 : 70, Math.min(tiny ? 118 : 150, (H - (tiny ? 40 : narrow ? 6 : 30)) / 2)), art = Math.max(22, Math.min(64, cellH - (narrow ? 34 : 50)));
  const fs = narrow ? 10 : cellH >= 110 ? 12.5 : 11;
  const cell = num => {
    const x = slot(num), onHead = headNum === num, has = x && x.nozzle_type && !onHead;
    const hl = nozzleHealth(x?.stat), picked = sel === num;
    return <button key={num} type="button" onClick={e => { if (onPick) { e.stopPropagation(); onPick(num); } }} style={{ position: "relative", minWidth: 0, height: cellH,
      borderRadius: 12, cursor: "pointer", font: "inherit", color: "inherit", padding: "6px 4px", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 3, background: picked ? "rgba(14,165,233,0.12)" : "var(--surface2)",
      border: `1.5px solid ${picked ? "#0ea5e9" : "var(--border)"}` }}>
      <span style={{ position: "absolute", top: narrow ? 3 : 5, left: narrow ? 5 : 8, fontSize: narrow ? 10 : 11, fontWeight: 900, color: "#0ea5e9" }}>{num}</span>
      {hl && hl[0] !== "En bon état" && <span title={hl[0]} style={{ position: "absolute", top: 7, right: 8, width: 8, height: 8, borderRadius: "50%", background: hl[1] }}/>}
      <NozzleArt color={col(x)} h={art} dim={!has}/>
      {has ? <>
        <span style={{ fontSize: fs, fontWeight: 800, color: "var(--text)", lineHeight: 1.1, whiteSpace: "nowrap" }}>{String(x.diameter).replace(".", ",")}{tiny ? "" : " mm"}</span>
        {!narrow && <span style={{ fontSize: fs - 1.5, fontWeight: 700, color: "var(--muted)", lineHeight: 1.1, whiteSpace: "nowrap" }}>{flowShort(x.nozzle_type)}</span>}
      </> : <span style={{ fontSize: fs, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>{onHead ? (narrow ? "tête" : "sur la tête") : "Vide"}</span>}
    </button>;
  };
  const up = { 1: "A", 2: "B" }[rack.holder_pos], centre = rack.holder_pos === 3;
  const rank = r => <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
    color: up === r ? "#0ea5e9" : "var(--muted)" }}>
    <span style={{ width: 22, height: 22, borderRadius: "50%", border: `1.5px solid currentColor`, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 900, background: up === r ? "rgba(14,165,233,0.14)" : "transparent" }}>↑</span>
    <span style={{ fontSize: 11.5, fontWeight: 900, whiteSpace: "nowrap" }}>Rang {r}</span></div>;
  const rackGrid = <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: tiny ? 4 : 6, alignContent: "center" }}>
    {[1, 3, 5, 2, 4, 6].map(cell)}</div>;
  if (tiny) return <div ref={box} style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 10, height: 30, boxSizing: "border-box",
      background: "linear-gradient(90deg, rgba(14,165,233,0.16), transparent), var(--surface2)", border: "1px solid rgba(14,165,233,0.35)", minWidth: 0 }}>
      <svg width="10" height="20" viewBox="0 0 26 52" aria-hidden="true"><rect x="2" y="1" width="22" height="13" rx="2.5" fill="#cbd5e1"/>
        <rect x="7" y="14" width="12" height="27" rx="2" fill="#e2e8f0"/><rect x="11" y="16" width="4" height="23" rx="2" fill={col(head) || "#94a3b8"}/>
        <path d="M9 41 H17 L14.5 50 H11.5 Z" fill="#94a3b8"/></svg>
      <span style={{ fontSize: 11, fontWeight: 900, color: "#0ea5e9", whiteSpace: "nowrap" }}>Tête{headNum ? ` · ${headNum}` : ""}</span>
      {head?.nozzle_type && <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {String(head.diameter).replace(".", ",")} mm</span>}
    </div>
    {rackGrid}</div>;
  return <div ref={box} style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(52px, 0.8fr) minmax(0, 3fr)" : "minmax(78px, 0.9fr) minmax(0, 3fr) 52px",
    gap: narrow ? 5 : 8, minWidth: 0 }}>
    {/* la tete d'outil */}
    <div style={{ borderRadius: 14, padding: "8px 6px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
      background: "linear-gradient(180deg, rgba(14,165,233,0.14), transparent 70%), var(--surface2)", border: "1px solid rgba(14,165,233,0.35)" }}>
      <span style={{ fontSize: narrow ? 9.5 : 11, fontWeight: 900, color: "var(--text2)", textAlign: "center", lineHeight: 1.15 }}>{narrow ? "Tête" : "Tête d'outil"}</span>
      <NozzleArt color={col(head)} h={Math.min(84, art * 1.3)} dim={!head}/>
      {headNum && <span style={{ fontSize: 10.5, fontWeight: 900, color: "#0ea5e9" }}>buse {headNum}</span>}
      {head?.nozzle_type && <><span style={{ fontSize: fs, fontWeight: 800, color: "var(--text)", lineHeight: 1.1, whiteSpace: "nowrap" }}>{String(head.diameter).replace(".", ",")} mm</span>
        {!narrow && <span style={{ fontSize: fs - 1.5, fontWeight: 700, color: "var(--muted)", lineHeight: 1.1 }}>{flowShort(head.nozzle_type)}</span>}</>}
    </div>
    {/* le rack : rang A en haut, rang B en bas */}
    {rackGrid}
    {/* les rangs ; au centre, la maison (etroit : le cote leve est deja dit en tete) */}
    {!narrow && <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {rank("A")}
      <span title={centre ? "Rack au centre" : "Position de repos"} style={{ fontSize: 15, color: centre ? "#16a34a" : "var(--muted)", opacity: centre ? 1 : 0.45 }}>⌂</span>
      {rank("B")}
    </div>}
  </div>;
}
// le bouton qui ramene la tuile AMS a ses AMS (en vue rack)
function HubBack() {
  const setView = useDevSel(s => s.setView);
  return <button type="button" title="Revenir aux AMS" onClick={e => { e.stopPropagation(); setView("ams"); try { localStorage.setItem(VIEW_KEY, "ams"); } catch { /* indisponible */ } }}
    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", height: 22, borderRadius: 20, cursor: "pointer", fontSize: 10.5, fontWeight: 800,
      whiteSpace: "nowrap", border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", flexShrink: 0 }}>AMS<ArrowLeftRight size={11}/></button>;
}
// le rack en grand : son etat, le dessin, et la fiche de la buse choisie (la montee par defaut)
function VortekPanel({ rack, start = null }) {
  const headNum = rack.head_id >= 16 ? rack.head_id - 15 : null, headSlot = rack.hotends.find(h => h.id === 0);
  const [sel, setSel] = useState(start ?? headNum ?? 1);
  const slot = rack.hotends.find(h => h.id === sel + 15);
  return <div onClick={e => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <RackState rack={rack}/>
    <VortekRack rack={rack} H={320} sel={sel} onPick={setSel}/>
    <SlotDetail slot={slot || { id: sel + 15, empty: true }} num={sel} isOnHead={headNum === sel} headSlot={headNum === sel ? headSlot : null}/>
  </div>;
}
// la tuile Vortek : toujours le rack ; un clic l'ouvre en grand (le rack et la fiche de la buse touchee)
function VortekTile({ st, fitH = null, low = false }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
  const has = (st?.hotend_rack?.hotends || []).some(h => !h.empty && h.filament_id);
  if (!has) return <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Pas de rack Vortek</div>;
  const r = st.hotend_rack, headSlot = r.hotends.find(h => h.id === 0);
  const headNum = r.head_id >= 16 ? r.head_id - 15 : null;
  const pick = num => { setSel(num); setOpen(true); };
  // une rangee : l'etat, puis six pastilles (le numero dedans), celle sur la tete cerclee de bleu
  const row = <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, minWidth: 0 }}>
    <RackState rack={r} compact/>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, padding: "0 4px" }}>
      {[1, 2, 3, 4, 5, 6].map(num => { const head = r.head_id === num + 15, src = head && headSlot ? headSlot : r.hotends.find(h => h.id === num + 15);
        const c = src && !src.empty && src.color ? `#${String(src.color).replace("#", "").slice(0, 6)}` : null;
        const light = c && (parseInt(c.slice(1, 3), 16) * 0.299 + parseInt(c.slice(3, 5), 16) * 0.587 + parseInt(c.slice(5, 7), 16) * 0.114) > 170;
        return <span key={num} style={{ height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900,
          color: c ? (light ? "#0f172a" : "#fff") : "var(--muted)", background: c || "repeating-linear-gradient(-45deg, rgba(148,163,184,0.25) 0 2px, transparent 2px 6px)",
          border: c ? "1px solid rgba(0,0,0,0.18)" : "1px dashed rgba(148,163,184,0.6)", outline: head ? "2px solid #3b82f6" : "none", outlineOffset: 1.5 }}>{num}</span>; })}
    </div></div>;
  const H = fitH ?? 260;
  return <div onClick={() => setOpen(true)} style={{ cursor: "pointer", height: "100%", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
    {low ? row : <><RackState rack={r} compact/><VortekRack rack={r} H={H - 28} onPick={pick}/></>}
    {open && <Zoom icon={<Layers size={15}/>} color="#0EA5E9" label="Rack Vortek" onClose={() => { setOpen(false); setSel(null); }}>
      <VortekPanel rack={r} start={sel}/></Zoom>}
  </div>;
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

// ── La tuile « AMS » tout en un ──────────────────────────────────────────────
// Les unites rangees comme ma grille (qui est au-dessus de qui), leurs couleurs, celle qui
// imprime cerclee (l'emplacement actif pulse, et s'anime quand il change), celle qui seche
// teintee d'orange ; une bascule vers le rack Vortek. Un clic sur une unite ouvre la
// fenetre sur elle : la grille en grand pour passer de l'une a l'autre, ses chiffres,
// son sechage, ses bobines ; et le rack.
const HUB_LIVE = ["RUNNING", "PAUSE", "PAUSED", "PREPARE"];
const isDrying = a => !!(a?.is_drying || a?.dry_time > 0);
const dryLeft = m => !m ? "" : m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`;
// un emplacement : sa couleur, ce qui reste (le haut s'assombrit a mesure qu'elle se vide), cercle s'il imprime
// l'anneau de l'emplacement actif pulse ; il ne rebondit (sur place) que quand l'emplacement change pendant
// qu'on regarde : pas a l'arrivee sur la page (bn-pop, qui glisse verticalement, se rejouait a chaque retour)
let hubShownAt = 0;
function HubSwatch({ t, active, h, radius = 6 }) {
  const p = trayPct(t), c = trayHex(t), r = p != null ? p / 100 : null;
  const [pop] = useState(() => active && Date.now() - hubShownAt > 1500);
  return (
    <span title={t?.empty ? "vide" : [t?.filament_type, r != null ? `${Math.round(r * 100)} %` : null].filter(Boolean).join(" · ")}
      style={{ position: "relative", display: "block", height: h, minWidth: 0, borderRadius: radius,
        background: c ? (r != null && h >= 18 ? `linear-gradient(to bottom, rgba(0,0,0,0.30) ${(1 - r) * 100}%, transparent ${(1 - r) * 100}%), ${c}` : c)
          : "repeating-linear-gradient(-45deg, rgba(148,163,184,0.25) 0 2px, transparent 2px 6px)",
        border: c ? "1px solid rgba(0,0,0,0.18)" : "1px dashed rgba(148,163,184,0.6)",
        outline: active ? "2px solid #3b82f6" : "none", outlineOffset: 1.5,
        animation: active ? (pop ? "bn-swap .55s ease-out, bn-ring 2s ease-out .55s infinite" : "bn-ring 2s ease-out infinite") : "none" }}/>
  );
}
// une unite : son nom, ses badges (entree de l'aiguillage, sechage), ses emplacements
function HubUnit({ a, act, actTray, h, climate, onClick, big = false, sel = false, uw = 200, fs = null }) {
  const dry = isDrying(a), trays = a.trays || [];
  const route = a.switch_port ? amsRoute(a, true, fs).txt.replace(" ", "") : null;
  // l'en-tete d'une unite : le nom, puis dans l'ordre ce qui tient — sechage, buse (aiguillage), humidite
  // si le sechage et la buse ne tiennent pas avec le nom entier, le nom se raccourcit (« A »)
  const want = (route ? 30 : 0) + (climate && a.humidity > 0 ? 38 : 0);
  const short = !big && uw - 14 - (amsName(a.id).length * 7 + (act ? 10 : 0)) < want && a.id < 128;
  const label = short ? amsName(a.id).replace("AMS-", "") : amsName(a.id);
  let room = uw - 14 - (label.length * 7 + (act ? 10 : 0));
  const fits = w => (room -= w + 4) >= 0;
  const showHum = climate && a.humidity > 0 && fits(34), showRoute = !!route && fits(26);
  const compact = h < 38 && !big;
  const ring = sel ? "#8b5cf6" : act ? "#3b82f6" : dry ? "rgba(249,115,22,0.6)" : "var(--border)";
  const chip = (txt, c, bg) => <span style={{ fontSize: 9, fontWeight: 900, lineHeight: "13px", padding: "0 5px", borderRadius: 6, color: c, background: bg, whiteSpace: "nowrap" }}>{txt}</span>;
  const box = { position: "relative", width: "100%", height: h, boxSizing: "border-box", minWidth: 0, overflow: "hidden", cursor: onClick ? "pointer" : "default", textAlign: "left",
    borderRadius: compact ? 9 : 12, border: `1.5px solid ${ring}`, color: "inherit", font: "inherit",
    background: dry ? "linear-gradient(135deg, rgba(249,115,22,0.16), transparent 65%), var(--surface2)" : act ? "linear-gradient(135deg, rgba(59,130,246,0.10), transparent 65%), var(--surface2)" : "var(--surface2)",
    boxShadow: act ? "0 0 0 3px rgba(59,130,246,0.14), 0 6px 18px rgba(59,130,246,0.12)" : sel ? "0 0 0 3px rgba(139,92,246,0.18)" : "none", transition: "all .3s" };
  const click = onClick ? e => { e.stopPropagation(); onClick(a.id); } : undefined;
  // tres bas (une rangee) : le nom, puis les emplacements en pastilles sur la meme ligne
  if (compact) return (
    <button type="button" onClick={click} style={{ ...box, display: "flex", alignItems: "center", gap: 5, padding: "0 6px" }}>
      <span style={{ fontSize: 9.5, fontWeight: 900, color: act ? "#3b82f6" : "var(--text2)", whiteSpace: "nowrap", flexShrink: 0 }}>{amsName(a.id).replace("AMS-", "")}</span>
      <span style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: `repeat(${trays.length || 1}, minmax(0, 1fr))`, gap: 2 }}>
        {trays.map(t => <HubSwatch key={`${t.id}${act && t.id === actTray ? "a" : ""}`} t={t} active={act && t.id === actTray} h={Math.max(8, h - 10)} radius={3}/>)}</span>
      {dry && <span title={`Séchage · ${dryLeft(a.dry_time)}`} style={{ width: 6, height: 6, borderRadius: "50%", background: "#f97316", flexShrink: 0,
        animation: "dryPulse 2.5s ease-in-out infinite" }}/>}
    </button>
  );
  const head = big ? 20 : 15;
  const tab = !big && dry && <span title={`Séchage${a.dry_filament ? ` ${a.dry_filament}` : ""}`} style={{ position: "absolute", top: -6, left: "50%", transform: "translateX(-50%)", zIndex: 2,
    padding: "0 7px", height: 13, lineHeight: "13px", borderRadius: 7, fontSize: 9, fontWeight: 900, color: "#fff", background: "#f97316",
    whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(249,115,22,0.35)" }}>🔥 {a.dry_filament ? `${a.dry_filament} · ` : ""}{dryLeft(a.dry_time)}</span>;
  let broom = uw - 22;
  const bfit = w => (broom -= w + 4) >= 0;
  const dryFull = `🔥 ${a.dry_temperature > 0 ? `${a.dry_temperature}° · ` : ""}${dryLeft(a.dry_time)}`, dryShort = `🔥 ${dryLeft(a.dry_time)}`;
  const dryTxt = dry ? (bfit(dryFull.length * 5.4 + 8) ? dryFull : (broom = uw - 18, bfit(dryShort.length * 5.4 + 6) ? dryShort : "🔥")) : null;
  // la buse et l'humidite apres le sechage ; ce qui ne tient pas passe sur une deuxieme ligne
  const hasHum = climate && a.humidity > 0;
  const bRoute = route && bfit(30), bHum = hasHum && bfit(40);
  const line2 = (route && !bRoute) || (hasHum && !bHum);
  const routeChip = route && chip(route, "#8b5cf6", "rgba(139,92,246,0.14)");
  const humChip = hasHum && chip(`💧${a.humidity}%`, a.humidity >= 40 ? "#ef4444" : a.humidity >= 30 ? "#d97706" : "#0ea5e9", "rgba(14,165,233,0.12)");
  const badges = big && <span style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 }}>
    <span style={{ display: "flex", gap: 4, height: 14, overflow: "hidden" }}>{dryTxt && chip(dryTxt, "#fff", "#f97316")}{bRoute && routeChip}{bHum && humChip}</span>
    {line2 && <span style={{ display: "flex", gap: 4, height: 14, overflow: "hidden" }}>{!bHum && humChip}
      {!bRoute && (uw - 22 - (!bHum && hasHum ? 44 : 0)) >= 30 && routeChip}</span>}</span>;
  // sous chaque pastille, ce qui reste : sans « % » quand la colonne est trop etroite pour lui
  const cellW = (uw - (big ? 20 : 12) - (big ? 6 : 3) * Math.max(0, trays.length - 1)) / Math.max(1, trays.length);
  const pctFs = Math.max(8.5, Math.min(big ? 11.5 : 9.5, cellW / 3.1)), pctSign = cellW >= 30;
  return (
    <div style={{ position: "relative", height: h, minWidth: 0 }}>{tab}
    <button type="button" onClick={click} style={{ ...box, display: "flex", flexDirection: "column", gap: big ? 6 : 3, padding: big ? "8px 10px 10px" : "4px 6px 6px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 4, height: head, minWidth: 0, overflow: "hidden", flexShrink: 0 }}>
        <span style={{ fontSize: big ? 13.5 : 10.5, fontWeight: 900, color: act ? "#3b82f6" : sel ? "#8b5cf6" : "var(--text2)", whiteSpace: "nowrap" }}>{label}</span>
        {act && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3b82f6", animation: "livePulse 2s infinite", flexShrink: 0 }}/>}
        {!big && showRoute && chip(route, "#8b5cf6", "rgba(139,92,246,0.14)")}
        <span style={{ flex: 1 }}/>
        {!big && showHum && <span style={{ fontSize: big ? 11.5 : 9.5, fontWeight: 800, color: a.humidity >= 40 ? "#ef4444" : a.humidity >= 30 ? "#f59e0b" : "var(--muted)",
          whiteSpace: "nowrap" }}>💧{a.humidity}%</span>}
      </span>
      {badges}
      <span style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
        <span style={{ height: Math.max(10, Math.min(big ? 56 : h >= 120 ? 46 : 32, h - head - (big ? (line2 ? 39 : 22) : 0) - (h >= 62 ? 26 : 12))), display: "grid",
          gridTemplateColumns: `repeat(${trays.length || 1}, minmax(0, 1fr))`, gap: big ? 6 : 3 }}>
          {trays.map(t => <HubSwatch key={`${t.id}${act && t.id === actTray ? "a" : ""}`} t={t} active={act && t.id === actTray} h="100%" radius={big ? 9 : 6}/>)}</span>
        {h >= 62 && <span style={{ display: "grid", gridTemplateColumns: `repeat(${trays.length || 1}, minmax(0, 1fr))`, gap: big ? 6 : 3 }}>
          {trays.map(t => <span key={t.id} style={{ fontSize: pctFs, fontWeight: 800, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden",
            color: act && t.id === actTray ? "#3b82f6" : "var(--muted)" }}>{trayHex(t) ? (trayPct(t) != null ? `${trayPct(t)}${pctSign ? "%" : ""}` : t.filament_type || "") : "—"}</span>)}</span>}
      </span>
    </button></div>
  );
}
// la grille des unites, comme ma disposition ; h : la hauteur dont elle dispose
function HubGrid({ list, order, act, actTray, H, climate, onPick, big = false, sel = null, fs = null }) {
  const ref = useRef(null);
  const [GW, setGW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setGW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = grilleAccueil(list, lireDisposition(order));
  const nR = cols[0]?.length || 1;
  const gap = big ? 10 : 6;
  const uh = Math.max(20, Math.floor((H - gap * (nR - 1)) / nR));
  return (
    <div ref={ref} style={{ display: "grid", gridTemplateColumns: cols.map(c => `${columnWeight(c)}fr`).join(" "), gridTemplateRows: `repeat(${nR}, ${uh}px)`, gap }}>
      {cols.flatMap((col, ci) => col.map((a, ri) => a && (
        <div key={a.id} style={{ gridColumn: ci + 1, gridRow: ri + 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
          <div style={{ width: `${Math.max(0.78, slotCount(a) / columnWeight(col)) * 100}%`, minWidth: 0 }}>
            <HubUnit a={a} act={a.id === act} actTray={actTray} h={uh} climate={climate} onClick={onPick} big={big} sel={sel === a.id} fs={fs}
              uw={GW ? (GW - gap * (cols.length - 1)) * columnWeight(col) / cols.reduce((t, c) => t + columnWeight(c), 0) * Math.max(0.78, slotCount(a) / columnWeight(col)) : 200}/></div>
        </div>
      ))).filter(Boolean)}
    </div>
  );
}
function AmsHub({ st, spoolLookup, fitH, o, rackTile, rackFull }) {
  const list = [...new Map((st?.ams_list || []).map(a => [a.id, a])).values()];
  const [order, setOrder] = useState(null);
  const [open, setOpen] = useState(null);          // l'unite ouverte dans la fenetre
  const [tab, setTab] = useState("ams");
  const [tray, setTray] = useState(null);
  const view = useDevSel(s => s.view), setView = useDevSel(s => s.setView);
  const before = useRef(null);   // la vue de la tuile a l'ouverture de la fenetre, rendue a la fermeture
  useState(() => { hubShownAt = Date.now(); return 0; });
  // la mesure s'accroche quand la tuile apparait vraiment : au chargement (F5), l'etat de
  // l'imprimante n'est pas encore la et la tuile ne montre d'abord rien ; un effet lance au
  // montage ne voyait alors aucun element, ne mesurait jamais, et la hauteur estimee debordait
  const [mh, setMh] = useState(0);
  const ro = useRef(null);
  const root = useCallback(el => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    ro.current = new ResizeObserver(([e]) => setMh(Math.floor(e.contentRect.height)));
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  useEffect(() => {
    const load = () => client.get("/settings/ams-order").then(({ data }) => setOrder(data.order ?? null)).catch(() => setOrder(null));
    load();
    window.addEventListener("bn-ams-order", load);
    return () => window.removeEventListener("bn-ams-order", load);
  }, []);
  const run = HUB_LIVE.includes(String(st?.status || "").toUpperCase());
  const act = run ? st?.active_ams_id ?? -1 : -1, actTray = run ? st?.active_tray_id ?? -1 : -1;
  const actAms = list.find(a => a.id === act), actT = actAms?.trays?.find(t => t.id === actTray);
  const rack = st?.hotend_rack;
  const hasRack = (rack?.hotends ?? []).some(h => !h.empty && h.filament_id);
  const headNum = rack?.head_id >= 16 && rack.head_id <= 21 ? rack.head_id - 15 : null;
  const climate = o?.climate !== false;
  const routes = switchRoutes(st);
  const go = v => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* indisponible */ } };
  if (!list.length && !hasRack) return <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Aucun AMS détecté</div>;
  const H = mh || fitH || 230;
  const low = H < 96;                               // une rangee : ni en-tete ni bascule
  const pill = (on, label, dot, onClick) => <button type="button" onClick={e => { e.stopPropagation(); onClick(); }} style={{ display: "inline-flex", alignItems: "center", gap: 5,
    padding: "2px 9px", height: 22, borderRadius: 20, cursor: "pointer", fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap",
    border: `1px solid ${on ? "rgba(59,130,246,0.5)" : "var(--border)"}`, background: on ? "rgba(59,130,246,0.1)" : "var(--surface2)", color: on ? "#3b82f6" : "var(--muted)" }}>
    {dot && <span style={{ width: 9, height: 9, borderRadius: "50%", background: dot, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)" }}/>}{label}<ArrowLeftRight size={11}/></button>;
  const dryN = list.filter(isDrying).length;
  const head = !low && (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 26, minWidth: 0, flexShrink: 0 }}>
      <span style={{ flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden" }}>
        {actT ? <><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", animation: "livePulse 2s infinite" }}/>
          <span style={{ color: "#3b82f6" }}>{slotLabel(act, actTray)}</span>
          <span style={{ width: 11, height: 11, borderRadius: 4, background: trayHex(actT) || "var(--border)", border: "1px solid rgba(0,0,0,0.2)" }}/>
          <span style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.15, overflow: "hidden" }}>
            <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis" }}>{actT.spool_info?.translated_name || actT.spool_info?.name || actT.filament_type}</span>
            {(actT.spool_info?.fila_type || actT.spool_info?.material || actT.spool_info?.brand) && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)",
              overflow: "hidden", textOverflow: "ellipsis" }}>{[actT.spool_info?.fila_type || actT.spool_info?.material || actT.filament_type, actT.spool_info?.brand].filter(Boolean).join(" · ")}</span>}
          </span></>
          : <span style={{ color: "var(--muted)" }}>{list.filter(a => a.id !== 255).length} unités · {list.flatMap(a => a.trays || []).filter(t => trayHex(t)).length} bobines</span>}
        {dryN > 0 && <span style={{ color: "#ea580c" }}>· {dryN} sèche{dryN > 1 ? "nt" : ""}</span>}
      </span>
      {hasRack && pill(false, view === "rack" ? "AMS" : headNum ? `Rack · buse ${headNum}` : "Rack", null, () => go(view === "rack" ? "ams" : "rack"))}
    </div>
  );
  // la fenetre : l'unite choisie, ou l'active, ou la premiere
  const selId = open === "all" ? (act >= 0 ? act : list[0]?.id) : open;
  const sel = list.find(a => a.id === selId) || list[0];
  const popup = open != null && <Zoom icon={<Disc3 size={15}/>} color="#8B5CF6" label="Mes AMS" to="/filaments" onClose={() => { setOpen(null); setTab("ams"); if (before.current) { go(before.current); before.current = null; } }}>
    {({ W }) => <>
      {hasRack && <div style={{ display: "flex", gap: 6 }}>
        {[["ams", "AMS"], ["rack", headNum ? `Rack Vortek · buse ${headNum}` : "Rack Vortek"]].map(([k, l]) => <button key={k} type="button"
          onClick={() => { if (!before.current) before.current = view; setTab(k); go(k === "rack" ? "rack" : "ams"); }} style={{ padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 800,
            fontSize: 12.5, background: tab === k ? "#8B5CF6" : "var(--surface2)", color: tab === k ? "#fff" : "var(--text2)" }}>{l}</button>)}</div>}
      {tab === "rack" ? rackFull : <>
        {/* la grille en grand : on y choisit l'unite */}
        <HubGrid list={list} order={order} act={act} actTray={actTray} H={Math.min(300, (cols => (cols[0]?.length || 1) * 128)(grilleAccueil(list, lireDisposition(order))))}
          climate big sel={sel?.id} fs={routes} onPick={id => setOpen(id)}/>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${W >= 520 ? 4 : 2}, minmax(0, 1fr))`, gap: 8 }}>
          {[["Bobines chargées", list.flatMap(a => a.trays || []).filter(t => trayHex(t)).length],
            ["En cours", actT ? slotLabel(act, actTray) : "—", "#3b82f6"],
            ["Humidité moyenne", (() => { const h = list.filter(a => a.humidity > 0); return h.length ? `${Math.round(h.reduce((t, a) => t + a.humidity, 0) / h.length)} %` : "—"; })()],
            ["En séchage", dryN || "aucun", dryN ? "#ea580c" : undefined, dryN ? list.filter(isDrying).map(a => amsName(a.id)).join(" · ") : null]].map(([l, v, c, d]) =>
            <div key={l} className="card-sm" style={{ padding: "9px 11px", minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{l}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: c || "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
              {d && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", lineHeight: 1.3 }}>{d}</div>}</div>)}
        </div>
        {sel && <div style={{ borderRadius: 20, padding: 14, display: "flex", flexDirection: "column", gap: 12,
          background: `linear-gradient(135deg, ${isDrying(sel) ? "rgba(249,115,22,0.12)" : sel.id === act ? "rgba(59,130,246,0.10)" : "rgba(139,92,246,0.08)"}, transparent 60%), var(--surface2)` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: "var(--text)" }}>{amsName(sel.id)}</span>
            {sel.id === act && <span style={{ fontSize: 12, fontWeight: 800, color: "#3b82f6" }}>● imprime{actT ? ` · ${slotLabel(act, actTray)}` : ""}</span>}
            {sel.switch_port && <span style={{ fontSize: 12, fontWeight: 800, color: "#8b5cf6" }}>⇄ entrée {sel.switch_port} de l'aiguillage
              {(o => o == null ? "" : ` → buse ${o === 1 ? "gauche" : "droite"}`)(routes?.[`out_${sel.switch_port.toLowerCase()}`])}</span>}
            <span style={{ flex: 1 }}/>
            {sel.humidity > 0 && <span style={{ fontSize: 13, fontWeight: 800, color: "#0ea5e9" }}>💧 {sel.humidity} %</span>}
            {sel.temp > 0 && <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text2)" }}>🌡 {Number(sel.temp).toFixed(1).replace(".", ",")} °C</span>}
          </div>
          {isDrying(sel) && <DryCard ams={sel}/>}
          <AMSDetail ams={sel} activeAmsId={act} activeTrayId={actTray} spoolLookup={spoolLookup} onTrayClick={setTray} hideName showNames bare/>
        </div>}
      </>}
      {tray && createPortal(<div onClick={e => e.stopPropagation()}><TrayBottomSheet tray={tray.tray} amsId={tray.amsId} amsLabel={tray.amsLabel} slotNo={tray.slotNo}
        onClose={() => setTray(null)}/></div>, document.body)}
    </>}
  </Zoom>;
  return (
    <div ref={root} onClick={() => setOpen("all")} style={{ display: "flex", flexDirection: "column", gap: 6, cursor: "pointer", minWidth: 0, overflow: "hidden",
      // hauteur imposee : la tuile s'ancre aux bords du cadre (un height 100 % n'y prend pas, et elle
      // gardait alors la hauteur estimee, un peu trop grande : le bas etait rogne)
      ...(fitH != null ? { position: "absolute", inset: 0 } : {}) }}>
      {!(view === "rack" && hasRack && !low) && head}
      {view === "rack" && hasRack && !low ? <div onClick={e => {
          e.stopPropagation();
          // une case du rack (la buse est deja choisie par son propre clic) : la fenetre sur l'onglet rack ;
          // la bascule vers les AMS garde son role
          const btn = e.target.closest("button");
          if (btn && !btn.title) { setTab("rack"); setOpen("all"); }
        }} style={{ flex: 1, minHeight: 0 }}>{rackTile}</div>
        : <HubGrid list={list} order={order} act={act} actTray={actTray} H={H - (low ? 0 : 32)} climate={climate} fs={routes} onPick={id => setOpen(id)}/>}
      {popup}
    </div>
  );
}

// part : "overview" (les AMS ou le rack), "detail" (la fiche de l'AMS ou de la buse
// choisie), ou rien (les deux, l'un sous l'autre)
export function DeviceGrid({ amsList, activeAmsId, activeTrayId, rack, spoolLookup, activeNozzleId, part = null,
  org = "grid", climate = true, selector = true, names = true, fitH = null, dual = false, fs = null, forceView = null }) {
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
  const showRack = hasRack && (forceView ? forceView === "rack" : view === "rack");

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

  // la disposition se relit quand on l'enregistre depuis les reglages de la tuile
  useEffect(() => {
    const load = () => client.get("/settings/ams-order").then(({ data }) => setAmsOrder(data.order ?? null))
      .catch(() => setAmsOrder(null));
    load();
    window.addEventListener("bn-ams-order", load);
    return () => window.removeEventListener("bn-ams-order", load);
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
  // hauteur imposee : chaque rangee d'unites a sa part, les pastilles s'y ajustent
  const dense = fitH != null;
  const nRows = org === "auto" ? Math.max(1, Math.ceil(uniqueAmsList.length / 2)) : nbLignes;
  const rowH = dense ? (fitH - (hasRack ? 30 : 0) - 8 - 6 * (nRows - 1)) / nRows : null;
  const pillH = dense ? Math.max(14, Math.min(46, Math.round(rowH - 14 - (climate ? 13 : 0) - 14))) : null;
  const units = cols.flatMap((col, ci) => col.map((ams, ri) => ams && (
    <div key={ams.id} style={{ gridColumn: ci + 1, gridRow: ri + 1, minWidth:0 }}>
      <AMSBox ams={ams} activeAmsId={activeAmsId} activeTrayId={activeTrayId}
        isSelected={detailKind === "ams" && selectedAms?.id === ams.id}
        onClick={() => setSelAms(ams.id)}
        spoolLookup={spoolLookup} climate={climate} pillH={pillH} dual={dual} fs={fs}
        slotsWidth={`${(slotCount(ams) / columnWeight(col)) * 100}%`}/>
    </div>
  ))).filter(Boolean);
  // « selon la place » : les unites a la suite, chacune aussi large que ses emplacements,
  // et la rangee passe a la ligne quand la tuile est etroite
  const flow = uniqueAmsList.map(ams => (
    <div key={ams.id} style={{ flex: `${slotCount(ams)} 1 ${slotCount(ams) * 26 + 14}px`, minWidth: 0 }}>
      <AMSBox ams={ams} activeAmsId={activeAmsId} activeTrayId={activeTrayId}
        isSelected={detailKind === "ams" && selectedAms?.id === ams.id}
        onClick={() => setSelAms(ams.id)} spoolLookup={spoolLookup} climate={climate} pillH={pillH} dual={dual} fs={fs}/>
    </div>
  ));
  // le detail porte son propre choix d'unite : des onglets avec les couleurs de chaque unite
  const tabs = selector && uniqueAmsList.length > 1 && (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, scrollbarWidth: "none" }}>
      {uniqueAmsList.map(a => {
        const on = selectedAms?.id === a.id, act = a.id === activeAmsId;
        return (
          <button key={a.id} onClick={e => { e.stopPropagation(); setSelAms(a.id); }} style={{ display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 9px", borderRadius: 20, cursor: "pointer", flexShrink: 0, fontSize: 11.5, fontWeight: 800,
            border: `1px solid ${on ? "#3b82f6" : "var(--border)"}`, background: on ? "rgba(59,130,246,0.12)" : "var(--surface2)",
            color: on ? "#3b82f6" : "var(--text2)" }}>
            {amsName(a.id)}
            <span style={{ display: "inline-flex", gap: 2 }}>{(a.trays || []).map(t => <span key={t.id} style={{ width: 7, height: 7, borderRadius: 2,
              background: trayHex(t) || "var(--border)" }}/>)}</span>
            {act && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3b82f6", animation: "livePulse 2s infinite" }}/>}
          </button>
        );
      })}
    </div>
  );

  // Bouton de bascule : il annonce l'essentiel de la vue CACHEE, pour qu'on
  // n'ait pas a basculer juste pour savoir. Vue AMS → buse montee sur la tete
  // et sa couleur ; vue rack → emplacement AMS actif et sa couleur.
  const toggle = hasRack && !forceView && (() => {
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
      {showOverview && <div className="card" style={{ padding: dense ? "2px 4px" : 12 }}>
        {hasRack && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom: dense ? 6 : 10 }}>
            <span style={{ fontSize:10, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em" }}>
              {showRack ? <>Rack Vortek <span style={{ fontFamily:"monospace", marginLeft:4 }}>{filled}/6</span></> : "AMS"}
            </span>
            {showRack && dense && <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-end" }}><RackState rack={rack} compact/></div>}
            {toggle}
          </div>
        )}
        {showRack && !dense && <div style={{ marginBottom: 10 }}><RackState rack={rack}/></div>}

        {!showRack && (org === "auto"
          ? <div style={{ display:"flex", flexWrap:"wrap", gap: dense ? 6 : 10 }}>{flow}</div>
          : <div style={{ display:"grid", gridTemplateColumns: template,
            gridTemplateRows: `repeat(${nbLignes}, auto)`, columnGap:10, rowGap: dense ? 6 : 10 }}>
            {units}
          </div>
        )}

        {/* Les 6 hotends du rack Vortek, dans leur disposition physique */}
        {showRack && dense && (() => {
          const room = fitH - 30 - 4;
          const one = room < 130;
          const rowsN = one ? 1 : 2;
          const swatch = Math.max(18, Math.min(72, Math.floor((room - (rowsN - 1) * 8) / rowsN) - 32));
          const order = one ? slots : [slots[0], slots[2], slots[4], slots[1], slots[3], slots[5]];
          return (
            <div style={{ display:"grid", gridTemplateColumns:`repeat(${one ? 6 : 3}, minmax(0, 1fr))`, gap:8 }}>
              {order.map(({ slot, num, onHead }) => (
                <SlotMini key={num} slot={slot} num={num} isOnHead={onHead} swatch={swatch}
                  headColor={onHead ? headColorValue : null}
                  isSelected={detailKind === "hotend" && hotendNum === num}
                  activeNozzleId={activeNozzleId}
                  onClick={() => setSelHotend(num)}/>
              ))}
            </div>
          );
        })()}
        {showRack && !dense && (
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
      {showDetail && detailKind === "ams" && selectedAms && part === "detail" && (!dense || fitH >= 150) && tabs}
      {showDetail && detailKind === "ams" && selectedAms && (
        <AMSDetail ams={selectedAms} activeAmsId={activeAmsId} activeTrayId={activeTrayId}
          spoolLookup={spoolLookup} onTrayClick={setSelectedTray} hideName={part === "detail" && !!tabs} showNames={names}
          fitH={dense && part === "detail" ? fitH - (fitH >= 150 && tabs ? 40 : 0) : null}/>
      )}
      {showDetail && detailKind === "hotend" && selectedHotend?.slot && (
        <SlotDetail slot={selectedHotend.slot} num={selectedHotend.num}
          isOnHead={selectedHotend.onHead}
          headSlot={selectedHotend.onHead ? headSlot : null} fitH={dense && part === "detail" ? fitH : null}/>
      )}
      {/* la fiche d'une bobine : par-dessus la page (portail), pas dans la tuile qui la couperait */}
      {selectedTray && createPortal(<div onClick={e => e.stopPropagation()}><TrayBottomSheet tray={selectedTray.tray} amsId={selectedTray.amsId}
        amsLabel={selectedTray.amsLabel} slotNo={selectedTray.slotNo} onClose={()=>setSelectedTray(null)}/></div>, document.body)}
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
    {s.label !== "En cours" && <span data-pk="" style={{ ...chip, color: s.color, background: `${s.color}1f` }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color }}/>{s.label}</span>}
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
  const [pop, setPop] = useState(false);
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
    <div className="card" role="button" onClick={() => setPop(true)}
      style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: "0 12px", display: "flex", alignItems: "center", gap: 10,
        overflow: "hidden", minWidth: 0, cursor: "pointer" }}>
      <span data-pk="" onClick={img ? e => { e.stopPropagation(); setBig(true); } : undefined} style={{ cursor: img ? "zoom-in" : undefined, width: 36, height: 36, borderRadius: 9, overflow: "hidden", flexShrink: 0, background: "var(--surface2)",
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
      {pop && <PrinterPopup status={status} img={img} name={info?.file_name || status?.print_name} onClose={() => setPop(false)}/>}
    </div>
  );
}
// ── Le statut complet de l'imprimante (popup) ───────────────────────────────
// Ouverte d'un clic sur la tuile (la vignette, elle, s'ouvre en grand) : la
// vignette et le nom, l'avancement en anneau, le temps restant et la fin, les
// couches, chaque buse (l'active marquee), le plateau, la chambre, le filament
// en cours, la vitesse, les alertes de la machine.
const SPEEDS = { 1: ["Silencieux", "#22c55e"], 2: ["Standard", "#3b82f6"], 3: ["Sport", "#f59e0b"], 4: ["Ludicrous", "#ef4444"] };
function ArcGauge({ value, target, max, color, label, active }) {
  const S = 120, sw = 10, r = S / 2 - sw / 2 - 2, C = Math.PI * r;
  const v = Math.max(0, Math.min(1, (value || 0) / (target > 0 ? target : max)));
  const hot = (value || 0) > 40;
  const c = hot ? color : "#94a3b8";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 6px 8px", borderRadius: 16, minWidth: 0, position: "relative",
      background: active ? `linear-gradient(160deg, ${color}26, transparent 70%), var(--surface2)` : "var(--surface2)",
      border: `1px solid ${active ? `${color}88` : "transparent"}`, boxShadow: active ? `0 6px 18px ${color}33` : "none" }}>
      <svg width={S} height={S / 2 + sw / 2 + 2} viewBox={`0 0 ${S} ${S / 2 + sw / 2 + 2}`} aria-hidden="true" style={{ overflow: "visible" }}>
        <path d={`M${sw / 2 + 2} ${S / 2} A${r} ${r} 0 0 1 ${S - sw / 2 - 2} ${S / 2}`} fill="none" stroke="var(--border)" strokeWidth={sw} strokeLinecap="round"/>
        <path d={`M${sw / 2 + 2} ${S / 2} A${r} ${r} 0 0 1 ${S - sw / 2 - 2} ${S / 2}`} fill="none" stroke={c} strokeWidth={sw}
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - v)}
          style={{ transition: "stroke-dashoffset .6s", filter: hot ? `drop-shadow(0 0 4px ${color}88)` : "none" }}/>
      </svg>
      <div style={{ marginTop: -30, fontSize: 22, fontWeight: 900, color: hot ? color : "var(--text)", lineHeight: 1 }}>{Math.round(value || 0)}°</div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", height: 14, marginTop: 2 }}>{target > 0 ? `consigne ${Math.round(target)}°` : ""}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: active ? color : "var(--text2)", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
        {label}{active && <span style={{ fontSize: 9.5, padding: "1px 7px", borderRadius: 20, color: "#fff", background: color }}>active</span>}</div>
    </div>
  );
}
function PrinterPopup({ status, img, name, onClose }) {
  const [big, setBig] = useState(false);
  // telephone : la vignette en grand en haut avec l'anneau a cote, le nom dessous sur toute la largeur
  const narrowPop = typeof window !== "undefined" && window.innerWidth < 520;
  useEffect(() => {
    const k = e => { if (e.key === "Escape" && !big) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [big]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = stateOf(status);
  const st = String(status?.status || "").toUpperCase();
  const live = LIVE_ST.includes(st), paused = st === "PAUSE" || st === "PAUSED";
  const pct = Math.round(status?.progress || 0);
  const fin = live && status?.remaining_minutes ? fmtFinishTime(status.remaining_minutes) : null;
  const nozzles = [...(status?.nozzles || [])].sort((a, b) => b.id - a.id);   // gauche (1) puis droite (0)
  const ams = (status?.ams_list || []).find(a => a.id === status?.active_ams_id);
  const tray = ams?.trays?.find(t => t.id === status?.active_tray_id);
  const spool = tray?.spool_info;
  const R = 70, C = 2 * Math.PI * R;
  const section = t => <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>{t}</div>;
  return createPortal(
    <div data-no-pull="" onClick={e => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 950, padding: 14,
      background: "rgba(2,6,23,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "default" }}>
      <div onClick={e => e.stopPropagation()} className="card bn-zoom-body" style={{ width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: 18,
        display: "flex", flexDirection: "column", gap: 16, background: "var(--sheet-bg)", boxShadow: "0 30px 80px rgba(0,0,0,0.45)", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center",
            background: `${s.color}22`, color: s.color }}><Printer size={18}/></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)" }}>Imprimante</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: s.color }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color }}/>{s.label}
              {status?.fw_version && <span style={{ color: "var(--muted)", fontWeight: 600 }}>· micrologiciel {status.fw_version}</span>}</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid var(--border)",
            background: "var(--surface2)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", padding: 14, display: "flex", flexDirection: "column", gap: 12,
          background: `linear-gradient(135deg, ${s.color}33, transparent 60%), var(--surface2)` }}>
          {img && <img src={img} alt="" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
            filter: "blur(22px) saturate(1.5)", opacity: 0.45, transform: "scale(1.3)" }}/>}
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: narrowPop ? "1fr auto" : "auto minmax(0,1fr) auto",
            alignItems: "center", gap: narrowPop ? "10px 12px" : 14 }}>
            <div onClick={img ? () => setBig(true) : undefined} style={{ width: narrowPop ? 128 : 104, height: narrowPop ? 128 : 104, flexShrink: 0,
              cursor: img ? "zoom-in" : "default", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
              {img ? <img src={img} alt="" className="bn-plate" style={{ width: "100%", height: "100%", objectFit: "contain" }}
                onError={e => { e.currentTarget.style.display = "none"; }}/>
                : <Printer size={32}/>}
            </div>
            <div style={{ minWidth: 0, gridColumn: narrowPop ? "1 / -1" : undefined, gridRow: narrowPop ? 2 : undefined }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)", lineHeight: 1.2, overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{name || status?.print_name || "Rien en cours"}</div>
              {live && <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", marginTop: 3 }}>
                {status.remaining_minutes > 0 ? `encore ${fmtTime(status.remaining_minutes)}` : "bientôt fini"}{fin ? ` · fin ${fin.time}${plusDays(fin.dayDiff)}` : ""}</div>}
            </div>
            <div style={{ position: "relative", width: 86, height: 86, flexShrink: 0, gridColumn: narrowPop ? 2 : undefined, gridRow: narrowPop ? 1 : undefined }}>
              <svg width="86" height="86" viewBox="0 0 86 86" style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
                <circle cx="43" cy="43" r="36" fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth="9"/>
                <circle cx="43" cy="43" r="36" fill="none" stroke={s.color} strokeWidth="9" strokeLinecap="round" strokeDasharray={2 * Math.PI * 36}
                  strokeDashoffset={2 * Math.PI * 36 * (1 - (live ? pct : 0) / 100)} style={{ transition: "stroke-dashoffset .6s", filter: `drop-shadow(0 0 5px ${s.color})` }}/>
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: s.color, lineHeight: 1 }}>{live ? `${pct}%` : "—"}</span>
                {paused && <span style={{ fontSize: 9.5, fontWeight: 800, color: s.color }}>pause</span>}
              </div>
            </div>
          </div>
          {live && <div style={{ position: "relative", height: 8, borderRadius: 6, background: "rgba(148,163,184,0.25)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, borderRadius: 6, background: `linear-gradient(90deg, ${s.color}aa, ${s.color})`, boxShadow: `0 0 10px ${s.color}` }}/></div>}
        </div>

        {live && <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {[[Clock, "Reste", fmtTime(status.remaining_minutes) || "—", "#3b82f6"], [Calendar, "Fin", fin ? `${fin.time}${plusDays(fin.dayDiff)}` : "—", "#8b5cf6"],
            [Layers, "Couche", status.total_layers > 0 ? `${status.layer}/${status.total_layers}` : "—", "#14b8a6"]].map(([I, l, v, c]) => (
            <div key={l} style={{ padding: "10px 10px", borderRadius: 14, background: "var(--surface2)", minWidth: 0, position: "relative", overflow: "hidden" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, color: c }}><I size={13}/>{l}</span>
              <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
              {l === "Couche" && status.total_layers > 0 && <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "var(--border)" }}>
                <div style={{ height: "100%", width: `${Math.round(100 * status.layer / status.total_layers)}%`, background: c }}/></div>}
            </div>))}
        </div>}

        {status?.connected && <>
          {section("Températures")}
          {(status.nozzles || []).length > 1 && <div style={{ display: "flex", justifyContent: "center" }}><HeadArt st={status} h={150}/></div>}
          <TempPanel status={status} cardH={104}/>
        </>}

        {tray && !tray.empty ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
          {tray && !tray.empty && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, background: "var(--surface2)" }}>
            <span style={{ flexShrink: 0, display: "inline-flex" }}><SpoolSVG colors={[trayHex(tray) || "#888888"]} size={52} active={live}/></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>Filament en cours · {slotLabel(status.active_ams_id, status.active_tray_id)}</div>
              <div style={{ fontSize: 14.5, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {spool?.translated_name || spool?.name || tray.filament_type || "?"}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>
                {[spool?.fila_type || tray.filament_type, spool?.remaining_weight_g != null ? `${Math.round(spool.remaining_weight_g)} g` : tray.remain != null ? `${tray.remain} %` : null].filter(Boolean).join(" · ")}</div>
            </div>
          </div>}
        </div> : null}

        {(status?.hotend_rack?.hotends || []).some(h => !h.empty && h.filament_id) && <>
          {section("Rack Vortek")}
          <RackStrip rack={status.hotend_rack} activeNozzleId={(status.nozzles || []).find(n => n.active)?.id}/>
        </>}

        {status?.fila_switch?.installed && <>
          {section("Aiguillage")}
          <SwitchDiagram fs={switchRoutes(status)} status={status}/>
        </>}

        {status?.hms_decoded?.length > 0 && <>
          {section("Alertes de la machine")}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {status.hms_decoded.map((h, i) => { const sc = HMS_SEV[h.severity] || HMS_SEV.info; return (
              <a key={i} href={h.wiki} target="_blank" rel="noreferrer" style={{ display: "flex", gap: 10, alignItems: "flex-start", textDecoration: "none",
                padding: "9px 11px", borderRadius: 12, background: `${sc.color}12`, border: `1px solid ${sc.color}44` }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: sc.color, marginTop: 5, flexShrink: 0 }}/>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text)", lineHeight: 1.4 }}>
                  <b style={{ color: sc.color, fontSize: 10.5, textTransform: "uppercase", marginRight: 6 }}>{sc.label}</b>{h.label || h.code}</span>
                <ExternalLink size={13} style={{ color: "var(--muted)", flexShrink: 0, marginTop: 2 }}/></a>); })}
          </div>
        </>}
        {big && img && <span onClick={e => e.stopPropagation()}><Lightbox images={[img]} index={0} onClose={() => setBig(false)}/></span>}
      </div>
    </div>, document.body);
}
// la couleur d'un emplacement d'AMS, comme la tuile AMS : la bobine associee d'abord, puis l'AMS
function trayHex(t) {
  const c = t && !t.empty && (t.spool_info?.color || t.spool_info?.filament_color || t.color);
  return c ? `#${String(c).replace("#", "").slice(0, 6)}` : null;
}
// Le Filament Track Switch : ce qui entre en A et en B (l'AMS et son bac, sa couleur),
// et la buse que sert chaque sortie. Format releve dans Bambu Studio (DevFilaSwitch).
function SwitchDiagram({ fs, status }) {
  const tray = slot => {
    if (!slot) return null;
    const a = (status?.ams_list || []).find(x => x.id === slot.ams);
    return { label: slotLabel(slot.ams, slot.tray), t: a?.trays?.find(t => t.id === slot.tray) };
  };
  const nozzle = id => id == null ? "—" : (status?.nozzles?.length > 1 ? (id === 1 ? "Buse gauche" : "Buse droite") : "Buse");
  const activeNz = (status?.nozzles || []).find(n => n.active)?.id;
  const line = (port, slot, out) => {
    const x = tray(slot);
    const col = trayHex(x?.t);
    const live = out != null && out === activeNz;
    return (
      <div key={port} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 34px minmax(0,1fr)", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 12, background: "var(--surface2)", minWidth: 0 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: col || "transparent",
            border: col ? "1px solid rgba(0,0,0,0.15)" : "1.5px dashed var(--border)" }}/>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#8b5cf6" }}>Entrée {port}</div>
            <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {x ? `${x.label}${x.t?.filament_type ? ` · ${x.t.filament_type}` : ""}` : "rien"}</div>
          </div>
        </div>
        <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden="true">
          <path d="M2 10 H28" stroke={live ? "#22c55e" : "var(--border)"} strokeWidth="2.5" strokeDasharray={live ? "5 3" : "none"}
            style={live ? { animation: "bn-dash 1s linear infinite" } : undefined}/>
          <path d="M24 5 L31 10 L24 15" fill="none" stroke={live ? "#22c55e" : "var(--border)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div style={{ padding: "8px 10px", borderRadius: 12, minWidth: 0, background: live ? "rgba(34,197,94,0.1)" : "var(--surface2)",
          border: `1px solid ${live ? "rgba(34,197,94,0.45)" : "transparent"}` }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>Sortie {port}</div>
          <div style={{ fontSize: 13, fontWeight: 900, color: live ? "#16a34a" : "var(--text)" }}>{nozzle(out)}</div>
        </div>
      </div>
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {line("A", fs.in_a, fs.out_a)}
      {line("B", fs.in_b, fs.out_b)}
      {/* la presence du filament (info bit 0) n'est pas fiable : Bambu Studio la lit pareil pour A et B */}
      {fs.calibrating && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
        {fs.calibrating && <span style={{ color: "#f59e0b" }}>● calibration en cours</span>}
      </div>}
    </div>
  );
}
// toute la largeur sur une rangee : un bandeau. La vignette (un clic l'ouvre en grand),
// le nom, le pourcentage en grand, le temps restant, l'heure de fin, la couche, la barre ;
// plus large, les temperatures et la bobine en cours a droite
function PrinterStrip({ status, showFin = true, showLayer = true }) {
  const [info, setInfo] = useState(null);
  const [big, setBig] = useState(false);
  const [pop, setPop] = useState(false);
  const box = useRef(null);
  const [W, setW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  const fin = live && status?.remaining_minutes ? fmtFinishTime(status.remaining_minutes) : null;
  const img = info ? apiUrl(`/prints/${info.id}/image`) : null;
  const ams = (status?.ams_list || []).find(a => a.id === status?.active_ams_id);
  const tray = ams?.trays?.find(t => t.id === status?.active_tray_id);
  const nz = (status?.nozzles || []).find(n => n.active) || (status?.nozzles || [])[0];
  const fact = (Icon, text, color, size = 12.5) => <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: size, fontWeight: 700,
    color: color || "var(--muted)", whiteSpace: "nowrap" }}><Icon/>{text}</span>;
  const side = W >= 470;
  // les temperatures : chaque buse (D et G quand il y en a deux), le plateau, la chambre, avec leur consigne
  const nozzles = [...(status?.nozzles || [])].sort((a, b) => b.id - a.id);   // gauche (1) puis droite (0)
  const tempItem = (Icon, label, v, t, hot, size) => (
    <span data-pk="" title={label} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: size, fontWeight: 800, whiteSpace: "nowrap",
      color: (v || 0) > 40 ? hot : "var(--muted)" }}><Icon/>
      {label && nozzles.length > 1 && label.startsWith("Buse") && <span style={{ fontSize: size - 2, fontWeight: 900 }}>{label.slice(-1)}</span>}
      {Math.round(v || 0)}°{t > 0 && <sup style={{ fontSize: "0.72em", color: "var(--muted)", fontWeight: 700, lineHeight: 0, marginLeft: 1 }}>/{Math.round(t)}°</sup>}</span>
  );
  const temps = (size, gap) => <span style={{ display: "inline-flex", gap, flexShrink: 0, alignItems: "center" }}>
    {nozzles.map(n => <React.Fragment key={n.id}>{tempItem(IcoNozzle, nozzles.length > 1 ? `Buse ${n.id === 1 ? "G" : "D"}` : "Buse", n.temp, n.target, "#ea580c", size)}</React.Fragment>)}
    {tempItem(IcoBed, "Plateau", status?.bed_temp, status?.target_bed_temp, "#dc2626", size)}
    {status?.chamber_temp > 0 && tempItem(IcoChamber, "Chambre", status.chamber_temp, status.target_chamber_temp, "#ca8a04", size)}
  </span>;
  // la ligne du bas (toute la largeur) : la couche et les temperatures, quand il n'y a pas de colonne a droite
  // la ligne du bas reste hors impression : les temperatures (le plateau qui refroidit…)
  const bottom = !side && (status?.connected || (live && showLayer && status.total_layers > 0));
  const layerInline = showLayer && status?.total_layers > 0 && side;
  return (
    <div ref={box} onClick={() => setPop(true)} style={{ display: "flex", flexDirection: "column", gap: 5, height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minHeight: 0, minWidth: 0 }}>
        <div onClick={img ? e => { e.stopPropagation(); setBig(true); } : undefined} style={{ height: "100%", aspectRatio: "1", maxHeight: 120, borderRadius: 14,
          overflow: "hidden", flexShrink: 0, background: "var(--surface2)", cursor: img ? "zoom-in" : "default", display: "flex", alignItems: "center",
          justifyContent: "center", color: "var(--muted)" }}>
          {img ? <img src={img} alt="" onError={e => { e.currentTarget.style.display = "none"; }} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
            : <Printer size={26}/>}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden",
              textOverflow: "ellipsis", lineHeight: 1.2 }}><Words text={info?.file_name || status?.print_name || "Imprimante"}/></span>
            {(!live || paused) && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800, padding: "2px 8px",
              borderRadius: 20, whiteSpace: "nowrap", color: s.color, background: `${s.color}1f` }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color }}/>{s.label}</span>}
          </div>
          {live ? <>
            {/* une seule ligne : ce qui ne tient pas est coupe, jamais renvoye a la ligne */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
              <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 24, fontWeight: 900, color: s.color, lineHeight: 1,
                fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{paused && <Pause size={18}/>}{pct}%</span>
              {status.remaining_minutes > 0 && fact(() => <Clock size={13}/>, fmtTime(status.remaining_minutes))}
              {showFin && fin && fact(() => <Calendar size={13}/>, `${fin.time}${plusDays(fin.dayDiff)}`)}
              {layerInline && fact(() => <Layers size={13}/>, `${status.layer}/${status.total_layers}`)}
            </div>
            <div style={{ height: 8, borderRadius: 6, background: "var(--border)", overflow: "hidden", flexShrink: 0 }}>
              <div data-pk="" style={{ height: "100%", width: `${pct}%`, borderRadius: 6, background: `linear-gradient(90deg, ${s.color}, ${s.color}cc)`,
                boxShadow: `0 0 8px ${s.color}88`, transition: "width 1s" }}/></div>
          </> : <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {/* hors impression : depuis quand, et ce qu'a ete la derniere */}
            <Words text={info ? [info.print_date && agoFr(info.print_date), info.duration_seconds && fmtTime(Math.round(info.duration_seconds / 60)),
              info.total_weight_g && `${Math.round(info.total_weight_g)} g`].filter(Boolean).join(" · ") || "Dernière impression" : "Prête à imprimer"}/></div>}
        </div>
        {side && status?.connected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end", flexShrink: 0 }}>
            {tray && !tray.empty && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: "var(--text2)" }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: trayHex(tray) || "#888888",
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)" }}/>{tray.filament_type || "?"}
              <span style={{ color: "var(--muted)", fontWeight: 700 }}>{slotLabel(status.active_ams_id, status.active_tray_id)}</span></span>}
            {temps(12, 10)}
          </div>
        )}
      </div>
      {bottom && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", flexShrink: 0 }}>
          {live && showLayer && status.total_layers > 0 && fact(() => <Layers size={11}/>, `${status.layer}/${status.total_layers}`, undefined, W < 340 ? 10.5 : 11.5)}
          {status?.connected && <span style={{ marginLeft: "auto" }}>{temps(W < 340 ? 10.5 : 11.5, W < 340 ? 5 : 9)}</span>}
        </div>
      )}
      {big && img && <span onClick={e => e.stopPropagation()}><Lightbox images={[img]} index={0} onClose={() => setBig(false)}/></span>}
      {pop && <PrinterPopup status={status} img={img} name={info?.file_name || status?.print_name} onClose={() => setPop(false)}/>}
    </div>
  );
}
// en demi-largeur : grande (vignette 4/3 au-dessus), moyenne (vignette 16/9), ou compacte (vignette a gauche)
function PrinterCompact({ status, size = "big", showFin = true, showLayer = true }) {
  const [info, setInfo] = useState(null);
  const [big, setBig] = useState(false);
  const [pop, setPop] = useState(false);
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
    <div onClick={info ? e => { e.stopPropagation(); setBig(true); } : undefined}
      style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "var(--surface2)", flexShrink: 0, cursor: info ? "zoom-in" : undefined,
      ...(small ? { width: 42, height: 42, borderRadius: 10 } : { width: "100%", aspectRatio: size === "mid" ? "16 / 9" : "4 / 3" }) }}>
      {info && <img data-pk="" src={apiUrl(`/prints/${info.id}/image`)} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
        style={{ width: "100%", height: "100%", objectFit: small ? "cover" : "contain", display: "block" }}/>}
      {live && !small && <span data-pk="" style={{ position: "absolute", right: 8, top: 8, fontSize: 17, fontWeight: 900, color: "#fff",
        padding: "2px 9px", borderRadius: 10, background: `${s.color}dd`, boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}>{pct}%</span>}
    </div>
  );
  const facts = live && (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 12, color: "var(--muted)" }}>
      {status.remaining_minutes > 0 && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Clock size={12}/>{fmtTime(status.remaining_minutes)}</span>}
      {showFin && fin && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Calendar size={12}/>{fin.time}{plusDays(fin.dayDiff)}</span>}
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
  // le portail de l'agrandissement renvoie ses clics : on les arrete
  const popup = pop && <PrinterPopup status={status} img={info ? apiUrl(`/prints/${info.id}/image`) : null} name={info?.file_name || status?.print_name}
    onClose={() => setPop(false)}/>;
  const zoom = big && info && <span onClick={e => e.stopPropagation()}>
    <Lightbox images={[apiUrl(`/prints/${info.id}/image`)]} index={0} onClose={() => setBig(false)}/></span>;
  const paused = st === "PAUSE" || st === "PAUSED";
  // compacte : le nom en entier (sur deux lignes s'il le faut), puis l'avancement et le temps restant, puis la barre ;
  // hors impression, l'etat a la place
  if (small) return (
    <div onClick={() => setPop(true)} style={{ minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, cursor: "pointer" }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.2, overflow: "hidden", display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflowWrap: "break-word" }}><Words text={info?.file_name || status?.print_name || "Imprimante"}/></div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        {thumb}
        {live ? <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 18, fontWeight: 900, color: s.color, lineHeight: 1.1,
            fontVariantNumeric: "tabular-nums" }}>{paused && <Pause size={14}/>}{pct}%</span>
          {status.remaining_minutes > 0 && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700,
            color: "var(--muted)", whiteSpace: "nowrap" }}><Clock size={12}/>{fmtTime(status.remaining_minutes)}</span>}
        </div> : <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap",
          padding: "2px 8px", borderRadius: 20, color: s.color, background: `${s.color}1f` }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color }}/>{s.label}</span>}
      </div>
      {bar}
      {zoom}{popup}
    </div>
  );
  return (
    <div onClick={() => setPop(true)} style={{ display: "flex", flexDirection: "column", gap: 7, cursor: "pointer" }}>
      {zoom}{popup}
      {thumb}
      {name}
      {live ? <>{facts}{bar}</> : <div style={{ fontSize: 12, color: "var(--muted)" }}><Words text={info ? "Dernière impression" : "Prête à imprimer"}/></div>}
    </div>
  );
}

// ── Page Home ──────────────────────────────────────────────────────────────
// Un texte decoupe en mots : chacun peut bouger seul (effets de l'accueil)
function Words({ text }) {
  return <span>{String(text ?? "").split(/(\s+)/).map((p, i) => /\s/.test(p) || !p ? p : <span key={i} data-pk="">{p}</span>)}</span>;
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
    <div data-hues={[sky.a, sky.b, sky.c].join(",")} className={`card home-hello${size === "compact" ? " hh-compact" : ""}${mini ? " hh-mini" : ""}`} style={{ position: "relative",
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
          {opt("pFin", true) && fin && <span data-pk="" style={pill}><Clock size={14}/>fin {fin.time}{plusDays(fin.dayDiff)}</span>}
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

  // hauteur choisie : la place du corps de la tuile (sous son titre), pour condenser l'AMS
  const fitOf = item => typeof item?.h === "number" ? item.h * 128 - 30 - (item.o?._title === false ? 0 : 28) : null;
  const devices = (st, part, o = {}, item) => (st?.status === "RUNNING" || st?.status === "PAUSED" || (st?.ams_list?.length > 0)) ? <DeviceGrid
    key={`${visKey}-${part}`} part={part} org={o.org} climate={o.climate !== false} selector={o.selector !== false} names={o.names !== false}
    fitH={fitOf(item)} dual={(st?.nozzles?.length || 0) > 1 || !!st?.fila_switch?.installed} fs={switchRoutes(st)} forceView={o.forceView || null}
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
        background: trayHex(t) || "var(--surface2)" }}/>)}</span>;
  };
  // les blocs de l'accueil, tuiles de la grille comme les autres (l'imprimante ne se masque pas)
  const blocks = {
    printer: { label: "Imprimante", w: [2, 1], h: ["auto", 1, 2, 3], h1: [2, 3, 1], required: true,
      mini: (d, st) => <PrinterLine status={st}/>,
      summary: (d, st) => ["RUNNING", "PAUSE", "PAUSED"].includes(String(st?.status || "").toUpperCase())
        ? <span data-pk="" style={{ fontSize: 14 }}>{Math.round(st.progress || 0)} %</span> : null,
      frame: { icon: <Printer size={15}/>, color: "#3B82F6",
        extra: (st, item, o) => {
          // sur une rangee, le bandeau et la version compacte disent deja l'etat : pas de doublon
          if (item.h === 1) return null;
          const temps = o.headTemps && item.w !== 1 && item.h !== 1;
          return stateOf(st).label === "En cours" && !temps ? null : <PrinterHead status={st} temps={temps}/>;
        } },
      render: (d, st, o, item) => item?.w !== 1 && item?.h === 1 ? <PrinterStrip status={st} showFin={o.fin} showLayer={o.layer}/>
        : item?.w === 1 || item?.h === 1 ? <PrinterCompact status={st} size={item.w !== 1 || item.h <= 1 ? "small" : o.half} showFin={o.fin} showLayer={o.layer}/>
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
    // l'AMS tout en un (23/10/2026) : remplace l'ancien apercu et la tuile « Detail de l'AMS »
    vortek: { label: "Rack Vortek", w: [2, 1], h: [2, 1, 3], frame: { icon: <Layers size={15}/>, color: "#0EA5E9" },
      summary: (d, st) => { const r = st?.hotend_rack; const n = (r?.hotends || []).filter(h => h.id >= 16 && !h.empty && h.filament_id).length;
        return r ? <span style={{ fontSize: 13 }}>{n}/6{r.head_id >= 16 ? ` · buse ${r.head_id - 15} sur la tête` : ""}</span> : null; },
      render: (d, st, o, item) => <VortekTile st={st} low={item?.h === 1} fitH={fitOf(item)}/> },
    ams: { label: "AMS", w: [2], h: [2, 1, 3], summary: (d, st) => amsSummary(st), frame: { icon: <Disc3 size={15}/>, color: "#8B5CF6" },
      render: (d, st, o, item) => <AmsHub st={st} spoolLookup={spoolLookup} fitH={fitOf(item)} o={o}
        rackTile={st?.hotend_rack && <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1, minWidth: 0 }}><RackState rack={st.hotend_rack} compact/></div>
            <HubBack/></div>
          <VortekRack rack={st.hotend_rack} H={(fitOf(item) || 260) - 34}/></div>}
        rackFull={st?.hotend_rack && <VortekPanel rack={st.hotend_rack}/>}/>,
      options: [
        { key: "_amsGrid", label: "Ma grille", group: "Disposition des AMS", hint: "La place de chaque unité : qui est au-dessus de qui. Commune à tout l'accueil.",
          render: () => <AmsOrderEditor/> },
        { key: "climate", label: "Humidité de chaque unité", def: true }] },
    attention: { label: "Points d'attention", w: [2], h: ["auto", 1, 2, 3], summary: d => {
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

