import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";
import {
  backupExpired,
  backupPrefix,
  backupRetentionDays,
  hashStream,
  initialExportState,
  putImmutableBackupStream,
  putImmutableBackupObject,
} from "../src/backup";
import { validateSale } from "../src/sales";
import {
  operationPayloadHash,
  type OperationEnvelope,
  type SaleCreatePayload,
} from "@sabores/pdv-sync";

const bindings = env as unknown as Cloudflare.Env;
const payload = {
  occurred_on: "2026-11-01",
  items: [
    {
      name: "Produto de teste",
      category: "Teste",
      quantity: 2,
      unit_price_cents: 1250,
      unit_cost_cents: 500,
    },
  ],
  payments: [
    {
      method: "Dinheiro" as const,
      amount_cents: 2500,
      fee_rate: 0,
      fee_cents: 0,
    },
  ],
};
const testActorId = "test-ledger-actor";
const backupTestUserId = "backup-test-user";
async function backupCredentialFingerprint() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        backupTestUserId,
        backupTestUserId,
        "owner",
        "AAAAAAAAAAAAAAAAAAAAAA",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        100_000,
      ]),
    ),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function ensureTestActor() {
  await bindings.DB.prepare(
    "INSERT OR IGNORE INTO auth_users (user_id, username, role, active, created_at) VALUES (?, ?, 'owner', 1, ?)",
  )
    .bind(testActorId, "ledger-test-user", new Date().toISOString())
    .run();
}

