import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import { proxyAuth } from '../auth-proxy';

export const Route = createFileRoute('/api/auth/logout')({
	server: { handlers: { POST: ({ request }) => proxyAuth(request, env.API, 'logout') } },
});
