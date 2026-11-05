import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import client, { apiUrl, apiThumb } from "../api/client";
import { egg } from "../eggs";
import { showAlert } from "../utils/dialog";
import { useCanMw } from "../store/auth";
import MakerWorldModelSheet from "./MakerWorldModelSheet";
import MwImg from "./MwImg";
import { DayStrip, JobCard, PlanSettings, PlanAdvice, PlanDeadlines, ColorDay, ManualDone, PlateThumb, jobName, dueTxt, doneTxt, plateTxt } from "./PlanDay";

// Le calendrier des impressions (04/11/2026) : le mois, chaque jour avec l'etagere de ses impressions (une vignette
// chacune, liseree de son etat) posee sur la barre de ses heures machine (une impression qui
// passe minuit compte sur les deux jours, comme les stats), ses impressions et leur etat ; la charge de chaque
// semaine ; et, sur les jours a venir, la file « A faire » si elle s'enchainait sans pause, apres l'impression en cours.
const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ST = { SUCCESS: ["#22C55E", "réussie"], FAILED: ["#EF4444", "échouée"], CANCELLED: ["#94A3B8", "annulée"], PARTIAL: ["#F59E0B", "partielle"],
  IN_PROGRESS: ["#3B82F6", "en cours"] };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// les impressions d'un jour, une fois chacune (une impression sur deux jours n'y est qu'une fois par jour)
const shelf0 = x => [...new Map((x?.items || []).map(i => [i.id, i])).values()];
const hm = s => { const m = Math.round((s || 0) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
// l'etat du planning : a lancer, en retard, en avance, dans les temps
function PlanStatus({ st, live }) {
  const c = { due: "#6366F1", late: "#F97316", ahead: "#22C55E", ontime: "#22C55E", deadline: "#EF4444" }[st.state] || "#64748B";
  const ic = { due: "⏰", late: "🐢", ahead: "🚀", ontime: "✅", deadline: "🎯" }[st.state] || "📅";
  return <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", borderRadius: 14, border: `1px solid color-mix(in srgb, ${c} 40%, var(--border))`,
    background: `color-mix(in srgb, ${c} 9%, var(--surface))` }}>
    <span style={{ fontSize: 17 }}>{ic}</span>
    <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "var(--text2)" }}>{st.text}
      {live && <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>En cours : {live.name} · encore {hm(live.remaining_min * 60)}</span>}</span>
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

