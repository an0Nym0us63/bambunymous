import React, { useState } from "react";
import { Droplets, Sun } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────
function hexCss(hex) {
  if (!hex) return null;
  const h = hex.replace(/^#/, "").slice(0, 6);
  if (h.replace(/0/g,"") === "") return null;
  return `#${h}`;
}
function isEmptyTray(tray) {
  if (tray.empty) return true;
  return (tray.uuid||"").replace(/0/g,"") === "" && (tray.color||"").replace(/[0F]/gi,"") === "";
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
    if (cols.length > 1) return cols.map(c=>`#${c.replace(/^#/,"").slice(0,6)}`);
  }
  // 2. couleur simple
  const single = hexCss(spoolInfo?.color || spoolInfo?.filament_color || tray?.color);
  return single ? [single] : null;
}

// Génère le style background pour n couleurs
function colorBg(colors) {
  if (!colors?.length) return { backgroundColor: "var(--border)" };
  if (colors.length === 1) return { backgroundColor: colors[0] };
  // Gradient linéaire pour multicolore
  const stops = colors.map((c,i)=>{
    const a = Math.round(i/colors.length*100);
    const b = Math.round((i+1)/colors.length*100);
    return `${c} ${a}%, ${c} ${b}%`;
  }).join(", ");
  return { background: `linear-gradient(90deg, ${stops})` };
}

const AMS_NAMES = ["AMS-A","AMS-B","AMS-C","AMS-D"];

