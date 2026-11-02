export const HASH_VERSION = "pdv-op/v1" as const;
export const PAYMENT_METHODS = [
  "Dinheiro",
  "Débito",
  "Crédito",
  "Pix",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type SaleItem = {
  productId: string;
  name: string;
  category: string;
  quantity: string;
  unitPriceCents: number;
  unitCostCents: number | null;
  lineTotalCents: number;
  position: number;
};
export type SalePayment = {
  method: PaymentMethod;
  methodLabel: string | null;
  amountCents: number;
  feeRate: string;
  feeCents: number;
  partNumber: number;
  position: number;
};
export type SaleSplit = { partNumber: number; dueCents: number };
export type SaleCreatePayload = {
  saleId: string;
  occurredOn: string;
  customer: string | null;
  notes: string | null;
  items: SaleItem[];
  splits: SaleSplit[];
  payments: SalePayment[];
};
export type SaleCancelPayload = { saleId: string; reason: string };
export type SaleAdjustPaymentsPayload = {
  saleId: string;
  basePaymentVersion: number;
  reason: string;
  payments: SalePayment[];
};
export type OperationType =
  | "sale.create"
  | "sale.cancel"
  | "sale.adjust_payments";
export type OperationEnvelope = {
  operationId: string;
  deviceId: string;
  actor: { userId: string; label: string };
  operationType: OperationType;
  occurredAt: string;
  clientCreatedAt: string;
  catalogVersion: string;
  hashVersion: typeof HASH_VERSION;
  payloadHash: string;
  payload: SaleCreatePayload | SaleCancelPayload | SaleAdjustPaymentsPayload;
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const QUANTITY_SCALE = 1_000n;

function decimalScaled(value: string, scale: bigint): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const fractionDigits = scale.toString().length - 1;
  return BigInt(whole!) * scale + BigInt(fraction.padEnd(fractionDigits, "0"));
}

export function quantityMilli(value: string): number | null {
  const result = decimalScaled(value, QUANTITY_SCALE);
  return result == null || result <= 0n || result > MAX_SAFE
    ? null
    : Number(result);
}

export function lineTotalCents(
  quantity: string,
  unitPriceCents: number,
): number | null {
  const milli = decimalScaled(quantity, QUANTITY_SCALE);
  if (milli == null || milli <= 0n || !isSafeCents(unitPriceCents)) return null;
  const cents =
    (milli * BigInt(unitPriceCents) + QUANTITY_SCALE / 2n) / QUANTITY_SCALE;
  return cents <= MAX_SAFE ? Number(cents) : null;
}

export function isSafeCents(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function feeCents(amountCents: number, feeRate: string): number | null {
  const rate = decimalScaled(feeRate, 1_000_000n);
  if (
    !isSafeCents(amountCents) ||
    rate == null ||
    rate < 0n ||
    rate > 1_000_000n
  )
    return null;
  const fee = (BigInt(amountCents) * rate + 500_000n) / 1_000_000n;
  return fee <= MAX_SAFE ? Number(fee) : null;
}

export function splitEqual(
  totalCents: number,
  count: number,
): SaleSplit[] | null {
  if (
    !isSafeCents(totalCents) ||
    totalCents <= 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > totalCents
  )
    return null;
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, index) => ({
    partNumber: index + 1,
    dueCents: base + Number(index < remainder),
  }));
}

export function occurredOnInSaoPaulo(instant: string): string | null {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function normalize(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, nested]) => [key, normalize(nested)]),
  );
}

export function operationIdentity(
  operationType: OperationType,
  operationId: string,
): { saleId: string; idempotencyKey: string } {
  return {
    saleId: `pdv-sale:${operationId}`,
    idempotencyKey: `pdv:${operationType}:${operationId}`,
  };
}

