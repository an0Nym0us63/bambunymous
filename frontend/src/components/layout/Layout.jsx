import React from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Home, Settings, LogOut, Package, History, ShoppingBag, BarChart2 } from "lucide-react";
import { useAuth } from "../../store/auth";

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
  page:    { flex:1, overflowY:"auto", padding:16, paddingTop:"calc(16px + env(safe-area-inset-top, 0px))", background:"var(--bg)" },
  // Mobile
  header:  { display:"flex", alignItems:"center", gap:8, padding:"12px 16px", background:"var(--sidebar)", borderBottom:"1px solid var(--border)" },
  bottomNav: { display:"flex", background:"var(--sidebar)", borderTop:"1px solid var(--border)",
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
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? null;

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
        <button onClick={() => { logout(); navigate("/login"); }}
          style={{ display:"flex", alignItems:"center", gap:10, margin:"0 8px", padding:"10px 12px", borderRadius:12, color:"var(--muted)", fontSize:14, transition:"color 0.15s", cursor:"pointer" }}
          onMouseEnter={e => e.currentTarget.style.color="#ef4444"}
          onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}>
          <LogOut size={17} /><span>Déconnexion</span>
        </button>
      </aside>

      <div style={S.main}>
        {/* Header mobile */}
        <header className="show-mobile" style={S.header}>
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
          /* Le titre est deja dans le header mobile : on evite de le repeter. */
          .page-title { display:none!important; }
        }
      `}</style>
    </div>
  );
}
