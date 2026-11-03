import { env } from 'cloudflare:workers';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/erp/ingredients')({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const headers = new Headers();
				const cookie = request.headers.get('cookie');
				if (cookie) headers.set('cookie', cookie);
				const response = await env.API.fetch(new Request('https://sabores-api.internal/api/erp/ingredients', { headers }));
				const resultHeaders = new Headers(response.headers);
				resultHeaders.set('cache-control', 'private, no-store');
				return new Response(response.body, { status: response.status, headers: resultHeaders });
			},
		},
	},
});
