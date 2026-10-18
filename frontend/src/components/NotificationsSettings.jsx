import React, { useEffect, useState } from "react";
import client from "../api/client";
import { CreatorPicker } from "./MakerWorldView";
import MwImg from "./MwImg";

// Parametres > Notifications : le canal (ntfy) puis les types de
// notification, chacun avec son interrupteur, ses reglages et un « Envoyer
// test ». Le jeton ntfy est saisi ici et n'est jamais reaffiche.
export default function NotificationsSettings() {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({ url: "", topic: "" });
  const [tokEdit, setTokEdit] = useState(null);       // null = ferme, sinon saisie
  const [msg, setMsg] = useState({});                 // { [cle]: { ok, text } }
  const [busy, setBusy] = useState("");
  const [creators, setCreators] = useState(null);     // createurs suivis (MakerWorld)
  const [picker, setPicker] = useState(false);

  const apply = c => { setCfg(c); setForm({ url: c.ntfy.url, topic: c.ntfy.topic }); };
  useEffect(() => { client.get("/notify").then(({ data }) => apply(data)).catch(e => setMsg({ ntfy: { ok: false, text: e.message } })); }, []);
  // Les etiquettes des createurs choisis : noms et avatars lus dans la liste
  // des suivis (en cache cote serveur), seulement s'il y en a de choisis.
  const hasPicked = !!cfg?.events.some(ev => ev.creators?.length);
  useEffect(() => {
    if (hasPicked && !creators) client.get("/makerworld/following/creators")
      .then(({ data }) => setCreators(data.creators || [])).catch(() => setCreators([]));
  }, [hasPicked]);

  const run = async (key, fn, okText) => {
    setBusy(key); setMsg(m => ({ ...m, [key]: null }));
    try { await fn(); if (okText) setMsg(m => ({ ...m, [key]: { ok: true, text: okText } })); }
    catch (e) { setMsg(m => ({ ...m, [key]: { ok: false, text: e.response?.data?.detail || e.message } })); }
    setBusy("");
  };
  const saveNtfy = (token) => run("ntfy", async () => {
    const { data } = await client.put("/notify/ntfy", { ...form, ...(token !== undefined ? { token } : {}) });
    apply(data); setTokEdit(null);
  }, "Enregistré.");
  const test = (event) => run(event || "ntfy", () => client.post("/notify/test", { event }), "Envoyé : regarde ntfy.");
  const setEvent = (id, patch) => run(id, async () => {
    const { data } = await client.put(`/notify/events/${id}`, patch); setCfg(data);
  });
  const openPicker = () => run("mw_new_model", async () => {
    if (!creators) setCreators((await client.get("/makerworld/following/creators")).data.creators || []);
    setPicker(true);
  });

  if (!cfg) return <div className="card" style={{ padding:"16px 20px" }}>…</div>;
  const inp = { width:"100%", boxSizing:"border-box", padding:"8px 10px", borderRadius:8, fontSize:13,
    background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" };
  const btn = { padding:"7px 12px", borderRadius:9, fontSize:12, fontWeight:600, cursor:"pointer",
    background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" };
  const primary = { ...btn, background:"#3b82f6", border:"none", color:"white", fontWeight:700 };
  const Msg = ({ k }) => msg[k] ? <p style={{ fontSize:12, margin:"8px 0 0", color: msg[k].ok ? "#22c55e" : "#ef4444" }}>{msg[k].text}</p> : null;
  const noFill = { autoComplete: "off", "data-lpignore": "true", "data-1p-ignore": "true", "data-bwignore": "true" };
  const canSend = !!cfg.ntfy.topic;

  return (<>
    {/* ── Canal ── */}
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>Canal : ntfy</h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 12px", lineHeight:1.5 }}>
        Les notifications partent sur ton sujet ntfy (serveur public ntfy.sh ou le tien). Abonne-toi au même
        sujet dans l'appli ntfy du téléphone.
      </p>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <label style={{ fontSize:11, color:"var(--muted)" }}>Serveur
          <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://ntfy.sh"
            {...noFill} style={{ ...inp, marginTop:3 }}/></label>
        <label style={{ fontSize:11, color:"var(--muted)" }}>Sujet
          <input value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))} placeholder="mon-sujet-bambu"
            {...noFill} style={{ ...inp, marginTop:3 }}/></label>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:12, color:"var(--text2)" }}>
          Jeton d'accès {cfg.ntfy.has_token ? <b style={{ color:"#22c55e" }}>posé</b> : <span style={{ color:"var(--muted)" }}>— facultatif</span>}
          {tokEdit === null ? (<>
            <button onClick={() => setTokEdit("")} style={{ ...btn, padding:"4px 10px" }}>{cfg.ntfy.has_token ? "Changer" : "Ajouter"}</button>
            {cfg.ntfy.has_token && <button onClick={() => saveNtfy("")} style={{ ...btn, padding:"4px 10px", color:"var(--muted)" }}>Retirer</button>}
          </>) : (
            <span style={{ display:"flex", gap:6, flex:"1 1 100%" }}>
              <input value={tokEdit} onChange={e => setTokEdit(e.target.value)} placeholder="tk_…" autoFocus {...noFill}
                style={{ ...inp, flex:1, fontFamily:"JetBrains Mono,monospace", fontSize:12 }}/>
              <button onClick={() => setTokEdit(null)} style={btn}>✕</button>
              <button onClick={() => saveNtfy(tokEdit.trim())} disabled={!tokEdit.trim()} style={primary}>OK</button>
            </span>
          )}
        </div>
        <div style={{ display:"flex", gap:8, marginTop:4 }}>
          <button onClick={() => saveNtfy()} disabled={busy === "ntfy"} style={primary}>Enregistrer</button>
          <button onClick={() => test("")} disabled={busy === "ntfy" || !canSend} style={btn}
            title={canSend ? "" : "Renseigne et enregistre d'abord un sujet"}>Envoyer un test</button>
        </div>
        <Msg k="ntfy"/>
      </div>
    </div>

    {/* ── Types de notification ── */}
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 10px" }}>Notifications</h3>
      {cfg.events.map(ev => (
        <div key={ev.id} style={{ padding:"10px 0", borderTop:"1px solid var(--border)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"var(--text)" }}>{ev.label}</div>
              <div style={{ fontSize:11.5, color:"var(--muted)", marginTop:2 }}>{ev.description}</div>
            </div>
            <Switch on={ev.enabled} onChange={v => setEvent(ev.id, { enabled: v })} disabled={busy === ev.id}/>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, flexWrap:"wrap" }}>
            {ev.id === "mw_new_model" && (
              <button onClick={openPicker} disabled={busy === ev.id} style={btn}>
                👤 {ev.creators.length ? "Modifier" : "Choisir les créateurs"}
              </button>
            )}
            <button onClick={() => test(ev.id)} disabled={busy === ev.id || !canSend} style={btn}>Envoyer test</button>
          </div>
          {ev.id === "mw_new_model" && ev.creators.length > 0 && (
            <CreatorTags uids={ev.creators} creators={creators} disabled={busy === ev.id}
              onRemove={uid => setEvent(ev.id, { creators: ev.creators.filter(u => u !== uid) })}/>
          )}
          {ev.id === "mw_new_model" && ev.enabled && !ev.creators.length && (
            <p style={{ fontSize:11.5, color:"#f59e0b", margin:"6px 0 0" }}>Aucun créateur choisi : rien ne sera envoyé.</p>
          )}
          <Msg k={ev.id}/>
          {ev.id === "mw_new_model" && picker && creators && (
            <CreatorPicker creators={creators} picked={ev.creators}
              applyLabel={n => n ? `Me notifier pour ${n} créateur${n > 1 ? "s" : ""}` : "Aucun créateur"}
              onClose={() => setPicker(false)}
              onApply={ids => { setPicker(false); setEvent(ev.id, { creators: ids }); }}/>
          )}
        </div>
      ))}
    </div>
  </>);
}

