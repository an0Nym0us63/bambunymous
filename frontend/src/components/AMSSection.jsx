import React, { useState } from "react";
import { Droplets, Sun, Thermometer, Timer, Clock, Package } from "lucide-react";
import client from "../api/client";

// ── Helpers ────────────────────────────────────────────────────────────────
// Convertit un hex 6 ou 8 chars (avec ou sans #) en valeur CSS utilisable.
// 8 chars = RRGGBBAA → si AA < FF → rgba(), sinon #rrggbb
// 6 chars = RRGGBB → #rrggbb
function hexToCss(hex) {
  if (!hex) return null;
  const h = hex.replace(/^#/, "").toLowerCase();
  if (h.length === 8) {
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16),
          b = parseInt(h.slice(4,6),16), a = parseInt(h.slice(6,8),16);
    if (a === 255) return `#${h.slice(0,6)}`;
    return `rgba(${r},${g},${b},${(a/255).toFixed(3)})`;
  }
  if (h.length === 6) return `#${h}`;
  return null;
}
// Alias pour compatibilité avec l'ancien nom
const hexCss = hexToCss;
// Affichage texte d'une couleur — toujours en hex, jamais en rgba()
const hexDisplay = (hex) => {
  if (!hex) return null;
  const h = hex.replace(/^#/, "").toLowerCase();
  return (h.length === 6 || h.length === 8) ? `#${h}` : null;
};


// Normalise un hex pour stockage (strip #, garder 6 ou 8 chars)
function normalizeHex(raw) {
  const h = (raw || "").replace(/^#/, "").toLowerCase();
  if (h.length === 8 || h.length === 6) return h;
  if (h.length === 3) return h.split("").map(c=>c+c).join("");
  return "";
}

function isEmptyTray(tray) {
  if (tray.empty) return true;
  // Un tray est vide si uuid ET filament_type sont vides
  // Ne pas se fier à la couleur (le noir pur #000000 serait faussement détecté comme vide)
  const noUuid = (tray.uuid||"").replace(/0/g,"") === "";
  const noType = !(tray.filament_type||"").trim();
  const noName = !(tray.tray_id_name||"").trim();
  return noUuid && noType && noName;
}
function luminance(hex) {
  const h = (hex||"").replace("#","");
  const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  return isNaN(r) ? 128 : (r*299+g*587+b*114)/1000;
}
// Contraste : retourne "white" ou "black" selon la luminance du fond
function contrast(hex) {
  return luminance((hex||"").replace("#","")) < 128 ? "white" : "rgba(0,0,0,0.75)";
}

function parseColors(tray, spoolInfo) {
  // 1. multicolor via colors_array
  const arr = spoolInfo?.colors_array || tray?.colors_array;
  if (arr) {
    const cols = arr.split(",").map(c=>c.trim()).filter(Boolean);
    if (cols.length > 1) return cols.map(c => hexToCss(c)).filter(Boolean);
  }
  // 2. couleur simple
  const single = hexToCss(spoolInfo?.color || spoolInfo?.filament_color || tray?.color);
  return single ? [single] : null;
}

// Génère le style background pour n couleurs
function colorBg(colors, type) {
  if (!colors?.length) return { backgroundColor: "var(--border)" };
  if (colors.length === 1) return { backgroundColor: colors[0] };
  if (type === "gradient") {
    // Fondu lisse entre les couleurs
    return { background: `linear-gradient(90deg, ${colors.join(", ")})` };
  }
  // Autres types (coaxial, etc.) : séparation nette
  const stops = colors.map((c,i)=>{
    const a = Math.round(i/colors.length*100);
    const b = Math.round((i+1)/colors.length*100);
    return `${c} ${a}%, ${c} ${b}%`;
  }).join(", ");
  return { background: `linear-gradient(90deg, ${stops})` };
}
function multicolorType(tray, spoolInfo) {
  return spoolInfo?.multicolor_type || tray?.multicolor_type || null;
}

const AMS_NAMES = ["AMS-A","AMS-B","AMS-C","AMS-D"];

// ── Mini pastille ──────────────────────────────────────────────────────────
function ColorPill({ tray, spoolInfo, active }) {
  const colors = parseColors(tray, spoolInfo);
  const c1 = colors?.[0];
  const bg = colorBg(colors, multicolorType(tray, spoolInfo));
  // Contour léger pour les couleurs claires/blanches
  const lum = luminance((c1||"").replace("#",""));
  const ringColor = active ? "#3b82f6" : lum > 200 ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.1)";
  return (
    <div style={{ flex:1, height:28, borderRadius:6, transition:"all 0.2s",
      boxShadow: active ? `0 0 0 2px ${ringColor}` : `0 0 0 1px ${ringColor}`,
      position:"relative", ...bg }}>
      {tray.match_mode && (
        <span style={{ position:"absolute", top:2, right:3 }}>
          <MatchIcon mode={tray.match_mode} size={8}/>
        </span>
      )}
    </div>
  );
}

// ── Icône de détection filament ─────────────────────────────────────────────
function MatchIcon({ mode, size = 10 }) {
  if (!mode) return null;
  const cfg = {
    rfid:     { symbol: "⬡", color: "#22c55e", title: "Reconnu par RFID Bambu" },
    auto:     { symbol: "◈", color: "#f59e0b", title: "Reconnu automatiquement (profil + couleur)" },
    notfound: { symbol: "⚠", color: "#ef4444", title: "Filament identifié par l'imprimante mais introuvable en base" },
    manual:   { symbol: "◇", color: "#94a3b8", title: "Non identifié" },
  }[mode];
  if (!cfg) return null;
  return (
    <span title={cfg.title} style={{ fontSize:size, lineHeight:1, color:cfg.color,
      textShadow:"0 0 4px rgba(0,0,0,0.8)", userSelect:"none", pointerEvents:"none" }}>
      {cfg.symbol}
    </span>
  );
}

// ── Boîtier AMS compact ─────────────────────────────────────────────────────
function AMSBox({ ams, activeAmsId, activeTrayId, isSelected, onClick, spoolLookup }) {
  const isActive = ams.id === activeAmsId;
  const isDrying = ams.is_drying || ams.dry_time > 0;
  const getInfo = t => t.spool_info ?? null;

  // Couleur du pourtour : si les deux → double bordure (bleu + orange)
  const borderColor = isDrying && isActive
    ? "rgba(249,115,22,0.4)"        // orange prioritaire, bleu visible via boxShadow
    : isDrying ? "rgba(249,115,22,0.35)"
    : isActive ? "rgba(59,130,246,0.4)"
    : isSelected ? "rgba(255,255,255,0.2)"
    : "var(--border)";

  const bg = isDrying ? "rgba(249,115,22,0.04)"
    : isActive ? "rgba(59,130,246,0.06)"
    : "var(--surface2)";

  // Si actif+séchage : halo bleu fixe en box-shadow interne + dryPulse orange en animation
  const boxShadow = isActive && !isDrying ? "0 4px 16px rgba(59,130,246,0.15)"
    : !isDrying ? "none"
    : isActive ? "0 0 0 1px rgba(59,130,246,0.35), 0 4px 12px rgba(249,115,22,0.10)"
    : "0 4px 12px rgba(249,115,22,0.10)";

  return (
    <button onClick={onClick} style={{
      display:"flex", flexDirection:"column", alignItems:"center", gap:6,
      background:"none", border:"none", cursor:"pointer", width:"100%", padding:0,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em",
          color: isActive ? "#3b82f6" : isSelected ? "var(--text)" : "var(--muted)" }}>
          {AMS_NAMES[ams.id] ?? `AMS ${ams.id+1}`}
        </span>
        {/* Pastille bleue toujours visible si actif, même en séchage */}
        {isActive && <span style={{ width:6, height:6, borderRadius:"50%",
          backgroundColor:"#3b82f6", animation:"livePulse 2s infinite" }} />}
      </div>
      <div style={{
        width:"100%", borderRadius:12, padding:6, display:"flex", gap:4,
        border:`1px solid ${borderColor}`,
        background: bg,
        boxShadow: boxShadow,
        animation: isDrying ? "dryPulse 2.5s ease-in-out infinite" : "none",
        transition:"all 0.2s",
      }}>
        {ams.trays.map(t => <ColorPill key={t.id} tray={t} spoolInfo={getInfo(t)} active={isActive && t.id===activeTrayId} />)}
      </div>
      <div style={{ display:"flex", gap:8, fontSize:9, color:"var(--muted)" }}>
        <span style={{ display:"flex", alignItems:"center", gap:2 }}><Droplets size={8}/>{ams.humidity}%</span>
        <span style={{ display:"flex", alignItems:"center", gap:2,
          color: isDrying ? "#f97316" : "var(--muted)",
          animation: isDrying ? "dryGlow 2.5s ease-in-out infinite" : "none" }}>
          <Sun size={8} style={{ color: isDrying ? "#f97316" : undefined }}/>{(ams.temp ?? 0).toFixed(1)}°
        </span>
      </div>
      <div style={{ height:2, borderRadius:1,
        background: isSelected ? "#3b82f6" : "transparent",
        width: isSelected ? 32 : 8, transition:"all 0.3s" }} />
    </button>
  );
}

// ── Bobine SVG — vue de face, disque plat ──────────────────────────────────
function SpoolSVG({ colors, empty, size=68, active, type }) {
  const c1 = colors?.[0] || (empty ? "#2a2a2a" : "#888");
  const multi = colors && colors.length > 1;
  const isGradient = multi && type === "gradient";
  const uid = `sg${Math.random().toString(36).slice(2,7)}`;
  const lum = luminance(c1.replace("#",""));
  const dark = lum < 128;
  // Teinte légèrement plus claire/foncée pour l'anneau extérieur
  const ringColor = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
  const hubColor  = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.20)";
  const spokeColor= dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.10)";
  const fill = empty ? "#2a2a2a" : c1;

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {/* Ombre portée */}
      <ellipse cx="40" cy="75" rx="22" ry="3" fill="rgba(0,0,0,0.20)"/>

      {isGradient && (
        <defs>
          <linearGradient id={uid} x1="10" y1="40" x2="70" y2="40" gradientUnits="userSpaceOnUse">
            {colors.map((cl, i) => (
              <stop key={i} offset={`${Math.round(i/(colors.length-1)*100)}%`} stopColor={cl}/>
            ))}
          </linearGradient>
        </defs>
      )}

      {/* Disque principal — couleur exacte, dégradé lisse, ou secteurs selon le type */}
      {!empty && isGradient ? (
        <circle cx="40" cy="40" r="30" fill={`url(#${uid})`}/>
      ) : multi && !empty ? (
        // Secteurs de couleur (pie chart SVG) — coaxial et autres types
        colors.map((cl, i) => {
          const total = colors.length;
          const startAngle = (i / total) * 2 * Math.PI - Math.PI / 2;
          const endAngle   = ((i + 1) / total) * 2 * Math.PI - Math.PI / 2;
          const x1 = 40 + 30 * Math.cos(startAngle);
          const y1 = 40 + 30 * Math.sin(startAngle);
          const x2 = 40 + 30 * Math.cos(endAngle);
          const y2 = 40 + 30 * Math.sin(endAngle);
          const large = total === 1 ? 1 : 0;
          return (
            <path key={i}
              d={`M 40 40 L ${x1.toFixed(2)} ${y1.toFixed(2)} A 30 30 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`}
              fill={cl}/>
          );
        })
      ) : (
        <circle cx="40" cy="40" r="30" fill={fill}/>
      )}

      {/* Anneau extérieur (léger contour) */}
      <circle cx="40" cy="40" r="30" fill="none" stroke={ringColor} strokeWidth="2"/>

      {/* Zone hub (cercle intérieur plus sombre) */}
      <circle cx="40" cy="40" r="14" fill={hubColor}/>
      {/* Trou central */}
      <circle cx="40" cy="40" r="6" fill={empty ? "#111" : "rgba(0,0,0,0.65)"}/>

      {/* Minuscule reflet */}
      <circle cx="34" cy="34" r="3" fill={dark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.30)"} opacity="0.8"/>

      {/* Animation impression */}
      {active && (
        <circle cx="40" cy="40" r="32" stroke="#3b82f6" strokeWidth="2.5"
          fill="none" strokeDasharray="6 3" opacity="0.9">
          <animateTransform attributeName="transform" type="rotate"
            from="0 40 40" to="360 40 40" dur="8s" repeatCount="indefinite"/>
        </circle>
      )}
    </svg>
  );
}

