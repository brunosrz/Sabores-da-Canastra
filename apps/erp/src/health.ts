export function healthResponse(app: 'erp' | 'pdv'): Response {
	return Response.json({ status: 'ok', app }, { status: 200 });
}
