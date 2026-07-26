import { useState, useEffect } from "react";

// Remonte une bottom-sheet au-dessus du clavier virtuel (API visualViewport) :
// renvoie la hauteur (px) masquee par le clavier. A appliquer en marginBottom sur
// la feuille (et a retrancher de sa hauteur max) pour garder saisie et boutons
// visibles sur mobile.
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    onChange();
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
    };
  }, []);
  return inset;
}
