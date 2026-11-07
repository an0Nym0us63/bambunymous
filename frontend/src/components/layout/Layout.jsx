import React, { useEffect } from "react";
import { FriendChip } from "../Friends";
import { useFriend } from "../../store/friend";
import { createPortal } from "react-dom";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen, MoreHorizontal } from "lucide-react";
import { useNavMenu, isActiveItem, MOBILE_SLOTS } from "../../utils/navMenu";

import UserMenu from "../UserMenu";
import NotifBell from "../NotifBell";
import GlobalSearch from "../GlobalSearch";
import ShareProgress from "../ShareProgress";
import RfidScanBridge from "../RfidScanBridge";
import PushBridge from "../PushBridge";
import { FriendLinkBridge } from "../Friends";
import Toast from "../Toast";
import { egg, installEggs, pageChanged, tapper } from "../../eggs";
import NoAutofill from "../NoAutofill";
import { PrankHost } from "../../hidden/prankHost";
import MwAssignPicker from "../MwAssignPicker";
import CardFx from "../CardFx";
import GradeFx from "../GradeFx";
import AchNews from "../AchNews";
import { Hide } from "../Cachettes";
import { MwLinkHost } from "../MwCreatorPage";
import { useIsAdmin } from "../../store/auth";
import { useUpdates, updatesTip } from "../../utils/updates";
import ErrorBoundary from "../ErrorBoundary";

// le menu : propre a chaque compte (05/11/2026, utils/navMenu.js) ; chaque page a sa couleur (celle de ses onglets)
// Titre affiche dans le header mobile : evite de redonder le <h1> de chaque page.
const TITLES = {
  "/":          null,            // l'accueil n'a pas de titre propre
  "/prints":    "Impressions",
  "/filaments": "Filaments",
  "/objects":   "Objets & Accessoires",
  "/stats":     "Statistiques",
  "/settings":  "Paramètres",
  "/logs":      "Journal",
  "/notifications": "Notifications",
};

// TEMPORAIRE (07/11/2026) : la page blanche apres une capture d'ecran, sur Android. Elle ne se produit pas hors du cadre
// de l'appli : on coupe ce cadre morceau par morceau, par l'adresse (?bnbisect=header,nav ; ?bnbisect= pour tout
// remettre). Garde dans ce navigateur jusqu'a ce qu'on le remette. A retirer une fois le coupable trouve.
const BISECT = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get("bnbisect");
    if (q !== null) { if (q) localStorage.setItem("bn_bisect", q); else localStorage.removeItem("bn_bisect"); }
    return new Set((localStorage.getItem("bn_bisect") || "").split(",").map(s => s.trim()).filter(Boolean));
  } catch { return new Set(); }
})();
const cut = k => BISECT.has(k);

const S = {
  // height:100% plutot que 100dvh : la chaine html > body > #root porte le
  // correctif de hauteur iOS (voir index.css). Avec 100dvh, ce conteneur
  // recalculait sa propre hauteur trop courte et annulait le correctif.
  app:     { display:"flex", height:"100%", overflow:"hidden", background:"var(--bg)" },
  aside:   { display:"flex", flexDirection:"column", width:212, background:"var(--sidebar)", borderRight:"1px solid var(--border)", padding:"18px 0 14px", flexShrink:0,
    transition:"width .2s ease", overflow:"hidden" },
  logo:    { display:"flex", alignItems:"center", gap:10, padding:"0 16px", marginBottom:24 },
  logoBox: { width:28, height:28, borderRadius:8, overflow:"hidden" },
  nav:     { flex:1, padding:"0 10px", display:"flex", flexDirection:"column", gap:4 },
  main:    { flex:1, display:"flex", flexDirection:"column", overflow:"hidden" },
  page:    { flex:1, overflowY:"auto", padding:16, paddingTop:"calc(16px + var(--sat, env(safe-area-inset-top, 0px)))", background:"var(--bg)" },
  // Mobile
  // Le header est colle en haut de l'ecran. En PWA installee edge-to-edge et en
  // WebView, la barre d'etat (heure, wifi) passe PAR-DESSUS s'il ne reserve pas la
  // safe-area : le titre se retrouvait sous l'heure. Dans un navigateur classique,
  // env(safe-area-inset-top) vaut 0, donc rien ne change la-bas.
  header:  { display:"flex", alignItems:"center", gap:8,
    // Safe-area du haut reservee a 85% : le logo (gauche) et l'avatar (droite)
    // peuvent remonter un peu -- ils sont sur les cotes, l'heure/batterie et l'ile
    // (centree) restent degagees -- ce qui compacte le header sans le coller au statut.
    padding:"4px 16px", paddingTop:"calc(4px + var(--sat, env(safe-area-inset-top, 0px)) * 0.85)",
    // Verre depoli : fond translucide + flou de ce qui scrolle derriere. Fixed
    // en haut pour que le contenu passe DESSOUS (sinon rien a flouter). La
    // compensation d'espace est faite en CSS (.page-content padding-top).
    position:"fixed", top:0, left:0, right:0, zIndex:50,
    background:"var(--glass)",
    backdropFilter:"blur(12px) saturate(140%)",
    WebkitBackdropFilter:"blur(12px) saturate(140%)",
    borderBottom:"1px solid var(--border)" },
  bottomNav: { display:"flex",
    background:"var(--glass)",
    backdropFilter:"blur(12px) saturate(140%)",
    WebkitBackdropFilter:"blur(12px) saturate(140%)",
    borderTop:"1px solid var(--border)",
    position:"fixed", left:0, right:0, bottom:0, zIndex:50,
    paddingBottom:"calc(env(safe-area-inset-bottom, 0px) * 0.5)",
    // les coins arrondis de l'ecran rognaient le premier et le dernier nom (05/11/2026 : le « d » de MakerWorld)
    paddingLeft:"max(10px, env(safe-area-inset-left, 0px))", paddingRight:"max(10px, env(safe-area-inset-right, 0px))" },
};

