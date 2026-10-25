import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TAB_KEYS } from "../utils/useUrlTab";

// « Chez qui ? » : null = chez moi ; sinon le copain dont on parcourt le
// BambuNymous { id, name, role }. Toute l'appli lit alors ses donnees (en
// lecture seule, avec les droits de son compte chez lui) par le relais de
// mon serveur ; seules les actions vers MES collections MakerWorld et ce qui
// concerne mon compte restent chez moi (api/client.js).
export const useFriend = create(
  persist(
    (set) => ({
      friend: null,
      // Changer de maison repart d'une page propre (aucun cache ne doit melanger
      // mes donnees et les siennes), mais sur la MEME page : on va chez lui, ou
      // on revient, la ou on etait. Le chemin seul : un ?id= designe un element
      // d'une maison, il n'existe pas dans l'autre. Les onglets (?tab=…), eux,
      // existent des deux cotes : on les garde.
      visit: (f) => {
        set({ friend: f ? { id: f.id, name: f.name, role: f.role } : null });
        const cur = new URLSearchParams(window.location.search);
        const keep = new URLSearchParams();
        for (const k of TAB_KEYS) if (cur.get(k)) keep.set(k, cur.get(k));
        const q = keep.toString();
        window.location.assign((window.location.pathname || "/") + (q ? `?${q}` : ""));
      },
      // chez un copain, directement sur une page de chez lui (la fiche d'une impression de sa galerie…)
      visitAt: (f, path) => {
        set({ friend: f ? { id: f.id, name: f.name, role: f.role } : null });
        window.location.assign(path || "/");
      },
    }),
    { name: "friend-store" }
  )
);

export const currentFriend = () => useFriend.getState().friend;
