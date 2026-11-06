import React, { useEffect } from "react";
import { create } from "zustand";
import { Home, Settings, Printer, ShoppingBag, BarChart2, Globe, ListChecks, Images, CalendarDays, Archive, Droplets, Bell, Trophy,
  BookOpen, ScrollText } from "lucide-react";
import client from "../api/client";
import { useAuth, ROLE_ADMIN } from "../store/auth";

// Le menu de chaque compte (05/11/2026) : quelles pages, dans quel ordre, et ou. Une place par entree :
//   bar     : le menu (barre laterale ; barre du bas au telephone, ce qui n'y tient pas passe dans « Plus »)
//   more    : le panneau « Plus » (au telephone) ; sous le menu, a part, sur ordinateur
//   profile : le menu du profil (la pastille du compte)
//   hidden  : nulle part (la page reste joignable par un lien, la recherche, une fiche : ce n'est pas un droit)
// Accueil reste toujours dans la barre ; Parametres ne se masque pas (barre, « Plus » ou profil : toujours joignable).

// Une bobine vue de face (flasque, noyau, brin qui part) dans le trait des autres icones : la bibliotheque n'en a
// pas, et le colis qui la remplacait ne disait rien (28/10/2026)
export const Spool = ({ size = 24, ...p }) => (
  React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2",
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", ...p },
  React.createElement("circle", { cx: "11", cy: "12", r: "8" }), React.createElement("circle", { cx: "11", cy: "12", r: "2.5" }),
  React.createElement("path", { d: "M19 12c1.5 1.5 2 4.5 2.5 8" }))
);

// le catalogue : chaque page (ou onglet) qu'on peut mettre au menu, et sa place par defaut (le menu d'avant). Les
// couleurs se distinguent entre voisines du menu (06/11/2026 : Calendrier etait violet comme Objets, MakerWorld cyan
// comme Impressions)
export const NAV_ITEMS = [
  { k: "home",      to: "/",                        icon: Home,         label: "Accueil",     c: "#3B82F6", def: "bar" },
  { k: "prints",    to: "/prints",                  icon: Printer,      label: "Impressions", c: "#06B6D4", def: "bar" },
  { k: "filaments", to: "/filaments",               icon: Spool,        label: "Filaments",   c: "#F97316", def: "bar" },
  { k: "objects",   to: "/objects",                 icon: ShoppingBag,  label: "Objets",      c: "#8B5CF6", def: "bar" },
  { k: "stats",     to: "/stats",                   icon: BarChart2,    label: "Stats",       c: "#22C55E", def: "bar" },
  { k: "settings",  to: "/settings",                icon: Settings,     label: "Paramètres",  c: "#64748B", def: "bar" },
  { k: "makerworld",to: "/prints?tab=makerworld",   icon: Globe,        label: "MakerWorld",  c: "#6366F1", def: "hidden" },
  { k: "queue",     to: "/prints?tab=queue",        icon: ListChecks,   label: "À faire",     c: "#22C55E", def: "hidden" },
  { k: "gallery",   to: "/prints?tab=gallery",      icon: Images,       label: "Galerie",     c: "#EC4899", def: "hidden" },
  { k: "calendar",  to: "/prints?tab=calendar",     icon: CalendarDays, label: "Calendrier",  c: "#F43F5E", def: "hidden" },
  { k: "archived",  to: "/filaments?tab=archived",  icon: Archive,      label: "Archivées",   c: "#64748B", def: "hidden" },
  { k: "drying",    to: "/stats?tab=drying",        icon: Droplets,     label: "Séchage",     c: "#06B6D4", def: "hidden" },
  { k: "notifications", to: "/notifications",       icon: Bell,         label: "Notifications", c: "#3B82F6", def: "profile" },
  { k: "achievements",  to: "/stats?tab=achievements", icon: Trophy,    label: "Succès",      c: "#F59E0B", def: "profile" },
  { k: "guide",     to: "/guide",                   icon: BookOpen,     label: "Guide d'utilisation", short: "Guide", c: "#3B82F6", def: "profile" },
  { k: "logs",      to: "/logs",                    icon: ScrollText,   label: "Journal",     c: "#64748B", def: "hidden", admin: true },
];
export const PLACES = [["bar", "Menu"], ["more", "Plus"], ["profile", "Profil"], ["hidden", "Masqué"]];
// les places permises : Accueil, toujours au menu ; Parametres, au menu, dans « Plus » (06/11/2026) ou dans le profil
export const placesOf = k => k === "home" ? ["bar"] : k === "settings" ? ["bar", "more", "profile"] : PLACES.map(p => p[0]);
export const MOBILE_SLOTS = 6;           // la barre du bas : 6 places (comme avant) ; au-dela, 5 et « Plus »

