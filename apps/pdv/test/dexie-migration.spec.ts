import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const name = 'sabores-pdv-offline-v1';

async function createLegacyDatabase(version: number) {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.open(name, version);
		request.onupgradeneeded = () => {
			const db = request.result;
			db.createObjectStore('operations', { keyPath: 'operation.operationId' });
			db.createObjectStore('catalog', { keyPath: 'product_id' });
			db.createObjectStore('metadata', { keyPath: 'key' });
			db.createObjectStore('drafts', { keyPath: 'key' });
			db.createObjectStore('auth', { keyPath: 'key' });
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const db = request.result;
			const tx = db.transaction(['operations', 'drafts', 'catalog'], 'readwrite');
			tx.objectStore('operations').put({ operation: { operationId: 'legacy-123' }, state: 'pending', queuedAt: '2026-01-01', sequence: 1 });
			tx.objectStore('drafts').put({ key: 'current', value: { items: ['produto'] } });
			tx.objectStore('catalog').put({ product_id: 'produto', name: 'Produto', category: 'Outros', unit: 'un', sale_price_cents: 500 });
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => reject(tx.error);
		};
	});
}

describe('acesso Dexie ao armazenamento legado', () => {
	beforeEach(() => {
		vi.resetModules();
	});
	it.each([1, 2])('preserva catálogo, rascunho e fila da versão IndexedDB %i', async (version) => {
		// Cada caso usa uma factory independente para não manter conexões entre testes.
		const { IDBFactory } = await import('fake-indexeddb');
		vi.stubGlobal('indexedDB', new IDBFactory());
		await createLegacyDatabase(version);
		const { default: Dexie } = await import('dexie');
		Dexie.dependencies.indexedDB = indexedDB;
		const store = await import('../src/offline/store');
		expect(await store.loadDraft()).toEqual({ items: ['produto'] });
		expect((await store.listProducts())[0]?.product_id).toBe('produto');
		expect((await store.listQueue())[0]?.operation.operationId).toBe('legacy-123');
		await store.saveDraft({ items: ['novo'] });
		expect(await store.loadDraft()).toEqual({ items: ['novo'] });
	});
});
