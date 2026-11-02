import { Link } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { listQueue, syncQueue } from '../offline/store';

export function PdvRuntime({ children }: { children: ReactNode }) {
	const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
	const [pending, setPending] = useState(0);
	const [theme, setTheme] = useState<'light' | 'dark'>(() => {
		if (typeof window === 'undefined') return 'light';
		const saved = localStorage.getItem('theme');
		return saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	});
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

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);

	function changeTheme() {
		const next = theme === 'dark' ? 'light' : 'dark';
		setTheme(next);
		document.documentElement.dataset.theme = next;
		localStorage.setItem('theme', next);
	}

	function acceptUpdate() {
		if (pending > 0) return;
		navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
		navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
	}

	return (
		<>
			<header className="pdv-topbar">
				<div>
					<strong>Sabores da Canastra</strong>
					<span className={online ? 'status-online' : 'status-offline'}>{online ? 'Online' : 'Offline'}</span>
				</div>
				<div className="pdv-topbar-actions">
					<span aria-live="polite">{pending ? `${pending} pendente${pending === 1 ? '' : 's'}` : 'Fila em dia'}</span>
					<button
						type="button"
						className="demo-button demo-button-secondary"
						onClick={changeTheme}
						aria-label={`Ativar tema ${theme === 'dark' ? 'claro' : 'escuro'}`}
					>
						{theme === 'dark' ? '☀' : '☾'}
					</button>
				</div>
			</header>
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
			<nav className="pdv-bottom-nav" aria-label="Navegação principal">
				<Link to="/" activeOptions={{ exact: true }} activeProps={{ className: 'active' }}>
					＋<span>Venda</span>
				</Link>
				<Link to="/historico" activeProps={{ className: 'active' }}>
					▤<span>Histórico</span>
				</Link>
				<button type="button" onClick={() => void syncQueue(refreshQueue).then(refreshQueue)}>
					↻<span>Sincronizar</span>
				</button>
			</nav>
		</>
	);
}
