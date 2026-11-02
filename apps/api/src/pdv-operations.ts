import {
  feeCents,
  operationIdentity,
  validateOperationPayload,
  verifyOperationHash,
  type OperationEnvelope,
  type SaleAdjustPaymentsPayload,
  type SaleCancelPayload,
  type SaleCreatePayload,
  type SalePayment,
} from "@sabores/pdv-sync";

type RecordedOperation = {
  operation_id: string;
  device_id: string;
  actor_user_id: string;
  operation_type: OperationEnvelope["operationType"];
  payload_hash: string;
  result_json: string;
};

const iso = (value: string) => new Date(value).toISOString();
const ledgerKey = (operation: OperationEnvelope) =>
  `pdv:${operation.operationType}:${operation.operationId}`;
const makeLedgerId = (operationId: string) => `ledger_pdv_${operationId}`;

async function validateProducts(db: D1Database, payload: SaleCreatePayload) {
  const ids = [...new Set(payload.items.map((item) => item.productId))];
  if (!ids.length) return false;
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT p.product_id, p.name, c.name AS category, p.sale_price_cents, p.unit_cost_cents FROM products p JOIN categories c ON c.category_id = p.category_id WHERE p.active = 1 AND p.product_id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<{
      product_id: string;
      name: string;
      category: string;
      sale_price_cents: number;
      unit_cost_cents: number | null;
    }>();
  if (results.length !== ids.length) return false;
  const products = new Map(
    results.map((product) => [product.product_id, product]),
  );
  return payload.items.every((item) => {
    const product = products.get(item.productId);
    return (
      product &&
      item.name === product.name &&
      item.category === product.category &&
      item.unitPriceCents === product.sale_price_cents &&
      item.unitCostCents === product.unit_cost_cents
    );
  });
}

function sumPayments(payments: SalePayment[]) {
  return payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

function sumFees(payments: SalePayment[]) {
  return payments.reduce((sum, payment) => sum + payment.feeCents, 0);
}

async function validatePaymentRates(db: D1Database, payments: SalePayment[]) {
  const { results } = await db
    .prepare(
      "SELECT name, value FROM parameters WHERE name IN ('pos_debit_rate', 'pos_credit_rate')",
    )
    .all<{ name: string; value: string }>();
  const parameters = new Map(results.map((row) => [row.name, row.value]));
  const expected: Record<SalePayment["method"], string> = {
    Dinheiro: "0",
    Débito: parameters.get("pos_debit_rate") ?? "0.0139",
    Crédito: parameters.get("pos_credit_rate") ?? "0.0334",
    Pix: "0",
  };
  return payments.every(
    (payment) =>
      feeCents(payment.amountCents, payment.feeRate) === payment.feeCents &&
      feeCents(1_000_000_000, payment.feeRate) ===
        feeCents(1_000_000_000, expected[payment.method]),
  );
}

function addOperationRecord(
  db: D1Database,
  op: OperationEnvelope,
  actorUserId: string,
  status: "accepted" | "rejected_duplicate",
  result: unknown,
  recordedAt: string,
) {
  return db
    .prepare(
      `INSERT INTO sync_operations
      (operation_id, device_id, actor_user_id, actor_label, operation_type,
       occurred_at, client_created_at, catalog_version, hash_version,
       payload_hash, payload_json, status, result_json, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      op.operationId,
      op.deviceId,
      actorUserId,
      op.actor.label,
      op.operationType,
      iso(op.occurredAt),
      iso(op.clientCreatedAt),
      op.catalogVersion,
      op.hashVersion,
      op.payloadHash,
      JSON.stringify(op.payload),
      status,
      JSON.stringify(result),
      recordedAt,
    );
}

function ledgerStatement(
  db: D1Database,
  op: OperationEnvelope,
  actorUserId: string,
  values: {
    ledgerId: string;
    amountCents: number;
    description: string;
    category: string;
    correctionOf: string | null;
    reason: string | null;
    recordedAt: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO ledger_entries
      (ledger_id, idempotency_key, entry_type, occurred_on, occurred_at,
       recorded_at, amount_cents, description, category, notes, source_system,
       source_id, correction_of, correction_reason, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pdv', ?, ?, ?, ?)`,
    )
    .bind(
      values.ledgerId,
      ledgerKey(op),
      op.operationType === "sale.create" ? "sale" : "adjustment",
      op.operationType === "sale.create"
        ? (op.payload as SaleCreatePayload).occurredOn
        : new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Sao_Paulo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(op.occurredAt)),
      iso(op.occurredAt),
      values.recordedAt,
      values.amountCents,
      values.description,
      values.category,
      values.reason,
      op.operationId,
      values.correctionOf,
      values.reason,
      actorUserId,
    );
}

