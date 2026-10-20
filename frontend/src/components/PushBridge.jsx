import { useEffect } from "react";
import client from "../api/client";
import { toast } from "../store/toast";

// Appli Android (UnifiedPush) : monte une fois dans le Layout, chez moi
// seulement. Le shell natif expose window.BambuScan.pushStatus() et previent la
// page par l'evenement « bambu-push » ({endpoint}, {removed}, {error}). Ici, on
// transmet son adresse d'envoi au serveur (inscription idempotente), une fois
// par adresse et par session ; une adresse retiree est oubliee.
export const pushApi = () => {
  const b = window.BambuScan;
  return b && typeof b.pushStatus === "function" ? b : null;
};

export function readPushStatus() {
  const b = pushApi();
  if (!b) return null;
  try { return JSON.parse(b.pushStatus() || "{}"); } catch { return null; }
}

const SENT = "pushEndpointSent";

export async function sendEndpoint(endpoint, force = false) {
  if (!endpoint) return;
  let done = null;
  try { done = sessionStorage.getItem(SENT); } catch { /* indisponible */ }
  if (done === endpoint && !force) return;
  let name = "";
  try { name = pushApi()?.deviceName?.() || ""; } catch { /* ancien shell */ }
  await client.post("/notify/devices", { endpoint, name });
  try { sessionStorage.setItem(SENT, endpoint); } catch { /* indisponible */ }
  window.dispatchEvent(new CustomEvent("bambu-push-synced"));
}

// Notifications lues sur le telephone (touchees ou balayees) : l'appli les
// garde et nous les donne ; on les marque lues dans le journal.
export const notifReloadEvent = "bambu-notif-reload";
async function flushReads() {
  let ids = [];
  try { ids = JSON.parse(pushApi()?.pushTakeReads?.() || "[]"); } catch { /* ancien shell */ }
  if (!Array.isArray(ids) || !ids.length) return;
  await client.post("/notify/me/read", { ids });
  window.dispatchEvent(new CustomEvent(notifReloadEvent));
}

export default function PushBridge() {
  // Tout compte de la maison inscrit SES telephones (Layout ne monte ce pont
  // que chez moi, jamais en visite chez un copain).
  useEffect(() => {
    if (!pushApi()) return;
    const st = readPushStatus();
    if (st?.endpoint) sendEndpoint(st.endpoint).catch(() => {});
    // Adresse changee pendant que la page etait fermee : l'ancienne est oubliee
    if (st?.previous && st.previous !== st.endpoint) {
      client.post("/notify/devices/forget", { endpoint: st.previous })
        .then(() => { try { pushApi().pushClearPrevious?.(); } catch { /* ancien shell */ } }).catch(() => {});
    }
    const on = (e) => {
      const d = e.detail || {};
      if (d.error) { toast(`Notifications de l'appli : ${d.error}`, "error", 4000); return; }
      if (d.removed) client.post("/notify/devices/forget", { endpoint: d.removed }).catch(() => {});
      if (d.endpoint) sendEndpoint(d.endpoint, true)
        .then(() => toast("Notifications activées sur ce téléphone", "success", 2500))
        .catch(err => toast(`Inscription refusée : ${err.response?.data?.detail || err.message}`, "error", 4000));
    };
    window.addEventListener("bambu-push", on);
    flushReads().catch(() => {});
    const reads = () => flushReads().catch(() => {});
    const vis = () => { if (document.visibilityState === "visible") reads(); };
    window.addEventListener("bambu-reads", reads);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("bambu-push", on);
      window.removeEventListener("bambu-reads", reads);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  return null;
}
