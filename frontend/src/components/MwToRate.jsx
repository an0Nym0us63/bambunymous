import React, { useEffect, useState } from "react";
import { useTrackDetail } from "../utils/track";
import { createPortal } from "react-dom";
import { showConfirm, showAlert } from "../utils/dialog";
import { useCanMwHome } from "../store/auth";
import client from "../api/client";
import { useShares, setOnRateFailed } from "../store/shares";
import MwImg from "./MwImg";
import Lightbox from "./Lightbox";

// « ⭐ À évaluer » : mes impressions de modèles MakerWorld pas encore évaluées,
// avec mes photos (du print, sinon de son groupe) prêtes à joindre.
// Une seule lecture partagee (gardee 5 min) : la liste, les vignettes de
// l'historique et les fiches s'en servent toutes.
let _last = null, _p = null, _t = 0;
const _subs = new Set();                    // tous les ecrans qui affichent la liste
const _notify = () => _subs.forEach(f => f(_last));
// Evaluation publiee : le modele quitte la liste partout, tout de suite.
export function markRated(did) {
  if (_last) _last = { ..._last, items: (_last.items || []).filter(x => String(x.design_id) !== String(did)) };
  _p = Promise.resolve(_last);
  _notify();
}
function readToRate() {
  if (!_p || Date.now() - _t > 300000) {
    _t = Date.now();
    _p = client.get("/makerworld/to-rate").then(({ data }) => { _last = data; _notify(); return data; }).catch(() => _last);
  }
  return _p;
}
export function useToRate(enabled) {
  const [data, setData] = useState(_last);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const f = d => alive && setData(d);
    _subs.add(f);
    readToRate().then(d => alive && d && setData(d));
    return () => { alive = false; _subs.delete(f); };
  }, [enabled]);
  return enabled ? data : null;           // chez un copain : rien de ma liste
}
// Modeles a evaluer (ensemble d'identifiants), chez moi seulement.
export function useToRateSet(enabled = true) {
  const d = useToRate(enabled);
  return new Set((d?.items || []).map(x => String(x.design_id)));
}
// Familles de messages tout faits (Parametres), lues une fois.
let _tpl = null;
let _lastDrawn = null;                 // dernier message tire : jamais le meme deux ouvertures de suite
export function forgetTemplates() { _tpl = null; }
function useTemplates() {
  const [fams, setFams] = useState(null);
  useEffect(() => {
    let alive = true;
    _tpl = _tpl || client.get("/makerworld/rate-templates").then(({ data }) => data.families || []).catch(() => { _tpl = null; return []; });
    _tpl.then(f => alive && setFams(f));
    return () => { alive = false; };
  }, []);
  return fams;
}

setOnRateFailed(() => { forgetToRate(); readToRate(); });

export function forgetToRate() { _p = null; _t = 0; }  // relire au prochain affichage