function paymentInsert(
  db: D1Database,
  payment: SalePayment,
  saleId: string,
  sourceId: string,
  paymentVersion: number,
) {
  return db
    .prepare(
      `INSERT INTO sale_payments
      (payment_id, sale_id, method, method_label, amount_cents, fee_rate,
       fee_cents, source_system, source_id, position, part_number, payment_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pdv', ?, ?, ?, ?)`,
    )
    .bind(
      sourceId,
      saleId,
      payment.method,
      payment.methodLabel,
      payment.amountCents,
      payment.feeRate,
      payment.feeCents,
      sourceId,
      payment.position,
      payment.partNumber,
      paymentVersion,
    );
}

async function createSaleStatements(
  db: D1Database,
  op: OperationEnvelope,
  actorUserId: string,
  recordedAt: string,
) {
  const payload = op.payload as SaleCreatePayload;
  const { saleId } = operationIdentity(op.operationType, op.operationId);
  const ledgerId = makeLedgerId(op.operationId);
  const grossCents = payload.items.reduce(
    (sum, item) => sum + item.lineTotalCents,
    0,
  );
  const feeCents = sumFees(payload.payments);
  const result = {
    status: "accepted",
    operationId: op.operationId,
    saleId,
    ledgerId,
    grossCents,
    feeCents,
    netCents: grossCents - feeCents,
    paymentVersion: 1,
    recordedAt,
  };
  const description = payload.items
    .map((item) => `${item.quantity}x ${item.name}`)
    .join(", ");
  const statements: D1PreparedStatement[] = [
    ledgerStatement(db, op, actorUserId, {
      ledgerId,
      amountCents: grossCents,
      description: `Venda ${saleId}: ${description}`,
      category: "Vendas",
      correctionOf: null,
      reason: null,
      recordedAt,
    }),
    db
      .prepare(
        `INSERT INTO sales
        (sale_id, ledger_id, gross_cents, fee_cents, net_cents, customer, notes,
         created_at, client_created_at, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        saleId,
        ledgerId,
        grossCents,
        feeCents,
        grossCents - feeCents,
        payload.customer,
        payload.notes,
        recordedAt,
        iso(op.clientCreatedAt),
        op.deviceId,
      ),
    ...payload.items.map((item) =>
      db
        .prepare(
          `INSERT INTO sale_items
        (item_id, sale_id, product_id, product_name_snapshot, category_snapshot,
         quantity, unit_price_cents, unit_cost_cents, line_total_cents,
         source_system, source_id, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pdv', ?, ?)`,
        )
        .bind(
          `${op.operationId}:item:${item.position}`,
          saleId,
          item.productId,
          item.name,
          item.category,
          item.quantity,
          item.unitPriceCents,
          item.unitCostCents,
          item.lineTotalCents,
          `${op.operationId}:item:${item.position}`,
          item.position,
        ),
    ),
    ...payload.payments.map((payment) =>
      paymentInsert(
        db,
        payment,
        saleId,
        `${op.operationId}:payment:${payment.position}`,
        1,
      ),
    ),
    ...payload.splits.map((part) =>
      db
        .prepare(
          "INSERT INTO sale_split_parts (sale_id, part_number, due_cents) VALUES (?, ?, ?)",
        )
        .bind(saleId, part.partNumber, part.dueCents),
    ),
    addOperationRecord(db, op, actorUserId, "accepted", result, recordedAt),
  ];
  return { statements, result };
}

