import React, { useState } from "react";
import { Droplets, Sun } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────
function hexCss(hex) {
  if (!hex) return null;
  const h = hex.slice(0, 6);
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
  return (r*299+g*587+b*114)/1000;
}
function parseColors(tray, spoolInfo) {
  const arr = spoolInfo?.colors_array || tray?.colors_array;
  if (arr) {
    const cols = arr.split(",").map(c=>c.trim()).filter(Boolean);
    if (cols.length > 1) return cols.map(c=>`#${c.slice(0,6)}`);
  }
  const single = hexCss(spoolInfo?.filament_color || tray?.color);
  return single ? [single] : null;
}
const AMS_NAMES = ["AMS-A","AMS-B","AMS-C","AMS-D"];

// ── Mini pastille ──────────────────────────────────────────────────────────
function ColorPill({ tray, spoolInfo, active }) {
  const colors = parseColors(tray, spoolInfo);
  const bg = colors?.length > 1
    ? { background: `conic-gradient(${colors.map((c,i)=>`${c} ${Math.round(i/colors.length*360)}deg ${Math.round((i+1)/colors.length*360)}deg`).join(",")})` }
    : { backgroundColor: colors?.[0] || "var(--border)" };
  return (
    <div style={{ flex:1, height:28, borderRadius:6, transition:"transform 0.2s",
      transform: active ? "scaleY(1.15)" : "scaleY(1)",
      outline: active ? "2px solid white" : "none",
      outlineOffset:1, position:"relative", ...bg }}>
      {tray.match_mode && (
        <span style={{ position:"absolute", top:2, right:3 }}><MatchIcon mode={tray.match_mode} size={8}/></span>
      )}
    </div>
  );
}

// ── Icône de détection filament ─────────────────────────────────────────────
function MatchIcon({ mode, size = 10 }) {
  if (!mode) return null;
  const cfg = {
    rfid:   { symbol: "⬡", color: "#22c55e", title: "Tag RFID Bambu Lab" },
    color:  { symbol: "◈", color: "#f59e0b", title: "Matching couleur (filament custom)" },
    manual: { symbol: "◇", color: "#94a3b8", title: "Non identifié automatiquement" },
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
  const getInfo = t => spoolLookup?.[t.tag_uid] ?? spoolLookup?.[t.uuid] ?? null;
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
        background: isActive ? "rgba(59,130,246,0.06)" : isSelected ? "var(--surface2)" : "var(--surface2)",
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
  const main = colors?.[0] || (empty ? "#111" : "#333");
  const dark = luminance(main.replace("#","")) < 140;
  const shine = dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.28)";
  const uid = `g${Math.random().toString(36).slice(2,6)}`;
  const multi = colors && colors.length > 1;
  const fill = multi ? `url(#${uid})` : main;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {multi && <defs><linearGradient id={uid} x1="0%" y1="0%" x2="100%" y2="0%">
        {colors.map((c,i)=><stop key={i} offset={`${Math.round(i/(colors.length-1)*100)}%`} stopColor={c}/>)}
      </linearGradient></defs>}
      <ellipse cx="40" cy="75" rx="22" ry="3.5" fill="rgba(0,0,0,0.3)"/>
      <ellipse cx="40" cy="40" rx="28" ry="28" fill={empty?"#1a1a1a":fill}/>
      <ellipse cx="40" cy="40" rx="28" ry="28" fill="rgba(0,0,0,0.15)"/>
      <rect x="19" y="23" width="42" height="34" rx="2" fill={empty?"#111":fill}/>
      {!empty && <rect x="19" y="23" width="42" height="34" rx="2" fill="rgba(0,0,0,0.08)"/>}
      <rect x="19" y="23" width="42" height="9" rx="2" fill={shine}/>
      {!empty && <>
        <rect x="16" y="20" width="4" height="40" rx="2" fill={fill}/>
        <rect x="16" y="20" width="4" height="40" rx="2" fill="rgba(0,0,0,0.2)"/>
        <rect x="60" y="20" width="4" height="40" rx="2" fill={fill}/>
        <rect x="60" y="20" width="4" height="40" rx="2" fill="rgba(0,0,0,0.2)"/>
      </>}
      <circle cx="40" cy="40" r="11" fill="rgba(0,0,0,0.4)"/>
      <circle cx="40" cy="40" r="7" fill="rgba(0,0,0,0.55)"/>
      <circle cx="37" cy="37" r="2" fill="rgba(255,255,255,0.12)"/>
      {active && <ellipse cx="40" cy="40" rx="30" ry="30" stroke="#3b82f6" strokeWidth="2.5" fill="none" strokeDasharray="5 2.5" opacity="0.9">
        <animateTransform attributeName="transform" type="rotate" from="0 40 40" to="360 40 40" dur="8s" repeatCount="indefinite"/>
      </ellipse>}
    </svg>
  );
}

