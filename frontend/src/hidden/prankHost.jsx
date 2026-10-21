import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { create } from "zustand";
import { egg } from "../eggs";

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

/** Monte la farce en cours par-dessus l'accueil (dans la mise en page). */
export function PrankHost() {
  const slug = usePrank(s => s.slug);
  const stop = usePrank(s => s.stop);
  const { pathname } = useLocation();
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