async function cancelSaleStatements(
  db: D1Database,
  op: OperationEnvelope,
  actorUserId: string,
  recordedAt: string,
) {
  const payload = op.payload as SaleCancelPayload;
  const sale = await db
    .prepare(
      "SELECT sale_id, ledger_id, gross_cents FROM sales WHERE sale_id = ?",
    )
    .bind(payload.saleId)
    .first<{ sale_id: string; ledger_id: string; gross_cents: number }>();
  if (!sale) throw new Error("SALE_NOT_FOUND");
  const alreadyCancelled = await db
    .prepare("SELECT cancellation_id FROM sale_cancellations WHERE sale_id = ?")
    .bind(payload.saleId)
    .first();
  if (alreadyCancelled) throw new Error("SALE_ALREADY_CANCELLED");
  const ledgerId = makeLedgerId(op.operationId);
  const cancellationId = `cancel_${op.operationId}`;
  const result = {
    status: "accepted",
    operationId: op.operationId,
    saleId: payload.saleId,
    cancellationId,
    ledgerId,
    recordedAt,
  };
  return {
    result,
    statements: [
      addOperationRecord(db, op, actorUserId, "accepted", result, recordedAt),
      ledgerStatement(db, op, actorUserId, {
        ledgerId,
        amountCents: sale.gross_cents,
        description: `Cancelamento da venda ${sale.sale_id}`,
        category: "Cancelamento de venda",
        correctionOf: sale.ledger_id,
        reason: payload.reason,
        recordedAt,
      }),
      db
        .prepare(
          `INSERT INTO sale_cancellations
          (cancellation_id, sale_id, ledger_id, operation_id, reason, actor_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          cancellationId,
          sale.sale_id,
          ledgerId,
          op.operationId,
          payload.reason.trim(),
          actorUserId,
          recordedAt,
        ),
      db
        .prepare(
          `INSERT INTO ledger_compensations
          (compensation_id, ledger_id, sale_id, operation_id, compensation_type,
           direction, amount_cents, reason, actor_user_id, created_at)
         VALUES (?, ?, ?, ?, 'sale_cancellation', 'reversal', ?, ?, ?, ?)`,
        )
        .bind(
          `comp_${op.operationId}`,
          ledgerId,
          sale.sale_id,
          op.operationId,
          sale.gross_cents,
          payload.reason.trim(),
          actorUserId,
          recordedAt,
        ),
    ],
  };
}

async function adjustPaymentStatements(
  db: D1Database,
  op: OperationEnvelope,
  actorUserId: string,
  recordedAt: string,
) {
  const payload = op.payload as SaleAdjustPaymentsPayload;
  const sale = await db
    .prepare(
      "SELECT sale_id, ledger_id, gross_cents FROM sales WHERE sale_id = ?",
    )
    .bind(payload.saleId)
    .first<{ sale_id: string; ledger_id: string; gross_cents: number }>();
  if (!sale) throw new Error("SALE_NOT_FOUND");
  const latest = await db
    .prepare(
      `SELECT COALESCE(MAX(payment_version), 1) AS version
       FROM sale_payment_adjustments WHERE sale_id = ?`,
    )
    .bind(payload.saleId)
    .first<{ version: number }>();
  const currentVersion = latest?.version ?? 1;
  if (currentVersion !== payload.basePaymentVersion)
    throw new Error("PAYMENT_VERSION_CONFLICT");
  if (sumPayments(payload.payments) !== sale.gross_cents)
    throw new Error("PAYMENT_TOTAL_MISMATCH");
  const feeCents = sumFees(payload.payments);
  if (feeCents > sale.gross_cents) throw new Error("PAYMENT_TOTAL_MISMATCH");
  const ledgerId = makeLedgerId(op.operationId);
  const adjustmentId = `payment_adjustment_${op.operationId}`;
  const paymentVersion = currentVersion + 1;
  const result = {
    status: "accepted",
    operationId: op.operationId,
    saleId: sale.sale_id,
    adjustmentId,
    paymentVersion,
    grossCents: sale.gross_cents,
    feeCents,
    netCents: sale.gross_cents - feeCents,
    recordedAt,
  };
  return {
    result,
    statements: [
      addOperationRecord(db, op, actorUserId, "accepted", result, recordedAt),
      ledgerStatement(db, op, actorUserId, {
        ledgerId,
        amountCents: 0,
        description: `Correção de pagamentos da venda ${sale.sale_id}`,
        category: "Correção de pagamentos",
        correctionOf: sale.ledger_id,
        reason: payload.reason,
        recordedAt,
      }),
      db
        .prepare(
          `INSERT INTO sale_payment_adjustments
          (adjustment_id, sale_id, payment_version, base_payment_version, ledger_id,
           operation_id, reason, actor_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          adjustmentId,
          sale.sale_id,
          paymentVersion,
          currentVersion,
          ledgerId,
          op.operationId,
          payload.reason.trim(),
          actorUserId,
          recordedAt,
        ),
      ...payload.payments.map((payment) =>
        db
          .prepare(
            `INSERT INTO sale_payment_adjustment_lines
          (line_id, adjustment_id, method, method_label, amount_cents, fee_rate,
           fee_cents, part_number, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            `${op.operationId}:payment:${payment.position}`,
            adjustmentId,
            payment.method,
            payment.methodLabel,
            payment.amountCents,
            payment.feeRate,
            payment.feeCents,
            payment.partNumber,
            payment.position,
          ),
      ),
      db
        .prepare(
          `INSERT INTO ledger_compensations
          (compensation_id, ledger_id, sale_id, operation_id, compensation_type,
           direction, amount_cents, reason, actor_user_id, created_at)
         VALUES (?, ?, ?, ?, 'payment_adjustment', 'reversal', 0, ?, ?, ?)`,
        )
        .bind(
          `comp_${op.operationId}`,
          ledgerId,
          sale.sale_id,
          op.operationId,
          payload.reason.trim(),
          actorUserId,
          recordedAt,
        ),
    ],
  };
}

export async function applyPdvOperation(
  db: D1Database,
  raw: unknown,
  actorUserId: string,
): Promise<{
  result: unknown;
  replayed: boolean;
  status: "accepted" | "rejected_duplicate";
}> {
  if (
    !raw ||
    typeof raw !== "object" ||
    !validateOperationPayload(raw as OperationEnvelope)
  )
    throw new Error("INVALID_OPERATION");
  const op = raw as OperationEnvelope;
  if (!(await verifyOperationHash(op))) throw new Error("INVALID_HASH");
  if (op.actor.userId !== actorUserId) throw new Error("ACTOR_MISMATCH");
  const authenticatedActor = await db
    .prepare("SELECT username FROM auth_users WHERE user_id = ? AND active = 1")
    .bind(actorUserId)
    .first<{ username: string }>();
  if (!authenticatedActor) throw new Error("ACTOR_MISMATCH");
  op.actor.label = authenticatedActor.username;
  if (op.operationType === "sale.create") {
    const payload = op.payload as SaleCreatePayload;
    if (!(await validateProducts(db, payload)))
      throw new Error("PRODUCT_SNAPSHOT_MISMATCH");
    if (!(await validatePaymentRates(db, payload.payments)))
      throw new Error("PAYMENT_RATE_INVALID");
  }
  if (
    op.operationType === "sale.adjust_payments" &&
    !(await validatePaymentRates(
      db,
      (op.payload as SaleAdjustPaymentsPayload).payments,
    ))
  )
    throw new Error("PAYMENT_RATE_INVALID");
  const previous = await db
    .prepare(
      "SELECT operation_id, device_id, actor_user_id, operation_type, payload_hash, result_json, status FROM sync_operations WHERE operation_id = ?",
    )
    .bind(op.operationId)
    .first<RecordedOperation & { status: "accepted" | "rejected_duplicate" }>();
  if (previous) {
    if (
      previous.payload_hash !== op.payloadHash ||
      previous.device_id !== op.deviceId ||
      previous.actor_user_id !== actorUserId ||
      previous.operation_type !== op.operationType
    )
      throw new Error("OPERATION_ID_CONFLICT");
    return {
      result: JSON.parse(previous.result_json),
      replayed: true,
      status: previous.status,
    };
  }

  const occurredAt = Date.parse(op.occurredAt);
  const recentSince = new Date(occurredAt - 15_000).toISOString();
  const recentUntil = new Date(occurredAt + 15_000).toISOString();
  const prior = await db
    .prepare(
      `SELECT operation_id, occurred_at FROM sync_operations
      WHERE device_id = ? AND payload_hash = ? AND operation_type = 'sale.create'
        AND status = 'accepted' AND occurred_at BETWEEN ? AND ? ORDER BY occurred_at`,
    )
    .bind(op.deviceId, op.payloadHash, recentSince, recentUntil)
    .all<{ operation_id: string; occurred_at: string }>();
  const duplicate = prior.results.find(
    (entry) => Math.abs(occurredAt - Date.parse(entry.occurred_at)) < 15_000,
  );
  const recordedAt = new Date().toISOString();
  if (duplicate) {
    const result = {
      status: "rejected_duplicate",
      operationId: op.operationId,
      duplicateOf: duplicate.operation_id,
    };
    await db.batch([
      addOperationRecord(
        db,
        op,
        actorUserId,
        "rejected_duplicate",
        result,
        recordedAt,
      ),
      db
        .prepare(
          `INSERT INTO sync_duplicate_decisions
          (decision_id, operation_id, duplicate_operation_id, device_id, payload_hash, occurred_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `duplicate_${op.operationId}`,
          op.operationId,
          duplicate.operation_id,
          op.deviceId,
          op.payloadHash,
          iso(op.occurredAt),
          recordedAt,
        ),
    ]);
    return { result, replayed: false, status: "rejected_duplicate" };
  }

  let prepared: { result: unknown; statements: D1PreparedStatement[] };
  switch (op.operationType) {
    case "sale.create":
      prepared = await createSaleStatements(db, op, actorUserId, recordedAt);
      break;
    case "sale.cancel":
      prepared = await cancelSaleStatements(db, op, actorUserId, recordedAt);
      break;
    case "sale.adjust_payments":
      prepared = await adjustPaymentStatements(db, op, actorUserId, recordedAt);
      break;
  }
  try {
    await db.batch(prepared.statements);
  } catch (error) {
    if (op.operationType === "sale.adjust_payments") {
      const latest = await db
        .prepare(
          "SELECT COALESCE(MAX(payment_version), 1) AS version FROM sale_payment_adjustments WHERE sale_id = ?",
        )
        .bind((op.payload as SaleAdjustPaymentsPayload).saleId)
        .first<{ version: number }>();
      if (
        (latest?.version ?? 1) >
        (op.payload as SaleAdjustPaymentsPayload).basePaymentVersion
      )
        throw new Error("PAYMENT_VERSION_CONFLICT", { cause: error });
    }
    if (op.operationType === "sale.cancel") {
      const cancelled = await db
        .prepare("SELECT 1 AS found FROM sale_cancellations WHERE sale_id = ?")
        .bind((op.payload as SaleCancelPayload).saleId)
        .first();
      if (cancelled)
        throw new Error("SALE_ALREADY_CANCELLED", { cause: error });
    }
    const committed = await db
      .prepare(
        "SELECT payload_hash, result_json, status FROM sync_operations WHERE operation_id = ?",
      )
      .bind(op.operationId)
      .first<
        RecordedOperation & { status: "accepted" | "rejected_duplicate" }
      >();
    if (committed?.payload_hash === op.payloadHash)
      return {
        result: JSON.parse(committed.result_json),
        replayed: true,
        status: committed.status,
      };
    throw error;
  }
  return { result: prepared.result, replayed: false, status: "accepted" };
}

export function pdvOperationIdentity(op: OperationEnvelope) {
  return operationIdentity(op.operationType, op.operationId);
}
