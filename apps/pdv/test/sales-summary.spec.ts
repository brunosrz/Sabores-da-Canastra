import { describe, expect, it } from 'vitest';
import { summarizeSales } from '../src/sales-summary';

describe('resumo de vendas', () => {
	it('exclui cancelamentos e soma pagamentos e itens das vendas ativas', () => {
		const sale = {
			gross_cents: 1000,
			fee_cents: 30,
			net_cents: 970,
			cancellation_reason: null,
			items: [{ product_name_snapshot: 'Coxinha', quantity: '2', line_total_cents: 1000 }],
			payments: [
				{ method: 'Pix', amount_cents: 400 },
				{ method: 'Crédito', amount_cents: 600 },
			],
		};
		const summary = summarizeSales([sale, { ...sale, cancellation_reason: 'Engano' }]);
		expect(summary).toEqual({
			count: 1,
			gross: 1000,
			fees: 30,
			net: 970,
			payments: [
				['Pix', 400],
				['Crédito', 600],
			],
			products: [['Coxinha', { quantity: 2, total: 1000 }]],
		});
	});
});
