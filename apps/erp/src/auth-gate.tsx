import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type User = { id: string; username: string; role: string };

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
					<input
						id="password"
						name="password"
						type="password"
						autoComplete="current-password"
						required
						maxLength={128}
						className="mt-2 w-full rounded-xl border border-black/20 bg-transparent px-4 py-3 outline-none focus:ring-2 focus:ring-[#fca336]"
					/>
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
		<>
			<div className="flex justify-end gap-3 px-5 py-3 text-sm">
				<span>
					Conectado como <strong>{user.username}</strong>
				</span>
				{error ? (
					<span role="alert" className="text-red-700 dark:text-red-300">
						{error}
					</span>
				) : null}
				<button type="button" disabled={busy} onClick={() => void signOut()} className="font-semibold text-[#cf4712] underline">
					Sair
				</button>
			</div>
			{children}
		</>
	);
}
