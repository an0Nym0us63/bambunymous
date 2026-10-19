import { create } from "zustand";
import client from "../api/client";

// Travaux en arriere-plan, hors de toute page : partages Telegram et envois de
// photos/videos. On garde la main pendant qu'ils tournent ; la puce du header
// (telephone) ou de la barre laterale (ordinateur) les suit -- ShareProgress.
// Un travail reussi disparait seul ; un echec reste jusqu'a ce qu'on le lise.
let seq = 0;

export const useShares = create((set, get) => ({
  // { id, kind: "telegram" | "upload", title, count, status: "sending" | "done" | "partial" | "error", detail }
  jobs: [],

  _add: (job) => { const j = { id: ++seq, status: "sending", detail: "", count: 1, ...job }; set({ jobs: [...get().jobs, j] }); return j.id; },
  _update: (id, patch) => set({ jobs: get().jobs.map(j => j.id === id ? { ...j, ...patch } : j) }),

  start: ({ kind, id, title, destinationIds, message, tz }) => {
    const jid = get()._add({ kind: "telegram", title, count: destinationIds.length });
    client.post(`/share/${kind}/${id}`, { destination_ids: destinationIds, message, tz },
      { timeout: 15 * 60 * 1000 })
      .then(({ data }) => {
        const ko = (data.results || []).filter(r => !r.ok);
        if (ko.length) {
          get()._update(jid, { status: "partial", detail: `Envoyé à ${data.destination}.\n\nPas envoyé :\n` + ko.map(r => r.error).join("\n") });
        } else {
          get()._update(jid, { status: "done", detail: data.destination });
          setTimeout(() => get().dismiss(jid), 5000);
        }
      })
      .catch(e => get()._update(jid, { status: "error", detail: e.response?.data?.detail || e.message }));
  },

  // Envoi d'une photo ou d'une video : `run` fait l'appel et renvoie sa
  // promesse ; on la suit et on la rend telle quelle a l'appelant.
  upload: (file, run) => {
    const video = (file.type || "").startsWith("video/");
    const mo = file.size / (1024 * 1024);
    const jid = get()._add({ kind: "upload", video,
      title: `${video ? "vidéo" : "photo"}${mo >= 1 ? ` (${mo.toFixed(mo >= 10 ? 0 : 1)} Mo)` : ""}` });
    return run()
      .then((r) => { get()._update(jid, { status: "done" }); setTimeout(() => get().dismiss(jid), 3000); return r; })
      .catch((e) => {
        get()._update(jid, { status: "error",
          detail: `${video ? "Vidéo" : "Photo"} non ajoutée : ${e.response?.data?.detail || e.message}` });
        throw e;
      });
  },

  // Publication d'une evaluation MakerWorld (envoi des photos puis de la note).
  // En file : chacune attend la fin de la precedente (le serveur les espace
  // en plus de quelques secondes), jamais deux en meme temps.
  _rateChain: Promise.resolve(),
  rate: (title, run) => {
    const jid = get()._add({ kind: "rate", title });
    const ahead = get().jobs.filter(j => j.kind === "rate" && j.status === "sending" && j.id !== jid).length;
    if (ahead) get()._update(jid, { detail: `en attente (${ahead} avant)` });
    const p = get()._rateChain.then(() => { get()._update(jid, { detail: "" }); return run(); });
    set({ _rateChain: p.catch(() => {}) });
    return p
      .then((r) => { get()._update(jid, { status: "done" }); setTimeout(() => get().dismiss(jid), 4000); return r; })
      .catch((e) => {
        get()._update(jid, { status: "error", detail: `Évaluation de « ${title} » non publiée : ${e.response?.data?.detail || e.message}` });
        throw e;
      });
  },

  dismiss: (jobId) => set({ jobs: get().jobs.filter(j => j.id !== jobId) }),
}));
