import { describe, expect, it } from "vitest";
import {
  canSyncOperation,
  feeCents,
  lineTotalCents,
  occurredOnInSaoPaulo,
  operationIdentity,
  operationPayloadHash,
  splitEqual,
  validateOperationPayload,
  verifyOperationHash,
  type OperationEnvelope,
  type SaleAdjustPaymentsPayload,
  type SaleCreatePayload,
} from "../src/index";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "22222222-2222-4222-8222-222222222222";

function createSaleOperation(): OperationEnvelope {
  const { saleId } = operationIdentity("sale.create", OPERATION_ID);
  return {
    operationId: OPERATION_ID,
    deviceId: DEVICE_ID,
    actor: { userId: "owner", label: "Operador" },
    operationType: "sale.create",
    occurredAt: "2026-11-02T15:00:00.000Z",
    clientCreatedAt: "2026-11-02T15:00:01.000Z",
    catalogVersion: "catalog-v1",
    hashVersion: "pdv-op/v1",
    payloadHash: "0".repeat(64),
    payload: {
      saleId,
      occurredOn: "2026-11-02",
      customer: null,
      notes: null,
      items: [
        {
          productId: "produto-1",
          name: "Porção",
          category: "Porções",
          quantity: "2",
          unitPriceCents: 250,
          unitCostCents: 120,
          lineTotalCents: 500,
          position: 0,
        },
      ],
      splits: [{ partNumber: 1, dueCents: 500 }],
      payments: [
        {
          method: "Pix",
          methodLabel: null,
          amountCents: 500,
          feeRate: "0",
          feeCents: 0,
          partNumber: 1,
          position: 0,
        },
      ],
    },
  };
}

async function seal(operation: OperationEnvelope): Promise<OperationEnvelope> {
  operation.payloadHash = await operationPayloadHash(operation);
  return operation;
}

