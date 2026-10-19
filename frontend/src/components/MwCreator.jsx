import React, { useEffect, useState } from "react";
import client from "../api/client";
import MwImg from "./MwImg";
import { prefetchModel } from "./MakerWorldModelSheet";

// Onglet « Créateur » : mes points MakerWorld (solde, gains 7 / 30 jours,
// historique jour par jour) et mes modeles avec leurs compteurs. Les points
// sont ceux reellement verses par MakerWorld (point-bill), pas recalcules.
const fmt = (v, d = 0) => v == null ? "—" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d });
const pts = v => fmt(v, 2);
const PERIODS = [["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"], ["365", "1 an"], ["all", "Depuis le début"]];
const TYPES = [["points", "Points", "pts"], ["downloads", "Téléchargements", "téléch."], ["prints", "Impressions", "impr."],
  ["boosts", "Boosts", "boosts"], ["likes", "J'aime", "j'aime"]];
const SHORT = { "7": "7 j", "30": "30 j", "90": "90 j", "365": "1 an", "all": "total" };

export default function MwCreator({ reload = 0, onOpen, onLoaded }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [period, setPeriod] = useState("30");
  const [type, setType] = useState("points");
  const [hist, setHist] = useState(null);        // { items, total }
  const [more, setMore] = useState(false);
  const [view, setView] = useState("models");    // models | points

  useEffect(() => {
    let alive = true;
    setErr(null);
    client.get("/makerworld/creator", { params: { period, ...(reload ? { fresh: 1 } : {}) } })
      .then(({ data }) => { if (alive) setData(data); })
      .catch(e => { if (alive) setErr(e.response?.data?.detail || e.message); })
      .finally(() => onLoaded?.());
    return () => { alive = false; };
  }, [reload, period]);
  useEffect(() => {
    client.get("/makerworld/creator/points").then(({ data }) => setHist(data)).catch(() => {});
  }, [reload]);

  const loadMore = () => {
    setMore(true);
    client.get("/makerworld/creator/points", { params: { offset: hist.items.length } })
      .then(({ data }) => setHist(h => ({ ...h, items: [...h.items, ...(data.items || [])] })))
      .catch(() => {}).finally(() => setMore(false));
  };

  if (err) return <p style={msg}>MakerWorld ne répond pas comme prévu : {err}</p>;
  if (!data) return <p style={msg}>…</p>;
  const p = data.profile;
  const val = m => m.period?.[type] ?? 0;
  const models = [...data.models].sort((a, b) => val(b) - val(a) || (b[type] || 0) - (a[type] || 0));
  const typeShort = TYPES.find(t => t[0] === type)?.[2];
  // Compteurs (hors points) : releves journaliers pris par l'appli, depuis peu.
  const partial = type !== "points" && period !== "all" && data.counters_partial;
  const since = data.counters_since ? new Date(data.counters_since + "T12:00:00").toLocaleDateString("fr-FR", { day:"numeric", month:"short" }) : null;

  // historique groupe par jour de versement
  const days = [];
  for (const x of hist?.items || []) {
    const d = String(x.time || "").slice(0, 10);
    if (!days.length || days[days.length - 1].day !== d) days.push({ day: d, items: [], sum: 0 });
    days[days.length - 1].items.push(x); days[days.length - 1].sum += x.points || 0;
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12, paddingBottom:16 }}>
      <div className="card" style={{ padding:"14px 16px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {p.avatar && <MwImg src={p.avatar} w={96} eager style={{ width:46, height:46, borderRadius:"50%", flexShrink:0 }}/>}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:800, color:"var(--text)" }}>{p.name}
              {p.level ? <span style={{ fontSize:11, color:"var(--muted)", fontWeight:600 }}> · niveau {p.level}</span> : null}</div>
            <div style={{ fontSize:11.5, color:"var(--muted)" }}>@{p.handle}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:22, fontWeight:900, color:"#f59e0b", lineHeight:1 }}>🪙 {pts(p.points.total)}</div>
            <div style={{ fontSize:10.5, color:"var(--muted)", marginTop:3 }}>
              {pts(p.points.regular)} normaux · {pts(p.points.exclusive)} exclusifs</div>
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(96px,1fr))", gap:8, marginTop:12 }}>
          {[["+" + pts(data.earned7), "points 7 j", "#22c55e"], ["+" + pts(data.earned30), "points 30 j", "#22c55e"],
            [fmt(p.fans), "abonnés"], [fmt(p.designs), "modèles"], [fmt(p.downloads), "téléchargements"],
            [fmt(p.prints), "impressions"], [fmt(p.boosts), "boosts reçus"], [fmt(p.likes), "j'aime"]].map(([v, l, c]) => (
            <div key={l} style={{ padding:"8px 10px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
              <div style={{ fontSize:15, fontWeight:800, color: c || "var(--text)" }}>{v}</div>
              <div style={{ fontSize:10.5, color:"var(--muted)" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
        {[["models", `Mes modèles (${data.models.length})`], ["points", "Historique des points"]].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} style={pill(view === k)}>{l}</button>
        ))}
        {view === "models" && (
          <span style={{ marginLeft:"auto", display:"flex", gap:6 }}>
            <select value={type} onChange={e => setType(e.target.value)} aria-label="Type" style={sel}>
              {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select value={period} onChange={e => setPeriod(e.target.value)} aria-label="Période" style={sel}>
              {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </span>
        )}

      </div>
      {view === "models" && partial && (
        <p style={{ fontSize:11.5, color:"#f59e0b", margin:"-4px 0 0", lineHeight:1.45 }}>
          L'appli note les compteurs de tes modèles chaque jour depuis le {since} : sur cette période, les
          {" "}{TYPES.find(t => t[0] === type)?.[1].toLowerCase()} ne sont comptés que depuis cette date. Les points, eux, sont complets.
        </p>
      )}

      {view === "models" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {models.map(m => (
            <button key={m.design_id} onClick={() => onOpen?.({ design_id: m.design_id, title: m.title, title_fr: m.title_fr, cover_url: m.cover_url })}
              onPointerDown={() => prefetchModel(m.design_id)}
              style={{ display:"flex", alignItems:"center", gap:10, padding:8, borderRadius:12, cursor:"pointer", textAlign:"left",
                background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}>
              {m.cover_url ? <MwImg src={m.cover_url} w={110} style={{ width:52, height:52, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
                : <span style={{ width:52, height:52, borderRadius:8, background:"var(--surface)", flexShrink:0 }}/>}
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:"block", fontSize:12.5, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {m.title_fr || m.title}{m.exclusive ? <span style={{ fontSize:10, color:"#a78bfa", fontWeight:800 }}> · exclusif</span> : null}</span>
                <span style={{ display:"block", fontSize:11, color:"var(--muted)", marginTop:2 }}>
                  ⬇️ {fmt(m.downloads)} · 🖨️ {fmt(m.prints)} · ⚡ {fmt(m.boosts)} · ❤ {fmt(m.likes)}</span>
              </span>
              <span style={{ textAlign:"right", flexShrink:0 }}>
                <span style={{ display:"block", fontSize:13, fontWeight:800, color: val(m) ? "#22c55e" : "var(--muted)" }}>
                  {val(m) ? `${period === "all" ? "" : "+"}${type === "points" ? pts(val(m)) : fmt(val(m))}` : "0"}</span>
                <span style={{ display:"block", fontSize:9.5, color:"var(--muted)" }}>{typeShort} {SHORT[period]}</span>
              </span>
            </button>
          ))}
        </div>
      ) : !hist ? <p style={msg}>…</p> : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {days.map(d => (
            <div key={d.day} className="card" style={{ padding:"10px 12px" }}>
              <div style={{ display:"flex", alignItems:"center", marginBottom:6 }}>
                <span style={{ flex:1, fontSize:12, fontWeight:800, color:"var(--text2)" }}>
                  {new Date(d.day + "T12:00:00").toLocaleDateString("fr-FR", { weekday:"short", day:"numeric", month:"short" })}</span>
                <span style={{ fontSize:12.5, fontWeight:800, color: d.sum >= 0 ? "#22c55e" : "#ef4444" }}>
                  {d.sum >= 0 ? "+" : ""}{pts(d.sum)}</span>
              </div>
              {d.items.map((x, i) => (
                <div key={i} onClick={() => x.design_id && onOpen?.({ design_id: x.design_id, title: x.title })}
                  style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0", fontSize:11.5,
                    cursor: x.design_id ? "pointer" : "default", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontSize:10, fontWeight:700, color:"var(--muted)", width:44, flexShrink:0 }}>{x.label}</span>
                  <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"var(--text)" }}>
                    {x.title || "—"}{x.instance_title ? <span style={{ color:"var(--muted)" }}> · {x.instance_title}</span> : null}</span>
                  {x.exclusive_bonus && <span title="Points exclusifs" style={{ fontSize:9.5, color:"#a78bfa", fontWeight:800 }}>excl.</span>}
                  <span style={{ fontWeight:800, color: x.points >= 0 ? "#22c55e" : "#ef4444", flexShrink:0 }}>
                    {x.points >= 0 ? "+" : ""}{pts(x.points)}</span>
                </div>
              ))}
            </div>
          ))}
          {hist.items.length < hist.total && (
            <button onClick={loadMore} disabled={more} style={{ ...pill(false), alignSelf:"center", padding:"8px 18px" }}>
              {more ? "…" : `Plus anciens (${hist.items.length} / ${hist.total})`}</button>
          )}
        </div>
      )}
    </div>
  );
}

const sel = { fontSize:12, padding:"4px 8px", borderRadius:8, background:"var(--surface2)",
  border:"1px solid var(--border)", color:"var(--text2)" };
const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
const pill = on => ({ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer",
  background: on ? "rgba(59,130,246,0.15)" : "var(--surface2)", color: on ? "#3b82f6" : "var(--text2)",
  border: on ? "1px solid #3b82f6" : "1px solid var(--border)" });
