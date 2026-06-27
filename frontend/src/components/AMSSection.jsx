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

const AMS_NAMES = ["AMS-A", "AMS-B", "AMS-C", "AMS-D"];

// ── Mini pastille couleur (vue compacte) ───────────────────────────────────

function ColorPill({ color, active }) {
  const c = hexCss(color);
  return (
    <div className={clsx(
      "h-7 flex-1 rounded-md transition-all duration-300",
      active ? "ring-2 ring-white scale-110 shadow-md" : "ring-1 ring-white/10"
    )}
      style={{ backgroundColor: c || "rgba(255,255,255,0.05)" }}
    />
  );
}

// ── Boîtier AMS compact (sélecteur en haut) ────────────────────────────────

function AMSBox({ ams, activeTrayGlobal, isSelected, onClick }) {
  const hasActive = ams.trays.some(t => activeTrayGlobal === ams.id * 4 + t.id);
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-1.5 flex-1 transition-all duration-200 hover:scale-[1.02] active:scale-95">

      {/* Label */}
      <div className="flex items-center gap-1">
        <span className={clsx(
          "text-[10px] font-bold tracking-wider",
          hasActive ? "text-blue-400" : isSelected ? "text-gray-200" : "text-gray-500"
        )}>
          {AMS_NAMES[ams.id] ?? `AMS ${ams.id + 1}`}
        </span>
        {hasActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
      </div>

      {/* Boîtier avec slots */}
      <div className={clsx(
        "w-full rounded-xl p-1.5 flex gap-1 border transition-all duration-300",
        hasActive
          ? "border-blue-500/40 bg-blue-500/5 shadow-md shadow-blue-500/15"
          : isSelected
          ? "border-white/20 bg-white/[0.05]"
          : "border-white/[0.07] bg-white/[0.03]"
      )}>
        {ams.trays.map(tray => (
          <ColorPill
            key={tray.id}
            color={tray.color}
            active={activeTrayGlobal === ams.id * 4 + tray.id}
          />
        ))}
      </div>

      {/* Infos humidité + temp */}
      <div className="flex gap-2 text-[9px] text-gray-600">
        <span className="flex items-center gap-0.5">
          <Droplets size={8} />{ams.humidity}%
        </span>
        <span className="flex items-center gap-0.5">
          <Sun size={8} />{ams.temp}°
        </span>
      </div>

      {/* Indicateur sélection */}
      <div className={clsx(
        "h-0.5 rounded-full transition-all duration-300",
        isSelected ? "w-10 bg-blue-500" : "w-3 bg-white/[0.08]"
      )} />
    </button>
  );
}

// ── Bobine SVG ─────────────────────────────────────────────────────────────

function SpoolSVG({ color, empty, size = 72, active }) {
  const c     = color || (empty ? "#1a1a1a" : "#333");
  const dark  = luminance(c.replace("#", "")) < 140;
  const shine = dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.30)";
  const rim   = "rgba(0,0,0,0.18)";

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {/* Ombre */}
      <ellipse cx="40" cy="75" rx="22" ry="3.5" fill="rgba(0,0,0,0.3)" />

      {/* Flasque principale */}
      <ellipse cx="40" cy="40" rx="28" ry="28" fill={empty ? "#1e1e1e" : c} />
      <ellipse cx="40" cy="40" rx="28" ry="28" fill={rim} />

      {/* Corps filament */}
      <rect x="19" y="23" width="42" height="34" rx="2"
        fill={empty ? "#161616" : c} />
      {!empty && <rect x="19" y="23" width="42" height="34" rx="2" fill="rgba(0,0,0,0.10)" />}

      {/* Reflet haut */}
      <rect x="19" y="23" width="42" height="9" rx="2" fill={shine} />

      {/* Tranches latérales */}
      {!empty && <>
        <rect x="16" y="20" width="4" height="40" rx="2" fill={c} />
        <rect x="16" y="20" width="4" height="40" rx="2" fill="rgba(0,0,0,0.22)" />
        <rect x="60" y="20" width="4" height="40" rx="2" fill={c} />
        <rect x="60" y="20" width="4" height="40" rx="2" fill="rgba(0,0,0,0.22)" />
      </>}

      {/* Moyeu */}
      <circle cx="40" cy="40" r="11" fill="rgba(0,0,0,0.40)" />
      <circle cx="40" cy="40" r="7"  fill="rgba(0,0,0,0.55)" />
      <circle cx="37" cy="37" r="2"  fill="rgba(255,255,255,0.12)" />

      {/* Anneau actif */}
      {active && (
        <ellipse cx="40" cy="40" rx="30" ry="30"
          stroke="#3b82f6" strokeWidth="2.5" fill="none"
          strokeDasharray="5 2.5" opacity="0.9">
          <animateTransform attributeName="transform" type="rotate"
            from="0 40 40" to="360 40 40" dur="8s" repeatCount="indefinite" />
        </ellipse>
      )}
    </svg>
  );
}

