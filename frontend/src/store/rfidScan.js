import { create } from "zustand";

/**
 * Mode « scan RFID continu », GLOBAL a l'application.
 *
 * Il s'active depuis la page Filaments seulement, mais reste actif quelle que
 * soit la page : un mauvais clic qui change de page ne coupe plus le scan. Le
 * pont natif (window.BambuScan, shell Android) n'existe pas en PWA pure : tout
 * reste alors inerte (available = false).
 *
 * Tant que le mode est actif, on demande a l'ecran de ne pas se mettre en
 * veille (Screen Wake Lock, API standard du navigateur : rien a changer dans
 * l'application Android). Le verrou tombe quand l'app passe en arriere-plan ;
 * on le reprend a son retour. wakeLock vaut true / false (refuse ou non
 * supporte) / null (mode inactif).
 */
const isAvailable = () => {
  try { return !!(window.BambuScan && window.BambuScan.isAvailable() === "true"); }
  catch { return false; }
};

let lock = null;
async function acquireWakeLock() {
  try {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return false;
    lock = await navigator.wakeLock.request("screen");
    lock.addEventListener?.("release", () => { lock = null; });
    return true;
  } catch { return false; }
}
function releaseWakeLock() {
  try { lock?.release(); } catch { /* deja relache */ }
  lock = null;
}

export const useRfidScan = create((set, get) => ({
  available: isAvailable(),
  listening: false,
  wakeLock: null,

  start: async () => {
    if (!get().available || get().listening) return;
    try { window.BambuScan.startScan(); } catch { return; }
    set({ listening: true });
    set({ wakeLock: await acquireWakeLock() });
  },

  stop: () => {
    try { window.BambuScan?.stopScan(); } catch { /* pont absent */ }
    releaseWakeLock();
    set({ listening: false, wakeLock: null });
  },
}));

// Retour au premier plan : le navigateur a relache le verrou, on le reprend.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const s = useRfidScan.getState();
    if (document.visibilityState === "visible" && s.listening && !lock) {
      acquireWakeLock().then(ok => useRfidScan.setState({ wakeLock: ok }));
    }
  });
}
