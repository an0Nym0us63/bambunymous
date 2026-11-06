import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client, { apiUrl, apiThumb } from "../api/client";
import { egg } from "../eggs";
import { showAlert } from "../utils/dialog";
import { toast } from "../store/toast";
import { useCanMw } from "../store/auth";
import { dayEnd, DayStrip, onDay, NowNextTiles, PlateThumb, unretained, hhmm, endDrift, plateTxt, swapTxt, swapLong, runoutTxt, bedTxt, BED_NAMES, SwapLinks, FilLink, finIc, SwapShort, setFilColors } from "./PlanDay";
import { JobSheet, LowStockBanner, BlockedList } from "./PlanPanels";
import { sheetRef } from "./planActs";
import MakerWorldModelSheet from "./MakerWorldModelSheet";

// Le planning sur l'accueil (05/11/2026, revu) : la tuile (la journee en frise, l'etat, l'impression en cours, un
// agenda des prochains plateaux, les alertes) et sa vue en grand (en cours, prochaines, les 3 prochains jours, les
// alertes ; un plateau touche ouvre ses actions sans quitter l'accueil). HomeTiles lui passe son cadre (Tile).

const C = "#6366F1";
const STATE = { due: ["⏰", "#6366F1", "À lancer"], late: ["🐢", "#F97316", "En retard"], ahead: ["🚀", "#16A34A", "En avance"], ontime: ["✅", "#16A34A", "Dans les temps"] };
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayLabel = (d, now) => {
  const today = (now || "").slice(0, 10), t = new Date(`${today}T12:00`); t.setDate(t.getDate() + 1);
  return d === today ? "Aujourd'hui" : d === isoDay(t) ? "Demain" : new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" });
};
const dur = m => { m = Math.max(0, Math.round(m)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
const liveOf = p => p?.live && p?.busy_until ? { now: p.now, end: p.busy_until, name: p.live.name, planned: p.live.planned_end } : null;

// la carte de l'impression en cours : vignette, nom, avancement, fin estimee et ecart avec la fin prevue
function LiveCard({ p, compact }) {
  const l = p.live;
  let pct = null;
  if (l?.start && p.busy_until) { const a = new Date(l.start), b = new Date(p.busy_until), n = new Date(p.now); if (b > a) pct = Math.max(0, Math.min(1, (n - a) / (b - a))); }
  const dr = endDrift(l?.planned_end, p.busy_until);
  return <div style={{ display: "flex", gap: 8, alignItems: "center", padding: compact ? 6 : 8, borderRadius: 12, minWidth: 0,
    background: "linear-gradient(135deg, color-mix(in srgb, #3B82F6 22%, transparent), color-mix(in srgb, #3B82F6 6%, transparent) 70%), var(--surface2)",
    border: "1px solid color-mix(in srgb, #3B82F6 35%, var(--border))" }}>
    {l.print_id ? <img src={apiThumb(apiUrl(`/prints/${l.print_id}/image`), 96)} alt="" style={{ width: compact ? 34 : 44, height: compact ? 34 : 44, borderRadius: 9,
      objectFit: "cover", flexShrink: 0, background: "var(--surface)" }} onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>
      : <span style={{ fontSize: 20 }}>⏳</span>}
    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 12, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.title || l.name}</span>
      {pct != null && <span style={{ height: 5, borderRadius: 4, background: "color-mix(in srgb, #3B82F6 18%, var(--surface))", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${pct * 100}%`, background: "linear-gradient(90deg, #3B82F6, #60A5FA)" }}/></span>}
      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden" }}>
        {pct != null && <span style={{ color: "#2563EB" }}>{Math.round(pct * 100)} %</span>}
        <span>fin <b style={{ color: "var(--text)" }}>{hhmm(p.busy_until)}</b></span>
        {dr && <span data-tip={`Prévue au lancement : ${hhmm(l.planned_end)}`} style={{ fontWeight: 900, color: dr.c, background: `color-mix(in srgb, ${dr.c} 14%, transparent)`,
          borderRadius: 6, padding: "0 5px" }}>{dr.txt}</span>}
      </span>
    </span>
  </div>;
}

// l'agenda : les plateaux, regroupes par jour, l'heure en colonne, un trait et des points
function Agenda({ jobs, now, max, onOpen }) {
  const rows = [];
  let last = null;
  for (const j of jobs.slice(0, max)) {
    if (j.day !== last) { rows.push({ head: j.day }); last = j.day; }
    rows.push({ j });
  }
  return <div style={{ display: "flex", flexDirection: "column" }}>
    {rows.map((r, i) => r.head ? <div key={`h${r.head}`} style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: ".05em", textTransform: "uppercase", color: C,
      margin: i ? "6px 0 3px" : "0 0 3px" }}>{dayLabel(r.head, now)}</div>
      : <div key={r.j.key} onClick={onOpen ? e => { e.stopPropagation(); onOpen(r.j); } : undefined}
        style={{ display: "grid", gridTemplateColumns: "42px 12px minmax(0, 1fr)", alignItems: "center", gap: 6, minHeight: 34, cursor: onOpen ? "pointer" : "inherit",
          opacity: unretained(r.j) ? 0.72 : 1 }}>
        <span style={{ textAlign: "right", fontSize: 11.5, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" }}>{hhmm(r.j.start)}</span>
        <span style={{ position: "relative", alignSelf: "stretch", display: "flex", justifyContent: "center" }}>
          <span style={{ position: "absolute", top: 0, bottom: 0, width: 2, background: "color-mix(in srgb, #6366F1 22%, var(--border))" }}/>
          <span style={{ position: "relative", marginTop: 13, width: 9, height: 9, borderRadius: "50%", boxSizing: "border-box",
            background: r.j.locked ? "#4F46E5" : r.j.completes ? "#059669" : "var(--surface)",
            border: `2px solid ${r.j.locked ? "#4F46E5" : r.j.completes ? "#059669" : unretained(r.j) ? "#94A3B8" : "#22C55E"}` }}/>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <PlateThumb j={r.j} size={26}/>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.j.locked ? "🔒 " : ""}{finIc(r.j, " ")}{unretained(r.j) ? "○ " : ""}{r.j.title}</span>
            <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              → {hhmm(r.j.end)} · {plateTxt(r.j)}{r.j.bed_change ? <span style={{ color: "#0369A1" }}> · 🔲 {BED_NAMES[r.j.bed_change.to] || r.j.bed_change.to}</span> : ""}{r.j.load?.length ? <span style={{ color: "#EA580C" }}> · 🧵 <SwapShort j={r.j}/></span> : ""}{r.j.runout?.length ? <span style={{ color: "#B45309" }}> · 🔄</span> : ""}
              {r.j.low_info?.length ? <span style={{ color: "#DC2626" }}> · 📉</span> : ""}</span>
          </span>
        </span>
      </div>)}
  </div>;
}

// les pastilles d'attention, avec leur mot
function AlertChips({ p, big }) {
  const jobs = p.jobs || [];
  const low = jobs.reduce((a, j) => a + (j.low_info?.length || 0), 0), locked = jobs.filter(j => j.locked).length;
  const lateDl = (p.deadlines || []).filter(x => !x.ok).length, blocked = (p.blocked || []).length, adv = (p.advice || []).length;
  const chip = (n, ic, word, c) => n > 0 && <span key={word} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: big ? 12 : 10.5, fontWeight: 900, color: c,
    background: `color-mix(in srgb, ${c} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 30%, transparent)`, borderRadius: 8, padding: big ? "2px 8px" : "1px 6px",
    whiteSpace: "nowrap" }}>{ic} {n}{big ? ` ${word}` : ""}</span>;
  return <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
    {chip(lateDl, "🎯", "date limite", "#EF4444")}
    {chip(blocked, "⛔", "non planifiable", "#DC2626")}
    {chip(low, "📉", "sous le seuil", "#DC2626")}
    {chip(adv, "💡", "conseil", "#D97706")}
    {chip(locked, "🔒", "figé", "#4F46E5")}
  </div>;
}

// l'en-tete : l'etat en couleur, et dans combien de temps le prochain
// la synthese du prochain plateau (06/11/2026) : lequel, quand, combien de temps, et ce qu'il faudra faire avant (bobines,
// plateau d'impression, regroupement), puis sa fiche sur le profil a lancer (d'ou l'ouvrir dans Bambu Studio)
function NextUp({ p, onSheet }) {
  const j = p.jobs[0], mins = (new Date(j.start) - new Date(p.now)) / 60000;
  const todo = [
    j.load?.length > 0 && ["🧵", "#EA580C", <SwapLinks j={j}/>],
    j.bed_change && ["🔲", "#0369A1", bedTxt(j.bed_change).replace(/^🔲 /, "")],
    j.merged && ["🧩", "#6366F1", "Regrouper ses plateaux dans Bambu Studio avant de lancer"],
    ...(j.runout || []).map(r => ["🔄", "#B45309", runoutTxt(r).replace(/^🔄 /, "") + " : prépare une autre bobine"]),
    j.awaits_order?.length > 0 && ["📬", "#0EA5E9", `Attend une commande : ${j.awaits_order.join(", ")}`],
  ].filter(Boolean);
  return <div style={{ borderRadius: 14, padding: 10, display: "flex", flexDirection: "column", gap: 7,
    border: `1px solid color-mix(in srgb, ${C} 35%, var(--border))`, background: `linear-gradient(140deg, color-mix(in srgb, ${C} 10%, transparent), transparent 75%), var(--surface)` }}>
    <div style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0 }}>
      <PlateThumb j={j} size={46}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".05em", textTransform: "uppercase", color: C }}>
          ⏭ Prochain · {mins <= 1 ? "maintenant" : `${dayLabel(j.day, p.now).toLowerCase()} à ${hhmm(j.start)} (dans ${dur(mins)})`}</div>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.title}</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{[j.plates_total > 1 ? plateTxt(j) : null, dur(j.seconds / 60)].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {todo.length ? todo.map(([ic, c, t], i) => <div key={i} style={{ display: "flex", gap: 7, alignItems: "baseline", fontSize: 12.5, fontWeight: 700, color: "var(--text2)", lineHeight: 1.4 }}>
        <span style={{ flexShrink: 0 }}>{ic}</span><span style={{ color: c, minWidth: 0 }}>{t}</span></div>)
        : <div style={{ fontSize: 12.5, fontWeight: 700, color: "#16A34A" }}>✓ Rien à préparer : les bobines et le plateau sont en place</div>}
    </div>
    <button type="button" onClick={() => onSheet(j)} style={{ alignSelf: "flex-start", padding: "6px 12px", borderRadius: 11, cursor: "pointer",
      border: `1px solid color-mix(in srgb, ${C} 40%, var(--border))`, background: `color-mix(in srgb, ${C} 10%, var(--surface))`, color: "#4F46E5",
      fontSize: 12.5, fontWeight: 900 }}>🧾 Sa fiche, sur le profil à lancer</button>
  </div>;
}

function StateHead({ p }) {
  const st = p.status, [ic, c, word] = STATE[st?.state] || ["📅", "#64748B", "Planning"];
  const next = (p.jobs || [])[0];
  const mins = next ? (new Date(next.start) - new Date(p.now)) / 60000 : null;
  const end = dayEnd(p);
  return <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 9px", borderRadius: 11, minWidth: 0,
    background: `linear-gradient(135deg, color-mix(in srgb, ${c} 18%, transparent), transparent 80%)`, border: `1px solid color-mix(in srgb, ${c} 30%, var(--border))` }}>
    <span style={{ fontSize: 14 }}>{ic}</span>
    <span style={{ fontSize: 12, fontWeight: 900, color: c, whiteSpace: "nowrap" }}>{word}{st?.state === "late" && st.late_min ? ` · ${dur(st.late_min)}` : ""}</span>
    {next && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap" }}>
      {mins <= 1 ? "prochain : maintenant" : <>prochain dans <b style={{ color: "var(--text)" }}>{dur(mins)}</b></>}</span>}
    {/* la fin de la journee (06/11/2026), a cote du prochain */}
    {end && <span data-tip={end.txt} style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap" }}>
      · 🌙 <b style={{ color: "var(--text)" }}>{hhmm(end.end)}</b> · {end.n} plat.</span>}
  </div>;
}

// la tuile : HomeTiles fournit le cadre (Tile) ; ici le contenu, petit et en grand
export function planTileBody(p, { W, H }) {
  if (!p) return null;
  const today = (p.now || "").slice(0, 10);
  const live = liveOf(p);
  const showStrip = H >= 150, showLive = !!p.live && H >= 120;
  const used = 34 + (showStrip ? 40 : 0) + (showLive ? 58 : 0) + 26;
  const max = Math.max(1, Math.floor((H - used) / 36));
  return <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 6, overflow: "hidden" }}>
    <StateHead p={p}/>
    {showStrip && <DayStrip day={today} done={p.today_items || []} jobs={(p.jobs || []).filter(j => onDay(j, today))} settings={p.settings} now={p.now} live={live}/>}
    {showLive && <LiveCard p={p} compact={W < 260}/>}
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {(p.jobs || []).length ? <Agenda jobs={p.jobs} now={p.now} max={max}/> : <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>Rien de prévu</span>}
    </div>
    <AlertChips p={p}/>
  </div>;
}

export function PlanZoom({ p: p0 }) {
  const nav = useNavigate();
  const [p, setP] = useState(p0);
  const [sel, setSel] = useState(null);
  const [sheet, setSheet] = useState(null);
  const edit = useCanMw();                            // ranger : droit MakerWorld, jamais chez un copain
  useEffect(() => { setP(p0); }, [p0]);
  if (!p) return null;
  const send = async (url, body, method = "post") => {
    try { const r = await client[method](url, body); setP(x => ({ ...r.data, today_items: x?.today_items })); return r.data; }
    catch (e) { showAlert(e.response?.data?.detail || e.message); return null; }
  };
  const act = j => ({
    smart: () => send("/makerworld/plan/smart", { key: j.key }).then(d => d && egg("planning_glisse")),
    later: () => send("/makerworld/plan/later", { key: j.key }).then(d => d && egg("planning_glisse")),
    laterAll: () => send("/makerworld/plan/later", { key: j.key, whole: true }).then(d => d && egg("planning_glisse")),
    chain: mode => send("/makerworld/plan/chain", { design_id: j.design_id, mode }).then(d => d && mode && egg("planning_traite")),
    dayBest: v => send("/makerworld/plan/place-day", { key: j.key, day: v }).then(d => d && egg("planning_glisse")),
    day: v => send("/makerworld/plan/place-day", { key: j.key, day: v }),
    unpin: () => send("/makerworld/plan/arrange", { pins: { [j.key]: null } }, "put"),
    pinDay: () => send("/makerworld/plan/arrange", { pins: { [j.key]: j.day } }, "put"),
    slot: (day, after) => {
      const ks = (p.jobs || []).map(x => x.key).filter(x => x !== j.key);
      const firstOfDay = (p.jobs || []).filter(x => x.day === day && x.key !== j.key).sort((a, b) => a.start.localeCompare(b.start))[0];
      const at = after ? ks.indexOf(after) + 1 : firstOfDay ? ks.indexOf(firstOfDay.key) : ks.length;
      ks.splice(Math.max(0, at), 0, j.key);
      return send("/makerworld/plan/arrange", { order: ks, pins: { [j.key]: day } }, "put");
    },
    sheet: () => setSheet(sheetRef(j)),
    dayview: () => nav("/prints?tab=calendar"),
    due: v => send(`/makerworld/plan/deadline/${j.design_id}`, { due: v }, "put").then(d => { if (d && v) { egg("planning_echeance"); toast("🎯 Date limite posée", "ok", 3000); } }),
    done: () => send("/makerworld/plan/done", { key: j.key }),
    lock: () => send("/makerworld/plan/lock", { key: j.key, lock: true }).then(d => d && egg("planning_fige")),
    unlock: () => send("/makerworld/plan/lock", { key: j.key, lock: false }),
  });
  const live = liveOf(p);
  setFilColors(p.fcolors);
  const days = [...new Set((p.jobs || []).map(j => j.day))].slice(0, 3);
  const sec = t => <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: C, margin: "4px 0 2px" }}>{t}</div>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <StateHead p={p}/>
    {/* l'etat dit autre chose que son mot (un retard, une avance) : la phrase ; « Dans les temps » ne se repete plus */}
    {p.status?.text && p.status.state !== "ontime" && <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginTop: -4 }}>{p.status.text}</div>}
    {(p.jobs || [])[0] && <NextUp p={p} onSheet={j => setSheet(sheetRef(j))}/>}
    <DayStrip day={(p.now || "").slice(0, 10)} done={p.today_items || []} jobs={(p.jobs || []).filter(j => onDay(j, (p.now || "").slice(0, 10)))} settings={p.settings} now={p.now} live={live}/>
    <NowNextTiles pd={p} wide onOpenPrint={it => nav(`/prints?id=${it.id}`)} onPickJob={setSel}/>
    <AlertChips p={p} big/>
    {/* le prochain changement de bobine (06/11/2026) : quand, pour quoi, quoi charger a la place de quoi ; et une bobine
        qui se videra en route */}
    {(() => { const j = (p.jobs || []).find(x => x.load?.length), ro = (p.jobs || []).find(x => x.runout?.length), bj = (p.jobs || []).find(x => x.bed_change);
      if (!j && !ro && !bj) return null;
      const line = (ic, c, head, txt, x) => <div onClick={() => setSel(x)} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "9px 11px", borderRadius: 12,
        cursor: "pointer", border: `1px solid color-mix(in srgb, ${c} 35%, var(--border))`, background: `color-mix(in srgb, ${c} 8%, var(--surface))` }}>
        <span style={{ fontSize: 17 }}>{ic}</span>
        <span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 12.5, fontWeight: 900, color: c }}>{head}</span>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text2)", lineHeight: 1.4 }}>{txt}</span></span></div>;
      return <>{sec(bj && !j ? "Prochain changement de plateau" : "Prochain changement")}
        {bj && line("🔲", "#0369A1", `${dayLabel(bj.day, p.now)} à ${hhmm(bj.start)}`, <>Pour {bj.title}{bj.plates_total > 1 ? ` · ${plateTxt(bj)}` : ""} : {bedTxt(bj.bed_change).replace(/^🔲 Mets/, "mets")}.</>, bj)}
        {j && line("🧵", "#EA580C", `${dayLabel(j.day, p.now)} à ${hhmm(j.start)}`, <>Pour {j.title}{j.plates_total > 1 ? ` · ${plateTxt(j)}` : ""} : <SwapLinks j={j}/>.</>, j)}
        {ro && line("🔄", "#B45309", `${dayLabel(ro.runout[0].at.slice(0, 10), p.now)} vers ${hhmm(ro.runout[0].at)}`, <>Pendant {ro.title} : <FilLink id={ro.runout[0].id} label={ro.runout[0].name}/>{runoutTxt(ro.runout[0]).slice(3 + ro.runout[0].name.length)}. Prépare une autre bobine.</>, ro)}
      </>; })()}
    {sec("Les prochains jours")}
    {days.map(d => <div key={d} style={{ borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface2)", padding: 9, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 900, color: "var(--text)", textTransform: "capitalize" }}>{dayLabel(d, p.now)}</span>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: "#16A34A" }}>{dur((p.jobs || []).filter(j => j.day === d).reduce((a, j) => a + j.seconds, 0) / 60)} prévues</span>
      </div>
      <DayStrip day={d} done={d === (p.now || "").slice(0, 10) ? p.today_items || [] : []} jobs={(p.jobs || []).filter(j => onDay(j, d))} settings={p.settings} now={p.now} live={live}/>
      <Agenda jobs={(p.jobs || []).filter(j => j.day === d)} now={p.now} max={40} onOpen={setSel}/>
    </div>)}
    {(p.jobs || []).some(j => j.low_info?.length) && <>{sec("Sous le seuil")}<LowStockBanner jobs={p.jobs} now={p.now} inPopup onOpen={setSel}/></>}
    {(p.blocked || []).length > 0 && <>{sec("Non planifiables")}<BlockedList items={p.blocked} onOpen={setSel}/></>}
    <button type="button" onClick={() => nav("/prints?tab=calendar")} style={{ alignSelf: "flex-start", padding: "9px 16px", borderRadius: 12, border: "none", cursor: "pointer",
      background: `linear-gradient(135deg, ${C}, #8B5CF6)`, color: "#fff", fontSize: 13, fontWeight: 900, boxShadow: `0 8px 18px -10px ${C}` }}>📅 Ouvrir le calendrier</button>
    {sel && <JobSheet j={sel} now={p.now} edit={edit} onClose={() => setSel(null)} act={act(sel)} jobs={p.jobs}/>}
    {sheet && <MakerWorldModelSheet designId={String(sheet)} onClose={() => setSheet(null)}/>}
  </div>;
}
