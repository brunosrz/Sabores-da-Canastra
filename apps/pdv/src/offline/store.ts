import { canSyncOperation, operationIdentity, operationPayloadHash, type OperationEnvelope, type OperationType } from '@sabores/pdv-sync';

export type QueueState = 'pending' | 'syncing' | 'synced' | 'duplicate' | 'conflict' | 'invalid' | 'auth_required';
export type QueuedOperation = {
	operation: OperationEnvelope;
	state: QueueState;
	queuedAt: string;
	sequence?: number;
	error?: string;
	response?: unknown;
};
export type CachedProduct = {
	product_id: string;
	name: string;
	category: string;
	unit: string;
	barcode?: string | null;
	auxiliary_code?: string | null;
	sale_price_cents: number;
	unit_cost_cents?: number | null;
	[key: string]: unknown;
};
export type PaymentFees = Record<'Dinheiro' | 'Débito' | 'Crédito' | 'Pix', string>;
export const DEFAULT_FEES: PaymentFees = {
	Dinheiro: '0',
	Débito: '0.0139',
	Crédito: '0.0334',
	Pix: '0',
};
const DB_NAME = 'sabores-pdv-offline-v1';
const DB_VERSION = 2;
let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase() {
	if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Armazenamento local indisponível neste navegador.'));
	databasePromise ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains('operations'))
				database.createObjectStore('operations', {
					keyPath: 'operation.operationId',
				});
			if (!database.objectStoreNames.contains('catalog')) database.createObjectStore('catalog', { keyPath: 'product_id' });
			if (!database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata', { keyPath: 'key' });
			if (!database.objectStoreNames.contains('drafts')) database.createObjectStore('drafts', { keyPath: 'key' });
			if (!database.objectStoreNames.contains('auth')) database.createObjectStore('auth', { keyPath: 'key' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Falha ao abrir armazenamento local.'));
	});
	return databasePromise;
}

async function requestValue<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(storeName, mode);
		const request = action(transaction.objectStore(storeName));
		let value: T;
		request.onsuccess = () => {
			value = request.result;
		};
		transaction.oncomplete = () => resolve(value!);
		request.onerror = () => reject(request.error ?? new Error('Falha ao acessar armazenamento local.'));
		transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao confirmar armazenamento local.'));
		transaction.onabort = () => reject(transaction.error ?? new Error('Transação local cancelada.'));
	});
}

export async function getDeviceId() {
	const stored = localStorage.getItem('pdv-device-id');
	if (stored && /^[0-9a-f-]{36}$/i.test(stored)) return stored;
	const id = crypto.randomUUID();
	localStorage.setItem('pdv-device-id', id);
	return id;
}

export async function listProducts(): Promise<CachedProduct[]> {
	return (await requestValue('catalog', 'readonly', (store) => store.getAll())) as CachedProduct[];
}

export async function updateCatalog(): Promise<{
	products: CachedProduct[];
	version: string;
	fetchedAt: string;
	unchanged: boolean;
}> {
	const db = await openDatabase();
	const meta = await requestValue<{ key: string; value: string } | undefined>('metadata', 'readonly', (store) => store.get('catalog'));
	const headers = new Headers();
	if (meta?.value) headers.set('if-none-match', `"${meta.value}"`);
	const response = await fetch('/api/pdv/catalog', {
		credentials: 'same-origin',
		cache: 'no-store',
		headers,
	});
	if (response.status === 304 && meta?.value)
		return {
			products: await listProducts(),
			version: meta.value,
			fetchedAt: new Date().toISOString(),
			unchanged: true,
		};
	if (!response.ok) throw new Error(`Catálogo não atualizado (${response.status}).`);
	const body = (await response.json()) as {
		catalogVersion: string;
		fetchedAt: string;
		paymentFees: PaymentFees;
		data: CachedProduct[];
	};
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(['catalog', 'metadata'], 'readwrite');
		const catalog = tx.objectStore('catalog');
		catalog.clear();
		for (const product of body.data) catalog.put(product);
		tx.objectStore('metadata').put({
			key: 'catalog',
			value: body.catalogVersion,
		});
		tx.objectStore('metadata').put({
			key: 'paymentFees',
			value: JSON.stringify(body.paymentFees),
		});
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Falha ao salvar catálogo.'));
	});
	return {
		products: body.data,
		version: body.catalogVersion,
		fetchedAt: body.fetchedAt,
		unchanged: false,
	};
}

