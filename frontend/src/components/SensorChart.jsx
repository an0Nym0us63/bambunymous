import React, { useId, useMemo, useRef, useState } from "react";

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
  // gap (06/11/2026) : le serveur marque les vrais trous ; un point sans valeur le transmet au suivant
  const out = [];
  let hole = false;
  for (const p of points || []) {
    const t = Date.parse(p.t), v = pick(p);
    if (p.gap) hole = true;
    if (v == null || Number.isNaN(t)) continue;
    out.push({ t, v, gap: p.gap === undefined ? undefined : hole });
    hole = false;
  }
  return out;
}
// un trou entre deux points : celui marque par le serveur s'il le dit, sinon un ecart trop grand
const cut = (pts, i, gap) => pts[i].gap !== undefined ? !!pts[i].gap : pts[i].t - pts[i - 1].t > gap;

// les morceaux d'une serie (coupee aux trous), en coordonnees 0..100 x 0..h
function segs(pts, x, y) {
  const out = [], gap = gapOf(pts);
  let cur = [];
  pts.forEach((p, i) => {
    if (i && cut(pts, i, gap)) { if (cur.length) out.push(cur); cur = []; }
    cur.push([x(p.t), y(p.v)]);
  });
  if (cur.length) out.push(cur);
  return out;
}
const paths = (pts, x, y) => segs(pts, x, y).map(sg => sg.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`));
// une courbe lissee qui ne depasse jamais ses points (Fritsch-Carlson, 03/11/2026 : les lignes brisees faisaient
// tableur) : une chauffe qui monte puis tient ne fait ni bosse ni creux
export function monoPath(P) {
  const n = P.length, f = v => v.toFixed(2);
  if (!n) return "";
  if (n < 3) return P.map(([a, b], i) => `${i ? "L" : "M"}${f(a)},${f(b)}`).join(" ");
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((P[i + 1][1] - P[i][1]) / ((P[i + 1][0] - P[i][0]) || 1e-6));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let out = `M${f(P[0][0])},${f(P[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (P[i + 1][0] - P[i][0]) / 3;
    out += ` C${f(P[i][0] + dx)},${f(P[i][1] + m[i] * dx)} ${f(P[i + 1][0] - dx)},${f(P[i + 1][1] - m[i + 1] * dx)} ${f(P[i + 1][0])},${f(P[i + 1][1])}`;
  }
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
      {live.map(l => segs(l.pts.filter(p => p.t >= from), x, y).map((sg, i) =>
        <path key={`${l.key}${i}`} d={monoPath(sg)} fill="none" stroke={l.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
          vectorEffect="non-scaling-stroke" opacity={0.95}/>))}
    </svg>
    {ends(live, y, height).map(({ l, top }) => <span key={l.key} style={{ position: "absolute", right: 0, top,
      fontSize: 9, fontWeight: 900, lineHeight: "10px", color: l.color }}>{l.short}</span>)}
  </div>;
}

const fmtH = (t, days) => new Date(t).toLocaleString("fr-FR", days > 2 ? { weekday: "short", day: "numeric" } : days > 1 ? { weekday: "short", hour: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

/** La grande courbe : grille, heures ou jours en bas, les impressions en bandes pales, la valeur de chaque serie au doigt. */
// des reperes ronds a l'heure locale, comptes depuis minuit : 30 min sur 3 h, 1 h sur 6 h, 2 h sur 12 h, 4 h sur un
// jour, 6 h sur deux, minuit au-dela
export function timeTicks(from, to, hours) {
  const out = [], tM = (hours <= 0.1 ? 1 / 60 : hours <= 0.25 ? 2 / 60 : hours <= 0.5 ? 5 / 60 : hours <= 1 ? 10 / 60 : hours <= 2 ? 0.25
    : hours <= 3 ? 0.5 : hours <= 6 ? 1 : hours <= 12 ? 2 : hours <= 24 ? 4 : hours <= 48 ? 6 : 24) * 3600000;
  const m0 = new Date(from); m0.setHours(0, 0, 0, 0);
  for (let t = m0.getTime(); t < to; t += tM) if (t > from) out.push(t);
  return out;
}
export const fmtTick = (t, hours) => fmtH(t, hours / 24);

export function SensorChart({ lines, points, hours = 24, height = 180, unit = "", lo, hi, end = null, mark = null }) {
  const ref = useRef(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");          // les degrades de cette courbe (plusieurs courbes par page)
  const [at, setAt] = useState(null);
  const to = end || Date.now(), from = to - hours * 3600000;
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
  const W = 100, H = height, BASE = H - 20;
  const x = t => ((t - from) / (to - from)) * W;
  const y = v => BASE - ((v - b[0]) / (b[1] - b[0] || 1)) * (BASE - 10);
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find(s => (b[1] - b[0]) / s <= 5) || 100;
  const grid = [];
  for (let v = Math.ceil(b[0] / step) * step; v <= b[1]; v += step) grid.push(v);
  const days = hours / 24;
  const ticks = timeTicks(from, to, hours);
  const near = at == null ? null : lines.map(l => {
    let best = null;
    for (const p of l.pts) if (p.t >= from && p.t <= to && (!best || Math.abs(p.t - at) < Math.abs(best.t - at))) best = p;
    return best && (best.gap !== undefined || Math.abs(best.t - at) <= gapOf(l.pts)) ? { l, p: best } : null;
  }).filter(Boolean);
  const move = e => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    setAt(from + Math.max(0, Math.min(1, cx / r.width)) * (to - from));
  };
  const main = lines.filter(l => !l.dash), tgt = lines.filter(l => l.dash);
  // le trace se fait sur des moyennes par tranche (~240 sur la largeur, 03/11/2026) : un ventilateur ou une buse qui
  // oscille a chaque releve faisait un pave plein ; la bulle, elle, lit toujours les vrais points
  const slot = (to - from) / 240;
  // les moyennes gardent les vrais trous que le serveur a marques (06/11/2026 : perdus ici, la regle d'ecart reprenait la
  // main et coupait les releves espaces du repos, 10 a 35 min, qui ne sont pas des trous)
  const inWin = l => {
    const out = [];
    let k = null, s = 0, ts = 0, n = 0, g;
    const push = () => out.push({ t: ts / n, v: s / n, ...(g !== undefined ? { gap: g } : {}) });
    for (const p of l.pts) {
      if (p.t < from || p.t > to) continue;
      const kk = Math.floor((p.t - from) / slot);
      if (kk !== k) { if (n) push(); k = kk; s = ts = n = 0; g = p.gap === undefined ? undefined : false; }
      if (p.gap) g = true;
      s += p.v; ts += p.t; n++;
    }
    if (n) push();
    return out;
  };
  return <div ref={ref} onMouseMove={move} onMouseLeave={() => setAt(null)} onTouchStart={move} onTouchMove={move} onTouchEnd={() => setAt(null)}
    style={{ position: "relative", height, touchAction: "pan-y", userSelect: "none" }}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }} aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}band`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3B82F6" stopOpacity=".16"/><stop offset="1" stopColor="#6366F1" stopOpacity=".04"/></linearGradient>
        {main.map(l => <linearGradient key={l.key} id={`${uid}${l.key}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={l.color} stopOpacity={main.length > 2 ? ".06" : ".2"}/><stop offset="1" stopColor={l.color} stopOpacity="0"/></linearGradient>)}
      </defs>
      {/* les impressions : des bandes en degrade, un trait en haut */}
      {bands.filter(([a, c]) => c > from && a < to).map(([a, c], i) => { const x0 = x(Math.max(a, from)), x1 = x(Math.min(c, to));
        return <React.Fragment key={i}>
          <rect x={x0} y={0} width={Math.max(0.3, x1 - x0)} height={BASE} fill={`url(#${uid}band)`}/>
          <line x1={x0} x2={x1} y1={0.5} y2={0.5} stroke="#3B82F6" strokeOpacity=".45" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
        </React.Fragment>; })}
      {grid.map(v => <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeOpacity=".7" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="2 5"/>)}
      {/* les consignes : un large trait pale, dessous */}
      {tgt.map(l => segs(inWin(l), x, y).map((sg, i) => <path key={`${l.key}${i}`} d={monoPath(sg)} fill="none" stroke={l.color} strokeWidth="4"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity=".18"/>))}
      {/* l'aire sous chaque courbe, en degrade, puis la courbe (fine, sans halo : a plusieurs, elles se noyaient) */}
      {main.map(l => segs(inWin(l), x, y).map((sg, i) => sg.length > 1 && <path key={`a${l.key}${i}`}
        d={`${monoPath(sg)} L${sg[sg.length - 1][0].toFixed(2)},${BASE} L${sg[0][0].toFixed(2)},${BASE} Z`} fill={`url(#${uid}${l.key})`}/>))}
      {main.map(l => segs(inWin(l), x, y).map((sg, i) => <React.Fragment key={`c${l.key}${i}`}>
        <path d={monoPath(sg)} fill="none" stroke={l.color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
      </React.Fragment>))}
      {at != null && <line x1={x(at)} x2={x(at)} y1={0} y2={BASE} stroke="var(--text2)" strokeOpacity=".5" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke"/>}
      {/* l'evenement choisi dans la chronologie : son heure sur chaque courbe */}
      {mark != null && mark >= from && mark <= to && <line x1={x(mark)} x2={x(mark)} y1={0} y2={BASE} stroke="#F43F5E" strokeWidth="1.5"
        strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/>}
    </svg>
    {grid.map(v => <span key={v} style={{ position: "absolute", left: 0, top: y(v) - 15, padding: "0 4px", borderRadius: 6, fontSize: 9.5, fontWeight: 800,
      color: "var(--muted)", background: "color-mix(in srgb, var(--surface) 70%, transparent)" }}>{v}{unit}</span>)}
    {ticks.map(t => <span key={t} style={{ position: "absolute", bottom: 0, left: `${x(t)}%`, transform: "translateX(-50%)", fontSize: 9.5, fontWeight: 800,
      color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtH(t, days)}</span>)}
    {/* au survol : un point sur chaque courbe, et la bulle */}
    {near && near.filter(n => !n.l.dash).map(({ l, p }) => <span key={l.key} style={{ position: "absolute", left: `${x(p.t)}%`, top: y(p.v), width: 10, height: 10,
      borderRadius: "50%", background: l.color, transform: "translate(-50%, -50%)", boxShadow: `0 0 0 2.5px var(--surface), 0 0 10px ${l.color}`, pointerEvents: "none" }}/>)}
    {near && near.length > 0 && <div style={{ position: "absolute", top: 6, [x(at) > 60 ? "right" : "left"]: x(at) > 60 ? `${100 - x(at) + 2}%` : `${x(at) + 2}%`,
      padding: "8px 11px", borderRadius: 14, background: "color-mix(in srgb, var(--sheet-bg, var(--surface)) 88%, transparent)", backdropFilter: "blur(8px)",
      border: "1px solid var(--border)", boxShadow: "0 12px 28px -14px rgba(0,0,0,.5)",
      fontSize: 11.5, fontWeight: 800, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 1, minWidth: 150 }}>
      <div style={{ color: "var(--muted)", marginBottom: 4, fontSize: 11 }}>{new Date(at).toLocaleString("fr-FR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
      {near.map(({ l, p }) => <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 7, padding: "1px 0", opacity: l.dash ? 0.75 : 1 }}>
        <span style={{ width: l.dash ? 10 : 8, height: l.dash ? 4 : 8, borderRadius: l.dash ? 2 : "50%", background: l.color, opacity: l.dash ? 0.6 : 1 }}/>
        <span style={{ color: "var(--text2)", fontWeight: l.dash ? 700 : 800 }}>{l.label}</span>
        <span style={{ marginLeft: "auto", paddingLeft: 10, color: l.color, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{Number(p.v).toFixed(unit === "%" ? 0 : 1).replace(".", ",")}{unit}</span></div>)}
    </div>}
  </div>;
}

/** La legende : une pastille par serie, sa derniere valeur (les consignes, en pointilles, en une seule pastille). */
export function SensorLegend({ lines, unit = "" }) {
  const dashed = lines.some(l => l.dash);
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {dashed && <span style={{ order: 1, display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 800,
      color: "var(--muted)", border: "1px dashed var(--border)" }}>
      <svg width="18" height="8" aria-hidden="true"><line x1="2" y1="4" x2="16" y2="4" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.35"/>
        <line x1="2" y1="4" x2="16" y2="4" stroke="currentColor" strokeWidth="1.6"/></svg>consignes</span>}
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
export const amsName = id => { const n = Number(id); return n >= 254 ? "Externe" : n >= 128 ? `HT-${amsLetter(n)}` : `AMS-${amsLetter(n)}`; };

/** Les series d'humidite (ou de temperature, k = 1) de chaque AMS, dans l'ordre de leur numero. */
export function amsLines(points, k = 0) {
  const ids = [...new Set((points || []).flatMap(p => Object.keys(p.ams || {})))].sort((a, b) => Number(a) - Number(b));
  return ids.map((id, i) => ({ key: `a${id}`, label: amsName(id), short: amsShort(id), color: AMS_COLORS[i % AMS_COLORS.length], unit: k ? "°" : "%",
    pts: seriesOf(points, p => { const v = p.ams?.[id]?.[k]; return v ? v : null; }) })).filter(l => l.pts.length);
}

// les ventilateurs, en %
export const FAN_COLORS = { fan_part: "#14B8A6", fan_aux: "#A855F7", fan_head: "#94A3B8", fan_chamber: "#0EA5E9",
  fan_loop: "#22C55E", fan_head2: "#64748B", fan_board: "#F59E0B" };
export function fanLines(points) {
  return [["fan_part", "Pièce", "P"], ["fan_aux", "Auxiliaire", "A"], ["fan_chamber", "Chambre", "C"], ["fan_loop", "Circulation", "Ci"],
    ["fan_head", "Tête", "T"], ["fan_head2", "Tête 2e buse", "T2"], ["fan_board", "Carte", "Ca"]]
    .map(([k, label, short]) => ({ key: k, label, short, color: FAN_COLORS[k], unit: "%", pts: seriesOf(points, p => p[k]) }))
    .filter(l => l.pts.some(p => p.v > 0));
}

/** Les series de chaleur : buse(s), plateau, chambre ; avec targets, leurs consignes en pointilles a la meme couleur
 *  (seulement celles qui ont eu une consigne sur la periode). */
export function heatLines(points, { chamber = true, only = null, targets = false } = {}) {
  const two = (points || []).some(p => p.nozzle2 != null);
  // sur une bi-buse, chaque buse a sa courbe (droite : id 0, gauche : id 1)
  const src = [["nozzle", two ? "Buse droite" : "Buse", two ? "D" : "B"], ...(two ? [["nozzle2", "Buse gauche", "G"]] : []), ["bed", "Plateau", "P"], ...(chamber ? [["chamber", "Chambre", "C"]] : [])]
    .filter(([k]) => !only || only.includes(k));
  const main = src.map(([k, label, short]) => ({ key: k, label, short, color: HEAT_COLORS[k], unit: "°", pts: seriesOf(points, p => p[k]) }));
  const tgt = targets ? src.map(([k, label]) => ({ key: `${k}_t`, label: `Consigne ${label.toLowerCase()}`, color: HEAT_COLORS[k], unit: "°", dash: true,
    pts: seriesOf(points, p => p[`${k}_t`]) })) : [];
  return [...main, ...tgt].filter(l => l.pts.length);
}
