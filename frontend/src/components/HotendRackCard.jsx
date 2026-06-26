import React, { useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";

// Numérotation physique Bambu H2C:
// Rangée A (haut): slots 1, 3, 5  → index 0, 2, 4 dans nozzle.info[]
// Rangée B (bas):  slots 2, 4, 6  → index 1, 3, 5
// Le 7e hotend (index 6) est celui actuellement sur la tête (src_id)
// src_id = id hardware de l'hotend sur la tête — pas dans le rack

const HOLDER_POS = { 1: "Rang A", 2: "Rang B", 3: "Centre", 0: "—" };

function hexColor(hex) {
  if (!hex || hex === "00000000" || hex === "00000000FF") return null;
  return `#${hex.slice(0, 6)}`;
}

function isColorEmpty(hex) {
  if (!hex) return true;
  const h = hex.replace("#", "");
  return h === "000000" || h === "000000FF" || h === "00000000";
}

function WearBar({ wear }) {
  const pct = Math.min(100, Math.round((wear / 255) * 100));
  const color = pct < 40 ? "#22c55e" : pct < 70 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex gap-0.5 mt-1.5">
      {[1,2,3,4,5].map(i => {
        const filled = i <= Math.ceil((wear / 255) * 5);
        return (
          <div key={i} className="h-1 flex-1 rounded-full"
            style={{ backgroundColor: filled ? color : "rgba(255,255,255,0.08)" }} />
        );
      })}
    </div>
  );
}

function SlotCard({ slot, slotNumber, isOnHead }) {
  const color = hexColor(slot.color);
  const isEmpty = slot.empty || !slot.filament_id;
  const colorEmpty = isColorEmpty(slot.color);

  return (
    <div className={clsx(
      "rounded-xl p-3 flex flex-col gap-1.5 relative transition-all border",
      isOnHead
        ? "border-blue-500/50 bg-blue-500/5 shadow-lg shadow-blue-500/10"
        : "border-white/[0.07] bg-white/[0.03]"
    )}>
      {/* Badge "Sur tête" */}
      {isOnHead && (
        <div className="absolute -top-px inset-x-0 h-0.5 rounded-t-xl bg-gradient-to-r from-blue-500 to-cyan-400" />
      )}

      {/* Numéro + couleur */}
      <div className="flex items-center gap-2">
        <div className={clsx(
          "w-5 h-5 rounded-md ring-1 ring-white/10 shrink-0",
          isOnHead && !colorEmpty && "ring-2 ring-blue-400/50"
        )}
          style={{ backgroundColor: color || (isEmpty ? "rgba(255,255,255,0.05)" : "#374151") }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-bold mono text-gray-400">
              {slotNumber}
            </span>
            {isOnHead && (
              <span className="text-[9px] text-blue-400 font-semibold">● tête</span>
            )}
          </div>
          <p className="text-[9px] text-gray-600 mono">{slot.nozzle_type || "—"} {slot.diameter}mm</p>
        </div>
      </div>

      {isEmpty ? (
        <p className="text-[10px] text-gray-700 italic">Vide</p>
      ) : (
        <>
          <p className="text-[10px] font-medium text-gray-300 mono truncate">{slot.filament_id}</p>
          <WearBar wear={slot.wear} />
        </>
      )}
    </div>
  );
}

export default function HotendRackCard({ rack }) {
  const [open, setOpen] = useState(true);
  if (!rack?.hotends?.length) return null;

  // L'ordre dans nozzle.info[] = ordre physique des slots
  // Slot numéro UI = index + 1 (sauf le dernier qui est sur la tête si src_id correspond)
  // src_id est l'id hardware de l'hotend actuellement monté sur la tête
  const hotends = rack.hotends;

  // Trouver lequel est sur la tête (src_id)
  const headHotendIdx = hotends.findIndex(h => h.id === rack.active_id);

  // Layout physique Bambu H2C:
  // Rangée A: slots index 0, 2, 4 → UI 1, 3, 5
  // Rangée B: slots index 1, 3, 5 → UI 2, 4, 6
  // index 6 = 7e hotend (optionnel)
  const rowA = [0, 2, 4].map(i => hotends[i]).filter(Boolean);
  const rowB = [1, 3, 5].map(i => hotends[i]).filter(Boolean);
  const extra = hotends.length > 6 ? hotends.slice(6) : [];

  const slotNum = (index) => index + 1;

  const filled = hotends.filter(h => !h.empty && h.filament_id);
  const onHead = headHotendIdx >= 0 ? hotends[headHotendIdx] : null;
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
        <div className="flex items-center gap-3 ml-auto text-[11px] text-gray-600">
          <span className="mono">{filled.length}/{hotends.length} chargés</span>
          <span>{HOLDER_POS[rack.holder_pos] ?? "—"}</span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {open && (
        <div className="p-3 pt-0 space-y-2">
          {/* Rangée A: 1, 3, 5 */}
          <div>
            <p className="text-[9px] text-gray-700 uppercase tracking-widest mb-1.5 px-0.5">Rang A</p>
            <div className="grid grid-cols-3 gap-2">
              {rowA.map((slot, i) => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  slotNumber={slotNum(i * 2)}     // 1, 3, 5
                  isOnHead={slot.id === rack.active_id}
                />
              ))}
            </div>
          </div>

          {/* Rangée B: 2, 4, 6 */}
          <div>
            <p className="text-[9px] text-gray-700 uppercase tracking-widest mb-1.5 px-0.5">Rang B</p>
            <div className="grid grid-cols-3 gap-2">
              {rowB.map((slot, i) => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  slotNumber={slotNum(i * 2 + 1)} // 2, 4, 6
                  isOnHead={slot.id === rack.active_id}
                />
              ))}
            </div>
          </div>

          {/* Hotend actif résumé */}
          {onHead && !onHead.empty && (
            <div className="flex items-center gap-2 px-2.5 py-2 bg-blue-500/5 border border-blue-500/15 rounded-lg">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0 ring-1 ring-white/10"
                style={{ backgroundColor: hexColor(onHead.color) || "#374151" }} />
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
        </div>
      )}
    </div>
  );
}
