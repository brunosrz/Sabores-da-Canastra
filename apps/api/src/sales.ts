export interface SaleInput {
  occurred_on: string;
  occurred_at?: string;
  client_created_at?: string;
  customer?: string | null;
  notes?: string | null;
  items: Array<{
    product_id?: string | null;
    name: string;
    category: string;
    quantity: number;
    unit_price_cents: number;
    unit_cost_cents?: number | null;
  }>;
  payments: Array<{
    method: "Dinheiro" | "Débito" | "Crédito" | "Pix" | "Outro";
    method_label?: string | null;
    amount_cents: number;
    fee_rate: number;
    fee_cents: number;
  }>;
}

const VALID_PAYMENT_METHODS = new Set([
  "Dinheiro",
  "Débito",
  "Crédito",
  "Pix",
  "Outro",
]);

function isOptionalText(value: unknown, maxLength: number): boolean {
  return (
    value == null || (typeof value === "string" && value.length <= maxLength)
  );
}

function isMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export async function validateSale(
  input: unknown,
  db?: D1Database,
): Promise<boolean> {
  if (!input || typeof input !== "object") return false;
  const sale = input as Partial<SaleInput>;
  if (!isOptionalText(sale.customer, 200)) return false;
  if (!isOptionalText(sale.notes, 2000)) return false;
  if (
    !sale.occurred_on ||
    !/^\d{4}-\d{2}-\d{2}$/.test(sale.occurred_on) ||
    !Number.isFinite(Date.parse(`${sale.occurred_on}T00:00:00.000Z`)) ||
    new Date(`${sale.occurred_on}T00:00:00.000Z`).toISOString().slice(0, 10) !==
      sale.occurred_on
  )
    return false;
  for (const timestamp of [sale.occurred_at, sale.client_created_at]) {
    if (
      timestamp != null &&
      (typeof timestamp !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
          timestamp,
        ) ||
        !Number.isFinite(Date.parse(timestamp)))
    )
      return false;
  }
  if (
    !Array.isArray(sale.items) ||
    sale.items.length === 0 ||
    sale.items.length > 70
  )
    return false;
  if (
    !Array.isArray(sale.payments) ||
    sale.payments.length === 0 ||
    sale.payments.length > 20
  )
    return false;
  for (const item of sale.items) {
    if (
      !item ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 200
    )
      return false;
    if (typeof item.category !== "string" || !item.category.trim())
      return false;
    if (item.category.length > 100) return false;
    if (!isOptionalText(item.product_id, 200)) return false;
    if (
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > 10000
    )
      return false;
    if (!isMoney(item.unit_price_cents)) return false;
    if (item.unit_cost_cents != null && !isMoney(item.unit_cost_cents))
      return false;
  }
  for (const payment of sale.payments) {
    if (!payment || typeof payment !== "object") return false;
    if (!VALID_PAYMENT_METHODS.has(payment.method)) return false;
    if (!isOptionalText(payment.method_label, 100)) return false;
    if (!isMoney(payment.amount_cents) || !isMoney(payment.fee_cents))
      return false;
    if (
      !Number.isFinite(payment.fee_rate) ||
      payment.fee_rate < 0 ||
      payment.fee_rate > 1
    )
      return false;
    if (
      Math.round(payment.amount_cents * payment.fee_rate) !== payment.fee_cents
    )
      return false;
  }
  const productIds = [
    ...new Set(
      sale.items.flatMap((item) =>
        typeof item.product_id === "string" ? [item.product_id] : [],
      ),
    ),
  ];
  if (productIds.length > 0) {
    if (!db) return false;
    const placeholders = productIds.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT product_id FROM products WHERE product_id IN (${placeholders})`,
      )
      .bind(...productIds)
      .all<{ product_id: string }>();
    const existingIds = new Set(results.map((product) => product.product_id));
    if (productIds.some((productId) => !existingIds.has(productId)))
      return false;
  }
  const gross = sale.items.reduce(
    (sum, item) => sum + Math.round(item.quantity * item.unit_price_cents),
    0,
  );
  const paid = sale.payments.reduce(
    (sum, payment) => sum + payment.amount_cents,
    0,
  );
  const fee = sale.payments.reduce(
    (sum, payment) => sum + payment.fee_cents,
    0,
  );
  return Number.isSafeInteger(gross) && gross === paid && fee <= gross;
}
