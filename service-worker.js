/* Silt PWA offline service worker */
const SILT_CACHE_VERSION = "silt-v0.14.4-offline-1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./offline.html",
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./icons/icon-128.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-167.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-256.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SILT_CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== SILT_CACHE_VERSION).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Keep app-shell navigation reliable offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(SILT_CACHE_VERSION).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html").then(response => response || caches.match("./offline.html")))
    );
    return;
  }

  // Same-origin app assets: cache first, then network, then offline page where relevant.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SILT_CACHE_VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        }).catch(() => {
          if (request.destination === "document") return caches.match("./offline.html");
          return Response.error();
        });
      })
    );
  }
});

self.addEventListener("message", event => {
  if (!event.data) return;
  if (event.data.type === "SILT_SKIP_WAITING") self.skipWaiting();
  if (event.data.type === "SILT_CACHE_STATUS") {
    caches.open(SILT_CACHE_VERSION).then(cache => cache.keys()).then(keys => {
      event.source && event.source.postMessage({
        type: "SILT_CACHE_STATUS_RESULT",
        version: SILT_CACHE_VERSION,
        cached: keys.map(req => req.url)
      });
    });
  }
});
