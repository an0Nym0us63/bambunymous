import { useEffect, useState } from "react";
import client from "../api/client";

// Les releves des capteurs (03/11/2026, 7 jours gardes par le serveur) : une requete par duree, partagee par les
// tuiles et la page Machine, relue toutes les 5 minutes (le rythme des releves hors impression). Chez un copain,
// les siens (relayes) ; un BambuNymous qui ne les garde pas encore repond 404 : rien a dessiner.
const EVERY = 300000;
// une fenetre courte (12 h au plus) se relit chaque minute : en impression, un releve arrive chaque minute
const every = hours => (hours <= 12 ? 60000 : EVERY);
const _cache = {};   // "hours|end" -> { at, p, v }

// end (ms) : une fenetre passee (remonter le temps), gardee telle quelle ; sans : jusqu'a maintenant, relue
function load(hours, end) {
  const key = `${hours}|${end || ""}`, c = _cache[key];
  if (c && (end || Date.now() - c.at < every(hours))) return c.p;
  const e = { at: Date.now(), v: c?.v ?? null };
  const params = end ? { hours, end: new Date(end).toISOString() } : { hours };
  e.p = client.get("/sensors/history", { params }).then(r => (e.v = r.data?.points || [])).catch(() => { e.at = 0; if (end) delete _cache[key]; return e.v; });
  _cache[key] = e;
  return e.p;
}

/** Les releves des dernieres heures : [{t (Date), printing, nozzle, nozzle2, bed, chamber, ams: {id: [h, t]}}], ou null. */
export function useSensorHistory(hours = 24, on = true, end = null) {
  const [v, setV] = useState(() => (on ? _cache[`${hours}|${end || ""}`]?.v ?? null : null));
  useEffect(() => {
    if (!on) return undefined;
    let dead = false;
    const go = () => load(hours, end).then(x => { if (!dead) setV(x); });
    go();
    const iv = end ? null : setInterval(() => { if (!document.hidden) go(); }, every(hours));
    return () => { dead = true; if (iv) clearInterval(iv); };
  }, [hours, on, end]);
  return v;
}
