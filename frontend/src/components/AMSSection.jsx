import React, { useState } from "react";
import clsx from "clsx";
import { Droplets, Sun } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function hexCss(hex) {
  if (!hex) return null;
  const h = hex.slice(0, 6);
  if (h.replace(/0/g, "") === "") return null;
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

// Parse colors_array (CSV hex) ou color simple
function parseColors(tray, spoolInfo) {
  // Priorité: DB colors_array → DB color → tray color
  const arr = spoolInfo?.colors_array || tray?.colors_array;
  if (arr) {
    const cols = arr.split(",").map(c => c.trim()).filter(Boolean);
    if (cols.length > 1) return cols.map(c => `#${c.slice(0,6)}`);
  }
  const single = hexCss(spoolInfo?.filament_color || tray?.color);
  return single ? [single] : null;
}

// ── Fond couleur (supporte multicolore) ────────────────────────────────────

function colorStyle(colors) {
  if (!colors || colors.length === 0) return { backgroundColor: "rgba(255,255,255,0.05)" };
  if (colors.length === 1) return { backgroundColor: colors[0] };
  // Multicolore: radial gradient centré
  const stops = colors.map((c, i) => {
    const pct = Math.round((i / (colors.length - 1)) * 100);
    return `${c} ${pct}%`;
  }).join(", ");
  return { background: `conic-gradient(${colors.map((c,i) =>
    `${c} ${Math.round(i/colors.length*360)}deg ${Math.round((i+1)/colors.length*360)}deg`
  ).join(", ")})` };
}

const AMS_NAMES = ["AMS-A", "AMS-B", "AMS-C", "AMS-D"];

// ── Mini pastille (vue compacte) ────────────────────────────────────────────

function ColorPill({ tray, spoolInfo, active }) {
  const colors = parseColors(tray, spoolInfo);
  const style = colors ? colorStyle(colors) : { backgroundColor: "rgba(255,255,255,0.05)" };
  return (
    <div className={clsx(
      "h-7 flex-1 rounded-md transition-all duration-300 ring-1",
      active ? "ring-white scale-110 shadow-md" : "ring-white/10"
    )} style={style} />
  );
}

// ── Boîtier AMS compact ────────────────────────────────────────────────────

function AMSBox({ ams, activeAmsId, activeTrayId, isSelected, onClick, spoolLookup }) {
  const isActive = ams.id === activeAmsId;
  const getInfo  = t => spoolLookup?.[t.tag_uid] ?? spoolLookup?.[t.uuid] ?? null;

  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-1.5 w-full transition-all duration-200 hover:scale-[1.02] active:scale-95">
      <div className="flex items-center gap-1">
        <span className={clsx("text-[10px] font-bold tracking-wider",
          isActive ? "text-blue-400" : isSelected ? "text-gray-200" : "text-gray-500")}>
          {AMS_NAMES[ams.id] ?? `AMS ${ams.id+1}`}
        </span>
        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
      </div>

      <div className={clsx(
        "w-full rounded-xl p-1.5 flex gap-1 border transition-all duration-300",
        isActive  ? "border-blue-500/40 bg-blue-500/5 shadow-md shadow-blue-500/15"
        : isSelected ? "border-white/20 bg-white/[0.05]"
        : "border-white/[0.07] bg-white/[0.03]"
      )}>
        {ams.trays.map(tray => (
          <ColorPill
            key={tray.id}
            tray={tray}
            spoolInfo={getInfo(tray)}
            active={isActive && tray.id === activeTrayId}
          />
        ))}
      </div>

      <div className="flex gap-2 text-[9px] text-gray-600">
        <span className="flex items-center gap-0.5"><Droplets size={8}/>{ams.humidity}%</span>
        <span className="flex items-center gap-0.5"><Sun size={8}/>{ams.temp}°</span>
      </div>

      <div className={clsx("h-0.5 rounded-full transition-all duration-300",
        isSelected ? "w-10 bg-blue-500" : "w-3 bg-white/[0.08]")} />
    </button>
  );
}

// ── Bobine SVG (multicolore) ───────────────────────────────────────────────

