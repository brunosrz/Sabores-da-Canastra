import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { enqueuePriceChange, listPriceOperations, refreshProducts, saveErpSession, syncPriceQueue } from '../src/offline/store';

it('preserva o ajuste pendente e impede que outra conta o sincronize', async () => {
	vi.stubGlobal('navigator', { onLine: true });
	const fetchMock = vi.fn(async () => Response.json({ data: [{ product_id: 'p1', name: 'Produto', sale_price_cents: 100 }] }));
	vi.stubGlobal('fetch', fetchMock);
	await refreshProducts();
	const session = (id: string) => ({ user: { id, username: id, role: 'owner' }, expiresAt: '2099-01-01T00:00:00Z' });
	await saveErpSession(session('autora'));
	const operation = await enqueuePriceChange('p1', 250);
	expect(operation.actorUserId).toBe('autora');
	await saveErpSession(session('outra'));
	fetchMock.mockClear();
	await syncPriceQueue();
	expect(fetchMock).not.toHaveBeenCalled();
	expect(await listPriceOperations()).toContainEqual(
		expect.objectContaining({ operationId: operation.operationId, state: 'blocked_auth' }),
	);
	await saveErpSession(session('autora'));
	fetchMock.mockResolvedValue(Response.json({ ok: true }));
	await syncPriceQueue();
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(await listPriceOperations()).toContainEqual(expect.objectContaining({ operationId: operation.operationId, state: 'synced' }));
	vi.unstubAllGlobals();
});

it('compartilha uma sincronização em andamento entre chamadas concorrentes', async () => {
	vi.stubGlobal('navigator', { onLine: true });
	const fetchMock = vi.fn(async () => Response.json({ data: [{ product_id: 'p2', name: 'Produto', sale_price_cents: 100 }] }));
	vi.stubGlobal('fetch', fetchMock);
	await refreshProducts();
	await saveErpSession({ user: { id: 'owner', username: 'owner', role: 'owner' }, expiresAt: '2099-01-01T00:00:00Z' });
	const operation = await enqueuePriceChange('p2', 200);
	let finish!: (response: Response) => void;
	fetchMock.mockImplementation(
		() =>
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
	);
	fetchMock.mockClear();
	const first = syncPriceQueue();
	const second = syncPriceQueue();
	await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
	finish(Response.json({ ok: true }));
	await Promise.all([first, second]);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(await listPriceOperations()).toContainEqual(expect.objectContaining({ operationId: operation.operationId, state: 'synced' }));
	vi.unstubAllGlobals();
});
