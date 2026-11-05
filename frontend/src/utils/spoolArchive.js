// Archiver une bobine en disant pourquoi (05/11/2026) : « finie » mesure la derive du suivi (ce qui lui restait chez
// nous), « jetee » ou « autre » non. Rend true si elle a ete archivee.
import client from "../api/client";
import { showChoice, showAlert } from "./dialog";

export async function archiveSpool(s) {
  const left = s.remaining_weight_g != null ? Math.round(s.remaining_weight_g) : null;
  const reason = await showChoice(
    `Archiver la bobine #${s.id} ? Elle passera en Archives avec une quantité remise à 0 et sortira du stock. Pourquoi ?`,
    [
      { value: "finie", icon: "🏁", label: "Elle est finie", tone: "#22C55E",
        hint: left ? `Il lui restait ${left} g chez nous : ce sera l'écart du suivi` : "Mesure la précision du suivi" },
      { value: "jetee", icon: "🗑", label: "Jetée, abîmée", tone: "#F97316", hint: "Pas de mesure de précision" },
      { value: "autre", icon: "📦", label: "Autre raison", tone: "#64748B", hint: "Donnée, prêtée… pas de mesure" },
    ], { title: "Archiver" });
  if (!reason) return false;
  try {
    await client.delete(`/filaments/spools/${s.id}`, { params: { reason } });
    return true;
  } catch (e) {
    showAlert(e.response?.data?.detail || e.message);
    return false;
  }
}

// Pourquoi une mesure est ecartee des stats de precision
export const DRIFT_OFF = [
  { value: "Jetée en partie", icon: "🗑", label: "Jetée en partie", tone: "#F97316" },
  { value: "Prêtée", icon: "🤝", label: "Prêtée à un copain", tone: "#8B5CF6" },
  { value: "Mal initialisée", icon: "⚖", label: "Poids de départ faux", tone: "#EF4444" },
  { value: "Autre cause", icon: "❔", label: "Autre cause", tone: "#64748B" },
];

export const DRIFT_KIND = { relais: "relais de l'AMS", suite: "suite choisie à la main", archive: "archivée finie", main: "corrigée à la main",
  historique: "déduit de l'historique" };
// les bobines archivees avant le suivi : ecart deduit, ecarte des stats tant qu'on ne l'y fait pas entrer
export const isPast = it => it.kind === "historique" || it.drift_kind === "historique";

// « +12 g » / « −8 g »
export const driftTxt = g => { const r = Math.round(g); return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r)} g`; };
