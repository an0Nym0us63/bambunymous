// Le diagnostic d'affichage (07/11/2026) : couper, sur cet appareil seulement, ce qui pourrait rendre la page blanche
// quelques secondes apres une capture d'ecran (le navigateur doit tout redessiner). Garde dans ce navigateur.
//  - noblur : les barres a fond floute deviennent opaques ;
//  - noanim : plus aucune animation ni transition ;
//  - nofx : les effets des succes (fetes de cartes, grade, nouvelles, surprises) ne sont pas montes.
const KEY = "bn_diag";

export function diagGet() {
  try { const o = JSON.parse(localStorage.getItem(KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}

export function diagApply(o = diagGet()) {
  const c = document.documentElement.classList;
  c.toggle("bn-diag-noblur", !!o.noblur);
  c.toggle("bn-diag-noanim", !!o.noanim);
}

export function diagSet(k, v) {
  const o = { ...diagGet(), [k]: !!v };
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* indisponible */ }
  diagApply(o);
  return o;
}
