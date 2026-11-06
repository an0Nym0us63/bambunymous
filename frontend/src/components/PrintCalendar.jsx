import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import client, { apiUrl, apiThumb } from "../api/client";
import { egg } from "../eggs";
import { useCanMw } from "../store/auth";
import MakerWorldModelSheet from "./MakerWorldModelSheet";
import MwImg, { thumbSrc } from "./MwImg";
import { currentFriend } from "../store/friend";
import { usePlanActs } from "./planActs";
import { TimeGrid, WeekAgenda, weekOf } from "./CalendarViews";
import { UndoPill, PlanPopup, JobSheet, PoolGrouped, PoolSummary, ModelSheet, poolGroups, BlockedList, LowStockBanner } from "./PlanPanels";
import { PlanDashboard, Legend } from "./PlanDay";
import { OPT_MODES, DAY_KIND, dayKindOf, DayStrip, onDay, JobCard, PlanSettings, PlanAdvice, PlanDeadlines, ColorDay, ManualDone, PlateThumb, NowNextTiles, jobName, dueTxt, doneTxt, plateTxt, UNRET, unretained } from "./PlanDay";

// Le calendrier des impressions (04/11/2026) : le mois, chaque jour avec l'etagere de ses impressions (une vignette
// chacune, liseree de son etat) posee sur la barre de ses heures machine (une impression qui
// passe minuit compte sur les deux jours, comme les stats), ses impressions et leur etat ; la charge de chaque
// semaine ; et, sur les jours a venir, la file « A faire » si elle s'enchainait sans pause, apres l'impression en cours.
export const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
export const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const ST = { SUCCESS: ["#22C55E", "réussie"], FAILED: ["#EF4444", "échouée"], CANCELLED: ["#94A3B8", "annulée"], PARTIAL: ["#F59E0B", "partielle"],
  IN_PROGRESS: ["#3B82F6", "en cours"] };
export const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// les impressions d'un jour, une fois chacune (une impression sur deux jours n'y est qu'une fois par jour)
const shelf0 = x => [...new Map((x?.items || []).map(i => [i.id, i])).values()];
const hm = s => { const m = Math.round((s || 0) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
// l'etat du planning : a lancer, en retard, en avance, dans les temps
function PlanStatus({ st, live, check, compact }) {
  const c = { due: "#6366F1", late: "#F97316", ahead: "#22C55E", ontime: "#22C55E", deadline: "#EF4444" }[st.state] || "#64748B";
  const ic = { due: "⏰", late: "🐢", ahead: "🚀", ontime: "✅", deadline: "🎯" }[st.state] || "📅";
  // au telephone (06/11/2026) : une ligne ; la verification en infobulle (la carte « En cours » dit deja l'impression)
  if (compact) {
    const tip = check ? `Vérifié à ${check.at.slice(11, 16).replace(":", " h ")}${check.moved > 0 ? ` · ${check.moved} plateau${check.moved > 1 ? "x" : ""} décalé${check.moved > 1 ? "s" : ""} depuis 24 h` : ""}${check.overflow?.length ? ` · ${check.overflow.length} débordement${check.overflow.length > 1 ? "s" : ""}` : ""}` : undefined;
    return <div data-tip={tip} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 12,
      border: `1px solid color-mix(in srgb, ${c} 40%, var(--border))`, background: `color-mix(in srgb, ${c} 9%, var(--surface))` }}>
      <span style={{ fontSize: 15 }}>{ic}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.text}</span>
      {check && <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap" }}>🔄 {check.at.slice(11, 16).replace(":", " h ")}
        {check.overflow?.length ? <span style={{ color: "#EF4444" }}> · ⚠ {check.overflow.length}</span> : null}</span>}
    </div>;
  }
  return <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", borderRadius: 14, border: `1px solid color-mix(in srgb, ${c} 40%, var(--border))`,
    background: `color-mix(in srgb, ${c} 9%, var(--surface))` }}>
    <span style={{ fontSize: 17 }}>{ic}</span>
    <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "var(--text2)" }}>{st.text}
      {live && <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>En cours : {live.name} · encore {hm(live.remaining_min * 60)}</span>}
      {/* la tache de fond « Planning des impressions » : sa derniere verification */}
      {check && <span data-tip="La tâche « Planning des impressions » refait le planning toutes les 5 min et à chaque impression (Paramètres › Tâches)"
        style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
        🔄 Vérifié à {check.at.slice(11, 16).replace(":", " h ")}{check.moved > 0 ? ` · ${check.moved} plateau${check.moved > 1 ? "x" : ""} décalé${check.moved > 1 ? "s" : ""} depuis 24 h` : ""}
        {check.overflow?.length > 0 ? ` · ${check.overflow.length} débordement${check.overflow.length > 1 ? "s" : ""}` : ""}</span>}</span>
  </div>;
}
const useWidth = () => {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return w;
};

// la mosaique d'une case (05/11/2026) : la plus grande vignette qui fait tenir les n plateaux dans la place libre ;
// en dessous de `min`, on en montre moins et « +N »
function mosaic(n, w, h, min, max = 64) {
  for (let k = n; k >= 1; k--) {
    let best = 0;
    for (let c = 1; c <= k; c++) {
      const r = Math.ceil(k / c), sz = Math.floor(Math.min((w - (c - 1) * 3) / c, (h - (r - 1) * 3) / r));
      if (sz > best) best = sz;
    }
    if (best >= min || k === 1) return { shown: k, size: Math.max(8, Math.min(max, best)) };
  }
  return { shown: 0, size: min };
}

// le dernier planning et les dernieres journees lus (06/11/2026) : en revenant sur la page, ils s'affichent tout de suite,
// puis se relisent en fond (avant : un ecran vide le temps des deux lectures)
const CACHES = {};
const cacheOf = () => { const k = currentFriend()?.id || "me"; return (CACHES[k] = CACHES[k] || { pd: null, days: {} }); };

