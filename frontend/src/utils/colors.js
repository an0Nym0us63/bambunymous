/**
 * Rendu des couleurs de filament — source unique.
 *
 * Ces fonctions étaient dupliquées (colorBg dans Filaments.jsx ET AMSSection.jsx,
 * à l'identique). Une copie qui dérive de l'autre, et la même bobine ne s'affiche
 * plus pareil selon l'écran.
 *
 * NB : hexCss n'est volontairement PAS ici. Prints.jsx et Home.jsx en ont chacun
 * une version aux sémantiques DIFFÉRENTES (fallback "#888" contre null, et Home
 * filtre le noir pur). Les fusionner casserait l'une des deux.
 */

/** "#RRGGBB,#RRGGBB" (+ couleur principale) → ["#RRGGBB", …] */
export function parseColorsList(color, colorsArray) {
  if (colorsArray) {
    const list = String(colorsArray)
      .split(",")
      .map(c => `#${c.trim().replace(/^#/, "").slice(0, 6)}`)
      .filter(c => c.length === 7);
    if (list.length) return list;
  }
  if (!color) return [];
  const c = String(color).replace(/^#/, "").slice(0, 6);
  return c.length === 6 ? [`#${c}`] : [];
}

/** Style de fond d'un filament : aplat, dégradé (gradient) ou tranches (coaxial). */
export function colorBg(colors, type) {
  if (!colors?.length) return { backgroundColor: "var(--border)" };
  if (colors.length === 1) return { backgroundColor: colors[0] };
  if (type === "gradient") {
    // Fondu lisse entre les couleurs
    return { background: `linear-gradient(90deg, ${colors.join(", ")})` };
  }
  // Autres types (coaxial, etc.) : séparation nette
  const stops = colors.map((c, i) => {
    const a = Math.round((i / colors.length) * 100);
    const b = Math.round(((i + 1) / colors.length) * 100);
    return `${c} ${a}%, ${c} ${b}%`;
  }).join(", ");
  return { background: `linear-gradient(90deg, ${stops})` };
}
