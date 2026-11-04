import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import client, { apiUrl, apiThumb } from "../api/client";
import { egg } from "../eggs";

// Le calendrier des impressions (04/11/2026) : le mois, chaque jour avec l'etagere de ses impressions (une vignette
// chacune, liseree de son etat) posee sur la barre de ses heures machine (une impression qui
// passe minuit compte sur les deux jours, comme les stats), ses impressions et leur etat ; la charge de chaque
// semaine ; et, sur les jours a venir, la file « A faire » si elle s'enchainait sans pause, apres l'impression en cours.
const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ST = { SUCCESS: ["#22C55E", "réussie"], FAILED: ["#EF4444", "échouée"], CANCELLED: ["#94A3B8", "annulée"], PARTIAL: ["#F59E0B", "partielle"],
  IN_PROGRESS: ["#3B82F6", "en cours"] };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = s => { const m = Math.round((s || 0) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
const useWidth = () => {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return w;
};

// la file « A faire » posee sur les jours a venir : chaque modele a la suite, a partir de la fin de l'impression en cours
function projectQueue(models) {
  const out = {};
  if (!Array.isArray(models)) return out;
  let t = new Date();
  const cur = models.find(m => m.printing && m.remaining_min);
  if (cur) t = new Date(t.getTime() + cur.remaining_min * 60000);
  models.filter(m => !m.printing && m.seconds > 0).slice(0, 40).forEach(m => {
    let s = new Date(t), end = new Date(t.getTime() + m.seconds * 1000);
    while (s < end) {
      const mid = new Date(s); mid.setHours(24, 0, 0, 0);
      const e = end < mid ? end : mid, k = iso(s);
      (out[k] = out[k] || []).push({ design_id: m.design_id, title: m.title_fr || m.title || `Modèle ${m.design_id}`, cover: m.cover_url,
        start: s.toTimeString().slice(0, 5), seconds: Math.round((e - s) / 1000), qty: m.qty });
      s = e;
    }
    t = end;
  });
  return out;
}

export default function PrintCalendar() {
  const nav = useNavigate();
  const width = useWidth(), wide = width >= 760, side = width >= 1180;   // side : le detail du jour a cote de la grille
  const detailRef = useRef(null);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [days, setDays] = useState(null);       // {date: {count, duration, items}}
  const [queue, setQueue] = useState(null);
  const [showPlan, setShowPlan] = useState(true);
  const [pick, setPick] = useState(() => iso(new Date()));
  useEffect(() => { egg("calendrier"); }, []);
  // les semaines affichees : du lundi qui precede le 1er au dimanche qui suit la fin du mois
  const grid = useMemo(() => {
    const first = new Date(month), start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0), end = new Date(last);
    end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
    const weeks = [];
    for (let d = new Date(start); d <= end;) { const w = []; for (let i = 0; i < 7; i++) { w.push(new Date(d)); d.setDate(d.getDate() + 1); } weeks.push(w); }
    return { weeks, from: iso(start), to: iso(end) };
  }, [month]);
  useEffect(() => {
    let alive = true;
    setDays(null);
    client.get("/prints/kpis/daily", { params: { date_from: grid.from, date_to: grid.to, tz: -new Date().getTimezoneOffset(), detail: true } })
      .then(r => alive && setDays(Object.fromEntries((r.data || []).map(x => [x.date, x])))).catch(() => alive && setDays({}));
    return () => { alive = false; };
  }, [grid.from, grid.to]);
  useEffect(() => {
    let alive = true;
    client.get("/makerworld/queue").then(r => alive && setQueue(r.data?.models || [])).catch(() => alive && setQueue([]));
    return () => { alive = false; };
  }, []);
  const plan = useMemo(() => showPlan ? projectQueue(queue) : {}, [queue, showPlan]);
  const today = iso(new Date());
  const inMonth = d => d.getMonth() === month.getMonth();
  const monthDays = grid.weeks.flat().filter(inMonth).map(iso);
  const mTotal = monthDays.reduce((a, k) => a + (days?.[k]?.duration || 0), 0);
  const mCount = monthDays.reduce((a, k) => a + (days?.[k]?.count || 0), 0);
  const mActive = monthDays.filter(k => (days?.[k]?.duration || 0) > 0).length;
  const elapsed = monthDays.filter(k => k <= today).length;
  // l'occupation : les heures des jours ecoules, sur leurs 24 h
  const occ = elapsed ? Math.min(1, monthDays.filter(k => k <= today).reduce((a, k) => a + (days?.[k]?.duration || 0), 0) / (elapsed * 86400)) : 0;
  const nPlanned = Object.values(plan).flat().length;
  const sel = days?.[pick];
  const selPlan = plan[pick] || [];
  const go = n => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const chip = (label, value, color) => <div style={{ flex: "1 1 120px", minWidth: 0, padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)",
    background: `linear-gradient(150deg, color-mix(in srgb, ${color} 14%, transparent), transparent 70%), var(--surface2)` }}>
    <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)" }}>{value}</div></div>;
  // le detail du jour : a cote de la grille sur grand ecran ; dessous ailleurs, et la page y descend au toucher
  const pickDay = k => { setPick(k); if (!side) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  const grid7 = `repeat(7, minmax(0, 1fr))${wide ? " 64px" : ""}`;
  const calendar = <div style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", padding: wide ? 8 : 5, overflow: "hidden", minWidth: 0 }}>
    <div style={{ display: "grid", gridTemplateColumns: grid7, gap: wide ? 5 : 3, marginBottom: 4 }}>
      {DAYS.map(d => <div key={d} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 900, color: "var(--muted)", letterSpacing: ".04em" }}>{wide ? d : d[0]}</div>)}
      {wide && <div style={{ textAlign: "center", fontSize: 10.5, fontWeight: 900, color: "var(--muted)" }}>Semaine</div>}
    </div>
    {grid.weeks.map(w => {
      const wDur = w.reduce((a, d) => a + (days?.[iso(d)]?.duration || 0), 0);
      return <div key={iso(w[0])} style={{ display: "grid", gridTemplateColumns: grid7, gap: wide ? 5 : 3, marginBottom: wide ? 5 : 3 }}>
        {w.map(d => {
          const k = iso(d), x = days?.[k], p = plan[k] || [], fill = Math.min(1, (x?.duration || 0) / 86400);
          const pfill = Math.min(1 - fill, p.reduce((a, y) => a + y.seconds, 0) / 86400);
          // l'etagere : une vignette par impression du jour (une impression sur deux jours n'y est qu'une fois par jour)
          const shelf = [...new Map((x?.items || []).map(i => [i.id, i])).values()];
          // au telephone, les vignettes se chevauchent comme des livres sur une etagere (une case fait ~44 px)
          const room = wide ? 5 : 3, th = wide ? 22 : 17;
          const on = k === pick, isToday = k === today;
          return <button key={k} type="button" onClick={() => pickDay(k)} aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]}`}
            style={{ position: "relative", height: wide ? 66 : 54, minWidth: 0, borderRadius: wide ? 11 : 8, cursor: "pointer", overflow: "hidden", padding: 0,
              border: on ? "2px solid #6366F1" : isToday ? "2px solid color-mix(in srgb, #6366F1 55%, transparent)" : "1px solid var(--border)",
              background: on ? "color-mix(in srgb, #6366F1 8%, var(--surface2))" : "var(--surface2)", opacity: inMonth(d) ? 1 : 0.38, textAlign: "left" }}>
            <span style={{ position: "absolute", top: wide ? 4 : 3, left: wide ? 6 : 4, fontSize: wide ? 12 : 10.5, fontWeight: 900,
              color: isToday ? "#6366F1" : "var(--text)" }}>{d.getDate()}</span>
            {wide && x?.duration > 0 && <span style={{ position: "absolute", top: 5, right: 6, fontSize: 9.5, fontWeight: 800, color: "var(--muted)" }}>{hm(x.duration)}</span>}
            {/* l'etagere des vignettes, posee sur la barre des heures */}
            <span style={{ position: "absolute", left: wide ? 5 : 3, right: wide ? 5 : 3, bottom: wide ? 7 : 6, display: "flex", alignItems: "flex-end", gap: wide ? 2 : 0 }}>
              {shelf.slice(0, room).map((it, j) => { const c = (ST[it.status] || ST.SUCCESS)[0];
                return <img key={it.id} src={apiThumb(apiUrl(`/prints/${it.id}/image`), 64)} alt="" loading="lazy"
                  onError={e => { e.currentTarget.style.visibility = "hidden"; }}
                  style={{ width: th, height: th, borderRadius: wide ? 6 : 4, objectFit: "cover", flexShrink: 0, background: "var(--surface)",
                    marginLeft: !wide && j ? -7 : 0, position: "relative", zIndex: room - j,
                    boxShadow: `0 2px 0 0 ${c}, 0 0 0 1px color-mix(in srgb, ${c} 40%, transparent)` }}/>; })}
              {shelf.length > room && <span style={{ fontSize: wide ? 10 : 8.5, fontWeight: 900, color: "var(--text2)", lineHeight: `${th}px`, marginLeft: wide ? 0 : 2 }}>+{shelf.length - room}</span>}
              {!shelf.length && p.length > 0 && <span style={{ width: th, height: th, borderRadius: wide ? 6 : 4, border: "1.5px dashed #22C55E",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: wide ? 11 : 8 }}>✅</span>}
            </span>
            {/* les heures machine du jour, et la file prevue a la suite (hachuree) */}
            <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: wide ? 4 : 3, background: "color-mix(in srgb, var(--border) 60%, transparent)" }}>
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${fill * 100}%`, background: "linear-gradient(90deg, #8B5CF6, #EC4899)" }}/>
              {pfill > 0 && <span style={{ position: "absolute", left: `${fill * 100}%`, top: 0, bottom: 0, width: `${pfill * 100}%`,
                background: "repeating-linear-gradient(90deg, #22C55E 0 3px, transparent 3px 5px)" }}/>}
            </span>
          </button>;
        })}
        {wide && <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, padding: "0 3px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 900, color: "var(--text)", textAlign: "center" }}>{wDur ? hm(wDur) : "—"}</span>
          <span style={{ height: 5, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.min(100, wDur / (7 * 86400) * 100)}%`, background: "linear-gradient(90deg, #8B5CF6, #EC4899)" }}/></span>
          <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--muted)", textAlign: "center" }}>{Math.round(wDur / (7 * 86400) * 100)} %</span>
        </div>}
      </div>;
    })}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "4px 4px 2px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>
      {["SUCCESS", "FAILED", "CANCELLED", "IN_PROGRESS"].map(s => <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span style={{ width: 9, height: 3, borderRadius: 2, background: ST[s][0] }}/>{ST[s][1]}</span>)}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 3, background: "repeating-linear-gradient(90deg, #22C55E 0 3px, transparent 3px 5px)" }}/>prévu</span>
      <span>· la barre : les heures machine du jour</span>
    </div>
  </div>;
  const detail = <div ref={detailRef} style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", padding: 12, display: "flex", flexDirection: "column", gap: 8,
    scrollMarginTop: 70, minWidth: 0, ...(side ? { position: "sticky", top: 12, maxHeight: "calc(100dvh - 40px)", overflowY: "auto" } : {}) }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 15, fontWeight: 900, color: "var(--text)", textTransform: "capitalize" }}>
        {new Date(`${pick}T12:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
      {sel?.duration > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{hm(sel.duration)} de machine</span>}
    </div>
    {!sel?.items?.length && !selPlan.length && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
      {days ? "Rien d'imprimé ce jour-là" : "Chargement…"}</div>}
    {(sel?.items || []).map((it, i) => { const [c, l] = ST[it.status] || ST.SUCCESS;
      return <button key={`${it.id}${i}`} type="button" onClick={() => nav(`/prints?id=${it.id}`)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: 6, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)", cursor: "pointer", textAlign: "left" }}>
        <img src={apiThumb(apiUrl(`/prints/${it.id}/image`), 96)} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
          style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover", flexShrink: 0, background: "var(--surface)" }}/>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title || it.name}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
            {it.start.slice(0, 10) === pick ? `lancée à ${it.start.slice(11, 16)}` : "commencée la veille"} · {hm(it.seconds)} ce jour-là</span>
        </span>
        <span style={{ fontSize: 11, fontWeight: 900, color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, borderRadius: 9, padding: "2px 8px" }}>{l}</span>
      </button>; })}
    {selPlan.length > 0 && <>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#22C55E", marginTop: 4 }}>
        Prévu si la file s'enchaîne</div>
      {selPlan.map((it, i) => <button key={`${it.design_id}${i}`} type="button" onClick={() => nav(`/prints?tab=queue`)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: 6, borderRadius: 12, border: "1.5px dashed color-mix(in srgb, #22C55E 50%, var(--border))",
          background: "color-mix(in srgb, #22C55E 6%, var(--surface2))", cursor: "pointer", textAlign: "left" }}>
        <span style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          background: "var(--surface)" }}>✅</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {it.title}{it.qty > 1 ? ` ×${it.qty}` : ""}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>vers {it.start} · {hm(it.seconds)} ce jour-là</span>
        </span>
      </button>)}
    </>}
  </div>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {/* le mois et ses chiffres */}
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button type="button" onClick={() => go(-1)} aria-label="Mois précédent" data-tip="Mois précédent" style={navBtn}><ChevronLeft size={18}/></button>
      <div style={{ flex: 1, textAlign: "center", fontSize: 19, fontWeight: 900, color: "var(--text)", textTransform: "capitalize" }}>
        {MONTHS[month.getMonth()]} {month.getFullYear()}</div>
      <button type="button" onClick={() => go(1)} aria-label="Mois suivant" data-tip="Mois suivant" style={navBtn}><ChevronRight size={18}/></button>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); pickDay(iso(d)); }}
        style={{ ...pill, color: "#6366F1", borderColor: "color-mix(in srgb, #6366F1 40%, var(--border))" }}>Aujourd'hui</button>
      <button type="button" onClick={() => setShowPlan(v => !v)} data-tip="La file « À faire », enchaînée sans pause après l'impression en cours"
        style={{ ...pill, ...(showPlan ? { color: "#22C55E", borderColor: "color-mix(in srgb, #22C55E 45%, var(--border))", background: "color-mix(in srgb, #22C55E 10%, var(--surface2))" } : {}) }}>
        {showPlan ? "✓ " : ""}Prévisions de la file{showPlan && nPlanned ? ` (${nPlanned})` : ""}</button>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {chip("Impressions", days ? mCount : "…", "#3B82F6")}
      {chip("Heures machine", days ? hm(mTotal) : "…", "#8B5CF6")}
      {chip("Occupation", days ? `${Math.round(occ * 100)} %` : "…", "#EC4899")}
      {chip("Jours actifs", days ? `${mActive} / ${monthDays.length}` : "…", "#22C55E")}
    </div>
    {side ? <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 12, alignItems: "start" }}>{calendar}{detail}</div> : <>{calendar}{detail}</>}
  </div>;
}

const navBtn = { width: 38, height: 38, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center" };
const pill = { padding: "6px 12px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", fontSize: 12,
  fontWeight: 800, cursor: "pointer" };
