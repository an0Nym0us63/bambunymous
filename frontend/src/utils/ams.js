// Identite et libelles des unites AMS -- un seul endroit pour l'accueil, le
// detail et les reglages. Trois copies avaient deja diverge (un tableau
// indexe d'un cote, un dictionnaire de l'autre) et aucune ne connaissait l'HT.
//
// Numerotation de la machine :
//   0..3     AMS 4 slots (AMS-A..D)
//   128..135 AMS HT, 1 slot (HT-A..H)
//   255      pseudo-AMS des bobines externes, fabrique cote serveur
export const EXT_AMS_ID = 255;
export const HT_BASE_ID = 128;

export const isExternal = (id) => id === EXT_AMS_ID;
export const isHt = (id) => id >= HT_BASE_ID && id < HT_BASE_ID + 8;

const letter = (n) => String.fromCharCode(65 + n);

export function amsName(id) {
  if (isExternal(id)) return "Externe";
  if (isHt(id)) return `HT-${letter(id - HT_BASE_ID)}`;
  if (id >= 0 && id < 26) return `AMS-${letter(id)}`;
  return `AMS ${id}`;
}

// Etiquette de slot : A1, B3, E1/E2 pour l'externe. Un HT n'a qu'un slot :
// "HT-A1" n'apprendrait rien, on garde son nom seul.
export function slotLabel(amsId, trayId) {
  if (isHt(amsId)) return amsName(amsId);
  if (isExternal(amsId)) return `E${trayId + 1}`;
  if (amsId >= 0 && amsId < 26) return `${letter(amsId)}${trayId + 1}`;
  return `${amsId}.${trayId + 1}`;
}

// L'aiguillage (Filament Track Switch) : la buse ou va chaque entree, telle qu'on peut s'y fier.
// L'imprimante envoie pour chaque sortie un numero de buse (out_a, out_b ; 1 = gauche, 0 = droite).
// Releve sur une H2C le 23/10/2026 : celle de l'entree qui imprime suit le vrai chemin (A passe a 1
// quand la buse gauche imprime depuis A) ; celle de l'entree au repos garde parfois la meme buse
// que l'autre (A et B a 0), ce qui ne veut rien dire : l'entree au repos va forcement sur l'autre
// buse. Quand les deux sorties se confondent, l'entree qui imprime garde la sienne et l'autre prend
// l'autre buse ; sans impression, on ne sait pas laquelle croire : aucune.
export function switchRoutes(status) {
  const fs = status?.fila_switch;
  if (!fs?.installed) return fs || null;
  const live = ["RUNNING", "PAUSE", "PAUSED", "PREPARE"].includes(String(status?.status || "").toUpperCase());
  const port = live ? (status?.ams_list || []).find(a => a.id === status?.active_ams_id)?.switch_port || null : null;
  let { out_a, out_b } = fs;
  if (out_a != null && out_a === out_b) {
    if (port === "A") out_b = out_a === 1 ? 0 : 1;
    else if (port === "B") out_a = out_b === 1 ? 0 : 1;
    else { out_a = null; out_b = null; }
  }
  return { ...fs, out_a: out_a ?? null, out_b: out_b ?? null };
}

// Nombre de slots qu'une unite occupe en largeur sur l'accueil. On le deduit
// de ses bacs reels quand on les a, sinon de sa nature.
export function slotCount(ams) {
  const n = ams?.trays?.length;
  if (n) return n;
  if (isHt(ams?.id)) return 1;
  if (isExternal(ams?.id)) return 2;
  return 4;
}

// ── Disposition de l'accueil ────────────────────────────────────────────────
// La grille a les dimensions choisies dans les reglages (lignes x colonnes) et
// chaque unite y est rangee par SA CASE {id, row, col} (0 = premiere). Ranger
// par case et non par un numero de position fait qu'en changeant le nombre de
// lignes, les unites ne se melangent pas : elles restent ou elles sont.
export const MAX_LIGNES = 4;
export const MAX_COLONNES = 8;

