import React, { useEffect } from "react";
import { FriendChip } from "../Friends";
import { useFriend } from "../../store/friend";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Home, Settings, Package, History, ShoppingBag, BarChart2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import UserMenu from "../UserMenu";
import NotifBell from "../NotifBell";
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
import AchNews from "../AchNews";
import { Hide } from "../Cachettes";
import { MwLinkHost } from "../MwCreatorPage";

// chaque page a sa couleur (celle de ses onglets) : la barre laterale la reprend
const nav = [
  { to: "/",          icon: Home,       label: "Accueil",     c: "#3B82F6" },
  { to: "/prints",    icon: History,    label: "Impressions", c: "#06B6D4" },
  { to: "/filaments", icon: Package,    label: "Filaments",   c: "#F97316" },
  { to: "/objects",   icon: ShoppingBag,label: "Objets",      c: "#8B5CF6" },
  { to: "/stats",     icon: BarChart2,  label: "Stats",       c: "#22C55E" },
  { to: "/settings",  icon: Settings,   label: "Paramètres",  c: "#64748B" },
];

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
    paddingBottom:"calc(env(safe-area-inset-bottom, 0px) * 0.5)" },
};

// Une entree du menu : l'icone dans une pastille de la couleur de la page ; la page ouverte, en degrade.
// Repliee : l'icone seule, le nom en infobulle.
function NavItem({ to, icon: Icon, label, c, mini }) {
  return (
    <NavLink to={to} end={to === "/"} className="bn-nav" data-tip={mini ? label : undefined} aria-label={label}
      style={({ isActive }) => ({
        "--c": c, display:"flex", alignItems:"center", gap:11, padding: mini ? "7px" : "7px 10px 7px 7px",
        justifyContent: mini ? "center" : "flex-start", borderRadius:14, fontSize:14, textDecoration:"none", transition:"background .15s, box-shadow .15s",
        background: isActive ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 65%, #ffffff))` : "transparent",
        boxShadow: isActive ? `0 8px 18px -10px ${c}` : "none",
        color: isActive ? "#fff" : "var(--text2)", fontWeight: isActive ? 800 : 600, whiteSpace:"nowrap",
      })}>
      {({ isActive }) => (<>
        <span style={{ width:32, height:32, borderRadius:10, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
          background: isActive ? "rgba(255,255,255,0.22)" : `color-mix(in srgb, ${c} 16%, transparent)`, color: isActive ? "#fff" : c }}>
          <Icon size={17}/></span>
        {!mini && <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{label}</span>}
      </>)}
    </NavLink>
  );
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
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? null;
  const friend = useFriend((st) => st.friend);   // chez un copain
  const visitHome = useFriend((st) => st.visit);
  const [mini, flipMini] = useSideMini();
  const headerRef = React.useRef(null);
  // gestes caches (voir eggs.js) ; le logo, lui, a le tournis facile
  React.useEffect(() => { installEggs(); }, []);
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
    <div style={S.app}>
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
        <nav style={S.nav}>
          {nav.map(n => <NavItem key={n.to} {...n} mini={mini}/>)}
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
            <div style={{ flex: mini ? "none" : 1, minWidth:0 }}><UserMenu placement="top" showName={!mini} size={30}/></div>
            {!friend && <NotifBell size={18}/>}
          </div>
        </div>
      </aside>

      <div style={S.main}>
        {/* Header mobile */}
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
          {!friend && <NotifBell/>}
          <UserMenu placement="bottom"/>
        </header>

        <main className="page-content" style={S.page}><Outlet /></main>
        <PrankHost/>
        <CardFx/>
        <AchNews/>
        <MwLinkHost/>
        <MwAssignPicker/>
        <ShareProgress/>
        {!friend && <RfidScanBridge/>}
        {!friend && <PushBridge/>}
        <FriendLinkBridge/>
        <Toast/>
        <NoAutofill/>

        {/* Bottom nav mobile */}
        <nav className="show-mobile" style={S.bottomNav}>
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === "/"} style={({ isActive }) => ({
              flex:1, display:"flex", flexDirection:"column", alignItems:"center",
              padding:"12px 0 2px", gap:3, fontSize:10, textDecoration:"none",
              color: isActive ? "#3b82f6" : "var(--muted)", transition:"color 0.15s",
            })}>
              <Icon size={19} /><span>{label}</span>
            </NavLink>
          ))}
          <span style={{ position:"absolute", top:1, left:"50%", transform:"translateX(-50%)" }}><Hide at="nav" size={9}/></span>
        </nav>
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
