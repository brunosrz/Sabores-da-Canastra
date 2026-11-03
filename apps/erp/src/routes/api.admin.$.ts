import { env } from 'cloudflare:workers';
import { createFileRoute } from '@tanstack/react-router';

async function proxy(request: Request) {
	const source = new URL(request.url);
	if (!source.pathname.startsWith('/api/admin/')) return new Response('Não encontrado', { status: 404 });
	const headers = new Headers();
	for (const name of ['cookie', 'content-type', 'origin', 'idempotency-key']) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	const body = ['GET', 'HEAD'].includes(request.method) ? undefined : request.body;
	const response = await env.API.fetch(
		new Request(`https://sabores-api.internal${source.pathname}${source.search}`, {
			method: request.method,
			headers,
			body,
			...(body ? { duplex: 'half' } : {}),
		}),
	);
	const resultHeaders = new Headers(response.headers);
	resultHeaders.set('cache-control', 'private, no-store');
	return new Response(response.body, { status: response.status, headers: resultHeaders });
}
export const Route = createFileRoute('/api/admin/$')({
	server: {
		handlers: {
			DELETE: ({ request }) => proxy(request),
			GET: ({ request }) => proxy(request),
			POST: ({ request }) => proxy(request),
			PUT: ({ request }) => proxy(request),
		},
	},
});
