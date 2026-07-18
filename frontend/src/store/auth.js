import { create } from "zustand";
import { persist } from "zustand/middleware";
import client from "../api/client";

// Roles applicatifs. Par defaut on considere "admin" : les anciens jetons (et les
// sessions ouvertes avant la mise a jour) ne portent pas de role, et on ne veut
// pas brider un administrateur par accident.
export const ROLE_ADMIN = "admin";
export const ROLE_READONLY = "readonly";
// Meme perimetre que ROLE_READONLY, mais les montants restent affiches.
export const ROLE_READONLY_PRICES = "readonly_prices";

export const useAuth = create(
  persist(
    (set, get) => ({
      token: null,
      isAuthenticated: false,
      role: ROLE_ADMIN,
      username: "",

      login: async (username, password) => {
        const form = new FormData();
        form.append("username", username);
        form.append("password", password);
        const { data } = await client.post("/auth/login", form);
        localStorage.setItem("token", data.access_token);
        set({
          token: data.access_token,
          isAuthenticated: true,
          role: data.role || ROLE_ADMIN,
          username: data.username || username,
        });
        return true;
      },

      // Rafraichit identite et role depuis le serveur (le role a pu changer, ou
      // la session dater d'avant l'ajout des roles). Silencieux en cas d'echec.
      refreshMe: async () => {
        if (!get().token) return;
        try {
          const { data } = await client.get("/auth/me");
          set({ role: data.role || ROLE_ADMIN, username: data.username || "" });
        } catch { /* backend pas encore a jour : on garde l'etat courant */ }
      },

      logout: () => {
        localStorage.removeItem("token");
        set({ token: null, isAuthenticated: false, role: ROLE_ADMIN, username: "" });
      },
    }),
    {
      name: "auth-store",
      partialize: (s) => ({
        token: s.token,
        isAuthenticated: s.isAuthenticated,
        role: s.role,
        username: s.username,
      }),
    }
  )
);

// Raccourcis pour les composants.
export const useIsAdmin    = () => useAuth((s) => (s.role || ROLE_ADMIN) === ROLE_ADMIN);
// Non-admin = lecture seule, quel que soit le role. Enumerer les roles brides
// ici ferait passer tout nouveau role pour un administrateur.
export const useIsReadOnly = () => useAuth((s) => (s.role || ROLE_ADMIN) !== ROLE_ADMIN);
