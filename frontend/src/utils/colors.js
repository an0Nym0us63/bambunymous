import { finishImage } from "./finishTex";
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

/**
 * La finition d'un filament (28/10/2026), lue dans son type ou son nom (« PLA Silk+ », « PETG HF Sparkle »…) :
 * silk, metal, sparkle, galaxy, marble, wood, carbon, glow, matte, ou null. Le translucide, lui, se lit dans
 * l'alpha de la couleur (damier). finishOf accepte des objets (filament, bobine, plateau AMS…) ou des textes.
 */
const FINISH_WORDS = [
  ["glow", /glow|phosphor|luminesc/],
  ["galaxy", /galaxy|galax/],
  ["sparkle", /sparkle|glitter|paillet/],
  ["marble", /marble|marbre/],
  ["silk", /silk|soie/],
  ["metal", /metal/],
  ["wood", /wood|\bbois\b/],
  ["carbon", /carbon|carbone|(^|[\s-])cf\b/],
  ["matte", /matte|\bmat\b/],
];
const FINISH_KEYS = ["fila_type", "sub_brand", "sub_brands", "tray_sub_brands", "name", "translated_name", "material",
  "filament_type", "filament_name", "filament_fila_type", "product", "type", "tray_type"];
// les finitions, dans l'ordre du menu de la fiche d'un filament
export const FINISHES = [["silk", "Soie (silk)"], ["metal", "Métal"], ["sparkle", "Paillettes (sparkle)"], ["galaxy", "Galaxie"],
  ["marble", "Marbre"], ["wood", "Bois"], ["carbon", "Carbone"], ["glow", "Phosphorescent (glow)"], ["matte", "Mat"]];
// La finition choisie sur la fiche du filament (fila_finish ; « none » = aucune) passe avant celle lue dans le nom.
export function finishOf(...objs) {
  for (const o of objs) {
    const v = o && typeof o === "object" ? o.fila_finish || o.filament_fila_finish : null;
    if (v) return v === "none" ? null : v;
  }
  return autoFinishOf(...objs);
}
// la finition lue dans le nom ou le type seulement (ce que la fiche propose par defaut)
export function autoFinishOf(...objs) {
  const txt = objs.flatMap(o => (typeof o === "string" ? [o] : o && typeof o === "object" ? FINISH_KEYS.map(k => o[k]) : []))
    .filter(v => typeof v === "string" && v).join(" ").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (!txt) return null;
  const hit = FINISH_WORDS.find(([, rx]) => rx.test(txt));
  return hit ? hit[0] : null;
}

// Les couches d'une finition, posees PAR-DESSUS la couleur : [image, taille, position]. « bar » : la version
// legere, pour les barres de niveau (le niveau reste lisible).
const FULL = ["100% 100%", "0 0"];
function finishLayers(f, bar) {
  switch (f) {
    case "silk": return bar
      ? [["linear-gradient(115deg,rgba(255,255,255,0) 22%,rgba(255,255,255,.4) 45%,rgba(255,255,255,0) 62%)", ...FULL]]
      : [["linear-gradient(115deg,rgba(255,255,255,0) 22%,rgba(255,255,255,.55) 45%,rgba(255,255,255,0) 62%)", ...FULL],
         ["linear-gradient(115deg,rgba(0,0,0,.2),rgba(0,0,0,0) 30%,rgba(0,0,0,0) 70%,rgba(0,0,0,.2))", ...FULL]];
    case "metal": return bar
      ? [["linear-gradient(90deg,rgba(255,255,255,.35),rgba(0,0,0,.18) 50%,rgba(255,255,255,.3))", ...FULL]]
      : [["linear-gradient(135deg,rgba(255,255,255,.55),rgba(255,255,255,0) 35%,rgba(0,0,0,.3) 60%,rgba(255,255,255,.35) 85%)", ...FULL]];
    // paillettes, galaxie, marbre, bois, carbone : le meme dessin que la vue 3D et les bobines (utils/finishTex),
    // au hasard -- une grille de points reguliere faisait un motif de tissu, pas du marbre
    case "sparkle": case "marble": case "wood": case "carbon": {
      const img = finishImage(f);
      return img ? [[`url(${img})`, bar ? "64px 64px" : "96px 96px", "0 0"]] : [];
    }
    case "galaxy": {
      const img = finishImage(f);
      return img ? [...(bar ? [] : [["linear-gradient(125deg,rgba(255,255,255,0) 25%,rgba(200,190,255,.16) 45%,rgba(255,255,255,0) 65%)", ...FULL]]),
        [`url(${img})`, bar ? "64px 64px" : "96px 96px", "0 0"]] : [];
    }
    case "glow": return bar
      ? [["linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.45),rgba(255,255,255,0))", ...FULL]]
      : [["radial-gradient(circle,rgba(240,255,230,.85) 0,rgba(220,255,200,.45) 35%,rgba(220,255,200,0) 70%)", ...FULL]];
    case "matte": return [["linear-gradient(rgba(255,255,255,.07),rgba(0,0,0,.07))", ...FULL]];
    default: return [];
  }
}

