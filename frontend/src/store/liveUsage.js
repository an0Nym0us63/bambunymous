import { create } from "zustand";
import { useEffect } from "react";
import client from "../api/client";
import { currentFriend, useFriend } from "./friend";

// Le suivi couche par couche de l'impression en cours (alpha, 02/11/2026), partage par tout ce qui montre le poids
// d'une bobine (tuiles, AMS, fiches) : une seule requete toutes les 15 s, tant qu'au moins un d'eux est affiche et que
// la page est visible. Sur « Actuel », le serveur repond « off » : on ne redemande qu'apres une minute.
// En visite chez un copain (03/11/2026), son suivi a lui (le client passe par son serveur) : avant, rien n'etait lu en
// visite, et les poids estimes, la barre et la cible ne s'affichaient pas chez lui. Changer de serveur (aller chez un
// copain, en revenir) vide l'etat, pour ne jamais montrer les bobines de l'un chez l'autre.
const EVERY = 15000, OFF_EVERY = 60000;
export const useLiveStore = create(() => ({ d: null, who: null }));
let users = 0, timer = null, busy = false;
const whoNow = () => { const f = currentFriend(); return f ? `f${f.id}` : "me"; };
useFriend.subscribe(() => {
  if (useLiveStore.getState().who !== whoNow()) {
    useLiveStore.setState({ d: null, who: whoNow() });
    if (users) refreshLive();
  }
});

async function tick() {
  timer = null;
  if (!users) return;
  let wait = EVERY;
  if (document.visibilityState === "visible" && !busy) {
    busy = true;
    const who = whoNow();
    try {
      const { data } = await client.get("/live/current");
      // (la reponse d'un serveur quitte entre-temps est ignoree)
      if (who === whoNow()) useLiveStore.setState({ d: data?.on ? data : null, who });
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

// relire tout de suite (apres un changement de bobine), sans attendre les 15 s
export function refreshLive() {
  if (busy) return;
  if (timer) { clearTimeout(timer); timer = null; }
  tick();
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