export async function getPaymentFees(): Promise<PaymentFees> {
	const value = await requestValue<{ key: string; value: string } | undefined>('metadata', 'readonly', (store) => store.get('paymentFees'));
	try {
		return value?.value ? { ...DEFAULT_FEES, ...(JSON.parse(value.value) as PaymentFees) } : DEFAULT_FEES;
	} catch {
		return DEFAULT_FEES;
	}
}

export async function catalogVersion() {
	const value = await requestValue<{ key: string; value: string } | undefined>('metadata', 'readonly', (store) => store.get('catalog'));
	return value?.value ?? 'offline-unknown';
}

export async function saveDraft(draft: unknown) {
	await requestValue('drafts', 'readwrite', (store) => store.put({ key: 'current', value: draft }));
}

export async function loadDraft<T>() {
	const value = await requestValue<{ key: string; value: T } | undefined>('drafts', 'readonly', (store) => store.get('current'));
	return value?.value;
}

export async function clearDraft() {
	await requestValue('drafts', 'readwrite', (store) => store.delete('current'));
}

export type OfflineAuthSession = {
	user: { id: string; username: string; role: string };
	expiresAt: string;
};

export async function saveAuthSession(session: OfflineAuthSession) {
	await requestValue('auth', 'readwrite', (store) => store.put({ key: 'current', value: session }));
}

export async function loadAuthSession(): Promise<OfflineAuthSession | null> {
	const row = await requestValue<{ key: string; value: OfflineAuthSession } | undefined>('auth', 'readonly', (store) =>
		store.get('current'),
	);
	const session = row?.value;
	if (!session || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
		await clearAuthSession();
		return null;
	}
	return session;
}

export async function clearAuthSession() {
	await requestValue('auth', 'readwrite', (store) => store.delete('current'));
}

export async function enqueueOperation(operation: OperationEnvelope) {
	const db = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(['operations', 'metadata'], 'readwrite');
		addToQueue(tx, operation);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Falha ao guardar a operação.'));
	});
}

function addToQueue(tx: IDBTransaction, operation: OperationEnvelope) {
	const metadata = tx.objectStore('metadata');
	const request = metadata.get('queue-sequence');
	request.onsuccess = () => {
		const sequence = Number(request.result?.value ?? 0) + 1;
		metadata.put({ key: 'queue-sequence', value: sequence });
		tx.objectStore('operations').add({
			operation,
			state: 'pending',
			queuedAt: new Date().toISOString(),
			sequence,
		} satisfies QueuedOperation);
	};
}

export async function commitSaleAndClearDraft(operation: OperationEnvelope) {
	const db = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(['operations', 'drafts', 'metadata'], 'readwrite');
		addToQueue(tx, operation);
		tx.objectStore('drafts').delete('current');
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Falha ao registrar a venda localmente.'));
		tx.onabort = () => reject(tx.error ?? new Error('A venda local foi cancelada.'));
	});
}

export async function listQueue(): Promise<QueuedOperation[]> {
	const rows = (await requestValue('operations', 'readonly', (store) => store.getAll())) as QueuedOperation[];
	return rows.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.queuedAt.localeCompare(b.queuedAt));
}

export async function removeQueuedOperation(operationId: string) {
	const db = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction('operations', 'readwrite');
		tx.objectStore('operations').delete(operationId);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Falha ao remover a operação.'));
	});
}

async function updateQueue(record: QueuedOperation) {
	await requestValue('operations', 'readwrite', (store) => store.put(record));
}

