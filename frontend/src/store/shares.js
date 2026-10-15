import { create } from "zustand";
import client from "../api/client";

// Envois Telegram en cours, hors de toute page : la fenetre de partage rend la
// main tout de suite et l'envoi continue pendant qu'on navigue. La pastille du
// Layout (ShareProgress) les affiche. Un envoi reussi disparait seul ; un
// echec (meme partiel) reste jusqu'a ce qu'on le lise.
let seq = 0;

export const useShares = create((set, get) => ({
  jobs: [],   // { id, title, count, status: "sending" | "done" | "partial" | "error", detail }

  start: ({ kind, id, title, destinationIds, message, tz }) => {
    const job = { id: ++seq, title, count: destinationIds.length, status: "sending", detail: "" };
    set({ jobs: [...get().jobs, job] });
    const update = (patch) => set({ jobs: get().jobs.map(j => j.id === job.id ? { ...j, ...patch } : j) });
    client.post(`/share/${kind}/${id}`, { destination_ids: destinationIds, message, tz },
      { timeout: 15 * 60 * 1000 })
      .then(({ data }) => {
        const ko = (data.results || []).filter(r => !r.ok);
        if (ko.length) {
          update({ status: "partial", detail: `Envoyé à ${data.destination}.\n\nPas envoyé :\n` + ko.map(r => r.error).join("\n") });
        } else {
          update({ status: "done", detail: data.destination });
          setTimeout(() => get().dismiss(job.id), 5000);
        }
      })
      .catch(e => update({ status: "error", detail: e.response?.data?.detail || e.message }));
  },

  dismiss: (jobId) => set({ jobs: get().jobs.filter(j => j.id !== jobId) }),
}));
