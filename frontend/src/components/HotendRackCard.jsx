import React, { useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";

const HOLDER_POS = { 1: "Pos. A", 2: "Pos. B", 3: "Centre" };

function hexRgb(hex) {
  if (!hex || hex === "00000000") return null;
  const h = hex.slice(0, 6);
  return `#${h}`;
}

function isLight(hex) {
  if (!hex) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

function WearDots({ wear }) {
  // 5 segments: 0-51=1, 52-102=2, 103-153=3, 154-204=4, 205+=5
  const filled = Math.min(5, Math.ceil((wear / 255) * 5));
  const color = filled <= 2 ? "#22c55e" : filled <= 3 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex gap-0.5 mt-1.5">
      {[1,2,3,4,5].map(i => (
        <div key={i} className="h-1 flex-1 rounded-full transition-colors"
          style={{ backgroundColor: i <= filled ? color : "#374151" }} />
      ))}
    </div>
  );
}

function HotendPill({ slot, isActive }) {
  const color = hexRgb(slot.color);
  const empty = slot.empty || !slot.filament_id;

  return (
    <div className={clsx(
      "card-sm p-3 flex flex-col gap-1.5 relative transition-all",
      isActive && "border-brand-500/50 shadow-lg shadow-brand-500/10"
    )}>
      {isActive && (
        <div className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-blue-500" />
      )}

      {/* Couleur + ID */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md ring-1 ring-white/10 shrink-0"
          style={{ backgroundColor: color || (empty ? "#111827" : "#374151") }} />
        <div>
          <p className="text-[10px] mono text-gray-400">#{slot.id}</p>
          <p className="text-[9px] text-gray-600">{slot.nozzle_type || "—"} {slot.diameter}mm</p>
        </div>
      </div>

      {empty ? (
        <p className="text-[10px] text-gray-700 italic">Vide</p>
      ) : (
        <>
          <p className="text-[10px] text-gray-300 font-medium mono truncate">
            {slot.filament_id}
          </p>
          <WearDots wear={slot.wear} />
        </>
      )}
    </div>
  );
}

export default function HotendRackCard({ rack }) {
  const [open, setOpen] = useState(true);
  if (!rack?.hotends?.length) return null;

  const activeSlot = rack.hotends.find(h => h.id === rack.active_id);
  const filled = rack.hotends.filter(h => !h.empty && h.filament_id);
  const holderLabel = HOLDER_POS[rack.holder_pos] ?? "—";
  const isMoving = rack.holder_job !== 0;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Rack Vortek</span>
          {isMoving && (
            <span className="text-[9px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium animate-pulse">
              En mouvement
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 ml-auto text-gray-600 text-[11px]">
          <span className="mono">{filled.length}/{rack.hotends.length} montés</span>
          <span>{holderLabel}</span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {open && (
        <div className="p-3 pt-0 space-y-3">
          {/* Grille des hotends */}
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {rack.hotends.map(slot => (
              <HotendPill key={slot.id} slot={slot} isActive={slot.id === rack.active_id} />
            ))}
          </div>

          {/* Hotend actif résumé */}
          {activeSlot && !activeSlot.empty && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-blue-500/5 border border-blue-500/15 rounded-lg">
              <div className="w-3 h-3 rounded-sm shrink-0 ring-1 ring-white/10"
                style={{ backgroundColor: hexRgb(activeSlot.color) || "#374151" }} />
              <p className="text-[11px] text-gray-400">
                Actif —
                <span className="text-gray-200 font-medium mono ml-1">
                  #{activeSlot.id} {activeSlot.filament_id} {activeSlot.diameter}mm {activeSlot.nozzle_type}
                </span>
              </p>
              {activeSlot.print_time > 0 && (
                <span className="ml-auto text-[10px] text-gray-600 mono">
                  {Math.round(activeSlot.print_time / 60)}h
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
