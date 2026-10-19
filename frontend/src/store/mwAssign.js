import { create } from "zustand";

// Association d'un modele MakerWorld a des impressions : lancee depuis la fiche
// du modele (« Associer à un print »), elle bascule la page Impressions en
// selection ; une bulle en bas rappelle le modele et valide.
export const useMwAssign = create((set) => ({
  item: null,                              // { design_id, title, title_fr, cover_url }
  start: (item) => set({ item }),
  clear: () => set({ item: null }),
}));
