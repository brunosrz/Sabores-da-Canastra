import { Hono } from "hono";
import { importBundle, previewImport } from "./import";
import type { OperationEnvelope } from "@sabores/pdv-sync";
import { invalidateCatalogCache, listProducts } from "./catalog-cache";
import { verifyBackupStream } from "./backup";
import {
  currentUser,
  hasTrustedOrigin,
  login,
  logout,
  sessionResponse,
  type AuthBindings,
  type AuthUser,
} from "./auth";
export { SaleCoordinator } from "./sale-coordinator";
export { D1BackupWorkflow } from "./backup";

type Bindings = {
  DB: D1Database;
  CATALOG_CACHE: KVNamespace;
  PRIVATE_FILES: R2Bucket;
  SALE_COORDINATOR: DurableObjectNamespace;
  D1_BACKUP: Workflow;
  BACKUP_ACCOUNT_ID?: string;
  BACKUP_DATABASE_ID?: string;
  LOCAL_IMPORT_TOKEN?: string;
  AUTH_COOKIE_DOMAIN?: string;
  AUTH_COOKIE_NAME?: string;
  AUTH_ALLOWED_ORIGINS?: string;
};

const app = new Hono<{
  Bindings: Bindings;
  Variables: { authUser: AuthUser };
}>();
const MAX_LOGIN_BODY_BYTES = 16_384;
const PUBLIC_AUTH_ROUTES = new Set([
  "POST /api/auth/login",
  "GET /api/auth/session",
  "POST /api/auth/logout",
]);

async function readBodyWithinLimit(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the size-limit response if cancellation is unavailable.
        }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function authenticatedUser(context: {
  req: { raw: Request };
  env: Bindings;
}): Promise<AuthUser | null> {
  try {
    return await currentUser(context.req.raw, context.env as AuthBindings);
  } catch {
    return null;
  }
}

function unauthorized(context: {
  json: (body: unknown, status?: number) => Response;
}): Response {
  return context.json({ error: "Não autenticado." }, 401);
}

async function bearerMatches(
  authorization: string | undefined,
  expectedToken: string | undefined,
): Promise<boolean> {
  if (!authorization || !expectedToken) return false;
  const actual = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(actual)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedToken)),
  ]);
  const left = new Uint8Array(actualDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left[index]! ^ right[index]!;
  return difference === 0 && authorization.startsWith("Bearer ");
}

app.get("/health", (context) =>
  context.json({ app: "sabores-api", status: "ok" }),
);

app.post("/api/auth/login", async (context) => {
  const bytes = await readBodyWithinLimit(
    context.req.raw.body,
    MAX_LOGIN_BODY_BYTES,
  );
  if (!bytes)
    return context.json({ error: "Corpo de login excede 16 KB." }, 413);
  const bodyBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(bodyBuffer).set(bytes);
  return login(
    new Request(context.req.raw.url, {
      method: "POST",
      headers: context.req.raw.headers,
      body: bodyBuffer,
    }),
    context.env as AuthBindings,
  );
});
app.get("/api/auth/session", (context) =>
  sessionResponse(context.req.raw, context.env as AuthBindings),
);
app.post("/api/auth/logout", (context) =>
  logout(context.req.raw, context.env as AuthBindings),
);

app.use("/api/*", async (context, next) => {
  if (PUBLIC_AUTH_ROUTES.has(`${context.req.method} ${context.req.path}`))
    return next();
  const user = await authenticatedUser(context);
  if (!user) return unauthorized(context);
  context.set("authUser", user);
  await next();
});

app.get("/api/catalog/products", async (context) => {
  try {
    const result = await listProducts(
      context.env.DB,
      context.env.CATALOG_CACHE,
    );
    return context.json(result);
  } catch (error) {
    console.error("Falha ao consultar catálogo no D1.", error);
    return context.json({ error: "Catálogo indisponível." }, 503);
  }
});

