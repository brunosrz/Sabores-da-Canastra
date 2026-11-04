import type { CachedProduct } from './offline/store';

const normalize = (value: string) =>
	value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase()
		.trim();

export function searchProducts(products: CachedProduct[], term: string): CachedProduct[] {
	const query = normalize(term);
	return products.filter((product) => {
		if (product.active === false || product.active === 0) return false;
		return !query || [product.name, product.barcode ?? '', product.auxiliary_code ?? ''].some((value) => normalize(value).includes(query));
	});
}

export function exactCodeMatch(products: CachedProduct[], term: string): CachedProduct | undefined {
	const query = normalize(term);
	if (!query) return undefined;
	const matches = products.filter((product) => [product.barcode, product.auxiliary_code].some((code) => code && normalize(code) === query));
	return matches.length === 1 ? matches[0] : undefined;
}
