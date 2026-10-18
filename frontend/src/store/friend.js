import { create } from "zustand";
import { persist } from "zustand/middleware";

// « Chez qui ? » : null = chez moi ; sinon le copain dont on parcourt le
// BambuNymous { id, name, role }. Toute l'appli lit alors ses donnees (en
// lecture seule, avec les droits de son compte chez lui) par le relais de
// mon serveur ; seules les actions vers MES collections MakerWorld et ce qui
// concerne mon compte restent chez moi (api/client.js).
export const useFriend = create(
  persist(
    (set) => ({
      friend: null,
      // Changer de maison repart d'une page propre : aucun cache (listes,
      // fiches) ne doit melanger mes donnees et les siennes.
      visit: (f) => {
        set({ friend: f ? { id: f.id, name: f.name, role: f.role } : null });
        window.location.assign(f ? "/prints" : "/");
      },
    }),
    { name: "friend-store" }
  )
);

export const currentFriend = () => useFriend.getState().friend;
