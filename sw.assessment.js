const CACHE = "beacn-drep-v10";
const SHELL = [
  "./",
  "./index.html",
  "./styles.assessment.css",
  "./app.assessment.js",
  "./verify.js",
  "./manifest.json",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./apple-touch-icon.png",
  "./favicon-16.png",
  "./favicon-32.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for the app shell (HTML/JS/CSS) and all data (JSON), so a new
  // deploy reaches returning visitors without waiting on a cache-version bump.
  // Cache is only a fallback when offline. Static images stay cache-first below.
  const path = url.pathname;
  const networkFirst =
    event.request.mode === "navigate" ||
    path.endsWith("/") ||
    path.endsWith(".html") ||
    path.endsWith(".js") ||
    path.endsWith(".css") ||
    path.endsWith(".json");

  if (networkFirst) {
    const cacheKey = new Request(url.origin + path);
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) caches.open(CACHE).then(cache => cache.put(cacheKey, response.clone()));
          return response;
        })
        .catch(() => caches.match(cacheKey).then(match => match || caches.match(event.request)))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
      return response;
    }))
  );
});