app.get("/api/erp/finance", async (context) => {
  if (context.get("authUser").role !== "owner")
    return context.json({ error: "Permissão insuficiente." }, 403);
  const from = context.req.query("from") ?? "";
  const to = context.req.query("to") ?? "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to ||
    !Number.isFinite(Date.parse(`${from}T00:00:00Z`)) ||
    !Number.isFinite(Date.parse(`${to}T00:00:00Z`))
  )
    return context.json({ error: "Informe um período válido." }, 400);
  try {
    const result = await context.env.DB.prepare(
      `SELECT l.entry_type, COALESCE(SUM(l.amount_cents), 0) AS total
       FROM ledger_entries l
       LEFT JOIN sales s ON s.ledger_id = l.ledger_id
       LEFT JOIN sale_cancellations c ON c.sale_id = s.sale_id
       WHERE l.occurred_on BETWEEN ? AND ? AND l.entry_type IN ('sale', 'purchase', 'expense')
         AND (l.entry_type <> 'sale' OR c.sale_id IS NULL)
       GROUP BY l.entry_type`,
    )
      .bind(from, to)
      .all<{ entry_type: string; total: number }>();
    return context.json({ data: result.results }, 200, {
      "cache-control": "private, no-store",
    });
  } catch (error) {
    console.error("Falha ao consultar financeiro.", error);
    return context.json({ error: "Financeiro indisponível." }, 503);
  }
});

