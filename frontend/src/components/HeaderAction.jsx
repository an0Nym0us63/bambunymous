import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Injecte ses enfants dans la zone d'actions du header mobile (Layout).
 *
 * Sur mobile, une barre d'actions propre à la page consomme une ligne entière
 * sous le header alors qu'il reste de la place à droite du titre. On y porte
 * donc le bouton plutôt que de le poser dans le flux.
 *
 * Sur desktop, le header mobile est masqué : le portail ne rend rien et la page
 * doit afficher son bouton normalement (d'où le `hidden-mobile` côté appelant).
 */
export default function HeaderAction({ children }) {
  const [slot, setSlot] = useState(null);

  useEffect(() => {
    // Le header est monté par Layout : on ne peut le viser qu'après notre propre
    // montage, d'où l'état plutôt qu'un getElementById direct au rendu.
    setSlot(document.getElementById("header-actions"));
  }, []);

  if (!slot) return null;
  return createPortal(children, slot);
}
