import { describe, expect, it, vi } from 'vitest';
import { proxyAuth } from '../src/auth-proxy';

describe('proxy de autenticação do ERP', () => {
	it('encaminha cookie, origem e IP pelo Service Binding e preserva o cookie de resposta', async () => {
		let originalBody: ReadableStream<Uint8Array> | null = null;
		const fetch = vi.fn(async (request: Request) => {
			expect(new URL(request.url).pathname).toBe('/api/auth/login');
			expect(request.body).toBe(originalBody);
			expect(request.headers.get('cookie')).toBe('sabores_session=anterior');
			expect(request.headers.get('origin')).toBe('https://erp.example.test');
			expect(request.headers.get('x-client-ip')).toBe('203.0.113.4');
			expect(await request.json()).toEqual({ username: 'bruno' });
			return Response.json(
				{ user: { username: 'bruno' } },
				{
					headers: { 'set-cookie': 'sabores_session=nova; HttpOnly' },
				},
			);
		});
		const request = new Request('https://erp.example.test/api/auth/login', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				cookie: 'sabores_session=anterior',
				origin: 'https://erp.example.test',
				'cf-connecting-ip': '203.0.113.4',
				host: 'erp.example.test',
			},
			body: JSON.stringify({ username: 'bruno' }),
		});
		originalBody = request.body;

		const response = await proxyAuth(request, { fetch } as unknown as Fetcher, 'login');
		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toContain('HttpOnly');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('não envia corpo em requisições HEAD', async () => {
		const fetch = vi.fn(async (request: Request) => {
			expect(request.method).toBe('HEAD');
			expect(request.body).toBeNull();
			return new Response(null, { status: 200 });
		});
		const request = new Request('https://erp.example.test/api/auth/session', {
			method: 'HEAD',
		});

		const response = await proxyAuth(request, { fetch } as unknown as Fetcher, 'session');
		expect(response.status).toBe(200);
	});
});
