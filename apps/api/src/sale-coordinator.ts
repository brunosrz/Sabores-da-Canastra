import { DurableObject } from "cloudflare:workers";
import { applyPdvOperation } from "./pdv-operations";

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
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/operations"
    )
      return Response.json({ error: "Not found" }, { status: 404 });
    const actorUserId = request.headers.get("x-actor-user-id") ?? "";
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(actorUserId))
      return Response.json({ error: "Não autenticado." }, { status: 401 });
    let operation: unknown;
    try {
      operation = await request.json();
    } catch {
      return Response.json({ error: "Corpo JSON inválido." }, { status: 400 });
    }
    try {
      const outcome = await applyPdvOperation(
        this.env.DB,
        operation,
        actorUserId,
      );
      const status =
        outcome.status === "rejected_duplicate"
          ? 409
          : outcome.replayed
            ? 200
            : 201;
      return Response.json(outcome, { status });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const clientErrors: Record<string, [number, string]> = {
        INVALID_OPERATION: [422, "Operação inválida."],
        INVALID_HASH: [422, "Hash da operação inválido."],
        PRODUCT_SNAPSHOT_MISMATCH: [
          422,
          "Produto indisponível ou catálogo mudou; atualize e revise a venda.",
        ],
        ACTOR_MISMATCH: [
          403,
          "A operação pertence a outra conta. Entre com o usuário que a iniciou.",
        ],
        OPERATION_ID_CONFLICT: [
          409,
          "ID da operação já usado com outro conteúdo.",
        ],
        SALE_NOT_FOUND: [404, "Venda não encontrada no servidor."],
        SALE_ALREADY_CANCELLED: [409, "A venda já foi cancelada."],
        PAYMENT_VERSION_CONFLICT: [
          409,
          "Os pagamentos mudaram; atualize o histórico e tente novamente.",
        ],
        PAYMENT_TOTAL_MISMATCH: [
          422,
          "Os pagamentos precisam reconciliar com o total da venda.",
        ],
        PAYMENT_RATE_INVALID: [
          422,
          "Taxa de pagamento diferente da configuração do ERP.",
        ],
      };
      const known = clientErrors[code];
      if (known)
        return Response.json({ error: known[1], code }, { status: known[0] });
      console.error("Falha ao persistir operação do PDV.", error);
      return Response.json(
        { error: "Não foi possível registrar a operação." },
        { status: 503 },
      );
    }
  }
}

type Env = { DB: D1Database };
