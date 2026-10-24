import React, { useEffect, useRef, useState } from "react";
import HiddenMark from "./HiddenMark";
import Cachettes from "./Cachettes";
import { useTrackDetail } from "../utils/track";
import { useUrlTab } from "../utils/useUrlTab";
import { createPortal } from "react-dom";
import client from "../api/client";
import AdminOnly from "./AdminOnly";
import { showAlert, showConfirm } from "../utils/dialog";
import MakerWorldCollectionsPicker from "./MakerWorldCollectionsPicker";
import MakerWorldModelSheet, { prefetchModel } from "./MakerWorldModelSheet";
import MwImg from "./MwImg";
import MwCreator from "./MwCreator";
import MwContests from "./MwContests";
import { openCreator } from "./MwCreatorPage";
import { useToRate, ToRateTile, ToRateSheet } from "./MwToRate";
import { mwPatch, onMwChange } from "../utils/mwSync";
import { useFriend } from "../store/friend";
import { useMine, MineBadge } from "./Friends";
import { Pressable } from "./ContextMenu";
import { useIsAdmin, useCanMw, useCanMwHome } from "../store/auth";
import { useMwAssign } from "../store/mwAssign";

// Cache de la vue (le temps de la session) : revenir sur un onglet ou une
// collection affiche aussitot ce qu'on avait, puis se met a jour en fond.
const CACHE = new Map();
const sameIds = (a, b) => a.length >= b.length && b.every((x, i) => a[i]?.design_id === x.design_id);

// Onglet MakerWorld de l'Historique (compte connecte dans les Parametres) : collections
// de favoris puis leurs modeles, et modeles aimes ; chacun avec « deja
// imprime N fois » ou « jamais imprime », croise avec l'historique. Lecture
// seule. Si l'API ne repond plus, la fenetre le dit et rien d'autre n'est touche.
// La recherche MakerWorld est publique : elle marche sans compte.
// La recherche vit dans Découvrir (champ en tete) : un onglet de moins.
const TABS = [["favorites", "Collections"], ["likes", "J'aime"], ["following", "Suivis"], ["discover", "Découvrir"],
  ["creator", "Créateur"]];
const PUBLIC_TABS = ["search", "discover"];      // sans compte (sauf « Pour vous »)
// « Il y a 3 j » : date de publication (Suivis).
const ago = iso => {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (!(d >= 0)) return null;
  return d < 1 ? "aujourd'hui" : d < 2 ? "hier" : d < 31 ? `il y a ${Math.floor(d)} j`
    : d < 365 ? `il y a ${Math.floor(d / 30)} mois` : `il y a ${Math.floor(d / 365)} an${d >= 730 ? "s" : ""}`;
};
const FILTERS = [["all", "Tous"], ["printed", "Déjà imprimés"], ["new", "Jamais imprimés"]];

