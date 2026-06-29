import React, { useEffect, useState, useCallback, useRef } from "react";
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


function HMSBanner({ errors }) {
  if (!errors?.length) return null;
  return (
    <p style={{ fontSize:12, color:"#f59e0b", padding:"4px 8px",
      textAlign:"center", letterSpacing:"0.01em" }}>
      ⚠ {errors.length} alerte{errors.length > 1 ? "s" : ""} HMS imprimante
    </p>
  );
}


function StatusBanner({ status }) {
  const [expanded, setExpanded] = useState(false);
  const camRef      = useRef(null);
  const timerRef    = useRef(null);
  const inFlightRef = useRef(false);

  const stopCam = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    inFlightRef.current = false;
    // Réinitialiser l'image pour éviter l'icône cassée au prochain déploi
    if (camRef.current) { camRef.current.src = ""; }
  };
  const tickCam = () => {
    if (inFlightRef.current || !camRef.current) return;
    inFlightRef.current = true;
    camRef.current.src = `/api/v1/camera/snapshot?t=${Date.now()}`;
  };
  const startCam = () => {
    if (timerRef.current) return;
    tickCam();
    timerRef.current = setInterval(tickCam, 1500);
  };

  const isRunning = status?.status === "RUNNING";
  // Déplier possible même hors impression (pour voir temps, températures)
  useEffect(() => {
    if (expanded) startCam(); else stopCam();
    return stopCam;
  }, [expanded, isRunning]);

  const [printInfo, setPrintInfo] = useState(null);

  // Charger les infos du print en cours (vignette + nom)
  useEffect(() => {
    if (!status?.status) return;
    client.get("/prints?limit=1&status=" + (status.status === "RUNNING" ? "IN_PROGRESS" : "SUCCESS"))
      .then(r => { const p = r.data?.prints?.[0]; if (p) setPrintInfo(p); })
      .catch(() => {});
  }, [status?.status]);

  if (!status) return <div className="card" style={{ height:56, animation:"pulse 2s infinite" }} />;
  const cfg    = STATUS_CFG[status.status] ?? STATUS_CFG.IDLE;
  const pct    = status.progress ?? 0;
  const remain = fmtTime(status.remaining_minutes);
  const left   = status.nozzles?.find(n => n.id === 1);
  const right  = status.nozzles?.find(n => n.id === 0);

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
    <div className="card" style={{ overflow:"hidden" }}>


      {/* Header cliquable */}
      <button onClick={() => setExpanded(e => !e)}
        style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:0, position:"relative", zIndex:1 }}>

        {/* Nom du print — ligne complète en haut */}
        <div style={{ padding:"10px 16px 4px", display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", backgroundColor:cfg.dot, flexShrink:0,
            animation:isRunning?"livePulse 2s infinite":"none" }} />
          <p style={{ fontWeight:700, fontSize:14, color:"var(--text)", margin:0,
            flex:1, textAlign:"left", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"clip" }}>
            {printInfo?.file_name || cfg.label}
          </p>
          {status.connected
            ? <Wifi size={14} style={{ color:"#22c55e", flexShrink:0 }} />
            : <WifiOff size={14} style={{ color:"#ef4444", flexShrink:0 }} />}
        </div>

        {/* Ligne du bas : vignette + infos + % */}
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"4px 16px 12px" }}>
          {/* Vignette plus grande */}
          <div style={{ width:64, height:64, borderRadius:10, overflow:"hidden", flexShrink:0,
            background:"repeating-conic-gradient(var(--surface2) 0% 25%,var(--surface) 0% 50%) 0 0/12px 12px" }}>
            {printInfo?.plate_image && (
              <img src={`/api/v1/prints/${printInfo.id}/image`} alt=""
                style={{ width:"100%", height:"100%", objectFit:"cover" }}
                onError={e => e.currentTarget.style.display="none"}/>
            )}
          </div>
          <div style={{ flex:1, minWidth:0, textAlign:"left" }}>
            <p style={{ fontSize:11, color:"var(--muted)", margin:"0 0 6px" }}>{cfg.label}</p>
            {/* Barre de progression */}
            {isRunning && pct > 0 && (
              <div style={{ marginBottom:6 }}>
                <div style={{ height:6, borderRadius:3, background:"var(--border)", overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${pct}%`,
                    background:`linear-gradient(90deg,${cfg.color},${cfg.color}cc)`,
                    borderRadius:3, transition:"width 1s" }}/>
                </div>
              </div>
            )}
            {isRunning && (
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {remain && <span style={{ fontSize:11, color:"var(--muted)", display:"flex", alignItems:"center", gap:3 }}><Clock size={10}/>{remain}</span>}
                {status.total_layers > 0 && <span style={{ fontSize:11, color:"var(--muted)", display:"flex", alignItems:"center", gap:3 }}><Layers size={10}/>{status.layer}/{status.total_layers}</span>}
              </div>
            )}
          </div>
          {isRunning && (
            <span style={{ fontSize:24, fontWeight:800, fontFamily:"monospace",
              color:cfg.color, flexShrink:0, letterSpacing:"-0.02em" }}>{pct}%</span>
          )}
        </div>
      </button>

      {/* Panneau déplié */}
      {expanded && (
        <div style={{ borderTop:"1px solid var(--border)" }}>
          {/* Caméra */}
          <img ref={camRef} alt="Camera"
            style={{ width:"100%", display:"block", maxHeight:280, objectFit:"cover",
              background:"#111" }}
            onLoad={() => { inFlightRef.current = false; }}
            onError={e => { inFlightRef.current = false; e.currentTarget.style.display="none"; }}
          />
          {/* Températures + infos */}
          <div style={{ padding:12, display:"flex", flexDirection:"column", gap:10 }}>
            {/* Buses */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {left  && <TempChip label="Buse Gauche" current={left.temp}   target={left.target}   active={left.active}  />}
              {right && <TempChip label="Buse Droite" current={right.temp}  target={right.target}  active={right.active} />}
              <TempChip label="Plateau" current={status.bed_temp}     target={status.target_bed_temp} accent="#ef4444" />
              <TempChip label="Chambre" current={status.chamber_temp} target={0} />
            </div>
            {/* Couche + vitesse */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
              {[
                { label:"Couche", value:`${status.layer}/${status.total_layers}` },
                { label:"Restant", value:remain||"—" },
                { label:"Vitesse", value:status.speed_mag ? `${status.speed_mag}%` : "—" },
              ].map(({ label, value }) => (
                <div key={label} style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, padding:"8px 10px" }}>
                  <p style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:2 }}>{label}</p>
                  <p style={{ fontSize:14, fontWeight:700, fontFamily:"monospace", color:"var(--text)" }}>{value}</p>
                </div>
              ))}
            </div>
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

function SlotMini({ slot, num, isOnHead, isSelected, onClick }) {
  const status = slotStatus(slot, isOnHead);
  const color  = status === "loaded" ? `#${slot?.color?.slice(0,6)}` : null;
  const isHead = status === "head";

  return (
    <button onClick={onClick} style={{
      border: `2px solid ${isHead ? "#3b82f6" : isSelected ? "rgba(255,255,255,0.25)" : "var(--border)"}`,
      borderRadius:10, padding:8,
      background: isHead ? "rgba(59,130,246,0.10)" : "var(--surface2)",
      display:"flex", flexDirection:"column", gap:4,
      alignItems:"center", cursor:"pointer", transition:"all 0.15s", minWidth:44,
      boxShadow: isHead ? "0 0 0 3px rgba(59,130,246,0.12)" : "none",
    }}>
      {/* Couleur du slot — vide mais cerclé bleu si sur la tête */}
      <div style={{ width:22, height:22, borderRadius:6,
        backgroundColor: isHead ? "rgba(59,130,246,0.15)" : color || "var(--border)",
        border: isHead ? "1.5px solid #3b82f6" : "1px solid rgba(255,255,255,0.1)",
        display:"flex", alignItems:"center", justifyContent:"center", fontSize:10 }}>
        {isHead && <span style={{ color:"#60a5fa", fontSize:9 }}>↑</span>}
        {status === "empty" && <span style={{ color:"var(--muted)", fontSize:8 }}>—</span>}
      </div>
      {slot?.match_mode && !isHead && status==="loaded" && (
        <span style={{ position:"absolute", top:-2, right:-2, zIndex:1 }}><MatchBadge mode={slot.match_mode}/></span>
      )}
      <span style={{ fontSize:9, fontFamily:"monospace", fontWeight:700,
        color: isHead ? "#60a5fa" : "var(--muted)" }}>{num}</span>
    </button>
  );
}

function SlotDetail({ slot, num, isOnHead, headSlot }) {
  const status = slotStatus(slot, isOnHead);
  const color  = status === "loaded" ? `#${slot?.color?.slice(0,6)}` : null;
  if (!slot) return <div style={{ flex:1 }}/>;

  const borderColor = status === "head" ? "rgba(59,130,246,0.5)" : "var(--border)";
  const bg          = status === "head" ? "rgba(59,130,246,0.06)" : "var(--surface2)";

  const statusBadge = {
    head:    { label:"Buse droite", color:"#60a5fa", bg:"rgba(59,130,246,0.15)" },
    no_fila: { label:"Non chargé",  color:"#f59e0b", bg:"rgba(245,158,11,0.12)" },
    empty:   { label:"Vide",        color:"var(--muted)", bg:"var(--border)" },
    loaded:  null,
  }[status];

  const displaySlot = (status === "head" && headSlot) ? headSlot : slot;

  return (
    <div style={{ border:`2px solid ${borderColor}`, borderRadius:12, padding:16,
      background:bg, display:"flex", flexDirection:"column", gap:12, flex:1,
      boxShadow: status==="head" ? "0 0 0 4px rgba(59,130,246,0.10)" : "none" }}>

      {/* En-tête */}
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:40, height:40, borderRadius:10, flexShrink:0,
          backgroundColor: color || "var(--border)",
          border: status==="head" ? "2px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.1)" }} />
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
            <span style={{ fontWeight:700, fontSize:14, fontFamily:"monospace", color:"var(--text)" }}>Slot {num}</span>
            {statusBadge && (
              <span style={{ fontSize:9, background:statusBadge.bg, color:statusBadge.color,
                padding:"2px 8px", borderRadius:20, fontWeight:600 }}>{statusBadge.label}</span>
            )}
            {slot?.match_mode && status==="loaded" && <MatchBadge mode={slot.match_mode}/>}
          </div>
          <p style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>
            {displaySlot.nozzle_type || "—"} · {displaySlot.diameter}mm
          </p>
        </div>
      </div>

      {/* Contenu selon status */}
      {status === "empty" ? (
        <p style={{ fontSize:12, color:"var(--muted)", fontStyle:"italic" }}>Aucun hotend installé</p>

      ) : status === "head" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <p style={{ fontSize:12, color:"#60a5fa" }}>
            Hotend sorti du rack — monté sur la buse droite
          </p>
          {headSlot && (
            <>
              <div>
                <p style={{ fontSize:10, color:"var(--muted)", marginBottom:4, textTransform:"uppercase", letterSpacing:"0.05em" }}>Sur la tête</p>
                <p style={{ fontSize:14, fontWeight:600, fontFamily:"monospace", color:"#60a5fa" }}>{headSlot.filament_id}</p>
                <p style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>{headSlot.nozzle_type} · {headSlot.diameter}mm</p>
              </div>
              <div>
                <p style={{ fontSize:10, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>Usure</p>
                <WearBar wear={headSlot.wear} />
                <p style={{ fontSize:10, fontFamily:"monospace", color:"var(--muted)", marginTop:4 }}>{Math.round((headSlot.wear/255)*100)}%</p>
              </div>
              {headSlot.print_time > 0 && (
                <p style={{ fontSize:11, fontFamily:"monospace", color:"var(--muted)" }}>{Math.round(headSlot.print_time/60)}h cumulées</p>
              )}
            </>
          )}
        </div>

      ) : status === "no_fila" ? (
        <>
          <p style={{ fontSize:12, color:"#f59e0b", fontStyle:"italic" }}>Hotend installé — filament non chargé</p>
          <div>
            <p style={{ fontSize:10, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>Usure</p>
            <WearBar wear={slot.wear} />
          </div>
        </>

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
            <p style={{ fontSize:11, fontFamily:"monospace", color:"var(--muted)" }}>{Math.round(slot.print_time/60)}h cumulées</p>
          )}
        </>
      )}
    </div>
  );
}


function VortekRack({ rack }) {
  const [sel, setSel] = useState(0);
  if (!rack?.hotends?.length) return null;

  const h = rack.hotends;
  const headId = rack.head_id ?? -1;

  // Mapping physique confirmé:
  // Slot 1→idx2, Slot 2→idx5, Slot 3→idx3, Slot 4→idx0, Slot 5→idx4, Slot 6→idx6
  // IDs 16-21 = slots rack 1-6 (id - 15 = numéro de slot)
  // id=0 = tête droite, id=1 = tête gauche
  // src_id/head_id = slot actuellement sur la tête (ex: head_id=19 → slot 4)
  const headSlotNum = headId >= 16 ? headId - 15 : -1; // numéro de slot 1-6

  // Construire les 6 slots dans l'ordre physique
  // Pour chaque slot 1-6, chercher l'hotend avec id = slot+15
  // Si head_id correspond à ce slot → onHead=true, slot virtuellement vide
  const slots = [1,2,3,4,5,6].map(num => {
    const targetId = num + 15; // slot 1→id16, slot 4→id19, etc.
    const onHead   = headId === targetId;
    const slot     = h.find(s => s.id === targetId) ?? null;
    // Si onHead et slot null → créer un slot fantôme pour l'affichage
    const displaySlot = slot ?? (onHead ? { id: targetId, filament_id: "", color: "", diameter: 0.4, nozzle_type: "HS01", wear: 0, print_time: 0, empty: true } : null);
    return { slot: displaySlot, num, onHead };
  });

  const topSlots = [slots[0], slots[2], slots[4]];
  const botSlots = [slots[1], slots[3], slots[5]];
  const topSels  = [0, 2, 4];
  const botSels  = [1, 3, 5];
  const selEntry = slots[sel] ?? slots[0];
  const filled   = slots.filter(s => s.slot?.filament_id && !s.onHead).length;
  // headSlot = infos de l'hotend sur la tête (id=0 dans nozzle.info[] = tête droite)
  const headSlot = h.find(s => s.id === 0) ?? null;

  return (
    <div className="card" style={{ padding:16 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em" }}>Rack Vortek</span>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <span style={{ fontSize:10, fontFamily:"monospace", color:"var(--muted)" }}>{slots.filter(s=>s.slot?.filament_id && !s.onHead).length}/6 chargés</span>
          {headId >= 16 && (
            <span style={{ fontSize:10, color:"#60a5fa", fontFamily:"monospace" }}>
              ● Buse droite : slot {headSlotNum}{headSlot ? ` — ${headSlot.filament_id} ${headSlot.diameter}mm` : ""}
            </span>
          )}
        </div>
      </div>

      <div style={{ display:"flex", gap:12 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:6, flexShrink:0 }}>
          <div style={{ display:"flex", gap:6 }}>
            {topSlots.map(({slot, num, onHead}, i) => slot ? (
              <SlotMini key={num}
                slot={slot} num={num} isOnHead={onHead}
                isSelected={sel === topSels[i]}
                onClick={() => setSel(topSels[i])} />
            ) : null)}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {botSlots.map(({slot, num, onHead}, i) => slot ? (
              <SlotMini key={num}
                slot={slot} num={num} isOnHead={onHead}
                isSelected={sel === botSels[i]}
                onClick={() => setSel(botSels[i])} />
            ) : null)}
          </div>
        </div>

        {selEntry?.slot && (
          <SlotDetail
            slot={selEntry.slot}
            num={selEntry.num}
            isOnHead={selEntry.onHead}
            headSlot={selEntry.onHead ? headSlot : null}
          />
        )}
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
      <HMSBanner errors={status?.hms_errors}/>
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