// Bouton « Évaluer » pour un modele : formulaire dans l'appli quand MakerWorld
// attend l'evaluation (on connait sa fiche), sinon lien vers MakerWorld.
export function RateButton({ did, style, label = "⭐ Évaluer", doneLabel = "✓ Évalué", ext = " ↗" }) {
  const d = useToRate(true);
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const x0 = (d?.items || []).find(i => String(i.design_id) === String(did));
  const can = useCanMwHome();
  const x = can ? x0 : x0 && { ...x0, rating_id: null };
  if (gone) return <span style={{ ...style, background: "none", color: "#22c55e", borderColor: "transparent" }}>{doneLabel}</span>;
  if (!x?.rating_id) return <a href={x?.url || rateUrl(did)} target="_blank" rel="noopener noreferrer" style={style}>{label}{ext}</a>;
  return (<>
    <button onClick={() => setOpen(true)} style={{ ...style, cursor: "pointer" }}>{label}</button>
    {open && createPortal(
      <div data-no-pull="" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 4300, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={e => e.stopPropagation()} className="sheet-panel" style={{ width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto",
          borderRadius: 16, border: "1px solid var(--border)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ⭐ {x.title || `Modèle ${did}`}</div>
              {x.profile_title && <div style={{ fontSize: 11, color: "var(--muted)" }}>Profil « {x.profile_title} »</div>}
            </div>
            <button onClick={() => setOpen(false)} aria-label="Fermer" style={{ background: "none", border: "none", color: "var(--muted)",
              fontSize: 20, cursor: "pointer" }}>✕</button>
          </div>
          <RateForm x={x} onDone={() => { setOpen(false); setGone(true); }}/>
        </div>
      </div>, document.body
    )}
  </>);
}
// Fiche d'un groupe : ses modeles imprimes pas encore evalues, et une seule
// evaluation pour tous ceux que MakerWorld attend.
export function GroupToRate({ designs, name, enabled = true, label = null, anchor = null }) {
  const d = useToRate(enabled);
  const [open, setOpen] = useState(false);
  const ids = new Set((designs || []).map(String));
  const can = useCanMwHome();
  const items = (d?.items || []).filter(x => ids.has(String(x.design_id)));
  if (!items.length) return null;
  const ready = can ? items.filter(x => x.rating_id) : [];
  const photos = [...new Set(items.flatMap(x => x.photos || []))];
  const btn = { padding: "5px 11px", borderRadius: 10, fontSize: 11.5, fontWeight: 700, background: "#f59e0b", color: "white",
    border: "1px solid #f59e0b", textDecoration: "none" };
  return (
    <div id={anchor || undefined} style={{ padding: "11px 12px", borderRadius: 18, border: "1px solid rgba(245,158,11,0.45)", scrollMarginTop: 60,
      background: "radial-gradient(90% 80% at 100% 0%, rgba(245,158,11,0.22), transparent 70%), var(--surface2)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 32, height: 32, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
          background: "linear-gradient(135deg, #F59E0B, #FBBF24)", boxShadow: "0 6px 16px rgba(245,158,11,.35)" }}>⭐</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 900, color: "#d97706" }}>
          {label || `${items.length} modèle${items.length > 1 ? "s" : ""} à évaluer dans ce groupe`}</span>
        {ready.length > 1 && <button onClick={() => setOpen(true)} style={{ ...btn, cursor: "pointer" }}>⭐ Tout évaluer ({ready.length})</button>}
      </div>
      {items.map(x => (
        <div key={x.design_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>{x.title || `Modèle ${x.design_id}`}</span>
          <RateButton did={x.design_id} style={btn}/>
        </div>
      ))}
      {open && createPortal(
        <div data-no-pull="" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 4300, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="sheet-panel" style={{ width: "100%", maxWidth: 520, maxHeight: "90vh",
            overflowY: "auto", borderRadius: 16, border: "1px solid var(--border)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>⭐ {name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Même évaluation pour : {ready.map(x => x.title || x.design_id).join(", ")}</div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Fermer" style={{ background: "none", border: "none", color: "var(--muted)",
                fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <RateForm x={{ ...ready[0], photos }} targets={ready} onDone={() => setOpen(false)}/>
          </div>
        </div>, document.body
      )}
    </div>
  );
}

export const rateUrl = (did) => `https://makerworld.com/fr/models/${did}`;

const day = d => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";

export function ToRateTile({ data, onClick, card }) {
  const n = data?.items?.length || 0;
  const covers = (data?.items || []).flatMap(x => x.photos?.length ? [x.photos[0]] : x.cover_url ? [x.cover_url] : []).slice(0, 4);
  return (
    <button onClick={onClick} style={{ ...card, cursor: "pointer", padding: 0, textAlign: "left", color: "var(--text)", position: "relative",
      border: "1.5px solid rgba(245,158,11,0.6)", boxShadow: "0 10px 24px -14px #F59E0B" }}>
      {/* Carre fixe, 2x2 cases fixes : une photo en portrait ne doit pas etirer la tuile. */}
      <div style={{ position: "relative", aspectRatio: "1", background: "var(--surface)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
          {covers.map((u, i) => u.startsWith("/api/")
            ? <img key={i} src={u} alt="" style={{ width: "100%", height: "100%", minHeight: 0, objectFit: "cover", display: "block" }}/>
            : <MwImg key={i} src={u} w={160} style={{ width: "100%", height: "100%", minHeight: 0, objectFit: "cover", display: "block" }}/>)}
        </div>
        {/* le nom pose sur la mosaique, comme les collections ; l'etoile au milieu */}
        <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(245,158,11,0.18), transparent 40%, rgba(2,6,23,0.85))" }}/>
        <span style={{ position: "absolute", left: "50%", top: "42%", transform: "translate(-50%, -50%)", width: 54, height: 54, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, background: "linear-gradient(135deg, #F59E0B, #FBBF24)",
          boxShadow: "0 8px 22px rgba(245,158,11,.55)" }}>⭐</span>
        <span style={{ position: "absolute", left: 10, right: 10, bottom: 9, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 900, color: "#fff", textShadow: "0 1px 6px rgba(0,0,0,.5)" }}>À évaluer</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,.8)" }}>{n} modèle{n > 1 ? "s" : ""} imprimé{n > 1 ? "s" : ""}</span>
        </span>
      </div>
    </button>
  );
}

// Oublier sans evaluer : MakerWorld ne demande plus d'evaluation pour ce modele
// (toutes ses fiches a faire, une par profil imprime). Par la file du serveur.
export async function forgetIt(x, onDone) {
  const ids = x.rating_ids?.length ? x.rating_ids : x.rating_id ? [x.rating_id] : [];
  if (!ids.length) return;
  if (!(await showConfirm(`MakerWorld ne te demandera plus d'évaluer « ${x.title || `Modèle ${x.design_id}`} »`
      + (ids.length > 1 ? ` (${ids.length} profils)` : "") + ". C'est définitif.",
    { title: "Oublier sans évaluer ?", confirmLabel: "Oublier", danger: true }))) return;
  try {
    await useShares.getState().forgetRating(x.design_id, ids, x.title || `Modèle ${x.design_id}`);
    markRated(x.design_id);
    onDone?.();
  } catch (e) {
    showAlert(e.response?.data?.detail || e.message);
  }
}

// Evaluer sans quitter l'appli : note, texte et mes photos, envoyes a MakerWorld.
function RateForm({ x, targets, onDone }) {
  const [score, setScore] = useState(5);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState(() => new Set((x.photos || []).slice(0, 8)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Message tout fait (5 etoiles) : famille choisie, tirage au hasard ; tant
  // qu'on ne le touche pas, il suit la famille et s'efface sous 5 etoiles.
  const fams = useTemplates();
  const [fam, setFam] = useState(0);
  const [auto, setAuto] = useState(false);
  const many = (targets || [x]).length > 1;
  const fill = m => m.replaceAll("{modèle}", many ? "ce modèle" : (x.title || "ce modèle"))
    .replaceAll("{créateur}", !many && x.creator_name ? x.creator_name : "au créateur");
  const draw = (fi = fam, avoid = text) => {
    const raw = (fams?.[fi]?.messages || []).filter(Boolean);
    if (!raw.length) return;
    const pool = raw.length > 1 ? raw.filter(m => m !== _lastDrawn && fill(m) !== avoid) : raw;
    const pick = (pool.length ? pool : raw)[Math.floor(Math.random() * (pool.length || raw.length))];
    _lastDrawn = pick;
    setText(fill(pick));
    setAuto(true);
  };
  // A l'ouverture, des que les familles sont lues : un message au hasard.
  useEffect(() => { if (fams?.length && score === 5 && !text) draw(0, ""); }, [fams]);
  useEffect(() => { if (score < 5 && auto) { setText(""); setAuto(false); } }, [score]);
  // Photos prises ailleurs que dans la galerie : envoyees au serveur tout de
  // suite (gardees le temps de publier), apercu local en attendant.
  const [extras, setExtras] = useState([]);       // [{ id, preview, sending }]
  const fileRef = React.useRef(null);
  const addFiles = async (list) => {
    for (const f of [...list]) {
      if (picked.size + extras.filter(e => e.sending).length >= 8) break;
      const preview = URL.createObjectURL(f);
      const key = preview;
      setExtras(x => [...x, { key, preview, sending: true }]);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const { data } = await client.post("/makerworld/rate-photo", fd, { timeout: 120000 });
        setExtras(x => x.map(e => e.key === key ? { ...e, id: data.id, sending: false } : e));
        setPicked(s => new Set(s).add(data.id));
      } catch (e) {
        setExtras(x => x.filter(e2 => e2.key !== key));
        setErr(e.response?.data?.detail || e.message);
      }
    }
  };
  const low = score < 4;
  const toggle = u => setPicked(s => {
    const n = new Set(s);
    n.has(u) ? n.delete(u) : n.size < 8 && n.add(u);
    return n;
  });
  // Publication en arriere-plan, suivie par la puce d'etat (comme l'ajout de
  // photos) : le modele quitte la liste tout de suite, et y revient en cas d'echec.
  const send = async () => {
    const n = (targets || [x]).reduce((s, t) => s + (t.profiles?.length || 1), 0);
    if (!(await showConfirm(`${score} étoile${score > 1 ? "s" : ""}, ${picked.size} photo${picked.size > 1 ? "s" : ""}`
      + (n > 1 ? `, sur ${n} profils` : ""), { title: "Publier sur MakerWorld ?", confirmLabel: "Publier" }))) return;
    // Un groupe : la meme note pour chacun de ses modeles attendus. Chaque
    // evaluation part dans la file du serveur, qui les publie l'une apres l'autre.
    setBusy(true);
    // ... et chaque PROFIL imprime de ce modele (MakerWorld attend une note par profil).
    for (const t of targets || [x]) {
      const profs = t.profiles?.length ? t.profiles : [{ rating_id: t.rating_id }];
      try {
        for (const pf of profs) {
          const body = { rating_id: pf.rating_id, score, content: text, photos: [...picked] };
          await useShares.getState().rate(body, t.design_id,
            (t.title || `Modèle ${t.design_id}`) + (profs.length > 1 && pf.title ? ` · ${pf.title}` : ""));
        }
        markRated(t.design_id);
      } catch (e) {
        setErr(e.response?.data?.detail || e.message);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    onDone();
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 12, borderRadius: 16, background: "var(--surface)",
      border: "1px solid rgba(245,158,11,0.35)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => setScore(n)} aria-label={`${n} étoiles`} style={{ background: "none", border: "none", padding: 2,
            cursor: "pointer", fontSize: 30, lineHeight: 1, color: n <= score ? "#f59e0b" : "var(--border)",
            filter: n <= score ? "drop-shadow(0 2px 6px rgba(245,158,11,.45))" : "none", transform: n <= score ? "scale(1.04)" : "none", transition: "transform .12s" }}>★</button>
        ))}
        <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 900, color: "#d97706" }}>{score}/5</span>
      </div>
      {score === 5 && fams?.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select value={fam} onChange={e => { const i = Number(e.target.value); setFam(i); draw(i); }}
            style={{ flex: 1, minWidth: 0, height: 36, borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface2)",
              color: "var(--text)", padding: "0 10px", fontSize: 12.5, fontWeight: 700 }}>
            {fams.map((f, i) => <option key={i} value={i}>{f.name} ({f.messages.length})</option>)}
          </select>
          <button onClick={() => draw()} data-tip="Un autre message de cette famille" style={{ width: 36, height: 36, borderRadius: 12, fontSize: 14,
            cursor: "pointer", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }}>🔀</button>
        </div>
      )}
      <textarea value={text} onChange={e => { setText(e.target.value); setAuto(false); }} rows={4} maxLength={2000}
        placeholder={low ? "Qu'est-ce qui n'a pas marché ? (obligatoire)" : "Ton avis (facultatif)"}
        style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)",
          color: "var(--text)", padding: 10, fontSize: 13, resize: "vertical", fontFamily: "inherit" }}/>
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 }}>
          {picked.size ? `Photos jointes (${picked.size}) : touche pour retirer ou ajouter` : "Sans photo, c'est possible aussi"}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {(x.photos || []).map(u => (
            <img key={u} src={u} alt="" onClick={() => toggle(u)} style={{ width: 58, height: 58, borderRadius: 12, objectFit: "cover",
              cursor: "pointer", border: picked.has(u) ? "2px solid #f59e0b" : "2px solid transparent", opacity: picked.has(u) ? 1 : 0.4 }}/>
          ))}
          {extras.map(e => (
            <div key={e.key} style={{ position: "relative" }}>
              <img src={e.preview} alt="" onClick={() => e.id && toggle(e.id)} style={{ width: 58, height: 58, borderRadius: 12, objectFit: "cover",
                cursor: "pointer", border: e.id && picked.has(e.id) ? "2px solid #f59e0b" : "2px solid transparent",
                opacity: e.sending ? 0.5 : e.id && picked.has(e.id) ? 1 : 0.4 }}/>
              {e.sending && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, color: "white", fontWeight: 700 }}>…</span>}
            </div>
          ))}
          <button onClick={() => fileRef.current?.click()} disabled={picked.size >= 8} data-tip="Ajouter une photo (hors galerie)"
            style={{ width: 58, height: 58, borderRadius: 12, border: "1.5px dashed var(--border)", background: "var(--surface)",
              color: "var(--muted)", fontSize: 22, cursor: "pointer", opacity: picked.size >= 8 ? 0.4 : 1 }}>+</button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
            onChange={e => { addFiles(e.target.files); e.target.value = ""; }}/>
        </div>
      </div>
      {err && <div style={{ fontSize: 12, color: "#ef4444" }}>{err}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button onClick={send} disabled={busy || extras.some(e => e.sending) || (low && text.trim().length < 10)} style={{ alignSelf: "flex-start", padding: "10px 18px",
        borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: "pointer", background: "linear-gradient(135deg, #F59E0B, #F97316)", color: "white", border: "none",
        boxShadow: "0 8px 18px -10px #F59E0B",
        opacity: busy || (low && text.trim().length < 10) ? 0.5 : 1 }}>{busy ? "Publication…" : "Publier l'évaluation"}</button>
        {!targets && <button onClick={() => forgetIt(x, onDone)} disabled={busy} title="Supprime la demande d'évaluation sur MakerWorld"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--muted)",
            textDecoration: "underline" }}>Oublier sans évaluer</button>}
      </div>
    </div>
  );
}

