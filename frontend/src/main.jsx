import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Init thème avant premier render (évite le flash)
const savedTheme = localStorage.getItem("bambu-theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme === "light" ? "light" : "");

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<BrowserRouter><App /></BrowserRouter>);

// Masquer le splash screen une fois React monté
requestAnimationFrame(() => {
  if (typeof window.__hideSplash === "function") window.__hideSplash();
});