// la liste reglee, completee : les entrees inconnues partent, les nouvelles arrivent a leur place par defaut, a la fin
export function normalize(saved, isAdmin) {
  const byK = Object.fromEntries(NAV_ITEMS.map(i => [i.k, i]));
  const seen = new Set(), out = [];
  for (const row of (saved?.items || [])) {
    const [k, place] = Array.isArray(row) ? row : [];
    const it = byK[k];
    if (!it || seen.has(k) || (it.admin && !isAdmin)) continue;
    seen.add(k);
    out.push({ ...it, place: placesOf(k).includes(place) ? place : it.def });
  }
  for (const it of NAV_ITEMS) if (!seen.has(it.k) && !(it.admin && !isAdmin)) out.push({ ...it, place: it.def });
  // Accueil en tete de la barre
  const h = out.findIndex(x => x.k === "home");
  if (h > 0) out.unshift(out.splice(h, 1)[0]);
  return out;
}
export const pack = list => ({ v: 1, items: list.map(i => [i.k, i.place]) });

export const useNavStore = create(set => ({ saved: null, loaded: false, set: saved => set({ saved, loaded: true }) }));
let _loading = false;
export function loadNavMenu(force = false) {
  if (_loading && !force) return;
  _loading = true;
  client.get("/home/menu").then(r => useNavStore.getState().set(r.data?.menu || null))
    .catch(() => useNavStore.getState().set(null)).finally(() => { _loading = false; });
}
export function useNavMenu(isAdmin) {
  const saved = useNavStore(s => s.saved), loaded = useNavStore(s => s.loaded);
  useEffect(() => { if (!loaded) loadNavMenu(); }, [loaded]);
  return React.useMemo(() => normalize(saved, isAdmin), [saved, isAdmin]);
}

// l'entree ouverte : meme chemin ; un onglet (?tab=) la designe si une entree le porte, sinon la page elle-meme
export function isActiveItem(it, loc, visible) {
  const [p, q] = it.to.split("?");
  const here = p === "/" ? loc.pathname === "/" : loc.pathname === p || loc.pathname.startsWith(p + "/");
  if (!here) return false;
  const tab = new URLSearchParams(loc.search).get("tab");
  const mine = q ? new URLSearchParams(q).get("tab") : null;
  if (mine) return tab === mine;
  return !(tab && visible.some(o => o.k !== it.k && o.to === `${p}?tab=${tab}`));
}

// les onglets sortis de leur page (05/11/2026) : une entree deplacee au menu, dans « Plus » ou le profil (ailleurs que
// sa place par defaut) n'est plus un onglet de sa page -- MakerWorld au menu n'est plus un onglet d'Impressions. A sa
// place par defaut, ou masquee, l'onglet reste (Succes, dans le profil par defaut, reste un onglet de Stats)
// le nom de l'onglet sorti, pour le titre de la page (« MakerWorld » plutot qu'« Impressions »)
export const tabLabel = (path, tab) => NAV_ITEMS.find(i => i.to === `${path}?tab=${tab}`)?.label;
export function usePromotedTabs(path) {
  const isAdmin = useAuth(s => s.role) === ROLE_ADMIN;
  const menu = useNavMenu(isAdmin);
  return React.useMemo(() => new Set(menu.filter(i => i.place !== "hidden" && i.place !== i.def && i.to.startsWith(path + "?tab="))
    .map(i => new URLSearchParams(i.to.split("?")[1]).get("tab"))), [menu, path]);
}
