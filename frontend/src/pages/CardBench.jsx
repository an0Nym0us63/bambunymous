import React, { Suspense, lazy, useState } from "react";

// Banc d'essai de la fete des cartes (developpement seulement) : chaque rang, et plusieurs cartes
// a la fois. Les rangs sont ceux du serveur (CARD_TIERS, services/achievements.py).
const Show = lazy(() => import("../components/CardFxShow"));
const T = {
  v: { id: "card_v", label: "Valet", emoji: "🃏", color: "#CD7F32", card: "V" },
  d: { id: "card_d", label: "Dame", emoji: "🃏", color: "#6EC6D9", card: "D" },
  r: { id: "card_r", label: "Roi", emoji: "🃏", color: "#0D9488", card: "R" },
  a: { id: "card_a", label: "As", emoji: "🃏", color: "#111827", card: "A" },
  jv: { id: "card_jv", label: "Joker des Valets", emoji: "🃏", color: "#CD7F32", card: "★" },
  jd: { id: "card_jd", label: "Joker des Dames", emoji: "🃏", color: "#6EC6D9", card: "★" },
  jr: { id: "card_jr", label: "Joker des Rois", emoji: "🃏", color: "#0D9488", card: "★" },
  ja: { id: "card_ja", label: "Joker d'or", emoji: "🃏", color: "#D4A017", card: "★" },
};
const card = (k, name, emoji = "🖨️") => ({ id: `bench_${k}_${name}`, name, emoji, at: "2026-10-23T12:00:00", tier: T[k] });
const ORDER = ["v", "d", "r", "a", "jv", "jd", "jr", "ja"];
// comme le serveur : la plus haute en tete
const sorted = cs => [...cs].sort((x, y) => ORDER.indexOf(y.tier.id.slice(5)) - ORDER.indexOf(x.tier.id.slice(5)));
const CASES = [
  ...ORDER.map(k => ({ label: T[k].label, cards: [card(k, `${T[k].label} · Imprimeur`)] })),
  { label: "Plusieurs : Valet, Dame et Roi", cards: sorted([card("v", "Valet · Filaments", "🧵"), card("d", "Dame · Photos", "📸"), card("r", "Roi · Imprimeur")]) },
  { label: "Plusieurs : deux Valets et un As", cards: sorted([card("v", "Valet · Objets", "📦"), card("v", "Valet · Copains", "🤝"), card("a", "As · Imprimeur")]) },
  { label: "Plusieurs : un Roi et le Joker d'or", cards: sorted([card("r", "Roi · MakerWorld", "🌐"), card("ja", "Joker d'or", "🃏")]) },
  { label: "Plusieurs : six cartes", cards: sorted(["v", "v", "d", "d", "r", "jv"].map((k, i) => card(k, `${T[k].label} · ${["Filaments", "Objets", "Photos", "Copains", "Jeu", "Valets"][i]}`, "🎴"))) },
];

export default function CardBench() {
  const [cards, setCards] = useState(null);
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
      <b style={{ color: "var(--text)", fontSize: 18 }}>Banc de la fête des cartes</b>
      <span style={{ color: "var(--muted)", fontSize: 13 }}>Un clic rejoue la cérémonie ; elle se ferme comme dans l'appli.</span>
      {CASES.map(c => (
        <button key={c.label} onClick={() => setCards(c.cards)} style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)",
          background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 14, textAlign: "left", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "inline-flex", gap: 3 }}>{c.cards.map((x, i) => <span key={i} style={{ width: 18, height: 24, borderRadius: 4, background: x.tier.color,
            color: "#fff", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{x.tier.card}</span>)}</span>
          {c.label}
        </button>
      ))}
      {cards && <Suspense fallback={null}><Show key={JSON.stringify(cards.map(c => c.id))} cards={cards} onClose={() => setCards(null)}/></Suspense>}
    </div>
  );
}
