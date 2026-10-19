import React, { useEffect, useState } from "react";
import client from "../api/client";
import MwImg from "./MwImg";

// Concours MakerWorld (Découvrir › 🏆 Concours) : en cours, en délibération,
// terminés ; dates, récompenses, et leurs modèles (en vue, ou primés) qui
// s'ouvrent dans la fiche habituelle.
const ST = {
  open:     ["En cours", "#22c55e"],
  judging:  ["Délibération", "#f59e0b"],
  ended:    ["Terminé", "#94a3b8"],
  upcoming: ["À venir", "#3b82f6"],
  unknown:  ["?", "#94a3b8"],
};
const FILTERS = [["open", "En cours"], ["judging", "Délibération"], ["ended", "Terminés"], ["all", "Tous"]];
const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };
// Dates de MakerWorld en UTC (une fin « 22/11 23:59 UTC » tombe le 23 a Paris).
const day = d => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }) : "";
const left = d => {
  const n = d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null;
  return n == null ? "" : n > 1 ? `encore ${n} jours` : n === 1 ? "dernier jour" : "";
};

export default function MwContests({ onOpen, reload = 0 }) {
  const [list, setList] = useState(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState(0);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("open");

  useEffect(() => {
    let alive = true;
    setErr(null);
    client.get("/makerworld/contests", { params: reload ? { fresh: 1 } : {} })
      .then(({ data }) => { if (!alive) return;
        if (data.error) setErr(data.error);
        setList(data.contests || []); setTotal(data.total || 0); setNext(data.next_offset || 0); })
      .catch(e => alive && setErr(e.response?.data?.detail || e.message));
    return () => { alive = false; };
  }, [reload]);

  const loadMore = async () => {
    setMore(true);
    try {
      const { data } = await client.get("/makerworld/contests", { params: { offset: next } });
      setList(l => [...l, ...(data.contests || [])]); setNext(data.next_offset || next);
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
    setMore(false);
  };

  const msg = { fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "24px 0", margin: 0 };
  if (err && !list?.length) return <p style={{ ...msg, color: "#f59e0b" }}>{err}</p>;
  if (!list) return <p style={msg}>Lecture des concours…</p>;
  const shown = list.filter(c => filter === "all" || c.status === filter);
  const pill = on => ({ padding: "4px 11px", borderRadius: 20, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
    background: on ? "rgba(59,130,246,0.15)" : "var(--surface2)", color: on ? "#3b82f6" : "var(--text2)",
    border: on ? "1px solid #3b82f6" : "1px solid var(--border)" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={pill(filter === k)}>
            {l} ({k === "all" ? list.length : list.filter(c => c.status === k).length})</button>
        ))}
      </div>
      {!shown.length && <p style={msg}>Aucun concours ici pour l'instant.</p>}
      {shown.map(c => <Contest key={c.id} c={c} onOpen={onOpen}/>)}
      {list.length < total && (
        <button onClick={loadMore} disabled={more} style={{ alignSelf: "center", padding: "8px 18px", borderRadius: 10,
          fontSize: 12, fontWeight: 700, cursor: "pointer", background: "var(--surface2)", border: "1px solid var(--border)",
          color: "var(--text)" }}>{more ? "…" : `Plus de concours (${list.length} / ${total})`}</button>
      )}
    </div>
  );
}

function Contest({ c, onOpen }) {
  const [rewards, setRewards] = useState(false);
  const [all, setAll] = useState(false);
  const [label, color] = ST[c.status] || ST.unknown;
  const when = c.status === "open" ? `jusqu'au ${day(c.end)}${left(c.end) ? ` · ${left(c.end)}` : ""}`
    : c.status === "judging" ? `résultats le ${day(c.results)}`
    : c.status === "upcoming" ? `à partir du ${day(c.start)}` : `terminé le ${day(c.end)}`;
  const designs = all ? c.designs : c.designs.slice(0, 6);
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {c.cover && <MwImg src={c.cover} w={720} style={{ width: "100%", aspectRatio: "16 / 6", objectFit: "cover", display: "block" }}/>}
      <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "white", background: color, borderRadius: 20, padding: "1px 8px" }}>{label}</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{when}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginTop: 4, lineHeight: 1.3 }}>{c.name}</div>
          {c.desc && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{c.desc}</div>}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
            {[c.entries != null && `${c.entries} modèles`, c.contestants != null && `${c.contestants} participants`,
              c.views != null && `${c.views.toLocaleString("fr-FR")} vues`].filter(Boolean).join(" · ")}</div>
        </div>

        {c.rewards?.length > 0 && (
          <div>
            <button onClick={() => setRewards(v => !v)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
              fontSize: 12, fontWeight: 700, color: "#3b82f6" }}>🎁 Récompenses {rewards ? "▴" : "▾"}</button>
            {rewards && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {c.rewards.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, fontSize: 11.5, color: "var(--text2)", lineHeight: 1.4 }}>
                    <span style={{ fontWeight: 800, flexShrink: 0, minWidth: 34 }}>{MEDAL[r.rank] || `#${r.rank}`}{r.count > 1 ? ` ×${r.count}` : ""}</span>
                    <span>{r.reward}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {c.designs?.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
              {c.designs_kind === "awarded" ? "Primés" : "En vue"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 6 }}>
              {designs.map(x => (
                <button key={x.design_id} onClick={() => onOpen(x)} title={x.title_fr || x.title}
                  style={{ padding: 0, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", cursor: "pointer",
                    background: "var(--surface2)", textAlign: "left", color: "var(--text)", position: "relative" }}>
                  {x.cover_url ? <MwImg src={x.cover_url} w={200} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}/>
                    : <div style={{ width: "100%", aspectRatio: "1" }}/>}
                  {x.rank && <span style={{ position: "absolute", top: 4, left: 4, fontSize: 15 }}>{MEDAL[x.rank] || `#${x.rank}`}</span>}
                  {x.printed > 0 && <span style={{ position: "absolute", top: 4, right: 4, fontSize: 9.5, fontWeight: 800, color: "white",
                    background: "#22c55e", borderRadius: 10, padding: "1px 5px" }}>✓</span>}
                  <div style={{ padding: "4px 6px 5px", fontSize: 10.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap" }}>{x.title_fr || x.title}</div>
                </button>
              ))}
            </div>
            {c.designs.length > 6 && (
              <button onClick={() => setAll(v => !v)} style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer",
                fontSize: 11.5, fontWeight: 700, color: "#3b82f6" }}>{all ? "Moins" : `Voir les ${c.designs.length}`}</button>
            )}
          </div>
        )}
        <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>
          Voir le concours sur MakerWorld ↗</a>
      </div>
    </div>
  );
}
