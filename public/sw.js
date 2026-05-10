const CACHE = "velour-v4";
const ASSETS = ["/", "/index.html"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) =>
        Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request).then((r) => {
        if (r.ok) {
          const c = r.clone();
          caches.open(CACHE).then((cc) => cc.put(e.request, c));
        }
        return r;
      });
      return cached || net;
    }),
  );
});

// Push notifications
self.addEventListener("push", (e) => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || "Velour", {
      body: data.body || "Time to check in.",
      icon: "/web-app-manifest-192x192.png", // ← updated
      badge: "/favicon-96x96.png", // ← updated
      tag: data.tag || "velour-notif",
      data: data,
      actions: [
        { action: "log", title: "Log Now" },
        { action: "dismiss", title: "Later" },
      ],
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "log") {
    e.waitUntil(clients.openWindow("/?screen=tracker"));
  } else {
    e.waitUntil(clients.openWindow("/"));
  }
});
