import React, { useEffect, useState } from "react";
import CardHelp from "./CardHelp";
import client from "../api/client";

// Parametres > Taches (27/10/2026) : les taches de fond du serveur (ce qui tourne, quand ca repasse, la derniere
// erreur) et les longs travaux lances a la demande, avec leur avancement. Relu toutes les 3 s ; les comptes a
// rebours avancent chaque seconde entre deux lectures.
const STATE = {
  running:  ["En cours", "#0EA5E9", "#6366F1"],
  waiting:  ["En attente", "#22C55E", "#16A34A"],
  starting: ["Démarrage", "#F59E0B", "#F97316"],
  done:     ["Terminée", "#64748B", "#94A3B8"],
  stopped:  ["Arrêtée", "#EF4444", "#DC2626"],
  unknown:  ["Pas lancée", "#94A3B8", "#CBD5E1"],
  connected: ["Connectée", "#22C55E", "#16A34A"],
  offline:  ["Déconnectée", "#F59E0B", "#EF4444"],
  off:      ["Pas configurée", "#94A3B8", "#CBD5E1"],
  planned:  ["Programmée", "#8B5CF6", "#6366F1"],
  disabled: ["Désactivée", "#94A3B8", "#CBD5E1"],
};
const when = ts => new Date(ts * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const isoTs = v => (v ? Date.parse(v) / 1000 : null);
const FAMILY_ICON = { Impressions: "🖨️", MakerWorld: "🌐", Notifications: "🔔", "Succès": "🏆", Serveur: "🖥️" };

function dur(s) {
  if (s < 1) return "< 1 s";
  s = Math.round(s);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 && s < 600 ? ` ${s % 60} s` : ""}`;
  if (s < 86400) return `${Math.floor(s / 3600)} h${Math.floor(s % 3600 / 60) ? ` ${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}` : ""}`;
  return `${Math.floor(s / 86400)} j ${Math.floor(s % 86400 / 3600)} h`;
}

function Chip({ state }) {
  const [label, c1, c2] = STATE[state] || STATE.unknown;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 800,
    color: "#fff", background: `linear-gradient(135deg, ${c1}, ${c2})`, flexShrink: 0 }}>
    {state === "running" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "bnTaskPulse 1s ease-in-out infinite" }}/>}
    {label}</span>;
}

export default function TasksPanel() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [skew, setSkew] = useState(0);              // heure du serveur - heure du navigateur
  const [, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => client.get("/settings/tasks", { params: { t: Date.now() } })
      .then(({ data }) => { if (alive) { setD(data); setErr(null); setSkew(data.now - Date.now() / 1000); } })
      .catch(e => alive && setErr(e?.response?.data?.detail || e.message));
    load();
    const a = setInterval(load, 3000), b = setInterval(() => setTick(x => x + 1), 1000);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, []);
  const now = Date.now() / 1000 + skew;
  if (err) return <div className="card" style={{ padding: 16, color: "#ef4444", fontWeight: 700 }}>Tâches illisibles : {err}</div>;
  if (!d) return <div className="card" style={{ padding: 16, color: "var(--muted)" }}>Lecture des tâches…</div>;
  const families = [...new Set(d.loops.map(l => l.family))];
  const bad = d.loops.filter(l => l.state === "stopped" || l.state === "offline").length;
  const busy = d.loops.filter(l => l.state === "running").length + d.jobs.filter(j => j.running).length;
  const errs = d.loops.filter(l => l.error).length;
  return <div className="wide-flow">
    <style>{"@keyframes bnTaskPulse { 50% { opacity: .35; } }"}</style>
    <div className="card" style={{ padding: "16px 20px" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 900, background: "linear-gradient(135deg, #0EA5E9, #6366F1)",
        WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Tâches du serveur</h3>
      <CardHelp title="Tâches du serveur">
        Ce que le serveur fait en fond : chaque tâche dit si elle travaille ou attend son prochain passage, quand elle est
        passée pour la dernière fois et sa dernière erreur. Les compteurs repartent à zéro à chaque redémarrage.</CardHelp>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[[busy, "en cours", "#0EA5E9"], [d.loops.length - bad, "tâches actives", "#22C55E"], [errs, "avec une erreur", errs ? "#F59E0B" : "#22C55E"],
          [bad, "arrêtées ou déconnectées", bad ? "#EF4444" : "#22C55E"]].map(([n, l, c]) => (
          <span key={l} style={{ flex: "1 1 120px", padding: "7px 10px", borderRadius: 12, background: "var(--surface2)" }}>
            <b style={{ display: "block", fontSize: 18, fontWeight: 900, color: c, lineHeight: 1.1 }}>{n}</b>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{l}</span></span>))}
      </div>
    </div>

    {d.planned?.length > 0 && <div className="card" style={{ padding: "16px 20px" }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 900, color: "#6366F1" }}>🗓️ Planifié</h3>
      {d.planned.map(p => {
        const last = p.last, lt = isoTs(last?.at), lp = p.last_purge, lpt = isoTs(lp?.at);
        return <div key={p.id} style={{ padding: "9px 10px", borderRadius: 12, background: "var(--surface2)", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{p.label}</span>
            <Chip state={p.running ? "running" : p.enabled ? "planned" : "disabled"}/>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.45 }}>{p.desc}</div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text2)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
            {p.next_at && <span style={{ color: "#6366F1" }}>prochaine : {when(p.next_at)} (dans {dur(p.next_at - now)})</span>}
            {!p.enabled && <span>activable dans ses réglages</span>}
            {lt && !last?.error && <span style={{ color: "#16a34a" }}>✓ dernière il y a {dur(now - lt)}{last.trigger ? ` (${last.trigger})` : ""}{last.seconds != null ? `, ${dur(last.seconds)}` : ""}</span>}
            {lpt && !lp?.error && <span>vidage il y a {dur(now - lpt)}{lp.trigger ? ` (${lp.trigger})` : ""}</span>}
          </div>
          {last?.error && <div style={{ fontSize: 11.5, fontWeight: 700, color: "#ef4444", marginTop: 4 }}>⚠ dernière il y a {dur(now - lt)} : {last.error}</div>}
          {lp?.error && <div style={{ fontSize: 11.5, fontWeight: 700, color: "#ef4444", marginTop: 4 }}>⚠ vidage il y a {dur(now - lpt)} : {lp.error}</div>}
        </div>;
      })}
    </div>}

    {d.jobs.length > 0 && <div className="card" style={{ padding: "16px 20px" }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 900, color: "#8B5CF6" }}>⚙️ Travaux lancés à la demande</h3>
      {d.jobs.map(j => {
        const pct = j.total ? Math.round(100 * (j.done || 0) / j.total) : null;
        return <div key={j.id} style={{ padding: "8px 10px", borderRadius: 12, background: "var(--surface2)", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{j.label}</span>
            <Chip state={j.running ? "running" : j.finished || j.done ? "done" : "unknown"}/>
          </div>
          {j.running && pct != null && <div style={{ height: 6, borderRadius: 6, background: "var(--border)", marginTop: 6, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #0EA5E9, #6366F1)", transition: "width .4s" }}/></div>}
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4, fontWeight: 600 }}>
            {[j.total != null && `${j.done || 0} / ${j.total}${pct != null ? ` (${pct} %)` : ""}`,
              j.running && j.current && `en ce moment : ${j.current}`,
              !j.running && j.stopped,
              !j.running && j.finished && `terminé il y a ${dur(now - j.finished)}`].filter(Boolean).join(" · ") || (j.running ? "en cours" : "rien en cours")}
          </div>
        </div>;
      })}
    </div>}

    {families.map(f => <div key={f} className="card" style={{ padding: "16px 20px" }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 900, color: "#0EA5E9" }}>{FAMILY_ICON[f] || "•"} {f}</h3>
      {d.loops.filter(l => l.family === f).map(l => (
        <div key={l.id} style={{ padding: "9px 10px", borderRadius: 12, background: "var(--surface2)", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{l.label}</span>
            <Chip state={l.state}/>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.45 }}>{l.desc}</div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text2)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
            {l.state === "running" && l.last_start && <span style={{ color: "#0EA5E9" }}>tourne depuis {dur(now - l.last_start)}</span>}
            {l.last_end && <span>dernier passage il y a {dur(now - l.last_end)}{l.last_s != null ? ` (${dur(l.last_s)})` : ""}</span>}
            {l.state === "waiting" && l.next_at && <span style={{ color: "#16a34a" }}>prochain dans {dur(l.next_at - now)}</span>}
            {l.runs > 0 && <span>{l.runs} passage{l.runs > 1 ? "s" : ""}</span>}
            {l.state === "starting" && l.since && <span>lancée il y a {dur(now - l.since)}</span>}
          </div>
          {l.error && <div style={{ fontSize: 11.5, fontWeight: 700, color: "#ef4444", marginTop: 4, wordBreak: "break-word" }}
            data-tip={l.error}>⚠ {l.error_at ? `il y a ${dur(now - l.error_at)} : ` : ""}{l.error}</div>}
        </div>))}
    </div>)}
  </div>;
}
