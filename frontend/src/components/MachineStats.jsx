import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSensorHistory, useSensorEvents } from "../store/sensors";
import MachineTimeline from "./MachineTimeline";
import { PrintDetail, FilamentSheetFromSpool } from "./LazySheets";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import { SensorChart, SensorLegend, amsLines, heatLines, fanLines, seriesOf } from "./SensorChart";
import { egg } from "../eggs";

// Stats › Machine (03/11/2026) : les releves des capteurs de 3 h a 7 jours (le serveur n'en garde pas plus).
// En tete le bilan de la periode, puis une carte par mesure : buse et plateau, chambre, humidite des AMS, leur
// temperature, ventilateurs. Les impressions sont les bandes bleues pales des courbes.
const PERIODS = [[3, "3 h"], [6, "6 h"], [12, "12 h"], [24, "24 h"], [72, "3 j"], [168, "7 j"]];
const KEEP_MS = 7 * 86400000;            // ce que le serveur garde
const MIN_H = 5 / 60;                    // le zoom le plus serre : 5 minutes
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

// les periodes : une barre segmentee, la pastille de la periode choisie glisse de l'une a l'autre
// la duree d'une fenetre en clair : « 45 min », « 1 h 30 »
const durLabel = h => { const mn = Math.round(h * 60); return mn < 60 ? `${mn} min` : `${Math.floor(mn / 60)} h${mn % 60 ? ` ${String(mn % 60).padStart(2, "0")}` : ""}`; };

function Periods({ value, onChange }) {
  // une fenetre zoomee (hors des periodes) : pas de pastille
  const i = PERIODS.findIndex(p => Math.abs(p[0] - value) < 1e-6), n = PERIODS.length;
  return <div role="tablist" style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, padding: 4, borderRadius: 16,
    background: "var(--surface2)", border: "1px solid var(--border)", maxWidth: 520, width: "100%" }}>
    <span aria-hidden="true" style={{ position: "absolute", top: 4, bottom: 4, left: 4, width: `calc((100% - 8px) / ${n})`, borderRadius: 12,
      transform: `translateX(${Math.max(0, i) * 100}%)`, transition: "transform .28s cubic-bezier(.3,1.3,.5,1), opacity .2s", opacity: i < 0 ? 0 : 1,
      background: "linear-gradient(135deg, #0EA5E9, #6366F1)", boxShadow: "0 6px 16px -8px #6366F1" }}/>
    {PERIODS.map(([h, l]) => <button key={h} type="button" role="tab" aria-selected={i >= 0 && value === h} onClick={() => onChange(h)}
      style={{ position: "relative", zIndex: 1, padding: "7px 0", border: "none", background: "none", cursor: "pointer", borderRadius: 12,
        fontSize: 12.5, fontWeight: 900, color: value === h ? "#fff" : "var(--text2)", transition: "color .2s", whiteSpace: "nowrap" }}>{l}</button>)}
  </div>;
}

