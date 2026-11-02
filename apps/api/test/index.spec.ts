import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const environment = {
  DB: {} as D1Database,
  LOCAL_IMPORT_TOKEN: "x".repeat(40),
};

describe("rotas locais da API", () => {
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
          authorization: "Bearer backup-token",
          "idempotency-key": "retry-1234",
        },
      },
      {
        DB: {} as D1Database,
        PRIVATE_FILES: {} as R2Bucket,
        BACKUP_DOWNLOAD_TOKEN: "backup-token",
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
          authorization: "Bearer backup-token",
          "idempotency-key": "invalid:key",
        },
      },
      {
        DB: {} as D1Database,
        PRIVATE_FILES: {} as R2Bucket,
        BACKUP_DOWNLOAD_TOKEN: "backup-token",
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
        headers: { authorization: "Bearer backup-token" },
      },
      {
        DB: {} as D1Database,
        PRIVATE_FILES: {} as R2Bucket,
        BACKUP_DOWNLOAD_TOKEN: "backup-token",
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

  it("limita o corpo da venda lendo o stream e cancela acima de 1 MB", async () => {
    const getByName = vi.fn();
    const response = await app.request(
      "https://api.example.test/api/sales",
      {
        method: "POST",
        headers: {
          authorization: "Bearer pdv-token",
          "idempotency-key": "sale-size-limit-1",
        },
        body: "x".repeat(1_000_001),
      },
      {
        DB: {} as D1Database,
        SALE_COORDINATOR: { getByName } as unknown as DurableObjectNamespace,
        PDV_WRITE_TOKEN: "pdv-token",
      },
    );
    expect(response.status).toBe(413);
    expect(getByName).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o caminho do arquivo de backup tem escape inválido", async () => {
    const response = await app.request(
      "https://api.example.test/api/backups/file/backups/d1/%E0%A4%A.sql",
      { headers: { authorization: "Bearer backup-token" } },
      {
        DB: {} as D1Database,
        PRIVATE_FILES: {} as R2Bucket,
        BACKUP_DOWNLOAD_TOKEN: "backup-token",
      },
    );
    expect(response.status).toBe(404);
  });
});
