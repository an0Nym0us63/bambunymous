// Ce qu'on vient de changer ici sur MakerWorld (j'aime, collections) se voit
// tout de suite dans les listes, meme en cache. Pendant quelques minutes, ces
// changements sont aussi reappliques a ce que renvoie le serveur : MakerWorld
// peut mettre un moment a refleter une ecriture.
const TTL = 3 * 60 * 1000;
const likes = new Map();    // design_id -> { liked, item, t }
const member = new Map();   // design_id -> { ids: Set, item, t }
const subs = new Set();

const live = o => o && Date.now() - o.t < TTL;
const emit = () => subs.forEach(f => { try { f(); } catch { /* rien */ } });

export function onMwChange(f) { subs.add(f); return () => subs.delete(f); }

// item : la tuile du modele (titre, couverture…), pour l'ajouter a une liste.
export function mwLiked(designId, liked, item) {
  likes.set(String(designId), { liked: !!liked, item: item?.design_id ? item : null, t: Date.now() });
  emit();
}

export function mwCollections(designId, ids, item) {
  member.set(String(designId), { ids: new Set(ids.map(String)), item: item?.design_id ? item : null, t: Date.now() });
  emit();
}

// Applique les changements recents a une liste en cache ou fraiche.
export function mwPatch(key, data) {
  if (!data?.items || !key) return data;
  let items = data.items, wants, adds;
  if (key === "likes") {
    wants = (id) => { const o = likes.get(id); return live(o) ? o.liked : null; };
    adds = [...likes.entries()].filter(([, o]) => live(o) && o.liked && o.item);
  } else if (key.startsWith("coll:")) {
    const cid = key.slice(5);
    wants = (id) => { const o = member.get(id); return live(o) ? o.ids.has(cid) : null; };
    adds = [...member.entries()].filter(([, o]) => live(o) && o.ids.has(cid) && o.item);
  } else return data;
  items = items.filter(x => wants(String(x.design_id)) !== false);
  const have = new Set(items.map(x => String(x.design_id)));
  const extra = adds.filter(([id]) => !have.has(id)).map(([, o]) => o.item);
  if (extra.length === 0 && items.length === data.items.length) return data;
  return { ...data, items: [...extra, ...items] };
}
