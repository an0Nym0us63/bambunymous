import { create } from "zustand";
import client from "../api/client";

// Travaux en arriere-plan, hors de toute page : partages Telegram et envois de
// photos/videos. On garde la main pendant qu'ils tournent ; la puce du header
// (telephone) ou de la barre laterale (ordinateur) les suit -- ShareProgress.
// Un travail reussi disparait seul ; un echec reste jusqu'a ce qu'on le lise.
let seq = 0;
// Echec d'une publication : la liste « A evaluer » se relit (le modele y revient).
let onRateFailed = null;
export function setOnRateFailed(fn) { onRateFailed = fn; }

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

  // Evaluations MakerWorld : la file vit sur le SERVEUR (une a la fois,
  // espacees) ; ici on n'en montre que l'etat, relu au demarrage puis toutes
  // les 3 s tant qu'il en reste. Quitter la page ou recharger ne perd rien.
  rate: async (body, designId, title) => {
    await client.post(`/makerworld/rate/${designId}`, { ...body, title });
    get().syncRates();
  },
  // Oublier (sans evaluer) les fiches a faire d'un modele : meme file.
  forgetRating: async (designId, ratingIds, title) => {
    await client.post(`/makerworld/rate/${designId}/forget`, { rating_ids: ratingIds, title });
    get().syncRates();
  },
  _ratePoll: null,
  _rateSeen: {},                // job serveur -> statut deja vu (echecs signales une fois)
  syncRates: async () => {
    let jobs;
    try { ({ data: { jobs } } = await client.get("/makerworld/rate-queue")); } catch { return; }
    const others = get().jobs.filter(j => j.kind !== "rate");
    const seen = { ...get()._rateSeen };
    const shown = [];
    const queued = jobs.filter(j => j.status === "queued").length;
    for (const j of jobs) {
      const prev = seen[j.id];
      seen[j.id] = j.status;
      if (j.status === "done") {
        if (prev && prev !== "done") shown.push({ id: `r${j.id}`, kind: "rate", forget: j.action === "forget", title: j.title, status: "done", detail: "", count: 1, sid: j.id });
        continue;
      }
      if (j.status === "error") {
        shown.push({ id: `r${j.id}`, kind: "rate", forget: j.action === "forget", title: j.title, status: "error", count: 1, sid: j.id,
          detail: j.action === "forget" ? `« ${j.title} » non oublié : ${j.detail}` : `Évaluation de « ${j.title} » non publiée : ${j.detail}` });
        if (prev && prev !== "error") onRateFailed?.();
        continue;
      }
      // Une seule puce pour la file : celle en cours, avec le nombre restant.
      if (j.status === "sending") shown.push({ id: `r${j.id}`, kind: "rate", forget: j.action === "forget", title: j.title, status: "sending", count: queued + 1, sid: j.id,
        detail: queued ? `${queued} en attente` : "" });
    }
    set({ jobs: [...others, ...shown], _rateSeen: seen });
    shown.filter(j => j.status === "done").forEach(j => setTimeout(() => get().dismiss(j.id), 4000));
    const active = jobs.some(j => j.status === "queued" || j.status === "sending");
    if (active && !get()._ratePoll) set({ _ratePoll: setInterval(() => get().syncRates(), 3000) });
    if (!active && get()._ratePoll) { clearInterval(get()._ratePoll); set({ _ratePoll: null }); }
  },

  dismiss: (jobId) => {
    const j = get().jobs.find(x => x.id === jobId);
    if (j?.sid && j.status === "error") client.delete(`/makerworld/rate-queue/${j.sid}`).catch(() => {});
    set({ jobs: get().jobs.filter(x => x.id !== jobId) });
  },
}));
