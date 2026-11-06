import { useRef } from "react";

// Fermer une fenetre en la glissant vers le bas (06/11/2026), au telephone. Seulement depuis la zone qu'on lui donne
// (la poignee d'une fiche, la barre de titre d'une fenetre du planning) : jamais depuis le contenu, ou une vue 3D, un
// assemblage, une liste qui defile ont leurs propres gestes. Au-dela de 90 px vers le bas, elle se ferme ; en deca,
// elle revient en place.
export function useSwipeClose(onClose) {
  const sheet = useRef(null);
  const st = useRef(null);
  const move = dy => {
    const el = sheet.current;
    if (!el) return;
    el.style.transition = dy ? "none" : "transform .18s ease";
    el.style.transform = dy ? `translateY(${dy}px)` : "";
  };
  const handle = {
    onTouchStart: e => { if (e.touches.length === 1) st.current = { y: e.touches[0].clientY, dy: 0 }; },
    onTouchMove: e => {
      if (!st.current) return;
      st.current.dy = Math.max(0, e.touches[0].clientY - st.current.y);
      move(st.current.dy);
    },
    onTouchEnd: () => {
      const dy = st.current?.dy || 0;
      st.current = null;
      if (dy > 90) { move(0); onClose?.(); } else move(0);
    },
    onTouchCancel: () => { st.current = null; move(0); },
  };
  return { sheet, handle };
}
