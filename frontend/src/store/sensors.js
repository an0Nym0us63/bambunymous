import { useEffect, useState } from "react";
import client from "../api/client";

// Les releves des capteurs (03/11/2026, 7 jours gardes par le serveur) : une requete par duree, partagee par les
// tuiles et la page Machine, relue toutes les 5 minutes (le rythme des releves hors impression). Chez un copain,
// les siens (relayes) ; un BambuNymous qui ne les garde pas encore repond 404 : rien a dessiner.
const EVERY = 300000;
const _cache = {};   // hours -> { at, p, v }

function load(hours) {
  const c = _cache[hours];
  if (c && Date.now() - c.at < EVERY) return c.p;
  const e = { at: Date.now(), v: c?.v ?? null };
  e.p = client.get("/sensors/history", { params: { hours } }).then(r => (e.v = r.data?.points || [])).catch(() => { e.at = 0; return e.v; });
  _cache[hours] = e;
  return e.p;
}

/** Les releves des dernieres heures : [{t (Date), printing, nozzle, nozzle2, bed, chamber, ams: {id: [h, t]}}], ou null. */
export function useSensorHistory(hours = 24, on = true) {
  const [v, setV] = useState(() => (on ? _cache[hours]?.v ?? null : null));
  useEffect(() => {
    if (!on) return undefined;
    let dead = false;
    const go = () => load(hours).then(x => { if (!dead) setV(x); });
    go();
    const iv = setInterval(() => { if (!document.hidden) go(); }, EVERY);
    return () => { dead = true; clearInterval(iv); };
  }, [hours, on]);
  return v;
}
