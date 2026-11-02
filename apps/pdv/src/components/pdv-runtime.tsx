import { useEffect, useState, type ReactNode } from 'react';
import { listQueue, syncQueue } from '../offline/store';

export function PdvRuntime({ children }: { children: ReactNode }) {
	const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
	const [pending, setPending] = useState(0);
	const [updateReady, setUpdateReady] = useState(false);

	async function refreshQueue() {
		const rows = await listQueue().catch(() => []);
		setPending(rows.filter((row) => ['pending', 'syncing', 'auth_required'].includes(row.state)).length);
	}

	useEffect(() => {
		const onlineHandler = () => {
			setOnline(true);
			void syncQueue(refreshQueue).then(refreshQueue);
		};
		const offlineHandler = () => setOnline(false);
		const interval = window.setInterval(() => {
			if (navigator.onLine) void syncQueue(refreshQueue).then(refreshQueue);
		}, 20_000);
		window.addEventListener('online', onlineHandler);
		window.addEventListener('offline', offlineHandler);
		void syncQueue(refreshQueue).then(refreshQueue);
		if (import.meta.env.PROD && 'serviceWorker' in navigator) {
			void navigator.serviceWorker
				.register('/sw.js', { updateViaCache: 'none' })
				.then((registration) => {
					if (registration.waiting) setUpdateReady(true);
					registration.addEventListener('updatefound', () => {
						registration.installing?.addEventListener('statechange', () => {
							if (registration.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
						});
					});
				})
				.catch((error) => console.error('Falha ao ativar modo instalável.', error));
		}
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('online', onlineHandler);
			window.removeEventListener('offline', offlineHandler);
		};
	}, []);

	function acceptUpdate() {
		if (pending > 0) return;
		navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
		navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
	}

	return (
		<>
			<div className="pdv-runtime-status" role="status" aria-live="polite">
				<span className={online ? 'status-online' : 'status-offline'}>{online ? 'Online' : 'Offline'}</span>
				<span>{pending ? `${pending} pendente${pending === 1 ? '' : 's'} na fila` : 'Fila em dia'}</span>
			</div>
			{!online ? (
				<div role="status" className="offline-banner">
					Sem internet. A venda será salva neste dispositivo e sincronizada quando a conexão voltar.
				</div>
			) : null}
			{updateReady ? (
				<div role="status" className="offline-banner">
					Nova versão disponível.{' '}
					{pending ? (
						'Sincronize as vendas pendentes antes de atualizar.'
					) : (
						<button type="button" className="demo-button" onClick={acceptUpdate}>
							Atualizar agora
						</button>
					)}
				</div>
			) : null}
			{children}
		</>
	);
}