describe("contrato de sincronização do PDV", () => {
  it("só permite sincronizar operações com a identidade autenticada", () => {
    expect(canSyncOperation("owner-1", "owner-1")).toBe(true);
    expect(canSyncOperation("owner-1", "owner-2")).toBe(false);
    expect(canSyncOperation("owner-1", null)).toBe(false);
    expect(canSyncOperation("owner-1", undefined)).toBe(false);
  });

  it("calcula quantidades e taxas em centavos com arredondamento half-up", () => {
    expect(lineTotalCents("1.005", 101)).toBe(102);
    expect(feeCents(101, "0.005")).toBe(1);
    expect(lineTotalCents("1.0001", 101)).toBeNull();
    expect(lineTotalCents("0", 101)).toBeNull();
    expect(lineTotalCents("1", -1)).toBeNull();
    expect(lineTotalCents(2 as unknown as string, 101)).toBeNull();
    expect(feeCents(100, "1.000001")).toBeNull();
    expect(feeCents(100, 0.1 as unknown as string)).toBeNull();
    expect(feeCents(Number.MAX_SAFE_INTEGER + 1, "0.1")).toBeNull();
  });

  it("divide valores iguais distribuindo o resto e rejeita divisões inválidas", () => {
    expect(splitEqual(1001, 3)).toEqual([
      { partNumber: 1, dueCents: 334 },
      { partNumber: 2, dueCents: 334 },
      { partNumber: 3, dueCents: 333 },
    ]);
    expect(splitEqual(1, 1)).toEqual([{ partNumber: 1, dueCents: 1 }]);
    expect(splitEqual(0, 1)).toBeNull();
    expect(splitEqual(10, 0)).toBeNull();
    expect(splitEqual(2, 3)).toBeNull();
  });

  it("converte instante para o dia operacional de São Paulo e deriva IDs", () => {
    expect(occurredOnInSaoPaulo("2026-11-01T02:30:00.000Z")).toBe("2026-10-31");
    expect(occurredOnInSaoPaulo("não é uma data")).toBeNull();
    expect(operationIdentity("sale.create", "abc")).toEqual({
      saleId: "pdv-sale:abc",
      idempotencyKey: "pdv:sale.create:abc",
    });
  });

  it("aceita venda válida e verifica hash SHA-256 do envelope", async () => {
    const operation = await seal(createSaleOperation());

    expect(validateOperationPayload(operation)).toBe(true);
    expect(operation.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyOperationHash(operation)).toBe(true);
  });

  it("exige quantidade e taxa como strings no payload de venda", () => {
    const operation = createSaleOperation();
    const payload = operation.payload as SaleCreatePayload;
    payload.items[0]!.quantity = 2 as unknown as string;
    expect(validateOperationPayload(operation)).toBe(false);

    payload.items[0]!.quantity = "2";
    payload.payments[0]!.feeRate = 0 as unknown as string;
    expect(validateOperationPayload(operation)).toBe(false);
  });

  it("gera hash determinístico independente da ordem das chaves e do horário no mesmo dia", async () => {
    const first = await seal(createSaleOperation());
    const second = structuredClone(first);
    second.occurredAt = "2026-11-02T20:00:00.000Z";
    second.clientCreatedAt = "2026-11-02T20:00:02.000Z";
    second.payload = Object.fromEntries(
      Object.entries(second.payload).reverse(),
    ) as OperationEnvelope["payload"];

    expect(await operationPayloadHash(second)).toBe(first.payloadHash);
  });

  it("normaliza strings em NFC, espaços e zeros finais das quantidades", async () => {
    const first = await seal(createSaleOperation());
    const equivalent = structuredClone(first);
    const payload = equivalent.payload as SaleCreatePayload;
    payload.items[0]!.name = "  Porc\u0327a\u0303o  ";
    payload.items[0]!.quantity = "2.000";
    payload.customer = "  Cafe\u0301  ";

    const canonical = structuredClone(first);
    const canonicalPayload = canonical.payload as SaleCreatePayload;
    canonicalPayload.items[0]!.name = "Porção";
    canonicalPayload.items[0]!.quantity = "2";
    canonicalPayload.customer = "Café";

    expect(await operationPayloadHash(equivalent)).toBe(
      await operationPayloadHash(canonical),
    );
    expect(await verifyOperationHash(equivalent)).toBe(false);
  });

  it("preserva a ordem dos itens no hash e detecta alterações relevantes", async () => {
    const operation = await seal(createSaleOperation());
    const originalHash = operation.payloadHash;
    const payload = operation.payload as SaleCreatePayload;
    payload.items.push({
      ...payload.items[0]!,
      productId: "produto-2",
      position: 1,
    });
    payload.splits[0]!.dueCents = 1000;
    payload.payments[0]!.amountCents = 1000;
    payload.payments[0]!.feeCents = 0;
    const reordered = structuredClone(operation);
    (reordered.payload as SaleCreatePayload).items.reverse();

    expect(await operationPayloadHash(reordered)).not.toBe(originalHash);
    expect(await verifyOperationHash(reordered)).toBe(false);
  });

  it("hash não muda com saleId local, mas detecta alteração nos itens", async () => {
    const operation = await seal(createSaleOperation());
    const changedSaleId = structuredClone(operation);
    (changedSaleId.payload as SaleCreatePayload).saleId = "id-local-diferente";
    expect(await operationPayloadHash(changedSaleId)).toBe(
      operation.payloadHash,
    );

    const changedItem = structuredClone(operation);
    (changedItem.payload as SaleCreatePayload).items[0]!.quantity = "3";
    expect(await verifyOperationHash(changedItem)).toBe(false);
  });

  it.each([
    [
      "UUID da operação malformado",
      (value: OperationEnvelope) => (value.operationId = "ruim"),
    ],
    [
      "usuário ausente",
      (value: OperationEnvelope) => (value.actor.userId = ""),
    ],
    [
      "venda de outro dia",
      (value: OperationEnvelope) => {
        (value.payload as SaleCreatePayload).occurredOn = "2026-11-01";
      },
    ],
    [
      "total de item inconsistente",
      (value: OperationEnvelope) => {
        (value.payload as SaleCreatePayload).items[0]!.lineTotalCents = 499;
      },
    ],
    [
      "valor de pagamento diferente da divisão",
      (value: OperationEnvelope) => {
        (value.payload as SaleCreatePayload).payments[0]!.amountCents = 499;
      },
    ],
    [
      "taxa de pagamento inconsistente",
      (value: OperationEnvelope) => {
        (value.payload as SaleCreatePayload).payments[0]!.feeCents = 1;
      },
    ],
    [
      "quantidade inválida",
      (value: OperationEnvelope) => {
        (value.payload as SaleCreatePayload).items[0]!.quantity = "01.0";
      },
    ],
    [
      "posição duplicada em item",
      (value: OperationEnvelope) => {
        (value.payload as SaleCreatePayload).items[0]!.position = 1;
      },
    ],
    [
      "divisão com parte fora de ordem",
      (value: OperationEnvelope) => {
        (value.payload as SaleCreatePayload).splits[0]!.partNumber = 2;
      },
    ],
    [
      "método de pagamento não reconhecido",
      (value: OperationEnvelope) => {
        (value.payload as SaleCreatePayload).payments[0]!.method =
          "Cheque" as SaleCreatePayload["payments"][number]["method"];
      },
    ],
    [
      "total de pagamentos acima do inteiro seguro",
      (value: OperationEnvelope) => {
        (value.payload as SaleCreatePayload).payments[0]!.amountCents =
          Number.MAX_SAFE_INTEGER;
      },
    ],
    [
      "versão de hash incompatível",
      (value: OperationEnvelope) => {
        value.hashVersion = "pdv-op/v2" as OperationEnvelope["hashVersion"];
      },
    ],
  ])("rejeita contrato inválido: %s", async (_description, mutate) => {
    const operation = await seal(createSaleOperation());
    (mutate as (value: OperationEnvelope) => void)(operation);

    expect(validateOperationPayload(operation)).toBe(false);
  });

  it("detecta hash com formato válido, mas conteúdo incorreto", async () => {
    const operation = await seal(createSaleOperation());
    operation.payloadHash = "f".repeat(64);

    expect(validateOperationPayload(operation)).toBe(true);
    expect(await verifyOperationHash(operation)).toBe(false);
  });

  it("valida razões de cancelamento e versão-base de correção", () => {
    const cancellation: OperationEnvelope = {
      ...createSaleOperation(),
      operationType: "sale.cancel",
      payload: { saleId: "pdv-sale:original", reason: "Pedido cancelado" },
    };
    const adjustment: OperationEnvelope = {
      ...createSaleOperation(),
      operationType: "sale.adjust_payments",
      payload: {
        saleId: "pdv-sale:original",
        basePaymentVersion: 1,
        reason: "Forma de pagamento corrigida",
        payments: [
          {
            method: "Dinheiro",
            methodLabel: null,
            amountCents: 500,
            feeRate: "0",
            feeCents: 0,
            partNumber: 1,
            position: 0,
          },
        ],
      },
    };

    expect(validateOperationPayload(cancellation)).toBe(true);
    expect(validateOperationPayload(adjustment)).toBe(true);
    cancellation.payload = { saleId: "pdv-sale:original", reason: "  " };
    (adjustment.payload as SaleAdjustPaymentsPayload).basePaymentVersion = 0;
    expect(validateOperationPayload(cancellation)).toBe(false);
    expect(validateOperationPayload(adjustment)).toBe(false);
  });

  it("rejeita timestamps inválidos, UUIDs malformados e metadados fora do limite", () => {
    const operation = createSaleOperation();
    operation.occurredAt = "ontem";
    expect(validateOperationPayload(operation)).toBe(false);

    operation.occurredAt = "2026-11-02T15:00:00.000Z";
    operation.deviceId = "device";
    expect(validateOperationPayload(operation)).toBe(false);

    operation.deviceId = DEVICE_ID;
    operation.catalogVersion = "x".repeat(201);
    expect(validateOperationPayload(operation)).toBe(false);
  });
});
