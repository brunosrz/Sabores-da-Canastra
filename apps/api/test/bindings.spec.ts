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
const backupAuthUsers = JSON.stringify([
  {
    id: backupTestUserId,
    username: backupTestUserId,
    role: "owner",
    salt: "AAAAAAAAAAAAAAAAAAAAAA",
    hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    iterations: 100_000,
  },
]);

async function ensureTestActor() {
  await bindings.DB.prepare(
    "INSERT OR IGNORE INTO auth_users (user_id, username, role, active, created_at) VALUES (?, ?, 'owner', 1, ?)",
  )
    .bind(testActorId, "ledger-test-user", new Date().toISOString())
    .run();
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
    "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(
      encodedHash,
      userId,
      new Date().toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
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
    await ensureTestActor();
    const key = `test:${crypto.randomUUID()}`;
    const stub = bindings.SALE_COORDINATOR.get(
      bindings.SALE_COORDINATOR.idFromName(key),
    );
    const makeRequest = (body: unknown) =>
      new Request("https://coordinator.local/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
          "x-actor-user-id": testActorId,
        },
        body: JSON.stringify(body),
      });
    const first = await stub.fetch(makeRequest(payload));
    const reorderedPayload = {
      payments: payload.payments.map((payment) => ({
        fee_cents: payment.fee_cents,
        amount_cents: payment.amount_cents,
        fee_rate: payment.fee_rate,
        method: payment.method,
      })),
      items: payload.items.map((item) => ({
        unit_cost_cents: item.unit_cost_cents,
        unit_price_cents: item.unit_price_cents,
        quantity: item.quantity,
        category: item.category,
        name: item.name,
      })),
      occurred_on: payload.occurred_on,
    };
    const replay = await stub.fetch(makeRequest(reorderedPayload));
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect((await replay.json<{ replayed: boolean }>()).replayed).toBe(true);
    const count = await bindings.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM sales
       INNER JOIN ledger_entries USING (ledger_id)
       WHERE ledger_entries.idempotency_key = ?`,
    )
      .bind(`pdv:${key}`)
      .first<{ total: number }>();
    expect(count?.total).toBe(1);
    const actor = await bindings.DB.prepare(
      "SELECT actor_user_id FROM ledger_entries WHERE idempotency_key = ?",
    )
      .bind(`pdv:${key}`)
      .first<{ actor_user_id: string }>();
    expect(actor?.actor_user_id).toBe(testActorId);
  });

  it("recusa reuso de chave com payload diferente", async () => {
    await ensureTestActor();
    const key = `test:${crypto.randomUUID()}`;
    const stub = bindings.SALE_COORDINATOR.get(
      bindings.SALE_COORDINATOR.idFromName(key),
    );
    const makeRequest = (body: unknown) =>
      new Request("https://coordinator.local/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
          "x-actor-user-id": testActorId,
        },
        body: JSON.stringify(body),
      });
    expect((await stub.fetch(makeRequest(payload))).status).toBe(201);
    const changed = structuredClone(payload);
    changed.items[0].name = "Payload divergente";
    expect((await stub.fetch(makeRequest(changed))).status).toBe(409);
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
    const appBindings = { ...bindings, AUTH_USERS: backupAuthUsers };
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
