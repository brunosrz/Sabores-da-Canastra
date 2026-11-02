import { describe, expect, it, vi } from 'vitest';
import { proxyAuth } from '../src/auth-proxy';

describe('proxy de autenticação do PDV', () => {
	it('encaminha cookie, origem e IP pelo Service Binding e preserva o cookie de resposta', async () => {
		const fetch = vi.fn(async (request: Request) => {
			expect(new URL(request.url).pathname).toBe('/api/auth/session');
			expect(request.body).toBeNull();
			expect(request.headers.get('cookie')).toBe('sabores_session=anterior');
			expect(request.headers.get('origin')).toBe('https://pdv.example.test');
			expect(request.headers.get('x-client-ip')).toBe('203.0.113.5');
			return Response.json(
				{ user: { username: 'ivone' } },
				{
					headers: { 'set-cookie': 'sabores_session=nova; HttpOnly' },
				},
			);
		});
		const request = new Request('https://pdv.example.test/api/auth/session', {
			headers: {
				cookie: 'sabores_session=anterior',
				origin: 'https://pdv.example.test',
				'cf-connecting-ip': '203.0.113.5',
				host: 'pdv.example.test',
			},
		});

		const response = await proxyAuth(request, { fetch } as unknown as Fetcher, 'session');
		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toContain('HttpOnly');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('encaminha corpo POST como stream sem materializá-lo', async () => {
		let originalBody: ReadableStream<Uint8Array> | null = null;
		const fetch = vi.fn(async (request: Request) => {
			expect(request.body).toBe(originalBody);
			expect(await request.json()).toEqual({ username: 'ivone' });
			return Response.json({ ok: true });
		});
		const request = new Request('https://pdv.example.test/api/auth/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ username: 'ivone' }),
		});
		originalBody = request.body;

		const response = await proxyAuth(request, { fetch } as unknown as Fetcher, 'login');
		expect(response.status).toBe(200);
	});
});
