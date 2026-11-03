import { describe, expect, it } from 'vitest';
import { basketAmount, lineAmount, normalizedQuantity } from '../src/sale-totals';

describe('totais do pedido', () => {
	it('aceita vírgula e soma valores em centavos', () => {
		expect(normalizedQuantity(' 1,25 ')).toBe('1.25');
		expect(
			basketAmount([
				{ quantity: '1,25', product: { sale_price_cents: 100 } },
				{ quantity: '2', product: { sale_price_cents: 150 } },
			]),
		).toBe(425);
	});
	it('não apresenta quantidade ou preço inválidos como zero', () => {
		expect(lineAmount({ quantity: '0', product: { sale_price_cents: 100 } })).toBeNull();
		expect(lineAmount({ quantity: '1,2345', product: { sale_price_cents: 100 } })).toBeNull();
		expect(basketAmount([{ quantity: '1', product: { sale_price_cents: null } }])).toBeNull();
	});
	it('não apresenta um total inseguro', () => {
		expect(
			basketAmount([
				{ quantity: '1', product: { sale_price_cents: Number.MAX_SAFE_INTEGER } },
				{ quantity: '1', product: { sale_price_cents: 1 } },
			]),
		).toBeNull();
	});
});
