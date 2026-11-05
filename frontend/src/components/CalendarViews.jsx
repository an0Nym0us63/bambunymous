import React, { useEffect, useRef } from "react";
import { apiUrl, apiThumb } from "../api/client";
import MwImg from "./MwImg";
import { spans, hhmm, jobName, doneTxt, plateTxt, DayStrip } from "./PlanDay";
import { ST, iso, DAYS } from "./PrintCalendar";

// Les vues Semaine et Jour du calendrier (05/11/2026) : une grille horaire ou ce qui est imprime, ce qui imprime et
// les plateaux prevus sont poses a leur vraie heure ; les heures de fonctionnement en fond, les heures de lancement
// en liseré, l'heure qu'il est en rouge. Au telephone, la semaine devient un agenda (un jour sous l'autre).

const hm = s => { const m = Math.round((s || 0) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
const minOf = (isoStr, day) => {
  if (!isoStr) return 0;
  if (isoStr.slice(0, 10) < day) return 0;
  if (isoStr.slice(0, 10) > day) return 1440;
  return Math.min(1440, +isoStr.slice(11, 13) * 60 + +isoStr.slice(14, 16));
};
const dayName = (d, long = false) => new Date(`${d}T12:00`).toLocaleDateString("fr-FR", long ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric" });

// ce qui occupe un jour : les impressions faites (et celle en cours), puis les plateaux prevus, coupes a minuit
export function dayEvents(day, days, jobs) {
  const out = [];
  for (const it of [...new Map((days?.[day]?.items || []).map(i => [i.id, i])).values()]) {
    const a = minOf(it.start, day), b = Math.min(1440, a + Math.max(1, (it.seconds || 0) / 60));
    out.push({ kind: "done", key: `d${it.id}`, a, b, it, color: it.status === "IN_PROGRESS" ? "#3B82F6" : (ST[it.status] || ST.SUCCESS)[0] });
  }
  for (const j of jobs || []) {
    if (j.end.slice(0, 10) < day || j.start.slice(0, 10) > day) continue;
    const a = minOf(j.start, day), b = minOf(j.end, day);
    if (b <= a) continue;
    out.push({ kind: "plan", key: j.key + day, a, b, j, color: j.completes ? "#EAB308" : j.too_long ? "#EF4444" : "#22C55E" });
  }
  return out.sort((x, y) => x.a - y.a);
}

// une vignette : celle de l'impression, ou celle du plateau prevu
function Thumb({ e, size }) {
  const st = { width: size, height: size, borderRadius: 7, flexShrink: 0, objectFit: "cover", background: "#fff" };
  if (e.kind === "done") return <img src={apiThumb(apiUrl(`/prints/${e.it.id}/image`), 96)} alt="" loading="lazy" style={st}
    onError={x => { x.currentTarget.style.visibility = "hidden"; }}/>;
  return e.j.thumb ? <MwImg src={e.j.thumb} w={96} style={{ ...st, objectFit: "contain" }}/>
    : e.j.cover ? <img src={apiThumb(e.j.cover, 96)} alt="" loading="lazy" style={st}/> : <span style={{ ...st, display: "inline-block" }}/>;
}

// la grille horaire d'un ou plusieurs jours
export function TimeGrid({ dates, days, jobs, settings, now, hourPx = 30, pick, onPick, onOpenPrint, onOpenJob, edit, onDropDay, height }) {
  const scroller = useRef(null);
  const run = spans(settings?.run), launch = spans(settings?.launch);
  const today = now?.slice(0, 10), nowM = now ? minOf(now, today) : null;
  const evs = Object.fromEntries(dates.map(d => [d, dayEvents(d, days, (jobs || []).filter(j => j.start.slice(0, 10) <= d && j.end.slice(0, 10) >= d))]));
  // a l'ouverture : la grille descend vers ce qui compte (l'heure qu'il est, ou le premier evenement, moins une heure)
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const firsts = dates.flatMap(d => evs[d].map(e => e.a));
    const target = dates.includes(today) && nowM != null ? nowM : firsts.length ? Math.min(...firsts) : 8 * 60;
    el.scrollTop = Math.max(0, (target / 60 - 1.5) * hourPx);
  }, [dates.join(), hourPx]); // eslint-disable-line react-hooks/exhaustive-deps
  const H = 24 * hourPx, one = dates.length === 1;
  const cols = `46px repeat(${dates.length}, minmax(0, 1fr))`;
  return <div style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden", minWidth: 0 }}>
    {/* l'en-tete : chaque jour, ses heures (faites et prevues), un drapeau quand un objet s'y termine */}
    {!one && <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}>
      <span/>
      {dates.map(d => {
        const done = (days?.[d]?.duration || 0), planned = evs[d].filter(e => e.kind === "plan").reduce((a, e) => a + (e.b - e.a) * 60, 0);
        const fin = evs[d].filter(e => e.kind === "plan" && e.j.completes).length;
        return <button key={d} type="button" onClick={() => onPick(d)}
          style={{ padding: "6px 4px", border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer", textAlign: "center", minWidth: 0,
            background: d === pick ? "color-mix(in srgb, #6366F1 12%, transparent)" : "transparent" }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: d === today ? "#6366F1" : "var(--text2)", textTransform: "capitalize" }}>{dayName(d)}</div>
          <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {done ? hm(done) : ""}{done && planned ? " · " : ""}{planned ? <span style={{ color: "#16A34A" }}>{hm(planned)}</span> : ""}
            {fin > 0 && <span style={{ marginLeft: 3, padding: "0 4px", borderRadius: 6, background: "#FACC15", color: "#713F12", fontWeight: 900 }}>🏁{fin > 1 ? fin : ""}</span>}</div>
        </button>;
      })}
    </div>}
    <div ref={scroller} style={{ position: "relative", overflowY: "auto", height: height || Math.min(H, 560) }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, height: H, position: "relative" }}>
        {/* les heures */}
        <div style={{ position: "relative" }}>
          {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ position: "absolute", top: h * hourPx - 6, right: 6, fontSize: 10, fontWeight: 800,
            color: "var(--muted)" }}>{h ? `${h} h` : ""}</span>)}
        </div>
        {dates.map(d => <div key={d}
          onDragOver={edit && d >= today ? e => { if (e.dataTransfer.types.includes("text/bn-job")) e.preventDefault(); } : undefined}
          onDrop={edit && d >= today ? e => { const k = e.dataTransfer.getData("text/bn-job"); if (k) { e.preventDefault(); onDropDay(k, d); } } : undefined}
          onClick={() => !one && onPick(d)}
          style={{ position: "relative", borderLeft: "1px solid var(--border)", cursor: one ? "default" : "pointer",
            background: d === pick && !one ? "color-mix(in srgb, #6366F1 4%, transparent)" : "transparent" }}>
          {/* les heures de fonctionnement en fond, celles de lancement en liseré a gauche */}
          {run && run.map(([a, b], i) => <span key={`r${i}`} style={{ position: "absolute", left: 0, right: 0, top: a / 60 * hourPx, height: (b - a) / 60 * hourPx,
            background: "color-mix(in srgb, #22C55E 5%, transparent)" }}/>)}
          {launch && launch.map(([a, b], i) => <span key={`l${i}`} data-tip="Heures de lancement" style={{ position: "absolute", left: 0, width: 3,
            top: a / 60 * hourPx, height: (b - a) / 60 * hourPx, background: "color-mix(in srgb, #6366F1 45%, transparent)" }}/>)}
          {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ position: "absolute", left: 0, right: 0, top: h * hourPx, borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)" }}/>)}
          {evs[d].map(e => {
            const top = e.a / 60 * hourPx, h = Math.max(16, (e.b - e.a) / 60 * hourPx - 2);
            const big = h >= 34, plan = e.kind === "plan";
            const title = plan ? e.j.title : (e.it.title || e.it.name);
            return <button key={e.key} type="button" onClick={ev => { ev.stopPropagation(); plan ? onOpenJob(e.j) : onOpenPrint(e.it); }}
              data-tip={`${plan ? jobName(e.j) : title} · ${String(Math.floor(e.a / 60)).padStart(2, "0")}:${String(e.a % 60).padStart(2, "0")}`}
              style={{ position: "absolute", left: 4, right: 3, top, height: h, zIndex: 1, overflow: "hidden", cursor: "pointer", textAlign: "left", font: "inherit",
                display: "flex", alignItems: big ? "flex-start" : "center", gap: 6, padding: big ? "4px 6px" : "0 6px", borderRadius: 8, boxSizing: "border-box",
                border: plan ? `1.5px ${e.j.completes ? "solid" : "dashed"} ${e.color}` : "none",
                background: plan ? `color-mix(in srgb, ${e.color} 14%, var(--surface))`
                  : `linear-gradient(135deg, color-mix(in srgb, ${e.color} 80%, #000 0%), color-mix(in srgb, ${e.color} 55%, transparent))`,
                color: plan ? "var(--text)" : "#fff" }}>
              {big && <Thumb e={e} size={Math.min(one ? 44 : 28, h - 8)}/>}
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 11.5, fontWeight: 900, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: big && one ? "normal" : "nowrap" }}>{plan && e.j.completes ? "🏁 " : ""}{title}</span>
                {big && <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, opacity: .85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {plan ? `${hhmm(e.j.start)} → ${hhmm(e.j.end)} · ${plateTxt(e.j)}` : `${e.it.start?.slice(11, 16)} · ${hm(e.it.seconds)}`}</span>}
                {big && one && plan && e.j.load?.length > 0 && <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#EA580C" }}>🧵 {e.j.load.join(", ")}</span>}
                {big && one && plan && e.j.completes && <span style={{ display: "block", fontSize: 10.5, fontWeight: 900, color: "#A16207" }}>{doneTxt(e.j)}</span>}
              </span>
            </button>;
          })}
          {d === today && nowM != null && <span style={{ position: "absolute", left: 0, right: 0, top: nowM / 60 * hourPx, height: 2, background: "#EF4444", zIndex: 2 }}>
            <span style={{ position: "absolute", left: -4, top: -3, width: 8, height: 8, borderRadius: "50%", background: "#EF4444" }}/></span>}
        </div>)}
      </div>
    </div>
  </div>;
}

