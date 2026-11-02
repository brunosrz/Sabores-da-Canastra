import { DurableObject } from "cloudflare:workers";
import { createIdempotentSale, validateSale, type SaleInput } from "./sales";

export class SaleCoordinator extends DurableObject<Env> {
  private queue: Promise<Response> = Promise.resolve(new Response(null));

  fetch(request: Request): Promise<Response> {
    const task = this.queue.then(
      () => this.process(request),
      () => this.process(request),
    );
    this.queue = task.catch(() => new Response(null));
    return task;
  }

  private async process(request: Request): Promise<Response> {
    if (request.method !== "POST")
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    const key = request.headers.get("idempotency-key") ?? "";
    const actorUserId = request.headers.get("x-actor-user-id") ?? "";
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(actorUserId)) {
      return Response.json({ error: "Não autenticado." }, { status: 401 });
    }
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      return Response.json(
        { error: "Informe uma chave de idempotência válida." },
        { status: 400 },
      );
    }
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: "Corpo JSON inválido." }, { status: 400 });
    }
    let validSale: boolean;
    try {
      validSale = await validateSale(payload, this.env.DB);
    } catch (error) {
      console.error("Falha ao validar produtos da venda no D1.", error);
      return Response.json(
        { error: "Não foi possível validar os produtos da venda." },
        { status: 503 },
      );
    }
    if (!validSale)
      return Response.json(
        { error: "Dados da venda inválidos ou totais divergentes." },
        { status: 422 },
      );
    try {
      const outcome = await createIdempotentSale(
        this.env.DB,
        key,
        payload as SaleInput,
        actorUserId,
      );
      return Response.json(outcome, { status: outcome.replayed ? 200 : 201 });
    } catch (error) {
      if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") {
        return Response.json(
          { error: "A chave já foi usada com dados diferentes." },
          { status: 409 },
        );
      }
      console.error("Falha ao registrar venda no D1.", error);
      return Response.json(
        { error: "Não foi possível registrar a venda." },
        { status: 503 },
      );
    }
  }
}

type Env = { DB: D1Database };
