import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import { proxyAuth } from '../auth-proxy';

export const Route = createFileRoute('/api/auth/session')({
	server: { handlers: { GET: ({ request }) => proxyAuth(request, env.API, 'session') } },
});
