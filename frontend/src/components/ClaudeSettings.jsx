import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";

// Claude (07/11/2026) : la cle de l'API Claude Platform (collee ici, jamais dans le code), ce qui a ete consomme ce
// mois-ci, et la simulation des categories et etiquettes : les derniers modeles imprimes classes par Claude, sans rien
// ecrire sur les impressions, pour juger avant de l'appliquer.
const inp = { width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10,
  padding:"9px 12px", fontSize:13, color:"var(--text)", outline:"none", boxSizing:"border-box" };
const lbl = { display:"block", fontSize:11, fontWeight:600, color:"var(--muted)", marginBottom:4 };
const btn = (primary, dis = false) => ({ padding:"9px 14px", borderRadius:10, fontSize:13, fontWeight:700, cursor: dis ? "not-allowed" : "pointer",
  border: primary ? "none" : "1px solid var(--border)", background: dis ? "var(--border)" : primary ? "linear-gradient(135deg, #D97757, #B45309)" : "var(--surface2)",
  color: primary || dis ? "white" : "var(--text)" });
const chip = (c, strong = false) => ({ display:"inline-block", padding:"2px 8px", borderRadius:999, fontSize:11.5, fontWeight: strong ? 800 : 600, margin:"0 4px 4px 0",
  background:`color-mix(in srgb, ${c} ${strong ? 16 : 10}%, transparent)`, color: strong ? c : "var(--text2)", border:`1px solid color-mix(in srgb, ${c} 30%, transparent)` });
const num = n => Number(n || 0).toLocaleString("fr-FR");

