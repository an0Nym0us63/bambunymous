import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./store/auth";
import Layout from "./components/layout/Layout";
import Login from "./pages/Login";
import { importRetry } from "./utils/importRetry";
// Les pages : chargees a la demande (le premier affichage n'attend plus toute l'appli),
// puis prechargees en fond une fois l'appli au calme : changer de page reste instantane.
const PAGES = {
  home: () => import("./pages/Home"),
  prints: () => import("./pages/Prints"),
  filaments: () => import("./pages/Filaments"),
  objects: () => import("./pages/Objects"),
  stats: () => import("./pages/Stats"),
  settings: () => import("./pages/Settings"),
  notifications: () => import("./pages/Notifications"),
  logs: () => import("./pages/Logs"),
};
const page = k => React.lazy(() => importRetry(PAGES[k]));
const Home = page("home");
const Settings = page("settings");
const Logs = page("logs");
const Stats = page("stats");
const Notifications = page("notifications");
const Objects = page("objects");
const Filaments = page("filaments");
const Prints = page("prints");
function usePrefetchPages(on) {
  React.useEffect(() => {
    if (!on) return undefined;
    let t = null, idle = null;
    const go = () => Object.values(PAGES).forEach(f => f().catch(() => {}));
    t = setTimeout(() => {
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(go, { timeout: 4000 });
      else go();
    }, 2500);
    return () => { clearTimeout(t); if (idle && "cancelIdleCallback" in window) window.cancelIdleCallback(idle); };
  }, [on]);
}
// le guide d'utilisation : charge a la demande
const Guide = React.lazy(() => import("./pages/Guide"));
// le banc d'essai des tuiles : seulement en developpement
const TileBench = import.meta.env.DEV ? React.lazy(() => import("./pages/TileBench")) : null;
import DialogHost from "./components/DialogHost";
import { ContextMenuHost } from "./components/ContextMenu";
import { CreatorPageHost } from "./components/MwCreatorPage";
import { egg } from "./eggs";
import Anonymous from "./pages/Anonymous";
import HiddenPage, { isHidden } from "./hidden";
import { PrankRedirect, isPrank } from "./hidden/prankHost";

// Le coup de pouce (28/10/2026) : tours, cles, tickets, loupes et chance de surprise, a qui on veut, en une fois ;
// remplace « rembobiner » (tours) et l'ancien coup de pouce (surprise), dont l'adresse mene ici
const CoupDePouce = React.lazy(() => importRetry(() => import("./pages/CoupDePouce")));

// Adresse inconnue : une page cachee si elle existe (chargee a la demande), sinon « introuvable »
function LostOrHidden() {
  const slug = (useLocation().pathname || "/").replace(/^\/+|\/+$/g, "").toLowerCase();
  if (isPrank(slug)) return <PrankRedirect key={slug} slug={slug} fallback={<NotFound/>}/>;
  return isHidden(slug) ? <HiddenPage key={slug} slug={slug}/> : <NotFound/>;
}

// 418 : la blague des serveurs, et un petit secret pour qui la connait
function Teapot() {
  React.useEffect(() => { egg("teapot"); }, []);
  return (
    <div style={{ padding:"60px 16px", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
      <div style={{ fontSize:64, animation:"bn-jiggle 1.2s ease-in-out infinite" }}>🫖</div>
      <h2 style={{ margin:0, color:"var(--text)" }}>418 · Je suis une théière</h2>
      <p style={{ margin:0, color:"var(--muted)", fontSize:14 }}>On ne fait pas de café ici. Du PLA, à la rigueur.</p>
      <a href="/" style={{ marginTop:8, color:"#3b82f6", fontWeight:700, fontSize:14 }}>Retour à l'accueil</a>
    </div>
  );
}

// Adresse inconnue : une page qui le dit (et un petit secret pour qui s'y perd)
function NotFound() {
  React.useEffect(() => { egg("lost"); }, []);
  return (
    <div style={{ padding:"60px 16px", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
      <div style={{ fontSize:52 }}>🧭</div>
      <h2 style={{ margin:0, color:"var(--text)" }}>Page introuvable</h2>
      <p style={{ margin:0, color:"var(--muted)", fontSize:14 }}>Il n'y a rien ici… ou presque.</p>
      <a href="/" style={{ marginTop:8, color:"#3b82f6", fontWeight:700, fontSize:14 }}>Retour à l'accueil</a>
    </div>
  );
}

function PrivateRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const refreshMe = useAuth((s) => s.refreshMe);

  // A l'ouverture d'une session authentifiee, on resynchronise identite et role
  // depuis le serveur : le role a pu changer, ou la session dater d'avant
  // l'introduction des roles.
  React.useEffect(() => { if (isAuthenticated) refreshMe?.(); }, [isAuthenticated, refreshMe]);

  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  usePrefetchPages(useAuth(s => s.isAuthenticated));
  return (
    <>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={
        <PrivateRoute>
          <Layout />
        </PrivateRoute>
      }>
        <Route index element={<Home />} />
        <Route path="filaments" element={<Filaments />} />
        <Route path="settings" element={<Settings />} />
        <Route path="logs" element={<Logs />} />
        <Route path="prints" element={<Prints />} />
        <Route path="objects" element={<Objects />} />
        <Route path="stats" element={<Stats />} />
        <Route path="notifications" element={<Notifications />} />
        {/* ancienne adresse des succes (liens deja envoyes) : onglet des statistiques */}
        <Route path="achievements" element={<AchievementsRedirect />} />
        <Route path="anonymous" element={<Anonymous />} />
        <Route path="rembobiner" element={<Navigate to="/coup-de-pouce" replace />} />
        <Route path="coup-de-pouce" element={<React.Suspense fallback={null}><CoupDePouce /></React.Suspense>} />
        <Route path="teapot" element={<Teapot />} />
        <Route path="guide" element={<React.Suspense fallback={null}><Guide /></React.Suspense>} />
        {/* l'ancienne adresse du guide (fichiers statiques, ouverts a tous jusqu'au 23/10/2026) */}
        <Route path="doc/*" element={<Navigate to="/guide" replace />} />
        {TileBench && <Route path="banc-tuiles" element={<React.Suspense fallback={null}><TileBench /></React.Suspense>} />}
        <Route path="*" element={<LostOrHidden />} />
      </Route>
    </Routes>
    <DialogHost />
    <ContextMenuHost />
    <CreatorPageHost />
    </>
  );
}

// ── Swipe-to-close global pour tous les bottom sheets ──────────────────────


function AchievementsRedirect() {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  p.set("tab", "achievements");
  return <Navigate to={`/stats?${p}`} replace />;
}