app.get("/api/erp/catalog/products", async (context) => {
  if (context.get("authUser").role !== "owner")
    return context.json({ error: "Permissão insuficiente." }, 403);
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT p.product_id, p.barcode, p.auxiliary_code, p.name,
              c.name AS category, p.unit, p.sale_price_cents,
              p.unit_cost_cents, p.active
       FROM products p JOIN categories c ON c.category_id = p.category_id
       WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE`,
    ).all();
    return context.json({ data: results });
  } catch (error) {
    console.error("Falha ao consultar catálogo financeiro do ERP.", error);
    return context.json({ error: "Catálogo indisponível." }, 503);
  }
});

app.post("/api/erp/product-price", async (context) => {
  const user = context.get("authUser");
  if (user.role !== "owner")
    return context.json({ error: "Permissão insuficiente." }, 403);
  if (!hasTrustedOrigin(context.req.raw, context.env as AuthBindings))
    return context.json({ error: "Solicitação inválida." }, 403);
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "Corpo JSON inválido." }, 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as Record<string, unknown>).operationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test((body as Record<string, string>).operationId) ||
    typeof (body as Record<string, unknown>).productId !== "string" ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(
      (body as Record<string, string>).productId,
    ) ||
    !("basePriceCents" in (body as Record<string, unknown>)) ||
    ((body as Record<string, unknown>).basePriceCents !== null &&
      (!Number.isSafeInteger(
        (body as Record<string, unknown>).basePriceCents,
      ) ||
        Number((body as Record<string, unknown>).basePriceCents) < 0)) ||
    !Number.isSafeInteger((body as Record<string, unknown>).salePriceCents) ||
    Number((body as Record<string, unknown>).salePriceCents) < 0 ||
    typeof (body as Record<string, unknown>).occurredAt !== "string" ||
    !Number.isFinite(Date.parse((body as Record<string, string>).occurredAt))
  )
    return context.json({ error: "Ajuste de preço inválido." }, 422);
  const operation = body as {
    operationId: string;
    productId: string;
    basePriceCents: number | null;
    salePriceCents: number;
    occurredAt: string;
  };
  try {
    const existing = await context.env.DB.prepare(
      "SELECT product_id, new_price_cents FROM product_price_changes WHERE operation_id = ?",
    )
      .bind(operation.operationId)
      .first<{ product_id: string; new_price_cents: number }>();
    if (existing) {
      if (
        existing.product_id !== operation.productId ||
        existing.new_price_cents !== operation.salePriceCents
      )
        return context.json(
          { error: "operationId já foi usado por outra alteração." },
          409,
        );
      return context.json({ status: "already_applied" });
    }
    const product = await context.env.DB.prepare(
      "SELECT sale_price_cents FROM products WHERE product_id = ?",
    )
      .bind(operation.productId)
      .first<{ sale_price_cents: number | null }>();
    if (!product)
      return context.json({ error: "Produto não encontrado." }, 404);
    if (product.sale_price_cents !== operation.basePriceCents)
      return context.json(
        {
          error:
            "O preço foi alterado em outro dispositivo; revise o conflito.",
        },
        409,
      );
    const now = new Date().toISOString();
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        "UPDATE products SET sale_price_cents = ?, updated_at = ? WHERE product_id = ? AND sale_price_cents IS ?",
      ).bind(
        operation.salePriceCents,
        now,
        operation.productId,
        operation.basePriceCents,
      ),
      context.env.DB.prepare(
        "INSERT INTO product_price_changes (operation_id, product_id, old_price_cents, new_price_cents, actor_user_id, occurred_at, recorded_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1",
      ).bind(
        operation.operationId,
        operation.productId,
        operation.basePriceCents,
        operation.salePriceCents,
        user.id,
        operation.occurredAt,
        now,
      ),
    ]);
    if (results.some((result) => !result.success))
      return context.json(
        { error: "A alteração de preço não foi aplicada." },
        503,
      );
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1)
      return context.json(
        {
          error:
            "O preço foi alterado em outro dispositivo; revise o conflito.",
        },
        409,
      );
    await invalidateCatalogCache(context.env.CATALOG_CACHE);
    return context.json({ status: "applied" });
  } catch (error) {
    console.error("Falha ao registrar ajuste de preço no ERP.", error);
    return context.json({ error: "Não foi possível salvar o preço." }, 503);
  }
});

app.get("/api/pdv/catalog", async (context) => {
  try {
    const { results: products } = await context.env.DB.prepare(
      `SELECT p.product_id, p.barcode, p.auxiliary_code, p.name,
              c.name AS category, p.unit, p.sale_price_cents, p.unit_cost_cents,
              p.active
         FROM products p JOIN categories c ON c.category_id = p.category_id
        WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE`,
    ).all();
    const { results: parameterRows } = await context.env.DB.prepare(
      "SELECT name, value FROM parameters WHERE name IN ('pos_debit_rate', 'pos_credit_rate')",
    ).all<{ name: string; value: string }>();
    const parameters = new Map(
      parameterRows.map((row) => [row.name, row.value]),
    );
    const paymentFees = {
      Dinheiro: "0",
      Débito: parameters.get("pos_debit_rate") ?? "0.0139",
      Crédito: parameters.get("pos_credit_rate") ?? "0.0334",
      Pix: "0",
    };
    const serialized = JSON.stringify({ products, paymentFees });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(serialized),
    );
    const catalogVersion = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const headers = new Headers({
      "cache-control": "private, no-cache",
      etag: `"${catalogVersion}"`,
    });
    if (context.req.header("if-none-match") === headers.get("etag"))
      return new Response(null, { status: 304, headers });
    return context.json(
      {
        catalogVersion,
        fetchedAt: new Date().toISOString(),
        paymentFees,
        data: products,
      },
      200,
      Object.fromEntries(headers.entries()),
    );
  } catch (error) {
    console.error("Falha ao consultar catálogo offline do PDV.", error);
    return context.json({ error: "Catálogo indisponível." }, 503);
  }
});

app.post("/api/pdv/operations", async (context) => {
  const user = context.get("authUser");
  if (!hasTrustedOrigin(context.req.raw, context.env as AuthBindings))
    return context.json({ error: "Solicitação inválida." }, 403);
  const contentLength = Number(context.req.header("content-length") ?? "0");
  if (contentLength > 5_000_000)
    return context.json({ error: "Lote excede 5 MB." }, 413);
  let bytes: Uint8Array | null;
  try {
    bytes = await readBodyWithinLimit(context.req.raw.body, 5_000_000);
  } catch {
    return context.json({ error: "Não foi possível ler o lote." }, 400);
  }
  if (!bytes) return context.json({ error: "Lote excede 5 MB." }, 413);
  let operation: OperationEnvelope;
  try {
    operation = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as OperationEnvelope;
  } catch {
    return context.json({ error: "Corpo JSON inválido." }, 400);
  }
  if (
    !operation ||
    typeof operation.deviceId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(operation.deviceId)
  )
    return context.json({ error: "Dispositivo inválido." }, 422);
  const coordinator = context.env.SALE_COORDINATOR.getByName(
    `pdv-device:${operation.deviceId}`,
  );
  const response = await coordinator.fetch(
    new Request("https://sale-coordinator.local/operations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-actor-user-id": user.id,
      },
      body: JSON.stringify(operation),
    }),
  );
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  return new Response(response.body, { status: response.status, headers });
});

app.get("/api/pdv/sales", async (context) => {
  const from = context.req.query("from") ?? "";
  const to = context.req.query("to") ?? "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to ||
    Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) >
      366 * 86400000
  )
    return context.json(
      { error: "Informe um período válido de até 366 dias." },
      400,
    );
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT s.sale_id, s.gross_cents, s.fee_cents, s.net_cents, s.customer, s.notes,
              s.created_at, s.client_created_at, s.device_id, l.occurred_on,
              l.actor_user_id, c.reason AS cancellation_reason,
              (SELECT MAX(payment_version) FROM sale_payment_adjustments a WHERE a.sale_id = s.sale_id) AS payment_version
       FROM sales s JOIN ledger_entries l ON l.ledger_id = s.ledger_id
       LEFT JOIN sale_cancellations c ON c.sale_id = s.sale_id
       WHERE l.occurred_on BETWEEN ? AND ? ORDER BY l.occurred_at DESC LIMIT 500`,
    )
      .bind(from, to)
      .all();
    const saleRows = results as Array<{
      sale_id: string;
      gross_cents: number;
      payment_version: number | null;
      [key: string]: unknown;
    }>;
    const saleIds = saleRows.map((sale) => sale.sale_id);
    const sales: Array<Record<string, unknown>> = [];
    if (saleIds.length) {
      const chunks = Array.from(
        { length: Math.ceil(saleIds.length / 80) },
        (_, index) => saleIds.slice(index * 80, index * 80 + 80),
      );
      const queryResults = await Promise.all(
        chunks.map(async (ids) => {
          const placeholders = ids.map(() => "?").join(",");
          return Promise.all([
            context.env.DB.prepare(
              `SELECT sale_id, product_name_snapshot, category_snapshot, quantity, unit_price_cents, unit_cost_cents, line_total_cents FROM sale_items WHERE sale_id IN (${placeholders}) ORDER BY sale_id, position`,
            )
              .bind(...ids)
              .all<Record<string, unknown> & { sale_id: string }>(),
            context.env.DB.prepare(
              `SELECT sale_id, method, method_label, amount_cents, fee_rate, fee_cents, part_number, payment_version FROM sale_payments WHERE sale_id IN (${placeholders}) ORDER BY sale_id, position`,
            )
              .bind(...ids)
              .all<
                Record<string, unknown> & {
                  sale_id: string;
                  payment_version: number;
                }
              >(),
            context.env.DB.prepare(
              `SELECT a.sale_id, a.payment_version, l.method, l.method_label, l.amount_cents, l.fee_rate, l.fee_cents, l.part_number, l.position FROM sale_payment_adjustments a JOIN sale_payment_adjustment_lines l ON l.adjustment_id = a.adjustment_id WHERE a.sale_id IN (${placeholders}) ORDER BY a.sale_id, a.payment_version, l.position`,
            )
              .bind(...ids)
              .all<
                Record<string, unknown> & {
                  sale_id: string;
                  payment_version: number;
                }
              >(),
          ]);
        }),
      );
      const itemResults = queryResults.flatMap(([items]) => items.results);
      const basePaymentResults = queryResults.flatMap(
        ([, payments]) => payments.results,
      );
      const adjustedPaymentResults = queryResults.flatMap(
        ([, , payments]) => payments.results,
      );
      const itemsBySale = new Map<string, Record<string, unknown>[]>();
      const basePaymentsBySale = new Map<string, Record<string, unknown>[]>();
      const adjustedByVersion = new Map<string, Record<string, unknown>[]>();
      for (const item of itemResults)
        itemsBySale.set(item.sale_id, [
          ...(itemsBySale.get(item.sale_id) ?? []),
          item,
        ]);
      for (const payment of basePaymentResults)
        basePaymentsBySale.set(payment.sale_id, [
          ...(basePaymentsBySale.get(payment.sale_id) ?? []),
          payment,
        ]);
      for (const payment of adjustedPaymentResults) {
        const key = `${payment.sale_id}:${payment.payment_version}`;
        adjustedByVersion.set(key, [
          ...(adjustedByVersion.get(key) ?? []),
          payment,
        ]);
      }
      for (const sale of saleRows) {
        const version = sale.payment_version ?? 1;
        const payments =
          version === 1
            ? (basePaymentsBySale.get(sale.sale_id) ?? [])
            : (adjustedByVersion.get(`${sale.sale_id}:${version}`) ?? []);
        const currentFees = payments.reduce(
          (sum, payment) => sum + Number(payment.fee_cents),
          0,
        );
        sales.push({
          ...sale,
          fee_cents: currentFees,
          net_cents: Number(sale.gross_cents) - currentFees,
          payments,
          items: itemsBySale.get(sale.sale_id) ?? [],
        });
      }
    }
    const { results: rateRows } = await context.env.DB.prepare(
      "SELECT name, value FROM parameters WHERE name IN ('pos_debit_rate', 'pos_credit_rate')",
    ).all<{ name: string; value: string }>();
    const rates = new Map(rateRows.map((row) => [row.name, row.value]));
    const paymentFees = {
      Dinheiro: "0",
      Débito: rates.get("pos_debit_rate") ?? "0.0139",
      Crédito: rates.get("pos_credit_rate") ?? "0.0334",
      Pix: "0",
    };
    return context.json({ sales, paymentFees }, 200, {
      "cache-control": "private, no-store",
    });
  } catch (error) {
    console.error("Falha ao consultar histórico de vendas.", error);
    return context.json({ error: "Histórico indisponível." }, 503);
  }
});

