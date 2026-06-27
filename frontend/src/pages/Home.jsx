import React, { useEffect, useState, useCallback } from "react";
import { usePrinter } from "../store/printer";
import { Wifi, WifiOff, Clock, Layers, Thermometer, Wind, ChevronDown, ChevronUp, Droplets } from "lucide-react";
import client from "../api/client";
import AMSSection from "../components/AMSSection";
import clsx from "clsx";

// ── Helpers ────────────────────────────────────────────────────────────────

function hexCss(hex) {
  if (!hex || hex.replace(/0/g,"") === "" || hex === "00000000") return null;
  return `#${hex.slice(0,6)}`;
}

function isEmptyColor(hex) {
  return !hex || hex.replace(/[0F]/gi,"") === "";
}

function fmtTime(mins) {
  if (!mins) return null;
  const h = Math.floor(mins/60), m = mins%60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ""}` : `${m}min`;
}

// ── Status Banner ──────────────────────────────────────────────────────────

const STATUS_CFG = {
  RUNNING:  { label:"En cours",    grad:"from-blue-500 to-cyan-400",     dot:"bg-blue-400"     },
  PAUSE:    { label:"En pause",    grad:"from-amber-500 to-yellow-400",  dot:"bg-amber-400"    },
  FINISH:   { label:"Terminé",     grad:"from-emerald-500 to-green-400", dot:"bg-emerald-400"  },
  FAILED:   { label:"Erreur",      grad:"from-red-600 to-rose-500",      dot:"bg-red-400"      },
  IDLE:     { label:"En veille",   grad:"from-gray-700 to-gray-600",     dot:"bg-gray-600"     },
  PREPARE:  { label:"Préparation", grad:"from-indigo-500 to-blue-400",   dot:"bg-indigo-400"   },
};

function StatusBanner({ status }) {
  if (!status) return <div className="card h-16 animate-pulse" />;
  const cfg = STATUS_CFG[status.status] ?? STATUS_CFG.IDLE;
  const pct = status.progress ?? 0;
  const isRunning = status.status === "RUNNING";
  const remain = fmtTime(status.remaining_minutes);

  return (
    <div className="card overflow-hidden relative">
      {isRunning && (
        <div className="absolute inset-0 pointer-events-none">
          <div className={clsx("h-full bg-gradient-to-r opacity-[0.10] transition-all duration-1000", cfg.grad)}
            style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="relative flex items-center gap-3 px-4 py-3">
        <div className={clsx("w-2 h-2 rounded-full shrink-0", cfg.dot, isRunning && "animate-pulse")} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {isRunning && status.print_name ? status.print_name : cfg.label}
          </p>
          {isRunning && status.print_name && (
            <p className="text-[10px] text-gray-500">{cfg.label}</p>
          )}
        </div>
        {isRunning && (
          <div className="flex items-center gap-3 shrink-0">
            {remain && (
              <span className="hidden sm:flex items-center gap-1 text-xs text-gray-500">
                <Clock size={11} /><span className="mono">{remain}</span>
              </span>
            )}
            {status.total_layers > 0 && (
              <span className="hidden sm:flex items-center gap-1 text-xs text-gray-500">
                <Layers size={11} /><span className="mono">{status.layer}/{status.total_layers}</span>
              </span>
            )}
            <span className={clsx("text-xl font-bold mono bg-gradient-to-r bg-clip-text text-transparent", cfg.grad)}>
              {pct}%
            </span>
          </div>
        )}
        {status.connected
          ? <Wifi size={15} className="text-green-400 shrink-0" />
          : <WifiOff size={15} className="text-red-400 shrink-0" />}
      </div>
      {isRunning && (remain || status.total_layers > 0) && (
        <div className="sm:hidden flex gap-3 px-4 pb-2 -mt-1">
          {remain && <span className="text-[10px] text-gray-600 mono">{remain} restantes</span>}
          {status.total_layers > 0 && <span className="text-[10px] text-gray-600 mono">Couche {status.layer}/{status.total_layers}</span>}
        </div>
      )}
    </div>
  );
}

// ── Température block ──────────────────────────────────────────────────────

function TempBlock({ label, current, target, accent, icon: Icon = Thermometer, active }) {
  const hot = current > 40;
  const heating = target > 0 && current < target - 3;
  return (
    <div className={clsx("card-sm p-3 flex flex-col gap-1 relative overflow-hidden", active && "border-blue-500/25")}>
      {active && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/60 to-transparent" />}
      <div className="flex items-center gap-1 text-gray-600">
        <Icon size={11} className="shrink-0" />
        <span className="text-[10px] uppercase tracking-wide truncate">{label}</span>
        {active && <span className="ml-auto text-[8px] text-blue-400 font-bold">ACTIF</span>}
      </div>
      <div className="flex items-end gap-1">
        <span className={clsx("text-[1.6rem] font-bold mono leading-none",
          current === 0 ? "text-gray-700" : hot ? (accent || "text-orange-400") : "text-gray-100")}>
          {current > 0 ? Math.round(current) : "—"}
        </span>
        <span className="text-xs text-gray-600 mb-0.5">°</span>
        {target > 0 && (
          <span className={clsx("text-xs mono mb-0.5 ml-auto", heating ? "text-amber-400" : "text-gray-600")}>
            /{Math.round(target)}°
          </span>
        )}
      </div>
    </div>
  );
}

// ── PrinterTemps (dual nozzle H2C: gauche à gauche, droite à droite) ───────

function PrinterTemps({ status }) {
  if (!status) return <div className="card h-28 animate-pulse" />;
  // H2C: id=1 = buse GAUCHE (standard, lifting), id=0 = buse DROITE (Vortek actif)
  const left  = status.nozzles?.find(n => n.id === 1);
  const right = status.nozzles?.find(n => n.id === 0);

  return (
    <div className="card p-4">
      <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-3">Températures</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {/* Gauche → Droite */}
        {left  && <TempBlock label="Buse Gauche" current={left.temp}  target={left.target}  active={left.active} />}
        {right && <TempBlock label="Buse Droite" current={right.temp} target={right.target} active={right.active} />}
        <TempBlock label="Plateau" current={status.bed_temp} target={status.target_bed_temp} accent="text-red-400" />
        <TempBlock label="Chambre" current={status.chamber_temp} target={0} icon={Wind} />
      </div>
    </div>
  );
}

// ── Vortek Rack ────────────────────────────────────────────────────────────

const HOLDER_POS = { 1: "Rang A", 2: "Rang B", 3: "Centre" };

// ── Vortek Rack ────────────────────────────────────────────────────────────

function WearSegs({ wear }) {
  const filled = Math.min(5, Math.max(0, Math.round((wear / 255) * 5)));
  const color  = filled <= 2 ? "#22c55e" : filled <= 3 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex gap-0.5 mt-1">
      {[1,2,3,4,5].map(i => (
        <div key={i} className="h-1 flex-1 rounded-full"
          style={{ backgroundColor: i <= filled ? color : "rgba(255,255,255,0.08)" }} />
      ))}
    </div>
  );
}

function HotendCard({ slot, slotNum, isOnHead }) {
  const color = hexCss(slot.color);
  const empty = slot.empty || !slot.filament_id;
  return (
    <div className={clsx(
      "rounded-xl p-2.5 border flex flex-col gap-1.5 relative",
      isOnHead
        ? "border-blue-500/40 bg-blue-500/5 shadow shadow-blue-500/10"
        : "border-white/[0.07] bg-white/[0.03]"
    )}>
      {isOnHead && (
        <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r from-blue-500 to-cyan-400" />
      )}
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded shrink-0 ring-1 ring-white/10"
          style={{ backgroundColor: color || (empty ? "rgba(255,255,255,0.04)" : "#374151") }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-[10px] mono font-semibold text-gray-500">{slotNum}</span>
            {isOnHead && <span className="text-[8px] text-blue-400 font-bold">tête</span>}
          </div>
          <p className="text-[8px] text-gray-700 mono">{slot.nozzle_type || "—"} {slot.diameter}mm</p>
        </div>
      </div>
      {empty
        ? <p className="text-[9px] text-gray-700 italic">Vide</p>
        : <>
            <p className="text-[9px] mono text-gray-400 truncate">{slot.filament_id}</p>
            <WearSegs wear={slot.wear} />
          </>
      }
    </div>
  );
}

function VortekRack({ rack }) {
  const [open, setOpen] = useState(true);
  if (!rack?.hotends?.length) return null;

  const h = rack.hotends;
  // On affiche les hotends dans l'ordre reçu du firmware (index 0-N)
  // La numérotation UI = index + 1 (en attendant confirmation du mapping physique)
  // src_id pointe vers un hotend par son hardware id
  const onHeadIdx = h.findIndex(slot => slot.id === rack.active_id);
  const onHead    = onHeadIdx >= 0 ? h[onHeadIdx] : null;
  const filled    = h.filter(s => !s.empty && s.filament_id);
  const isMoving  = rack.holder_job !== 0;

  // Layout: 6 premiers en grille 3x2, le 7e séparé si présent
  const mainSlots  = h.slice(0, 6);
  const extraSlots = h.slice(6);

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/[0.02] transition-colors">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Rack Vortek</span>
        {isMoving && (
          <span className="text-[9px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full animate-pulse">
            En mouvement
          </span>
        )}
        <div className="flex items-center gap-3 ml-auto text-[10px] text-gray-600">
          <span className="mono">{filled.length}/{h.length} chargés</span>
          {open ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
        </div>
      </button>

      {open && (
        <div className="p-3 pt-0 space-y-2">
          {/* Grille 3x2 */}
          <div className="grid grid-cols-3 gap-1.5">
            {mainSlots.map((slot, i) => (
              <HotendCard
                key={slot.id}
                slot={slot}
                slotNum={i + 1}
                isOnHead={slot.id === rack.active_id}
              />
            ))}
          </div>

          {/* Slots supplémentaires (index 6+) */}
          {extraSlots.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {extraSlots.map((slot, i) => (
                <HotendCard
                  key={slot.id}
                  slot={slot}
                  slotNum={mainSlots.length + i + 1}
                  isOnHead={slot.id === rack.active_id}
                />
              ))}
            </div>
          )}

          {/* Résumé hotend actif si trouvé */}
          {onHead && !onHead.empty && (
            <div className="flex items-center gap-2 px-2.5 py-2 bg-blue-500/5 border border-blue-500/15 rounded-lg">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0 ring-1 ring-white/10"
                style={{ backgroundColor: hexCss(onHead.color) || "#374151" }} />
              <p className="text-[11px] text-gray-400 flex-1 min-w-0">
                Sur la tête —
                <span className="text-gray-200 font-medium mono ml-1">
                  {onHead.filament_id} {onHead.diameter}mm {onHead.nozzle_type}
                </span>
              </p>
              {onHead.print_time > 0 && (
                <span className="text-[10px] text-gray-600 mono shrink-0">
                  {Math.round(onHead.print_time / 60)}h
                </span>
              )}
            </div>
          )}

          {/* src_id sans match dans la liste */}
          {!onHead && rack.active_id >= 0 && (
            <div className="px-2.5 py-2 border border-white/[0.05] rounded-lg">
              <p className="text-[10px] text-gray-600 mono">
                Actif: id #{rack.active_id} — non présent dans le rack
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── Page Home ──────────────────────────────────────────────────────────────

export default function Home() {
  const { status, startPolling, stopPolling } = usePrinter();
  const [spoolLookup, setSpoolLookup] = useState({});

  // Charger le lookup filament par UUID/tag
  const fetchSpoolLookup = useCallback(async () => {
    try {
      const { data: spools } = await client.get("/filaments/spools", { params: { archived: false } });
      const { data: filaments } = await client.get("/filaments/filaments");
      // Map filament_id → filament details (weight etc.)
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
        // Indexer par tag_number (= tag_uid du NFC)
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
    <div className="space-y-3 max-w-2xl mx-auto">
      <StatusBanner status={status} />
      <PrinterTemps status={status} />
      {hasRack && <VortekRack rack={status.hotend_rack} />}
      <AMSSection
        amsList={status?.ams_list ?? []}
        activeTray={status?.active_tray ?? -1}
        spoolLookup={spoolLookup}
      />
    </div>
  );
}
