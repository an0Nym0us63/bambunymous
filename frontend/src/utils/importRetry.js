// Un morceau d'appli charge a la demande (page, effet) dont le fichier n'existe plus : l'appli
// est restee ouverte pendant une mise a jour, et l'ancienne version reclame un nom de fichier
// remplace. Sans filet, React efface tout : page blanche, et un rafraichissement « repare ».
// On recharge donc l'appli une fois, sur l'adresse demandee, qui arrive alors avec la bonne
// version. Un deuxieme echec juste apres n'est plus une affaire de version : il remonte.
const KEY = "bn-chunk-reload";
const WINDOW_MS = 30000;

const recently = () => {
  try { return Date.now() - Number(sessionStorage.getItem(KEY) || 0) < WINDOW_MS; } catch { return true; }
};

export function reloadForUpdate() {
  if (recently()) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { return false; }
  window.location.reload();
  return true;
}

export function importRetry(load) {
  return load().catch(err => {
    // pendant le rechargement, rien ne s'affiche (une promesse qui ne se resout pas)
    if (reloadForUpdate()) return new Promise(() => {});
    throw err;
  });
}

// Le meme filet pour les chargements prepares par Vite (feuilles de style, dependances)
export function installChunkReload() {
  window.addEventListener("vite:preloadError", e => { if (reloadForUpdate()) e.preventDefault(); });
}
