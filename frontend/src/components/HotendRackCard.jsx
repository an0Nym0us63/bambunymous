import React from "react";
import clsx from "clsx";

// Mapping position holder → label
const HOLDER_POS = { 1: "Position A", 2: "Position B", 3: "Centre", 0: "Inconnu" };

// Couleur hex RRGGBBAA → CSS rgba
function hexToRgba(hex) {
  if (!hex || hex.length < 6) return "transparent";
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return `rgba(${r},${g},${b},${a})`;
}

function isLight(hex) {
  if (!hex || hex.length < 6) return false;
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

function WearBar({ wear }) {
  // wear: 0 = neuf, 128 = usé, 255+ = très usé
  const pct = Math.min(100, Math.round((wear / 255) * 100));
  const color = pct < 40 ? "#22c55e" : pct < 70 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] mono text-gray-500">{pct}%</span>
    </div>
  );
}

function HotendSlot({ slot, isActive }) {
  const bgColor = hexToRgba(slot.color);
  const textLight = isLight(slot.color);

  return (
    <div className={clsx(
      "relative rounded-xl p-3 border transition-all flex flex-col gap-1",
      isActive
        ? "border-brand-500 shadow-lg shadow-brand-500/20 ring-1 ring-brand-500/30"
        : "border-gray-700/50",
      slot.empty ? "bg-gray-800/40" : "bg-gray-800/80"
    )}>
      {/* Badge actif */}
      {isActive && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2">
          <span className="text-[9px] font-bold bg-brand-600 text-white px-2 py-0.5 rounded-full">
            ACTIF
          </span>
        </div>
      )}

      {/* Couleur + ID */}
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-md ring-1 ring-white/20 shrink-0 flex items-center justify-center"
          style={{ backgroundColor: slot.empty ? "#1f2937" : bgColor }}
        >
          {slot.empty && <span className="text-gray-600 text-[8px]">—</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold mono text-gray-200">#{slot.id}</p>
          <p className="text-[10px] text-gray-500">{slot.nozzle_type || "?"} {slot.diameter}mm</p>
        </div>
      </div>

      {/* Filament */}
      {slot.empty ? (
        <p className="text-[10px] text-gray-600 italic">Vide</p>
      ) : (
        <>
          <p className="text-[10px] text-gray-300 truncate">{slot.filament_id || "—"}</p>
          <WearBar wear={slot.wear} />
          {slot.print_time > 0 && (
            <p className="text-[10px] text-gray-600 mono">{Math.round(slot.print_time / 60)}h</p>
          )}
        </>
      )}
    </div>
  );
}

export default function HotendRackCard({ rack }) {
  if (!rack || !rack.hotends?.length) return null;

  const filledSlots = rack.hotends.filter(h => !h.empty);
  const holderLabel = HOLDER_POS[rack.holder_pos] ?? "Inconnu";

  return (
    <div className="glass rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Rack Vortek
          </h2>
          <p className="text-[11px] text-gray-600 mt-0.5">
            {filledSlots.length}/{rack.hotends.length} hotends • {holderLabel}
          </p>
        </div>
        {/* Indicateur état holder */}
        <div className={clsx(
          "text-[10px] font-medium px-2 py-1 rounded-lg",
          rack.holder_job === 0
            ? "bg-gray-800 text-gray-500"
            : "bg-yellow-500/20 text-yellow-400"
        )}>
          {rack.holder_job === 0 ? "Idle" : "En mouvement"}
        </div>
      </div>

      {/* Grille des slots */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
        {rack.hotends.map((slot) => (
          <HotendSlot
            key={slot.id}
            slot={slot}
            isActive={slot.id === rack.active_id}
          />
        ))}
      </div>

      {/* Hotend actif en surbrillance si trouvé */}
      {rack.active_id >= 0 && (() => {
        const active = rack.hotends.find(h => h.id === rack.active_id);
        if (!active || active.empty) return null;
        return (
          <div className="mt-3 pt-3 border-t border-gray-800 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full ring-2 ring-brand-500"
              style={{ backgroundColor: hexToRgba(active.color) }} />
            <p className="text-xs text-gray-400">
              Actif : <span className="text-gray-200 font-medium">
                #{active.id} — {active.filament_id || "—"} {active.diameter}mm {active.nozzle_type}
              </span>
            </p>
          </div>
        );
      })()}
    </div>
  );
}
