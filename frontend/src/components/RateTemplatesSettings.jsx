import React, { useEffect, useState } from "react";
import CardHelp from "./CardHelp";
import client from "../api/client";
import { showConfirm } from "../utils/dialog";
import { forgetTemplates } from "./MwToRate";

// Messages d'evaluation tout faits, ranges par familles. A l'evaluation, on
// choisit la famille dans un menu et un message est tire au hasard ; la
// premiere famille est celle proposee d'office.
export default function RateTemplatesSettings() {
  const [fams, setFams] = useState(null);
  const [saved, setSaved] = useState(null);       // JSON enregistre, pour savoir s'il y a du neuf
  const [open, setOpen] = useState(0);            // famille depliee
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    client.get("/makerworld/rate-templates").then(({ data }) => {
      setFams(data.families || []); setSaved(JSON.stringify(data.families || []));
    }).catch(() => setFams([]));
  }, []);
  if (!fams) return null;
  const dirty = JSON.stringify(fams) !== saved;
  const upd = (i, f) => setFams(l => l.map((x, j) => j === i ? f(x) : x));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data } = await client.put("/makerworld/rate-templates", { families: fams });
      setFams(data.families); setSaved(JSON.stringify(data.families)); forgetTemplates();
      setMsg("Enregistré");
    } catch (e) { setMsg(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const del = async (i) => {
    if (!(await showConfirm(`Supprimer la famille « ${fams[i].name} » et ses ${fams[i].messages.length} messages ?`,
      { confirmLabel: "Supprimer", danger: true }))) return;
    setFams(l => l.filter((_, j) => j !== i)); setOpen(-1);
  };
  const first = (i) => { setFams(l => [l[i], ...l.filter((_, j) => j !== i)]); setOpen(0); };

  const input = { width: "100%", boxSizing: "border-box", borderRadius: 8, border: "1px solid var(--border)",
    background: "var(--surface)", color: "var(--text)", padding: "7px 9px", fontSize: 13, fontFamily: "inherit" };
  const small = { padding: "4px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
    background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" };

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>⭐ Messages d'évaluation</div>
        <CardHelp title="Messages d'évaluation">
          Rangés par familles. En évaluant à 5 étoiles, tu choisis la famille et un message est tiré au hasard,
          modifiable avant de publier. La première famille est proposée d'office.
          <code> {"{modèle}"}</code> et <code>{"{créateur}"}</code> sont remplacés automatiquement.</CardHelp>
      </div>

      {fams.map((f, i) => (
        <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <div onClick={() => setOpen(o => o === i ? -1 : i)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px",
            cursor: "pointer", background: "var(--surface2)" }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              {f.name || "Sans nom"} <span style={{ fontWeight: 500, color: "var(--muted)" }}>· {f.messages.length} message{f.messages.length > 1 ? "s" : ""}</span>
              {i === 0 && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#f59e0b" }}>par défaut</span>}
            </span>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>{open === i ? "▲" : "▼"}</span>
          </div>
          {open === i && (
            <div style={{ padding: 11, display: "flex", flexDirection: "column", gap: 8 }}>
              <input value={f.name} onChange={e => upd(i, x => ({ ...x, name: e.target.value }))} placeholder="Nom de la famille"
                maxLength={60} style={input}/>
              {f.messages.map((m, k) => (
                <div key={k} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <textarea value={m} rows={3} maxLength={2000} onChange={e => upd(i, x => ({ ...x,
                    messages: x.messages.map((y, j) => j === k ? e.target.value : y) }))} style={{ ...input, resize: "vertical" }}/>
                  <button onClick={() => upd(i, x => ({ ...x, messages: x.messages.filter((_, j) => j !== k) }))} aria-label="Retirer ce message"
                    style={{ ...small, padding: "4px 8px", color: "#ef4444" }}>✕</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => upd(i, x => ({ ...x, messages: [...x.messages, ""] }))} style={small}>+ Message</button>
                {i > 0 && <button onClick={() => first(i)} style={small}>⭐ Mettre par défaut</button>}
                <button onClick={() => del(i)} style={{ ...small, color: "#ef4444", marginLeft: "auto" }}>Supprimer la famille</button>
              </div>
            </div>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => { setFams(l => [...l, { name: `Famille ${l.length + 1}`, messages: [""] }]); setOpen(fams.length); }}
          style={small}>+ Famille</button>
        <button onClick={save} disabled={!dirty || busy} style={{ ...small, marginLeft: "auto", background: dirty ? "#3b82f6" : "var(--surface2)",
          color: dirty ? "white" : "var(--muted)", border: "none", opacity: busy ? 0.6 : 1 }}>{busy ? "…" : "Enregistrer"}</button>
        {msg && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{msg}</span>}
      </div>
    </div>
  );
}
