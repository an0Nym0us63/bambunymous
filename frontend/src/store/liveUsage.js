import { create } from "zustand";
import { useEffect } from "react";
import client from "../api/client";
import { currentFriend } from "./friend";

// Le suivi couche par couche de l'impression en cours (alpha, 02/11/2026), partage par tout ce qui montre le poids
// d'une bobine (tuiles, AMS, fiches) : une seule requete toutes les 15 s, tant qu'au moins un d'eux est affiche et que
// la page est visible. Sur « Actuel », le serveur repond « off » : on ne redemande qu'apres une minute.
const EVERY = 15000, OFF_EVERY = 60000;
export const useLiveStore = create(() => ({ d: null }));
let users = 0, timer = null, busy = false;

async function tick() {
  timer = null;
  if (!users) return;
  let wait = EVERY;
  if (document.visibilityState === "visible" && !currentFriend() && !busy) {
    busy = true;
    try {
      const { data } = await client.get("/live/current");
      useLiveStore.setState({ d: data?.on ? data : null });
      if (!data?.on) wait = OFF_EVERY;
    } catch { /* hors ligne : on garde le dernier etat */ }
    finally { busy = false; }
  }
  if (users) timer = setTimeout(tick, wait);
}

function useLiveFeed() {
  useEffect(() => {
    users++;
    if (!timer && !busy) tick();
    return () => { users--; if (!users && timer) { clearTimeout(timer); timer = null; } };
  }, []);
}

// l'etat de l'impression en cours (ou null)
export function useLiveCurrent() {
  useLiveFeed();
  return useLiveStore(s => s.d);
}

// la bobine qui sert maintenant a l'impression en cours : {now (poids maintenant), target (a la fin), row_used,
// row_planned, ...} ; null si elle n'y sert pas (ou sur « Actuel »)
export function useLiveSpool(spoolId) {
  useLiveFeed();
  return useLiveStore(s => (spoolId && (s.d?.items || []).find(i => i.spool_id === spoolId && i.current && i.now != null)) || null);
}
