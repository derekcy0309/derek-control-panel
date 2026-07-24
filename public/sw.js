const CACHE = "dcp-public-shell-v2";
const PUBLIC_FALLBACK = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(PUBLIC_FALLBACK)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(PUBLIC_FALLBACK)));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon" || url.pathname === "/apple-icon") {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    })));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" ? payload.title.slice(0, 100) : "Derek Control Panel";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 240) : "你有一項需要留意的更新";
  const path = typeof payload.path === "string" && payload.path.startsWith("/") ? payload.path.slice(0, 500) : "/";
  const deliveryId = typeof payload.deliveryId === "string" ? payload.deliveryId : null;
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icon",
    badge: "/icon",
    tag: deliveryId ? `dcp-${deliveryId}` : "dcp-notification",
    renotify: false,
    data: { path, deliveryId }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path || "/";
  const deliveryId = event.notification.data?.deliveryId;
  event.waitUntil((async () => {
    if (deliveryId) {
      await fetch("/api/control", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "notification_opened", deliveryId })
      }).catch(() => undefined);
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const targetUrl = new URL(path, self.location.origin).href;
    for (const client of windows) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(targetUrl);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});
