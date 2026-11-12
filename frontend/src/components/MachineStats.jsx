import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSensorHistory, useSensorEvents } from "../store/sensors";
import MachineTimeline from "./MachineTimeline";
import { PrintDetail, FilamentSheetFromSpool } from "./LazySheets";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import { SensorChart, SensorLegend, amsLines, heatLines, fanLines, seriesOf } from "./SensorChart";
import { egg } from "../eggs";
import PowerCard from "./PowerCard";

// Stats › Machine (03/11/2026) : les releves des capteurs de 3 h a 7 jours (le serveur n'en garde pas plus).
// En tete la periode (un menu) et le bilan, puis la chronologie et une carte par mesure : buse et plateau, chambre,
// humidite des AMS, leur temperature, ventilateurs. Chaque carte glisse dans le temps sans les autres. Les impressions
// sont les bandes bleues pales des courbes.
const PERIODS = [[0.5, "30 min"], [1, "1 h"], [2, "2 h"], [3, "3 h"], [6, "6 h"], [12, "12 h"], [24, "24 h"], [72, "3 j"], [168, "7 j"]];
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

// la duree d'une fenetre en clair : « 45 min », « 1 h 30 »
const durLabel = h => { const mn = Math.round(h * 60); return mn < 60 ? `${mn} min` : `${Math.floor(mn / 60)} h${mn % 60 ? ` ${String(mn % 60).padStart(2, "0")}` : ""}`; };
const PERIOD_SUB = { 0.5: "le tout dernier moment", 1: "la dernière heure", 2: "une impression courte", 3: "une impression moyenne", 6: "la matinée, l'après-midi", 12: "une demi-journée", 24: "la journée", 72: "les trois derniers jours", 168: "tout ce qui est gardé" };
const PERIOD_LONG = { 0.5: "30 minutes", 1: "1 heure", 2: "2 heures", 3: "3 heures", 6: "6 heures", 12: "12 heures", 24: "24 heures", 72: "3 jours", 168: "7 jours" };

// la periode : une pastille qui ouvre sa liste, chaque duree avec ce qu'elle montre
function PeriodSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const out = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [open]);
  return <div ref={ref} style={{ position: "relative" }}>
    <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
      style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 14px 8px 10px", borderRadius: 16, border: "none", cursor: "pointer",
        color: "#fff", background: "linear-gradient(135deg, #0EA5E9, #6366F1)", boxShadow: "0 10px 22px -12px #6366F1" }}>
      <span style={{ width: 30, height: 30, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16,
        background: "rgba(255,255,255,.2)" }}>🕒</span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, opacity: 0.85, textTransform: "uppercase", letterSpacing: ".05em" }}>Période</span>
        <span style={{ fontSize: 15, fontWeight: 900 }}>{PERIOD_LONG[value] || durLabel(value)}</span>
      </span>
      <span style={{ fontSize: 12, opacity: 0.9, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>
    </button>
    {open && <div role="listbox" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 30, minWidth: 240, padding: 6, borderRadius: 18,
      background: "var(--sheet-bg, var(--surface))", border: "1px solid var(--border)", boxShadow: "0 18px 40px -18px rgba(0,0,0,.45)",
      animation: "per-in .18s ease-out" }}>
      {PERIODS.map(([h, l]) => { const on = Math.abs(h - value) < 1e-6;
        return <button key={h} type="button" role="option" aria-selected={on} onClick={() => { onChange(h); setOpen(false); }}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 10px", border: "none", borderRadius: 12, cursor: "pointer", textAlign: "left",
            background: on ? "linear-gradient(135deg, rgba(14,165,233,.16), rgba(99,102,241,.16))" : "transparent", color: "var(--text)" }}>
          <span style={{ width: 54, flexShrink: 0, fontSize: 13.5, fontWeight: 900, color: on ? "#6366F1" : "var(--text)" }}>{l}</span>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{PERIOD_SUB[h]}</span>
          {on && <span style={{ color: "#6366F1", fontWeight: 900 }}>✓</span>}
        </button>; })}
    </div>}
    <style>{`@keyframes per-in { from { opacity: 0; transform: translateY(-4px) scale(.98) } to { opacity: 1; transform: none } }`}</style>
  </div>;
}