export default function PrintCalendar() {
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
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [days, setDays] = useState(null);       // {date: {count, duration, items}}
  // le planning (05/11/2026) : « A faire » plateau par plateau, pose par le serveur selon les consignes
  const [pd, setPd] = useState(null);
  const [showPlan, setShowPlan] = useState(true);
  const [setOpen, setSetOpen] = useState(false);
  const [sheet, setSheet] = useState(null);           // la fiche d'un modele : profil, plateaux, filaments retenus
  const [dragging, setDragging] = useState(null);
  const [dropDay, setDropDay] = useState(null);
  const edit = useCanMw();                            // ranger : droit MakerWorld, jamais chez un copain
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
  // ranger : l'ordre voulu et les jours poses partent au serveur, qui repose tout et rend le planning
  const keys = (pd?.jobs || []).map(j => j.key);
  const byKey = Object.fromEntries((pd?.jobs || []).map(j => [j.key, j]));
  const send = async (url, body, method = "put") => {
    try { const r = await client[method](url, body); setPd(r.data); return true; }
    catch (e) { showAlert(e.response?.data?.detail || e.message); return false; }
  };
  const arrange = (body, what = "planning_glisse") => send("/makerworld/plan/arrange", body).then(ok => { if (ok) egg(what); });
  const without = k => keys.filter(x => x !== k);
  const moveBefore = (k, ref) => {
    const o = without(k); o.splice(Math.max(0, o.indexOf(ref)), 0, k);
    const a = byKey[k], b = byKey[ref];
    arrange({ order: o, ...(a && b && a.day !== b.day ? { pins: { [k]: b.day } } : {}) });
  };
  const moveAfter = (k, ref) => { const o = without(k); o.splice(o.indexOf(ref) + 1, 0, k); arrange({ order: o }); };
  // poser sur un jour : le travail y va, apres ce qui y est deja
  const moveDay = (k, day) => {
    const o = without(k);
    let at = 0;
    o.forEach((x, i) => { if (byKey[x]?.day <= day) at = i + 1; });
    o.splice(at, 0, k);
    arrange({ order: o, pins: { [k]: day } });
  };
  const unpin = k => arrange({ pins: { [k]: null } });
  // un objet en tete de file (pour tenir sa date limite)
  const toFront = ks => arrange({ order: [...ks, ...keys.filter(k => !ks.includes(k))] });
  const applyAdvice = a => a.kind === "front" ? toFront(a.keys) : a.kind === "after" ? moveAfter(a.key, a.ref) : moveBefore(a.key, a.ref);
  const setDue = (did, due) => send(`/makerworld/plan/deadline/${did}`, { due }).then(ok => { if (ok && due) egg("planning_echeance"); });
  const markDone = (key, undo = false) => send("/makerworld/plan/done", { key, undo }, "post");
  const colorDay = (day, fid) => send("/makerworld/plan/color-day", { day, filament_id: fid }, "post").then(ok => { if (ok) egg("planning_couleur"); });
  const optimize = day => send("/makerworld/plan/optimize", day ? { day } : {}, "post").then(ok => { if (ok) egg("planning_optimise"); });
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
  const go = n => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const chip = (label, value, color) => <div style={{ flex: "1 1 120px", minWidth: 0, padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)",
    background: `linear-gradient(150deg, color-mix(in srgb, ${color} 14%, transparent), transparent 70%), var(--surface2)` }}>
    <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)" }}>{value}</div></div>;
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
            {/* un objet s'y termine : une pastille doree, lisible */}
            {finished.length > 0 && <span data-tip={finished.map(j => `${doneTxt(j)} : ${j.title}`).join(" · ")}
              style={{ position: "absolute", top: wide ? 3 : 2, right: wide ? 4 : 2, zIndex: 2, display: "inline-flex", alignItems: "center", gap: 2,
                padding: wide ? "1px 6px" : "0 4px", borderRadius: 9, background: "#FACC15", color: "#713F12", fontSize: wide ? 10.5 : 9, fontWeight: 900,
                boxShadow: "0 1px 3px rgba(0,0,0,.25)" }}>🏁{finished.length > 1 || wide ? ` ${finished.length}` : ""}</span>}
            {wide && p.length > 0 && !finished.length && cellW >= 74 && <span style={{ position: "absolute", top: 5, right: 6, fontSize: 9.5, fontWeight: 900,
              color: "#16A34A" }}>{hm((pd?.days?.[k]?.seconds) || 0)}</span>}
            {wide && !p.length && x?.duration > 0 && cellW >= 74 && <span style={{ position: "absolute", top: 5, right: 6, fontSize: 9.5, fontWeight: 800, color: "var(--text2)" }}>{hm(x.duration)}</span>}
            {/* un jour avec du prevu : la mosaique, ce qui est fait d'abord (liseré de son etat), puis les plateaux prevus
                (pointilles verts ; dores quand ils terminent un objet) */}
            {mos && <span style={{ position: "absolute", left: wide ? 5 : 3, right: wide ? 5 : 3, top, bottom: wide ? 7 : 5, display: "flex", flexWrap: "wrap",
              alignContent: "flex-end", gap: 3, overflow: "hidden" }}>
              {[...shelf.map(it => ({ done: it })), ...p.map(j => ({ j }))].slice(0, mos.shown).map(({ done, j }, i) => {
                const c = done ? (ST[done.status] || ST.SUCCESS)[0] : j.completes ? "#EAB308" : j.too_long ? "#EF4444" : "#22C55E";
                const img = done ? apiThumb(apiUrl(`/prints/${done.id}/image`), 96) : null;
                return <span key={done ? `d${done.id}` : j.key} style={{ width: mos.size, height: mos.size, flexShrink: 0, borderRadius: wide ? 7 : 4, overflow: "hidden",
                  boxSizing: "border-box", background: "#fff", position: "relative",
                  border: done ? `2px solid ${c}` : `${j.completes ? 2 : 1.5}px ${j.completes ? "solid" : "dashed"} ${c}` }}>
                  {done ? <img src={img} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                    : j.thumb ? <MwImg src={j.thumb} w={Math.max(64, mos.size * 2)} style={{ width: "100%", height: "100%", objectFit: "contain" }}/>
                    : j.cover ? <img src={apiThumb(j.cover, 96)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}/> : null}
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
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ padding: "0 5px", borderRadius: 8, background: "#FACC15", color: "#713F12", fontWeight: 900 }}>🏁</span>objet terminé</span>
      <span>· le remplissage : les heures machine du jour</span>
    </div>
  </div>;
  const detail = <div ref={detailRef} style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", padding: 12, display: "flex", flexDirection: "column", gap: 8,
    scrollMarginTop: 70, minWidth: 0 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 15, fontWeight: 900, color: "var(--text)", textTransform: "capitalize" }}>
        {new Date(`${pick}T12:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
      {sel?.duration > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{hm(sel.duration)} de machine</span>}
    </div>
    {!sel?.items?.length && !selPlan.length && pick < today && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
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
    {pick >= today && <DayStrip day={pick} done={sel?.items || []} jobs={selPlan} settings={pd?.settings} now={pd?.now}/>}
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
        onDay={day => moveDay(j.key, day)} onUnpin={() => unpin(j.key)} onOpen={() => setSheet(j.design_id)} onDue={due => setDue(j.design_id, due)} onDone={() => markDone(j.key)}/>)}
    </>}
    {pick >= today && !selPlan.length && pd && <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
        {edit ? "Rien de prévu : glisse ici un plateau de la file (sous le calendrier), pose-le avec son 📅, ou fais-en une journée couleur." : "Rien de prévu ce jour-là."}</span>
      {edit && <ColorDay colors={pd?.colors} onPick={fid => colorDay(pick, fid)}/>}</div>}
  </div>;
  const advice = showPlan ? <>
    <PlanDeadlines items={pd?.deadlines} edit={edit} onDue={setDue}/>
    <PlanAdvice items={pd?.advice} edit={edit} onApply={applyAdvice}/>
    <ManualDone items={pd?.manual_done} edit={edit} onUndo={k => markDone(`${k}:0`, true)}/></> : null;
  // la file : chaque impression prevue, dans l'ordre, a glisser sur un jour du calendrier
  const pool = showPlan && pd?.jobs?.length ? <div style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", padding: 10 }}>
    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#22C55E", marginBottom: 7 }}>
      La file · {pd.jobs.length} plateau{pd.jobs.length > 1 ? "x" : ""}{edit && wide ? " · glisse-les sur un jour" : ""}</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {pd.jobs.slice(0, 60).map(j => <button key={j.key} type="button" draggable={edit}
        onDragStart={e => { e.dataTransfer.setData("text/bn-job", j.key); setDragging(j.key); }} onDragEnd={() => setDragging(null)}
        onClick={() => pickDay(j.day)} data-tip={`${jobName(j)} · ${hm(j.seconds)}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, width: 240, maxWidth: "100%", padding: "4px 8px 4px 4px", borderRadius: 11, cursor: edit ? "grab" : "pointer",
          border: `1.5px ${j.completes ? "solid" : "dashed"} ${j.too_long ? "#EF4444" : j.completes ? "#EAB308" : "color-mix(in srgb, #22C55E 45%, var(--border))"}`,
          background: "var(--surface2)", opacity: dragging === j.key ? 0.4 : 1 }}>
        <PlateThumb j={j} size={34}/>
        <span style={{ minWidth: 0, textAlign: "left" }}>
          <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {j.completes ? "🏁 " : ""}{j.title}</span>
          <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#6366F1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {plateTxt(j)}{j.qty > 1 ? ` · ${j.copy}/${j.qty}` : ""}</span>
          <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: j.load?.length ? "#F97316" : "var(--muted)" }}>
            {new Date(`${j.day}T12:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} {j.start.slice(11, 16)} · {hm(j.seconds)}{j.load?.length ? " · 🧵" : ""}
            {j.due && <span style={{ color: j.due_ok ? "#16A34A" : "#EF4444", fontWeight: 900 }}> · 🎯 {dueTxt(j.due)}</span>}</span>
        </span>
      </button>)}
    </div>
  </div> : null;
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
        {showPlan ? "✓ " : ""}Planning{showPlan && nPlanned ? ` (${nPlanned})` : ""}</button>
      <button type="button" onClick={() => setSetOpen(v => !v)} data-tip="Pause entre deux impressions, heures de fonctionnement et de lancement"
        style={{ ...pill, ...(setOpen ? { color: "#6366F1" } : {}) }}>⚙ Consignes</button>
      {edit && nPlanned > 1 && <button type="button" onClick={() => optimize(null)}
        data-tip="Enchaîner les plateaux de mêmes couleurs dans toute la file (les impressions posées sur un jour ne bougent pas)"
        style={{ ...pill, color: "#6366F1" }}>✨ Optimiser la file</button>}
    </div>
    {pd?.status && showPlan && <PlanStatus st={pd.status} live={pd.live}/>}
    {showPlan && (pd?.deadlines || []).filter(x => !x.ok).map(x => <PlanStatus key={x.design_id}
      st={{ state: "deadline", text: `${x.title} ne sera pas fini avant le ${dueTxt(x.due)} : voir les conseils` }}/>)}
    {setOpen && <PlanSettings s={pd?.settings} onSave={saveSettings} onClose={() => setSetOpen(false)}/>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {chip("Impressions", days ? mCount : "…", "#3B82F6")}
      {chip("Heures machine", days ? hm(mTotal) : "…", "#8B5CF6")}
      {chip("Occupation", days ? `${Math.round(occ * 100)} %` : "…", "#EC4899")}
      {chip("Jours actifs", days ? `${mActive} / ${monthDays.length}` : "…", "#22C55E")}
    </div>
    {side ? <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 12, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>{calendar}{pool}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "sticky", top: 12, maxHeight: "calc(100dvh - 40px)", overflowY: "auto" }}>{detail}{advice}</div>
    </div> : <>{calendar}{advice}{detail}{pool}</>}
    {sheet && <MakerWorldModelSheet designId={String(sheet)} onClose={() => { setSheet(null);
      client.get("/makerworld/plan", { params: { tz: -new Date().getTimezoneOffset() } }).then(r => setPd(r.data)).catch(() => {}); }}/>}
  </div>;
}

const navBtn = { width: 38, height: 38, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center" };
const pill = { padding: "6px 12px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", fontSize: 12,
  fontWeight: 800, cursor: "pointer" };
