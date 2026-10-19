import { create } from "zustand";
import { persist } from "zustand/middleware";
import client from "../api/client";
import { useFriend } from "./friend";

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
      mwWrite: false,         // droit d'agir sur MakerWorld (relu par refreshMe)

      // otp : code de l'application (ou code de secours) si le compte a la
      // double authentification ; le serveur repond 401 « 2FA_REQUIRED » sinon.
      login: async (username, password, otp) => {
        const form = new FormData();
        form.append("username", username);
        form.append("password", password);
        if (otp) form.append("otp", otp);
        const { data } = await client.post("/auth/login", form);
        localStorage.setItem("token", data.access_token);
        set({
          token: data.access_token,
          isAuthenticated: true,
          role: data.role || ROLE_ADMIN,
          username: data.username || username,
        });
        get().refreshMe();
        return true;
      },

      // Rafraichit identite et role depuis le serveur (le role a pu changer, ou
      // la session dater d'avant l'ajout des roles). Silencieux en cas d'echec.
      refreshMe: async () => {
        if (!get().token) return;
        try {
          const { data } = await client.get("/auth/me");
          set({ role: data.role || ROLE_ADMIN, username: data.username || "",
                mwWrite: data.mw_write ?? ((data.role || ROLE_ADMIN) === ROLE_ADMIN) });
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
        mwWrite: s.mwWrite,
      }),
    }
  )
);

// Libelles des roles. Ils vivent ici et non dans Settings : le menu profil du
// layout en a besoin aussi, et deux copies auraient fini par diverger.
export const ROLE_OPTIONS = [
  [ROLE_ADMIN,           "Administrateur"],
  [ROLE_READONLY,        "Lecture seule"],
  [ROLE_READONLY_PRICES, "Lecture seule (avec prix)"],
];
export const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS);
export const ROLE_BADGE = {
  [ROLE_ADMIN]:           "Admin",
  [ROLE_READONLY]:        "Lecture seule",
  [ROLE_READONLY_PRICES]: "Lecture seule + prix",
};

// Raccourcis pour les composants.
// Role effectif : chez un copain, celui de mon compte chez lui (jamais admin).
export const useRole = () => {
  const mine = useAuth((s) => s.role || ROLE_ADMIN);
  const friend = useFriend((s) => s.friend);
  return friend ? (friend.role || ROLE_READONLY) : mine;
};
export const effectiveRole = () => {
  const f = useFriend.getState().friend;
  return f ? (f.role || ROLE_READONLY) : (useAuth.getState().role || ROLE_ADMIN);
};
export const useIsAdmin    = () => useRole() === ROLE_ADMIN;
// Non-admin = lecture seule, quel que soit le role. Enumerer les roles brides
// ici ferait passer tout nouveau role pour un administrateur.
export const useIsReadOnly = () => useRole() !== ROLE_ADMIN;
// Mes droits A MOI (actions sur mes collections MakerWorld, meme chez un copain).
export const useIsHomeAdmin = () => useAuth((s) => (s.role || ROLE_ADMIN) === ROLE_ADMIN);
// Droit MakerWorld (j'aime, collections, boosts, evaluations, « A faire »...) :
// administrateur, ou case cochee sur le compte. « Home » : sur mon compte
// MakerWorld, meme en visite chez un copain ; sinon pas en visite (ses donnees).
export const useCanMwHome = () => useAuth((s) => (s.role || ROLE_ADMIN) === ROLE_ADMIN || !!s.mwWrite);
export const useCanMw = () => { const home = useCanMwHome(); const friend = useFriend((s) => s.friend); return home && !friend; };
