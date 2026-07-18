import axios from "axios";

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
  }
  return config;
});

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
