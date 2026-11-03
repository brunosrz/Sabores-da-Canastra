import { env } from 'cloudflare:workers';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/erp/finance')({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const source = new URL(request.url);
				const target = new URL(
					source.searchParams.get('entries') === '1'
						? 'https://sabores-api.internal/api/finance/entries'
						: 'https://sabores-api.internal/api/erp/finance',
				);
				target.search = source.search;
				const headers = new Headers();
				const cookie = request.headers.get('cookie');
				if (cookie) headers.set('cookie', cookie);
				const response = await env.API.fetch(new Request(target, { headers }));
				const resultHeaders = new Headers(response.headers);
				resultHeaders.set('cache-control', 'private, no-store');
				return new Response(response.body, { status: response.status, headers: resultHeaders });
			},
		},
	},
});
