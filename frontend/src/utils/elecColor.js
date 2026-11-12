import { useEffect, useState } from "react";
import client from "../api/client";

// (12/11/2026) la couleur d'un libelle de tarif electrique : celle choisie dans Parametres › Connexions › Home Assistant,
// sinon une couleur par defaut (Tempo, sa couleur ; heures creuses, indigo ; pleines, ambre)
// (12/11/2026) trois rangees : les bleus, les blancs et gris, les rouges et chaudes -- de quoi faire chaque couleur
// Tempo en clair (heures creuses) et en fonce (heures pleines). Jamais #3B82F6 tel quel : la page des parametres
// restyle tout bouton de ce bleu (degrade, arrondi), une pastille de ce bleu devenait ronde.
export const ELEC_PALETTE = [
  "#1E3A8A", "#1D4ED8", "#2F7FF0", "#60A5FA", "#BFDBFE", "#06B6D4", "#14B8A6", "#22C55E",
  "#FFFFFF", "#F1F5F9", "#E2E8F0", "#CBD5E1", "#94A3B8", "#64748B", "#334155", "#0F172A",
  "#7F1D1D", "#B91C1C", "#EF4444", "#F87171", "#FECACA", "#F97316", "#EAB308", "#A855F7",
];
let MAP = {}, loading = null;
const subs = new Set();

export function setElecColors(m) {
  MAP = { ...(m || {}) };
  subs.forEach(f => f(MAP));
}

export function loadElecColors(force = false) {
  if (!loading || force) loading = client.get("/settings/ha/colors").then(r => setElecColors(r.data?.colors)).catch(() => {});
  return loading;
}

// a appeler dans un composant qui affiche des libelles : il se redessine quand les couleurs arrivent ou changent
export function useElecColors() {
  const [m, setM] = useState(MAP);
  useEffect(() => { subs.add(setM); loadElecColors(); return () => { subs.delete(setM); }; }, []);
  return m;
}

export function elecDefault(l) {
  const s = String(l || "").toLowerCase();
  const hc = /hc|creuse/.test(s), hp = /hp|pleine/.test(s);
  // Tempo : la couleur du jour, claire en heures creuses, foncee en heures pleines
  if (s.includes("rouge") || s.includes("red")) return hc ? "#F87171" : hp ? "#B91C1C" : "#EF4444";
  if (s.includes("blanc") || s.includes("white")) return hc ? "#F1F5F9" : hp ? "#94A3B8" : "#CBD5E1";
  if (s.includes("bleu") || s.includes("blue")) return hc ? "#60A5FA" : hp ? "#1D4ED8" : "#2F7FF0";
  if (hc) return "#6366F1";
  if (hp) return "#F59E0B";
  return "#14B8A6";
}

export function elecColor(l) {
  return MAP[l] || elecDefault(l);
}