// ── Tray card ──────────────────────────────────────────────────────────────
function TrayCard({ tray, amsId, label, activeAmsId, activeTrayId, spoolInfo, onClick }) {
  const isActive = amsId===activeAmsId && tray.id===activeTrayId;
  const empty = isEmptyTray(tray);
  const colors = parseColors(tray, spoolInfo);
  const name = spoolInfo?.filament_name ?? null;
  const material = spoolInfo?.filament_material ?? tray.filament_type ?? null;
  const hasW = spoolInfo?.remaining_weight_g != null;
  const hasT = spoolInfo?.filament_weight_g != null;
  const pct = hasW && hasT ? Math.round((spoolInfo.remaining_weight_g/spoolInfo.filament_weight_g)*100) : (tray.remain??0);
  const wLabel = hasW ? `${Math.round(spoolInfo.remaining_weight_g)}g` : `${tray.remain}%`;
  const barColor = colors?.length>1
    ? { background:`linear-gradient(90deg,${colors.join(",")})` }
    : { backgroundColor: pct>30 ? (colors?.[0]||"#3b82f6") : "#ef4444" };

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
      <p style={{ fontSize:10, color:"var(--muted)", fontWeight:500, height:16, lineHeight:"16px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:72, textAlign:"center" }}>
        {empty ? "" : (material||"—")}
      </p>
      <div style={{ width:48, height:5, background:"var(--border)", borderRadius:3, overflow:"hidden" }}>
        {!empty && <div style={{ height:"100%", borderRadius:3, width:`${Math.max(0,Math.min(100,pct))}%`, transition:"width 0.7s", ...barColor }} />}
      </div>
      <div style={{ position:"relative", transform: isActive ? "scale(1.06)" : "scale(1)", transition:"transform 0.3s" }}>
        <SpoolSVG colors={empty?null:colors} empty={empty} size={68} active={isActive}/>
        <div style={{ position:"absolute", bottom:10, left:"50%", transform:"translateX(-50%)", padding:"1px 7px", borderRadius:20, fontSize:9, fontWeight:700, whiteSpace:"nowrap", background: isActive?"#3b82f6":"rgba(0,0,0,0.6)", color:"white", opacity: isActive ? 1 : 0.8 }}>
          {label}
        </div>
        {tray.match_mode && !empty && (
          <span style={{ position:"absolute", top:2, right:2 }}><MatchIcon mode={tray.match_mode} size={12}/></span>
        )}
      </div>
      <p style={{ fontSize:9, color:"var(--muted)", fontFamily:"monospace" }}>{empty ? "" : wLabel}</p>
      <p style={{ fontSize:9, color:"var(--text2)", textAlign:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", width:68 }}>
        {empty ? "Vide" : (name||tray.tray_id_name||"—")}
      </p>
    </div>
  );
}

// ── Détail AMS ─────────────────────────────────────────────────────────────
function AMSDetail({ ams, activeAmsId, activeTrayId, spoolLookup, onTrayClick }) {
  const isActive = ams.id===activeAmsId;
  const getInfo = t => spoolLookup?.[t.tag_uid] ?? spoolLookup?.[t.uuid] ?? null;
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
  rfid:   { text:"Tag RFID Bambu Lab",       color:"#22c55e" },
  color:  { text:"Matching couleur (custom)", color:"#f59e0b" },
  manual: { text:"Non identifié",             color:"#94a3b8" },
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
                    color: pct < 20 ? "#ef4444" : pct < 40 ? "#f59e0b" : "#22c55e" }}>
                    {pct}%{info?.remaining_weight_g ? ` · ${info.remaining_weight_g.toFixed(0)}g` : ""}
                  </span>
                </div>
                <div style={{ height:10, borderRadius:5, background:"var(--border)", overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${pct}%`, borderRadius:5, transition:"width 0.5s",
                    background: pct < 20 ? "#ef4444" : pct < 40 ? "#f59e0b" : "#22c55e" }}/>
                </div>
              </div>
            )}

            {/* Badge détection */}
            {match && (
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16,
                padding:"9px 12px", borderRadius:10, background:`${match.color}14`,
                border:`1px solid ${match.color}35` }}>
                <MatchIcon mode={tray.match_mode} size={14}/>
                <span style={{ fontSize:12, color:match.color, fontWeight:600 }}>{match.text}</span>
              </div>
            )}

            {/* Infos */}
            <Row label="Filament"      value={tray.filament_type}/>
            <Row label="Couleur"       value={color} mono/>
            {info ? (<>
              <Row label="Marque"        value={info.brand}/>
              <Row label="Matière"       value={info.material}/>
              <Row label="Poids initial" value={info.initial_weight_g ? `${info.initial_weight_g}g` : null}/>
              <Row label="Prix"          value={info.price ? `${Number(info.price).toFixed(2)}€` : null}/>
              <Row label="Achat"         value={info.purchase_date?.slice(0,10)}/>
              <Row label="Bobine #"      value={`${tray.spool_id}`} mono/>
              {info.notes && <Row label="Notes" value={info.notes}/>}
            </>) : (
              <Row label="Bobine #"  value={tray.spool_id ? `${tray.spool_id}` : "Non mappée"} mono/>
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
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTray, setSelectedTray] = useState(null);
  if (!amsList?.length) return (
    <div className="card" style={{ padding:24, textAlign:"center", color:"var(--muted)", fontSize:14 }}>Aucun AMS détecté</div>
  );
  const autoId = activeAmsId >= 0 ? activeAmsId : amsList[0]?.id ?? 0;
  const displayId = selectedId !== null ? selectedId : autoId;
  const displayAms = amsList.find(a=>a.id===displayId) ?? amsList[0];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Sélecteur */}
      <div className="card" style={{ padding:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(amsList.length,4)},1fr)`, gap:12 }}>
          {amsList.map(ams => (
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
