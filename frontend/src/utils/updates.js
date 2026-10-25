import { useEffect, useState } from "react";
import client from "../api/client";
import { pushApi } from "../components/PushBridge";

// Une mise a jour en attente (25/10/2026) : BambuNymous (nouveautes sur master, pour l'admin, qui
// met l'image a jour) ou l'appli Android (plus recente que celle installee, dans l'appli seulement).
// Une seule lecture partagee, la pastille de Parametres. Relue toutes les 5 min tant que la page est
// visible, au retour sur l'onglet, et tout de suite quand Parametres verifie la version (25/10/2026 :
// gardee 30 min, elle ne bougeait qu'avec un F5).
const KEEP_MS = 5 * 60 * 1000;
let last = null, at = 0, p = null, who = null;
const subs = new Set();

async function read(admin) {
  const out = { server: 0, android: false };
  const jobs = [];
  if (admin) {
    jobs.push(client.get("/version/check").then(({ data }) => {
      if (data && !data.dev && !data.error) out.server = data.behind || 0;
    }).catch(() => {}));
  }
  if (pushApi()) {
    jobs.push(fetch("/android/version.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).then(v => {
      let mine = null;
      try { mine = JSON.parse(window.BambuScan?.getConfig?.() || "{}").versionCode ?? null; } catch { /* navigateur */ }
      // une appli trop ancienne ne dit pas sa version : elle est forcement a mettre a jour
      out.android = !!v && v.code != null && (mine == null || Number(mine) < Number(v.code));
    }).catch(() => {}));
  }
  await Promise.all(jobs);
  return out;
}

function refresh(admin, force = false) {
  if (!force && p && who === admin && Date.now() - at < KEEP_MS) return p;
  who = admin;
  at = Date.now();
  p = read(admin).then(d => { last = d; subs.forEach(f => f(d)); return d; });
  return p;
}

// { server: nombre de nouveautes, android: vrai si l'appli est a mettre a jour, any }
export function useUpdates(admin) {
  const [d, setD] = useState(last);
  useEffect(() => {
    let alive = true;
    const f = x => alive && setD(x);
    subs.add(f);
    refresh(!!admin).then(f);
    const wake = () => { if (!document.hidden) refresh(!!admin); };
    document.addEventListener("visibilitychange", wake);
    const iv = setInterval(wake, KEEP_MS);
    return () => { alive = false; subs.delete(f); clearInterval(iv); document.removeEventListener("visibilitychange", wake); };
  }, [admin]);
  const server = d?.server || 0, android = !!d?.android;
  return { server, android, any: server > 0 || android };
}

// relire tout de suite (Parametres vient de verifier la version, une mise a jour vient de se faire)
export function refreshUpdates() { return refresh(!!who, true); }

// le texte de l'infobulle
export function updatesTip(u) {
  return [u.server > 0 && `BambuNymous : ${u.server} nouveauté${u.server > 1 ? "s" : ""} à installer`,
    u.android && "Appli Android : une mise à jour est disponible"].filter(Boolean).join(" · ");
}
