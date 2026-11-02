export type ErpProduct = {
	product_id: string;
	name: string;
	category: string;
	unit: string;
	barcode: string | null;
	auxiliary_code: string | null;
	sale_price_cents: number | null;
	unit_cost_cents?: number | null;
	[key: string]: unknown;
};
export type ErpSession = {
	user: { id: string; username: string; role: string };
	expiresAt: string;
};
export type PriceOperation = {
	operationId: string;
	productId: string;
	basePriceCents: number | null;
	salePriceCents: number;
	occurredAt: string;
	state: 'pending' | 'synced' | 'conflict' | 'blocked_auth';
	error?: string;
};

const DATABASE = 'sabores-erp-offline-v1';
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
	if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Armazenamento offline indisponível.'));
	database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			db.createObjectStore('products', { keyPath: 'product_id' });
			db.createObjectStore('operations', { keyPath: 'operationId' });
			db.createObjectStore('metadata', { keyPath: 'key' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Falha ao abrir o banco offline.'));
	});
	return database;
}
function request<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
	return openDatabase().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(storeName, mode);
				const result = action(tx.objectStore(storeName));
				let value: T;
				result.onsuccess = () => {
					value = result.result;
				};
				result.onerror = () => reject(result.error ?? new Error('Falha no armazenamento local.'));
				tx.oncomplete = () => resolve(value!);
				tx.onerror = () => reject(tx.error ?? new Error('Falha no armazenamento local.'));
				tx.onabort = () => reject(tx.error ?? new Error('Operação local cancelada.'));
			}),
	);
}
export const loadErpSession = () =>
	request<{ key: string; value: ErpSession } | undefined>('metadata', 'readonly', (store) => store.get('session')).then((row) => {
		const session = row?.value;
		return session && Date.parse(session.expiresAt) > Date.now() ? session : null;
	});
export const saveErpSession = (session: ErpSession) =>
	request('metadata', 'readwrite', (store) => store.put({ key: 'session', value: session }));
export const clearErpSession = () => request('metadata', 'readwrite', (store) => store.delete('session'));
export const loadProducts = () => request<ErpProduct[]>('products', 'readonly', (store) => store.getAll());
export async function refreshProducts() {
	const response = await fetch('/api/erp/catalog/products', {
		credentials: 'same-origin',
		cache: 'no-store',
	});
	if (!response.ok) throw new Error(`Catálogo indisponível (${response.status}).`);
	const body = (await response.json()) as { data: ErpProduct[] };
	const operations = await listPriceOperations();
	const pendingByProduct = new Map<string, PriceOperation[]>();
	for (const operation of operations) {
		if (operation.state === 'synced') continue;
		const queued = pendingByProduct.get(operation.productId) ?? [];
		queued.push(operation);
		pendingByProduct.set(operation.productId, queued);
	}
	const mergedProducts = body.data.map((product) => {
		const queued = pendingByProduct.get(product.product_id) ?? [];
		const latest = queued.at(-1);
		return latest ? { ...product, sale_price_cents: latest.salePriceCents } : product;
	});
	const db = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction('products', 'readwrite');
		const store = tx.objectStore('products');
		store.clear();
		mergedProducts.forEach((product) => store.put(product));
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Falha ao atualizar catálogo local.'));
	});
	return mergedProducts;
}
export const listPriceOperations = () => request<PriceOperation[]>('operations', 'readonly', (store) => store.getAll());
export async function enqueuePriceChange(productId: string, salePriceCents: number) {
	const operation: PriceOperation = {
		operationId: crypto.randomUUID(),
		productId,
		basePriceCents: null,
		salePriceCents,
		occurredAt: new Date().toISOString(),
		state: 'pending',
	};
	const db = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(['products', 'operations'], 'readwrite');
		const products = tx.objectStore('products');
		const find = products.get(productId);
		find.onsuccess = () => {
			if (!find.result) return tx.abort();
			operation.basePriceCents = find.result.sale_price_cents ?? null;
			products.put({ ...find.result, sale_price_cents: salePriceCents });
			tx.objectStore('operations').add(operation);
		};
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Falha ao enfileirar o preço.'));
		tx.onabort = () => reject(tx.error ?? new Error('Produto não encontrado no catálogo local.'));
	});
	return operation;
}
export async function syncPriceQueue() {
	if (!navigator.onLine)
		return {
			applied: 0,
			pending: (await listPriceOperations()).filter((item) => item.state === 'pending').length,
		};
	const session = await loadErpSession();
	let applied = 0;
	for (const operation of await listPriceOperations()) {
		if (operation.state === 'blocked_auth' && session) {
			await request('operations', 'readwrite', (store) => store.put({ ...operation, state: 'pending', error: undefined }));
			operation.state = 'pending';
		}
		if (operation.state !== 'pending') continue;
		if (!session) {
			await request('operations', 'readwrite', (store) =>
				store.put({
					...operation,
					state: 'blocked_auth',
					error: 'Entre novamente para sincronizar este ajuste.',
				}),
			);
			continue;
		}
		let response: Response;
		try {
			response = await fetch('/api/erp/product-price', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(operation),
			});
		} catch {
			break;
		}
		if (response.status === 401 || response.status === 403) {
			await request('operations', 'readwrite', (store) =>
				store.put({
					...operation,
					state: 'blocked_auth',
					error: 'Sessão precisa ser renovada para sincronizar.',
				}),
			);
			break;
		}
		if (response.status === 404 || response.status === 409 || response.status === 422) {
			await request('operations', 'readwrite', (store) =>
				store.put({
					...operation,
					state: 'conflict',
					error: 'O produto ou o preço foi rejeitado pelo servidor.',
				}),
			);
			continue;
		}
		if (!response.ok) break;
		await request('operations', 'readwrite', (store) => store.put({ ...operation, state: 'synced' }));
		applied += 1;
	}
	const operations = await listPriceOperations();
	return {
		applied,
		pending: operations.filter((item) => item.state === 'pending' || item.state === 'blocked_auth').length,
	};
}
