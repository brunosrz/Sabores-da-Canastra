import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const environment = {
  DB: {} as D1Database,
  LOCAL_IMPORT_TOKEN: "x".repeat(40),
};
const sessionCookie = "sabores_session=session-for-test";
async function testCredentialFingerprint() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        "test-user",
        "test-user",
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
function databaseWithSession() {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => ({
          id: "test-user",
          username: "test-user",
          role: "owner",
          salt: "AAAAAAAAAAAAAAAAAAAAAA",
          hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          iterations: 100_000,
          credential_fingerprint: await testCredentialFingerprint(),
        }),
      }),
    }),
  } as unknown as D1Database;
}
function catalogDatabase() {
  return {
    prepare: (query: string) => {
      const statement = {
        bind: () => statement,
        first: async () => ({
          id: "test-user",
          username: "test-user",
          role: "owner",
          salt: "AAAAAAAAAAAAAAAAAAAAAA",
          hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          iterations: 100_000,
          credential_fingerprint: await testCredentialFingerprint(),
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
        all: async () => ({
          results: query.includes("FROM recipes r")
            ? []
            : query.includes("unit_cost_cents")
              ? [{ product_id: "p1", unit_cost_cents: 230 }]
              : [{ product_id: "p1", sale_price_cents: 500 }],
        }),
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe("rotas locais da API", () => {
  it("fornece custos somente no catálogo autenticado do ERP", async () => {
    const response = await app.request(
      "https://api.example.test/api/erp/catalog/products",
      { headers: { cookie: sessionCookie } },
      { DB: catalogDatabase() },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          product_id: "p1",
          unit_cost_cents: 230,
          manual_unit_cost_cents: 230,
          cost_source: "manual",
          cost_recipe_id: null,
          cost_quality: "Confirmado",
        },
      ],
    });
  });

  it("responde saúde sem acessar D1", async () => {
    const response = await app.request(
      "http://127.0.0.1:3000/health",
      {},
      environment,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ app: "sabores-api", status: "ok" });
  });

  it("oculta o importador fora de hostname local", async () => {
    const response = await app.request(
      "https://api.example.com/__local/import",
      {
        method: "POST",
        headers: { authorization: `Bearer ${environment.LOCAL_IMPORT_TOKEN}` },
        body: "{}",
      },
      environment,
    );
    expect(response.status).toBe(404);
  });

  it("exige token local antes de ler ou escrever no D1", async () => {
    const prepare = vi.fn();
    const response = await app.request(
      "http://localhost:3000/__local/import",
      {
        method: "POST",
        headers: { authorization: "Bearer errado" },
        body: "{}",
      },
      {
        DB: { prepare } as unknown as D1Database,
        LOCAL_IMPORT_TOKEN: environment.LOCAL_IMPORT_TOKEN,
      },
    );
    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("mantém a rota indisponível sem segredo configurado", async () => {
    const response = await app.request(
      "http://127.0.0.1:3000/__local/import",
      {
        method: "POST",
        body: "{}",
      },
      { DB: {} as D1Database },
    );
    expect(response.status).toBe(404);
  });

  it("reaproveita instância do Workflow quando o mesmo ID é reenviado", async () => {
    const create = vi.fn(async () => {
      throw new Error("Instance ID already exists");
    });
    const get = vi.fn(async (id: string) => ({
      id,
      status: async () => ({ status: "complete" as const }),
    }));
    const response = await app.request(
      "https://api.example.test/api/backups/run",
      {
        method: "POST",
        headers: {
          cookie: sessionCookie,
          origin: "https://erp.example.test",
          "idempotency-key": "retry-1234",
        },
      },
      {
        DB: databaseWithSession(),
        PRIVATE_FILES: {} as R2Bucket,
        AUTH_ALLOWED_ORIGINS: "https://erp.example.test",
        D1_BACKUP: { create, get } as unknown as Workflow,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "manual-retry-1234",
      status: "complete",
    });
    expect(get).toHaveBeenCalledWith("manual-retry-1234");
  });

  it("rejeita chave do Workflow que não respeita o formato permitido", async () => {
    const create = vi.fn();
    const response = await app.request(
      "https://api.example.test/api/backups/run",
      {
        method: "POST",
        headers: {
          cookie: sessionCookie,
          origin: "https://erp.example.test",
          "idempotency-key": "invalid:key",
        },
      },
      {
        DB: databaseWithSession(),
        PRIVATE_FILES: {} as R2Bucket,
        AUTH_ALLOWED_ORIGINS: "https://erp.example.test",
        D1_BACKUP: { create } as unknown as Workflow,
      },
    );
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("direciona exportação de D1 local ao utilitário local", async () => {
    const create = vi.fn();
    const response = await app.request(
      "https://api.example.test/api/backups/run",
      {
        method: "POST",
        headers: { cookie: sessionCookie, origin: "https://erp.example.test" },
      },
      {
        DB: databaseWithSession(),
        PRIVATE_FILES: {} as R2Bucket,
        AUTH_ALLOWED_ORIGINS: "https://erp.example.test",
        BACKUP_ACCOUNT_ID: "local",
        BACKUP_DATABASE_ID: "local",
        D1_BACKUP: { create } as unknown as Workflow,
      },
    );
    expect(response.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("db:backup:local"),
    });
  });

  it("desativa o endpoint legado de venda antes de aceitar payload", async () => {
    const getByName = vi.fn();
    const response = await app.request(
      "https://api.example.test/api/sales",
      {
        method: "POST",
        headers: {
          cookie: sessionCookie,
          "idempotency-key": "sale-size-limit-1",
          origin: "http://localhost:5174",
        },
        body: "x".repeat(1_000_001),
      },
      {
        DB: databaseWithSession(),
        SALE_COORDINATOR: { getByName } as unknown as DurableObjectNamespace,
        AUTH_ALLOWED_ORIGINS: "http://localhost:5174",
      },
    );
    expect(response.status).toBe(410);
    expect(getByName).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o caminho do arquivo de backup tem escape inválido", async () => {
    const response = await app.request(
      "https://api.example.test/api/backups/file/backups/d1/%E0%A4%A.sql",
      { headers: { cookie: sessionCookie } },
      {
        DB: databaseWithSession(),
        PRIVATE_FILES: {} as R2Bucket,
      },
    );
    expect(response.status).toBe(404);
  });
});
