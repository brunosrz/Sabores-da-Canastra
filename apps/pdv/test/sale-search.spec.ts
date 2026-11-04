import { describe, expect, it } from 'vitest';
import { exactCodeMatch, searchProducts } from '../src/sale-search';
import type { CachedProduct } from '../src/offline/store';

const products: CachedProduct[] = [
	{
		product_id: '1',
		name: 'Coxinha de frango',
		category: 'Salgados',
		unit: 'un',
		barcode: '123',
		auxiliary_code: 'FR-1',
		sale_price_cents: 800,
	},
	{
		product_id: '2',
		name: 'Pão de queijo',
		category: 'Salgados',
		unit: 'un',
		barcode: '456',
		auxiliary_code: 'FR-1',
		sale_price_cents: 700,
	},
	{ product_id: '3', name: 'Inativo', category: 'Bebidas', unit: 'un', sale_price_cents: 100, active: false },
];

describe('pesquisa de produtos', () => {
	it('mostra todos os produtos ativos na busca vazia', () => {
		expect(searchProducts(products, '')).toHaveLength(2);
	});
	it('busca nome sem exigir acentos e códigos, sem buscar pela categoria', () => {
		expect(searchProducts(products, 'pao')[0]?.product_id).toBe('2');
		expect(searchProducts(products, '123')[0]?.product_id).toBe('1');
		expect(searchProducts(products, 'salgados')).toHaveLength(0);
	});
	it('identifica apenas código exato e único', () => {
		expect(exactCodeMatch(products, '123')?.product_id).toBe('1');
		expect(exactCodeMatch(products, 'FR-1')).toBeUndefined();
		expect(exactCodeMatch(products, 'Coxinha de frango')).toBeUndefined();
		expect(exactCodeMatch(products, '')).toBeUndefined();
	});
});