app.post("/api/sales", async (context) => {
  if (!hasTrustedOrigin(context.req.raw, context.env as AuthBindings))
    return context.json({ error: "Solicitação inválida." }, 403);
  return context.json(
    {
      error:
        "Este endpoint foi substituído pelo protocolo de operações offline do PDV.",
    },
    410,
  );
});

app.get("/api/backups", async (context) => {
  const page = await context.env.PRIVATE_FILES.list({
    prefix: "backups/d1/",
    limit: 1000,
  });
  const manifests = page.objects.filter((object) =>
    object.key.endsWith(".json"),
  );
  return context.json({
    backups: manifests.map((object) => ({
      key: object.key,
      uploaded: object.uploaded.toISOString(),
    })),
  });
});

app.post("/api/backups/run", async (context) => {
  if (!hasTrustedOrigin(context.req.raw, context.env as AuthBindings))
    return context.json({ error: "Solicitação inválida." }, 403);
  if (
    context.env.BACKUP_ACCOUNT_ID === "local" ||
    context.env.BACKUP_DATABASE_ID === "local"
  ) {
    return context.json(
      {
        error:
          "A exportação do D1 local é feita pelo comando pnpm --filter @sabores/api db:backup:local.",
      },
      409,
    );
  }
  const key = context.req.header("idempotency-key") ?? crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{8,90}$/.test(key)) {
    return context.json(
      { error: "Informe uma chave de idempotência válida." },
      400,
    );
  }
  const id = `manual-${key}`;
  let instance;
  let created = true;
  try {
    instance = await context.env.D1_BACKUP.create({ id });
  } catch (error) {
    try {
      created = false;
      instance = await context.env.D1_BACKUP.get(id);
    } catch {
      console.error("Falha ao iniciar Workflow de backup.", error);
      return context.json({ error: "Não foi possível iniciar o backup." }, 503);
    }
  }
  const status = await instance.status();
  return context.json(
    { id: instance.id, status: status.status },
    created ? 202 : 200,
  );
});