// Une entree du menu : l'icone dans une pastille de la couleur de la page ; la page ouverte, en degrade.
// Repliee : l'icone seule, le nom en infobulle.
// une mise a jour en attente : une petite pastille ambre au coin de l'icone de Parametres
const UpdDot = ({ tip, size = 10, style }) => <span data-tip={tip} aria-label={tip} style={{ position:"absolute", top:-3, right:-3, width:size, height:size,
  borderRadius:"50%", background:"linear-gradient(135deg, #F59E0B, #F97316)", boxShadow:"0 0 0 2px var(--sidebar, var(--surface))", ...style }}/>;
function NavItem({ to, icon: Icon, label, c, mini, upd, isActive }) {
  return (
    <Link to={to} className="bn-nav" aria-current={isActive ? "page" : undefined} data-tip={mini ? (upd ? `${label} · ${upd}` : label) : (upd || undefined)} aria-label={label}
      style={{
        "--c": c, display:"flex", alignItems:"center", gap:11, padding: mini ? "7px" : "7px 10px 7px 7px",
        justifyContent: mini ? "center" : "flex-start", borderRadius:14, fontSize:14, textDecoration:"none", transition:"background .15s, box-shadow .15s",
        background: isActive ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 65%, #ffffff))` : "transparent",
        boxShadow: isActive ? `0 8px 18px -10px ${c}` : "none",
        color: isActive ? "#fff" : "var(--text2)", fontWeight: isActive ? 800 : 600, whiteSpace:"nowrap",
      }}>
        <span style={{ width:32, height:32, borderRadius:10, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", position:"relative",
          background: isActive ? "rgba(255,255,255,0.22)" : `color-mix(in srgb, ${c} 16%, transparent)`, color: isActive ? "#fff" : c }}>
          <Icon size={17}/>{upd && <UpdDot/>}</span>
        {!mini && <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{label}</span>}
    </Link>
  );
}

