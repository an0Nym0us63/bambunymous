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