// onOpenPrint (06/11/2026) : la page des impressions ouvre la fiche d'une impression passee par-dessus le calendrier
// (sans changer d'onglet) ; sans lui, on y va par ?id=
export default function PrintCalendar({ onOpenPrint } = {}) {
  const nav = useNavigate();
  const width = useWidth(), wide = width >= 760, side = width >= 1180;   // side : le detail du jour a cote de la grille
  const detailRef = useRef(null);
  // la largeur reelle de la grille : l'etagere d'une case n'affiche que ce qui y tient (04/11/2026 : elle debordait)
  const calRef = useRef(null);
  const [calW, setCalW] = useState(0);
  useEffect(() => {
    const el = calRef.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setCalW(el.clientWidth)); ro.observe(el); setCalW(el.clientWidth);
    return () => ro.disconnect();
  }, [side]);
  // ?day=AAAA-MM-JJ (06/11/2026, depuis « A faire ») : ouvre ce jour
  const dayParam = useRef(/^\d{4}-\d{2}-\d{2}$/.test(new URLSearchParams(window.location.search).get("day") || "") ? new URLSearchParams(window.location.search).get("day") : null);
  const [month, setMonth] = useState(() => { const d = dayParam.current ? new Date(`${dayParam.current}T12:00`) : new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [days, setDays] = useState(null);       // {date: {count, duration, items}}
  // le planning (05/11/2026) : « A faire » plateau par plateau, pose par le serveur selon les consignes
  const [pd, setPd] = useState(() => cacheOf().pd);
  useEffect(() => { if (pd && pd.jobs) cacheOf().pd = pd; }, [pd]);
  // venu d'« À faire » (06/11/2026) : ?plan=… ouvre la fiche de ce modele du planning (?model= ouvre la fiche MakerWorld)
  const modelParam = useRef(new URLSearchParams(window.location.search).get("plan"));
  useEffect(() => {
    if (!modelParam.current || !pd?.jobs) return;
    const m = modelParam.current;
    modelParam.current = null;
    if ((pd.jobs || []).some(j => j.design_id === m) || (pd.blocked || []).some(j => j.design_id === m)) setModelSel(m);
  }, [pd]);
  // le planning est toujours montre (06/11/2026) : le bouton pour le masquer ne servait a rien
  const showPlan = true;
  const [setOpen, setSetOpen] = useState(false);
  const [sheet, setSheet] = useState(null);           // la fiche d'un modele : profil, plateaux, filaments retenus
  const [dragging, setDragging] = useState(null);
  const [dropDay, setDropDay] = useState(null);
  const edit = useCanMw();                            // ranger : droit MakerWorld, jamais chez un copain
  // les fenetres (05/11/2026) : un plateau et ses actions, les conseils, la file (telephone), les non planifiables
  const [jobSel, setJobSel] = useState(null);
  const [modelSel, setModelSel] = useState(null);     // la fiche d'un modele de la file (06/11/2026)
  const [pop, setPop] = useState(null);
  const [optPrev, setOptPrev] = useState(null);       // l'apercu d'une optimisation (06/11/2026)               // "advice" | "pool" | "blocked"
  const [pick, setPick] = useState(() => dayParam.current || iso(new Date()));
  // la vue (05/11/2026) : le mois, la semaine (grille horaire ; un agenda au telephone) ou le jour
  const [view, setViewS] = useState(() => { if (dayParam.current) return "day"; try { return localStorage.getItem("bn_cal_view") || (window.innerWidth >= 760 ? "month" : "day"); } catch { return "month"; } });
  const setView = v => { setViewS(v); try { localStorage.setItem("bn_cal_view", v); } catch { /* rien */ } if (v !== "month") egg("calendrier_vues"); };
  const week = useMemo(() => weekOf(pick), [pick]);
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
  // ce qu'il faut lire : le mois affiche ; en semaine et en jour, la semaine du jour choisi
  const rFrom = view === "month" ? grid.from : week[0], rTo = view === "month" ? grid.to : week[6];
  useEffect(() => {
    let alive = true;
    const ck = `${rFrom}|${rTo}`;
    setDays(cacheOf().days[ck] || null);
    client.get("/prints/kpis/daily", { params: { date_from: rFrom, date_to: rTo, tz: -new Date().getTimezoneOffset(), detail: true } })
      .then(r => { const v = Object.fromEntries((r.data || []).map(x => [x.date, x])); cacheOf().days[ck] = v; if (alive) setDays(v); })
      .catch(() => alive && setDays(x => x || {}));
    return () => { alive = false; };
  }, [rFrom, rTo]);
  useEffect(() => {
    let alive = true;
    const load = () => client.get("/makerworld/plan", { params: { tz: -new Date().getTimezoneOffset() } })
      .then(r => alive && setPd(r.data)).catch(() => alive && setPd(x => x || { jobs: [], days: {} }));
    load();
    // le planning suit l'impression en cours : relu chaque minute (avance, retard, ce qui est a lancer)
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const plan = useMemo(() => {
    const out = {};
    if (showPlan) for (const j of pd?.jobs || []) (out[j.day] = out[j.day] || []).push(j);
    return out;
  }, [pd, showPlan]);
  // les gestes du planning, partages avec « A faire » (06/11/2026)
  const { undo, keys, byKey, send, arrange, moveBefore, moveAfter, moveDay, unpin, placeDay, toFront, modelAct, applyAdvice, setDue, markDone, colorDay, optimize, optimizeFrom, applyOptimized, jobAct } = usePlanActs({ pd, setPd, setSheet, setModelSel,
    onDayView: day => { setPick(day); setView("day"); } });
  const saveSettings = async v => { if (await send("/makerworld/plan/settings", v)) { egg("planning_consignes"); setSetOpen(false); } };
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
  const shift = (day, n) => { const d = new Date(`${day}T12:00`); d.setDate(d.getDate() + n); return iso(d); };
  const go = n => {
    if (view === "month") return setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));
    const p = shift(pick, view === "week" ? 7 * n : n);
    setPick(p);
    const d = new Date(`${p}T12:00`);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const fmtShort = d => new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const title = view === "month" ? `${MONTHS[month.getMonth()]} ${month.getFullYear()}`
    : view === "week" ? `${fmtShort(week[0])} – ${fmtShort(week[6])}`
    : new Date(`${pick}T12:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const unit = { month: "Mois", week: "Semaine", day: "Jour" }[view];
  // au telephone, en semaine et en jour : glisser a gauche ou a droite change de periode
  const swipe = useRef(null);
  const swipeProps = view !== "month" ? {
    onTouchStart: e => { const t = e.touches[0]; swipe.current = { x: t.clientX, y: t.clientY }; },
    onTouchEnd: e => { const s0 = swipe.current; swipe.current = null; if (!s0) return; const t = e.changedTouches[0];
      const dx = t.clientX - s0.x, dy = t.clientY - s0.y; if (Math.abs(dx) > 70 && Math.abs(dx) > 1.6 * Math.abs(dy)) go(dx < 0 ? 1 : -1); },
  } : {};
  // au telephone (06/11/2026) : les quatre sur une ligne, en petit (deux grandes lignes avant)
  const chip = (label, value, color) => <div style={{ flex: wide ? "1 1 120px" : "1 1 0", minWidth: 0, padding: wide ? "10px 12px" : "6px 7px", borderRadius: wide ? 14 : 11,
    border: "1px solid var(--border)", background: `linear-gradient(150deg, color-mix(in srgb, ${color} 14%, transparent), transparent 70%), var(--surface2)` }}>
    <div style={{ fontSize: wide ? 10.5 : 8.5, fontWeight: 900, letterSpacing: wide ? ".06em" : ".02em", textTransform: "uppercase", color,
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
    <div style={{ fontSize: wide ? 20 : 14.5, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" }}>{value}</div></div>;
  // le detail du jour : a cote de la grille sur grand ecran ; dessous ailleurs, et la page y descend au toucher
  const pickDay = k => { setPick(k); if (!side) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  const grid7 = `repeat(7, minmax(0, 1fr))${wide ? " 64px" : ""}`;
  const gap = wide ? 5 : 3, cellW = calW ? (calW - 2 * (wide ? 8 : 5) - (wide ? 64 + gap : 0) - 6 * gap) / 7 : 60;
  // sur ordinateur, la case suit sa largeur (04/11/2026 : a 70 px de haut, le mois paraissait tasse) ; au telephone, fixe
  const cellH = wide ? Math.round(Math.min(112, Math.max(80, cellW * 0.82))) : 56;
  const calendar = <div ref={calRef} style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", padding: wide ? 8 : 5, overflow: "hidden", minWidth: 0 }}>
    <div style={{ display: "grid", gridTemplateColumns: grid7, gap: wide ? 5 : 3, marginBottom: 4 }}>
      {DAYS.map(d => <div key={d} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 900, color: "var(--muted)", letterSpacing: ".04em" }}>{wide ? d : d[0]}</div>)}
      {wide && <div style={{ textAlign: "center", fontSize: 10.5, fontWeight: 900, color: "var(--muted)" }}>Semaine</div>}
    </div>
    {grid.weeks.map(w => {
      const wDur = w.reduce((a, d) => a + (days?.[iso(d)]?.duration || 0), 0);
      return <div key={iso(w[0])} style={{ display: "grid", gridTemplateColumns: grid7, gap: wide ? 5 : 3, marginBottom: wide ? 5 : 3 }}>
        {w.map(d => {
          const k = iso(d), x = days?.[k], p = plan[k] || [], fill = Math.min(1, (x?.duration || 0) / 86400);
          const pfill = showPlan ? Math.min(1 - fill, (pd?.days?.[k]?.seconds || 0) / 86400) : 0;
          // un jour avec du prevu : ses plateaux en mosaique (ce qui est deja fait ce jour-la d'abord), qui prend la place
          const top = wide ? 22 : 16;
          const mos = p.length ? mosaic(shelf0(x).length + p.length, cellW - 2 * (wide ? 5 : 3), cellH - top - (wide ? 9 : 7), wide ? 22 : 13) : null;
          const finished = p.filter(j => j.completes);
          // l'etagere : une vignette par impression du jour (une impression sur deux jours n'y est qu'une fois par jour)
          const shelf = shelf0(x);
          // ce qui tient dans la case : cote a cote, sinon chevauchees comme des livres (jusqu'a la moitie), puis « +N »
          const th = wide ? Math.round(Math.min(30, Math.max(22, cellW * 0.22))) : 15, avail = cellW - 2 * (wide ? 5 : 3) - 4, more = wide ? 16 : 13;
          const fitAll = shelf.length * th + (shelf.length - 1) * 2 <= avail;
          const room = fitAll ? shelf.length : Math.max(1, 1 + Math.floor((avail - more - th) / (th * 0.45)));
          const shown = Math.min(shelf.length, room);
          const step = shown > 1 ? Math.min(th + 2, (avail - (shelf.length > shown ? more : 0) - th) / (shown - 1)) : th;
          const on = k === pick, isToday = k === today;
          // un jour a venir : on y depose une impression de la file
          const drop = edit && k >= today ? {
            onDragOver: e => { if (e.dataTransfer.types.includes("text/bn-job")) { e.preventDefault(); setDropDay(k); } },
            onDragLeave: () => setDropDay(x => x === k ? null : x),
            onDrop: e => { const j = e.dataTransfer.getData("text/bn-job"); setDropDay(null); if (j) { e.preventDefault(); moveDay(j, k); pickDay(k); } } } : {};
          return <button key={k} type="button" onClick={() => pickDay(k)} aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]}`} {...drop}
            style={{ position: "relative", height: cellH, minWidth: 0, borderRadius: wide ? 11 : 8, cursor: "pointer", overflow: "hidden", padding: 0,
              border: dropDay === k ? "2px dashed #22C55E" : on ? "2px solid #6366F1" : isToday ? "2px solid color-mix(in srgb, #6366F1 55%, transparent)" : "1px solid var(--border)",
              background: on ? "color-mix(in srgb, #6366F1 8%, var(--surface2))" : "var(--surface2)", opacity: inMonth(d) ? 1 : 0.38, textAlign: "left" }}>
            {/* les heures du jour, en remplissage depuis le bas ; la file prevue au-dessus, en hachures */}
            <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${fill * 100}%`,
              background: "linear-gradient(0deg, color-mix(in srgb, #8B5CF6 45%, transparent), color-mix(in srgb, #EC4899 18%, transparent))" }}/>
            {pfill > 0 && <>
              <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "color-mix(in srgb, #22C55E 7%, transparent)" }}/>
              <span aria-hidden="true" data-tip={`${hm((pd?.days?.[k]?.seconds) || 0)} prévues`} style={{ position: "absolute", left: 0, bottom: 0, height: 3,
                width: `${Math.min(100, (fill + pfill) * 100)}%`, background: "linear-gradient(90deg, #22C55E, #86EFAC)", borderRadius: "0 3px 3px 0" }}/>
            </>}
            <span style={{ position: "absolute", top: wide ? 4 : 3, left: wide ? 6 : 4, fontSize: wide ? 12 : 10.5, fontWeight: 900,
              color: isToday ? "#6366F1" : "var(--text)" }}>{d.getDate()}</span>
            {/* un jour particulier : absent, peu dispo (06/11/2026) */}
            {dayKindOf(pd?.settings, k) && (() => { const [ic, l, c] = DAY_KIND[dayKindOf(pd?.settings, k)];
              return <span data-tip={l} style={{ position: "absolute", top: wide ? 3 : 2, left: wide ? 22 : 16, fontSize: wide ? 11 : 9,
                padding: "0 3px", borderRadius: 5, background: `color-mix(in srgb, ${c} 18%, transparent)` }}>{ic}</span>; })()}
            {p.some(j => j.low_info?.length) && <span data-tip={p.flatMap(j => (j.low_info || []).map(x => `📉 ${x.name} sous le seuil (${j.title})`)).join(" · ")}
              style={{ position: "absolute", top: wide ? 4 : 2, left: wide ? 24 : 17, zIndex: 2, fontSize: wide ? 11 : 9, lineHeight: 1, padding: "1px 3px", borderRadius: 6,
                background: "#FEE2E2", border: "1px solid #FCA5A5" }}>📉</span>}
            {/* un objet s'y termine : une pastille doree, lisible */}
            {finished.length > 0 && <span data-tip={finished.map(j => `${doneTxt(j)} : ${j.title}`).join(" · ")}
              style={{ position: "absolute", top: wide ? 3 : 2, right: wide ? 4 : 2, zIndex: 2, display: "inline-flex", alignItems: "center", gap: 2,
                padding: wide ? "1px 6px" : "0 4px", borderRadius: 9, background: "#D1FAE5", color: "#065F46", fontSize: wide ? 10.5 : 9, fontWeight: 900,
                boxShadow: "0 1px 3px rgba(0,0,0,.25)" }}>🏁{finished.length > 1 || wide ? ` ${finished.length}` : ""}</span>}
            {wide && p.length > 0 && !finished.length && cellW >= 74 && <span style={{ position: "absolute", top: 5, right: 6, fontSize: 9.5, fontWeight: 900,
              color: "#16A34A" }}>{hm((pd?.days?.[k]?.seconds) || 0)}</span>}
            {wide && !p.length && x?.duration > 0 && cellW >= 74 && <span style={{ position: "absolute", top: 5, right: 6, fontSize: 9.5, fontWeight: 800, color: "var(--text2)" }}>{hm(x.duration)}</span>}
            {/* un jour avec du prevu : la mosaique, ce qui est fait d'abord (liseré de son etat), puis les plateaux prevus
                (pointilles verts ; dores quand ils terminent un objet) */}
            {mos && <span style={{ position: "absolute", left: wide ? 5 : 3, right: wide ? 5 : 3, top, bottom: wide ? 7 : 5, display: "flex", flexWrap: "wrap",
              alignContent: "flex-end", gap: 3, overflow: "hidden" }}>
              {[...shelf.map(it => ({ done: it })), ...p.map(j => ({ j }))].slice(0, mos.shown).map(({ done, j }, i) => {
                const c = done ? (ST[done.status] || ST.SUCCESS)[0] : j.too_long ? "#EF4444" : unretained(j) ? UNRET : j.completes ? "#059669" : "#22C55E";
                const img = done ? apiThumb(apiUrl(`/prints/${done.id}/image`), 96) : null;
                return <span key={done ? `d${done.id}` : j.key} style={{ width: mos.size, height: mos.size, flexShrink: 0, borderRadius: wide ? 7 : 4, overflow: "hidden",
                  boxSizing: "border-box", background: "#fff", position: "relative",
                  border: done ? `2px solid ${c}` : `${j.completes ? 2 : 1.5}px ${j.completes ? "solid" : "dashed"} ${c}` }}>
                  {done ? <img src={img} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                    : j.thumb ? <MwImg src={j.thumb} w={Math.max(64, mos.size * 2)} style={{ width: "100%", height: "100%", objectFit: "contain" }}/>
                    : j.cover ? <img src={thumbSrc(j.cover, 96)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}/> : null}
                  {!done && j.plates_total > 1 && mos.size >= 26 && <span style={{ position: "absolute", left: 1, bottom: 1, padding: "0 3px", borderRadius: 5,
                    background: "rgba(15,23,42,.75)", color: "#fff", fontSize: 8.5, fontWeight: 900, lineHeight: "12px" }}>{j.plate}</span>}
                </span>;
              })}
              {shelf.length + p.length > mos.shown && <span style={{ alignSelf: "flex-end", fontSize: wide ? 10.5 : 8.5, fontWeight: 900, color: "#16A34A" }}>
                +{shelf.length + p.length - mos.shown}</span>}
            </span>}
            {/* l'etagere des vignettes */}
            {!mos && <span style={{ position: "absolute", left: wide ? 5 : 3, right: wide ? 5 : 3, bottom: wide ? 6 : 5, display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
              {shelf.slice(0, shown).map((it, j) => { const c = (ST[it.status] || ST.SUCCESS)[0];
                return <img key={it.id} src={apiThumb(apiUrl(`/prints/${it.id}/image`), 64)} alt="" loading="lazy"
                  onError={e => { e.currentTarget.style.visibility = "hidden"; }}
                  style={{ width: th, height: th, borderRadius: wide ? 6 : 4, objectFit: "cover", flexShrink: 0, background: "var(--surface)",
                    marginLeft: j ? step - th : 0, position: "relative", zIndex: shown - j,
                    boxShadow: `0 2px 0 0 ${c}, 0 0 0 1px color-mix(in srgb, ${c} 40%, transparent)` }}/>; })}
              {shelf.length > shown && <span style={{ fontSize: wide ? 10 : 8.5, fontWeight: 900, color: "var(--text)", lineHeight: `${th}px`, marginLeft: 3, flexShrink: 0 }}>+{shelf.length - shown}</span>}
            </span>}
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
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 10, borderRadius: 3, border: "1.5px dashed #22C55E" }}/>plateau prévu</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ padding: "0 5px", borderRadius: 8, background: "#D1FAE5", color: "#065F46", fontWeight: 900 }}>🏁</span>objet terminé</span>
      <span>· le remplissage : les heures machine du jour</span>
    </div>
  </div>;
  const detail = <div ref={detailRef} style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", padding: 12, display: "flex", flexDirection: "column", gap: 8,
    scrollMarginTop: 70, minWidth: 0 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 15, fontWeight: 900, color: "var(--text)", textTransform: "capitalize" }}>
        {new Date(`${pick}T12:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
      {sel?.duration > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{hm(sel.duration)} de machine</span>}
      {dayKindOf(pd?.settings, pick) && (() => { const [ic, l, c, tip] = DAY_KIND[dayKindOf(pd?.settings, pick)];
        return <span data-tip={tip} style={{ fontSize: 11.5, fontWeight: 900, color: c, background: `color-mix(in srgb, ${c} 13%, transparent)`,
          borderRadius: 8, padding: "1px 8px" }}>{ic} {l}</span>; })()}
    </div>
    {/* la frise du jour en haut de la carte, sous son titre (06/11/2026 : en dessous de la liste, il fallait descendre) */}
    {pick >= today && <DayStrip day={pick} done={sel?.items || []} jobs={(pd?.jobs || []).filter(j => onDay(j, pick))} settings={pd?.settings} now={pd?.now}
      live={pd?.live && pd?.busy_until ? { now: pd.now, end: pd.busy_until, name: pd.live.name, planned: pd.live.planned_end } : null}/>}
    {pick >= today && pd?.live && pd?.busy_until && pd.busy_until.slice(0, 10) >= pick && pd.now.slice(0, 10) <= pick &&
      <div style={{ fontSize: 11.5, fontWeight: 800, color: "#2563EB" }}>⏳ En cours : {pd.live.name} · fin vers {pd.busy_until.slice(11, 16).replace(":", " h ")}
        {pd.busy_until.slice(0, 10) !== pd.now.slice(0, 10) ? " (le lendemain)" : ""}</div>}
    {!sel?.items?.length && !selPlan.length && pick < today && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
      {days ? "Rien d'imprimé ce jour-là" : "Chargement…"}</div>}
    {(sel?.items || []).map((it, i) => { const [c, l] = ST[it.status] || ST.SUCCESS;
      return <button key={`${it.id}${i}`} type="button" onClick={() => openPrint(it)}
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
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        <span style={{ flex: "1 0 100%", fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#22C55E" }}>
          Prévu · {hm(selPlan.reduce((a, j) => a + j.seconds, 0))}</span>
        {edit && selPlan.length > 1 && <button type="button" onClick={() => optimize(pick)} data-tip="Enchaîner les mêmes couleurs, la plus longue en fin de journée"
          style={{ ...pill, padding: "4px 10px", color: "#6366F1" }}>✨ Optimiser la journée</button>}
        {edit && <ColorDay colors={pd?.colors} onPick={fid => colorDay(pick, fid)}/>}
      </div>
      {selPlan.map((j, i) => <JobCard key={j.key} j={j} edit={edit} dragging={dragging} onDrag={setDragging}
        onDropBefore={moveBefore} onUp={i ? () => moveBefore(j.key, selPlan[i - 1].key) : null}
        onDown={i < selPlan.length - 1 ? () => moveAfter(j.key, selPlan[i + 1].key) : null}
        onDay={day => moveDay(j.key, day)} onUnpin={() => unpin(j.key)} onOpen={() => setJobSel(j)} onDue={due => setDue(j.design_id, due)} onDone={() => markDone(j.key)}
        compact={!wide}/>)}
    </>}
    {pick >= today && !selPlan.length && pd && <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
        {edit ? "Rien de prévu : glisse ici un plateau de la file (sous le calendrier), pose-le avec son 📅, ou fais-en une journée couleur." : "Rien de prévu ce jour-là."}</span>
      {edit && <ColorDay colors={pd?.colors} onPick={fid => colorDay(pick, fid)}/>}</div>}
  </div>;
  // glisse a une heure (06/11/2026) : fige a ce jour et cette heure-la (au quart d'heure) ; le reste s'organise autour.
  // Sa fiche le rend libre d'un geste
  const dropAt = (k, day, m) => send("/makerworld/plan/lock", { key: k, lock: true,
    at: `${day}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` }, "post").then(ok => { if (ok) egg("planning_fige"); });
  const openPrint = it => onOpenPrint ? onOpenPrint(it) : nav(`/prints?id=${it.id}`);
  // l'impression en cours et sa fin estimee : la grille prolonge son bloc jusque-la
  const live = pd?.live && pd?.busy_until ? { now: pd.now, end: pd.busy_until, name: pd.live.name, planned: pd.live.planned_end } : null;
  const openJob = j => setJobSel(j);
  const viewMain = view === "month" ? calendar
    // la semaine sur ordinateur : les 24 h en entier, sans defilement interne (06/11/2026)
    : view === "week" ? (wide ? <TimeGrid dates={week} days={days} jobs={showPlan ? pd?.jobs : []} settings={pd?.settings} now={pd?.now} live={live} hourPx={28}
        pick={pick} onPick={pickDay} onOpenPrint={openPrint} onOpenJob={openJob} edit={edit} onDropDay={moveDay} onDropAt={dropAt} height="full"/>
      : <WeekAgenda dates={week} days={days} jobs={showPlan ? pd?.jobs : []} settings={pd?.settings} now={pd?.now} live={live} pick={pick}
        onPick={k => { setPick(k); setView("day"); }} onOpenPrint={openPrint} onOpenJob={openJob}/>)
    : <TimeGrid dates={[pick]} days={days} jobs={showPlan ? pd?.jobs : []} settings={pd?.settings} now={pd?.now} live={live} hourPx={wide ? 46 : 40}
        pick={pick} onPick={pickDay} onOpenPrint={openPrint} onOpenJob={openJob} edit={edit} onDropDay={moveDay} onDropAt={dropAt} height={wide ? 640 : 460}/>;
  const advice = showPlan ? <>
    <PlanDeadlines items={pd?.deadlines} edit={edit} onDue={setDue}/>
    <ManualDone items={pd?.manual_done} edit={edit} onUndo={k => markDone(`${k}:0`, true)}/></> : null;
  // la file : chaque impression prevue, dans l'ordre, a glisser sur un jour du calendrier
  const pool = showPlan && pd?.jobs?.length ? <div style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", padding: 10 }}>
    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#22C55E", marginBottom: 7 }}>
      La file · {poolGroups(pd.jobs, pd.blocked).length} modèles · {pd.jobs.length} plateau{pd.jobs.length > 1 ? "x" : ""}{edit ? " · touche un modèle pour ses actions et celles de ses plateaux" : ""}
      {pd.jobs.some(unretained) && <span style={{ display: "block", marginTop: 3, fontSize: 11, fontWeight: 700, letterSpacing: 0, textTransform: "none", color: "var(--muted)" }}>
        ○ en gris : modèles pas retenus dans « À faire » (profil par défaut), planifiés après les retenus.</span>}</div>
    {/* regroupee par objet (05/11/2026) : son en-tete, puis ses plateaux */}
    <PoolSummary jobs={pd.jobs} blocked={pd.blocked} now={pd.now} onOpenModel={setModelSel}/>
  </div> : null;
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {/* le mois et ses chiffres ; la date et ‹ › restent en haut au defilement (05/11/2026 au telephone, 06/11/2026 partout) */}
    {/* sur ordinateur, la page a 16 px de marge en haut : la barre colle au bord (top negatif), sinon le contenu passe au-dessus */}
    <div style={{ display: "flex", alignItems: "center", gap: 8, position: "sticky", zIndex: 20,
      background: "color-mix(in srgb, var(--bg) 88%, transparent)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      ...(width >= 768 ? { top: "calc(-16px - var(--sat, 0px))", margin: "-16px -16px 0", padding: "12px 16px 8px", borderBottom: "1px solid var(--border)" }
        : { top: 0, margin: "-6px -16px 0", padding: "6px 16px", borderBottom: "1px solid var(--border)" }) }}>
      <button type="button" onClick={() => go(-1)} aria-label={`${unit} précédent`} data-tip={`${unit} précédent`} style={navBtn}><ChevronLeft size={18}/></button>
      <div style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: wide ? 19 : 16.5, fontWeight: 900, color: "var(--text)", textTransform: "capitalize",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      <button type="button" onClick={() => go(1)} aria-label={`${unit} suivant`} data-tip={`${unit} suivant`} style={navBtn}><ChevronRight size={18}/></button>
    </div>
    <div role="tablist" style={{ display: "flex", padding: 3, borderRadius: 14, background: "var(--surface2)", border: "1px solid var(--border)" }}>
      {[["month", "Mois"], ["week", "Semaine"], ["day", "Jour"]].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k}
        onClick={() => setView(k)} style={{ flex: 1, padding: "7px 6px", borderRadius: 11, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 900,
          color: view === k ? "#fff" : "var(--muted)", background: view === k ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "transparent",
          boxShadow: view === k ? "0 6px 14px -8px #6366F1" : "none" }}>{l}</button>)}
    </div>
    {/* au telephone (06/11/2026) : une seule ligne qui defile au doigt, libelles courts (sur quatre lignes, elles
        prenaient presque tout l'ecran) */}
    <div data-noswipe="" className={wide ? undefined : "bn-pills"} style={wide ? { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }
      : { display: "flex", gap: 6, alignItems: "center", overflowX: "auto", margin: "0 -16px", padding: "1px 16px", scrollbarWidth: "none" }}>
      {!wide && <style>{".bn-pills::-webkit-scrollbar{display:none}.bn-pills>button{flex-shrink:0;white-space:nowrap;padding:5px 10px !important}"}</style>}
      <button type="button" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setPick(iso(d)); }}
        style={{ ...pill, color: "#6366F1", borderColor: "color-mix(in srgb, #6366F1 40%, var(--border))" }}>Aujourd'hui</button>
      <button type="button" onClick={() => setSetOpen(v => !v)} data-tip="Pause entre deux impressions, heures de fonctionnement et de lancement"
        style={{ ...pill, ...(setOpen ? { color: "#6366F1" } : {}) }} aria-label="Consignes">{wide ? "⚙ Consignes" : "⚙"}</button>
      {edit && nPlanned > 1 && <button type="button" onClick={() => setPop("optimize")}
        data-tip="Enchaîner les plateaux de mêmes couleurs dans toute la file (les impressions posées sur un jour ne bougent pas)"
        aria-label="Optimiser la file" style={{ ...pill, color: "#6366F1" }}>{wide ? "✨ Optimiser la file" : "✨"}</button>}
      {edit && <UndoPill info={pd?.undo} onUndo={undo} compact={!wide}/>}
      {showPlan && pd?.advice?.length > 0 && <button type="button" onClick={() => setPop("advice")} data-tip="Les conseils du planning"
        style={{ ...pill, color: "#D97706", borderColor: "color-mix(in srgb, #F59E0B 45%, var(--border))", background: "color-mix(in srgb, #F59E0B 10%, var(--surface2))" }}>
        💡 {pd.advice.length}</button>}
      {/* les plateaux figes : combien, et leur liste */}
      {showPlan && pd?.jobs?.some(j => j.locked) && <button type="button" onClick={() => setPop("locked")} data-tip="Plateaux figés : optimiser, journée couleur, au mieux ou plus tard ne les déplacent pas"
        style={{ ...pill, color: "#4F46E5", borderColor: "color-mix(in srgb, #4F46E5 40%, var(--border))", background: "color-mix(in srgb, #4F46E5 8%, var(--surface2))" }}>
        🔒 {pd.jobs.filter(j => j.locked).length}{wide ? ` figé${pd.jobs.filter(j => j.locked).length > 1 ? "s" : ""}` : ""}</button>}
      {/* le seuil, comme les conseils (05/11/2026) : un bouton, la liste dans une fenetre */}
      {showPlan && pd?.jobs?.some(j => j.low_info?.length) && <button type="button" onClick={() => setPop("low")}
        data-tip="Des filaments passeront sous le seuil (un quart de bobine) pendant le planning"
        style={{ ...pill, color: "#DC2626", borderColor: "color-mix(in srgb, #DC2626 40%, var(--border))", background: "color-mix(in srgb, #DC2626 7%, var(--surface2))" }}>
        📉 {pd.jobs.reduce((a, j) => a + (j.low_info?.length || 0), 0)}{wide ? " sous le seuil" : ""}</button>}
      {showPlan && pd?.blocked?.length > 0 && <button type="button" onClick={() => setPop("blocked")} data-tip="Plateaux que le stock et les commandes ne permettent pas de poser"
        style={{ ...pill, color: "#DC2626", borderColor: "color-mix(in srgb, #DC2626 45%, var(--border))", background: "color-mix(in srgb, #DC2626 9%, var(--surface2))" }}>
        ⛔ {pd.blocked.length}{wide ? ` non planifiable${pd.blocked.length > 1 ? "s" : ""}` : ""}</button>}
      {showPlan && !side && pd?.jobs?.length > 0 && <button type="button" onClick={() => setPop("pool")} data-tip="La file : chaque plateau prévu, par objet"
        style={{ ...pill, color: "#16A34A", borderColor: "color-mix(in srgb, #22C55E 45%, var(--border))" }}>📋 {wide ? `La file (${pd.jobs.length})` : `File ${pd.jobs.length}`}</button>}
    </div>
    {pd?.status && showPlan && <PlanStatus st={pd.status} live={null} check={pd.check} compact={!wide}/>}
    {pd && showPlan && <PlanDashboard s={pd.summary} dur={pd.dur} now={pd.now} onLegend={() => setPop("legend")}/>}
    {pd && showPlan && <NowNextTiles pd={pd} wide={wide} onOpenPrint={openPrint} onPickJob={j => setJobSel(j)}/>}
    {showPlan && (pd?.deadlines || []).filter(x => !x.ok).map(x => <PlanStatus key={x.design_id}
      st={{ state: "deadline", text: `${x.title} ne sera pas fini avant le ${dueTxt(x.due)} : voir les conseils` }}/>)}
    {setOpen && <PlanPopup title="Les consignes du planning" icon="⚙" color="#6366F1" onClose={() => setSetOpen(false)}>
      <PlanSettings s={pd?.settings} dur={pd?.dur} onSave={saveSettings} onClose={() => setSetOpen(false)}/></PlanPopup>}
    {view === "month" && <div style={{ display: "flex", gap: wide ? 8 : 5, flexWrap: wide ? "wrap" : "nowrap" }}>
      {chip("Impressions", days ? mCount : "…", "#3B82F6")}
      {chip("Heures machine", days ? hm(mTotal) : "…", "#8B5CF6")}
      {chip("Occupation", days ? `${Math.round(occ * 100)} %` : "…", "#EC4899")}
      {chip("Jours actifs", days ? `${mActive} / ${monthDays.length}` : "…", "#22C55E")}
    </div>}
    {modelSel && <ModelSheet g={poolGroups(pd?.jobs, pd?.blocked).find(g => g.id === modelSel)} now={pd?.now} edit={edit} jobs={pd?.jobs}
      onClose={() => setModelSel(null)} onPick={setJobSel} act={modelAct(modelSel)}/>}
    {jobSel && <JobSheet j={jobSel} now={pd?.now} edit={edit} onClose={() => setJobSel(null)} act={jobAct(jobSel)} jobs={pd?.jobs}/>}
    {optPrev && <OptimizePreview p={optPrev} onClose={() => setOptPrev(null)} onApply={() => { const p = optPrev; setOptPrev(null); applyOptimized(p); }}/>}
    {pop === "optimize" && <OptimizePick today={today} mode0={pd?.settings?.opt_mode} onPick={(from, mode, keep) => { setPop(null); optimizeFrom(from, mode, keep).then(r => r && setOptPrev(r)); }}
      onClose={() => setPop(null)}/>}
    {pop === "legend" && <PlanPopup title="Ce que disent les signes" icon="?" color="#6366F1" onClose={() => setPop(null)}><Legend/></PlanPopup>}
    {pop === "advice" && <PlanPopup title={`Conseils (${pd?.advice?.length || 0})`} icon="💡" color="#F59E0B" onClose={() => setPop(null)}>
      <PlanAdvice items={pd?.advice} edit={edit} onApply={a => { applyAdvice(a); setPop(null); }}/></PlanPopup>}
    {pop === "locked" && <PlanPopup title="Plateaux figés" icon="🔒" color="#4F46E5" onClose={() => setPop(null)}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45, marginBottom: 8 }}>
        Ils gardent leur jour et leur heure : le reste s'organise autour. Touche-en un pour le défiger.</div>
      <PoolGrouped jobs={(pd?.jobs || []).filter(j => j.locked)} now={pd?.now} edit={edit} onOpen={j => setJobSel(j)}/></PlanPopup>}
    {pop === "low" && <PlanPopup title="Sous le seuil" icon="📉" color="#DC2626" onClose={() => setPop(null)}>
      <LowStockBanner jobs={pd?.jobs} now={pd?.now} inPopup onOpen={j => setJobSel(j)}/></PlanPopup>}
    {pop === "blocked" && <PlanPopup title="Non planifiables" icon="⛔" color="#DC2626" onClose={() => setPop(null)}>
      <BlockedList items={pd?.blocked || []} onOpen={b => setJobSel(b)}/></PlanPopup>}
    {pop === "pool" && <PlanPopup title={`La file · ${pd?.jobs?.length || 0} plateaux`} icon="📋" color="#22C55E" onClose={() => setPop(null)}>
      <PoolSummary jobs={pd?.jobs || []} blocked={pd?.blocked || []} now={pd?.now} onOpenModel={setModelSel}/></PlanPopup>}
    {side ? <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 12, alignItems: "start" }}>
      <div {...swipeProps} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>{viewMain}{pool}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "sticky", top: 12, maxHeight: "calc(100dvh - 40px)", overflowY: "auto" }}>{detail}{advice}</div>
    </div> : <><div {...swipeProps}>{viewMain}</div>{advice}{view === "week" ? null : detail}</>}
    {sheet && <MakerWorldModelSheet designId={String(sheet)} onClose={() => { setSheet(null);
      client.get("/makerworld/plan", { params: { tz: -new Date().getTimezoneOffset() } }).then(r => setPd(r.data)).catch(() => {}); }}/>}
  </div>;
}