// ── Tray card ──────────────────────────────────────────────────────────────
function TrayCard({ tray, amsId, label, activeAmsId, activeTrayId, spoolInfo, onClick }) {
  const isActive = amsId===activeAmsId && tray.id===activeTrayId;
  const empty = isEmptyTray(tray);
  const colors = parseColors(tray, spoolInfo);
  const c1 = colors?.[0];
  const name = spoolInfo?.name ?? spoolInfo?.filament_name ?? null;
  const material = spoolInfo?.material ?? spoolInfo?.filament_material ?? tray.filament_type ?? null;
  const hasW = spoolInfo?.remaining_weight_g != null;
  const hasT = (spoolInfo?.initial_weight_g ?? spoolInfo?.filament_weight_g) != null;
  const pct = hasW && hasT
    ? Math.round((spoolInfo.remaining_weight_g/(spoolInfo.initial_weight_g ?? spoolInfo.filament_weight_g))*100)
    : (tray.remain ?? 0);
  const wLabel = hasW ? `${Math.round(spoolInfo.remaining_weight_g)}g` : `${tray.remain ?? 0}%`;

  // Barre de progression : couleur du filament, contour si trop clair
  const lum = luminance((c1||"").replace("#",""));
  const mcType = multicolorType(tray, spoolInfo);
  const barBg = colorBg(colors, mcType);
  // Si filament gris/blanc → fond de la barre plus foncé
  const barTrackColor = "var(--border)";

  return (
    <div onClick={onClick} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4,
      cursor: onClick ? "pointer" : "default" }}>
      {/* Type de filament en haut */}
      <p style={{ fontSize:10, color:"var(--muted)", fontWeight:600, lineHeight:"13px",
        textAlign:"center", whiteSpace:"nowrap" }}>
        {empty ? "" : (material || "—")}
      </p>
      {/* Barre de progression couleur filament */}
      <div style={{ width:48, height:5, background: barTrackColor,
        borderRadius:3, overflow:"hidden",
        boxShadow:"inset 0 0 0 1px rgba(0,0,0,0.08)" }}>
        {!empty && (
          <div style={{ height:"100%", borderRadius:3,
            width:`${Math.max(0,Math.min(100,pct))}%`,
            transition:"width 0.7s",
            boxShadow: lum > 200 ? "inset 0 0 0 1px rgba(0,0,0,0.15)" : lum < 30 ? "inset 0 0 0 1px rgba(255,255,255,0.1)" : "none",
            ...barBg }}/>
        )}
      </div>
      {/* Bobine SVG */}
      <div style={{ position:"relative",
        transform: isActive ? "scale(1.06)" : "scale(1)", transition:"transform 0.3s" }}>
        <SpoolSVG colors={empty?null:colors} empty={empty} size={68} active={isActive} type={mcType}/>
        {/* Label slot */}
        <div style={{ position:"absolute", bottom:10, left:"50%",
          transform:"translateX(-50%)", padding:"1px 7px", borderRadius:20,
          fontSize:9, fontWeight:700, whiteSpace:"nowrap",
          background: isActive ? "#3b82f6" : "rgba(0,0,0,0.55)",
          color: "white",
          opacity: isActive ? 1 : 0.85,
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }}>
          {label}
        </div>
        {tray.match_mode && !empty && (
          <span style={{ position:"absolute", top:2, right:2 }}>
            <MatchIcon mode={tray.match_mode} size={12}/>
          </span>
        )}
      </div>
      <p style={{ fontSize:9, color:"var(--muted)", fontFamily:"monospace" }}>
        {empty ? "" : wLabel}
      </p>
      <p style={{ fontSize:9, color:"var(--text2)", textAlign:"center",
        whiteSpace:"normal", wordBreak:"break-word", maxWidth:80, lineHeight:"12px" }}>
        {empty ? "Vide" : (name || "")}
      </p>
    </div>
  );
}



