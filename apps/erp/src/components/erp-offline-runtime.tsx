import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { discardPriceConflict, listPriceOperations, refreshProducts, syncPriceQueue, type PriceOperation } from '../offline/store';

export function ErpOfflineRuntime({ children }: { children: ReactNode }) {
	const [online, setOnline] = useState(typeof navigator === 'undefined' || navigator.onLine);
	const [pending, setPending] = useState(0);
	const [conflicts, setConflicts] = useState(0);
	const [conflictOperations, setConflictOperations] = useState<PriceOperation[]>([]);
	const [failure, setFailure] = useState('');
	const [syncing, setSyncing] = useState(false);
	useEffect(() => {
		let active = true;
		const refresh = async () => {
			if (navigator.onLine) {
				setSyncing(true);
				await syncPriceQueue();
				if (active) setSyncing(false);
			}
			const operations = await listPriceOperations().catch(() => []);
			if (!active) return;
			setPending(operations.filter((operation) => operation.state === 'pending' || operation.state === 'blocked_auth').length);
			setConflicts(operations.filter((operation) => operation.state === 'conflict').length);
			setConflictOperations(operations.filter((operation) => operation.state === 'conflict'));
		};
		const onOnline = () => {
			setOnline(true);
			void refresh();
		};
		const onOffline = () => setOnline(false);
		const timer = window.setInterval(() => {
			if (navigator.onLine) void refresh();
		}, 20_000);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		window.addEventListener('erp-price-queue-changed', refresh);
		void refresh();
		return () => {
			active = false;
			window.clearInterval(timer);
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
			window.removeEventListener('erp-price-queue-changed', refresh);
		};
	}, []);
	const syncNow = useCallback(async () => {
		setSyncing(true);
		await syncPriceQueue();
		const operations = await listPriceOperations().catch(() => []);
		setPending(operations.filter((operation) => operation.state === 'pending' || operation.state === 'blocked_auth').length);
		setConflicts(operations.filter((operation) => operation.state === 'conflict').length);
		setConflictOperations(operations.filter((operation) => operation.state === 'conflict'));
		setSyncing(false);
	}, []);
	return (
		<>
			{!online || pending > 0 || conflicts > 0 ? (
				<div className="erp-offline-status" role="status">
					<span>
						{online ? `Online · ${pending} ajuste(s) na fila` : `Offline · ${pending} ajuste(s) neste dispositivo`}
						{conflicts ? ` · ${conflicts} conflito(s) para revisar` : ''}
					</span>
					{online && pending > 0 ? (
						<button type="button" onClick={() => void syncNow()} disabled={syncing}>
							{syncing ? 'Sincronizando…' : 'Sincronizar agora'}
						</button>
					) : null}
					{conflictOperations.map((operation) => (
						<button
							key={operation.operationId}
							type="button"
							disabled={!online}
							onClick={() => {
								if (!window.confirm('Descartar este ajuste de preço rejeitado?')) return;
								void refreshProducts()
									.then(() => discardPriceConflict(operation.operationId))
									.then(() => window.dispatchEvent(new Event('erp-catalog-changed')))
									.catch(() => setFailure('Não foi possível atualizar o catálogo; o ajuste foi preservado.'));
							}}
						>
							Descartar ajuste rejeitado ({operation.productId})
						</button>
					))}
					{failure ? <span role="alert">{failure}</span> : null}
				</div>
			) : null}
			{children}
		</>
	);
}
