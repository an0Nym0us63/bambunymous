import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";
import { showAlert, showConfirm } from "../utils/dialog";

// Claude (07/11/2026) : la cle de l'API Claude Platform (collee ici, jamais dans le code), ce qui a ete consomme ce
// mois-ci, et le classement de toute la collection en familles, categories et etiquettes.
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
  const load = () => client.get("/settings/claude").then(r => setS(r.data)).catch(e => showAlert(e.response?.data?.detail || e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (k) => {
    setBusy(true);
    try { setS((await client.put("/settings/claude", { key: k })).data); setKey(""); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const setAuto = async (v) => {
    try { setS((await client.put("/settings/claude", { auto: v })).data); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  if (!s) return <div className="card" style={card}><div style={cardTitle}>🤖 Claude</div>
    <p style={{ fontSize:12.5, color:"var(--muted)", margin:0 }}>Chargement…</p></div>;
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

        <label style={{ display:"flex", gap:8, alignItems:"flex-start", fontSize:12.5, color:"var(--text2)", lineHeight:1.4, cursor:"pointer" }}>
          <input type="checkbox" checked={!!s.auto} onChange={e => setAuto(e.target.checked)} style={{ marginTop:2 }}/>
          <span><b style={{ color:"var(--text)" }}>Classer automatiquement les nouveaux modèles</b> : à la fin d'une impression, si son modèle
            n'est pas encore classé, Claude s'en charge (environ un demi-centime).</span></label>

        <CollectionLabels hasKey={s.has_key} onIdle={load}/>
      </div>
    </div>
  );
}

// $ par million de jetons (claude-sonnet-5-5) : envoyes, recus
const cost = (i, o) => (Number(i || 0) * 2 + Number(o || 0) * 10) / 1e6;
const usd = v => v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";

// Toute la collection (07/11/2026) : les modeles pas encore classes, par lots de 10, ecrits au fur et a mesure (un
// arret ou une erreur : la relance reprend la ou on en etait). Puis ce qui en sort.
function CollectionLabels({ hasKey, onIdle }) {
  const [o, setO] = useState(null);
  const poll = useRef(null), was = useRef(false);
  const load = () => client.get("/settings/claude/labels").then(r => {
    setO(r.data);
    clearTimeout(poll.current);
    if (r.data.run?.running) { was.current = true; poll.current = setTimeout(load, 3000); }
    else if (was.current) { was.current = false; onIdle?.(); }
  }).catch(() => {});
  useEffect(() => { load(); return () => clearTimeout(poll.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (redo) => {
    if (redo && !(await showConfirm(`Reclasser les ${o.models} modèles (sauf ceux corrigés à la main) ? Compte environ ${usd(o.models * 0.005)}.`))) return;
    try { await client.post("/settings/claude/labels/run", { redo }); setTimeout(load, 800); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const stop = () => client.post("/settings/claude/labels/stop").then(load).catch(e => showAlert(e.response?.data?.detail || e.message));
  if (!o) return null;
  const r = o.run || {}, fams = {};
  for (const c of o.categories || []) (fams[c.family || "?"] = fams[c.family || "?"] || []).push(c);
  const pct = o.models ? Math.round(o.classified / o.models * 100) : 0;
  return <div style={{ borderTop:"1px solid var(--border)", paddingTop:10, display:"flex", flexDirection:"column", gap:8 }}>
    <b style={{ fontSize:13.5, color:"var(--text)" }}>📚 Toute la collection</b>
    <span style={{ fontSize:12.5, color:"var(--text2)", lineHeight:1.45 }}>
      {num(o.classified)} modèle{o.classified > 1 ? "s" : ""} classé{o.classified > 1 ? "s" : ""} sur {num(o.models)}.
      {" "}Leurs catégories et étiquettes s'affichent sur la fiche de chaque impression, et la recherche des impressions les trouve.</span>
    <div style={{ height:6, borderRadius:3, background:"var(--surface2)", overflow:"hidden" }}>
      <div style={{ width:`${r.running && r.total ? Math.round(r.done / r.total * 100) : pct}%`, height:"100%", background:"linear-gradient(90deg, #D97757, #B45309)", transition:"width .4s" }}/></div>
    <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
      {r.running ? <>
        <span style={{ fontSize:12.5, fontWeight:700, color:"var(--text)" }}>Classement… {num(r.done)}/{num(r.total)} · {usd(cost(r.in, r.out))}</span>
        <button type="button" onClick={stop} style={btn(false)}>Arrêter</button>
      </> : <>
        <button type="button" disabled={!hasKey || !o.missing} onClick={() => run(false)} style={btn(true, !hasKey || !o.missing)}>
          {o.missing ? `Classer les ${num(o.missing)} modèle${o.missing > 1 ? "s" : ""} restant${o.missing > 1 ? "s" : ""} (≈ ${usd(Math.max(0.01, o.missing * 0.005))})` : "Tout est classé"}</button>
        {o.classified > 0 && <button type="button" disabled={!hasKey} onClick={() => run(true)} style={btn(false, !hasKey)}>Tout reclasser</button>}
      </>}
    </div>
    {!r.running && r.at && (r.in > 0 || r.error) && <span style={{ fontSize:11.5, color:"var(--muted)" }}>
      Dernier passage : {new Date(r.at).toLocaleString("fr-FR")} · {num(r.done)} modèle{r.done > 1 ? "s" : ""} · {usd(cost(r.in, r.out))}</span>}
    {r.error && <div style={{ fontSize:12.5, fontWeight:700, color:"#ef4444" }}>{r.error} — relance pour reprendre là où il s'est arrêté.</div>}
    {o.categories?.length > 0 && <div style={{ padding:10, borderRadius:12, background:"var(--surface2)", border:"1px solid var(--border)", display:"flex", flexDirection:"column", gap:6 }}>
      <b style={{ fontSize:12.5, color:"var(--text)" }}>{o.categories.length} catégories · {num(o.tag_count)} étiquettes</b>
      {Object.entries(fams).sort((a, b) => b[1].reduce((s, c) => s + c.n, 0) - a[1].reduce((s, c) => s + c.n, 0)).map(([f, cs]) => <div key={f} style={{ fontSize:12 }}>
        <span style={chip("#B45309", true)}>{f}</span>
        {cs.map(c => <span key={c.name} style={chip("#6366F1")}>{c.name} · {c.n}</span>)}
      </div>)}
      {o.tags?.length > 0 && <div style={{ fontSize:12, marginTop:2 }}>
        <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)", marginRight:6 }}>Étiquettes les plus courantes</span>
        {o.tags.slice(0, 40).map(t => <span key={t.name} style={chip("#64748B")}>{t.name} · {t.n}</span>)}
      </div>}
    </div>}
  </div>;
}
