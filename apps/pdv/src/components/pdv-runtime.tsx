import { t } from '@sabores/i18n';
import { Capacitor } from '@capacitor/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { listQueue, syncQueue } from '../offline/store';

export function PdvRuntime({ children }: { children: ReactNode }) {
	const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
	const [pending, setPending] = useState(0);
	const [updateReady, setUpdateReady] = useState(false);
	const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

	async function refreshQueue() {
		const rows = await listQueue().catch(() => []);
		setPending(rows.filter((row) => ['pending', 'syncing', 'auth_required'].includes(row.state)).length);
	}

	useEffect(() => {
		if ('storage' in navigator && 'persist' in navigator.storage) void navigator.storage.persist().catch(() => false);
		const onControllerChange = () => location.reload();
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
		if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
		void syncQueue(refreshQueue).then(refreshQueue);
		if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
			void navigator.serviceWorker
				.register('/sw.js', { updateViaCache: 'none' })
				.then((activeRegistration) => {
					registrationRef.current = activeRegistration;
					if (activeRegistration.waiting) setUpdateReady(true);
					activeRegistration.addEventListener('updatefound', () => {
						activeRegistration.installing?.addEventListener('statechange', () => {
							if (activeRegistration.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
						});
					});
				})
				.catch((error) => console.error('Falha ao ativar modo instalável.', error));
		}
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('online', onlineHandler);
			window.removeEventListener('offline', offlineHandler);
			if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
		};
	}, []);

	function acceptUpdate() {
		if (pending > 0) return;
		void navigator.serviceWorker.getRegistration().then((activeRegistration) => {
			(activeRegistration?.waiting ?? registrationRef.current?.waiting)?.postMessage({ type: 'SKIP_WAITING' });
		});
	}

	return (
		<>
			<div className="pdv-runtime-status" role="status" aria-live="polite">
				<span className={online ? 'status-online' : 'status-offline'}>{online ? t('Online') : t('Offline')}</span>
				<span>{pending ? t('{p0} pendente{p1} na fila', { p0: pending, p1: pending === 1 ? '' : 's' }) : t('Fila em dia')}</span>
			</div>
			{!online ? (
				<div role="status" className="offline-banner">
					{t('Sem internet. A venda será salva neste dispositivo e sincronizada quando a conexão voltar. ')}
				</div>
			) : null}
			{updateReady ? (
				<div role="status" className="offline-banner">
					{t('Nova versão disponível.')}{' '}
					{pending ? (
						t('Sincronize as vendas pendentes antes de atualizar.')
					) : (
						<button type="button" className="demo-button" onClick={acceptUpdate}>
							{t('Atualizar agora ')}
						</button>
					)}
				</div>
			) : null}
			{children}
		</>
	);
}
