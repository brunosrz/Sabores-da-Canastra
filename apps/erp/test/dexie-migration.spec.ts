import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';

it('preserva o catálogo e os ajustes pendentes do ERP ao abrir o banco legado com Dexie', async () => {
	const { IDBFactory } = await import('fake-indexeddb');
	vi.stubGlobal('indexedDB', new IDBFactory());
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.open('sabores-erp-offline-v1', 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			db.createObjectStore('products', { keyPath: 'product_id' });
			db.createObjectStore('operations', { keyPath: 'operationId' });
			db.createObjectStore('metadata', { keyPath: 'key' });
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const db = request.result;
			const tx = db.transaction(['products', 'operations'], 'readwrite');
			tx.objectStore('products').put({ product_id: 'p1', name: 'Produto', sale_price_cents: 500 });
			tx.objectStore('operations').put({ operationId: 'op-123', productId: 'p1', salePriceCents: 500, state: 'pending' });
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => reject(tx.error);
		};
	});
	vi.resetModules();
	const { default: Dexie } = await import('dexie');
	Dexie.dependencies.indexedDB = indexedDB;
	const { loadProducts, listPriceOperations } = await import('../src/offline/store');
	expect((await loadProducts())[0]).toMatchObject({ product_id: 'p1', sale_price_cents: 500 });
	expect((await listPriceOperations())[0]).toMatchObject({ operationId: 'op-123', state: 'pending' });
	vi.unstubAllGlobals();
});
