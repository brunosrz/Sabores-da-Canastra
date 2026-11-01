import { describe, expect, it, vi } from "vitest";
import {
  calculateBundleIntegrity,
  importBundle,
  type D1ImportBundle,
} from "../src/import";

const baseBundle = async (): Promise<D1ImportBundle> => {
  const bundle: D1ImportBundle = {
    contract: "sabores-da-canastra/d1-import",
    contract_version: 1,
    import_id: "0".repeat(64),
    source: { workbook_sha256: "b".repeat(64) },
    row_counts: {
      categories: 0,
      products: 0,
      ingredients: 0,
      quotes: 0,
      recipes: 0,
      recipeLines: 0,
      parameters: 0,
      dailyMix: 0,
      ledgerEntries: 0,
      sales: 0,
      saleItems: 0,
      salePayments: 0,
      purchases: 0,
      purchaseItems: 0,
      expenses: 0,
    },
    reconciliation: { financial: {} },
    tables: {
      categories: [],
      products: [],
      ingredients: [],
      quotes: [],
      recipes: [],
      recipeLines: [],
      parameters: [],
      dailyMix: [],
      ledgerEntries: [],
      sales: [],
      saleItems: [],
      salePayments: [],
      purchases: [],
      purchaseItems: [],
      expenses: [],
    },
  };
  const integrity = await calculateBundleIntegrity(bundle);
  const { import_id, ...sourceHashes } = integrity;
  Object.assign(bundle.source, sourceHashes);
  bundle.import_id = import_id;
  return bundle;
};

function fakeDatabase(
  prior: unknown = null,
  batchResult?: unknown,
  existingRows = 0,
) {
  const batch = vi.fn(async (statements: unknown[]) => {
    if (!Array.isArray(statements))
      throw new Error("expected prepared statements");
    if (batchResult instanceof Error) throw batchResult;
    return batchResult ?? [{ success: true }];
  });
  const first = vi
    .fn()
    .mockResolvedValueOnce(prior)
    .mockResolvedValueOnce({ existing_rows: existingRows });
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({ first, run: vi.fn() })),
    first,
  }));
  return {
    db: { prepare, batch } as unknown as D1Database,
    prepare,
    batch,
    first,
  };
}

describe("importação do pacote D1", () => {
  it("aplica todos os registros num único batch transacional", async () => {
    const fake = fakeDatabase();
    const result = await importBundle(fake.db, await baseBundle());

    expect(result.alreadyImported).toBe(false);
    expect(fake.batch).toHaveBeenCalledTimes(1);
    expect(fake.batch.mock.calls[0][0]).toHaveLength(17);
  });

  it("não aplica novamente um pacote já registrado", async () => {
    const bundle = await baseBundle();
    const fake = fakeDatabase({ import_id: bundle.import_id });
    const result = await importBundle(fake.db, bundle);

    expect(result.alreadyImported).toBe(true);
    expect(fake.batch).not.toHaveBeenCalled();
  });

  it("recusa mesclar um pacote novo num D1 que já tem registros", async () => {
    const fake = fakeDatabase(null, undefined, 2);
    await expect(importBundle(fake.db, await baseBundle())).rejects.toThrow(
      "já contém dados",
    );
    expect(fake.batch).not.toHaveBeenCalled();
  });

  it("rejeita contrato inválido antes de escrever", async () => {
    const fake = fakeDatabase();
    await expect(
      importBundle(fake.db, { ...(await baseBundle()), contract_version: 2 }),
    ).rejects.toThrow("incompatível");
    expect(fake.batch).not.toHaveBeenCalled();
  });

  it("rejeita quantias negativas no ledger", async () => {
    const fake = fakeDatabase();
    const payload = await baseBundle();
    payload.tables.ledgerEntries.push({
      amountCents: -1,
      occurredOn: "2026-11-01",
    });
    payload.row_counts.ledgerEntries = 1;
    await expect(importBundle(fake.db, payload)).rejects.toThrow(
      "valor negativo",
    );
    expect(fake.batch).not.toHaveBeenCalled();
  });

  it("propaga falha do batch para que D1 reverta o lote inteiro", async () => {
    const fake = fakeDatabase(null, new Error("foreign key failure"));
    await expect(importBundle(fake.db, await baseBundle())).rejects.toThrow(
      "foreign key failure",
    );
    expect(fake.batch).toHaveBeenCalledTimes(1);
  });

  it("detecta edição do pacote depois de gerar o hash de origem", async () => {
    const fake = fakeDatabase();
    const payload = await baseBundle();
    payload.tables.categories.push({
      categoryId: "bebidas",
      name: "Bebidas",
      createdAt: "2026-11-01T00:00:00Z",
    });
    payload.row_counts.categories = 1;
    await expect(importBundle(fake.db, payload)).rejects.toThrow(
      "Hash do pacote",
    );
    expect(fake.batch).not.toHaveBeenCalled();
  });
});