// la fenetre d'une carte : sa duree (celle de la page, ou un zoom) et sa fin (null : maintenant), deplacee sans les
// autres. Les releves charges : la fenetre et de quoi la faire glisser de chaque cote (trois fenetres, 7 jours au
// plus), relus seulement quand elle s'approche du bord ; pendant l'animation d'un zoom, ceux d'avant (la fenetre
// d'arrivee y est deja ; une requete par image sinon)
function useView(pageHours) {
  const [hours, setHours] = useState(pageHours);
  const [end, setEndRaw] = useState(null);
  const [moving, setMoving] = useState(null);
  const hoursRef = useRef(hours); hoursRef.current = hours;
  useEffect(() => { setHours(pageHours); setEndRaw(null); setMoving(null); }, [pageHours]);
  const setEnd = t => {
    if (t == null) return setEndRaw(null);
    const now = Date.now(), c = Math.max(now - KEEP_MS + hoursRef.current * 3600000, Math.min(now, t));
    setEndRaw(c >= now - 30000 ? null : Math.round(c));
  };
  const vh = moving ? moving.h : hours, ve = moving ? moving.e : end;
  const fh = Math.min(168, vh * 3), m = (fh - vh) / 2 * 3600000;
  const fe = (() => {
    if (!ve || m <= 0) return null;
    const st = m / 2, e = Math.ceil((ve + m) / st) * st;
    return e >= Date.now() - 60000 ? null : e;
  })();
  const all = useSensorHistory(fh, true, fe);
  const allEv = useSensorEvents(fh, fe, all);
  const to = end || Date.now(), from = to - hours * 3600000;
  const pts = useMemo(() => all && all.filter(p => { const t = Date.parse(p.t); return t >= from - 60000 && t <= to + 60000; }), [all, from, to]);
  const events = useMemo(() => allEv && allEv.filter(e => { const t = Date.parse(e.t); return t >= from && t <= to; }), [allEv, from, to]);
  // un zoom : de la fenetre d'avant a celle d'arrivee, en douceur (la duree en logarithme)
  const tween = useRef(0);
  const animateTo = (h1, e1) => {
    const live1 = e1 == null || e1 >= Date.now() - 30000;
    const h0 = hours, e0 = end || Date.now(), E1 = live1 ? Date.now() : e1, t0 = performance.now();
    cancelAnimationFrame(tween.current);
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
  return { hours, end, from, to, pts, events, all, setEnd, animateTo, moving, reset: () => { cancelAnimationFrame(tween.current); setMoving(null); setHours(pageHours); setEndRaw(null); }, pageHours };
}

// faire glisser une carte dans le temps : a l'horizontale seulement (a la verticale, la page defile), avec un peu
// d'elan au lacher ; le pave tactile (ou maj + molette) aussi. Le clic qui suit un glissement n'ouvre rien
function usePan(view) {
  const ref = useRef(null), pan = useRef(null), anim = useRef(0);
  const endRef = useRef(view.end); endRef.current = view.end;
  const hRef = useRef(view.hours); hRef.current = view.hours;
  const msPerPx = () => hRef.current * 3600000 / Math.max(200, ref.current?.clientWidth || 600);
  useEffect(() => () => cancelAnimationFrame(anim.current), []);
  const off = view.hours >= 168;
  return {
    ref,
    stop: () => cancelAnimationFrame(anim.current),
    props: off ? {} : {
      onPointerDown: e => {
        if (e.button > 0) return;
        cancelAnimationFrame(anim.current);
        pan.current = { x: e.clientX, y: e.clientY, end0: endRef.current || Date.now(), axis: null, id: e.pointerId, vx: 0, lx: e.clientX, lt: performance.now() };
      },
      onPointerMove: e => {
        const p = pan.current;
        if (!p || p.id !== e.pointerId) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (!p.axis) {
          if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { p.axis = "x"; ref.current?.setPointerCapture?.(e.pointerId); }
          else if (Math.abs(dy) > 8) { pan.current = null; return; }
          else return;
        }
        const now = performance.now();
        p.vx = (e.clientX - p.lx) / Math.max(1, now - p.lt); p.lx = e.clientX; p.lt = now;
        view.setEnd(p.end0 - dx * msPerPx());
      },
      onPointerUp: () => {
        const p = pan.current;
        pan.current = null;
        if (!p || p.axis !== "x") return;
        ref.current.dataset.dragged = "1";
        setTimeout(() => { if (ref.current) delete ref.current.dataset.dragged; }, 0);
        let v = -p.vx * msPerPx(), t0 = performance.now(), cur = endRef.current || Date.now();
        const step = t => {
          const dt = Math.min(48, t - t0); t0 = t;
          cur += v * dt; v *= Math.pow(0.9, dt / 16);
          view.setEnd(cur);
          if (Math.abs(v) * 16 > msPerPx() * 0.5 && cur < Date.now() - 30000) anim.current = requestAnimationFrame(step);
        };
        if (Math.abs(p.vx) > 0.15) anim.current = requestAnimationFrame(step);
      },
      onPointerCancel: () => { pan.current = null; },
      onWheel: e => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        cancelAnimationFrame(anim.current);
        view.setEnd((endRef.current || Date.now()) + e.deltaX * msPerPx());
      },
      onClickCapture: e => { if (ref.current?.dataset.dragged) { e.stopPropagation(); e.preventDefault(); } },
      style: { touchAction: "pan-y", cursor: "grab" },
    },
  };
}

