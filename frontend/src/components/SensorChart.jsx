import React, { useMemo, useRef, useState } from "react";

// Les courbes des releves de capteurs (03/11/2026) : la petite des tuiles (SensorSpark) et la grande de la page
// Machine (SensorChart). Une courbe par serie, a sa couleur, sur le temps reel (un trou de plus de 15 minutes, une
// imprimante injoignable, coupe la ligne au lieu de la tirer droit).
const GAP_MS = 15 * 60000;
// le trou qui coupe une ligne : 15 minutes, ou 2,5 fois l'ecart habituel des points (sur 7 jours, le serveur rend des
// moyennes de 20 a 30 minutes : un seuil fixe aurait coupe chaque point de son voisin)
function gapOf(pts) {
  const d = [];
  for (let i = 1; i < pts.length; i++) d.push(pts[i].t - pts[i - 1].t);
  d.sort((a, b) => a - b);
  return Math.max(GAP_MS, (d[Math.floor(d.length / 2)] || 0) * 2.5);
}

/** [{t (ms), v}] d'une serie : pick(point) donne la valeur (null : rien ce coup-ci). */
export function seriesOf(points, pick) {
  return (points || []).map(p => ({ t: Date.parse(p.t), v: pick(p) })).filter(x => x.v != null && !Number.isNaN(x.t));
}

// les morceaux d'une serie (coupee aux trous), en coordonnees 0..100 x 0..h
function paths(pts, x, y) {
  const out = [], gap = gapOf(pts);
  let cur = [];
  pts.forEach((p, i) => {
    if (i && p.t - pts[i - 1].t > gap) { if (cur.length) out.push(cur); cur = []; }
    cur.push(`${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`);
  });
  if (cur.length) out.push(cur);
  return out;
}

function bounds(lines, from, to, lo, hi) {
  const all = lines.flatMap(l => l.pts.filter(p => p.t >= from && p.t <= to).map(p => p.v));
  if (!all.length) return null;
  let a = lo ?? Math.min(...all), b = hi ?? Math.max(...all);
  if (b - a < 4) { const m = (a + b) / 2; a = lo ?? m - 2; b = hi ?? m + 2; }
  const pad = (b - a) * 0.08;
  return [lo ?? a - pad, hi ?? b + pad];
}

// les noms courts au bout des lignes, ecartes de 10 px pour ne pas se chevaucher, dans la hauteur de la courbe
function ends(lines, y, height) {
  const e = lines.filter(l => l.short).map(l => ({ l, top: y(l.pts[l.pts.length - 1].v) - 5 })).sort((a, b) => a.top - b.top);
  e.forEach((x, i) => { x.top = Math.max(i ? e[i - 1].top + 10 : 0, x.top); });
  for (let i = e.length - 1; i >= 0; i--) e[i].top = Math.max(0, Math.min(e[i].top, i === e.length - 1 ? height - 10 : e[i + 1].top - 10));
  return e;
}

