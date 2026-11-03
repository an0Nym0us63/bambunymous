import React, { useEffect, useMemo, useState } from "react";
import { useSensorHistory, useSensorEvents } from "../store/sensors";
import MachineTimeline from "./MachineTimeline";
import { SensorChart, SensorLegend, amsLines, heatLines, fanLines, seriesOf } from "./SensorChart";
import { egg } from "../eggs";

// Stats › Machine (03/11/2026) : les releves des capteurs sur 24 h, 3 ou 7 jours (le serveur n'en garde pas plus).
// En tete le bilan de la periode, puis une carte par mesure : buse et plateau, chambre, humidite des AMS, leur
// temperature, ventilateurs. Les impressions sont les bandes bleues pales des courbes.
const PERIODS = [[3, "3 h"], [6, "6 h"], [12, "12 h"], [24, "24 h"], [72, "3 jours"], [168, "7 jours"]];
const KEEP_MS = 7 * 86400000;            // ce que le serveur garde
// la fenetre en clair : « lun. 2 nov. 14:00 → 17:00 », ou deux jours quand elle les enjambe
const winLabel = (from, to) => {
  const a = new Date(from), b = new Date(to), same = a.toDateString() === b.toDateString();
  const day = d => d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  const hm = d => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return same ? `${day(a)} · ${hm(a)} → ${hm(b)}` : `${day(a)} ${hm(a)} → ${day(b)} ${hm(b)}`;
};

