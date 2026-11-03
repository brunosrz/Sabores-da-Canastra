import { describe, expect, it } from 'vitest';
import { mergePendingPrices, type ErpProduct, type PriceOperation } from '../src/offline/store';

describe('sobreposição de preços offline', () => {
	it('usa o horário em vez da ordem aleatória dos IDs e ignora conflitos e sincronizados', () => {
		const product: ErpProduct = {
			product_id: 'p',
			name: 'Produto',
			category: 'Teste',
			unit: 'un',
			barcode: null,
			auxiliary_code: null,
			sale_price_cents: 500,
		};
		const operation = (
			operationId: string,
			occurredAt: string,
			salePriceCents: number,
			state: PriceOperation['state'] = 'pending',
		): PriceOperation => ({ operationId, occurredAt, salePriceCents, state, productId: 'p', basePriceCents: 500 });
		const operations = [
			operation('a', '2026-11-02T12:00:02Z', 700),
			operation('z', '2026-11-02T12:00:01Z', 600),
			operation('c', '2026-11-02T12:00:03Z', 800, 'conflict'),
			operation('d', '2026-11-02T12:00:04Z', 900, 'synced'),
		];
		expect(mergePendingPrices([product], operations)[0]?.sale_price_cents).toBe(700);
		expect(mergePendingPrices([product], [...operations].reverse())[0]?.sale_price_cents).toBe(700);
		expect(product.sale_price_cents).toBe(500);
	});
});
