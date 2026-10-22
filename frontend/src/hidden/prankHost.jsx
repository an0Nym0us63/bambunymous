import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { create } from "zustand";
import { egg, whisper } from "../eggs";
import client from "../api/client";
import { useFriend } from "../store/friend";
import { HIDDEN_SLUGS } from "./index";

// Farces (22/10/2026) : une adresse secrete affiche l'accueil, et quelque chose
// lui arrive dessus (vague, seisme, panne…). Quand la farce se termine (seule
// ou grace a un geste), le secret tombe : « p_<slug> » cote serveur.
export const PRANK_SLUGS = ["tsunami", "seisme", "tete-en-bas", "panne", "melange", "gravite", "miroir", "blizzard",
  "brouillard", "fete", "tornade", "aimant", "fantome", "pixel", "vieux-film", "glitch", "toile", "apesanteur", "vent",
  "ecran-bleu", "fourmis", "canicule", "papier", "loupe", "escargot", "aspirateur", "bulle", "taches", "domino", "ombre"];
// le grand spectacle (rien a faire, on regarde), dans leur propre lot
const PRANK_SLUGS_2 = ["eclipse", "arc-en-ciel", "marees", "meteores", "hypnose", "telex", "aurore", "chantier", "pellicule", "eboulement", "bulldozer", "ressort", "neon", "origami", "zoom-avant", "cubisme", "briques", "pluie-filament", "kaleidoscope", "vagues-texte", "projecteur", "bande-dessinee", "pluie-de-code"];
PRANK_SLUGS.push(...PRANK_SLUGS_2);
// les catastrophes (meteorite, dragon, incendie…), dans leur propre lot
const PRANK_SLUGS_5 = ["meteorite", "dragon-feu", "incendie", "eruption", "orage", "trou-noir", "enlevement", "kaiju",
  "kraken", "sables-mouvants", "ere-glaciaire", "acide"];
PRANK_SLUGS.push(...PRANK_SLUGS_5);
// celles qui demandent un geste (trouver, tirer, deverrouiller…), dans leur propre lot
const PRANK_SLUGS_3 = ["puzzle", "rideau", "cadenas", "ballons", "cache-cache", "gomme", "serrure", "carte-a-gratter", "radar", "ascenseur", "aimant-inverse", "sablier", "peche", "digicode", "souris", "interrupteurs", "boussole", "cles", "bombe", "demineur", "jardin", "cible", "bouchon"];
PRANK_SLUGS.push(...PRANK_SLUGS_3);

// les fetes : a coup sur le jour J (le serveur tient le calendrier), jamais au hasard
// les autres jours ; leur adresse marche toute l'annee
export const FETE_SLUGS = ["anniversaire", "nouvel-an", "galette", "chandeleur", "saint-valentin", "mardi-gras", "poisson-avril", "paques",
  "muguet", "fete-meres", "fete-peres", "fete-musique", "quatorze-juillet", "halloween", "beaujolais", "gta-vi", "noel",
  "vendredi-13", "changement-heure"];
// les fetes du monde (meme regle), dans leur propre lot
export const FETE_SLUGS_MONDE = ["nouvel-an-chinois", "saint-patrick", "holi", "star-wars", "dia-de-muertos", "diwali",
  "thanksgiving", "pi"];
FETE_SLUGS.push(...FETE_SLUGS_MONDE);

export const isPrank = slug => PRANK_SLUGS.includes(slug) || FETE_SLUGS.includes(slug);

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
const load = slug => (FETE_SLUGS_MONDE.includes(slug) ? import("./pranks6") : FETE_SLUGS.includes(slug) ? import("./pranks4")
  : PRANK_SLUGS_5.includes(slug) ? import("./pranks5") : PRANK_SLUGS_3.includes(slug) ? import("./pranks3")
  : PRANK_SLUGS_2.includes(slug) ? import("./pranks2") : import("./pranks"));
function effectOf(slug) {
  if (!Pranks[slug]) Pranks[slug] = lazy(() => load(slug).then(m => ({ default: m.PRANKS[slug]?.Effect || (() => null) })));
  return Pranks[slug];
}

// Surprise a l'ouverture : a la premiere arrivee sur l'accueil d'un lancement de
// l'appli (pas a chaque retour sur l'accueil), le serveur tire au sort avec un compteur
// PAR COMPTE (navigateur, PWA et appli Android confondus). Le jour d'une fete, c'est
// elle, a coup sur, une fois par compte (sans toucher au compteur). : p(n) = 0,5 % x n jusqu'a
// 10 % a n = 20, puis +1 % par ouverture ; n repart a 0 quand la surprise s'affiche.
// Puis 70 % une farce / 30 % une page cachee, et dans le lot choisi 70 % une
// pas encore trouvee / 30 % une deja trouvee (s'il y en a). Jamais chez un copain. Le secret suit la
// regle des comptes (enregistre, ou « non comptabilise »).
let rolled = false;                             // une fois par lancement (module recharge = nouveau lancement)

