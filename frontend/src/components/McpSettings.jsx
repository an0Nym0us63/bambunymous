import React, { useEffect, useState } from "react";
import client from "../api/client";
import { showAlert, showConfirm } from "../utils/dialog";
import { egg } from "../eggs";

// Le serveur MCP (10/11/2026) : Claude (l'appli, Claude Code, le telephone) interroge BambuNymous et, si on le permet,
// agit dessus. Le mode (desactive, lecture seule, lecture et ecriture), le jeton (montre une seule fois), de quoi le
// brancher dans Claude, ce qui a ete demande ce mois-ci, la liste des outils.
const btn = (primary, dis = false, danger = false) => ({ padding:"8px 13px", borderRadius:10, fontSize:13, fontWeight:700, cursor: dis ? "not-allowed" : "pointer",
  border: primary ? "none" : "1px solid var(--border)", background: dis ? "var(--border)" : primary ? "linear-gradient(135deg, #D97757, #B45309)" : "var(--surface2)",
  color: primary || dis ? "white" : danger ? "#ef4444" : "var(--text)", fontFamily:"inherit" });
const code = { display:"block", padding:"8px 10px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)", fontSize:11.5,
  fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace", color:"var(--text)", wordBreak:"break-all", whiteSpace:"pre-wrap", lineHeight:1.45 };
const MODES = [["off", "Désactivé", "Rien ne répond"], ["ro", "Lecture seule", "Claude lit tout, ne change rien"],
  ["rw", "Lecture et écriture", "Claude peut aussi agir (planning, rangements, bobines…)"]];
const when = s => s ? new Date(s).toLocaleString("fr-FR", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "jamais";

function Copy({ label, text }) {
  const [ok, setOk] = useState(false);
  const go = async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1600); } catch { showAlert(text); } };
  return <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <b style={{ fontSize:12, color:"var(--text)", flex:1, minWidth:0 }}>{label}</b>
      <button type="button" onClick={go} style={{ ...btn(false), padding:"3px 10px", fontSize:11.5 }}>{ok ? "✓ Copié" : "Copier"}</button>
    </div>
    <code style={code}>{text}</code>
  </div>;
}

