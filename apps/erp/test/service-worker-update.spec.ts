import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function harness(file: string, failAt = '') {
	const stores = new Map<string, Map<string, Response>>();
	const handlers = new Map<string, (event: unknown) => void>();
	const fetch = vi.fn(async () => {
		if (failAt === 'shell') throw new Error('original install failure');
		return new Response('<html>shell</html>');
	});
	const keyOf = (key: string | Request) => (typeof key === 'string' ? key : key.url);
	const caches = {
		keys: async () => [...stores.keys()],
		delete: async (name: string) => stores.delete(name),
		open: async (name: string) => {
			if (!stores.has(name)) stores.set(name, new Map());
			const store = stores.get(name)!;
			return {
				match: async (key: string | Request) => store.get(keyOf(key))?.clone(),
				put: async (key: string | Request, value: Response) => {
					if (failAt === 'metadata' && keyOf(key).includes('__install_shell_cache__')) throw new Error('original install failure');
					store.set(keyOf(key), value.clone());
				},
				addAll: async () => {
					if (failAt === 'assets') throw new Error('original install failure');
				},
			};
		},
	};
	runInNewContext(readFileSync(file, 'utf8'), {
		self: {
			location: new URL('https://example.test/sw.js'),
			clients: { claim: async () => {} },
			addEventListener: (name: string, callback: (event: unknown) => void) => handlers.set(name, callback),
		},
		caches,
		fetch,
		Response,
		URL,
		crypto: globalThis.crypto,
	});
	async function lifecycle(name: string) {
		let work = Promise.resolve<unknown>(undefined);
		handlers.get(name)!({
			waitUntil: (promise: Promise<unknown>) => {
				work = promise;
			},
		});
		await work;
	}
	return { stores, handlers, fetch, lifecycle };
}
describe.each(['../erp/public/sw.js', '../pdv/public/sw.js'])('cache público de %s', (file) => {
	it.each(['shell', 'assets', 'metadata'])('descarta instalação parcial quando falha em %s', async (phase) => {
		const h = harness(file, phase);
		await expect(h.lifecycle('install')).rejects.toThrow('original install failure');
		expect([...h.stores.keys()].filter((name) => !name.endsWith('metadata'))).toEqual([]);
		for (const store of h.stores.values()) expect([...store.keys()].some((key) => key.includes('__install_shell_cache__'))).toBe(false);
	});
	it('retorna cache imediatamente, revalida no fundo e tolera rede indisponível', async () => {
		const h = harness(file);
		await h.lifecycle('install');
		await h.lifecycle('activate');
		const shellCache = [...h.stores.entries()].find(([name]) => !name.endsWith('metadata'))![1];
		const url = 'https://example.test/favicon.svg';
		shellCache.set(url, new Response('antigo'));
		let complete: (response: Response) => void = () => {};
		h.fetch.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					complete = resolve;
				}),
		);
		const background: Promise<unknown>[] = [];
		let result = Promise.resolve(Response.error());
		const event = () => ({
			request: { method: 'GET', url, mode: 'cors' },
			respondWith: (promise: Promise<Response>) => {
				result = promise;
			},
			waitUntil: (promise: Promise<unknown>) => background.push(promise),
		});
		h.handlers.get('fetch')!(event());
		expect(await (await result).text()).toBe('antigo');
		const fresh = new Response('novo');
		Object.defineProperty(fresh, 'type', { value: 'basic' });
		complete(fresh);
		await Promise.all(background);
		expect(await shellCache.get(url)!.clone().text()).toBe('novo');
		h.fetch.mockRejectedValueOnce(new Error('offline'));
		h.handlers.get('fetch')!(event());
		expect(await (await result).text()).toBe('novo');
		await Promise.all(background);
	});
});
