export type SummarySale = {
	gross_cents: number;
	fee_cents: number;
	net_cents: number;
	cancellation_reason: string | null;
	items: Array<{ product_name_snapshot: string; quantity: string; line_total_cents: number }>;
	payments: Array<{ method: string; amount_cents: number }>;
};

export function summarizeSales(sales: SummarySale[]) {
	const active = sales.filter((sale) => sale.cancellation_reason === null);
	const payments = new Map<string, number>();
	const products = new Map<string, { quantity: number; total: number }>();
	for (const sale of active) {
		for (const payment of sale.payments) payments.set(payment.method, (payments.get(payment.method) ?? 0) + payment.amount_cents);
		for (const item of sale.items) {
			const previous = products.get(item.product_name_snapshot) ?? { quantity: 0, total: 0 };
			products.set(item.product_name_snapshot, {
				quantity: previous.quantity + Number(item.quantity),
				total: previous.total + item.line_total_cents,
			});
		}
	}
	return {
		count: active.length,
		gross: active.reduce((total, sale) => total + sale.gross_cents, 0),
		fees: active.reduce((total, sale) => total + sale.fee_cents, 0),
		net: active.reduce((total, sale) => total + sale.net_cents, 0),
		payments: [...payments.entries()],
		products: [...products.entries()],
	};
}
