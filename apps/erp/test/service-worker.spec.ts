import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe.each([
	['../erp/public/sw.js', '/receitas'],
	['../pdv/public/sw.js', '/historico'],
])('service worker %s', (file, route) => {
	it('recupera o shell depois de reiniciar sem rede', async () => {
		const stores = new Map<string, Map<string, Response>>();
		const caches = {
			keys: async () => [...stores.keys()],
			delete: async (name: string) => stores.delete(name),
			open: async (name: string) => {
				if (!stores.has(name)) stores.set(name, new Map());
				const store = stores.get(name)!;
				return {
					match: async (key: string) => store.get(typeof key === 'string' ? key : (key as Request).url)?.clone(),
					put: async (key: string, value: Response) => {
						store.set(typeof key === 'string' ? key : (key as Request).url, value.clone());
					},
					addAll: async () => {},
				};
			},
		};
		let offline = false;
		const boot = () => {
			const handlers = new Map<string, (event: unknown) => void>();
			const self = {
				location: new URL('https://example.test/sw.js'),
				clients: { claim: async () => {} },
				addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
			};
			runInNewContext(readFileSync(file, 'utf8'), {
				self,
				caches,
				Response,
				URL,
				crypto: globalThis.crypto,
				fetch: async () => {
					if (offline) throw new Error('offline');
					return new Response('<html>shell</html>');
				},
			});
			return handlers;
		};
		const handlers = boot();
		let work: Promise<unknown> = Promise.resolve();
		handlers.get('install')!({
			waitUntil: (promise: Promise<unknown>) => {
				work = promise;
			},
		});
		await work;
		handlers.get('activate')!({
			waitUntil: (promise: Promise<unknown>) => {
				work = promise;
			},
		});
		await work;
		offline = true;
		const restarted = boot();
		let result: Promise<Response> = Promise.resolve(Response.error());
		restarted.get('fetch')!({
			request: { method: 'GET', url: `https://example.test${route}`, mode: 'navigate' },
			respondWith: (promise: Promise<Response>) => {
				result = promise;
			},
		});
		expect(await (await result).text()).toBe('<html>shell</html>');
	});
});
