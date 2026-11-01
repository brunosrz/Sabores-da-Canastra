import { env } from 'cloudflare:workers';

export async function healthResponse(app: 'erp' | 'pdv'): Promise<Response> {
	try {
		const response = await env.API.fetch(new Request('https://api/health'));
		const backend = (await response.json()) as { status?: string };
		return Response.json(
			{ status: response.ok ? 'ok' : 'degraded', app, backend: backend.status ?? 'unknown' },
			{ status: response.status },
		);
	} catch {
		return Response.json({ status: 'degraded', app, backend: 'unavailable' }, { status: 503 });
	}
}
