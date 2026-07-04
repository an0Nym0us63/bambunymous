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
;(function setupGlobalSheetSwipe() {
  if (typeof window === "undefined") return;
  let startY = 0, el = null;
  document.addEventListener("touchstart", e => {
    const inner = e.target.closest(".sheet-inner");
    if (!inner) return;
    startY = e.touches[0].clientY;
    el = inner;
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!el) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) el.style.transform = `translateY(${Math.min(dy, 200)}px)`;
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (!el) return;
    const dy = e.changedTouches[0].clientY - startY;
    el.style.transform = "";
    // Fermer : cliquer sur le backdrop (parent direct du sheet-inner)
    if (dy > 80) {
      const backdrop = el.parentElement;
      if (backdrop) backdrop.click();
    }
    el = null;
  });
})();