// ── Détail AMS ─────────────────────────────────────────────────────────────
function AMSDetail({ ams, activeAmsId, activeTrayId, spoolLookup, onTrayClick }) {
  const isActive = ams.id===activeAmsId;
  const isDrying = ams.is_drying || ams.dry_time > 0;
  const getInfo = t => t.spool_info ?? null;

  const fmtMins = (mins) => {
    if (!mins) return "";
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}h${m > 0 ? " " + m + "min" : ""}` : `${m}min`;
  };

  return (
    <div className="card" style={{ padding:16,
      borderColor: isDrying ? "rgba(249,115,22,0.35)" : isActive ? "rgba(59,130,246,0.3)" : undefined,
      boxShadow: isDrying ? "0 0 0 1px rgba(249,115,22,0.1)" : isActive ? "0 0 0 1px rgba(59,130,246,0.1)" : undefined }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isDrying ? 10 : 16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, fontWeight:700, letterSpacing:"0.06em", color: isDrying?"#f97316":isActive?"#3b82f6":"var(--muted)" }}>
            {AMS_NAMES[ams.id] ?? `AMS ${ams.id+1}`}
          </span>
          {isActive && !isDrying && <span style={{ width:6, height:6, borderRadius:"50%", backgroundColor:"#3b82f6", animation:"livePulse 2s infinite" }} />}
          {isDrying && (
            <span style={{
              display:"inline-flex", alignItems:"center", justifyContent:"center",
              width:20, height:20, borderRadius:"50%",
              background:"rgba(249,115,22,0.15)",
              boxShadow:"0 0 0 0 rgba(249,115,22,0.4)",
              animation:"dryPulse 2.5s ease-in-out infinite",
            }}>
              <Thermometer size={13} style={{ color:"#f97316" }}/>
            </span>
          )}
        </div>
        <div style={{ display:"flex", gap:12, fontSize:10, color:"var(--muted)" }}>
          <span style={{ display:"flex", alignItems:"center", gap:3 }}><Droplets size={10}/>{ams.humidity}%</span>
          <span style={{ display:"flex", alignItems:"center", gap:3, color: isDrying ? "#f97316" : "var(--muted)" }}>
            <Sun size={10}/>{ams.temp?.toFixed(1)}°C{isDrying && ams.dry_temperature ? ` → ${ams.dry_temperature}°C` : ""}
          </span>
        </div>
      </div>

      {/* Bandeau séchage */}
      {isDrying && (
        <div style={{ marginBottom:14, padding:"10px 12px", borderRadius:10,
          background:"rgba(249,115,22,0.07)", border:"1px solid rgba(249,115,22,0.25)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
            <span style={{ fontSize:12, fontWeight:700, color:"#f97316" }}>Séchage en cours</span>
          </div>
          <div style={{ display:"flex", gap:16, flexWrap:"wrap", fontSize:11, color:"var(--text)" }}>
            {ams.dry_temperature > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:4 }}><Thermometer size={12} style={{ color:"#f97316", flexShrink:0 }}/> Température : <b>{ams.dry_temperature}°C</b></span>
            )}
            {ams.dry_duration > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:4 }}><Timer size={12} style={{ color:"var(--muted)", flexShrink:0 }}/> Durée : <b>{ams.dry_duration}h</b></span>
            )}
            {ams.dry_time > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:4 }}><Clock size={12} style={{ color:"#f97316", flexShrink:0 }}/> Restant : <b style={{ color:"#f97316" }}>{fmtMins(ams.dry_time)}</b></span>
            )}
            {ams.dry_filament && (
              <span style={{ display:"flex", alignItems:"center", gap:4 }}><Package size={12} style={{ color:"var(--muted)", flexShrink:0 }}/> Filament : <b>{ams.dry_filament}</b></span>
            )}
          </div>
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4 }}>
        {ams.trays.map(t => (
          <TrayCard key={t.id} tray={t} amsId={ams.id}
            label={`${AMS_NAMES[ams.id]?.slice(-1)??ams.id+1}${t.id+1}`}
            activeAmsId={activeAmsId} activeTrayId={activeTrayId}
            spoolInfo={getInfo(t)}
            onClick={()=>onTrayClick&&onTrayClick({tray:t,amsLabel:AMS_NAMES[ams.id]||`AMS-${ams.id+1}`})}
          />
        ))}
      </div>
    </div>
  );
}


const MATCH_LABEL = {
  rfid:     { text:"RFID Bambu",   color:"#22c55e" },
  auto:     { text:"Auto",         color:"#f59e0b" },
  notfound: { text:"Introuvable",  color:"#ef4444" },
  manual:   { text:"Manuel",       color:"#94a3b8" },
};

function TrayBottomSheet({ tray, amsLabel, onClose }) {
  if (!tray) return null;
  const color  = hexDisplay(tray.color);
  const info   = tray.spool_info;
  const match  = MATCH_LABEL[tray.match_mode];
  const pct    = tray.remain ?? 0;
  const isEmpty = tray.empty || !tray.filament_type;
  const [mapOpen, setMapOpen] = React.useState(false);

  const Row = ({ label, value, mono }) => (value == null || value === "") ? null : (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
      padding:"7px 0", borderBottom:"1px solid var(--border)" }}>
      <span style={{ fontSize:12, color:"var(--muted)", flexShrink:0 }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:600, color:"var(--text)",
        fontFamily: mono ? "JetBrains Mono,monospace" : "inherit",
        textAlign:"right", marginLeft:12 }}>{value}</span>
    </div>
  );

  return (
    <>
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
      zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
          width:"100%", maxWidth:540, maxHeight:"88dvh", overflowY:"auto",
          paddingBottom:"env(safe-area-inset-bottom,16px)" }}>
        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
        </div>
        <div style={{ padding:"16px 20px 24px" }}>
          {/* En-tête */}
          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
            <div style={{ width:60, height:60, borderRadius:14, flexShrink:0, overflow:"hidden",
              boxShadow:"0 2px 12px rgba(0,0,0,0.25), inset 0 0 0 2px var(--border)",
              ...(isEmpty ? { backgroundColor:"var(--border)" } : colorBg(parseColors(tray, info), multicolorType(tray, info))) }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:19, fontWeight:800, color:"var(--text)", margin:0,
                letterSpacing:"-0.01em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {info?.name || tray.filament_type || "Slot vide"}
              </p>
              <p style={{ fontSize:12, color:"var(--muted)", margin:"4px 0 0" }}>
                {amsLabel} · Slot {tray.id + 1}
                {tray.tray_id_name ? ` · ${tray.tray_id_name}` : ""}
              </p>
              {tray.uuid && tray.uuid !== "00000000" && (
                <p style={{ fontSize:10, color:"var(--muted)", margin:"2px 0 0", fontFamily:"monospace" }}>
                  UUID: {tray.uuid}
                </p>
              )}
            </div>
          </div>

          {isEmpty ? (
            <p style={{ color:"var(--muted)", fontSize:14, textAlign:"center", padding:"24px 0" }}>Slot vide</p>
          ) : (<>
            {/* Jauge restant */}
            {pct > 0 && (
              <div style={{ marginBottom:20 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{ fontSize:12, color:"var(--muted)" }}>Restant estimé</span>
                  <span style={{ fontSize:14, fontWeight:700, fontFamily:"monospace",
                    color: pct<20?"#ef4444":pct<40?"#f59e0b":"#22c55e" }}>
                    {pct}%{info?.remaining_weight_g ? ` · ${info.remaining_weight_g.toFixed(0)}g` : ""}
                  </span>
                </div>
                <div style={{ height:10, borderRadius:5, background:"var(--border)", overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${pct}%`, borderRadius:5, transition:"width 0.5s",
                    background: pct<20?"#ef4444":pct<40?"#f59e0b":"#22c55e" }}/>
                </div>
              </div>
            )}

            {/* Badge détection */}
            {match && (
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16,
                padding:"9px 12px", borderRadius:10, background:`${match.color}14`,
                border:`1px solid ${match.color}35` }}>
                <MatchIcon mode={tray.match_mode} size={14}/>
                <span style={{ fontSize:12, color:match.color, fontWeight:600 }}>
                  {match.text}
                  {info?.found_mode && info.found_mode !== tray.match_mode && (
                    <span style={{ color:"var(--muted)", fontWeight:400, marginLeft:4 }}>
                      (DB: {info.found_mode})
                    </span>
                  )}
                </span>
                {tray.match_mode === "notfound" && (
                  <button onClick={() => setMapOpen(true)}
                    style={{ marginLeft:"auto", padding:"5px 10px", borderRadius:8, fontSize:11,
                      fontWeight:700, background:"#3b82f6", color:"white", border:"none", cursor:"pointer" }}>
                    Mapper / Créer
                  </button>
                )}
              </div>
            )}

            {/* ── Section MQTT (données temps réel imprimante) ── */}
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
              letterSpacing:"0.08em", margin:"0 0 4px" }}>Données imprimante (temps réel)</p>
            <Row label="Type"          value={tray.filament_type}/>
            <Row label="Couleur"       value={(() => { const arr = (info?.colors_array||tray?.colors_array||"").split(",").filter(Boolean); return arr.length > 1 ? arr.map(hexDisplay).filter(Boolean).join(" / ") : color; })()} mono/>
            <Row label="Profile ID"    value={tray.tray_info_idx || tray.tray_id_name}/>
            <Row label="Tag UID (RFID)"value={tray.tag_uid && !tray.tag_uid.match(/^0+$/) ? tray.tag_uid : null} mono/>
            <Row label="Restant"       value={`${tray.remain}%`}/>
            <Row label="UUID tray"     value={tray.uuid && !tray.uuid.match(/^0+$/) ? tray.uuid : null} mono/>

            {/* ── Section DB (bobine liée) ── */}
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
              letterSpacing:"0.08em", margin:"16px 0 4px" }}>Bobine liée en base</p>
            {info ? (<>
              <Row label="Nom"             value={info.name}/>
              <Row label="Nom traduit"     value={info.translated_name}/>
              <Row label="Marque"          value={info.brand}/>
              <Row label="Matière"         value={info.material}/>
              <Row label="Profile ID"      value={info.profile_id} mono/>
              <Row label="Multicolor"      value={info.multicolor_type !== "monochrome" ? info.multicolor_type : null}/>
              <Row label="Poids bobine"    value={info.initial_weight_g ? `${info.initial_weight_g}g` : null}/>
              <Row label="Poids support"   value={info.spool_weight_g ? `${info.spool_weight_g}g` : null}/>
              <Row label="Restant"         value={info.remaining_weight_g ? `${Math.round(info.remaining_weight_g)}g` : null}/>
              <Row label="Prix catalogue"  value={info.price ? `${Number(info.price).toFixed(2)}€` : null}/>
              <Row label="Prix achat"      value={info.price_override ? `${Number(info.price_override).toFixed(2)}€` : null}/>
              <Row label="Emplacement"     value={info.location}/>
              <Row label="Tag NFC"         value={info.tag_number} mono/>
              <Row label="Tray AMS"        value={info.ams_tray}/>
              <Row label="Commentaire"     value={info.comment}/>
              <Row label="ID externe"      value={info.external_spool_id} mono/>
              <Row label="Première util."  value={info.first_used_at?.slice(0,10)}/>
              <Row label="Dernière util."  value={info.last_used_at?.slice(0,10)}/>
              <Row label="Bobine #"        value={`${tray.spool_id}`} mono/>
            </>) : (
              <p style={{ fontSize:12, color:"#f59e0b", fontStyle:"italic", padding:"4px 0" }}>
                {tray.spool_id
                  ? `Bobine #${tray.spool_id} — données non chargées`
                  : "Aucune bobine mappée — matching en attente"}
              </p>
            )}

            {/* Séchage */}
            {tray.drying_temp > 0 && (
              <div style={{ marginTop:14, padding:"10px 14px", borderRadius:10,
                background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.25)" }}>
                <p style={{ fontSize:11, color:"#f59e0b", fontWeight:700, margin:"0 0 4px",
                  textTransform:"uppercase", letterSpacing:"0.05em" }}>🌡 Séchage</p>
                <p style={{ fontSize:12, color:"var(--text)", margin:0 }}>
                  {tray.drying_temp}°C · {tray.drying_time}min
                </p>
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>
    {mapOpen && (
      <MapTraySheet tray={tray} onClose={() => setMapOpen(false)} onMapped={() => { setMapOpen(false); onClose(); }}/>
    )}
    </>
  );
}

// ── Mapper / Créer une bobine pour un tray non reconnu ────────────────────
function MapTraySheet({ tray, onClose, onMapped }) {
  const isBambu = Boolean(tray.tray_info_idx);
  const [mode, setMode] = React.useState(isBambu ? "suggest" : "create");
  const [spools, setSpools] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const hasRfid = Boolean(tray.uuid && !/^0+$/.test(tray.uuid));
  const [catalogInfo, setCatalogInfo] = React.useState(null); // entrée catalogue Bambu
  const [form, setForm] = React.useState({
    name: "",
    material: tray.filament_type || "PLA Basic",
    manufacturer: (isBambu && hasRfid) ? "Bambu Lab" : "",
    weight: "1000",
  });

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (tray.color) params.set("color", tray.color);
    params.set("tray_has_rfid", hasRfid ? "true" : "false");

    const spoolsP = client.get("/filaments/map-tray/suggest?" + params)
      .then(r => setSpools(r.data?.spools || []))
      .catch(() => setSpools([]));

    // Rechercher dans le catalogue Bambu pour pré-remplir le formulaire de création
    const catalogParams = {};
    if (tray.tray_info_idx) catalogParams.fila_type = tray.filament_type;
    if (tray.color) {
      // Extraire le color_code depuis le tray (ex: depuis fila_color_code / tray_info)
      // On cherche par type d'abord puis on filtre par couleur dans le résultat
      catalogParams.fila_type = tray.filament_type;
      catalogParams.lang = "fr";
    }
    const catalogP = (tray.tray_info_idx && tray.color)
      ? client.get("/filaments/catalog/search", { params: { fila_type: tray.filament_type, lang:"fr" } })
          .then(r => {
            const color6 = (tray.color || "").toLowerCase().slice(0,6); // 6 chars suffisent pour la recherche couleur
            const match = (r.data?.entries || []).find(e =>
              e.color_hex?.toLowerCase() === color6 || e.fila_id === tray.tray_info_idx
            );
            if (match) {
              setCatalogInfo(match);
              setForm(f => ({
                ...f,
                name: match.name,
                material: match.fila_type,
                manufacturer: "Bambu Lab",
              }));
            }
          }).catch(() => {})
      : Promise.resolve();

    Promise.all([spoolsP, catalogP]).finally(() => setLoading(false));
  }, []);

  const [result, setResult] = React.useState(null); // réponse backend après action

  const link = async (spool_id) => {
    setSaving(true);
    try {
      const r = await client.post("/filaments/map-tray/link", {
        spool_id, tray_uuid: tray.uuid, profile_id: tray.tray_info_idx, color: tray.color,
      });
      setResult(r.data);
    } finally { setSaving(false); }
  };

  const create = async () => {
    setSaving(true);
    try {
      const r = await client.post("/filaments/map-tray/create", {
        tray_uuid: tray.uuid, profile_id: tray.tray_info_idx, color: tray.color,
        material: form.material, name: form.name,
        manufacturer: form.manufacturer || undefined,
        weight: Number(form.weight) || 1000,
      });
      setResult(r.data);
    } finally { setSaving(false); }
  };

  const inputStyle = { width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
    borderRadius:8, padding:"8px 10px", fontSize:13, color:"var(--text)", outline:"none",
    boxSizing:"border-box" };
  const labelStyle = { fontSize:11, color:"var(--muted)", margin:"0 0 4px", display:"block" };

  if (result) return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1100,
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:540, paddingBottom:"env(safe-area-inset-bottom,16px)" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 4px" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
        </div>
        <div style={{ padding:"16px 20px 24px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
            <div style={{ width:36, height:36, borderRadius:"50%", background:"rgba(34,197,94,0.12)",
              border:"1px solid rgba(34,197,94,0.4)", display:"flex", alignItems:"center",
              justifyContent:"center", fontSize:18, flexShrink:0 }}>✓</div>
            <div>
              <p style={{ fontSize:16, fontWeight:800, color:"var(--text)", margin:0 }}>
                {result.action === "mapped" ? "Filament mappé" : "Bobine créée"}
              </p>
              <p style={{ fontSize:12, color:"var(--muted)", margin:0 }}>{result.filament_name}</p>
            </div>
          </div>
          <div style={{ background:"var(--surface2)", borderRadius:10, padding:"10px 14px", marginBottom:18 }}>
            {(result.changes || []).map((c, i) => (
              <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"5px 0",
                borderTop: i>0 ? "1px solid var(--border)" : "none" }}>
                <span style={{ color:"#22c55e", fontSize:12, flexShrink:0, marginTop:1 }}>→</span>
                <span style={{ fontSize:12, color:"var(--text)" }}>{c}</span>
              </div>
            ))}
          </div>
          <button onClick={onMapped}
            style={{ width:"100%", padding:"11px", borderRadius:10, background:"#3b82f6",
              color:"white", border:"none", fontSize:13, fontWeight:700, cursor:"pointer" }}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1100,
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:540, maxHeight:"88dvh", overflowY:"auto",
        paddingBottom:"env(safe-area-inset-bottom,16px)", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 4px" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
        </div>
        <div style={{ padding:"12px 20px 20px" }}>
          <h3 style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:"0 0 4px" }}>
            {isBambu ? "Mapper ce filament Bambu" : "Créer une bobine"}
          </h3>
          <p style={{ fontSize:11, color:"var(--muted)", margin:"0 0 14px" }}>
            {tray.filament_type || "Type inconnu"}
            {tray.color ? ` · ${hexDisplay(tray.color) || ('#'+tray.color)}` : ""}
            {tray.tray_info_idx ? ` · ${tray.tray_info_idx}` : ""}
            {tray.uuid && !/^0+$/.test(tray.uuid) ? ` · 🔖 ${tray.uuid.slice(0,8)}…` : ""}
          </p>

          {/* Toggle — seulement pour les Bambu */}
          {isBambu && (
            <div style={{ display:"flex", gap:6, marginBottom:16 }}>
              {[["suggest","Choisir une bobine existante"],["create","Créer"]].map(([id,label]) => (
                <button key={id} onClick={() => setMode(id)} style={{
                  padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
                  background: mode===id ? "#3b82f6" : "var(--surface2)",
                  color: mode===id ? "white" : "var(--muted)",
                  border:"1px solid var(--border)", whiteSpace:"nowrap",
                }}>{label}</button>
              ))}
            </div>
          )}

          {mode === "suggest" && (
            loading
              ? <p style={{ color:"var(--muted)", fontSize:13 }}>Recherche des bobines sans RFID…</p>
              : spools.length === 0
                ? <p style={{ color:"var(--muted)", fontSize:13 }}>
                    Aucune bobine sans tag RFID trouvée.<br/>
                    <span style={{ fontSize:11 }}>Passe en mode « Créer » pour en créer une.</span>
                  </p>
                : spools.map(s => (
                  <button key={s.id}
                    disabled={saving}
                    onClick={() => link(s.id)}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px",
                      borderRadius:10, border:"1px solid var(--border)", background:"var(--surface2)",
                      marginBottom:8, cursor: saving ? "default" : "pointer",
                      opacity: saving ? 0.6 : 1, textAlign:"left" }}>
                    <div style={{ width:32, height:32, borderRadius:8, flexShrink:0,
                      backgroundColor: s.filament_color ? `#${s.filament_color}` : "var(--border)" }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:13, fontWeight:700, color:"var(--text)", margin:0,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.filament_name}</p>
                      <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>
                        {[s.filament_manufacturer, s.filament_material].filter(Boolean).join(" · ")}
                        {s.remaining_weight_g ? ` · ${Math.round(s.remaining_weight_g)}g` : ""}
                      </p>
                    </div>
                    <span style={{ fontSize:10, color:"#3b82f6", fontWeight:700, flexShrink:0 }}>
                      {saving ? "…" : "Associer →"}
                    </span>
                  </button>
                ))
          )}

          {mode === "create" && (<>
            {catalogInfo && (
              <div style={{ marginBottom:12, padding:"8px 12px", borderRadius:10,
                background:"rgba(59,130,246,0.06)", border:"1px solid rgba(59,130,246,0.2)",
                display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:24, height:24, borderRadius:5, flexShrink:0,
                  background: `#${catalogInfo.color_hex || "888"}` }}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:12, fontWeight:700, color:"#60a5fa", margin:0 }}>
                    📦 {catalogInfo.name} — {catalogInfo.fila_type}
                  </p>
                  <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>
                    {catalogInfo.fila_id} · {catalogInfo.color_code}
                  </p>
                </div>
              </div>
            )}
            <div style={{ marginBottom:10 }}>
              <label style={labelStyle}>Nom de la couleur</label>
              <input style={inputStyle} value={form.name} autoFocus placeholder="ex: Jade White"
                onChange={e => setForm(f => ({...f, name: e.target.value}))}/>
            </div>
            <div style={{ marginBottom:10 }}>
              <label style={labelStyle}>Matière (PLA, PETG, ABS…)</label>
              <input style={inputStyle} value={form.material}
                onChange={e => setForm(f => ({...f, material: e.target.value}))}/>
            </div>
            <div style={{ marginBottom:10 }}>
              <label style={labelStyle}>Marque</label>
              <input style={inputStyle} value={form.manufacturer}
                onChange={e => setForm(f => ({...f, manufacturer: e.target.value}))}/>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={labelStyle}>Poids total (g)</label>
              <input style={inputStyle} type="number" value={form.weight}
                onChange={e => setForm(f => ({...f, weight: e.target.value}))}/>
            </div>
            <button onClick={create} disabled={saving}
              style={{ width:"100%", padding:"11px", borderRadius:10,
                background: saving ? "var(--border)" : "#3b82f6",
                color:"white", border:"none", fontSize:13, fontWeight:700,
                cursor: saving ? "default" : "pointer" }}>
              {saving ? "Création…" : "Créer le filament et la bobine"}
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}


