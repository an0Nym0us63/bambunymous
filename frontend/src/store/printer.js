import { create } from "zustand";
import client from "../api/client";

// Onglet cache : on ne relit plus l'imprimante, et on la relit des qu'il revient.
let _wake = null;

export const usePrinter = create((set, get) => ({
  status: null,
  loading: false,
  error: null,
  _interval: null,
  _raw: null,

  fetch: async () => {
    try {
      const { data } = await client.get("/printer/status");
      // la meme reponse qu'il y a 3 s (imprimante au repos) : rien a redessiner
      const raw = JSON.stringify(data);
      if (raw === get()._raw && !get().error) return;
      set({ status: data, error: null, _raw: raw });
    } catch (e) {
      // imprimante injoignable : la meme erreur qu'il y a 3 s ne redessine rien
      if (get().error !== e.message) set({ error: e.message });
    }
  },

  startPolling: (intervalMs = 3000) => {
    // Stopper l'intervalle existant avant d'en créer un nouveau
    const existing = get()._interval;
    if (existing) clearInterval(existing);
    get().fetch();
    const id = setInterval(() => { if (!document.hidden) get().fetch(); }, intervalMs);
    set({ _interval: id });
    if (!_wake) {
      _wake = () => { if (!document.hidden && get()._interval) get().fetch(); };
      document.addEventListener("visibilitychange", _wake);
    }
  },

  stopPolling: () => {
    const id = get()._interval;
    if (id) clearInterval(id);
    set({ _interval: null });
  },
}));