function SpoolSVG({ colors, empty, size = 68, active }) {
  const mainColor = colors?.[0] || (empty ? "#1a1a1a" : "#333");
  const dark  = luminance(mainColor.replace("#","")) < 140;
  const shine = dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.28)";
  const id    = `spool-${Math.random().toString(36).slice(2,7)}`;

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {/* Def gradient multicolore */}
      {colors && colors.length > 1 && (
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
            {colors.map((c, i) => (
              <stop key={i} offset={`${Math.round(i/(colors.length-1)*100)}%`} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
      )}

      {/* Ombre */}
      <ellipse cx="40" cy="75" rx="22" ry="3.5" fill="rgba(0,0,0,0.3)" />

      {/* Flasque */}
      <ellipse cx="40" cy="40" rx="28" ry="28"
        fill={empty ? "#1e1e1e" : (colors?.length > 1 ? `url(#${id})` : mainColor)} />
      <ellipse cx="40" cy="40" rx="28" ry="28" fill="rgba(0,0,0,0.15)" />

      {/* Corps */}
      <rect x="19" y="23" width="42" height="34" rx="2"
        fill={empty ? "#161616" : (colors?.length > 1 ? `url(#${id})` : mainColor)} />
      {!empty && <rect x="19" y="23" width="42" height="34" rx="2" fill="rgba(0,0,0,0.08)" />}
      <rect x="19" y="23" width="42" height="9" rx="2" fill={shine} />

      {/* Tranches */}
      {!empty && <>
        <rect x="16" y="20" width="4" height="40" rx="2"
          fill={colors?.length > 1 ? `url(#${id})` : mainColor} />
        <rect x="16" y="20" width="4" height="40" rx="2" fill="rgba(0,0,0,0.22)" />
        <rect x="60" y="20" width="4" height="40" rx="2"
          fill={colors?.length > 1 ? `url(#${id})` : mainColor} />
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

function TrayCard({ tray, amsId, label, activeAmsId, activeTrayId, spoolInfo }) {
  const isActive = amsId === activeAmsId && tray.id === activeTrayId;
  const empty    = isEmptyTray(tray);
  const colors   = parseColors(tray, spoolInfo);

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

  const barStyle = colors?.length > 1
    ? { background: `linear-gradient(90deg, ${colors.join(", ")})`, opacity: pct/100 + 0.1 }
    : { backgroundColor: pct > 30 ? (colors?.[0] || "#3b82f6") : "#ef4444" };

  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-[10px] text-gray-500 font-medium h-4 leading-none truncate max-w-[72px] text-center">
        {empty ? "" : (material || "—")}
      </p>
      <div className="w-12 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        {!empty && (
          <div className="h-full rounded-full transition-all duration-700"
            style={{ ...barStyle, width: `${Math.max(0, Math.min(100, pct))}%` }} />
        )}
      </div>
      <div className={clsx("relative transition-all duration-300", isActive && "scale-105")}>
        <SpoolSVG colors={empty ? null : colors} empty={empty} size={68} active={isActive} />
        <div className={clsx(
          "absolute bottom-2.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap",
          isActive ? "bg-blue-500 text-white" : "bg-black/50 text-white/75"
        )}>
          {label}
        </div>
      </div>
      <p className="text-[9px] text-gray-500 mono">{empty ? "" : weightLabel}</p>
      <p className="text-[9px] text-gray-400 text-center truncate w-16 leading-tight">
        {empty ? "Vide" : (name || tray.tray_id_name || "—")}
      </p>
    </div>
  );
}

// ── Détail AMS ─────────────────────────────────────────────────────────────

function AMSDetail({ ams, activeAmsId, activeTrayId, spoolLookup }) {
  const isActive = ams.id === activeAmsId;
  const getInfo  = t => spoolLookup?.[t.tag_uid] ?? spoolLookup?.[t.uuid] ?? null;

  return (
    <div className={clsx(
      "card p-4 transition-all duration-500",
      isActive && "border-blue-500/25 shadow-lg shadow-blue-500/8"
    )}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={clsx("text-xs font-bold tracking-wider",
            isActive ? "text-blue-400" : "text-gray-400")}>
            {AMS_NAMES[ams.id] ?? `AMS ${ams.id+1}`}
          </span>
          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
        </div>
        <div className="flex gap-3 text-[10px] text-gray-600">
          <span className="flex items-center gap-1"><Droplets size={10}/>{ams.humidity}%</span>
          <span className="flex items-center gap-1"><Sun size={10}/>{ams.temp}°C</span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {ams.trays.map(tray => (
          <TrayCard
            key={tray.id}
            tray={tray}
            amsId={ams.id}
            label={`${AMS_NAMES[ams.id]?.slice(-1) ?? ams.id+1}${tray.id+1}`}
            activeAmsId={activeAmsId}
            activeTrayId={activeTrayId}
            spoolInfo={getInfo(tray)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Section principale ─────────────────────────────────────────────────────

export default function AMSSection({ amsList, activeAmsId, activeTrayId, spoolLookup }) {
  // AMS sélectionné par clic — null = auto (actif ou premier)
  const [selectedId, setSelectedId] = useState(null);

  if (!amsList?.length) return (
    <div className="card p-6 text-center text-gray-600 text-sm">Aucun AMS détecté</div>
  );

  // displayId: sélection manuelle > AMS actif > premier AMS
  const autoId    = activeAmsId >= 0 ? activeAmsId : amsList[0]?.id ?? 0;
  const displayId = selectedId !== null ? selectedId : autoId;
  const displayAms = amsList.find(a => a.id === displayId) ?? amsList[0];

  const handleClick = (amsId) => {
    // Re-cliquer sur le sélectionné → revenir à l'auto
    setSelectedId(prev => prev === amsId ? null : amsId);
  };

  return (
    <div className="space-y-3">
      {/* Sélecteur compact */}
      <div className="card p-3">
        <div className={clsx(
          "grid gap-3",
          amsList.length <= 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"
        )}>
          {amsList.map(ams => (
            <AMSBox
              key={ams.id}
              ams={ams}
              activeAmsId={activeAmsId}
              activeTrayId={activeTrayId}
              isSelected={ams.id === displayId}
              onClick={() => handleClick(ams.id)}
              spoolLookup={spoolLookup}
            />
          ))}
        </div>
      </div>

      {/* Détail */}
      {displayAms && (
        <AMSDetail
          ams={displayAms}
          activeAmsId={activeAmsId}
          activeTrayId={activeTrayId}
          spoolLookup={spoolLookup}
        />
      )}
    </div>
  );
}
