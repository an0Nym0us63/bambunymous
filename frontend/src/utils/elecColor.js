// (12/11/2026) la couleur d'un libelle de tarif electrique : Tempo, sa couleur ; heures creuses, indigo ; pleines, ambre
export function elecColor(l) {
  const s = String(l || "").toLowerCase();
  if (s.includes("rouge") || s.includes("red")) return "#EF4444";
  if (s.includes("blanc") || s.includes("white")) return "#94A3B8";
  if (s.includes("bleu") || s.includes("blue")) return "#3B82F6";
  if (/\bhc\b|creuse/.test(s)) return "#6366F1";
  if (/\bhp\b|pleine/.test(s)) return "#F59E0B";
  return "#14B8A6";
}
