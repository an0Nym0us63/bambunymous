import axios from "axios";
import { currentDetail, registerBeacon, isActive } from "../utils/track";
import { currentFriend } from "../store/friend";

// Chez un copain : les LECTURES de ses donnees passent par le relais de mon
// serveur (/friends/{id}/p/...). Restent chez moi : mon compte et mes
// reglages, la fiche MakerWorld (enrichie de MES impressions et de MON stock),
// « deja chez moi ? », et toute ecriture -- chez lui je ne peux rien ecrire,
// une ecriture est donc forcement une action sur MES collections MakerWorld.
const HOME_PREFIXES = ["/auth", "/friends", "/users", "/settings", "/notify",
  "/makerworld/mine", "/makerworld/model/", "/makerworld/similar/", "/makerworld/design/",
  // Mes evaluations (file de publication, messages tout faits) : toujours chez moi.
  "/makerworld/rate-queue", "/makerworld/rate-templates"];
// Le ping d'activite part chez le copain visite : son journal suit ma visite.
const isHome = (url) => !url.startsWith("/users/activity/ping") && HOME_PREFIXES.some(p => url === p || url.startsWith(p.endsWith("/") ? p : p + "/") || url.startsWith(p + "?"));

/** URL d'une image (ou d'un fichier) de l'API, chez moi ou chez le copain
 *  visite. Une <img> n'envoie pas d'en-tete : le relais recoit le jeton en _t. */
export function apiUrl(path) {
  const f = currentFriend();
  if (!f) return `/api/v1${path}`;
  const t = localStorage.getItem("token") || "";
  return `/api/v1/friends/${f.id}/p${path}${path.includes("?") ? "&" : "?"}_t=${encodeURIComponent(t)}`;
}

/** La vignette d'une image de l'API (le serveur la redimensionne, en WebP) : pour les
 *  listes, tuiles et mosaiques. Les visionneuses plein ecran gardent l'original. */
