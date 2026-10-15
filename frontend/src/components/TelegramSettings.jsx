import React, { useEffect, useState } from "react";
import client from "../api/client";
import { showAlert, showConfirm } from "../utils/dialog";

// Partage Telegram, en son nom : on relie son PROPRE compte (API utilisateur
// officielle), puis on choisit les discussions ou partager. La connexion se
// fait ici, une fois : numero, code recu dans Telegram, mot de passe 2FA.
const inp = { width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10,
  padding:"9px 12px", fontSize:13, color:"var(--text)", outline:"none", boxSizing:"border-box" };
const lbl = { display:"block", fontSize:11, fontWeight:600, color:"var(--muted)", marginBottom:4 };
const btn = (primary) => ({ padding:"9px 14px", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer",
  border: primary ? "none" : "1px solid var(--border)", background: primary ? "#3b82f6" : "var(--surface2)",
  color: primary ? "white" : "var(--text)" });
const errMsg = (e) => e.response?.data?.detail || e.message;

export default function TelegramSettings({ card, cardTitle }) {
  const [st, setSt] = useState(null);
  const [step, setStep] = useState("idle");      // idle | code | password
  const [f, setF] = useState({ api_id:"", api_hash:"", phone:"", code:"", password:"" });
  const [busy, setBusy] = useState(false);
  const [chats, setChats] = useState(null);      // liste pour ajouter une destination
  const [pick, setPick] = useState({ chat:"", topic:"", label:"" });

  const load = () => client.get("/share/telegram").then(r => {
    setSt(r.data); setF(x => ({ ...x, api_id: x.api_id || r.data.api_id || "" }));
  }).catch(e => setSt({ error: errMsg(e), destinations: [] }));
  useEffect(() => { load(); }, []);

  const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { showAlert(errMsg(e)); } setBusy(false); };
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));

  const start = () => run(async () => {
    await client.post("/share/telegram/login/start", { api_id: f.api_id, api_hash: f.api_hash, phone: f.phone });
    setStep("code");
  });
  const sendCode = () => run(async () => {
    const { data } = await client.post("/share/telegram/login/code", { code: f.code });
    if (data.step === "password") setStep("password"); else { setStep("idle"); load(); }
  });
  const sendPassword = () => run(async () => {
    await client.post("/share/telegram/login/password", { password: f.password });
    setF(x => ({ ...x, password:"", code:"", api_hash:"" })); setStep("idle"); load();
  });
  const logout = () => run(async () => {
    if (!(await showConfirm("Déconnecter le compte Telegram ? La session sera révoquée côté Telegram.",
      { confirmLabel: "Déconnecter" }))) return;
    await client.post("/share/telegram/logout"); load();
  });

  const saveDest = (list) => run(async () => {
    const { data } = await client.put("/share/telegram/destinations", list);
    setSt(s => ({ ...s, destinations: data }));
  });
  const openAdd = () => run(async () => {
    const { data } = await client.get("/share/telegram/chats");
    setChats(data); setPick({ chat:"", topic:"", label:"" });
  });
  const chat = chats?.[+pick.chat];
  const topic = chat?.topics.find(t => String(t.id) === pick.topic);
  const add = () => {
    if (!chat) return;
    const label = pick.label.trim() || (topic ? `${chat.title} · ${topic.title}` : chat.title);
    saveDest([...(st.destinations || []), { label, chat_title: chat.title, peer: chat.peer,
      topic_id: topic?.id || null, topic_title: topic?.title || null }]);
    setChats(null);
  };

  if (!st) return null;
  return (
    <div className="card" style={card}>
      <div style={cardTitle}>Partage Telegram</div>
      <p style={{ fontSize:12.5, color:"var(--muted)", margin:"0 0 12px", lineHeight:1.5 }}>
        Publie une impression ou un groupe (photos, statistiques, lien MakerWorld) dans tes
        discussions Telegram, <b>en ton nom</b>.
      </p>

      {st.connected ? (
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <span style={{ fontSize:13, color:"#22c55e", fontWeight:700 }}>● Connecté</span>
          <span style={{ fontSize:13, color:"var(--text)", flex:1, minWidth:0 }}>
            {st.me?.name}{st.me?.username ? ` (@${st.me.username})` : ""}
          </span>
          <button type="button" onClick={logout} disabled={busy} style={btn(false)}>Déconnecter</button>
        </div>
      ) : step === "idle" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {st.error && <p style={{ fontSize:12, color:"#f59e0b", margin:0 }}>{st.error}</p>}
          <p style={{ fontSize:12, color:"var(--muted)", margin:0, lineHeight:1.5 }}>
            1. Sur <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">my.telegram.org/apps</a>,
            crée une application (nom libre) et recopie son <b>api_id</b> et son <b>api_hash</b>.
            2. Saisis ton numéro : Telegram t'enverra un code.
          </p>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <div style={{ flex:"1 1 120px" }}><label style={lbl}>api_id</label>
              <input value={f.api_id} onChange={set("api_id")} inputMode="numeric" style={inp}/></div>
            <div style={{ flex:"2 1 200px" }}><label style={lbl}>api_hash</label>
              <input value={f.api_hash} onChange={set("api_hash")} type="password" autoComplete="off" style={inp}/></div>
          </div>
          <div><label style={lbl}>Numéro (format international)</label>
            <input value={f.phone} onChange={set("phone")} placeholder="+33 6…" inputMode="tel" style={inp}/></div>
          <div><button type="button" onClick={start} disabled={busy || !f.api_id || !f.api_hash || !f.phone}
            style={btn(true)}>{busy ? "Envoi…" : "Recevoir le code"}</button></div>
        </div>
      ) : step === "code" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <label style={lbl}>Code reçu dans Telegram</label>
          <input value={f.code} onChange={set("code")} inputMode="numeric" autoFocus style={inp}/>
          <div style={{ display:"flex", gap:8 }}>
            <button type="button" onClick={() => setStep("idle")} style={btn(false)}>Annuler</button>
            <button type="button" onClick={sendCode} disabled={busy || !f.code} style={btn(true)}>Valider</button>
          </div>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <label style={lbl}>Mot de passe Telegram (validation en deux étapes)</label>
          <input value={f.password} onChange={set("password")} type="password" autoFocus style={inp}/>
          <div style={{ display:"flex", gap:8 }}>
            <button type="button" onClick={() => setStep("idle")} style={btn(false)}>Annuler</button>
            <button type="button" onClick={sendPassword} disabled={busy || !f.password} style={btn(true)}>Valider</button>
          </div>
        </div>
      )}

      {st.connected && (<>
        <div style={{ ...lbl, marginTop:4 }}>Destinations</div>
        {(st.destinations || []).length === 0 && (
          <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 8px" }}>Aucune destination pour l'instant.</p>
        )}
        {(st.destinations || []).map((d, i) => (
          <div key={d.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", marginBottom:6,
            borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:600, color:"var(--text)" }}>{d.label}</div>
              <div style={{ fontSize:11, color:"var(--muted)" }}>
                {d.chat_title}{d.topic_title ? ` › ${d.topic_title}` : ""}
              </div>
            </div>
            <button type="button" title="Retirer" disabled={busy}
              onClick={() => saveDest(st.destinations.filter((_, j) => j !== i))}
              style={{ ...btn(false), padding:"5px 10px", color:"#ef4444" }}>✕</button>
          </div>
        ))}

        {chats ? (
          <div style={{ display:"flex", flexDirection:"column", gap:8, padding:10, borderRadius:10,
            border:"1px dashed var(--border)" }}>
            <div><label style={lbl}>Discussion</label>
              <select value={pick.chat} onChange={e => setPick({ chat:e.target.value, topic:"", label:"" })} style={inp}>
                <option value="">— Choisir —</option>
                {chats.map((c, i) => <option key={i} value={i}>{c.title} ({c.kind})</option>)}
              </select></div>
            {chat?.topics.length > 0 && (
              <div><label style={lbl}>Sujet</label>
                <select value={pick.topic} onChange={e => setPick(p => ({ ...p, topic:e.target.value }))} style={inp}>
                  <option value="">Général</option>
                  {chat.topics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select></div>
            )}
            {chat && (
              <div><label style={lbl}>Nom affiché dans le menu (facultatif)</label>
                <input value={pick.label} onChange={e => setPick(p => ({ ...p, label:e.target.value }))}
                  placeholder={topic ? `${chat.title} · ${topic.title}` : chat.title} style={inp}/></div>
            )}
            <div style={{ display:"flex", gap:8 }}>
              <button type="button" onClick={() => setChats(null)} style={btn(false)}>Annuler</button>
              <button type="button" onClick={add} disabled={!chat || busy} style={btn(true)}>Ajouter</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={openAdd} disabled={busy} style={{ ...btn(false), width:"100%" }}>
            {busy ? "Chargement des discussions…" : "+ Ajouter une destination"}
          </button>
        )}
      </>)}
    </div>
  );
}
