// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FinancePrototype, ProductsPrototype } from '../src/prototype/pages';
const store = vi.hoisted(() => ({
	enqueuePriceChange: vi.fn(),
	listPriceOperations: vi.fn(),
	loadProducts: vi.fn(),
	refreshProducts: vi.fn(),
	syncPriceQueue: vi.fn(),
}));
vi.mock('../src/offline/store', () => store);
vi.mock('@sabores/ui', () => {
	const box = ({ children }: { children?: React.ReactNode }) => createElement('div', null, children);
	return {
		Badge: box,
		Card: box,
		CategoryBadge: box,
		EmptyState: box,
		PageHeader: ({ title }: { title: string }) => createElement('h1', null, title),
		Price: ({ cents }: { cents: number }) => createElement('span', null, String(cents)),
		ResponsiveTable: box,
	};
});
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
it('ignora sucesso e erro de consultas antigas e identifica cancelamentos', async () => {
	const requests: { resolve: (value: Response) => void; reject: (reason: Error) => void }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(() => new Promise<Response>((resolve, reject) => requests.push({ resolve, reject }))),
	);
	render(createElement(FinancePrototype));
	fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-01-01' } });
	fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-01-02' } });
	fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
	fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-02-01' } });
	fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-02-02' } });
	fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
	requests[2]!.resolve(Response.json({ data: [{ entry_type: 'sale', total: 222 }] }));
	requests[3]!.resolve(
		Response.json({
			data: [
				{
					ledger_id: 'cancelled',
					occurred_on: '2026-02-01',
					entry_type: 'sale',
					description: 'Venda antiga',
					category: 'Teste',
					amount_cents: 50,
					cancelled: 1,
				},
			],
			truncated: false,
		}),
	);
	await screen.findByText('Período consultado: 2026-02-01 a 2026-02-02.');
	expect(screen.getByText(/Venda cancelada/)).toBeTruthy();
	await act(async () => {
		requests[0]!.resolve(Response.json({ data: [{ entry_type: 'sale', total: 111 }] }));
		requests[1]!.resolve(Response.json({ data: [], truncated: true }));
	});
	expect(screen.queryByText('111')).toBeNull();
	expect(screen.getByText('222')).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
	fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
	requests[6]!.resolve(Response.json({ data: [{ entry_type: 'sale', total: 333 }] }));
	requests[7]!.resolve(Response.json({ data: [], truncated: false }));
	await screen.findByText('333');
	await act(async () => {
		requests[4]!.reject(new Error('consulta antiga falhou'));
		requests[5]!.resolve(Response.json({ data: [] }));
	});
	expect(screen.queryByText('consulta antiga falhou')).toBeNull();
	expect(screen.getByText('333')).toBeTruthy();
});
it('exibe a falha de recarga do catálogo disparada por evento', async () => {
	store.loadProducts.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('IndexedDB indisponível'));
	store.refreshProducts.mockResolvedValue([]);
	render(createElement(ProductsPrototype));
	await screen.findByText('0 produtos sincronizados com o D1');
	window.dispatchEvent(new Event('erp-catalog-changed'));
	await screen.findByText('Não foi possível atualizar o catálogo local.');
});
