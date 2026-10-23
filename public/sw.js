// Service worker minimo: asset statici immutabili in cache, API in
// network-first con fallback all'ultima risposta valida (uso in campo).
const VERSION = "v1";
const STATIC_CACHE = "firenze-static-" + VERSION;
const DATA_CACHE = "firenze-data-" + VERSION;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("firenze-") && !key.endsWith(VERSION))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName, canCache) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && canCache(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json") {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith("/api/bulletins/pdf")) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(
      request,
      DATA_CACHE,
      (response) => (response.headers.get("content-type") || "").includes("application/json")
    ));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, STATIC_CACHE, () => true));
  }
});
