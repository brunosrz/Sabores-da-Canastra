import { t } from '@sabores/i18n';
import { isOnline, watchLifecycle } from '@sabores/ui/lifecycle';
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
			if (await isOnline()) {
				setSyncing(true);
				try {
					await syncPriceQueue();
				} catch {
					if (active) setFailure('Não foi possível sincronizar; os ajustes permanecem no dispositivo.');
				} finally {
					if (active) setSyncing(false);
				}
			}
			const operations = await listPriceOperations().catch(() => []);
			if (!active) return;
			setPending(operations.filter((operation) => operation.state === 'pending' || operation.state === 'blocked_auth').length);
			setConflicts(operations.filter((operation) => operation.state === 'conflict').length);
			setConflictOperations(operations.filter((operation) => operation.state === 'conflict'));
		};
		const stopWatching = watchLifecycle(
			(connected) => {
				setOnline(connected);
				if (connected) void refresh();
			},
			() => {
				void refresh();
			},
		);
		void isOnline()
			.then((connected) => {
				if (active) setOnline(connected);
			})
			.catch(() => {});
		const timer = window.setInterval(() => {
			void refresh();
		}, 20_000);
		window.addEventListener('erp-price-queue-changed', refresh);
		void refresh();
		return () => {
			active = false;
			window.clearInterval(timer);
			stopWatching();
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
						{online
							? t('Online · {p0} ajuste(s) na fila', { p0: pending })
							: t('Offline · {p0} ajuste(s) neste dispositivo', { p0: pending })}
						{conflicts ? t(' · {p0} conflito(s) para revisar', { p0: conflicts }) : ''}
					</span>
					{online && pending > 0 ? (
						<button type="button" onClick={() => void syncNow()} disabled={syncing}>
							{syncing ? t('Sincronizando…') : t('Sincronizar agora')}
						</button>
					) : null}
					{conflictOperations.map((operation) => (
						<button
							key={operation.operationId}
							type="button"
							disabled={!online}
							onClick={() => {
								if (!window.confirm(t('Descartar este ajuste de preço rejeitado?'))) return;
								void refreshProducts()
									.then(() => discardPriceConflict(operation.operationId))
									.then(() => window.dispatchEvent(new Event('erp-catalog-changed')))
									.catch(() => setFailure('Não foi possível atualizar o catálogo; o ajuste foi preservado.'));
							}}
						>
							{t('Descartar ajuste rejeitado (')}
							{operation.productId})
						</button>
					))}
					{failure ? <span role="alert">{failure}</span> : null}
				</div>
			) : null}
			{children}
		</>
	);
}
