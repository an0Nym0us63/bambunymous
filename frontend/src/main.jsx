import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { installPullRefreshGuard } from "./utils/pullRefreshGuard";
import { installIosPullRefresh } from "./utils/iosPullRefresh";
import { installDesktopHScroll } from "./utils/desktopHScroll";
import { installChunkReload } from "./utils/importRetry";
import { installDragClickGuard } from "./utils/dragClickGuard";
import { installEscClose } from "./utils/escClose";
import ErrorBoundary from "./components/ErrorBoundary";
import { diagApply } from "./utils/diag";

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

// Selectionner un champ en glissant hors d'une fenetre ne la ferme plus.
installDragClickGuard();
// Échap ferme la fenêtre du dessus, partout (06/11/2026)
installEscClose();

// Init thème avant premier render (évite le flash)
const savedTheme = localStorage.getItem("bambu-theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme === "light" ? "light" : "");

// un geste a plusieurs doigts (06/11/2026 : la capture d'ecran a trois doigts vers le bas, sur Android) ne doit pas
// declencher le rafraichissement natif du navigateur, qui rechargeait toute l'appli (page blanche le temps du chargement)
document.addEventListener("touchstart", e => {
  if (e.touches.length > 1) document.documentElement.classList.add("bn-multitouch");
}, { capture: true, passive: true });
const _mtEnd = e => { if (!e.touches.length) document.documentElement.classList.remove("bn-multitouch"); };
document.addEventListener("touchend", _mtEnd, { capture: true, passive: true });
document.addEventListener("touchcancel", _mtEnd, { capture: true, passive: true });

diagApply();                 // le diagnostic d'affichage de cet appareil (Parametres > Outils)
const root = ReactDOM.createRoot(document.getElementById("root"));
// le dernier filet (06/11/2026) : une erreur hors des pages (barre, menu) ne laisse plus une page blanche
root.render(<BrowserRouter><ErrorBoundary where="appli"><App /></ErrorBoundary></BrowserRouter>);

// Masquer le splash screen une fois React monté
requestAnimationFrame(() => {
  if (typeof window.__hideSplash === "function") window.__hideSplash();
});
