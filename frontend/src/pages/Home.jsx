import React, { useEffect, useState, useCallback } from "react";
import { usePrinter } from "../store/printer";
import { Wifi, WifiOff, Clock, Layers, Thermometer, Wind, Droplets, Sun } from "lucide-react";
import client from "../api/client";
import AMSSection from "../components/AMSSection";

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

// ── Status Banner ──────────────────────────────────────────────────────────
const STATUS_CFG = {
  RUNNING: { label:"En cours",    color:"#3b82f6", dot:"#60a5fa" },
  PAUSE:   { label:"En pause",    color:"#f59e0b", dot:"#fbbf24" },
  FINISH:  { label:"Terminé",     color:"#22c55e", dot:"#4ade80" },
  FAILED:  { label:"Erreur",      color:"#ef4444", dot:"#f87171" },
  IDLE:    { label:"En veille",   color:"#475569", dot:"#64748b" },
  PREPARE: { label:"Préparation", color:"#6366f1", dot:"#818cf8" },
};

function StatusBanner({ status }) {
  if (!status) return <div className="card" style={{ height:56, animation:"pulse 2s infinite" }} />;
  const cfg = STATUS_CFG[status.status] ?? STATUS_CFG.IDLE;
  const pct = status.progress ?? 0;
  const isRunning = status.status === "RUNNING";
  const remain = fmtTime(status.remaining_minutes);

  return (
    <div className="card" style={{ position:"relative", overflow:"hidden" }}>
      {isRunning && (
        <div style={{ position:"absolute", inset:0, background:`linear-gradient(90deg, ${cfg.color}18, transparent)`, width:`${pct}%`, transition:"width 1s", pointerEvents:"none" }} />
      )}
      <div style={{ position:"relative", display:"flex", alignItems:"center", gap:12, padding:"12px 16px" }}>
        <div style={{ width:8, height:8, borderRadius:"50%", backgroundColor:cfg.dot, flexShrink:0, animation: isRunning ? "livePulse 2s infinite" : "none" }} />
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ fontWeight:600, fontSize:14, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {isRunning && status.print_name ? status.print_name : cfg.label}
          </p>
          {isRunning && status.print_name && (
            <p style={{ fontSize:11, color:"var(--muted)" }}>{cfg.label}</p>
          )}
        </div>
        {isRunning && (
          <div style={{ display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
            {remain && <span style={{ fontSize:12, color:"var(--muted)", display:"flex", alignItems:"center", gap:4 }}><Clock size={11}/>{remain}</span>}
            {status.total_layers > 0 && <span style={{ fontSize:12, color:"var(--muted)", display:"flex", alignItems:"center", gap:4 }}><Layers size={11}/>{status.layer}/{status.total_layers}</span>}
            <span style={{ fontSize:20, fontWeight:700, fontFamily:"monospace", color:cfg.color }}>{pct}%</span>
          </div>
        )}
        {status.connected
          ? <Wifi size={15} style={{ color:"#22c55e", flexShrink:0 }} />
          : <WifiOff size={15} style={{ color:"#ef4444", flexShrink:0 }} />}
      </div>
    </div>
  );
}

// ── Températures ───────────────────────────────────────────────────────────
function TempCard({ label, current, target, accent, icon: Icon, active }) {
  const hot = current > 40;
  const heating = target > 0 && current < target - 3;
  return (
    <div className="card-sm" style={{ padding:12, display:"flex", flexDirection:"column", gap:4, position:"relative", overflow:"hidden", borderColor: active ? "rgba(59,130,246,0.4)" : undefined }}>
      {active && <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:"linear-gradient(90deg,transparent,#3b82f6,transparent)" }} />}
      <div style={{ display:"flex", alignItems:"center", gap:4, color:"var(--muted)", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <Icon size={11} />
          <span style={{ fontSize:10, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</span>
        </div>
        {active && <span style={{ fontSize:9, color:"#3b82f6", fontWeight:700 }}>ACTIF</span>}
      </div>
      <div style={{ display:"flex", alignItems:"flex-end", gap:4 }}>
        <span style={{ fontSize:26, fontWeight:700, fontFamily:"monospace", lineHeight:1, color: current === 0 ? "var(--muted)" : hot ? (accent||"#fb923c") : "var(--text)" }}>
          {current > 0 ? Math.round(current) : "—"}
        </span>
        <span style={{ fontSize:12, color:"var(--muted)", marginBottom:2 }}>°</span>
        {target > 0 && (
          <span style={{ fontSize:12, fontFamily:"monospace", color: heating ? "#f59e0b" : "var(--muted)", marginBottom:2, marginLeft:"auto" }}>
            /{Math.round(target)}°
          </span>
        )}
      </div>
    </div>
  );
}

function PrinterTemps({ status }) {
  if (!status) return <div className="card" style={{ height:96, animation:"pulse 2s infinite" }} />;
  const left  = status.nozzles?.find(n => n.id === 1);
  const right = status.nozzles?.find(n => n.id === 0);
  return (
    <div className="card" style={{ padding:16 }}>
      <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:12 }}>Températures</p>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
        {left  && <TempCard label="Buse Gauche" current={left.temp}  target={left.target}  active={left.active}  icon={Thermometer} />}
        {right && <TempCard label="Buse Droite" current={right.temp} target={right.target} active={right.active} icon={Thermometer} />}
        <TempCard label="Plateau" current={status.bed_temp}     target={status.target_bed_temp} icon={Thermometer} accent="#ef4444" />
        <TempCard label="Chambre" current={status.chamber_temp} target={0}                      icon={Wind} />
      </div>
    </div>
  );
}

// ── Vortek Rack ────────────────────────────────────────────────────────────
function WearBar({ wear }) {
  const pct = Math.round((wear / 255) * 100);
  const color = pct < 40 ? "#22c55e" : pct < 70 ? "#f59e0b" : "#ef4444";
  const filled = Math.ceil((wear / 255) * 5);
  return (
    <div style={{ display:"flex", gap:2 }}>
      {[1,2,3,4,5].map(i => (
        <div key={i} style={{ height:4, flex:1, borderRadius:2, backgroundColor: i <= filled ? color : "var(--border)" }} />
      ))}
    </div>
  );
}

function SlotMini({ slot, num, isOnHead, isSelected, onClick }) {
  const color = hexCss(slot.color);
  const empty = !slot.filament_id;
  return (
    <button onClick={onClick} style={{
      border: `1px solid ${isOnHead ? "rgba(59,130,246,0.6)" : isSelected ? "rgba(255,255,255,0.2)" : "var(--border)"}`,
      borderRadius:10, padding:8, background: isOnHead ? "rgba(59,130,246,0.08)" : isSelected ? "var(--surface2)" : "var(--surface2)",
      display:"flex", flexDirection:"column", gap:4, alignItems:"center", cursor:"pointer", transition:"all 0.15s",
    }}>
      <div style={{ width:22, height:22, borderRadius:6, backgroundColor: color || (empty ? "var(--border)" : "#374151"), border:"1px solid rgba(255,255,255,0.1)" }} />
      <span style={{ fontSize:9, fontFamily:"monospace", fontWeight:700, color:"var(--muted)" }}>{num}</span>
    </button>
  );
}

function SlotDetail({ slot, num, isOnHead }) {
  const color = hexCss(slot.color);
  const empty = !slot.filament_id;
  return (
    <div style={{
      border:`1px solid ${isOnHead ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
      borderRadius:12, padding:16, background: isOnHead ? "rgba(59,130,246,0.05)" : "var(--surface2)",
      display:"flex", flexDirection:"column", gap:12, flex:1,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:40, height:40, borderRadius:10, backgroundColor: color || (empty ? "var(--border)" : "#374151"), border:"1px solid rgba(255,255,255,0.1)", flexShrink:0 }} />
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontWeight:700, fontSize:14, fontFamily:"monospace", color:"var(--text)" }}>Slot {num}</span>
            {isOnHead && <span style={{ fontSize:9, background:"rgba(59,130,246,0.2)", color:"#60a5fa", padding:"2px 8px", borderRadius:20, fontWeight:600 }}>Sur la tête</span>}
          </div>
          <p style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>{slot.nozzle_type || "—"} · {slot.diameter}mm</p>
        </div>
      </div>
      {empty ? (
        <p style={{ fontSize:12, color:"var(--muted)", fontStyle:"italic" }}>Slot vide</p>
      ) : (
        <>
          <div>
            <p style={{ fontSize:10, color:"var(--muted)", marginBottom:4, textTransform:"uppercase", letterSpacing:"0.05em" }}>Filament</p>
            <p style={{ fontSize:14, fontWeight:600, fontFamily:"monospace", color:"var(--text)" }}>{slot.filament_id}</p>
          </div>
          <div>
            <p style={{ fontSize:10, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>Usure</p>
            <WearBar wear={slot.wear} />
            <p style={{ fontSize:10, fontFamily:"monospace", color:"var(--muted)", marginTop:4 }}>{Math.round((slot.wear/255)*100)}%</p>
          </div>
          {slot.print_time > 0 && (
            <div>
              <p style={{ fontSize:10, color:"var(--muted)", marginBottom:4, textTransform:"uppercase", letterSpacing:"0.05em" }}>Temps cumulé</p>
              <p style={{ fontSize:13, fontFamily:"monospace", color:"var(--text2)" }}>{Math.round(slot.print_time/60)}h</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VortekRack({ rack }) {
  const [sel, setSel] = useState(0);
  if (!rack?.hotends?.length) return null;
  const h = rack.hotends.slice(0, 6);
  const top = h.filter((_,i) => i%2===0);
  const bot = h.filter((_,i) => i%2===1);
  const selected = h[sel] ?? h[0];
  const filled = h.filter(s => s.filament_id).length;

  return (
    <div className="card" style={{ padding:16 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em" }}>Rack Vortek</span>
        <span style={{ fontSize:10, fontFamily:"monospace", color:"var(--muted)" }}>{filled}/{h.length} chargés</span>
      </div>
      <div style={{ display:"flex", gap:12 }}>
        {/* Grille */}
        <div style={{ display:"flex", flexDirection:"column", gap:6, flexShrink:0 }}>
          <div style={{ display:"flex", gap:6 }}>
            {top.map((slot,i) => <SlotMini key={slot.id} slot={slot} num={i*2+1} isOnHead={slot.id===rack.active_id} isSelected={sel===i*2} onClick={()=>setSel(i*2)} />)}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {bot.map((slot,i) => <SlotMini key={slot.id} slot={slot} num={i*2+2} isOnHead={slot.id===rack.active_id} isSelected={sel===i*2+1} onClick={()=>setSel(i*2+1)} />)}
          </div>
        </div>
        {/* Détail */}
        <SlotDetail slot={selected} num={sel+1} isOnHead={selected?.id===rack.active_id} />
      </div>
    </div>
  );
}

// ── Page Home ──────────────────────────────────────────────────────────────
export default function Home() {
  const { status, startPolling, stopPolling } = usePrinter();
  const [spoolLookup, setSpoolLookup] = useState({});

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
          filament_name: s.filament_name,
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
    return () => stopPolling();
  }, []);

  const hasRack = (status?.hotend_rack?.hotends?.length ?? 0) > 0;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12, maxWidth:640, margin:"0 auto" }}>
      <StatusBanner status={status} />
      <PrinterTemps status={status} />
      {hasRack && <VortekRack rack={status.hotend_rack} />}
      <AMSSection
        amsList={status?.ams_list ?? []}
        activeAmsId={status?.active_ams_id ?? -1}
        activeTrayId={status?.active_tray_id ?? -1}
        spoolLookup={spoolLookup}
      />
    </div>
  );
}
