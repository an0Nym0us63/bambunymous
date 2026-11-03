import React, { useEffect, useMemo, useState } from "react";
import { useSensorHistory } from "../store/sensors";
import { SensorChart, SensorLegend, amsLines, heatLines, fanLines, seriesOf } from "./SensorChart";
import { egg } from "../eggs";

// Stats › Machine (03/11/2026) : les releves des capteurs sur 24 h, 3 ou 7 jours (le serveur n'en garde pas plus).
// En tete le bilan de la periode, puis une carte par mesure : buse et plateau, chambre, humidite des AMS, leur
// temperature, ventilateurs. Les impressions sont les bandes bleues pales des courbes.
const PERIODS = [[24, "24 h"], [72, "3 jours"], [168, "7 jours"]];

const card = c => ({ padding: "14px 14px 12px", borderRadius: 20, border: `1px solid color-mix(in srgb, ${c} 26%, var(--border))`,
  background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${c} 13%, transparent), transparent 60%), var(--surface)`,
  display: "flex", flexDirection: "column", gap: 10 });
const title = c => ({ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: c });
const n1 = v => v == null ? "—" : Number(v).toFixed(1).replace(".", ",");

function Kpi({ v, l, c, sub }) {
  return <div style={{ minWidth: 0, padding: "9px 11px", borderRadius: 16, border: `1px solid color-mix(in srgb, ${c} 28%, transparent)`,
    background: `linear-gradient(135deg, color-mix(in srgb, ${c} 14%, transparent), transparent 80%), var(--surface)` }}>
    <div style={{ fontSize: 19, fontWeight: 900, color: c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
    <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{l}</div>
    {sub && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
  </div>;
}

// min / moyenne / max d'une serie sur la periode
const range = pts => { const v = pts.map(p => p.v); return v.length ? { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length } : null; };

function Ranges({ lines, unit }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
    {lines.map(l => { const r = range(l.pts);
      return r && <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 12, background: "var(--surface2)", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.color, flexShrink: 0 }}/>
        <span style={{ color: "var(--text2)", fontWeight: 800, whiteSpace: "nowrap" }}>{l.short || l.label}</span>
        <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{Math.round(r.min)}–{Math.round(r.max)}{unit} · moy. <b style={{ color: l.color }}>{Math.round(r.avg)}{unit}</b></span>
      </div>; })}
  </div>;
}

export default function MachineStats() {
  const [hours, setHours] = useState(24);
  const pts = useSensorHistory(hours);
  useEffect(() => { egg("machine_vue"); }, []);
  const d = useMemo(() => {
    if (!pts) return null;
    const hum = amsLines(pts, 0), amsT = amsLines(pts, 1);
    const heat = heatLines(pts, { chamber: false, targets: true });
    const ch = heatLines(pts, { only: ["chamber"], targets: true });
    // le temps passe a imprimer : la somme des intervalles entre deux releves « en impression » (au plus 15 min chacun)
    let printed = 0;
    for (let i = 1; i < pts.length; i++) {
      const dt = Date.parse(pts[i].t) - Date.parse(pts[i - 1].t);
      if (pts[i].printing && pts[i - 1].printing && dt <= 15 * 60000) printed += dt;
    }
    const allH = hum.flatMap(l => l.pts.map(p => p.v));
    const wet = hum.map(l => ({ l, r: range(l.pts) })).filter(x => x.r).sort((a, b) => b.r.max - a.r.max)[0];
    const nz = range(seriesOf(pts, p => p.nozzle));
    return { hum, amsT, heat, ch: ch.some(l => !l.dash) ? ch : [], fans: fanLines(pts),
      printed, avgH: allH.length ? allH.reduce((a, b) => a + b, 0) / allH.length : null, wet, nz };
  }, [pts]);

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {PERIODS.map(([h, l]) => <button key={h} type="button" onClick={() => setHours(h)}
        style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12.5, fontWeight: 800, cursor: "pointer",
          border: hours === h ? "none" : "1px solid var(--border)", color: hours === h ? "#fff" : "var(--text2)",
          background: hours === h ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "var(--surface)" }}>{l}</button>)}
      <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "rgba(59,130,246,.18)", verticalAlign: "-1px", marginRight: 5 }}/>en impression</span>
    </div>

    {pts == null ? <div style={{ padding: 30, textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>Chargement des relevés…</div>
      : !pts.length ? <div style={{ ...card("#64748B"), alignItems: "center", textAlign: "center", padding: 28 }}>
        <div style={{ fontSize: 28 }}>📈</div>
        <div style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>Pas encore de relevé</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", maxWidth: 420 }}>Les capteurs de l'imprimante sont relevés toutes les 5 minutes (chaque minute pendant une impression) et gardés 7 jours. Les courbes arrivent avec les premiers relevés.</div>
      </div> : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6 }}>
        {d.nz && <Kpi v={`${Math.round(d.nz.max)}°`} l="buse au plus chaud" c="#F97316"/>}
        <Kpi v={d.avgH != null ? `${Math.round(d.avgH)} %` : "—"} l="humidité moyenne" c="#06B6D4"/>
        {d.wet && <Kpi v={`${Math.round(d.wet.r.max)} %`} l="le plus humide" c={d.wet.r.max >= 40 ? "#EF4444" : d.wet.r.max >= 30 ? "#F59E0B" : "#22C55E"} sub={d.wet.l.label}/>}
        <Kpi v={d.printed >= 3600000 ? `${n1(d.printed / 3600000)} h` : `${Math.round(d.printed / 60000)} min`} l="en impression" c="#3B82F6"/>
      </div>

      {d.heat.length > 0 && <div style={card("#F97316")}>
        <div style={title("#EA580C")}>🔥 Buse et plateau</div>
        <SensorLegend lines={d.heat} unit="°"/>
        <SensorChart lines={d.heat} points={pts} hours={hours} height={200} unit="°" lo={0}/>
        <Ranges lines={d.heat.filter(l => !l.dash)} unit="°"/>
      </div>}
      {d.ch.length > 0 && <div style={card("#3B82F6")}>
        <div style={title("#2563EB")}>📦 Chambre</div>
        {d.ch.some(l => l.dash) && <SensorLegend lines={d.ch} unit="°"/>}
        <SensorChart lines={d.ch} points={pts} hours={hours} height={150} unit="°"/>
        <Ranges lines={d.ch.filter(l => !l.dash)} unit="°"/>
      </div>}
      {d.hum.length > 0 && <div style={card("#06B6D4")}>
        <div style={title("#0891B2")}>💧 Humidité des AMS</div>
        <SensorLegend lines={d.hum} unit="%"/>
        <SensorChart lines={d.hum} points={pts} hours={hours} height={190} unit="%"/>
        <Ranges lines={d.hum} unit="%"/>
      </div>}
      {d.amsT.length > 0 && <div style={card("#8B5CF6")}>
        <div style={title("#7C3AED")}>🌡️ Température des AMS</div>
        <SensorLegend lines={d.amsT} unit="°"/>
        <SensorChart lines={d.amsT} points={pts} hours={hours} height={160} unit="°"/>
      </div>}
      {d.fans.length > 0 && <div style={card("#14B8A6")}>
        <div style={title("#0D9488")}>🌀 Ventilateurs</div>
        <SensorLegend lines={d.fans} unit="%"/>
        <SensorChart lines={d.fans} points={pts} hours={hours} height={160} unit="%" lo={0} hi={100}/>
      </div>}
    </>}
  </div>;
}
