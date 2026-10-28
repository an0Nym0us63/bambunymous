import React, { useEffect, useState } from "react";
import CardHelp from "./CardHelp";
import client from "../api/client";
import { showAlert } from "../utils/dialog";

// Les commandes Bambu Lab lues dans les mails (28/10/2026) : la boutique n'a pas d'API, l'appli lit la boite mail
// (IMAP, mot de passe d'application) et repere les mails de la boutique. Les bobines commandees apparaissent en
// « a venir » sur la page Filaments et dans les alertes.
const inp = { width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10,
  padding:"9px 12px", fontSize:13, color:"var(--text)", outline:"none", boxSizing:"border-box" };
const lbl = { display:"block", fontSize:11, fontWeight:600, color:"var(--muted)", marginBottom:4 };
const btn = (primary, dis = false) => ({ padding:"9px 14px", borderRadius:10, fontSize:13, fontWeight:700, cursor: dis ? "not-allowed" : "pointer",
  border: primary ? "none" : "1px solid var(--border)", background: dis ? "var(--border)" : primary ? "#3b82f6" : "var(--surface2)",
  color: primary || dis ? "white" : "var(--text)" });
const when = iso => iso ? new Date(iso).toLocaleString("fr-FR", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "";

export default function MailOrdersSettings({ card, cardTitle }) {
  const [s, setS] = useState(null);
  const [f, setF] = useState({ host:"", port:993, user:"", password:"", folder:"INBOX", sender:"bambulab", days:120, every_h:3 });
  const [busy, setBusy] = useState(false);
  const load = () => client.get("/settings/mail").then(r => {
    setS(r.data);
    setF(x => ({ ...x, host: r.data.host, port: r.data.port, user: r.data.user, folder: r.data.folder, sender: r.data.sender,
      days: r.data.days, every_h: r.data.every_h }));
  }).catch(e => showAlert(e.response?.data?.detail || e.message));
  useEffect(() => { load(); }, []);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const { data } = await client.put("/settings/mail", { ...f, port: Number(f.port) || 993, days: Number(f.days) || 120,
        every_h: Number(f.every_h) || 3, password: f.password || null, ...extra });
      setS(data); setF(x => ({ ...x, password: "" }));
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const [back, setBack] = useState(365);
  const sync = async (reread = false) => {
    setBusy(true);
    try {
      await save();
      const { data } = await client.post("/settings/mail/sync", reread ? { days: Number(back) || 365, reread: true } : {}, { timeout: 300000 });
      if (data.error) showAlert(data.error);
      await load();
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const sw = (on, flip) => <button type="button" onClick={flip} role="switch" aria-checked={on}
    style={{ width:46, height:26, borderRadius:20, border:"none", cursor:"pointer", position:"relative", flexShrink:0,
      background: on ? "#3b82f6" : "var(--border)", transition:"background .2s" }}>
    <span style={{ position:"absolute", top:3, left: on ? 23 : 3, width:20, height:20, borderRadius:"50%", background:"#fff",
      transition:"left .2s", boxShadow:"0 1px 3px rgba(0,0,0,0.3)" }}/></button>;
  if (!s) return <div className="card" style={card}><div style={cardTitle}>📬 Commandes Bambu Lab (mail)</div>
    <p style={{ fontSize:12.5, color:"var(--muted)", margin:0 }}>Chargement…</p></div>;
  const last = s.last;
  return (
    <div className="card" style={card}>
      <div style={cardTitle}>📬 Commandes Bambu Lab (mail)</div>
      <CardHelp title="Commandes Bambu Lab">
        La boutique n'a pas d'API : l'appli lit ta boîte mail et repère les mails de la boutique (commande confirmée,
        expédiée, livrée). Les bobines commandées apparaissent en <b>à venir</b> dans la page Filaments et dans les alertes,
        et s'effacent quand la bobine arrive (ajoutée ou scannée). Pour Gmail : active la validation en deux étapes, puis
        crée un <b>mot de passe d'application</b> (Compte Google → Sécurité) ; ce n'est jamais le mot de passe du compte.
      </CardHelp>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, fontSize:13.5, color:"var(--text2)" }}>
          <span>Relever les mails automatiquement (toutes les {s.every_h} h)</span>{sw(s.enabled, () => save({ enabled: !s.enabled }))}</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:8 }}>
          <div><span style={lbl}>Serveur IMAP</span><input value={f.host} onChange={set("host")} placeholder="imap.gmail.com" style={inp}/></div>
          <div><span style={lbl}>Port</span><input value={f.port} onChange={set("port")} inputMode="numeric" style={inp}/></div>
          <div><span style={lbl}>Adresse mail</span><input value={f.user} onChange={set("user")} placeholder="toi@gmail.com" autoComplete="off" style={inp}/></div>
          <div><span style={lbl}>Mot de passe d'application {s.has_password ? "(enregistré, laisser vide pour garder)" : ""}</span>
            <input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" placeholder={s.has_password ? "••••••••" : "xxxx xxxx xxxx xxxx"} style={inp}/></div>
          <div><span style={lbl}>Dossier</span><input value={f.folder} onChange={set("folder")} placeholder="INBOX" style={inp}/></div>
          <div><span style={lbl}>Expéditeur contient</span><input value={f.sender} onChange={set("sender")} placeholder="bambulab" style={inp}/></div>
          <div><span style={lbl}>Remonter sur (jours)</span><input value={f.days} onChange={set("days")} inputMode="numeric" style={inp}/></div>
          <div><span style={lbl}>Relever toutes les (heures)</span><input value={f.every_h} onChange={set("every_h")} inputMode="numeric" style={inp}/></div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <button type="button" onClick={() => save()} disabled={busy} style={btn(false, busy)}>Enregistrer</button>
          <button type="button" onClick={() => sync(false)} disabled={busy || s.running} style={btn(true, busy || s.running)}>{s.running || busy ? "Relevé…" : "Relever maintenant"}</button>
          {s.has_password && <button type="button" onClick={() => save({ password: "-" })} disabled={busy} style={{ ...btn(false, busy), color:"#ef4444" }}>Oublier le mot de passe</button>}
        </div>
        {/* le rattrapage : relire les mails deja vus sur N jours (une commande connue est remise a jour, jamais doublee) */}
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:12.5, color:"var(--text2)" }}>
          <span>Rattraper le passé : relire les</span>
          <input value={back} onChange={e => setBack(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="Jours à relire"
            style={{ ...inp, width:70, padding:"6px 8px", textAlign:"center" }}/>
          <span>derniers jours, mails déjà vus compris</span>
          <button type="button" onClick={() => sync(true)} disabled={busy || s.running} style={btn(false, busy || s.running)}>Relire</button>
        </div>
        {last && <div style={{ padding:"8px 12px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)", fontSize:12, color:"var(--text2)", lineHeight:1.5 }}>
          Dernier relevé ({last.trigger}{last.days ? `, ${last.days} j` : ""}) : {when(last.at)} · {last.error ? <b style={{ color:"#ef4444" }}>{last.error}</b>
            : <>{last.mails} mail{last.mails > 1 ? "s" : ""} lu{last.mails > 1 ? "s" : ""}, {last.created} commande{last.created > 1 ? "s" : ""} nouvelle{last.created > 1 ? "s" : ""}, {last.updated} mise{last.updated > 1 ? "s" : ""} à jour{last.ignored ? `, ${last.ignored} mail${last.ignored > 1 ? "s" : ""} sans commande` : ""}{last.errors?.length ? ` · ${last.errors.length} erreur(s)` : ""}</>}
        </div>}
      </div>
    </div>
  );
}
