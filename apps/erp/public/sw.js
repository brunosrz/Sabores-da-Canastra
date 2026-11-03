const CACHE_PREFIX = 'sabores-erp-shell-';
const SHELL = '/_shell.html';
const PUBLIC_FILES = [
	SHELL,
	'/site.webmanifest',
	'/favicon.svg',
	'/favicon.ico',
	'/apple-touch-icon.png',
	'/android-chrome-192x192.png',
	'/android-chrome-512x512.png',
	'/brand/logo-sabores-canastra.svg',
];
const META_CACHE = `${CACHE_PREFIX}metadata`;
const ACTIVE_KEY = new URL('/__active_shell_cache__', self.location.origin).href;
const INSTALL_KEY = new URL('/__install_shell_cache__', self.location.origin).href;

async function readCacheName(key) {
	const metadata = await caches.open(META_CACHE);
	const response = await metadata.match(key);
	return response ? response.text() : null;
}
async function writeCacheName(key, name) {
	const metadata = await caches.open(META_CACHE);
	await metadata.put(key, new Response(name));
}
async function currentCacheName() {
	const active = await readCacheName(ACTIVE_KEY);
	if (active) return active;
	const keys = await caches.keys();
	return keys.find((key) => key.startsWith(CACHE_PREFIX) && key !== META_CACHE) ?? null;
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const name = `${CACHE_PREFIX}${crypto.randomUUID()}`;
			try {
				const cache = await caches.open(name);
				const shell = await fetch(SHELL, { cache: 'reload' });
				if (!shell.ok) throw new Error('Shell offline indisponível durante a instalação.');
				const html = await shell.clone().text();
				await cache.put(SHELL, shell);
				const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
					.map((match) => new URL(match[1], self.location.origin))
					.filter((url) => url.origin === self.location.origin)
					.map((url) => `${url.pathname}${url.search}`);
				await cache.addAll([...new Set([...PUBLIC_FILES.filter((path) => path !== SHELL), ...assets])]);
				await writeCacheName(INSTALL_KEY, name);
			} catch (error) {
				await caches.delete(name).catch(() => undefined);
				throw error;
			}
		})(),
	);
});

self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const name = (await readCacheName(INSTALL_KEY)) ?? (await currentCacheName());
			if (name) {
				await writeCacheName(ACTIVE_KEY, name);
				const keys = await caches.keys();
				await Promise.all(
					keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== name && key !== META_CACHE).map((key) => caches.delete(key)),
				);
			}
			await self.clients.claim();
		})(),
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
	event.respondWith(
		currentCacheName()
			.then(async (cacheName) => {
				if (!cacheName) return fetch(request).catch(() => Response.error());
				const cache = await caches.open(cacheName);
				if (request.mode === 'navigate') return fetch(request).catch(async () => (await cache.match(SHELL)) || Response.error());
				const publicAsset =
					url.pathname.startsWith('/assets/') ||
					url.pathname.startsWith('/brand/') ||
					url.pathname.startsWith('/fonts/') ||
					PUBLIC_FILES.includes(url.pathname);
				if (!publicAsset) return fetch(request);
				const cached = await cache.match(request);
				const network = fetch(request).then(async (response) => {
					if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
					return response;
				});
				if (cached) {
					event.waitUntil(network.catch(() => undefined));
					return cached;
				}
				return network.catch(() => Response.error());
			})
			.catch(() => fetch(request).catch(() => Response.error())),
	);
});
