import { create } from "zustand";

// Messages ephemeres, sans bouton : ils s'affichent en bas de l'ecran et
// disparaissent seuls. Pour ce qui ne doit PAS interrompre (ex. une mauvaise
// lecture RFID pendant un scan en serie) ; showAlert reste pour ce qui exige
// une lecture.
let seq = 0;
export const useToast = create((set, get) => ({
  items: [],   // { id, text, tone: "error" | "info" | "ok", action?: { label, onClick } }
  // action (06/11/2026) : un bouton dans le message (« ↶ Annuler » apres un geste du planning)
  show: (text, tone = "info", ms = 2000, action = null) => {
    const id = ++seq;
    // Un seul a la fois : un nouveau scan remplace le message precedent.
    set({ items: [{ id, text, tone, action }] });
    setTimeout(() => set({ items: get().items.filter(t => t.id !== id) }), ms);
  },
}));

export const toast = (text, tone, ms, action) => useToast.getState().show(text, tone, ms, action);
export const dismissToast = () => useToast.setState({ items: [] });