// un bouton de la barre du bas : l'icone dans une pastille de la couleur de la page ouverte, son nom dessous
function BottomItem({ to, onClick, icon: Icon, label, c, isActive, dot, fitTo }) {
  // un nom qui ne tient pas (« MakerWorld ») retrecit un peu au lieu d'etre coupe (05/11/2026) ; tous a la meme taille,
  // celle du plus long (fitTo) : des noms de tailles differentes donnaient une barre qui semblait de travers (06/11/2026)
  const txt = React.useRef(null);
  const [fs, setFs] = React.useState(null);
  React.useLayoutEffect(() => {
    const el = txt.current;
    if (!el) return undefined;
    // la largeur exacte du nom a 10,5 px (au demi-pixel pres : arrondie, elle laissait « MakerWorld » coupe), comparee a la
    // place de l'entree moins 2 px
    const fit = () => {
      const cs = getComputedStyle(el), ctx = (fit.c = fit.c || document.createElement("canvas").getContext("2d"));
      ctx.font = `800 10.5px ${cs.fontFamily}`;              // en gras : la page ouverte l'est
      const natural = Math.max(...(fitTo || [label]).map(x => ctx.measureText(x).width)), avail = (el.parentElement?.getBoundingClientRect().width || 0) - 2;
      setFs(avail > 0 && natural > avail ? Math.max(8, Math.floor((10.5 * avail / natural) * 10) / 10) : null);
    };
    fit();
    document.fonts?.ready?.then(fit);              // la police chargee change la largeur
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el.parentElement);
    return () => ro?.disconnect();
  }, [label, fitTo?.join("|")]);
  const inner = <>
    <span style={{ width:48, height:30, borderRadius:15, display:"flex", alignItems:"center", justifyContent:"center",
      transition:"background .2s, box-shadow .2s",
      background: isActive ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 65%, #ffffff))` : "transparent",
      boxShadow: isActive ? `0 6px 14px -6px ${c}` : "none", color: isActive ? "#fff" : "inherit", position:"relative" }}>
      <Icon size={19}/>{dot}</span>
    <span ref={txt} style={{ maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", ...(fs ? { fontSize: fs } : {}) }}>{label}</span>
  </>;
  const st = { flex:1, minWidth:0, display:"flex", flexDirection:"column", alignItems:"center", padding:"8px 0 2px", gap:3, fontSize:10.5,
    textDecoration:"none", fontWeight: isActive ? 800 : 600, color: isActive ? c : "var(--muted)", transition:"color 0.15s",
    background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
    // un bouton (« Plus ») centre son contenu en hauteur et garde sa propre hauteur de ligne : calé comme les liens
    // (05/11/2026 : il était un peu plus haut que les autres)
    justifyContent:"flex-start", alignSelf:"stretch", lineHeight:"inherit", margin:0, boxSizing:"border-box" };
  return to ? <Link to={to} aria-current={isActive ? "page" : undefined} style={st}>{inner}</Link>
    : <button type="button" onClick={onClick} aria-label={label} style={st}>{inner}</button>;
}

// « Plus » (telephone) : les pages du menu qui ne tiennent pas dans la barre du bas, et celles rangees la
function MoreSheet({ items, loc, visible, upd, onClose }) {
  return createPortal(<>
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:2999, background:"rgba(0,0,0,0.35)" }}/>
    <div role="dialog" aria-label="Plus de pages" style={{ position:"fixed", left:8, right:8, zIndex:3000,
      bottom:"calc(70px + env(safe-area-inset-bottom, 0px))", borderRadius:20, padding:12, background:"var(--sheet-bg)",
      border:"1px solid var(--border)", boxShadow:"0 14px 40px rgba(0,0,0,0.4)",
      display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(96px, 1fr))", gap:8 }}>
      {items.map(it => { const on = isActiveItem(it, loc, visible); const Icon = it.icon;
        return <Link key={it.k} to={it.to} onClick={onClose} aria-current={on ? "page" : undefined}
          style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"10px 4px", borderRadius:14, textDecoration:"none",
            background: on ? `color-mix(in srgb, ${it.c} 14%, transparent)` : "var(--surface2)", border:"1px solid var(--border)",
            color: on ? it.c : "var(--text2)", fontSize:12, fontWeight:800 }}>
          <span style={{ width:38, height:38, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", position:"relative",
            background:`color-mix(in srgb, ${it.c} 16%, transparent)`, color:it.c }}><Icon size={19}/>
            {it.k === "settings" && upd.any && <UpdDot tip={updatesTip(upd)}/>}</span>
          <span style={{ textAlign:"center", lineHeight:1.15 }}>{it.short || it.label}</span>
        </Link>; })}
    </div>
  </>, document.body);
}

// La barre laterale repliee ou non (retenu sur ce navigateur) ; sur un ecran etroit, repliee par defaut.
function useSideMini() {
  const [mini, setMini] = React.useState(() => {
    try { const v = localStorage.getItem("bn-side-mini"); if (v != null) return v === "1"; } catch { /* indisponible */ }
    return typeof window !== "undefined" && window.innerWidth < 1100;
  });
  const flip = () => setMini(m => { try { localStorage.setItem("bn-side-mini", m ? "0" : "1"); } catch { /* indisponible */ } return !m; });
  return [mini, flip];
}

