import client from "../api/client";

// La mesure du retour au premier plan (07/11/2026) : apres une capture d'ecran sur Android, la page restait blanche
// quelques secondes. A chaque retour (et a chaque trou de plus de 2,5 s dans la page visible), on note pendant 8 s :
// le temps avant la premiere image, le plus long trou entre deux images, et les taches longues de la page (le code
// qui occupe le telephone). Le resultat part au serveur (Parametres > Outils > Vitesse du serveur). Rien d'autre.
// Long trou + taches longues : c'est le code de l'appli ; long trou sans taches : c'est le dessin.
let running = false;

function probe(why, extra = {}) {
  if (running || !localStorage.getItem("token")) return;
  running = true;
  const t0 = performance.now();
  const tasks = [];
  let first = null, last = t0, maxGap = 0, frames = 0, obs = null;
  try {
    obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const a = e.attribution && e.attribution[0];
        tasks.push({ d: Math.round(e.duration), at: Math.round(e.startTime - t0), n: String((a && (a.containerSrc || a.containerName || a.name)) || e.name || "").slice(0, 80) });
      }
    });
    obs.observe({ type: "longtask", buffered: true });
  } catch { obs = null; }
  const raf = () => {
    const now = performance.now();
    if (first == null) first = now - t0;
    maxGap = Math.max(maxGap, now - last);
    last = now;
    frames += 1;
    if (now - t0 < 8000) requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  setTimeout(() => {
    try { obs?.disconnect(); } catch { /* rien */ }
    running = false;
    const mine = tasks.filter(t => t.at >= -3000);
    client.post("/settings/perf/client", {
      why, path: location.pathname, ua: navigator.userAgent,
      first_frame: first == null ? -1 : Math.round(first), max_gap: Math.round(maxGap), frames,
      long_n: mine.length, long_ms: mine.reduce((s, t) => s + t.d, 0),
      top: [...mine].sort((a, b) => b.d - a.d).slice(0, 5), ...extra,
    }).catch(() => {});
  }, 8000);
}

export function installResumeProbe() {
  let hiddenAt = null;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = performance.now();
    else probe("retour", { hidden_ms: hiddenAt == null ? -1 : Math.round(performance.now() - hiddenAt) });
  });
  document.addEventListener("resume", () => probe("reprise"));                  // page gelee puis relancee (Chrome)
  window.addEventListener("pageshow", e => { if (e.persisted) probe("pageshow"); });
  // un trou dans une page visible (une capture qui ne la cache pas) : le minuteur d'une seconde a pris du retard
  let tick = performance.now();
  setInterval(() => {
    const now = performance.now(), gap = now - tick;
    tick = now;
    if (!document.hidden && gap > 2500) probe("trou", { gap: Math.round(gap) });
  }, 1000);
}
