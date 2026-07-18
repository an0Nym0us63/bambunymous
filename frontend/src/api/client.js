import axios from "axios";
import { currentDetail, registerBeacon, isActive } from "../utils/track";

const client = axios.create({ baseURL: "/api/v1" });

// Inject token + page courante
client.interceptors.request.use((config) => {
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

// Auto-logout on 401
client.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default client;