/**
 * Style de fond d'un filament : aplat, dégradé (gradient) ou tranches (coaxial). finish (finishOf) : sa finition,
 * posee par-dessus ; opts.bar : la version legere des barres de niveau.
 */
export function colorBg(colors, type, finish = null, opts = {}) {
  if (!colors?.length) return { backgroundColor: "var(--border)" };
  const over = finish ? finishLayers(finish, !!opts.bar) : [];
  if (over.length) return _withFinish(colors, type, over, finish, opts);
  return _colorBg(colors, type);
}

// Le fond d'un emplacement d'AMS (la bobine associee d'abord, puis ce que dit l'AMS) : couleurs, transparence,
// finition. `top` : une couche posee par-dessus (l'assombri de ce qui est consomme). null si vide ou sans couleur.
export function trayBg(t, top = null) {
  if (!t || t.empty) return null;
  const si = t.spool_info || {};
  const colors = parseColorsList(si.color || si.filament_color || t.color, si.colors_array || t.colors_array);
  if (!colors.length) return null;
  const st = colorBg(colors, si.multicolor_type || t.multicolor_type, finishOf(si, t));
  return top ? bgWithTop(st, top) : st;
}

// Pose une couche (un degrade CSS) au-dessus d'un fond rendu par colorBg, quelle que soit sa forme.
export function bgWithTop(st, layer) {
  if (st.backgroundImage) {
    const n = st.backgroundImage.split(/,(?![^(]*\))/).length;
    return { ...st, backgroundImage: `${layer},${st.backgroundImage}`,
      backgroundSize: `100% 100%,${st.backgroundSize || Array(n).fill("100% 100%").join(",")}`,
      backgroundPosition: `0 0,${st.backgroundPosition || Array(n).fill("0 0").join(",")}`,
      backgroundRepeat: `no-repeat,${st.backgroundRepeat || Array(n).fill("no-repeat").join(",")}` };
  }
  if (st.background) return { ...st, background: `${layer},${st.background}` };
  return { ...st, backgroundImage: layer, backgroundRepeat: "no-repeat" };
}

function _withFinish(colors, type, over, finish, opts) {
  const base = _colorBg(colors, type);
  // la couche couleur (et le damier) de base, a placer sous la finition
  const img = base.backgroundImage || (base.background ? base.background : `linear-gradient(${colors[0]},${colors[0]})`);
  const nBase = base.backgroundImage ? img.split(/,(?![^(]*\))/).length : 1;
  const style = {
    backgroundColor: base.backgroundColor || colors[0],
    backgroundImage: [...over.map(l => l[0]), img].join(","),
    backgroundSize: [...over.map(l => l[1]), base.backgroundSize || "100% 100%"].join(","),
    backgroundPosition: [...over.map(l => l[2]), base.backgroundPosition || "0 0"].join(","),
    backgroundRepeat: [...over.map(l => (l[1] === "100% 100%" ? "no-repeat" : "repeat")),
      base.backgroundRepeat || Array(nBase).fill("no-repeat").join(",")].join(","),
  };
  // le phosphorescent : un halo autour (pas sur une barre)
  if (finish === "glow" && !opts.bar) style.filter = `drop-shadow(0 0 3px ${opaqueColors([colors[0]])[0]}) drop-shadow(0 0 7px ${opaqueColors([colors[0]])[0]})`;
  return style;
}

function _colorBg(colors, type) {
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
