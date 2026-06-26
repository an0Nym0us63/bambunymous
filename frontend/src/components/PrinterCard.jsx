import React from "react";
import { Thermometer, Wind, Layers } from "lucide-react";
import clsx from "clsx";

function TempBlock({ label, current, target, icon: Icon, accent }) {
  const hasTarget = target > 0;
  const isHeating = hasTarget && current < target - 2;
  const isHot = current > 40;

  return (
    <div className="card-sm p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-gray-500">
        <Icon size={13} />
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-end gap-1.5 mt-0.5">
        <span className={clsx(
          "text-2xl font-bold mono leading-none",
          isHot ? (accent || "text-orange-400") : "text-gray-200"
        )}>
          {current > 0 ? Math.round(current) : "—"}
        </span>
        <span className="text-xs text-gray-600 mb-0.5">°C</span>
        {hasTarget && (
          <span className={clsx(
            "text-xs mono mb-0.5 ml-auto",
            isHeating ? "text-amber-400" : "text-gray-600"
          )}>
            → {Math.round(target)}°
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
      nozzle.active && "border-blue-500/30"
    )}>
      {nozzle.active && (
        <div className="absolute top-0 right-0 bg-blue-500/20 text-blue-400 text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">
          ACTIF
        </div>
      )}
      <div className="flex items-center gap-1.5 text-gray-500">
        <Thermometer size={13} />
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-end gap-1.5 mt-0.5">
        <span className={clsx(
          "text-2xl font-bold mono leading-none",
          isHot ? "text-orange-400" : "text-gray-200"
        )}>
          {nozzle.temp > 0 ? Math.round(nozzle.temp) : "—"}
        </span>
        <span className="text-xs text-gray-600 mb-0.5">°C</span>
        {hasTarget && (
          <span className={clsx("text-xs mono mb-0.5 ml-auto", isHeating ? "text-amber-400" : "text-gray-600")}>
            → {Math.round(nozzle.target)}°
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
      <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-3">Températures</p>
      <div className={clsx(
        "grid gap-2",
        hasDual
          ? "grid-cols-2 sm:grid-cols-4"
          : "grid-cols-2 sm:grid-cols-3"
      )}>
        {nozzles.map((n, i) => (
          <NozzleBlock key={n.id} nozzle={n} label={hasDual ? `Buse ${i + 1}` : "Buse"} />
        ))}
        <TempBlock label="Plateau" current={status.bed_temp} target={status.target_bed_temp} icon={Thermometer} accent="text-red-400" />
        <TempBlock label="Chambre" current={status.chamber_temp} target={0} icon={Wind} />
      </div>
    </div>
  );
}