/** La petite courbe d'une tuile : une ligne par serie, et au bout de chacune son nom court a sa couleur. */
export function SensorSpark({ lines, hours = 24, height = 34, lo, hi }) {
  const to = Date.now(), from = to - hours * 3600000;
  const live = lines.filter(l => l.pts.some(p => p.t >= from));
  const b = bounds(live, from, to, lo, hi);
  if (!b) return null;
  const x = t => ((t - from) / (to - from)) * 100;
  const y = v => height - 3 - ((v - b[0]) / (b[1] - b[0] || 1)) * (height - 6);
  const tip = live.map(l => { const last = l.pts[l.pts.length - 1]; return `${l.label} ${Math.round(last.v)}${l.unit || ""}`; }).join(" · ");
  return <div data-tip={`${hours} dernières heures · ${tip}`} style={{ position: "relative", height, flexShrink: 0, paddingRight: live.some(l => l.short) ? 18 : 0 }}>
    <svg data-pk="" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block", overflow: "visible" }} aria-hidden="true">
      {live.map(l => paths(l.pts.filter(p => p.t >= from), x, y).map((seg, i) =>
        <polyline key={`${l.key}${i}`} points={seg.join(" ")} fill="none" stroke={l.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
          vectorEffect="non-scaling-stroke" opacity={0.95}/>))}
    </svg>
    {ends(live, y, height).map(({ l, top }) => <span key={l.key} style={{ position: "absolute", right: 0, top,
      fontSize: 9, fontWeight: 900, lineHeight: "10px", color: l.color }}>{l.short}</span>)}
  </div>;
}

const fmtH = (t, days) => new Date(t).toLocaleString("fr-FR", days > 2 ? { weekday: "short", day: "numeric" } : days > 1 ? { weekday: "short", hour: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

/** La grande courbe : grille, heures ou jours en bas, les impressions en bandes pales, la valeur de chaque serie au doigt. */
export function SensorChart({ lines, points, hours = 24, height = 180, unit = "", lo, hi }) {
  const ref = useRef(null);
  const [at, setAt] = useState(null);
  const to = Date.now(), from = to - hours * 3600000;
  const b = bounds(lines, from, to, lo, hi);
  const bands = useMemo(() => {
    const out = [], gap = gapOf((points || []).map(p => ({ t: Date.parse(p.t) })));
    let s = null, last = null;
    for (const p of points || []) {
      const t = Date.parse(p.t);
      if (p.printing && s == null) s = t;
      if ((!p.printing || (last && t - last > gap)) && s != null) { out.push([s, last ?? t]); s = p.printing ? t : null; }
      last = t;
    }
    if (s != null) out.push([s, last]);
    return out;
  }, [points]);
  if (!b) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
    Pas encore de relevé sur cette période</div>;
  const W = 100, H = height;
  const x = t => ((t - from) / (to - from)) * W;
  const y = v => H - 18 - ((v - b[0]) / (b[1] - b[0] || 1)) * (H - 26);
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find(s => (b[1] - b[0]) / s <= 5) || 100;
  const grid = [];
  for (let v = Math.ceil(b[0] / step) * step; v <= b[1]; v += step) grid.push(v);
  const days = hours / 24;
  const ticks = [];
  // des reperes ronds a l'heure locale : minuit sur plusieurs jours, sinon toutes les 4 ou 6 heures
  const tH = days > 2 ? 24 : days > 1 ? 6 : 4;
  const t0 = new Date(from); t0.setMinutes(0, 0, 0); t0.setHours(Math.ceil((t0.getHours() + (from > t0.getTime() ? 1 : 0)) / tH) * tH);
  for (let t = t0.getTime(); t < to; t += tH * 3600000) ticks.push(t);
  const near = at == null ? null : lines.map(l => {
    let best = null;
    for (const p of l.pts) if (p.t >= from && (!best || Math.abs(p.t - at) < Math.abs(best.t - at))) best = p;
    return best && Math.abs(best.t - at) <= gapOf(l.pts) ? { l, p: best } : null;
  }).filter(Boolean);
  const move = e => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    setAt(from + Math.max(0, Math.min(1, cx / r.width)) * (to - from));
  };
  return <div ref={ref} onMouseMove={move} onMouseLeave={() => setAt(null)} onTouchStart={move} onTouchMove={move} onTouchEnd={() => setAt(null)}
    style={{ position: "relative", height, touchAction: "pan-y", userSelect: "none" }}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
      {bands.map(([a, c], i) => <rect key={i} x={x(Math.max(a, from))} y={0} width={Math.max(0.3, x(c) - x(Math.max(a, from)))} height={H - 18}
        fill="rgba(59,130,246,.10)"/>)}
      {grid.map(v => <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 4"/>)}
      {lines.map(l => paths(l.pts.filter(p => p.t >= from), x, y).map((seg, i) => <React.Fragment key={`${l.key}${i}`}>
        <polyline points={seg.join(" ")} fill="none" stroke={l.color} strokeWidth={l.dash ? 1.5 : 2.2} strokeLinejoin="round" strokeLinecap="round"
          vectorEffect="non-scaling-stroke" strokeDasharray={l.dash ? "5 4" : undefined} opacity={l.dash ? 0.8 : 1}/>
      </React.Fragment>))}
      {at != null && <line x1={x(at)} x2={x(at)} y1={0} y2={H - 18} stroke="var(--muted)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>}
    </svg>
    {grid.map(v => <span key={v} style={{ position: "absolute", left: 2, top: y(v) - 13, fontSize: 9.5, fontWeight: 800, color: "var(--muted)" }}>{v}{unit}</span>)}
    {ticks.map(t => <span key={t} style={{ position: "absolute", bottom: 0, left: `${x(t)}%`, transform: "translateX(-50%)", fontSize: 9.5, fontWeight: 800,
      color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtH(t, days)}</span>)}
    {near && near.length > 0 && <div style={{ position: "absolute", top: 4, [x(at) > 60 ? "right" : "left"]: x(at) > 60 ? `${100 - x(at) + 1.5}%` : `${x(at) + 1.5}%`,
      padding: "6px 9px", borderRadius: 10, background: "var(--sheet-bg, var(--surface))", border: "1px solid var(--border)", boxShadow: "0 6px 16px -8px rgba(0,0,0,.4)",
      fontSize: 11.5, fontWeight: 800, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 1 }}>
      <div style={{ color: "var(--muted)", marginBottom: 2 }}>{new Date(at).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</div>
      {near.map(({ l, p }) => <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.color }}/><span style={{ color: "var(--text2)" }}>{l.label}</span>
        <span style={{ marginLeft: "auto", paddingLeft: 8, color: l.color }}>{Number(p.v).toFixed(unit === "%" ? 0 : 1).replace(".", ",")}{unit}</span></div>)}
    </div>}
  </div>;
}

/** La legende : une pastille par serie, sa derniere valeur (les consignes, en pointilles, en une seule pastille). */
export function SensorLegend({ lines, unit = "" }) {
  const dashed = lines.some(l => l.dash);
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {dashed && <span style={{ order: 1, display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 800,
      color: "var(--muted)", border: "1px dashed var(--border)" }}>
      <svg width="16" height="4" aria-hidden="true"><line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3"/></svg>consignes</span>}
    {lines.filter(l => !l.dash).map(l => { const last = l.pts[l.pts.length - 1];
      return <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 800,
        color: "var(--text2)", background: `color-mix(in srgb, ${l.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${l.color} 30%, transparent)` }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.color }}/>{l.label}
        {last && <b style={{ color: l.color }}>{Number(last.v).toFixed(unit === "%" ? 0 : 1).replace(".", ",")}{unit}</b>}</span>; })}
  </div>;
}

// les couleurs des AMS (dans l'ordre de leur numero) et des sources de chaleur
export const AMS_COLORS = ["#06B6D4", "#8B5CF6", "#F59E0B", "#EC4899", "#22C55E", "#3B82F6", "#F43F5E", "#14B8A6"];
export const HEAT_COLORS = { nozzle: "#F97316", nozzle2: "#FB923C", bed: "#EF4444", chamber: "#3B82F6" };
// comme les tuiles : AMS-A, AMS-B… et HT-A, HT-B… pour les AMS HT (numerotes a partir de 128)
const amsLetter = n => String.fromCharCode(65 + (n >= 128 ? n - 128 : n));
export const amsShort = id => { const n = Number(id); return n >= 128 ? `H${amsLetter(n)}` : amsLetter(n); };
export const amsName = id => { const n = Number(id); return n >= 128 ? `HT-${amsLetter(n)}` : `AMS-${amsLetter(n)}`; };

/** Les series d'humidite (ou de temperature, k = 1) de chaque AMS, dans l'ordre de leur numero. */
export function amsLines(points, k = 0) {
  const ids = [...new Set((points || []).flatMap(p => Object.keys(p.ams || {})))].sort((a, b) => Number(a) - Number(b));
  return ids.map((id, i) => ({ key: `a${id}`, label: amsName(id), short: amsShort(id), color: AMS_COLORS[i % AMS_COLORS.length], unit: k ? "°" : "%",
    pts: seriesOf(points, p => { const v = p.ams?.[id]?.[k]; return v ? v : null; }) })).filter(l => l.pts.length);
}

// les ventilateurs, en %
export const FAN_COLORS = { fan_part: "#14B8A6", fan_aux: "#A855F7", fan_head: "#94A3B8", fan_chamber: "#0EA5E9" };
export function fanLines(points) {
  return [["fan_part", "Pièce", "P"], ["fan_aux", "Auxiliaire", "A"], ["fan_chamber", "Chambre", "C"], ["fan_head", "Tête", "T"]]
    .map(([k, label, short]) => ({ key: k, label, short, color: FAN_COLORS[k], unit: "%", pts: seriesOf(points, p => p[k]) }))
    .filter(l => l.pts.some(p => p.v > 0));
}

/** Les series de chaleur : buse(s), plateau, chambre ; avec targets, leurs consignes en pointilles a la meme couleur
 *  (seulement celles qui ont eu une consigne sur la periode). */
export function heatLines(points, { chamber = true, only = null, targets = false } = {}) {
  const two = (points || []).some(p => p.nozzle2 != null);
  const src = [["nozzle", two ? "Buse active" : "Buse", "B"], ...(two ? [["nozzle2", "Autre buse", "B2"]] : []), ["bed", "Plateau", "P"], ...(chamber ? [["chamber", "Chambre", "C"]] : [])]
    .filter(([k]) => !only || only.includes(k));
  const main = src.map(([k, label, short]) => ({ key: k, label, short, color: HEAT_COLORS[k], unit: "°", pts: seriesOf(points, p => p[k]) }));
  const tgt = targets ? src.map(([k, label]) => ({ key: `${k}_t`, label: `Consigne ${label.toLowerCase()}`, color: HEAT_COLORS[k], unit: "°", dash: true,
    pts: seriesOf(points, p => p[`${k}_t`]) })) : [];
  return [...main, ...tgt].filter(l => l.pts.length);
}
