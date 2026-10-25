import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { installPullRefreshGuard } from "./utils/pullRefreshGuard";
import { installIosPullRefresh } from "./utils/iosPullRefresh";
import { installDesktopHScroll } from "./utils/desktopHScroll";
import { installChunkReload } from "./utils/importRetry";

// Coquille Android : les rangees horizontales n'arment plus le tirer-pour-rafraichir.
installPullRefreshGuard();
// PWA iPhone / iPad : iOS n'a pas de tirer-pour-rafraichir en mode ecran
// d'accueil, on en fournit un (sans toucher au defilement). Le banc d'essai
// peut le forcer avec ?ptr=1.
installIosPullRefresh(new URLSearchParams(window.location.search).get("ptr") === "1");

// L'appli restee ouverte pendant une mise a jour : un morceau introuvable recharge la page (une fois)
installChunkReload();

// A la souris : molette et glisser pour les rangees qui defilent de cote.
installDesktopHScroll();

// Init thème avant premier render (évite le flash)
const savedTheme = localStorage.getItem("bambu-theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme === "light" ? "light" : "");

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<BrowserRouter><App /></BrowserRouter>);

// Masquer le splash screen une fois React monté
requestAnimationFrame(() => {
  if (typeof window.__hideSplash === "function") window.__hideSplash();
});
