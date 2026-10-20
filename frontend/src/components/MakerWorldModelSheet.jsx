import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import AdminOnly from "./AdminOnly";
import MakerWorldCollectionsPicker from "./MakerWorldCollectionsPicker";
import { mwLiked } from "../utils/mwSync";
import { useMwAssign } from "../store/mwAssign";
import { useFriend } from "../store/friend";
import MwImg from "./MwImg";
import MwStockMatch, { stockSummary, setPicksFromPlan, picksOf } from "./MwStockMatch";
import Lightbox from "./Lightbox";
import { openCreator } from "./MwCreatorPage";
import { useToRateSet, RateButton } from "./MwToRate";
import { showAlert, showConfirm } from "../utils/dialog";

// Prechargement : la fiche est demandee des qu'on touche une tuile ; a
// l'ouverture, la reponse est souvent deja la.
const MODELS = new Map();                         // id -> { t, p } ; 5 min (statut « imprime » a jour)
export function prefetchModel(id) {
  if (!id) return;
  const k = String(id), hit = MODELS.get(k);
  if (hit && Date.now() - hit.t < 300000) return;
  const p = client.get(`/makerworld/model/${id}`).then(r => r.data);
  p.catch(() => MODELS.delete(k));
  MODELS.set(k, { t: Date.now(), p });
}
function getModel(id) {
  prefetchModel(id);
  return MODELS.get(String(id)).p;
}

