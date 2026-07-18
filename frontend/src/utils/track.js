/**
 * Suivi de la vue courante, pour le journal d'activité.
 *
 * L'application est en page unique : le serveur ne voit passer que des appels
 * d'API et ne peut deviner ni l'onglet actif, ni la fiche consultée. C'est donc
 * le front qui l'annonce, via l'en-tête X-App-Detail posé par l'intercepteur de
 * `client.js`.
 *
 * Ce module n'importe volontairement PAS `client.js` : c'est l'inverse qui a
 * lieu, et la réciproque créerait un cycle. Le client s'enregistre lui-même
 * comme émetteur au chargement.
 *
 * Les vues forment une PILE et non une valeur unique. Une fiche s'ouvre
 * par-dessus un onglet, parfois une seconde fiche par-dessus la première : avec
 * une valeur unique, refermer la fiche remettrait le détail à zéro au lieu de
 * redescendre sur l'onglet resté ouvert derrière.
 */
import { useEffect } from "react";

let stack   = [];        // [{ id, label }], le sommet est la vue affichée
let seq     = 0;
let current = null;      // sommet mémorisé, pour ne notifier qu'au changement
let beacon  = null;      // émetteur fourni par client.js
let timer   = null;

/**
 * `client.js` s'enregistre ici. Sans émetteur, le libellé continue d'être
 * transmis sur les appels ordinaires : le ping ne sert qu'aux vues qui ne
 * déclenchent aucune requête, comme un changement d'onglet.
 */
export function registerBeacon(fn) { beacon = fn; }

export function currentDetail() { return current; }

function recompute() {
  const top = stack.length ? stack[stack.length - 1].label : null;
  if (top === current) return;
  current = top;
  if (!current || !beacon) return;
  // Groupé : ouvrir une fiche depuis un onglet empile deux vues coup sur coup,
  // on n'annonce que l'état final.
  clearTimeout(timer);
  timer = setTimeout(() => { try { beacon(); } catch { /* jamais bloquant */ } }, 400);
}

export function pushDetail(label) {
  const id = ++seq;
  stack.push({ id, label: String(label).slice(0, 120) });
  recompute();
  return id;
}

export function popDetail(id) {
  stack = stack.filter(e => e.id !== id);
  recompute();
}

/**
 * Déclare une vue tant que le composant est monté, et la retire au démontage —
 * fermer une fiche fait donc retomber sur l'onglet qui était dessous, sans que
 * l'appelant ait à s'en occuper.
 *
 * `label` à null n'empile rien : pratique pour un composant qui n'est une vue
 * que dans certains cas (`useTrackDetail(open ? "Fiche X" : null)`).
 */
export function useTrackDetail(label) {
  useEffect(() => {
    if (!label) return undefined;
    const id = pushDetail(label);
    return () => popDetail(id);
  }, [label]);
}