// la semaine au telephone : un jour sous l'autre, sa frise, puis ce qui s'y passe dans l'ordre
export function WeekAgenda({ dates, days, jobs, settings, now, pick, onPick, onOpenPrint, onOpenJob }) {
  const today = now?.slice(0, 10);
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    {dates.map(d => {
      const ev = dayEvents(d, days, (jobs || []).filter(j => j.day === d));
      const done = days?.[d]?.duration || 0, planned = ev.filter(e => e.kind === "plan").reduce((a, e) => a + e.j.seconds, 0);
      return <div key={d} style={{ borderRadius: 16, border: `1px solid ${d === pick ? "color-mix(in srgb, #6366F1 50%, var(--border))" : "var(--border)"}`,
        background: "var(--surface)", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        <button type="button" onClick={() => onPick(d)} style={{ display: "flex", alignItems: "baseline", gap: 8, border: "none", background: "none", padding: 0,
          cursor: "pointer", textAlign: "left", font: "inherit" }}>
          <span style={{ fontSize: 14.5, fontWeight: 900, color: d === today ? "#6366F1" : "var(--text)", textTransform: "capitalize" }}>{dayName(d, true)}</span>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>{done ? hm(done) : ""}{done && planned ? " · " : ""}
            {planned ? <span style={{ color: "#16A34A" }}>{hm(planned)} prévues</span> : ""}</span>
          <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)" }}>›</span>
        </button>
        {(ev.length > 0 || d >= today) && <DayStrip day={d} done={days?.[d]?.items || []} jobs={(jobs || []).filter(j => j.day === d)} settings={settings} now={now}/>}
        {!ev.length && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{d < today ? "Rien d'imprimé" : "Rien de prévu"}</span>}
        {ev.map(e => {
          const plan = e.kind === "plan";
          return <button key={e.key} type="button" onClick={() => plan ? onOpenJob(e.j) : onOpenPrint(e.it)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: 5, borderRadius: 11, cursor: "pointer", textAlign: "left", font: "inherit",
              border: plan ? `1.5px ${e.j.completes ? "solid" : "dashed"} ${e.color}` : "1px solid var(--border)",
              background: plan ? `color-mix(in srgb, ${e.color} 7%, var(--surface2))` : "var(--surface2)" }}>
            <span style={{ width: 44, flexShrink: 0, fontSize: 12, fontWeight: 900, color: plan ? "#16A34A" : e.color, textAlign: "center" }}>
              {String(Math.floor(e.a / 60)).padStart(2, "0")}:{String(e.a % 60).padStart(2, "0")}</span>
            <Thumb e={e} size={34}/>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {plan && e.j.completes ? "🏁 " : ""}{plan ? e.j.title : (e.it.title || e.it.name)}</span>
              <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {plan ? `${plateTxt(e.j)} · ${hm(e.j.seconds)}${e.j.load?.length ? " · 🧵" : ""}` : `${hm(e.it.seconds)} · ${(ST[e.it.status] || ST.SUCCESS)[1]}`}</span>
            </span>
          </button>;
        })}
      </div>;
    })}
  </div>;
}

// la semaine qui contient ce jour : du lundi au dimanche
export function weekOf(day) {
  const d = new Date(`${day}T12:00`), out = [];
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  for (let i = 0; i < 7; i++) { out.push(iso(d)); d.setDate(d.getDate() + 1); }
  return out;
}
export { DAYS };