// Fiche d'un modele MakerWorld dans l'appli : galerie, createur, compteurs,
// descriptif, profils et leurs plateaux (coches s'ils sont imprimes),
// commentaires. Lecture seule ; le lien vers le site reste a portee.
const fmtK = n => n == null ? null : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
const fmtDur = s => { if (!s) return null; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`; };
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString("fr-FR", { day:"numeric", month:"short", year:"numeric" }); } catch { return ""; } };

export default function MakerWorldModelSheet({ designId, preview, onClose, onSearch }) {
  const [id, setId] = useState(designId);          // permet d'ouvrir un similaire sans empiler
  const [m, setM] = useState(null);
  const [more, setMore] = useState(false);         // descriptif deplie
  const [allProfs, setAllProfs] = useState(false); // profils : les 4 premiers, puis « voir plus »
  const [orig, setOrig] = useState(false);         // descriptif : original au lieu du francais
  const [origC, setOrigC] = useState({});          // commentaires montres dans l'original
  const [open, setOpen] = useState(null);          // profil deplie (instance_id)
  const [com, setCom] = useState(null);            // { items, total }
  const [comBusy, setComBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [sim, setSim] = useState(null);
  const [zoom, setZoom] = useState(null);          // galerie plein ecran { images, index }
  const [exactBusy, setExactBusy] = useState(null);
  const [plan, setPlan] = useState(null);            // plan retenu pour la file (profil, plateaux, filaments)
  const [planBusy, setPlanBusy] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);
  // Profil a imprimer : celui qui est deplie, sinon celui retenu.
  const printProfile = () => (m?.profiles || []).find(p => p.instance_id === open)
    || (m?.profiles || []).find(p => p.main) || m?.profiles?.[0] || null;
  // Profil « retenu » pour le bouton du haut : celui choisi pour « A faire »,
  // sinon le choix automatique (profils deja classes pour mon imprimante).
  const keptProfile = () => (m?.profiles || []).find(p => p.instance_id === plan?.instance_id)
    || m?.profiles?.[0] || null;            // le serveur les range deja pour mon imprimante
  const openStudio = async (p = printProfile()) => {
    if (!p) return showAlert("Aucun profil imprimable sur ce modèle.");
    setStudioBusy(p.instance_id);
    try {
      const { data } = await client.get(`/makerworld/model/${id}/studio/${p.instance_id}`,
        { params: p.dev_model ? { dev_model: p.dev_model } : {} });
      // Meme forme que le site : lien du fichier + nom, encodes ensemble.
      const n = encodeURIComponent(`${data.url}&name=${String(data.name || "modele.3mf").replace(/[\\/:*?"<>|&\s#]/g, "_")}`);
      // La forme qui charge le fichier depend du systeme (essais du 19/10/2026) :
      // bambustudioopen:// sur Mac, bambustudio://open?file= sur Windows (ou
      // bambustudioopen:// lancait Studio sans rien charger).
      launch(IS_MAC ? `bambustudioopen://${n}` : `bambustudio://open?file=${n}`);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setStudioBusy(false);
  };
  const startAssign = useMwAssign((s) => s.start);
  const friend = useFriend((s) => s.friend); // profil dont le 3MF est en lecture
  const [plateSel, setPlateSel] = useState({});    // instance_id -> plateaux choisis (absent = tous)
  const [showCom, setShowCom] = useState(false);   // commentaires replies (charges a l'ouverture)
  const [like, setLike] = useState(null);          // { liked } avec mon compte ; null = inconnu / pas connecte
  const [likeBusy, setLikeBusy] = useState(false);

  // Boost : le droit a depenser pour CE modele et mes boosts disponibles
  // (compte connecte seulement ; sans droit, pas de bouton).
  const toRate = useToRateSet(!friend);           // imprime, pas encore evalue
  const [boost, setBoost] = useState(null);       // { can, available }
  const [boostBusy, setBoostBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setBoost(null);
    Promise.all([client.get(`/makerworld/model/${id}/boost`), client.get("/makerworld/boosts")])
      .then(([a, b]) => alive && a.data.known && setBoost({ ...a.data, available: a.data.available ?? b.data.available }))
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);
  const doBoost = async () => {
    const n = boost?.available;
    if (!await showConfirm(`Booster « ${m?.title_fr || m?.title || "ce modèle"} » ? Ça utilise un de tes boosts`
      + (n != null ? ` (il t'en reste ${n}).` : "."), { confirmLabel: "⚡ Booster" })) return;
    setBoostBusy(true);
    try {
      const { data } = await client.post(`/makerworld/model/${id}/boost`);
      setBoost({ can: false, available: data.available, done: true });
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setBoostBusy(false);
  };

  // Etat du j'aime (compte connecte seulement ; sinon pas de bouton).
  useEffect(() => {
    let alive = true;
    setLike(null);
    client.get(`/makerworld/model/${id}/like`).then(({ data }) => alive && data.known && setLike(data)).catch(() => {});
    return () => { alive = false; };
  }, [id]);
  // La tuile de ce modele, pour l'ajouter aussitot a une liste (j'aime, collection).
  const tile = () => String(preview?.design_id) === String(id) ? preview
    : m ? { design_id: String(id), title: m.title, title_fr: m.title_fr, cover_url: m.pictures?.[0] || m.cover_url,
            creator_name: m.creator_name, url: `https://makerworld.com/fr/models/${id}` } : null;
  // Filaments exacts d'un profil (finition, reference, marque) : lus dans son
  // 3MF, a la demande, une seule fois (garde ensuite sur le serveur).
  const readExact = async p => {
    if (!await showConfirm("Lire les filaments exacts de ce profil ? BambuNymous télécharge son fichier 3MF "
      + "avec ton compte MakerWorld (ça compte comme un téléchargement sur le site), une seule fois.")) return;
    setExactBusy(p.instance_id);
    try {
      const { data } = await client.post(`/makerworld/model/${id}/exact/${p.instance_id}`);
      setM(data);
      MODELS.set(String(id), { t: Date.now(), p: Promise.resolve(data) });
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setExactBusy(null);
  };
  const [planDone, setPlanDone] = useState(null);   // « Retenu » / « Mis à jour », un instant
  const planDoneT = useRef(null);
  const pinPlan = async (p) => {
    setPlanBusy(true);
    try {
      const body = { instance_id: p.instance_id, plates: plateSel[p.instance_id] || null,
        picks: picksOf(`${id}|${p.instance_id}`, m.stock?.[p.instance_id]) };
      const { data } = await client.put(`/makerworld/queue/plan/${id}`, body);
      // Retour visible : le bouton passe a « ✓ Enregistre » un instant
      const updating = plan?.instance_id === p.instance_id;
      setPlan(data);
      setPlanDone(updating ? "Mis à jour" : "Retenu");
      clearTimeout(planDoneT.current);
      planDoneT.current = setTimeout(() => setPlanDone(null), 1800);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setPlanBusy(false);
  };
  const unpinPlan = async () => {
    setPlanBusy(true);
    try { await client.delete(`/makerworld/queue/plan/${id}`); setPlan(null); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    setPlanBusy(false);
  };
  const toggleLike = async () => {
    const want = !like.liked;
    setLike(l => ({ ...l, liked: want })); setLikeBusy(true);          // tout de suite a l'ecran
    try {
      const { data } = await client.put(`/makerworld/model/${id}/like`, { liked: want }); setLike(data);
      mwLiked(id, data.known === false ? want : data.liked, tile());
    }
    catch (e) { setLike(l => ({ ...l, liked: !want })); showAlert(e.response?.data?.detail || e.message); }
    setLikeBusy(false);
  };

  useEffect(() => {
    let alive = true;
    setM(null); setCom(null); setSim(null); setMore(false); setAllProfs(false); setShowCom(false);
    getModel(id).then(data => {
      if (!alive) return;
      setM(data);
      setOpen(null);          // profils replies a l'ouverture : on deplie celui qu'on veut voir
      // Plan deja retenu pour la file : on le remet (profil deplie, plateaux, filaments).
      client.get("/makerworld/queue/config").then(({ data: c }) => {
        const pl = c.plans?.[String(id)];
        if (!alive || !pl) { if (alive) setPlan(null); return; }
        setPlan(pl);
        setPicksFromPlan(`${id}|${pl.instance_id}`, data.stock?.[pl.instance_id], pl.picks)
          .then(() => alive && setM(x => x && { ...x }));     // choix trouves par recherche : relus, on redessine
        if (pl.plates) setPlateSel(s => ({ ...s, [pl.instance_id]: pl.plates }));
        setOpen(pl.instance_id);
      }).catch(() => {});
    }).catch(e => alive && setM({ error: e.response?.data?.detail || e.message }));
    client.get(`/makerworld/similar/${id}`).then(({ data }) => alive && setSim(data.items || [])).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // Commentaires lus seulement quand on deplie la section.
  useEffect(() => {
    if (!showCom || com) return;
    let alive = true;
    client.get(`/makerworld/model/${id}/comments`).then(({ data }) => alive && setCom(data))
      .catch(() => alive && setCom({ items: [], total: 0 }));
    return () => { alive = false; };
  }, [showCom, id]);

  const moreComments = () => {
    setComBusy(true);
    client.get(`/makerworld/model/${id}/comments`, { params: { offset: com.items.length } })
      .then(({ data }) => setCom(c => ({ ...c, items: [...c.items, ...(data.items || [])] })))
      .finally(() => setComBusy(false));
  };

  const done = new Set(m?.printed_plates || []);
  const plateDone = (prof, idx) => done.has(`${prof.profile_id}:${idx}`) || done.has(`:${idx}`);

  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4200, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:640, height:"92dvh", display:"flex", flexDirection:"column",
        paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 16px 8px" }}>
          <span style={{ flex:1, fontSize:11, fontWeight:700, color:"#3b82f6", letterSpacing:0.3 }}>MAKERWORLD</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"0 16px 20px" }}>
          {m === null ? (
            // Ouverture immediate avec ce que la tuile savait deja.
            <div>
              <div style={{ display:"flex", gap:8, margin:"0 -16px 12px", padding:"0 16px" }}>
                {preview?.cover_url
                  ? <MwImg src={preview.cover_url} w={360} eager style={{ width:"78%", maxWidth:360, aspectRatio:"1",
                      objectFit:"cover", borderRadius:12, background:"var(--surface2)" }}/>
                  : <div className="mw-skel" style={{ width:"78%", maxWidth:360, aspectRatio:"1", borderRadius:12 }}/>}
              </div>
              <h2 style={{ fontSize:17, fontWeight:800, color:"var(--text)", margin:"0 0 6px" }}>
                {preview?.title_fr || preview?.title || ""}</h2>
              {[90, 70, 80, 60].map((w, i) => <div key={i} className="mw-skel" style={{ height:12, width:`${w}%`, borderRadius:6, margin:"8px 0" }}/>)}
            </div>
          )
            : m.error ? (<>
              <p style={{ ...msg, color:"#f59e0b" }}>{m.error}</p>
              <a href={m.url || `https://makerworld.com/fr/models/${id}`} target="_blank" rel="noopener noreferrer" style={linkBtn}>Ouvrir sur MakerWorld ↗</a>
            </>) : (<>
            {/* Galerie */}
            {m.pictures?.length > 0 && (
              <div style={{ display:"flex", gap:8, overflowX:"auto", scrollSnapType:"x mandatory", margin:"0 -16px 12px",
                padding:"0 16px" }}>
                {m.pictures.map((u, i) => (
                  <a key={i} href={u} onClick={e => { e.preventDefault(); setZoom({ images: m.pictures, index: i }); }}
                    style={{ flexShrink:0, width:"78%", maxWidth:360, scrollSnapAlign:"center", cursor:"zoom-in" }}>
                    <MwImg src={u} w={360} eager={i < 2}
                      style={{ width:"100%", aspectRatio:"1", objectFit:"cover", borderRadius:12, display:"block",
                        background:"var(--surface2)" }}/>
                  </a>
                ))}
              </div>
            )}

            <h2 style={{ fontSize:17, fontWeight:800, color:"var(--text)", margin:"0 0 2px", lineHeight:1.3 }}>{m.title_fr || m.title}</h2>
            {m.title_fr && m.title_fr !== m.title && <div style={{ fontSize:12, color:"var(--muted)" }}>{m.title}</div>}
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"var(--muted)", margin:"6px 0" }}>
              {m.creator_avatar && <MwImg src={m.creator_avatar} w={36} style={{ width:18, height:18, borderRadius:"50%" }}/>}
              <span>par {m.creator_uid
                ? <button onClick={() => { onClose?.(); openCreator({ uid: m.creator_uid, name: m.creator_name }); }}
                    title="Tous ses modèles" style={{ background:"none", border:"none", padding:0, cursor:"pointer",
                      fontWeight:700, color:"#3b82f6", fontSize:"inherit" }}>{m.creator_name}</button>
                : <b style={{ color:"var(--text2)" }}>{m.creator_name}</b>}{m.created ? ` · ${fmtDate(m.created)}` : ""}</span>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:10, fontSize:12, color:"var(--muted)", margin:"4px 0 10px" }}>
              {[["❤", m.like_count, "j'aime"], ["⬇", m.download_count, "téléchargements"], ["🖨", m.print_count, "impressions"],
                ["⭐", m.collection_count, "collections"], ["💬", m.comment_count, "commentaires"]]
                .filter(([, n]) => n != null).map(([i, n, l]) => <span key={l} title={`${n} ${l}`}>{i} {fmtK(n)}</span>)}
            </div>

            {(m.printed > 0 || m.in_progress > 0) && (
              <div style={{ padding:"8px 12px", borderRadius:10, marginBottom:10, fontSize:12.5, fontWeight:700,
                background: m.printed ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
                color: m.printed ? "#22c55e" : "#f59e0b", border:`1px solid ${m.printed ? "#22c55e55" : "#f59e0b55"}` }}>
                {m.printed ? `✓ Imprimé · ${m.printed} impression${m.printed > 1 ? "s" : ""}` : "⏳ En cours d'impression"}
                {m.in_progress > 0 && m.printed > 0 ? " · une en cours" : ""}
                {m.printed > 0 && onSearch && (
                  <button onClick={() => { onSearch(m); onClose(); }} style={{ marginLeft:8, fontSize:11.5, fontWeight:600,
                    color:"#22c55e", background:"none", border:"none", textDecoration:"underline", cursor:"pointer", padding:0 }}>
                    voir mes prints</button>
                )}
              </div>
            )}

            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
              <a href={m.url} target="_blank" rel="noopener noreferrer" style={linkBtn}>Ouvrir sur MakerWorld ↗</a>
              {/* Ouvrir le profil retenu (pour « A faire », sinon automatique) sans le chercher dans la liste. */}
              {(() => {
                const kp = keptProfile();
                if (!kp) return null;
                const tip = `Profil ${plan?.instance_id === kp.instance_id ? "retenu" : "choisi automatiquement"} : ${kp.title || kp.instance_id}`;
                return IS_MOBILE ? (
                  <a href={handyUrl(id, kp)} target="_blank" rel="noopener noreferrer" title={tip}
                    style={{ ...linkBtn, color:"white", background:"#22c55e", borderColor:"#22c55e" }}>📱 Ouvrir dans Handy</a>
                ) : (
                  <AdminOnly home mw><button onClick={() => openStudio(kp)} disabled={studioBusy === kp.instance_id} title={tip}
                    style={{ ...linkBtn, cursor:"pointer", color:"white", background:"#22c55e", borderColor:"#22c55e" }}>
                    {studioBusy === kp.instance_id ? "…" : "🖥️ Ouvrir dans Studio"}</button></AdminOnly>
                );
              })()}
              {like && (
                <AdminOnly home mw><button onClick={toggleLike} disabled={likeBusy}
                  style={{ ...linkBtn, cursor:"pointer", ...(like.liked ? { color:"#ef4444", background:"rgba(239,68,68,0.1)",
                    borderColor:"rgba(239,68,68,0.35)" } : null) }}>
                  {like.liked ? "❤ Aimé" : "♡ J'aime"}</button></AdminOnly>
              )}
              {boost && (boost.can || boost.done) && (
                <AdminOnly home mw><button onClick={doBoost} disabled={boostBusy || boost.done}
                  title={[boost.available != null && `${boost.available} boost(s) disponible(s)`,
                    boost.creator_max != null && `${boost.creator ?? 0}/${boost.creator_max} donnés à ce créateur cette année`]
                    .filter(Boolean).join(" · ") || undefined}
                  style={{ ...linkBtn, cursor: boost.done ? "default" : "pointer", color:"#f59e0b", borderColor:"rgba(245,158,11,0.4)",
                    background:"rgba(245,158,11,0.08)" }}>
                  {boost.done ? "⚡ Boosté" : `⚡ ${boost.boosted ? "Booster encore" : "Booster"}${boost.available != null ? ` · ${boost.available} dispo` : ""}`}</button></AdminOnly>
              )}
              {toRate.has(String(id)) && (
                <RateButton did={id} style={{ ...linkBtn, color:"white", background:"#f59e0b", borderColor:"#f59e0b" }}/>
              )}
              {/* Pas de boost possible : la raison, discrete (deja booste, limite par createur, plus de boost). */}
              {boost && !boost.can && !boost.done && boost.reason && (
                <AdminOnly home mw><span title="Règle de MakerWorld" style={{ ...linkBtn, color:"var(--muted)", cursor:"default",
                  background:"none", borderStyle:"dashed" }}>⚡ {boost.reason}</span></AdminOnly>
              )}
              {!friend && (
                <AdminOnly><button onClick={() => { startAssign(tile()); onClose(); }}
                  title="Choisir les impressions de ce modèle dans l'historique" style={{ ...linkBtn, cursor:"pointer" }}>
                  🔗 Associer à un print</button></AdminOnly>
              )}
              <AdminOnly home mw><button onClick={() => setPick(true)} style={{ ...linkBtn, cursor:"pointer" }}>☆ Collections</button></AdminOnly>
            </div>
            {zoom && <Lightbox images={zoom.images} index={zoom.index} onClose={() => setZoom(null)}/>}
            {pick && <MakerWorldCollectionsPicker designId={id} title={m.title} item={tile()} onClose={() => setPick(false)}/>}

            {m.categories?.length > 0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
                {m.categories.map(c => <span key={c} style={chip}>{c}</span>)}
                {m.license && <span style={{ ...chip, background:"var(--surface2)", color:"var(--muted)" }}>{m.license}</span>}
              </div>
            )}

            {/* Descriptif */}
            {m.description && (
              <Section title="Descriptif">
                <div style={{ fontSize:13, color:"var(--text2)", lineHeight:1.55, whiteSpace:"pre-wrap",
                  ...(more ? null : { maxHeight:150, overflow:"hidden", maskImage:"linear-gradient(#000 70%, transparent)" }) }}>
                  {orig && m.description_original ? m.description_original : m.description}
                </div>
                <div style={{ display:"flex", gap:14 }}>
                  {m.description.length > 300 && (
                    <button onClick={() => setMore(v => !v)} style={textBtn}>{more ? "Réduire" : "Lire la suite"}</button>
                  )}
                  {m.description_original && (
                    <button onClick={() => setOrig(v => !v)} style={{ ...textBtn, color:"var(--muted)" }}>
                      {orig ? "Afficher la traduction" : "Afficher l'original"}</button>
                  )}
                </div>
              </Section>
            )}

            {/* Profils et plateaux */}
            {m.profiles?.length > 0 && (
              <Section title={`Profils (${m.profiles.length})`}>
                {/* Tous les profils listes, chacun replie : on voit d'un coup combien il y en a. */}
                {(() => {
                  // Le profil retenu pour « A faire » d'abord, toujours ; puis l'ordre de l'appli.
                  const ps = [...m.profiles].sort((a, b) => (b.instance_id === plan?.instance_id) - (a.instance_id === plan?.instance_id));
                  const LIMIT = 4;
                  // Un profil deplie reste visible meme au-dela des premiers.
                  const shown = allProfs || ps.length <= LIMIT + 1 ? ps
                    : ps.filter((p, i) => i < LIMIT || p.instance_id === open);
                  return (<>
                {shown.map(p => {
                  const isOpen = open === p.instance_id;
                  const nDone = p.plates.filter(pl => plateDone(p, pl.index)).length;
                  return (
                    <div key={p.instance_id} style={{ border:"1px solid var(--border)", borderRadius:10, marginBottom:8,
                      background:"var(--surface2)", overflow:"hidden" }}>
                      <button onClick={() => setOpen(isOpen ? null : p.instance_id)}
                        style={{ width:"100%", textAlign:"left", padding:"9px 10px", background:"none", border:"none",
                          cursor:"pointer", color:"var(--text)" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ flex:1, fontSize:13, fontWeight:700 }} title={p.title_original || undefined}>
                            {p.title || "Profil"}{p.default ? " ★" : ""}</span>
                          {nDone > 0 && <span style={{ fontSize:10.5, fontWeight:800, color:"white", background:"#22c55e",
                            padding:"1px 7px", borderRadius:20 }}>✓ {nDone}/{p.plates.length}</span>}
                          <span style={{ color:"var(--muted)", fontSize:12 }}>{isOpen ? "▾" : "▸"}</span>
                        </div>
                        <div style={{ fontSize:11, color:"var(--muted)", marginTop:2 }}>
                          {[p.printer, `${p.plates.length} plateau${p.plates.length > 1 ? "x" : ""}`,
                            p.weight_g ? `${Math.round(p.weight_g)} g` : null, fmtDur(p.seconds),
                            p.settings?.layerHeight ? `${p.settings.layerHeight} mm` : null,
                            p.settings?.sparseInfillDensity ? `remplissage ${p.settings.sparseInfillDensity}` : null,
                            p.print_count != null ? `${fmtK(p.print_count)} impressions` : null].filter(Boolean).join(" · ")}
                        </div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:4 }}>
                          {p.main && <span style={{ ...pBadge, background:"#3b82f6", border:"none", color:"white" }}>Retenu</span>}
                          {p.fit === 2 ? <span style={{ ...pBadge, color:"#22c55e" }}>🖨️ pour ta {m.printer}</span>
                            : p.fit === 1 ? <span style={{ ...pBadge, color:"#84cc16" }}>🖨️ compatible {m.printer}</span>
                            : m.printer ? <span style={{ ...pBadge, color:"#f59e0b" }}>pas pour ta {m.printer}</span> : null}
                          {p.by_designer ? <span style={pBadge}>✏️ du créateur</span>
                            : p.author ? <span style={{ ...pBadge, color:"var(--muted)" }}>par {p.author}</span> : null}
                          {p.rating != null && <span style={pBadge}>⭐ {p.rating.toFixed(1).replace(".", ",")}
                            {p.rating_count ? ` (${fmtK(p.rating_count)} avis)` : ""}</span>}
                        </div>
                        {!isOpen && stockSummary(m.stock?.[p.instance_id]) && (
                          <div style={{ fontSize:11, color:"var(--text2)", marginTop:2 }}>{stockSummary(m.stock[p.instance_id])}</div>
                        )}
                      </button>
                      {isOpen && p.summary && <ProfileSummary p={p}/>}
                      {/* Imprimer CE profil : Handy (telephone, page open-app de MakerWorld)
                          ou Bambu Studio (ordinateur, lien du 3MF de ce profil). */}
                      {isOpen && (
                        <div style={{ display:"flex", gap:6, padding:"0 10px 8px", flexWrap:"wrap" }}>
                          {!friend && (
                            <AdminOnly mw>
                              <button onClick={() => pinPlan(p)} disabled={planBusy}
                                title="La file d'attente utilisera ce profil, ces plateaux et ces filaments"
                                style={{ ...linkBtn, padding:"5px 10px", fontSize:11.5, cursor:"pointer",
                                  transition:"background .25s, color .25s, transform .15s",
                                  ...(plan?.instance_id === p.instance_id ? { color:"#22c55e", borderColor:"rgba(34,197,94,0.4)" } : null),
                                  ...(planDone && plan?.instance_id === p.instance_id
                                    ? { background:"#22c55e", color:"white", borderColor:"#22c55e", transform:"scale(1.04)" } : null),
                                  ...(planBusy ? { opacity:0.6 } : null) }}>
                                {planBusy ? "📌 Enregistrement…"
                                  : planDone && plan?.instance_id === p.instance_id ? `✓ ${planDone}`
                                  : plan?.instance_id === p.instance_id ? "📌 Retenu pour « À faire » · mettre à jour" : "📌 Retenir pour « À faire »"}</button>
                              {plan?.instance_id === p.instance_id && (
                                <button onClick={unpinPlan} disabled={planBusy} title="Oublier ce choix"
                                  style={{ ...linkBtn, padding:"5px 9px", fontSize:11.5, cursor:"pointer", color:"var(--muted)" }}>✕</button>
                              )}
                            </AdminOnly>
                          )}
                          {IS_MOBILE ? (
                            <a href={handyUrl(id, p)} target="_blank" rel="noopener noreferrer"
                              style={{ ...linkBtn, padding:"5px 10px", fontSize:11.5 }}>📱 Ouvrir ce profil dans Bambu Handy</a>
                          ) : (
                            <AdminOnly home mw><button onClick={() => openStudio(p)} disabled={studioBusy === p.instance_id}
                              title="Compte MakerWorld requis ; compte comme un téléchargement"
                              style={{ ...linkBtn, padding:"5px 10px", fontSize:11.5, cursor:"pointer" }}>
                              {studioBusy === p.instance_id ? "…" : "🖥️ Ouvrir ce profil dans Bambu Studio"}</button></AdminOnly>
                          )}
                        </div>
                      )}
                      {isOpen && m.stock?.[p.instance_id]?.length > 0
                        && !m.stock[p.instance_id].some(x => x.exact) && (
                        <AdminOnly mw>
                          <button onClick={() => readExact(p)} disabled={exactBusy === p.instance_id}
                            style={{ ...textBtn, margin:"0 10px 6px", display:"flex", alignItems:"center", gap:6 }}>
                            {exactBusy === p.instance_id ? <><span className="mw-spin"/> Lecture du 3MF…</>
                              : "🔎 Filaments exacts (finition, référence) — lire le 3MF"}</button>
                        </AdminOnly>
                      )}
                      {isOpen && <MwStockMatch items={m.stock?.[p.instance_id]} plates={p.plates} scope={`${id}|${p.instance_id}`}
                        selected={plateSel[p.instance_id]} onNavigate={onClose}/>}
                      {isOpen && p.plates.length > 1 && (() => {
                        const sel = plateSel[p.instance_id];
                        const setSel = v => setPlateSel(s => ({ ...s, [p.instance_id]: v }));
                        return (
                          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 10px 8px", fontSize:11.5, color:"var(--text2)" }}>
                            <span style={{ flex:1 }}>{sel ? `Stock calculé pour ${sel.length} plateau${sel.length > 1 ? "x" : ""} sur ${p.plates.length}`
                              : "Stock calculé pour tous les plateaux"} · touche un plateau pour l'enlever</span>
                            {sel && <button onClick={() => setSel(undefined)} style={{ ...textBtn, marginTop:0 }}>Tous</button>}
                          </div>
                        );
                      })()}
                      {isOpen && (
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:8, padding:"0 10px 10px" }}>
                          {p.plates.map(pl => {
                            const ok = plateDone(p, pl.index);
                            const sel = plateSel[p.instance_id];
                            const on = !sel || sel.includes(pl.index);
                            const toggle = () => setPlateSel(s => {
                              const cur = s[p.instance_id] || p.plates.map(x => x.index);
                              const next = on ? cur.filter(i => i !== pl.index) : [...cur, pl.index];
                              return { ...s, [p.instance_id]: next.length === p.plates.length ? undefined : next };
                            });
                            return (
                              <div key={pl.index} onClick={p.plates.length > 1 ? toggle : undefined} role={p.plates.length > 1 ? "button" : undefined}
                                aria-pressed={on} style={{ borderRadius:8, overflow:"hidden", background:"var(--surface)",
                                cursor: p.plates.length > 1 ? "pointer" : "default", opacity: on ? 1 : 0.4, transition:"opacity .15s",
                                position:"relative", border: ok ? "2px solid #22c55e" : "1px solid var(--border)" }}>
                                {p.plates.length > 1 && <span style={{ position:"absolute", top:4, right:4, zIndex:1, width:18, height:18,
                                  borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900,
                                  color:"white", background: on ? "#3b82f6" : "rgba(0,0,0,0.45)", border:"1.5px solid white" }}>{on ? "✓" : ""}</span>}
                                <div style={{ position:"relative" }}>
                                  {pl.thumb ? <MwImg src={pl.thumb} w={200}
                                    style={{ width:"100%", aspectRatio:"1", objectFit:"cover", display:"block" }}/>
                                    : <div style={{ width:"100%", aspectRatio:"1" }}/>}
                                  {ok && <span style={{ position:"absolute", top:4, left:4, fontSize:9.5, fontWeight:800, color:"white",
                                    background:"#22c55e", padding:"1px 6px", borderRadius:20 }}>✓ IMPRIMÉ</span>}
                                </div>
                                <div style={{ padding:"5px 6px 6px" }}>
                                  <div style={{ fontSize:11.5, fontWeight:700, color:"var(--text)", overflow:"hidden",
                                    textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{pl.index}. {pl.name || "Plateau"}</div>
                                  <div style={{ fontSize:10.5, color:"var(--muted)" }}>
                                    {[pl.weight_g ? `${Math.round(pl.weight_g)} g` : null, fmtDur(pl.seconds)].filter(Boolean).join(" · ")}
                                  </div>
                                  {pl.filaments?.length > 0 && (
                                    <div style={{ display:"flex", gap:3, marginTop:3, flexWrap:"wrap" }}>
                                      {pl.filaments.map((f, i) => (
                                        <span key={i} title={`${f.type || ""} ${f.g ? `${f.g} g` : ""}`}
                                          style={{ width:12, height:12, borderRadius:"50%", background: f.color || "#888",
                                            border:"1px solid rgba(255,255,255,0.3)" }}/>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {ps.length > shown.length && (
                  <button onClick={() => setAllProfs(true)} style={textBtn}>Voir les {ps.length - shown.length} autres profils</button>
                )}
                {allProfs && ps.length > LIMIT + 1 && (
                  <button onClick={() => setAllProfs(false)} style={textBtn}>Réduire</button>
                )}
                  </>);
                })()}
              </Section>
            )}

            {/* Commentaires */}
            <Section title={`Commentaires${(m.comment_count ?? com?.total) ? ` (${m.comment_count ?? com?.total})` : ""}`}
              open={showCom} onToggle={() => setShowCom(v => !v)}>
              {!showCom ? null : com === null ? <p style={msg}>…</p> : com.items.length === 0 ? <p style={msg}>Aucun commentaire.</p> : (<>
                {com.items.map(c => (
                  <div key={c.id} style={{ display:"flex", gap:8, padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
                    {c.avatar ? <MwImg src={c.avatar} w={52}
                      style={{ width:26, height:26, borderRadius:"50%", flexShrink:0 }}/>
                      : <span style={{ width:26, height:26, borderRadius:"50%", background:"var(--surface2)", flexShrink:0 }}/>}
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ fontSize:11.5, color:"var(--muted)" }}>
                        <b style={{ color:"var(--text2)" }}>{c.user}</b>{c.when ? ` · ${fmtDate(c.when)}` : ""}
                        {c.score != null && <span style={{ color:"#f59e0b" }}> · {"★".repeat(Math.round(c.score))}</span>}
                      </div>
                      {c.text && <div style={{ fontSize:12.5, color:"var(--text)", lineHeight:1.45, whiteSpace:"pre-wrap",
                        marginTop:2 }}>{(origC[c.id] && c.original ? c.original : c.text).trim()}</div>}
                      {c.original && (
                        <button onClick={() => setOrigC(o => ({ ...o, [c.id]: !o[c.id] }))}
                          style={{ ...textBtn, marginTop:2, fontSize:11, color:"var(--muted)" }}>
                          {origC[c.id] ? "Afficher la traduction" : "Afficher l'original"}</button>
                      )}
                      {c.images?.length > 0 && (
                        <div style={{ display:"flex", gap:4, marginTop:4, overflowX:"auto" }}>
                          {c.images.map((u, i) => <a key={i} href={u} onClick={e => { e.preventDefault(); setZoom({ images: c.images, index: i }); }}>
                            <MwImg src={u} w={128}
                              style={{ width:64, height:64, objectFit:"cover", borderRadius:6 }}/></a>)}
                        </div>
                      )}
                      <div style={{ fontSize:10.5, color:"var(--muted)", marginTop:3 }}>
                        ♥ {c.likes}{c.replies ? ` · ${c.replies} réponse${c.replies > 1 ? "s" : ""}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
                {com.total > com.items.length && (
                  <button onClick={moreComments} disabled={comBusy} style={textBtn}>
                    {comBusy ? "…" : `Plus de commentaires (${com.items.length} / ${com.total})`}</button>
                )}
              </>)}
            </Section>

            {/* Similaires */}
            {sim?.length > 0 && (
              <Section title="Modèles similaires">
                <div style={{ display:"flex", gap:8, overflowX:"auto" }}>
                  {sim.map(x => (
                    <button key={x.design_id} onClick={() => setId(x.design_id)} onPointerDown={() => prefetchModel(x.design_id)}
                      style={{ flexShrink:0, width:100, padding:0, background:"none", border:"none", textAlign:"left",
                        cursor:"pointer", color:"var(--text)" }}>
                      <div style={{ position:"relative", width:100, height:100, borderRadius:8, overflow:"hidden", background:"var(--surface2)" }}>
                        {x.cover_url && <MwImg src={x.cover_url} w={100}
                          style={{ width:"100%", height:"100%", objectFit:"cover" }}/>}
                        {x.printed > 0 && <span style={{ position:"absolute", left:4, bottom:4, fontSize:9, fontWeight:800,
                          padding:"1px 5px", borderRadius:20, background:"#22c55e", color:"white" }}>✓ IMPRIMÉ</span>}
                      </div>
                      <div style={{ fontSize:10.5, marginTop:3, lineHeight:1.25, overflow:"hidden", display:"-webkit-box",
                        WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{x.title_fr || x.title}</div>
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {m.tags?.length > 0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:6 }}>
                {m.tags.map(t => <span key={t} style={{ fontSize:10.5, color:"var(--muted)" }}>#{t}</span>)}
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Section, depliable si onToggle est donne (le titre garde son compte).
// Mac (pas un iPad, qui se dit aussi « Mac » mais a un ecran tactile).
const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent)
  && !(navigator.maxTouchPoints > 1);

// Telephone ou tablette (iPad compris, qui se dit « Mac ») : pas de Bambu Studio.
const IS_MOBILE = typeof navigator !== "undefined" && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

function handyUrl(designId, p) {
  const path = `/design/model/detail?design_id=${designId}${p ? `&instance_id=${p.instance_id}` : ""}`;
  return `https://makerworld.com/fr/open-app?toPath=${encodeURIComponent(path)}&from=Model`;
}

// Lien vers une appli installee (schema personnalise) : par un <a> clique,
// comme le site, pour ne pas quitter la page.
function launch(href) {
  const a = document.createElement("a");
  a.href = href; a.style.display = "none";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// Descriptif du profil (traduit, original a la demande), replie s'il est long.
function ProfileSummary({ p }) {
  const [more, setMore] = useState(false);
  const [orig, setOrig] = useState(false);
  const txt = orig && p.summary_original ? p.summary_original : p.summary;
  const long = txt.length > 220;
  const b = { background:"none", border:"none", padding:0, cursor:"pointer", fontSize:11.5, fontWeight:700, color:"#3b82f6" };
  return (
    <div style={{ padding:"0 10px 8px" }}>
      <div style={{ fontSize:12, color:"var(--text2)", lineHeight:1.5, whiteSpace:"pre-wrap",
        ...(long && !more ? { maxHeight:72, overflow:"hidden", maskImage:"linear-gradient(#000 60%, transparent)" } : null) }}>{txt}</div>
      {(long || p.summary_original) && (
        <div style={{ display:"flex", gap:12, marginTop:3 }}>
          {long && <button onClick={() => setMore(v => !v)} style={b}>{more ? "Réduire" : "Lire la suite"}</button>}
          {p.summary_original && <button onClick={() => setOrig(v => !v)} style={{ ...b, color:"var(--muted)" }}>
            {orig ? "Afficher la traduction" : "Afficher l'original"}</button>}
        </div>
      )}
    </div>
  );
}

function Section({ title, children, open, onToggle }) {
  const head = { fontSize:12, fontWeight:800, color:"var(--text)", textTransform:"uppercase", letterSpacing:0.4 };
  return (
    <div style={{ marginBottom:16 }}>
      {onToggle ? (
        <button onClick={onToggle} style={{ ...head, display:"flex", alignItems:"center", gap:6, width:"100%",
          background:"none", border:"none", padding:"0 0 8px", cursor:"pointer", textAlign:"left" }}>
          <span style={{ flex:1 }}>{title}</span>
          <span style={{ fontSize:11, fontWeight:600, color:"#3b82f6", textTransform:"none", letterSpacing:0 }}>
            {open ? "Replier ▴" : "Déplier ▾"}</span>
        </button>
      ) : <div style={{ ...head, margin:"0 0 8px" }}>{title}</div>}
      {children}
    </div>
  );
}

const msg = { fontSize:13, color:"var(--muted)", padding:"12px 0", margin:0 };
const linkBtn = { padding:"7px 12px", borderRadius:10, fontSize:12, fontWeight:700, textDecoration:"none",
  color:"#3b82f6", background:"rgba(59,130,246,0.08)", border:"1px solid rgba(59,130,246,0.3)" };
const textBtn = { marginTop:6, fontSize:12, fontWeight:600, color:"#3b82f6", background:"none", border:"none",
  padding:0, cursor:"pointer" };
const pBadge = { fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20, background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text2)" };
const chip = { fontSize:10.5, padding:"2px 8px", borderRadius:20, background:"rgba(59,130,246,0.1)", color:"#60a5fa", fontWeight:600 };
