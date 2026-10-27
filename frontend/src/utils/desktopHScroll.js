// Rangees qui defilent de cote (puces de filtres, onglets…) : au doigt ou au
// pave tactile, rien a faire ; a la souris, rien ne permettait de les faire
// defiler. Partout dans l'appli :
//  - la molette fait defiler la rangee de cote quand elle ne defile pas en hauteur ;
//  - on peut la saisir et la faire glisser (un vrai glisse n'est pas un clic).

function hRow(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowX) && !(/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 2)) return n;
    }
  }
  return null;
}

export function installDesktopHScroll() {
  if (typeof window === "undefined" || window.__bnHScroll) return;
  window.__bnHScroll = true;

  // molette : vertical -> horizontal, tant que la rangee peut encore avancer dans ce sens
  window.addEventListener("wheel", e => {
    if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const row = hRow(e.target);
    if (!row) return;
    const max = row.scrollWidth - row.clientWidth;
    if ((e.deltaY > 0 && row.scrollLeft >= max - 1) || (e.deltaY < 0 && row.scrollLeft <= 0)) return;
    e.preventDefault();
    // une rangee qui se cale sur ses elements (galerie d'images) : un element entier par cran (27/10/2026).
    // Un pas de 100 px y etait ramene aussitot sur l'image en cours : un a-coup, puis plus rien.
    if (getComputedStyle(row).scrollSnapType.startsWith("x") || getComputedStyle(row).scrollSnapType.startsWith("both")) {
      const now = Date.now();
      if (now < (row.__bnWheelLock || 0)) return;
      row.__bnWheelLock = now + 280;
      const item = row.firstElementChild?.getBoundingClientRect().width || row.clientWidth * 0.8;
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      row.scrollBy({ left: Math.sign(e.deltaY) * (item + gap), behavior: "smooth" });
      return;
    }
    row.scrollLeft += e.deltaY;
  }, { passive: false });

  // saisir et faire glisser (souris seulement)
  let drag = null;
  window.addEventListener("pointerdown", e => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const row = hRow(e.target);
    if (row) drag = { row, x: e.clientX, left: row.scrollLeft, moved: false };
  });
  window.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true;
    drag.row.scrollLeft = drag.left - dx;
    drag.row.style.cursor = "grabbing";
    window.getSelection?.()?.removeAllRanges();
  });
  const end = () => {
    if (!drag) return;
    drag.row.style.cursor = "";
    if (drag.moved) {
      // le relachement apres un glisse ne doit pas cliquer sur la puce dessous
      const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 50);
    }
    drag = null;
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