// Le passage secret du menu de profil reste cache jusqu'a la premiere surprise.
// Ouvert par compte (cote serveur) : il apparait sur tous ses appareils.
export const PASSAGE_KEY = "bn-passage";
function openPassage() {
  try { localStorage.setItem(PASSAGE_KEY, "1"); } catch { /* rien */ }
  client.post("/achievements/passage").then(({ data }) => {
    if (data?.new) setTimeout(() => whisper("🔮", "Un passage s'est ouvert",
      "Tu sais maintenant que l'appli a des recoins… Ton menu de profil en garde un de plus."), 11000);
  }).catch(() => {});
}

export const SURPRISE_MIX = { farce: 0.7, fresh: 0.7 };
const eggOf = (kind, slug) => (kind === "farce" ? "p_" : slug === "anonymous" || slug === "teapot" ? "" : "h_") + slug.replace(/-/g, "_");
function pickSurprise(found) {
  const kind = Math.random() < SURPRISE_MIX.farce ? "farce" : "page";
  const all = kind === "farce" ? PRANK_SLUGS : HIDDEN_SLUGS;
  const got = new Set(found || []);
  const fresh = all.filter(s => !got.has(eggOf(kind, s))), old = all.filter(s => got.has(eggOf(kind, s)));
  const lot = !old.length ? fresh : !fresh.length ? old : Math.random() < SURPRISE_MIX.fresh ? fresh : old;
  return [kind, lot[Math.floor(Math.random() * lot.length)]];
}


// L'accueil charge en plusieurs temps (imprimante, AMS, points d'attention) :
// la farce attend qu'il soit complet, sinon elle ne voit que la tuile d'attente.
// Pret = plus d'ecran de demarrage ni de tuile qui « pulse », et une page qui ne
// bouge plus d'un releve a l'autre. Au pire, on y va au bout de 6 s.
function useHomeReady(slug, onHome) {
  const [ready, setReady] = useState(null);
  useEffect(() => {
    if (!slug || !onHome) { setReady(null); return undefined; }
    let n = 0, last = "", same = 0;
    const id = setInterval(() => {
      n++;
      const main = document.querySelector("main.page-content");
      const busy = !main || document.getElementById("splash")
        || Array.from(main.querySelectorAll("[style*='pulse']")).some(el => el.getBoundingClientRect().height > 0);
      const sig = main ? main.getElementsByTagName("*").length + ":" + main.textContent.length : "";
      same = !busy && sig === last ? same + 1 : 0;
      last = sig;
      if ((n >= 3 && same >= 2) || n >= 24) { clearInterval(id); setReady(slug); }
    }, 250);
    return () => clearInterval(id);
  }, [slug, onHome]);
  return ready === slug;
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
    rolled = true;
    // l'accueil a le temps de s'afficher ; si on l'a deja quitte, pas de surprise ailleurs
    // ni sous l'ecran de demarrage (logo) : on attend qu'il soit parti
    let tries = 0;
    const fire = data => {
      if (document.getElementById("splash") && tries++ < 20) { setTimeout(() => fire(data), 300); return; }
      // une carte gagnee se fete d'abord : la surprise attend (une minute au plus)
      if (window.__bnCardFx && tries++ < 220) { setTimeout(() => fire(data), 300); return; }
      if (window.location.pathname !== "/" || usePrank.getState().slug) return;
      if (data.fete && FETE_SLUGS.includes(data.fete)) {
        // ce que la farce peut afficher : signe de l'annee lunaire, annees depuis la premiere impression
        window.__bnZodiac = data.zodiac || undefined;
        window.__bnAnniv = data.years || undefined;
        start(data.fete);
        client.post("/achievements/surprise/shown", { fete: data.fete }).catch(() => {});
      } else {
        const [kind, slug] = pickSurprise(data.found || []);
        // le serveur retient la farce tombee : c'est la seule facon d'en gagner le secret
        client.post("/achievements/surprise/shown", kind === "farce" ? { farce: slug } : {}).catch(() => {});
        if (kind === "farce") start(slug); else nav("/" + slug);
      }
      openPassage();
    };
    client.post("/achievements/surprise")
      .then(({ data }) => { if (data?.hit) setTimeout(() => fire(data), 1200); })
      .catch(() => {});
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
  const ready = useHomeReady(slug, pathname === "/");
  if (!slug || pathname !== "/" || !ready) return null;
  const Effect = effectOf(slug);
  const done = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    egg("p_" + slug.replace(/-/g, "_"));
    setTimeout(() => { if (usePrank.getState().slug === slug) stop(); }, 1500);
  };
  return <Suspense fallback={null}><Effect key={slug} done={done}/></Suspense>;
}
