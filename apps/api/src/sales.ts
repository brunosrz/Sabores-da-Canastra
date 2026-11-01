export interface SaleInput {
  occurred_on: string;
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

export type SaleResult = {
  sale_id: string;
  ledger_id: string;
  gross_cents: number;
  fee_cents: number;
  net_cents: number;
  created_at: string;
};

const VALID_PAYMENT_METHODS = new Set([
  "Dinheiro",
  "Débito",
  "Crédito",
  "Pix",
  "Outro",
]);

function isMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function validateSale(input: unknown): input is SaleInput {
  if (!input || typeof input !== "object") return false;
  const sale = input as Partial<SaleInput>;
  if (
    !sale.occurred_on ||
    !/^\d{4}-\d{2}-\d{2}$/.test(sale.occurred_on) ||
    !Number.isFinite(Date.parse(`${sale.occurred_on}T00:00:00.000Z`)) ||
    new Date(`${sale.occurred_on}T00:00:00.000Z`).toISOString().slice(0, 10) !==
      sale.occurred_on
  )
    return false;
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
    if (!VALID_PAYMENT_METHODS.has(payment.method)) return false;
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createIdempotentSale(
  db: D1Database,
  idempotencyKey: string,
  input: SaleInput,
): Promise<{ result: SaleResult; replayed: boolean }> {
  const canonicalRequest = JSON.stringify(input);
  const requestHash = await sha256(canonicalRequest);
  const previous = await db
    .prepare(
      "SELECT request_hash, response_json FROM sale_idempotency WHERE idempotency_key = ?",
    )
    .bind(idempotencyKey)
    .first<{ request_hash: string; response_json: string }>();
  if (previous) {
    if (previous.request_hash !== requestHash)
      throw new Error("IDEMPOTENCY_CONFLICT");
    return {
      result: JSON.parse(previous.response_json) as SaleResult,
      replayed: true,
    };
  }

  const digest = await sha256(idempotencyKey);
  const saleId = `sale_${digest.slice(0, 32)}`;
  const ledgerId = `ledger_${digest.slice(0, 32)}`;
  const createdAt = new Date().toISOString();
  const grossCents = input.items.reduce(
    (sum, item) => sum + Math.round(item.quantity * item.unit_price_cents),
    0,
  );
  const feeCents = input.payments.reduce(
    (sum, payment) => sum + payment.fee_cents,
    0,
  );
  const result: SaleResult = {
    sale_id: saleId,
    ledger_id: ledgerId,
    gross_cents: grossCents,
    fee_cents: feeCents,
    net_cents: grossCents - feeCents,
    created_at: createdAt,
  };
  const description = input.items
    .map((item) => `${item.quantity}x ${item.name}`)
    .join(", ");
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO ledger_entries (ledger_id, idempotency_key, entry_type, occurred_on, recorded_at,
        amount_cents, description, category, counterparty, notes, source_system, source_id)
       VALUES (?, ?, 'sale', ?, ?, ?, ?, 'Vendas', ?, ?, 'pdv', ?)`,
      )
      .bind(
        ledgerId,
        `pdv:${idempotencyKey}`,
        input.occurred_on,
        createdAt,
        grossCents,
        description,
        input.customer ?? null,
        input.notes ?? null,
        idempotencyKey,
      ),
    db
      .prepare(
        `INSERT INTO sales (sale_id, ledger_id, gross_cents, fee_cents, net_cents, customer, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        saleId,
        ledgerId,
        grossCents,
        feeCents,
        result.net_cents,
        input.customer ?? null,
        input.notes ?? null,
        createdAt,
      ),
    ...input.items.map((item, index) =>
      db
        .prepare(
          `INSERT INTO sale_items (item_id, sale_id, product_id, product_name_snapshot, category_snapshot,
        quantity, unit_price_cents, unit_cost_cents, line_total_cents, source_system, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pdv', ?)`,
        )
        .bind(
          `${saleId}_item_${index}`,
          saleId,
          item.product_id ?? null,
          item.name.trim(),
          item.category.trim(),
          String(item.quantity),
          item.unit_price_cents,
          item.unit_cost_cents ?? null,
          Math.round(item.quantity * item.unit_price_cents),
          `${idempotencyKey}:item:${index}`,
        ),
    ),
    ...input.payments.map((payment, index) =>
      db
        .prepare(
          `INSERT INTO sale_payments (payment_id, sale_id, method, method_label, amount_cents,
        fee_rate, fee_cents, source_system, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pdv', ?)`,
        )
        .bind(
          `${saleId}_payment_${index}`,
          saleId,
          payment.method,
          payment.method_label ?? null,
          payment.amount_cents,
          String(payment.fee_rate),
          payment.fee_cents,
          `${idempotencyKey}:payment:${index}`,
        ),
    ),
    db
      .prepare(
        `INSERT INTO sale_idempotency (idempotency_key, request_hash, sale_id, response_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        idempotencyKey,
        requestHash,
        saleId,
        JSON.stringify(result),
        createdAt,
      ),
  ];

  try {
    await db.batch(statements);
    return { result, replayed: false };
  } catch (error) {
    // Recover a request whose D1 batch committed but whose response was lost.
    const committed = await db
      .prepare(
        "SELECT request_hash, response_json FROM sale_idempotency WHERE idempotency_key = ?",
      )
      .bind(idempotencyKey)
      .first<{ request_hash: string; response_json: string }>();
    if (committed?.request_hash === requestHash) {
      return {
        result: JSON.parse(committed.response_json) as SaleResult,
        replayed: true,
      };
    }
    if (committed) throw new Error("IDEMPOTENCY_CONFLICT", { cause: error });
    throw error;
  }
}
