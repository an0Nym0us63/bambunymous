// La vue des succes allegee (06/11/2026) : le serveur ne l'envoie qu'a qui la demande (?slim=1) ; chaque palier y perd
// le libelle, l'emoji et la couleur identiques a sa definition commune (data.tiers), et « ticket » quand il est faux.
// Ici, a la lecture, tout est remis : le reste de l'appli voit la vue complete, comme avant. Une vue complete (un
// serveur d'avant, chez un copain) passe telle quelle.
export const ACH_PARAMS = { slim: 1 };
// l'accueil (07/11/2026) : la vue reduite a ce que ses pastilles et tuiles affichent (~26 Ko au lieu de ~750) ; un
// serveur d'avant l'ignore et renvoie la complete, qui se lit pareil
export const ACH_HOME = { slim: 1, view: "home" };

export function achExpand(data) {
  if (!data || !data.slim || !Array.isArray(data.items)) return data;
  const defs = {};
  for (const t of data.tiers || []) if (t && t.id != null) defs[t.id] = t;
  const items = data.items.map(it => !it || !Array.isArray(it.tiers) ? it : {
    ...it,
    tiers: it.tiers.map(t => {
      const g = t && defs[t.id];
      return g ? { label: g.label, emoji: g.emoji, color: g.color, ticket: false, ...t } : t;
    }),
  });
  const out = { ...data, items };
  delete out.slim;
  return out;
}
