const CACHE = "dcp-public-shell-v1";
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
