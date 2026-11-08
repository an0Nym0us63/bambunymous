import React, { useEffect, useRef, useState } from "react";
import { useTrackDetail } from "../utils/track";
import { createPortal } from "react-dom";
import { Send } from "lucide-react";
import client, { apiUrl, PHOTOS_CHANGED } from "../api/client";
import { useShares } from "../store/shares";
import { FSheet, FCard, fBtn } from "./FicheKit";
import { mwImg } from "./MwImg";
import { showAlert } from "../utils/dialog";
import { egg } from "../eggs";
import MediaThumb from "./MediaThumb";

// Partage Telegram d'une impression, d'un groupe ou d'un modele MakerWorld (kind « design », 25/10/2026) : choix de la destination,
// message facultatif, et APERCU exact de ce qui partira (la legende vient du
// serveur, la meme qu'a l'envoi). Rien ne part sans le bouton « Envoyer ».
// Derniere selection de destinations (liste d'ids), pratique d'un partage a l'autre.
const LAST_DEST = "bn-share-dests";
// Decalage du fuseau du navigateur : l'heure de fin d'un en-cours est donnee
// a l'heure locale, pas a celle du conteneur.
const TZ = new Date().getTimezoneOffset();

const KIND_NAME = { group: "groupe", design: "modèle MakerWorld", creator: "créateur MakerWorld", print: "impression" };
const KIND_THIS = { group: "Ce groupe", design: "Ce modèle", creator: "Ce créateur", print: "Cette impression" };
// une vignette : nos fichiers passent par l'API, la couverture d'un modele vient de MakerWorld
// la carte des filaments arrive deja dessinee (data:)
const srcOf = u => /^data:/.test(u) ? u : /^https?:/.test(u) ? mwImg(u, 256) : apiUrl(u.slice(7));

// Les timelapses des impressions d'un groupe (26/10/2026) : aucun d'office, on coche ceux a joindre.
function TimelapsePicker({ items, picked, room, onDone, onClose, z }) {
  const [on, setOn] = useState(() => items.filter(t => picked.includes(t.id)).map(t => t.id));
  const T = "#229ED9";
  return createPortal(
    <FSheet onClose={onClose} z={z} bottom={<>
      <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button>
      <button onClick={() => onDone(on)} style={{ ...fBtn, flex: 2, border: "none", color: "#fff",
        background: `linear-gradient(135deg, ${T}, #3B82F6)` }}>{on.length ? `Joindre ${on.length} timelapse${on.length > 1 ? "s" : ""}` : "Aucun timelapse"}</button>
    </>}>
      <div style={{ padding: "52px 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>🎬 Joindre des timelapses</div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 4px", lineHeight: 1.45 }}>
          Ceux des impressions du groupe, copiés depuis l'imprimante. {room} place{room > 1 ? "s" : ""} dans l'album (10 médias au plus).</p>
        {items.map(t => {
          const yes = on.includes(t.id);
          const full = !yes && on.length >= room;
          return (
            <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14,
              cursor: full ? "not-allowed" : "pointer", opacity: full ? .5 : 1,
              background: yes ? `linear-gradient(135deg, ${T}26, transparent 70%), var(--surface)` : "var(--surface)",
              border: `1px solid ${yes ? `${T}88` : "var(--border)"}` }}>
              <input type="checkbox" checked={yes} disabled={full} style={{ accentColor: T, width: 18, height: 18, flexShrink: 0 }}
                onChange={() => setOn(o => yes ? o.filter(x => x !== t.id) : [...o, t.id])}/>
              {/* la vignette du plateau de l'impression : on reconnait le timelapse d'un coup d'oeil */}
              <span style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center",
                justifyContent: "center", background: "var(--surface2)", border: "1px solid var(--border)", fontSize: 18 }}>
                {t.plate ? <img src={srcOf(t.plate)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  onError={e => { e.currentTarget.replaceWith(document.createTextNode("🎬")); }}/> : "🎬"}</span>
              <span style={{ fontSize: 14, color: "var(--text)", fontWeight: yes ? 800 : 600, overflowWrap: "anywhere" }}>{t.label}</span>
            </label>
          );
        })}
      </div>
    </FSheet>,
    document.body
  );
}

