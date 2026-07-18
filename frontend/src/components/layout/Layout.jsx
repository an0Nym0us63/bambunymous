import React, { useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Home, Settings, Package, History, ShoppingBag, BarChart2 } from "lucide-react";
import UserMenu from "../UserMenu";

const nav = [
  { to: "/",          icon: Home,       label: "Accueil"    },
  { to: "/prints",    icon: History,    label: "Historique" },
  { to: "/filaments", icon: Package,    label: "Filaments"  },
  { to: "/objects",   icon: ShoppingBag,label: "Objets"     },
  { to: "/stats",     icon: BarChart2,  label: "Stats"      },
  { to: "/settings",  icon: Settings,   label: "Paramètres" },
];

// Titre affiche dans le header mobile : evite de redonder le <h1> de chaque page.
const TITLES = {
  "/":          null,            // l'accueil n'a pas de titre propre
  "/prints":    "Historique",
  "/filaments": "Filaments",
  "/objects":   "Objets & Accessoires",
  "/stats":     "Statistiques",
  "/settings":  "Paramètres",
  "/logs":      "Journal",
};

const S = {
  app:     { display:"flex", height:"100dvh", overflow:"hidden", background:"var(--bg)" },
  aside:   { display:"flex", flexDirection:"column", width:208, background:"var(--sidebar)", borderRight:"1px solid var(--border)", padding:"20px 0", flexShrink:0 },
  logo:    { display:"flex", alignItems:"center", gap:10, padding:"0 16px", marginBottom:32 },
  logoBox: { width:28, height:28, borderRadius:8, overflow:"hidden" },
  nav:     { flex:1, padding:"0 8px", display:"flex", flexDirection:"column", gap:2 },
  main:    { flex:1, display:"flex", flexDirection:"column", overflow:"hidden" },
  page:    { flex:1, overflowY:"auto", padding:16, paddingTop:"calc(16px + var(--sat, env(safe-area-inset-top, 0px)))", background:"var(--bg)" },
  // Mobile
  // Le header est colle en haut de l'ecran. En PWA installee edge-to-edge et en
  // WebView, la barre d'etat (heure, wifi) passe PAR-DESSUS s'il ne reserve pas la
  // safe-area : le titre se retrouvait sous l'heure. Dans un navigateur classique,
  // env(safe-area-inset-top) vaut 0, donc rien ne change la-bas.
  header:  { display:"flex", alignItems:"center", gap:8,
    padding:"12px 16px", paddingTop:"calc(12px + var(--sat, env(safe-area-inset-top, 0px)))",
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
    paddingBottom:"env(safe-area-inset-bottom,0px)" },
};

function NavItem({ to, icon: Icon, label }) {
  return (
    <NavLink to={to} end={to === "/"} style={({ isActive }) => ({
      display:"flex", alignItems:"center", gap:10, padding:"10px 12px",
      borderRadius:12, fontSize:14, textDecoration:"none", transition:"all 0.15s",
      background: isActive ? "rgba(59,130,246,0.12)" : "transparent",
      color: isActive ? "#3b82f6" : "var(--text2)",
      fontWeight: isActive ? 600 : 400,
    })}>
      <Icon size={17} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? null;

  // Dans la coquille WebView, une bande coloree (scrim natif) occupe DEJA la place
  // de la barre de statut. Le header ne doit donc pas reserver en plus la
  // safe-area du haut, sinon l'espace est double. On marque <html> pour permettre
  // au CSS ci-dessous de neutraliser cette safe-area, uniquement en WebView.
  useEffect(() => {
    if (typeof window !== "undefined" && window.BambuScan) {
      document.documentElement.classList.add("in-webview");
    }
  }, []);

  return (
    <div style={S.app}>
      {/* Sidebar desktop */}
      <aside className="hidden-mobile" style={S.aside}>
        <div style={{...S.logo, cursor:"pointer"}} onClick={() => navigate("/")}>
          <img src="/icon-192.png" style={{ width:28, height:28, borderRadius:7, flexShrink:0 }} alt=""/>
          <span style={{ fontWeight:700, fontSize:13, background:"linear-gradient(90deg,#3b82f6,#06b6d4)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
            BambuNymous
          </span>
        </div>
        <nav style={S.nav}>
          {nav.map(n => <NavItem key={n.to} {...n} />)}
        </nav>
        {/* Le compte remplace le bouton de deconnexion nu : meme place, en bas
            du menu, mais il indique aussi qui est connecte et sous quel role. */}
        <div style={{ margin:"0 8px", padding:"10px 12px", borderTop:"1px solid var(--border)" }}>
          <UserMenu placement="top" showName size={28}/>
        </div>
      </aside>

      <div style={S.main}>
        {/* Header mobile */}
        <header className="show-mobile app-header" style={S.header}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0, cursor:"pointer" }}
            onClick={() => navigate("/")}>
            <img src="/icon-192.png" style={{ width:24, height:24, borderRadius:6, flexShrink:0 }} alt=""/>
            {!title && (
              <span style={{ fontWeight:700, fontSize:13, background:"linear-gradient(90deg,#3b82f6,#06b6d4)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
                BambuNymous
              </span>
            )}
          </div>
          {title && (
            <h1 style={{ fontSize:15, fontWeight:700, color:"var(--text)", margin:0,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {title}
            </h1>
          )}
          {/* Emplacement d'actions : les pages y injectent leurs boutons par
              portail (cf. Filaments -> Scanner). Sur mobile, cela evite qu'une
              barre d'actions occupe une ligne entiere sous le header. */}
          <div id="header-actions" style={{ marginLeft:"auto", display:"flex",
            alignItems:"center", gap:6, flexShrink:0 }}/>
          {/* Accueil uniquement : ailleurs le header porte deja un titre et les
              actions de la page, et la pastille encombrerait une barre etroite.
              Placee apres le point d'injection, elle reste la plus a droite. */}
          {pathname === "/" && <UserMenu placement="bottom"/>}
        </header>

        <main className="page-content" style={S.page}><Outlet /></main>

        {/* Bottom nav mobile */}
        <nav className="show-mobile" style={S.bottomNav}>
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === "/"} style={({ isActive }) => ({
              flex:1, display:"flex", flexDirection:"column", alignItems:"center",
              padding:"12px 0", gap:3, fontSize:10, textDecoration:"none",
              color: isActive ? "#3b82f6" : "var(--muted)", transition:"color 0.15s",
            })}>
              <Icon size={19} /><span>{label}</span>
            </NavLink>
          ))}
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
          .page-content { padding-top: calc(60px + var(--sat, env(safe-area-inset-top,0px))) !important; }
          /* Le titre est deja dans le header mobile : on evite de le repeter. */
          .page-title { display:none!important; }
        }
        /* WebView : le scrim natif occupe deja la barre de statut. On force donc
           la safe-area top a 0 (sinon l'espace serait double sous la barre
           violette). --sat est utilisee par le header et la page a la place de
           env(safe-area-inset-top). */
        html.in-webview { --sat: 0px; }
      `}</style>
    </div>
  );
}
