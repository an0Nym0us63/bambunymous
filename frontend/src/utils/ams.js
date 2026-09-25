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
// L'ordre enregistre est une liste de positions lue colonne par colonne, sur
// deux lignes : [0] haut de la colonne 1, [1] bas de la colonne 1, [2] haut
// de la colonne 2... Une position peut valoir null (case laissee vide). C'est
// exactement la semantique des 4 positions d'origine, prolongee : un reglage
// deja enregistre se relit tel quel.
export const LAYOUT_ROWS = 2;

// Place les unites dans la grille : celles de l'ordre enregistre a leur
// position, les autres (un AMS branche depuis, une unite jamais placee) a la
// suite, dans les premieres cases libres apres la derniere placee. Sans ca,
// un AMS ajoute n'apparaitrait nulle part tant qu'on ne l'a pas range.
// Une position qui designe une unite absente reste vide.
export function layoutCells(amsList, order) {
  const byId = new Map(amsList.map(a => [a.id, a]));
  const cells = (order || []).map(id => (id != null && byId.has(id) ? byId.get(id) : null));
  const placed = new Set(cells.filter(Boolean).map(a => a.id));
  let i = cells.reduce((last, c, k) => (c ? k + 1 : last), 0);
  for (const a of amsList) {
    if (placed.has(a.id)) continue;
    while (cells[i]) i++;
    cells[i++] = a;
  }
  // Colonnes entierement vides retirees : elles creuseraient un trou dans
  // l'accueil sans rien porter.
  const cols = [];
  for (let c = 0; c * LAYOUT_ROWS < cells.length; c++) {
    const col = cells.slice(c * LAYOUT_ROWS, (c + 1) * LAYOUT_ROWS);
    while (col.length < LAYOUT_ROWS) col.push(null);
    if (col.some(Boolean)) cols.push(col);
  }
  return cols;
}

// Largeur relative d'une colonne : le plus large de ses occupants, au moins
// trois slots. Une colonne d'AMS vaut 4, une colonne HT + Externe vaut 3 :
// les pastilles gardent la meme largeur d'une colonne a l'autre, au lieu
// qu'un HT seul s'etale sur la largeur d'un AMS complet. Le plancher de 3
// laisse au nom et aux mesures (humidite, temperature) la place de tenir.
export function columnWeight(col) {
  return Math.max(3, ...col.filter(Boolean).map(slotCount));
}
