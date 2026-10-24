// Service worker: asset statici in cache-first, API in network-first con
// fallback all'ultima risposta valida (uso in campo). Le cache hanno un tetto
// di voci e, a ogni attivazione, buttano via i chunk delle build precedenti.
const VERSION = "v2";
const STATIC_CACHE = "firenze-static-" + VERSION;
const DATA_CACHE = "firenze-data-" + VERSION;

// Tetti di voci per cache: oltre, si scartano le voci inserite prima.
const STATIC_MAX_ENTRIES = 80;
const DATA_MAX_ENTRIES = 40;
const ASSET_CHECK_TIMEOUT_MS = 4000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

// keys() segue l'ordine di inserimento: le voci in testa sono le piu' vecchie.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return 0;
  const excess = keys.slice(0, keys.length - maxEntries);
  for (const key of excess) {
    await cache.delete(key);
  }
  return excess.length;
}

// Ogni build cambia gli hash dei chunk: le voci /_next/static che il server non
// serve piu' (404/410) restano in cache per sempre e vanno rimosse. Con la rete
// assente la verifica fallisce in silenzio e si riprova alla prossima attivazione.
async function dropStaleAssets() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  let removed = 0;

  await Promise.all(keys.map(async (key) => {
    if (!new URL(key.url).pathname.startsWith("/_next/static")) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ASSET_CHECK_TIMEOUT_MS);
    try {
      const response = await fetch(key.url, { method: "HEAD", cache: "no-store", signal: controller.signal });
      if (response.status === 404 || response.status === 410) {
        if (await cache.delete(key)) removed += 1;
      }
    } catch (error) {
      // Offline o timeout: nessuna certezza, la voce resta per l'uso in campo.
    } finally {
      clearTimeout(timer);
    }
  }));

  return removed;
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("firenze-") && !key.endsWith(VERSION))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
    // Dopo il claim, cosi' la pagina e' gia' sotto controllo mentre si pota.
    await dropStaleAssets();
    await trimCache(STATIC_CACHE, STATIC_MAX_ENTRIES);
    await trimCache(DATA_CACHE, DATA_MAX_ENTRIES);
  })());
});

// La copia da mettere in cache va clonata subito, prima che il browser consumi
// il body della risposta che stiamo restituendo.
function storeResponse(event, cacheName, request, copy, maxEntries) {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.put(request, copy);
    await trimCache(cacheName, maxEntries);
  })().catch(() => {}));
}

async function cacheFirst(event, request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    storeResponse(event, STATIC_CACHE, request, response.clone(), STATIC_MAX_ENTRIES);
  }
  return response;
}

async function networkFirst(event, request, cacheName, canCache, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && canCache(response)) {
      storeResponse(event, cacheName, request, response.clone(), maxEntries);
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
    event.respondWith(cacheFirst(event, request));
    return;
  }

  if (url.pathname.startsWith("/api/bulletins/pdf")) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(
      event,
      request,
      DATA_CACHE,
      (response) => (response.headers.get("content-type") || "").includes("application/json"),
      DATA_MAX_ENTRIES
    ));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, request, STATIC_CACHE, () => true, STATIC_MAX_ENTRIES));
  }
});
