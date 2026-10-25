import React, { Suspense, lazy } from "react";
import { importRetry } from "../utils/importRetry";

// Pages cachees : adresse -> lot (charge a la demande, rien dans l'appli tant
// qu'on ne tombe pas dessus). Une adresse inconnue reste « page introuvable ».
const GROUPS = {
  scenes: ["matrice", "quarante-deux", "benchy", "generique", "neant", "retro", "zen", "disco", "envers", "cafe",
           "labo", "musee", "horloge", "aquarium", "neige", "volcan"],
  arcade: ["buse-volante", "super-bambu", "serpent", "casse-briques", "taupe", "tour", "dragon", "ovni", "fusee",
           "bulles", "feux", "reflexe"],
  puzzles: ["bambulab", "pilule", "coffre", "labyrinthe", "memoire", "morpion", "simon", "pendu", "calcul", "piano",
            "etoiles", "chat", "tresor", "des", "pile-ou-face", "morse", "taquin", "bobine", "lune", "pluie"],
  // lot du 23/10/2026 : geek, atelier d'impression, amour
  geek: ["hal-9000", "terminal", "binaire", "pixel-art", "invaders", "hacker", "loading", "captcha"],
  atelier: ["plateau", "premiere-couche", "sechoir", "purge", "supports", "slicer", "tri-ams", "buse-bouchee"],
  amour: ["coeur", "cupidon", "je-t-aime", "rendez-vous", "bouquet", "lettre", "etoile-filante", "calin", "fleur"],
  spectacle: ["feu-de-camp", "cinema", "planetarium", "timelapse", "orchestre", "vinyle", "ascii", "ciel-polaire"],
  defis: ["radio", "cryptex", "sudoku", "laser", "nonogramme", "mastermind", "hanoi", "dactylo", "enigme"],
  fantaisie: ["fortune", "machine-a-cafe", "chien", "plante", "photomaton", "horoscope", "dessin", "boite-a-musique"],
};
const LOADERS = {
  scenes: () => import("./scenes"),
  arcade: () => import("./arcade"),
  puzzles: () => import("./puzzles"),
  geek: () => import("./geek"),
  atelier: () => import("./atelier"),
  amour: () => import("./amour"),
  spectacle: () => import("./spectacle"),
  defis: () => import("./defis"),
  fantaisie: () => import("./fantaisie"),
};
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, slugs]) => slugs.map(s => [s, g])));
const CACHE = {};

export const isHidden = slug => !!GROUP_OF[slug];
// toutes les pages cachees (pour la surprise a l'ouverture), /anonymous et /teapot compris
export const HIDDEN_SLUGS = [...Object.keys(GROUP_OF), "anonymous", "teapot"];

function pageFor(slug) {
  if (!CACHE[slug]) {
    CACHE[slug] = lazy(() => importRetry(LOADERS[GROUP_OF[slug]]).then(m => ({ default: m.PAGES[slug] || (() => null) })));
  }
  return CACHE[slug];
}

export default function HiddenPage({ slug }) {
  const Page = pageFor(slug);
  return (
    <Suspense fallback={<div style={{ minHeight:"calc(100dvh - 140px)", borderRadius:18, background:"#0b0b14" }}/>}>
      <Page/>
    </Suspense>
  );
}