const act = { padding: "9px 8px", borderRadius: 12, fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap", minWidth: 0,
  overflow: "hidden", textOverflow: "ellipsis", textAlign: "center", boxSizing: "border-box", cursor: "pointer",
  background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" };
export function ToRateSheet({ data, onClose, onOpen }) {
  useTrackDetail("MakerWorld · À évaluer");
  const [view, setView] = useState(null);
  const [open, setOpen] = useState(null);
  const [done, setDone] = useState(() => new Set());
  const can = useCanMwHome();
  const items = (data?.items || []).filter(x => !done.has(x.design_id)).map(x => can ? x : { ...x, rating_id: null });
  return (
    <div data-no-pull="" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 4100, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} className="sheet-panel" style={{ width: "100%", maxWidth: 760, height: "92vh",
        borderRadius: "22px 22px 0 0", border: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 12px", borderBottom: "1px solid var(--border)",
          background: "linear-gradient(135deg, rgba(245,158,11,0.24), transparent 70%)" }}>
          <span style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
            background: "linear-gradient(135deg, #F59E0B, #FBBF24)", boxShadow: "0 6px 16px -6px #F59E0B" }}>⭐</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>À évaluer</span>
              {items.length > 0 && <span style={{ fontSize: 12, fontWeight: 900, color: "#fff", padding: "1px 8px", borderRadius: 20,
                background: "linear-gradient(135deg, #F59E0B, #F97316)" }}>{items.length}</span>}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>
              {data?.rated_known === false ? "Tes évaluations n'ont pas pu être lues : tout est listé."
                : "Imprimés, pas encore évalués. Tes photos sont prêtes à joindre."}
              {data?.stats && <span> · MakerWorld : {data.stats.pending} en attente, {data.stats.rated} déjà notés</span>}</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: "50%", border: "1px solid var(--border)", flexShrink: 0,
            background: "var(--surface2)", color: "var(--text2)", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {!items.length && <div style={{ textAlign: "center", padding: "30px 16px", borderRadius: 18, border: "1px dashed var(--border)",
            background: "radial-gradient(80% 80% at 50% 0%, rgba(34,197,94,0.14), transparent 70%), var(--surface2)" }}>
            <div style={{ fontSize: 34 }}>🎉</div>
            <p style={{ color: "var(--muted)", fontSize: 13.5, fontWeight: 700, margin: "6px 0 0" }}>Rien à évaluer 🎉</p></div>}
          {items.map(x => (
            <div key={x.design_id} style={{ padding: 12, display: "flex", flexDirection: "column", gap: 9, borderRadius: 18,
              border: open === x.design_id ? "1.5px solid rgba(245,158,11,0.6)" : "1px solid color-mix(in srgb, #F59E0B 25%, var(--border))",
              background: "linear-gradient(160deg, rgba(245,158,11,0.10), transparent 45%), var(--surface2)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {x.cover_url ? <MwImg src={x.cover_url} w={120} style={{ width: 56, height: 56, borderRadius: 14, objectFit: "cover", flexShrink: 0,
                  boxShadow: "0 6px 14px -8px rgba(0,0,0,.5)" }}/>
                  : <span style={{ width: 56, height: 56, borderRadius: 14, background: "var(--surface)", flexShrink: 0 }}/>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {x.title || x.print_name || `Modèle ${x.design_id}`}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>
                    {[x.creator_name && `par ${x.creator_name}`, x.printed > 0 && `imprimé ${x.printed}×`, x.last_date && `le ${day(x.last_date)}`].filter(Boolean).join(" · ")}</div>
                  {x.awaited && <div style={{ display: "inline-block", maxWidth: "100%", marginTop: 3, fontSize: 10.5, fontWeight: 800, color: "#d97706", padding: "1px 8px",
                    borderRadius: 20, background: "rgba(245,158,11,0.14)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", boxSizing: "border-box" }}>
                    ⏳ Attendu par MakerWorld{x.profile_title ? ` · profil « ${x.profile_title} »` : ""}</div>}
                </div>
              </div>
              {x.photos?.length > 0 ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {x.photos.map((u, i) => (
                    <img key={i} src={u} alt="" onClick={() => setView({ images: x.photos, index: i })}
                      style={{ width: 62, height: 62, borderRadius: 12, objectFit: "cover", cursor: "pointer", border: "1px solid var(--border)" }}/>
                  ))}
                  <span style={{ alignSelf: "center", fontSize: 10.5, color: "var(--muted)" }}>
                    {x.photo_source === "group" ? "photos du groupe" : "tes photos"}</span>
                </div>
              ) : <div style={{ fontSize: 11, color: "var(--muted)" }}>Pas de photo de cette impression.</div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                {x.rating_id ? (
                  <button onClick={() => setOpen(o => o === x.design_id ? null : x.design_id)} style={{ ...act, border: "none", color: "white",
                    background: open === x.design_id ? "var(--muted)" : "linear-gradient(135deg, #F59E0B, #F97316)", boxShadow: "0 6px 14px -8px #F59E0B" }}>
                    {open === x.design_id ? "Fermer" : "⭐ Évaluer ici"}</button>
                ) : null}
                {x.rating_id && (
                  <button onClick={() => forgetIt(x, () => setDone(s => new Set(s).add(x.design_id)))} title="Ne plus me demander d'évaluer ce modèle"
                    style={{ ...act, color: "var(--muted)" }}>Oublier</button>
                )}
                <a href={x.url} target="_blank" rel="noopener noreferrer" data-tip={x.rating_id ? "Le modèle sur MakerWorld" : "Évaluer sur MakerWorld"}
                  style={{ ...act, textDecoration: "none",
                  ...(x.rating_id ? { color: "#06B6D4" } : { background: "linear-gradient(135deg, #F59E0B, #F97316)", color: "white", border: "none" }) }}>{x.rating_id ? "MakerWorld ↗" : "⭐ Évaluer ↗"}</a>
                <button onClick={() => onOpen?.(x)} style={{ ...act, color: "#3B82F6" }}>📄 Fiche</button>
              </div>
              {open === x.design_id && <RateForm x={x} onDone={() => { setDone(s => new Set(s).add(x.design_id)); setOpen(null); }}/>}
            </div>
          ))}
        </div>
      </div>
      {view && <div onClick={e => e.stopPropagation()}><Lightbox images={view.images} index={view.index} onClose={() => setView(null)}/></div>}
    </div>
  );
}
