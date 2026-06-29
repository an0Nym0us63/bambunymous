import { create } from "zustand";
import client from "../api/client";

export const usePrinter = create((set, get) => ({
  status: null,
  loading: false,
  error: null,
  _interval: null,

  fetch: async () => {
    try {
      const { data } = await client.get("/printer/status");
      set({ status: data, error: null });
    } catch (e) {
      set({ error: e.message });
    }
  },

  startPolling: (intervalMs = 3000) => {
    // Stopper l'intervalle existant avant d'en créer un nouveau
    const existing = get()._interval;
    if (existing) clearInterval(existing);
    get().fetch();
    const id = setInterval(() => get().fetch(), intervalMs);
    set({ _interval: id });
  },

  stopPolling: () => {
    const id = get()._interval;
    if (id) clearInterval(id);
    set({ _interval: null });
  },
}));
