import { Hide } from "./Cachettes";
import React, { useEffect, useRef, useState } from "react";
import { plateRound, plateDoneInRound } from "../utils/queueSort";
import { useTrackDetail } from "../utils/track";
import { createPortal } from "react-dom";
import client from "../api/client";
import { useCanMw, useCanMwHome, useIsAdmin } from "../store/auth";
import { openMenu } from "./ContextMenu";
import AdminOnly from "./AdminOnly";
import MakerWorldCollectionsPicker from "./MakerWorldCollectionsPicker";
import { mwLiked } from "../utils/mwSync";
import { useMwAssign } from "../store/mwAssign";
import { useFriend } from "../store/friend";
import MwImg from "./MwImg";
import MwStockMatch, { stockSummary, setPicksFromPlan, picksOf, platePicksOf, plateInAms, clearPicks, plateColorMap, usePicksVersion,
  PlateColors } from "./MwStockMatch";
import PlateRecolor from "./PlateRecolor";
import Lightbox from "./Lightbox";
import { openCreator } from "./MwCreatorPage";
import { useToRateSet, RateButton } from "./MwToRate";
import { showAlert, showConfirm } from "../utils/dialog";
import { toast } from "../store/toast";
import { Heart } from "lucide-react";
import ShareSheet from "./ShareSheet";

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
  const [descLong, setDescLong] = useState(false); // descriptif plus long que le repli
  const [allProfs, setAllProfs] = useState(false); // profils : les 4 premiers, puis « voir plus »
  const [orig, setOrig] = useState(false);         // descriptif : original au lieu du francais
  const [origC, setOrigC] = useState({});          // commentaires montres dans l'original
  const [open, setOpen] = useState(null);          // profil deplie (instance_id)
  const [com, setCom] = useState(null);            // { items, total }
  const [comBusy, setComBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [sharing, setSharing] = useState(false);     // le partage Telegram du modele
  const [sim, setSim] = useState(null);
  const [zoom, setZoom] = useState(null);          // galerie plein ecran { images, index }
  const [exactBusy, setExactBusy] = useState(null);
  const [plan, setPlan] = useState(null);            // plan retenu pour la file (profil, plateaux, filaments)
  const [planBusy, setPlanBusy] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);
  useTrackDetail(`Fiche MakerWorld · ${m?.title || "#" + id}`);
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
  const canPlan = useCanMw();                  // plan « A faire » : droit MakerWorld, jamais chez un copain
  const canHome = useCanMwHome();             // j'aime, boost, collections, Studio : sur MON compte, meme chez un copain
  const isAdmin = useIsAdmin();               // associer a un print
  const [plateSel, setPlateSel] = useState({});    // instance_id -> plateaux choisis (absent = tous)
  usePicksVersion();                                 // un filament change : les vignettes se repeignent
  const [showCom, setShowCom] = useState(false);   // commentaires replies (charges a l'ouverture)
  const [like, setLike] = useState(null);          // { liked } avec mon compte ; null = inconnu / pas connecte
  const [likeBusy, setLikeBusy] = useState(false);

  // Boost : le droit a depenser pour CE modele et mes boosts disponibles
  // (compte connecte seulement ; sans droit, pas de bouton).
  const toRate = useToRateSet(!friend);           // imprime, pas encore evalue
  const [boost, setBoost] = useState(null);       // { can, available }
  const [boostBusy, setBoostBusy] = useState(false);
  const [inColls, setInColls] = useState(null);     // mes collections qui contiennent ce modele
  useEffect(() => {
    if (!canHome) return undefined;
    let alive = true;
    setInColls(null);
    client.get("/makerworld/mine", { params: { ids: String(id) } })
      .then(r => alive && r.data.collections_known && setInColls(r.data.items?.[String(id)]?.collections || []))
      .catch(() => {});
    return () => { alive = false; };
  }, [id, canHome, pick]);
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
    const was = boost?.boosted ? ` Tu l'as déjà boosté ${boost.boosted} fois.` : "";
    if (!await showConfirm(`Booster « ${m?.title_fr || m?.title || "ce modèle"} » ?${was} Ça utilise un de tes boosts`
      + (n != null ? ` (il t'en reste ${n}).` : "."), { confirmLabel: "🚀 Booster" })) return;
    setBoostBusy(true);
    try {
      const { data } = await client.post(`/makerworld/model/${id}/boost`);
      setBoost(b => ({ ...b, can: false, available: data.available, boosted: (b?.boosted || 0) + 1, reason: "Boosté à l'instant" }));
      client.get(`/makerworld/model/${id}/boost`).then(r => r.data.known && setBoost(r.data)).catch(() => {});
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
        picks: picksOf(`${id}|${p.instance_id}`, m.stock?.[p.instance_id]),
        plate_picks: platePicksOf(`${id}|${p.instance_id}`, m.stock?.[p.instance_id]) };
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
    try {
      await client.delete(`/makerworld/queue/plan/${id}`);
      // le plan oublie : filaments et plateaux reviennent aux choix par defaut, sans recharger
      if (plan?.instance_id) {
        clearPicks(`${id}|${plan.instance_id}`);
        setPlateSel(s => { const n = { ...s }; delete n[plan.instance_id]; return n; });
      }
      setPlan(null);
      setM(x => x && { ...x });
    }
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
        setPicksFromPlan(`${id}|${pl.instance_id}`, data.stock?.[pl.instance_id], pl.picks, pl.plate_picks)
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
  // combien de fois ce plateau a ete imprime (sur ce profil, ou sans profil connu)
  const counts = m?.printed_plate_counts || {};
  const plateTimes = (prof, idx) => (counts[`${prof.profile_id}:${idx}`] || 0) + (counts[`:${idx}`] || 0);
  const plateDone = (prof, idx) => plateTimes(prof, idx) > 0 || done.has(`${prof.profile_id}:${idx}`) || done.has(`:${idx}`);
  const onNow = new Set(m?.printing_plates || []);
  const platePrinting = (prof, idx) => onNow.has(`${prof.profile_id}:${idx}`) || onNow.has(`:${idx}`);

  // Actions de la fiche (barre du bas et menu ⋯) : memes droits que les boutons d'avant.
  const ok = m && !m.error;
  const kp = ok ? keptProfile() : null;
  const kpTip = kp ? `Profil ${plan?.instance_id === kp.instance_id ? "retenu" : "choisi automatiquement"} : ${kp.title || kp.instance_id}` : "";
  const mwUrl = m?.url || `https://makerworld.com/fr/models/${id}`;
  const rateHere = ok && toRate.has(String(id));
  const menu = e => openMenu(e, {
    title: m?.title_fr || m?.title || preview?.title_fr || preview?.title || "Modèle", subtitle: m?.creator_name ? `par ${m.creator_name}` : null, color: "#06B6D4",
    items: [
      { icon: "🌐", label: "Ouvrir sur MakerWorld", hint: "dans un nouvel onglet", tone: "#06B6D4", onClick: () => window.open(mwUrl, "_blank", "noopener") },
      kp && (IS_MOBILE ? { icon: "📱", label: "Ouvrir dans Handy", hint: kpTip, tone: "#22C55E", onClick: () => window.open(handyUrl(id, kp), "_blank", "noopener") }
        : canHome && { icon: "🖥️", label: "Ouvrir dans Studio", hint: kpTip, tone: "#22C55E", onClick: () => openStudio(kp) }),
      ok && m.printed > 0 && onSearch && { icon: "🖨️", label: "Voir mes prints", hint: `${m.printed} impression${m.printed > 1 ? "s" : ""}`, tone: "#16A34A",
        onClick: () => { onSearch(m); onClose(); } },
      (like && canHome || boost && canHome || canHome) && "-",
      like && canHome && { icon: like.liked ? "❤" : "♡", label: like.liked ? "Aimé · retirer le j'aime" : "J'aime", tone: "#EF4444", disabled: likeBusy, onClick: toggleLike },
      boost && canHome && { icon: "🚀", tone: boost.can ? "#6366F1" : "#94A3B8", disabled: boostBusy || !boost.can,
        label: boost.can ? (boost.boosted ? "Booster encore" : "Booster") : boost.boosted ? "Déjà boosté" : "Booster",
        hint: [boost.boosted && `déjà boosté ${boost.boosted} fois`, !boost.can && boost.reason, boost.can && boost.available != null && `${boost.available} boost(s) disponible(s)`,
          boost.creator_max != null && `${boost.creator ?? 0}/${boost.creator_max} donnés à ce créateur cette année`].filter(Boolean).join(" · ") || null,
        onClick: doBoost },
      canHome && { icon: "🔖", label: "Ranger dans mes collections…", tone: "#14B8A6", onClick: () => setPick(true) },
      // comme le partage d'une impression : destinations, mot, photos, apercu exact
      !friend && isAdmin && { icon: "📣", label: "Partager", hint: "Telegram", tone: "#229ED9", onClick: () => setSharing(true) },
      !friend && isAdmin && "-",
      !friend && isAdmin && { icon: "🔗", label: "Associer à un print", hint: "Choisir les impressions de ce modèle dans l'historique", tone: "#8B5CF6",
        onClick: () => { startAssign(tile()); onClose(); } },
    ],
  });
  const stats = ok ? [["❤", m.like_count, "J'aime", "#EF4444", "#F87171"], ["⬇", m.download_count, "Téléch.", "#3B82F6", "#60A5FA"],
    ["🖨", m.print_count, "Impr.", "#8B5CF6", "#C084FC"], ["🔖", m.collection_count, "Collec.", "#14B8A6", "#2DD4BF"],
    ["💬", m.comment_count, "Avis", "#06B6D4", "#67E8F9"]].filter(([, n]) => n != null) : [];

  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4200, background:"rgba(0,0,0,0.7)",
      display:"flex", alignItems: WIDE ? "center" : "flex-end", justifyContent:"center", padding: WIDE ? 20 : 0 }}>
      <div onClick={e => e.stopPropagation()} className="sheet-inner" style={{ background:"var(--sheet-bg)", borderRadius: WIDE ? 24 : "22px 22px 0 0",
        width:"100%", maxWidth: WIDE ? 760 : 640, height: WIDE ? "90dvh" : "94dvh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ flex:1, minHeight:0, overflowY:"auto", position:"relative" }}>
          {/* la barre du haut : poignee, etoile (a evaluer), ⋯ et ✕, par-dessus la galerie */}
          <div style={{ position:"sticky", top:0, zIndex:10, height:0 }}>
            {!WIDE && <div style={{ position:"absolute", top:8, left:"50%", transform:"translateX(-50%)", width:38, height:4, borderRadius:2, background:"rgba(148,163,184,.6)" }}/>}
            <div style={{ position:"absolute", top:10, right:12, display:"flex", gap:8 }}>
              {/* a evaluer : le signal, qui ouvre l'evaluation (comme l'etoile de la barre du bas) */}
              {rateHere && !friend && <span data-tip="À évaluer sur MakerWorld" style={{ display:"flex" }}>
                <RateButton did={id} label="⭐" ext="" doneLabel="✓" style={{ ...roundTop, display:"flex", alignItems:"center", justifyContent:"center",
                  textDecoration:"none", border:"none", background:"linear-gradient(135deg, #F59E0B, #FBBF24)", color:"#fff",
                  boxShadow:"0 6px 16px rgba(245,158,11,.45)" }}/></span>}
              <button onClick={menu} aria-label="Plus d'actions" style={roundTop}>⋯</button>
              <button onClick={onClose} aria-label="Fermer" style={roundTop}>✕</button>
            </div>
          </div>
          <div style={{ padding:"0 16px 20px" }}>
          {m === null ? (
            // Ouverture immediate avec ce que la tuile savait deja.
            <div style={{ paddingTop:52 }}>
              <div style={{ display:"flex", gap:8, margin:"0 -16px 12px", padding:"0 16px" }}>
                {preview?.cover_url
                  ? <MwImg src={preview.cover_url} w={360} eager style={{ width:"78%", maxWidth:360, aspectRatio:"1",
                      objectFit:"cover", borderRadius:18, background:"var(--surface2)" }}/>
                  : <div className="mw-skel" style={{ width:"78%", maxWidth:360, aspectRatio:"1", borderRadius:18 }}/>}
              </div>
              <h2 style={{ fontSize:20, fontWeight:900, color:"var(--text)", margin:"0 0 6px" }}>
                {preview?.title_fr || preview?.title || ""}</h2>
              {[90, 70, 80, 60].map((w, i) => <div key={i} className="mw-skel" style={{ height:12, width:`${w}%`, borderRadius:6, margin:"8px 0" }}/>)}
            </div>
          )
            : m.error ? (<div style={{ paddingTop:52 }}>
              <p style={{ ...msg, color:"#f59e0b" }}>{m.error}</p>
              <a href={mwUrl} target="_blank" rel="noopener noreferrer" style={linkBtn}>Ouvrir sur MakerWorld ↗</a>
            </div>) : (<>
            {/* Galerie : glisser de cote, toucher pour agrandir ; le defilement de la fiche reste libre */}
            {m.pictures?.length > 0 ? (
              <PicStrip pictures={m.pictures} onOpen={i => setZoom({ images: m.pictures, index: i })}/>
            ) : <div style={{ height:52 }}/>}

            {/* titre, createur */}
            <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginBottom:4 }}>
              <span style={{ fontSize:10.5, fontWeight:900, letterSpacing:".06em", color:"#06B6D4" }}>🌐 MAKERWORLD <Hide at="mw-sheet"/></span>
              {m.license && <span style={{ ...chip, background:"var(--surface2)", color:"var(--muted)", border:"1px solid var(--border)" }}>{m.license}</span>}
            </div>
            <h2 style={{ fontSize:20, fontWeight:900, color:"var(--text)", margin:"0 0 2px", lineHeight:1.25 }}>{m.title_fr || m.title}</h2>
            {m.title_fr && m.title_fr !== m.title && <div style={{ fontSize:12, fontWeight:600, color:"var(--muted)" }}>{m.title}</div>}
            <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12.5, fontWeight:600, color:"var(--muted)", margin:"8px 0 12px" }}>
              {m.creator_avatar ? <MwImg src={m.creator_avatar} w={56} style={{ width:28, height:28, borderRadius:"50%", flexShrink:0,
                boxShadow:"0 0 0 2px rgba(6,182,212,0.5)" }}/>
                : <span style={{ width:28, height:28, borderRadius:"50%", background:"var(--surface2)", flexShrink:0 }}/>}
              <span style={{ minWidth:0 }}>par {m.creator_uid
                ? <button onClick={() => { onClose?.(); openCreator({ uid: m.creator_uid, name: m.creator_name }); }}
                    data-tip="Tous ses modèles" style={{ background:"none", border:"none", padding:0, cursor:"pointer",
                      fontWeight:800, color:"#06B6D4", fontSize:"inherit" }}>{m.creator_name}</button>
                : <b style={{ color:"var(--text2)" }}>{m.creator_name}</b>}{m.created ? ` · ${fmtDate(m.created)}` : ""}</span>
            </div>

            {/* les compteurs du modele sur MakerWorld */}
            {stats.length > 0 && (
              <div style={{ display:"grid", gridTemplateColumns:`repeat(${stats.length}, minmax(0, 1fr))`, gap:6, marginBottom:12 }}>
                {stats.map(([ic, n, l, c1, c2]) => (
                  <div key={l} data-tip={`${n} ${l.toLowerCase()}`} style={{ minWidth:0, padding:"7px 6px", borderRadius:14, textAlign:"center",
                    border:`1px solid color-mix(in srgb, ${c1} 22%, var(--border))`, background:`radial-gradient(90% 70% at 50% 0%, ${c1}22, transparent 70%), var(--surface2)` }}>
                    <div style={{ fontSize:15, fontWeight:900, whiteSpace:"nowrap", ...grad(c1, c2) }}>{fmtK(n)}</div>
                    <div style={{ fontSize:9.5, fontWeight:800, color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{ic} {l}</div>
                  </div>))}
              </div>
            )}

            {(m.printed > 0 || m.in_progress > 0) && (() => {
              const c = m.printed ? "#22C55E" : "#F59E0B";
              return (
                <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:16, marginBottom:12,
                  border:`1px solid ${c}55`, background:`linear-gradient(135deg, ${c}22, transparent 70%), var(--surface2)` }}>
                  <span style={{ width:32, height:32, borderRadius:10, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15,
                    color:"#fff", background:`linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` }}>{m.printed ? "✓" : "⏳"}</span>
                  <span style={{ flex:1, minWidth:0, fontSize:13, fontWeight:800, color:c }}>
                    {m.printed ? `Imprimé · ${m.printed} impression${m.printed > 1 ? "s" : ""}` : "En cours d'impression"}
                    {m.in_progress > 0 && m.printed > 0 ? " · une en cours" : ""}</span>
                  {m.printed > 0 && onSearch && (
                    <button onClick={() => { onSearch(m); onClose(); }} style={{ padding:"5px 11px", borderRadius:20, fontSize:12, fontWeight:800,
                      color:"#fff", background:`linear-gradient(135deg, ${c}, #16A34A)`, border:"none", cursor:"pointer", whiteSpace:"nowrap" }}>
                      voir mes prints</button>
                  )}
                </div>);
            })()}

            {zoom && <Lightbox images={zoom.images} index={zoom.index} title={zoom.title || m.title_fr || m.title} onClose={() => setZoom(null)}/>}
            {sharing && <span onClick={e => e.stopPropagation()}><ShareSheet kind="design" id={id} z={4400} onClose={() => setSharing(false)}/></span>}
            {pick && <MakerWorldCollectionsPicker designId={id} title={m.title} item={tile()} onClose={() => setPick(false)}/>}

            {m.categories?.length > 0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
                {m.categories.map(c => <span key={c} style={chip}>{c}</span>)}
              </div>
            )}

            {/* Descriptif */}
            {m.description && (
              <Section title="Descriptif" icon="📝" c="#8B5CF6">
                <Folded lines={7} open={more} onOverflow={setDescLong}
                  style={{ fontSize:13, color:"var(--text2)", lineHeight:1.55, whiteSpace:"pre-wrap" }}>
                  {orig && m.description_original ? m.description_original : m.description}
                </Folded>
                <div style={{ display:"flex", gap:14 }}>
                  {(descLong || more) && (
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
              <Section title={`Profils (${m.profiles.length})`} icon="🧩" c="#06B6D4" bare>
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
                    <div key={p.instance_id} style={{ borderRadius:16, marginBottom:8, overflow:"hidden",
                      border: plan?.instance_id === p.instance_id ? "1.5px solid rgba(34,197,94,0.55)" : isOpen ? "1px solid rgba(6,182,212,0.45)" : "1px solid var(--border)",
                      background: plan?.instance_id === p.instance_id ? "linear-gradient(160deg, rgba(34,197,94,0.12), transparent 45%), var(--surface2)"
                        : isOpen ? "linear-gradient(160deg, rgba(6,182,212,0.10), transparent 45%), var(--surface2)" : "var(--surface2)" }}>
                      <button onClick={() => setOpen(isOpen ? null : p.instance_id)}
                        style={{ width:"100%", textAlign:"left", padding:"11px 12px", background:"none", border:"none",
                          cursor:"pointer", color:"var(--text)", display:"flex", gap:10, alignItems:"flex-start" }}>
                        {/* l'image du profil en vignette (ses illustrations : depliees, en bande) */}
                        {p.cover && <MwImg src={p.cover} w={120} style={{ width:52, height:52, borderRadius:12, objectFit:"cover", flexShrink:0,
                          background:"var(--surface)", border:"1px solid var(--border)" }}/>}
                        <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ flex:1, fontSize:13.5, fontWeight:800 }} data-tip={p.title_original || undefined}>
                            {p.title || "Profil"}{p.default ? " ★" : ""}</span>
                          {nDone > 0 && <span style={{ fontSize:10.5, fontWeight:800, color:"white", background:"linear-gradient(135deg, #22C55E, #16A34A)",
                            padding:"1px 7px", borderRadius:20 }}>✓ {nDone}/{p.plates.length}</span>}
                          <span style={{ color:"var(--muted)", fontSize:11, transform: isOpen ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span>
                        </div>
                        <div style={{ fontSize:11, color:"var(--muted)", marginTop:2 }}>
                          {[p.printer, `${p.plates.length} plateau${p.plates.length > 1 ? "x" : ""}`,
                            p.weight_g ? `${Math.round(p.weight_g)} g` : null, fmtDur(p.seconds),
                            p.settings?.layerHeight ? `${p.settings.layerHeight} mm` : null,
                            p.settings?.sparseInfillDensity ? `remplissage ${p.settings.sparseInfillDensity}` : null,
                            p.print_count != null ? `${fmtK(p.print_count)} impressions` : null].filter(Boolean).join(" · ")}
                        </div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:4 }}>
                          {p.main && <span style={{ ...pBadge, background:"linear-gradient(135deg, #3B82F6, #6366F1)", border:"none", color:"white" }}>Retenu</span>}
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
                        </div>
                      </button>
                      {isOpen && p.pictures?.length > 1 && <div style={{ padding:"0 10px 8px" }}>
                        <PicStrip small pictures={p.pictures} onOpen={i => setZoom({ images: p.pictures, index: i, title: p.title })}/></div>}
                      {isOpen && p.summary && <ProfileSummary p={p}/>}
                      {/* Imprimer CE profil : Handy (telephone, page open-app de MakerWorld)
                          ou Bambu Studio (ordinateur, lien du 3MF de ce profil). */}
                      {isOpen && (
                        <div style={{ display:"flex", gap:6, padding:"0 10px 8px", flexWrap:"wrap" }}>
                          {!friend && (
                            <AdminOnly mw>
                              <button onClick={() => pinPlan(p)} disabled={planBusy}
                                data-tip="La file d'attente utilisera ce profil, ces plateaux et ces filaments"
                                style={{ ...linkBtn, padding:"6px 11px", fontSize:12, cursor:"pointer", color:"#16a34a", background:"rgba(34,197,94,0.12)", borderColor:"rgba(34,197,94,0.4)",
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
                              : "Stock calculé pour tous les plateaux"} {canPlan ? "· touche un plateau pour l'enlever" : ""}</span>
                            {sel && canPlan && <button onClick={() => setSel(undefined)} style={{ ...textBtn, marginTop:0 }}>Tous</button>}
                          </div>
                        );
                      })()}
                      {isOpen && p.plates.length > 1 && (() => {
                        // retenus, faisables tout de suite avec l'AMS, et pas encore imprimes
                        const sel = plateSel[p.instance_id];
                        const can = p.plates.filter(pl => (!sel || sel.includes(pl.index))
                          && plateInAms(m.stock?.[p.instance_id], pl, `${id}|${p.instance_id}`));
                        // en series : les plateaux retenus, ou j'en suis (un modele refait des mois plus tard repart d'une serie)
                        const kept = p.plates.filter(pl => !sel || sel.includes(pl.index));
                        const round = plateRound(kept.map(pl => plateTimes(p, pl.index)));
                        const doneNow = pl => plateDoneInRound(plateTimes(p, pl.index), round);
                        const todo = can.filter(pl => !doneNow(pl)).map(pl => pl.index);
                        const again = can.filter(pl => doneNow(pl)).map(pl => `${pl.index} (${plateTimes(p, pl.index) || 1}×)`);
                        return (todo.length > 0 || again.length > 0 || (round && (round.faits || round.serie > 1))) && (
                          <div style={{ padding:"0 10px 8px", fontSize:12, fontWeight:700, display:"flex", flexDirection:"column", gap:2 }}>
                            {round && (round.faits > 0 || round.serie > 1) && <span style={{ color: round.complete ? "#16a34a" : "var(--text)", fontWeight:800 }}>
                              Plateaux retenus : {round.label}</span>}
                            {todo.length > 0 && <span style={{ color:"#16a34a" }}>
                              ▶ À lancer maintenant avec l'AMS : plateau{todo.length > 1 ? "x" : ""} {todo.join(", ")}</span>}
                            {again.length > 0 && <span style={{ color:"var(--text2)", fontWeight:600 }}>
                              ↻ Déjà imprimé{again.length > 1 ? "s" : ""}, relançable{again.length > 1 ? "s" : ""} avec l'AMS : plateau{again.length > 1 ? "x" : ""} {again.join(", ")}</span>}
                          </div>
                        );
                      })()}
                      {isOpen && (
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:8, padding:"0 10px 10px" }}>
                          {p.plates.map((pl, _i, all) => {
                            // fait POUR LA SERIE EN COURS (sur les plateaux retenus) ; imprime avant, mais a refaire : en gris
                            const _sel = plateSel[p.instance_id];
                            const _round = plateRound(all.filter(x => !_sel || _sel.includes(x.index)).map(x => plateTimes(p, x.index)));
                            const ok = plateDoneInRound(plateTimes(p, pl.index), _round);
                            const before = !ok && plateTimes(p, pl.index) > 0;
                            const live = platePrinting(p, pl.index);
                            const sel0 = plateSel[p.instance_id];
                            // un plateau ecarte ne dit pas s'il est pret : il ne sera pas lance
                            const ready = !sel0 || sel0.includes(pl.index) ? plateInAms(m.stock?.[p.instance_id], pl, `${id}|${p.instance_id}`) : null;
                            const sel = plateSel[p.instance_id];
                            const on = !sel || sel.includes(pl.index);
                            const toggle = () => canPlan && setPlateSel(s => {
                              const cur = s[p.instance_id] || p.plates.map(x => x.index);
                              const next = on ? cur.filter(i => i !== pl.index) : [...cur, pl.index];
                              return { ...s, [p.instance_id]: next.length === p.plates.length ? undefined : next };
                            });
                            return (
                              <div key={pl.index} onClick={p.plates.length > 1 && canPlan ? toggle : undefined}
                                role={p.plates.length > 1 && canPlan ? "button" : undefined}
                                aria-pressed={on} style={{ borderRadius:12, overflow:"hidden", background:"var(--surface)",
                                cursor: p.plates.length > 1 && canPlan ? "pointer" : "default", opacity: on ? 1 : 0.4, transition:"opacity .15s",
                                position:"relative", border: ok ? "2px solid #22c55e" : ready ? "2px solid #3b82f6" : "1px solid var(--border)" }}>
                                {p.plates.length > 1 && canPlan && <span style={{ position:"absolute", top:4, right:4, zIndex:1, width:18, height:18,
                                  borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900,
                                  color:"white", background: on ? "#3b82f6" : "rgba(0,0,0,0.45)", border:"1.5px solid white" }}>{on ? "✓" : ""}</span>}
                                <div style={{ position:"relative" }}>
                                  {/* Certains rendus MakerWorld sont blancs (ou gris, ou noirs) sur fond
                                      transparent : aucun fond ne convient a toutes les couleurs. Un fin contour
                                      ombre suit la silhouette (la transparence la dessine) et la detache de
                                      n'importe quel fond. Image entiere, jamais recadree. */}
                                  <div style={{ background:"var(--surface2)" }}>
                                    {pl.thumb ? <PlateRecolor src={pl.thumb} w={200}
                                      map={plateColorMap(m.stock?.[p.instance_id], pl, `${id}|${p.instance_id}`)}
                                      style={{ width:"100%", aspectRatio:"1", objectFit:"contain", display:"block", padding:6,
                                        boxSizing:"border-box",
                                        filter:"drop-shadow(0 0 0.6px rgba(0,0,0,.75)) drop-shadow(0 0 0.6px rgba(255,255,255,.7)) drop-shadow(0 3px 5px rgba(0,0,0,.28))" }}/>
                                      : <div style={{ width:"100%", aspectRatio:"1", display:"flex", alignItems:"center",
                                          justifyContent:"center", fontSize:28, fontWeight:900, color:"var(--muted)" }}>{pl.index}</div>}
                                  </div>
                                  {/* deja imprime ET pret : les deux, on peut vouloir le refaire */}
                                  <div style={{ position:"absolute", top:4, left:4, display:"flex", flexDirection:"column",
                                    alignItems:"flex-start", gap:3 }}>
                                    {live && <span title="Ce plateau est en cours d'impression" style={{ fontSize:9.5, fontWeight:800,
                                      color:"white", background:"#f59e0b", padding:"1px 6px", borderRadius:20 }}>⏳ EN COURS</span>}
                                    {ok && <span title={`Déjà imprimé ${plateTimes(p, pl.index) || 1} fois`} style={{ fontSize:9.5, fontWeight:800, color:"white",
                                      background:"#22c55e", padding:"1px 6px", borderRadius:20 }}>✓ FAIT {plateTimes(p, pl.index) || 1}×</span>}
                                    {before && <span title="Imprimé lors d'une série précédente, à refaire pour celle-ci" style={{ fontSize:9.5, fontWeight:800,
                                      color:"var(--text2)", background:"var(--surface2)", border:"1px solid var(--border)", padding:"1px 6px", borderRadius:20 }}>
                                      ↻ {plateTimes(p, pl.index)}× avant</span>}
                                    {ready ? <span title={ok ? "Déjà imprimé, et tous ses filaments sont dans l'AMS : tu peux le relancer"
                                        : "Tous ses filaments sont dans l'AMS, en quantité suffisante"}
                                        style={{ fontSize:9.5, fontWeight:800, color:"white",
                                        background:"#3b82f6", padding:"1px 6px", borderRadius:20 }}>▶ PRÊT (AMS)</span>
                                      : ready === false ? <span title="Un de ses filaments n'est pas dans l'AMS, ou pas assez"
                                        style={{ fontSize:9.5, fontWeight:800, color:"var(--text2)",
                                        background:"var(--surface2)", border:"1px solid var(--border)", padding:"1px 6px", borderRadius:20 }}>à charger</span>
                                      : null}
                                  </div>
                                </div>
                                <div style={{ padding:"5px 6px 6px" }}>
                                  <div style={{ fontSize:11.5, fontWeight:700, color:"var(--text)", overflow:"hidden",
                                    textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{pl.index}. {pl.name || "Plateau"}</div>
                                  <div style={{ fontSize:10.5, color:"var(--muted)" }}>
                                    {[pl.weight_g ? `${Math.round(pl.weight_g)} g` : null, fmtDur(pl.seconds)].filter(Boolean).join(" · ")}
                                  </div>
                                  <PlateColors items={m.stock?.[p.instance_id]} plate={pl} scope={`${id}|${p.instance_id}`}
                                    canEdit={canPlan && on} onNavigate={onClose}/>
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
            <Section title={`Commentaires${(m.comment_count ?? com?.total) ? ` (${m.comment_count ?? com?.total})` : ""}`} icon="💬" c="#EC4899"
              open={showCom} onToggle={() => setShowCom(v => !v)}>
              {!showCom ? null : com === null ? <p style={msg}>…</p> : com.items.length === 0 ? <p style={msg}>Aucun commentaire.</p> : (<>
                {com.items.map(c => (
                  <div key={c.id} style={{ display:"flex", gap:9, padding:"9px 0", borderBottom:"1px dashed var(--border)" }}>
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
                            <MwImg src={u} w={128} animate
                              style={{ width:64, height:64, objectFit:"cover", borderRadius:6 }}/></a>)}
                        </div>
                      )}
                      <div style={{ fontSize:10.5, color:"var(--muted)", marginTop:3 }}>♥ {c.likes}</div>
                      {c.replies > 0 && <Replies c={c} creatorUid={m.creator_uid} onZoom={(images, index) => setZoom({ images, index })}/>}
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
              <Section title="Modèles similaires" icon="✨" c="#F59E0B" bare>
                <div style={{ display:"flex", gap:8, overflowX:"auto", touchAction:"pan-x pan-y" }}>
                  {sim.map(x => (
                    <button key={x.design_id} onClick={() => setId(x.design_id)} onPointerDown={() => prefetchModel(x.design_id)}
                      style={{ flexShrink:0, width:100, padding:0, background:"none", border:"none", textAlign:"left",
                        cursor:"pointer", color:"var(--text)" }}>
                      <div style={{ position:"relative", width:100, height:100, borderRadius:14, overflow:"hidden", background:"var(--surface2)" }}>
                        {x.cover_url && <MwImg src={x.cover_url} w={100}
                          style={{ width:"100%", height:"100%", objectFit:"cover" }}/>}
                        {x.printed > 0 && <span style={{ position:"absolute", left:4, bottom:4, fontSize:9, fontWeight:800,
                          padding:"1px 5px", borderRadius:20, background:"linear-gradient(135deg, #22C55E, #16A34A)", color:"white" }}>✓ IMPRIMÉ</span>}
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
        {/* les actions, toujours a portee du pouce */}
        {ok && (
          <div style={{ flexShrink:0, display:"flex", gap:6, padding:"10px 12px calc(10px + env(safe-area-inset-bottom, 0px))",
            borderTop:"1px solid var(--border)", background:"color-mix(in srgb, var(--sheet-bg) 94%, transparent)", backdropFilter:"blur(8px)" }}>
            {/* telephone : Handy ; ordinateur : Studio (la place permet le mot) */}
            {kp && IS_MOBILE ? (
              <a href={handyUrl(id, kp)} target="_blank" rel="noopener noreferrer" aria-label="Ouvrir dans Handy" data-tip={`Ouvrir dans Handy · ${kpTip}`}
                style={{ ...fBtn, ...primary, flex:1, fontSize:19, padding:"8px 10px" }}>📱</a>
            ) : kp && canHome ? (
              <button onClick={() => openStudio(kp)} disabled={studioBusy === kp.instance_id} data-tip={`Ouvrir dans Bambu Studio · ${kpTip}`} style={{ ...fBtn, ...primary, flex:1 }}>
                {studioBusy === kp.instance_id ? "…" : "🖥️ Studio"}</button>
            ) : (
              <a href={mwUrl} target="_blank" rel="noopener noreferrer" aria-label="Ouvrir sur MakerWorld" data-tip="Ouvrir sur MakerWorld" style={{ ...fBtn, flex:1, color:"#06B6D4",
                borderColor:"rgba(6,182,212,0.4)", background:"rgba(6,182,212,0.1)" }}>🌐 ↗</a>
            )}
            {like && canHome && (
              <button onClick={toggleLike} disabled={likeBusy} aria-label={like.liked ? "Aimé" : "J'aime"} data-tip={like.liked ? "Aimé · retirer le j'aime" : "J'aime"}
                style={{ ...sq, color:"#ef4444", ...(like.liked ? { background:"rgba(239,68,68,0.14)", borderColor:"rgba(239,68,68,0.45)" } : null) }}>
                <Heart size={20} strokeWidth={2.4} fill={like.liked ? "#ef4444" : "none"}/></button>
            )}
            {canHome && (() => {
              // boost : actif s'il reste de quoi booster ; sinon en retrait, et le toucher dit pourquoi.
              // Deja booste par moi : une pastille avec le nombre (MakerWorld le donne par modele).
              const live = boost && boost.can;
              const mine = boost?.boosted || 0;
              const why = !boost ? "Boost : état inconnu pour l'instant (MakerWorld n'a pas répondu)"
                : boost.reason || "Boost impossible pour ce modèle";
              const tip = live ? [mine ? `Déjà boosté ${mine} fois · booster encore` : "Booster", boost.available != null && `${boost.available} disponible(s)`]
                .filter(Boolean).join(" · ") : (mine && !/^Déjà boosté/.test(why) ? `Déjà boosté ${mine} fois · ` : "") + why;
              return <button onClick={live ? doBoost : () => toast("🚀 " + (mine && !/^Déjà boosté/.test(why) ? `Tu l'as déjà boosté ${mine} fois. ` : "") + why, "info", 3500)}
                disabled={boostBusy} aria-label="Booster" data-tip={tip}
                style={{ ...sq, position:"relative", ...(live ? { background:"rgba(99,102,241,0.14)", borderColor:"rgba(99,102,241,0.45)" } : dim("99,102,241")) }}>
                <span style={live ? null : { opacity:.5 }}>🚀</span>
                {mine > 0 && <span style={badge("#6366F1")}>{mine > 1 ? mine : "✓"}</span>}</button>;
            })()}
            {canHome && (
              <button onClick={() => setPick(true)} aria-label="Ranger dans mes collections"
                data-tip={inColls?.length ? `Dans ${inColls.join(", ")} · ranger…` : "Ranger dans mes collections"}
                style={{ ...sq, position:"relative", background:"rgba(20,184,166,0.12)", borderColor:"rgba(20,184,166,0.4)" }}>🔖
                {inColls?.length > 0 && <span style={badge("#14B8A6")}>{inColls.length}</span>}</button>
            )}
            {!friend && (rateHere
              ? <RateButton did={id} label="⭐" ext="" doneLabel="✓" style={{ ...sq, display:"flex", alignItems:"center", justifyContent:"center", textDecoration:"none",
                  color:"#fff", border:"none", background:"linear-gradient(135deg, #F59E0B, #FBBF24)", boxShadow:"0 8px 18px -10px #F59E0B" }}/>
              : (() => {
                const why = m.printed > 0 ? "Déjà évalué (ou mis de côté sans évaluer)" : "Pas encore imprimé : l'évaluation vient après une impression";
                return <button onClick={() => toast("⭐ " + why, "info", 3500)} aria-label="Évaluer" data-tip={why}
                  style={{ ...sq, ...dim("245,158,11") }}><span style={{ opacity:.5 }}>⭐</span></button>;
              })())}
            <button onClick={menu} aria-label="Plus d'actions" style={sq}>⋯</button>
          </div>
        )}
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
// La galerie de la fiche : une bande qui glisse de cote. Au doigt, chaque image se cale au centre ;
// a la souris, on la tire (sans declencher l'agrandissement), et deux fleches avancent d'une image.
// Avant : des liens <a> que la souris « attrapait » (glisser-deposer du lien au lieu de defiler),
// et un calage strict qui ramenait la bande en arriere au pave tactile : elle semblait bloquee.
// small : la bande d'un profil (vignettes de 110 px, sans le halo ni la marge du haut de la fiche)
// Les reponses d'un commentaire ou d'un avis (26/10/2026) : repliees derriere « 💬 N reponses » ; depliees,
// un fil en retrait (trait a gauche), chacun avec son avatar, « ↪ a Untel » quand il repond a quelqu'un, la
// pastille « createur » pour l'auteur du modele, le texte traduit (l'original au toucher), ses images et ses ♥.
// Les premieres arrivent avec le commentaire ; la suite se lit a l'ouverture.
function Replies({ c, creatorUid, onZoom }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(null);
  const [busy, setBusy] = useState(false);
  const [orig, setOrig] = useState({});
  const items = all || c.reply_preview || [];
  const toggle = () => {
    const v = !open;
    setOpen(v);
    if (v && !all && c.replies > (c.reply_preview || []).length) {
      setBusy(true);
      // une lecture vide ou incomplete (MakerWorld muet) ne remplace pas ce qui est deja affiche
      client.get(`/makerworld/comment/${c.kind}/${c.id}/replies`)
        .then(({ data }) => { const got = data?.items || []; if (got.length >= (c.reply_preview || []).length && got.length) setAll(got); })
        .catch(() => {}).finally(() => setBusy(false));
    }
  };
  const P = "#EC4899";
  return (
    <div style={{ marginTop:6 }}>
      <button onClick={toggle} aria-expanded={open} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:20,
        border:`1px solid color-mix(in srgb, ${P} 35%, transparent)`, background:`color-mix(in srgb, ${P} ${open ? 16 : 9}%, transparent)`,
        color:P, fontSize:11.5, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
        💬 {c.replies} réponse{c.replies > 1 ? "s" : ""}
        <span style={{ fontSize:9, transform: open ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span></button>
      {open && (
        <div style={{ marginTop:8, marginLeft:4, paddingLeft:12, borderLeft:`2px solid color-mix(in srgb, ${P} 30%, var(--border))`,
          display:"flex", flexDirection:"column", gap:10 }}>
          {items.map(r => {
            const author = creatorUid && String(r.uid) === String(creatorUid);
            return (
              <div key={r.id} style={{ display:"flex", gap:8 }}>
                {r.avatar ? <MwImg src={r.avatar} w={44} style={{ width:22, height:22, borderRadius:"50%", flexShrink:0 }}/>
                  : <span style={{ width:22, height:22, borderRadius:"50%", background:"var(--surface2)", flexShrink:0 }}/>}
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontSize:11, color:"var(--muted)", display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                    <b style={{ color:"var(--text2)" }}>{r.user}</b>
                    {author && <span style={{ fontSize:9.5, fontWeight:900, padding:"0 6px", borderRadius:10, color:"#fff",
                      background:"linear-gradient(135deg, #06B6D4, #3B82F6)" }}>créateur</span>}
                    {r.to && <span>↪ à <b style={{ color:"var(--text2)" }}>{r.to}</b></span>}
                    {r.when && <span>· {fmtDate(r.when)}</span>}
                  </div>
                  {r.text && <div style={{ fontSize:12.5, color:"var(--text)", lineHeight:1.45, whiteSpace:"pre-wrap", marginTop:1 }}>
                    {(orig[r.id] && r.original ? r.original : r.text).trim()}</div>}
                  {r.original && <button onClick={() => setOrig(o => ({ ...o, [r.id]: !o[r.id] }))}
                    style={{ ...textBtn, marginTop:1, fontSize:10.5, color:"var(--muted)" }}>
                    {orig[r.id] ? "Afficher la traduction" : "Afficher l'original"}</button>}
                  {r.images?.length > 0 && <div style={{ display:"flex", gap:4, marginTop:4, overflowX:"auto" }}>
                    {r.images.map((u, i) => <a key={i} href={u} onClick={e => { e.preventDefault(); onZoom(r.images, i); }}>
                      <MwImg src={u} w={112} animate style={{ width:52, height:52, objectFit:"cover", borderRadius:6 }}/></a>)}</div>}
                  {r.likes > 0 && <div style={{ fontSize:10, color:"var(--muted)", marginTop:2 }}>♥ {r.likes}</div>}
                </div>
              </div>);
          })}
          {busy && <span style={{ fontSize:11, color:"var(--muted)" }}>Lecture des autres réponses…</span>}
          {!busy && !all && c.replies > items.length && <span style={{ fontSize:11, color:"var(--muted)" }}>
            {c.replies - items.length} autre{c.replies - items.length > 1 ? "s" : ""} réponse{c.replies - items.length > 1 ? "s" : ""} sur MakerWorld</span>}
        </div>
      )}
    </div>
  );
}

function PicStrip({ pictures, onOpen, small = false }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const [edge, setEdge] = useState({ l: false, r: pictures.length > 1 });
  // pas un ecran tactile (souris, pave tactile) : fleches, glisser a la souris, calage souple
  const fine = typeof window !== "undefined" && !window.matchMedia?.("(pointer: coarse)").matches;
  const look = () => { const el = ref.current; if (!el) return;
    setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 }); };
  useEffect(() => { look(); }, [pictures.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = d => { const el = ref.current; if (!el) return;
    const w = el.firstElementChild?.getBoundingClientRect().width || el.clientWidth * 0.78;
    el.scrollBy({ left: d * (w + 8), behavior: "smooth" }); };
  const down = e => { if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false }; };
  const move = e => { const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    if (d.moved) ref.current.scrollLeft = d.left - dx; };
  const up = () => { const d = drag.current; drag.current = null;
    if (d?.moved) { ref.current.dataset.dragged = "1"; setTimeout(() => { if (ref.current) delete ref.current.dataset.dragged; }, 0); } };
  const arrow = (d, show) => fine && pictures.length > 1 && show && <button type="button" aria-label={d < 0 ? "Image précédente" : "Image suivante"}
    onClick={e => { e.stopPropagation(); step(d); }}
    style={{ position:"absolute", top: small ? "50%" : "calc(50% + 24px)", [d < 0 ? "left" : "right"]:8, transform:"translateY(-50%)", width:34, height:34, borderRadius:"50%",
      border:"1px solid rgba(255,255,255,.35)", background:"rgba(15,23,42,0.55)", backdropFilter:"blur(6px)", color:"#fff", fontSize:18, fontWeight:900,
      cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2 }}>{d < 0 ? "‹" : "›"}</button>;
  return (
    <div style={{ position:"relative", margin:"0 -16px 14px" }}>
      <div ref={ref} onScroll={look} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ display:"flex", gap:8, overflowX:"auto", scrollSnapType: fine ? "x proximity" : "x mandatory", overscrollBehaviorX:"contain",
          padding: small ? "2px 0 4px" : "52px 16px 4px", touchAction:"pan-x pan-y", cursor: fine && pictures.length > 1 ? "grab" : undefined,
          background: small ? "none" : "radial-gradient(70% 60% at 50% 0%, rgba(6,182,212,0.18), transparent 70%)" }}>
        {pictures.map((u, i) => (
          <div key={i} role="button" tabIndex={0} draggable={false}
            onClick={() => { if (!ref.current?.dataset.dragged) onOpen(i); }}
            onKeyDown={e => { if (e.key === "Enter") onOpen(i); }}
            style={{ position:"relative", flexShrink:0, width: small ? 110 : "78%", maxWidth:360, scrollSnapAlign: small ? "start" : "center", cursor:"zoom-in" }}>
            <MwImg src={u} w={small ? 240 : 360} eager={i < 2} animate draggable={false}
              style={{ width:"100%", aspectRatio:"1", objectFit:"cover", borderRadius: small ? 12 : 18, display:"block", userSelect:"none",
                background:"var(--surface2)", boxShadow:"0 12px 28px -14px rgba(0,0,0,.6)" }}/>
            {pictures.length > 1 && <span style={{ position:"absolute", right:8, bottom:8, padding:"2px 8px", borderRadius:20, fontSize:10.5,
              fontWeight:800, color:"#fff", background:"rgba(15,23,42,0.6)", backdropFilter:"blur(6px)" }}>{i + 1} / {pictures.length}</span>}
          </div>
        ))}
      </div>
      {arrow(-1, edge.l)}{arrow(1, edge.r)}
    </div>
  );
}
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

// Texte replie sur `lines` lignes entieres (jamais une demi-ligne). Le fondu
// sur la derniere ligne et onOverflow(true) seulement si le texte depasse
// vraiment : avant, le fondu s'appliquait meme a un texte court, et « Lire la
// suite » dependait d'un nombre de caracteres.
function Folded({ lines, open, onOverflow, style, children }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const o = el.scrollHeight > el.clientHeight + 2;
      if (!open) { setOver(o); onOverflow?.(o); }
    };
    check();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [children, open, lines]);
  const lh = `${style?.lineHeight || 1.5}em`;
  return (
    <div ref={ref} style={{ ...style, ...(open ? null : {
      maxHeight:`calc(${lh} * ${lines})`, overflow:"hidden",
      ...(over ? { maskImage:`linear-gradient(#000 calc(100% - ${lh}), transparent)`,
                   WebkitMaskImage:`linear-gradient(#000 calc(100% - ${lh}), transparent)` } : null) }) }}>
      {children}
    </div>
  );
}

// Descriptif du profil (traduit, original a la demande), replie s'il est long.
function ProfileSummary({ p }) {
  const [more, setMore] = useState(false);
  const [orig, setOrig] = useState(false);
  const txt = orig && p.summary_original ? p.summary_original : p.summary;
  const [overflow, setOverflow] = useState(false);
  const long = overflow || more;
  const b = { background:"none", border:"none", padding:0, cursor:"pointer", fontSize:11.5, fontWeight:700, color:"#3b82f6" };
  return (
    <div style={{ padding:"0 10px 8px" }}>
      <Folded lines={4} open={more} onOverflow={setOverflow}
        style={{ fontSize:12, color:"var(--text2)", lineHeight:1.5, whiteSpace:"pre-wrap" }}>{txt}</Folded>
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

// bare : pas de carte autour (profils, similaires : deja des cartes)
function Section({ title, children, open, onToggle, icon = null, c = "#3B82F6", bare = false }) {
  const shut = onToggle && !open;
  const ico = icon && <span style={{ width:28, height:28, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14,
    background:`${c}26`, flexShrink:0 }}>{icon}</span>;
  const head = { display:"flex", alignItems:"center", gap:8, fontSize:13.5, fontWeight:900, color:"var(--text)" };
  return (
    <div style={{ marginBottom:14, ...(bare ? null : { padding:"12px 14px", borderRadius:18, border:`1px solid ${c}33`,
      background:`linear-gradient(160deg, ${c}14, transparent 50%), var(--surface2)` }) }}>
      {onToggle ? (
        <button onClick={onToggle} style={{ ...head, width:"100%", background:"none", border:"none", padding:0, margin: shut ? 0 : "0 0 8px",
          cursor:"pointer", textAlign:"left" }}>
          {ico}<span style={{ flex:1 }}>{title}</span>
          <span style={{ fontSize:11, color:"var(--muted)", transform: open ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span>
        </button>
      ) : <div style={{ ...head, margin:"0 0 8px" }}>{ico}{title}</div>}
      {children}
    </div>
  );
}

const msg = { fontSize:13, color:"var(--muted)", padding:"12px 0", margin:0 };
const linkBtn = { padding:"7px 12px", borderRadius:12, fontSize:12, fontWeight:800, textDecoration:"none",
  color:"#3b82f6", background:"rgba(59,130,246,0.1)", border:"1px solid rgba(59,130,246,0.3)" };
const WIDE = typeof window !== "undefined" && window.innerWidth >= 900;
const roundTop = { width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)", background:"color-mix(in srgb, var(--sheet-bg) 80%, transparent)",
  backdropFilter:"blur(6px)", color:"var(--text2)", cursor:"pointer", fontSize:15, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center" };
const fBtn = { padding:"11px 12px", borderRadius:12, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)", fontSize:13.5,
  fontWeight:800, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, textDecoration:"none", boxSizing:"border-box" };
const sq = { ...fBtn, width:44, flex:"0 0 auto", padding:"8px 0", fontSize:17, textAlign:"center" };
// un bouton en retrait garde sa couleur, en pointilles ; le toucher dit pourquoi
const dim = rgb => ({ background:`rgba(${rgb},0.05)`, border:`1px dashed rgba(${rgb},0.45)` });
const badge = c => ({ position:"absolute", top:-5, right:-5, minWidth:17, height:17, padding:"0 4px", borderRadius:9, boxSizing:"border-box",
  background:c, color:"#fff", fontSize:10, fontWeight:900, lineHeight:"17px", textAlign:"center", boxShadow:"0 0 0 2px var(--sheet-bg, var(--surface))" });
const primary = { border:"none", color:"#fff", background:"linear-gradient(135deg, #22C55E, #16A34A)", boxShadow:"0 8px 18px -10px #22C55E" };
const grad = (a, b) => ({ backgroundImage:`linear-gradient(135deg, ${a}, ${b})`, WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" });
const textBtn = { marginTop:6, fontSize:12, fontWeight:600, color:"#3b82f6", background:"none", border:"none",
  padding:0, cursor:"pointer" };
const pBadge = { fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20, background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text2)" };
const chip = { fontSize:11, padding:"3px 10px", borderRadius:20, background:"rgba(6,182,212,0.12)", color:"#06B6D4", fontWeight:800 };