async function makeOfflineOperation(): Promise<OperationEnvelope> {
  await ensureTestActor();
  const categoryId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const name = `Produto PDV ${productId}`;
  await bindings.DB.prepare(
    "INSERT INTO categories (category_id, name, created_at) VALUES (?, ?, ?)",
  )
    .bind(categoryId, `Categoria ${categoryId}`, new Date().toISOString())
    .run();
  await bindings.DB.prepare(
    `INSERT INTO products
       (product_id, name, category_id, unit, sale_price_cents, unit_cost_cents,
        active, created_at, updated_at)
     VALUES (?, ?, ?, 'un', 2500, 500, 1, ?, ?)`,
  )
    .bind(
      productId,
      name,
      categoryId,
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  const operation: OperationEnvelope = {
    operationId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    actor: { userId: testActorId, label: "ledger-test-user" },
    operationType: "sale.create",
    occurredAt: new Date().toISOString(),
    clientCreatedAt: new Date().toISOString(),
    catalogVersion: "test-catalog-v1",
    hashVersion: "pdv-op/v1",
    payloadHash: "0".repeat(64),
    payload: {
      saleId: "pending",
      occurredOn: new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      customer: null,
      notes: null,
      items: [
        {
          productId,
          name,
          category: `Categoria ${categoryId}`,
          quantity: "1",
          unitPriceCents: 2500,
          unitCostCents: 500,
          lineTotalCents: 2500,
          position: 0,
        },
      ],
      splits: [{ partNumber: 1, dueCents: 2500 }],
      payments: [
        {
          method: "Dinheiro",
          methodLabel: null,
          amountCents: 2500,
          feeRate: "0",
          feeCents: 0,
          partNumber: 1,
          position: 0,
        },
      ],
    },
  };
  operation.payload.saleId = `pdv-sale:${operation.operationId}`;
  operation.payloadHash = await operationPayloadHash(operation);
  return operation;
}

async function authenticatedCookie() {
  const userId = backupTestUserId;
  const token = crypto.randomUUID() + crypto.randomUUID();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const tokenHash = [...new Uint8Array(digest)]
    .map((byte) => String.fromCharCode(byte))
    .join("");
  const encodedHash = btoa(tokenHash)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  await bindings.DB.prepare(
    "INSERT INTO auth_users (user_id, username, role, active, created_at) VALUES (?, ?, 'owner', 1, ?) ON CONFLICT(user_id) DO UPDATE SET active = 1",
  )
    .bind(userId, userId, new Date().toISOString())
    .run();
  await bindings.DB.prepare(
    `INSERT OR REPLACE INTO users
      (user_id, username, role, salt, password_hash, iterations, active, created_at, updated_at)
     VALUES (?, ?, 'owner', 'AAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 100000, 1, ?, ?)`,
  )
    .bind(userId, userId, new Date().toISOString(), new Date().toISOString())
    .run();
  await bindings.DB.prepare(
    "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, credential_fingerprint) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      encodedHash,
      userId,
      new Date().toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
      await backupCredentialFingerprint(),
    )
    .run();
  return `sabores_session=${token}`;
}

describe("bindings Cloudflare locais", () => {
  it("recusa token legado no catálogo antes de consultar D1", async () => {
    const prepare = vi.fn();
    const response = await app.request(
      "https://api.example.test/api/catalog/products",
      { headers: { authorization: "Bearer outro-token" } },
      {
        DB: { prepare },
        CATALOG_CACHE: {},
        CATALOG_READ_TOKEN: "catalog-secret-for-test",
      } as unknown as Cloudflare.Env,
    );
    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("não permite leitura do catálogo somente com token legado", async () => {
    const response = await app.request(
      "https://api.example.test/api/catalog/products",
      { headers: { authorization: "Bearer catalog-secret-for-test" } },
      { ...bindings, CATALOG_READ_TOKEN: "catalog-secret-for-test" },
    );
    expect(response.status).toBe(401);
  });

  it("valida campos opcionais e pagamentos malformados antes de somar", async () => {
    expect(await validateSale({ ...payload, payments: [null] })).toBe(false);
    expect(
      await validateSale({ ...payload, customer: { nome: "cliente" } }),
    ).toBe(false);
    expect(
      await validateSale({
        ...payload,
        items: [{ ...payload.items[0], product_id: [] }],
      }),
    ).toBe(false);
    expect(
      await validateSale({
        ...payload,
        payments: [{ ...payload.payments[0], method_label: 123 }],
      }),
    ).toBe(false);
  });

  it("rejeita product_id sem registro no catálogo e aceita ID existente", async () => {
    const sale = {
      ...payload,
      items: [{ ...payload.items[0], product_id: "product-1" }],
    };
    const all = vi.fn(async () => ({
      results: [] as { product_id: string }[],
    }));
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ all })),
      })),
    } as unknown as D1Database;
    expect(await validateSale(sale, db)).toBe(false);
    all.mockResolvedValue({ results: [{ product_id: "product-1" }] });
    expect(await validateSale(sale, db)).toBe(true);
  });

  it("protege a leitura de preços e custos do catálogo", async () => {
    const prepare = vi.fn();
    const apiBindings = {
      DB: { prepare },
      CATALOG_CACHE: {},
    } as unknown as Cloudflare.Env;
    const unauthorized = await app.request(
      "https://api.example.test/api/catalog/products",
      {},
      apiBindings,
    );
    expect(unauthorized.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("usa KV versionado como cache descartável e invalida sem afetar D1", async () => {
    await bindings.CATALOG_CACHE.delete("catalog:v1:products:active");
    const id = crypto.randomUUID();
    await bindings.DB.prepare(
      "INSERT INTO categories (category_id, name, created_at) VALUES (?, ?, ?)",
    )
      .bind(id, `Categoria ${id}`, new Date().toISOString())
      .run();
    await bindings.DB.prepare(
      `INSERT INTO products
      (product_id, name, category_id, unit, active, created_at, updated_at)
      VALUES (?, ?, ?, 'un', 1, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        `Produto ${id}`,
        id,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
    const { listProducts, invalidateCatalogCache } =
      await import("../src/catalog-cache");
    const first = await listProducts(bindings.DB, bindings.CATALOG_CACHE);
    const second = await listProducts(bindings.DB, bindings.CATALOG_CACHE);
    expect(first.source).toBe("d1");
    expect(second.source).toBe("cache");
    const cachedCatalog = await bindings.CATALOG_CACHE.get(
      "catalog:v1:products:active",
    );
    expect(cachedCatalog).not.toContain("unit_cost_cents");
    await invalidateCatalogCache(bindings.CATALOG_CACHE);
    expect(
      (await listProducts(bindings.DB, bindings.CATALOG_CACHE)).source,
    ).toBe("d1");
  });

  it("grava uma venda uma vez e reproduz a resposta em retries", async () => {
    const operation = await makeOfflineOperation();
    const stub = bindings.SALE_COORDINATOR.get(
      bindings.SALE_COORDINATOR.idFromName(`pdv-device:${operation.deviceId}`),
    );
    const makeRequest = (body: unknown) =>
      new Request("https://coordinator.local/operations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-user-id": testActorId,
        },
        body: JSON.stringify(body),
      });
    const first = await stub.fetch(makeRequest(operation));
    const replay = await stub.fetch(makeRequest(operation));
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect((await replay.json<{ replayed: boolean }>()).replayed).toBe(true);
    const count = await bindings.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM sales
       INNER JOIN ledger_entries USING (ledger_id)
       WHERE ledger_entries.idempotency_key = ?`,
    )
      .bind(`pdv:sale.create:${operation.operationId}`)
      .first<{ total: number }>();
    expect(count?.total).toBe(1);
    const actor = await bindings.DB.prepare(
      "SELECT actor_user_id FROM ledger_entries WHERE idempotency_key = ?",
    )
      .bind(`pdv:sale.create:${operation.operationId}`)
      .first<{ actor_user_id: string }>();
    expect(actor?.actor_user_id).toBe(testActorId);
  });

  it("retorna pagamentos corrigidos e taxas atuais no histórico", async () => {
    const sale = await makeOfflineOperation();
    if (sale.operationType !== "sale.create") throw new Error("tipo inválido");
    const salePayload = sale.payload as SaleCreatePayload;
    const date = salePayload.occurredOn;
    const saleId = salePayload.saleId;
    const stub = bindings.SALE_COORDINATOR.get(
      bindings.SALE_COORDINATOR.idFromName(`pdv-device:${sale.deviceId}`),
    );
    const send = (body: OperationEnvelope) =>
      stub.fetch(
        new Request("https://coordinator.local/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-actor-user-id": testActorId,
          },
          body: JSON.stringify(body),
        }),
      );
    expect((await send(sale)).status).toBe(201);
    const adjustment: OperationEnvelope = {
      ...sale,
      operationId: crypto.randomUUID(),
      operationType: "sale.adjust_payments",
      payloadHash: "0".repeat(64),
      payload: {
        saleId: sale.payload.saleId,
        basePaymentVersion: 1,
        reason: "Correção",
        payments: [
          {
            method: "Crédito",
            methodLabel: null,
            amountCents: 2500,
            feeRate: "0.0334",
            feeCents: 84,
            partNumber: 1,
            position: 0,
          },
        ],
      },
    };
    adjustment.payloadHash = await operationPayloadHash(adjustment);
    const adjustmentResponse = await send(adjustment);
    expect(adjustmentResponse.status, await adjustmentResponse.text()).toBe(
      201,
    );
    const response = await app.request(
      `https://api.example.test/api/pdv/sales?from=${date}&to=${date}`,
      { headers: { cookie: await authenticatedCookie() } },
      bindings,
    );
    expect(response.status).toBe(200);
    const data = await response.json<{
      sales: Array<{
        sale_id: string;
        fee_cents: number;
        net_cents: number;
        payments: Array<{ method: string }>;
      }>;
    }>();
    const result = data.sales.find((row) => row.sale_id === saleId);
    expect(result).toMatchObject({
      fee_cents: 84,
      net_cents: 2416,
      payments: [{ method: "Crédito" }],
    });
  });

  it("recusa reuso de chave com payload diferente", async () => {
    const operation = await makeOfflineOperation();
    const stub = bindings.SALE_COORDINATOR.get(
      bindings.SALE_COORDINATOR.idFromName(`pdv-device:${operation.deviceId}`),
    );
    const makeRequest = (body: unknown) =>
      new Request("https://coordinator.local/operations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-user-id": testActorId,
        },
        body: JSON.stringify(body),
      });
    expect((await stub.fetch(makeRequest(operation))).status).toBe(201);
    const changed = structuredClone(operation);
    if (changed.operationType !== "sale.create")
      throw new Error("type mismatch");
    (changed.payload as SaleCreatePayload).notes = "Payload divergente";
    changed.payloadHash = await operationPayloadHash(changed);
    expect((await stub.fetch(makeRequest(changed))).status).toBe(409);
  });

  it("bloqueia hash idêntico antes de 15 segundos e aceita no limite exato", async () => {
    const first = await makeOfflineOperation();
    first.occurredAt = "2026-11-01T15:00:00.000Z";
    if (first.operationType !== "sale.create") throw new Error("type mismatch");
    (first.payload as SaleCreatePayload).occurredOn = "2026-11-01";
    first.payloadHash = await operationPayloadHash(first);
    const stub = bindings.SALE_COORDINATOR.get(
      bindings.SALE_COORDINATOR.idFromName(`pdv-device:${first.deviceId}`),
    );
    const send = (operation: OperationEnvelope) =>
      stub.fetch(
        new Request("https://coordinator.local/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-actor-user-id": testActorId,
          },
          body: JSON.stringify(operation),
        }),
      );

    expect((await send(first)).status).toBe(201);
    const duplicate = structuredClone(first);
    duplicate.operationId = crypto.randomUUID();
    duplicate.occurredAt = "2026-11-01T15:00:14.999Z";
    if (duplicate.operationType !== "sale.create")
      throw new Error("type mismatch");
    duplicate.payload.saleId = `pdv-sale:${duplicate.operationId}`;
    duplicate.payloadHash = await operationPayloadHash(duplicate);
    expect((await send(duplicate)).status).toBe(409);

    const boundary = structuredClone(first);
    boundary.operationId = crypto.randomUUID();
    boundary.occurredAt = "2026-11-01T15:00:15.000Z";
    if (boundary.operationType !== "sale.create")
      throw new Error("type mismatch");
    boundary.payload.saleId = `pdv-sale:${boundary.operationId}`;
    boundary.payloadHash = await operationPayloadHash(boundary);
    expect((await send(boundary)).status).toBe(201);
  });

  it("grava e lê objetos do R2 pelo binding privado", async () => {
    const key = `backups/d1/test-${crypto.randomUUID()}.sql`;
    await bindings.PRIVATE_FILES.put(key, "SELECT 1;", {
      httpMetadata: { contentType: "application/sql" },
    });
    const object = await bindings.PRIVATE_FILES.get(key);
    expect(await object?.text()).toBe("SELECT 1;");
  });

  it("só entrega um backup pela rota autenticada", async () => {
    const key = `backups/d1/test-${crypto.randomUUID()}.sql`;
    const content = new TextEncoder().encode("SELECT 1;").buffer;
    await bindings.PRIVATE_FILES.put(key, content, {
      httpMetadata: { contentType: "application/sql" },
    });
    const digest = await crypto.subtle.digest("SHA-256", content);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await bindings.PRIVATE_FILES.put(
      key.replace(/\.sql$/, ".json"),
      JSON.stringify({
        contract: "sabores-da-canastra/d1-backup",
        contract_version: 1,
        database_id: "test",
        bookmark: "test",
        created_at: new Date().toISOString(),
        sql_key: key,
        size_bytes: content.byteLength,
        sha256,
        restore: "teste",
      }),
    );
    const url = `https://api.example.test/api/backups/file/${key}`;
    const appBindings = bindings;
    const cookie = await authenticatedCookie();
    const unauthorized = await app.request(url, {}, appBindings);
    expect(unauthorized.status).toBe(401);
    const authorized = await app.request(
      url,
      { headers: { cookie } },
      appBindings,
    );
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("cache-control")).toBe("private, no-store");
    expect(new TextDecoder().decode(await authorized.arrayBuffer())).toBe(
      "SELECT 1;",
    );
    await bindings.PRIVATE_FILES.put(key, "tampered");
    const tampered = await app.request(
      url,
      { headers: { cookie } },
      appBindings,
    );
    expect(tampered.status).toBe(409);
  });

  it("continua consultando D1 quando KV falha", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { listProducts } = await import("../src/catalog-cache");
    const all = vi.fn(async () => ({
      results: [{ product_id: "p1", name: "Produto" }],
    }));
    const db = { prepare: vi.fn(() => ({ all })) } as unknown as D1Database;
    const cache = {
      get: vi.fn(async () => {
        throw new Error("KV indisponível");
      }),
      put: vi.fn(async () => {
        throw new Error("KV indisponível");
      }),
    } as unknown as KVNamespace;
    const response = await listProducts(db, cache);
    expect(response).toEqual({
      data: [{ product_id: "p1", name: "Produto" }],
      source: "d1",
    });
    expect(db.prepare).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("ignora valores de cache que não sejam arrays", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { listProducts } = await import("../src/catalog-cache");
    const all = vi.fn(async () => ({ results: [{ product_id: "p1" }] }));
    const db = { prepare: vi.fn(() => ({ all })) } as unknown as D1Database;
    const cache = {
      get: vi.fn(async () => ({ invalid: true })),
      put: vi.fn(async () => {}),
    } as unknown as KVNamespace;
    const response = await listProducts(db, cache);
    expect(response).toEqual({ data: [{ product_id: "p1" }], source: "d1" });
    expect(db.prepare).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("limita caminhos de backup e calcula retenção pela idade", () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    expect(backupPrefix("bookmark:with/slashes", "workflow-123")).toBe(
      "backups/d1/bookmark_with_slashes-workflow-123",
    );
    expect(backupExpired("2026-09-30T00:00:00.000Z", now, 30)).toBe(true);
    expect(backupExpired("2026-10-31T00:00:00.000Z", now, 30)).toBe(false);
    expect(backupRetentionDays(undefined)).toBe(90);
    expect(backupRetentionDays("30")).toBe(30);
    expect(() => backupRetentionDays("6")).toThrow(
      "BACKUP_RETENTION_DAYS precisa estar entre 7 e 3650.",
    );
    expect(() => backupRetentionDays("3651")).toThrow(
      "BACKUP_RETENTION_DAYS precisa estar entre 7 e 3650.",
    );
  });

  it("aceita exportação D1 já concluída sem bookmark", () => {
    expect(
      initialExportState({
        success: true,
        result: {
          status: "complete",
          result: { signed_url: "https://example.test/export.sql" },
        },
      }),
    ).toEqual({
      bookmark: null,
      signedUrl: "https://example.test/export.sql",
    });
    expect(() =>
      initialExportState({
        result: { status: "error", error: "Falha" },
      }),
    ).toThrow("Falha");
  });

  it("faz escrita idempotente de backup no R2 e recusa colisão", async () => {
    const key = `backups/d1/immutable-${crypto.randomUUID()}.sql`;
    await putImmutableBackupObject(
      bindings.PRIVATE_FILES,
      key,
      "SELECT 1;",
      "application/sql",
    );
    await putImmutableBackupObject(
      bindings.PRIVATE_FILES,
      key,
      "SELECT 1;",
      "application/sql",
    );
    await expect(
      putImmutableBackupObject(
        bindings.PRIVATE_FILES,
        key,
        "SELECT 2;",
        "application/sql",
      ),
    ).rejects.toThrow("Backup key already contains different content");
  });

  it("valida e grava SQL grande em fluxo sem buffer completo", async () => {
    const key = `backups/d1/stream-${crypto.randomUUID()}.sql`;
    const makeStream = () =>
      new Blob(["SELECT ", "1;"]).stream() as ReadableStream<Uint8Array>;
    const expected = await hashStream(makeStream());
    await putImmutableBackupStream(
      bindings.PRIVATE_FILES,
      key,
      makeStream(),
      "application/sql",
      expected,
    );
    const object = await bindings.PRIVATE_FILES.get(key);
    expect(await object?.text()).toBe("SELECT 1;");
    expect(object?.customMetadata?.sha256).toBe(expected.sha256);
  });
});