export default function McpSettings({ card, cardTitle }) {
  const [s, setS] = useState(null), [tok, setTok] = useState(null), [busy, setBusy] = useState(false);
  const [tools, setTools] = useState(null), [showTools, setShowTools] = useState(false);
  const load = () => client.get("/mcp/settings").then(r => setS(r.data)).catch(e => showAlert(e.response?.data?.detail || e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (showTools && !tools) client.get("/mcp/tools").then(r => setTools(r.data.tools)).catch(() => setTools([])); }, [showTools, tools]);
  const setMode = async m => {
    try { setS((await client.put("/mcp/settings", { mode: m })).data); } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const newTok = async () => {
    if (s.has_token && !(await showConfirm("Créer un nouveau jeton ? L'ancien cessera de marcher tout de suite : il faudra mettre à jour Claude."))) return;
    setBusy(true);
    try { const { data } = await client.post("/mcp/token"); setTok(data.token); setS(data); egg("mcp_branche"); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const revoke = async () => {
    if (!(await showConfirm("Révoquer le jeton ? Claude ne pourra plus joindre BambuNymous jusqu'à un nouveau jeton."))) return;
    try { setS((await client.delete("/mcp/token")).data); setTok(null); } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  if (!s) return <div className="card" style={card}><div style={cardTitle}>🔌 MCP (Claude)</div>
    <p style={{ fontSize:12.5, color:"var(--muted)", margin:0 }}>Chargement…</p></div>;
  const origin = window.location.origin, u = s.usage || {};
  return (
    <div className="card" style={card}>
      <div style={cardTitle}>🔌 MCP (Claude)</div>
      <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
        <p style={{ fontSize:12.5, color:"var(--text2)", margin:0, lineHeight:1.45 }}>
          Branche BambuNymous sur Claude (l'appli, le téléphone, Claude Code) : dans une conversation, Claude lit l'imprimante, le stock,
          les rangements, l'historique, la file et le planning, et peut agir si tu l'y autorises. C'est ton abonnement Claude qui travaille :
          rien n'est facturé ici.</p>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))", gap:6 }}>
          {MODES.map(([k, t, d]) => { const on = s.mode === k;
            return <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={on} data-tip={d}
              style={{ padding:"8px 10px", borderRadius:12, textAlign:"left", cursor:"pointer", fontFamily:"inherit",
                border: on ? "1.5px solid #D97757" : "1px solid var(--border)", background: on ? "color-mix(in srgb, #D97757 12%, var(--surface))" : "var(--surface2)" }}>
              <div style={{ fontSize:13, fontWeight:800, color:"var(--text)" }}>{k === "off" ? "⏸" : k === "ro" ? "👁" : "✍️"} {t}</div>
              <div style={{ fontSize:11, color:"var(--muted)", lineHeight:1.3, marginTop:2 }}>{d}</div>
            </button>; })}
        </div>
        <div style={{ fontSize:11.5, color:"var(--muted)", lineHeight:1.4 }}>
          {s.tools?.ro} outils en lecture seule, {s.tools?.rw} en lecture et écriture, {s.resources} chapitres du guide et {s.prompts} invites toutes faites.
          Jamais : les comptes, les invitations, les mots de passe et clés, l'import ou la remise à zéro ; les secrets sont masqués dans les réponses.</div>

        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <button type="button" disabled={busy} onClick={newTok} style={btn(true, busy)}>{s.has_token ? "🔑 Nouveau jeton" : "🔑 Créer le jeton"}</button>
          {s.has_token && <button type="button" onClick={revoke} style={btn(false, false, true)}>Révoquer</button>}
          {s.has_token && !tok && <span style={{ fontSize:12, color:"var(--muted)" }}>Jeton …{s.hint} créé le {when(s.token_at)}</span>}
        </div>
        {s.mode === "off" && s.has_token && <div style={{ fontSize:12, fontWeight:700, color:"#B45309" }}>Le MCP est désactivé : choisis un mode pour que Claude puisse le joindre.</div>}

        {tok && <div style={{ display:"flex", flexDirection:"column", gap:9, padding:10, borderRadius:12, border:"1.5px solid color-mix(in srgb, #D97757 45%, var(--border))",
          background:"color-mix(in srgb, #D97757 6%, var(--surface))" }}>
          <b style={{ fontSize:12.5, color:"#B45309" }}>Copie-le maintenant : il ne sera plus jamais affiché (seule son empreinte est gardée).</b>
          <Copy label="Appli Claude (ordinateur, web, téléphone) : Paramètres › Connecteurs › Ajouter un connecteur personnalisé, cette adresse"
            text={`${origin}/api/v1/mcp/k/${tok}`}/>
          <Copy label="Claude Code (terminal)" text={`claude mcp add --transport http bambunymous ${origin}/api/v1/mcp --header "Authorization: Bearer ${tok}"`}/>
          <Copy label="Autre client MCP (configuration JSON)" text={JSON.stringify({ mcpServers: { bambunymous: { type: "http", url: `${origin}/api/v1/mcp`,
            headers: { Authorization: `Bearer ${tok}` } } } }, null, 2)}/>
          <span style={{ fontSize:11.5, color:"var(--muted)", lineHeight:1.4 }}>L'adresse du connecteur contient le jeton : ne la partage pas. Un nouveau jeton la rend caduque.</span>
          <button type="button" onClick={() => setTok(null)} style={{ ...btn(false), alignSelf:"flex-start" }}>C'est noté</button>
        </div>}

        <div style={{ fontSize:12, color:"var(--muted)", lineHeight:1.45 }}>
          Ce mois-ci : {u.calls || 0} appel{(u.calls || 0) > 1 ? "s" : ""} d'outils{u.errors ? ` (dont ${u.errors} refusé${u.errors > 1 ? "s" : ""} ou en erreur)` : ""} ·
          dernier contact {when(u.last_at)}{u.last_tool ? ` (${u.last_tool})` : ""}{u.client ? ` · ${u.client}` : ""}</div>

        <button type="button" onClick={() => setShowTools(v => !v)} style={{ ...btn(false), alignSelf:"flex-start", padding:"5px 11px", fontSize:12 }}>
          {showTools ? "▾" : "▸"} Les outils</button>
        {showTools && (tools ? <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
          {tools.map(t => <span key={t.name} data-tip={t.name} style={{ padding:"2px 8px", borderRadius:999, fontSize:11.5, fontWeight:600,
            color: t.rw ? "#B45309" : "var(--text2)", background: t.rw ? "color-mix(in srgb, #D97757 12%, transparent)" : "var(--surface2)",
            border:`1px solid ${t.rw ? "color-mix(in srgb, #D97757 35%, transparent)" : "var(--border)"}` }}>{t.rw ? "✍️ " : ""}{t.title || t.name}</span>)}
        </div> : <span style={{ fontSize:12, color:"var(--muted)" }}>Chargement…</span>)}
      </div>
    </div>
  );
}
