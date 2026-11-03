// @vitest-environment jsdom
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '../src/auth-gate';
import { withAuthMutation } from '../src/auth-coordination';

const storage = vi.hoisted(() => ({
	clearErpSession: vi.fn(),
	loadErpSession: vi.fn(),
	saveErpSession: vi.fn(),
	hasPendingLogout: vi.fn(),
	setPendingLogout: vi.fn(),
	clearPendingLogout: vi.fn(),
}));
vi.mock('../src/offline/store', () => storage);
vi.mock('@sabores/ui', () => ({
	AppShell: ({ children, account }: { children: React.ReactNode; account: React.ReactNode }) =>
		createElement('div', null, account, children),
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => createElement('button', props, children),
}));
let cookieLock: Promise<unknown>;
beforeEach(() => {
	vi.resetAllMocks();
	cookieLock = Promise.resolve();
	storage.hasPendingLogout.mockResolvedValue(false);
	Object.defineProperty(navigator, 'locks', {
		configurable: true,
		value: {
			request: vi.fn((_name: string, work: () => Promise<unknown>) => {
				const task = cookieLock.then(work);
				cookieLock = task.catch(() => undefined);
				return task;
			}),
		},
	});
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ user: { id: 'owner', username: 'Teste', role: 'owner' }, expiresAt: '2099-01-01T00:00:00Z' })),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(createElement(QueryClientProvider, { client }, createElement(AuthGate, null, 'Conteúdo privado')));
	return client;
}
describe('coordenação da sessão ERP', () => {
	it('preserva sessão quando não consegue persistir o logout', async () => {
		const client = mount();
		await screen.findByRole('button', { name: 'Sair' });
		storage.setPendingLogout.mockRejectedValueOnce(new Error('quota'));
		fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
		await screen.findByText('Não foi possível salvar a saída neste dispositivo. Tente novamente.');
		expect(client.getQueryData(['auth', 'session'])).toMatchObject({ id: 'owner' });
		expect(storage.clearErpSession).not.toHaveBeenCalled();
		expect(screen.getByText('Conteúdo privado')).toBeTruthy();
	});
	it('encerra a sessão local e informa saída pendente se o POST falhar', async () => {
		const client = mount();
		await screen.findByRole('button', { name: 'Sair' });
		storage.hasPendingLogout.mockResolvedValue(true);
		vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 503 }));
		fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
		await screen.findByText('Sessão encerrada neste dispositivo; o servidor será avisado quando houver conexão.');
		expect(client.getQueryData(['auth', 'session'])).toBeNull();
		expect(storage.clearPendingLogout).not.toHaveBeenCalled();
	});
	it('serializa o POST de login atrás de um logout em andamento em outra aba', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
		mount();
		await screen.findByRole('heading', { name: 'Entrar no ERP' });
		let release: () => void = () => {};
		const outgoing = withAuthMutation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		await Promise.resolve();
		fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'Teste' } });
		fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-teste' } });
		fireEvent.submit(screen.getByRole('button', { name: 'Entrar' }).closest('form')!);
		await Promise.resolve();
		expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/auth/login')).toBe(false);
		release();
		await outgoing;
		await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/auth/login')).toBe(true));
	});
});