// ── Carte tray détaillée ───────────────────────────────────────────────────

function TrayCard({ tray, amsId, label, activeTrayGlobal, spoolInfo }) {
  const isActive = activeTrayGlobal === amsId * 4 + tray.id;
  const empty    = isEmptyTray(tray);
  const color    = hexCss(tray.color);

  const name     = spoolInfo?.filament_name ?? null;
  const brand    = spoolInfo?.filament_manufacturer ?? null;
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
    <div className="flex flex-col items-center gap-1">
      {/* Matière */}
      <p className="text-[10px] text-gray-500 font-medium h-4 leading-none">
        {empty ? "" : (material || "—")}
      </p>

      {/* Barre reste */}
      <div className="w-12 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        {!empty && (
          <div className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.max(0, Math.min(100, pct))}%`,
              backgroundColor: pct > 30 ? (color || "#3b82f6") : "#ef4444"
            }} />
        )}
      </div>

      {/* Bobine */}
      <div className={clsx("relative transition-all duration-300", isActive && "scale-105")}>
        <SpoolSVG color={color} empty={empty} size={68} active={isActive} />
        <div className={clsx(
          "absolute bottom-2.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap",
          isActive ? "bg-blue-500 text-white" : "bg-black/50 text-white/75"
        )}>
          {label}
        </div>
      </div>

      {/* Poids / id */}
      <p className="text-[9px] text-gray-500 mono">{empty ? "" : weightLabel}</p>

      {/* Nom */}
      <p className="text-[9px] text-gray-400 text-center truncate w-16 leading-tight">
        {empty ? "Vide" : (name || tray.tray_id_name || "—")}
      </p>
    </div>
  );
}

// ── Détail AMS ─────────────────────────────────────────────────────────────

function AMSDetail({ ams, activeTrayGlobal, spoolLookup }) {
  const hasActive = ams.trays.some(t => activeTrayGlobal === ams.id * 4 + t.id);
  const getSpoolInfo = t =>
    spoolLookup?.[t.tag_uid] ?? spoolLookup?.[t.uuid] ?? null;

  return (
    <div className={clsx(
      "card p-4 transition-all duration-500",
      hasActive && "border-blue-500/25 shadow-lg shadow-blue-500/8"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={clsx("text-xs font-bold tracking-wider",
            hasActive ? "text-blue-400" : "text-gray-400")}>
            {AMS_NAMES[ams.id] ?? `AMS ${ams.id + 1}`}
          </span>
          {hasActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
        </div>
        <div className="flex gap-3 text-[10px] text-gray-600">
          <span className="flex items-center gap-1"><Droplets size={10} />{ams.humidity}%</span>
          <span className="flex items-center gap-1"><Sun size={10} />{ams.temp}°C</span>
        </div>
      </div>

      {/* Bobines */}
      <div className="grid grid-cols-4 gap-1">
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

// ── Section principale ─────────────────────────────────────────────────────

export default function AMSSection({ amsList, activeTray, spoolLookup }) {
  const activeAmsId = activeTray >= 0 ? Math.floor(activeTray / 4) : -1;
  const [selectedId, setSelectedId] = useState(null);

  // AMS affiché en détail: celui cliqué ou l'actif par défaut
  const displayId  = selectedId ?? (activeAmsId >= 0 ? activeAmsId : 0);
  const displayAms = amsList.find(a => a.id === displayId) ?? amsList[0];

  if (!amsList?.length) return (
    <div className="card p-6 text-center text-gray-600 text-sm">Aucun AMS détecté</div>
  );

  return (
    <div className="space-y-3">
      {/* Sélecteur compact: boîtiers AMS côte à côte */}
      <div className="card p-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {amsList.map(ams => (
            <AMSBox
              key={ams.id}
              ams={ams}
              activeTrayGlobal={activeTray ?? -1}
              isSelected={ams.id === displayId}
              onClick={() => setSelectedId(ams.id === selectedId ? null : ams.id)}
            />
          ))}
        </div>
      </div>

      {/* Détail de l'AMS sélectionné */}
      {displayAms && (
        <AMSDetail
          ams={displayAms}
          activeTrayGlobal={activeTray ?? -1}
          spoolLookup={spoolLookup}
        />
      )}
    </div>
  );
}