// Une etiquette par createur choisi (avatar + nom, ✕ pour le retirer). Un
// createur qui n'est plus suivi garde son etiquette, marquee comme telle.
function CreatorTags({ uids, creators, disabled, onRemove }) {
  const byUid = new Map((creators || []).map(c => [c.uid, c]));
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:8 }}>
      {uids.map(uid => {
        const c = byUid.get(uid);
        const label = c ? (c.name || c.handle || `#${uid}`) : creators ? `#${uid} (plus suivi)` : "…";
        return (
          <span key={uid} title={c?.handle ? `@${c.handle}` : ""} style={{ display:"inline-flex", alignItems:"center", gap:6,
            maxWidth:"100%", padding:"3px 4px 3px 4px", borderRadius:999, fontSize:12, color:"var(--text)",
            background:"rgba(59,130,246,0.10)", border:"1px solid rgba(59,130,246,0.25)" }}>
            {c?.avatar ? <MwImg src={c.avatar} w={48} style={{ width:20, height:20, borderRadius:"50%", flexShrink:0 }}/>
              : <span style={{ width:20, height:20, borderRadius:"50%", background:"var(--surface2)", flexShrink:0 }}/>}
            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color: c ? "var(--text)" : "var(--muted)" }}>{label}</span>
            <button onClick={() => onRemove(uid)} disabled={disabled} aria-label={`Retirer ${label}`}
              style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:12, padding:"0 4px", lineHeight:1 }}>✕</button>
          </span>
        );
      })}
    </div>
  );
}

function Switch({ on, onChange, disabled }) {
  return (
    <button onClick={() => onChange(!on)} disabled={disabled} aria-pressed={on}
      style={{ flexShrink:0, width:42, height:24, borderRadius:12, border:"none", cursor:"pointer", position:"relative",
        background: on ? "#22c55e" : "var(--border)", transition:"background .2s" }}>
      <span style={{ position:"absolute", top:3, left: on ? 21 : 3, width:18, height:18, borderRadius:"50%",
        background:"white", transition:"left .2s" }}/>
    </button>
  );
}
