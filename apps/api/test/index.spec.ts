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
});
