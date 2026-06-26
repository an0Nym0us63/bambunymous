import React from "react";
import { Wifi, WifiOff, Clock, Layers } from "lucide-react";
import clsx from "clsx";

const STATUS = {
  RUNNING:  { label: "En cours",    color: "from-blue-500 to-cyan-400",    dot: "bg-blue-400" },
  PAUSE:    { label: "En pause",    color: "from-amber-500 to-yellow-400", dot: "bg-amber-400" },
  FINISH:   { label: "Terminé",     color: "from-emerald-500 to-green-400",dot: "bg-emerald-400" },
  FAILED:   { label: "Erreur",      color: "from-red-600 to-rose-500",     dot: "bg-red-400" },
  IDLE:     { label: "En veille",   color: "from-gray-600 to-gray-500",    dot: "bg-gray-500" },
  PREPARE:  { label: "Préparation", color: "from-indigo-500 to-blue-400",  dot: "bg-indigo-400" },
};

function fmt(mins) {
  if (!mins) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export default function StatusBanner({ status }) {
  if (!status) return (
    <div className="card h-20 animate-pulse" />
  );

  const s = STATUS[status.status] ?? STATUS.IDLE;
  const pct = status.progress ?? 0;
  const isRunning = status.status === "RUNNING";
  const remain = fmt(status.remaining_minutes);

  return (
    <div className="card overflow-hidden relative">
      {/* Progress bar bg */}
      {isRunning && (
        <div className="absolute inset-0 pointer-events-none">
          <div
            className={clsx("h-full bg-gradient-to-r opacity-[0.12] transition-all duration-1000", s.color)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <div className="relative flex items-center gap-4 p-4">
        {/* Status dot + label */}
        <div className="flex items-center gap-2 shrink-0">
          <div className={clsx("w-2 h-2 rounded-full", s.dot, isRunning && "animate-pulse")} />
          <span className="text-xs text-gray-400 font-medium">{s.label}</span>
        </div>

        {/* Nom du fichier */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {status.print_name || (isRunning ? "Impression en cours…" : "—")}
          </p>
        </div>

        {/* Droite: progression + infos */}
        <div className="flex items-center gap-4 shrink-0">
          {isRunning && (
            <>
              {remain && (
                <div className="hidden sm:flex items-center gap-1 text-xs text-gray-400">
                  <Clock size={12} />
                  <span className="mono">{remain}</span>
                </div>
              )}
              {status.total_layers > 0 && (
                <div className="hidden sm:flex items-center gap-1 text-xs text-gray-400">
                  <Layers size={12} />
                  <span className="mono">{status.layer}/{status.total_layers}</span>
                </div>
              )}
              <span className={clsx("text-xl font-bold mono bg-gradient-to-r bg-clip-text text-transparent", s.color)}>
                {pct}%
              </span>
            </>
          )}
          {status.connected
            ? <Wifi size={16} className="text-green-400 shrink-0" />
            : <WifiOff size={16} className="text-red-400 shrink-0" />}
        </div>
      </div>

      {/* Mobile: infos supplémentaires */}
      {isRunning && (remain || status.total_layers > 0) && (
        <div className="sm:hidden flex gap-4 px-4 pb-3 -mt-1">
          {remain && <span className="text-xs text-gray-500 mono">{remain} restantes</span>}
          {status.total_layers > 0 && (
            <span className="text-xs text-gray-500 mono">Couche {status.layer}/{status.total_layers}</span>
          )}
        </div>
      )}
    </div>
  );
}
