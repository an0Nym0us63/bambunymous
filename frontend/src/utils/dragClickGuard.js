// Selectionner le texte d'un champ a la souris (29/10/2026) : appuyer dans le champ, glisser, relacher hors de la
// fenetre. Le navigateur envoie alors un « clic » a l'ancetre commun, souvent le voile de la fenetre, qui la
// ferme. Ce clic-la n'en est pas un : on l'arrete avant qu'il n'arrive aux fenetres. Un vrai clic (appui et
// relache au meme endroit) passe comme avant.
export function installDragClickGuard() {
  let down = null;
  const typing = el => !!el && (el.closest?.("input, textarea, select, [contenteditable='true']") != null);
  window.addEventListener("pointerdown", e => { down = e.target; }, true);
  window.addEventListener("click", e => {
    const from = down;
    down = null;
    if (!from || from === e.target || !(e.target instanceof Element) || e.target.contains(from) === false) return;
    // appuye dans un champ et relache ailleurs : pas un clic
    if (typing(from)) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}
