import React, { useEffect, useState } from "react";
import SwitchCard from "./SwitchCard";
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
  const [f, setF] = useState({ host:"", port:993, user:"", password:"", folder:"INBOX", senders:[], days:21, every_h:3 });
  const [newSender, setNewSender] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => client.get("/settings/mail").then(r => {
    setS(r.data);
    setF(x => ({ ...x, host: r.data.host, port: r.data.port, user: r.data.user, folder: r.data.folder, senders: r.data.senders || [],
      days: r.data.days, every_h: r.data.every_h }));
  }).catch(e => showAlert(e.response?.data?.detail || e.message));
  useEffect(() => { load(); }, []);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const addSender = () => { const a = newSender.trim().toLowerCase(); if (!a || !a.includes("@")) return;
    setF(x => ({ ...x, senders: x.senders.includes(a) ? x.senders : [...x.senders, a] })); setNewSender(""); };
  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const { data } = await client.put("/settings/mail", { ...f, port: Number(f.port) || 993, days: Math.min(21, Number(f.days) || 21),
        every_h: Number(f.every_h) || 3, password: f.password || null, ...extra });
      setS(data); setF(x => ({ ...x, password: "" }));
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const [back, setBack] = useState(21);   // jamais plus de 21 jours : au-dela, de vieilles commandes a confirmer
  const sync = async (reread = false) => {
    setBusy(true);
    try {
      await save();
      const { data } = await client.post("/settings/mail/sync", reread ? { days: Math.min(21, Number(back) || 21), reread: true } : {}, { timeout: 300000 });
      if (data.error) showAlert(data.error);
      await load();
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  if (!s) return <div className="card" style={card}><div style={cardTitle}>📬 Commandes Bambu Lab (mail)</div>
    <p style={{ fontSize:12.5, color:"var(--muted)", margin:0 }}>Chargement…</p></div>;
  const last = s.last;
  return (
    <SwitchCard card={card} cardTitle={cardTitle} title="📬 Commandes Bambu Lab (mail)" on={s.enabled} onToggle={() => save({ enabled: !s.enabled })}
      hint={s.enabled ? `toutes les ${s.every_h} h` : "relevé auto coupé"} helpTitle="Commandes Bambu Lab"
      help={<>La boutique n'a pas d'API : l'appli lit ta boîte mail et repère les mails de la boutique (commande confirmée,
        expédiée, livrée). Les bobines commandées apparaissent en <b>à venir</b> dans la page Filaments et dans les alertes,
        et s'effacent quand la bobine arrive (ajoutée ou scannée). L'interrupteur du titre active le relevé automatique.
        Pour Gmail : active la validation en deux étapes, puis crée un <b>mot de passe d'application</b> (Compte Google → Sécurité) ;
        ce n'est jamais le mot de passe du compte.</>}>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:8 }}>
          <div><span style={lbl}>Serveur IMAP</span><input value={f.host} onChange={set("host")} placeholder="imap.gmail.com" style={inp}/></div>
          <div><span style={lbl}>Port</span><input value={f.port} onChange={set("port")} inputMode="numeric" style={inp}/></div>
          <div><span style={lbl}>Adresse mail</span><input value={f.user} onChange={set("user")} placeholder="toi@gmail.com" autoComplete="off" style={inp}/></div>
          <div><span style={lbl}>Mot de passe d'application {s.has_password ? "(enregistré, laisser vide pour garder)" : ""}</span>
            <input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" placeholder={s.has_password ? "••••••••" : "xxxx xxxx xxxx xxxx"} style={inp}/></div>
          <div><span style={lbl}>Dossier</span><input value={f.folder} onChange={set("folder")} placeholder="INBOX" style={inp}/></div>
          <div style={{ gridColumn:"1 / -1" }}><span style={lbl}>Adresses d'expéditeur lues (tout le reste de la boîte est ignoré)</span>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
              {(f.senders || []).map(a => <span key={a} style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 10px", borderRadius:14, fontSize:12.5,
                background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}>{a}
                <button type="button" aria-label={`Retirer ${a}`} onClick={() => setF(x => ({ ...x, senders: x.senders.filter(y => y !== a) }))}
                  style={{ border:"none", background:"none", color:"var(--muted)", cursor:"pointer", padding:0, fontSize:13 }}>✕</button></span>)}
              <input value={newSender} onChange={e => setNewSender(e.target.value)} placeholder="noreply@notify-us.bambulab.com" autoComplete="off"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSender(); } }} style={{ ...inp, width:"auto", flex:1, minWidth:200 }}/>
              <button type="button" onClick={addSender} style={btn(false)}>Ajouter</button>
            </div></div>
          <div><span style={lbl}>Remonter sur (jours, 21 au plus)</span><input value={f.days} onChange={e => setF(x => ({ ...x, days: e.target.value === "" ? "" : Math.min(21, Number(e.target.value.replace(/\D/g, "")) || "") }))} inputMode="numeric" style={inp}/></div>
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
          <input value={back} onChange={e => { const v = e.target.value.replace(/\D/g, ""); setBack(v === "" ? "" : Math.min(21, Number(v))); }} inputMode="numeric" aria-label="Jours à relire"
            style={{ ...inp, width:70, padding:"6px 8px", textAlign:"center" }}/>
          <span>derniers jours (21 au plus), mails déjà vus compris</span>
          <button type="button" onClick={() => sync(true)} disabled={busy || s.running} style={btn(false, busy || s.running)}>Relire</button>
        </div>
        {last && <div style={{ padding:"8px 12px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)", fontSize:12, color:"var(--text2)", lineHeight:1.5 }}>
          Dernier relevé ({last.trigger}{last.days ? `, ${last.days} j` : ""}) : {when(last.at)} · {last.error ? <b style={{ color:"#ef4444" }}>{last.error}</b>
            : <>{last.mails} mail{last.mails > 1 ? "s" : ""} lu{last.mails > 1 ? "s" : ""}, {last.created} commande{last.created > 1 ? "s" : ""} nouvelle{last.created > 1 ? "s" : ""}, {last.updated} mise{last.updated > 1 ? "s" : ""} à jour{last.ignored ? `, ${last.ignored} mail${last.ignored > 1 ? "s" : ""} sans commande` : ""}{last.errors?.length ? ` · ${last.errors.length} erreur(s)` : ""}</>}
        </div>}
      </div>
    </SwitchCard>
  );
}
