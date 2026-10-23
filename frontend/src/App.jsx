import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./store/auth";
import Layout from "./components/layout/Layout";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import Logs from "./pages/Logs";
import Stats from "./pages/Stats";
import Notifications from "./pages/Notifications";
import Objects from "./pages/Objects";
import Filaments from "./pages/Filaments";
import Prints from "./pages/Prints";
// le banc d'essai des tuiles : seulement en developpement
const TileBench = import.meta.env.DEV ? React.lazy(() => import("./pages/TileBench")) : null;
import DialogHost from "./components/DialogHost";
import { ContextMenuHost } from "./components/ContextMenu";
import { CreatorPageHost } from "./components/MwCreatorPage";
import { egg } from "./eggs";
import Anonymous from "./pages/Anonymous";
import HiddenPage, { isHidden } from "./hidden";
import { PrankRedirect, isPrank } from "./hidden/prankHost";

function Rewind() {
  const [pw, setPw] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const n = new URLSearchParams(window.location.search).get("n") || 5;
  const go = async e => {
    e.preventDefault();
    if (!pw) { setMsg("Mot de passe requis"); return; }
    setBusy(true); setMsg("");
    try {
      const { default: client } = await import("./api/client");
      const { data } = await client.post("/achievements/wheel/extra", { n: Number(n), secret: pw });
      setMsg(`+${data.added} · ${data.spins}`); setPw("");
    } catch (err) { setMsg(err.response?.data?.detail || err.message); }
    setBusy(false);
  };
  return (
    <form onSubmit={go} style={{ maxWidth:320, margin:"60px auto", padding:"0 16px", display:"flex", flexDirection:"column", gap:10 }}>
      <input type="password" value={pw} onChange={e => { setPw(e.target.value); setMsg(""); }} placeholder="Mot de passe"
        autoComplete="off" style={{ padding:"10px 12px", borderRadius:10, border:"1px solid var(--border)", background:"var(--surface2)",
          color:"var(--text)", fontSize:14 }}/>
      <button type="submit" disabled={busy} style={{ padding:"10px 0", borderRadius:10, border:"none", background:"#3b82f6",
        color:"#fff", fontWeight:700, cursor:"pointer" }}>{busy ? "…" : "Valider"}</button>
      {msg && <p style={{ margin:0, textAlign:"center", color:"var(--muted)", fontFamily:"monospace", fontSize:13 }}>{msg}</p>}
    </form>
  );
}

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
        <Route path="rembobiner" element={<Rewind />} />
        <Route path="teapot" element={<Teapot />} />
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
