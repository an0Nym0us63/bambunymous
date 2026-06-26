import React, { useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Droplets, Thermometer } from "lucide-react";

function hexColor(hex) {
  if (!hex || hex === "00000000") return null;
  const h = hex.length === 8 ? hex.slice(0, 6) : hex.slice(0, 6);
  return `#${h}`;
}

function isLight(hex) {
  if (!hex) return false;
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

function ColorDot({ color, size = 20 }) {
  const c = hexColor(color);
  return (
    <div
      className="rounded-md ring-1 ring-white/10 shrink-0"
      style={{
        width: size, height: size,
        backgroundColor: c || "#1f2937",
      }}
    />
  );
}

function RemainBar({ remain, color }) {
  const c = hexColor(color);
  const pct = Math.max(0, Math.min(100, remain));
  const barColor = pct > 30 ? c : "#ef4444";
  return (
    <div className="h-1 bg-gray-700/60 rounded-full overflow-hidden mt-1.5">
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: barColor || "#3b82f6" }} />
    </div>
  );
}

// Mini pastilles de couleur pour le header AMS
function ColorPills({ trays }) {
  return (
    <div className="flex gap-1">
      {trays.map(t => (
        <div key={t.id}
          className="w-5 h-5 rounded-full ring-1 ring-white/10"
          style={{ backgroundColor: hexColor(t.color) || "#1f2937" }}
        />
      ))}
    </div>
  );
}

function TrayCard({ tray, isActive }) {
  return (
    <div className={clsx(
      "card-sm p-3 transition-all",
      isActive && "border-blue-500/50 glow-blue"
    )}>
      <div className="flex items-start gap-2">
        <ColorDot color={tray.color} size={18} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="text-xs font-semibold text-gray-200 truncate">
              {tray.empty ? "Vide" : (tray.tray_id_name || tray.filament_type || "—")}
            </p>
            {isActive && (
              <span className="shrink-0 text-[9px] font-bold text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded-full">
                ●
              </span>
            )}
          </div>
          {!tray.empty && (
            <p className="text-[10px] text-gray-500 truncate">{tray.filament_type}</p>
          )}
        </div>
        <span className="text-xs mono text-gray-500 shrink-0">
          {tray.empty ? "" : `${tray.remain}%`}
        </span>
      </div>
      {!tray.empty && <RemainBar remain={tray.remain} color={tray.color} />}
    </div>
  );
}

function AMSUnit({ ams, activeTray }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider shrink-0">
          AMS {ams.id + 1}
        </span>
        <ColorPills trays={ams.trays.filter(t => !t.empty)} />
        <div className="flex items-center gap-3 ml-auto text-gray-600 text-[11px]">
          <span className="flex items-center gap-1">
            <Droplets size={11} />
            <span className="mono">{ams.humidity}%</span>
          </span>
          <span className="flex items-center gap-1">
            <Thermometer size={11} />
            <span className="mono">{ams.temp}°C</span>
          </span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* Trays */}
      {open && (
        <div className="grid grid-cols-2 gap-2 p-3 pt-0">
          {ams.trays.map(tray => (
            <TrayCard
              key={tray.id}
              tray={tray}
              isActive={activeTray === ams.id * 4 + tray.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AMSGrid({ amsList, activeTray }) {
  if (!amsList?.length) return (
    <div className="card p-6 text-center text-gray-600 text-sm">
      Aucun AMS détecté
    </div>
  );
  return (
    <div className="space-y-3">
      {amsList.map(ams => (
        <AMSUnit key={ams.id} ams={ams} activeTray={activeTray ?? -1} />
      ))}
    </div>
  );
}