app.get("/api/backups/file/*", async (context) => {
  let key: string;
  try {
    key = decodeURIComponent(
      context.req.path.slice("/api/backups/file/".length),
    );
  } catch {
    return context.json({ error: "Not found" }, 404);
  }
  if (
    !key.startsWith("backups/d1/") ||
    key.includes("..") ||
    key.includes("\\")
  ) {
    return context.json({ error: "Not found" }, 404);
  }
  let object = await context.env.PRIVATE_FILES.get(key);
  if (!object) return context.json({ error: "Not found" }, 404);
  if (key.endsWith(".sql")) {
    const manifest = await context.env.PRIVATE_FILES.get(
      key.replace(/\.sql$/, ".json"),
    );
    if (
      !manifest ||
      !object.body ||
      !(await verifyBackupStream(object.body, await manifest.text(), key))
    ) {
      return context.json(
        { error: "Backup não passou na validação de integridade." },
        409,
      );
    }
    const verifiedEtag = object.httpEtag;
    object = await context.env.PRIVATE_FILES.get(key);
    if (!object || object.httpEtag !== verifiedEtag) {
      return context.json(
        { error: "Backup foi alterado durante a validação." },
        409,
      );
    }
  }
  return new Response(object.body, {
    headers: {
      "content-type":
        object.httpMetadata?.contentType ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${key.split("/").at(-1)}"`,
      "cache-control": "private, no-store",
      etag: object.httpEtag,
    },
  });
});

