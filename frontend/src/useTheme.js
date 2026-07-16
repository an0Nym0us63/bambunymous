import { useState, useEffect } from "react";

// Couleur de la barre de statut (Android) = la theme-color de la PWA. On garde le
// violet de la marque dans les deux themes, comme en PWA installee. Si un jour tu
// veux qu'elle matche le fond, remplace par la valeur voulue par theme.
const STATUS_BAR_COLOR = "#4f46e5";

export function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("bambu-theme") || "dark"
  );

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      theme === "light" ? "light" : ""
    );
    localStorage.setItem("bambu-theme", theme);

    // Notifie la coquille WebView (si presente) pour que la barre de statut
    // Android suive immediatement le theme, sans rechargement. En navigateur,
    // window.BambuScan n'existe pas -> sans effet.
    try {
      window.BambuScan?.setThemeColor?.(STATUS_BAR_COLOR);
    } catch { /* pont indisponible : rien a faire */ }
  }, [theme]);

  const toggle = () => setTheme(t => t === "dark" ? "light" : "dark");

  return { theme, toggle };
}
