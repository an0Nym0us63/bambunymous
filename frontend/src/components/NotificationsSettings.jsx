import React, { useEffect, useState } from "react";
import client from "../api/client";
import { CreatorPicker } from "./MakerWorldView";
import MwImg from "./MwImg";
import { pushApi, readPushStatus, sendEndpoint } from "./PushBridge";
import MyAppNotifications from "./MyAppNotifications";

// Parametres > Notifications : le canal (ntfy, bot Telegram ou les deux), ses
// sujets ntfy et ses discussions Telegram (le premier de chaque liste est celui
// par defaut), puis les types de notification rangés par section repliable ;
// chaque section choisit son sujet et sa discussion. Les jetons sont saisis
// ici et ne sont jamais reaffiches.
const OPEN_KEY = "notifOpenSections";

export default function NotificationsSettings() {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({ url: "", app_url: "", topics: [] });
  const [chats, setChats] = useState([]);             // discussions Telegram en edition
  const [tokEdit, setTokEdit] = useState(null);       // null = ferme, sinon saisie
  const [botTok, setBotTok] = useState(null);         // jeton du bot Telegram en saisie (jamais reaffiche)
  const [chatAdd, setChatAdd] = useState(null);       // discussion saisie a la main
  const [msg, setMsg] = useState({});                 // { [cle]: { ok, text } }
  const [busy, setBusy] = useState("");
  const [creators, setCreators] = useState(null);     // createurs suivis (MakerWorld)
  const [picker, setPicker] = useState(false);
  // Sections ouvertes (ce navigateur) : repliees par defaut, l'en-tete resume.
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}") || {}; } catch { return {}; }
  });
  // Onglet du canal affiche (ce navigateur)
  const [chTab, setChTabState] = useState(() => {
    try { return localStorage.getItem("notifChannelTab") || "journal"; } catch { return "journal"; }
  });
  const setChTab = t => { setChTabState(t); try { localStorage.setItem("notifChannelTab", t); } catch { /* indisponible */ } };
  const toggle = id => setOpen(o => {
    const n = { ...o, [id]: !o[id] };
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* indisponible */ }
    return n;
  });

  const apply = c => {
    setCfg(c);
    setForm({ url: c.ntfy.url, app_url: c.ntfy.app_url || "",
      topics: (c.ntfy.topics || []).map(t => ({ topic: t.topic, label: t.label || "", icon: t.icon || "" })) });
    setChats((c.tgbot.chats || []).map(x => ({ chat_id: x.chat_id, label: x.label || "" })));
  };
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
    // fn peut rendre un texte a afficher (sinon okText) ; tout autre retour
    // (reponse axios des essais…) est ignore : un objet rendu tel quel fait
    // planter React (erreur 31).
    try {
      const t = await fn();
      const text = typeof t === "string" ? t : okText;
      if (text) setMsg(m => ({ ...m, [key]: { ok: true, text } }));
    }
    catch (e) { setMsg(m => ({ ...m, [key]: { ok: false, text: e.response?.data?.detail || e.message } })); }
    setBusy("");
  };
  const saveNtfy = (token) => run("ntfy", async () => {
    const topics = form.topics.map(t => ({ ...t, topic: t.topic.trim() })).filter(t => t.topic);
    const { data } = await client.put("/notify/ntfy", { url: form.url, app_url: form.app_url, topics,
      ...(token !== undefined ? { token } : {}) });
    apply(data); setTokEdit(null);
  }, "Enregistré.");
  const KIND_FR = { ntfy: "ntfy", telegram: "Telegram", app: "l'appli Android" };
  const where = () => {
    const l = Object.keys(KIND_FR).filter(k => cfg?.channels?.[k]).map(k => KIND_FR[k]);
    return l.length > 1 ? `${l.slice(0, -1).join(", ")} et ${l[l.length - 1]}` : l[0] || "aucun canal";
  };
  // Appli Android : etat lu dans le shell natif (absent dans un navigateur)
  const [push, setPush] = useState(() => readPushStatus());
  useEffect(() => {
    const re = () => { setPush(readPushStatus()); client.get("/notify").then(({ data }) => setCfg(data)).catch(() => {}); };
    window.addEventListener("bambu-push", re);
    window.addEventListener("bambu-push-synced", re);
    return () => { window.removeEventListener("bambu-push", re); window.removeEventListener("bambu-push-synced", re); };
  }, []);
  const pushRegister = () => run("app", async () => {
    const st = readPushStatus();
    if (st?.endpoint) { await sendEndpoint(st.endpoint, true); return "Ce téléphone est inscrit."; }
    pushApi().pushRegister();
    return "Choisis ntfy si Android le demande…";
  });
  const removeDevice = (id) => run("app", async () => { apply((await client.delete(`/notify/devices/${id}`)).data); });
  const setJournal = (body, key = "journal") => run(key, async () => { apply((await client.put("/notify/journal", body)).data); });
  const setKind = (kind, on) => run(`ch_${kind}`, async () => { apply((await client.put("/notify/channels", { [kind]: on })).data); });
  const test = (event) => run(event || "ntfy", () => client.post("/notify/test", { event }), `Envoyé : regarde ${where()}.`);
  const testTo = (key, body, name) => run(key, () => client.post("/notify/test", body), `Envoyé sur « ${name} ».`);
  const saveBot = (body, ok = "Enregistré.") => run("tgbot", async () => {
    apply((await client.put("/notify/tgbot", body)).data); setBotTok(null); setChatAdd(null);
  }, ok);
  const saveChats = (list) => saveBot({ chats: list.map(c => ({ ...c, chat_id: c.chat_id.trim() })).filter(c => c.chat_id) });
  const detectChat = () => run("tgbot", async () => {
    const { data } = await client.post("/notify/tgbot/detect"); apply(data);
    return `${data.found} discussion${data.found > 1 ? "s" : ""} vue${data.found > 1 ? "s" : ""} : les nouvelles sont ajoutées.`;
  });
  const setRoute = (sec, patch) => run(`route_${sec}`, async () => { apply((await client.put(`/notify/sections/${sec}`, patch)).data); });
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
  const small = { ...btn, padding:"4px 9px", fontSize:11.5 };
  const primary = { ...btn, background:"#3b82f6", border:"none", color:"white", fontWeight:700 };
  const Msg = ({ k }) => msg[k] ? <p style={{ fontSize:12, margin:"8px 0 0", color: msg[k].ok ? "#22c55e" : "#ef4444" }}>{msg[k].text}</p> : null;
  const noFill = { autoComplete: "off", "data-lpignore": "true", "data-1p-ignore": "true", "data-bwignore": "true" };
  const on = cfg.channels || {};
  const savedTopics = cfg.ntfy.topics || [];
  const savedChats = cfg.tgbot.chats || [];
  const botReady = cfg.tgbot?.has_token && savedChats.length > 0;
  const devices = cfg.devices || [];
  const canSend = (on.ntfy && savedTopics.length > 0) || (on.telegram && botReady) || (on.app && devices.length > 0);
  // Carte d'un canal : interrupteur en tete ; reglages seulement s'il est active.
  // (Fonction et non composant : un composant defini ici serait recree a chaque
  // rendu et ferait perdre le focus des champs.)
  const channelCard = (kind, title, intro, body) => (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px", display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ flex:1 }}>{title}</span>
        <span style={{ fontSize:11, fontWeight:700, color: on[kind] ? "#22c55e" : "var(--muted)" }}>{on[kind] ? "activé" : "désactivé"}</span>
        <Switch on={!!on[kind]} onChange={v => setKind(kind, v)} disabled={busy === `ch_${kind}`}/>
      </h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin: on[kind] ? "0 0 12px" : 0, lineHeight:1.5 }}>{intro}</p>
      {on[kind] && body}
      <Msg k={`ch_${kind}`}/>
    </div>
  );
  const topicName = t => t.label || t.topic;
  const chatName = c => c.label || c.chat_id;
  const setTopic = (i, patch) => setForm(f => ({ ...f, topics: f.topics.map((t, j) => j === i ? { ...t, ...patch } : t) }));
  const moveFirst = (list, i) => [list[i], ...list.filter((_, j) => j !== i)];
  const Default = () => <span style={{ fontSize:10, fontWeight:800, color:"#3b82f6", background:"rgba(59,130,246,0.12)",
    padding:"2px 7px", borderRadius:20, whiteSpace:"nowrap" }}>par défaut</span>;

  return (<>
    {/* ── Canaux : un onglet chacun, chacun active ou non ── */}
    <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:12, padding:4, border:"1px solid var(--border)" }}>
      {[["journal", "Journal"], ["app", "Appli Android"], ["ntfy", "ntfy"], ["telegram", "Telegram"]].map(([k, l]) => (
        <button key={k} onClick={() => setChTab(k)} style={{ flex:1, padding:"8px 10px", borderRadius:8, fontSize:12.5,
          fontWeight:700, cursor:"pointer", border:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:6,
          background: chTab === k ? "#3b82f6" : "transparent", color: chTab === k ? "white" : "var(--muted)" }}>
          <span title={on[k] ? "activé" : "désactivé"} style={{ width:8, height:8, borderRadius:"50%", flexShrink:0,
            background: on[k] ? "#22c55e" : chTab === k ? "rgba(255,255,255,0.45)" : "var(--border)" }}/>
          {l}
        </button>
      ))}
    </div>
    {chTab === "ntfy" && channelCard("ntfy", "ntfy", <>
        Les notifications partent sur tes sujets ntfy (serveur public ntfy.sh ou le tien). Abonne-toi aux mêmes sujets
        dans l'appli ntfy du téléphone. Plusieurs sujets : chaque section choisit le sien plus bas. L'icône d'un sujet
        (adresse d'une image) accompagne chacune de ses notifications sur Android.</>, <>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <label style={{ fontSize:11, color:"var(--muted)" }}>Serveur
          <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://ntfy.sh"
            {...noFill} style={{ ...inp, marginTop:3 }}/></label>
        <div style={{ fontSize:11, color:"var(--muted)" }}>Sujets</div>
        {form.topics.map((t, i) => (
          <div key={i} style={{ display:"flex", flexDirection:"column", gap:5, padding:8, borderRadius:10,
            border:"1px solid var(--border)", background:"var(--surface)" }}>
            <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
              {t.icon ? <img src={t.icon} alt="" style={{ width:24, height:24, borderRadius:6, objectFit:"cover", flexShrink:0 }}
                onError={e => { e.currentTarget.style.visibility = "hidden"; }}/> : null}
              <input value={t.topic} onChange={e => setTopic(i, { topic: e.target.value })} placeholder="mon-sujet-bambu"
                {...noFill} style={{ ...inp, flex:"1 1 130px", padding:"6px 9px", fontFamily:"JetBrains Mono,monospace", fontSize:12 }}/>
              <input value={t.label} onChange={e => setTopic(i, { label: e.target.value })} placeholder="Nom (facultatif)"
                {...noFill} style={{ ...inp, flex:"1 1 110px", padding:"6px 9px", fontSize:12.5 }}/>
            </div>
            <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
              <input value={t.icon} onChange={e => setTopic(i, { icon: e.target.value })} placeholder="Icône : https://…/image.png (facultatif)"
                {...noFill} style={{ ...inp, flex:"1 1 180px", padding:"6px 9px", fontSize:12 }}/>
              {i === 0 ? <Default/> : <button onClick={() => setForm(f => ({ ...f, topics: moveFirst(f.topics, i) }))} style={small}
                title="En faire le sujet par défaut">★</button>}
              <button onClick={() => testTo("ntfy", { topic: t.topic.trim() }, topicName(t))} style={small}
                disabled={busy === "ntfy" || !savedTopics.some(x => x.topic === t.topic.trim())}
                title="Enregistre d'abord un nouveau sujet">Tester</button>
              <button onClick={() => setForm(f => ({ ...f, topics: f.topics.filter((_, j) => j !== i) }))}
                style={{ ...small, color:"var(--muted)" }} aria-label="Retirer">✕</button>
            </div>
          </div>
        ))}
        <button onClick={() => setForm(f => ({ ...f, topics: [...f.topics, { topic: "", label: "", icon: "" }] }))}
          style={{ ...btn, alignSelf:"flex-start" }}>+ Ajouter un sujet</button>
        <label style={{ fontSize:11, color:"var(--muted)" }}>Adresse de BambuNymous vue du téléphone
          <input value={form.app_url} onChange={e => setForm(f => ({ ...f, app_url: e.target.value }))}
            placeholder="https://bambu.mon-domaine.fr" {...noFill} style={{ ...inp, marginTop:3 }}/>
          <span style={{ display:"block", marginTop:3, lineHeight:1.4 }}>
            Pour que toucher une notification ouvre la bonne page (impression, bobine…). Vide : pas de lien vers l'appli.
          </span></label>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:12, color:"var(--text2)" }}>
          Jeton d'accès {cfg.ntfy.has_token ? <b style={{ color:"#22c55e" }}>posé</b> : <span style={{ color:"var(--muted)" }}>— facultatif</span>}
          {tokEdit === null ? (<>
            <button onClick={() => setTokEdit("")} style={small}>{cfg.ntfy.has_token ? "Changer" : "Ajouter"}</button>
            {cfg.ntfy.has_token && <button onClick={() => saveNtfy("")} style={{ ...small, color:"var(--muted)" }}>Retirer</button>}
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
            title={canSend ? "" : "Renseigne et enregistre d'abord un sujet"}>Tester tous les canaux</button>
        </div>
        <Msg k="ntfy"/>
      </div>
    </>)}

    {chTab === "telegram" && channelCard("telegram", "Bot Telegram", <>
        Dans Telegram, écris à <b>@BotFather</b> « /newbot » : il donne un <b>jeton</b>. Colle-le ici. Écris ensuite
        « /start » à ton bot, ou ajoute-le à des <b>groupes</b> et écris-y un message, puis touche « Chercher les
        discussions ». Un groupe par sujet (Impressions, MakerWorld…) a son nom et sa photo, les mêmes sur tous tes appareils.</>, <>
      <div style={{ display:"flex", flexDirection:"column", gap:8, fontSize:12, color:"var(--text2)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          Bot {cfg.tgbot?.has_token ? <b style={{ color:"#22c55e" }}>{cfg.tgbot.bot ? `@${cfg.tgbot.bot}` : "posé"}</b>
            : <span style={{ color:"var(--muted)" }}>— pas encore de jeton</span>}
          {botTok === null ? (<>
            <button onClick={() => setBotTok("")} style={small}>{cfg.tgbot?.has_token ? "Changer" : "Ajouter"}</button>
            {cfg.tgbot?.has_token && <button onClick={() => saveBot({ token: "" })} style={{ ...small, color:"var(--muted)" }}>Retirer</button>}
          </>) : (
            <span style={{ display:"flex", gap:6, flex:"1 1 100%" }}>
              <input value={botTok} onChange={e => setBotTok(e.target.value)} placeholder="123456789:AA…" autoFocus {...noFill}
                style={{ ...inp, flex:1, fontFamily:"JetBrains Mono,monospace", fontSize:12 }}/>
              <button onClick={() => setBotTok(null)} style={btn}>✕</button>
              <button onClick={() => saveBot({ token: botTok.trim() })} disabled={!botTok.trim() || busy === "tgbot"} style={primary}>OK</button>
            </span>
          )}
        </div>
        {cfg.tgbot?.has_token && (<>
          <div style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.05em", marginTop:4 }}>
            Discussions</div>
          {!chats.length && <span style={{ color:"var(--muted)" }}>Aucune pour l'instant.</span>}
          {chats.map((c, i) => (
            <div key={c.chat_id} style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              <input value={c.label} onChange={e => setChats(l => l.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                placeholder="Nom (ex. Impressions)" {...noFill} style={{ ...inp, flex:"1 1 140px", padding:"6px 9px", fontSize:12.5 }}/>
              <span style={{ fontFamily:"JetBrains Mono,monospace", fontSize:11, color:"var(--muted)" }}>{c.chat_id}</span>
              {i === 0 ? <Default/> : <button onClick={() => setChats(l => moveFirst(l, i))} style={small} title="En faire la discussion par défaut">★</button>}
              <button onClick={() => testTo("tgbot", { chat: c.chat_id }, chatName(c))} style={small}
                disabled={busy === "tgbot" || !savedChats.some(x => x.chat_id === c.chat_id)}
                title="Enregistre d'abord une nouvelle discussion">Tester</button>
              <button onClick={() => setChats(l => l.filter((_, j) => j !== i))} style={{ ...small, color:"var(--muted)" }} aria-label="Retirer">✕</button>
            </div>
          ))}
          {chatAdd !== null && (
            <span style={{ display:"flex", gap:6 }}>
              <input value={chatAdd} onChange={e => setChatAdd(e.target.value)} placeholder="Identifiant ou @canal" autoFocus {...noFill}
                style={{ ...inp, flex:1, fontSize:12 }}/>
              <button onClick={() => setChatAdd(null)} style={btn}>✕</button>
              <button onClick={() => { setChats(l => [...l, { chat_id: chatAdd.trim(), label: "" }]); setChatAdd(null); }}
                disabled={!chatAdd.trim()} style={primary}>Ajouter</button>
            </span>
          )}
          <div style={{ display:"flex", gap:8, marginTop:4, flexWrap:"wrap" }}>
            <button onClick={() => saveChats(chats)} disabled={busy === "tgbot"} style={primary}>Enregistrer</button>
            <button onClick={detectChat} disabled={busy === "tgbot"} style={btn}>Chercher les discussions</button>
            {chatAdd === null && <button onClick={() => setChatAdd("")} style={{ ...btn, color:"var(--muted)" }}>Saisir à la main</button>}
          </div>
        </>)}
        <Msg k="tgbot"/>
      </div>
    </>)}

    {/* ── Appli Android (UnifiedPush, ntfy en distributeur) ── */}
    {chTab === "app" && channelCard("app", "Appli Android", <>
        Les notifications arrivent dans l'appli BambuNymous elle-même : son icône, son nom, une catégorie Android par
        section (son et vibration réglables dans Android), et la bonne page s'ouvre au toucher. Il faut l'appli
        <b> ntfy</b> sur le téléphone : elle les achemine (UnifiedPush).</>, <>
      {push ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:12, color:"var(--text2)", marginBottom:8 }}>
          Ce téléphone : {push.endpoint ? <b style={{ color:"#22c55e" }}>inscrit</b>
            : !(push.distributors || []).length ? <span style={{ color:"#f59e0b" }}>installe l'appli ntfy d'abord</span>
            : <span style={{ color:"var(--muted)" }}>pas encore inscrit</span>}
          {!push.endpoint && (push.distributors || []).length > 0 && (
            <button onClick={pushRegister} disabled={busy === "app"} style={primary}>Activer sur ce téléphone</button>
          )}
          {push.endpoint && <button onClick={pushRegister} disabled={busy === "app"} style={small}>Réinscrire</button>}
        </div>
      ) : (
        <p style={{ fontSize:11.5, color:"var(--muted)", margin:"0 0 8px" }}>
          Pour inscrire un téléphone, ouvre cette page dans l'appli Android BambuNymous.</p>
      )}
      {devices.map(d => (
        <div key={d.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderTop:"1px solid var(--border)", fontSize:12.5 }}>
          <span style={{ flex:1, minWidth:0 }}>
            <span style={{ fontWeight:700, color:"var(--text)" }}>📱 {d.name || "Téléphone"}</span>
            <span style={{ fontSize:11, color:"var(--muted)", fontWeight:600 }}> · {d.user ? `👤 ${d.user}` : "propriétaire inconnu"}</span>
            <span style={{ display:"block", fontSize:11, color: d.last_err ? "#ef4444" : "var(--muted)" }}>
              {d.last_err ? `Échec ${d.last_err}` : d.last_ok ? `Dernier envoi : ${new Date(d.last_ok).toLocaleString("fr-FR")}`
                : `Inscrit le ${new Date(d.added).toLocaleDateString("fr-FR")}`}</span>
          </span>
          <button onClick={() => testTo("app", { device: d.id }, d.name || "ce téléphone")} disabled={busy === "app"} style={small}>Tester</button>
          <button onClick={() => removeDevice(d.id)} disabled={busy === "app"} style={{ ...small, color:"var(--muted)" }} aria-label="Retirer">✕</button>
        </div>
      ))}
      <Msg k="app"/>
    </>)}
    {/* Mes propres choix sur l'appli (chaque compte a les siens) */}
    {chTab === "app" && on.app && <MyAppNotifications embedded/>}

    {/* ── Journal : canal commun, visible des administrateurs ── */}
    {chTab === "journal" && channelCard("journal", "Journal", <>
        La 🔔 cloche et la page Notifications (15 jours), visibles des administrateurs. Ce qui t'arrive aussi sur
        ntfy ou Telegram y entre déjà lu ; le reste est non lu jusqu'à ce que tu ouvres le journal, ou que tu touches
        la notification sur ton téléphone. Chacun y voit aussi ce qu'il reçoit sur son téléphone.</>, <>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
        <span style={{ flex:1, fontSize:13, fontWeight:700, color:"var(--text)" }}>Tout journaliser
          <span style={{ display:"block", fontSize:11.5, fontWeight:400, color:"var(--muted)" }}>
            Chaque notification, même celles coupées sur ntfy et Telegram.</span></span>
        <Switch on={!!cfg.journal?.all} onChange={v => setJournal({ all: v })} disabled={busy === "journal"}/>
      </div>
      {!cfg.journal?.all && cfg.sections.map(sec => {
        const evs = cfg.events.filter(ev => ev.section === sec.id);
        if (!evs.length) return null;
        const jn = evs.filter(ev => cfg.journal?.events?.[ev.id]).length;
        return (
          <div key={sec.id} style={{ padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ flex:1, fontSize:13, fontWeight:700, color:"var(--text)" }}>{sec.label}</span>
              <span style={{ fontSize:11, fontWeight:700, color: jn ? "#22c55e" : "var(--muted)" }}>{jn}/{evs.length}</span>
              <Switch on={jn === evs.length} onChange={v => setJournal({ events: { [`section:${sec.id}`]: v } })}
                disabled={busy === "journal"}/>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:7 }}>
              {evs.map(ev => {
                const onj = !!cfg.journal?.events?.[ev.id];
                return (
                  <button key={ev.id} onClick={() => setJournal({ events: { [ev.id]: !onj } })} disabled={busy === "journal"}
                    title={ev.description} style={{ fontSize:11.5, fontWeight:600, padding:"4px 10px", borderRadius:20,
                      cursor:"pointer", border: onj ? "1px solid rgba(99,102,241,0.45)" : "1px solid var(--border)",
                      background: onj ? "rgba(99,102,241,0.16)" : "transparent", color: onj ? "#6366F1" : "var(--muted)" }}>
                    {ev.label}</button>
                );
              })}
            </div>
          </div>
        );
      })}
      <Msg k="journal"/>
    </>)}

    {/* ── Types envoyes sur ntfy et Telegram, par section repliable ──
        Seulement sous ces deux onglets : le journal a ses puces, l'appli
        Android les choix de chaque telephone (« Mon telephone »). */}
    {/* Reglages des types (seuils, delais, createurs suivis) : communs a tous
        les canaux, donc aussi sous Journal et Appli Android. */}
    {(chTab === "journal" || chTab === "app") && (() => {
      const evs = cfg.events.filter(ev => (ev.options || []).length || ev.id === "mw_new_model");
      if (!evs.length) return null;
      return (
        <div className="card" style={{ padding:"14px 20px" }}>
          <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 4px" }}>Réglages des notifications</h3>
          <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 6px", lineHeight:1.5 }}>
            Seuils, délais et créateurs suivis : valables pour tous les canaux.</p>
          {evs.map(ev => (
            <div key={ev.id} style={{ padding:"9px 0", borderTop:"1px solid var(--border)" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"var(--text)" }}>{ev.label}</div>
              {(ev.options || []).map(o => (
                <OptionRow key={o.key} o={o} disabled={busy === ev.id} inp={inp}
                  onChange={v => setEvent(ev.id, { options: { [o.key]: v } })}/>
              ))}
              {ev.id === "mw_new_model" && (
                <button onClick={openPicker} disabled={busy === ev.id} style={{ ...btn, marginTop:6 }}>
                  👤 {ev.creators.length ? `Créateurs suivis (${ev.creators.length})` : "Choisir les créateurs"}
                </button>
              )}
              {ev.id === "mw_new_model" && picker && creators && (
                <CreatorPicker creators={creators} picked={ev.creators}
                  applyLabel={k => k ? `Me notifier pour ${k} créateur${k > 1 ? "s" : ""}` : "Aucun créateur"}
                  onClose={() => setPicker(false)}
                  onApply={ids => { setPicker(false); setEvent(ev.id, { creators: ids }); }}/>
              )}
              <Msg k={ev.id}/>
            </div>
          ))}
        </div>
      );
    })()}
    {(chTab === "ntfy" || chTab === "telegram") && (
      <h3 style={{ fontSize:13, fontWeight:800, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.05em",
        margin:"6px 4px 0" }}>Ce qui part sur ntfy et Telegram</h3>
    )}
    {(chTab === "ntfy" || chTab === "telegram") && cfg.sections.map(sec => {
      const evs = cfg.events.filter(ev => ev.section === sec.id);
      if (!evs.length) return null;
      const nOn = evs.filter(ev => ev.enabled).length;
      const isOpen = !!open[sec.id];
      const tOf = savedTopics.find(t => t.topic === sec.route?.ntfy) || savedTopics[0];
      const cOf = savedChats.find(c => c.chat_id === sec.route?.telegram) || savedChats[0];
      const dests = [on.ntfy && tOf && `ntfy · ${topicName(tOf)}`, on.telegram && cOf && `Telegram · ${chatName(cOf)}`,
                     on.app && devices.length && "Appli Android",
                     on.journal && (cfg.journal?.all || evs.some(ev => cfg.journal?.events?.[ev.id])) && "Journal"].filter(Boolean);
      const pickTopic = on.ntfy && savedTopics.length > 1;
      const pickChat = on.telegram && savedChats.length > 1;
      return (
        <div key={sec.id} className="card" style={{ padding:0, overflow:"hidden" }}>
          <button onClick={() => toggle(sec.id)} aria-expanded={isOpen}
            style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"14px 20px", background:"none",
              border:"none", cursor:"pointer", textAlign:"left", color:"var(--text)" }}>
            <span style={{ fontSize:11, color:"var(--muted)", transform: isOpen ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span>
            <span style={{ flex:1, minWidth:0 }}>
              <span style={{ display:"block", fontSize:14, fontWeight:700 }}>{sec.label}</span>
              {dests.length > 0 && <span style={{ display:"block", fontSize:11, color:"var(--muted)", marginTop:2,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{dests.join("  ·  ")}</span>}
            </span>
            <span style={{ fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, whiteSpace:"nowrap",
              color: nOn ? "#22c55e" : "var(--muted)", background: nOn ? "rgba(34,197,94,0.12)" : "var(--surface2)" }}>
              {nOn}/{evs.length} active{nOn > 1 ? "s" : ""}</span>
          </button>
          {isOpen && (
          <div style={{ padding:"0 20px 14px" }}>
          {(pickTopic || pickChat) && (
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"center", padding:"10px 12px", marginBottom:4,
              borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)", fontSize:12, color:"var(--text2)" }}>
              <span style={{ fontWeight:700 }}>Envoyer sur</span>
              {pickTopic && (
                <label style={{ display:"flex", alignItems:"center", gap:6 }}>ntfy
                  <select value={sec.route?.ntfy || ""} disabled={busy === `route_${sec.id}`}
                    onChange={e => setRoute(sec.id, { ntfy: e.target.value })} style={{ ...inp, width:"auto", padding:"5px 8px" }}>
                    {savedTopics.map((t, i) => <option key={t.topic} value={i === 0 ? "" : t.topic}>
                      {topicName(t)}{i === 0 ? " (par défaut)" : ""}</option>)}
                  </select></label>
              )}
              {pickChat && (
                <label style={{ display:"flex", alignItems:"center", gap:6 }}>Telegram
                  <select value={sec.route?.telegram || ""} disabled={busy === `route_${sec.id}`}
                    onChange={e => setRoute(sec.id, { telegram: e.target.value })} style={{ ...inp, width:"auto", padding:"5px 8px" }}>
                    {savedChats.map((c, i) => <option key={c.chat_id} value={i === 0 ? "" : c.chat_id}>
                      {chatName(c)}{i === 0 ? " (par défaut)" : ""}</option>)}
                  </select></label>
              )}
              <Msg k={`route_${sec.id}`}/>
            </div>
          )}
          {evs.map(ev => (
            <div key={ev.id} style={{ padding:"10px 0", borderTop:"1px solid var(--border)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"var(--text)" }}>{ev.label}</div>
                  <div style={{ fontSize:11.5, color:"var(--muted)", marginTop:2 }}>{ev.description}</div>
                </div>
                <Switch on={ev.enabled} onChange={v => setEvent(ev.id, { enabled: v })} disabled={busy === ev.id}/>
              </div>
              {ev.enabled && ev.options.map(o => (
                <OptionRow key={o.key} o={o} disabled={busy === ev.id} inp={inp}
                  onChange={v => setEvent(ev.id, { options: { [o.key]: v } })}/>
              ))}
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
          )}
        </div>
      );
    })}
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

// Reglage d'un type : nombre (saisi, enregistre a la sortie du champ) ou liste.
function OptionRow({ o, onChange, disabled, inp }) {
  const [v, setV] = useState(String(o.value));
  useEffect(() => setV(String(o.value)), [o.value]);
  const commit = () => { if (String(o.value) !== v) onChange(o.type === "number" ? Number(v) || 0 : v); };
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, fontSize:12, color:"var(--text2)", flexWrap:"wrap" }}>
      <span>{o.label}</span>
      {o.type === "select" ? (
        <select value={o.value} disabled={disabled} onChange={e => onChange(e.target.value)}
          style={{ ...inp, width:"auto", padding:"5px 8px" }}>
          {o.choices.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      ) : (<>
        <input type="number" inputMode="numeric" min={o.min} max={o.max} value={v} disabled={disabled}
          onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()}
          style={{ ...inp, width:70, padding:"5px 8px", textAlign:"right" }}/>
        <span>{o.unit}</span>
        {o.key === "min_minutes" && !o.value && <span style={{ color:"var(--muted)" }}>(toutes)</span>}
      </>)}
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
