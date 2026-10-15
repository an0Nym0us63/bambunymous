import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Send } from "lucide-react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";

// Partage Telegram d'une impression ou d'un groupe : choix de la destination,
// message facultatif, et APERCU exact de ce qui partira (la legende vient du
// serveur, la meme qu'a l'envoi). Rien ne part sans le bouton « Envoyer ».
const LAST_DEST = "bn-share-dest";
// Decalage du fuseau du navigateur : l'heure de fin d'un en-cours est donnee
// a l'heure locale, pas a celle du conteneur.
const TZ = new Date().getTimezoneOffset();

export default function ShareSheet({ kind, id, onClose }) {
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const timer = useRef(null);

  const load = (msg) => client.get(`/share/${kind}/${id}/preview`, { params: { message: msg, tz: TZ } })
    .then(r => {
      setPreview(r.data);
      setDest(d => {
        if (d) return d;
        let last = null; try { last = localStorage.getItem(LAST_DEST); } catch { /* stockage indisponible */ }
        const ids = r.data.destinations.map(x => x.id);
        return ids.includes(last) ? last : (ids[0] || "");
      });
    })
    .catch(e => setPreview({ error: e.response?.data?.detail || e.message, destinations: [] }));
  useEffect(() => { load(""); }, [kind, id]);
  // L'apercu suit le message, sans requete a chaque touche.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(message), 400);
    return () => clearTimeout(timer.current);
  }, [message]);

  const send = async () => {
    setBusy(true);
    try {
      const { data } = await client.post(`/share/${kind}/${id}`, { destination_id: dest, message, tz: TZ });
      try { localStorage.setItem(LAST_DEST, dest); } catch { /* stockage indisponible */ }
      setDone(data);
      setTimeout(onClose, 1400);
    } catch (e) {
      showAlert("Envoi impossible : " + (e.response?.data?.detail || e.message));
    }
    setBusy(false);
  };

  const dests = preview?.destinations || [];
  const nMedia = preview?.media?.length || 0;
  return createPortal(
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:1500, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:520, maxHeight:"90dvh", overflowY:"auto", padding:"16px 18px",
        paddingBottom:"calc(16px + env(safe-area-inset-bottom,0px))" }}>
        <h3 style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:"0 0 12px",
          display:"flex", alignItems:"center", gap:8 }}>
          <Send size={16}/> Partager sur Telegram
        </h3>

        {!preview ? (
          <p style={{ fontSize:12, color:"var(--muted)" }}>Préparation…</p>
        ) : preview.error ? (
          <p style={{ fontSize:12, color:"#ef4444" }}>{preview.error}</p>
        ) : dests.length === 0 ? (
          <p style={{ fontSize:12.5, color:"var(--muted)", lineHeight:1.5 }}>
            Aucune destination : relie ton compte et ajoute des discussions dans
            Paramètres › Général › Partage Telegram.
          </p>
        ) : (<>
          <label style={{ display:"block", fontSize:11, fontWeight:600, color:"var(--muted)", marginBottom:4 }}>Destination</label>
          <select value={dest} onChange={e => setDest(e.target.value)}
            style={{ width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10,
              padding:"9px 12px", fontSize:13, color:"var(--text)", marginBottom:12 }}>
            {dests.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>

          <label style={{ display:"block", fontSize:11, fontWeight:600, color:"var(--muted)", marginBottom:4 }}>
            Message (facultatif)
          </label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
            placeholder="Un mot pour accompagner…"
            style={{ width:"100%", boxSizing:"border-box", background:"var(--surface2)", border:"1px solid var(--border)",
              borderRadius:10, padding:"9px 12px", fontSize:13, color:"var(--text)", resize:"vertical",
              fontFamily:"inherit", marginBottom:12 }}/>

          <div style={{ fontSize:11, fontWeight:600, color:"var(--muted)", marginBottom:4 }}>
            Ce qui partira · {nMedia ? `${nMedia} photo${nMedia > 1 ? "s" : ""} ou vidéo${nMedia > 1 ? "s" : ""}` : "texte seul"}
            {preview.live && " · dont la caméra en direct"}
          </div>
          {/* Legende construite par le serveur, contenu deja echappe : seules
              ses balises <b> et <a> sont interpretees. */}
          <style>{`.bn-cap blockquote{margin:0;padding:6px 10px;border-left:3px solid #229ED9;
            background:rgba(34,158,217,0.10);border-radius:4px;white-space:pre-wrap}`}</style>
          <div className="bn-cap" style={{ padding:"10px 12px", borderRadius:10, background:"var(--surface2)",
            border:"1px solid var(--border)", fontSize:12.5, color:"var(--text)", whiteSpace:"pre-wrap",
            lineHeight:1.45, marginBottom:14, wordBreak:"break-word" }}
            dangerouslySetInnerHTML={{ __html: preview.caption_html }}/>
        </>)}

        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:10, borderRadius:12, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text)", fontSize:13, fontWeight:700, cursor:"pointer" }}>
            {done ? "Fermer" : "Annuler"}
          </button>
          {dests.length > 0 && !preview?.error && (
            <button onClick={send} disabled={busy || !dest || !!done}
              style={{ flex:2, padding:10, borderRadius:12, border:"none", fontSize:13, fontWeight:700,
                cursor: busy || done ? "default" : "pointer",
                background: done ? "#22c55e" : busy ? "var(--surface2)" : "#229ED9",
                color: busy && !done ? "var(--muted)" : "white" }}>
              {done ? `✓ Envoyé · ${done.destination}` : busy ? "Envoi…" : "Envoyer"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
