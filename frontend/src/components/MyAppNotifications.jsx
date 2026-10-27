import React, { useEffect, useState } from "react";
import CardHelp from "./CardHelp";
import client from "../api/client";
import { pushApi, readPushStatus, sendEndpoint } from "./PushBridge";

// Mes notifications sur l'appli Android : chaque compte de la maison inscrit
// SES telephones et choisit, type par type, ce qu'il y recoit. ntfy et
// Telegram, eux, restent communs et regles par l'administrateur.
const OPEN_KEY = "myNotifOpen";

export default function MyAppNotifications({ embedded = false }) {
  const [me, setMe] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [push, setPush] = useState(() => readPushStatus());
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}") || {}; } catch { return {}; }
  });
  const toggle = id => setOpen(o => {
    const n = { ...o, [id]: !o[id] };
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* indisponible */ }
    return n;
  });

  const load = () => client.get("/notify/me").then(({ data }) => setMe(data)).catch(e => setErr(e.response?.data?.detail || e.message));
  useEffect(() => {
    load();
    const re = () => { setPush(readPushStatus()); load(); };
    window.addEventListener("bambu-push", re);
    window.addEventListener("bambu-push-synced", re);
    return () => { window.removeEventListener("bambu-push", re); window.removeEventListener("bambu-push-synced", re); };
  }, []);

  const run = async (key, fn, ok) => {
    setBusy(key); setMsg(null);
    try { const t = await fn(); const text = typeof t === "string" ? t : ok; if (text) setMsg({ ok: true, text }); }
    catch (e) { setMsg({ ok: false, text: e.response?.data?.detail || e.message }); }
    setBusy("");
  };
  const setEvents = patch => run("ev", async () => { setMe((await client.put("/notify/me/events", patch)).data); });
  const register = () => run("reg", async () => {
    const st = readPushStatus();
    if (st?.endpoint) { await sendEndpoint(st.endpoint, true); await load(); return "Ce téléphone est inscrit."; }
    pushApi().pushRegister();
    return "Choisis ntfy si Android le demande…";
  });
  const remove = id => run("dev", async () => { await client.delete(`/notify/devices/${id}`); await load(); });
  const test = d => run("dev", () => client.post("/notify/me/test", { device: d.id }), `Envoyé sur « ${d.name || "ce téléphone"} ».`);

  if (err) return <div className="card" style={{ padding:"16px 20px", color:"#ef4444", fontSize:13 }}>{err}</div>;
  if (!me) return <div className="card" style={{ padding:"16px 20px" }}>…</div>;

  const btn = { padding:"6px 11px", borderRadius:9, fontSize:12, fontWeight:600, cursor:"pointer",
    background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" };
  const primary = { ...btn, background:"#3b82f6", border:"none", color:"white", fontWeight:700 };

  return (<>
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>
        {embedded ? "Mon téléphone" : "Mes notifications"}</h3>
      <CardHelp title={embedded ? "Mon téléphone" : "Mes notifications"}>
        Active ce que tu veux recevoir sur ton téléphone (appli Android BambuNymous, avec l'appli <b>ntfy</b>). Tu les retrouves aussi dans la 🔔 cloche, lues dès que tu les touches.
        Les autres comptes ont leurs propres choix.
      </CardHelp>
      {!me.app_on && (
        <p style={{ fontSize:12, color:"#f59e0b", margin:"0 0 10px" }}>
          L'administrateur n'a pas activé l'appli Android : rien ne partira sur le téléphone pour l'instant.</p>
      )}
      {push ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:12, color:"var(--text2)", marginBottom:8 }}>
          Ce téléphone : {push.endpoint ? <b style={{ color:"#22c55e" }}>inscrit</b>
            : !(push.distributors || []).length ? <span style={{ color:"#f59e0b" }}>installe l'appli ntfy d'abord</span>
            : <span style={{ color:"var(--muted)" }}>pas encore inscrit</span>}
          {(push.distributors || []).length > 0 && (
            <button onClick={register} disabled={busy === "reg"} style={push.endpoint ? btn : primary}>
              {push.endpoint ? "Réinscrire" : "Activer sur ce téléphone"}</button>
          )}
        </div>
      ) : (
        <p style={{ fontSize:11.5, color:"var(--muted)", margin:"0 0 8px" }}>
          Pour inscrire un téléphone, ouvre cette page dans l'appli Android BambuNymous.</p>
      )}
      {me.devices.map(d => (
        <div key={d.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderTop:"1px solid var(--border)", fontSize:12.5 }}>
          <span style={{ flex:1, minWidth:0 }}>
            <span style={{ fontWeight:700, color:"var(--text)" }}>📱 {d.name || "Téléphone"}</span>
            <span style={{ display:"block", fontSize:11, color: d.last_err ? "#ef4444" : "var(--muted)" }}>
              {d.last_err ? `Échec ${d.last_err}` : d.last_ok ? `Dernier envoi : ${new Date(d.last_ok).toLocaleString("fr-FR")}`
                : `Inscrit le ${new Date(d.added).toLocaleDateString("fr-FR")}`}</span>
          </span>
          <button onClick={() => test(d)} disabled={busy === "dev"} style={btn}>Tester</button>
          <button onClick={() => remove(d.id)} disabled={busy === "dev"} style={{ ...btn, color:"var(--muted)" }} aria-label="Retirer">✕</button>
        </div>
      ))}
      {msg && <p style={{ fontSize:12, margin:"8px 0 0", color: msg.ok ? "#22c55e" : "#ef4444" }}>{msg.text}</p>}
    </div>

    {me.sections.map(sec => {
      const evs = me.events.filter(e => e.section === sec.id);
      if (!evs.length) return null;
      const n = evs.filter(e => e.app).length;
      // etat d'un canal sur la section : tout / rien / melange
      const all = c => evs.every(e => e[c]) ? true : evs.some(e => e[c]) ? null : false;
      const isOpen = !!open[sec.id];
      return (
        <div key={sec.id} className="card" style={{ padding:0, overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 20px" }}>
            <button onClick={() => toggle(sec.id)} aria-expanded={isOpen}
              style={{ flex:1, display:"flex", alignItems:"center", gap:10, background:"none", border:"none", cursor:"pointer",
                textAlign:"left", color:"var(--text)", padding:0 }}>
              <span style={{ fontSize:11, color:"var(--muted)", transform: isOpen ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span>
              <span style={{ fontSize:14, fontWeight:700 }}>{sec.label}</span>
              <span style={{ fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, marginLeft:"auto",
                color: n ? "#22c55e" : "var(--muted)", background: n ? "rgba(34,197,94,0.12)" : "var(--surface2)" }}>{n}/{evs.length}</span>
            </button>
            <Switch on={all("app") === true} partial={all("app") === null} disabled={busy === "ev"}
              onChange={v => setEvents({ [`section:${sec.id}`]: { app: v } })}/>
          </div>
          {isOpen && (
            <div style={{ padding:"0 20px 10px" }}>
              {evs.map(e => (
                <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderTop:"1px solid var(--border)" }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"var(--text)" }}>{e.label}</div>
                    <div style={{ fontSize:11.5, color:"var(--muted)", marginTop:2 }}>{e.description}</div>
                  </div>
                  <Switch on={!!e.app} disabled={busy === "ev"} onChange={v => setEvents({ [e.id]: { app: v } })}/>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    })}
  </>);
}

// Deux canaux independants par type : le journal (la cloche) et le telephone
// (appli Android). Vrai : actif ; null (en tete de section) : melange.
function Switch({ on, partial, onChange, disabled }) {
  return (
    <button onClick={() => onChange(!on)} disabled={disabled} aria-pressed={on}
      style={{ flexShrink:0, width:42, height:24, borderRadius:12, border:"none", cursor:"pointer", position:"relative",
        background: on ? "#22c55e" : partial ? "rgba(34,197,94,0.45)" : "var(--border)", transition:"background .2s" }}>
      <span style={{ position:"absolute", top:3, left: on ? 21 : 3, width:18, height:18, borderRadius:"50%",
        background:"white", transition:"left .2s" }}/>
    </button>
  );
}
