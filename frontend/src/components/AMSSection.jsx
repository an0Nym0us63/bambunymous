import React, { useState } from "react";
import clsx from "clsx";
import { Droplets, Sun } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function hexCss(hex) {
  if (!hex) return null;
  const h = hex.slice(0, 6);
  if (h === "000000" || h.replace(/0/g, "") === "") return null;
  return `#${h}`;
}

function isEmptyTray(tray) {
  if (tray.empty) return true;
  const uuid  = (tray.uuid  || "").replace(/0/g, "");
  const color = (tray.color || "").replace(/[0F]/gi, "");
  return uuid === "" && color === "";
}

function luminance(hex) {
  if (!hex) return 0;
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

// ── Bobine SVG ─────────────────────────────────────────────────────────────

function SpoolSVG({ color, empty, size = 80, active }) {
  const c     = color || (empty ? "#2a2a2a" : "#444");
  const dark  = luminance(c.replace("#", "")) < 128;
  const text  = dark ? "#ffffff" : "#1a1a1a";
  const rim   = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)";
  const shine = dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.35)";

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {/* Ombre portée */}
      <ellipse cx="40" cy="74" rx="22" ry="4" fill="rgba(0,0,0,0.25)" />

      {/* Flasque gauche */}
      <ellipse cx="40" cy="40" rx="28" ry="28" fill={empty ? "#222" : c} />
      <ellipse cx="40" cy="40" rx="28" ry="28" fill={rim} />

      {/* Corps bobine (filament visible) */}
      <rect x="18" y="22" width="44" height="36" rx="2" fill={empty ? "#1a1a1a" : c} />
      {!empty && (
        <rect x="18" y="22" width="44" height="36" rx="2" fill="rgba(0,0,0,0.08)" />
      )}

      {/* Reflet haut */}
      <rect x="18" y="22" width="44" height="8" rx="2" fill={shine} />

      {/* Moyeu */}
      <circle cx="40" cy="40" r="11" fill={empty ? "#111" : "rgba(0,0,0,0.35)"} />
      <circle cx="40" cy="40" r="7"  fill={empty ? "#0a0a0a" : "rgba(0,0,0,0.5)"} />

      {/* Point brillant moyeu */}
      <circle cx="37" cy="37" r="2" fill="rgba(255,255,255,0.15)" />

      {/* Barre filament sur tranche */}
      {!empty && (
        <>
          <rect x="16" y="19" width="4" height="42" rx="2" fill={c} />
          <rect x="16" y="19" width="4" height="42" rx="2" fill="rgba(0,0,0,0.2)" />
          <rect x="60" y="19" width="4" height="42" rx="2" fill={c} />
          <rect x="60" y="19" width="4" height="42" rx="2" fill="rgba(0,0,0,0.2)" />
        </>
      )}

      {/* Anneau actif */}
      {active && (
        <ellipse cx="40" cy="40" rx="29" ry="29"
          stroke="#3b82f6" strokeWidth="2.5" fill="none"
          strokeDasharray="4 2" opacity="0.8" />
      )}
    </svg>
  );
}

// ── Carte tray ─────────────────────────────────────────────────────────────

function TrayCard({ tray, amsId, label, activeTrayGlobal, spoolInfo }) {
  const isActive = activeTrayGlobal === amsId * 4 + tray.id;
  const empty    = isEmptyTray(tray);
  const color    = hexCss(tray.color);

  const name     = spoolInfo?.filament_name ?? (tray.tray_id_name || null);
  const material = spoolInfo?.filament_material ?? tray.filament_type ?? null;

  const hasDbWeight = spoolInfo?.remaining_weight_g != null;
  const hasDbTotal  = spoolInfo?.filament_weight_g  != null;
  const pct = hasDbWeight && hasDbTotal
    ? Math.round((spoolInfo.remaining_weight_g / spoolInfo.filament_weight_g) * 100)
    : (tray.remain ?? 0);
  const weightLabel = hasDbWeight
    ? `${Math.round(spoolInfo.remaining_weight_g)}g`
    : `${tray.remain}%`;

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Matière */}
      <p className="text-[10px] text-gray-500 font-medium tracking-wide">
        {empty ? "" : (material || "—")}
      </p>

      {/* Barre filament */}
      <div className="w-10 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        {!empty && (
          <div className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, pct))}%`,
              backgroundColor: color || "#3b82f6"
            }} />
        )}
      </div>

      {/* Bobine */}
      <div className={clsx(
        "relative transition-transform duration-300",
        isActive && "scale-105"
      )}>
        <SpoolSVG color={color} empty={empty} size={72} active={isActive} />
        {/* Badge label */}
        <div className={clsx(
          "absolute bottom-3 left-1/2 -translate-x-1/2",
          "px-2 py-0.5 rounded-full text-[9px] font-bold",
          isActive
            ? "bg-blue-500 text-white"
            : "bg-black/40 text-white/80"
        )}>
          {label}
        </div>
      </div>

      {/* Nom filament */}
      <p className="text-[9px] text-gray-400 text-center truncate max-w-[72px] leading-tight">
        {empty ? "Vide" : (name || tray.filament_type || "—")}
      </p>
    </div>
  );
}

// ── AMS Unit ──────────────────────────────────────────────────────────────

const AMS_NAMES = ["AMS-A", "AMS-B", "AMS-C", "AMS-D"];

function AMSUnit({ ams, activeTrayGlobal, spoolLookup }) {
  const isActive = ams.trays.some(t => activeTrayGlobal === ams.id * 4 + t.id);

  const getSpoolInfo = (tray) =>
    spoolLookup?.[tray.tag_uid] ?? spoolLookup?.[tray.uuid] ?? null;

  return (
    <div className={clsx(
      "card p-4 transition-all duration-500",
      isActive && "border-blue-500/30 shadow-lg shadow-blue-500/10"
    )}>
      {/* Header AMS */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={clsx(
            "text-xs font-bold tracking-wider",
            isActive ? "text-blue-400" : "text-gray-400"
          )}>
            {AMS_NAMES[ams.id] ?? `AMS ${ams.id + 1}`}
          </span>
          {isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-600">
          <span className="flex items-center gap-1">
            <Droplets size={10} />{ams.humidity}%
          </span>
          <span className="flex items-center gap-1">
            <Sun size={10} />{ams.temp}°C
          </span>
        </div>
      </div>

      {/* Grille des 4 bobines */}
      <div className="grid grid-cols-4 gap-2">
        {ams.trays.map(tray => (
          <TrayCard
            key={tray.id}
            tray={tray}
            amsId={ams.id}
            label={`${AMS_NAMES[ams.id]?.slice(-1) ?? ams.id + 1}${tray.id + 1}`}
            activeTrayGlobal={activeTrayGlobal}
            spoolInfo={getSpoolInfo(tray)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Section AMS principale ─────────────────────────────────────────────────

export default function AMSSection({ amsList, activeTray, spoolLookup }) {
  if (!amsList?.length) return (
    <div className="card p-6 text-center text-gray-600 text-sm">Aucun AMS détecté</div>
  );

  return (
    <div className="space-y-3">
      {amsList.map(ams => (
        <AMSUnit
          key={ams.id}
          ams={ams}
          activeTrayGlobal={activeTray ?? -1}
          spoolLookup={spoolLookup}
        />
      ))}
    </div>
  );
}
