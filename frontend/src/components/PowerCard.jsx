import React, { useEffect, useMemo, useRef, useState } from "react";
import client from "../api/client";
import { elecColor, useElecColors } from "../utils/elecColor";
import { isMoneyHidden, MONEY_MASK } from "../utils/money";

// Stats › Machine (12/11/2026) : la puissance de la prise (Home Assistant) sur la periode de la page, et en fond les
// bandes du tarif (heures creuses, pleines, jours Tempo…), aux couleurs choisies dans Parametres. Rien sans prise.
const H = 170, PAD_L = 38, PAD_B = 18, PAD_T = 8;
const card = c => ({ padding: "14px 14px 12px", borderRadius: 20, border: `1px solid color-mix(in srgb, ${c} 26%, var(--border))`,
  background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${c} 13%, transparent), transparent 60%), var(--surface)`,
  display: "flex", flexDirection: "column", gap: 10 });
const hm = ms => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const day = ms => new Date(ms).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });

export default function PowerCard({ hours }) {
  const [d, setD] = useState(null);
  const [W, setW] = useState(600);
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  useElecColors();
  useEffect(() => {
    let alive = true;
    const load = () => client.get("/settings/ha/curve", { params: { hours } }).then(r => { if (alive) setD(r.data); }).catch(() => { if (alive) setD(null); });
    setD(null); load();
    const t = setInterval(load, 120000);
    return () => { alive = false; clearInterval(t); };
  }, [hours]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [d?.configured]);
  const g = useMemo(() => {
    if (!d?.points?.length) return null;
    const p = d.points, a = p[0][0], b = p[p.length - 1][0] + (d.step || 60) * 1000;
    const top = Math.max(50, ...p.map(x => x[1])) * 1.1;
    const x = t => PAD_L + (t - a) / (b - a) * (W - PAD_L - 4), y = v => PAD_T + (1 - v / top) * (H - PAD_T - PAD_B);
    const line = p.map((q, i) => `${i ? "L" : "M"}${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join(" ");
    const area = `${line} L${x(p[p.length - 1][0]).toFixed(1)},${y(0)} L${x(p[0][0]).toFixed(1)},${y(0)} Z`;
    // les reperes du temps : 4 a 6 selon la largeur, l'heure (et le jour au-dela de 24 h)
    const n = W < 420 ? 3 : 5, ticks = Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
    const labels = [...new Set(d.bands.map(z => z.label))];
    const by = {};
    d.bands.forEach(z => { by[z.label] = (by[z.label] || 0) + (z.b - z.a); });
    return { a, b, top, x, y, line, area, ticks, labels, by, total: b - a };
  }, [d, W]);
  if (!d || !d.configured) return null;
  const money = v => isMoneyHidden() ? MONEY_MASK : `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const onMove = e => {
    if (!g) return;
    const r = e.currentTarget.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
    const t = g.a + (px - PAD_L) / (W - PAD_L - 4) * g.total;
    const p = d.points.reduce((best, q) => Math.abs(q[0] - t) < Math.abs(best[0] - t) ? q : best, d.points[0]);
    const band = d.bands.find(z => p[0] >= z.a && p[0] < z.b);
    setHover({ p, band });
  };
  return <div style={card("#EAB308")}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 26 }}>
      <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#CA8A04" }}>⚡ Consommation</span>
      {d.kwh != null && <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)" }}>
        {d.kwh.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kWh{d.cost != null ? ` · ${money(d.cost)}` : ""}</span>}
      <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 800, color: hover ? "var(--text)" : "var(--muted)", whiteSpace: "nowrap" }}>
        {hover ? `${hours > 24 ? day(hover.p[0]) + " " : ""}${hm(hover.p[0])} · ${Math.round(hover.p[1])} W${hover.band ? ` · ${hover.band.label}` : ""}` : "Home Assistant"}</span>
    </div>
    {d.error ? <div style={{ fontSize: 12.5, fontWeight: 700, color: "#ef4444" }}>{d.error}</div>
      : <div ref={box} style={{ width: "100%" }}>
        {g ? <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
          onTouchStart={e => onMove(e.touches[0] ? { ...e, clientX: e.touches[0].clientX, currentTarget: e.currentTarget } : e)}
          style={{ display: "block", touchAction: "pan-y" }} role="img" aria-label="Puissance de la prise et tarifs">
          {/* les bandes du tarif */}
          {d.bands.map((z, i) => <rect key={i} x={g.x(z.a)} y={PAD_T} width={Math.max(1, g.x(z.b) - g.x(z.a))} height={H - PAD_T - PAD_B}
            fill={elecColor(z.label)} opacity={0.22}/>)}
          {/* la grille : 0, la moitie, le haut */}
          {[0, 0.5, 1].map(k => <g key={k}>
            <line x1={PAD_L} x2={W - 4} y1={g.y(g.top / 1.1 * k)} y2={g.y(g.top / 1.1 * k)} stroke="var(--border)" strokeDasharray={k ? "3 4" : "0"}/>
            <text x={PAD_L - 5} y={g.y(g.top / 1.1 * k) + 3.5} textAnchor="end" fontSize="10" fontWeight="700" fill="var(--muted)">{Math.round(g.top / 1.1 * k)}</text>
          </g>)}
          <text x={PAD_L - 5} y={PAD_T + 2} textAnchor="end" fontSize="9" fontWeight="800" fill="var(--muted)">W</text>
          <path d={g.area} fill="#EAB308" opacity={0.22}/>
          <path d={g.line} fill="none" stroke="#CA8A04" strokeWidth="1.6" strokeLinejoin="round"/>
          {g.ticks.map((t, i) => <text key={i} x={Math.min(W - 4, Math.max(PAD_L, g.x(t)))} y={H - 4} fontSize="10" fontWeight="700" fill="var(--muted)"
            textAnchor={i === 0 ? "start" : i === g.ticks.length - 1 ? "end" : "middle"}>{hours > 24 ? `${day(t)} ${hm(t)}` : hm(t)}</text>)}
          {hover && <line x1={g.x(hover.p[0])} x2={g.x(hover.p[0])} y1={PAD_T} y2={H - PAD_B} stroke="var(--text)" strokeOpacity=".4" strokeDasharray="2 3"/>}
        </svg> : <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", padding: 14, textAlign: "center" }}>Chargement…</div>}
      </div>}
    {g && g.labels.length > 0 && <div style={{ display: "flex", gap: "4px 12px", flexWrap: "wrap", fontSize: 11.5, fontWeight: 700, color: "var(--text2)" }}>
      {g.labels.map(l => <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: elecColor(l), boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent)" }}/>
        {l} <span style={{ color: "var(--muted)" }}>· {Math.round(g.by[l] / g.total * 100)} % du temps</span></span>)}
    </div>}
  </div>;
}
