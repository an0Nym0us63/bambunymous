// Tirer-pour-rafraichir de la coquille Android : elle l'arme quand la page
// est « en haut », d'apres le scrollTop de l'element qui vient de defiler.
// Une rangee HORIZONTALE (galerie, plateaux, similaires) a toujours un
// scrollTop de 0 : chaque glissement de cote faisait croire a la coquille que
// la page etait en haut, et le moindre geste vertical relancait la page.
//
// Correctif cote page, sans toucher a l'APK :
//  - apres chaque defilement, on renvoie la VRAIE position de la page
//    (conteneur principal), en passant apres l'ecouteur de la coquille ;
//  - tant qu'un doigt manipule une zone qui defile de cote, le
//    rafraichissement est coupe.
let installed = false;

function pageTop() {
  const main = document.querySelector("main.page-content");
  const y = main ? main.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0);
  return y <= 0;
}

function inHorizontalScroller(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.scrollWidth > e.clientWidth + 2) {
      const ox = getComputedStyle(e).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}

// Une fenetre (feuille) ouverte par-dessus la page : on ne rafraichit pas.
const sheetOpen = () => !!document.querySelector("[data-no-pull]");

export function installPullRefreshGuard() {
  if (installed || typeof window === "undefined" || !window.BambuScan?.setAtTop) return;
  installed = true;
  let touching = false;
  const report = () => {
    try { window.BambuScan.setAtTop(!touching && !sheetOpen() && pageTop()); } catch { /* coquille absente */ }
  };
  // Differe : passe toujours APRES l'ecouteur de la coquille, quel que soit
  // l'ordre dans lequel ils ont ete poses. La coquille ne se trompe que quand
  // l'element qui defile est en haut (scrollTop 0 : rangee horizontale, haut
  // d'une liste interne) : seulement la, et une fois par image au plus.
  // Avant, chaque evenement de defilement relancait un appel a la coquille.
  let pending = false;
  window.addEventListener("scroll", e => {
    const t = e.target;
    const top = t && t.scrollTop !== undefined ? t.scrollTop : (window.scrollY || 0);
    if (top > 0 || pending) return;
    pending = true;
    setTimeout(() => { pending = false; report(); }, 0);
  }, { capture: true, passive: true });
  document.addEventListener("touchstart", e => {
    if (inHorizontalScroller(e.target)) { touching = true; report(); }
  }, { capture: true, passive: true });
  const end = () => { if (touching) { touching = false; report(); } };
  document.addEventListener("touchend", end, { capture: true, passive: true });
  document.addEventListener("touchcancel", end, { capture: true, passive: true });
  // Ouverture / fermeture d'une feuille : la position change sans defilement.
  new MutationObserver(() => report()).observe(document.body, { childList: true });
}