const card = c => ({ padding: "14px 14px 12px", borderRadius: 20, border: `1px solid color-mix(in srgb, ${c} 26%, var(--border))`,
  background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${c} 13%, transparent), transparent 60%), var(--surface)`,
  display: "flex", flexDirection: "column", gap: 10 });
const title = c => ({ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: c });
const n1 = v => v == null ? "—" : Number(v).toFixed(1).replace(".", ",");

const nav = on => ({ width: 34, height: 32, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: on ? "var(--text)" : "var(--muted)",
  fontSize: 18, fontWeight: 900, cursor: on ? "pointer" : "default", opacity: on ? 1 : 0.45, flexShrink: 0, lineHeight: 1 });

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
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 6 }}>
    {lines.map(l => { const r = range(l.pts);
      return r && <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 12, background: "var(--surface2)", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.color, flexShrink: 0 }}/>
        {/* le nom en clair (« B » ne disait rien), et une seule valeur quand elle n'a pas bouge */}
        <span style={{ color: "var(--text2)", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{l.label}</span>
        <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }} data-tip="Le plus bas, le plus haut et la moyenne sur la fenêtre">
          {Math.round(r.min) === Math.round(r.max) ? <>stable · <b style={{ color: l.color }}>{Math.round(r.avg)}{unit}</b></>
            : <>{Math.round(r.min)}–{Math.round(r.max)}{unit} · moy. <b style={{ color: l.color }}>{Math.round(r.avg)}{unit}</b></>}</span>
      </div>; })}
  </div>;
}

export default function MachineStats() {
  const [hours, setHours] = useState(24);
  // end : la fin de la fenetre regardee (ms), null : maintenant. Les fleches reculent ou avancent d'une fenetre,
  // jamais avant ce que le serveur garde ni apres maintenant
  const [end, setEnd] = useState(null);
  const pts = useSensorHistory(hours, true, end);
  const events = useSensorEvents(hours, end, pts);
  // l'evenement choisi dans la chronologie : son heure sur chaque courbe
  const [pick, setPick] = useState(null);
  // des evenements reunis sur la frise : la plus petite fenetre qui les contient (3 h au moins), centree sur eux
  const zoomTo = (a, b) => {
    const h = PERIODS.map(p => p[0]).find(x => x * 3600000 >= (b - a) * 1.4 && x < hours) || 3;
    const e = Math.round(((a + b) / 2 + h * 1800000) / 60000) * 60000;
    setHours(h);
    setEnd(e >= Date.now() - 60000 ? null : e);
  };
  const to = end || Date.now(), from = to - hours * 3600000;
  const canBack = from > Date.now() - KEEP_MS + 60000;
  const step = dir => {
    const t = Math.round((to + dir * hours * 3600000) / 60000) * 60000;
    setEnd(t >= Date.now() - 60000 ? null : Math.max(Date.now() - KEEP_MS + hours * 3600000, t));
  };
  const choosePeriod = h => { setHours(h); if (end && end - h * 3600000 < Date.now() - KEEP_MS) setEnd(Date.now() - KEEP_MS + h * 3600000); };
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
      {PERIODS.map(([h, l]) => <button key={h} type="button" onClick={() => choosePeriod(h)}
        style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12.5, fontWeight: 800, cursor: "pointer",
          border: hours === h ? "none" : "1px solid var(--border)", color: hours === h ? "#fff" : "var(--text2)",
          background: hours === h ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "var(--surface)" }}>{l}</button>)}
      <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "rgba(59,130,246,.18)", verticalAlign: "-1px", marginRight: 5 }}/>en impression</span>
    </div>
    {hours < 168 && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button type="button" onClick={() => step(-1)} disabled={!canBack} aria-label="Fenêtre précédente" data-tip="Plus tôt" style={nav(canBack)}>‹</button>
      <span style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 12.5, fontWeight: 800, color: end ? "var(--text)" : "var(--text2)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{winLabel(from, to)}{end ? "" : " · maintenant"}</span>
      <button type="button" onClick={() => step(1)} disabled={!end} aria-label="Fenêtre suivante" data-tip="Plus tard" style={nav(!!end)}>›</button>
      {end && <button type="button" onClick={() => setEnd(null)} style={{ ...nav(true), width: "auto", padding: "0 12px", fontSize: 12.5 }}>Maintenant</button>}
    </div>}

    {pts == null ? <div style={{ padding: 30, textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>Chargement des relevés…</div>
      : !pts.length ? <div style={{ ...card("#64748B"), alignItems: "center", textAlign: "center", padding: 28 }}>
        <div style={{ fontSize: 28 }}>📈</div>
        <div style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{end ? "Pas de relevé sur cette période" : "Pas encore de relevé"}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", maxWidth: 420 }}>Les capteurs de l'imprimante sont relevés toutes les 5 minutes (chaque minute pendant une impression) et gardés 7 jours. Les courbes arrivent avec les premiers relevés.</div>
      </div> : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6 }}>
        {d.nz && <Kpi v={`${Math.round(d.nz.max)}°`} l="buse au plus chaud" c="#F97316"/>}
        <Kpi v={d.avgH != null ? `${Math.round(d.avgH)} %` : "—"} l="humidité moyenne" c="#06B6D4"/>
        {d.wet && <Kpi v={`${Math.round(d.wet.r.max)} %`} l="le plus humide" c={d.wet.r.max >= 40 ? "#EF4444" : d.wet.r.max >= 30 ? "#F59E0B" : "#22C55E"} sub={d.wet.l.label}/>}
        <Kpi v={d.printed >= 3600000 ? `${n1(d.printed / 3600000)} h` : `${Math.round(d.printed / 60000)} min`} l="en impression" c="#3B82F6"/>
      </div>

      <div style={card("#F43F5E")}>
        <div style={{ ...title("#E11D48"), display: "flex", alignItems: "center", gap: 8 }}>🕒 Chronologie
          {events?.length ? <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: 0, textTransform: "none" }}>
            {events.length} événement{events.length > 1 ? "s" : ""}</span> : null}</div>
        <MachineTimeline events={events} points={pts} hours={hours} end={end} pick={pick} onPick={setPick} onZoom={zoomTo}/>
      </div>
      {d.heat.length > 0 && <div style={card("#F97316")}>
        <div style={title("#EA580C")}>🔥 Buse et plateau</div>
        <SensorLegend lines={d.heat} unit="°"/>
        <SensorChart lines={d.heat} points={pts} hours={hours} end={end} mark={pick} height={200} unit="°" lo={0}/>
        <Ranges lines={d.heat.filter(l => !l.dash)} unit="°"/>
      </div>}
      {d.ch.length > 0 && <div style={card("#3B82F6")}>
        <div style={title("#2563EB")}>📦 Chambre</div>
        {d.ch.some(l => l.dash) && <SensorLegend lines={d.ch} unit="°"/>}
        <SensorChart lines={d.ch} points={pts} hours={hours} end={end} mark={pick} height={150} unit="°"/>
        <Ranges lines={d.ch.filter(l => !l.dash)} unit="°"/>
      </div>}
      {d.hum.length > 0 && <div style={card("#06B6D4")}>
        <div style={title("#0891B2")}>💧 Humidité des AMS</div>
        <SensorLegend lines={d.hum} unit="%"/>
        <SensorChart lines={d.hum} points={pts} hours={hours} end={end} mark={pick} height={190} unit="%"/>
        <Ranges lines={d.hum} unit="%"/>
      </div>}
      {d.amsT.length > 0 && <div style={card("#8B5CF6")}>
        <div style={title("#7C3AED")}>🌡️ Température des AMS</div>
        <SensorLegend lines={d.amsT} unit="°"/>
        <SensorChart lines={d.amsT} points={pts} hours={hours} end={end} mark={pick} height={160} unit="°"/>
      </div>}
      {d.fans.length > 0 && <div style={card("#14B8A6")}>
        <div style={title("#0D9488")}>🌀 Ventilateurs</div>
        <SensorLegend lines={d.fans} unit="%"/>
        <SensorChart lines={d.fans} points={pts} hours={hours} end={end} mark={pick} height={160} unit="%" lo={0} hi={100}/>
      </div>}
    </>}
  </div>;
}
