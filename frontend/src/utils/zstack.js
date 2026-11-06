import { useLayoutEffect, useState } from "react";

// La pile des fenetres (06/11/2026). Chaque fenetre a son niveau (zIndex) ecrit a la main ; une fenetre ouverte depuis
// une autre plus haute s'ouvrait DERRIERE elle (la fiche MakerWorld sous les fenetres du planning : « le bouton ne
// fait rien »). useStackZ(base) garde ce niveau, sauf si une fenetre deja ouverte est plus haute : elle se pose alors
// juste au-dessus. Le niveau est fixe a l'ouverture (il ne bouge plus ensuite).
const open = [];

export function useStackZ(base) {
  const [z] = useState(() => {
    const top = open.length ? Math.max(...open) : 0;
    return Math.max(base, top + 10);
  });
  useLayoutEffect(() => {
    open.push(z);
    return () => { const i = open.indexOf(z); if (i >= 0) open.splice(i, 1); };
  }, [z]);
  return z;
}
