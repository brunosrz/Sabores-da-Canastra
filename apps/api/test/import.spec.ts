import { describe, expect, it, vi } from "vitest";
import {
  calculateBundleIntegrity,
  importBundle,
  previewImport,
  type D1ImportBundle,
} from "../src/import";

const baseBundle = async (): Promise<D1ImportBundle> => {
  const bundle: D1ImportBundle = {
    contract: "sabores-da-canastra/d1-import",
    contract_version: 1,
    import_id: "0".repeat(64),
    source: {
      workbook_sha256: "b".repeat(64),
      sqlite_file_sha256: "a".repeat(64),
    },
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
    reconciliation: {
      financial: Object.fromEntries(
        ["Venda", "Compra", "Gasto"].map((kind) => [
          kind,
          {
            source_cents: 0,
            mapped_cents: 0,
            matches: true,
          },
        ]),
      ),
    },
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
  bundle.provenance = {
    timezone: "America/Sao_Paulo",
    captured_at: new Date().toISOString(),
    source_files: {
      sqlite: { sha256: "a".repeat(64), size_bytes: 1, components: [] },
      workbook: { sha256: "b".repeat(64), size_bytes: 1, components: [] },
    },
    totals: structuredClone(bundle.reconciliation.financial) as Record<
      string,
      { source_cents: number; mapped_cents: number; matches: boolean }
    >,
  };
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

  it("faz preview sem escrita e classifica banco vazio e importação repetida", async () => {
    const bundle = await baseBundle();
    const empty = fakeDatabase(null, undefined, 0);
    const preview = await previewImport(empty.db, bundle);
    expect(preview.state).toBe("empty");
    expect(empty.batch).not.toHaveBeenCalled();

    const imported = fakeDatabase({ import_id: bundle.import_id });
    expect((await previewImport(imported.db, bundle)).state).toBe(
      "already_imported",
    );
    expect(imported.batch).not.toHaveBeenCalled();
  });

  it("marca destino ocupado sem tentar mesclar os dados", async () => {
    const fake = fakeDatabase(null, undefined, 1);
    expect((await previewImport(fake.db, await baseBundle())).state).toBe(
      "occupied",
    );
    expect(fake.batch).not.toHaveBeenCalled();
  });

  it("rejeita hashes de proveniência inconsistentes", async () => {
    const fake = fakeDatabase();
    const bundle = await baseBundle();
    bundle.provenance!.source_files.sqlite!.sha256 = "c".repeat(64);
    await expect(previewImport(fake.db, bundle)).rejects.toThrow(
      "Hash de proveniência não confere",
    );
    expect(fake.batch).not.toHaveBeenCalled();
  });

  it("aceita proveniência íntegra e recusa hash SQLite divergente da origem", async () => {
    const accepted = await baseBundle();
    expect(
      (await previewImport(fakeDatabase(null, undefined, 0).db, accepted))
        .state,
    ).toBe("empty");

    const divergent = await baseBundle();
    divergent.source.sqlite_file_sha256 = "c".repeat(64);
    await expect(previewImport(fakeDatabase().db, divergent)).rejects.toThrow(
      "Hash de proveniência não confere para sqlite",
    );
  });

  it("recusa totais de proveniência que não reconciliam", async () => {
    const bundle = await baseBundle();
    bundle.provenance!.totals.Venda!.source_cents = 1;
    await expect(previewImport(fakeDatabase().db, bundle)).rejects.toThrow(
      "Totais de proveniência não conciliam para Venda",
    );
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
