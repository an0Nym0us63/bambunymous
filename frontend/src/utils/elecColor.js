import { useEffect, useState } from "react";
import client from "../api/client";

// (12/11/2026) la couleur d'un libelle de tarif electrique : celle choisie dans Parametres › Connexions › Home Assistant,
// sinon une couleur par defaut (Tempo, sa couleur ; heures creuses, indigo ; pleines, ambre)
export const ELEC_PALETTE = ["#3B82F6", "#0EA5E9", "#06B6D4", "#14B8A6", "#22C55E", "#84CC16", "#EAB308", "#F59E0B",
  "#F97316", "#EF4444", "#EC4899", "#A855F7", "#6366F1", "#94A3B8", "#64748B", "#334155"];
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
  if (s.includes("rouge") || s.includes("red")) return "#EF4444";
  if (s.includes("blanc") || s.includes("white")) return "#94A3B8";
  if (s.includes("bleu") || s.includes("blue")) return "#3B82F6";
  if (/\bhc\b|creuse/.test(s)) return "#6366F1";
  if (/\bhp\b|pleine/.test(s)) return "#F59E0B";
  return "#14B8A6";
}

export function elecColor(l) {
  return MAP[l] || elecDefault(l);
}
