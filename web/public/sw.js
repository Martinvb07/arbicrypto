// Avisos aunque la pestaña del panel esté dormida o cerrada: el servidor manda un push vacío,
// aquí se piden los avisos nuevos y se muestran como notificación de Windows.
// Si el panel está a la vista, no se muestra nada: la página ya suena y avisa sola.

const ROUTE = { p2p: "/#inicio", spot: "/#inicio", sell: "/#vender", price: "/#mercado" };

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (tabs.some((c) => c.visibilityState === "visible")) return;
    let alerts = [];
    try {
      const r = await fetch("/api/push/recent", { credentials: "same-origin", cache: "no-store" });
      if (r.ok) alerts = await r.json();
    } catch {
      /* sin conexión: se muestra el aviso genérico */
    }
    if (!alerts.length) alerts = [{ id: "nuevo", kind: "", title: "ArbiCrypto", body: "Tienes un aviso nuevo en el panel." }];
    await Promise.all(alerts.map((a) => self.registration.showNotification(a.title, {
      body: a.body,
      tag: `cj-${a.id}`,  // el mismo de la página: nunca sale dos veces el mismo aviso
      icon: "/icons/web-app-manifest-192x192.png",
      requireInteraction: a.kind !== "test",
      data: { url: ROUTE[a.kind] || "/" },
    })));
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      tab.postMessage({ hash: url.split("#")[1] || "" });  // la página cambia de pestaña sin recargar
      return tab.focus();
    }
    return self.clients.openWindow(url);
  })());
});