// l'en-tete d'une carte : son titre, et sa fenetre quand on l'a deplacee (ou zoomee), avec de quoi revenir
function CardHead({ icon, label, color, view, pan, extra = null }) {
  const moved = view.end != null || Math.abs(view.hours - view.pageHours) > 1e-6;
  return <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 26, flexWrap: "wrap" }}>
    <span style={title(color)}>{icon} {label}</span>
    {extra}
    <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      {moved ? <>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {winLabel(view.from, view.to)}</span>
        <button type="button" onClick={() => { pan?.stop(); view.reset(); }} data-tip="Revenir au direct, sur la période de la page"
          style={{ flexShrink: 0, padding: "3px 10px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 900, color: "#fff",
            background: `linear-gradient(135deg, ${color}, #6366F1)`, boxShadow: `0 6px 14px -8px ${color}` }}>↺ Direct</button>
      </> : view.hours < 168 && <span data-tip="Fais glisser la courbe pour remonter le temps" style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap" }}>⟷ glisser</span>}
    </span>
  </div>;
}

// une carte de courbes, avec sa propre fenetre
function ChartCard({ icon, label, color, tone, pageHours, build, unit, height, lo, hi, ranges = true, legend = "always", mark }) {
  const view = useView(pageHours);
  const pan = usePan(view);
  const lines = useMemo(() => (view.pts ? build(view.pts) : []), [view.pts]); // eslint-disable-line react-hooks/exhaustive-deps
  if (view.pts && !lines.length && view.end == null) return null;          // rien a montrer (pas de chambre, pas de ventilateur)
  return <div style={card(color)}>
    <CardHead icon={icon} label={label} color={tone} view={view} pan={pan}/>
    {(legend === "always" || lines.some(l => l.dash)) && lines.length > 0 && <SensorLegend lines={lines} unit={unit}/>}
    <div ref={pan.ref} {...pan.props}>
      <SensorChart lines={lines} points={view.pts} hours={view.hours} end={view.end} mark={mark} height={height} unit={unit} lo={lo} hi={hi}/>
    </div>
    {ranges && lines.length > 0 && <Ranges lines={lines.filter(l => !l.dash)} unit={unit}/>}
  </div>;
}

function TimelineCard({ pageHours, pick, onPick, onOpen }) {
  const view = useView(pageHours);
  const pan = usePan(view);
  const zoomTo = (a, b) => {
    // un cran a la fois : quatre fois plus serre au plus, que les pastilles s'ecartent petit a petit, jusqu'a 5 min
    const h1 = Math.max(MIN_H, (b - a) * 2.2 / 3600000, view.hours / 4);
    pan.stop();
    view.animateTo(h1, (a + b) / 2 + h1 * 1800000);
  };
  const zoomed = Math.abs(view.hours - pageHours) > 1e-6 && !view.moving;
  const [listOpen, setListOpen] = useState(false);
  return <div style={card("#F43F5E")}>
    <CardHead icon="🕒" label="Chronologie" color="#E11D48" view={view} pan={pan}
      extra={<>
        {/* le nombre d'evenements : il ouvre leur liste */}
        {view.events?.length ? <button type="button" onClick={() => setListOpen(true)} data-tip="La liste des événements de la fenêtre"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 20, border: "1px solid color-mix(in srgb, #F43F5E 30%, var(--border))",
            background: "var(--surface)", cursor: "pointer", fontSize: 11, fontWeight: 800, color: "var(--text2)" }}>
          {view.events.length} événement{view.events.length > 1 ? "s" : ""} <span style={{ color: "#E11D48", fontWeight: 900 }}>›</span></button> : null}
        {zoomed && <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 900, color: "#fff", background: "linear-gradient(135deg, #F43F5E, #8B5CF6)" }}>
          🔍 {durLabel(view.hours)}</span>}
      </>}/>
    <div ref={pan.ref} {...pan.props}>
      <MachineTimeline events={view.events} points={view.pts} hours={view.hours} end={view.end} pick={pick} onPick={onPick}
        onZoom={view.hours > MIN_H * 1.01 ? zoomTo : null} onOpen={onOpen} listInSheet listOpen={listOpen} onListOpen={setListOpen}/>
    </div>
  </div>;
}

