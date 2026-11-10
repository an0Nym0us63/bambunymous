// BambuNymous : le service worker de la PWA (10/11/2026). Il ne sert qu'aux notifications systeme (Web Push) : il
// affiche ce que le serveur pousse (le meme message compact que l'appli Android : t titre, m texte, u lien, i image,
// li vignette, n numero dans le journal) et, au toucher, marque la notification lue et ouvre la bonne page.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { t: "BambuNymous", m: e.data ? e.data.text() : "" }; }
  const opts = { body: d.m || "", icon: d.li || "/icon-192.png", badge: "/notif-icon.png", data: { u: d.u || "/", n: d.n || null } };
  if (d.n) opts.tag = `n${d.n}`;
  if (d.i) opts.image = d.i;
  e.waitUntil(self.registration.showNotification(d.t || "BambuNymous", opts));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const { u, n } = e.notification.data || {};
  e.waitUntil((async () => {
    // lue dans le journal (la cloche), comme une notification touchee sur l'appli Android
    if (n) {
      try {
        const s = await self.registration.pushManager.getSubscription();
        if (s) await fetch("/api/v1/notify/device-read", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: s.endpoint, ids: [n] }) });
      } catch { /* hors ligne : tant pis */ }
    }
    const url = new URL(u || "/", self.location.origin).href;
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.startsWith(self.location.origin)) {
        await c.focus();
        try { await c.navigate(url); } catch { /* page d'une autre origine */ }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