export default function MakerWorldView({ onSearch }) {
  const [tab, setTab] = useUrlTab("mw", "favorites", TABS.map(([k]) => k));
  useTrackDetail(`MakerWorld · ${(TABS.find(([k]) => k === tab) || [tab, tab])[1]}`);
  const [coll, setColl] = useState(null);          // collection ouverte { id, title }
  const [data, setData] = useState(null);          // { items } | { collections } | { error }
  const [pf, setPf] = useState("all");           // tous / deja imprimes / jamais imprimes
  const [creators, setCreators] = useState(null);  // Suivis : createurs suivis (liste du profil)
  const [picked, setPicked] = useState([]);        // Suivis : createurs choisis (vide = tous)
  const [picker, setPicker] = useState(false);     // Suivis : fenetre de choix des createurs
  const [progress, setProgress] = useState(null);  // Suivis : { done, total } pendant le chargement
  const [pickFor, setPickFor] = useState(null);    // modele a ranger dans mes collections
  const [model, setModel] = useState(null);        // fiche ouverte (design_id)
  const [reload, setReload] = useState(0);         // relecture apres une ecriture
  const [nameEdit, setNameEdit] = useState(null);  // { mode: "new"|"rename", value }
  const [status, setStatus] = useState(null);
  const [navs, setNavs] = useState(null);          // Decouvrir : fils proposes par MakerWorld
  const [dk, setDk] = useState(null);              // Decouvrir : fil choisi
  const [catsOpen, setCatsOpen] = useState(false); // Decouvrir : grille des categories depliee
  const [q, setQ] = useState("");                  // saisie de recherche
  const [sq, setSq] = useState("");                // recherche lancee
  const [more, setMore] = useState(false);         // page suivante en cours
  const sentinel = useRef(null);                   // bas de grille : charge la page suivante
  const freshRef = useRef(false);                  // ⟳ : relire MakerWorld sans passer par les caches
  const [busy, setBusy] = useState(false);         // ⟳ en cours

  // J'aime retire, modele range ailleurs : la liste ouverte suit aussitot.
  const curKey = tab === "likes" ? "likes" : tab === "favorites" && coll ? `coll:${coll.id}` : null;
  const keyRef = useRef(curKey);
  keyRef.current = curKey;
  useEffect(() => onMwChange(() => {
    const k = keyRef.current;
    setData(d => { const p = k && d?.items ? mwPatch(k, d) : d; if (k && p !== d) CACHE.set(k, p); return p; });
  }), []);

  useEffect(() => {
    client.get("/makerworld/status").then(({ data }) => setStatus(data)).catch(() => setStatus({}));
  }, []);

  // Ouvrir une collection = une etape dans l'historique : le geste « retour »
  // (Android), le bouton retour du navigateur et « ‹ » la referment, au lieu de
  // quitter la page.
  const openColl = (c) => {
    try { window.history.pushState({ ...(window.history.state || {}), mwColl: c.id }, ""); } catch { /* rien */ }
    setColl(c);
  };
  const closeColl = () => {
    if (window.history.state?.mwColl) window.history.back();   // popstate referme
    else setColl(null);
  };
  useEffect(() => {
    // Trace laissee par une page rechargee collection ouverte : on l'efface.
    if (window.history.state?.mwColl) {
      const { mwColl, ...rest } = window.history.state;
      try { window.history.replaceState(rest, ""); } catch { /* rien */ }
    }
    const onPop = () => { if (!window.history.state?.mwColl) setColl(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Une recherche lancee dans Decouvrir remplace le fil par ses resultats.
  const view = tab === "discover" && sq ? "search" : tab;

  // Decouvrir : liste des fils, puis « Pour vous » si le compte est connecte.
  useEffect(() => {
    if (tab !== "discover" || navs || status === null) return;
    client.get("/makerworld/discover/navs").then(({ data }) => {
      const list = data.navs || [];
      setNavs(list);
      setDk(k => k || (status?.connected && list.some(n => n.key === "Foryou") ? "Foryou" : "Trending"));
    }).catch(() => { setNavs([{ key: "Trending", name: "Tendance" }]); setDk(k => k || "Trending"); });
  }, [tab, status]);

  useEffect(() => {
    if (view === "discover") {
      if (!dk) { setData(null); return; }
      if (dk === "__contests") { setData({ items: [] }); setBusy(false); return; }   // vue a part (MwContests)
      let alive = true;
      const key = `disc:${dk}`;
      const fresh = freshRef.current;
      freshRef.current = false;
      setData(CACHE.get(key) || null);
      client.get("/makerworld/discover", { params: { key: dk, ...(fresh ? { fresh: 1 } : {}) } })
        .then(({ data }) => { if (!alive) return; setBusy(false); const c = CACHE.get(key);
          if (fresh || !(c && sameIds(c.items, data.items))) { CACHE.set(key, data); setData(data); } })
        .catch(e => { if (alive) { setBusy(false); setData({ error: e.response?.data?.detail || e.message }); } });
      return () => { alive = false; };
    }
    if (view === "search") {
      if (!sq) { setData({ items: [] }); return; }
      let alive = true;
      const key = `search:${sq}`;
      setData(CACHE.get(key) || null);
      client.get("/makerworld/search", { params: { q: sq } })
        .then(({ data }) => { if (!alive) return; setBusy(false); const c = CACHE.get(key);
          if (!(c && sameIds(c.items, data.items))) { CACHE.set(key, data); setData(data); } })
        .catch(e => alive && setData({ error: e.response?.data?.detail || e.message }));
      return () => { alive = false; };
    }
    if (!status?.connected || tab === "creator") return;   // Createur : son propre composant
    let alive = true, timer = null;
    const fresh = freshRef.current;
    freshRef.current = false;
    const fp = fresh ? { fresh: 1 } : {};
    if (tab === "following") {
      // Par lots de 20 createurs : les premiers modeles s'affichent tout de
      // suite, la suite se complete (250 suivis ne font pas attendre).
      const fkey = `follow:${picked.join(",") || "tous"}`;
      const cached = CACHE.get(fkey);
      setData(cached || null); setProgress(null);
      (async () => {
        try {
          let list = fresh ? null : creators;
          if (!list) {
            list = (await client.get("/makerworld/following/creators", { params: fp })).data.creators || [];
            if (!alive) return;
            setCreators(list);
          }
          const target = picked.length ? picked : list.map(c => c.uid);
          const per = target.length <= 5 ? 40 : 10;
          let acc = [];
          setProgress({ done: 0, total: target.length });
          if (!target.length) { setData({ items: [] }); return; }
          for (let i = 0; i < target.length && alive; i += 20) {
            const { data: d } = await client.get("/makerworld/following",
              { params: { uids: target.slice(i, i + 20).join(","), per, ...fp } });
            if (!alive) return;
            const seen = new Set(acc.map(x => x.design_id));
            acc = [...acc, ...(d.items || []).filter(x => !seen.has(x.design_id))]
              .sort((a, b) => (b.published || "").localeCompare(a.published || ""));
            // Deja en cache : on garde l'affichage et on remplace a la fin.
            if (!cached) setData({ items: acc });
            setProgress({ done: Math.min(i + 20, target.length), total: target.length });
          }
          if (alive) { CACHE.set(fkey, { items: acc }); setData({ items: acc }); setBusy(false); }
        } catch (e) { if (alive) { setBusy(false); if (!cached) setData({ error: e.response?.data?.detail || e.message }); } }
      })();
      return () => { alive = false; };
    }
    const url = tab === "likes" ? "/makerworld/collection/likes"
      : coll ? `/makerworld/collections/${coll.id}` : "/makerworld/collections";
    const key = tab === "likes" ? "likes" : coll ? `coll:${coll.id}` : "colls";
    const cached = CACHE.get(key);
    const load = (again) => client.get(url, { params: again ? fp : {} }).then(({ data }) => {
      if (!alive) return;
      setBusy(false);
      // Pages deja chargees en cache et meme debut : on garde le cache (le
      // defilement n'est pas ramene en haut) en rafraichissant les etats.
      if (!fresh && data.items && cached?.items && sameIds(cached.items, data.items)) {
        const fresh = new Map(data.items.map(x => [x.design_id, x]));
        data = { ...cached, items: cached.items.map(x => fresh.get(x.design_id) || x) };
      }
      data = mwPatch(key, data);
      CACHE.set(key, data);
      setData(data);
      // Modeles sans fiche : lus en arriere-plan, on recharge une fois.
      if (data.pending && again) timer = setTimeout(() => load(false), 8000);
    }).catch(e => { if (!alive) return; setBusy(false); if (!cached) setData({ error: e.response?.data?.detail || e.message }); });
    setData(cached ? mwPatch(key, cached) : null);
    load(true);
    return () => { alive = false; clearTimeout(timer); };
  }, [tab, coll?.id, status?.connected, sq, dk, picked.join(","), reload]);

  const pageUrl = view === "discover" ? "/makerworld/discover" : view === "search" ? "/makerworld/search" : tab === "likes" ? "/makerworld/collection/likes"
    : coll ? `/makerworld/collections/${coll.id}` : null;
  const pageKey = view === "discover" ? `disc:${dk}` : view === "search" ? `search:${sq}` : tab === "likes" ? "likes" : coll ? `coll:${coll.id}` : null;
  const hasMore = !!data?.items && (PUBLIC_TABS.includes(tab) ? data.total > data.items.length
    : (tab === "likes" || coll) ? !!data.has_more : false);
  const loadMore = () => {
    if (more || !pageUrl) return;
    setMore(true);
    client.get(pageUrl, { params: { ...(view === "search" ? { q: sq } : view === "discover" ? { key: dk, ...(data.seed ? { seed: data.seed } : {}) } : {}),
      offset: data.next_offset ?? data.items.length } })
      .then(({ data: d }) => setData(prev => {
        const seen = new Set(prev.items.map(y => y.design_id));
        const next = { ...prev, has_more: d.has_more, total: d.total ?? prev.total,
          next_offset: d.next_offset,
          items: [...prev.items, ...(d.items || []).filter(x => !seen.has(x.design_id))] };
        if (!(d.items || []).length) next.has_more = false;
        const patched = mwPatch(pageKey, next);
        if (pageKey) CACHE.set(pageKey, patched);
        return patched;
      }))
      .catch(() => {}).finally(() => setMore(false));
  };
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || more) return;
    // Defilement infini : observateur + controle au defilement (la page
    // defile dans un conteneur, et certains navigateurs integres retardent
    // l'observateur).
    let raf = 0;
    const check = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; const r = el.getBoundingClientRect(); if (r.top < window.innerHeight + 600) loadMore(); });
    };
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) loadMore(); }, { rootMargin: "600px" });
    io.observe(el);
    document.addEventListener("scroll", check, { capture: true, passive: true });
    check();
    return () => { io.disconnect(); cancelAnimationFrame(raf); document.removeEventListener("scroll", check, true); };
  });

  const saveName = async () => {
    const v = (nameEdit?.value || "").trim();
    if (!v) return;
    try {
      if (nameEdit.mode === "new") await client.post("/makerworld/collections", { title: v });
      else {
        const id = nameEdit.id || coll.id;
        await client.put(`/makerworld/collections/${id}`, { title: v });
        setColl(c => c && c.id === id ? { ...c, title: v } : c);
      }
      setNameEdit(null); setReload(n => n + 1);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const delColl = async (c = coll) => {
    if (!(await showConfirm(`Supprimer la collection « ${c.title} » sur MakerWorld ? Les modèles, eux, restent.`,
      { danger: true, confirmLabel: "Supprimer" }))) return;
    try { await client.delete(`/makerworld/collections/${c.id}`); setColl(null); setReload(n => n + 1); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };

  const showModels = (tab !== "favorites" && tab !== "creator") || !!coll;
  const friend = useFriend((s) => s.friend);
  const isAdmin = useIsAdmin();
  const canMw = useCanMw();
  const isHomeAdmin = useCanMwHome();       // ranger dans MES collections : droit MakerWorld
  const startAssign = useMwAssign((s) => s.start);
  // Menus d'appui long / clic droit : collection, modele.
  const collMenu = c => ({
    title: c.title, subtitle: c.count != null ? `${c.count} modèle${c.count > 1 ? "s" : ""}` : null, color: "#06B6D4",
    items: [
      { icon: "📂", label: "Ouvrir", tone: "#06B6D4", onClick: () => openColl(c) },
      canMw && status?.connected && "-",
      canMw && status?.connected && { icon: "✎", label: "Renommer", tone: "#3B82F6", onClick: () => setNameEdit({ mode: "rename", value: c.title, id: c.id }) },
      canMw && status?.connected && { icon: "🗑", label: "Supprimer…", hint: "Sur MakerWorld ; les modèles restent", danger: true, onClick: () => delColl(c) },
    ],
  });
  const modelMenu = x => ({
    title: x.title_fr || x.title || `Modèle ${x.design_id}`, subtitle: x.creator_name ? `par ${x.creator_name}` : null, color: x.printed > 0 ? "#22C55E" : "#06B6D4",
    items: [
      { icon: "📄", label: "Ouvrir la fiche", tone: "#3B82F6", onClick: () => setModel(x) },
      x.url && { icon: "🌐", label: "Voir sur MakerWorld", tone: "#06B6D4", onClick: () => window.open(x.url, "_blank", "noopener") },
      x.printed > 0 && onSearch && { icon: "🖨️", label: "Voir mes impressions", hint: printedLabel(x), tone: "#22C55E", onClick: () => onSearch(x) },
      "-",
      (status?.connected || friend) && isHomeAdmin && { icon: "🔖", label: "Ranger dans mes collections…", tone: "#14B8A6", onClick: () => setPickFor(x) },
      isAdmin && !friend && { icon: "🔗", label: "Associer à un print", hint: "Choisir les impressions de ce modèle", tone: "#8B5CF6",
        onClick: () => startAssign({ design_id: x.design_id, title: x.title, title_fr: x.title_fr, cover_url: x.cover_url }) },
    ],
  });
  // « A evaluer » : tuile en tete des collections (chez moi seulement).
  const toRate = useToRate(tab === "favorites" && !coll && !friend);
  const [rateOpen, setRateOpen] = useState(false);
  const all = data?.items || [];
  const items = all.filter(x => pf === "all" || (pf === "new" ? !x.printed : x.printed > 0));
  const mineOf = useMine(showModels ? all.map(x => x.design_id) : []);   // chez un copain : « deja chez moi ? »
  const count = { all: all.length, printed: all.filter(x => x.printed > 0).length, new: all.filter(x => !x.printed).length };

  // les sous-onglets, chacun sa couleur (comme les onglets de la page)
  const SUB = { favorites: ["📁", "#06B6D4"], likes: ["❤️", "#EC4899"], following: ["👤", "#8B5CF6"], discover: ["✨", "#F59E0B"], creator: ["🎨", "#22C55E"] };
  const collOpen = coll && tab === "favorites";

  return (
      <div style={{ display:"flex", flexDirection:"column" }}>
        {/* Collection ouverte : sa barre (‹ titre) reste en haut au defilement. */}
        {collOpen && (
          <div style={{ position:"sticky", top:0, zIndex:20, display:"flex", alignItems:"center", gap:8, margin:"0 -4px", padding:"8px 4px",
            background:"color-mix(in srgb, var(--bg) 88%, transparent)", backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)",
            borderBottom:"1px solid var(--border)" }}>
            <button onClick={closeColl} data-tip="Toutes les collections" aria-label="Toutes les collections" style={round}>‹</button>
            <span style={{ width:34, height:34, borderRadius:11, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16,
              background:"linear-gradient(135deg, #06B6D4, #3B82F6)", color:"#fff", boxShadow:"0 6px 14px -8px #06B6D4" }}>📁</span>
            <span style={{ flex:1, minWidth:0 }}>
              <span style={{ display:"block", fontSize:15, fontWeight:900, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{coll.title}</span>
              {data?.items && <span style={{ display:"block", fontSize:11.5, fontWeight:700, color:"var(--muted)" }}>
                {count.all} modèle{count.all > 1 ? "s" : ""}{count.printed ? ` · ${count.printed} imprimé${count.printed > 1 ? "s" : ""}` : ""}</span>}
            </span>
            {status?.connected && (
              <AdminOnly mw>
                <button onClick={() => setNameEdit({ mode: "rename", value: coll.title })} data-tip="Renommer" aria-label="Renommer" style={round}>✎</button>
                <button onClick={() => delColl()} data-tip="Supprimer la collection" aria-label="Supprimer la collection" style={{ ...round, color:"#ef4444" }}>🗑</button>
              </AdminOnly>
            )}
          </div>
        )}
        <div style={{ padding:"2px 0 10px" }}>
          {status && (
            <>
            {/* Onglets sur une seule ligne, meme sur telephone ; les actions passent dessous. */}
            <div style={{ display:"flex", gap:3, marginTop:10, padding:3, borderRadius:16, background:"var(--surface2)", border:"1px solid var(--border)" }}>
              {TABS.filter(([k]) => k !== "creator" || status.connected).map(([k, l]) => {
                const [ic, c] = SUB[k], on = tab === k;
                return (
                  <button key={k} onClick={() => { setTab(k); if (k !== "favorites") setColl(null); }}
                    style={{ flex:"1 1 auto", minWidth:0, padding:"7px 3px", borderRadius:12, fontSize:"clamp(10.5px, 3.1vw, 12.5px)", fontWeight:800,
                      cursor:"pointer", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", border:"none",
                      display:"flex", alignItems:"center", justifyContent:"center", gap:4,
                      background: on ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "transparent",
                      color: on ? "white" : "var(--muted)", boxShadow: on ? `0 6px 14px -6px ${c}` : "none" }}>
                    {/* l'icone sur l'onglet ouvert seulement : les cinq noms tiennent sur une ligne */}
                    {on && <span style={{ fontSize:"clamp(10px, 3vw, 12px)" }}>{ic}</span>}
                    <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{l}</span></button>);
              })}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:8 }}>
              {(view === "search" ? !!sq : view === "discover" ? !!dk : status.connected) && (
                <button onClick={() => { freshRef.current = true; setBusy(true); setReload(n => n + 1); }} disabled={busy}
                  data-tip="Interroger MakerWorld maintenant" aria-label="Interroger MakerWorld maintenant" style={round}>
                  {busy ? <span className="mw-spin" style={{ width:13, height:13 }}/> : "⟳"}
                </button>
              )}
              {tab === "favorites" && !coll && status.connected && !nameEdit && (
                <AdminOnly mw>
                  <button onClick={() => setNameEdit({ mode: "new", value: "" })} data-tip="Nouvelle collection"
                    style={{ ...round, width:"auto", padding:"0 12px", gap:5, fontSize:12.5, color:"#06B6D4" }}>＋ Collection</button>
                </AdminOnly>
              )}
              {/* tous / deja imprimes / jamais imprimes, avec leur nombre */}
              {showModels && !(view === "discover" && dk === "__contests") && (
                <div style={{ marginLeft:"auto", display:"flex", gap:2, padding:3, borderRadius:14, background:"var(--surface2)", border:"1px solid var(--border)", minWidth:0 }}>
                  {[["all", "Tous", "#3B82F6"], ["printed", "✓ Imprimés", "#22C55E"], ["new", "Jamais", "#F59E0B"]].map(([k, l, c]) => (
                    <button key={k} onClick={() => setPf(k)} data-tip={FILTERS.find(f => f[0] === k)[1]}
                      style={{ padding:"5px 9px", borderRadius:11, border:"none", cursor:"pointer", fontSize:11.5, fontWeight:800, whiteSpace:"nowrap",
                        background: pf === k ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "transparent",
                        color: pf === k ? "#fff" : "var(--muted)" }}>
                      {l}{data?.items ? <span style={{ opacity:.85 }}> {count[k]}</span> : ""}</button>))}
                </div>
              )}
            </div>
            </>
          )}
          {nameEdit && (
            <div style={{ display:"flex", gap:6, marginTop:10, padding:8, borderRadius:16, border:"1px solid rgba(6,182,212,0.35)",
              background:"linear-gradient(135deg, rgba(6,182,212,0.12), transparent 70%), var(--surface2)" }}>
              <input value={nameEdit.value} onChange={e => setNameEdit(n => ({ ...n, value: e.target.value }))} autoFocus
                maxLength={60} autoComplete="off" placeholder={nameEdit.mode === "new" ? "Nom de la nouvelle collection" : "Nouveau nom"}
                onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setNameEdit(null); }}
                style={{ flex:1, minWidth:0, padding:"8px 12px", borderRadius:12, fontSize:13, background:"var(--surface)",
                  border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
              <button onClick={() => setNameEdit(null)} aria-label="Annuler" style={round}>✕</button>
              <button onClick={saveName} disabled={!nameEdit.value.trim()}
                style={{ padding:"8px 14px", borderRadius:12, fontSize:12.5, fontWeight:800, border:"none",
                  background:"linear-gradient(135deg, #06B6D4, #3B82F6)", color:"white", cursor:"pointer" }}>{nameEdit.mode === "new" ? "Créer" : "Renommer"}</button>
            </div>
          )}
          {tab === "following" && creators && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, flexWrap:"wrap" }}>
              <button onClick={() => setPicker(true)} style={pill(picked.length > 0, "#8B5CF6")}>
                👤 {picked.length ? `${picked.length} créateur${picked.length > 1 ? "s" : ""}` : `Tous les créateurs (${creators.length})`}
              </button>
              {picked.length > 0 && (
                <button onClick={() => setPicked([])} data-tip="Tous les créateurs" aria-label="Tous les créateurs" style={{ ...round, width:30, height:30 }}>✕</button>
              )}
              {progress && progress.done < progress.total && (
                <span style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:11.5, fontWeight:700, color:"#8B5CF6" }}>
                  <span className="mw-spin" style={{ width:11, height:11 }}/>Chargement {progress.done} / {progress.total} créateurs…</span>
              )}
            </div>
          )}
          {picker && creators && (
            <CreatorPicker creators={creators} picked={picked}
              onClose={() => setPicker(false)} onApply={ids => { setPicked(ids); setPicker(false); }}/>
          )}
          {tab === "discover" && (
            <form onSubmit={e => { e.preventDefault(); setSq(q.trim()); }}
              style={{ display:"flex", gap:6, marginTop:10 }}>
              <div style={{ position:"relative", flex:1, minWidth:0 }}>
                <span style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)", fontSize:13, pointerEvents:"none" }}>🔎</span>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher sur MakerWorld…"
                  autoComplete="off" enterKeyHint="search"
                  style={{ width:"100%", height:40, boxSizing:"border-box", padding:"0 34px 0 36px", borderRadius:20, fontSize:13,
                    background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
                {sq && (
                  <button type="button" onClick={() => { setQ(""); setSq(""); }} aria-label="Revenir au fil" data-tip="Revenir au fil"
                    style={{ position:"absolute", right:6, top:"50%", transform:"translateY(-50%)", width:28, height:28, borderRadius:"50%",
                      border:"none", background:"var(--surface)", color:"var(--muted)", cursor:"pointer" }}>✕</button>
                )}
              </div>
              <button type="submit" disabled={!q.trim()}
                style={{ padding:"0 16px", height:40, borderRadius:20, fontSize:12.5, fontWeight:800, border:"none",
                  background: q.trim() ? "linear-gradient(135deg, #F59E0B, #F97316)" : "var(--surface2)", color: q.trim() ? "white" : "var(--muted)",
                  cursor:"pointer" }}>Chercher</button>
            </form>
          )}
          {tab === "discover" && navs && (() => {
            // Pas de rangee qui defile de cote : la coquille Android y arme le
            // tirer-pour-rafraichir et le geste saccade. Les fils principaux
            // restent en ligne, les categories se deplient en grille.
            const main = navs.filter(n => !n.category);
            const cats = navs.filter(n => n.category);
            const curCat = cats.find(n => n.key === dk);
            return (<>
              <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
                {main.map(n => (
                  <button key={n.key} onClick={() => { setDk(n.key); setCatsOpen(false); setSq(""); setQ(""); }} style={pill(!sq && dk === n.key, "#F59E0B")}>
                    {n.key === "Foryou" ? "✨ " : n.key === "Trending" ? "🔥 " : ""}{n.name}
                  </button>
                ))}
                <button onClick={() => { setDk("__contests"); setCatsOpen(false); setSq(""); setQ(""); }}
                  style={pill(!sq && dk === "__contests", "#EAB308")}>🏆 Concours</button>
                {cats.length > 0 && (
                  <button onClick={() => setCatsOpen(v => !v)} style={pill(!!curCat, "#06B6D4")}>
                    📂 {curCat ? curCat.name : "Catégories"} {catsOpen ? "▴" : "▾"}
                  </button>
                )}
              </div>
              {catsOpen && (
                <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap", padding:10, borderRadius:16,
                  background:"linear-gradient(135deg, rgba(6,182,212,0.10), transparent 70%), var(--surface2)", border:"1px solid var(--border)" }}>
                  {cats.map(n => (
                    <button key={n.key} onClick={() => { setDk(n.key); setCatsOpen(false); setSq(""); setQ(""); }} style={pill(!sq && dk === n.key, "#06B6D4")}>
                      {n.name}</button>
                  ))}
                </div>
              )}
            </>);
          })()}

        </div>

        {model && <MakerWorldModelSheet designId={model.design_id} preview={model} onClose={() => setModel(null)} onSearch={onSearch}/>}
        {rateOpen && <ToRateSheet data={toRate} onClose={() => setRateOpen(false)} onOpen={x => setModel(x)}/>}
        {pickFor && (
          <MakerWorldCollectionsPicker designId={pickFor.design_id} title={pickFor.title} item={pickFor}
            onClose={() => setPickFor(null)} onSaved={() => tab === "favorites" && setReload(n => n + 1)}/>
        )}
        <div style={{ padding:"4px 0 16px" }}>
          {status === null ? <p style={msg}>…</p>
            : !PUBLIC_TABS.includes(tab) && !status.connected ? (
              <div style={{ padding:"20px 16px", borderRadius:18, border:"1px dashed var(--border)", textAlign:"center",
                background:"radial-gradient(80% 80% at 50% 0%, rgba(6,182,212,0.14), transparent 70%), var(--surface2)" }}>
                <div style={{ fontSize:30, marginBottom:6 }}>🌐</div>
                <p style={{ ...msg, padding:0 }}>Connecte ton compte MakerWorld dans <b>Paramètres → Comptes → MakerWorld</b> pour voir
                  tes collections et tes j'aime ici.</p>
              </div>
            ) : tab === "creator" ? (
              <MwCreator reload={reload} onOpen={setModel} onLoaded={() => setBusy(false)}/>
            ) : view === "discover" && dk === "__contests" ? (
              <MwContests reload={reload} onOpen={setModel}/>
            ) : data === null ? <Skeleton/>
            : data.error ? <p style={{ ...msg, color:"#f59e0b" }}>MakerWorld ne répond pas comme prévu : {data.error}</p>
            : !showModels ? (
              (data.collections || []).length === 0 && !toRate?.items?.length ? <p style={msg}>Aucune collection.</p> : (
                <div style={grid}>
                  {!friend && toRate?.items?.length > 0 && <ToRateTile data={toRate} card={card} onClick={() => setRateOpen(true)}/>}
                  {(data.collections || []).map(c => (
                    <Pressable as="button" key={c.id} onClick={() => openColl(c)} menu={() => collMenu(c)}
                      style={{ ...card, cursor:"pointer", padding:0, textAlign:"left", color:"var(--text)", position:"relative" }}>
                      <Mosaic covers={c.covers}/>
                      {/* le nom pose sur la mosaique, sur un fond qui fonce vers le bas */}
                      <span aria-hidden="true" style={{ position:"absolute", inset:0, background:"linear-gradient(transparent 45%, rgba(2,6,23,0.82))", pointerEvents:"none" }}/>
                      <span style={{ position:"absolute", left:10, right:10, bottom:9, display:"flex", flexDirection:"column", gap:1 }}>
                        <span style={{ fontSize:13.5, fontWeight:900, color:"#fff", lineHeight:1.2, textShadow:"0 1px 6px rgba(0,0,0,.5)",
                          overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>📁 {c.title}</span>
                        {c.count != null && <span style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,.8)" }}>{c.count} modèle{c.count > 1 ? "s" : ""}</span>}
                      </span>
                    </Pressable>
                  ))}
                </div>
              )
            ) : items.length === 0 ? <p style={msg}>{pf === "new" && all.length ? "Tout a déjà été imprimé 🎉"
                : pf === "printed" && all.length ? "Aucun n'a encore été imprimé."
                : view === "search" ? "Aucun résultat." : view === "discover" ? "Rien dans ce fil pour l'instant."
                : tab === "following" ? "Aucun modèle (ou aucun créateur suivi)." : "Rien dans cette liste."}</p>
            : (<>
              {data.pending > 0 && (
                <p style={{ ...msg, padding:"0 0 8px", display:"flex", alignItems:"center", gap:6 }}><span className="mw-spin" style={{ width:11, height:11 }}/>
                  {data.pending} modèle{data.pending > 1 ? "s" : ""} en cours de lecture…</p>
              )}
              <div style={grid}>
                {items.map(x => (
                  <Pressable key={x.design_id} menu={() => modelMenu(x)} style={{ ...tileCard, ...(x.printed > 0 ? printedCard : null) }}>
                    <div style={{ position:"relative" }}>
                      <a href={x.url} onClick={e => { e.preventDefault(); setModel(x); }} onPointerDown={() => prefetchModel(x.design_id)}
                        style={{ display:"block", position:"relative", cursor:"pointer", background:"var(--surface)" }}>
                        {x.cover_url
                          ? <MwImg src={x.cover_url} w={220} style={{ width:"100%", aspectRatio:"1", objectFit:"cover", display:"block" }}/>
                          : <div style={{ width:"100%", aspectRatio:"1" }}/>}
                        {x.printed > 0 && <span style={ribbon("#22C55E", "#16A34A")}>✓ IMPRIMÉ</span>}
                        {!x.printed && x.in_progress > 0 && <span style={ribbon("#F59E0B", "#F97316")}>⏳ EN COURS</span>}
                        {/* qui l'a range dans cette collection, depuis BambuNymous */}
                        {x.added?.by && <span data-tip={`Ajouté à la collection par ${x.added.by}${x.added.at ? ` le ${new Date(x.added.at + "Z").toLocaleDateString("fr-FR")}` : ""}`}
                          style={{ ...glass, left:6, bottom:6, maxWidth:"calc(100% - 12px)", overflow:"hidden", textOverflow:"ellipsis" }}>＋ {x.added.by}</span>}
                      </a>
                      {/* ranger dans mes collections : le signet, sur la vignette */}
                      {(status?.connected || friend) && (
                        <AdminOnly home mw>
                          <button onClick={() => setPickFor(x)} data-tip="Ranger dans mes collections" aria-label="Ranger dans mes collections"
                            style={{ position:"absolute", top:6, right:6, width:30, height:30, borderRadius:"50%", border:"1px solid rgba(255,255,255,.25)",
                              background:"rgba(15,23,42,0.55)", backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)", color:"#2DD4BF",
                              cursor:"pointer", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>🔖</button>
                        </AdminOnly>
                      )}
                    </div>
                    <div style={{ padding:"8px 9px 9px", display:"flex", flexDirection:"column", gap:4, flex:1 }}>
                      <a href={x.url} onClick={e => { e.preventDefault(); setModel(x); }} onPointerDown={() => prefetchModel(x.design_id)}
                        style={{ fontSize:12.5, fontWeight:800, color:"var(--text)", textDecoration:"none", lineHeight:1.3,
                          overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                        {x.title_fr || x.title || `Modèle ${x.design_id}`}
                      </a>
                      {x.creator_name && <span style={{ fontSize:11, fontWeight:600, color:"var(--muted)" }}>par {x.creator_uid
                        ? <button onClick={() => openCreator({ uid: x.creator_uid, name: x.creator_name })} data-tip="Tous ses modèles"
                            style={{ background:"none", border:"none", padding:0, cursor:"pointer", color:"#06B6D4",
                              fontWeight:800, fontSize:"inherit" }}>{x.creator_name}</button>
                        : x.creator_name}
                        {x.published && ago(x.published) ? ` · ${ago(x.published)}` : ""}</span>}
                      <div style={{ marginTop:"auto", display:"flex", flexDirection:"column", alignItems:"flex-start", gap:4 }}>
                        {x.printed > 0 ? (
                          <button onClick={() => onSearch?.(x)} data-tip="Voir ces prints dans l'historique"
                            style={{ fontSize:11, fontWeight:800, color:"#16a34a", background:"rgba(34,197,94,0.14)",
                              border:"1px solid rgba(34,197,94,0.3)", borderRadius:20, padding:"2px 9px", cursor:"pointer", textAlign:"left" }}>
                            {printedLabel(x)}
                          </button>
                        ) : x.in_progress > 0 ? (
                          <span style={{ fontSize:11, fontWeight:800, color:"#f59e0b", padding:"2px 9px", borderRadius:20, background:"rgba(245,158,11,0.14)" }}>⏳ en cours d'impression</span>
                        ) : (
                          <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)", padding:"2px 9px", borderRadius:20, border:"1px dashed var(--border)" }}>jamais imprimé</span>
                        )}
                        {mineOf && <MineBadge m={mineOf(x.design_id)}/>}
                      </div>
                    </div>
                  </Pressable>
                ))}
              </div>
              {hasMore && (
                <div ref={sentinel} style={{ display:"flex", justifyContent:"center", padding:"14px 0" }}>
                  {more ? <span className="mw-spin"/> : (
                    <button onClick={loadMore} style={{ padding:"9px 18px", borderRadius:20, fontSize:12.5, fontWeight:800,
                      cursor:"pointer", background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}>
                      Plus de modèles{data.total ? ` (${data.items.length} / ${data.total})` : ""}</button>
                  )}
                </div>
              )}
            </>)}
        </div>
        <HiddenMark egg="small_world" e="🌍" side="right"/>
        <Cachettes spot="makerworld"/>
      </div>
  );
}

// Choix des createurs suivis : recherche dynamique (nom ou pseudo qui
// contient le texte, sans tenir compte des accents), cases a cocher.
const norm = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function CreatorPicker({ creators, picked, onClose, onApply, applyLabel }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(new Set(picked));
  const n = norm(q.trim());
  const shown = creators.filter(c => !n || norm(c.name).includes(n) || norm(c.handle).includes(n));
  const toggle = uid => setSel(s => { const x = new Set(s); x.has(uid) ? x.delete(uid) : x.add(uid); return x; });
  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4000, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"22px 22px 0 0", overflow:"hidden",
        width:"100%", maxWidth:520, height:"80dvh", display:"flex", flexDirection:"column",
        paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        <div style={{ padding:"16px 16px 12px", borderBottom:"1px solid var(--border)", background:"linear-gradient(135deg, rgba(139,92,246,0.22), transparent 70%)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
            <span style={{ width:38, height:38, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
              background:"linear-gradient(135deg, #8B5CF6, #A855F7)", color:"#fff" }}>👤</span>
            <h3 style={{ flex:1, fontSize:16, fontWeight:900, color:"var(--text)", margin:0 }}>
              Créateurs suivis <span style={{ color:"var(--muted)", fontWeight:700 }}>({creators.length})</span></h3>
            <button onClick={onClose} aria-label="Fermer" style={round}>✕</button>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Chercher un créateur…" autoFocus
            autoComplete="off" style={{ width:"100%", boxSizing:"border-box", height:40, padding:"0 14px", borderRadius:20, fontSize:13,
              background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"8px 10px", display:"flex", flexDirection:"column", gap:5 }}>
          {shown.length === 0 && <p style={msg}>Aucun créateur ne correspond.</p>}
          {shown.map(c => (
            <label key={c.uid} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:14, cursor:"pointer",
              border:`1px solid ${sel.has(c.uid) ? "rgba(139,92,246,0.45)" : "var(--border)"}`,
              background: sel.has(c.uid) ? "linear-gradient(135deg, rgba(139,92,246,0.14), transparent 70%), var(--surface2)" : "var(--surface2)" }}>
              <input type="checkbox" checked={sel.has(c.uid)} onChange={() => toggle(c.uid)} style={{ width:18, height:18, accentColor:"#8B5CF6" }}/>
              {c.avatar ? <MwImg src={c.avatar} w={72}
                style={{ width:36, height:36, borderRadius:"50%", flexShrink:0 }}/>
                : <span style={{ width:36, height:36, borderRadius:"50%", background:"var(--surface)", flexShrink:0 }}/>}
              <span style={{ minWidth:0, flex:1 }}>
                <span style={{ display:"block", fontSize:13.5, fontWeight:800, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis",
                  whiteSpace:"nowrap" }}>{c.name || c.handle}</span>
                {c.handle && <span style={{ fontSize:11, color:"var(--muted)" }}>@{c.handle}</span>}
                <button onClick={e => { e.preventDefault(); e.stopPropagation(); openCreator({ uid: c.uid, name: c.name }); }}
                  style={{ display:"block", background:"none", border:"none", padding:0, marginTop:1, cursor:"pointer",
                    fontSize:11.5, fontWeight:800, color:"#8B5CF6" }}>Voir ses modèles ›</button>
              </span>
            </label>
          ))}
        </div>
        <div style={{ display:"flex", gap:8, padding:"10px 16px", borderTop:"1px solid var(--border)" }}>
          <button onClick={() => setSel(new Set())}
            style={{ flex:1, padding:11, borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer",
              background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}>Tous</button>
          <button onClick={() => onApply([...sel])}
            style={{ flex:2, padding:11, borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer",
              background:"linear-gradient(135deg, #8B5CF6, #A855F7)", border:"none", color:"white" }}>
            {applyLabel ? applyLabel(sel.size) : sel.size ? `Voir ${sel.size} créateur${sel.size > 1 ? "s" : ""}` : "Voir tous les créateurs"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Couverture d'une collection : jusqu'a 4 modeles en mosaique.
function Mosaic({ covers = [] }) {
  const c = covers.slice(0, 4);
  if (!c.length) return <div style={{ width:"100%", aspectRatio:"1", background:"var(--surface)" }}/>;
  return (
    // Carre fixe quoi qu'il arrive : sans minHeight/minWidth a 0, une image
    // haute etirait sa rangee et la tuile depassait ses voisines.
    <div style={{ width:"100%", aspectRatio:"1", display:"grid", gap:1, background:"var(--border)", overflow:"hidden",
      gridTemplateColumns: c.length > 1 ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)",
      gridTemplateRows: c.length > 2 ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)" }}>
      {c.map((u, i) => (
        <MwImg key={i} src={u} w={c.length > 1 ? 110 : 220}
          style={{ width:"100%", height:"100%", minWidth:0, minHeight:0, objectFit:"cover", display:"block",
            background:"var(--surface)", gridRow: c.length === 3 && i === 0 ? "span 2" : undefined }}/>
      ))}
    </div>
  );
}

// « 3 plateaux · 5 impressions » plutot qu'un « 5 fois » ambigu.
function printedLabel(x) {
  const n = x.printed, p = x.plates_printed || 1;
  const det = p > 1 ? `${p} plateaux · ${n} impression${n > 1 ? "s" : ""}` : n > 1 ? `${n} impressions` : null;
  return det ? `✓ Imprimé · ${det}` : "✓ Imprimé";
}
const printedCard = { border:"1.5px solid rgba(34,197,94,0.65)", boxShadow:"0 10px 24px -14px #22c55e",
  background:"linear-gradient(160deg, rgba(34,197,94,0.12), transparent 45%), var(--surface2)" };
const ribbon = (a, b) => ({ position:"absolute", top:6, left:6, fontSize:10, fontWeight:900, letterSpacing:0.4,
  padding:"3px 9px", borderRadius:20, background:`linear-gradient(135deg, ${a}, ${b})`, color:"white", boxShadow:`0 4px 12px -4px ${a}` });
// pastille de verre posee sur une image
const glass = { position:"absolute", display:"inline-flex", alignItems:"center", gap:3, padding:"2px 8px", borderRadius:20, fontSize:10.5, fontWeight:800,
  color:"#fff", whiteSpace:"nowrap", background:"rgba(15,23,42,0.6)", backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)" };

// Squelette de grille pendant le premier chargement (pas de page vide).
function Skeleton() {
  return (
    <div style={grid}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} style={{ ...card, border:"1px solid var(--border)" }}>
          <div className="mw-skel" style={{ width:"100%", aspectRatio:"1" }}/>
          <div style={{ padding:"8px" }}>
            <div className="mw-skel" style={{ height:11, width:"85%", borderRadius:6 }}/>
            <div className="mw-skel" style={{ height:9, width:"55%", borderRadius:6, marginTop:7 }}/>
          </div>
        </div>
      ))}
    </div>
  );
}

const round = { width:36, height:36, borderRadius:12, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text2)",
  cursor:"pointer", fontSize:15, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0 };
const pill = (on, c = "#3B82F6") => ({ padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap",
  color: on ? "#fff" : "var(--text2)", border: on ? "1px solid transparent" : "1px solid var(--border)",
  background: on ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #ffffff))` : "var(--surface2)", boxShadow: on ? `0 6px 14px -8px ${c}` : "none" });
const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
const grid = { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 };
const card = { borderRadius:18, border:"1px solid var(--border)", background:"var(--surface2)",
  overflow:"hidden", display:"flex", flexDirection:"column" };
// Une longue grille (centaines de tuiles) : le navigateur saute celles qui
// sont loin de l'ecran.
const tileCard = { ...card, contentVisibility:"auto", containIntrinsicSize:"auto 260px" };
