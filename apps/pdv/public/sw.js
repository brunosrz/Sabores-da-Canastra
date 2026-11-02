const CACHE_PREFIX = "sabores-pdv-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL = "/_shell.html";
const PUBLIC_FILES = [SHELL, "/site.webmanifest", "/favicon.svg", "/brand/logo-sabores-canastra.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_FILES)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(SHELL)) || Response.error()));
    return;
  }

  const isPublicAsset = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/fonts/") || PUBLIC_FILES.includes(url.pathname);
  if (!isPublicAsset) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
      if (response.ok && response.type === "basic") void cache.put(request, response.clone());
      return response;
    });
    return cached || network.catch(() => Response.error());
  }));
});