export async function createSaleOperation(
	deviceId: string,
	actorUserId: string,
	actorLabel: string,
	occurredAt: string,
	payload: Extract<OperationEnvelope['payload'], { items: unknown[] }>,
) {
	const operationId = crypto.randomUUID();
	const operation: OperationEnvelope = {
		operationId,
		deviceId,
		actor: { userId: actorUserId, label: actorLabel },
		operationType: 'sale.create',
		occurredAt,
		clientCreatedAt: new Date().toISOString(),
		catalogVersion: await catalogVersion(),
		hashVersion: 'pdv-op/v1',
		payloadHash: '0'.repeat(64),
		payload: {
			...payload,
			saleId: operationIdentity('sale.create', operationId).saleId,
		},
	};
	operation.payloadHash = await operationPayloadHash(operation);
	return operation;
}

export async function createOperation(
	deviceId: string,
	actorUserId: string,
	actorLabel: string,
	operationType: OperationType,
	payload: OperationEnvelope['payload'],
	occurredAt = new Date().toISOString(),
) {
	const operation: OperationEnvelope = {
		operationId: crypto.randomUUID(),
		deviceId,
		actor: { userId: actorUserId, label: actorLabel },
		operationType,
		occurredAt,
		clientCreatedAt: new Date().toISOString(),
		catalogVersion: await catalogVersion(),
		hashVersion: 'pdv-op/v1',
		payloadHash: '0'.repeat(64),
		payload,
	};
	operation.payloadHash = await operationPayloadHash(operation);
	return operation;
}

export async function syncQueue(onChange?: () => void, actorUserId?: string) {
	const authenticatedActor = actorUserId ?? (await loadAuthSession())?.user.id;
	if (!authenticatedActor) return;
	const work = async () => {
		const rows = await listQueue();
		for (const row of rows) {
			if (row.state === 'synced' || row.state === 'duplicate') continue;
			if (!['pending', 'syncing', 'auth_required'].includes(row.state)) break;
			if (!canSyncOperation(row.operation.actor.userId, authenticatedActor)) break;
			await updateQueue({ ...row, state: 'syncing', error: undefined });
			onChange?.();
			let response: Response;
			try {
				response = await fetch('/api/pdv/operations', {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(row.operation),
				});
			} catch {
				await updateQueue({
					...row,
					state: 'pending',
					error: 'Sem conexão; a operação permanece na fila.',
				});
				onChange?.();
				break;
			}
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				status?: string;
				code?: string;
			};
			if (response.ok) await updateQueue({ ...row, state: 'synced', response: body });
			else if (response.status === 401 || response.status === 403) {
				await updateQueue({
					...row,
					state: 'auth_required',
					error: body.error ?? 'Entre novamente para sincronizar.',
				});
				onChange?.();
				break;
			} else if (body.status === 'rejected_duplicate' || (response.status === 409 && body.code === 'DUPLICATE_SALE')) {
				await updateQueue({
					...row,
					state: 'duplicate',
					error: body.error ?? 'Venda idêntica já registrada.',
					response: body,
				});
			} else if (response.status === 409)
				await updateQueue({
					...row,
					state: 'conflict',
					error: body.error ?? 'Conflito; revise antes de reenviar.',
					response: body,
				});
			else if (response.status >= 500 || response.status === 429) {
				await updateQueue({
					...row,
					state: 'pending',
					error: body.error ?? 'Servidor indisponível; nova tentativa pendente.',
				});
				onChange?.();
				break;
			} else
				await updateQueue({
					...row,
					state: 'invalid',
					error: body.error ?? 'Operação rejeitada; revise os dados.',
					response: body,
				});
			onChange?.();
			const duplicate = body.status === 'rejected_duplicate' || (response.status === 409 && body.code === 'DUPLICATE_SALE');
			if (
				(response.status === 409 && !duplicate) ||
				(!response.ok &&
					response.status < 500 &&
					response.status !== 409 &&
					response.status !== 429 &&
					response.status !== 401 &&
					response.status !== 403)
			)
				break;
		}
	};
	if (navigator.locks) return navigator.locks.request('sabores-pdv-sync', work);
	return work();
}