export default function MachineStats() {
  const [hours, setHours] = useState(24);
  // le bilan : la periode de la page, jusqu'a maintenant
  const page = useView(hours);
  const pts = page.pts;
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
  useEffect(() => { egg("machine_vue"); }, []);
  const d = useMemo(() => {
    if (!pts) return null;
    // le temps passe a imprimer : la somme des intervalles entre deux releves « en impression » (au plus 15 min chacun)
    let printed = 0;
    for (let i = 1; i < pts.length; i++) {
      const dt = Date.parse(pts[i].t) - Date.parse(pts[i - 1].t);
      if (pts[i].printing && pts[i - 1].printing && dt <= 15 * 60000) printed += dt;
    }
    const hum = amsLines(pts, 0);
    const allH = hum.flatMap(l => l.pts.map(p => p.v));
    const wet = hum.map(l => ({ l, r: range(l.pts) })).filter(x => x.r).sort((a, b) => b.r.max - a.r.max)[0];
    const nz = range(seriesOf(pts, p => p.nozzle));
    return { printed, avgH: allH.length ? allH.reduce((a, b) => a + b, 0) / allH.length : null, wet, nz };
  }, [pts]);
  const C = { pageHours: hours, mark: pick };

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {sheet?.kind === "print" && <PrintDetail p={sheet.data} onClose={() => setSheet(null)} onDelete={() => setSheet(null)} onChanged={() => {}}/>}
    {sheet?.kind === "spool" && <FilamentSheetFromSpool filamentId={sheet.filamentId} spoolId={sheet.spoolId} filamentColorHex={sheet.hex}
      onClose={() => setSheet(null)}/>}
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <PeriodSelect value={hours} onChange={setHours}/>
      <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "rgba(59,130,246,.18)", verticalAlign: "-1px", marginRight: 5 }}/>en impression</span>
    </div>

    {pts == null ? <div style={{ padding: 30, textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>Chargement des relevés…</div>
      : !page.all?.length ? <div style={{ ...card("#64748B"), alignItems: "center", textAlign: "center", padding: 28 }}>
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
      {/* chaque carte a sa fenetre : on la fait glisser (ou on zoome la chronologie) sans toucher aux autres */}
      <TimelineCard pageHours={hours} pick={pick} onPick={setPick} onOpen={openSheet}/>
      <ChartCard {...C} icon="🔥" label="Buse et plateau" color="#F97316" tone="#EA580C" build={p => heatLines(p, { chamber: false, targets: true })}
        unit="°" height={200} lo={0}/>
      {/* (12/11/2026) la prise de l'imprimante (Home Assistant) : la puissance, sur les bandes du tarif */}
      <PowerCard hours={hours}/>
      <ChartCard {...C} icon="📦" label="Chambre" color="#3B82F6" tone="#2563EB" build={p => { const l = heatLines(p, { only: ["chamber"], targets: true }); return l.some(x => !x.dash) ? l : []; }}
        unit="°" height={150} legend="targets"/>
      <ChartCard {...C} icon="💧" label="Humidité des AMS" color="#06B6D4" tone="#0891B2" build={p => amsLines(p, 0)} unit="%" height={190}/>
      <ChartCard {...C} icon="🌡️" label="Température des AMS" color="#8B5CF6" tone="#7C3AED" build={p => amsLines(p, 1)} unit="°" height={160} ranges={false}/>
      <ChartCard {...C} icon="🌀" label="Ventilateurs" color="#14B8A6" tone="#0D9488" build={fanLines} unit="%" height={160} lo={0} hi={100} ranges={false}/>
    </>}
  </div>;
}
