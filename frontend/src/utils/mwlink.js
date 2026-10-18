// Liens MakerWorld : sur Android, au choix de l'appareil, ouverture dans
// l'application Bambu Handy (lien « intent » avec repli sur le navigateur si
// elle n'est pas installee). Reglage propre a cet appareil (localStorage).
const KEY = "mwOpenInHandy";
const HANDY = "bbl.intl.bambulab.com";

export const isAndroid = () => /android/i.test(navigator.userAgent || "");

export function handyPref() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setHandyPref(on) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* navigation privee */ }
}

export function mwHref(url) {
  if (!url || !isAndroid() || !handyPref()) return url;
  try {
    const u = new URL(url);
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=${HANDY};`
      + `S.browser_fallback_url=${encodeURIComponent(url)};end`;
  } catch { return url; }
}
