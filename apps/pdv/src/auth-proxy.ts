export async function proxyAuth(request: Request, api: Fetcher, endpoint: string): Promise<Response> {
	const headers = new Headers();
	for (const name of ['content-type', 'cookie', 'origin']) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	const clientIp = request.headers.get('cf-connecting-ip');
	const host = request.headers.get('host');
	const proto = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.slice(0, -1);
	if (clientIp) headers.set('x-client-ip', clientIp);
	if (host) headers.set('x-forwarded-host', host);
	headers.set('x-forwarded-proto', proto);
	const body = ['GET', 'HEAD'].includes(request.method) ? null : request.body;
	const init = {
		method: request.method,
		headers,
		body,
		...(body ? { duplex: 'half' as const } : {}),
	} as RequestInit & { duplex?: 'half' };
	const response = await api.fetch(new Request(`https://sabores-api.internal/api/auth/${endpoint}`, init));
	const responseHeaders = new Headers(response.headers);
	responseHeaders.set('cache-control', 'no-store');
	return new Response(response.body, { status: response.status, headers: responseHeaders });
}