// La fenetre de redaction (message, medias, apercu). mode « telegram » : destinations et album ; mode « other »
// (02/11/2026) : une autre appli, UN seul visuel (WhatsApp envoie un message par photo : six photos faisaient six
// messages) ; les filaments partent dans le message, sauf si le visuel choisi est leur carte (comme Telegram).
function ShareCompose({ kind, id, mode = "telegram", onClose, z = 1500 }) {
  const single = mode === "other";
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [sel, setSel] = useState(null);         // ids coches (null tant que non initialise)
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [pick, setPick] = useState(null);       // medias joints (ids), comme pour les evaluations
  const [tlOpen, setTlOpen] = useState(false);
  useTrackDetail(`Partage · ${KIND_NAME[kind] || kind} #${id}`);
  const timer = useRef(null);

  // la carte des filaments cochee ou non : la legende ne liste les filaments que sans elle (31/10/2026)
  const cardRef = useRef(null);
  const load = (msg) => client.get(`/share/${kind}/${id}/preview`,
    { params: { message: msg, tz: TZ, ...(cardRef.current === false ? { card: 0 } : {}) } })
    .then(r => {
      setPreview(r.data);
      // une autre appli : d'office le premier visuel joint (hors carte des filaments, qu'on choisit expres)
      setPick(cur => cur || (single ? (r.data.default_ids || []).filter(x => x !== "filaments").slice(0, 1) : r.data.default_ids || []));
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
  // une photo ajoutee pendant que la fenetre est ouverte : elle rejoint les medias proposes
  useEffect(() => {
    const again = () => load(message);
    window.addEventListener(PHOTOS_CHANGED, again);
    return () => window.removeEventListener(PHOTOS_CHANGED, again);
  }, [kind, id, message]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardOn = pick ? pick.includes("filaments") : null;
  useEffect(() => {
    if (cardOn === null || cardRef.current === cardOn) return;
    const first = cardRef.current === null;
    cardRef.current = cardOn;
    if (!first) load(message);
  }, [cardOn]); // eslint-disable-line react-hooks/exhaustive-deps
  // L'apercu suit le message, sans requete a chaque touche.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(message), 400);
    return () => clearTimeout(timer.current);
  }, [message]);

  // Partage par une autre appli (01/11/2026, WhatsApp d'abord) : le meme texte, prepare par le serveur ; le menu de
  // partage du telephone choisit l'appli et la discussion. Dans l'appli Android seulement : elle telecharge le fichier
  // et ouvre son menu (BambuScan.shareFiles).
  const [prep, setPrep] = useState(false);
  const shareOther = async () => {
    setPrep(true);
    try {
      const b = (await client.post(`/share/${kind}/${id}/bundle`, { message, tz: TZ, media: pick || [], single: true })).data;
      window.BambuScan.shareFiles(JSON.stringify({ text: b.text, title: b.title,
        files: b.files.map(f => ({ url: new URL(f.url, location.href).href, name: f.name, mime: f.mime })) }));
      egg("partage_ailleurs");
      onClose();
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setPrep(false); }
  };

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
  const toggle = (mid) => setPick(p => single ? (p.includes(mid) ? [] : [mid])
    : p.includes(mid) ? p.filter(x => x !== mid) : p.length < max ? [...p, mid] : p);
  const tls = preview?.timelapses || [];
  const tlIds = new Set(tls.map(t => t.id));
  // les timelapses choisis d'un groupe rejoignent les vignettes (touche pour retirer)
  const shown = [...(preview?.pool || []), ...tls.filter(t => pick?.includes(t.id)).map(t => ({ ...t, video: true, timelapse: true }))];
  const thumb = { width: 76, height: 76, borderRadius: 12, objectFit: "cover", cursor: "pointer", display: "block", boxSizing: "border-box" };
  const T = "#229ED9";
  const canSend = !single && dests.length > 0 && !preview?.error;
  const W = "#22C55E";
  return createPortal(
    <FSheet onClose={onClose} z={z} bottom={<>
      <button onClick={onClose} style={{ ...fBtn, flex: canSend || single ? "0 0 auto" : 1, padding: canSend || single ? "0 14px" : undefined }}>{done ? "Fermer" : "Annuler"}</button>
      {single && <button onClick={shareOther} disabled={prep || !preview || !!preview.error}
        style={{ ...fBtn, flex: 1, minWidth: 0, border: "none", color: prep ? "var(--muted)" : "#fff",
          background: prep ? "var(--surface2)" : `linear-gradient(135deg, ${W}, #16A34A)`, boxShadow: prep ? "none" : `0 8px 18px -10px ${W}` }}>
        {prep ? "Préparation…" : "📲 Partager"}</button>}
      {canSend && <button onClick={send} disabled={busy || !sel?.length || !!done}
        style={{ ...fBtn, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", border: "none", color: busy && !done ? "var(--muted)" : "#fff",
          cursor: busy || done ? "default" : "pointer", opacity: !sel?.length ? .55 : 1,
          background: done ? "linear-gradient(135deg, #22C55E, #16A34A)" : busy ? "var(--surface2)" : `linear-gradient(135deg, ${T}, #3B82F6)`,
          boxShadow: busy ? "none" : `0 8px 18px -10px ${T}` }}>
        <Send size={15}/> {done ? `✓ Envoyé · ${done.destination}` : busy ? "Envoi…"
          : sel?.length > 1 ? `Telegram · ${sel.length}` : "Telegram"}</button>}
    </>}>
      <div style={{ padding: "52px 18px 16px", background: `radial-gradient(circle at 15% 40%, ${single ? W : T}55, transparent 60%), linear-gradient(135deg, ${single ? W : T}22, transparent 70%), var(--surface2)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 46, height: 46, borderRadius: 15, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: single ? `linear-gradient(135deg, ${W}, #16A34A)` : `linear-gradient(135deg, ${T}, #3B82F6)`, boxShadow: `0 8px 18px -8px ${single ? W : T}`,
            fontSize: 22 }}>{single ? "📲" : <Send size={21} color="#fff"/>}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: single ? "#16A34A" : T }}>
              {single ? "Partager · autre appli" : "Partager · Telegram"}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)", lineHeight: 1.2, overflowWrap: "anywhere" }}>
              {preview?.title || KIND_THIS[kind] || "Ce partage"}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {!preview ? (
          <p style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: 16 }}>Préparation…</p>
        ) : preview.error ? (
          <p style={{ fontSize: 13, fontWeight: 700, color: "#ef4444" }}>{preview.error}</p>
        ) : (<>
          {/* sans Telegram, « 📲 Autre appli » partage quand meme (01/11/2026) */}
          {single ? <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5, margin: 0 }}>
            Un seul visuel part, avec le message en légende (WhatsApp envoie un message par photo). Les filaments sont écrits
            dans le message, sauf si tu choisis leur carte. Rien de coché : le texte seul.</p>
          : dests.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5, margin: 0 }}>
            Telegram : aucune destination (relie ton compte et ajoute des discussions dans Paramètres › Notifs › Partage
            Telegram).</p>
          : <FCard t="Destinations Telegram" i="💬" c={T}>
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
          </FCard>}

          <FCard t="Message" i="✍️" c="#8B5CF6" aside={<span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>facultatif</span>}>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
              placeholder="Un mot pour accompagner…"
              style={{ width: "100%", boxSizing: "border-box", background: "var(--surface)", border: "1px solid var(--border)", marginTop: 6,
                borderRadius: 12, padding: "10px 12px", fontSize: 14, color: "var(--text)", resize: "vertical", fontFamily: "inherit" }}/>
          </FCard>

          <FCard t="Ce qui partira" i="👀" c="#22C55E" aside={<span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>
            {single ? (nMedia ? "1 visuel" : "texte seul") : nMedia ? `${nMedia} photo${nMedia > 1 ? "s" : ""} ou vidéo${nMedia > 1 ? "s" : ""}` : "texte seul"}{pick?.includes("camera") && " · caméra"}</span>}>
            {/* Medias joints : touche pour retirer ou ajouter, 10 au plus (limite Telegram). */}
            {(shown.length > 0 || preview.live) && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 10px" }}>
                {preview.live && (
                  <div onClick={() => toggle("camera")} data-tip="Caméra en direct, capturée à l'envoi"
                    style={{ ...thumb, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
                      background: "var(--surface)", border: pick?.includes("camera") ? `2.5px solid ${T}` : "2px solid var(--border)",
                      opacity: pick?.includes("camera") ? 1 : 0.45 }}>📷</div>
                )}
                {/* (08/11/2026) chaque vignette dit ce qu'elle est (Photo, Vue 2, Tour de caméra…) ; les vidéos tournent en boucle */}
                {shown.map(m => {
                  const on = pick?.includes(m.id);
                  const label = m.card ? "🎨 Filaments" : m.id === "mwcover" ? "🌐 Couverture" : m.id === "mwavatar" ? "👤 Avatar"
                    : m.timelapse ? "🎬 Timelapse" : m.label || (m.id.startsWith("mw") ? "🌐 Modèle" : null);
                  const tip = m.card ? "La carte des filaments : leurs vraies couleurs et finitions (le texte de Telegram n'a que des ronds approchants)"
                    : m.id === "mwcover" ? "La couverture du modèle sur MakerWorld" : m.id === "mwavatar" ? "Son avatar" : m.id.startsWith("mw") ? "Un de ses modèles"
                    : [label, m.timelapse ? m.label : m.from].filter(Boolean).join(" · ") || undefined;
                  return <MediaThumb key={m.id} src={srcOf(m.url)} video={m.video} label={label} on={on} accent={T} tip={tip} onClick={() => toggle(m.id)}/>;
                })}
              </div>
            )}
            {kind === "group" && tls.length > 0 && !single && (
              <button onClick={() => setTlOpen(true)} style={{ ...fBtn, margin: "0 0 10px", border: "1px solid var(--border)", fontSize: 13 }}>
                🎬 Joindre des timelapses{tls.some(t => pick?.includes(t.id)) ? ` · ${tls.filter(t => pick?.includes(t.id)).length} / ${tls.length}` : ` (${tls.length})`}</button>
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
      {tlOpen && <TimelapsePicker items={tls} picked={pick || []} z={z + 10} onClose={() => setTlOpen(false)}
        room={max - (pick || []).filter(x => !tlIds.has(x)).length}
        onDone={ids => { setPick(p => [...(p || []).filter(x => !tlIds.has(x)), ...ids]); setTlOpen(false); }}/>}
    </FSheet>,
    document.body
  );
}