export default function ClaudeSettings({ card, cardTitle }) {
  const [s, setS] = useState(null), [key, setKey] = useState(""), [busy, setBusy] = useState(false);
  const [sim, setSim] = useState(null);
  const poll = useRef(null);
  const load = () => client.get("/settings/claude").then(r => setS(r.data)).catch(e => showAlert(e.response?.data?.detail || e.message));
  const loadSim = () => client.get("/settings/claude/tags-sim").then(r => {
    setSim(r.data);
    clearTimeout(poll.current);
    if (r.data.running) poll.current = setTimeout(loadSim, 2500);
    else load();
  }).catch(() => {});
  useEffect(() => { load(); loadSim(); return () => clearTimeout(poll.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (k) => {
    setBusy(true);
    try { setS((await client.put("/settings/claude", { key: k })).data); setKey(""); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const run = async () => {
    try { setSim((await client.post("/settings/claude/tags-sim", { n: 50 })).data); setTimeout(loadSim, 1500); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  if (!s) return <div className="card" style={card}><div style={cardTitle}>🤖 Claude</div>
    <p style={{ fontSize:12.5, color:"var(--muted)", margin:0 }}>Chargement…</p></div>;
  const res = sim?.result;
  return (
    <div className="card" style={card}>
      <div style={cardTitle}>🤖 Claude</div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <p style={{ fontSize:12.5, color:"var(--text2)", margin:0, lineHeight:1.45 }}>
          Les catégories et étiquettes des impressions, proposées par Claude. La clé se crée sur
          {" "}<a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">platform.claude.com</a> (le crédit mensuel
          d'un abonnement Max y passe d'abord). Elle reste sur ton serveur, jamais affichée.</p>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end" }}>
          <div style={{ flex:1, minWidth:220 }}><span style={lbl}>Clé d'API {s.has_key ? "(enregistrée, laisser vide pour garder)" : ""}</span>
            <input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="new-password" placeholder={s.has_key ? "••••••••" : "sk-ant-…"} style={inp}/></div>
          <button type="button" disabled={busy || !key.trim()} onClick={() => save(key)} style={btn(false, busy || !key.trim())}>Enregistrer</button>
          {s.has_key && <button type="button" disabled={busy} onClick={() => save("-")} style={{ ...btn(false, busy), color:"#ef4444" }}>Oublier la clé</button>}
        </div>
        <div style={{ fontSize:12, color:"var(--muted)" }}>
          Ce mois-ci : {num(s.usage.calls)} demande{s.usage.calls > 1 ? "s" : ""} · {num(s.usage.in)} jetons envoyés · {num(s.usage.out)} reçus · modèle {s.model}</div>

        <div style={{ borderTop:"1px solid var(--border)", paddingTop:10, display:"flex", flexDirection:"column", gap:8 }}>
          <b style={{ fontSize:13.5, color:"var(--text)" }}>🧪 Simulation des catégories</b>
          <span style={{ fontSize:12.5, color:"var(--text2)", lineHeight:1.45 }}>Tes 50 derniers modèles imprimés, classés par Claude en familles, catégories
            et étiquettes. Rien n'est écrit sur tes impressions : c'est pour juger avant de l'appliquer.</span>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <button type="button" disabled={!s.has_key || sim?.running} onClick={run} style={btn(true, !s.has_key || sim?.running)}>
              {sim?.running ? `Classement… ${sim.done}/${sim.total || "?"}` : res ? "Relancer la simulation" : "Lancer la simulation"}</button>
            {!s.has_key && <span style={{ fontSize:12, color:"var(--muted)" }}>Enregistre d'abord une clé.</span>}
          </div>
          {sim?.error && <div style={{ fontSize:12.5, fontWeight:700, color:"#ef4444" }}>{sim.error}</div>}
          {res && <SimResult res={res}/>}
        </div>
      </div>
    </div>
  );
}

function SimResult({ res }) {
  const fams = {};
  for (const c of res.categories || []) (fams[c.family || "?"] = fams[c.family || "?"] || []).push(c);
  return <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
    <span style={{ fontSize:11.5, color:"var(--muted)" }}>{new Date(res.at).toLocaleString("fr-FR")} · {res.rows.length} modèles · {(res.categories || []).length} catégories ·
      {" "}{res.tags} étiquettes · {res.seconds} s</span>
    <div style={{ padding:10, borderRadius:12, background:"var(--surface2)", border:"1px solid var(--border)" }}>
      <b style={{ fontSize:12.5, color:"var(--text)" }}>Les catégories qui en sortent</b>
      <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:6 }}>
        {Object.entries(fams).sort((a, b) => b[1].length - a[1].length).map(([f, cs]) => <div key={f} style={{ fontSize:12 }}>
          <span style={chip("#B45309", true)}>{f}{(res.new_families || []).includes(f) ? " ✨" : ""}</span>
          {cs.sort((a, b) => b.n - a.n).map(c => <span key={c.name} style={chip("#6366F1")}>{c.name} · {c.n}</span>)}
        </div>)}
      </div>
    </div>
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
        <thead><tr style={{ textAlign:"left", color:"var(--muted)" }}>
          <th style={{ padding:"6px 8px" }}>Modèle</th><th style={{ padding:"6px 8px" }}>Famille</th>
          <th style={{ padding:"6px 8px" }}>Catégories</th><th style={{ padding:"6px 8px" }}>Étiquettes</th></tr></thead>
        <tbody>{res.rows.map(r => <tr key={r.ref} style={{ borderTop:"1px solid var(--border)", verticalAlign:"top" }}>
          <td style={{ padding:"6px 8px", minWidth:160, color:"var(--text)", fontWeight:700 }}>{r.title}
            {r.mw_categories?.length > 0 && <div style={{ fontWeight:500, fontSize:11, color:"var(--muted)" }}>MakerWorld : {r.mw_categories.join(" · ")}</div>}</td>
          <td style={{ padding:"6px 8px", minWidth:110 }}>{r.families.map(f => <span key={f} style={chip("#B45309", true)}>{f}</span>)}</td>
          <td style={{ padding:"6px 8px", minWidth:120 }}>{r.categories.map(c => <span key={c.name} style={chip("#6366F1", true)}>{c.name}</span>)}</td>
          <td style={{ padding:"6px 8px", minWidth:200 }}>{r.tags.map(t => <span key={t} style={chip("#64748B")}>{t}</span>)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