export async function operationPayloadHash(
  operation: Pick<
    OperationEnvelope,
    "deviceId" | "operationType" | "occurredAt" | "payload"
  >,
): Promise<string> {
  const occurredOn = occurredOnInSaoPaulo(operation.occurredAt);
  const payload =
    operation.operationType === "sale.create" &&
    operation.payload &&
    typeof operation.payload === "object"
      ? Object.fromEntries(
          Object.entries(operation.payload).filter(([key]) => key !== "saleId"),
        )
      : operation.payload;
  const serialized = JSON.stringify(
    normalize({
      version: HASH_VERSION,
      deviceId: operation.deviceId,
      operationType: operation.operationType,
      occurredOn,
      payload,
    }),
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serialized),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyOperationHash(
  operation: OperationEnvelope,
): Promise<boolean> {
  return (await operationPayloadHash(operation)) === operation.payloadHash;
}

export function validateOperationPayload(
  operation: OperationEnvelope,
): boolean {
  if (
    !operation ||
    typeof operation !== "object" ||
    operation.hashVersion !== HASH_VERSION ||
    !/^[0-9a-f-]{36}$/i.test(operation.operationId) ||
    !/^[0-9a-f-]{36}$/i.test(operation.deviceId)
  )
    return false;
  if (
    typeof operation.occurredAt !== "string" ||
    typeof operation.clientCreatedAt !== "string" ||
    !Number.isFinite(Date.parse(operation.occurredAt)) ||
    !Number.isFinite(Date.parse(operation.clientCreatedAt))
  )
    return false;
  if (
    typeof operation.actor?.userId !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(operation.actor.userId) ||
    typeof operation.actor.label !== "string" ||
    !operation.actor.label.trim() ||
    operation.actor.label.length > 80 ||
    !/^[0-9a-f]{64}$/.test(operation.payloadHash) ||
    typeof operation.catalogVersion !== "string" ||
    operation.catalogVersion.length > 200
  )
    return false;
  if (!operation.payload || typeof operation.payload !== "object") return false;
  if (operation.operationType === "sale.create") {
    const payload = operation.payload as SaleCreatePayload;
    if (
      typeof payload.saleId !== "string" ||
      payload.saleId !==
        operationIdentity(operation.operationType, operation.operationId)
          .saleId ||
      typeof payload.occurredOn !== "string" ||
      payload.occurredOn !== occurredOnInSaoPaulo(operation.occurredAt) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payload.occurredOn) ||
      !Number.isFinite(Date.parse(`${payload.occurredOn}T00:00:00Z`)) ||
      (payload.customer !== null &&
        (typeof payload.customer !== "string" ||
          payload.customer.length > 200)) ||
      (payload.notes !== null &&
        (typeof payload.notes !== "string" || payload.notes.length > 2000)) ||
      !Array.isArray(payload.items) ||
      payload.items.length < 1 ||
      payload.items.length > 70 ||
      !Array.isArray(payload.payments) ||
      payload.payments.length < 1 ||
      payload.payments.length > 50 ||
      !Array.isArray(payload.splits) ||
      payload.splits.length < 1 ||
      payload.splits.length > 20
    )
      return false;
    let gross = 0;
    for (const [index, item] of payload.items.entries()) {
      if (
        !item ||
        typeof item.productId !== "string" ||
        !item.productId ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        item.name.length > 200 ||
        typeof item.category !== "string" ||
        !item.category.trim() ||
        item.category.length > 100 ||
        !Number.isSafeInteger(item.position) ||
        item.position !== index ||
        !isSafeCents(item.unitPriceCents) ||
        (item.unitCostCents !== null && !isSafeCents(item.unitCostCents))
      )
        return false;
      const expectedLine = lineTotalCents(item.quantity, item.unitPriceCents);
      if (expectedLine !== item.lineTotalCents) return false;
      gross += item.lineTotalCents;
      if (!Number.isSafeInteger(gross)) return false;
    }
    const splitTotal = payload.splits.reduce(
      (sum, split, index) =>
        sum +
        (split &&
        split.partNumber === index + 1 &&
        isSafeCents(split.dueCents) &&
        split.dueCents > 0
          ? split.dueCents
          : Number.NaN),
      0,
    );
    if (splitTotal !== gross) return false;
    const partTotals = new Map(
      payload.splits.map((part) => [part.partNumber, 0]),
    );
    for (const [index, payment] of payload.payments.entries()) {
      if (
        !payment ||
        !PAYMENT_METHODS.includes(payment.method) ||
        !Number.isSafeInteger(payment.position) ||
        payment.position !== index ||
        !isSafeCents(payment.amountCents) ||
        payment.amountCents <= 0 ||
        !Number.isSafeInteger(payment.partNumber) ||
        !partTotals.has(payment.partNumber) ||
        (payment.methodLabel !== null &&
          (typeof payment.methodLabel !== "string" ||
            payment.methodLabel.length > 100))
      )
        return false;
      const expectedFee = feeCents(payment.amountCents, payment.feeRate);
      if (expectedFee === null || expectedFee !== payment.feeCents)
        return false;
      partTotals.set(
        payment.partNumber,
        partTotals.get(payment.partNumber)! + payment.amountCents,
      );
    }
    return payload.splits.every(
      (split) => partTotals.get(split.partNumber) === split.dueCents,
    );
  }
  if (operation.operationType === "sale.cancel") {
    const payload = operation.payload as SaleCancelPayload;
    return (
      typeof payload.saleId === "string" &&
      payload.saleId.length > 0 &&
      typeof payload.reason === "string" &&
      Boolean(payload.reason.trim()) &&
      payload.reason.trim().length <= 500
    );
  }
  if (operation.operationType === "sale.adjust_payments") {
    const payload = operation.payload as SaleAdjustPaymentsPayload;
    if (
      typeof payload.saleId !== "string" ||
      !payload.saleId ||
      typeof payload.reason !== "string" ||
      !payload.reason.trim() ||
      payload.reason.trim().length > 500 ||
      !Number.isSafeInteger(payload.basePaymentVersion) ||
      payload.basePaymentVersion < 1 ||
      !Array.isArray(payload.payments) ||
      payload.payments.length < 1 ||
      payload.payments.length > 50
    )
      return false;
    let total = 0;
    for (const [index, payment] of payload.payments.entries()) {
      if (
        !payment ||
        !PAYMENT_METHODS.includes(payment.method) ||
        payment.position !== index ||
        !Number.isSafeInteger(payment.partNumber) ||
        payment.partNumber < 1 ||
        !isSafeCents(payment.amountCents) ||
        payment.amountCents <= 0 ||
        (payment.methodLabel !== null &&
          typeof payment.methodLabel !== "string")
      )
        return false;
      const expectedFee = feeCents(payment.amountCents, payment.feeRate);
      if (expectedFee === null || expectedFee !== payment.feeCents)
        return false;
      total += payment.amountCents;
      if (!Number.isSafeInteger(total)) return false;
    }
    return true;
  }
  return false;
}