// ── Mini pastille ──────────────────────────────────────────────────────────
function ColorPill({ tray, spoolInfo, active }) {
  const colors = parseColors(tray, spoolInfo);
  const c1 = colors?.[0];
  const bg = colorBg(colors);
  // Contour léger pour les couleurs claires/blanches
  const lum = luminance((c1||"").replace("#",""));
  const outline = active
    ? "2px solid white"
    : lum > 200 ? "1px solid rgba(0,0,0,0.15)" : "1px solid rgba(255,255,255,0.1)";
  return (
    <div style={{ flex:1, height:28, borderRadius:6, transition:"transform 0.2s",
      transform: active ? "scaleY(1.15)" : "scaleY(1)",
      outline, outlineOffset: active ? 1 : 0, position:"relative", ...bg }}>
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
    rfid:   { symbol: "⬡", color: "#22c55e", title: "Reconnu par RFID Bambu" },
    auto:   { symbol: "◈", color: "#f59e0b", title: "Reconnu automatiquement" },
    manual: { symbol: "◇", color: "#94a3b8", title: "Non identifié" },
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
  const getInfo = t => t.spool_info ?? null;
  return (
    <button onClick={onClick} style={{
      display:"flex", flexDirection:"column", alignItems:"center", gap:6,
      background:"none", border:"none", cursor:"pointer", width:"100%", padding:0,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", color: isActive ? "#3b82f6" : isSelected ? "var(--text)" : "var(--muted)" }}>
          {AMS_NAMES[ams.id] ?? `AMS ${ams.id+1}`}
        </span>
        {isActive && <span style={{ width:6, height:6, borderRadius:"50%", backgroundColor:"#3b82f6", animation:"livePulse 2s infinite" }} />}
      </div>
      <div style={{
        width:"100%", borderRadius:12, padding:6, display:"flex", gap:4,
        border:`1px solid ${isActive ? "rgba(59,130,246,0.4)" : isSelected ? "rgba(255,255,255,0.2)" : "var(--border)"}`,
        background: isActive ? "rgba(59,130,246,0.06)" : "var(--surface2)",
        boxShadow: isActive ? "0 4px 16px rgba(59,130,246,0.15)" : "none",
        transition:"all 0.2s",
      }}>
        {ams.trays.map(t => <ColorPill key={t.id} tray={t} spoolInfo={getInfo(t)} active={isActive && t.id===activeTrayId} />)}
      </div>
      <div style={{ display:"flex", gap:8, fontSize:9, color:"var(--muted)" }}>
        <span style={{ display:"flex", alignItems:"center", gap:2 }}><Droplets size={8}/>{ams.humidity}%</span>
        <span style={{ display:"flex", alignItems:"center", gap:2 }}><Sun size={8}/>{ams.temp}°</span>
      </div>
      <div style={{ height:2, borderRadius:1, background: isSelected ? "#3b82f6" : "transparent", width: isSelected ? 32 : 8, transition:"all 0.3s" }} />
    </button>
  );
}

// ── Bobine SVG ─────────────────────────────────────────────────────────────
function SpoolSVG({ colors, empty, size=68, active }) {
  const c1 = colors?.[0] || (empty ? "#1a1a1a" : "#555");
  const multi = colors && colors.length > 1;
  const uid = `sg${Math.random().toString(36).slice(2,7)}`;
  const lum = luminance(c1.replace("#",""));
  const dark = lum < 128;
  const shine    = dark ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.45)";
  const rimShade = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.10)";
  const hubRing  = dark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.30)";
  const fill = empty ? "#222" : multi ? `url(#${uid})` : c1;

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {multi && !empty && (
        <defs>
          <linearGradient id={uid} x1="0%" y1="0%" x2="100%" y2="0%">
            {colors.map((c,i)=>(
              <stop key={i} offset={`${Math.round(i/(colors.length-1)*100)}%`} stopColor={c}/>
            ))}
          </linearGradient>
        </defs>
      )}

      {/* Ombre portée */}
      <ellipse cx="40" cy="76" rx="20" ry="3" fill="rgba(0,0,0,0.22)"/>

      {/* Disque principal */}
      <circle cx="40" cy="40" r="28" fill={fill}/>
      {/* Ombrage bas */}
      <circle cx="40" cy="40" r="28" fill="rgba(0,0,0,0.10)"/>
      {/* Reflet haut-gauche */}
      <ellipse cx="32" cy="26" rx="9" ry="5" fill={shine} opacity="0.7"/>

      {/* Joues latérales — cercles légèrement plus petits */}
      {!empty && <>
        <circle cx="15" cy="40" r="10" fill={fill}/>
        <circle cx="15" cy="40" r="10" fill={rimShade}/>
        <circle cx="65" cy="40" r="10" fill={fill}/>
        <circle cx="65" cy="40" r="10" fill={rimShade}/>
      </>}

      {/* Hub — anneaux concentriques */}
      <circle cx="40" cy="40" r="13" fill="rgba(0,0,0,0.25)" stroke={hubRing} strokeWidth="1"/>
      <circle cx="40" cy="40" r="8"  fill="rgba(0,0,0,0.20)" stroke={hubRing} strokeWidth="1"/>
      <circle cx="40" cy="40" r="4"  fill="rgba(0,0,0,0.55)"/>
      <circle cx="38" cy="38" r="1.5" fill="rgba(255,255,255,0.18)"/>

      {/* Animation impression */}
      {active && (
        <circle cx="40" cy="40" r="30" stroke="#3b82f6" strokeWidth="2.5"
          fill="none" strokeDasharray="5 2.5" opacity="0.9">
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
  const barBg = colorBg(colors);
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
        <SpoolSVG colors={empty?null:colors} empty={empty} size={68} active={isActive}/>
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
  const getInfo = t => t.spool_info ?? null;
  return (
    <div className="card" style={{ padding:16, borderColor: isActive ? "rgba(59,130,246,0.3)" : undefined, boxShadow: isActive ? "0 0 0 1px rgba(59,130,246,0.1)" : undefined }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, fontWeight:700, letterSpacing:"0.06em", color: isActive?"#3b82f6":"var(--muted)" }}>
            {AMS_NAMES[ams.id] ?? `AMS ${ams.id+1}`}
          </span>
          {isActive && <span style={{ width:6, height:6, borderRadius:"50%", backgroundColor:"#3b82f6", animation:"livePulse 2s infinite" }} />}
        </div>
        <div style={{ display:"flex", gap:12, fontSize:10, color:"var(--muted)" }}>
          <span style={{ display:"flex", alignItems:"center", gap:3 }}><Droplets size={10}/>{ams.humidity}%</span>
          <span style={{ display:"flex", alignItems:"center", gap:3 }}><Sun size={10}/>{ams.temp}°C</span>
        </div>
      </div>
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
  rfid:   { text:"RFID Bambu",   color:"#22c55e" },
  auto:   { text:"Auto",         color:"#f59e0b" },
  manual: { text:"Manuel",       color:"#94a3b8" },
};

function TrayBottomSheet({ tray, amsLabel, onClose }) {
  if (!tray) return null;
  const color  = tray.color ? `#${tray.color.slice(0,6)}` : null;
  const info   = tray.spool_info;
  const match  = MATCH_LABEL[tray.match_mode];
  const pct    = tray.remain ?? 0;
  const isEmpty = tray.empty || !tray.filament_type;

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
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
      zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:"var(--surface)", borderRadius:"20px 20px 0 0",
          width:"100%", maxWidth:540, maxHeight:"88dvh", overflowY:"auto",
          paddingBottom:"env(safe-area-inset-bottom,16px)" }}>
        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
        </div>
        <div style={{ padding:"16px 20px 24px" }}>
          {/* En-tête */}
          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
            <div style={{ width:60, height:60, borderRadius:14, flexShrink:0,
              backgroundColor: isEmpty ? "var(--border)" : color || "var(--border)",
              boxShadow:"0 2px 12px rgba(0,0,0,0.25)", border:"2px solid var(--border)" }}/>
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
              </div>
            )}

            {/* ── Section MQTT (données temps réel imprimante) ── */}
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
              letterSpacing:"0.08em", margin:"0 0 4px" }}>Données imprimante (temps réel)</p>
            <Row label="Type"          value={tray.filament_type}/>
            <Row label="Couleur"       value={color} mono/>
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
  );
}

// ── Section principale ─────────────────────────────────────────────────────
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
