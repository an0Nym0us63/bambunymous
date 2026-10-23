// Les tris de « À faire » (page et tuile de l'accueil). Par defaut : l'ordre de priorite,
// celui de la liste ; les autres disent ce qu'on peut lancer tout de suite avec les
// bobines chargees (plateaux prets, leurs heures, leurs grammes).
export const QUEUE_SORTS = [
  ["prio", "par priorité"],
  ["nplates", "le plus de plateaux faisables maintenant"],
  ["nhours", "le plus d'heures faisables maintenant"],
  ["ngrams", "le plus de grammes faisables maintenant"],
  ["ready", "la plus grande part prête"],
];

// « le plus pret » : pret AMS, puis en partie (la part des plateaux prets), puis stock OK, puis ce qui manque
const readiness = r => ({ ams: 3, partial: 2, stock: 1, short: 0 }[r.status] ?? -1)
  + (r.status === "partial" && r.plates_count ? (r.plates_ready?.length || 0) / r.plates_count : 0);
const now = (r, k) => r.ready_now?.[k] || 0;
const CMP = {
  ready: (a, b) => readiness(b) - readiness(a),
  nplates: (a, b) => now(b, "plates") - now(a, "plates") || readiness(b) - readiness(a),
  nhours: (a, b) => now(b, "seconds") - now(a, "seconds") || readiness(b) - readiness(a),
  ngrams: (a, b) => now(b, "weight_g") - now(a, "weight_g") || readiness(b) - readiness(a),
};

// la liste triee (une copie) ; « prio » ou un tri inconnu la rend telle quelle
export const sortQueue = (rows, by) => (CMP[by] ? [...rows].sort(CMP[by]) : rows);

// Ou j'en suis des plateaux retenus, en series : on peut refaire un modele des mois plus tard. La serie en
// cours est celle d'apres le plateau le moins imprime ; un plateau est « fait » s'il l'a ete plus que lui.
// counts : nombre d'impressions par plateau. Rend { serie, faits, total, complete, base, label }.
export function plateRound(counts) {
  const c = (counts || []).map(n => Math.max(0, Number(n) || 0));
  const total = c.length;
  if (!total) return null;
  const base = Math.min(...c), top = Math.max(...c);
  if (base === top) {
    // tout au meme point : rien de fait (0/n), ou une serie complete (n/n, ×k)
    return { serie: base, faits: base ? total : 0, total, complete: base > 0, base,
      label: base ? `${total}/${total} faits${base > 1 ? ` ×${base}` : ""}` : `0/${total} faits` };
  }
  const faits = c.filter(n => n > base).length;
  return { serie: base + 1, faits, total, complete: false, base,
    label: base ? `${base + 1}e série : ${faits}/${total} faits` : `${faits}/${total} faits` };
}
// un plateau compte comme fait dans la serie en cours
export const plateDoneInRound = (n, r) => !!r && (r.complete ? n > 0 : (Number(n) || 0) > r.base);
