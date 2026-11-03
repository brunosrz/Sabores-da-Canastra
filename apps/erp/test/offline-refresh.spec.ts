import 'fake-indexeddb/auto';
import { IDBDatabase } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { enqueuePriceChange, loadProducts, refreshProducts, saveErpSession, type ErpProduct } from '../src/offline/store';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
it('aplica a fila e grava o catálogo numa única transação que inclui operations', async () => {
	await saveErpSession({ user: { id: 'owner-test', username: 'owner-test', role: 'owner' }, expiresAt: '2099-01-01T00:00:00Z' });
	const product: ErpProduct = {
		product_id: 'atomic',
		name: 'Teste',
		category: 'Teste',
		unit: 'un',
		barcode: null,
		auxiliary_code: null,
		sale_price_cents: 100,
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ data: [product] })),
	);
	await refreshProducts();
	const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
	let respond: (response: Response) => void = () => {};
	vi.stubGlobal(
		'fetch',
		vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					respond = resolve;
				}),
		),
	);
	const refresh = refreshProducts();
	await enqueuePriceChange('atomic', 250);
	respond(Response.json({ data: [product] }));
	expect((await refresh)[0]?.sale_price_cents).toBe(250);
	expect((await loadProducts())[0]?.sale_price_cents).toBe(250);
	expect(
		transaction.mock.calls.some(
			([stores, mode]) => Array.isArray(stores) && stores.includes('products') && stores.includes('operations') && mode === 'readwrite',
		),
	).toBe(true);
});
