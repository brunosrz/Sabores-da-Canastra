import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell, Button } from '@sabores/ui';

type User = { id: string; username: string; role: string };
const NAV_ITEMS = [
	{ to: '/', label: 'Início', icon: '⌂' },
	{ to: '/produtos', label: 'Produtos', icon: '▦' },
	{ to: '/estoque', label: 'Estoque', icon: '▤' },
	{ to: '/financeiro', label: 'Financeiro', icon: 'R$' },
	{ to: '/ajustes', label: 'Ajustes', icon: '⚙' },
];

export function AuthGate({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const session = useQuery({
		queryKey: ['auth', 'session'],
		queryFn: async (): Promise<User | null> => {
			const response = await fetch('/api/auth/session', {
				credentials: 'same-origin',
				cache: 'no-store',
			});
			if (response.status === 401) return null;
			if (!response.ok) throw new Error('session unavailable');
			const body = (await response.json()) as { user?: User };
			return body.user ?? null;
		},
		retry: false,
		staleTime: 0,
	});
	const user = session.data ?? null;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formElement = event.currentTarget;
		setBusy(true);
		setError('');
		const form = new FormData(formElement);
		try {
			const response = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({
					username: form.get('username'),
					password: form.get('password'),
				}),
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => ({}))) as {
					error?: string;
				};
				setError(body.error ?? 'Não foi possível entrar.');
			} else {
				const body = (await response.json()) as { user: User };
				queryClient.setQueryData(['auth', 'session'], body.user);
				formElement.reset();
			}
		} catch {
			setError('Não foi possível entrar. Verifique a conexão e tente novamente.');
		} finally {
			setBusy(false);
		}
	}

	async function signOut() {
		setBusy(true);
		try {
			const response = await fetch('/api/auth/logout', {
				method: 'POST',
				credentials: 'same-origin',
			});
			if (response.ok) queryClient.setQueryData(['auth', 'session'], null);
			else setError('Não foi possível encerrar a sessão. Tente novamente.');
		} catch {
			setError('Não foi possível encerrar a sessão. Tente novamente.');
		} finally {
			setBusy(false);
		}
	}

	if (session.isPending)
		return (
			<main className="grid min-h-screen place-items-center px-6">
				<p role="status">Validando acesso…</p>
			</main>
		);
	if (!user)
		return (
			<main className="grid min-h-screen place-items-center bg-[var(--sea-foam)] px-5 py-10 dark:bg-[#181818]">
				<form
					onSubmit={submit}
					className="w-full max-w-md rounded-3xl border border-black/10 bg-white p-7 shadow-xl dark:border-white/10 dark:bg-[#242424] sm:p-9"
				>
					<img
						src="/brand/logo-sabores-canastra.svg"
						alt="Sabores da Canastra — sabor caseiro, feito em família"
						width="1600"
						height="520"
						decoding="async"
						className="mb-5 h-auto w-full"
					/>
					<h1 className="text-3xl font-bold text-[var(--sea-ink)]">Entrar no ERP</h1>
					<p className="mt-2 text-[var(--sea-ink-soft)]">Use seu usuário e senha para continuar.</p>
					<label className="mt-7 block text-sm font-semibold" htmlFor="username">
						Usuário
					</label>
					<input
						id="username"
						name="username"
						autoComplete="username"
						required
						maxLength={80}
						className="mt-2 w-full rounded-xl border border-black/20 bg-transparent px-4 py-3 outline-none focus:ring-2 focus:ring-[#fca336]"
					/>
					<label className="mt-4 block text-sm font-semibold" htmlFor="password">
						Senha
					</label>
					<div className="relative mt-2">
						<input
							id="password"
							name="password"
							type={showPassword ? 'text' : 'password'}
							autoComplete="current-password"
							required
							maxLength={128}
							className="w-full rounded-xl border border-black/20 bg-transparent px-4 py-3 pr-12 outline-none focus:ring-2 focus:ring-[#fca336]"
						/>
						<button
							type="button"
							aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
							aria-pressed={showPassword}
							onClick={() => setShowPassword((visible) => !visible)}
							className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fca336]"
						>
							<svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
								{showPassword ? (
									<>
										<path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" />
										<path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1-1.2 2.1-2.3 3.2M6.2 6.2C3.9 7.7 2.8 9.8 2.5 12c.6 1.5 2.2 3.5 4.5 5a9.8 9.8 0 005 1.5" />
									</>
								) : (
									<>
										<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
										<circle cx="12" cy="12" r="2.5" />
									</>
								)}
							</svg>
						</button>
					</div>
					{error || session.isError ? (
						<p role="alert" className="mt-4 text-sm font-medium text-red-700 dark:text-red-300">
							{error || 'Não foi possível validar o acesso. Tente novamente.'}
						</p>
					) : null}
					<button
						type="submit"
						disabled={busy}
						className="mt-6 w-full rounded-xl bg-[#cf4712] px-4 py-3 font-bold text-white hover:bg-[#b83e0f] disabled:opacity-60"
					>
						{busy ? 'Aguarde…' : 'Entrar'}
					</button>
				</form>
			</main>
		);

	return (
		<AppShell
			appName="ERP · Sabores da Canastra"
			navItems={NAV_ITEMS}
			account={
				<>
					<span>
						Conectado como <strong>{user.username}</strong>
					</span>
					{error ? (
						<span role="alert" className="text-red-700 dark:text-red-300">
							{error}
						</span>
					) : null}
					<Button type="button" disabled={busy} onClick={() => void signOut()} variant="danger">
						Sair
					</Button>
				</>
			}
		>
			{children}
		</AppShell>
	);
}
