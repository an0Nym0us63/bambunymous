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

/**
 * "#RRGGBB,#RRGGBB" (+ couleur principale) → ["#RRGGBB", …]
 * Conserve l'alpha quand il est présent (#RRGGBBAA) : les filaments translucides
 * arrivent en 8 hex (l'ingestion ne rstrip que l'alpha FF opaque).
 */
export function parseColorsList(color, colorsArray) {
  // Alpha "global" du filament : la transparence est une propriété du FILAMENT,
  // pas d'une couleur. Plusieurs chemins backend tronquent colors_array à 6 hex
  // (alpha perdu) alors que le color principal, lui, garde son alpha. On propage
  // donc cet alpha à chaque couleur qui n'en a pas — sinon seul le filament sans
  // colors_array (retombant sur color) affichait la transparence.
  const mainAlpha = (() => {
    const h = String(color || "").trim().replace(/^#/, "");
    return /^[0-9a-fA-F]{8}$/.test(h) ? h.slice(6).toLowerCase() : null;
  })();
  const norm = (c) => {
    const h = String(c).trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{8}$/.test(h)) return `#${h}`;      // déjà un alpha propre
    const six = h.slice(0, 6);
    if (!/^[0-9a-fA-F]{6}$/.test(six)) return null;
    return mainAlpha ? `#${six}${mainAlpha}` : `#${six}`;
  };
  if (colorsArray) {
    const list = String(colorsArray).split(",").map(norm).filter(Boolean);
    if (list.length) return list;
  }
  if (!color) return [];
  const c = norm(color);
  return c ? [c] : [];
}

/**
 * Couleur translucide ? Gère les DEUX formats qui atteignent colorBg :
 *  - #RRGGBBAA (page Bobines, via parseColorsList) ;
 *  - rgba(r,g,b,a) (section AMS, via son hexToCss qui convertit déjà l'alpha).
 */
function _translucent(c) {
  const s = String(c || "");
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(7).toLowerCase() !== "ff";
  const m = s.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i);
  return m ? parseFloat(m[1]) < 1 : false;
}

// Damier de transparence (façon éditeur d'image) : posé DERRIÈRE la couleur pour
// que l'alpha se voie. Carreaux clairs, lisibles aussi bien en thème clair que
// sombre (la transparence laisse voir le damier = signal universel).
const CHECKER = {
  image: [
    "linear-gradient(45deg,#c0c0c0 25%,transparent 25%)",
    "linear-gradient(-45deg,#c0c0c0 25%,transparent 25%)",
    "linear-gradient(45deg,transparent 75%,#c0c0c0 75%)",
    "linear-gradient(-45deg,transparent 75%,#c0c0c0 75%)",
  ].join(","),
  size: "8px 8px,8px 8px,8px 8px,8px 8px",
  position: "0 0,0 4px,4px -4px,-4px 0",
  color: "#f0f0f0",
};

/** Style de fond d'un filament : aplat, dégradé (gradient) ou tranches (coaxial). */
export function colorBg(colors, type) {
  if (!colors?.length) return { backgroundColor: "var(--border)" };

  // Couche couleur, exprimée comme IMAGE (linear-gradient) pour pouvoir être
  // superposée à un damier si besoin.
  let layer;
  if (colors.length === 1) {
    layer = `linear-gradient(${colors[0]},${colors[0]})`;
  } else if (type === "gradient") {
    layer = `linear-gradient(90deg, ${colors.join(", ")})`;
  } else {
    const stops = colors.map((c, i) => {
      const a = Math.round((i / colors.length) * 100);
      const b = Math.round(((i + 1) / colors.length) * 100);
      return `${c} ${a}%, ${c} ${b}%`;
    }).join(", ");
    layer = `linear-gradient(90deg, ${stops})`;
  }

  // Aucune transparence : rendu simple, strictement identique à avant.
  if (!colors.some(_translucent)) {
    if (colors.length === 1) return { backgroundColor: colors[0] };
    return { background: layer };
  }

  // Transparence présente : couleur PAR-DESSUS le damier.
  return {
    backgroundColor: CHECKER.color,
    backgroundImage: `${layer},${CHECKER.image}`,
    backgroundSize: `100% 100%,${CHECKER.size}`,
    backgroundPosition: `0 0,${CHECKER.position}`,
    backgroundRepeat: "no-repeat,repeat,repeat,repeat,repeat",
  };
}

/**
 * Rend une liste de couleurs OPAQUE (retire l'alpha). Pour la barre de niveau :
 * un remplissage translucide sur damier ne laisse plus voir le niveau ; on veut
 * la couleur pleine, sans damier.
 */
export function opaqueColors(colors) {
  return (colors || []).map((c) => {
    const s = String(c);
    if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7);
    const m = s.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)$/i);
    return m ? `rgb(${m[1]},${m[2]},${m[3]})` : s;
  });
}