// la mini-carte des 7 jours : les impressions en bandes, la buse en fine courbe, et la fenetre regardee en cadre qu'on
// fait glisser (ou qu'on pose d'un toucher)
function Navigator({ hours, end, onEnd }) {
  const all = useSensorHistory(168);
  const ref = useRef(null);
  const drag = useRef(null);
  const now = Date.now(), lo = now - KEEP_MS, span = now - lo;
  const to = end || now, from = to - hours * 3600000;
  const x = t => ((t - lo) / span) * 100;
  const { bands, line } = useMemo(() => {
    const out = [], pts = all || [];
    let s = null, last = null;
    for (const p of pts) {
      const t = Date.parse(p.t);
      if (p.printing && s == null) s = t;
      if ((!p.printing || (last && t - last > 40 * 60000)) && s != null) { out.push([s, last ?? t]); s = p.printing ? t : null; }
      last = t;
    }
    if (s != null) out.push([s, last]);
    const nz = pts.filter(p => p.nozzle != null), mx = Math.max(60, ...nz.map(p => p.nozzle));
    return { bands: out, line: nz.map(p => `${x(Date.parse(p.t)).toFixed(2)},${(40 - 4 - (p.nozzle / mx) * 30).toFixed(1)}`).join(" ") };
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = e => { const r = ref.current.getBoundingClientRect(); return lo + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * span; };
  const down = e => {
    const t = at(e), inside = t >= from && t <= to;
    ref.current.setPointerCapture?.(e.pointerId);
    // dans le cadre : on le fait glisser ; ailleurs : la fenetre s'y centre, puis glisse
    if (!inside) onEnd(t + hours * 1800000);
    drag.current = { t0: t, end0: inside ? to : t + hours * 1800000 };
  };
  const move = e => { if (drag.current) onEnd(drag.current.end0 + at(e) - drag.current.t0); };
  const up = () => { drag.current = null; };
  const days = [];
  for (let d = new Date(lo); d.getTime() < now + 86400000; d.setDate(d.getDate() + 1)) { const m = new Date(d); m.setHours(0, 0, 0, 0); if (m.getTime() > lo && m.getTime() < now) days.push(m.getTime()); }
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <div ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      data-tip="Les 7 derniers jours : fais glisser le cadre, ou touche un moment"
      style={{ position: "relative", height: 40, borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--border)",
        overflow: "hidden", cursor: "grab", touchAction: "none", userSelect: "none" }}>
      {bands.map(([a, b], i) => <span key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${x(a)}%`, width: `${Math.max(0.3, x(b) - x(a))}%`,
        background: "rgba(59,130,246,.22)" }}/>)}
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
        {line && <polyline points={line} fill="none" stroke="#F97316" strokeWidth="1.2" vectorEffect="non-scaling-stroke" opacity="0.8"/>}
      </svg>
      {days.map(t => <span key={t} style={{ position: "absolute", top: 0, bottom: 0, left: `${x(t)}%`, width: 1, background: "var(--border)" }}/>)}
      {/* la fenetre regardee : le reste s'assombrit un peu */}
      <span style={{ position: "absolute", top: 2, bottom: 2, left: `${x(from)}%`, width: `${Math.max(1.2, x(to) - x(from))}%`, minWidth: 10, borderRadius: 9,
        border: "2px solid #6366F1", background: "rgba(99,102,241,.16)", boxShadow: "0 0 0 2000px rgba(15,23,42,.10), 0 4px 12px -4px #6366F1", pointerEvents: "none",
        transition: drag.current ? "none" : "left .2s, width .2s" }}/>
    </div>
    <div style={{ position: "relative", height: 12 }}>
      {days.map(t => <span key={t} style={{ position: "absolute", left: `${x(t)}%`, transform: "translateX(4px)", fontSize: 9.5, fontWeight: 800,
        color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(t).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}</span>)}
    </div>
  </div>;
}

export default function MachineStats() {
  const [hours, setHours] = useState(24);
  // end : la fin de la fenetre regardee (ms), null : maintenant. On la deplace en faisant glisser les courbes (souris,
  // doigt, pave tactile) ou le cadre de la mini-carte ; jamais avant ce que le serveur garde ni apres maintenant
  const [end, setEndRaw] = useState(null);
  const hoursRef = useRef(hours); hoursRef.current = hours;
  const setEnd = t => {
    if (t == null) return setEndRaw(null);
    const now = Date.now(), c = Math.max(now - KEEP_MS + hoursRef.current * 3600000, Math.min(now, t));
    setEndRaw(c >= now - 30000 ? null : Math.round(c));
  };
  // les releves charges : la fenetre et de quoi la faire glisser de chaque cote (trois fenetres en tout, 7 jours au
  // plus), relus seulement quand elle s'approche du bord
  // (pendant l'animation d'un zoom, ceux d'avant : la fenetre d'arrivee y est deja ; une requete par image sinon)
  const [moving, setMoving] = useState(null);
  const vh = moving ? moving.h : hours, ve = moving ? moving.e : end;
  const fh = Math.min(168, vh * 3), m = (fh - vh) / 2 * 3600000;
  const fe = (() => {
    if (!ve || m <= 0) return null;
    const st = m / 2, e = Math.ceil((ve + m) / st) * st;
    return e >= Date.now() - 60000 ? null : e;
  })();
  const all = useSensorHistory(fh, true, fe);
  const allEv = useSensorEvents(fh, fe, all);
  // l'evenement choisi dans la chronologie : son heure sur chaque courbe
  const [pick, setPick] = useState(null);
  // la fiche ouverte depuis la chronologie : l'impression, ou la bobine d'un filament
  const [sheet, setSheet] = useState(null);
  const openSheet = async e => {
    if (e.print_id) {
      try { setSheet({ kind: "print", data: (await client.get(`/prints/${e.print_id}`)).data }); }
      catch { showAlert("Cette impression n'existe plus"); }
    } else if (e.spool_id) setSheet({ kind: "spool", spoolId: e.spool_id, filamentId: e.filament_id, hex: e.color });
  };
  // des evenements reunis sur la frise : la fenetre se resserre autour d'eux, peu a peu (au plus le quart de la
  // precedente, au moins ce qu'il faut pour les contenir), jusqu'a 5 minutes ; le passage est anime (la duree en
  // logarithme : le zoom va a la meme allure du debut a la fin)
  const tween = useRef(0);
  const zoomTo = (a, b) => {
    // un cran a la fois : quatre fois plus serre au plus, que les pastilles s'ecartent petit a petit
    const h1 = Math.max(MIN_H, (b - a) * 2.2 / 3600000, hours / 4);
    const e1 = (a + b) / 2 + h1 * 1800000, live1 = e1 >= Date.now() - 30000;
    const h0 = hours, e0 = end || Date.now(), E1 = live1 ? Date.now() : e1, t0 = performance.now();
    cancelAnimationFrame(tween.current); cancelAnimationFrame(anim.current);
    setMoving({ h: h0, e: end });
    const step = t => {
      const k = Math.min(1, (t - t0) / 420), q = 1 - Math.pow(1 - k, 3);
      setHours(Math.exp(Math.log(h0) + (Math.log(h1) - Math.log(h0)) * q));
      setEndRaw(e0 + (E1 - e0) * q);
      if (k < 1) tween.current = requestAnimationFrame(step);
      else { setHours(h1); setEndRaw(live1 ? null : Math.round(E1)); setMoving(null); }
    };
    tween.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(tween.current), []);
  const to = end || Date.now(), from = to - hours * 3600000;
  const choosePeriod = h => { cancelAnimationFrame(tween.current); setMoving(null); setHours(h); if (h >= 168) setEndRaw(null); else if (end && end - h * 3600000 < Date.now() - KEEP_MS) setEndRaw(Date.now() - KEEP_MS + h * 3600000); };
  useEffect(() => { egg("machine_vue"); }, []);
  // ce qui tombe dans la fenetre (le bilan, les courbes et leurs legendes)
  const pts = useMemo(() => all && all.filter(p => { const t = Date.parse(p.t); return t >= from - 60000 && t <= to + 60000; }), [all, from, to]);
  const events = useMemo(() => allEv && allEv.filter(e => { const t = Date.parse(e.t); return t >= from && t <= to; }), [allEv, from, to]);

  // faire glisser les courbes : a l'horizontale seulement (a la verticale, la page defile), avec un peu d'elan au lacher
  const panRef = useRef(null);
  const pan = useRef(null);
  const anim = useRef(0);
  const endRef = useRef(end); endRef.current = end;
  const msPerPx = () => hoursRef.current * 3600000 / Math.max(200, panRef.current?.clientWidth || 600);
  const onDown = e => {
    if (hours >= 168 || e.button > 0) return;
    cancelAnimationFrame(anim.current);
    pan.current = { x: e.clientX, y: e.clientY, end0: endRef.current || Date.now(), axis: null, id: e.pointerId, vx: 0, lx: e.clientX, lt: performance.now() };
  };
  const onMove = e => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.axis) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { p.axis = "x"; panRef.current?.setPointerCapture?.(e.pointerId); }
      else if (Math.abs(dy) > 8) { pan.current = null; return; }
      else return;
    }
    const now = performance.now();
    p.vx = (e.clientX - p.lx) / Math.max(1, now - p.lt); p.lx = e.clientX; p.lt = now;
    setEnd(p.end0 - dx * msPerPx());
  };
  const onUp = () => {
    const p = pan.current;
    pan.current = null;
    if (!p || p.axis !== "x") return;
    // le clic qui suit un glissement ne doit rien ouvrir
    panRef.current.dataset.dragged = "1";
    setTimeout(() => { if (panRef.current) delete panRef.current.dataset.dragged; }, 0);
    // l'elan : la vitesse du lacher, freinee peu a peu
    let v = -p.vx * msPerPx(), t0 = performance.now(), cur = endRef.current || Date.now();
    const step = t => {
      const dt = Math.min(48, t - t0); t0 = t;
      cur += v * dt; v *= Math.pow(0.9, dt / 16);
      setEnd(cur);
      if (Math.abs(v) * 16 > msPerPx() * 0.5 && cur < Date.now() - 30000) anim.current = requestAnimationFrame(step);
    };
    if (Math.abs(p.vx) > 0.15) anim.current = requestAnimationFrame(step);
  };
  const onWheel = e => {
    // le pave tactile (ou maj + molette) : un glissement horizontal deplace la fenetre
    if (hours >= 168 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    cancelAnimationFrame(anim.current);
    setEnd((endRef.current || Date.now()) + e.deltaX * msPerPx());
  };
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

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
    {sheet?.kind === "print" && <PrintDetail p={sheet.data} onClose={() => setSheet(null)} onDelete={() => setSheet(null)} onChanged={() => {}}/>}
    {sheet?.kind === "spool" && <FilamentSheetFromSpool filamentId={sheet.filamentId} spoolId={sheet.spoolId} filamentColorHex={sheet.hex}
      onClose={() => setSheet(null)}/>}
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <Periods value={hours} onChange={choosePeriod}/>
      {/* un zoom de la chronologie : sa duree, et de quoi en sortir */}
      {!PERIODS.some(p => Math.abs(p[0] - hours) < 1e-6) && !moving && <button type="button" onClick={() => choosePeriod(3)} data-tip="Revenir à 3 h"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 12.5,
          fontWeight: 900, color: "#fff", background: "linear-gradient(135deg, #F43F5E, #8B5CF6)", boxShadow: "0 6px 14px -8px #F43F5E" }}>
        🔍 Zoom {durLabel(hours)} <span style={{ opacity: 0.8 }}>✕</span></button>}
      <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "rgba(59,130,246,.18)", verticalAlign: "-1px", marginRight: 5 }}/>en impression</span>
    </div>
    {hours < 168 && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 26 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {winLabel(from, to)}</span>
        {end ? <button type="button" onClick={() => { cancelAnimationFrame(anim.current); setEndRaw(null); }} style={{ flexShrink: 0, padding: "4px 12px", borderRadius: 20,
          border: "none", cursor: "pointer", fontSize: 12, fontWeight: 900, color: "#fff", background: "linear-gradient(135deg, #0EA5E9, #6366F1)",
          boxShadow: "0 6px 14px -8px #6366F1" }}>Maintenant ⟶</button>
          : <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 900, color: "#22C55E" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 0 3px rgba(34,197,94,.2)" }}/>en direct</span>}
      </div>
      <Navigator hours={hours} end={end} onEnd={t => { cancelAnimationFrame(anim.current); setEnd(t); }}/>
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

      {/* tout ce qui suit glisse dans le temps a l'horizontale (souris, doigt, pave tactile) */}
      <div ref={panRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
        onClickCapture={e => { if (panRef.current?.dataset.dragged) { e.stopPropagation(); e.preventDefault(); } }}
        style={{ display: "flex", flexDirection: "column", gap: 12, touchAction: "pan-y", cursor: hours < 168 ? "grab" : undefined }}>
      <div style={card("#F43F5E")}>
        <div style={{ ...title("#E11D48"), display: "flex", alignItems: "center", gap: 8 }}>🕒 Chronologie
          {events?.length ? <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: 0, textTransform: "none" }}>
            {events.length} événement{events.length > 1 ? "s" : ""}</span> : null}</div>
        <MachineTimeline events={events} points={pts} hours={hours} end={end} pick={pick} onPick={setPick} onZoom={hours > MIN_H * 1.01 ? zoomTo : null} onOpen={openSheet}/>
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
      </div>
    </>}
  </div>;
}