const navBtn = { width: 38, height: 38, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center" };
// « Optimiser la file » : a partir de quand (06/11/2026). Ce qui est prevu avant reste a sa place.
// l'apercu d'une optimisation (06/11/2026) : avant, apres, ce qui change ; Appliquer ou garder tel quel
function OptimizePreview({ p, onApply, onClose }) {
  const a = p.preview.before, b = p.preview.after;
  const day = iso => iso ? new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) + ` ${+iso.slice(11, 13)} h${iso.slice(14, 16) !== "00" ? ` ${iso.slice(14, 16)}` : ""}` : "—";
  const rows = [["🧵", "Bobines à charger", a.loads, b.loads, x => x], ["🌙", "Nuits perdues", a.nights, b.nights, x => x],
    ["⏸", "Temps mort la nuit", a.idle_min, b.idle_min, x => hm(x * 60)], ["⏱", "Fin moyenne d'un plateau", a.avg_h, b.avg_h, x => `${x} h`],
    ["🏁", "Tout fini", a.end, b.end, day], ["🎯", "Dates limites ratées", a.late, b.late, x => x]];
  const better = (x, y, i) => i === 4 ? (y < x ? 1 : y > x ? -1 : 0) : (y < x ? 1 : y > x ? -1 : 0);
  const mode = OPT_MODES.find(m => m[0] === p.preview.mode);
  return <PlanPopup title="Ce que ça donnerait" icon="✨" color="#6366F1" onClose={onClose}>
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45, marginBottom: 10 }}>
      {mode ? `${mode[1]} ${mode[2]} · ` : ""}{p.preview.moved ? `${p.preview.moved} plateau${p.preview.moved > 1 ? "x changeraient" : " changerait"} vraiment de place sur ${a.plates}` : "Presque rien ne bougerait"}. Rien n'a encore bougé.</div>
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto", gap: "6px 10px", alignItems: "center", fontSize: 13 }}>
      <span/><span/><span style={{ fontSize: 11, fontWeight: 900, color: "var(--muted)" }}>Avant</span><span/><span style={{ fontSize: 11, fontWeight: 900, color: "var(--muted)" }}>Après</span>
      {rows.map(([ic, l, x, y, f], i) => { const g = better(x, y, i);
        return <React.Fragment key={l}><span>{ic}</span><span style={{ fontWeight: 800, color: "var(--text2)" }}>{l}</span>
          <span style={{ fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap" }}>{f(x)}</span><span style={{ color: "var(--muted)" }}>→</span>
          <span style={{ fontWeight: 900, whiteSpace: "nowrap", color: g > 0 ? "#16A34A" : g < 0 ? "#DC2626" : "var(--text)" }}>{f(y)}</span></React.Fragment>; })}
    </div>
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
      <button type="button" onClick={onClose} style={{ ...pill, padding: "8px 14px" }}>Garder tel quel</button>
      <button type="button" onClick={onApply} style={{ padding: "8px 16px", borderRadius: 12, border: "none", cursor: "pointer", font: "inherit",
        background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#fff", fontSize: 13, fontWeight: 900 }}>Appliquer</button>
    </div>
  </PlanPopup>;
}

function OptimizePick({ today, mode0, onPick: pick, onClose }) {
  const [free, setFree] = useState("");
  const [mode, setMode] = useState(mode0 || "mix");
  // bouger le moins possible (06/11/2026) : garde dans ce navigateur
  const [keep, setKeepS] = useState(() => { try { return localStorage.getItem("bn_opt_keep") === "1"; } catch { return false; } });
  const setKeep = v => { setKeepS(v); try { localStorage.setItem("bn_opt_keep", v ? "1" : "0"); } catch { /* rien */ } };
  const onPick = from => pick(from, mode, keep);
  const cur = OPT_MODES.find(m => m[0] === mode) || OPT_MODES[0];
  const plus = n => { const t = new Date(`${today}T12:00`); t.setDate(t.getDate() + n);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
  const opt = (k, ic, label, hint, from) => <button key={k} type="button" onClick={() => onPick(from)}
    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)",
      background: "var(--surface)", cursor: "pointer", textAlign: "left", font: "inherit" }}>
    <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{ic}</span>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 13.5, fontWeight: 900, color: "var(--text)" }}>{label}</span>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>{hint}</span></span></button>;
  const fr = d => new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return <PlanPopup title="Optimiser la file" icon="✨" color="#6366F1" onClose={onClose}>
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45, marginBottom: 8 }}>
      D'abord le mode, puis à partir de quand. Ce qui est prévu avant le jour choisi ne bouge pas, les plateaux figés non plus,
      et aucune date limite n'est sacrifiée.</div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
      {OPT_MODES.map(([k, ic, l]) => <button key={k} type="button" onClick={() => setMode(k)}
        style={{ padding: "8px 8px", borderRadius: 11, cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 900, textAlign: "left",
          border: `1.5px solid ${mode === k ? "#6366F1" : "var(--border)"}`, color: mode === k ? "#fff" : "var(--text2)",
          background: mode === k ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--surface)" }}>{ic} {l}</button>)}
    </div>
    <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", lineHeight: 1.4, marginBottom: 8 }}>{cur[3]}</div>
    <label style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "9px 12px", borderRadius: 12, marginBottom: 10, cursor: "pointer",
      border: `1px solid ${keep ? "color-mix(in srgb, #6366F1 45%, var(--border))" : "var(--border)"}`, background: keep ? "color-mix(in srgb, #6366F1 8%, var(--surface))" : "var(--surface)" }}>
      <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} style={{ marginTop: 2 }}/>
      <span><span style={{ display: "block", fontSize: 13, fontWeight: 900, color: "var(--text)" }}>Bouger le moins possible</span>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>Il part de ton ordre et ne déplace que ce qui
          rapporte vraiment (une bobine, une nuit). Sinon, il refait toute la file.</span></span></label>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {opt("all", "✨", "Toute la file", "Dès maintenant", null)}
      {opt("tomorrow", "🌅", "Sans toucher à aujourd'hui", `À partir de demain, ${fr(plus(1))}`, plus(1))}
      {opt("after", "📆", "Sans toucher à aujourd'hui ni demain", `À partir de ${fr(plus(2))}`, plus(2))}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }}>
        <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>🗓</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 900, color: "var(--text)" }}>À partir du…</span>
        <input type="date" value={free} min={today} onChange={e => setFree(e.target.value)}
          onClick={e => { try { e.currentTarget.showPicker?.(); } catch { /* rien */ } }}
          style={{ padding: "6px 8px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", font: "inherit" }}/>
        <button type="button" disabled={!free} onClick={() => onPick(free)} style={{ padding: "6px 12px", borderRadius: 10, border: "none", cursor: free ? "pointer" : "default",
          font: "inherit", background: free ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--surface2)", color: free ? "#fff" : "var(--muted)", fontWeight: 900 }}>OK</button>
      </div>
    </div>
  </PlanPopup>;
}

const pill = { padding: "6px 12px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", fontSize: 12,
  fontWeight: 800, cursor: "pointer" };
