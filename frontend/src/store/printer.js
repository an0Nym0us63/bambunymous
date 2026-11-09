import { create } from "zustand";
import client from "../api/client";
import { useFriend, currentFriend } from "./friend";

// Onglet cache : on ne relit plus l'imprimante, et on la relit des qu'il revient.
let _wake = null;

// (09/11/2026) l'etat en direct : un flux du serveur (/printer/stream) envoie l'etat entier a l'ouverture, puis seulement
// ce qui change, des que l'imprimante l'envoie (avant : /status relu en entier toutes les 3 s, 28 Ko). La relecture
// toutes les 3 s reste le filet : elle reprend des que le flux tombe, ne demarre pas (relais chez un copain, proxy qui
// le retient, navigateur sans flux) ou se tait plus de 40 s ; le flux est retente plus tard. Rien ne se perd.
const live = { ctrl: null, alive: false, retry: null, dog: null, failures: 0 };

function stopLive() {
  if (live.ctrl) { try { live.ctrl.abort(); } catch { /* deja ferme */ } }
  live.ctrl = null; live.alive = false;
  clearTimeout(live.retry); clearTimeout(live.dog);
}

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

  // le flux : chaque message est l'etat entier ({full}) ou ses parties changees ({patch}) ; les parties non touchees
  // gardent leur objet (ce qui ne lit que les AMS ne se redessine pas quand seule la progression avance)
  _openLive: async () => {
    stopLive();
    const token = localStorage.getItem("token");
    if (!token || currentFriend() || typeof ReadableStream === "undefined" || document.hidden) return;
    const ctrl = new AbortController();
    live.ctrl = ctrl;
    const fail = () => {
      if (live.ctrl !== ctrl) return;
      stopLive();
      live.failures += 1;
      // le filet reprend tout de suite ; le flux est retente plus tard (de moins en moins souvent s'il ne passe jamais)
      if (get()._interval) {
        get().fetch();
        live.retry = setTimeout(() => { if (get()._interval && !live.ctrl) get()._openLive(); }, Math.min(300000, 30000 * live.failures));
      }
    };
    // rien recu : 10 s pour le premier message, 40 s ensuite (le serveur en envoie un toutes les 15 s au plus)
    const silence = () => { clearTimeout(live.dog); live.dog = setTimeout(fail, live.alive ? 40000 : 10000); };
    silence();
    try {
      const r = await fetch("/api/v1/printer/stream", { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal, cache: "no-store" });
      if (!r.ok || !r.body) { fail(); return; }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split("\n").find(l => l.startsWith("data: "));
          if (!line || live.ctrl !== ctrl) continue;
          let m;
          try { m = JSON.parse(line.slice(6)); } catch { continue; }
          live.alive = true; live.failures = 0;
          silence();
          if (m.full) set({ status: m.full, error: null, _raw: null });
          else if (m.patch && get().status) set({ status: { ...get().status, ...m.patch }, error: null, _raw: null });
          else if (m.patch) get().fetch();
        }
      }
      fail();                     // le serveur a ferme (redemarrage) : le filet, puis le flux plus tard
    } catch {
      fail();
    }
  },

  startPolling: (intervalMs = 3000) => {
    // Stopper l'intervalle existant avant d'en créer un nouveau
    const existing = get()._interval;
    if (existing) clearInterval(existing);
    get().fetch();
    // le filet : ne relit que quand le flux ne vit pas
    const id = setInterval(() => { if (!document.hidden && !live.alive) get().fetch(); }, intervalMs);
    set({ _interval: id });
    get()._openLive();
    if (!_wake) {
      _wake = () => {
        if (!get()._interval) return;
        if (document.hidden) { stopLive(); return; }       // onglet cache : le flux se ferme
        get().fetch();
        if (!live.ctrl) get()._openLive();
      };
      document.addEventListener("visibilitychange", _wake);
      // chez un copain (ou de retour chez soi) : l'etat a suivre change, le flux suit (il ne vit que chez soi)
      useFriend.subscribe((s, prev) => {
        if (s.friend?.id === prev?.friend?.id || !get()._interval) return;
        stopLive(); set({ _raw: null }); get().fetch(); get()._openLive();
      });
    }
  },

  stopPolling: () => {
    const id = get()._interval;
    if (id) clearInterval(id);
    set({ _interval: null });
    stopLive();
  },
}));
