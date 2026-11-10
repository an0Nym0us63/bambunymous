import { useAuth } from "../store/auth";
import { currentFriend } from "../store/friend";

// Le dernier planning lu, garde dans ce navigateur (06/11/2026), par compte et par BambuNymous visite : le calendrier
// l'affiche aussitot, le frais le remplace en une seconde. Efface a la deconnexion (bn_tiles_snap*).
// (10/11/2026) seulement s'il a moins de 30 min (un planning de plusieurs jours, montre le temps de la synchro,
// deroutait) ; et chaque lecture du planning le garde (accueil, « A faire », calendrier), pas seulement le calendrier.
export const PD_FRESH_MS = 30 * 60000;
const pdKey = () => { try { return `bn_tiles_snap_plan:${useAuth.getState().username || ""}:${currentFriend()?.id || "me"}`; } catch { return null; } };
export const pdStored = () => {
  try { const o = JSON.parse(localStorage.getItem(pdKey()) || "null"); return o && Date.now() - (o.at || 0) < PD_FRESH_MS && o.pd?.jobs ? o.pd : null; }
  catch { return null; }
};
let pdSaveT = null, pdLast = [];
// les plateaux du dernier planning lu, en memoire : la carte au survol d'un plateau y trouve les autres du meme objet
export const pdJobs = () => pdLast;
export const pdStore = pd => {
  if (!pd?.jobs) return;
  pdLast = pd.jobs;
  const k = pdKey();
  clearTimeout(pdSaveT);
  pdSaveT = setTimeout(() => {
    try { const v = JSON.stringify({ at: Date.now(), pd }); if (v.length < 600000) localStorage.setItem(k, v); } catch { /* plein ou indisponible */ }
  }, 1500);
};
