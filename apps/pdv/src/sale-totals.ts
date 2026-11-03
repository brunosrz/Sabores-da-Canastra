import { lineTotalCents } from '@sabores/pdv-sync';

export type SaleLine = { quantity: string; product: { sale_price_cents: number | null } };

export function normalizedQuantity(value: string): string {
	return value.trim().replace(',', '.');
}

export function lineAmount(line: SaleLine): number | null {
	if (line.product.sale_price_cents == null) return null;
	return lineTotalCents(normalizedQuantity(line.quantity), line.product.sale_price_cents);
}

export function basketAmount(lines: SaleLine[]): number | null {
	let total = 0;
	for (const line of lines) {
		const amount = lineAmount(line);
		if (amount === null || !Number.isSafeInteger(total + amount)) return null;
		total += amount;
	}
	return total;
}
