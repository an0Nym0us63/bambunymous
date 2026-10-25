import React, { useEffect, useRef, useState } from "react";
import { useTrackDetail } from "../utils/track";
import { createPortal } from "react-dom";
import { Send } from "lucide-react";
import client, { apiUrl } from "../api/client";
import { useShares } from "../store/shares";
import { FSheet, FCard, fBtn } from "./FicheKit";

// Partage Telegram d'une impression ou d'un groupe : choix de la destination,
// message facultatif, et APERCU exact de ce qui partira (la legende vient du
// serveur, la meme qu'a l'envoi). Rien ne part sans le bouton « Envoyer ».
// Derniere selection de destinations (liste d'ids), pratique d'un partage a l'autre.
const LAST_DEST = "bn-share-dests";
// Decalage du fuseau du navigateur : l'heure de fin d'un en-cours est donnee
// a l'heure locale, pas a celle du conteneur.
const TZ = new Date().getTimezoneOffset();

export default function ShareSheet({ kind, id, onClose }) {
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [sel, setSel] = useState(null);         // ids coches (null tant que non initialise)
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [pick, setPick] = useState(null);       // medias joints (ids), comme pour les evaluations
  useTrackDetail(`Partage Telegram · ${kind === "group" ? "groupe" : "impression"} #${id}`);
  const timer = useRef(null);

  const load = (msg) => client.get(`/share/${kind}/${id}/preview`, { params: { message: msg, tz: TZ } })
    .then(r => {
      setPreview(r.data);
      setPick(cur => cur || r.data.default_ids || []);
      setSel(cur => {
        if (cur) return cur;
        let last = []; try { last = JSON.parse(localStorage.getItem(LAST_DEST) || "[]"); } catch { /* stockage indisponible */ }
        const ids = r.data.destinations.map(x => x.id);
        const keep = (Array.isArray(last) ? last : []).filter(i => ids.includes(i));
        return keep.length ? keep : ids.slice(0, 1);
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

  // L'envoi part en arriere-plan (store global) : la fenetre se ferme tout de
  // suite, la pastille en haut de l'ecran suit l'envoi sur toutes les pages.
  const send = () => {
    useShares.getState().start({ kind, id, title: preview?.title || "Partage",
      destinationIds: sel, message, tz: TZ, media: pick || undefined });
    try { localStorage.setItem(LAST_DEST, JSON.stringify(sel)); } catch { /* stockage indisponible */ }
    onClose();
  };

  const dests = preview?.destinations || [];
  const max = preview?.album_max || 10;
  const nMedia = pick ? pick.length : preview?.media?.length || 0;
  const toggle = (mid) => setPick(p => p.includes(mid) ? p.filter(x => x !== mid) : p.length < max ? [...p, mid] : p);
  const thumb = { width: 62, height: 62, borderRadius: 12, objectFit: "cover", cursor: "pointer", display: "block", boxSizing: "border-box" };
  const T = "#229ED9";
  const canSend = dests.length > 0 && !preview?.error;
  return createPortal(
    <FSheet onClose={onClose} z={1500} bottom={<>
      <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>{done ? "Fermer" : "Annuler"}</button>
      {canSend && <button onClick={send} disabled={busy || !sel?.length || !!done}
        style={{ ...fBtn, flex: 2, border: "none", color: busy && !done ? "var(--muted)" : "#fff",
          cursor: busy || done ? "default" : "pointer", opacity: !sel?.length ? .55 : 1,
          background: done ? "linear-gradient(135deg, #22C55E, #16A34A)" : busy ? "var(--surface2)" : `linear-gradient(135deg, ${T}, #3B82F6)`,
          boxShadow: busy ? "none" : `0 8px 18px -10px ${T}` }}>
        <Send size={15}/> {done ? `✓ Envoyé · ${done.destination}` : busy ? "Envoi…"
          : sel?.length > 1 ? `Envoyer à ${sel.length} destinations` : "Envoyer"}</button>}
    </>}>
      <div style={{ padding: "52px 18px 16px", background: `radial-gradient(circle at 15% 40%, ${T}55, transparent 60%), linear-gradient(135deg, ${T}22, transparent 70%), var(--surface2)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 46, height: 46, borderRadius: 15, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: `linear-gradient(135deg, ${T}, #3B82F6)`, boxShadow: `0 8px 18px -8px ${T}` }}><Send size={21} color="#fff"/></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: T }}>Partager sur Telegram</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)", lineHeight: 1.2, overflowWrap: "anywhere" }}>
              {preview?.title || (kind === "group" ? "Ce groupe" : "Cette impression")}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {!preview ? (
          <p style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: 16 }}>Préparation…</p>
        ) : preview.error ? (
          <p style={{ fontSize: 13, fontWeight: 700, color: "#ef4444" }}>{preview.error}</p>
        ) : dests.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
            Aucune destination : relie ton compte et ajoute des discussions dans
            Paramètres › Notifs › Partage Telegram.
          </p>
        ) : (<>
          <FCard t="Destinations" i="💬" c={T}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
              {dests.map(d => {
                const on = sel?.includes(d.id);
                return (
                  <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    borderRadius: 14, cursor: "pointer",
                    background: on ? `linear-gradient(135deg, ${T}26, transparent 70%), var(--surface)` : "var(--surface)",
                    border: `1px solid ${on ? `${T}88` : "var(--border)"}` }}>
                    <input type="checkbox" checked={!!on} style={{ accentColor: T, width: 18, height: 18 }}
                      onChange={() => setSel(s => on ? s.filter(x => x !== d.id) : [...(s || []), d.id])}/>
                    <span style={{ fontSize: 14, color: "var(--text)", fontWeight: on ? 800 : 600 }}>{d.label}</span>
                  </label>
                );
              })}
            </div>
          </FCard>

          <FCard t="Message" i="✍️" c="#8B5CF6" aside={<span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>facultatif</span>}>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
              placeholder="Un mot pour accompagner…"
              style={{ width: "100%", boxSizing: "border-box", background: "var(--surface)", border: "1px solid var(--border)", marginTop: 6,
                borderRadius: 12, padding: "10px 12px", fontSize: 14, color: "var(--text)", resize: "vertical", fontFamily: "inherit" }}/>
          </FCard>

          <FCard t="Ce qui partira" i="👀" c="#22C55E" aside={<span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>
            {nMedia ? `${nMedia} photo${nMedia > 1 ? "s" : ""} ou vidéo${nMedia > 1 ? "s" : ""}` : "texte seul"}{pick?.includes("camera") && " · caméra"}</span>}>
            {/* Medias joints : touche pour retirer ou ajouter, 10 au plus (limite Telegram). */}
            {(preview.pool?.length > 0 || preview.live) && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 10px" }}>
                {preview.live && (
                  <div onClick={() => toggle("camera")} data-tip="Caméra en direct, capturée à l'envoi"
                    style={{ ...thumb, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
                      background: "var(--surface)", border: pick?.includes("camera") ? `2.5px solid ${T}` : "2px solid var(--border)",
                      opacity: pick?.includes("camera") ? 1 : 0.45 }}>📷</div>
                )}
                {(preview.pool || []).map(m => {
                  const on = pick?.includes(m.id);
                  const st = { ...thumb, border: on ? `2.5px solid ${T}` : "2px solid transparent", opacity: on ? 1 : 0.4 };
                  return m.video
                    ? <video key={m.id} src={apiUrl(m.url.slice(7))} muted playsInline preload="metadata" onClick={() => toggle(m.id)} style={st}/>
                    : <img key={m.id} src={apiUrl(m.url.slice(7))} alt="" onClick={() => toggle(m.id)} style={st}/>;
                })}
              </div>
            )}
            {/* Legende construite par le serveur, contenu deja echappe : seules
                ses balises <b> et <a> sont interpretees. */}
            <style>{`.bn-cap blockquote{margin:0;padding:6px 10px;border-left:3px solid #229ED9;
              background:rgba(34,158,217,0.10);border-radius:6px;white-space:pre-wrap}`}</style>
            <div className="bn-cap" style={{ padding: "10px 12px", borderRadius: 14, background: "var(--surface)", marginTop: 6,
              border: "1px solid var(--border)", fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap",
              lineHeight: 1.45, wordBreak: "break-word" }}
              dangerouslySetInnerHTML={{ __html: preview.caption_html }}/>
          </FCard>
        </>)}
      </div>
    </FSheet>,
    document.body
  );
}