export function apiThumb(url, w = 256) {
  if (!url || typeof url !== "string" || !url.startsWith("/api/v1/") || /\.(mp4|webm|mov|m4v|gif)(\?|$)/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${w}`;
}

const client = axios.create({ baseURL: "/api/v1" });

// Inject token + page courante
client.interceptors.request.use((config) => {
  const f = currentFriend();
  const url = config.url || "";
  if (f && !config.home && (config.method || "get").toLowerCase() === "get" && !isHome(url)) {
    config.url = `/friends/${f.id}/p${url.startsWith("/") ? url : "/" + url}`;
  }
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // L'application est en page unique : le serveur ne voit aucune navigation et
  // ne peut pas deduire la page depuis l'endpoint (/filaments/filaments est
  // appele depuis quatre pages differentes). On la lui annonce donc. Le
  // middleware ne journalise qu'au changement de page, l'en-tete peut donc
  // partir sur tous les appels sans rien encombrer.
  // Meme origine que l'API (baseURL /api/v1) : pas de prevol CORS.
  if (typeof window !== "undefined") {
    config.headers["X-App-Page"] = window.location.pathname || "/";
    // Onglet actif ou fiche ouverte, quand le front en declare un. Encode en
    // URI : un en-tete HTTP est limite a l'ASCII et les libelles ont des
    // accents. Le serveur decode et ne journalise qu'au changement.
    const d = currentDetail();
    if (d) config.headers["X-App-Detail"] = encodeURIComponent(d);
    // Marque les requetes emises alors que quelqu'un est reellement devant :
    // le serveur ne rafraichit last_seen que sur celles-la.
    if (isActive()) config.headers["X-App-Active"] = "1";
  }
  return config;
});

// Un changement d'onglet ou l'ouverture d'une fiche deja chargee ne provoquent
// aucun appel reseau : sans ce ping, ces vues n'existeraient pas pour le
// serveur. La requete est vide, son seul role est de porter les en-tetes.
registerBeacon(() => { client.get("/users/activity/ping").catch(() => {}); });

// Chez un copain, ses reponses contiennent des adresses « /api/v1/... »
// (photos, fichiers) qui pointeraient chez moi : on les fait passer par le relais.
const rewrite = (v) => {
  if (typeof v === "string") return v.startsWith("/api/v1/") ? apiUrl(v.slice(7)) : v;
  if (Array.isArray(v)) return v.map(rewrite);
  if (v && typeof v === "object") { for (const k of Object.keys(v)) v[k] = rewrite(v[k]); return v; }
  return v;
};

// Auto-logout on 401
client.interceptors.response.use(
  (r) => { if (/^\/friends\/[^/]+\/p\//.test(r.config?.url || "") && r.data && typeof r.data === "object") rewrite(r.data); return r; },
  (err) => {
    // Sauf pour la connexion elle-meme : son 401 est une REPONSE (mauvais mot de
    // passe, ou code de double authentification demande) que l'ecran affiche.
    // Rediriger rechargeait la page et effacait le formulaire.
    if (err.response?.status === 401 && !(err.config?.url || "").endsWith("/auth/login")) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// Une meme lecture demandee par plusieurs tuiles au meme moment (27/10/2026 : l'accueil lancait 57 appels
// dont l'etat de l'imprimante 4 fois, les bobines 3 fois…) : la seconde attend la reponse de la premiere au
// lieu d'en relancer une. La reponse reste valable 1,5 s (les tuiles arrivent en deux vagues a ~100 ms) ;
// chaque tuile qui s'y joint recoit sa propre copie (aucune ne modifie les donnees d'une autre) ; une ecriture
// vide la table (une lecture lancee apres elle repart du serveur). Pas pour un appel annulable, ni un fichier.
const SHARE_MS = 1500;
const _inflight = new Map();
const _clone = v => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const _get = client.get.bind(client);
client.get = (url, config = {}) => {
  if (config.signal || config.onDownloadProgress || (config.responseType && config.responseType !== "json"))
    return _get(url, config);
  const key = JSON.stringify([currentFriend()?.id || "", url, config.params || null, !!config.home]);
  const hit = _inflight.get(key);
  if (hit && !hit.done) return hit.p.then(r => ({ ...r, data: _clone(hit.copy) }));
  if (hit && hit.r && Date.now() < hit.until) return Promise.resolve({ ...hit.r, data: _clone(hit.copy) });
  const e = { done: false, copy: undefined, r: null, until: 0 };
  e.p = _get(url, config).then(r => {
    // avant que la premiere tuile ne touche a la reponse : une copie intacte pour les suivantes
    e.copy = _clone(r.data);
    e.r = r;
    e.until = Date.now() + SHARE_MS;
    e.done = true;
    setTimeout(() => { if (_inflight.get(key) === e) _inflight.delete(key); }, SHARE_MS);
    return r;
  }, err => {
    e.done = true;
    if (_inflight.get(key) === e) _inflight.delete(key);
    throw err;
  });
  _inflight.set(key, e);
  return e.p;
};
client.interceptors.request.use(config => {
  if ((config.method || "get").toLowerCase() !== "get") _inflight.clear();
  return config;
});

// Une photo d'impression ou de groupe ajoutee, retiree ou mise en avant : on le dit a toute
// l'appli (les photos a joindre a une evaluation, l'apercu d'un partage ouvert se relisent).
export const PHOTOS_CHANGED = "bn-photos-changed";
client.interceptors.response.use(r => {
  const m = (r.config?.method || "get").toLowerCase(), u = r.config?.url || "";
  if (m !== "get" && /^\/?prints\/(groups\/)?\d+\/(photos?|upload)/.test(u.replace(/^\/api\/v1/, "")))
    window.dispatchEvent(new CustomEvent(PHOTOS_CHANGED));
  return r;
});

export default client;
