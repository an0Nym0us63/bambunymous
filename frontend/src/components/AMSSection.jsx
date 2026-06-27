import React, { useState } from "react";
import clsx from "clsx";
import { Droplets, Thermometer, ChevronDown, ChevronUp } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function hexCss(hex) {
  if (!hex || hex.replace(/[0F]/gi, "") === "" && hex.length <= 8) return null;
  const clean = hex.slice(0, 6);
  if (clean === "000000") return null;
  return `#${clean}`;
}

function isEmptyTray(tray) {
  if (tray.empty) return true;
  const uuid = tray.uuid?.replace(/0/g, "") ?? "";
  const color = tray.color?.replace(/[0F]/gi, "") ?? "";
  return uuid === "" && color === "";
}

// ── Mini slot (dans la représentation compacte du AMS) ──────────────────────

function SlotPill({ color, active }) {
  const c = hexCss(color);
  return (
    <div className={clsx(
      "h-8 flex-1 rounded-md transition-all duration-300",
      active ? "ring-2 ring-white/80 scale-110 shadow-lg" : "ring-1 ring-white/10",
    )}
      style={{ backgroundColor: c || "rgba(255,255,255,0.06)" }}
    />
  );
}

// ── Représentation visuelle du boîtier AMS ───────────────────────────────────

function AMSBox({ ams, activeTrayGlobal }) {
  return (
    <div className="flex flex-col gap-1.5 items-center">
      {/* Label */}
      <span className="text-[9px] text-gray-600 uppercase tracking-widest font-medium">
        AMS {ams.id + 1}
      </span>
      {/* Boîtier */}
      <div className={clsx(
        "rounded-xl p-1.5 flex gap-1 w-full border transition-all duration-500",
        ams.trays.some((t, i) => activeTrayGlobal === ams.id * 4 + t.id)
          ? "border-blue-500/40 bg-blue-500/5 shadow-lg shadow-blue-500/15"
          : "border-white/[0.07] bg-white/[0.03]"
      )}>
        {ams.trays.map(tray => (
          <SlotPill
            key={tray.id}
            color={tray.color}
            active={activeTrayGlobal === ams.id * 4 + tray.id}
          />
        ))}
      </div>
      {/* Stats */}
      <div className="flex gap-2 text-[9px] text-gray-700">
        <span className="flex items-center gap-0.5">
          <Droplets size={8}/>{ams.humidity}%
        </span>
        <span>{ams.temp}°C</span>
      </div>
    </div>
  );
}

// ── Carte tray détaillée ─────────────────────────────────────────────────────

function TrayDetail({ tray, amsId, activeTrayGlobal, spoolInfo }) {
  const isActive = activeTrayGlobal === amsId * 4 + tray.id;
  const empty = isEmptyTray(tray);
  const color = hexCss(tray.color);

  // Données depuis DB si disponibles, sinon MQTT
  const name = spoolInfo?.filament_name ?? (tray.tray_id_name || null);
  const brand = spoolInfo?.filament_manufacturer ?? null;
  const material = spoolInfo?.filament_material ?? tray.filament_type ?? null;
  
  // Poids restant: DB en g ou MQTT en %
  const hasDbWeight = spoolInfo?.remaining_weight_g != null;
  const hasDbTotal = spoolInfo?.filament_weight_g != null;
  const remainPct = hasDbWeight && hasDbTotal
    ? Math.round((spoolInfo.remaining_weight_g / spoolInfo.filament_weight_g) * 100)
    : tray.remain ?? 0;
  const remainLabel = hasDbWeight
    ? `${Math.round(spoolInfo.remaining_weight_g)}g`
    : `${tray.remain}%`;

  const barColor = color || "#3b82f6";
  const barPct = Math.max(0, Math.min(100, remainPct));
  const barAccent = barPct > 30 ? barColor : "#ef4444";

  return (
    <div className={clsx(
      "rounded-xl p-3 border transition-all duration-300 flex flex-col gap-2",
      isActive
        ? "border-blue-500/50 bg-blue-500/5 shadow-md shadow-blue-500/10"
        : "border-white/[0.06] bg-white/[0.03]",
      empty && "opacity-50"
    )}>
      {/* Ligne principale: couleur + nom + actif */}
      <div className="flex items-start gap-2">
        <div className={clsx(
          "w-4 h-4 rounded-md shrink-0 mt-0.5 ring-1 transition-all",
          isActive ? "ring-blue-400/60 scale-110" : "ring-white/10"
        )}
          style={{ backgroundColor: color || "#1f2937" }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold text-gray-200 truncate leading-tight">
              {empty ? "Vide" : (name || "—")}
            </p>
            {isActive && (
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            )}
          </div>
          {!empty && (
            <p className="text-[10px] text-gray-500 truncate">
              {[brand, material].filter(Boolean).join(" · ") || tray.filament_type || "—"}
            </p>
          )}
        </div>
        {!empty && (
          <span className="text-[10px] mono text-gray-500 shrink-0">{remainLabel}</span>
        )}
      </div>

      {/* Barre de reste */}
      {!empty && (
        <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${barPct}%`, backgroundColor: barAccent }} />
        </div>
      )}
    </div>
  );
}

// ── AMS Section principale ────────────────────────────────────────────────────

export default function AMSSection({ amsList, activeTray, spoolLookup }) {
  const [selectedAms, setSelectedAms] = useState(null);

  if (!amsList?.length) return (
    <div className="card p-6 text-center text-gray-600 text-sm">Aucun AMS détecté</div>
  );

  // AMS actuellement actif (celui qui contient le tray actif)
  const activeAmsId = activeTray >= 0 ? Math.floor(activeTray / 4) : -1;

  // AMS sélectionné pour le détail: celui qu'on a cliqué, ou l'actif par défaut
  const displayAmsId = selectedAms ?? activeAmsId ?? 0;
  const displayAms = amsList.find(a => a.id === displayAmsId) ?? amsList[0];

  // Lookup spool: par tag_uid (prioritaire) puis uuid court
  const getSpoolInfo = (tray) => {
    if (!spoolLookup) return null;
    return spoolLookup[tray.tag_uid]
      ?? spoolLookup[tray.uuid]
      ?? null;
  };

  return (
    <div className="card overflow-hidden">
      {/* Vue compacte des AMS avec sélection */}
      <div className="p-3 pb-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pb-3">
          {amsList.map(ams => (
            <button key={ams.id} onClick={() => setSelectedAms(ams.id)}
              className="transition-all duration-200 hover:scale-[1.02] active:scale-95">
              <AMSBox ams={ams} activeTrayGlobal={activeTray} />
              <div className={clsx(
                "mt-1.5 mx-auto h-0.5 rounded-full transition-all duration-300",
                ams.id === displayAmsId ? "w-12 bg-blue-500" : "w-4 bg-white/[0.08]"
              )} />
            </button>
          ))}
        </div>
      </div>

      {/* Séparateur */}
      <div className="mx-3 border-t border-white/[0.05]" />

      {/* Détail des 4 slots de l'AMS sélectionné */}
      {displayAms && (
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-gray-600 uppercase tracking-widest font-medium">
              AMS {displayAms.id + 1} — Slots
            </p>
            {activeAmsId === displayAms.id && (
              <span className="text-[9px] text-blue-400 font-medium">● En cours</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {displayAms.trays.map(tray => (
              <TrayDetail
                key={tray.id}
                tray={tray}
                amsId={displayAms.id}
                activeTrayGlobal={activeTray}
                spoolInfo={getSpoolInfo(tray)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
