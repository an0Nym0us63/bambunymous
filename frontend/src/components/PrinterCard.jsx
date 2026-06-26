import React from "react";
import { Thermometer, Wind } from "lucide-react";
import clsx from "clsx";

// ha-bambulab: id=0 = buse droite, id=1 = buse gauche
const NOZZLE_LABELS = { 0: "Buse Droite", 1: "Buse Gauche" };

function TempBlock({ label, current, target, accent }) {
  const hasTarget = target > 0;
  const isHeating = hasTarget && current < target - 2;
  const isHot = current > 40;
  return (
    <div className="card-sm p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Thermometer size={12} className="text-gray-600 shrink-0" />
        <span className="text-[10px] text-gray-500 uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className="flex items-end gap-1 mt-0.5">
        <span className={clsx(
          "text-2xl font-bold mono leading-none",
          current === 0 ? "text-gray-700" : isHot ? (accent || "text-orange-400") : "text-gray-200"
        )}>
          {current > 0 ? Math.round(current) : "—"}
        </span>
        <span className="text-xs text-gray-600 mb-0.5">°</span>
        {hasTarget && (
          <span className={clsx("text-xs mono mb-0.5 ml-auto", isHeating ? "text-amber-400" : "text-gray-600")}>
            /{Math.round(target)}°
          </span>
        )}
      </div>
    </div>
  );
}

function NozzleBlock({ nozzle, label }) {
  const hasTarget = nozzle.target > 0;
  const isHeating = hasTarget && nozzle.temp < nozzle.target - 2;
  const isHot = nozzle.temp > 40;
  return (
    <div className={clsx(
      "card-sm p-3 flex flex-col gap-1 relative overflow-hidden",
      nozzle.active && "border-blue-500/25"
    )}>
      {nozzle.active && (
        <div className="absolute top-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
      )}
      <div className="flex items-center gap-1.5">
        <Thermometer size={12} className={clsx("shrink-0", nozzle.active ? "text-blue-400" : "text-gray-600")} />
        <span className="text-[10px] text-gray-500 uppercase tracking-wide truncate">{label}</span>
        {nozzle.active && (
          <span className="ml-auto text-[8px] text-blue-400 font-bold">ACTIF</span>
        )}
      </div>
      <div className="flex items-end gap-1 mt-0.5">
        <span className={clsx(
          "text-2xl font-bold mono leading-none",
          nozzle.temp === 0 ? "text-gray-700" : isHot ? "text-orange-400" : "text-gray-200"
        )}>
          {nozzle.temp > 0 ? Math.round(nozzle.temp) : "—"}
        </span>
        <span className="text-xs text-gray-600 mb-0.5">°</span>
        {hasTarget && (
          <span className={clsx("text-xs mono mb-0.5 ml-auto", isHeating ? "text-amber-400" : "text-gray-600")}>
            /{Math.round(nozzle.target)}°
          </span>
        )}
      </div>
    </div>
  );
}

export default function PrinterCard({ status }) {
  if (!status) return <div className="card h-28 animate-pulse" />;

  const nozzles = status.nozzles ?? [];
  const hasDual = nozzles.length >= 2;

  return (
    <div className="card p-4">
      <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-3">Températures</p>
      <div className={clsx(
        "grid gap-2",
        hasDual ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"
      )}>
        {nozzles.map((n) => (
          <NozzleBlock
            key={n.id}
            nozzle={n}
            label={NOZZLE_LABELS[n.id] ?? `Buse ${n.id + 1}`}
          />
        ))}
        <TempBlock
          label="Plateau"
          current={status.bed_temp}
          target={status.target_bed_temp}
          accent="text-red-400"
        />
        <TempBlock
          label="Chambre"
          current={status.chamber_temp}
          target={0}
        />
      </div>
    </div>
  );
}
