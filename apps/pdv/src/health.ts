type ApiBinding = {
	fetch(request: Request): Promise<Response>;
};

export async function healthResponse(app: 'erp' | 'pdv', api: ApiBinding): Promise<Response> {
	try {
		const response = await api.fetch(new Request('https://api/health'));
		const backend = (await response.json()) as { status?: string };
		return Response.json(
			{ status: response.ok ? 'ok' : 'degraded', app, backend: backend.status ?? 'unknown' },
			{ status: response.status },
		);
	} catch {
		return Response.json({ status: 'degraded', app, backend: 'unavailable' }, { status: 503 });
	}
}