app.post("/__local/import", async (context) => {
  const hostname = new URL(context.req.url).hostname;
  const expectedToken = context.env.LOCAL_IMPORT_TOKEN;
  if (
    !["127.0.0.1", "localhost"].includes(hostname) ||
    !expectedToken ||
    expectedToken.length < 32
  ) {
    return context.notFound();
  }
  if (
    !(await bearerMatches(context.req.header("authorization"), expectedToken))
  ) {
    return context.json({ error: "Unauthorized" }, 401);
  }
  const contentLength = Number(context.req.header("content-length") ?? "0");
  if (contentLength > 5_000_000)
    return context.json({ error: "Pacote excede 5 MB." }, 413);
  let payload: unknown;
  try {
    const raw = await context.req.text();
    if (new TextEncoder().encode(raw).byteLength > 5_000_000)
      return context.json({ error: "Pacote excede 5 MB." }, 413);
    payload = JSON.parse(raw);
  } catch {
    return context.json({ error: "Corpo não é JSON válido." }, 400);
  }
  try {
    if (context.req.query("mode") === "preview") {
      return context.json(await previewImport(context.env.DB, payload));
    }
    const result = await importBundle(context.env.DB, payload);
    await invalidateCatalogCache(context.env.CATALOG_CACHE);
    return context.json(result);
  } catch (error) {
    return context.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao importar pacote.",
      },
      422,
    );
  }
});

app.notFound((context) => context.json({ error: "Not found" }, 404));

export default app;