const entier = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

// Relit ce que le serveur rend : la forme {rows, cols, cells} d'aujourd'hui, ou
// l'ancienne liste de positions lue colonne par colonne sur deux lignes
// ([0] haut col. 1, [1] bas col. 1...). Une case hors grille, une unite placee
// deux fois ou deux unites sur une case : seule la premiere compte.
export function lireDisposition(brut) {
  let rows, cols, liste = [];
  if (Array.isArray(brut)) {
    rows = 2;
    cols = Math.max(1, Math.ceil(brut.length / 2));
    brut.forEach((id, i) => { if (id != null) liste.push({ id, row: i % 2, col: Math.floor(i / 2) }); });
  } else if (brut && typeof brut === "object") {
    rows = entier(brut.rows, 1, MAX_LIGNES) ?? 2;
    cols = entier(brut.cols, 1, MAX_COLONNES) ?? 2;
    liste = Array.isArray(brut.cells) ? brut.cells : [];
  } else {
    return null;
  }
  const cells = [], ids = new Set(), prises = new Set();
  for (const c of liste) {
    const row = entier(c?.row, 0, rows - 1), col = entier(c?.col, 0, cols - 1);
    if (row == null || col == null || !Number.isInteger(c?.id)) continue;
    const k = `${row},${col}`;
    if (ids.has(c.id) || prises.has(k)) continue;
    ids.add(c.id); prises.add(k);
    cells.push({ id: c.id, row, col });
  }
  if (!cells.length) return null;
  return { rows, cols, cells };
}

// Disposition sans reglage : une rangee jusqu'a quatre unites, deux lignes
// au-dela -- ce que faisait l'accueil avant qu'on puisse choisir.
export function dispositionParDefaut(n) {
  const rows = n <= 4 ? 1 : 2;
  return { rows, cols: Math.max(1, Math.ceil(n / rows)), cells: [] };
}

// Grille de l'accueil : une liste de COLONNES, chacune de `rows` cases (unite
// ou null). Les unites rangees vont dans leur case ; les autres (un AMS
// branche depuis, une unite jamais rangee) prennent les cases libres colonne
// par colonne, puis des colonnes en plus : une unite ne disparait jamais
// faute de place. Les lignes et colonnes entierement vides sont retirees,
// elles creuseraient un trou sans rien porter.
export function grilleAccueil(amsList, disposition) {
  const d = disposition ?? dispositionParDefaut(amsList.length);
  const byId = new Map(amsList.map(a => [a.id, a]));
  const rows = d.rows;
  const grille = Array.from({ length: d.cols }, () => Array(rows).fill(null));
  const places = new Set();
  for (const c of d.cells) {
    const a = byId.get(c.id);
    if (!a) continue;
    grille[c.col][c.row] = a;
    places.add(a.id);
  }
  let col = 0, row = 0;
  for (const a of amsList) {
    if (places.has(a.id)) continue;
    while (grille[col]?.[row]) {
      row++;
      if (row >= rows) { row = 0; col++; }
    }
    if (!grille[col]) grille[col] = Array(rows).fill(null);
    grille[col][row] = a;
  }
  const lignesUtiles = [...Array(rows).keys()].filter(r => grille.some(c => c[r]));
  return grille
    .filter(c => c.some(Boolean))
    .map(c => lignesUtiles.map(r => c[r]));
}

// Largeur relative d'une colonne : le plus large de ses occupants, au moins
// trois slots. Une colonne d'AMS vaut 4, une colonne HT + Externe vaut 3 :
// les pastilles gardent la meme largeur d'une colonne a l'autre, au lieu
// qu'un HT seul s'etale sur la largeur d'un AMS complet. Le plancher de 3
// laisse au nom et aux mesures (humidite, temperature) la place de tenir.
export function columnWeight(col) {
  return Math.max(3, ...col.filter(Boolean).map(slotCount));
}
