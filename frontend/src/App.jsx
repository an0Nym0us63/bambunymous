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
import DialogHost from "./components/DialogHost";
import { ContextMenuHost } from "./components/ContextMenu";
import { CreatorPageHost } from "./components/MwCreatorPage";
import { egg } from "./eggs";
import Anonymous from "./pages/Anonymous";

function Rewind() {
  const [msg, setMsg] = React.useState("…");
  React.useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("n") || 5;
    import("./api/client").then(({ default: client }) =>
      client.post("/achievements/wheel/extra", null, { params: { n } })
        .then(({ data }) => setMsg(`+${data.added} · ${data.spins}`))
        .catch(e => setMsg(e.response?.status === 403 ? "Réservé à l'administrateur" : (e.response?.data?.detail || e.message))));
  }, []);
  return <p style={{ padding:"40px 16px", textAlign:"center", color:"var(--muted)", fontFamily:"monospace" }}>{msg}</p>;
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
        <Route path="*" element={<NotFound />} />
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
