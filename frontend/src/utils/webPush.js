import client from "../api/client";

// Les notifications systeme de la PWA (Web Push, 10/11/2026) : le service worker (/sw.js) recoit ce que pousse le
// serveur et l'affiche. Sur iPhone, seulement l'appli ajoutee a l'ecran d'accueil (iOS 16.4+), et la permission ne
// se demande qu'apres un toucher.
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
export const webPushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function registerSW() {
  if (!("serviceWorker" in navigator) || typeof window.BambuScan?.pushStatus === "function") return;   // l'appli Android a son propre canal
  const go = () => navigator.serviceWorker.register("/sw.js").catch(() => { /* non pris en charge */ });
  if (document.readyState === "complete") go(); else window.addEventListener("load", go);
}

const b64ToBytes = s => { const p = "=".repeat((4 - (s.length % 4)) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, c => c.charCodeAt(0)); };

// le nom de l'appareil, pour s'y retrouver dans la liste : « iPhone · Safari », « Android · Chrome »…
export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || isIOS() ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Appareil";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return `${os}${br ? ` · ${br}` : ""}${standalone() ? " (appli)" : ""}`;
}

export async function currentSub() {
  if (!webPushSupported()) return null;
  try { const reg = await navigator.serviceWorker.getRegistration(); return reg ? await reg.pushManager.getSubscription() : null; }
  catch { return null; }
}

export async function enableWebPush() {
  if (!webPushSupported()) throw new Error("Ce navigateur ne gère pas les notifications");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications refusées : autorise-les dans les réglages du navigateur (ou de l'iPhone)" : "Permission pas accordée");
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const { data } = await client.get("/notify/webpush/key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(data.key) });
  const r = await client.post("/notify/webpush", { subscription: sub.toJSON(), name: deviceName() });
  return r.data;
}

export async function disableWebPush() {
  const sub = await currentSub();
  if (!sub) return;
  try { await client.post("/notify/devices/forget", { endpoint: sub.endpoint }); } catch { /* deja oublie */ }
  await sub.unsubscribe();
}
