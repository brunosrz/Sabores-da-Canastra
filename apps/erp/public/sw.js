const CACHE_PREFIX = "sabores-erp-shell-";
const SHELL = "/_shell.html";
const PUBLIC_FILES = [
  SHELL,
  "/site.webmanifest",
  "/favicon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/brand/logo-sabores-canastra.svg",
];
let cacheNamePromise;

async function currentCacheName() {
  if (!cacheNamePromise) {
    cacheNamePromise = fetch(self.location.href, { cache: "no-store" })
      .then((response) => response.arrayBuffer())
      .then((source) => crypto.subtle.digest("SHA-256", source))
      .then(
        (digest) =>
          `${CACHE_PREFIX}${[...new Uint8Array(digest)]
            .map((part) => part.toString(16).padStart(2, "0"))
            .join("")
            .slice(0, 16)}`,
      );
  }
  return cacheNamePromise;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(await currentCacheName());
      const shell = await fetch(SHELL, { cache: "reload" });
      if (!shell.ok)
        throw new Error("Shell offline indisponível durante a instalação.");
      const html = await shell.clone().text();
      await cache.put(SHELL, shell);
      const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map((match) => new URL(match[1], self.location.origin))
        .filter((url) => url.origin === self.location.origin)
        .map((url) => `${url.pathname}${url.search}`);
      await cache.addAll([
        ...new Set([
          ...PUBLIC_FILES.filter((path) => path !== SHELL),
          ...assets,
        ]),
      ]);
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    currentCacheName()
      .then((cacheName) =>
        caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter(
                  (key) => key.startsWith(CACHE_PREFIX) && key !== cacheName,
                )
                .map((key) => caches.delete(key)),
            ),
          ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  event.respondWith(
    currentCacheName().then(async (cacheName) => {
      const cache = await caches.open(cacheName);
      if (request.mode === "navigate")
        return fetch(request).catch(
          async () => (await cache.match(SHELL)) || Response.error(),
        );
      const publicAsset =
        url.pathname.startsWith("/assets/") ||
        url.pathname.startsWith("/brand/") ||
        url.pathname.startsWith("/fonts/") ||
        PUBLIC_FILES.includes(url.pathname);
      if (!publicAsset) return fetch(request);
      const cached = await cache.match(request);
      const network = fetch(request).then((response) => {
        if (response.ok && response.type === "basic")
          void cache.put(request, response.clone());
        return response;
      });
      return cached || network.catch(() => Response.error());
    }),
  );
});
