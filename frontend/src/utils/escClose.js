// Échap ferme la fenêtre du dessus (06/11/2026), partout dans l'appli, sans toucher à chaque fenêtre : on cherche le
// fond plein écran (position fixe, qui couvre la fenêtre) qui ferme au clic, le plus haut, et on « clique à côté ».
// Une seule fenêtre se ferme à la fois (celle de dessous attend un autre Échap). Rien quand on tape dans un champ.
// Une fenêtre qui ne se ferme pas au clic à côté reçoit ensuite un Échap pour ses propres réglages.

function reactProps(el) {
  const k = Object.keys(el).find(x => x.startsWith("__reactProps$"));
  return k ? el[k] : null;
}

// le fond plein écran qui ferme au clic, le plus haut à l'écran
function topBackdrop() {
  const W = window.innerWidth, H = window.innerHeight;
  const covers = el => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" || cs.visibility === "hidden" || cs.pointerEvents === "none" || cs.display === "none") return false;
    const r = el.getBoundingClientRect();
    return r.left <= 2 && r.top <= 2 && r.right >= W - 2 && r.bottom >= H - 2;
  };
  // ce qui est au-dessus, sur quelques points du bord (le contenu d'une fenêtre est au centre, son fond tout autour)
  const pts = [[4, H / 2], [W - 4, H / 2], [W / 2, 4], [4, 4]];
  let best = null, bestZ = -Infinity;
  for (const [x, y] of pts) {
    for (let el = document.elementFromPoint(x, y); el && el !== document.body; el = el.parentElement) {
      if (covers(el) && typeof reactProps(el)?.onClick === "function") {
        const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
        if (z > bestZ || (z === bestZ && best && (best.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))) { best = el; bestZ = z; }
        break;
      }
    }
  }
  return best;
}

const typing = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
  && !/^(checkbox|radio|range|button|submit|color|file)$/i.test(el.type || ""));

export function installEscClose() {
  if (window.__bnEsc) return;
  window.__bnEsc = true;
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.__bnRetry) return;
    if (typing(document.activeElement)) return;          // un champ : Échap lui revient (annuler une saisie)
    const bd = topBackdrop();
    if (!bd) return;
    // le clic « à côté » : la fenêtre se ferme ; les écouteurs d'Échap des fenêtres ne voient pas cette touche-là
    // (sinon celle de dessous se fermait aussi)
    e.stopImmediatePropagation();
    e.preventDefault();
    bd.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    // une fenêtre qui ne ferme pas au clic à côté : on lui rend son Échap
    setTimeout(() => {
      if (!bd.isConnected) return;
      const again = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      again.__bnRetry = true;
      window.dispatchEvent(again);
    }, 120);
  });
}
