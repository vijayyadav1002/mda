const STATIC_CACHE = "mda-static-v1";
const RUNTIME_CACHE = "mda-runtime-v1";
const STATIC_ASSETS = [
  "/",
  "/login",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

const isCacheableAsset = (pathname) =>
  pathname.startsWith("/build/") ||
  pathname.startsWith("/icons/") ||
  pathname.endsWith(".css") ||
  pathname.endsWith(".js") ||
  pathname.endsWith(".woff") ||
  pathname.endsWith(".woff2");

const isBypassPath = (pathname) =>
  pathname.startsWith("/graphql") ||
  pathname.startsWith("/image/") ||
  pathname.startsWith("/video/") ||
  pathname.startsWith("/thumbnails/") ||
  pathname.startsWith("/transcoded/");

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isBypassPath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;
          return caches.match("/offline.html");
        })
    );
    return;
  }

  if (isCacheableAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) {
          fetch(request)
            .then(async (response) => {
              const cache = await caches.open(STATIC_CACHE);
              await cache.put(request, response.clone());
            })
            .catch(() => {});
          return cached;
        }

        const response = await fetch(request);
        const cache = await caches.open(STATIC_CACHE);
        await cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
        return response;
      })
      .catch(() => caches.match(request))
  );
});