// ── Section principale ─────────────────────────────────────────────────────
export { AMSBox, AMSDetail, TrayBottomSheet, AMS_NAMES };

export default function AMSSection({ amsList, activeAmsId, activeTrayId, spoolLookup }) {
  // Dédupliquer par id au cas où le polling enverrait des doublons
  const uniqueAmsList = amsList ? [...new Map(amsList.map(a=>[a.id,a])).values()] : [];
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTray, setSelectedTray] = useState(null);
  if (!uniqueAmsList?.length) return (
    <div className="card" style={{ padding:24, textAlign:"center", color:"var(--muted)", fontSize:14 }}>Aucun AMS détecté</div>
  );
  const autoId = activeAmsId >= 0 ? activeAmsId : uniqueAmsList[0]?.id ?? 0;
  const displayId = selectedId !== null ? selectedId : autoId;
  const displayAms = uniqueAmsList.find(a=>a.id===displayId) ?? uniqueAmsList[0];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Sélecteur */}
      <div className="card" style={{ padding:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(uniqueAmsList.length,4)},1fr)`, gap:12 }}>
          {uniqueAmsList.map(ams => (
            <AMSBox key={ams.id} ams={ams} activeAmsId={activeAmsId} activeTrayId={activeTrayId}
              isSelected={ams.id===displayId}
              onClick={() => setSelectedId(p => p===ams.id ? null : ams.id)}
              spoolLookup={spoolLookup}
            />
          ))}
        </div>
      </div>
      {/* Détail */}
      {displayAms && <AMSDetail ams={displayAms} activeAmsId={activeAmsId} activeTrayId={activeTrayId} spoolLookup={spoolLookup} onTrayClick={setSelectedTray}/>}
      {selectedTray && <TrayBottomSheet tray={selectedTray.tray} amsLabel={selectedTray.amsLabel} onClose={()=>setSelectedTray(null)}/>}
    </div>
  );
}
