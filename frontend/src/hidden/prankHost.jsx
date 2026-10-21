import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { create } from "zustand";
import { egg } from "../eggs";
import { useFriend } from "../store/friend";
import { HIDDEN_SLUGS } from "./index";

// Farces (22/10/2026) : une adresse secrete affiche l'accueil, et quelque chose
// lui arrive dessus (vague, seisme, panne…). Quand la farce se termine (seule
// ou grace a un geste), le secret tombe : « p_<slug> » cote serveur.
export const PRANK_SLUGS = ["tsunami", "seisme", "tete-en-bas", "panne", "melange", "gravite", "miroir", "blizzard",
  "brouillard", "fete", "tornade", "aimant", "fantome", "pixel", "vieux-film", "glitch", "toile", "apesanteur", "vent",
  "ecran-bleu", "fourmis", "canicule", "papier", "loupe", "escargot", "aspirateur", "bulle", "taches", "domino", "ombre"];

export const isPrank = slug => PRANK_SLUGS.includes(slug);

export const usePrank = create(set => ({
  slug: null,
  start: slug => set({ slug }),
  stop: () => set({ slug: null }),
}));

/** L'adresse de la farce : on la retient, puis direction l'accueil. */
export function PrankRedirect({ slug }) {
  const [go, setGo] = useState(false);
  useEffect(() => { usePrank.getState().start(slug); setGo(true); }, [slug]);
  return go ? <Navigate to="/" replace/> : null;
}

const Pranks = {};
const load = () => import("./pranks");
function effectOf(slug) {
  if (!Pranks[slug]) Pranks[slug] = lazy(() => load().then(m => ({ default: m.PRANKS[slug]?.Effect || (() => null) })));
  return Pranks[slug];
}

// Surprise a l'ouverture : a la premiere arrivee sur l'accueil d'un lancement de
// l'appli, une farce (ou une page cachee) au hasard avec la probabilite p(n) = min(7 %, 0,5 % x n), n =
// lancements depuis la derniere surprise (une toutes les ~20 ouvertures en moyenne).
// N'importe laquelle, meme deja trouvee. Jamais chez un copain. Le secret suit la
// regle des comptes (enregistre, ou « non comptabilise »).
export const SURPRISE = { step: 0.005, cap: 0.07 };
const SURPRISE_KEY = "bn-surprise";            // { n } : lancements depuis la derniere surprise
let rolled = false;                             // une fois par lancement (module recharge = nouveau lancement)

function rollSurprise() {
  if (rolled) return null;
  rolled = true;
  let n = 0;
  try { n = (JSON.parse(localStorage.getItem(SURPRISE_KEY) || "{}").n || 0) + 1; } catch { /* stockage indisponible */ }
  const p = Math.min(SURPRISE.cap, SURPRISE.step * n);
  const hit = Math.random() < p;
  try { localStorage.setItem(SURPRISE_KEY, JSON.stringify({ n: hit ? 0 : n })); } catch { /* stockage indisponible */ }
  if (!hit) return null;
  // toutes, meme deja trouvees : une farce sur l'accueil, ou un detour par une page cachee
  const pool = [...PRANK_SLUGS.map(s => ["farce", s]), ...HIDDEN_SLUGS.map(s => ["page", s])];
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Monte la farce en cours par-dessus l'accueil (dans la mise en page). */
export function PrankHost() {
  const slug = usePrank(s => s.slug);
  const stop = usePrank(s => s.stop);
  const start = usePrank(s => s.start);
  const { pathname } = useLocation();
  const visiting = useFriend(s => s.friend);
  const nav = useNavigate();
  // premiere arrivee sur l'accueil de ce lancement : la surprise, peut-etre
  useEffect(() => {
    if (pathname !== "/" || rolled || visiting || usePrank.getState().slug) return;
    const hit = rollSurprise();
    // l'accueil a le temps de s'afficher ; si on l'a deja quitte, pas de surprise ailleurs
    // ni sous l'ecran de demarrage (logo) : on attend qu'il soit parti
    let tries = 0;
    const fire = () => {
      if (document.getElementById("splash") && tries++ < 20) { setTimeout(fire, 300); return; }
      if (window.location.pathname !== "/" || usePrank.getState().slug) return;
      if (hit[0] === "farce") start(hit[1]); else nav("/" + hit[1]);
    };
    if (hit) setTimeout(fire, 1200);
  }, [pathname, visiting, start, nav]);
  const doneRef = useRef(false);
  // on QUITTE l'accueil : la farce s'arrete (et l'effet remet tout en place). Pas
  // a l'arrivee : la farce est retenue sur son adresse, juste avant d'aller a l'accueil.
  const prev = useRef(pathname);
  useEffect(() => {
    if (slug && prev.current === "/" && pathname !== "/") stop();
    prev.current = pathname;
  }, [pathname, slug, stop]);
  useEffect(() => { doneRef.current = false; }, [slug]);
  if (!slug || pathname !== "/") return null;
  const Effect = effectOf(slug);
  const done = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    egg("p_" + slug.replace(/-/g, "_"));
    setTimeout(() => { if (usePrank.getState().slug === slug) stop(); }, 1500);
  };
  return <Suspense fallback={null}><Effect key={slug} done={done}/></Suspense>;
}
