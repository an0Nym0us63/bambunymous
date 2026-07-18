import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./store/auth";
import Layout from "./components/layout/Layout";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import Logs from "./pages/Logs";
import Stats from "./pages/Stats";
import Objects from "./pages/Objects";
import Filaments from "./pages/Filaments";
import Prints from "./pages/Prints";

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
      </Route>
    </Routes>
  );
}

// ── Swipe-to-close global pour tous les bottom sheets ──────────────────────