// ce qui part, selon ce qu'on partage (02/11/2026 : un createur annoncait « les photos et la carte des filaments »)
const TG_WHAT = {
  print: "Le message, les photos et la carte des filaments", group: "Le message, les photos et la carte des filaments",
  design: "Le message, la couverture du modèle et tes photos", creator: "Le message, son avatar et ses modèles",
};
const ONE_WHAT = { print: "une photo", group: "une photo", design: "une image", creator: "une image" };

// Le bouton « Partager » ouvre d'abord ce menu (02/11/2026) : copier le lien MakerWorld, Telegram, ou une autre appli
// (dans l'appli Android). Le lien est lu a l'ouverture, pour etre copie d'un seul geste.
export default function ShareSheet({ kind, id, onClose, z = 1500 }) {
  const [mode, setMode] = useState(null);
  const [links, setLinks] = useState(null);
  const [copied, setCopied] = useState(false);
  const nativeShare = typeof window !== "undefined" && !!window.BambuScan?.shareFiles;
  useEffect(() => {
    client.get(`/share/${kind}/${id}/preview`, { params: { tz: TZ } }).then(r => setLinks(r.data.links || [])).catch(() => setLinks([]));
  }, [kind, id]);
  if (mode) return <ShareCompose kind={kind} id={id} mode={mode} z={z} onClose={onClose}/>;
  const copy = async () => {
    const t = (links || []).join("\n");
    try { await navigator.clipboard.writeText(t); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = t; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } finally { ta.remove(); }
    }
    setCopied(true);
    egg("lien_copie");
    setTimeout(onClose, 900);
  };
  const row = (icon, c, title, sub, onClick, dis) => (
    <button type="button" onClick={onClick} disabled={dis} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
      padding: "12px 14px", borderRadius: 16, cursor: dis ? "default" : "pointer", opacity: dis ? .55 : 1,
      border: `1px solid ${c}55`, background: `linear-gradient(135deg, ${c}1f, transparent 70%), var(--surface)` }}>
      <span style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19,
        background: `linear-gradient(135deg, ${c}, ${c}bb)`, color: "#fff", boxShadow: `0 8px 18px -10px ${c}` }}>{icon}</span>
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 900, color: "var(--text)" }}>{title}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>{sub}</span>
      </span>
    </button>);
  return createPortal(
    <FSheet onClose={onClose} z={z} bottom={<button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button>}>
      <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#8B5CF6" }}>Partager</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)", marginBottom: 4 }}>{KIND_THIS[kind] || "Ce partage"}</div>
        {(links == null || links.length > 0) && row(copied ? "✓" : "🔗", "#8B5CF6", copied ? "Lien copié" : `Copier le lien MakerWorld${links?.length > 1 ? "s" : ""}`,
          links == null ? "…" : links.length > 1 ? `${links.length} liens, un par ligne` : links[0], copy, !links?.length)}
        {row(<Send size={19}/>, "#229ED9", "Telegram", `${TG_WHAT[kind] || TG_WHAT.print}, en album, dans tes discussions`, () => setMode("telegram"))}
        {nativeShare && row("📲", "#22C55E", "Autre appli", `WhatsApp, Messages, mail… : le message et ${ONE_WHAT[kind] || ONE_WHAT.print} au choix`, () => setMode("other"))}
      </div>
    </FSheet>, document.body);
}
