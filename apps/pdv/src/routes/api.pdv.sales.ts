import { env } from 'cloudflare:workers';
import { createFileRoute } from '@tanstack/react-router';
import { proxyApi } from '../auth-proxy';

export const Route = createFileRoute('/api/pdv/sales')({
	server: { handlers: { GET: ({ request }) => proxyApi(request, env.API, 'sales') } },
});