export default function Layout() {
  const navigate = useNavigate();
  const loc = useLocation();
  const { pathname } = loc;
  const isAdmin = useIsAdmin();
  const menu = useNavMenu(isAdmin);
  const bar = menu.filter(i => i.place === "bar"), more = menu.filter(i => i.place === "more");
  const visible = menu.filter(i => i.place !== "hidden");
  // la barre du bas : 6 places ; s'il en faut plus (ou des pages rangees dans « Plus »), 5 et le bouton « Plus »
  const needMore = more.length > 0 || bar.length > MOBILE_SLOTS;
  const bottom = needMore ? bar.slice(0, MOBILE_SLOTS - 1) : bar;
  const moreList = needMore ? [...bar.slice(MOBILE_SLOTS - 1), ...more] : [];
  // les noms de la barre du bas : tous prennent la taille qui fait tenir le plus large
  const longest = [...bottom.map(it => it.short || it.label), ...(needMore ? ["Plus"] : [])];
  const [moreOpen, setMoreOpen] = React.useState(false);
  // un onglet sorti au menu, ouvert : son nom en titre (« MakerWorld » plutot qu'« Impressions »)
  const openTab = visible.find(i => i.to.includes("?tab=") && isActiveItem(i, loc, visible));
  React.useEffect(() => { setMoreOpen(false); }, [pathname, loc.search]);
  const title0 = TITLES[pathname] ?? null;
  const title = openTab && openTab.place !== openTab.def ? openTab.label : title0;
  const friend = useFriend((st) => st.friend);   // chez un copain
  const visitHome = useFriend((st) => st.visit);
  const [mini, flipMini] = useSideMini();
  // une mise a jour de BambuNymous (pour l'admin) ou de l'appli Android : une pastille sur Parametres
  const upd = useUpdates(isAdmin);
  const headerRef = React.useRef(null);
  // gestes caches (voir eggs.js) ; le logo, lui, a le tournis facile
  React.useEffect(() => { if (!cut("eggs")) installEggs(); }, []);
  // three.js (la vue 3D d'un modele) n'est plus charge avec l'appli (06/11/2026) : il se telecharge en fond, quelques
  // secondes apres l'ouverture, quand le navigateur n'a rien d'autre a faire ; la premiere vue 3D n'a pas a l'attendre
  React.useEffect(() => {
    const go = () => { import("three").catch(() => {}); };
    const t = setTimeout(() => (window.requestIdleCallback ? window.requestIdleCallback(go, { timeout: 8000 }) : go()), 4000);
    return () => clearTimeout(t);
  }, []);
  React.useEffect(() => { pageChanged(); }, [pathname]);
  const [spin, setSpin] = React.useState(false);
  const logoTap = React.useMemo(() => tapper(7, 3000, () => {
    setSpin(true); setTimeout(() => setSpin(false), 1100); egg("logo_spin");
  }), []);
  const logoAnim = spin ? "bn-spin 1s ease-in-out" : "none";
  const holdRef = React.useRef(null);
  const logoHold = {
    onPointerDown: () => { clearTimeout(holdRef.current); holdRef.current = setTimeout(() => egg("hold_logo"), 3000); },
    onPointerUp: () => clearTimeout(holdRef.current),
    onPointerLeave: () => clearTimeout(holdRef.current),
    onContextMenu: e => e.preventDefault(),
  };

  // Le header mobile est fixed et sa hauteur VARIE selon la page (bouton scan sur
  // Filaments, avatar sur Accueil, rien ailleurs) + la safe-area du haut. Un
  // padding-top fixe sur le contenu laissait donc trop de vide sur les pages a
  // header court. On mesure la hauteur reelle du header et on la publie dans
  // --header-h : le contenu se cale alors pile dessous, quelle que soit la page.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const setHH = () => document.documentElement.style.setProperty("--header-h", el.offsetHeight + "px");
    setHH();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(setHH) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", setHH);
    window.addEventListener("orientationchange", setHH);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", setHH);
      window.removeEventListener("orientationchange", setHH);
    };
  }, [pathname]);

  // Dans la coquille WebView, une bande coloree (scrim natif) occupe DEJA la place
  // de la barre de statut. Le header ne doit donc pas reserver en plus la
  // safe-area du haut, sinon l'espace est double. On marque <html> pour permettre
  // au CSS ci-dessous de neutraliser cette safe-area, uniquement en WebView.
  useEffect(() => {
    if (typeof window !== "undefined" && window.BambuScan) {
      document.documentElement.classList.add("in-webview");
    }
    // navigator.standalone n'est vrai QUE sur iOS en PWA installee (icone ecran
    // d'accueil) -- propriete Safari propre a iOS, absente ailleurs. On marque
    // <html> pour ne cibler que ce shell.
    if (typeof window !== "undefined" && window.navigator.standalone === true) {
      document.documentElement.classList.add("ios-standalone");
      // Diagnostic terrain : sur ce shell, -webkit-fill-available cale la hauteur a
      // (ecran - safe-area-top) et ne se corrige jamais -- le shell fait 59px de
      // moins que l'ecran, donc la barre fixed s'ancre 59px trop haut. screen.height
      // est la seule mesure STABLE des le lancement (852 constant sur toutes les
      // captures) et vaut le plein ecran. L'app est verrouillee en portrait
      // (manifest orientation:portrait-primary), donc screen.height est toujours la
      // bonne hauteur. On la pose dans --app-height, consommee par le CSS scope.
      const setAppH = () => {
        const h = window.screen && window.screen.height;
        if (h) document.documentElement.style.setProperty("--app-height", h + "px");
      };
      setAppH();
      window.addEventListener("orientationchange", setAppH);
      window.addEventListener("resize", setAppH);
      return () => {
        window.removeEventListener("orientationchange", setAppH);
        window.removeEventListener("resize", setAppH);
      };
    }
  }, []);


  return (
    <div style={cut("scroll") ? { ...S.app, height: "auto", overflow: "visible" } : S.app}>
      {/* Sidebar desktop */}
      <aside className="hidden-mobile" style={{ ...S.aside, width: mini ? 72 : 212 }}>
        <style>{`.bn-nav:hover { background: color-mix(in srgb, var(--c) 10%, transparent); }
          .bn-nav[aria-current="page"]:hover { background: linear-gradient(135deg, var(--c), color-mix(in srgb, var(--c) 65%, #ffffff)); }`}</style>
        <div style={{ ...S.logo, padding: mini ? "0" : "0 16px", justifyContent: mini ? "center" : "flex-start", cursor:"pointer" }}
          onClick={() => { logoTap(); navigate("/"); }}>
          <img src="/icon-192.png" {...logoHold} draggable={false} style={{ width:32, height:32, borderRadius:9, flexShrink:0, animation:logoAnim,
            boxShadow:"0 6px 14px -6px #6366F1" }} alt=""/>
          {!mini && <span style={{ fontWeight:900, fontSize:15, background:"linear-gradient(90deg,#6366F1,#EC4899)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            whiteSpace:"nowrap" }}>
            BambuNymous
          </span>}
          <Hide at="header"/>
        </div>
        {/* Chez un copain : rappel discret, retour en un geste. */}
        {friend && (mini
          ? <div style={{ display:"flex", justifyContent:"center", paddingBottom:8 }}>
              <button onClick={() => visitHome(null)} data-tip={`Chez ${friend.name} · revenir chez moi`} aria-label="Revenir chez moi"
                style={{ width:40, height:40, borderRadius:12, border:"1px solid rgba(249,115,22,0.45)", background:"rgba(249,115,22,0.12)",
                  cursor:"pointer", fontSize:17 }}>👀</button></div>
          : <div style={{ padding:"0 12px 8px" }}><FriendChip block/></div>)}
        {/* Suivi d'un partage Telegram en arriere-plan (ShareProgress, par portail). */}
        <div id="sidebar-status" style={{ display:"flex", flexDirection:"column", gap:6, padding: mini ? "0 6px" : "0 12px", overflow:"hidden" }}/>
        {/* la recherche globale (04/11/2026) */}
        <div style={{ padding: mini ? "0 0 6px" : "0 12px 6px", display:"flex", justifyContent:"center" }}><GlobalSearch wide mini={mini}/></div>
        <nav style={S.nav}>
          {bar.map(n => <NavItem key={n.k} {...n} label={n.short || n.label} mini={mini} isActive={isActiveItem(n, loc, visible)}
            upd={n.k === "settings" && upd.any ? updatesTip(upd) : null}/>)}
          {/* les pages rangees dans « Plus » : sur ordinateur, a part sous le menu */}
          {more.length > 0 && <>
            {!mini && <div style={{ margin:"10px 8px 2px", fontSize:10.5, fontWeight:900, letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)" }}>Plus</div>}
            {mini && <div style={{ height:1, margin:"6px 10px", background:"var(--border)" }}/>}
            {more.map(n => <NavItem key={n.k} {...n} label={n.short || n.label} mini={mini} isActive={isActiveItem(n, loc, visible)}
              upd={n.k === "settings" && upd.any ? updatesTip(upd) : null}/>)}
          </>}
        </nav>
        {/* Replier / deplier la barre */}
        <div style={{ padding:"0 10px 8px", display:"flex", justifyContent: mini ? "center" : "flex-end" }}>
          <button onClick={flipMini} aria-label={mini ? "Déplier le menu" : "Replier le menu"} data-tip={mini ? "Déplier le menu" : "Replier le menu"}
            style={{ width:36, height:36, borderRadius:12, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--muted)",
              cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
            {mini ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}</button>
        </div>
        {/* Le compte remplace le bouton de deconnexion nu : meme place, en bas
            du menu, mais il indique aussi qui est connecte et sous quel role. */}
        <div style={{ margin:"0 10px", padding: mini ? "10px 0 0" : "10px 4px 0", borderTop:"1px solid var(--border)" }}>
          <div style={{ display:"flex", flexDirection: mini ? "column" : "row", alignItems:"center", gap: mini ? 10 : 6 }}>
            <div style={{ flex: mini ? "none" : 1, minWidth:0 }}><UserMenu placement="top" showName={!mini} size={30} notifBadge={mini}/></div>
            {/* repliee : pas de cloche, l'avatar porte le nombre de notifications (et le menu du profil y mene) */}
            {!friend && !mini && <NotifBell size={18}/>}
          </div>
        </div>
      </aside>

      <div style={cut("scroll") ? { ...S.main, overflow: "visible" } : S.main}>
        {/* Header mobile */}
        {cut("header") ? <div ref={headerRef} style={{ height: 52 }}/> :
        <header ref={headerRef} className="show-mobile app-header" style={S.header}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0, cursor:"pointer" }}
            onClick={() => { logoTap(); navigate("/"); }}>
            <img src="/icon-192.png" {...logoHold} draggable={false} style={{ width:24, height:24, borderRadius:6, flexShrink:0, animation:logoAnim }} alt=""/>
            {!title && (
              <span style={{ fontWeight:700, fontSize:13, background:"linear-gradient(90deg,#3b82f6,#06b6d4)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
                BambuNymous
              </span>
            )}
          </div>
          <Hide at="header"/>
          {title && (
            <h1 style={{ fontSize:15, fontWeight:700, color:"var(--text)", margin:0,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {title}
            </h1>
          )}
          {/* Emplacement d'actions : les pages y injectent leurs boutons par
              portail (cf. Filaments -> Scanner). Sur mobile, cela evite qu'une
              barre d'actions occupe une ligne entiere sous le header. */}
          <FriendChip/>
          <div id="header-actions" style={{ marginLeft:"auto", display:"flex",
            alignItems:"center", gap:6, flexShrink:0 }}/>
          {/* Suivi d'un partage Telegram en arriere-plan (ShareProgress y
              injecte sa puce par portail) : visible sur toutes les pages. */}
          <div id="header-status" style={{ display:"flex", alignItems:"center", flexShrink:0 }}/>
          {/* Profil sur toutes les pages, toujours le plus a droite (apres le
              point d'injection des actions de la page). */}
          <GlobalSearch/>
          {!friend && <NotifBell/>}
          <UserMenu placement="bottom"/>
        </header>}

        <main className="page-content" style={cut("scroll") ? { ...S.page, overflowY: "visible" } : S.page}>
          {BISECT.size > 0 && <div style={{ margin: "0 0 10px", padding: "6px 10px", borderRadius: 10, background: "#F59E0B", color: "#000",
            fontSize: 12, fontWeight: 800 }}>Test coupé : {[...BISECT].join(", ")}</div>}
          {/* une page chargee a la demande : la place reste tenue pendant les quelques ms */}
          {!cut("page") && <ErrorBoundary where={`page ${pathname}`} resetKey={pathname}><React.Suspense fallback={<div style={{ minHeight: "70vh" }}/>}><Outlet /></React.Suspense></ErrorBoundary>}</main>
        {!cut("hosts") && <>
        <PrankHost/>
        <CardFx/>
        <GradeFx/>
        <AchNews/>
        <MwLinkHost/>
        <MwAssignPicker/>
        <ShareProgress/>
        {!friend && <RfidScanBridge/>}
        {!friend && <PushBridge/>}
        <FriendLinkBridge/>
        <Toast/>
        <NoAutofill/>
        </>}

        {/* Bottom nav mobile */}
        {!cut("nav") && <nav className="show-mobile" style={S.bottomNav}>
          {/* la page ouverte : son icone dans une pastille de sa couleur, son nom dans cette couleur */}
          {bottom.map(it => <BottomItem key={it.k} to={it.to} icon={it.icon} label={it.short || it.label} c={it.c} isActive={isActiveItem(it, loc, visible)} fitTo={longest}
            dot={it.k === "settings" && upd.any ? <UpdDot tip={updatesTip(upd)} style={{ top:1, right:9, boxShadow:"0 0 0 2px var(--surface)" }}/> : null}/>)}
          {needMore && <BottomItem onClick={() => setMoreOpen(o => !o)} icon={MoreHorizontal} label="Plus" c="#64748B" fitTo={longest}
            isActive={moreOpen || moreList.some(it => isActiveItem(it, loc, visible))}
            dot={moreList.some(it => it.k === "settings") && upd.any ? <UpdDot tip={updatesTip(upd)} style={{ top:1, right:9, boxShadow:"0 0 0 2px var(--surface)" }}/> : null}/>}
          {moreOpen && <MoreSheet items={moreList} loc={loc} visible={visible} upd={upd} onClose={() => setMoreOpen(false)}/>}
          <span style={{ position:"absolute", top:1, left:"50%", transform:"translateX(-50%)" }}><Hide at="nav" size={9}/></span>
        </nav>}
      </div>

      <style>{`
        @media (min-width: 768px) { .hidden-mobile { display:flex!important; } .show-mobile { display:none!important; } }
        @media (max-width: 767px) {
          .hidden-mobile { display:none!important; }
          .show-mobile { display:flex!important; }
          .page-content { padding-bottom: calc(76px + env(safe-area-inset-bottom,0px)) !important; }
          /* Header en verre depoli = fixed : il chevauche le contenu (pour qu'on
             voie le scroll flou derriere). On pousse donc le contenu dessous de la
             hauteur du header (~48px) + la safe-area du haut portee par le header. */
          .page-content { padding-top: var(--header-h, calc(52px + var(--sat, env(safe-area-inset-top,0px)))) !important; }
          /* Le titre est deja dans le header mobile : on evite de le repeter. */
          .page-title { display:none!important; }
        }
        /* iOS PWA installee (standalone) UNIQUEMENT : on cale la hauteur du shell
           sur --app-height (= screen.height, plein ecran) au lieu de
           -webkit-fill-available, qui y retranche la safe-area du haut (~59px) et ne
           se corrige jamais -- ce qui laissait la barre fixed ancree 59px trop haut.
           La barre RESTE en position:fixed (le contenu defile dessous, verre depoli
           conserve, et elle ne suit pas le scroll du document). Le document peut
           toujours deborder et scroller : le pull-to-refresh natif iOS est preserve.
           Scope a .ios-standalone : aucun impact navigateur / WebView / desktop. */
        html.ios-standalone,
        html.ios-standalone body,
        html.ios-standalone #root { height: var(--app-height, 100vh) !important; }
        /* WebView : le scrim natif occupe deja la barre de statut. On force donc
           la safe-area top a 0 (sinon l'espace serait double sous la barre
           violette). --sat est utilisee par le header et la page a la place de
           env(safe-area-inset-top). */
        html.in-webview { --sat: 0px; }
        /* APK Android (WebView) : aucune safe-area exposee en bas, donc la barre
           se collait au bord de la WebView -- avec les coins arrondis de l'ecran,
           Accueil/Parametres mordaient dans la courbe. On la remonte un peu ET on
           ecarte les boutons des cotes. Scope a .in-webview : iOS reste colle via
           sa safe-area, rien ne bouge de ce cote. */
        html.in-webview .show-mobile {
          padding-bottom: 12px !important;
          padding-left: 12px;
          padding-right: 12px;
        }
      `}</style>
    </div>
  );
}
