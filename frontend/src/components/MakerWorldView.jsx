import React, { useEffect, useRef, useState } from "react";
import HiddenMark from "./HiddenMark";
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
    title: c.title, subtitle: c.count != null ? `${c.count} modèle${c.count > 1 ? "s" : ""}` : null,
    items: [
      { icon: "📂", label: "Ouvrir", onClick: () => openColl(c) },
      canMw && status?.connected && "-",
      canMw && status?.connected && { icon: "✎", label: "Renommer", onClick: () => setNameEdit({ mode: "rename", value: c.title, id: c.id }) },
      canMw && status?.connected && { icon: "🗑", label: "Supprimer…", hint: "Sur MakerWorld ; les modèles restent", danger: true, onClick: () => delColl(c) },
    ],
  });
  const modelMenu = x => ({
    title: x.title_fr || x.title || `Modèle ${x.design_id}`, subtitle: x.creator_name ? `par ${x.creator_name}` : null,
    items: [
      { icon: "📄", label: "Ouvrir la fiche", onClick: () => setModel(x) },
      x.url && { icon: "🌐", label: "Voir sur MakerWorld", onClick: () => window.open(x.url, "_blank", "noopener") },
      x.printed > 0 && onSearch && { icon: "🖨️", label: "Voir mes impressions", hint: printedLabel(x), onClick: () => onSearch(x) },
      "-",
      (status?.connected || friend) && isHomeAdmin && { icon: "☆", label: "Ranger dans mes collections…", onClick: () => setPickFor(x) },
      isAdmin && !friend && { icon: "🔗", label: "Associer à un print", hint: "Choisir les impressions de ce modèle",
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

  return (
      <div style={{ display:"flex", flexDirection:"column" }}>
        {/* Collection ouverte : sa ligne (‹ titre) reste en haut au defilement. */}
        <div style={{ display:"flex", alignItems:"center", gap:8,
          ...(coll && tab === "favorites" ? { position:"sticky", top:0, zIndex:20,
            background:"var(--bg)", margin:"0 -4px", padding:"8px 4px", borderBottom:"1px solid var(--border)" } : null) }}>
          {coll && tab === "favorites" && (
            <button onClick={closeColl} title="Toutes les collections"
              style={{ background:"none", border:"none", color:"var(--text)", fontSize:18, cursor:"pointer", padding:"0 4px 0 0" }}>‹</button>
          )}
          {coll && tab === "favorites" && (
            <h3 style={{ flex:1, minWidth:0, fontSize:15, fontWeight:800, color:"var(--text)", margin:0,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{coll.title}</h3>
          )}
          {coll && tab === "favorites" && status?.connected && (
            <AdminOnly mw>
              <button onClick={() => setNameEdit({ mode: "rename", value: coll.title })} title="Renommer"
                style={iconBtn}>✎</button>
              <button onClick={() => delColl()} title="Supprimer la collection" style={{ ...iconBtn, color:"#ef4444" }}>🗑</button>
            </AdminOnly>
          )}
        </div>
        <div style={{ padding:"2px 0 8px" }}>
          {status && (
            <>
            {/* Onglets sur une seule ligne, meme sur telephone ; les actions passent dessous. */}
            <div style={{ display:"flex", gap:4, marginTop:10 }}>
              {TABS.filter(([k]) => k !== "creator" || status.connected).map(([k, l]) => (
                <button key={k} onClick={() => { setTab(k); if (k !== "favorites") setColl(null); }}
                  style={{ flex:"1 1 auto", minWidth:0, padding:"5px 6px", borderRadius:20, fontSize:12, fontWeight:700,
                    cursor:"pointer", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                    background: tab === k ? "#3b82f6" : "var(--surface2)", color: tab === k ? "white" : "var(--muted)",
                    border: tab === k ? "1px solid #3b82f6" : "1px solid var(--border)" }}>{l}</button>
              ))}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:8, flexWrap:"wrap" }}>
              {(view === "search" ? !!sq : view === "discover" ? !!dk : status.connected) && (
                <button onClick={() => { freshRef.current = true; setBusy(true); setReload(n => n + 1); }} disabled={busy}
                  title="Interroger MakerWorld maintenant"
                  style={{ ...iconBtn, padding:"4px 9px", display:"inline-flex", alignItems:"center" }}>
                  {busy ? <span className="mw-spin" style={{ width:13, height:13 }}/> : "⟳"}
                </button>
              )}
              {tab === "favorites" && !coll && status.connected && !nameEdit && (
                <AdminOnly mw>
                  <button onClick={() => setNameEdit({ mode: "new", value: "" })} title="Nouvelle collection"
                    style={{ ...iconBtn, padding:"4px 10px", fontWeight:800 }}>＋</button>
                </AdminOnly>
              )}
              {showModels && !(view === "discover" && dk === "__contests") && (
                <select value={pf} onChange={e => setPf(e.target.value)}
                  style={{ marginLeft:"auto", fontSize:12, padding:"4px 8px", borderRadius:8, background:"var(--surface2)",
                    border:"1px solid var(--border)", color:"var(--text2)" }}>
                  {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}{data?.items ? ` (${count[k]})` : ""}</option>)}
                </select>
              )}
            </div>
            </>
          )}
          {nameEdit && (
            <div style={{ display:"flex", gap:6, marginTop:10 }}>
              <input value={nameEdit.value} onChange={e => setNameEdit(n => ({ ...n, value: e.target.value }))} autoFocus
                maxLength={60} autoComplete="off" placeholder={nameEdit.mode === "new" ? "Nom de la nouvelle collection" : "Nouveau nom"}
                onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setNameEdit(null); }}
                style={{ flex:1, minWidth:0, padding:"8px 10px", borderRadius:10, fontSize:13, background:"var(--surface2)",
                  border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
              <button onClick={() => setNameEdit(null)} style={iconBtn}>✕</button>
              <button onClick={saveName} disabled={!nameEdit.value.trim()}
                style={{ padding:"8px 14px", borderRadius:10, fontSize:12, fontWeight:700, border:"none",
                  background:"#3b82f6", color:"white", cursor:"pointer" }}>{nameEdit.mode === "new" ? "Créer" : "Renommer"}</button>
            </div>
          )}
          {tab === "following" && creators && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, flexWrap:"wrap" }}>
              <button onClick={() => setPicker(true)}
                style={{ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
                  background: picked.length ? "rgba(59,130,246,0.15)" : "var(--surface2)",
                  color: picked.length ? "#3b82f6" : "var(--text2)",
                  border: picked.length ? "1px solid #3b82f6" : "1px solid var(--border)" }}>
                👤 {picked.length ? `${picked.length} créateur${picked.length > 1 ? "s" : ""}` : `Tous les créateurs (${creators.length})`}
              </button>
              {picked.length > 0 && (
                <button onClick={() => setPicked([])} title="Tous les créateurs"
                  style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:13 }}>✕</button>
              )}
              {progress && progress.done < progress.total && (
                <span style={{ fontSize:11.5, color:"#3b82f6" }}>Chargement {progress.done} / {progress.total} créateurs…</span>
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
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher sur MakerWorld…"
                autoComplete="off" enterKeyHint="search"
                style={{ flex:1, minWidth:0, padding:"8px 10px", borderRadius:10, fontSize:13,
                  background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
              {sq && (
                <button type="button" onClick={() => { setQ(""); setSq(""); }} aria-label="Revenir au fil"
                  style={{ padding:"8px 10px", borderRadius:10, fontSize:12, border:"1px solid var(--border)",
                    background:"none", color:"var(--muted)", cursor:"pointer" }}>✕</button>
              )}
              <button type="submit" disabled={!q.trim()}
                style={{ padding:"8px 14px", borderRadius:10, fontSize:12, fontWeight:700, border:"none",
                  background:"#3b82f6", color:"white", cursor:"pointer" }}>Chercher</button>
            </form>
          )}
          {tab === "discover" && navs && (() => {
            // Pas de rangee qui defile de cote : la coquille Android y arme le
            // tirer-pour-rafraichir et le geste saccade. Les fils principaux
            // restent en ligne, les categories se deplient en grille.
            const main = navs.filter(n => !n.category);
            const cats = navs.filter(n => n.category);
            const curCat = cats.find(n => n.key === dk);
            const pill = (on) => ({ padding:"4px 11px", borderRadius:20, fontSize:11.5, fontWeight:600, cursor:"pointer",
              whiteSpace:"nowrap", background: on ? "rgba(59,130,246,0.15)" : "var(--surface2)",
              color: on ? "#3b82f6" : "var(--text2)", border: on ? "1px solid #3b82f6" : "1px solid var(--border)" });
            return (<>
              <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
                {main.map(n => (
                  <button key={n.key} onClick={() => { setDk(n.key); setCatsOpen(false); setSq(""); setQ(""); }} style={pill(!sq && dk === n.key)}>
                    {n.key === "Foryou" ? "✨ " : n.key === "Trending" ? "🔥 " : ""}{n.name}
                  </button>
                ))}
                <button onClick={() => { setDk("__contests"); setCatsOpen(false); setSq(""); setQ(""); }}
                  style={pill(!sq && dk === "__contests")}>🏆 Concours</button>
                {cats.length > 0 && (
                  <button onClick={() => setCatsOpen(v => !v)} style={pill(!!curCat)}>
                    📂 {curCat ? curCat.name : "Catégories"} {catsOpen ? "▴" : "▾"}
                  </button>
                )}
              </div>
              {catsOpen && (
                <div style={{ display:"flex", gap:6, marginTop:6, flexWrap:"wrap", padding:8, borderRadius:12,
                  background:"var(--surface)", border:"1px solid var(--border)" }}>
                  {cats.map(n => (
                    <button key={n.key} onClick={() => { setDk(n.key); setCatsOpen(false); setSq(""); setQ(""); }} style={pill(!sq && dk === n.key)}>
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
              <p style={msg}>Connecte ton compte MakerWorld dans <b>Paramètres → Comptes → MakerWorld</b> pour voir
                tes collections et tes j'aime ici.</p>
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
                      style={{ ...card, cursor:"pointer", padding:0, textAlign:"left", color:"var(--text)" }}>
                      <Mosaic covers={c.covers}/>
                      <div style={{ padding:"7px 8px 8px" }}>
                        <div style={{ fontSize:12.5, fontWeight:700 }}>{c.title}</div>
                        {c.count != null && <div style={{ fontSize:10.5, color:"var(--muted)" }}>{c.count} modèle{c.count > 1 ? "s" : ""}</div>}
                      </div>
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
                <p style={{ ...msg, padding:"0 0 8px" }}>{data.pending} modèle{data.pending > 1 ? "s" : ""} en cours de lecture…</p>
              )}
              <div style={grid}>
                {items.map(x => (
                  <Pressable key={x.design_id} menu={() => modelMenu(x)} style={{ ...tileCard, ...(x.printed > 0 ? printedCard : null) }}>
                    <a href={x.url} onClick={e => { e.preventDefault(); setModel(x); }} onPointerDown={() => prefetchModel(x.design_id)}
                      style={{ display:"block", position:"relative", cursor:"pointer", background:"var(--surface)" }}>
                      {x.cover_url
                        ? <MwImg src={x.cover_url} w={220} style={{ width:"100%", aspectRatio:"1", objectFit:"cover", display:"block" }}/>
                        : <div style={{ width:"100%", aspectRatio:"1" }}/>}
                      {x.printed > 0 && <span style={ribbon("#22c55e")}>✓ IMPRIMÉ</span>}
                      {!x.printed && x.in_progress > 0 && <span style={ribbon("#f59e0b")}>EN COURS</span>}
                      {/* qui l'a range dans cette collection, depuis BambuNymous */}
                      {x.added?.by && <span title={`Ajouté à la collection par ${x.added.by}${x.added.at ? ` le ${new Date(x.added.at + "Z").toLocaleDateString("fr-FR")}` : ""}`}
                        style={{ position:"absolute", left:6, bottom:6, maxWidth:"calc(100% - 12px)", display:"inline-flex", alignItems:"center", gap:3,
                          padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:800, color:"#fff", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                          background:"rgba(15,23,42,0.72)", backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)" }}>＋ {x.added.by}</span>}
                    </a>
                    <div style={{ padding:"7px 8px 8px", display:"flex", flexDirection:"column", gap:4, flex:1 }}>
                      <a href={x.url} onClick={e => { e.preventDefault(); setModel(x); }} onPointerDown={() => prefetchModel(x.design_id)}
                        style={{ fontSize:12, fontWeight:700, color:"var(--text)", textDecoration:"none", lineHeight:1.3,
                          overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                        {x.title_fr || x.title || `Modèle ${x.design_id}`}
                      </a>
                      {x.creator_name && <span style={{ fontSize:10.5, color:"var(--muted)" }}>par {x.creator_uid
                        ? <button onClick={() => openCreator({ uid: x.creator_uid, name: x.creator_name })} title="Tous ses modèles"
                            style={{ background:"none", border:"none", padding:0, cursor:"pointer", color:"var(--text2)",
                              fontWeight:600, fontSize:"inherit", textDecoration:"underline dotted" }}>{x.creator_name}</button>
                        : x.creator_name}
                        {x.published && ago(x.published) ? ` · ${ago(x.published)}` : ""}</span>}
                      <div style={{ marginTop:"auto" }}>
                        {x.printed > 0 ? (
                          <button onClick={() => onSearch?.(x)} title="Voir ces prints dans l'historique"
                            style={{ fontSize:11, fontWeight:700, color:"#22c55e", background:"rgba(34,197,94,0.12)",
                              border:"none", borderRadius:20, padding:"2px 8px", cursor:"pointer", textAlign:"left" }}>
                            {printedLabel(x)}
                          </button>
                        ) : x.in_progress > 0 ? (
                          <span style={{ fontSize:11, fontWeight:600, color:"#f59e0b" }}>⏳ en cours d'impression</span>
                        ) : (
                          <span style={{ fontSize:11, color:"var(--muted)" }}>jamais imprimé</span>
                        )}
                        {mineOf && <MineBadge m={mineOf(x.design_id)}/>}
                        {(status?.connected || friend) && (
                          <AdminOnly home mw>
                            <button onClick={() => setPickFor(x)} title="Ranger dans mes collections"
                              style={{ display:"block", marginTop:5, fontSize:11, fontWeight:600, color:"#3b82f6", background:"none",
                                border:"none", padding:0, cursor:"pointer" }}>☆ Collections</button>
                          </AdminOnly>
                        )}
                      </div>
                    </div>
                  </Pressable>
                ))}
              </div>
              {hasMore && (
                <div ref={sentinel} style={{ display:"flex", justifyContent:"center", padding:"14px 0" }}>
                  {more ? <span className="mw-spin"/> : (
                    <button onClick={loadMore} style={{ padding:"8px 18px", borderRadius:10, fontSize:12, fontWeight:700,
                      cursor:"pointer", background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}>
                      Plus de modèles{data.total ? ` (${data.items.length} / ${data.total})` : ""}</button>
                  )}
                </div>
              )}
            </>)}
        </div>
        <HiddenMark egg="small_world" e="🌍" side="right"/>
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
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
        width:"100%", maxWidth:520, height:"80dvh", display:"flex", flexDirection:"column",
        paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
        <div style={{ padding:"14px 16px 10px", borderBottom:"1px solid var(--border)" }}>
          <div style={{ display:"flex", alignItems:"center", marginBottom:10 }}>
            <h3 style={{ flex:1, fontSize:15, fontWeight:800, color:"var(--text)", margin:0 }}>
              Créateurs suivis <span style={{ color:"var(--muted)", fontWeight:500 }}>({creators.length})</span></h3>
            <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--muted)", fontSize:18, cursor:"pointer" }}>✕</button>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un créateur…" autoFocus
            autoComplete="off" style={{ width:"100%", boxSizing:"border-box", padding:"8px 10px", borderRadius:10, fontSize:13,
              background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"4px 8px" }}>
          {shown.length === 0 && <p style={msg}>Aucun créateur ne correspond.</p>}
          {shown.map(c => (
            <label key={c.uid} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 8px",
              borderRadius:10, cursor:"pointer", background: sel.has(c.uid) ? "rgba(59,130,246,0.08)" : "none" }}>
              <input type="checkbox" checked={sel.has(c.uid)} onChange={() => toggle(c.uid)}/>
              {c.avatar ? <MwImg src={c.avatar} w={56}
                style={{ width:28, height:28, borderRadius:"50%", flexShrink:0 }}/>
                : <span style={{ width:28, height:28, borderRadius:"50%", background:"var(--surface2)", flexShrink:0 }}/>}
              <span style={{ minWidth:0, flex:1 }}>
                <span style={{ display:"block", fontSize:13, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis",
                  whiteSpace:"nowrap" }}>{c.name || c.handle}</span>
                {c.handle && <span style={{ fontSize:11, color:"var(--muted)" }}>@{c.handle}</span>}
                <button onClick={e => { e.preventDefault(); e.stopPropagation(); openCreator({ uid: c.uid, name: c.name }); }}
                  style={{ display:"block", background:"none", border:"none", padding:0, marginTop:1, cursor:"pointer",
                    fontSize:11, fontWeight:600, color:"#3b82f6" }}>Voir ses modèles ›</button>
              </span>
            </label>
          ))}
        </div>
        <div style={{ display:"flex", gap:8, padding:"10px 16px", borderTop:"1px solid var(--border)" }}>
          <button onClick={() => setSel(new Set())}
            style={{ flex:1, padding:9, borderRadius:10, fontSize:12.5, fontWeight:600, cursor:"pointer",
              background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}>Tous</button>
          <button onClick={() => onApply([...sel])}
            style={{ flex:2, padding:9, borderRadius:10, fontSize:12.5, fontWeight:700, cursor:"pointer",
              background:"#3b82f6", border:"none", color:"white" }}>
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
const printedCard = { border:"2px solid #22c55e", boxShadow:"0 0 0 3px rgba(34,197,94,0.12)" };
const ribbon = c => ({ position:"absolute", top:6, left:6, fontSize:10, fontWeight:800, letterSpacing:0.4,
  padding:"3px 8px", borderRadius:20, background:c, color:"white", boxShadow:"0 1px 4px rgba(0,0,0,0.35)" });

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

const iconBtn = { padding:"5px 9px", borderRadius:9, fontSize:13, cursor:"pointer", background:"var(--surface2)",
  border:"1px solid var(--border)", color:"var(--text)" };
const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
const grid = { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 };
const card = { borderRadius:12, border:"1px solid var(--border)", background:"var(--surface2)",
  overflow:"hidden", display:"flex", flexDirection:"column" };
// Une longue grille (centaines de tuiles) : le navigateur saute celles qui
// sont loin de l'ecran.
const tileCard = { ...card, contentVisibility:"auto", containIntrinsicSize:"auto 260px" };
